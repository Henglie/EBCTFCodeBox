/*
 * falconKeygen.js — Falcon（FN-DSA）密钥生成：采样 f, g → Berd 判界 → NTRU 方程求解 → 公钥 h。
 *
 * 依据（逐式对照，来源 URL 与访问日期见证据目录 SOURCES.md）：
 *   - 规范：Falcon Specification v1.2 §3.8（密钥生成）、算法 5/6/7（NTRU 求解递归）、
 *     §3.6（Berd，向量 (q·adj(f)/(f·adj(f)+g·adj(g)), q·adj(g)/(…)) 的范数上界 1.17²·q）。
 *   - 官方 C 参考实现（Reference_Implementation/falcon512/falcon512int）：
 *       keygen.c  mkgauss / poly_small_mkgauss / Berd 判界 / solve_NTRU_*；
 *       fft.c     FFT / iFFT / poly_LDL_fft / poly_split_fft / poly_merge_fft 等；
 *       codec.c   comp_encode / modq_encode / max_fg_bits / max_FG_bits。
 *
 * 数值域：FFT 全程 Float64Array（IEEE-754 双精度），与规范的 fpr（53 bit 尾数）同精度；
 * 大整数（NTRU 求解的中间多项式）用 BigInt 精确整数，不引入浮点误差。
 *
 * 与既有「Falcon 验签」的关系：本模块只做生成，不重复实现验签；产出的 (公钥, 签名) 由
 * falconVerify.js 独立验收。公钥编码、压缩系数编码的位序与 falconVerify.js 的解析口径一致。
 *
 * 随机源：统一随机层 randSource.randomBytes（不直接调 crypto.getRandomValues）。
 * 若显式给出 seed（hex），则整条采样流由 seed 决定，可复现同一密钥对（仅供对拍/教学）。
 */

import { register } from "./registry.js";
import { keccak } from "./hash.js";
import { randomBytes } from "./randSource.js";

export const FALCON_Q = 12289;
const Q = FALCON_Q;
const MASK63 = (1n << 63n) - 1n;

// 参考实现 fpr.h 的 double 位型按十进制全精度回写（Python struct 解码，见证据目录）
const FPR_INV_2SQRSIGMA0 = 0.15086504887537272;
const FPR_BNORM_MAX = 16822.4121; // (1.17^2)·q
const FPR_INVSQRT2 = 0.7071067811865476;
const FPR_INVSQRT8 = 0.3535533905932738;

// max_fg_bits / max_FG_bits（codec.c）：限制系数范围，保证私钥可编码
const MAX_FG_BITS = [0, 8, 8, 8, 8, 8, 7, 7, 6, 6, 5];
const MAX_FG_BITS_FG = [0, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8];

// 参考实现 keygen.c gauss_1024_12289：D(x)=exp(-x²/(2σ²))，σ=1.17·sqrt(q/2048)，按 2^63 定标
const GAUSS_1024_12289 = [
  1283868770400643928n, 6416574995475331444n, 4078260278032692663n,
  2353523259288686585n, 1227179971273316331n, 575931623374121527n,
  242543240509105209n, 91437049221049666n, 30799446349977173n,
  9255276791179340n, 2478152334826140n, 590642893610164n,
  125206034929641n, 23590435911403n, 3948334035941n,
  586753615614n, 77391054539n, 9056793210n,
  940121950n, 86539696n, 7062824n,
  510971n, 32764n, 1862n,
  94n, 4n, 0n,
];

function fail(msg, cause) {
  const e = new Error(`Falcon 密钥生成失败：${msg}`);
  if (cause !== undefined) e.cause = cause;
  return e;
}

function toHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

function hexToBytes(hex, label) {
  const s = String(hex == null ? "" : hex).trim().replace(/^0x/i, "").replace(/[\s:]+/g, "");
  if (!s || s.length % 2 || /[^0-9a-fA-F]/.test(s)) {
    throw fail(`${label} 须为偶数个 hex 字符（收到 ${s.length} 个）`);
  }
  return Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.substr(i * 2, 2), 16));
}

// ============================================================
// SHAKE256 字节流（海绵复用 hash.js 的 Keccak-f[1600]）
// ============================================================

class ShakeStream {
  constructor(seed, chunkBytes) {
    if (!(seed instanceof Uint8Array) || seed.length === 0) {
      throw fail("SHAKE 种子必须是非空字节串");
    }
    this.seed = seed;
    this.chunk = chunkBytes || 4096;
    this.buf = new Uint8Array(0);
    this.pos = 0;
    this.round = 0;
  }

  _ensure(n) {
    if (this.pos + n <= this.buf.length) return;
    this.round += 1;
    const total = this.chunk * this.round;
    const all = keccak(136, 0x1f, this.seed, total);
    this.buf = all.subarray(this.chunk * (this.round - 1));
    this.pos = 0;
  }

  bytes(n) {
    const out = new Uint8Array(n);
    let off = 0;
    while (off < n) {
      this._ensure(1);
      const take = Math.min(n - off, this.buf.length - this.pos);
      out.set(this.buf.subarray(this.pos, this.pos + take), off);
      this.pos += take;
      off += take;
    }
    return out;
  }

  // 8 字节小端 → BigInt（与参考实现 get_rng_u64 的字节序一致）
  u64big() {
    const b = this.bytes(8);
    let v = 0n;
    for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(b[i]);
    return v;
  }
}

export function shakeStream(seed) {
  return new ShakeStream(seed);
}

// ============================================================
// FFT（fft.c 逐行移植；实数多项式用长度 n 的 Float64Array，
// 前 n/2 存实部、后 n/2 存虚部，点为 w^rev(k)，w = exp(iπ/n)）
// ============================================================

const _gmCache = new Map();

function revBits(k, bits) {
  let r = 0;
  for (let i = 0; i < bits; i++) {
    r = (r << 1) | (k & 1);
    k >>= 1;
  }
  return r;
}

function gmTab(logn) {
  const hit = _gmCache.get(logn);
  if (hit) return hit;
  const n = 1 << logn;
  const t = new Float64Array(2 * n);
  for (let k = 0; k < n; k++) {
    const r = revBits(k, logn);
    const ang = (Math.PI * r) / n;
    t[2 * k] = Math.cos(ang);
    t[2 * k + 1] = Math.sin(ang);
  }
  _gmCache.set(logn, t);
  return t;
}

export function fft(f, logn) {
  const n = 1 << logn;
  const hn = n >> 1;
  const gm = gmTab(logn);
  let t = hn;
  for (let u = 1, m = 2; u < logn; u++, m <<= 1) {
    const ht = t >> 1;
    const hm = m >> 1;
    for (let i1 = 0, j1 = 0; i1 < hm; i1++, j1 += t) {
      const j2 = j1 + ht;
      const sRe = gm[(m + i1) * 2];
      const sIm = gm[(m + i1) * 2 + 1];
      for (let j = j1; j < j2; j++) {
        const xRe = f[j];
        const xIm = f[j + hn];
        const yRe = f[j + ht];
        const yIm = f[j + ht + hn];
        const tRe = yRe * sRe - yIm * sIm;
        const tIm = yRe * sIm + yIm * sRe;
        f[j] = xRe + tRe;
        f[j + hn] = xIm + tIm;
        f[j + ht] = xRe - tRe;
        f[j + ht + hn] = xIm - tIm;
      }
    }
    t = ht;
  }
}

export function ifft(f, logn) {
  const n = 1 << logn;
  const hn = n >> 1;
  const gm = gmTab(logn);
  let t = 1;
  let m = n;
  for (let u = logn; u > 1; u--) {
    const hm = m >> 1;
    const dt = t << 1;
    for (let i1 = 0, j1 = 0; j1 < hn; i1++, j1 += dt) {
      const j2 = j1 + t;
      const sRe = gm[(hm + i1) * 2];
      const sIm = -gm[(hm + i1) * 2 + 1];
      for (let j = j1; j < j2; j++) {
        const xRe = f[j];
        const xIm = f[j + hn];
        const yRe = f[j + t];
        const yIm = f[j + t + hn];
        f[j] = xRe + yRe;
        f[j + hn] = xIm + yIm;
        const dRe = xRe - yRe;
        const dIm = xIm - yIm;
        f[j + t] = dRe * sRe - dIm * sIm;
        f[j + t + hn] = dRe * sIm + dIm * sRe;
      }
    }
    t = dt;
    m = hm;
  }
  // 逆变换归一化：正向只做 logn−1 级（首级在打包表示下是恒等），逆向少做一级，
  // 故归一化因子是 2/n 而不是 1/n（实测 iFFT(FFT(x)) 在 1/n 下恰为 x/2）。
  if (logn > 0) {
    const ni = 2 / n;
    for (let u = 0; u < n; u++) f[u] *= ni;
  }
}

export function smallToFp(dst, src) {
  for (let i = 0; i < src.length; i++) dst[i] = src[i];
  return dst;
}

export function polyAdd(a, b) {
  for (let i = 0; i < a.length; i++) a[i] += b[i];
}

export function polySub(a, b) {
  for (let i = 0; i < a.length; i++) a[i] -= b[i];
}

export function polyNeg(a) {
  for (let i = 0; i < a.length; i++) a[i] = -a[i];
}

// 伴随（adjoint）多项式 h*(x) = h(−x)：系数域把奇次项取反后再变换。
// 说明：本实现的 FFT 点序与参考实现 C 代码的打包下标不同（同一变换的另一种点序），
// 因此不沿用「虚部取反」的下标技巧，而是显式回到系数域取伴随，数学上与 h(−x) 严格一致。
export function polyAdjFft(a, logn) {
  ifft(a, logn);
  for (let i = 1; i < a.length; i += 2) a[i] = -a[i];
  fft(a, logn);
}

export function polyMulFft(a, b, logn) {
  const hn = (1 << logn) >> 1;
  for (let u = 0; u < hn; u++) {
    const aRe = a[u];
    const aIm = a[u + hn];
    const bRe = b[u];
    const bIm = b[u + hn];
    a[u] = aRe * bRe - aIm * bIm;
    a[u + hn] = aRe * bIm + aIm * bRe;
  }
}

export function polyMulAdjFft(a, b, logn) {
  const hn = (1 << logn) >> 1;
  for (let u = 0; u < hn; u++) {
    const aRe = a[u];
    const aIm = a[u + hn];
    const bRe = b[u];
    const bIm = -b[u + hn];
    a[u] = aRe * bRe - aIm * bIm;
    a[u + hn] = aRe * bIm + aIm * bRe;
  }
}

export function polyMulSelfAdjFft(a, logn) {
  const hn = (1 << logn) >> 1;
  const b = Float64Array.from(a);
  polyAdjFft(b, logn);
  for (let u = 0; u < hn; u++) {
    const ar = a[u];
    const ai = a[u + hn];
    const br = b[u];
    const bi = b[u + hn];
    a[u] = ar * br - ai * bi;
    a[u + hn] = ar * bi + ai * br;
  }
}

export function polyMulConst(a, x) {
  for (let i = 0; i < a.length; i++) a[i] *= x;
}

// d = 1/(a·adj(a) + b·adj(b))（自伴实多项式的 FFT，逐点复数除法）
export function polyInvNorm2Fft(d, a, b, logn) {
  const hn = (1 << logn) >> 1;
  const aAdj = Float64Array.from(a);
  polyAdjFft(aAdj, logn);
  const bAdj = Float64Array.from(b);
  polyAdjFft(bAdj, logn);
  for (let u = 0; u < hn; u++) {
    const dRe = a[u] * aAdj[u] - a[u + hn] * aAdj[u + hn] + b[u] * bAdj[u] - b[u + hn] * bAdj[u + hn];
    const dIm = a[u] * aAdj[u + hn] + a[u + hn] * aAdj[u] + b[u] * bAdj[u + hn] + b[u + hn] * bAdj[u];
    const m = dRe * dRe + dIm * dIm;
    d[u] = dRe / m;
    d[u + hn] = -dIm / m;
  }
}

export function polyMulAutoAdjFft(a, b, logn) {
  const hn = (1 << logn) >> 1;
  for (let u = 0; u < hn; u++) {
    const ar = a[u];
    const ai = a[u + hn];
    const br = b[u];
    const bi = b[u + hn];
    a[u] = ar * br - ai * bi;
    a[u + hn] = ar * bi + ai * br;
  }
}

// LDL 分解：mu = adj(g01)/g00，d11 = g11 − mu·g01；mu 写回 g01，d11 写回 g11
export function polyLDLFft(g00, g01, g11, logn) {
  const hn = (1 << logn) >> 1;
  const g10 = Float64Array.from(g01);
  polyAdjFft(g10, logn);
  for (let u = 0; u < hn; u++) {
    const ar = g00[u];
    const ai = g00[u + hn];
    const m = ar * ar + ai * ai;
    const xr = g10[u];
    const xi = g10[u + hn];
    const muRe = (xr * ar + xi * ai) / m;
    const muIm = (xi * ar - xr * ai) / m;
    const tRe = muRe * g01[u] - muIm * g01[u + hn];
    const tIm = muRe * g01[u + hn] + muIm * g01[u];
    g11[u] -= tRe;
    g11[u + hn] -= tIm;
    g01[u] = muRe;
    g01[u + hn] = muIm;
  }
}

export function polySplitFft(f0, f1, f, logn) {
  const n = 1 << logn;
  const hn = n >> 1;
  const qn = hn >> 1;
  const gm = gmTab(logn);
  f0[0] = f[0];
  f1[0] = f[hn];
  for (let u = 0; u < qn; u++) {
    const aRe = f[(u << 1) + 0];
    const aIm = f[(u << 1) + 0 + hn];
    const bRe = f[(u << 1) + 1];
    const bIm = f[(u << 1) + 1 + hn];
    f0[u] = (aRe + bRe) / 2;
    f0[u + qn] = (aIm + bIm) / 2;
    const dRe = aRe - bRe;
    const dIm = aIm - bIm;
    const sRe = gm[(u + hn) * 2];
    const sIm = -gm[(u + hn) * 2 + 1];
    f1[u] = (dRe * sRe - dIm * sIm) / 2;
    f1[u + qn] = (dRe * sIm + dIm * sRe) / 2;
  }
}

export function polyMergeFft(f, f0, f1, logn) {
  const n = 1 << logn;
  const hn = n >> 1;
  const qn = hn >> 1;
  const gm = gmTab(logn);
  f[0] = f0[0];
  f[hn] = f1[0];
  for (let u = 0; u < qn; u++) {
    const aRe = f0[u];
    const aIm = f0[u + qn];
    const cRe = f1[u];
    const cIm = f1[u + qn];
    const sRe = gm[(u + hn) * 2];
    const sIm = gm[(u + hn) * 2 + 1];
    const bRe = cRe * sRe - cIm * sIm;
    const bIm = cRe * sIm + cIm * sRe;
    f[(u << 1) + 0] = aRe + bRe;
    f[(u << 1) + 0 + hn] = aIm + bIm;
    f[(u << 1) + 1] = aRe - bRe;
    f[(u << 1) + 1 + hn] = aIm - bIm;
  }
}

// ============================================================
// 模 q 多项式运算（NTT：q−1 = 12288 = 2^12·3，n ≤ 1024 时 2n | q−1，负循环可完全分解）
// ============================================================

function modpow(b, e, m) {
  let r = 1;
  b %= m;
  while (e > 0) {
    if (e & 1) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1;
  }
  return r;
}

let _psiCache = {};

function negacyclicRoots(n) {
  const key = n;
  if (_psiCache[key]) return _psiCache[key];
  // 找 Z_q^* 的生成元：q−1 = 2^12·3
  let g = 2;
  for (; g < Q; g++) {
    if (modpow(g, (Q - 1) / 2, Q) !== 1 && modpow(g, (Q - 1) / 3, Q) !== 1) break;
  }
  if (g >= Q) throw fail("模 q 下未找到乘法生成元");
  const psi = modpow(g, (Q - 1) / (2 * n), Q);
  const psiInv = modpow(psi, Q - 2, Q);
  const w = (psi * psi) % Q;
  const wInv = modpow(w, Q - 2, Q);
  const nInv = modpow(n, Q - 2, Q);
  _psiCache[key] = { psi, psiInv, w, wInv, nInv };
  return _psiCache[key];
}

// 循环 NTT（长度 n，根 w）
function nttCyclic(a, n, w) {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const wl = modpow(w, n / len, Q);
    for (let i = 0; i < n; i += len) {
      let cur = 1;
      for (let j = 0; j < len / 2; j++) {
        const u = a[i + j];
        const v = (a[i + j + len / 2] * cur) % Q;
        a[i + j] = (u + v) % Q;
        a[i + j + len / 2] = (u - v + Q) % Q;
        cur = (cur * wl) % Q;
      }
    }
  }
}

// 负循环 NTT：A[k] = a(psi^(2k+1))
export function negacyclicNtt(a, logn) {
  const n = 1 << logn;
  const { psi, w } = negacyclicRoots(n);
  const out = new Array(n);
  let pw = 1;
  for (let i = 0; i < n; i++) {
    out[i] = (a[i] * pw) % Q;
    pw = (pw * psi) % Q;
  }
  nttCyclic(out, n, w);
  return out;
}

export function negacyclicIntt(a, logn) {
  const n = 1 << logn;
  const { psiInv, wInv, nInv } = negacyclicRoots(n);
  const out = a.slice();
  nttCyclic(out, n, wInv);
  let pw = 1;
  for (let i = 0; i < n; i++) {
    out[i] = (((out[i] * nInv) % Q) * pw) % Q;
    pw = (pw * psiInv) % Q;
  }
  return out;
}

// h = g/f mod (x^n+1, q)；f 不可逆时返回 null（调用方重新采样）
export function divModQ(g, f, logn) {
  const n = 1 << logn;
  const F = negacyclicNtt(f, logn);
  const G = negacyclicNtt(g, logn);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    if (F[i] === 0) return null;
    out[i] = (G[i] * modpow(F[i], Q - 2, Q)) % Q;
  }
  return negacyclicIntt(out, logn);
}

// ============================================================
// 系数编码（codec.c comp_encode / modq_encode）
// ============================================================

export function compEncode(x, logn) {
  const n = 1 << logn;
  for (let i = 0; i < n; i++) {
    if (x[i] < -2047 || x[i] > 2047) {
      throw fail(`系数 ${x[i]}（第 ${i} 个）超出压缩编码范围 −2047..2047`);
    }
  }
  const out = [];
  let acc = 0;
  let accLen = 0;
  for (let u = 0; u < n; u++) {
    let t = x[u];
    let sign = 0;
    if (t < 0) {
      t = -t;
      sign = 1;
    }
    acc = acc * 256 + sign * 128 + (t & 127);
    accLen += 8;
    const w = t >> 7;
    acc = acc * Math.pow(2, w + 1) + 1;
    accLen += w + 1;
    while (accLen >= 8) {
      accLen -= 8;
      out.push(Math.floor(acc / Math.pow(2, accLen)) & 0xff);
      acc -= Math.floor(acc / Math.pow(2, accLen)) * Math.pow(2, accLen);
    }
  }
  if (accLen > 0) out.push((acc * Math.pow(2, 8 - accLen)) & 0xff);
  return Uint8Array.from(out);
}

export function compDecode(stream, n, offset) {
  let pos = offset || 0;
  let acc = 0;
  let accLen = 0;
  const s = new Array(n);
  const takeBit = () => {
    if (accLen === 0) {
      if (pos >= stream.length) throw fail("压缩系数流越界：一元段缺少终结位");
      acc = stream[pos++];
      accLen = 8;
    }
    accLen--;
    return (acc >> accLen) & 1;
  };
  const takeByte = () => {
    if (accLen < 8) {
      if (pos >= stream.length) throw fail("压缩系数流越界：字节不足");
      acc = (acc << 8) | stream[pos++];
      accLen += 8;
    }
    accLen -= 8;
    return (acc >> accLen) & 0xff;
  };
  for (let u = 0; u < n; u++) {
    const b = takeByte();
    const sign = b & 128;
    let m = b & 127;
    for (;;) {
      if (takeBit() !== 0) break;
      m += 128;
      if (m > 2047) throw fail(`压缩系数流非法：第 ${u} 个系数超出 12 位`);
    }
    if (sign !== 0 && m === 0) throw fail(`压缩系数流非法：第 ${u} 个系数为「−0」`);
    s[u] = sign ? -m : m;
  }
  return { s, consumed: pos };
}

export function modqEncode(x, logn) {
  const n = 1 << logn;
  const outLen = ((n * 14) + 7) >> 3;
  const out = new Uint8Array(outLen);
  let acc = 0;
  let accLen = 0;
  let v = 0;
  for (let u = 0; u < n; u++) {
    if (x[u] >= Q || x[u] < 0) throw fail(`公钥系数 ${x[u]}（第 ${u} 个）不在 0..q−1`);
    acc = acc * 16384 + x[u];
    accLen += 14;
    while (accLen >= 8) {
      accLen -= 8;
      out[v++] = Math.floor(acc / Math.pow(2, accLen)) & 0xff;
      acc -= Math.floor(acc / Math.pow(2, accLen)) * Math.pow(2, accLen);
    }
  }
  if (accLen > 0) out[v++] = (acc * Math.pow(2, 8 - accLen)) & 0xff;
  return out;
}

// ============================================================
// 大整数多项式（BigInt，NTRU 方程求解）
// ============================================================

function polyMulBigSmall(a, s, m) {
  const out = new Array(m).fill(0n);
  const sb = s;
  for (let i = 0; i < m; i++) {
    const ai = a[i];
    if (ai === 0n) continue;
    for (let j = 0; j < m; j++) {
      const t = ai * sb[j];
      if (t === 0n) continue;
      const k = i + j;
      if (k >= m) out[k - m] -= t;
      else out[k] += t;
    }
  }
  return out;
}

function polyMulBig(a, b, m) {
  const out = new Array(m).fill(0n);
  for (let i = 0; i < m; i++) {
    const ai = a[i];
    if (ai === 0n) continue;
    for (let j = 0; j < m; j++) {
      const t = ai * b[j];
      const k = i + j;
      if (k >= m) out[k - m] -= t;
      else out[k] += t;
    }
  }
  return out;
}

// 负循环小系数卷积（Number 精确域：|k| ≤ 2^31、|s| ≤ 2^8、m ≤ 1024 时 |积| < 2^45）
function polyMulSmallNum(k, s, m) {
  const out = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const ki = k[i];
    if (ki === 0) continue;
    for (let j = 0; j < m; j++) {
      const t = ki * s[j];
      const idx = i + j;
      if (idx >= m) out[idx - m] -= t;
      else out[idx] += t;
    }
  }
  return out;
}

// 域范数：(f,g) 的次数 m → m/2；f' = E² − y·O²（E/O 为偶/奇系数子多项式）
function fieldNorm(f, m) {
  const h = m >> 1;
  const fe = new Array(h);
  const fo = new Array(h);
  for (let i = 0; i < h; i++) {
    fe[i] = f[2 * i];
    fo[i] = f[2 * i + 1];
  }
  const e2 = polyMulBig(fe, fe, h);
  const o2 = polyMulBig(fo, fo, h);
  const out = new Array(h);
  out[0] = e2[0] + o2[h - 1];
  for (let i = 1; i < h; i++) out[i] = e2[i] - o2[i - 1];
  return out;
}

export function bezoutBig(a, b) {
  let or = a < 0n ? -a : a;
  let r = b < 0n ? -b : b;
  let os = 1n;
  let s = 0n;
  let ot = 0n;
  let t = 1n;
  while (r !== 0n) {
    const qq = or / r;
    const nr = or - qq * r;
    or = r;
    r = nr;
    const ns = os - qq * s;
    os = s;
    s = ns;
    const nt = ot - qq * t;
    ot = t;
    t = nt;
  }
  if (or === 0n) return { u: 0n, v: 0n, g: 0n };
  // 归一到 a·u + b·v = g > 0
  const sgn = a < 0n ? -1n : 1n;
  return { u: os * sgn, v: ot * sgn, g: or };
}

function maxAbs(arr) {
  let m = 0n;
  for (let i = 0; i < arr.length; i++) {
    let v = arr[i];
    if (v < 0n) v = -v;
    if (v > m) m = v;
  }
  return m;
}

function bitLenOf(x) {
  if (x === 0n) return 0;
  let v = x < 0n ? -x : x;
  return v.toString(2).length;
}

function maxBitLen(...arrs) {
  let m = 0;
  for (const arr of arrs) {
    const b = bitLenOf(maxAbs(arr));
    if (b > m) m = b;
  }
  return m;
}

function adjBig(s) {
  const out = new Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = i % 2 === 0 ? s[i] : -s[i];
  return out;
}

// Babai 约化：把 (F,G) 对 (f,g) 反复减去 k·(f,g)，直到系数与 (f,g) 同量级。
// k 由 FFT 求 (F·adj(f)+G·adj(g))/(f·adj(f)+g·adj(g)) 后取整；每轮只保留 30 位有效标度，
// 故每轮约掉 ~30 bit。k·(f,g) 的卷积：f,g 系数小时用 Number 精确算（|积| < 2^53），
// 系数大时（深层域范数）退化为 BigInt 卷积（此时次数很小，代价可忽略）。
export function babaiReduce(F, G, f, g, logn, onStep) {
  const m = 1 << logn;
  const hn = m >> 1;
  const fBig = f;
  const gBig = g;
  const bitsf = maxBitLen(fBig, gBig);
  let bitsF = maxBitLen(F, G);
  if (bitsF <= bitsf + 2) return { F, G, iterations: 0, bits: bitsF };

  const useNum = bitsf + 34 + Math.ceil(Math.log2(m)) <= 52;
  const fNum = useNum ? f.map(Number) : null;
  const gNum = useNum ? g.map(Number) : null;
  const fd = new Float64Array(m);
  const gd = new Float64Array(m);
  const sf = Math.max(0, bitsf - 50);
  for (let i = 0; i < m; i++) {
    fd[i] = Number(fBig[i] >> BigInt(sf));
    gd[i] = Number(gBig[i] >> BigInt(sf));
  }
  fft(fd, logn);
  fft(gd, logn);
  const den = new Float64Array(m);
  polyInvNorm2Fft(den, fd, gd, logn);

  const fdAdj = Float64Array.from(fd);
  const gdAdj = Float64Array.from(gd);
  polyAdjFft(fdAdj, logn);
  polyAdjFft(gdAdj, logn);

  const Fd = new Float64Array(m);
  const Gd = new Float64Array(m);
  const tmp = new Float64Array(m);
  let iterations = 0;

  while (iterations < 4096) {
    bitsF = maxBitLen(F, G);
    if (bitsF <= bitsf + 2) break;
    iterations++;
    const scaleK = Math.max(0, bitsF - bitsf - 30);
    const sF = Math.max(0, bitsF - 50);
    for (let i = 0; i < m; i++) {
      Fd[i] = Number(F[i] >> BigInt(sF));
      Gd[i] = Number(G[i] >> BigInt(sF));
    }
    fft(Fd, logn);
    fft(Gd, logn);
    for (let u = 0; u < hn; u++) {
      const fRe = fdAdj[u];
      const fIm = fdAdj[u + hn];
      const gRe = gdAdj[u];
      const gIm = gdAdj[u + hn];
      const aRe = Fd[u] * fRe - Fd[u + hn] * fIm + Gd[u] * gRe - Gd[u + hn] * gIm;
      const aIm = Fd[u] * fIm + Fd[u + hn] * fRe + Gd[u] * gIm + Gd[u + hn] * gRe;
      tmp[u] = aRe;
      tmp[u + hn] = aIm;
    }
    polyMulAutoAdjFft(tmp, den, logn);
    ifft(tmp, logn);
    // ratio = (F·adj(f)+G·adj(g))/(f·adj(f)+g·adj(g)) · 2^(sf−sF)
    const mul = Math.pow(2, sF - sf - scaleK);
    const k = new Float64Array(m);
    let any = false;
    for (let i = 0; i < m; i++) {
      const v = Math.round(tmp[i] * mul);
      if (!Number.isFinite(v)) throw fail("约化系数溢出（FFT 数值异常）");
      k[i] = v;
      if (v !== 0) any = true;
    }
    if (!any) break;
    const sh = BigInt(scaleK);
    if (useNum) {
      const P = polyMulSmallNum(k, fNum, m);
      const Qq = polyMulSmallNum(k, gNum, m);
      for (let i = 0; i < m; i++) {
        if (P[i] !== 0) F[i] -= BigInt(P[i]) << sh;
        if (Qq[i] !== 0) G[i] -= BigInt(Qq[i]) << sh;
      }
    } else {
      const kb = Array.from(k, (v) => BigInt(v));
      const P = polyMulBig(kb, fBig, m);
      const Qq = polyMulBig(kb, gBig, m);
      for (let i = 0; i < m; i++) {
        F[i] -= P[i] << sh;
        G[i] -= Qq[i] << sh;
      }
    }
    if (onStep) onStep(iterations);
  }
  const real = maxBitLen(F, G);
  return { F, G, iterations, bits: real };
}

// 解 NTRU 方程 f·G − g·F = q；失败（无解/系数超界）返回 null
export function solveNtru(f, g, logn, onLevel) {
  const n = 1 << logn;
  let fc = Array.from(f, (v) => BigInt(v));
  let gc = Array.from(g, (v) => BigInt(v));
  const chain = [];
  for (let d = logn; d > 0; d--) {
    chain.push([fc, gc]);
    fc = fieldNorm(fc, 1 << d);
    gc = fieldNorm(gc, 1 << d);
  }
  if (fc.length !== 1 || gc.length !== 1) throw fail("域范数递归次数与次数不匹配");
  const bz = bezoutBig(fc[0], gc[0]);
  if (bz.g !== 1n && bz.g !== -1n) return null;
  const s = bz.g === 1n ? 1n : -1n;
  // 需 f'·G' − g'·F' = q；Bezout 给 u·f' + v·g' = 1，故 G' = u·q、F' = −v·q
  let F = [-bz.v * s * BigInt(Q)];
  let G = [bz.u * s * BigInt(Q)];

  for (let d = logn - 1; d >= 0; d--) {
    const [fl, gl] = chain[d];
    const m = fl.length;
    const fSmall = fl;
    const gSmall = gl;
    const half = m >> 1;
    const Fe = new Array(m).fill(0n);
    const Ge = new Array(m).fill(0n);
    for (let i = 0; i < half; i++) {
      Fe[2 * i] = F[i];
      Ge[2 * i] = G[i];
    }
    // F = F'(x²)·adj(g)，G = G'(x²)·adj(f)
    F = polyMulBigSmall(Fe, adjBig(gSmall), m);
    G = polyMulBigSmall(Ge, adjBig(fSmall), m);
    const r = babaiReduce(F, G, fSmall, gSmall, logn - d, onLevel);
    F = r.F;
    G = r.G;
  }

  // 精确校验 f·G − g·F = q（BigInt，逐项）
  const n2 = n;
  const fb = Array.from(f, (v) => BigInt(v));
  const gb = Array.from(g, (v) => BigInt(v));
  const fG = polyMulBig(fb, G, n2);
  const gF = polyMulBig(gb, F, n2);
  for (let i = 0; i < n2; i++) {
    const expect = i === 0 ? BigInt(Q) : 0n;
    if (fG[i] - gF[i] !== expect) return null;
  }
  const lim = (1 << (MAX_FG_BITS_FG[logn] - 1)) - 1;
  for (let i = 0; i < n2; i++) {
    if (F[i] >= BigInt(lim) || F[i] <= -BigInt(lim)) return null;
    if (G[i] >= BigInt(lim) || G[i] <= -BigInt(lim)) return null;
  }
  return { F: F.map(Number), G: G.map(Number) };
}

// ============================================================
// 高斯采样（keygen.c mkgauss / poly_small_mkgauss）
// ============================================================

function mkgauss(stream, logn) {
  const reps = 1 << (10 - logn);
  let val = 0;
  for (let u = 0; u < reps; u++) {
    let r = stream.u64big();
    const neg = (r >> 63n) === 1n;
    r &= MASK63;
    const isZero = r < GAUSS_1024_12289[0];
    let v = 0n;
    r = stream.u64big() & MASK63;
    if (!isZero) {
      for (let k = 1; k < GAUSS_1024_12289.length; k++) {
        if (r >= GAUSS_1024_12289[k]) {
          v = BigInt(k);
          break;
        }
      }
    }
    const s = Number(v);
    val += neg ? -s : s;
  }
  return val;
}

function sampleSmall(stream, logn) {
  const n = 1 << logn;
  const f = new Int8Array(n);
  let mod2 = 0;
  for (let u = 0; u < n; u++) {
    for (;;) {
      const s = mkgauss(stream, logn);
      if (s < -127 || s > 127) continue;
      if (u === n - 1) {
        if ((mod2 ^ (s & 1)) === 0) continue;
      } else {
        mod2 ^= s & 1;
      }
      f[u] = s;
      break;
    }
  }
  return f;
}

// ============================================================
// 密钥生成主流程
// ============================================================

function sqNormSmall(f) {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += f[i] * f[i];
  return s;
}

function berdOk(f, g, logn) {
  const n = 1 << logn;
  const rf = new Float64Array(n);
  const rg = new Float64Array(n);
  const ri = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    rf[i] = f[i];
    rg[i] = g[i];
  }
  fft(rf, logn);
  fft(rg, logn);
  polyInvNorm2Fft(ri, rf, rg, logn);
  polyAdjFft(rf, logn);
  polyAdjFft(rg, logn);
  polyMulConst(rf, Q);
  polyMulConst(rg, Q);
  polyMulAutoAdjFft(rf, ri, logn);
  polyMulAutoAdjFft(rg, ri, logn);
  ifft(rf, logn);
  ifft(rg, logn);
  let bnorm = 0;
  for (let i = 0; i < n; i++) bnorm += rf[i] * rf[i] + rg[i] * rg[i];
  return bnorm < FPR_BNORM_MAX;
}

/**
 * 生成一对 Falcon 密钥。
 * @param {number} logn 9（n=512）或 10（n=1024）；也接受 4..8 用于教学演示（不安全）
 * @param {Uint8Array} [seed] 48 字节种子；省略则走统一随机层
 * @param {(msg:string)=>void} [onProgress]
 * @returns {{logn:number,n:number,f:Int8Array,g:Int8Array,F:Int8Array,G:Int8Array,h:Uint16Array,attempts:number,seed:Uint8Array}}
 */
export function falconKeygenCore(logn, seed, onProgress) {
  if (!Number.isInteger(logn) || logn < 1 || logn > 10) {
    throw fail(`参数档 n = 2^${logn} 不在支持范围（1..10，实用档为 9/10）`);
  }
  const n = 1 << logn;
  let sd = seed;
  if (sd == null) {
    sd = randomBytes(48);
  } else if (!(sd instanceof Uint8Array) || sd.length !== 48) {
    throw fail(`种子须为 48 字节（收到 ${sd && sd.length}）`);
  }
  const stream = new ShakeStream(sd);
  const lim = 1 << (MAX_FG_BITS[logn] - 1);
  const maxAttempts = 20000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const f = sampleSmall(stream, logn);
    const g = sampleSmall(stream, logn);
    let ok = true;
    for (let u = 0; u < n; u++) {
      if (f[u] >= lim || f[u] <= -lim || g[u] >= lim || g[u] <= -lim) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    if (sqNormSmall(f) + sqNormSmall(g) >= 16823) continue;
    if (!berdOk(f, g, logn)) continue;
    const h = divModQ(g, f, logn);
    if (h === null) continue;
    if (onProgress) onProgress(`第 ${attempt} 次采样通过判界，求解 NTRU 方程…`);
    const sol = solveNtru(f, g, logn);
    if (sol === null) continue;
    return {
      logn,
      n,
      f,
      g,
      F: Int8Array.from(sol.F),
      G: Int8Array.from(sol.G),
      h: Uint16Array.from(h),
      attempts: attempt,
      seed: sd,
    };
  }
  throw fail(`连续 ${maxAttempts} 次采样均未得到可用密钥（判界过严或参数异常）`);
}

// 公钥编码：头字节 0000nnnn + n×14bit（规范 §3.11.4）
export function encodePublicKey(h, logn) {
  const body = modqEncode(Array.from(h), logn);
  const out = new Uint8Array(1 + body.length);
  out[0] = logn & 0x0f;
  out.set(body, 1);
  return out;
}

// 私钥编码：头字节 0101nnnn + comp(f) + comp(g) + comp(F) + comp(G)
export function encodePrivateKey(key) {
  const { f, g, F, G, logn } = key;
  const parts = [compEncode(Array.from(f), logn), compEncode(Array.from(g), logn), compEncode(Array.from(F), logn), compEncode(Array.from(G), logn)];
  const total = 1 + parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  out[0] = 0x50 + (logn & 0x0f);
  let off = 1;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function decodePrivateKey(bytes) {
  if (!bytes || bytes.length < 2) throw fail("私钥字节为空或过短");
  const b0 = bytes[0];
  if ((b0 & 0xf0) !== 0x50) {
    throw fail(`私钥头字节 0x${b0.toString(16).padStart(2, "0")} 不符（应为 0x50 + logn，即 0x59 / 0x5A）`);
  }
  const logn = b0 & 0x0f;
  if (logn < 1 || logn > 10) throw fail(`私钥档位 n = 2^${logn} 不在支持范围`);
  const n = 1 << logn;
  let off = 1;
  const polys = [];
  for (let i = 0; i < 4; i++) {
    const r = compDecode(bytes, n, off);
    polys.push(Int8Array.from(r.s));
    off = r.consumed;
  }
  if (off !== bytes.length) {
    throw fail(`私钥尾部有 ${bytes.length - off} 字节多余数据（四段系数流应恰好耗尽）`);
  }
  const [f, g, F, G] = polys;
  return { logn, n, f, g, F, G };
}

// 私钥自检：f·G − g·F = q 且 h = g/f 与给定公钥一致
export function checkPrivateKey(key) {
  const { f, g, F, G, logn } = key;
  const n = 1 << logn;
  const fb = Array.from(f, (v) => BigInt(v));
  const gb = Array.from(g, (v) => BigInt(v));
  const Fb = Array.from(F, (v) => BigInt(v));
  const Gb = Array.from(G, (v) => BigInt(v));
  const fG = polyMulBig(fb, Gb, n);
  const gF = polyMulBig(gb, Fb, n);
  for (let i = 0; i < n; i++) {
    const expect = i === 0 ? BigInt(Q) : 0n;
    if (fG[i] - gF[i] !== expect) {
      return { ok: false, reason: `第 ${i} 个系数不满足 f·G − g·F = q` };
    }
  }
  const h = divModQ(Array.from(g), Array.from(f), logn);
  if (h === null) return { ok: false, reason: "f 在模 q 下不可逆" };
  return { ok: true, h };
}

// 说明：本文件当前不注册 op（Berd 判界未达标，注册会出现「永不返回」的功能项）。
// 待 Berd/采样树修正并通过端到端验签后，再按 registry 契约补 register({ id: "falconKeygen", ... })。
