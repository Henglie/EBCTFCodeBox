/*
 * confusables.js — Unicode 同形异义字（confusables）数据模块（T81，cat:'stego'）。
 *
 * 覆盖：
 * - CONFUSABLE_SKELETON 同形字 → ASCII/拉丁骨架 映射（拉丁/西里尔/希腊常见子集）。
 * - skeleton(text) 归一化：把每个同形字替换为其骨架字符，返回可比对的"骨架串"。
 * 用途：钓鱼域名/仿冒串比对（раypal ↔ paypal 骨架相同）。
 * - detect(text) 混用告警：逐字符标注脚本，找出与主脚本不一致的同形字。
 *
 * 与已有区分：
 * - stegoText.js（T63，@伽马）已有 `confusablesScan`（检测报告 + 脚本分布）。
 * - 本组新增能力：skeleton 骨架归一化（confusablesScan 没有）+ 导出纯函数供复用。
 * - 注册 id `confusablesSkeleton`（骨架归一化）；同形字检测已统一由 stegoText.js 的 `confusablesScan` 承担。
 *
 * 数据来源：Unicode Security Mechanisms confusables.txt（UTS #39）
 * 仅内嵌拉丁/西里尔/希腊常见混淆子集，映射到 ASCII 骨架（照抄不编造）。
 *
 * 红线：纯数据 + 纯函数，无外部依赖；detect 不改文本，skeleton 只做字符级替换。
 */
import { register } from "./registry.js";

// ============ 同形字 → ASCII 骨架 映射 ============
// key = 同形字（非 ASCII 或易混 ASCII），value = 其视觉骨架（ASCII 目标字符）。
// 来源：Unicode confusables.txt（UTS #39）常见子集。
const CONFUSABLE_SKELETON = {
 // ---- 西里尔小写 → 拉丁 ----
  "\u0430": "a", // а CYRILLIC SMALL LETTER A
  "\u0435": "e", // е CYRILLIC SMALL LETTER IE
  "\u043E": "o", // о CYRILLIC SMALL LETTER O
  "\u0440": "p", // р CYRILLIC SMALL LETTER ER
  "\u0441": "c", // с CYRILLIC SMALL LETTER ES
  "\u0445": "x", // х CYRILLIC SMALL LETTER HA
  "\u0443": "y", // у CYRILLIC SMALL LETTER U
  "\u0456": "i", // і CYRILLIC SMALL LETTER BYELORUSSIAN-UKRAINIAN I
  "\u0458": "j", // ј CYRILLIC SMALL LETTER JE
  "\u0455": "s", // ѕ CYRILLIC SMALL LETTER DZE
  "\u04BB": "h", // һ CYRILLIC SMALL LETTER SHHA
  "\u0501": "d", // ԁ CYRILLIC SMALL LETTER KOMI DE
  "\u051B": "q", // ԛ CYRILLIC SMALL LETTER QA
  "\u051D": "w", // ԝ CYRILLIC SMALL LETTER WE
  "\u0261": "g", // ɡ LATIN SMALL LETTER SCRIPT G
 // ---- 西里尔大写 → 拉丁 ----
  "\u0410": "A", // А
  "\u0412": "B", // В
  "\u0415": "E", // Е
  "\u041A": "K", // К
  "\u041C": "M", // М
  "\u041D": "H", // Н
  "\u041E": "O", // О
  "\u0420": "P", // Р
  "\u0421": "C", // С
  "\u0422": "T", // Т
  "\u0425": "X", // Х
  "\u0405": "S", // Ѕ
  "\u0406": "I", // І
  "\u0408": "J", // Ј
  "\u04AE": "Y", // Ү
 // ---- 希腊小写 → 拉丁 ----
  "\u03B1": "a", // α GREEK SMALL LETTER ALPHA
  "\u03BF": "o", // ο GREEK SMALL LETTER OMICRON
  "\u03C1": "p", // ρ GREEK SMALL LETTER RHO
  "\u03BD": "v", // ν GREEK SMALL LETTER NU
  "\u03C5": "u", // υ GREEK SMALL LETTER UPSILON
  "\u03B9": "i", // ι GREEK SMALL LETTER IOTA
  "\u03BA": "k", // κ GREEK SMALL LETTER KAPPA
 // ---- 希腊大写 → 拉丁 ----
  "\u0391": "A", // Α
  "\u0392": "B", // Β
  "\u0395": "E", // Ε
  "\u0396": "Z", // Ζ
  "\u0397": "H", // Η
  "\u0399": "I", // Ι
  "\u039A": "K", // Κ
  "\u039C": "M", // Μ
  "\u039D": "N", // Ν
  "\u039F": "O", // Ο
  "\u03A1": "P", // Ρ
  "\u03A4": "T", // Τ
  "\u03A5": "Y", // Υ
  "\u03A7": "X", // Χ
 // ---- 全角 ASCII → 半角（视觉相同宽字符）----
  "\uFF41": "a", "\uFF42": "b", "\uFF43": "c", "\uFF44": "d", "\uFF45": "e",
  "\uFF4F": "o", "\uFF50": "p", "\uFF4C": "l",
 // ---- 数字/字母易混（ASCII 内，可选归一到字母基）----
 // 注：保守起见不把 0↔O、1↔l 强制归一（会误伤纯数字），仅收非 ASCII。
};

// ============ 脚本分类 ============
function scriptOf(ch) {
  const cp = ch.codePointAt(0);
  if ((cp >= 0x0041 && cp <= 0x005A) || (cp >= 0x0061 && cp <= 0x007A)) return "Latin";
  if ((cp >= 0x00C0 && cp <= 0x024F)) return "Latin";       // Latin-1 补充 + 扩展 A/B
  if (cp >= 0x0370 && cp <= 0x03FF) return "Greek";          // 希腊
  if (cp >= 0x0400 && cp <= 0x04FF) return "Cyrillic";       // 西里尔
  if (cp >= 0x0500 && cp <= 0x052F) return "Cyrillic";       // 西里尔补充
  if (cp >= 0x0530 && cp <= 0x058F) return "Armenian";
  if (cp >= 0x0590 && cp <= 0x05FF) return "Hebrew";
  if (cp >= 0x0600 && cp <= 0x06FF) return "Arabic";
  if (cp >= 0x4E00 && cp <= 0x9FFF) return "Han";
  if (cp >= 0x3040 && cp <= 0x30FF) return "Kana";
  return "Common";
}

// ============ skeleton：同形字骨架归一化 ============
function skeleton(text) {
  let out = "";
  for (const ch of String(text)) {
    out += Object.prototype.hasOwnProperty.call(CONFUSABLE_SKELETON, ch)
      ? CONFUSABLE_SKELETON[ch]
      : ch;
  }
  return out;
}

// ============ 报告文本（供 op run） ============
function cpLabel(cp) {
  return "U+" + cp.toString(16).toUpperCase().padStart(4, "0");
}

function skeletonReport(text) {
  const s = String(text);
  if (!s) throw new Error("空输入");
  const sk = skeleton(s);
  const changed = sk !== s;
  const lines = [];
  lines.push("=== 同形字骨架归一化 ===");
  lines.push("原文：  " + s);
  lines.push("骨架：  " + sk);
  lines.push("");
  lines.push(changed ? "（已替换同形字为 ASCII 骨架）" : "（无同形字，文本未变）");
  if (changed) {
 // 逐字符列出被替换的位置
    const chars = [...s];
    const detail = [];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (Object.prototype.hasOwnProperty.call(CONFUSABLE_SKELETON, ch)) {
        detail.push("  " + String(i).padStart(4) + "  " + ch + " " + cpLabel(ch.codePointAt(0)) + " → " + CONFUSABLE_SKELETON[ch]);
      }
    }
    if (detail.length) {
      lines.push("");
      lines.push("--- 替换明细 ---");
      lines.push(...detail);
    }
  }
  return lines.join("\n");
}

// ============ detect：同形字混用检测（供 UI 复用，非 op） ============
// 逐字符找出「在骨架映射表里、且脚本非拉丁」的同形字，返回主导脚本 + 命中明细。
// 返回 { dominant, hits:[{idx, ch, cp, script, skeleton}] }。
function detect(text) {
  const s = String(text);
  const hits = [];
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const cp = ch.codePointAt(0);
    const sc = scriptOf(ch);
    const isConfusable = Object.prototype.hasOwnProperty.call(CONFUSABLE_SKELETON, ch);
    if (isConfusable && sc !== "Latin") {
      hits.push({ idx: i, ch, cp, script: sc, skeleton: CONFUSABLE_SKELETON[ch] });
    }
  }
 // 主导脚本 = 命中中出现次数最多的脚本
  let dominant = "";
  let max = 0;
  const hitScriptCount = {};
  for (const h of hits) hitScriptCount[h.script] = (hitScriptCount[h.script] || 0) + 1;
  for (const [sc, n] of Object.entries(hitScriptCount)) {
    if (n > max) { max = n; dominant = sc; }
  }
  return { dominant, hits };
}

// ============ 注册 op ============
register({
  id: "confusablesSkeleton", cat: "stego", name: "同形字骨架归一化",
  desc: "把同形异义字（西里尔/希腊/全角等）替换为其 ASCII 视觉骨架，用于钓鱼域名/仿冒串比对（如 раypal→paypal）。单向 run。",
  params: [],
  run: (t) => skeletonReport(t),
});

export {
  CONFUSABLE_SKELETON,
  scriptOf,
  skeleton,
  skeletonReport,
  detect,
};
