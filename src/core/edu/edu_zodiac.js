/*
 * edu_zodiac.js — 科普卡候选（黄道十二宫 Z408）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu/ 下新分片）。
 * EduEntry 契约见 src/core/eduContent.js 头注释。
 * 来源：zodiackillerciphers.com Harden 键页（2026-09-22 访问）/ dCode「Zodiac Killer Cipher」
 * （2026-09-22 访问）/ Wikipedia「Zodiac Killer」（2026-09-22 访问）。
 */
export default {
  zodiac: {
    what: "黄道十二宫杀手密码（Zodiac Z408）——1969 年 7 月 31 日连环杀手 Zodiac 寄给三家报社的 408 字符密文，用同音替换（一个字母多个符号）拖延频率分析，仍在一周内被教师夫妇 Donald 与 Bettye Harden 破译。",
    principle:
      "同音替换（homophonic substitution）：每个明文字母可以由多个不同的密文符号表示——高频字母（E 有 7 个符号、I 4 个、S 4 个…）分到更多符号，把字母频率摊平。每个符号基本只回一个字母，所以知道码表就能解密。\n\n" +
      "Z408 一共 54 个不同的密文符号（圆圈叉、三角、点阵、反写 K 等）。Harden 夫妇注意到消息开头很可能是「I like killing」（杀手信件的口头禅），由此撬开整张码表。\n\n" +
      "原密文里还有几个「一符两义」的多音符号（如 e 符号 8 次=E、1 次=S；n8 符号 4 次=A、3 次=S、1 次=I）——是凶手笔误或故意干扰。本工具按主导次数取主字母，副义用法不进码表（文档写明，不猜）。\n\n" +
      "符号 token：杀手手绘符号没有 Unicode 对应，本工具采用 zodiackillerciphers.com（Z340 破译者 David Oranchak 的研究站）对 54 个符号的机器命名（a、b、d…n9、zodiac、slash、plus 等，即该站 alphabet/*.jpg 图形文件名），密文 = 空格分隔的 token 串。",
    usage:
      "一个参数：同音选择——cycle（默认）按 Harden 键表序轮转使用该字母的符号，还原杀手的同音轮换用法；primary 每个字母固定用第一个符号。\n\n" +
      "编码：输入英文（只保留 A-Z），输出 token 串。J/Q/Z 在 Z408 明文里零出现、没有对应符号（dCode 亦注明），编码遇到它们会明确报错——不猜。\n\n" +
      "解码：粘贴 token 串（空格/逗号分隔均可），未知 token（比如未破解的 Z340/Z13/Z32 专属符号）直接报错。默认可以直接解历史密文首两行：n9 sqr p slash z … → ILIKEKILLINGPEOPLEBECAUSEITISSOMUC。",
    examples: [
      { in: "n9 sqr p slash z slash u b sqr bk o r sidek bp x sidek b w v plus be g y f n6 n9 h p sqd k funnyi bq y be", param: "默认参数，方向=解码", out: "ILIKEKILLINGPEOPLEBECAUSEITISSOMUC", desc: "Z408 历史密文第 1+2 行（I LIKE KILLING PEOPLE BECAUSE IT IS SO MUC[H]）" },
      { in: "s theta slash n9 sq b p o r a u sqr bf r bl bq e", param: "默认参数，方向=解码", out: "ANKILLINGWILDGAME", desc: "Z408 第 4 行（…TH[AN] KILLING WILD GAME）" },
      { in: "i n9 d r sqe t y br backslash bd be slash sqd x j q a", param: "默认参数，方向=解码", out: "TINGYOURROCKSOFFW", desc: "Z408 第 12 行（…GETTING YOUR ROCKS OFF W[ITH]）" },
      { in: "ILIKEKILLINGPEOPL", param: "selection=primary（固定符号）", out: "p b p slash e slash p b b p d r sidek e t sidek b", desc: "编码侧：每字母恒用首个符号" },
    ],
    formulas: [
      { tex: "E \\mapsto \\{e, n, w, z, bp, n_6, plus\\}\\;(7\\text{ 个同音符号，Harden 键})", caption: "高频字母分到多个符号：E 有 7 个，摊平频率正是同音替换的目的" },
    ],
    tips: [
      "识别：题目出现十字圆圈符号、旧金山湾区连环杀手、1969-1970 报社信件、paradice/slaves 等词，或给出一串手绘符号图。",
      "四份密文状态：Z408（1969 破）、Z340（2020-12 由 Oranchak 团队破，含换位不在本工具范围）、Z13 与 Z32（至今未破）——本工具只收 Z408 已解子集，别的符号来了直接报错。",
      "多音符号坑：原密文里 e/i/n/n7/n8/n9 有少量「一符两义」用法（凶手笔误/干扰），本工具按主导字母解码，与公开解读一致。",
      "J/Q/Z 无符号：Z408 明文恰好不含这三个字母，历史上就没有对应符号；本工具编码遇到它们明确报错而不是借符号。",
      "token 名字难记没关系：把 zodiackillerciphers.com/408/key.html 的 Harden 键表对照着用，符号名与该站图片文件名一一对应。",
      "安全边界：同音替换只是拖慢频率分析，码表一旦泄露或被猜出即告破（Harden 夫妇一周内徒手破译）；无任何现代安全性，仅供 CTF/教学与案件史了解。",
      "来源：zodiackillerciphers.com Harden 键 http://zodiackillerciphers.com/408/key.html 、dCode https://www.dcode.fr/zodiac-killer-cipher 、Wikipedia https://en.wikipedia.org/wiki/Zodiac_Killer （访问日期均为 2026-09-22）。",
    ],
    aka: ["黄道十二宫", "黄道十二宫杀手", "十二宫杀手密码", "Zodiac", "Zodiac Killer", "Zodiac cipher",
      "Z408", "408 密文", "Zodiac 408", "同音替换密码", "homophonic substitution", "Harden 破译",
      "Z340", "Z13", "Z32", "杀手密码", "Zodiac Killer Cipher"],
  },
};
