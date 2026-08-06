/*
 * fileAnalysis.js — 文件拖入自动分析流水线。
 *
 * 纯前端阶段（无 exe 依赖）：FileReader/DataView/字节扫描。exe 阶段（binwalk/foremost/stegdetect）另行处理。
 * core 层零 UI 依赖（红线）。UI 层（main.js）负责 File → Uint8Array → analyzeFile(bytes, name) → 渲染报告。
 *
 * 检测项（按常见文件分析流程编排）：
 * 1. 文件头 magic 识别（PNG/JPG/GIF/ZIP/RAR/BMP/PDF/WAV/GZIP/7Z/ELF/PE）
 * 2. 扩展名一致性校验
 * 3. 文件尾附加数据检测（PNG IEND / JPG FFD9 / GIF 3B / ZIP EOCD 后是否有残留）
 * 4. PNG IHDR 宽高 CRC32 校验（不符 → 宽高可能被篡改）
 * 5. strings 可打印字符串提取（4+ 连续，UTF-8 感知：ASCII + 中文/CJK/日/韩，含中文 flag 花括号）
 * 6. 零宽字符检测（U+200B/200C/200D/FEFF/2060 的 UTF-8 字节模式）
 * 7. 图内嵌 base64 提取（40+ 连续 [A-Za-z0-9+/=]，解码成功且可打印 → 报告）
 * 8. 熵分析（复用 scorer：整体熵 + 分块熵 + 最高熵块定位）
 * 9. ZIP 伪加密检测（Local File Header vs Central Directory 的加密标志位）
 *
 * 输出 report：{ name, size, mime, ext, extConsistent, sections: [{id, title, level, body, raw?}] }
 * level: 'info' | 'warn' | 'alert'
 * body: 字符串（多行用 \n）
 *
 * LSB 图像隐写、EXIF 深度解析、PNG 宽高爆破恢复 → 拆子卡。
 */

import { entropy, isPrintableRatio } from "./magic/scorer.js";
import { decodePngPixels, decodeBmpPixels, lsbReport } from "./lsbExtract.js";
import { pngChunkCrcReport } from "./pngChunks.js";
import { extractExif, extractXmp } from "./imgMeta.js";
import { MAGIC_TABLE, identifyMagic } from "./trailerCarve.js";
import { inflateRaw, analyzePcapBytes } from "./pcapDeep.js";
// 复用（单向 import，绝不改这些模块）：
// invisibles.js — scan/strip/countByType（不可见字符结构化 API）
// stegoText.js — zwScan（零宽扫描完整报告，供 view 详情）
import { scan as invScan, strip as invStrip, countByType as invCountByType } from "./invisibles.js";
import { zwScan } from "./stegoText.js";

// ============================================================
// 工具：字节读取
// ============================================================
function u8(bytes, i) { return bytes[i] | 0; }
function u16be(bytes, i) { return ((bytes[i] << 8) | bytes[i + 1]) >>> 0; }
function u16le(bytes, i) { return (bytes[i] | (bytes[i + 1] << 8)) >>> 0; }
function u32be(bytes, i) { return ((bytes[i] * 0x1000000) + ((bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3])) >>> 0; }
function u32le(bytes, i) { return ((bytes[i]) | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] * 0x1000000)) >>> 0; }

function bytesEqual(a, start, b) {
  if (start + b.length > a.length) return false;
  for (let i = 0; i < b.length; i++) if (a[start + i] !== b[i]) return false;
  return true;
}

function bytesToLatin1(bytes, start, end) {
  let s = "";
  for (let i = start; i < end; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

// ============================================================
// CRC32（PKZIP 多项式 0xEDB88320，用于 PNG IHDR 校验）
// ============================================================
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes, start = 0, end = bytes.length) {
  let c = 0xFFFFFFFF;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ============================================================
// magic 签名表（按各文件格式的标准魔数）
// 照标准 magic 表，每项 { sig, offset, mime, ext, desc }
// ============================================================
const MAGIC = [
  { sig: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], offset: 0, mime: "image/png", ext: "png", desc: "PNG 图像" },
  { sig: [0xFF, 0xD8, 0xFF], offset: 0, mime: "image/jpeg", ext: "jpg", desc: "JPEG 图像" },
  { sig: [0x47, 0x49, 0x46, 0x38], offset: 0, mime: "image/gif", ext: "gif", desc: "GIF 图像（GIF8x）" },
  { sig: [0x42, 0x4D], offset: 0, mime: "image/bmp", ext: "bmp", desc: "BMP 位图" },
  { sig: [0x25, 0x50, 0x44, 0x46], offset: 0, mime: "application/pdf", ext: "pdf", desc: "PDF 文档（%PDF）" },
  { sig: [0x50, 0x4B, 0x03, 0x04], offset: 0, mime: "application/zip", ext: "zip", desc: "ZIP 压缩包" },
  { sig: [0x50, 0x4B, 0x05, 0x06], offset: 0, mime: "application/zip", ext: "zip", desc: "ZIP 空归档（EOCD）" },
  { sig: [0x50, 0x4B, 0x07, 0x08], offset: 0, mime: "application/zip", ext: "zip", desc: "ZIP 分片归档" },
  { sig: [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07], offset: 0, mime: "application/x-rar", ext: "rar", desc: "RAR 压缩包（Rar!）" },
  { sig: [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C], offset: 0, mime: "application/x-7z-compressed", ext: "7z", desc: "7-Zip 压缩包" },
  { sig: [0x1F, 0x8B], offset: 0, mime: "application/gzip", ext: "gz", desc: "GZIP 压缩" },
  { sig: [0x42, 0x5A, 0x68], offset: 0, mime: "application/x-bzip2", ext: "bz2", desc: "BZIP2 压缩（BZh）" },
  { sig: [0x52, 0x49, 0x46, 0x46], offset: 0, mime: "application/octet-stream", ext: "wav", desc: "RIFF 容器（WAV/AVI/WebP）" },
  { sig: [0x49, 0x44, 0x33], offset: 0, mime: "audio/mpeg", ext: "mp3", desc: "MP3 音频（ID3）" },
  { sig: [0x66, 0x4C, 0x61, 0x43], offset: 0, mime: "audio/flac", ext: "flac", desc: "FLAC 音频（fLaC）" },
  { sig: [0x4F, 0x67, 0x67, 0x53], offset: 0, mime: "application/ogg", ext: "ogg", desc: "OGG 容器（OggS）" },
  { sig: [0x7F, 0x45, 0x4C, 0x46], offset: 0, mime: "application/x-elf", ext: "elf", desc: "ELF 可执行（Linux）" },
  { sig: [0x4D, 0x5A], offset: 0, mime: "application/x-msdownload", ext: "exe", desc: "PE 可执行（Windows，MZ）" },
  { sig: [0x43, 0x47, 0x43, 0x50], offset: 0, mime: "application/x-cgcp", ext: "cgcp", desc: "Cocos Game Cache" },
  { sig: [0x53, 0x51, 0x4C, 0x69, 0x74, 0x65], offset: 0, mime: "application/x-sqlite3", ext: "sqlite", desc: "SQLite 数据库（SQLite）" },
  { sig: [0x43, 0x44, 0x57, 0x41], offset: 0, mime: "application/x-cdwa", ext: "iso", desc: "ISO 光盘镜像" },
];

function detectMagic(bytes) {
  for (const m of MAGIC) {
    if (bytes.length < m.offset + m.sig.length) continue;
    if (bytesEqual(bytes, m.offset, m.sig)) return m;
  }
  return null;
}

// ZIP 容器细分：apk/docx/xlsx/pptx/jar/epub… 底层都是 zip，靠内部特征文件名区分。
// 扫头部 + 尾部（中央目录在尾），找特征串即判定。命中返回细化后的类型描述。
function refineZipType(bytes, detected) {
  if (!detected || detected.ext !== "zip") return detected;
 // 取头 128KB + 尾 128KB 转 latin1 搜特征（避免全量转换大文件）
  const HEAD = Math.min(bytes.length, 131072);
  const TAIL_START = Math.max(HEAD, bytes.length - 131072);
  let hay = bytesToLatin1(bytes, 0, HEAD);
  if (TAIL_START < bytes.length) hay += "" + bytesToLatin1(bytes, TAIL_START, bytes.length);
  const has = (s) => hay.indexOf(s) >= 0;

  let sub = null;
  if (has("AndroidManifest.xml") && (has("classes.dex") || has("resources.arsc"))) {
    sub = { ext: "apk", mime: "application/vnd.android.package-archive", desc: "Android 应用包 APK（ZIP 容器）" };
  } else if (has("word/document.xml")) {
    sub = { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", desc: "Word 文档 DOCX（ZIP 容器）" };
  } else if (has("xl/workbook.xml")) {
    sub = { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", desc: "Excel 表格 XLSX（ZIP 容器）" };
  } else if (has("ppt/presentation.xml")) {
    sub = { ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", desc: "PPT 演示 PPTX（ZIP 容器）" };
  } else if (has("mimetype") && has("epub")) {
    sub = { ext: "epub", mime: "application/epub+zip", desc: "EPUB 电子书（ZIP 容器）" };
  } else if (has("META-INF/MANIFEST.MF") && has(".class")) {
    sub = { ext: "jar", mime: "application/java-archive", desc: "Java 归档 JAR（ZIP 容器）" };
  } else if (has("META-INF/manifest.xml") && has("content.xml")) {
    sub = { ext: "odt", mime: "application/vnd.oasis.opendocument", desc: "OpenDocument 文档（ZIP 容器）" };
  }
  if (!sub) return detected;
 // 不改 MAGIC 表引用，返回细化副本；标记 container 便于扩展名校验放行
  return { ...detected, ext: sub.ext, mime: sub.mime, desc: sub.desc, container: "zip" };
}

// ============================================================
// 扩展名一致性
// ============================================================
function getExt(name) {
  if (!name) return "";
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

// 容器格式白名单：同一 magic 底座衍生的一族合法扩展名，命中不算「伪装」。
// ZIP 底座（PK\x03\x04）：Office OOXML、Java/Android 包、OpenDocument、电子书、压缩包等都是 zip。
const CONTAINER_EXT = {
  zip: [
    "zip", "jar", "war", "ear",            // 通用 / Java
    "apk", "aab",                          // Android
    "docx", "xlsx", "pptx", "docm", "xlsm", "pptm", // MS OOXML
    "odt", "ods", "odp", "odg",            // OpenDocument
    "epub",                                // 电子书
    "kmz", "xpi", "crx", "vsix", "nupkg", "whl", // 其它常见 zip 衍生
    "ipa", "3mf", "usdz",
  ],
 // RIFF 底座
  wav: ["wav", "avi", "webp", "ani"],
 // JPEG
  jpg: ["jpg", "jpeg", "jpe", "jfif"],
 // gzip 常带双扩展（.tar.gz）
  gz: ["gz", "tgz", "gzip"],
};

function checkExtConsistency(detected, fileExt) {
  if (!detected) return null;
  if (!fileExt) return { ok: null, msg: "文件无扩展名，无法校验一致性" };
  if (detected.ext === fileExt) return { ok: true, msg: "扩展名与 magic 一致" };
 // 容器族白名单：apk/docx/jar… 底层都是 zip，命中即视为正常，不报伪装
  const family = CONTAINER_EXT[detected.ext];
  if (family && family.includes(fileExt)) {
    const label = fileExt.toUpperCase();
    const base = detected.ext.toUpperCase();
    return { ok: true, msg: label + " 是 " + base + " 容器格式（扩展名合法）" };
  }
  return { ok: false, msg: "扩展名 " + fileExt + " 与实际类型 " + detected.ext + " 不符（疑似伪装）" };
}

// ============================================================
// 文件尾附加数据检测
// ============================================================
function checkTrailingData(bytes, detected) {
  if (!detected) return null;
  const ext = detected.ext;
  const isZip = ext === "zip" || detected.container === "zip";
  let marker = null, markerName = "";
  if (ext === "png") { marker = [0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]; markerName = "IEND"; }
  else if (ext === "jpg") { marker = [0xFF, 0xD9]; markerName = "FFD9"; }
  else if (ext === "gif") { marker = [0x3B]; markerName = "3B (GIF Trailer)"; }
  else if (isZip) { marker = [0x50, 0x4B, 0x05, 0x06]; markerName = "EOCD"; }
  if (!marker) return null;

 // 找最后一个 marker 出现位置
  let last = -1;
  for (let i = bytes.length - marker.length; i >= 0; i--) {
    if (bytesEqual(bytes, i, marker)) { last = i; break; }
  }
  if (last < 0) return { found: false, msg: "未找到结束标记 " + markerName + "（文件可能损坏或被截断）" };
  const tail = bytes.length - (last + marker.length);
  if (tail <= 0) return { found: true, msg: "结束标记 " + markerName + " 后无附加数据" };
 // 预览前 64 字节
  const previewLen = Math.min(64, tail);
  let preview = "";
  for (let i = 0; i < previewLen; i++) {
    const b = bytes[last + marker.length + i];
    preview += (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : ".";
  }
  return {
    found: true, hasTrailing: true,
    msg: "结束标记 " + markerName + " 后附加 " + tail + " 字节（疑似隐写/拼接）",
    preview: preview + (tail > previewLen ? " …" : ""),
    tail,
  };
}

// ============================================================
// PNG IHDR 宽高 CRC32 校验
// ============================================================
function checkPngIhdr(bytes, detected) {
  if (!detected || detected.ext !== "png") return null;
 // PNG 结构：8 字节签名 + IHDR chunk（length 4 + type 4 + data 13 + crc 4 = 25 字节）
  if (bytes.length < 8 + 25) return { msg: "PNG 文件过短，无法解析 IHDR" };
 // IHDR chunk 在偏移 8 起
  const chunkStart = 8;
  const chunkLen = u32be(bytes, chunkStart);
  const chunkType = bytesToLatin1(bytes, chunkStart + 4, chunkStart + 8);
  if (chunkType !== "IHDR" || chunkLen !== 13) {
    return { msg: "IHDR 块异常（type=" + chunkType + ", len=" + chunkLen + "）" };
  }
  const width = u32be(bytes, chunkStart + 8);
  const height = u32be(bytes, chunkStart + 12);
  const bitDepth = u8(bytes, chunkStart + 16);
  const colorType = u8(bytes, chunkStart + 17);
  const storedCrc = u32be(bytes, chunkStart + 8 + 13);  // CRC 在 data 后
 // PNG CRC 覆盖 type + data（4 + 13 = 17 字节）
  const calcCrc = crc32(bytes, chunkStart + 4, chunkStart + 4 + 4 + 13);
  const crcOk = storedCrc === calcCrc;
  const colorNames = { 0: "灰度", 2: "RGB", 3: "索引色", 4: "灰度+Alpha", 6: "RGBA" };
  return {
    width, height, bitDepth, colorType,
    colorName: colorNames[colorType] || "未知(" + colorType + ")",
    storedCrc: storedCrc.toString(16).padStart(8, "0"),
    calcCrc: calcCrc.toString(16).padStart(8, "0"),
    crcOk,
    msg: crcOk
      ? "宽 " + width + " × 高 " + height + "，位深 " + bitDepth + "，" + (colorNames[colorType] || "colorType=" + colorType) + "，CRC32 校验通过"
      : "宽 " + width + " × 高 " + height + "，IHDR CRC32 不符（存 " + storedCrc.toString(16).padStart(8, "0") + " / 算 " + calcCrc.toString(16).padStart(8, "0") + "）—— 宽高可能被篡改，建议爆破恢复",
  };
}

// ============================================================
// strings 提取（4+ 连续可打印字符，UTF-8 感知：ASCII + 中文/CJK/日/韩/全角）
// ============================================================
// 判定码点是否"有意义可打印文本"：ASCII 可打印 + CJK 及东亚常用文字。
// 中文隐写 docx 等场景，正文藏中文 flag/情报，需把 CJK 纳入提取。
function isMeaningfulCp(cp) {
  if (cp >= 0x20 && cp <= 0x7e) return true;          // ASCII 可打印
  if (cp >= 0x4e00 && cp <= 0x9fff) return true;      // CJK 统一表意（常用汉字）
  if (cp >= 0x3400 && cp <= 0x4dbf) return true;      // CJK 扩展 A
  if (cp >= 0x3000 && cp <= 0x303f) return true;      // CJK 符号和标点（、。「」等）
  if (cp >= 0xff00 && cp <= 0xffef) return true;      // 全角 ASCII / 半宽片假名
  if (cp >= 0x3040 && cp <= 0x30ff) return true;      // 平假名 + 片假名
  if (cp >= 0xac00 && cp <= 0xd7a3) return true;      // 谚文音节（韩文）
  if (cp >= 0x20000 && cp <= 0x2fa1f) return true;    // CJK 扩展 B–F（生僻字）
  return false;
}

// 从 bytes[i] 起解一个 UTF-8 码点，返回 {cp, len} 或 null（非法/过长/代理区）。
function decodeUtf8At(bytes, i) {
  const b0 = bytes[i];
  if (b0 < 0x80) return { cp: b0, len: 1 };
  if (b0 >= 0xc2 && b0 <= 0xdf) {                     // 2 字节
    const b1 = bytes[i + 1];
    if (b1 === undefined || (b1 & 0xc0) !== 0x80) return null;
    return { cp: ((b0 & 0x1f) << 6) | (b1 & 0x3f), len: 2 };
  }
  if (b0 >= 0xe0 && b0 <= 0xef) {                     // 3 字节（含 CJK）
    const b1 = bytes[i + 1], b2 = bytes[i + 2];
    if (b1 === undefined || b2 === undefined || (b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80) return null;
    const cp = ((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f);
    if (cp < 0x800) return null;                      // 过长编码
    if (cp >= 0xd800 && cp <= 0xdfff) return null;    // 代理区非法
    return { cp, len: 3 };
  }
  if (b0 >= 0xf0 && b0 <= 0xf4) {                     // 4 字节
    const b1 = bytes[i + 1], b2 = bytes[i + 2], b3 = bytes[i + 3];
    if (b1 === undefined || b2 === undefined || b3 === undefined ||
      (b1 & 0xc0) !== 0x80 || (b2 & 0xc0) !== 0x80 || (b3 & 0xc0) !== 0x80) return null;
    const cp = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f);
    if (cp < 0x10000 || cp > 0x10ffff) return null;
    return { cp, len: 4 };
  }
  return null;
}

// 从已解码字符串里提取有意义连续片段（GBK/Big5 等非 UTF-8 文本走这条：
// 字节层 UTF-8 手解认不出 GBK 中文，故先整体嗅探解码再按字符提取）。
// offset 无字节精度（已脱离字节流），置 -1，展示时省略。
function extractStringsFromText(text, minLen = 4, maxCount = 200) {
  const out = [];
  let cur = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (isMeaningfulCp(cp)) {
      cur += ch;
    } else {
      if (cur.length >= minLen) out.push({ offset: -1, text: cur });
      cur = "";
      if (out.length >= maxCount) return out;
    }
  }
  if (cur.length >= minLen && out.length < maxCount) out.push({ offset: -1, text: cur });
  return out;
}

// minLen/maxCount 按"码点数"计（中文 1 字 = 1 码点，视觉一致）。offset 仍为字节偏移。
function extractStrings(bytes, minLen = 4, maxCount = 200) {
  const out = [];
  let cur = "";
  let curCps = 0;
  let start = 0;
  let i = 0;
  const flush = () => {
    if (curCps >= minLen) out.push({ offset: start, text: cur });
    cur = "";
    curCps = 0;
  };
  while (i < bytes.length) {
    const d = decodeUtf8At(bytes, i);
    if (d && isMeaningfulCp(d.cp)) {
      if (curCps === 0) start = i;
      cur += String.fromCodePoint(d.cp);
      curCps++;
      i += d.len;
    } else {
      flush();
      if (out.length >= maxCount) return out;
      i += 1; // 非法/无意义字节：前进 1 字节重新对齐
    }
  }
  if (out.length < maxCount) flush();
  return out;
}

function checkStrings(bytes) {
  let strs = extractStrings(bytes, 4, 200);
 // 非 UTF-8 中文文档（GBK/Big5 等）：逐字节 UTF-8 提取会漏掉全部中文。
 // 嗅探真实编码，若非 utf-8/latin1 则按字符层补提一遍，合并去重（中文 flag/情报不漏）。
  const sniff = sniffDecodeText(bytes);
  if (sniff.enc !== "utf-8" && sniff.enc !== "latin1") {
    const seen = new Set(strs.map((s) => s.text));
    for (const s of extractStringsFromText(sniff.text, 4, 200)) {
      if (!seen.has(s.text)) { seen.add(s.text); strs.push(s); }
    }
  }
  if (strs.length === 0) return null;
 // 排版优化：多条短字符串用 " | " 拼成满行段落，按 ~100 字符软换行，别一条一行。
 // 不再列 offset（阅读优先），offset 信息保留在 raw，view 详情里给带 offset 的完整清单。
  const shown = strs.slice(0, 80);
  const tokens = shown.map((s) => (s.text.length > 120 ? s.text.slice(0, 120) + "…" : s.text));
  const WRAP = 100;
  const para = [];
  let line = "";
  for (const t of tokens) {
    if (line && (line.length + 3 + t.length) > WRAP) { para.push(line); line = t; }
    else line = line ? line + " | " + t : t;
  }
  if (line) para.push(line);
 // view 详情：带 offset 的完整清单（供双击查看）
  const detailLines = strs.map((s) => (s.offset >= 0 ? "0x" + s.offset.toString(16).padStart(6, "0") : "  (文本层)") + "  " + s.text);
  return {
    count: strs.length,
    msg: "提取到 " + strs.length + " 条可打印字符串" + (strs.length > shown.length ? "（段落展示前 " + shown.length + " 条）" : ""),
    body: para.join("\n"),
    detail: detailLines.join("\n"),
    raw: strs,
  };
}

// ============================================================
// 零宽字符检测（按 UTF-8 字节模式扫）
// U+200B = E2 80 8B, U+200C = E2 80 8C, U+200D = E2 80 8D
// U+FEFF = EF BB BF, U+2060 = E2 81 A0
// U+202A-202E (双向控制): E2 80 AA-AE
// U+2061-2064 (不可见运算符): E2 81 A1-A4
// ============================================================
const ZERO_WIDTH_PATTERNS = [
  { bytes: [0xE2, 0x80, 0x8B], cp: "U+200B", name: "零宽空格 ZWSP" },
  { bytes: [0xE2, 0x80, 0x8C], cp: "U+200C", name: "零宽非连接符 ZWNJ" },
  { bytes: [0xE2, 0x80, 0x8D], cp: "U+200D", name: "零宽连接符 ZWJ" },
  { bytes: [0xEF, 0xBB, 0xBF], cp: "U+FEFF", name: "BOM/零宽不换行空格" },
  { bytes: [0xE2, 0x81, 0xA0], cp: "U+2060", name: "字连接符" },
  { bytes: [0xE2, 0x80, 0xAA], cp: "U+202A", name: "LRE 左到右嵌入" },
  { bytes: [0xE2, 0x80, 0xAB], cp: "U+202B", name: "RLE 右到左嵌入" },
  { bytes: [0xE2, 0x80, 0xAC], cp: "U+202C", name: "PDF 弹出方向格式" },
  { bytes: [0xE2, 0x80, 0xAD], cp: "U+202D", name: "LRO 左到右覆盖" },
  { bytes: [0xE2, 0x80, 0xAE], cp: "U+202E", name: "RLO 右到左覆盖" },
];

function checkZeroWidth(bytes) {
  const hits = {};
  const positions = {};
  for (const p of ZERO_WIDTH_PATTERNS) {
    hits[p.cp] = 0;
    positions[p.cp] = [];
  }
  for (let i = 0; i <= bytes.length - 3; i++) {
    for (const p of ZERO_WIDTH_PATTERNS) {
      if (bytes[i] === p.bytes[0] && bytes[i + 1] === p.bytes[1] && bytes[i + 2] === p.bytes[2]) {
        hits[p.cp]++;
        if (positions[p.cp].length < 5) positions[p.cp].push(i);
      }
    }
  }
  const found = ZERO_WIDTH_PATTERNS.filter((p) => hits[p.cp] > 0);
  if (found.length === 0) return null;
  const total = found.reduce((s, p) => s + hits[p.cp], 0);
  const lines = found.map((p) =>
    p.name + " (" + p.cp + ") × " + hits[p.cp] + "，位置 " + positions[p.cp].map((x) => "0x" + x.toString(16)).join(" ")
  );
  return {
    total,
    msg: "发现 " + total + " 个零宽/不可见字符，疑似隐写",
    body: lines.join("\n"),
    raw: { hits, positions },
  };
}

// ============================================================
// base64 嵌入提取
// 扫描连续 [A-Za-z0-9+/=]（长度 >= 40），尝试解码，解码结果可打印率 >= 0.7 → 报告
// ============================================================
function tryB64Decode(s) {
  try {
    const bin = atob(s);
    return bin;
  } catch { return null; }
}

function extractEmbeddedB64(bytes) {
 // 只扫可打印区，找连续 base64 字符
  const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  const isB64 = (b) => B64_CHARS.charCodeAt(0) <= 0 && false || (b >= 0x2B && b <= 0x7A && B64_CHARS.indexOf(String.fromCharCode(b)) >= 0);
  const results = [];
  let i = 0;
  while (i < bytes.length) {
    if (isB64(bytes[i])) {
      let j = i;
      while (j < bytes.length && isB64(bytes[j])) j++;
      const len = j - i;
      if (len >= 40 && len % 4 === 0) {
        const s = bytesToLatin1(bytes, i, j);
        const dec = tryB64Decode(s);
        if (dec && dec.length >= 4) {
 // 可打印率
          let printable = 0;
          for (let k = 0; k < dec.length; k++) {
            const c = dec.charCodeAt(k);
            if ((c >= 0x20 && c < 0x7F) || c === 0x0A || c === 0x0D || c === 0x09) printable++;
          }
          const ratio = printable / dec.length;
          if (ratio >= 0.7) {
            const preview = dec.length > 80 ? dec.slice(0, 80) + " …" : dec;
            results.push({ offset: i, len, decoded: dec, preview, ratio });
          }
        }
      }
      i = j;
    } else i++;
    if (results.length >= 20) break;
  }
  return results;
}

function checkEmbeddedB64(bytes) {
  const hits = extractEmbeddedB64(bytes);
  if (hits.length === 0) return null;
  const lines = hits.slice(0, 10).map((h) =>
    "0x" + h.offset.toString(16).padStart(4, "0") + "  (len=" + h.len + ", 可打印 " + (h.ratio * 100).toFixed(0) + "%)  " + h.preview
  );
  return {
    count: hits.length,
    msg: "发现 " + hits.length + " 处疑似 base64 嵌入（解码后可打印率 >= 70%）",
    body: lines.join("\n"),
    raw: hits,
  };
}

// ============================================================
// 熵分析（复用 scorer）
// ============================================================
function analyzeEntropy(bytes) {
  if (bytes.length === 0) return null;
  const overall = entropy(bytes);
 // 分块熵（每 4KB），找最高熵块
  const BLOCK = 4096;
  const blocks = [];
  for (let i = 0; i < bytes.length; i += BLOCK) {
    const end = Math.min(i + BLOCK, bytes.length);
    const slice = bytes.subarray ? bytes.subarray(i, end) : bytes.slice(i, end);
    blocks.push({ offset: i, h: entropy(slice) });
  }
  blocks.sort((a, b) => b.h - a.h);
  const top = blocks[0];
 // 整体可打印率
  const printableRatio = isPrintableRatio(bytesToLatin1(bytes, 0, bytes.length));
 // 熵判读
  let verdict = "";
  if (overall > 7.5) verdict = "整体熵 " + overall.toFixed(3) + " bits/byte（接近随机，疑似加密/压缩/已编码）";
  else if (overall > 6.0) verdict = "整体熵 " + overall.toFixed(3) + " bits/byte（较高，部分区域可能加密/压缩）";
  else if (overall < 2.0) verdict = "整体熵 " + overall.toFixed(3) + " bits/byte（很低，大量重复字节）";
  else verdict = "整体熵 " + overall.toFixed(3) + " bits/byte（正常文本/二进制范围）";
  return {
    overall, printableRatio, topBlock: top,
    msg: verdict + "；可打印率 " + (printableRatio * 100).toFixed(1) + "%；最高熵块 @ 0x" + top.offset.toString(16) + "（" + top.h.toFixed(3) + "）",
  };
}

// ============================================================
// ZIP 伪加密检测
// Local File Header (offset 0, sig 504B0304) 偏移 6 处 2 字节 General Purpose Flag
// Central Directory (sig 504B0102) 偏移 8 处 2 字节 General Purpose Flag
// 伪加密：CD 标志位第 0 位（加密）= 1，但 LFH 对应项 = 0
// ============================================================
function checkZipPseudoEnc(bytes, detected) {
  if (!detected || (detected.ext !== "zip" && detected.container !== "zip")) return null;
 // 找所有 Local File Header
  const LFH_SIG = [0x50, 0x4B, 0x03, 0x04];
  const CDH_SIG = [0x50, 0x4B, 0x01, 0x02];
  const lfhFlags = [];
  const cdhFlags = [];
  for (let i = 0; i <= bytes.length - 4; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4B && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
      if (i + 6 + 2 <= bytes.length) lfhFlags.push({ offset: i, flag: u16le(bytes, i + 6) });
    } else if (bytes[i] === 0x50 && bytes[i + 1] === 0x4B && bytes[i + 2] === 0x01 && bytes[i + 3] === 0x02) {
      if (i + 8 + 2 <= bytes.length) cdhFlags.push({ offset: i, flag: u16le(bytes, i + 8) });
    }
  }
  if (lfhFlags.length === 0 && cdhFlags.length === 0) {
    return { msg: "ZIP 结构异常：未找到 Local File Header / Central Directory" };
  }
  const lfhEncCount = lfhFlags.filter((f) => (f.flag & 1) === 1).length;
  const cdhEncCount = cdhFlags.filter((f) => (f.flag & 1) === 1).length;
  if (cdhEncCount > 0 && lfhEncCount === 0) {
    return {
      isPseudo: true,
      msg: "疑似伪加密：Central Directory 标记加密 " + cdhEncCount + " 项，但 Local File Header 全部未加密（解 CD 加密位即可正常解压）",
      lfhCount: lfhFlags.length, cdhCount: cdhFlags.length,
      lfhEncCount, cdhEncCount,
    };
  }
  if (lfhEncCount > 0) {
    return {
      isPseudo: false, isRealEnc: true,
      msg: "真加密：Local File Header 标记加密 " + lfhEncCount + " 项（需密码）",
      lfhCount: lfhFlags.length, cdhCount: cdhFlags.length,
      lfhEncCount, cdhEncCount,
    };
  }
  return {
    isPseudo: false,
    msg: "ZIP 未加密（LFH " + lfhFlags.length + " 项 / CD " + cdhFlags.length + " 项，加密位全 0）",
    lfhCount: lfhFlags.length, cdhCount: cdhFlags.length,
  };
}

// ============================================================
// flag/key 专搜 + {} 提取（对齐同类实现「包含key字符串 / 包含{}符号」）
// ============================================================
function checkFlagKeywords(bytes) {
 // 全文件转 latin1（大文件截断到 4MB 防卡）
  const N = Math.min(bytes.length, 4 * 1024 * 1024);
  let s = "";
  for (let i = 0; i < N; i++) s += String.fromCharCode(bytes[i]);
  const hits = [];
 // flag{...}/ctf{...} 类花括号 flag
  const flagRe = /(flag|ctf|key|pass|token|secret)\{[^{}\n]{0,120}\}/gi;
  let m, flagMatches = [];
  while ((m = flagRe.exec(s)) && flagMatches.length < 20) flagMatches.push(m[0]);
  if (flagMatches.length) hits.push({ kind: "flag 花括号", items: flagMatches });
 // 关键词邻近上下文（flag/key/pass/password，含冒号/等号赋值）
  const kwRe = /\b(flag|key|pass(word)?|secret|token)\b\s*[:=]?\s*([^\s"'<>]{2,60})/gi;
  const kwMatches = [];
  while ((m = kwRe.exec(s)) && kwMatches.length < 15) {
    const frag = m[0].trim();
    if (frag.length >= 4) kwMatches.push(frag);
  }
  if (kwMatches.length) hits.push({ kind: "关键词上下文", items: kwMatches });
 // 所有含 {} 的可打印片段（同类工具专列 {} 符号）
  const braceRe = /[\x20-\x7E]{0,10}\{[\x20-\x7E]{0,40}\}/g;
  const braceMatches = [];
  while ((m = braceRe.exec(s)) && braceMatches.length < 40) {
    const f = m[0].trim();
    if (f.includes("{") && f.includes("}")) braceMatches.push(f);
  }
  if (braceMatches.length) hits.push({ kind: "{} 符号片段", items: braceMatches.slice(0, 40) });
 // 文本层：latin1 逐字节串里中文 flag 会成乱码，另按嗅探编码（UTF-8/GBK/Big5…）解一遍抓可读中文
 //（含中文的 flag{...}/花括号片段；docx、GBK 记事本等中文隐写场景）。去重后合并。
  const utext = sniffDecodeText(bytes, 4 * 1024 * 1024).text;
  if (/[^\x00-\x7F]/.test(utext)) {                    // 仅当存在非 ASCII 才值得再扫
    const uFlagRe = /(flag|ctf|key|pass|token|secret)\{[^{}\n]{0,120}\}/gi;
    const uFlags = [];
    while ((m = uFlagRe.exec(utext)) && uFlags.length < 20) uFlags.push(m[0]);
    const merged = flagMatches.slice();
    for (const f of uFlags) if (!merged.includes(f)) merged.push(f);
    if (merged.length > flagMatches.length) {
      const sec = hits.find((h) => h.kind === "flag 花括号");
      if (sec) sec.items = merged;
      else hits.unshift({ kind: "flag 花括号", items: merged });
    }
 // 含中文（或其他非 ASCII）的花括号片段
    const uBraceRe = /[^\s{}]{0,10}\{[^{}\n]{0,60}\}/g;
    const uBraces = [];
    while ((m = uBraceRe.exec(utext)) && uBraces.length < 40) {
      const f = m[0].trim();
      if (/[^\x00-\x7F]/.test(f) && f.includes("{") && f.includes("}")) uBraces.push(f);
    }
    if (uBraces.length) hits.push({ kind: "含中文 {} 片段", items: uBraces.slice(0, 40) });
  }
  if (hits.length === 0) return null;
  return hits;
}

// ============================================================
// OOXML / ODF 正文文本提取（docx/xlsx/pptx/odt）
// 这类文件是 zip 容器，正文 XML（word/document.xml 等）经 deflate 压缩，
// 直接扫原始字节只能看到未压缩的文件名 + 压缩流乱码，中文正文完全提不出。
// 解法：遍历 ZIP Local File Header → 对文本部件 inflate → 剥 XML 标签 → 抽纯文本。
// ============================================================
// 各容器里承载正文文本的部件名（子串匹配，含分表/幻灯片多文件）。
function isTextPart(name) {
  return (
    /word\/document\.xml$/.test(name) ||           // docx 正文
    /word\/(header|footer)\d*\.xml$/.test(name) || // docx 页眉页脚
    /word\/(endnotes|footnotes|comments)\.xml$/.test(name) ||
    /xl\/sharedStrings\.xml$/.test(name) ||        // xlsx 共享字符串（单元格文本）
    /ppt\/slides\/slide\d+\.xml$/.test(name) ||    // pptx 幻灯片
    /ppt\/notesSlides\/.*\.xml$/.test(name) ||     // pptx 备注
    /content\.xml$/.test(name)                     // odt/ods/odp 正文
  );
}

// 从 XML 字符串剥标签抽纯文本（保留元素间空白为分隔，压缩连续空白）。
function xmlToText(xml) {
  // <w:p> 段落 / <a:p> / </text:p> 等段落结束补换行，避免全文黏成一行。
  let s = xml.replace(/<\/(w:p|a:p|text:p|w:tab|a:br)\b[^>]*>/g, "\n");
  s = s.replace(/<[^>]+>/g, "");            // 去所有标签
  s = s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
       .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
       .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
       .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

// 遍历 ZIP，对文本部件解压并抽文本。返回合并后的正文字符串（截断上限防卡）。
function extractOoxmlText(bytes) {
  const LFH = [0x50, 0x4B, 0x03, 0x04];
  let out = "";
  const MAX = 512 * 1024; // 抽取文本上限 512KB
  for (let i = 0; i + 30 <= bytes.length && out.length < MAX; i++) {
    if (bytes[i] !== LFH[0] || bytes[i + 1] !== LFH[1] || bytes[i + 2] !== LFH[2] || bytes[i + 3] !== LFH[3]) continue;
    const method = u16le(bytes, i + 8);
    const compSize = u32le(bytes, i + 18);
    const nameLen = u16le(bytes, i + 26);
    const extraLen = u16le(bytes, i + 28);
    const nameStart = i + 30;
    if (nameStart + nameLen > bytes.length) continue;
    let name = "";
    for (let k = 0; k < nameLen; k++) name += String.fromCharCode(bytes[nameStart + k]);
    const dataStart = nameStart + nameLen + extraLen;
    // 数据描述符（bit3）时 compSize 可能为 0，无法可靠切片 → 跳过该条（docx 由 Office 生成，通常带准确 size）。
    if (!compSize || dataStart + compSize > bytes.length) continue;
    if (!isTextPart(name)) continue;
    const comp = bytes.subarray(dataStart, dataStart + compSize);
    let xmlBytes;
    try {
      if (method === 0) xmlBytes = comp;                 // stored 未压缩
      else if (method === 8) xmlBytes = inflateRaw(comp); // deflate
      else continue;                                      // 其它压缩法（bzip2/lzma）不支持
    } catch { continue; } // 解压失败跳过该部件，不阻断
    const xml = new TextDecoder("utf-8", { fatal: false }).decode(xmlBytes); // OOXML 恒为 UTF-8
    const txt = xmlToText(xml);
    if (txt) out += (out ? "\n" : "") + txt;
  }
  return out.slice(0, MAX);
}

// docx/xlsx/pptx/odt 正文提取卡：解出可读正文 + 抓中文 flag/花括号。
function checkOoxmlText(bytes, detected) {
  if (!detected) return null;
  const ext = detected.ext;
  if (!["docx", "xlsx", "pptx", "odt", "ods", "odp"].includes(ext)) return null;
  const text = extractOoxmlText(bytes);
  if (!text || text.length < 2) return null;
  const flags = [];
  const flagRe = /(flag|ctf|key|pass|token|secret)\{[^{}\n]{0,120}\}/gi;
  let m;
  while ((m = flagRe.exec(text)) && flags.length < 20) flags.push(m[0]);
  // 预览：正文前 600 字（完整正文走 view/下载 action）。
  const preview = text.length > 600 ? text.slice(0, 600) + " …（完整正文见下方查看/导出）" : text;
  let msg = "解压正文共 " + text.length + " 字";
  if (flags.length) msg += "；命中 flag 花括号 " + flags.length + " 处：" + flags.join("  ");
  return { text, flags, preview, msg };
}

// ============================================================
// Binwalk 式全文 magic 扫描（复用 trailerCarve 的 MAGIC_TABLE）
// ============================================================
function checkBinwalk(bytes) {
  const hits = [];
  for (let i = 0; i < bytes.length; i++) {
    let matched = null;
    for (const mm of MAGIC_TABLE) {
      let ok = true;
      if (i + mm.magic.length > bytes.length) continue;
      for (let k = 0; k < mm.magic.length; k++) if (bytes[i + k] !== mm.magic[k]) { ok = false; break; }
      if (ok && (!matched || mm.magic.length > matched.magic.length)) matched = mm;
    }
    if (matched) {
      hits.push({ offset: i, name: matched.name, desc: matched.desc });
      i += matched.magic.length - 1;
    }
    if (hits.length >= 200) break;
  }
  if (hits.length === 0) return null;
  const embedded = hits.filter((h) => h.offset > 0);
  return { hits, embedded };
}

// ============================================================
// 文件尾附加数据递归智能解码（限 4 层防无限递归）
// 雪中刀盾: 空格分隔二进制串→ASCII→flag
// 湖心亭: 原始字节含 flag.txt(ZIP 局部头 504b0304)内嵌文件名
// ============================================================
function _bytesToPrintable(bytes, max) {
  let s = "";
  for (let i = 0; i < Math.min(bytes.length, max); i++) {
    const c = bytes[i];
    s += (c >= 0x20 && c < 0x7F) ? String.fromCharCode(c) : ".";
  }
  return s;
}
function _findFlag(str) {
  const m = /(flag|ctf|key)\{[^{}\n]{0,120}\}/i.exec(str);
  return m ? m[0] : null;
}
// 尝试识别并解一层，返回 {label, bytes} 或 null
function _decodeOneLayer(bytes) {
 // 转字符串看形态
  let s = "";
  for (let i = 0; i < Math.min(bytes.length, 65536); i++) s += String.fromCharCode(bytes[i]);
  const trimmed = s.trim();
 // 1. 空格分隔的 8 位二进制串（取开头连续的 8 位 token，忽略尾随垃圾字节）
  {
    const tokens = trimmed.split(/\s+/);
    const bits = [];
    for (const t of tokens) {
      if (/^[01]{8}$/.test(t)) bits.push(t);
      else break; // 遇非二进制 token 停止
    }
    if (bits.length >= 2) {
      const out = new Uint8Array(bits.length);
      for (let i = 0; i < bits.length; i++) out[i] = parseInt(bits[i], 2) & 0xFF;
      return { label: "空格分隔二进制串 → 字节（取前 " + bits.length + " 组）", bytes: out };
    }
  }
 // 2. 连续二进制串（长度 8 倍数）
  if (/^[01]+$/.test(trimmed) && trimmed.length >= 16 && trimmed.length % 8 === 0) {
    const n = trimmed.length / 8;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = parseInt(trimmed.substr(i * 8, 8), 2) & 0xFF;
    return { label: "连续二进制串 → 字节", bytes: out };
  }
 // 3. 纯 hex（可含空格）
  const hexClean = trimmed.replace(/\s+/g, "");
  if (/^[0-9a-fA-F]+$/.test(hexClean) && hexClean.length >= 8 && hexClean.length % 2 === 0) {
    const n = hexClean.length / 2;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = parseInt(hexClean.substr(i * 2, 2), 16);
    return { label: "hex → 字节", bytes: out };
  }
 // 4. base64
  if (/^[A-Za-z0-9+/]{16,}={0,2}$/.test(trimmed) && trimmed.length % 4 === 0) {
    try {
      const bin = atob(trimmed);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return { label: "base64 → 字节", bytes: out };
    } catch (e) {}
  }
  return null;
}
function analyzeTrailingDecode(bytes, detected) {
  const trailing = checkTrailingData(bytes, detected);
  if (!trailing || !trailing.hasTrailing) return null;
 // 重新定位尾部起点，取原始尾部字节
  const ext = detected.ext;
  const isZip = ext === "zip" || detected.container === "zip";
  let marker = null;
  if (ext === "png") marker = [0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82];
  else if (ext === "jpg") marker = [0xFF, 0xD9];
  else if (ext === "gif") marker = [0x3B];
  else if (isZip) marker = [0x50, 0x4B, 0x05, 0x06];
  if (!marker) return null;
  let last = -1;
  for (let i = bytes.length - marker.length; i >= 0; i--) {
    if (bytesEqual(bytes, i, marker)) { last = i; break; }
  }
  if (last < 0) return null;
  let cur = bytes.subarray(last + marker.length);
  const chain = [];
  let foundFlag = null;
 // 内嵌文件名/ZIP 头识别
  const embedHints = [];
  const idM = identifyMagic(cur, 0);
  if (idM) embedHints.push(`尾部起始识别为 ${idM.name}（${idM.desc}）`);
 // 搜内嵌文件名（如 flag.txt）
  {
    let cs = "";
    for (let i = 0; i < Math.min(cur.length, 4096); i++) cs += String.fromCharCode(cur[i]);
    const fnRe = /[\w\-]{1,40}\.(txt|zip|png|jpg|flag|py|php|jpg|rar|7z|pdf|docx)/gi;
    const fns = [];
    let mm;
    while ((mm = fnRe.exec(cs)) && fns.length < 6) fns.push(mm[0]);
    if (fns.length) embedHints.push("内嵌文件名: " + fns.join(", "));
    const zipHead = /PK\x03\x04/.exec(cs);
    if (zipHead) embedHints.push("含 ZIP 局部头 504b0304（内嵌压缩文件）");
  }
 // 递归解码
  for (let layer = 0; layer < 4; layer++) {
    const preview = _bytesToPrintable(cur, 80);
    const asStr = (() => { let x = ""; for (let i = 0; i < Math.min(cur.length, 65536); i++) x += String.fromCharCode(cur[i]); return x; })();
    foundFlag = _findFlag(asStr);
    chain.push({ layer, len: cur.length, preview: preview + (cur.length > 80 ? " …" : ""), flag: foundFlag });
    if (foundFlag) break;
    const dec = _decodeOneLayer(cur);
    if (!dec) break;
    chain.push({ layer: layer + 0.5, label: dec.label, len: dec.bytes.length, preview: _bytesToPrintable(dec.bytes, 80) });
 // 解码后检查 flag
    let ds = ""; for (let i = 0; i < Math.min(dec.bytes.length, 65536); i++) ds += String.fromCharCode(dec.bytes[i]);
    foundFlag = _findFlag(ds);
    cur = dec.bytes;
    if (foundFlag) { chain[chain.length - 1].flag = foundFlag; break; }
  }
  return { tail: trailing.tail, embedHints, chain, foundFlag };
}

// ============================================================
// 图片 LSB 各通道提取（对齐同类实现「图片LSB row信息」）
// 浏览器/node 均走自包含 PNG/BMP 解码（不依赖 canvas）
// ============================================================
function analyzeLsb(bytes, detected) {
  if (!detected) return null;
  let decoded = null;
  if (detected.ext === "png") decoded = decodePngPixels(bytes);
  else if (detected.ext === "bmp") decoded = decodeBmpPixels(bytes);
  if (!decoded) return null;
  const rep = lsbReport(decoded, 50);
  if (!rep) return null;
  if (rep.unsupported) return { unsupported: rep.unsupported };
  return rep;
}

// ============================================================
// 辅助：基名 / 尾部魔数→扩展名 / 零宽二进制隐写解码
// ============================================================
// 去扩展名取基名（用于 download 文件命名）
function baseName(name) {
  if (!name) return "file";
  const i = name.lastIndexOf(".");
  return i <= 0 ? name : name.slice(0, i);
}

// 文本 → UTF-8 字节（download 的 bytes 用，供文本类导出）
function strToBytes(s) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

// identifyMagic 的 name → { ext, mime }（尾部二进制存对应扩展名用）
const MAGIC_EXT_MAP = {
  "PNG": { ext: "png", mime: "image/png" },
  "JPEG": { ext: "jpg", mime: "image/jpeg" },
  "GIF87": { ext: "gif", mime: "image/gif" },
  "GIF89": { ext: "gif", mime: "image/gif" },
  "ZIP": { ext: "zip", mime: "application/zip" },
  "ZIP-EOCD": { ext: "zip", mime: "application/zip" },
  "RAR4": { ext: "rar", mime: "application/x-rar" },
  "RAR5": { ext: "rar", mime: "application/x-rar" },
  "7Z": { ext: "7z", mime: "application/x-7z-compressed" },
  "GZIP": { ext: "gz", mime: "application/gzip" },
  "BZIP2": { ext: "bz2", mime: "application/x-bzip2" },
  "XZ": { ext: "xz", mime: "application/x-xz" },
  "PDF": { ext: "pdf", mime: "application/pdf" },
  "BMP": { ext: "bmp", mime: "image/bmp" },
  "RIFF": { ext: "wav", mime: "audio/wav" },
  "TIFF-LE": { ext: "tiff", mime: "image/tiff" },
  "TIFF-BE": { ext: "tiff", mime: "image/tiff" },
  "ELF": { ext: "elf", mime: "application/x-elf" },
  "PE": { ext: "exe", mime: "application/x-msdownload" },
  "OGG": { ext: "ogg", mime: "application/ogg" },
  "FLAC": { ext: "flac", mime: "audio/flac" },
  "ID3": { ext: "mp3", mime: "audio/mpeg" },
  "CLASS": { ext: "class", mime: "application/java-vm" },
  "PCAP": { ext: "pcap", mime: "application/vnd.tcpdump.pcap" },
  "PCAPNG": { ext: "pcapng", mime: "application/x-pcapng" },
};

// 字节 → UTF-8 文本（大文件截断，供零宽 / 文本类扫描）
// 统计一段文本里的替换字符 U+FFFD（解码失败标记）数量。
function countReplacement(text) {
  let c = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0xfffd) c++;
  return c;
}

// 原始字节里控制字符（< 0x20 且非 \t\n\r，及 0x7F）占比。二进制流（压缩/加密）此值高，
// 纯文本（含 GBK/UTF-8 中文）此值近 0。用于把 CJK 嗅探挡在二进制数据之外。
function controlByteRatio(sub) {
  const n = sub.length;
  if (n === 0) return 1;
  let ctl = 0;
  for (let i = 0; i < n; i++) {
    const b = sub[i];
    if (b === 0x09 || b === 0x0a || b === 0x0d) continue; // tab/LF/CR 是合法文本
    if (b < 0x20 || b === 0x7f) ctl++;
  }
  return ctl / n;
}

// 编码嗅探：Windows 中文文档常是 GBK/GB18030，直接按 UTF-8 解会满屏问号（U+FFFD）。
// 策略：① UTF-8 fatal 能整段解出 → 就是 UTF-8（最常见、最可信）；
//       ② 二进制流（控制字节多）直接 latin1——gb18030 码空间近乎全覆盖，会把随机字节
//          误映射成生僻汉字（U+FFFD 极少），必须先用控制字节比率挡住，否则满屏假中文；
//       ③ 像文本的非 UTF-8：试东亚编码，取 U+FFFD 最少者；
//       ④ 全都大量乱码 → 回退 latin1。
// 返回 { text, enc }。enc 供 strings 提取复用（避免重复嗅探）。
function sniffDecodeText(bytes, max = 4 * 1024 * 1024) {
  const n = Math.min(bytes.length, max);
  const sub = bytes.subarray ? bytes.subarray(0, n) : new Uint8Array(bytes.slice(0, n));
  const latin1 = () => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(sub[i]); return { text: s, enc: "latin1" }; };
  // ① UTF-8 严格解码成功 = 合法 UTF-8（含纯 ASCII）
  try {
    const t = new TextDecoder("utf-8", { fatal: true }).decode(sub);
    return { text: t, enc: "utf-8" };
  } catch { /* 非合法 UTF-8，进入嗅探 */ }
  // ② 二进制流闸门：控制字节多 = 压缩/加密/媒体，绝不当 CJK 文本解（防 gb18030 假中文）
  if (controlByteRatio(sub) > 0.10) return latin1();
  // ③ 像文本的非 UTF-8：试东亚编码，比 U+FFFD 数量（越少越可能是真编码）
  const candidates = ["gb18030", "big5", "shift_jis", "euc-kr"];
  let best = null;
  for (const enc of candidates) {
    let t;
    try { t = new TextDecoder(enc, { fatal: false }).decode(sub); }
    catch { continue; } // 环境不支持该标签则跳过
    const bad = countReplacement(t);
    if (!best || bad < best.bad) best = { text: t, enc, bad };
    if (bad === 0) break; // 完美解码，无需再比
  }
  if (best && best.bad < n * 0.05) return { text: best.text, enc: best.enc };
  // ④ 大量乱码：回退 latin1（逐字节，保留可打印 ASCII 片段）
  return latin1();
}

function bytesToUtf8Text(bytes, max = 1024 * 1024) {
  const n = Math.min(bytes.length, max);
  const sub = bytes.subarray ? bytes.subarray(0, n) : new Uint8Array(bytes.slice(0, n));
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(sub);
  } catch {
 // 退化：latin1
    let s = "";
    for (let i = 0; i < n; i++) s += String.fromCharCode(sub[i]);
    return s;
  }
}

// 零宽二进制隐写解码：两种零宽码位映射 0/1，按 8 bit 组字节
// 常见方案：U+200B=0 / U+200C=1（或任意两种零宽字符）
const ZW_CARRIER = new Set([0x200b, 0x200c, 0x200d, 0xfeff, 0x2060, 0x200e, 0x200f]);
function zwBinaryDecode(text) {
  const seq = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (ZW_CARRIER.has(cp)) seq.push(cp);
  }
  if (seq.length < 8) return null;
  const distinct = [...new Set(seq)].sort((a, b) => a - b);
  if (distinct.length < 2) return null;
  const tryMap = (zero, one) => {
    const bits = seq.filter((cp) => cp === zero || cp === one).map((cp) => (cp === one ? 1 : 0));
    const nbytes = Math.floor(bits.length / 8);
    if (nbytes < 1) return null;
    const out = new Uint8Array(nbytes);
    for (let i = 0; i < nbytes; i++) {
      let v = 0;
      for (let k = 0; k < 8; k++) v = (v << 1) | bits[i * 8 + k];
      out[i] = v & 0xff;
    }
    return out;
  };
 // 尝试两种低位/高位映射，取可打印率最高者
  const candidates = [
    { map: distinct[0] + "→0", bytes: tryMap(distinct[0], distinct[1]) },
    { map: distinct[1] + "→0", bytes: tryMap(distinct[1], distinct[0]) },
  ];
  let best = null, bestScore = -1;
  for (const c of candidates) {
    if (!c.bytes) continue;
    let p = 0;
    for (const b of c.bytes) if ((b >= 0x20 && b < 0x7f) || b === 0x0a || b === 0x09 || b === 0x0d) p++;
    const score = c.bytes.length ? p / c.bytes.length : 0;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (!best || bestScore < 0.7) return null;
  let s = "";
  for (const b of best.bytes) s += String.fromCharCode(b);
  return { text: s, ratio: bestScore, bytes: best.bytes, carrierCount: seq.length };
}

// 定位并取出「结束标记之后」的原始尾部字节（附加数据），无则 null
function getTrailingBytes(bytes, detected) {
  if (!detected) return null;
  const ext = detected.ext;
  const isZip = ext === "zip" || detected.container === "zip";
  let marker = null;
  if (ext === "png") marker = [0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82];
  else if (ext === "jpg") marker = [0xFF, 0xD9];
  else if (ext === "gif") marker = [0x3B];
  else if (isZip) marker = [0x50, 0x4B, 0x05, 0x06];
  if (!marker) return null;
  let last = -1;
  for (let i = bytes.length - marker.length; i >= 0; i--) {
    if (bytesEqual(bytes, i, marker)) { last = i; break; }
  }
  if (last < 0) return null;
  const start = last + marker.length;
  if (start >= bytes.length) return null;
  return bytes.subarray ? bytes.subarray(start) : new Uint8Array(bytes.slice(start));
}

// 尾部字节 → 存盘扩展名 / MIME（识别到二进制格式存对应类型，否则 bin）
function trailerFileType(tailBytes) {
  const idM = identifyMagic(tailBytes, 0);
  if (idM && MAGIC_EXT_MAP[idM.name]) return { ...MAGIC_EXT_MAP[idM.name], name: idM.name, desc: idM.desc };
  return { ext: "bin", mime: "application/octet-stream", name: null, desc: null };
}

// 清除 ZIP 伪加密：把每个 Central Directory 头 (504B0102) 的通用标志位
// (CD header offset+8 处 2 字节 LE) 的 bit0（加密位）清零，返回修正后完整字节副本
function clearZipPseudoEnc(bytes) {
  const out = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
  let cleared = 0;
  for (let i = 0; i <= out.length - 4; i++) {
    if (out[i] === 0x50 && out[i + 1] === 0x4B && out[i + 2] === 0x01 && out[i + 3] === 0x02) {
      if (i + 9 < out.length && (out[i + 8] & 1) === 1) {
        out[i + 8] &= 0xFE; // 清 bit0（加密位在标志位低字节）
        cleared++;
      }
    }
  }
  return { bytes: out, cleared };
}

// ============================================================
// 主入口：analyzeFile(bytes, name)
// bytes: Uint8Array / number[]，name: 文件名（带扩展名）
// 返回 report 对象
// ============================================================
export function analyzeFile(bytes, name = "") {
 // 兼容 number[] / Uint8Array
  if (!bytes || bytes.length === 0) {
    return {
      name, size: 0,
      sections: [{ id: "empty", title: "空文件", level: "warn", icon: "warning", body: "文件为空，无法分析" }],
    };
  }
  const u8a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  const size = u8a.length;
  let detected = detectMagic(u8a);
 // zip 容器细分：apk/docx/xlsx/pptx/jar/epub/odt 识别成具体类型，而非笼统 zip
  detected = refineZipType(u8a, detected);
 // 本地 MAGIC 表不含 pcap/pcapng，用 trailerCarve 的 identifyMagic 补充识别
 // （拖入 pcap 后走协议级分析路径，不做无意义的尾部检测）
  if (!detected) {
    const idM = identifyMagic(u8a, 0);
    if (idM && MAGIC_EXT_MAP[idM.name]) {
      detected = { ...MAGIC_EXT_MAP[idM.name], desc: idM.desc };
    }
  }
  const fileExt = getExt(name);
  const mime = detected ? detected.mime : "application/octet-stream";
  const extConsist = checkExtConsistency(detected, fileExt);

  const sections = [];

 // 1. 文件信息（合并：文件头 magic 识别 + 扩展名一致性）
  {
    const infoLines = [];
    if (detected) {
      infoLines.push("文件头识别: " + detected.desc);
      infoLines.push("MIME: " + detected.mime);
      infoLines.push("实际扩展名: " + detected.ext);
    } else {
      infoLines.push("文件头识别: 未匹配已知 magic 签名（可能为自定义格式或文本）");
    }
    if (fileExt) infoLines.push("文件名扩展名: ." + fileExt);
 // 扩展名一致性判定融入本卡
    let infoLevel = detected ? "info" : "warn";
    let infoIcon = "fingerprint";
    if (extConsist) {
      infoLines.push("一致性: " + extConsist.msg);
      if (extConsist.ok === false) { infoLevel = "alert"; infoIcon = "warning"; }
      else if (extConsist.ok === null && detected) { infoLevel = "warn"; }
    }
    sections.push({
      id: "fileinfo", title: "文件信息",
      level: infoLevel, icon: infoIcon,
      body: infoLines.join("\n"),
    });
  }

 // 2. pcap/pcapng 协议级分析（拖入即跑 TCP 重组/HTTP 提取/DNS 隧道/ICMP 载荷，免去手动逐个 op）
  if (detected && (detected.ext === "pcap" || detected.ext === "pcapng")) {
    const pcapSections = analyzePcapBytes(u8a);
    for (const s of pcapSections) sections.push(s);
  }

 // 3. 文件尾附加数据（附带 actions：文本 + 二进制双份存盘）
  const trailing = checkTrailingData(u8a, detected);
  if (trailing) {
    let body = trailing.msg + (trailing.preview ? "\n预览: " + trailing.preview : "");
    const actions = [];
    if (trailing.hasTrailing) {
      const tail = getTrailingBytes(u8a, detected);
      if (tail && tail.length) {
        const bn = baseName(name);
        const ft = trailerFileType(tail);
 // 文本一份：尾部字节按 latin1 转文本存 <basename>_trailer.txt
        let txt = "";
        for (let k = 0; k < tail.length; k++) txt += String.fromCharCode(tail[k]);
        actions.push({
          type: "download", label: "存为文本 " + bn + "_trailer.txt",
          filename: bn + "_trailer.txt", mime: "text/plain",
          bytes: tail.slice ? tail.slice() : new Uint8Array(tail),
        });
 // 二进制一份：识别到具体格式则用对应扩展名，否则 .bin
        if (ft.name) body += "\n尾部起始识别为 " + ft.name + "（" + ft.desc + "）→ 可直接存为 ." + ft.ext;
        actions.push({
          type: "download",
          label: "存为二进制 " + bn + "_trailer." + ft.ext,
          filename: bn + "_trailer." + ft.ext, mime: ft.mime,
          bytes: tail.slice ? tail.slice() : new Uint8Array(tail),
        });
      }
    }
    const sec = {
      id: "trailing", title: "文件尾附加数据",
      level: trailing.hasTrailing ? "alert" : (trailing.found ? "info" : "warn"),
      icon: trailing.hasTrailing ? "warning" : "attach_file",
      body,
    };
    if (actions.length) sec.actions = actions;
    sections.push(sec);
  }

 // 4. PNG IHDR
  const ihdr = checkPngIhdr(u8a, detected);
  if (ihdr) {
    sections.push({
      id: "png-ihdr", title: "PNG IHDR 宽高校验",
      level: ihdr.crcOk === false ? "alert" : "info",
      icon: ihdr.crcOk === false ? "warning" : "image",
      body: ihdr.msg,
    });
  }

 // 5.0 OOXML（docx/xlsx/pptx）正文：zip 内 XML 是 deflate 压缩的，直接扫字节只见压缩流乱码。
 //     解压对应部件 → 剥 XML 标签 → 抽正文文本（中文 flag/情报在此才现真身）。
  const ooxml = checkOoxmlText(u8a, detected);
  if (ooxml) {
    const bn = baseName(name);
    sections.push({
      id: "ooxml-text", title: "文档正文（解压 OOXML）",
      level: /[^\x00-\x7F]/.test(ooxml.text) && /(flag|ctf|key)\{/i.test(ooxml.text) ? "alert" : "info",
      icon: "description",
      body: ooxml.msg + "\n" + ooxml.preview,
      actions: [
        { type: "view", label: "双击查看完整正文", text: ooxml.text },
        {
          type: "download", label: "导出正文 " + bn + "_text.txt",
          filename: bn + "_text.txt", mime: "text/plain",
          bytes: strToBytes(ooxml.text),
        },
      ],
    });
  }

 // 5. strings（满行段落排版 + 完整清单双击查看 / 导出）
  const strs = checkStrings(u8a);
  if (strs) {
    const bn = baseName(name);
    const sec = {
      id: "strings", title: "可打印字符串",
      level: "info", icon: "text_fields",
      body: strs.msg + "（完整清单可双击查看）\n" + strs.body,
      actions: [
        { type: "view", label: "双击查看全部字符串（带 offset）", text: strs.detail },
        {
          type: "download", label: "导出全部字符串 " + bn + "_strings.txt",
          filename: bn + "_strings.txt", mime: "text/plain",
          bytes: strToBytes(strs.detail),
        },
      ],
    };
    sections.push(sec);
  }

 // 6. 零宽/不可见字符（降误报 + 真命中自动隐写解码）
  const zw = checkZeroWidth(u8a);
  if (zw) {
 // 1-2 个零宽字符：极可能是 BOM/正常排版，降成 info 不惊扰
    const isNoise = zw.total <= 2;
    const lines = [zw.msg, zw.body];
    const actions = [];
    let level = isNoise ? "info" : "alert";
    if (!isNoise) {
 // 真命中（≥3）→ 把字节当 UTF-8 文本，喂零宽二进制隐写解码
      const text = bytesToUtf8Text(u8a);
      const dec = zwBinaryDecode(text);
      if (dec) {
        lines.push("");
        lines.push("● 零宽二进制隐写解码成功（映射 " + dec.map + "，可打印率 " + (dec.ratio * 100).toFixed(0) + "%）:");
        const flag = _findFlag(dec.text);
        if (flag) {
          lines.push("★ flag: " + flag);
          level = "alert";
        }
        const bn = baseName(name);
        lines.push("隐藏内容（前 200 字符，完整可双击查看）: " + (dec.text.length > 200 ? dec.text.slice(0, 200) + " …" : dec.text));
        actions.push({ type: "view", label: "双击查看解码全文", text: dec.text });
        actions.push({
          type: "download", label: "导出解码内容 " + bn + "_zw_decoded.txt",
          filename: bn + "_zw_decoded.txt", mime: "text/plain",
          bytes: dec.bytes.slice ? dec.bytes.slice() : new Uint8Array(dec.bytes),
        });
      } else {
 // 有规律但未解出：给完整 zwScan 报告供双击查看
        lines.push("（未解出二进制隐写，可双击查看完整零宽扫描报告）");
        actions.push({ type: "view", label: "双击查看零宽扫描详情", text: zwScan(text) });
      }
    }
    const sec = {
      id: "zero-width", title: "零宽/不可见字符检测",
      level, icon: level === "alert" ? "visibility_off" : "info",
      body: lines.join("\n"),
    };
    if (actions.length) sec.actions = actions;
    sections.push(sec);
  }

 // 7. base64 嵌入
  const b64 = checkEmbeddedB64(u8a);
  if (b64) {
    sections.push({
      id: "b64-embed", title: "嵌入 base64 提取",
      level: "warn", icon: "raw_on",
      body: b64.msg + "\n" + b64.body,
    });
  }

 // 8. 熵分析（密码学向，本工具主打 misc → 同级内排到最后）
  const ent = analyzeEntropy(u8a);
  if (ent) {
    sections.push({
      id: "entropy", title: "熵分析",
      level: ent.overall > 7.5 ? "warn" : "info",
      icon: "bar_chart",
      body: ent.msg,
      _sortLast: true,
    });
  }

 // 9. ZIP 伪加密（识别伪加密 → 自动输出清除加密位的修正 ZIP）
  const zip = checkZipPseudoEnc(u8a, detected);
  if (zip) {
    let body = zip.msg;
    const sec = {
      id: "zip", title: "ZIP 加密检测",
      level: zip.isPseudo ? "alert" : (zip.isRealEnc ? "warn" : "info"),
      icon: (zip.isPseudo || zip.isRealEnc) ? "lock" : "check_circle",
      body,
    };
    if (zip.isPseudo) {
      const fixed = clearZipPseudoEnc(u8a);
      if (fixed.cleared > 0) {
        const bn = baseName(name);
        sec.body = body + "\n● 已生成清除伪加密的修正文件（清 " + fixed.cleared + " 项加密位），可直接下载解压。";
        sec.actions = [{
          type: "download", label: "下载修正后 ZIP " + bn + "_fixed.zip",
          filename: bn + "_fixed.zip", mime: "application/zip",
          bytes: fixed.bytes,
        }];
      }
    }
    sections.push(sec);
  }

 // 10. flag/key/{} 专搜
  const fk = checkFlagKeywords(u8a);
  if (fk) {
    const body = fk.map((h) => {
      const items = h.items.slice(0, 15).join("  |  ");
      return h.kind + "（" + h.items.length + "）: " + items + (h.items.length > 15 ? " …" : "");
    }).join("\n");
    const hasFlag = fk.some((h) => h.kind === "flag 花括号");
    sections.push({
      id: "flag-search", title: "flag / key / {} 专搜",
      level: hasFlag ? "alert" : "warn", icon: "emergency",
      body,
    });
  }

 // 11. 文件尾附加数据递归解码
  const td = analyzeTrailingDecode(u8a, detected);
  if (td) {
    const lines = [];
    lines.push("尾部附加 " + td.tail + " 字节");
    if (td.embedHints.length) lines.push("识别: " + td.embedHints.join("；"));
    lines.push("解码链:");
    for (const c of td.chain) {
      if (c.label) lines.push("  ├─[" + c.label + "] " + c.len + " 字节: " + c.preview);
      else lines.push("  层" + c.layer + " (" + c.len + " 字节): " + c.preview);
      if (c.flag) lines.push("  ★ 命中 flag: " + c.flag);
    }
    if (td.foundFlag) lines.push("★★ 最终 flag: " + td.foundFlag);
    sections.push({
      id: "trailing-decode", title: "尾部数据递归解码",
      level: td.foundFlag ? "alert" : "warn", icon: "vpn_key",
      body: lines.join("\n"),
    });
  }

 // 12. Binwalk 全文 magic 扫描
  const bw = checkBinwalk(u8a);
  if (bw) {
    const lines = [];
    lines.push("命中 " + bw.hits.length + " 处已知格式头:");
 // 优先列压缩/归档/文档类内嵌（CTF 叠加隐写高频），避免被短魔数噪声挤掉
    const KEY = new Set(["ZIP", "ZIP-EOCD", "RAR4", "RAR5", "7Z", "GZIP", "BZIP2", "XZ", "PDF", "PNG", "JPEG", "GIF87", "GIF89"]);
    const keyHits = bw.hits.filter((h) => KEY.has(h.name));
    const shown = new Set();
    for (const h of keyHits.slice(0, 30)) {
      lines.push("  0x" + h.offset.toString(16).padStart(8, "0") + " (" + h.offset + ")  " + h.name + " — " + h.desc);
      shown.add(h.offset);
    }
    for (const h of bw.hits) {
      if (shown.size >= 40) break;
      if (shown.has(h.offset)) continue;
      lines.push("  0x" + h.offset.toString(16).padStart(8, "0") + " (" + h.offset + ")  " + h.name + " — " + h.desc);
      shown.add(h.offset);
    }
    const keyEmbedded = keyHits.filter((h) => h.offset > 0);
    if (bw.embedded.length > 0) {
      lines.push("▸ 偏移 0 之外命中 " + bw.embedded.length + " 处，疑似多文件叠加 / 内嵌文件");
      if (keyEmbedded.length > 0) {
        lines.push("  其中压缩/归档类内嵌: " + keyEmbedded.map((h) => h.name + "@0x" + h.offset.toString(16)).slice(0, 8).join(", "));
      }
    }
    sections.push({
      id: "binwalk", title: "Binwalk 全文魔数扫描",
      level: bw.embedded.length > 0 ? "warn" : "info", icon: "search",
      body: lines.join("\n"),
    });
  }

 // 13. PNG 逐块 CRC 校验 + 文本块
  const pc = pngChunkCrcReport(u8a);
  if (pc) {
    const lines = [];
    lines.push("共 " + pc.chunks.length + " 个 chunk:");
    for (const c of pc.chunks) {
      const crc = c.crcOk === null ? "?" : (c.crcOk ? "通过" : "失败");
      lines.push("  [" + c.type + "] 长度 " + c.len + "  CRC " +
        (c.storedCrc !== null ? pc.hex4(c.storedCrc) : "----") + " " + crc);
    }
    if (pc.texts.length) {
      lines.push("文本块内容:");
      for (const t of pc.texts) lines.push("  " + t.type + " \"" + t.kw + "\" = " + t.val);
    }
    if (pc.anyCrcFail) lines.push("⚠ 存在 CRC 校验失败的 chunk —— 可能藏数据 / 被篡改");
    sections.push({
      id: "png-chunks", title: "PNG 逐块 CRC 校验",
      level: pc.anyCrcFail ? "alert" : "info", icon: "data_object",
      body: lines.join("\n"),
    });
  }

 // 14. 图片 LSB 各通道提取
  const lsb = analyzeLsb(u8a, detected);
  if (lsb) {
    if (lsb.unsupported) {
      sections.push({
        id: "lsb", title: "图片 LSB 通道提取",
        level: "info", icon: "image",
        body: "暂不支持该图片的像素解码: " + lsb.unsupported,
      });
    } else {
      const head = "图片 " + lsb.width + "×" + lsb.height + "，" + lsb.channels + " 通道；各排列 LSB 提取（前 50 字节可打印预览）:";
      sections.push({
        id: "lsb", title: "图片 LSB 通道提取",
        level: "info", icon: "image",
        body: head + "\n" + lsb.lines.join("\n"),
      });
    }
  }

 // 15. 图片 EXIF / XMP 元数据
  const exif = extractExif(u8a);
  const xmp = extractXmp(u8a);
  if (exif || xmp) {
    const lines = [];
    if (exif) {
      lines.push("EXIF:");
      for (const t of exif.tags) lines.push("  " + t.name + ": " + t.value);
    }
    if (xmp) {
      const x = xmp.length > 600 ? xmp.slice(0, 600) + " …" : xmp;
      lines.push("XMP:");
      lines.push("  " + x.replace(/\n/g, "\n  "));
    }
    sections.push({
      id: "img-meta", title: "图片 EXIF / XMP 元数据",
      level: "info", icon: "image",
      body: lines.join("\n"),
    });
  }

 // 按重要性稳定排序：alert > warn > info，同级保持原插入顺序
  const LEVEL_WEIGHT = { alert: 0, warn: 1, info: 2 };
  const weight = (lv) => (LEVEL_WEIGHT[lv] === undefined ? 3 : LEVEL_WEIGHT[lv]);
  sections.forEach((s, i) => { s._order = i; });
  sections.sort((a, b) => {
    const d = weight(a.level) - weight(b.level);
    if (d !== 0) return d;
 // 同级：_sortLast 标记的（如熵分析，密码学才用）排到本级末尾
    const la = a._sortLast ? 1 : 0, lb = b._sortLast ? 1 : 0;
    if (la !== lb) return la - lb;
    return a._order - b._order;
  });
  sections.forEach((s) => { delete s._order; delete s._sortLast; });

  return {
    name, size,
    mime, ext: detected ? detected.ext : null,
    extConsistent: extConsist ? extConsist.ok : null,
    detected: detected ? detected.desc : null,
    sections,
  };
}

export default { analyzeFile };
