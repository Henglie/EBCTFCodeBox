/*
 * nihilist.js — Nihilist 密码（T300，cat:'classic'，双向）。
 *
 * 算法：Polybius 方阵 + 关键词加数古典密码（俄国民意党 1880s）。
 * 1. 构造 5×5 Polybius 方阵（关键词去重填入，I/J 合并，剩余字母按序补全）
 * 2. 明文每字母 → 方阵行号+列号（两位数，如 R=11、A=12）
 * 3. 密钥同样用方阵编码为数字序列（循环使用）
 * 4. 密文 = 明文数字 + 密钥数字（逐位置整数相加，位置间独立不进位）
 *
 * 权威参照：Wikipedia "Nihilist cipher"。
 * 加密用整数加法（非逐位 mod 10），密文可为三位数（如 55+51=106）。
 * "逐位相加，不进位" 指各位置独立相加、位置间不传递进位（每个位置是独立的整数）。
 * 测试向量（keyword "zebras"，PT "dynamitewinterpalace"，key "russian"）：
 * CT = "37 106 62 36 67 47 86 26 104 53 62 77 27 55 57 66 55 36 54 27"
 *
 * 红线：
 * - 只新建 nihilist.js，不碰 main.js / i18n / 别的 core 文件。
 * - 照 Wikipedia 权威算法，整数加法。
 * - 双向编解码，core 里零 UI 依赖。
 */

import { register } from "./registry.js";

// I/J 合并的 25 字母表（无 J）
const ALPHABET = "ABCDEFGHIKLMNOPQRSTUVWXYZ";

/**
 * 构造 5×5 Polybius 方阵。
 * 关键词去重后填入，I/J 合并（J→I），剩余字母按字母表顺序补全。
 * @param {string} keyword 方阵关键词（空则用标准字母表）
 * @returns {{square: string[][], index: Map<string, [number, number]>}}
 * square[行][列] = 字母（0-indexed），index.get(字母) = [行, 列]（0-indexed）
 */
function buildPolybiusSquare(keyword) {
  const kw = String(keyword == null ? "" : keyword)
    .toUpperCase()
    .replace(/J/g, "I")
    .replace(/[^A-Z]/g, "");
 // 关键词去重（保留首次出现顺序）
  let seq = "";
  for (const ch of kw) {
    if (!seq.includes(ch)) seq += ch;
  }
 // 剩余字母按序补全
  for (const ch of ALPHABET) {
    if (!seq.includes(ch)) seq += ch;
  }
 // 填入 5×5（按行）
  const square = [];
  const index = new Map();
  let idx = 0;
  for (let row = 0; row < 5; row++) {
    square[row] = [];
    for (let col = 0; col < 5; col++) {
      const ch = seq[idx++];
      square[row][col] = ch;
      index.set(ch, [row, col]);
    }
  }
  return { square, index };
}

/**
 * 文本 → Polybius 数字序列。
 * 文本清洗：转大写、J→I、只保留 A-Z。每字母编码为 (行+1)*10+(列+1)（1-indexed 两位数）。
 * @param {string} text 文本
 * @param {Map<string, [number, number]>} index 方阵索引
 * @returns {number[]} 数字序列（如 [11, 43, ...]）
 */
function textToNumbers(text, index) {
  const cleaned = String(text == null ? "" : text)
    .toUpperCase()
    .replace(/J/g, "I")
    .replace(/[^A-Z]/g, "");
  const nums = [];
  for (const ch of cleaned) {
    const pos = index.get(ch);
    if (pos) {
      nums.push((pos[0] + 1) * 10 + (pos[1] + 1));
    }
  }
  return nums;
}

/**
 * Nihilist 加密。
 * @param {string} text 明文
 * @param {{keyword?: string, key?: string}} p 参数
 * @returns {string} 空格分隔的密文数字串
 */
function nihilistEncrypt(text, p = {}) {
  const keyword = p.keyword != null ? p.keyword : "";
  const key = p.key != null ? p.key : "";
  const { index } = buildPolybiusSquare(keyword);
  const ptNums = textToNumbers(text, index);
  if (ptNums.length === 0) return "";
  const keyNums = textToNumbers(key, index);
  if (keyNums.length === 0) {
    throw new Error("Nihilist 加密密钥不能为空且须含字母");
  }
  const ct = [];
  for (let i = 0; i < ptNums.length; i++) {
    ct.push(ptNums[i] + keyNums[i % keyNums.length]);
  }
  return ct.join(" ");
}

/**
 * Nihilist 解密。
 * @param {string} text 密文数字串（空格/逗号/中文逗号分隔）
 * @param {{keyword?: string, key?: string}} p 参数
 * @returns {string} 明文（大写）
 */
function nihilistDecrypt(text, p = {}) {
  const keyword = p.keyword != null ? p.keyword : "";
  const key = p.key != null ? p.key : "";
  const { square, index } = buildPolybiusSquare(keyword);
 // 解析密文数字（容错：空格/英文逗号/中文逗号/顿号/分号/换行）
  const tokens = String(text == null ? "" : text)
    .trim()
    .split(/[\s,，、;；]+/)
    .filter(Boolean);
  if (tokens.length === 0) return "";
  const keyNums = textToNumbers(key, index);
  if (keyNums.length === 0) {
    throw new Error("Nihilist 解密密钥不能为空且须含字母");
  }
  let plain = "";
  for (let i = 0; i < tokens.length; i++) {
    const ctVal = parseInt(tokens[i], 10);
    if (isNaN(ctVal)) {
      throw new Error(`Nihilist 密文含非数字 token: ${tokens[i]}`);
    }
    const ptVal = ctVal - keyNums[i % keyNums.length];
    const row = Math.floor(ptVal / 10) - 1;
    const col = (ptVal % 10) - 1;
    if (row < 0 || row > 4 || col < 0 || col > 4) {
      throw new Error(
        `Nihilist 解密越界: 密文${ctVal} − 密钥${keyNums[i % keyNums.length]} = ${ptVal}（有效范围 11-55）`
      );
    }
    plain += square[row][col];
  }
  return plain;
}

register({
  id: "nihilistCipher",
  cat: "classic",
  name: "Nihilist 密码",
  desc: "Polybius 方阵 + 关键词加数古典密码（5×5 方阵 I/J 合并，明文/密钥编码为两位数后逐位置整数相加，俄国民意党 1880s）",
  params: [
    { key: "keyword", label: "方阵关键词", type: "text", default: "" },
    { key: "key", label: "加密密钥", type: "text", default: "" },
  ],
  encode: nihilistEncrypt,
  decode: nihilistDecrypt,
});

export { buildPolybiusSquare, textToNumbers, nihilistEncrypt, nihilistDecrypt };
