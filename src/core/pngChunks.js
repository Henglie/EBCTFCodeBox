/*
 * pngChunks.js — PNG 逐块 CRC 校验 + 文本块提取（被 fileAnalysis.js import）。
 *
 * PNG 块信息：遍历所有 chunk（IHDR/IDAT/tEXt/iTXt/zTXt/IEND…）
 * 列类型/长度/CRC 通过与否（CRC 错 = 可能藏数据）；tEXt/iTXt/zTXt 文本内容提取（常藏 flag）。
 *
 * 复用 stegoImage2.js 的 pngCheckSig/pngParseChunks（不复制块遍历逻辑）。CRC32 本地自算。
 * 零外发；纯字节解析，不经 canvas。
 *
 * 导出：pngChunkCrcReport(bytes) → {sig,chunks:[{type,len,crcOk,storedCrc,calcCrc}],texts:[{type,kw,val}],anyCrcFail} | null
 */
import { pngCheckSig, pngParseChunks } from "./stegoImage2.js";

// CRC32（PNG chunk 校验，多项式 0xEDB88320）
const _crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function _crc32(bytes, start, end) {
  let c = 0xFFFFFFFF;
  for (let i = start; i < end; i++) c = _crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function _u32be(b, o) { return ((b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])) >>> 0; }
function _latin1(b, s, e) { let r = ""; for (let i = s; i < e; i++) r += String.fromCharCode(b[i]); return r; }
function _hex4(n) { return (n >>> 0).toString(16).padStart(8, "0"); }

// 从文本块 chunk 提取关键字/值（tEXt 明文；zTXt/iTXt 压缩时仅标注）
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
    if (typeof globalThis !== "undefined" && globalThis.pako && globalThis.pako.inflate) {
      try { val = new TextDecoder("utf-8", { fatal: false }).decode(globalThis.pako.inflate(comp)); } catch (e) {}
    }
    return { type: "zTXt", kw, val: val !== null ? val : `(zlib 压缩 ${comp.length} 字节)` };
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
        if (typeof globalThis !== "undefined" && globalThis.pako && globalThis.pako.inflate) {
          try { dec = new TextDecoder("utf-8", { fatal: false }).decode(globalThis.pako.inflate(raw)); } catch (e) {}
        }
        val = dec !== null ? dec : `(zlib 压缩 ${raw.length} 字节)`;
      }
    }
    return { type: "iTXt", kw, val };
  }
  return null;
}

/** PNG 逐块 CRC 校验 + 文本提取。非 PNG 返回 null。 */
function pngChunkCrcReport(bytes) {
  if (!pngCheckSig(bytes)) return null;
  const chunks = pngParseChunks(bytes);
  const out = [];
  const texts = [];
  let anyCrcFail = false;
  for (const c of chunks) {
    const crcPos = c.dataOff + c.len;
    let storedCrc = null, calcCrc = null, crcOk = null;
    if (crcPos + 4 <= bytes.length) {
      storedCrc = _u32be(bytes, crcPos);
 // CRC 覆盖 type(4) + data(len)
      calcCrc = _crc32(bytes, c.totalOff + 4, c.totalOff + 8 + c.len);
      crcOk = storedCrc === calcCrc;
      if (!crcOk) anyCrcFail = true;
    }
    out.push({ type: c.type, len: c.len, offset: c.totalOff, crcOk, storedCrc, calcCrc });
    if (c.type === "tEXt" || c.type === "zTXt" || c.type === "iTXt") {
      const t = _extractText(bytes, c);
      if (t) texts.push(t);
    }
  }
  return { chunks: out, texts, anyCrcFail, hex4: _hex4 };
}

export { pngChunkCrcReport };
