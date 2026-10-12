/*
 * dtmfWav.js — DTMF 双音多频 WAV 合成 / 解码（cat:'audio'）。
 *
 * 按键序列 ↔ 音频。
 * encode: 按键序列（0-9 A-D * #）→ 叠加行/列两正弦 → 16 位单声道 WAV → base64
 * decode: WAV(base64/hex) → Goertzel 逐帧检测 8 基频 → 按键序列
 *   解码支持编码格式：1=整数 PCM（8/16/24/32 位）、3=IEEE float（32/64 位）、7=µ-law（G.711）
 *   —— float/µ-law 为 dtmf2num.exe 桥的补齐路径（exe 本身拒绝这两种，JS 超越）。
 *
 * 标准（ITU-T Q.23）：行频 697/770/852/941，列频 1209/1336/1477/1633（Hz）。
 * 自包含 WAV 解析 + Goertzel，不依赖外部文件。
 * 与 audiostego.js 的 dtmfDecode(仅解码 run) 区别：本 op 双向，opId 独立。
 */
import { register } from "./registry.js";

const ROW = [697, 770, 852, 941];
const COL = [1209, 1336, 1477, 1633];
const KEYS = [
  ["1", "2", "3", "A"],
  ["4", "5", "6", "B"],
  ["7", "8", "9", "C"],
  ["*", "0", "#", "D"],
];
const KEY_FREQ = {};
for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) KEY_FREQ[KEYS[r][c]] = [ROW[r], COL[c]];
const ALL_FREQ = [...ROW, ...COL];
const SR = 8000; // 采样率（Nyquist 4000 > 1633，足够）

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ---- base64 / bytes 互转（浏览器 + node 通用） ----
function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return (typeof btoa !== "undefined") ? btoa(bin) : Buffer.from(bytes).toString("base64");
}
function toBytes(text) {
  const s = String(text).trim().replace(/\s+/g, "");
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
    throw new Error("DTMF 解码: 输入既非 WAV 十六进制也非合法 base64");
  }
  const o = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
  return o;
}

// ---- 编码：按键序列 → WAV base64 ----
function dtmfEncode(text, p) {
  const toneMs = clamp(Number((p && p.toneMs) || 200), 20, 2000);
  const gapMs = clamp(Number((p && p.gapMs) || 100), 0, 2000);
  const amp = clamp(Number((p && p.amp) || 0.35), 0.05, 0.5);
  const toneN = Math.round(SR * toneMs / 1000);
  const gapN = Math.round(SR * gapMs / 1000);

  const keys = [...String(text).toUpperCase()].filter((ch) => KEY_FREQ[ch]);
  if (!keys.length) throw new Error("DTMF: 输入无有效按键（0-9 A-D * #）");

 // 生成 PCM 样本（Float 中间态）
  const samples = [];
  for (const ch of keys) {
    const [fr, fc] = KEY_FREQ[ch];
    for (let n = 0; n < toneN; n++) {
      const t = n / SR;
 // 汉宁窗渐入渐出 5ms，减 click；两正弦等幅叠加
      const v = amp * (Math.sin(2 * Math.PI * fr * t) + Math.sin(2 * Math.PI * fc * t));
      samples.push(v);
    }
    for (let n = 0; n < gapN; n++) samples.push(0);
  }

  const N = samples.length;
  const dataBytes = N * 2; // 16 位单声道
  const buf = new Uint8Array(44 + dataBytes);
  const dv = new DataView(buf.buffer);
 // RIFF 头
  const wr4 = (off, s) => { for (let i = 0; i < 4; i++) buf[off + i] = s.charCodeAt(i); };
  wr4(0, "RIFF");
  dv.setUint32(4, 36 + dataBytes, true);
  wr4(8, "WAVE");
  wr4(12, "fmt ");
  dv.setUint32(16, 16, true);        // fmt 块大小
  dv.setUint16(20, 1, true);         // PCM
  dv.setUint16(22, 1, true);         // 单声道
  dv.setUint32(24, SR, true);        // 采样率
  dv.setUint32(28, SR * 2, true);    // 字节率 = SR * 1 * 2
  dv.setUint16(32, 2, true);         // 块对齐
  dv.setUint16(34, 16, true);        // 位深
  wr4(36, "data");
  dv.setUint32(40, dataBytes, true);
  for (let i = 0; i < N; i++) {
    const s = clamp(Math.round(samples[i] * 32767), -32768, 32767);
    dv.setInt16(44 + i * 2, s, true);
  }
  // 产物协议 2026-09-02：WAV 字节走 files 下载按钮（真文件交付 dtmf.wav），text 保留 base64（链式/复制兼容）。
  return { text: bytesToBase64(buf), files: [{ name: "dtmf.wav", mime: "audio/wav", bytes: buf }] };
}

// ---- WAV 解析（自包含最小实现，取 PCM data 块） ----
function parseWavPcm(bytes) {
  const ascii = (i, n) => { let s = ""; for (let k = 0; k < n; k++) s += String.fromCharCode(bytes[i + k]); return s; };
  const u32 = (i) => (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] * 0x1000000)) >>> 0;
  const u16 = (i) => (bytes[i] | (bytes[i + 1] << 8)) >>> 0;
  if (bytes.length < 44 || ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE") {
    throw new Error("DTMF 解码: 输入不是合法 WAV（缺 RIFF/WAVE 头）");
  }
  let off = 12, fmt = null, data = null;
  while (off + 8 <= bytes.length) {
    const id = ascii(off, 4), size = u32(off + 4), d = off + 8;
    if (id === "fmt " && d + 16 <= bytes.length) {
      fmt = { formatTag: u16(d), channels: u16(d + 2), sampleRate: u32(d + 4), bits: u16(d + 14) };
    } else if (id === "data") {
      data = { offset: d, size: Math.min(size, bytes.length - d) };
    }
    const adv = size + (size & 1);
    if (adv <= 0) break;
    off = d + adv;
  }
  if (!fmt || !data) throw new Error("DTMF 解码: WAV 缺 fmt 或 data 块");
 // fmt 字段零校验：bits/channels=0 会使 frameBytes=0 → data.size/0=Infinity → new Float64Array(Infinity) 崩溃。
  if (!fmt.bits || fmt.bits < 8 || fmt.bits > 64 || (fmt.bits & 7) !== 0) {
    throw new Error("DTMF 解码: WAV 位深非法（仅支持 8/16/24/32/64）");
  }
  if (!fmt.channels || fmt.channels < 1 || fmt.channels > 8) {
    throw new Error("DTMF 解码: WAV 声道数非法");
  }
 // 编码格式校验：tag 1=整数 PCM，3=IEEE float，7=µ-law（G.711）。
 // 对齐 dtmf2num 补齐路径（）：float PCM / µ-law 输入正确解码（dtmf2num.exe 本身拒绝这两种，JS 超越）。
  const TAG_NAMES = { 1: "整数 PCM", 3: "IEEE float PCM", 7: "µ-law (G.711)" };
  if (![1, 3, 7].includes(fmt.formatTag)) {
    throw new Error("DTMF 解码: WAV 编码格式 " + fmt.formatTag + " 不支持（支持 1=PCM / 3=float / 7=µ-law）");
  }
  if (fmt.formatTag === 3 && fmt.bits !== 32 && fmt.bits !== 64) {
    throw new Error("DTMF 解码: float PCM 仅支持 32/64 位");
  }
  if (fmt.formatTag === 7 && fmt.bits !== 8) {
    throw new Error("DTMF 解码: µ-law 为 8 位编码");
  }
 // 读单声道（多声道取声道 0）归一化 Float
  const bps = fmt.bits >> 3;
  const frameBytes = bps * fmt.channels;
  const frames = Math.floor(data.size / frameBytes);
  const sig = new Float64Array(frames);
  const scale = Math.pow(2, fmt.bits - 1) || 1;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
 // G.711 µ-law → 线性（CCITT G.711 参考实现，Sun microsystems 版）
  const ulaw2lin = (u) => {
    u = ~u & 0xFF;
    let t = ((u & 0x0F) << 3) + 0x84;
    t <<= (u & 0x70) >> 4;
    return (u & 0x80) ? (0x84 - t) : (t - 0x84);
  };
  for (let f = 0; f < frames; f++) {
    const p = data.offset + f * frameBytes;
    let v;
    if (fmt.formatTag === 7) {
      v = ulaw2lin(bytes[p]) / 32768;
    } else if (fmt.formatTag === 3) {
      v = (fmt.bits === 32) ? dv.getFloat32(p, true) : dv.getFloat64(p, true);
    } else if (fmt.bits === 8) v = (bytes[p] - 128) / 128;
    else if (fmt.bits === 16) { let x = bytes[p] | (bytes[p + 1] << 8); if (x >= 0x8000) x -= 0x10000; v = x / scale; }
    else if (fmt.bits === 24) { let x = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16); if (x >= 0x800000) x -= 0x1000000; v = x / scale; }
    else { let x = (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)); v = x / scale; }
    sig[f] = v;
  }
  return { sig, sampleRate: fmt.sampleRate };
}

// ---- Goertzel 单频能量 ----
function goertzel(sig, start, len, freq, sr) {
  const k = Math.round(len * freq / sr);
  const w = (2 * Math.PI / len) * k;
  const coeff = 2 * Math.cos(w);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let n = 0; n < len; n++) {
    s0 = sig[start + n] + coeff * s1 - s2;
    s2 = s1; s1 = s0;
  }
  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

// ---- 解码：WAV → 按键序列 ----
//
// 判据分三道闸（缺一道就会把底噪当按键 —— 见「绝对电平门限」一节）：
//  ① 双频能量占比 rel = (行最强 + 列最强) / 窗总能量 ≥ thr（默认 0.15，调用方可调）
//     —— ITU-T Q.23 的 DTMF 是一对正弦叠加，纯音窗的 rel ≈ 1，故该比值即「像不像双音」。
//  ② 频率独占性：行次强 / 行最强 ≤ maxRel 且 列次强 / 列最强 ≤ maxRel（默认 0.2，约 14 dB）
//     —— 底噪在被测频点上也会有能量，但不会出现「某一行频独占」。纯音窗实测该比值 < 0.05，
//        底噪窗实测 0.1~1.0，故 0.2 这条线能一刀切开，且不依赖录音增益。
//  ③ 绝对电平门限：窗能量 ≥ 本段最强有效窗能量 × absFrac（默认 0.3）
//     —— 全局归一：真按键通常比底噪高一个量级，门限按「本文件自己的按键电平」定，
//        不写死绝对幅度，故对任意录音增益都成立。
//  ④ 最短按键时长 minKeyMs（默认 30 ms）——单窗/双窗的瞬时命中判为毛刺，不得成键。
//     ITU-T Q.23 规定按键最短 40 ms，30 ms 是留有余量的下界。
//  ⑤ 同键空隙自适应合并（本 op 唯一的「一分为二」防线）
//     ——真录音里同一个按键内部可能带瞬时凹陷（本素材 dtmf拨号音.wav 的 3 键在 5.64 s、
//       5 键在 6.22 s 各有一段 60~85 ms 的掉电平），若一律按「新键」处理，5 个键会被切成 7 个。
//     判据：空隙 ms ≤ min(mergeGapMs, 本文件键间静音中位数 / 2)。
//       ① 为什么除以 2：同一台设备/同一段录音里，真键间隔是稳定的（本素材实测 275~370 ms），
//          而同键内凹陷只有 60~85 ms，相差近 4 倍；「明显短于本文件自己的键间静音」才可能是凹陷。
//          长窗（100 ms）对照证实凹陷期间行/列主导频道不变（3 仍是 697/1477，5 仍是 770/1336），
//          即频率对没变、只是幅度掉了，故物理上是同一键。
//       ② 为什么不用绝对毫秒阈值：真重复键（编码器 tone=200 ms/gap=60 ms 的 "555"）空隙 60 ms
//          与凹陷 60~85 ms 重叠，任何绝对阈值都会二选一地误判；只有相对量能同时成立。
//       ③ 键间静音中位数取「相邻两段按键键名不同」的那些空隙（无歧义的真键间隔）；
//          若整段只有同一个键（如 "555"），退化为全部空隙的中位数 —— 此时它正是真键间隔，判据仍成立。
// 五道闸中 ②③④⑤ 是本轮修复新增：修复前只有 ①，于是一段 0.7 s 的底噪（能量仅为真按键的
// 三成、无双频独占）被逐窗判成 9 个键，真键 5 个被淹没 —— 「假 flag」由此而来。
function dtmfDecode(text, p) {
 // 参数读取：0 对 absFrac/minKeyMs/mergeGapMs 是合法值（关闭/不合并/不去毛刺），
 // 故不能用 `(p && p.x) || 默认值`（会把 0 悄悄换成默认值），改用显式判空。
  const pnum = (key, def) => {
    const v = p && p[key];
    return (v === undefined || v === null || v === "") ? def : Number(v);
  };
  const thr = clamp(pnum("threshold", 0.15), 0.01, 0.9);
  const maxRel = clamp(pnum("maxRel", 0.2), 0.01, 1);
  const absFrac = clamp(pnum("absFrac", 0.3), 0, 1);
  const minKeyMs = clamp(pnum("minKeyMs", 30), 0, 1000);
  const mergeGapMs = clamp(pnum("mergeGapMs", 200), 0, 1000);
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：decode 向直接用真 WAV 字节，跳过 hex/base64 文本解析。
  const wavBytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : toBytes(text);
  const { sig, sampleRate } = parseWavPcm(wavBytes);
  const sr = sampleRate;
  if (sr <= 0) throw new Error("DTMF 解码: 采样率非法");
  const win = Math.max(160, Math.round(sr * 0.020)); // 20ms 分析窗
  const hop = Math.max(1, Math.floor(win / 2));
  const N = sig.length;

 // 第一遍：逐窗算能量与 8 频能量，过 ①② 的窗记为候选
  const frames = [];
  let peak = 0;
  for (let start = 0; start + win <= N; start += hop) {
    let energy = 0;
    for (let n = 0; n < win; n++) energy += sig[start + n] * sig[start + n];
    if (energy < 1e-6) { frames.push(null); continue; }
    const e = ALL_FREQ.map((fq) => goertzel(sig, start, win, fq, sr));
    const r = [e[0], e[1], e[2], e[3]].map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    const c = [e[4], e[5], e[6], e[7]].map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]);
    const rel = (r[0][0] + c[0][0]) / (energy * win);
    const exclusive = r[0][0] > 0 && c[0][0] > 0 && r[1][0] / r[0][0] <= maxRel && c[1][0] / c[0][0] <= maxRel;
    if (rel < thr || !exclusive) { frames.push(null); continue; }
    const frame = { key: KEYS[r[0][1]][c[0][1]], energy };
    frames.push(frame);
    if (energy > peak) peak = energy;
  }
 // 第二遍：③ 绝对电平门限（按本文件候选窗的峰值定标）
  const floor = peak * absFrac;
  const minFrames = Math.max(1, Math.ceil(minKeyMs / hop));
 // 先切「段」：任一被拒帧即断开，段间空隙单独记账（gapBeforeMs），供 ⑤ 自适应合并定标。
  const segs = [];
  let run = null;
  for (const f of frames) {
    if (!f || f.energy < floor) { if (run) run.gap++; continue; }
    if (run && run.key === f.key && run.gap === 0) { run.count++; continue; }
    const gapBeforeMs = run ? run.gap * hop / sr * 1000 : 0;
    if (run) segs.push({ key: run.key, count: run.count, gapBeforeMs: run.gapBeforeMs });
    run = { key: f.key, count: 1, gap: 0, gapBeforeMs };
  }
  if (run) segs.push({ key: run.key, count: run.count, gapBeforeMs: run.gapBeforeMs });
  const median = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
 // ⑤ 自适应合并容差：见函数头注释。键名不同的两段之间的空隙 = 无歧义的真键间隔。
  const diffGaps = [], allGaps = [];
  for (let i = 1; i < segs.length; i++) {
    allGaps.push(segs[i].gapBeforeMs);
    if (segs[i - 1].key !== segs[i].key) diffGaps.push(segs[i].gapBeforeMs);
  }
  const refGap = median(diffGaps);
  const ref = (refGap && refGap > 0) ? refGap : median(allGaps);
  const mergeTolMs = (ref && ref > 0) ? Math.min(mergeGapMs, ref / 2) : mergeGapMs;
 // 合并同键相邻段（累计时长，空洞本身不计入时长）；再以 ④ 最短时长过滤。
  const mergedSegs = [];
  for (const s of segs) {
    const last = mergedSegs[mergedSegs.length - 1];
    if (last && last.key === s.key && s.gapBeforeMs <= mergeTolMs) { last.count += s.count; continue; }
    mergedSegs.push({ key: s.key, count: s.count });
  }
  const out = mergedSegs.filter((m) => m.count >= minFrames).map((m) => m.key);
  if (!out.length) throw new Error("DTMF 解码: 未检出有效按键（阈值 " + thr + "，可下调）");
  return out.join("");
}

// ---- 注册 ----
register({
  id: "dtmfWav",
  cat: "audio",
  name: "DTMF 拨号音 WAV",
  desc: "按键序列 ↔ 拨号音 WAV：encode 数字(0-9 A-D * #)→叠加行/列双正弦 16位单声道 WAV(base64)；decode WAV(base64/hex)→Goertzel 检 8 基频→按键。解码支持整数 PCM(8/16/24/32bit)/IEEE float(32/64bit)/µ-law，对标并超越 dtmf2num。",
  params: [
    { key: "toneMs", label: "每键时长(ms)", type: "number", default: 200, placeholder: "20-2000（仅 encode）" },
    { key: "gapMs", label: "键间间隔(ms)", type: "number", default: 100, placeholder: "0-2000（仅 encode）" },
    { key: "amp", label: "单音幅度", type: "number", default: 0.35, placeholder: "0.05-0.5（仅 encode）" },
    { key: "threshold", label: "解码双音占比阈值", type: "number", default: 0.15, placeholder: "0.01-0.9（仅 decode）" },
    { key: "maxRel", label: "频率独占比上限", type: "number", default: 0.2, placeholder: "0.01-1（仅 decode，次强/最强 频率能量比）" },
    { key: "absFrac", label: "绝对电平门限(占峰值)", type: "number", default: 0.3, placeholder: "0-1（仅 decode，0=关闭）" },
    { key: "minKeyMs", label: "最短按键时长(ms)", type: "number", default: 30, placeholder: "0-1000（仅 decode，去毛刺）" },
    { key: "mergeGapMs", label: "同键空隙合并上限(ms)", type: "number", default: 200, placeholder: "0-1000（仅 decode，0=不合并；实际容差 = min(本值, 本文件键间静音中位数/2)）" },
  ],
  encode: dtmfEncode,
  decode: dtmfDecode,
  acceptsBytes: true,
});

export { dtmfEncode, dtmfDecode, parseWavPcm, goertzel, KEY_FREQ, ROW, COL };


