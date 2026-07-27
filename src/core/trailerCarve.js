/*
 * trailerCarve.js — 文件附加数据剥离 / binwalk 式全文魔数扫描（cat:'analysis'）。
 *
 * 背景：CTF 高频「载体正常结束后尾部粘着隐藏数据」——PNG IEND 之后、JPEG FFD9 之后
 * ZIP EOCD 之后、GIF 3B 之后仍有附加字节，或整文件里嵌了第二个文件。
 *
 * 本文件补 fileAnalysis.js 的空缺：后者只在拖入流水线里预览尾部 64 字节，未注册独立 op
 * 不做精确结束定位、不做全文魔数扫描、不完整提取附加数据。这里补齐为可单独调用的分析 op。
 *
 * 两种模式（run 单向分析，输入 base64 文件字节，输出多行文本报告）：
 * trailer : 识别主体类型 → 按格式规范求「精确结束偏移」→ 剥出其后全部附加字节
 * 给出长度 / 魔数识别 / hex / ascii / base64。
 * binwalk : 不依赖主体类型，全字节流滑窗匹配魔数表，列出所有命中偏移（含偏移 0 的主体）。
 *
 * 精确结束定位按各格式官方规范实现，不编造：
 * PNG (ISO/IEC 15948) : 8 字节签名后按 chunk 遍历（len4+type4+data+crc4），IEND 后即结束。
 * JPEG (ITU-T T.81) : 从 marker 段跳，遇 SOS(FFDA) 后进熵编码区，线性找 FFD9，其后 +2。
 * GIF (GIF89a spec) : 逻辑屏 + 图像块/扩展块遍历，到 trailer 0x3B 结束。
 * ZIP (APPNOTE.TXT) : 从后往前找 EOCD 504B0506，结束 = eocd + 22 + commentLen。
 * BMP (BITMAPFILEHDR) : 偏移 2 处 4 字节小端 = 文件总长。
 * RIFF (WAV/AVI/WebP) : 偏移 4 处 4 字节小端 ChunkSize + 8。
 * PDF : 最后一个 %%EOF 之后即附加区。
 *
 * 红线：core 层零 UI 依赖；输入约定 text 为 base64（可带 dataURL 前缀），UI 层 app.js 适配。
 */
import { register } from "./registry.js";

// ============ 通用工具（自包含） ============
function b64ToBytes(b64) {
  if (typeof b64 !== "string") throw new Error("需 base64 字符串输入");
  const comma = b64.indexOf(",");
  if (comma >= 0 && b64.slice(0, 5).toLowerCase().startsWith("data:")) b64 = b64.slice(comma + 1);
  b64 = b64.replace(/\s+/g, "");
  let bin;
  if (typeof atob === "function") bin = atob(b64);
  else if (typeof Buffer !== "undefined") bin = Buffer.from(b64, "base64").toString("binary");
  else throw new Error("无 atob/Buffer，无法解码 base64");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)));
  }
  if (typeof btoa === "function") return btoa(bin);
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  throw new Error("无 btoa/Buffer，无法编码 base64");
}

function u16le(b, o) { return (b[o] | (b[o + 1] << 8)) >>> 0; }
function u32le(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x1000000)) >>> 0; }
function u32be(b, o) { return ((b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])) >>> 0; }

function matchAt(buf, off, magic) {
  if (off + magic.length > buf.length) return false;
  for (let k = 0; k < magic.length; k++) if (buf[off + k] !== magic[k]) return false;
  return true;
}

function hexDump(bytes, start, len) {
  const end = Math.min(bytes.length, start + len);
  let s = "";
  for (let i = start; i < end; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

function asciiDump(bytes, start, len) {
  const end = Math.min(bytes.length, start + len);
  let s = "";
  for (let i = start; i < end; i++) {
    const c = bytes[i];
    s += (c >= 0x20 && c < 0x7F) ? String.fromCharCode(c) : ".";
  }
  return s;
}

// ============ 魔数表（照标准 magic，不编造；含头/可选尾） ============
// name 显示名，magic 头字节，desc 说明。用于主体识别、附加数据识别、binwalk 全扫。
const MAGIC_TABLE = [
  { name: "PNG",   magic: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], desc: "PNG 图像" },
  { name: "JPEG",  magic: [0xFF, 0xD8, 0xFF],                               desc: "JPEG 图像" },
  { name: "GIF87", magic: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],             desc: "GIF87a 图像" },
  { name: "GIF89", magic: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],             desc: "GIF89a 图像" },
  { name: "ZIP",   magic: [0x50, 0x4B, 0x03, 0x04],                         desc: "ZIP 压缩包（本地文件头）" },
  { name: "ZIP-EOCD", magic: [0x50, 0x4B, 0x05, 0x06],                      desc: "ZIP 空归档 / 中央目录尾" },
  { name: "RAR5",  magic: [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00], desc: "RAR5 压缩包" },
  { name: "RAR4",  magic: [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00],       desc: "RAR4 压缩包" },
  { name: "7Z",    magic: [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C],             desc: "7-Zip 压缩包" },
  { name: "GZIP",  magic: [0x1F, 0x8B, 0x08],                               desc: "gzip 压缩" },
  { name: "BZIP2", magic: [0x42, 0x5A, 0x68],                               desc: "bzip2 压缩" },
  { name: "XZ",    magic: [0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00],             desc: "xz 压缩" },
  { name: "PDF",   magic: [0x25, 0x50, 0x44, 0x46, 0x2D],                   desc: "PDF 文档（%PDF-）" },
  { name: "BMP",   magic: [0x42, 0x4D],                                     desc: "BMP 位图" },
  { name: "RIFF",  magic: [0x52, 0x49, 0x46, 0x46],                         desc: "RIFF 容器（WAV/AVI/WebP）" },
  { name: "TIFF-LE", magic: [0x49, 0x49, 0x2A, 0x00],                       desc: "TIFF 图像（小端）" },
  { name: "TIFF-BE", magic: [0x4D, 0x4D, 0x00, 0x2A],                       desc: "TIFF 图像（大端）" },
  { name: "ELF",   magic: [0x7F, 0x45, 0x4C, 0x46],                         desc: "ELF 可执行" },
  { name: "PE",    magic: [0x4D, 0x5A],                                     desc: "PE/DOS 可执行（MZ）" },
  { name: "OGG",   magic: [0x4F, 0x67, 0x67, 0x53],                         desc: "OGG 容器" },
  { name: "FLAC",  magic: [0x66, 0x4C, 0x61, 0x43],                         desc: "FLAC 音频" },
  { name: "ID3",   magic: [0x49, 0x44, 0x33],                               desc: "MP3 音频（ID3）" },
  { name: "CLASS", magic: [0xCA, 0xFE, 0xBA, 0xBE],                         desc: "Java class / Mach-O fat" },
  { name: "PCAP",  magic: [0xD4, 0xC3, 0xB2, 0xA1],                         desc: "pcap 抓包（小端）" },
  { name: "PCAPNG", magic: [0x0A, 0x0D, 0x0D, 0x0A],                        desc: "pcapng 抓包" },
];

// 主体识别（首偏移优先长 magic）
function detectPrimary(bytes) {
  let best = null;
  for (const m of MAGIC_TABLE) {
    if (matchAt(bytes, 0, m.magic)) {
      if (!best || m.magic.length > best.magic.length) best = m;
    }
  }
  return best;
}

// 附加数据开头魔数识别（同表，任意偏移 0 匹配）
function identifyMagic(bytes, start) {
  let best = null;
  for (const m of MAGIC_TABLE) {
    if (matchAt(bytes, start, m.magic)) {
      if (!best || m.magic.length > best.magic.length) best = m;
    }
  }
  return best;
}

// ============ 各格式「精确结束偏移」 ============
// 返回主体正体结束后的第一个字节偏移（即附加数据起点）；无法确定返回 null。

function pngEnd(bytes) {
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = u32be(bytes, pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    pos += 12 + len; // 4 长度 + 4 类型 + data + 4 CRC
    if (type === "IEND") return pos;
    if (pos > bytes.length) return null;
  }
  return null;
}

function jpegEnd(bytes) {
  let i = 2; // 跳 SOI FFD8
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xFF) { i++; continue; }
    let marker = bytes[i + 1];
    while (marker === 0xFF && i + 2 < bytes.length) { i++; marker = bytes[i + 1]; }
    if (marker === 0x00) { i += 2; continue; }
    if (marker === 0xD9) return i + 2;               // EOI 直接命中
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
    if (marker === 0xDA) {                            // SOS：进入熵编码，线性找 FFD9
      let j = i + 2;
      while (j + 1 < bytes.length) {
        if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) return j + 2;
        j++;
      }
      return null;
    }
    if (i + 3 >= bytes.length) return null;
    const segLen = (bytes[i + 2] << 8) + bytes[i + 3];
    if (segLen < 2) return null;
    i += 2 + segLen;
  }
  return null;
}

function gifEnd(bytes) {
  let pos = 6;
  if (pos + 7 > bytes.length) return null;
  const packed = bytes[pos + 4];
  const gctFlag = (packed & 0x80) !== 0;
  const gctSize = gctFlag ? 3 * (1 << ((packed & 0x07) + 1)) : 0;
  pos += 7 + gctSize;
  const skipSubBlocks = (p) => {
    while (p < bytes.length) {
      const len = bytes[p++];
      if (len === 0) break;
      p += len;
    }
    return p;
  };
  while (pos < bytes.length) {
    const intro = bytes[pos];
    if (intro === 0x3B) return pos + 1;               // Trailer
    if (intro === 0x2C) {                             // 图像描述符
      if (pos + 10 > bytes.length) return null;
      const lctPacked = bytes[pos + 9];
      pos += 10;
      if ((lctPacked & 0x80) !== 0) pos += 3 * (1 << ((lctPacked & 0x07) + 1));
      if (pos >= bytes.length) return null;
      pos++; // LZW 最小码长
      pos = skipSubBlocks(pos);
    } else if (intro === 0x21) {                      // 扩展块
      if (pos + 2 > bytes.length) return null;
      pos += 2; // 0x21 + label
      pos = skipSubBlocks(pos);
    } else {
      return null; // 未知引入字节，无法精确定位
    }
  }
  return null;
}

function zipEnd(bytes) {
  const sig = [0x50, 0x4B, 0x05, 0x06];
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (matchAt(bytes, i, sig)) {
      const commentLen = u16le(bytes, i + 20);
      const end = i + 22 + commentLen;
      return end <= bytes.length ? end : bytes.length;
    }
  }
  return null;
}

function bmpEnd(bytes) {
  if (bytes.length < 6) return null;
  const size = u32le(bytes, 2);
  return (size > 0 && size <= bytes.length) ? size : null;
}

function riffEnd(bytes) {
  if (bytes.length < 8) return null;
  const size = u32le(bytes, 4);
  const end = size + 8;
  return (end > 0 && end <= bytes.length) ? end : null;
}

function pdfEnd(bytes) {
  const eof = [0x25, 0x25, 0x45, 0x4F, 0x46]; // %%EOF
  let last = -1;
  for (let i = bytes.length - eof.length; i >= 0; i--) {
    if (matchAt(bytes, i, eof)) { last = i; break; }
  }
  if (last < 0) return null;
  let end = last + eof.length;
 // 吞掉紧随的换行（PDF 常见 %%EOF\r\n）
  while (end < bytes.length && (bytes[end] === 0x0D || bytes[end] === 0x0A)) end++;
  return end;
}

function primaryEnd(bytes, primary) {
  if (!primary) return null;
  switch (primary.name) {
    case "PNG": return pngEnd(bytes);
    case "JPEG": return jpegEnd(bytes);
    case "GIF87": case "GIF89": return gifEnd(bytes);
    case "ZIP": case "ZIP-EOCD": return zipEnd(bytes);
    case "BMP": return bmpEnd(bytes);
    case "RIFF": return riffEnd(bytes);
    case "PDF": return pdfEnd(bytes);
    default: return null;
  }
}

// 判断一段是否全为 padding（0x00 或全 0xFF）
function isPadding(bytes, start, end) {
  let z = 0, f = 0;
  for (let i = start; i < end; i++) {
    if (bytes[i] === 0x00) z++;
    else if (bytes[i] === 0xFF) f++;
  }
  const n = end - start;
  return z === n || f === n;
}

// ============ trailer 模式：主体尾部附加数据剥离 ============
function trailerReport(bytes, fmt) {
  const lines = [];
  lines.push(`文件大小: ${bytes.length} 字节`);
  const primary = detectPrimary(bytes);
  if (!primary) {
    lines.push("主体类型: 未匹配已知魔数（可能是文本 / 自定义格式）");
    lines.push("");
    lines.push("无法精确定位正体结束，改用 binwalk 全文扫描（切换模式）。");
    return lines.join("\n");
  }
  lines.push(`主体类型: ${primary.name}（${primary.desc}）`);

  const end = primaryEnd(bytes, primary);
  if (end == null) {
    lines.push("正体结束偏移: 无法按规范精确定位（该格式无固定尾，或结构损坏）");
    lines.push("");
    lines.push("建议改用 binwalk 全文扫描模式，按内嵌魔数偏移剥离。");
    return lines.join("\n");
  }
  lines.push(`正体结束偏移: ${end}（0x${end.toString(16)}）`);

  const tail = bytes.length - end;
  if (tail <= 0) {
    lines.push("");
    lines.push("✓ 正体结束后无附加数据。");
    return lines.join("\n");
  }

  const pad = isPadding(bytes, end, bytes.length);
  lines.push(`附加数据: ${tail} 字节${pad ? "（疑似全 0x00/0xFF 填充）" : ""}`);

 // 附加数据开头魔数识别
  const idMagic = identifyMagic(bytes, end);
  if (idMagic) {
    lines.push(`▸ 附加数据开头识别为: ${idMagic.name}（${idMagic.desc}）— 尾部粘连了一个完整文件`);
  } else {
    lines.push("▸ 附加数据开头未匹配已知魔数");
  }

  lines.push("");
 // hex 预览（前 128 字节）
  const previewLen = Math.min(128, tail);
  lines.push(`hex 前 ${previewLen} 字节:`);
  lines.push(hexDump(bytes, end, previewLen) + (tail > previewLen ? " …" : ""));
  lines.push("");
  lines.push(`ascii 前 ${previewLen} 字节:`);
  lines.push(asciiDump(bytes, end, previewLen) + (tail > previewLen ? " …" : ""));

 // 按 fmt 输出完整附加数据
  const slice = bytes.subarray(end, bytes.length);
  if (fmt === "hex" || fmt === "all") {
    lines.push("");
    lines.push("附加数据完整 hex:");
    lines.push(hexDump(slice, 0, slice.length));
  }
  if (fmt === "ascii" || fmt === "all") {
    lines.push("");
    lines.push("附加数据完整 ascii:");
    lines.push(asciiDump(slice, 0, slice.length));
  }
  if (fmt === "base64" || fmt === "all") {
    lines.push("");
    lines.push("附加数据 base64（可另存 / 二次解码）:");
    lines.push(bytesToB64(slice));
  }
  return lines.join("\n");
}

// ============ binwalk 模式：全文魔数扫描 ============
function binwalkReport(bytes) {
  const lines = [];
  lines.push(`文件大小: ${bytes.length} 字节`);
  lines.push("全文魔数扫描（binwalk 式，列出所有已知格式头命中偏移）:");
  lines.push("");
  const hits = [];
  for (let i = 0; i < bytes.length; i++) {
 // 优先匹配最长 magic，命中即记录并跳过该 magic 长度，减少重叠误报
    let matched = null;
    for (const m of MAGIC_TABLE) {
      if (matchAt(bytes, i, m.magic)) {
        if (!matched || m.magic.length > matched.magic.length) matched = m;
      }
    }
    if (matched) {
      hits.push({ offset: i, name: matched.name, desc: matched.desc });
      i += matched.magic.length - 1;
    }
  }
  if (hits.length === 0) {
    lines.push("(无已知格式魔数命中)");
    return lines.join("\n");
  }
  lines.push(`命中 ${hits.length} 处:`);
  for (const h of hits) {
    lines.push(`  0x${h.offset.toString(16).padStart(8, "0")}  (${h.offset})  ${h.name} — ${h.desc}`);
  }
 // CTF 提示：偏移 0 之外的命中往往是尾部/内嵌文件
  const embedded = hits.filter((h) => h.offset > 0);
  if (embedded.length > 0) {
    lines.push("");
    lines.push(`▸ 偏移 0 之外命中 ${embedded.length} 处，可能是尾部粘连 / 内嵌文件。`);
    lines.push("  取 base64（从命中偏移到文件末尾）可剥离：");
    const first = embedded[0];
    const slice = bytes.subarray(first.offset, bytes.length);
    lines.push(`  首个内嵌（${first.name} @ 0x${first.offset.toString(16)}，${slice.length} 字节）base64:`);
    lines.push(bytesToB64(slice));
  }
  return lines.join("\n");
}

// ============ op run ============
function trailerCarveRun(text, p = {}) {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：真字节优先，跳过 base64 文本解析。
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : b64ToBytes(text);
  if (bytes.length === 0) return "(空文件)";
  const mode = p.mode || "trailer";
  const fmt = p.format || "auto";
  if (mode === "binwalk") return binwalkReport(bytes);
  return trailerReport(bytes, fmt);
}

// ============ register ============
register({
  id: "trailerCarve", cat: "forensic", name: "文件附加数据剥离",
  desc: "识别载体正体结束偏移（PNG IEND/JPEG FFD9/GIF 3B/ZIP EOCD/BMP/RIFF/PDF %%EOF），剥出尾部附加字节并识别魔数；或 binwalk 式全文扫描内嵌文件",
  params: [
    { key: "mode", label: "模式", type: "select", default: "trailer",
      options: [
        { value: "trailer", label: "尾部剥离（精确定位正体结束）" },
        { value: "binwalk", label: "全文魔数扫描（binwalk 式）" },
      ],
    },
    { key: "format", label: "附加数据输出", type: "select", default: "auto",
      options: [
        { value: "auto", label: "仅预览（前 128 字节 hex+ascii）" },
        { value: "hex", label: "完整 hex" },
        { value: "ascii", label: "完整 ascii" },
        { value: "base64", label: "完整 base64（可另存）" },
        { value: "all", label: "全部（hex+ascii+base64）" },
      ],
    },
  ],
  run: trailerCarveRun,
  acceptsBytes: true,
});

export {
  trailerCarveRun,
  detectPrimary,
  primaryEnd,
  pngEnd, jpegEnd, gifEnd, zipEnd, bmpEnd, riffEnd, pdfEnd,
  identifyMagic,
  b64ToBytes, bytesToB64,
  MAGIC_TABLE,
};
