/*
 * fracmorse.js — 分数摩斯 Fractionated Morse（cat:'fancy'）。
 *
 * 先把明文转摩斯（字母间加 'x'、词间成 'xx'），再按 26 个三元组（{'.', '-', 'x'} 组合）
 * 分块，每个三元组映射到 26 字母密钥表中的一个字母。双向可逆。
 *
 * 算法来源：pycipher 0.5.2 FracMorse（James Lyons，MIT）——
 * table 26 三元组、morsetab/invmorse 摩斯表、enmorse/demorse 逻辑逐字照抄，不编造。
 *
 * 密钥：pycipher 直接吃 26 字符置换表（默认 'ROUNDTABLECFGHIJKMPQSVWXYZ'）。
 * 本 op 额外支持「关键字」模式：给关键字自动构造 26 字符 keyed alphabet（去重打头+顺补）。
 *
 * 红线：编码表照抄；往返测试通过
 */
import { register } from "./registry.js";

// pycipher fracmorse.py 第 19 行 table，26 个三元组，位置对应密钥表 A..Z 槽位。
const TABLE = [
  "...", "..-", "..x", ".-.", ".--", ".-x", ".x.", ".x-", ".xx", "-..",
  "-.-", "-.x", "--.", "---", "--x", "-x.", "-x-", "-xx", "x..", "x.-",
  "x.x", "x-.", "x--", "x-x", "xx.", "xx-",
];

// pycipher fracmorse.py morsetab（明文字符 → 摩斯；空格映射空串）。
const MORSETAB = {
  " ": "", "(": "-.--.-", ",": "--..--", ".": ".-.-.-", "0": "-----",
  "2": "..---", "4": "....-", "6": "-....", "8": "---..", ":": "---...",
  "B": "-...", "D": "-..", "F": "..-.", "H": "....", "J": ".---",
  "L": ".-..", "N": "-.", "P": ".--.", "R": ".-.", "T": "-", "V": "...-",
  "X": "-..-", "Z": "--..", "'": ".----.", ")": "-.--.-", "-": "-....-",
  "/": "-..-.", "1": ".----", "3": "...--", "5": ".....", "7": "--...",
  "9": "----.", ";": "-.-.-.", "?": "..--..", "A": ".-", "C": "-.-.",
  "E": ".", "G": "--.", "I": "..", "K": "-.-", "M": "--", "O": "---",
  "Q": "--.-", "S": "...", "U": "..-", "W": ".--", "Y": "-.--", "_": "..--.-",
};
// invmorse（摩斯 → 明文字符），由 MORSETAB 反转（空串 → 空格）。
const INVMORSE = {};
for (const [k, v] of Object.entries(MORSETAB)) {
  if (!(v in INVMORSE)) INVMORSE[v] = k;
}

// 允许字符集合（pycipher enmorse 正则保留的字符）。
const ALLOWED = new Set(Object.keys(MORSETAB));

// 由关键字构造 26 字符 keyed alphabet（去重打头 + 剩余 A-Z 顺补）。
function keyedAlphabet(keyword) {
  const kw = (keyword || "").toUpperCase();
  let out = "";
  for (const ch of kw) if (ch >= "A" && ch <= "Z" && !out.includes(ch)) out += ch;
  for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") if (!out.includes(ch)) out += ch;
  return out;
}

// enmorse：明文 → 摩斯串，每字符后加 'x'，词间空格自身贡献 'x' → 词界成 'xx'。
function enmorse(string) {
  const s = [...string.toUpperCase()].filter((c) => ALLOWED.has(c)).join("")
    .replace(/  +/g, " ").replace(/ +$/, "");
  let ret = "";
  for (const c of s) ret += MORSETAB[c] + "x";
  return ret;
}

// demorse：摩斯串 → 明文，按 'x' 切分，未知码写 'Q'。
function demorse(string) {
  let s = string;
  if (s[s.length - 1] !== "x") s += "x";
  let ret = "";
  let letter = "";
  for (const ch of s) {
    if (ch !== "x") { letter += ch; continue; }
    ret += letter in INVMORSE ? INVMORSE[letter] : "Q";
    letter = "";
  }
  return ret;
}

function normalizeKey(key) {
  const raw = (key || "").toUpperCase().replace(/[^A-Z]/g, "");
 // 26 个不重复字母 → 直接当置换表；否则按关键字构造 keyed alphabet。
  if (raw.length === 26 && new Set(raw).size === 26) return raw;
  return keyedAlphabet(raw || "ROUNDTABLE");
}

function fracMorseEncode(text, key = "ROUNDTABLECFGHIJKMPQSVWXYZ") {
  const k = normalizeKey(key);
  let morse = enmorse(text);
  const mod = morse.length % 3;
  if (mod === 1) morse = morse.slice(0, -1);
  else if (mod === 2) morse = morse + "x";
  const map = {};
  TABLE.forEach((tri, i) => { map[tri] = k[i]; });
  let ct = "";
  for (let i = 0; i < morse.length; i += 3) ct += map[morse.slice(i, i + 3)];
  return ct;
}

function fracMorseDecode(text, key = "ROUNDTABLECFGHIJKMPQSVWXYZ") {
  const k = normalizeKey(key);
  const map = {};
  for (let i = 0; i < 26; i++) map[k[i]] = TABLE[i];
  let morse = "";
  for (const ch of text.toUpperCase()) {
    if (!(ch in map)) throw new Error(`分数摩斯: 密文字符 '${ch}' 不在密钥表中`);
    morse += map[ch];
  }
  return demorse(morse);
}

register({
  id: "fracmorse", cat: "fancy", name: "分数摩斯 FracMorse",
  desc: "明文转摩斯后按三元组分块，映射到 26 字母密钥表（pycipher FracMorse）",
  params: [{ key: "key", label: "26 字母表或关键字", type: "text", default: "ROUNDTABLECFGHIJKMPQSVWXYZ" }],
  encode: (t, p) => fracMorseEncode(t, (p && p.key) || "ROUNDTABLECFGHIJKMPQSVWXYZ"),
  decode: (t, p) => fracMorseDecode(t, (p && p.key) || "ROUNDTABLECFGHIJKMPQSVWXYZ"),
});

export { fracMorseEncode, fracMorseDecode, enmorse, demorse, keyedAlphabet, TABLE };
