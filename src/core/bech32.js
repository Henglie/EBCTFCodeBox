/*
 * bech32.js — Bech32 / Base58Check 地址编码（cat:'radix'）。
 *
 * 覆盖：
 * bech32 BIP173 Bech32 编码（HRP + data + 校验和），双向
 * base58check Base58Check 编码（版本字节 + payload + 双 SHA256 校验和），双向
 *
 * 实现说明：
 * - Bech32 按 BIP173（BCH 校验和，多项式见规范）；Base58Check 按 Bitcoin Core。
 * - sha256 用 WebCrypto.subtle.digest（浏览器原生）；node 18+ 也支持。
 * - 纯本地计算，零外发。
 *
 * 参考：
 * - BIP173 "Bech32" (https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki)
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
// 1. Bech32（BIP173）
// ============================================================
// Bech32 = HRP + '1' + data + 6 字节校验和
// HRP（human-readable part）：如 "bc"（比特币主网）、"tb"（测试网）
// data：5 位一组（base32 变体，字母表 0-9a-z，不含 1/b/i/o）
// 校验和：BCH 码，多项式照 BIP173

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST = 1;

// HRP 扩展：每个字符 → 高 3 位 + 低 5 位
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

// BCH 多项式计算（照 BIP173）
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

function bech32CreateChecksum(hrp, data) {
  const values = bech32HrpExpand(hrp).concat(data);
  const polymod = bech32Polymod(values.concat([0, 0, 0, 0, 0, 0])) ^ BECH32_CONST;
  const ret = [];
  for (let i = 0; i < 6; i++) {
    ret.push((polymod >> (5 * (5 - i))) & 0x1f);
  }
  return ret;
}

function bech32VerifyChecksum(hrp, data) {
  const values = bech32HrpExpand(hrp).concat(data);
  return bech32Polymod(values) === BECH32_CONST;
}

// 8 位 → 5 位（用于把 payload 塞进 Bech32 data）
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

// encode: hex payload + hrp → bech32 字符串
function bech32Encode(hrp, payloadBytes) {
  const data = convertBits(Array.from(payloadBytes), 8, 5, true);
  const checksum = bech32CreateChecksum(hrp, data);
  const combined = data.concat(checksum);
  let ret = hrp + "1";
  for (const v of combined) {
    ret += BECH32_CHARSET[v];
  }
  return ret;
}

// decode: bech32 字符串 → { hrp, payload bytes }
function bech32Decode(str) {
  const s = String(str).toLowerCase();
  if (s.length < 8 || s.length > 90) {
    throw new Error("Bech32 长度须 8-90（实为 " + s.length + "）");
  }
 // 检查字符集
  for (const ch of s) {
    if (ch.charCodeAt(0) < 33 || ch.charCodeAt(0) > 126) {
      throw new Error("Bech32 含非法字符: '" + ch + "'");
    }
  }
 // 找最后一个 '1'（分隔符）
  const pos = s.lastIndexOf("1");
  if (pos < 1 || pos + 7 > s.length) {
    throw new Error("Bech32 分隔符 '1' 位置非法");
  }
  const hrp = s.slice(0, pos);
  const dataPart = s.slice(pos + 1);
 // dataPart → 5 位值
  const data = [];
  for (const ch of dataPart) {
    const v = BECH32_CHARSET.indexOf(ch);
    if (v < 0) throw new Error("Bech32 data 含非法字符: '" + ch + "'");
    data.push(v);
  }
 // 校验
  if (!bech32VerifyChecksum(hrp, data)) {
    throw new Error("Bech32 校验和不通过（地址损坏或拼错）");
  }
 // 去掉 6 字节校验和，剩 payload（5 位）
  const payload5 = data.slice(0, -6);
 // 5 位 → 8 位
  const payload8 = convertBits(payload5, 5, 8, false);
  return { hrp, payload: new Uint8Array(payload8) };
}

// register 层
function bech32EncodeOp(text, p) {
  const hrp = (p && p.hrp) || "bc";
  const payload = hexToBytes(text);
  return bech32Encode(hrp, payload);
}

function bech32DecodeOp(text, p) {
  const { hrp, payload } = bech32Decode(text);
  return "hrp=" + hrp + "\npayload=" + bytesToHex(payload);
}

// ============================================================
// 2. Base58Check（Bitcoin）
// ============================================================
// Base58 字母表（Bitcoin，照 Bitcoin Core base58.cpp）
const BASE58_CHARS = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// bytes → base58
function base58Encode(bytes) {
 // 统计前导 0
  let zeros = 0;
  for (const b of bytes) {
    if (b !== 0) break;
    zeros++;
  }
 // 大整数除法（用 BigInt）
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let encoded = "";
  while (num > 0n) {
    const [q, r] = [num / 58n, num % 58n];
    encoded = BASE58_CHARS[Number(r)] + encoded;
    num = q;
  }
 // 前导 0 → '1'
  for (let i = 0; i < zeros; i++) encoded = "1" + encoded;
  return encoded;
}

// base58 → bytes
function base58Decode(str) {
 // 统计前导 '1'
  let zeros = 0;
  for (const ch of str) {
    if (ch !== "1") break;
    zeros++;
  }
 // 大整数累加
  let num = 0n;
  for (const ch of str) {
    const v = BASE58_CHARS.indexOf(ch);
    if (v < 0) throw new Error("Base58 含非法字符: '" + ch + "'");
    num = num * 58n + BigInt(v);
  }
 // 转 bytes
  const bytes = [];
  while (num > 0n) {
    const [q, r] = [num / 256n, num % 256n];
    bytes.unshift(Number(r));
    num = q;
  }
 // 前导 '1' → 0x00
  const result = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < zeros; i++) result[i] = 0;
  for (let i = 0; i < bytes.length; i++) result[zeros + i] = bytes[i];
  return result;
}

// base58check encode: version(1) + payload + 双 sha256 前 4 字节
async function base58CheckEncodeOp(text, p) {
  const version = (p && p.version != null) ? Number(p.version) : 0x00;
  if (!Number.isInteger(version) || version < 0 || version > 255) {
    throw new Error("version 须 0-255（实为 " + version + "）");
  }
  const payload = hexToBytes(text);
  const data = new Uint8Array(1 + payload.length);
  data[0] = version;
  data.set(payload, 1);
 // 双 sha256
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
 // 校验
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
  desc: "BIP173 Bech32 编码（HRP + payload + BCH 校验和，比特币地址用），hex payload ↔ bech32 地址",
  params: [
    { key: "hrp", label: "HRP（人类可读部分）", type: "text", default: "bc", placeholder: "如 bc（比特币主网）/ tb（测试网）" },
  ],
  encode: bech32EncodeOp,
  decode: bech32DecodeOp,
});
// 注: base58check 已在 baseExt.js 存在（cat:base），本文件不重复注册，避免 id 冲突。
// base58CheckEncodeOp/base58CheckDecodeOp 函数保留供未来扩展（如 version 参数差异化），但不再 register。
