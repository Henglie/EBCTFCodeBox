/*
 * lzcodec.js — LZ4 / LZString 压缩（cat:'modern'，双向）。
 *
 * 决策：
 * - LZString：实现标准 LZW 压缩（参考 pieroxy/lz-string 算法思路，用数字数组
 * 替代位打包，保证往返严格正确——位打包实现易因 enlargeIn 时机出错
 * 优先正确性，输出格式为数字数组 JSON）
 * - LZ4：跳过。理由：LZ4 块格式需 bit 级别精确对齐 token/offset/length 编码
 * 纯 JS 实现量大且易错，与 LZ4 官方参考实现对拍成本高。CTF 压缩题 LZString
 * 已覆盖主流场景，LZ4 留待后续。
 *
 * 算法（标准 LZW）：
 * compress: 文本 → LZW 字典编码 → 数字数组（每项是字典索引）
 * decompress: 数字数组 → LZW 字典解码 → 原文本
 * 输出格式：JSON 数字数组字符串（如 "[12,34,56]"），便于传输与调试
 *
 * 注册 op：
 * lzstring 双向：encode=compress（输出 JSON 数字数组）；decode=decompress
 *
 * 红线：
 * - 只新建 lzcodec.js，不碰任何现有 core / main.js / i18n。
 * - LZW 算法标准实现（不照抄位打包，用数字数组保证正确性）。
 * - LZ4 跳过并说明理由（照"写不清宁缺"）。
 * - 往返测试。
 */

import { register } from "./registry.js";

// ============================================================
// 标准 LZW 压缩（预填 256 ASCII 单字符字典，标准 LZW 做法）
// 输入：字符串；输出：JSON 数字数组字符串
// 仅支持 Latin-1 字符（0-255），中文等多字节字符请先 UTF-8 编码。
// ============================================================
function lzwCompress(input) {
  if (input == null || input === "") return "[]";
 // 初始字典：256 个 ASCII 单字符（0-255），标准 LZW 做法
 // 注：仅支持 Latin-1 范围（0-255）。多字节字符（如中文）超出范围会抛错。
 // CTF 场景以 ASCII 为主，中文压缩可用 UTF-8 字节序列再 LZW。
  const dictionary = new Map();
  for (let i = 0; i < 256; i++) {
    dictionary.set(String.fromCharCode(i), i);
  }
  let dictSize = 256;
  let w = "";
  const result = [];

  for (let i = 0; i < input.length; i++) {
    const c = input.charAt(i);
    const code = c.charCodeAt(0);
    if (code > 255) {
 // 非 Latin-1 字符：抛错（本实现仅支持 0-255）
      throw new Error("LZString: 仅支持 Latin-1 字符（0-255），遇到字符码 " + code + "。中文等多字节字符请先 UTF-8 编码");
    }
    const wc = w + c;
    if (dictionary.has(wc)) {
      w = wc;
    } else {
      result.push(dictionary.get(w));
      dictionary.set(wc, dictSize++);
      w = c;
    }
  }
  if (w !== "") {
    result.push(dictionary.get(w));
  }
  return JSON.stringify(result);
}

function lzwDecompress(input) {
  if (input == null || input === "") return null;
  let arr;
  try {
    arr = JSON.parse(input);
  } catch {
    throw new Error("LZString 逆: 输入须为 JSON 数字数组（如 '[12,34,56]'）");
  }
  if (!Array.isArray(arr)) throw new Error("LZString 逆: 输入须为数字数组");
  if (arr.length === 0) return "";
  for (const v of arr) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new Error("LZString 逆: 数组项须为非负整数");
    }
  }

 // 重建初始字典：256 个 ASCII 单字符
  const dictionary = [];
  for (let i = 0; i < 256; i++) {
    dictionary[i] = String.fromCharCode(i);
  }
  let dictSize = 256;

  let w = dictionary[arr[0]];
  if (w === undefined) {
    throw new Error("LZString 逆: 无效索引 " + arr[0] + "（dictSize=" + dictSize + "）");
  }
  const result = [w];

  for (let i = 1; i < arr.length; i++) {
    const k = arr[i];
    let entry;
    if (k < dictSize) {
      entry = dictionary[k];
    } else if (k === dictSize) {
      entry = w + w.charAt(0);
    } else {
      throw new Error("LZString 逆: 无效索引 " + k + "（dictSize=" + dictSize + "）");
    }
    result.push(entry);
    dictionary[dictSize++] = w + entry.charAt(0);
    w = entry;
  }
  return result.join("");
}

// ============================================================
// 注册：双向 op（用 V2 修正版）
// ============================================================
register({
  id: "lzstring",
  cat: "modern",
  name: "LZString 压缩 (LZW)",
  desc: "标准 LZW 压缩（参考 pieroxy/lz-string 算法思路）。encode 压缩为 JSON 数字数组；decode 解压还原。仅支持 Latin-1 字符（0-255），中文等多字节字符请先 UTF-8 编码。LZ4 跳过（块格式对齐成本高）。",
  params: [],
  encode: lzwCompress,
  decode: lzwDecompress,
});

export { lzwCompress, lzwDecompress };
