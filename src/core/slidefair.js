/*
 * slidefair.js — Slidefair 密码（cat:'classic'）。
 *
 * 原理（照权威来源，未编造）：
 *  - 双字母（digraph）代换，结构 = 在维吉勒族表上取「矩形对角」：
 *    顶行 = 普通 A-Z 表头；密钥逐双字母循环，第 i 个明文双字母用密钥第 i 个字母 K 选表行。
 *    第 1 个明文字母 P1 在顶行找到（列 c1），第 2 个明文字母 P2 在密钥行 K 找到（列 c2）。
 *    两者视为矩形的对角：密文 = 另外两角，取「顶行的那个在前」：
 *      密文 = ( 顶行[c2], 表行K[c1] )。
 *  - 特例（P1、P2 同列，矩形退化）：密文 = 两字母「正右侧」的一对
 *    ( 顶行[c1+1], 表行K[c1+1] )。解密同构造，特例取「正左侧」，故加密解密互为逆。
 *  - 表族三档：Vigenère（行 K 列 j = j+K）、Variant（j−K）、Beaufort（K−j）。
 *
 * 权威来源：
 *  - ACA「SLIDEFAIR」说明页 PDF
 *    (https://www.cryptogram.org/downloads/aca.info/ciphers/Slidefair.pdf)，访问日期 2026-09-22：
 *    规则原文（"The letters from the other corners are the substitutes, that from the top
 *    taken first. If the letters form a vertical pair in the alphabets, the cipher equivalent
 *    is the pair just to the right."）+ 三档表 + 迷你例（密钥字母 B：ca→ZD、de→EF（Vigenère）；
 *    ca→BB、de→FC（Variant）；ca→BZ、de→XY（Beaufort））+ 完整算例：Key DIGRAPH，
 *    明文 "The Slidefair can be used with Vigenère, Variant or Beaufort."
 *    → 密文 EWKMCRNUAFCXTJYQMMYYFUTIGWZPKHJMPKBSAIECKVKVCFMIILCI（48 字母）。
 *    本实现默认参数即该例。
 *  - dCode「Slidefair Cipher」(https://www.dcode.fr/slidefair-cipher)，访问日期 2026-09-22：
 *    同一算法的独立表述与 MESSAGE/ABC→EMRTECXE 例（含奇数长补位约定），佐证矩形构造。
 *
 * 约定：
 *  - 明文/密文只取 A-Z（其余字符丢弃），输出大写；长度为奇数时末尾补 X（dCode 允许随机或
 *    中性字母，本工具固定补 X 并在 desc/科普中声明；解密结果会带出该补位字母）。
 *  - 密钥只取字母，逐双字母循环（第 i 个双字母用第 i 个密钥字母）。
 *
 * 契约：register({id, cat:"classic", name, desc, params, encode, decode})。
 */
import { register } from "./registry.js";

const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 表行生成：vigenère 行 K 列 j = j+K；variant = j-K；beaufort = K-j。 */
function tableRow(kind, k) {
  const row = [];
  for (let j = 0; j < 26; j++) {
    let v;
    if (kind === "variant") v = j - k;
    else if (kind === "beaufort") v = k - j;
    else v = j + k;
    row.push(((v % 26) + 26) % 26);
  }
  return row;
}

function slidefairRun(text, keyword, kind, decode) {
  const K = String(keyword == null ? "" : keyword).toUpperCase();
  const keyLetters = [...K].filter((c) => AZ.includes(c));
  if (!keyLetters.length) throw new Error("Slidefair：密钥不含 A-Z 字母。");
  if (!["vigenere", "variant", "beaufort"].includes(kind))
    throw new Error(`Slidefair：未知表类型 "${kind}"。`);
  let letters = [...String(text == null ? "" : text).toUpperCase()].filter((c) => AZ.includes(c));
  if (!letters.length) throw new Error("Slidefair：输入不含任何 A-Z 字母。");
  if (letters.length % 2 === 1) letters.push("X"); // 奇数长补 X（工具约定）
  let out = "";
  for (let i = 0; i < letters.length; i += 2) {
    const k = AZ.indexOf(keyLetters[(i / 2) % keyLetters.length]);
    const row = tableRow(kind, k);
    const p1 = AZ.indexOf(letters[i]);
    const p2 = AZ.indexOf(letters[i + 1]);
    const c1 = p1;                 // P1 在顶行的列
    const c2 = row.indexOf(p2);    // P2 在密钥行的列
    if (c1 === c2) {
      // 竖直对：取紧邻右侧一对（解密时因角色互换自然取左侧）
      const s = decode ? (c1 + 25) % 26 : (c1 + 1) % 26;
      out += AZ[s] + AZ[row[s]];
    } else {
      out += AZ[c2] + AZ[row[c1]]; // 顶行角在前，密钥行角在后
    }
  }
  return out;
}

register({
  id: "slidefair", cat: "classic", name: "Slidefair 密码",
  desc: "双字母矩形代换：P1 在顶行、P2 在密钥行成对角，密文取另两角（顶行角在前）；同列退化取右侧一对；Vigenère/Variant/Beaufort 三档表；默认即 ACA DIGRAPH 例",
  params: [
    { key: "keyword", label: "密钥（逐双字母循环）", type: "text", default: "DIGRAPH" },
    { key: "table", label: "表族", type: "select", default: "vigenere",
      options: [
        { value: "vigenere", label: "Vigenère 表（行 K = j+K）" },
        { value: "variant", label: "Variant 表（行 K = j-K）" },
        { value: "beaufort", label: "Beaufort 表（行 K = K-j）" },
      ] },
  ],
  encode: (t, p) => slidefairRun(t, (p && p.keyword) != null ? p.keyword : "DIGRAPH", String((p && p.table) || "vigenere"), false),
  decode: (t, p) => slidefairRun(t, (p && p.keyword) != null ? p.keyword : "DIGRAPH", String((p && p.table) || "vigenere"), true),
});

export { slidefairRun, tableRow };
