/*
 * poly1305.js — Poly1305 MAC + ChaCha20-Poly1305 AEAD
 *
 * 实现依据: RFC 8439 (ChaCha20 and Poly1305 for IETF Protocols)
 * - §2.3 ChaCha20 block function
 * - §2.4 ChaCha20 encryption
 * - §2.5 Poly1305 algorithm
 * - §2.6 Generating the Poly1305 key using ChaCha20
 * - §2.8 AEAD_CHACHA20_POLY1305
 *
 * 纯 JS, 无第三方依赖, 无 WASM。用 BigInt 做 130-bit 模运算。
 * 本文件自包含 (self-contained): 内置一份 ChaCha20 block 实现
 * 不 import 项目内其它文件, 便于离线单测。
 *
 * 权威测试向量来源:
 * - RFC 8439 §2.5.2 Poly1305 Example and Test Vector
 * - RFC 8439 §2.8.2 Example and Test Vector for AEAD_CHACHA20_POLY1305
 */

'use strict';

// ---------------------------------------------------------------------------
// ChaCha20 (RFC 8439 §2.1 - §2.4)
// ---------------------------------------------------------------------------

// 32-bit 左循环
function rotl32(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

// 从 Uint8Array 读取小端 32-bit 字
function readLE32(bytes, off) {
  return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
}

// 一个 64 字节块的 20 轮核心，全部用局部变量（V8 可保持在寄存器），
// 列/对角各 4 个 quarter round 手工展开。ks 为 Uint32Array，oo 为字偏移。
function chacha20BlockInto(kw, nw, counter, ks, oo) {
  let x0 = 0x61707865, x1 = 0x3320646e, x2 = 0x79622d32, x3 = 0x6b206574;
  let x4 = kw[0], x5 = kw[1], x6 = kw[2], x7 = kw[3];
  let x8 = kw[4], x9 = kw[5], x10 = kw[6], x11 = kw[7];
  let x12 = counter >>> 0, x13 = nw[0], x14 = nw[1], x15 = nw[2];
  for (let r = 0; r < 10; r++) {
    // column rounds
    x0 = (x0 + x4) >>> 0; x12 = rotl32(x12 ^ x0, 16);
    x8 = (x8 + x12) >>> 0; x4 = rotl32(x4 ^ x8, 12);
    x0 = (x0 + x4) >>> 0; x12 = rotl32(x12 ^ x0, 8);
    x8 = (x8 + x12) >>> 0; x4 = rotl32(x4 ^ x8, 7);

    x1 = (x1 + x5) >>> 0; x13 = rotl32(x13 ^ x1, 16);
    x9 = (x9 + x13) >>> 0; x5 = rotl32(x5 ^ x9, 12);
    x1 = (x1 + x5) >>> 0; x13 = rotl32(x13 ^ x1, 8);
    x9 = (x9 + x13) >>> 0; x5 = rotl32(x5 ^ x9, 7);

    x2 = (x2 + x6) >>> 0; x14 = rotl32(x14 ^ x2, 16);
    x10 = (x10 + x14) >>> 0; x6 = rotl32(x6 ^ x10, 12);
    x2 = (x2 + x6) >>> 0; x14 = rotl32(x14 ^ x2, 8);
    x10 = (x10 + x14) >>> 0; x6 = rotl32(x6 ^ x10, 7);

    x3 = (x3 + x7) >>> 0; x15 = rotl32(x15 ^ x3, 16);
    x11 = (x11 + x15) >>> 0; x7 = rotl32(x7 ^ x11, 12);
    x3 = (x3 + x7) >>> 0; x15 = rotl32(x15 ^ x3, 8);
    x11 = (x11 + x15) >>> 0; x7 = rotl32(x7 ^ x11, 7);

    // diagonal rounds
    x0 = (x0 + x5) >>> 0; x15 = rotl32(x15 ^ x0, 16);
    x10 = (x10 + x15) >>> 0; x5 = rotl32(x5 ^ x10, 12);
    x0 = (x0 + x5) >>> 0; x15 = rotl32(x15 ^ x0, 8);
    x10 = (x10 + x15) >>> 0; x5 = rotl32(x5 ^ x10, 7);

    x1 = (x1 + x6) >>> 0; x12 = rotl32(x12 ^ x1, 16);
    x11 = (x11 + x12) >>> 0; x6 = rotl32(x6 ^ x11, 12);
    x1 = (x1 + x6) >>> 0; x12 = rotl32(x12 ^ x1, 8);
    x11 = (x11 + x12) >>> 0; x6 = rotl32(x6 ^ x11, 7);

    x2 = (x2 + x7) >>> 0; x13 = rotl32(x13 ^ x2, 16);
    x8 = (x8 + x13) >>> 0; x7 = rotl32(x7 ^ x8, 12);
    x2 = (x2 + x7) >>> 0; x13 = rotl32(x13 ^ x2, 8);
    x8 = (x8 + x13) >>> 0; x7 = rotl32(x7 ^ x8, 7);

    x3 = (x3 + x4) >>> 0; x14 = rotl32(x14 ^ x3, 16);
    x9 = (x9 + x14) >>> 0; x4 = rotl32(x4 ^ x9, 12);
    x3 = (x3 + x4) >>> 0; x14 = rotl32(x14 ^ x3, 8);
    x9 = (x9 + x14) >>> 0; x4 = rotl32(x4 ^ x9, 7);
  }
  ks[oo] = (x0 + 0x61707865) >>> 0;
  ks[oo + 1] = (x1 + 0x3320646e) >>> 0;
  ks[oo + 2] = (x2 + 0x79622d32) >>> 0;
  ks[oo + 3] = (x3 + 0x6b206574) >>> 0;
  ks[oo + 4] = (x4 + kw[0]) >>> 0;
  ks[oo + 5] = (x5 + kw[1]) >>> 0;
  ks[oo + 6] = (x6 + kw[2]) >>> 0;
  ks[oo + 7] = (x7 + kw[3]) >>> 0;
  ks[oo + 8] = (x8 + kw[4]) >>> 0;
  ks[oo + 9] = (x9 + kw[5]) >>> 0;
  ks[oo + 10] = (x10 + kw[6]) >>> 0;
  ks[oo + 11] = (x11 + kw[7]) >>> 0;
  ks[oo + 12] = (x12 + (counter >>> 0)) >>> 0;
  ks[oo + 13] = (x13 + nw[0]) >>> 0;
  ks[oo + 14] = (x14 + nw[1]) >>> 0;
  ks[oo + 15] = (x15 + nw[2]) >>> 0;
}

function chachaWords(key, nonce) {
  const kw = new Uint32Array(8);
  const nw = new Uint32Array(3);
  for (let i = 0; i < 8; i++) kw[i] = readLE32(key, i * 4);
  for (let i = 0; i < 3; i++) nw[i] = readLE32(nonce, i * 4);
  return [kw, nw];
}

// ChaCha20 block function (RFC 8439 §2.3): 返回 64 字节 keystream 块
// key: 32 字节, counter: 无符号 32-bit block 计数, nonce: 12 字节
function chacha20Block(key, counter, nonce) {
  const kw = new Uint32Array(8);
  const nw = new Uint32Array(3);
  for (let i = 0; i < 8; i++) kw[i] = readLE32(key, i * 4);
  for (let i = 0; i < 3; i++) nw[i] = readLE32(nonce, i * 4);
  const words = new Uint32Array(16);
  chacha20BlockInto(kw, nw, counter, words, 0);
  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i++) {
    const w = words[i];
    out[i * 4] = w & 0xff;
    out[i * 4 + 1] = (w >>> 8) & 0xff;
    out[i * 4 + 2] = (w >>> 16) & 0xff;
    out[i * 4 + 3] = (w >>> 24) & 0xff;
  }
  return out;
}

// ChaCha20 流加密 (RFC 8439 §2.4)
// key: 32 字节, nonce: 12 字节, data: Uint8Array, initialCounter: 起始 block 号
export function chacha20(data, key, nonce, initialCounter = 0) {
  const out = new Uint8Array(data.length);
  const len = data.length;
  if (len === 0) return out;
  const [kw, nw] = chachaWords(key, nonce);
  const ks = new Uint32Array(64);
  let counter = initialCounter >>> 0;
  let off = 0;
  // 一次生成 4 块，复用 256 字节 keystream 缓冲
  while (off + 256 <= len) {
    chacha20BlockInto(kw, nw, counter, ks, 0);
    chacha20BlockInto(kw, nw, (counter + 1) >>> 0, ks, 16);
    chacha20BlockInto(kw, nw, (counter + 2) >>> 0, ks, 32);
    chacha20BlockInto(kw, nw, (counter + 3) >>> 0, ks, 48);
    counter = (counter + 4) >>> 0;
    for (let i = 0; i < 64; i++) {
      const w = ks[i];
      const p = off + i * 4;
      out[p] = data[p] ^ (w & 0xff);
      out[p + 1] = data[p + 1] ^ ((w >>> 8) & 0xff);
      out[p + 2] = data[p + 2] ^ ((w >>> 16) & 0xff);
      out[p + 3] = data[p + 3] ^ (w >>> 24);
    }
    off += 256;
  }
  while (off + 64 <= len) {
    chacha20BlockInto(kw, nw, counter, ks, 0);
    counter = (counter + 1) >>> 0;
    for (let i = 0; i < 16; i++) {
      const w = ks[i];
      const p = off + i * 4;
      out[p] = data[p] ^ (w & 0xff);
      out[p + 1] = data[p + 1] ^ ((w >>> 8) & 0xff);
      out[p + 2] = data[p + 2] ^ ((w >>> 16) & 0xff);
      out[p + 3] = data[p + 3] ^ (w >>> 24);
    }
    off += 64;
  }
  if (off < len) {
    chacha20BlockInto(kw, nw, counter, ks, 0);
    const n = len - off;
    for (let i = 0; i < n; i++) out[off + i] = data[off + i] ^ ((ks[i >>> 2] >>> ((i & 3) * 8)) & 0xff);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Poly1305 MAC (RFC 8439 §2.5)
// ---------------------------------------------------------------------------

// 32 位实现：6 个 22 位 limb（132 位），2^132 ≡ 20 (mod 2^130-5)；
// 单块仅 36 次乘法，避免 BigInt 取模。limb5 保持 < 2^20（值 < 2^130）。
const LIMB_B = 4194304; // 2^22
const LIMB_MASK = 4194303;
const TOP_B = 1048576; // 2^20，limb5 上限

// 从 16 字节小端读入 6 个 22 位 limb（不足部分视为 0）
function readLimbs22(bytes, off, out) {
  const w0 = readLE32(bytes, off);
  const w1 = readLE32(bytes, off + 4);
  const w2 = readLE32(bytes, off + 8);
  const w3 = readLE32(bytes, off + 12);
  out[0] = w0 & LIMB_MASK;
  out[1] = ((w0 >>> 22) | (w1 << 10)) & LIMB_MASK;
  out[2] = ((w1 >>> 12) | (w2 << 20)) & LIMB_MASK;
  out[3] = (w2 >>> 2) & LIMB_MASK;
  out[4] = ((w2 >>> 24) | (w3 << 8)) & LIMB_MASK;
  out[5] = w3 >>> 14;
}

const INV_B = 1 / LIMB_B;
const INV_TOP = 1 / TOP_B;

// 每块归一化：仅保证 limb < 2^22（值可到 2^132，仍在安全乘法范围）。
// 商 < 2^31，用 |0 截断代替 Math.floor（v 为整数，v/2^22 精确）。
function polyNorm(a) {
  for (let pass = 0; pass < 4; pass++) {
    let c = 0;
    for (let i = 0; i < 6; i++) {
      const v = a[i] + c;
      const q = (v * INV_B) | 0;
      a[i] = v - q * LIMB_B;
      c = q;
    }
    if (c === 0) break;
    a[0] += 20 * c;
  }
}

/**
 * Poly1305 MAC
 * @param {Uint8Array} msg 任意长度消息
 * @param {Uint8Array} key 32 字节一次性密钥
 * @returns {Uint8Array} 16 字节 tag
 */
export function poly1305Mac(msg, key) {
  if (!(key instanceof Uint8Array) || key.length !== 32) {
    throw new Error('poly1305Mac: key 必须为 32 字节 Uint8Array');
  }
  if (!(msg instanceof Uint8Array)) {
    throw new Error('poly1305Mac: msg 必须为 Uint8Array');
  }

 // r = le(key[0..16]) & clamp（字节掩码照 RFC 8439 §2.5）
  const rb = new Uint8Array(16);
  rb.set(key.subarray(0, 16));
  rb[3] &= 15; rb[7] &= 15; rb[11] &= 15; rb[15] &= 15;
  rb[4] &= 252; rb[8] &= 252; rb[12] &= 252;
  const r = new Float64Array(6);
  const r20 = new Float64Array(6);
  readLimbs22(rb, 0, r);
  for (let i = 0; i < 6; i++) r20[i] = 20 * r[i];
  const s = new Float64Array(6);
  readLimbs22(key, 16, s);

  const r0 = r[0], r1 = r[1], r2 = r[2], r3 = r[3], r4 = r[4], r5 = r[5];
  const R0 = r20[0], R1 = r20[1], R2 = r20[2], R3 = r20[3], R4 = r20[4], R5 = r20[5];
  let h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0;
  const H = new Float64Array(6);
  const d = new Float64Array(6);
  const pad = new Uint8Array(16);
  const fullEnd = msg.length & ~15;
  let off = 0;
 // 整块热路径：全部用局部变量，无分支/无 TypedArray 中转
  for (; off < fullEnd; off += 16) {
    const w0 = readLE32(msg, off);
    const w1 = readLE32(msg, off + 4);
    const w2 = readLE32(msg, off + 8);
    const w3 = readLE32(msg, off + 12);
    h0 += w0 & LIMB_MASK;
    h1 += ((w0 >>> 22) | (w1 << 10)) & LIMB_MASK;
    h2 += ((w1 >>> 12) | (w2 << 20)) & LIMB_MASK;
    h3 += (w2 >>> 2) & LIMB_MASK;
    h4 += ((w2 >>> 24) | (w3 << 8)) & LIMB_MASK;
    h5 += (w3 >>> 14) + (1 << 18); // 整块追加 2^128

    let d0 = h0 * r0 + h1 * R5 + h2 * R4 + h3 * R3 + h4 * R2 + h5 * R1;
    let d1 = h0 * r1 + h1 * r0 + h2 * R5 + h3 * R4 + h4 * R3 + h5 * R2;
    let d2 = h0 * r2 + h1 * r1 + h2 * r0 + h3 * R5 + h4 * R4 + h5 * R3;
    let d3 = h0 * r3 + h1 * r2 + h2 * r1 + h3 * r0 + h4 * R5 + h5 * R4;
    let d4 = h0 * r4 + h1 * r3 + h2 * r2 + h3 * r1 + h4 * r0 + h5 * R5;
    let d5 = h0 * r5 + h1 * r4 + h2 * r3 + h3 * r2 + h4 * r1 + h5 * r0;

    let c = (d0 * INV_B) | 0; d0 -= c * LIMB_B; d1 += c;
    c = (d1 * INV_B) | 0; d1 -= c * LIMB_B; d2 += c;
    c = (d2 * INV_B) | 0; d2 -= c * LIMB_B; d3 += c;
    c = (d3 * INV_B) | 0; d3 -= c * LIMB_B; d4 += c;
    c = (d4 * INV_B) | 0; d4 -= c * LIMB_B; d5 += c;
    c = (d5 * INV_B) | 0; d5 -= c * LIMB_B;
    d0 += 20 * c;

    c = (d0 * INV_B) | 0; d0 -= c * LIMB_B; d1 += c;
    c = (d1 * INV_B) | 0; d1 -= c * LIMB_B; d2 += c;
    c = (d2 * INV_B) | 0; d2 -= c * LIMB_B; d3 += c;
    c = (d3 * INV_B) | 0; d3 -= c * LIMB_B; d4 += c;
    c = (d4 * INV_B) | 0; d4 -= c * LIMB_B; d5 += c;
    c = (d5 * INV_B) | 0; d5 -= c * LIMB_B;
    d0 += 20 * c;

    if (c !== 0) {
      c = (d0 * INV_B) | 0; d0 -= c * LIMB_B; d1 += c;
      c = (d1 * INV_B) | 0; d1 -= c * LIMB_B; d2 += c;
      c = (d2 * INV_B) | 0; d2 -= c * LIMB_B; d3 += c;
      c = (d3 * INV_B) | 0; d3 -= c * LIMB_B; d4 += c;
      c = (d4 * INV_B) | 0; d4 -= c * LIMB_B; d5 += c;
      c = (d5 * INV_B) | 0; d5 -= c * LIMB_B;
      d0 += 20 * c;
      if (c !== 0) {
        H[0] = d0; H[1] = d1; H[2] = d2; H[3] = d3; H[4] = d4; H[5] = d5;
        polyNorm(H);
        d0 = H[0]; d1 = H[1]; d2 = H[2]; d3 = H[3]; d4 = H[4]; d5 = H[5];
      }
    }
    h0 = d0; h1 = d1; h2 = d2; h3 = d3; h4 = d4; h5 = d5;
  }
 // 末尾不足 16 字节的块（每消息最多一次）
  if (off < msg.length) {
    const n = msg.length - off;
    pad.fill(0);
    pad.set(msg.subarray(off, off + n));
    const w0 = readLE32(pad, 0);
    const w1 = readLE32(pad, 4);
    const w2 = readLE32(pad, 8);
    const w3 = readLE32(pad, 12);
    h0 += w0 & LIMB_MASK;
    h1 += ((w0 >>> 22) | (w1 << 10)) & LIMB_MASK;
    h2 += ((w1 >>> 12) | (w2 << 20)) & LIMB_MASK;
    h3 += (w2 >>> 2) & LIMB_MASK;
    h4 += ((w2 >>> 24) | (w3 << 8)) & LIMB_MASK;
    h5 += w3 >>> 14;
    const bp = n * 8;
    const bi = (bp / 22) | 0;
    if (bi === 0) h0 += 1 << bp;
    else if (bi === 1) h1 += 1 << (bp - 22);
    else if (bi === 2) h2 += 1 << (bp - 44);
    else if (bi === 3) h3 += 1 << (bp - 66);
    else if (bi === 4) h4 += 1 << (bp - 88);
    else h5 += 1 << (bp - 110);
    d[0] = h0 * r0 + h1 * R5 + h2 * R4 + h3 * R3 + h4 * R2 + h5 * R1;
    d[1] = h0 * r1 + h1 * r0 + h2 * R5 + h3 * R4 + h4 * R3 + h5 * R2;
    d[2] = h0 * r2 + h1 * r1 + h2 * r0 + h3 * R5 + h4 * R4 + h5 * R3;
    d[3] = h0 * r3 + h1 * r2 + h2 * r1 + h3 * r0 + h4 * R5 + h5 * R4;
    d[4] = h0 * r4 + h1 * r3 + h2 * r2 + h3 * r1 + h4 * r0 + h5 * R5;
    d[5] = h0 * r5 + h1 * r4 + h2 * r3 + h3 * r2 + h4 * r1 + h5 * r0;
    polyNorm(d);
    h0 = d[0]; h1 = d[1]; h2 = d[2]; h3 = d[3]; h4 = d[4]; h5 = d[5];
  }

 // 收尾归一化：折回 2^130/2^131/2^132 高位直到 h < 2^130
  for (let pass = 0; pass < 4; pass++) {
    let c = 0;
    let v = h0 + c; c = (v * INV_B) | 0; h0 = v - c * LIMB_B;
    v = h1 + c; c = (v * INV_B) | 0; h1 = v - c * LIMB_B;
    v = h2 + c; c = (v * INV_B) | 0; h2 = v - c * LIMB_B;
    v = h3 + c; c = (v * INV_B) | 0; h3 = v - c * LIMB_B;
    v = h4 + c; c = (v * INV_B) | 0; h4 = v - c * LIMB_B;
    v = h5 + c; c = (v * INV_B) | 0; h5 = v - c * LIMB_B;
    const tp = (h5 * INV_TOP) | 0;
    h5 -= tp * TOP_B;
    h0 += 20 * c + 5 * tp;
    if (c === 0 && tp === 0) break;
  }

 // 条件减 p：g = h + 5，若越过 2^130 则取 g
  let c = 5;
  let g0 = h0 + c, g1 = h1, g2 = h2, g3 = h3, g4 = h4, g5 = h5;
  c = (g0 * INV_B) | 0; g0 -= c * LIMB_B; g1 += c;
  c = (g1 * INV_B) | 0; g1 -= c * LIMB_B; g2 += c;
  c = (g2 * INV_B) | 0; g2 -= c * LIMB_B; g3 += c;
  c = (g3 * INV_B) | 0; g3 -= c * LIMB_B; g4 += c;
  c = (g4 * INV_B) | 0; g4 -= c * LIMB_B; g5 += c;
  c = (g5 * INV_B) | 0; g5 -= c * LIMB_B;
  let useG = c !== 0;
  if (g5 >= TOP_B) { g5 -= TOP_B; useG = true; }
  if (useG) { h0 = g0; h1 = g1; h2 = g2; h3 = g3; h4 = g4; h5 = g5; }

 // 加 s（低 128 位）
  h0 += s[0]; h1 += s[1]; h2 += s[2]; h3 += s[3]; h4 += s[4]; h5 += s[5];
  c = (h0 * INV_B) | 0; h0 -= c * LIMB_B; h1 += c;
  c = (h1 * INV_B) | 0; h1 -= c * LIMB_B; h2 += c;
  c = (h2 * INV_B) | 0; h2 -= c * LIMB_B; h3 += c;
  c = (h3 * INV_B) | 0; h3 -= c * LIMB_B; h4 += c;
  c = (h4 * INV_B) | 0; h4 -= c * LIMB_B; h5 += c;
  c = (h5 * INV_B) | 0; h5 -= c * LIMB_B;

 // 取低 128 位转 4 个小端 32 位字
  const w0 = (h0 | (h1 << 22)) >>> 0;
  const w1 = ((h1 >>> 10) | (h2 << 12)) >>> 0;
  const w2 = ((h2 >>> 20) | (h3 << 2) | (h4 << 24)) >>> 0;
  const w3 = ((h4 >>> 8) | (h5 << 14)) >>> 0;
  const tag = new Uint8Array(16);
  tag[0] = w0 & 0xff; tag[1] = (w0 >>> 8) & 0xff; tag[2] = (w0 >>> 16) & 0xff; tag[3] = (w0 >>> 24) & 0xff;
  tag[4] = w1 & 0xff; tag[5] = (w1 >>> 8) & 0xff; tag[6] = (w1 >>> 16) & 0xff; tag[7] = (w1 >>> 24) & 0xff;
  tag[8] = w2 & 0xff; tag[9] = (w2 >>> 8) & 0xff; tag[10] = (w2 >>> 16) & 0xff; tag[11] = (w2 >>> 24) & 0xff;
  tag[12] = w3 & 0xff; tag[13] = (w3 >>> 8) & 0xff; tag[14] = (w3 >>> 16) & 0xff; tag[15] = (w3 >>> 24) & 0xff;
  return tag;
}

// ---------------------------------------------------------------------------
// AEAD_CHACHA20_POLY1305 (RFC 8439 §2.8)
// ---------------------------------------------------------------------------

// 生成 Poly1305 一次性密钥 (RFC 8439 §2.6):
// otk = 前 32 字节 of ChaCha20 block(key, counter=0, nonce)
function poly1305KeyGen(key, nonce) {
  const block = chacha20Block(key, 0, nonce);
  return block.subarray(0, 32);
}

// pad16: 返回补齐到 16 倍数所需的 0 字节数 (若已是 16 倍数则为 0)
function pad16Len(len) {
  const rem = len % 16;
  return rem === 0 ? 0 : 16 - rem;
}

// le64: 将长度编码为 8 字节小端
function le64(n) {
  const out = new Uint8Array(8);
  let v = BigInt(n);
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

// 构造 AEAD 的 Poly1305 MAC 输入:
// aad || pad16(aad) || ciphertext || pad16(ciphertext) || le64(aad_len) || le64(ct_len)
function buildMacData(aad, ciphertext) {
  const aadLen = aad.length;
  const ctLen = ciphertext.length;
  const aadPad = pad16Len(aadLen);
  const ctPad = pad16Len(ctLen);
  const total = aadLen + aadPad + ctLen + ctPad + 16;
  const buf = new Uint8Array(total);
  let off = 0;
  buf.set(aad, off); off += aadLen;
  off += aadPad; // 已经是 0
  buf.set(ciphertext, off); off += ctLen;
  off += ctPad; // 已经是 0
  buf.set(le64(aadLen), off); off += 8;
  buf.set(le64(ctLen), off); off += 8;
  return buf;
}

// 恒定时间比较
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * AEAD 加密 (RFC 8439 §2.8)
 * @param {Uint8Array} key 32 字节
 * @param {Uint8Array} nonce 12 字节
 * @param {Uint8Array} plaintext
 * @param {Uint8Array} [aad] 可空
 * @returns {{ciphertext: Uint8Array, tag: Uint8Array}}
 */
export function chacha20Poly1305Encrypt(key, nonce, plaintext, aad) {
  if (!(key instanceof Uint8Array) || key.length !== 32) throw new Error('key 必须为 32 字节');
  if (!(nonce instanceof Uint8Array) || nonce.length !== 12) throw new Error('nonce 必须为 12 字节');
  if (!(plaintext instanceof Uint8Array)) throw new Error('plaintext 必须为 Uint8Array');
  const ad = aad instanceof Uint8Array ? aad : new Uint8Array(0);

  const otk = poly1305KeyGen(key, nonce);
  const ciphertext = chacha20(plaintext, key, nonce, 1); // counter 从 1 起
  const macData = buildMacData(ad, ciphertext);
  const tag = poly1305Mac(macData, otk);
  return { ciphertext, tag };
}

/**
 * AEAD 解密并验证 (RFC 8439 §2.8)
 * @param {Uint8Array} key 32 字节
 * @param {Uint8Array} nonce 12 字节
 * @param {Uint8Array} ciphertext
 * @param {Uint8Array} tag 16 字节
 * @param {Uint8Array} [aad] 可空
 * @returns {{ok: boolean, plaintext: Uint8Array|null}}
 */
export function chacha20Poly1305Decrypt(key, nonce, ciphertext, tag, aad) {
  if (!(key instanceof Uint8Array) || key.length !== 32) throw new Error('key 必须为 32 字节');
  if (!(nonce instanceof Uint8Array) || nonce.length !== 12) throw new Error('nonce 必须为 12 字节');
  if (!(ciphertext instanceof Uint8Array)) throw new Error('ciphertext 必须为 Uint8Array');
  if (!(tag instanceof Uint8Array) || tag.length !== 16) throw new Error('tag 必须为 16 字节');
  const ad = aad instanceof Uint8Array ? aad : new Uint8Array(0);

  const otk = poly1305KeyGen(key, nonce);
  const macData = buildMacData(ad, ciphertext);
  const expectedTag = poly1305Mac(macData, otk);

  if (!constantTimeEqual(expectedTag, tag)) {
    return { ok: false, plaintext: null };
  }
  const plaintext = chacha20(ciphertext, key, nonce, 1);
  return { ok: true, plaintext };
}

// 导出 chacha20Block 供内部/测试可选使用 (不影响主 API)
export { chacha20Block };
