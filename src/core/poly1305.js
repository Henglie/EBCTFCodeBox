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

// 一个 quarter round, 作用在 state 数组的 4 个索引上 (RFC 8439 §2.1)
function quarterRound(s, a, b, c, d) {
  s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl32(s[d] ^ s[a], 16);
  s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl32(s[b] ^ s[c], 12);
  s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl32(s[d] ^ s[a], 8);
  s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl32(s[b] ^ s[c], 7);
}

// 从 Uint8Array 读取小端 32-bit 字
function readLE32(bytes, off) {
  return (bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] << 24)) >>> 0;
}

// ChaCha20 block function (RFC 8439 §2.3): 返回 64 字节 keystream 块
// key: 32 字节, counter: 无符号 32-bit block 计数, nonce: 12 字节
function chacha20Block(key, counter, nonce) {
 // 常量 "expand 32-byte k"
  const state = new Uint32Array(16);
  state[0] = 0x61707865;
  state[1] = 0x3320646e;
  state[2] = 0x79622d32;
  state[3] = 0x6b206574;
  for (let i = 0; i < 8; i++) state[4 + i] = readLE32(key, i * 4);
  state[12] = counter >>> 0;
  for (let i = 0; i < 3; i++) state[13 + i] = readLE32(nonce, i * 4);

  const working = state.slice();
  for (let i = 0; i < 10; i++) {
 // column rounds
    quarterRound(working, 0, 4, 8, 12);
    quarterRound(working, 1, 5, 9, 13);
    quarterRound(working, 2, 6, 10, 14);
    quarterRound(working, 3, 7, 11, 15);
 // diagonal rounds
    quarterRound(working, 0, 5, 10, 15);
    quarterRound(working, 1, 6, 11, 12);
    quarterRound(working, 2, 7, 8, 13);
    quarterRound(working, 3, 4, 9, 14);
  }

  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i++) {
    const word = (working[i] + state[i]) >>> 0;
    out[i * 4] = word & 0xff;
    out[i * 4 + 1] = (word >>> 8) & 0xff;
    out[i * 4 + 2] = (word >>> 16) & 0xff;
    out[i * 4 + 3] = (word >>> 24) & 0xff;
  }
  return out;
}

// ChaCha20 流加密 (RFC 8439 §2.4)
// key: 32 字节, nonce: 12 字节, data: Uint8Array, initialCounter: 起始 block 号
export function chacha20(data, key, nonce, initialCounter = 0) {
  const out = new Uint8Array(data.length);
  let counter = initialCounter >>> 0;
  for (let off = 0; off < data.length; off += 64) {
    const ks = chacha20Block(key, counter, nonce);
    const blockLen = Math.min(64, data.length - off);
    for (let i = 0; i < blockLen; i++) {
      out[off + i] = data[off + i] ^ ks[i];
    }
    counter = (counter + 1) >>> 0;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Poly1305 MAC (RFC 8439 §2.5)
// ---------------------------------------------------------------------------

const P1305 = (1n << 130n) - 5n; // 2^130 - 5
const CLAMP = 0x0ffffffc0ffffffc0ffffffc0fffffffn;
const MASK128 = (1n << 128n) - 1n;

// 从 Uint8Array 子块读小端整数 (任意长度 <= 16)
function leBytesToBigInt(bytes, off, len) {
  let n = 0n;
  for (let i = len - 1; i >= 0; i--) {
    n = (n << 8n) | BigInt(bytes[off + i]);
  }
  return n;
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

 // r = le(key[0..16]) & clamp
  let r = leBytesToBigInt(key, 0, 16) & CLAMP;
 // s = le(key[16..32])
  const s = leBytesToBigInt(key, 16, 16);

  let acc = 0n;
  for (let off = 0; off < msg.length; off += 16) {
    const blockLen = Math.min(16, msg.length - off);
 // 读小端整数, 加上 1<<(8*blockLen)
    let n = leBytesToBigInt(msg, off, blockLen);
    n += 1n << BigInt(8 * blockLen);
    acc = ((acc + n) * r) % P1305;
  }
  acc = (acc + s) & MASK128; // 取低 128 位

 // 小端输出 16 字节
  const tag = new Uint8Array(16);
  let t = acc;
  for (let i = 0; i < 16; i++) {
    tag[i] = Number(t & 0xffn);
    t >>= 8n;
  }
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
