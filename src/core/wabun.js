/*
 * wabun.js — Wabun code 和文摩尔斯（和文モールス符号）。cat:'fancy'
 *
 * 日语假名 ↔ 摩尔斯电码。码表照抄 Wabun code 标准表（Wikipedia
 * "Wabun code" / 和文モールス符号），含浊点 ゛、半浊点 ゜、长音 ー
 * 読点 、等记号，不编造。
 *
 * 记号约定（与本项目 morse / morseExt 类风格对齐）：
 * - 每个假名的点划串用空格分隔（点 . 划 -）。
 * - 输入词（空白分隔）之间用 " / " 分隔。
 * 浊音/半浊音的处理：和文摩尔斯里浊点 ゛、半浊点 ゜是独立记号，紧跟在
 * 清音假名之后。故 encode 先把输入 NFD 分解（ガ → カ + 濁点），逐个查表；
 * decode 遇浊/半浊记号时补回组合用记号（U+3099/U+309A）再 NFC 合成回浊音。
 * 平假名输入内部先归一到片假名再查表。
 */
import { register } from "./registry.js";

// ============ Wabun code 标准码表（片假名 → 摩尔斯） ============
const WABUN = {
  "イ": ".-",     "ロ": ".-.-",   "ハ": "-...",   "ニ": "-.-.",
  "ホ": "-..",    "ヘ": ".",       "ト": "..-..",  "チ": "..-.",
  "リ": "--.",    "ヌ": "....",    "ル": "-.--.",  "ヲ": ".---",
  "ワ": "-.-",    "カ": ".-..",    "ヨ": "--",      "タ": "-.",
  "レ": "---",    "ソ": "---.",    "ツ": ".--.",   "ネ": "--.-",
  "ナ": ".-.",    "ラ": "...",     "ム": "-",       "ウ": "..-",
  "ヰ": ".-..-",  "ノ": "..--",    "オ": ".-...",  "ク": "...-",
  "ヤ": ".--",    "マ": "-..-",    "ケ": "-.--",   "フ": "--..",
  "コ": "----",   "エ": "-.---",   "テ": ".-.--",  "ア": "--.--",
  "サ": "-.-.-",  "キ": "-.-..",   "ユ": "-..--",  "メ": "-...-",
  "ミ": "..-.-",  "シ": "--.-.",   "ヱ": ".--..",  "ヒ": "--..-",
  "モ": "-..-.",  "セ": ".---.",   "ス": "---.-",  "ン": ".-.-.",
 // 记号
  "゛": "..",       // 濁点 dakuten（浊点，紧跟清音后）
  "゜": "..--.",    // 半濁点 handakuten（半浊点）
  "ー": ".--.-",    // 長音符 chōonpu（长音）
  "、": ".-.-.-",   // 読点（逗号 / 句读）
  "（": "-.--.-",   // 下向括弧（开括号）
  "）": ".-..-.",   // 上向括弧（闭括号）
};

// 反查表（摩尔斯 → 片假名/记号）。标准表内各码唯一，若有覆盖以先注册为准。
const WABUN_REV = {};
for (const [k, v] of Object.entries(WABUN)) {
  if (!(v in WABUN_REV)) WABUN_REV[v] = k;
}

// 组合用浊音/半浊音记号（NFC 合成）：U+3099 濁点、U+309A 半濁点。
const CB_DAKUTEN = "゙";
const CB_HANDAKUTEN = "゚";

// 小假名 → 大假名（Wabun 不区分拗音/促音的大小，统一归一到大假名）。
const SMALL_TO_LARGE = {
  "ァ": "ア", "ィ": "イ", "ゥ": "ウ", "ェ": "エ", "ォ": "オ",
  "ッ": "ツ", "ャ": "ヤ", "ュ": "ユ", "ョ": "ヨ", "ヮ": "ワ",
  "ヵ": "カ", "ヶ": "ケ",
};

// 平假名 → 片假名（码点区间 0x3041..0x3096 平移 +0x60），再把小假名归一到大假名。
function toKatakana(ch) {
  const cp = ch.codePointAt(0);
  let k = (cp >= 0x3041 && cp <= 0x3096) ? String.fromCodePoint(cp + 0x60) : ch;
  return SMALL_TO_LARGE[k] || k;
}

function wabunEncode(text) {
  if (!text) return "";
 // NFD 分解：把浊音拆成 清音 + 组合记号（ガ → カ + U+3099）。
  const words = String(text).normalize("NFD").split(/\s+/).filter(Boolean);
  return words.map((word) => {
    const codes = [];
    for (const ch of word) {
      if (ch === CB_DAKUTEN) { codes.push(WABUN["゛"]); continue; }
      if (ch === CB_HANDAKUTEN) { codes.push(WABUN["゜"]); continue; }
      const kata = toKatakana(ch);
      const code = WABUN[kata];
      codes.push(code != null ? code : ("[" + ch + "]"));
    }
    return codes.join(" ");
  }).join(" / ");
}

function wabunDecode(text) {
  if (!text) return "";
  const words = String(text).trim().split(/\s*\/\s*/);
  const out = words.map((word) => {
    const tokens = word.trim().split(/\s+/).filter(Boolean);
    let s = "";
    for (const tk of tokens) {
      const kana = WABUN_REV[tk];
      if (kana === undefined) { s += "?"; continue; }
      if (kana === "゛") { s += CB_DAKUTEN; continue; }      // 补组合浊点，末尾 NFC 合成
      if (kana === "゜") { s += CB_HANDAKUTEN; continue; }   // 补组合半浊点
      s += kana;
    }
    return s;
  }).join(" ");
  return out.normalize("NFC"); // カ+U+3099 → ガ
}

// ============ 注册 ============
register({
  id: "wabun", cat: "fancy", name: "Wabun 和文摩尔斯",
  desc: "日语假名 ↔ 摩尔斯（和文モールス符号标准表，含浊点 ゛半浊点 ゜长音 ー；假名点划间空格、词间 / 分隔）",
  params: [],
  encode: (t) => wabunEncode(t),
  decode: (t) => wabunDecode(t),
});

export { wabunEncode, wabunDecode };
