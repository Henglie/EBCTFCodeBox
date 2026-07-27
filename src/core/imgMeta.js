/*
 * imgMeta.js — 图像 EXIF / XMP 元数据提取（被 fileAnalysis.js import）。
 *
 * 提取 JPEG APP1 里的 EXIF(TIFF IFD) 与 XMP(RDF)。
 * CTF 常把 flag/线索塞进 Artist/UserComment/XPComment/Software/dc:creator。
 *
 * 零外发；纯字节解析，手写关键 TIFF tag（不引外部库）。
 * 导出：extractExif(bytes) → {tags:[{name,value}]} | null ; extractXmp(bytes) → 字符串 | null
 */

function _u16(b, o, le) { return le ? (b[o] | (b[o + 1] << 8)) : ((b[o] << 8) | b[o + 1]); }
function _u32(b, o, le) {
  return le
    ? ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x1000000)) >>> 0)
    : (((b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])) >>> 0);
}

// 关注的 TIFF/EXIF tag（藏 flag 高频项）
const _TAGS = {
  0x010E: "ImageDescription",
  0x010F: "Make",
  0x0110: "Model",
  0x0131: "Software",
  0x013B: "Artist",
  0x8298: "Copyright",
  0x9286: "UserComment",
  0x9C9B: "XPTitle",
  0x9C9C: "XPComment",
  0x9C9D: "XPAuthor",
  0x9C9E: "XPKeywords",
  0x9C9F: "XPSubject",
};
// XP* 系列是 UCS-2LE 编码的字节数组
const _XP_TAGS = new Set([0x9C9B, 0x9C9C, 0x9C9D, 0x9C9E, 0x9C9F]);

function _readAscii(b, o, count) {
  let s = "";
  for (let i = 0; i < count; i++) { const c = b[o + i]; if (c === 0) break; s += String.fromCharCode(c); }
  return s;
}
function _readUcs2le(b, o, count) {
  let s = "";
  for (let i = 0; i + 1 < count; i += 2) {
    const cp = b[o + i] | (b[o + i + 1] << 8);
    if (cp === 0) break;
    s += String.fromCharCode(cp);
  }
  return s;
}

// 解析一个 TIFF IFD，收集关注 tag
function _parseIfd(b, tiffStart, ifdOff, le, out, depth) {
  if (depth > 3 || ifdOff <= 0 || tiffStart + ifdOff + 2 > b.length) return;
  const base = tiffStart + ifdOff;
  const n = _u16(b, base, le);
  for (let i = 0; i < n; i++) {
    const eo = base + 2 + i * 12;
    if (eo + 12 > b.length) break;
    const tag = _u16(b, eo, le);
    const type = _u16(b, eo + 2, le);
    const count = _u32(b, eo + 4, le);
    const typeSize = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 }[type] || 1;
    const byteLen = count * typeSize;
    const valOff = byteLen <= 4 ? (eo + 8) : (tiffStart + _u32(b, eo + 8, le));
    if (tag === 0x8769) { // ExifOffset → 子 IFD
      _parseIfd(b, tiffStart, _u32(b, eo + 8, le), le, out, depth + 1);
      continue;
    }
    const name = _TAGS[tag];
    if (!name) continue;
    if (valOff < 0 || valOff + byteLen > b.length) continue;
    let value = "";
    if (_XP_TAGS.has(tag)) value = _readUcs2le(b, valOff, byteLen);
    else if (type === 2) value = _readAscii(b, valOff, count);
    else if (type === 7) { // UserComment：前 8 字节编码标识
      const enc = _readAscii(b, valOff, 8);
      const txtOff = valOff + 8, txtLen = byteLen - 8;
      if (/UNICODE/i.test(enc)) value = _readUcs2le(b, txtOff, txtLen);
      else value = _readAscii(b, txtOff, txtLen);
    } else value = "(非文本 tag)";
    value = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "").trim();
    if (value) out.push({ name, value });
  }
}

/** JPEG EXIF 提取。找 APP1(FFE1) 段里 "Exif\0\0" + TIFF 头。非 JPEG 或无 EXIF 返回 null。 */
function extractExif(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
  let i = 2;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xFF) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xD9 || marker === 0xDA) break; // EOI/SOS
    const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
    if (segLen < 2) break;
    const segStart = i + 4;
    if (marker === 0xE1) {
 // 检查 "Exif\0\0"
      if (segStart + 6 <= bytes.length &&
          bytes[segStart] === 0x45 && bytes[segStart + 1] === 0x78 &&
          bytes[segStart + 2] === 0x69 && bytes[segStart + 3] === 0x66) {
        const tiffStart = segStart + 6;
        if (tiffStart + 8 <= bytes.length) {
          const le = bytes[tiffStart] === 0x49; // "II" 小端 / "MM" 大端
          const ifd0 = _u32(bytes, tiffStart + 4, le);
          const out = [];
          _parseIfd(bytes, tiffStart, ifd0, le, out, 0);
          if (out.length) return { tags: out };
        }
      }
    }
    i = segStart + segLen - 2;
  }
  return null;
}

/** XMP 提取：找 "<x:xmpmeta ... </x:xmpmeta>" 或 <?xpacket ... ?>。返回原始 XML 片段。 */
function extractXmp(bytes) {
 // 转 latin1 搜（XMP 是 ASCII/UTF-8 XML）
  let s = "";
  const n = Math.min(bytes.length, 2 * 1024 * 1024);
  for (let i = 0; i < n; i++) s += String.fromCharCode(bytes[i]);
  const start = s.indexOf("<x:xmpmeta");
  const end = s.indexOf("</x:xmpmeta>");
  if (start >= 0 && end > start) return s.slice(start, end + 12);
 // 退化：<?xpacket ... 之间
  const ps = s.indexOf("<?xpacket");
  if (ps >= 0) {
    const pe = s.indexOf("<?xpacket end", ps);
    if (pe > ps) return s.slice(ps, pe + 40);
  }
 // 找 dc:creator / rdf:RDF 片段
  const rs = s.indexOf("<rdf:RDF");
  const re = s.indexOf("</rdf:RDF>");
  if (rs >= 0 && re > rs) return s.slice(rs, re + 10);
  return null;
}

export { extractExif, extractXmp };
