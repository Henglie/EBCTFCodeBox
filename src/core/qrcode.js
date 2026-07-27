/*
 * qrcode.js — 二维码 / 条码组（T58，cat:'stego'）。
 *
 * 收录：
 * qrGen QR 码生成（encode 输出矩阵 JSON）：数字/字母/字节模式 + L/M/Q/H 纠错
 * qrParse QR 结构解析（run）：版本/掩码/纠错级识别（解析 ASCII art 矩阵）
 * barcodeIdentify 条码类型判定（run）：QR/Aztec/DataMatrix/PDF417 结构识别 + 1D 条码判定
 *
 * 红线：
 * - 只新建 qrcode.js，不碰任何现有 core/*.js。
 * - 纯算法生成矩阵（0/1 二维数组），渲染交 UI。
 * - 不引 CDN/npm 运行时，全部本地计算。
 *
 * 契约：register({id, cat:"stego", name, desc, params, encode?, run?})。
 * 生成类 encode(text, p) → JSON 字符串（矩阵 + 元信息）；
 * 识别类 run(text, p) → 文本报告。
 *
 * ============================================================
 * QR 编码核心算法移植自 Project Nayuki "QR Code generator"
 * https://github.com/nayuki/QR-Code-generator
 * Copyright (c) Project Nayuki (MIT License)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind.
 *
 * 移植范围：GF(256) Reed-Solomon、分段编码、矩阵绘制、掩码+罚分、格式/版本信息。
 * 照 ISO/IEC 18004。其余（QR 结构解析、Aztec/DataMatrix magic 识别、条码判定）为本卡自研。
 * ============================================================
 */
import { register } from "./registry.js";

// ECL 索引：0=L, 1=M, 2=Q, 3=H
const ECL_NAME = ["L", "M", "Q", "H"];
const ECL_INDEX = { L: 0, M: 1, Q: 2, H: 3 };

// ============================================================
// GF(256) Reed-Solomon（生成多项式 0x11D）— 移植自 Nayuki
// ============================================================
const RS_EXP = new Uint8Array(256);
const RS_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    RS_EXP[i] = x;
    RS_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11D;
  }
  RS_EXP[255] = RS_EXP[0];
})();

function rsMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return RS_EXP[(RS_LOG[a] + RS_LOG[b]) % 255];
}

function rsDivisor(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = rsMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = rsMul(root, 2);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    for (let j = 0; j < divisor.length; j++) result[j] ^= rsMul(divisor[j], factor);
  }
  return result;
}

// ============================================================
// QR 规范表（ISO/IEC 18004）— 移植自 Nayuki
// ============================================================
// 每块纠错码字数 [ecl][version]，version 0 占位
const ECC_CODEWORDS_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 30, 30, 30, 30, 30, 30],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];
// 纠错块数 [ecl][version]
const NUM_ERROR_CORRECTION_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];
// 对齐图案中心坐标 [version]，version 0 = null
const ALIGNMENT_PATTERN_CENTERS = [
  null,
  null, [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
  [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50], [6, 30, 54],
  [6, 32, 58], [6, 34, 62], [6, 26, 46, 66], [6, 26, 48, 70], [6, 26, 50, 74],
  [6, 30, 54, 78], [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90], [6, 28, 50, 72, 94],
  [6, 26, 50, 74, 98], [6, 30, 54, 78, 102], [6, 28, 54, 80, 106], [6, 32, 58, 84, 110], [6, 30, 58, 86, 114],
  [6, 34, 62, 90, 118], [6, 26, 50, 74, 98, 122], [6, 30, 54, 78, 102, 126], [6, 26, 52, 78, 104, 130], [6, 30, 56, 82, 108, 134],
  [6, 34, 60, 86, 112, 138], [6, 30, 58, 86, 114, 142], [6, 34, 62, 90, 118, 146], [6, 30, 54, 78, 102, 126, 150], [6, 24, 50, 76, 102, 128, 154],
  [6, 28, 54, 80, 106, 132, 158], [6, 32, 58, 84, 110, 136, 162], [6, 26, 54, 82, 110, 138, 166], [6, 30, 58, 86, 114, 142, 170],
];

// 模式指示符（ISO/IEC 18004）
const MODE_NUMERIC = 0x1;
const MODE_ALPHANUMERIC = 0x2;
const MODE_BYTE = 0x4;
const ALPHANUMERIC_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";

// 字符计数指示符位宽
function getCharCountBits(mode, version) {
  const i = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  if (mode === MODE_NUMERIC) return [10, 12, 14][i];
  if (mode === MODE_ALPHANUMERIC) return [9, 11, 13][i];
  return [8, 16, 16][i]; // byte / kanji-ish
}

// 原始数据模块数（含函数图形占用位）
function getNumRawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

// 数据码字数 = 总码字 - 纠错码字
function getNumDataCodewords(version, ecl) {
  return Math.floor(getNumRawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[ecl][version] * NUM_ERROR_CORRECTION_BLOCKS[ecl][version];
}

// ============================================================
// 位缓冲
// ============================================================
class BitBuffer {
  constructor() { this.bytes = []; this.bitLen = 0; }
  appendBits(val, len) {
    if (len < 0 || len > 31) throw new Error("bit 长度非法: " + len);
    if (len > 0 && (val >>> len) !== 0) throw new Error("数值超范围: val=" + val + " len=" + len);
    for (let i = len - 1; i >= 0; i--) this.appendBit((val >>> i) & 1);
  }
  appendBit(bit) {
    if (this.bitLen % 8 === 0) this.bytes.push(0);
    if (bit) this.bytes[this.bytes.length - 1] |= 1 << (7 - (this.bitLen % 8));
    this.bitLen++;
  }
}

// ============================================================
// 模式选择 + 版本选择
// ============================================================
function pickMode(text) {
  if (text.length > 0 && /^[0-9]+$/.test(text)) return MODE_NUMERIC;
  let allAlpha = text.length > 0;
  for (const ch of text) {
    if (!ALPHANUMERIC_CHARSET.includes(ch)) { allAlpha = false; break; }
  }
  if (allAlpha) return MODE_ALPHANUMERIC;
  return MODE_BYTE;
}

function encodedBitLength(text, mode, version) {
  let bits = 4 + getCharCountBits(mode, version);
  if (mode === MODE_NUMERIC) {
    const n = text.length;
    bits += Math.floor(n / 3) * 10 + (n % 3 === 2 ? 7 : n % 3 === 1 ? 4 : 0);
  } else if (mode === MODE_ALPHANUMERIC) {
    bits += Math.floor(text.length / 2) * 11 + (text.length % 2 === 1 ? 6 : 0);
  } else {
    bits += new TextEncoder().encode(text).length * 8;
  }
  return bits;
}

function pickVersion(text, mode, ecl) {
  for (let ver = 1; ver <= 40; ver++) {
    const cap = getNumDataCodewords(ver, ecl) * 8;
    if (encodedBitLength(text, mode, ver) + 4 <= cap) return ver;
  }
  throw new Error("数据过长，无法在 QR 版本 1-40 内编码（当前 ECL=" + ECL_NAME[ecl] + "）");
}

// ============================================================
// QR 矩阵构造（移植自 Nayuki QrCode）
// ============================================================
class QrMatrix {
  constructor(version, ecl, dataCodewords, mask) {
    this.version = version;
    this.ecl = ecl;
    this.size = version * 4 + 17;
    this.modules = [];
    this.isFunction = [];
    for (let i = 0; i < this.size; i++) {
      this.modules.push(new Array(this.size).fill(false));
      this.isFunction.push(new Array(this.size).fill(false));
    }
    this.drawFunctionPatterns();
    const allCodewords = this.addEccAndInterleave(dataCodewords);
    this.drawCodewords(allCodewords);
 // 掩码选择（mask=-1 自动选罚分最低）
    if (mask < 0) {
      let minPenalty = Infinity;
      let bestMask = 0;
      for (let m = 0; m < 8; m++) {
        this.applyMask(m);
        this.drawFormatBits(m);
        const penalty = this.getPenaltyScore();
        if (penalty < minPenalty) { bestMask = m; minPenalty = penalty; }
        this.applyMask(m); // 撤销
      }
      mask = bestMask;
    }
    this.mask = mask;
    this.applyMask(mask);
    this.drawFormatBits(mask);
    this.isFunction = null; // 释放
  }

  setFunctionModule(x, y, isDark) {
    this.modules[y][x] = isDark;
    this.isFunction[y][x] = true;
  }

  drawFunctionPatterns() {
 // 三个 finder 图案
    this.drawFinderPattern(0, 0);
    this.drawFinderPattern(this.size - 7, 0);
    this.drawFinderPattern(0, this.size - 7);
 // timing
    for (let i = 8; i < this.size - 8; i++) {
      this.setFunctionModule(6, i, i % 2 === 0);
      this.setFunctionModule(i, 6, i % 2 === 0);
    }
 // alignment
    const aligns = ALIGNMENT_PATTERN_CENTERS[this.version];
    const _nAlign = aligns ? aligns.length : 0;
    for (let _ayi = 0; _ayi < _nAlign; _ayi++) {
      for (let _axi = 0; _axi < _nAlign; _axi++) {
 // 跳过与三个 finder 重叠的位置（按索引：首行首列/首行末列/末行首列）
        if ((_ayi === 0 && _axi === 0) || (_ayi === 0 && _axi === _nAlign - 1) || (_ayi === _nAlign - 1 && _axi === 0)) continue;
        this.drawAlignmentPattern(aligns[_axi], aligns[_ayi]);
      }
    }
 // 占位格式信息（最终在构造末尾按选定掩码重绘）
    this.drawFormatBits(0);
    this.drawVersion();
  }

  drawFinderPattern(topX, topY) {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const xx = topX + dx, yy = topY + dy;
        if (xx < 0 || xx >= this.size || yy < 0 || yy >= this.size) continue;
        let dark;
        if (dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6) {
          const dist = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
          dark = dist !== 2 && dist !== 4;
        } else {
          dark = false; // 分隔符
        }
        this.setFunctionModule(xx, yy, dark);
      }
    }
  }

  drawAlignmentPattern(cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const dark = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
        this.setFunctionModule(cx + dx, cy + dy, dark);
      }
    }
  }

  drawFormatBits(mask) {
    const data = (this.ecl << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412; // 15-bit
 // 第一份（左上 finder 周围）
    for (let i = 0; i <= 5; i++) this.setFunctionModule(8, i, getBit(bits, i));
    this.setFunctionModule(8, 7, getBit(bits, 6));
    this.setFunctionModule(8, 8, getBit(bits, 7));
    this.setFunctionModule(7, 8, getBit(bits, 8));
    for (let i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, getBit(bits, i));
 // 第二份（右上 + 左下）
    for (let i = 0; i < 8; i++) this.setFunctionModule(this.size - 1 - i, 8, getBit(bits, i));
    for (let i = 8; i < 15; i++) this.setFunctionModule(8, this.size - 15 + i, getBit(bits, i));
 // 固定暗模块
    this.setFunctionModule(8, this.size - 8, true);
  }

  drawVersion() {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const bits = (this.version << 12) | rem; // 18-bit
    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i);
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFunctionModule(a, b, bit);
      this.setFunctionModule(b, a, bit);
    }
  }

  addEccAndInterleave(data) {
    const ver = this.version, ecl = this.ecl;
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][ver];
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][ver];
    const rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);
    const blocks = [];
    const rsDiv = rsDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const dat = data.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      const ecc = Array.from(rsRemainder(dat, rsDiv));
      if (i < numShortBlocks) blocks.push(dat.concat([0], ecc));
      else blocks.push(dat.concat(ecc));
    }
    const result = [];
    for (let i = 0; i < blocks[0].length; i++) {
      for (let j = 0; j < blocks.length; j++) {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result.push(blocks[j][i]);
      }
    }
    return result;
  }

  drawCodewords(data) {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5; // 跳过垂直 timing
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  }

  maskCond(m, x, y) {
    switch (m) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
      case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
      case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
      default: return false;
    }
  }

  applyMask(mask) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (!this.isFunction[y][x] && this.maskCond(mask, x, y)) {
          this.modules[y][x] = !this.modules[y][x];
        }
      }
    }
  }

  getPenaltyScore() {
    const N1 = 3, N2 = 3, N3 = 40, N4 = 10;
    const size = this.size;
    let result = 0;
 // 规则 1：行/列连续同色 ≥5
    for (let y = 0; y < size; y++) {
      let runColor = false, runX = 0;
      const row = this.modules[y];
      for (let x = 0; x < size; x++) {
        if (row[x] === runColor) {
          runX++;
          if (runX === 5) result += N1;
          else if (runX > 5) result++;
        } else {
          runColor = row[x];
          runX = 1;
        }
      }
    }
    for (let x = 0; x < size; x++) {
      let runColor = false, runX = 0;
      for (let y = 0; y < size; y++) {
        if (this.modules[y][x] === runColor) {
          runX++;
          if (runX === 5) result += N1;
          else if (runX > 5) result++;
        } else {
          runColor = this.modules[y][x];
          runX = 1;
        }
      }
    }
 // 规则 2：2×2 同色块
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = this.modules[y][x];
        if (c === this.modules[y][x + 1] && c === this.modules[y + 1][x] && c === this.modules[y + 1][x + 1]) {
          result += N2;
        }
      }
    }
 // 规则 3：finder-like 模式 (1011101 + 4 浅 / 反向)
    for (let y = 0; y < size; y++) {
      for (let x = 0, bits = 0; x < size; x++) {
        bits = ((bits << 1) & 0x7FF) | (this.modules[y][x] ? 1 : 0);
        if (x >= 10 && (bits === 0x5D0 || bits === 0x05D)) result += N3;
      }
    }
    for (let x = 0; x < size; x++) {
      for (let y = 0, bits = 0; y < size; y++) {
        bits = ((bits << 1) & 0x7FF) | (this.modules[y][x] ? 1 : 0);
        if (y >= 10 && (bits === 0x5D0 || bits === 0x05D)) result += N3;
      }
    }
 // 规则 4：暗模块占比偏离 50%
    let dark = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (this.modules[y][x]) dark++;
    const k = Math.ceil((dark * 20) / (size * size)) - 10;
    result += Math.abs(k) * N4;
    return result;
  }

  toMatrix01() {
    const out = [];
    for (let y = 0; y < this.size; y++) {
      const row = [];
      for (let x = 0; x < this.size; x++) row.push(this.modules[y][x] ? 1 : 0);
      out.push(row);
    }
    return out;
  }
}

function getBit(x, i) {
  return ((x >>> i) & 1) !== 0;
}

// ============================================================
// QR 生成（对外）
// ============================================================
function qrGenerate(text, p = {}) {
  if (!text) throw new Error("输入文本为空");
  const ecl = ECL_INDEX[(p.ecl || "M").toUpperCase()] ?? 1;
  let version = Number(p.version) || 0;
  const mask = p.mask == null ? -1 : Number(p.mask);
  const mode = pickMode(text);
  if (version <= 0) version = pickVersion(text, mode, ecl);
  if (version < 1 || version > 40) throw new Error("版本非法 (1-40): " + version);

 // 编码位流
  const bb = new BitBuffer();
  bb.appendBits(mode, 4);
  const charCount = mode === MODE_BYTE
    ? new TextEncoder().encode(text).length
    : text.length;
  bb.appendBits(charCount, getCharCountBits(mode, version));
  if (mode === MODE_NUMERIC) {
    for (let i = 0; i + 3 <= text.length; i += 3) bb.appendBits(parseInt(text.substr(i, 3), 10), 10);
    const rem = text.length % 3;
    if (rem === 2) bb.appendBits(parseInt(text.substr(text.length - 2), 10), 7);
    else if (rem === 1) bb.appendBits(parseInt(text.substr(text.length - 1), 10), 4);
  } else if (mode === MODE_ALPHANUMERIC) {
    const val = (ch) => ALPHANUMERIC_CHARSET.indexOf(ch);
    for (let i = 0; i + 2 <= text.length; i += 2) bb.appendBits(val(text[i]) * 45 + val(text[i + 1]), 11);
    if (text.length % 2 === 1) bb.appendBits(val(text[text.length - 1]), 6);
  } else {
    for (const b of new TextEncoder().encode(text)) bb.appendBits(b, 8);
  }
 // 终止符
  const cap = getNumDataCodewords(version, ecl) * 8;
  bb.appendBits(0, Math.min(4, Math.max(0, cap - bb.bitLen)));
 // 对齐字节
  while (bb.bitLen % 8 !== 0) bb.appendBit(0);
 // 填充字节
  const dataCap = getNumDataCodewords(version, ecl);
  let padByte = 0xEC;
  while (bb.bytes.length < dataCap) {
    bb.bytes.push(padByte);
    padByte ^= (0xEC ^ 0x11);
  }
  const qr = new QrMatrix(version, ecl, bb.bytes, mask);
  return {
    version: qr.version,
    size: qr.size,
    ecl: ECL_NAME[qr.ecl],
    mask: qr.mask,
    mode: mode === MODE_NUMERIC ? "numeric" : mode === MODE_ALPHANUMERIC ? "alphanumeric" : "byte",
    matrix: qr.toMatrix01(),
  };
}

function qrEncodeOp(text, p = {}) {
  return JSON.stringify(qrGenerate(text, p));
}

// ============================================================
// QR 结构解析（自研）
// ============================================================
// 预生成 32 个合法格式信息码
const FORMAT_INFO_CODES = (() => {
  const arr = [];
  for (let data = 0; data < 32; data++) {
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    arr.push(((data << 10) | rem) ^ 0x5412);
  }
  return arr;
})();
// 预生成版本 7-40 合法版本信息码
const VERSION_INFO_CODES = (() => {
  const arr = [];
  for (let ver = 0; ver <= 40; ver++) {
    if (ver < 7) { arr.push(null); continue; }
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    arr.push((ver << 12) | rem);
  }
  return arr;
})();

function hammingDistance15(a, b) {
  let x = a ^ b, d = 0;
  while (x) { d += x & 1; x >>= 1; }
  return d;
}

// 从矩阵读 15 位格式信息（两份合并投票）
function readFormatInfo(mat, size) {
  const readBit = (x, y) => (mat[y] && mat[y][x] != null ? mat[y][x] : 0);
 // 第一份（位序 0..14，MSB 在前）
  const pos1 = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5],
    [8, 7], [8, 8], [7, 8],
    [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
 // 第二份
  const pos2 = [
    [size - 1, 8], [size - 2, 8], [size - 3, 8], [size - 4, 8],
    [size - 5, 8], [size - 6, 8], [size - 7, 8],
    [size - 8, 8], [8, size - 7], [8, size - 6], [8, size - 5],
    [8, size - 4], [8, size - 3], [8, size - 2], [8, size - 1],
  ];
  let bits1 = 0, bits2 = 0;
  for (let i = 0; i < 15; i++) {
    if (readBit(pos1[i][0], pos1[i][1])) bits1 |= (1 << i);
    if (readBit(pos2[i][0], pos2[i][1])) bits2 |= (1 << i);
  }
 // 找最接近的合法码（两份各自最近，取距离更小者）
  let bestData = -1, bestDist = 99;
  for (let data = 0; data < 32; data++) {
    const code = FORMAT_INFO_CODES[data];
    const d1 = hammingDistance15(bits1, code);
    const d2 = hammingDistance15(bits2, code);
    const d = Math.min(d1, d2);
    if (d < bestDist) { bestDist = d; bestData = data; }
  }
  return { ecl: bestData >> 3, mask: bestData & 7, dist: bestDist };
}

// 读版本信息（v7+），18 位
function readVersionInfo(mat, size) {
  const readBit = (x, y) => (mat[y] && mat[y][x] != null ? mat[y][x] : 0);
 // 两份：右上 (x=size-9..size-11, y=0..5)、左下 (x=0..5, y=size-9..size-11)
  let bits1 = 0, bits2 = 0;
  for (let i = 0; i < 18; i++) {
    const a = size - 11 + (i % 3), b = Math.floor(i / 3);
    if (readBit(a, b)) bits1 |= (1 << i);
    if (readBit(b, a)) bits2 |= (1 << i);
  }
  let bestVer = -1, bestDist = 99;
  for (let v = 7; v <= 40; v++) {
    const code = VERSION_INFO_CODES[v];
    let x = bits1 ^ code, d1 = 0;
    while (x) { d1 += x & 1; x >>= 1; }
    x = bits2 ^ code; let d2 = 0;
    while (x) { d2 += x & 1; x >>= 1; }
    const d = Math.min(d1, d2);
    if (d < bestDist) { bestDist = d; bestVer = v; }
  }
  return { version: bestVer, dist: bestDist };
}

// ASCII art / 0-1 矩阵 → 0/1 二维数组
function parseAsciiMatrix(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.length > 0);
  if (lines.length < 7) return null;
  const width = Math.max(...lines.map((l) => l.length));
  if (width < 7) return null;
  const DARK = new Set(["#", "1", "X", "x", "*", "█", "■", "●", "▓", "▒", "░", "M", "m", "@", "+"]);
  const LIGHT = new Set([" ", ".", "0", "_", "-"]);
  const mat = [];
  let darkCount = 0, totalCount = 0;
  for (const l of lines) {
    const row = [];
    for (let i = 0; i < width; i++) {
      const ch = i < l.length ? l[i] : " ";
      const d = DARK.has(ch) ? 1 : 0;
      row.push(d);
      if (d) darkCount++;
      totalCount++;
    }
    mat.push(row);
  }
 // 大量未识别字符 → 不像矩阵
  if (darkCount === 0 || totalCount === 0) return null;
  return { matrix: mat, width, height: lines.length };
}

// 检测 7×7 finder 图案（容忍 ≤2 个模块偏差，应对扫描噪声）
function isFinderAt(mat, topX, topY, w, h) {
  let mism = 0;
  for (let dy = 0; dy < 7; dy++) {
    for (let dx = 0; dx < 7; dx++) {
      const x = topX + dx, y = topY + dy;
      if (x >= w || y >= h) return false;
      const dist = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
      const expect = (dist !== 2 && dist !== 4) ? 1 : 0;
      if (mat[y][x] !== expect) { mism++; if (mism > 2) return false; }
    }
  }
  return true;
}

// 数 finder 图案数量（3 角各一个）
function countFinders(mat, w, h) {
  let n = 0;
  if (w >= 7 && h >= 7 && isFinderAt(mat, 0, 0, w, h)) n++;
  if (w >= 7 && h >= 7 && isFinderAt(mat, w - 7, 0, w, h)) n++;
  if (w >= 7 && h >= 7 && isFinderAt(mat, 0, h - 7, w, h)) n++;
  return n;
}

// Aztec 牛眼检测（中心同心环交替）
function detectAztec(mat, w, h) {
  const cx = Math.floor(w / 2), cy = Math.floor(h / 2);
  for (const half of [4, 5]) {
    const expect = [];
    for (let i = 0; i < half * 2 + 1; i++) expect.push(i % 2 === 0 ? 1 : 0);
    let ok = true;
    for (let i = -half; i <= half; i++) {
      const idx = i + half;
      if (cx + i < 0 || cx + i >= w || cy + i < 0 || cy + i >= h) { ok = false; break; }
      if (mat[cy][cx + i] !== expect[idx]) { ok = false; break; }
      if (mat[cy + i][cx] !== expect[idx]) { ok = false; break; }
    }
    if (ok) return half === 4 ? "compact" : "full";
  }
  return null;
}

// DataMatrix L 型 finder 检测（左列+下行实线，上行/右列交替时钟轨）
function detectDataMatrix(mat, w, h) {
  if (w < 8 || h < 8) return false;
  let leftSolid = true, bottomSolid = true;
  for (let y = 0; y < h && leftSolid; y++) if (mat[y][0] !== 1) leftSolid = false;
  for (let x = 0; x < w && bottomSolid; x++) if (mat[h - 1][x] !== 1) bottomSolid = false;
  if (!leftSolid || !bottomSolid) return false;
  let topAlt = true, rightAlt = true;
  for (let x = 0; x < w; x++) if (mat[0][x] !== (x % 2 === 0 ? 1 : 0)) { topAlt = false; break; }
  for (let y = 0; y < h; y++) if (mat[y][w - 1] !== (y % 2 === 0 ? 1 : 0)) { rightAlt = false; break; }
  return topAlt || rightAlt;
}

// QR 结构解析（对外 run）
function qrParseOp(text) {
  const parsed = parseAsciiMatrix(text);
  if (!parsed) throw new Error("无法解析为矩阵（需 ASCII art 或 0/1 行矩阵，至少 7×7）");
  const { matrix: mat, width: w, height: h } = parsed;
  const lines = [];
  lines.push("QR 码结构解析");
  lines.push("矩阵尺寸: " + w + " × " + h);
  const finders = countFinders(mat, w, h);
  const isSquare = w === h;
  const sizeOk = isSquare && (w - 17) % 4 === 0 && w >= 21 && w <= 177;
  lines.push("finder 图案: " + finders + " 个" + (finders === 3 ? " ✓" : "（QR 需 3 个）"));
  if (!isSquare || !sizeOk || finders < 3) {
    lines.push("判定: 非 QR 码（尺寸或 finder 不符）");
    const az = detectAztec(mat, w, h);
    if (az) lines.push("提示: 检测到 Aztec 牛眼 (" + az + ")");
    if (detectDataMatrix(mat, w, h)) lines.push("提示: 检测到 DataMatrix L 型 finder");
    return lines.join("\n");
  }
  const version = (w - 17) / 4;
  lines.push("版本: " + version);
  if (version >= 7) {
    const vi = readVersionInfo(mat, w);
    if (vi.version === version && vi.dist <= 3) lines.push("版本信息校验: 通过 (dist=" + vi.dist + ")");
    else lines.push("版本信息校验: 不一致 (读出 v" + vi.version + ", dist=" + vi.dist + "，可能损坏)");
  }
  const fi = readFormatInfo(mat, w);
  if (fi.ecl >= 0 && fi.ecl <= 3) {
    lines.push("纠错级: " + ECL_NAME[fi.ecl] + (fi.dist === 0 ? "（格式信息精确匹配）" : "（dist=" + fi.dist + "，可能有误码）"));
    lines.push("掩码: " + fi.mask);
  } else {
    lines.push("纠错级: 无法识别");
  }
  const darkMod = mat[w - 8] && mat[w - 8][8] === 1;
  lines.push("固定暗模块 (8," + (w - 8) + "): " + (darkMod ? "✓" : "✗"));
  lines.push("判定: QR Code（版本 " + version + "，" + w + "×" + w + "）");
  return lines.join("\n");
}

// ============================================================
// 条码类型判定（自研）
// ============================================================
const CODE39_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%";
const CODABAR_CHARS = "0123456789-$:/.+ABCD";

function ean13Valid(s) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += (+s[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === +s[12];
}
function ean8Valid(s) {
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += (+s[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === +s[7];
}
function upcaValid(s) {
  let sum = 0;
  for (let i = 0; i < 11; i++) sum += (+s[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === +s[11];
}
function itf14Valid(s) {
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += (+s[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === +s[13];
}
function isbn10Valid(s) {
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += (+s[i]) * (10 - i);
  const last = s[9] === "X" ? 10 : +s[9];
  sum += last;
  return sum % 11 === 0;
}

function identify1D(text) {
  const t = text.trim();
  const digits = t.replace(/[^0-9]/g, "");
  const out = [];
  if (/^[0-9]+$/.test(digits) && digits.length >= 5) {
    if (digits.length === 8) out.push("EAN-8" + (ean8Valid(digits) ? "（校验通过）" : "（校验不符）"));
    if (digits.length === 12) out.push("UPC-A" + (upcaValid(digits) ? "（校验通过）" : "（校验不符）"));
    if (digits.length === 13) out.push("EAN-13 / ISBN-13" + (ean13Valid(digits) ? "（校验通过）" : "（校验不符）"));
    if (digits.length === 14) out.push("ITF-14 / EAN-14" + (itf14Valid(digits) ? "（校验通过）" : "（校验不符）"));
    if (digits.length === 5) out.push("EAN-5 附加码");
    if (digits.length === 2) out.push("EAN-2 附加码");
  }
 // Code39 / Codabar / Code128 字符集启发式
  const up = t.toUpperCase();
  let c39ok = t.length > 0;
  for (const ch of up) { if (!CODE39_CHARS.includes(ch) && ch !== "*") { c39ok = false; break; } }
  if (c39ok) {
    if (/^\*.+\*$/.test(up)) out.push("Code39（含 * 起止符，字符集匹配）");
    else out.push("Code39（字符集匹配，无 * 起止符）");
  }
  let cdbarOk = t.length > 0;
  for (const ch of t.toUpperCase()) { if (!CODABAR_CHARS.includes(ch)) { cdbarOk = false; break; } }
  if (cdbarOk && /[ABCD]/.test(t.toUpperCase()) && /[0-9]/.test(t)) out.push("Codabar（字符集匹配）");
 // Code128：任意 ASCII，兜底候选
  if (!out.length && /^[\x20-\x7e]+$/.test(t) && t.length >= 4) out.push("Code128 / Code93 候选（可打印 ASCII，需结构信息进一步区分）");
  return out.length ? out : ["无法识别（既非纯数字 GS1 体系，也不匹配 Code39/Codabar 字符集）"];
}

function barcodeIdentifyOp(text) {
  const t = text.replace(/\r/g, "");
 // 先尝试矩阵（多行 + 等宽倾向）
  const parsed = parseAsciiMatrix(t);
  const lines = ["条码类型判定"];
  if (parsed && parsed.height >= 7 && parsed.width >= 7) {
    const { matrix: mat, width: w, height: h } = parsed;
    lines.push("输入解析为矩阵: " + w + " × " + h);
    const finders = countFinders(mat, w, h);
    const isSquare = w === h;
    const qrSize = isSquare && (w - 17) % 4 === 0 && w >= 21 && w <= 177;
    if (qrSize && finders === 3) {
      const ver = (w - 17) / 4;
      const fi = readFormatInfo(mat, w);
      lines.push("判定: QR Code（版本 " + ver + "，" + w + "×" + w + "，ECL=" + (fi.ecl >= 0 ? ECL_NAME[fi.ecl] : "?") + "，mask=" + fi.mask + "）");
    } else if (detectAztec(mat, w, h)) {
      lines.push("判定: Aztec Code（检测到中心牛眼 " + detectAztec(mat, w, h) + "）");
    } else if (detectDataMatrix(mat, w, h)) {
      lines.push("判定: DataMatrix（检测到 L 型 finder + 时钟轨）");
    } else if (finders > 0) {
      lines.push("判定: 疑似 QR/矩阵码（finder 数=" + finders + "，但尺寸/结构不完全吻合）");
    } else {
      lines.push("判定: 未识别的 2D 矩阵码（无 QR finder / Aztec 牛眼 / DataMatrix L-finder）");
      lines.push("提示: 可能是 PDF417 / MaxiCode / Han Xin / Micro QR 等，需进一步结构分析");
    }
    return lines.join("\n");
  }
 // 非矩阵 → 1D 条码判定
  const flat = t.replace(/\n/g, " ").trim();
  lines.push("输入为文本（非矩阵）→ 1D 条码判定");
  lines.push("候选: " + identify1D(flat).join("；"));
  return lines.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "qrGen", cat: "stego", name: "QR 码生成",
  desc: "纯 JS QR 编码（数字/字母/字节模式 + L/M/Q/H 纠错），输出 0/1 矩阵 JSON。核心移植自 Nayuki (MIT)",
  params: [
    { key: "ecl", label: "纠错级", type: "select", default: "M",
      options: [
        { value: "L", label: "L（7%）" },
        { value: "M", label: "M（15%）" },
        { value: "Q", label: "Q（25%）" },
        { value: "H", label: "H（30%）" },
      ],
    },
    { key: "version", label: "版本", type: "number", default: 0, placeholder: "0=自动，1-40 指定" },
    { key: "mask", label: "掩码", type: "number", default: -1, placeholder: "-1=自动，0-7 指定" },
  ],
  encode: qrEncodeOp,
});

register({
  id: "qrParse", cat: "stego", name: "QR 结构解析",
  desc: "解析 QR 矩阵（ASCII art / 0-1 行）：版本/掩码/纠错级识别 + finder/暗模块校验",
  params: [],
  run: qrParseOp,
});

register({
  id: "barcodeIdentify", cat: "stego", name: "条码类型判定",
  desc: "2D（QR/Aztec/DataMatrix 结构识别）+ 1D（EAN/UPC/ISBN/ITF/Code39/Codabar 校验位判定）",
  params: [],
  run: barcodeIdentifyOp,
});

export {
  qrGenerate, qrEncodeOp, qrParseOp, barcodeIdentifyOp,
  pickMode, pickVersion, getNumDataCodewords, getNumRawDataModules,
  ECL_NAME, ECL_INDEX, ALPHANUMERIC_CHARSET,
  parseAsciiMatrix, isFinderAt, countFinders, detectAztec, detectDataMatrix,
  readFormatInfo, readVersionInfo, FORMAT_INFO_CODES, VERSION_INFO_CODES,
  QrMatrix, BitBuffer, rsDivisor, rsRemainder,
};
