/*
 * candidate_qqxiuzi_hex_T500.js — 千千秀字 hex 族 4 op 修复候选（arrow/flower/ipa/letter 同构）。
 *
 * T500 候选 = T441 拒绝型候选基线 + 原版契约对齐（Wayback 快照证据）：
 *   1. T441 基线：BMP 密文零变化（52 原站向量逐字过）；增补平面编码显式拒绝
 *      （参考移植 Python ord 同构在此截低 16 位，原版服务端行为不可考——快照证实算法在
 *      wenbenjiamiShow.php 服务端执行，前端从未内嵌，故增补平面原版行为永久 BLOCKED）；
 *      decode 表外字符/长度截断显式报错，不再静默产 \0（现用实测 C1: "中中="→"0"、C2: 丢尾组）。
 *   2. T500 增量·原版密码契约（2023-05-10 / 2026-04-26 快照逐字证据）：
 *      「密码可以是数字、字母和下划线，最多九位」，前端超九位报「错误：密码最多九位！」。
 *      现用实现静默接受 10 位密码（实测 D1）、非法字符密码静默降级为无密钥（实测 D3，
 *      安全风险：用户以为已加密）。候选改为显式报错；原版服务端对越约密码的行为不可考，
 *      候选选择拒绝而非静默忽略（与 T441 红线一致：不静默丢数据）。
 *   3. 主名/desc 与 T459 现用产品对齐（千千秀字·X，不回退 QQ秀 旧名）。
 *
 * 行为变化清单（相对现用 src/core/qqxiuzi_hex.js，交 M 裁决）：
 *   - encode/decode 密码 >9 位或含非法字符 → 报错（原：静默接受/静默降级无密钥）
 *   - encode 含 >0xFFFF 码点 → 报错（原：静默截低 16 位，𤬃→䬃）
 *   - decode 表外字符 / 长度非组倍数 → 报错（原：静默产 "0"/丢尾组）
 *   - BMP + 合法密码（≤9 位）全部输入：密文逐字节不变
 *
 * 单向依赖：仅 import registry.js。
 */
import { register } from "./registry.js";

// ============ 常量 ============
const XOR_BASE = 48;
const KEY_RE = /^[0-9A-Za-z_]+$/;

// ============ 原版密码契约（T500，快照证据）============
// 原版 wenbenjiami.php 前端（2015/2018/2020/2023/2026 快照一致）：
//   if (key.length>9) { $("show").value="错误：密码最多九位！"; return; }
//   页面文案：「密码可以是数字、字母和下划线，最多九位」
// 通过 → 返回 null；不通过 → 抛错（原版为前端拦截，服务端行为不可考）。
function checkKeyContract(pwd) {
  if (pwd === undefined || pwd === null || pwd === "") return null;
  if (pwd.length > 9) {
    throw new Error("千千秀字：密码最多九位（原版工具页约束），当前 " + pwd.length + " 位");
  }
  if (!KEY_RE.test(pwd)) {
    throw new Error("千千秀字：密码只能包含数字、字母和下划线（原版工具页约束），当前含非法字符");
  }
  return null;
}

// ============ 统一 _key ============
// sum(ord(c) for c in pwd) ^ 48（契约校验前置，非法不再静默返回 0）
function deriveKey(pwd) {
  if (!pwd) return 0;
  checkKeyContract(pwd);
  let s = 0;
  for (const c of pwd) s += c.codePointAt(0);
  return s ^ XOR_BASE;
}

// ============ 4 套映射表（索引 0-15） ============

const ARROW_ENC = ["←", "↑", "→", "↓", "↔", "↕", "↖", "↗", "↘", "↙", "↰", "↱", "↲", "↳", "↺", "↻"];
const ARROW_DEC = new Map(ARROW_ENC.map((ch, i) => [ch, i]));

const FLOWER_BASE = 10043;
const FLOWER_ENC = Array.from({ length: 16 }, (_, v) => String.fromCharCode(FLOWER_BASE + v));
const FLOWER_DEC = new Map(FLOWER_ENC.map((ch, i) => [ch, i]));

// 'ɡ' 是 U+0261（IPA），不是 ASCII 'g' U+0067
const IPA_ENC = ["ɐ", "ɑ", "ɒ", "ɓ", "ɔ", "ɕ", "ɖ", "ɘ", "ə", "ɛ", "ɜ", "ɟ", "ɠ", "ɡ", "ɢ", "ɣ"];
const IPA_DEC = new Map(IPA_ENC.map((ch, i) => [ch, i]));

const LETTER_ENC = ["T", "U", "V", "W", "X", "Y", "Z", "A", "B", "C", "N", "O", "P", "Q", "R", "S"];
const LETTER_DEC = new Map(LETTER_ENC.map((ch, i) => [ch, i]));

// ============ 通用 hex 族 encode ============
function hexEncode(text, key, encTable) {
  if (!text) return "";
  const ek = deriveKey(key);
  const enc = [];
  for (const c of text) {
    enc.push(c.codePointAt(0) ^ XOR_BASE ^ ek);
  }
  // 宽模式 4 组 nibble 仅落 16 位；>0xFFFF 静默截断（现用缺陷 B1：𤬃 U+24B03 → 䬃 U+4B03）→ 显式拒绝
  for (let i = 0; i < enc.length; i++) {
    if (enc[i] > 0xffff) {
      const cp = enc[i] ^ ek ^ XOR_BASE;
      throw new Error(
        "千千秀字 hex 族：码点 U+" + cp.toString(16).toUpperCase() +
        " 超出原版 16 位（4 位 nibble）表示范围，编码会静默截断丢高位（现用实测 𤬃→䬃），已拒绝。" +
        "原版增补平面行为不可考（算法在原站服务端，页面与接口均已下线）"
      );
    }
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
function hexDecode(text, key, decMap) {
  if (!text) return "";
  const ek = deriveKey(key);
  const s2 = text.endsWith("==");
  const body = s2 ? text.slice(0, -2) : text.endsWith("=") ? text.slice(0, -1) : text;
  const step = s2 ? 4 : 2;
  const chars = Array.from(body);
  if (chars.length % step !== 0) {
    throw new Error("千千秀字 hex 族：密文长度不合法（去后缀后 " + chars.length + " 个符号，非 " + step + " 的倍数），疑似截断或非本格式密文");
  }
  if (chars.length === 0) return "";
  let r = "";
  for (let i = 0; i < chars.length; i += step) {
    const nib = [];
    for (let j = 0; j < step; j++) {
      const v = decMap.get(chars[i + j]);
      if (v === undefined) {
        throw new Error("千千秀字 hex 族：密文含映射表外字符 " + JSON.stringify(chars[i + j]) + "，非本格式或已损坏（现用实现此处静默产垃圾字符）");
      }
      nib.push(v);
    }
    let encv = nib[0] * 16 + nib[1];
    if (step === 4) encv = encv * 256 + nib[2] * 16 + nib[3];
    r += String.fromCodePoint(encv ^ ek ^ XOR_BASE);
  }
  return r;
}

// ============ 4 个 detect 函数（与现用一致，零变化） ============

function detectArrow(text) {
  if (!text || typeof text !== "string") return 0;
  const s2 = text.endsWith("==");
  const body = s2 ? text.slice(0, -2) : text.endsWith("=") ? text.slice(0, -1) : text;
  if (!body) return 0;
  const chars = Array.from(body);
  let hit = 0;
  for (const c of chars) if (ARROW_DEC.has(c)) hit++;
  const ratio = hit / chars.length;
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
  const s2 = text.endsWith("==");
  const hasSuffix = s2 || text.endsWith("=");
  if (!hasSuffix) return 0;
  const body = s2 ? text.slice(0, -2) : text.slice(0, -1);
  if (!body) return 0;
  const chars = Array.from(body);
  let hit = 0;
  for (const c of chars) if (LETTER_DEC.has(c)) hit++;
  const ratio = hit / chars.length;
  if (ratio === 1 && chars.length >= 2) return 0.35;
  return 0;
}

// ============ 4 个 op 注册（名称/desc 对齐 T459 现用产品） ============

register({
  id: "qqxiuzi_arrow", family: "qqxiuzi", familyLabel: "arrow",
  cat: "fancy",
  name: "千千秀字·箭头",
  desc: "千千秀字箭头密码（原称「QQ秀箭头」；符号表出自千千秀字网站，与腾讯 QQ 秀无关。hex 双字符 + 箭头映射）",
  params: [{ key: "key", label: "密钥（数字/字母/下划线，最多九位，可空）", type: "text", default: "", placeholder: "如 key1" }],
  encode: (t, p) => hexEncode(t, (p && p.key) || "", ARROW_ENC),
  decode: (t, p) => hexDecode(t, (p && p.key) || "", ARROW_DEC),
  detect: detectArrow,
});

register({
  id: "qqxiuzi_flower", family: "qqxiuzi", familyLabel: "flower",
  cat: "fancy",
  name: "千千秀字·花",
  desc: "千千秀字花密码（原称「QQ秀花」；hex 双字符 + 花符映射）",
  params: [{ key: "key", label: "密钥（数字/字母/下划线，最多九位，可空）", type: "text", default: "", placeholder: "如 key1" }],
  encode: (t, p) => hexEncode(t, (p && p.key) || "", FLOWER_ENC),
  decode: (t, p) => hexDecode(t, (p && p.key) || "", FLOWER_DEC),
  detect: detectFlower,
});

register({
  id: "qqxiuzi_ipa", family: "qqxiuzi", familyLabel: "ipa",
  cat: "fancy",
  name: "千千秀字·IPA",
  desc: "千千秀字 IPA 密码（原称「QQ秀 IPA」；hex 双字符 + IPA 辅音映射）",
  params: [{ key: "key", label: "密钥（数字/字母/下划线，最多九位，可空）", type: "text", default: "", placeholder: "如 key1" }],
  encode: (t, p) => hexEncode(t, (p && p.key) || "", IPA_ENC),
  decode: (t, p) => hexDecode(t, (p && p.key) || "", IPA_DEC),
  detect: detectIpa,
});

register({
  id: "qqxiuzi_letter", family: "qqxiuzi", familyLabel: "letter",
  cat: "fancy",
  name: "千千秀字·字母",
  desc: "千千秀字字母密码（原称「QQ秀字母」；hex 双字符 + 打乱字母映射）",
  params: [{ key: "key", label: "密钥（数字/字母/下划线，最多九位，可空）", type: "text", default: "", placeholder: "如 key1" }],
  encode: (t, p) => hexEncode(t, (p && p.key) || "", LETTER_ENC),
  decode: (t, p) => hexDecode(t, (p && p.key) || "", LETTER_DEC),
  detect: detectLetter,
});
