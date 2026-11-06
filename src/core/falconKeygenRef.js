/*
 * falconKeygenRef.js — Falcon NTRU 求解器的「参考 keygen.c 接受路径」实现。
 *
 * 用途：falconKeygen.js 的 solveNtru 采用自适应 Babai 约化，比参考 C 的
 * solve_NTRU_* 更早接受某些 (f,g)，导致 NIST keygen KAT 公钥无法逐字节复现。
 * 本文件按 Reference_Implementation/keygen.c 的 solve_NTRU 逐步重建接受/拒绝判据：
 *   - solve_NTRU_deepest：域范数 + 归一化 Bezout（0 <= u <= y, 0 <= v <= x）；
 *   - solve_NTRU_intermediate：固定 31-bit 字长/scale_k 递减 25 的 Babai 约化，
 *     归约系数 k 超出 ±(2^31−1) 即拒绝（keygen.c:3224）；
 *   - solve_NTRU_binary_depth1：单次 Babai，k 超出 ±2^63 即拒绝；
 *   - solve_NTRU_binary_depth0：模 p 精确约化（无额外拒绝判据）；
 *   - 最终 poly_big_to_small 的 |F|,|G| <= lim 与 NTRU 方程校验。
 *
 * 数值口径：FFT 复用 falconKeygen.js 的双精度实现（与参考 fft.c 同序），
 * 大整数全程 BigInt 精确；poly_big_to_fp 的 31-bit 二字补码窗口按 keygen.c 复刻。
 * 仅用于 logn=9/10 的 keygen；小档仍走 falconKeygen.js 的自适应求解器。
 */

import { fft, ifft, polyAdjFft, polyInvNorm2Fft, polyMulAutoAdjFft } from "./falconKeygen.js";
// Reference_Implementation/falcon1024int/fpr.c 的 fpr_gm_tab（2048 个 double，
// 小端原始位型做 base64）。Falcon 的 FFT 全书共用这一张表。
export const FPR_GM_TAB_B64 =
  "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";


const Q = 12289n;

const MAX_BL_SMALL = [1, 1, 2, 2, 4, 7, 14, 27, 53, 106, 209];
const MAX_BL_LARGE = [2, 2, 5, 7, 12, 21, 40, 78, 157, 308];
const BITLENGTH = [
  { avg: 4, std: 0 }, { avg: 11, std: 1 }, { avg: 24, std: 1 },
  { avg: 50, std: 1 }, { avg: 102, std: 1 }, { avg: 202, std: 2 },
  { avg: 401, std: 4 }, { avg: 794, std: 5 }, { avg: 1577, std: 8 },
  { avg: 3138, std: 13 }, { avg: 6308, std: 25 },
];

const MASK31 = (1n << 31n) - 1n;
const LIM_FG = 127;

function polyMulBig(a, b, m) {
  const out = new Array(m).fill(0n);
  for (let i = 0; i < m; i++) {
    const ai = a[i];
    if (ai === 0n) continue;
    for (let j = 0; j < m; j++) {
      const t = ai * b[j];
      if (t === 0n) continue;
      const k = i + j;
      if (k >= m) out[k - m] -= t;
      else out[k] += t;
    }
  }
  return out;
}

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

function adjBig(s) {
  return s.map((v, i) => (i % 2 === 0 ? v : -v));
}

// keygen.c solve_NTRU_binary_depth0 里 t5 构造的伴随：t5[0]=f[0]，t5[n-u]=-f[u]。
// 它对应 NTT/FFT 域的逐点共轭（负翻转），与 lift 用的 f(-x)（奇系数取反）不同。
function revAdjBig(s) {
  const n = s.length;
  const out = new Array(n);
  out[0] = s[0];
  for (let u = 1; u < n; u++) out[n - u] = -s[u];
  return out;
}

function spreadEven(F, m) {
  const out = new Array(m).fill(0n);
  for (let i = 0; i < F.length; i++) out[2 * i] = F[i];
  return out;
}

function buildChain(f, g, lognTop) {
  let fc = Array.from(f, (v) => BigInt(v));
  let gc = Array.from(g, (v) => BigInt(v));
  const chain = [];
  for (let d = lognTop; d > 0; d--) {
    chain.push([fc, gc]);
    fc = fieldNorm(fc, 1 << d);
    gc = fieldNorm(gc, 1 << d);
  }
  return { chain, resF: fc[0], resG: gc[0] };
}

// 31-bit 字（keygen.c zint_* 的二字补码表示）→ 参考 poly_big_to_fp 数值。
function bigToWords(x, L) {
  const w = new Array(L);
  for (let i = 0; i < L; i++) w[i] = Number((x >> BigInt(31 * i)) & MASK31);
  return w;
}

function wordsToFp(words, off, flen) {
  const top = words[off + flen - 1];
  const neg = (top >>> 30) & 1;
  let x = 0;
  let fsc = 1;
  if (!neg) {
    for (let v = 0; v < flen; v++) {
      x += words[off + v] * fsc;
      fsc *= 2147483648;
    }
  } else {
    let cc = 1;
    for (let v = 0; v < flen; v++) {
      let w = (((words[off + v] ^ 0x7fffffff) >>> 0) + cc) >>> 0;
      cc = w >>> 31;
      w &= 0x7fffffff;
      x -= w * fsc;
      fsc *= 2147483648;
    }
  }
  return x;
}

function polyToFp(bigArr, L, flen, logn) {
  const n = 1 << logn;
  const out = new Float64Array(n);
  for (let u = 0; u < n; u++) {
    out[u] = wordsToFp(bigToWords(bigArr[u], L), L - flen, flen);
  }
  return out;
}

function polyToFpWindow(bigArr, L, FGlen, flen, logn) {
  const n = 1 << logn;
  const out = new Float64Array(n);
  for (let u = 0; u < n; u++) {
    out[u] = wordsToFp(bigToWords(bigArr[u], L), FGlen - flen, flen);
  }
  return out;
}

// keygen.c zint_bezout：x*u - y*v = 1，0 <= u < y，0 <= v < x（x,y 正且互素）。
function egcdPos(a, b) {
  let oldR = a;
  let r = b;
  let oldS = 1n;
  let s = 0n;
  let oldT = 0n;
  let t = 1n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  return { g: oldR, s: oldS, t: oldT };
}

function refBezout(x, y) {
  const { g, s } = egcdPos(x, y);
  if (g !== 1n) return null;
  const u = ((s % y) + y) % y;
  const v = (x * u - 1n) / y;
  if (v < 0n || v > x) return null;
  return { u, v };
}

// keygen.c solve_NTRU_intermediate：返回 {F,G} 或 null（含 k 越界等保守拒绝）。
function refIntermediate(F, G, f, g, depth, lognTop) {
  const logn = lognTop - depth;
  const n = 1 << logn;
  const slen = MAX_BL_SMALL[depth];
  const llen = MAX_BL_LARGE[depth];
  const rlenFg = Math.min(slen, 10);
  const scaleFg = 31 * (slen - rlenFg);
  const minblFg = BITLENGTH[depth].avg - 6 * BITLENGTH[depth].std;
  const maxblFg = BITLENGTH[depth].avg + 6 * BITLENGTH[depth].std;

  const fd = polyToFp(f, slen, rlenFg, logn);
  const gd = polyToFp(g, slen, rlenFg, logn);
  fft(fd, logn);
  fft(gd, logn);
  const inv = new Float64Array(n);
  polyInvNorm2Fft(inv, fd, gd, logn);
  polyAdjFft(fd, logn);
  polyAdjFft(gd, logn);

  let FGlen = llen;
  let maxblFG = 31 * llen;
  let scaleK = maxblFG - minblFg;
  const hn = n >> 1;

  for (let iter = 0; iter < 10000; iter++) {
    const rlen = Math.min(FGlen, 10);
    const scaleFG = 31 * (FGlen - rlen);
    const Fd = polyToFpWindow(F, llen, FGlen, rlen, logn);
    const Gd = polyToFpWindow(G, llen, FGlen, rlen, logn);
    fft(Fd, logn);
    fft(Gd, logn);
    const tmp = new Float64Array(n);
    for (let u = 0; u < hn; u++) {
      const fRe = fd[u];
      const fIm = fd[u + hn];
      const gRe = gd[u];
      const gIm = gd[u + hn];
      tmp[u] = Fd[u] * fRe - Fd[u + hn] * fIm + Gd[u] * gRe - Gd[u + hn] * gIm;
      tmp[u + hn] = Fd[u] * fIm + Fd[u + hn] * fRe + Gd[u] * gIm + Gd[u + hn] * gRe;
    }
    polyMulAutoAdjFft(tmp, inv, logn);
    ifft(tmp, logn);

    const dc = scaleK - scaleFG + scaleFg;
    const pdc = Math.pow(2, -dc);
    const k = new Array(n);
    for (let u = 0; u < n; u++) {
      const v = tmp[u] * pdc;
      if (!(v > -2147483647 && v < 2147483647)) return null;
      k[u] = Math.round(v);
    }

    const kb = k.map((v) => BigInt(v));
    const kf = polyMulBig(kb, f, n);
    const kg = polyMulBig(kb, g, n);
    const sh = BigInt(scaleK);
    for (let i = 0; i < n; i++) {
      if (kf[i] !== 0n) F[i] -= kf[i] << sh;
      if (kg[i] !== 0n) G[i] -= kg[i] << sh;
    }

    const newMax = scaleK + maxblFg + 10;
    if (newMax < maxblFG) {
      maxblFG = newMax;
      if (FGlen * 31 >= maxblFG + 31) FGlen--;
    }
    if (scaleK <= 0) return { F, G };
    scaleK = Math.max(0, scaleK - 25);
  }
  return null;
}

// keygen.c solve_NTRU_binary_depth1：一次 Babai，k 越 ±2^63 拒绝。
function refBinaryDepth1(F, G, f, g, logn) {
  const n = 1 << logn;
  const hn = n >> 1;
  const llen = MAX_BL_LARGE[1];
  const slen = MAX_BL_SMALL[1];

  const Fd = polyToFp(F, llen, llen, logn);
  const Gd = polyToFp(G, llen, llen, logn);
  const fd = polyToFp(f, slen, slen, logn);
  const gd = polyToFp(g, slen, slen, logn);
  fft(Fd, logn);
  fft(Gd, logn);
  fft(fd, logn);
  fft(gd, logn);

  const num = new Float64Array(n);
  for (let u = 0; u < hn; u++) {
    const fRe = fd[u];
    const fIm = fd[u + hn];
    const gRe = gd[u];
    const gIm = gd[u + hn];
    num[u] = Fd[u] * fRe + Fd[u + hn] * fIm + Gd[u] * gRe + Gd[u + hn] * gIm;
    num[u + hn] = Fd[u + hn] * fRe - Fd[u] * fIm + Gd[u + hn] * gRe - Gd[u] * gIm;
  }
  const inv = new Float64Array(n);
  polyInvNorm2Fft(inv, fd, gd, logn);
  polyMulAutoAdjFft(num, inv, logn);
  ifft(num, logn);

  const k = new Array(n);
  for (let u = 0; u < n; u++) {
    const z = num[u];
    if (!(z > -9223372036854776000 && z < 9223372036854776000)) return null;
    k[u] = Math.round(z);
  }
  const kb = k.map((v) => BigInt(v));
  const kf = polyMulBig(kb, f, n);
  const kg = polyMulBig(kb, g, n);
  const Fo = new Array(n);
  const Go = new Array(n);
  for (let i = 0; i < n; i++) {
    Fo[i] = F[i] - kf[i];
    Go[i] = G[i] - kg[i];
  }
  return { F: Fo, G: Go };
}

// keygen.c solve_NTRU_binary_depth0：模 p=2147473409 的约化（无额外拒绝判据）。
// 参考实现把未约化 F/G 直接建成模 p 的 NTT；若真实系数越过 p/2，会被环绕成
// 另一个代表元，后续 lim/方程校验因此失败。这里按 mod p 复刻，而不是用精确整数。
const DEPTH0_P = 2147473409n;
const DEPTH0_HALF = (DEPTH0_P + 1n) >> 1n;

function normModP(x) {
  let v = x % DEPTH0_P;
  if (v < 0n) v += DEPTH0_P;
  if (v >= DEPTH0_HALF) v -= DEPTH0_P;
  return v;
}

function refBinaryDepth0(F, G, f, g, logn) {
  const n = 1 << logn;
  const hn = n >> 1;
  const adjf = revAdjBig(f);
  const adjg = revAdjBig(g);
  const Fw = F.map((x) => {
    const v = x % DEPTH0_P;
    return v < 0n ? v + DEPTH0_P : v;
  });
  const Gw = G.map((x) => {
    const v = x % DEPTH0_P;
    return v < 0n ? v + DEPTH0_P : v;
  });

  const nF = polyMulBig(Fw, adjf, n);
  const nG = polyMulBig(Gw, adjg, n);
  const nr = new Float64Array(n);
  for (let i = 0; i < n; i++) nr[i] = Number(normModP(nF[i] + nG[i]));

  const dF = polyMulBig(f, adjf, n);
  const dG = polyMulBig(g, adjg, n);
  const dr = new Float64Array(n);
  for (let i = 0; i < n; i++) dr[i] = Number(normModP(dF[i] + dG[i]));

  fft(nr, logn);
  fft(dr, logn);
  for (let u = 0; u < hn; u++) {
    const ib = 1 / dr[u];
    nr[u] *= ib;
    nr[u + hn] *= ib;
  }
  ifft(nr, logn);

  const k = new Array(n);
  for (let u = 0; u < n; u++) k[u] = Math.round(nr[u]);
  const kb = k.map((v) => BigInt(v));
  const kf = polyMulBig(kb, f, n);
  const kg = polyMulBig(kb, g, n);
  const Fo = new Array(n);
  const Go = new Array(n);
  for (let i = 0; i < n; i++) {
    Fo[i] = normModP(Fw[i] - kf[i]);
    Go[i] = normModP(Gw[i] - kg[i]);
  }
  return { F: Fo, G: Go };
}

/**
 * 参考接受路径的 NTRU 求解器（logn 9/10）。
 * @returns {{F:number[],G:number[]}|null}
 */
export function solveNtruRef(f, g, logn) {
  if (!Number.isInteger(logn) || logn < 3 || logn > 10) return null;
  const n = 1 << logn;
  const { chain, resF, resG } = buildChain(f, g, logn);
  const sf = resF < 0n ? -1n : 1n;
  const sg = resG < 0n ? -1n : 1n;
  const bz = refBezout(sf * resF, sg * resG);
  if (!bz) return null;

  let F = [sg * bz.v * Q];
  let G = [sf * bz.u * Q];

  for (let depth = logn - 1; depth >= 0; depth--) {
    const m = 1 << (logn - depth);
    const [fb, gb] = chain[depth];
    const Fe = spreadEven(F, m);
    const Ge = spreadEven(G, m);
    F = polyMulBig(Fe, adjBig(gb), m);
    G = polyMulBig(Ge, adjBig(fb), m);

    let r;
    if (depth >= 2) {
      r = refIntermediate(F, G, fb, gb, depth, logn);
    } else if (depth === 1) {
      r = refBinaryDepth1(F, G, fb, gb, logn - 1);
    } else {
      r = refBinaryDepth0(F, G, fb, gb, logn);
    }
    if (r === null) return null;
    F = r.F;
    G = r.G;
  }

  for (let i = 0; i < n; i++) {
    if (F[i] > BigInt(LIM_FG) || F[i] < -BigInt(LIM_FG)) return null;
    if (G[i] > BigInt(LIM_FG) || G[i] < -BigInt(LIM_FG)) return null;
  }
  const fb = Array.from(f, (v) => BigInt(v));
  const gb = Array.from(g, (v) => BigInt(v));
  const fG = polyMulBig(fb, G, n);
  const gF = polyMulBig(gb, F, n);
  for (let i = 0; i < n; i++) {
    const expect = i === 0 ? Q : 0n;
    if (fG[i] - gF[i] !== expect) return null;
  }
  return { F: F.map(Number), G: G.map(Number) };
}

export { LIM_FG };
