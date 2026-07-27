/*
 * gematria.js — Gematria 数值密码（字母 ↔ 数值）。cat:'classic'。
 *
 * Gematria：把字母按固定表映射成数值。本 op 走「逐字母数值序列」契约
 * 保证可逆；同时可选在行尾附总和 Σ（gematria 常用的整词求和）。
 *
 * 收录体系（权威定义，未编造）：
 * ordinal English Ordinal：A=1 … Z=26
 * reduction Pythagorean（Full Reduction）：数字根 1-9 循环，A=1…I=9,J=1…R=9,S=1…Z=8
 * simple6 English Gematria / Simple：Ordinal ×6，A=6 … Z=156
 * reverse Reverse Ordinal：A=26 … Z=1
 * hebrew 希伯来标准值 Mispar Hechrachi：א=1…ת=400（尾字母 sofit 取标准值）
 * greek 希腊 Isopsephy：α=1…ω=800，含 stigma/koppa/sampi(6/90/900)
 *
 * 可逆性说明：
 * 逐字母序列 + 一一映射（ordinal/reverse/simple6/hebrew/greek）→ 完全可逆。
 * reduction 数字根多对一（如 1←a|j|s）→ decode 给出候选集 (a|j|s)，明确多解。
 * 行尾 Σ 总和仅供参考，decode 前自动剥离，不参与还原。
 */
import { register } from "./registry.js";

const LAT = "abcdefghijklmnopqrstuvwxyz";

// ---- 各体系正向表：char -> number ----
function buildLatin(fn) {
  const m = Object.create(null);
  for (let i = 0; i < 26; i++) m[LAT[i]] = fn(i); // i = ordinal-1
  return m;
}
const MAP_ORDINAL = buildLatin((i) => i + 1);            // A=1..Z=26
const MAP_REVERSE = buildLatin((i) => 26 - i);           // A=26..Z=1
const MAP_SIMPLE6 = buildLatin((i) => (i + 1) * 6);      // A=6..Z=156
const MAP_REDUCTION = buildLatin((i) => (i % 9) + 1);    // 数字根 1-9

// 希伯来标准值（尾字母映射到对应标准字母同值）
const MAP_HEBREW = {
  "א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5,
  "ו": 6, "ז": 7, "ח": 8, "ט": 9,
  "י": 10, "כ": 20, "ל": 30, "מ": 40, "נ": 50,
  "ס": 60, "ע": 70, "פ": 80, "צ": 90,
  "ק": 100, "ר": 200, "ש": 300, "ת": 400,
 // 尾字母 sofit（标准值 = 其非尾形）
  "ך": 20, "ם": 40, "ן": 50, "ף": 80, "ץ": 90,
};
// 反查用希伯来基准字母（每个标准值对应的规范字母）
const HEBREW_CANON = {
  1: "א", 2: "ב", 3: "ג", 4: "ד", 5: "ה",
  6: "ו", 7: "ז", 8: "ח", 9: "ט",
  10: "י", 20: "כ", 30: "ל", 40: "מ", 50: "נ",
  60: "ס", 70: "ע", 80: "פ", 90: "צ",
  100: "ק", 200: "ר", 300: "ש", 400: "ת",
};

// 希腊 Isopsephy（含 stigma=6 / koppa=90 / sampi=900；尾 sigma ς 同 σ=200）
const MAP_GREEK = {
  "α": 1, "β": 2, "γ": 3, "δ": 4, "ε": 5,
  "ϝ": 6, "ϛ": 6, // digamma / stigma
  "ζ": 7, "η": 8, "θ": 9,
  "ι": 10, "κ": 20, "λ": 30, "μ": 40, "ν": 50,
  "ξ": 60, "ο": 70, "π": 80, "ϟ": 90, // koppa
  "ρ": 100, "σ": 200, "ς": 200, // sigma / final sigma
  "τ": 300, "υ": 400, "φ": 500, "χ": 600,
  "ψ": 700, "ω": 800, "ϡ": 900, // sampi
};
const GREEK_CANON = {
  1: "α", 2: "β", 3: "γ", 4: "δ", 5: "ε",
  6: "ϝ", 7: "ζ", 8: "η", 9: "θ",
  10: "ι", 20: "κ", 30: "λ", 40: "μ", 50: "ν",
  60: "ξ", 70: "ο", 80: "π", 90: "ϟ",
  100: "ρ", 200: "σ", 300: "τ", 400: "υ", 500: "φ",
  600: "χ", 700: "ψ", 800: "ω", 900: "ϡ",
};

const FWD = {
  ordinal: MAP_ORDINAL,
  reduction: MAP_REDUCTION,
  simple6: MAP_SIMPLE6,
  reverse: MAP_REVERSE,
  hebrew: MAP_HEBREW,
  greek: MAP_GREEK,
};

// ---- 反向表：number -> [候选字符]（保持字母表顺序） ----
function buildRev(fwd, order) {
  const rev = new Map();
  for (const ch of order) {
    const v = fwd[ch];
    if (v == null) continue;
    if (!rev.has(v)) rev.set(v, []);
    rev.get(v).push(ch);
  }
  return rev;
}
const REV = {
  ordinal: buildRev(MAP_ORDINAL, LAT),
  reduction: buildRev(MAP_REDUCTION, LAT),
  simple6: buildRev(MAP_SIMPLE6, LAT),
  reverse: buildRev(MAP_REVERSE, LAT),
};
// 希伯来/希腊用规范字母表，保证 decode 唯一还原
REV.hebrew = new Map(Object.entries(HEBREW_CANON).map(([k, v]) => [Number(k), [v]]));
REV.greek = new Map(Object.entries(GREEK_CANON).map(([k, v]) => [Number(k), [v]]));

function normFor(mode, text) {
 // 希伯来无大小写；其余（含希腊）统一小写便于查表
  return mode === "hebrew" ? text : text.toLowerCase();
}

function gematriaEncode(text, p) {
  const mode = (p && p.mode) || "ordinal";
  const showTotal = !(p && p.showTotal === false);
  const fwd = FWD[mode] || MAP_ORDINAL;
  const norm = normFor(mode, String(text));
  const words = norm.split(/\s+/);
  const wordOut = [];
  let total = 0;
  for (const w of words) {
    const nums = [];
    for (const ch of w) {
      const v = fwd[ch];
      if (v != null) { nums.push(v); total += v; }
    }
    if (nums.length) wordOut.push(nums.join(" "));
  }
  let out = wordOut.join(" / ");
  if (showTotal && wordOut.length) out += `  |  Σ=${total}`;
  return out;
}

function gematriaDecode(text, p) {
  const mode = (p && p.mode) || "ordinal";
  const rev = REV[mode] || REV.ordinal;
 // 剥离行尾总和 Σ=... （| 之后全部丢弃）
  const s = String(text).replace(/\|.*$/s, "");
  const words = s.split("/");
  const wordOut = [];
  for (const w of words) {
    const tokens = w.trim().split(/[\s,.\-]+/).filter(Boolean);
    if (!tokens.length) continue;
    let chars = "";
    for (const tk of tokens) {
      const n = parseInt(tk, 10);
      if (Number.isNaN(n)) { chars += "?"; continue; }
      const cands = rev.get(n);
      if (!cands || !cands.length) chars += "?";
      else if (cands.length === 1) chars += cands[0];
      else chars += `(${cands.join("|")})`; // 多解，明确标注
    }
    wordOut.push(chars);
  }
  return wordOut.join(" ");
}

// ---- 注册 ----
register({
  id: "gematria", cat: "classic", name: "Gematria 数值",
  desc: "字母↔数值：Ordinal/Pythagorean/Simple×6/Reverse/希伯来/希腊，逐字母序列+可选总和 Σ",
  params: [
    {
      key: "mode", label: "体系", type: "select", default: "ordinal",
      options: [
        { value: "ordinal", label: "English Ordinal（A=1…Z=26）" },
        { value: "reduction", label: "Pythagorean 数字根（1-9 循环）" },
        { value: "simple6", label: "English/Simple（×6，A=6…Z=156）" },
        { value: "reverse", label: "Reverse Ordinal（A=26…Z=1）" },
        { value: "hebrew", label: "希伯来标准值（א=1…ת=400）" },
        { value: "greek", label: "希腊 Isopsephy（α=1…ω=800）" },
      ],
    },
    {
      key: "showTotal", label: "附总和 Σ", type: "bool", default: true,
    },
  ],
  encode: gematriaEncode, decode: gematriaDecode,
});

export {
  gematriaEncode, gematriaDecode,
  MAP_ORDINAL, MAP_REDUCTION, MAP_SIMPLE6, MAP_REVERSE, MAP_HEBREW, MAP_GREEK,
  FWD, REV,
};
