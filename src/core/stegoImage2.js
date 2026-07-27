/*
 * stegoImage2.js — 图像隐写扩展组（T96，cat:'stego'）。
 *
 * 依赖: stegoImage.js（查重，不碰；已有 pngText/exifExtract 等文本块读写，本文件不重复）。
 *
 * 覆盖（全部 run 单向；前 4 个返回多行文本报告，iccStrip 返回 base64）：
 * - pngChunkList : PNG 全块解析（列举所有 chunk + 解析 bKGD/tEXt/zTXt/iTXt/iCCP 内容）
 * - jpegAppList : JPEG APPn 段列举（APP0-APP15 全部段，marker/长度/标识符/摘要）
 * - gifComment : GIF 注释扩展块提取（0x21 0xFE，拼接所有 sub-block）
 * - gifFrames : GIF 多帧信息列举（图像描述符 0x2C，帧偏移/尺寸/局部色彩表/延迟）
 * - iccStrip : ICC profile 剥离（PNG iCCP chunk / JPEG APP2 ICC，返回去 ICC 后的 base64）
 *
 * 纯字节解析，不经 canvas（canvas 重编码会丢 chunk/EXIF/元数据）。
 * 输入约定：text 参数是 base64 字符串（可为 dataURL 前缀形式），UI 层 app.js 适配。
 *
 * 红线：格式规范照 PNG/JPEG/GIF 官方规范实现，不编造；chunk/段解析逐字节对齐。
 * 参考资料：PNG (ISO/IEC 15948), JPEG (ITU-T T.81), GIF89a (W3C gif89a spec)。
 */
import { register } from "./registry.js";

// ============ 通用工具（自包含，不依赖 stegoImage.js 内部函数） ============

/** base64（含 dataURL 前缀）→ Uint8Array。兼容 atob / Buffer。 */
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

/** Uint8Array → base64 字符串。兼容 btoa / Buffer。 */
function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  if (typeof btoa === "function") return btoa(bin);
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  throw new Error("无 btoa/Buffer，无法编码 base64");
}

function readU32be(bytes, off) {
  return (((bytes[off] << 24) >>> 0) + (bytes[off + 1] << 16) + (bytes[off + 2] << 8) + bytes[off + 3]) >>> 0;
}
function readU16be(bytes, off) {
  return ((bytes[off] << 8) + bytes[off + 1]) >>> 0;
}
function readU16le(bytes, off) {
  return ((bytes[off + 1] << 8) + bytes[off]) >>> 0;
}
function setU32be(arr, off, val) {
  arr[off] = (val >>> 24) & 0xFF;
  arr[off + 1] = (val >>> 16) & 0xFF;
  arr[off + 2] = (val >>> 8) & 0xFF;
  arr[off + 3] = val & 0xFF;
}
function latin1(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
function utf8(bytes) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
function hex(bytes, max) {
  const n = Math.min(bytes.length, max == null ? bytes.length : max);
  let s = "";
  for (let i = 0; i < n; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

// CRC32（PNG chunk 校验，多项式 0xEDB88320）
const _crc32Table = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes, start, end) {
  let c = 0xFFFFFFFF;
  for (let i = start; i < end; i++) c = _crc32Table[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ============ PNG 全块解析 ============
const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
function pngCheckSig(bytes) {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) return false;
  return true;
}
/** 返回 [{type, len, dataOff, totalOff}]，到 IEND 为止（含 IEND）。 */
function pngParseChunks(bytes) {
  const chunks = [];
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = readU32be(bytes, off);
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    const dataOff = off + 8;
    chunks.push({ type, len, dataOff, totalOff: off });
    if (type === "IEND") break;
    off = dataOff + len + 4; // data + crc
    if (off > bytes.length) break; // 防越界
  }
  return chunks;
}

/**
 * pngChunkList run：列举 PNG 所有 chunk，解析文本块/bKGD/iCCP 内容。
 * @param {string} text base64 PNG
 * @returns {string} 多行报告
 */
function pngChunkListRun(text, p) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : b64ToBytes(text);
  if (!pngCheckSig(bytes)) throw new Error("非 PNG 文件（签名不匹配）");
  const chunks = pngParseChunks(bytes);
  const lines = [];
  lines.push(`PNG chunk 列表（共 ${chunks.length} 个）`);
  lines.push(`文件大小: ${bytes.length} 字节`);
  lines.push("");

 // IHDR 解析（第一块必为 IHDR）
  const ihdr = chunks.find((c) => c.type === "IHDR");
  if (ihdr && ihdr.len >= 13) {
    const w = readU32be(bytes, ihdr.dataOff);
    const h = readU32be(bytes, ihdr.dataOff + 4);
    const bitDepth = bytes[ihdr.dataOff + 8];
    const colorType = bytes[ihdr.dataOff + 9];
    const ctName = { 0: "灰度", 2: "RGB", 3: "索引", 4: "灰度+Alpha", 6: "RGBA" }[colorType] || `未知(${colorType})`;
    lines.push(`IHDR: ${w}×${h}, 位深=${bitDepth}, 色彩类型=${colorType}(${ctName})`);
    lines.push("");
  }

  for (const c of chunks) {
    lines.push(`[${c.type}] 偏移=${c.totalOff} 数据长度=${c.len}`);
    const data = bytes.subarray(c.dataOff, c.dataOff + c.len);

    if (c.type === "tEXt") {
      const nul = data.indexOf(0);
      const kw = nul >= 0 ? latin1(data.subarray(0, nul)) : latin1(data);
      const val = nul >= 0 ? latin1(data.subarray(nul + 1)) : "";
      lines.push(`  tEXt: "${kw}" = "${val}"`);
    } else if (c.type === "zTXt") {
      const nul = data.indexOf(0);
      const kw = nul >= 0 ? latin1(data.subarray(0, nul)) : "";
      const method = nul >= 0 ? data[nul + 1] : 0;
      const comp = nul >= 0 ? data.subarray(nul + 2) : new Uint8Array(0);
      let val = null;
      if (typeof globalThis !== "undefined" && globalThis.pako && globalThis.pako.inflate) {
        try { val = utf8(globalThis.pako.inflate(comp)); } catch (e) { val = null; }
      }
      if (val !== null) lines.push(`  zTXt: "${kw}" = "${val}"`);
      else lines.push(`  zTXt: "${kw}" = (zlib 压缩，方法=${method}，${comp.length} 字节；hex 前32: ${hex(comp, 32)})`);
    } else if (c.type === "iTXt") {
      const nul1 = data.indexOf(0);
      const kw = nul1 >= 0 ? latin1(data.subarray(0, nul1)) : "";
      let val = "";
      if (nul1 >= 0) {
        const compFlag = data[nul1 + 1];
        const compMethod = data[nul1 + 2];
        let i = nul1 + 3;
        const nul2 = data.indexOf(0, i); // 语言标签结束
        i = nul2 >= 0 ? nul2 + 1 : i;
        const nul3 = data.indexOf(0, i); // 翻译关键字结束
        const textStart = nul3 >= 0 ? nul3 + 1 : i;
        const raw = data.subarray(textStart);
        if (compFlag === 0) val = utf8(raw);
        else {
          let dec = null;
          if (typeof globalThis !== "undefined" && globalThis.pako && globalThis.pako.inflate) {
            try { dec = utf8(globalThis.pako.inflate(raw)); } catch (e) {}
          }
          val = dec !== null ? dec : `(zlib 压缩，${raw.length} 字节；需 pako)`;
        }
      }
      lines.push(`  iTXt: "${kw}" = "${val}"`);
    } else if (c.type === "bKGD") {
 // bKGD 内容取决于 IHDR 色彩类型
      let desc = "";
      if (ihdr) {
        const colorType = bytes[ihdr.dataOff + 9];
        if (colorType === 0 || colorType === 4) {
 // 灰度: 2 字节
          desc = `灰度背景 = ${readU16be(data, 0)}`;
        } else if (colorType === 2 || colorType === 6) {
 // RGB: 6 字节
          desc = `RGB 背景 = (${readU16be(data, 0)}, ${readU16be(data, 2)}, ${readU16be(data, 4)})`;
        } else if (colorType === 3) {
 // 索引: 1 字节
          desc = `调色板索引 = ${data[0]}`;
        }
      }
      lines.push(`  bKGD: ${desc}`);
    } else if (c.type === "iCCP") {
      const nul = data.indexOf(0);
      const kw = nul >= 0 ? latin1(data.subarray(0, nul)) : "";
      const method = nul >= 0 ? data[nul + 1] : 0;
      const comp = nul >= 0 ? data.subarray(nul + 2) : new Uint8Array(0);
      lines.push(`  iCCP: 名称="${kw}", 压缩方法=${method}, profile 压缩数据=${comp.length} 字节`);
    } else if (c.type === "pHYs") {
      if (c.len >= 9) {
        const x = readU32be(data, 0);
        const y = readU32be(data, 4);
        const unit = data[8];
        const unitName = unit === 1 ? "米" : "未知";
        lines.push(`  pHYs: ${x}×${y} 像素/单位, 单位=${unitName}`);
      }
    } else if (c.type === "tIME") {
      if (c.len >= 7) {
        const y = readU16be(data, 0);
        lines.push(`  tIME: ${y}-${data[2]}-${data[3]} ${data[4]}:${data[5]}:${data[6]}`);
      }
    } else if (c.type === "PLTE") {
      lines.push(`  PLTE: ${Math.floor(c.len / 3)} 个调色板项`);
    } else if (c.type === "sPLT") {
      lines.push(`  sPLT: 建议调色板（${c.len} 字节）`);
    } else if (c.type === "sBIT") {
      lines.push(`  sBIT: 显著位（${c.len} 字节）`);
    } else if (c.type === "cHRM") {
      if (c.len >= 32) {
        lines.push(`  cHRM: 白点=(${readU32be(data, 0)}, ${readU32be(data, 4)}), 红=(${readU32be(data, 8)}, ${readU32be(data, 12)}), 绿=(${readU32be(data, 16)}, ${readU32be(data, 20)}), 蓝=(${readU32be(data, 24)}, ${readU32be(data, 28)})`);
      }
    } else if (c.type === "gAMA") {
      if (c.len >= 4) lines.push(`  gAMA: gamma = ${readU32be(data, 0)}`);
    } else if (c.type === "sRGB") {
      if (c.len >= 1) {
        const intent = ["感知", "相对色度", "饱和度", "绝对色度"][data[0]] || `未知(${data[0]})`;
        lines.push(`  sRGB: 渲染意图 = ${intent}`);
      }
    } else if (c.type === "IDAT") {
      lines.push(`  IDAT: 图像数据（${c.len} 字节，zlib 压缩）`);
    } else if (c.type === "IEND") {
      lines.push(`  IEND: 文件结束标记`);
    } else {
 // 未知/辅助 chunk：hex 前 32 字节
      lines.push(`  hex 前32: ${hex(data, 32)}`);
    }
  }

 // ICC 检测
  const hasIccp = chunks.some((c) => c.type === "iCCP");
  if (hasIccp) lines.push("", "⚠ 检测到 iCCP chunk（ICC profile），可用 iccStrip op 剥离");

  return lines.join("\n");
}

// ============ JPEG APPn 段列举 ============
const JPEG_APP_NAMES = {
  0xE0: "APP0 (通常 JFIF)",
  0xE1: "APP1 (通常 EXIF/XMP)",
  0xE2: "APP2 (通常 ICC profile)",
  0xE3: "APP3",
  0xE4: "APP4",
  0xE5: "APP5",
  0xE6: "APP6",
  0xE7: "APP7",
  0xE8: "APP8",
  0xE9: "APP9",
  0xEA: "APP10",
  0xEB: "APP11",
  0xEC: "APP12 (通常 Picture Info)",
  0xED: "APP13 (通常 Photoshop/Adobe)",
  0xEE: "APP14 (通常 Adobe)",
  0xEF: "APP15",
};

/**
 * jpegAppList run：列举 JPEG 所有标记段（APP0-APP15 + 其他常见 marker）。
 * @param {string} text base64 JPEG
 * @returns {string} 多行报告
 */
function jpegAppListRun(text, p) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : b64ToBytes(text);
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
    throw new Error("非 JPEG 文件（缺 FFD8 SOI）");
  }
  const lines = [];
  lines.push(`JPEG 段列举（文件大小 ${bytes.length} 字节）`);
  lines.push("SOI: FFD8（图像起始）");
  lines.push("");

  let i = 2;
  let appCount = 0;
  let reachedSOS = false;
  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xFF) { i++; continue; }
 // 跳过填充 FF
    let marker = bytes[i + 1];
    while (marker === 0xFF && i + 2 < bytes.length) { i++; marker = bytes[i + 1]; }
    if (marker === 0x00) { i += 2; continue; } // 填充
    if (marker === 0xD9) { lines.push("EOI: FFD9（图像结束）"); break; } // EOI
    if (marker === 0xDA) { // SOS：扫描数据开始
      lines.push(`FFDA SOS: 扫描数据起始（后续为熵编码数据，不再解析段）`);
      reachedSOS = true;
      break;
    }
 // standalone markers（无长度段）：RSTn (D0-D7), TEM (01)
    if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) {
      i += 2;
      continue;
    }
 // 段 marker：读 2 字节长度
    if (i + 3 >= bytes.length) break;
    const segLen = readU16be(bytes, i + 2);
    if (segLen < 2) { lines.push(`FF${marker.toString(16).toUpperCase().padStart(2, "0")}: 段长度异常 ${segLen}`); break; }
    const dataStart = i + 4;
    const dataEnd = i + 2 + segLen;
    const data = bytes.subarray(dataStart, dataEnd);

    const isApp = (marker >= 0xE0 && marker <= 0xEF);
    const appLabel = JPEG_APP_NAMES[marker] || `FF${marker.toString(16).toUpperCase().padStart(2, "0")}`;

    if (isApp) {
      appCount++;
 // 读标识符（null 结尾 ASCII）
      const nul = data.indexOf(0);
      const ident = nul >= 0 ? latin1(data.subarray(0, nul)) : latin1(data.subarray(0, Math.min(data.length, 20)));
      lines.push(`[${appLabel}] 偏移=${i} 段长=${segLen} 标识符="${ident}"`);
 // 特定段补充信息
      if (marker === 0xE0 && ident === "JFIF") {
 // JFIF: 版本(2) + units(1) + Xdensity(2) + Ydensity(2) + Xthumbnail(1) + Ythumbnail(1)
        if (data.length >= 14) {
          const major = data[5];
          const minor = data[6];
          const units = data[7];
          const xdens = readU16be(data, 8);
          const ydens = readU16be(data, 10);
          const xthumb = data[12];
          const ythumb = data[13];
          const unitName = ["无单位(纵横比)", "DPI(英寸)", "DPCM(厘米)"][units] || `未知(${units})`;
          lines.push(`  JFIF 版本=${major}.${minor}, 密度=${xdens}×${ydens} ${unitName}, 缩略图=${xthumb}×${ythumb}`);
        }
      } else if (marker === 0xE1 && (ident === "Exif" || ident === "Exif\0\0".slice(0, 4))) {
        lines.push(`  EXIF 数据段（${segLen - 8} 字节 TIFF 数据，可用 exifExtract op 详查）`);
      } else if (marker === 0xE1 && ident === "http://ns.adobe.com/xap/1./") {
        lines.push(`  XMP 数据段（${segLen - 2 - ident.length - 1} 字节 RDF/XML）`);
      } else if (marker === 0xE2 && ident === "ICC_PROFILE") {
 // ICC: 标识符后跟 chunk_index(1) + num_chunks(1)
        if (data.length >= ident.length + 3) {
          const idx = data[ident.length + 1];
          const num = data[ident.length + 2];
          lines.push(`  ICC profile 分块 ${idx}/${num}（${segLen - 2 - ident.length - 1 - 2} 字节）`);
        }
      } else if (marker === 0xED && ident === "Photoshop 3.0") {
        lines.push(`  Adobe Photoshop 资源段（8BIM，${segLen - 2 - ident.length - 1} 字节）`);
      }
    } else if (marker === 0xDB) {
      lines.push(`FFDB DQT: 量化表定义（段长=${segLen}）`);
    } else if (marker === 0xC0 || marker === 0xC2) {
 // SOF0/SOF1/SOF2: 帧信息
      const sofName = { 0xC0: "SOF0(基线)", 0xC1: "SOF1(扩展顺序)", 0xC2: "SOF2(渐进)", 0xC3: "SOF3(无损)" }[marker] || `SOF(${marker.toString(16)})`;
      if (data.length >= 8) {
        const prec = data[1];
        const h = readU16be(data, 2);
        const w = readU16be(data, 4);
        const comps = data[6];
        lines.push(`FF${marker.toString(16).toUpperCase().padStart(2, "0")} ${sofName}: ${w}×${h}, 精度=${prec}位, 分量=${comps}`);
      }
    } else if (marker === 0xC4) {
      lines.push(`FFC4 DHT: Huffman 表定义（段长=${segLen}）`);
    } else if (marker === 0xDD) {
      lines.push(`FFDD DRI: 重启间隔=${segLen >= 4 ? readU16be(data, 2) : "?"}`);
    } else if (marker === 0xFE) {
 // COM 注释段
      const comment = latin1(data.subarray(0, Math.min(data.length, 200)));
      lines.push(`FFFE COM: 注释（${segLen - 2} 字节）= "${comment}"`);
    } else {
      lines.push(`FF${marker.toString(16).toUpperCase().padStart(2, "0")} 段长=${segLen}`);
    }
    i = dataEnd;
    if (i > bytes.length) break;
  }
  if (!reachedSOS) {
 // 未到 SOS 就退出
  }
  lines.push("");
  lines.push(`APPn 段总数: ${appCount}`);
  return lines.join("\n");
}

// ============ GIF 注释扩展块提取 ============
const GIF_SIG87 = "GIF87a";
const GIF_SIG89 = "GIF89a";

function gifCheckSig(bytes) {
  if (bytes.length < 6) return false;
  const sig = latin1(bytes.subarray(0, 6));
  return sig === GIF_SIG87 || sig === GIF_SIG89;
}

/** 读 GIF sub-block 序列，返回拼接后的 Uint8Array。传入 position（指向首个 sub-block 长度字节）。返回 {data, nextPos}。 */
function gifReadSubBlocks(bytes, pos) {
  const parts = [];
  while (pos < bytes.length) {
    const len = bytes[pos++];
    if (len === 0) break; // 0 表示结束
    if (pos + len > bytes.length) {
      parts.push(bytes.subarray(pos, bytes.length));
      pos = bytes.length;
      break;
    }
    parts.push(bytes.subarray(pos, pos + len));
    pos += len;
  }
 // 拼接
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return { data: out, nextPos: pos };
}

/**
 * gifComment run：提取 GIF 注释扩展块（0x21 0xFE）。
 * @param {string} text base64 GIF
 * @returns {string} 多行报告
 */
function gifCommentRun(text, p) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : b64ToBytes(text);
  if (!gifCheckSig(bytes)) throw new Error("非 GIF 文件（签名非 GIF87a/GIF89a）");
  const lines = [];
  lines.push(`GIF 注释扩展块提取（文件大小 ${bytes.length} 字节）`);
  const sig = latin1(bytes.subarray(0, 6));
  lines.push(`版本: ${sig}`);
  lines.push("");

  let pos = 6;
 // 跳过逻辑屏描述符（7 字节）
  if (pos + 7 > bytes.length) return lines.concat(["(文件过短)"]).join("\n");
  const screenW = readU16le(bytes, pos);
  const screenH = readU16le(bytes, pos + 2);
  const packed = bytes[pos + 4];
  const globalColorTableFlag = (packed & 0x80) !== 0;
  const gctSize = globalColorTableFlag ? 3 * (1 << ((packed & 0x07) + 1)) : 0;
  lines.push(`逻辑屏: ${screenW}×${screenH}, 全局色彩表=${globalColorTableFlag ? `是(${gctSize / 3} 项)` : "否"}`);
  pos += 7;
  if (globalColorTableFlag) pos += gctSize;

  const comments = [];
  let frameCount = 0;
  let blockCount = 0;

  while (pos < bytes.length) {
    const introducer = bytes[pos];
    if (introducer === 0x3B) { // Trailer
      lines.push(`Trailer (0x3B): 文件结束`);
      break;
    } else if (introducer === 0x2C) { // 图像描述符
      frameCount++;
      pos += 10; // 0x2C + left(2) + top(2) + w(2) + h(2) + packed(1)
 // 局部色彩表
      if (pos > bytes.length) break;
      const lctPacked = bytes[pos - 1];
      if ((lctPacked & 0x80) !== 0) {
        const lctSize = 3 * (1 << ((lctPacked & 0x07) + 1));
        pos += lctSize;
      }
 // LZW 最小码长(1) + sub-blocks（图像数据）
      if (pos >= bytes.length) break;
      pos++; // LZW min code size
      const res = gifReadSubBlocks(bytes, pos);
      pos = res.nextPos;
      blockCount++;
    } else if (introducer === 0x21) { // 扩展引入
      if (pos + 1 >= bytes.length) break;
      const label = bytes[pos + 1];
      pos += 2;
      if (label === 0xFE) { // 注释扩展
        const res = gifReadSubBlocks(bytes, pos);
        const commentText = latin1(res.data);
        comments.push(commentText);
        pos = res.nextPos;
      } else if (label === 0xF9) { // 图形控制扩展
 // 块大小固定 4
        if (pos < bytes.length && bytes[pos] === 4) {
          pos += 1 + 4; // block size + data
 // 0 终止
          if (pos < bytes.length && bytes[pos] === 0) pos++;
        } else {
          const res = gifReadSubBlocks(bytes, pos);
          pos = res.nextPos;
        }
      } else if (label === 0xFF) { // 应用扩展
        const res = gifReadSubBlocks(bytes, pos);
        pos = res.nextPos;
        blockCount++;
      } else if (label === 0x01) { // 纯文本扩展
        const res = gifReadSubBlocks(bytes, pos);
        pos = res.nextPos;
      } else { // 其他扩展
        const res = gifReadSubBlocks(bytes, pos);
        pos = res.nextPos;
      }
    } else {
      pos++; // 未知字节，跳过
    }
  }

  lines.push(`帧数: ${frameCount}, 数据块数: ${blockCount}`);
  lines.push("");
  if (comments.length === 0) {
    lines.push("(无注释扩展块 0x21 0xFE)");
  } else {
    lines.push(`注释扩展块 ${comments.length} 个:`);
    comments.forEach((c, idx) => {
      const preview = c.length > 200 ? c.slice(0, 200) + `...(+${c.length - 200} 字节)` : c;
      lines.push(`  [注释 ${idx + 1}] (${c.length} 字节): "${preview}"`);
    });
  }
  return lines.join("\n");
}

// ============ GIF 多帧提取 ============
/**
 * gifFrames run：列举 GIF 多帧信息（图像描述符 0x2C）。
 * @param {string} text base64 GIF
 * @returns {string} 多行报告
 */
function gifFramesRun(text, p) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : b64ToBytes(text);
  if (!gifCheckSig(bytes)) throw new Error("非 GIF 文件（签名非 GIF87a/GIF89a）");
  const lines = [];
  lines.push(`GIF 多帧信息（文件大小 ${bytes.length} 字节）`);
  const sig = latin1(bytes.subarray(0, 6));
  lines.push(`版本: ${sig}`);
  lines.push("");

  let pos = 6;
  if (pos + 7 > bytes.length) return lines.concat(["(文件过短)"]).join("\n");
  const screenW = readU16le(bytes, pos);
  const screenH = readU16le(bytes, pos + 2);
  const packed = bytes[pos + 4];
  const globalColorTableFlag = (packed & 0x80) !== 0;
  const gctSize = globalColorTableFlag ? 3 * (1 << ((packed & 0x07) + 1)) : 0;
  lines.push(`逻辑屏: ${screenW}×${screenH}`);
  pos += 7;
  if (globalColorTableFlag) pos += gctSize;

  const frames = [];
  let pendingDelay = 0;
  let pendingDispose = 0;
  let pendingTransIdx = -1;

  while (pos < bytes.length) {
    const introducer = bytes[pos];
    if (introducer === 0x3B) break; // Trailer
    if (introducer === 0x2C) { // 图像描述符
      if (pos + 10 > bytes.length) break;
      const left = readU16le(bytes, pos + 1);
      const top = readU16le(bytes, pos + 3);
      const w = readU16le(bytes, pos + 5);
      const h = readU16le(bytes, pos + 7);
      const lctPacked = bytes[pos + 9];
      const lctFlag = (lctPacked & 0x80) !== 0;
      const interlace = (lctPacked & 0x40) !== 0;
      const lctSize = lctFlag ? 3 * (1 << ((lctPacked & 0x07) + 1)) : 0;
      frames.push({
        left, top, width: w, height: h,
        localColorTable: lctFlag,
        interlace,
        delay: pendingDelay,
        dispose: pendingDispose,
        transparentIndex: pendingTransIdx,
      });
 // 重置待定 GCE
      pendingDelay = 0;
      pendingDispose = 0;
      pendingTransIdx = -1;
      pos += 10;
      if (lctFlag) pos += lctSize;
      if (pos >= bytes.length) break;
      pos++; // LZW min code size
      const res = gifReadSubBlocks(bytes, pos);
      pos = res.nextPos;
    } else if (introducer === 0x21) {
      if (pos + 1 >= bytes.length) break;
      const label = bytes[pos + 1];
      pos += 2;
      if (label === 0xF9) { // 图形控制扩展
        if (pos < bytes.length && bytes[pos] === 4) {
          const gcePacked = bytes[pos + 1];
          pendingDispose = (gcePacked >> 2) & 0x07;
          pendingTransIdx = (gcePacked & 0x01) !== 0 ? bytes[pos + 3] : -1;
          pendingDelay = readU16le(bytes, pos + 2);
          pos += 1 + 4;
          if (pos < bytes.length && bytes[pos] === 0) pos++;
        } else {
          const res = gifReadSubBlocks(bytes, pos);
          pos = res.nextPos;
        }
      } else {
        const res = gifReadSubBlocks(bytes, pos);
        pos = res.nextPos;
      }
    } else {
      pos++;
    }
  }

  lines.push(`帧数: ${frames.length}`);
  lines.push("");
  if (frames.length === 0) {
    lines.push("(无图像帧 0x2C)");
  } else {
    const disposeNames = ["未指定", "不处置", "恢复背景", "恢复前帧"];
    frames.forEach((f, idx) => {
      lines.push(`[帧 ${idx + 1}] 位置=(${f.left},${f.top}) 尺寸=${f.width}×${f.height}`);
      lines.push(`  局部色彩表=${f.localColorTable ? "是" : "否"}, 交错=${f.interlace ? "是" : "否"}, 延迟=${f.delay}ms(1/100秒×10), 处置=${disposeNames[f.dispose] || f.dispose}, 透明索引=${f.transparentIndex >= 0 ? f.transparentIndex : "无"}`);
    });
    if (frames.length > 1) {
      const totalDelay = frames.reduce((s, f) => s + f.delay, 0);
      lines.push("");
      lines.push(`动画总延迟: ${totalDelay} × 10ms = ${totalDelay * 10}ms`);
    }
  }
  return lines.join("\n");
}

// ============ ICC profile 剥离 ============
/**
 * iccStrip run：剥离 ICC profile（PNG iCCP chunk / JPEG APP2 ICC 段），返回去 ICC 后的 base64。
 * @param {string} text base64 图像
 * @returns {string} base64（去 ICC 后）
 */
function iccStripRun(text, p) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : b64ToBytes(text);
  let result;
  let report = [];

  if (pngCheckSig(bytes)) {
 // PNG：移除 iCCP chunk（保留 sRGB/gAMA 等其他色彩信息）
    const chunks = pngParseChunks(bytes);
    const iccp = chunks.filter((c) => c.type === "iCCP");
    if (iccp.length === 0) {
      report.push("PNG: 无 iCCP chunk，无需剥离");
      return bytesToB64(bytes) + "\n[报告] PNG: 无 iCCP chunk，无需剥离";
    }
 // 构造新文件：跳过 iCCP chunk
    const out = [];
    let lastOff = 0;
    for (const c of chunks) {
      if (c.type === "iCCP") {
 // 先拷贝到 iCCP 开始前
        out.push(bytes.subarray(lastOff, c.totalOff));
        lastOff = c.totalOff + 8 + c.len + 4; // 跳过整个 iCCP chunk
        report.push(`PNG: 剥离 iCCP chunk（名称="${latin1(bytes.subarray(c.dataOff, Math.min(c.dataOff + 20, c.dataOff + c.len)).indexOf(0) >= 0 ? latin1(bytes.subarray(c.dataOff, c.dataOff + bytes.subarray(c.dataOff, c.dataOff + c.len).indexOf(0))) : "?")}", ${c.len} 字节数据）`);
      }
    }
    out.push(bytes.subarray(lastOff));
    const totalLen = out.reduce((s, b) => s + b.length, 0);
    const newBytes = new Uint8Array(totalLen);
    let off = 0;
    for (const b of out) { newBytes.set(b, off); off += b.length; }
    report.push(`PNG: ${bytes.length} → ${newBytes.length} 字节（减少 ${bytes.length - newBytes.length}）`);
    return bytesToB64(newBytes);
  }

  if (bytes.length >= 4 && bytes[0] === 0xFF && bytes[1] === 0xD8) {
 // JPEG：移除 APP2 ICC_PROFILE 段
    const out = [];
    let lastOff = 0;
    let i = 2;
    let stripped = 0;
    while (i + 1 < bytes.length) {
      if (bytes[i] !== 0xFF) { i++; continue; }
      let marker = bytes[i + 1];
      while (marker === 0xFF && i + 2 < bytes.length) { i++; marker = bytes[i + 1]; }
      if (marker === 0x00) { i += 2; continue; }
      if (marker === 0xD9) break; // EOI
      if (marker === 0xDA) break; // SOS
      if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { i += 2; continue; }
      if (i + 3 >= bytes.length) break;
      const segLen = readU16be(bytes, i + 2);
      const dataStart = i + 4;
      const dataEnd = i + 2 + segLen;
      if (marker === 0xE2) {
 // 检查是否 ICC_PROFILE
        const data = bytes.subarray(dataStart, dataEnd);
        const nul = data.indexOf(0);
        const ident = nul >= 0 ? latin1(data.subarray(0, nul)) : "";
        if (ident === "ICC_PROFILE") {
          out.push(bytes.subarray(lastOff, i));
          lastOff = dataEnd;
          stripped++;
          report.push(`JPEG: 剥离 APP2 ICC_PROFILE 段（${segLen} 字节）`);
        }
      }
      i = dataEnd;
    }
    out.push(bytes.subarray(lastOff));
    if (stripped === 0) {
      return bytesToB64(bytes) + "\n[报告] JPEG: 无 ICC_PROFILE 段，无需剥离";
    }
    const totalLen = out.reduce((s, b) => s + b.length, 0);
    const newBytes = new Uint8Array(totalLen);
    let off = 0;
    for (const b of out) { newBytes.set(b, off); off += b.length; }
    report.push(`JPEG: ${bytes.length} → ${newBytes.length} 字节（减少 ${bytes.length - newBytes.length}，剥离 ${stripped} 段）`);
    return bytesToB64(newBytes);
  }

  throw new Error("非 PNG/JPEG 文件，无法剥离 ICC");
}

// ============ register ============
register({
  id: "pngChunkList", cat: "stego", name: "PNG 全块解析",
  desc: "列举 PNG 所有 chunk（IHDR/PLTE/tEXt/zTXt/iTXt/bKGD/iCCP/IDAT/IEND 等），解析文本块与元数据",
  params: [],
  run: pngChunkListRun,
  acceptsBytes: true,
});

register({
  id: "jpegAppList", cat: "stego", name: "JPEG APPn 段列举",
  desc: "列举 JPEG 所有 APP0-APP15 段及 marker 段（SOF/DQT/DHT/COM 等），标识段内容",
  params: [],
  run: jpegAppListRun,
  acceptsBytes: true,
});

register({
  id: "gifComment", cat: "stego", name: "GIF 注释扩展",
  desc: "提取 GIF 89a 注释扩展块（0x21 0xFE），拼接所有 sub-block 文本",
  params: [],
  run: gifCommentRun,
  acceptsBytes: true,
});

register({
  id: "gifFrames", cat: "stego", name: "GIF 多帧提取",
  desc: "列举 GIF 多帧信息（图像描述符 0x2C：帧位置/尺寸/局部色彩表/延迟/处置方法/透明色）",
  params: [],
  run: gifFramesRun,
  acceptsBytes: true,
});

register({
  id: "iccStrip", cat: "stego", name: "ICC 剥离",
  desc: "剥离 ICC profile（PNG iCCP chunk / JPEG APP2 ICC_PROFILE 段），返回去 ICC 后的 base64",
  params: [],
  run: iccStripRun,
  acceptsBytes: true,
});

export {
  pngChunkListRun,
  jpegAppListRun,
  gifCommentRun,
  gifFramesRun,
  iccStripRun,
 // 工具函数导出（供测试）
  b64ToBytes,
  bytesToB64,
  pngCheckSig,
  pngParseChunks,
  gifCheckSig,
  gifReadSubBlocks,
  readU16be,
  readU16le,
  readU32be,
  latin1,
  utf8,
  hex,
};
