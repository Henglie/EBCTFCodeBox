/*
 * canvasDecode.js — 浏览器 canvas 像素解码（JPEG / GIF）。
 *
 * 定位：为 imageAnalysis.js 补齐 JPEG / GIF 的像素矩阵产出。PNG / BMP 由
 * lsbExtract.js 的自包含解码器覆盖（core 层零依赖），而 JPEG / GIF 无纯 JS
 * 自包含解码器，故走浏览器原生 createImageBitmap + canvas.getImageData 拿
 * 渲染后 RGBA 像素，喂给 imageAnalysis 已有的 QR / 像素分析链。
 *
 * 数据契约（与 lsbExtract.decodePngPixels 对齐，供 imageAnalysis 复用同一管线）：
 * decoded = { width, height, channels, samples:Uint8Array, colorType, depth }
 * canvas 输出恒为 RGBA → channels=4, colorType=6, depth=8。
 *
 * 局限（红线：写不清的宁缺，不编造）：
 * - canvas 拿到的是**渲染后 RGB 像素**。JPEG 若把 LSB 隐写藏在原始 DCT 系数里
 * canvas 拿不到（有损重采样 + 反量化后像素已变）。DCT 级分析属进阶，留待
 * WASM 后续；本模块只提供「解到 RGB 像素 → 能识别 QR + 做 RGB LSB」。
 * - GIF 多帧：优先用 WebCodecs 的 ImageDecoder 逐帧解（可拿全部帧）；若浏览器
 * 无 ImageDecoder，createImageBitmap 回退只拿首帧。
 * - 透明像素：drawImage 前用白底填充，避免透明区 RGBA=0 被误判为黑而破坏
 * QR quiet zone。
 * - 纯浏览器 API：Node 环境无 createImageBitmap / OffscreenCanvas / ImageDecoder
 * 本模块无法在 Node 跑，只能浏览器实测；Node 侧仅 node --check 语法。
 *
 * 红线：只被 imageAnalysis.js 单向 import，不碰 main.js / registry / i18n / css。
 */

// FFD8FF → JPEG；"GIF8" → GIF。其余返回 null（交给 PNG/BMP 自包含解码路径）。
export function detectCanvasMime(bytes) {
  const b = bytes;
  if (!b || b.length < 6) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
 // 47 49 46 38 = "GIF8"（GIF87a / GIF89a 共有前缀）
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  return null;
}

// 建一个 2D 画布上下文（优先 OffscreenCanvas，退回 DOM canvas）。
function makeCanvasCtx(w, h) {
  let canvas;
  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(w, h);
  } else if (typeof document !== "undefined") {
    canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
  } else {
    return null; // 无 canvas 环境（如 Node）
  }
  const ctx = canvas.getContext("2d");
  return ctx ? { canvas, ctx } : null;
}

// 把一个可绘制源（ImageBitmap / VideoFrame）画到白底画布并取 RGBA 像素 → decoded。
function drawableToDecoded(src, w, h) {
  if (!w || !h) return null;
  const cc = makeCanvasCtx(w, h);
  if (!cc) return null;
  const { ctx } = cc;
 // 白底填充：避免透明区（RGBA=0）在亮度二值化里被当成黑，破坏 QR quiet zone。
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
 // ImageData.data 是 Uint8ClampedArray，转 Uint8Array 对齐契约（不共享 buffer）。
  const samples = new Uint8Array(img.data);
  return { width: w, height: h, channels: 4, samples, colorType: 6, depth: 8 };
}

// GIF multi-frame stream: WebCodecs ImageDecoder, one frame at a time.
// Returns null when the API is unavailable so caller can fall back to first frame.
// maxFrames bounds a huge GIF without materializing every frame.
async function openGifStream(bytes, maxFrames) {
  if (typeof ImageDecoder === "undefined") return null;
  let dec;
  try {
 // Copy to an independent ArrayBuffer (bytes may be a view into another buffer).
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    dec = new ImageDecoder({ data: buf, type: "image/gif" });
    await dec.tracks.ready;
    const track = dec.tracks.selectedTrack;
    const total = track && track.frameCount ? track.frameCount : 1;
    const lim = Math.min(total, maxFrames);
    let index = 0;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      if (dec && dec.close) {
        try { dec.close(); } catch (_) { /* ignore */ }
      }
    };
    return {
      mime: "image/gif",
      total,
      async next() {
        while (!closed && index < lim) {
          let image = null;
          try {
            const res = await dec.decode({ frameIndex: index++ });
            image = res.image; // VideoFrame
            const w = image.displayWidth || image.codedWidth;
            const h = image.displayHeight || image.codedHeight;
            const decoded = drawableToDecoded(image, w, h);
            if (decoded) return decoded;
          } catch (_) {
            close();
            return null;
          } finally {
            if (image && image.close) {
              try { image.close(); } catch (_) { /* ignore */ }
            }
          }
        }
        close();
        return null;
      },
      async close() { close(); },
    };
  } catch (_) {
    if (dec && dec.close) {
      try { dec.close(); } catch (_) { /* ignore */ }
    }
    return null;
  }
}

// createImageBitmap single-frame decode (JPEG, and GIF fallback without ImageDecoder).
async function decodeSingleFrame(bytes, mime) {
  if (typeof createImageBitmap === "undefined" || typeof Blob === "undefined") return null;
  const blob = new Blob([bytes], { type: mime });
  let bmp;
  try {
    bmp = await createImageBitmap(blob);
  } catch (_) {
    return null;
  }
  const decoded = drawableToDecoded(bmp, bmp.width, bmp.height);
  if (bmp.close) bmp.close();
  return decoded;
}

// Single-frame stream (JPEG / PNG / BMP via canvas). Lazy: decode on first next().
function openSingleStream(bytes, mime) {
  let used = false;
  let closed = false;
  return {
    mime,
    total: 1,
    async next() {
      if (used || closed) return null;
      used = true;
      return await decodeSingleFrame(bytes, mime);
    },
    async close() { closed = true; },
  };
}

// ------------------------------------------------------------
// Main entry: openPixelFrameStream(bytes, opts)
// Yields decoded frames one by one, so callers can release pixels before
// decoding the next frame. Returns { mime, total, next(), close() } | null.
// - JPEG/PNG/BMP: one frame.
// - GIF: all frames via ImageDecoder (bounded by maxFrames) or first frame.
// total is the source frame count (may be > frames yielded due to maxFrames).
// ------------------------------------------------------------
export async function openPixelFrameStream(bytes, opts = {}) {
  if (!bytes || bytes.length === 0) return null;
  const u8a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const mime = opts.mime || detectCanvasMime(u8a);
  if (!mime) return null;
  const maxFrames = opts.maxFrames || 30;

  if (mime === "image/gif") {
    const gif = await openGifStream(u8a, maxFrames);
    if (gif) return gif;
  }
  return openSingleStream(u8a, mime);
}

// Release frame pixel storage as soon as analysis no longer needs it.
export function releaseDecoded(decoded) {
  if (!decoded) return;
  try { decoded.samples = null; } catch (_) { /* ignore */ }
  decoded.released = true;
}

// Compatibility entry: collect every frame. imageAnalysis now prefers the
// streaming API so 30x1080p frames are not kept resident at once.
export async function decodeToPixelFrames(bytes, opts = {}) {
  const stream = await openPixelFrameStream(bytes, opts);
  if (!stream) return null;
  try {
    const frames = [];
    for (;;) {
      const frame = await stream.next();
      if (!frame) break;
      frames.push(frame);
    }
    return frames.length ? { mime: stream.mime, frames, total: stream.total } : null;
  } finally {
    try { await stream.close(); } catch (_) { /* ignore */ }
  }
}

export default { detectCanvasMime, openPixelFrameStream, releaseDecoded, decodeToPixelFrames };
