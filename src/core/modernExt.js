/*
 * modernExt.js — 现代加密扩展组。
 *
 * 覆盖：TEA / XTEA / XXTEA / SM4（国密）—— WebCrypto 没有的纯 JS 分组/流密码。
 * 编码工具自写；填充统一复用 modern.js 导出的 padBytes/unpadBytes（全项目唯一事实来源），
 * 分组模式仍自写，避免循环依赖。
 *
 * 红线：
 * - TEA/XTEA/XXTEA 走标准算法（Wheeler 1994 / Needham 1997），用权威测试向量验证。
 * - SM4 走国密标准 GB/T 32907-2016（前身 GM/T 0002-2012），S 盒 / CK / FK 常数照抄标准不许编造。
 *   工作模式照 GB/T 17964-2021《分组密码算法的工作模式》（ECB/CBC/CFB/OFB/CTR）+ SP 800-38D（GCM）。
 * - 零外发：全部本地纯 JS 计算。
 * - 契约：核心算法层纯函数（字节进字节出），register 层负责编码（hex/base64/utf8）解析与拼装。
 *
 * 分层：
 * [TEA 内核] teaEncryptBlock / teaDecryptBlock — 8 字节块级变换（64位块，128位密钥，32轮 Feistel）
 * [XTEA 内核] xteaEncryptBlock / xteaDecryptBlock — 8 字节块级变换（改进密钥调度，轮数可调）
 * [XXTEA 内核] xxteaEncryptBytes / xxteaDecryptBytes — 可变长度块（n×32位，n≥2），整个数据一次性加密
 * [SM4 内核] sm4EncryptBlock / sm4DecryptBlock — 16 字节块级变换（GB/T 32907-2016，32轮非线性迭代）
 * [分组模式] ecb/cbc/cfb/ofb/ctr（自写，避免依赖 modern.js）+ GCM（SP 800-38D 构造）
 * [填充] 复用 modern.js 的 padBytes/unpadBytes（pkcs7/none/zero/bit/iso10126/ansix923）
 * [高层 API] teaEncrypt/teaDecrypt / xteaEncrypt/xteaDecrypt / xxteaEncrypt/xxteaDecrypt / sm4Encrypt/sm4Decrypt
 * [register] 编码解析（key/iv/data 的 hex|base64|utf8|latin1）+ 双向注册
 *
 * 供「密钥+密文一键尝试」后续扩展复用。
 */
import { register } from "./registry.js";
import { padBytes, unpadBytes, PADDING_OPTIONS } from "./modern.js";

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

// ============================================================
// 字节 <-> 编码 工具（hex / base64 / utf8 / latin1）
// ============================================================
function hexToBytes(s) {
  const clean = String(s == null ? "" : s).replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error("非法 hex 字符（仅允许 0-9/A-F 与空白）");
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
function b64ToBytes(s) {
  const bin = atob(s.replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(b) {
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin);
}
function decodeInput(text, enc) {
  switch (enc) {
    case "hex": return hexToBytes(text);
    case "base64": return b64ToBytes(text);
    case "latin1": { const o = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) o[i] = text.charCodeAt(i) & 0xff; return o; }
    case "utf8":
    default: return te(text);
  }
}
function encodeOutput(bytes, enc) {
  switch (enc) {
    case "hex": return bytesToHex(bytes);
    case "base64": return bytesToB64(bytes);
    case "latin1": { let s = ""; for (const x of bytes) s += String.fromCharCode(x); return s; }
    case "utf8":
    default: return td(bytes);
  }
}

// ============================================================
// 32 位整数运算工具
// ============================================================
// 大端读取：4 字节 -> uint32
function readU32BE(bytes, off) {
  return ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;
}
// 大端写入：uint32 -> 4 字节
function writeU32BE(bytes, off, v) {
  bytes[off] = (v >>> 24) & 0xff;
  bytes[off + 1] = (v >>> 16) & 0xff;
  bytes[off + 2] = (v >>> 8) & 0xff;
  bytes[off + 3] = v & 0xff;
}
// 循环左移
function rotl(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }

// ============================================================
// 分组模式（ECB/CBC，自写避免依赖 modern.js；填充走统一实现）
// ============================================================
function xorBytes(a, b) {
  const o = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] ^ b[i];
  return o;
}
function ecbEncrypt(data, encBlock, bs, pad = true) {
  const d = padBytes(data, bs, pad);
  const out = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i += bs) out.set(encBlock(d.subarray(i, i + bs)), i);
  return out;
}
function ecbDecrypt(data, decBlock, bs, pad = true) {
  if (data.length % bs) throw new Error(`密文需为 ${bs} 字节整数倍`);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += bs) out.set(decBlock(data.subarray(i, i + bs)), i);
  return unpadBytes(out, bs, pad);
}
function cbcEncrypt(data, encBlock, bs, iv, pad = true) {
  const d = padBytes(data, bs, pad);
  const out = new Uint8Array(d.length);
  let prev = iv.subarray(0, bs);
  for (let i = 0; i < d.length; i += bs) {
    const blk = encBlock(xorBytes(d.subarray(i, i + bs), prev));
    out.set(blk, i);
    prev = blk;
  }
  return out;
}
function cbcDecrypt(data, decBlock, bs, iv, pad = true) {
  if (data.length % bs) throw new Error(`密文需为 ${bs} 字节整数倍`);
  const out = new Uint8Array(data.length);
  let prev = iv.subarray(0, bs);
  for (let i = 0; i < data.length; i += bs) {
    const cblk = data.subarray(i, i + bs);
    out.set(xorBytes(decBlock(cblk), prev), i);
    prev = cblk;
  }
  return unpadBytes(out, bs, pad);
}

// ============================================================
// TEA 内核（Wheeler 1994，Tiny Encryption Algorithm）
// 64 位块，128 位密钥（4×uint32），32 轮 Feistel
// delta = 0x9E3779B9（黄金分割常数 (sqrt(5)-1)/2 * 2^32）
// ============================================================
const TEA_DELTA = 0x9E3779B9;
const TEA_ROUNDS = 32;
const TEA_SUM_FINAL = (TEA_DELTA * TEA_ROUNDS) >>> 0; // 0xC6EF3720，解密初始 sum

function teaEncryptBlock(block, key) {
  const k = [readU32BE(key, 0), readU32BE(key, 4), readU32BE(key, 8), readU32BE(key, 12)];
  let v0 = readU32BE(block, 0);
  let v1 = readU32BE(block, 4);
  let sum = 0;
  for (let i = 0; i < TEA_ROUNDS; i++) {
    sum = (sum + TEA_DELTA) >>> 0;
    v0 = (v0 + ((((v1 << 4) >>> 0) + k[0]) ^ (v1 + sum) ^ ((v1 >>> 5) + k[1]))) >>> 0;
    v1 = (v1 + ((((v0 << 4) >>> 0) + k[2]) ^ (v0 + sum) ^ ((v0 >>> 5) + k[3]))) >>> 0;
  }
  const out = new Uint8Array(8);
  writeU32BE(out, 0, v0);
  writeU32BE(out, 4, v1);
  return out;
}

function teaDecryptBlock(block, key) {
  const k = [readU32BE(key, 0), readU32BE(key, 4), readU32BE(key, 8), readU32BE(key, 12)];
  let v0 = readU32BE(block, 0);
  let v1 = readU32BE(block, 4);
  let sum = TEA_SUM_FINAL;
  for (let i = 0; i < TEA_ROUNDS; i++) {
    v1 = (v1 - ((((v0 << 4) >>> 0) + k[2]) ^ (v0 + sum) ^ ((v0 >>> 5) + k[3]))) >>> 0;
    v0 = (v0 - ((((v1 << 4) >>> 0) + k[0]) ^ (v1 + sum) ^ ((v1 >>> 5) + k[1]))) >>> 0;
    sum = (sum - TEA_DELTA) >>> 0;
  }
  const out = new Uint8Array(8);
  writeU32BE(out, 0, v0);
  writeU32BE(out, 4, v1);
  return out;
}

// ============================================================
// XTEA 内核（Needham 1997，扩展 TEA，改进密钥调度）
// 64 位块，128 位密钥（4×uint32），轮数可调（默认 32）
// ============================================================
function xteaNormRounds(rounds) {
  if (rounds == null || rounds === "") return TEA_ROUNDS;
  const n = Number(rounds);
  if (!Number.isInteger(n) || n < 1 || n > 255) throw new Error("XTEA rounds 需为 1..255 的整数");
  return n;
}
function xteaEncryptBlock(block, key, rounds = TEA_ROUNDS) {
  const R = xteaNormRounds(rounds);
  const k = [readU32BE(key, 0), readU32BE(key, 4), readU32BE(key, 8), readU32BE(key, 12)];
  let v0 = readU32BE(block, 0);
  let v1 = readU32BE(block, 4);
  let sum = 0;
  for (let i = 0; i < R; i++) {
    v0 = (v0 + (((((v1 << 4) >>> 0) ^ (v1 >>> 5)) + v1) ^ (sum + k[sum & 3]))) >>> 0;
    sum = (sum + TEA_DELTA) >>> 0;
    v1 = (v1 + (((((v0 << 4) >>> 0) ^ (v0 >>> 5)) + v0) ^ (sum + k[(sum >>> 11) & 3]))) >>> 0;
  }
  const out = new Uint8Array(8);
  writeU32BE(out, 0, v0);
  writeU32BE(out, 4, v1);
  return out;
}

function xteaDecryptBlock(block, key, rounds = TEA_ROUNDS) {
  const R = xteaNormRounds(rounds);
  const k = [readU32BE(key, 0), readU32BE(key, 4), readU32BE(key, 8), readU32BE(key, 12)];
  let v0 = readU32BE(block, 0);
  let v1 = readU32BE(block, 4);
  let sum = (TEA_DELTA * R) >>> 0;
  for (let i = 0; i < R; i++) {
    v1 = (v1 - (((((v0 << 4) >>> 0) ^ (v0 >>> 5)) + v0) ^ (sum + k[(sum >>> 11) & 3]))) >>> 0;
    sum = (sum - TEA_DELTA) >>> 0;
    v0 = (v0 - (((((v1 << 4) >>> 0) ^ (v1 >>> 5)) + v1) ^ (sum + k[sum & 3]))) >>> 0;
  }
  const out = new Uint8Array(8);
  writeU32BE(out, 0, v0);
  writeU32BE(out, 4, v1);
  return out;
}

// ============================================================
// XXTEA 内核（Wheeler 1998，可变长度块 TEA）
// 整个数据作为 n×uint32 数组一次性加密，n ≥ 2
// delta = 0x9E3779B9，Q = 6 + 52/n 轮
// ============================================================
function xxteaEncryptBytes(bytes, key) {
  if (bytes.length < 8 || bytes.length % 4 !== 0) {
    throw new Error("XXTEA 数据需 ≥ 8 字节且 4 字节对齐");
  }
  if (key.length !== 16) throw new Error("XXTEA 密钥需 16 字节");

  const n = bytes.length / 4;
  const v = new Array(n);
  for (let i = 0; i < n; i++) v[i] = readU32BE(bytes, i * 4);
  const k = [readU32BE(key, 0), readU32BE(key, 4), readU32BE(key, 8), readU32BE(key, 12)];

  const Q = 6 + Math.floor(52 / n);
  let sum = 0;
  let z = v[n - 1];
  let y, e, mx;

  for (let q = 0; q < Q; q++) {
    sum = (sum + TEA_DELTA) >>> 0;
    e = (sum >>> 2) & 3;
    for (let p = 0; p < n - 1; p++) {
      y = v[p + 1];
      mx = (((z >>> 5) ^ ((y << 4) >>> 0)) + ((y >>> 3) ^ ((z << 4) >>> 0))) ^ ((sum ^ y) + (k[(p & 3) ^ e] ^ z));
      v[p] = (v[p] + mx) >>> 0;
      z = v[p];
    }
 // p = n - 1
    y = v[0];
    const p = n - 1;
    mx = (((z >>> 5) ^ ((y << 4) >>> 0)) + ((y >>> 3) ^ ((z << 4) >>> 0))) ^ ((sum ^ y) + (k[(p & 3) ^ e] ^ z));
    v[p] = (v[p] + mx) >>> 0;
    z = v[p];
  }

  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) writeU32BE(out, i * 4, v[i]);
  return out;
}

function xxteaDecryptBytes(bytes, key) {
  if (bytes.length < 8 || bytes.length % 4 !== 0) {
    throw new Error("XXTEA 数据需 ≥ 8 字节且 4 字节对齐");
  }
  if (key.length !== 16) throw new Error("XXTEA 密钥需 16 字节");

  const n = bytes.length / 4;
  const v = new Array(n);
  for (let i = 0; i < n; i++) v[i] = readU32BE(bytes, i * 4);
  const k = [readU32BE(key, 0), readU32BE(key, 4), readU32BE(key, 8), readU32BE(key, 12)];

  const Q = 6 + Math.floor(52 / n);
  let sum = (Math.imul(Q, TEA_DELTA)) >>> 0;
  let y = v[0];
  let z, e, mx;

  for (let q = 0; q < Q; q++) {
    e = (sum >>> 2) & 3;
    for (let p = n - 1; p >= 1; p--) {
      z = v[p - 1];
      mx = (((z >>> 5) ^ ((y << 4) >>> 0)) + ((y >>> 3) ^ ((z << 4) >>> 0))) ^ ((sum ^ y) + (k[(p & 3) ^ e] ^ z));
      v[p] = (v[p] - mx) >>> 0;
      y = v[p];
    }
 // p = 0
    z = v[n - 1];
    mx = (((z >>> 5) ^ ((y << 4) >>> 0)) + ((y >>> 3) ^ ((z << 4) >>> 0))) ^ ((sum ^ y) + (k[(0 & 3) ^ e] ^ z));
    v[0] = (v[0] - mx) >>> 0;
    y = v[0];
    sum = (sum - TEA_DELTA) >>> 0;
  }

  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) writeU32BE(out, i * 4, v[i]);
  return out;
}

// ============================================================
// SM4 内核（国密标准 GM/T 0002-2012）
// 128 位块，128 位密钥，32 轮非线性迭代
// S 盒 / CK / FK 常数照抄标准不许编造（红线）
// ============================================================
const SM4_SBOX = new Uint8Array([
  0xd6, 0x90, 0xe9, 0xfe, 0xcc, 0xe1, 0x3d, 0xb7, 0x16, 0xb6, 0x14, 0xc2, 0x28, 0xfb, 0x2c, 0x05,
  0x2b, 0x67, 0x9a, 0x76, 0x2a, 0xbe, 0x04, 0xc3, 0xaa, 0x44, 0x13, 0x26, 0x49, 0x86, 0x06, 0x99,
  0x9c, 0x42, 0x50, 0xf4, 0x91, 0xef, 0x98, 0x7a, 0x33, 0x54, 0x0b, 0x43, 0xed, 0xcf, 0xac, 0x62,
  0xe4, 0xb3, 0x1c, 0xa9, 0xc9, 0x08, 0xe8, 0x95, 0x80, 0xdf, 0x94, 0xfa, 0x75, 0x8f, 0x3f, 0xa6,
  0x47, 0x07, 0xa7, 0xfc, 0xf3, 0x73, 0x17, 0xba, 0x83, 0x59, 0x3c, 0x19, 0xe6, 0x85, 0x4f, 0xa8,
  0x68, 0x6b, 0x81, 0xb2, 0x71, 0x64, 0xda, 0x8b, 0xf8, 0xeb, 0x0f, 0x4b, 0x70, 0x56, 0x9d, 0x35,
  0x1e, 0x24, 0x0e, 0x5e, 0x63, 0x58, 0xd1, 0xa2, 0x25, 0x22, 0x7c, 0x3b, 0x01, 0x21, 0x78, 0x87,
  0xd4, 0x00, 0x46, 0x57, 0x9f, 0xd3, 0x27, 0x52, 0x4c, 0x36, 0x02, 0xe7, 0xa0, 0xc4, 0xc8, 0x9e,
  0xea, 0xbf, 0x8a, 0xd2, 0x40, 0xc7, 0x38, 0xb5, 0xa3, 0xf7, 0xf2, 0xce, 0xf9, 0x61, 0x15, 0xa1,
  0xe0, 0xae, 0x5d, 0xa4, 0x9b, 0x34, 0x1a, 0x55, 0xad, 0x93, 0x32, 0x30, 0xf5, 0x8c, 0xb1, 0xe3,
  0x1d, 0xf6, 0xe2, 0x2e, 0x82, 0x66, 0xca, 0x60, 0xc0, 0x29, 0x23, 0xab, 0x0d, 0x53, 0x4e, 0x6f,
  0xd5, 0xdb, 0x37, 0x45, 0xde, 0xfd, 0x8e, 0x2f, 0x03, 0xff, 0x6a, 0x72, 0x6d, 0x6c, 0x5b, 0x51,
  0x8d, 0x1b, 0xaf, 0x92, 0xbb, 0xdd, 0xbc, 0x7f, 0x11, 0xd9, 0x5c, 0x41, 0x1f, 0x10, 0x5a, 0xd8,
  0x0a, 0xc1, 0x31, 0x88, 0xa5, 0xcd, 0x7b, 0xbd, 0x2d, 0x74, 0xd0, 0x12, 0xb8, 0xe5, 0xb4, 0xb0,
  0x89, 0x69, 0x97, 0x4a, 0x0c, 0x96, 0x77, 0x7e, 0x65, 0xb9, 0xf1, 0x09, 0xc5, 0x6e, 0xc6, 0x84,
  0x18, 0xf0, 0x7d, 0xec, 0x3a, 0xdc, 0x4d, 0x20, 0x79, 0xee, 0x5f, 0x3e, 0xd7, 0xcb, 0x39, 0x48,
]);

const SM4_FK = [0xa3b1bac6, 0x56aa3350, 0x677d9197, 0xb27022dc];
const SM4_CK = [
  0x00070e15, 0x1c232a31, 0x383f464d, 0x545b6269,
  0x70777e85, 0x8c939aa1, 0xa8afb6bd, 0xc4cbd2d9,
  0xe0e7eef5, 0xfc030a11, 0x181f262d, 0x343b4249,
  0x50575e65, 0x6c737a81, 0x888f969d, 0xa4abb2b9,
  0xc0c7ced5, 0xdce3eaf1, 0xf8ff060d, 0x141b2229,
  0x30373e45, 0x4c535a61, 0x686f767d, 0x848b9299,
  0xa0a7aeb5, 0xbcc3cad1, 0xd8dfe6ed, 0xf4fb0209,
  0x10171e25, 0x2c333a41, 0x484f565d, 0x646b7279,
];

// τ 非线性替换：32 位每字节过 S 盒
function sm4Tau(a) {
  return ((SM4_SBOX[(a >>> 24) & 0xff] << 24) |
    (SM4_SBOX[(a >>> 16) & 0xff] << 16) |
    (SM4_SBOX[(a >>> 8) & 0xff] << 8) |
    SM4_SBOX[a & 0xff]) >>> 0;
}
// L 线性变换（加密用）
function sm4L(b) { return (b ^ rotl(b, 2) ^ rotl(b, 10) ^ rotl(b, 18) ^ rotl(b, 24)) >>> 0; }
// L' 线性变换（密钥扩展用）
function sm4Lprime(b) { return (b ^ rotl(b, 13) ^ rotl(b, 23)) >>> 0; }
// T = L ∘ τ（加密用）
function sm4T(x) { return sm4L(sm4Tau(x)); }
// T' = L' ∘ τ（密钥扩展用）
function sm4Tprime(x) { return sm4Lprime(sm4Tau(x)); }

function sm4KeyExpansion(key) {
  const mk = [readU32BE(key, 0), readU32BE(key, 4), readU32BE(key, 8), readU32BE(key, 12)];
  const k = [mk[0] ^ SM4_FK[0], mk[1] ^ SM4_FK[1], mk[2] ^ SM4_FK[2], mk[3] ^ SM4_FK[3]];
  const rk = new Array(32);
  for (let i = 0; i < 32; i++) {
    const tmp = (k[1] ^ k[2] ^ k[3] ^ SM4_CK[i]) >>> 0;
    rk[i] = (k[0] ^ sm4Tprime(tmp)) >>> 0;
    k[0] = k[1]; k[1] = k[2]; k[2] = k[3]; k[3] = rk[i];
  }
  return rk;
}

function sm4CryptBlock(block, rk) {
  let x = [readU32BE(block, 0), readU32BE(block, 4), readU32BE(block, 8), readU32BE(block, 12)];
  for (let i = 0; i < 32; i++) {
    const tmp = (x[1] ^ x[2] ^ x[3] ^ rk[i]) >>> 0;
    const newX = (x[0] ^ sm4T(tmp)) >>> 0;
    x[0] = x[1]; x[1] = x[2]; x[2] = x[3]; x[3] = newX;
  }
 // 密文 = (X[35], X[34], X[33], X[32]) = 逆序
  const out = new Uint8Array(16);
  writeU32BE(out, 0, x[3]);
  writeU32BE(out, 4, x[2]);
  writeU32BE(out, 8, x[1]);
  writeU32BE(out, 12, x[0]);
  return out;
}

function sm4EncryptBlock(block, key) {
  return sm4CryptBlock(block, sm4KeyExpansion(key));
}
function sm4DecryptBlock(block, key) {
  const rk = sm4KeyExpansion(key);
  rk.reverse(); // 解密用逆序 rk
  return sm4CryptBlock(block, rk);
}

// ============================================================
// 小端 32 位读写（Salsa20 / ChaCha20 用小端序，与 TEA/SM4 的大端相反）
// ============================================================
function readU32LE(bytes, off) {
  return ((bytes[off]) | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
}
function writeU32LE(bytes, off, v) {
  bytes[off] = v & 0xff;
  bytes[off + 1] = (v >>> 8) & 0xff;
  bytes[off + 2] = (v >>> 16) & 0xff;
  bytes[off + 3] = (v >>> 24) & 0xff;
}

// ============================================================
// Salsa20 内核（Bernstein，20 轮流密码）
// 常数 sigma="expand 32-byte k"（256位密钥）/ tau="expand 16-byte k"（128位密钥）
// 状态 16×uint32：常数(4)、密钥(8)、nonce(2)、64位块计数器(2)
// ============================================================
// 常数字（小端读 ASCII）
const SALSA_SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]; // "expand 32-byte k"
const SALSA_TAU   = [0x61707865, 0x3120646e, 0x79622d36, 0x6b206574]; // "expand 16-byte k"

const STREAM_ROUNDS = new Set([20, 12, 8]);
function salsaNormRounds(rounds) {
  if (rounds == null || rounds === "") return 20;
  const n = Number(rounds);
  if (!STREAM_ROUNDS.has(n)) throw new Error("Rounds must be 20/12/8");
  return n;
}

// Salsa20 核心变换：state(16 words) -> keystream block(64 字节)
// rounds 为总轮数（8/12/20），内部按双轮（列轮+行轮）循环 rounds/2 次。
function salsa20Block(state, rounds = 20) {
  const R = salsaNormRounds(rounds);
  const x = state.slice();
  for (let i = 0; i < R / 2; i++) {
 // 列轮
    x[4]  = (x[4]  ^ rotl((x[0]  + x[12]) >>> 0, 7)) >>> 0;
    x[8]  = (x[8]  ^ rotl((x[4]  + x[0])  >>> 0, 9)) >>> 0;
    x[12] = (x[12] ^ rotl((x[8]  + x[4])  >>> 0, 13)) >>> 0;
    x[0]  = (x[0]  ^ rotl((x[12] + x[8])  >>> 0, 18)) >>> 0;
    x[9]  = (x[9]  ^ rotl((x[5]  + x[1])  >>> 0, 7)) >>> 0;
    x[13] = (x[13] ^ rotl((x[9]  + x[5])  >>> 0, 9)) >>> 0;
    x[1]  = (x[1]  ^ rotl((x[13] + x[9])  >>> 0, 13)) >>> 0;
    x[5]  = (x[5]  ^ rotl((x[1]  + x[13]) >>> 0, 18)) >>> 0;
    x[14] = (x[14] ^ rotl((x[10] + x[6])  >>> 0, 7)) >>> 0;
    x[2]  = (x[2]  ^ rotl((x[14] + x[10]) >>> 0, 9)) >>> 0;
    x[6]  = (x[6]  ^ rotl((x[2]  + x[14]) >>> 0, 13)) >>> 0;
    x[10] = (x[10] ^ rotl((x[6]  + x[2])  >>> 0, 18)) >>> 0;
    x[3]  = (x[3]  ^ rotl((x[15] + x[11]) >>> 0, 7)) >>> 0;
    x[7]  = (x[7]  ^ rotl((x[3]  + x[15]) >>> 0, 9)) >>> 0;
    x[11] = (x[11] ^ rotl((x[7]  + x[3])  >>> 0, 13)) >>> 0;
    x[15] = (x[15] ^ rotl((x[11] + x[7])  >>> 0, 18)) >>> 0;
 // 行轮
    x[1]  = (x[1]  ^ rotl((x[0]  + x[3])  >>> 0, 7)) >>> 0;
    x[2]  = (x[2]  ^ rotl((x[1]  + x[0])  >>> 0, 9)) >>> 0;
    x[3]  = (x[3]  ^ rotl((x[2]  + x[1])  >>> 0, 13)) >>> 0;
    x[0]  = (x[0]  ^ rotl((x[3]  + x[2])  >>> 0, 18)) >>> 0;
    x[6]  = (x[6]  ^ rotl((x[5]  + x[4])  >>> 0, 7)) >>> 0;
    x[7]  = (x[7]  ^ rotl((x[6]  + x[5])  >>> 0, 9)) >>> 0;
    x[4]  = (x[4]  ^ rotl((x[7]  + x[6])  >>> 0, 13)) >>> 0;
    x[5]  = (x[5]  ^ rotl((x[4]  + x[7])  >>> 0, 18)) >>> 0;
    x[11] = (x[11] ^ rotl((x[10] + x[9])  >>> 0, 7)) >>> 0;
    x[8]  = (x[8]  ^ rotl((x[11] + x[10]) >>> 0, 9)) >>> 0;
    x[9]  = (x[9]  ^ rotl((x[8]  + x[11]) >>> 0, 13)) >>> 0;
    x[10] = (x[10] ^ rotl((x[9]  + x[8])  >>> 0, 18)) >>> 0;
    x[12] = (x[12] ^ rotl((x[15] + x[14]) >>> 0, 7)) >>> 0;
    x[13] = (x[13] ^ rotl((x[12] + x[15]) >>> 0, 9)) >>> 0;
    x[14] = (x[14] ^ rotl((x[13] + x[12]) >>> 0, 13)) >>> 0;
    x[15] = (x[15] ^ rotl((x[14] + x[13]) >>> 0, 18)) >>> 0;
  }
  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i++) writeU32LE(out, i * 4, (x[i] + state[i]) >>> 0);
  return out;
}

// 由密钥(16/32 字节)+nonce(8 字节) 构造 Salsa20 初始状态（counter=起始块号）
function salsa20State(key, nonce, counter) {
  const c = key.length === 32 ? SALSA_SIGMA : SALSA_TAU;
  const s = new Array(16);
  s[0] = c[0]; s[5] = c[1]; s[10] = c[2]; s[15] = c[3];
 // 256位：key 前16字节 -> s[1..4]，后16字节 -> s[11..14]
 // 128位：同一 16 字节填两处
  const kOff2 = key.length === 32 ? 16 : 0;
  s[1] = readU32LE(key, 0);  s[2] = readU32LE(key, 4);  s[3] = readU32LE(key, 8);  s[4] = readU32LE(key, 12);
  s[11] = readU32LE(key, kOff2); s[12] = readU32LE(key, kOff2 + 4); s[13] = readU32LE(key, kOff2 + 8); s[14] = readU32LE(key, kOff2 + 12);
  s[6] = readU32LE(nonce, 0); s[7] = readU32LE(nonce, 4);
 // 64位块计数器（小端）
  s[8] = counter >>> 0;
  s[9] = Math.floor(counter / 0x100000000) >>> 0;
  return s;
}

/** Salsa20 流加密（自反）。key 16 或 32 字节，nonce 8 字节，counter 起始块号，rounds 总轮数 20/12/8。 */
export function salsa20(data, key, nonce, counter = 0, rounds = 20) {
  if (key.length !== 16 && key.length !== 32) throw new Error("Salsa20 密钥须为 16 或 32 字节");
  if (nonce.length !== 8) throw new Error("Salsa20 nonce 须为 8 字节");
  const R = salsaNormRounds(rounds);
  const out = new Uint8Array(data.length);
  let blk = counter;
  for (let i = 0; i < data.length; i += 64) {
    const state = salsa20State(key, nonce, blk);
    const ks = salsa20Block(state, R);
    const n = Math.min(64, data.length - i);
    for (let j = 0; j < n; j++) out[i + j] = data[i + j] ^ ks[j];
    blk++;
  }
  return out;
}

// ============================================================
// ChaCha20 内核（RFC 8439，20 轮流密码，32位块计数器 + 96位 nonce）
// 状态 16×uint32：常数(4)、密钥(8)、计数器(1)、nonce(3)
// ============================================================
const CHACHA_CONST = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]; // "expand 32-byte k"

// QuarterRound（就地操作 x 数组指定下标）
function chachaQR(x, a, b, c, d) {
  x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl(x[d] ^ x[a], 16);
  x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl(x[b] ^ x[c], 12);
  x[a] = (x[a] + x[b]) >>> 0; x[d] = rotl(x[d] ^ x[a], 8);
  x[c] = (x[c] + x[d]) >>> 0; x[b] = rotl(x[b] ^ x[c], 7);
}

function chacha20Block(state, rounds = 20) {
  const R = salsaNormRounds(rounds);
  const x = state.slice();
  for (let i = 0; i < R / 2; i++) {
 // 列轮
    chachaQR(x, 0, 4, 8, 12);
    chachaQR(x, 1, 5, 9, 13);
    chachaQR(x, 2, 6, 10, 14);
    chachaQR(x, 3, 7, 11, 15);
 // 对角轮
    chachaQR(x, 0, 5, 10, 15);
    chachaQR(x, 1, 6, 11, 12);
    chachaQR(x, 2, 7, 8, 13);
    chachaQR(x, 3, 4, 9, 14);
  }
  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i++) writeU32LE(out, i * 4, (x[i] + state[i]) >>> 0);
  return out;
}

// 由密钥(32 字节)+nonce 构造 ChaCha20 初始状态
// nonce = 12 字节 → RFC 8439（32 位块计数器 + 96 位 nonce）
// nonce = 8 字节  → 原版 ChaCha（64 位块计数器 + 64 位 nonce）
function chacha20State(key, nonce, counter) {
  const s = new Array(16);
  s[0] = CHACHA_CONST[0]; s[1] = CHACHA_CONST[1]; s[2] = CHACHA_CONST[2]; s[3] = CHACHA_CONST[3];
  for (let i = 0; i < 8; i++) s[4 + i] = readU32LE(key, i * 4);
  s[12] = counter >>> 0;
  if (nonce.length === 12) {
    s[13] = readU32LE(nonce, 0);
    s[14] = readU32LE(nonce, 4);
    s[15] = readU32LE(nonce, 8);
  } else {
    s[13] = Math.floor(counter / 0x100000000) >>> 0;
    s[14] = readU32LE(nonce, 0);
    s[15] = readU32LE(nonce, 4);
  }
  return s;
}

/** ChaCha20 流加密（自反）。key 32 字节；nonce 12 字节（RFC 8439）或 8 字节（原版 64 位计数器）；rounds 20/12/8。 */
export function chacha20(data, key, nonce, counter = 0, rounds = 20) {
  if (key.length !== 32) throw new Error("ChaCha20 密钥须为 32 字节");
  if (nonce.length !== 12 && nonce.length !== 8) throw new Error("ChaCha20 nonce 须为 12 字节（RFC 8439）或 8 字节（原版）");
  const R = salsaNormRounds(rounds);
  const out = new Uint8Array(data.length);
  let blk = Number(counter) || 0;
  if (blk < 0 || !Number.isInteger(blk)) throw new Error("ChaCha20 初始计数器须为非负整数");
  for (let i = 0; i < data.length; i += 64) {
    const state = chacha20State(key, nonce, blk);
    const ks = chacha20Block(state, R);
    const n = Math.min(64, data.length - i);
    for (let j = 0; j < n; j++) out[i + j] = data[i + j] ^ ks[j];
    blk = nonce.length === 8 ? blk + 1 : (blk + 1) >>> 0;
  }
  return out;
}

// ============================================================
// xorStrings（多进制循环异或，参考同类实现 xor_strings）
// 与 modern.js 的 xor 区别：短的一侧循环补齐到较长一侧，输出长度 = max(len)
// ============================================================
/** 循环异或：两侧各自循环补齐到 max(len)，逐字节异或。自反。 */
export function xorExtend(a, b) {
  if (a.length === 0 || b.length === 0) throw new Error("xorStrings 明文与密钥都不能为空");
  const max = Math.max(a.length, b.length);
  const out = new Uint8Array(max);
  for (let i = 0; i < max; i++) out[i] = a[i % a.length] ^ b[i % b.length];
  return out;
}

// ============================================================
// 高层 API（给 register 层 + 后续扩展复用）
// ============================================================
const BLOCK_MODES = new Set(["ECB", "CBC", "CFB", "OFB", "CTR"]);

function validateBlockIv(iv, bs, mode) {
  if (mode === "ECB") return new Uint8Array(bs);
  if (!iv || iv.length !== bs) throw new Error(`${mode} 模式 IV 需 ${bs} 字节`);
  return iv;
}

function encryptBlockMode(data, encBlock, bs, mode, iv, pad) {
  const ivv = validateBlockIv(iv, bs, mode);
  switch (mode) {
    case "ECB": return ecbEncrypt(data, encBlock, bs, pad);
    case "CBC": return cbcEncrypt(data, encBlock, bs, ivv, pad);
    case "CFB": return cfbEncrypt(data, encBlock, bs, ivv);
    case "OFB": return ofbCrypt(data, encBlock, bs, ivv);
    case "CTR": return ctrCrypt(data, encBlock, bs, ivv);
  }
}

function decryptBlockMode(data, encBlock, decBlock, bs, mode, iv, pad) {
  const ivv = validateBlockIv(iv, bs, mode);
  switch (mode) {
    case "ECB": return ecbDecrypt(data, decBlock, bs, pad);
    case "CBC": return cbcDecrypt(data, decBlock, bs, ivv, pad);
    case "CFB": return cfbDecrypt(data, encBlock, bs, ivv);
    case "OFB": return ofbCrypt(data, encBlock, bs, ivv);
    case "CTR": return ctrCrypt(data, encBlock, bs, ivv);
  }
}

export function teaEncrypt(data, key, { mode = "ECB", iv, pad = true, padding } = {}) {
  mode = mode.toUpperCase();
  if (!BLOCK_MODES.has(mode)) throw new Error(`不支持的 TEA 模式: ${mode}`);
  if (key.length !== 16) throw new Error("TEA 密钥需 16 字节");
  return encryptBlockMode(data, (b) => teaEncryptBlock(b, key), 8, mode, iv, padding === undefined ? pad : padding);
}
export function teaDecrypt(data, key, { mode = "ECB", iv, pad = true, padding } = {}) {
  mode = mode.toUpperCase();
  if (!BLOCK_MODES.has(mode)) throw new Error(`不支持的 TEA 模式: ${mode}`);
  if (key.length !== 16) throw new Error("TEA 密钥需 16 字节");
  return decryptBlockMode(data, (b) => teaEncryptBlock(b, key), (b) => teaDecryptBlock(b, key), 8, mode, iv, padding === undefined ? pad : padding);
}

export function xteaEncrypt(data, key, { mode = "ECB", iv, pad = true, padding, rounds = TEA_ROUNDS } = {}) {
  mode = mode.toUpperCase();
  if (!BLOCK_MODES.has(mode)) throw new Error(`不支持的 XTEA 模式: ${mode}`);
  if (key.length !== 16) throw new Error("XTEA 密钥需 16 字节");
  const R = xteaNormRounds(rounds);
  return encryptBlockMode(data, (b) => xteaEncryptBlock(b, key, R), 8, mode, iv, padding === undefined ? pad : padding);
}
export function xteaDecrypt(data, key, { mode = "ECB", iv, pad = true, padding, rounds = TEA_ROUNDS } = {}) {
  mode = mode.toUpperCase();
  if (!BLOCK_MODES.has(mode)) throw new Error(`不支持的 XTEA 模式: ${mode}`);
  if (key.length !== 16) throw new Error("XTEA 密钥需 16 字节");
  const R = xteaNormRounds(rounds);
  return decryptBlockMode(data, (b) => xteaEncryptBlock(b, key, R), (b) => xteaDecryptBlock(b, key, R), 8, mode, iv, padding === undefined ? pad : padding);
}

export function xxteaEncrypt(data, key) {
  if (key.length !== 16) throw new Error("XXTEA 密钥需 16 字节");
 // PKCS7 padding 到 8 字节块，保证 ≥ 8 字节且 4 字节对齐
  const padded = padBytes(data, 8, "pkcs7");
  return xxteaEncryptBytes(padded, key);
}
export function xxteaDecrypt(data, key) {
  if (key.length !== 16) throw new Error("XXTEA 密钥需 16 字节");
  const decrypted = xxteaDecryptBytes(data, key);
  return unpadBytes(decrypted, 8, "pkcs7");
}

const SM4_MODES = new Set(["ECB", "CBC", "CFB", "OFB", "CTR", "GCM"]);

export function sm4Encrypt(data, key, { mode = "ECB", iv, aad, pad = true, padding, tagLen = 16 } = {}) {
  mode = mode.toUpperCase();
  if (key.length !== 16) throw new Error("SM4 密钥需 16 字节");
  const padOpt = padding === undefined ? pad : padding;
  if (mode === "GCM") {
    if (!iv || iv.length === 0) throw new Error("SM4-GCM 需提供非空 nonce（IV）");
    return sm4GcmEncrypt(data, key, iv, aad, tagLen);
  }
  if (!SM4_MODES.has(mode)) throw new Error(`不支持的 SM4 模式: ${mode}`);
  if (mode !== "ECB" && (!iv || iv.length !== 16)) throw new Error(`SM4-${mode} IV 需 16 字节`);
  const encBlock = (b) => sm4EncryptBlock(b, key);
  const ivv = iv || new Uint8Array(16);
  switch (mode) {
    case "ECB": return ecbEncrypt(data, encBlock, 16, padOpt);
    case "CBC": return cbcEncrypt(data, encBlock, 16, ivv, padOpt);
    case "CFB": return cfbEncrypt(data, encBlock, 16, ivv); // 流模式，无填充
    case "OFB": return ofbCrypt(data, encBlock, 16, ivv);
    case "CTR": return ctrCrypt(data, encBlock, 16, ivv);
    default: throw new Error(`不支持的 SM4 模式: ${mode}`);
  }
}
export function sm4Decrypt(data, key, { mode = "ECB", iv, aad, pad = true, padding, tagLen = 16 } = {}) {
  mode = mode.toUpperCase();
  if (key.length !== 16) throw new Error("SM4 密钥需 16 字节");
  const padOpt = padding === undefined ? pad : padding;
  if (mode === "GCM") {
    if (!iv || iv.length === 0) throw new Error("SM4-GCM 需提供非空 nonce（IV）");
    return sm4GcmDecrypt(data, key, iv, aad, tagLen);
  }
  if (!SM4_MODES.has(mode)) throw new Error(`不支持的 SM4 模式: ${mode}`);
  if (mode !== "ECB" && (!iv || iv.length !== 16)) throw new Error(`SM4-${mode} IV 需 16 字节`);
  const encBlock = (b) => sm4EncryptBlock(b, key);
  const ivv = iv || new Uint8Array(16);
  switch (mode) {
    case "ECB": return ecbDecrypt(data, (b) => sm4DecryptBlock(b, key), 16, padOpt);
    case "CBC": return cbcDecrypt(data, (b) => sm4DecryptBlock(b, key), 16, ivv, padOpt);
    case "CFB": return cfbDecrypt(data, encBlock, 16, ivv); // CFB 解密也用加密函数（反馈 XOR）
    case "OFB": return ofbCrypt(data, encBlock, 16, ivv);
    case "CTR": return ctrCrypt(data, encBlock, 16, ivv);
    default: throw new Error(`不支持的 SM4 模式: ${mode}`);
  }
}

// ============================================================
// SM4 全工作模式（GB/T 17964-2021《分组密码算法的工作模式》）
// CFB / OFB / CTR 为流模式（无填充），自写避免依赖 modern.js。
// ============================================================
// CFB（密文反馈，128 位分段）：Ci = Pi ⊕ E_K(feedback)，反馈恒为密文块（初值 IV）。
// 加密：反馈 = 本轮密文输出；解密：反馈 = 本轮输入密文（非解出明文）。
function cfbEncrypt(data, encBlock, bs, iv) {
  const out = new Uint8Array(data.length);
  let fb = iv.subarray(0, bs);
  for (let i = 0; i < data.length; i += bs) {
    const ks = encBlock(fb);
    const n = Math.min(bs, data.length - i);
    const c = new Uint8Array(bs);
    for (let j = 0; j < n; j++) c[j] = data[i + j] ^ ks[j];
    out.set(c.subarray(0, n), i);
    fb = c;
  }
  return out;
}
function cfbDecrypt(data, encBlock, bs, iv) {
  const out = new Uint8Array(data.length);
  let fb = iv.subarray(0, bs);
  for (let i = 0; i < data.length; i += bs) {
    const ks = encBlock(fb);
    const n = Math.min(bs, data.length - i);
    const c = new Uint8Array(bs);
    for (let j = 0; j < n; j++) { c[j] = data[i + j]; out[i + j] = data[i + j] ^ ks[j]; }
    fb = c;
  }
  return out;
}
// OFB（输出反馈）：O_{i+1} = E_K(O_i)，Pi ⊕ O。
function ofbCrypt(data, encBlock, bs, iv) {
  const out = new Uint8Array(data.length);
  let fb = iv.subarray(0, bs);
  for (let i = 0; i < data.length; i += bs) {
    fb = encBlock(fb);
    const n = Math.min(bs, data.length - i);
    for (let j = 0; j < n; j++) out[i + j] = data[i + j] ^ fb[j];
  }
  return out;
}
// CTR（计数器）：Ci = Pi ⊕ E_K(counter++)，counter 为 128 位大端递增（SP 800-38A）。
function ctrCrypt(data, encBlock, bs, iv) {
  const out = new Uint8Array(data.length);
  const ctr = Uint8Array.from(iv.subarray(0, bs)); // Buffer.slice is a view, not a copy.
  for (let i = 0; i < data.length; i += bs) {
    const ks = encBlock(ctr);
    const n = Math.min(bs, data.length - i);
    for (let j = 0; j < n; j++) out[i + j] = data[i + j] ^ ks[j];
    incCounter(ctr);
  }
  return out;
}
function incCounter(ctr) {
  for (let i = ctr.length - 1; i >= 0; i--) {
    ctr[i] = (ctr[i] + 1) & 0xff;
    if (ctr[i] !== 0) break;
  }
  return ctr;
}

// ============================================================
// SM4-GCM（认证加密，纯 JS —— WebCrypto 无 SM4，AES-GCM 那套不可用）
// 构造照 NIST SP 800-38D：H = E_K(0^128)，J0 = IV‖0^31‖1（IV=12B）或 GHASH_H(IV)，
// GCTR 加密，GHASH 认证。输出 = ciphertext ‖ tag(16B)。
// ============================================================

// GF(2^128) 乘法（SP 800-38D §6.3 Algorithm 2，MSB-first 位序，reduction 多项式 0xE10000…0）
// 注意：MSB-first 表示下「乘 x」= 右移（a128 移出，MSB 补 0），不能用左移。
function gcmMul(x, y) {
  let X = 0n, Y = 0n;
  for (let i = 0; i < 16; i++) { X = (X << 8n) | BigInt(x[i]); Y = (Y << 8n) | BigInt(y[i]); }
  const R = 0xe1000000000000000000000000000000n;
  let Z = 0n, V = X;
  for (let i = 0; i < 128; i++) {
    if ((Y >> BigInt(127 - i)) & 1n) Z ^= V; // 从 Y 的 MSB 逐位检查
    if (V & 1n) V = (V >> 1n) ^ R; else V >>= 1n;
  }
  const out = new Uint8Array(16);
  for (let i = 15; i >= 0; i--) { out[i] = Number(Z & 0xffn); Z >>= 8n; }
  return out;
}
// 按 16 字节块累加 GHASH：Y_i = (Y_{i-1} ⊕ X_i) · H，最后补 len(A)‖len(C)（各 64 位）。
function gcmGhash(h, aad, c) {
  const y = new Uint8Array(16);
  let acc = y;
  const blocks = [];
  for (let i = 0; i < aad.length; i += 16) blocks.push(aad.subarray(i, i + 16));
  for (let i = 0; i < c.length; i += 16) blocks.push(c.subarray(i, i + 16));
  const full = new Uint8Array(16);
  for (const b of blocks) {
    full.fill(0);
    full.set(b);
    acc = gcmMul(xorBytes(acc, full), h);
  }
  // len(A)‖len(C)，各 64 位大端（输入以字节计，×8 转位；< 2^53 安全）
  const lenBlock = new Uint8Array(16);
  const la = BigInt(aad.length * 8), lc = BigInt(c.length * 8);
  lenBlock[0] = Number((la >> 56n) & 0xffn); lenBlock[1] = Number((la >> 48n) & 0xffn);
  lenBlock[2] = Number((la >> 40n) & 0xffn); lenBlock[3] = Number((la >> 32n) & 0xffn);
  lenBlock[4] = Number((la >> 24n) & 0xffn); lenBlock[5] = Number((la >> 16n) & 0xffn);
  lenBlock[6] = Number((la >> 8n) & 0xffn);  lenBlock[7] = Number(la & 0xffn);
  lenBlock[8]  = Number((lc >> 56n) & 0xffn); lenBlock[9]  = Number((lc >> 48n) & 0xffn);
  lenBlock[10] = Number((lc >> 40n) & 0xffn); lenBlock[11] = Number((lc >> 32n) & 0xffn);
  lenBlock[12] = Number((lc >> 24n) & 0xffn); lenBlock[13] = Number((lc >> 16n) & 0xffn);
  lenBlock[14] = Number((lc >> 8n) & 0xffn);  lenBlock[15] = Number(lc & 0xffn);
  return gcmMul(xorBytes(acc, lenBlock), h);
}
// 计数器低位 +1（32 位递增，照 SP 800-38D inc32）
function inc32(cb) {
  const o = cb.slice();
  for (let i = 15; i >= 12; i--) { o[i] = (o[i] + 1) & 0xff; if (o[i] !== 0) break; }
  return o;
}
// GCTR：C = P ⊕ E_K(ICB++）
function gcmGctr(encBlock, icb, data) {
  const out = new Uint8Array(data.length);
  let cb = icb.slice();
  for (let i = 0; i < data.length; i += 16) {
    const ks = encBlock(cb);
    const n = Math.min(16, data.length - i);
    for (let j = 0; j < n; j++) out[i + j] = data[i + j] ^ ks[j];
    cb = inc32(cb);
  }
  return out;
}
// J0：IV=12 字节 → IV‖0^31‖1；否则 J0 = GHASH_H(IV‖0^(s+64)‖[len(IV)]_64)
// 注：整串作为 GHASH 数据（不追加 AAD/C 长度块），长度字段内嵌在串末尾。
function gcmJ0(encBlock, iv) {
  if (iv.length === 12) {
    const j0 = new Uint8Array(16);
    j0.set(iv);
    j0[15] = 1;
    return j0;
  }
  const h = encBlock(new Uint8Array(16));
  const s = (16 - (iv.length % 16)) % 16; // 补到块边界的零字节数
  const buf = new Uint8Array(iv.length + s + 16);
  buf.set(iv, 0);
  const bitLen = BigInt(iv.length * 8);
  const off = iv.length + s + 8; // 0^(s+64) 后 8 字节放 len(IV)
  for (let i = 0; i < 8; i++) buf[off + i] = Number((bitLen >> BigInt(56 - 8 * i)) & 0xffn);
  const full = new Uint8Array(16);
  let acc = new Uint8Array(16);
  for (let i = 0; i < buf.length; i += 16) {
    full.fill(0);
    full.set(buf.subarray(i, i + 16));
    acc = gcmMul(xorBytes(acc, full), h);
  }
  return acc;
}
// SM4-GCM tag 长度（字节），与 SP 800-38D 允许的截断档一致
const SM4_GCM_TAG_LENS = new Set([4, 8, 12, 13, 14, 15, 16]);
function sm4NormTagLen(tagLen) {
  if (tagLen == null || tagLen === "") return 16;
  const n = Number(tagLen);
  if (!SM4_GCM_TAG_LENS.has(n)) throw new Error("SM4-GCM tag 长度仅支持 4/8/12/13/14/15/16 字节");
  return n;
}
// SM4-GCM 加密：返回 ciphertext ‖ tag（tagLen 字节，默认 16）
export function sm4GcmEncrypt(data, key, iv, aad, tagLen = 16) {
  const tl = sm4NormTagLen(tagLen);
  const encBlock = (b) => sm4EncryptBlock(b, key);
  const h = encBlock(new Uint8Array(16));
  const j0 = gcmJ0(encBlock, iv);
  const c = gcmGctr(encBlock, inc32(j0), data);
  const s = gcmGhash(h, aad || new Uint8Array(0), c);
  const t = gcmGctr(encBlock, j0, s).subarray(0, tl);
  const out = new Uint8Array(c.length + tl);
  out.set(c, 0);
  out.set(t, c.length);
  return out;
}
// SM4-GCM 解密：输入 ciphertext ‖ tag，tag 校验失败抛错
export function sm4GcmDecrypt(data, key, iv, aad, tagLen = 16) {
  const tl = sm4NormTagLen(tagLen);
  if (data.length < tl) throw new Error("SM4-GCM 密文过短（需含 tag）");
  const c = data.subarray(0, data.length - tl);
  const tag = data.subarray(data.length - tl);
  const encBlock = (b) => sm4EncryptBlock(b, key);
  const h = encBlock(new Uint8Array(16));
  const j0 = gcmJ0(encBlock, iv);
  const s = gcmGhash(h, aad || new Uint8Array(0), c);
  const t = gcmGctr(encBlock, j0, s).subarray(0, tl);
  let diff = 0;
  for (let i = 0; i < tl; i++) diff |= tag[i] ^ t[i];
  if (diff !== 0) throw new Error("SM4-GCM tag 校验失败（密钥/IV/密文可能错误）");
  return gcmGctr(encBlock, inc32(j0), c);
}

// ============================================================
// register 层（编码解析 + 双向注册）
// ============================================================
/** 取视图真字节通道（params.rawBytes）；无则 null。 */
function rawBytesOf(p) {
  const b = p && p.rawBytes;
  if (b == null) return null;
  return b instanceof Uint8Array ? b : new Uint8Array(b);
}

/** 视图 text 模式字节与文本同构时让位给原文本层；真字节（hex/base64 视图、文件）原样优先。 */
function rawBytesOrNull(p, text) {
  const b = rawBytesOf(p);
  if (!b) return null;
  const t = new TextEncoder().encode(String(text == null ? "" : text));
  if (b.length === t.length) {
    let same = true;
    for (let i = 0; i < b.length; i++) if (b[i] !== t[i]) { same = false; break; }
    if (same) return null;
  }
  return b;
}

const ENC_OPTS = [
  { value: "utf8", label: "UTF-8" },
  { value: "hex", label: "Hex" },
  { value: "base64", label: "Base64" },
  { value: "latin1", label: "Latin1" },
];

function blockParams(modes, keyHint) {
  const params = [
    { key: "key", label: "密钥", type: "text", default: "", placeholder: keyHint },
    { key: "keyEnc", label: "密钥编码", type: "select", default: "utf8", options: ENC_OPTS },
    { key: "mode", label: "模式", type: "select", default: "ECB", options: modes.map((m) => ({ value: m, label: m })) },
    { key: "iv", label: "IV / Nonce", type: "text", default: "", placeholder: "hex（CBC/CFB/OFB/CTR 需 IV，GCM 为 12 字节 nonce）" },
    { key: "ivEnc", label: "IV 编码", type: "select", default: "hex", options: ENC_OPTS },
    { key: "padding", label: "填充（ECB/CBC 用；流模式忽略）", type: "select", default: "pkcs7", options: PADDING_OPTIONS },
  ];
  if (modes.includes("GCM")) {
    params.push(
      { key: "aad", label: "AAD（仅 GCM）", type: "text", default: "", placeholder: "认证附加数据（UTF-8，可空）" },
      { key: "includeIv", label: "IV 包含方式（仅 GCM）", type: "select", default: "off",
        options: [
          { value: "off", label: "不包含（默认，ct‖tag）" },
          { value: "prepend", label: "前置（iv‖ct‖tag）" },
          { value: "append", label: "后置（ct‖tag‖iv）" },
        ] },
      { key: "tagLen", label: "GCM tag 位数", type: "select", default: "128",
        options: [128, 120, 112, 104, 96, 64, 32].map((n) => ({ value: String(n), label: `${n} 位` })) },
      { key: "ivLen", label: "Include IV 长度（解密用）", type: "select", default: "12",
        options: [12, 16].map((n) => ({ value: String(n), label: `${n} 字节` })) },
      { key: "tag", label: "tag（仅 GCM 解密可选）", type: "text", default: "", placeholder: "留空取密文末；独立 tag 时单独粘贴" },
      { key: "tagEnc", label: "tag 编码（仅独立 tag）", type: "select", default: "hex", options: ENC_OPTS },
    );
  }
  params.push({ key: "outEnc", label: "密文编码", type: "select", default: "base64", options: ENC_OPTS });
  return params;
}

function normIncludeIv(v) {
  const s = String(v == null || v === "" ? "off" : v).toLowerCase();
  if (s === "off" || s === "prepend" || s === "append") return s;
  throw new Error(`IV 包含方式仅支持 off/prepend/append（当前 ${v}）`);
}
function concatBytes(...arrs) {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

function makeBlockOp(encFn, decFn) {
  const opts = (p) => {
    const mode = (p.mode || "ECB").toUpperCase();
    const iv = p.iv ? decodeInput(p.iv, p.ivEnc || "hex") : undefined;
    const aad = p.aad ? te(p.aad) : undefined;
    const padding = p.padding || "pkcs7";
    const tagLen = p.tagLen ? Number(p.tagLen) / 8 : undefined; // 位 → 字节
    const rounds = p.rounds != null && p.rounds !== "" ? Number(p.rounds) : undefined;
    const includeIv = normIncludeIv(p.includeIv);
    return { mode, iv, aad, padding, tagLen, rounds, includeIv };
  };
  const encode = (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    const o = opts(p);
    let out = encFn(rawBytesOrNull(p, text) || te(text), key, o);
    if (o.mode === "GCM" && o.includeIv !== "off") {
      if (!o.iv) throw new Error("GCM 需提供 nonce（IV）");
      out = o.includeIv === "prepend" ? concatBytes(o.iv, out) : concatBytes(out, o.iv);
    }
    return encodeOutput(out, p.outEnc || "base64");
  };
  const decode = (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    let data = rawBytesOrNull(p, text.trim()) || decodeInput(text.trim(), p.outEnc || "base64");
    const o = opts(p);
    const tagRaw = String(p.tag == null ? "" : p.tag);
    const tagEnc = p.tagEnc || "hex";
    const sepTag = (tagEnc === "hex" || tagEnc === "base64") ? tagRaw.trim() : tagRaw;
    if (o.mode === "GCM" && o.includeIv !== "off" && !o.iv && !sepTag) {
      const tl = o.tagLen != null ? o.tagLen : 16;
      const candidates = [...new Set([Number(p.ivLen) || 12, 12, 16])];
      let lastErr = null;
      for (const ivLen of candidates) {
        if (data.length < ivLen + tl) continue;
        const iv = o.includeIv === "prepend" ? data.subarray(0, ivLen) : data.subarray(data.length - ivLen);
        const body = o.includeIv === "prepend" ? data.subarray(ivLen) : data.subarray(0, data.length - ivLen);
        try { return td(decFn(body, key, { ...o, iv })); }
        catch (e) { lastErr = e; }
      }
      throw lastErr || new Error("GCM Include IV 解密失败：无法确定 IV 长度");
    }
    if (o.mode === "GCM" && o.includeIv !== "off") {
      const explicit = o.iv;
      const ivLen = explicit ? explicit.length : (Number(p.ivLen) || 12);
      const tl = o.tagLen != null ? o.tagLen : 16;
      const need = ivLen + (sepTag ? 0 : tl);
      if (data.length < need) throw new Error(sepTag
        ? `密文过短，无法取出 ${ivLen} 字节 IV`
        : `密文过短，无法取出 ${ivLen} 字节 IV 与 ${tl} 字节 tag`);
      let iv;
      if (o.includeIv === "prepend") {
        iv = data.subarray(0, ivLen);
        data = data.subarray(ivLen);
      } else {
        iv = data.subarray(data.length - ivLen);
        data = data.subarray(0, data.length - ivLen);
      }
      o.iv = explicit || iv;
    }
    if (o.mode === "GCM" && sepTag) {
      const tl = o.tagLen != null ? o.tagLen : 16;
      const tag = decodeInput(sepTag, tagEnc);
      if (tag.length !== tl) throw new Error(`GCM 独立 tag 需 ${tl} 字节（当前 ${tag.length} 字节）`);
      data = concatBytes(data, tag);
    }
    return td(decFn(data, key, o));
  };
  return { encode, decode };
}

// TEA
{
  const { encode, decode } = makeBlockOp(teaEncrypt, teaDecrypt);
  register({
    id: "tea",
    acceptsBytes: true, family: "tea", familyLabel: "tea", cat: "block", name: "TEA", desc: "Tiny Encryption Algorithm（64位块，128位密钥，32轮 Feistel，Wheeler 1994；支持 ECB/CBC/CFB/OFB/CTR）。ECB/CBC 支持 PKCS#7/NoPadding/Zero/Bit/ISO10126/ANSI X9.23；流模式忽略填充",
    params: blockParams(["ECB", "CBC", "CFB", "OFB", "CTR"], "16 字节密钥"),
    encode, decode,
  });
}
// XTEA
{
  const { encode, decode } = makeBlockOp(xteaEncrypt, xteaDecrypt);
  register({
    id: "xtea",
    acceptsBytes: true, family: "tea", familyLabel: "xtea", cat: "block", name: "XTEA", desc: "扩展 TEA（改进密钥调度，64位块，128位密钥，Needham 1997；支持 ECB/CBC/CFB/OFB/CTR 与 rounds 1-255）。ECB/CBC 支持 PKCS#7/NoPadding/Zero/Bit/ISO10126/ANSI X9.23；流模式忽略填充",
    params: [
      ...blockParams(["ECB", "CBC", "CFB", "OFB", "CTR"], "16 字节密钥"),
      { key: "rounds", label: "轮数（默认 32）", type: "number", default: 32, min: 1, max: 255, step: 1 },
    ],
    encode, decode,
  });
}
// XXTEA（无 mode，整个数据一次性加密）
{
  const encode = (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    const data = rawBytesOrNull(p, text) || te(text);
    return encodeOutput(xxteaEncrypt(data, key), p.outEnc || "base64");
  };
  const decode = (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    const data = rawBytesOrNull(p, text.trim()) || decodeInput(text.trim(), p.outEnc || "base64");
    return td(xxteaDecrypt(data, key));
  };
  register({
    id: "xxtea",
    acceptsBytes: true, family: "tea", familyLabel: "xxtea", cat: "block", name: "XXTEA", desc: "可变长度块 TEA（整个数据一次性加密，≥8字节，128位密钥，Wheeler 1998）",
    params: [
      { key: "key", label: "密钥", type: "text", default: "", placeholder: "16 字节密钥" },
      { key: "keyEnc", label: "密钥编码", type: "select", default: "utf8", options: ENC_OPTS },
      { key: "outEnc", label: "密文编码", type: "select", default: "base64", options: ENC_OPTS },
    ],
    encode, decode,
  });
}
// SM4（国密，GB/T 32907-2016 / 前身 GM/T 0002-2012）
// 全工作模式照 GB/T 17964-2021《分组密码算法的工作模式》：ECB/CBC/CFB/OFB/CTR 纯 JS + GCM（SP 800-38D 构造，块加密换 SM4）。
{
  const { encode, decode } = makeBlockOp(sm4Encrypt, sm4Decrypt);
  register({
    id: "sm4",
    acceptsBytes: true, family: "sm4", familyLabel: "encdec", cat: "block", name: "SM4",
    desc: "国密分组密码（GB/T 32907-2016，前身 GM/T 0002-2012；128位块，128位密钥，32轮非线性迭代。模式：ECB/CBC/CFB/OFB/CTR + GCM 认证加密）。ECB/CBC 支持 PKCS#7/NoPadding/Zero/Bit/ISO10126/ANSI X9.23；GCM 支持 AAD、tagLen(128…32 位)、Include IV(off/prepend/append) 与解密独立 tag；流模式忽略填充",
    params: blockParams(["ECB", "CBC", "CFB", "OFB", "CTR", "GCM"], "16 字节密钥（hex 32 字符）"),
    encode, decode,
  });
}

// Salsa20 / ChaCha20（流密码，自反：encode=decode）
// nonce/counter 由 register 层解析；nonce 编码默认 hex（CTF 常见给 hex nonce）。rounds = 20/12/8。
function intToLeBytes(value, len) {
  let n = BigInt(Math.trunc(Number(value)));
  if (!Number.isFinite(Number(value)) || n < 0n) throw new Error("Integer nonce 须为 ≥0 整数");
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) { out[i] = Number(n & 0xffn); n >>= 8n; }
  if (n !== 0n) throw new Error("Integer nonce 超出 " + (len * 8) + " 位");
  return out;
}
function makeStreamCipherOp(fn, keyHint, nonceHint, integerNonceLen = 8) {
  const params = [
    { key: "key", label: "密钥", type: "text", default: "", placeholder: keyHint },
    { key: "keyEnc", label: "密钥编码", type: "select", default: "hex", options: ENC_OPTS },
    { key: "nonce", label: "Nonce", type: "text", default: "", placeholder: nonceHint },
    { key: "nonceType", label: "Nonce 类型", type: "select", default: "encoded",
      options: [
        { value: "encoded", label: "按编码解析" },
        { value: "integer", label: "Integer（小端整数）" },
      ] },
    { key: "nonceEnc", label: "Nonce 编码", type: "select", default: "hex", options: ENC_OPTS },
    { key: "counter", label: "初始计数器", type: "number", default: 0 },
    { key: "rounds", label: "轮数", type: "select", default: "20",
      options: [{ value: "20", label: "20" }, { value: "12", label: "12" }, { value: "8", label: "8" }] },
    { key: "inEnc", label: "输入编码（空=编码方向 UTF-8 / 解码方向跟随密文编码）", type: "select", default: "",
      options: [
        { value: "", label: "跟随（旧行为）" },
        ...ENC_OPTS,
      ] },
    { key: "outEnc", label: "密文编码", type: "select", default: "base64", options: ENC_OPTS },
  ];
  const readNonce = (p) => (p && p.nonceType === "integer")
    ? intToLeBytes(parseInt(String(p.nonce || "0"), 10), integerNonceLen)
    : decodeInput(p.nonce || "", p.nonceEnc || "hex");
  const encode = (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "hex");
    const nonce = readNonce(p);
    const counter = Number(p.counter) || 0;
    const rounds = p.rounds ? Number(p.rounds) : 20;
    const data = rawBytesOrNull(p, text) || decodeInput(text, (p && p.inEnc) || "utf8");
    return encodeOutput(fn(data, key, nonce, counter, rounds), p.outEnc || "base64");
  };
  const decode = (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "hex");
    const nonce = readNonce(p);
    const counter = Number(p.counter) || 0;
    const rounds = p.rounds ? Number(p.rounds) : 20;
    const data = rawBytesOrNull(p, text.trim()) || decodeInput(text.trim(), (p && p.inEnc) || p.outEnc || "base64");
    return td(fn(data, key, nonce, counter, rounds));
  };
  return { params, encode, decode };
}
{
  const { params, encode, decode } = makeStreamCipherOp(salsa20, "16 或 32 字节密钥", "8 字节 nonce", 8);
  register({
    id: "salsa20",
    acceptsBytes: true, cat: "stream", name: "Salsa20", desc: "Salsa20 流密码（Bernstein，key 16/32 字节，nonce 8 字节，64位块计数器；rounds 20/12/8）",
    params, encode, decode,
  });
}
{
  const { params, encode, decode } = makeStreamCipherOp(chacha20, "32 字节密钥", "12 字节（RFC 8439）或 8 字节（原版）nonce", 12);
  register({
    id: "chacha20",
    acceptsBytes: true, cat: "stream", name: "ChaCha20", desc: "ChaCha20 流密码（key 32 字节；nonce 12 字节 RFC 8439 / 8 字节原版 64 位计数器；rounds 20/12/8）",
    params, encode, decode,
  });
}

// xorStrings（多进制循环异或，明文/密钥短侧循环补齐，自反）
{
  const encode = (text, p) => {
    const data = rawBytesOrNull(p, text) || decodeInput(text, p.inEnc || "utf8");
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    return encodeOutput(xorExtend(data, key), p.outEnc || "hex");
  };
  const decode = (text, p) => {
    const data = rawBytesOrNull(p, text.trim()) || decodeInput(text.trim(), p.outEnc || "hex");
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    return encodeOutput(xorExtend(data, key), p.inEnc || "utf8");
  };
  register({
    id: "xorStrings",
    acceptsBytes: true, cat: "modern", name: "XOR 循环补齐", desc: "循环异或：明文与密钥短侧各自循环补齐到较长一侧再异或（自反）",
    params: [
      { key: "key", label: "密钥", type: "text", default: "", placeholder: "密钥（可短于明文，循环补齐）" },
      { key: "keyEnc", label: "密钥编码", type: "select", default: "utf8", options: ENC_OPTS },
      { key: "inEnc", label: "明文编码", type: "select", default: "utf8", options: ENC_OPTS },
      { key: "outEnc", label: "密文编码", type: "select", default: "hex", options: ENC_OPTS },
    ],
    encode, decode,
  });
}

export { teaEncryptBlock, teaDecryptBlock, xteaEncryptBlock, xteaDecryptBlock, xxteaEncryptBytes, xxteaDecryptBytes, sm4EncryptBlock, sm4DecryptBlock, sm4KeyExpansion, salsa20Block, chacha20Block, cfbEncrypt, cfbDecrypt, ofbCrypt, ctrCrypt };
