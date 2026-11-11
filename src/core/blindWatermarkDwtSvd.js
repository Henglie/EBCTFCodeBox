/*
 * blindWatermarkDwtSvd.js — DWT-DCT-SVD 真盲水印（单图自洽；文本水印 + 图片水印两种模式）。
 *
 * 定位：CTF 与业界最常见的「真盲」图像水印族——只需要含水印的那张图即可提取，
 * 不需要原图。与 dctWatermark（8×8 DCT + 中频奇偶量化）是**不同内核**：
 * 本支是「小波域 → 块 DCT → 奇异值量化」，鲁棒性来源是奇异值的稳定性。
 * 与 dualFftWatermark（双图 FFT 半盲）互补：一支真盲、一支半盲。
 *
 * 算法依据（权威源，版本冻结）：
 * - 参考实现：guofei9987/blind_watermark 仓库 blind_watermark/bwm_core.py
 *   （类 WaterMarkCore；block_shape=[4,4]、d1=36、d2=20、haar 一级小波、按 password_img
 *    决定的行内置换、`s[0]=(s[0]//d1 + 1/4 + 1/2·bit)·d1` 量化嵌入、`wm_bit[i % wm_size]`
 *    循环冗余、抽取时 3 通道 + 冗余求平均）。本文件按该源逐行对齐，参数默认值同源。
 * - 原理论文：K. A. Navas, M. C. Ajay, M. Lekshmi, T. S. Archana, M. Sasikumar,
 *   "DWT-DCT-SVD based watermarking", COMSWARE 2008 — §III「the DCT coefficients of the
 *   DWT coefficients are used to embed the watermarking information」：DWT 提供多分辨率、
 *   DCT 提供能量集中（贴合压缩）、SVD 提供「小扰动下奇异值稳定」的鲁棒性。
 * - 奇异值量化思路亦见 Liu & Tan, "An SVD-based watermarking scheme for protecting rightful
 *   ownership", IEEE Trans. Multimedia 4(1):121–128, 2002（把信息放进奇异值）。
 * - 小波基：Haar（A. Haar, Math. Ann. 69:331–371, 1910），采用正交归一化形式
 *   （pywt 的 'haar'：cA=(a+b+c+d)/2，cH/cV/cD 为相应的 ±组合 /2），正逆变换无损。
 * - 色度处理：OpenCV cv2.cvtColor(BGR↔YUV) 的 BT.601 系数（本实现按同系数从 RGB 直接算）。
 *
 * 嵌入流程（逐行对齐 bwm_core）：
 *  ① BGR→YUV；② 高/宽补成偶数（YUV 补 0 黑边）；③ 每通道 dwt2('haar') 取 cA（低频）；
 *  ④ cA 切成 4×4 块（只取能整除的主体区，右边/下边余条不动）；
 *  ⑤ 每块：dct(4×4) → 按 password 的行内置换 → svd → 量化解 s[0]（d2 时同时 s[1]）
 *     → 反 svd → 反置换 → idct；
 *  ⑥ 逆 dwt2 → YUV→BGR → 去补边 → 四舍五入钳位写图（有透明通道则保留 alpha）。
 *  提取：同走 ①②③④，每块 svd 后取 bit = (s[0] % d1 > d1/2)（d2 时与 s[1] 融合），
 *  再按 `i % wm_size` 把循环冗余与 3 通道一起求平均，>0.5 判 1。
 *
 * 两层口令（与参考实现 WaterMark 的两层一致，不可混为一谈）：
 *  · `password_img`（参数 password）→ 每块 16 个 DCT 系数的**块内置换**（shuffleIdx，
 *    复刻 `RandomState(pw).random((n,16)).argsort(axis=1)`，走 53 位 rk_double）。
 *  · `password_wm`（参数 passwordWm）→ **水印序列**的置换（seqShuffleIdx，
 *    复刻 `RandomState(pw).shuffle(arange(n))`，走 `u32 & mask` + 拒绝采样）。
 *    两者是**不同的 numpy 取数原语**，序列不同，不可互相替代。
 *    默认 0 = 不洗牌（保持本 op 旧版口径）；>0 才启用（与上游工具互通时按上游给的 password_wm 填）。
 *
 * 两种模式：
 *  · 文本（默认）：载荷 = 32 bit 大端长度头 + UTF-8 字节（本项目自定，用于免参数提取）；
 *    也可用 wmBits>0 直接取定长位流（与参考实现 mode='str' 互通）。
 *  · 图片：水印是**一张灰度图**，位数 = 宽×高（参考实现 `read_wm(mode="img")` 用
 *    `IMREAD_GRAYSCALE` 读入后按 `> 200` 判白，行主序）。提取时必须给出宽×高（wmShape），
 *    输出为灰度图（参考实现 `wm_avg * 255`）；**不做二值化**（二值化只用于文本分支）。
 *
 * 数据契约（沿用项目图像 op 约定）：encode(text, p) / decode(text, p)，
 * 图走 p.rawBytes（拖入）或 text（粘贴 base64）；文本水印走参数栏 p.message；
 * 图片水印的**水印图**走参数栏 p.wmImage（base64/dataURL，与「图像差异对比」同约定）。
 * 纯算法层（haarDwt/haarIdwt/dct4x4/svd4x4/shuffleIdx/seqShuffleIdx/embed/extract）不依赖 DOM，node 可单测。
 *
 * 已知偏差（如实声明）：
 * ① 参考实现部分中间量用 float32，本实现全程 float64；不影响自洽往返，但「与上游工具逐位互解」
 *    在奇异值恰好落在量化边界时可能不同。
 * ② 上游 `extract` 的 img 分支在部分版本里对 `wm_avg` 再走一次 k-means；本实现按参考 Rust 移植
 *    （`blind_watermark_bwm.rs` L275-290）取**软灰度**（`avg*255`），与「图片水印应保留灰度层次」一致。
 * 本环境无 cv2/PyWavelets（红线禁装），故与上游库的**逐位**对拍暂时无法进行；但
 * `password_wm` 的置换序列已与 numpy 2.4.6 逐元素对拍一致（逐元素一致）。
 */

import { register } from "./registry.js";
import { decodePNG, dataURLToBytes } from "./stegoPixels.js";
import { isLimitError } from "./limitGuard.js";
import { rgbaToDataURL } from "./mcMap.js";

export const BLOCK = 4;
export const D1_DEF = 36;
export const D2_DEF = 20;
const PW_DEF = 1;
/** 图片水印模式判白阈值（参考实现 bwm_core 对 img 分支用 `> 200`）。 */
const WM_GRAY_THR = 200;

// ====================7（numpy 旧式标量定种：init_genrand） ====================
// 参考实现的块内置换来自 np.random.RandomState(password_img).random((n,16)).argsort(axis=1)，
// 属 numpy 的 legacy 标量定种（Knuth PRNG 递推），与 CPython random.seed 的 init_by_array 不同。

const MT_N = 624, MT_M = 397, MT_MATRIX_A = 0x9908b0df;
const MT_UPPER = 0x80000000, MT_LOWER = 0x7fffffff;

class MT19937 {
  constructor() { this.mt = new Uint32Array(MT_N); this.mti = MT_N + 1; }
  initGenrand(s) {
    this.mt[0] = s >>> 0;
    this.mti = MT_N;
    for (let i = 1; i < MT_N; i++) {
      const p = this.mt[i - 1];
      this.mt[i] = (Math.imul(1812433253, p ^ (p >>> 30)) + i) >>> 0;
    }
  }
  u32() {
    if (this.mti >= MT_N) {
      let kk;
      for (kk = 0; kk < MT_N - MT_M; kk++) {
        const y = (this.mt[kk] & MT_UPPER) | (this.mt[kk + 1] & MT_LOWER);
        this.mt[kk] = this.mt[kk + MT_M] ^ (y >>> 1) ^ ((y & 1) ? MT_MATRIX_A : 0);
      }
      for (; kk < MT_N - 1; kk++) {
        const y = (this.mt[kk] & MT_UPPER) | (this.mt[kk + 1] & MT_LOWER);
        this.mt[kk] = this.mt[kk + (MT_M - MT_N)] ^ (y >>> 1) ^ ((y & 1) ? MT_MATRIX_A : 0);
      }
      const y = (this.mt[MT_N - 1] & MT_UPPER) | (this.mt[0] & MT_LOWER);
      this.mt[MT_N - 1] = this.mt[MT_M - 1] ^ (y >>> 1) ^ ((y & 1) ? MT_MATRIX_A : 0);
      this.mti = 0;
    }
    let y = this.mt[this.mti++];
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }
  /** numpy 的 rk_double：与 CPython random.random() 同公式（53 位）。 */
  r53() {
    const a = this.u32() >>> 5, b = this.u32() >>> 6;
    return (a * 67108864.0 + b) / 9007199254740992.0;
  }
}

/**
 * 块内置换索引：复刻 random_strategy1(seed,size,16)=
 * RandomState(seed).random((size,16)).argsort(axis=1)（按行升序排序的下标，即置换）。
 * 返回 Int32Array(length=size*16)。各行取值互不相同，故排序稳定性无关紧要。
 */
export function shuffleIdx(seed, size) {
  const mt = new MT19937();
  mt.initGenrand(normSeed(seed));
  const out = new Int32Array(size * BLOCK * BLOCK);
  const vals = new Float64Array(BLOCK * BLOCK);
  const idx = [];
  for (let i = 0; i < size; i++) {
    for (let k = 0; k < BLOCK * BLOCK; k++) { vals[k] = mt.r53(); idx[k] = k; }
    idx.sort((a, b) => vals[a] - vals[b]);
    for (let k = 0; k < BLOCK * BLOCK; k++) out[i * BLOCK * BLOCK + k] = idx[k];
  }
  return out;
}

/**
 * numpy legacy `RandomState(seed).shuffle` 的取随机数原语（randomkit 的 rk_interval）。
 * 注意：与 shuffleIdx 用的 `random((n,16)).argsort` **不是同一原语**——shuffle 走
 * `rk_ulong() & mask` 加拒绝采样，而 argsort 走 53 位 `rk_double`。两者序列不同，不可混用。
 * （`& mask` 后**不做右移**：实测 `u32() & mask` 与 numpy 8/8 一致，加 `>>1` 则 0/8。）
 */
function rkInterval(mt, max) {
  if (max <= 0) return 0;
  // 掩码必须**逐步**或运算（每步用更新后的 mask 再右移），不能写成单个表达式：
  // 单表达式里 mask 恒为原值，8 只能得到 14 而非 15 → 与 numpy 不一致。
  let mask = max >>> 0;
  mask |= mask >>> 1;
  mask |= mask >>> 2;
  mask |= mask >>> 4;
  mask |= mask >>> 8;
  mask |= mask >>> 16;
  mask = mask >>> 0;
  let v = (mt.u32() & mask) >>> 0;
  while (v > max) v = (mt.u32() & mask) >>> 0;
  return v;
}

/**
 * 复刻 `RandomState(seed).shuffle(arange(size))` 得到的置换（Fisher-Yates 逆序版）。
 * 参考实现 `WaterMark.read_wm` 用 `RandomState(password_wm).shuffle` 打乱**水印序列**
 * （与 password_img 的块内置换是两个独立的层）。返回 Int32Array(length=size)。
 */
export function seqShuffleIdx(seed, size) {
  const mt = new MT19937();
  mt.initGenrand(normSeed(seed));
  const idx = new Int32Array(size);
  for (let i = 0; i < size; i++) idx[i] = i;
  for (let i = size - 1; i > 0; i--) {
    const j = rkInterval(mt, i);
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx;
}

/** 水印序列洗牌：`out[k] = arr[idx[k]]`（numpy 原地 shuffle 的等价语义）。 */
export function shuffleSeq(arr, seed) {
  const idx = seqShuffleIdx(seed, arr.length);
  const out = new arr.constructor(arr.length);
  for (let k = 0; k < arr.length; k++) out[k] = arr[idx[k]];
  return out;
}

/** 水印序列解洗：`out[idx[k]] = arr[k]`（参考实现 `decrypt` 的语义，与 shuffleSeq 互逆）。 */
export function unshuffleSeq(arr, seed) {
  const idx = seqShuffleIdx(seed, arr.length);
  const out = new arr.constructor(arr.length);
  for (let k = 0; k < arr.length; k++) out[idx[k]] = arr[k];
  return out;
}

// ==================== Haar 小波（1 级，正交归一化，偶数尺寸） ====================

/** (H,W) → {cA,cH,cV,cD}，H/W 须为偶数。cA 为低频（后续嵌入都在这里）。 */
export function haarDwt1(src, H, W) {
  const h = H >> 1, w = W >> 1;
  const cA = new Float64Array(h * w), cH = new Float64Array(h * w);
  const cV = new Float64Array(h * w), cD = new Float64Array(h * w);
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      const a = src[(2 * i) * W + 2 * j], b = src[(2 * i) * W + 2 * j + 1];
      const c = src[(2 * i + 1) * W + 2 * j], d = src[(2 * i + 1) * W + 2 * j + 1];
      const k = i * w + j;
      cA[k] = (a + b + c + d) / 2;
      cH[k] = (a - b + c - d) / 2;
      cV[k] = (a + b - c - d) / 2;
      cD[k] = (a - b - c + d) / 2;
    }
  }
  return { cA, cH, cV, cD, h, w };
}

/** 逆变换：{cA,cH,cV,cD} + (h,w) → (2h,2w)。 */
export function haarIdwt1(b, h, w) {
  const H = h << 1, W = w << 1;
  const out = new Float64Array(H * W);
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      const k = i * w + j;
      const A = b.cA[k], Hh = b.cH[k], V = b.cV[k], D = b.cD[k];
      out[(2 * i) * W + 2 * j] = (A + Hh + V + D) / 2;
      out[(2 * i) * W + 2 * j + 1] = (A - Hh + V - D) / 2;
      out[(2 * i + 1) * W + 2 * j] = (A + Hh - V - D) / 2;
      out[(2 * i + 1) * W + 2 * j + 1] = (A - Hh - V + D) / 2;
    }
  }
  return out;
}

// ==================== 4×4 正交归一化 DCT-II（cv2.dct 对 4×4 的语义） ====================
// 依据 OpenCV 文档 dct 小节的矩阵定义 C^(N)_jk = sqrt(α_j/N)·cos(π(2k+1)j/(2N))，
// α_0 = 1、α_j = 2 (j>0) ⇒ 正是正交归一化 DCT-II（等价 α(0)=sqrt(1/N)、α(j)=sqrt(2/N)）。
// 二维可分离：X = C·x·Cᵀ；逆变换 X = Cᵀ·y·C（C 正交，逆=转置）。

const DCT_BASIS4 = (() => {
  const N = BLOCK, B = [];
  for (let u = 0; u < N; u++) {
    B[u] = new Float64Array(N);
    const alpha = u === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N);
    for (let x = 0; x < N; x++) B[u][x] = alpha * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
  }
  return B;
})();

export function dct4Block(p, off, stride) {
  const tmp = new Float64Array(BLOCK * BLOCK);
  const F = new Float64Array(BLOCK * BLOCK);
  for (let u = 0; u < BLOCK; u++) {
    for (let c = 0; c < BLOCK; c++) {
      let s = 0;
      for (let r = 0; r < BLOCK; r++) s += DCT_BASIS4[u][r] * p[off + r * stride + c];
      tmp[u * BLOCK + c] = s;
    }
  }
  for (let u = 0; u < BLOCK; u++) {
    for (let v = 0; v < BLOCK; v++) {
      let s = 0;
      for (let c = 0; c < BLOCK; c++) s += tmp[u * BLOCK + c] * DCT_BASIS4[v][c];
      F[u * BLOCK + v] = s;
    }
  }
  return F;
}

export function idct4Block(F) {
  const tmp = new Float64Array(BLOCK * BLOCK);
  const f = new Float64Array(BLOCK * BLOCK);
  for (let r = 0; r < BLOCK; r++) {
    for (let v = 0; v < BLOCK; v++) {
      let s = 0;
      for (let u = 0; u < BLOCK; u++) s += DCT_BASIS4[u][r] * F[u * BLOCK + v];
      tmp[r * BLOCK + v] = s;
    }
  }
  for (let r = 0; r < BLOCK; r++) {
    for (let c = 0; c < BLOCK; c++) {
      let s = 0;
      for (let v = 0; v < BLOCK; v++) s += tmp[r * BLOCK + v] * DCT_BASIS4[v][c];
      f[r * BLOCK + c] = s;
    }
  }
  return f;
}

// ==================== 4×4 SVD ====================
// 单边 Jacobi（正交化列），对 4×4 实矩阵收敛快、精度达机器精度；奇异值按降序排列。
// 分解满足 A = U·diag(s)·Vᵀ（u/v 的符号约定任意，重建与嵌入都与符号无关）。

export function svd4(Ain) {
  const A = Float64Array.from(Ain);
  const V = new Float64Array(BLOCK * BLOCK);
  for (let i = 0; i < BLOCK; i++) V[i * BLOCK + i] = 1;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < BLOCK - 1; p++) {
      for (let q = p + 1; q < BLOCK; q++) {
        let alpha = 0, beta = 0, gamma = 0;
        for (let i = 0; i < BLOCK; i++) {
          const ap = A[i * BLOCK + p], aq = A[i * BLOCK + q];
          alpha += ap * ap; beta += aq * aq; gamma += ap * aq;
        }
        off += Math.abs(gamma);
        if (Math.abs(gamma) < 1e-15 * Math.sqrt(alpha * beta + 1e-300)) continue;
        const zeta = (beta - alpha) / (2 * gamma);
        const t = Math.sign(zeta || 1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t), s = c * t;
        for (let i = 0; i < BLOCK; i++) {
          const ap = A[i * BLOCK + p], aq = A[i * BLOCK + q];
          A[i * BLOCK + p] = c * ap - s * aq;
          A[i * BLOCK + q] = s * ap + c * aq;
          const vp = V[i * BLOCK + p], vq = V[i * BLOCK + q];
          V[i * BLOCK + p] = c * vp - s * vq;
          V[i * BLOCK + q] = s * vp + c * vq;
        }
      }
    }
    if (off < 1e-14) break;
  }
  const s = new Float64Array(BLOCK);
  const U = new Float64Array(BLOCK * BLOCK);
  for (let j = 0; j < BLOCK; j++) {
    let nrm = 0;
    for (let i = 0; i < BLOCK; i++) nrm += A[i * BLOCK + j] * A[i * BLOCK + j];
    s[j] = Math.sqrt(nrm);
  }
  // 按奇异值降序重排（U 列、V 列、s 同步）
  const order = [0, 1, 2, 3].sort((a, b) => s[b] - s[a]);
  const s2 = new Float64Array(BLOCK);
  for (let j = 0; j < BLOCK; j++) {
    s2[j] = s[order[j]];
    const nrm = s[order[j]] || 1;
    for (let i = 0; i < BLOCK; i++) U[i * BLOCK + j] = A[i * BLOCK + order[j]] / nrm;
  }
  const V2 = new Float64Array(BLOCK * BLOCK);
  for (let j = 0; j < BLOCK; j++) {
    for (let i = 0; i < BLOCK; i++) V2[i * BLOCK + j] = V[i * BLOCK + order[j]];
  }
  return { u: U, s: s2, v: V2 };
}

/** 由 U·diag(s)·Vᵀ 重建（V 按列给出）。 */
function svdReconstruct(u, s, v) {
  const out = new Float64Array(BLOCK * BLOCK);
  for (let i = 0; i < BLOCK; i++) {
    for (let j = 0; j < BLOCK; j++) {
      let sum = 0;
      for (let k = 0; k < BLOCK; k++) sum += u[i * BLOCK + k] * s[k] * v[j * BLOCK + k];
      out[i * BLOCK + j] = sum;
    }
  }
  return out;
}

// ==================== 色度/小波前置：图像 ↔ YUV 平面 ====================
// OpenCV 系数（BT.601）：Y=0.299R+0.587G+0.114B；U=0.492(B−Y)+128；V=0.877(R−Y)+128。

function rgbToYuv(img) {
  const { width: W, height: H, data } = img;
  const y = new Float64Array(W * H), u = new Float64Array(W * H), v = new Float64Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const R = data[i * 4], G = data[i * 4 + 1], B = data[i * 4 + 2];
    const Y = 0.299 * R + 0.587 * G + 0.114 * B;
    y[i] = Y; u[i] = 0.492 * (B - Y) + 128; v[i] = 0.877 * (R - Y) + 128;
  }
  return { y, u, v };
}

function yuvToRgb(y, u, v, W, H) {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const Y = y[i], U = u[i] - 128, V = v[i] - 128;
    out[i * 4] = clampRound255(Y + 1.140 * V);
    out[i * 4 + 1] = clampRound255(Y - 0.395 * U - 0.581 * V);
    out[i * 4 + 2] = clampRound255(Y + 2.032 * U);
    out[i * 4 + 3] = 255;
  }
  return out;
}

// ==================== 嵌入 / 提取内核 ====================

function normSeed(v) {
  const n = Number(v);
  if (!isFinite(n)) return PW_DEF;
  return Math.trunc(n) >>> 0;
}
function normD(v, def) {
  const n = Number(v);
  if (!isFinite(n) || n < 0) return def;
  return n;
}
function bytesToBits(bytes) {
  const bits = [];
  for (const b of bytes) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  return bits;
}
function bitsToBytes(bits) {
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    out.push(b);
  }
  return new Uint8Array(out);
}
/** 载荷 bit 流 = 32 bit 大端长度（字节数）+ UTF-8 字节。 */
export function buildPayloadBits(text) {
  const data = new TextEncoder().encode(text);
  const len = data.length;
  return bytesToBits(new Uint8Array([(len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff]))
    .concat(bytesToBits(data));
}

/**
 * 嵌入：img 为 {width,height,data:RGBA}，bits 为 0/1 数组，返回同尺寸 RGBA。
 * p: { password, d1, d2 }
 */
export function dwtSvdEmbed(img, bits, p = {}) {
  const W = img.width, H = img.height;
  const pw = normSeed(p.password === undefined || p.password === "" ? PW_DEF : p.password);
  const d1 = normD(p.d1, D1_DEF), d2 = normD(p.d2, D2_DEF);
  // 偶数化补边（YUV 补 0）——与参考实现一致
  const Hp = H + (H % 2), Wp = W + (W % 2);
  const yuv = rgbToYuv(img);
  const planes = [yuv.y, yuv.u, yuv.v];
  const caH = Hp >> 1, caW = Wp >> 1;
  const bh = Math.floor(caH / BLOCK), bw = Math.floor(caW / BLOCK);
  const blockNum = bh * bw;
  if (!(bits.length < blockNum)) {
    throw new Error(`水印过长：需 ${bits.length} bit，本图仅能容纳 ${blockNum} bit（低频块 ${bw}×${bh}）`);
  }
  const idx = shuffleIdx(pw, blockNum);
  const outPlanes = [];
  for (let ch = 0; ch < 3; ch++) {
    const src = new Float64Array(Hp * Wp);
    const plane = planes[ch];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) src[y * Wp + x] = plane[y * W + x];
    const d = haarDwt1(src, Hp, Wp);
    const cA = d.cA;
    for (let bi = 0; bi < bh; bi++) {
      for (let bj = 0; bj < bw; bj++) {
        const i = bi * bw + bj;
        const bit = bits[i % bits.length];
        const off = (bi * BLOCK) * caW + bj * BLOCK;
        const F = dct4Block(cA, off, caW);
        const shuffled = new Float64Array(BLOCK * BLOCK);
        for (let k = 0; k < BLOCK * BLOCK; k++) shuffled[k] = F[idx[i * 16 + k]];
        const { u, s, v } = svd4(shuffled);
        s[0] = (Math.floor(s[0] / d1) + 1 / 4 + 1 / 2 * bit) * d1;
        if (d2) s[1] = (Math.floor(s[1] / d2) + 1 / 4 + 1 / 2 * bit) * d2;
        const rec = svdReconstruct(u, s, v);
        const plain = new Float64Array(BLOCK * BLOCK);
        for (let k = 0; k < BLOCK * BLOCK; k++) plain[idx[i * 16 + k]] = rec[k];
        const back = idct4Block(plain);
        for (let r = 0; r < BLOCK; r++) for (let c = 0; c < BLOCK; c++) {
          cA[(bi * BLOCK + r) * caW + bj * BLOCK + c] = back[r * BLOCK + c];
        }
      }
    }
    outPlanes.push(haarIdwt1({ cA, cH: d.cH, cV: d.cV, cD: d.cD }, caH, caW));
  }
  // 去补边
  const yy = new Float64Array(W * H), uu = new Float64Array(W * H), vv = new Float64Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      yy[y * W + x] = outPlanes[0][y * Wp + x];
      uu[y * W + x] = outPlanes[1][y * Wp + x];
      vv[y * W + x] = outPlanes[2][y * Wp + x];
    }
  }
  const rgba = yuvToRgb(yy, uu, vv, W, H);
  // 原图有透明通道时保留 alpha（参考实现 self.alpha 的处理）
  let hasAlpha = false;
  for (let i = 0; i < W * H; i++) if (img.data[i * 4 + 3] < 255) { hasAlpha = true; break; }
  if (hasAlpha) for (let i = 0; i < W * H; i++) rgba[i * 4 + 3] = img.data[i * 4 + 3];
  return { width: W, height: H, data: rgba };
}

/**
 * 提取：返回全部低频块的基本 bit（含冗余，未平均）。返回 {bits[3][blockNum], blockNum}。
 * 调用方按已知 wm_size 做 `i % wm_size` 平均。
 */
export function dwtSvdExtractRaw(img, p = {}) {
  const W = img.width, H = img.height;
  const pw = normSeed(p.password === undefined || p.password === "" ? PW_DEF : p.password);
  const d1 = normD(p.d1, D1_DEF), d2 = normD(p.d2, D2_DEF);
  const Hp = H + (H % 2), Wp = W + (W % 2);
  const yuv = rgbToYuv(img);
  const planes = [yuv.y, yuv.u, yuv.v];
  const caH = Hp >> 1, caW = Wp >> 1;
  const bh = Math.floor(caH / BLOCK), bw = Math.floor(caW / BLOCK);
  const blockNum = bh * bw;
  const idx = shuffleIdx(pw, blockNum);
  const bits = [];
  for (let ch = 0; ch < 3; ch++) {
    const src = new Float64Array(Hp * Wp);
    const plane = planes[ch];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) src[y * Wp + x] = plane[y * W + x];
    const { cA } = haarDwt1(src, Hp, Wp);
    const chBits = new Float64Array(blockNum);
    for (let bi = 0; bi < bh; bi++) {
      for (let bj = 0; bj < bw; bj++) {
        const i = bi * bw + bj;
        const off = (bi * BLOCK) * caW + bj * BLOCK;
        const F = dct4Block(cA, off, caW);
        const shuffled = new Float64Array(BLOCK * BLOCK);
        for (let k = 0; k < BLOCK * BLOCK; k++) shuffled[k] = F[idx[i * 16 + k]];
        const { s } = svd4(shuffled);
        let wm = ((s[0] % d1) + d1) % d1 > d1 / 2 ? 1 : 0;
        if (d2) {
          const tmp = ((s[1] % d2) + d2) % d2 > d2 / 2 ? 1 : 0;
          wm = (wm * 3 + tmp) / 4;
        }
        chBits[i] = wm;
      }
    }
    bits.push(chBits);
  }
  return { bits, blockNum, bh, bw };
}

/** 按 wmSize 做循环冗余 + 3 通道平均（复刻 extract_avg），返回 0/1 数组。 */
export function averageBits(raw, wmSize) {
  const { bits, blockNum } = raw;
  if (!(wmSize > 0) || wmSize > blockNum) {
    throw new Error(`wmBits 非法：需 1..${blockNum}，收到 ${wmSize}`);
  }
  const out = new Uint8Array(wmSize);
  for (let i = 0; i < wmSize; i++) {
    let sum = 0, cnt = 0;
    for (let ch = 0; ch < 3; ch++) {
      for (let j = i; j < blockNum; j += wmSize) { sum += bits[ch][j]; cnt++; }
    }
    out[i] = (sum / cnt) > 0.5 ? 1 : 0;
  }
  return out;
}

/**
 * 同 averageBits，但返回**未二值化**的均值（0..1）。
 * 图片水印模式直接把它当灰度用（参考实现 `extract` 对 img 分支做 `wm_avg * 255` 后写图，
 * 只有文本分支才走 `one_dim_kmeans` 二值化）。
 */
export function averageBitsFloat(raw, wmSize) {
  const { bits, blockNum } = raw;
  if (!(wmSize > 0) || wmSize > blockNum) {
    throw new Error(
      `水印尺寸超出容量：需 ${wmSize} 个位置，本图低频块只有 ${blockNum} 个（宽×高过大）`);
  }
  const out = new Float64Array(wmSize);
  for (let i = 0; i < wmSize; i++) {
    let sum = 0, cnt = 0;
    for (let ch = 0; ch < 3; ch++) {
      for (let j = i; j < blockNum; j += wmSize) { sum += bits[ch][j]; cnt++; }
    }
    out[i] = cnt ? sum / cnt : 0;
  }
  return out;
}

/**
 * 水印图 → 0/1 位流（行主序）。
 * 参考实现 `WaterMark.read_wm(mode="img")`：`cv2.imread(..., IMREAD_GRAYSCALE)` 读成**单通道灰度**
 * 后 flatten，再由 `bwm_core` 以 `> 200` 判白。故位序是**灰度图逐像素行主序**（不是 3 通道交错），
 * 位数 = 宽 × 高。
 */
export function imageToWmBits(img, thr = WM_GRAY_THR) {
  const W = img.width, H = img.height;
  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    // OpenCV BGR2GRAY 同系数（BT.601）
    const y = 0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2];
    out[i] = y > thr ? 1 : 0;
  }
  return out;
}

/** 0..1 灰度值 → RGBA（参考实现 `wm_avg * 255` 后写图）。 */
export function grayValuesToImage(vals, w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = clampRound255(vals[i] * 255);
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  return { width: w, height: h, data };
}

/**
 * 解析水印图尺寸。上游工具按 `× / * / x / ,` 四种分隔符解析（反编 zb_main_decompiled.py L10567-10578），
 * 本函数四种全收。
 */
export function parseWmShape(s) {
  const t = String(s == null ? "" : s).trim().toLowerCase().replace(/×/g, "x");
  const m = t.match(/^(\d+)\s*[x*,]\s*(\d+)$/);
  if (!m) return null;
  const w = parseInt(m[1], 10), h = parseInt(m[2], 10);
  if (!(w > 0) || !(h > 0)) return null;
  return { w, h };
}

/** 反向嵌入接口：按帧头自动定长（wmBits=0）或使用调用方给的位数。 */
export function dwtSvdExtract(img, p = {}) {
  const raw = dwtSvdExtractRaw(img, p);
  const want = Math.trunc(Number(p.wmBits) || 0);
  if (want > 0) return { mode: "raw", bits: averageBits(raw, want), wmBits: want };
  if (raw.blockNum < 32) {
    throw new Error(`图太小：低频块仅 ${raw.blockNum} 个，放不下 32 bit 长度头`);
  }
  const head = new Uint8Array(32);
  for (let i = 0; i < 32; i++) head[i] = raw.bits[0][i] > 0.5 ? 1 : 0; // 前 32 块 = 前 32 bit
  const lb = bitsToBytes(Array.from(head));
  const len = ((lb[0] << 24) | (lb[1] << 16) | (lb[2] << 8) | lb[3]) >>> 0;
  const total = 32 + len * 8;
  if (len === 0 || total > raw.blockNum) {
    throw new Error("未检测到有效 DWT-DCT-SVD 水印（可能口令/量化步长/d1/d2 与嵌入不一致，或该图无水印）");
  }
  const bits = averageBits(raw, total);
  const bytes = bitsToBytes(Array.from(bits).slice(32));
  return { mode: "text", text: new TextDecoder("utf-8", { fatal: false }).decode(bytes), wmBits: total };
}

function clampRound255(v) {
  if (!isFinite(v)) return 0;
  const r = Math.round(v);
  return r < 0 ? 0 : r > 255 ? 255 : r;
}

// ==================== 图像 IO 适配（与项目图像 op 约定一致） ====================

function b64ToBytes(s) {
  let str = String(s == null ? "" : s).trim().replace(/\s+/g, "");
  const comma = str.indexOf(",");
  if (comma >= 0 && str.slice(0, 5).toLowerCase() === "data:") str = str.slice(comma + 1);
  if (!str) return new Uint8Array(0);
  let bin;
  if (typeof atob === "function") bin = atob(str);
  else if (typeof Buffer !== "undefined") bin = Buffer.from(str, "base64").toString("binary");
  else return new Uint8Array(0);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function bytesToImageData(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!u8.length) throw new Error("空图片数据");
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
    try { return decodePNG(u8); } catch (e) {
      if (isLimitError(e)) throw e;
      /* 隔行等再试 canvas */
    }
  }
  if (typeof document !== "undefined" && typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(new Blob([u8]));
      // 宽高必须在 close() 之前取出：ImageBitmap.close() 之后 width/height getter 归零，
      // 写成 getImageData(0, 0, bmp.width, bmp.height) 会拿到 (0,0,0,0) 并抛 "The source width is 0"。
      const w = bmp.width, h = bmp.height;
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
      return ctx.getImageData(0, 0, w, h);
    } catch (e) {
      // 原实现把异常整个吞掉，导致任何底层失败都被报成「需浏览器环境」。这里带上真实原因。
      throw new Error("图片解码失败：非隔行 PNG 可在纯 JS 下解码；JPEG/GIF/隔行 PNG 等需浏览器环境" +
        "（底层原因：" + (e && e.message ? e.message : String(e)) + "）");
    }
  }
  throw new Error("图片解码失败：非隔行 PNG 可在纯 JS 下解码；JPEG/GIF/隔行 PNG 等需浏览器环境");
}

function imageDataToPNG(img) {
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    const id = ctx.createImageData(img.width, img.height);
    id.data.set(img.data);
    ctx.putImageData(id, 0, 0);
    return canvas.toDataURL("image/png");
  }
  return rgbaToDataURL(new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.length), img.width, img.height);
}

function inputBytes(text, p) {
  if (p && p.rawBytes && p.rawBytes.length) {
    return p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes);
  }
  const s = String(text == null ? "" : text);
  const t = s.trim();
  if (/^data:/i.test(t) || /^[A-Za-z0-9+/=\s]{16,}$/.test(t)) {
    const b = b64ToBytes(t);
    if (b.length) return b;
  }
  return dataURLToBytes(s);
}

/** 图片模式：取参数栏粘贴的水印图（base64/dataURL），与「图像差异对比」同约定。 */
async function wmImageData(p) {
  const src = p && p.wmImage != null ? String(p.wmImage).trim() : "";
  if (!src) return null;
  const bytes = b64ToBytes(src);
  if (!bytes.length) return null;
  return bytesToImageData(bytes);
}

const isImgMode = (p) => p && String(p.mode) === "img";
const pwWmOf = (p) => Math.trunc(Number(p && p.passwordWm) || 0);

/** 从（已解洗的）位流尝试按本项目帧头解析出文本；失败返回 null。 */
function tryParsePayloadBits(bitsArr) {
  const n = bitsArr.length;
  if (n < 32) return null;
  const lb = bitsToBytes(Array.from(bitsArr.slice(0, 32)));
  const len = ((lb[0] << 24) | (lb[1] << 16) | (lb[2] << 8) | lb[3]) >>> 0;
  const total = 32 + len * 8;
  if (len === 0 || total > n) return null;
  return new TextDecoder("utf-8", { fatal: false }).decode(bitsToBytes(Array.from(bitsArr.slice(32, total))));
}

async function dwtSvdEncodeOp(text, p = {}) {
  const img = await bytesToImageData(inputBytes(text, p));
  const pw = pwWmOf(p);
  if (isImgMode(p)) {
    const wm = await wmImageData(p);
    if (!wm) throw new Error("图片模式需把「水印图」的 base64/dataURL 粘贴到参数栏（拖入的是载体图）");
    let bits = imageToWmBits(wm, WM_GRAY_THR);
    if (pw > 0) bits = shuffleSeq(bits, pw);
    return imageDataToPNG(dwtSvdEmbed(img, bits, p));
  }
  const msg = p && p.message != null ? String(p.message) : "";
  if (!msg) throw new Error("请在「水印文本」参数中填入要嵌入的内容");
  let bits = buildPayloadBits(msg);
  if (pw > 0) bits = shuffleSeq(bits, pw);
  return imageDataToPNG(dwtSvdEmbed(img, bits, p));
}

async function dwtSvdDecodeOp(text, p = {}) {
  const img = await bytesToImageData(inputBytes(text, p));
  const pw = pwWmOf(p);
  if (isImgMode(p)) {
    const shape = parseWmShape(p.wmShape);
    if (!shape) {
      throw new Error("图片模式需在「水印图宽×高」参数给出尺寸（如 64x64）——"
        + "上游工具提取图片水印时同样要求这个 key（宽×高）");
    }
    const raw = dwtSvdExtractRaw(img, p);
    let avg = averageBitsFloat(raw, shape.w * shape.h);
    if (pw > 0) avg = unshuffleSeq(avg, pw);
    return imageDataToPNG(grayValuesToImage(avg, shape.w, shape.h));
  }
  const want = Math.trunc(Number(p.wmBits) || 0);
  if (pw > 0) {
    if (!(want > 0)) {
      throw new Error("文本模式用了水印序列口令（password_wm>0）时必须同时给出「水印位数」（wmBits>0）——"
        + "序列被洗牌后长度头无法自举；这与参考实现 mode='str' 需要 wmLength 是同一个约束");
    }
    const raw = dwtSvdExtractRaw(img, p);
    const bits = unshuffleSeq(averageBits(raw, want), pw);
    const asText = tryParsePayloadBits(bits);
    if (asText != null) return asText;
    return `(原始 bit 模式，wmBits=${want})\n` + Array.from(bits).join("").replace(/(.{64})/g, "$1\n");
  }
  const r = dwtSvdExtract(img, p);
  if (r.mode === "raw") {
    return `(原始 bit 模式，wmBits=${r.wmBits})\n` +
      r.bits.join("").replace(/(.{64})/g, "$1\n");
  }
  return r.text;
}

// ==================== 注册 ====================

register({
  id: "dwtSvdWatermark",
  cat: "stegoFile",
  name: "DWT-DCT-SVD 盲水印",
  desc:
    "真盲水印（只需含水印的单图即可提取）：Haar 一级小波低频子带 → 4×4 块 DCT → 奇异值量化嵌入，" +
    "password_img 决定块内置换、password_wm 决定水印序列洗牌，按 wmBits 做循环冗余 + 3 通道平均。" +
    "文本模式嵌入/提取文本；图片模式嵌入一张水印图（宽×高即提取 key），提取方向还原出水印图。",
  params: [
    { key: "mode", label: "水印类型", type: "select", default: "text",
      options: [{ value: "text", label: "文本" }, { value: "img", label: "图片" }] },
    { key: "message", label: "水印文本（文本模式）", type: "text", default: "",
      placeholder: "嵌入方向要写进图片的文本" },
    { key: "wmImage", label: "水印图（图片模式·嵌入用，可直接选图/拖图）", type: "image", default: "",
      placeholder: "把水印图的 base64/dataURL 粘到这里；拖入的是载体图" },
    { key: "wmShape", label: "水印图宽×高（图片模式·提取用）", type: "text", default: "",
      placeholder: "如 64x64；支持 x / * / , / × 四种分隔符（与上游工具一致）" },
    { key: "password", label: "口令 password_img", type: "number", default: PW_DEF,
      placeholder: "块内置换种子，默认 1；嵌入/提取必须一致" },
    { key: "passwordWm", label: "水印序列口令 password_wm（0=不洗牌）", type: "number", default: 0,
      placeholder: "默认 0 = 与旧版口径一致；>0 时按参考实现 RandomState(pw).shuffle 洗牌序列" },
    { key: "d1", label: "量化步长 d1（主奇异值）", type: "number", default: D1_DEF,
      placeholder: "默认 36；越大越鲁棒、失真越大" },
    { key: "d2", label: "量化步长 d2（次奇异值，0=不用）", type: "number", default: D2_DEF,
      placeholder: "默认 20；置 0 则只用量化 s[0]" },
    { key: "wmBits", label: "水印位数（0=按帧头自动）", type: "number", default: 0,
      placeholder: "0=本项目帧头自动定长；>0=直接取该位数（与参考实现互通、或 password_wm>0 时必填）" },
  ],
  encode: dwtSvdEncodeOp,
  decode: dwtSvdDecodeOp,
  acceptsBytes: true,
});

export default {
  shuffleIdx, seqShuffleIdx, shuffleSeq, unshuffleSeq,
  haarDwt1, haarIdwt1, dct4Block, idct4Block, svd4,
  buildPayloadBits, dwtSvdEmbed, dwtSvdExtractRaw, averageBits, averageBitsFloat,
  imageToWmBits, grayValuesToImage, parseWmShape, dwtSvdExtract,
};