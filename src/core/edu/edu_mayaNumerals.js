/*
 * edu_mayaNumerals.js — 科普卡候选（玛雅数字）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu 下新分片）。
 * EduEntry 契约见 src/core/eduContent.js 头注释。
 * 来源：dCode「Numération Maya」/ Wikipedia「Maya numerals」（均 2026-09-22 访问）。
 */
export default {
  mayaNumerals: {
    what: "玛雅数字——中美洲玛雅文明的位值制计数法：只有点（1）、横条（5）、贝壳形（0）三种符号，每层 0..19，往上每层乘 20（二十进制）。写法纵排（个位在底），文本工具横排为最高位在左、层间空格。",
    principle:
      "三个符号加法组成 0..19 的每层：点=1、条=5、贝壳=0。14 = 4 点 + 2 条（4+10）；17 = 2 点 + 3 条（2+15）。\n" +
      "位值×20：20 不写成 4 条（会破坏进位），而是上层 1 点 + 下层贝壳零——和十进制里 10 写「1,0」不写新符号同理。26 = 上层 1 点（×20）+ 下层 1 点 1 条（6）。\n" +
      "长纪历（compte long）变体：第三层起不再是 20²=400 而是 18×20=360（凑太阳年），再往上 7200、144000 继续乘 20；第二层（uinal）只出现 0..17。360 在纯二十进制写 (18,0)，长纪历写 (1,0,0)；7200 写 (1,0,0,0)。\n" +
      "Unicode 15 版前已收录玛雅数字块 U+1D2E0..U+1D2F3（MAYAN NUMERAL ZERO..NINETEEN，一字一层）——dCode「Unicode 符号」档即用它。",
    usage:
      "两个参数：进制模式（vigesimal=纯 20 进制；longcount=长纪历，第三层=360）；符号形态（unicode=玛雅数字块一字一层；dotbar=点 . 横 -，零层写 0）。\n" +
      "编码输入十进制非负整数（BigInt 大数可），解码吃对应形态的符号串（容忍空白）。负数/小数/前导零/层值越界/长纪历第二层>17 都显式报错。",
    examples: [
      { in: "14", param: "默认（vigesimal+unicode）", out: "𝋮", desc: "dCode 例：2 条 4 点 = 14，unicode 档一字即 𝋮（U+1D2EE）" },
      { in: "14", param: "form=dotbar", out: "....--", desc: "点横档：4 点 2 条（先点后条）" },
      { in: "26", param: "form=dotbar", out: ". .-", desc: "dCode 例：上层 1 点（20）+ 下层 6（1 点 1 条）" },
      { in: "360", param: "mode=longcount", out: "𝋡 𝋠 𝋠", desc: "dCode 例：长纪历 360 = (1,0,0)，纯 20 进制则是 (18,0)" },
    ],
    formulas: [
      { tex: "n = \\sum_i d_i \\cdot w_i,\\quad w_0{=}1,\\; w_1{=}20,\\; w_{i\\ge 2}=w_{i-1}\\times\\begin{cases}18 & i=2 \\text{(longcount)}\\\\ 20 & \\text{else}\\end{cases}", caption: "层值×权重：纯 20 进制与长纪历（第三层先 ×18 再 ×20）" },
    ],
    tips: [
      "识别：点+横条堆叠（每层最多 4 点 3 条）、贝壳形零、中美洲/玛雅/金字塔/长纪历 2012 梗。",
      "坑位：见到「一层 4 条」必是伪造——20 要进位，dCode 原文专门解释了为什么 20 不写成 4 条。",
      "长纪历第二层只到 17（一个 tun=18 uinal），出题人若给第二层 18/19 要么是纯二十进制要么是错的。",
      "unicode 档需要 Unicode 14+ 字体（dCode 原注「v14+ nécessaire」），显示方框时换字体或用点横档。",
      "点横档的零写 0 是本工具约定（贝壳零无文本符号，dCode 点横档没定义）——交换题目时以 unicode 档为准。",
      "长纪历日常彩蛋：生日/纪念日转 longcount 档即是「玛雅历生日」，baktun.katun.tun.uinal.kin 五段。",
      "来源：dCode https://www.dcode.fr/nombres-mayas 、Wikipedia https://en.wikipedia.org/wiki/Maya_numerals （访问日期 2026-09-22）。",
    ],
    aka: ["玛雅数字", "玛雅计数", "玛雅历法数字", "Maya numerals", "Mayan numerals", "vigesimal",
      "二十进制", "长纪历", "Long Count", "玛雅点横", "玛雅贝壳零", "maya numbers"],
  },
};
