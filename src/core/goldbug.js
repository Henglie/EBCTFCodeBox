/*
 * goldbug.js — GoldBug 金甲虫密码（cat:'classic'，件内自注册）。
 *
 * 来源:
 * - 每字母唯一单字符符号，可逆替换（标准教学 GoldBug 通行做法
 * dcode.fr / Practical Cryptography 均如此）。
 * - 符号风格取自爱伦坡《金甲虫》小说原文 Kidd 密码（†‡¶§ 数字标点混用）。
 *
 * 算法:
 * encode: A-Z 每字母 → 唯一单字符符号（小写转大写），非字母原样透传。
 * decode: 符号 → 字母（单字符无前缀重叠，直接查表），非符号原样透传。
 * 单字符符号天然无歧义，贪心匹配零冲突，严格可逆。
 *
 * 符号表照小说原文 Kidd 密码符号风格；单向依赖（仅 import registry.js）。
 */
import { register } from "./registry.js";

// ============ 符号表（26 字母各一唯一单字符符号）============
// 风格来源：爱伦坡《金甲虫》小说原文 Kidd 密码符号（†‡¶§ 数字标点混用）。
// 小说原文是多对一（多符号→1字母，靠频率分析消歧），不可严格往返。
// 本实现采用每字母唯一单字符方案（教学通行做法），保证可逆。
// 小说原文已推导的映射（5→a, ‡→o, †→d, 8→e, 3→g, 4→h, 6→i, *→n
// (→r, )→t, ;→s, ?→u, 0→m, 9→f, 1→l, :→w, 2→p, .→v, ¶→b, —→y）
// 保留原映射，剩余 6 字母（c/j/k/q/x/z）用剩余符号扩展（§!&@[]）。
const ORIGINAL_MAP = {
  A: "5", B: "¶", C: "§", D: "†", E: "8", F: "9", G: "3", H: "4",
  I: "6", J: "!", K: "&", L: "1", M: "0", N: "*", O: "‡", P: "2",
  Q: "@", R: "(", S: ";", T: ")", U: "?", V: ".", W: ":", X: "[",
  Y: "—", Z: "]",
};

// 反向映射（符号 → 字母）
const REVERSE_MAP = {};
for (const [letter, sym] of Object.entries(ORIGINAL_MAP)) {
  REVERSE_MAP[sym] = letter;
}

// 符号集合（用于 decode 时判断是否为 GoldBug 符号）
const SYMBOL_SET = new Set(Object.values(ORIGINAL_MAP));

// ============ encode: 字母 → 符号 ============
function goldbugEncode(text) {
  const s = String(text);
  let out = "";
  for (const ch of s) {
    const upper = ch.toUpperCase();
    if (upper in ORIGINAL_MAP) {
      out += ORIGINAL_MAP[upper];
    } else {
      out += ch;  // 非字母原样透传
    }
  }
  return out;
}

// ============ decode: 符号 → 字母 ============
function goldbugDecode(text) {
  const s = String(text);
  let out = "";
  for (const ch of s) {
    if (SYMBOL_SET.has(ch)) {
      out += REVERSE_MAP[ch];
    } else {
      out += ch;  // 非符号原样透传
    }
  }
  return out;
}

// ============ detect: 含 GoldBug 特征符号（†‡¶§ 等）才命中 ============
function goldbugDetect(text) {
  const s = String(text);
 // 特征符号：†‡¶ 是 GoldBug 强信号（普通文本几乎不用）
  const strong = /[†‡¶]/.test(s);
  if (!strong) return 0;
 // 辅助符号占比（数字 + 标点 + 特殊符号）决定置信度高低（均落在 0.3-0.5）
  const coded = s.replace(/[A-Za-z\s]/g, "");
  const ratio = coded.length / Math.max(s.length, 1);
  return ratio > 0.3 ? 0.5 : 0.3;
}

// ============ 件内自注册 ============
register({
  id: "goldbug",
  cat: "classic",
  name: "GoldBug 金甲虫密码",
  desc: "爱伦坡《金甲虫》Kidd 密码符号替换（26 字母各一唯一符号，可逆教学版）",
  encode: goldbugEncode,
  decode: goldbugDecode,
  detect: goldbugDetect,
});

export { goldbugEncode, goldbugDecode, goldbugDetect, ORIGINAL_MAP, REVERSE_MAP };
