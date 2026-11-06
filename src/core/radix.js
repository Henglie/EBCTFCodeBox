/*
 * radix.js — 进制 / 字符集转换（cat:'radix'）。
 * 任意进制互转、字符↔各进制 ASCII、IEEE754 浮点（半/单/双精度↔十六进制）
 * 数值格雷码互转、BCD 码、二进制补零对齐。
 *
 * 纯数值运算，无外部数据依赖。IEEE754 用 DataView/Float32Array/Float64Array
 * 做位模式转换；半精度（Float16）手动实现（JS 无原生支持）。每个 encode/decode
 * 用往返测试验证。
 */
import { register } from "./registry.js";

const te = (s) => [...new TextEncoder().encode(s)];
const td = (b) => new TextDecoder("utf-8").decode(new Uint8Array(b));

// ============ 1. 任意进制互转（2-36，BigInt 防溢出） ============
const RADIX_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";

function parseBigIntRadix(str, base) {
  const s = str.trim().toLowerCase().replace(/^\+/, "");
  if (!s) throw new Error("空输入");
  let neg = false;
  let body = s;
  if (body[0] === "-") { neg = true; body = body.slice(1); }
  else if (body[0] === "+") body = body.slice(1);
  let num = 0n;
  const b = BigInt(base);
  for (const ch of body) {
    const v = RADIX_CHARS.indexOf(ch);
    if (v < 0 || v >= base) throw new Error("字符 '" + ch + "' 不在基数 " + base + " 的字符集中");
    num = num * b + BigInt(v);
  }
  return neg ? -num : num;
}

function bigIntToRadix(num, base) {
  if (num === 0n) return "0";
  let neg = false;
  let n = num;
  if (n < 0n) { neg = true; n = -n; }
  const b = BigInt(base);
  let out = "";
  while (n > 0n) {
    out = RADIX_CHARS[Number(n % b)] + out;
    n /= b;
  }
  return (neg ? "-" : "") + out;
}

function radixConvert(text, fromBase, toBase) {
  if (fromBase < 2 || fromBase > 36) throw new Error("源进制须在 2-36");
  if (toBase < 2 || toBase > 36) throw new Error("目标进制须在 2-36");
  const n = parseBigIntRadix(text, fromBase);
  return bigIntToRadix(n, toBase);
}

// ============ 2. 字符 ↔ 各进制 ASCII ============
// 每个字符 → charCode 的 base 进制，定宽，空格分隔
// 定宽：bin 8 位, oct 3 位, dec 3 位, hex 2 位（仅对 ASCII 0-255）
// 对 UTF-8 字节序列逐字节转换（支持中文/emoji）
function asciiWidth(base) {
  if (base === 2) return 8;
  if (base === 8) return 3;
  if (base === 10) return 3;
  if (base === 16) return 2;
  return 0; // 其他进制不定宽
}
const ASCII_DELIMS = {
  Space: " ", Comma: ",", "Semi-colon": ";", Colon: ":", "Line feed": "\n", CRLF: "\r\n",
};
function asciiDelimiter(p) {
  const name = (p && p.delimiter) || "Auto";
  if (name === "Auto") return null;
  if (name === "None") return "";
  if (!Object.prototype.hasOwnProperty.call(ASCII_DELIMS, name)) {
    throw new Error("delimiter 须为 Auto/Space/Comma/Semi-colon/Colon/Line feed/CRLF/None（实为 " + name + "）");
  }
  return ASCII_DELIMS[name];
}

// base=2 的二进制变体：bits=7|8 位宽、invert 0/1 取反、
// bitReverse 逐字节位反转（LSB-first）。仅对二进制串有意义，其他 base 忽略这些 opts。
//  - bits：7-bit 是纯 ASCII(<128) 的紧凑写法；8-bit 是标准字节。定宽无空格切分按此宽度。
//  - invert：整串 0↔1 取反。
//  - bitReverse：每组比特首尾镜像（有些编码器按 LSB-first 输出）。
function binWidth(base, opts) {
  if (base === 2) {
    const bl = opts && Number(opts.byteLength);
    if (bl >= 1 && bl <= 256) return bl;
    return (opts && Number(opts.bits) === 7) ? 7 : 8;
  }
  return asciiWidth(base);
}

function asciiEncode(text, base, opts) {
  if (base < 2 || base > 36) throw new Error("进制须在 2-36");
  const w = binWidth(base, opts);
  const delim = asciiDelimiter(opts);
  const bytes = te(text);
  const inv = base === 2 && opts && opts.invert;
  const rev = base === 2 && opts && opts.bitReverse;
  const signed = base === 10 && opts && opts.signed;
  return bytes.map((b) => {
    if (base === 2) {
      if (w === 7 && b > 127) throw new Error("7-bit 只能编码 ASCII（<128），遇到字节 " + b);
      let s = b.toString(2).padStart(w, "0");
      if (rev) s = [...s].reverse().join("");
      if (inv) s = s.replace(/[01]/g, (c) => (c === "0" ? "1" : "0"));
      return s;
    }
    const v = signed && b > 127 ? b - 256 : b;
    const s = bigIntToRadix(BigInt(v), base);
 // compat=true 时不补前导零（外部工具多输出 32 而非 032）；二进制仍定宽，
 // 因为二进制无空格串要靠定宽切分，去掉补零会让解码产生歧义
    if (opts && opts.compat) return s;
    return w ? s.padStart(w, "0") : s;
  }).join(delim == null ? " " : delim);
}

function asciiDecode(text, base, opts) {
  if (base < 2 || base > 36) throw new Error("进制须在 2-36");
  const w = binWidth(base, opts);
  const inv = base === 2 && opts && opts.invert;
  const rev = base === 2 && opts && opts.bitReverse;
  const delim = asciiDelimiter(opts);
  let tokens;
  const trimmed = text.trim();
  if (delim === "") {
    if (w > 0) {
      if (trimmed.length % w !== 0) throw new Error("定宽输入长度不是 " + w + " 的倍数");
      tokens = [];
      for (let i = 0; i < trimmed.length; i += w) tokens.push(trimmed.slice(i, i + w));
    } else {
      tokens = trimmed.split(/\s+/).filter(Boolean);
    }
  } else if (delim != null) {
    tokens = trimmed.split(delim).filter(Boolean);
  } else if (w > 0 && trimmed !== "" && !/\s/.test(trimmed)) {
 // 定宽无空格（如 hex 串 E4B8AD / 二进制串 0110011001101100）：按 width 切分
    if (trimmed.length % w !== 0) throw new Error("定宽无空格输入长度不是 " + w + " 的倍数");
    tokens = [];
    for (let i = 0; i < trimmed.length; i += w) tokens.push(trimmed.slice(i, i + w));
  } else {
    tokens = trimmed.split(/\s+/).filter(Boolean);
  }
  const bytes = [];
  for (const t of tokens) {
    let tok = t;
    if (base === 2 && (inv || rev)) {
      if (inv) tok = tok.replace(/[01]/g, (c) => (c === "0" ? "1" : "0"));
      if (rev) tok = [...tok].reverse().join("");
    }
    let n = parseBigIntRadix(tok, base);
    const tokenBytes = w > 8 ? Math.ceil(w / 8) : 1;
    if (tokenBytes > 1) {
      for (let k = tokenBytes - 1; k >= 0; k--) bytes.push(Number((n >> BigInt(8 * k)) & 0xffn));
      continue;
    }
    if (opts && opts.signed && n < 0n) {
      if (n < -128n) throw new Error("值 " + t + " 超出有符号字节范围 -128..127");
      n += 256n;
    }
    if (n < 0n || n > 255n) throw new Error("值 " + t + " 超出字节范围 0-255");
    bytes.push(Number(n));
  }
  return td(bytes);
}

// ============ 3. IEEE754 浮点 ↔ 十六进制 ============
// half=16bit, single=32bit, double=64bit

// Float16 手动实现（JS 无原生 Float16）
function floatToHalf(f) {
  const buf = new ArrayBuffer(4);
  new Float32Array(buf)[0] = f;
  const bits = new Uint32Array(buf)[0];
  const sign = (bits >>> 16) & 0x8000;
  let exp = (bits >>> 23) & 0xff;
  const man = bits & 0x7fffff;

  if (exp === 0xff) {
 // Inf or NaN
    return sign | 0x7c00 | (man ? 0x200 : 0);
  }
  exp = exp - 127 + 15;
  if (exp >= 31) {
 // overflow → Inf
    return sign | 0x7c00;
  }
  if (exp <= 0) {
 // underflow → denormal (round to nearest, half-to-even 简化为截断)
    const m = (man | 0x800000) >> (1 - exp + 13);
    return sign | m;
  }
  return sign | (exp << 10) | (man >> 13);
}

function halfToFloat(h) {
  const buf = new ArrayBuffer(4);
  const sign = (h & 0x8000) << 16;
  let exp = (h & 0x7c00) >> 10;
  const man = h & 0x3ff;

  if (exp === 0) {
    if (man === 0) {
      new Uint32Array(buf)[0] = sign; // ±0
    } else {
 // denormal → normalize
      let e = 0;
      let m = man;
      while ((m & 0x400) === 0) { m <<= 1; e++; }
      m &= 0x3ff;
      new Uint32Array(buf)[0] = sign | ((15 - e - 1 + 127) << 23) | (m << 13);
    }
  } else if (exp === 31) {
 // Inf or NaN
    new Uint32Array(buf)[0] = sign | 0x7f800000 | (man << 13);
  } else {
 // normal
    new Uint32Array(buf)[0] = sign | ((exp - 15 + 127) << 23) | (man << 13);
  }
  return new Float32Array(buf)[0];
}

function ieeePrecision(p, fallback) {
  const prec = (p && p.precision) || fallback || "single";
  if (prec === "half" || prec === "double") return prec;
  if (p && Number(p.size) === 8) return "double";
  return "single";
}
function ieeeByteLen(precision) {
  return precision === "half" ? 2 : precision === "double" ? 8 : 4;
}
function ieeeSwapEndian(hex) {
  const parts = hex.match(/.{2}/g) || [];
  return parts.reverse().join("");
}
function ieee754Encode(text, precision, opts) {
  precision = ieeePrecision(opts, precision);
  const delim = asciiDelimiter(opts);
  const endian = (opts && opts.endianness) || "Big Endian";
  const tokens = String(text).trim().split(delim == null ? /\s+/ : (delim === "" ? /\s+/ : delim)).filter(Boolean);
  return tokens.map((tok) => {
    const f = Number(tok);
    if (Number.isNaN(f)) throw new Error("无效浮点数: " + tok);
    const buf = new ArrayBuffer(8);
    let hex;
    if (precision === "half") {
      hex = floatToHalf(f).toString(16).padStart(4, "0").toUpperCase();
    } else if (precision === "single") {
      new Float32Array(buf)[0] = f;
      hex = new Uint32Array(buf)[0].toString(16).padStart(8, "0").toUpperCase();
    } else {
      new Float64Array(buf)[0] = f;
      hex = new BigUint64Array(buf)[0].toString(16).padStart(16, "0").toUpperCase();
    }
    return endian === "Little Endian" ? ieeeSwapEndian(hex) : hex;
  }).join(delim == null ? " " : delim);
}

function ieee754Decode(text, precision, opts) {
  precision = ieeePrecision(opts, precision);
  const delim = asciiDelimiter(opts);
  const endian = (opts && opts.endianness) || "Big Endian";
  const len = ieeeByteLen(precision) * 2;
  const raw = String(text).trim();
  const tokens = delim == "" ? (raw.match(new RegExp(".{1," + len + "}", "g")) || []) : raw.split(delim == null ? /\s+/ : delim).filter(Boolean);
  const buf = new ArrayBuffer(8);
  return tokens.map((tok) => {
    let hex = tok.replace(/[^0-9a-fA-F]/g, "");
    if (!hex) throw new Error("无效十六进制: " + tok);
    if (hex.length < len) hex = hex.padEnd(len, "0");
    if (hex.length > len) throw new Error("十六进制长度超出 " + precision + " 精度（" + hex.length + " > " + len + "）");
    if (endian === "Little Endian") hex = ieeeSwapEndian(hex);
    if (precision === "half") {
      return String(halfToFloat(parseInt(hex, 16)));
    } else if (precision === "single") {
      new Uint32Array(buf)[0] = parseInt(hex, 16);
      return String(new Float32Array(buf)[0]);
    } else {
      new BigUint64Array(buf)[0] = BigInt("0x" + hex);
      return String(new Float64Array(buf)[0]);
    }
  }).join(" ");
}

// ============ 5. BCD 码（十进制 ↔ BCD 十六进制串） ============
// 每位十进制数字 → 4 位二进制 → 1 个 hex 字符（0-9）
function bcdEncode(text, p) {
  const s = text.trim().replace(/[^0-9]/g, "");
  if (!s) throw new Error("BCD 输入须为十进制数字串");
  const nibbles = [];
  for (const ch of s) {
    nibbles.push(Number(ch).toString(2).padStart(4, "0"));
  }
 // compat=true 输出 4 位一组的二进制半字节（空格分隔），与多数外部工具一致；
 // 默认输出紧凑 hex 串（每半字节 1 个 hex 字符），两者半字节内容相同
  if (p && p.compat) return nibbles.join(" ");
  return nibbles.map((n) => parseInt(n, 2).toString(16).toUpperCase()).join("");
}

function bcdDecode(text, p) {
 // compat 与 encode 对称：开则按二进制半字节读，关则按 hex 半字节读。
 // 不做自动识别——"0100" 既是 hex 半字节 0,1,0,0 也是二进制半字节 4，靠参数钉死语义
  if (p && p.compat) {
    const bin = text.trim().replace(/[^01]/g, "");
    if (!bin) throw new Error("BCD 兼容模式输入须为二进制半字节串");
    if (bin.length % 4 !== 0) throw new Error("BCD 兼容模式位数须为 4 的倍数");
    let out = "";
    for (let i = 0; i < bin.length; i += 4) {
      const v = parseInt(bin.slice(i, i + 4), 2);
      if (v > 9) throw new Error("BCD 非法半字节 " + bin.slice(i, i + 4) + "（>9）");
      out += v;
    }
    return out;
  }
  const hex = text.trim().replace(/[^0-9a-fA-F]/g, "");
  if (!hex) throw new Error("BCD 输入须为十六进制串");
  let out = "";
  for (const ch of hex) {
    const v = parseInt(ch, 16);
    if (v > 9) throw new Error("BCD 非法数字 " + ch + "（>9）");
    out += v;
  }
  return out;
}

// ============ 6. 二进制补零对齐 ============
// 数字 → 指定位宽的二进制串（补零）
function binPadEncode(text, bits) {
  const n = parseBigIntRadix(text.trim(), 10);
  if (n < 0n) throw new Error("补零对齐输入须为非负整数");
  if (!bits || bits <= 0) bits = 8;
  let bin = n.toString(2);
  if (bin.length > bits) throw new Error("数值 " + text + " 超出 " + bits + " 位");
  return bin.padStart(bits, "0");
}

function binPadDecode(text, bits) {
  const bin = text.trim().replace(/[^01]/g, "");
  if (!bin) throw new Error("无效二进制串");
  const n = parseBigIntRadix(bin, 2);
  return n.toString(10);
}

// ============ CyberChef To/From Charcode（Unicode 码点，Base 2-36，Delimiter） ============
const CHARCODE_DELIMS = { Space: " ", Comma: ",", "Semi-colon": ";", Colon: ":", "Line feed": "\n", CRLF: "\r\n", Tab: "\t" };
function toCharcodeCc(text, p) {
  const base = Number(p && p.charcodeBase != null ? p.charcodeBase : 16);
  if (!Number.isInteger(base) || base < 2 || base > 36) throw new Error("Error: Base argument must be between 2 and 36");
  const delim = CHARCODE_DELIMS[(p && p.charcodeDelimiter) || "Space"] ?? " ";
  const codes = [];
  for (const ch of String(text == null ? "" : text)) codes.push(ch.codePointAt(0));
  return codes.map((cp) => {
    if (base !== 16) return cp.toString(base);
    let pad = 2;
    if (cp >= 256 && cp < 65536) pad = 4;
    else if (cp >= 65536 && cp < 16777216) pad = 6;
    else if (cp >= 16777216) pad = 8;
    return cp.toString(16).toUpperCase().padStart(pad, "0");
  }).join(delim);
}
function fromCharcodeCc(text, p) {
  const base = Number(p && p.charcodeBase != null ? p.charcodeBase : 16);
  if (!Number.isInteger(base) || base < 2 || base > 36) throw new Error("Error: Base argument must be between 2 and 36");
  const delim = CHARCODE_DELIMS[(p && p.charcodeDelimiter) || "Space"] ?? " ";
  const raw = String(text == null ? "" : text);
  if (!raw) return "";
  let tokens = raw.split(delim);
  if (tokens.length === 1 && raw.length > 17) {
    tokens = [];
    for (let i = 0; i < raw.length; i += 2) tokens.push(raw.slice(i, i + 2));
  }
  return tokens.map((tok) => {
    const n = parseInt(String(tok).trim(), base);
    if (Number.isNaN(n)) throw new Error("无效 charcode: " + tok);
    return String.fromCodePoint(n);
  }).join("");
}

// ============ 注册 ============

register({
  id: "radixConvert", cat: "radix", name: "进制互转", desc: "任意进制 2-36 互转（BigInt 防溢出）",
  params: [
    { key: "fromBase", label: "源进制", type: "number", default: 16 },
    { key: "toBase", label: "目标进制", type: "number", default: 2 },
  ],
  encode: (t, p) => radixConvert(t, Number((p && p.fromBase) || 16), Number((p && p.toBase) || 2)),
  decode: (t, p) => radixConvert(t, Number((p && p.toBase) || 2), Number((p && p.fromBase) || 16)),
});

register({
  id: "asciiRadix", cat: "radix", name: "字符↔进制ASCII", desc: "字符↔各进制 ASCII（UTF-8 字节序列，定宽空格分隔；二进制支持 7/8 位、0-1 取反、位反转）",
  params: [
    { key: "base", label: "进制", type: "select", default: 16, options: [
      { value: 2, label: "二进制" }, { value: 8, label: "八进制" },
      { value: 10, label: "十进制" }, { value: 16, label: "十六进制" },
    ] },
    // 以下三项仅二进制（base=2）生效，其他进制忽略。二进制多路解读。
    { key: "bits", label: "位宽（二进制）", type: "select", default: 8, options: [
      { value: 8, label: "8-bit（标准字节）" }, { value: 7, label: "7-bit（纯 ASCII）" },
    ] },
    { key: "invert", label: "0-1 取反（二进制）", type: "bool", default: false },
    { key: "bitReverse", label: "逐字节位反转（二进制）", type: "bool", default: false },
    { key: "delimiter", label: "分隔符", type: "select", default: "Auto",
      options: [
        { value: "Auto", label: "Auto（编码空格 / 解码按空白）" },
        { value: "Space", label: "Space" },
        { value: "Comma", label: "Comma" },
        { value: "Semi-colon", label: "Semi-colon" },
        { value: "Colon", label: "Colon" },
        { value: "Line feed", label: "Line feed" },
        { value: "CRLF", label: "CRLF" },
        { value: "None", label: "None（无分隔）" },
      ] },
    { key: "signed", label: "十进制有符号（-128..127）", type: "bool", default: false },
    { key: "byteLength", label: "二进制位宽（1-256，0=沿用 bits）", type: "number", default: 0 },
    { key: "compat", label: "兼容模式（十/八/十六进制不补前导零）", type: "bool", default: false },
    { key: "charcodeMode", label: "Charcode 模式（Unicode 码点，同 CC To/From Charcode）", type: "bool", default: false },
    { key: "charcodeBase", label: "Charcode Base（2-36）", type: "number", default: 16 },
    { key: "charcodeDelimiter", label: "Charcode Delimiter", type: "select", default: "Space",
      options: [
        { value: "Space", label: "Space" }, { value: "Comma", label: "Comma" },
        { value: "Semi-colon", label: "Semi-colon" }, { value: "Colon", label: "Colon" },
        { value: "Line feed", label: "Line feed" }, { value: "CRLF", label: "CRLF" }, { value: "Tab", label: "Tab" },
      ] },
  ],
  encode: (t, p) => (p && p.charcodeMode ? toCharcodeCc(t, p) : asciiEncode(t, Number((p && p.base) || 16), p)),
  decode: (t, p) => (p && p.charcodeMode ? fromCharcodeCc(t, p) : asciiDecode(t, Number((p && p.base) || 16), p)),
});

register({
  id: "ieee754", cat: "radix", name: "IEEE754 浮点", desc: "浮点↔十六进制（半/单/双精度）",
  params: [
    { key: "precision", label: "精度", type: "select", default: "single", options: [
      { value: "half", label: "半精度 (16 bit)" },
      { value: "single", label: "单精度 (32 bit)" },
      { value: "double", label: "双精度 (64 bit)" },
    ] },
    { key: "size", label: "Size（CC Float(4)/Double(8)）", type: "select", default: 4, options: [
      { value: 4, label: "Float（4 字节）" },
      { value: 8, label: "Double（8 字节）" },
    ] },
    { key: "endianness", label: "端序", type: "select", default: "Big Endian", options: [
      { value: "Big Endian", label: "Big Endian" },
      { value: "Little Endian", label: "Little Endian" },
    ] },
    { key: "delimiter", label: "分隔符", type: "select", default: "Auto", options: [
      { value: "Auto", label: "Auto（空格）" },
      { value: "Space", label: "Space" },
      { value: "Comma", label: "Comma" },
      { value: "Semi-colon", label: "Semi-colon" },
      { value: "Colon", label: "Colon" },
      { value: "Line feed", label: "Line feed" },
      { value: "CRLF", label: "CRLF" },
      { value: "None", label: "None（无分隔）" },
    ] },
  ],
  encode: (t, p) => ieee754Encode(t, (p && p.precision) || "single", p),
  decode: (t, p) => ieee754Decode(t, (p && p.precision) || "single", p),
});

const BCD_SCHEMES = {
  "8 4 2 1": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  "7 4 2 1": [0, 1, 2, 3, 4, 5, 6, 8, 9, 10],
  "4 2 2 1": [0, 1, 4, 5, 8, 9, 12, 13, 14, 15],
  "2 4 2 1": [0, 1, 2, 3, 4, 11, 12, 13, 14, 15],
  "8 4 -2 -1": [0, 7, 6, 5, 4, 11, 10, 9, 8, 15],
  "Excess-3": [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  "IBM 8 4 2 1": [10, 1, 2, 3, 4, 5, 6, 7, 8, 9],
};

function bcdCcEncode(text, p) {
  const scheme = BCD_SCHEMES[(p && p.scheme) || "8 4 2 1"];
  if (!scheme) throw new Error("Unknown BCD scheme");
  const packed = p && p.packed !== false;
  const signed = p && p.signed === true;
  const outFmt = (p && p.ioFormat) || "Nibbles";
  const raw = String(text == null ? "" : text).trim();
  const neg = raw.startsWith("-");
  const s = raw.replace(/[^0-9]/g, "");
  if (!s) throw new Error("Invalid input");
  const digits = s.split("").map(Number);
  let nibbles = digits.map((d) => scheme[d]);
  if (signed) {
    if (packed && digits.length % 2 === 0) nibbles.unshift(scheme[0]);
    nibbles.push(neg ? 13 : 12);
  }
  let bytes = [];
  if (packed) {
    let encoded = 0, little = false;
    for (const n of nibbles) {
      encoded ^= little ? n : (n << 4);
      if (little) { bytes.push(encoded); encoded = 0; }
      little = !little;
    }
    if (little) bytes.push(encoded);
  } else {
    bytes = nibbles.slice();
  }
  if (outFmt === "Nibbles") return nibbles.map((n) => n.toString(2).padStart(4, "0")).join(" ");
  if (outFmt === "Bytes") return bytes.map((b) => b.toString(2).padStart(8, "0")).join(" ");
  let out = "";
  for (const b of bytes) out += String.fromCharCode(b);
  return out;
}

const BCD_LOOKUP = {};
for (const [name, arr] of Object.entries(BCD_SCHEMES)) BCD_LOOKUP[name] = arr;

function bcdCcDecode(text, p) {
  const scheme = BCD_LOOKUP[(p && p.scheme) || "8 4 2 1"];
  if (!scheme) throw new Error("Unknown BCD scheme");
  const packed = p && p.packed !== false;
  const signed = p && p.signed === true;
  const inFmt = (p && p.ioFormat) || "Nibbles";
  const raw = String(text == null ? "" : text);
  let nibbles = [];
  if (inFmt === "Nibbles" || inFmt === "Bytes") {
    const clean = raw.replace(/\s/g, "");
    for (let i = 0; i < clean.length; i += 4) nibbles.push(parseInt(clean.substr(i, 4), 2));
  } else {
    const bytes = new TextEncoder().encode(raw);
    for (const b of bytes) { nibbles.push(b >>> 4); nibbles.push(b & 15); }
  }
  if (!packed) nibbles = nibbles.filter((_, i) => i % 2 === 1);
  let sign = "";
  if (signed) {
    const last = nibbles.pop();
    if (last === 13 || last === 11) sign = "-";
  }
  let out = sign;
  for (const n of nibbles) {
    const val = scheme.indexOf(n);
    if (val < 0) throw new Error("Invalid input");
    out += val;
  }
  if (!out.replace("-", "")) return "0";
  return BigInt(out).toString();
}

register({
  id: "bcd", cat: "radix", name: "BCD 码", desc: "十进制数字串↔BCD 十六进制串；mode=cc 时同 CyberChef From/To BCD（7 种 Scheme/Packed/Signed/Nibbles·Bytes·Raw）",
  params: [
    { key: "compat", label: "兼容模式（二进制半字节，空格分隔）", type: "bool", default: false },
    { key: "mode", label: "模式", type: "select", default: "legacy", options: [
      { value: "legacy", label: "项目旧口径（hex 半字节）" },
      { value: "cc", label: "CyberChef BCD（Scheme/Packed/Signed/格式）" },
    ] },
    { key: "scheme", label: "Scheme", type: "select", default: "8 4 2 1",
      options: Object.keys(BCD_SCHEMES).map((v) => ({ value: v, label: v })) },
    { key: "packed", label: "Packed", type: "bool", default: true },
    { key: "signed", label: "Signed", type: "bool", default: false },
    { key: "ioFormat", label: "Input/Output format", type: "select", default: "Nibbles",
      options: [{ value: "Nibbles", label: "Nibbles" }, { value: "Bytes", label: "Bytes" }, { value: "Raw", label: "Raw" }] },
  ],
  encode: (t, p) => (p && p.mode === "cc" ? bcdCcEncode(t, p) : bcdEncode(t, p)),
  decode: (t, p) => (p && p.mode === "cc" ? bcdCcDecode(t, p) : bcdDecode(t, p)),
});

register({
  id: "binPad", cat: "radix", name: "二进制补零对齐", desc: "十进制数字→指定位宽二进制串（补零）",
  params: [
    { key: "bits", label: "位宽", type: "number", default: 8 },
  ],
  encode: (t, p) => binPadEncode(t, Number((p && p.bits) || 8)),
  decode: (t, p) => binPadDecode(t, Number((p && p.bits) || 8)),
});

export {
  radixConvert, parseBigIntRadix, bigIntToRadix,
  asciiEncode, asciiDecode,
  ieee754Encode, ieee754Decode, floatToHalf, halfToFloat,
  bcdEncode, bcdDecode,
  binPadEncode, binPadDecode,
};
