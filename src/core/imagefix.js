/*
 * imagefix.js — 图像宽高异常检测 + 自动修复（cat:'analysis'）。
 *
 * 交付：
 * - pngSizeRecover：PNG IHDR CRC 校验（检测篡改）+ 爆破恢复真实宽高（先只爆高度
 * 再爆宽度，最后双爆兜底；CTF 90% 是改高度题，O(N) 秒出）
 * - jpegSizeRead：读 JPEG SOF0/SOF1/SOF2 marker 尺寸（宽高 + 精度 + 分量数）
 * - gifSizeRead：读 GIF 逻辑屏幕尺寸 + 列举各帧尺寸
 *
 * 说明：
 * - 零外发：纯本地字节计算。
 * - PNG CRC32 用标准 IEEE 802.3 多项式 0xEDB88320。
 * - 字节序：PNG/JPEG 大端，GIF 小端。
 */
import { register } from "./registry.js";

// ============================================================
// base64 ↔ bytes 工具
// ============================================================
function b64ToBytes(s) {
  const bin = atob(s.replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(b) {
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin);
}

// 读大端/小端
const u32be = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u16be = (b, o) => ((b[o] << 8) | b[o + 1]) >>> 0;
const u16le = (b, o) => (b[o] | (b[o + 1] << 8)) >>> 0;
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x1000000)) >>> 0;

// 写大端 u32
function setU32be(b, o, v) {
  b[o] = (v >>> 24) & 0xFF;
  b[o + 1] = (v >>> 16) & 0xFF;
  b[o + 2] = (v >>> 8) & 0xFF;
  b[o + 3] = v & 0xFF;
}

// ============================================================
// CRC32（PNG chunk 校验，多项式 0xEDB88320）
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
// PNG 宽高读取 / 篡改检测 / 爆破恢复
// ============================================================
const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

function isPng(buf) {
  for (let k = 0; k < PNG_SIG.length; k++) if (buf[k] !== PNG_SIG[k]) return false;
  return true;
}

// 读 PNG 宽高（IHDR 固定坐标：宽 offset 16-19，高 offset 20-23）
function readPngSize(buf) {
  return { width: u32be(buf, 16), height: u32be(buf, 20) };
}

// 检测 IHDR CRC 篡改：stored CRC (offset 29-32) vs calc CRC (覆盖 type+data = offset 12-28)
function isPngTampered(buf) {
  const stored = u32be(buf, 29);
  const calc = crc32(buf, 12, 29); // 'IHDR'(4) + IHDR_data(13) = 17 字节
  return stored !== calc;
}

/**
 * 爆破恢复真实宽高。
 * 策略：1) 只爆高度（宽度真实，CTF 90% 场景，O(N) 秒出）
 * 2) 只爆宽度
 * 3) 双爆兜底（慢）
 * @param {Uint8Array} buf PNG 字节
 * @param {number} MAX 爆破上限（默认 8192）
 * @returns {{width,height,mode}|null}
 */
function recoverPngSize(buf, MAX = 8192) {
  const stored = u32be(buf, 29);
  const rest = buf.slice(24, 29); // 5 字节尾部属性：bitdepth/colortype/comp/filter/interlace
 // 构造 IHDR type+data 共 17 字节
  const build = (w, h) => {
    const d = new Uint8Array(17);
    d[0] = 0x49; d[1] = 0x48; d[2] = 0x44; d[3] = 0x52; // 'IHDR'
    d[4] = (w >>> 24) & 0xFF; d[5] = (w >>> 16) & 0xFF; d[6] = (w >>> 8) & 0xFF; d[7] = w & 0xFF;
    d[8] = (h >>> 24) & 0xFF; d[9] = (h >>> 16) & 0xFF; d[10] = (h >>> 8) & 0xFF; d[11] = h & 0xFF;
    d.set(rest, 12);
    return d;
  };
  const curW = u32be(buf, 16);
  const curH = u32be(buf, 20);
 // 1) 只爆高度
  for (let h = 1; h <= MAX; h++) {
    if (crc32(build(curW, h)) === stored) return { width: curW, height: h, mode: "height-only" };
  }
 // 2) 只爆宽度
  for (let w = 1; w <= MAX; w++) {
    if (crc32(build(w, curH)) === stored) return { width: w, height: curH, mode: "width-only" };
  }
 // 3) 双爆兜底
  for (let h = 1; h <= MAX; h++) {
    for (let w = 1; w <= MAX; w++) {
      if (crc32(build(w, h)) === stored) return { width: w, height: h, mode: "both" };
    }
  }
  return null;
}

// 把恢复的宽高写回 buf（CRC 本就匹配，不用改 CRC）
function applyPngSize(buf, width, height) {
  const out = new Uint8Array(buf);
  setU32be(out, 16, width);
  setU32be(out, 20, height);
  return out;
}

// ============================================================
// BMP 宽高修复（无 CRC，靠像素数据量反推）
// BITMAPINFOHEADER：offset 10=数据偏移(u32le)，14=头大小，18=宽(i32le)，
// 22=高(i32le)，28=位深(u16le)，34=图像数据字节数(u32le，可能为0)。
// 修复思路：可用像素字节数 = min(声明 sizeImage, 文件尾-dataOff)，
// 每行 rowSize=floor((bpp*W+31)/32)*4，枚举 W 使 avail % rowSize == 0，
// 得 H=avail/rowSize。CTF 改 BMP 宽高藏图常见。
// ============================================================
function isBmp(buf) {
  return buf && buf.length >= 26 && buf[0] === 0x42 && buf[1] === 0x4D; // "BM"
}
function readBmpSize(buf) {
  return {
    width: _i32le(buf, 18),
    height: _i32le(buf, 22),
    bpp: u16le(buf, 28),
    dataOff: u32le(buf, 10),
  };
}
function _i32le(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x1000000)) | 0; }
function bmpRowSize(bpp, w) { return Math.floor((bpp * w + 31) / 32) * 4; }
/**
 * BMP 宽高一致性检测 + 恢复。
 * 优先保持声明宽度爆高度、保持声明高度爆宽度，再枚举宽度整除兜底。
 * @returns {{width,height,mode}|null}
 */
function recoverBmpSize(buf, MAX = 20000) {
  const bpp = u16le(buf, 28);
  const dataOff = u32le(buf, 10);
  if (bpp !== 24 && bpp !== 32 && bpp !== 8) return null;
  const avail = buf.length - dataOff;
  if (avail <= 0) return null;
  const curW = _i32le(buf, 18);
  const curH = Math.abs(_i32le(buf, 22));
  // 1) 保持声明宽度，算高度
  if (curW > 0) {
    const rs = bmpRowSize(bpp, curW);
    if (rs > 0 && avail % rs === 0) {
      const h = avail / rs;
      if (h >= 1 && (h !== curH || curW !== _i32le(buf, 18))) return { width: curW, height: h, mode: "height-only" };
    }
  }
  // 2) 保持声明高度，算宽度
  if (curH > 0) {
    for (let w = 1; w <= MAX; w++) {
      if (bmpRowSize(bpp, w) * curH === avail) return { width: w, height: curH, mode: "width-only" };
    }
  }
  // 3) 枚举宽度，凡整除即候选（返回首个「近方形」解，最贴近真实图）
  let best = null, bestDiff = Infinity;
  for (let w = 1; w <= MAX; w++) {
    const rs = bmpRowSize(bpp, w);
    if (avail % rs === 0) {
      const h = avail / rs;
      if (h < 1 || h > MAX) continue;
      const diff = Math.abs(w - h);
      if (diff < bestDiff) { bestDiff = diff; best = { width: w, height: h, mode: "both" }; }
    }
  }
  return best;
}
function applyBmpSize(buf, width, height) {
  const out = new Uint8Array(buf);
  const setI32le = (o, v) => { out[o] = v & 0xFF; out[o + 1] = (v >>> 8) & 0xFF; out[o + 2] = (v >>> 16) & 0xFF; out[o + 3] = (v >>> 24) & 0xFF; };
  setI32le(18, width);
  setI32le(22, height);
  return out;
}
function formatBmpRecoverReport(buf) {
  if (!isBmp(buf)) return "非 BMP 文件（签名非 BM）。";
  const cur = readBmpSize(buf);
  const lines = [];
  lines.push(`当前宽高: ${cur.width} × ${cur.height}（位深 ${cur.bpp}）`);
  const avail = buf.length - cur.dataOff;
  const declaredRow = cur.width > 0 ? bmpRowSize(cur.bpp, cur.width) : 0;
  const consistent = declaredRow > 0 && avail % declaredRow === 0 && avail / declaredRow === Math.abs(cur.height);
  lines.push(`像素数据: ${avail} 字节（数据偏移 ${cur.dataOff}）`);
  if (consistent) {
    lines.push("宽高与像素数据量一致，无需修复。");
    return lines.join("\n");
  }
  lines.push("宽高与像素数据量不一致（可能被篡改）。\n开始反推真实宽高...");
  const r = recoverBmpSize(buf);
  if (!r) {
    lines.push("反推失败：未找到能整除像素数据量的宽高组合（或位深不支持，仅 8/24/32）。");
    return lines.join("\n");
  }
  lines.push(`恢复成功 [模式: ${r.mode}]：真实宽高 = ${r.width} × ${r.height}`);
  const fixed = applyBmpSize(buf, r.width, r.height);
  lines.push(`\n修复后 base64（已写回宽高）：`);
  lines.push(bytesToB64(fixed));
  return lines.join("\n");
}

// ============================================================
// JPEG SOF 尺寸读取
// SOF0=FFC0, SOF1=FFC1, SOF2=FFC2, SOF3=FFC3（ progressives）
// 段结构: FF Cn | 2字节段长 | 1字节精度 | 2字节高度 | 2字节宽度 | 1字节分量数 ...
// ============================================================
const SOF_MARKERS = [0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF];
const SOF_NAMES = {
  0xC0: "SOF0 (基线)", 0xC1: "SOF1 (扩展顺序)", 0xC2: "SOF2 (渐进)",
  0xC3: "SOF3 (无损)", 0xC5: "SOF5", 0xC6: "SOF6", 0xC7: "SOF7",
  0xC9: "SOF9", 0xCA: "SOF10", 0xCB: "SOF11", 0xCD: "SOF13", 0xCE: "SOF14", 0xCF: "SOF15",
};

function readJpegSize(buf) {
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return null; // SOI
  const results = [];
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const marker = buf[i + 1];
 // SOS 开始 = 熵编码，停止
    if (marker === 0xDA) break;
 // SOF marker
    if (SOF_MARKERS.includes(marker)) {
      if (i + 10 > buf.length) break; // 需读到 buf[i+9]（分量数），故边界 +10
      const segLen = u16be(buf, i + 2);
      const precision = buf[i + 4];
      const height = u16be(buf, i + 5);
      const width = u16be(buf, i + 7);
      const components = buf[i + 9];
      results.push({ marker: "FF" + marker.toString(16).toUpperCase().padStart(2, "0"), name: SOF_NAMES[marker] || "SOF", precision, height, width, components, offset: i });
      i += 2 + segLen;
      continue;
    }
 // 其他 marker 段（有段长）：跳过
    if (marker >= 0xC0 && marker !== 0xFF && marker !== 0x00 && marker !== 0xD8 && marker !== 0xD9) {
      if (i + 4 > buf.length) break;
      const segLen = u16be(buf, i + 2);
      i += 2 + segLen;
      continue;
    }
    i++;
  }
  return results;
}

// ============================================================
// GIF 尺寸读取
// 逻辑屏幕：offset 6-7 宽，8-9 高（小端 2 字节）
// 图像描述符 0x2C 后 +5 宽 +7 高
// ============================================================
function readGifSize(buf) {
  const sig = String.fromCharCode(buf[0], buf[1], buf[2]);
  const ver = String.fromCharCode(buf[3], buf[4], buf[5]);
  if (sig !== "GIF") return null;
  const screenW = u16le(buf, 6);
  const screenH = u16le(buf, 8);
  const frames = [];
  let i = 10;
 // 跳过全局色彩表。GIF 逻辑屏幕描述符紧跟 sig+ver(6B)：width(2)+height(2)+packed(1)+bgcolor(1)+pixelaspect(1)
 // 故 packed 位在 offset 10（sig6 + width2 + height2）。
  const packed = buf[10];
  const hasGlobal = (packed & 0x80) !== 0;
  const globalSize = hasGlobal ? 3 * (1 << ((packed & 0x07) + 1)) : 0;
  i = 13 + globalSize;
  while (i < buf.length) {
    const b = buf[i];
    if (b === 0x3B) break; // trailer
    if (b === 0x21) { // 扩展块
      i += 2; // 0x21 + label
      while (i < buf.length && buf[i] !== 0x00) { i += 1 + buf[i]; } // sub-blocks
      i++; // 终止子 0x00
      continue;
    }
    if (b === 0x2C) { // 图像描述符
      if (i + 9 > buf.length) break;
      const left = u16le(buf, i + 1);
      const top = u16le(buf, i + 3);
      const w = u16le(buf, i + 5);
      const h = u16le(buf, i + 7);
      frames.push({ left, top, width: w, height: h });
      i += 9;
 // 跳过局部色彩表
      const localPacked = buf[i - 1];
      const hasLocal = (localPacked & 0x80) !== 0;
      const localSize = hasLocal ? 3 * (1 << ((localPacked & 0x07) + 1)) : 0;
      i += localSize;
 // LZW 最小码长 1 字节 + 数据 sub-blocks
      i++; // LZW min code size
      while (i < buf.length && buf[i] !== 0x00) { i += 1 + buf[i]; }
      i++; // 0x00 终止
      continue;
    }
    i++;
  }
  return { version: sig + ver, screenWidth: screenW, screenHeight: screenH, frames };
}

// ============================================================
// 文本报告格式化
// ============================================================
function formatPngRecoverReport(buf) {
  if (!isPng(buf)) return "非 PNG 文件（签名不符）。";
  const lines = [];
  const cur = readPngSize(buf);
  const tampered = isPngTampered(buf);
  const stored = u32be(buf, 29).toString(16).padStart(8, "0");
  const calc = crc32(buf, 12, 29).toString(16).padStart(8, "0");
  lines.push(`当前宽高: ${cur.width} × ${cur.height}`);
  lines.push(`IHDR CRC32: 存=${stored} / 算=${calc} ${tampered ? "（不符，宽高可能被篡改）" : "（校验通过，宽高未被篡改）"}`);
  if (!tampered) {
    lines.push("宽高未被篡改，无需爆破恢复。");
    return lines.join("\n");
  }
  lines.push("\n开始爆破恢复真实宽高（先只爆高度，再爆宽度，最后双爆兜底）...");
  const r = recoverPngSize(buf);
  if (!r) {
    lines.push("爆破失败：在 1..8192 范围内未找到匹配 CRC 的宽高组合。");
    return lines.join("\n");
  }
  lines.push(`恢复成功 [模式: ${r.mode}]：真实宽高 = ${r.width} × ${r.height}`);
  const fixed = applyPngSize(buf, r.width, r.height);
  lines.push(`\n修复后 base64（已写回真实宽高，CRC 匹配）：`);
  lines.push(bytesToB64(fixed));
  return lines.join("\n");
}

function formatJpegSizeReport(buf) {
  if (buf[0] !== 0xFF || buf[1] !== 0xD8) return "非 JPEG 文件（无 SOI FFD8）。";
  const results = readJpegSize(buf);
  if (!results || results.length === 0) return "未找到 SOF marker（可能 JPEG 结构异常或被截断）。";
  const lines = [`找到 ${results.length} 个 SOF marker：`];
  for (const r of results) {
    lines.push(`  @ 偏移 ${r.offset} (0x${r.offset.toString(16)}) — ${r.marker} ${r.name}`);
    lines.push(`    精度=${r.precision}bit, 高=${r.height}, 宽=${r.width}, 分量数=${r.components}`);
  }
  return lines.join("\n");
}

function formatGifSizeReport(buf) {
  const r = readGifSize(buf);
  if (!r) return "非 GIF 文件（签名非 GIF）。";
  const lines = [];
  lines.push(`版本: ${r.version}`);
  lines.push(`逻辑屏幕尺寸: ${r.screenWidth} × ${r.screenHeight}`);
  if (r.frames.length > 0) {
    lines.push(`\n图像帧数: ${r.frames.length}`);
    for (let i = 0; i < r.frames.length; i++) {
      const f = r.frames[i];
      lines.push(`  [帧 ${i + 1}] 位置=(${f.left},${f.top}) 尺寸=${f.width}×${f.height}`);
    }
  }
  return lines.join("\n");
}

// ============================================================
// register 注册
// ============================================================

// PNG 宽高爆破恢复
register({
  id: "pngSizeRecover",
  cat: "forensic",
  name: "PNG 宽高爆破恢复",
  desc: "检测 PNG IHDR CRC 篡改 + 爆破恢复真实宽高（CTF 改高度藏图经典；先只爆高度 O(N) 秒出，再爆宽度，最后双爆兜底；输出修复后 base64）",
  params: [],
  run: (text, p) => {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：真字节优先，跳过 base64 文本解析。
    const buf = (p && p.rawBytes && p.rawBytes.length)
      ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
      : b64ToBytes(text);
    return formatPngRecoverReport(buf);
  },
  acceptsBytes: true,
});

// BMP 宽高修复（无 CRC，靠像素数据量反推）
register({
  id: "bmpSizeRecover",
  cat: "forensic",
  name: "BMP 宽高修复",
  desc: "检测 BMP 宽高与像素数据量不一致 + 反推真实宽高（BMP 无 CRC，用像素字节数整除 rowSize 反推；CTF 改 BMP 宽高藏图；输出修复后 base64）",
  params: [],
  run: (text, p) => {
    const buf = (p && p.rawBytes && p.rawBytes.length)
      ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
      : b64ToBytes(text);
    return formatBmpRecoverReport(buf);
  },
  acceptsBytes: true,
});

// C7-C14 合并：jpegSizeRead/gifSizeRead 已被 imageStructUnified（analysis「图像结构分析(归一)」）
// 完整覆盖——它用同一 readJpegSize/readGifSize，输出字段一致且是超集。此处删 register
// 函数 readJpegSize/readGifSize + formatJpegSizeReport/formatGifSizeReport 保留（imageStructUnified
// 仍 import）。pngSizeRecover 不删：唯一产出「修复后 base64」，imageStructUnified 只给宽高文字建议。

export { isPng, readPngSize, isPngTampered, recoverPngSize, applyPngSize, readJpegSize, readGifSize, crc32 };
