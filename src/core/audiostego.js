/*
 * audiostego.js — 音频隐写识别组（T82，cat:'stego'）。
 *
 * 覆盖（全部单向 run 分析类）：
 * wavHeader WAV 头解析（RIFF/fmt/data 块，采样率/位深/声道/时长）
 * 遍历所有 chunk，标注 PCM/浮点/其他格式码。
 * audioLsb 音频 LSB 提取：从 PCM 样本最低有效位（可选每样本 N 位）提取隐藏
 * 比特流 → 文本 / hex。支持 8/16/24/32 位深、按声道选取。
 * dtmfDecode DTMF 从 PCM 提取：Goertzel 算法在标准 8 个 DTMF 频率上检测能量
 * 滑窗判音 → 双音交叉 → 按键序列（0-9 A-D * #）。
 * sstvIdent SSTV 模式识别（仅识别标注，不解调）：检测 1200Hz 同步脉冲 + VIS 码
 * 报告可能的 SSTV 模式，不还原图像。
 *
 * 红线：
 * - 只新建 audiostego.js，不碰任何现有 core/*.js。
 * - 纯前端零外发，全部本地计算。
 * - id 不与现有 stego op 冲突。
 *
 * 契约：register({id, cat:'stego', name, desc, params, run})。
 *
 * 参考：RIFF/WAVE (WAVE PCM)；ITU-T Q.23/Q.24 (DTMF 频率)；
 * Goertzel (1958)；SSTV VIS code (Robot/Scottie/Martin/PD 模式表)。
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(s);

// ============================================================
// 输入文本 → 字节（CTF：hex / base64 / base64url / 原样 UTF-8）
// 与 compress.js 同风格：优先 hex，其次 base64，再 base64url，最后 UTF-8。
// ============================================================
const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
function isHex(s) { return /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 && s.length >= 2; }
function isB64(s) {
  if (!s) return false;
  if (s.length % 4 !== 0) return false;
  for (const c of s) if (!B64_CHARS.includes(c)) return false;
  return true;
}
function isB64Url(s) { return /^[A-Za-z0-9_-]+$/.test(s) && s.length >= 4; }
function hexToBytes(s) {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.slice(i, i + 2), 16);
  return out;
}
function b64ToBytes(s) {
  let str = s.replace(/\s/g, "");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlToBytes(s) {
  let str = s.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 把输入文本智能解码为字节。
 * @param {string} text 输入
 * @param {object} p 参数（可含 inputEnc: 'auto'|'hex'|'base64'|'utf8'）
 * @returns {Uint8Array}
 */
function inputToBytes(text, p) {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：直接用真字节，跳过 hex/base64 文本解析。
  if (p && p.rawBytes && p.rawBytes.length) {
    return p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes);
  }
  const enc = (p && p.inputEnc) || "auto";
  const s = String(text).trim().replace(/\s+/g, "");
  if (enc === "hex") { if (!isHex(s)) throw new Error("输入不是合法 hex（偶数长度 0-9a-f）"); return hexToBytes(s); }
  if (enc === "base64") { try { return b64ToBytes(s); } catch { throw new Error("输入不是合法 base64"); } }
  if (enc === "utf8") return te(text);
  if (isHex(s)) return hexToBytes(s);
  if (isB64(s)) { try { return b64ToBytes(s); } catch { /* fall through */ } }
  if (isB64Url(s) && /[\-_]/.test(s)) { try { return b64urlToBytes(s); } catch { /* fall through */ } }
  return te(text);
}

// ============================================================
// 字节读写小工具
// ============================================================
function u16le(b, i) { return (b[i] | (b[i + 1] << 8)) >>> 0; }
function u32le(b, i) { return ((b[i]) | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] * 0x1000000)) >>> 0; }
function i16le(b, i) { const v = u16le(b, i); return v >= 0x8000 ? v - 0x10000 : v; }
function i24le(b, i) { const v = (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) >>> 0; return v >= 0x800000 ? v - 0x1000000 : v; }
function i32le(b, i) { return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)); }

function ascii(b, i, n) {
  let s = "";
  for (let k = 0; k < n; k++) {
    const c = b[i + k];
    s += (c >= 0x20 && c < 0x7F) ? String.fromCharCode(c) : ".";
  }
  return s;
}

function bytesToHex(bytes, max = 64) {
  let s = "";
  const n = Math.min(bytes.length, max);
  for (let i = 0; i < n; i++) s += bytes[i].toString(16).padStart(2, "0");
  if (bytes.length > max) s += "…";
  return s;
}

// WAVE 格式码 → 名称（fmt 块 wFormatTag）
const WAVE_FORMATS = {
  0x0001: "PCM (整数)",
  0x0003: "IEEE Float (浮点)",
  0x0006: "A-law",
  0x0007: "μ-law",
  0x0011: "IMA ADPCM",
  0x0055: "MPEG Layer-3",
  0xFFFE: "WAVE_FORMAT_EXTENSIBLE",
};

// ============================================================
// WAV 结构解析：遍历 RIFF 内所有 chunk，抽取 fmt / data。
// 返回 { ok, error?, riffSize, waveId, chunks:[{id,size,offset}], fmt?, data?{offset,size} }
// ============================================================
function parseWav(bytes) {
  const res = { ok: false, chunks: [] };
  if (bytes.length < 12) { res.error = "长度不足 12 字节，非 WAV"; return res; }
  if (ascii(bytes, 0, 4) !== "RIFF") { res.error = "缺少 RIFF 标识（前 4 字节非 'RIFF'）"; return res; }
  res.riffSize = u32le(bytes, 4);
  res.waveId = ascii(bytes, 8, 4);
  if (res.waveId !== "WAVE") { res.error = "RIFF 类型非 'WAVE'（实为 '" + res.waveId + "'）"; return res; }

  let off = 12;
  while (off + 8 <= bytes.length) {
    const id = ascii(bytes, off, 4);
    const size = u32le(bytes, off + 4);
    const dataOff = off + 8;
    res.chunks.push({ id, size, offset: dataOff });
    if (id === "fmt " && dataOff + 16 <= bytes.length) {
      const fmt = {
        formatTag: u16le(bytes, dataOff),
        channels: u16le(bytes, dataOff + 2),
        sampleRate: u32le(bytes, dataOff + 4),
        byteRate: u32le(bytes, dataOff + 8),
        blockAlign: u16le(bytes, dataOff + 12),
        bitsPerSample: u16le(bytes, dataOff + 14),
      };
 // EXTENSIBLE：读取真实子格式码
      if (fmt.formatTag === 0xFFFE && size >= 40 && dataOff + 26 <= bytes.length) {
        fmt.cbSize = u16le(bytes, dataOff + 16);
        fmt.validBits = u16le(bytes, dataOff + 18);
        fmt.channelMask = u32le(bytes, dataOff + 20);
        fmt.subFormat = u16le(bytes, dataOff + 24); // GUID 前 2 字节即真实格式码
      }
      res.fmt = fmt;
    } else if (id === "data") {
      const avail = Math.max(0, bytes.length - dataOff);
      res.data = { offset: dataOff, size, actual: Math.min(size, avail) };
    }
 // chunk 按 2 字节对齐（奇数 size 补 1 padding 字节）
    let adv = size + (size & 1);
    if (adv <= 0) break; // 防御：size=0 死循环
    off = dataOff + adv;
  }
  res.ok = !!res.fmt;
  if (!res.fmt) res.error = "未找到 fmt 块";
  return res;
}

function formatSeconds(s) {
  if (!isFinite(s) || s < 0) return "?";
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return (m > 0 ? m + "m " : "") + sec.toFixed(3) + "s";
}

// ============================================================
// PCM 样本读取：把 data 块解析为按声道分离的整数样本数组。
// 支持 8/16/24/32 位深；8 位为无符号（0..255，中点 128），其余有符号 LE。
// 返回 { channels:[Int32Array,...], frames, bytesPerSample }
// ============================================================
function readPcmSamples(bytes, fmt, dataOffset, dataSize) {
  const bits = fmt.bitsPerSample;
  const ch = Math.max(1, fmt.channels);
  const bps = bits >> 3; // 每样本字节数
  if (bps < 1) throw new Error("不支持的位深: " + bits);
  const end = Math.min(bytes.length, dataOffset + dataSize);
  const totalSamples = Math.floor((end - dataOffset) / bps);
  const frames = Math.floor(totalSamples / ch);
  const channels = [];
  for (let c = 0; c < ch; c++) channels.push(new Int32Array(frames));

  let p = dataOffset;
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < ch; c++) {
      let v;
      if (bits === 8) v = bytes[p] - 128;          // 无符号 8 位 → 居中
      else if (bits === 16) v = i16le(bytes, p);
      else if (bits === 24) v = i24le(bytes, p);
      else if (bits === 32) v = i32le(bytes, p);
      else v = 0;
      channels[c][f] = v;
      p += bps;
    }
  }
  return { channels, frames, bytesPerSample: bps };
}

// ============================================================
// op 1) wavHeader — WAV 头解析
// ============================================================
function wavHeaderRun(text, p) {
  const bytes = inputToBytes(text, p);
  if (bytes.length === 0) return "（空输入）";
  const lines = [];
  lines.push("=== WAV 头解析（RIFF/WAVE）===");
  lines.push("输入长度: " + bytes.length + " 字节");
  lines.push("前 16 字节(hex): " + bytesToHex(bytes, 16));

  const w = parseWav(bytes);
  if (!w.riffSize && w.error && w.chunks.length === 0 && !w.waveId) {
    lines.push("");
    lines.push("结果: " + w.error);
    return lines.join("\n");
  }
  lines.push("");
  lines.push("RIFF 声明大小: " + (w.riffSize != null ? w.riffSize : "?") + " 字节 (= 文件长度 - 8 = " + (bytes.length - 8) + ")");
  lines.push("RIFF 类型: " + (w.waveId || "?"));

  lines.push("");
  lines.push("--- Chunk 列表 ---");
  if (w.chunks.length === 0) {
    lines.push("（无 chunk）");
  } else {
    for (const c of w.chunks) {
      lines.push("  '" + c.id + "'  size=" + c.size + "  @offset " + c.offset);
    }
  }

  if (w.fmt) {
    const f = w.fmt;
    let fmtName = WAVE_FORMATS[f.formatTag] || ("未知(0x" + f.formatTag.toString(16).padStart(4, "0") + ")");
    if (f.formatTag === 0xFFFE && f.subFormat != null) {
      fmtName += " → 子格式 " + (WAVE_FORMATS[f.subFormat] || ("0x" + f.subFormat.toString(16).padStart(4, "0")));
    }
    lines.push("");
    lines.push("--- fmt 块 ---");
    lines.push("  格式: " + fmtName + " (tag=0x" + f.formatTag.toString(16).padStart(4, "0") + ")");
    lines.push("  声道数: " + f.channels + (f.channels === 1 ? " (单声道)" : f.channels === 2 ? " (立体声)" : ""));
    lines.push("  采样率: " + f.sampleRate + " Hz");
    lines.push("  位深: " + f.bitsPerSample + " bit" + (f.validBits ? " (有效 " + f.validBits + " bit)" : ""));
    lines.push("  字节率: " + f.byteRate + " B/s");
    lines.push("  块对齐: " + f.blockAlign + " 字节/帧");
    if (f.channelMask != null) lines.push("  声道掩码: 0x" + f.channelMask.toString(16));
  }

  if (w.data) {
    const f = w.fmt;
    lines.push("");
    lines.push("--- data 块 ---");
    lines.push("  声明大小: " + w.data.size + " 字节");
    lines.push("  实际可用: " + w.data.actual + " 字节" + (w.data.actual < w.data.size ? " (被截断!)" : ""));
    lines.push("  data 起始: @offset " + w.data.offset);
    if (f && f.channels > 0 && f.bitsPerSample > 0) {
      const bytesPerFrame = f.channels * (f.bitsPerSample >> 3);
      if (bytesPerFrame > 0) {
        const frames = Math.floor(w.data.actual / bytesPerFrame);
        const dur = f.sampleRate > 0 ? frames / f.sampleRate : 0;
        lines.push("  总帧数: " + frames + " 帧/声道");
        lines.push("  时长: " + formatSeconds(dur));
      }
    }
  } else {
    lines.push("");
    lines.push("提示: 未找到 data 块（可能头声明与实体不符）");
  }

  if (w.error && !w.fmt) {
    lines.push("");
    lines.push("警告: " + w.error);
  }
  return lines.join("\n");
}

// ============================================================
// op 2) audioLsb — 音频 LSB 提取
// 从每个 PCM 样本取最低 N 位（默认 1），按 MSB-first 拼比特流 → 字节 → 文本/hex。
// ============================================================
function bitsToBytes(bits) {
  const out = new Uint8Array(bits.length >> 3);
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let v = 0;
    for (let k = 0; k < 8; k++) v = (v << 1) | (bits[i + k] & 1);
    out[i >> 3] = v;
  }
  return out;
}

function tryDecodeText(bytes) {
  if (bytes.length === 0) return null;
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let ctrl = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c < 0x20 && c !== 0x0A && c !== 0x0D && c !== 0x09) ctrl++;
    }
    if (s.length > 0 && ctrl / s.length < 0.15) return s;
  } catch { /* 非 UTF-8 */ }
  return null;
}

function audioLsbRun(text, p) {
  const bytes = inputToBytes(text, p);
  if (bytes.length === 0) return "（空输入）";
  const nBits = Math.max(1, Math.min(8, parseInt(p && p.lsbBits, 10) || 1));
  const chSel = (p && p.channel) || "all"; // 'all' | '0' | '1' ...
  const maxBytes = Math.max(1, Math.min(1 << 20, parseInt(p && p.maxBytes, 10) || 4096));

  const lines = [];
  lines.push("=== 音频 LSB 提取 ===");

  const w = parseWav(bytes);
  if (!w.ok || !w.data) {
    lines.push("");
    lines.push("错误: 非合法 WAV 或缺 fmt/data 块（" + (w.error || "无 data") + "）");
    lines.push("提示: 本 op 需完整 WAV（含 fmt 描述位深/声道 + data 样本）");
    return lines.join("\n");
  }
  const f = w.fmt;
  if (f.formatTag !== 0x0001 && !(f.formatTag === 0xFFFE && f.subFormat === 0x0001)) {
    lines.push("");
    lines.push("警告: fmt 格式码非 PCM 整数（tag=0x" + f.formatTag.toString(16) + "），LSB 结果可能无意义");
  }
  if (![8, 16, 24, 32].includes(f.bitsPerSample)) {
    lines.push("");
    lines.push("错误: 不支持的位深 " + f.bitsPerSample + " bit（支持 8/16/24/32）");
    return lines.join("\n");
  }

  const pcm = readPcmSamples(bytes, f, w.data.offset, w.data.actual);
  lines.push("采样率: " + f.sampleRate + " Hz | 位深: " + f.bitsPerSample + " bit | 声道: " + f.channels + " | 帧数: " + pcm.frames);
  lines.push("提取参数: 每样本低 " + nBits + " 位, 声道=" + chSel + ", 上限 " + maxBytes + " 字节");

 // 选取声道序列
  let chList;
  if (chSel === "all") chList = pcm.channels.map((_, i) => i);
  else {
    const idx = parseInt(chSel, 10);
    if (isNaN(idx) || idx < 0 || idx >= pcm.channels.length) {
      lines.push("");
      lines.push("错误: 声道索引 " + chSel + " 越界（共 " + pcm.channels.length + " 声道）");
      return lines.join("\n");
    }
    chList = [idx];
  }

 // 收集比特：按帧遍历，帧内按声道顺序，每样本取低 nBits 位（MSB-first）
  const bits = [];
  const bitCap = maxBytes * 8;
  const mask = (1 << nBits) - 1;
  outer:
  for (let fr = 0; fr < pcm.frames; fr++) {
    for (const c of chList) {
      const v = pcm.channels[c][fr] & mask;
      for (let b = nBits - 1; b >= 0; b--) {
        bits.push((v >> b) & 1);
        if (bits.length >= bitCap) break outer;
      }
    }
  }

  const outBytes = bitsToBytes(bits);
  lines.push("提取比特: " + bits.length + " bit → " + outBytes.length + " 字节");
  lines.push("");

  const asText = tryDecodeText(outBytes);
  if (asText != null) {
    lines.push("--- 解码文本 (UTF-8) ---");
    lines.push(asText);
  } else {
    lines.push("--- 提取字节 (hex, 前 " + Math.min(outBytes.length, 4096) + " 字节) ---");
    lines.push(bytesToHex(outBytes, 4096));
    lines.push("");
    lines.push("提示: 非可读 UTF-8。可换声道 / 调 LSB 位数 / 换输入编码重试");
  }
  return lines.join("\n");
}

// ============================================================
// Goertzel 频率能量检测（sstvIdent 等复用；DTMF 提取已并入 dtmfWav.decode）
// ============================================================
/**
 * Goertzel：在采样序列 samples[start..start+N) 上测目标频率 freq 的能量。
 * @returns 归一化能量（幅度平方 / N）
 */
function goertzel(samples, start, N, freq, sampleRate) {
  const k = Math.round((N * freq) / sampleRate);
  const w = (2 * Math.PI * k) / N;
  const cw = Math.cos(w);
  const coeff = 2 * cw;
  let s1 = 0, s2 = 0;
  for (let i = 0; i < N; i++) {
    const s0 = samples[start + i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return power / N;
}

// ============================================================
// op 4) sstvIdent — SSTV 模式识别（仅识别标注，不解调）
// 探测：1200Hz 起始同步脉冲（~300ms）+ VIS 码（30ms/bit，1300=0 / 1100=1
// 7 数据位 LSB-first），按 VIS → 模式表标注。不还原图像。
// ============================================================
// 常见 SSTV VIS 码 → 模式名（部分；VIS 表存在历史差异，仅供识别标注参考）
const SSTV_VIS = {
  0: "Robot 12 (BW)",
  8: "Robot 24 (BW)",
  40: "Robot 72 (color)",
  44: "Robot 36 (color)",
  60: "Scottie 1",
  56: "Scottie 2",
  76: "Scottie DX",
  36: "Martin 2",
  32: "Martin 1",
  93: "PD 50",
  95: "PD 90",
  99: "PD 120",
  113: "PD 160",
  96: "PD 180",
  98: "PD 240",
  111: "PD 290",
};

/** 在信号窗内测各候选频率能量，返回最强频率与其相对主导度。 */
function dominantFreq(buf, start, N, sr, freqs) {
  let best = -1, bestE = -1;
  const es = freqs.map((fr) => goertzel(buf, start, N, fr, sr));
  for (let i = 0; i < es.length; i++) if (es[i] > bestE) { bestE = es[i]; best = i; }
  const sum = es.reduce((a, b) => a + b, 0) || 1;
  return { idx: best, freq: freqs[best], dom: bestE / sum, energy: bestE };
}

function sstvIdentRun(text, p) {
  const bytes = inputToBytes(text, p);
  if (bytes.length === 0) return "（空输入）";
  const lines = [];
  lines.push("=== SSTV 模式识别（仅标注，不解调）===");

  const w = parseWav(bytes);
  if (!w.ok || !w.data) {
    lines.push("");
    lines.push("错误: 非合法 WAV 或缺 fmt/data 块（" + (w.error || "无 data") + "）");
    return lines.join("\n");
  }
  const f = w.fmt;
  if (![8, 16, 24, 32].includes(f.bitsPerSample)) {
    lines.push("错误: 不支持的位深 " + f.bitsPerSample + " bit");
    return lines.join("\n");
  }
  const pcm = readPcmSamples(bytes, f, w.data.offset, w.data.actual);
  const sr = f.sampleRate;
  if (sr <= 0) { lines.push("错误: 采样率非法"); return lines.join("\n"); }
  const sig = pcm.channels[0];
  const N = sig.length;
  const scale = Math.pow(2, (f.bitsPerSample - 1)) || 1;
  const buf = new Float64Array(N);
  for (let i = 0; i < N; i++) buf[i] = sig[i] / scale;

  lines.push("采样率: " + sr + " Hz | 帧数: " + N + " | 时长: " + formatSeconds(N / sr));

 // 1) 扫描 1200Hz 起始同步脉冲（连续 ~150ms 内 1200Hz 主导）
  const win = Math.max(64, Math.round(sr * 0.010)); // 10ms 分析窗
  const hop = Math.max(1, Math.floor(win / 2));
  const CAND = [1100, 1200, 1300, 1900]; // 同步/VIS 相关基频
  let syncStart = -1, syncRun = 0;
  const needSyncWins = Math.max(3, Math.floor((0.150 / (hop / sr)))); // ~150ms 连续判定
  let firstSyncAt = -1;
  for (let start = 0; start + win <= N; start += hop) {
    const d = dominantFreq(buf, start, win, sr, CAND);
    const is1200 = d.freq === 1200 && d.dom > 0.4;
    if (is1200) {
      if (syncRun === 0) syncStart = start;
      syncRun++;
      if (syncRun >= needSyncWins && firstSyncAt < 0) firstSyncAt = syncStart;
    } else {
      syncRun = 0;
    }
  }

  lines.push("");
  if (firstSyncAt < 0) {
    lines.push("结果: 未检出 SSTV 特征（无 ~1200Hz 起始同步脉冲）");
    lines.push("提示: 本 op 仅做模式识别标注。若确为 SSTV，请用专用解调器还原图像");
    return lines.join("\n");
  }
  lines.push("检出 1200Hz 起始同步脉冲 @ 样本 " + firstSyncAt + " (~" + (firstSyncAt / sr).toFixed(3) + "s)");

 // 2) 同步脉冲后紧跟 VIS 码：起始位(1200,30ms) + 7 数据位(30ms/bit,1300=0/1100=1)
 // 定位同步脉冲结束：从 firstSyncAt 起找连续 1200 的末尾
  let visSearch = firstSyncAt;
  {
    let s = firstSyncAt;
    while (s + win <= N) {
      const d = dominantFreq(buf, s, win, sr, CAND);
      if (!(d.freq === 1200 && d.dom > 0.4)) break;
      s += hop;
    }
    visSearch = s; // 同步脉冲结束处
  }

  const bitDur = Math.round(sr * 0.030); // 30ms/bit
  let vis = null;
  const visBits = [];
  if (visSearch + bitDur * 9 <= N) {
    let pos = visSearch;
 // 起始位（应为 1200Hz）
    const startBit = dominantFreq(buf, pos, Math.min(bitDur, N - pos), sr, [1100, 1200, 1300]);
    if (startBit.freq === 1200) {
      pos += bitDur;
      let val = 0;
      let ok = true;
      for (let b = 0; b < 7; b++) {
        if (pos + bitDur > N) { ok = false; break; }
        const d = dominantFreq(buf, pos, bitDur, sr, [1100, 1300]);
        const bit = d.freq === 1100 ? 1 : 0; // 1100Hz=1, 1300Hz=0
        visBits.push(bit);
        val |= (bit << b); // LSB first
        pos += bitDur;
      }
      if (ok) vis = val;
    }
  }

  if (vis == null) {
    lines.push("");
    lines.push("检出同步脉冲，但 VIS 码解析不足（数据长度不够或频率不清晰）");
    lines.push("结果: 疑似 SSTV 信号，无法确定具体模式");
    lines.push("提示: 本 op 仅识别标注，不解调图像");
    return lines.join("\n");
  }

  const modeName = SSTV_VIS[vis] || null;
  lines.push("");
  lines.push("--- VIS 码 ---");
  lines.push("数据位(LSB→MSB): " + visBits.join("") + "  → VIS = " + vis + " (0x" + vis.toString(16) + ")");
  if (modeName) {
    lines.push("识别模式: " + modeName);
  } else {
    lines.push("识别模式: 未知（VIS " + vis + " 不在常见模式表内）");
  }
  lines.push("");
  lines.push("注: 仅识别标注，未解调图像。VIS 表存在历史差异，结果供参考");
  return lines.join("\n");
}

// ============================================================
// 通用参数
// ============================================================
const INPUT_ENC_PARAM = {
  key: "inputEnc", label: "输入编码", type: "select", default: "auto",
  options: [
    { value: "auto", label: "自动（hex/base64/UTF-8）" },
    { value: "hex", label: "Hex" },
    { value: "base64", label: "Base64" },
    { value: "utf8", label: "UTF-8 文本" },
  ],
};

// ============================================================
// 注册（全部 run 单向分析类）
// ============================================================
register({
  id: "wavHeader", cat: "stego", name: "WAV 头解析",
  desc: "解析 RIFF/WAVE 结构：遍历 chunk + fmt 块（采样率/位深/声道/格式码）+ data 块时长；输入 hex/base64/UTF-8 自动识别",
  params: [INPUT_ENC_PARAM],
  run: wavHeaderRun,
  acceptsBytes: true,
});
register({
  id: "audioLsb", cat: "stego", name: "音频 LSB 提取",
  desc: "从 WAV PCM 样本最低有效位提取隐藏比特流 → 文本/hex；支持 8/16/24/32 位深、按声道选取、每样本多位",
  params: [
    INPUT_ENC_PARAM,
    { key: "lsbBits", label: "每样本 LSB 位数", type: "number", default: 1, placeholder: "1-8" },
    { key: "channel", label: "声道", type: "select", default: "all", options: [
      { value: "all", label: "全部声道" },
      { value: "0", label: "声道 0" },
      { value: "1", label: "声道 1" },
    ] },
    { key: "maxBytes", label: "最大提取字节", type: "number", default: 4096, placeholder: "1-1048576" },
  ],
  run: audioLsbRun,
  acceptsBytes: true,
});
register({
  id: "sstvIdent", cat: "stego", name: "SSTV 模式识别",
  desc: "检测 1200Hz 起始同步脉冲 + VIS 码，标注可能的 SSTV 模式（Robot/Scottie/Martin/PD）；仅识别不解调图像",
  params: [INPUT_ENC_PARAM],
  run: sstvIdentRun,
  acceptsBytes: true,
});

export { parseWav, readPcmSamples, goertzel, inputToBytes };
