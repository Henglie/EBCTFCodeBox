/*
 * goldbug.js — GoldBug 金甲虫密码（cat:'classic'，件内自注册）。
 *
 * 来源:
 * - Poe / dCode extended A-Z table: https://www.dcode.fr/scarabee-or-poe
 * - The former project-specific table remains available as alphabet=legacy.
 *
 * 算法:
 * encode: A-Z 每字母 → 唯一单字符符号（小写转大写），非字母原样透传。
 * decode: 符号 → 字母（单字符无前缀重叠，直接查表），非符号原样透传。
 * 单字符符号天然无歧义，贪心匹配零冲突，严格可逆。
 *
 * 符号表照小说原文 Kidd 密码符号风格；单向依赖（仅 import registry.js）。
 */
import { register } from "./registry.js";

// The complete published teaching table, independently checked against dCode.
const ORIGINAL_MAP = {
  A: "5", B: "2", C: "-", D: "†", E: "8", F: "1", G: "3", H: "4",
  I: "6", J: ",", K: "7", L: "0", M: "9", N: "*", O: "‡", P: ".",
  Q: "$", R: "(", S: ")", T: ";", U: "?", V: "¶", W: "]", X: "¢",
  Y: ":", Z: "[",
};
const LEGACY_MAP = {
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
const LEGACY_REVERSE = Object.fromEntries(Object.entries(LEGACY_MAP).map(([letter, sym]) => [sym, letter]));
const LEGACY_SYMBOLS = new Set(Object.values(LEGACY_MAP));
// 转义符：用于区分「字面数字/标点」与「同形符号」。\ 不在符号表内。
const ESC = "\\";

// ============ encode: 字母 → 符号 ============
function goldbugEncode(text, params = {}) {
  const legacy = params?.alphabet === "legacy";
  const map = legacy ? LEGACY_MAP : ORIGINAL_MAP;
  const symbols = legacy ? LEGACY_SYMBOLS : SYMBOL_SET;
  const s = String(text);
  let out = "";
  for (const ch of s) {
    const upper = ch.toUpperCase();
    if (upper in map) {
      out += map[upper];
    } else {
      // 非字母若恰好是 GoldBug 符号（数字/标点）或转义符本身，则加 \ 转义，避免 decode 误当符号。
      out += (symbols.has(ch) || ch === ESC) ? ESC + ch : ch;
    }
  }
  return out;
}

// ============ decode: 符号 → 字母 ============
function goldbugDecode(text, params = {}) {
  const legacy = params?.alphabet === "legacy";
  const reverse = legacy ? LEGACY_REVERSE : REVERSE_MAP;
  const symbols = legacy ? LEGACY_SYMBOLS : SYMBOL_SET;
  const chars = [...String(text)];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === ESC) {
      if (i + 1 >= chars.length)
        throw new Error("GoldBug：末尾有悬空转义符（字面反斜杠请写成双反斜杠）。");
      out += chars[++i];  // 被转义的字面字符，原样输出
    } else if (symbols.has(ch)) {
      out += reverse[ch];
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
  desc: "Poe/dCode 通行 GoldBug 符号表；可选旧版兼容表；解码统一大写，冲突字面符号以反斜杠转义",
  params: [{ key: "alphabet", label: "码表", type: "select", default: "poe", options: [
    { value: "poe", label: "Poe / dCode 通行表" },
    { value: "legacy", label: "旧版兼容表" },
  ] }],
  encode: goldbugEncode,
  decode: goldbugDecode,
  detect: goldbugDetect,
});

export { goldbugEncode, goldbugDecode, goldbugDetect, ORIGINAL_MAP, REVERSE_MAP, LEGACY_MAP };
