/*
 * hashExt.js — 哈希扩展组（T22 交付）。
 *
 * 覆盖：SM3（国密）/ RIPEMD-160 / BLAKE2b / BLAKE2s —— WebCrypto 没有的纯 JS 哈希。
 * 与 hash.js 解耦（内嵌≠耦合红线），自写工具，不依赖 hash.js 内部函数。
 *
 * 红线：
 * - SM3 走国密标准 GB/T 32905-2016（前身 GM/T 0004-2012），IV/常量照抄标准不许编造。权威向量验证。
 * - RIPEMD-160 走 RFC 1320 附录（RIPEMD-160 spec），权威向量验证。
 * - BLAKE2b/s 走 RFC 7693，IV/常量照抄标准，权威向量验证。
 * - 零外发：全部本地纯 JS 计算。
 * - 契约：单向 run(text) → hex 串（T13 契约）。
 *
 * 供 T34 后续扩展 + CTF 场景使用。
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(s);
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// 32 位循环左移
function rotl32(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }
// 64 位循环右移（用 BigInt 模拟）
function rotr64(x, n) { return (x >> BigInt(n)) | ((x << BigInt(64 - n)) & 0xFFFFFFFFFFFFFFFFn); }

// ============================================================
// SM3 国密哈希（GB/T 32905-2016，前身 GM/T 0004-2012）
// 256 位输出，Merkle-Damgård 结构，64 轮压缩
// IV / Tj 常量照抄标准不许编造
// ============================================================
const SM3_IV = [
  0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600,
  0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e,
];

function sm3Tj(j) {
  return j <= 15 ? 0x79cc4519 : 0x7a879d8a;
}

function sm3FF(x, y, z, j) {
  if (j <= 15) return (x ^ y ^ z) >>> 0;
  return ((x & y) | (x & z) | (y & z)) >>> 0;
}
function sm3GG(x, y, z, j) {
  if (j <= 15) return (x ^ y ^ z) >>> 0;
  return ((x & y) | (~x & z)) >>> 0;
}
function sm3P0(x) { return (x ^ rotl32(x, 9) ^ rotl32(x, 17)) >>> 0; }
function sm3P1(x) { return (x ^ rotl32(x, 15) ^ rotl32(x, 23)) >>> 0; }

function sm3Compress(V, W) {
 // V: 8×uint32 (状态), W: 68×uint32 (扩展消息)
  const W1 = new Array(64);
  for (let j = 0; j < 64; j++) {
    W1[j] = (W[j] ^ W[j + 4]) >>> 0;
  }

  let A = V[0], B = V[1], C = V[2], D = V[3];
  let E = V[4], F = V[5], G = V[6], H = V[7];

  for (let j = 0; j < 64; j++) {
    const Tj = sm3Tj(j);
    const SS1 = rotl32((rotl32(A, 12) + E + rotl32(Tj, j % 32)) >>> 0, 7);
    const SS2 = (SS1 ^ rotl32(A, 12)) >>> 0;
    const TT1 = (sm3FF(A, B, C, j) + D + SS2 + W1[j]) >>> 0;
    const TT2 = (sm3GG(E, F, G, j) + H + SS1 + W[j]) >>> 0;
    D = C;
    C = rotl32(B, 9);
    B = A;
    A = TT1;
    H = G;
    G = rotl32(F, 19);
    F = E;
    E = sm3P0(TT2);
  }

  return [
    (A ^ V[0]) >>> 0, (B ^ V[1]) >>> 0, (C ^ V[2]) >>> 0, (D ^ V[3]) >>> 0,
    (E ^ V[4]) >>> 0, (F ^ V[5]) >>> 0, (G ^ V[6]) >>> 0, (H ^ V[7]) >>> 0,
  ];
}

function sm3Bytes(bytes) {
 // 消息填充：0x80 + 0x00... + 64 位大端长度（位）
  const origLen = bytes.length;
  const withOne = origLen + 1;
  const k = (56 - (withOne % 64) + 64) % 64;
  const total = withOne + k + 8;
  const msg = new Uint8Array(total);
  msg.set(bytes, 0);
  msg[origLen] = 0x80;
 // 大端长度（位）
  const bitLen = origLen * 8;
 // 高 32 位（消息长度 < 2^32 字节，高 32 位为 0）
  msg[total - 8] = 0; msg[total - 7] = 0; msg[total - 6] = 0; msg[total - 5] = 0;
  msg[total - 4] = (bitLen >>> 24) & 0xff;
  msg[total - 3] = (bitLen >>> 16) & 0xff;
  msg[total - 2] = (bitLen >>> 8) & 0xff;
  msg[total - 1] = bitLen & 0xff;

  let V = SM3_IV.slice();
  for (let i = 0; i < total; i += 64) {
 // 扩展消息 W[0..67]
    const W = new Array(68);
    for (let j = 0; j < 16; j++) {
      W[j] = ((msg[i + j * 4] << 24) | (msg[i + j * 4 + 1] << 16) | (msg[i + j * 4 + 2] << 8) | msg[i + j * 4 + 3]) >>> 0;
    }
    for (let j = 16; j < 68; j++) {
      W[j] = sm3P1((W[j - 16] ^ W[j - 9] ^ rotl32(W[j - 3], 15)) >>> 0) ^ rotl32(W[j - 13], 7) ^ W[j - 6];
      W[j] = W[j] >>> 0;
    }
    V = sm3Compress(V, W);
  }

 // 输出 8×uint32 → 32 字节（大端）
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (V[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (V[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (V[i] >>> 8) & 0xff;
    out[i * 4 + 3] = V[i] & 0xff;
  }
  return out;
}

function sm3(text) {
  return toHex(sm3Bytes(te(text)));
}

// ============================================================
// RIPEMD-160（RFC 1320 附录 RIPEMD-160 spec）
// 160 位输出，双线并行 Feistel
// ============================================================
const RIPEMD160_RL = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
  3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
  1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
  4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
];
const RIPEMD160_RR = [
  5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
  6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
  15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
  8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
  12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11,
];
const RIPEMD160_SL = [
  11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
  7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
  11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
  11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
  9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
];
const RIPEMD160_SR = [
  8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
  9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
  9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
  15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
  8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11,
];
const RIPEMD160_KL = [0x00000000, 0x5A827999, 0x6ED9EBA1, 0x8F1BBCDC, 0xA953FD4E];
const RIPEMD160_KR = [0x50A28BE6, 0x5C4DD124, 0x6D703EF3, 0x7A6D76E9, 0x00000000];

function ripemd160f(x, y, z, j) {
  if (j < 16) return (x ^ y ^ z) >>> 0;
  if (j < 32) return ((x & y) | (~x & z)) >>> 0;
  if (j < 48) return ((x | ~y) ^ z) >>> 0;
  if (j < 64) return ((x & z) | (y & ~z)) >>> 0;
  return (x ^ (y | ~z)) >>> 0;
}

function ripemd160Bytes(bytes) {
 // 消息填充：0x80 + 0x00... + 64 位小端长度（位）
  const origLen = bytes.length;
  const withOne = origLen + 1;
  const k = (56 - (withOne % 64) + 64) % 64;
  const total = withOne + k + 8;
  const msg = new Uint8Array(total);
  msg.set(bytes, 0);
  msg[origLen] = 0x80;
  const bitLen = origLen * 8;
 // 小端长度
  msg[total - 8] = bitLen & 0xff;
  msg[total - 7] = (bitLen >>> 8) & 0xff;
  msg[total - 6] = (bitLen >>> 16) & 0xff;
  msg[total - 5] = (bitLen >>> 24) & 0xff;
  msg[total - 4] = 0; msg[total - 3] = 0; msg[total - 2] = 0; msg[total - 1] = 0;

  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;

  for (let i = 0; i < total; i += 64) {
    const X = new Array(16);
    for (let j = 0; j < 16; j++) {
      X[j] = (msg[i + j * 4] | (msg[i + j * 4 + 1] << 8) | (msg[i + j * 4 + 2] << 16) | (msg[i + j * 4 + 3] << 24)) >>> 0;
    }

    let A = h0, B = h1, C = h2, D = h3, E = h4;
    let Ap = h0, Bp = h1, Cp = h2, Dp = h3, Ep = h4;

    for (let j = 0; j < 80; j++) {
 // 左线
      const T = (A + ripemd160f(B, C, D, j) + X[RIPEMD160_RL[j]] + RIPEMD160_KL[Math.floor(j / 16)]) >>> 0;
      const TT = (rotl32(T, RIPEMD160_SL[j]) + E) >>> 0;
      A = E; E = D; D = rotl32(C, 10); C = B; B = TT;

 // 右线
      const Tp = (Ap + ripemd160f(Bp, Cp, Dp, 79 - j) + X[RIPEMD160_RR[j]] + RIPEMD160_KR[Math.floor(j / 16)]) >>> 0;
      const TTp = (rotl32(Tp, RIPEMD160_SR[j]) + Ep) >>> 0;
      Ap = Ep; Ep = Dp; Dp = rotl32(Cp, 10); Cp = Bp; Bp = TTp;
    }

    const T = (h1 + C + Dp) >>> 0;
    h1 = (h2 + D + Ep) >>> 0;
    h2 = (h3 + E + Ap) >>> 0;
    h3 = (h4 + A + Bp) >>> 0;
    h4 = (h0 + B + Cp) >>> 0;
    h0 = T;
  }

  const out = new Uint8Array(20);
  const h = [h0, h1, h2, h3, h4];
  for (let i = 0; i < 5; i++) {
    out[i * 4] = h[i] & 0xff;
    out[i * 4 + 1] = (h[i] >>> 8) & 0xff;
    out[i * 4 + 2] = (h[i] >>> 16) & 0xff;
    out[i * 4 + 3] = (h[i] >>> 24) & 0xff;
  }
  return out;
}

function ripemd160(text) {
  return toHex(ripemd160Bytes(te(text)));
}

// ============================================================
// BLAKE2b（RFC 7693，64 位字，块 128 字节）
// 最多 64 字节输出（默认 64）
// ============================================================
const BLAKE2B_IV = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];
const BLAKE2B_SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
];

function blake2bG(v, a, b, c, d, x, y) {
  v[a] = (v[a] + v[b] + x) & 0xFFFFFFFFFFFFFFFFn;
  v[d] = rotr64(v[d] ^ v[a], 32);
  v[c] = (v[c] + v[d]) & 0xFFFFFFFFFFFFFFFFn;
  v[b] = rotr64(v[b] ^ v[c], 24);
  v[a] = (v[a] + v[b] + y) & 0xFFFFFFFFFFFFFFFFn;
  v[d] = rotr64(v[d] ^ v[a], 16);
  v[c] = (v[c] + v[d]) & 0xFFFFFFFFFFFFFFFFn;
  v[b] = rotr64(v[b] ^ v[c], 63);
}

function blake2bCompress(h, block, t, last) {
  const v = new Array(16);
  for (let i = 0; i < 8; i++) v[i] = h[i];
  for (let i = 0; i < 8; i++) v[i + 8] = BLAKE2B_IV[i];
  v[12] ^= t & 0xFFFFFFFFFFFFFFFFn;
  v[13] ^= (t >> 64n) & 0xFFFFFFFFFFFFFFFFn;
  if (last) v[14] ^= 0xFFFFFFFFFFFFFFFFn;

  const m = new Array(16);
  for (let i = 0; i < 16; i++) {
    let off = i * 8;
    m[i] = BigInt(block[off]) | (BigInt(block[off + 1]) << 8n) | (BigInt(block[off + 2]) << 16n) | (BigInt(block[off + 3]) << 24n) |
      (BigInt(block[off + 4]) << 32n) | (BigInt(block[off + 5]) << 40n) | (BigInt(block[off + 6]) << 48n) | (BigInt(block[off + 7]) << 56n);
  }

  for (let r = 0; r < 12; r++) {
    const s = BLAKE2B_SIGMA[r];
    blake2bG(v, 0, 4, 8, 12, m[s[0]], m[s[1]]);
    blake2bG(v, 1, 5, 9, 13, m[s[2]], m[s[3]]);
    blake2bG(v, 2, 6, 10, 14, m[s[4]], m[s[5]]);
    blake2bG(v, 3, 7, 11, 15, m[s[6]], m[s[7]]);
    blake2bG(v, 0, 5, 10, 15, m[s[8]], m[s[9]]);
    blake2bG(v, 1, 6, 11, 12, m[s[10]], m[s[11]]);
    blake2bG(v, 2, 7, 8, 13, m[s[12]], m[s[13]]);
    blake2bG(v, 3, 4, 9, 14, m[s[14]], m[s[15]]);
  }

  for (let i = 0; i < 8; i++) {
    h[i] ^= v[i] ^ v[i + 8];
    h[i] &= 0xFFFFFFFFFFFFFFFFn;
  }
}

function blake2bBytes(bytes, hashLen = 64, key = new Uint8Array(0)) {
  if (hashLen < 1 || hashLen > 64) throw new Error("BLAKE2b 输出长度需 1-64");
  if (key.length > 64) throw new Error("BLAKE2b 密钥需 ≤64 字节");

  const h = BLAKE2B_IV.slice();
  h[0] ^= 0x01010000n ^ (BigInt(key.length) << 8n) ^ BigInt(hashLen);

  let block = new Uint8Array(128);
  let t = 0n;
  let offset = 0;

  if (key.length > 0) {
    block.set(key);
 // 填充到 128
 // t += 128n;
 // blake2bCompress(h, block, t, false);
 // 不对，key 块也算输入
  }

 // 处理消息块（每 128 字节一块）
  const input = key.length > 0 ? (function () {
    const padded = new Uint8Array(128 + bytes.length);
    padded.set(key);
    padded.set(bytes, 128);
    return padded;
  })() : bytes;

  while (offset < input.length) {
    const remaining = input.length - offset;
    if (remaining > 128) {
      block = input.subarray(offset, offset + 128);
      t += 128n;
      blake2bCompress(h, block, t, false);
      offset += 128;
    } else {
 // 最后一块（< 128 字节）
      block = new Uint8Array(128);
      block.set(input.subarray(offset));
      t += BigInt(remaining);
      blake2bCompress(h, block, t, true);
      offset = input.length;
    }
  }

 // 空输入也要跑一次
  if (input.length === 0) {
    block = new Uint8Array(128);
    t = 0n;
    blake2bCompress(h, block, t, true);
  }

  const out = new Uint8Array(hashLen);
  for (let i = 0; i < hashLen; i++) {
    out[i] = Number((h[i >> 3] >> BigInt((i & 7) * 8)) & 0xFFn);
  }
  return out;
}

function blake2b(text, hashLen = 64) {
  return toHex(blake2bBytes(te(text), hashLen));
}

// ============================================================
// BLAKE2s（RFC 7693，32 位字，块 64 字节）
// 最多 32 字节输出（默认 32）
// ============================================================
const BLAKE2S_IV = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];
const BLAKE2S_SIGMA = BLAKE2B_SIGMA; // 同 b

function rotr32(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

function blake2sG(v, a, b, c, d, x, y) {
  v[a] = (v[a] + v[b] + x) >>> 0;
  v[d] = rotr32(v[d] ^ v[a], 16);
  v[c] = (v[c] + v[d]) >>> 0;
  v[b] = rotr32(v[b] ^ v[c], 12);
  v[a] = (v[a] + v[b] + y) >>> 0;
  v[d] = rotr32(v[d] ^ v[a], 8);
  v[c] = (v[c] + v[d]) >>> 0;
  v[b] = rotr32(v[b] ^ v[c], 7);
}

function blake2sCompress(h, block, t, last) {
  const v = new Array(16);
  for (let i = 0; i < 8; i++) v[i] = h[i];
  for (let i = 0; i < 8; i++) v[i + 8] = BLAKE2S_IV[i];
  v[12] ^= (t & 0xFFFFFFFF) >>> 0; // 低 32 位计数器
 // v[13] ^= 0; // 高 32 位（t < 2^32 字节时恒为 0，省略）
  if (last) v[14] ^= 0xFFFFFFFF;

  const m = new Array(16);
  for (let i = 0; i < 16; i++) {
    const off = i * 4;
    m[i] = (block[off] | (block[off + 1] << 8) | (block[off + 2] << 16) | (block[off + 3] << 24)) >>> 0;
  }

  for (let r = 0; r < 10; r++) {
    const s = BLAKE2S_SIGMA[r];
    blake2sG(v, 0, 4, 8, 12, m[s[0]], m[s[1]]);
    blake2sG(v, 1, 5, 9, 13, m[s[2]], m[s[3]]);
    blake2sG(v, 2, 6, 10, 14, m[s[4]], m[s[5]]);
    blake2sG(v, 3, 7, 11, 15, m[s[6]], m[s[7]]);
    blake2sG(v, 0, 5, 10, 15, m[s[8]], m[s[9]]);
    blake2sG(v, 1, 6, 11, 12, m[s[10]], m[s[11]]);
    blake2sG(v, 2, 7, 8, 13, m[s[12]], m[s[13]]);
    blake2sG(v, 3, 4, 9, 14, m[s[14]], m[s[15]]);
  }

  for (let i = 0; i < 8; i++) {
    h[i] = (h[i] ^ v[i] ^ v[i + 8]) >>> 0;
  }
}

function blake2sBytes(bytes, hashLen = 32, key = new Uint8Array(0)) {
  if (hashLen < 1 || hashLen > 32) throw new Error("BLAKE2s 输出长度需 1-32");
  if (key.length > 32) throw new Error("BLAKE2s 密钥需 ≤32 字节");

  const h = BLAKE2S_IV.slice();
  h[0] ^= 0x01010000 ^ (key.length << 8) ^ hashLen;

 // key 块作为第一块输入
  const input = key.length > 0 ? (function () {
    const padded = new Uint8Array(64 + bytes.length);
    padded.set(key);
    padded.set(bytes, 64);
    return padded;
  })() : bytes;

  let block;
  let t = 0;
  let offset = 0;

  while (offset < input.length) {
    const remaining = input.length - offset;
    if (remaining > 64) {
      block = input.subarray(offset, offset + 64);
      t += 64;
      blake2sCompress(h, block, t, false);
      offset += 64;
    } else {
      block = new Uint8Array(64);
      block.set(input.subarray(offset));
      t += remaining;
      blake2sCompress(h, block, t, true);
      offset = input.length;
    }
  }

  if (input.length === 0) {
    block = new Uint8Array(64);
    t = 0;
    blake2sCompress(h, block, t, true);
  }

  const out = new Uint8Array(hashLen);
  for (let i = 0; i < hashLen; i++) {
    out[i] = (h[i >> 2] >>> ((i & 3) * 8)) & 0xff;
  }
  return out;
}

function blake2s(text, hashLen = 32) {
  return toHex(blake2sBytes(te(text), hashLen));
}

// ============================================================
// T45 哈希扩展补全组
// 覆盖：Adler-32 / CRC-8(SMBus) / CRC-8(MAXIM) / CRC-64(ECMA-182) /
// CRC-32C(Castagnoli) / FNV-1a(32,64) / MurmurHash3(x86_32)
// 全部纯 JS、零外发。权威向量对拍：
// Adler-32 RFC 1950（zlib 参考实现）
// CRC-* CRC catalog（reveng）检验值（"123456789"）
// FNV-1a FNV spec（isthe.com）官方向量
// Murmur3 Austin Appleby MurmurHash3 参考实现 + mmh3 库对照
// ============================================================

// ---- 数值 → 大端 hex 工具 ----
const hexU8 = (x) => (x & 0xff).toString(16).padStart(2, "0");
const hexU32be = (x) => {
  x = x >>> 0;
  return [24, 16, 8, 0].map((s) => ((x >>> s) & 0xff).toString(16).padStart(2, "0")).join("");
};
const hexU64be = (x) => {
  let out = "";
  for (let i = 7; i >= 0; i--) {
    out += ((x >> BigInt(i * 8)) & 0xFFn).toString(16).padStart(2, "0");
  }
  return out;
};

// ============================================================
// Adler-32（RFC 1950）
// 32 位校验和：s1=1 起步、s2=0；每字节 s1+=b、s2+=s1，均 mod 65521
// 输出 = (s2 << 16) | s1
// ============================================================
function adler32(bytes) {
  let s1 = 1, s2 = 0;
  for (const b of bytes) {
    s1 = (s1 + b) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  return ((s2 << 16) | s1) >>> 0;
}

// ============================================================
// CRC-8/SMBus（poly=0x07, init=0x00, refin=false, refout=false, xorout=0x00）
// MSB-first 8 位 CRC，逐位实现（输入短，无需查表）
// ============================================================
function crc8Smbus(bytes) {
  let crc = 0x00;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc & 0xff;
}

// ============================================================
// CRC-8/MAXIM（Dallas/Maxim 1-Wire，poly=0x31→reflected 0x8C
// init=0x00, refin=true, refout=true, xorout=0x00）
// 反射型 8 位 CRC
// ============================================================
function crc8Maxim(bytes) {
  let crc = 0x00;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0x8C) & 0xff : (crc >>> 1) & 0xff;
    }
  }
  return crc & 0xff;
}

// ============================================================
// CRC-64/ECMA-182（poly=0x42F0E1EBA9EA3693, init=0, refin=false
// refout=false, xorout=0）BigInt MSB-first，XZ 用
// ============================================================
function crc64Ecma(bytes) {
  const poly = 0x42F0E1EBA9EA3693n;
  const topbit = 0x8000000000000000n;
  let crc = 0n;
  for (const b of bytes) {
    crc ^= BigInt(b) << 56n;
    for (let i = 0; i < 8; i++) {
      crc = (crc & topbit) ? ((crc << 1n) ^ poly) : (crc << 1n);
    }
  }
  return crc & 0xFFFFFFFFFFFFFFFFn;
}

// ============================================================
// CRC-32C / Castagnoli（poly=0x1EDC6F41→reflected 0x82F63B78
// init=0xFFFFFFFF, refin=true, refout=true
// xorout=0xFFFFFFFF）iSCSI / ext4 / SSE4.2 CRC32
// ============================================================
function crc32c(bytes) {
  let crc = 0xFFFFFFFF;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 1) ? ((crc >>> 1) ^ 0x82F63B78) >>> 0 : (crc >>> 1);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ============================================================
// FNV-1a 32 位（offset basis=0x811C9DC5, prime=0x01000193）
// 非加密哈希，每字节：h ^= b; h *= prime
// ============================================================
function fnv1a32(bytes) {
  let h = 0x811C9DC5;
  for (const b of bytes) {
    h ^= b;
    h = Math.imul(h >>> 0, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// ============================================================
// FNV-1a 64 位（offset basis=0xCBF29CE484222325, prime=0x100000001B3）BigInt
// ============================================================
function fnv1a64(bytes) {
  let h = 0xCBF29CE484222325n;
  const prime = 0x100000001B3n;
  for (const b of bytes) {
    h ^= BigInt(b);
    h = (h * prime) & 0xFFFFFFFFFFFFFFFFn;
  }
  return h;
}

// ============================================================
// MurmurHash3 x86 32 位（Austin Appleby，seed=0 默认）
// 非加密哈希，CTF / 一致性哈希高频
// ============================================================
function murmur3_32(bytes, seed = 0) {
  const c1 = 0xcc9e2d51, c2 = 0x1b873593;
  let h = seed >>> 0;
  const nblocks = bytes.length >>> 2;

  for (let i = 0; i < nblocks; i++) {
    const off = i * 4;
    let k = (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
    k = Math.imul(k, c1) >>> 0;
    k = rotl32(k, 15);
    k = Math.imul(k, c2) >>> 0;
    h = (h ^ k) >>> 0;
    h = rotl32(h, 13);
    h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  }

 // 尾巴（剩余 < 4 字节，按小端拼到 k1）
  const tailOff = nblocks * 4;
  const rem = bytes.length & 3;
  let k1 = 0;
  if (rem === 3) k1 = (bytes[tailOff] ^ (bytes[tailOff + 1] << 8) ^ (bytes[tailOff + 2] << 16)) >>> 0;
  else if (rem === 2) k1 = (bytes[tailOff] ^ (bytes[tailOff + 1] << 8)) >>> 0;
  else if (rem === 1) k1 = bytes[tailOff] >>> 0;
  if (rem !== 0) {
    k1 = Math.imul(k1, c1) >>> 0;
    k1 = rotl32(k1, 15);
    k1 = Math.imul(k1, c2) >>> 0;
    h = (h ^ k1) >>> 0;
  }

 // 终值混合（finalization）
  h = (h ^ bytes.length) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

// hex 包装（run 契约：text → hex 串）
function adler32Hex(text)    { return hexU32be(adler32(te(text))); }
function crc8SmbusHex(text)  { return hexU8(crc8Smbus(te(text))); }
function crc8MaximHex(text)  { return hexU8(crc8Maxim(te(text))); }
function crc64EcmaHex(text)  { return hexU64be(crc64Ecma(te(text))); }
function crc32cHex(text)     { return hexU32be(crc32c(te(text))); }
function fnv1a32Hex(text)    { return hexU32be(fnv1a32(te(text))); }
function fnv1a64Hex(text)    { return hexU64be(fnv1a64(te(text))); }
function murmur3_32Hex(text) { return hexU32be(murmur3_32(te(text))); }

// ============================================================
// register 层
// ============================================================
register({
  id: "sm3", cat: "hash", name: "SM3", desc: "国密哈希（GB/T 32905-2016，前身 GM/T 0004-2012，256 位，国内 CTF 高频）",
  run: (t) => sm3(t),
});

register({
  id: "ripemd160", cat: "hash", name: "RIPEMD-160", desc: "RIPEMD-160 消息摘要（160 位，比特币地址用）",
  run: (t) => ripemd160(t),
});

register({
  id: "blake2b", cat: "hash", name: "BLAKE2b", desc: "BLAKE2b 哈希（RFC 7693，最多 64 字节输出，默认 512 位）",
  params: [
    { key: "hashLen", label: "输出字节数", type: "number", default: 64, placeholder: "1-64" },
  ],
  run: (t, p) => blake2b(t, (p && p.hashLen) || 64),
});

register({
  id: "blake2s", cat: "hash", name: "BLAKE2s", desc: "BLAKE2s 哈希（RFC 7693，最多 32 字节输出，默认 256 位）",
  params: [
    { key: "hashLen", label: "输出字节数", type: "number", default: 32, placeholder: "1-32" },
  ],
  run: (t, p) => blake2s(t, (p && p.hashLen) || 32),
});

// ---- T45 哈希扩展补全组 register ----
register({
  id: "adler32", cat: "hash", name: "Adler-32",
  desc: "Adler-32 校验和（RFC 1950，zlib 用，32 位）",
  run: (t) => adler32Hex(t),
});

register({
  id: "crc8", cat: "hash", name: "CRC-8",
  desc: "CRC-8/SMBus（poly=0x07，8 位校验）",
  run: (t) => crc8SmbusHex(t),
});

register({
  id: "crc8_maxim", cat: "hash", name: "CRC-8/MAXIM",
  desc: "CRC-8/MAXIM（Dallas 1-Wire，poly=0x31 反射，8 位校验）",
  run: (t) => crc8MaximHex(t),
});

register({
  id: "crc64", cat: "hash", name: "CRC-64",
  desc: "CRC-64/ECMA-182（poly=0x42F0E1EBA9EA3693，64 位校验，XZ 用）",
  run: (t) => crc64EcmaHex(t),
});

register({
  id: "crc32c", cat: "hash", name: "CRC-32C",
  desc: "CRC-32C/Castagnoli（poly=0x1EDC6F41，iSCSI/ext4/SSE4.2，与 IEEE CRC32 不同）",
  run: (t) => crc32cHex(t),
});

register({
  id: "fnv1a", cat: "hash", name: "FNV-1a",
  desc: "FNV-1a 非加密哈希（位宽可选 32/64；32 位 offset=0x811C9DC5/prime=0x01000193，64 位 offset=0xCBF29CE484222325/prime=0x100000001B3）",
  params: [
    { key: "bits", label: "输出位数", type: "select", default: 32, options: [
      { value: 32, label: "32" },
      { value: 64, label: "64" },
    ] },
  ],
  run: (t, p) => {
    const bits = Number((p && p.bits != null) ? p.bits : 32);
    return bits === 64 ? fnv1a64Hex(t) : fnv1a32Hex(t);
  },
});

register({
  id: "murmur3_32", cat: "hash", name: "MurmurHash3-32",
  desc: "MurmurHash3 x86 32 位非加密哈希（seed=0，CTF/一致性哈希高频）",
  run: (t) => murmur3_32Hex(t),
});

export {
  sm3, sm3Bytes,
  ripemd160, ripemd160Bytes,
  blake2b, blake2bBytes,
  blake2s, blake2sBytes,
 // T45 扩展
  adler32, adler32Hex,
  crc8Smbus, crc8SmbusHex,
  crc8Maxim, crc8MaximHex,
  crc64Ecma, crc64EcmaHex,
  crc32c, crc32cHex,
  fnv1a32, fnv1a32Hex,
  fnv1a64, fnv1a64Hex,
  murmur3_32, murmur3_32Hex,
};
