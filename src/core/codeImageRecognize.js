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
import { zxingReadRgba } from "./qrZxing.js";

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
    } catch { /* 隔行/异常 PNG 交给浏览器 */ }
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
    out.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, aspect, area, bits: glyphBits(gray, w, h, { x0, y0, x1: x1 + 1, y1: y1 + 1 }, threshold) });
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
export async function recognizeCodeImage(bytes, opts = {}) {
  const { width, height, data } = await bytesToRgba(bytes);
  const gray = toGray(data, width, height);
  const fp = globalFingerprint(gray, width, height);
  const { glyphs } = extractGlyphs(gray, width, height);
  const glyphKinds = new Set(glyphs.map((g) => {
    let s = "";
    for (const w of g.bits) s += w.toString(36) + ",";
    return s;
  })).size;

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

  const charts = buildIndex(opts.fingerprints || {});
  const manifest = opts.manifest || [];
  const byId = new Map(manifest.map((im) => [im.id, im]));
  const votes = matchGlyphs(glyphs, charts);
  const qAspect = width / height;
  const maxVotes = Math.max(1, Math.sqrt(Math.max(1, glyphs.length)) * 3);

  const candidates = [];
  for (const c of charts) {
    const im = byId.get(c.id);
    if (!im) continue;
    const dD = hashDistanceHex(fp.dhash, c.dhash);
    const dA = hashDistanceHex(fp.ahash, c.ahash);
    const hashSim = Math.max(0, 1 - (dD * 0.6 + dA * 0.4) / 64);
    const hSim = histSimilarity(fp.hist, c.hist);
    const aspectSim = Math.min(qAspect, c.aspect) / Math.max(qAspect, c.aspect);
    const v = votes.get(c.id) || 0;
    const glyphSim = Math.min(1, v / maxVotes);
    if (v === 0 && hashSim < 0.72) continue;
    const score = Math.max(0, Math.min(1,
      glyphSim * 0.58 + hashSim * 0.24 + hSim * 0.12 + aspectSim * 0.06));
    if (score <= 0.12) continue;
    candidates.push({ image: im, score, glyphMatched: Math.round(v), hashSim });
  }
  candidates.sort((a, b) => b.score - a.score);

  return {
    width,
    height,
    barcodes,
    candidates: candidates.slice(0, 6),
    glyphCount: glyphs.length,
    glyphKinds,
    fingerprint: fp,
  };
}

export default { recognizeCodeImage, bytesToRgba, globalFingerprint, extractGlyphs, toGray, resizeGray };

