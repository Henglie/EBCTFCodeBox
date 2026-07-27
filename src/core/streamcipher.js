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
 * - 往返测试 + RFC 测试向量必过。
 * - 零外发：纯本地计算。
 *
 * 参考：
 * - RFC 8439 "ChaCha20 and Poly1305 for IETF Protocols"（2018）
 * - RFC 4503 "The Rabbit Stream Cipher Algorithm Specification"（2006）
 *
 * 契约：register({id, cat:"modern", name, desc, params, encode, decode})。
 * encode(text, p): text → UTF-8 bytes → XOR keystream → hex 大写
 * decode(hex, p): hex → bytes → XOR keystream → UTF-8 文本
 * 流密码对称：decode(encode(x, p), p) === x
 */
import { register } from "./registry.js";

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
 // 写 16 字节：S[127..0] big-endian（最高字节在前，照 RFC 4503 §A 测试向量 I2OSP 约定）
 // words[0]=S[15..0]（最低），words[7]=S[127..112]（最高）→ 反向输出 + 每字 big-endian
    const out = new Uint8Array(16);
    const words = [s0, s1, s2, s3, s4, s5, s6, s7];
    for (let i = 0; i < 8; i++) {
      const w = words[7 - i];
      out[2 * i] = (w >>> 8) & 0xff;
      out[2 * i + 1] = w & 0xff;
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

function rabbitCheckParams(p) {
  const key = hexToBytes((p && p.key) || "");
  const iv = hexToBytes((p && p.iv) || "");
  if (key.length !== 16) throw new Error("Rabbit key 须 16 字节（32 hex），实为 " + key.length);
  if (iv.length !== 8) throw new Error("Rabbit IV 须 8 字节（16 hex），实为 " + iv.length);
  return { key, iv };
}

function rabbitCrypt(bytes, key, iv) {
  const cipher = new RabbitCipher();
  cipher.keySetup(key);
  cipher.ivSetup(iv);
  const ks = cipher.keystream(bytes.length);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ ks[i];
  return out;
}

function rabbitEncode(text, p) {
  const { key, iv } = rabbitCheckParams(p);
  return bytesToHex(rabbitCrypt(strToBytes(text), key, iv));
}

function rabbitDecode(hex, p) {
  const { key, iv } = rabbitCheckParams(p);
  return bytesToStr(rabbitCrypt(hexToBytes(hex), key, iv));
}

// ============================================================
// 注册 op
// ============================================================
// 注意：chacha20 op 不在此注册——modernExt.js 已有完整 chacha20 op（id:"chacha20"）
// 重复注册会被 registry 拦截。本文件仅保留 ChaCha20 实现（供测试 + 未来 M 归并引用）
// 只注册 rabbit op（modernExt.js 无此 op）。
register({
  id: "rabbit",
  cat: "modern",
  name: "Rabbit 流密码",
  desc: "RFC 4503 Rabbit 流密码（128-bit key + 64-bit IV）。encode: 文本→Hex 密文；decode: Hex→文本。对称可逆。RFC4503 §3 测试向量（全 0 key/IV）已验证。",
  params: [
    { key: "key", label: "key (hex, 16 字节 / 32 位)", type: "text", default: "", placeholder: "如 00000000000000000000000000000000" },
    { key: "iv", label: "IV (hex, 8 字节 / 16 位)", type: "text", default: "", placeholder: "如 0000000000000000" },
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
};
