/*
 * mirrorLetters.js — 镜像字母（cat:'fancy'，双向）。
 *
 * 原理：把拉丁字母替换成视觉上水平镜像（左右翻转）的 Unicode 字形，得到"镜面字"：
 *   - 官方镜像字形锚点：Unicode 码表中对这些字符的正式命名即描述其翻转关系——
 *     ɒ U+0252 TURNED ALPHA、ɘ U+0258 REVERSED E、Ǝ U+018E REVERSED E、Ɔ U+0186 OPEN O、
 *     ɔ U+0254 OPEN O、ꟻ U+A7FB EPIGRAPHIC REVERSED F、ꟼ U+A7FC EVERSED P、
 *     ɿ U+027F REVERSED R、ʞ U+029E TURNED K、⅃ U+2143 REVERSED SANS-SERIF L、
 *     ꙅ U+A645 CYRILLIC REVERSED DZE、Ƹ U+01B8 EZH REVERSED 等。
 *   - 几何对称对（自然事实）：b↔d、p↔q；自身左右对称的字母（A/H/I/M/O/T/U/V/W/X/Y、
 *     h/i/l/m/n/o/u/v/w/x/y 等）不变。
 *   - 跨文字块形似字形（工程约定，与本项目花式映射 op 同口径）：B→ᙠ(加拿大音节 TSA)、
 *     D→ᗡ(加拿大音节 THA)、G→Ә(西里尔 SCHWA)、J→Ⴑ(格鲁吉亚 SAN)、K→⋊、N→И、Q→Ϙ、
 *     R→Я、S→Ƨ、f→ꟺ、g→ǫ、j→ꞁ、t→ƚ、c→ɔ、s→ꙅ。
 *   - 标点：()、[]、{}、<>、/\ 五对镜像——这五对在 Unicode 标准里带 Bidi_Mirrored 属性，
 *     是官方定义的镜像对。
 *
 * 来源与调研（2026-09-22）：
 *   - Unicode 码表字符命名（上述 TURNED/REVERSED/OPEN 系列）＝逐字符权威锚点；
 *   - dCode 调研结论：dCode「Chiffres Miroir」是数字象形字谜工具、「Ecriture Speculaire」
 *     输出图片而非 Unicode 映射、其「Ecriture a l'Envers」是 180° 倒转（a→ɐ，非镜像）——
 *     dCode 无 Unicode 镜像字母静态表，本表按 Unicode 命名锚点 + 形似字形约定构建（见 SOURCES.md）。
 *
 * 约定：
 *   - encode/decode 同表互逆：decode 把镜像字形还原为原字母（b↔d、p↔q 互为对偶，严格可逆）；
 *     映射表外的字符（数字、汉字、空格、未收录符号）原样保留。
 *   - 数字不做映射：Unicode 无官方"镜像数字"字形，不硬造（限定，见 README）。
 *
 * 红线：纯查表映射，无算法风险；表内每个非 ASCII 目标字符的码位与正式命名登记在 SOURCES.md。
 *
 * 契约：register({ id:"mirrorLetters", cat:"fancy", name, desc, params, encode, decode })。
 */
import { register } from "./registry.js";

// 正向映射：原字符 → 镜像字形（大写、小写、官方镜像标点五对）
const MIRROR_MAP = {
  A: "A", B: "\u1660", C: "\u0186", D: "\u15E1", E: "\u018E", F: "\uA7FB",
  G: "\u04D8", H: "H", I: "I", J: "\u10B1", K: "\u22CA", L: "\u2143",
  M: "M", N: "\u0418", O: "O", P: "\uA7FC", Q: "\u03D8", R: "\u042F",
  S: "\u01A7", T: "T", U: "U", V: "V", W: "W", X: "X", Y: "Y", Z: "\u01B8",
  a: "\u0252", b: "d", c: "\u0254", d: "b", e: "\u0258", f: "\uA7FA",
  g: "\u01EB", h: "h", i: "i", j: "\uA781", k: "\u029E", l: "l",
  m: "m", n: "n", o: "o", p: "q", q: "p", r: "\u027F", s: "\uA645",
  t: "\u019A", u: "u", v: "v", w: "w", x: "x", y: "y", z: "z",
  "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{",
  "<": ">", ">": "<", "/": "\\", "\\": "/",
};

// 逆向映射：镜像字形 → 原字符（构造时校验无冲突）
const MIRROR_UNMAP = {};
for (const [k, v] of Object.entries(MIRROR_MAP)) {
  if (v in MIRROR_UNMAP && MIRROR_UNMAP[v] !== k)
    throw new Error("mirrorLetters 映射表冲突: " + v);
  MIRROR_UNMAP[v] = k;
}

function applyMap(text, map) {
  const src = String(text == null ? "" : text);
  if (!src.trim()) throw new Error("mirrorLetters：输入为空或全为空白");
  let out = "";
  for (const ch of src) {
    const code = ch.codePointAt(0);
    if (code >= 0xD800 && code <= 0xDFFF)
      throw new Error("mirrorLetters：输入含非法代理项字符");
    out += map[ch] != null ? map[ch] : ch;
  }
  return out;
}

function mirrorEncode(text) { return applyMap(text, MIRROR_MAP); }
function mirrorDecode(text) { return applyMap(text, MIRROR_UNMAP); }

register({
  id: "mirrorLetters",
  cat: "fancy",
  name: "镜像字母",
  desc: "拉丁字母 ↔ 水平镜像 Unicode 字形（A↔A、b↔d、a→ɒ、E→Ǝ…；()[]{}<>/\\ 五对为本工具约定的水平镜像对，非 Unicode Bidi_Mirrored 属性；数字不映射），双向严格互逆",
  params: [],
  encode: mirrorEncode,
  decode: mirrorDecode,
});

export { mirrorEncode, mirrorDecode, MIRROR_MAP, MIRROR_UNMAP };
