/*
 * dcode-extras · 记数系统补遗批（2026-10 · Agent A）
 * 希腊字母记数（Ionian）、希伯来字母记数、Unicode 各文字十进制数字。
 */

import { big, runOp } from "../lib/util.js";

const CAT = "dcode-extras-2026-10/cat-numeral";
const P = (key, label, ph) => ({ key, label, type: "text", default: "", placeholder: ph || "" });
const SEL = (key, label, def, opts) => ({ key, label, type: "select", default: def, options: opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o)) });

const GREEK_UNITS = ["", "α", "β", "γ", "δ", "ε", "ϝ", "ζ", "η", "θ"];
const GREEK_TENS = ["", "ι", "κ", "λ", "μ", "ν", "ξ", "ο", "π", "ϟ"];
const GREEK_HUNDREDS = ["", "ρ", "σ", "τ", "υ", "φ", "χ", "ψ", "ω", "ϡ"];
const GREEK_VAL = new Map();
GREEK_UNITS.forEach((ch, i) => { if (ch) GREEK_VAL.set(ch, i); });
GREEK_TENS.forEach((ch, i) => { if (ch) GREEK_VAL.set(ch, i * 10); });
GREEK_HUNDREDS.forEach((ch, i) => { if (ch) GREEK_VAL.set(ch, i * 100); });
GREEK_VAL.set("ϛ", 6); GREEK_VAL.set("ϙ", 90); GREEK_VAL.set("ͳ", 900);

function greekEncode(n) {
  if (n === 0n) return "0";
  if (n < 0n || n > 9999n) throw new Error("Ionian 希腊记数范围 0..9999");
  const d = n.toString().padStart(4, "0").split("").map(Number);
  let out = "";
  if (d[0]) out += "͵" + GREEK_UNITS[d[0]];
  if (d[1]) out += GREEK_HUNDREDS[d[1]];
  if (d[2]) out += GREEK_TENS[d[2]];
  if (d[3]) out += GREEK_UNITS[d[3]];
  return out;
}

function greekDecode(src) {
  const s = String(src).trim().replace(/[ʹ'’]/g, "").replace(/\s+/g, "").toLowerCase();
  if (s === "0") return "0";
  if (!s) throw new Error("需要希腊记数字符串");
  let total = 0, i = 0;
  while (i < s.length) {
    if (s[i] === "͵") {
      const v = GREEK_VAL.get(s[i + 1]);
      if (!v) throw new Error(`位置 ${i + 1} 缺少千位希腊字母`);
      total += v * 1000;
      i += 2;
      continue;
    }
    if (s.startsWith("στ", i)) { total += 6; i += 2; continue; }
    const v = GREEK_VAL.get(s[i]);
    if (v === undefined) throw new Error(`位置 ${i} 的字符「${s[i]}」不是希腊记数符号`);
    total += v;
    i++;
  }
  if (total < 1 || total > 9999) throw new Error(`解析结果 ${total} 超出 1..9999`);
  return String(total);
}

const HEB_VAL = new Map([
  ["א", 1], ["ב", 2], ["ג", 3], ["ד", 4], ["ה", 5], ["ו", 6], ["ז", 7], ["ח", 8], ["ט", 9],
  ["י", 10], ["כ", 20], ["ך", 20], ["ל", 30], ["מ", 40], ["ם", 40], ["נ", 50], ["ן", 50],
  ["ס", 60], ["ע", 70], ["פ", 80], ["ף", 80], ["צ", 90], ["ץ", 90],
  ["ק", 100], ["ר", 200], ["ש", 300], ["ת", 400],
]);
const HEB_LETTER = ["", "א", "ב", "ג", "ד", "ה", "ו", "ז", "ח", "ט"];

function hebrewUnder1000(n) {
  let out = "", x = n;
  for (const [v, ch] of [[400, "ת"], [300, "ש"], [200, "ר"], [100, "ק"]]) {
    while (x >= v) { out += ch; x -= v; }
  }
  if (x === 15) return out + "טו";
  if (x === 16) return out + "טז";
  for (const [v, ch] of [[90, "צ"], [80, "פ"], [70, "ע"], [60, "ס"], [50, "נ"], [40, "מ"], [30, "ל"], [20, "כ"], [10, "י"]]) {
    while (x >= v) { out += ch; x -= v; }
  }
  for (const [v, ch] of [[9, "ט"], [8, "ח"], [7, "ז"], [6, "ו"], [5, "ה"], [4, "ד"], [3, "ג"], [2, "ב"], [1, "א"]]) {
    while (x >= v) { out += ch; x -= v; }
  }
  return out;
}

function withGershayim(s) {
  return s.length > 1 ? s.slice(0, -1) + "״" + s.slice(-1) : s;
}

function hebrewEncode(n) {
  if (n === 0n) return "0";
  if (n < 0n || n > 9999n) throw new Error("希伯来记数范围 0..9999");
  const x = Number(n);
  const th = Math.floor(x / 1000), rem = x % 1000;
  let out = th ? HEB_LETTER[th] + "׳" : "";
  if (rem) out += withGershayim(hebrewUnder1000(rem));
  return out;
}

function hebrewDecode(src) {
  const s = String(src).trim();
  if (s === "0") return "0";
  if (!s) throw new Error("需要希伯来记数字符串");
  let total = 0, i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === "׳" || ch === "״" || ch === "'" || ch === '"' || /\s/.test(ch)) { i++; continue; }
    const v = HEB_VAL.get(ch);
    if (v === undefined) throw new Error(`位置 ${i} 的字符「${ch}」不是希伯来记数符号`);
    if (s[i + 1] === "׳") { total += v * 1000; i += 2; } else { total += v; i++; }
  }
  if (total < 1 || total > 9999) throw new Error(`解析结果 ${total} 超出 1..9999`);
  return String(total);
}

const SCRIPTS = [
  { id: "devanagari", label: "天城文", start: 0x0966 },
  { id: "gurmukhi", label: "果鲁穆奇", start: 0x0a66 },
  { id: "gujarati", label: "古吉拉特", start: 0x0ae6 },
  { id: "oriya", label: "奥里亚", start: 0x0b66 },
  { id: "tamil", label: "泰米尔", start: 0x0be6 },
  { id: "telugu", label: "泰卢固", start: 0x0c66 },
  { id: "kannada", label: "卡纳达", start: 0x0ce6 },
  { id: "malayalam", label: "马拉雅拉姆", start: 0x0d66 },
  { id: "thai", label: "泰文", start: 0x0e50 },
  { id: "lao", label: "老挝文", start: 0x0ed0 },
  { id: "tibetan", label: "藏文", start: 0x0f20 },
  { id: "myanmar", label: "缅甸文", start: 0x1040 },
  { id: "khmer", label: "高棉文", start: 0x17e0 },
  { id: "mongolian", label: "蒙古文", start: 0x1810 },
  { id: "limbu", label: "林布文", start: 0x1946 },
  { id: "newTaiLue", label: "新傣仂文", start: 0x19d0 },
  { id: "taiTham", label: "傣仂文", start: 0x1a80 },
  { id: "balinese", label: "巴厘文", start: 0x1b50 },
  { id: "sundanese", label: "巽他文", start: 0x1bb0 },
  { id: "lepcha", label: "雷布查文", start: 0x1c40 },
  { id: "olChiki", label: "奥尔奇基文", start: 0x1c50 },
  { id: "vai", label: "瓦伊文", start: 0xa620 },
  { id: "saurashtra", label: "索拉什特拉文", start: 0xa8d0 },
  { id: "kayahLi", label: "克耶文", start: 0xa900 },
  { id: "javanese", label: "爪哇文", start: 0xa9d0 },
  { id: "cham", label: "占文", start: 0xaa50 },
  { id: "meeteiMayek", label: "梅泰文", start: 0xabf0 },
  { id: "fullwidth", label: "全角数字", start: 0xff10 },
  { id: "mathBold", label: "数学粗体", start: 0x1d7ce },
  { id: "mathDouble", label: "数学双线", start: 0x1d7d8 },
];
const SCRIPT_BY_ID = new Map(SCRIPTS.map((s) => [s.id, s]));

function scriptOf(cp) {
  for (const s of SCRIPTS) if (cp >= s.start && cp <= s.start + 9) return { s, d: cp - s.start };
  return null;
}

export const OPS = [
  {
    id: "dcode-extras-2026-10/num-greek", cat: CAT,
    name: "希腊字母记数（Ionian）",
    desc: "1..9999 ↔ 希腊 Ionian 字母记数：α=1…θ=9、ι=10…ϟ=90、ρ=100…ϡ=900，千位用 ͵ 前缀（2024 = ͵βκδ）；decode 接受 ϝ/ϛ/στ 等变体与 keraia",
    params: [],
    encode(text) { return greekEncode(big(text) ?? (() => { throw new Error("需要整数"); })()); },
    decode(text) { return greekDecode(text); },
  },

  {
    id: "dcode-extras-2026-10/num-hebrew", cat: CAT,
    name: "希伯来字母记数",
    desc: "1..9999 ↔ 希伯来字母记数：א=1…ת=400，15/16 用 טו/טז 避讳，千位用 ׳、多字母用 ״（5784 = ה׳תשפ״ד；613 = תרי״ג）",
    params: [],
    encode(text) { return hebrewEncode(big(text) ?? (() => { throw new Error("需要整数"); })()); },
    decode(text) { return hebrewDecode(text); },
  },

  {
    id: "dcode-extras-2026-10/num-unicodedigits", cat: CAT,
    name: "Unicode 各文字十进制数字",
    desc: "ASCII 数字 ↔ 30 种 Unicode 文字的数字字形（天城文、泰文、藏文、缅甸文、高棉文、爪哇文、数学粗体等）；按 Unicode 区块连续码位映射，非数字字符原样保留",
    params: [SEL("script", "文字", "devanagari", SCRIPTS.map((s) => ({ value: s.id, label: `${s.label}（U+${s.start.toString(16).toUpperCase()}）` })))],
    encode(text, p) {
      const s = SCRIPT_BY_ID.get(String((p && p.script) || "devanagari"));
      if (!s) throw new Error("未知文字");
      let out = "";
      for (const ch of String(text)) {
        out += /[0-9]/.test(ch) ? String.fromCodePoint(s.start + Number(ch)) : ch;
      }
      return out;
    },
    decode(text, p) {
      const s = SCRIPT_BY_ID.get(String((p && p.script) || "devanagari"));
      if (!s) throw new Error("未知文字");
      let out = "";
      for (const ch of String(text)) {
        const cp = ch.codePointAt(0);
        if (cp >= s.start && cp <= s.start + 9) out += String(cp - s.start);
        else if (scriptOf(cp)) throw new Error(`字符「${ch}」属于其他文字的数字（当前选择 ${s.label}）`);
        else out += ch;
      }
      return out;
    },
  },
];
