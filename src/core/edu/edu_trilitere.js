/*
 * edu_trilitere.js — 科普卡：Trilitère。纯数据，无 import 无副作用。
 * 来源：dCode「Chiffre Trilitère」(2026-09-20 访问)，含完整字母表与算例 DCODE → ABA AAC BBC ABA ABB。
 * 字母表已校验为 27 个三元组的完整置换。
 */
export default {
  trilitere: {
    what: "Trilitère（三元密码）——把每个字母换成一串三个符号，符号只用 A/B/C 三个。可以理解成培根密码的「三进制版」：培根用 a/b 两个符号，这里用 a/b/c 三个。",
    principle:
      "把 26 个字母编号 A=0, B=1, …, Z=25，再用三进制写成三位（每位取 A=0、B=1、C=2）：\n\n" +
      "A = AAA、B = AAB、C = AAC、D = ABA、E = ABB、F = ABC、G = ACA……一直到 Z = CCB。$3^3 = 27$，多出来的那一个 CCC 就分给空格。\n\n" +
      "所以整张表是 27 个三元组（AAA…CCC）的一次完整分配，每个字母/空格唯一对应一个三元组，反过来也能唯一还原——这就是它能双向可逆的原因。\n\n" +
      "还有一个变体档把空格放在最前：空格 = AAA，A = AAB，…… Z = CCC（相当于整体错开一位）。三个符号也可以换成 1/2/3 或 0/1/2 来书写，三元组的结构不变。",
    usage:
      "两个参数：variant 选三元表（base3：空格=CCC，默认；base3space：空格=AAA）；symbols 填使用的三个符号（默认 ABC，也可填 123 或 012）。\n\n" +
      "编码：填明文 → 三元组串（非字母非空格的字符会被丢弃）；解码：填三元组串 → 明文。密文长度必须是 3 的倍数，否则报错。",
    examples: [
      { in: "DCODE", param: "variant=base3, symbols=ABC", out: "ABAAACBBCABAABB", desc: "dCode 官方算例：D=ABA, C=AAC, O=BBC, E=ABB" },
      { in: "A B", param: "variant=base3, symbols=ABC", out: "AAACCCAAB", desc: "空格占 CCC" },
      { in: "DCODE", param: "variant=base3space, symbols=ABC", out: "ABBABABCAABBABC", desc: "换「空格=AAA」档，整体错一位" },
      { in: "DCODE", param: "variant=base3, symbols=123", out: "121113223121122", desc: "同一张表，改用 1/2/3 书写" },
    ],
    formulas: [
      { tex: "v = \\text{idx}(c),\\quad \\text{tri} = d_2 d_1 d_0 \\ \\ (v = 9 d_2 + 3 d_1 + d_0,\\ d_k \\in \\{A,B,C\\})", caption: "字母下标的三进制展开即三元组" },
    ],
    tips: [
      "识别：密文只由 3 个不同符号（常见 A/B/C，也可能是 1/2/3、0/1/2，甚至是三种字体/大小写/粗细）组成，且三种符号出现得比较均匀。",
      "像培根密码一样，它常被藏进一段正常文字里——用三种字体或大小写变化来编码，肉眼看着像普通文本。",
      "长度一定是 3 的倍数；不整除说明抄漏了或混进了别的东西。",
      "dCode 另列 Frederici / Cardan / Vigenère / Wilkins 四张三元表，但抓取的页面文本不完整（104 字符，应为 108 且有重复三元组），本工具不收，避免编造。",
      "安全边界：本质是单表替换（27 个符号换 26 字母），频率分析照常有效——仅用于 CTF/教学，不可用于真实保密。",
      "来源：dCode「Chiffre Trilitère」https://www.dcode.fr/chiffre-trilitere （访问日期 2026-09-20）。",
    ],
    aka: [
      "Trilitère",
      "三元密码",
      "三进制密码",
      "triliteral cipher",
      "三元组替换",
      "abc 三元码",
      "三字母密码",
      "三进替代",
      "trilitere cipher",
      "培根三元版",
      "三元字母表",
      "三符号替换",
    ],
  },
};
