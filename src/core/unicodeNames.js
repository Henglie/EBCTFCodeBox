/*
 * unicodeNames.js — Unicode 码位元信息（Block / 平面 / General Category / 名称提示）。
 *
 * 定位：精简但实用的通用映射，供「万能查看器」逐字符表用。不追求完整 UnicodeData.txt
 * 只覆盖主流 Block + 常见字符名 + 冷僻字用 Block 名兜底。
 *
 * 硬事实来源：Unicode Block 区间与平面划分照 unicode.org（Blocks.txt / 平面定义）核对，非编造。
 *
 * 导出：
 * blockOf(cp) → Block 名称（英文，如 "CJK Unified Ideographs"）
 * planeOf(cp) → { plane:number, name:string }
 * categoryOf(cp) → General Category 粗分类（Lu/Ll/Lo/Nd/Zs/Cf/Cc/…）+ 中文标签
 * nameHint(cp) → 字符名称提示（有名表给名，否则 Block 名 + 序号兜底）
 */

import { INVISIBLES } from "./invisibles.js";

// ============================================================
// Unicode Block 区间表（官方 Blocks.txt 主流区段，[start, end, name]）
// 按 start 升序排列，blockOf 用二分查找。
// ============================================================
const BLOCKS = [
  [0x0000, 0x007F, "Basic Latin"],
  [0x0080, 0x00FF, "Latin-1 Supplement"],
  [0x0100, 0x017F, "Latin Extended-A"],
  [0x0180, 0x024F, "Latin Extended-B"],
  [0x0250, 0x02AF, "IPA Extensions"],
  [0x02B0, 0x02FF, "Spacing Modifier Letters"],
  [0x0300, 0x036F, "Combining Diacritical Marks"],
  [0x0370, 0x03FF, "Greek and Coptic"],
  [0x0400, 0x04FF, "Cyrillic"],
  [0x0500, 0x052F, "Cyrillic Supplement"],
  [0x0530, 0x058F, "Armenian"],
  [0x0590, 0x05FF, "Hebrew"],
  [0x0600, 0x06FF, "Arabic"],
  [0x0700, 0x074F, "Syriac"],
  [0x0750, 0x077F, "Arabic Supplement"],
  [0x0780, 0x07BF, "Thaana"],
  [0x07C0, 0x07FF, "NKo"],
  [0x0800, 0x083F, "Samaritan"],
  [0x0840, 0x085F, "Mandaic"],
  [0x0900, 0x097F, "Devanagari"],
  [0x0980, 0x09FF, "Bengali"],
  [0x0A00, 0x0A7F, "Gurmukhi"],
  [0x0A80, 0x0AFF, "Gujarati"],
  [0x0B00, 0x0B7F, "Oriya"],
  [0x0B80, 0x0BFF, "Tamil"],
  [0x0C00, 0x0C7F, "Telugu"],
  [0x0C80, 0x0CFF, "Kannada"],
  [0x0D00, 0x0D7F, "Malayalam"],
  [0x0D80, 0x0DFF, "Sinhala"],
  [0x0E00, 0x0E7F, "Thai"],
  [0x0E80, 0x0EFF, "Lao"],
  [0x0F00, 0x0FFF, "Tibetan"],
  [0x1000, 0x109F, "Myanmar"],
  [0x10A0, 0x10FF, "Georgian"],
  [0x1100, 0x11FF, "Hangul Jamo"],
  [0x1200, 0x137F, "Ethiopic"],
  [0x13A0, 0x13FF, "Cherokee"],
  [0x1400, 0x167F, "Unified Canadian Aboriginal Syllabics"],
  [0x1680, 0x169F, "Ogham"],
  [0x16A0, 0x16FF, "Runic"],
  [0x1700, 0x171F, "Tagalog"],
  [0x1780, 0x17FF, "Khmer"],
  [0x1800, 0x18AF, "Mongolian"],
  [0x1900, 0x194F, "Limbu"],
  [0x1E00, 0x1EFF, "Latin Extended Additional"],
  [0x1F00, 0x1FFF, "Greek Extended"],
  [0x2000, 0x206F, "General Punctuation"],
  [0x2070, 0x209F, "Superscripts and Subscripts"],
  [0x20A0, 0x20CF, "Currency Symbols"],
  [0x20D0, 0x20FF, "Combining Diacritical Marks for Symbols"],
  [0x2100, 0x214F, "Letterlike Symbols"],
  [0x2150, 0x218F, "Number Forms"],
  [0x2190, 0x21FF, "Arrows"],
  [0x2200, 0x22FF, "Mathematical Operators"],
  [0x2300, 0x23FF, "Miscellaneous Technical"],
  [0x2400, 0x243F, "Control Pictures"],
  [0x2440, 0x245F, "Optical Character Recognition"],
  [0x2460, 0x24FF, "Enclosed Alphanumerics"],
  [0x2500, 0x257F, "Box Drawing"],
  [0x2580, 0x259F, "Block Elements"],
  [0x25A0, 0x25FF, "Geometric Shapes"],
  [0x2600, 0x26FF, "Miscellaneous Symbols"],
  [0x2700, 0x27BF, "Dingbats"],
  [0x2800, 0x28FF, "Braille Patterns"],
  [0x2900, 0x297F, "Supplemental Arrows-B"],
  [0x2980, 0x29FF, "Miscellaneous Mathematical Symbols-B"],
  [0x2A00, 0x2AFF, "Supplemental Mathematical Operators"],
  [0x2B00, 0x2BFF, "Miscellaneous Symbols and Arrows"],
  [0x2C60, 0x2C7F, "Latin Extended-C"],
  [0x2E80, 0x2EFF, "CJK Radicals Supplement"],
  [0x2F00, 0x2FDF, "Kangxi Radicals"],
  [0x2FF0, 0x2FFF, "Ideographic Description Characters"],
  [0x3000, 0x303F, "CJK Symbols and Punctuation"],
  [0x3040, 0x309F, "Hiragana"],
  [0x30A0, 0x30FF, "Katakana"],
  [0x3100, 0x312F, "Bopomofo"],
  [0x3130, 0x318F, "Hangul Compatibility Jamo"],
  [0x3190, 0x319F, "Kanbun"],
  [0x31A0, 0x31BF, "Bopomofo Extended"],
  [0x31C0, 0x31EF, "CJK Strokes"],
  [0x31F0, 0x31FF, "Katakana Phonetic Extensions"],
  [0x3200, 0x32FF, "Enclosed CJK Letters and Months"],
  [0x3300, 0x33FF, "CJK Compatibility"],
  [0x3400, 0x4DBF, "CJK Unified Ideographs Extension A"],
  [0x4DC0, 0x4DFF, "Yijing Hexagram Symbols"],
  [0x4E00, 0x9FFF, "CJK Unified Ideographs"],
  [0xA000, 0xA48F, "Yi Syllables"],
  [0xA490, 0xA4CF, "Yi Radicals"],
  [0xA700, 0xA71F, "Modifier Tone Letters"],
  [0xA720, 0xA7FF, "Latin Extended-D"],
  [0xA800, 0xA82F, "Syloti Nagri"],
  [0xAC00, 0xD7AF, "Hangul Syllables"],
  [0xD800, 0xDB7F, "High Surrogates"],
  [0xDC00, 0xDFFF, "Low Surrogates"],
  [0xE000, 0xF8FF, "Private Use Area"],
  [0xF900, 0xFAFF, "CJK Compatibility Ideographs"],
  [0xFB00, 0xFB4F, "Alphabetic Presentation Forms"],
  [0xFB50, 0xFDFF, "Arabic Presentation Forms-A"],
  [0xFE00, 0xFE0F, "Variation Selectors"],
  [0xFE10, 0xFE1F, "Vertical Forms"],
  [0xFE20, 0xFE2F, "Combining Half Marks"],
  [0xFE30, 0xFE4F, "CJK Compatibility Forms"],
  [0xFE50, 0xFE6F, "Small Form Variants"],
  [0xFE70, 0xFEFF, "Arabic Presentation Forms-B"],
  [0xFF00, 0xFFEF, "Halfwidth and Fullwidth Forms"],
  [0xFFF0, 0xFFFF, "Specials"],
 // ---- SMP（平面 1）----
  [0x10000, 0x1007F, "Linear B Syllabary"],
  [0x10140, 0x1018F, "Ancient Greek Numbers"],
  [0x10300, 0x1032F, "Old Italic"],
  [0x10330, 0x1034F, "Gothic"],
  [0x10380, 0x1039F, "Ugaritic"],
  [0x103A0, 0x103DF, "Old Persian"],
  [0x10400, 0x1044F, "Deseret"],
  [0x10450, 0x1047F, "Shavian"],
  [0x10480, 0x104AF, "Osmanya"],
  [0x10800, 0x1083F, "Cypriot Syllabary"],
  [0x10900, 0x1091F, "Phoenician"],
  [0x10A00, 0x10A5F, "Kharoshthi"],
  [0x12000, 0x123FF, "Cuneiform"],
  [0x12400, 0x1247F, "Cuneiform Numbers and Punctuation"],
  [0x13000, 0x1342F, "Egyptian Hieroglyphs"],
  [0x17000, 0x187FF, "Tangut"],
  [0x18800, 0x18AFF, "Tangut Components"],
  [0x18B00, 0x18CFF, "Khitan Small Script"],
  [0x18D00, 0x18D7F, "Tangut Supplement"],
  [0x1B170, 0x1B2FF, "Nushu"],
  [0x1D000, 0x1D0FF, "Byzantine Musical Symbols"],
  [0x1D100, 0x1D1FF, "Musical Symbols"],
  [0x1D200, 0x1D24F, "Ancient Greek Musical Notation"],
  [0x1D300, 0x1D35F, "Tai Xuan Jing Symbols"],
  [0x1D400, 0x1D7FF, "Mathematical Alphanumeric Symbols"],
  [0x1F000, 0x1F02F, "Mahjong Tiles"],
  [0x1F030, 0x1F09F, "Domino Tiles"],
  [0x1F0A0, 0x1F0FF, "Playing Cards"],
  [0x1F100, 0x1F1FF, "Enclosed Alphanumeric Supplement"],
  [0x1F200, 0x1F2FF, "Enclosed Ideographic Supplement"],
  [0x1F300, 0x1F5FF, "Miscellaneous Symbols and Pictographs"],
  [0x1F600, 0x1F64F, "Emoticons"],
  [0x1F680, 0x1F6FF, "Transport and Map Symbols"],
  [0x1F700, 0x1F77F, "Alchemical Symbols"],
  [0x1F900, 0x1F9FF, "Supplemental Symbols and Pictographs"],
 // ---- SIP（平面 2）CJK 扩展 ----
  [0x20000, 0x2A6DF, "CJK Unified Ideographs Extension B"],
  [0x2A700, 0x2B73F, "CJK Unified Ideographs Extension C"],
  [0x2B740, 0x2B81F, "CJK Unified Ideographs Extension D"],
  [0x2B820, 0x2CEAF, "CJK Unified Ideographs Extension E"],
  [0x2CEB0, 0x2EBEF, "CJK Unified Ideographs Extension F"],
  [0x2F800, 0x2FA1F, "CJK Compatibility Ideographs Supplement"],
 // ---- TIP（平面 3）----
  [0x30000, 0x3134F, "CJK Unified Ideographs Extension G"],
  [0x31350, 0x323AF, "CJK Unified Ideographs Extension H"],
 // ---- SSP（平面 14）----
  [0xE0000, 0xE007F, "Tags"],
  [0xE0100, 0xE01EF, "Variation Selectors Supplement"],
 // ---- 私用平面 15/16 ----
  [0xF0000, 0xFFFFF, "Supplementary Private Use Area-A"],
  [0x100000, 0x10FFFF, "Supplementary Private Use Area-B"],
];

/** 二分查找码位所属 Block 名（未命中返回 Unassigned/gap 提示）。 */
export function blockOf(cp) {
  let lo = 0, hi = BLOCKS.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [s, e] = BLOCKS[mid];
    if (cp < s) hi = mid - 1;
    else if (cp > e) lo = mid + 1;
    else return BLOCKS[mid][2];
  }
  return "Unassigned / No Block";
}

// ============================================================
// 平面（plane = Math.floor(cp / 0x10000)）
// ============================================================
const PLANE_NAMES = {
  0: "BMP · 基本多文种平面",
  1: "SMP · 辅助多文种平面",
  2: "SIP · 辅助表意文字平面",
  3: "TIP · 第三表意文字平面",
  14: "SSP · 补充专用平面",
  15: "PUA-A · 补充私用区 A",
  16: "PUA-B · 补充私用区 B",
};

/** 返回 { plane, name }。 */
export function planeOf(cp) {
  const plane = Math.floor(cp / 0x10000);
  const name = PLANE_NAMES[plane] || ("平面 " + plane + "（未分配）");
  return { plane, name };
}

// ============================================================
// General Category 粗分类（用 Unicode property escape 判断，够 CTF 用）
// 返回 { code, label }，code 如 Lu/Ll/Lo/Nd/Zs/Cf/Cc…
// ============================================================
const CAT_LABEL = {
  Cc: "控制符 Control",
  Cf: "格式 Format",
  Co: "私用 Private Use",
  Cs: "代理 Surrogate",
  Cn: "未分配 Unassigned",
  Lu: "大写字母 Uppercase Letter",
  Ll: "小写字母 Lowercase Letter",
  Lt: "词首大写字母 Titlecase Letter",
  Lm: "修饰字母 Modifier Letter",
  Lo: "其他字母 Other Letter",
  Nd: "十进制数字 Decimal Number",
  Nl: "字母数字 Letter Number",
  No: "其他数字 Other Number",
  Mn: "非间距组合记号 Nonspacing Mark",
  Mc: "间距组合记号 Spacing Mark",
  Me: "封闭记号 Enclosing Mark",
  Pc: "连接标点 Connector",
  Pd: "破折标点 Dash",
  Ps: "起始标点 Open",
  Pe: "结束标点 Close",
  Pi: "起始引号 Initial Quote",
  Pf: "结束引号 Final Quote",
  Po: "其他标点 Other Punctuation",
  Sm: "数学符号 Math Symbol",
  Sc: "货币符号 Currency Symbol",
  Sk: "修饰符号 Modifier Symbol",
  So: "其他符号 Other Symbol",
  Zs: "空格分隔 Space Separator",
  Zl: "行分隔 Line Separator",
  Zp: "段分隔 Paragraph Separator",
};

// 预编译 property escape 正则（一次编译，逐字符 test）
const RE = {
  Cc: /\p{Cc}/u,
  Cf: /\p{Cf}/u,
  Co: /\p{Co}/u,
  Cs: /\p{Cs}/u,
  Lu: /\p{Lu}/u,
  Ll: /\p{Ll}/u,
  Lt: /\p{Lt}/u,
  Lm: /\p{Lm}/u,
  Lo: /\p{Lo}/u,
  Nd: /\p{Nd}/u,
  Nl: /\p{Nl}/u,
  No: /\p{No}/u,
  Mn: /\p{Mn}/u,
  Mc: /\p{Mc}/u,
  Me: /\p{Me}/u,
  Pc: /\p{Pc}/u,
  Pd: /\p{Pd}/u,
  Ps: /\p{Ps}/u,
  Pe: /\p{Pe}/u,
  Pi: /\p{Pi}/u,
  Pf: /\p{Pf}/u,
  Po: /\p{Po}/u,
  Sm: /\p{Sm}/u,
  Sc: /\p{Sc}/u,
  Sk: /\p{Sk}/u,
  So: /\p{So}/u,
  Zs: /\p{Zs}/u,
  Zl: /\p{Zl}/u,
  Zp: /\p{Zp}/u,
};
// 判定顺序：先细分类（避免 Lo 吃掉 Lu/Ll），再空白/标点/符号
const CAT_ORDER = [
  "Cc", "Cf", "Cs", "Co",
  "Lu", "Ll", "Lt", "Lm", "Lo",
  "Nd", "Nl", "No",
  "Mn", "Mc", "Me",
  "Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po",
  "Sc", "Sm", "Sk", "So",
  "Zs", "Zl", "Zp",
];

/** 返回 { code, label }。无法归类返回 Cn（未分配）。 */
export function categoryOf(cp) {
  let ch;
  try { ch = String.fromCodePoint(cp); } catch { return { code: "Cn", label: CAT_LABEL.Cn }; }
  for (const code of CAT_ORDER) {
    try { if (RE[code].test(ch)) return { code, label: CAT_LABEL[code] }; } catch { /* 引擎不支持某属性，跳过 */ }
  }
  return { code: "Cn", label: CAT_LABEL.Cn };
}

// ============================================================
// 名称提示 nameHint
// 优先：不可见字符表(INVISIBLES) → ASCII 控制符 → ASCII 可打印 → 算法生成常见类名 → Block 名兜底
// ============================================================
// ASCII C0 控制符标准缩写名
const C0_NAMES = [
  "NULL", "START OF HEADING", "START OF TEXT", "END OF TEXT",
  "END OF TRANSMISSION", "ENQUIRY", "ACKNOWLEDGE", "BELL",
  "BACKSPACE", "CHARACTER TABULATION", "LINE FEED", "LINE TABULATION",
  "FORM FEED", "CARRIAGE RETURN", "SHIFT OUT", "SHIFT IN",
  "DATA LINK ESCAPE", "DEVICE CONTROL ONE", "DEVICE CONTROL TWO", "DEVICE CONTROL THREE",
  "DEVICE CONTROL FOUR", "NEGATIVE ACKNOWLEDGE", "SYNCHRONOUS IDLE", "END OF TRANSMISSION BLOCK",
  "CANCEL", "END OF MEDIUM", "SUBSTITUTE", "ESCAPE",
  "INFORMATION SEPARATOR FOUR", "INFORMATION SEPARATOR THREE",
  "INFORMATION SEPARATOR TWO", "INFORMATION SEPARATOR ONE",
];
// ASCII 可打印标点专名
const ASCII_PUNCT = {
  0x20: "SPACE", 0x21: "EXCLAMATION MARK", 0x22: "QUOTATION MARK", 0x23: "NUMBER SIGN",
  0x24: "DOLLAR SIGN", 0x25: "PERCENT SIGN", 0x26: "AMPERSAND", 0x27: "APOSTROPHE",
  0x28: "LEFT PARENTHESIS", 0x29: "RIGHT PARENTHESIS", 0x2A: "ASTERISK", 0x2B: "PLUS SIGN",
  0x2C: "COMMA", 0x2D: "HYPHEN-MINUS", 0x2E: "FULL STOP", 0x2F: "SOLIDUS",
  0x3A: "COLON", 0x3B: "SEMICOLON", 0x3C: "LESS-THAN SIGN", 0x3D: "EQUALS SIGN",
  0x3E: "GREATER-THAN SIGN", 0x3F: "QUESTION MARK", 0x40: "COMMERCIAL AT",
  0x5B: "LEFT SQUARE BRACKET", 0x5C: "REVERSE SOLIDUS", 0x5D: "RIGHT SQUARE BRACKET",
  0x5E: "CIRCUMFLEX ACCENT", 0x5F: "LOW LINE", 0x60: "GRAVE ACCENT",
  0x7B: "LEFT CURLY BRACKET", 0x7C: "VERTICAL LINE", 0x7D: "RIGHT CURLY BRACKET",
  0x7E: "TILDE", 0x7F: "DELETE",
};

// ============================================================
// 算法生成名（Unicode 标准 §4.8：CJK 表意文字 / 谚文音节 / 西夏文 等
// 按规则拼名，不需要 UnicodeData.txt 逐字表）。零数据表。
// ============================================================
// CJK 统一表意文字区段（真名 = "CJK UNIFIED IDEOGRAPH-XXXX"）。
// 区间照 Unicode Blocks.txt 里实际分配的表意文字末位（非 Block 末位）核对。
const CJK_IDEOGRAPH_RANGES = [
  [0x3400, 0x4DBF],   // Ext A
  [0x4E00, 0x9FFF],   // 基本区
  [0x20000, 0x2A6DF], // Ext B
  [0x2A700, 0x2B739], // Ext C
  [0x2B740, 0x2B81D], // Ext D
  [0x2B820, 0x2CEA1], // Ext E
  [0x2CEB0, 0x2EBE0], // Ext F
  [0x30000, 0x3134A], // Ext G
  [0x31350, 0x323AF], // Ext H
];
// 谚文音节（AC00–D7A3）算法拆名所需的 L/V/T jamo 短名（Unicode §3.12）。
const HANGUL_L = ["G", "GG", "N", "D", "DD", "R", "M", "B", "BB", "S", "SS", "", "J", "JJ", "C", "K", "T", "P", "H"];
const HANGUL_V = ["A", "AE", "YA", "YAE", "EO", "E", "YEO", "YE", "O", "WA", "WAE", "OE", "YO", "U", "WEO", "WE", "WI", "YU", "EU", "YI", "I"];
const HANGUL_T = ["", "G", "GG", "GS", "N", "NJ", "NH", "D", "L", "LG", "LM", "LB", "LS", "LT", "LP", "LH", "M", "B", "BS", "S", "SS", "NG", "J", "C", "K", "T", "P", "H"];
const HANGUL_SBASE = 0xAC00, HANGUL_LCOUNT = 19, HANGUL_VCOUNT = 21, HANGUL_TCOUNT = 28;
const HANGUL_NCOUNT = HANGUL_VCOUNT * HANGUL_TCOUNT; // 588
const HANGUL_SCOUNT = HANGUL_LCOUNT * HANGUL_NCOUNT; // 11172

/** 谚文音节算法名，如 U+AC00 → "HANGUL SYLLABLE GA"。范围外返回 null。 */
function hangulSyllableName(cp) {
  const s = cp - HANGUL_SBASE;
  if (s < 0 || s >= HANGUL_SCOUNT) return null;
  const l = Math.floor(s / HANGUL_NCOUNT);
  const v = Math.floor((s % HANGUL_NCOUNT) / HANGUL_TCOUNT);
  const t = s % HANGUL_TCOUNT;
  return "HANGUL SYLLABLE " + HANGUL_L[l] + HANGUL_V[v] + HANGUL_T[t];
}

/** 命中 CJK 表意文字区段返回真名，否则 null。 */
function cjkIdeographName(cp) {
  for (const [s, e] of CJK_IDEOGRAPH_RANGES) {
    if (cp >= s && cp <= e) return "CJK UNIFIED IDEOGRAPH-" + hex4(cp);
  }
  return null;
}

/** 字符名称提示。 */
export function nameHint(cp) {
 // 不可见字符表（含零宽/Bidi/BOM 等 ~80 名）
  const inv = INVISIBLES[cp];
  if (inv && inv.name) return inv.name;
 // C0 控制符
  if (cp <= 0x1F) return C0_NAMES[cp] || ("CONTROL-" + hex4(cp));
 // ASCII 可打印
  if (cp >= 0x20 && cp <= 0x7F) {
    if (ASCII_PUNCT[cp] != null) return ASCII_PUNCT[cp];
    if (cp >= 0x30 && cp <= 0x39) return "DIGIT " + ["ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE"][cp - 0x30];
    if (cp >= 0x41 && cp <= 0x5A) return "LATIN CAPITAL LETTER " + String.fromCodePoint(cp);
    if (cp >= 0x61 && cp <= 0x7A) return "LATIN SMALL LETTER " + String.fromCodePoint(cp);
  }
 // C1 控制符
  if (cp >= 0x80 && cp <= 0x9F) return "CONTROL-" + hex4(cp);
 // 算法生成真名：CJK 表意文字 / 谚文音节 / 西夏文（§4.8，无需逐字表）
  const cjk = cjkIdeographName(cp);
  if (cjk) return cjk;
  const hang = hangulSyllableName(cp);
  if (hang) return hang;
  if (cp >= 0x17000 && cp <= 0x187F7) return "TANGUT IDEOGRAPH-" + hex4(cp); // 西夏文
  if (cp >= 0x18D00 && cp <= 0x18D08) return "TANGUT IDEOGRAPH-" + hex4(cp); // 西夏文补充
  if (cp >= 0x18B00 && cp <= 0x18CD5) return "KHITAN SMALL SCRIPT CHARACTER-" + hex4(cp); // 契丹小字
  if (cp >= 0x1B170 && cp <= 0x1B2FB) return "NUSHU CHARACTER-" + hex4(cp); // 女书
 // 兜底：Block 名 + 码位（其余冷僻区不逐字取真名，给 Block 定位）
  const blk = blockOf(cp);
  return blk + " U+" + hex4(cp);
}

function hex4(cp) {
  return cp.toString(16).toUpperCase().padStart(4, "0");
}

export { BLOCKS, PLANE_NAMES, CAT_LABEL };
