/*
 * qrscanSample.js — 二维码「图片态」前端：灰度二值化三档 + 网格采样
 *
 * 纯函数、零 UI 依赖、零第三方依赖。输入灰度数组与位图（1=暗），输出候选模块矩阵。
 *
 * 定位：这是「像素 → 模块矩阵」的一层。产品原有的二维码 op（qrDecode / qrParse /
 * qrFormatBrute）都只处理 0/1 矩阵，本层补上它们之前缺失的「读图」环节。
 *
 * 二值化三档：全局 Otsu / 局部自适应均值（积分图 Bradley-Roth 式）/ 固定阈值。
 * 候选枚举按「稳健外接框 + 游程众数估 pitch」生成，全部有界（见各函数注释里的预算说明）。
 */

import { checkLimit } from "./limitGuard.js";

// 合法 QR 尺寸：21 + 4k, k = 0..40
export const LEGAL_SIZES = Array.from({ length: 40 }, (_, i) => 21 + 4 * i);
const LEGAL_SET = new Set(LEGAL_SIZES);
const IMAGE_PIXELS_SOFT = 16 * 1024 * 1024;
const IMAGE_PIXELS_HARD = 64 * 1024 * 1024;

function _checkPixels(pixels, label, limit) {
  const n = Number(pixels);
  const soft = limit && Number.isFinite(Number(limit.soft)) ? Number(limit.soft) : IMAGE_PIXELS_SOFT;
  const hard = limit && Number.isFinite(Number(limit.hard)) ? Number(limit.hard) : IMAGE_PIXELS_HARD;
  if (!Number.isFinite(n) || n <= soft) return;
  const params = (limit && limit.params) || globalThis.__ebctfLimitParams || null;
  checkLimit({
    scope: "qrscanSample.pixels",
    actual: n,
    soft,
    hard,
    params,
    label,
    unit: " 像素",
  });
}

// ------------------------------------------------------------
// 二值化
// ------------------------------------------------------------

/** 全局 Otsu 阈值（返回 0..255） */
export function otsuThreshold(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i] & 255]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > bestVar) { bestVar = v; best = t; }
  }
  return best;
}

/** 积分图（局部均值用） */
function integralImage(gray, w, h) {
  const ii = new Float64Array((w + 1) * (h + 1));
  const W1 = w + 1;
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      ii[(y + 1) * W1 + (x + 1)] = ii[y * W1 + (x + 1)] + rowSum;
    }
  }
  return ii;
}

/**
 * 二值化：返回 { bits, w, h, ... }，1 = 暗（QR 深色模块），0 = 亮。
 * method: "otsu" | "adaptive" | "fixed"
 */
export function binarize(gray, w, h, method = "otsu", opt = {}, limit = null) {
  _checkPixels(w * h, `二维码二值化 ${w}×${h}`, limit);
  const bits = new Uint8Array(w * h);
  if (method === "fixed") {
    const th = opt.threshold == null ? 128 : opt.threshold;
    for (let i = 0; i < bits.length; i++) bits[i] = gray[i] < th ? 1 : 0;
    return { bits, w, h, method, threshold: th };
  }
  if (method === "adaptive") {
    const win = opt.window || 25;
    const C = opt.C == null ? 8 : opt.C;
    const r = Math.max(1, win >> 1);
    const ii = integralImage(gray, w, h);
    const W1 = w + 1;
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
        const area = (x1 - x0 + 1) * (y1 - y0 + 1);
        const s = ii[(y1 + 1) * W1 + (x1 + 1)] - ii[y0 * W1 + (x1 + 1)]
                - ii[(y1 + 1) * W1 + x0] + ii[y0 * W1 + x0];
        bits[y * w + x] = gray[y * w + x] < (s / area) - C ? 1 : 0;
      }
    }
    return { bits, w, h, method, window: win, C };
  }
  const th = otsuThreshold(gray);
  for (let i = 0; i < bits.length; i++) bits[i] = gray[i] < th ? 1 : 0;
  return { bits, w, h, method, threshold: th };
}

/** 极性反转 */
export function invertBits(bits) {
  const o = new Uint8Array(bits.length);
  for (let i = 0; i < bits.length; i++) o[i] = bits[i] ? 0 : 1;
  return o;
}

// ------------------------------------------------------------
// 稳健外接框：按行/列暗像素计数取占比 >= frac 的最大连续带
// （比 min/max 全量法抗噪：角落噪声、外框不会把外接框撑大）
//
// 跨稀疏间隙合并（为什么必须做）：符号里**完全合法**的一行可能只有极少暗模块
// ——例如某个模块行恰好只有 1 个暗模块，按 frac 阈值就会被判成「非符号区」，
// 于是行带被从中间切断，外接框取到更长的半截，原点与边长同时错开几十像素。
// 实测：一个 264×264 的 v1 符号，第 97–108 行只有 12 个暗像素（= 1 个模块宽），
// 被切成 [13..96]/[109..276] 两段后取长者 ⇒ y0 由 13 错到 109（错 96px）。
// 故选出最长段后，把与它相隔 ≤ max(2, ⌊n·frac⌋) 的相邻段并入（迭代，可连成片）。
// 静默区（整行 0 暗像素）通常远长于该阈值，不会被并入；角落噪声若自成一段，
// 与主段的间隙一般也远大于阈值。
// ------------------------------------------------------------
export function robustBBox(bits, w, h, frac = 0.08) {
  const rowCnt = new Int32Array(h), colCnt = new Int32Array(w);
  for (let y = 0; y < h; y++) {
    let c = 0;
    for (let x = 0; x < w; x++) if (bits[y * w + x]) c++;
    rowCnt[y] = c;
  }
  for (let x = 0; x < w; x++) {
    let c = 0;
    for (let y = 0; y < h; y++) if (bits[y * w + x]) c++;
    colCnt[x] = c;
  }
  const band = (cnt, n) => {
    let max = 0;
    for (let i = 0; i < n; i++) if (cnt[i] > max) max = cnt[i];
    if (!max) return null;
    const lim = Math.max(1, max * frac);
    const runs = [];
    let s = -1;
    for (let i = 0; i < n; i++) {
      if (cnt[i] >= lim) { if (s < 0) s = i; }
      else if (s >= 0) { runs.push({ s, e: i - 1 }); s = -1; }
    }
    if (s >= 0) runs.push({ s, e: n - 1 });
    if (!runs.length) return null;
    let bi = 0;
    for (let i = 1; i < runs.length; i++) {
      if (runs[i].e - runs[i].s > runs[bi].e - runs[bi].s) bi = i;
    }
    const gapLim = Math.max(2, Math.floor(n * frac));
    let bs = runs[bi].s, be = runs[bi].e;
    for (let i = bi - 1; i >= 0; i--) {
      if (bs - runs[i].e - 1 <= gapLim) bs = runs[i].s; else break;
    }
    for (let i = bi + 1; i < runs.length; i++) {
      if (runs[i].s - be - 1 <= gapLim) be = runs[i].e; else break;
    }
    return { s: bs, e: be };
  };
  const rb = band(rowCnt, h), cb = band(colCnt, w);
  if (!rb || !cb) return null;
  return { x0: cb.s, y0: rb.s, x1: cb.e, y1: rb.e,
           bw: cb.e - cb.s + 1, bh: rb.e - rb.s + 1 };
}

// ------------------------------------------------------------
// pitch 估计：全图行/列游程众数（限幅在 [1, maxPitch]）
// ------------------------------------------------------------
export function estimatePitchFromRuns(bits, w, h, opt = {}) {
  const maxPitch = Math.max(2, Math.floor(Math.min(w, h) / 6));
  const hist = new Int32Array(maxPitch + 2);
  const addLine = (getter, n) => {
    let prev = getter(0), run = 1;
    for (let i = 1; i < n; i++) {
      const v = getter(i);
      if (v === prev) run++;
      else {
        if (run <= maxPitch) hist[run]++;
        prev = v; run = 1;
      }
    }
    if (run <= maxPitch) hist[run]++;
  };
  for (let y = 0; y < h; y++) addLine((x) => bits[y * w + x], w);
  for (let x = 0; x < w; x++) addLine((y) => bits[y * w + x], h);
  let mode = 0, best = -1;
  for (let p = 1; p <= maxPitch; p++) {
    if (hist[p] > best) { best = hist[p]; mode = p; }
  }
  return { pitch: mode, hist: Array.from(hist), weight: best };
}

// ------------------------------------------------------------
// 采样：按 pitch 在 (ox,oy) 取 n×n 网格（格中心，可选小邻域多数表决）
// ------------------------------------------------------------
export function sampleGrid(bits, w, h, n, pitch, ox, oy, nb = 0) {
  const mat = [];
  const rad = Math.max(0, Math.min(nb, Math.floor(pitch / 2) - 1));
  const p = pitch;
  for (let r = 0; r < n; r++) {
    const row = new Array(n);
    for (let c = 0; c < n; c++) {
      const cx = ox + (c + 0.5) * p;
      const cy = oy + (r + 0.5) * p;
      if (!rad) {
        const x = Math.round(cx), y = Math.round(cy);
        row[c] = (x >= 0 && x < w && y >= 0 && y < h) ? bits[y * w + x] : 0;
      } else {
        let dark = 0, tot = 0;
        for (let dy = -rad; dy <= rad; dy++) {
          for (let dx = -rad; dx <= rad; dx++) {
            const x = Math.round(cx) + dx, y = Math.round(cy) + dy;
            if (x < 0 || x >= w || y < 0 || y >= h) continue;
            tot++; dark += bits[y * w + x] ? 1 : 0;
          }
        }
        row[c] = (tot && dark * 2 >= tot) ? 1 : 0;
      }
    }
    mat.push(row);
  }
  return mat;
}

/**
 * 枚举候选采样（有界）：
 *   主路径 —— 用游程众数估 pitch，反推版本 n≈bw/pitch，取邻近合法尺寸（±2）；
 *   兜底 —— 按「pitch 整数性」排序的合法尺寸，截断到 fallback 个。
 * 模型：
 *   bbox  ：外接框即符号本体                pitch = bw/n     原点 = (bb.x0, bb.y0)
 *   bboxQz：外接框含 4 模块静默区           pitch = bw/(n+8) 原点 = 4*pitch 偏置
 *   fullQz：整图含 4 模块静默区             pitch = w/(n+8)  原点 = 4*pitch 偏置
 */
export function enumerateSamplings(bits, w, h, opt = {}) {
  const fallback = opt.fallback == null ? 8 : opt.fallback;
  const bb = robustBBox(bits, w, h, opt.frac);
  const { pitch: pEst, weight } = estimatePitchFromRuns(bits, w, h, opt);
  const cands = [];
  const seen = new Set();
  const add = (model, n, pitch, ox, oy, why) => {
    if (!LEGAL_SET.has(n) || !(pitch >= 1)) return;
    const k = model + "@" + n + "@" + pitch.toFixed(3);
    if (seen.has(k)) return;
    seen.add(k);
    cands.push({ model, n, pitch, ox, oy, why,
                 intDefect: Math.abs(pitch - Math.round(pitch)) });
  };

  // 主路径：由 pitch 估计反推尺寸
  if (bb && pEst >= 1) {
    const nEst = Math.round(bb.bw / pEst);
    const near = new Set();
    for (let d = -2; d <= 2; d++) {
      const n = nEst + d;
      if (LEGAL_SET.has(n)) near.add(n);
    }
    // 也把 pitch 直接当作模块尺寸再试「含静默区」模型
    for (const n of near) {
      add("bbox", n, bb.bw / n, bb.x0, bb.y0, "pitchRun");
      add("bboxQz", n, bb.bw / (n + 8), bb.x0 + 4 * (bb.bw / (n + 8)), bb.y0 + 4 * (bb.bh / (n + 8)), "pitchRun+qz");
    }
    const nQz = Math.round(bb.bw / (pEst * (1 + 8 / Math.max(1, Math.round(bb.bw / pEst)))));
    if (LEGAL_SET.has(nQz)) add("fullQz", nQz, w / (nQz + 8), 4 * (w / (nQz + 8)), 4 * (h / (nQz + 8)), "pitchRunFull");
  }

  // 兜底：合法尺寸按「pitch 整数性」排序
  const arImg = Math.abs(w - h) / Math.max(w, h);
  if (arImg <= (opt.arTol == null ? 0.18 : opt.arTol)) {
    const pool = [];
    for (const n of LEGAL_SIZES) {
      if (w / (n + 8) >= 1) {
        const p = w / (n + 8);
        pool.push({ n, p, d: Math.abs(p - Math.round(p)) });
      }
    }
    pool.sort((a, b) => a.d - b.d);
    for (const it of pool.slice(0, fallback)) {
      add("fullQz", it.n, it.p, 4 * it.p, 4 * it.p, "fallback");
      add("bboxQz", it.n, (bb ? bb.bw : w) / (it.n + 8),
          (bb ? bb.x0 : 0) + 4 * ((bb ? bb.bw : w) / (it.n + 8)),
          (bb ? bb.y0 : 0) + 4 * ((bb ? bb.bh : h) / (it.n + 8)), "fallbackQz");
    }
    if (bb) {
      const ar = Math.abs(bb.bw - bb.bh) / Math.max(bb.bw, bb.bh);
      if (ar <= (opt.arTol == null ? 0.18 : opt.arTol)) {
        const p2 = [];
        for (const n of LEGAL_SIZES) {
          if (bb.bw / n >= 1) p2.push({ n, p: bb.bw / n, d: Math.abs(bb.bw / n - Math.round(bb.bw / n)) });
        }
        p2.sort((a, b) => a.d - b.d);
        for (const it of p2.slice(0, fallback)) add("bbox", it.n, it.p, bb.x0, bb.y0, "fallbackBBox");
      }
    }
  }
  return { bbox: bb, pitchEst: pEst, pitchWeight: weight, candidates: cands, total: cands.length };
}
