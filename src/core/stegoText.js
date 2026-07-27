/*
 * stegoText.js — 隐写文本检测组（T63，cat:'stego'）。
 *
 * 定位：与 stego.js（编码/解码）正交——本文件只做「检测 / 分析 / 透视」
 * 不修改 stego.js 的任何编码逻辑。所有 op 均为单向 run（输出报告文本）。
 *
 * 覆盖：
 * zwScan 零宽 / 不可见字符扫描器（位置 + 高亮 + 统计 + 剥离）
 * confusablesScan 同形异义字（Homoglyph）检测：拉丁 / 西里尔 / 希腊混用
 * unicodeNormalize Unicode 规范化 NFC/NFD/NFKC/NFKD（含变化点 + NFKC 往返）
 * whitespaceScan 空白字符隐写检测（多种空白 + 行尾 LSB 解码尝试）
 * bidiScan 双向控制符检测（Trojan Source U+202E 等 + 风险评级 + 剥离）
 * charInspect 字符属性透视（码位 / UTF-8 / UTF-16 / 脚本 / 类别 / Block）
 *
 * 红线：
 * - 只新建本文件，不碰 stego.js / stegoImage.js / qrcode.js 等现有 stego op。
 * - 检测类用 run 单向；不提供 encode/decode（不动原 stego 编码逻辑）。
 * - 注册契约：register({id, cat:"stego", name, desc, params, run})。
 *
 * 不冲突现有 op id：
 * stego.js : zeroWidth/zeroChar/zwTags/zwVarSel/emojiSubst/hxw/tadpole
 * stegoImage.js: lsbImage/pixelJihad/arnoldCat/imageBasic/lsbMulti/pngText/pngHeight/exifExtract/bitplaneSlicing/imageDiff
 * qrcode.js : qrGen/qrParse/barcodeIdentify
 */
import { register } from "./registry.js";

// ============================================================
// 字符表：不可见格式字符（不含 Bidi 控制，单独在 bidiScan 处理）
// ============================================================
const INVISIBLE_NAMES = {
  0x00ad: "SOFT HYPHEN",
  0x180e: "MONGOLIAN VOWEL SEPARATOR",
  0x200b: "ZERO WIDTH SPACE",
  0x200c: "ZERO WIDTH NON-JOINER (ZWNJ)",
  0x200d: "ZERO WIDTH JOINER (ZWJ)",
  0x200e: "LEFT-TO-RIGHT MARK (LRM)",
  0x200f: "RIGHT-TO-LEFT MARK (RLM)",
  0x2060: "WORD JOINER",
  0x2061: "FUNCTION APPLICATION",
  0x2062: "INVISIBLE TIMES",
  0x2063: "INVISIBLE SEPARATOR",
  0x2064: "INVISIBLE PLUS",
  0x206a: "INHIBIT SYMMETRIC SWAPPING",
  0x206b: "ACTIVATE SYMMETRIC SWAPPING",
  0x206c: "INHIBIT ARABIC FORM SHAPING",
  0x206d: "ACTIVATE ARABIC FORM SHAPING",
  0x206e: "NATIONAL DIGIT SHAPES",
  0x206f: "NOMINAL DIGIT SHAPES",
  0xfeff: "ZERO WIDTH NO-BREAK SPACE / BOM",
  0xfff9: "INTERLINEAR ANNOTATION ANCHOR",
  0xfffa: "INTERLINEAR ANNOTATION SEPARATOR",
  0xfffb: "INTERLINEAR ANNOTATION TERMINATOR",
};

// Bidi 控制符（Trojan Source 攻击向量）
const BIDI_NAMES = {
  0x061c: "ARABIC LETTER MARK (ALM)",
  0x202a: "LEFT-TO-RIGHT EMBEDDING (LRE)",
  0x202b: "RIGHT-TO-LEFT EMBEDDING (RLE)",
  0x202c: "POP DIRECTIONAL FORMATTING (PDF)",
  0x202d: "LEFT-TO-RIGHT OVERRIDE (LRO)",
  0x202e: "RIGHT-TO-LEFT OVERRIDE (RLO)",
  0x2066: "LEFT-TO-RIGHT ISOLATE (LRI)",
  0x2067: "RIGHT-TO-LEFT ISOLATE (RLI)",
  0x2068: "FIRST STRONG ISOLATE (FSI)",
  0x2069: "POP DIRECTIONAL ISOLATE (PDI)",
};

// Bidi 风险等级（Trojan Source 检测重点：RLO/LRO 强制覆盖）
const BIDI_RISK = {
  0x202e: "高危", // RLO — Trojan Source 主向量
  0x202d: "高危", // LRO
  0x202b: "中危",
  0x202a: "中危",
  0x2067: "中危",
  0x2068: "中危",
  0x061c: "低危",
  0x202c: "低危",
  0x2066: "低危",
  0x2069: "低危",
};

// 空白字符全集（含可见空格）
const WHITESPACE_NAMES = {
  0x0009: "CHARACTER TABULATION (Tab)",
  0x000a: "LINE FEED (LF)",
  0x000b: "LINE TABULATION (VT)",
  0x000c: "FORM FEED (FF)",
  0x000d: "CARRIAGE RETURN (CR)",
  0x0020: "SPACE",
  0x0085: "NEXT LINE (NEL)",
  0x00a0: "NO-BREAK SPACE (NBSP)",
  0x1680: "OGHAM SPACE MARK",
  0x2000: "EN QUAD",
  0x2001: "EM QUAD",
  0x2002: "EN SPACE",
  0x2003: "EM SPACE",
  0x2004: "THREE-PER-EM SPACE",
  0x2005: "FOUR-PER-EM SPACE",
  0x2006: "SIX-PER-EM SPACE",
  0x2007: "FIGURE SPACE",
  0x2008: "PUNCTUATION SPACE",
  0x2009: "THIN SPACE",
  0x200a: "HAIR SPACE",
  0x2028: "LINE SEPARATOR",
  0x2029: "PARAGRAPH SEPARATOR",
  0x202f: "NARROW NO-BREAK SPACE (NNBSP)",
  0x205f: "MEDIUM MATHEMATICAL SPACE (MMSP)",
  0x3000: "IDEOGRAPHIC SPACE",
};

// 普通空白（不算可疑）：Space / Tab / LF / CR
const NORMAL_WS = new Set([0x20, 0x09, 0x0a, 0x0d]);

// ============================================================
// 同形异义字（Homoglyph）表
// 来源：Unicode Confusables.txt 节选——CTF 常见拉丁 / 西里尔 / 希腊互混
// 结构：码位 → [脚本, 视觉等价字符, 等价码位]
// ============================================================
const CONFUSABLES = {
 // 西里尔小写
  0x0430: ["Cyrillic", "a", 0x0061],
  0x0435: ["Cyrillic", "e", 0x0065],
  0x043e: ["Cyrillic", "o", 0x006f],
  0x0440: ["Cyrillic", "p", 0x0070],
  0x0441: ["Cyrillic", "c", 0x0063],
  0x0445: ["Cyrillic", "x", 0x0078],
  0x0443: ["Cyrillic", "y", 0x0079],
 // 西里尔大写
  0x0410: ["Cyrillic", "A", 0x0041],
  0x0412: ["Cyrillic", "B", 0x0042],
  0x0415: ["Cyrillic", "E", 0x0045],
  0x041a: ["Cyrillic", "K", 0x004b],
  0x041c: ["Cyrillic", "M", 0x004d],
  0x041d: ["Cyrillic", "H", 0x0048],
  0x041e: ["Cyrillic", "O", 0x004f],
  0x0420: ["Cyrillic", "P", 0x0050],
  0x0421: ["Cyrillic", "C", 0x0043],
  0x0422: ["Cyrillic", "T", 0x0054],
  0x0423: ["Cyrillic", "Y", 0x0059],
  0x0425: ["Cyrillic", "X", 0x0058],
 // 希腊
  0x0391: ["Greek", "A", 0x0041],
  0x0392: ["Greek", "B", 0x0042],
  0x0395: ["Greek", "E", 0x0045],
  0x0396: ["Greek", "Z", 0x005a],
  0x0397: ["Greek", "H", 0x0048],
  0x0399: ["Greek", "I", 0x0049],
  0x039a: ["Greek", "K", 0x004b],
  0x039c: ["Greek", "M", 0x004d],
  0x039d: ["Greek", "N", 0x004e],
  0x039f: ["Greek", "O", 0x004f],
  0x03a1: ["Greek", "P", 0x0050],
  0x03a4: ["Greek", "T", 0x0054],
  0x03a5: ["Greek", "Y", 0x0059],
  0x03a7: ["Greek", "X", 0x0058],
  0x03b1: ["Greek", "a", 0x0061],
  0x03b5: ["Greek", "e", 0x0065],
  0x03b7: ["Greek", "n", 0x006e],
  0x03b9: ["Greek", "i", 0x0069],
  0x03ba: ["Greek", "k", 0x006b],
  0x03bc: ["Greek", "u", 0x0075],
  0x03bd: ["Greek", "v", 0x0076],
  0x03bf: ["Greek", "o", 0x006f],
  0x03c1: ["Greek", "p", 0x0070],
  0x03c4: ["Greek", "t", 0x0074],
  0x03c5: ["Greek", "u", 0x0075],
  0x03c7: ["Greek", "x", 0x0078],
 // R9 合并：并入原 confusablesDetect 独有的西里尔/全角同形字
  0x0261: ["Latin", "g", 0x0067],
  0x0405: ["Cyrillic", "S", 0x0053],
  0x0406: ["Cyrillic", "I", 0x0049],
  0x0408: ["Cyrillic", "J", 0x004a],
  0x0455: ["Cyrillic", "s", 0x0073],
  0x0456: ["Cyrillic", "i", 0x0069],
  0x0458: ["Cyrillic", "j", 0x006a],
  0x04ae: ["Cyrillic", "Y", 0x0059],
  0x04bb: ["Cyrillic", "h", 0x0068],
  0x0501: ["Cyrillic", "d", 0x0064],
  0x051b: ["Cyrillic", "q", 0x0071],
  0x051d: ["Cyrillic", "w", 0x0077],
  0xff41: ["Fullwidth", "a", 0x0061],
  0xff42: ["Fullwidth", "b", 0x0062],
  0xff43: ["Fullwidth", "c", 0x0063],
  0xff44: ["Fullwidth", "d", 0x0064],
  0xff45: ["Fullwidth", "e", 0x0065],
  0xff4c: ["Fullwidth", "l", 0x006c],
  0xff4f: ["Fullwidth", "o", 0x006f],
  0xff50: ["Fullwidth", "p", 0x0070],
};

// 对称表：每个码位既指向其等价物（另一脚本视角），用于双向检测
// Latin 等价码位 → [脚本是 "Latin", 对应的 Cyrillic/Greek 字符, 该码位]
const CONFUSABLES_BI = { ...CONFUSABLES };
for (const [cpStr, [script, _lookalike, lookalikeCp]] of Object.entries(CONFUSABLES)) {
  const cp = Number(cpStr);
  if (!CONFUSABLES_BI[lookalikeCp]) {
    CONFUSABLES_BI[lookalikeCp] = ["Latin", String.fromCodePoint(cp), cp];
  }
}

// ============================================================
// 通用工具
// ============================================================
const cpLabel = (cp) => "U+" + cp.toString(16).toUpperCase().padStart(4, "0");

function scriptOf(ch) {
  if (/\p{Script=Latin}/u.test(ch)) return "Latin";
  if (/\p{Script=Cyrillic}/u.test(ch)) return "Cyrillic";
  if (/\p{Script=Greek}/u.test(ch)) return "Greek";
  return "Other";
}

const GC_TABLE = [
  ["Lu", /\p{Lu}/u], ["Ll", /\p{Ll}/u], ["Lt", /\p{Lt}/u], ["Lm", /\p{Lm}/u], ["Lo", /\p{Lo}/u],
  ["Mn", /\p{Mn}/u], ["Mc", /\p{Mc}/u], ["Me", /\p{Me}/u],
  ["Nd", /\p{Nd}/u], ["Nl", /\p{Nl}/u], ["No", /\p{No}/u],
  ["Zs", /\p{Zs}/u], ["Zl", /\p{Zl}/u], ["Zp", /\p{Zp}/u],
  ["Cc", /\p{Cc}/u], ["Cf", /\p{Cf}/u], ["Cs", /\p{Cs}/u], ["Co", /\p{Co}/u],
  ["Pd", /\p{Pd}/u], ["Ps", /\p{Ps}/u], ["Pe", /\p{Pe}/u], ["Pc", /\p{Pc}/u], ["Po", /\p{Po}/u],
  ["Pi", /\p{Pi}/u], ["Pf", /\p{Pf}/u],
  ["Sm", /\p{Sm}/u], ["Sc", /\p{Sc}/u], ["Sk", /\p{Sk}/u], ["So", /\p{So}/u],
];

function generalCategory(ch) {
  for (const [code, re] of GC_TABLE) if (re.test(ch)) return code;
  return "Cn";
}

function utf8Hex(cp) {
  const bytes = new TextEncoder().encode(String.fromCodePoint(cp));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

function utf16Units(cp) {
  if (cp <= 0xffff) return [cp];
  const v = cp - 0x10000;
  return [0xd800 | (v >> 10), 0xdc00 | (v & 0x3ff)];
}

const BLOCKS = [
  [0x0000, 0x007f, "Basic Latin"],
  [0x0080, 0x00ff, "Latin-1 Supplement"],
  [0x0100, 0x017f, "Latin Extended-A"],
  [0x0180, 0x024f, "Latin Extended-B"],
  [0x0250, 0x02af, "IPA Extensions"],
  [0x02b0, 0x02ff, "Spacing Modifier Letters"],
  [0x0300, 0x036f, "Combining Diacritical Marks"],
  [0x0370, 0x03ff, "Greek and Coptic"],
  [0x0400, 0x04ff, "Cyrillic"],
  [0x0500, 0x052f, "Cyrillic Supplement"],
  [0x0530, 0x058f, "Armenian"],
  [0x0590, 0x05ff, "Hebrew"],
  [0x0600, 0x06ff, "Arabic"],
  [0x0700, 0x074f, "Syriac"],
  [0x0780, 0x07bf, "Thaana"],
  [0x0900, 0x097f, "Devanagari"],
  [0x0980, 0x09ff, "Bengali"],
  [0x0e00, 0x0e7f, "Thai"],
  [0x0e80, 0x0eff, "Lao"],
  [0x1100, 0x11ff, "Hangul Jamo"],
  [0x1e00, 0x1eff, "Latin Extended Additional"],
  [0x1f00, 0x1fff, "Greek Extended"],
  [0x2000, 0x206f, "General Punctuation"],
  [0x2070, 0x209f, "Superscripts and Subscripts"],
  [0x20a0, 0x20cf, "Currency Symbols"],
  [0x20d0, 0x20ff, "Combining Diacritical Marks for Symbols"],
  [0x2100, 0x214f, "Letterlike Symbols"],
  [0x2150, 0x218f, "Number Forms"],
  [0x2190, 0x21ff, "Arrows"],
  [0x2200, 0x22ff, "Mathematical Operators"],
  [0x2300, 0x23ff, "Miscellaneous Technical"],
  [0x2400, 0x243f, "Control Pictures"],
  [0x2460, 0x24ff, "Enclosed Alphanumerics"],
  [0x2500, 0x257f, "Box Drawing"],
  [0x2580, 0x259f, "Block Elements"],
  [0x25a0, 0x25ff, "Geometric Shapes"],
  [0x2600, 0x26ff, "Miscellaneous Symbols"],
  [0x2700, 0x27bf, "Dingbats"],
  [0x2c60, 0x2c7f, "Latin Extended-C"],
  [0x3000, 0x303f, "CJK Symbols and Punctuation"],
  [0x3040, 0x309f, "Hiragana"],
  [0x30a0, 0x30ff, "Katakana"],
  [0x3400, 0x4dbf, "CJK Unified Ideographs Extension A"],
  [0x4e00, 0x9fff, "CJK Unified Ideographs"],
  [0xa000, 0xa48f, "Yi Syllables"],
  [0xac00, 0xd7af, "Hangul Syllables"],
  [0xe000, 0xf8ff, "Private Use Area"],
  [0xf900, 0xfaff, "CJK Compatibility Ideographs"],
  [0xfb00, 0xfb4f, "Alphabetic Presentation Forms"],
  [0xfe00, 0xfe0f, "Variation Selectors"],
  [0xfe30, 0xfe4f, "CJK Compatibility Forms"],
  [0xff00, 0xffef, "Halfwidth and Fullwidth Forms"],
  [0xfff0, 0xffff, "Specials"],
  [0x10000, 0x1007f, "Linear B Syllabary"],
  [0x1d400, 0x1d7ff, "Mathematical Alphanumeric Symbols"],
  [0x1f300, 0x1f5ff, "Miscellaneous Symbols and Pictographs"],
  [0x1f600, 0x1f64f, "Emoticons"],
  [0x1f680, 0x1f6ff, "Transport and Map Symbols"],
  [0x1f900, 0x1f9ff, "Supplemental Symbols and Pictographs"],
  [0x20000, 0x2a6df, "CJK Unified Ideographs Extension B"],
  [0xe0000, 0xe007f, "Tags"],
  [0xe0100, 0xe01ef, "Variation Selectors Supplement"],
];

function blockOf(cp) {
  for (const [lo, hi, name] of BLOCKS) if (cp >= lo && cp <= hi) return name;
  return "Unknown Block";
}

// ============================================================
// 1) zwScan — 零宽 / 不可见字符扫描
// ============================================================
function zwScan(text, p = {}) {
  const chars = [...text];
  const hits = []; // {idx, cp, name}
  const counts = new Map(); // cp → count
  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i].codePointAt(0);
    const name = INVISIBLE_NAMES[cp];
    if (name) {
      hits.push({ idx: i, cp, name });
      counts.set(cp, (counts.get(cp) || 0) + 1);
    }
  }
  const lines = [];
  lines.push("=== 零宽 / 不可见字符扫描 ===");
  lines.push(`总码位数：${chars.length}`);
  lines.push(`命中不可见字符：${hits.length} 个`);
  lines.push("");
  if (hits.length === 0) {
    lines.push("（未发现不可见格式字符）");
    return lines.join("\n");
  }
  lines.push("[位置]  码位      Unicode 名称");
  for (const h of hits) {
    lines.push(`  ${String(h.idx).padStart(5)}   ${cpLabel(h.cp).padEnd(8)} ${h.name}`);
  }
  lines.push("");
 // 高亮视图：把不可见字符替换为 · 显示
  let highlight = "";
  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    highlight += INVISIBLE_NAMES[cp] ? "·" : ch;
  }
  lines.push("--- 高亮视图（· = 命中位置）---");
  lines.push(highlight);
  lines.push("");
 // stripped
  let stripped = "";
  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    if (!INVISIBLE_NAMES[cp]) stripped += ch;
  }
  lines.push("--- 剥离不可见字符后的文本 ---");
  lines.push(stripped);
  lines.push("");
 // 统计
  lines.push("--- 统计 ---");
  for (const [cp, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    lines.push(`${cpLabel(cp).padEnd(8)} ${INVISIBLE_NAMES[cp].padEnd(38)} ×${n}`);
  }
  return lines.join("\n");
}

// ============================================================
// 2) confusablesScan — 同形异义字检测
// ============================================================
function confusablesScan(text, p = {}) {
  const chars = [...text];
  const scriptCount = { Latin: 0, Cyrillic: 0, Greek: 0 };
  for (const ch of chars) {
    const s = scriptOf(ch);
    if (scriptCount[s] !== undefined) scriptCount[s]++;
  }
 // 主书写系统（多数票，并列时按 Latin > Cyrillic > Greek 优先）
  let dominant = "Latin", max = -1;
  for (const s of ["Latin", "Cyrillic", "Greek"]) {
    if (scriptCount[s] > max) { max = scriptCount[s]; dominant = s; }
  }
  const lines = [];
  lines.push("=== 同形异义字（Homoglyph）扫描 ===");
  lines.push(`总码位数：${chars.length}`);
  lines.push(`脚本分布：Latin ${scriptCount.Latin} / Cyrillic ${scriptCount.Cyrillic} / Greek ${scriptCount.Greek}`);
  lines.push(`主书写系统判定：${dominant}`);
  lines.push("");
 // 命中：CONFUSABLES_BI 表中存在 + 脚本 ≠ dominant
  const hits = [];
  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i].codePointAt(0);
    const entry = CONFUSABLES_BI[cp];
    if (!entry) continue;
    const [script, lookalike, lookalikeCp] = entry;
    if (script === dominant) continue; // 同脚本不算可疑
    hits.push({ idx: i, cp, script, lookalike, lookalikeCp });
  }
  if (hits.length === 0) {
    lines.push("（未发现跨脚本同形异义字）");
    return lines.join("\n");
  }
  lines.push(`可疑字符：${hits.length} 个（脚本 ≠ 主书写系统 ${dominant}）`);
  lines.push("");
  lines.push("[位置]  码位      字符  脚本        疑似伪装为");
  for (const h of hits) {
    lines.push(
      `  ${String(h.idx).padStart(5)}   ${cpLabel(h.cp).padEnd(8)} ${chars[h.idx]}     ${h.script.padEnd(11)} '${h.lookalike}' (${cpLabel(h.lookalikeCp)})`
    );
  }
  lines.push("");
 // 还原：把可疑字符替换为它的等价物（另一脚本的视觉同形字）
  let normalized = "";
  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    const entry = CONFUSABLES_BI[cp];
    if (entry && entry[0] !== dominant) normalized += entry[1];
    else normalized += ch;
  }
  lines.push("--- 替换为伪装目标后的文本 ---");
  lines.push(normalized);
  return lines.join("\n");
}

// ============================================================
// 3) unicodeNormalize — Unicode 规范化
// ============================================================
function unicodeNormalize(text, p = {}) {
  const form = (p && p.form) || "NFC";
  const validForms = ["NFC", "NFD", "NFKC", "NFKD"];
  if (!validForms.includes(form)) throw new Error("未知规范化形式: " + form);
  const chars = [...text];
  const normalized = text.normalize(form);
  const nChars = [...normalized];
  const lines = [];
  lines.push(`=== Unicode 规范化 (${form}) ===`);
  lines.push(`原码位数：${chars.length}`);
  lines.push(`规范化后码位数：${nChars.length}`);
  lines.push(`是否变化：${text === normalized ? "否" : "是"}`);
  lines.push("");
  lines.push("--- 规范化结果 ---");
  lines.push(normalized);
  lines.push("");
  if (text !== normalized) {
 // 找首个变化点（贪心逐码位比对）
    let firstDiff = -1;
    const minLen = Math.min(chars.length, nChars.length);
    for (let i = 0; i < minLen; i++) {
      if (chars[i] !== nChars[i]) { firstDiff = i; break; }
    }
    if (firstDiff === -1 && chars.length !== nChars.length) firstDiff = minLen;
    if (firstDiff >= 0) {
      lines.push(`--- 首个变化点：位置 ${firstDiff} ---`);
      const beforeCp = chars[firstDiff] != null ? chars[firstDiff].codePointAt(0) : null;
      const afterCp = nChars[firstDiff] != null ? nChars[firstDiff].codePointAt(0) : null;
      if (beforeCp !== null) lines.push(`  前：${cpLabel(beforeCp)} '${chars[firstDiff]}'`);
      if (afterCp !== null) lines.push(`  后：${cpLabel(afterCp)} '${nChars[firstDiff]}'`);
    }
 // 非 NFKC 时附 NFKC 往返参考（消除兼容性差异，confusables 检测常用标准形式）
    if (form !== "NFKC") {
      const rt = text.normalize("NFKC");
      lines.push("");
      lines.push("--- 参考：NFKC 往返（消除兼容性差异）---");
      lines.push(rt);
    }
  }
  return lines.join("\n");
}

// ============================================================
// 4) whitespaceScan — 空白字符隐写检测
// ============================================================
function whitespaceScan(text, p = {}) {
  const chars = [...text];
  const counts = new Map();
  const positions = [];
  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i].codePointAt(0);
    if (WHITESPACE_NAMES[cp]) {
      counts.set(cp, (counts.get(cp) || 0) + 1);
      positions.push({ idx: i, cp });
    }
  }
  const lines = [];
  lines.push("=== 空白字符隐写扫描 ===");
  lines.push(`总码位数：${chars.length}`);
  lines.push(`空白字符总数：${positions.length}`);
  lines.push("");
  const exotic = [...counts.keys()].filter((cp) => !NORMAL_WS.has(cp));
  lines.push("--- 类型统计 ---");
  for (const [cp, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const mark = !NORMAL_WS.has(cp) ? " ⚠" : "";
    lines.push(`${cpLabel(cp).padEnd(8)} ${WHITESPACE_NAMES[cp].padEnd(36)} ×${n}${mark}`);
  }
  if (exotic.length > 0) {
    lines.push("");
    lines.push(`⚠ 发现 ${exotic.length} 种非普通空白字符（Space/Tab/LF/CR 之外），可能用于隐写`);
  }
 // 行尾空白检测（Snow stego 类：行尾 Space/Tab 编码位）
  lines.push("");
  lines.push("--- 行尾空白检测（可能藏 Snow 类隐写）---");
  const flat = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const wsLines = flat.split("\n");
  let trailingCount = 0;
  const trailingHits = [];
  for (let li = 0; li < wsLines.length; li++) {
    const line = wsLines[li];
    const m = line.match(/[ \t]+$/);
    if (m) {
      trailingCount += m[0].length;
      trailingHits.push({ line: li + 1, seq: m[0], len: m[0].length });
    }
  }
  if (trailingHits.length === 0) {
    lines.push("（无行尾空格 / Tab）");
  } else {
    lines.push(`命中行数：${trailingHits.length}，行尾空白总数：${trailingCount}`);
    for (const h of trailingHits.slice(0, 20)) {
      const preview = h.seq.replace(/ /g, "·").replace(/\t/g, "→");
      lines.push(`  第 ${String(h.line).padStart(4)} 行：尾部 ${h.len} 个 [${preview}]`);
    }
    if (trailingHits.length > 20) lines.push(`  ... 共 ${trailingHits.length} 行`);
 // 尝试 LSB 解码：Space=0, Tab=1，每 8 位一字节
    let bits = "";
    for (const h of trailingHits) {
      for (const ch of h.seq) bits += ch === "\t" ? "1" : "0";
    }
    if (bits.length >= 8) {
      const byteCount = Math.floor(bits.length / 8);
      const bytes = [];
      for (let i = 0; i < byteCount; i++) bytes.push(parseInt(bits.substr(i * 8, 8), 2));
      const hexStr = bytes.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
      let asciiPreview = "";
      for (const b of bytes) asciiPreview += (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".";
      lines.push("");
      lines.push("--- 行尾空白 LSB 尝试（Space=0, Tab=1，每 8 位一字节）---");
      lines.push(`比特串（${bits.length} 位）：${bits.slice(0, 64)}${bits.length > 64 ? "..." : ""}`);
      lines.push(`字节（${byteCount}）：${hexStr}`);
      lines.push(`ASCII 预览：${asciiPreview}`);
    }
  }
  return lines.join("\n");
}

// ============================================================
// 5) bidiScan — 双向控制符检测（Trojan Source）
// ============================================================
function bidiScan(text, p = {}) {
  const chars = [...text];
  const hits = [];
  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i].codePointAt(0);
    if (BIDI_NAMES[cp]) hits.push({ idx: i, cp, name: BIDI_NAMES[cp], risk: BIDI_RISK[cp] || "低危" });
  }
  const lines = [];
  lines.push("=== 双向控制符扫描（Trojan Source 检测）===");
  lines.push(`总码位数：${chars.length}`);
  lines.push(`命中 Bidi 控制符：${hits.length} 个`);
  lines.push("");
  if (hits.length === 0) {
    lines.push("（未发现 Bidi 控制符，无 Trojan Source 迹象）");
    return lines.join("\n");
  }
  lines.push("[位置]  码位      Unicode 名称                                风险");
  for (const h of hits) {
    lines.push(`  ${String(h.idx).padStart(5)}   ${cpLabel(h.cp).padEnd(8)} ${h.name.padEnd(44)} ${h.risk}`);
  }
  const hasHigh = hits.some((h) => h.risk === "高危");
  const hasMid = hits.some((h) => h.risk === "中危");
  const overall = hasHigh ? "高危" : hasMid ? "中危" : "低危";
  lines.push("");
  lines.push(`总体风险：${overall}`);
  if (hasHigh) {
    lines.push("⚠ 检测到 RLO/LRO 强制方向覆盖符——典型 Trojan Source 攻击特征，");
    lines.push("  源代码中可能使逻辑在后端显示与前端渲染不一致。建议剥离后再审。");
  }
 // 剥离后的安全文本
  let stripped = "";
  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    if (!BIDI_NAMES[cp]) stripped += ch;
  }
  lines.push("");
  lines.push("--- 剥离 Bidi 控制符后的文本 ---");
  lines.push(stripped);
  return lines.join("\n");
}

// ============================================================
// 6) charInspect — 字符属性透视
// ============================================================
function charInspect(text, p = {}) {
  const chars = [...text];
  const lines = [];
  lines.push("=== 字符属性透视 ===");
  lines.push(`码位数：${chars.length}；UTF-16 单元数：${text.length}`);
  lines.push("");
  lines.push(" idx  码位      字符  UTF-8          UTF-16      脚本       类别  Block / 名称");
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const cp = ch.codePointAt(0);
    const u8 = utf8Hex(cp);
    const u16 = utf16Units(cp).map((v) => v.toString(16).toUpperCase().padStart(4, "0")).join(" ");
    const script = scriptOf(ch);
    const gc = generalCategory(ch);
    const block = blockOf(cp);
    const name = INVISIBLE_NAMES[cp] || BIDI_NAMES[cp] || WHITESPACE_NAMES[cp] || block;
    let display;
    if (gc === "Cc") display = "␣";
    else if (gc === "Cf") display = "·";
    else if (gc === "Zs") display = (cp === 0x20 ? "␠" : "□");
    else if (gc === "Zl" || gc === "Zp") display = "□";
    else display = ch;
    lines.push(
      `${String(i).padStart(4)}  ${cpLabel(cp).padEnd(8)} ${display}     ${u8.padEnd(14)} ${u16.padEnd(11)} ${script.padEnd(10)} ${gc.padEnd(5)} ${name}`
    );
  }
  return lines.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "zwScan", cat: "stego", name: "零宽字符扫描",
  desc: "扫描文本中所有不可见 Unicode 格式字符（零宽 / 连接符 / 标记），列位置 + 高亮 + 统计 + 剥离",
  params: [],
  run: zwScan,
});

register({
  id: "confusablesScan", cat: "stego", name: "同形异义字检测",
  desc: "Unicode Homoglyph 检测：拉丁 / 西里尔 / 希腊混用，识别伪装为拉丁字母的可疑字符",
  params: [],
  run: confusablesScan,
});

register({
  id: "unicodeNormalize", cat: "stego", name: "Unicode 规范化",
  desc: "NFC/NFD/NFKC/NFKD 四种规范化形式互转 + 变化点分析 + NFKC 往返",
  params: [
    { key: "form", label: "规范化形式", type: "select", default: "NFC",
      options: [
        { value: "NFC", label: "NFC（规范分解 + 合成）" },
        { value: "NFD", label: "NFD（规范分解）" },
        { value: "NFKC", label: "NFKC（兼容分解 + 合成）" },
        { value: "NFKD", label: "NFKD（兼容分解）" },
      ],
    },
  ],
  run: unicodeNormalize,
});

register({
  id: "whitespaceScan", cat: "stego", name: "空格隐写检测",
  desc: "扫描多种空白字符（NBSP / Em Space / Thin Space 等）+ 行尾空白 LSB 解码尝试（Snow 类）",
  params: [],
  run: whitespaceScan,
});

register({
  id: "bidiScan", cat: "stego", name: "双向控制符检测",
  desc: "Trojan Source 攻击检测：U+202E (RLO) / U+202D (LRO) 等 Bidi 控制符 + 风险评级 + 剥离",
  params: [],
  run: bidiScan,
});

register({
  id: "charInspect", cat: "stego", name: "字符属性透视",
  desc: "逐字符显示码位 / UTF-8 / UTF-16 / 脚本 / Unicode 类别 / Block 名称",
  params: [],
  run: charInspect,
});

export {
  zwScan, confusablesScan, unicodeNormalize,
  whitespaceScan, bidiScan, charInspect,
  INVISIBLE_NAMES, BIDI_NAMES, WHITESPACE_NAMES, CONFUSABLES, CONFUSABLES_BI,
  cpLabel, scriptOf, generalCategory, utf8Hex, utf16Units, blockOf,
};
