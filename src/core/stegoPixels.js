/*
 * stegoPixels.js — 图像类 op 共用像素管线（cat:'stego' 新 op 专用，纯函数零 UI 依赖）。
 *
 * 为什么存在：stegoImage.js 的图像解码走 createImageBitmap/canvas（仅浏览器），
 * node 回归脚本无法对拍。这里提供纯 JS PNG 解码（IDAT inflateRaw + 5 型 unfilter），
 * 让 stegpy / stereogramSolver / arnoldCatBrute 在 node 下可完整往返验证。
 *
 * 提供：
 * - decodePNG(bytes) → {width, height, data: Uint8ClampedArray(RGBA)}
 *   支持 colorType 0/2/3/4/6 × bitDepth 8（16 取高字节、1/2/4 解位深打包），
 *   调色板 PLTE + tRNS 透明，非隔行；越界调色板索引钳位到末项（同浏览器容忍语义，
 *   CTF 载体常被隐写工具二次加工出越界索引，不因此抛错）。
 * - encodePNG / rgbaToDataURL —— 转发 mcMap.js 的零依赖 PNG 编码器（zlib stored 块）。
 * - rollHorizontal(rgba, w, h, offset) —— numpy.roll(axis=1) 语义：整行水平循环位移。
 * - dataURLToBytes —— dataURL/裸 base64 → Uint8Array。
 *
 * 契约：注册进 registry 的图像 op 首参为 base64(dataURL)，内部先 dataURLToBytes → decodePNG，
 * 处理完 rgbaToDataURL 输出，UI 自动渲染 + 下载。
 */
import { inflateRaw } from "./pcapDeep.js";
import { encodePNG, rgbaToDataURL } from "./mcMap.js";

// ---- PNG chunk 遍历 ----
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
function u32be(b, o) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

/**
 * 纯 JS PNG 解码 → RGBA 像素。字节序/过滤全部按 PNG 规范实现，
 * 与 PIL numpy 版（随波逐流参照系）逐像素等价。
 */
export function decodePNG(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < 8; i++) if (b[i] !== PNG_SIG[i]) throw new Error("PNG 签名错误");
  let pos = 8;
  let width = 0, height = 0, bitDepth = 8, colorType = 6, interlace = 0;
  let palette = null, trns = null;
  const idatChunks = [];
  while (pos + 8 <= b.length) {
    const len = u32be(b, pos);
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    const data = b.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = u32be(data, 0);
      height = u32be(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "tRNS") {
      trns = data;
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (!width || !height) throw new Error("PNG 缺少 IHDR");
  if (interlace !== 0) throw new Error("PNG 隔行（Adam7）暂不支持");

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (channels === undefined) throw new Error("PNG colorType " + colorType + " 不支持");
  if (bitDepth !== 8 && bitDepth !== 16 && bitDepth !== 4 && bitDepth !== 2 && bitDepth !== 1) {
    throw new Error("PNG bitDepth " + bitDepth + " 不支持");
  }
  if (bitDepth === 16 && colorType === 3) throw new Error("PNG 调色板不支持 16 位");
  if (colorType === 3 && !palette) throw new Error("PNG 调色板缺失 PLTE 块");

  // IDAT 拼接 → zlib 去头(2)/去尾(4 adler) → raw inflate
  let idatLen = 0;
  for (const c of idatChunks) idatLen += c.length;
  const idat = new Uint8Array(idatLen);
  let o = 0;
  for (const c of idatChunks) { idat.set(c, o); o += c.length; }
  if (idat.length < 6) throw new Error("PNG IDAT 缺失");
  const raw = inflateRaw(idat.subarray(2, idat.length - 4));

  // 扫描线：每行前导 1 字节 filter。bpp = filter 回推字节距（<8bit 恒 1，规范如此）
  const bpp = Math.ceil((channels * bitDepth) / 8);
  // 行字节长按规范 = ceil(width × channels × bitDepth / 8)。旧式 width × bpp 在 bitDepth < 8 时
  // 多算行宽（4bit/2 宽图真实行 1 字节却算成 2）→ 行起点错位 + 「数据不完整」误抛，
  // 1/2/4bit 调色板与灰度图全部崩。8/16bit 下与原式等值，零行为变化。
  const stride = Math.ceil((width * channels * bitDepth) / 8);
  const expect = height * (stride + 1);
  if (raw.length < expect) throw new Error("PNG 数据不完整（期望 " + expect + " 字节，实际 " + raw.length + "）");
  const filtered = raw.subarray(0, expect);

  // unfilter（5 型）
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = filtered[y * (stride + 1)];
    const row = y * stride;
    const prev = (y - 1) * stride;
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const r = filtered[src + x];
      const left = x >= bpp ? px[row + x - bpp] : 0;
      const up = y > 0 ? px[prev + x] : 0;
      const upLeft = (y > 0 && x >= bpp) ? px[prev + x - bpp] : 0;
      let v;
      switch (f) {
        case 0: v = r; break;
        case 1: v = r + left; break;
        case 2: v = r + up; break;
        case 3: v = r + ((left + up) >> 1); break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upLeft);
          const pred = (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft);
          v = r + pred;
          break;
        }
        default: throw new Error("PNG filter 类型 " + f + " 非法");
      }
      px[row + x] = v & 0xff;
    }
  }

  // 解位深（1/2/4bit 打包展开）与 16bit 降高字节
  let strideOut = width * channels;
  let samples = px;
  if (bitDepth === 16) {
    const s2 = new Uint8Array(height * strideOut);
    for (let i = 0, j = 0; i < px.length; i += 2, j++) s2[j] = px[i];
    samples = s2;
  } else if (bitDepth < 8) {
    const perByte = 8 / bitDepth;
    strideOut = width * channels;
    const s2 = new Uint8Array(height * strideOut);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < channels; c++) {
          const srcIdx = y * stride + Math.floor((x * channels + c) / perByte);
          const shift = 8 - bitDepth - ((x * channels + c) % perByte) * bitDepth;
          s2[y * strideOut + x * channels + c] = (px[srcIdx] >> shift) & ((1 << bitDepth) - 1);
        }
      }
    }
    samples = s2;
  }

  // colorType → RGBA
  const out = new Uint8ClampedArray(width * height * 4);
  const maxVal = (1 << bitDepth) - 1; // 位深 <8 时归一（本实现按 0-255 直通，bitDepth=8 主路径）
  for (let i = 0; i < width * height; i++) {
    const r = i * channels, g = r + 1, b4 = r + 2, a = r + 3;
    let R, G, B, A = 255;
    switch (colorType) {
      case 0: R = G = B = samples[i]; break; // 灰度
      case 2: R = samples[r]; G = samples[g]; B = samples[b4]; break; // RGB
      case 4: R = G = B = samples[r]; A = samples[a]; break; // 灰度+alpha
      case 6: R = samples[r]; G = samples[g]; B = samples[b4]; A = samples[a]; break; // RGBA
      case 3: { // 调色板
        // 越界索引钳位到最后一项而非抛错：CTF 载体常被隐写/二次加工工具改出越界索引
        //（Arnold 猫脸暴破的实际崩点），浏览器解码同款容忍（截到调色板边界），抛错会把
        // 本可解的图整张打崩。idx 取自字节恒 >=0；PLTE 残缺（无完整 RGB 项）时黑底兜底。
        const palCount = Math.floor(palette.length / 3);
        const idx = Math.min(samples[i], palCount - 1);
        if (idx < 0) { R = G = B = 0; break; }
        R = palette[idx * 3]; G = palette[idx * 3 + 1]; B = palette[idx * 3 + 2];
        if (trns && idx < trns.length) A = trns[idx];
        break;
      }
    }
    const o4 = i * 4;
    out[o4] = R; out[o4 + 1] = G; out[o4 + 2] = B; out[o4 + 3] = A;
  }
  if (maxVal !== 255 && colorType !== 3) {
    // 位深 <8 的灰度/RGB：归一化到 0-255（低位数 × 255/maxVal 取整）
    for (let i = 0; i < out.length; i++) {
      if (i % 4 === 3 && colorType === 4) continue;
      out[i] = Math.round((out[i] * 255) / maxVal);
    }
  }
  return { width, height, data: out };
}

/** numpy.roll(axis=1) 语义：RGBA 像素逐行水平循环位移（offset>0 左移，右缘绕到左缘）。 */
export function rollHorizontal(rgba, w, h, offset) {
  const out = new Uint8ClampedArray(rgba.length);
  const o = ((offset % w) + w) % w;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcX = (x + o) % w;
      const di = (y * w + x) * 4;
      const si = (y * w + srcX) * 4;
      out[di] = rgba[si]; out[di + 1] = rgba[si + 1]; out[di + 2] = rgba[si + 2]; out[di + 3] = rgba[si + 3];
    }
  }
  return out;
}

/** dataURL / 裸 base64 → Uint8Array。 */
export function dataURLToBytes(src) {
  let s = String(src || "").trim();
  const comma = s.indexOf(",");
  if (comma >= 0 && s.slice(0, 5).toLowerCase().startsWith("data:")) s = s.slice(comma + 1);
  s = s.replace(/\s+/g, "");
  if (!s) throw new Error("输入为空：请上传图片或粘贴图片 base64/dataURL");
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(s, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  const bin = globalThis.atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export { encodePNG, rgbaToDataURL };
