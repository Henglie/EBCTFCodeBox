/*
 * invisibles.js — 不可见字符可视化表（T80，cat:'stego'）。
 *
 * 定位：与 stegoText.js 的 zwScan（文本报告）正交——本文件是「可复用数据 + 结构化 API」
 * 供编辑框「显示不可见字符」开关与输入检测提醒直接调用。零宽 / 控制符 / BOM /
 * 各类空白统一映射到可见占位符 + 名称 + 类型。
 *
 * 导出：
 * INVISIBLES 码位 → { name, type, glyph } 统一表
 * scan(text) → [{ idx, cp, name, type, glyph }] 命中位置 + 类型
 * visualize(text, { showSpace }) 把不可见字符替换为可见占位符（编辑器高亮用）
 * strip(text) 剥离危险不可见字符（零宽 / Bidi / 格式 / BOM），保留功能性空白
 * countByType(text) 按类型统计命中数（检测提醒用）
 *
 * 注册 op：invisibleViz（run → 可视化 + 命中清单 + 统计）
 * 红线：不碰 stegoText.js / stego.js；op id 不与现有 stego op 冲突。
 */
import { register } from "./registry.js";

// ============================================================
// 统一不可见字符表：码位 → { name, type, glyph }
// type: 'zero-width' | 'bidi' | 'whitespace' | 'bom' | 'control' | 'format'
// glyph: 可见占位符（编辑器「显示不可见字符」用）
// ============================================================
const INVISIBLES = {
 // ---- 零宽 / 格式字符（U+200B..200F + U+2060..206F） ----
  0x200b: { name: "ZERO WIDTH SPACE",            type: "zero-width", glyph: "·" },
  0x200c: { name: "ZERO WIDTH NON-JOINER (ZWNJ)",type: "zero-width", glyph: "·" },
  0x200d: { name: "ZERO WIDTH JOINER (ZWJ)",     type: "zero-width", glyph: "·" },
  0x200e: { name: "LEFT-TO-RIGHT MARK (LRM)",    type: "zero-width", glyph: "·" },
  0x200f: { name: "RIGHT-TO-LEFT MARK (RLM)",    type: "zero-width", glyph: "·" },
  0x2060: { name: "WORD JOINER",                 type: "format",     glyph: "·" },
  0x2061: { name: "FUNCTION APPLICATION",        type: "format",     glyph: "·" },
  0x2062: { name: "INVISIBLE TIMES",             type: "format",     glyph: "·" },
  0x2063: { name: "INVISIBLE SEPARATOR",         type: "format",     glyph: "·" },
  0x2064: { name: "INVISIBLE PLUS",              type: "format",     glyph: "·" },
  0x206a: { name: "INHIBIT SYMMETRIC SWAPPING",  type: "format",     glyph: "·" },
  0x206b: { name: "ACTIVATE SYMMETRIC SWAPPING", type: "format",     glyph: "·" },
  0x206c: { name: "INHIBIT ARABIC FORM SHAPING", type: "format",     glyph: "·" },
  0x206d: { name: "ACTIVATE ARABIC FORM SHAPING",type: "format",     glyph: "·" },
  0x206e: { name: "NATIONAL DIGIT SHAPES",       type: "format",     glyph: "·" },
  0x206f: { name: "NOMINAL DIGIT SHAPES",        type: "format",     glyph: "·" },
  0x00ad: { name: "SOFT HYPHEN",                 type: "format",     glyph: "·" },
  0x180e: { name: "MONGOLIAN VOWEL SEPARATOR",   type: "format",     glyph: "·" },

 // ---- BOM ----
  0xfeff: { name: "ZERO WIDTH NO-BREAK SPACE / BOM", type: "bom", glyph: "◊" },

 // ---- Bidi 控制符（Trojan Source 攻击向量） ----
  0x061c: { name: "ARABIC LETTER MARK (ALM)",               type: "bidi", glyph: "⟶" },
  0x202a: { name: "LEFT-TO-RIGHT EMBEDDING (LRE)",          type: "bidi", glyph: "⟶" },
  0x202b: { name: "RIGHT-TO-LEFT EMBEDDING (RLE)",          type: "bidi", glyph: "⟵" },
  0x202c: { name: "POP DIRECTIONAL FORMATTING (PDF)",       type: "bidi", glyph: "⤴" },
  0x202d: { name: "LEFT-TO-RIGHT OVERRIDE (LRO)",           type: "bidi", glyph: "⟶" },
  0x202e: { name: "RIGHT-TO-LEFT OVERRIDE (RLO)",           type: "bidi", glyph: "⟵" },
  0x2066: { name: "LEFT-TO-RIGHT ISOLATE (LRI)",            type: "bidi", glyph: "⟶" },
  0x2067: { name: "RIGHT-TO-LEFT ISOLATE (RLI)",            type: "bidi", glyph: "⟵" },
  0x2068: { name: "FIRST STRONG ISOLATE (FSI)",             type: "bidi", glyph: "⇋" },
  0x2069: { name: "POP DIRECTIONAL ISOLATE (PDI)",          type: "bidi", glyph: "⤴" },

 // ---- 空白字符（普通 + 异形） ----
  0x0009: { name: "CHARACTER TABULATION (Tab)",     type: "whitespace", glyph: "→" },
  0x000a: { name: "LINE FEED (LF)",                 type: "whitespace", glyph: "⏎" },
  0x000b: { name: "LINE TABULATION (VT)",           type: "whitespace", glyph: "␋" },
  0x000c: { name: "FORM FEED (FF)",                 type: "whitespace", glyph: "␌" },
  0x000d: { name: "CARRIAGE RETURN (CR)",           type: "whitespace", glyph: "␍" },
  0x0020: { name: "SPACE",                          type: "whitespace", glyph: "␣" },
  0x0085: { name: "NEXT LINE (NEL)",                type: "whitespace", glyph: "␤" },
  0x00a0: { name: "NO-BREAK SPACE (NBSP)",          type: "whitespace", glyph: "␣" },
  0x1680: { name: "OGHAM SPACE MARK",               type: "whitespace", glyph: "␣" },
  0x2000: { name: "EN QUAD",                        type: "whitespace", glyph: "␣" },
  0x2001: { name: "EM QUAD",                        type: "whitespace", glyph: "␣" },
  0x2002: { name: "EN SPACE",                       type: "whitespace", glyph: "␣" },
  0x2003: { name: "EM SPACE",                       type: "whitespace", glyph: "␣" },
  0x2004: { name: "THREE-PER-EM SPACE",             type: "whitespace", glyph: "␣" },
  0x2005: { name: "FOUR-PER-EM SPACE",              type: "whitespace", glyph: "␣" },
  0x2006: { name: "SIX-PER-EM SPACE",               type: "whitespace", glyph: "␣" },
  0x2007: { name: "FIGURE SPACE",                   type: "whitespace", glyph: "␣" },
  0x2008: { name: "PUNCTUATION SPACE",              type: "whitespace", glyph: "␣" },
  0x2009: { name: "THIN SPACE",                     type: "whitespace", glyph: "␣" },
  0x200a: { name: "HAIR SPACE",                     type: "whitespace", glyph: "␣" },
  0x2028: { name: "LINE SEPARATOR",                 type: "whitespace", glyph: "␊" },
  0x2029: { name: "PARAGRAPH SEPARATOR",            type: "whitespace", glyph: "␍" },
  0x202f: { name: "NARROW NO-BREAK SPACE (NNBSP)",  type: "whitespace", glyph: "␣" },
  0x205f: { name: "MEDIUM MATHEMATICAL SPACE (MMSP)",type: "whitespace", glyph: "␣" },
  0x3000: { name: "IDEOGRAPHIC SPACE",              type: "whitespace", glyph: "␣" },

 // ---- 控制字符（C0 U+0000..001F，DEL，C1 U+0080..009F） ----
  0x0000: { name: "NULL",                       type: "control", glyph: "␀" },
  0x0001: { name: "START OF HEADING",           type: "control", glyph: "␁" },
  0x0002: { name: "START OF TEXT",              type: "control", glyph: "␂" },
  0x0003: { name: "END OF TEXT",                type: "control", glyph: "␃" },
  0x0004: { name: "END OF TRANSMISSION",        type: "control", glyph: "␄" },
  0x0005: { name: "ENQUIRY",                    type: "control", glyph: "␅" },
  0x0006: { name: "ACKNOWLEDGE",                type: "control", glyph: "␆" },
  0x0007: { name: "BELL",                       type: "control", glyph: "␇" },
  0x0008: { name: "BACKSPACE",                  type: "control", glyph: "␈" },
  0x000e: { name: "SHIFT OUT",                  type: "control", glyph: "␎" },
  0x000f: { name: "SHIFT IN",                   type: "control", glyph: "␏" },
  0x0010: { name: "DATA LINK ESCAPE",           type: "control", glyph: "␐" },
  0x0011: { name: "DEVICE CONTROL 1",           type: "control", glyph: "␑" },
  0x0012: { name: "DEVICE CONTROL 2",           type: "control", glyph: "␒" },
  0x0013: { name: "DEVICE CONTROL 3",           type: "control", glyph: "␓" },
  0x0014: { name: "DEVICE CONTROL 4",           type: "control", glyph: "␔" },
  0x0015: { name: "NEGATIVE ACKNOWLEDGE",       type: "control", glyph: "␕" },
  0x0016: { name: "SYNCHRONOUS IDLE",           type: "control", glyph: "␖" },
  0x0017: { name: "END OF TRANSMISSION BLOCK",  type: "control", glyph: "␗" },
  0x0018: { name: "CANCEL",                     type: "control", glyph: "␘" },
  0x0019: { name: "END OF MEDIUM",              type: "control", glyph: "␙" },
  0x001a: { name: "SUBSTITUTE",                 type: "control", glyph: "␚" },
  0x001b: { name: "ESCAPE",                     type: "control", glyph: "␛" },
  0x001c: { name: "FILE SEPARATOR",             type: "control", glyph: "␜" },
  0x001d: { name: "GROUP SEPARATOR",            type: "control", glyph: "␝" },
  0x001e: { name: "RECORD SEPARATOR",           type: "control", glyph: "␞" },
  0x001f: { name: "UNIT SEPARATOR",             type: "control", glyph: "␟" },
  0x007f: { name: "DELETE",                     type: "control", glyph: "␡" },
  0x0081: { name: "HIGH OCTET PRESET (HOP)",    type: "control", glyph: "⠁" },
  0x0082: { name: "BREAK PERMITTED HERE (BPH)", type: "control", glyph: "⠂" },
  0x0083: { name: "NO BREAK HERE (NBH)",        type: "control", glyph: "⠃" },
  0x0084: { name: "INDEX (IND)",                type: "control", glyph: "⠄" },
  0x0086: { name: "START OF SELECTED AREA (SSA)",type: "control", glyph: "⠆" },
  0x0087: { name: "END OF SELECTED AREA (ESA)", type: "control", glyph: "⠇" },
  0x0088: { name: "CHARACTER TABULATION SET (HTS)",type: "control", glyph: "⠈" },
  0x0089: { name: "CHARACTER TABULATION WITH JUSTIFICATION (HTJ)",type: "control", glyph: "⠉" },
  0x008a: { name: "LINE TABULATION SET (VTS)",  type: "control", glyph: "⠊" },
  0x008b: { name: "PARTIAL LINE FORWARD (PLD)", type: "control", glyph: "⠋" },
  0x008c: { name: "PARTIAL LINE BACKWARD (PLU)",type: "control", glyph: "⠌" },
  0x008d: { name: "REVERSE LINE FEED (RI)",     type: "control", glyph: "⠍" },
  0x008e: { name: "SINGLE SHIFT 2 (SS2)",       type: "control", glyph: "⠎" },
  0x008f: { name: "SINGLE SHIFT 3 (SS3)",       type: "control", glyph: "⠏" },
  0x0090: { name: "DEVICE CONTROL STRING (DCS)",type: "control", glyph: "⠐" },
  0x0091: { name: "PRIVATE USE 1 (PU1)",        type: "control", glyph: "⠑" },
  0x0092: { name: "PRIVATE USE 2 (PU2)",        type: "control", glyph: "⠒" },
  0x0093: { name: "SET TRANSMIT STATE (STS)",   type: "control", glyph: "⠓" },
  0x0094: { name: "CANCEL CHARACTER (CCH)",     type: "control", glyph: "⠔" },
  0x0095: { name: "MESSAGE WAITING (MW)",       type: "control", glyph: "⠕" },
  0x0096: { name: "START OF GUARDED AREA (SPA)",type: "control", glyph: "⠖" },
  0x0097: { name: "END OF GUARDED AREA (EPA)",  type: "control", glyph: "⠗" },
  0x0098: { name: "START OF STRING (SOS)",      type: "control", glyph: "⠘" },
  0x0099: { name: "SINGLE CHARACTER INTRODUCER (SGC)",type: "control", glyph: "⠙" },
  0x009a: { name: "SINGLE CHARACTER INTRODUCER (SCI)",type: "control", glyph: "⠚" },
  0x009b: { name: "CONTROL SEQUENCE INTRODUCER (CSI)",type: "control", glyph: "⠛" },
  0x009c: { name: "STRING TERMINATOR (ST)",     type: "control", glyph: "⠜" },
  0x009d: { name: "OPERATING SYSTEM COMMAND (OSC)",type: "control", glyph: "⠝" },
  0x009e: { name: "PRIVACY MESSAGE (PM)",       type: "control", glyph: "⠞" },
  0x009f: { name: "APPLICATION PROGRAM COMMAND (APC)",type: "control", glyph: "⠟" },

 // ---- 行间注释控制符（罕见但属于不可见） ----
  0xfff9: { name: "INTERLINEAR ANNOTATION ANCHOR",    type: "format", glyph: "·" },
  0xfffa: { name: "INTERLINEAR ANNOTATION SEPARATOR", type: "format", glyph: "·" },
  0xfffb: { name: "INTERLINEAR ANNOTATION TERMINATOR",type: "format", glyph: "·" },
};

// 危险不可见类型（strip 默认剥离）：零宽 / Bidi / 格式 / BOM；保留功能性空白与控制符。
const DANGEROUS_TYPES = new Set(["zero-width", "bidi", "format", "bom"]);

// 普通空白（不算可疑，检测提醒时排除）
const NORMAL_WS = new Set([0x20, 0x09, 0x0a, 0x0d]);

const cpLabel = (cp) => "U+" + cp.toString(16).toUpperCase().padStart(4, "0");

// 类型中文标签
const TYPE_LABEL = {
  "zero-width": "零宽字符",
  "bidi": "双向控制符",
  "whitespace": "空白字符",
  "bom": "BOM",
  "control": "控制字符",
  "format": "格式字符",
};

// ============================================================
// scan — 结构化扫描：命中位置 + 类型（编辑器 / 检测提醒用）
// 返回 [{ idx, cp, name, type, glyph }]
// ============================================================
export function scan(text) {
  const chars = [...text];
  const hits = [];
  for (let i = 0; i < chars.length; i++) {
    const cp = chars[i].codePointAt(0);
    const info = INVISIBLES[cp];
    if (info) {
      hits.push({ idx: i, cp, name: info.name, type: info.type, glyph: info.glyph });
    }
  }
  return hits;
}

// ============================================================
// visualize — 把不可见字符替换为可见占位符（编辑器「显示不可见字符」用）
// showSpace=false 时普通空格不替换（避免全文满屏占位符），仅替换可疑不可见
// ============================================================
export function visualize(text, { showSpace = false } = {}) {
  const chars = [...text];
  let out = "";
  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    const info = INVISIBLES[cp];
    if (info) {
 // 普通空格 / Tab / LF / CR：默认不替换（功能性空白）
      if (!showSpace && NORMAL_WS.has(cp)) {
        out += ch;
      } else {
        out += info.glyph;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

// ============================================================
// strip — 剥离危险不可见字符（零宽 / Bidi / 格式 / BOM）
// 保留功能性空白与可见控制符，供「一键清洗」用
// ============================================================
export function strip(text) {
  const chars = [...text];
  let out = "";
  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    const info = INVISIBLES[cp];
    if (info && DANGEROUS_TYPES.has(info.type)) continue;
    out += ch;
  }
  return out;
}

// ============================================================
// countByType — 按类型统计命中数（检测提醒用）
// 返回 { 'zero-width': n, 'bidi': n, ... }
// ============================================================
export function countByType(text) {
  const counts = {};
  for (const h of scan(text)) {
    counts[h.type] = (counts[h.type] || 0) + 1;
  }
  return counts;
}

// ============================================================
// invisibleViz — 工具箱 op：可视化 + 命中清单 + 统计（run 单向）
// ============================================================
function invisibleViz(text, p = {}) {
  const chars = [...text];
  const hits = scan(text);
  const lines = [];
  lines.push("=== 不可见字符可视化 ===");
  lines.push(`总码位数：${chars.length}`);
  lines.push(`命中不可见字符：${hits.length} 个`);
  lines.push("");

  if (hits.length === 0) {
    lines.push("（未发现不可见字符）");
    return lines.join("\n");
  }

 // 按类型分组统计
  const byType = {};
  for (const h of hits) byType[h.type] = (byType[h.type] || 0) + 1;
  lines.push("--- 类型统计 ---");
  for (const t of Object.keys(byType).sort((a, b) => byType[b] - byType[a])) {
    lines.push(`  ${TYPE_LABEL[t] || t}：${byType[t]} 个`);
  }
  lines.push("");

 // 命中清单
  lines.push("[位置]  码位      类型          Unicode 名称");
  for (const h of hits) {
    lines.push(
      `  ${String(h.idx).padStart(5)}   ${cpLabel(h.cp).padEnd(8)} ${(TYPE_LABEL[h.type] || h.type).padEnd(12)} ${h.name}`
    );
  }
  lines.push("");

 // 可视化视图：普通空格也显形（CTF 里空格间隔常作隐写载体，必须看得见）
  lines.push("--- 可视化视图（占位符 = 不可见字符）---");
  lines.push(visualize(text, { showSpace: true }));
  lines.push("");

 // 清洗后的文本
  lines.push("--- 剥离危险不可见字符后的文本 ---");
  lines.push(strip(text));

  return lines.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "invisibleViz",
  cat: "stego",
  name: "不可见字符可视化",
  desc: "零宽 / 控制符 / BOM / 各类空白统一映射为可见占位符 + 命中清单 + 类型统计 + 一键剥离",
  params: [],
  run: invisibleViz,
});

export { INVISIBLES, TYPE_LABEL, DANGEROUS_TYPES, cpLabel };
