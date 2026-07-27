/*
 * dictGen.js — 字典生成器（T277 P2，cat:'analysis'）。
 *
 * 按字符集+长度生成笛卡尔积字典，支持掩码（@=小写字母, #=数字, !=大写, ?=任意自定义）。
 *
 * 红线：
 * - 纯 JS 笛卡尔积，无外部依赖。
 * - 输出条数上限 100 万防内存爆炸。
 * - 零外发：纯本地计算。
 * - core 层零 UI 依赖（仅 registry）。
 *
 * 契约：register({id, cat:"analysis", name, desc, params, run})。
 * run 单向，参数 charset/length/mask，输出每行一个字典条目。
 */
import { register } from "./registry.js";

const MASK_SETS = {
  "@": "abcdefghijklmnopqrstuvwxyz", // 小写
  "!": "ABCDEFGHIJKLMNOPQRSTUVWXYZ", // 大写
  "#": "0123456789",                 // 数字
  "$": "!@#$%^&*()-_=+",             // 常见符号
};

/**
 * 解析掩码为字符集数组
 * 掩码中每个字符：
 * - @/!/#/$ → 对应预设字符集
 * - 其他 → 字面量字符
 * @returns {string[]} 每个位置的候选字符集
 */
function parseMask(mask) {
  const positions = [];
  for (const ch of mask) {
    if (MASK_SETS[ch]) {
      positions.push(MASK_SETS[ch]);
    } else {
      positions.push(ch); // 字面量，该位置固定为此字符
    }
  }
  return positions;
}

/**
 * 生成笛卡尔积
 * @param {string[]} positions 每个位置的候选字符集
 * @param {number} maxCount 最大条数
 * @returns {string[]} 字典条目数组
 */
function generateCartesian(positions, maxCount) {
  let results = [""];
  for (const set of positions) {
    const next = [];
    for (const prefix of results) {
      for (const ch of set) {
        next.push(prefix + ch);
        if (next.length >= maxCount) return next;
      }
    }
    results = next;
  }
  return results;
}

register({
  id: "dictGen", cat: "analysis", name: "字典生成",
  desc: "字符集笛卡尔积 / 掩码（@小写 !大写 #数字 $符号）生成字典，上限 100 万条",
  params: [
    { key: "mode", label: "模式", type: "select", default: "charset",
      options: [
        { value: "charset", label: "字符集+长度" },
        { value: "mask", label: "掩码" },
      ] },
    { key: "charset", label: "字符集", type: "text", default: "abcdefghijklmnopqrstuvwxyz0123456789",
      placeholder: "charset 模式用" },
    { key: "length", label: "长度", type: "number", default: 4, placeholder: "charset 模式用，1..6" },
    { key: "mask", label: "掩码", type: "text", default: "@@@#",
      placeholder: "mask 模式用，如 @@@#=3字母+1数字" },
  ],
  run: (_text, p) => {
    const mode = p?.mode || "charset";
    const maxCount = 1000000;

    let positions;
    if (mode === "mask") {
      const mask = (p?.mask || "@@@#").trim();
      if (!mask) throw new Error("掩码不能为空");
      positions = parseMask(mask);
    } else {
      const charset = (p?.charset || "abcdefghijklmnopqrstuvwxyz0123456789").trim();
      if (!charset) throw new Error("字符集不能为空");
      const len = Math.max(1, Math.min(6, Number(p?.length) || 4));
 // 预检条数是否超限
      const total = charset.length ** len;
      if (total > maxCount) {
        throw new Error(`组合数 ${total} 超过上限 ${maxCount}，请缩短长度或减少字符集`);
      }
      positions = Array(len).fill(charset);
    }

    const results = generateCartesian(positions, maxCount);
    return results.join("\n");
  },
});

export { parseMask, generateCartesian, MASK_SETS };
