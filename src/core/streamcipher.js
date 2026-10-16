/*
 * streamcipher.js — ChaCha20 + Rabbit 流密码（cat:'modern'）。
 *
 * 覆盖：
 * chacha20 RFC 8439 ChaCha20（256-bit key + 96-bit nonce + 32-bit counter），双向对称
 * rabbit RFC 4503 Rabbit（128-bit key + 64-bit IV），双向对称
 *
 * 约束：
 * - ChaCha20 照 RFC 8439（quarter round + 20 轮 + little-endian 序列化）。
 * - Rabbit 照 RFC 4503（g 函数 + 计数器进位 + 8 状态变量）。
 *   0.1.10 起 op 层提供三变体：CryptoJS Legacy / CryptoJS 标准 / RFC 4503 文档方向，
 *   换算为纯输入重排，见下方「Rabbit 兼容层」；核心状态机不变。
 * - 往返测试 + RFC 测试向量必过。
 * - 零外发：纯本地计算。
 *
 * 参考：
 * - RFC 8439 "ChaCha20 and Poly1305 for IETF Protocols"（2018）
 * - RFC 4503 "The Rabbit Stream Cipher Algorithm Specification"（2006）
 * - crypto-js 4.2.0 test/rabbit-test.js、test/rabbit-legacy-test.js（eSTREAM 向量）
 *
 * 契约：register({id, cat:"modern", name, desc, params, encode, decode})。
 * encode(text, p): text → UTF-8 bytes → XOR keystream → hex 大写
 * decode(hex, p): hex → bytes → XOR keystream → UTF-8 文本
 * 流密码对称：decode(encode(x, p), p) === x
 */
import { register } from "./registry.js";
import { md5Bytes } from "./hash.js";
import { randomBytes as randBytes } from "./randSource.js"; // 统一随机源（口令模式盐；默认档 system 逐字节零回归）
import { isPrintableRatio } from "./magic/scorer.js"; // 爆破「可读文本」判定（与 magic 同口径）

// ============================================================
// 通用工具
// ============================================================
function strToBytes(s) {
  return new TextEncoder().encode(String(s));
}
function bytesToStr(b) {
  return new TextDecoder("utf-8", { fatal: false }).decode(b);
}
function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s.toUpperCase();
}
function hexToBytes(s) {
  s = String(s).trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (s.length === 0) return new Uint8Array(0);
  if (s.length % 2 !== 0) throw new Error("Hex 长度须为偶数：" + s.length);
  if (!/^[0-9a-fA-F]+$/.test(s)) throw new Error("非法 Hex 字符：" + s);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

function rotl32(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

// 读 4 字节 little-endian → 32 位无符号
function le32(b, off) {
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
}

// ============================================================
// 1. ChaCha20（RFC 8439）
// ============================================================
// 状态 16 字（32 位）：
// [0-3] 常数 "expand 32-byte k" = 0x61707865 0x3320646e 0x79622d32 0x6b206574
// [4-11] key（256-bit，8 字，little-endian）
// [12] counter（32-bit）
// [13-15] nonce（96-bit，3 字，little-endian）
// 轮函数 quarter round：
// a += b; d ^= a; d <<<= 16;
// c += d; b ^= c; b <<<= 12;
// a += b; d ^= a; d <<<= 8;
// c += d; b ^= c; b <<<= 7;
// 20 轮 = 10 双轮（列轮 + 对角轮）。

const CHACHA_CONST = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];

function chachaQR(s, a, b, c, d) {
  s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl32(s[d] ^ s[a], 16);
  s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl32(s[b] ^ s[c], 12);
  s[a] = (s[a] + s[b]) >>> 0; s[d] = rotl32(s[d] ^ s[a], 8);
  s[c] = (s[c] + s[d]) >>> 0; s[b] = rotl32(s[b] ^ s[c], 7);
}

// 生成 64 字节 keystream block
function chachaBlock(key, counter, nonce) {
  const state = new Array(16);
  state[0] = CHACHA_CONST[0];
  state[1] = CHACHA_CONST[1];
  state[2] = CHACHA_CONST[2];
  state[3] = CHACHA_CONST[3];
  for (let i = 0; i < 8; i++) state[4 + i] = le32(key, 4 * i);
  state[12] = counter >>> 0;
  for (let i = 0; i < 3; i++) state[13 + i] = le32(nonce, 4 * i);

  const work = state.slice();
  for (let i = 0; i < 10; i++) {
 // 列轮
    chachaQR(work, 0, 4, 8, 12);
    chachaQR(work, 1, 5, 9, 13);
    chachaQR(work, 2, 6, 10, 14);
    chachaQR(work, 3, 7, 11, 15);
 // 对角轮
    chachaQR(work, 0, 5, 10, 15);
    chachaQR(work, 1, 6, 11, 12);
    chachaQR(work, 2, 7, 8, 13);
    chachaQR(work, 3, 4, 9, 14);
  }

  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i++) {
    const v = (work[i] + state[i]) >>> 0;
    out[4 * i] = v & 0xff;
    out[4 * i + 1] = (v >>> 8) & 0xff;
    out[4 * i + 2] = (v >>> 16) & 0xff;
    out[4 * i + 3] = (v >>> 24) & 0xff;
  }
  return out;
}

// ChaCha20 加解密（对称）：bytes XOR keystream
function chacha20Crypt(bytes, key, nonce, counter) {
  const out = new Uint8Array(bytes.length);
  let blk = counter >>> 0;
  let off = 0;
  while (off < bytes.length) {
    const ks = chachaBlock(key, blk, nonce);
    const len = Math.min(64, bytes.length - off);
    for (let i = 0; i < len; i++) out[off + i] = bytes[off + i] ^ ks[i];
    off += len;
    blk = (blk + 1) >>> 0;
  }
  return out;
}

function chacha20CheckParams(p) {
  const key = hexToBytes((p && p.key) || "");
  const nonce = hexToBytes((p && p.nonce) || "");
  const counter = Number((p && p.counter != null) ? p.counter : 0);
  if (key.length !== 32) throw new Error("ChaCha20 key 须 32 字节（64 hex），实为 " + key.length);
  if (nonce.length !== 12) throw new Error("ChaCha20 nonce 须 12 字节（24 hex），实为 " + nonce.length);
  if (!Number.isInteger(counter) || counter < 0 || counter > 0xFFFFFFFF) {
    throw new Error("counter 须 0-4294967295（实为 " + counter + "）");
  }
  return { key, nonce, counter };
}

function chacha20Encode(text, p) {
  const { key, nonce, counter } = chacha20CheckParams(p);
  return bytesToHex(chacha20Crypt(strToBytes(text), key, nonce, counter));
}

function chacha20Decode(hex, p) {
  const { key, nonce, counter } = chacha20CheckParams(p);
  return bytesToStr(chacha20Crypt(hexToBytes(hex), key, nonce, counter));
}

// ============================================================
// 2. Rabbit（RFC 4503）
// ============================================================
// 状态：8 个 32 位 X[0..7] + 8 个 32 位 C[0..7] + 进位 bit b
// key：128-bit（16 字节，big-endian / OS2IP），IV：64-bit（8 字节，big-endian）
//
// 子密钥：K7 = bytes[0..1]（最高 16 位），K0 = bytes[14..15]（最低 16 位）
// K_i = (keyBytes[2*(7-i)] << 8) | keyBytes[2*(7-i)+1]
//
// 常数（计数器增量）：
// A0=0x4D34D34D A1=0xD34D34D3 A2=0x34D34D34 A3=0x4D34D34D
// A4=0xD34D34D3 A5=0x34D34D34 A6=0x4D34D34D A7=0xD34D34D3
//
// g 函数（32-bit → 32-bit）：
// g(u,v) = LSW(square(u+v)) ^ MSW(square(u+v))
// square(w) = (w mod 2^32) * (w mod 2^32) （64-bit 乘法）
// 即：t = ((u+v) mod 2^32)^2，返回 low32(t) ^ high32(t)
//
// 计数器更新（带进位链）：
// for j=0..7: temp = C[j] + A[j] + b; b = temp div 2^32; C[j] = temp mod 2^32
//
// next-state（新 X，照 RFC 4503 §2.6，加法 + 旋转，非 XOR/shift）：
// X0 = G0 + (G7 <<< 16) + (G6 <<< 16) mod 2^32
// X1 = G1 + (G0 <<< 8) + G7 mod 2^32
// X2 = G2 + (G1 <<< 16) + (G0 <<< 16) mod 2^32
// X3 = G3 + (G2 <<< 8) + G1 mod 2^32
// X4 = G4 + (G3 <<< 16) + (G2 <<< 16) mod 2^32
// X5 = G5 + (G4 <<< 8) + G3 mod 2^32
// X6 = G6 + (G5 <<< 16) + (G4 <<< 16) mod 2^32
// X7 = G7 + (G6 <<< 8) + G5 mod 2^32
//
// 提取（每块 16 字节，照 RFC 4503 §2.7，16 位半字 XOR）：
// S[15..0] = X0[15..0] ^ X5[31..16]
// S[31..16] = X0[31..16] ^ X3[15..0]
// S[47..32] = X2[15..0] ^ X7[31..16]
// S[63..48] = X2[31..16] ^ X5[15..0]
// S[79..64] = X4[15..0] ^ X1[31..16]
// S[95..80] = X4[31..16] ^ X7[15..0]
// S[111..96] = X6[15..0] ^ X3[31..16]
// S[127..112] = X6[31..16] ^ X1[15..0]

const RABBIT_A = [0x4D34D34D, 0xD34D34D3, 0x34D34D34, 0x4D34D34D,
                  0xD34D34D3, 0x34D34D34, 0x4D34D34D, 0xD34D34D3];

function rabbitG(u) {
 // g 函数：t = u*u (64-bit)，返回 low32(t) ^ high32(t)（用 BigInt 精确 64 位乘法）
  const u64 = BigInt(u);
  const t = u64 * u64;
  const low = Number(t & 0xFFFFFFFFn);
  const high = Number((t >> 32n) & 0xFFFFFFFFn);
  return (low ^ high) >>> 0;
}

class RabbitCipher {
  constructor() {
    this.X = new Array(8).fill(0);
    this.C = new Array(8).fill(0);
    this.b = 0;
  }

 // key: 16 字节（big-endian，照 RFC 4503 §2.3 + OS2IP）
  keySetup(keyBytes) {
    if (keyBytes.length !== 16) {
      throw new Error("Rabbit key 须 16 字节（32 hex），实为 " + keyBytes.length);
    }
 // 子密钥 K7 = bytes[0..1]（最高），K0 = bytes[14..15]（最低）
    const K = new Array(8);
    for (let i = 0; i < 8; i++) {
      K[i] = ((keyBytes[2 * (7 - i)] << 8) | keyBytes[2 * (7 - i) + 1]) & 0xFFFF;
    }
 // 状态 + 计数器初始化（照 RFC 4503 §2.3，even/odd j 不同公式）
    for (let j = 0; j < 8; j++) {
      if (j % 2 === 0) {
 // even: Xj = K(j+1) || Kj，Cj = K(j+4) || K(j+5)
        this.X[j] = ((K[(j + 1) % 8] << 16) | K[j]) >>> 0;
        this.C[j] = ((K[(j + 4) % 8] << 16) | K[(j + 5) % 8]) >>> 0;
      } else {
 // odd: Xj = K(j+5) || K(j+4)，Cj = Kj || K(j+1)
        this.X[j] = ((K[(j + 5) % 8] << 16) | K[(j + 4) % 8]) >>> 0;
        this.C[j] = ((K[j] << 16) | K[(j + 1) % 8]) >>> 0;
      }
    }
    this.b = 0;
 // 4 次 next-state
    for (let i = 0; i < 4; i++) this.nextState();
 // 计数器再初始化：Cj ^= X(j+4 mod 8)
    for (let j = 0; j < 8; j++) {
      this.C[j] = (this.C[j] ^ this.X[(j + 4) % 8]) >>> 0;
    }
  }

 // iv: 8 字节（big-endian，照 RFC 4503 §2.4 + OS2IP）
  ivSetup(ivBytes) {
    if (ivBytes.length !== 8) {
      throw new Error("Rabbit IV 须 8 字节（16 hex），实为 " + ivBytes.length);
    }
 // IV[63..0] big-endian：IV[31..0] = bytes 4-7, IV[63..32] = bytes 0-3
    const IV0 = (ivBytes[4] << 24) | (ivBytes[5] << 16) | (ivBytes[6] << 8) | ivBytes[7]; // IV[31..0]
    const IV1 = (ivBytes[0] << 24) | (ivBytes[1] << 16) | (ivBytes[2] << 8) | ivBytes[3]; // IV[63..32]
    const iv_15_0  = IV0 & 0xFFFF;
    const iv_31_16 = (IV0 >>> 16) & 0xFFFF;
    const iv_47_32 = IV1 & 0xFFFF;
    const iv_63_48 = (IV1 >>> 16) & 0xFFFF;
 // 照 RFC 4503 §2.4：
    this.C[0] = (this.C[0] ^ IV0) >>> 0;
    this.C[1] = (this.C[1] ^ ((iv_63_48 << 16) | iv_31_16)) >>> 0;
    this.C[2] = (this.C[2] ^ IV1) >>> 0;
    this.C[3] = (this.C[3] ^ ((iv_47_32 << 16) | iv_15_0)) >>> 0;
    this.C[4] = (this.C[4] ^ IV0) >>> 0;
    this.C[5] = (this.C[5] ^ ((iv_63_48 << 16) | iv_31_16)) >>> 0;
    this.C[6] = (this.C[6] ^ IV1) >>> 0;
    this.C[7] = (this.C[7] ^ ((iv_47_32 << 16) | iv_15_0)) >>> 0;
 // 4 次 next-state
    for (let i = 0; i < 4; i++) this.nextState();
  }

  nextState() {
 // 1. 计数器更新（带进位链，照 RFC 4503 §2.5）
    let carry = this.b;
    for (let i = 0; i < 8; i++) {
      const sum = this.C[i] + RABBIT_A[i] + carry;
      this.C[i] = sum >>> 0;  // >>> 0 转 Uint32（& 0xFFFFFFFF 返回 Int32 有符号，会导致负数级联错误）
      carry = sum > 0xFFFFFFFF ? 1 : 0;
    }
    this.b = carry;

 // 2. G 函数：G[j] = g(X[j], C[j]) = g((X[j]+C[j]) mod 2^32)
    const G = new Array(8);
    for (let i = 0; i < 8; i++) {
      G[i] = rabbitG((this.X[i] + this.C[i]) >>> 0);
    }

 // 3. 新 X（加法 + 旋转，照 RFC 4503 §2.6）
    this.X[0] = (G[0] + rotl32(G[7], 16) + rotl32(G[6], 16)) >>> 0;
    this.X[1] = (G[1] + rotl32(G[0], 8) + G[7]) >>> 0;
    this.X[2] = (G[2] + rotl32(G[1], 16) + rotl32(G[0], 16)) >>> 0;
    this.X[3] = (G[3] + rotl32(G[2], 8) + G[1]) >>> 0;
    this.X[4] = (G[4] + rotl32(G[3], 16) + rotl32(G[2], 16)) >>> 0;
    this.X[5] = (G[5] + rotl32(G[4], 8) + G[3]) >>> 0;
    this.X[6] = (G[6] + rotl32(G[5], 16) + rotl32(G[4], 16)) >>> 0;
    this.X[7] = (G[7] + rotl32(G[6], 8) + G[5]) >>> 0;
  }

 // 提取 16 字节 keystream block（照 RFC 4503 §2.7，16 位半字 XOR）
  extractBlock() {
    const x = this.X;
 // 8 个 16 位输出字（各为两个 X 半字的 XOR）
    const s0 = (x[0] & 0xFFFF) ^ ((x[5] >>> 16) & 0xFFFF);          // S[15..0]
    const s1 = ((x[0] >>> 16) & 0xFFFF) ^ (x[3] & 0xFFFF);          // S[31..16]
    const s2 = (x[2] & 0xFFFF) ^ ((x[7] >>> 16) & 0xFFFF);          // S[47..32]
    const s3 = ((x[2] >>> 16) & 0xFFFF) ^ (x[5] & 0xFFFF);          // S[63..48]
    const s4 = (x[4] & 0xFFFF) ^ ((x[1] >>> 16) & 0xFFFF);          // S[79..64]
    const s5 = ((x[4] >>> 16) & 0xFFFF) ^ (x[7] & 0xFFFF);          // S[95..80]
    const s6 = (x[6] & 0xFFFF) ^ ((x[3] >>> 16) & 0xFFFF);          // S[111..96]
    const s7 = ((x[6] >>> 16) & 0xFFFF) ^ (x[1] & 0xFFFF);          // S[127..112]
 // 写 16 字节：按 RFC 4503 §3 向量约定，先出 S[15..0] 且每字小端 —— 即 LE(s0)…LE(s7)。
 // 注意：往返测试查不出此处字节序错误（两个方向用同一密钥流，反序也能解回），
 // 必须拿 RFC 官方密钥流向量逐字节比对。
    const out = new Uint8Array(16);
    const words = [s0, s1, s2, s3, s4, s5, s6, s7];
    for (let i = 0; i < 8; i++) {
      const w = words[i];
      out[2 * i] = w & 0xff;
      out[2 * i + 1] = (w >>> 8) & 0xff;
    }
    return out;
  }

 // 生成 n 字节 keystream（每次提取前先 next-state）
  keystream(n) {
    const out = new Uint8Array(n);
    let off = 0;
    while (off < n) {
      this.nextState();
      const ks = this.extractBlock();
      const len = Math.min(16, n - off);
      for (let i = 0; i < len; i++) out[off + i] = ks[i];
      off += len;
    }
    return out;
  }
}

// ============================================================
// 2b. Rabbit 兼容层（0.1.10）——CryptoJS Legacy / CryptoJS 标准 / RFC 文档方向
// ============================================================
// 背景：Rabbit 的「字节串 ↔ 内部状态」存在两套等价约定。经与 crypto-js 4.2.0
// 逐字节对拍确认，同一核心状态机下，两套约定的换算为纯输入重排：
//   - CryptoJS Legacy（旧版在线工具默认）：key = 4 字节组序反转（组内不变）、
//     iv = 整串反转；crypto-js 官方 rabbit-legacy-test.js 全向量与本层实测逐字节一致。
//   - CryptoJS 标准：key = 整串反转、iv = 整串反转；
//     crypto-js 官方 rabbit-test.js（eSTREAM 向量）全向量与本层实测逐字节一致。
//   - RFC 4503 文档方向 = 本文件 0.1.9 及更早的原始行为（直接吃文档八位组串）；
//     内部状态数值与 RFC 附录 B 调试向量逐字一致。
// 口令模式复刻 CryptoJS OpenSSL 封装：EVP_BytesToKey(MD5, count=1) 派生 key/iv，
// 密文格式 base64("Salted__" + salt(8) + ct)（U2FsdGVkX1 开头）。
// 参考：crypto-js 4.2.0 test/rabbit-test.js、test/rabbit-legacy-test.js、RFC 4503 附录 A/B。

const RABBIT_VARIANTS = ["legacy", "standard", "rfc"];
const RABBIT_HEX32 = /^[0-9a-fA-F]{32}$/;

function revBytes(b) {
  return Uint8Array.from(b).reverse();
}
// 4 字节组序反转（组内字节不动；仅对 16 字节 key 有意义）
function wordrev4(b) {
  const a = Uint8Array.from(b);
  if (a.length !== 16) return a;
  return Uint8Array.from([...a.slice(12, 16), ...a.slice(8, 12), ...a.slice(4, 8), ...a.slice(0, 4)]);
}
function rabbitPermuteKey(keyBytes, variant) {
  if (variant === "legacy") return wordrev4(keyBytes);
  if (variant === "standard") return revBytes(keyBytes);
  return Uint8Array.from(keyBytes);
}
function rabbitPermuteIv(ivBytes, variant) {
  if (!ivBytes || ivBytes.length === 0) return ivBytes;
  return variant === "rfc" ? Uint8Array.from(ivBytes) : revBytes(ivBytes);
}
// 按变体预置换后走核心（变体换算的唯一入口；rabbitCrypt 即 rfc 档）。iv 空 = 无 IV 模式。
function rabbitCryptVariant(bytes, keyBytes, ivBytes, variant) {
  const cipher = new RabbitCipher();
  cipher.keySetup(rabbitPermuteKey(keyBytes, variant));
  const v2 = rabbitPermuteIv(ivBytes, variant);
  if (v2 && v2.length) cipher.ivSetup(v2);
  const ks = cipher.keystream(bytes.length);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ ks[i];
  return out;
}
function rabbitCrypt(bytes, key, iv) {
  return rabbitCryptVariant(bytes, key, iv, "rfc");
}

// ---- CryptoJS OpenSSL 全链（口令模式）----
// D1 = MD5(pass||salt)（16 字节 = key）；D2 = MD5(D1||pass||salt)（前 8 字节 = iv）
function rabbitKdf(passBytes, salt) {
  const cat1 = new Uint8Array(passBytes.length + salt.length);
  cat1.set(passBytes, 0);
  cat1.set(salt, passBytes.length);
  const d1 = md5Bytes(cat1);
  const cat2 = new Uint8Array(d1.length + passBytes.length + salt.length);
  cat2.set(d1, 0);
  cat2.set(passBytes, d1.length);
  cat2.set(salt, d1.length + passBytes.length);
  const d2 = md5Bytes(cat2);
  return { key: d1, iv: d2.subarray(0, 8) };
}
function rabbitB64Enc(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function rabbitB64Dec(str) {
  let s = String(str).replace(/\s+/g, "");
  const pad = (4 - (s.length % 4)) % 4;
  if (pad) s += "=".repeat(pad);
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// 识别 CryptoJS「Salted__」封装（base64）；非该格式返回 null
function rabbitTryParseSalted(text) {
  const s = String(text).replace(/\s+/g, "");
  if (!s) return null;
  let bytes;
  try { bytes = rabbitB64Dec(s); } catch { return null; }
  if (bytes.length < 16) return null;
  const H = [0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f]; // "Salted__"
  for (let i = 0; i < 8; i++) if (bytes[i] !== H[i]) return null;
  return { salt: bytes.subarray(8, 16), ct: bytes.subarray(16) };
}

// ---- 口令爆破（仅 CryptoJS 封装输入；空口令与内置常见口令始终参与）----
// 内置常见口令（CTF 与弱口令场景；用户候选由 crackList 参数追加）
const RABBIT_COMMON_PASSWORDS = [
  "123456", "12345678", "123456789", "1234567890", "12345", "1234", "111111", "000000",
  "123123", "654321", "666666", "888888", "5201314", "password", "passwd", "p@ssw0rd",
  "admin", "admin123", "admin888", "root", "root123", "toor", "guest", "test", "test123",
  "letmein", "qwerty", "abc123", "1q2w3e4r", "qazwsx", "iloveyou", "monkey", "dragon",
  "master", "hello", "hello123", "welcome", "sunshine", "princess", "football", "baseball",
  "secret", "default", "changeme", "crypto", "Crypto", "ctf", "CTF", "flag", "Flag",
  "FLAG", "rabbit", "Rabbit", "rabbit123", "ctf123", "flag123", "nice", "guess", "challenge", "key",
];
function rabbitParseCrackList(s) {
  return String(s || "").split(/[\r\n,，;；]+/).map((x) => x.trim()).filter(Boolean);
}
// 解出的字节 → 可读文本（严格 UTF-8 成功 + 可打印占比 ≥0.9；不合格返回 null）
function rabbitAsReadable(bytes) {
  let s;
  try { s = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return null; }
  if (!s.trim()) return null;
  return isPrintableRatio(s) >= 0.9 ? s : null;
}
function rabbitBuildCandidates(keyRaw, crackList) {
  const out = [];
  const seen = new Set();
  const push = (pass, kind) => {
    if (seen.has(pass)) return;
    seen.add(pass);
    out.push({ pass, kind });
  };
  if (keyRaw) push(keyRaw, "self"); // 用户显式口令
  push("", "empty"); // 空口令始终参与
  for (const b of RABBIT_COMMON_PASSWORDS) push(b, "builtin");
  for (const u of crackList) push(u, "user");
  return out;
}
// 口令模式加密：随机盐 + KDF + 变体加密 → base64("Salted__"+salt+ct)
function rabbitEncryptSalted(data, passBytes, variant) {
  const salt = randBytes(8);
  const { key, iv } = rabbitKdf(passBytes, salt);
  const ct = rabbitCryptVariant(data, key, iv, variant);
  const out = new Uint8Array(16 + ct.length);
  out.set([0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f], 0);
  out.set(salt, 8);
  out.set(ct, 16);
  return rabbitB64Enc(out);
}
// 口令模式解密：候选序 = 用户口令 → 空口令 → 内置 → 追加候选；每候选并试两变体，只列可读
function rabbitDecryptSalted(salted, keyRaw, crackListText) {
  const crackList = rabbitParseCrackList(crackListText);
  const listMode = crackList.length > 0; // 显式爆破模式：一律列表输出
  const candidates = rabbitBuildCandidates(keyRaw, crackList);
  const hits = [];
  for (const c of candidates) {
    const passBytes = strToBytes(c.pass);
    for (const v of ["legacy", "standard"]) {
      const { key, iv } = rabbitKdf(passBytes, salted.salt);
      const pt = rabbitAsReadable(rabbitCryptVariant(salted.ct, key, iv, v));
      if (pt === null) continue;
      // 自动命中直出：用户口令命中，或（用户未填口令且空口令命中）——issue 场景裸露明文
      if (!listMode && (c.kind === "self" || (c.kind === "empty" && !keyRaw))) return pt;
      hits.push({ pass: c.pass, kind: c.kind, variant: v, text: pt });
    }
  }
  if (hits.length) {
    return hits
      .map((h) => {
        const label = h.kind === "empty" ? "（空口令）" : `口令 "${h.pass}"`;
        const vn = h.variant === "legacy" ? "Legacy" : "标准";
        return `${label}（${vn}）→ ${h.text}`;
      })
      .join("\n");
  }
  return `未命中：已尝试 ${candidates.length} 个口令 × 2 种变体，均未得到可读文本；可补充爆破候选口令，或检查密文完整性。`;
}

function rabbitEncode(text, p) {
  const variant = RABBIT_VARIANTS.includes(p && p.variant) ? p.variant : "legacy";
  const keyRaw = String((p && p.key) || "").trim();
  const ivRaw = String((p && p.iv) || "").trim();
  const data = strToBytes(text);

  if (RABBIT_HEX32.test(keyRaw)) {
    // 密钥模式：32 位 hex key（+ 可选 16 位 hex IV；IV 留空 = 无 IV 模式）
    const key = hexToBytes(keyRaw);
    let iv = null;
    if (ivRaw) {
      iv = hexToBytes(ivRaw);
      if (iv.length !== 8) throw new Error("Rabbit IV 须 8 字节（16 hex），实为 " + iv.length + " 字节");
    }
    return bytesToHex(rabbitCryptVariant(data, key, iv, variant));
  }
  // 口令模式：复刻 CryptoJS OpenSSL 封装（随机盐；每次密文不同）。
  // 空 key = 空口令加密（与 decode 端空口令自动尝试对称，对齐 CryptoJS 行为）。
  if (ivRaw) throw new Error("口令模式不使用 IV 参数（密文自含随机盐）；如需手填 IV，请使用 32 位 hex 密钥");
  if (variant === "rfc") throw new Error("口令模式仅支持 CryptoJS Legacy / 标准两种变体");
  return rabbitEncryptSalted(data, strToBytes(keyRaw), variant);
}

function rabbitDecode(text, p) {
  const variant = RABBIT_VARIANTS.includes(p && p.variant) ? p.variant : "legacy";
  const keyRaw = String((p && p.key) || "").trim();
  const ivRaw = String((p && p.iv) || "").trim();
  const raw = String(text).trim();
  const rawNoWs = raw.replace(/\s+/g, "");

  // ① CryptoJS 封装（base64「Salted__」）→ 口令全链（两变体并试 + 候选爆破）
  const salted = rabbitTryParseSalted(raw);
  if (salted) return rabbitDecryptSalted(salted, keyRaw, (p && p.crackList) || "");

  // ② 原始 hex 密文（密钥模式）
  if (rawNoWs && /^[0-9a-fA-F]+$/.test(rawNoWs) && rawNoWs.length % 2 === 0) {
    if (!RABBIT_HEX32.test(keyRaw)) {
      throw new Error("原始模式须填 32 位 hex 密钥；口令模式请粘贴 CryptoJS 密文（U2FsdGVkX1 开头）");
    }
    const key = hexToBytes(keyRaw);
    let iv = null;
    if (ivRaw) {
      iv = hexToBytes(ivRaw);
      if (iv.length !== 8) throw new Error("Rabbit IV 须 8 字节（16 hex），实为 " + iv.length + " 字节");
    }
    return bytesToStr(rabbitCryptVariant(hexToBytes(rawNoWs), key, iv, variant));
  }

  // ③ 识别失败
  if (/^U2FsdGVkX1/.test(rawNoWs)) {
    throw new Error("CryptoJS 密文解析失败（base64 损坏或被截断）");
  }
  throw new Error("无法识别输入：须为 hex 密文，或 CryptoJS base64 密文（U2FsdGVkX1 开头）");
}

// ============================================================
// 注册 op
// ============================================================
// 注意：chacha20 op 不在此注册——modernExt.js 已有完整 chacha20 op（id:"chacha20"）
// 重复注册会被 registry 拦截。本文件仅保留 ChaCha20 实现（供测试 + 未来 M 归并引用）
// 只注册 rabbit op（modernExt.js 无此 op）。
register({
  id: "rabbit",
  cat: "stream",
  name: "Rabbit 流密码",
  desc: "RFC 4503 Rabbit 流密码。变体三档：CryptoJS Legacy（旧版在线工具默认，推荐）/ CryptoJS 标准 / RFC 4503 文档方向（0.1.9 及更早行为）。密钥填 32 位 hex 直用（IV 可选）；填口令或留空则按 CryptoJS OpenSSL 封装（Salted base64）加解密。decode 对 CryptoJS 密文（U2FsdGVkX1 开头）自动带空口令与常见口令尝试。",
  params: [
    { key: "variant", label: "算法变体", type: "select", default: "legacy",
      options: [
        { value: "legacy", label: "CryptoJS Legacy（旧版在线工具，推荐）" },
        { value: "standard", label: "CryptoJS 标准" },
        { value: "rfc", label: "RFC 4503 文档方向（0.1.9 及更早）" },
      ] },
    { key: "key", label: "密钥 / 口令", type: "text", default: "", placeholder: "32 位 hex 密钥；其他内容按口令（CryptoJS 封装）处理" },
    { key: "iv", label: "IV（hex，8 字节，可留空）", type: "text", default: "", placeholder: "仅密钥模式使用；留空 = 无 IV" },
    { key: "crackList", label: "口令爆破候选（可选）", type: "textarea", default: "", rows: 3,
      placeholder: "每行一条（或逗号分隔）。输入为 CryptoJS 密文且未直接命中时，连同内置常见口令逐条尝试，只列出可读结果" },
  ],
  encode: rabbitEncode,
  decode: rabbitDecode,
});

// ============================================================
// 导出（供测试 + M 归并引用）
// ============================================================
export {
  strToBytes, bytesToStr, bytesToHex, hexToBytes, rotl32, le32,
  chachaQR, chachaBlock, chacha20Crypt, chacha20CheckParams, chacha20Encode, chacha20Decode,
  rabbitG, RabbitCipher, rabbitCrypt,
  // 0.1.10 兼容层（供测试 / 一键尝试 / 后续复用）
  rabbitEncode, rabbitDecode, rabbitCryptVariant, rabbitKdf,
};
