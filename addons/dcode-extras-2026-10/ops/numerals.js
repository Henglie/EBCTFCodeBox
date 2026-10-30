/*
 * dcode-extras · 记数系统批（对标 dCode Système de Numération / Substitution par Symboles 中未入主件部分）
 * 码位来源：Unicode 16.0 字符库（骰子 U+2680-2685、多米诺 U+1F031-、孟加拉数字 U+09E6-09EF、
 * 欧甘 U+1681-、提非纳 U+2D30-，均以 unicodedata 官方字符名核对）。
 */

import { big, makeMapOp, runOp, A26 } from "../lib/util.js";

const CAT = "dcode-extras-2026-10/cat-numeral";

// ---------- 骰子 / 多米诺 / 孟加拉数字（Unicode 直映） ----------
const diceOps = makeMapOp({
  id: "dcode-extras-2026-10/num-dice", cat: CAT,
  name: "骰子数字 ⚀⚁⚂",
  desc: "数字 1-6 ↔ 骰面符号（U+2680 DIE FACE-1..6）；0/7-9 不在骰面域，显式报错",
  table: { 1: "⚀", 2: "⚁", 3: "⚂", 4: "⚃", 5: "⚄", 6: "⚅" },
});
const origDiceEnc = diceOps.encode;
diceOps.encode = function (text, p) {
  const s = String(text);
  for (const ch of s) if (/[0-9]/.test(ch) && !"123456".includes(ch)) throw new Error(`数字 ${ch} 不在骰面 1-6 范围内（骰子只有六面）`);
  return origDiceEnc.call(this, s, p);
};

// 多米诺：数字对映射（键是两位数字组，不能走单字符映射引擎）
const DOMINO_OF = (() => {
  const m = new Map();
  for (let a = 0; a <= 6; a++) for (let b = 0; b <= 6; b++) m.set(`${a}${b}`, String.fromCodePoint(0x1f031 + a * 7 + b));
  return m;
})();
const DOMINO_KEY = new Map([...DOMINO_OF].map(([k, v]) => [v, k]));
export const dominoOps = {
  id: "dcode-extras-2026-10/num-domino", cat: CAT,
  name: "多米诺数字 🁡🁢",
  desc: "两位数字组 00-66 ↔ 横置多米诺（U+1F031 DOMINO TILE HORIZONTAL-00-00 起，按 a*7+b 全序：00-00…06-06, 10-00…66-06，高半=第一位、低半=第二位，点数 0-6）；双向",
  params: [],
  encode(text) {
    const s = String(text).replace(/\s+/g, "");
    if (!s) throw new Error("需要数字串");
    if (s.length % 2 !== 0) throw new Error("多米诺按两位一组，输入长度需为偶数");
    const out = [];
    for (let i = 0; i < s.length; i += 2) {
      const g = s.slice(i, i + 2);
      const v = DOMINO_OF.get(g);
      if (!v) throw new Error(`数字组「${g}」非法：多米诺每半边点数只能 0-6`);
      out.push(v);
    }
    return out.join("");
  },
  decode(text) {
    const s = String(text);
    const out = [];
    let i = 0;
    while (i < s.length) {
      const ch = s.codePointAt(i) >= 0x10000 ? String.fromCodePoint(s.codePointAt(i)) : s[i];
      if (/\s/.test(ch)) { i += ch.length; continue; }
      const k = DOMINO_KEY.get(ch);
      if (!k) throw new Error(`位置 ${i} 的符号「${ch}」不是多米诺牌面（U+1F031..1F061）`);
      out.push(k);
      i += ch.length;
    }
    if (!out.length) throw new Error("没有可解码的多米诺牌面");
    return out.join("");
  },
};

const bengaliOps = makeMapOp({
  id: "dcode-extras-2026-10/num-bengali", cat: CAT,
  name: "孟加拉数字 ০১২৩",
  desc: "阿拉伯数字 ↔ 孟加拉数字（U+09E6 BENGALI DIGIT ZERO 起 10 位，Unicode 官方字符名核对）",
  table: { 0: "০", 1: "১", 2: "২", 3: "৩", 4: "৪", 5: "৫", 6: "৬", 7: "৭", 8: "৮", 9: "৯" },
});

// ---------- 欧甘 / 提非纳（真实文字系统的拉丁转写子集） ----------
const oghamOps = makeMapOp({
  id: "dcode-extras-2026-10/num-ogham", cat: CAT,
  name: "欧甘字母 ᚁᚂᚃ",
  desc: "拉丁字母 ↔ 欧甘字母子集（U+1681 OGHAM LETTER BEITH 起按原始爱尔兰转写：beith=B、coll=C、ceirt=Q、muin=M、gort=G、ngedal=NG、straif=Z…；j/k/p/v/w/x/y 无对应欧甘字母，原样保留）",
  table: {
    B: "ᚁ", L: "ᚂ", F: "ᚃ", S: "ᚄ", N: "ᚅ", H: "ᚆ", D: "ᚇ", T: "ᚈ", C: "ᚉ", Q: "ᚊ",
    M: "ᚋ", G: "ᚌ", Z: "ᚎ", R: "ᚏ", A: "ᚐ", O: "ᚑ", U: "ᚒ", E: "ᚓ", I: "ᚔ",
  },
});

const tifinaghOps = makeMapOp({
  id: "dcode-extras-2026-10/num-tifinagh", cat: CAT,
  name: "提非纳字母 ⴰⴱⴳ",
  desc: "拉丁字母 ↔ 提非纳（IRCAM 现代塔马齐格特字母，U+2D30 起）；c/p/v 无对应字母，原样保留",
  table: {
    A: "ⴰ", B: "ⴱ", D: "ⴷ", E: "ⴻ", F: "ⴼ", G: "ⴳ", H: "ⵀ", I: "ⵉ", J: "ⵊ", K: "ⴽ", L: "ⵍ",
    M: "ⵎ", N: "ⵏ", Q: "ⵇ", R: "ⵔ", S: "ⵙ", T: "ⵜ", U: "ⵓ", W: "ⵡ", X: "ⵅ", Y: "ⵢ", Z: "ⵣ",
  },
});

// ---------- 计数符（tally） ----------
export const tallyOps = {
  id: "dcode-extras-2026-10/num-tally", cat: CAT,
  name: "计数符（画正/杠）",
  desc: "n ↔ 计数符：每 5 个一组记作 4 竖杠加 1 斜杠「||||/」，余数补竖杠；双向",
  params: [],
  encode(text) {
    const n = big(text);
    if (n === null || n < 0n) throw new Error("需要非负整数");
    if (n > 10000n) throw new Error("n ≤ 10000（防输出爆炸）");
    const groups = n / 5n, rem = n % 5n;
    return ("||||/ ".repeat(Number(groups)).trim() + (rem ? " " + "|".repeat(Number(rem)) : "")).trim();
  },
  decode(text) {
    const s = String(text);
    let total = 0;
    for (const tok of s.trim().split(/\s+/)) {
      if (/^\|\|\|\|\/$/.test(tok)) total += 5;
      else if (/^\|+$/.test(tok)) total += tok.length;
      else throw new Error(`无法识别的计数组「${tok}」（约定：4 竖杠+斜杠=5，竖杠=1）`);
    }
    return String(total);
  },
};

// ---------- Bibi-binaire（Boby Lapointe, 1968） ----------
const BIBI_C = ["B", "K", "D", "F"], BIBI_V = ["A", "E", "I", "O"];
export const bibiOps = {
  id: "dcode-extras-2026-10/num-bibi", cat: CAT,
  name: "Bibi 二进制（Boby Lapointe）",
  desc: "十六进制每位的 4 比特拆「高 2 位→辅音 B/K/D/F + 低 2 位→元音 A/E/I/O」拼成音节（0=BA…15=FO）；十进制 ↔ Bibi 音节，双向",
  params: [],
  encode(text) {
    const n = big(text);
    if (n === null || n < 0n) throw new Error("需要非负整数");
    if (n > 10n ** 24n) throw new Error("n ≤ 10^24");
    if (n === 0n) return "BA";
    const hex = n.toString(16).toUpperCase();
    return [...hex].map((h) => {
      const v = parseInt(h, 16);
      return BIBI_C[v >> 2] + BIBI_V[v & 3];
    }).join("");
  },
  decode(text) {
    const s = String(text).trim().toUpperCase().replace(/\s+/g, "");
    if (!s) throw new Error("需要 Bibi 音节串（如 KOFEBABIBA）");
    if (s.length % 2 !== 0) throw new Error("Bibi 每个音节 2 个字母，总长需为偶数");
    let hex = "";
    for (let i = 0; i < s.length; i += 2) {
      const c = s[i], v = s[i + 1];
      const ci = BIBI_C.indexOf(c), vi = BIBI_V.indexOf(v);
      if (ci < 0 || vi < 0) throw new Error(`音节「${c}${v}」非法（辅音需 B/K/D/F，元音需 A/E/I/O）`);
      hex += ((ci << 2) | vi).toString(16);
    }
    return BigInt("0x" + hex).toString();
  },
};

// ---------- Shadok（法式四进制） ----------
const SHADOK = ["GA", "BU", "ZO", "MEU"];
export const shadokOps = {
  id: "dcode-extras-2026-10/num-shadok", cat: CAT,
  name: "Shadok 记数（GA/BU/ZO/MEU）",
  desc: "四进制记数：GA=0 BU=1 ZO=2 MEU=3（Les Shadoks 动画记数法）；十进制 ↔ Shadok 词串，双向",
  params: [],
  encode(text) {
    const n = big(text);
    if (n === null || n < 0n) throw new Error("需要非负整数");
    if (n > 10n ** 12n) throw new Error("n ≤ 10^12");
    if (n === 0n) return "GA";
    const q4 = n.toString(4);
    return [...q4].map((d) => SHADOK[+d]).join(" ");
  },
  decode(text) {
    const toks = String(text).trim().toUpperCase().split(/[\s,;]+/).filter(Boolean);
    if (!toks.length) throw new Error("需要 Shadok 词串（GA/BU/ZO/MEU）");
    let v = 0n;
    for (const t of toks) {
      const i = SHADOK.indexOf(t);
      if (i < 0) throw new Error(`未知词「${t}」（只有 GA/BU/ZO/MEU）`);
      v = v * 4n + BigInt(i);
    }
    return v.toString();
  },
};

// ---------- 七段数码管（ASCII） ----------
const SEG = {
  0: [" _ ", "| |", "|_|"], 1: ["   ", "  |", "  |"], 2: [" _ ", " _|", "|_ "],
  3: [" _ ", " _|", " _|"], 4: ["   ", "|_|", "  |"], 5: [" _ ", "|_ ", " _|"],
  6: [" _ ", "|_ ", "|_|"], 7: [" _ ", "  |", "  |"], 8: [" _ ", "|_|", "|_|"], 9: [" _ ", "|_|", " _|"],
};
export const sevenSegOps = {
  id: "dcode-extras-2026-10/num-sevenseg", cat: CAT,
  name: "七段数码管（ASCII）",
  desc: "数字 ↔ 经典七段三行 ASCII 字形（横杠 + 竖杠）；双向",
  params: [],
  encode(text) {
    const s = String(text).trim();
    if (!s) throw new Error("需要数字串");
    for (const ch of s) if (!/[0-9]/.test(ch)) throw new Error(`字符「${ch}」不是数字（七段字形只覆盖 0-9）`);
    const rows = ["", "", ""];
    for (const ch of s) for (let r = 0; r < 3; r++) rows[r] += SEG[+ch][r] + " ";
    return rows.map((r) => r.trimEnd()).join("\n");
  },
  decode(text) {
    const lines = String(text).replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
    if (lines.length !== 3) throw new Error("需要恰好 3 行七段字形");
    const rows = lines.map((l) => l.replace(/\s+$/, "").padEnd(Math.max(...lines.map((x) => x.replace(/\s+$/, "").length)), " "));
    const w = rows[0].length;
    if ((w + 1) % 4 !== 0) throw new Error("字形列宽不对（每位 3 列 + 1 空列）");
    const n = (w + 1) / 4;
    const out = [];
    for (let i = 0; i < n; i++) {
      const col = [0, 1, 2].map((r) => rows[r].slice(i * 4, i * 4 + 3));
      const hit = Object.keys(SEG).find((d) => SEG[d].every((row, r) => row === col[r]));
      if (hit === undefined) throw new Error(`第 ${i + 1} 位字形无法识别`);
      out.push(hit);
    }
    return out.join("");
  },
};

// ---------- 算盘（soroban ASCII） ----------
export const sorobanOps = {
  id: "dcode-extras-2026-10/num-soroban", cat: CAT,
  name: "算盘 Soroban（ASCII）",
  desc: "非负整数 ↔ 日式算盘 ASCII 图：每列上珠 1 颗（值 5，拨下靠梁）+ 下珠 4 颗（值 1，拨上靠梁）；列宽 4；双向",
  params: [],
  encode(text) {
    const n = big(text);
    if (n === null || n < 0n) throw new Error("需要非负整数");
    const s = n.toString();
    if (s.length > 12) throw new Error("最多 12 位（防输出爆炸）");
    const cols = [...s].map((d) => +d);
    const w = cols.length;
    const bar = "━".repeat(w * 4 + 1);
    const heaven = "|" + cols.map((d) => (d >= 5 ? " ●  " : "    ")).join("|") + "|";
    const up = "|" + cols.map((d) => ("●".repeat(d % 5)).padEnd(4, " ")).join("|") + "|";
    const down = "|" + cols.map((d) => (" ".repeat(d % 5) + "●".repeat(4 - (d % 5)))).join("|") + "|";
    return ["┌" + bar + "┐", heaven, bar, up, down, "└" + bar + "┘"].join("\n");
  },
  decode(text) {
    const lines = String(text).replace(/\r/g, "").split("\n").map((l) => l.trimEnd()).filter((l) => l !== "");
    const hi = lines.findIndex((l) => l.includes("|"));
    if (hi < 0) throw new Error("算盘图中没有珠列行");
    const heaven = lines[hi];
    const upIdx = lines.findIndex((l, k) => k > hi && l.includes("|"));
    if (upIdx < 0) throw new Error("算盘图缺少下珠行");
    const up = lines[upIdx];
    const n = Math.floor((heaven.length - 1) / 5);
    if (n < 1 || n > 12) throw new Error("算盘列数异常");
    const out = [];
    for (let i = 0; i < n; i++) {
      const h = heaven.slice(i * 5 + 1, i * 5 + 5).includes("●") ? 5 : 0;
      const u = up.slice(i * 5 + 1, i * 5 + 5).split("").filter((c) => c === "●").length;
      out.push(h + u);
    }
    return out.join("");
  },
};

// ---------- Cistercian 修士数字（文本结构式） ----------
// 依据 Wikipedia “Cistercian numerals”：竖梁四角记位——个位=左上、十位=右上、
// 百位=左下、千位=右下（历史存在角落分工变体，本实现采用维基主文口径并在 desc 标注）。
// 每位 1-9 的笔画集（1=左杆 2=右杆 3=双杆 4=反向双杆 5=点 6=点+左杆 7=点+右杆 8=点+双杆 9=点+反双杆）
const CIST_UNITS = { 1: "左杆", 2: "右杆", 3: "双杆", 4: "反向双杆", 5: "点", 6: "点+左杆", 7: "点+右杆", 8: "点+双杆", 9: "点+反向双杆" };
/** 十位/千位是 units 的左右镜像（reverse），笔画名交换左右；百位/千位是上下翻转，左右名不变（已由角位置表达）。 */
function cistName(digit, placeIdx) {
  const n = CIST_UNITS[digit];
  if ((placeIdx === 1 || placeIdx === 3) && n) {
    return n.replace(/左杆|右杆/g, (m) => (m === "左杆" ? "右杆" : "左杆"));
  }
  return n;
}
export const cistercianOps = {
  id: "dcode-extras-2026-10/num-cistercian", cat: CAT,
  name: "Cistercian 修士数字（结构式）",
  desc: "0-9999 ↔ 四角笔画集文本（个位=左上/十位=右上/百位=左下/千位=右下，维基主文口径；历史存在角落分工变体）。图形渲染留后续批",
  params: [],
  encode(text) {
    const n = big(text);
    if (n === null || n < 0n || n > 9999n) throw new Error("Cistercian 数字域为 0-9999");
    const s = n.toString().padStart(4, "0");
    const parts = [];
    const labels = ["个位(左上)", "十位(右上)", "百位(左下)", "千位(右下)"];
    s.split("").forEach((ch, i) => { if (ch !== "0") parts.push(`${labels[i]}=${ch}(${cistName(+ch, i)})`); });
    return n === 0n ? "0（空梁；历史书写中空梁不表示数）" : `${n} = ` + parts.join("，");
  },
  decode(text) {
    const src = String(text).trim();
    if (/^\d+$/.test(src)) {
      const n = BigInt(src);
      if (n > 9999n) throw new Error("数字域 0-9999");
      return src;
    }
    const m = [...src.matchAll(/(个位|十位|百位|千位)\(左上|右下\)?=?(\d)/g)];
    const order = { "个位": 0, "十位": 1, "百位": 2, "千位": 3 };
    const digs = [0, 0, 0, 0];
    const re = /(个位|十位|百位|千位)[（(][^）)]*[）)]\s*=\s*(\d)/g;
    let mm, found = false;
    while ((mm = re.exec(src))) { digs[order[mm[1]]] = +mm[2]; found = true; }
    if (!found) throw new Error("格式：个位(左上)=1，十位(右上)=2，…（或直接给 0-9999 的数字）");
    return String(digs.reduce((a, d) => a * 10 + d, 0));
  },
};

// ---------- Kaktovik 因纽特数字（结构式） ----------
// 依据 Wikipedia “Kaktovik numerals”：二十进制、每数字上半记 5 的个数（0-3 笔）、
// 下半记余数 0-4 笔、0 = 交叉臂（记作 X）。
export const kaktovikOps = {
  id: "dcode-extras-2026-10/num-kaktovik", cat: CAT,
  name: "Kaktovik 因纽特数字（结构式）",
  desc: "十进制 ↔ 二十进制 Kaktovik 结构式：每位记「上:5 的笔数 下:余量笔数」（0 记作 X）；20 = [1|0] 即「上0下1 + X」",
  params: [],
  encode(text) {
    const n = big(text);
    if (n === null || n < 0n) throw new Error("需要非负整数");
    if (n > 10n ** 15n) throw new Error("n ≤ 10^15");
    if (n === 0n) return "0 = [X]";
    const b20 = [];
    let x = n;
    while (x > 0n) { b20.unshift(Number(x % 20n)); x /= 20n; }
    const blocks = b20.map((d) => {
      if (d === 0) return "[X]";
      const up = Math.floor(d / 5), low = d % 5;
      const upStr = up ? "¯".repeat(up) : "";
      return `[${upStr}/${"|".repeat(low)}]`;
    });
    return `${n} = ` + blocks.join(" ");
  },
  decode(text) {
    const s = String(text).trim();
    if (/^\d+$/.test(s)) return s;
    const toks = s.split(/\s+/).filter((t) => t.startsWith("[") || t === "X" || t === "[X]");
    if (!toks.length) throw new Error("格式：[上笔数/下笔数] 序列或 X（0）");
    let v = 0n;
    for (const t of toks) {
      const m = t.match(/^\[(¯*)\/?(\|*)\]$/) || (t === "X" || t === "[X]" ? ["", "", ""] : null);
      if (!m) throw new Error(`无法识别的块「${t}」`);
      const up = (m[1] || "").length, low = (m[2] || "").length;
      if (up > 3 || low > 4) throw new Error(`块「${t}」笔画超界（上 ≤3 笔、下 ≤4 笔）`);
      v = v * 20n + BigInt(up * 5 + low);
    }
    return v.toString();
  },
};

// ---------- 法语数字读法（rectifiée 1990 连字符拼写） ----------
const FR_SMALL = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
const FR_TENS = { 2: "vingt", 3: "trente", 4: "quarante", 5: "cinquante", 6: "soixante" };
function frUnder100(n) {
  if (n < 20) return FR_SMALL[n];
  if (n < 70) {
    const t = Math.floor(n / 10), u = n % 10;
    if (u === 0) return FR_TENS[t];
    if (u === 1) return FR_TENS[t] + "-et-un";
    return FR_TENS[t] + "-" + FR_SMALL[u];
  }
  if (n < 80) {
    if (n === 70) return "soixante-dix";
    if (n === 71) return "soixante-et-onze";
    return "soixante-" + FR_SMALL[n - 60];
  }
  if (n === 80) return "quatre-vingts";
  if (n < 100) {
    const r = n - 80;
    return "quatre-vingt-" + FR_SMALL[r];
  }
  return null;
}
function frWords(n) {
  if (n === 0n) return "zéro";
  if (n >= 10n ** 15n) throw new Error("n ≤ 10^15-1");
  const parts = [];
  const scales = [[10n ** 12n, "billion", "billions"], [10n ** 9n, "milliard", "milliards"], [10n ** 6n, "million", "millions"], [10n ** 3n, "mille", "mille"]];
  let rest = n;
  for (const [unit, sg, pl] of scales) {
    const q = rest / unit; rest %= unit;
    if (q === 0n) continue;
    if (unit === 1000n) {
      // mille 是不变词：其前的 cents/quatre-vingts 去复数 s（deux cent mille、quatre-vingt mille）
      const qs = q === 1n ? "mille" : frWords(q).replace(/cents$/, "cent").replace(/quatre-vingts$/, "quatre-vingt") + " mille";
      parts.push(qs);
    } else {
      parts.push(q === 1n ? sg : frWords(q) + " " + pl);
    }
  }
  if (rest > 0n) {
    const r = Number(rest);
    if (r < 100) parts.push(frUnder100(r));
    else {
      const h = Math.floor(r / 100), u = r % 100;
      // rectifiée 1990：复合数连字符；cents 复数仅在整百；cent 后不接 et-un（101 = cent-un）
      const hStr = h === 1 ? "cent" : FR_SMALL[h] + (u === 0 ? " cents" : "-cent");
      parts.push(u === 0 ? hStr : hStr + "-" + frUnder100(u));
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
function frParse(s) {
  s = s.toLowerCase().replace(/[’']/g, "-").replace(/\s+/g, " ").trim();
  if (!s) throw new Error("需要法语数字读法");
  const SMALLV = {}; FR_SMALL.forEach((w, i) => SMALLV[w] = i);
  const TENSV = { vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60 };
  let total = 0n, cur = 0n; // cur：当前千元以下的累计
  let tens = 0, prevQuatre = false, saw = false;
  const flushTens = () => { cur += BigInt(tens); tens = 0; };
  const finishPart = () => { flushTens(); saw = true; };
  for (const raw of s.split(/[\s-]+/).filter(Boolean)) {
    const t = raw === "cents" ? "cent" : raw === "vingts" ? "vingt" : raw; // 复数尾 s 归一
    if (t in SMALLV && SMALLV[t] < 20) {
      const v = SMALLV[t];
      if (tens >= 60 && v >= 10) { tens += v; continue; } // soixante-dix-neuf / quatre-vingt-dix-neuf
      finishPart();
      cur += BigInt(v);
      prevQuatre = t === "quatre";
      continue;
    }
    if (t === "vingt") {
      if (prevQuatre) { cur -= 4n; tens = 80; prevQuatre = false; continue; }
      tens = 20; prevQuatre = false; continue;
    }
    if (t in TENSV) { tens = TENSV[t]; prevQuatre = false; continue; }
    if (t === "et") { prevQuatre = false; continue; } // et-un：数值由随后的 un 加回
    if (t === "cent") {
      if (cur > 0n && cur < 10n) { cur *= 100n; prevQuatre = false; continue; }
      finishPart();
      cur += 100n;
      prevQuatre = false;
      continue;
    }
    if (t === "mille") {
      finishPart();
      total += (cur === 0n ? 1n : cur) * 1000n;
      cur = 0n;
      prevQuatre = false;
      continue;
    }
    if (/^millions?$/.test(t)) { finishPart(); total += (cur === 0n ? 1n : cur) * 10n ** 6n; cur = 0n; prevQuatre = false; continue; }
    if (/^milliards?$/.test(t)) { finishPart(); total += (cur === 0n ? 1n : cur) * 10n ** 9n; cur = 0n; prevQuatre = false; continue; }
    if (/^billions?$/.test(t)) { finishPart(); total += (cur === 0n ? 1n : cur) * 10n ** 12n; cur = 0n; prevQuatre = false; continue; }
    throw new Error(`无法识别的法语数字词「${raw}」`);
  }
  finishPart();
  if (!saw && total === 0n && cur === 0n) throw new Error("没有解析到任何数字词");
  return (total + cur).toString();
}
export const frenchNumberOps = {
  id: "dcode-extras-2026-10/num-frenchwords", cat: CAT,
  name: "法语数字读法（nombre en lettres）",
  desc: "数字 ↔ 法语读法（1990 rectifiée 连字符拼写：quatre-vingt-dix-neuf、soixante-et-onze、deux cents/deux cent trois、mille 不变复数）；encode=数字→读法，decode=读法→数字",
  params: [],
  encode: (text) => frWords(big(text)),
  decode: (text) => frParse(text),
};

// ---------- 10 的幂 / 科学计数法 ----------
export const powers10Ops = {
  id: "dcode-extras-2026-10/num-powers10", cat: CAT,
  name: "10 的幂与数量级词头",
  desc: "给指数或数字，输出 10^n 的值、SI 词头（k/M/G…与毫/微…）与英文短级制命名",
  params: [],
  run(text) {
    const src = String(text).trim();
    const n = big(src);
    if (n === null) throw new Error("需要整数（指数 n，−30..30）");
    if (n < -30n || n > 30n) throw new Error("指数需在 −30..30");
    const val = 10n ** (n < 0n ? -n : n);
    const PRE = { 30: "Q", 27: "R", 24: "Y", 21: "Z", 18: "E", 15: "P", 12: "T", 9: "G", 6: "M", 3: "k", 0: "", "-3": "m", "-6": "µ", "-9": "n", "-12": "p", "-15": "f", "-18": "a", "-21": "z", "-24": "y", "-27": "r", "-30": "q" };
    const pre = PRE[n.toString()] ?? "—";
    const lines = [`10^${n} = ${n >= 0n ? val.toString() : "1/" + val.toString()}`];
    lines.push(`SI 词头：${pre === "—" ? "（超出本表）" : pre}`);
    return lines.join("\n");
  },
};

export const OPS = [
  diceOps, dominoOps, bengaliOps, oghamOps, tifinaghOps, tallyOps, bibiOps, shadokOps,
  sevenSegOps, sorobanOps, cistercianOps, kaktovikOps, frenchNumberOps, powers10Ops,
];
