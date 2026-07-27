/*
 * classicExt2.js — 古典密码补全组2（T67，cat:'classic'）。
 *
 * 任务卡 T67 要求交付：ADFGX/ADFGVX、Bifid、Trifid、Four-square、Hill、Trithemius。
 * 经查重（classic.js），前 5 个已完整实现（encode+decode 双向）：
 * - adfgx (adfgxEnc / adfgxDec) Polybius + 列移位（5×5）
 * - adfgvx (adfgvxEnc / adfgvxDec) Polybius + 列移位（6×6 含数字）
 * - bifid (bifidEncode / bifidDecode) 按 period 分组的 Polybius 转置
 * - trifid (trifidEncode / trifidDecode) 3×3×3 方阵
 * - foursquare (fourSquareEncode / fourSquareDecode) 双 25 字母密钥方阵
 * - hill (hillEncode / hillDecode) 矩阵加密 mod 26
 * 本文件只实现缺失的 Trithemius，避免重复注册导致 id 冲突。
 *
 * Trithemius 密码（Polygraphia, 1508, Johannes Trithemius）：
 * 多表密码的早期形式，使用 Tabula Recta 渐进移位。
 * 第 i 个字母用第 i 行加密（移位 i），26 个字母后循环。
 * 本实现支持起始移位参数（start），默认 0 = 标准 Trithemius。
 *
 * 红线：算法照教科书定义实现，不编造；encode/decode 双向可逆。
 */
import { register } from "./registry.js";

// ============ Trithemius（渐进移位） ============

/**
 * Trithemius 编码：第 i 个字母（从 0 计）移位 (start + i) mod 26。
 * 非字母字符原样输出，不占移位序号。大小写独立保留。
 * @param {string} text 明文
 * @param {number} start 起始移位（默认 0 = 标准 Trithemius）
 * @returns {string} 密文
 */
function trithemiusEncode(text, start = 0) {
  const s = ((Number(start) % 26) + 26) % 26;
  let result = "";
  let idx = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      const shift = (s + idx) % 26;
      result += String.fromCharCode((code - 65 + shift) % 26 + 65);
      idx++;
    } else if (code >= 97 && code <= 122) {
      const shift = (s + idx) % 26;
      result += String.fromCharCode((code - 97 + shift) % 26 + 97);
      idx++;
    } else {
      result += ch;
    }
  }
  return result;
}

/**
 * Trithemius 解码：第 i 个字母移位 -(start + i) mod 26。
 * @param {string} text 密文
 * @param {number} start 起始移位（默认 0）
 * @returns {string} 明文
 */
function trithemiusDecode(text, start = 0) {
  const s = ((Number(start) % 26) + 26) % 26;
  let result = "";
  let idx = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 65 && code <= 90) {
      const shift = (s + idx) % 26;
      result += String.fromCharCode((code - 65 - shift + 26 * 26) % 26 + 65);
      idx++;
    } else if (code >= 97 && code <= 122) {
      const shift = (s + idx) % 26;
      result += String.fromCharCode((code - 97 - shift + 26 * 26) % 26 + 97);
      idx++;
    } else {
      result += ch;
    }
  }
  return result;
}

// ============ 注册 ============
register({
  id: "trithemius",
  cat: "classic",
  name: "Trithemius 渐进移位",
  desc: "第 i 个字母移位 (start+i) mod 26（多表密码早期形式，Tabula Recta 渐进）",
  params: [
    { key: "start", label: "起始移位", type: "number", default: 0 },
  ],
  encode: (t, p) => trithemiusEncode(t, Number((p && p.start) || 0)),
  decode: (t, p) => trithemiusDecode(t, Number((p && p.start) || 0)),
});

export { trithemiusEncode, trithemiusDecode };
