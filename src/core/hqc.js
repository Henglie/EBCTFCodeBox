/*
 * hqc.js — HQC 后量子 KEM（Hamming Quasi-Cyclic，基于码的 KEM）keyGen / encaps(含 PKE 加密) / decaps
 *
 * 规范：HQC Specification 2025-08-22（pqc-hqc.org/doc/hqc_specifications_2025_08_22.pdf），
 * 参考实现对拍：gitlab.com/pqc-hqc/hqc（分支 next-release，src/ref + src/common）。
 * NIST 第四轮入选算法（2025-03-11 宣布，继 ML-KEM 之后第二个标准化 KEM）。
 *
 * 方案结构（规范 §3，页码为 2025-08-22 版 PDF）：
 *   - 环 R2 = GF(2)[X]/(X^n − 1)，n 为大于 n1·n2 的最小素数（Table 5, p.29）。
 *   - 私钥 (x,y)：权重 ω 的固定重量向量；公钥 h（均匀）与 s = x + h·y。
 *   - 加密（HQC-PKE.Encrypt, p.24）：θ 经 XOF 派生 (r2, e, r1)（采样顺序 r2→e→r1，§3.2 p.14），
 *     u = r1 + h·r2，v = C.Encode(m) + Truncate(s·r2 + e, ℓ=n1·n2)。
 *   - 解密（p.25）：m = C.Decode(v − Truncate(u·y, ℓ))，依赖 e' = x·r2 − r1·y + e 的重量 ≤ 纠错半径 Δ。
 *   - 码 C（§3.4, p.17–22）：RS(n1,k) over GF(2^8) ⊗ 重复 RM(1,7)=[128,8,64] 的拼接码
 *     （外码 RS、内码 RM，逐字节内码展开，非串行级联）；RM 重复 3 倍(HQC-1)/5 倍(HQC-3/5)（Table 4, p.21）。
 *   - KEM（§3.6, p.26–28）：HHK 框架 FO^⊥ 加盐变体（SFO^⊥，隐式拒绝）：
 *     (K,θ) = G(H(ek)‖m‖salt)，拒绝钥 K̄ = J(H(ek)‖σ‖c)。
 *   - 哈希域分隔（Table 1, p.13；域分隔字节值取参考实现 src/common/symmetric.h）：
 *     XOF=SHAKE256(seed‖0x01)、G=SHA3-512(‖0x00)、I=SHA3-512(‖0x02)、H=SHA3-256(‖0x01)、J=SHA3-256(‖0x03)。
 *   - KAT 的 PRNG 亦为 SHAKE256：SHAKE256(seed48‖0x00)（参考实现 tests/kats/test_kat.c + symmetric.c）。
 *
 * ⚠ 规范 PDF 与参考实现的一处出入：PDF §3.4.2（p.17）写 GF(2^8) 域多项式
 *   1+α²+α³+α⁴+α⁸（=0x11D，已逐字符核对上标，由此推出的 g1(x) 也只在该域下成立）；
 *   而参考实现三档参数头均用 PARAM_GF_POLY=0x11B（x⁸+x⁴+x³+x+1）、α=0x03，RS 生成多项式
 *   在该域下按根 α^1..α^{2δ} 展开与 parameters.h 的 RS_POLY_COEFS 逐字节一致（已数值验证）。
 *   KAT 由参考实现生成，故本实现取 0x11B / α=3 口径（两域仅影响 RS 字节表示，纠错能力等价）。
 *
 * GF(2)[X]/(X^n−1) 乘法用 BigInt 位向量（bit i ↔ x^i 系数）：BigInt 硬件乘法 + x^n≡1 高半段
 * 异或折叠。RS 用 BM+Chien+Forney 代数译码，RM 用快速 Hadamard 变换（Green machine，§3.4.3）。
 *
 * 验证：官方 KAT（kats/ref/PQCkemKAT_*.req/rsp）keyGen/encaps/decaps 逐字节对拍；
 *   解密纠错注入、重量断言见文件尾注释与冒烟记录。
 */

import { register } from "./registry.js";
import { keccakF1600 } from "./hash.js";

// ============================================================
// 字节 / hex 工具
// ============================================================

function hexToBytes(hex) {
  let h = String(hex == null ? "" : hex).replace(/^0x/i, "").replace(/\s+/g, "");
  if (!h) return new Uint8Array(0);
  if (h.length % 2) h = "0" + h;
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error(`含非 hex 字符`);
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

function randomBytes(n) {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    const b = new Uint8Array(n);
    c.getRandomValues(b);
    return b;
  }
  throw new Error("无可用 CSPRNG（crypto.getRandomValues）");
}

// ============================================================
// Keccak 海绵（SHA3-256/512 一次性 + SHAKE256 增量 XOF）
// 复用 hash.js 的 keccakF1600（mlkem.js 先例），支持多次 squeeze。
// ============================================================

class Sponge {
  constructor(rate, padByte) {
    this.rate = rate;
    this.pad = padByte;
    this.sLo = new Array(25).fill(0);
    this.sHi = new Array(25).fill(0);
    this.buf = [];        // 未吸收字节缓存
    this.finalized = false;
    this.outBuf = null;   // squeeze 剩余
    this.outPos = 0;
  }
  absorb(bytes) {
    if (this.finalized) throw new Error("sponge 已 finalize");
    for (const b of bytes) this.buf.push(b);
    while (this.buf.length >= this.rate) this._absorbBlock(this.buf.splice(0, this.rate));
  }
  _absorbBlock(block) {
    for (let i = 0; i < this.rate; i += 8) {
      const li = i >> 3;
      const p = i;
      const lo = (block[p] | (block[p + 1] << 8) | (block[p + 2] << 16) | (block[p + 3] << 24)) >>> 0;
      const hi = (block[p + 4] | (block[p + 5] << 8) | (block[p + 6] << 16) | (block[p + 7] << 24)) >>> 0;
      this.sLo[li] = (this.sLo[li] ^ lo) >>> 0;
      this.sHi[li] = (this.sHi[li] ^ hi) >>> 0;
    }
    keccakF1600(this.sLo, this.sHi);
  }
  finalize() {
    if (this.finalized) return;
    const origLen = this.buf.length; // absorb 保证 < rate
    const block = this.buf.splice(0, origLen);
    while (block.length < this.rate) block.push(0);
    block[origLen] = this.pad;       // 域分隔 + pad10*1
    block[this.rate - 1] |= 0x80;
    this._absorbBlock(block);
    this.finalized = true;
  }
  squeeze(n) {
    this.finalize();
    const out = new Uint8Array(n);
    let produced = 0;
    while (produced < n) {
      if (this.outPos >= this.rate) {
        keccakF1600(this.sLo, this.sHi);
        this.outPos = 0;
      }
      const i = this.outPos;
      const laneIdx = (i - (i % 8)) >> 3;
      const bil = i & 7;
      const word = bil < 4 ? this.sLo[laneIdx] : this.sHi[laneIdx];
      out[produced++] = (word >>> ((bil & 3) * 8)) & 0xff;
      this.outPos++;
    }
    return out;
  }
}

/** HQC XOF：SHAKE256(seed ‖ 0x01)（§3.1 Table 1 + symmetric.c HQC_XOF_DOMAIN=1） */
function xofInit(seed) {
  const s = new Sponge(136, 0x1f);
  s.absorb(seed);
  s.absorb(new Uint8Array([0x01]));
  return s;
}

/** H = SHA3-256(str ‖ 0x01)；J = SHA3-256(str ‖ 0x03) */
const hashH = (str) => { const s = new Sponge(136, 0x06); s.absorb(str); s.absorb(new Uint8Array([0x01])); return s.squeeze(32); };
const hashJ = (str) => { const s = new Sponge(136, 0x06); s.absorb(str); s.absorb(new Uint8Array([0x03])); return s.squeeze(32); };
/** G = SHA3-512(str ‖ 0x00)；I = SHA3-512(str ‖ 0x02) */
const hashG = (str) => { const s = new Sponge(72, 0x06); s.absorb(str); s.absorb(new Uint8Array([0x00])); return s.squeeze(64); };
const hashI = (str) => { const s = new Sponge(72, 0x06); s.absorb(str); s.absorb(new Uint8Array([0x02])); return s.squeeze(64); };

// ============================================================
// GF(2^8)：域多项式 x^8+x^4+x^3+x+1 (0x11B)，生成元 α=3（参考实现 gf.h 口径）
// ============================================================

const GF_EXP = new Uint16Array(512); // 双倍长度：gfMul 的 LOG 和最大 508（参考实现 exp[258] 同理）
const GF_LOG = new Uint16Array(256);
(function buildGF() {
  let e = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = e;
    GF_LOG[e] = i;
    // e *= α(=3)：无进位乘法 + mod 0x11B（积 < 2^9，两轮约减足够）
    let p = e, acc = 0, m = 3;
    while (m) { if (m & 1) acc ^= p; p <<= 1; m >>= 1; }
    if (acc & 0x200) acc ^= 0x11B << 1;
    if (acc & 0x100) acc ^= 0x11B;
    e = acc;
  }
  GF_EXP[255] = 1;
  for (let i = 256; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
const gfInv = (a) => (a === 0) ? 0 : GF_EXP[255 - GF_LOG[a]];
const gfPow = (a, e) => (a === 0) ? 0 : GF_EXP[(GF_LOG[a] * e) % 255];

// RS 生成多项式 g(x) = Π_{i=1..2δ} (x + α^i)，升幂系数（已在 GF(0x11B, α=3) 下对拍
// hqc-1 参数头 RS_POLY_COEFS = 74,81,...,1）。按参数集惰性生成并缓存。
const _rsPolyCache = new Map();
function rsGenPoly(delta) {
  if (_rsPolyCache.has(delta)) return _rsPolyCache.get(delta);
  let poly = [1];
  for (let i = 1; i <= 2 * delta; i++) {
    const a = GF_EXP[i % 255];
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= gfMul(poly[j], a);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  _rsPolyCache.set(delta, poly);
  return poly;
}

// ============================================================
// 环 GF(2)[X]/(X^n−1)：BigInt 位向量（bit i ↔ x^i 系数）
// ============================================================

/** 无进位乘法（BigInt 原生乘法即逐位异或展开的卷积）。 */
function gf2Mul(a, b) {
  let r = 0n;
  while (b) {
    if (b & 1n) r ^= a;
    a <<= 1n;
    b >>= 1n;
  }
  return r;
}

/** R2 乘法：x^n ≡ 1，积的高半段（≥n 次项）折叠异或回低 n 位。 */
function r2Mul(a, b, n, maskN) {
  const p = gf2Mul(a, b);
  return (p & maskN) ^ (p >> BigInt(n));
}

/** 位向量 → 字节（LSB 先行，与参考实现 uint64 小端布局一致）。 */
function bitsToBytes(v, nBytes) {
  const out = new Uint8Array(nBytes);
  for (let i = 0; i < nBytes; i++) out[i] = Number((v >> BigInt(8 * i)) & 0xffn);
  return out;
}

/** 字节 → 位向量（LSB 先行）。 */
function bytesToBits(bytes) {
  let v = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]);
  return v;
}

function getBit(bytes, i) {
  return (bytes[i >> 3] >> (i & 7)) & 1;
}

function setBit(bytes, i) {
  bytes[i >> 3] |= 1 << (i & 7);
}

// ============================================================
// 参数集（规范 Table 5/6, p.29；参考实现 src/ref/hqc-{1,3,5}/parameters.h）
// threshold = ⌊2^24/n⌋·n（SampleFixedWeightVect$ 拒绝阈值，vector.c）
// ============================================================

const PARAM_SETS = {
  "128": {
    id: "HQC-1", n: 17669, n1: 46, n2: 384, k: 16, omega: 66, omegaR: 75, omegaE: 75,
    sec: 16, delta: 15, threshold: 949 * 17669, // 16767881
  },
  "192": {
    id: "HQC-3", n: 35851, n1: 56, n2: 640, k: 24, omega: 100, omegaR: 114, omegaE: 114,
    sec: 24, delta: 16, threshold: 467 * 35851, // 16742417
  },
  "256": {
    id: "HQC-5", n: 57637, n1: 90, n2: 640, k: 32, omega: 131, omegaR: 149, omegaE: 149,
    sec: 32, delta: 29, threshold: 291 * 57637, // 16772367
  },
};

function getSet(key) {
  const name = String(key == null ? "128" : key).replace(/^(HQC-|hqc-)/, "").trim();
  const s = PARAM_SETS[name];
  if (!s) throw new Error(`未知参数集: ${key}（可选 HQC-128 / 192 / 256）`);
  const nBytes = Math.ceil(s.n / 8);
  const n1n2Bytes = Math.ceil((s.n1 * s.n2) / 8);
  const mult = Math.ceil(s.n2 / 128); // RM 重复次数（Table 4）
  return {
    ...s, name, nBytes, n1n2Bytes, mult,
    ekLen: 32 + nBytes,
    dkLen: 32 + nBytes + 32 + s.sec + 32, // ek ‖ seed_dk(32) ‖ σ(sec) ‖ seed_kem(32)
    ctLen: nBytes + n1n2Bytes + 16,       // u ‖ v ‖ salt(16)
  };
}

// ============================================================
// 采样（§3.2 p.13–14；参考实现 vector.c）
// ============================================================

/**
 * SampleFixedWeightVect$（keygen 用 x,y）：无偏拒绝采样。
 * 每次取 3 字节 LE 24 位候选，≥ threshold 拒绝，否则 mod n；重复支持位置重采样。
 */
function sampleFixedWeight1(ctx, weight, set) {
  const support = [];
  while (support.length < weight) {
    const b = ctx.squeeze(3);
    const cand = b[0] | (b[1] << 8) | (b[2] << 16);
    if (cand >= set.threshold) continue;
    const pos = cand % set.n;
    if (!support.includes(pos)) support.push(pos);
  }
  return support;
}

/**
 * SampleFixedWeightVect（加密用 r1,r2,e）：Algorithm 5 [eprint 2021/1631]，轻微偏置但常数时间。
 * support[i] = i + ⌊u_i·(n−i)/2^32⌋（u_i 为 4 字节 LE uint32），随后自后向前消除冲突（冲突位置取 i）。
 */
function sampleFixedWeight2(ctx, weight, set) {
  const raw = ctx.squeeze(4 * weight);
  const support = new Array(weight);
  for (let i = 0; i < weight; i++) {
    const u = raw[4 * i] | (raw[4 * i + 1] << 8) | (raw[4 * i + 2] << 16) | (raw[4 * i + 3] << 24);
    support[i] = i + Number((BigInt(u >>> 0) * BigInt(set.n - i)) >> 32n);
  }
  for (let i = weight - 2; i >= 0; i--) {
    let found = false;
    for (let j = i + 1; j < weight; j++) {
      if (support[j] === support[i]) { found = true; break; }
    }
    if (found) support[i] = i;
  }
  return support;
}

/** 支持集 → 位向量 BigInt。 */
function supportToBits(support) {
  let v = 0n;
  for (const p of support) v |= (1n << BigInt(p));
  return v;
}

/** vect_set_random：XOF 取 ⌈n/8⌉ 字节，截断到 n 位（LSB 先行）。 */
function sampleUniform(ctx, set) {
  const bytes = ctx.squeeze(set.nBytes);
  let v = bytesToBits(bytes);
  v &= (1n << BigInt(set.n)) - 1n;
  return v;
}

// ============================================================
// Reed-Solomon（缩短码 RS-S: [n1,k,2δ+1] over GF(2^8)，§3.4.2 p.17–20）
// 系统编码 c(x) = b(x) + x^{n1−k}·u(x)，b = x^{n1−k}·u mod g；译码 BM+Chien+Forney。
// 字节序：cdw[0] 为常数项，msg 占高 k 位（cdw[n1−k..n1−1]，u0 在 cdw[n1−k]）。
// ============================================================

function rsEncode(msgBytes, set) {
  const { n1, k, delta } = set;
  const g = rsGenPoly(delta);
  const cdw = new Uint8Array(n1);
  const nkp = n1 - k;
  for (let i = 0; i < k; i++) {
    const gate = msgBytes[k - 1 - i] ^ cdw[nkp - 1];
    const t = new Array(g.length);
    for (let j = 0; j < g.length; j++) t[j] = gfMul(gate, g[j]);
    for (let j = nkp - 1; j >= 1; j--) cdw[j] = cdw[j - 1] ^ t[j];
    cdw[0] = t[0];
  }
  cdw.set(msgBytes, nkp);
  return cdw;
}

/** 计算 S_i = r(α^i)，i=1..2δ。 */
function rsSyndromes(cdw, set) {
  const { n1, delta } = set;
  const S = new Array(2 * delta).fill(0);
  for (let i = 0; i < 2 * delta; i++) {
    // α^{i+1} 的逐位幂
    let ap = GF_EXP[(i + 1) % 255];
    let acc = cdw[0];
    for (let j = 1; j < n1; j++) {
      acc ^= gfMul(cdw[j], ap);
      ap = GF_EXP[(GF_LOG[ap] + i + 1) % 255];
    }
    S[i] = acc;
  }
  return S;
}

/** BM 迭代求错误位置多项式 Λ（升幂系数）。返回 { lambda, deg }，deg>δ 表示超出纠错能力。 */
function rsBerlekampMassey(S, set) {
  const { delta } = set;
  let lambda = [1], B = [1], L = 0, m = 1, b = 1;
  for (let i = 0; i < 2 * delta; i++) {
    // 差值 d = S_i + Σ_{j=1..L} λ_j·S_{i−j}
    let d = S[i];
    for (let j = 1; j <= L; j++) d ^= gfMul(lambda[j] || 0, S[i - j]);
    if (d === 0) { m++; continue; }
    const coef = gfMul(d, gfInv(b));
    const shift = new Array(m).fill(0).concat(B); // x^m·B
    const maxLen = Math.max(lambda.length, shift.length);
    if (2 * L <= i) {
      const newL = lambda.slice();
      while (newL.length < maxLen) newL.push(0);
      for (let j = 0; j < shift.length; j++) newL[j] ^= gfMul(coef, shift[j]);
      B = lambda; L = i + 1 - L; lambda = newL; m = 1; b = d;
    } else {
      const newL = lambda.slice();
      while (newL.length < maxLen) newL.push(0);
      for (let j = 0; j < shift.length; j++) newL[j] ^= gfMul(coef, shift[j]);
      lambda = newL; m++;
    }
  }
  // deg
  let deg = 0;
  for (let j = lambda.length - 1; j > 0; j--) if (lambda[j]) { deg = j; break; }
  return { lambda, deg };
}

/** Chien 搜索：位置 j（β=α^j）为错位 ⟺ Λ(β^{−1})=0。 */
function rsChien(lambda, set) {
  const { n1 } = set;
  const positions = [];
  for (let j = 0; j < n1; j++) {
    // Λ(α^{−j})
    let acc = 0;
    for (let d = 0; d < lambda.length; d++) {
      if (lambda[d]) acc ^= gfMul(lambda[d], GF_EXP[((255 - (j * d) % 255)) % 255]);
    }
    if (acc === 0) positions.push(j);
  }
  return positions;
}

/**
 * Forney 求错误值：e_j = Ω(β_j^{−1}) / Λ'(β_j^{−1})，Ω = [S(x)·Λ(x)] mod x^{2δ}
 * （S(x) = Σ_{i=1..2δ} S_i x^{i−1}；syndrome 起点 b=1，故无 β^{1−b} 因子）。
 */
function rsForney(lambda, S, positions, set) {
  const { delta } = set;
  // Ω_i = Σ_{j} λ_j·S_{i−j+1}（0 基展开），i=0..2δ−1
  const omega = new Array(2 * delta).fill(0);
  for (let i = 0; i < 2 * delta; i++) {
    let acc = 0;
    for (let j = 0; j <= i && j < lambda.length; j++) {
      if (lambda[j]) acc ^= gfMul(lambda[j], S[i - j]);
    }
    omega[i] = acc;
  }
  // Λ' = 奇次项下移一位
  const dlambda = [];
  for (let d = 1; d < lambda.length; d += 2) dlambda[(d - 1) / 2] = lambda[d];
  const values = new Array(n1Safe(set)).fill(0);
  for (const j of positions) {
    const betaInv = GF_EXP[(255 - (j % 255)) % 255];
    // Ω(β^{-1})
    let om = 0;
    for (let d = 0; d < omega.length; d++) {
      if (omega[d]) om ^= gfMul(omega[d], GF_EXP[(255 - (j * d) % 255) % 255]);
    }
    // Λ'(β^{-1})：Λ' 的 d 次项系数 = λ_{d+1}（d 为偶数），求值幂为 α^{-jd}
    let dl = 0;
    for (let d = 0; d < dlambda.length; d++) {
      if (dlambda[d]) dl ^= gfMul(dlambda[d], GF_EXP[(255 - (j * 2 * d) % 255) % 255]);
    }
    if (dl === 0) return null; // 不可纠正
    values[j] = gfMul(om, gfInv(dl));
  }
  return values;
}

function n1Safe(set) { return set.n1; }

/**
 * RS 译码：返回纠正后的消息 k 字节；超出纠错能力返回 null（上层走隐式拒绝）。
 */
function rsDecode(cdw, set) {
  const { n1, k } = set;
  const S = rsSyndromes(cdw, set);
  if (S.every((s) => s === 0)) return cdw.slice(n1 - k);
  const { lambda, deg } = rsBerlekampMassey(S, set);
  if (deg > set.delta) return null;
  const positions = rsChien(lambda, set);
  if (positions.length !== deg) return null; // 根数与次数不符 → 超能力
  const values = rsForney(lambda, S, positions, set);
  if (!values) return null;
  const corrected = cdw.slice();
  for (const j of positions) corrected[j] ^= values[j];
  // 纠正后应零伴随；否则超能力
  const S2 = rsSyndromes(corrected, set);
  if (!S2.every((s) => s === 0)) return null;
  return corrected.slice(n1 - k);
}

// ============================================================
// Reed-Muller RM(1,7)=[128,8,64] 重复码（§3.4.3 p.21–22；reed_muller.c）
// 码位 p(v) = b7 ⊕ parity(b·v)，v 为 7 位求值点 = 128 位码字内位置的二进制（LSB=bit0）。
// 重复 M 倍：消息字节 i 占码位 [ (i·M)·128, (i·M+M)·128 )。
// ============================================================

const PARITY = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let c = 0, x = i;
    while (x) { c ^= x & 1; x >>= 1; }
    t[i] = c;
  }
  return t;
})();

/** 拼接码编码：RS 系统码 n1 字节 → 每字节 RM(1,7) 展开 M 倍 → n1·n2 位。返回位向量 BigInt。 */
function codeEncode(mBytes, set) {
  const rsCdw = rsEncode(mBytes, set);
  const { mult, n1 } = set;
  let em = 0n;
  for (let i = 0; i < n1; i++) {
    const b = rsCdw[i];
    let blk = 0n;
    for (let k = 127; k >= 0; k--) {
      blk <<= 1n;
      blk |= BigInt((b >> 7 & 1) ^ PARITY[b & k]);
    }
    // 消息字节 i 占 M 份连续 128 位块（reed_muller.c: pos = i * MULTIPLICITY）
    for (let c = 0; c < mult; c++) {
      em |= blk << BigInt((i * mult + c) * 128);
    }
  }
  return em;
}

/** 快速 Hadamard 变换（7 级蝶形，Green machine 第一相）。 */
function walshHadamard(a) {
  let h = 1;
  while (h < 128) {
    for (let i = 0; i < 128; i += h * 2) {
      for (let j = i; j < i + h; j++) {
        const x = a[j], y = a[j + h];
        a[j] = x + y;
        a[j + h] = x - y;
      }
    }
    h *= 2;
  }
}

/**
 * 拼接码译码：逐字节对 M 份 128 位块求和 → WHT → T[0] −= 64M → 找 |T| 最大处
 * （同值取最低 7 位索引），正峰置 bit7。之后 RS 译码。
 * 返回 k 字节消息；超出纠错能力返回 null。
 */
function codeDecode(emBits, set) {
  const { mult, n1 } = set;
  const em = bitsToBytes(emBits, set.n1n2Bytes); // 一次性转字节，位测试 O(1)
  const msg = new Uint8Array(n1);
  for (let i = 0; i < n1; i++) {
    const t = new Array(128).fill(0);
    for (let copy = 0; copy < mult; copy++) {
      const base = (i * mult + copy) * 128;
      for (let k = 0; k < 128; k++) {
        t[k] += getBit(em, base + k);
      }
    }
    walshHadamard(t);
    t[0] -= 64 * mult;
    let peakAbs = -1, peakVal = 0, peakPos = 0;
    for (let k = 0; k < 128; k++) {
      const abs = t[k] < 0 ? -t[k] : t[k];
      if (abs > peakAbs) { peakAbs = abs; peakVal = t[k]; peakPos = k; }
    }
    msg[i] = peakPos | (peakVal > 0 ? 128 : 0);
  }
  return rsDecode(msg, set);
}

// ============================================================
// HQC-PKE（规范 p.23–25；hqc.c）
// ============================================================

/** HQC-PKE.Keygen(seed_pke) → { ek(ekLen B), seedDk(32 B), x, y }（x,y 供内部/教学） */
function pkeKeygen(seedPke, set) {
  if (seedPke.length !== 32) throw new Error("seed_pke 须为 32 字节");
  const pairSeed = hashI(seedPke); // 64B：[0:32]=seed_dk，[32:64]=seed_ek
  const seedDk = pairSeed.slice(0, 32);
  const seedEk = pairSeed.slice(32);

  const ctxDk = xofInit(seedDk);
  const ySup = sampleFixedWeight1(ctxDk, set.omega, set);
  const xSup = sampleFixedWeight1(ctxDk, set.omega, set);
  const y = supportToBits(ySup);
  const x = supportToBits(xSup);

  const ctxEk = xofInit(seedEk);
  const h = sampleUniform(ctxEk, set);

  const maskN = (1n << BigInt(set.n)) - 1n;
  const s = ((gf2Mul(h, y) & maskN) ^ (gf2Mul(h, y) >> BigInt(set.n))) ^ x; // s = x + h·y

  const ek = concatBytes(seedEk, bitsToBytes(s, set.nBytes));
  return { ek, seedDk, h, s, x, y };
}

/** HQC-PKE.Encrypt(ek, m(k B), θ(32 B)) → { u: BigInt, v: BigInt } */
function pkeEncrypt(ek, mBytes, theta, set) {
  if (ek.length !== set.ekLen) throw new Error(`ek 长度错误：${set.id} 应为 ${set.ekLen} 字节，实得 ${ek.length}`);
  if (mBytes.length !== set.k) throw new Error(`m 须为 ${set.k} 字节`);
  if (theta.length !== 32) throw new Error("θ 须为 32 字节");

  const ctx = xofInit(theta);
  const r2 = supportToBits(sampleFixedWeight2(ctx, set.omegaR, set));
  const e = supportToBits(sampleFixedWeight2(ctx, set.omegaE, set));
  const r1 = supportToBits(sampleFixedWeight2(ctx, set.omegaR, set));

  const ctxEk = xofInit(ek.slice(0, 32));
  const h = sampleUniform(ctxEk, set);
  const s = bytesToBits(ek.slice(32));

  const maskN = (1n << BigInt(set.n)) - 1n;
  const N = BigInt(set.n);
  const hr2 = gf2Mul(h, r2);
  const u = ((hr2 & maskN) ^ (hr2 >> N)) ^ r1; // u = r1 + h·r2
  const sr2 = gf2Mul(s, r2);
  let err = ((sr2 & maskN) ^ (sr2 >> N)) ^ e;  // s·r2 + e
  const maskL = (1n << BigInt(set.n1 * set.n2)) - 1n;
  err &= maskL;                                 // Truncate(·, ℓ=n1·n2)
  const v = codeEncode(mBytes, set) ^ err;
  return { u, v };
}

/** HQC-PKE.Decrypt(dk(seed_dk 32 B), (u,v)) → k 字节消息，超纠错能力返回 null */
function pkeDecrypt(seedDk, u, v, set) {
  if (seedDk.length !== 32) throw new Error("dk_pke 须为 32 字节 seed");
  const ctx = xofInit(seedDk);
  const y = supportToBits(sampleFixedWeight1(ctx, set.omega, set));
  const maskN = (1n << BigInt(set.n)) - 1n;
  const N = BigInt(set.n);
  const uy = gf2Mul(u, y);
  const t = ((uy & maskN) ^ (uy >> N)) & ((1n << BigInt(set.n1 * set.n2)) - 1n);
  return codeDecode(v ^ t, set);
}

// ============================================================
// HQC-KEM（§3.6 p.26–28；kem.c）
// ============================================================

/**
 * HQC-KEM.Keygen。seedKem 留空随机（32B）。
 * 返回 { set, ek, dk, seedKem, seedPke, sigma }（dk = ek ‖ seed_dk ‖ σ ‖ seed_kem）。
 */
export function hqcKeyGenBytes(setKey, seedKem) {
  const set = getSet(setKey);
  seedKem = seedKem == null || String(seedKem).trim() === "" ? randomBytes(32) : hexToBytes(seedKem);
  if (seedKem.length !== 32) throw new Error(`seed_kem 须为 32 字节 hex（当前 ${seedKem.length} 字节）`);

  const ctx = xofInit(seedKem);
  const seedPke = ctx.squeeze(32);
  const sigma = ctx.squeeze(set.sec);

  const { ek, seedDk } = pkeKeygen(seedPke, set);
  const dk = concatBytes(ek, seedDk, sigma, seedKem);
  return { set, ek, dk, seedKem, seedPke, sigma };
}

/**
 * HQC-KEM.Encaps(ek)。m/salt 留空随机（m=k 字节、salt=16B），可填 hex 固定复现。
 * 返回 { set, m, salt, ct(u‖v‖salt), ss }。
 */
export function hqcEncapsBytes(setKey, ek, m, salt) {
  const set = getSet(setKey);
  ek = hexToBytes(ek);
  if (ek.length !== set.ekLen) throw new Error(`ek 长度错误：${set.id} 应为 ${set.ekLen} 字节，实得 ${ek.length}`);
  m = m == null || String(m).trim() === "" ? randomBytes(set.k) : hexToBytes(m);
  if (m.length !== set.k) throw new Error(`m 须为 ${set.k} 字节（${set.id} 的 k=${set.k}），实得 ${m.length}`);
  salt = salt == null || String(salt).trim() === "" ? randomBytes(16) : hexToBytes(salt);
  if (salt.length !== 16) throw new Error(`salt 须为 16 字节，实得 ${salt.length}`);

  const hEk = hashH(ek);
  const kt = hashG(concatBytes(hEk, m, salt));
  const ss = kt.slice(0, 32);
  const theta = kt.slice(32);

  const { u, v } = pkeEncrypt(ek, m, theta, set);
  const ct = concatBytes(bitsToBytes(u, set.nBytes), bitsToBytes(v, set.n1n2Bytes), salt);
  return { set, m, salt, ct, ss };
}

/**
 * HQC-KEM.Decaps(dk, ct)。FO 隐式拒绝：重加密不符时返回 K̄ = J(H(ek)‖σ‖c)。
 * 返回 { set, ss, implicit, m(成功时 k 字节), mHex }。
 */
export function hqcDecapsBytes(setKey, dk, ct) {
  const set = getSet(setKey);
  dk = hexToBytes(dk);
  ct = hexToBytes(ct);
  if (dk.length !== set.dkLen) throw new Error(`dk 长度错误：${set.id} 应为 ${set.dkLen} 字节，实得 ${dk.length}`);
  if (ct.length !== set.ctLen) throw new Error(`密文长度错误：${set.id} 应为 ${set.ctLen} 字节，实得 ${ct.length}`);

  const ek = dk.slice(0, set.ekLen);
  const seedDk = dk.slice(set.ekLen, set.ekLen + 32);
  const sigma = dk.slice(set.ekLen + 32, set.ekLen + 32 + set.sec);

  const uBytes = ct.slice(0, set.nBytes);
  const vBytes = ct.slice(set.nBytes, set.nBytes + set.n1n2Bytes);
  const salt = ct.slice(set.nBytes + set.n1n2Bytes);

  const u = bytesToBits(uBytes);
  const v = bytesToBits(vBytes);
  const m2 = pkeDecrypt(seedDk, u, v, set);

  const hEk = hashH(ek);
  let ss, implicit = false;
  if (m2) {
    const kt = hashG(concatBytes(hEk, m2, salt));
    const k2 = kt.slice(0, 32);
    const theta = kt.slice(32);
    const re = pkeEncrypt(ek, m2, theta, set);
    const reCt = concatBytes(bitsToBytes(re.u, set.nBytes), bitsToBytes(re.v, set.n1n2Bytes), salt);
    if (bytesEqual(reCt, ct)) {
      ss = k2;
    } else {
      implicit = true;
      ss = hashJ(concatBytes(hEk, sigma, uBytes, vBytes, salt));
    }
  } else {
    // PKE 译码失败（m′ = ⊥）→ 隐式拒绝
    implicit = true;
    ss = hashJ(concatBytes(hEk, sigma, uBytes, vBytes, salt));
  }
  return { set, ss, implicit, m: implicit ? null : m2, mHex: implicit ? null : bytesToHex(m2) };
}

// ============================================================
// op 包装（cat: asym；hex 口径；明文长度受 k 限制 = 16/24/32 字节）
// ============================================================

const SET_OPTIONS = ["128", "192", "256"];

register({
  id: "hqcKeyGen", family: "hqc", familyLabel: "keygen",
  cat: "asym",
  name: "HQC 密钥生成",
  desc: "HQC-128/192/256（NIST 第四轮后量子 KEM，基于准循环伴随式译码）密钥对生成，seed 可固定复现。纯 JS 实现",
  params: [
    { key: "set", label: "参数集", type: "select", default: "128", options: SET_OPTIONS },
    { key: "seed", label: "seed_kem (hex 32B，留空随机)", type: "text", default: "", placeholder: "教学复现可固定" },
  ],
  run: (t, p = {}) => {
    const r = hqcKeyGenBytes(p.set, p.seed);
    const s = r.set;
    return {
      text: [
        `参数集: ${s.id} (n=${s.n}, n1=${s.n1}, n2=${s.n2}, k=${s.k}, ω=${s.omega}, ωr=ωe=${s.omegaR}, RS δ=${s.delta})`,
        `公钥 ek (${r.ek.length} B = seed_ek(32) ‖ s(${s.nBytes})):`,
        bytesToHex(r.ek),
        `私钥 dk (${r.dk.length} B = ek ‖ seed_dk(32) ‖ σ(${s.sec}) ‖ seed_kem(32)):`,
        bytesToHex(r.dk),
        `seed_kem: ${bytesToHex(r.seedKem)}`,
        "",
        "ek 可直接粘到「HQC 加密」，dk 粘到「HQC 解密」。dk ⚠ 敏感请妥善保管。点击下方按钮下载（hex 文本）。",
      ].join("\n"),
      files: [
        { name: `hqc${r.set.name}_ek.pub.hex`, mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(r.ek) + "\n") },
        { name: `hqc${r.set.name}_dk.priv.hex`, mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(r.dk) + "\n") },
      ],
    };
  },
});

register({
  id: "hqcEncrypt", family: "hqc", familyLabel: "encrypt",
  cat: "asym",
  name: "HQC 加密",
  desc: "HQC KEM 封装：明文（≤k 字节，右补零）封装为密文 c=u‖v‖salt 与共享密钥 SS(32B)；m/salt 可固定复现（SFO 变换口径）",
  params: [
    { key: "set", label: "参数集", type: "select", default: "128", options: SET_OPTIONS },
    { key: "ek", label: "公钥 ek (hex)", type: "text", default: "", placeholder: "密钥生成输出的 ek hex" },
    { key: "salt", label: "salt (hex 16B，留空随机)", type: "text", default: "", placeholder: "教学复现可固定" },
  ],
  run: (t, p = {}) => {
    const set = getSet(p.set);
    if (!t || !String(t).length) throw new Error(`请输入明文（≤ ${set.k} 字节，超长先自行对称压缩/分片）`);
    const ptBytes = new TextEncoder().encode(String(t));
    if (ptBytes.length > set.k) {
      throw new Error(`明文过长：${set.id} 的 k=${set.k} 字节，当前 ${ptBytes.length} 字节。HQC 是 KEM——任意长数据请用 SS 作对称密钥（如 AES-CTR）先行封装`);
    }
    const m = new Uint8Array(set.k);
    m.set(ptBytes); // 右补零到 k 字节（规范 m 恰为 k 字节）
    const r = hqcEncapsBytes(p.set, p.ek, bytesToHex(m), p.salt);
    return {
      text: [
        `参数集: ${r.set.id}`,
        `明文 m (${set.k} B，右补零): ${bytesToHex(m)}`,
        `密文 c (${r.ct.length} B = u(${set.nBytes}) ‖ v(${set.n1n2Bytes}) ‖ salt(16)):`,
        bytesToHex(r.ct),
        `共享密钥 SS (32 B):`,
        bytesToHex(r.ss),
        "",
        "SS 即共享密钥（32B hex）。解密端用 dk + 密文 c 恢复。密文已生成下载按钮（hex 文本）。",
      ].join("\n"),
      files: [
        { name: `hqc${r.set.id}_ct.hex`, mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(r.ct) + "\n") },
        { name: `hqc${r.set.id}_ss.hex`, mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(r.ss) + "\n") },
      ],
    };
  },
});

register({
  id: "hqcDecrypt", family: "hqc", familyLabel: "decrypt",
  cat: "asym",
  name: "HQC 解密",
  desc: "HQC KEM 解封装：输入私钥 dk + 密文 c，输出共享密钥 SS(32B) 与明文；密文篡改走隐式拒绝返回伪随机 K̄（含纠错译码）",
  params: [
    { key: "set", label: "参数集", type: "select", default: "128", options: SET_OPTIONS },
    { key: "dk", label: "私钥 dk (hex)", type: "text", default: "", placeholder: "密钥生成输出的 dk hex" },
  ],
  run: (t, p = {}) => {
    const r = hqcDecapsBytes(p.set, p.dk, t);
    const lines = [
      `参数集: ${r.set.id}`,
      `共享密钥 SS (32 B):`,
      bytesToHex(r.ss),
    ];
    if (r.implicit) {
      lines.push("注: 隐式拒绝路径（重加密密文不符或译码失败，SS = K̄ = J(H(ek)‖σ‖c) 伪随机值）");
    } else {
      let end = r.m.length;
      while (end > 0 && r.m[end - 1] === 0) end--; // 去除右补零
      const text = new TextDecoder().decode(r.m.slice(0, end));
      lines.push(
        `明文 m (${r.m.length} B): ${r.mHex}`,
        `明文 (utf-8，去除右补零): ${text}`
      );
    }
    return lines.join("\n");
  },
});

// ============================================================
// 内部函数导出（冒烟测试 / KAT 对拍 / 教学复现用；不改 op 行为）
// ============================================================
export const __hqcInternal = {
  getSet, PARAM_SETS, xofInit, hashH, hashG, hashI, hashJ,
  GF_EXP, GF_LOG, gfMul, rsGenPoly,
  sampleFixedWeight1, sampleFixedWeight2, sampleUniform,
  rsEncode, rsDecode, rsSyndromes, codeEncode, codeDecode,
  pkeKeygen, pkeEncrypt, pkeDecrypt,
  bytesToHex, hexToBytes, bytesToBits, bitsToBytes,
};

/** KAT 用 PRNG：SHAKE256(seed ‖ 0x00)（symmetric.c prng_init 的 HQC_PRNG_DOMAIN=0 域）。 */
export function hqcKatPrng(seed48) {
  const s = new Sponge(136, 0x1f);
  s.absorb(seed48);
  s.absorb(new Uint8Array([0x00]));
  return s;
}
