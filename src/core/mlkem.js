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
import { randomBytes as randBytes } from "./randSource.js"; // 统一随机源（默认档 system 逐字节零回归）

// ============================================================
// 字节工具
// ============================================================

const HEX_VAL = new Int8Array(256).fill(-1);
for (let i = 0; i < 10; i++) HEX_VAL[48 + i] = i;
for (let i = 0; i < 6; i++) { HEX_VAL[97 + i] = 10 + i; HEX_VAL[65 + i] = 10 + i; }
const HEX2 = [];
for (let i = 0; i < 256; i++) HEX2.push(i.toString(16).padStart(2, "0"));

function hexToBytes(hex) {
  let h = String(hex == null ? "" : hex).replace(/^0x/i, "").replace(/\s+/g, "");
  if (!h) return new Uint8Array(0);
  if (h.length % 2) h = "0" + h;
  const out = new Uint8Array(h.length >> 1);
  for (let i = 0, j = 0; i < out.length; i++, j += 2) {
    const a = HEX_VAL[h.charCodeAt(j)] ?? -1, b = HEX_VAL[h.charCodeAt(j + 1)] ?? -1;
    if (a < 0 || b < 0) throw new Error(`含非 hex 字符: ${hex}`);
    out[i] = (a << 4) | b;
  }
  return out;
}

function bytesToHex(bytes) {
  const parts = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) parts[i] = HEX2[bytes[i]];
  return parts.join("");
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
  return randBytes(n);
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

// 海绵状态 / 末块 / 种子拼接复用缓冲（同步调用，无重入）。
const SPONGE_LO = new Uint32Array(25);
const SPONGE_HI = new Uint32Array(25);
const PAD_BLOCK = new Uint8Array(168); // 最大 rate（SHAKE128）
const SEED_BUF = new Uint8Array(64);

/** 整块吸收（rate 为 8 的倍数：136 / 168）。 */
function absorbBlock(src, off, rate, sLo, sHi) {
  for (let i = 0; i < rate; i += 8) {
    const li = i >> 3;
    const p = off + i;
    const lo = (src[p] | (src[p + 1] << 8) | (src[p + 2] << 16) | (src[p + 3] << 24)) >>> 0;
    const hi = (src[p + 4] | (src[p + 5] << 8) | (src[p + 6] << 16) | (src[p + 7] << 24)) >>> 0;
    sLo[li] = (sLo[li] ^ lo) >>> 0;
    sHi[li] = (sHi[li] ^ hi) >>> 0;
  }
}

/**
 * rate 字节海绵。padByte：SHA3=0x06、SHAKE=0x1f（域分隔 + pad10*1）。
 * 与 hash.js 内部 keccak() 同构：sLo/sHi 双 32 位模拟 64 位 × 25 lane。
 * 整块消息直接吸收（不再复制整段 padded），末块走复用缓冲。
 */
function sponge(rate, padByte, msg, outLen) {
  const sLo = SPONGE_LO, sHi = SPONGE_HI;
  sLo.fill(0);
  sHi.fill(0);
  const msgLen = msg.length;
  const full = msgLen - (msgLen % rate);
  for (let off = 0; off < full; off += rate) {
    absorbBlock(msg, off, rate, sLo, sHi);
    keccakF1600(sLo, sHi);
  }
  const rem = msgLen - full; // 0..rate-1
  const block = PAD_BLOCK;
  block.fill(0, 0, rate);
  for (let i = 0; i < rem; i++) block[i] = msg[full + i];
  block[rem] = padByte;
  block[rate - 1] |= 0x80;
  absorbBlock(block, 0, rate, sLo, sHi);
  keccakF1600(sLo, sHi);
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
function prf(eta, s, b) {                         // PRF = SHAKE-256(s‖b, 64η)
  SEED_BUF.set(s, 0);
  SEED_BUF[32] = b;
  return sponge(136, 0x1f, SEED_BUF.subarray(0, 33), 64 * eta);
}
function xof(s, x, y, outLen) {                   // XOF = SHAKE-128(s‖x‖y)
  SEED_BUF.set(s, 0);
  SEED_BUF[32] = x;
  SEED_BUF[33] = y;
  return sponge(168, 0x1f, SEED_BUF.subarray(0, 34), outLen);
}

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
// ZETA_M 为 Montgomery 形式 ζ·2^16 mod q（R=2^16，q·q^{-1}≡1 mod R，q^{-1}=62209）。
const ZETA_M = new Int32Array(128);
// GAMMA[i] = 17^(2·BitRev7(i)+1) mod q —— NTT 域基乘 γ（FIPS 203 §4.3 MultiplyNTTs）
const GAMMA = new Int32Array(128);
const MONT_R = 65536;
const MONT_QINV = 62209; // q^{-1} mod 2^16
for (let i = 0; i < 128; i++) {
  const r = bitRev7(i);
  ZETA_M[i] = (powMod(17, r) * MONT_R) % Q;
  GAMMA[i] = powMod(17, 2 * r + 1);
}
const NTT_F_M = (3303 * MONT_R) % Q; // 128^{-1} mod q 的 Montgomery 形式

/** Montgomery 乘：a·bM·R^{-1} mod q（bM 为 Montgomery 形式，结果 [0,q)）。 */
function montMul(a, bM) {
  const t = a * bM;
  const m = (t * MONT_QINV) & 0xffff;
  let r = (t - m * Q) >> 16;
  if (r < 0) r += Q;
  return r;
}

/** 正向 NTT（FIPS 203 §4.3，Cooley–Tukey 负卷绕）。就地修改 f，输入须已化为 [0,q)。 */
function ntt(f) {
  let k = 1;
  for (let len = 128; len >= 2; len >>= 1) {
    for (let start = 0; start < 256; start += len << 1) {
      const zeta = ZETA_M[k++];
      for (let j = start; j < start + len; j++) {
        const v = f[j], u = f[j + len];
        const t = montMul(u, zeta);
        let x = v - t;
        if (x < 0) x += Q;
        f[j + len] = x;
        x = v + t;
        if (x >= Q) x -= Q;
        f[j] = x;
      }
    }
  }
}

/** 逆向 NTT（FIPS 203 §4.3，Gentleman–Sande + 128^{-1} 缩放）。就地修改 f。 */
function intt(f) {
  let k = 127;
  for (let len = 2; len <= 128; len <<= 1) {
    for (let start = 0; start < 256; start += len << 1) {
      const zeta = ZETA_M[k--];
      for (let j = start; j < start + len; j++) {
        const v = f[j], u = f[j + len];
        let x = v + u;
        if (x >= Q) x -= Q;
        f[j] = x;
        let d = u - v;
        if (d < 0) d += Q;
        f[j + len] = montMul(d, zeta);
      }
    }
  }
  for (let j = 0; j < 256; j++) f[j] = montMul(f[j], NTT_F_M);
}

// Barrett 归约（x ∈ [0, 2q²)）：一次乘减 + 条件修正，替代 %。
const INV_Q = 1 / Q;
function redcQ(x) {
  let r = x - ((x * INV_Q) | 0) * Q;
  if (r >= Q) r -= Q;
  return r;
}

/** NTT 域多项式乘累加（FIPS 203 §4.3 MultiplyNTTs，基乘 γ=GAMMA[m] 逐 2 元块）。 */
function mulAddInto(dst, a, b) {
  for (let m = 0; m < 128; m++) {
    const a0 = a[2 * m], a1 = a[2 * m + 1], b0 = b[2 * m], b1 = b[2 * m + 1];
    const p0 = redcQ(a0 * b0 + GAMMA[m] * a1 * b1);
    const p1 = redcQ(a0 * b1 + a1 * b0);
    let x = dst[2 * m] + p0;
    if (x >= Q) x -= Q;
    dst[2 * m] = x;
    x = dst[2 * m + 1] + p1;
    if (x >= Q) x -= Q;
    dst[2 * m + 1] = x;
  }
}

/** dst += src（NTT 域，模 q），src 可含小负值。 */
function addInto(dst, src) {
  for (let j = 0; j < 256; j++) {
    let s = src[j];
    if (s < 0) s += Q;
    let x = dst[j] + s;
    if (x >= Q) x -= Q;
    dst[j] = x;
  }
}

// ============================================================
// 字节编解码 / 压缩（FIPS 203 §4.2.1）
// ============================================================

/** ByteEncode_d 写入 out[off..]：256 系数 × d 位，LSB 先行的位流。系数须 < 2^d。 */
function byteEncodeTo(f, d, out, off) {
  let acc = 0, accBits = 0;
  for (let j = 0; j < 256; j++) {
    acc |= f[j] << accBits;
    accBits += d;
    while (accBits >= 8) {
      out[off++] = acc & 0xff;
      acc >>>= 8;
      accBits -= 8;
    }
  }
}

/** ByteDecode_d 自 bytes[off..]：返回原始 0..2^d-1 系数；d=12 的调用方须自行 mod q。 */
function byteDecodeAt(bytes, off, d) {
  const f = new Int32Array(256);
  const mask = (1 << d) - 1;
  let acc = 0, accBits = 0, pos = off;
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

/** ByteDecode_d 后立即 Decompress_d（省去中间原始系数数组）。 */
function decodeDecompressAt(bytes, off, d) {
  const f = new Int32Array(256);
  const mask = (1 << d) - 1;
  let acc = 0, accBits = 0, pos = off;
  for (let j = 0; j < 256; j++) {
    while (accBits < d) {
      acc |= bytes[pos++] << accBits;
      accBits += 8;
    }
    f[j] = decompressVal(acc & mask, d);
    acc >>>= d;
    accBits -= d;
  }
  return f;
}

/** Compress_d(x) = ⌊2^d·x/q + 1/2⌋ mod 2^d（x ∈ [0,q)，整数式无浮点误差）。 */
const compressVal = (x, d) => Math.floor((x * (1 << d) + 1664) / Q) % (1 << d); // 1664 = ⌊q/2⌋，与 (2x·2^d+q)//2q 等价

/** Decompress_d(y) = ⌊q·y/2^d + 1/2⌋。 */
const decompressVal = (y, d) => (Q * y + (1 << (d - 1))) >> d;

/** Compress_d + ByteEncode_d 一次写入 out[off..]（省去中间系数数组）。 */
function encodeCompressed(f, d, out, off) {
  const mod = 1 << d;
  const mask = mod - 1;
  let acc = 0, accBits = 0;
  for (let j = 0; j < 256; j++) {
    acc |= (Math.floor((f[j] * mod + 1664) / Q) & mask) << accBits;
    accBits += d;
    while (accBits >= 8) {
      out[off++] = acc & 0xff;
      acc >>>= 8;
      accBits -= 8;
    }
  }
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
// η=2（4 位块）/ η=3（6 位块）的 popcount 差查表，值已归一到 [0,q)。
const CBD2 = new Int32Array(16);
for (let v = 0; v < 16; v++) {
  const a = (v & 1) + ((v >> 1) & 1);
  const b = ((v >> 2) & 1) + ((v >> 3) & 1);
  CBD2[v] = a - b < 0 ? a - b + Q : a - b;
}
const CBD3 = new Int32Array(64);
for (let v = 0; v < 64; v++) {
  const a = (v & 1) + ((v >> 1) & 1) + ((v >> 2) & 1);
  const b = ((v >> 3) & 1) + ((v >> 4) & 1) + ((v >> 5) & 1);
  CBD3[v] = a - b < 0 ? a - b + Q : a - b;
}

function sampleCbd(block, eta) {
  const f = new Int32Array(256);
  if (eta === 2) {
    for (let j = 0; j < 256; j++) {
      const byte = block[j >> 1];
      f[j] = CBD2[(j & 1) ? (byte >> 4) : (byte & 15)];
    }
    return f;
  }
  let acc = 0, accBits = 0, pos = 0; // η=3：6 位/系数，跨字节取块
  for (let j = 0; j < 256; j++) {
    while (accBits < 6) {
      acc |= block[pos++] << accBits;
      accBits += 8;
    }
    f[j] = CBD3[acc & 63];
    acc >>>= 6;
    accBits -= 6;
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
  const rho = g.subarray(0, 32);
  const sigma = g.subarray(32);

  let N = 0;
  const sHat = [], eHat = [];
  for (let i = 0; i < s.k; i++) { const f = sampleCbd(prf(s.eta1, sigma, N++), s.eta1); ntt(f); sHat.push(f); }
  for (let i = 0; i < s.k; i++) { const f = sampleCbd(prf(s.eta1, sigma, N++), s.eta1); ntt(f); eHat.push(f); }

  const ek = new Uint8Array(384 * s.k + 32);
  for (let i = 0; i < s.k; i++) {
    // t̂_i = Σ_j Â[i][j] ∘ ŝ_j + ê_i；Â[i][j] = SampleNTT(XOF(ρ, j, i))
    const acc = eHat[i];
    for (let j = 0; j < s.k; j++) mulAddInto(acc, sampleNtt(rho, j, i), sHat[j]);
    byteEncodeTo(acc, 12, ek, i * 384);
  }
  ek.set(rho, 384 * s.k);
  const dkPke = new Uint8Array(384 * s.k);
  for (let i = 0; i < s.k; i++) byteEncodeTo(sHat[i], 12, dkPke, i * 384);

  return { ekPke: ek, dkPke };
}

/** K_PKE.Encrypt（Alg 14）。含 FIPS 203 §7.2 的 ek 类型检查 + 模数检查（t̂ 重编码比对）。 */
function kpkeEncrypt(s, ekPke, m, r) {
  if (ekPke.length !== s.ekLen) {
    throw new Error(`ek 长度错误：ML-KEM-${s.name} 应为 ${s.ekLen} 字节，实得 ${ekPke.length}`);
  }
  const tHat = [];
  for (let i = 0; i < s.k; i++) {
    const f = byteDecodeAt(ekPke, i * 384, 12);
    for (let j = 0; j < 256; j++) {
      if (f[j] >= Q) { // 12 位值 ≥ q 时重编码必不等于原串
        throw new Error("ek 模数检查失败：t̂ 非规范编码（所有 12 位值须 < q=3329）");
      }
    }
    tHat.push(f);
  }
  const rho = ekPke.subarray(384 * s.k);

  let N = 0;
  const yHat = [], e1 = [];
  for (let i = 0; i < s.k; i++) { const f = sampleCbd(prf(s.eta1, r, N++), s.eta1); ntt(f); yHat.push(f); }
  for (let i = 0; i < s.k; i++) e1.push(sampleCbd(prf(s.eta2, r, N++), s.eta2));
  const e2 = sampleCbd(prf(s.eta2, r, N++), s.eta2);

  const c = new Uint8Array(s.ctLen);
  const duBytes = 32 * s.du;
  // u_i = INTT(Σ_j Âᵀ[i][j] ∘ ŷ_j) + e1_i，其中 Âᵀ[i][j] = Â[j][i] = SampleNTT(XOF(ρ, i, j))
  for (let i = 0; i < s.k; i++) {
    const acc = new Int32Array(256);
    for (let j = 0; j < s.k; j++) mulAddInto(acc, sampleNtt(rho, i, j), yHat[j]);
    intt(acc);
    addInto(acc, e1[i]);
    encodeCompressed(acc, s.du, c, i * duBytes);
  }

  // v = INTT(Σ_i t̂_i ∘ ŷ_i) + e2 + μ，μ = Decompress_1(ByteDecode_1(m))
  const accV = new Int32Array(256);
  for (let i = 0; i < s.k; i++) mulAddInto(accV, tHat[i], yHat[i]);
  intt(accV);
  addInto(accV, e2);
  for (let j = 0; j < 256; j++) {
    if ((m[j >> 3] >> (j & 7)) & 1) { // μ_j = 1665（= Decompress_1(1)）
      let x = accV[j] + 1665;
      if (x >= Q) x -= Q;
      accV[j] = x;
    }
  }
  encodeCompressed(accV, s.dv, c, s.k * duBytes);
  return c;
}

/** K_PKE.Decrypt（Alg 15）。 */
function kpkeDecrypt(s, dkPke, c) {
  const n1 = s.k * s.du * 32;

  const uHat = [];
  for (let i = 0; i < s.k; i++) {
    const u = decodeDecompressAt(c, i * s.du * 32, s.du);
    ntt(u);
    uHat.push(u);
  }
  const v = decodeDecompressAt(c, n1, s.dv);

  const acc = new Int32Array(256);
  for (let i = 0; i < s.k; i++) {
    const sHat = byteDecodeAt(dkPke, i * 384, 12);
    for (let j = 0; j < 256; j++) { const x = sHat[j]; if (x >= Q) sHat[j] = x - Q; }
    mulAddInto(acc, sHat, uHat[i]);
  }
  intt(acc);

  // m = ByteEncode_1(Compress_1(v − w))
  const out = new Uint8Array(32);
  for (let j = 0; j < 256; j++) {
    let x = v[j] - acc[j];
    if (x < 0) x += Q;
    if (compressVal(x, 1)) out[j >> 3] |= 1 << (j & 7);
  }
  return out;
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
  const dkPke = dk.subarray(0, 384 * s.k);
  const ekPke = dk.subarray(384 * s.k, 768 * s.k + 32);
  const h = dk.subarray(768 * s.k + 32, 768 * s.k + 64);
  const z = dk.subarray(768 * s.k + 64);
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
    { sensitive: true, key: "d", label: "种子 d (hex 32B，留空随机)", type: "text", default: "", placeholder: "教学复现可固定" },
    { sensitive: true, key: "z", label: "种子 z (hex 32B，留空随机)", type: "text", default: "", placeholder: "教学复现可固定" },
  ],
  run: (t, p = {}) => {
    const r = mlkemKeyGenBytes(p.set, p.d, p.z);
    const s = PARAM_SETS[r.set];
    // 产物协议（2026-09-02）：ek / dk 分开交付下载按钮（产品裁决），hex 文本文件。
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
    // 产物协议（2026-09-02）：ct / SS 走下载按钮（ct 二进制 + SS hex），text 保留 hex（链式兼容）。
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
