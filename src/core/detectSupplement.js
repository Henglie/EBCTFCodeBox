/*
 * detectSupplement.js — 编码类 detect 覆盖补齐（副作用补丁式）。
 *
 * 职责：给「已注册、有 decode/encode、但缺 detect」的编码类 op 补 detect 识别函数
 * 提升 oneClickDecode（一把梭）命中率。零侵入——不改任何现有 op 定义文件
 * import 时顶层遍历目标 op，仅当其 detect 缺失（undefined）才赋值，绝不覆盖已有 detect。
 *
 * 红线：
 * - 只新建本文件，不碰 main.js / registry.js / scorer.js / magic / 各 op 定义文件。
 * - detect 只读不写；保守优先——宁可漏命中，别乱命中污染一把梭结果。
 * - 判据基于「唯一强特征」（专用字符集 / 专用词表 / 严格格式正则），不编造编码表。
 * - 置信度沿用 detectExt 约定：专用字符集/词表明确 0.4-0.5，严格格式 0.3-0.4
 * 短串易撞的低特征 0.15-0.2。
 *
 * 覆盖 6 个 op（base 分类 18 编码器 detect 已 100% 覆盖，无缺口；本文件补其他分类）：
 * natoAlphabet(text) / semaphore(fancy)
 * bech32(radix) / roman(radix) / tapCode(fancy)
 *
 * 归并：入口 main.js 需在「所有 op 模块 import 之后」追加 import "./core/detectSupplement.js";
 * （本文件顶层依赖目标 op 已完成 register，早于其注册则 getOp 返回 undefined 静默跳过）
 */
import { getOp } from "./registry.js";

// ============ 专用常量（照抄各 op 定义源，不改动）============

// NATO 音标词表（照 textExt.js NATO_MAP 的值，小写）
const NATO_WORDS = new Set([
  "alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel",
  "india", "juliet", "kilo", "lima", "mike", "november", "oscar", "papa",
  "quebec", "romeo", "sierra", "tango", "uniform", "victor", "whiskey",
  "x-ray", "yankee", "zulu",
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "niner",
]);

// 旗语方向词（照 morseExt.js SEMAPHORE_DIR，小写）
const SEM_DIRS = new Set([
  "down", "downleft", "downright", "left", "right", "upleft", "upright", "up",
]);

// Bech32 数据字符集（照 bech32.js BECH32_CHARSET）
const BECH32_RE = /^[a-z]{1,83}1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,}$/;

// 罗马数字严格正则（照 radixExt.js romanDecode 内联正则）
const ROMAN_RE = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

const trim = (t) => String(t == null ? "" : t).trim();

// ============ detect 补丁映射 ============
// key = op id，value = detect(text) → 0..1 置信度
const SUPPLEMENT = {
 // NATO 音标：分词后 token 命中专用词表。词表极独特，命中率高 → 0.5。
  natoAlphabet: (t) => {
    const tokens = trim(t).toLowerCase().split(/[\s,;]+/).filter(Boolean);
    if (tokens.length < 2) return 0;
    let hit = 0;
    for (const tk of tokens) if (NATO_WORDS.has(tk)) hit++;
 // 至少 2 个命中且占比 ≥ 70%，避免普通英文误命中
    return hit >= 2 && hit / tokens.length >= 0.7 ? 0.5 : 0;
  },

 // 盲文 Braille（标准 NABCC）：U+2800 点字块字符集独占 → 0.4。

 // 旗语 Semaphore：输出为「方向词+方向词」以空格分隔，方向词属专用 8 方向集 → 0.5。
  semaphore: (t) => {
    const pairs = trim(t).split(/\s+/).filter(Boolean);
    if (pairs.length < 2) return 0;
    for (const p of pairs) {
      const parts = p.split("+");
      if (parts.length !== 2) return 0;
      if (!SEM_DIRS.has(parts[0].toLowerCase()) || !SEM_DIRS.has(parts[1].toLowerCase())) return 0;
    }
    return 0.5;
  },

 // Bech32 地址：hrp + "1" + bech32 数据字符集（≥6 校验和），格式严格 → 0.4。
  bech32: (t) => {
    return BECH32_RE.test(trim(t).toLowerCase()) ? 0.4 : 0;
  },

 // 罗马数字：严格罗马正则，短串（如 MIX/DID）可能撞英文词 → 低置信度 0.15。
  roman: (t) => {
    const s = trim(t).toUpperCase();
    if (s.length < 2) return 0;
    return ROMAN_RE.test(s) ? 0.15 : 0;
  },

 // 敲击码 Tap Code：全部为 (1-5)(1-5) 两位数字对以空格/逗号分隔 → 低置信度 0.2。
  tapCode: (t) => {
    const pairs = trim(t).split(/[\s,]+/).filter(Boolean);
    if (pairs.length < 3) return 0;
    for (const p of pairs) if (!/^[1-5][1-5]$/.test(p)) return 0;
    return 0.2;
  },
};

// ============ 副作用补丁：仅当目标 op 存在且缺 detect 时赋值 ============
let _patched = 0;
const _skipped = [];
for (const [id, det] of Object.entries(SUPPLEMENT)) {
  const op = getOp(id);
  if (!op) { _skipped.push(id + "(未注册)"); continue; }
  if (op.detect) { _skipped.push(id + "(已有detect)"); continue; }
  op.detect = det;
  _patched++;
}

if (typeof console !== "undefined" && console.debug) {
  console.debug("[detectSupplement] patched " + _patched + " ops"
    + (_skipped.length ? "; skipped: " + _skipped.join(", ") : ""));
}

export const DETECT_SUPPLEMENT_IDS = Object.keys(SUPPLEMENT);
