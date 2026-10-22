/*
 * imageBytes.js — 图片字节 → RGBA 的统一入口（隐写/反向渲染共用）。
 *
 * 两级策略：先纯 JS decodePNG（像素精确、Node 可跑），失败再走浏览器 canvas
 * （JPEG/GIF/BMP/WebP 等）。纯逻辑、零第三方依赖；canvas 路径只在浏览器可用。
 */
import { decodePNG, dataURLToBytes } from "./stegoPixels.js";

/** 取输入字节：优先 rawBytes（拖入文件），否则按 dataURL / 裸 base64 解析。 */
export function imageInputBytes(text, params, opName = "图片") {
  const p = params || {};
  if (p.rawBytes && p.rawBytes.length) return new Uint8Array(p.rawBytes);
  try {
    return dataURLToBytes(text);
  } catch (e) {
    throw new Error(opName + "：输入不是图片（请拖入图片文件，或粘贴图片 base64/dataURL）");
  }
}

/** 浏览器 canvas 兜底解码。 */
async function canvasDecode(bytes) {
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
    throw new Error("当前环境无浏览器 canvas，只能解码 PNG");
  }
  const blob = new Blob([bytes]);
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("无法创建 canvas 2D 上下文");
  ctx.drawImage(bmp, 0, 0);
  bmp.close && bmp.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: img.width, height: img.height, data: img.data };
}

/**
 * 图片字节 → { width, height, data: Uint8ClampedArray(RGBA) }。
 * PNG 走纯 JS；其它格式需要浏览器环境。
 */
export async function decodeImageToRgba(bytes, opName = "图片") {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length < 8) throw new Error(opName + "：输入不是有效图片（数据过短）");
  try {
    return decodePNG(b);
  } catch (pngErr) {
    try {
      return await canvasDecode(b);
    } catch (e) {
      throw new Error(opName + "：无法解码图片——不是有效图片或格式不支持（PNG 全型支持；JPG/BMP/GIF/WebP 需浏览器环境）：" + (e && e.message ? e.message : pngErr.message));
    }
  }
}

export default { imageInputBytes, decodeImageToRgba };
