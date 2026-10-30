/*
 * dcode-extras · 符号字母表批（逐源核验子集）
 *
 * 来源纪律：每个表/规则均经外部权威来源核验（码位经 Unicode 官方数据或本机 unicodedata，
 * 字母表映射经权威页面原文）。无权威文本表的符号字母一律不收录（图像源无法转写为可靠文本表）。
 * 逐项来源与未收录清单见工程留存目录下的符号来源档案。
 */

import { big, runOp } from "../lib/util.js";
import { CP437 } from "./cp437data.js";

const CAT = "dcode-extras-2026-10/cat-symbol";
const CP = (hex) => String.fromCodePoint(hex);

// ---------- 克林贡 pIqaD（CSUR 注册区 U+F8D0-F8FF；来源 evertype.com CSUR 官方码表，2026-10-25 抓取） ----------
const KLINGON = {
  a: 0xf8d0, b: 0xf8d1, ch: 0xf8d2, D: 0xf8d3, e: 0xf8d4, gh: 0xf8d5, H: 0xf8d6,
  i: 0xf8d7, j: 0xf8d8, l: 0xf8d9, m: 0xf8da, n: 0xf8db, ng: 0xf8dc, o: 0xf8dd,
  p: 0xf8de, q: 0xf8df, Q: 0xf8e0, r: 0xf8e1, S: 0xf8e2, t: 0xf8e3, tlh: 0xf8e4,
  u: 0xf8e5, v: 0xf8e6, w: 0xf8e7, y: 0xf8e8, "'": 0xf8e9,
  0: 0xf8f0, 1: 0xf8f1, 2: 0xf8f2, 3: 0xf8f3, 4: 0xf8f4, 5: 0xf8f5, 6: 0xf8f6, 7: 0xf8f7, 8: 0xf8f8, 9: 0xf8f9,
};
const KLINGON_REV = new Map(Object.entries(KLINGON).map(([k, v]) => [CP(v), k]));
// 转写读序（最长匹配优先）
const KLINGON_ORDER = ["tlh", "ng", "gh", "ch", "a", "b", "D", "e", "H", "i", "j", "l", "m", "n", "o", "p", "q", "Q", "r", "S", "t", "u", "v", "w", "y", "'", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

export const klingonOps = {
  id: "dcode-extras-2026-10/sym-klingon", cat: CAT,
  name: "克林贡 pIqaD",
  desc: "拉丁转写 ↔ pIqaD（ConScript Unicode Registry 注册区 U+F8D0-F8FF，KLI 口径；大小写敏感：q/Q 与 D/H/S 大写表特殊音）。表源 evertype.com CSUR 码表",
  params: [],
  encode(text) {
    const s = String(text);
    const out = [];
    let i = 0;
    while (i < s.length) {
      let hit = null;
      for (const k of KLINGON_ORDER) if (s.startsWith(k, i)) { hit = k; break; }
      if (hit === null) throw new Error(`位置 ${i} 的「${s[i]}」不是克林贡转写字母（a-z 与 '；ch/gh/ng/tlh 双写）`);
      out.push(CP(KLINGON[hit]));
      i += hit.length;
    }
    return out.join("");
  },
  decode(text) {
    const s = String(text);
    const out = [];
    let i = 0;
    while (i < s.length) {
      const ch = s.codePointAt(i) >= 0x10000 ? CP(s.codePointAt(i)) : s[i];
      const k = KLINGON_REV.get(ch);
      if (k === undefined) throw new Error(`位置 ${i} 的符号不在 pIqaD 注册区（U+F8D0-F8FF）`);
      out.push(k);
      i += ch.length;
    }
    return out.join("");
  },
};

// ---------- 易经六十四卦（Unicode U+4DC0-4DFF 文王卦序；码位经本机 unicodedata 核：1=CREATIVE HEAVEN、2=RECEPTIVE EARTH、64=BEFORE COMPLETION） ----------
const GUA64_ZH = ["乾", "坤", "屯", "蒙", "需", "讼", "师", "比", "小畜", "履", "泰", "否", "同人", "大有", "谦", "豫", "随", "蛊", "临", "观", "噬嗑", "贲", "剥", "复", "无妄", "大畜", "颐", "大过", "坎", "离", "咸", "恒", "遁", "大壮", "晋", "明夷", "家人", "睽", "蹇", "解", "损", "益", "夬", "姤", "萃", "升", "困", "井", "革", "鼎", "震", "艮", "渐", "归妹", "丰", "旅", "巽", "兑", "涣", "节", "中孚", "小过", "既济", "未济"];

export const hexagramOps = {
  id: "dcode-extras-2026-10/sym-hexagram", cat: CAT,
  name: "易经六十四卦 ䷀䷁",
  desc: "卦序 1-64 ↔ 卦符（Unicode U+4DC0-4DFF 按文王卦序连续排列：1=䷀ 乾 … 64=䷿ 未济）。附 Unicode 官方名（英文）与卦名",
  params: [],
  encode(text) {
    const n = big(text);
    if (n === null || n < 1n || n > 64n) throw new Error("卦序需为 1-64（文王卦序）");
    const cp = 0x4dc0 + Number(n) - 1;
    return `${CP(cp)} 第${n}卦 ${GUA64_ZH[Number(n) - 1]}（Unicode HEXAGRAM U+${cp.toString(16).toUpperCase()}）`;
  },
  decode(text) {
    const s = String(text).trim();
    if (/^\d+$/.test(s)) {
      const n = Number(s);
      if (n < 1 || n > 64) throw new Error("卦序需为 1-64");
      return s;
    }
    for (let i = 0; i < s.length; i++) {
      const cp = s.codePointAt(i);
      if (cp >= 0x4dc0 && cp <= 0x4dff) return String(cp - 0x4dc0 + 1);
    }
    throw new Error("输入需为 1-64 的卦序数字，或 U+4DC0-4DFF 卦符");
  },
};

// ---------- Kaktovik 数字 Unicode 字形（Unicode 15.0 U+1D2C0-1D2D3；来源 unicode.org 官方 NamesList，2026-10-25 核验 ZERO..NINETEEN 连续） ----------
export const kaktovikUnicodeOps = {
  id: "dcode-extras-2026-10/sym-kaktovik-uni", cat: CAT,
  name: "Kaktovik 数字（Unicode 字形 𝋀𝋁）",
  desc: "十进制 ↔ Kaktovik 因纽特数字 Unicode 15.0 字形（U+1D2C0-1D2D3，0-19 连续）；多位数按二十进制逐位映射字形（与结构式 op 同口径）。显示需支持 Unicode 15 的字体",
  params: [],
  encode(text) {
    const n = big(text);
    if (n === null || n < 0n || n > 10n ** 15n) throw new Error("需要非负整数（≤10^15）");
    if (n === 0n) return CP(0x1d2c0);
    const b20 = [];
    let x = n;
    while (x > 0n) { b20.unshift(Number(x % 20n)); x /= 20n; }
    return b20.map((d) => CP(0x1d2c0 + d)).join("");
  },
  decode(text) {
    const s = String(text).trim();
    if (/^\d+$/.test(s)) return s;
    let v = 0n, i = 0, saw = false;
    while (i < s.length) {
      const cp = s.codePointAt(i);
      if (cp >= 0x1d2c0 && cp <= 0x1d2d3) { v = v * 20n + BigInt(cp - 0x1d2c0); saw = true; i += cp > 0xffff ? 2 : 1; continue; }
      if (/\s/.test(s[i])) { i++; continue; }
      throw new Error(`位置 ${i} 的符号不是 Kaktovik 数字（U+1D2C0-1D2D3）`);
    }
    if (!saw) throw new Error("没有 Kaktovik 数字字形");
    return v.toString();
  },
};

// ---------- 盲文 GS8（8 点计算机盲文；6 点字母域为标准布莱叶，大写加点 7；码位经本机 unicodedata 官方名核验） ----------
// 点位位值：dot1=0x01 … dot8=0x80。a-j 标准点位；k-t=a-j+点3；u/v/x/y/z=a-e+点3+点6；w=点2456。
const BR_BITS = [0x01, 0x03, 0x09, 0x19, 0x0b, 0x11, 0x1b, 0x13, 0x0a, 0x1a];
const BR_LETTER = new Map();
"abcdefghij".split("").forEach((c, i) => BR_LETTER.set(c, BR_BITS[i]));
"klmnopqrst".split("").forEach((c, i) => BR_LETTER.set(c, BR_BITS[i] | 0x04));
BR_LETTER.set("u", BR_BITS[0] | 0x24);
BR_LETTER.set("v", BR_BITS[1] | 0x24);
BR_LETTER.set("w", 0x2a);
BR_LETTER.set("x", BR_BITS[2] | 0x24);
BR_LETTER.set("y", BR_BITS[3] | 0x24);
BR_LETTER.set("z", BR_BITS[4] | 0x24);
const NUM_SIGN = 0x3c; // 点 3456 数字记号

export const brailleGS8Ops = {
  id: "dcode-extras-2026-10/sym-braille-gs8", cat: CAT,
  name: "盲文 GS8（8 点计算机盲文）",
  desc: "拉丁字母/数字 ↔ 盲文 Unicode（U+2800-28FF）。字母域=标准 6 点布莱叶；大写=字母格加点 7（GS8/NBCB 计算机盲文口径）；数字=数字记号 ⠼ + a-j（1-9,0）",
  params: [],
  encode(text) {
    const s = String(text);
    const out = [];
    let pendingNum = false;
    for (const ch of s) {
      const lower = ch.toLowerCase();
      if (/[0-9]/.test(ch)) {
        if (!pendingNum) { out.push(CP(0x2800 + NUM_SIGN)); pendingNum = true; }
        out.push(CP(0x2800 + BR_BITS[ch === "0" ? 9 : ch.charCodeAt(0) - 49]));
        continue;
      }
      if (/[a-z]/.test(lower)) {
        if (pendingNum && /[k-z]/.test(lower)) throw new Error("数字记号后出现 k-z（数字只用 a-j 表示 1-9,0）");
        if (pendingNum) { /* 数字域内的 a-j 已由上一分支处理；此处 a-j 结束数字 */ }
        out.push(CP(0x2800 + BR_LETTER.get(lower) | (ch === lower ? 0 : 0x40)));
        pendingNum = false;
        continue;
      }
      if (ch === " ") { out.push(CP(0x2800)); pendingNum = false; continue; }
      out.push(ch); pendingNum = false; // 非字母数字透传（标点盲文符号不属本 op 字母域）
    }
    return out.join("");
  },
  decode(text) {
    const s = String(text);
    const out = [];
    let i = 0, numMode = false;
    while (i < s.length) {
      const cp = s.codePointAt(i);
      if (cp >= 0x2800 && cp <= 0x28ff) {
        const bits = cp - 0x2800;
        if (bits === 0x3c) { numMode = true; i++; continue; }
        if (bits === 0) { out.push(" "); numMode = false; i++; continue; }
        const upper = (bits & 0x40) !== 0;
        const base = bits & 0x3f;
        let hit = null;
        for (const [c, b] of BR_LETTER) if (b === base) { hit = c; break; }
        if (hit === null) throw new Error(`盲文格 U+${cp.toString(16)} 不在本 op 字母域（6 点字母 + 点 7 大写）`);
        if (numMode && "abcdefghij".includes(hit)) {
          out.push(String("abcdefghij".indexOf(hit) === 9 ? 0 : "abcdefghij".indexOf(hit) + 1)); // 数字域持续到空格/非盲文格
        } else {
          if (numMode && /[k-z]/.test(hit)) throw new Error(`数字记号后出现字母 ${hit}（数字只用 a-j 表示 1-9,0）`);
          out.push(upper ? hit.toUpperCase() : hit);
          numMode = false;
        }
        i++;
        continue;
      }
      out.push(s[i]); numMode = false;
      i++;
    }
    return out.join("");
  },
};

// ---------- Alt 码（IBM PC CP437 数字小键盘口径；1-31 显示字形=维基 Code page 437 图表，32-255=codec，见 cp437data.js 头注） ----------
export const altCodesOps = {
  id: "dcode-extras-2026-10/sym-altcodes", cat: CAT,
  name: "Alt 码（CP437 小键盘）",
  desc: "十进制 Alt 码 ↔ IBM PC CP437 字形（Alt+NNN 口径；Alt+0NNN 的 Windows ANSI 口径不支持，显式报错）。1-31 为 DOS 显示字形（☺♥♦…），码表见 ops/cp437data.js（机器生成自官方图表与 codec）",
  params: [],
  encode(text) {
    const src = String(text).trim();
    if (!/^\d{1,3}(\s+\d{1,3})*$/.test(src)) throw new Error("输入需为 1-255 的十进制码（空格分隔多个）");
    const out = [];
    for (const tok of src.split(/\s+/)) {
      const n = Number(tok);
      if (n < 1 || n > 255) throw new Error(`码位 ${n} 超界（CP437 口径为 1-255）`);
      out.push(CP437[n - 1]);
    }
    return out.join("");
  },
  decode(text) {
    const s = String(text);
    const out = [];
    for (const ch of s) {
      const idx = CP437.indexOf(ch);
      if (idx < 0) throw new Error(`字符「${ch}」不在 CP437（IBM PC）字符集中`);
      out.push(String(idx + 1));
    }
    return out.join(" ");
  },
};

// ---------- 猪圈密码（共济会栅格 · 结构式。A-R 双井格为无争议标准；S-V=X 形四臂、W-Y=折线三袋、Z=带点中袋——维基百科主图口径，K-Z 分组排布存在公认变体） ----------
const PIGPEN = {
  A: "#1", B: "#2", C: "#3", D: "#4", E: "#5", F: "#6", G: "#7", H: "#8", I: "#9",
  J: "#·1", K: "#·2", L: "#·3", M: "#·4", N: "#·5", O: "#·6", P: "#·7", Q: "#·8", R: "#·9",
  S: "X1", T: "X2", U: "X3", V: "X4",   // X 形：左上/右上/左下/右下
  W: "V1", X: "V2", Y: "V3",            // 折线（>）三袋：上/中/下
  Z: "V·2",                             // 带点折线中袋
};
const PIGPEN_REV = new Map(Object.entries(PIGPEN).map(([k, v]) => [v, k]));

export const pigpenOps = {
  id: "dcode-extras-2026-10/sym-pigpen", cat: CAT,
  name: "猪圈密码（共济会栅格 · 结构式）",
  desc: "拉丁字母 ↔ 猪圈密码结构式：A-I=井格 #1-#9（行主序），J-R=带点井格 #·1-#·9，S-V=X 形 X1-X4（左上/右上/左下/右下），W-Y=折线 V1-V3（上/中/下），Z=带点中袋 V·2。S-Z 分组排布存在公认变体（本表按维基百科主图口径）；图形渲染需图像，此处为文本结构式",
  params: [],
  encode(text) {
    const s = String(text).toUpperCase();
    const out = [];
    for (const ch of s) {
      if (/[A-Z]/.test(ch)) out.push(PIGPEN[ch]);
      else if (ch === " ") out.push(" ");
      else throw new Error(`字符「${ch}」不在 A-Z（猪圈栅格只覆盖字母）`);
    }
    return out.join(" ").replace(/ +/g, " ").trim();
  },
  decode(text) {
    const toks = String(text).trim().split(/\s+/).filter(Boolean);
    const out = [];
    for (const t of toks) {
      const k = PIGPEN_REV.get(t);
      if (k === undefined) throw new Error(`记号「${t}」非法（应为 #1-#9、#·1-#·9、X1-X4、V1-V3、V·2）`);
      out.push(k);
    }
    return out.join("");
  },
};

export const OPS = [klingonOps, hexagramOps, kaktovikUnicodeOps, brailleGS8Ops, altCodesOps, pigpenOps];
