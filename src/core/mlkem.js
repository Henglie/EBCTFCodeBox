/*
 * mlkem.js — ML-KEM（Module-Lattice-Based KEM）keyGen / encaps / decaps
 *
 * 标准：FIPS 203（final，2024-08-13）。算法号引用：
 *   13 = K_PKE.KeyGen   14 = K_PKE.Encrypt   15 = K_PKE.Decrypt
 *   16 = ML-KEM.KeyGen_internal   17 = ML-KEM.Encaps_internal
 *   18 = ML-KEM.Decaps_internal   19 = ML-KEM.KeyGen
 *   20 = ML-KEM.Encaps   21 = ML-KEM.Decaps
 * 原语（FIPS 203 §4）：ByteEncode/ByteDecode/Compress/Decompress（§4.2.1）、
 *   NTT/NTT^-1/MultiplyNTTs（§4.3）、SampleNTT/SamplePolyCBD（§4.3.2）。
 * 哈希（FIPS 202）：H=SHA3-256、G=SHA3-512、J/PRF=SHAKE-256、XOF=SHAKE-128（FIPS 203 §4.4–4.5）。
 *
 * 与 Kyber round-3 的定稿差异（刻意不兼容，本文件按定稿）：
 *   1) K-PKE.KeyGen 用 (rho, sigma) = G(d || byte(k))——参数集域分隔；z 只作隐式拒绝种子；
 *   2) SamplePolyCBD 按定稿「低 eta 位 popcount − 高 eta 位 popcount」（块内对半，非 round-3 C 的奇偶交错位）。
 *
 * Keccak 海绵：复用 hash.js 的 keccakF1600 置换（cmac.js 先例），sponge 本文件自实现
 * （需要字节串输入 + 变长输出，hash.js 导出的 shake 只吃 text）。
 *
 * 验证：NIST ACVP v1.1.0.35 官方向量 keyGen 3×25、encaps 3×25、decaps 3×10 全过
 * （含隐式拒绝组）；kyber-py 1.2.0 独立权威实现逐字节对拍一致。
 */

import { register } from "./registry.js";
import { keccakF1600 } from "./hash.js";

// ============================================================
// 字节工具
// ============================================================

function hexToBytes(hex) {
  let h = String(hex == null ? "" : hex).replace(/^0x/i, "").replace(/\s+/g, "");
  if (!h) return new Uint8Array(0);
  if (h.length % 2) h = "0" + h;
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error(`含非 hex 字符: ${hex}`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function concatBytes(...arrs) {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** CSPRNG。密钥种子禁弱随机源：无 crypto.getRandomValues 直接报错，不降级。 */
function randomBytes(n) {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    const b = new Uint8Array(n);
    c.getRandomValues(b);
    return b;
  }
  throw new Error("无可用 CSPRNG（crypto.getRandomValues），无法生成随机种子");
}

/** 种子参数解析：空 → 随机 32B；非空 → 严格 32B hex。 */
function seedBytes(v, name) {
  if (v == null || String(v).trim() === "") return randomBytes(32);
  const b = hexToBytes(v);
  if (b.length !== 32) throw new Error(`${name} 须为 32 字节 hex（当前 ${b.length} 字节）`);
  return b;
}

// ============================================================
// Keccak 海绵（FIPS 202 §5/§6.2；复用 hash.js keccakF1600，cmac.js 先例）
// ============================================================

/**
 * rate 字节海绵。padByte：SHA3=0x06、SHAKE=0x1f（域分隔 + pad10*1）。
 * 与 hash.js 内部 keccak() 同构：sLo/sHi 双 32 位模拟 64 位 × 25 lane。
 */
function sponge(rate, padByte, msg, outLen) {
  const sLo = new Array(25).fill(0);
  const sHi = new Array(25).fill(0);
  const msgLen = msg.length;
  const padLen = rate - (msgLen % rate); // 1..rate
  const total = msgLen + padLen;
  const padded = new Uint8Array(total);
  padded.set(msg);
  padded[msgLen] = padByte;
  padded[total - 1] |= 0x80;
  for (let off = 0; off < total; off += rate) {
    for (let i = 0; i < rate; i += 8) {
      const li = i >> 3;
      const p = off + i;
      const lo = (padded[p] | (padded[p + 1] << 8) | (padded[p + 2] << 16) | (padded[p + 3] << 24)) >>> 0;
      const hi = (padded[p + 4] | (padded[p + 5] << 8) | (padded[p + 6] << 16) | (padded[p + 7] << 24)) >>> 0;
      sLo[li] = (sLo[li] ^ lo) >>> 0;
      sHi[li] = (sHi[li] ^ hi) >>> 0;
    }
    keccakF1600(sLo, sHi);
  }
  const out = new Uint8Array(outLen);
  let produced = 0;
  while (produced < outLen) {
    const blockBytes = Math.min(rate, outLen - produced);
    for (let i = 0; i < blockBytes; i++) {
      const laneIdx = i >> 3;
      const bil = i & 7;
      const word = bil < 4 ? sLo[laneIdx] : sHi[laneIdx];
      out[produced++] = (word >>> ((bil & 3) * 8)) & 0xff;
    }
    if (produced < outLen) keccakF1600(sLo, sHi);
  }
  return out;
}

// FIPS 203 §4.4–4.5 的四个哈希原语（H/G/J/PRF/XOF）
const H = (m) => sponge(136, 0x06, m, 32);        // H = SHA3-256
const G = (m) => sponge(72, 0x06, m, 64);         // G = SHA3-512（输出 64B，调用方切两半）
const J = (m) => sponge(136, 0x1f, m, 32);        // J = SHAKE-256(s, 32)
const prf = (eta, s, b) => sponge(136, 0x1f, concatBytes(s, new Uint8Array([b])), 64 * eta); // PRF = SHAKE-256(s‖b, 64η)
const xof = (s, x, y, outLen) => sponge(168, 0x1f, concatBytes(s, new Uint8Array([x, y])), outLen); // XOF = SHAKE-128(s‖x‖y)

// ============================================================
// Z_3329 与 NTT（FIPS 203 §4.3）
// ============================================================

const Q = 3329;

/** BitRev7（FIPS 203 §4.2）：7 位反转。 */
function bitRev7(i) {
  return ((i & 1) << 6) | ((i & 2) << 4) | ((i & 4) << 2) | (i & 8) | ((i & 16) >> 2) | ((i & 32) >> 4) | ((i & 64) >> 6);
}

function powMod(b, e) {
  let r = 1;
  while (e > 0) {
    if (e & 1) r = (r * b) % Q;
    b = (b * b) % Q;
    e >>= 1;
  }
  return r;
}

// ZETA[i] = 17^BitRev7(i) mod q（ζ=17 为 256 次本原单位根，FIPS 203 §4.3）
// ZETA[1..127] 按蝶形消耗顺序取用（ZETA[0] 不用，与 17^BitRev7(0)=1 对齐参考表）
const ZETA = new Int32Array(128);
// GAMMA[i] = 17^(2·BitRev7(i)+1) mod q —— NTT 域基乘 γ（FIPS 203 §4.3 MultiplyNTTs）
const GAMMA = new Int32Array(128);
for (let i = 0; i < 128; i++) {
  const r = bitRev7(i);
  ZETA[i] = powMod(17, r);
  GAMMA[i] = powMod(17, 2 * r + 1);
}
const NTT_F = 3303; // 128^{-1} mod q（NTT^-1 末尾缩放，FIPS 203 §4.3）

/** 正向 NTT（FIPS 203 §4.3，Cooley–Tukey 负卷绕）。就地修改 f，输入须已化为 [0,q)。 */
function ntt(f) {
  let k = 1;
  for (let len = 128; len >= 2; len >>= 1) {
    for (let start = 0; start < 256; start += len << 1) {
      const zeta = ZETA[k++];
      for (let j = start; j < start + len; j++) {
        const t = (zeta * f[j + len]) % Q;
        f[j + len] = (f[j] - t + Q) % Q;
        f[j] = (f[j] + t) % Q;
      }
    }
  }
}

/** 逆向 NTT（FIPS 203 §4.3，Gentleman–Sande + 128^{-1} 缩放）。就地修改 f。 */
function intt(f) {
  let k = 127;
  for (let len = 2; len <= 128; len <<= 1) {
    for (let start = 0; start < 256; start += len << 1) {
      const zeta = ZETA[k--];
      for (let j = start; j < start + len; j++) {
        const t = f[j];
        f[j] = (t + f[j + len]) % Q;
        f[j + len] = (zeta * ((f[j + len] - t + Q) % Q)) % Q;
      }
    }
  }
  for (let j = 0; j < 256; j++) f[j] = (f[j] * NTT_F) % Q;
}

/** NTT 域多项式乘（FIPS 203 §4.3 MultiplyNTTs，基乘 γ=GAMMA[m] 逐 2 元块）。 */
function mulHat(a, b) {
  const out = new Int32Array(256);
  for (let m = 0; m < 128; m++) {
    const a0 = a[2 * m], a1 = a[2 * m + 1], b0 = b[2 * m], b1 = b[2 * m + 1];
    out[2 * m] = (a0 * b0 + GAMMA[m] * ((a1 * b1) % Q)) % Q;
    out[2 * m + 1] = (a0 * b1 + a1 * b0) % Q;
  }
  return out;
}

/** dst += src（NTT 域，模 q），src 可含小负值。 */
function addInto(dst, src) {
  for (let j = 0; j < 256; j++) {
    dst[j] = (dst[j] + src[j] % Q + Q) % Q;
  }
}

// ============================================================
// 字节编解码 / 压缩（FIPS 203 §4.2.1）
// ============================================================

/** ByteEncode_d：256 系数 × d 位，LSB 先行的位流。系数须 < 2^d。 */
function byteEncode(f, d) {
  const out = new Uint8Array(32 * d);
  let acc = 0, accBits = 0, pos = 0;
  for (let j = 0; j < 256; j++) {
    acc |= f[j] << accBits;
    accBits += d;
    while (accBits >= 8) {
      out[pos++] = acc & 0xff;
      acc >>>= 8;
      accBits -= 8;
    }
  }
  return out;
}

/** ByteDecode_d：返回原始 0..2^d-1 系数；d=12 的调用方须自行 mod q（FIPS 203 语义）。 */
function byteDecode(bytes, d) {
  const f = new Int32Array(256);
  const mask = (1 << d) - 1;
  let acc = 0, accBits = 0, pos = 0;
  for (let j = 0; j < 256; j++) {
    while (accBits < d) {
      acc |= bytes[pos++] << accBits;
      accBits += 8;
    }
    f[j] = acc & mask;
    acc >>>= d;
    accBits -= d;
  }
  return f;
}

/** Compress_d(x) = ⌊2^d·x/q + 1/2⌋ mod 2^d（x ∈ [0,q)，整数式无浮点误差）。 */
const compressVal = (x, d) => Math.floor((x * (1 << d) + 1664) / Q) % (1 << d); // 1664 = ⌊q/2⌋，与 (2x·2^d+q)//2q 等价

/** Decompress_d(y) = ⌊q·y/2^d + 1/2⌋。 */
const decompressVal = (y, d) => (Q * y + (1 << (d - 1))) >> d;

function compressPoly(f, d) {
  const out = new Int32Array(256);
  for (let j = 0; j < 256; j++) out[j] = compressVal(f[j], d);
  return out;
}

function decompressPoly(f, d) {
  const out = new Int32Array(256);
  for (let j = 0; j < 256; j++) out[j] = decompressVal(f[j], d);
  return out;
}

// ============================================================
// 采样（FIPS 203 §4.3.2）
// ============================================================

/**
 * SampleNTT（FIPS 203 §4.3.2，即 Kyber Parse）：
 * XOF(B‖x‖y) 流上每 3 字节产两个 12 位候选（LE 位流交错），
 * 拒绝 ≥ q。一次性取 840B（SHAKE-128 足量，不够即数据异常）。
 */
function sampleNtt(seed, x, y) {
  const stream = xof(seed, x, y, 840);
  const f = new Int32Array(256);
  let i = 0, j = 0;
  while (j < 256) {
    if (i + 3 > stream.length) throw new Error("SampleNTT 随机流耗尽（输入数据异常）");
    const d1 = stream[i] + 256 * (stream[i + 1] & 15);
    const d2 = (stream[i + 1] >> 4) + 16 * stream[i + 2];
    i += 3;
    if (d1 < Q) f[j++] = d1;
    if (d2 < Q && j < 256) f[j++] = d2;
  }
  return f;
}

/**
 * SamplePolyCBD_η（FIPS 203 §4.3.2）：第 j 系数取位流第 2ηj..2ηj+2η-1 位，
 * 值 = popcount(低 η 位) − popcount(高 η 位)（定稿对半形式，非 round-3 交错位），
 * 归一化到 [0,q)。
 */
function sampleCbd(block, eta) {
  const f = new Int32Array(256);
  let bit = 0;
  for (let j = 0; j < 256; j++) {
    let a = 0, b = 0;
    for (let t = 0; t < eta; t++) {
      a += (block[(bit + t) >> 3] >> ((bit + t) & 7)) & 1;
      b += (block[(bit + eta + t) >> 3] >> ((bit + eta + t) & 7)) & 1;
    }
    f[j] = ((a - b) % Q + Q) % Q;
    bit += 2 * eta;
  }
  return f;
}

// ============================================================
// 参数集（FIPS 203 Table 2）
// ============================================================

const PARAM_SETS = {
  512:  { k: 2, eta1: 3, eta2: 2, du: 10, dv: 4 },
  768:  { k: 3, eta1: 2, eta2: 2, du: 10, dv: 4 },
  1024: { k: 4, eta1: 2, eta2: 2, du: 11, dv: 5 },
};

function getSet(key) {
  const name = String(key == null ? "768" : key).replace(/^ML-KEM-/i, "").trim();
  const s = PARAM_SETS[name];
  if (!s) throw new Error(`未知参数集: ${key}（可选 ML-KEM-512 / 768 / 1024）`);
  return { name, ...s, ekLen: 384 * s.k + 32, dkLen: 768 * s.k + 96, ctLen: 32 * (s.du * s.k + s.dv) };
}

// ============================================================
// K-PKE（FIPS 203 §5，Alg 13–15）
// ============================================================

/** K_PKE.KeyGen（Alg 13）。注意定稿用 G(d‖byte(k))（参数集域分隔），z 不进 K-PKE。 */
function kpkeKeyGen(s, d) {
  const g = G(concatBytes(d, new Uint8Array([s.k])));
  const rho = g.slice(0, 32);
  const sigma = g.slice(32);

  let N = 0;
  const sHat = [], eHat = [];
  for (let i = 0; i < s.k; i++) { const f = sampleCbd(prf(s.eta1, sigma, N++), s.eta1); ntt(f); sHat.push(f); }
  for (let i = 0; i < s.k; i++) { const f = sampleCbd(prf(s.eta1, sigma, N++), s.eta1); ntt(f); eHat.push(f); }

  let ek = new Uint8Array(0);
  for (let i = 0; i < s.k; i++) {
    // t̂_i = Σ_j Â[i][j] ∘ ŝ_j + ê_i；Â[i][j] = SampleNTT(XOF(ρ, j, i))
    const acc = eHat[i];
    for (let j = 0; j < s.k; j++) addInto(acc, mulHat(sampleNtt(rho, j, i), sHat[j]));
    ek = concatBytes(ek, byteEncode(acc, 12));
  }
  let dk = new Uint8Array(0);
  for (let i = 0; i < s.k; i++) dk = concatBytes(dk, byteEncode(sHat[i], 12));

  return { ekPke: concatBytes(ek, rho), dkPke: dk };
}

/** K_PKE.Encrypt（Alg 14）。含 FIPS 203 §7.2 的 ek 类型检查 + 模数检查（t̂ 重编码比对）。 */
function kpkeEncrypt(s, ekPke, m, r) {
  if (ekPke.length !== s.ekLen) {
    throw new Error(`ek 长度错误：ML-KEM-${s.name} 应为 ${s.ekLen} 字节，实得 ${ekPke.length}`);
  }
  const tHatBytes = ekPke.slice(0, 384 * s.k);
  const rho = ekPke.slice(384 * s.k);

  const tHat = [];
  for (let i = 0; i < s.k; i++) {
    const chunk = tHatBytes.slice(i * 384, (i + 1) * 384);
    const f = byteDecode(chunk, 12);
    for (let j = 0; j < 256; j++) f[j] %= Q; // ByteDecode_12 归约到 Z_q
    if (!bytesEqual(byteEncode(f, 12), chunk)) {
      throw new Error("ek 模数检查失败：t̂ 非规范编码（所有 12 位值须 < q=3329）");
    }
    tHat.push(f);
  }

  let N = 0;
  const yHat = [], e1 = [];
  for (let i = 0; i < s.k; i++) { const f = sampleCbd(prf(s.eta1, r, N++), s.eta1); ntt(f); yHat.push(f); }
  for (let i = 0; i < s.k; i++) e1.push(sampleCbd(prf(s.eta2, r, N++), s.eta2));
  const e2 = sampleCbd(prf(s.eta2, r, N++), s.eta2);

  // u_i = INTT(Σ_j Âᵀ[i][j] ∘ ŷ_j) + e1_i，其中 Âᵀ[i][j] = Â[j][i] = SampleNTT(XOF(ρ, i, j))
  const u = [];
  for (let i = 0; i < s.k; i++) {
    const acc = new Int32Array(256);
    for (let j = 0; j < s.k; j++) addInto(acc, mulHat(sampleNtt(rho, i, j), yHat[j]));
    intt(acc);
    addInto(acc, e1[i]);
    u.push(acc);
  }

  // v = INTT(Σ_i t̂_i ∘ ŷ_i) + e2 + μ，μ = Decompress_1(ByteDecode_1(m))
  const accV = new Int32Array(256);
  for (let i = 0; i < s.k; i++) addInto(accV, mulHat(tHat[i], yHat[i]));
  intt(accV);
  addInto(accV, e2);
  addInto(accV, decompressPoly(byteDecode(m, 1), 1));

  let c = new Uint8Array(0);
  for (let i = 0; i < s.k; i++) c = concatBytes(c, byteEncode(compressPoly(u[i], s.du), s.du));
  c = concatBytes(c, byteEncode(compressPoly(accV, s.dv), s.dv));
  return c;
}

/** K_PKE.Decrypt（Alg 15）。 */
function kpkeDecrypt(s, dkPke, c) {
  const n1 = s.k * s.du * 32;
  const c1 = c.slice(0, n1);
  const c2 = c.slice(n1);

  const uHat = [];
  for (let i = 0; i < s.k; i++) {
    const u = decompressPoly(byteDecode(c1.slice(i * s.du * 32, (i + 1) * s.du * 32), s.du), s.du);
    ntt(u);
    uHat.push(u);
  }
  const v = decompressPoly(byteDecode(c2, s.dv), s.dv);

  const acc = new Int32Array(256);
  for (let i = 0; i < s.k; i++) {
    const sHat = byteDecode(dkPke.slice(i * 384, (i + 1) * 384), 12);
    for (let j = 0; j < 256; j++) sHat[j] %= Q;
    addInto(acc, mulHat(sHat, uHat[i]));
  }
  intt(acc);

  // m = ByteEncode_1(Compress_1(v − w))
  const out = new Int32Array(256);
  for (let j = 0; j < 256; j++) out[j] = compressVal((v[j] - acc[j] + Q) % Q, 1);
  return byteEncode(out, 1);
}

// ============================================================
// ML-KEM（FIPS 203 §6–7，Alg 16–21）
// ============================================================

/** ML-KEM.KeyGen_internal（Alg 16）+ KeyGen（Alg 19）：dk = dk_PKE ‖ ek ‖ H(ek) ‖ z。 */
export function mlkemKeyGenBytes(setKey, d, z) {
  const s = getSet(setKey);
  d = seedBytes(d, "种子 d");
  z = seedBytes(z, "种子 z");
  const { ekPke, dkPke } = kpkeKeyGen(s, d);
  const dk = concatBytes(dkPke, ekPke, H(ekPke), z);
  return { set: s.name, d, z, ek: ekPke, dk };
}

/** ML-KEM.Encaps_internal（Alg 17）+ Encaps（Alg 20）。m 留空则随机。 */
export function mlkemEncapsBytes(setKey, ek, m) {
  const s = getSet(setKey);
  ek = hexToBytes(ek);
  m = seedBytes(m, "随机性 m");
  const g = G(concatBytes(m, H(ek)));
  const ss = g.slice(0, 32);
  const r = g.slice(32);
  const ct = kpkeEncrypt(s, ek, m, r);
  return { set: s.name, m, ct, ss };
}

/** ML-KEM.Decaps_internal（Alg 18）+ Decaps（Alg 21）。隐式拒绝时返回伪随机 K̄。 */
export function mlkemDecapsBytes(setKey, dk, ct) {
  const s = getSet(setKey);
  dk = hexToBytes(dk);
  ct = hexToBytes(ct);

  if (ct.length !== s.ctLen) {
    throw new Error(`密文类型检查失败：ML-KEM-${s.name} 应为 ${s.ctLen} 字节，实得 ${ct.length}`);
  }
  if (dk.length !== s.dkLen) {
    throw new Error(`dk 类型检查失败：ML-KEM-${s.name} 应为 ${s.dkLen} 字节，实得 ${dk.length}`);
  }
  const dkPke = dk.slice(0, 384 * s.k);
  const ekPke = dk.slice(384 * s.k, 768 * s.k + 32);
  const h = dk.slice(768 * s.k + 32, 768 * s.k + 64);
  const z = dk.slice(768 * s.k + 64);
  if (!bytesEqual(H(ekPke), h)) throw new Error("dk 哈希检查失败：H(ek) 与 dk 内嵌哈希不符");

  const m2 = kpkeDecrypt(s, dkPke, ct);
  const g = G(concatBytes(m2, h));
  const k2 = g.slice(0, 32);
  const r2 = g.slice(32);
  const kBar = J(concatBytes(z, ct));
  const c2 = kpkeEncrypt(s, ekPke, m2, r2);
  const implicit = !bytesEqual(ct, c2);
  return { set: s.name, ss: implicit ? kBar : k2, implicit };
}

// ============================================================
// op 包装
// ============================================================

const SET_OPTIONS = ["512", "768", "1024"];

register({
  id: "mlkemKeyGen",
  family: "mlkem", familyLabel: "keygen",
  cat: "asym",
  name: "ML-KEM 密钥生成",
  desc: "FIPS 203 ML-KEM-512/768/1024（后量子 KEM）密钥对生成，d/z 种子可固定复现（含 FO 变换）。纯 JS 实现，单次毫秒级",
  params: [
    { key: "set", label: "参数集", type: "select", default: "768", options: SET_OPTIONS },
    { key: "d", label: "种子 d (hex 32B，留空随机)", type: "text", default: "", placeholder: "教学复现可固定" },
    { key: "z", label: "种子 z (hex 32B，留空随机)", type: "text", default: "", placeholder: "教学复现可固定" },
  ],
  run: (t, p = {}) => {
    const r = mlkemKeyGenBytes(p.set, p.d, p.z);
    const s = PARAM_SETS[r.set];
    // T362 产物协议（2026-09-02）：ek / dk 分开交付下载按钮（恒烈指示），hex 文本文件。
    return {
      text: [
        `参数集: ML-KEM-${r.set} (k=${s.k}, η1=${s.eta1}, η2=${s.eta2}, du=${s.du}, dv=${s.dv})`,
        `公钥 ek (${r.ek.length} B / ${r.ek.length * 8} bit):`,
        bytesToHex(r.ek),
        `私钥 dk (${r.dk.length} B / ${r.dk.length * 8} bit，= dk_PKE‖ek‖H(ek)‖z):`,
        bytesToHex(r.dk),
        `种子 d: ${bytesToHex(r.d)}`,
        `种子 z: ${bytesToHex(r.z)}`,
        "",
        "公钥 ek / 私钥 dk 已分开生成：dk ⚠ 敏感请妥善保管。点击下方按钮下载（hex 文本，可直接粘回封装/解封装）。",
      ].join("\n"),
      files: [
        { name: `mlkem${r.set}_ek.pub.hex`, mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(r.ek) + "\n") },
        { name: `mlkem${r.set}_dk.priv.hex`, mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(r.dk) + "\n") },
      ],
    };
  },
});

register({
  id: "mlkemEncaps",
  family: "mlkem", familyLabel: "encaps",
  cat: "asym",
  name: "ML-KEM 封装",
  desc: "FIPS 203 封装：输入公钥 ek，输出密文 ct 与共享密钥 SS(32B)；随机性 m 可固定复现（含 ek 类型/模数检查）",
  params: [
    { key: "set", label: "参数集", type: "select", default: "768", options: SET_OPTIONS },
    { key: "m", label: "随机性 m (hex 32B，留空随机)", type: "text", default: "", placeholder: "教学复现可固定" },
  ],
  run: (t, p = {}) => {
    const r = mlkemEncapsBytes(p.set, t, p.m);
    // T362 产物协议（2026-09-02）：ct / SS 走下载按钮（ct 二进制 + SS hex），text 保留 hex（链式兼容）。
    return {
      text: [
        `参数集: ML-KEM-${r.set}`,
        `密文 ct (${r.ct.length} B / ${r.ct.length * 8} bit):`,
        bytesToHex(r.ct),
        `共享密钥 SS (32 B):`,
        bytesToHex(r.ss),
        `随机性 m: ${bytesToHex(r.m)}`,
      ].join("\n"),
      files: [
        { name: `mlkem${r.set}_ct.bin`, mime: "application/octet-stream", bytes: r.ct },
        { name: `mlkem${r.set}_ss.hex`, mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(r.ss) + "\n") },
      ],
    };
  },
});

register({
  id: "mlkemDecaps",
  family: "mlkem", familyLabel: "decaps",
  cat: "asym",
  name: "ML-KEM 解封装",
  desc: "FIPS 203 解封装：输入私钥 dk + 密文 ct，输出共享密钥 SS(32B)；密文被篡改时走隐式拒绝返回伪随机 K̄（含类型/哈希检查）",
  params: [
    { key: "set", label: "参数集", type: "select", default: "768", options: SET_OPTIONS },
    { key: "ct", label: "密文 ct (hex)", type: "text", default: "", placeholder: "封装输出的 ct hex" },
  ],
  run: (t, p = {}) => {
    const r = mlkemDecapsBytes(p.set, t, p.ct);
    const lines = [
      `参数集: ML-KEM-${r.set}`,
      `共享密钥 SS (32 B):`,
      bytesToHex(r.ss),
    ];
    if (r.implicit) lines.push(`注: 隐式拒绝路径（重加密密文不符，SS = K̄ = J(z‖c) 伪随机值）`);
    return lines.join("\n");
  },
});
