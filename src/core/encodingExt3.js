/*
 * encodingExt3.js — T508 批二·编码映射组（B1/B2/B7/B8/B9/B10/D1；A8 圣殿骑士 BLOCKED 未实现）。
 *
 * 7 个 op：crockford32 / alienAlphabet / futhark / countingRods / chuckUnary / wingdings / cardanGrille。
 * 口径来源（逐项，全部 2026-09 抓取/实测核实，未凭记忆编造）：
 *   crockford32   — Douglas Crockford 原文 https://www.crockford.com/base32.html ：
 *                   字母表 0123456789ABCDEFGHJKMNPQRSTVWXYZ（排 I/L/O/U：I L 混 1、O 混 0、U 防不雅）；
 *                   解码容错 o→0、i/l→1、大小写不敏感、连字符 - 忽略；
 *                   可选校验位 = 数值 mod 37（37 是大于 32 的最小素数），扩展符号集 * ~ $ = U（值 32-36）；
 *                   位流与既有 base32 op 的 crockford 档完全同口径（5bit 分组、尾零扩展、无 pad），
 *                   本 op 增量 = 校验位 + 连字符规约（原页面无编码例，测试向量手推 + 与 base32 op 对拍）。
 *   alienAlphabet — dCode https://www.dcode.fr/alien-language ：26 拉丁字母 → 26 个 Unicode 符号
 *                   （多为 U+2300 技术符号区 + APL 符号）；官方例 DCODE → ⎅☊⍜⎅⟒、⏃⌰⟟⟒⋏ → ALIEN。
 *                   注意：Futurama 剧中 AL1/AL2 原字形无 Unicode 编码（dCode/Infososphere 均只出图片，
 *                   见 dCode alphabet-alien-futurama 页 char(65).png 形式），Unicode 档即 dCode 唯一
 *                   成文的外星字母 Unicode 表。futurama2 档 = Futurama AL2 自修改算法的字母级实现
 *                   （dCode alphabet-alien-2-futurama 核实）：C₁=P₁，Cᵢ=(Pᵢ+Cᵢ₋₁) mod 26；
 *                   官方例 FUTURAMA→FZSMDDPP、密文 ALTXK→ALIEN（连续两相同符号 ⇒ 后者是 A）。
 *   futhark       — dCode vieux-futhark（24 符表 + A-Z 实用映射 FAQ：THᚦ NGᛝ 双字母组，
 *                   C/K/Q→ᚲ、V/W→ᚹ、J/Y→ᛃ 同符，X 无专属卢恩按 ᚲᛊ ks 连写）
 *                   + Wikipedia Runic (Unicode block)（码位逐符核对）+ Wikipedia Younger Futhark
 *                   （16 符 fuþąrkhniastbmlʀ，长枝形为编码形，短枝为变体）。解码容错：
 *                   elder ᛋ(U+16CB)/ᛝ(U+16DD) 变体、younger 短枝 ᚭᚽᚿᛆᛌᛐᛓᛙᛧ。
 *                   24 符标准序（码位）：ᚠ16A0 ᚢ16A2 ᚦ16A6 ᚨ16A8 ᚱ16B1 ᚲ16B2 ᚷ16B7 ᚹ16B9 ᚺ16BA
 *                   ᚾ16BE ᛁ16C1 ᛃ16C3 ᛇ16C7 ᛈ16C8 ᛉ16C9 ᛊ16CA ᛏ16CF ᛒ16D2 ᛖ16D6 ᛗ16D7 ᛚ16DA
 *                   ᛜ16DC ᛞ16DE ᛟ16DF。
 *   countingRods  — Wikipedia Counting rods：横式 1-9 = U+1D360-1D368、纵式 1-9 = U+1D369-1D371、
 *                   0 = 〇(U+3007)（《孙子算经》「一纵十横」：从右数奇位（个百十万…）用纵式、
 *                   偶位（十千万…）用横式）；官方例 231→𝍪𝍢𝍩、5089→𝍤〇𝍧𝍱、71824→𝍯𝍠𝍰𝍡𝍤。
 *                   注：dCode code-chinois 页是另一物（scout 木棍密码），与算筹无关。
 *   chuckUnary    — dCode code-chuck-norris：字符→7bit ASCII（可选 8bit）连成位流；
 *                   连续 N 个 1 →「0」+ N 个 0；连续 N 个 0 →「00」+ N 个 0；组间空格，
 *                   字符间无分隔（整条位流做游程）。页面例：位流 00011110 → 00 000 0 0000 00 0。
 *   wingdings     — 三重权威：① 本机 C:\Windows\Fonts\wingding.ttf cmap 实测（fontTools 解析）：
 *                   U+F020-F0FF ↔ 字形槽 0x20-0xFF —— Microsoft 符号字体 PUA 约定，pua 档依据；
 *                   ② Alan Wood 字体演示页 wingdings/wingdings-2/wingdings-3（0x20-0x7E 全表，
 *                   unicode 档依据）；③ Wikipedia Wingdings（Unicode 7.0 对应）作解码容错（个别槽
 *                   两源不同：m/s/w/6/S/7 槽双收）。zapf 档 = Adobe ZapfDingbats 编码
 *                   （unicode.org zdingbat.txt，0x20-0x7E → U+27xx 等）。
 *                   只映射可见 ASCII 0x20-0x7E（0x7F 无 Unicode 对应，0x80-0xFF 为控制/重音区不硬造）。
 *   cardanGrille  — dCode grille-cardan：固定格栅掩模（不旋转，与本项目「转动格栅」op 区分）：
 *                   掩模串 X=实格 _=孔（任意长度，不要求 N×N）。fill 档（dCode 主形态）= 明文逐字
 *                   填入孔位、实位以种子随机大写字母（或自定 filler 循环）补满；hide 档（Richelieu
 *                   形态）= 明文入孔位、掩护文本字符依序补实位（多余掩护文丢弃）。解密 = 掩模对齐
 *                   取孔位字符。页面例：掩模 XXX_XX_XX_X_X_XX + OESDVBCNEOHDEEML → DCODE。
 *
 * 对拍与测试：资料/工程留存/T508/批2_编码映射/test.mjs（dCode/Wikipedia 官方例 + 手推向量 +
 * 与 base32 op 交叉对拍 + 往返 + 异常路径）。本文件为自研实现，无外部依赖。
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(String(s ?? ""));
const td = (bytes) => new TextDecoder().decode(new Uint8Array(bytes));
const cp = (n) => String.fromCodePoint(n);

/* ================================================================
 * B1 Crockford Base32
 * ================================================================ */
const CROCKFORD_ALPHA = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // 排 I/L/O/U（原文核实）
const CROCKFORD_CHECK = CROCKFORD_ALPHA + "*~$=U"; // 值 0-36：32=* 33=~ 34=$ 35== 36=U

function crockfordTol(c) { // 解码容错（原文：i/l→1、o→0，大小写不敏感）
  const u = c.toUpperCase();
  if (u === "O") return "0";
  if (u === "I" || u === "L") return "1";
  return u;
}

function crockfordEncode(text, p) {
  const bytes = te(text);
  let bits = 0, val = 0, out = "";
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { bits -= 5; out += CROCKFORD_ALPHA[(val >> bits) & 31]; }
  }
  if (bits > 0) out += CROCKFORD_ALPHA[(val << (5 - bits)) & 31]; // 尾零扩展
  if (p && p.check) { // 校验位 = 全字节按大端整数 mod 37
    let n = 0n;
    for (const b of bytes) n = (n << 8n) | BigInt(b);
    out += CROCKFORD_CHECK[Number(n % 37n)];
  }
  const g = Number((p && p.dashGroup) || 0);
  if (g > 0) out = out.replace(new RegExp(`(.{${g}})(?!$)`, "g"), "$1-"); // 连字符仅作可读分组
  return out;
}

function crockfordDecode(text, p) {
  const withCheck = !!(p && p.check);
  let s = String(text ?? "").replace(/[\s-]+/g, ""); // 连字符与空白忽略（原文）
  if (!s) throw new Error("Crockford Base32：输入为空。");
  let checkVal = null;
  if (withCheck) {
    const last = crockfordTol(s[s.length - 1]);
    const idx = CROCKFORD_CHECK.indexOf(last);
    if (idx === -1)
      throw new Error(`Crockford Base32：末位 "${s[s.length - 1]}" 不是合法校验符（0-9 A-Z * ~ $ = U，U 即校验值 36）。`);
    checkVal = idx;
    s = s.slice(0, -1);
  }
  for (const ch of s) {
    if (CROCKFORD_ALPHA.indexOf(crockfordTol(ch)) === -1)
      throw new Error(`Crockford Base32：字符 "${ch}" 不在字母表内（已容错 o→0、i/l→1；U 是校验符不是数据符，去掉勾选校验位再试）。`);
  }
  const clean = [...s].map(crockfordTol).join("");
  if (!clean) throw new Error("Crockford Base32：去掉校验符后没有数据符号。");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | CROCKFORD_ALPHA.indexOf(ch);
    bits += 5;
    if (bits >= 8) { bits -= 8; out.push((value >> bits) & 0xff); }
  }
  if (withCheck) {
    let n = 0n;
    for (const b of out) n = (n << 8n) | BigInt(b);
    const want = Number(n % 37n);
    if (want !== checkVal)
      throw new Error(`Crockford Base32：校验不符——应为 ${CROCKFORD_CHECK[want]}，实为 ${CROCKFORD_CHECK[checkVal]}（可检出错符号/换位错误）。`);
  }
  return td(out);
}

register({
  id: "crockford32", cat: "base", name: "Crockford Base32",
  desc: "人类可读 Base32（排 I/L/O/U，o→0 i/l→1 容错，- 忽略；可选 mod 37 校验位 * ~ $ = U）；位流与 Base32 op 的 crockford 档同口径",
  params: [
    { key: "check", label: "校验位（数值 mod 37，扩展符 * ~ $ = U）", type: "bool", default: false },
    { key: "dashGroup", label: "连字符分组（每 N 符插 -，0=不分组）", type: "number", default: 0 },
  ],
  encode: crockfordEncode,
  decode: crockfordDecode,
});

/* ================================================================
 * B2 外星字母（dCode Alien Language Unicode 表 + Futurama AL2 档）
 * ================================================================ */
// dCode alien-language 页核实（26 字母 → Unicode 码位）
const ALIEN_CP = {
  A: 0x23c3, B: 0x23da, C: 0x260a, D: 0x2385, E: 0x27d2, F: 0x238e, G: 0x260c, H: 0x2291,
  I: 0x27df, J: 0x27ca, K: 0x260d, L: 0x2330, M: 0x22d4, N: 0x22cf, O: 0x235c, P: 0x233f,
  Q: 0x237e, R: 0x2340, S: 0x2307, T: 0x23c1, U: 0x238d, V: 0x2390, W: 0x2359, X: 0x2316,
  Y: 0x22ac, Z: 0x22c9,
};
const ALIEN_MAP = {};
const ALIEN_REV = new Map();
for (const [L, c] of Object.entries(ALIEN_CP)) { const ch = cp(c); ALIEN_MAP[L] = ch; ALIEN_REV.set(ch, L); }

// Futurama AL2 自修改（dCode alphabet-alien-2-futurama）：C1=P1；Ci=(Pi+Ci-1) mod 26；解密 Pi=(Ci-Ci-1) mod 26
function futurama2Run(text, inv) {
  let prev = -1, out = "";
  for (const ch of String(text ?? "")) {
    const up = ch.toUpperCase();
    const v = up.charCodeAt(0) - 65;
    if (v < 0 || v > 25) { out += ch; continue; } // 非字母原样，密钥（前一密文值）不重置
    const c = prev < 0 ? v : (inv ? (v - prev + 26) % 26 : (v + prev) % 26);
    out += String.fromCharCode(65 + c);
    prev = inv ? v : c; // 密钥 = 前一个密文值（加解密同律；解密时 c 是明文、v 才是密文）
  }
  return out;
}

function alienEncode(text, p) {
  if ((p && p.mode) === "futurama2") return futurama2Run(text, false);
  let out = "";
  for (const ch of String(text ?? "")) out += ALIEN_MAP[ch.toUpperCase()] || ch;
  return out;
}
function alienDecode(text, p) {
  if ((p && p.mode) === "futurama2") return futurama2Run(text, true);
  let out = "";
  for (const ch of String(text ?? "")) out += ALIEN_REV.get(ch) || ch;
  return out;
}

register({
  id: "alienAlphabet", cat: "fancy", name: "外星字母",
  desc: "unicode 档：26 拉丁字母 ↔ 26 个 Unicode 符号（⏃⏚☊⎅…，dCode Alien Language 表）；futurama2 档：Futurama AL2 自修改 Cᵢ=(Pᵢ+Cᵢ₋₁) mod 26（字母级，剧中字形无 Unicode）",
  params: [
    { key: "mode", label: "字母表", type: "select", default: "unicode",
      options: [
        { value: "unicode", label: "Unicode 外星符号（⏃⌰⟟⟒⋏=ALIEN，dCode 表）" },
        { value: "futurama2", label: "Futurama AL2 自修改（FUTURAMA→FZSMDDPP）" },
      ] },
  ],
  encode: alienEncode,
  decode: alienDecode,
});

/* ================================================================
 * B7 Futhark 卢恩符文（elder 24 符 / younger 16 符）
 * ================================================================ */
// elder 24 符（声音序）+ 变体：ᛋ16CB（SIGEL 长枝 S）、ᛝ16DD（ING）
const R = (n) => cp(n);
const ELDER = {
  F: R(0x16a0), U: R(0x16a2), TH: R(0x16a6), A: R(0x16a8), RR: R(0x16b1), K: R(0x16b2),
  G: R(0x16b7), W: R(0x16b9), H: R(0x16ba), N: R(0x16be), I: R(0x16c1), J: R(0x16c3),
  IX: R(0x16c7), P: R(0x16c8), Z: R(0x16c9), S: R(0x16ca), T: R(0x16cf), B: R(0x16d2),
  E: R(0x16d6), M: R(0x16d7), L: R(0x16da), NG: R(0x16dc), D: R(0x16de), O: R(0x16df),
};
// A-Z 实用映射（dCode vieux-futhark FAQ）：C/K/Q→ᚲ、V/W→ᚹ、J/Y→ᛃ、X→ᚲᛊ(ks)；TH/NG 双字母组
const ELDER_ENC = {
  A: ELDER.A, B: ELDER.B, C: ELDER.K, D: ELDER.D, E: ELDER.E, F: ELDER.F, G: ELDER.G,
  H: ELDER.H, I: ELDER.I, J: ELDER.J, K: ELDER.K, L: ELDER.L, M: ELDER.M, N: ELDER.N,
  O: ELDER.O, P: ELDER.P, Q: ELDER.K, R: ELDER.RR, S: ELDER.S, T: ELDER.T, U: ELDER.U,
  V: ELDER.W, W: ELDER.W, X: ELDER.K + ELDER.S, Y: ELDER.J, Z: ELDER.Z,
  TH: ELDER.TH, NG: ELDER.NG,
};
// elder 反查（含变体 ᛋ/ᛝ；ᚦ→TH、ᛜ→NG、ᛇ→Ï，多字母合流取中庸形：ᚲ→K、ᚹ→W、ᛃ→J）
const ELDER_DEC = new Map();
for (const [k, v] of Object.entries(ELDER)) ELDER_DEC.set(v, k === "RR" ? "R" : k === "IX" ? "Ï" : k);
ELDER_DEC.set(R(0x16cb), "S"); // ᛋ SIGEL 长枝变体
ELDER_DEC.set(R(0x16dd), "NG"); // ᛝ ING 变体

// younger 16 符长枝形（Wikipedia Younger Futhark + Runic block 码位）：fuþąrkhniastbmlʀ
const YF = {
  F: R(0x16a0), U: R(0x16a2), TH: R(0x16a6), O: R(0x16ac), R: R(0x16b1), K: R(0x16b4),
  H: R(0x16bc), N: R(0x16be), I: R(0x16c1), A: R(0x16c5), S: R(0x16cb), T: R(0x16cf),
  B: R(0x16d2), M: R(0x16d8), L: R(0x16da), YR: R(0x16e6),
};
// A-Z → younger（音位合并：E/I→ᛁ、O→ᚬ、A→ᛅ、D/T→ᛏ、G/K→ᚴ、P/B→ᛒ、V/W/Y→ᚢ、J→ᛁ、Z→ᛋ；X→ᚴᛋ）
const YF_ENC = {
  A: YF.A, B: YF.B, C: YF.K, D: YF.T, E: YF.I, F: YF.F, G: YF.K, H: YF.H, I: YF.I,
  J: YF.I, K: YF.K, L: YF.L, M: YF.M, N: YF.N, O: YF.O, P: YF.B, Q: YF.K, R: YF.R,
  S: YF.S, T: YF.T, U: YF.U, V: YF.U, W: YF.U, X: YF.K + YF.S, Y: YF.U, Z: YF.S,
  TH: YF.TH,
};
// younger 反查（短枝变体同值：ᚭᚽᚿᛆᛌᛐᛓᛙᛧ；ᛦ ʀ→R）
const YF_DEC = new Map();
for (const [k, v] of Object.entries(YF)) YF_DEC.set(v, k === "YR" ? "R" : k);
YF_DEC.set(R(0x16ad), "O");  // ᚭ 短枝 ǫss
YF_DEC.set(R(0x16bd), "H");  // ᚽ 短枝 hagall
YF_DEC.set(R(0x16bf), "N");  // ᚿ 短枝 naud
YF_DEC.set(R(0x16c6), "A");  // ᛆ 短枝 ár
YF_DEC.set(R(0x16cc), "S");  // ᛌ 短枝 sol
YF_DEC.set(R(0x16d0), "T");  // ᛐ 短枝 týr
YF_DEC.set(R(0x16d3), "B");  // ᛓ 短枝 bjarkan
YF_DEC.set(R(0x16d9), "M");  // ᛙ 短枝 maðr
YF_DEC.set(R(0x16e7), "R");  // ᛧ 短枝 ýr

function futharkEncode(text, p) {
  const variant = (p && p.variant) || "elder";
  const digraph = (p && p.digraph) !== false; // 默认开启 TH 双字母组（younger 只有 TH）
  const enc = variant === "younger" ? YF_ENC : ELDER_ENC;
  const digraphs = variant === "younger" ? [["TH", "TH"]] : [["TH", "TH"], ["NG", "NG"]];
  let out = "";
  const t = String(text ?? "").toUpperCase();
  for (let i = 0; i < t.length; i++) {
    const two = t.slice(i, i + 2);
    const dg = digraph ? digraphs.find(([d]) => d === two) : null;
    if (dg) { out += enc[dg[1]]; i += 1; continue; }
    const one = t[i];
    if (enc[one]) out += enc[one];
    else out += one; // 非字母原样
  }
  return out;
}

function futharkDecode(text, p) {
  const dec = ((p && p.variant) || "elder") === "younger" ? YF_DEC : ELDER_DEC;
  let out = "";
  for (const ch of String(text ?? "")) out += dec.get(ch) || ch;
  return out;
}

register({
  id: "futhark", cat: "fancy", name: "卢恩符文 Futhark",
  desc: "elder 24 符 / younger 16 符（fuþąrkhniastbmlʀ）；TH 双字母组（elder 另有 NG）；解码容错 ᛋᛝ 与短枝变体；多字母合流（C/K/Q→ᚲ 等）致往返有损",
  params: [
    { key: "variant", label: "体系", type: "select", default: "elder",
      options: [
        { value: "elder", label: "老弗萨克 Elder（24 符，ᚠᚢᚦᚨᚱᚲ…）" },
        { value: "younger", label: "新弗萨克 Younger（16 符，长枝形）" },
      ] },
    { key: "digraph", label: "双字母组（TH→ᚦ，elder 另 NG→ᛜ）", type: "bool", default: true },
  ],
  encode: futharkEncode,
  decode: futharkDecode,
});

/* ================================================================
 * B8 算筹数字（Wikipedia Counting rods）
 * ================================================================ */
const ROD_H = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => cp(0x1d35f + d)); // 横式 𝍠-𝍨 = U+1D360-1D368
const ROD_V = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => cp(0x1d368 + d)); // 纵式 𝍩-𝍱 = U+1D369-1D371
const ROD_ZERO = cp(0x3007); // 〇
const ROD_REV = new Map();
ROD_H.forEach((ch, i) => ROD_REV.set(ch, String(i + 1)));
ROD_V.forEach((ch, i) => ROD_REV.set(ch, String(i + 1)));
ROD_REV.set(ROD_ZERO, "0");

function rodsEncode(text, p) {
  void p;
  const tokens = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new Error("算筹数字：输入为空（十进制数字串，空格分隔多个数）。");
  const outs = [];
  for (const tok of tokens) {
    if (!/^\d+$/.test(tok))
      throw new Error(`算筹数字：「${tok}」不是十进制数字串（负号/小数点不支持，只编非负整数）。`);
    const chars = [...tok];
    let s = "";
    chars.forEach((dch, i) => {
      const d = Number(dch);
      const posFromRight = chars.length - 1 - i; // 0=个位
      if (d === 0) s += ROD_ZERO;
      else s += posFromRight % 2 === 0 ? ROD_V[d - 1] : ROD_H[d - 1]; // 一纵十横
    });
    outs.push(s);
  }
  return outs.join(" ");
}

function rodsDecode(text, p) {
  void p;
  const tokens = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new Error("算筹数字：密文为空。");
  const outs = [];
  for (const tok of tokens) {
    let s = "";
    for (const ch of tok) {
      const d = ROD_REV.get(ch);
      if (d === undefined)
        throw new Error(`算筹数字：字符 "${ch}" 不是算筹数字（横式 𝍠-𝍨 / 纵式 𝍩-𝍱 / 〇）。`);
      s += d;
    }
    outs.push(s);
  }
  return outs.join(" ");
}

register({
  id: "countingRods", cat: "cn", name: "算筹数字",
  desc: "中国算筹记数：个百十万位用纵式 𝍩-𝍱、十千万位用横式 𝍠-𝍨（一纵十横），0 用〇；空格分隔多个数，双向",
  params: [],
  encode: rodsEncode,
  decode: rodsDecode,
});

/* ================================================================
 * B9 Chuck Norris unary（dCode code-chuck-norris）
 * ================================================================ */
function chuckEncode(text, p) {
  const width = Number((p && p.width) || 7);
  if (width !== 7 && width !== 8) throw new Error("Chuck Norris unary：宽度只支持 7 或 8 位。");
  let bits = "";
  for (const ch of String(text ?? "")) {
    const c = ch.codePointAt(0);
    if (c > 0xff) throw new Error(`Chuck Norris unary：字符 "${ch}" 超出 ${width} 位 ASCII 范围。`);
    bits += c.toString(2).padStart(width, "0");
  }
  const groups = [];
  let i = 0;
  while (i < bits.length) { // 整条位流做游程（字符间无分隔——dCode 页面口径）
    const b = bits[i];
    let j = i;
    while (j < bits.length && bits[j] === b) j++;
    // 每游程 = 两个空格分隔的组：前缀组（0=连1，00=连0）+ 数量组（N 个 0）
    groups.push(b === "1" ? "0" : "00", "0".repeat(j - i));
    i = j;
  }
  return groups.join(" ");
}

function chuckDecode(text, p) {
  const width = Number((p && p.width) || 7);
  if (width !== 7 && width !== 8) throw new Error("Chuck Norris unary：宽度只支持 7 或 8 位。");
  const parts = String(text ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) throw new Error("Chuck Norris unary：密文为空（只由 0 与空白组成）。");
  for (const g of parts)
    if (/[^0]/.test(g)) throw new Error(`Chuck Norris unary：组 "${g}" 含非 0 字符（本码只用 0 和空格）。`);
  if (parts.length % 2 !== 0)
    throw new Error(`Chuck Norris unary：共 ${parts.length} 组，不是偶数——每组对=（前缀 0/00, 数量组），缺半组。`);
  let bits = "";
  for (let i = 0; i < parts.length; i += 2) {
    const prefix = parts[i], count = parts[i + 1];
    if (prefix !== "0" && prefix !== "00")
      throw new Error(`Chuck Norris unary：前缀组 "${prefix}" 只能是 0（连 1）或 00（连 0）。`);
    bits += (prefix === "0" ? "1" : "0").repeat(count.length);
  }
  if (bits.length % width !== 0)
    throw new Error(`Chuck Norris unary：位流 ${bits.length} 位不是 ${width} 的倍数（组缺失或换 ${width === 7 ? 8 : 7} 位宽度再试）。`);
  let out = "";
  for (let i = 0; i < bits.length; i += width)
    out += String.fromCharCode(parseInt(bits.slice(i, i + width), 2));
  return out;
}

register({
  id: "chuckUnary", cat: "fancy", name: "Chuck Norris 一元码",
  desc: "字符→7/8 位 ASCII 连成位流做游程：连 N 个 1→「0」+N 个 0，连 N 个 0→「00」+N 个 0，组间空格（Codingame 同款）",
  params: [
    { key: "width", label: "ASCII 宽度", type: "select", default: 7,
      options: [
        { value: 7, label: "7 位（默认，dCode/Codingame）" },
        { value: 8, label: "8 位" },
      ] },
  ],
  encode: chuckEncode,
  decode: chuckDecode,
});

/* ================================================================
 * B10 Wingdings 符号字体（wingdings1/2/3 + zapf；pua / unicode 两档）
 * ================================================================ */
// unicode 档实码位表（0x20-0x7E 顺序，来源：Alan Wood 演示页全表 + 本机字体/wikipedia 交叉）。
//zapf = Adobe ZapfDingbats 编码（unicode.org zdingbat.txt）。
const WINGDINGS1 = [
  0x20, 0x1f589, 0x2702, 0x2701, 0x1f453, 0x1f56d, 0x1f56e, 0x1f56f, 0x1f57f, 0x2706, 0x1f582, 0x1f583, 0x1f4ea, 0x1f4eb, 0x1f4ec, 0x1f4ed,
  0x1f4c1, 0x1f4c2, 0x1f4c4, 0x1f5cf, 0x1f5d0, 0x1f5c4, 0x231b, 0x1f5ae, 0x1f5b0, 0x1f5b2, 0x1f5b3, 0x1f5b4, 0x1f5ab, 0x1f5ac, 0x2707, 0x270d,
  0x1f58e, 0x270c, 0x1f44c, 0x1f44d, 0x1f44e, 0x261c, 0x261e, 0x261d, 0x261f, 0x1f590, 0x263a, 0x1f610, 0x2639, 0x1f4a3, 0x2620, 0x1f3f3,
  0x1f3f1, 0x2708, 0x263c, 0x1f4a7, 0x2744, 0x1f546, 0x271e, 0x1f548, 0x2720, 0x2721, 0x262a,
  0x262f, 0x0950, 0x2638, 0x2648, 0x2649,
  0x264a, 0x264b, 0x264c, 0x264d, 0x264e, 0x264f, 0x2650, 0x2651, 0x2652, 0x2653, 0x1f670, 0x1f675, 0x25cf, 0x1f53e, 0x25a0, 0x25a1,
  0x1f790, 0x2751, 0x2752, 0x2b27, 0x29eb, 0x25c6, 0x2756, 0x2b25, 0x2327, 0x2bb9, 0x2318, 0x1f3f5, 0x1f3f6, 0x1f676, 0x1f677,
];
const WINGDINGS2 = [
  0x20, 0x1f58a, 0x1f58b, 0x1f58c, 0x1f58d, 0x2704, 0x2700, 0x1f57e, 0x1f57d, 0x1f5c5, 0x1f5c6, 0x1f5c7, 0x1f5c8, 0x1f5c9, 0x1f5ca, 0x1f5cb,
  0x1f5cc, 0x1f5cd, 0x1f4cb, 0x1f5d1, 0x1f5d4, 0x1f5b5, 0x1f5b6, 0x1f5b7, 0x1f5b8, 0x1f5ad, 0x1f5af, 0x1f5b1, 0x1f592,
  0x1f593, 0x1f598, 0x1f599, 0x1f59a, 0x1f59b, 0x1f448, 0x1f449, 0x1f59c, 0x1f59d, 0x1f59e, 0x1f59f, 0x1f5a0, 0x1f5a1, 0x1f446, 0x1f447, 0x1f5a2, 0x1f5a3, 0x1f591, 0x1f5f4,
  0x2713, 0x1f5f5, 0x2611, 0x2612, 0x2612, 0x2bbe, 0x2bbf, 0x29b8, 0x29b8, 0x1f671, 0x1f674, 0x1f672, 0x1f673, 0x203d, 0x1f679, 0x1f67a,
  0x1f67b, 0x1f666, 0x1f664, 0x1f665, 0x1f667, 0x1f65a, 0x1f658, 0x1f659, 0x1f65b, 0x24ea, 0x2460, 0x2461, 0x2462, 0x2463, 0x2464, 0x2465,
  0x2466, 0x2467, 0x2468, 0x2469, 0x24ff, 0x2776, 0x2777, 0x2778, 0x2779, 0x277a, 0x277b, 0x277c, 0x277d, 0x277e, 0x277f,
];
const WINGDINGS3 = [
  0x20, 0x2b60, 0x2b62, 0x2b61, 0x2b63, 0x2b66, 0x2b67, 0x2b69, 0x2b68, 0x2b70, 0x2b72, 0x2b71, 0x2b73, 0x2b76, 0x2b78, 0x2b7b,
  0x2b7d, 0x2b64, 0x2b65, 0x2b6a, 0x2b6c, 0x2b6b, 0x2b6d, 0x2b4d, 0x2ba0, 0x2ba1, 0x2ba2, 0x2ba3, 0x2ba4, 0x2ba5, 0x2ba6, 0x2ba7,
  0x2b90, 0x2b91, 0x2b92, 0x2b93, 0x2b80, 0x2b83, 0x2b7e, 0x2b7f, 0x2b84, 0x2b86, 0x2b85, 0x2b87, 0x2b8f, 0x2b8d, 0x2b8e, 0x2b8c,
  0x2b6e, 0x2b6f, 0x238b, 0x2324, 0x2303, 0x2325, 0x23b5, 0x237d, 0x21ea, 0x2bb8, 0x1f8a0,
  0x1f8a1, 0x1f8a2, 0x1f8a3, 0x1f8a4, 0x1f8a5, 0x1f8a6, 0x1f8a7, 0x1f8a8, 0x1f8a9, 0x1f8aa, 0x1f8ab,
  0x2190, 0x2192, 0x2191, 0x2193, 0x2196, 0x2197, 0x2199, 0x2198, 0x1f858, 0x1f859, 0x25b2, 0x25bc, 0x25b3, 0x25bd, 0x25c4, 0x25ba, 0x25c1, 0x25b7, 0x25e3, 0x25e2, 0x25e4, 0x25e5, 0x1f780, 0x1f782, 0x1f781,
];
const ZAPF_DINGBATS = [
  0x20, 0x2701, 0x2702, 0x2703, 0x2704, 0x260e, 0x2706, 0x2707, 0x2708, 0x2709, 0x261b, 0x261e, 0x270c, 0x270d, 0x270e, 0x270f,
  0x2710, 0x2711, 0x2712, 0x2713, 0x2714, 0x2715, 0x2716, 0x2717, 0x2718, 0x2719, 0x271a, 0x271b, 0x271c, 0x271d, 0x271e, 0x271f,
  0x2720, 0x2721, 0x2722, 0x2723, 0x2724, 0x2725, 0x2726, 0x2727, 0x2605, 0x2729, 0x272a, 0x272b, 0x272c, 0x272d, 0x272e, 0x272f,
  0x2730, 0x2731, 0x2732, 0x2733, 0x2734, 0x2735, 0x2736, 0x2737, 0x2738, 0x2739, 0x273a, 0x273b, 0x273c, 0x273d, 0x273e, 0x273f,
  0x2740, 0x2741, 0x2742, 0x2743, 0x2744, 0x2745, 0x2746, 0x2747, 0x2748, 0x2749, 0x274a, 0x274b, 0x25cf, 0x274d, 0x25a0, 0x274f,
  0x2750, 0x2751, 0x2752, 0x25b2, 0x25bc, 0x25c6, 0x2756, 0x25d7, 0x2758, 0x2759, 0x275a, 0x275b, 0x275c, 0x275d, 0x275e,
];
const WING_FONTS = {
  wingdings1: WINGDINGS1,
  wingdings2: WINGDINGS2,
  wingdings3: WINGDINGS3,
  zapf: ZAPF_DINGBATS,
};
// 解码容错：两源不一致的槽（Alan Wood 正码 vs Wikipedia/Unicode7.0 另形）双收
const WING_ALTERNATES = new Map([
  [cp(0x25fc), { font: "wingdings1", slot: 0x6d }], // m 另形 ◼
  [cp(0x1f79f), { font: "wingdings1", slot: 0x73 }], // s 另形 🞟
  [cp(0x1f799), { font: "wingdings1", slot: 0x77 }], // w 另形 🞙
  [cp(0x1f322), { font: "wingdings1", slot: 0x53 }], // S 另形（雨滴形）
  [cp(0x23f3), { font: "wingdings1", slot: 0x36 }],  // 6 另形 ⏳
]);

function wingTable(p) {
  const font = (p && p.font) || "wingdings1";
  const t = WING_FONTS[font];
  if (!t) throw new Error(`Wingdings：未知字体档 "${font}"。`);
  return { font, t };
}

function wingEncode(text, p) {
  const { font, t } = wingTable(p);
  const mode = (p && p.mode) || "unicode";
  let out = "";
  for (const ch of String(text ?? "")) {
    const c = ch.codePointAt(0);
    if (c < 0x20 || c > 0x7e)
      throw new Error(`Wingdings：字符 "${ch}" 超出可见 ASCII 范围（0x20-0x7E，本工具只映射可核实的 95 槽）。`);
    if (mode === "pua") out += cp(0xf000 + c); // 本机 wingding.ttf cmap 实测约定
    else out += cp(t[c - 0x20]);
  }
  return out;
}

function wingDecode(text, p) {
  const { font, t } = wingTable(p);
  const mode = (p && p.mode) || "unicode";
  const rev = new Map();
  if (mode !== "pua") {
    t.forEach((code, i) => { if (!rev.has(code)) rev.set(code, i); }); // 重复槽取首个（W2 的 S/T、W/X）
    for (const [ch, alt] of WING_ALTERNATES)
      if (alt.font === font && !rev.has(ch.codePointAt(0))) rev.set(ch.codePointAt(0), alt.slot - 0x20);
  }
  let out = "";
  for (const ch of String(text ?? "")) {
    const c = ch.codePointAt(0);
    if (mode === "pua") {
      if (c < 0xf020 || c > 0xf0ff)
        throw new Error(`Wingdings：字符 "${ch}" 不在 PUA 区 U+F020-F0FF（pua 档只认这 224 个码位）。`);
      out += String.fromCharCode(c - 0xf000);
    } else {
      const slot = rev.get(c);
      if (slot === undefined)
        throw new Error(`Wingdings：字符 "${ch}" 不在 ${font} 档对应表内（换字体档或 pua 档再试）。`);
      out += String.fromCharCode(slot + 0x20);
    }
  }
  return out;
}

register({
  id: "wingdings", cat: "fancy", name: "Wingdings 符号字体",
  desc: "明文 ↔ Wingdings 符号：unicode 档用真实码位（☺✈☠★…，Alan Wood/Adobe 表）；pua 档用 U+F020-F0FF（本机 wingding.ttf cmap 实测，Word 同款）；四字体 wingdings1/2/3/zapf",
  params: [
    { key: "font", label: "字体", type: "select", default: "wingdings1",
      options: [
        { value: "wingdings1", label: "Wingdings（J=☺ Q=✈ N=☠）" },
        { value: "wingdings2", label: "Wingdings 2（P=✓ R=☑ S=☒）" },
        { value: "wingdings3", label: "Wingdings 3（箭头族 f=← p=▲）" },
        { value: "zapf", label: "Zapf Dingbats（Adobe 编码，!=✁ 3=✓）" },
      ] },
    { key: "mode", label: "码位模式", type: "select", default: "unicode",
      options: [
        { value: "unicode", label: "unicode：真实码位（普通字体可见）" },
        { value: "pua", label: "pua：U+F020-F0FF（装了对应字体才可见，严格往返）" },
      ] },
  ],
  encode: wingEncode,
  decode: wingDecode,
});

/* ================================================================
 * D1 卡丹格 Cardan Grille（固定掩模，不旋转）
 * ================================================================ */
function fnv1aSeed(str) { // 与 classicExt4 同款确定性种子（本文件自带，避免跨文件耦合）
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let a = h >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function cardanMask(param) {
  const s = String(param || "").replace(/\s+/g, "");
  if (!s) throw new Error("卡丹格：掩模为空（一串 X 与 _：X=实格，_=孔；任意长度，不要求方形）。");
  const holes = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "_") holes.push(i);
    else if (ch !== "X" && ch !== "x") throw new Error(`卡丹格：掩模字符 "${ch}" 非法（仅 X=实格、_=孔）。`);
  }
  if (!holes.length) throw new Error("卡丹格：掩模一个孔（_）都没有——没有孔就藏不了字。");
  return { len: s.length, holes };
}

function cardanEncode(text, p) {
  const { len, holes } = cardanMask(p && p.mask);
  const mode = (p && p.mode) || "fill";
  const secret = [...String(text ?? "")];
  if (secret.length > holes.length)
    throw new Error(`卡丹格：明文 ${secret.length} 字超出掩模孔数 ${holes.length}（加长掩模或拆段）。`);
  const grid = new Array(len).fill(null);
  let fillerPool = null, rng = null;
  const fillerText = String((p && p.filler) || "");
  if (mode === "hide") {
    const cover = [...String((p && p.coverText) || "").replace(/\r\n/g, "\n")];
    const solidCount = len - holes.length;
    const flat = cover.filter((c) => c !== "\n");
    if (flat.length < solidCount)
      throw new Error(`卡丹格：掩护文本太短——实格需 ${solidCount} 字，掩护文只有 ${flat.length} 字（隐藏档掩模多长掩护文就至少多长减孔数）。`);
    let ci = 0;
    for (let i = 0; i < len; i++) if (!holes.includes(i)) grid[i] = flat[ci++];
  } else {
    if (fillerText) fillerPool = [...fillerText];
    else rng = fnv1aSeed(String((p && p.seed) || 1));
  }
  // 明文入孔位（超出明文长度的孔以补位字符填）
  const padChar = String((p && p.padChar) || "X");
  holes.forEach((h, i) => { grid[h] = i < secret.length ? secret[i] : padChar; });
  // fill 档：实位补随机/自定 filler
  if (mode !== "hide") {
    let fi = 0;
    for (let i = 0; i < len; i++)
      if (!holes.includes(i))
        grid[i] = fillerPool ? fillerPool[fi++ % fillerPool.length] : "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Math.floor(rng() * 26)];
  }
  return grid.join("");
}

function cardanDecode(text, p) {
  const { len, holes } = cardanMask(p && p.mask);
  const t = String(text ?? "").replace(/[\r\n]+/g, "");
  if (t.length !== len)
    throw new Error(`卡丹格：密文 ${t.length} 字，掩模长 ${len}——两者必须等长对齐（掩模逐格盖上去取孔）。`);
  return holes.map((h) => t[h]).join("");
}

register({
  id: "cardanGrille", cat: "classic", name: "卡丹格 Cardan",
  desc: "固定格栅掩模取字（不旋转，区别于转动格栅）：X 实格 _ 孔；fill 档孔位藏明文+随机字母补实位（dCode 主形态），hide 档掩护文本补实位（Richelieu 形态）；解密取孔位",
  params: [
    { key: "mode", label: "形态", type: "select", default: "fill",
      options: [
        { value: "fill", label: "填充（明文入孔，实位随机字母）" },
        { value: "hide", label: "隐藏于掩护文本（Richelieu 形态）" },
      ] },
    { key: "mask", label: "掩模（X 实格 _ 孔，任意长度）", type: "textarea", default: "" },
    { key: "coverText", label: "掩护文本（hide 档用）", type: "textarea", default: "" },
    { key: "filler", label: "自定填充串（fill 档，空=种子随机 A-Z）", type: "text", default: "" },
    { key: "seed", label: "随机填充种子", type: "number", default: 1 },
    { key: "padChar", label: "孔位补位字符（明文短于孔数时）", type: "text", default: "X" },
  ],
  encode: cardanEncode,
  decode: cardanDecode,
});

/* 供测试/上层复用 */
export {
  crockfordEncode, crockfordDecode, CROCKFORD_ALPHA, CROCKFORD_CHECK,
  alienEncode, alienDecode, futurama2Run, ALIEN_MAP, ALIEN_REV,
  futharkEncode, futharkDecode, ELDER, ELDER_ENC, ELDER_DEC, YF, YF_ENC, YF_DEC,
  rodsEncode, rodsDecode, ROD_H, ROD_V, ROD_ZERO,
  chuckEncode, chuckDecode,
  wingEncode, wingDecode, WING_FONTS,
  cardanEncode, cardanDecode, cardanMask,
};
