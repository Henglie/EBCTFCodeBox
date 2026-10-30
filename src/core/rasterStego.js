/*
 * rasterStego.js — 光栅隐写（zbRasterTerminator 复刻，纯 JS / 零 DOM）。
 *
 * 参考实现：资料/参考/反编py/zbCrypto/zbCrypto.zbRasterTerminator.py
 *   - 对宽/高在 2..maxDivisor 内的每个因数 d，输出 d 张相位图；
 *   - x 轴：只保留列 x % d === phase（其余列清零），文件名 x-d-(phase+1).png；
 *   - y 轴：只保留行 y % d === phase（其余行清零），文件名 y-d-(phase+1).png；
 *   - 因数和相位顺序按 Python `output.insert(1, x)` / `range(x)` 复刻：
 *     因数顺序 = [2, 最后因数, ..., 中间因数]（首个因数固定在前，其余逆序）。
 *
 * 输入解码：PNG 走 stegoPixels.decodePNG（与仓库其它图像 op 同一套），BMP 在本文件
 * 内置解码（24/32/16/8/4/1 位，BI_RGB / BI_BITFIELDS），输出统一 RGBA。
 *
 * API：
 *   rasterStegoScan(bytes, opts) -> { width, height, images, notes, ... }
 *   images[] = { axis:"x"|"y", divisor, phase, name, mime:"image/png", bytes, width, height }
 *   phase 为 0 基（0..d-1）；name 第 3 段为 1 基（与参考 Python 一致）。
 *
 * 资源限制：所有输出保留在内存里，必须设上限。默认
 *   maxImages=128（参考 demo 600×300 实际 68 张）、
 *   maxPixelsPerImage=8e6、maxTotalPixels=192e6。
 * 超限抛错并带 code=RASTER_LIMIT_*，绝不静默截断。
 */
import { decodePNG, encodePNG } from "./stegoPixels.js";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function toBytes(src) {
  if (src instanceof Uint8Array) return src;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  throw new Error("rasterStegoScan: 输入必须是 Uint8Array/ArrayBuffer");
}

function u16le(b, o) { return b[o] | (b[o + 1] << 8); }
function u32le(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
function i32le(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) | 0; }

function isPNG(b) {
  if (b.length < 8) return false;
  for (let i = 0; i < 8; i++) if (b[i] !== PNG_SIG[i]) return false;
  return true;
}

function pngHasAlpha(b) {
  let pos = 8;
  while (pos + 8 <= b.length) {
    const len = (b[pos] << 24 | b[pos + 1] << 16 | b[pos + 2] << 8 | b[pos + 3]) >>> 0;
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    if (type === "IHDR") {
      const ct = b[pos + 8 + 9];
      if (ct === 4 || ct === 6) return true;
    } else if (type === "tRNS") {
      return true;
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  return false;
}

function maskScale(v, mask) {
  if (!mask) return 0;
  let shift = 0;
  while (shift < 32 && ((mask >>> shift) & 1) === 0) shift++;
  const max = mask >>> shift;
  if (!max) return 0;
  return Math.round((((v & mask) >>> shift) * 255) / max);
}

/**
 * BMP → RGBA。支持 BITMAPCOREHEADER / BITMAPINFOHEADER 及更大 DIB 头。
 * 不支持 RLE/JPEG/PNG 压缩（明确报错）。
 */
export function decodeBMP(bytes) {
  const b = toBytes(bytes);
  if (b.length < 26 || b[0] !== 0x42 || b[1] !== 0x4d) throw new Error("BMP 签名错误");
  const dataOffset = u32le(b, 10);
  const dibSize = u32le(b, 14);
  let width, height, bpp, compression = 0, clrUsed = 0;
  if (dibSize === 12) {
    width = u16le(b, 18);
    height = u16le(b, 20);
    bpp = u16le(b, 24);
  } else if (dibSize >= 40) {
    width = i32le(b, 18);
    height = i32le(b, 22);
    bpp = u16le(b, 28);
    compression = u32le(b, 30);
    clrUsed = u32le(b, 46);
  } else {
    throw new Error("BMP DIB 头大小 " + dibSize + " 不支持");
  }
  const topDown = height < 0;
  height = Math.abs(height);
  if (!width || !height) throw new Error("BMP 宽高非法");
  if (compression !== 0 && compression !== 3) {
    throw new Error("BMP 压缩方式 " + compression + " 不支持（仅 BI_RGB / BI_BITFIELDS）");
  }
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) throw new Error("BMP 位深 " + bpp + " 不支持");

  let rMask = 0, gMask = 0, bMask = 0, aMask = 0;
  if (compression === 3) {
    if (bpp !== 16 && bpp !== 32) throw new Error("BMP BI_BITFIELDS 仅支持 16/32 位");
    const mo = dibSize >= 52 ? 14 + 40 : 14 + dibSize;
    if (mo + 12 > b.length) throw new Error("BMP 位掩码缺失");
    rMask = u32le(b, mo);
    gMask = u32le(b, mo + 4);
    bMask = u32le(b, mo + 8);
    if (bpp === 32 && mo + 16 <= b.length) aMask = u32le(b, mo + 12);
  } else if (bpp === 16) {
    rMask = 0x7c00; gMask = 0x03e0; bMask = 0x001f;
  } else if (bpp === 32) {
    rMask = 0x00ff0000; gMask = 0x0000ff00; bMask = 0x000000ff; aMask = 0xff000000;
  }

  const paletteOffset = 14 + dibSize;
  const paletteEntry = dibSize === 12 ? 3 : 4;
  const paletteCount = clrUsed || (bpp <= 8 ? (1 << bpp) : 0);
  let palette = null;
  if (paletteCount) {
    const need = paletteOffset + paletteCount * paletteEntry;
    if (need > b.length) throw new Error("BMP 调色板不完整");
    palette = new Uint8Array(paletteCount * 3);
    for (let i = 0; i < paletteCount; i++) {
      const o = paletteOffset + i * paletteEntry;
      palette[i * 3] = b[o + 2];
      palette[i * 3 + 1] = b[o + 1];
      palette[i * 3 + 2] = b[o];
    }
  }

  const stride = ((width * bpp + 31) >> 5) * 4;
  if (dataOffset + stride * height > b.length) throw new Error("BMP 像素数据不完整");
  const out = new Uint8ClampedArray(width * height * 4);
  let anyAlpha = false;

  for (let y = 0; y < height; y++) {
    const srcY = topDown ? y : height - 1 - y;
    const row = dataOffset + srcY * stride;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let R = 0, G = 0, B = 0, A = 255;
      if (bpp === 24) {
        const p = row + x * 3;
        B = b[p]; G = b[p + 1]; R = b[p + 2];
      } else if (bpp === 32) {
        const p = row + x * 4;
        const v = b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24);
        R = maskScale(v, rMask); G = maskScale(v, gMask); B = maskScale(v, bMask);
        A = aMask ? maskScale(v, aMask) : (compression === 0 ? b[p + 3] : 255);
        if (A !== 255) anyAlpha = true;
      } else if (bpp === 16) {
        const p = row + x * 2;
        const v = b[p] | (b[p + 1] << 8);
        R = maskScale(v, rMask); G = maskScale(v, gMask); B = maskScale(v, bMask);
      } else {
        let idx;
        if (bpp === 8) idx = b[row + x];
        else if (bpp === 4) {
          const q = b[row + (x >> 1)];
          idx = (x & 1) ? (q & 0x0f) : (q >> 4);
        } else {
          idx = (b[row + (x >> 3)] >> (7 - (x & 7))) & 1;
        }
        if (palette) {
          const pi = Math.min(idx, paletteCount - 1);
          R = palette[pi * 3]; G = palette[pi * 3 + 1]; B = palette[pi * 3 + 2];
        }
      }
      out[o] = R; out[o + 1] = G; out[o + 2] = B; out[o + 3] = A;
    }
  }

  // 常见 BI_RGB 32 位 BMP 的 alpha 通道全 0，按不透明处理，避免整图不可见。
  if (bpp === 32 && compression === 0 && !anyAlpha) {
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    return { width, height, data: out, hasAlpha: false, format: "bmp" };
  }
  return { width, height, data: out, hasAlpha: bpp === 32, format: "bmp" };
}

function readImage(bytes) {
  if (isPNG(bytes)) {
    const img = decodePNG(bytes);
    return { width: img.width, height: img.height, data: img.data, hasAlpha: pngHasAlpha(bytes), format: "png" };
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return decodeBMP(bytes);
  throw new Error("rasterStegoScan: 仅支持 PNG/BMP（未识别文件签名）");
}

/** 只读文件头宽高，用于在完整解码前执行单张内存上限。 */
function peekImageSize(bytes) {
  if (isPNG(bytes) && bytes.length >= 24) {
    const w = ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0;
    const h = ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0;
    return { width: w, height: h };
  }
  if (bytes.length >= 26 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    const w = i32le(bytes, 18);
    const h = Math.abs(i32le(bytes, 22));
    return { width: w, height: h };
  }
  return null;
}

/** Python `output.insert(1, x)` 顺序复刻。 */
export function rasterDivisors(size, maxDivisor = 10) {
  const out = [];
  for (let d = 2; d <= maxDivisor; d++) if (size % d === 0) out.splice(1, 0, d);
  return out;
}

function limitError(code, message, extra) {
  const e = new Error(message);
  e.code = code;
  if (extra) Object.assign(e, extra);
  return e;
}

// ---- fixed-Huffman DEFLATE（仅本文件产物用；稀疏相位图 zlibStore 会膨胀 4 倍以上） ----
function adler32(buf) {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function zlibFixed(raw) {
  const out = [];
  const tail = [];
  let acc = 0, nbits = 0;
  const put = (val, n) => {
    acc |= val << nbits; nbits += n;
    while (nbits >= 8) { tail.push(acc & 0xff); acc >>>= 8; nbits -= 8; }
  };
  const putCode = (code, n) => { for (let b = n - 1; b >= 0; b--) put((code >>> b) & 1, 1); };
  out.push(0x78, 0x01);
  const putLiteral = (b) => { if (b < 144) putCode(0x30 + b, 8); else putCode(0x190 + b - 144, 9); };
  const putLenSym = (s) => { if (s < 280) putCode(s - 256, 7); else putCode(0xc0 + s - 280, 8); };
  const putDist = (d) => putCode(d, 5);
  const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  put(1, 1); // BFINAL
  put(1, 2); // BTYPE=01 fixed Huffman
  const HB = 1 << 15;
  const head = new Int32Array(HB).fill(-1);
  const prev = new Int32Array(raw.length).fill(-1);
  const h = (i) => ((raw[i] << 10) ^ (raw[i + 1] << 5) ^ raw[i + 2]) & (HB - 1);
  let i = 0;
  while (i < raw.length) {
    let bestLen = 0, bestDist = 0;
    if (i + 2 < raw.length) {
      const hv = h(i);
      let j = head[hv];
      const limit = Math.max(0, i - 32768);
      let tries = 0;
      while (j >= limit && tries < 32) {
        if (raw[j] === raw[i] && raw[j + 1] === raw[i + 1] && raw[j + 2] === raw[i + 2]) {
          let len = 3;
          const maxLen = Math.min(258, raw.length - i);
          while (len < maxLen && raw[j + len] === raw[i + len]) len++;
          if (len > bestLen) { bestLen = len; bestDist = i - j; if (len >= 258) break; }
        }
        j = prev[j]; tries++;
      }
    }
    if (bestLen >= 3) {
      let lc = LEN_BASE.length - 1;
      while (lc > 0 && LEN_BASE[lc] > bestLen) lc--;
      putLenSym(257 + lc);
      put(bestLen - LEN_BASE[lc], LEN_EXTRA[lc]);
      let dc = DIST_BASE.length - 1;
      while (dc > 0 && DIST_BASE[dc] > bestDist) dc--;
      putDist(dc);
      put(bestDist - DIST_BASE[dc], DIST_EXTRA[dc]);
      for (let k = 0; k < bestLen; k++) {
        if (i + 2 < raw.length) {
          const hv2 = h(i);
          prev[i] = head[hv2]; head[hv2] = i;
        }
        i++;
      }
    } else {
      putLiteral(raw[i]);
      if (i + 2 < raw.length) {
        const hv2 = h(i);
        prev[i] = head[hv2]; head[hv2] = i;
      }
      i++;
    }
  }
  putLenSym(256);
  if (nbits > 0) tail.push(acc & 0xff);
  const ad = adler32(raw);
  const fin = new Uint8Array(out.length + tail.length + 4);
  fin.set(out, 0);
  fin.set(tail, out.length);
  const p = out.length + tail.length;
  fin[p] = (ad >>> 24) & 0xff;
  fin[p + 1] = (ad >>> 16) & 0xff;
  fin[p + 2] = (ad >>> 8) & 0xff;
  fin[p + 3] = ad & 0xff;
  return fin;
}

/**
 * 光栅扫描。同步返回全部 PNG 产物（Uint8Array）。
 * @param {Uint8Array|ArrayBuffer} src
 * @param {object} opts {maxDivisor=10, both=true, axes, maxImages=128,
 *   maxPixelsPerImage=8e6, maxTotalPixels=192e6, fillMode="auto"|"black"|"transparent"}
 */
export function rasterStegoScan(src, opts = {}) {
  const maxDivisor = opts.maxDivisor == null ? 10 : Number(opts.maxDivisor);
  if (!Number.isInteger(maxDivisor) || maxDivisor < 2 || maxDivisor > 64) {
    throw limitError("RASTER_BAD_DIVISOR", "maxDivisor 必须是 2..64 的整数（参考实现默认 2..10）");
  }
  const both = opts.both !== false;
  const maxImages = opts.maxImages == null ? 128 : Number(opts.maxImages);
  const maxPixelsPerImage = opts.maxPixelsPerImage == null ? 8_000_000 : Number(opts.maxPixelsPerImage);
  const maxTotalPixels = opts.maxTotalPixels == null ? 192_000_000 : Number(opts.maxTotalPixels);
  const fillMode = opts.fillMode || "auto";
  if (!["auto", "black", "transparent"].includes(fillMode)) {
    throw limitError("RASTER_BAD_FILL", "fillMode 仅支持 auto/black/transparent");
  }
  if (!(maxImages > 0) || !(maxPixelsPerImage > 0) || !(maxTotalPixels > 0)) {
    throw limitError("RASTER_BAD_LIMIT", "maxImages / maxPixelsPerImage / maxTotalPixels 必须为正数");
  }

  const bytes = toBytes(src);
  const peek = peekImageSize(bytes);
  if (peek && peek.width > 0 && peek.height > 0 && peek.width * peek.height > maxPixelsPerImage) {
    throw limitError("RASTER_LIMIT_PIXELS_PER_IMAGE",
      `单张图像 ${peek.width}×${peek.height}=${peek.width * peek.height} 像素超过单张上限 ${maxPixelsPerImage}；` +
      `已在解码像素前拒绝，请先缩小图片或调高 maxPixelsPerImage`,
      { width: peek.width, height: peek.height, pixels: peek.width * peek.height, limit: maxPixelsPerImage });
  }
  const img = readImage(bytes);
  const { width, height, data } = img;
  const px = width * height;
  if (px > maxPixelsPerImage) {
    throw limitError("RASTER_LIMIT_PIXELS_PER_IMAGE",
      `单张图像 ${width}×${height}=${px} 像素超过单张上限 ${maxPixelsPerImage}；请先缩小图片或调高 maxPixelsPerImage`,
      { width, height, pixels: px, limit: maxPixelsPerImage });
  }

  const axes = opts.axes ? opts.axes.slice() : (both ? ["x", "y"] : ["x"]);
  for (const a of axes) if (a !== "x" && a !== "y") throw limitError("RASTER_BAD_AXIS", "axes 只能是 x/y");

  const plan = [];
  const divs = {};
  for (const axis of axes) {
    const size = axis === "x" ? width : height;
    const ds = rasterDivisors(size, maxDivisor);
    divs[axis] = ds;
    for (const d of ds) for (let phase = 0; phase < d; phase++) plan.push({ axis, divisor: d, phase });
  }
  if (plan.length > maxImages) {
    throw limitError("RASTER_LIMIT_IMAGES",
      `产物数量 ${plan.length} 超过上限 ${maxImages}（本次因数：x=${(divs.x || []).join(",") || "无"}；y=${(divs.y || []).join(",") || "无"}）。` +
      `请降低 maxDivisor、设 both=false，或显式调高 maxImages`,
      { count: plan.length, limit: maxImages });
  }
  if (plan.length * px > maxTotalPixels) {
    throw limitError("RASTER_LIMIT_TOTAL_PIXELS",
      `总像素 ${plan.length}×${px}=${plan.length * px} 超过上限 ${maxTotalPixels}；请减少产物或调高 maxTotalPixels`,
      { totalPixels: plan.length * px, limit: maxTotalPixels });
  }

  const transparent = fillMode === "transparent" || (fillMode === "auto" && img.hasAlpha);
  const images = [];
  for (const p of plan) {
    const out = new Uint8ClampedArray(px * 4);
    if (p.axis === "x") {
      for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = p.phase; x < width; x += p.divisor) {
          const si = (row + x) * 4;
          out[si] = data[si]; out[si + 1] = data[si + 1];
          out[si + 2] = data[si + 2]; out[si + 3] = data[si + 3];
        }
      }
    } else {
      for (let y = p.phase; y < height; y += p.divisor) {
        const so = y * width * 4;
        out.set(data.subarray(so, so + width * 4), so);
      }
    }
    if (!transparent) {
      for (let i = 3; i < out.length; i += 4) if (!out[i]) out[i] = 255;
    }
    const name = `${p.axis}-${p.divisor}-${p.phase + 1}.png`;
    const png = encodePNG(out, width, height, zlibFixed);
    images.push({
      axis: p.axis,
      divisor: p.divisor,
      phase: p.phase,
      name,
      mime: "image/png",
      bytes: png,
      width,
      height,
    });
  }

  const notes = [
    `源图 ${img.format.toUpperCase()} ${width}×${height}（${img.hasAlpha ? "含 alpha" : "无 alpha"}），填充=${transparent ? "透明" : "黑"}`,
    `因数顺序按 Python insert(1,x)：x=[${(divs.x || []).join(",") || "无"}]，y=[${(divs.y || []).join(",") || "无"}]`,
    `产物 x=${images.filter(i => i.axis === "x").length} 张 / y=${images.filter(i => i.axis === "y").length} 张，共 ${images.length} 张；phase 字段 0 基，文件名相位 1 基`,
    `上限：张数 ${maxImages}，单张 ${maxPixelsPerImage} 像素，总计 ${maxTotalPixels} 像素`,
  ];
  if (!images.length) notes.push(`宽/高在 2..${maxDivisor} 内没有可用的因数，未产生图片`);

  return {
    width,
    height,
    images,
    notes,
    format: img.format,
    hasAlpha: img.hasAlpha,
    divisors: divs,
  };
}
