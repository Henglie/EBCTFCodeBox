/*
 * qrdecode.js — QR 真解码组（T77，cat:'stego'）。
 *
 * 收录：
 * qrDecode QR 码解码（decode）：0/1 矩阵 → 原文（数字/字母/字节模式）
 * qrDecodeReport QR 解码诊断（run）：版本/ECL/掩码/finder/RS 纠错/分段/原文 全报告
 *
 * 算法链路（照 ISO/IEC 18004）：
 * 定位图案检测（三个 finder 角）→ 格式信息读取（ECL + 掩码）→
 * 数据模块提取（之字形扫，跳过功能图案）→ 掩码还原 →
 * RS 纠错解码（GF(256)，BM + Chien + Forney）→ 数据段解码。
 *
 * 红线：
 * - 只新建 qrdecode.js，不碰 qrcode.js 或任何现有 core/*.js。
 * - 复用 qrcode.js 已 export 的只读工具（parseAsciiMatrix/countFinders/
 * readFormatInfo/readVersionInfo/getNumDataCodewords/getNumRawDataModules/
 * ECL_NAME/ALPHANUMERIC_CHARSET），不修改它。
 * - 未 export 的 ISO 表（对齐中心 / 每块纠错码字数 / 纠错块数）在此重声明
 * 属 ISO/IEC 18004 事实数据，非版权代码。
 *
 * ============================================================
 * Reed-Solomon 解码（GF(256)，生成多项式 0x11D，根 α^0..α^{nsym-1}
 * 即 fcr=0，与 qrcode.js 编码侧 rsDivisor 的根约定一致）：
 * - 计算校正子 S_k = c(α^k)，k=0..nsym-1；
 * - Berlekamp-Massey 求错误定位多项式 Λ(x)；
 * - Chien 搜索定位错误位置；
 * - Forney 算法求错误幅值并纠正。
 * 算法本身为 ISO/IEC 18004 / 标准 RS 数学流程，本卡按规范自研实现。
 * GF/RS 编码侧参考 Project Nayuki "QR Code generator"（MIT）的同一 GF(256) 约定：
 * https://github.com/nayuki/QR-Code-generator (MIT License)
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the conditions above. THE SOFTWARE IS PROVIDED
 * "AS IS", WITHOUT WARRANTY OF ANY KIND.
 * ============================================================
 *
 * 契约：register({id, cat:"stego", name, desc, params, decode?, run?})。
 * decode(matrixText, p) → 原文字符串（输入可为 qrGen 的 JSON 或 ASCII art / 0-1 行矩阵）；
 * run(matrixText, p) → 文本诊断报告。
 */
import { register } from "./registry.js";
import {
  parseAsciiMatrix, countFinders, readFormatInfo, readVersionInfo,
  getNumDataCodewords, getNumRawDataModules,
  ECL_NAME, ALPHANUMERIC_CHARSET,
} from "./qrcode.js";

// ============================================================
// ISO/IEC 18004 事实表（与 qrcode.js 编码侧一致，此处为解码侧独立副本）
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
const MODE_KANJI = 0x8;

// 字符计数指示符位宽
function getCharCountBits(mode, version) {
  const i = version <= 9 ? 0 : version <= 26 ? 1 : 2;
  if (mode === MODE_NUMERIC) return [10, 12, 14][i];
  if (mode === MODE_ALPHANUMERIC) return [9, 11, 13][i];
  if (mode === MODE_BYTE) return [8, 16, 16][i];
  if (mode === MODE_KANJI) return [8, 10, 12][i];
  return 8;
}

// ============================================================
// GF(256) 运算（生成多项式 0x11D，与 qrcode.js 编码侧同约定）
// EXP 用 512 长度便于乘法免 mod
// ============================================================
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11D;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}
function gfInv(a) {
  if (a === 0) throw new Error("gfInv(0) 非法");
  return GF_EXP[255 - GF_LOG[a]];
}

// 多项式统一约定：低次在前（poly[0] = x^0 系数，末尾 = 最高次系数）
function gfPolyAdd(p, q) {
  const r = new Array(Math.max(p.length, q.length));
  for (let i = 0; i < r.length; i++) r[i] = (p[i] || 0) ^ (q[i] || 0);
  return r;
}
function gfPolyMul(a, b) {
  const r = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) {
      if (b[j] === 0) continue;
      r[i + j] ^= gfMul(a[i], b[j]);
    }
  }
  return r;
}
function gfPolyEval(poly, x) {
 // Horner 从高次起：y = poly[len-1]; for i=len-2..0: y = y*x ^ poly[i]
  let y = 0;
  for (let i = poly.length - 1; i >= 0; i--) y = gfMul(y, x) ^ poly[i];
  return y;
}
function gfPolyDerivative(poly) {
 // d/dx Σ poly[j] x^j = Σ j*poly[j] x^{j-1}；GF(2^m) 中 j 偶为 0，j 奇为 poly[j]
  if (poly.length <= 1) return [0];
  const r = new Array(poly.length - 1).fill(0);
  for (let j = 1; j < poly.length; j++) if (j % 2 === 1) r[j - 1] = poly[j];
  return r;
}
function gfPolyTrim(poly) {
 // 去掉高位（末尾）0
  let p = poly.slice();
  while (p.length > 1 && p[p.length - 1] === 0) p.pop();
  return p;
}

// ============================================================
// RS 解码：校正子 → BM → Chien → Forney
// 约定：码字 high-degree-first（block[0] = x^{n-1} 系数），与 qrcode.js
// rsRemainder 的处理顺序一致；故错误在 x^p 处对应 block 下标 i = n-1-p
// 错误定位子 X = α^p。
// ============================================================
// 计算校正子 S_k = c(α^k)，k=0..nsym-1（根 α^0..α^{nsym-1}，fcr=0）
function computeSyndromes(block, nsym) {
  const syn = new Uint8Array(nsym);
  for (let k = 0; k < nsym; k++) {
    const ak = GF_EXP[k]; // α^k
    let y = 0;
    for (let i = 0; i < block.length; i++) y = gfMul(y, ak) ^ block[i];
    syn[k] = y;
  }
  return syn;
}

// Berlekamp-Massey 求错误定位多项式 Λ(x)（低次在前，Λ[0]=1）
function berlekampMassey(syn) {
  const nsym = syn.length;
  let Lambda = [1];
  let B = [1];
  let L = 0, m = 1, b = 1;
  for (let n = 0; n < nsym; n++) {
    let delta = syn[n];
    for (let i = 1; i <= L; i++) delta ^= gfMul(Lambda[i] || 0, syn[n - i] || 0);
    if (delta === 0) {
      m++;
    } else if (2 * L <= n) {
      const T = Lambda.slice();
      const coef = gfMul(delta, gfInv(b));
      const shifted = new Array(m).fill(0).concat(B.map((c) => gfMul(c, coef)));
      Lambda = gfPolyAdd(Lambda, shifted);
      L = n + 1 - L;
      B = T;
      b = delta;
      m = 1;
    } else {
      const coef = gfMul(delta, gfInv(b));
      const shifted = new Array(m).fill(0).concat(B.map((c) => gfMul(c, coef)));
      Lambda = gfPolyAdd(Lambda, shifted);
      m++;
    }
  }
  return gfPolyTrim(Lambda);
}

// Chien 搜索：返回出错 block 下标（0=首字节/最高次）
function findErrorPositions(Lambda, blockLen) {
  const pos = [];
  for (let p = 0; p < blockLen; p++) {
    const Xinv = gfInv(GF_EXP[p % 255]); // α^{-p}
    if (gfPolyEval(Lambda, Xinv) === 0) pos.push(blockLen - 1 - p);
  }
  return pos;
}

// 错误求值多项式 Ω(x) = (Λ(x)·S(x)) mod x^{nsym}
function computeOmega(Lambda, syn) {
  const Sx = syn.slice(); // 低次在前：Sx[k] = S_k
  const prod = gfPolyMul(Lambda, Sx);
  const nsym = syn.length;
  return prod.length > nsym ? prod.slice(0, nsym) : prod;
}

// 对一个块（data+ecc）做 RS 纠错，返回纠正后的全码字与错误数
function rsDecodeBlock(full, nsym) {
  const syn = computeSyndromes(full, nsym);
  let hasErr = false;
  for (let k = 0; k < nsym; k++) if (syn[k] !== 0) { hasErr = true; break; }
  if (!hasErr) return { corrected: full, errorCount: 0 };
  const Lambda = berlekampMassey(syn);
  const numErr = Lambda.length - 1;
  const errPos = findErrorPositions(Lambda, full.length);
  if (errPos.length !== numErr) {
    throw new Error(
      "RS 纠错失败：Λ 次数 " + numErr + " 但 Chien 仅定位 " + errPos.length +
      " 个错误（超出纠错能力或数据损坏）"
    );
  }
  const Omega = computeOmega(Lambda, syn);
  const LambdaDeriv = gfPolyDerivative(Lambda);
  const corrected = full.slice();
  for (const i of errPos) {
    const p = full.length - 1 - i; // 错误在 x^p 处
    const X = GF_EXP[p % 255];      // 错误定位子 α^p
    const Xinv = gfInv(X);
    const omegaVal = gfPolyEval(Omega, Xinv);
    const lambdaDVal = gfPolyEval(LambdaDeriv, Xinv);
    if (lambdaDVal === 0) throw new Error("RS 纠错失败：Λ'(X⁻¹)=0");
 // Forney (fcr=0)：e = X · Ω(X⁻¹) / Λ'(X⁻¹)；GF(2^m) 中 -1=1
    const e = gfMul(X, gfMul(omegaVal, gfInv(lambdaDVal)));
    corrected[i] ^= e;
  }
  return { corrected, errorCount: numErr };
}

// ============================================================
// 功能图案图（标记哪些模块是函数模块，取数据时跳过）
// ============================================================
function buildFunctionMap(size, version) {
  const isFn = [];
  for (let y = 0; y < size; y++) isFn.push(new Array(size).fill(false));
  const mark = (x, y) => {
    if (x >= 0 && x < size && y >= 0 && y < size) isFn[y][x] = true;
  };
  const markRect = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) mark(x, y);
  };
 // finder + 分隔符 + 格式信息区： // T77-FIX-FNMAP
 // 左上 9×9（finder 8×8 + 格式信息 L 形 + timing 交叉点）全为功能模块；
 // 右上 8×9（finder 8×8 + 行 8 格式信息），左边界 size-8（分隔符），非 size-9（数据模块）；
 // 左下 9×8（finder 8×8 + 列 8 格式信息 + 固定暗），上边界 size-8（分隔符），非 size-9（数据模块）。
  markRect(0, 0, 8, 8);
  markRect(size - 8, 0, size - 1, 8);
  markRect(0, size - 8, 8, size - 1);
 // timing 行/列（仅 finder 之间的部分，与 qrcode.js drawFunctionPatterns 一致：i=8..size-9）
  for (let i = 8; i < size - 8; i++) { mark(6, i); mark(i, 6); }
 // 对齐图案 5×5（跳过与三个 finder 重叠的）
  const centers = ALIGNMENT_PATTERN_CENTERS[version];
  if (centers) {
    const n = centers.length;
    const last = centers[n - 1];
    for (const cy of centers) {
      for (const cx of centers) {
        if ((cx === 6 && cy === 6) || (cx === 6 && cy === last) || (cx === last && cy === 6)) continue;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(cx + dx, cy + dy);
      }
    }
  }
 // 固定暗模块
  mark(8, size - 8);
 // 版本信息（v7+）：右上 3×6 与左下 6×3
  if (version >= 7) {
    markRect(size - 11, 0, size - 9, 5);
    markRect(0, size - 11, 5, size - 9);
  }
  return isFn;
}

// ============================================================
// 掩码条件（与 qrcode.js 编码侧 maskCond 一致，用于还原）
// ============================================================
function maskCond(m, x, y) {
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

// ============================================================
// 之字形读取数据模块 + 去掩码 → 码字字节流
// 扫描顺序与 qrcode.js QrMatrix.drawCodewords 完全镜像
// ============================================================
function readCodewords(matrix, size, isFn, mask) {
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // 跳过垂直 timing
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (isFn[y][x]) continue;
        let bit = matrix[y][x] ? 1 : 0;
        if (maskCond(mask, x, y)) bit ^= 1; // 去掩码
        bits.push(bit);
      }
    }
  }
  const codewords = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[i + k];
    codewords.push(b);
  }
  return codewords;
}

// ============================================================
// 去交织：把交织后的全码字还原成 numBlocks 个块（各含 data+ecc）
// 镜像 qrcode.js QrMatrix.addEccAndInterleave 的交织顺序
// ============================================================
function deinterleave(allCW, version, ecl) {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][version];
  const rawCodewords = Math.floor(getNumRawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const blockLen = Math.floor(rawCodewords / numBlocks); // 短块实长；长块 = blockLen+1
  const blocks = [];
  for (let j = 0; j < numBlocks; j++) blocks.push([]);
  let idx = 0;
  for (let i = 0; i < blockLen + 1; i++) {
    for (let j = 0; j < numBlocks; j++) {
 // 短块在 i = blockLen - blockEccLen 处有占位 0（编码侧未发射），跳过
      if (i === blockLen - blockEccLen && j < numShortBlocks) continue;
      blocks[j].push(allCW[idx++]);
    }
  }
  const result = [];
  for (let j = 0; j < numBlocks; j++) {
    const isShort = j < numShortBlocks;
    const dataLen = blockLen - blockEccLen + (isShort ? 0 : 1);
    const full = blocks[j];
    result.push({
      data: full.slice(0, dataLen),
      ecc: full.slice(dataLen),
      full,
    });
  }
  return { blocks: result, blockEccLen };
}

// ============================================================
// 数据段解码：数字 / 字母 / 字节模式（照 ISO/IEC 18004）
// ============================================================
function decodeDataSegments(dataBytes, version) {
  const bits = [];
  for (const b of dataBytes) for (let i = 7; i >= 0; i--) bits.push((b >> i) & 1);
  let pos = 0;
  const readBits = (n) => {
    let v = 0;
    for (let k = 0; k < n; k++) {
      if (pos >= bits.length) return v;
      v = (v << 1) | bits[pos++];
    }
    return v;
  };
  const segs = [];
  while (pos + 4 <= bits.length) {
    const mode = readBits(4);
    if (mode === 0) break; // 终止符
    if (mode === MODE_NUMERIC) {
      const count = readBits(getCharCountBits(mode, version));
      let s = "";
      let rem = count;
      while (rem >= 3) { s += String(readBits(10)).padStart(3, "0"); rem -= 3; }
      if (rem === 2) s += String(readBits(7)).padStart(2, "0");
      else if (rem === 1) s += String(readBits(4));
      segs.push({ mode: "numeric", count, text: s });
    } else if (mode === MODE_ALPHANUMERIC) {
      const count = readBits(getCharCountBits(mode, version));
      let s = "";
      let rem = count;
      while (rem >= 2) {
        const v = readBits(11);
        s += ALPHANUMERIC_CHARSET[Math.floor(v / 45)] + ALPHANUMERIC_CHARSET[v % 45];
        rem -= 2;
      }
      if (rem === 1) s += ALPHANUMERIC_CHARSET[readBits(6)];
      segs.push({ mode: "alphanumeric", count, text: s });
    } else if (mode === MODE_BYTE) {
      const count = readBits(getCharCountBits(mode, version));
      const bytes = [];
      for (let i = 0; i < count; i++) bytes.push(readBits(8));
      let s;
      try {
        s = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
      } catch {
        s = String.fromCharCode(...bytes);
      }
      segs.push({ mode: "byte", count, text: s });
    } else {
 // 其他模式（kanji/ECI/结构链接/FNC1…）超出本卡范围，停止
      segs.push({ mode: "unsupported(0x" + mode.toString(16) + ")", count: 0, text: "" });
      break;
    }
  }
  return segs;
}

// ============================================================
// 输入解析：qrGen JSON 或 ASCII art / 0-1 行矩阵 → 0/1 二维数组
// ============================================================
function parseInputToMatrix(text) {
  const t = text.trim();
  if (!t) throw new Error("输入为空");
 // JSON（qrGen 输出）
  if (t.startsWith("{")) {
    let obj = null;
    try { obj = JSON.parse(t); } catch { obj = null; }
    if (obj && Array.isArray(obj.matrix) && obj.matrix.length > 0) {
      const h = obj.matrix.length;
      const w = obj.matrix[0].length;
      const mat = obj.matrix.map((r) => {
        const row = Array.isArray(r) ? r : Array.from(r);
        return row.map((v) => (v ? 1 : 0));
      });
      return { matrix: mat, width: w, height: h, meta: obj };
    }
  }
 // ASCII art / 0-1 行
  const parsed = parseAsciiMatrix(text);
  if (!parsed) {
    throw new Error("无法解析为矩阵（需 qrGen 的 JSON，或 ASCII art / 0-1 行矩阵）");
  }
  return parsed;
}

function validateQrSize(matrix, w, h) {
  if (w !== h) throw new Error("矩阵非正方形（" + w + "×" + h + "），QR 须正方形");
  if (w < 21 || w > 177 || (w - 17) % 4 !== 0) {
    throw new Error("尺寸 " + w + " 不符 QR（须 21+4k，k=0..40）");
  }
  return (w - 17) / 4;
}

// ============================================================
// QR 解码主入口：0/1 矩阵 → { text, version, size, ecl, mask, segments, errorCount, ... }
// ============================================================
function qrDecodeMatrix(matrix, w, h) {
  const version = validateQrSize(matrix, w, h);
  const size = w;
  const finders = countFinders(matrix, size, size);
  if (finders < 3) {
    throw new Error("finder 图案不足（检测到 " + finders + " 个，QR 需 3 个）");
  }
  const fi = readFormatInfo(matrix, size);
  if (fi.ecl < 0 || fi.ecl > 3) throw new Error("无法识别格式信息（ECL/掩码）");
  const ecl = fi.ecl;
  const mask = fi.mask;
  if (version >= 7) {
    const vi = readVersionInfo(matrix, size);
    if (vi.version !== version) {
      throw new Error(
        "版本信息不一致：尺寸推 v" + version + "，版本信息读 v" + vi.version + "（dist=" + vi.dist + "）"
      );
    }
  }
  const isFn = buildFunctionMap(size, version);
  const allCW = readCodewords(matrix, size, isFn, mask);
  const { blocks, blockEccLen } = deinterleave(allCW, version, ecl);

  let totalErrors = 0;
  for (const blk of blocks) {
    const r = rsDecodeBlock(blk.full, blockEccLen);
    blk.corrected = r.corrected;
    blk.errorCount = r.errorCount;
    totalErrors += r.errorCount;
  }

 // 拼接数据码字（按块顺序取各块 data 部分）
  const dataBytes = [];
  for (const blk of blocks) {
    for (let i = 0; i < blk.data.length; i++) dataBytes.push(blk.corrected[i]);
  }
  const segs = decodeDataSegments(dataBytes, version);
  const text = segs.map((s) => s.text).join("");

  return {
    text,
    version,
    size,
    ecl: ECL_NAME[ecl],
    eclIndex: ecl,
    mask,
    finders,
    formatDist: fi.dist,
    errorCount: totalErrors,
    numBlocks: blocks.length,
    segments: segs,
    dataBytes,
  };
}

// ============================================================
// op: QR 码解码（decode → 原文）
// ============================================================
function qrDecodeOp(text) {
  const { matrix, width, height } = parseInputToMatrix(text);
  const r = qrDecodeMatrix(matrix, width, height);
  return r.text;
}

// ============================================================
// op: QR 解码诊断（run → 报告）
// ============================================================
function qrDecodeReportOp(text) {
  const lines = ["QR 码解码诊断"];
  let parsed;
  try {
    parsed = parseInputToMatrix(text);
  } catch (e) {
    lines.push("输入解析失败: " + e.message);
    return lines.join("\n");
  }
  const { matrix, width: w, height: h, meta } = parsed;
  lines.push("矩阵尺寸: " + w + " × " + h);
  if (meta && meta.version) lines.push("输入元信息（JSON）: v" + meta.version + " " + meta.ecl + " mask=" + meta.mask + " " + (meta.mode || ""));

  let res;
  try {
    res = qrDecodeMatrix(matrix, w, h);
  } catch (e) {
    lines.push("解码失败: " + e.message);
    return lines.join("\n");
  }
  lines.push("finder 图案: " + res.finders + " 个" + (res.finders === 3 ? " ✓" : ""));
  lines.push("版本: " + res.version);
  lines.push("纠错级: " + res.ecl + (res.formatDist === 0 ? "（格式信息精确匹配）" : "（dist=" + res.formatDist + "）"));
  lines.push("掩码: " + res.mask);
  lines.push("码字块数: " + res.numBlocks);
  lines.push("RS 纠错: 纠正 " + res.errorCount + " 个错误" + (res.errorCount > 0 ? " ✓" : "（数据无误）"));
  const segSummary = res.segments.length
    ? res.segments.map((s) => s.mode + "[" + (s.count || 0) + "]").join(" › ")
    : "（无）";
  lines.push("数据段: " + segSummary);
  lines.push("解码原文: " + (res.text === "" ? "（空）" : res.text));
  if (meta && meta.mode) {
 // 与 qrGen 自报模式交叉校验
    const expect = meta.mode;
    const got = res.segments[0] ? res.segments[0].mode : "?";
    lines.push("模式交叉校验: qrGen=" + expect + " / 解码=" + got + (expect === got ? " ✓" : " ✗"));
  }
  return lines.join("\n");
}

// ============================================================
// 注册
// ============================================================
// C7-QR 合并：qrDecodeReport 并入 qrDecode 的 verbose 参数（同一 qrDecodeMatrix 内核
// 诊断=decode 的 verbose 版）。verbose=false 走纯 decode（返回原文，参与穷举/magic）；
// verbose=true 返回全流程诊断报告。qrDecodeReportOp 函数本体保留供导出/测试。
function qrDecodeDispatch(text, p) {
  return p && p.verbose ? qrDecodeReportOp(text) : qrDecodeOp(text);
}

register({
  id: "qrDecode",
  cat: "stego",
  name: "QR 码解码",
  desc: "从 0/1 矩阵反解 QR 内容：finder 检测 + 格式信息 + 之字形取数 + 掩码还原 + RS 纠错 + 数字/字母/字节模式还原。开「诊断」输出版本/ECL/掩码/RS纠错数/分段模式全流程报告",
  params: [
    { key: "verbose", label: "诊断报告", type: "bool", default: false },
  ],
  decode: qrDecodeDispatch,
});

export {
  qrDecodeMatrix, qrDecodeOp, qrDecodeReportOp, parseInputToMatrix,
  computeSyndromes, berlekampMassey, findErrorPositions, computeOmega, rsDecodeBlock,
  buildFunctionMap, readCodewords, deinterleave, decodeDataSegments,
  ECC_CODEWORDS_PER_BLOCK, NUM_ERROR_CORRECTION_BLOCKS, ALIGNMENT_PATTERN_CENTERS,
  GF_EXP, GF_LOG, gfMul, gfInv,
};
