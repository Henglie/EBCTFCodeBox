/*
 * egyptianNumerals.js — 埃及数字（hieroglyphic 数字符号子集，cat:'radix'）。
 *
 * 原理（照权威来源，未编造）：
 *  - 古埃及数字：加法十进制（非位值制，顺序无关），只用 7 个符号，每个是 10 的幂，
 *    按次数重复（dCode："le système de numération égyptien était additif et
 *    décimal… 7 signes ayant tous pour valeur une puissance de 10 qui devait
 *    être répété autant de fois que nécessaire"）。零不存在（"Le chiffre zéro
 *    n'existe pas dans ce système"）。
 *  - 7 符号表（dCode 页面原文 + 码点逐条核对）：
 *      𓏺 U+133FA = 1    （Z015 竖笔画，bâton）
 *      𓎆 U+13386 = 10   （V020 踵/轭，anse）
 *      𓍢 U+13362 = 100  （V001 卷绳，corde）
 *      𓆼 U+131BC = 1000 （M012 莲花，fleur de lotus）
 *      𓂭 U+130AD = 10000（D050 手指，doigt）
 *      𓆐 U+13190 = 100000（I008 蝌蚪，têtard）
 *      𓁨 U+13068 = 1000000（C011 Heh 神）
 *  - dCode 页面例（逐字复现）：123 = 𓍢𓎆𓎆𓏺𓏺𓏺；2001 = 𓆼𓆼𓏺；
 *    203 = 𓍢𓍢𓏺𓏺𓏺；页面顶部例 513 的展开形 = 𓏺𓏺𓏺𓎆𓍢𓍢𓍢𓍢𓍢（3+10+5×100）。
 *
 * 约定（如实登记）：
 *  - encode 规范形：幂从大到小、每幂重复其次数（10⁶ 位次数可 >9，如 12345678
 *    的 𓁨 出现 12 次；10⁵ 及以下每幂 0..9 次）；这与 dCode 例的降幂写法一致
 *    （其例 513 展开形为升幂，加法系统顺序本无关，decode 对任意顺序求和）。
 *  - decode：统计 7 符号各自出现次数求加权和；7 符号之外的字符显式报错
 *    （空白容忍）。空输入、无任何合法符号、值 0 报错（埃及数字无零）。
 *  - 省略并登记：dCode 的「compactés」紧凑组合字形档（页面例仅给 𓏨 U+133E8=3
 *    与 𓍦 U+13366=500 两个组合字形，完整 2..9 组合表页面未给、无逐条权威来源，
 *    不编造，整体省略）；埃及分数（𓂋 嘴形分数记法，非整数域）亦省略。
 *
 * 契约：非负整数（BigInt），encode/decode 严格互逆；负数、小数、空输入、
 * 非法符号、0 均显式报错。
 *
 * 权威来源（访问日期均为 2026-09-22）：
 *  - dCode「Numération Egyptienne」https://www.dcode.fr/numeration-egyptienne
 *    （7 符号表 + 码点、123/2001/203/513 例、加法十进制原理、无零、
 *    紧凑档与分数说明）。
 *  - Wikipedia「Egyptian numerals」https://en.wikipedia.org/wiki/Egyptian_numerals
 *    （符号体系与 10 的幂对应、加法制；调研交叉核对）。
 */
import { register } from "./registry.js";

// 7 符号：值（BigInt）→ Unicode 码点。dCode 表逐条。
const EGY_SIGNS = [
  { v: 1000000n, cp: 0x13068 }, // 𓁨 Heh
  { v: 100000n, cp: 0x13190 },  // 𓆐 蝌蚪
  { v: 10000n, cp: 0x130ad },   // 𓂭 手指
  { v: 1000n, cp: 0x131bc },    // 𓆼 莲花
  { v: 100n, cp: 0x13362 },     // 𓍢 卷绳
  { v: 10n, cp: 0x13386 },      // 𓎆 踵
  { v: 1n, cp: 0x133fa },       // 𓏺 竖笔画
];
const EGY_CHARS = new Map(EGY_SIGNS.map((s) => [s.cp, s.v])); // 码点 → 值
const EGY_NAME = { 1000000n: "𓁨(1000000)", 100000n: "𓆐(100000)", 10000n: "𓂭(10000)", 1000n: "𓆼(1000)", 100n: "𓍢(100)", 10n: "𓎆(10)", 1n: "𓏺(1)" };

const EGY_MAX = 9999999999n; // 编码上限：10^6 位计数 ≤9999，串长 ≤约 1.04 万字符（加法重复制的实际限度）

function egyEncode(text) {
  const src = String(text == null ? "" : text).trim();
  if (!src) throw new Error("埃及数字：输入为空（应为非负整数的十进制写法）。");
  if (!/^[0-9]+$/.test(src))
    throw new Error(`埃及数字：输入 "${src.slice(0, 24)}" 不是非负整数（埃及数字无负数与小数）。`);
  if (/^0[0-9]+$/.test(src))
    throw new Error("埃及数字：十进制输入不允许前导零。");
  let n = BigInt(src);
  if (n === 0n)
    throw new Error("埃及数字：0 无写法（加法符号系统没有零，dCode 原文「Le chiffre zéro n'existe pas」）。");
  if (n > EGY_MAX)
    throw new Error(
      `埃及数字：${src.length} 位大数超出编码上限 9999999999——加法制按次数重复符号，10^10 起的 𓁨 重复次数会使输出串长爆炸（无意义）。`
    );
  let out = "";
  for (const s of EGY_SIGNS) {
    const cnt = n / s.v; // 最高幂次数可 >9，其余位由取余后自然 ≤9
    if (cnt > 0n) out += String.fromCodePoint(s.cp).repeat(Number(cnt));
    n %= s.v;
  }
  return out;
}

function egyDecode(text) {
  const src = String(text == null ? "" : text).replace(/[\s,;]+/g, "");
  if (!src) throw new Error("埃及数字：密文为空。");
  let value = 0n, any = false;
  for (const c of src) {
    const cp = c.codePointAt(0);
    const v = EGY_CHARS.get(cp);
    if (v == null)
      throw new Error(
        `埃及数字：字符 "${c}"（U+${cp.toString(16).toUpperCase()}）不在 7 个埃及数字符号（𓏺𓎆𓍢𓆼𓂭𓆐𓁨）内。`
      );
    value += v;
    any = true;
  }
  if (!any || value === 0n)
    throw new Error("埃及数字：没有识别到任何合法符号。");
  return value.toString();
}

register({
  id: "egyptianNumerals", cat: "radix", name: "埃及数字",
  desc: "非负整数 ↔ 埃及圣书体加法数字（7 符号各为 10 的幂：𓏺=1 𓎆=10 𓍢=100 𓆼=1000 𓂭=10000 𓆐=100000 𓁨=1000000，按次数重复；无零，0 报错）；编码降幂规范形，解码任意顺序求和；紧凑组合字形档与分数省略（无逐条权威来源）",
  params: [],
  encode: egyEncode,
  decode: egyDecode,
  detect: (t) => {
    const chars = [...t.replace(/\s/g, "")];
    if (!chars.length || chars.length > 80) return 0;
    const known = chars.filter((c) => EGY_CHARS.has(c.codePointAt(0))).length;
    return known === chars.length ? 0.5 : 0;
  },
});

export { egyEncode, egyDecode, EGY_SIGNS, EGY_CHARS, EGY_NAME };
