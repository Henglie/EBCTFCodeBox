/*
 * sga.js — 银河标准字母 SGA（Standard Galactic Alphabet，cat:'fancy'）。
 *
 * 原理（照权威来源，未编造）：
 *  - 标准银河字母（Alphabet Galactique Standard / Standard Galactic Alphabet）：
 *    26 个自创符号一对一替换 26 个拉丁字母。1990 年出自游戏 Commander Keen，
 *    后见于 Quake 4；Minecraft 里用作附魔台文字（enchanting table），流传最广
 *    （dCode 原文确认这三处出处）。替换逐字符进行，无密钥。
 *  - 数字 0-9 不在 SGA 内（dCode 原文："Les chiffres 0-9 ne sont pas prévus
 *    pour être traduits"）。
 *
 * 文本形态约定（重点，如实登记）：
 *  - SGA 本体是图形字母，无 Unicode 官方编码。dCode 页面明确说明「Unicode 化
 *    是很糟糕但流传很广的民间适配」（"il s'agit d'une adaptation très
 *    mauvaise…qui est cependant assez répandue"）并在 FAQ 给出其 26 符
 *    Unicode 串。本 op 即采用该 dCode 收录的民间 Unicode 适配作为文本域
 *    （唯一有权威页面逐字给出的文本形态），dCode 的评价原样登记：
 *      a=ᔑ b=ʖ c=ᓵ d=↸ e=ᒷ f=⎓ g=⊣ h=⍑ i=╎ j=⋮ k=ꖌ l=ꖎ m=ᒲ n=リ
 *      o=𝙹 p=! q=¡ r=ᑑ s=∷ t=ᓭ u=ℸ+U+0323(下加点) v=⚍ w=⍊
 *      x=∴+U+0307(上加点) y=/ z=||
 *    （dCode 页面 HTML 里 u 的组合点被空格隔开，为本工具规整为相邻两码点；
 *     页面串尾还有第 27 个符号 ⨅ U+2A05 无字母对应，未收，登记。）
 *  - decode 容忍：裸 ℸ / ∴（缺组合点）也按 U / X 解（页面渲染丢组合点常见）。
 *  - encode：字母大写化后替换；数字与其它字符原样保留（dCode 口径：数字不译）。
 *    decode：逐 token 反查，未知字符原样保留。
 *
 * dCode 页面例：STANDARD 与 MINECRAFT 均以图片给出（无文本串），本 op 的
 * 权威文本向量 = FAQ 26 字母 Unicode 串逐字复现（见 verify_enc1_b.mjs）。
 *
 * 权威来源（访问日期均为 2026-09-22）：
 *  - dCode「Alphabet Galactique Standard」
 *    https://www.dcode.fr/alphabet-galactique-standard
 *    （26 符 Unicode 串、Commander Keen 1990 / Quake 4 / Minecraft 出处、
 *    数字不译说明、Unicode 适配「糟糕但流传广」评价）。
 *  - Wikipedia「Standard Galactic Alphabet」（Commander Keen 出处与
 *    Minecraft 附魔台流传；调研交叉核对）。
 */
import { register } from "./registry.js";

// 26 字母 → 文本 token（dCode FAQ Unicode 适配串逐符；u/x 为双码点含组合符）。
const SGA_MAP = {
  A: "ᔑ", B: "ʖ", C: "ᓵ", D: "↸", E: "ᒷ", F: "⎓", G: "⊣", H: "⍑",
  I: "╎", J: "⋮", K: "ꖌ", L: "ꖎ", M: "ᒲ", N: "リ", O: "𝙹", P: "!",
  Q: "¡", R: "ᑑ", S: "∷", T: "ᓭ", U: "ℸ\u0323", V: "⚍", W: "⍊",
  X: "∴\u0307", Y: "/", Z: "||",
};
const SGA_REV = new Map(); // token → 字母（长 token 先配）
for (const [l, t] of Object.entries(SGA_MAP)) SGA_REV.set(t, l);
const SGA_LONG = ["U", "X", "Z"].map((l) => SGA_MAP[l]).sort((a, b) => b.length - a.length);
SGA_REV.set("ℸ", "U"); // 裸形容忍（组合点丢失常见）
SGA_REV.set("∴", "X");

// 转义：字面字符若恰好与 SGA 符号同形（如 !、数字、|、ℸ、组合点），必须用 \ 前缀，
// 否则 decode 会把它当成字母符号。\ 本身也转义。
const SGA_ESC = "\\";
const SGA_LITERAL_SYMBOL_CHARS = new Set();
for (const tok of Object.values(SGA_MAP)) for (const ch of [...tok]) SGA_LITERAL_SYMBOL_CHARS.add(ch);

function sgaEncode(text) {
  const src = String(text == null ? "" : text);
  let out = "";
  for (const ch of src) {
    const up = ch.toUpperCase();
    if (SGA_MAP[up] != null) out += SGA_MAP[up];
    else if (SGA_LITERAL_SYMBOL_CHARS.has(ch) || ch === SGA_ESC) out += SGA_ESC + ch;
    else out += ch;
  }
  if (!out.trim()) throw new Error("SGA：输入为空。");
  return out;
}

function sgaDecode(text) {
  const src = String(text == null ? "" : text);
  if (!src.trim()) throw new Error("SGA：密文为空。");
  const cps = [...src];
  let out = "", i = 0;
  while (i < cps.length) {
    if (cps[i] === SGA_ESC) {
      if (i + 1 >= cps.length)
        throw new Error("SGA：末尾有悬空转义符（字面反斜杠请写成双反斜杠）。");
      out += cps[i + 1]; // 被转义的字面符号
      i += 2;
      continue;
    }
    let matched = false;
    for (const tok of SGA_LONG) { // 先试多码点 token：u(ℸ+下加点) x(∴+上加点) z(||)
      const t = [...tok];
      if (cps.slice(i, i + t.length).join("") === tok) {
        out += SGA_REV.get(tok);
        i += t.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    const ch = cps[i];
    out += SGA_REV.get(ch) || ch;
    i++;
  }
  return out;
}

register({
  id: "sga", cat: "fancy", name: "银河标准字母 SGA",
  desc: "26 拉丁字母 ↔ Standard Galactic Alphabet（Commander Keen/Minecraft 附魔台文字）文本域用 dCode 收录的民间 Unicode 适配串（ᔑʖᓵ↸ᒷ⎓⊣⍑╎⋮ꖌꖎᒲリ𝙹!¡ᑑ∷ᓭℸ̣⚍⍊∴̇/||，dCode 自评「糟糕但流传广」）；数字不译原样保留，u/x 含组合点（裸 ℸ/∴ 容忍）",
  params: [],
  encode: sgaEncode,
  decode: sgaDecode,
});

export { sgaEncode, sgaDecode, SGA_MAP, SGA_REV };
