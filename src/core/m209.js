/*
 * m209.js — M-209 转轮密码机（cat:'classic'）。
 *
 * 二战美军 M-209（Hagelin C-38 系列）机械密码机的软件复刻。
 *
 * 【权威依据 / 不编造声明】
 * 机制照 ACA（American Cryptogram Association）M-209 规范 + 公开机器原理：
 * - 6 个密钥轮，字母周期 [26, 25, 23, 21, 19, 17]（照抄，硬约束）。
 * - 27 根杆笼 lug bars，每根 2 个 lug，各设在 0（中性）或 1-6（对应 6 轮）。
 * - 每根 bar 的任一 lug 落在 active 轮的位置 → 该 bar 被推动，贡献 +1 位移。
 * - 位移 K = 被推动的 bar 数（0..27）。
 * - 替换用 Beaufort（自反）：C = (K - P) mod 26，A=0..Z=25。再作一次 (K - C) = P。
 * - 每字符编码后 6 轮各步进 1。
 * pin 读取约定：读「当前窗口显示字母」对应的 pin（ACA 惯例，offset 0）。
 * 真实机器导臂读 pin 的物理 offset 随资料出入较大，本实现采用 ACA 文档化的
 * 窗口字母约定，自洽且往返可逆；未硬编某条二战历史报文向量（不同 offset 约定
 * 会得不同密文，照红线③「写不清/无法权威对齐的宁缺」不编造历史向量）。
 * pin/lug 默认值是【示例密钥配置】，非宣称的历史密钥——M-209 的 pin/lug 本就是
 * 每日更换的密钥材料，无唯一「标准表」，故默认值仅供演示，用户可自填。
 *
 * 自反性：同一密钥配置（pins/lugs/start）下 encode 与 decode 完全一致（Beaufort）
 * op 层 encode/decode 指向同一函数。
 *
 * 契约：register({id:"m209", cat:"classic", name, desc, params, encode, decode})。
 * params: pins(6 行/组，每组该轮 effective 字母) / lugs(27 根 "a-b") / start(6 字母)
 * encode(text, {pins, lugs, start}) === decode(...)（自反）
 *
 * 说明：轮周期 [26,25,23,21,19,17] 为 M-209 硬约束，不可改。纯前端零外发。
 */
import { register } from "./registry.js";

// ============================================================
// 6 个密钥轮字母表（周期 26/25/23/21/19/17，照抄标准 M-209）
// ============================================================
const WHEEL_LETTERS = [
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ", // 轮 1 = 26
  "ABCDEFGHIJKLMNOPQRSTUVWXY",  // 轮 2 = 25
  "ABCDEFGHIJKLMNOPQRSTUVW",    // 轮 3 = 23
  "ABCDEFGHIJKLMNOPQRSTU",      // 轮 4 = 21
  "ABCDEFGHIJKLMNOPQRS",        // 轮 5 = 19
  "ABCDEFGHIJKLMNOPQ",          // 轮 6 = 17
];
const WHEEL_SIZES = WHEEL_LETTERS.map((w) => w.length); // [26,25,23,21,19,17]

// ============================================================
// 示例密钥配置（默认值，非历史密钥，仅供演示——用户可全部改）
// ============================================================
// pins：每轮 effective（有效/凸起）的字母集合。约半数有效即可产生非平凡密文。
const DEFAULT_PINS = [
  "ADEHIKLNORSVWY", // 轮 1 (26)
  "BCEFHJLMOQRTUX", // 轮 2 (25)
  "ACDGIKMNPRTVW",  // 轮 3 (23)
  "BEFHIKLMPQRU",   // 轮 4 (21)
  "ACDFGJLNPRS",    // 轮 5 (19)
  "ABEFHKMOQ",      // 轮 6 (17)
].join("\n");

// lugs：27 根杆笼，每根 "a-b"，a/b ∈ 0..6（0=中性，1-6=对应轮）。
const DEFAULT_LUGS =
  "1-0 2-0 3-0 4-0 5-0 6-0 0-1 0-2 0-3 0-4 0-5 0-6 " +
  "1-2 1-3 1-4 2-5 2-6 3-4 3-5 4-6 5-6 1-6 2-4 3-6 1-5 2-3 4-5"; // 27 根

const DEFAULT_START = "AAAAAA";

// ============================================================
// 解析工具
// ============================================================
// 解析 pins：按行 / "/" / ";" 切成 6 组，每组取 effective 字母集合（去重、大写）。
function parsePins(raw) {
  const clean = String(raw == null ? "" : raw).split(/[\n/;]+/);
  if (clean.length < 6) {
    throw new Error(`M-209 pin 设置需 6 组（对应 6 轮），当前 ${clean.length} 组`);
  }
  const sets = [];
  for (let i = 0; i < 6; i++) {
    const eff = new Set();
    for (const ch of clean[i].toUpperCase()) {
      if (WHEEL_LETTERS[i].includes(ch)) eff.add(ch);
    }
    sets.push(eff);
  }
  return sets;
}

// 解析 lugs：空白分隔，每根 "a-b" 或 "a"（单 lug，另一个视作 0）。值 0..6。
function parseLugs(raw) {
  const toks = String(raw == null ? "" : raw)
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (toks.length === 0) throw new Error("M-209 lug 设置不能为空");
  const bars = [];
  for (const t of toks) {
    const parts = t.split(/[-,]/);
    const a = parseInt(parts[0], 10);
    const b = parts.length > 1 ? parseInt(parts[1], 10) : 0;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || a > 6 || b < 0 || b > 6) {
      throw new Error(`M-209 lug "${t}" 非法，每个 lug 须为 0..6 的整数`);
    }
    bars.push([a, b]);
  }
  return bars;
}

// 解析 start：6 个字母，各须落在对应轮字母表内。
function parseStart(raw) {
  const s = String(raw == null ? "" : raw).toUpperCase().replace(/\s+/g, "");
  if (s.length !== 6) throw new Error(`M-209 初始位置须为 6 个字母，当前 "${raw}"（${s.length} 字母）`);
  const pos = [];
  for (let i = 0; i < 6; i++) {
    const idx = WHEEL_LETTERS[i].indexOf(s[i]);
    if (idx < 0) {
      throw new Error(`M-209 初始位置第 ${i + 1} 字母 "${s[i]}" 不在轮 ${i + 1} 字母表（${WHEEL_LETTERS[i]}）内`);
    }
    pos.push(idx);
  }
  return pos;
}

// ============================================================
// 核心：给定当前 6 轮位置 + pins + lugs → 位移 K（0..27）
// ============================================================
function computeKick(positions, pinSets, bars) {
 // 判定每轮是否 active：读窗口显示字母对应的 pin（ACA 惯例 offset 0）
  const active = new Array(6);
  for (let i = 0; i < 6; i++) {
    const letter = WHEEL_LETTERS[i][positions[i]];
    active[i] = pinSets[i].has(letter);
  }
 // 统计被推动的 bar 数：任一 lug 落在 active 轮（1..6）→ 该 bar +1
  let k = 0;
  for (const [a, b] of bars) {
    const engagedA = a >= 1 && active[a - 1];
    const engagedB = b >= 1 && active[b - 1];
    if (engagedA || engagedB) k++;
  }
  return k;
}

// ============================================================
// 编解码（Beaufort 自反：encode === decode）
// ============================================================
function m209Process(text, params = {}) {
  const pinSets = parsePins(params.pins != null ? params.pins : DEFAULT_PINS);
  const bars = parseLugs(params.lugs != null ? params.lugs : DEFAULT_LUGS);
  const positions = parseStart(params.start != null ? params.start : DEFAULT_START);

  let out = "";
  for (const ch of text) {
    const up = ch.toUpperCase();
    const p = up.charCodeAt(0) - 65; // A=0..Z=25
    if (p < 0 || p > 25) {
 // 非 A-Z 原样透传，不加密不步进（保证往返干净）
      out += ch;
      continue;
    }
    const k = computeKick(positions, pinSets, bars);
    const c = ((k - p) % 26 + 26) % 26; // Beaufort，自反
    out += String.fromCharCode(65 + c);
 // 每字符后 6 轮各步进 1
    for (let i = 0; i < 6; i++) positions[i] = (positions[i] + 1) % WHEEL_SIZES[i];
  }
  return out;
}

// ============================================================
// detect：M-209 密文是全大写 A-Z 块（传统 5 字母分组），无固定字符集特征
// 无法可靠识别，返回 0 避免一把梭误报（函数存在满足「必带 detect」约定）。
// ============================================================
function m209Detect() {
  return 0;
}

register({
  id: "m209",
  cat: "classic",
  name: "M-209 转轮密码机",
  desc: "二战美军 M-209（Hagelin）机械密码机（6 密钥轮 + 27 杆笼 lug + pin 设置，Beaufort 自反）",
  params: [
    {
      key: "pins",
      label: "Pin 设置（6 组，每组该轮有效字母）",
      type: "text",
      default: DEFAULT_PINS,
      placeholder: "6 行/组，各写该轮 effective 字母，如 ADEHIK...",
    },
    {
      key: "lugs",
      label: "Lug 杆笼（27 根 a-b）",
      type: "text",
      default: DEFAULT_LUGS,
      placeholder: "空格分隔，如 1-0 0-2 3-6 ...（各值 0..6）",
    },
    {
      key: "start",
      label: "初始轮位（6 字母）",
      type: "text",
      default: DEFAULT_START,
      placeholder: "如 AAAAAA",
    },
  ],
  encode: m209Process,
  decode: m209Process, // 自反：与 encode 同一函数
  detect: m209Detect,
});

export { m209Process, computeKick, WHEEL_LETTERS, WHEEL_SIZES };
