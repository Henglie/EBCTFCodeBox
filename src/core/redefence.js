/*
 * redefence.js — Redefence 栅栏（rail fence 的行序变体，cat:'classic'）。
 *
 * 原理（照权威来源，未编造）：
 *  - 与标准栅栏（rail fence）一样，明文按 W 型 zig-zag 写进 N 行（栏）；差别在「读出行」这一步：
 *    标准栅栏固定按第 1、2、…、N 行自上而下读；Redefence 允许按**任意指定行序**读，
 *    行序既可由用户直接给出（CrypTool 的 Order 档），也可由关键词推出（关键词字母的字母序
 *    决定行序，关键词长度决定行数）。
 *  - 解码：先按 zig-zag 形状算出各行长度，再按同一行序把密文切段回填各行，最后按 zig-zag 读回明文。
 *  - 行序为恒等序（1,2,…,N）时，Redefence 退化为标准栅栏——这是可对拍的强结构性质。
 *
 * 权威来源：
 *  - CrypTool Portal「Redefence」（https://legacy.cryptool.org/en/cto/redefence），访问日期 2026-09-23：
 *    「The Redefence cipher is a variation of Railfence. The plaintext is written diagonally like in
 *     Railfence, but the emerging rows are read in a defined order.」并给出完整算例——3 栏、行序 (2 3 1)、
 *    明文 CT-ONLINE → 密文 TOLN-ICNE；界面参数为 Depth（栏数 2..15）与 Order（读行序）。
 *  - dCode「Chiffre Redefence」（https://www.dcode.fr/chiffre-redefence），访问日期 2026-09-23：
 *    「il utilise une clé définissant à la fois le nombre de niveaux du zig zag mais aussi l'ordre de
 *     lecture des lignes」；算例——明文 DCODEZIGZAG、关键词 ZIG（字母序 G<I<Z → 读行序 3,2,1）
 *     → 密文 OIGCDZGADEZ。
 *  - Wikipedia「Rail fence cipher」（https://en.wikipedia.org/wiki/Rail_fence_cipher），访问日期 2026-09-23：
 *    标准栅栏的 W 型定义与 24 字母算例（明文 WEAREDISCOVEREDRUNATONCE、3 栏
 *    → WECRUOERDSOEERNTNEAIVDAC），用于校验「恒等行序 = 标准栅栏」这一退化性质。
 *  - American Cryptogram Association（经 Young Tyros「Railfence and Redefence Cipher」转述，
 *    https://youngtyros.com/2023/02/17/railfence-and-redefence-cipher/，访问日期 2026-09-23）：
 *    Redefence 即「把栅栏各行打乱读出」，与栅栏的 offset（起始栏偏移）是两个不同特性。
 *
 * 参数与取值（覆盖权威定义的参数面）：
 *  - rails：栏数（CrypTool「Depth」），整数 2..64，默认 3。
 *  - order：读行序，写成一串 1..N 的排列，如 "2 3 1" / "231" / "2,3,1"（CrypTool「Order」）。
 *  - key：关键词（dCode 口径）——长度即栏数，字母按字母序给出读行序。
 *  - order 与 key 二选一；同时给出时报错（避免静默忽略）。
 *  - 关键词含重复字母时的并列次序，权威来源未定义；本实现取「稳定升序」（同字母时栏号小者先读），
 *    该约定已在报告中标为待确认。
 *
 * 约定：
 *  - 字符按原样处理（不丢空格标点、不改大小写），与既有 `railFence` 一致；
 *    需要只保留字母时请先经文本过滤（Wikipedia 算例即为 24 个字母）。
 *  - 栏数 ≥ 输入长度时原样返回（无有效换位，与既有 `railFence` 同款）。
 *
 * 契约：register({id, cat:"classic", name, desc, params, encode, decode})。
 */
import { register } from "./registry.js";

const RAILS_MIN = 2;
const RAILS_MAX = 64;

/** W 型 zig-zag 的行号序列（长度 n，行号 0..rails-1）。 */
function fencePattern(n, rails) {
  const p = new Array(n);
  let r = 0, dir = 1;
  for (let i = 0; i < n; i++) {
    p[i] = r;
    if (r === 0) dir = 1;
    else if (r === rails - 1) dir = -1;
    r += dir;
  }
  return p;
}

function parseRails(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < RAILS_MIN || n > RAILS_MAX)
    throw new Error(`Redefence：栏数须为 ${RAILS_MIN}..${RAILS_MAX} 的整数（当前 ${v}）。`);
  return n;
}

/** 关键词 → 读行序（1 基）。稳定升序：同字母时栏号小者先读。 */
function orderFromKey(key) {
  const letters = String(key == null ? "" : key).toUpperCase().replace(/[^A-Z]/g, "");
  if (!letters) throw new Error("Redefence：关键词过滤后为空（须含字母）。");
  const n = letters.length;
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort((a, b) => (letters[a] < letters[b] ? -1 : letters[a] > letters[b] ? 1 : a - b));
  const order = new Array(n);
  for (let pos = 0; pos < n; pos++) order[pos] = idx[pos] + 1; // 1 基行号
  return { order, rails: n };
}

/** 解析 order 文本（"2 3 1" / "231" / "2,3,1"）为 1 基排列，并校验是 1..rails 的排列。 */
function parseOrder(orderText, rails) {
  const s = String(orderText == null ? "" : orderText).trim();
  if (!s) throw new Error("Redefence：读行序为空。");
  const nums = s.includes(" ") || s.includes(",") || s.includes(";")
    ? s.split(/[\s,;]+/).filter(Boolean).map(Number)
    : [...s].map(Number);
  if (nums.some((x) => !Number.isInteger(x)))
    throw new Error(`Redefence：读行序须为整数序列（当前 "${orderText}"）。`);
  if (nums.length !== rails)
    throw new Error(`Redefence：读行序长度 ${nums.length} 与栏数 ${rails} 不一致。`);
  const seen = new Set();
  for (const x of nums) {
    if (x < 1 || x > rails) throw new Error(`Redefence：读行序含越界行号 ${x}（有效 1..${rails}）。`);
    if (seen.has(x)) throw new Error(`Redefence：读行序含重复行号 ${x}，须为 1..${rails} 的排列。`);
    seen.add(x);
  }
  return nums;
}

/** 解析 rails/order/key 三个参数，得到 {rails, order}（order 为 1 基读行序）。 */
function resolveConfig(p) {
  const hasOrder = String((p && p.order) || "").trim() !== "";
  const hasKey = String((p && p.key) || "").trim() !== "";
  if (hasOrder && hasKey)
    throw new Error("Redefence：读行序（order）与关键词（key）请二选一，不要同时给出。");
  if (hasKey) {
    const { order, rails } = orderFromKey(p.key);
    return { rails, order };
  }
  const rails = parseRails(p && p.rails);
  if (hasOrder) return { rails, order: parseOrder(p.order, rails) };
  return { rails, order: Array.from({ length: rails }, (_, i) => i + 1) };
}

function redefenceEncode(text, p) {
  const src = String(text == null ? "" : text);
  const { rails, order } = resolveConfig(p);
  if (src.length === 0 || rails >= src.length) return src;
  const pattern = fencePattern(src.length, rails);
  const rows = Array.from({ length: rails }, () => "");
  for (let i = 0; i < src.length; i++) rows[pattern[i]] += src[i];
  return order.map((r) => rows[r - 1]).join("");
}

function redefenceDecode(text, p) {
  const src = String(text == null ? "" : text);
  const { rails, order } = resolveConfig(p);
  if (src.length === 0 || rails >= src.length) return src;
  const pattern = fencePattern(src.length, rails);
  const counts = new Array(rails).fill(0);
  for (const r of pattern) counts[r]++;
  const rows = new Array(rails);
  let pos = 0;
  for (const r of order) {
    rows[r - 1] = src.slice(pos, pos + counts[r - 1]).split("");
    pos += counts[r - 1];
  }
  const ptr = new Array(rails).fill(0);
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const r = pattern[i];
    out += rows[r][ptr[r]++];
  }
  return out;
}

register({
  id: "redefence", family: "railfence", familyLabel: "redefence", cat: "classic", name: "Redefence 栅栏",
  desc: "Redefence：栅栏（W 型 zig-zag）的行序变体——按指定行序或关键词读出行。行序为恒等序时退化为标准栅栏。参数：栏数 rails / 读行序 order / 关键词 key（order 与 key 二选一）",
  params: [
    { key: "rails", label: "栏数", type: "number", default: 3, placeholder: "2-64" },
    { key: "order", label: "读行序（如 2 3 1）", type: "text", default: "", placeholder: "留空=自然序；与关键词二选一" },
    { key: "key", label: "关键词（行序由字母序决定）", type: "text", default: "", placeholder: "留空=不用；与读行序二选一" },
  ],
  encode: redefenceEncode,
  decode: redefenceDecode,
});

export { redefenceEncode, redefenceDecode, fencePattern, orderFromKey, parseOrder, resolveConfig };
