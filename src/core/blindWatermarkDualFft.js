/*
 * blindWatermarkDualFft.js — 双图 FFT 频域盲水印（半盲：需原图 + 合成图两张）。
 *
 * 定位：CTF「双图盲水印(key)」高频题型。载体图 + 水印图 → 合成图；解码时给
 * 「原图 + 合成图」两张图即可还原水印图（水印可为图，也可为渲染成图的文字）。
 * 与 dctWatermark（单图 DCT-QIM 文本水印）互补：那支只需合成图，本支必须两张图。
 *
 * 算法依据（权威源，冻结版本）：
 * - 参考实现 A：chishaxie/BlindWatermark 仓库 bwm.py（Python 2 原版，命令行
 *   `encode <image> <watermark> <image(encoded)>` / `decode <image> <image(encoded)> <watermark>`）。
 *   其头部默认参数 seed=20160930、alpha=3.0 即本 op 的默认值。
 * - 参考实现 B：本地工具反编源码中的同名函数（4 个菜单项「双图盲水印(key)加密/解密」），
 *   与 A 同构，额外暴露 seed 作为「key」，并有 oldseed（CPython 2 传统 shuffle）兼容分支。
 * - 原理出处：Cox, Kilian, Leighton, Shamoon, "Secure Spread Spectrum Watermarking for
 *   Multimedia", IEEE Trans. Image Processing, 6(12):1673–1687, 1997 — §III 加性扩频嵌入
 *   （在变换域把水印以 alpha 倍幅度加性叠加）。本支即其 DFT 版实例：F' = F + alpha·R，
 *   R 为「水印图经行列随机置乱 + 180° 镜像补齐」后的实矩阵。
 *
 * 数学（与参考实现逐行对应）：
 * 记载体 cv2 形状为 (H, W, 3)。hwm = zeros(⌊H/2⌋, W, 3)，把水印图贴到 hwm2[0:wh, 0:ww]。
 * 置乱：hwm[i][j] = hwm2[m[i]][n[j]]，(m, n) 由 seed 决定的随机置换（分别对行下标
 * 0..⌊H/2⌋-1 与列下标 0..W-1 洗牌）。
 * 镜像：rwm[i][j] = hwm[i][j]，且 rwm[H-1-i][W-1-j] = hwm[i][j]（180° 旋转副本）。
 * 嵌入：F = fft2(img)；输出 = Re(ifft2(F + alpha·rwm))，写盘转 uint8（四舍五入 + 钳位）。
 * 提取：rwm = Re((fft2(img_wm) - fft2(img)) / alpha)；
 *      wm[m[i]][n[j]] = uint8(rwm[i][j])（参考实现用 np.uint8 = 向零截断后 mod 256），
 *      再把下半区按 180° 镜像写回。仅需两张图，无需 seed 之外的密钥。
 *
 * 变换语义（必须与参考实现一致，否则真实样本一像素都解不出）：
 * 参考实现把 (H, W, 3) 整块数组交给 np.fft.fft2，numpy 默认对最后两个轴变换 ⇒ 实际是
 * 「逐行对 (宽 × 通道) 二维面做 DFT」，H 轴不参与。详见下面 fft2LastTwo 处的说明。
 *
 * 空域不可见性由 alpha 与「置乱后铺满上半区」共同保证：置乱把水印能量摊到整幅图。
 *
 * 数据契约（沿用项目图像 op 约定）：encode(text, p)、decode(text, p)，
 * 待处理图走 p.rawBytes（拖入）；第二张图从参数栏粘贴 base64/dataURL——
 * 单文件输入框放不下两张图，这与 imageDiff（双图运算）的既有做法一致。
 * 输出：encode 方向回带水印图的 PNG dataURL；decode 方向回还原出的水印图 PNG dataURL。
 *
 * 纯算法层（mt19937 / fft / dualFftEncode / dualFftDecode）不依赖 DOM，node 可单测。
 */

import { register } from "./registry.js";
import { decodePNG, dataURLToBytes } from "./stegoPixels.js";
import { isLimitError } from "./limitGuard.js";
import { rgbaToDataURL } from "./mcMap.js";

// ====================7（复刻 CPython random 与 numpy RandomState 两套定种） ====================
// 参考实现的置乱序列由 Python 随机数决定，必须逐位置复刻才能与真实样本/第三方工具互解。
// genrand_uint32 的 tempering 与 init_by_array / init_genrand 均按原论文与 CPython、numpy
// 的实现逐行对齐（init_genrand 对应 numpy.RandomState(int)；init_by_array 对应 CPython
// random.seed(int)）。JS 侧用 Math.imul 取 32 位乘法低半，与 C 的 uint32 溢出语义一致。

const MT_N = 624, MT_M = 397, MT_MATRIX_A = 0x9908b0df;
const MT_UPPER = 0x80000000, MT_LOWER = 0x7fffffff;

export class MT19937 {
  constructor() {
    this.mt = new Uint32Array(MT_N);
    this.mti = MT_N + 1;
  }
  /** numpy 旧式标量定种（Knuth PRNG 递推），等价 mt19937_seed(seed)。 */
  initGenrand(s) {
    this.mt[0] = s >>> 0;
    this.mti = MT_N;
    for (let i = 1; i < MT_N; i++) {
      const p = this.mt[i - 1];
      this.mt[i] = (Math.imul(1812433253, p ^ (p >>> 30)) + i) >>> 0;
    }
  }
  /** CPython random.seed(int) 的 init_by_array([seed])。 */
  initByArray(key) {
    this.initGenrand(19650218);
    let i = 1, j = 0;
    let k = Math.max(MT_N, key.length);
    while (k--) {
      const p = this.mt[i - 1];
      this.mt[i] = ((this.mt[i] ^ Math.imul(p ^ (p >>> 30), 1664525)) + key[j] + j) >>> 0;
      i++; j++;
      if (i >= MT_N) { this.mt[0] = this.mt[MT_N - 1]; i = 1; }
      if (j >= key.length) j = 0;
    }
    k = MT_N - 1;
    while (k--) {
      const p = this.mt[i - 1];
      this.mt[i] = ((this.mt[i] ^ Math.imul(p ^ (p >>> 30), 1566083941)) - i) >>> 0;
      i++;
      if (i >= MT_N) { this.mt[0] = this.mt[MT_N - 1]; i = 1; }
    }
    this.mt[0] = MT_UPPER;
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
  /** CPython random.random() 与 numpy random_sample 同公式：53 位 double。 */
  r53() {
    const a = this.u32() >>> 5, b = this.u32() >>> 6;
    return (a * 67108864.0 + b) / 9007199254740992.0;
  }
  getrandbits(k) {
    if (k <= 0) return 0;
    return this.u32() >>> (32 - k);
  }
}

/** CPython 3 random.shuffle：j = _randbelow(i+1)（getrandbits + 拒绝采样）。 */
function shuffleCp3(arr, mt) {
  for (let i = arr.length - 1; i >= 1; i--) {
    const n = i + 1;
    const k = 32 - Math.clz32(n); // = n.bit_length()
    let r = mt.getrandbits(k);
    while (r >= n) r = mt.getrandbits(k);
    const t = arr[i]; arr[i] = arr[r]; arr[r] = t;
  }
}

/** CPython 2 random.shuffle：j = int(random() * (i+1))。 */
function shuffleCp2(arr, mt) {
  for (let i = arr.length - 1; i >= 1; i--) {
    const j = Math.trunc(mt.r53() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
}

/**
 * 置乱序列对 (m, n)。variant: 'py3'（CPython 3）| 'py2'（CPython 2 传统 shuffle）。
 * 两档的 MT 定种相同（init_by_array），差别只在洗牌时随机数的取法。
 */
export function shuffleSeqs(H, W, seed, variant) {
  const mt = new MT19937();
  mt.initByArray([seed >>> 0]);
  const m = new Int32Array(Math.floor(H / 2));
  const n = new Int32Array(W);
  for (let i = 0; i < m.length; i++) m[i] = i;
  for (let i = 0; i < n.length; i++) n[i] = i;
  const sh = variant === "py2" ? shuffleCp2 : shuffleCp3;
  sh(m, mt);
  sh(n, mt);
  return { m, n };
}

// ==================== 任意长度 FFT ====================
// 长度任意（样本尺寸 400×626、414×306、952×1000 均非 2 的幂）：2 的幂走 radix-2
// Cooley-Tukey，其它长度走 Bluestein（chirp-z）拆成 2 的幂循环卷积。二者都是精确算法，
// 不做补零/重采样——重采样会破坏两张图之间的逐像素对齐，水印立刻解不出。

function fftPow2(re, im, n, inverse) {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const idx = i + k, jdx = i + k + half;
        const vr = re[jdx] * cr - im[jdx] * ci;
        const vi = re[jdx] * ci + im[jdx] * cr;
        re[jdx] = re[idx] - vr; im[jdx] = im[idx] - vi;
        re[idx] += vr; im[idx] += vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

function isPow2(n) { return (n & (n - 1)) === 0 && n > 0; }

const _bluesteinCache = new Map();

/** Bluestein 前向变换（原地）。n 任意，内部用 M=2^k ≥ 2n-1 的循环卷积。 */
function fftBluestein(re, im, n) {
  let ent = _bluesteinCache.get(n);
  if (!ent) {
    let M = 1;
    while (M < 2 * n - 1) M <<= 1;
    const cRe = new Float64Array(n), cIm = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const ang = Math.PI * ((k * k) % (2 * n)) / n; // 归约到 [0,2π) 保证精度
      cRe[k] = Math.cos(ang);
      cIm[k] = -Math.sin(ang); // w = exp(-iπk²/n)
    }
    const bRe = new Float64Array(M), bIm = new Float64Array(M);
    bRe[0] = 1; bIm[0] = 0;
    for (let k = 1; k < n; k++) {
      bRe[k] = cRe[k]; bIm[k] = -cIm[k];
      bRe[M - k] = cRe[k]; bIm[M - k] = -cIm[k];
    }
    fftPow2(bRe, bIm, M, false);
    ent = { M, cRe, cIm, bRe, bIm };
    _bluesteinCache.set(n, ent);
  }
  const { M, cRe, cIm, bRe, bIm } = ent;
  const aRe = new Float64Array(M), aIm = new Float64Array(M);
  for (let k = 0; k < n; k++) {
    aRe[k] = re[k] * cRe[k] - im[k] * cIm[k];
    aIm[k] = re[k] * cIm[k] + im[k] * cRe[k];
  }
  fftPow2(aRe, aIm, M, false);
  for (let k = 0; k < M; k++) {
    const r = aRe[k] * bRe[k] - aIm[k] * bIm[k];
    const i2 = aRe[k] * bIm[k] + aIm[k] * bRe[k];
    aRe[k] = r; aIm[k] = i2;
  }
  for (let k = 0; k < M; k++) aIm[k] = -aIm[k]; // 用共轭技巧做逆变换，省一套蝶形
  fftPow2(aRe, aIm, M, false);
  const invM = 1 / M;
  for (let k = 0; k < n; k++) {
    const cr = aRe[k] * invM, ci = -aIm[k] * invM;
    re[k] = cr * cRe[k] - ci * cIm[k];
    im[k] = cr * cIm[k] + ci * cRe[k];
  }
}

/** 任意长度 1D 前向 FFT（无归一化，numpy 约定：X[k]=Σ x[n] e^(-2πi kn/N)）。 */
export function fft1d(re, im) {
  const n = re.length;
  if (n <= 1) return;
  if (isPow2(n)) fftPow2(re, im, n, false);
  else fftBluestein(re, im, n);
}

// ---- 参考实现所用的 2D 变换语义（关键）----
// 参考实现把「高 × 宽 × 3 通道」的整块数组直接交给 np.fft.fft2。numpy 的 fft2 默认对
// **最后两个轴** 变换，于是对 (H, W, C) 数组实际执行的是：逐行对 (W, C) 这个二维面做
// 二维 DFT（W 轴 + 通道轴），H 轴不参与变换。这与「逐通道做 (H, W) 二维 FFT」完全不同，
// 且是**真实样本能解出、逐通道解不出**的那一种（已实测：真实样本按逐通道 FFT 解出的
// 是纯噪声）。为了与参考实现/真实样本互解，本模块严格复刻前者的语义。
// 归一化：fft2 不除；ifft2 除以被变换两轴长度之积 W·C。

const CH = 3; // 通道轴长度（参考实现恒为 3）

// 变换槽 → RGBA 数据通道索引。参考实现用 OpenCV 读图，数据是 BGR 序，故通道轴槽 0 = B。
// 这个次序不是无关细节：通道轴上的逆 DFT 把「槽内常量向量 (v,v,v)」映成 (v,0,0)，
// 即扰动只落在槽 0。灰度水印经此变换后只改动一个颜色通道——真实样本「合成图与原图
// 只在蓝通道不同」正是这一行为的直接证据（已实测：R/G 逐像素完全一致）。
// 若按 RGB 次序排布，通道轴相位不同，真实样本解出的就是噪声。
const SLOT2CH = [2, 1, 0];

/** 沿「宽」轴做 N 组 1D FFT（每组长度 W，在交错数组中步长为 C）。 */
function fftAlongW(re, im, W, H, C) {
  const rr = new Float64Array(W), ii = new Float64Array(W);
  for (let y = 0; y < H; y++) {
    for (let c = 0; c < C; c++) {
      const base = y * W * C + c;
      for (let w = 0; w < W; w++) { rr[w] = re[base + w * C]; ii[w] = im[base + w * C]; }
      fft1d(rr, ii);
      for (let w = 0; w < W; w++) { re[base + w * C] = rr[w]; im[base + w * C] = ii[w]; }
    }
  }
}

/** 沿通道轴做 W×H 组长度 C 的 DFT（直接求和，C=3 只有 9 项）。 */
function fftAlongChannel(re, im, W, H, C, inverse) {
  const tRe = new Float64Array(C), tIm = new Float64Array(C);
  const sgn = inverse ? 2 : -2;
  for (let p = 0; p < W * H; p++) {
    const base = p * C;
    for (let c = 0; c < C; c++) { tRe[c] = re[base + c]; tIm[c] = im[base + c]; }
    for (let m = 0; m < C; m++) {
      let sr = 0, si = 0;
      for (let c = 0; c < C; c++) {
        const ang = sgn * Math.PI * ((m * c) % C) / C;
        const cr = Math.cos(ang), ci = Math.sin(ang);
        sr += tRe[c] * cr - tIm[c] * ci;
        si += tRe[c] * ci + tIm[c] * cr;
      }
      re[base + m] = sr; im[base + m] = si;
    }
  }
}

/** np.fft.fft2 对 (H,W,C) 数组的前向变换（作用于最后两轴）。 */
function fft2LastTwo(re, im, W, H, C) {
  fftAlongW(re, im, W, H, C);
  fftAlongChannel(re, im, W, H, C, false);
}

/** np.fft.ifft2 对 (H,W,C) 数组的逆变换（除以 W·C）。 */
function ifft2LastTwo(re, im, W, H, C) {
  for (let i = 0; i < re.length; i++) im[i] = -im[i];
  fft2LastTwo(re, im, W, H, C);
  const s = 1 / (W * C);
  for (let i = 0; i < re.length; i++) { re[i] = re[i] * s; im[i] = -im[i] * s; }
}

// ==================== np.uint8 / cv2.imwrite 的数值语义 ====================
// 参考实现里两种转 8 位的方式不同，必须分别对齐，否则无法与权威实现逐位对拍：
// - 提取方向用 `np.uint8(x)`：向零截断后按 256 取模回绕（np.uint8(-1.5)=255、np.uint8(300.7)=44）。
// - 嵌入方向写出图片走 cv2.imwrite：四舍五入后钳位到 [0,255]。
function numpyUint8(v) {
  if (!isFinite(v)) return 0;
  const t = Math.trunc(v);
  return ((t % 256) + 256) % 256;
}
function clampRound255(v) {
  if (!isFinite(v)) return 0;
  const r = Math.round(v);
  if (r < 0) return 0;
  if (r > 255) return 255;
  return r;
}

// ==================== 内核：双图 FFT 盲水印 ====================

const DEF_SEED = 20160930;
const DEF_ALPHA = 3.0;

/**
 * 嵌入：carrier/wmImg 为 {width,height,data:Uint8ClampedArray(RGBA)}，返回同尺寸 RGBA。
 * p: { seed, alpha, variant }
 */
export function dualFftEncode(carrier, wmImg, p = {}) {
  const W = carrier.width, H = carrier.height;
  const seed = normSeed(p.seed);
  const alpha = normAlpha(p.alpha);
  const variant = p.variant === "py2" ? "py2" : "py3";
  const half = Math.floor(H / 2);
  const wh = wmImg.height, ww = wmImg.width;
  if (half <= wh || W <= ww) {
    throw new Error(
      `水印图放不下：载体 ${W}×${H} 可容纳水印图上限 ${Math.max(0, W - 1)}×${Math.max(0, half - 1)}` +
      `（参考实现要求 ⌊高/2⌋ 与 宽 都严格大于水印图尺寸）；当前水印图 ${ww}×${wh}`
    );
  }
  const { m, n } = shuffleSeqs(H, W, seed, variant);

  // hwm2：水印图贴在左上角；hwm：按 (m,n) 置乱
  const hwm = new Float64Array(half * W * 3);
  for (let i = 0; i < half; i++) {
    const srcRow = m[i];
    for (let j = 0; j < W; j++) {
      const srcCol = n[j];
      if (srcRow >= wh || srcCol >= ww) continue;
      const s = (srcRow * wmImg.width + srcCol) * 4;
      const d = (i * W + j) * 3;
      hwm[d] = wmImg.data[s + SLOT2CH[0]];
      hwm[d + 1] = wmImg.data[s + SLOT2CH[1]];
      hwm[d + 2] = wmImg.data[s + SLOT2CH[2]];
    }
  }

  // rwm：上半区 + 180° 镜像副本（同一份水印写两遍：原位置与 180° 旋转位置）
  const out = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  const re = new Float64Array(W * H * CH), im = new Float64Array(W * H * CH);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const base = (y * W + x) * CH, px = (y * W + x) * 4;
      for (let c = 0; c < CH; c++) re[base + c] = carrier.data[px + SLOT2CH[c]];
    }
  }
  fft2LastTwo(re, im, W, H, CH);
  for (let i = 0; i < half; i++) {
    for (let j = 0; j < W; j++) {
      const s = (i * W + j) * CH, d = ((H - 1 - i) * W + (W - 1 - j)) * CH;
      for (let c = 0; c < CH; c++) {
        re[s + c] += alpha * hwm[s + c];
        re[d + c] += alpha * hwm[s + c];
      }
    }
  }
  ifft2LastTwo(re, im, W, H, CH);
  for (let i = 0; i < W * H; i++) {
    for (let c = 0; c < CH; c++) out.data[i * 4 + SLOT2CH[c]] = clampRound255(re[i * CH + c]);
    out.data[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * 提取：orig/enc 为同尺寸 RGBA，返回水印图 RGBA（尺寸 = 载体尺寸，内容在原左上角）。
 * p: { seed, alpha, variant, outMode, mirrorAvg }
 */
export function dualFftDecode(orig, enc, p = {}) {
  const W = orig.width, H = orig.height;
  if (enc.width !== W || enc.height !== H) {
    throw new Error(`两张图尺寸必须一致：原图 ${W}×${H}，合成图 ${enc.width}×${enc.height}`);
  }
  const seed = normSeed(p.seed);
  const alpha = normAlpha(p.alpha);
  const variant = p.variant === "py2" ? "py2" : "py3";
  const outMode = p.outMode === "clamp" ? "clamp" : "wrap";
  const half = Math.floor(H / 2);
  const { m, n } = shuffleSeqs(H, W, seed, variant);

  // rwm 上半区 = 置乱后的水印；下半区 = 180° 镜像副本（同一份水印的冗余）
  const top = new Float64Array(half * W * CH);
  const lowRows = H - half;
  const low = new Float64Array(lowRows * W * CH);
  const re1 = new Float64Array(W * H * CH), im1 = new Float64Array(W * H * CH);
  const re2 = new Float64Array(W * H * CH), im2 = new Float64Array(W * H * CH);
  for (let i = 0; i < W * H; i++) {
    for (let c = 0; c < CH; c++) {
      re1[i * CH + c] = orig.data[i * 4 + SLOT2CH[c]];
      re2[i * CH + c] = enc.data[i * 4 + SLOT2CH[c]];
    }
  }
  fft2LastTwo(re1, im1, W, H, CH);
  fft2LastTwo(re2, im2, W, H, CH);
  for (let i = 0; i < half; i++) {
    for (let j = 0; j < W; j++) {
      const p = (i * W + j) * CH;
      for (let c = 0; c < CH; c++) top[p + c] = (re2[p + c] - re1[p + c]) / alpha;
    }
  }
  for (let i = 0; i < lowRows; i++) {
    // 下半区第 (H-1-i) 行是上半区第 i 行的镜像副本，列同理：把它按 180° 转回同位置
    const sy = H - 1 - i;
    for (let j = 0; j < W; j++) {
      const sx = W - 1 - j;
      const p = (sy * W + sx) * CH, q = (i * W + j) * CH;
      for (let c = 0; c < CH; c++) low[q + c] = (re2[p + c] - re1[p + c]) / alpha;
    }
  }

  // 逆置乱：wm[m[i]][n[j]] = top[i][j]
  const content = new Float64Array(half * W * CH);
  for (let i = 0; i < half; i++) {
    const dstRow = m[i];
    for (let j = 0; j < W; j++) {
      const d = (dstRow * W + n[j]) * CH;
      const s = (i * W + j) * CH;
      content[d] = top[s]; content[d + 1] = top[s + 1]; content[d + 2] = top[s + 2];
    }
  }
  // 镜像冗余平均：下半区旋转回来与上半区同位置取平均（水印被嵌了两遍）
  const useAvg = !!p.mirrorAvg;
  const rows = useAvg ? Math.min(half, lowRows) : 0;
  const contentLow = new Float64Array(half * W * CH);
  for (let i = 0; i < rows; i++) {
    const dstRow = m[i];
    for (let j = 0; j < W; j++) {
      const d = (dstRow * W + n[j]) * CH;
      const s = (i * W + j) * CH;
      contentLow[d] = low[s]; contentLow[d + 1] = low[s + 1]; contentLow[d + 2] = low[s + 2];
    }
  }

  const out = { width: W, height: H, data: new Uint8ClampedArray(W * H * 4) };
  const cv2u8 = (v) => (outMode === "clamp" ? clampRound255(v) : numpyUint8(v));
  for (let i = 0; i < half; i++) {
    for (let j = 0; j < W; j++) {
      for (let c = 0; c < CH; c++) {
        const k = (i * W + j) * CH + c;
        let v = content[k];
        if (useAvg && i < rows) v = (v + contentLow[k]) / 2;
        out.data[(i * W + j) * 4 + SLOT2CH[c]] = cv2u8(v);
      }
    }
  }
  // 下半区 = 上半区 180° 镜像（参考实现语义：镜像的是已量化的上半区像素）
  for (let i = 0; i < half; i++) {
    for (let j = 0; j < W; j++) {
      const a = (i * W + j) * 4, b = ((H - 1 - i) * W + (W - 1 - j)) * 4;
      out.data[b] = out.data[a];
      out.data[b + 1] = out.data[a + 1];
      out.data[b + 2] = out.data[a + 2];
    }
  }
  for (let i = 0; i < W * H; i++) out.data[i * 4 + 3] = 255;
  return out;
}

/**
 * 置乱变体判据：正确置乱把「大片平坦背景」还原成连续区域，错误置乱把同一批像素
 * 打散成噪点。两者像素多重集相同（行/列置换不改直方图），故只能用空间连续性判别：
 * 内容区相邻像素一阶差分均值，越小越像「真水印图」。
 */
export function variantScore(img) {
  const { width: W, height: H, data } = img;
  let sum = 0, cnt = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x + 1 < W; x++) {
      const a = (y * W + x) * 4, b = (y * W + x + 1) * 4;
      sum += Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) + Math.abs(data[a + 2] - data[b + 2]);
      cnt++;
    }
  }
  return cnt ? sum / cnt : Infinity;
}

function normSeed(v) {
  const n = Number(v);
  if (!isFinite(n)) return DEF_SEED;
  return Math.trunc(n) >>> 0;
}
function normAlpha(v) {
  const n = Number(v);
  if (!isFinite(n) || n === 0) return DEF_ALPHA;
  return n;
}

// ==================== 字节 / 图像 IO 适配 ====================

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

/**
 * 字节 → RGBA。
 * PNG 一律走纯 JS 解码（decodePNG）：与参考实现的「原样取 RGB」逐像素等价。
 * 刻意不用 canvas 解 PNG——canvas 会对半透明像素做 alpha 预乘/色彩管理，RGB 会被
 * 静默改写，而本算法是逐像素差分的（合成图减原图），任何改写都会毁掉水印。
 * 非 PNG（JPEG/BMP/GIF）才交给浏览器 canvas（纯 JS 侧只再兜底 BMP）。
 */
async function bytesToImageData(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!u8.length) throw new Error("空图片数据");
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
    try {
      return decodePNG(u8);
    } catch (e) {
      if (isLimitError(e)) throw e;
      /* 隔行/异常 PNG 再试 canvas */
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

/** RGBA → PNG dataURL。有 canvas 用 canvas（体积小），否则用纯 JS 编码器。 */
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

/** 取输入图字节：拖入走 p.rawBytes，粘贴走 base64/dataURL（与项目图像 op 一致）。 */
function inputBytes(text, p) {
  if (p && p.rawBytes && p.rawBytes.length) {
    return p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes);
  }
  const s = String(text == null ? "" : text);
  const trimmed = s.trim();
  if (/^data:/i.test(trimmed) || /^[A-Za-z0-9+/=\s]{16,}$/.test(trimmed)) {
    const b = b64ToBytes(trimmed);
    if (b.length) return b;
  }
  return dataURLToBytes(s);
}

async function secondImageData(p) {
  const src = p && p.secondImage != null ? String(p.secondImage).trim() : "";
  if (!src) return null;
  const bytes = b64ToBytes(src);
  if (!bytes.length) return null;
  return bytesToImageData(bytes);
}

async function dualEncodeOp(text, p = {}) {
  const carrier = await bytesToImageData(inputBytes(text, p));
  const wm = await secondImageData(p);
  if (!wm) {
    throw new Error("请把「水印图」的 base64/dataURL 粘贴到参数栏（本 op 需两张图：拖入的是载体图）");
  }
  return imageDataToPNG(dualFftEncode(carrier, wm, p));
}

async function dualDecodeOp(text, p = {}) {
  const enc = await bytesToImageData(inputBytes(text, p));
  const orig = await secondImageData(p);
  if (!orig) {
    throw new Error("请把「原图」的 base64/dataURL 粘贴到参数栏（本 op 需两张图：拖入的是含盲水印的合成图）");
  }
  if (p.variant === "auto") {
    const a = dualFftDecode(orig, enc, { ...p, variant: "py3" });
    const b = dualFftDecode(orig, enc, { ...p, variant: "py2" });
    return imageDataToPNG(variantScore(a) <= variantScore(b) ? a : b);
  }
  return imageDataToPNG(dualFftDecode(orig, enc, p));
}

// ==================== 注册 ====================

register({
  id: "dualFftWatermark",
  cat: "stegoFile",
  name: "双图盲水印(F) 频域叠加",
  desc:
    "双图盲水印（半盲）：载体图 + 水印图 → 合成图；给「原图 + 合成图」还原出水印图。" +
    "2D FFT 域加性扩频 + 行列随机置乱（seed 即工具里的 key）+ 180° 镜像补齐。" +
    "单张 base64 放不下两张图，第二张图从参数栏粘贴（同「图像差异对比」）。",
  params: [
    { key: "seed", label: "key（置乱随机种子）", type: "number", default: DEF_SEED,
      placeholder: "默认 20160930（参考实现默认值）；工具里可自定义 key" },
    { key: "alpha", label: "嵌强 alpha", type: "number", default: DEF_ALPHA,
      placeholder: "默认 3.0；越大越鲁棒、空域痕迹越重" },
    { key: "variant", label: "置乱序列实现", type: "select", default: "py3",
      options: [
        { value: "py3", label: "CPython 3 shuffle（默认）" },
        { value: "py2", label: "CPython 2 传统 shuffle" },
        { value: "auto", label: "自动（解码时两档各试一次，按水印连续性择优）" },
      ] },
    { key: "outMode", label: "解码出力（仅提取方向）", type: "select", default: "wrap",
      options: [
        { value: "wrap", label: "8 位回绕（与参考实现逐位一致）" },
        { value: "clamp", label: "钳位 0-255（观感更接近原水印图）" },
      ] },
    { key: "mirrorAvg", label: "镜像冗余平均去噪（仅提取方向）", type: "bool", default: false },
    { key: "secondImage", label: "第二张图（可直接选图/拖图）", type: "image", default: "",
      placeholder: "嵌入方向填水印图；提取方向填原图" },
  ],
  encode: dualEncodeOp,
  decode: dualDecodeOp,
  acceptsBytes: true,
});

export default {
  MT19937, shuffleSeqs, fft1d, dualFftEncode, dualFftDecode, variantScore,
};