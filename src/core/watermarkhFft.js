/*
 * watermarkhFft.js — WaterMarkH 频域隐形水印（内置版）
 *
 * 算法依据：与 WaterMarkH 1.2.0.0 样本输出的兼容性对拍验证（FFT 相位约定误差 ≤1e-15），
 * 证明它不是「不可复刻的私有格式」，而是一条定义清晰、可纯前端复刻的算法：
 *
 *   嵌入：输出像素 = 256 × | x + (α/√N)·DFT(W) |      α = 强度/500（默认 0.1），N = 宽×高
 *   提取：幅度谱   = | DFT(通道) | × 256 × (亮度/5)     —— 文字在频谱图上肉眼可读
 *
 * 原软件行为（照抄，勿凭直觉改）：
 *  · 图案 W = 黑底白字居中偏上，再做**中心对称镜像** p[n] = p[N-1-n]；图案被**直接当作频谱**叠加。
 *  · 像素归一化用**除以 256**（不是 255）；取**复数模**；`(int)` 是**向零截断**不是四舍五入。
 *  · 通道顺序无关（三通道叠同一图案，且取模对共轭不变），Alpha 不参与运算。
 *  · FFT 要求两方向都是 **2 的幂**，故有 5 种几何方案把原图变成 2 幂尺寸。
 *  · 提取输出是**幅度谱图**，靠人眼判读；无密钥、无纠错码、非鲁棒取证水印。
 *
 * 本内置版在原软件之上增强（原软件只支持「文字 + 居中偏上 + 手动亮度」）：
 *  · 图案来源可为**文字（多行）或图片**；可设位置；字号可调；
 *  · 提取可**自动增益**（免手调亮度）、**去背景归一化**、**压制镜像副本**（中心对称导致文字与
 *    其 180° 副本重叠，压制后小字更易辨认 —— 对有损 JPEG 样本尤其明显）。
 *
 * 数据契约：encode(text,p) / decode(text,p)，图走 p.rawBytes（拖入）或 text（粘贴 base64）。
 * 纯算法层（fft2/embedChannel/extractChannel/embedRGBA/extractRGBA/mirrorCenter）不依赖 DOM，node 可单测。
 */

import { register } from "./registry.js";
import { decodePNG, dataURLToBytes } from "./stegoPixels.js";
import { isLimitError } from "./limitGuard.js";
import { rgbaToDataURL } from "./mcMap.js";

const WM_GRAY_THR = 200;

// ==================== 自包含 radix-2 二维 FFT ====================
// 约定与 numpy 一致：正变换 e^{-i2π…}（无缩放），逆变换 e^{+i2π…} 且乘 1/N。
function fft1(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

/** 二维 FFT（就地副本）。w、h 均须为 2 的幂。返回 {re, im}（Float64Array）。 */
export function fft2(reIn, imIn, w, h, inverse) {
  const re = Float64Array.from(reIn), im = Float64Array.from(imIn);
  const rr = new Float64Array(w), ri = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) { rr[x] = re[y * w + x]; ri[x] = im[y * w + x]; }
    fft1(rr, ri, inverse);
    for (let x = 0; x < w; x++) { re[y * w + x] = rr[x]; im[y * w + x] = ri[x]; }
  }
  const cr = new Float64Array(h), ci = new Float64Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) { cr[y] = re[y * w + x]; ci[y] = im[y * w + x]; }
    fft1(cr, ci, inverse);
    for (let y = 0; y < h; y++) { re[y * w + x] = cr[y]; im[y * w + x] = ci[y]; }
  }
  if (inverse) {
    const s = 1 / (w * h);
    for (let i = 0; i < re.length; i++) { re[i] *= s; im[i] *= s; }
  }
  return { re, im };
}

export const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

// ==================== 核心（纯函数，node 可单测） ====================
/** 嵌入单通道：channel / pattern 均为 0..255，长度 w*h。 */
export function embedChannel(channel, pattern, w, h, alpha) {
  const N = w * h, sq = Math.sqrt(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = channel[i] / 256;
  const F = fft2(re, im, w, h, true);                 // 程序的正向 = N·ifft2
  const k = N / sq;
  for (let i = 0; i < N; i++) {
    F.re[i] = F.re[i] * k + alpha * (pattern[i] / 256);   // 图案当作频谱直接叠加
    F.im[i] = F.im[i] * k;
  }
  const y = fft2(F.re, F.im, w, h, false);            // 程序的逆向 = fft2
  const out = new Uint8ClampedArray(N);
  for (let i = 0; i < N; i++) {
    out[i] = clamp255(Math.sqrt(y.re[i] * y.re[i] + y.im[i] * y.im[i]) / sq * 256);
  }
  return out;
}

/** 提取单通道幅度谱。公式：|ifft2(X) · N/√N| · 256 · 增益
 *  （**乘以** N/√N；写成除以 √N 会少一个 √N 因子、谱整体塌成 0 —— 已实测踩过。） */
export function extractChannel(channel, w, h, gain) {
  const N = w * h, sq = Math.sqrt(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = channel[i] / 256;
  const F = fft2(re, im, w, h, true);
  const k = N / sq;
  const out = new Uint8ClampedArray(N);
  for (let i = 0; i < N; i++) {
    out[i] = clamp255(Math.sqrt(F.re[i] * F.re[i] + F.im[i] * F.im[i]) * k * 256 * gain);
  }
  return out;
}

export function embedRGBA(rgba, w, h, pattern, alpha) {
  const N = w * h;
  const outs = [0, 1, 2].map((c) => {
    const a = new Uint8Array(N);
    for (let i = 0; i < N; i++) a[i] = rgba[i * 4 + c];
    return embedChannel(a, pattern, w, h, alpha);
  });
  const out = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    out[i * 4] = outs[0][i]; out[i * 4 + 1] = outs[1][i]; out[i * 4 + 2] = outs[2][i];
    out[i * 4 + 3] = rgba[i * 4 + 3];
  }
  return out;
}

export function extractRGBA(rgba, w, h, gain) {
  const N = w * h;
  const outs = [0, 1, 2].map((c) => {
    const a = new Uint8Array(N);
    for (let i = 0; i < N; i++) a[i] = rgba[i * 4 + c];
    return extractChannel(a, w, h, gain);
  });
  const out = new Uint8ClampedArray(N * 4);
  for (let i = 0; i < N; i++) {
    out[i * 4] = outs[0][i]; out[i * 4 + 1] = outs[1][i]; out[i * 4 + 2] = outs[2][i];
    out[i * 4 + 3] = 255;
  }
  return out;
}

/** 中心对称镜像（复刻原软件 M96 的像素级镜像 p[n] = p[N-1-n]）。就地修改并返回。 */
export function mirrorCenter(pix) {
  const N = pix.length;
  for (let i = 0; i < Math.floor(N / 2); i++) pix[N - 1 - i] = pix[i];
  return pix;
}

/**
 * 提取增强：压制镜像副本。
 * 图案中心对称 ⇒ 频谱里文字与其 180° 旋转副本同时出现且常重叠。对每个像素取
 * `max(0, v - 旋转副本)` 可把「两者共有的部分」减掉，只留下非对称成分（文字本身），
 * 对有损压缩后字缘发糊的样本尤其有效。
 */
export function suppressMirror(spec, w, h) {
  const out = new Uint8ClampedArray(spec.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const j = ((h - 1 - y) * w + (w - 1 - x)) * 4;
      for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, spec[i + c] - spec[j + c]);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** 提取增强：去背景归一化（按分位数拉伸到 0..255），免手调亮度。 */
export function normalizeSpec(spec, lo = 0.60, hi = 0.995) {
  const N = spec.length / 4;
  const hist = new Uint32Array(256);
  for (let i = 0; i < N; i++) hist[spec[i * 4]]++;
  const pick = (frac) => { let acc = 0; const t = frac * N; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= t) return v; } return 255; };
  const a = pick(lo), b = Math.max(a + 1, pick(hi));
  const out = new Uint8ClampedArray(spec.length);
  for (let i = 0; i < spec.length; i++) {
    out[i] = i % 4 === 3 ? 255 : clamp255(((spec[i] - a) * 255) / (b - a));
  }
  return out;
}

/** 自动增益：二分找让频谱"不过曝也不过暗"的增益（以 99.5 分位接近 240 为目标）。 */
export function autoGain(rgba, w, h) {
  const N = w * h, sq = Math.sqrt(N);
  const re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = rgba[i * 4] / 256;
  const F = fft2(re, im, w, h, true);
  const k = N / sq;
  const vals = new Float64Array(N);
  for (let i = 0; i < N; i++) vals[i] = Math.sqrt(F.re[i] * F.re[i] + F.im[i] * F.im[i]) * k * 256;
  const sorted = Float64Array.from(vals).sort();
  const p995 = sorted[Math.floor(N * 0.995)] || 1;
  return Math.max(0.5, Math.min(10000, 240 / p995));
}

// ==================== 图案生成（文字 / 图片） ====================
const POSITIONS = [
  { value: "above", label: "居中偏上（原软件行为）" },
  { value: "center", label: "正中" },
  { value: "below", label: "居中偏下" },
  { value: "topleft", label: "左上" },
  { value: "bottomright", label: "右下" },
];

function textPattern(lines, w, h, px, position, font) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const cx = cv.getContext("2d");
  cx.fillStyle = "#000"; cx.fillRect(0, 0, w, h);
  cx.fillStyle = "#fff";
  const family = String(font || "SimHei").replace(/["'\\]/g, "").trim() || "SimHei";
  cx.font = `${px}px "${family}", "Microsoft YaHei", sans-serif`;
  cx.textAlign = "center"; cx.textBaseline = "middle";
  const lh = px * 1.15;
  const total = lines.length * lh;
  let cy = h / 2;
  if (position === "above") cy = h / 2 - total / 2;          // 整块文字落在中线上方
  else if (position === "below") cy = h / 2 + total / 2;
  if (position === "topleft") { cx.textAlign = "left"; for (let i = 0; i < lines.length; i++) cx.fillText(lines[i], px, px + lh * (i + 0.5)); }
  else if (position === "bottomright") { cx.textAlign = "right"; for (let i = 0; i < lines.length; i++) cx.fillText(lines[i], w - px, h - px - lh * (lines.length - 1 - i) - lh / 2); }
  else for (let i = 0; i < lines.length; i++) cx.fillText(lines[i], w / 2, cy + lh * (i + 0.5) - lh * lines.length / 2 + lh / 2);
  const id = cx.getImageData(0, 0, w, h);
  const N = w * h, g = new Uint8Array(N);
  for (let i = 0; i < N; i++) g[i] = id.data[i * 4];
  return mirrorCenter(g);
}

function imagePattern(img, w, h, thr) {
  const N = w * h, g = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(img.width - 1, Math.round((x / w) * img.width));
    const sy = Math.min(img.height - 1, Math.round((y / h) * img.height));
    const si = (sy * img.width + sx) * 4;
    const y2 = 0.299 * img.data[si] + 0.587 * img.data[si + 1] + 0.114 * img.data[si + 2];
    g[y * w + x] = y2 > thr ? 255 : 0;
  }
  return mirrorCenter(g);
}

// ==================== 图像 I/O ====================
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
      const w = bmp.width, h = bmp.height;
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
      return ctx.getImageData(0, 0, w, h);
    } catch (e) {
      throw new Error("图片解码失败：非隔行 PNG 可在纯 JS 下解码；JPEG/GIF/隔行 PNG 等需浏览器环境"
        + "（底层原因：" + (e && e.message ? e.message : String(e)) + "）");
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

// ==================== 几何方案（2 的幂画布） ====================
// 注意：不要直接 `new ImageData(...)` —— 该构造器在 Node / 非浏览器环境不存在。
// 一律用 ctx.createImageData(w,h) 再 set(data)，浏览器与垫片环境都可用。
function canvasOf(W, H, fill) {
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d");
  if (fill) { x.fillStyle = fill; x.fillRect(0, 0, W, H); }
  return { c, x };
}
function putImage(ctx, w, h, data) {
  const id = ctx.createImageData(w, h);
  id.data.set(data);
  ctx.putImageData(id, 0, 0);
}
function toPow2(w, h, data, scheme) {
  const p2r = (v) => Math.pow(2, Math.round(Math.log2(v)));
  const p2c = (v) => Math.pow(2, Math.ceil(Math.log2(v)));
  const p2f = (v) => Math.pow(2, Math.floor(Math.log2(v)));
  const baseO = canvasOf(w, h); putImage(baseO.x, w, h, data); const base = baseO.c;
  if (scheme === 1) { const W = p2r(w), H = p2r(h); const o = canvasOf(W, H); o.x.drawImage(base, 0, 0, w, h, 0, 0, W, H); return { c: o.c, W, H, back: null }; }
  if (scheme === 2 || scheme === 3) {
    const W = p2r(w), H = p2r(h); const o = canvasOf(W, H);
    o.x.imageSmoothingEnabled = scheme === 2; o.x.drawImage(base, 0, 0, w, h, 0, 0, W, H);
    return { c: o.c, W, H, back: (d) => resample(d, W, H, w, h, scheme === 2) };
  }
  if (scheme === 4) { const W = p2c(w), H = p2c(h); const o = canvasOf(W, H, "#fff"); o.x.drawImage(base, 0, 0); return { c: o.c, W, H, back: (d) => cropTo(d, W, H, w, h) }; }
  const W = p2f(w), H = p2f(h); const o = canvasOf(W, H); o.x.drawImage(base, 0, 0, W, H, 0, 0, W, H);
  return { c: o.c, W, H, back: (d) => pasteTL(data, w, h, d, W, H) };
}
const dataOf = (c) => c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
function resample(data, W, H, w, h, smooth) {
  const a = canvasOf(W, H); putImage(a.x, W, H, data);
  const b = canvasOf(w, h); b.x.imageSmoothingEnabled = smooth; b.x.drawImage(a.c, 0, 0, W, H, 0, 0, w, h);
  return dataOf(b.c);
}
function cropTo(data, W, H, w, h) {
  const a = canvasOf(W, H); putImage(a.x, W, H, data);
  const b = canvasOf(w, h); b.x.drawImage(a.c, 0, 0);
  return dataOf(b.c);
}
function pasteTL(orig, w, h, data, W, H) {
  const a = canvasOf(w, h); putImage(a.x, w, h, orig);
  const b = canvasOf(W, H); putImage(b.x, W, H, data);
  a.x.drawImage(b.c, 0, 0);
  return dataOf(a.c);
}

// ==================== op ====================
async function wmhEncode(text, p = {}) {
  const img = await bytesToImageData(inputBytes(text, p));
  const scheme = Math.min(5, Math.max(1, Math.trunc(Number(p.scheme) || 1)));
  const alpha = (Number.isFinite(Number(p.strength)) ? Number(p.strength) : 50) / 500;
  const useImg = String(p.pattern) === "image";
  const g = toPow2(img.width, img.height, img.data, scheme);

  let pattern;
  if (useImg) {
    const b = b64ToBytes(p.wmImage || "");
    if (!b.length) throw new Error("图案来源选了「图片」：点参数栏的上传按钮选择水印图，或直接把图片拖进该输入框（也可粘贴 base64/dataURL）");
    pattern = imagePattern(await bytesToImageData(b), g.W, g.H, Number(p.imgThr) || 128);
  } else {
    const raw = String(p.message == null ? "" : p.message);
    const lines = raw.split(/\||\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (!lines.length) throw new Error("请填写水印文字（多行用 | 或换行分隔）");
    pattern = textPattern(lines, g.W, g.H, Math.max(6, Math.trunc(Number(p.fontPx) || 13)), String(p.position || "above"), p.wmFont);
  }
  const embedded = embedRGBA(dataOf(g.c), g.W, g.H, pattern, alpha);
  const out = g.back ? g.back(embedded) : embedded;
  const ow = g.back ? img.width : g.W, oh = g.back ? img.height : g.H;
  return imageDataToPNG({ width: ow, height: oh, data: out });
}

async function wmhDecode(text, p = {}) {
  const img = await bytesToImageData(inputBytes(text, p));
  const scheme = Math.min(5, Math.max(1, Math.trunc(Number(p.scheme) || 1)));
  const g = toPow2(img.width, img.height, img.data, scheme);
  const rgba = dataOf(g.c);
  const gain = p.autoGain ? autoGain(rgba, g.W, g.H) : (Number.isFinite(Number(p.gain)) ? Number(p.gain) : 10);
  let spec = extractRGBA(rgba, g.W, g.H, gain);
  if (p.suppressMirror) spec = suppressMirror(spec, g.W, g.H);
  if (p.normalize) spec = normalizeSpec(spec);
  const png = imageDataToPNG({ width: g.W, height: g.H, data: spec });
  const extra = [p.autoGain ? `自动增益 ${gain.toFixed(1)}` : `增益 ${gain}`, p.suppressMirror ? "已压制镜像" : "", p.normalize ? "已归一化" : ""].filter(Boolean).join("，");
  return `WaterMarkH 水印提取（方案${scheme}，${extra}）—— 下方为 ${g.W}×${g.H} 幅度谱图，文字需人眼判读\n${png}`;
}

register({
  id: "watermarkhFft",
  cat: "stegoFile",
  name: "WaterMarkH 频域隐形水印",
  desc:
    "复刻 WaterMarkH（吾爱版 1.2.0.0）的隐形水印：把「黑底白字 + 中心对称镜像」的图案**直接当作频谱**，" +
    "按 输出 = 256×|x + (α/√N)·DFT(W)| 叠加到三通道；提取取通道**幅度谱**，文字在频谱图上肉眼可读。" +
    "需 2 的幂尺寸，故有 5 种几何方案。本版增强：图案可用文字（多行）或图片、可设位置，" +
    "提取支持自动增益 / 去背景归一化 / 压制镜像副本。无密钥、无纠错码。",
  acceptsBytes: true,
  aka: [
    "watermarkH", "watermarkh", "watermarkH盲水印", "频域隐形水印", "隐形水印", "图像水印",
    "盲水印", "图片盲水印", "水印隐写", "吾爱破解水印", "52pojie watermark",
    "fft watermark", "invisible watermark", "spectrum watermark", "水印提取",
  ],
  params: [
    { key: "pattern", label: "图案来源", type: "select", default: "text",
      options: [{ value: "text", label: "文字" }, { value: "image", label: "图片" }] },
    { key: "message", label: "水印文字（多行用 | 或换行）", type: "text", default: "", placeholder: "如 flag{...}｜第二行" },
    { key: "wmImage", label: "水印图（图案=图片时用，可直接选图/拖图）", type: "image", default: "", placeholder: "点右侧按钮选图或拖图进框，也可粘贴 base64/dataURL" },
    { key: "imgThr", label: "图片图案二值化阈值", type: "number", default: 128 },
    { key: "position", label: "图案位置", type: "select", default: "above", options: POSITIONS },
    { key: "fontPx", label: "字号(px)", type: "number", default: 13, placeholder: "默认 13 ≈ 黑体 9.75pt" },
    { key: "wmFont", label: "水印字体（可读取本机字体）", type: "text", default: "", placeholder: "留空 = 黑体 SimHei；可填系统字体名",
      datalist: ["SimHei", "黑体", "Microsoft YaHei", "微软雅黑", "SimSun", "宋体", "KaiTi", "楷体", "FangSong", "仿宋",
        "Arial", "Times New Roman", "Courier New", "Consolas", "Verdana", "Tahoma", "Georgia", "Impact"],
      localFonts: true },
    { key: "strength", label: "水印强度（默认 50 → α=0.1）", type: "number", default: 50 },
    { key: "scheme", label: "几何方案", type: "select", default: "1",
      options: [{ value: "1", label: "方案一（缩放输出）" }, { value: "2", label: "方案二（高质量缩放）" },
                { value: "3", label: "方案三（最近邻缩放）" }, { value: "4", label: "方案四（白底填充）" },
                { value: "5", label: "方案五（左上局部）" }] },
    { key: "gain", label: "提取增益（亮度/5，默认 10）", type: "number", default: 10 },
    { key: "autoGain", label: "提取：自动增益", type: "bool", default: false },
    { key: "suppressMirror", label: "提取：压制镜像副本", type: "bool", default: false },
    { key: "normalize", label: "提取：去背景归一化", type: "bool", default: false },
  ],
  encode: wmhEncode,
  decode: wmhDecode,
});

export default {
  fft2, embedChannel, extractChannel, embedRGBA, extractRGBA, mirrorCenter,
  suppressMirror, normalizeSpec, autoGain, isPow2,
};
