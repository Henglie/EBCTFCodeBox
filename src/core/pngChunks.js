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
 *   pngChunkRawExport(bytes, params, selectedChunks) → {chunks:[{index,type,len,offset,raw}], plte, trns, indexStream, ihdr, selection} | null
 *     selectedChunks = 逗号分隔的块索引（0 基）/ 4 字母类型，如 "0,3,IDAT"；undefined/null = 全部块（兼容旧调用），
 *     空串/空数组 = 不导出任何块。给了选中集合时，块数/总字节预算与 PLTE/tRNS/indexStream 均只针对选中块。
 *     raw = 整块原字节（长度+类型+数据+CRC，逐字节保留）；
 *     indexStream = 调色板图（色彩类型 3）unfilter 后的逐行索引位流（W3C PNG §9：过滤单位 1 字节）。
 */
import { pngCheckSig, pngParseChunks } from "./stegoImage2.js";
import { inflateRaw } from "./pcapDeep.js";
import { crc32 as _crc32Std } from "./formatTable.js";
import { checkLimit, isLimitError } from "./limitGuard.js";

const MAX_CHUNKS = 10000;                       // 单次报告/导出遍历块数软阈值
const MAX_CHUNKS_HARD = 40000;                  // 确认后的硬上限
const MAX_EXPORT_TOTAL = 64 * 1024 * 1024;      // 原块导出总字节软阈值
const MAX_EXPORT_TOTAL_HARD = 256 * 1024 * 1024; // 确认后的硬上限
const INFLATE_SLACK = 1024 * 1024;               // 索引流解压相对扫描线预期的余量

// CRC32（PNG chunk 校验，多项式 0xEDB88320）：等价收敛——统一走声明式格式表的 crc32（ISO 3309 / ITU-T V.42）
function _crc32(bytes, start, end) {
  return _crc32Std(bytes.subarray(start, end));
}
function _u32be(b, o) { return ((b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])) >>> 0; }
function _latin1(b, s, e) { let r = ""; for (let i = s; i < e; i++) r += String.fromCharCode(b[i]); return r; }
function _hex4(n) { return (n >>> 0).toString(16).padStart(8, "0"); }

// zlib 流解压（RFC 1950）：校验 2 字节头（CM=8 且 CMF/FLG 为 31 的倍数），
// 剥头部 2 字节与尾 adler32 4 字节后走仓库内 inflateRaw（同 compress.js/stegoPixels.js 范式）。
function _inflateZlib(zb, params, maxOutput) {
  if (!zb || zb.length < 6) throw new Error("zlib 数据过短");
  const cmf = zb[0], flg = zb[1];
  if ((cmf & 0x0f) !== 8) throw new Error("zlib CM≠8（压缩方法非法）");
  if (((cmf << 8) | flg) % 31 !== 0) throw new Error("zlib 头校验失败（CMF/FLG 非 31 倍数）");
  return inflateRaw(zb.subarray(2, zb.length - 4), maxOutput, params);
}

// 从文本块 chunk 提取关键字/值（tEXt 明文；zTXt/iTXt 压缩文本经仓库内 inflate 解出）
function _extractText(bytes, c, params) {
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
    try { val = new TextDecoder("utf-8", { fatal: false }).decode(_inflateZlib(comp, params)); } catch (e) { if (isLimitError(e)) throw e; /* 压缩流损坏 → 仅标注 */ }
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
        try { dec = new TextDecoder("utf-8", { fatal: false }).decode(_inflateZlib(raw, params)); } catch (e) { if (isLimitError(e)) throw e; /* 损坏 → 仅标注 */ }
        val = dec !== null ? dec : `(zlib 压缩 ${raw.length} 字节，解压失败)`;
      }
    }
    return { type: "iTXt", kw, val };
  }
  return null;
}

// 可打印 ASCII 串（≥min 个连续字符）：暴露越界块里的明文片段。
// 报告用途，总输出上限 maxTotal，避免大 base64/尾部数据整段灌进文本区。
function _asciiRuns(b, min = 4, maxTotal = 2048) {
  const out = [];
  let cur = "", total = 0;
  const flush = () => {
    if (cur.length >= min && total < maxTotal) {
      const room = maxTotal - total;
      const s = cur.length > room ? cur.slice(0, room) : cur;
      out.push(s);
      total += s.length;
    }
    cur = "";
  };
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c >= 0x20 && c < 0x7F) {
      if (total + cur.length >= maxTotal) { flush(); break; }
      cur += String.fromCharCode(c);
    } else flush();
    if (total >= maxTotal) break;
  }
  flush();
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

/**
 * 解析块选择集合：支持逗号/空白分隔的 0 基索引或 4 字母块类型（如 "0,3,IDAT"）。
 * undefined/null → null（调用方保持旧的“全部块”语义）；空串/空数组 → {indexes:[],types:[]}（不导出）。
 * 已解析对象原样返回，便于报告层先判空再透传给导出层，避免重复解析。
 */
function parsePngChunkSelection(sel) {
  if (sel == null) return null;
  if (typeof sel === "object" && !Array.isArray(sel) &&
      Array.isArray(sel.indexes) && Array.isArray(sel.types)) return sel;
  const list = Array.isArray(sel) ? sel : String(sel).split(/[,，;；\s]+/);
  const indexes = [], types = [];
  for (const raw of list) {
    const tok = String(raw).trim();
    if (!tok) continue;
    if (/^\d+$/.test(tok)) {
      const n = Number(tok);
      if (!Number.isSafeInteger(n)) throw new Error(`selectedChunks 索引非法: ${tok}`);
      if (!indexes.includes(n)) indexes.push(n);
    } else if (/^[A-Za-z]{4}$/.test(tok)) {
      if (!types.includes(tok)) types.push(tok);
    } else {
      throw new Error(`selectedChunks 项非法: "${tok}"（支持块索引或 4 字母类型，如 0,3,IDAT）`);
    }
  }
  return { indexes, types };
}

/** 把选中集合解析为块下标：类型优先精确匹配，文件里无同大小写类型时忽略大小写。 */
function _resolveChunkSelection(chunks, selection) {
  if (!selection) return { picked: chunks.map((_, i) => i), unmatched: [] };
  const idxSet = new Set(selection.indexes);
  const unmatched = [];
  for (const n of selection.indexes) if (n >= chunks.length) unmatched.push(String(n));
  const exact = new Set(), loose = new Set();
  for (const t of selection.types) {
    if (chunks.some((c) => c.type === t)) exact.add(t);
    else if (chunks.some((c) => c.type.toLowerCase() === t.toLowerCase())) loose.add(t.toLowerCase());
    else unmatched.push(t);
  }
  const picked = [];
  for (let i = 0; i < chunks.length; i++) {
    const type = chunks[i].type;
    if (idxSet.has(i) || exact.has(type) || loose.has(type.toLowerCase())) picked.push(i);
  }
  return { picked, unmatched };
}

/** PNG 逐块 CRC 校验 + 文本提取。非 PNG 返回 null。
 *  lenInvalid=true 表示块声明长度超出文件剩余字节（伪造块 / 尾部隐藏数据）：
 *  此时 dataLen 为文件里真实可用的字节数，hiddenHex/hiddenText 暴露块内明文，
 *  hasIend 表示真实 IEND 被该块长度吞入。 */
function pngChunkCrcReport(bytes, params) {
  if (!pngCheckSig(bytes)) return null;
  const chunks = pngParseChunks(bytes);
  if (chunks.length > MAX_CHUNKS) {
    checkLimit({
      scope: "pngChunks.report.chunkCount",
      actual: chunks.length,
      soft: MAX_CHUNKS,
      hard: MAX_CHUNKS_HARD,
      params,
      label: "PNG 块数量",
      unit: " 个",
    });
  }
  const out = [];
  const texts = [];
  let anyCrcFail = false;
  for (const c of chunks) {
    if (out.length >= MAX_CHUNKS_HARD) break;
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
      const t = _extractText(bytes, c, params);
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
function pngIndexStream(bytes, ihdrInfo, params) {
  const { width, height, bitDepth, colorType } = ihdrInfo;
  if (colorType !== 3) return null;
  const chunks = pngParseChunks(bytes);
  let zs = [];
  for (const c of chunks) if (c.type === "IDAT") zs.push(bytes.subarray(c.dataOff, c.dataOff + c.len));
  const total = zs.reduce((n, z) => n + z.length, 0);
  // 预算先于拼接/解压：压缩 IDAT 与解压后的扫描线都先过统一阈值，避免先分配再确认。
  checkLimit({
    scope: "pngChunks.export.indexCompressed",
    actual: total,
    soft: MAX_EXPORT_TOTAL,
    hard: MAX_EXPORT_TOTAL_HARD,
    params,
    label: "PNG 索引流压缩数据",
    unit: " 字节",
  });
  const rowBytes = Math.max(1, Math.ceil((width * bitDepth) / 8));
  const expected = height * (rowBytes + 1);
  if (!Number.isSafeInteger(expected) || expected <= 0) throw new Error(`索引位流尺寸非法（${width}×${height}，bitDepth=${bitDepth}）`);
  checkLimit({
    scope: "pngChunks.export.indexStream",
    actual: expected,
    soft: MAX_EXPORT_TOTAL,
    hard: MAX_EXPORT_TOTAL_HARD,
    params,
    label: "PNG 索引位流导出",
    unit: " 字节",
  });
  const zbuf = new Uint8Array(total);
  let o = 0;
  for (const z of zs) { zbuf.set(z, o); o += z.length; }
  const raw = _inflateZlib(zbuf, params, expected + INFLATE_SLACK);
  if (raw.length < expected) throw new Error(`IDAT 解压后 ${raw.length} 字节 < 期望 ${expected}（每行含 1 过滤字节）——数据损坏或参数不符`);
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
 * selectedChunks：索引/类型选中集合（见 parsePngChunkSelection）；undefined/null = 全部块（旧行为）。
 * chunks[].raw 含 长度(4)+类型(4)+数据(len)+CRC(4) 整块原字节，逐字节保留。
 * 预算先于任何 slice 且只统计选中块；PLTE/tRNS 仅在对应块被选中时导出；
 * 索引位流需要全部 IDAT 块被选中，部分选中时跳过并在 indexError 说明。
 */
function pngChunkRawExport(bytes, params, selectedChunks) {
  if (!pngCheckSig(bytes)) return null;
  const chunks = pngParseChunks(bytes);
  const selection = parsePngChunkSelection(selectedChunks);
  const { picked, unmatched } = _resolveChunkSelection(chunks, selection);
  if (picked.length > MAX_CHUNKS) {
    checkLimit({
      scope: "pngChunks.export.chunkCount",
      actual: picked.length,
      soft: MAX_CHUNKS,
      hard: MAX_CHUNKS_HARD,
      params,
      label: "PNG 导出选中块数量",
      unit: " 个",
    });
  }
  const ihdr = chunks.find((c) => c.type === "IHDR");
  let ihdrInfo = null;
  if (ihdr && ihdr.len >= 13) {
    ihdrInfo = {
      width: _u32be(bytes, ihdr.dataOff), height: _u32be(bytes, ihdr.dataOff + 4),
      bitDepth: bytes[ihdr.dataOff + 8], colorType: bytes[ihdr.dataOff + 9],
      compression: bytes[ihdr.dataOff + 10], filter: bytes[ihdr.dataOff + 11], interlace: bytes[ihdr.dataOff + 12],
    };
  }
  // 统一预算先于任何 slice：只统计选中块的原块字节数，确认通过后再逐块复制。
  const exportTotal = picked.reduce((n, i) => {
    const c = chunks[i];
    const totalLen = Math.min(c.len + 12, Math.max(0, bytes.length - c.totalOff));
    return n + totalLen;
  }, 0);
  if (!Number.isSafeInteger(exportTotal) || exportTotal < 0) throw new Error("PNG 原块导出长度非法");
  checkLimit({
    scope: "pngChunks.export.totalBytes",
    actual: exportTotal,
    soft: MAX_EXPORT_TOTAL,
    hard: MAX_EXPORT_TOTAL_HARD,
    params,
    label: selection ? "PNG 原块导出（选中块）" : "PNG 原块导出",
    unit: " 字节",
  });
  const out = [];
  let plte = null, trns = null;
  let exportTruncated = false;
  for (const i of picked) {
    if (out.length >= MAX_CHUNKS_HARD) { exportTruncated = true; break; }
    const c = chunks[i];
    const totalLen = Math.min(c.len + 12, Math.max(0, bytes.length - c.totalOff));
    out.push({ index: i, type: c.type, len: c.len, offset: c.totalOff, raw: bytes.slice(c.totalOff, c.totalOff + totalLen) });
    if (c.type === "PLTE") plte = { count: Math.floor(c.len / 3), bytes: bytes.slice(c.dataOff, c.dataOff + c.len) };
    if (c.type === "tRNS") trns = { count: c.len, bytes: bytes.slice(c.dataOff, c.dataOff + c.len) };
  }
  const selectedSet = new Set(picked);
  const idatIndexes = [];
  for (let i = 0; i < chunks.length; i++) if (chunks[i].type === "IDAT") idatIndexes.push(i);
  const allIdatSelected = idatIndexes.length > 0 && idatIndexes.every((i) => selectedSet.has(i));
  let indexStream = null, indexError = null;
  if (ihdrInfo && ihdrInfo.colorType === 3 && ihdrInfo.interlace === 0) {
    if (selection && !allIdatSelected) {
      if (idatIndexes.length) {
        indexError = `索引位流需要全部 ${idatIndexes.length} 个 IDAT 块，当前仅选中 ${idatIndexes.filter((i) => selectedSet.has(i)).length} 个，已跳过`;
      }
    } else {
      try { indexStream = pngIndexStream(bytes, ihdrInfo, params); } catch (e) {
        if (isLimitError(e)) throw e;
        indexError = (e && e.message) || String(e);
      }
    }
  }
  return {
    chunks: out, plte, trns, indexStream, indexError, ihdr: ihdrInfo, exportTruncated,
    selection: selection ? {
      indexes: selection.indexes,
      types: selection.types,
      selectedCount: out.length,
      unmatched,
    } : null,
  };
}

export { pngChunkCrcReport, pngChunkRawExport, pngIndexStream, parsePngChunkSelection, _inflateZlib };
