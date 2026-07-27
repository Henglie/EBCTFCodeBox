/*
 * modern.js — 现代加密（cat:'modern'）。
 *
 * 覆盖：AES（ECB/CBC/CFB/OFB/CTR 纯 JS + GCM 走 WebCrypto）、DES/3DES、RC4
 * XOR（单/多字节 key）、Fernet（对称令牌，HMAC-SHA256 + AES-128-CBC）、RSA（教学级）。
 *
 * 红线：
 * - AES/DES 走标准算法（FIPS-197 / FIPS-46-3），用 NIST 官方测试向量验证，不许编造 S-box/轮常量。
 * - 零外发：全部本地计算（纯 JS 块密码 + WebCrypto，无网络）。
 * - 契约：核心算法层纯函数（字节进字节出），register 层负责编码（hex/base64/utf8）解析与拼装。
 *
 * 分层：
 * [块密码内核] aesEncryptBlock / desBlock — 16/8 字节块级变换
 * [分组模式] ecb/cbc/cfb/ofb/ctr — 通用模式包装，任意 16 或 8 字节块密码复用
 * [填充] pkcs7 pad/unpad
 * [高层 API] aesEncrypt/aesDecrypt、desEncrypt/desDecrypt、rc4、xorCrypt、fernet*、rsa*
 * [register] 编码解析（key/iv/data 的 hex|base64|utf8）+ 双向注册
 *
 * 供 T34「密钥+密文一键尝试」复用高层 API（makeAes / aesEncrypt / desEncrypt / rc4 / xorCrypt）。
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

// ============================================================
// 字节 <-> 编码 工具（hex / base64 / utf8 / latin1）
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
// base64url（Fernet 用）
function bytesToB64url(b) {
  return bytesToB64(b).replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlToBytes(s) {
  return b64ToBytes(s.replace(/-/g, "+").replace(/_/g, "/"));
}

/** 按声明的编码把文本解析成字节。enc ∈ utf8|hex|base64|latin1 */
function decodeInput(text, enc) {
  switch (enc) {
    case "hex": return hexToBytes(text);
    case "base64": return b64ToBytes(text);
    case "latin1": { const o = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) o[i] = text.charCodeAt(i) & 0xff; return o; }
    case "utf8":
    default: return te(text);
  }
}
/** 把字节按声明编码转成文本。 */
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
// PKCS#7 填充
// ============================================================
function pkcs7Pad(data, blockSize) {
  const padLen = blockSize - (data.length % blockSize);
  const out = new Uint8Array(data.length + padLen);
  out.set(data);
  out.fill(padLen, data.length);
  return out;
}
function pkcs7Unpad(data, blockSize) {
  if (data.length === 0 || data.length % blockSize !== 0) throw new Error("密文长度非块大小整数倍，无法去填充");
  const padLen = data[data.length - 1];
  if (padLen < 1 || padLen > blockSize) throw new Error("PKCS7 填充非法（可能密钥/模式错误）");
  for (let i = data.length - padLen; i < data.length; i++) {
    if (data[i] !== padLen) throw new Error("PKCS7 填充校验失败（可能密钥/模式错误）");
  }
  return data.subarray(0, data.length - padLen);
}

function xorBytes(a, b) {
  const o = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] ^ b[i];
  return o;
}
function incCounter(ctr) {
  for (let i = ctr.length - 1; i >= 0; i--) { if (++ctr[i] !== 0) break; }
}

// ============================================================
// 分组模式（通用，块密码传入 encBlock/decBlock，块大小 bs）
// ============================================================
function ecbEncrypt(data, encBlock, bs, pad = true) {
  const d = pad ? pkcs7Pad(data, bs) : data;
  if (d.length % bs) throw new Error(`明文需为 ${bs} 字节整数倍（或开启填充）`);
  const out = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i += bs) out.set(encBlock(d.subarray(i, i + bs)), i);
  return out;
}
function ecbDecrypt(data, decBlock, bs, pad = true) {
  if (data.length % bs) throw new Error(`密文需为 ${bs} 字节整数倍`);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += bs) out.set(decBlock(data.subarray(i, i + bs)), i);
  return pad ? pkcs7Unpad(out, bs) : out;
}
function cbcEncrypt(data, encBlock, bs, iv, pad = true) {
  const d = pad ? pkcs7Pad(data, bs) : data;
  if (d.length % bs) throw new Error(`明文需为 ${bs} 字节整数倍（或开启填充）`);
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
  return pad ? pkcs7Unpad(out, bs) : out;
}
// CFB/OFB/CTR 为流模式，加解密都用块密码的 encBlock
function cfbEncrypt(data, encBlock, bs, iv) {
  const out = new Uint8Array(data.length);
  let fb = iv.slice(0, bs);
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
  let fb = iv.slice(0, bs);
  for (let i = 0; i < data.length; i += bs) {
    const ks = encBlock(fb);
    const n = Math.min(bs, data.length - i);
    const c = new Uint8Array(bs);
    for (let j = 0; j < n; j++) { c[j] = data[i + j]; out[i + j] = data[i + j] ^ ks[j]; }
    fb = c;
  }
  return out;
}
function ofbCrypt(data, encBlock, bs, iv) {
  const out = new Uint8Array(data.length);
  let fb = iv.slice(0, bs);
  for (let i = 0; i < data.length; i += bs) {
    fb = encBlock(fb);
    const n = Math.min(bs, data.length - i);
    for (let j = 0; j < n; j++) out[i + j] = data[i + j] ^ fb[j];
  }
  return out;
}
function ctrCrypt(data, encBlock, bs, iv) {
  const out = new Uint8Array(data.length);
  const ctr = iv.slice(0, bs);
  for (let i = 0; i < data.length; i += bs) {
    const ks = encBlock(ctr);
    const n = Math.min(bs, data.length - i);
    for (let j = 0; j < n; j++) out[i + j] = data[i + j] ^ ks[j];
    incCounter(ctr);
  }
  return out;
}

// ============================================================
// AES 内核（FIPS-197，纯 JS）
// ============================================================
const AES_SBOX = new Uint8Array(256);
const AES_INV_SBOX = new Uint8Array(256);
const AES_RCON = new Uint8Array([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d]);
// GF(2^8) 乘法
function gmul(a, b) {
  let p = 0;
  for (let i = 0; i < 8 && a && b; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}
// 运行时生成 S-box（避免手抄 256 项出错，算法源自 FIPS-197 §5.1.1）
(function initSbox() {
 // 乘法逆元表
  const inv = new Uint8Array(256);
  for (let i = 1; i < 256; i++) {
    for (let j = 1; j < 256; j++) { if (gmul(i, j) === 1) { inv[i] = j; break; } }
  }
  for (let i = 0; i < 256; i++) {
    let s = inv[i];
    let x = s;
    for (let c = 0; c < 4; c++) { x = ((x << 1) | (x >> 7)) & 0xff; s ^= x; }
    s ^= 0x63;
    AES_SBOX[i] = s;
    AES_INV_SBOX[s] = i;
  }
})();

function aesKeyExpansion(key) {
  const Nk = key.length / 4;
  if (![4, 6, 8].includes(Nk)) throw new Error("AES 密钥须为 16/24/32 字节");
  const Nr = Nk + 6;
  const w = new Uint8Array(16 * (Nr + 1));
  w.set(key);
  let rcon = 0;
  for (let i = Nk; i < 4 * (Nr + 1); i++) {
    const t = [w[(i - 1) * 4], w[(i - 1) * 4 + 1], w[(i - 1) * 4 + 2], w[(i - 1) * 4 + 3]];
    if (i % Nk === 0) {
 // RotWord + SubWord + Rcon
      const tmp = t[0]; t[0] = t[1]; t[1] = t[2]; t[2] = t[3]; t[3] = tmp;
      for (let k = 0; k < 4; k++) t[k] = AES_SBOX[t[k]];
      t[0] ^= AES_RCON[rcon++];
    } else if (Nk > 6 && i % Nk === 4) {
      for (let k = 0; k < 4; k++) t[k] = AES_SBOX[t[k]];
    }
    for (let k = 0; k < 4; k++) w[i * 4 + k] = w[(i - Nk) * 4 + k] ^ t[k];
  }
  return { w, Nr };
}

function aesEncryptBlock(input, w, Nr) {
  const s = new Uint8Array(input.subarray(0, 16));
  addRoundKey(s, w, 0);
  for (let round = 1; round < Nr; round++) {
    subBytes(s, AES_SBOX);
    shiftRows(s);
    mixColumns(s);
    addRoundKey(s, w, round);
  }
  subBytes(s, AES_SBOX);
  shiftRows(s);
  addRoundKey(s, w, Nr);
  return s;
}
function aesDecryptBlock(input, w, Nr) {
  const s = new Uint8Array(input.subarray(0, 16));
  addRoundKey(s, w, Nr);
  for (let round = Nr - 1; round > 0; round--) {
    invShiftRows(s);
    subBytes(s, AES_INV_SBOX);
    addRoundKey(s, w, round);
    invMixColumns(s);
  }
  invShiftRows(s);
  subBytes(s, AES_INV_SBOX);
  addRoundKey(s, w, 0);
  return s;
}
function addRoundKey(s, w, round) {
  const o = round * 16;
  for (let i = 0; i < 16; i++) s[i] ^= w[o + i];
}
function subBytes(s, box) { for (let i = 0; i < 16; i++) s[i] = box[s[i]]; }
// state 按列主序存（s[col*4+row]）
function shiftRows(s) {
  const t = s.slice();
  for (let r = 1; r < 4; r++) {
    for (let c = 0; c < 4; c++) s[c * 4 + r] = t[((c + r) % 4) * 4 + r];
  }
}
function invShiftRows(s) {
  const t = s.slice();
  for (let r = 1; r < 4; r++) {
    for (let c = 0; c < 4; c++) s[c * 4 + r] = t[((c - r + 4) % 4) * 4 + r];
  }
}
function mixColumns(s) {
  for (let c = 0; c < 4; c++) {
    const o = c * 4;
    const a0 = s[o], a1 = s[o + 1], a2 = s[o + 2], a3 = s[o + 3];
    s[o] = gmul(a0, 2) ^ gmul(a1, 3) ^ a2 ^ a3;
    s[o + 1] = a0 ^ gmul(a1, 2) ^ gmul(a2, 3) ^ a3;
    s[o + 2] = a0 ^ a1 ^ gmul(a2, 2) ^ gmul(a3, 3);
    s[o + 3] = gmul(a0, 3) ^ a1 ^ a2 ^ gmul(a3, 2);
  }
}
function invMixColumns(s) {
  for (let c = 0; c < 4; c++) {
    const o = c * 4;
    const a0 = s[o], a1 = s[o + 1], a2 = s[o + 2], a3 = s[o + 3];
    s[o] = gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9);
    s[o + 1] = gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13);
    s[o + 2] = gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11);
    s[o + 3] = gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14);
  }
}

// ============================================================
// AES 高层 API（给 register 层 + T34 密钥一把梭复用）
// ============================================================
/** 由密钥构造 AES 块加/解密闭包。keyBytes 长 16/24/32。 */
export function makeAes(keyBytes) {
  const { w, Nr } = aesKeyExpansion(keyBytes);
  return {
    encBlock: (b) => aesEncryptBlock(b, w, Nr),
    decBlock: (b) => aesDecryptBlock(b, w, Nr),
  };
}

const AES_MODES = new Set(["ECB", "CBC", "CFB", "OFB", "CTR"]);

/**
 * AES 加密（非 GCM 模式，纯 JS）。
 * @param {Uint8Array} data 明文字节
 * @param {Uint8Array} key 16/24/32 字节
 * @param {{mode:string, iv?:Uint8Array, pad?:boolean}} opts
 * @returns {Uint8Array} 密文字节
 */
export function aesEncrypt(data, key, { mode = "CBC", iv, pad = true } = {}) {
  mode = mode.toUpperCase();
  if (!AES_MODES.has(mode)) throw new Error(`不支持的 AES 模式: ${mode}（GCM 用 aesGcm*）`);
  const { encBlock } = makeAes(key);
  const ivv = iv || new Uint8Array(16);
  switch (mode) {
    case "ECB": return ecbEncrypt(data, encBlock, 16, pad);
    case "CBC": return cbcEncrypt(data, encBlock, 16, ivv, pad);
    case "CFB": return cfbEncrypt(data, encBlock, 16, ivv);
    case "OFB": return ofbCrypt(data, encBlock, 16, ivv);
    case "CTR": return ctrCrypt(data, encBlock, 16, ivv);
  }
}
/** AES 解密（非 GCM）。 */
export function aesDecrypt(data, key, { mode = "CBC", iv, pad = true } = {}) {
  mode = mode.toUpperCase();
  if (!AES_MODES.has(mode)) throw new Error(`不支持的 AES 模式: ${mode}`);
  const { encBlock, decBlock } = makeAes(key);
  const ivv = iv || new Uint8Array(16);
  switch (mode) {
    case "ECB": return ecbDecrypt(data, decBlock, 16, pad);
    case "CBC": return cbcDecrypt(data, decBlock, 16, ivv, pad);
    case "CFB": return cfbDecrypt(data, encBlock, 16, ivv); // 流模式解密用 encBlock
    case "OFB": return ofbCrypt(data, encBlock, 16, ivv);
    case "CTR": return ctrCrypt(data, encBlock, 16, ivv);
  }
}

// ============================================================
// DES 内核（FIPS-46-3，纯 JS，标准置换表照抄不改）
// ============================================================
// 初始置换 IP（64→64）
const DES_IP = [
  58,50,42,34,26,18,10,2, 60,52,44,36,28,20,12,4,
  62,54,46,38,30,22,14,6, 64,56,48,40,32,24,16,8,
  57,49,41,33,25,17,9,1, 59,51,43,35,27,19,11,3,
  61,53,45,37,29,21,13,5, 63,55,47,39,31,23,15,7,
];
// 逆初始置换 FP = IP^-1（64→64）
const DES_FP = [
  40,8,48,16,56,24,64,32, 39,7,47,15,55,23,63,31,
  38,6,46,14,54,22,62,30, 37,5,45,13,53,21,61,29,
  36,4,44,12,52,20,60,28, 35,3,43,11,51,19,59,27,
  34,2,42,10,50,18,58,26, 33,1,41,9,49,17,57,25,
];
// 扩展置换 E（32→48）
const DES_E = [
  32,1,2,3,4,5, 4,5,6,7,8,9, 8,9,10,11,12,13, 12,13,14,15,16,17,
  16,17,18,19,20,21, 20,21,22,23,24,25, 24,25,26,27,28,29, 28,29,30,31,32,1,
];
// P 置换（32→32）
const DES_P = [
  16,7,20,21,29,12,28,17, 1,15,23,26,5,18,31,10,
  2,8,24,14,32,27,3,9, 19,13,30,6,22,11,4,25,
];
// PC-1（64→56，丢奇偶校验位）
const DES_PC1 = [
  57,49,41,33,25,17,9, 1,58,50,42,34,26,18,
  10,2,59,51,43,35,27, 19,11,3,60,52,44,36,
  63,55,47,39,31,23,15, 7,62,54,46,38,30,22,
  14,6,61,53,45,37,29, 21,13,5,28,20,12,4,
];
// PC-2（56→48）
const DES_PC2 = [
  14,17,11,24,1,5, 3,28,15,6,21,10, 23,19,12,4,26,8, 16,7,27,20,13,2,
  41,52,31,37,47,55, 30,40,51,45,33,48, 44,49,39,56,34,53, 46,42,50,36,29,32,
];
// 每轮左移位数
const DES_SHIFTS = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
// 8 个 S 盒（每盒 4 行 16 列）
const DES_SBOX = [
  [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7, 0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8, 4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0, 15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
  [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10, 3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5, 0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15, 13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
  [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8, 13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1, 13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7, 1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
  [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15, 13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9, 10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4, 3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
  [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9, 14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6, 4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14, 11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
  [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11, 10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8, 9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6, 4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
  [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1, 13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6, 1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2, 6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
  [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7, 1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2, 7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8, 2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11],
];

// 字节数组 → 位数组（MSB 优先）
function bytesToBits(bytes) {
  const bits = new Uint8Array(bytes.length * 8);
  for (let i = 0; i < bytes.length; i++)
    for (let j = 0; j < 8; j++) bits[i * 8 + j] = (bytes[i] >> (7 - j)) & 1;
  return bits;
}
function bitsToBytes(bits) {
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < out.length; i++) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i * 8 + j];
    out[i] = v;
  }
  return out;
}
// 按 table（1-indexed）置换位数组
function permute(bits, table) {
  const out = new Uint8Array(table.length);
  for (let i = 0; i < table.length; i++) out[i] = bits[table[i] - 1];
  return out;
}
// 左循环移位（28 位半密钥）
function rotl28(arr, n) {
  const out = new Uint8Array(28);
  for (let i = 0; i < 28; i++) out[i] = arr[(i + n) % 28];
  return out;
}
// 生成 16 个 48 位子密钥
function desKeySchedule(keyBytes) {
  if (keyBytes.length !== 8) throw new Error("DES 密钥须为 8 字节");
  const key56 = permute(bytesToBits(keyBytes), DES_PC1);
  let C = key56.subarray(0, 28), D = key56.subarray(28, 56);
  const subkeys = [];
  for (let r = 0; r < 16; r++) {
    C = rotl28(C, DES_SHIFTS[r]);
    D = rotl28(D, DES_SHIFTS[r]);
    const CD = new Uint8Array(56);
    CD.set(C); CD.set(D, 28);
    subkeys.push(permute(CD, DES_PC2));
  }
  return subkeys;
}
// Feistel f 函数（R:32bits, K:48bits → 32bits）
function desF(R, K) {
  const expanded = permute(R, DES_E); // 48
  for (let i = 0; i < 48; i++) expanded[i] ^= K[i];
  const sOut = new Uint8Array(32);
  for (let b = 0; b < 8; b++) {
    const o = b * 6;
    const row = (expanded[o] << 1) | expanded[o + 5];
    const col = (expanded[o + 1] << 3) | (expanded[o + 2] << 2) | (expanded[o + 3] << 1) | expanded[o + 4];
    const val = DES_SBOX[b][row * 16 + col];
    sOut[b * 4] = (val >> 3) & 1;
    sOut[b * 4 + 1] = (val >> 2) & 1;
    sOut[b * 4 + 2] = (val >> 1) & 1;
    sOut[b * 4 + 3] = val & 1;
  }
  return permute(sOut, DES_P);
}
// DES 单块（8 字节）加/解密。decrypt=true 时子密钥逆序。
function desBlockRaw(block8, subkeys, decrypt) {
  const bits = permute(bytesToBits(block8), DES_IP);
  let L = bits.subarray(0, 32), R = bits.subarray(32, 64);
  for (let r = 0; r < 16; r++) {
    const k = subkeys[decrypt ? 15 - r : r];
    const f = desF(R, k);
    const newR = new Uint8Array(32);
    for (let i = 0; i < 32; i++) newR[i] = L[i] ^ f[i];
    L = R; R = newR;
  }
 // 末轮不交换：预输出 = R16 L16
  const pre = new Uint8Array(64);
  pre.set(R); pre.set(L, 32);
  return bitsToBytes(permute(pre, DES_FP));
}
/** 由 8 字节密钥构造 DES 块闭包。 */
export function makeDes(keyBytes) {
  const subkeys = desKeySchedule(keyBytes);
  return {
    encBlock: (b) => desBlockRaw(b, subkeys, false),
    decBlock: (b) => desBlockRaw(b, subkeys, true),
  };
}
/** 由 16 或 24 字节密钥构造 3DES（EDE）块闭包。16 字节 = K1K2K1。 */
export function makeDes3(keyBytes) {
  let k1, k2, k3;
  if (keyBytes.length === 24) { k1 = keyBytes.subarray(0, 8); k2 = keyBytes.subarray(8, 16); k3 = keyBytes.subarray(16, 24); }
  else if (keyBytes.length === 16) { k1 = keyBytes.subarray(0, 8); k2 = keyBytes.subarray(8, 16); k3 = k1; }
  else throw new Error("3DES 密钥须为 16 或 24 字节");
  const d1 = makeDes(k1), d2 = makeDes(k2), d3 = makeDes(k3);
  return {
    encBlock: (b) => d3.encBlock(d2.decBlock(d1.encBlock(b))), // EDE
    decBlock: (b) => d1.decBlock(d2.encBlock(d3.decBlock(b))), // DED
  };
}

const DES_MODES = new Set(["ECB", "CBC", "CFB", "OFB", "CTR"]);
function runBlockCipher(enc, data, blk, mode, iv, pad) {
  mode = mode.toUpperCase();
  if (!DES_MODES.has(mode)) throw new Error(`不支持的模式: ${mode}`);
  const ivv = iv || new Uint8Array(8);
  const bs = 8;
  if (enc) switch (mode) {
    case "ECB": return ecbEncrypt(data, blk.encBlock, bs, pad);
    case "CBC": return cbcEncrypt(data, blk.encBlock, bs, ivv, pad);
    case "CFB": return cfbEncrypt(data, blk.encBlock, bs, ivv);
    case "OFB": return ofbCrypt(data, blk.encBlock, bs, ivv);
    case "CTR": return ctrCrypt(data, blk.encBlock, bs, ivv);
  } else switch (mode) {
    case "ECB": return ecbDecrypt(data, blk.decBlock, bs, pad);
    case "CBC": return cbcDecrypt(data, blk.decBlock, bs, ivv, pad);
    case "CFB": return cfbDecrypt(data, blk.encBlock, bs, ivv);
    case "OFB": return ofbCrypt(data, blk.encBlock, bs, ivv);
    case "CTR": return ctrCrypt(data, blk.encBlock, bs, ivv);
  }
}
export function desEncrypt(data, key, { mode = "CBC", iv, pad = true } = {}) { return runBlockCipher(true, data, makeDes(key), mode, iv, pad); }
export function desDecrypt(data, key, { mode = "CBC", iv, pad = true } = {}) { return runBlockCipher(false, data, makeDes(key), mode, iv, pad); }
export function des3Encrypt(data, key, { mode = "CBC", iv, pad = true } = {}) { return runBlockCipher(true, data, makeDes3(key), mode, iv, pad); }
export function des3Decrypt(data, key, { mode = "CBC", iv, pad = true } = {}) { return runBlockCipher(false, data, makeDes3(key), mode, iv, pad); }

// ============================================================
// RC4（流密码，自反）
// ============================================================
export function rc4(data, key) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
  }
  const out = new Uint8Array(data.length);
  let i = 0; j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
    out[k] = data[k] ^ S[(S[i] + S[j]) & 0xff];
  }
  return out;
}

// ============================================================
// XOR（重复密钥，自反）
// ============================================================
export function xorCrypt(data, key) {
  if (!key || key.length === 0) throw new Error("XOR 密钥不能为空");
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ key[i % key.length];
  return out;
}

// ============================================================
// Fernet（对称令牌，spec: fernet-spec）
// 令牌 = base64url( 0x80 ‖ ts(8,BE秒) ‖ iv(16) ‖ ct(AES128-CBC/PKCS7) ‖ hmac(32) )
// 密钥 = base64url(32B)：前 16B 签名密钥(HMAC-SHA256)，后 16B 加密密钥(AES-128)。
// ============================================================
async function hmacSha256(keyBytes, msgBytes) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto（Fernet 需要）");
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, msgBytes);
  return new Uint8Array(sig);
}
function fernetSplitKey(keyText) {
  const kb = b64urlToBytes(keyText.trim());
  if (kb.length !== 32) throw new Error("Fernet 密钥须为 base64url 编码的 32 字节");
  return { signKey: kb.subarray(0, 16), encKey: kb.subarray(16, 32) };
}
/** Fernet 加密。返回 base64url 令牌。ts 省略取当前秒；iv 省略随机。 */
export async function fernetEncrypt(dataBytes, keyText, { ts, iv } = {}) {
  const { signKey, encKey } = fernetSplitKey(keyText);
  const ivv = iv || crypto.getRandomValues(new Uint8Array(16));
  const now = ts != null ? BigInt(ts) : BigInt(Math.floor(Date.now() / 1000));
  const tsBytes = new Uint8Array(8);
  { let v = now; for (let i = 7; i >= 0; i--) { tsBytes[i] = Number(v & 0xffn); v >>= 8n; } }
  const ct = aesEncrypt(dataBytes, encKey, { mode: "CBC", iv: ivv, pad: true });
  const body = new Uint8Array(1 + 8 + 16 + ct.length);
  body[0] = 0x80; body.set(tsBytes, 1); body.set(ivv, 9); body.set(ct, 25);
  const mac = await hmacSha256(signKey, body);
  const token = new Uint8Array(body.length + 32);
  token.set(body); token.set(mac, body.length);
  return bytesToB64url(token);
}
/** Fernet 解密。校验版本 + HMAC，返回明文字节。 */
export async function fernetDecrypt(tokenText, keyText, { checkMac = true } = {}) {
  const { signKey, encKey } = fernetSplitKey(keyText);
  const token = b64urlToBytes(tokenText.trim());
  if (token.length < 1 + 8 + 16 + 32) throw new Error("Fernet 令牌过短");
  if (token[0] !== 0x80) throw new Error("Fernet 版本非法（应为 0x80）");
  const body = token.subarray(0, token.length - 32);
  const mac = token.subarray(token.length - 32);
  if (checkMac) {
    const expect = await hmacSha256(signKey, body);
    let diff = 0;
    for (let i = 0; i < 32; i++) diff |= mac[i] ^ expect[i];
    if (diff !== 0) throw new Error("Fernet HMAC 校验失败（密钥错误或令牌被篡改）");
  }
  const iv = body.subarray(9, 25);
  const ct = body.subarray(25);
  return aesDecrypt(ct, encKey, { mode: "CBC", iv, pad: true });
}

// ============================================================
// RSA（教学级，BigInt。仅裸 RSA / 无填充，用于 CTF 求解，不作生产加密）
// ============================================================
function modpow(base, exp, mod) {
  base %= mod;
  let result = 1n;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}
function egcd(a, b) {
  if (b === 0n) return [a, 1n, 0n];
  const [g, x, y] = egcd(b, a % b);
  return [g, y, x - (a / b) * y];
}
/** 模逆 a^{-1} mod m。 */
export function modInverse(a, m) {
  const [g, x] = egcd(((a % m) + m) % m, m);
  if (g !== 1n) throw new Error("模逆不存在（a 与 m 不互质）");
  return ((x % m) + m) % m;
}
/** 裸 RSA：c = m^e mod n。m 为 BigInt。 */
export function rsaPow(m, e, n) { return modpow(m, e, n); }
/** 字节 → BigInt（大端，OS2IP）。 */
export function bytesToBigInt(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}
/** BigInt → 字节（大端，I2OSP，len 省略取最小长度）。 */
export function bigIntToBytes(n, len) {
  const out = [];
  let v = n;
  while (v > 0n) { out.unshift(Number(v & 0xffn)); v >>= 8n; }
  if (len != null) { while (out.length < len) out.unshift(0); }
  return new Uint8Array(out);
}
/** 由 p,q,e 推导私钥 d（CTF 常见）。 */
export function rsaDeriveD(p, q, e) {
  const phi = (p - 1n) * (q - 1n);
  return modInverse(e, phi);
}

// ============================================================
// AES-GCM（认证加密，走 WebCrypto）
// ============================================================
// 密文 = ciphertext ‖ tag(16B)（WebCrypto 输出格式）。CTF 场景 iv/nonce 通常已知，故要求显式提供。
export async function aesGcmEncrypt(data, key, iv, aad) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto（AES-GCM 需要）");
  const k = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad || new Uint8Array(0) }, k, data);
  return new Uint8Array(ct);
}
export async function aesGcmDecrypt(data, key, iv, aad) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto（AES-GCM 需要）");
  const k = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, additionalData: aad || new Uint8Array(0) }, k, data);
  return new Uint8Array(pt);
}

// ============================================================
// register 层：编码解析（key/iv/data 的 utf8|hex|base64|latin1）+ 双向注册
// ============================================================
// 参数模板：分组密码（AES/DES/3DES）共用 key/keyEnc/mode/iv/ivEnc/outEnc。
const ENC_OPTS = [
  { value: "utf8", label: "UTF-8" },
  { value: "hex", label: "Hex" },
  { value: "base64", label: "Base64" },
  { value: "latin1", label: "Latin-1" },
];
const OUT_OPTS = [
  { value: "base64", label: "Base64" },
  { value: "hex", label: "Hex" },
];

// 分组密码参数（AES 含 GCM，DES/3DES 不含）。
function blockParams(modes, keyPh) {
  return [
    { key: "key", label: "密钥", type: "text", default: "", placeholder: keyPh },
    { key: "keyEnc", label: "密钥编码", type: "select", default: "utf8", options: ENC_OPTS },
    { key: "mode", label: "模式", type: "select", default: "CBC",
      options: modes.map((m) => ({ value: m, label: m })) },
    { key: "iv", label: "IV / Nonce", type: "text", default: "", placeholder: "hex（GCM 为 12B nonce）" },
    { key: "ivEnc", label: "IV 编码", type: "select", default: "hex", options: ENC_OPTS },
    { key: "outEnc", label: "密文编码", type: "select", default: "base64", options: OUT_OPTS },
  ];
}

// 由字节级 enc/dec 函数构造 register 用的 encode/decode（含 AES-GCM 分支）。
// isAes=true 时 GCM 模式走 WebCrypto，其余走纯 JS 分组模式。
function makeBlockEncode(encFn, isAes) {
  return async (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    const mode = (p.mode || "CBC").toUpperCase();
    const data = te(text);
    if (isAes && mode === "GCM") {
      if (!p.iv) throw new Error("GCM 需提供 nonce（IV）");
      const iv = decodeInput(p.iv, p.ivEnc || "hex");
      return encodeOutput(await aesGcmEncrypt(data, key, iv), p.outEnc || "base64");
    }
    const iv = p.iv ? decodeInput(p.iv, p.ivEnc || "hex") : undefined;
    return encodeOutput(encFn(data, key, { mode, iv }), p.outEnc || "base64");
  };
}
function makeBlockDecode(decFn, isAes) {
  return async (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    const mode = (p.mode || "CBC").toUpperCase();
    const data = decodeInput(text.trim(), p.outEnc || "base64");
    if (isAes && mode === "GCM") {
      if (!p.iv) throw new Error("GCM 需提供 nonce（IV）");
      const iv = decodeInput(p.iv, p.ivEnc || "hex");
      return encodeOutput(await aesGcmDecrypt(data, key, iv), "utf8");
    }
    const iv = p.iv ? decodeInput(p.iv, p.ivEnc || "hex") : undefined;
    return encodeOutput(decFn(data, key, { mode, iv }), "utf8");
  };
}

register({
  id: "aes", cat: "modern", name: "AES", desc: "高级加密标准（ECB/CBC/CFB/OFB/CTR 纯 JS + GCM WebCrypto，key 16/24/32 字节）",
  params: blockParams(["ECB", "CBC", "CFB", "OFB", "CTR", "GCM"], "16/24/32 字节密钥"),
  encode: makeBlockEncode(aesEncrypt, true),
  decode: makeBlockDecode(aesDecrypt, true),
});
register({
  id: "des", cat: "modern", name: "DES", desc: "数据加密标准（FIPS-46-3，key 8 字节，块 8 字节）",
  params: blockParams(["ECB", "CBC", "CFB", "OFB", "CTR"], "8 字节密钥"),
  encode: makeBlockEncode(desEncrypt, false),
  decode: makeBlockDecode(desDecrypt, false),
});
register({
  id: "des3", cat: "modern", name: "3DES / TripleDES", desc: "三重 DES（EDE，key 16 或 24 字节，块 8 字节）",
  params: blockParams(["ECB", "CBC", "CFB", "OFB", "CTR"], "16/24 字节密钥"),
  encode: makeBlockEncode(des3Encrypt, false),
  decode: makeBlockDecode(des3Decrypt, false),
});

// RC4 / XOR：流密码，自反。encode=decode（明文↔密文同一变换）。
function makeStreamOp(fn) {
  const enc = (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    return encodeOutput(fn(te(text), key), p.outEnc || "base64");
  };
  const dec = (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    return encodeOutput(fn(decodeInput(text.trim(), p.outEnc || "base64"), key), "utf8");
  };
  return { enc, dec };
}
const STREAM_PARAMS = [
  { key: "key", label: "密钥", type: "text", default: "", placeholder: "密钥" },
  { key: "keyEnc", label: "密钥编码", type: "select", default: "utf8", options: ENC_OPTS },
  { key: "outEnc", label: "密文编码", type: "select", default: "base64", options: OUT_OPTS },
];
// XOR 单独 params：默认密钥给非空示例值，避免首次转换即报错（用户看到结果后自然知道改 key）
const XOR_PARAMS = [
  { key: "key", label: "密钥", type: "text", default: "ctf", placeholder: "密钥" },
  { key: "keyEnc", label: "密钥编码", type: "select", default: "utf8", options: ENC_OPTS },
  { key: "outEnc", label: "密文编码", type: "select", default: "base64", options: OUT_OPTS },
];
{
  const { enc, dec } = makeStreamOp(rc4);
  register({
    id: "rc4", cat: "modern", name: "RC4", desc: "RC4 流密码（自反，key 任意长）",
    params: STREAM_PARAMS, encode: enc, decode: dec,
  });
}
{
  const { enc, dec } = makeStreamOp(xorCrypt);
  register({
    id: "xor", cat: "modern", name: "XOR", desc: "重复密钥异或（自反，CTF 最常用；单字节爆破见分析类 xorBrute）",
    params: XOR_PARAMS, encode: enc, decode: dec,
  });
}

register({
  id: "fernet", cat: "modern", name: "Fernet", desc: "对称令牌（AES-128-CBC + HMAC-SHA256，key 为 base64url 32 字节）",
  params: [
    { key: "key", label: "Fernet 密钥", type: "text", default: "", placeholder: "base64url 32 字节" },
    { key: "checkMac", label: "校验 HMAC", type: "bool", default: true },
  ],
  encode: async (text, p) => fernetEncrypt(te(text), p.key || ""),
  decode: async (text, p) => td(await fernetDecrypt(text.trim(), p.key || "", { checkMac: p.checkMac !== false })),
});

// RSA 完整版（BigInt）。encode=c=m^e mod n，decode=m=c^d mod n。
// 相比原教学版增强（向后兼容，dataEnc/outEnc 默认 dec = 原纯十进制行为）：
// - dataEnc：输入(明文/密文)编码 dec/hex/base64/utf8，支持真实 CTF 的 hex/base64 密文
// - outEnc ：输出(密文/明文)编码 dec/hex/base64/utf8，解密后 m→ASCII 直出 flag
// - p,q ：填了自动算 n=pq 与 d=e⁻¹ mod φ，免手推私钥（n/d 缺时才用，不覆盖手填）
// RSA 数据编解码约定：数字域用十进制大整数；字节域(hex/base64/utf8)经 OS2IP/I2OSP
// 与整数互转（bytesToBigInt/bigIntToBytes 大端）。
const RSA_DATA_ENC = [
  { value: "dec", label: "十进制大数" },
  { value: "hex", label: "Hex 字节" },
  { value: "base64", label: "Base64 字节" },
  { value: "utf8", label: "UTF-8 文本" },
];
// 输入文本 → BigInt（m 或 c）。dec 直接 BigInt；字节域先解码再 OS2IP。
function rsaTextToInt(text, enc) {
  const s = text.trim();
  if (enc === "dec") {
    if (!/^\d+$/.test(s)) throw new Error("十进制模式下输入须为纯数字（含 hex/base64 密文请改「输入编码」）");
    return BigInt(s);
  }
  return bytesToBigInt(decodeInput(enc === "utf8" ? text : s, enc));
}
// BigInt 结果 → 输出文本。dec 直接十进制；字节域先 I2OSP 再编码。
function rsaIntToText(v, enc) {
  if (enc === "dec") return v.toString();
  return encodeOutput(bigIntToBytes(v), enc);
}
// 解析 n：优先手填 n，否则 p·q 自动算。
function rsaResolveN(p) {
  const nStr = (p.n || "").trim();
  if (nStr) return BigInt(nStr);
  const pp = (p.p || "").trim(), qq = (p.q || "").trim();
  if (pp && qq) return BigInt(pp) * BigInt(qq);
  throw new Error("缺模数：请填 n，或同时填 p 和 q（自动算 n=p·q）");
}
// 解析 d：优先手填 d，否则由 p,q,e 推导。
function rsaResolveD(p) {
  const dStr = (p.d || "").trim();
  if (dStr) return BigInt(dStr);
  const pp = (p.p || "").trim(), qq = (p.q || "").trim();
  if (pp && qq) return rsaDeriveD(BigInt(pp), BigInt(qq), BigInt((p.e || "65537").trim()));
  throw new Error("缺私钥：请填 d，或同时填 p 和 q（自动推 d=e⁻¹ mod φ）");
}
register({
  id: "rsa", cat: "modern", name: "RSA",
  desc: "RSA 模幂加解密：加密 c=mᵉ mod n，解密 m=cᵈ mod n。支持 hex/base64 密文与明文字节串（解密直出 flag）；填 p,q 自动推 n 和 d。",
  params: [
    { key: "n", label: "模数 n", type: "text", default: "", placeholder: "十进制；留空则用 p·q" },
    { key: "e", label: "公钥指数 e", type: "text", default: "65537", placeholder: "加密/推 d 用" },
    { key: "d", label: "私钥指数 d", type: "text", default: "", placeholder: "解密；留空则由 p,q 推" },
    { key: "p", label: "素数 p（可选）", type: "text", default: "", placeholder: "填 p,q 自动算 n 和 d" },
    { key: "q", label: "素数 q（可选）", type: "text", default: "", placeholder: "填 p,q 自动算 n 和 d" },
    { key: "dataEnc", label: "输入编码", type: "select", default: "dec", options: RSA_DATA_ENC },
    { key: "outEnc", label: "输出编码", type: "select", default: "dec", options: RSA_DATA_ENC },
  ],
  encode: (text, p) => {
    const m = rsaTextToInt(text, p.dataEnc || "dec");
    const e = BigInt((p.e || "65537").trim());
    const n = rsaResolveN(p);
    return rsaIntToText(rsaPow(m, e, n), p.outEnc || "dec");
  },
  decode: (text, p) => {
    const c = rsaTextToInt(text, p.dataEnc || "dec");
    const d = rsaResolveD(p);
    const n = rsaResolveN(p);
    return rsaIntToText(rsaPow(c, d, n), p.outEnc || "dec");
  },
});
