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

// base=2 的二进制变体：bits=7|8 位宽、invert 0/1 取反、
// bitReverse 逐字节位反转（LSB-first）。仅对二进制串有意义，其他 base 忽略这些 opts。
//   - bits：7-bit 是纯 ASCII(<128) 的紧凑写法；8-bit 是标准字节。定宽无空格切分按此宽度。
//   - invert：整串 0↔1 取反。
//   - bitReverse：每组比特首尾镜像（有些编码器按 LSB-first 输出）。
function binWidth(base, opts) {
  if (base === 2) return (opts && Number(opts.bits) === 7) ? 7 : 8;
  return asciiWidth(base);
}

function asciiEncode(text, base, opts) {
  if (base < 2 || base > 36) throw new Error("进制须在 2-36");
  const w = binWidth(base, opts);
  const bytes = te(text);
  const inv = base === 2 && opts && opts.invert;
  const rev = base === 2 && opts && opts.bitReverse;
  return bytes.map((b) => {
    if (base === 2) {
      if (w === 7 && b > 127) throw new Error("7-bit 只能编码 ASCII（<128），遇到字节 " + b);
      let s = b.toString(2).padStart(w, "0");
      if (rev) s = [...s].reverse().join("");
      if (inv) s = s.replace(/[01]/g, (c) => (c === "0" ? "1" : "0"));
      return s;
    }
    const s = bigIntToRadix(BigInt(b), base);
 // compat=true 时不补前导零（外部工具多输出 32 而非 032）；二进制仍定宽，
 // 因为二进制无空格串要靠定宽切分，去掉补零会让解码产生歧义
    if (opts && opts.compat) return s;
    return w ? s.padStart(w, "0") : s;
  }).join(" ");
}

function asciiDecode(text, base, opts) {
  if (base < 2 || base > 36) throw new Error("进制须在 2-36");
  const w = binWidth(base, opts);
  const inv = base === 2 && opts && opts.invert;
  const rev = base === 2 && opts && opts.bitReverse;
  let tokens;
  const trimmed = text.trim();
  if (w > 0 && trimmed !== "" && !/\s/.test(trimmed)) {
 // 定宽无空格（如 hex 串 E4B8AD / 二进制串 0110011001101100）：按 width 切分
    if (trimmed.length % w !== 0) throw new Error("定宽无空格输入长度不是 " + w + " 的倍数");
    tokens = [];
    for (let i = 0; i < trimmed.length; i += w) tokens.push(trimmed.slice(i, i + w));
  } else {
    tokens = trimmed.split(/\s+/).filter(Boolean);
  }
  const bytes = tokens.map((t) => {
    let tok = t;
    if (base === 2 && (inv || rev)) {
      if (inv) tok = tok.replace(/[01]/g, (c) => (c === "0" ? "1" : "0"));
      if (rev) tok = [...tok].reverse().join("");
    }
    const n = parseBigIntRadix(tok, base);
    if (n < 0n || n > 255n) throw new Error("值 " + t + " 超出字节范围 0-255");
    return Number(n);
  });
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

function ieee754Encode(text, precision) {
  const f = Number(text.trim());
  if (Number.isNaN(f)) throw new Error("无效浮点数: " + text);
  const buf = new ArrayBuffer(8);
  if (precision === "half") {
    const h = floatToHalf(f);
    return h.toString(16).padStart(4, "0").toUpperCase();
  } else if (precision === "single") {
    new Float32Array(buf)[0] = f;
    const u = new Uint32Array(buf)[0];
    return u.toString(16).padStart(8, "0").toUpperCase();
  } else if (precision === "double") {
    new Float64Array(buf)[0] = f;
    const u = new BigUint64Array(buf)[0];
    return u.toString(16).padStart(16, "0").toUpperCase();
  }
  throw new Error("未知精度: " + precision);
}

function ieee754Decode(text, precision) {
  const hex = text.trim().replace(/[^0-9a-fA-F]/g, "");
  const buf = new ArrayBuffer(8);
  if (precision === "half") {
    const h = parseInt(hex.slice(0, 4), 16);
    if (Number.isNaN(h)) throw new Error("无效十六进制: " + text);
    return String(halfToFloat(h));
  } else if (precision === "single") {
    const u = parseInt(hex.slice(0, 8), 16);
    if (Number.isNaN(u)) throw new Error("无效十六进制: " + text);
    new Uint32Array(buf)[0] = u;
    return String(new Float32Array(buf)[0]);
  } else if (precision === "double") {
    const u = BigInt("0x" + hex.slice(0, 16));
    new BigUint64Array(buf)[0] = u;
    return String(new Float64Array(buf)[0]);
  }
  throw new Error("未知精度: " + precision);
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
    { key: "compat", label: "兼容模式（十/八/十六进制不补前导零）", type: "bool", default: false },
  ],
  encode: (t, p) => asciiEncode(t, Number((p && p.base) || 16), p),
  decode: (t, p) => asciiDecode(t, Number((p && p.base) || 16), p),
});

register({
  id: "ieee754", cat: "radix", name: "IEEE754 浮点", desc: "浮点↔十六进制（半/单/双精度）",
  params: [
    { key: "precision", label: "精度", type: "select", default: "single", options: [
      { value: "half", label: "半精度 (16 bit)" },
      { value: "single", label: "单精度 (32 bit)" },
      { value: "double", label: "双精度 (64 bit)" },
    ] },
  ],
  encode: (t, p) => ieee754Encode(t, (p && p.precision) || "single"),
  decode: (t, p) => ieee754Decode(t, (p && p.precision) || "single"),
});

register({
  id: "bcd", cat: "radix", name: "BCD 码", desc: "十进制数字串↔BCD 十六进制串",
  params: [
    { key: "compat", label: "兼容模式（二进制半字节，空格分隔）", type: "bool", default: false },
  ],
  encode: (t, p) => bcdEncode(t, p),
  decode: (t, p) => bcdDecode(t, p),
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
