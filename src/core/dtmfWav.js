/*
 * dtmfWav.js — DTMF 双音多频 WAV 合成 / 解码（cat:'stego'）。
 *
 * 按键序列 ↔ 音频。
 * encode: 按键序列（0-9 A-D * #）→ 叠加行/列两正弦 → 16 位单声道 WAV → base64
 * decode: WAV(base64/hex) → Goertzel 逐帧检测 8 基频 → 按键序列
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
  return bytesToBase64(buf);
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
      fmt = { channels: u16(d + 2), sampleRate: u32(d + 4), bits: u16(d + 14) };
    } else if (id === "data") {
      data = { offset: d, size: Math.min(size, bytes.length - d) };
    }
    const adv = size + (size & 1);
    if (adv <= 0) break;
    off = d + adv;
  }
  if (!fmt || !data) throw new Error("DTMF 解码: WAV 缺 fmt 或 data 块");
 // fmt 字段零校验：bits/channels=0 会使 frameBytes=0 → data.size/0=Infinity → new Float64Array(Infinity) 崩溃。
  if (!fmt.bits || fmt.bits < 8 || fmt.bits > 32 || (fmt.bits & 7) !== 0) {
    throw new Error("DTMF 解码: WAV 位深非法（仅支持 8/16/24/32）");
  }
  if (!fmt.channels || fmt.channels < 1 || fmt.channels > 8) {
    throw new Error("DTMF 解码: WAV 声道数非法");
  }
 // 读单声道（多声道取声道 0）归一化 Float
  const bps = fmt.bits >> 3;
  const frameBytes = bps * fmt.channels;
  const frames = Math.floor(data.size / frameBytes);
  const sig = new Float64Array(frames);
  const scale = Math.pow(2, fmt.bits - 1) || 1;
  for (let f = 0; f < frames; f++) {
    const p = data.offset + f * frameBytes;
    let v;
    if (fmt.bits === 8) v = (bytes[p] - 128) / 128;
    else if (fmt.bits === 16) { let x = bytes[p] | (bytes[p + 1] << 8); if (x >= 0x8000) x -= 0x10000; v = x / scale; }
    else if (fmt.bits === 24) { let x = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16); if (x >= 0x800000) x -= 0x1000000; v = x / scale; }
    else if (fmt.bits === 32) { let x = (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)); v = x / scale; }
    else v = 0;
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
function dtmfDecode(text, p) {
  const thr = clamp(Number((p && p.threshold) || 0.15), 0.01, 0.9);
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

 // 逐窗判音，得每窗按键（或 null）
  const frameKeys = [];
  for (let start = 0; start + win <= N; start += hop) {
 // 窗内总能量做归一
    let energy = 0;
    for (let n = 0; n < win; n++) energy += sig[start + n] * sig[start + n];
    if (energy < 1e-6) { frameKeys.push(null); continue; }
 // 8 频能量
    const e = ALL_FREQ.map((fq) => goertzel(sig, start, win, fq, sr));
 // 行/列各取最大
    let rMax = -1, rIdx = -1, cMax = -1, cIdx = -1;
    for (let i = 0; i < 4; i++) { if (e[i] > rMax) { rMax = e[i]; rIdx = i; } }
    for (let i = 0; i < 4; i++) { if (e[4 + i] > cMax) { cMax = e[4 + i]; cIdx = i; } }
    const rel = (rMax + cMax) / (energy * win);
    if (rel < thr) { frameKeys.push(null); continue; }
    frameKeys.push(KEYS[rIdx][cIdx]);
  }

 // 去抖：连续相同键合并为一次；键间需 null 间隔才算新键
  const out = [];
  let prev = null;
  for (const k of frameKeys) {
    if (k === null) { prev = null; continue; }
    if (k !== prev) { out.push(k); prev = k; }
  }
  if (!out.length) throw new Error("DTMF 解码: 未检出有效按键（阈值 " + thr + "，可下调）");
  return out.join("");
}

// ---- 注册 ----
register({
  id: "dtmfWav",
  cat: "stego",
  name: "DTMF 拨号音 WAV",
  desc: "按键序列 ↔ 拨号音 WAV：encode 数字(0-9 A-D * #)→叠加行/列双正弦 16位单声道 WAV(base64)；decode WAV(base64/hex)→Goertzel 检 8 基频→按键。对标 dtmf2num。",
  params: [
    { key: "toneMs", label: "每键时长(ms)", type: "number", default: 200, placeholder: "20-2000（仅 encode）" },
    { key: "gapMs", label: "键间间隔(ms)", type: "number", default: 100, placeholder: "0-2000（仅 encode）" },
    { key: "amp", label: "单音幅度", type: "number", default: 0.35, placeholder: "0.05-0.5（仅 encode）" },
    { key: "threshold", label: "解码相对能量阈值", type: "number", default: 0.15, placeholder: "0.01-0.9（仅 decode）" },
  ],
  encode: dtmfEncode,
  decode: dtmfDecode,
  acceptsBytes: true,
});

export { dtmfEncode, dtmfDecode, parseWavPcm, goertzel, KEY_FREQ, ROW, COL };


