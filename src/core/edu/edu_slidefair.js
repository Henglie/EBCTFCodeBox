/*
 * edu_slidefair.js — 科普卡候选（Slidefair 密码）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu 下新分片）。
 * 来源：ACA「SLIDEFAIR」PDF（2026-09-22 访问）+ dCode「Slidefair Cipher」。
 */
export default {
  slidefair: {
    what: "Slidefair 密码——把维吉勒表当滑尺用的双字母（digraph）代换：密钥逐双字母循环选表行，两个明文字母在表里张成一个矩形，密文取矩形另外两个角，可视为 Playfair 与 Vigenère 的混血。",
    principle:
      "1. 表：顶行是普通 A-Z 表头；下面每行由密钥字母决定——Vigenère 行 K 第 j 列 = j+K，Variant = j−K，Beaufort = K−j。\n" +
      "2. 明文按双字母分组，第 i 组配密钥第 i 个字母 K（循环）。\n" +
      "3. 矩形规则：第 1 个明文字母 P1 在顶行找到（列 c1），第 2 个明文字母 P2 在密钥行 K 找到（列 c2）；" +
      "P1、P2 视为矩形的对角，密文 = 另外两角——顶行那角在前：密文 = ( 顶行[c2], 行K[c1] )。\n" +
      "4. 退化特例：P1、P2 同列（竖直对，矩形压扁）时，密文 = 两字母正右侧的一对；解密时同构造取正左侧，" +
      "因此加密解密互为逆运算。",
    usage:
      "两个参数：keyword 密钥（逐双字母循环取字母）；table 表族（Vigenère / Variant / Beaufort 三档，默认 Vigenère）。\n\n" +
      "编码：填明文 → 密文（恒为偶数长度）；解码：填密文 + 相同密钥 → 明文。明文只取 A-Z（其余字符丢弃），输出大写；" +
      "长度为奇数时末尾自动补 X（工具约定，解密结果会带出这个 X）。密钥只取字母。",
    examples: [
      { in: "The Slidefair can be used with Vigenere, Variant or Beaufort.",
        param: "keyword=DIGRAPH, table=vigenere",
        out: "EWKMCRNUAFCXTJYQMMYYFUTIGWZPKHJMPKBSAIECKVCFMIILCI",
        desc: "ACA 官方算例（25 个双字母）" },
      { in: "EWKMCRNUAFCXTJYQMMYYFUTIGWZPKHJMPKBSAIECKVCFMIILCI",
        param: "keyword=DIGRAPH, table=vigenere，方向=解码",
        out: "THESLIDEFAIRCANBEUSEDWITHVIGENEREVARIANTORBEAUFORT",
        desc: "反向复原，验证双向可逆" },
      { in: "ca", param: "keyword=B, table=vigenere", out: "ZD", desc: "ACA 迷你例：密钥字母 B 下 ca→ZD（de→EF；Variant 下 ca→BB、de→FC；Beaufort 下 ca→BZ、de→XY）" },
      { in: "MESSAGE", param: "keyword=ABC, table=vigenere", out: "EMRTECXE", desc: "dCode 算例：奇数长补 X 后 EMRTEC+XE" },
    ],
    formulas: [
      { tex: "(C_1, C_2) = \\big(\\text{top}[c_2],\\ \\text{row}_K[c_1]\\big)", caption: "密文取矩形另两角，顶行角在前" },
      { tex: "c_1 = c_2 \\Rightarrow (C_1, C_2) = \\big(\\text{top}[c_1{+}1],\\ \\text{row}_K[c_1{+}1]\\big)", caption: "竖直对退化：取正右侧一对" },
    ],
    tips: [
      "识别：密文长度恒为偶数、重合指数低（多表特征）但相邻两字母存在相关性（双字母特征）——与 Playfair 的区别是" +
        "不要求去重、也不固定 5x5 字母表。",
      "表族三档别选错：Vigenère（j+K）/ Variant（j−K）/ Beaufort（K−j）结果完全不同，按出题提示试。",
      "竖直对特例是双向自洽的：加密取右侧、解密取左侧，无需额外标记。",
      "密钥长度即周期：密钥长 L 时第 i 个双字母用第 ((i-1) mod L)+1 个密钥字母，长密钥直接拉长周期。",
      "安全边界：双字母多表代换仍可被双字母频率分析攻破，密钥短时更易——仅用于 CTF 与教学。",
      "来源：ACA「SLIDEFAIR」https://www.cryptogram.org/downloads/aca.info/ciphers/Slidefair.pdf ；" +
        "dCode「Slidefair Cipher」https://www.dcode.fr/slidefair-cipher （访问日期 2026-09-22）。",
    ],
    aka: ["Slidefair", "Slidefair 密码", "Slidefair cipher", "滑尺密码", "滑尺公平密码", "斯莱德菲尔",
      "slidefair decoder", "双字母维吉勒", "slidefair 加密", "Slidefair 解密", "滑尺双字母密码",
      "ACA Slidefair", "滑尺表密码"],
  },
};
