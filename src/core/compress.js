/*
 * compress.js — 压缩 / 归档识别组（cat:'analysis'）。
 *
 * 覆盖：
 * - gzipCodec gzip 双向（CompressionStream/DecompressionStream 'gzip'）
 * - zlibCodec zlib（含 2 字节头 + adler32 尾）双向（'deflate'）
 * - deflateRawCodec raw deflate（无 zlib 头）双向（'deflate-raw'）
 * - archiveIdentify 归档 magic 识别（gzip/zlib/deflate/bzip2/zip/rar/7z/tar）
 * - zipList ZIP 结构解析（本地文件头 + 中央目录，列出内含文件名）
 * - tarList TAR 头解析（512 字节块，列出文件名 / 大小）
 * - b64CompressedProbe Base64 内嵌压缩流探测（扫连续 base64 → 解码 → magic → 解压）
 *
 * 红线：
 * - 只新建 compress.js，不碰任何现有 core/*.js。
 * - DecompressionStream/CompressionStream 浏览器（Chrome 103+/Firefox 113+）可用；
 * node 端 18+ 实验性支持 globalThis.DecompressionStream，旧 node 无 → 抛清晰错误标注「浏览器实测」。
 * - zip 只读结构不解压加密项（加密项仅列出元信息 + 标记）。
 * - 零外发：全部本地计算。
 *
 * 契约：register({id, cat:"analysis", name, desc, params, encode?, decode?, run?})。
 * 识别类（archiveIdentify/zipList/tarList/b64CompressedProbe）用 run 单向；
 * 解压类（gzip/zlib/deflate-raw）如可逆则 encode+decode。
 *
 * 参考：RFC 1950 (zlib)、RFC 1951 (DEFLATE)、RFC 1952 (gzip)；
 * PKZIP APPNOTE 6.3.x（ZIP 结构）；POSIX tar (ustar)。
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

// ============================================================
// 字节读写小工具
// ============================================================
function u16le(bytes, i) { return (bytes[i] | (bytes[i + 1] << 8)) >>> 0; }
function u32le(bytes, i) { return ((bytes[i]) | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] * 0x1000000)) >>> 0; }
function u32be(bytes, i) { return ((bytes[i] * 0x1000000) + ((bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3])) >>> 0; }
function u64le(bytes, i) {
 // 64 位 LE → BigInt（zip64 / tar size 不用，但 zip compressed size 偶发）
  let lo = u32le(bytes, i), hi = u32le(bytes, i + 4);
  return BigInt(hi) << 32n | BigInt(lo);
}

function bytesEqual(a, start, b) {
  if (start + b.length > a.length) return false;
  for (let i = 0; i < b.length; i++) if (a[start + i] !== b[i]) return false;
  return true;
}

function bytesToHex(bytes, max = 64) {
  let s = "";
  const n = Math.min(bytes.length, max);
  for (let i = 0; i < n; i++) s += bytes[i].toString(16).padStart(2, "0");
  if (bytes.length > max) s += "…";
  return s;
}

// 可打印率（用于解压后判读是否文本）
function printableRatio(bytes) {
  if (bytes.length === 0) return 0;
  let p = 0;
  for (const b of bytes) if ((b >= 0x20 && b < 0x7F) || b === 0x0A || b === 0x0D || b === 0x09) p++;
  return p / bytes.length;
}

// ============================================================
// 输入文本 → 字节（CTF 场景：hex / base64 / base64url / 原样 UTF-8）
// 优先级：hex（偶数长度且全 hex）→ base64（含 +/-/，或全 base64 字符且 4 倍数）→ UTF-8
// ============================================================
const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
function isHex(s) { return /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 && s.length >= 2; }
function isB64(s) {
  if (!s) return false;
  if (s.length % 4 !== 0) return false;
  for (const c of s) if (!B64_CHARS.includes(c)) return false;
  return true;
}
function isB64Url(s) {
  return /^[A-Za-z0-9_-]+$/.test(s) && s.length >= 4;
}
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
 // auto：优先 hex，其次 base64，最后 UTF-8
  if (isHex(s)) return hexToBytes(s);
  if (isB64(s)) { try { return b64ToBytes(s); } catch { /* fall through */ } }
 // base64url（含 - 或 _，无法走标准 base64）
  if (isB64Url(s) && /[\-_]/.test(s)) { try { return b64urlToBytes(s); } catch { /* fall through */ } }
  return te(text);
}

/** 字节 → 输出文本：可打印率高 → UTF-8 文本，否则 hex。返回 {text, mode}。 */
function bytesToOutput(bytes) {
  if (bytes.length === 0) return { text: "", mode: "text" };
 // 优先尝试 UTF-8 fatal 解码：合法 UTF-8 文本（含中文/emoji）能成功解码
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
 // 排除含过多控制字符（除 \n \r \t）的情况，避免二进制碰巧合法 UTF-8
    let ctrl = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c < 0x20 && c !== 0x0A && c !== 0x0D && c !== 0x09) ctrl++;
    }
    if (s.length > 0 && ctrl / s.length < 0.1) return { text: s, mode: "text" };
  } catch { /* 非合法 UTF-8，走 hex */ }
  return { text: bytesToHex(bytes, 4096), mode: "hex" };
}

// ============================================================
// 流式压缩 / 解压（CompressionStream / DecompressionStream）
// format: 'gzip' | 'deflate' | 'deflate-raw'
// ============================================================
function hasStreams() {
  return typeof globalThis.CompressionStream === "function" &&
    typeof globalThis.DecompressionStream === "function";
}

async function streamCompress(format, bytes) {
  if (!hasStreams()) {
    throw new Error("当前环境无 CompressionStream（浏览器实测；node 18+ 实验性可用，旧 node 跳过）");
  }
  const cs = new globalThis.CompressionStream(format);
  const writer = cs.writable.getWriter();
  try { await writer.write(bytes); await writer.close(); }
  catch (e) { throw new Error(format + " 压缩失败: " + (e && e.message ? e.message : String(e))); }
  const reader = cs.readable.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function streamDecompress(format, bytes) {
  if (!hasStreams()) {
    throw new Error("当前环境无 DecompressionStream（浏览器实测；node 18+ 实验性可用，旧 node 跳过）");
  }
  const ds = new globalThis.DecompressionStream(format);
  const writer = ds.writable.getWriter();
  try { await writer.write(bytes); await writer.close(); }
  catch (e) { throw new Error(format + " 解压失败: " + (e && e.message ? e.message : String(e))); }
  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ============================================================
// 通用编解码工厂（gzip / zlib / deflate-raw）
// encode: 文本 → UTF-8 字节 → 压缩 → base64 输出
// decode: 输入（hex/base64/UTF-8 自动识别）→ 字节 → 解压 → 文本（可打印）或 hex
// ============================================================
function makeCompressOps(format, label) {
  async function encode(text) {
    const bytes = te(text);
    const zipped = await streamCompress(format, bytes);
    return bytesToB64(zipped);
  }
  async function decode(text, p) {
    const bytes = inputToBytes(text, p);
    let out;
    try {
      out = await streamDecompress(format, bytes);
    } catch (e) {
      throw new Error(label + " 解压失败：" + (e && e.message ? e.message : String(e)) +
        "（确认输入为 " + label + " 流；浏览器实测，node 旧版无 DecompressionStream）");
    }
    const r = bytesToOutput(out);
    return r.mode === "text"
      ? r.text
      : "(解压成功，但结果非可打印文本，输出 hex)\n" + r.text;
  }
  return { encode, decode };
}

const gzipOps = makeCompressOps("gzip", "gzip");
const zlibOps = makeCompressOps("deflate", "zlib");
const deflateRawOps = makeCompressOps("deflate-raw", "raw deflate");

// ============================================================
// 归档 magic 识别表
// 红线：照标准 magic 表，不编造。每项 { sig, offset, name, ext, desc, note? }
// ============================================================
const ARCHIVE_MAGIC = [
  { sig: [0x1F, 0x8B], offset: 0, name: "gzip", ext: "gz", desc: "GZIP 压缩流（RFC 1952）" },
  { sig: [0x78, 0x01], offset: 0, name: "zlib", ext: "zlib", desc: "zlib 压缩流（RFC 1950，CM=8 CINFO=7 FLEVEL=0）" },
  { sig: [0x78, 0x9C], offset: 0, name: "zlib", ext: "zlib", desc: "zlib 压缩流（RFC 1950，默认压缩）" },
  { sig: [0x78, 0xDA], offset: 0, name: "zlib", ext: "zlib", desc: "zlib 压缩流（RFC 1950，最佳压缩）" },
  { sig: [0x78, 0x5E], offset: 0, name: "zlib", ext: "zlib", desc: "zlib 压缩流（RFC 1950，轻量压缩）" },
  { sig: [0x42, 0x5A, 0x68], offset: 0, name: "bzip2", ext: "bz2", desc: "BZIP2 压缩流（BZh magic）" },
  { sig: [0x50, 0x4B, 0x03, 0x04], offset: 0, name: "zip", ext: "zip", desc: "ZIP 归档（PK\\003\\004，本地文件头）" },
  { sig: [0x50, 0x4B, 0x05, 0x06], offset: 0, name: "zip", ext: "zip", desc: "ZIP 空归档（PK\\005\\006，仅 EOCD）" },
  { sig: [0x50, 0x4B, 0x07, 0x08], offset: 0, name: "zip", ext: "zip", desc: "ZIP 分片归档（PK\\007\\008）" },
  { sig: [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07], offset: 0, name: "rar", ext: "rar", desc: "RAR 归档（Rar!\\x1A\\x07，v1.5-4）" },
  { sig: [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00], offset: 0, name: "rar", ext: "rar", desc: "RAR 归档 v5.0（Rar!\\x1A\\x07\\x01\\x00）" },
  { sig: [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C], offset: 0, name: "7z", ext: "7z", desc: "7-Zip 归档（7z\\xBC\\xAF\\x27\\x1C）" },
 // tar：在偏移 257 处有 "ustar" magic（POSIX ustar）
  { sig: [0x75, 0x73, 0x74, 0x61, 0x72], offset: 257, name: "tar", ext: "tar", desc: "TAR 归档（POSIX ustar magic @ offset 257）" },
];

function detectArchiveMagic(bytes) {
  for (const m of ARCHIVE_MAGIC) {
    if (bytes.length < m.offset + m.sig.length) continue;
    if (bytesEqual(bytes, m.offset, m.sig)) return m;
  }
  return null;
}

// ============================================================
// archiveIdentify（run 单向）：归档 magic 识别
// ============================================================
function archiveIdentifyRun(text, p) {
  const bytes = inputToBytes(text, p);
  if (bytes.length === 0) return "（空输入）";
  const lines = [];
  lines.push("=== 归档 / 压缩流 magic 识别 ===");
  lines.push("输入长度: " + bytes.length + " 字节");
  lines.push("前 32 字节(hex): " + bytesToHex(bytes, 32));
  const m = detectArchiveMagic(bytes);
  if (!m) {
    lines.push("");
    lines.push("结果: 未匹配已知归档 magic（gzip/zlib/bzip2/zip/rar/7z/tar）");
    lines.push("提示: 可能是 raw deflate（无头）、自定义格式或文本");
 // raw deflate 启发：首字节低 4 位 = 0x08（CM=8），且 BFINAL 在 bit0
    const b0 = bytes[0];
    if ((b0 & 0x0F) === 0x08 && bytes.length > 1) {
      const bfinal = b0 & 1;
      const btype = (b0 >> 1) & 3;
      lines.push("启发: 首字节 0x" + b0.toString(16).padStart(2, "0") +
        "（BFINAL=" + bfinal + ", BTYPE=" + btype + "）符合 raw DEFLATE 块头特征");
    }
    return lines.join("\n");
  }
  lines.push("");
  lines.push("结果: 命中 " + m.name.toUpperCase());
  lines.push("  类型: " + m.desc);
  lines.push("  扩展名: ." + m.ext);
 // 额外结构信息
  if (m.name === "gzip") {
    lines.push("");
    lines.push("--- gzip 头解析（RFC 1952）---");
    if (bytes.length < 10) {
      lines.push("gzip 头过短（< 10 字节）");
    } else {
      const flg = bytes[3];
      const mtime = u32le(bytes, 4);
      const xfl = bytes[8];
      const os = bytes[9];
      const osName = { 0: "FAT/MS-DOS", 3: "Unix", 7: "Macintosh", 11: "NTFS", 255: "unknown" }[os] || ("其他(" + os + ")");
      lines.push("  FLG: 0x" + flg.toString(16).padStart(2, "0") +
        " (FTEXT=" + ((flg >> 0) & 1) + ", FHCRC=" + ((flg >> 1) & 1) +
        ", FEXTRA=" + ((flg >> 2) & 1) + ", FNAME=" + ((flg >> 3) & 1) +
        ", FCOMMENT=" + ((flg >> 4) & 1) + ")");
      lines.push("  MTIME: " + (mtime ? new Date(mtime * 1000).toISOString() : "(无)") + " (" + mtime + ")");
      lines.push("  XFL: 0x" + xfl.toString(16).padStart(2, "0"));
      lines.push("  OS: " + osName);
    }
  } else if (m.name === "bzip2") {
    lines.push("");
    lines.push("--- bzip2 头解析 ---");
    if (bytes.length >= 4) {
      const blockSize = bytes[3];
      const realSize = (blockSize - 0x30) * 100 * 1024;
      lines.push("  块大小: " + blockSize + " (0x" + blockSize.toString(16) + ") → " + realSize + " 字节");
    }
  } else if (m.name === "zip") {
    lines.push("");
    lines.push("提示: 使用「ZIP 结构解析」op 列出内含文件名");
  } else if (m.name === "tar") {
    lines.push("");
    lines.push("提示: 使用「TAR 头解析」op 列出内含文件名");
  }
  return lines.join("\n");
}

// ============================================================
// ZIP 结构解析（PKZIP APPNOTE 6.3.x）
// Local File Header: sig 504B0304 @ offset 0
// 偏移 6: General Purpose Flag (2 LE)
// 偏移 8: Compression Method (2 LE)
// 偏移 18: Compressed Size (4 LE)
// 偏移 22: Uncompressed Size (4 LE)
// 偏移 26: File Name Length (2 LE)
// 偏移 28: Extra Field Length (2 LE)
// 偏移 30: File Name (变长) + Extra Field (变长)
// Central Directory Header: sig 504B0102
// 偏移 8: General Purpose Flag (2 LE)
// 偏移 10: Compression Method (2 LE)
// 偏移 20: Compressed Size (4 LE)
// 偏移 24: Uncompressed Size (4 LE)
// 偏移 28: File Name Length (2 LE)
// 偏移 30: Extra Field Length (2 LE)
// 偏移 32: File Comment Length (2 LE)
// 偏移 36: Local Header Offset (4 LE)
// 偏移 42: File Name (变长)
// EOCD: sig 504B0506
// 红线：只读结构，不解压加密项（加密项仅列出元信息 + 标记）
// ============================================================
const ZIP_LFH_SIG = [0x50, 0x4B, 0x03, 0x04];
const ZIP_CDH_SIG = [0x50, 0x4B, 0x01, 0x02];
const ZIP_EOCD_SIG = [0x50, 0x4B, 0x05, 0x06];

const ZIP_COMPRESS_METHODS = {
  0: "Stored(无压缩)", 1: "Shrunk", 6: "Implode", 8: "Deflate", 9: "Deflate64",
  12: "BZIP2", 14: "LZMA", 93: "Zstandard", 94: "MP3", 95: "XZ", 97: "WavPack",
  98: "PPMd", 99: "AES 加密",
};

function parseZipStructure(bytes) {
  const entries = [];
  let lfhCount = 0, cdhCount = 0, eocdOffset = -1;
 // 扫描所有签名（容错：偏移对齐扫描，不依赖固定偏移）
  for (let i = 0; i <= bytes.length - 4; i++) {
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4B) continue;
    const sig = (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] * 0x1000000)) >>> 0;
    if (sig === 0x04034b50) {
 // Local File Header
      lfhCount++;
      if (i + 30 > bytes.length) continue;
      const flag = u16le(bytes, i + 6);
      const method = u16le(bytes, i + 8);
      const compSize = u32le(bytes, i + 18);
      const uncompSize = u32le(bytes, i + 22);
      const nameLen = u16le(bytes, i + 26);
      const extraLen = u16le(bytes, i + 28);
      const nameStart = i + 30;
      if (nameStart + nameLen > bytes.length) continue;
      let name = "";
      for (let k = 0; k < nameLen; k++) name += String.fromCharCode(bytes[nameStart + k]);
      const dataStart = nameStart + nameLen + extraLen;
      entries.push({
        source: "LFH", offset: i, name, flag, method, compSize, uncompSize,
        encrypted: (flag & 1) === 1, dataOffset: dataStart,
      });
 // 跳过数据（粗略，扫描器仍逐字节走）
    } else if (sig === 0x02014b50) {
 // Central Directory Header
      cdhCount++;
      if (i + 46 > bytes.length) continue;
      const flag = u16le(bytes, i + 8);
      const method = u16le(bytes, i + 10);
      const compSize = u32le(bytes, i + 20);
      const uncompSize = u32le(bytes, i + 24);
      const nameLen = u16le(bytes, i + 28);
      const extraLen = u16le(bytes, i + 30);
      const commentLen = u16le(bytes, i + 32);
      const lfhOffset = u32le(bytes, i + 42);
      const nameStart = i + 46;
      if (nameStart + nameLen > bytes.length) continue;
      let name = "";
      for (let k = 0; k < nameLen; k++) name += String.fromCharCode(bytes[nameStart + k]);
      entries.push({
        source: "CDH", offset: i, name, flag, method, compSize, uncompSize,
        encrypted: (flag & 1) === 1, lfhOffset,
      });
      i += 45 + nameLen + extraLen + commentLen - 1; // 跳过本条目
    } else if (sig === 0x06054b50) {
      eocdOffset = i;
    }
  }
  return { entries, lfhCount, cdhCount, eocdOffset };
}

function zipListRun(text, p) {
  const bytes = inputToBytes(text, p);
  if (bytes.length === 0) return "（空输入）";
  const { entries, lfhCount, cdhCount, eocdOffset } = parseZipStructure(bytes);
  const lines = [];
  lines.push("=== ZIP 结构解析 ===");
  lines.push("输入长度: " + bytes.length + " 字节");
  lines.push("Local File Header: " + lfhCount + " 项");
  lines.push("Central Directory: " + cdhCount + " 项");
  lines.push("EOCD: " + (eocdOffset >= 0 ? "@ 0x" + eocdOffset.toString(16) : "未找到"));
  if (entries.length === 0) {
    lines.push("");
    lines.push("结果: 未找到 ZIP 结构（确认输入为 ZIP 字节流，hex/base64 编码）");
    return lines.join("\n");
  }
 // 去重：CDH 优先（含 lfhOffset），同名合并
  const byName = new Map();
  for (const e of entries) {
    if (!byName.has(e.name) || e.source === "CDH") byName.set(e.name, e);
  }
  const list = [...byName.values()];
  lines.push("");
  lines.push("--- 文件清单（" + list.length + " 项）---");
  lines.push("序号\t文件名\t\t压缩方式\t压缩大小\t原始大小\t加密\t来源");
  let idx = 1;
  let encCount = 0;
  for (const e of list) {
    const methodDesc = ZIP_COMPRESS_METHODS[e.method] || ("未知(" + e.method + ")");
    const enc = e.encrypted ? "是" : "否";
    if (e.encrypted) encCount++;
    lines.push(
      idx + "\t" +
      (e.name || "(空名)") + "\t\t" +
      methodDesc + "\t" +
      e.compSize + "\t" +
      e.uncompSize + "\t" +
      enc + "\t" +
      e.source
    );
    idx++;
  }
 // 伪加密检测：CDH 加密位 = 1 但对应 LFH 加密位 = 0
  const cdhEnc = entries.filter((e) => e.source === "CDH" && e.encrypted);
  const lfhEnc = entries.filter((e) => e.source === "LFH" && e.encrypted);
  if (cdhEnc.length > 0 && lfhEnc.length === 0) {
    lines.push("");
    lines.push("⚠ 疑似伪加密：Central Directory 标记加密 " + cdhEnc.length +
      " 项，但 Local File Header 全部未加密（解 CD 加密位即可正常解压）");
  } else if (lfhEnc.length > 0) {
    lines.push("");
    lines.push("⚠ 真加密：" + lfhEnc.length + " 项 Local File Header 标记加密（需密码，本工具不解压加密项）");
  } else if (encCount > 0) {
    lines.push("");
    lines.push("加密项: " + encCount + "（仅列元信息，不解压）");
  }
  return lines.join("\n");
}

// ============================================================
// TAR 头解析（POSIX ustar，512 字节块）
// 偏移 0: filename (100)
// 偏移 100: mode (8, octal)
// 偏移 108: uid (8)
// 偏移 116: gid (8)
// 偏移 124: size (12, octal)
// 偏移 136: mtime (12, octal)
// 偏移 148: chksum (8)
// 偏移 156: typeflag (1)
// 偏移 157: linkname (100)
// 偏移 257: magic (6, "ustar\0" or "ustar ")
// 偏移 263: version (2)
// 偏移 265: uname (32)
// 偏移 297: gname (32)
// 偏移 329: devmajor (8)
// 偏移 337: devminor (8)
// 偏移 345: prefix (155)
// 文件数据紧跟 512 字节头，按 size 向上取整到 512 字节块
// ============================================================
const TAR_TYPEFLAGS = {
  "0": "普通文件", "\0": "普通文件(旧)",
  "1": "硬链接", "2": "符号链接", "3": "字符设备", "4": "块设备",
  "5": "目录", "6": "FIFO", "7": "保留", "L": "GNU 长名", "x": "PAX 扩展",
};

function parseOctal(bytes, start, len) {
 // tar 字段为 octal 字符串，可能含尾 \0 或空格
  let s = "";
  for (let i = start; i < start + len; i++) {
    const b = bytes[i];
    if (b === 0 || b === 0x20) break;
    s += String.fromCharCode(b);
  }
  return s ? parseInt(s, 8) : 0;
}

function parseTarString(bytes, start, len) {
  let s = "";
  for (let i = start; i < start + len; i++) {
    if (bytes[i] === 0) break;
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

function tarListRun(text, p) {
  const bytes = inputToBytes(text, p);
  if (bytes.length === 0) return "（空输入）";
  const lines = [];
  lines.push("=== TAR 头解析 ===");
  lines.push("输入长度: " + bytes.length + " 字节");
  if (bytes.length < 512) {
    lines.push("结果: 输入 < 512 字节，不足一个 tar 块");
    return lines.join("\n");
  }
 // 校验 ustar magic @ 257
  const magic = parseTarString(bytes, 257, 6);
  const isUstar = magic === "ustar" || magic === "ustar\0";
  lines.push("ustar magic: " + (isUstar ? "✓ (" + magic + ")" : "✗ (\"" + magic + "\"，非 POSIX ustar)"));
  lines.push("");
  lines.push("--- 文件清单 ---");
  lines.push("序号\t文件名\t\t类型\t大小\tmtime\tmode");
  let idx = 1;
  let offset = 0;
  let count = 0;
  const MAX = 1000; // 防爆
  while (offset + 512 <= bytes.length && count < MAX) {
    const head = bytes.subarray(offset, offset + 512);
 // 全零块 = tar 结束
    let allZero = true;
    for (let i = 0; i < 512; i++) if (head[i] !== 0) { allZero = false; break; }
    if (allZero) break;
    const name = parseTarString(head, 0, 100);
    const prefix = parseTarString(head, 345, 155);
    const fullName = prefix ? prefix + "/" + name : name;
    const mode = parseOctal(head, 100, 8);
    const size = parseOctal(head, 124, 12);
    const mtime = parseOctal(head, 136, 12);
    const typeflag = String.fromCharCode(head[156]);
    const typeDesc = TAR_TYPEFLAGS[typeflag] || ("未知(" + typeflag + ")");
    const mtimeStr = mtime ? new Date(mtime * 1000).toISOString() : "(无)";
    lines.push(
      idx + "\t" +
      (fullName || "(空名)") + "\t\t" +
      typeDesc + "\t" +
      size + "\t" +
      mtimeStr + "\t" +
      "0" + mode.toString(8)
    );
 // 跳过：头块(512) + 数据块(向上取整到 512)
    const dataBlocks = Math.ceil(size / 512);
    offset += 512 + dataBlocks * 512;
    idx++;
    count++;
  }
  if (count === MAX) lines.push("…（已达 " + MAX + " 项上限，截断）");
  lines.push("");
  lines.push("共 " + (idx - 1) + " 项");
  return lines.join("\n");
}

// ============================================================
// b64CompressedProbe（run 单向）：Base64 内嵌压缩流探测
// 扫文本找连续 base64（>=40 字符，4 倍数），解码后用 magic 识别是否压缩流
// 若是尝试解压（gzip/zlib/deflate-raw 依次）并报告。
// ============================================================
function findB64Segments(text, minLen = 40) {
  const segs = [];
  const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=_-";
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    const isB64Char = (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) ||
      (c >= 0x30 && c <= 0x39) || c === 0x2B || c === 0x2F || c === 0x3D ||
      c === 0x2D || c === 0x5F;
    if (isB64Char) {
      let j = i;
      while (j < text.length) {
        const cc = text.charCodeAt(j);
        const ok = (cc >= 0x41 && cc <= 0x5A) || (cc >= 0x61 && cc <= 0x7A) ||
          (cc >= 0x30 && cc <= 0x39) || cc === 0x2B || cc === 0x2F || cc === 0x3D ||
          cc === 0x2D || cc === 0x5F;
        if (!ok) break;
        j++;
      }
      const seg = text.slice(i, j);
      if (seg.length >= minLen) segs.push({ offset: i, text: seg });
      i = j;
    } else i++;
  }
  return segs;
}

async function tryDecompressAny(bytes) {
 // 依次尝试 gzip / zlib / deflate-raw
  if (!hasStreams()) return null;
  const formats = [
    { f: "gzip", test: () => bytes[0] === 0x1F && bytes[1] === 0x8B },
    { f: "deflate", test: () => bytes[0] === 0x78 && (bytes[1] === 0x01 || bytes[1] === 0x9C || bytes[1] === 0xDA || bytes[1] === 0x5E) },
    { f: "deflate-raw", test: () => (bytes[0] & 0x0F) === 0x08 },
  ];
  for (const { f, test } of formats) {
    if (!test()) continue;
    try {
      const out = await streamDecompress(f, bytes);
      if (out.length > 0) return { format: f, out };
    } catch { /* try next */ }
  }
 // 不做兜底全格式尝试：magic 不匹配即视为非压缩流（避免对大量非压缩 base64 段反复触发解压错误）
  return null;
}

async function b64CompressedProbeRun(text, p) {
  if (!text || text.length === 0) return "（空输入）";
  const minLen = Math.max(8, Number((p && p.minLen) || 40));
  const segs = findB64Segments(text, minLen);
  const lines = [];
  lines.push("=== Base64 内嵌压缩流探测 ===");
  lines.push("输入长度: " + text.length + " 字符");
  lines.push("候选 base64 段（>= " + minLen + " 字符）: " + segs.length + " 处");
  if (segs.length === 0) {
    lines.push("");
    lines.push("结果: 未找到足够的 base64 候选段");
    return lines.join("\n");
  }
  if (!hasStreams()) {
    lines.push("");
    lines.push("⚠ 当前环境无 DecompressionStream（浏览器实测；node 18+ 实验性可用）");
    lines.push("仅列出 base64 段，不做解压试探：");
    for (const s of segs.slice(0, 10)) {
      lines.push("  @0x" + s.offset.toString(16) + " (len=" + s.text.length + "): " +
        s.text.slice(0, 48) + (s.text.length > 48 ? "…" : ""));
    }
    return lines.join("\n");
  }
  let hit = 0;
  for (const s of segs) {
    let bytes;
    try {
 // 兼容 base64url
      let str = s.text.replace(/-/g, "+").replace(/_/g, "/");
      while (str.length % 4) str += "=";
      const bin = atob(str);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch { continue; }
    if (bytes.length < 2) continue;
    const m = detectArchiveMagic(bytes);
    const decomp = await tryDecompressAny(bytes);
    if (m || decomp) {
      hit++;
      lines.push("");
      lines.push("--- 命中 @0x" + s.offset.toString(16) + " (base64 len=" + s.text.length + ", 解码 " + bytes.length + " 字节) ---");
      if (m) {
        lines.push("  magic: " + m.name.toUpperCase() + " — " + m.desc);
      }
      if (decomp) {
        lines.push("  解压(" + decomp.format + "): " + decomp.out.length + " 字节");
        const r = bytesToOutput(decomp.out);
        if (r.mode === "text") {
          const preview = r.text.length > 200 ? r.text.slice(0, 200) + " …" : r.text;
          lines.push("  内容(文本): " + preview);
        } else {
          lines.push("  内容(hex): " + r.text.slice(0, 200));
        }
      }
    }
  }
  lines.push("");
  lines.push("结果: " + hit + " 处命中压缩流（共 " + segs.length + " 候选）");
  if (hit === 0) lines.push("提示: 候选段解码后非已知压缩格式，或解压失败");
  return lines.join("\n");
}

// ============================================================
// detect 指纹（供一键解码）
// ============================================================
function gzipDetect(t) {
  const s = String(t).trim().replace(/\s/g, "");
  if (!isHex(s) && !isB64(s) && !isB64Url(s)) return 0;
  let bytes;
  try { bytes = inputToBytes(s); } catch { return 0; }
  if (bytes.length < 2) return 0;
  if (bytes[0] === 0x1F && bytes[1] === 0x8B) return 0.85;
  return 0;
}
function zlibDetect(t) {
  const s = String(t).trim().replace(/\s/g, "");
  if (!isHex(s) && !isB64(s) && !isB64Url(s)) return 0;
  let bytes;
  try { bytes = inputToBytes(s); } catch { return 0; }
  if (bytes.length < 2) return 0;
  if (bytes[0] === 0x78 && [0x01, 0x9C, 0xDA, 0x5E].includes(bytes[1])) return 0.85;
  return 0;
}

// ============================================================
// 输入编码参数（通用）
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
// 注册
// ============================================================
register({
  id: "gzipCodec", cat: "forensic", name: "Gzip 解压 / 压缩",
  desc: "gzip 流双向（浏览器 DecompressionStream；输入 hex/base64/UTF-8 自动识别）",
  params: [INPUT_ENC_PARAM],
  encode: gzipOps.encode, decode: gzipOps.decode,
  detect: gzipDetect,
  acceptsBytes: true,
});
register({
  id: "zlibCodec", cat: "forensic", name: "Zlib 解压 / 压缩",
  desc: "zlib 流（含 2 字节头 + adler32 尾）双向；浏览器实测",
  params: [INPUT_ENC_PARAM],
  encode: zlibOps.encode, decode: zlibOps.decode,
  detect: zlibDetect,
  acceptsBytes: true,
});
register({
  id: "deflateRawCodec", cat: "forensic", name: "Raw Deflate 解压 / 压缩",
  desc: "raw deflate（无 zlib 头）双向；浏览器实测",
  params: [INPUT_ENC_PARAM],
  encode: deflateRawOps.encode, decode: deflateRawOps.decode,
  acceptsBytes: true,
});
// 压缩包合并：archiveIdentify/zipList/tarList 并入
// archiveUnified 归一入口——archiveUnified 首步 magic 识别 = archiveIdentify，zip 分支复用
// 同一 parseZipStructure（含伪加密检测，详细度等同 zipList），tar 分支 parseTarString/512 块头
// 解析（详细度等同 tarList）。三者 run-only 无 detect，删 register 不影响穷举/magic。
// 函数本体 archiveIdentifyRun/zipListRun/tarListRun 保留 + export（供导出/测试）。
// b64CompressedProbe 保留：扫「文本内嵌 base64 压缩流」是 archiveUnified（整体归档）不覆盖的独有场景。
register({
  id: "b64CompressedProbe", cat: "forensic", name: "Base64 内嵌压缩流探测",
  desc: "扫文本中 base64 段 → 解码 → magic 识别 → 尝试 gzip/zlib/deflate 解压",
  params: [
    { key: "minLen", label: "最小 base64 段长度", type: "number", default: 40, placeholder: "8-1000" },
  ],
  run: b64CompressedProbeRun,
});

export {
  gzipOps, zlibOps, deflateRawOps,
  archiveIdentifyRun, zipListRun, tarListRun, b64CompressedProbeRun,
  parseZipStructure, parseTarString, detectArchiveMagic, inputToBytes, bytesToOutput,
  hasStreams, streamCompress, streamDecompress,
};
