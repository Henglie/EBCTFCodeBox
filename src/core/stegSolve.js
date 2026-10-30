import { decodePNG, encodePNG, rgbaToDataURL, dataURLToBytes } from "./stegoPixels.js";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const CHANNELS = [
  { id: "r", label: "R 红", index: 0, tint: [255, 70, 70] },
  { id: "g", label: "G 绿", index: 1, tint: [80, 220, 120] },
  { id: "b", label: "B 蓝", index: 2, tint: [90, 150, 255] },
  { id: "a", label: "A 透明", index: 3, tint: [220, 220, 220] },
  { id: "gray", label: "灰度", index: -1, tint: [220, 220, 220] },
];

export const BIT_ORDERS = ["lsb", "msb"];
export const PREVIEW_MODES = ["source", "plain", "xor", "add", "sub"];
export const COMBINE_MODES = ["xor", "add", "sub", "and", "or"];
export const COLOR_MAPS = ["gray", "channel", "palette", "random"];

const CHANNEL_BY_ID = Object.fromEntries(CHANNELS.map((c) => [c.id, c]));
const PALETTE_ANCHORS = [
  [0, 0, 0], [8, 18, 56], [16, 74, 140], [28, 170, 180],
  [80, 210, 100], [245, 220, 70], [245, 140, 40], [235, 55, 55], [255, 255, 255],
];

function u8(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (ArrayBuffer.isView(bytes)) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (Array.isArray(bytes)) return Uint8Array.from(bytes);
  throw new Error("需要图像字节输入");
}

function u32be(b, o) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function u16le(b, o) {
  return b[o] | (b[o + 1] << 8);
}

function concatBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  out[0] = (data.length >>> 24) & 0xff;
  out[1] = (data.length >>> 16) & 0xff;
  out[2] = (data.length >>> 8) & 0xff;
  out[3] = data.length & 0xff;
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  return out;
}

function hasAPNGFrames(bytes) {
  const b = u8(bytes);
  let pos = 8;
  while (pos + 12 <= b.length) {
    const len = u32be(b, pos);
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    if (type === "acTL") return true;
    if (type === "IDAT" || type === "IEND") return false;
    pos += 12 + len;
  }
  return false;
}

export function detectImageFormat(bytes) {
  const b = u8(bytes);
  if (b.length >= 8 && PNG_SIG.every((v, i) => b[i] === v)) return hasAPNGFrames(b) ? "apng" : "png";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "gif";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
    && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  return "unknown";
}

export function mimeForFormat(format) {
  return { png: "image/png", apng: "image/png", gif: "image/gif", jpeg: "image/jpeg", bmp: "image/bmp", webp: "image/webp" }[format] || "application/octet-stream";
}

function lzwDecodeGif(sub, minCodeSize) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const MAX = 4096;
  const prefix = new Int32Array(MAX);
  const suffix = new Uint8Array(MAX);
  const stack = new Uint8Array(MAX + 1);
  let codeSize, next, prev, sp, bitpos;
  const reset = () => {
    for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; }
    for (let i = clear; i < MAX; i++) { prefix[i] = -1; suffix[i] = 0; }
    codeSize = minCodeSize + 1;
    next = eoi + 1;
    prev = -1;
    sp = 0;
  };
  reset();
  bitpos = 0;
  const nbits = sub.length * 8;
  const out = [];
  let firstCode = -1;
  while (bitpos + codeSize <= nbits) {
    let code = 0;
    for (let k = 0; k < codeSize; k++) {
      code |= (((sub[(bitpos + k) >> 3] >> ((bitpos + k) & 7)) & 1) << k);
    }
    bitpos += codeSize;
    if (code === clear) { reset(); firstCode = -1; continue; }
    if (code === eoi) break;
    if (prev === -1) { out.push(code); firstCode = code; prev = code; continue; }
    const incode = code;
    if (code >= next) { stack[sp++] = firstCode; code = prev; }
    while (code >= clear) {
      if (prefix[code] < 0) break;
      stack[sp++] = suffix[code];
      code = prefix[code];
    }
    firstCode = suffix[code];
    stack[sp++] = firstCode;
    if (next < MAX) {
      prefix[next] = prev;
      suffix[next] = firstCode;
      next++;
      if (next === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    while (sp > 0) out.push(stack[--sp]);
    prev = incode;
  }
  return out;
}

function readSubBlocks(b, start) {
  const chunks = [];
  let pos = start;
  while (pos < b.length) {
    const n = b[pos++];
    if (!n) break;
    const end = Math.min(pos + n, b.length);
    chunks.push(b.subarray(pos, end));
    pos = end;
  }
  return { chunks, pos };
}

function clearRect(canvas, W, H, x, y, w, h) {
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  const x1 = Math.min(W, x + w), y1 = Math.min(H, y + h);
  for (let yy = y0; yy < y1; yy++) {
    const row = yy * W * 4;
    for (let xx = x0; xx < x1; xx++) {
      const o = row + xx * 4;
      canvas[o] = 0; canvas[o + 1] = 0; canvas[o + 2] = 0; canvas[o + 3] = 0;
    }
  }
}

function drawGifFrame(canvas, W, H, frame, palette, transparentIndex) {
  const { left, top, w, h, indices } = frame;
  for (let y = 0; y < h; y++) {
    const dy = top + y;
    if (dy < 0 || dy >= H) continue;
    for (let x = 0; x < w; x++) {
      const dx = left + x;
      if (dx < 0 || dx >= W) continue;
      const idx = indices[y * w + x] || 0;
      if (transparentIndex >= 0 && idx === transparentIndex) continue;
      const pi = idx * 3;
      const o = (dy * W + dx) * 4;
      canvas[o] = palette[pi] || 0;
      canvas[o + 1] = palette[pi + 1] || 0;
      canvas[o + 2] = palette[pi + 2] || 0;
      canvas[o + 3] = 255;
    }
  }
}

function deinterlaceIndices(indices, w, h) {
  const out = new Uint8Array(w * h);
  let src = 0;
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]]) {
    for (let y = start; y < h; y += step) {
      const end = Math.min(src + w, indices.length);
      out.set(indices.subarray(src, end), y * w);
      src = end;
    }
  }
  return out;
}

export function decodeGifFrames(bytes, opts = {}) {
  const b = u8(bytes);
  if (b.length < 13 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46 || b[3] !== 0x38) {
    throw new Error("不是 GIF：魔数非 GIF8");
  }
  const W = u16le(b, 6);
  const H = u16le(b, 8);
  if (!W || !H) throw new Error("GIF 尺寸为 0");
  const packed = b[10];
  let pos = 13;
  let gct = null;
  if (packed & 0x80) {
    const n = 1 << ((packed & 7) + 1);
    gct = b.subarray(pos, Math.min(pos + n * 3, b.length));
    pos += n * 3;
  }

  const maxFrames = Math.max(1, opts.maxFrames || 600);
  const canvas = new Uint8ClampedArray(W * H * 4);
  const frames = [];
  let gce = { delay: 0, dispose: 0, transparent: -1 };
  let loop = null;
  let prevDispose = 0;
  let prevRect = null;
  let prevSnapshot = null;

  while (pos < b.length && frames.length < maxFrames) {
    const intro = b[pos];
    if (intro === 0x3b) break;
    if (intro === 0x21) {
      if (pos + 2 > b.length) break;
      const label = b[pos + 1];
      const sub = readSubBlocks(b, pos + 2);
      pos = sub.pos;
      if (label === 0xf9 && sub.chunks.length) {
        const d = sub.chunks[0];
        if (d.length >= 4) {
          const p = d[0];
          gce = {
            delay: u16le(d, 1) * 10,
            dispose: (p >> 2) & 7,
            transparent: (p & 1) ? d[3] : -1,
          };
        }
      } else if (label === 0xff && sub.chunks.length >= 2) {
        const head = sub.chunks[0];
        const app = String.fromCharCode.apply(null, Array.from(head));
        if (app.startsWith("NETSCAPE2.0") || app.startsWith("ANIMEXTS1.0")) {
          const d = sub.chunks[1];
          if (d.length >= 3 && d[0] === 1) loop = u16le(d, 1);
        }
      }
      continue;
    }
    if (intro !== 0x2c) { pos++; continue; }
    if (pos + 10 > b.length) break;
    const left = u16le(b, pos + 1);
    const top = u16le(b, pos + 3);
    const fw = u16le(b, pos + 5);
    const fh = u16le(b, pos + 7);
    const ipacked = b[pos + 9];
    pos += 10;
    let palette = gct;
    if (ipacked & 0x80) {
      const n = 1 << ((ipacked & 7) + 1);
      palette = b.subarray(pos, Math.min(pos + n * 3, b.length));
      pos += n * 3;
    }
    if (!palette) palette = new Uint8Array(768);
    if (pos >= b.length) break;
    const minCodeSize = b[pos++];
    const sub = readSubBlocks(b, pos);
    pos = sub.pos;
    const data = concatBytes(sub.chunks);
    const decoded = Uint8Array.from(lzwDecodeGif(data, minCodeSize));
    const indices = (ipacked & 0x40) ? deinterlaceIndices(decoded, fw, fh) : decoded;

    if (prevDispose === 2 && prevRect) clearRect(canvas, W, H, prevRect.left, prevRect.top, prevRect.w, prevRect.h);
    else if (prevDispose === 3 && prevSnapshot) canvas.set(prevSnapshot);
    const snapshot = gce.dispose === 3 ? canvas.slice() : null;

    drawGifFrame(canvas, W, H, { left, top, w: fw, h: fh, indices }, palette, gce.transparent);
    frames.push({
      width: W,
      height: H,
      data: canvas.slice(),
      delay: gce.delay,
      dispose: gce.dispose,
      blend: 0,
      sourceRect: { x: left, y: top, width: fw, height: fh },
    });

    prevDispose = gce.dispose;
    prevRect = { left, top, w: fw, h: fh };
    prevSnapshot = snapshot;
    gce = { delay: 0, dispose: 0, transparent: -1 };
  }
  if (!frames.length) throw new Error("GIF 未包含可解码帧");
  const more = pos < b.length && b[pos] !== 0x3b;
  return { format: "gif", width: W, height: H, total: frames.length, loop, frames, truncated: frames.length >= maxFrames && more };
}

function apngParseControl(d) {
  return {
    width: u32be(d, 4),
    height: u32be(d, 8),
    x: u32be(d, 12),
    y: u32be(d, 16),
    delayNum: d[20] | (d[21] << 8),
    delayDen: d[22] | (d[23] << 8),
    dispose: d[24],
    blend: d[25],
  };
}

function apngFramePNG(ihdr, palette, trns, idat) {
  const ih = new Uint8Array(13);
  ih[0] = (ihdr.width >>> 24) & 0xff;
  ih[1] = (ihdr.width >>> 16) & 0xff;
  ih[2] = (ihdr.width >>> 8) & 0xff;
  ih[3] = ihdr.width & 0xff;
  ih[4] = (ihdr.height >>> 24) & 0xff;
  ih[5] = (ihdr.height >>> 16) & 0xff;
  ih[6] = (ihdr.height >>> 8) & 0xff;
  ih[7] = ihdr.height & 0xff;
  ih[8] = ihdr.bitDepth;
  ih[9] = ihdr.colorType;
  ih[10] = ihdr.compression;
  ih[11] = ihdr.filter;
  ih[12] = ihdr.interlace;
  const parts = [new Uint8Array(PNG_SIG), pngChunk("IHDR", ih)];
  if (palette) parts.push(pngChunk("PLTE", palette));
  if (trns) parts.push(pngChunk("tRNS", trns));
  parts.push(pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array(0)));
  return concatBytes(parts);
}

function blendAPNGFrame(canvas, W, H, src, sw, sh, x, y, blend) {
  for (let sy = 0; sy < sh; sy++) {
    const dy = y + sy;
    if (dy < 0 || dy >= H) continue;
    for (let sx = 0; sx < sw; sx++) {
      const dx = x + sx;
      if (dx < 0 || dx >= W) continue;
      const si = (sy * sw + sx) * 4;
      const di = (dy * W + dx) * 4;
      const sa = src[si + 3] / 255;
      if (blend === 0 || sa >= 1) {
        canvas[di] = src[si];
        canvas[di + 1] = src[si + 1];
        canvas[di + 2] = src[si + 2];
        canvas[di + 3] = src[si + 3];
        continue;
      }
      if (sa <= 0) continue;
      const da = canvas[di + 3] / 255;
      const oa = sa + da * (1 - sa);
      if (oa <= 0) continue;
      for (let c = 0; c < 3; c++) {
        canvas[di + c] = Math.round((src[si + c] * sa + canvas[di + c] * da * (1 - sa)) / oa);
      }
      canvas[di + 3] = Math.round(oa * 255);
    }
  }
}

export function decodeAPNGFrames(bytes, opts = {}) {
  const b = u8(bytes);
  if (b.length < 8 || !PNG_SIG.every((v, i) => b[i] === v)) throw new Error("不是 APNG：PNG 签名错误");
  let pos = 8;
  let ihdr = null;
  let palette = null;
  let trns = null;
  let actl = null;
  const frameDefs = [];
  let cur = null;
  let sawIdat = false;
  let idatOwner = null;
  const defaultIdat = [];

  while (pos + 12 <= b.length) {
    const len = u32be(b, pos);
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    const data = b.subarray(pos + 8, Math.min(pos + 8 + len, b.length));
    if (type === "IHDR") {
      ihdr = {
        width: u32be(data, 0),
        height: u32be(data, 4),
        bitDepth: data[8],
        colorType: data[9],
        compression: data[10],
        filter: data[11],
        interlace: data[12],
      };
    } else if (type === "acTL") {
      actl = { numFrames: u32be(data, 0), numPlays: u32be(data, 4) };
    } else if (type === "PLTE") {
      palette = data;
    } else if (type === "tRNS") {
      trns = data;
    } else if (type === "fcTL") {
      cur = Object.assign(apngParseControl(data), { idat: [], fdat: [] });
      if (!sawIdat && !idatOwner) idatOwner = cur;
      frameDefs.push(cur);
    } else if (type === "IDAT") {
      if (idatOwner) idatOwner.idat.push(data);
      else defaultIdat.push(data);
      sawIdat = true;
    } else if (type === "fdAT") {
      if (cur && data.length > 4) cur.fdat.push(data.subarray(4));
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  if (!ihdr) throw new Error("APNG 缺少 IHDR");
  const W = ihdr.width;
  const H = ihdr.height;

  if (!frameDefs.length) {
    if (!defaultIdat.length) throw new Error("APNG 缺少帧数据");
    const img = decodePNG(apngFramePNG(ihdr, palette, trns, concatBytes(defaultIdat)));
    return {
      format: "apng", width: W, height: H, total: 1, loop: actl ? actl.numPlays : null,
      frames: [{ width: W, height: H, data: img.data, delay: 0, dispose: 0, blend: 0 }],
    };
  }

  const maxFrames = Math.max(1, opts.maxFrames || 600);
  const canvas = new Uint8ClampedArray(W * H * 4);
  const frames = [];
  let prev = null;
  let prevSnapshot = null;
  let usedIdat = false;

  for (const def of frameDefs) {
    if (frames.length >= maxFrames) break;
    let data;
    if (def.idat.length && !usedIdat) { data = concatBytes(def.idat); usedIdat = true; }
    else if (def.fdat.length) data = concatBytes(def.fdat);
    else if (def.idat.length) data = concatBytes(def.idat);
    else continue;

    if (prev) {
      if (prev.dispose === 1) clearRect(canvas, W, H, prev.x, prev.y, prev.width, prev.height);
      else if (prev.dispose === 2 && prevSnapshot) canvas.set(prevSnapshot);
    }
    const snapshot = def.dispose === 2 ? canvas.slice() : null;
    const fihdr = Object.assign({}, ihdr, { width: def.width, height: def.height });
    const img = decodePNG(apngFramePNG(fihdr, palette, trns, data));
    blendAPNGFrame(canvas, W, H, img.data, img.width, img.height, def.x, def.y, def.blend);
    const den = def.delayDen === 0 ? 100 : def.delayDen;
    frames.push({
      width: W,
      height: H,
      data: canvas.slice(),
      delay: Math.round((def.delayNum / den) * 1000),
      dispose: def.dispose,
      blend: def.blend,
      sourceRect: { x: def.x, y: def.y, width: def.width, height: def.height },
    });
    prev = def;
    prevSnapshot = snapshot;
  }
  if (!frames.length) throw new Error("APNG 未能解出帧");
  return {
    format: "apng", width: W, height: H, total: actl ? actl.numFrames : frames.length,
    loop: actl ? actl.numPlays : null, frames,
    truncated: frames.length >= maxFrames && frames.length < (actl ? actl.numFrames : frames.length),
  };
}

export function decodeImageFrames(bytes, opts = {}) {
  const b = u8(bytes);
  const format = detectImageFormat(b);
  if (format === "apng") return decodeAPNGFrames(b, opts);
  if (format === "png") {
    const img = decodePNG(b);
    return {
      format: "png", width: img.width, height: img.height, total: 1, loop: null,
      frames: [{ width: img.width, height: img.height, data: img.data, delay: 0, dispose: 0, blend: 0 }],
    };
  }
  if (format === "gif") return decodeGifFrames(b, opts);
  const err = new Error("Node 内置解码仅支持 PNG/APNG/GIF；" + format.toUpperCase() + " 需浏览器 canvas");
  err.code = "BROWSER_DECODE_REQUIRED";
  err.format = format;
  throw err;
}

export function decodeImageBytes(bytes) {
  const frames = decodeImageFrames(bytes, { maxFrames: 1 });
  return frames.frames[0];
}

function channelAt(data, i, channel) {
  const o = i * 4;
  if (channel === "r") return data[o];
  if (channel === "g") return data[o + 1];
  if (channel === "b") return data[o + 2];
  if (channel === "a") return data[o + 3];
  return Math.round(data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114);
}

function normalizeChannel(channel) {
  const id = String(channel || "b").toLowerCase();
  return CHANNEL_BY_ID[id] ? id : "b";
}

function actualBitOf(bit, order) {
  const v = Math.max(0, Math.min(7, Number(bit) | 0));
  return order === "msb" ? 7 - v : v;
}

export function makeRandomPalette(seed = 1) {
  let s = (Number(seed) >>> 0) || 1;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  };
  const pal = new Uint8Array(768);
  for (let i = 0; i < 256; i++) {
    pal[i * 3] = next();
    pal[i * 3 + 1] = next();
    pal[i * 3 + 2] = next();
  }
  return pal;
}

let fixedPalette = null;
function paletteAt(v) {
  if (!fixedPalette) {
    fixedPalette = new Uint8Array(768);
    const n = PALETTE_ANCHORS.length - 1;
    for (let i = 0; i < 256; i++) {
      const t = (i / 255) * n;
      const a = Math.min(n - 1, Math.floor(t));
      const f = t - a;
      for (let c = 0; c < 3; c++) {
        fixedPalette[i * 3 + c] = Math.round(PALETTE_ANCHORS[a][c] * (1 - f) + PALETTE_ANCHORS[a + 1][c] * f);
      }
    }
  }
  return fixedPalette;
}

function writeMapped(out, o, channel, v, colorMap, randomPal, plain) {
  if (colorMap === "channel") {
    const tint = CHANNEL_BY_ID[channel].tint;
    out[o] = tint[0] * (v / 255);
    out[o + 1] = tint[1] * (v / 255);
    out[o + 2] = tint[2] * (v / 255);
  } else if (colorMap === "random") {
    out[o] = randomPal[v * 3];
    out[o + 1] = randomPal[v * 3 + 1];
    out[o + 2] = randomPal[v * 3 + 2];
  } else if (colorMap === "palette") {
    if (plain) {
      const c = v >= 128 ? [255, 176, 80] : [20, 26, 45];
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
    } else {
      const p = paletteAt(v);
      out[o] = p[v * 3]; out[o + 1] = p[v * 3 + 1]; out[o + 2] = p[v * 3 + 2];
    }
  } else {
    out[o] = v; out[o + 1] = v; out[o + 2] = v;
  }
  out[o + 3] = 255;
}

export function renderBitPlane(image, opts = {}) {
  if (opts.mode === "source") return renderChannel(image, opts);
  const w = image.width, h = image.height, data = image.data;
  const channel = normalizeChannel(opts.channel);
  const order = opts.order === "msb" ? "msb" : "lsb";
  const ab = actualBitOf(opts.bit == null ? 0 : opts.bit, order);
  const mode = PREVIEW_MODES.includes(opts.mode) && opts.mode !== "source" ? opts.mode : "plain";
  const invert = !!opts.invert;
  const colorMap = COLOR_MAPS.includes(opts.colorMap) ? opts.colorMap : "gray";
  const randomPal = colorMap === "random" ? makeRandomPalette(opts.seed == null ? 1 : opts.seed) : null;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const src = channelAt(data, i, channel);
    const bit = (src >> ab) & 1;
    const mask = bit ? 255 : 0;
    let v;
    if (mode === "xor") v = src ^ mask;
    else if (mode === "add") v = (src + mask) & 255;
    else if (mode === "sub") v = (src - mask + 256) & 255;
    else v = mask;
    if (invert) v = 255 - v;
    writeMapped(out, i * 4, channel, v, colorMap, randomPal, mode === "plain");
  }
  return { width: w, height: h, data: out };
}

export function renderChannel(image, opts = {}) {
  const w = image.width, h = image.height, data = image.data;
  const channel = normalizeChannel(opts.channel);
  const invert = !!opts.invert;
  const colorMap = COLOR_MAPS.includes(opts.colorMap) ? opts.colorMap : "gray";
  const randomPal = colorMap === "random" ? makeRandomPalette(opts.seed == null ? 1 : opts.seed) : null;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let v = channelAt(data, i, channel);
    if (invert) v = 255 - v;
    writeMapped(out, i * 4, channel, v, colorMap, randomPal, false);
  }
  return { width: w, height: h, data: out };
}

export function extractBitstream(image, opts = {}) {
  const w = image.width, h = image.height, data = image.data;
  const channel = normalizeChannel(opts.channel);
  const order = opts.order === "msb" ? "msb" : "lsb";
  const ab = actualBitOf(opts.bit == null ? 0 : opts.bit, order);
  const xor = opts.xorWith || null;
  const xorChannel = xor ? normalizeChannel(xor.channel) : null;
  const xorOrder = xor && xor.order === "msb" ? "msb" : order;
  const xorAb = xor ? actualBitOf(xor.bit == null ? opts.bit : xor.bit, xorOrder) : -1;
  const pack = opts.pack === "lsb" ? "lsb" : "msb";
  const scan = opts.scan === "column" ? "column" : "row";
  const offset = Math.max(0, Number(opts.offsetBits) || 0);
  const maxBytes = opts.maxBytes == null ? Infinity : Math.max(0, Number(opts.maxBytes) || 0);
  const capBits = Number.isFinite(maxBytes) ? maxBytes * 8 : Infinity;
  const totalBits = w * h;
  const outLen = Math.min(Math.ceil(Math.max(0, totalBits - offset) / 8), Number.isFinite(maxBytes) ? maxBytes : Infinity);
  const out = new Uint8Array(outLen);
  let bitPos = 0;
  let emitted = 0;
  const push = (i) => {
    if (bitPos < offset) { bitPos++; return; }
    if (emitted >= capBits) return;
    let bit = (channelAt(data, i, channel) >> ab) & 1;
    if (xor) bit ^= (channelAt(data, i, xorChannel) >> xorAb) & 1;
    const rel = bitPos - offset;
    out[rel >> 3] |= bit << (pack === "lsb" ? (rel & 7) : (7 - (rel & 7)));
    bitPos++;
    emitted++;
  };
  if (scan === "column") {
    outer: for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        push(y * w + x);
        if (emitted >= capBits) break outer;
      }
    }
  } else {
    for (let i = 0; i < totalBits; i++) {
      push(i);
      if (emitted >= capBits) break;
    }
  }
  return out;
}

export function combineImages(a, b, mode = "xor") {
  if (!a || !b || !a.data || !b.data) throw new Error("合并需要两张已解码图像");
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`尺寸不一致：${a.width}×${a.height} 与 ${b.width}×${b.height}`);
  }
  if (!COMBINE_MODES.includes(mode)) throw new Error("不支持的合并方式：" + mode);
  const w = a.width, h = a.height;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    for (let c = 0; c < 3; c++) {
      const x = a.data[o + c], y = b.data[o + c];
      if (mode === "xor") out[o + c] = x ^ y;
      else if (mode === "add") out[o + c] = (x + y) & 255;
      else if (mode === "sub") out[o + c] = (x - y + 256) & 255;
      else if (mode === "and") out[o + c] = x & y;
      else out[o + c] = x | y;
    }
    out[o + 3] = 255;
  }
  return { width: w, height: h, data: out };
}

export function imageToPNG(image) {
  return encodePNG(image.data, image.width, image.height);
}

export function imageToDataURL(image) {
  return rgbaToDataURL(image.data, image.width, image.height);
}

export function bytesToLatin1(bytes) {
  const b = u8(bytes);
  let s = "";
  for (let i = 0; i < b.length; i += 8192) {
    s += String.fromCharCode.apply(null, b.subarray(i, Math.min(i + 8192, b.length)));
  }
  return s;
}

function decodeBytesText(bytes) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text, encoding: "utf-8" };
  } catch {
    return { text: bytesToLatin1(bytes), encoding: "latin1" };
  }
}

function scoreText(text) {
  const n = text.length;
  if (!n) return { printableRatio: 0, asciiRatio: 0, score: 0, flags: [], longestRun: 0 };
  let printable = 0, ascii = 0, letters = 0, run = 0, longest = 0;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c >= 32 && c <= 126) { printable++; ascii++; run++; }
    else if (c === 9 || c === 10 || c === 13) { ascii++; run++; }
    else run = 0;
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)) letters++;
    if (run > longest) longest = run;
  }
  const flags = [];
  const re = /[A-Za-z][A-Za-z0-9_]{1,24}\{[ -~]{4,160}\}/g;
  let m;
  while ((m = re.exec(text))) {
    if (!flags.includes(m[0])) flags.push(m[0]);
  }
  const printableRatio = printable / n;
  const asciiRatio = ascii / n;
  const score = printableRatio * 120 + asciiRatio * 30 + Math.min(longest, 160) * 0.45
    + Math.min(letters / n, 1) * 15 + flags.length * 800;
  return { printableRatio, asciiRatio, score: Math.round(score * 10) / 10, flags, longestRun: longest };
}

function candidateText(bytes, maxChars = 8192) {
  const { text, encoding } = decodeBytesText(bytes);
  return { text: text.slice(0, maxChars), encoding };
}

function candidateScoreCompare(a, b) {
  if (a.hasFlag !== b.hasFlag) return a.hasFlag ? -1 : 1;
  if (b.score !== a.score) return b.score - a.score;
  const rank = { b: 0, g: 1, r: 2, a: 3, gray: 4 };
  if (rank[a.channel] !== rank[b.channel]) return rank[a.channel] - rank[b.channel];
  if (a.bit !== b.bit) return a.bit - b.bit;
  return a.pack === "msb" ? -1 : 1;
}

export function stegSolveAnalyze(bytes, opts = {}) {
  const b = u8(bytes);
  const decoded = decodeImageFrames(b, { maxFrames: 1 });
  const image = decoded.frames[0];
  const w = image.width, h = image.height;
  const limit = Math.max(1, opts.limit || 40);
  const defaultMax = Math.min(65536, Math.ceil((w * h) / 8));
  const maxBytes = opts.maxBytes == null ? defaultMax : Math.max(0, opts.maxBytes);
  const channels = Array.isArray(opts.channels) && opts.channels.length ? opts.channels.map(normalizeChannel) : ["r", "g", "b", "a", "gray"];
  const bits = Array.isArray(opts.bits) && opts.bits.length ? opts.bits : [0, 1, 2, 3, 4, 5, 6, 7];
  const packs = Array.isArray(opts.packs) && opts.packs.length ? opts.packs : ["msb", "lsb"];
  const candidates = [];

  for (const channel of channels) {
    for (const bit of bits) {
      for (const pack of packs) {
        const data = extractBitstream(image, { channel, bit, order: "lsb", pack, maxBytes });
        const { text, encoding } = candidateText(data);
        const s = scoreText(text);
        candidates.push({
          channel,
          channelLabel: CHANNEL_BY_ID[channel].label,
          bit,
          order: "lsb",
          pack,
          xor: null,
          xorWith: null,
          encoding,
          lengthBytes: data.length,
          printableRatio: s.printableRatio,
          asciiRatio: s.asciiRatio,
          longestRun: s.longestRun,
          score: s.score,
          hasFlag: s.flags.length > 0,
          flags: s.flags,
          text,
          preview: text.slice(0, 1200),
          setting: { channel, bit, order: "lsb", mode: "plain", colorMap: "gray", invert: false },
        });
      }
    }
  }

  if (opts.xor !== false) {
    const pairs = [["r", "g"], ["r", "b"], ["r", "a"], ["g", "b"], ["g", "a"], ["b", "a"]];
    const xorBits = Array.isArray(opts.xorBits) && opts.xorBits.length ? opts.xorBits : [0, 1, 2, 3];
    for (const [c1, c2] of pairs) {
      for (const bit of xorBits) {
        for (const pack of packs) {
          const data = extractBitstream(image, { channel: c1, bit, order: "lsb", pack, maxBytes, xorWith: { channel: c2, bit, order: "lsb" } });
          const { text, encoding } = candidateText(data);
          const s = scoreText(text);
          candidates.push({
            channel: c1,
            channelLabel: CHANNEL_BY_ID[c1].label + "⊕" + CHANNEL_BY_ID[c2].label,
            bit,
            order: "lsb",
            pack,
            xor: c1 + "^" + c2,
            xorWith: { channel: c2, bit, order: "lsb" },
            encoding,
            lengthBytes: data.length,
            printableRatio: s.printableRatio,
            asciiRatio: s.asciiRatio,
            longestRun: s.longestRun,
            score: s.score,
            hasFlag: s.flags.length > 0,
            flags: s.flags,
            text,
            preview: text.slice(0, 1200),
            setting: { channel: c1, bit, order: "lsb", mode: "plain", colorMap: "gray", invert: false, xorWith: { channel: c2, bit } },
          });
        }
      }
    }
  }

  candidates.sort(candidateScoreCompare);
  return {
    width: w,
    height: h,
    format: decoded.format,
    totalFrames: decoded.total,
    scanned: candidates.length,
    truncated: w * h > maxBytes * 8,
    candidates: candidates.slice(0, limit),
  };
}

// ============================================================
// StegSolve-1.4 对齐：42 变换 / Data Extract / 合并 / 立体图
// ============================================================

export const STEGSOLVE_TRANSFORMS = (() => {
  const list = [
    { index: 0, label: "原图" },
    { index: 1, label: "颜色反转 (XOR)" },
  ];
  const channels = [["a", "Alpha"], ["r", "Red"], ["g", "Green"], ["b", "Blue"]];
  for (const [ch, label] of channels) {
    for (let bit = 7; bit >= 0; bit--) list.push({ index: list.length, label: `${label} 位平面 ${bit}`, kind: "bit", channel: ch, bit });
  }
  list.push(
    { index: list.length, label: "完整 Alpha", kind: "mask", channel: "a" },
    { index: list.length, label: "完整 Red", kind: "mask", channel: "r" },
    { index: list.length, label: "完整 Green", kind: "mask", channel: "g" },
    { index: list.length, label: "完整 Blue", kind: "mask", channel: "b" },
    { index: list.length, label: "随机颜色映射 1", kind: "random" },
    { index: list.length, label: "随机颜色映射 2", kind: "random" },
    { index: list.length, label: "随机颜色映射 3", kind: "random" },
    { index: list.length, label: "灰度位 (R=G=B)", kind: "graybits" },
  );
  // list.length 在同一个 push 的所有实参求值时不会逐个增长，统一回填真实索引。
  list.forEach((t, i) => { t.index = i; });
  return list;
})();

function makeRng(seed) {
  let s = (Number(seed) >>> 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s >>> 0;
  };
}

/** 按 StegSolve 的 42 变换顺序渲染。image = {width,height,data:RGBA}。 */
export function applyStegSolveTransform(image, index, opts = {}) {
  const w = image.width, h = image.height, src = image.data;
  const n = w * h;
  const out = new Uint8ClampedArray(n * 4);
  const idx = Math.max(0, Math.min(STEGSOLVE_TRANSFORMS.length - 1, Number(index) | 0));
  const def = STEGSOLVE_TRANSFORMS[idx];
  const setOpaque = (o, r, g, b) => { out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = 255; };

  if (idx === 0) {
    out.set(src);
    return { width: w, height: h, data: out };
  }
  if (idx === 1) {
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      setOpaque(o, src[o] ^ 255, src[o + 1] ^ 255, src[o + 2] ^ 255);
    }
    return { width: w, height: h, data: out };
  }
  if (def.kind === "bit") {
    const off = { r: 0, g: 1, b: 2, a: 3 }[def.channel];
    for (let i = 0; i < n; i++) {
      const v = (src[i * 4 + off] >> def.bit) & 1;
      const c = v ? 255 : 0;
      setOpaque(i * 4, c, c, c);
    }
    return { width: w, height: h, data: out };
  }
  if (def.kind === "mask") {
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const v = src[o + { r: 0, g: 1, b: 2, a: 3 }[def.channel]];
      // jar 的 transmask：完整 Alpha 会被 >>>8 落到 Red 通道。
      if (def.channel === "a") setOpaque(o, v, 0, 0);
      else if (def.channel === "r") setOpaque(o, v, 0, 0);
      else if (def.channel === "g") setOpaque(o, 0, v, 0);
      else setOpaque(o, 0, 0, v);
    }
    return { width: w, height: h, data: out };
  }
  if (def.kind === "graybits") {
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const c = src[o] === src[o + 1] && src[o + 1] === src[o + 2] ? 255 : 0;
      setOpaque(o, c, c, c);
    }
    return { width: w, height: h, data: out };
  }
  // 随机颜色映射：jar 用随机 per-channel 仿射映射；这里给出等价观感的随机映射。
  const rnd = makeRng(opts.seed == null ? ((Math.random() * 0xffffffff) >>> 0) : opts.seed);
  const ar = 1 + (rnd() % 255), ag = 1 + (rnd() % 255), ab = 1 + (rnd() % 255);
  const br = rnd() & 255, bg = rnd() & 255, bb = rnd() & 255;
  const xr = rnd() & 255, xg = rnd() & 255, xb = rnd() & 255;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    setOpaque(o,
      ((((src[o] * ar) * ar) ^ xr) + br) & 255,
      ((((src[o + 1] * ag) * ag) ^ xg) + bg) & 255,
      ((((src[o + 2] * ab) * ab) ^ xb) + bb) & 255);
  }
  return { width: w, height: h, data: out };
}

/**
 * StegSolve Data Extract：Alpha 先，RGB 按 planeOrder；位序只控制通道内遍历方向，
 * 输出始终 MSB-first 打包。
 */
export function extractStegSolveData(image, options = {}) {
  const w = image.width, h = image.height, src = image.data;
  const bits = options.bits || {};
  const order = options.order === "lsb" ? "lsb" : "msb";
  const scan = options.scan === "column" ? "column" : "row";
  const planeOrder = /^(RGB|RBG|GRB|GBR|BRG|BGR)$/.test(options.planeOrder || "") ? options.planeOrder : "RGB";
  const channelIndex = { r: 0, g: 1, b: 2, a: 3 };
  const selected = [];
  selected.push({ ch: "a", bits: Array.isArray(bits.a) ? bits.a : [] });
  for (const ch of planeOrder.toLowerCase()) selected.push({ ch, bits: Array.isArray(bits[ch]) ? bits[ch] : [] });
  const selectedBits = selected.reduce((n, s) => n + s.bits.length, 0);
  const totalBits = w * h * selectedBits;
  const out = new Uint8Array(Math.ceil(totalBits / 8));
  const previewLimit = Math.max(0, Number(options.previewLimit) || 65536);
  const previewOf = (bytes) => formatExtractPreview(
    previewLimit ? bytes.subarray(0, previewLimit) : bytes,
    options.includeHex !== false,
  );
  if (!selectedBits) return { width: w, height: h, bytes: out, preview: "", previewTruncated: false, selectedBits: 0, totalBits: 0 };

  let bitPos = 0;
  const emit = (v) => {
    if (v) out[bitPos >> 3] |= 1 << (7 - (bitPos & 7));
    bitPos++;
  };
  const walkPixel = (x, y) => {
    const o = (y * w + x) * 4;
    for (const part of selected) {
      if (!part.bits.length) continue;
      const v = src[o + channelIndex[part.ch]];
      if (order === "lsb") {
        for (let b = 0; b <= 7; b++) if (part.bits.includes(b)) emit((v >> b) & 1);
      } else {
        for (let b = 7; b >= 0; b--) if (part.bits.includes(b)) emit((v >> b) & 1);
      }
    }
  };
  if (scan === "column") {
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) walkPixel(x, y);
  } else {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) walkPixel(x, y);
  }
  return {
    width: w, height: h, bytes: out, selectedBits, totalBits,
    preview: previewOf(out),
    previewTruncated: out.length > previewLimit && previewLimit > 0,
  };
}

/** jar 风格 16 字节 hex/ASCII 预览。 */
export function formatExtractPreview(bytes, includeHex = true) {
  const lines = [];
  for (let off = 0; off < bytes.length; off += 16) {
    const chunk = bytes.subarray(off, Math.min(off + 16, bytes.length));
    let hex = "";
    if (includeHex) {
      for (let i = 0; i < chunk.length; i++) {
        hex += chunk[i].toString(16).padStart(2, "0");
        if (i === 7) hex += " ";
      }
    }
    let ascii = "";
    for (let i = 0; i < chunk.length; i++) {
      const b = chunk[i];
      ascii += b >= 32 && b <= 128 ? String.fromCharCode(b) : ".";
      if (i === 7) ascii += " ";
    }
    // jar：一行 = hex dump + 两个空格 + ASCII dump；不勾 hex 时只输出 ASCII。
    lines.push(includeHex ? hex + "  " + ascii : ascii);
  }
  return lines.join("\n");
}

function packedRGB(data, o) {
  return (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
}
function writePacked(out, o, v) {
  out[o] = (v >> 16) & 255;
  out[o + 1] = (v >> 8) & 255;
  out[o + 2] = v & 255;
  out[o + 3] = 255;
}

/** 13 种 Image Combiner 模式（0..12，jar 顺序）。 */
export function combineStegSolveImages(a, b, mode = 0) {
  if (!a || !b || !a.data || !b.data) throw new Error("合并需要两张已解码图像");
  const m = Math.max(0, Math.min(12, Number(mode) | 0));
  const W = Math.max(a.width, b.width);
  const H = Math.max(a.height, b.height);
  if (m === 11 || m === 12) {
    // jar 的 calcInterlace() 取两图公共最小宽高，不是最大宽高。
    const iw = Math.min(a.width, b.width);
    const ih = Math.min(a.height, b.height);
    const ow = m === 12 ? iw * 2 : iw;
    const oh = m === 11 ? ih * 2 : ih;
    const out = new Uint8ClampedArray(ow * oh * 4);
    for (let y = 0; y < ih; y++) {
      for (let x = 0; x < iw; x++) {
        const pa = packedRGB(a.data, (y * a.width + x) * 4);
        const pb = packedRGB(b.data, (y * b.width + x) * 4);
        if (m === 11) {
          writePacked(out, ((y * 2) * ow + x) * 4, pa);
          writePacked(out, ((y * 2 + 1) * ow + x) * 4, pb);
        } else {
          writePacked(out, (y * ow + x * 2) * 4, pa);
          writePacked(out, (y * ow + x * 2 + 1) * 4, pb);
        }
      }
    }
    return { width: ow, height: oh, data: out };
  }
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const pa = x < a.width && y < a.height ? packedRGB(a.data, (y * a.width + x) * 4) : 0;
      const pb = x < b.width && y < b.height ? packedRGB(b.data, (y * b.width + x) * 4) : 0;
      let v = 0;
      switch (m) {
        case 0: v = pa ^ pb; break;
        case 1: v = pa | pb; break;
        case 2: v = pa & pb; break;
        case 3: v = (pa + pb) & 0xffffff; break;
        case 5: v = (pa - pb) & 0xffffff; break;
        case 7: v = Math.imul(pa, pb) & 0xffffff; break;
        case 4:
        case 6:
        case 8:
        case 9:
        case 10: {
          let r, g, bl;
          const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
          const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
          if (m === 4) { r = (ar + br) & 255; g = (ag + bg) & 255; bl = (ab + bb) & 255; }
          else if (m === 6) { r = (ar - br) & 255; g = (ag - bg) & 255; bl = (ab - bb) & 255; }
          else if (m === 8) { r = (ar * br) & 255; g = (ag * bg) & 255; bl = (ab * bb) & 255; }
          else if (m === 9) { r = Math.max(ar, br); g = Math.max(ag, bg); bl = Math.max(ab, bb); }
          else { r = Math.min(ar, br); g = Math.min(ag, bg); bl = Math.min(ab, bb); }
          v = (r << 16) | (g << 8) | bl;
          break;
        }
        default: v = pa ^ pb;
      }
      writePacked(out, (y * W + x) * 4, v);
    }
  }
  return { width: W, height: H, data: out };
}

/** Stereogram Solver：out(x,y) = orig(x,y) XOR orig((x+offset)%w,y)。 */
export function stereogramXor(image, offset = 0) {
  const w = image.width, h = image.height, src = image.data;
  const off = ((Number(offset) | 0) % w + w) % w;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const so = (y * w + ((x + off) % w)) * 4;
      writePacked(out, o, packedRGB(src, o) ^ packedRGB(src, so));
    }
  }
  return { width: w, height: h, data: out };
}

export { decodePNG, encodePNG, rgbaToDataURL, dataURLToBytes };

export default {
  CHANNELS,
  COMBINE_MODES,
  COLOR_MAPS,
  PREVIEW_MODES,
  BIT_ORDERS,
  detectImageFormat,
  mimeForFormat,
  decodeImageFrames,
  decodeImageBytes,
  decodeGifFrames,
  decodeAPNGFrames,
  renderBitPlane,
  renderChannel,
  extractBitstream,
  combineImages,
  imageToPNG,
  imageToDataURL,
  makeRandomPalette,
  stegSolveAnalyze,
  bytesToLatin1,
  STEGSOLVE_TRANSFORMS,
  applyStegSolveTransform,
  extractStegSolveData,
  formatExtractPreview,
  combineStegSolveImages,
  stereogramXor,
  decodePNG,
  encodePNG,
  rgbaToDataURL,
  dataURLToBytes,
};
