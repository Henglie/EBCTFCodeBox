/*
 * qqxiuzi_hex.js — QQ秀 hex 族 4 op（arrow/flower/ipa/letter 同构）。
 *
 * 算法来源：QQ秀异形字加密算法（arrow/flower/ipa/letter 四族同构）。
 * 4 个 hex 族同构，统一 _key + 4 套 16 项映射表。
 *
 * 统一算法（4 个一致）：
 * - _XOR_BASE = 48
 * - _key(pwd) = sum(ord(c) for c in pwd) ^ 48（含正则校验 ^[0-9A-Za-z_]+$，非法返回 0）
 * - encode: enc = [ord(c) ^ 48 ^ ek for c in text]
 * 若 max(enc) < 256 用 2 字符（v//16, v%16）后缀 "="，否则 4 字符后缀 "=="
 * - decode: 按 =/== 后缀决定 step（2 或 4），重组 enc，chr(enc ^ ek ^ 48)
 *
 * 4 套映射表（索引 0-15 → 显示字符）：
 * - arrow: ←↑→↓↔↕↖↗↘↙↰↱↲↳↺↻
 * - flower: chr(10043+v)，连续 Unicode 区段（✻✼✽✾✿❀❁❂❃❄❅❆❇❈❉❊）
 * - ipa: ɐɑɒɓɔɕɖɘəɛɜɟɠɡɢɣ（IPA 辅音，注意 ɡ 是 U+0261 非 ASCII g）
 * - letter: TUVWXYZABCNOPQRS（16 项打乱字母）
 *
 * op 设计（双向 + 契约 + detect）：
 * - qqxiuzi_arrow: encode/decode 用 arrow 表
 * - qqxiuzi_flower: encode/decode 用 flower 表
 * - qqxiuzi_ipa: encode/decode 用 ipa 表
 * - qqxiuzi_letter: encode/decode 用 letter 表
 *
 * 单向依赖：仅 import registry.js，不反向 import 上层。
 */
import { register } from "./registry.js";

// ============ 常量 ============
const XOR_BASE = 48;
const KEY_RE = /^[0-9A-Za-z_]+$/;

// ============ 4 套映射表（索引 0-15） ============

// arrow: _ARROW_ENC = {0:"←",1:"↑",...,15:"↻"}
const ARROW_ENC = ["←", "↑", "→", "↓", "↔", "↕", "↖", "↗", "↘", "↙", "↰", "↱", "↲", "↳", "↺", "↻"];
const ARROW_DEC = new Map(ARROW_ENC.map((ch, i) => [ch, i]));

// flower: _chr(v) = chr(10043 + v)，连续 Unicode 区段
const FLOWER_BASE = 10043;
const FLOWER_ENC = Array.from({ length: 16 }, (_, v) => String.fromCharCode(FLOWER_BASE + v));
const FLOWER_DEC = new Map(FLOWER_ENC.map((ch, i) => [ch, i]));

// ipa: _IPA = ['ɐ','ɑ','ɒ','ɓ','ɔ','ɕ','ɖ','ɘ','ə','ɛ','ɜ','ɟ','ɠ','ɡ','ɢ','ɣ']
// 注意 'ɡ' 是 U+0261（IPA），不是 ASCII 'g' U+0067
const IPA_ENC = ["ɐ", "ɑ", "ɒ", "ɓ", "ɔ", "ɕ", "ɖ", "ɘ", "ə", "ɛ", "ɜ", "ɟ", "ɠ", "ɡ", "ɢ", "ɣ"];
const IPA_DEC = new Map(IPA_ENC.map((ch, i) => [ch, i]));

// letter: _ENC = {0:"T",1:"U",...,15:"S"}
const LETTER_ENC = ["T", "U", "V", "W", "X", "Y", "Z", "A", "B", "C", "N", "O", "P", "Q", "R", "S"];
const LETTER_DEC = new Map(LETTER_ENC.map((ch, i) => [ch, i]));

// ============ 统一 _key ============
// sum(ord(c) for c in pwd) ^ 48，含正则校验，非法返回 0
function deriveKey(pwd) {
  if (!pwd) return 0;
  if (!KEY_RE.test(pwd)) return 0;
  let s = 0;
  for (const c of pwd) s += c.codePointAt(0);
  return s ^ XOR_BASE;
}

// ============ 通用 hex 族 encode ============
// encTable: 16 项字符数组（索引 0-15 → 显示字符）
function hexEncode(text, key, encTable) {
  if (!text) return "";
  const ek = deriveKey(key);
  const enc = [];
  for (const c of text) {
    enc.push(c.codePointAt(0) ^ XOR_BASE ^ ek);
  }
  const mx = enc.length ? Math.max(...enc) : 0;
  let body = "";
  if (mx < 256) {
    for (const v of enc) {
      body += encTable[v >> 4] + encTable[v & 15];
    }
    return body + "=";
  }
  for (const v of enc) {
    body +=
      encTable[(v >> 12) & 15] +
      encTable[(v >> 8) & 15] +
      encTable[(v >> 4) & 15] +
      encTable[v & 15];
  }
  return body + "==";
}

// ============ 通用 hex 族 decode ============
// decMap: char → 0-15
function hexDecode(text, key, decMap) {
  if (!text) return "";
  const ek = deriveKey(key);
  const s2 = text.endsWith("==");
  const body = s2 ? text.slice(0, -2) : text.endsWith("=") ? text.slice(0, -1) : text;
  const step = s2 ? 4 : 2;
 // 用 Array.from 正确处理多字节 Unicode 字符（按码点切分）
  const chars = Array.from(body);
  let r = "";
  for (let i = 0; i + step <= chars.length; i += step) {
    let enc = decMap.get(chars[i]) * 16 + decMap.get(chars[i + 1]);
    if (step === 4) {
      enc = enc * 256 + decMap.get(chars[i + 2]) * 16 + decMap.get(chars[i + 3]);
    }
    r += String.fromCodePoint(enc ^ ek ^ XOR_BASE);
  }
  return r;
}

// ============ 4 个 detect 函数 ============
// 置信度分层：特征明确（特殊字符集）0.3-0.6，字母表与英文重叠降权 0.1-0.35

function detectArrow(text) {
  if (!text || typeof text !== "string") return 0;
 // 去末尾 =/==
  const s2 = text.endsWith("==");
  const body = s2 ? text.slice(0, -2) : text.endsWith("=") ? text.slice(0, -1) : text;
  if (!body) return 0;
  const chars = Array.from(body);
  let hit = 0;
  for (const c of chars) if (ARROW_DEC.has(c)) hit++;
  const ratio = hit / chars.length;
 // 全箭头 + 有后缀 → 0.5；全箭头无后缀但够长 → 0.3
  if (ratio === 1) {
    if (s2 || text.endsWith("=")) return 0.5;
    if (chars.length >= 4) return 0.3;
  }
  return 0;
}

function detectFlower(text) {
  if (!text || typeof text !== "string") return 0;
  const s2 = text.endsWith("==");
  const body = s2 ? text.slice(0, -2) : text.endsWith("=") ? text.slice(0, -1) : text;
  if (!body) return 0;
  const chars = Array.from(body);
  let hit = 0;
  for (const c of chars) if (FLOWER_DEC.has(c)) hit++;
  const ratio = hit / chars.length;
  if (ratio === 1) {
    if (s2 || text.endsWith("=")) return 0.5;
    if (chars.length >= 4) return 0.3;
  }
  return 0;
}

function detectIpa(text) {
  if (!text || typeof text !== "string") return 0;
  const s2 = text.endsWith("==");
  const body = s2 ? text.slice(0, -2) : text.endsWith("=") ? text.slice(0, -1) : text;
  if (!body) return 0;
  const chars = Array.from(body);
  let hit = 0;
  for (const c of chars) if (IPA_DEC.has(c)) hit++;
  const ratio = hit / chars.length;
  if (ratio === 1) {
    if (s2 || text.endsWith("=")) return 0.5;
    if (chars.length >= 4) return 0.3;
  }
  return 0;
}

function detectLetter(text) {
  if (!text || typeof text !== "string") return 0;
 // letter 表与英文重叠，必须有 =/== 后缀才给置信度，避免普通英文误报
  const s2 = text.endsWith("==");
  const hasSuffix = s2 || text.endsWith("=");
  if (!hasSuffix) return 0;
  const body = s2 ? text.slice(0, -2) : text.slice(0, -1);
  if (!body) return 0;
  const chars = Array.from(body);
  let hit = 0;
  for (const c of chars) if (LETTER_DEC.has(c)) hit++;
  const ratio = hit / chars.length;
 // 全 letter 字符 + 有后缀 → 0.35（字母表重叠降权）
  if (ratio === 1 && chars.length >= 2) return 0.35;
  return 0;
}

// ============ 4 个 op 注册 ============

register({
  id: "qqxiuzi_arrow",
  cat: "fancy",
  name: "QQ秀·箭头",
  desc: "QQ秀箭头密码（hex 双字符 + 箭头映射）",
  params: [{ key: "key", label: "密钥（数字/字母/下划线，可空）", type: "text", default: "", placeholder: "如 key1" }],
  encode: (t, p) => hexEncode(t, (p && p.key) || "", ARROW_ENC),
  decode: (t, p) => hexDecode(t, (p && p.key) || "", ARROW_DEC),
  detect: detectArrow,
});

register({
  id: "qqxiuzi_flower",
  cat: "fancy",
  name: "QQ秀·花",
  desc: "QQ秀花密码（hex 双字符 + 花符映射）",
  params: [{ key: "key", label: "密钥（数字/字母/下划线，可空）", type: "text", default: "", placeholder: "如 key1" }],
  encode: (t, p) => hexEncode(t, (p && p.key) || "", FLOWER_ENC),
  decode: (t, p) => hexDecode(t, (p && p.key) || "", FLOWER_DEC),
  detect: detectFlower,
});

register({
  id: "qqxiuzi_ipa",
  cat: "fancy",
  name: "QQ秀·IPA",
  desc: "QQ秀 IPA 密码（hex 双字符 + IPA 辅音映射）",
  params: [{ key: "key", label: "密钥（数字/字母/下划线，可空）", type: "text", default: "", placeholder: "如 key1" }],
  encode: (t, p) => hexEncode(t, (p && p.key) || "", IPA_ENC),
  decode: (t, p) => hexDecode(t, (p && p.key) || "", IPA_DEC),
  detect: detectIpa,
});

register({
  id: "qqxiuzi_letter",
  cat: "fancy",
  name: "QQ秀·字母",
  desc: "QQ秀字母密码（hex 双字符 + 打乱字母映射）",
  params: [{ key: "key", label: "密钥（数字/字母/下划线，可空）", type: "text", default: "", placeholder: "如 key1" }],
  encode: (t, p) => hexEncode(t, (p && p.key) || "", LETTER_ENC),
  decode: (t, p) => hexDecode(t, (p && p.key) || "", LETTER_DEC),
  detect: detectLetter,
});
