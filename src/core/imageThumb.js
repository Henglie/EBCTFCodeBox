/*
 * imageThumb.js — JPEG APP1(EXIF IFD1) / APP0(JFIF) / PNG eXIf 缩略图提取。
 *
 * 纯字节解析，零 DOM：
 * - EXIF：TIFF 头 → IFD0 → next IFD(IFD1) → 0x0201/0x0202 偏移与长度。
 * - JFIF：APP0 头里 Xthumbnail/Ythumbnail + 3×W×H RGB 原始像素 → PNG。
 * - PNG：eXIf chunk 内 TIFF → 同上。
 *
 * 返回数组：[{ mime, bytes, width, height, source }]（数组上附 ok/reason 便于诊断）。
 */
import { encodePNG } from "./stegoPixels.js";

function u16(b, o, le) { return le ? (b[o] | (b[o + 1] << 8)) : ((b[o] << 8) | b[o + 1]); }
function u32(b, o, le) {
  return le
    ? ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0)
    : (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
}

function jpegSize(bytes) {
  if (!bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { width: 0, height: 0 };
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    let m = bytes[i + 1];
    while (m === 0xff) { i++; m = bytes[i + 1]; }
    if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (i + 3 >= bytes.length) break;
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2) break;
    const seg = i + 4;
    if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (seg + 4 < bytes.length) return { height: (bytes[seg + 1] << 8) | bytes[seg + 2], width: (bytes[seg + 3] << 8) | bytes[seg + 4] };
      return { width: 0, height: 0 };
    }
    i += 2 + len;
  }
  return { width: 0, height: 0 };
}

function extractTiffThumb(tiff, source) {
  if (!tiff || tiff.length < 8) return null;
  const order = String.fromCharCode(tiff[0], tiff[1]);
  if (order !== "II" && order !== "MM") return null;
  const le = order === "II";
  if (u16(tiff, 2, le) !== 42) return null;
  const ifd0 = u32(tiff, 4, le);
  if (ifd0 + 2 > tiff.length) return null;
  const n = u16(tiff, ifd0, le);
  const p = ifd0 + 2 + n * 12;
  const next = (p + 4 <= tiff.length) ? u32(tiff, p, le) : 0;
  const ifds = [ifd0, next];
  for (const off of ifds) {
    if (!off || off + 2 > tiff.length) continue;
    const cnt = u16(tiff, off, le);
    let q = off + 2;
    let jOff = 0, jLen = 0;
    for (let k = 0; k < cnt && q + 12 <= tiff.length; k++, q += 12) {
      const tag = u16(tiff, q, le);
      if (tag === 0x0201) jOff = u32(tiff, q + 8, le);
      else if (tag === 0x0202) jLen = u32(tiff, q + 8, le);
    }
    if (!jOff || !jLen) continue;
    if (jOff < tiff.length && jOff + jLen <= tiff.length) {
      const tb = tiff.subarray(jOff, jOff + jLen);
      if (tb[0] === 0xff && tb[1] === 0xd8) {
        const sz = jpegSize(tb);
        return { mime: "image/jpeg", bytes: new Uint8Array(tb), width: sz.width, height: sz.height, source };
      }
      // 少数工具把缩略图存成 PNG。
      if (tb[0] === 0x89 && tb[1] === 0x50) return { mime: "image/png", bytes: new Uint8Array(tb), width: 0, height: 0, source };
    }
  }
  return null;
}

function jfifThumb(data) {
  if (!data || data.length < 14) return null;
  if (String.fromCharCode(data[0], data[1], data[2], data[3], data[4]) !== "JFIF\0") return null;
  const w = data[12], h = data[13];
  if (!w || !h) return null;
  const need = 14 + w * h * 3;
  if (data.length < need) return null;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, s = 14, d = 0; i < w * h; i++, s += 3, d += 4) {
    rgba[d] = data[s]; rgba[d + 1] = data[s + 1]; rgba[d + 2] = data[s + 2]; rgba[d + 3] = 255;
  }
  return { mime: "image/png", bytes: encodePNG(rgba, w, h), width: w, height: h, source: "JFIF APP0" };
}

function parseJpegSegments(bytes) {
  const out = [];
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return out;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) { i++; continue; }
    let m = bytes[i + 1];
    while (m === 0xff && i + 2 < bytes.length) { i++; m = bytes[i + 1]; }
    if (m === 0xd8 || m === 0xd9) { i += 2; continue; }
    if (m === 0xda) break; // SOS 之后是压缩数据，标记段结束
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > bytes.length) break;
    const start = i + 4;
    const end = i + 2 + len;
    if ((m === 0xe0 || m === 0xe1) && end > start) {
      out.push({ marker: m, data: bytes.subarray(start, end) });
    }
    i = end;
  }
  return out;
}

function pngExifChunks(bytes) {
  const out = [];
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) return out;
  let p = 8;
  while (p + 12 <= bytes.length) {
    const len = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
    const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
    const dataStart = p + 8;
    if (len < 0 || dataStart + len + 4 > bytes.length) break;
    if (type === "eXIf") out.push(bytes.subarray(dataStart, dataStart + len));
    p = dataStart + len + 4;
    if (type === "IEND") break;
  }
  return out;
}

export function extractExifThumbnails(bytes) {
  const out = [];
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!u8.length) {
    out.ok = false;
    out.reason = "输入为空";
    return out;
  }
  const isJpeg = u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xd8;
  const isPng = u8.length >= 4 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47;
  if (!isJpeg && !isPng) {
    out.ok = false;
    out.reason = "无法识别图像格式（不是 JPEG/PNG）";
    return out;
  }
  try {
    for (const seg of parseJpegSegments(u8)) {
      if (seg.marker === 0xe0) {
        const t = jfifThumb(seg.data);
        if (t) out.push(t);
      } else if (seg.marker === 0xe1) {
        let d = seg.data;
        if (d[0] === 0x45 && d[1] === 0x78 && d[2] === 0x69 && d[3] === 0x66) {
          const tiff = d.subarray(6);
          const t = extractTiffThumb(tiff, "EXIF IFD1");
          if (t) out.push(t);
        }
      }
    }
    for (const tiff of pngExifChunks(u8)) {
      const t = extractTiffThumb(tiff, "PNG eXIf");
      if (t) out.push(t);
    }
  } catch (e) {
    out.reason = e && e.message ? e.message : String(e);
  }
  out.ok = out.length > 0;
  if (!out.ok && !out.reason) out.reason = "未发现 EXIF/JFIF 内嵌缩略图";
  return out;
}

export default { extractExifThumbnails };
