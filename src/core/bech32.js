/*
 * bech32.js — Bech32 / Bech32m / SegWit / Base58Check 地址编码（cat:'radix'）。
 *
 * 覆盖：
 * bech32  BIP173 Bech32 / BIP350 Bech32m 通用编码，双向
 * segwit  BIP173/BIP350 比特币 SegWit v0-v16 地址编码，双向
 * base58check Base58Check 编码（版本字节 + payload + 双 SHA256 校验和），双向
 *
 * 实现说明：
 * - Bech32/Bech32m 按 BIP173/BIP350（BCH 校验和，常量分别为 1 / 0x2bc830a3）。
 * - SegWit：v0 使用 Bech32，v1-v16 使用 Bech32m；program 2-40 字节，v0 限 20/32 字节。
 * - sha256 用 WebCrypto.subtle.digest（浏览器原生）；node 18+ 也支持。
 * - 纯本地计算，零外发。
 *
 * 参考：
 * - BIP173 "Bech32" (https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki)
 * - BIP350 "Bech32m" (https://github.com/bitcoin/bips/blob/master/bip-0350.mediawiki)
 * - Bitcoin Core base58.cpp
 * - Bitcoin Wiki "Base58Check encoding"
 *
 * 契约：register({id, cat:"radix", name, desc, params, encode, decode})。
 * encode/decode 可 async（base58check 需 WebCrypto sha256）
 */
import { register } from "./registry.js";

// ============================================================
// 工具：hex ↔ bytes
// ============================================================
function hexToBytes(s) {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("hex 长度必须为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
function asBytes(input, name) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (Array.isArray(input)) {
    const out = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const b = input[i];
      if (!Number.isInteger(b) || b < 0 || b > 255) {
        throw new Error(name + " 第 " + i + " 项不是 0-255 整数");
      }
      out[i] = b;
    }
    return out;
  }
  throw new Error(name + " 须为 Uint8Array");
}

// ============================================================
// sha256（WebCrypto，返回 bytes）
// ============================================================
async function sha256Bytes(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("当前环境不支持 WebCrypto（需浏览器或 Node 18+）");
  }
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(buf);
}

// ============================================================
// 1. Bech32 / Bech32m（BIP173 / BIP350）
// ============================================================
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;
const BECH32_MAX_LENGTH = 90;
const BECH32_MAX_HRP = 83;
const SEGWIT_HRPS = new Set(["bc", "tb", "bcrt"]);

function normalizeBech32Encoding(value) {
  if (value == null || value === "") return "auto";
  const s = String(value).trim().toLowerCase();
  if (s === "auto") return "auto";
  if (s === "bech32") return "bech32";
  if (s === "bech32m") return "bech32m";
  throw new Error("encoding 须为 auto / Bech32 / Bech32m（实为 " + value + "）");
}
function resolveBech32Encoding(value) {
  const e = normalizeBech32Encoding(value);
  return e === "auto" ? "bech32" : e;
}
function encodingLabel(e) {
  return e === "bech32m" ? "Bech32m" : "Bech32";
}
function encodingConst(e) {
  return e === "bech32m" ? BECH32M_CONST : BECH32_CONST;
}

function normalizeBech32Hrp(hrp) {
  const s = hrp == null ? "" : String(hrp);
  if (s.length < 1 || s.length > BECH32_MAX_HRP) {
    throw new Error("HRP 长度须 1-" + BECH32_MAX_HRP + "（实为 " + s.length + "）");
  }
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c < 33 || c > 126) {
      throw new Error("HRP 含非法字符: '" + ch + "'（须 US-ASCII 33-126）");
    }
  }
  if (s !== s.toLowerCase() && s !== s.toUpperCase()) {
    throw new Error("HRP 不接受混合大小写（BIP173）");
  }
  return s.toLowerCase();
}

function bech32HrpExpand(hrp) {
  const ret = [];
  for (const ch of hrp) {
    const c = ch.charCodeAt(0);
    ret.push(c >> 5);
  }
  ret.push(0);
  for (const ch of hrp) {
    const c = ch.charCodeAt(0);
    ret.push(c & 0x1f);
  }
  return ret;
}

function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function bech32CreateChecksum(hrp, data, encoding = "bech32") {
  const e = resolveBech32Encoding(encoding);
  const values = bech32HrpExpand(hrp).concat(data);
  const polymod = bech32Polymod(values.concat([0, 0, 0, 0, 0, 0])) ^ encodingConst(e);
  const ret = [];
  for (let i = 0; i < 6; i++) {
    ret.push((polymod >> (5 * (5 - i))) & 0x1f);
  }
  return ret;
}

function bech32VerifyChecksum(hrp, data, encoding = "bech32") {
  const e = resolveBech32Encoding(encoding);
  const values = bech32HrpExpand(hrp).concat(data);
  return bech32Polymod(values) === encodingConst(e);
}

function bech32DetectEncoding(hrp, data) {
  const check = bech32Polymod(bech32HrpExpand(hrp).concat(data));
  if (check === BECH32_CONST) return "Bech32";
  if (check === BECH32M_CONST) return "Bech32m";
  return null;
}

function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const ret = [];
  const maxv = (1 << toBits) - 1;
  const maxAcc = (1 << (fromBits + toBits - 1)) - 1;
  for (const b of data) {
    if (b < 0 || b >> fromBits !== 0) {
      throw new Error("convertBits: 值 " + b + " 超出 " + fromBits + " 位范围");
    }
    acc = ((acc << fromBits) | b) & maxAcc;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits) ret.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
    throw new Error("convertBits: 非法填充");
  }
  return ret;
}

function bech32EncodeWords(hrp, data, encoding = "bech32") {
  const e = resolveBech32Encoding(encoding);
  const normHrp = normalizeBech32Hrp(hrp);
  const words = [];
  for (const v of data) {
    if (!Number.isInteger(v) || v < 0 || v > 31) {
      throw new Error("Bech32 data 值须为 0-31 整数（实为 " + v + "）");
    }
    words.push(v);
  }
  const checksum = bech32CreateChecksum(normHrp, words, e);
  const combined = words.concat(checksum);
  let ret = normHrp + "1";
  for (const v of combined) ret += BECH32_CHARSET[v];
  if (ret.length > BECH32_MAX_LENGTH) {
    throw new Error("Bech32 总长度须 ≤ " + BECH32_MAX_LENGTH + "（实为 " + ret.length + "）");
  }
  return ret;
}

function bech32DecodeWords(str, encoding = "auto") {
  const raw = String(str);
  if (raw !== raw.toLowerCase() && raw !== raw.toUpperCase()) {
    throw new Error("Bech32 不接受混合大小写（BIP173）");
  }
  const s = raw.toLowerCase();
  if (s.length < 8 || s.length > BECH32_MAX_LENGTH) {
    throw new Error("Bech32 长度须 8-" + BECH32_MAX_LENGTH + "（实为 " + s.length + "）");
  }
  for (const ch of s) {
    if (ch.charCodeAt(0) < 33 || ch.charCodeAt(0) > 126) {
      throw new Error("Bech32 含非法字符: '" + ch + "'");
    }
  }
  const pos = s.lastIndexOf("1");
  if (pos < 1 || pos + 7 > s.length) {
    throw new Error("Bech32 分隔符 '1' 位置非法");
  }
  const hrp = s.slice(0, pos);
  if (hrp.length > BECH32_MAX_HRP) {
    throw new Error("HRP 长度须 1-" + BECH32_MAX_HRP + "（实为 " + hrp.length + "）");
  }
  const dataPart = s.slice(pos + 1);
  const data = [];
  for (const ch of dataPart) {
    const v = BECH32_CHARSET.indexOf(ch);
    if (v < 0) throw new Error("Bech32 data 含非法字符: '" + ch + "'");
    data.push(v);
  }
  const check = bech32Polymod(bech32HrpExpand(hrp).concat(data));
  let actual;
  if (check === BECH32_CONST) actual = "bech32";
  else if (check === BECH32M_CONST) actual = "bech32m";
  else throw new Error("Bech32/Bech32m 校验和不通过（地址损坏或拼错）");
  const expected = normalizeBech32Encoding(encoding);
  if (expected !== "auto" && expected !== actual) {
    throw new Error(
      "校验和类型为 " + encodingLabel(actual) + "，与要求的 " +
      encodingLabel(expected) + " 不符（BIP350）"
    );
  }
  return { hrp, data: data.slice(0, -6), encoding: encodingLabel(actual) };
}

function bech32Encode(hrp, payloadBytes, encoding = "bech32") {
  const bytes = asBytes(payloadBytes, "bech32 payload");
  const data = convertBits(Array.from(bytes), 8, 5, true);
  return bech32EncodeWords(hrp, data, encoding);
}

function bech32Decode(str, encoding = "auto") {
  const { hrp, data, encoding: actual } = bech32DecodeWords(str, encoding);
  const payload8 = convertBits(data, 5, 8, false);
  return { hrp, payload: new Uint8Array(payload8), encoding: actual };
}

function normalizeWitnessVersion(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 16) {
    throw new Error("witnessVersion 须为 0-16 的整数（实为 " + value + "）");
  }
  return n;
}

function validateWitnessProgram(version, program) {
  if (program.length < 2 || program.length > 40) {
    throw new Error("SegWit program 长度须 2-40 字节（实为 " + program.length + "）");
  }
  if (version === 0 && program.length !== 20 && program.length !== 32) {
    throw new Error("SegWit v0 program 必须 20 或 32 字节（实为 " + program.length + "，BIP141）");
  }
}

function bech32EncodeSegwit(hrp, witnessVersion, programBytes, encoding = "auto") {
  const version = normalizeWitnessVersion(witnessVersion);
  const program = asBytes(programBytes, "SegWit program");
  validateWitnessProgram(version, program);
  const requested = normalizeBech32Encoding(encoding);
  let actual;
  if (requested === "auto") {
    actual = version === 0 ? "bech32" : "bech32m";
  } else {
    actual = requested;
    if (version === 0 && actual !== "bech32") {
      throw new Error("SegWit v0 必须使用 Bech32（BIP350）");
    }
    if (version !== 0 && actual !== "bech32m") {
      throw new Error("SegWit v1-v16 必须使用 Bech32m（BIP350）");
    }
  }
  const data = [version].concat(convertBits(Array.from(program), 8, 5, true));
  return bech32EncodeWords(hrp, data, actual);
}

function bech32DecodeSegwit(str, expectedHrp = null, expectedEncoding = "auto") {
  const { hrp, data, encoding: actual } = bech32DecodeWords(str, expectedEncoding);
  if (expectedHrp != null) {
    const want = String(expectedHrp).trim().toLowerCase();
    if (want && want !== "auto" && hrp !== want) {
      throw new Error("SegWit HRP 须为 '" + want + "'（实为 '" + hrp + "'）");
    }
  } else if (!SEGWIT_HRPS.has(hrp)) {
    throw new Error("SegWit HRP 须为 bc/tb/bcrt（实为 '" + hrp + "'）");
  }
  if (data.length < 1) throw new Error("SegWit data 为空（缺少 witness version）");
  const version = data[0];
  if (version > 16) {
    throw new Error("SegWit witnessVersion 须为 0-16（实为 " + version + "）");
  }
  const program = new Uint8Array(convertBits(data.slice(1), 5, 8, false));
  validateWitnessProgram(version, program);
  const actualEncoding = actual.toLowerCase();
  const wantEncoding = version === 0 ? "bech32" : "bech32m";
  if (actualEncoding !== wantEncoding) {
    throw new Error(
      "SegWit v" + version + " 校验和须为 " + encodingLabel(wantEncoding) +
      "（实为 " + actual + "，BIP350）"
    );
  }
  return {
    hrp,
    witnessVersion: version,
    program,
    payload: program,
    encoding: actual,
  };
}

function normalizeBech32Mode(mode) {
  const s = String(mode == null ? "generic" : mode).trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (s === "" || s === "generic") return "generic";
  if (s === "segwit" || s === "bitcoinsegwit") return "segwit";
  throw new Error("mode 须为 Generic / Bitcoin SegWit（实为 " + mode + "）");
}

function inputTextToBytes(text, inputFormat) {
  const s = String(inputFormat == null ? "hex" : inputFormat).trim().toLowerCase();
  if (s === "raw" || s === "text" || s === "utf8") {
    return new TextEncoder().encode(String(text));
  }
  if (s === "hex") return hexToBytes(String(text));
  throw new Error("inputFormat 须为 hex / raw（实为 " + inputFormat + "）");
}

function bech32EncodeOp(text, p) {
  const opts = p || {};
  const hrp = opts.hrp || "bc";
  const mode = normalizeBech32Mode(opts.mode);
  const encoding = opts.encoding || "auto";
  const bytes = inputTextToBytes(text, opts.inputFormat);
  if (mode === "segwit") {
    return bech32EncodeSegwit(hrp, opts.witnessVersion == null ? 0 : opts.witnessVersion, bytes, encoding);
  }
  return bech32Encode(hrp, bytes, encoding);
}

function bech32DecodeOp(text, p) {
  const opts = p || {};
  const mode = normalizeBech32Mode(opts.mode);
  const encoding = opts.encoding || "auto";
  const s = String(text).trim();
  if (mode === "segwit") {
    const r = bech32DecodeSegwit(s, opts.hrp || null, encoding);
    return "hrp=" + r.hrp + "\nwitnessVersion=" + r.witnessVersion +
      "\nprogram=" + bytesToHex(r.program) + "\nencoding=" + r.encoding;
  }
  const { hrp, payload } = bech32Decode(s, encoding);
  return "hrp=" + hrp + "\npayload=" + bytesToHex(payload);
}

// ============================================================
// 2. Base58Check（Bitcoin）
// ============================================================
const BASE58_CHARS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58Encode(bytes) {
  let zeros = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    zeros++;
  }
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let encoded = "";
  while (num > 0n) {
    const [q, r] = [num / 58n, num % 58n];
    encoded = BASE58_CHARS[Number(r)] + encoded;
    num = q;
  }
  for (let i = 0; i < zeros; i++) encoded = "1" + encoded;
  return encoded;
}

function base58Decode(str) {
  let zeros = 0;
  for (const ch of str) {
    if (ch !== "1") break;
    zeros++;
  }
  let num = 0n;
  for (const ch of str) {
    const v = BASE58_CHARS.indexOf(ch);
    if (v < 0) throw new Error("Base58 含非法字符: '" + ch + "'");
    num = num * 58n + BigInt(v);
  }
  const bytes = [];
  while (num > 0n) {
    const [q, r] = [num / 256n, num % 256n];
    bytes.unshift(Number(r));
    num = q;
  }
  const result = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < zeros; i++) result[i] = 0;
  for (let i = 0; i < bytes.length; i++) result[zeros + i] = bytes[i];
  return result;
}

async function base58CheckEncodeOp(text, p) {
  const version = (p && p.version != null) ? Number(p.version) : 0x00;
  if (!Number.isInteger(version) || version < 0 || version > 255) {
    throw new Error("version 须 0-255（实为 " + version + "）");
  }
  const payload = hexToBytes(text);
  const data = new Uint8Array(1 + payload.length);
  data[0] = version;
  data.set(payload, 1);
  const h1 = await sha256Bytes(data);
  const h2 = await sha256Bytes(h1);
  const checksum = h2.slice(0, 4);
  const full = new Uint8Array(data.length + 4);
  full.set(data, 0);
  full.set(checksum, data.length);
  return base58Encode(full);
}

async function base58CheckDecodeOp(text, p) {
  const full = base58Decode(String(text).trim());
  if (full.length < 5) throw new Error("Base58Check 长度须 ≥ 5（version+payload+4校验），实为 " + full.length);
  const h1 = await sha256Bytes(full.slice(0, -4));
  const h2 = await sha256Bytes(h1);
  const expected = h2.slice(0, 4);
  const actual = full.slice(-4);
  for (let i = 0; i < 4; i++) {
    if (expected[i] !== actual[i]) throw new Error("Base58Check 校验和不通过（地址损坏或拼错）");
  }
  const version = full[0];
  const payload = full.slice(1, -4);
  return "version=0x" + version.toString(16).padStart(2, "0") + "\npayload=" + bytesToHex(payload);
}

// ============================================================
// 注册
// ============================================================
register({
  id: "bech32",
  cat: "radix",
  name: "Bech32 编码",
  desc: "BIP173/BIP350 Bech32/Bech32m 编码与比特币 SegWit v0-v16 地址（HRP + payload + BCH 校验和），支持 hex/raw 输入",
  params: [
    { key: "hrp", label: "HRP（人类可读部分）", type: "text", default: "bc", placeholder: "如 bc（比特币主网）/ tb（测试网）" },
    {
      key: "encoding", label: "校验和标准", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（Generic 默认 Bech32；SegWit 按 BIP350）" },
        { value: "Bech32", label: "Bech32（BIP173）" },
        { value: "Bech32m", label: "Bech32m（BIP350）" },
      ],
    },
    {
      key: "inputFormat", label: "输入格式（编码）", type: "select", default: "hex",
      options: [
        { value: "hex", label: "Hex" },
        { value: "raw", label: "原始文本（UTF-8）" },
      ],
    },
    {
      key: "mode", label: "模式", type: "select", default: "Generic",
      options: [
        { value: "Generic", label: "Generic" },
        { value: "Bitcoin SegWit", label: "Bitcoin SegWit" },
      ],
    },
    {
      key: "witnessVersion", label: "见证版本（SegWit）", type: "number", default: 0,
      placeholder: "0-16；v0=Bech32，v1+=Bech32m",
    },
  ],
  encode: bech32EncodeOp,
  decode: bech32DecodeOp,
});

export {
  BECH32_CHARSET,
  BECH32_CONST,
  BECH32M_CONST,
  BECH32_MAX_LENGTH,
  BECH32_MAX_HRP,
  convertBits,
  bech32HrpExpand,
  bech32Polymod,
  bech32CreateChecksum,
  bech32VerifyChecksum,
  bech32DetectEncoding,
  bech32EncodeWords,
  bech32DecodeWords,
  bech32Encode,
  bech32Decode,
  bech32EncodeSegwit,
  bech32DecodeSegwit,
  bech32EncodeOp,
  bech32DecodeOp,
  base58Encode,
  base58Decode,
  base58CheckEncodeOp,
  base58CheckDecodeOp,
};
