/*
 * morseExt.js — 摩斯 / 声光编码扩展组（T52，cat:'fancy'）。
 *
 * 覆盖：
 * - 美式摩斯码（American Morse Code，19 世纪大陆电报，含内部间隔/长划）
 * - 中文电码摩斯（4 位电码数字 ↔ 摩斯，中文需先查《标准电码本》）
 * - 敲击码 tap code（5×5 Polybius 方阵，I/J 合并）
 * - 旗语 semaphore（字母 ↔ 双旗方向对，基于 Wikipedia Flag semaphore）
 * - DTMF 双音多频（按键 ↔ 频率对，ITU-T Q.23）
 * - 摩斯节奏可视化（· − ↔ . - 符号规范化）
 *
 * 红线：
 * - 不与 fancy.js id:"morse"（ITU-R M.1677 国际摩斯）重复
 * - 敲击码统一由本文件 id:"tapCode" 承担（merge 参数选 I/J 合并 或 K→C 合并），fancy.js 不再重复注册
 * - 码表照抄 Wikipedia / ITU / CyberChef 标准，不编造
 */
import { register } from "./registry.js";

// ============ 1. 美式摩斯码（American Morse Code） ============
// 码表照抄 Wikipedia "American Morse code"。
// 约定：. 点，- 普通划，_ 长划（用于 L），码内间隔用空格（C/O/R/Y/Z 有内部间隔）。
// 字母间用 " / " 分隔。
const AMERICAN_MORSE = {
  "A": ".-", "B": "-...", "C": ".. .", "D": "-..", "E": ".", "F": ".-.",
  "G": "--.", "H": "....", "I": "..", "J": "-.-.", "K": "-.-", "L": "_",
  "M": "--", "N": "-.", "O": ". .", "P": ".....", "Q": "..-.", "R": ". ..",
  "S": "...", "T": "-", "U": "..-", "V": "...-", "W": ".--", "X": ".-..",
  "Y": ".. ..", "Z": "... .",
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
  "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
};
const AMERICAN_MORSE_REV = {};
for (const [k, v] of Object.entries(AMERICAN_MORSE)) AMERICAN_MORSE_REV[v] = k;

function americanMorseEncode(text) {
 // 字母码内含空格（C/O/R/Y/Z 有内部间隔），故字母间用 " / " 分隔，词间用 " // "。
  return text.toUpperCase().split(/\s+/).filter(Boolean).map((word) =>
    [...word].map((ch) => AMERICAN_MORSE[ch] || ch).join(" / ")
  ).join(" // ");
}
function americanMorseDecode(text) {
 // 词间 // 拆词，字母间 / 拆字母，字母码内空格保留参与查表。
  return text.trim().split(/\s*\/\/\s*/).map((word) =>
    word.trim().split(/\s*\/\s*/).filter(Boolean).map((c) => AMERICAN_MORSE_REV[c] || "?").join("")
  ).join(" ");
}

// ============ 2. 中文电码摩斯（4 位电码数字 ↔ 摩斯） ============
// 数字摩斯（同 ITU）。中文需先查《标准中文电码本》转 4 位数字。
const DIGIT_MORSE = {
  "0": "-----", "1": ".----", "2": "..---", "3": "...--", "4": "....-",
  "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
};
const DIGIT_MORSE_REV = {};
for (const [k, v] of Object.entries(DIGIT_MORSE)) DIGIT_MORSE_REV[v] = k;

function cnTelegraphEncode(digits) {
  const s = String(digits).replace(/\D/g, "");
  if (!s) throw new Error("中文电码摩斯: 输入须含数字");
 // 每 4 位一组（电码格式），组内数字间空格，组间用 / 分隔
  const groups = [];
  for (let i = 0; i < s.length; i += 4) groups.push(s.slice(i, i + 4));
  return groups.map((g) => [...g].map((d) => DIGIT_MORSE[d]).join(" ")).join(" / ");
}
function cnTelegraphDecode(morse) {
 // 摩斯 → 数字串（每 4 位空格分组，便于查电码本）
  const groups = morse.trim().split(/\s*\/\s*/);
  const digits = groups.map((g) =>
    g.trim().split(/\s+/).filter(Boolean).map((c) => DIGIT_MORSE_REV[c] || "?").join("")
  ).join(" ");
  return digits;
}

// ============ 3. 敲击码 tap code（5×5 Polybius） ============
// 26 字母塞不进 5×5，需合并一格，两种通行约定（merge 参数）：
// I/J 合并（默认）——I 与 J 同格，方阵含 K：
// (1,1)=A (1,2)=B (1,3)=C (1,4)=D (1,5)=E
// (2,1)=F (2,2)=G (2,3)=H (2,4)=I/J (2,5)=K
// (3,1)=L (3,2)=M (3,3)=N (3,4)=O (3,5)=P
// (4,1)=Q (4,2)=R (4,3)=S (4,4)=T (4,5)=U
// (5,1)=V (5,2)=W (5,3)=X (5,4)=Y (5,5)=Z
// K→C 合并——K 并入 C 格，方阵含 J（无 K）：
// (1,*)=A B C D E (2,*)=F G H I J (3,*)=L M N O P
// (4,*)=Q R S T U (5,*)=V W X Y Z
const TAP_GRID_IJ = [
  ["A", "B", "C", "D", "E"],
  ["F", "G", "H", "I", "K"],
  ["L", "M", "N", "O", "P"],
  ["Q", "R", "S", "T", "U"],
  ["V", "W", "X", "Y", "Z"],
];
const TAP_GRID_KC = [
  ["A", "B", "C", "D", "E"],
  ["F", "G", "H", "I", "J"],
  ["L", "M", "N", "O", "P"],
  ["Q", "R", "S", "T", "U"],
  ["V", "W", "X", "Y", "Z"],
];
// 各方阵的 字母→"行列" 反查表，并补上合并字母的别名。
function buildTapRev(grid, alias) {
  const rev = {};
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) rev[grid[r][c]] = String(r + 1) + String(c + 1);
  }
  for (const [from, to] of Object.entries(alias)) rev[from] = rev[to];
  return rev;
}
const TAP_REV_IJ = buildTapRev(TAP_GRID_IJ, { J: "I" }); // J 并到 I
const TAP_REV_KC = buildTapRev(TAP_GRID_KC, { K: "C" }); // K 并到 C

function tapSelect(p) {
  return (p && p.merge === "kc")
    ? { grid: TAP_GRID_KC, rev: TAP_REV_KC }
    : { grid: TAP_GRID_IJ, rev: TAP_REV_IJ };
}
function tapEncode(text, p) {
  const { rev } = tapSelect(p);
  const up = String(text).toUpperCase().replace(/[^A-Z]/g, "");
  if (!up) throw new Error("tap code: 输入须含字母");
 // compat=true 输出连写坐标串（外部工具常见形式）；默认每组空格分隔便于阅读
  return [...up].map((ch) => rev[ch] || "?").join((p && p.compat) ? "" : " ");
}
function tapDecode(text, p) {
  const { grid } = tapSelect(p);
  const pairs = String(text).trim().split(/[\s,]+/).filter(Boolean)
 // 坐标恒为 2 位数字，故连写串可无歧义拆分（外部工具常输出无分隔的 2315313134…）
    .flatMap((s) => (/^\d+$/.test(s) && s.length > 2 && s.length % 2 === 0
      ? s.match(/\d{2}/g)
      : [s]));
  let out = "";
  for (const s of pairs) {
    const m = s.match(/^(\d)\s*(\d)$/);
    if (!m) { out += "?"; continue; }
    const r = Number(m[1]) - 1, c = Number(m[2]) - 1;
    if (r < 0 || r > 4 || c < 0 || c > 4) { out += "?"; continue; }
    out += grid[r][c]; // I/J 版 (2,4)→I；K→C 版 (1,3)→C
  }
  return out;
}

// ============ 4. 旗语 semaphore（字母 ↔ 双旗方向对） ============
// 8 方向：Down, DownLeft, DownRight, Left, Right, UpLeft, UpRight, Up
// 字母表照抄 Wikipedia "Flag semaphore"（双手位置组合）。
const SEMAPHORE_DIR = ["Down", "DownLeft", "DownRight", "Left", "Right", "UpLeft", "UpRight", "Up"];
// 字母 → [旗1方向, 旗2方向]
const SEMAPHORE_TABLE = {
  "A": ["Down", "UpRight"],
  "B": ["Down", "Right"],
  "C": ["Down", "DownRight"],
  "D": ["Down", "UpLeft"],
  "E": ["Down", "Left"],
  "F": ["Down", "Up"],
  "G": ["Down", "DownLeft"],
  "H": ["DownLeft", "UpRight"],
  "I": ["DownLeft", "Right"],
  "J": ["DownLeft", "DownRight"],
  "K": ["DownLeft", "UpLeft"],
  "L": ["DownLeft", "Left"],
  "M": ["DownLeft", "Up"],
  "N": ["DownLeft", "Down"],
  "O": ["Left", "UpRight"],
  "P": ["Left", "Right"],
  "Q": ["Left", "DownRight"],
  "R": ["Left", "UpLeft"],
  "S": ["Left", "Up"],
  "T": ["Left", "Down"],
  "U": ["UpLeft", "UpRight"],
  "V": ["UpLeft", "Right"],
  "W": ["UpLeft", "DownRight"],
  "X": ["UpLeft", "Up"],
  "Y": ["UpLeft", "Down"],
  "Z": ["Up", "UpRight"],
};
const SEMAPHORE_REV = {};
for (const [k, v] of Object.entries(SEMAPHORE_TABLE)) SEMAPHORE_REV[v.join("+")] = k;

function semaphoreEncode(text) {
  const up = text.toUpperCase().replace(/[^A-Z]/g, "");
  if (!up) throw new Error("semaphore: 输入须含字母");
  return [...up].map((ch) => {
    const pair = SEMAPHORE_TABLE[ch];
    return pair ? pair.join("+") : "?";
  }).join(" ");
}
function semaphoreDecode(text) {
  const pairs = String(text).trim().split(/\s+/).filter(Boolean);
  return pairs.map((p) => SEMAPHORE_REV[p] || "?").join("");
}

// ============ 5. DTMF 双音多频（ITU-T Q.23，run 单向） ============
// 行频 × 列频 → 键
const DTMF_ROW = [697, 770, 852, 941];
const DTMF_COL = [1209, 1336, 1477, 1633];
const DTMF_KEYS = [
  ["1", "2", "3", "A"],
  ["4", "5", "6", "B"],
  ["7", "8", "9", "C"],
  ["*", "0", "#", "D"],
];
const DTMF_KEY_TO_FREQ = {};
for (let r = 0; r < 4; r++) {
  for (let c = 0; c < 4; c++) {
    DTMF_KEY_TO_FREQ[DTMF_KEYS[r][c]] = [DTMF_ROW[r], DTMF_COL[c]];
  }
}
function dtmfRun(text) {
  const s = String(text).trim().toUpperCase();
  if (!s) throw new Error("DTMF: 空输入");
  const lines = [];
  for (const ch of s) {
    const freq = DTMF_KEY_TO_FREQ[ch];
    if (freq) {
      lines.push(ch + " → " + freq[0] + " Hz + " + freq[1] + " Hz");
    } else if (ch === " " || ch === ",") {
      lines.push("（间隔）");
    } else {
      lines.push(ch + " → 非 DTMF 键");
    }
  }
  return lines.join("\n");
}

// ============ 6. 摩斯节奏可视化（· − ↔ . - 符号规范化） ============
// 把任意摩斯点划符号（· ‧ ∙ ｡ ＊ / − – — ― ⁻ 等）规范化。
// encode: → ".-" 风格；decode: → "·−" 风格。
const DOT_VARIANTS = /[·‧∙｡＊.]/g;
const DASH_VARIANTS = /[−–—―‐‑‒﹣\-]/g;

function normalizeToAscii(morse) {
  return String(morse).replace(DASH_VARIANTS, "-").replace(DOT_VARIANTS, ".");
}
function normalizeToUnicode(morse) {
  return String(morse).replace(DASH_VARIANTS, "−").replace(DOT_VARIANTS, "·");
}


// ============ 注册 ============
register({
  id: "americanMorse", cat: "fancy", name: "美式摩斯码",
  desc: "American Morse Code（19 世纪大陆电报，含内部间隔/长划 _，字母间 / 分隔）",
  params: [],
  encode: (t) => americanMorseEncode(t),
  decode: (t) => americanMorseDecode(t),
});

register({
  id: "cnTelegraphMorse", cat: "fancy", name: "中文电码摩斯",
  desc: "4 位中文电码数字 ↔ 摩斯（每 4 位一组，中文需先查《标准电码本》）",
  params: [],
  encode: (t) => cnTelegraphEncode(t),
  decode: (t) => cnTelegraphDecode(t),
});

register({
  id: "tapCode", cat: "fancy", name: "敲击码 Tap Code",
  desc: "5×5 Polybius 方阵敲击码（行列数字对，空格分隔；可选 I/J 合并或 K→C 合并）",
  params: [
    { key: "merge", label: "合并约定", type: "select", default: "ij",
      options: [
        { value: "ij", label: "I/J 合并（含 K）" },
        { value: "kc", label: "K→C 合并（含 J）" },
      ],
    },
    { key: "compat", label: "兼容模式（坐标连写，不加空格）", type: "bool", default: false },
  ],
  encode: (t, p) => tapEncode(t, p),
  decode: (t, p) => tapDecode(t, p),
});

register({
  id: "semaphore", cat: "fancy", name: "旗语 Semaphore",
  desc: "字母 ↔ 双旗方向对（8 方向，基于 Wikipedia Flag semaphore）",
  params: [],
  encode: (t) => semaphoreEncode(t),
  decode: (t) => semaphoreDecode(t),
});

register({
  id: "dtmf", cat: "fancy", name: "DTMF 双音多频",
  desc: "DTMF 按键 → 行列频率对（ITU-T Q.23，697-941 × 1209-1633 Hz）",
  params: [],
  run: (t) => dtmfRun(t),
});

register({
  id: "morseRhythm", cat: "fancy", name: "摩斯节奏规范化",
  desc: "摩斯点划符号规范化（· − ↔ . -，支持多种点划变体）",
  params: [],
  encode: (t) => normalizeToAscii(t),
  decode: (t) => normalizeToUnicode(t),
});


export {
  americanMorseEncode, americanMorseDecode,
  cnTelegraphEncode, cnTelegraphDecode,
  tapEncode, tapDecode,
  semaphoreEncode, semaphoreDecode,
  dtmfRun,
  normalizeToAscii, normalizeToUnicode,
};
