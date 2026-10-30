/*
 * ioCoding.js — 全局输入/输出编码内核（文本 ↔ 字节双模）。
 *
 * 解决的问题：把「这一串字节到底按哪个字符集读」与「这一段文本到底写成哪些字节」
 * 收敛成一组显式函数，任何一步都不许静默替换。
 *
 * 三条硬规则：
 *   1. 解码严格模式（默认）遇到非法序列直接抛错，错误带**首个非法字节偏移**与十六进制上下文；
 *      不产出 U+FFFD。
 *   2. 编码遇到目标字符集**不可表示**的字符直接抛错，不回落 UTF-8。
 *   3. 猜测解码（charset:'auto'）必须把「这是猜测」写进 warnings，附置信度与判据原文。
 *
 * 与 bytesIo.js 的分工：本模块只做「字符集 ↔ 码点」的映射与判定；
 * 「hex / base64 / \xNN 转义」这些**字节的文本表示**一律复用 bytesIo，不另写一份。
 *
 * 规范依据：
 *   WHATWG Encoding Standard —— 标签解析、gbk / gb18030 / big5 / shift_jis / euc-kr /
 *     windows-1252 索引表、UTF-16 解码器的代理项规则。
 *     https://encoding.spec.whatwg.org/
 *   RFC 3629 —— UTF-8 的合法序列形状（前导字节与续字节的取值范围、禁止代理项与超长编码）。
 *     https://www.rfc-editor.org/rfc/rfc3629
 *   Unicode Standard Annex #15 / Unicode FAQ "Byte Order Mark" —— BOM 字节序列与最长前缀优先。
 *     https://www.unicode.org/faq/utf_bom.html
 *   GB 18030-2005 —— 四字节段的线性指针映射（指针 = (b1-0x81)*12600 + (b2-0x30)*1260
 *     + (b3-0x81)*10 + (b4-0x30)）。
 *   ISO/IEC 8859-1 —— 0x00–0xFF 与 U+0000–U+00FF 恒等。
 *     （注意：WHATWG 把标签 "iso-8859-1" 解析为 windows-1252，两者在 0x80–0x9F 不同，
 *      所以真正的 ISO-8859-1 必须用恒等表，不能交给宿主 TextDecoder。）
 *
 * 运行时：浏览器 / Node 双通；TextDecoder 缺失时 UTF-8 与单字节表仍可用，
 * 多字节字符集（gbk / big5 / …）会显式报「当前运行时缺少 TextDecoder」。
 */

import {
  hexToBytes,
  bytesToHex,
  b64ToBytes,
  bytesToB64,
  decodeUtf8Lossless,
  decodeUtf8Lossy,
  bytesToEscapedText,
} from "./bytesIo.js";

const HAS_TD = typeof TextDecoder === "function";
const HAS_TE = typeof TextEncoder === "function";

/* ============================== 公开常量 ============================== */

/**
 * 输入规模上限（字节 / UTF-16 码元）。超限直接抛错，不静默截断：
 * 截断会让「编码后的字节」与原文不再对应，属于不可察觉的数据损坏。
 */
export const LIMITS = {
  maxBytes: 32 * 1024 * 1024,
  maxText: 16 * 1024 * 1024,
  sniffSample: 1024 * 1024,
};

export const VIEWS = ["text", "hex", "base64", "escaped"];

/**
 * 编码表。kind 决定编码路径：
 *   utf8  —— TextEncoder（缺失时自实现）
 *   utf16 —— 手工码元（含代理对）
 *   mbcs  —— 运行时反向建表（用宿主严格解码器作 oracle 扫全部字节组合）
 *   sbcs  —— 内嵌单字节表（ISO-8859-1 恒等 / windows-1252 高位表）
 * bom 为 true 时前置的 BOM 归属；无 BOM 定义的字符集为 null。
 */
export const CHARSETS = [
  { label: "utf-8", name: "UTF-8", kind: "utf8", bom: "utf-8" },
  { label: "utf-16le", name: "UTF-16LE", kind: "utf16", bom: "utf-16le" },
  { label: "utf-16be", name: "UTF-16BE", kind: "utf16", bom: "utf-16be" },
  { label: "gbk", name: "GBK（含 GB2312）", kind: "mbcs", bom: null },
  { label: "gb18030", name: "GB18030", kind: "mbcs", bom: null },
  { label: "big5", name: "Big5", kind: "mbcs", bom: null },
  { label: "shift_jis", name: "Shift_JIS", kind: "mbcs", bom: null },
  { label: "euc-kr", name: "EUC-KR", kind: "mbcs", bom: null },
  { label: "iso-8859-1", name: "ISO-8859-1", kind: "sbcs", bom: null },
  { label: "windows-1252", name: "Windows-1252", kind: "sbcs", bom: null },
];

const BY_LABEL = new Map(CHARSETS.map((c) => [c.label, c]));

/** 常见别名（含 WHATWG 标签与 Windows 代码页号），统一折到上表标签。 */
const ALIASES = new Map([
  ["utf8", "utf-8"],
  ["utf-16", "utf-16le"],
  ["utf16le", "utf-16le"],
  ["utf16be", "utf-16be"],
  ["gb2312", "gbk"],
  ["gb-2312", "gbk"],
  ["cp936", "gbk"],
  ["gb18030-2005", "gb18030"],
  ["big-5", "big5"],
  ["cp950", "big5"],
  ["sjis", "shift_jis"],
  ["shift-jis", "shift_jis"],
  ["cp932", "shift_jis"],
  ["euckr", "euc-kr"],
  ["cp949", "euc-kr"],
  ["uhc", "euc-kr"],
  ["latin1", "iso-8859-1"],
  ["latin-1", "iso-8859-1"],
  ["iso8859-1", "iso-8859-1"],
  ["cp1252", "windows-1252"],
  ["win1252", "windows-1252"],
  ["windows1252", "windows-1252"],
]);

/**
 * BOM 表，**按长度降序**：4 字节的 UTF-32 必须先于 2 字节的 UTF-16 匹配。
 * 否则 FF FE 00 00 会被当成 UTF-16LE 的 BOM + 两个 NUL（经典误判）。
 */
const BOMS = [
  { charset: "utf-32le", bytes: [0xff, 0xfe, 0x00, 0x00] },
  { charset: "utf-32be", bytes: [0x00, 0x00, 0xfe, 0xff] },
  { charset: "utf-8", bytes: [0xef, 0xbb, 0xbf] },
  { charset: "utf-16le", bytes: [0xff, 0xfe] },
  { charset: "utf-16be", bytes: [0xfe, 0xff] },
];

const BOM_OF = new Map([
  ["utf-8", [0xef, 0xbb, 0xbf]],
  ["utf-16le", [0xff, 0xfe]],
  ["utf-16be", [0xfe, 0xff]],
]);

/* ============================== 基础工具 ============================== */

const HX = (n) => (n < 0x10 ? "0" : "") + n.toString(16);
const HEX4 = (cp) => "U+" + cp.toString(16).toUpperCase().padStart(4, "0");

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (Array.isArray(input)) return Uint8Array.from(input);
  throw new TypeError("期望 Uint8Array / ArrayBuffer / 字节数组，实际收到 " + Object.prototype.toString.call(input));
}

function checkBytes(b) {
  if (b.length > LIMITS.maxBytes) {
    throw new Error("输入字节数 " + b.length + " 超过上限 " + LIMITS.maxBytes + "（32 MiB）：本模块不截断输入，请分段处理。");
  }
}

function checkText(s) {
  if (s.length > LIMITS.maxText) {
    throw new Error("输入文本长度 " + s.length + " 个码元超过上限 " + LIMITS.maxText + "（16 Mi 码元）：本模块不截断输入，请分段处理。");
  }
}

function charsetInfo(label) {
  const info = BY_LABEL.get(label);
  if (!info) throw new Error("内部错误：字符集 " + JSON.stringify(label) + " 不在 CHARSETS 表中");
  return info;
}

/** 标签 → 规范标签。未知标签显式抛错并列出全部可用项。 */
export function normalizeCharset(label) {
  const raw = label == null ? "" : String(label);
  const key = raw.trim().toLowerCase();
  if (BY_LABEL.has(key)) return key;
  if (ALIASES.has(key)) return ALIASES.get(key);
  throw new Error(
    "未知字符集标签 " + JSON.stringify(raw) + "：本模块支持 "
    + CHARSETS.map((c) => c.label).join(" / ")
    + "；另接受别名 utf8 / gb2312 / cp936 / cp950 / cp932 / cp949 / latin1 / cp1252 等。",
  );
}

function startsWithBytes(b, prefix) {
  if (b.length < prefix.length) return false;
  for (let i = 0; i < prefix.length; i++) if (b[i] !== prefix[i]) return false;
  return true;
}

/* ============================== BOM ============================== */

/**
 * 识别 BOM。**最长前缀优先**：UTF-32 的四字节 BOM 先于 UTF-16 的两字节 BOM 判定。
 * 返回 { charset, bomLen, bomHex } 或 null；bomHex 为小写、无分隔。
 * UTF-32 也如实返回，是否支持由调用方决定（本模块不提供 UTF-32 编解码）。
 */
export function detectBom(bytes) {
  const b = toBytes(bytes);
  for (const e of BOMS) {
    if (!startsWithBytes(b, e.bytes)) continue;
    return { charset: e.charset, bomLen: e.bytes.length, bomHex: bytesToHex(Uint8Array.from(e.bytes)) };
  }
  return null;
}

/* ============================== UTF-8 ============================== */

function isCont(b, i) {
  return i < b.length && (b[i] & 0xc0) === 0x80;
}

/** 返回 b[i] 起一个合法 UTF-8 序列的长度；非法返回 -1。 */
function utf8SeqLen(b, i) {
  const b0 = b[i];
  if (b0 < 0x80) return 1;
  if (b0 < 0xc2) return -1; // 0x80–0xC1：孤立续字节 / 超长编码前导
  if (b0 <= 0xdf) return isCont(b, i + 1) ? 2 : -1;
  if (b0 <= 0xef) {
    // E0 后必须 A0–BF（防超长）；ED 后必须 80–9F（防代理项）
    const lo = b0 === 0xe0 ? 0xa0 : 0x80;
    const hi = b0 === 0xed ? 0x9f : 0xbf;
    const b1 = b[i + 1];
    if (!(b1 >= lo && b1 <= hi)) return -1;
    return isCont(b, i + 2) ? 3 : -1;
  }
  if (b0 <= 0xf4) {
    // F0 后必须 90–BF（防超长）；F4 后必须 80–8F（防 > U+10FFFF）
    const lo = b0 === 0xf0 ? 0x90 : 0x80;
    const hi = b0 === 0xf4 ? 0x8f : 0xbf;
    const b1 = b[i + 1];
    if (!(b1 >= lo && b1 <= hi)) return -1;
    return isCont(b, i + 2) && isCont(b, i + 3) ? 4 : -1;
  }
  return -1;
}

/** 首个非法字节偏移；全部合法返回 -1。 */
function firstBadUtf8(b, from) {
  let i = from || 0;
  while (i < b.length) {
    const n = utf8SeqLen(b, i);
    if (n < 0) return i;
    i += n;
  }
  return -1;
}

function utf8Error(b, off) {
  const from = Math.max(0, off - 8);
  const to = Math.min(b.length, off + 8);
  const parts = [];
  for (let i = from; i < to; i++) parts.push(i === off ? "[" + HX(b[i]) + "]" : HX(b[i]));
  return new Error(
    "非法 UTF-8 序列：首个非法字节偏移 0x" + off.toString(16) + "（第 " + (off + 1) + " 字节），上下文 "
    + parts.join(" ")
    + "；依据 RFC 3629，多字节序列必须由合法前导字节加 80–BF 续字节构成，且不得编码代理项或超出 U+10FFFF。",
  );
}

function utf8DecodeManual(b, from) {
  let out = "";
  let i = from;
  while (i < b.length) {
    const n = utf8SeqLen(b, i);
    if (n < 0) throw utf8Error(b, i);
    const b0 = b[i];
    let cp;
    if (n === 1) cp = b0;
    else if (n === 2) cp = ((b0 & 0x1f) << 6) | (b[i + 1] & 0x3f);
    else if (n === 3) cp = ((b0 & 0x0f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f);
    else cp = ((b0 & 0x07) << 18) | ((b[i + 1] & 0x3f) << 12) | ((b[i + 2] & 0x3f) << 6) | (b[i + 3] & 0x3f);
    out += String.fromCodePoint(cp);
    i += n;
  }
  return out;
}

function utf8DecodeStrict(b, from) {
  const bad = firstBadUtf8(b, from);
  if (bad >= 0) throw utf8Error(b, bad);
  const sub = from === 0 ? b : b.subarray(from);
  if (HAS_TD) {
    const r = decodeUtf8Lossless(sub);
    if (r.ok) return r.text;
    // 校验已通过却解码失败：宿主解码器与本文件的 RFC 3629 校验口径不一致，
    // 按校验结果手工解码，不把差异静默吞掉。
  }
  return utf8DecodeManual(sub, 0);
}

function utf8Encode(text) {
  if (HAS_TE) return new TextEncoder().encode(text);
  const out = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return new Uint8Array(out);
}

/* ============================== UTF-16 ============================== */

/** 扫描孤立代理项。返回 { offset, unit } 或 null。 */
function findLoneSurrogate(text) {
  for (let i = 0; i < text.length; i++) {
    const u = text.charCodeAt(i);
    if (u >= 0xd800 && u <= 0xdbff) {
      const n = text.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return { offset: i, unit: u };
      i++;
    } else if (u >= 0xdc00 && u <= 0xdfff) {
      return { offset: i, unit: u };
    }
  }
  return null;
}

function loneSurrogateError(hit, label) {
  return new Error(
    "文本含孤立代理项 " + HEX4(hit.unit) + "（码元偏移 " + hit.offset + "）："
    + "未配对的代理项不是 Unicode 标量值，" + label + " 无法表示它。请修正输入后再编码。",
  );
}

function utf16Decode(bytes, le, from) {
  const rest = bytes.length - from;
  if (rest % 2 !== 0) {
    throw new Error(
      "UTF-16 字节数必须为偶数：偏移 " + from + " 起共 " + rest + " 字节（尾部多出 "
      + HX(bytes[bytes.length - 1]) + " 于偏移 0x" + (bytes.length - 1).toString(16) + "）。",
    );
  }
  let out = "";
  for (let i = from; i < bytes.length; i += 2) {
    const u = le ? (bytes[i] | (bytes[i + 1] << 8)) : ((bytes[i] << 8) | bytes[i + 1]);
    if (u >= 0xd800 && u <= 0xdbff) {
      if (i + 3 >= bytes.length) {
        throw new Error("UTF-16 高位代理项 " + HEX4(u) + " 位于偏移 0x" + i.toString(16) + " 但后无低代理项（截断）。");
      }
      const u2 = le ? (bytes[i + 2] | (bytes[i + 3] << 8)) : ((bytes[i + 2] << 8) | bytes[i + 3]);
      if (!(u2 >= 0xdc00 && u2 <= 0xdfff)) {
        throw new Error(
          "UTF-16 高位代理项 " + HEX4(u) + "（偏移 0x" + i.toString(16) + "）后不是低代理项，实际为 "
          + HEX4(u2) + "（偏移 0x" + (i + 2).toString(16) + "）。",
        );
      }
      out += String.fromCharCode(u, u2);
      i += 2;
    } else if (u >= 0xdc00 && u <= 0xdfff) {
      throw new Error("UTF-16 孤立低代理项 " + HEX4(u) + " 位于偏移 0x" + i.toString(16) + "，前无高位代理项。");
    } else {
      out += String.fromCharCode(u);
    }
  }
  return out;
}

function utf16Encode(text, le) {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    const u = text.charCodeAt(i);
    if (le) {
      out[i * 2] = u & 0xff;
      out[i * 2 + 1] = (u >> 8) & 0xff;
    } else {
      out[i * 2] = (u >> 8) & 0xff;
      out[i * 2 + 1] = u & 0xff;
    }
  }
  return out;
}

/* ============================== 单字节表 ============================== */

// ISO/IEC 8859-1：0x00–0xFF ↔ U+0000–U+00FF 恒等。
// 不能用 TextDecoder("iso-8859-1")：WHATWG 把该标签解析成 windows-1252，0x80–0x9F 会变。
const LATIN1_BYTES = new Uint8Array(256);
for (let i = 0; i < 256; i++) LATIN1_BYTES[i] = i;

// WHATWG index-windows-1252 的 0x80–0x9F 段；其余字节与 ISO-8859-1 相同。
const CP1252_HIGH = [
  0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f,
  0x0090, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];

function sbcsCodePoint(label, byte) {
  if (label === "windows-1252" && byte >= 0x80 && byte <= 0x9f) return CP1252_HIGH[byte - 0x80];
  return byte;
}

function sbcsByte(label, cp) {
  if (label === "windows-1252" && cp >= 0x80 && cp <= 0x9f) return cp;
  if (cp >= 0 && cp <= 0xff) return cp;
  if (label === "windows-1252") {
    const idx = CP1252_HIGH.indexOf(cp);
    if (idx >= 0) return 0x80 + idx;
  }
  return -1;
}

/* ============================== 多字节表 ============================== */

const _decoders = new Map();
function fatalDecoder(label) {
  if (!HAS_TD) {
    throw new Error("当前运行时缺少 TextDecoder，无法解码 " + label + "；请改用 utf-8 / iso-8859-1 / windows-1252（这三个不依赖宿主解码器）。");
  }
  if (_decoders.has(label)) return _decoders.get(label);
  let td;
  try {
    td = new TextDecoder(label, { fatal: true, ignoreBOM: true });
  } catch (e) {
    throw new Error("当前运行时无法构造字符集 " + label + " 的严格解码器：" + (e && e.message ? e.message : String(e)));
  }
  _decoders.set(label, td);
  return td;
}

const _encTables = new Map();

/**
 * 运行时反向建表：用宿主**严格**解码器作 oracle，扫单字节与双字节全部组合，
 * 只接受「恰好解出一个码点」的组合，首个（最短字节序）映射胜出。
 *
 * 与 charset.js 的做法相同，但两点更严：
 *   · 解码器用 fatal:true，非法组合靠抛错排除，而不是事后过滤 U+FFFD；
 *   · 只接受码点数为 1 的结果，双字符结果（如 shift_jis 的两个半角片假名）不入表。
 */
function buildMbcsTable(label) {
  const td = fatalDecoder(label);
  const map = new Map();
  const buf2 = new Uint8Array(2);
  const put = (b0, b1) => {
    let ch;
    if (b1 < 0) {
      buf2[0] = b0;
      try { ch = td.decode(buf2.subarray(0, 1)); } catch (e) { return; }
    } else {
      buf2[0] = b0;
      buf2[1] = b1;
      try { ch = td.decode(buf2); } catch (e) { return; }
    }
    if (!ch) return;
    const cps = Array.from(ch);
    if (cps.length !== 1) return;
    const cp = cps[0].codePointAt(0);
    if (!map.has(cp)) map.set(cp, b1 < 0 ? [b0] : [b0, b1]);
  };
  for (let b = 0; b < 0x80; b++) put(b, -1);
  for (let b = 0x80; b < 0x100; b++) put(b, -1);
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x40; trail <= 0xfe; trail++) {
      if (trail === 0x7f) continue; // 0x7F 不是任何双字节字符集的合法尾字节
      put(lead, trail);
    }
  }
  return map;
}

function encodeTable(label) {
  const info = charsetInfo(label);
  if (info.kind === "sbcs") return null; // 单字节表用 sbcsByte 直接算，不建 Map
  if (_encTables.has(label)) return _encTables.get(label);
  const map = buildMbcsTable(label);
  _encTables.set(label, map);
  return map;
}

// GB18030 四字节段的指针上限：指针 0..39419 覆盖 BMP 中未进双字节表的部分。
const GB4_MAX_POINTER = 39419;
// 补充平面：指针 189000 起与 U+10000 起一一对应（GB 18030-2005）。
const GB4_SUPP_BASE = 189000;
const GB4_MAX_SUPP = 1237575;

function gb4PointerToBytes(p) {
  const b1 = 0x81 + Math.floor(p / 12600);
  let r = p % 12600;
  const b2 = 0x30 + Math.floor(r / 1260);
  r %= 1260;
  const b3 = 0x81 + Math.floor(r / 10);
  const b4 = 0x30 + (r % 10);
  return [b1, b2, b3, b4];
}

const _gb4Done = new Set();

/** 懒建 GB18030 四字节 BMP 反向表（仅在双字节表查不到时触发一次）。 */
function buildGb4Table(label, map) {
  if (_gb4Done.has(label)) return;
  const td = fatalDecoder(label);
  const buf = new Uint8Array(4);
  for (let p = 0; p <= GB4_MAX_POINTER; p++) {
    const q = gb4PointerToBytes(p);
    buf[0] = q[0]; buf[1] = q[1]; buf[2] = q[2]; buf[3] = q[3];
    let ch;
    try { ch = td.decode(buf); } catch (e) { continue; }
    const cps = Array.from(ch);
    if (cps.length !== 1) continue;
    const cp = cps[0].codePointAt(0);
    if (!map.has(cp)) map.set(cp, q.slice());
  }
  _gb4Done.add(label);
}

/* ============================== 猜测（sniff） ============================== */

// 双字节字符集的结构规则（仅用于「合法率」打分，不做解码；解码另由严格解码器完成）。
const MBCS_STRUCT = {
  gbk: { lead: [[0x81, 0xfe]], trail: [[0x40, 0x7e], [0x80, 0xfe]] },
  gb18030: { lead: [[0x81, 0xfe]], trail: [[0x40, 0x7e], [0x80, 0xfe]], quad: true },
  big5: { lead: [[0x81, 0xfe]], trail: [[0x40, 0x7e], [0xa1, 0xfe]] },
  shift_jis: { lead: [[0x81, 0x9f], [0xe0, 0xfc]], trail: [[0x40, 0x7e], [0x80, 0xfc]], single: [[0xa1, 0xdf]] },
  "euc-kr": { lead: [[0x81, 0xfe]], trail: [[0x41, 0x5a], [0x61, 0x7a], [0x81, 0xfe]] },
};

function inRanges(v, ranges) {
  for (const [lo, hi] of ranges) if (v >= lo && v <= hi) return true;
  return false;
}

function structuralRate(b, label) {
  const rule = MBCS_STRUCT[label];
  let i = 0;
  let good = 0;
  let bad = 0;
  let pairs = 0;
  let badAt = -1;
  while (i < b.length) {
    const c = b[i];
    if (c < 0x80) { good++; i++; continue; }
    if (rule.single && inRanges(c, rule.single)) { good++; i++; continue; }
    if (!inRanges(c, rule.lead)) { bad++; if (badAt < 0) badAt = i; i++; continue; }
    const t = b[i + 1];
    if (t !== undefined && inRanges(t, rule.trail)) { good += 2; pairs++; i += 2; continue; }
    if (rule.quad && t !== undefined && t >= 0x30 && t <= 0x39) {
      const t3 = b[i + 2];
      const t4 = b[i + 3];
      if (t3 !== undefined && t4 !== undefined && inRanges(t3, rule.lead) && t4 >= 0x30 && t4 <= 0x39) {
        good += 4; pairs++; i += 4; continue;
      }
    }
    bad += 1;
    if (badAt < 0) badAt = i;
    i += 1;
  }
  const total = good + bad;
  return { rate: total ? good / total : 0, pairs, badAt, good, bad };
}

const CJK_BASE = [
  [0x3000, 0x303f], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xf900, 0xfaff], [0xff00, 0xffef], [0x2000, 0x206f],
];
const SCRIPT_EXTRA = {
  // 半角片假名（U+FF61–FF9F）刻意不计入：任何 0xA1–0xDF 的单字节流在 Shift_JIS 下都会解成
  // 半角片假名，把它算作「目标文字命中」会让所有高位字节流都被判成 Shift_JIS。
  shift_jis: [[0x3040, 0x30ff], [0x31f0, 0x31ff]],
  "euc-kr": [[0xac00, 0xd7af], [0x3130, 0x318f], [0x1100, 0x11ff]],
};

/** 解码结果落在「该字符集目标文字系统」内的码点比例；ASCII 恒计入。 */
function scriptShare(text, label) {
  const extra = SCRIPT_EXTRA[label] || [];
  let hit = 0;
  let total = 0;
  for (const ch of text) {
    total++;
    const cp = ch.codePointAt(0);
    if (cp < 0x80 || inRanges(cp, CJK_BASE) || inRanges(cp, extra)) hit++;
  }
  return total ? hit / total : 0;
}

function tryDecodeStrict(b, label) {
  if (!HAS_TD) return null;
  try { return fatalDecoder(label).decode(b); } catch (e) { return null; }
}

const ASCII_LABELS = ["utf-8", "gbk", "gb18030", "big5", "shift_jis", "euc-kr", "iso-8859-1", "windows-1252"];
const SCORED_LABELS = ["gbk", "gb18030", "big5", "shift_jis", "euc-kr"];

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

/**
 * 字符集猜测。**不是识别，是排序**：返回 best + 每个候选的置信度与判据原文。
 *
 * 判据优先级（高 → 低），逐条写入 reason：
 *   1. BOM 命中                      → 1.000（唯一命中，不再列其他）
 *   2. NUL 分布符合 UTF-16           → 0.5 + 0.4 × 主导奇偶位零字节占比（上限 0.95）
 *   3. 纯 ASCII                      → 0.500 全组同分（ASCII 段各字符集定义完全一致）
 *   4. 合法 UTF-8 且含多字节序列     → utf-8 0.950；其余候选降权至 ≤0.600
 *   5. 双字节结构合法率 + 目标文字占比 → 0.05 + 0.55×合法率 + 0.30×文字占比（上限 0.92）
 *   6. 含 NUL 且不符合 UTF-16 分布   → 判为二进制，全部候选 0
 */
export function sniffCharset(bytes, opts) {
  const b = toBytes(bytes);
  const o = opts || {};
  const cap = o.sample && o.sample > 0 ? Math.min(o.sample, b.length) : Math.min(b.length, LIMITS.sniffSample);
  const s = b.subarray(0, cap);
  const sampledNote = cap < b.length ? "（仅分析前 " + cap + " 字节，共 " + b.length + " 字节）" : "";

  const bom = detectBom(s);
  if (bom) {
    return {
      best: bom.charset,
      candidates: [{
        charset: bom.charset,
        confidence: 1,
        reason: "BOM 命中 " + bom.bomHex + "（" + bom.bomLen + " 字节），按最长前缀优先判定为 " + bom.charset + "；BOM 是显式声明，不再参考其它判据。" + sampledNote,
      }],
    };
  }

  if (!s.length) {
    const reason = "空输入：零字节对任何字符集都成立，无判别信息；按 utf-8 返回 0.5，其余 ASCII 兼容项同分。";
    return { best: "utf-8", candidates: ASCII_LABELS.map((l) => ({ charset: l, confidence: 0.5, reason })) };
  }

  // NUL 统计（UTF-16 判据与二进制判据共用）
  let nul = 0;
  let evenZero = 0;
  let oddZero = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== 0) continue;
    nul++;
    if (i % 2 === 0) evenZero++; else oddZero++;
  }
  const evenSlots = Math.ceil(s.length / 2);
  const oddSlots = Math.floor(s.length / 2);
  const evenRatio = evenSlots ? evenZero / evenSlots : 0;
  const oddRatio = oddSlots ? oddZero / oddSlots : 0;

  if (s.length >= 4 && s.length % 2 === 0 && nul >= 2) {
    let utf16 = null;
    if (oddRatio >= 0.3 && evenRatio <= 0.05) utf16 = "utf-16le";
    else if (evenRatio >= 0.3 && oddRatio <= 0.05) utf16 = "utf-16be";
    if (utf16) {
      const decoded = tryDecodeStrict(s, utf16);
      const dominant = utf16 === "utf-16le" ? oddRatio : evenRatio;
      const conf = decoded == null ? 0.4 : round3(Math.min(0.95, 0.5 + 0.4 * dominant));
      const reason = "NUL 分布符合 " + utf16 + "："
        + (utf16 === "utf-16le" ? "奇数位" : "偶数位") + "零字节占比 " + round3(dominant).toFixed(3)
        + "（" + (utf16 === "utf-16le" ? oddZero + "/" + oddSlots : evenZero + "/" + evenSlots) + "），"
        + "另一奇偶位零字节占比 " + round3(utf16 === "utf-16le" ? evenRatio : oddRatio).toFixed(3)
        + "；ASCII 文本按 UTF-16 存储时高位字节恒为 0x00，这是该判据的成因。"
        + (decoded == null ? " 但整段按 " + utf16 + " 严格解码失败（存在未配对代理项），置信度降到 0.4。" : "")
        + sampledNote;
      return { best: utf16, candidates: [{ charset: utf16, confidence: conf, reason }] };
    }
  }

  let allAscii = true;
  for (let i = 0; i < s.length; i++) if (s[i] >= 0x80) { allAscii = false; break; }
  if (allAscii) {
    const reason = "全部 " + s.length + " 字节 ≤ 0x7F：UTF-8 / GBK / GB18030 / Big5 / Shift_JIS / EUC-KR / ISO-8859-1 / Windows-1252 "
      + "对 ASCII 段的定义完全一致，解码结果逐字节相同，因此这些候选**同等合法**，0.500 只是「无判别信息」的中性取值，"
      + "不代表 utf-8 更可能。" + sampledNote;
    return { best: "utf-8", candidates: ASCII_LABELS.map((l) => ({ charset: l, confidence: 0.5, reason })) };
  }

  if (nul > 0) {
    const reason = "含 NUL（0x00）共 " + nul + " 个，且不符合 UTF-16 的隔字节零分布：判为二进制载荷，字符集识别不适用。"
      + "请改用 hex / escaped 视图查看原始字节。" + sampledNote;
    return { best: "utf-8", candidates: [{ charset: "utf-8", confidence: 0, reason }] };
  }

  const badUtf8 = firstBadUtf8(s, 0);
  let multiSeq = 0;
  if (badUtf8 < 0) {
    let i = 0;
    while (i < s.length) { const n = utf8SeqLen(s, i); if (n > 1) multiSeq++; i += n; }
  }

  const candidates = [];
  if (badUtf8 < 0 && multiSeq > 0) {
    candidates.push({
      charset: "utf-8",
      confidence: 0.95,
      reason: "整段通过 RFC 3629 全序列校验（非法序列 0 处），其中多字节序列 " + multiSeq + " 个；"
        + "双字节字符集偶然把整段高位字节都凑成合法 UTF-8 的概率极低，故取 0.95。" + sampledNote,
    });
    for (const label of SCORED_LABELS) {
      const st = structuralRate(s, label);
      const decoded = tryDecodeStrict(s, label);
      const share = decoded == null ? 0 : scriptShare(decoded, label);
      let conf = 0.05 + 0.55 * st.rate + 0.3 * share;
      if (decoded == null) conf -= 0.15;
      conf = Math.min(0.6, conf); // 存在更优先判据（合法 UTF-8 多字节序列），本项降权
      candidates.push({
        charset: label,
        confidence: round3(Math.max(0, conf)),
        reason: "结构合法率 " + round3(st.rate).toFixed(3) + "（" + st.good + "/" + (st.good + st.bad) + " 字节）"
          + "，目标文字占比 " + round3(share).toFixed(3)
          + (decoded == null ? "，整段严格解码失败" : "")
          + "；存在更优先判据（合法 UTF-8 多字节序列），本项上限压到 0.600。",
      });
    }
    return { best: "utf-8", candidates };
  }

  candidates.push({
    charset: "utf-8",
    confidence: 0,
    reason: "存在非法 UTF-8 序列（首个非法字节偏移 0x" + badUtf8.toString(16) + "），排除 utf-8。",
  });

  const scored = [];
  for (const label of SCORED_LABELS) {
    const st = structuralRate(s, label);
    const decoded = tryDecodeStrict(s, label);
    const share = decoded == null ? 0 : scriptShare(decoded, label);
    let conf = 0.05 + 0.55 * st.rate + 0.3 * share;
    if (decoded == null) conf -= 0.15;
    conf = Math.min(0.92, Math.max(0, conf));
    // 双字节对数为 0：该字符集在本样本上只用到单字节映射（如 Shift_JIS 的半角片假名段），
    // 与任何单字节字符集的判据重合，不构成证据。
    const noPairs = st.pairs === 0 && st.bad === 0;
    if (noPairs) conf = Math.min(conf, 0.5);
    scored.push({
      charset: label,
      confidence: round3(conf),
      reason: "结构合法率 " + round3(st.rate).toFixed(3) + "（合法 " + st.good + " 字节 / 非法 " + st.bad + " 字节，"
        + "双字节对 " + st.pairs + " 个）"
        + (st.badAt >= 0 ? "，首个结构不合法字节偏移 0x" + st.badAt.toString(16) : "")
        + "；目标文字占比 " + round3(share).toFixed(3)
        + (decoded == null ? "；整段严格解码失败（存在未分配码位），置信度 −0.15" : "；整段严格解码通过")
        + (noPairs ? "；双字节对为 0，判据退化为单字节映射，置信度上限压到 0.500" : "")
        + "。取值式 0.05 + 0.55×合法率 + 0.30×文字占比，上限 0.92。",
    });
  }

  scored.sort((x, y) => (y.confidence - x.confidence) || (SCORED_LABELS.indexOf(x.charset) - SCORED_LABELS.indexOf(y.charset)));
  const top = scored[0] || null;
  // 0.600 是「有实际双字节证据」的门槛：结构合法率 1.000 + 文字占比 1.000 才得 0.900，
  // 低于 0.600 说明连结构都对不上，此时多字节结论没有意义，退到单字节字符集。
  const lowEvidence = !top || top.confidence < 0.6;
  const best = lowEvidence ? "iso-8859-1" : top.charset;

  for (const c of scored) {
    let reason = c.reason;
    if (!lowEvidence) {
      const tie = scored.find((x) => x !== c && Math.abs(x.confidence - c.confidence) < 0.02);
      if (tie) {
        reason += " 与 " + tie.charset + " 置信度相差 <0.02：双字节字符集在结构上无法区分，"
          + "best 按固定顺序（gbk→gb18030→big5→shift_jis→euc-kr）取靠前者。";
      }
    }
    candidates.push({ charset: c.charset, confidence: c.confidence, reason });
  }

  if (lowEvidence) {
    const conf = round3(top ? top.confidence : 0);
    const reason = "双字节判据最高仅 " + conf.toFixed(3) + "（低于 0.600 阈值），没有足够证据支持任何多字节字符集；"
      + "退回单字节：ISO-8859-1 与 Windows-1252 对任意字节流都能解码（256 个字节全部有定义），"
      + "二者仅在 0x80–0x9F 段不同。这是「没有证据」的结论，不是识别结果。";
    candidates.push({ charset: "iso-8859-1", confidence: conf, reason });
    candidates.push({ charset: "windows-1252", confidence: conf, reason });
  }

  if (cap < b.length) candidates[candidates.length - 1].reason += sampledNote;

  return { best, candidates };
}

/* ============================== 解码 ============================== */

function locateMbcsError(bytes, label) {
  if (!HAS_TD) return -1;
  let td;
  try { td = new TextDecoder(label, { fatal: true }); } catch (e) { return -1; }
  for (let i = 0; i < bytes.length; i++) {
    try { td.decode(bytes.subarray(i, i + 1), { stream: true }); } catch (e) { return i; }
  }
  try { td.decode(); } catch (e) { return bytes.length; }
  return -1;
}

function mbcsDecodeStrict(bytes, label) {
  const td = fatalDecoder(label);
  try {
    return td.decode(bytes);
  } catch (e) {
    const at = locateMbcsError(bytes, label);
    // at === 字节数 表示错误发生在 flush：末尾的多字节序列不完整（被截断），
    // 此时把起点回退到最后一个可能是前导字节的位置（≥0x81），而不是报到「第 N+1 字节」。
    const truncated = at >= bytes.length;
    let start = at;
    if (truncated) {
      start = bytes.length - 1;
      while (start > 0 && bytes[start] < 0x81) start--;
    }
    const from = Math.max(0, start - 8);
    const to = Math.min(bytes.length, start + 8);
    const parts = [];
    for (let i = from; i < to; i++) parts.push(i === start ? "[" + HX(bytes[i]) + "]" : HX(bytes[i]));
    const where = truncated
      ? "输入在偏移 0x" + start.toString(16) + "（第 " + (start + 1) + " 字节）处截断，多字节序列未完整，共 " + bytes.length + " 字节"
      : "首个失败字节偏移 0x" + start.toString(16) + "（第 " + (start + 1) + " 字节，逐字节流式定位）";
    throw new Error(
      "非法 " + label + " 字节序列：" + where + "，上下文 " + parts.join(" ")
      + "；底层原因：" + (e && e.message ? e.message : String(e)),
    );
  }
}

function mbcsDecodeLossy(bytes, label) {
  const td = new TextDecoder(label, { fatal: false, ignoreBOM: true });
  return td.decode(bytes);
}

/**
 * 字节 → 文本。
 * @param {{charset?:string, strict?:boolean, keepBom?:boolean, sample?:number}} [opts]
 *   charset：'auto'（默认）或任意 CHARSETS 标签 / 别名
 *   strict ：默认 true；false 时按 U+FFFD 有损解码，并在 warnings 里声明
 *   keepBom：默认 false；true 时保留起始 U+FEFF（与 bytesIo 的 ignoreBOM:true 同语义）
 * @returns {{text:string, charset:string, bom:{present:boolean,len:number}, warnings:string[]}}
 */
export function decodeText(bytes, opts) {
  const o = opts || {};
  const b = toBytes(bytes);
  checkBytes(b);
  const strict = o.strict !== false;
  const keepBom = o.keepBom === true;
  const warnings = [];

  let charset;
  const asked = o.charset == null ? "auto" : String(o.charset);
  if (asked.trim().toLowerCase() === "auto") {
    const hit = detectBom(b);
    if (hit) {
      if (hit.charset === "utf-32le" || hit.charset === "utf-32be") {
        throw new Error(
          "检测到 UTF-32 BOM " + hit.bomHex + "（" + hit.bomLen + " 字节）：本模块不提供 UTF-32 编解码，"
          + "也不会把它当 UTF-16 处理（FF FE 00 00 会被误读成 UTF-16LE 的 BOM 加两个 NUL）。请先转码为 UTF-8 或 UTF-16。",
        );
      }
      charset = hit.charset;
    } else {
      const sn = sniffCharset(b, { sample: o.sample });
      charset = sn.best;
      const top = sn.candidates.find((c) => c.charset === charset) || sn.candidates[0];
      warnings.push(
        "按 " + charset + " 猜测解码，置信度 " + (top ? top.confidence.toFixed(3) : "0.000")
        + "，理由：" + (top ? top.reason : "未给出判据") + " 这是猜测，不是事实；请按实际来源确认字符集。",
      );
    }
  } else {
    charset = normalizeCharset(asked);
  }

  const info = charsetInfo(charset);
  const bomBytes = BOM_OF.get(charset) || null;
  let bom = { present: false, len: 0 };
  let start = 0;
  if (bomBytes && startsWithBytes(b, bomBytes)) {
    bom = { present: true, len: bomBytes.length };
    if (!keepBom) start = bomBytes.length;
  }

  let text;
  if (info.kind === "utf8") {
    if (strict) text = utf8DecodeStrict(b, start);
    else {
      text = decodeUtf8Lossy(start === 0 ? b : b.subarray(start));
      warnings.push("strict:false：非法 UTF-8 序列已按 U+FFFD 替换（调用方显式要求，默认不会这样做）。");
    }
  } else if (info.kind === "utf16") {
    if (strict) text = utf16Decode(b, charset === "utf-16le", start);
    else {
      const td = new TextDecoder(charset, { fatal: false, ignoreBOM: true });
      text = td.decode(start === 0 ? b : b.subarray(start));
      warnings.push("strict:false：非法 UTF-16 序列已按 U+FFFD 替换（调用方显式要求，默认不会这样做）。");
    }
  } else if (info.kind === "sbcs") {
    let out = "";
    for (let i = start; i < b.length; i++) out += String.fromCodePoint(sbcsCodePoint(charset, b[i]));
    text = out;
  } else {
    if (strict) text = mbcsDecodeStrict(start === 0 ? b : b.subarray(start), charset);
    else {
      text = mbcsDecodeLossy(start === 0 ? b : b.subarray(start), charset);
      warnings.push("strict:false：" + charset + " 的非法序列已按 U+FFFD 替换（调用方显式要求，默认不会这样做）。");
    }
  }

  return { text, charset, bom, warnings };
}

/* ============================== 编码 ============================== */

function notRepresentableError(ch, cp, label) {
  const shown = JSON.stringify(ch);
  return new Error(
    "字符 " + shown + "（" + HEX4(cp) + "）无法用 " + label + " 表示：该字符集不含此码位。"
    + "请改用 utf-8 或先替换该字符（本模块不会静默回落到 UTF-8 字节）。",
  );
}

/**
 * 文本 → 字节。
 * @param {{charset?:string, bom?:boolean}} [opts]
 *   charset：默认 'utf-8'
 *   bom    ：true 时前置该字符集的 BOM；无 BOM 定义的字符集传 true 会抛错
 * @returns {Uint8Array}
 */
export function encodeText(text, opts) {
  const o = opts || {};
  const s = text == null ? "" : String(text);
  checkText(s);
  const charset = normalizeCharset(o.charset == null ? "utf-8" : o.charset);
  const info = charsetInfo(charset);

  const lone = findLoneSurrogate(s);
  if (lone) throw loneSurrogateError(lone, charset);

  let body;
  if (info.kind === "utf8") {
    body = utf8Encode(s);
  } else if (info.kind === "utf16") {
    body = utf16Encode(s, charset === "utf-16le");
  } else if (info.kind === "sbcs") {
    const out = new Uint8Array(s.length);
    let n = 0;
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      const byte = sbcsByte(charset, cp);
      if (byte < 0) throw notRepresentableError(ch, cp, charset);
      out[n++] = byte;
    }
    body = n === out.length ? out : out.subarray(0, n);
  } else {
    const map = encodeTable(charset);
    const out = [];
    for (const ch of s) {
      const cp = ch.codePointAt(0);
      let seq = map.get(cp);
      if (!seq && charset === "gb18030") {
        if (cp > 0xffff) {
          const p = GB4_SUPP_BASE + (cp - 0x10000);
          if (p <= GB4_MAX_SUPP) seq = gb4PointerToBytes(p);
        } else {
          buildGb4Table(charset, map);
          seq = map.get(cp);
        }
      }
      if (!seq) throw notRepresentableError(ch, cp, charset);
      for (const byte of seq) out.push(byte);
    }
    body = Uint8Array.from(out);
  }

  if (!o.bom) return body;
  const bomBytes = BOM_OF.get(charset);
  if (!bomBytes) {
    throw new Error(
      "字符集 " + charset + " 没有 BOM 定义：BOM 只由 UTF-8 / UTF-16 / UTF-32 定义，"
      + charset + " 的字节流没有可识别的起始标记，前置任意标记都会破坏解码。",
    );
  }
  const out = new Uint8Array(bomBytes.length + body.length);
  out.set(bomBytes, 0);
  out.set(body, bomBytes.length);
  return out;
}

/* ============================== 视图（字节的文本表示） ============================== */

/**
 * 字节 → 文本表示。四个视图都与 viewToBytes 精确互逆。
 * @param {string} view 'text' | 'hex' | 'base64' | 'escaped'
 *   text    —— 必须是合法 UTF-8，否则抛错并提示改用 hex
 *   hex     —— 小写、无分隔
 *   base64  —— 标准表、带 padding
 *   escaped —— 与 bytesIo.bytesToEscapedText 同口径（可打印 ASCII 原样，其余 \xNN，反斜杠转义为 \x5c）
 */
export function bytesToView(bytes, view, opts) {
  const b = toBytes(bytes);
  const v = String(view == null ? "text" : view);
  if (!VIEWS.includes(v)) {
    throw new Error("未知视图 " + JSON.stringify(v) + "：可选 " + VIEWS.join(" / ") + "。");
  }
  if (!b.length) return "";
  if (v === "hex") return bytesToHex(b);
  if (v === "base64") return bytesToB64(b);
  if (v === "escaped") return bytesToEscapedText(b);
  try {
    return utf8DecodeStrict(b, 0);
  } catch (e) {
    const at = firstBadUtf8(b, 0);
    throw new Error(
      "字节流不是合法 UTF-8，不能作为 text 视图输出（首个非法字节偏移 0x" + (at < 0 ? 0 : at).toString(16) + "）："
      + (e && e.message ? e.message : String(e))
      + " 请改用 hex 或 escaped 视图查看原始字节。",
    );
  }
}

function escapedToBytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === "\\") {
      const head = str.slice(i, i + 4);
      const hex = str.slice(i + 2, i + 4);
      if (str[i + 1] !== "x" || !/^[0-9a-fA-F]{2}$/.test(hex)) {
        throw new Error(
          "转义序列非法：偏移 " + i + " 处为 " + JSON.stringify(head)
          + "，本视图只接受 \\xNN 与 0x20–0x7E 的可打印字符（反斜杠本身须写作 \\x5c），上下文 "
          + JSON.stringify(str.slice(Math.max(0, i - 8), i + 8)) + "。",
        );
      }
      out.push(parseInt(hex, 16));
      i += 3;
      continue;
    }
    const cc = str.charCodeAt(i);
    if (cc < 0x20 || cc > 0x7e) {
      throw new Error(
        "字符 " + JSON.stringify(c) + "（" + HEX4(cc) + "，偏移 " + i
        + "）在 escaped 视图中没有单字节形式：非可打印字符必须写成 \\xNN。",
      );
    }
    out.push(cc);
  }
  return new Uint8Array(out);
}

/**
 * 文本表示 → 字节。与 bytesToView 精确互逆。
 * 空串 → 空数组（不是错误）。
 */
export function viewToBytes(str, view) {
  const s = str == null ? "" : String(str);
  const v = String(view == null ? "text" : view);
  if (!VIEWS.includes(v)) {
    throw new Error("未知视图 " + JSON.stringify(v) + "：可选 " + VIEWS.join(" / ") + "。");
  }
  if (!s.length) return new Uint8Array(0);
  if (v === "hex") return hexToBytes(s);
  if (v === "escaped") return escapedToBytes(s);
  if (v === "base64") {
    const t = s.replace(/\s+/g, "");
    const body = t.replace(/=+$/, "");
    if (body.length % 4 === 1) {
      throw new Error(
        "base64 长度非法：有效字符 " + body.length + " 个（4n+1 不可能由整字节产生），原文 "
        + JSON.stringify(t.slice(0, 32)) + "。",
      );
    }
    return b64ToBytes(t);
  }
  const lone = findLoneSurrogate(s);
  if (lone) throw loneSurrogateError(lone, "utf-8");
  return utf8Encode(s);
}

export default {
  CHARSETS, VIEWS, LIMITS,
  detectBom, sniffCharset, decodeText, encodeText, bytesToView, viewToBytes,
  normalizeCharset,
};
