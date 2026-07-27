/*
 * spectrogram.js — 音频频谱图（WAV → STFT 频谱 PNG，cat:'stego'，run 型单向分析）。
 *
 * 定位：CTF 音频隐写高频杀器。出题人把 flag/文字画进音频频域（Audacity/Sonic
 * Visualiser 的 spectrogram 视图能看见），本 op 纯前端算 STFT 生成频谱图 PNG
 * 免装桌面软件即可肉眼读频域藏字。补 audiostego.js 只有 Goertzel 单频点检测
 * 无整幅频谱渲染的缺口。对应 ctf-wiki misc 音频隐写 + all-in-one 频谱分析。
 *
 * 算法（标准短时傅里叶变换 STFT）：
 * 1. 解析 WAV 取 PCM 单声道（多声道取指定声道，默认 0）
 * 2. 按帧长 fftSize 滑窗（hop = fftSize/2 半重叠），每帧加 Hann 窗抑制频谱泄漏
 * 3. 每帧 radix-2 Cooley-Tukey FFT → 幅度谱，取前 fftSize/2 个 bin（Nyquist 内）
 * 4. 幅度转 dB（20·log10），按 [dbMin, dbMax] 归一 → magma 色阶 → 像素
 * 5. 手写 PNG 编码（复用 mcMap.encodePNG），x=时间帧、y=频率(低频在下)，输出 dataURL
 *
 * 防爆：
 * - fftSize 限 256/512/1024/2048（2 的幂，FFT 前提）
 * - 帧数超上限（2000）自动放大 hop 抽帧，保证图宽可控
 * - 图高 = fftSize/2（≤1024）
 *
 * 契约：件内自注册，只 import registry + 复用 audiostego/mcMap 的 export 纯函数。
 * run(text, p) 单向，输入 WAV(hex/base64/dataURL/auto)，输出频谱 PNG dataURL + 摘要。
 *
 * 红线：算法层零 UI 依赖（仅 registry + core 纯函数复用）；零外发纯本地；件内自注册。
 *
 * 参考：STFT / Hann 窗 / Cooley-Tukey FFT 标准算法（Oppenheim DSP）；magma 色阶
 * （matplotlib，近似控制点插值）；WAV RIFF 格式（audiostego.parseWav 已实现）。
 */
import { register } from "./registry.js";
import { parseWav, readPcmSamples, inputToBytes } from "./audiostego.js";
import { rgbaToDataURL } from "./mcMap.js";

// ============================================================
// radix-2 Cooley-Tukey FFT（原地，re/im 为 Float64Array，长度须 2 的幂）
// ============================================================
function fft(re, im) {
  const n = re.length;
 // 位反转置换
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
 // 蝶形运算
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const idx = i + k, jdx = i + k + half;
        const vr = re[jdx] * cr - im[jdx] * ci;
        const vi = re[jdx] * ci + im[jdx] * cr;
        re[jdx] = re[idx] - vr; im[jdx] = im[idx] - vi;
        re[idx] += vr;          im[idx] += vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

// ============================================================
// magma 色阶（8 控制点，dark→purple→red→yellow），t∈[0,1] → [r,g,b]
// ============================================================
const MAGMA = [
  [0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99],
  [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 253, 191],
];
function magma(t) {
  if (t <= 0) return MAGMA[0];
  if (t >= 1) return MAGMA[MAGMA.length - 1];
  const seg = t * (MAGMA.length - 1);
  const i = Math.floor(seg);
  const f = seg - i;
  const a = MAGMA[i], b = MAGMA[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

// ============================================================
// STFT → 频谱矩阵 [numFrames][numBins]（dB 值）
// ============================================================
function stft(samples, fftSize, hop) {
  const numBins = fftSize >> 1;
  const numFrames = Math.floor((samples.length - fftSize) / hop) + 1;
 // Hann 窗预算
  const win = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i++) win[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));

  const mags = []; // numFrames × numBins（dB）
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  let dbMin = Infinity, dbMax = -Infinity;

  for (let f = 0; f < numFrames; f++) {
    const start = f * hop;
    for (let i = 0; i < fftSize; i++) { re[i] = samples[start + i] * win[i]; im[i] = 0; }
    fft(re, im);
    const row = new Float64Array(numBins);
    for (let k = 0; k < numBins; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / fftSize;
      const db = 20 * Math.log10(mag + 1e-9);
      row[k] = db;
      if (db < dbMin) dbMin = db;
      if (db > dbMax) dbMax = db;
    }
    mags.push(row);
  }
  return { mags, numFrames, numBins, dbMin, dbMax };
}

// ============================================================
// 频谱矩阵 → RGBA PNG（x=帧, y=频率低频在下 → row 翻转）
// ============================================================
function renderSpectrogram(sp, dbFloor) {
  const { mags, numFrames, numBins, dbMax } = sp;
  const w = numFrames, h = numBins;
 // 动态范围底：max - dbFloor（默认 80dB），低于底的钳到 0
  const lo = dbMax - dbFloor;
  const range = dbMax - lo || 1;
  const rgba = new Uint8Array(w * h * 4);
  for (let x = 0; x < w; x++) {
    const col = mags[x];
    for (let k = 0; k < numBins; k++) {
 // y=0 是图顶=最高频，故 row = numBins-1-k
      const y = numBins - 1 - k;
      let t = (col[k] - lo) / range;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const [r, g, b] = magma(t);
      const off = (y * w + x) * 4;
      rgba[off] = r; rgba[off + 1] = g; rgba[off + 2] = b; rgba[off + 3] = 255;
    }
  }
  return { rgba, w, h };
}

// ============================================================
// run 主入口
// ============================================================
function spectrogramRun(text, p) {
  const fftSize = [256, 512, 1024, 2048].includes(Number(p && p.fftSize)) ? Number(p.fftSize) : 1024;
  const chSel = Math.max(0, parseInt((p && p.channel) || "0", 10) || 0);
  const dbFloor = Math.max(20, Math.min(120, parseInt((p && p.dbFloor) || "80", 10) || 80));
  const MAX_FRAMES = 2000;

  const L = [];
  L.push("=== 音频频谱图（STFT） ===");
  L.push("");

  let bytes;
  try {
    bytes = (p && p.rawBytes && p.rawBytes.length)
      ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
      : inputToBytes(text, p);
  }
  catch (e) { return "✗ 输入解析失败: " + (e.message || String(e)); }
  if (!bytes || bytes.length < 44) return "✗ 数据太短，非有效 WAV（需含 44 字节以上 RIFF 头）。";

  const wav = parseWav(bytes);
  if (!wav.ok) return "✗ WAV 解析失败: " + (wav.error || "未知") + "\n（本 op 仅支持 PCM WAV；MP3/OGG 等压缩格式请先转 WAV）";
  if (!wav.data) return "✗ WAV 缺 data 块。";

  const fmt = wav.fmt;
  const tag = fmt.formatTag === 0xFFFE ? (fmt.subFormat || 0) : fmt.formatTag;
  if (tag !== 1 && tag !== 3) {
    L.push("⚠ formatTag=" + fmt.formatTag + "（非 PCM/IEEE-float，解码可能不准）");
  }

  let pcm;
  try { pcm = readPcmSamples(bytes, fmt, wav.data.offset, wav.data.actual); }
  catch (e) { return "✗ PCM 读取失败: " + (e.message || String(e)); }

  const ch = Math.min(chSel, pcm.channels.length - 1);
  const raw = pcm.channels[ch];
  if (!raw || raw.length < fftSize) {
    return "✗ 样本数（" + (raw ? raw.length : 0) + "）不足一个 FFT 帧（" + fftSize + "）。";
  }

 // 归一化到 [-1,1]。IEEE-float（tag=3）样本本就是 [-1,1]，不再除；整数 PCM 按位深满量程。
 // 用 Math.pow 而非 1<<(bits-1)：32 位时 1<<31 溢出为负，会导致波形反相 + 尺度错乱。
  const maxAbs = tag === 3 ? 1 : (Math.pow(2, fmt.bitsPerSample - 1) || 32768);
  const samples = new Float64Array(raw.length);
  for (let i = 0; i < raw.length; i++) samples[i] = raw[i] / maxAbs;

 // hop：默认半重叠；帧数超上限则放大 hop 抽帧
  let hop = fftSize >> 1;
  let numFrames = Math.floor((samples.length - fftSize) / hop) + 1;
  if (numFrames > MAX_FRAMES) {
    hop = Math.ceil((samples.length - fftSize) / (MAX_FRAMES - 1));
    numFrames = Math.floor((samples.length - fftSize) / hop) + 1;
    L.push("● 帧数超上限，hop 放大到 " + hop + " 抽帧（原半重叠帧数过多）");
  }

  const sr = fmt.sampleRate || 0;
  const durSec = sr ? (raw.length / sr) : 0;
  L.push("● 采样率: " + sr + " Hz / 位深: " + fmt.bitsPerSample + " / 声道: " + pcm.channels.length + "（用第 " + ch + " 声道）");
  L.push("● 时长: " + durSec.toFixed(3) + " s / 样本数: " + raw.length);
  L.push("● FFT 帧长: " + fftSize + " / hop: " + hop + " / 频率分辨率: " + (sr ? (sr / fftSize).toFixed(1) : "?") + " Hz/bin");

  const sp = stft(samples, fftSize, hop);
  L.push("● 频谱: " + sp.numFrames + " 帧 × " + sp.numBins + " 频点（图 " + sp.numFrames + "×" + sp.numBins + " px）");
  L.push("● dB 范围: [" + sp.dbMin.toFixed(1) + ", " + sp.dbMax.toFixed(1) + "]，动态底 " + dbFloor + " dB");
  L.push("● 纵轴: 下=0 Hz, 上=" + (sr ? (sr / 2) : "Nyquist") + " Hz（Nyquist）");

  const img = renderSpectrogram(sp, dbFloor);
  let dataURL;
  try { dataURL = rgbaToDataURL(img.rgba, img.w, img.h); }
  catch (e) { return L.join("\n") + "\n\n✗ PNG 编码失败: " + (e.message || String(e)); }

  L.push("");
  L.push("--- 频谱图（magma 色阶，双击查看/复制 dataURL）---");
  L.push(dataURL);
  L.push("");
  L.push("说明: 亮=能量高。频域藏字通常是横跨若干帧的亮色文字/波形，直接肉眼读。");
  L.push("  · 看不清可调 dbFloor（调小=对比更强只留强信号，调大=保留更多弱细节）");
  L.push("  · 高频细节丢失可增大 FFT 帧长（频率分辨率↑但时间分辨率↓）");

  return L.join("\n");
}

register({
  id: "spectrogram",
  cat: "stego",
  name: "音频频谱图（STFT）",
  desc: "WAV → 短时傅里叶变换频谱图 PNG：Hann 窗 + radix-2 FFT，magma 色阶渲染，肉眼读频域藏字（CTF 音频隐写把 flag 画进频谱）。纯前端免装 Audacity",
  params: [
    {
      key: "fftSize", label: "FFT 帧长", type: "select", default: 1024,
      options: [
        { value: 256, label: "256（时间分辨率高）" },
        { value: 512, label: "512" },
        { value: 1024, label: "1024（默认，均衡）" },
        { value: 2048, label: "2048（频率分辨率高）" },
      ],
    },
    { key: "channel", label: "声道（0=左）", type: "number", default: 0, placeholder: "多声道时选，默认 0" },
    { key: "dbFloor", label: "动态范围底(dB)", type: "number", default: 80, placeholder: "20-120，默认 80" },
  ],
  run: spectrogramRun,
  acceptsBytes: true,
});

export { fft, stft, magma, renderSpectrogram, spectrogramRun };
