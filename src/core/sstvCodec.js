// sstvCodec.js — SSTV（慢扫描电视）Martin M1 / Robot36 双向编解码内核（纯 JS DSP，pySSTV 逐条对齐）。
//
// ── 规范来源（发射侧逐条对齐） ──────────────────────────────────────────────
// [1] pySSTV（MIT，https://github.com/dnet/pySSTV，_vendor/pySSTV-master）：
//    常量 FREQ_BLACK=1500 / FREQ_WHITE=2300 / FREQ_SYNC=1200 / FREQ_VIS_START=1900 /
//    VIS 位频 1100(1)/1300(0)、VIS 时序 300ms 领头 + 10ms 断开 + 300ms 领头 +
//    起始位 30ms(1200) + 7 数据位 30ms(LSB first) + 奇校验位 30ms + 停止位 30ms(1200)；
//    像素值→频率 byte_to_freq(v) = 1500 + 800·v/255；
//    Martin M1：每行 行同步(1200,4.862ms) → 绿前肩(1500,0.572) → G 146.432 → 0.572 →
//    B 146.432 → 0.572 → R 146.432 → 0.572（色序 G,B,R；行 445.874ms，320×256，VIS=0x2c）；
//    Robot36：每行 行同步(1200,9ms) → 同步后肩(1500,3ms) → Y 88ms → 通道间隔
//    (偶行 1500/奇行 2300, 4.5ms) → 肩(1900,1.5ms) → C 44ms（行 150ms，320×240，VIS=0x08；
//    channel=2-(line%2)，偶行 C=p[2]=Cr、奇行 C=p[1]=Cb，p 为 PIL YCbCr 元组）。
// [2] PIL/Pillow 色彩空间：Robot36 色度与 pySSTV 一致采用 PIL convert('YCbCr') 的
//    ITU-R BT.601 全范围（JPEG/JFIF 系数）定点整数实现，本文件按 libImaging/ConvertYCbCr.c
//    的 FIX()/ONE_HALF/>>16 整数口径逐位镜像（含越界截断），保证与 pySSTV 输入侧可交换。
//    解码端 YCbCr→RGB 同用 PIL 定点口径；跨实现色彩误差见验证报告。
//
// ── 解码算法（接收侧自研，非 Qt 移植） ─────────────────────────────────────
// ① 正交下变频：z[n] = s[n]·e^{-j2π·1700·n/fs}（1700 = 1100..2300 频带中心）；
// ② 复低通 FIR（Hamming 窗 sinc，截止按通带 ±700Hz / 镜像 ≥2800Hz 自适应设计），
//    多相抽取 D=max(1,floor(fs/11025)) → 复基带采样率 ≈ ≤11025Hz；
// ③ FM 鉴频：f[n] = 1700 + angle(z[n]·conj(z[n-1]))·fs2/(2π)，限幅 [900,2600]，
//    5 点中值滤波去尖峰；
// ④ 头部：在瞬时频率流上找 1900Hz 领头段(≥220ms) → 10ms 断开 → 第二领头 →
//    起始位(1200 ≥15ms) → 8×30ms 位窗（中心 60% 取均值，1100/1300 最近邻判决）→
//    停止位校验 → 奇校验校验；
// ⑤ 逐行再同步：每行在预测位置 ±15ms 内找 <1380Hz 且 ≥2.5ms 的行同步游程，
//    行间测得时钟比 ρ（EMA 平滑），像素时长随 ρ 缩放 → 抗收发时钟 ±2% 频偏；
// ⑥ 像素值：像素窗中心段瞬时频率均值 → (f-1500)/800·255 截断取整。
//  设计判据：行同步 1200Hz 与像素最低频 1500Hz 相隔 300Hz，阈值 1380+游程时长双条件
//  可区分；VIS 位 1300Hz 只出现在头部（图像区不含），不影响行同步判定。
//
// ── 输出契约 ───────────────────────────────────────────────────────────────
// encodeSSTV(mode, img, rate, bits) -> { rate, bits, mode, vis, durationMs, wav, samples }
// decodeSSTV(wavBytes) -> { ok:false, error } | { ok:true, vis, mode, image:{width,height,data},
//    info:{ rate, decimatedRate, parityOk, stopOk, clockRatio, syncFound, syncMiss, visBits } }
// 失败永不抛异常（非 WAV / 压缩 fmt / 未实现 VIS / 同步丢失过多均显式报错）。
//
// ── 边界（显式声明） ───────────────────────────────────────────────────────
// · 只实现 Martin M1(VIS 0x2c) 与 Robot36(VIS 0x08)；其它 VIS 显式拒绝，不静默。
// · WAV 侧只收整数 PCM（fmt tag 1 或 0xFFFE 子格式 1；8/16/24/32bit）；IEEE float、
//  ADPCM 等压缩 fmt 显式拒绝；非 RIFF/WAVE 显式拒绝；采样率 <6000 拒绝（2300Hz 奈奎斯特）。
// · 多声道取第 0 声道（SSTV 为单声道，立体声副本无信息）。
// · encode 输入必须恰为模式尺寸（320×256 / 320×240），不做缩放（缩放属 UI 层职责）。
//
/* ================= 常量（pySSTV sstv.py 逐条对齐） ================= */
const FREQ_BLACK = 1500, FREQ_WHITE = 2300, FREQ_SYNC = 1200, FREQ_VIS_START = 1900;
const FREQ_VIS_BIT1 = 1100, FREQ_VIS_BIT0 = 1300;
const MSEC_VIS_START = 300, MSEC_VIS_SYNC = 10, MSEC_VIS_BIT = 30;
const FREQ_RANGE = FREQ_WHITE - FREQ_BLACK; // 800
const LOW_CUT = 1700;          // 下变频中心（1100..2300 的中点）
const BAND_LO = 1100, BAND_HI = 2300; // 鉴频后有效频带

const byteToFreq = (v) => FREQ_BLACK + FREQ_RANGE * v / 255;
const freqToByte = (f) => Math.max(0, Math.min(255, Math.round((f - FREQ_BLACK) / FREQ_RANGE * 255)));

const MODES = {
  "Martin M1": {
    vis: 0x2c, width: 320, height: 256, type: "rgb",
    sync: 4.862, scan: 146.432, gap: 0.572,
    colorSeq: ["G", "B", "R"], porchBeforeGreen: true, // pySSTV：仅绿通道前有 1500 前肩
    lineMs: 4.862 + 3 * 146.432 + 4 * 0.572, // 446.446（绿前 1 肩 + 三通道各 1 后肩）
  },
  "Robot36": {
    vis: 0x08, width: 320, height: 240, type: "ycbcr",
    sync: 9, syncPorch: 3, yScan: 88, cScan: 44, interChGap: 4.5, porch: 1.5,
    interChFreqs: [0, FREQ_WHITE, FREQ_BLACK], // pySSTV INTER_CH_FREQS；channel=2-(line%2)
    lineMs: 9 + 3 + 88 + 4.5 + 1.5 + 44, // 150
  },
};

const VIS_TO_MODE = {};
for (const [name, m] of Object.entries(MODES)) VIS_TO_MODE[m.vis] = name;
const MODE_ALIASES = {
  "martin m1": "Martin M1", martin1: "Martin M1", martinm1: "Martin M1",
  robot36: "Robot36", "robot 36": "Robot36",
};

/* ================= 色彩空间：BT.601 全范围（JPEG/JFIF），16bit 定点 =================
 * Robot36 色度采用与 pySSTV 输入侧（PIL convert('YCbCr')）同一 BT.601 全范围系数
 * （Y=0.299R+0.587G+0.114B；Cb=-0.168736R-0.331264G+0.5B+128；Cr=0.5R-0.418688G-0.081312B+128）。
 * Pillow 实际实现（libImaging/ConvertYCbCr.c）是 6bit 查表 + >>6 截断，与本处 16bit
 * 定点 round-half-up 差 ≤1/通道（见验证 C29：20 万随机色实测无 Δ≥2）；本 op 编解码
 * 自用同一套公式，自往返零色彩基线误差。 */
const FIX = (x) => Math.floor(x * 65536 + 0.5) | 0;
const F_0299 = FIX(0.299), F_0587 = FIX(0.587), F_0114 = FIX(0.114);
const F_0168736 = FIX(0.168735892), F_0331264 = FIX(0.331264108), F_05 = FIX(0.5);
const F_0418688 = FIX(0.418687589), F_0081312 = FIX(0.081312411);
const F_1402 = FIX(1.402), F_0344136 = FIX(0.344136286), F_0714136 = FIX(0.714136286), F_1772 = FIX(1.772);

/** RGB → (Y, Cb, Cr)，BT.601 全范围 16bit 定点（与 Pillow 查表实现差 ≤1/通道）。 */
function rgbToYcbcr(r, g, b) {
  const y = (F_0299 * r + F_0587 * g + F_0114 * b + 32768) >> 16;
  const cb = ((-F_0168736 * r - F_0331264 * g + F_05 * b + 32768) >> 16) + 128;
  const cr = ((F_05 * r - F_0418688 * g - F_0081312 * b + 32768) >> 16) + 128;
  return [y, cb, cr];
}
/** (Y, Cb, Cr) → RGB（越界截断 0..255；与 Pillow 查表实现差 ≤1/通道）。 */
function ycbcrToRgb(y, cb, cr) {
  const cbv = cb - 128, crv = cr - 128;
  const r = y + ((F_1402 * crv + 32768) >> 16);
  const g = y - ((F_0344136 * cbv + F_0714136 * crv + 32768) >> 16);
  const b = y + ((F_1772 * cbv + 32768) >> 16);
  return [r < 0 ? 0 : r > 255 ? 255 : r, g < 0 ? 0 : g > 255 ? 255 : g, b < 0 ? 0 : b > 255 ? 255 : b];
}

/* ================= WAV 读写（16-bit 主路径；读侧兼容 8/16/24/32 整数 PCM） ================= */
const ascii4 = (bytes, o) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
const u16le = (b, o) => b[o] | (b[o + 1] << 8);
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const i16le = (b, o) => { const v = u16le(b, o); return (v ^ 0x8000) - 0x8000; };
const i24le = (b, o) => { const v = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); return (v ^ 0x800000) - 0x800000; };
const i32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) | 0;

/**
 * WAV → 单声道 float 样本。口径 = audiostego.parseWav + readPcmSamples：
 * 遍历 chunk 找 fmt/data；只收整数 PCM（tag 1 或 0xFFFE 子格式 1）；
 * 8bit 无符号（居中），16/24/32bit 有符号 LE；多声道取第 0 声道。
 * 返回 { rate, samples: Float32Array(-1..1), bits, channels }；失败抛 Error（decode 外层兜底）。
 */
function readWavMono(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error("输入不是字节序列");
  if (bytes.length < 12 || ascii4(bytes, 0) !== "RIFF") throw new Error("不是 WAV（RIFF 头缺失）");
  if (ascii4(bytes, 8) !== "WAVE") throw new Error("RIFF 类型非 WAVE");
  let fmt = null, data = null;
  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = ascii4(bytes, off), size = u32le(bytes, off + 4), dOff = off + 8;
    if (id === "fmt " && dOff + 16 <= bytes.length) {
      fmt = {
        formatTag: u16le(bytes, dOff), channels: u16le(bytes, dOff + 2),
        sampleRate: u32le(bytes, dOff + 4), byteRate: u32le(bytes, dOff + 8),
        blockAlign: u16le(bytes, dOff + 12), bitsPerSample: u16le(bytes, dOff + 14),
        subFormat: 0,
      };
      if (fmt.formatTag === 0xfffe && size >= 40 && dOff + 26 <= bytes.length) fmt.subFormat = u16le(bytes, dOff + 24);
    } else if (id === "data") {
      data = { offset: dOff, size: Math.min(size, bytes.length - dOff) };
      if (size === 0 || size > 1 << 30) { data = null; throw new Error("WAV data 块长度非法: " + size); }
    }
    const adv = size + (size & 1);
    if (adv <= 0) break;
    off = dOff + adv;
  }
  if (!fmt) throw new Error("WAV 缺 fmt 块");
  if (!data) throw new Error("WAV 缺 data 块");
  const tag = fmt.formatTag === 0xfffe ? fmt.subFormat : fmt.formatTag;
  if (tag !== 1) {
    throw new Error("仅支持整数 PCM WAV（fmt tag=0x" + fmt.formatTag.toString(16) +
      (fmt.formatTag === 0xfffe ? " 子格式 0x" + fmt.subFormat.toString(16) : "") + "，压缩/浮点格式显式拒绝）");
  }
  if (![8, 16, 24, 32].includes(fmt.bitsPerSample)) throw new Error("不支持的位深 " + fmt.bitsPerSample + " bit");
  if (!(fmt.sampleRate >= 6000 && fmt.sampleRate <= 384000)) {
    throw new Error("采样率 " + fmt.sampleRate + " Hz 超出可解范围（需 6000-384000）");
  }
  const ch = Math.max(1, fmt.channels), bps = fmt.bitsPerSample >> 3;
  const frames = Math.floor(data.size / (bps * ch));
  const out = new Float32Array(frames);
  const scale = fmt.bitsPerSample === 8 ? 128 : Math.pow(2, fmt.bitsPerSample - 1);
  const p0 = data.offset;
  for (let i = 0; i < frames; i++) {
    const p = p0 + i * ch * bps; // 第 0 声道（SSTV 单声道）
    let v;
    if (fmt.bitsPerSample === 8) v = bytes[p] - 128;
    else if (fmt.bitsPerSample === 16) v = i16le(bytes, p);
    else if (fmt.bitsPerSample === 24) v = i24le(bytes, p);
    else v = i32le(bytes, p);
    out[i] = v / scale;
  }
  return { rate: fmt.sampleRate, samples: out, bits: fmt.bitsPerSample, channels: ch };
}

/** float 样本 → 16bit（或 8bit）单声道 WAV 字节（与 audiostego.buildWav 44 字节头同构）。 */
function writeWav(samples, rate, bits = 16) {
  const n = samples.length, bps = bits >> 3, dataSize = n * bps;
  const out = new Uint8Array(44 + dataSize);
  const dv = new DataView(out.buffer);
  const put = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  put(0, "RIFF"); dv.setUint32(4, 36 + dataSize, true); put(8, "WAVE");
  put(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * bps, true);
  dv.setUint16(32, bps, true); dv.setUint16(34, bits, true);
  put(36, "data"); dv.setUint32(40, dataSize, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    if (bits === 8) out[44 + i] = Math.max(0, Math.min(255, Math.round((s + 1) * 127.5)));
    else dv.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

/* ================= 编码器（发射侧，逐条对齐 pySSTV） ================= */
/** VIS 头 (freq,msec) 序列：300 领头 / 10 断开 / 300 领头 / 30 起始位 / 7 数据位(LSB first) /
 *  奇校验位 / 30 停止位 —— 与 pySSTV SSTV.gen_freq_bits 头部逐条一致。 */
function visTuples(vis) {
  const out = [[FREQ_VIS_START, MSEC_VIS_START], [FREQ_SYNC, MSEC_VIS_SYNC],
               [FREQ_VIS_START, MSEC_VIS_START], [FREQ_SYNC, MSEC_VIS_BIT]];
  let v = vis & 0x7f, ones = 0;
  for (let i = 0; i < 7; i++) {
    const bit = v & 1; ones += bit;
    out.push([bit ? FREQ_VIS_BIT1 : FREQ_VIS_BIT0, MSEC_VIS_BIT]); v >>= 1;
  }
  out.push([(ones & 1) ? FREQ_VIS_BIT1 : FREQ_VIS_BIT0, MSEC_VIS_BIT]); // 奇校验
  out.push([FREQ_SYNC, MSEC_VIS_BIT]); // 停止位
  return out;
}

/** 图像 → (freq, msec) 全序列。Martin M1 / Robot36 布局见文件头 [1]。 */
function imageTuples(modeName, img) {
  const m = MODES[modeName];
  const segs = [];
  const px3 = (x, y) => { const i = (y * m.width + x) * 3; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
  if (m.type === "rgb") {
    const CH = { R: 0, G: 1, B: 2 };
    for (let y = 0; y < m.height; y++) {
      segs.push([FREQ_SYNC, m.sync]); // 行同步
      for (const c of m.colorSeq) {
        if (c === "G" && m.porchBeforeGreen) segs.push([FREQ_BLACK, m.gap]); // 绿前肩
        const d = m.scan / m.width;
        for (let x = 0; x < m.width; x++) segs.push([byteToFreq(px3(x, y)[CH[c]]), d]);
        segs.push([FREQ_BLACK, m.gap]); // 通道后肩
      }
    }
  } else { // Robot36（YCbCr）
    for (let y = 0; y < m.height; y++) {
      const channel = 2 - (y % 2); // 偶行=2→Cr 且间隔 1500；奇行=1→Cb 且间隔 2300（pySSTV 口径）
      segs.push([FREQ_SYNC, m.sync]);                          // 行同步 1200Hz/9ms
      segs.push([FREQ_BLACK, m.syncPorch]);                    // 同步后肩
      const yD = m.yScan / m.width;
      for (let x = 0; x < m.width; x++) segs.push([byteToFreq(rgbToYcbcr(...px3(x, y))[0]), yD]);
      segs.push([m.interChFreqs[channel], m.interChGap]);      // 通道间隔（分奇偶）
      segs.push([FREQ_VIS_START, m.porch]);                    // 色度前肩 1900Hz
      const cD = m.cScan / m.width;
      for (let x = 0; x < m.width; x++) segs.push([byteToFreq(rgbToYcbcr(...px3(x, y))[channel]), cD]);
    }
  }
  return segs;
}

/**
 * SSTV 编码（图像 → 音频 WAV）。
 * @param modeName "Martin M1" | "Robot36"（别名小写可）；其它模式显式抛错（未实现）。
 * @param img { width, height, data: Uint8Array(w*h*3) }，必须恰为模式尺寸。
 * 相位连续合成：与 pySSTV gen_values 相同的累计舍入（samples 累加器保小数残差）+
 * 段间相位累积（offset += tx·2πf/fs），仅省去其 ±0.5LSB 抖动噪声（确定性输出）。
 */
function encodeSSTV(modeName, img, rate = 44100, bits = 16) {
  const key = MODE_ALIASES[String(modeName || "").toLowerCase()] || modeName;
  const m = MODES[key];
  if (!m) throw new Error("未实现的 SSTV 模式: " + modeName + "（本 op 仅支持 Martin M1 与 Robot36）");
  if (!img || !img.width || !img.height || !img.data) throw new Error("encode 需要图像 {width,height,data}");
  if (img.width !== m.width || img.height !== m.height) {
    throw new Error("图像尺寸须为 " + m.width + "×" + m.height + "（" + key + "），收到 " + img.width + "×" + img.height +
      "（缩放属 UI 层职责，本核心不做）");
  }
  if (img.data.length < m.width * m.height * 3) throw new Error("图像 data 长度不足（需 " + m.width * m.height * 3 + " 字节 RGB）");
  if (![8, 16].includes(bits)) throw new Error("encode 位深仅支持 8/16 bit（收到 " + bits + "）");
  if (!(rate >= 6000 && rate <= 384000)) throw new Error("采样率 " + rate + " Hz 非法（6000-384000）");

  const segs = [...visTuples(m.vis), ...imageTuples(key, img)];
  const spms = rate / 1000;
  let totalF = 0;
  for (const [, ms] of segs) totalF += ms * spms;
  const out = new Float32Array(Math.ceil(totalF) + 2);
  let pos = 0, acc = 0, offset = 0; // acc: pySSTV 累计样本计数器（保小数）
  for (const [freq, msec] of segs) {
    acc += msec * spms;
    const tx = Math.floor(acc);
    acc -= tx;
    const w = 2 * Math.PI * freq / rate;
    for (let i = 0; i < tx; i++) out[pos + i] = Math.sin(i * w + offset);
    offset += tx * w;
    pos += tx;
  }
  const wav = writeWav(out.subarray(0, pos), rate, bits);
  return { mode: key, vis: m.vis, rate, bits, durationMs: pos / spms, wav, samples: out.subarray(0, pos) };
}

/* ================= 解调前端：下变频 + 低通抽取 + FM 鉴频 ================= */
/** Hamming 窗 sinc 低通系数（截止 cutHz，归一化 DC 增益 1）。 */
function designLPF(fs, passHz, stopHz) {
  const cut = (passHz + stopHz) / 2;             // 过渡带中点作 -6dB 截止
  const n = Math.max(9, Math.ceil(3.3 * fs / (stopHz - passHz)));
  const N = n % 2 ? n : n + 1;
  const M = (N - 1) / 2;
  const h = new Float64Array(N);
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const k = i - M;
    const sinc = k === 0 ? 2 * cut / fs : Math.sin(2 * Math.PI * cut * k / fs) / (Math.PI * k);
    const w = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (N - 1));
    h[i] = sinc * w; sum += h[i];
  }
  for (let i = 0; i < N; i++) h[i] /= sum;
  return { h, N, groupDelay: M };
}

/**
 * 实信号 → 瞬时频率流（Float32Array，Hz，已限幅 [900,2600] + 5 点中值滤波）。
 * 复基带抽取率 fs2 = fs/D，D = max(1, floor(fs/11025))。
 * 流首已扣除 FIR 群延迟（(N-1)/2 → fs2 样本单位）与中值滤波滞后（2 样本）：
 * 返回流的索引 n ≈ 真实时刻 n/fs2，保证由同步锚点推导的像素窗不携带系统性时间偏移
 * （否则整幅图晚 ~0.8ms，末列像素滑进 1500Hz 通道间隔读成黑）。
 * 返回 { f: Float32Array, fs2, delaySamples }。
 */
function instFreqStream(samples, fs) {
  const D = Math.max(1, Math.floor(fs / 11025));
  const fs2 = fs / D;
  // 下变频中心 1700：信号带 ±600 → 通带 ±700；镜像 ≥ 2×1700-2300=1100? 镜像在 ±(f+1700) ∈ [2800,4000]
  const { h, N, groupDelay } = designLPF(fs, 700, 2800);
  const nOut = Math.max(0, Math.floor((samples.length - N) / D));
  const zr = new Float64Array(nOut), zi = new Float64Array(nOut);
  const dw = 2 * Math.PI * LOW_CUT / fs;
  // 多相 FIR：只算被抽取保留的样本（第 0 声道实信号 × e^{-jωn} 后与 h 卷积）
  for (let o = 0; o < nOut; o++) {
    const base = o * D;
    let ar = 0, ai = 0;
    for (let j = 0; j < N; j++) {
      const s = samples[base + j];
      const ph = -dw * (base + j);
      // e^{j·ph} = cos+i·sin；与实样本相乘
      ar += s * Math.cos(ph) * h[j];
      ai += s * Math.sin(ph) * h[j];
    }
    zr[o] = ar; zi[o] = ai;
  }
  // 鉴频 + 限幅 + 中值滤波(5)
  const raw = new Float32Array(nOut);
  const k = fs2 / (2 * Math.PI);
  for (let i = 1; i < nOut; i++) {
    const p = zr[i] * zr[i - 1] + zi[i] * zi[i - 1];   // Re(z·conj(z-1))
    const q = zi[i] * zr[i - 1] - zr[i] * zi[i - 1];   // Im(z·conj(z-1))
    let f = LOW_CUT + Math.atan2(q, p) * k;
    if (f < 900) f = 900; else if (f > 2600) f = 2600;
    raw[i] = f;
  }
  const head = Math.round(groupDelay / D) + 2; // FIR 群延迟 + 中值滤波滞后（fs2 样本单位）
  const len = Math.max(0, nOut - head);
  const f = new Float32Array(len);
  const win = new Float32Array(5);
  for (let i = 0; i < len; i++) {
    const c = i + head;
    let w = 0;
    for (let j = -2; j <= 2; j++) { const t = Math.min(nOut - 1, Math.max(0, c + j)); win[w++] = raw[t]; }
    win.sort();
    f[i] = win[2];
  }
  return { f, fs2, delaySamples: groupDelay };
}

/** 3ms 箱式滑动平均（前缀和实现，头部专用）：逐样本噪声 σ/√N 收缩后再取游程判频。 */
function boxcarSmooth(f, fs2, ms = 3) {
  const w = Math.max(1, Math.round(ms * fs2 / 1000));
  const out = new Float32Array(f.length);
  let acc = 0;
  for (let i = 0; i < f.length; i++) {
    acc += f[i];
    if (i >= w) acc -= f[i - w];
    out[i] = acc / Math.min(i + 1, w);
  }
  return out;
}

/* ================= 头部（VIS）解析 ================= */
/** 在瞬时频率流上找「值满足 cond 的最长游程」：返回全部游程 [{start,end,len}]（样本下标）。 */
function runs(f, pred) {
  const out = [];
  let s = -1;
  for (let i = 0; i < f.length; i++) {
    if (pred(f[i])) { if (s < 0) s = i; }
    else if (s >= 0) { out.push({ start: s, end: i, len: i - s }); s = -1; }
  }
  if (s >= 0) out.push({ start: s, end: f.length, len: f.length - s });
  return out;
}
const near = (f, c, tol) => Math.abs(f - c) <= tol;
const isLeader = (v) => near(v, FREQ_VIS_START, 150); // 1900±150
const isLowSync = (v) => v < 1380;                     // 1200（与像素最低 1500 间隔 120Hz 阈值缓冲）

/**
 * 头部定位 + VIS 解析（在 3ms 平滑流 fhdr 上做游程，区分 1200/1300/1100/1900）。
 * 返回 { vis, parityOk, stopOk, imageStart, visBits } 或 null（未检出头部）。
 * 流程：领头(1900,≥220ms) → 断开(1200,4..40ms) → 第二领头(≥220ms) →
 *       起始位(1200,≥15ms) → 8×30ms 位（中心 60% 均值，1100/1300 最近邻）→ 停止位校验。
 * 判据说明：1200 与 1300 仅差 100Hz，直接逐样本判频不可分 → 头部统一用 3ms 滑动均值
 * （噪声 σ/√N 收缩）后再按 1250Hz 阈值取游程；起始位锚点吸收头部段时偏，位窗内
 * 残余漂移 ±2%×300ms=±6ms，仍处 18ms 中心窗内。
 */
function decodeVis(fhdr, fs2) {
  const spms = fs2 / 1000;
  const ms = (n) => n / spms;
  const leads = runs(fhdr, isLeader).filter((r) => ms(r.len) >= 220);
  if (leads.length < 2) return null;
  const l1 = leads[0];
  // 断开：l1 结束后 60ms 内第一个 <1250Hz 游程（4..40ms）
  const brks = runs(fhdr, (v) => v < 1250)
    .filter((r) => r.start >= l1.end && r.start <= l1.end + 60 * spms && ms(r.len) >= 4 && ms(r.len) <= 40);
  if (!brks.length) return null;
  const l2 = leads.find((r) => r.start >= brks[0].end && ms(r.len) >= 220);
  if (!l2) return null;
  // 起始位：第二领头结束起第一个 1200/1100 游程（≥15ms）。起始位 1200 与数据位 1(1100)
  // 均 <1250Hz 会粘连：VIS 全 1 时粘连最长 = 起始位+7位+校验+停止 = 300ms，故长度上界 330ms。
  const starts = runs(fhdr, (v) => v < 1250)
    .filter((r) => r.start >= l2.end - 2 * spms && r.start <= l2.end + 60 * spms && ms(r.len) >= 15 && ms(r.len) <= 330);
  if (!starts.length) return null;
  const anchor = starts[0].start;           // 起始位实际起点（吸收头部段累计时偏）
  const bitDur = 30 * spms;
  const meanRange = (a, b) => {
    const s = Math.max(0, Math.round(a)), e = Math.min(fhdr.length, Math.round(b));
    if (e <= s) return fhdr[s] || 0;
    let t = 0; for (let i = s; i < e; i++) t += fhdr[i];
    return t / (e - s);
  };
  const visBits = [];
  let vis = 0, ones = 0;
  for (let b = 0; b < 7; b++) {
    const v = meanRange(anchor + (b + 1) * bitDur + 0.2 * bitDur, anchor + (b + 2) * bitDur - 0.2 * bitDur);
    const bit = Math.abs(v - FREQ_VIS_BIT1) < Math.abs(v - FREQ_VIS_BIT0) ? 1 : 0;
    visBits.push(bit); vis |= bit << b; ones += bit; // LSB first
  }
  const pv = meanRange(anchor + 8 * bitDur + 0.2 * bitDur, anchor + 9 * bitDur - 0.2 * bitDur);
  const parityBit = Math.abs(pv - FREQ_VIS_BIT1) < Math.abs(pv - FREQ_VIS_BIT0) ? 1 : 0;
  const parityOk = parityBit === (ones & 1);
  const stopV = meanRange(anchor + 9 * bitDur + 0.2 * bitDur, anchor + 10 * bitDur - 0.2 * bitDur);
  const stopOk = stopV < 1400; // 停止位应为 1200Hz
  return { vis, parityOk, stopOk, visBits, imageStart: anchor + 10 * bitDur };
}

/* ================= 行同步 + 像素解调 ================= */
/** 在 [lo,hi] 样本范围内找 <1380Hz 且 ≥2.5ms 的游程，返回行同步 {start,end}。
 *  锚定策略：备选起点 = 游程末尾 − 名义同步时长（钳到 ≥游程起点）。
 *  原因：第 0 行行同步与 VIS 停止位同为 1200Hz 且首尾相接，粘连成一条长游程，
 *  以「游程起点」为锚会早约一个停止位（~15ms）；「游程尾 − 同步时长」对粘连
 *  （取末段）与干净（≈游程起点）两种情形都落在真同步脉冲上。 */
function findLineSync(f, fs2, lo, hi, expect, syncMs) {
  const spms = fs2 / 1000;
  const minLen = 2.5 * spms;
  lo = Math.max(0, Math.floor(lo)); hi = Math.min(f.length, Math.ceil(hi)); // 整数化（浮点索引取 TypedArray 会得 undefined）
  let best = null, bestD = Infinity;
  let s = -1;
  for (let i = lo; i <= hi; i++) {
    const low = i < hi && isLowSync(f[i]);
    if (low) { if (s < 0) s = i; }
    else if (s >= 0) {
      if (i - s >= minLen) {
        let cand = i - syncMs * spms;
        if (cand < s) cand = s;
        const d = Math.abs(cand - expect);
        if (d < bestD) { bestD = d; best = { start: cand, end: i }; }
      }
      s = -1;
    }
  }
  return best;
}

/** 像素窗中心段均值 → 0..255。t0: 扫描起点（样本）；d: 每像素样本数；frac: 端部收缩比；
 *  fscale: 频率自校准因子（=实测时钟比 ρ）。收发时钟偏 k% 会使全部音频频率按 1/ρ 缩放
 *  （时域压缩 ⇔ 频域放大），像素值 v ∝ (f·ρ − 1500)/800 —— 与真机解码器的频偏校准等价。 */
function demodScanLine(f, t0, d, count, frac = 0.2, fscale = 1) {
  const out = new Uint8Array(count);
  for (let x = 0; x < count; x++) {
    const s = t0 + x * d + d * frac, e = t0 + (x + 1) * d - d * frac;
    const si = Math.max(0, Math.round(s)), ei = Math.min(f.length, Math.round(e));
    let v;
    if (ei <= si) v = f[Math.min(f.length - 1, Math.max(0, Math.round(t0 + (x + 0.5) * d)))] || FREQ_BLACK;
    else {
      let t = 0; for (let i = si; i < ei; i++) t += f[i];
      v = (t / (ei - si)) * fscale;
    }
    out[x] = freqToByte(v);
  }
  return out;
}

/* ================= 解码器（接收侧） ================= */
/**
 * SSTV 解码（音频 WAV → 像素矩阵 + 模式/VIS）。失败返回 { ok:false, error }（不抛异常）。
 * 支持模式：Martin M1 / Robot36；其它 VIS 显式拒绝。
 */
function decodeSSTV(wavBytes) {
  let wav;
  try { wav = readWavMono(wavBytes); }
  catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; }
  const { rate, samples } = wav;
  const N = samples.length;
  if (N < rate * 0.5) return { ok: false, error: "音频过短（<0.5s），不含完整 SSTV 头" };

  const { f, fs2, delaySamples } = instFreqStream(samples, rate);
  const spms = fs2 / 1000; // 复基带样本/ms
  const fhdr = boxcarSmooth(f, fs2, 3);
  const hdr = decodeVis(fhdr, fs2);
  if (!hdr) return { ok: false, error: "未检测到 SSTV 头（未找到 1900Hz 领头段→断开→领头→起始位序列）" };
  const modeName = VIS_TO_MODE[hdr.vis];
  if (!modeName) {
    return { ok: false, error: "未实现的 SSTV 模式（VIS=0x" + hdr.vis.toString(16) + "），本 op 仅支持 Martin M1(0x2c) / Robot36(0x08)，显式拒绝" };
  }
  const m = MODES[modeName];
  const data = new Uint8Array(m.width * m.height * 3);

  // 逐行再同步 + 像素解调
  let rho = 1, syncFound = 0, syncMiss = 0, lineStart = hdr.imageStart; // 基带样本下标
  const lineSamples = m.lineMs * spms;
  const rows = [];
  for (let y = 0; y < m.height; y++) {
    // 预测 = 上一行锁定处 + 时钟比 ρ × 名义行时长（抗收发时钟 ±2% 频偏的核心）；
    // y=0 的行同步就在头部锚点处；未锁定时也按 ρ 推进，避免单行漏锁造成后续全部错位。
    const expect = y === 0 ? lineStart : lineStart + lineSamples * rho;
    const win = 15 * spms; // ±15ms 搜索窗（ρ 残差 <0.5%，窗口余量充足）
    const sync = findLineSync(f, fs2, expect - win, expect + win, expect, m.sync * rho);
    if (sync) {
      if (y > 0) {
        const ratio = (sync.start - lineStart) / lineSamples;
        rho = rho * 0.85 + ratio * 0.15; // EMA 平滑时钟比（y=0 与锚点同源，不参与估计）
      }
      lineStart = sync.start; syncFound++;
    } else {
      syncMiss++;
      lineStart = expect; // 漏锁：按预测推进，下一行继续在窗口内搜
      if (syncMiss > 16 && syncMiss > y / 2) {
        return { ok: false, error: "行同步丢失过多（" + syncMiss + "/" + (y + 1) + " 行），信号不可解" };
      }
    }
    const sp = lineStart; // 本行行同步起点
    if (m.type === "rgb") {
      // 行同步 → (绿前肩 gap) → G → gap → B → gap → R
      let cur = sp + (m.sync + (m.porchBeforeGreen ? m.gap : 0)) * rho * spms;
      const d = (m.scan / m.width) * rho * spms;
      const chans = [];
      for (let ci = 0; ci < m.colorSeq.length; ci++) {
        chans.push(demodScanLine(f, cur, d, m.width, 0.2, rho));
        cur += m.scan * rho * spms + m.gap * rho * spms;
      }
      for (let x = 0; x < m.width; x++) {
        const i = (y * m.width + x) * 3;
        data[i] = chans[2][x]; data[i + 1] = chans[0][x]; data[i + 2] = chans[1][x]; // 色序 G,B,R
      }
    } else { // Robot36
      const yStart = sp + m.sync * rho * spms + m.syncPorch * rho * spms;
      const yd = (m.yScan / m.width) * rho * spms;
      const cStart = yStart + m.yScan * rho * spms + m.interChGap * rho * spms + m.porch * rho * spms;
      const cd = (m.cScan / m.width) * rho * spms;
      const ys = demodScanLine(f, yStart, yd, m.width, 0.15, rho); // Y 窗更短（0.275ms/px），收缩比小
      const cs = demodScanLine(f, cStart, cd, m.width, 0.15, rho);
      const channel = 2 - (y % 2); // 2=偶行 Cr，1=奇行 Cb
      rows[y] = { ys, cs, channel };
      // 色度配对：行对 (2k,2k+1) 共享 —— 偶行缺的 Cb 取下一行，奇行缺的 Cr 取上一行
      const cbRow = channel === 1 ? cs : (rows[y + 1] ? rows[y + 1].cs : cs);
      if (channel === 1) { // 本行就是 Cb 行；Cr 用上一行
        const crPrev = y > 0 ? rows[y - 1].cs : cs;
        for (let x = 0; x < m.width; x++) {
          const [r, g, b] = ycbcrToRgb(ys[x], cs[x], crPrev[x]);
          const i = (y * m.width + x) * 3;
          data[i] = r; data[i + 1] = g; data[i + 2] = b;
        }
      } else {
        // 偶行：Cr=本行 cs；Cb 需下一行 —— 先占位，处理完 y+1 奇行后统一回填
        for (let x = 0; x < m.width; x++) {
          const [r, g, b] = ycbcrToRgb(ys[x], cs[x], cs[x]); // 占位（Cb=Cr）
          const i = (y * m.width + x) * 3;
          data[i] = r; data[i + 1] = g; data[i + 2] = b;
        }
      }
      // 奇行处理完 → 回填上一偶行（用本行 Cb）
      if (channel === 1 && y > 0 && rows[y - 1].channel === 2) {
        const ev = rows[y - 1];
        for (let x = 0; x < m.width; x++) {
          const [r, g, b] = ycbcrToRgb(ev.ys[x], cs[x], ev.cs[x]);
          const i = ((y - 1) * m.width + x) * 3;
          data[i] = r; data[i + 1] = g; data[i + 2] = b;
        }
      }
    }
  }

  return {
    ok: true, vis: hdr.vis, mode: modeName,
    image: { width: m.width, height: m.height, data },
    info: {
      rate, decimatedRate: fs2, bits: wav.bits, channels: wav.channels,
      parityOk: hdr.parityOk, stopOk: hdr.stopOk,
      visBits: hdr.visBits, clockRatio: rho, syncFound, syncMiss,
      headerEndMs: hdr.imageStart / spms, durationMs: N / (rate / 1000),
    },
  };
}

/* ================= VIS 表（pySSTV 口径，接线时供 sstvIdent 修正参考） ================= */
// 说明：audiostego.js 现表 SSTV_VIS 中 44→"Robot 36"、32→"Martin 1" 与 pySSTV/通行标准相反
// （pySSTV MartinM1=0x2c=44、Robot36=0x08=8、Robot24BW=0x0A、PD90=0x63=99、PD120=0x5f=95）。
export const SSTV_VIS_PY = {
  0x02: "Robot 8 BW", 0x0a: "Robot 24 BW", 0x08: "Robot 36",
  0x2c: "Martin M1", 0x28: "Martin M2",
  0x3c: "Scottie S1", 0x38: "Scottie S2", 0x4c: "Scottie DX",
  0x63: "PD90", 0x5f: "PD120", 0x62: "PD160", 0x60: "PD180", 0x61: "PD240", 0x5e: "PD290",
  0x37: "Wraase SC2-180", 0x3f: "Wraase SC2-120",
};

export {
  MODES, VIS_TO_MODE, MODE_ALIASES,
  FREQ_BLACK, FREQ_WHITE, FREQ_SYNC, FREQ_VIS_START, FREQ_VIS_BIT0, FREQ_VIS_BIT1,
  byteToFreq, freqToByte, rgbToYcbcr, ycbcrToRgb, visTuples,
  encodeSSTV, decodeSSTV,
  readWavMono, writeWav, instFreqStream, boxcarSmooth, decodeVis, findLineSync, demodScanLine,
};
