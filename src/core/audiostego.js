/*
 * audiostego.js — 音频隐写（cat:'audio'/'stegoFile'）。
 *
 * 覆盖：
 *  wavHeader WAV 头解析（RIFF/fmt/data 块，采样率/位深/声道/时长）
 *  audioLsb 音频 LSB 提取：从 PCM 样本低位提取隐藏比特流 → 文本/hex，
 *           并产出原字节文件产物（bytesToEscapedText 无损形态，通道/位数/上限参数语义不变）
 *  audioLsbEmbed 音频 LSB 嵌入（出题）：把载荷写进 WAV PCM 样本低位，输出结构合法的 WAV；
 *           位布局与 audioLsb 提取一一对应：帧序→选中声道序→每样本低 nBits 位→MSB-first；
 *           封面可为完整 WAV，非 WAV 输入按 rawChannels/rawRate/rawBits 视作原始 PCM 并封装 WAV
 *  dtmfDecode DTMF 从 PCM 提取；sstvIdent SSTV 模式识别
 *
 * 不宣称兼容 steghide / SilentEye 协议；本项目格式是自定义的「PCM LSB 位流」。
 */
import { register } from "./registry.js";
import { bytesToEscapedText, sniffMagic, decodeUtf8Lossless } from "./bytesIo.js";

// BOM 保真的严格 UTF-8 解码（bytesIo 单一源）：非法序列抛 TypeError（同旧 fatal TextDecoder 语义），
// 唯一行为差异是合法 BOM（U+FEFF 开头）不再被静默吞掉。
function _decodeUtf8Fatal(bytes) {
  const r = decodeUtf8Lossless(bytes);
  if (!r.ok) throw new TypeError(r.reason);
  return r.text;
}

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

/** 载荷文本 → 字节（embed 用；无 rawBytes 通道，编码由 payloadEnc 指定）。 */
function payloadToBytes(text, enc) {
  const s = String(text == null ? "" : text).trim();
  const mode = enc || "auto";
  if (mode === "hex") { const t = s.replace(/\s+/g, ""); if (!isHex(t)) throw new Error("载荷不是合法 hex（偶数长度 0-9a-f）"); return hexToBytes(t); }
  if (mode === "base64") { try { return b64ToBytes(s.replace(/\s+/g, "")); } catch { throw new Error("载荷不是合法 base64"); } }
  if (mode === "utf8") return te(text);
  const t = s.replace(/\s+/g, "");
  if (isHex(t)) return hexToBytes(t);
  if (isB64(t)) { try { return b64ToBytes(t); } catch { /* fall through */ } }
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

/** 把有符号样本按位深小端写回字节缓冲。 */
function writeSampleLE(b, off, bits, v) {
  if (bits === 16) { b[off] = v & 0xff; b[off + 1] = (v >> 8) & 0xff; }
  else if (bits === 24) { b[off] = v & 0xff; b[off + 1] = (v >> 8) & 0xff; b[off + 2] = (v >> 16) & 0xff; }
  else if (bits === 32) { b[off] = v & 0xff; b[off + 1] = (v >> 8) & 0xff; b[off + 2] = (v >> 16) & 0xff; b[off + 3] = (v >> 24) & 0xff; }
}

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
    const s = _decodeUtf8Fatal(bytes);
    let ctrl = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c < 0x20 && c !== 0x0A && c !== 0x0D && c !== 0x09) ctrl++;
    }
    if (s.length > 0 && ctrl / s.length < 0.15) return s;
  } catch { /* 非 UTF-8 */ }
  return null;
}

/**
 * 提取产物收口：原字节 + 无损文本形态。
 *
 * 为什么 text 用 bytesToEscapedText 而不是「人话报告」：
 *   配方链中转护栏 transitTextOf 只接受「text 恰为 files 原字节的无损表示」
 *   （Base64 / Hex / \xNN 转义三者之一），报告是描述、不是内容，会被护栏拒绝。
 *   转义形态对可打印 ASCII（如 flag{...}）原样输出、对二进制给出 \xNN，既可读又无损。
 *   （卡面提示的 textMode:"hex" 同属该护栏；此处选项目默认的 escape 形态，等价无损。）
 * 需要纯 hex 形态时，把 text 改为 bytesToHex(payload) 即可（护栏同样接受）。
 */
function lsbProduct(payload, name) {
  const b = payload instanceof Uint8Array ? payload : new Uint8Array(payload || []);
  const magic = sniffMagic(b);
  return {
    text: bytesToEscapedText(b),
    files: [{
      name: (name || "audioLsb") + "." + (magic ? magic.ext : "bin"),
      mime: magic ? magic.mime : "application/octet-stream",
      bytes: b,
    }],
  };
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
  const isPcm = f.formatTag === 0x0001 || (f.formatTag === 0xFFFE && f.subFormat === 0x0001);
  if (!isPcm) {
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

 // 原字节 files 产物：text 走无损形态以满足配方链护栏，files 交回精确字节供下载。
 //       参数文件名带位深/声道/位数，保留可读上下文（报告行不再进 text）。
 //       非 PCM（字节结果不可信）仍返回人类报告串、不产出下载，避免把无意义字节当载荷交付。
  if (!isPcm) {
    lines.push("");
    lines.push("--- 提取字节 (hex, 前 " + Math.min(outBytes.length, 4096) + " 字节；非 PCM 仅供参考) ---");
    lines.push(bytesToHex(outBytes, 4096));
    return lines.join("\n");
  }
  if (outBytes.length === 0) return lines.join("\n");
  const fname = "audioLsb_" + f.channels + "ch_" + f.bitsPerSample + "bit_lsb" + nBits + "_c" + chSel + "_" + outBytes.length + "B";
  return lsbProduct(outBytes, fname);
}

// ============================================================
// op 2b) audioLsbEmbed — 音频 LSB 嵌入（出题，编码方向）
// 把载荷位写进 WAV PCM 样本低 nBits 位，位布局与 audioLsb 提取一一对应。
// ============================================================

/** 由原始 PCM 字节封装合法 WAV（RIFF/WAVE/fmt/data，小端，奇数 data 补 1 字节对齐）。 */
function buildWav(pcm, channels, sampleRate, bitsPerSample) {
  const bps = bitsPerSample >> 3;
  const blockAlign = Math.max(1, channels) * bps;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const pad = dataSize & 1; // RIFF 块 2 字节对齐
  const out = new Uint8Array(44 + dataSize + pad);
  const dv = new DataView(out.buffer);
  const putAscii = (o, s) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  putAscii(0, "RIFF");
  dv.setUint32(4, 36 + dataSize + pad, true);
  putAscii(8, "WAVE");
  putAscii(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);            // PCM
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, byteRate, true);
  dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, bitsPerSample, true);
  putAscii(36, "data");
  dv.setUint32(40, dataSize, true);
  out.set(pcm, 44);
  return out;
}

function audioLsbEmbedRun(text, p) {
  const pp = p || {};
  const input = inputToBytes(text, pp);
  const nBits = Math.max(1, Math.min(8, parseInt(pp.lsbBits, 10) || 1));
  const chSel = pp.channel || "all";

  // 载荷
  let payload;
  try { payload = payloadToBytes(pp.payload, pp.payloadEnc); }
  catch (e) { return "载荷解析失败：" + (e && e.message ? e.message : String(e)); }

  // 封面：合法 WAV 直接用；否则按 raw 参数视作原始 PCM 并封装 WAV
  let cover, fmtInfo, isRaw = false;
  const w = parseWav(input);
  if (w.ok && w.data) {
    cover = input;
    fmtInfo = w.fmt;
  } else {
    isRaw = true;
    const ch = Math.max(1, Math.min(2, parseInt(pp.rawChannels, 10) || 1));
    const rate = Math.max(1, parseInt(pp.rawRate, 10) || 8000);
    const bits = [8, 16, 24, 32].includes(parseInt(pp.rawBits, 10)) ? parseInt(pp.rawBits, 10) : 16;
    const bps = bits >> 3;
    // 对齐到整帧
    const usable = input.length - (input.length % (ch * bps));
    cover = buildWav(input.subarray(0, usable), ch, rate, bits);
    const w2 = parseWav(cover);
    fmtInfo = w2.fmt;
    cover = w2 ? cover : cover;
  }

  const f = fmtInfo;
  const pcmFmt = f.formatTag === 0x0001 || (f.formatTag === 0xFFFE && f.subFormat === 0x0001);
  if (!pcmFmt) return "错误: 封面非 PCM 整数格式（tag=0x" + f.formatTag.toString(16) + "），无法按样本位嵌入";
  if (![8, 16, 24, 32].includes(f.bitsPerSample)) return "错误: 不支持的位深 " + f.bitsPerSample + " bit（支持 8/16/24/32）";

  const wc = parseWav(cover);
  if (!wc.ok || !wc.data) return "错误: 封面 WAV 结构不完整（" + (wc.error || "无 data") + "）";
  const bps = f.bitsPerSample >> 3;
  const nch = Math.max(1, f.channels);
  const dataOff = wc.data.offset;
  const avail = wc.data.actual;
  const frames = Math.floor(avail / (bps * nch));

  let chList;
  if (chSel === "all") chList = Array.from({ length: nch }, (_, i) => i);
  else {
    const idx = parseInt(chSel, 10);
    if (isNaN(idx) || idx < 0 || idx >= nch) return "错误: 声道索引 " + chSel + " 越界（共 " + nch + " 声道）";
    chList = [idx];
  }

  const capacity = frames * chList.length * nBits;
  const need = payload.length * 8;
  if (need > capacity) {
    return "错误: 载荷过大：需要 " + need + " 位，封面容量 " + capacity +
      " 位（" + frames + " 帧 × " + chList.length + " 声道 × " + nBits + " 位）。请换更长封面、加声道或降 LSB 位数。";
  }

  const out = cover.slice();
  const mask = (1 << nBits) - 1;
  let bi = 0;
  const totalBits = need;
  outer:
  for (let fr = 0; fr < frames; fr++) {
    for (const c of chList) {
      const off = dataOff + (fr * nch + c) * bps;
      let cur;
      if (f.bitsPerSample === 8) cur = out[off];
      else if (f.bitsPerSample === 16) cur = i16le(out, off);
      else if (f.bitsPerSample === 24) cur = i24le(out, off);
      else cur = i32le(out, off);

      let pat = 0;
      for (let k = 0; k < nBits; k++) {
        const bit = bi < totalBits ? ((payload[bi >> 3] >> (7 - (bi & 7))) & 1) : 0;
        pat = (pat << 1) | bit;
        bi++;
      }

      if (f.bitsPerSample === 8) {
        // 提取侧读 (raw-128)&mask；nBits<=7 时等价 raw&mask；nBits==8 时按位旋转 0x80 还原
        const newRaw = nBits === 8 ? (pat ^ 0x80) : ((cur & ~mask) | pat);
        out[off] = newRaw & 0xff;
      } else {
        const nv = (cur & ~mask) | pat;
        writeSampleLE(out, off, f.bitsPerSample, nv);
      }
      if (bi >= totalBits) break outer;
    }
  }

  const head = "音频 LSB 嵌入完成：" + (isRaw ? "原始 PCM 封装为 WAV；" : "封面 WAV；") +
    nch + " 声道 / " + f.bitsPerSample + " bit / " + frames + " 帧，采样率 " + f.sampleRate + " Hz。\n" +
    "写入参数：每样本低 " + nBits + " 位，声道=" + chSel + "。载荷 " + payload.length + " 字节（" + need + " 位），容量 " + capacity + " 位。\n" +
    "完整隐写 WAV 请用「文件下载」保存；再用 audioLsb 按相同「每样本 LSB 位数 / 声道」提取即可还原。\n" +
    "（本格式为本项目自定义 PCM LSB 位流，不宣称兼容 steghide / SilentEye 协议。）";
  const fname = "stego_audio_" + nch + "ch_" + f.bitsPerSample + "bit_lsb" + nBits + "_c" + chSel + "_" + payload.length + "B.wav";
  return { text: head, files: [{ name: fname, mime: "audio/wav", bytes: out }] };
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
// pySSTV/通行标准 VIS 口径（此前 44/32/8 等多条映射与通行标准相反，Martin 信号会被标成 Robot 36）
const SSTV_VIS = {
  2: "Robot 8 BW",
  10: "Robot 24 BW",
  8: "Robot 36",
  44: "Martin M1",
  40: "Martin M2",
  60: "Scottie S1",
  56: "Scottie S2",
  76: "Scottie DX",
  99: "PD90",
  95: "PD120",
  98: "PD160",
  96: "PD180",
  97: "PD240",
  94: "PD290",
  55: "Wraase SC2-180",
  63: "Wraase SC2-120",
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
  const needSyncWins = Math.max(3, Math.floor((0.024 / (hop / sr)))); // ~24ms 连续判定（标准 VIS 起始位仅 30ms，150ms 阈值恒漏检）
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
 // 检出的 1200Hz 游程即 VIS 起始位（标准信号恰为 30ms），游程末尾直接进 7 数据位
    {
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
  id: "wavHeader", cat: "audio", name: "WAV 头解析",
  desc: "解析 RIFF/WAVE 结构：遍历 chunk + fmt 块（采样率/位深/声道/格式码）+ data 块时长；输入 hex/base64/UTF-8 自动识别",
  params: [INPUT_ENC_PARAM],
  run: wavHeaderRun,
  acceptsBytes: true,
});
register({
  id: "audioLsb", cat: "stegoFile", name: "音频 LSB 提取",
  desc: "从 WAV PCM 样本最低有效位提取隐藏比特流 → 文本/hex + 原字节下载；支持 8/16/24/32 位深、按声道选取、每样本多位",
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
// 新增 op audioLsbEmbed 新 op：编码方向（出题）。通道/位数参数语义与 audioLsb 提取一一对应。
register({
  id: "audioLsbEmbed", cat: "stegoFile", name: "音频 LSB 嵌入（出题）",
  desc: "把载荷写进 WAV PCM 样本最低位（或每样本多位）生成隐写 WAV；位布局与 audioLsb 提取一一对应；输入非 WAV 时按原始 PCM 封装",
  params: [
    INPUT_ENC_PARAM,
    { key: "payload", label: "载荷（待嵌入）", type: "text", default: "" },
    { key: "payloadEnc", label: "载荷编码", type: "select", default: "auto", options: [
      { value: "auto", label: "自动（hex/base64/UTF-8）" },
      { value: "hex", label: "Hex（二进制载荷）" },
      { value: "base64", label: "Base64（二进制载荷）" },
      { value: "utf8", label: "UTF-8 文本" },
    ] },
    { key: "lsbBits", label: "每样本 LSB 位数", type: "number", default: 1, placeholder: "1-8" },
    { key: "channel", label: "声道", type: "select", default: "all", options: [
      { value: "all", label: "全部声道" },
      { value: "0", label: "声道 0" },
      { value: "1", label: "声道 1" },
    ] },
    { key: "rawChannels", label: "原始 PCM 声道数（非 WAV 输入时）", type: "number", default: 1 },
    { key: "rawRate", label: "原始 PCM 采样率（非 WAV 输入时）", type: "number", default: 8000 },
    { key: "rawBits", label: "原始 PCM 位深（非 WAV 输入时）", type: "select", default: 16, options: [
      { value: "8", label: "8 bit" }, { value: "16", label: "16 bit" },
      { value: "24", label: "24 bit" }, { value: "32", label: "32 bit" },
    ] },
  ],
  run: audioLsbEmbedRun,
  acceptsBytes: true,
});
register({
  id: "sstvIdent", cat: "audio", name: "SSTV 模式识别",
  desc: "检测 1200Hz 起始同步脉冲 + VIS 码，标注可能的 SSTV 模式（Robot/Scottie/Martin/PD）；仅识别不解调图像",
  params: [INPUT_ENC_PARAM],
  run: sstvIdentRun,
  acceptsBytes: true,
});

export { parseWav, readPcmSamples, goertzel, inputToBytes, payloadToBytes, buildWav, audioLsbRun, audioLsbEmbedRun };
