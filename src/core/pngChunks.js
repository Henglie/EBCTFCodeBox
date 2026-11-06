/*
 * pngChunks.js — PNG 逐块 CRC 校验 + 文本块提取 + 原块/PLTE/索引流导出（被 fileAnalysis.js import）。
 *
 * PNG 块信息：遍历所有 chunk（IHDR/IDAT/tEXt/iTXt/zTXt/IEND…）
 * 列类型/长度/CRC 通过与否（CRC 错 = 可能藏数据）；tEXt/iTXt/zTXt 文本内容提取（常藏 flag）。
 *
 * 复用 stegoImage2.js 的 pngCheckSig/pngParseChunks（不复制块遍历逻辑）。CRC32 本地自算。
 * zTXt/iTXt 压缩文本用仓库内纯 JS inflate（pcapDeep.js inflateRaw，RFC 1951），
 * 不再依赖可选 globalThis.pako（未随包时曾静默降级为「仅标注」）。
 * 零外发；纯字节解析，不经 canvas。
 *
 * 导出：
 *   pngChunkCrcReport(bytes) → {sig,chunks:[{type,len,crcOk,storedCrc,calcCrc}],texts:[{type,kw,val}],anyCrcFail} | null
 *   pngChunkRawExport(bytes) → {chunks:[{type,len,offset,raw}], plte, trns, indexStream, ihdr} | null
 *     raw = 整块原字节（长度+类型+数据+CRC，逐字节保留）；
 *     indexStream = 调色板图（色彩类型 3）unfilter 后的逐行索引位流（W3C PNG §9：过滤单位 1 字节）。
 */
import { pngCheckSig, pngParseChunks } from "./stegoImage2.js";
import { inflateRaw } from "./pcapDeep.js";
import { crc32 as _crc32Std } from "./formatTable.js";

// CRC32（PNG chunk 校验，多项式 0xEDB88320）：等价收敛——统一走声明式格式表的 crc32（ISO 3309 / ITU-T V.42）
function _crc32(bytes, start, end) {
  return _crc32Std(bytes.subarray(start, end));
}
function _u32be(b, o) { return ((b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])) >>> 0; }
function _latin1(b, s, e) { let r = ""; for (let i = s; i < e; i++) r += String.fromCharCode(b[i]); return r; }
function _hex4(n) { return (n >>> 0).toString(16).padStart(8, "0"); }

// zlib 流解压（RFC 1950）：校验 2 字节头（CM=8 且 CMF/FLG 为 31 的倍数），
// 剥头部 2 字节与尾 adler32 4 字节后走仓库内 inflateRaw（同 compress.js/stegoPixels.js 范式）。
function _inflateZlib(zb) {
  if (!zb || zb.length < 6) throw new Error("zlib 数据过短");
  const cmf = zb[0], flg = zb[1];
  if ((cmf & 0x0f) !== 8) throw new Error("zlib CM≠8（压缩方法非法）");
  if (((cmf << 8) | flg) % 31 !== 0) throw new Error("zlib 头校验失败（CMF/FLG 非 31 倍数）");
  return inflateRaw(zb.subarray(2, zb.length - 4));
}

// 从文本块 chunk 提取关键字/值（tEXt 明文；zTXt/iTXt 压缩文本经仓库内 inflate 解出）
function _extractText(bytes, c) {
  const d = bytes.subarray(c.dataOff, c.dataOff + c.len);
  const nul = d.indexOf(0);
  if (c.type === "tEXt") {
    const kw = nul >= 0 ? _latin1(d, 0, nul) : _latin1(d, 0, d.length);
    const val = nul >= 0 ? _latin1(d, nul + 1, d.length) : "";
    return { type: "tEXt", kw, val };
  }
  if (c.type === "zTXt") {
    const kw = nul >= 0 ? _latin1(d, 0, nul) : "";
    const comp = nul >= 0 ? d.subarray(nul + 2) : new Uint8Array(0);
    let val = null;
    try { val = new TextDecoder("utf-8", { fatal: false }).decode(_inflateZlib(comp)); } catch (e) { /* 压缩流损坏 → 仅标注 */ }
    return { type: "zTXt", kw, val: val !== null ? val : `(zlib 压缩 ${comp.length} 字节，解压失败)` };
  }
  if (c.type === "iTXt") {
    const kw = nul >= 0 ? _latin1(d, 0, nul) : "";
    let val = "";
    if (nul >= 0) {
      const compFlag = d[nul + 1];
      let i = nul + 3;
      const nul2 = d.indexOf(0, i); i = nul2 >= 0 ? nul2 + 1 : i;
      const nul3 = d.indexOf(0, i);
      const textStart = nul3 >= 0 ? nul3 + 1 : i;
      const raw = d.subarray(textStart);
      if (compFlag === 0) val = new TextDecoder("utf-8", { fatal: false }).decode(raw);
      else {
        let dec = null;
        try { dec = new TextDecoder("utf-8", { fatal: false }).decode(_inflateZlib(raw)); } catch (e) { /* 损坏 → 仅标注 */ }
        val = dec !== null ? dec : `(zlib 压缩 ${raw.length} 字节，解压失败)`;
      }
    }
    return { type: "iTXt", kw, val };
  }
  return null;
}

// 可打印 ASCII 串（≥min 个连续字符）：暴露越界块里的明文片段。
function _asciiRuns(b, min = 4) {
  const out = [];
  let cur = "";
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c >= 0x20 && c < 0x7F) cur += String.fromCharCode(c);
    else { if (cur.length >= min) out.push(cur); cur = ""; }
  }
  if (cur.length >= min) out.push(cur);
  return out;
}
function _findSeq(b, s) {
  const m = Array.from(s, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i + m.length <= b.length; i++) {
    for (let k = 0; k < m.length; k++) if (b[i + k] !== m[k]) continue outer;
    return i;
  }
  return -1;
}
function _hexBytes(b, n) {
  let s = "";
  const end = Math.min(b.length, n);
  for (let i = 0; i < end; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

/** PNG 逐块 CRC 校验 + 文本提取。非 PNG 返回 null。
 *  lenInvalid=true 表示块声明长度超出文件剩余字节（伪造块 / 尾部隐藏数据）：
 *  此时 dataLen 为文件里真实可用的字节数，hiddenHex/hiddenText 暴露块内明文，
 *  hasIend 表示真实 IEND 被该块长度吞入。 */
function pngChunkCrcReport(bytes) {
  if (!pngCheckSig(bytes)) return null;
  const chunks = pngParseChunks(bytes);
  const out = [];
  const texts = [];
  let anyCrcFail = false;
  for (const c of chunks) {
    const crcPos = c.dataOff + c.len;
    const lenInvalid = c.lenInvalid === true || crcPos + 4 > bytes.length;
    let storedCrc = null, calcCrc = null, crcOk = null;
    if (crcPos + 4 <= bytes.length) {
      storedCrc = _u32be(bytes, crcPos);
 // CRC 覆盖 type(4) + data(len)
      calcCrc = _crc32(bytes, c.totalOff + 4, c.totalOff + 8 + c.len);
      crcOk = storedCrc === calcCrc;
      if (!crcOk) anyCrcFail = true;
    }
    const dataLen = Math.min(c.len, Math.max(0, bytes.length - c.dataOff));
    const item = { type: c.type, len: c.len, offset: c.totalOff, crcOk, storedCrc, calcCrc, lenInvalid, dataLen };
    if (lenInvalid) {
      const d = bytes.subarray(c.dataOff, c.dataOff + dataLen);
      item.hiddenHex = _hexBytes(d, 64);
      item.hiddenText = _asciiRuns(d).join(" | ");
      item.hasIend = _findSeq(d, "IEND") >= 0;
    }
    out.push(item);
    if (c.type === "tEXt" || c.type === "zTXt" || c.type === "iTXt") {
      const t = _extractText(bytes, c);
      if (t) texts.push(t);
    }
  }
  return { chunks: out, texts, anyCrcFail, hasLenInvalid: out.some((c) => c.lenInvalid), hex4: _hex4 };
}

// ============================================================
// 原块 / PLTE / 索引位流导出
// ============================================================
function _paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
}

/**
 * 调色板图（色彩类型 3）索引位流：IDAT 拼接 → zlib 解压 → 逐行 unfilter（bpp=1）→ 去过滤字节。
 * 返回 Uint8Array（每行 w*bitDepth/8 字节打包索引），非调色板图返回 null。
 * IDAT 任意分块（含单字节/空 IDAT）不影响：拼接后再解压（W3C PNG：IDAT 是一条连续流）。
 */
function pngIndexStream(bytes, ihdrInfo) {
  const { width, height, bitDepth, colorType } = ihdrInfo;
  if (colorType !== 3) return null;
  const chunks = pngParseChunks(bytes);
  let zs = [];
  for (const c of chunks) if (c.type === "IDAT") zs.push(bytes.subarray(c.dataOff, c.dataOff + c.len));
  const total = zs.reduce((n, z) => n + z.length, 0);
  const zbuf = new Uint8Array(total);
  let o = 0;
  for (const z of zs) { zbuf.set(z, o); o += z.length; }
  const raw = _inflateZlib(zbuf);
  const rowBytes = Math.max(1, Math.ceil((width * bitDepth) / 8));
  if (raw.length < height * (rowBytes + 1)) throw new Error(`IDAT 解压后 ${raw.length} 字节 < 期望 ${height * (rowBytes + 1)}（每行含 1 过滤字节）——数据损坏或参数不符`);
  const out = new Uint8Array(height * rowBytes);
  const prev = new Uint8Array(rowBytes);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (rowBytes + 1)];
    const src = raw.subarray(y * (rowBytes + 1) + 1, (y + 1) * (rowBytes + 1));
    const dst = out.subarray(y * rowBytes, (y + 1) * rowBytes);
    for (let x = 0; x < rowBytes; x++) {
      const a = x > 0 ? dst[x - 1] : 0, b = prev[x], cc = x > 0 ? prev[x - 1] : 0;
      let v = src[x];
      if (f === 1) v = (v + a) & 0xff;
      else if (f === 2) v = (v + b) & 0xff;
      else if (f === 3) v = (v + ((a + b) >> 1)) & 0xff;
      else if (f === 4) v = (v + _paeth(a, b, cc)) & 0xff;
      else if (f !== 0) throw new Error("非法过滤类型 " + f + "（行 " + y + "）");
      dst[x] = v;
    }
    prev.set(dst);
  }
  return out;
}

/**
 * 原块逐字节导出 + PLTE/tRNS + 调色板索引位流。非 PNG 返回 null。
 * chunks[].raw 含 长度(4)+类型(4)+数据(len)+CRC(4) 整块原字节，逐字节保留。
 */
function pngChunkRawExport(bytes) {
  if (!pngCheckSig(bytes)) return null;
  const chunks = pngParseChunks(bytes);
  const ihdr = chunks.find((c) => c.type === "IHDR");
  let ihdrInfo = null;
  if (ihdr && ihdr.len >= 13) {
    ihdrInfo = {
      width: _u32be(bytes, ihdr.dataOff), height: _u32be(bytes, ihdr.dataOff + 4),
      bitDepth: bytes[ihdr.dataOff + 8], colorType: bytes[ihdr.dataOff + 9],
      compression: bytes[ihdr.dataOff + 10], filter: bytes[ihdr.dataOff + 11], interlace: bytes[ihdr.dataOff + 12],
    };
  }
  const out = [];
  let plte = null, trns = null;
  for (const c of chunks) {
    const totalLen = Math.min(c.len + 12, bytes.length - c.totalOff);
    out.push({ type: c.type, len: c.len, offset: c.totalOff, raw: bytes.slice(c.totalOff, c.totalOff + totalLen) });
    if (c.type === "PLTE") plte = { count: Math.floor(c.len / 3), bytes: bytes.slice(c.dataOff, c.dataOff + c.len) };
    if (c.type === "tRNS") trns = { count: c.len, bytes: bytes.slice(c.dataOff, c.dataOff + c.len) };
  }
  let indexStream = null, indexError = null;
  if (ihdrInfo && ihdrInfo.colorType === 3 && ihdrInfo.interlace === 0) {
    try { indexStream = pngIndexStream(bytes, ihdrInfo); } catch (e) { indexError = (e && e.message) || String(e); }
  }
  return { chunks: out, plte, trns, indexStream, indexError, ihdr: ihdrInfo };
}

export { pngChunkCrcReport, pngChunkRawExport, pngIndexStream, _inflateZlib };
