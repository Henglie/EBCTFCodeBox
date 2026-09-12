/*
 * ascon.js — Ascon-AEAD128 认证加密 + Ascon-Hash256 哈希（NIST SP 800-232，2025-08）。
 *
 * 照 SP 800-232 原文逐节实现（注释内节号/式号/算法号均指该标准）：
 *   - Ascon-p[rnd] 置换：§3（p = pL ∘ pS ∕ pC，式(1)），
 *     轮常数 §3.2 式(3)(4) + Table 5（第 i 轮用 const[16-rnd+i] 异或进 S2），
 *     S 盒 §3.3 式(7) 布尔式按 64 路 bit-slice 作用整字（输出对照 Table 6 验证），
 *     线性层 §3.4 式(8)-(12)（Σi：右旋 19/28、61/39、1/6、10/17、7/41）。
 *   - 字节/位序：§2 要点 6 —— 相对 Ascon v1.2「已从大端切换为小端」；
 *     附录 A.1：字节串首字节 = 字的最低有效字节（LE 装载），位串首位 = 最低位，
 *     S[0] 是 S0 的最低位、S[319] 是 S4 的最高位；
 *     附录 A.2 填充式 y ← x ⊕ (0x01 ≪ 8n)：块内 n 字节后填 1 个 1 位再补零
 *     （位级：末块 ℓ bit 后在块内位 ℓ 置 1）。
 *   - Ascon-AEAD128（§4.1）：rate=128bit、capacity=192bit；初始化/终结 p[12]、
 *     数据通路 p[8]（Alg 3 加密 / Alg 4 解密）；IV = 0x00001000808c0001（式(15)/(33)，
 *     推导见附录 B）；关联数据与明文按 §2.1 Alg 1 parse + Alg 2 pad 分块；
 *     域分离 S ← S⊕(0^319‖1)（式(22)/(40)，即 S4 最高位翻转）；
 *     终结 S ← p[12](S⊕(0^128‖K‖0^64))，T = S[192:319]⊕K（式(30)-(32)）；
 *     tag 截断 §4.2.1（取 T[0:λ-1]，LSB 侧先出）。
 *     核心函数支持比特级输入长度（opts 位长可省略=按字节），op UI 层按字节粒度。
 *   - Ascon-Hash256（§5.1 Alg 5）：rate=64bit，全程 p[12]，
 *     IV = 0x0000080100cc0002（式(54)），挤出 4×64bit=32 字节摘要。
 *
 * 注意：SP 800-232 的 Ascon-AEAD128 是 128bit rate / 数据 8 轮（老 Ascon-128a
 * 同构），不是老 Ascon-128 的 64bit rate / 6 轮；IV、字节序、域分离位、填充位
 * 均与 v1.2 不同，结果与 v1.2 不通用。验证三方对照：NIST 官方 LWC KAT
 * （Key=000102..0F 全量）+ NIST ACVP 官方向量（含比特级长度与 nonce-masking 组）
 * + ascon 官方 python 参考实现置换核心（模式层按标准 LE 约定重写）。
 *
 * 红线：core 层零 UI 依赖；纯本地零外发；无 emoji。
 * 契约：register({ id, cat, name, desc, params, run })，件内自注册。
 */
import { register } from "./registry.js";

// ============ 基础工具 ============

const M64 = (1n << 64n) - 1n;

function rotr(x, n) {
  return ((x >> n) | (x << (64n - n))) & M64;
}

function bytesToHex(b) {
  return Array.from(b, (c) => c.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(h) {
  const s = String(h || "").replace(/\s+/g, "");
  if (s === "") return new Uint8Array(0);
  if (!/^[0-9a-fA-F]+$/.test(s) || s.length % 2 !== 0) {
    throw new Error(`hex 输入不合法：${s.slice(0, 40)}${s.length > 40 ? "…" : ""}`);
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 8 字节 → 64 位字（附录 A.1：首字节为最低有效字节，LE 装载；越界按 0）。 */
function word8(b, off) {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[off + i] ?? 0);
  return v;
}

/** 64 位字 → 8 字节（LE 写出，A.1 反向）。 */
function wordToBytes(v) {
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * 从字节流的 bitOff 位起读 64 位（LE 位序：流位 j = 字节 j>>3 的第 j&7 位，
 * 附录 A.1「位串首位为最低位」）。字节对齐时走快速路径。
 */
function bitsWord(bytes, bitOff) {
  if ((bitOff & 7) === 0) return word8(bytes, bitOff >> 3);
  let w = 0n;
  for (let j = 63; j >= 0; j--) {
    const gi = bitOff + j;
    w = (w << 1n) | BigInt(((bytes[gi >> 3] ?? 0) >> (gi & 7)) & 1);
  }
  return w;
}

/** 低 bits 位全 1 掩码（bits ≥ 64 → 全 1）。 */
function maskLow(bits) {
  return bits >= 64n ? M64 : ((1n << bits) - 1n);
}

/** 把 (S0,S1) 表示的 128 bit 块的低 bitLen 位按 LE 位序写进 out 字节。 */
function writeBits128(w0, w1, bitLen, out, byteOff) {
  const t0 = wordToBytes(w0), t1 = wordToBytes(w1);
  const full = Math.floor(bitLen / 8), rem = bitLen % 8;
  for (let i = 0; i < full; i++) out[byteOff + i] = i < 8 ? t0[i] : t1[i - 8];
  if (rem > 0) {
    const b = full < 8 ? t0[full] : t1[full - 8];
    out[byteOff + full] = b & ((1 << rem) - 1);
  }
}

// ============ Ascon-p 置换（SP 800-232 §3） ============

/** Table 5：const_0..15（§3.2）。 */
const ROUND_CONST = [
  0x3cn, 0x2dn, 0x1en, 0x0fn, 0xf0n, 0xe1n, 0xd2n, 0xc3n,
  0xb4n, 0xa5n, 0x96n, 0x87n, 0x78n, 0x69n, 0x5an, 0x4bn,
];

/**
 * Ascon-p[rnd]（§3，式(1)）：rnd 轮，每轮 pL ∘ pS ∘ pC。
 * S：BigInt[5]（S0..S4）。原地更新。
 * §3.2 式(3)：第 i 轮（0 ≤ i ≤ rnd-1）用 c_i = const[16-rnd+i]。
 */
function permutation(S, rnd) {
  for (let i = 0; i < rnd; i++) {
    // §3.2 式(4)：常数加进 S2
    S[2] ^= ROUND_CONST[16 - rnd + i];

    // §3.3 式(7)：5-bit SBOX × 64 路 bit-slice（y2 的"⊕1"即整字异或全 1）
    const x0 = S[0], x1 = S[1], x2 = S[2], x3 = S[3], x4 = S[4];
    S[0] = ((x4 & x1) ^ x3 ^ (x2 & x1) ^ x2 ^ (x1 & x0) ^ x1 ^ x0) & M64;
    S[1] = (x4 ^ (x3 & x2) ^ (x3 & x1) ^ x3 ^ (x2 & x1) ^ x2 ^ x1 ^ x0) & M64;
    S[2] = ((x4 & x3) ^ x4 ^ x2 ^ x1 ^ M64) & M64;
    S[3] = ((x4 & x0) ^ x4 ^ (x3 & x0) ^ x3 ^ x2 ^ x1 ^ x0) & M64;
    S[4] = ((x4 & x1) ^ x4 ^ x3 ^ (x1 & x0) ^ x1) & M64;

    // §3.4 式(8)-(12)：线性扩散层 Σi
    S[0] ^= rotr(S[0], 19n) ^ rotr(S[0], 28n);
    S[1] ^= rotr(S[1], 61n) ^ rotr(S[1], 39n);
    S[2] ^= rotr(S[2], 1n) ^ rotr(S[2], 6n);
    S[3] ^= rotr(S[3], 10n) ^ rotr(S[3], 17n);
    S[4] ^= rotr(S[4], 7n) ^ rotr(S[4], 41n);
    S[0] &= M64; S[1] &= M64; S[2] &= M64; S[3] &= M64; S[4] &= M64;
  }
}

// ============ Ascon-AEAD128（§4.1，Alg 3 / Alg 4） ============

/** §4.1.1 式(15)：Ascon-AEAD128 初始值。 */
const IV_AEAD128 = 0x00001000808c0001n;

/** Alg 3/4 第 1-2 步 + 关联数据处理 + 域分离（§4.1.1 式(15)-(22)）。 */
function aeadInit(key, nonce, aad, adBitLen) {
  const k0 = word8(key, 0), k1 = word8(key, 8);
  // 初始化：S ← IV ‖ K ‖ N（LE 装载），再 p[12]，再 S ← S ⊕ (0^192 ‖ K)
  const S = [IV_AEAD128, k0, k1, word8(nonce, 0), word8(nonce, 8)];
  permutation(S, 12);
  S[3] ^= k0;
  S[4] ^= k1;

  // 关联数据：parse(A,128) + pad 末块，逐块吸收 + p[8]（式(18)-(21)，末块含 pad 也置换）
  if (adBitLen > 0) {
    const nFull = Math.floor(adBitLen / 128);
    for (let b = 0; b < nFull; b++) {
      S[0] ^= bitsWord(aad, b * 128);
      S[1] ^= bitsWord(aad, b * 128 + 64);
      permutation(S, 8);
    }
    const l = adBitLen % 128;
    const off = nFull * 128;
    const lB = BigInt(l);
    // 末块：吸收低 ℓ 位 + 在块内位 ℓ 置 pad 1（Alg 2 + A.2 填充式）
    if (l >= 64) {
      S[0] ^= bitsWord(aad, off);
      S[1] ^= bitsWord(aad, off + 64) & maskLow(lB - 64n);
      S[1] ^= 1n << (lB - 64n);
    } else {
      S[0] ^= bitsWord(aad, off) & maskLow(lB);
      S[0] ^= 1n << lB;
    }
    permutation(S, 8);
  }
  // 域分离：S ← S ⊕ (0^319 ‖ 1)（式(22)）。S[319] 是 S4 最高位（A.1）。
  S[4] ^= 0x8000000000000000n;
  return { S, k0, k1 };
}

/**
 * Ascon-AEAD128.enc（Alg 3）：返回 { ciphertext, tag(16B) }。
 * key/nonce 各 16 字节；opts = { adBitLen, ptBitLen }（默认按字节长度）。
 * 密文/tag 按 A.1 LE 写出，密文长 = ⌈ptBitLen/8⌉ 字节（末字节高位清零）。
 */
export function asconAead128Encrypt(key, nonce, aad, plaintext, opts = {}) {
  if (key.length !== 16) throw new Error(`Ascon-AEAD128 key 必须为 16 字节（128 位），当前 ${key.length} 字节`);
  if (nonce.length !== 16) throw new Error(`Ascon-AEAD128 nonce 必须为 16 字节（128 位），当前 ${nonce.length} 字节`);
  const adBitLen = opts.adBitLen ?? aad.length * 8;
  const ptBitLen = opts.ptBitLen ?? plaintext.length * 8;
  if (adBitLen > aad.length * 8 || ptBitLen > plaintext.length * 8) {
    throw new Error("位长参数不能超过输入字节的位数");
  }
  const { S, k0, k1 } = aeadInit(key, nonce, aad, adBitLen);

  // 明文全块：XOR→取密文→p[8]（式(24)-(26)）；末块吸收 pad 后截取 ℓ 位，不再置换（式(27)-(29)）
  const nFull = Math.floor(ptBitLen / 128);
  const l = ptBitLen % 128;
  const ct = new Uint8Array(Math.ceil(ptBitLen / 8));
  for (let b = 0; b < nFull; b++) {
    S[0] ^= bitsWord(plaintext, b * 128);
    S[1] ^= bitsWord(plaintext, b * 128 + 64);
    writeBits128(S[0], S[1], 128, ct, b * 16);
    permutation(S, 8);
  }
  const off = nFull * 128;
  const lB = BigInt(l);
  if (l >= 64) {
    S[0] ^= bitsWord(plaintext, off);
    S[1] ^= (bitsWord(plaintext, off + 64) & maskLow(lB - 64n));
    S[1] ^= 1n << (lB - 64n);
  } else {
    S[0] ^= bitsWord(plaintext, off) & maskLow(lB);
    S[0] ^= 1n << lB;
  }
  if (l > 0) writeBits128(S[0], S[1], l, ct, nFull * 16);

  // 终结：S ← p[12](S ⊕ (0^128 ‖ K ‖ 0^64))，T ← S[192:319] ⊕ K（式(30)-(32)）
  S[2] ^= k0;
  S[3] ^= k1;
  permutation(S, 12);
  const tag = new Uint8Array(16);
  tag.set(wordToBytes(S[3] ^ k0), 0);
  tag.set(wordToBytes(S[4] ^ k1), 8);
  return { ciphertext: ct, tag };
}

/**
 * Ascon-AEAD128.dec（Alg 4）：tag 不符抛错（校验失败明示）。返回明文。
 * opts = { adBitLen, ctBitLen, tagBitLen }（默认按字节长度）。
 * tagBitLen ≤ 128 时按 §4.2.1 只比对左侧 λ 位（末字节高位清零后比对）。
 */
export function asconAead128Decrypt(key, nonce, aad, ciphertext, tag, opts = {}) {
  if (key.length !== 16) throw new Error(`Ascon-AEAD128 key 必须为 16 字节（128 位），当前 ${key.length} 字节`);
  if (nonce.length !== 16) throw new Error(`Ascon-AEAD128 nonce 必须为 16 字节（128 位），当前 ${nonce.length} 字节`);
  if (tag.length < 4 || tag.length > 16) {
    throw new Error(`tag 长度须 4..16 字节（§4.2.1 截断下限 32bit），当前 ${tag.length} 字节`);
  }
  const adBitLen = opts.adBitLen ?? aad.length * 8;
  const ctBitLen = opts.ctBitLen ?? ciphertext.length * 8;
  if (adBitLen > aad.length * 8 || ctBitLen > ciphertext.length * 8) {
    throw new Error("位长参数不能超过输入字节的位数");
  }
  const { S, k0, k1 } = aeadInit(key, nonce, aad, adBitLen);

  // 密文全块：P_i = S[0:127]⊕C_i，S[0:127] ← C_i，p[8]（式(41)-(44)）
  const nFull = Math.floor(ctBitLen / 128);
  const l = ctBitLen % 128;
  const pt = new Uint8Array(Math.ceil(ctBitLen / 8));
  for (let b = 0; b < nFull; b++) {
    const c0 = bitsWord(ciphertext, b * 128), c1 = bitsWord(ciphertext, b * 128 + 64);
    writeBits128(S[0] ^ c0, S[1] ^ c1, 128, pt, b * 16);
    S[0] = c0;
    S[1] = c1;
    permutation(S, 8);
  }
  // 末块 ℓ bit（式(45)-(47)）：P̃ = S⊕C̃ 取低 ℓ 位；S[0:ℓ-1] ← C̃；
  // S[ℓ:127] ⊕= (1‖0^(127-ℓ))，即块内位 ℓ 置 1（A.2 填充式，LE 位序）。
  const off = nFull * 128;
  const lB = BigInt(l);
  let c0 = 0n, c1 = 0n;
  if (l >= 64) {
    c0 = bitsWord(ciphertext, off);
    c1 = bitsWord(ciphertext, off + 64) & maskLow(lB - 64n);
  } else if (l > 0) {
    c0 = bitsWord(ciphertext, off) & maskLow(lB);
  }
  if (l > 0) writeBits128(S[0] ^ c0, S[1] ^ c1, l, pt, nFull * 16);
  // 低 ℓ 位换成密文位，其余保留，再在位 ℓ 置 1
  if (l >= 64) {
    S[0] = c0;
    S[1] = (S[1] & ~maskLow(lB - 64n) & M64) | c1;
    S[1] ^= 1n << (lB - 64n);
  } else {
    S[0] = (S[0] & ~maskLow(lB) & M64) | c0;
    S[0] ^= 1n << lB;
  }

  // 终结与 tag 校验（式(49)-(51)）
  S[2] ^= k0;
  S[3] ^= k1;
  permutation(S, 12);
  const tagCalc = new Uint8Array(16);
  tagCalc.set(wordToBytes(S[3] ^ k0), 0);
  tagCalc.set(wordToBytes(S[4] ^ k1), 8);
  const tagBitLen = opts.tagBitLen ?? tag.length * 8;
  const nB = Math.ceil(tagBitLen / 8);
  if (tag.length !== nB) {
    throw new Error(`tag 字节数（${tag.length}）与 tagBitLen（${tagBitLen} 位 → ${nB} 字节）不一致`);
  }
  const lastMask = tagBitLen % 8 ? (1 << (tagBitLen % 8)) - 1 : 0xff;
  for (let i = 0; i < nB; i++) {
    const a = i === nB - 1 ? (tagCalc[i] & lastMask) : tagCalc[i];
    if (a !== tag[i]) {
      throw new Error("Ascon-AEAD128 解密失败：tag 校验不符（密文、tag、key、nonce 或 aad 有误，或被篡改）");
    }
  }
  return pt;
}

// ============ Ascon-Hash256（§5.1，Alg 5） ============

/** §5.1 式(54)：Ascon-Hash256 初始值。 */
const IV_HASH256 = 0x0000080100cc0002n;

/** Ascon-Hash256（Alg 5）：任意长消息 → 32 字节摘要（A.1 LE 写出）。bitLen 默认按字节。 */
export function asconHash256(message, bitLen) {
  const n = bitLen ?? message.length * 8;
  if (n > message.length * 8) throw new Error("位长参数不能超过输入字节的位数");
  // 初始化：S ← p[12](IV ‖ 0^256)
  const S = [IV_HASH256, 0n, 0n, 0n, 0n];
  permutation(S, 12);

  // 吸收：全块 XOR 进 S0 + p[12]；末块吸收低 ℓ 位 + 位 ℓ 置 1 后 p[12]（式(55)-(58)）
  const nFull = Math.floor(n / 64);
  for (let b = 0; b < nFull; b++) {
    S[0] ^= bitsWord(message, b * 64);
    permutation(S, 12);
  }
  const l = n % 64;
  const lB = BigInt(l);
  S[0] ^= bitsWord(message, nFull * 64) & maskLow(lB);
  S[0] ^= 1n << lB;
  permutation(S, 12);

  // 挤出：H0..H3，取 S0 后置换，末块不再置换（式(59)-(63)）
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) {
    out.set(wordToBytes(S[0]), i * 8);
    if (i < 3) permutation(S, 12);
  }
  return out;
}

// ============ run 层（UI 驱动） ============

function randomBytes16() {
  const b = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(b);
  } else {
    for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  }
  return b;
}

function asconRun(text, p) {
  const mode = (p && p.mode) || "encrypt";
  const key = hexToBytes((p && p.key) || "");
  const aadMode = (p && p.aadMode) || "text";
  const aad = p && p.aad ? (aadMode === "hex" ? hexToBytes(p.aad) : new TextEncoder().encode(p.aad)) : new Uint8Array(0);
  let tagLen = parseInt((p && p.tagLen) || "16", 10);
  if (!Number.isFinite(tagLen)) tagLen = 16;
  if (tagLen < 4 || tagLen > 16) throw new Error("tag 长度须 4..16 字节（§4.2.1：截断下限 32bit）");

  const lines = [];
  lines.push("=== Ascon-AEAD128（NIST SP 800-232 §4.1）===");

  if (mode === "encrypt") {
    let nonce = p && p.nonce ? hexToBytes(p.nonce) : new Uint8Array(0);
    let nonceRand = false;
    if (nonce.length === 0) {
      nonce = randomBytes16();
      nonceRand = true;
    }
    const inputMode = (p && p.inputMode) || "text";
    const pt = inputMode === "hex" ? hexToBytes(text) : new TextEncoder().encode(text);
    const { ciphertext, tag } = asconAead128Encrypt(key, nonce, aad, pt);
    const tagCut = tag.slice(0, tagLen);
    lines.push(`模式: 加密（明文 ${pt.length} 字节，aad ${aad.length} 字节）`);
    lines.push(`key:   ${bytesToHex(key)}`);
    lines.push(`nonce: ${bytesToHex(nonce)}${nonceRand ? "（留空已随机生成，请自行保存）" : ""}`);
    lines.push(`tag:   ${bytesToHex(tagCut)}（${tagLen} 字节${tagLen < 16 ? "，已按 §4.2.1 截断" : ""}）`);
    lines.push("");
    lines.push(`密文(hex):        ${bytesToHex(ciphertext)}`);
    lines.push(`tag(hex):         ${bytesToHex(tagCut)}`);
    lines.push(`完整密文+tag(hex): ${bytesToHex(ciphertext)}${bytesToHex(tag)}`);
    return lines.join("\n");
  }

  // 解密：输入 = 密文+tag（hex），tag 取末 tagLen 字节
  const all = hexToBytes(text);
  if (all.length < tagLen) throw new Error(`输入 hex 至少应含密文+${tagLen} 字节 tag，当前仅 ${all.length} 字节`);
  const nonce = p && p.nonce ? hexToBytes(p.nonce) : new Uint8Array(0);
  if (nonce.length === 0) throw new Error("解密必须提供 nonce（16 字节 hex）");
  const ct = all.subarray(0, all.length - tagLen);
  const tag = all.subarray(all.length - tagLen);
  const pt = asconAead128Decrypt(key, nonce, aad, ct, tag);
  lines.push(`模式: 解密（密文 ${ct.length} 字节，aad ${aad.length} 字节）`);
  lines.push(`key:   ${bytesToHex(key)}`);
  lines.push(`nonce: ${bytesToHex(nonce)}`);
  lines.push("tag 校验: 通过");
  lines.push("");
  lines.push(`明文(hex):  ${bytesToHex(pt)}`);
  lines.push("明文(text): " + new TextDecoder("utf-8", { fatal: false }).decode(pt));
  return lines.join("\n");
}

function asconHashRun(text, p) {
  const inputMode = (p && p.inputMode) || "text";
  const msg = inputMode === "hex" ? hexToBytes(text) : new TextEncoder().encode(text);
  const digest = asconHash256(msg);
  let b64 = "";
  try {
    b64 = btoa(String.fromCharCode(...digest));
  } catch {
    b64 = "(当前环境无 btoa)";
  }
  const lines = [];
  lines.push("=== Ascon-Hash256（NIST SP 800-232 §5.1）===");
  lines.push(`输入: ${msg.length} 字节（${inputMode}）`);
  lines.push("");
  lines.push(`hex:    ${bytesToHex(digest)}`);
  lines.push(`base64: ${b64}`);
  return lines.join("\n");
}

// ============ 注册（件内自注册，不碰主入口） ============

register({
  id: "ascon",
  cat: "modern",
  name: "Ascon-AEAD128",
  desc: "NIST SP 800-232 轻量级认证加密（2025 标准版）：rate 128bit、初始化/终结 p[12]、数据块 p[8]、IV 0x00001000808c0001、小端字节序（与 v1.2 互不通用）。key/nonce 各 16 字节 hex，nonce 留空加密时随机；解密校验 tag 不符即报错。NIST LWC KAT + ACVP 官方向量验证。",
  params: [
    {
      key: "mode", label: "模式", type: "select", default: "encrypt",
      options: [
        { value: "encrypt", label: "加密" },
        { value: "decrypt", label: "解密" },
      ],
    },
    { key: "key", label: "key（16B hex）", type: "text", default: "", placeholder: "000102030405060708090a0b0c0d0e0f" },
    { key: "nonce", label: "nonce（16B hex）", type: "text", default: "", placeholder: "留空则加密时随机生成；解密必填" },
    {
      key: "aadMode", label: "aad 形式", type: "select", default: "text",
      options: [
        { value: "text", label: "UTF-8 文本" },
        { value: "hex", label: "Hex 字节" },
      ],
    },
    { key: "aad", label: "关联数据 aad（可空）", type: "text", default: "", placeholder: "可空" },
    {
      key: "inputMode", label: "加密输入形式", type: "select", default: "text",
      options: [
        { value: "text", label: "UTF-8 文本" },
        { value: "hex", label: "Hex 字节" },
      ],
    },
    { key: "tagLen", label: "tag 字节数", type: "number", default: 16, placeholder: "4..16，默认 16（§4.2.1 截断）" },
  ],
  run: asconRun,
});

register({
  id: "asconHash",
  cat: "hash",
  name: "Ascon-Hash256",
  desc: "NIST SP 800-232 轻量级哈希：sponge 结构、rate 64bit、全程 p[12] 轮置换、IV 0x0000080100cc0002、小端字节序，输出 32 字节摘要。注意与老 Ascon-Hash(v1.2) 的 IV/字节序/填充均不同，结果不通用。NIST LWC KAT + ACVP 官方向量验证。",
  params: [
    {
      key: "inputMode", label: "输入形式", type: "select", default: "text",
      options: [
        { value: "text", label: "UTF-8 文本" },
        { value: "hex", label: "Hex 字节" },
      ],
    },
  ],
  run: asconHashRun,
});

export { permutation as asconPermutation, hexToBytes, bytesToHex };
