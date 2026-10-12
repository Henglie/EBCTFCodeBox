/*
 * bellaso.js — Bellaso 密码（cat:'classic'）。
 *
 * 原理（照权威来源，未编造；口径 = dCode 工具版 Bellaso）：
 *  - Bellaso（1553）的互反多表代换。本实现按 dCode 复原的版本：
 *    (1) 取「生成密钥」的去重字母，切成前后两组 g1、g2；
 *    (2) 用字母表剩余字母按序补满：字母表 1 = g1+补1 | g2+补2（两半各长 N/2）；
 *    (3) 第 i 张字母表（i=1..N，默认 N=5）= 前半不动，后半循环左移 n×(i-1)（默认 n=1）；
 *    (4) 字母→表编号：把字母表 1 的字母按序编号 1..|A|，第 k 个字母 ↔ 表 ((k-1) mod N)+1；
 *    (5) 按词加密：第 j 个词用密钥第 ((j-1) mod 密钥长) 个字母所属的表，词内每个字母 x
 *        查表：x 在前半位置 p → 密文 = 同表后半同位字母；在后半 → 密文 = 前半同位字母。
 *  - 表内互换互为逆运算 → 加密=解密（自反）。
 *
 * 权威来源：
 *  - dCode「Bellaso Cipher」(https://www.dcode.fr/bellaso-cipher)，访问日期 2026-09-22：
 *    完整算例：字母表 ABCDEFGHILMNOPQRSTVX（20 字母意大利表）、生成密钥 CHIAVEALFABETICA
 *    （去重 = CHIAVELFBT → CHIAV|ELFBT，补全 → CHIAVDGMNO|ELFBTPQRSX）、N=5、n=1、
 *    密钥 GIOVAN：DCODE→QLEQO（词 1 用 G→表 2 = CHIAVDGMNO|LFBTPQRSXE）、
 *    BELLASO→HNOOPGL（词 2 用 I→表 3 = CHIAVDGMNO|FBTPQRSXEL），整句 "DCODE BELLASO"
 *    → "QLEQO HNOOPGL"。本实现默认参数可复现该例（alphabet 传 20）。
 *  - Wikipedia「Giovan Battista Bellaso」(https://en.wikipedia.org/wiki/Giovan_Battista_Bellaso)，
 *    访问日期 2026-09-22：历史背景与 1553 互反表思想（两位密钥、滑动下半字母表、自反代换）。
 *    注：维基描述的 1553 原表（11 张索引表、逐字母推进）未公开完整映射表，不足以精确复刻；
 *    本实现采用 dCode 公开且带完整算例的版本，并如实登记该限定。
 *
 * 约定：
 *  - 字母表支持 26（A-Z）与 20（意大利 ABCDEFGHILMNOPQRSTVX）两档；必须为偶数长。
 *  - 词 = 极长字母串；非字母字符原样保留（不参与计数）。词内/密钥含表外字母 → 显式报错。
 *  - 输出大写；加密与解密同函数（互反表）。
 *
 * 契约：register({id, cat:"classic", name, desc, params, encode, decode})。
 */
import { register } from "./registry.js";

const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const IT20 = "ABCDEFGHILMNOPQRSTVX"; // 意大利 20 字母表（无 J K U W Y Z）

function buildAlphabets(genKey, alphabet, N, n) {
  const alpha = String(alphabet || AZ);
  const L = alpha.length;
  if (L % 2 !== 0) throw new Error("Bellaso：字母表长度必须为偶数。");
  const nn = Number(N), step = Number(n);
  if (!Number.isInteger(nn) || nn < 1) throw new Error(`Bellaso：表数 N 须为正整数（拿到 ${N}）。`);
  if (!Number.isInteger(step) || step < 1) throw new Error(`Bellaso：表间位移 n 须为正整数（拿到 ${n}）。`);
  const seen = new Set();
  const distinct = [];
  for (const ch of String(genKey == null ? "" : genKey).toUpperCase())
    if (alpha.includes(ch) && !seen.has(ch)) { seen.add(ch); distinct.push(ch); }
  if (!distinct.length) throw new Error("Bellaso：生成密钥不含字母表内字母。");
  if (distinct.length > L) throw new Error("Bellaso：生成密钥去重字母数超过字母表。");
  const split = Math.ceil(distinct.length / 2);
  const g1 = distinct.slice(0, split);
  const g2 = distinct.slice(split);
  const remaining = [...alpha].filter((c) => !seen.has(c));
  const half = L / 2;
  if (g1.length > half || g2.length > half)
    throw new Error("Bellaso：生成密钥去重字母过多，无法两半分配。");
  const h1 = g1.concat(remaining.slice(0, half - g1.length));
  const h2 = g2.concat(remaining.slice(half - g1.length, half - g1.length + (half - g2.length)));
  if (h1.length !== half || h2.length !== half)
    throw new Error("Bellaso：字母表两半构造长度异常。");
  const rot = (arr, k) => arr.slice(k % arr.length).concat(arr.slice(0, k % arr.length));
  const tables = [];
  for (let i = 0; i < nn; i++) tables.push(h1.join("") + rot(h2, step * i).join(""));
  // 字母 → 表编号（字母表 1 的第 k 个字母 ↔ 表 ((k-1) mod N)+1）
  const tableOf = new Map();
  [...h1, ...h2].forEach((ch, k) => tableOf.set(ch, k % nn));
  return { tables, tableOf, alpha1: h1.join("") + h2.join("") };
}

function parseAlphabetSel(p) {
  const a = String((p && p.alphabet) != null ? p.alphabet : "26");
  if (a === "26") return AZ;
  if (a === "20") return IT20;
  throw new Error("Bellaso：字母表档只能是 26（A-Z）或 20（意大利表），收到非法值 " + JSON.stringify(p && p.alphabet));
}

function bellasoRun(text, genKey, keyword, alphabet, N, n) {
  const { tables, tableOf, alpha1 } = buildAlphabets(genKey, alphabet, N, n);
  const keyLetters = [...String(keyword == null ? "" : keyword).toUpperCase()].filter((c) => alpha1.includes(c));
  if (!keyLetters.length) throw new Error("Bellaso：密钥（词密钥）不含字母表内字母。");
  const src = String(text == null ? "" : text);
  if (![...src.toUpperCase()].some((c) => alpha1.includes(c)))
    throw new Error("Bellaso：输入不含字母表内字母。");
  const half = alpha1.length / 2;
  let word = 0;
  let out = "";
  let inWord = false;
  for (const raw of src) {
    const ch = raw.toUpperCase();
    if (AZ.includes(ch)) {
      if (!alpha1.includes(ch))
        throw new Error(`Bellaso：字母 "${ch}" 不在当前字母表中（20 字母档无 J K U W Y Z），请换 26 字母档。`);
      if (!inWord) { word++; inWord = true; }
      const keyLetter = keyLetters[(word - 1) % keyLetters.length];
      const table = tables[tableOf.get(keyLetter)];
      const p = table.indexOf(ch);
      if (p < 0) throw new Error(`Bellaso：字母 "${ch}" 不在表内（内部错误）。`);
      out += p < half ? table[p + half] : table[p - half];
    } else {
      out += raw;
      inWord = false;
    }
  }
  return out;
}

register({
  id: "bellaso", cat: "classic", name: "Bellaso 密码",
  desc: "1553 互反多表代换（dCode 口径）：生成密钥两半补全成互反字母表、N 张后半轮转表、按词取密钥字母选表；加密=解密；默认复现 DCODE BELLASO 例（alphabet=20）",
  params: [
    { key: "genkey", label: "生成密钥（构造字母表）", type: "text", default: "CHIAVEALFABETICA" },
    { key: "keyword", label: "词密钥（逐词循环取字母选表）", type: "text", default: "GIOVAN" },
    { key: "alphabet", label: "字母表", type: "select", default: "26",
      options: [
        { value: "26", label: "26 字母（A-Z）" },
        { value: "20", label: "20 字母（意大利 ABCDEFGHILMNOPQRSTVX）" },
      ] },
    { key: "count", label: "表数 N", type: "number", default: 5 },
    { key: "step", label: "表间位移 n", type: "number", default: 1 },
  ],
  encode: (t, p) => bellasoRun(t, (p && p.genkey) != null ? p.genkey : "CHIAVEALFABETICA", (p && p.keyword) != null ? p.keyword : "GIOVAN", parseAlphabetSel(p), (p && p.count) != null ? p.count : 5, (p && p.step) != null ? p.step : 1),
  decode: (t, p) => bellasoRun(t, (p && p.genkey) != null ? p.genkey : "CHIAVEALFABETICA", (p && p.keyword) != null ? p.keyword : "GIOVAN", parseAlphabetSel(p), (p && p.count) != null ? p.count : 5, (p && p.step) != null ? p.step : 1),
});

export { bellasoRun, buildAlphabets, IT20 };
