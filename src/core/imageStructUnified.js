/*
 * imageStructUnified.js — 图像结构解析归一（cat:'analysis'，单向 run + producer）。
 *
 * 场景：CTF misc 里图像题第一道工序——搞清图像是什么格式、尺寸多少、有没有藏数据。
 * pngChunks/imgMeta/pngSizeRecover/jpegSizeRead/gifSizeRead/imagefix 分散在 5 个 op
 * 本模块收编成「一个入口看全部」：拖图/粘贴 base64 → 自动 magic 分派 → 统一报告。
 *
 * 归并策略（只收编不删能力，旧 op 全保留）：
 * - PNG: 复用 pngChunkCrcReport（逐块 CRC + 文本块）+ isPngTampered/recoverPngSize（宽高爆破）
 * - JPEG: 复用 readJpegSize（SOF marker 尺寸）+ extractExif/extractXmp（EXIF/XMP 元数据）
 * - GIF: 复用 readGifSize（逻辑屏幕尺寸 + 帧列表）
 * - BMP: 本模块自实现 BITMAPFILEHEADER + BITMAPINFOHEADER 解析
 * - 尾部附加数据: PNG IEND / JPEG EOI / GIF trailer / BMP filesize 之后的数据
 *
 * 约束：
 * - 复用现有导出函数，不重写算法（BMP 解析除外）。
 * - section schema 固定格式：{id, title, level, icon, body, actions?}，与 imageAnalysis.js 一致。
 * - 零外发：纯本地字节解析。
 *
 * 契约：
 * - op run(text): 输入 base64（或 data URL），返回文本报告。
 * - producer analyzeImageStruct(bytes): 返回 {sections:[...]} | null，供 main.js handleFile 消费。
 *
 * 参考：
 * - PNG: BIP173 / RFC 2083（IHDR 固定坐标，chunk = len(4)+type(4)+data(n)+crc(4)）
 * - JPEG: ITU-T T.81（SOI FFD8 / SOF FFC0-FFCF / EOI FFD9）
 * - GIF: GIF89a 规范（sig "GIF" + ver "89a" / 逻辑屏幕描述符 7 字节）
 * - BMP: BITMAPV3（FILEHEADER 14 + INFOHEADER 40，小端有符号宽高）
 */
import { register } from "./registry.js";
import { pngChunkCrcReport } from "./pngChunks.js";
import { extractExif, extractXmp } from "./imgMeta.js";
import {
  isPng, readPngSize, isPngTampered, recoverPngSize, readJpegSize, readGifSize,
} from "./imagefix.js";

// ============================================================
// 工具：base64 → bytes（兼容 data URL / 纯 base64 / 含换行）
// ============================================================
function b64ToBytes(s) {
  let raw = String(s).trim();
 // 剥 data URL 前缀：data:image/png;base64,XXXX
  const comma = raw.indexOf(",");
  if (comma >= 0 && /^data:[^;]+;base64/i.test(raw.slice(0, comma + 1))) {
    raw = raw.slice(comma + 1);
  }
  const clean = raw.replace(/\s+/g, "");
  if (!clean) throw new Error("输入为空（请粘贴图像 base64 或 data URL）");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// 小端读
const u16le = (b, o) => (b[o] | (b[o + 1] << 8)) >>> 0;
const u32le = (b, o) => ((b[o]) | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x1000000)) >>> 0;
// 小端有符号 32 位（BMP 宽高可能为负，负数表示 top-down 位图）
const i32le = (b, o) => {
  const u = u32le(b, o);
  return u >= 0x80000000 ? u - 0x100000000 : u;
};
// 大端读
const u32be = (b, o) => ((b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])) >>> 0;

function bytesToHex(b, max) {
  const n = Math.min(b.length, max == null ? b.length : max);
  let s = "";
  for (let i = 0; i < n; i++) s += b[i].toString(16).padStart(2, "0").toUpperCase() + " ";
  return s.trim() + (b.length > n ? ` …（共 ${b.length} 字节）` : "");
}

// ============================================================
// magic 分派
// ============================================================
// PNG: 89 50 4E 47 0D 0A 1A 0A
// JPEG: FF D8
// GIF: 47 49 46 ("GIF")
// BMP: 42 4D ("BM")
function detectImageFormat(b) {
  if (b.length < 2) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b[0] === 0xff && b[1] === 0xd8) return "jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "gif";
  if (b[0] === 0x42 && b[1] === 0x4d) return "bmp";
  return null;
}

// ============================================================
// 尾部附加数据检测
// ============================================================
// PNG: IEND chunk 之后的数据
function pngTrailingOffset(bytes, chunks) {
 // 找最后一个 IEND chunk
  for (let i = chunks.length - 1; i >= 0; i--) {
    if (chunks[i].type === "IEND") {
 // IEND chunk: length(4) + type(4) + data(0) + crc(4) = 12 字节
      return chunks[i].offset + 12;
    }
  }
 // 无 IEND（结构异常），用最后一个 chunk 的结尾兜底
  if (chunks.length > 0) {
    const last = chunks[chunks.length - 1];
    return last.offset + 12 + last.len; // length(4)+type(4)+data(len)+crc(4)
  }
  return bytes.length;
}

// JPEG: 从后往前找最后一个 FFD9（EOI marker，两连续字节 FF D9）
function jpegTrailingOffset(bytes) {
  for (let i = bytes.length - 2; i >= 0; i--) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
      return i + 2; // FFD9 后一位
    }
  }
 // 没找到 EOI，整个文件都是图像数据
  return bytes.length;
}

// GIF: 从后往前找最后一个 0x3B（trailer）
function gifTrailingOffset(bytes) {
  for (let i = bytes.length - 1; i >= 0; i--) {
    if (bytes[i] === 0x3b) return i + 1;
  }
  return bytes.length;
}

// BMP: filesize 字段（offset 2-5，小端）之后的数据
function bmpTrailingOffset(bytes) {
  if (bytes.length < 6) return bytes.length;
  const filesize = u32le(bytes, 2);
 // filesize 为 0 或异常大时，用实际长度
  if (filesize === 0 || filesize > bytes.length) return bytes.length;
  return filesize;
}

// ============================================================
// PNG 结构解析（复用 pngChunkCrcReport + imagefix）
// ============================================================
function analyzePng(bytes) {
  const sections = [];

 // 尺寸 + IHDR 属性
  const size = readPngSize(bytes);
 // IHDR data 在 offset 16（宽 4 + 高 4 = 8 字节），之后是位深/颜色类型/压缩/滤波/隔行
  const bitDepth = bytes[16 + 8];
  const colorType = bytes[16 + 9];
  const compression = bytes[16 + 10];
  const filter = bytes[16 + 11];
  const interlace = bytes[16 + 12];
  const COLOR_NAMES = { 0: "灰度", 2: "RGB", 3: "索引色", 4: "灰度+Alpha", 6: "RGB+Alpha" };
  const colorName = COLOR_NAMES[colorType] || "未知(" + colorType + ")";
  const INTERLACE_NAMES = { 0: "无", 1: "Adam7" };

  const sizeLines = [
    `格式: PNG (Portable Network Graphics)`,
    `当前宽高: ${size.width} × ${size.height}`,
    `位深: ${bitDepth}  颜色类型: ${colorType} (${colorName})`,
    `压缩: ${compression}  滤波: ${filter}  隔行: ${interlace} (${INTERLACE_NAMES[interlace] || "未知"})`,
  ];
  sections.push({
    id: "img-header", title: "文件头 / 尺寸", level: "info", icon: "image",
    body: sizeLines.join("\n"),
  });

 // 逐块 CRC 校验
  const pc = pngChunkCrcReport(bytes);
  if (pc) {
    const lines = [`共 ${pc.chunks.length} 个 chunk:`];
    for (const c of pc.chunks) {
      const crc = c.crcOk === null ? "?" : (c.crcOk ? "通过" : "失败");
      const stored = c.storedCrc !== null ? pc.hex4(c.storedCrc) : "--------";
      lines.push(`  [${c.type}] @0x${c.offset.toString(16)} 长度 ${c.len}  CRC ${stored} ${crc}`);
    }
    if (pc.texts.length) {
      lines.push("文本块:");
      for (const t of pc.texts) {
        const val = t.val.length > 200 ? t.val.slice(0, 200) + " …" : t.val;
        lines.push(`  ${t.type} "${t.kw}" = ${val}`);
      }
    }
    if (pc.anyCrcFail) lines.push("⚠ 存在 CRC 校验失败的 chunk —— 可能藏数据 / 被篡改");
    sections.push({
      id: "png-chunks", title: "PNG 逐块 CRC 校验",
      level: pc.anyCrcFail ? "alert" : "info", icon: "data_object",
      body: lines.join("\n"),
    });
  }

 // 宽高异常检测 + 爆破恢复
  const tampered = isPngTampered(bytes);
  const stored = u32be(bytes, 29).toString(16).padStart(8, "0").toUpperCase();
  const calc = (() => {
 // 复用 imagefix 的 crc32 不方便（需 import），这里读 pngChunkCrcReport 的 calcCrc
    if (pc && pc.chunks.length > 0 && pc.chunks[0].type === "IHDR") {
      return pc.chunks[0].calcCrc !== null ? pc.hex4(pc.chunks[0].calcCrc) : "--------";
    }
    return "--------";
  })();
  const tamperLines = [
    `IHDR CRC32: 存=${stored} / 算=${calc}`,
    tampered
      ? "⚠ CRC 不符 —— 宽高可能被篡改（CTF 经典藏图手法）"
      : "校验通过 —— 宽高未被篡改",
  ];
  let tamperLevel = "info";
  if (tampered) {
    tamperLevel = "alert";
    tamperLines.push("开始爆破恢复真实宽高（先只爆高度，再爆宽度，最后双爆兜底）...");
    const r = recoverPngSize(bytes);
    if (r) {
      tamperLines.push(`恢复成功 [模式: ${r.mode}]：真实宽高 = ${r.width} × ${r.height}`);
      tamperLines.push(`建议: 用「PNG 宽高爆破恢复」op 获取修复后 base64`);
    } else {
      tamperLines.push("爆破失败：在 1..8192 范围内未找到匹配 CRC 的宽高组合");
    }
  }
  sections.push({
    id: "png-tamper", title: "宽高异常检测 / 爆破恢复",
    level: tamperLevel, icon: "warning",
    body: tamperLines.join("\n"),
  });

 // 尾部附加数据
  if (pc) {
    const trailOff = pngTrailingOffset(bytes, pc.chunks);
    const trail = bytes.subarray(trailOff);
    const trailLines = [`IEND 结束位置: 0x${trailOff.toString(16)}（${trailOff} 字节）`];
    if (trail.length > 0) {
      trailLines.push(`⚠ 尾部附加数据: ${trail.length} 字节`);
      trailLines.push(`前 64 字节 hex: ${bytesToHex(trail, 64)}`);
 // 尝试以 ASCII 预览
      let ascii = "";
      for (let i = 0; i < Math.min(trail.length, 64); i++) {
        const c = trail[i];
        ascii += (c >= 0x20 && c <= 0x7e) ? String.fromCharCode(c) : ".";
      }
      trailLines.push(`ASCII 预览: ${ascii}`);
      sections.push({
        id: "trailing", title: "尾部附加数据",
        level: "warn", icon: "append",
        body: trailLines.join("\n"),
      });
    } else {
      trailLines.push("无尾部附加数据（IEND 之后干净）");
      sections.push({
        id: "trailing", title: "尾部附加数据",
        level: "info", icon: "append",
        body: trailLines.join("\n"),
      });
    }
  }

 // EXIF / XMP（PNG 一般无，但可能有）
  const exif = extractExif(bytes);
  const xmp = extractXmp(bytes);
  if (exif || xmp) {
    const lines = [];
    if (exif) {
      lines.push("EXIF:");
      for (const t of exif.tags) lines.push(`  ${t.name}: ${t.value}`);
    }
    if (xmp) {
      const x = xmp.length > 600 ? xmp.slice(0, 600) + " …" : xmp;
      lines.push("XMP:");
      lines.push("  " + x.replace(/\n/g, "\n  "));
    }
    sections.push({
      id: "img-meta", title: "EXIF / XMP 元数据",
      level: "info", icon: "tag",
      body: lines.join("\n"),
    });
  }

  return sections;
}

// ============================================================
// JPEG 结构解析（复用 readJpegSize + extractExif/extractXmp）
// ============================================================
function analyzeJpeg(bytes) {
  const sections = [];

 // SOF 尺寸
  const sofResults = readJpegSize(bytes);
  const headerLines = [`格式: JPEG (Joint Photographic Experts Group)`];
  if (sofResults && sofResults.length > 0) {
    headerLines.push(`找到 ${sofResults.length} 个 SOF marker:`);
    for (const r of sofResults) {
      headerLines.push(`  @ 偏移 0x${r.offset.toString(16)} — ${r.marker} ${r.name}`);
      headerLines.push(`    精度=${r.precision}bit, 高=${r.height}, 宽=${r.width}, 分量数=${r.components}`);
    }
  } else {
    headerLines.push("⚠ 未找到 SOF marker（结构异常或被截断）");
  }
  sections.push({
    id: "img-header", title: "文件头 / SOF 尺寸",
    level: sofResults && sofResults.length > 0 ? "info" : "warn", icon: "image",
    body: headerLines.join("\n"),
  });

 // EXIF / XMP（JPEG 是 EXIF/XMP 的主战场）
  const exif = extractExif(bytes);
  const xmp = extractXmp(bytes);
  if (exif || xmp) {
    const lines = [];
    if (exif) {
      lines.push("EXIF:");
      for (const t of exif.tags) lines.push(`  ${t.name}: ${t.value}`);
    }
    if (xmp) {
      const x = xmp.length > 600 ? xmp.slice(0, 600) + " …" : xmp;
      lines.push("XMP:");
      lines.push("  " + x.replace(/\n/g, "\n  "));
    }
    sections.push({
      id: "img-meta", title: "EXIF / XMP 元数据",
      level: "info", icon: "tag",
      body: lines.join("\n"),
    });
  } else {
    sections.push({
      id: "img-meta", title: "EXIF / XMP 元数据",
      level: "info", icon: "tag",
      body: "无 EXIF / XMP 元数据",
    });
  }

 // 尾部附加数据（EOI FFD9 之后）
  const trailOff = jpegTrailingOffset(bytes);
  const trail = bytes.subarray(trailOff);
  const trailLines = [`EOI (FFD9) 结束位置: 0x${trailOff.toString(16)}（${trailOff} 字节）`];
  if (trail.length > 0) {
    trailLines.push(`⚠ 尾部附加数据: ${trail.length} 字节`);
    trailLines.push(`前 64 字节 hex: ${bytesToHex(trail, 64)}`);
    let ascii = "";
    for (let i = 0; i < Math.min(trail.length, 64); i++) {
      const c = trail[i];
      ascii += (c >= 0x20 && c <= 0x7e) ? String.fromCharCode(c) : ".";
    }
    trailLines.push(`ASCII 预览: ${ascii}`);
    sections.push({
      id: "trailing", title: "尾部附加数据",
      level: "warn", icon: "append",
      body: trailLines.join("\n"),
    });
  } else {
    trailLines.push("无尾部附加数据（EOI 之后干净）");
    sections.push({
      id: "trailing", title: "尾部附加数据",
      level: "info", icon: "append",
      body: trailLines.join("\n"),
    });
  }

  return sections;
}

// ============================================================
// GIF 结构解析（复用 readGifSize）
// ============================================================
function analyzeGif(bytes) {
  const sections = [];

  const r = readGifSize(bytes);
  if (!r) {
    sections.push({
      id: "img-header", title: "文件头 / 尺寸",
      level: "warn", icon: "image",
      body: "签名非 GIF，无法解析",
    });
    return sections;
  }

  const headerLines = [
    `格式: GIF (${r.version})`,
    `逻辑屏幕尺寸: ${r.screenWidth} × ${r.screenHeight}`,
  ];
  if (r.frames.length > 0) {
    headerLines.push(`图像帧数: ${r.frames.length}`);
    for (let i = 0; i < r.frames.length; i++) {
      const f = r.frames[i];
      headerLines.push(`  [帧 ${i + 1}] 位置=(${f.left},${f.top}) 尺寸=${f.width}×${f.height}`);
    }
  }
  sections.push({
    id: "img-header", title: "文件头 / 尺寸 / 帧列表",
    level: "info", icon: "image",
    body: headerLines.join("\n"),
  });

 // 尾部附加数据（trailer 0x3B 之后）
  const trailOff = gifTrailingOffset(bytes);
  const trail = bytes.subarray(trailOff);
  const trailLines = [`Trailer (0x3B) 结束位置: 0x${trailOff.toString(16)}（${trailOff} 字节）`];
  if (trail.length > 0) {
    trailLines.push(`⚠ 尾部附加数据: ${trail.length} 字节`);
    trailLines.push(`前 64 字节 hex: ${bytesToHex(trail, 64)}`);
    let ascii = "";
    for (let i = 0; i < Math.min(trail.length, 64); i++) {
      const c = trail[i];
      ascii += (c >= 0x20 && c <= 0x7e) ? String.fromCharCode(c) : ".";
    }
    trailLines.push(`ASCII 预览: ${ascii}`);
    sections.push({
      id: "trailing", title: "尾部附加数据",
      level: "warn", icon: "append",
      body: trailLines.join("\n"),
    });
  } else {
    trailLines.push("无尾部附加数据（trailer 之后干净）");
    sections.push({
      id: "trailing", title: "尾部附加数据",
      level: "info", icon: "append",
      body: trailLines.join("\n"),
    });
  }

  return sections;
}

// ============================================================
// BMP 结构解析（本件自实现，现有无 BMP 模块）
// ============================================================
// BITMAPFILEHEADER (14 字节):
// 0-1 signature "BM"
// 2-5 filesize (uint32 LE)
// 6-9 reserved
// 10-13 dataOffset (uint32 LE, 像素数据起始偏移)
// BITMAPINFOHEADER (40 字节, 从 offset 14 开始):
// 14-17 headerSize
// 18-21 width (int32 LE, 负数=top-down)
// 22-25 height (int32 LE, 负数=top-down)
// 26-27 planes (uint16 LE, 恒 1)
// 28-29 bpp (uint16 LE, 1/4/8/16/24/32)
// 30-33 compression (uint32 LE, 0=BI_RGB)
// 34-37 imageSize (uint32 LE, 像素数据大小)
const BMP_COMPRESSION_NAMES = {
  0: "BI_RGB (无压缩)",
  1: "BI_RLE8",
  2: "BI_RLE4",
  3: "BI_BITFIELDS",
  4: "BI_JPEG",
  5: "BI_PNG",
};

function analyzeBmp(bytes) {
  const sections = [];

  if (bytes.length < 54) {
    sections.push({
      id: "img-header", title: "文件头 / 尺寸",
      level: "warn", icon: "image",
      body: `BMP 文件过短（${bytes.length} 字节，至少需 54 字节含完整 FILEHEADER+INFOHEADER）`,
    });
    return sections;
  }

  const filesize = u32le(bytes, 2);
  const dataOffset = u32le(bytes, 10);
  const headerSize = u32le(bytes, 14);
  const width = i32le(bytes, 18);
  const height = i32le(bytes, 22);
  const planes = u16le(bytes, 26);
  const bpp = u16le(bytes, 28);
  const compression = u32le(bytes, 30);
  const imageSize = u32le(bytes, 34);
  const colorsUsed = u32le(bytes, 46);
  const topDown = height < 0;
  const compName = BMP_COMPRESSION_NAMES[compression] || `未知(${compression})`;

  const headerLines = [
    `格式: BMP (Bitmap)`,
    `文件头声明大小: ${filesize} 字节（实际 ${bytes.length} 字节）${filesize !== bytes.length ? " ⚠ 不符" : ""}`,
    `DIB 头大小: ${headerSize} 字节（${headerSize === 40 ? "BITMAPINFOHEADER" : headerSize === 108 ? "BITMAPV4HEADER" : headerSize === 124 ? "BITMAPV5HEADER" : "其他版本"}）`,
    `宽高: ${Math.abs(width)} × ${Math.abs(height)}${topDown ? " (top-down 位图，高度为负)" : ""}`,
    `色平面数: ${planes}${planes !== 1 ? " ⚠ 应为 1" : ""}`,
    `位深: ${bpp} bpp`,
    `压缩: ${compression} (${compName})`,
    `像素数据大小: ${imageSize} 字节`,
    `像素数据偏移: 0x${dataOffset.toString(16)}（${dataOffset} 字节）`,
    `使用颜色数: ${colorsUsed === 0 ? "全部" : colorsUsed}`,
  ];
  sections.push({
    id: "img-header", title: "文件头 / DIB 头 / 尺寸",
    level: filesize !== bytes.length ? "warn" : "info", icon: "image",
    body: headerLines.join("\n"),
  });

 // 尾部附加数据（filesize 之后）
  const trailOff = bmpTrailingOffset(bytes);
  const trail = bytes.subarray(trailOff);
  const trailLines = [`文件头声明大小位置: 0x${trailOff.toString(16)}（${trailOff} 字节）`];
  if (trail.length > 0) {
    trailLines.push(`⚠ 尾部附加数据: ${trail.length} 字节`);
    trailLines.push(`前 64 字节 hex: ${bytesToHex(trail, 64)}`);
    let ascii = "";
    for (let i = 0; i < Math.min(trail.length, 64); i++) {
      const c = trail[i];
      ascii += (c >= 0x20 && c <= 0x7e) ? String.fromCharCode(c) : ".";
    }
    trailLines.push(`ASCII 预览: ${ascii}`);
    sections.push({
      id: "trailing", title: "尾部附加数据",
      level: "warn", icon: "append",
      body: trailLines.join("\n"),
    });
  } else {
    trailLines.push("无尾部附加数据（filesize 之后干净）");
    sections.push({
      id: "trailing", title: "尾部附加数据",
      level: "info", icon: "append",
      body: trailLines.join("\n"),
    });
  }

  return sections;
}

// ============================================================
// producer：analyzeImageStruct(bytes) → {sections:[...]} | null
// 供 main.js handleFile 消费
// ============================================================
export function analyzeImageStruct(bytes) {
  if (!bytes || bytes.length === 0) return null;
  const u8a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const fmt = detectImageFormat(u8a);
  if (!fmt) return null; // 非图像 → 调用方应忽略

  let sections;
  if (fmt === "png") sections = analyzePng(u8a);
  else if (fmt === "jpeg") sections = analyzeJpeg(u8a);
  else if (fmt === "gif") sections = analyzeGif(u8a);
  else if (fmt === "bmp") sections = analyzeBmp(u8a);
  else return null;

 // 头部加一个 magic 识别段（统一入口标识）
  const MAGIC_NAMES = {
    png: "PNG (Portable Network Graphics)",
    jpeg: "JPEG (Joint Photographic Experts Group)",
    gif: "GIF (Graphics Interchange Format)",
    bmp: "BMP (Bitmap)",
  };
  const MAGIC_HEX = {
    png: "89 50 4E 47 0D 0A 1A 0A",
    jpeg: "FF D8",
    gif: "47 49 46 38",
    bmp: "42 4D",
  };
  sections.unshift({
    id: "img-magic", title: "图像格式识别",
    level: "info", icon: "badge",
    body: `识别结果: ${MAGIC_NAMES[fmt]}\nmagic: ${MAGIC_HEX[fmt]}\n文件大小: ${u8a.length} 字节`,
  });

 // 按重要性稳定排序：alert > warn > info
  const LEVEL_WEIGHT = { alert: 0, warn: 1, info: 2 };
  const weight = (lv) => (LEVEL_WEIGHT[lv] === undefined ? 3 : LEVEL_WEIGHT[lv]);
  sections.forEach((s, i) => { s._order = i; });
  sections.sort((a, b) => {
    const d = weight(a.level) - weight(b.level);
    if (d !== 0) return d;
    return a._order - b._order;
  });
  sections.forEach((s) => { delete s._order; });

  return { sections };
}

// ============================================================
// op 注册（run 型，输入 base64 / data URL）
// ============================================================
function formatReport(bytes) {
  const u8a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const fmt = detectImageFormat(u8a);
  if (!fmt) {
    return [
      "=== 图像结构分析报告 ===",
      "识别结果: 非图像文件（magic 不匹配 PNG/JPEG/GIF/BMP）",
      `文件大小: ${u8a.length} 字节`,
      `前 16 字节 hex: ${bytesToHex(u8a, 16)}`,
      "",
      "提示: 请粘贴 PNG/JPEG/GIF/BMP 的 base64 或 data URL。",
    ].join("\n");
  }

  const result = analyzeImageStruct(u8a);
  const lines = ["=== 图像结构分析报告 ==="];
  for (const s of result.sections) {
    lines.push("");
    lines.push(`--- ${s.title} [${s.level}] ---`);
    lines.push(s.body);
  }
  lines.push("");
  lines.push("=== 报告终 ===");
  return lines.join("\n");
}

register({
  id: "imageStructUnified",
  cat: "forensic",
  name: "图像结构分析（归一）",
  desc: "拖图/粘贴 base64 自动识别 PNG/JPG/GIF/BMP，统一输出文件头/尺寸/块结构/EXIF/XMP/尾部附加数据/宽高异常修复建议。归并 pngChunks/imgMeta/pngSizeRecover/jpegSizeRead/gifSizeRead 五个 op",
  params: [],
  run: function (text, p) {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：真字节优先，跳过 base64 文本解析。
    const bytes = (p && p.rawBytes && p.rawBytes.length)
      ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
      : b64ToBytes(text);
    return formatReport(bytes);
  },
  acceptsBytes: true,
});
