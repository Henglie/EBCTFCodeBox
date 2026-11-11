/*
 * codeImageRecognize.js — 图形编码题目图片自动识别。
 *
 * 流程（全本地、零外发）：
 *   图片字节 → RGBA
 *     ├─ ZXing-C++(WASM) 全格式读码：二维码 / 条形码直接出文本与符号类型
 *     └─ 视觉对照：
 *          · 整图 dHash/aHash + 灰度直方图 → 截图/翻拍对照表匹配
 *          · 连通域切字形 → 16×16 归一化位图描述子 → 与对照表字形库投票
 *   输出 { barcodes, candidates, glyphCount, glyphKinds, ... }。
 *
 * 说明：字形投票只负责识别「像哪张对照表」；外星文字/游戏文字的
 * 字形→字母映射仍以对照表人工确认为准，不伪造完整解码结果。
 */
import { decodePNG } from "./stegoPixels.js";
import { isLimitError } from "./limitGuard.js";
import { zxingReadRgba } from "./qrZxing.js";
import { buildModel, classifyGlyph, loadExternalWeights, DEFAULT_TOPK, DESCRIPTOR_VERSION } from "./codeImageModel.js";

// ============================================================
// 图片解码
// ============================================================
function sniffMime(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.length > 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length > 2 && b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  const head = new TextDecoder("utf-8").decode(b.subarray(0, 512)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml") && head.includes("<svg")) return "image/svg+xml";
  return "";
}

function canvasFromSize(w, h) {
  if (typeof OffscreenCanvas === "function") {
    const cv = new OffscreenCanvas(w, h);
    return { canvas: cv, ctx: cv.getContext("2d", { willReadFrequently: true }) };
  }
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  return { canvas: cv, ctx: cv.getContext("2d", { willReadFrequently: true }) };
}

function drawToRgba(source, w, h) {
  if (!w || !h) throw new Error("图片尺寸为 0，无法识别");
  const { ctx } = canvasFromSize(w, h);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  return img.data;
}

export async function bytesToRgba(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    try {
      const png = decodePNG(b);
      return { width: png.width, height: png.height, data: png.data };
    } catch (e) {
      if (isLimitError(e)) throw e; /* 隔行/异常 PNG 交给浏览器 */
    }
  }
  if (typeof createImageBitmap !== "function" && typeof Image === "undefined") {
    throw new Error("非 PNG 图片需要浏览器环境解码；请先转成 PNG");
  }
  const mime = sniffMime(b);
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(new Blob([b], mime ? { type: mime } : undefined));
      const bw = bmp.width, bh = bmp.height;
      if (bw && bh) {
        const data = drawToRgba(bmp, bw, bh);
        try { bmp.close && bmp.close(); } catch { /* ignore */ }
        return { width: bw, height: bh, data };
      }
    } catch { /* 回退到 <img> */ }
  }
  if (typeof Image === "undefined") throw new Error("当前环境无法解码该图片");
  const url = URL.createObjectURL(new Blob([b], mime ? { type: mime } : undefined));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("图片解码失败"));
      img.src = url;
    });
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) throw new Error("图片尺寸无效");
    return { width: w, height: h, data: drawToRgba(img, w, h) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function toGray(data, w, h) {
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) {
    const a = data[i + 3] / 255;
    const r = data[i] * a + 255 * (1 - a);
    const gg = data[i + 1] * a + 255 * (1 - a);
    const bb = data[i + 2] * a + 255 * (1 - a);
    g[j] = Math.round(0.299 * r + 0.587 * gg + 0.114 * bb);
  }
  return g;
}

export function resizeGray(gray, w, h, nw, nh) {
  const out = new Uint8Array(nw * nh);
  const sx = w / nw, sy = h / nh;
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.min(h, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.min(w, Math.ceil((x + 1) * sx)));
      let sum = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        const row = yy * w;
        for (let xx = x0; xx < x1; xx++) { sum += gray[row + xx]; n++; }
      }
      out[y * nw + x] = n ? Math.round(sum / n) : 255;
    }
  }
  return out;
}

// ============================================================
// 整图感知哈希（aHash + dHash）与灰度直方图
// ============================================================
function hash64ToHex(bits) {
  let hex = "";
  for (let i = 0; i < 64; i += 4) {
    const nib = (bits[i] ? 8 : 0) | (bits[i + 1] ? 4 : 0) | (bits[i + 2] ? 2 : 0) | (bits[i + 3] ? 1 : 0);
    hex += nib.toString(16);
  }
  return hex;
}
function popcount32(x) {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

export function globalFingerprint(gray, w, h) {
  const small = resizeGray(gray, w, h, 9, 8);
  const aSmall = resizeGray(gray, w, h, 8, 8);
  let sum = 0;
  for (const v of aSmall) sum += v;
  const mean = sum / 64;
  const ah = new Array(64);
  for (let i = 0; i < 64; i++) ah[i] = aSmall[i] > mean;
  const dh = new Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) dh[y * 8 + x] = small[y * 9 + x] > small[y * 9 + x + 1];
  }
  const hist = new Array(16).fill(0);
  for (const v of aSmall) hist[Math.min(15, v >> 4)]++;
  return { ahash: hash64ToHex(ah), dhash: hash64ToHex(dh), hist };
}

function hashDistanceHex(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i += 8) {
    d += popcount32((parseInt(a.slice(i, i + 8), 16) ^ parseInt(b.slice(i, i + 8), 16)) >>> 0);
  }
  return d;
}

// ============================================================
// 字形切分 + 16×16 描述子
// ============================================================
function otsuThreshold(gray) {
  const hist = new Uint32Array(256);
  for (const v of gray) hist[v]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

// 16×16 位图 → 8 个 32 位字（256 bit）
function glyphBits(gray, w, h, box, threshold) {
  const { x0, y0, x1, y1 } = box;
  const bw = x1 - x0, bh = y1 - y0;
  const words = new Uint32Array(8);
  for (let gy = 0; gy < 16; gy++) {
    for (let gx = 0; gx < 16; gx++) {
      const sx0 = x0 + Math.floor(gx * bw / 16);
      const sx1 = Math.max(sx0 + 1, x0 + Math.ceil((gx + 1) * bw / 16));
      const sy0 = y0 + Math.floor(gy * bh / 16);
      const sy1 = Math.max(sy0 + 1, y0 + Math.ceil((gy + 1) * bh / 16));
      let ink = 0, n = 0;
      for (let y = sy0; y < sy1 && y < y1; y++) {
        const row = y * w;
        for (let x = sx0; x < sx1 && x < x1; x++) { if (gray[row + x] <= threshold) ink++; n++; }
      }
      const on = n > 0 && ink / n >= 0.42;
      if (on) words[(gy * 16 + gx) >> 5] |= (1 << ((gy * 16 + gx) & 31));
    }
  }
  return words;
}

const GLYPH_MIN_AREA = 18;
const GLYPH_MAX_AREA_RATIO = 0.12;

/** 候选图打分权重；后续可按语料调参，UI 通过 opts.weights 覆盖。 */
export const RECOGNIZE_WEIGHTS = Object.freeze({
  glyph: 0.58,
  hash: 0.24,
  hist: 0.12,
  aspect: 0.06,
});

function normalizeWeights(w) {
  const src = { ...RECOGNIZE_WEIGHTS, ...(w || {}) };
  const sum = src.glyph + src.hash + src.hist + src.aspect;
  if (!(sum > 0)) return { ...RECOGNIZE_WEIGHTS };
  return {
    glyph: src.glyph / sum,
    hash: src.hash / sum,
    hist: src.hist / sum,
    aspect: src.aspect / sum,
  };
}

/** 按行聚类 + 行内从左到右，得到阅读顺序；返回带 line 字段的新数组。 */
export function readingOrder(glyphs) {
  if (!glyphs.length) return [];
  const hs = glyphs.map((g) => g.y1 - g.y0).sort((a, b) => a - b);
  const medianH = hs[Math.floor(hs.length / 2)] || 8;
  const tol = Math.max(6, medianH * 0.55);
  const sorted = glyphs.slice().sort((a, b) => {
    const ca = (a.y0 + a.y1) / 2, cb = (b.y0 + b.y1) / 2;
    return ca - cb || a.x0 - b.x0;
  });
  const lines = [];
  for (const g of sorted) {
    const cy = (g.y0 + g.y1) / 2;
    let line = lines.find((l) => Math.abs(l.cy - cy) <= tol);
    if (!line) { line = { cy, items: [] }; lines.push(line); }
    line.items.push(g);
  }
  lines.sort((a, b) => a.cy - b.cy);
  const out = [];
  lines.forEach((line, li) => {
    line.items.sort((a, b) => a.x0 - b.x0);
    for (const g of line.items) out.push({ ...g, line: li });
  });
  return out;
}

/** 稳定字形键（跨刷新不变）：16×16 位图 + 宽高比一位小数。 */
export function glyphShapeKey(g) {
  return wordsToBase64(g.bits) + "|" + Number(g.aspect || 0).toFixed(1);
}

/**
 * 稳定槽位 id（A0）：对照表 id + 指纹字形下标。
 * 与现有 mapping 持久化键（chartId → labels[slot]）并存，不替代、不迁移。
 */
export function slotStableId(imageId, slot) {
  return String(imageId == null ? "" : imageId) + "#s" + Number(slot);
}

/**
 * 槽位分组（A0）：从字形 bbox 重建行/列/单元。
 * 不合并位图（指纹按连通域存原型，合并会破坏 d=0 对齐），只给每个字形
 * 标 row/col/cellId，并保留阅读顺序；多连通域符号各分量同属一个 cell。
 * 返回 { rows, cols, glyphs }，glyphs 带 row/col/cellId/line。
 */
export function groupGlyphs(glyphs, opts = {}) {
  const list = (Array.isArray(glyphs) ? glyphs : []).map((g) => ({
    ...g,
    cx: g.cx != null ? g.cx : (g.x0 + g.x1) / 2,
    cy: g.cy != null ? g.cy : (g.y0 + g.y1) / 2,
  }));
  const imageId = opts.imageId || "";
  if (!list.length) return { rows: 0, cols: 0, glyphs: [] };

  const hs = list.map((g) => g.y1 - g.y0).sort((a, b) => a - b);
  const ws = list.map((g) => g.x1 - g.x0).sort((a, b) => a - b);
  const medH = hs[hs.length >> 1] || 8;
  const medW = ws[ws.length >> 1] || 8;
  const rowTol = Math.max(6, medH * 0.6);
  const colTol = Math.max(6, medW * 0.9);

  const sorted = list.slice().sort((a, b) => (a.cy - b.cy) || (a.x0 - b.x0));
  const rows = [];
  for (const g of sorted) {
    let r = rows.find((x) => Math.abs(x.cy - g.cy) <= rowTol);
    if (!r) { r = { cy: g.cy, items: [] }; rows.push(r); }
    r.items.push(g);
  }
  rows.sort((a, b) => a.cy - b.cy);

  const centers = list.map((g) => g.cx).sort((a, b) => a - b);
  const cols = [];
  let cur = null;
  for (const c of centers) {
    if (!cur || c - cur.last > colTol) { cur = { sum: c, n: 1, last: c }; cols.push(cur); }
    else { cur.sum += c; cur.n++; cur.last = c; }
  }
  const colCenters = cols.map((c) => c.sum / c.n);

  const out = [];
  rows.forEach((row, ri) => {
    row.items.sort((a, b) => a.x0 - b.x0);
    for (const g of row.items) {
      let ci = 0, best = Infinity;
      for (let i = 0; i < colCenters.length; i++) {
        const d = Math.abs(g.cx - colCenters[i]);
        if (d < best) { best = d; ci = i; }
      }
      out.push({ ...g, row: ri, col: ci, line: ri, cellId: imageId ? imageId + "/r" + ri + "c" + ci : "r" + ri + "c" + ci });
    }
  });
  return { rows: rows.length, cols: colCenters.length, glyphs: out };
}

export function extractGlyphs(gray, w, h) {
  const threshold = otsuThreshold(gray);
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = gray[i] <= threshold ? 1 : 0;
  const visited = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  const out = [];
  const maxArea = Math.max(64, Math.floor(w * h * GLYPH_MAX_AREA_RATIO));
  for (let start = 0; start < ink.length; start++) {
    if (!ink[start] || visited[start]) continue;
    let top = 0;
    stack[top++] = start;
    visited[start] = 1;
    let area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0;
    while (top) {
      const p = stack[--top];
      const x = p % w, y = (p / w) | 0;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x > 0) { const q = p - 1; if (ink[q] && !visited[q]) { visited[q] = 1; stack[top++] = q; } }
      if (x < w - 1) { const q = p + 1; if (ink[q] && !visited[q]) { visited[q] = 1; stack[top++] = q; } }
      if (y > 0) { const q = p - w; if (ink[q] && !visited[q]) { visited[q] = 1; stack[top++] = q; } }
      if (y < h - 1) { const q = p + w; if (ink[q] && !visited[q]) { visited[q] = 1; stack[top++] = q; } }
    }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (area < GLYPH_MIN_AREA || area > maxArea) continue;
    if (bw < 3 || bh < 3 || bw > w * 0.9 || bh > h * 0.9) continue;
    const aspect = bw / bh;
    if (aspect < 0.08 || aspect > 12) continue;
    out.push({
      x0, y0, x1: x1 + 1, y1: y1 + 1, aspect, area,
      fill: area / Math.max(1, bw * bh),
      cx: (x0 + x1 + 1) / 2, cy: (y0 + y1 + 1) / 2,
      bits: glyphBits(gray, w, h, { x0, y0, x1: x1 + 1, y1: y1 + 1 }, threshold),
    });
  }
  // 过大图限制：按面积取最大的 160 个，避免背景纹理淹没真字形
  if (out.length > 160) out.sort((a, b) => b.area - a.area), out.length = 160;
  return { threshold, glyphs: out };
}

function wordsToBase64(words) {
  const bytes = new Uint8Array(words.length * 4);
  for (let i = 0; i < words.length; i++) {
    bytes[i * 4] = words[i] & 0xff;
    bytes[i * 4 + 1] = (words[i] >>> 8) & 0xff;
    bytes[i * 4 + 2] = (words[i] >>> 16) & 0xff;
    bytes[i * 4 + 3] = (words[i] >>> 24) & 0xff;
  }
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function base64ToWords(b64) {
  let bin;
  try { bin = atob(b64 || ""); } catch { return new Uint32Array(8); }
  const words = new Uint32Array(8);
  for (let i = 0; i < 8; i++) {
    const o = i * 4;
    words[i] = (bin.charCodeAt(o) | (bin.charCodeAt(o + 1) << 8) | (bin.charCodeAt(o + 2) << 16) | (bin.charCodeAt(o + 3) << 24)) >>> 0;
  }
  return words;
}

function glyphDistance(a, b) {
  return popcount32(a[0] ^ b[0]) + popcount32(a[1] ^ b[1]) + popcount32(a[2] ^ b[2]) + popcount32(a[3] ^ b[3])
    + popcount32(a[4] ^ b[4]) + popcount32(a[5] ^ b[5]) + popcount32(a[6] ^ b[6]) + popcount32(a[7] ^ b[7]);
}

// ============================================================
// 对照表索引（延迟构建，一次会话只建一次）
// ============================================================
let _index = null;
function buildIndex(fingerprints) {
  if (_index) return _index;
  const charts = [];
  for (const [id, fp] of Object.entries(fingerprints || {})) {
    const glyphs = [];
    for (const g of fp.glyphs || []) {
      glyphs.push({ words: base64ToWords(g.b), aspect: g.a / 100 });
    }
    charts.push({
      id,
      ahash: fp.ahash,
      dhash: fp.dhash,
      hist: fp.hist || null,
      aspect: fp.aspect || 1,
      glyphs,
    });
  }
  _index = charts;
  return charts;
}

function histSimilarity(a, b) {
  if (!a || !b) return 0;
  let inter = 0, total = 0;
  for (let i = 0; i < 16; i++) { inter += Math.min(a[i], b[i]); total += Math.max(a[i], b[i]); }
  return total ? inter / total : 0;
}

/**
 * 纯函数：整图候选打分（A0 抽出，便于评估脚本复用）。
 * fp = 查询整图指纹 { ahash, dhash, hist, aspect }；chart = 对照表指纹项；
 * glyphSim = 字形投票归一化得分 0..1；weights = normalizeWeights 结果。
 */
export function scoreChartCandidate(fp, chart, glyphSim, weights) {
  const dD = hashDistanceHex(fp.dhash, chart.dhash);
  const dA = hashDistanceHex(fp.ahash, chart.ahash);
  const hashSim = Math.max(0, 1 - (dD * 0.6 + dA * 0.4) / 64);
  const hSim = histSimilarity(fp.hist, chart.hist);
  const qA = Number(fp.aspect) > 0 ? Number(fp.aspect) : 1;
  const cA = Number(chart.aspect) > 0 ? Number(chart.aspect) : 1;
  const aspectSim = Math.min(qA, cA) / Math.max(qA, cA);
  return Math.max(0, Math.min(1,
    glyphSim * weights.glyph + hashSim * weights.hash + hSim * weights.hist + aspectSim * weights.aspect));
}

// 字形投票：每个 query 字形找全局最近邻，命中阈值内的最近邻给所属表计票。
function matchGlyphs(queryGlyphs, charts) {
  const votes = new Map();
  const usedRef = new Map();
  const threshold = 74;
  for (const q of queryGlyphs) {
    let best = null;
    for (const c of charts) {
      for (let i = 0; i < c.glyphs.length; i++) {
        const g = c.glyphs[i];
        const ra = g.aspect, qa = q.aspect;
        if (ra > qa * 2.2 || qa > ra * 2.2) continue;
        const d = glyphDistance(q.bits, g.words);
        if (!best || d < best.d) best = { d, chart: c.id, ref: i };
        if (best.d <= 18) break;
      }
      if (best && best.d <= 18) break;
    }
    if (!best || best.d > threshold) continue;
    const key = best.chart + "#" + best.ref;
    if (usedRef.has(key)) continue;
    usedRef.set(key, 1);
    const w = 1 - best.d / 256;
    votes.set(best.chart, (votes.get(best.chart) || 0) + w);
  }
  return votes;
}

// ============================================================
// 主入口
// ============================================================
export function normalizeLabels(mapping) {
  if (!mapping) return null;
  if (Array.isArray(mapping)) return mapping.map((v) => (v == null ? "" : String(v)));
  if (typeof mapping === "string") return mapping.split(",").map((v) => v);
  if (typeof mapping === "object" && Array.isArray(mapping.labels)) return mapping.labels.map((v) => (v == null ? "" : String(v)));
  return null;
}

/**
 * 单字形候选：模型在该对照表内的 top slots + 已保存/传入映射。
 * 没有 mapping 时 charCandidates 为空数组，slotCandidates 仍保留。
 * 候选只是候选，不冒充确定文本。
 */
export function buildGlyphCandidates(glyph, imageId, mapping, model, topK = DEFAULT_TOPK, descriptor = undefined) {
  const labels = normalizeLabels(mapping);
  const hits = model && glyph
    ? classifyGlyph(glyph.bits, glyph.aspect, model, topK, { imageId, descriptor })
    : [];
  const slotCandidates = hits.map((h) => ({
    slot: h.slot,
    distance: h.distance,
    score: h.score,
  }));
  const charCandidates = [];
  if (labels) {
    const seen = new Set();
    for (const h of hits) {
      const value = labels[h.slot];
      if (value == null || value === "") continue;
      const ch = String(value);
      if (seen.has(ch)) continue;
      seen.add(ch);
      charCandidates.push({ char: ch, score: h.score, slot: h.slot });
      if (charCandidates.length >= 3) break;
    }
  }
  return { slotCandidates, charCandidates };
}

/**
 * 把查询字形按阅读顺序对到指定对照表的字形槽位，并用映射表组装文本。
 * labels[slot] 为空 / 越界时输出 "?"，绝不按字母表顺序猜。
 */
function decodeChartSequence(chart, glyphs, mapping, model, topK = DEFAULT_TOPK, descriptor = undefined) {
  const labels = normalizeLabels(mapping);
  const out = [];
  let mapped = 0, unknown = 0;
  for (const g of glyphs) {
    let slot = -1, dist = 256;
    const hits = model && model.byImage && typeof model.byImage.has === "function" && model.byImage.has(chart.id)
      ? classifyGlyph(g.bits, g.aspect, model, 1, { imageId: chart.id, descriptor })
      : [];
    if (hits.length) {
      slot = hits[0].slot;
      dist = hits[0].distance;
    } else {
      // 回退：模型缺失时用原始 v1 位图检索
      let best = null;
      for (let i = 0; i < chart.glyphs.length; i++) {
        const ref = chart.glyphs[i];
        const ra = ref.aspect, qa = g.aspect;
        if (ra > qa * 2.2 || qa > ra * 2.2) continue;
        const d = glyphDistance(g.bits, ref.words);
        if (!best || d < best.d) best = { d, ref: i };
        if (best.d <= 18) break;
      }
      if (best) { slot = best.ref; dist = best.d; }
    }
    const ch = labels && slot >= 0 && labels[slot] != null ? labels[slot] : "";
    if (ch) mapped++; else unknown++;
    const cand = buildGlyphCandidates(g, chart.id, labels, model, topK, descriptor);
    out.push({
      slot,
      char: ch || "?",
      distance: dist,
      confidence: Math.max(0, 1 - dist / 256),
      row: g.row, col: g.col, cellId: g.cellId,
      line: g.line,
      shapeKey: g.shapeKey,
      slotCandidates: cand.slotCandidates,
      charCandidates: cand.charCandidates,
    });
  }
  let text = "", lastLine = -1;
  for (const g of out) {
    if (g.line !== lastLine) { if (lastLine >= 0) text += "\n"; lastLine = g.line; }
    text += g.char;
  }
  return { glyphs: out, text, mapped, unknown, total: out.length };
}

const _externalWeightsCache = new Map();
function getExternalWeights(opts) {
  if (opts.modelWeights !== undefined) return Promise.resolve(opts.modelWeights);
  if (opts.loadWeights === false) return Promise.resolve(null);
  const baseUrl = opts.modelBaseUrl || "public/models/";
  if (!_externalWeightsCache.has(baseUrl)) {
    _externalWeightsCache.set(baseUrl, loadExternalWeights({
      baseUrl,
      fetchImpl: opts.fetchImpl,
      cache: opts.modelCache,
    }));
  }
  return _externalWeightsCache.get(baseUrl);
}

export async function recognizeCodeImage(bytes, opts = {}) {
  const descriptor = Number(opts.descriptor) === 1 ? 1 : DESCRIPTOR_VERSION;
  const { width, height, data } = await bytesToRgba(bytes);
  const gray = toGray(data, width, height);
  const fp = globalFingerprint(gray, width, height);
  const extracted = extractGlyphs(gray, width, height);
  const grouped = groupGlyphs(extracted.glyphs);
  const glyphs = grouped.glyphs.map((g) => ({ ...g, shapeKey: glyphShapeKey(g) }));
  const glyphKinds = new Set(glyphs.map((g) => g.shapeKey)).size;
  const weights = normalizeWeights(opts.weights);

  // 二维码/条形码：ZXing 全格式。引擎缺失时静默降级。
  let barcodes = [];
  try {
    const hits = await zxingReadRgba(data, width, height, { formats: [] });
    if (Array.isArray(hits)) {
      const seen = new Set();
      for (const h of hits) {
        if (!h || !h.text || seen.has(h.format + "\n" + h.text)) continue;
        seen.add(h.format + "\n" + h.text);
        barcodes.push({ format: h.format || "", text: h.text });
      }
    }
  } catch { /* 读码失败不阻断视觉对照 */ }

  const externalWeights = opts.model ? null : await getExternalWeights(opts);
  const model = opts.model || buildModel(opts.fingerprints || {}, { weights: externalWeights, descriptor });
  const charts = buildIndex(opts.fingerprints || {});
  const manifest = opts.manifest || [];
  const byId = new Map(manifest.map((im) => [im.id, im]));
  const votes = matchGlyphs(glyphs, charts);
  const maxVotes = Math.max(1, Math.sqrt(Math.max(1, glyphs.length)) * 3);

  const candidates = [];
  for (const c of charts) {
    const im = byId.get(c.id);
    if (!im) continue;
    const dD = hashDistanceHex(fp.dhash, c.dhash);
    const dA = hashDistanceHex(fp.ahash, c.ahash);
    const hashSim = Math.max(0, 1 - (dD * 0.6 + dA * 0.4) / 64);
    const v = votes.get(c.id) || 0;
    const glyphSim = Math.min(1, v / maxVotes);
    if (v === 0 && hashSim < 0.72) continue;
    const score = scoreChartCandidate(fp, c, glyphSim, weights);
    if (score <= 0.12) continue;
    candidates.push({ image: im, score, glyphMatched: Math.round(v), hashSim });
  }
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, 6);
  const chartById = new Map(charts.map((c) => [c.id, c]));
  const mappings = opts.mappings || opts.glyphMaps || {};
  const sequences = top.map((c) => {
    const chart = chartById.get(c.image.id);
    const dec = chart ? decodeChartSequence(chart, glyphs, mappings[c.image.id], model, DEFAULT_TOPK, descriptor) : { glyphs: [], text: "", mapped: 0, unknown: glyphs.length, total: glyphs.length };
    return {
      chartId: c.image.id,
      image: c.image,
      score: c.score,
      text: dec.text,
      mapped: dec.mapped,
      unknown: dec.unknown,
      total: dec.total,
      chartGlyphCount: chart ? chart.glyphs.length : 0,
      glyphs: dec.glyphs,
    };
  });

  return {
    width,
    height,
    barcodes,
    candidates: top,
    sequences,
    weights,
    descriptor,
    model: model.meta,
    glyphCount: glyphs.length,
    glyphKinds,
    grid: { rows: grouped.rows, cols: grouped.cols },
    glyphBoxes: glyphs.map((g) => ({
      x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1,
      line: g.line, row: g.row, col: g.col, cellId: g.cellId,
      aspect: g.aspect, fill: g.fill, shapeKey: g.shapeKey,
    })),
    fingerprint: fp,
  };
}

export default {
  recognizeCodeImage, bytesToRgba, globalFingerprint, extractGlyphs,
  readingOrder, groupGlyphs, glyphShapeKey, slotStableId, scoreChartCandidate,
  toGray, resizeGray, RECOGNIZE_WEIGHTS,
  buildGlyphCandidates, normalizeLabels,
};

