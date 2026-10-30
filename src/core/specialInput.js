/*
 * specialInput.js — 固定头/固定形态输入的触发器（纯识别，不渲染）。
 *
 * 需求来源：
 * - KEY.exe 实际是 `data:image/jpg;base64,...` 文本（里面其实是 PNG）。碰到
 *   `data:image/...;base64,` 固定头就应触发图片分析，而不是只当普通文本解码。
 * - rgb_to_img.txt 是「一行一个 RGB(A) 像素」数值文本，应触发「数值数据渲染成图」。
 *
 * 本模块只做识别与解码后的字节归一化，渲染由 main.js 接线。
 */

const DATA_URI_RE = /data:image\/[a-z0-9.+-]+(?:;[a-z0-9=.+-]+)*;base64,([A-Za-z0-9+/=\s]+)/gi;

function b64ToBytes(b64) {
  const clean = String(b64).replace(/\s+/g, "");
  if (typeof atob === "function") {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node 兜底
  return new Uint8Array(Buffer.from(clean, "base64"));
}

/** 按真实魔数纠正被标错的 MIME/扩展名（KEY.exe 就是 jpg 头 + PNG 内容）。 */
export function sniffImageExt(bytes) {
  if (!bytes || bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ext: "png", mime: "image/png" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return { ext: "gif", mime: "image/gif" };
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return { ext: "bmp", mime: "image/bmp" };
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { ext: "webp", mime: "image/webp" };
  return null;
}

/**
 * 从任意文本里找 data:image 内嵌图片。
 * @returns {Array<{mime,declaredMime,ext,bytes,b64Length,index}>}
 */
export function findDataUriImages(text) {
  const s = String(text == null ? "" : text);
  const out = [];
  if (!/data:image\//i.test(s)) return out;
  let m;
  DATA_URI_RE.lastIndex = 0;
  while ((m = DATA_URI_RE.exec(s))) {
    const declared = /^data:(image\/[a-z0-9.+-]+)/i.exec(m[0]);
    try {
      const bytes = b64ToBytes(m[1]);
      if (!bytes.length) continue;
      const sniff = sniffImageExt(bytes) || { ext: (declared ? declared[1].split("/")[1] : "png"), mime: declared ? declared[1] : "image/png" };
      out.push({
        declaredMime: declared ? declared[1] : "",
        mime: sniff.mime,
        ext: sniff.ext,
        bytes,
        b64Length: m[1].replace(/\s+/g, "").length,
        index: m.index,
      });
    } catch { /* 单个坏 dataURI 不影响其它 */ }
  }
  return out;
}

/** 数值文本 → 是否值得尝试「数值数据渲染成图」。保守判定，避免把所有数字题都拉进来。 */
export function looksNumericImage(text) {
  const s = String(text == null ? "" : text).trim();
  if (s.length < 48) return false;
  if (/[a-df-zA-DF-Z]/.test(s.replace(/e[+-]?\d+/gi, ""))) return false; // 允许科学计数法 e
  const rows = s.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  if (!rows.length) return false;
  let total = 0;
  let width = 0;
  for (const row of rows) {
    const parts = row.split(/[\s,;]+/).filter(Boolean);
    if (!parts.length) continue;
    for (const p of parts) {
      const n = Number(p);
      if (!Number.isFinite(n)) return false;
      if (n < 0 || n > 255) return false;
    }
    total += parts.length;
    width = Math.max(width, parts.length);
  }
  if (total < 64) return false;
  // 形态：每行 3/4 列（RGB/RGBA），或等宽网格（>=8 列），或单列长序列
  const uniform = rows.every((r) => r.split(/[\s,;]+/).filter(Boolean).length === width);
  return (width === 3 || width === 4 || width === 1 || (uniform && width >= 8));
}

/** 文本是否带大量行尾空白（SNOW 候选）。 */
export function looksSnowText(text) {
  const s = String(text == null ? "" : text);
  if (s.length < 8) return false;
  const lines = s.split(/\r?\n/);
  let trailing = 0;
  for (const line of lines) if (/[ \t]+$/.test(line)) trailing++;
  return trailing >= Math.max(2, Math.floor(lines.length * 0.15));
}
