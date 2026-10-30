// imageOps.js — 图像查看器/编辑器纯函数内核（无 DOM，Node 可直接测）。
//
// 图像对象统一为 { width, height, data: Uint8ClampedArray(RGBA) }，长度 = width*height*4。
// 所有函数不修改入参，返回新对象；颜色运算显式 Math.round + 截断，保证浏览器与 Node 同值。
//
// 几何约定：
// - rotate90/180/270 均为顺时针；rotateArbitrary 正角度同为顺时针。
// - resize 采用像素中心采样（与 Pillow / imageToolbox 的 NEAREST 口径一致）：
//   src = (dst + 0.5) * scale。
// - rotateArbitrary 默认扩展画布以容纳整图，越界填充背景色。
//
// 依赖：无。

const MAX_DIM = 16384;
const CHANNEL_ALIAS = {
  r: 0, red: 0,
  g: 1, green: 1,
  b: 2, blue: 2,
  a: 3, alpha: 3,
  gray: -1, grey: -1, luma: -1,
};

/** 判断是否为图像对象（宽松，不做分配）。 */
export function isImageLike(value) {
  return !!value && typeof value === "object" &&
    Number.isInteger(value.width) && Number.isInteger(value.height) &&
    value.data && typeof value.data.length === "number" &&
    value.data.length === value.width * value.height * 4;
}

/** 严格校验图像对象，失败抛出中文错误。 */
export function assertImage(image, label = "图像") {
  if (!image || typeof image !== "object") throw new Error(`${label}不是有效的图像对象`);
  const { width, height, data } = image;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`${label}尺寸无效：${width}×${height}`);
  }
  if (width > MAX_DIM || height > MAX_DIM) {
    throw new Error(`${label}尺寸超过上限 ${MAX_DIM}：${width}×${height}`);
  }
  if (!data || typeof data.length !== "number" || data.length !== width * height * 4) {
    throw new Error(`${label}数据长度应为 ${width * height * 4}，实际 ${data ? data.length : "null"}`);
  }
  return image;
}

function intInRange(label, value, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${label}必须为 ${min}-${max} 的整数，当前 ${value}`);
  }
  return n;
}

function numInRange(label, value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${label}必须为 ${min}-${max} 的数值，当前 ${value}`);
  }
  return n;
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function luma601(r, g, b) {
  return Math.round(r * 0.299 + g * 0.587 + b * 0.114);
}

/** 通道名/序号 → 0..3；gray/luma 返回 -1。 */
export function channelIndex(channel, fallback = 0) {
  if (channel == null || channel === "") channel = fallback;
  if (typeof channel === "number") {
    if (!Number.isInteger(channel) || channel < 0 || channel > 3) {
      throw new Error(`通道序号必须为 0-3，当前 ${channel}`);
    }
    return channel;
  }
  const key = String(channel).trim().toLowerCase();
  if (!(key in CHANNEL_ALIAS)) throw new Error(`未知通道：${channel}`);
  return CHANNEL_ALIAS[key];
}

/** 新建 RGBA 图像；rgba 为 4 分量颜色，默认全透明。 */
export function createImage(width, height, rgba = [0, 0, 0, 0]) {
  const w = intInRange("图像宽度", width, 1, MAX_DIM);
  const h = intInRange("图像高度", height, 1, MAX_DIM);
  const c = Array.isArray(rgba) && rgba.length === 4
    ? rgba.map((v) => Math.max(0, Math.min(255, Math.round(Number(v) || 0))))
    : null;
  if (!c) throw new Error("填充颜色必须是 4 个 0-255 分量");
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = c[3];
  }
  return { width: w, height: h, data };
}

/** 深拷贝图像。 */
export function cloneImage(image) {
  assertImage(image);
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data),
  };
}

/** 比较两张图尺寸与全部像素（测试/预览复用）。 */
export function imageEquals(a, b) {
  if (!isImageLike(a) || !isImageLike(b)) return false;
  if (a.width !== b.width || a.height !== b.height) return false;
  if (a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i++) {
    if (a.data[i] !== b.data[i]) return false;
  }
  return true;
}

// ============================================================
// 几何变换
// ============================================================

/** 顺时针 90°。 */
export function rotate90(image) {
  assertImage(image);
  const { width: w, height: h, data: src } = image;
  const dw = h, dh = w;
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const dx = h - 1 - y;
      const dy = x;
      const di = (dy * dw + dx) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return { width: dw, height: dh, data: out };
}

/** 顺时针 180°。 */
export function rotate180(image) {
  assertImage(image);
  const { width: w, height: h, data: src } = image;
  const out = new Uint8ClampedArray(src.length);
  const total = w * h;
  for (let i = 0; i < total; i++) {
    const di = (total - 1 - i) * 4;
    const si = i * 4;
    out[di] = src[si];
    out[di + 1] = src[si + 1];
    out[di + 2] = src[si + 2];
    out[di + 3] = src[si + 3];
  }
  return { width: w, height: h, data: out };
}

/** 顺时针 270°（即逆时针 90°）。 */
export function rotate270(image) {
  assertImage(image);
  const { width: w, height: h, data: src } = image;
  const dw = h, dh = w;
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const dx = y;
      const dy = w - 1 - x;
      const di = (dy * dw + dx) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return { width: dw, height: dh, data: out };
}

/** 按 90° 的整数倍旋转；turns 可为负，自动取模。 */
export function rotateQuarter(image, turns = 1) {
  assertImage(image);
  const n = Number(turns);
  if (!Number.isFinite(n)) throw new Error(`旋转倍数无效：${turns}`);
  const k = ((Math.trunc(n) % 4) + 4) % 4;
  if (k === 0) return cloneImage(image);
  if (k === 1) return rotate90(image);
  if (k === 2) return rotate180(image);
  return rotate270(image);
}

/** 水平翻转（左右镜像）。 */
export function flipH(image) {
  assertImage(image);
  const { width: w, height: h, data: src } = image;
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = (y * w + (w - 1 - x)) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return { width: w, height: h, data: out };
}

/** 垂直翻转（上下镜像）。 */
export function flipV(image) {
  assertImage(image);
  const { width: w, height: h, data: src } = image;
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    const dy = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const si = (y * w + x) * 4;
      const di = (dy * w + x) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * 裁剪。参数支持 crop(img, x, y, w, h) 或 crop(img, {x,y,width,height})。
 * 严格校验越界，避免静默产出错误尺寸。
 */
export function crop(image, x, y, width, height) {
  assertImage(image);
  let rect = { x, y, width, height };
  if (x && typeof x === "object") rect = x;
  const cx = intInRange("裁剪 x", rect.x ?? 0, 0, image.width - 1);
  const cy = intInRange("裁剪 y", rect.y ?? 0, 0, image.height - 1);
  const cw = intInRange("裁剪宽度", rect.width ?? rect.w, 1, image.width - cx);
  const ch = intInRange("裁剪高度", rect.height ?? rect.h, 1, image.height - cy);
  const { width: w, data: src } = image;
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let row = 0; row < ch; row++) {
    const si = ((cy + row) * w + cx) * 4;
    const di = row * cw * 4;
    out.set(src.subarray(si, si + cw * 4), di);
  }
  return { width: cw, height: ch, data: out };
}

/**
 * 缩放。参数支持 resize(img, w, h, "nearest"|"bilinear") 或 resize(img, {width,height,method})。
 * 最近邻使用像素中心采样：srcX = floor((dstX + 0.5) * srcW / dstW)。
 * 双线性同样使用中心对齐坐标，边界夹取，结果 Math.round。
 */
export function resize(image, width, height, method = "nearest") {
  assertImage(image);
  let w = width, h = height, mode = method;
  if (width && typeof width === "object") {
    w = width.width ?? width.w;
    h = width.height ?? width.h;
    mode = width.method ?? width.interpolation ?? method;
  }
  const dw = intInRange("缩放宽度", w, 1, MAX_DIM);
  const dh = intInRange("缩放高度", h, 1, MAX_DIM);
  const m = String(mode || "nearest").toLowerCase();
  if (m !== "nearest" && m !== "bilinear") {
    throw new Error(`缩放算法只能是 nearest 或 bilinear，当前 ${mode}`);
  }
  const { width: sw, height: sh, data: src } = image;
  const out = new Uint8ClampedArray(dw * dh * 4);
  const scaleX = sw / dw;
  const scaleY = sh / dh;

  if (m === "nearest") {
    for (let y = 0; y < dh; y++) {
      const sy = Math.min(sh - 1, Math.floor((y + 0.5) * scaleY));
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(sw - 1, Math.floor((x + 0.5) * scaleX));
        const si = (sy * sw + sx) * 4;
        const di = (y * dw + x) * 4;
        out[di] = src[si];
        out[di + 1] = src[si + 1];
        out[di + 2] = src[si + 2];
        out[di + 3] = src[si + 3];
      }
    }
    return { width: dw, height: dh, data: out };
  }

  for (let y = 0; y < dh; y++) {
    let fy = (y + 0.5) * scaleY - 0.5;
    fy = Math.max(0, Math.min(sh - 1, fy));
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, sh - 1);
    const wy = fy - y0;
    for (let x = 0; x < dw; x++) {
      let fx = (x + 0.5) * scaleX - 0.5;
      fx = Math.max(0, Math.min(sw - 1, fx));
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, sw - 1);
      const wx = fx - x0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const di = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - wx) + src[i10 + c] * wx;
        const bottom = src[i01 + c] * (1 - wx) + src[i11 + c] * wx;
        out[di + c] = clamp255(top * (1 - wy) + bottom * wy);
      }
    }
  }
  return { width: dw, height: dh, data: out };
}

function sampleBilinear(src, w, h, sx, sy) {
  if (sx < -0.5 || sx > w - 0.5 || sy < -0.5 || sy > h - 0.5) return null;
  const fx = Math.max(0, Math.min(w - 1, sx));
  const fy = Math.max(0, Math.min(h - 1, sy));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const wx = fx - x0;
  const wy = fy - y0;
  const i00 = (y0 * w + x0) * 4;
  const i10 = (y0 * w + x1) * 4;
  const i01 = (y1 * w + x0) * 4;
  const i11 = (y1 * w + x1) * 4;
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const top = src[i00 + c] * (1 - wx) + src[i10 + c] * wx;
    const bottom = src[i01 + c] * (1 - wx) + src[i11 + c] * wx;
    out[c] = clamp255(top * (1 - wy) + bottom * wy);
  }
  return out;
}

/**
 * 任意角旋转（顺时针，单位度）。
 * @param {object} image
 * @param {number} degrees
 * @param {object} [opts]
 * @param {boolean} [opts.expand=true] 扩展画布容纳整图；false 保持原尺寸（四角裁掉）
 * @param {"bilinear"|"nearest"} [opts.interpolation="bilinear"]
 * @param {number[]} [opts.background=[0,0,0,0]] 越界填充色
 */
export function rotateArbitrary(image, degrees, opts = {}) {
  assertImage(image);
  const deg = Number(degrees);
  if (!Number.isFinite(deg)) throw new Error(`旋转角度无效：${degrees}`);
  const norm = ((deg % 360) + 360) % 360;
  if (norm === 0) return cloneImage(image);
  if (norm === 90) return rotate90(image);
  if (norm === 180) return rotate180(image);
  if (norm === 270) return rotate270(image);

  const expand = opts.expand !== false;
  const smooth = String(opts.interpolation || "bilinear").toLowerCase() !== "nearest";
  const bgRaw = Array.isArray(opts.background) && opts.background.length === 4
    ? opts.background
    : [0, 0, 0, 0];
  const bg = bgRaw.map((v) => Math.max(0, Math.min(255, Math.round(Number(v) || 0))));
  const rad = norm * Math.PI / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const w = image.width;
  const h = image.height;
  const dw = expand
    ? Math.max(1, Math.ceil(Math.abs(w * cos) + Math.abs(h * sin) - 1e-9))
    : w;
  const dh = expand
    ? Math.max(1, Math.ceil(Math.abs(w * sin) + Math.abs(h * cos) - 1e-9))
    : h;
  if (dw > MAX_DIM || dh > MAX_DIM) throw new Error(`旋转后尺寸超过上限 ${MAX_DIM}：${dw}×${dh}`);

  const cx0 = (w - 1) / 2;
  const cy0 = (h - 1) / 2;
  const cx1 = (dw - 1) / 2;
  const cy1 = (dh - 1) / 2;
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const dy = y - cy1;
    for (let x = 0; x < dw; x++) {
      const dx = x - cx1;
      const sx = cos * dx + sin * dy + cx0;
      const sy = -sin * dx + cos * dy + cy0;
      const di = (y * dw + x) * 4;
      if (!smooth) {
        if (sx < -0.5 || sx > w - 0.5 || sy < -0.5 || sy > h - 0.5) {
          out[di] = bg[0]; out[di + 1] = bg[1]; out[di + 2] = bg[2]; out[di + 3] = bg[3];
          continue;
        }
        const ix = Math.max(0, Math.min(w - 1, Math.floor(sx + 0.5)));
        const iy = Math.max(0, Math.min(h - 1, Math.floor(sy + 0.5)));
        const si = (iy * w + ix) * 4;
        out[di] = image.data[si];
        out[di + 1] = image.data[si + 1];
        out[di + 2] = image.data[si + 2];
        out[di + 3] = image.data[si + 3];
        continue;
      }
      const px = sampleBilinear(image.data, w, h, sx, sy);
      if (!px) {
        out[di] = bg[0]; out[di + 1] = bg[1]; out[di + 2] = bg[2]; out[di + 3] = bg[3];
      } else {
        out[di] = px[0]; out[di + 1] = px[1]; out[di + 2] = px[2]; out[di + 3] = px[3];
      }
    }
  }
  return { width: dw, height: dh, data: out };
}

// ============================================================
// 颜色 / 通道 / 位平面
// ============================================================

/** 反色（RGB 取反，Alpha 不变）。 */
export function invert(image) {
  assertImage(image);
  const out = new Uint8ClampedArray(image.data);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 255 - out[i];
    out[i + 1] = 255 - out[i + 1];
    out[i + 2] = 255 - out[i + 2];
  }
  return { width: image.width, height: image.height, data: out };
}

/**
 * 亮度/对比度/饱和度联合调整，处理顺序：亮度 → 对比度 → 饱和度。
 * @param {object} image
 * @param {object} [options]
 * @param {number} [options.brightness=0] -255..255，RGB 直接相加
 * @param {number} [options.contrast=0]   -100..100，围绕 128 的乘数 (100+v)/100
 * @param {number} [options.saturation=0] -100..100，Rec.601 灰度为轴 (100+v)/100
 */
export function adjustImage(image, options = {}) {
  assertImage(image);
  const brightness = numInRange("亮度", options.brightness ?? 0, -255, 255);
  const contrast = numInRange("对比度", options.contrast ?? 0, -100, 100);
  const saturation = numInRange("饱和度", options.saturation ?? 0, -100, 100);
  if (brightness === 0 && contrast === 0 && saturation === 0) return cloneImage(image);
  const cf = (100 + contrast) / 100;
  const sf = (100 + saturation) / 100;
  const src = image.data;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    let r = src[i] + brightness;
    let g = src[i + 1] + brightness;
    let b = src[i + 2] + brightness;
    r = (r - 128) * cf + 128;
    g = (g - 128) * cf + 128;
    b = (b - 128) * cf + 128;
    if (sf !== 1) {
      const l = r * 0.299 + g * 0.587 + b * 0.114;
      r = l + (r - l) * sf;
      g = l + (g - l) * sf;
      b = l + (b - l) * sf;
    }
    out[i] = clamp255(r);
    out[i + 1] = clamp255(g);
    out[i + 2] = clamp255(b);
    out[i + 3] = src[i + 3];
  }
  return { width: image.width, height: image.height, data: out };
}

/** 提取单通道为灰度图（Alpha 置 255 便于查看）。alpha 通道按自身灰度显示。 */
export function extractChannel(image, channel = 0) {
  assertImage(image);
  const idx = channelIndex(channel);
  const src = image.data;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const v = idx < 0 ? luma601(src[i], src[i + 1], src[i + 2]) : src[i + idx];
    out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255;
  }
  return { width: image.width, height: image.height, data: out };
}

/** 分离 RGBA 四通道，各返回灰度图。 */
export function splitChannels(image) {
  assertImage(image);
  return {
    r: extractChannel(image, 0),
    g: extractChannel(image, 1),
    b: extractChannel(image, 2),
    a: extractChannel(image, 3),
  };
}

/**
 * 按映射重组单图通道（常用于通道分离后合并）。
 * mapping = { r: "r"|"g"|"b"|"a"|"gray"|0..3, g: ..., b: ..., a?: ... }；
 * 未给 a 时保留原 Alpha。灰度取 Rec.601。
 */
export function mapChannels(image, mapping = {}, options = {}) {
  assertImage(image);
  const map = {
    r: mapping.r ?? mapping.R ?? "r",
    g: mapping.g ?? mapping.G ?? "g",
    b: mapping.b ?? mapping.B ?? "b",
    a: mapping.a ?? mapping.A ?? null,
  };
  const idx = {
    r: channelIndex(map.r, 0),
    g: channelIndex(map.g, 1),
    b: channelIndex(map.b, 2),
    a: map.a == null ? null : channelIndex(map.a, 3),
  };
  const src = image.data;
  const out = new Uint8ClampedArray(src.length);
  const pick = (i, at) => (at < 0 ? luma601(src[i], src[i + 1], src[i + 2]) : src[i + at]);
  for (let i = 0; i < src.length; i += 4) {
    out[i] = pick(i, idx.r);
    out[i + 1] = pick(i, idx.g);
    out[i + 2] = pick(i, idx.b);
    out[i + 3] = idx.a == null ? src[i + 3] : pick(i, idx.a);
  }
  return { width: image.width, height: image.height, data: out };
}

function partInfo(part, label) {
  if (part == null) return null;
  if (isImageLike(part)) return { image: part, channel: 0, invert: false };
  if (typeof part === "object" && isImageLike(part.image)) {
    return {
      image: part.image,
      channel: channelIndex(part.channel ?? 0),
      invert: !!part.invert,
    };
  }
  throw new Error(`${label} 必须是图像或 {image, channel}`);
}

/**
 * 多图通道合并：{ r, g, b, a } 每项可为图像（默认取 R）或 {image, channel, invert}。
 * 缺省 R/G/B 填 0，缺省 A 填 255；所有输入图尺寸必须一致。
 */
export function mergeChannels(parts = {}, options = {}) {
  const names = ["r", "g", "b", "a"];
  const infos = {};
  let width = options.width;
  let height = options.height;
  for (const name of names) {
    const info = partInfo(parts[name], name);
    infos[name] = info;
    if (!info) continue;
    const img = info.image;
    if (width == null) { width = img.width; height = img.height; }
    if (img.width !== width || img.height !== height) {
      throw new Error(`通道 ${name} 尺寸 ${img.width}×${img.height} 与目标 ${width}×${height} 不一致`);
    }
  }
  if (width == null) throw new Error("mergeChannels 至少需要一个通道图像");
  intInRange("合并宽度", width, 1, MAX_DIM);
  intInRange("合并高度", height, 1, MAX_DIM);

  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    for (let c = 0; c < 4; c++) {
      const name = names[c];
      const info = infos[name];
      if (!info) {
        out[i + c] = c === 3 ? 255 : 0;
        continue;
      }
      const src = info.image.data;
      let v;
      if (info.channel < 0) v = luma601(src[i], src[i + 1], src[i + 2]);
      else v = src[i + info.channel];
      out[i + c] = info.invert ? 255 - v : v;
    }
  }
  return { width, height, data: out };
}

/**
 * 位平面可视化。
 * @param {object} image
 * @param {object} [options]
 * @param {string|number} [options.channel=0] r/g/b/a 或 0..3，gray 取灰度
 * @param {number} [options.bit=0] 0-7（0=LSB）
 * @param {boolean} [options.invert=false]
 * @param {number[]} [options.tint] 可选点亮色，如 [255,80,80]
 */
export function bitPlane(image, options = {}) {
  assertImage(image);
  const idx = channelIndex(options.channel ?? 0);
  const bit = intInRange("位平面", options.bit ?? 0, 0, 7);
  const inverted = !!options.invert;
  const tint = Array.isArray(options.tint) && options.tint.length === 3
    ? options.tint.map((v) => Math.max(0, Math.min(255, Math.round(Number(v) || 0))))
    : null;
  const src = image.data;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const base = idx < 0 ? luma601(src[i], src[i + 1], src[i + 2]) : src[i + idx];
    let on = (base >> bit) & 1;
    if (inverted) on ^= 1;
    if (tint) {
      out[i] = on ? tint[0] : 0;
      out[i + 1] = on ? tint[1] : 0;
      out[i + 2] = on ? tint[2] : 0;
    } else {
      const v = on ? 255 : 0;
      out[i] = v; out[i + 1] = v; out[i + 2] = v;
    }
    out[i + 3] = 255;
  }
  return { width: image.width, height: image.height, data: out };
}

// ============================================================
// 历史栈（撤销 / 重做 / 复位）
// ============================================================

/**
 * 创建快照式历史栈。所有快照深拷贝，调用方无需关心引用被修改。
 * @param {object} initial
 * @param {object} [options]
 * @param {number} [options.limit=50] 最多保留的快照数（含初始图）
 * @param {string} [options.label="打开"]
 */
export function createHistory(initial, options = {}) {
  assertImage(initial);
  const limit = Math.max(2, Math.min(500, Math.trunc(Number(options.limit) || 50)));
  const initialSnapshot = cloneImage(initial);
  let entries = [{ image: initialSnapshot, label: options.label || "打开" }];
  let index = 0;

  return {
    get length() { return entries.length; },
    get index() { return index; },
    get canUndo() { return index > 0; },
    get canRedo() { return index < entries.length - 1; },
    get current() { return entries[index].image; },
    get label() { return entries[index].label; },
    get labels() { return entries.map((e) => e.label); },
    /** 压入新快照（会截断重做分支）。 */
    push(image, label = "操作") {
      assertImage(image);
      const snapshot = cloneImage(image);
      entries = entries.slice(0, index + 1);
      entries.push({ image: snapshot, label: String(label) });
      if (entries.length > limit) entries.shift();
      index = entries.length - 1;
      return entries[index].image;
    },
    undo() {
      if (index > 0) index--;
      return entries[index].image;
    },
    redo() {
      if (index < entries.length - 1) index++;
      return entries[index].image;
    },
    reset() {
      entries = [{ image: cloneImage(initialSnapshot), label: options.label || "打开" }];
      index = 0;
      return entries[0].image;
    },
    getEntries() {
      return entries.map((e, i) => ({ index: i, label: e.label, image: e.image }));
    },
  };
}

// ============================================================
// 操作管线（可序列化，便于复现/批处理）
// ============================================================

/** 执行单个操作，op.type 见下方 switch。 */
export function applyOp(image, op = {}) {
  assertImage(image);
  const type = String(op.type || op.op || "").trim();
  switch (type) {
    case "rotate90": return rotate90(image);
    case "rotate180": return rotate180(image);
    case "rotate270": return rotate270(image);
    case "rotateQuarter": return rotateQuarter(image, op.turns ?? 1);
    case "rotate":
    case "rotateArbitrary":
      return rotateArbitrary(image, op.angle ?? op.degrees ?? op.value ?? 0, op);
    case "flipH": return flipH(image);
    case "flipV": return flipV(image);
    case "flip":
      return (String(op.axis || op.direction || "h").toLowerCase().startsWith("v")) ? flipV(image) : flipH(image);
    case "crop":
      return crop(image, {
        x: op.x ?? 0,
        y: op.y ?? 0,
        width: op.width ?? op.w,
        height: op.height ?? op.h,
      });
    case "resize":
    case "scale":
      return resize(image, {
        width: op.width ?? op.w,
        height: op.height ?? op.h,
        method: op.method ?? op.interpolation ?? "nearest",
      });
    case "adjust":
    case "color":
      return adjustImage(image, op);
    case "brightness":
      return adjustImage(image, { brightness: op.value ?? op.amount ?? 0 });
    case "contrast":
      return adjustImage(image, { contrast: op.value ?? op.amount ?? 0 });
    case "saturation":
      return adjustImage(image, { saturation: op.value ?? op.amount ?? 0 });
    case "invert": return invert(image);
    case "extractChannel":
    case "channel": return extractChannel(image, op.channel ?? 0);
    case "splitChannels": return splitChannels(image);
    case "mapChannels":
      return mapChannels(image, op.mapping || op.channels || op, op);
    case "bitPlane":
    case "bitplane": return bitPlane(image, op);
    case "none": return cloneImage(image);
    default:
      throw new Error(`未知图像操作：${type || "(空)"}`);
  }
}

/** 顺序执行多个操作。 */
export function applyOps(image, ops = []) {
  assertImage(image);
  if (!Array.isArray(ops)) throw new Error("操作列表必须是数组");
  let out = image;
  for (const op of ops) out = applyOp(out, op);
  return out;
}
