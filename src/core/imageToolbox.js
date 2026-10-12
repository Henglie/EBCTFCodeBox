/*
 * imageToolbox.js — 图像处理工具组（cat:'image'，7 个新 op）。
 *
 * 背景：对照竞品「图片处理」面板补齐日常图像加工能力。全部纯前端 canvas/纯 JS，
 * 零第三方依赖、零外发；像素层算法不依赖 Canvas API（UI 层上传→dataURL→解码→
 * 处理→PNG dataURL 输出），与 stegoImage.js 的 imageBasic 同一管线约定。
 *
 * 覆盖（全部 run 单向，输出 PNG dataURL 预览 + files 下载字节）：
 * - imageCompress : 图片压缩（质量档 0-100 + 可选目标最大宽 + JPEG/PNG/WebP 重编码；
 *                   JPEG/WebP 走浏览器 canvas 编码器，PNG 走纯 JS 编码器全环境可用）
 * - imageGray     : 黑白化（gray=Rec.601 标准灰度，与 Pillow 'L' 模式同公式逐像素一致；
 *                   binary=阈值二值化）
 * - imagePixelate : 像素化（方块平均，块内取均值，边缘不满块按实际面积收缩平均）
 * - imageFrosted  : 毛玻璃（盒模糊 box blur，水平+垂直两遍分离卷积，边缘窗口收缩）
 * - imageSketch   : 转素描（dodge=灰度反相盒模糊后颜色减淡混合，经典铅笔素描；
 *                   edge=Sobel 算子边缘提取，白底黑线）
 * - imageToText   : 图片文字化（字符画：亮度→字符梯度映射，输出列数可调，纯文本产物）
 * - gifCompose    : GIF 合成（多图 + 每帧延时 → GIF89a，自实现 LZW 压缩 +
 *                   Graphic Control Extension 帧延时 + NETSCAPE2.0 循环标志，
 *                   gifFrames 的反向闭环；中位切分法调色板量化 ≤256 色）
 *
 * 复用：stegoPixels.js 的 decodePNG（纯 JS PNG 解码，Node 回归可对拍）与
 * encodePNG/rgbaToDataURL（手写最小 PNG 编码器）。
 *
 * 数值口径（对拍基准 Pillow 12.3）：
 * - 灰度：L = (R*299 + G*587 + B*114) / 1000，整除截断（Pillow convert('L') 同式）。
 * - 最近邻缩放：src = min(N-1, floor((dst+0.5) * Nsrc / Ndst))（Pillow NEAREST 同中心约定）。
 * - 盒模糊：分离两遍，窗口 2r+1，边缘窗口按实际像素数平均，中间过程保持浮点精度。
 * - 像素化：块内算术平均四舍五入；边缘块按实际覆盖像素收缩平均。
 *
 * 红线：纯本地纯 JS，零外发；参数越界/非图片输入显式抛错（中文文案含 op 名）。
 */
import { register } from "./registry.js";
import { decodePNG, dataURLToBytes, encodePNG, rgbaToDataURL } from "./stegoPixels.js";

// ============================================================
// 共用：输入解码 / 输出封装
// ============================================================

/** 取输入字节：优先拖入文件的真字节通道（params.rawBytes），否则按 base64/dataURL 解析。 */
function _toolInBytes(text, p, opName) {
  if (p && p.rawBytes && p.rawBytes.length) return new Uint8Array(p.rawBytes);
  try {
    return dataURLToBytes(text);
  } catch (e) {
    throw new Error(opName + "：" + (e && e.message ? e.message : "输入为空，请拖入或粘贴图片文件"));
  }
}

/** 浏览器 canvas 解码兜底（JPEG/GIF/BMP/WebP 等 decodePNG 不吃的格式）。 */
async function _canvasDecode(bytes) {
  if (typeof document === "undefined") throw new Error("无浏览器 canvas");
  const blob = new Blob([bytes]);
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  bmp.close && bmp.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** 图片字节 → { width, height, data:Uint8ClampedArray(RGBA) }。
 *  两级策略：先纯 JS decodePNG（像素精确、Node 可跑），失败再走浏览器 canvas。 */
async function _toolDecodeImage(text, p, opName) {
  const bytes = _toolInBytes(text, p, opName);
  if (bytes.length < 8) throw new Error(opName + "：输入不是有效图片（数据过短）");
  try {
    return decodePNG(bytes);
  } catch (pngErr) {
    try {
      return await _canvasDecode(bytes);
    } catch {
      throw new Error(
        opName + "：无法解码图片——不是有效图片或格式不支持（PNG 全型支持；" +
        "JPG/BMP/GIF/WebP 需浏览器环境）"
      );
    }
  }
}

/** RGBA 结果 → 产物协议：text=PNG dataURL（UI 预览）+ files 下载字节。 */
function _toolOutPng(img, fileName) {
  const dataUrl = rgbaToDataURL(img.data, img.width, img.height);
  const bytes = encodePNG(img.data, img.width, img.height);
  return {
    text: dataUrl,
    files: [{ name: fileName, mime: "image/png", bytes }],
  };
}

/** Rec.601 标准灰度（Pillow convert('L') 同式：整除截断）。 */
function _lum601(r, g, b) {
  return Math.floor((r * 299 + g * 587 + b * 114) / 1000);
}

/** 最近邻缩放（中心约定，与 Pillow NEAREST 逐像素一致）。 */
function _nnResize(img, dw, dh) {
  const out = new Uint8ClampedArray(dw * dh * 4);
  const sx = img.width / dw, sy = img.height / dh;
  for (let y = 0; y < dh; y++) {
    const srcY = Math.min(img.height - 1, Math.floor((y + 0.5) * sy));
    for (let x = 0; x < dw; x++) {
      const srcX = Math.min(img.width - 1, Math.floor((x + 0.5) * sx));
      const di = (y * dw + x) * 4;
      const si = (srcY * img.width + srcX) * 4;
      out[di] = img.data[si]; out[di + 1] = img.data[si + 1];
      out[di + 2] = img.data[si + 2]; out[di + 3] = img.data[si + 3];
    }
  }
  return { width: dw, height: dh, data: out };
}

/** 校验整数参数：合法返回数值，否则抛「<opName>：<label>需为 <lo>-<hi> 的整数」。 */
function _intInRange(opName, v, lo, hi, label, dft) {
  const n = (v === "" || v == null) ? dft : Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) {
    throw new Error(opName + "：" + label + "需为 " + lo + "-" + hi + " 的整数，当前 " + v);
  }
  return n;
}

// ============================================================
// 共用：分离盒模糊（毛玻璃 / 素描 dodge 共用）
// ============================================================
// 两遍分离卷积：先水平后垂直。窗口 [x-r, x+r] 共 (2r+1) 个样本，越界索引按边缘
// 复制填充（replicate，同 Pillow ImageFilter.BoxBlur 实测口径），除数恒为 2r+1。
// 中间过程保留浮点精度，只在最终输出四舍五入；窗口尺寸恒为奇数，均值的 .5 舍入
// 情形不可能出现（整数和 ÷ 奇数不产生 x.5），与 Pillow 差异仅剩中间精度舍入。
function _boxBlurGray(src, w, h, radius) {
  const win = 2 * radius + 1;
  const clampX = (x) => (x < 0 ? 0 : x >= w ? w - 1 : x);
  const clampY = (y) => (y < 0 ? 0 : y >= h ? h - 1 : y);
  const tmp = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += src[row + clampX(k)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / win;
      sum += src[row + clampX(x + radius + 1)] - src[row + clampX(x - radius)];
    }
  }
  const out = new Float64Array(w * h);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += tmp[clampY(k) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = sum / win;
      sum += tmp[clampY(y + radius + 1) * w + x] - tmp[clampY(y - radius) * w + x];
    }
  }
  return out;
}

// ============================================================
// op 1: imageCompress 图片压缩
// ============================================================
async function imageCompressOp(text, p = {}) {
  const quality = _intInRange("imageCompress", p.quality, 0, 100, "质量档", 80);
  const maxWidth = _intInRange("imageCompress", p.maxWidth, 0, 10000, "目标最大宽（0=不缩放）", 0);
  const format = String(p.format || "jpeg");
  if (!["png", "jpeg", "webp"].includes(format)) {
    throw new Error("imageCompress：格式需为 png/jpeg/webp，当前 " + format);
  }
  let img = await _toolDecodeImage(text, p, "imageCompress");
  if (maxWidth > 0 && img.width > maxWidth) {
    const nh = Math.max(1, Math.round((img.height * maxWidth) / img.width));
    img = _nnResize(img, maxWidth, nh);
  }
  if (format === "png") return _toolOutPng(img, "compress.png");
  // JPEG/WebP：走浏览器 canvas 编码器（Node 无 canvas，显式报错不静默降级）
  if (typeof document === "undefined") {
    throw new Error("imageCompress：JPEG/WebP 重编码需要浏览器 canvas 环境（纯 Node 环境仅支持 PNG 输出）");
  }
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  const mime = format === "jpeg" ? "image/jpeg" : "image/webp";
  const dataUrl = canvas.toDataURL(mime, quality / 100);
  const bytes = dataURLToBytes(dataUrl);
  return {
    text: dataUrl,
    files: [{ name: "compress." + (format === "jpeg" ? "jpg" : format), mime, bytes }],
  };
}

// ============================================================
// op 2: imageGray 黑白化
// ============================================================
async function imageGrayOp(text, p = {}) {
  const mode = String(p.mode || "gray");
  if (!["gray", "binary"].includes(mode)) {
    throw new Error("imageGray：模式需为 gray 或 binary，当前 " + mode);
  }
  const threshold = mode === "binary"
    ? _intInRange("imageGray", p.threshold, 0, 255, "二值化阈值", 128)
    : 0;
  const img = await _toolDecodeImage(text, p, "imageGray");
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = _lum601(d[i], d[i + 1], d[i + 2]);
    const v = mode === "binary" ? (g >= threshold ? 255 : 0) : g;
    d[i] = v; d[i + 1] = v; d[i + 2] = v; // alpha 保持
  }
  return _toolOutPng(img, mode === "binary" ? "gray_binary.png" : "gray.png");
}

// ============================================================
// op 3: imagePixelate 像素化
// ============================================================
async function imagePixelateOp(text, p = {}) {
  const block = _intInRange("imagePixelate", p.block, 1, 512, "块尺寸", 8);
  const img = await _toolDecodeImage(text, p, "imagePixelate");
  const { width: w, height: h, data: d } = img;
  const ow = Math.ceil(w / block), oh = Math.ceil(h / block);
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let by = 0; by < oh; by++) {
    for (let bx = 0; bx < ow; bx++) {
      const x0 = bx * block, y0 = by * block;
      // 边缘不满块：按实际覆盖像素收缩平均
      const x1 = Math.min(w, x0 + block), y1 = Math.min(h, y0 + block);
      let sr = 0, sg = 0, sb = 0, sa = 0, cnt = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; sa += d[i + 3]; cnt++;
        }
      }
      const oi = (by * ow + bx) * 4;
      out[oi] = Math.round(sr / cnt);
      out[oi + 1] = Math.round(sg / cnt);
      out[oi + 2] = Math.round(sb / cnt);
      out[oi + 3] = Math.round(sa / cnt);
    }
  }
  return _toolOutPng({ width: ow, height: oh, data: out }, "pixelate.png");
}

// ============================================================
// op 4: imageFrosted 毛玻璃
// ============================================================
async function imageFrostedOp(text, p = {}) {
  const radius = _intInRange("imageFrosted", p.radius, 1, 20, "模糊半径", 4);
  const img = await _toolDecodeImage(text, p, "imageFrosted");
  const w = img.width, h = img.height, d = img.data;
  const n = w * h;
  const ch = [new Float64Array(n), new Float64Array(n), new Float64Array(n)];
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    ch[0][j] = d[i]; ch[1][j] = d[i + 1]; ch[2][j] = d[i + 2];
  }
  for (let c = 0; c < 3; c++) {
    const blurred = _boxBlurGray(ch[c], w, h, radius);
    const src = ch[c];
    for (let i = 0; i < n; i++) src[i] = Math.round(blurred[i]);
  }
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    d[i] = ch[0][j]; d[i + 1] = ch[1][j]; d[i + 2] = ch[2][j]; // alpha 保持
  }
  return _toolOutPng(img, "frosted.png");
}

// ============================================================
// op 5: imageSketch 转素描
// ============================================================
async function imageSketchOp(text, p = {}) {
  const mode = String(p.mode || "dodge");
  if (!["dodge", "edge"].includes(mode)) {
    throw new Error("imageSketch：模式需为 dodge 或 edge，当前 " + mode);
  }
  const radius = _intInRange("imageSketch", p.blurRadius, 1, 40, "模糊半径", 12);
  const img = await _toolDecodeImage(text, p, "imageSketch");
  const w = img.width, h = img.height, d = img.data;
  const n = w * h;
  const gray = new Float64Array(n);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) {
    gray[j] = _lum601(d[i], d[i + 1], d[i + 2]);
  }
  if (mode === "dodge") {
    // 经典铅笔素描：灰度反相 → 盒模糊 → 颜色减淡混合（gray * 255 / (255 - blur)）
    const inv = new Float64Array(n);
    for (let i = 0; i < n; i++) inv[i] = 255 - gray[i];
    const blur = _boxBlurGray(inv, w, h, radius);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const denom = 255 - blur[j];
      const v = denom <= 0.5 ? 255 : Math.min(255, Math.round((gray[j] * 255) / denom));
      d[i] = v; d[i + 1] = v; d[i + 2] = v;
    }
  } else {
    // Sobel 边缘：白底黑线（梯度幅值越大越黑）
    const gxK = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
    const gyK = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let gx = 0, gy = 0, ki = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++, ki++) {
            const sy = Math.min(h - 1, Math.max(0, y + ky));
            const sx = Math.min(w - 1, Math.max(0, x + kx));
            const g = gray[sy * w + sx];
            gx += g * gxK[ki]; gy += g * gyK[ki];
          }
        }
        const mag = Math.sqrt(gx * gx + gy * gy);
        const v = 255 - Math.min(255, Math.round(mag));
        const i = (y * w + x) * 4;
        d[i] = v; d[i + 1] = v; d[i + 2] = v;
      }
    }
  }
  return _toolOutPng(img, mode === "dodge" ? "sketch_dodge.png" : "sketch_edge.png");
}

// ============================================================
// op 6: imageToText 图片文字化（字符画）
// ============================================================
const _ASCII_GRADIENTS = {
  classic: "@#*+=-:. ",  // 经典 9 级：由深到浅
  blocks: "█▓▒░ ",       // 方块 5 级：由深到浅
  bits: "01",            // 二值：深=1 浅=0
};

async function imageToTextOp(text, p = {}) {
  const cols = _intInRange("imageToText", p.width, 20, 400, "输出列数", 80);
  const charsetKey = String(p.charset || "classic");
  const charset = _ASCII_GRADIENTS[charsetKey];
  if (!charset) {
    throw new Error("imageToText：字符梯度表需为 classic/blocks/bits，当前 " + charsetKey);
  }
  const invert = !!p.invert;
  const img = await _toolDecodeImage(text, p, "imageToText");
  const w = img.width, h = img.height, d = img.data;
  // 字符高约为宽的 2 倍（等宽字体行距惯例），纵向采样步长取横向 2 倍
  const stepX = w / cols;
  const stepY = stepX * 2;
  const rows = Math.max(1, Math.ceil(h / stepY));
  if (rows > 2000) {
    throw new Error("imageToText：输出行数过多（" + rows + " > 2000），请减小列数或换更扁的图片");
  }
  const L = charset.length;
  const lines = [];
  for (let ry = 0; ry < rows; ry++) {
    const y0 = Math.min(h - 1, Math.floor(ry * stepY));
    const y1 = Math.max(y0 + 1, Math.min(h, Math.floor((ry + 1) * stepY)));
    let line = "";
    for (let rx = 0; rx < cols; rx++) {
      const x0 = Math.min(w - 1, Math.floor(rx * stepX));
      const x1 = Math.max(x0 + 1, Math.min(w, Math.floor((rx + 1) * stepX)));
      let sum = 0, cnt = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * w + x) * 4;
          sum += _lum601(d[i], d[i + 1], d[i + 2]);
          cnt++;
        }
      }
      let lum = cnt ? sum / cnt : 255;
      if (invert) lum = 255 - lum;
      // 亮度 → 梯度索引：深（0）映射到梯度表首字符
      const idx = Math.min(L - 1, Math.floor((lum / 256) * L));
      line += charset[idx];
    }
    lines.push(line);
  }
  return lines.join("\n");
}

// ============================================================
// op 7: gifCompose GIF 合成（GIF89a 编码器）
// ============================================================

// ---- 中位切分法调色板量化 ----
// 唯一色 ≤256 时直接建精确调色板（逐像素无损）；否则按出现次数加权中位切分到 256 色，
// 像素映射走 RGB555 网格最近色缓存（确定性、O(1)/像素）。
function _collectColors(frames) {
  const counts = new Map();
  for (const fr of frames) {
    const d = fr.data;
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3];
      // alpha 合成到白底（GIF 逐帧不透明）
      const r = a === 255 ? d[i] : Math.round((d[i] * a + 255 * (255 - a)) / 255);
      const g = a === 255 ? d[i + 1] : Math.round((d[i + 1] * a + 255 * (255 - a)) / 255);
      const b = a === 255 ? d[i + 2] : Math.round((d[i + 2] * a + 255 * (255 - a)) / 255);
      const key = (r << 16) | (g << 8) | b;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

function _medianCut(counts, maxColors) {
  let boxes = [[...counts.entries()]]; // [{[colorKey, count]}]
  while (boxes.length < maxColors) {
    // 取可分且通道跨度最大的盒子
    let bi = -1, bRange = 0, bChan = 0;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.length < 2) continue;
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0;
        for (const [key] of box) {
          const v = (key >> (16 - c * 8)) & 255;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (hi - lo > bRange) { bRange = hi - lo; bi = i; bChan = c; }
      }
    }
    if (bi < 0) break; // 全部不可分
    const box = boxes[bi];
    const shift = 16 - bChan * 8;
    box.sort((a, b) => ((a[0] >> shift) & 255) - ((b[0] >> shift) & 255));
    // 按像素计数加权取中位切分
    let total = 0;
    for (const [, cnt] of box) total += cnt;
    let acc = 0, cut = 0;
    for (let i = 0; i < box.length - 1; i++) {
      acc += box[i][1];
      if (acc >= total / 2) { cut = i + 1; break; }
    }
    if (cut <= 0 || cut >= box.length) cut = box.length >> 1;
    boxes[bi] = box.slice(0, cut);
    boxes.push(box.slice(cut));
  }
  const palette = [];
  for (const box of boxes) {
    let sr = 0, sg = 0, sb = 0, cnt = 0;
    for (const [key, c] of box) {
      sr += ((key >> 16) & 255) * c;
      sg += ((key >> 8) & 255) * c;
      sb += (key & 255) * c;
      cnt += c;
    }
    palette.push([Math.round(sr / cnt), Math.round(sg / cnt), Math.round(sb / cnt)]);
  }
  return palette;
}

function _quantizeFrames(frames, maxColors = 256) {
  const counts = _collectColors(frames);
  let palette, exactMap = null;
  if (counts.size <= maxColors) {
    exactMap = new Map();
    const keys = [...counts.keys()].sort((a, b) => a - b);
    palette = keys.map((key, idx) => {
      exactMap.set(key, idx);
      return [(key >> 16) & 255, (key >> 8) & 255, key & 255];
    });
  } else {
    palette = _medianCut(counts, maxColors);
  }
  // RGB555 最近色网格缓存（仅中位切分路径需要）
  let grid = null;
  if (!exactMap) {
    grid = new Int16Array(32768).fill(-1);
    for (let q = 0; q < 32768; q++) {
      const r = ((q >> 10) & 31) * 255;
      const g = ((q >> 5) & 31) * 255;
      const b = (q & 31) * 255;
      let best = 0, bestDist = Infinity;
      for (let pi = 0; pi < palette.length; pi++) {
        const dr = r / 31 - palette[pi][0];
        const dg = g / 31 - palette[pi][1];
        const db = b / 31 - palette[pi][2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) { bestDist = dist; best = pi; }
      }
      grid[q] = best;
    }
  }
  const mapPixel = (r, g, b) => {
    if (exactMap) return exactMap.get((r << 16) | (g << 8) | b);
    const q = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    return grid[q];
  };
  const out = frames.map((fr) => {
    const d = fr.data;
    const idx = new Uint8Array(fr.width * fr.height);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const a = d[i + 3];
      const r = a === 255 ? d[i] : Math.round((d[i] * a + 255 * (255 - a)) / 255);
      const g = a === 255 ? d[i + 1] : Math.round((d[i + 1] * a + 255 * (255 - a)) / 255);
      const b = a === 255 ? d[i + 2] : Math.round((d[i + 2] * a + 255 * (255 - a)) / 255);
      idx[j] = mapPixel(r, g, b);
    }
    return { width: fr.width, height: fr.height, indices: idx };
  });
  return { palette, frames: out };
}

// ---- GIF LZW 压缩（GIF 规范变长码，LSB 优先装包，255 字节子块） ----
function _gifLzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoiCode + 1;
  let table = new Map(); // (prefix << 8 | symbol) → code
  const out = [];
  let curSub = [];
  let bitBuf = 0, bitCnt = 0;
  const pushByte = (b) => {
    curSub.push(b);
    if (curSub.length === 255) { out.push(255); for (const x of curSub) out.push(x); curSub = []; }
  };
  const emit = (code) => {
    bitBuf |= code << bitCnt;
    bitCnt += codeSize;
    while (bitCnt >= 8) {
      pushByte(bitBuf & 0xFF);
      bitBuf >>>= 8;
      bitCnt -= 8;
    }
  };
  emit(clearCode);
  const n = indices.length;
  if (n > 0) {
    let prefix = indices[0];
    for (let i = 1; i < n; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      const found = table.get(key);
      if (found !== undefined) {
        prefix = found;
      } else {
        emit(prefix);
        if (nextCode === 4096) {
          emit(clearCode); // 表满：发 CLEAR 重置（码宽保持当前值发出后复位）
          table.clear();
          nextCode = eoiCode + 1;
          codeSize = minCodeSize + 1;
        } else {
          if (nextCode >= (1 << codeSize)) codeSize++; // 码宽先扩再赋新码（GIF 口径，非 TIFF 早换档）
          table.set(key, nextCode++);
        }
        prefix = k;
      }
    }
    emit(prefix);
  }
  emit(eoiCode);
  if (bitCnt > 0) pushByte(bitBuf & 0xFF);
  if (curSub.length) { out.push(curSub.length); for (const x of curSub) out.push(x); }
  out.push(0); // 子块终止符
  return new Uint8Array(out);
}

// ---- GIF89a 组装：头 + LSD + 全局色表 + 循环扩展 + 逐帧（GCE+图 descriptor+LZW）+ 尾 ----
function _buildGif89a(frames, palette, delayCs, loop) {
  const out = [];
  const push = (...bs) => { for (const b of bs) out.push(b & 0xFF); };
  const pushStr = (s) => { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); };
  const pushU16 = (v) => push(v & 0xFF, (v >> 8) & 0xFF);

  pushStr("GIF89a");
  const fw = frames[0].width, fh = frames[0].height;
  // 全局色表尺寸 = ≥palette.length 的最小 2 的幂（最小 2）
  let gctBits = 1;
  while ((1 << gctBits) < palette.length) gctBits++;
  if (gctBits < 1) gctBits = 1;
  const gctSize = 1 << gctBits;
  pushU16(fw); pushU16(fh);
  push(0x80 | 0x70 | (gctBits - 1)); // GCT 存在 + 色深 8 + 色表尺寸
  push(0); // 背景色索引
  push(0); // 像素纵横比
  for (let i = 0; i < gctSize; i++) {
    const c = palette[i] || [0, 0, 0];
    push(c[0], c[1], c[2]);
  }
  // NETSCAPE2.0 循环扩展：loop=0 无限循环；>0 播放 N 遍后停
  push(0x21, 0xFF, 0x0B);
  pushStr("NETSCAPE2.0");
  push(0x03, 0x01);
  pushU16(loop);
  push(0x00);
  for (const fr of frames) {
    // Graphic Control Extension：处置法 1（不处置），延时厘秒
    push(0x21, 0xF9, 0x04, 0x04);
    pushU16(delayCs);
    push(0x00); // 无透明色索引
    push(0x00);
    // Image Descriptor：全屏、无局部色表、不隔行
    push(0x2C);
    pushU16(0); pushU16(0); pushU16(fr.width); pushU16(fr.height);
    push(0x00);
    const minCodeSize = Math.max(2, gctBits);
    push(minCodeSize);
    const lzw = _gifLzwEncode(fr.indices, minCodeSize);
    for (const b of lzw) out.push(b);
  }
  push(0x3B); // trailer
  return new Uint8Array(out);
}

// ---- 输入收集：拖入真字节 + 主输入多图 + 参数追加图 ----
// 主输入支持每行一张（dataURL 用正则整体摘出；裸 base64 按行合并后为一张）。
function _collectImageRefs(text, p) {
  const refs = [];
  const grab = (s) => {
    const str = String(s || "");
    const re = /data:[^\s,]+;base64,[A-Za-z0-9+/=]+/g;
    let m;
    const restLines = [];
    let last = 0;
    while ((m = re.exec(str)) !== null) {
      refs.push(m[0]);
      // dataURL 之外的同段文本仍按行扫描（容忍混排）
      str.slice(last, m.index).split(/\r?\n/).forEach((l) => restLines.push(l));
      last = m.index + m[0].length;
    }
    str.slice(last).split(/\r?\n/).forEach((l) => restLines.push(l));
    for (const line of restLines) {
      const bare = line.replace(/[\s,]+/g, "");
      if (bare.length >= 16 && /^[A-Za-z0-9+/=]+$/.test(bare)) refs.push(bare);
    }
  };
  grab(text);
  grab(p.extraImages);
  return refs;
}

async function gifComposeOp(text, p = {}) {
  const delayMs = _intInRange("gifCompose", p.delay, 0, 655350, "每帧延时（毫秒）", 100);
  const loop = _intInRange("gifCompose", p.loop, 0, 65535, "循环次数（0=无限）", 0);
  const fitMode = String(p.fitMode || "scale");
  if (!["scale", "pad"].includes(fitMode)) {
    throw new Error("gifCompose：等尺寸化方式需为 scale 或 pad，当前 " + fitMode);
  }
  const padColorRaw = String(p.padColor || "#ffffff");
  const pcM = /^#([0-9a-fA-F]{6})$/.exec(padColorRaw.trim());
  if (!pcM) throw new Error("gifCompose：填充色需为 #RRGGBB 形式，当前 " + padColorRaw);
  const padRGB = [
    parseInt(pcM[1].slice(0, 2), 16),
    parseInt(pcM[1].slice(2, 4), 16),
    parseInt(pcM[1].slice(4, 6), 16),
  ];
  // 收集帧：拖入真字节优先为第一帧，其后主输入/追加参数按序
  const frames = [];
  if (p && p.rawBytes && p.rawBytes.length) {
    try {
      frames.push(await _toolDecodeImage(null, p, "gifCompose"));
    } catch (e) {
      const m1 = String((e && e.message) || "无法解码").replace(/^gifCompose：/, "");
      throw new Error("gifCompose：第 1 张（拖入文件）解码失败——" + m1);
    }
  }
  const refs = _collectImageRefs(text, p);
  for (let i = 0; i < refs.length; i++) {
    try {
      const bytes = dataURLToBytes(refs[i]);
      frames.push(await _toolDecodeImageBytes(bytes, "gifCompose"));
    } catch (e) {
      const m2 = String((e && e.message) || "不是有效图片").replace(/^gifCompose：/, "");
      throw new Error("gifCompose：第 " + (frames.length + 1) + " 张图片解码失败——" + m2);
    }
  }
  if (frames.length < 2) {
    throw new Error("gifCompose：至少需要两张图片（当前 " + frames.length +
      " 张）。拖入一张 + 主输入/追加参数按行粘贴其余图片");
  }
  // 等尺寸化到首帧
  const fw = frames[0].width, fh = frames[0].height;
  const fitted = frames.map((fr, i) => {
    if (fr.width === fw && fr.height === fh) return fr;
    if (fitMode === "scale") {
      return _nnResize(fr, fw, fh);
    }
    // pad：先等比缩到不超出画布（最近邻），再居中铺到填充色上
    const k = Math.min(fw / fr.width, fh / fr.height, 1);
    const sw = Math.max(1, Math.round(fr.width * k));
    const sh = Math.max(1, Math.round(fr.height * k));
    const small = k < 1 ? _nnResize(fr, sw, sh) : fr;
    const canvasData = new Uint8ClampedArray(fw * fh * 4);
    for (let j = 0; j < fw * fh; j++) {
      canvasData[j * 4] = padRGB[0]; canvasData[j * 4 + 1] = padRGB[1];
      canvasData[j * 4 + 2] = padRGB[2]; canvasData[j * 4 + 3] = 255;
    }
    const ox = Math.floor((fw - small.width) / 2), oy = Math.floor((fh - small.height) / 2);
    for (let y = 0; y < small.height; y++) {
      for (let x = 0; x < small.width; x++) {
        const di = ((oy + y) * fw + (ox + x)) * 4;
        const si = (y * small.width + x) * 4;
        canvasData[di] = small.data[si]; canvasData[di + 1] = small.data[si + 1];
        canvasData[di + 2] = small.data[si + 2]; canvasData[di + 3] = 255;
      }
    }
    return { width: fw, height: fh, data: canvasData };
  });
  const totalPx = fw * fh * fitted.length;
  if (totalPx > 4 * 1024 * 1024) {
    throw new Error("gifCompose：总像素量过大（" + totalPx + " > 4194304），请缩小图片尺寸或减少帧数");
  }
  const { palette, frames: quantized } = _quantizeFrames(fitted, 256);
  const delayCs = Math.round(delayMs / 10);
  const bytes = _buildGif89a(quantized, palette, delayCs, loop);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + 8192)));
  }
  const b64 = typeof Buffer !== "undefined"
    ? Buffer.from(bytes).toString("base64")
    : (typeof btoa === "function" ? btoa(bin) : "");
  return {
    text: "GIF 合成完成：" + fitted.length + " 帧，" + fw + "×" + fh +
      "，每帧 " + delayMs + "ms，调色板 " + palette.length + " 色，循环 " +
      (loop === 0 ? "无限" : loop + " 次") + "，文件 " + bytes.length + " 字节。\n" +
      "data:image/gif;base64," + b64,
    files: [{ name: "composed.gif", mime: "image/gif", bytes }],
  };
}

/** 图片字节 → RGBA（gifCompose 帧解码用，两级策略同 _toolDecodeImage）。 */
async function _toolDecodeImageBytes(bytes, opName) {
  if (bytes.length < 8) throw new Error(opName + "：输入不是有效图片（数据过短）");
  try {
    return decodePNG(bytes);
  } catch (pngErr) {
    try {
      return await _canvasDecode(bytes);
    } catch {
      throw new Error(
        opName + "：无法解码图片——不是有效图片或格式不支持（PNG 全型支持；" +
        "JPG/BMP/GIF/WebP 需浏览器环境）"
      );
    }
  }
}

// ============================================================
// 注册（cat: image）
// ============================================================
register({
  id: "imageCompress", cat: "image", name: "图片压缩",
  desc: "图片重编码压缩：质量档 0-100 + 可选目标最大宽（最近邻缩小）+ JPEG/PNG/WebP 输出格式；JPEG/WebP 走浏览器 canvas 编码，PNG 全环境可用。输出预览 + 下载",
  params: [
    { key: "quality", label: "质量档（0-100，仅 JPEG/WebP 生效）", type: "number", default: 80 },
    { key: "maxWidth", label: "目标最大宽（0=保持原尺寸，超出则最近邻缩小）", type: "number", default: 0 },
    {
      key: "format", label: "输出格式", type: "select", default: "jpeg",
      options: [
        { value: "jpeg", label: "JPEG（有损，体积最小）" },
        { value: "png", label: "PNG（无损）" },
        { value: "webp", label: "WebP" },
      ],
    },
  ],
  acceptsBytes: true,
  run: (t, p) => imageCompressOp(t, p),
});

register({
  id: "imageGray", cat: "image", name: "图片黑白化",
  desc: "灰度化（Rec.601：0.299R+0.587G+0.114B，与 Pillow 'L' 模式同公式逐像素一致）或阈值二值化（0-255）。CTF 里把彩色载体压平后常露出位平面/纹路线索",
  params: [
    {
      key: "mode", label: "模式", type: "select", default: "gray",
      options: [
        { value: "gray", label: "灰度（256 级）" },
        { value: "binary", label: "二值（黑白，配阈值）" },
      ],
    },
    { key: "threshold", label: "二值化阈值（0-255，仅 binary 生效）", type: "number", default: 128 },
  ],
  acceptsBytes: true,
  run: (t, p) => imageGrayOp(t, p),
});

register({
  id: "imagePixelate", cat: "image", name: "图片像素化",
  desc: "马赛克方块平均：按方块尺寸取块内像素均值（边缘不满块按实际面积收缩平均），输出放大回原尺寸观感即马赛克。块尺寸 1-512",
  params: [
    { key: "block", label: "方块尺寸（像素，1-512）", type: "number", default: 8 },
  ],
  acceptsBytes: true,
  run: (t, p) => imagePixelateOp(t, p),
});

register({
  id: "imageFrosted", cat: "image", name: "图片毛玻璃",
  desc: "盒模糊（box blur）：水平+垂直两遍分离卷积近似高斯，边缘窗口按实际像素收缩平均，半径 1-20。观察低频结构/压掉高频隐写痕迹时用",
  params: [
    { key: "radius", label: "模糊半径（1-20）", type: "number", default: 4 },
  ],
  acceptsBytes: true,
  run: (t, p) => imageFrostedOp(t, p),
});

register({
  id: "imageSketch", cat: "image", name: "图片转素描",
  desc: "铅笔素描两档：dodge=灰度反相盒模糊后颜色减淡混合（经典算法，出白纸黑线素描）；edge=Sobel 算子边缘提取（白底黑线轮廓）。辅助辨认被色彩掩盖的图案",
  params: [
    {
      key: "mode", label: "模式", type: "select", default: "dodge",
      options: [
        { value: "dodge", label: "颜色减淡素描（dodge）" },
        { value: "edge", label: "Sobel 边缘（白底黑线）" },
      ],
    },
    { key: "blurRadius", label: "盒模糊半径（1-40，仅 dodge 生效）", type: "number", default: 12 },
  ],
  acceptsBytes: true,
  run: (t, p) => imageSketchOp(t, p),
});

register({
  id: "imageToText", cat: "image", name: "图片文字化（字符画）",
  desc: "亮度→字符梯度映射的字符画：输出列数 20-400 可调（纵向步长取横向 2 倍，补偿字符高宽比），三档梯度表（classic/blocks/bits）+ 反色。输出纯文本，可直接粘贴",
  params: [
    { key: "width", label: "输出列数（20-400）", type: "number", default: 80 },
    { key: "invert", label: "反色（亮底深图适用）", type: "bool", default: false },
    {
      key: "charset", label: "字符梯度表（由深到浅）", type: "select", default: "classic",
      options: [
        { value: "classic", label: "classic：@#*+=-:. " },
        { value: "blocks", label: "blocks：█▓▒░ " },
        { value: "bits", label: "bits：01（深=1 浅=0）" },
      ],
    },
  ],
  acceptsBytes: true,
  run: (t, p) => imageToTextOp(t, p),
});

register({
  id: "gifCompose", cat: "image", name: "GIF 合成",
  desc: "多张图片合成 GIF89a：等尺寸化到首帧（scale=拉伸 / pad=等比居中铺填充色）+ 每帧延时 + 循环次数；自实现 LZW 压缩与 NETSCAPE2.0 循环扩展，中位切分法量化 ≤256 色。GIF 多帧提取的反向闭环，出题/回炉两用",
  params: [
    { key: "delay", label: "每帧延时（毫秒，0-655350）", type: "number", default: 100 },
    { key: "loop", label: "循环次数（0=无限循环）", type: "number", default: 0 },
    {
      key: "fitMode", label: "等尺寸化方式", type: "select", default: "scale",
      options: [
        { value: "scale", label: "拉伸到首帧尺寸" },
        { value: "pad", label: "等比缩放后居中，铺填充色" },
      ],
    },
    { key: "padColor", label: "填充色 #RRGGBB（仅 pad 生效）", type: "text", default: "#ffffff" },
    { key: "extraImages", label: "追加图片（每行一个 base64/dataURL，可与主输入混用）", type: "text", default: "" },
  ],
  acceptsBytes: true,
  run: (t, p) => gifComposeOp(t, p),
});

export {
  imageCompressOp, imageGrayOp, imagePixelateOp, imageFrostedOp,
  imageSketchOp, imageToTextOp, gifComposeOp, spriteSheetOp,
  _lum601, _nnResize, _boxBlurGray, _gifLzwEncode, _buildGif89a,
  _quantizeFrames, _collectImageRefs, _toolDecodeImageBytes,
};

// ============================================================
// op 8: spriteSheet 精灵图 ↔ 序列帧互转（恒烈 2026-10-12 最后需求）
// ============================================================
// split：N 列 × M 行网格精灵图 → 逐帧 PNG（files，全环境纯 JS）；
// merge：多帧（主输入首帧 + extraImages 追加行）→ 每行列数拼网格精灵图，末行不满补透明。
// 帧提取为行主序（第 1 行从左到右 → 第 2 行…，与引擎导出惯例一致）。
async function spriteSheetOp(text, p = {}) {
  const OPN = "精灵图互转";
  const mode = (p && p.mode) || "split";
  if (mode === "split") {
    const img = await _toolDecodeImage(text, p, OPN);
    const cols = _intInRange(OPN, p.cols, 1, 1024, "列数");
    const rows = _intInRange(OPN, p.rows, 1, 1024, "行数");
    if (img.width % cols !== 0) {
      throw new Error(OPN + "：图宽 " + img.width + " 不能被列数 " + cols + " 整除——请核对精灵图的列数");
    }
    if (img.height % rows !== 0) {
      throw new Error(OPN + "：图高 " + img.height + " 不能被行数 " + rows + " 整除——请核对精灵图的行数");
    }
    const fw = img.width / cols, fh = img.height / rows;
    const files = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const fr = { data: new Uint8ClampedArray(fw * fh * 4), width: fw, height: fh };
        for (let y = 0; y < fh; y++) {
          const src = ((r * fh + y) * img.width + c * fw) * 4;
          fr.data.set(img.data.subarray(src, src + fw * 4), y * fw * 4);
        }
        files.push({
          name: "frame_" + String(files.length).padStart(3, "0") + ".png",
          mime: "image/png",
          bytes: encodePNG(fr.data, fw, fh),
        });
      }
    }
    return {
      text: "已拆出 " + files.length + " 帧（每帧 " + fw + "×" + fh + "，行主序编号 frame_000 起）。逐帧 PNG 可下载；需要动图可接「GIF 合成」",
      files,
    };
  }
 // merge：多帧 → 网格精灵图
  const frames = [await _toolDecodeImage(text, p, OPN)];
  const extra = String((p && p.extraImages) || "").split("\n").map((s) => s.trim()).filter(Boolean);
  for (const [i, line] of extra.entries()) {
    let bytes;
    try {
      bytes = dataURLToBytes(line);
    } catch (e) {
      throw new Error(OPN + "：追加第 " + (i + 1) + " 行不是有效图片数据（每行一个 base64/dataURL）");
    }
    frames.push(await _toolDecodeImageBytes(bytes, OPN));
  }
  const cols = _intInRange(OPN, p.cols, 1, 1024, "每行列数");
  const fw = frames[0].width, fh = frames[0].height;
  for (const [i, fr] of frames.entries()) {
    if (fr.width !== fw || fr.height !== fh) {
      throw new Error(OPN + "：第 " + (i + 1) + " 帧尺寸 " + fr.width + "×" + fr.height +
        " 与首帧 " + fw + "×" + fh + " 不一致——序列帧必须等尺寸");
    }
  }
  const rows = Math.ceil(frames.length / cols);
  const out = { data: new Uint8ClampedArray(fw * cols * fh * rows * 4), width: fw * cols, height: fh * rows };
  for (const [i, fr] of frames.entries()) {
    const r = Math.floor(i / cols), c = i % cols;
    for (let y = 0; y < fh; y++) {
      const dst = ((r * fh + y) * out.width + c * fw) * 4;
      out.data.set(fr.data.subarray(y * fw * 4, y * fw * 4 + fw * 4), dst);
    }
  }
  const res = _toolOutPng(out, "sprite_sheet.png");
  return {
    text: "已合成 " + frames.length + " 帧为 " + cols + " 列 × " + rows + " 行精灵图（" +
      out.width + "×" + out.height + (frames.length % cols ? "，末行空位补透明" : "") + "）",
    files: res.files,
  };
}

register({
  id: "spriteSheet", cat: "image", name: "精灵图互转",
  desc: "精灵图（等分网格）↔ 序列帧互转：拆帧把 N 列 × M 行网格图切成逐帧 PNG（行主序，frame_000 起）；合成把多帧（主输入首帧 + 追加行每行一个 dataURL）按每行列数拼网格，末行空位补透明。纯 JS PNG 全环境可用",
  params: [
    {
      key: "mode", label: "方向", type: "select", default: "split",
      options: [
        { value: "split", label: "精灵图 → 序列帧（拆帧）" },
        { value: "merge", label: "序列帧 → 精灵图（合成）" },
      ],
    },
    { key: "cols", label: "列数（拆=网格列数；合=每行帧数）", type: "number", default: 4 },
    { key: "rows", label: "行数（仅拆帧生效）", type: "number", default: 1 },
    { key: "extraImages", label: "追加帧（仅合成；每行一个 base64/dataURL）", type: "text", default: "" },
  ],
  acceptsBytes: true,
  run: (t, p) => spriteSheetOp(t, p),
});
