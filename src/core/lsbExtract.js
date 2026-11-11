/*
 * lsbExtract.js — 图像 LSB 各通道提取（被 fileAnalysis.js import）。
 *
 * CTF 图片隐写第一杀器：对 PNG/BMP 解出像素后，按多种通道排列提取每像素各通道最低位
 * 拼 bit 流 → 字节 → 可打印预览。支持 12 种通道排列 + R/G/B 单通道。
 *
 * 零外发：纯字节解析 + 自包含 DEFLATE 解压（tinf 算法移植，公开算法，无网络/无外部库）。
 * 不经 canvas（core 层零 UI 依赖）；PNG 位深 8、非隔行覆盖 CTF 绝大多数样本，其余优雅降级。
 *
 * 导出：
 * decodePngPixels(bytes) → {width,height,channels,samples,colorType,depth} | {unsupported} | null
 * decodeBmpPixels(bytes) → 同上 | null
 * extractLSB(samples, channels, arrangement, maxBytes) → Uint8Array
 * lsbReport(decoded, maxBytes) → 多行文本（排列 + 预览）
 * inflateZlib(data) → Uint8Array（供测试/复用）
 */

// ============================================================
// tiny inflate（DEFLATE 解压，tinf 算法移植，zlib 许可，零依赖）
// ============================================================
import { checkLimit, withLimit, isLimitError } from "./limitGuard.js";

const TINF_OK = 0, TINF_ERR = -3;
const MAX_INFLATE_OUT = 96 * 1024 * 1024;      // tinf 单流软输出阈值
const MAX_INFLATE_OUT_HARD = 384 * 1024 * 1024; // 确认后的单流硬上限
const MAX_COMPRESSED = 64 * 1024 * 1024;       // IDAT 拼接后的压缩数据软阈值
const MAX_COMPRESSED_HARD = 256 * 1024 * 1024; // 确认后的压缩数据硬上限
const MAX_PIXELS = 16 * 1024 * 1024;           // 解码像素软阈值
const MAX_PIXELS_HARD = 64 * 1024 * 1024;      // 确认后的像素硬上限
const MAX_INFLATE_SLACK = 1024 * 1024;         // 相对扫描线预期长度的余量
function _Tree() { this.table = new Uint16Array(16); this.trans = new Uint16Array(288); }
function _Data(src, limit, params) {
  this.s = src; this.i = 0; this.tag = 0; this.bitcount = 0;
  const hard = Math.min(limit && Number.isFinite(Number(limit)) ? Number(limit) : MAX_INFLATE_OUT_HARD, MAX_INFLATE_OUT_HARD);
  this.hard = Math.max(1, hard);
  this.soft = Math.min(MAX_INFLATE_OUT, this.hard);
  this.params = params || null;
  this.limitChecked = false;
  this.dest = new Uint8Array(Math.min(this.soft, 64 * 1024)); // Uint8Array，避免 JS 数字数组 ~8 倍放大
  this.len = 0;
  this.ltree = new _Tree(); this.dtree = new _Tree();
}
function _outEnsure(d, add) {
  if (add < 0 || d.len + add > d.hard) {
    throw new Error("inflate 输出超限（上限 " + d.hard + " 字节，疑似压缩炸弹）");
  }
  if (!d.limitChecked && d.len + add > d.soft) {
    checkLimit({
      scope: "lsbExtract.inflate",
      actual: d.len + add,
      soft: d.soft,
      hard: d.hard,
      params: d.params,
      label: "PNG 解压输出",
      unit: " 字节",
    });
    d.limitChecked = true;
  }
  const need = d.len + add;
  if (need <= d.dest.length) return;
  let cap = d.dest.length || 1;
  while (cap < need) cap = Math.min(d.hard, cap * 2);
  if (cap < need) throw new Error("inflate 输出超限（上限 " + d.hard + " 字节，疑似压缩炸弹）");
  const next = new Uint8Array(cap);
  next.set(d.dest.subarray(0, d.len));
  d.dest = next;
}
const _sltree = new _Tree(), _sdtree = new _Tree();
const _length_bits = new Uint8Array(30), _length_base = new Uint16Array(30);
const _dist_bits = new Uint8Array(30), _dist_base = new Uint16Array(30);
const _clcidx = new Uint8Array([16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]);
const _code_tree = new _Tree(), _lengths = new Uint8Array(320);

function _buildBitsBase(bits, base, delta, first) {
  let i, sum;
  for (i = 0; i < delta; ++i) bits[i] = 0;
  for (i = 0; i < 30 - delta; ++i) bits[i + delta] = (i / delta) | 0;
  for (sum = first, i = 0; i < 30; ++i) { base[i] = sum; sum += 1 << bits[i]; }
}
function _buildFixedTrees(lt, dt) {
  let i;
  for (i = 0; i < 7; ++i) lt.table[i] = 0;
  lt.table[7] = 24; lt.table[8] = 152; lt.table[9] = 112;
  for (i = 0; i < 24; ++i) lt.trans[i] = 256 + i;
  for (i = 0; i < 144; ++i) lt.trans[24 + i] = i;
  for (i = 0; i < 8; ++i) lt.trans[168 + i] = 280 + i;
  for (i = 0; i < 112; ++i) lt.trans[176 + i] = 144 + i;
  for (i = 0; i < 5; ++i) dt.table[i] = 0;
  dt.table[5] = 32;
  for (i = 0; i < 32; ++i) dt.trans[i] = i;
}
function _buildTree(t, lengths, off, num) {
  const offs = new Uint16Array(16);
  let i, sum;
  for (i = 0; i < 16; ++i) t.table[i] = 0;
  for (i = 0; i < num; ++i) t.table[lengths[off + i]]++;
  t.table[0] = 0;
  for (sum = 0, i = 0; i < 16; ++i) { offs[i] = sum; sum += t.table[i]; }
  for (i = 0; i < num; ++i) if (lengths[off + i]) t.trans[offs[lengths[off + i]]++] = i;
}
function _getbit(d) {
  if (!d.bitcount--) {
    if (d.i >= d.s.length) throw new Error("inflate 数据提前结束");
    d.tag = d.s[d.i++]; d.bitcount = 7;
  }
  const bit = d.tag & 1; d.tag >>>= 1; return bit;
}
function _readBits(d, num, base) {
  if (!num) return base;
  let val = 0;
  for (let i = 0; i < num; i++) val |= _getbit(d) << i;
  return val + base;
}
function _decodeSymbol(d, t) {
  let sum = 0, cur = 0, len = 0;
  do {
    cur = 2 * cur + _getbit(d);
    ++len;
    sum += t.table[len];
    cur -= t.table[len];
  } while (cur >= 0);
  return t.trans[sum + cur];
}
function _decodeTrees(d, lt, dt) {
  let hlit, hdist, hclen, i, num, length;
  hlit = _readBits(d, 5, 257);
  hdist = _readBits(d, 5, 1);
  hclen = _readBits(d, 4, 4);
  for (i = 0; i < 19; ++i) _lengths[i] = 0;
  for (i = 0; i < hclen; ++i) _lengths[_clcidx[i]] = _readBits(d, 3, 0);
  _buildTree(_code_tree, _lengths, 0, 19);
  for (num = 0; num < hlit + hdist;) {
    const sym = _decodeSymbol(d, _code_tree);
    switch (sym) {
      case 16: {
        const prev = _lengths[num - 1];
        for (length = _readBits(d, 2, 3); length && num < hlit + hdist; --length) _lengths[num++] = prev;
        break;
      }
      case 17:
        for (length = _readBits(d, 3, 3); length && num < hlit + hdist; --length) _lengths[num++] = 0;
        break;
      case 18:
        for (length = _readBits(d, 7, 11); length && num < hlit + hdist; --length) _lengths[num++] = 0;
        break;
      default:
        _lengths[num++] = sym;
        break;
    }
  }
  _buildTree(lt, _lengths, 0, hlit);
  _buildTree(dt, _lengths, hlit, hdist);
}
function _inflateBlockData(d, lt, dt) {
  while (1) {
    const sym0 = _decodeSymbol(d, lt);
    if (sym0 === 256) return TINF_OK;
    if (!Number.isInteger(sym0)) throw new Error("inflate 非法 Huffman 符号");
    if (sym0 < 256) { _outEnsure(d, 1); d.dest[d.len++] = sym0; continue; }
    const sym = sym0 - 257;
    if (!Number.isInteger(sym) || sym < 0 || sym >= _length_bits.length) throw new Error("inflate 非法长度码");
    const length = _readBits(d, _length_bits[sym], _length_base[sym]);
    if (!Number.isFinite(length) || length < 0) throw new Error("inflate 非法长度");
    const dist = _decodeSymbol(d, dt);
    if (!Number.isInteger(dist) || dist < 0 || dist >= _dist_bits.length) throw new Error("inflate 非法距离码");
    const offs = d.len - _readBits(d, _dist_bits[dist], _dist_base[dist]);
    if (offs < 0) throw new Error("inflate 距离越界");
    _outEnsure(d, length);
    for (let i = 0; i < length; i++) d.dest[d.len++] = d.dest[offs + i];
  }
}
function _inflateUncompressed(d) {
  d.bitcount = 0; // 丢弃当前部分字节剩余比特，对齐字节边界
  if (d.i + 4 > d.s.length) throw new Error("inflate stored 块头不足");
  const length = d.s[d.i + 1] * 256 + d.s[d.i];
  const invlength = d.s[d.i + 3] * 256 + d.s[d.i + 2];
  if (length !== (~invlength & 0xffff)) return TINF_ERR;
  d.i += 4;
  if (d.i + length > d.s.length) throw new Error("inflate stored 块数据不足");
  _outEnsure(d, length);
  for (let i = length; i; --i) d.dest[d.len++] = d.s[d.i++];
  return TINF_OK;
}
let _tinfInited = false;
function _tinfInit() {
  if (_tinfInited) return;
  _buildFixedTrees(_sltree, _sdtree);
  _buildBitsBase(_length_bits, _length_base, 4, 3);
  _buildBitsBase(_dist_bits, _dist_base, 2, 1);
  _length_bits[28] = 0; _length_base[28] = 258;
  _tinfInited = true;
}
function _uncompress(source, maxOut, params) {
  _tinfInit();
  const d = new _Data(source, maxOut, params);
  let bfinal, btype, res;
  do {
    bfinal = _getbit(d);
    btype = _readBits(d, 2, 0);
    if (btype === 0) res = _inflateUncompressed(d);
    else if (btype === 1) res = _inflateBlockData(d, _sltree, _sdtree);
    else if (btype === 2) { _decodeTrees(d, d.ltree, d.dtree); res = _inflateBlockData(d, d.ltree, d.dtree); }
    else res = TINF_ERR;
    if (res !== TINF_OK) throw new Error("inflate 解压失败");
  } while (!bfinal);
  return d.dest.slice(0, d.len);
}

/** zlib 流解压：跳 2 字节 zlib 头（CMF/FLG），DEFLATE 主体，忽略尾部 adler32。无输出预算时才优先全局 pako。 */
function inflateZlib(data, maxOut, params) {
  if (maxOut == null && typeof globalThis !== "undefined" && globalThis.pako && globalThis.pako.inflate) {
    return globalThis.pako.inflate(data);
  }
  return _uncompress(data.subarray(2), maxOut, params);
}

// ============================================================
// PNG 像素解码（自包含：解 IDAT zlib + Paeth 等反滤波）
// ============================================================
function _u32be(b, o) { return ((b[o] * 0x1000000) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3])) >>> 0; }
const _PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
function _isPng(b) {
  if (b.length < 8) return false;
  for (let i = 0; i < 8; i++) if (b[i] !== _PNG_SIG[i]) return false;
  return true;
}
// 色彩类型 → 每像素样本数
const _CT_SAMPLES = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function _paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * 解 PNG 像素为交错样本数组（每像素 channels 个样本，行主序）。
 * 返回 {width,height,channels,samples:Uint8Array,colorType,depth}；
 * 遇隔行/非 8 位/解压失败 → {unsupported:原因}；非 PNG → null。
 */
function decodePngPixels(bytes, params) {
  if (!_isPng(bytes)) return null;
  let off = 8, ihdr = null;
  const idat = [];
  while (off + 8 <= bytes.length) {
    const declared = _u32be(bytes, off);
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    const dataOff = off + 8;
    if (type === "IDAT" && declared > MAX_COMPRESSED) {
      const effective = Math.min(declared, Math.max(0, bytes.length - dataOff));
      checkLimit({
        scope: "lsbExtract.png.idatChunk",
        actual: effective,
        soft: MAX_COMPRESSED,
        hard: MAX_COMPRESSED_HARD,
        params,
        label: "PNG IDAT 压缩块",
        unit: " 字节",
      });
    }
    const len = Math.min(declared, Math.max(0, bytes.length - dataOff)); // 声明长度截到实际剩余
    if (type === "IHDR") ihdr = dataOff;
    else if (type === "IDAT") idat.push([dataOff, len]);
    else if (type === "IEND") break;
    off = dataOff + len + 4;
    if (off > bytes.length) break;
  }
  if (ihdr == null || ihdr + 13 > bytes.length) return null;
  const width = _u32be(bytes, ihdr);
  const height = _u32be(bytes, ihdr + 4);
  const depth = bytes[ihdr + 8];
  const colorType = bytes[ihdr + 9];
  const interlace = bytes[ihdr + 12];
  if (!width || !height) return { unsupported: "PNG 宽或高为 0", width, height, colorType, depth };
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels <= 0) {
    return { unsupported: `PNG 尺寸非法（${width}×${height}=${pixels} 像素）`, width, height, colorType, depth };
  }
  let limitParams = params;
  if (pixels > MAX_PIXELS) {
    checkLimit({
      scope: "lsbExtract.png.pixels",
      actual: pixels,
      soft: MAX_PIXELS,
      hard: MAX_PIXELS_HARD,
      params,
      label: `PNG 图像 ${width}×${height}`,
      unit: " 像素",
    });
    limitParams = withLimit(params, { _allowLimitOverride: true });
  }
  if (depth !== 8) return { unsupported: `位深 ${depth}（仅支持 8 位 LSB 提取）`, width, height, colorType, depth };
  if (interlace !== 0) return { unsupported: "Adam7 隔行 PNG（暂不支持像素提取）", width, height, colorType, depth };
  const channels = _CT_SAMPLES[colorType];
  if (!channels) return { unsupported: `色彩类型 ${colorType}`, width, height, colorType, depth };
  if (idat.length === 0) return { unsupported: "无 IDAT 数据", width, height, colorType, depth };

 // 拼接 IDAT
  let total = 0;
  for (const [, l] of idat) {
    total += l;
    if (total > MAX_COMPRESSED) {
      checkLimit({
        scope: "lsbExtract.png.idatTotal",
        actual: total,
        soft: MAX_COMPRESSED,
        hard: MAX_COMPRESSED_HARD,
        params: limitParams,
        label: "PNG IDAT 压缩数据",
        unit: " 字节",
      });
      limitParams = withLimit(limitParams, { _allowLimitOverride: true });
    }
  }
  const comp = new Uint8Array(total);
  let p = 0;
  for (const [o, l] of idat) { comp.set(bytes.subarray(o, o + l), p); p += l; }

  const bpp = channels; // 8 位下每样本 1 字节
  const stride = width * bpp;
  const expect = height * (stride + 1);
  let raw;
  try {
    raw = inflateZlib(comp, expect + MAX_INFLATE_SLACK, limitParams);
  } catch (e) {
    if (isLimitError(e)) throw e;
    return { unsupported: "IDAT 解压失败: " + e.message, width, height, colorType, depth };
  }

  if (raw.length < expect) return { unsupported: `解压数据不足（得 ${raw.length}，需 ${expect}）`, width, height, colorType, depth };

 // 反滤波，输出行主序交错样本
  const out = new Uint8Array(height * stride);
  let ri = 0; // raw 读指针
  for (let y = 0; y < height; y++) {
    const filter = raw[ri++];
    const rowStart = y * stride;
    const prevStart = rowStart - stride;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[ri++];
      const a = x >= bpp ? out[rowStart + x - bpp] : 0;
      const b = y > 0 ? out[prevStart + x] : 0;
      const c = (y > 0 && x >= bpp) ? out[prevStart + x - bpp] : 0;
      let v;
      switch (filter) {
        case 0: v = rawByte; break;
        case 1: v = rawByte + a; break;
        case 2: v = rawByte + b; break;
        case 3: v = rawByte + ((a + b) >> 1); break;
        case 4: v = rawByte + _paeth(a, b, c); break;
        default: return { unsupported: `未知滤波类型 ${filter}`, width, height, colorType, depth };
      }
      out[rowStart + x] = v & 0xFF;
    }
  }
  return { width, height, channels, samples: out, colorType, depth };
}

// ============================================================
// BMP 像素解码（24/32 位未压缩，最常见）
// ============================================================
function _u32le(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x1000000)) >>> 0; }
function _u16le(b, o) { return (b[o] | (b[o + 1] << 8)) >>> 0; }
function _i32le(b, o) { return _u32le(b, o) | 0; }

/** 解 BMP 为 RGB(A) 交错样本（行主序，从上到下）。仅 24/32 位未压缩。 */
function decodeBmpPixels(bytes, params) {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4D) return null;
  const dataOff = _u32le(bytes, 10);
  const headerSize = _u32le(bytes, 14);
  const width = _i32le(bytes, 18);
  let height = _i32le(bytes, 22);
  const bpp = _u16le(bytes, 28);
  const comp = _u32le(bytes, 30);
  if (comp !== 0) return { unsupported: `BMP 压缩类型 ${comp}` };
  if (bpp !== 24 && bpp !== 32) return { unsupported: `BMP 位深 ${bpp}（仅支持 24/32 位）` };
  if (!width || !height || width < 0) return { unsupported: "BMP 宽或高非法" };
  const topDown = height < 0;
  height = Math.abs(height);
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels <= 0) {
    return { unsupported: `BMP 尺寸非法（${width}×${height}=${pixels} 像素）` };
  }
  if (pixels > MAX_PIXELS) {
    checkLimit({
      scope: "lsbExtract.bmp.pixels",
      actual: pixels,
      soft: MAX_PIXELS,
      hard: MAX_PIXELS_HARD,
      params,
      label: `BMP 图像 ${width}×${height}`,
      unit: " 像素",
    });
  }
  const channels = bpp === 32 ? 4 : 3;
  const bytesPP = bpp / 8;
  const rowSize = Math.floor((bpp * width + 31) / 32) * 4; // 4 字节对齐
  if (dataOff > bytes.length) return { unsupported: `BMP 数据区起点 ${dataOff} 超出文件长度 ${bytes.length}` };
  const needBytes = (height - 1) * rowSize + width * bytesPP;
  if (!Number.isSafeInteger(needBytes) || dataOff + needBytes > bytes.length) {
    return { unsupported: `BMP 数据区越界（声明需 ${needBytes} 字节，实际可用 ${bytes.length - dataOff}）` };
  }
  const samples = new Uint8Array(width * height * channels);
  for (let y = 0; y < height; y++) {
    const srcRow = topDown ? y : (height - 1 - y); // BMP 默认自底向上
    let sp = dataOff + srcRow * rowSize;
    let dp = y * width * channels;
    for (let x = 0; x < width; x++) {
 // BMP 存 BGR(A)
      const bch = bytes[sp], gch = bytes[sp + 1], rch = bytes[sp + 2];
      samples[dp] = rch; samples[dp + 1] = gch; samples[dp + 2] = bch;
      if (channels === 4) samples[dp + 3] = bytes[sp + 3];
      sp += bytesPP; dp += channels;
    }
  }
  return { width, height, channels, samples, colorType: bpp === 32 ? 6 : 2, depth: 8 };
}

// ============================================================
// LSB 提取
// ============================================================
// 排列字符 → 通道下标；'0' 表示跳过（占位不取位）。
const _CH_IDX = { R: 0, G: 1, B: 2, A: 3 };

/**
 * 从交错样本按排列提取每像素各通道最低位，MSB-first 拼字节。
 * @param {Uint8Array} samples 行主序交错样本
 * @param {number} channels 每像素样本数
 * @param {string} arrangement 如 "RGB" / "R" / "BGR" / "RG0"（0=跳过）
 * @param {number} maxBytes 最多提取字节数
 * @returns {Uint8Array}
 */
function extractLSB(samples, channels, arrangement, maxBytes = 128) {
 // 解析排列 → 取位的通道下标序列（跳过 '0' 与越界通道）
  const seq = [];
  for (const ch of arrangement.toUpperCase()) {
    if (ch === "0") continue;
    const idx = _CH_IDX[ch];
    if (idx != null && idx < channels) seq.push(idx);
  }
  if (seq.length === 0) return new Uint8Array(0);
  const pxCount = Math.floor(samples.length / channels);
  const out = [];
  let acc = 0, nbits = 0;
  for (let px = 0; px < pxCount && out.length < maxBytes; px++) {
    const base = px * channels;
    for (const cidx of seq) {
      acc = (acc << 1) | (samples[base + cidx] & 1);
      if (++nbits === 8) { out.push(acc & 0xFF); acc = 0; nbits = 0; if (out.length >= maxBytes) break; }
    }
  }
  return Uint8Array.from(out);
}

function _previewBytes(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    s += (c >= 0x20 && c < 0x7F) ? String.fromCharCode(c) : ".";
  }
  return s;
}

// 通道排列清单：12 组合（含 0 占位） + R/G/B 单通道
const _ARRANGEMENTS = ["RGB", "BRG", "RBG", "BGR", "GRB", "GBR", "RG0", "R0B", "0GB", "R00", "0G0", "00B", "R", "G", "B"];

/**
 * 生成 LSB 各排列提取报告。
 * @param decoded decodePngPixels/decodeBmpPixels 返回值
 * @param maxBytes 每行预览字节数（默认 50）
 */
function lsbReport(decoded, maxBytes = 50) {
  if (!decoded) return null;
  if (decoded.unsupported) return { unsupported: decoded.unsupported };
  const { samples, channels, width, height } = decoded;
  const lines = [];
  for (const arr of _ARRANGEMENTS) {
 // 单通道图跳过含其它通道的排列
    const need = [...arr].filter((c) => c !== "0");
    const maxIdx = Math.max(...need.map((c) => _CH_IDX[c] ?? 0));
    if (maxIdx >= channels) continue;
    const bytes = extractLSB(samples, channels, arr, maxBytes);
    if (bytes.length === 0) continue;
    lines.push(arr + ":" + _previewBytes(bytes));
  }
  return { width, height, channels, lines };
}

export {
  decodePngPixels,
  decodeBmpPixels,
  extractLSB,
  lsbReport,
  inflateZlib,
};

