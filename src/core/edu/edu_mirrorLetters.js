/*
 * edu_mirrorLetters.js — 科普卡候选（镜像字母）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu 下新分片）。
 * 来源：Unicode 码表字符命名（TURNED/REVERSED 系列）+ dCode 三页调研结论（均 2026-09-22 访问）。
 */
export default {
  mirrorLetters: {
    what: "镜像字母——把拉丁字母替换成视觉上左右翻转（水平镜像）的 Unicode 字形：a→ɒ、E→Ǝ、C→Ɔ、R→Я，几何对称的 b/d、p/q 互换，左右本来就对称的 A/H/O/X 等不变。得到「镜子里的字」，配合从右往左读即为完整的镜面书写效果。达芬奇手稿的镜面书法是其历史原型；CTF 里多作花式编码或隐写的弱混淆层。",
    principle:
      "查表替换：每个字母映射到一个视觉翻转字形。目标字形的权威锚点是 Unicode 码表命名本身——\n" +
      "ɒ U+0252 TURNED ALPHA、ɘ U+0258 REVERSED E、Ɔ U+0186 OPEN O、ꟻ U+A7FB EPIGRAPHIC REVERSED F、\n" +
      "ɿ U+027F REVERSED R、ʞ U+029E TURNED K、ꙅ U+A645 CYRILLIC REVERSED DZE 等，字符名就写着「翻转/反转」。\n" +
      "B→ᙠ、D→ᗡ、G→Ә、N→И、R→Я 等借用加拿大音节/西里尔/格鲁吉亚字母里的形近字形（花式映射通行做法）。\n" +
      "()、[]、{}、<>、/\\ 五对标点是 Unicode 官方 Bidi_Mirrored 属性定义的镜像对。\n" +
      "数字无官方镜像字形，不做映射；表外字符原样保留。编码/解码同表互逆，严格可逆。",
    usage:
      "编码：输入任意文本（可含汉字/数字/标点），字母与五对镜像标点被替换，其余原样保留；\n" +
      "解码：把镜像字形还原回原字母。b↔d、p↔q 互为对偶，解码时 d 还原成 b 属预期行为。\n" +
      "想要「达芬奇式」完整镜面文本：编码后把输出整串倒序即可（本工具不代倒序，保持双向严格互逆）。",
    examples: [
      { in: "Hello World", param: "编码", out: "Hɘllo Woɿlb", desc: "E→Ǝ 类替换注意 W/O 左右对称不变" },
      { in: "A\u1660\u0186", param: "解码", out: "ABC", desc: "镜像字形还原（A 自对称）" },
      { in: "Mirror", param: "编码", out: "Mi\u027F\u027Fo\u027F", desc: "r→ɿ（REVERSED R）；解码即复原" },
    ],
    formulas: [],
    tips: [
      "识别：文本里出现 ɒ ɘ Ɔ Ǝ ᗡ Я ɿ 等字符、且数字/汉字原样——是镜像字母表；全角风格的翻转（ɐ ǝ ʇ）则是 180° 倒转表（dCode「Ecriture a l'Envers」，另一算法，别混）。",
      "坑位：a 的镜像是 ɒ（U+0252 TURNED ALPHA），a 的 180° 倒转是 ɐ（U+0250 TURNED A）——两字形相近但码位不同，解码表按码位精确匹配，粘贴时别被字体骗。",
      "b/d、p/q 互换是几何事实：镜像文本里的 b 原本是 d。含这四个字母的文本解码后看到 b↔d 翻转属正确行为。",
      "安全边界：纯视觉混淆，零密码学强度，仅用于花式展示与 CTF 弱混淆；字体缺字时会显示方框（黑块），换支持 IPA/加拿大音节的字体即可。",
      "调研备注（2026-09-22）：dCode「Chiffres Miroir」是数字象形字谜、「Ecriture Speculaire」输出图片，均非 Unicode 字母镜像表；本表按 Unicode 命名锚点构建，跨文字块形近字形为工程约定（见交付 SOURCES.md）。",
      "来源：Unicode 码表 https://www.unicode.org/charts/ ；dCode https://www.dcode.fr/ecriture-speculaire-miroir 、https://www.dcode.fr/upside-down （访问日期 2026-09-22）。",
    ],
    aka: ["镜像字母", "mirror letters", "mirror text", "镜面文字", "镜像文字", "翻转字母",
      "mirror alphabet", "specular writing", "镜像 Unicode", "左右翻转文字", "水平镜像字母", "unicode mirror"],
  },
};
