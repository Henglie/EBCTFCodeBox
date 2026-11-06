/*
 * edu_monomeBinome.js — 科普卡候选（Monome-Binome 单子双子）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu/ 下新分片）。
 * EduEntry 契约见 src/core/eduContent.js 头注释。
 * 来源：dCode「Chiffre Monome-Binome」(2026-09-22 访问)。
 */
export default {
  monomeBinome: {
    what: "Monome-Binome（单子-双子，又叫 monome-dinome）——Polybius 家族的坐标替换：一张刻意不完整的 3 行网格配两个「行键数字」，有的字母编成 1 位数（monome）、有的编成 2 位数（binome），名字就是这么来的。",
    principle:
      "网格 3×10 档（dCode 官方例，行键默认 3 和 7）：\n\n" +
      "列:  0 1 2 3 4 5 6 7 8 9\n行1: A B C   D E F   G H      （3、7 两列空缺，作行键）\n行3: I J K L M N O P Q R\n行7: S T U V W X Y Z ␣ *\n\n" +
      "第一行没有行名，它的字母只输出列号——1 位数（如 E→5）；行键 3、7 命名的两行输出 行键+列号——2 位数（如 M→34、S→70）。28 个码位：A-Z 加空格和 *。\n\n" +
      "解析无歧义的关键：行键数字（3/7）永远不可能出现在第一行（第一行只占非行键的 8 列），所以读到 3 或 7 必是 2 位数的开头，其他数字必是 1 位数——一串数字能唯一切分。\n\n" +
      "3×8 档是 24 字母的紧凑版（J→I、U→V 合并，官方网格第二三行是 I K L M N O P Q 与 R S T V W X Y Z），三行各 8 格。关键词变体：keyword 去重后放码表开头扰动字母表。dCode 官方向量：MONOME → 34 36 35 36 34 5；4303536345 → DINOME。",
    usage:
      "三个参数：关键词（扰动字母表，留空=标准序）；行键数字（两个互异的 0-9，默认 3,7）；网格档（3x10 官方例 / 3x8 紧凑版）。\n\n" +
      "编码：明文大写化；3x10 档保留空格与 *（网格有这两个码位），其余非字母丢弃；3x8 档 J→I、U→V；输出连续数字串。\n\n" +
      "解码：输入数字串（容忍逗号/空格分隔）；按行键规则切分还原。非法输入显式报错：行键重复、数字流以行键结尾缺列号、3x8 档坐标越界等。",
    examples: [
      { in: "MONOME", param: "默认参数（3x10，行键 3,7，无关键词）", out: "34363536345", desc: "dCode 官方向量：M→34 O→36 N→35 O→36 E→5" },
      { in: "4303536345", param: "默认参数，方向=解码", out: "DINOME", desc: "dCode 官方向量：4→D 30→I 35→N 36→O 34→M 5→E" },
      { in: "34,36,35,36,34,5", param: "默认参数，方向=解码", out: "MONOME", desc: "带逗号的写法同样可解（分隔符容忍）" },
    ],
    formulas: [
      { tex: "d \\in \\{k_1,k_2\\} \\Rightarrow (d,\\,d')\\text{ 定位后两行；}\\ d \\notin \\{k_1,k_2\\} \\Rightarrow d\\text{ 定位首行}", caption: "行键数字只出现在后两行 → 数字流切分唯一" },
    ],
    tips: [
      "识别：密文全是数字、长度不定长地混杂 1 位与 2 位切分；频率分析里行键数字（3/7）明显超量——因为它们出现在每个 2 位数开头。",
      "行键可以换（任意两个互异数字），换行键=换整套坐标；关键词再扰动字母表，双层密钥。",
      "空格与 * 也是码位（3x10 档）：出题人可以用它们当词分隔或干扰符；3x8 档没有它们。",
      "与 Polybius/ADFGVX 的区别：Polybius 每字母恒 2 位、ADFGVX 恒 2 字符，Monome-Binome 混合 1 位与 2 位——变长正是它的伪装点。",
      "历史痕迹：dCode 记载此密码在 1936 年西班牙内战中有使用记录，发明时间不明。",
      "安全边界：码表结构公开、密钥只有行键+关键词，属古典弱密码，数字流统计即可攻破；仅供 CTF/教学。",
      "来源：dCode Chiffre Monome-Binome https://www.dcode.fr/monome-binome （访问日期 2026-09-22）。",
    ],
    aka: ["单子双子", "单子双子密码", "Monome-Binome", "Monome Binome", "monome-binome",
      "Monome-Dinome", "Monome Dinome", "monome-dinome", "单码双码", "一两位数字密码",
      "数字坐标密码", "Polybius 变体", "西班牙内战密码", "行键网格", "坐标替换密码"],
  },
};
