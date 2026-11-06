/*
 * zodiac.js — 黄道十二宫杀手密码（Z408 已解子集，cat:'classic'）。
 *
 * 原理（照权威来源，未编造）：
 *  - Zodiac Killer 1969-07-31 投给三家报社的 408 字符密文（Z408）是同音替换
 *    （homophonic substitution）：一个明文字母可对应多个密文符号，一个符号基本只回一个
 *    字母。1969-08 由 Donald 与 Bettye Harden 夫妇破译。
 *  - 本实现只收 Z408 已破解子集：54 个密文符号 → 明文字母（Harden 键，多音符号取其
 *    主导字母）。明文字母 J/Q/Z 在 Z408 中零出现、无对应符号（dCode："The letters J, Q,
 *    X & Z have no known equivalent in Z408"；按 zodiackillerciphers 的 Harden 键表，
 *    X 有符号 bj（1 次），J/Q/Z 无）——编码遇到 J/Q/Z 明确报错，不猜。
 *  - 多音符号（原密文里偶发的一符两义，属凶手笔误/干扰）：e(E8/S1)、i(T10/O1)、
 *    n(E5/T1)、n7(A1/S2)、n8(A4/I1/S3)、n9(I13/W1)。本实现按主导次数取主字母
 *    （e→E、i→T、n→E、n7→S、n8→A、n9→I），副义用法不进码表（文档化，不猜）。
 *
 * 符号 token 表示（重点约定）：
 *  - 密文符号是杀手手绘图形（圆圈叉、三角、点阵等），无 Unicode 对应。本实现采用
 *    zodiackillerciphers.com（Z340 破译者 David Oranchak 的研究站）对 Z408 符号的
 *    机器命名作 token：a b d e f g h i j k l m n o p q r s t u v w x y z bc bd be
 *    bf funnyi bj bk sidek bl bp bq br perp caret n5 n6 theta zodiac phi n7 n8 n9
 *    sq sqd sqe sqr slash backslash plus（54 个，与该站 alphabet/*.jpg 图形文件名一致）。
 *  - 密文 = 空格分隔的 token 串；decode 按空白/逗号切分，未知 token 显式报错。
 *  - encode 两档：cycle（默认）按 Harden 键表序轮转使用该字母的同音符号（还原杀手的
 *    同音轮换用法）；primary 固定用该字母的首个符号。两档 decode 相同（符号→主字母），
 *    decode(encode(x)) === x 严格成立。
 *
 * 权威来源（访问日期均为 2026-09-22）：
 *  - zodiackillerciphers.com「Solved 408-character cipher → Harden Key (cipher to
 *    plaintext)」(http://zodiackillerciphers.com/408/key.html)：54 符号→字母全表（含
 *    出现次数与多音标注），本实现码表照抄该表。该页 Annotated solution 第 1/2 行密文
 *    （n9 sqr p slash z … be）按本表解得 ILIKEKILLINGPEOPLEBECAUSEITISSOMUCH，第 4 行
 *    解得 ANKILLINGWILDGAME，第 12 行解得 TINGYOURROCKSOFFW，
 *    逐字复现。
 *  - dCode「Zodiac Killer Cipher」(https://www.dcode.fr/zodiac-killer-cipher)：
 *    Z408 全文明文（含原文拼写错误）、同音替换原理、J/Q/X/Z 无对应符号说明、
 *    Z340/Z13/Z32 状态（Z340 2020-12 破译但含换位，Z13/Z32 未解——均不在本 op 范围）。
 *
 * 契约：register({id, cat:"classic", name, desc, params, encode, decode})。
 */
import { register } from "./registry.js";

const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Harden 键（cipher→plaintext），照 zodiackillerciphers.com/408/key.html 表序；
// 多音符号取主导字母（副义次数见头注释）。
const Z408_KEY = [
  ["a", "W"], ["b", "L"], ["d", "N"], ["e", "E"], ["f", "S"], ["g", "A"],
  ["h", "T"], ["i", "T"], ["j", "F"], ["k", "S"], ["l", "T"], ["m", "H"],
  ["n", "E"], ["o", "N"], ["p", "I"], ["q", "F"], ["r", "G"], ["s", "A"],
  ["t", "O"], ["u", "I"], ["v", "B"], ["w", "E"], ["x", "O"], ["y", "U"],
  ["z", "E"], ["bc", "V"], ["bd", "O"], ["be", "C"], ["bf", "D"],
  ["funnyi", "O"], ["bj", "X"], ["bk", "I"], ["sidek", "P"], ["bl", "A"],
  ["bp", "E"], ["bq", "M"], ["br", "R"], ["perp", "R"], ["caret", "N"],
  ["n5", "T"], ["n6", "E"], ["theta", "N"], ["zodiac", "D"], ["phi", "H"],
  ["n7", "S"], ["n8", "A"], ["n9", "I"], ["sq", "L"], ["sqd", "S"],
  ["sqe", "Y"], ["sqr", "L"], ["slash", "K"], ["backslash", "R"], ["plus", "E"],
];

// 反查表：token → 明文字母。
const TOKEN2LETTER = new Map(Z408_KEY);
// 正查表：字母 → 同音符号列表（保持键表序）。
const LETTER2TOKENS = new Map();
for (const [tok, let_] of Z408_KEY) {
  if (!LETTER2TOKENS.has(let_)) LETTER2TOKENS.set(let_, []);
  LETTER2TOKENS.get(let_).push(tok);
}

function zodiacEncode(text, selection) {
  const src = String(text == null ? "" : text).toUpperCase();
  const letters = [...src].filter((c) => AZ.includes(c));
  if (!letters.length) throw new Error("Z408：输入不含任何 A-Z 字母。");
  const out = [];
  const cursor = new Map(); // cycle 档：每字母已用次数
  for (const c of letters) {
    const toks = LETTER2TOKENS.get(c);
    if (!toks)
      throw new Error(
        `Z408：字母 ${c} 在 Z408 中无对应符号（明文零出现，dCode 口径 J/Q/Z 无符号）——不猜，请改写或换算法。`
      );
    if (selection === "primary") {
      out.push(toks[0]);
    } else {
      const k = cursor.get(c) || 0;
      cursor.set(c, k + 1);
      out.push(toks[k % toks.length]);
    }
  }
  return out.join(" ");
}

function zodiacDecode(text) {
  const src = String(text == null ? "" : text).trim();
  if (!src) throw new Error("Z408：密文为空。");
  const toks = src.split(/[\s,;]+/).filter(Boolean);
  const out = [];
  for (const t of toks) {
    const low = t.toLowerCase();
    const let_ = TOKEN2LETTER.get(low);
    if (let_ === undefined)
      throw new Error(
        `Z408：token "${t}" 不在 Z408 的 54 符号码表内（未破解的 Z340/Z13/Z32 符号不在本表，不猜）。`
      );
    out.push(let_);
  }
  return out.join("");
}

register({
  id: "zodiac", cat: "classic", name: "黄道十二宫 Z408",
  desc: "Zodiac 杀手 Z408 同音替换（Harden 1969 破译子集，54 符号→字母，token 用 zodiackillerciphers 机器命名）：编码可同音轮转，J/Q/Z 无符号报错；默认解出密文首行 ILIKE…（Wikipedia/dCode 口径）",
  params: [
    { key: "selection", label: "同音选择", type: "select", default: "cycle",
      options: [
        { value: "cycle", label: "轮转（按 Harden 键序循环用该字母的符号，杀手原味）" },
        { value: "primary", label: "固定（每字母恒用首个符号）" },
      ] },
  ],
  encode: (t, p) => zodiacEncode(t, (p && p.selection) || "cycle"),
  decode: (t) => zodiacDecode(t),
});

export { zodiacEncode, zodiacDecode, Z408_KEY, TOKEN2LETTER, LETTER2TOKENS };
