/*
 * morseWav.js — 摩斯电码音频（WAV）编解码（cat:'audio'）。
 *
 * 定位：喂入 WAV 音频 → 包络检测 → 通断二值化 → 点划自适应分类 → 还原明文。
 * 与 fancy.js id:"morse"（文本摩斯，吃 ".-" 字符串）互补：本 op 吃的是「声音」。
 * 双向：decode（声音 → 明文）与 encode（明文 → 声音）都用同一套 {1,3,7} 时间格，
 *   所以「本文件合成的音频，本文件一定能解回去」是设计使然。
 *   encode 也接受已经是点划串的输入（只含 . - / 与空白时自动按符号处理）。
 * 解码后另附「明文再解一层」参考：复用一键解码引擎跑一层（限时、限量、只作参考），
 *   因为真题里摩斯音频解出的明文常是下一层编码（例如 base32 的 "NFWG65TFPFXXK==="）。
 *
 * ── 标准依据 ──────────────────────────────────────────────
 * [1] ITU-R M.1677-1《International Morse Code》字符码表（字母/数字/标点）。
 * [2] ITU-R M.1677-1 时间结构：点 = 1 单位时长，划 = 3 单位，同字符内元素间隔 = 1 单位，
 *     字符间间隔 = 3 单位，词间间隔 = 7 单位。
 * [3] PARIS 标准（WPM 的定义）：WPM = 1200 / 单位时长(ms)。即 20 WPM ⇒ 单位 60 ms。
 *     故 wpm 参数与 unit 参数是同一量的两种写法，unit 优先。
 *
 * ── 算法判据（自推导，逐条说明为什么这么判）───────────────
 * ① 包络：5 ms 短窗 RMS。
 *    - 取 RMS 而非峰值：RMS 与采样相位无关、对加性噪声的估计更稳；峰值对单点毛刺过敏。
 *    - 窗长 5 ms 是「远小于最快摩斯元素」的平滑尺度（60 WPM 时点长 20 ms），
 *      它只是低通平滑常数，不是「单位时长」，故不构成对速度的写死。
 * ② 阈值：对包络做 Otsu 最大类间方差自动阈值。
 *    - 判据：通/断两态的能量包络天然双峰，Otsu 无需人工给定绝对电平，
 *      对任意录音增益、任意底噪自适应；再乘灵敏度因子做人工微调。
 *    - 双峰有效性判据：两类均值相对分离度 sep = (μ_on − μ_off) / μ_on。
 *      纯噪声（单峰）被 Otsu 从中间切开时 sep 很小 → 直接判失败，不产出垃圾文本。
 * ③ 单位时长：所有游程（通段 + 断段）合并做 1 维 k-means(k=2) 取「短簇」中心作初值，
 *    再用 {1,3,7}×u 的 ITU 时间格做 EM 精修 u = mean(d / k)。
 *    - 判据：摩斯的所有时间量只取 1u/3u/7u 三档，故把每个游程吸附到最近的 k·u 再反解 u，
 *      是这套离散时间格下的最大似然估计；比「取最小游程」抗毛刺，比「取中位数」抗长短失衡。
 *    - 关键：全程不写死任何单位时长，也不写死音频频率。
 * ④ 分类阈值：点/划切在 2u（1u 与 3u 的算术中点）；元素间隔/字符间隔切在 2u；
 *    字符间隔/词间隔切在 5u（3u 与 7u 的算术中点）。即 ITU 时间格的最大似然边界。
 * ⑤ 毛刺剔除：短于 2 ms 的游程翻转合并（远短于最快元素的 20 ms），抑制噪声造成的假通断。
 *
 * ── 输出契约 ──────────────────────────────────────────────
 * 核心函数 morseWavDecode() 永不抛异常：任何失败都返回 { ok:false, reason, ... }，
 * 并带上已测到的包络/直方图诊断，绝不把噪声当成功结果输出。
 * 纯 JS、零第三方依赖、零 DOM，Node 可直接 import()。
 */
import { OPS, register } from "./registry.js";
import { bytesToB64 } from "./bytesIo.js";

// ============ ITU-R M.1677-1 码表（与 fancy.js id:"morse" 同源，保持一致） ============
const MORSE = {
  ".-": "A", "-...": "B", "-.-.": "C", "-..": "D", ".": "E", "..-.": "F",
  "--.": "G", "....": "H", "..": "I", ".---": "J", "-.-": "K", ".-..": "L",
  "--": "M", "-.": "N", "---": "O", ".--.": "P", "--.-": "Q", ".-.": "R",
  "...": "S", "-": "T", "..-": "U", "...-": "V", ".--": "W", "-..-": "X",
  "-.--": "Y", "--..": "Z",
  "-----": "0", ".----": "1", "..---": "2", "...--": "3", "....-": "4",
  ".....": "5", "-....": "6", "--...": "7", "---..": "8", "----.": "9",
  ".-.-.-": ".", "--..--": ",", "..--..": "?", ".----.": "'", "-.-.--": "!",
  "-..-.": "/", "-.--.": "(", "-.--.-": ")", ".-...": "&", "---...": ":",
  "-.-.-.": ";", "-...-": "=", ".-.-.": "+", "-....-": "-", "..--.-": "_",
  ".-..-.": '"', "...-..-": "$", ".--.-.": "@",
  // 扩展标点（非 ITU 官方，与 fancy.js 扩展字符集一致，仅为兼容解码）
  "----.--": "{", "-----.-": "}", "-..-..-": "*", "......": "#", "...-.-": "%",
};
const MORSE_REV = {};
for (const [k, v] of Object.entries(MORSE)) if (!(v in MORSE_REV)) MORSE_REV[v] = k;

// 分析常数（均为「平滑/判定」尺度，非单位时长）
const ENV_WIN_MS = 5;      // 包络窗长
const ENV_HOP_DIV = 4;     // 步进 = 窗长 / 4 ⇒ 1.25 ms
const GLITCH_MS = 2;       // 短于此的游程判为毛刺
const UNIT_MIN_MS = 3;     // 单位时长合理下界（≈400 WPM）
const UNIT_MAX_MS = 3000;  // 单位时长合理上界（≈0.4 WPM）
const SEP_MIN = 0.2;       // 通断分离度下界（低于此判为非通断调制）

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function toU8(x) {
  if (x instanceof Uint8Array) return x;
  if (Array.isArray(x)) return Uint8Array.from(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  throw new Error("输入不是字节序列");
}

// ============ WAV 解析（自包含最小实现） ============
// 支持：整数 PCM 8/16/24/32 位、IEEE float 32/64 位、µ-law 8 位；
//      单声道到 8 声道（多声道取各声道算术平均，兼容「只在一侧声道」的素材）；
//      任意采样率；WAVE_FORMAT_EXTENSIBLE(0xFFFE) 取 SubFormat 真实编码。
// 输出统一归一化 Float64 单声道波形 + 去直流。
function parseWavPcm(input) {
  const bytes = toU8(input);
  const ascii = (i, n) => { let s = ""; for (let k = 0; k < n; k++) s += String.fromCharCode(bytes[i + k]); return s; };
  const u16 = (i) => (bytes[i] | (bytes[i + 1] << 8)) >>> 0;
  const u32 = (i) => (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] * 0x1000000)) >>> 0;
  if (bytes.length < 44 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") {
    throw new Error("不是合法 WAV（缺 RIFF/WAVE 头）");
  }
  let off = 12, fmt = null, data = null;
  while (off + 8 <= bytes.length) {
    const id = ascii(off, 4), size = u32(off + 4), d = off + 8;
    if (id === "fmt " && d + 16 <= bytes.length) {
      let tag = u16(d);
      const channels = u16(d + 2), sampleRate = u32(d + 4), bits = u16(d + 14);
      // EXTENSIBLE：真实编码格式写在 SubFormat GUID 的前 2 字节
      if (tag === 0xFFFE && size >= 40 && d + 26 <= bytes.length) tag = u16(d + 24);
      fmt = { formatTag: tag, channels, sampleRate, bits };
    } else if (id === "data") {
      data = { offset: d, size: Math.min(size, bytes.length - d) };
    }
    const adv = size + (size & 1); // RIFF 块按偶数字节对齐
    if (adv <= 0) break;
    off = d + adv;
  }
  if (!fmt || !data) throw new Error("WAV 缺 fmt 或 data 块");
  if (!fmt.bits || fmt.bits < 8 || fmt.bits > 64 || (fmt.bits & 7) !== 0) {
    throw new Error("WAV 位深非法（支持 8/16/24/32/64 位）");
  }
  if (!fmt.channels || fmt.channels < 1 || fmt.channels > 8) throw new Error("WAV 声道数非法");
  if (!fmt.sampleRate || fmt.sampleRate < 100) throw new Error("WAV 采样率非法");
  const TAG_NAMES = { 1: "整数 PCM", 3: "IEEE float", 7: "µ-law" };
  if (!(fmt.formatTag in TAG_NAMES)) {
    throw new Error("WAV 编码格式 " + fmt.formatTag + " 不支持（支持 1=整数 PCM / 3=IEEE float / 7=µ-law）");
  }
  if (fmt.formatTag === 3 && fmt.bits !== 32 && fmt.bits !== 64) throw new Error("float PCM 仅支持 32/64 位");
  if (fmt.formatTag === 7 && fmt.bits !== 8) throw new Error("µ-law 为 8 位编码");

  const bps = fmt.bits >> 3;
  const frameBytes = bps * fmt.channels;
  const frames = Math.floor(data.size / frameBytes);
  const scale = Math.pow(2, fmt.bits - 1) || 1;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ulaw2lin = (u) => {
    u = ~u & 0xFF;
    let t = ((u & 0x0F) << 3) + 0x84;
    t <<= (u & 0x70) >> 4;
    return (u & 0x80) ? (0x84 - t) : (t - 0x84);
  };
  const sig = new Float64Array(frames);
  for (let f = 0; f < frames; f++) {
    const base = data.offset + f * frameBytes;
    let acc = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const p = base + c * bps;
      let v;
      if (fmt.formatTag === 7) v = ulaw2lin(bytes[p]) / 32768;
      else if (fmt.formatTag === 3) v = (fmt.bits === 32) ? dv.getFloat32(p, true) : dv.getFloat64(p, true);
      else if (fmt.bits === 8) v = (bytes[p] - 128) / 128; // 8 位 PCM 为无符号，中心 128
      else if (fmt.bits === 16) { let x = bytes[p] | (bytes[p + 1] << 8); if (x >= 0x8000) x -= 0x10000; v = x / scale; }
      else if (fmt.bits === 24) { let x = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16); if (x >= 0x800000) x -= 0x1000000; v = x / scale; }
      else { const x = (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)); v = x / scale; }
      if (!Number.isFinite(v)) v = 0;
      acc += v;
    }
    sig[f] = acc / fmt.channels; // 多声道取算术平均
  }
  // 去直流：部分素材（尤其 8 位 PCM / 有偏录音）带直流偏置，会抬高包络底噪
  let mean = 0;
  for (let i = 0; i < frames; i++) mean += sig[i];
  mean = frames ? mean / frames : 0;
  for (let i = 0; i < frames; i++) sig[i] -= mean;
  return {
    sig, sampleRate: fmt.sampleRate, channels: fmt.channels, bits: fmt.bits,
    formatTag: fmt.formatTag, formatName: TAG_NAMES[fmt.formatTag],
    frames, durationSec: frames / fmt.sampleRate,
  };
}

// ============ 包络检测（短窗 RMS） ============
function computeEnvelope(sig, sr) {
  const win = Math.max(8, Math.round(sr * ENV_WIN_MS / 1000));
  const hop = Math.max(1, Math.round(win / ENV_HOP_DIV));
  const n = sig.length >= win ? Math.floor((sig.length - win) / hop) + 1 : 0;
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = i * hop;
    let acc = 0;
    for (let k = 0; k < win; k++) acc += sig[s + k] * sig[s + k];
    env[i] = Math.sqrt(acc / win);
  }
  return { env, hopMs: hop / sr * 1000, winMs: win / sr * 1000, hopSamples: hop, winSamples: win };
}

// ============ Otsu 最大类间方差阈值 ============
function otsuThreshold(vals, bins = 256) {
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!(hi > lo)) return null;
  const hist = new Float64Array(bins);
  const span = hi - lo;
  for (const v of vals) hist[Math.min(bins - 1, Math.floor((v - lo) / span * bins))]++;
  const total = vals.length;
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += i * hist[i];
  let wB = 0, sumB = 0, best = -1, bestVar = -1;
  for (let t = 0; t < bins; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) { bestVar = between; best = t; }
  }
  if (best < 0) return null;
  return lo + (best + 0.5) * span / bins;
}

function percentile(sorted, q) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ============ 二值化 + 毛刺剔除 ============
function binarize(env, thr) {
  const bin = new Uint8Array(env.length);
  for (let i = 0; i < env.length; i++) bin[i] = env[i] > thr ? 1 : 0;
  return bin;
}

function despeckle(bin, minWins) {
  if (minWins <= 1) return bin;
  const out = bin.slice();
  for (let pass = 0; pass < 8; pass++) {
    let changed = false, i = 0;
    while (i < out.length) {
      const v = out[i];
      let j = i;
      while (j < out.length && out[j] === v) j++;
      if (j - i < minWins && i > 0 && j < out.length) {
        for (let k = i; k < j; k++) out[k] = 1 - v;
        changed = true;
      }
      i = j;
    }
    if (!changed) break;
  }
  return out;
}

// 二值序列 → 游程表（含通/断，毫秒）
function runsFromBinary(bin, hopMs) {
  const runs = [];
  let i = 0;
  while (i < bin.length) {
    const v = bin[i];
    let j = i;
    while (j < bin.length && bin[j] === v) j++;
    runs.push({ on: v === 1, ms: (j - i) * hopMs, startIdx: i, lenWins: j - i });
    i = j;
  }
  return runs;
}

// ============ 单位时长估计（k-means 初值 + {1,3,7} 时间格 EM 精修） ============
function estimateUnit(durs) {
  if (!durs.length) return null;
  const sorted = [...durs].sort((a, b) => a - b);
  let c1 = percentile(sorted, 0.25), c2 = percentile(sorted, 0.75);
  if (!(c1 > 0)) c1 = Math.max(sorted[0], 1e-3);
  if (!(c2 > c1)) c2 = c1 * 1.2 + 1e-3;
  // 1 维 k-means(k=2)：初始化于 25%/75% 分位
  for (let it = 0; it < 40; it++) {
    let s1 = 0, n1 = 0, s2 = 0, n2 = 0;
    for (const d of durs) {
      if (Math.abs(d - c1) <= Math.abs(d - c2)) { s1 += d; n1++; } else { s2 += d; n2++; }
    }
    const a = n1 ? s1 / n1 : c1, b = n2 ? s2 / n2 : c2;
    if (Math.abs(a - c1) < 1e-9 && Math.abs(b - c2) < 1e-9) { c1 = a; c2 = b; break; }
    c1 = a; c2 = b;
  }
  if (c1 > c2) { const t = c1; c1 = c2; c2 = t; }
  const single = !(c2 / c1 > 1.15); // 只有一个簇（全部游程等长）
  let u = c1;
  // EM 精修：把每个游程吸附到最近的 k·u（k ∈ {1,3,7}），再反解 u = mean(d/k)
  for (let it = 0; it < 30; it++) {
    let sum = 0, n = 0;
    for (const d of durs) {
      let bestK = 1, bestErr = Infinity;
      for (const k of [1, 3, 7]) {
        const e = Math.abs(d - k * u);
        if (e < bestErr) { bestErr = e; bestK = k; }
      }
      sum += d / bestK; n++;
    }
    const un = n ? sum / n : u;
    if (Math.abs(un - u) < 1e-7) { u = un; break; }
    u = un;
  }
  return { unitMs: u, shortCentroid: c1, longCentroid: c2, ratio: c2 / c1, singleCluster: single };
}

// ============ 点划/间隔分类（ITU 时间格边界） ============
function classifyRuns(runs, u) {
  const marks = [], gaps = [];
  const items = [];
  for (const r of runs) {
    if (r.on) {
      const isDash = r.ms >= 2 * u;
      marks.push({ type: isDash ? "dash" : "dot", ms: r.ms, startIdx: r.startIdx });
      items.push({ kind: "mark", sym: isDash ? "-" : ".", ms: r.ms });
    } else {
      const lvl = r.ms >= 5 * u ? "word" : (r.ms >= 2 * u ? "letter" : "elem");
      gaps.push({ type: lvl, ms: r.ms });
      items.push({ kind: "gap", sym: lvl, ms: r.ms });
    }
  }
  return { marks, gaps, items };
}

// ============ 时间格拟合残差（置信度用） ============
function gridResidual(durs, u) {
  if (!durs.length || !(u > 0)) return 1;
  let acc = 0;
  for (const d of durs) {
    let best = Infinity;
    for (const k of [1, 3, 7]) best = Math.min(best, Math.abs(d - k * u) / (k * u));
    acc += best;
  }
  return acc / durs.length;
}

// ============ 摩斯符号序列 → 明文 ============
function decodeMorseSymbols(items) {
  let out = "", cur = "", unknown = 0, letters = 0, words = 0;
  for (const it of items) {
    if (it.kind === "mark") { cur += it.sym; continue; }
    if (it.sym === "elem") continue; // 字符内间隔，不切断
    if (cur) {
      out += (cur in MORSE) ? MORSE[cur] : "?";
      if (!(cur in MORSE)) unknown++;
      letters++;
      cur = "";
    }
    if (it.sym === "word") { out += " "; words++; }
  }
  if (cur) { out += (cur in MORSE) ? MORSE[cur] : "?"; if (!(cur in MORSE)) unknown++; letters++; }
  return { text: out, unknown, letters, words };
}

// 符号序列 → 点划串（诊断展示：字母间空格，词间 /）
function itemsToMorseString(items) {
  const parts = [];
  let cur = "";
  for (const it of items) {
    if (it.kind === "mark") { cur += it.sym; continue; }
    if (it.sym === "elem") continue;
    if (cur) { parts.push(cur); cur = ""; }
    if (it.sym === "word") parts.push("/");
  }
  if (cur) parts.push(cur);
  return parts.join(" ");
}

// ============ Goertzel 主频估计（诊断用，非分类依据） ============
function goertzelMag(sig, start, len, freq, sr) {
  const k = Math.round(len * freq / sr);
  const w = (2 * Math.PI / len) * k;
  const coeff = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let n = 0; n < len; n++) {
    const s0 = sig[start + n] + coeff * s1 - s2;
    s2 = s1; s1 = s0;
  }
  return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2));
}

// 取最长通段估主频；抛物线插值取亚格点精度（诊断值，不参与判决）
function estimateToneFreq(sig, sr, marks, hopSamples) {
  if (!marks.length) return null;
  let best = marks[0];
  for (const m of marks) if (m.ms > best.ms) best = m;
  const start = best.startIdx * hopSamples;
  const len = Math.min(Math.round(sr * 0.4), sig.length - start);
  if (len < 64) return null;
  const fMax = Math.min(3000, sr / 2 * 0.9);
  const step = Math.max(1, sr / len / 2);
  let bf = 0, bm = -1;
  for (let f = 150; f <= fMax; f += step) {
    const m = goertzelMag(sig, start, len, f, sr);
    if (m > bm) { bm = m; bf = f; }
  }
  const m1 = goertzelMag(sig, start, len, bf - step, sr);
  const m2 = goertzelMag(sig, start, len, bf, sr);
  const m3 = goertzelMag(sig, start, len, bf + step, sr);
  const den = m1 - 2 * m2 + m3;
  const delta = den !== 0 ? 0.5 * (m1 - m3) / den : 0;
  const freq = bf + (Number.isFinite(delta) ? clamp(delta, -1, 1) * step : 0);
  return { freq, windowMs: len / sr * 1000 };
}

// ============ 主入口：WAV 字节 → 明文 + 诊断（永不抛异常） ============
function morseWavDecode(input, params) {
  const p = params || {};
  const diag = { stages: [] };
  try {
    let wav;
    try {
      wav = parseWavPcm(input);
    } catch (e) {
      return { ok: false, text: "", morse: "", reason: e.message, diag };
    }
    diag.wav = {
      sampleRate: wav.sampleRate, channels: wav.channels, bits: wav.bits,
      formatName: wav.formatName, frames: wav.frames, durationSec: wav.durationSec,
    };
    const { sig, sampleRate: sr } = wav;
    if (!sig.length) return { ok: false, text: "", morse: "", reason: "音频无采样数据", diag };

    // ① 包络
    const { env, hopMs, winMs, hopSamples } = computeEnvelope(sig, sr);
    if (!env.length) return { ok: false, text: "", morse: "", reason: "音频过短（不足一个分析窗）", diag };
    diag.envelope = { winMs: +winMs.toFixed(3), hopMs: +hopMs.toFixed(3), windows: env.length };

    let envMax = 0, envSum = 0;
    for (const v of env) { if (v > envMax) envMax = v; envSum += v; }
    const envMean = envSum / env.length;
    diag.envelope.max = +envMax.toFixed(6);
    diag.envelope.mean = +envMean.toFixed(6);

    // 全静音守卫
    if (envMax < 1e-5) {
      return { ok: false, text: "", morse: "", reason: "全静音：包络峰值 " + envMax.toExponential(2) + " 低于可检测门限（<1e-5）", diag };
    }

    // ② Otsu 自适应阈值 × 灵敏度
    const sensitivity = clamp(Number(p.threshold) > 0 ? Number(p.threshold) : 1, 0.2, 3);
    const otsu = otsuThreshold(env);
    if (otsu === null) return { ok: false, text: "", morse: "", reason: "包络无动态范围（恒定电平），无法二值化", diag };
    const thr = clamp(otsu * sensitivity, envMax * 1e-6, envMax * 0.999);
    diag.threshold = { otsu: +otsu.toFixed(6), sensitivity, applied: +thr.toFixed(6) };

    // 通断分离度（信噪判据）
    let hiSum = 0, hiN = 0, loSum = 0, loN = 0;
    for (const v of env) { if (v > thr) { hiSum += v; hiN++; } else { loSum += v; loN++; } }
    const muOn = hiN ? hiSum / hiN : 0, muOff = loN ? loSum / loN : 0;
    const sep = muOn > 0 ? (muOn - muOff) / muOn : 0;
    const snrDb = muOff > 1e-9 ? 20 * Math.log10(muOn / muOff) : Infinity;
    diag.modulation = {
      onRatio: +(hiN / env.length).toFixed(4),
      muOn: +muOn.toFixed(6), muOff: +muOff.toFixed(6),
      separation: +sep.toFixed(4),
      snrDb: Number.isFinite(snrDb) ? +snrDb.toFixed(1) : null,
    };

    if (sep < SEP_MIN) {
      return {
        ok: false, text: "", morse: "",
        reason: "未检出通断调制（通断分离度 " + sep.toFixed(3) + " < " + SEP_MIN + "，疑似纯噪声或持续单音）",
        diag,
      };
    }
    const onRatio = hiN / env.length;
    if (onRatio < 0.01 || onRatio > 0.99) {
      return { ok: false, text: "", morse: "", reason: "通断占比异常（导通占比 " + (onRatio * 100).toFixed(1) + "%），无法构成摩斯节奏", diag };
    }

    // ③ 二值化 + 毛刺剔除 → 游程
    const minWins = Math.max(1, Math.round(GLITCH_MS / hopMs));
    const bin = despeckle(binarize(env, thr), minWins);
    let runs = runsFromBinary(bin, hopMs);
    // 去掉首尾静音段（引导静音长度任意，不代表任何间隔）
    while (runs.length && !runs[0].on) runs.shift();
    while (runs.length && !runs[runs.length - 1].on) runs.pop();
    if (!runs.length) return { ok: false, text: "", morse: "", reason: "未检出任何导通段（无摩斯信号）", diag };

    const allDurs = runs.map((r) => r.ms).filter((d) => d > 0);
    const markDurs = runs.filter((r) => r.on).map((r) => r.ms);
    diag.runs = { total: runs.length, marks: markDurs.length, gaps: runs.length - markDurs.length, minWins };

    // ④ 单位时长：参数优先，其次 wpm，最后自适应
    let u = 0, uSource = "自适应";
    const pUnit = Number(p.unit);
    const pWpm = Number(p.wpm);
    if (Number.isFinite(pUnit) && pUnit > 0) { u = pUnit; uSource = "参数 unit"; }
    else if (Number.isFinite(pWpm) && pWpm > 0) { u = 1200 / pWpm; uSource = "参数 wpm(PARIS)"; }
    else {
      const est = estimateUnit(allDurs);
      if (!est || !(est.unitMs > 0)) return { ok: false, text: "", morse: "", reason: "无法估计单位时长（游程数据不足）", diag };
      u = est.unitMs; uSource = est.singleCluster ? "自适应（单簇，存疑）" : "自适应";
      diag.unitEstimate = {
        shortCentroid: +est.shortCentroid.toFixed(3),
        longCentroid: +est.longCentroid.toFixed(3),
        ratio: +est.ratio.toFixed(3),
        singleCluster: est.singleCluster,
      };
    }
    if (!(u >= UNIT_MIN_MS && u <= UNIT_MAX_MS)) {
      return { ok: false, text: "", morse: "", reason: "单位时长 " + u.toFixed(1) + " ms 超出合理范围（" + UNIT_MIN_MS + "–" + UNIT_MAX_MS + " ms）", diag };
    }
    const unitMs = u;
    const wpm = 1200 / unitMs;
    diag.timing = { unitMs: +unitMs.toFixed(3), wpm: +wpm.toFixed(2), source: uSource };

    // ⑤ 分类 + 解码
    const { marks, gaps, items } = classifyRuns(runs, unitMs);
    const counts = {
      dot: marks.filter((m) => m.type === "dot").length,
      dash: marks.filter((m) => m.type === "dash").length,
      elemGap: gaps.filter((g) => g.type === "elem").length,
      letterGap: gaps.filter((g) => g.type === "letter").length,
      wordGap: gaps.filter((g) => g.type === "word").length,
    };
    const dec = decodeMorseSymbols(items);
    const morse = itemsToMorseString(items);
    if (!dec.letters) return { ok: false, text: "", morse, reason: "未解出任何摩斯字符", diag };

    // 主频（诊断）
    const tone = estimateToneFreq(sig, sr, marks, hopSamples);
    if (tone) diag.tone = { freqHz: +tone.freq.toFixed(2), windowMs: +tone.windowMs.toFixed(1) };

    // ⑥ 置信度 = 0.45·通断分离度 + 0.35·时间格拟合 + 0.20·码表命中率
    const residual = gridResidual(allDurs, unitMs);
    const fit = clamp(1 - residual, 0, 1);
    const coverage = dec.letters ? 1 - dec.unknown / dec.letters : 0;
    let confidence = 0.45 * clamp(sep, 0, 1) + 0.35 * fit + 0.20 * coverage;
    if (diag.unitEstimate && diag.unitEstimate.singleCluster) confidence *= 0.6;
    confidence = clamp(confidence, 0, 1);
    diag.counts = counts;
    diag.decoded = { letters: dec.letters, words: dec.words, unknown: dec.unknown };
    diag.quality = { gridResidual: +residual.toFixed(4), coverage: +coverage.toFixed(4), confidence: +confidence.toFixed(3) };

    const warns = [];
    if (diag.unitEstimate && diag.unitEstimate.ratio > 0 && (diag.unitEstimate.ratio < 1.8 || diag.unitEstimate.ratio > 5.5)) {
      warns.push("长短游程比 " + diag.unitEstimate.ratio.toFixed(2) + " 偏离 ITU 的 3 倍关系，点划判定可能不稳");
    }
    if (dec.unknown > 0) warns.push("有 " + dec.unknown + " 个码不在 ITU 码表中（已输出 ?）");
    if (sep < 0.4) warns.push("通断分离度偏低，建议核对录音底噪");
    if (warns.length) diag.warnings = warns;

    return { ok: true, text: dec.text, morse, reason: "", diag };
  } catch (e) {
    return { ok: false, text: "", morse: "", reason: "解析异常: " + (e && e.message ? e.message : String(e)), diag };
  }
}

// ============ 诊断信息 → 文本块 ============
function formatMorseWavDiag(res) {
  const d = res.diag || {};
  const L = [];
  if (!res.ok) {
    L.push("摩斯音频解析失败: " + (res.reason || "未知原因"));
  }
  if (d.wav) {
    L.push("音频: " + d.wav.sampleRate + " Hz / " + d.wav.bits + " bit / " + d.wav.channels + " ch / "
      + d.wav.formatName + " / " + d.wav.durationSec.toFixed(3) + " s");
  }
  if (d.timing) L.push("单位时长: " + d.timing.unitMs.toFixed(1) + " ms（≈ " + d.timing.wpm.toFixed(1) + " WPM，来源: " + d.timing.source + "）");
  if (d.counts) {
    L.push("点 " + d.counts.dot + " / 划 " + d.counts.dash
      + " | 元素间隔 " + d.counts.elemGap + " / 字符间隔 " + d.counts.letterGap + " / 词间隔 " + d.counts.wordGap);
  }
  if (d.modulation) {
    L.push("信噪判据: 通断分离度 " + d.modulation.separation + " / 通态均值 " + d.modulation.muOn
      + " / 断态均值 " + d.modulation.muOff
      + (d.modulation.snrDb !== null ? " / 包络 SNR " + d.modulation.snrDb + " dB" : " / 包络 SNR ∞"));
  }
  if (d.tone) L.push("主频估计: ≈ " + d.tone.freqHz + " Hz");
  if (d.quality) L.push("置信度: " + d.quality.confidence + "（时间格残差 " + d.quality.gridResidual + "，码表命中 " + (d.quality.coverage * 100).toFixed(1) + "%）");
  if (res.morse) L.push("摩斯: " + res.morse);
  if (d.warnings && d.warnings.length) for (const w of d.warnings) L.push("提示: " + w);
  return L.join("\n");
}

// ============ 编码：明文 → 点划符号 → WAV（16 位单声道 PCM） ============
// 时间结构严格照 ITU-R M.1677-1（点 1 / 划 3 / 元素间隔 1 / 字符间隔 3 / 词间隔 7 单位），
// 与解码侧 classifyRuns 使用的同一套 {1,3,7} 时间格同源，故合成音频必能自解。
const DUR_UNITS = { ".": 1, "-": 3, elem: 1, letter: 3, word: 7 };
const ENC_LEAD_UNITS = 3;   // 前导静音（ITU 未规定；解码侧会剥掉，取 3 单位便于播放）
const ENC_TAIL_UNITS = 7;   // 尾部静音（同上，取 7 单位）

/** 输入是否已是点划符号串（只含 . - / 与空白，且至少有一个点划） */
function looksLikeMorseSymbols(s) {
  const t = String(s == null ? "" : s).trim();
  return /[.\-]/.test(t) && /^[.\-\/\s]+$/.test(t);
}

/** 明文 → 点划符号串（字母间空格、词间 /），与解码侧 itemsToMorseString 同口径 */
function textToMorseSymbols(text) {
  const parts = [];
  const unknown = [];
  for (const token of String(text == null ? "" : text).toUpperCase().split(/\s+/)) {
    if (!token) continue;
    let word = "";
    for (const ch of token) {
      const sym = MORSE_REV[ch];
      if (sym) word += (word ? " " : "") + sym;
      else unknown.push(ch);
    }
    if (word) parts.push(word);
  }
  return { morse: parts.join(" / "), unknown };
}

/** 点划符号串 → 事件序列（与解码侧 items 同构，供合成与回环核对） */
function morseSymbolsToItems(morse) {
  const items = [];
  const words = String(morse == null ? "" : morse).trim().split(/\s*\/\s*/);
  let wordSeen = 0;
  for (const w of words) {
    const letters = w.trim().split(/\s+/).filter(Boolean);
    if (!letters.length) continue;
    if (wordSeen++) items.push({ kind: "gap", sym: "word" });
    let letterSeen = 0;
    for (const letter of letters) {
      const syms = [...letter].filter((c) => c === "." || c === "-");
      if (!syms.length) continue;
      if (letterSeen++) items.push({ kind: "gap", sym: "letter" });
      let markSeen = 0;
      for (const s of syms) {
        if (markSeen++) items.push({ kind: "gap", sym: "elem" });
        items.push({ kind: "mark", sym: s });
      }
    }
  }
  return items;
}

/** 事件序列 → WAV 字节（整数 PCM 16 位单声道，与解码侧支持格式对齐） */
function synthesizeMorseWav(items, opts) {
  const u = opts.unitMs, sr = opts.sampleRate, amp = opts.amp;
  const segs = [{ on: false, n: Math.round(ENC_LEAD_UNITS * u / 1000 * sr) }];
  for (const it of items) {
    segs.push({ on: it.kind === "mark", n: Math.round(DUR_UNITS[it.sym] * u / 1000 * sr) });
  }
  segs.push({ on: false, n: Math.round(ENC_TAIL_UNITS * u / 1000 * sr) });
  let total = 0;
  for (const s of segs) total += s.n;
  if (!total) total = 1;

  const dataBytes = total * 2;
  const buf = new Uint8Array(44 + dataBytes);
  const dv = new DataView(buf.buffer);
  const wr4 = (off, s) => { for (let i = 0; i < 4; i++) buf[off + i] = s.charCodeAt(i); };
  wr4(0, "RIFF");
  dv.setUint32(4, 36 + dataBytes, true);
  wr4(8, "WAVE");
  wr4(12, "fmt ");
  dv.setUint32(16, 16, true);      // fmt 块大小
  dv.setUint16(20, 1, true);       // 整数 PCM
  dv.setUint16(22, 1, true);       // 单声道
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 2, true);  // 字节率
  dv.setUint16(32, 2, true);       // 块对齐
  dv.setUint16(34, 16, true);      // 位深
  wr4(36, "data");
  dv.setUint32(40, dataBytes, true);

  // 余弦升降沿：削掉通段首尾突变，避免「咔哒」声（不影响 {1,3,7} 时间格）
  // 硬约束：升降沿不得吃掉导通平台——每段实际升降沿不超过**单位时长的 1/4**。
  // 否则最短的点（1 单位）会被削成三角形，包络阈值切在半坡上，实测通段只剩一半宽
  // （u=60ms 时 63.8ms → 31.3ms），解码侧会把 1 单位误判成 0.5 单位、整段解错。
  const rampMs = Math.min(opts.rampMs, u / 4);
  const rampN = Math.max(0, Math.round(rampMs / 1000 * sr));
  let pos = 0;
  for (const seg of segs) {
    const n = seg.n;
    if (seg.on) {
      const r = Math.min(rampN, Math.floor(n / 2));
      for (let i = 0; i < n; i++) {
        let env = 1;
        if (r > 0) {
          if (i < r) env = 0.5 - 0.5 * Math.cos(Math.PI * i / r);
          else if (i >= n - r) env = 0.5 - 0.5 * Math.cos(Math.PI * (n - 1 - i) / r);
        }
        const v = clamp(amp * env * Math.sin(2 * Math.PI * opts.freq * (i / sr)), -1, 1);
        dv.setInt16(44 + (pos + i) * 2, clamp(Math.round(v * 32767), -32768, 32767), true);
      }
    }
    pos += n;
  }
  return buf;
}

// ============ 解码后自动再解一层（参考用，不改变原结果） ============
// 复用一键解码引擎（同一事实源，不另写一套猜测规则）：只跑 1 层、限时、限量。
// 取候选的规则：只保留置信度接近最佳的那一档（最佳 − 0.15 以内，且不低于 0.5）。
// 理由：引擎会为同一输入排出一长串低分猜测（城市哈希、四方密码…），全列出来只是噪声；
// 真题里 base32 置信 0.92、次名 0.68，按此规则只剩 base32 一条，正是「再解一层」的答案。
const FOLLOWUP_TIMEOUT_MS = 4000;
const FOLLOWUP_MAX = 3;
const FOLLOWUP_REL_DROP = 0.15;
const FOLLOWUP_MIN_CONF = 0.5;

function opLabel(id) {
  const hit = OPS.find((o) => o.id === id);
  return hit ? hit.name : String(id);
}

async function followupReference(text, enabled) {
  if (!enabled) return "";
  const s = String(text == null ? "" : text).trim();
  if (s.length < 2 || s.length > 4096) return "";
  const guard = (p) => Promise.race([
    p,
    new Promise((_r, rej) => setTimeout(() => rej(new Error("FOLLOWUP_TIMEOUT")), FOLLOWUP_TIMEOUT_MS)),
  ]);
  let got;
  try {
    const mod = await guard(import("./magic/magic.js"));
    got = await guard(mod.magicDecode(s, { maxDepth: 1, maxCandidates: 8, intensive: false, paramScan: false }));
  } catch {
    return "";   // 引擎不可用/超时：静默降级，绝不影响解码结果本身
  }
  const cands = (Array.isArray(got) ? got : []).filter((c) => {
    if (!c || !c.result) return false;
    if (!Array.isArray(c.chain) || !c.chain.filter(Boolean).length) return false;
    const out = String(c.result).replace(/\s+/g, " ").trim();
    return out.length > 0 && out !== s;
  });
  if (!cands.length) return "";
  const top = Number(cands[0].confidence);
  const floor = Number.isFinite(top) ? Math.max(FOLLOWUP_MIN_CONF, top - FOLLOWUP_REL_DROP) : FOLLOWUP_MIN_CONF;
  const lines = [];
  for (const c of cands) {
    const conf = Number(c.confidence);
    if (Number.isFinite(conf) && conf < floor) continue;
    const chain = c.chain.filter(Boolean).map(opLabel).join(" → ");
    const out = String(c.result).replace(/\s+/g, " ").trim().slice(0, 120);
    lines.push(chain + " → " + out + (Number.isFinite(conf) ? "（置信 " + conf.toFixed(2) + "）" : ""));
    if (lines.length >= FOLLOWUP_MAX) break;
  }
  if (!lines.length) return "";
  return "\n\n--- 参考：明文再解一层（由一键解码排序，仅供参考，不改变上面的结果）---\n"
    + lines.join("\n");
}

// ---- 文本输入 → 字节（base64 / hex，照 dtmfWav.js 的输入约定）----
function toBytes(text) {
  const s = String(text == null ? "" : text).trim().replace(/\s+/g, "");
  if (!s) throw new Error("输入为空");
  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 && s.length >= 8) {
    const o = new Uint8Array(s.length / 2);
    for (let i = 0; i < s.length; i += 2) o[i / 2] = parseInt(s.slice(i, i + 2), 16);
    return o;
  }
  let b = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  let bin;
  try {
    bin = (typeof atob !== "undefined") ? atob(b) : Buffer.from(b, "base64").toString("binary");
  } catch {
    throw new Error("输入既非 WAV 十六进制也非合法 base64");
  }
  const o = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
  return o;
}

// ---- op 入口（decode 向）：支持 rawBytes（拖文件）或 base64/hex 文本 ----
async function morseWavOpDecode(text, p) {
  const params = p || {};
  let bytes;
  try {
    bytes = (params.rawBytes && params.rawBytes.length)
      ? toU8(params.rawBytes instanceof Uint8Array ? params.rawBytes : new Uint8Array(params.rawBytes))
      : toBytes(text);
  } catch (e) {
    return "摩斯音频解析失败: " + e.message;
  }
  const res = morseWavDecode(bytes, params);
  const showDiag = params.diag === undefined ? true : !!params.diag;
  if (!res.ok) return formatMorseWavDiag(res);
  // 展示层（诊断 + 再解一层参考）整体由 diag 控制：关掉 diag 即返回**纯结果**，
  // 配方链/脚本一律走 diag:false，所以新增参考块不产生任何新的链上破坏面。
  if (!showDiag) return res.text;
  const wantFollowup = params.followup === undefined ? true : !!params.followup;
  return res.text + "\n\n--- 诊断 ---\n" + formatMorseWavDiag(res)
    + await followupReference(res.text, wantFollowup);
}

// ---- op 入口（encode 向）：明文或点划串 → WAV base64 + morse.wav 下载产物 ----
function morseWavOpEncode(text, p) {
  const params = p || {};
  const raw = String(text == null ? "" : text);
  if (!raw.trim()) return "摩斯音频编码失败: 输入为空";
  const pUnit = Number(params.unit), pWpm = Number(params.wpm);
  let unitMs = 60;                                   // 默认 20 WPM（PARIS：单位 = 1200/WPM）
  if (Number.isFinite(pUnit) && pUnit > 0) unitMs = pUnit;
  else if (Number.isFinite(pWpm) && pWpm > 0) unitMs = 1200 / pWpm;
  if (!(unitMs >= UNIT_MIN_MS && unitMs <= UNIT_MAX_MS)) {
    return "摩斯音频编码失败: 单位时长 " + unitMs.toFixed(1) + " ms 超出合理范围（"
      + UNIT_MIN_MS + "–" + UNIT_MAX_MS + " ms）";
  }
  const pFreq = Number(params.freq), pSr = Number(params.sr), pAmp = Number(params.amp);
  const freq = clamp(Number.isFinite(pFreq) && pFreq > 0 ? pFreq : 800, 50, 12000);
  const sampleRate = Math.round(clamp(Number.isFinite(pSr) && pSr > 0 ? pSr : 8000, 2000, 96000));
  if (freq >= sampleRate / 2) {
    return "摩斯音频编码失败: 音调 " + freq + " Hz 达到/超过奈奎斯特上限（采样率 " + sampleRate + " Hz）";
  }
  const amp = clamp(Number.isFinite(pAmp) && pAmp > 0 ? pAmp : 0.35, 0.02, 0.95);
  const pRamp = Number(params.rampMs);
  const rampMs = clamp(Number.isFinite(pRamp) && pRamp >= 0 ? pRamp : 5, 0, 50);

  let morse, unknown = [];
  if (looksLikeMorseSymbols(raw)) {
    morse = raw.trim().replace(/\s+/g, " ").replace(/\s*\/\s*/g, " / ");
  } else {
    const r = textToMorseSymbols(raw);
    morse = r.morse;
    unknown = r.unknown;
  }
  if (!morse) {
    return "摩斯音频编码失败: 输入无可编码字符（只支持 A-Z / 0-9 与 ITU 标点；"
      + "已是点划串也可直接编码）";
  }
  // 有不可编码字符就明确报错，不做静默丢弃（与 bytesIo 的「不静默丢字节」同一条底线）
  if (unknown.length) {
    const shown = [...new Set(unknown)].slice(0, 12).join(" ");
    return "摩斯音频编码失败: 有 " + unknown.length + " 个字符不在 ITU 码表中（" + shown
      + "），已拒绝整段编码以免静默丢字。可先删除这些字符，或改用已是点划串的输入。";
  }
  const items = morseSymbolsToItems(morse);
  if (!items.length) return "摩斯音频编码失败: 未解析出任何点划符号";
  const bytes = synthesizeMorseWav(items, { unitMs, freq, sampleRate, amp, rampMs });
  return {
    text: bytesToB64(bytes),
    files: [{ name: "morse.wav", mime: "audio/wav", bytes }],
  };
}

// ============ 注册 ============
register({
  id: "morseWav",
  cat: "audio",
  name: "摩斯音频编解码",
  desc: "摩斯电码音频（WAV）双向（ITU-R M.1677-1）。"
    + "encode: 明文或点划串 → 按 1/3/7 单位时间格合成 16 位单声道 WAV（base64 + 可下载 morse.wav），"
    + "音调/采样率/幅度/升降沿可调；decode: WAV 音频 → 包络检测 → Otsu 自适应阈值 → 点划自适应分类 → 明文。"
    + "解码支持整数 PCM 8/16/24/32 位、IEEE float 32/64 位、µ-law、单/多声道、任意采样率；"
    + "单位时长自适应估计，可被 unit(ms) 或 wpm(PARIS) 覆盖；输出含点划计数、信噪判据与置信度，"
    + "并附「明文再解一层」参考（复用一键解码引擎跑一层，不改变原结果）。",
  params: [
    { key: "unit", label: "单位时长(ms)", type: "number", default: 0, placeholder: "0 = 解码自适应 / 编码默认 60；>0 强制指定" },
    { key: "wpm", label: "速度(WPM)", type: "number", default: 0, placeholder: "0 = 不用；>0 优先于 unit（PARIS: 单位 = 1200/WPM）" },
    { key: "freq", label: "音调(Hz)", type: "number", default: 800, placeholder: "50-12000（仅 encode）" },
    { key: "sr", label: "采样率(Hz)", type: "number", default: 8000, placeholder: "2000-96000（仅 encode）" },
    { key: "amp", label: "幅度", type: "number", default: 0.35, placeholder: "0.02-0.95（仅 encode）" },
    { key: "rampMs", label: "升降沿(ms)", type: "number", default: 5, placeholder: "0-50（仅 encode，削「咔哒」声；实际不超过单位时长的 1/4）" },
    { key: "threshold", label: "自适应灵敏度", type: "number", default: 1, placeholder: "0.2-3.0（仅 decode，越小越灵敏）" },
    { key: "followup", label: "附「再解一层」参考", type: "bool", default: true, placeholder: "仅 decode；属展示层，关掉「附加诊断信息」即一并关闭" },
    { key: "diag", label: "附加诊断信息", type: "bool", default: true, placeholder: "仅 decode" },
  ],
  encode: morseWavOpEncode,
  decode: morseWavOpDecode,
  acceptsBytes: true,
});

export {
  morseWavDecode, morseWavOpDecode, morseWavOpEncode, parseWavPcm, computeEnvelope, otsuThreshold,
  estimateUnit, classifyRuns, decodeMorseSymbols, runsFromBinary, formatMorseWavDiag,
  textToMorseSymbols, morseSymbolsToItems, synthesizeMorseWav, looksLikeMorseSymbols,
  followupReference, MORSE, MORSE_REV,
};
