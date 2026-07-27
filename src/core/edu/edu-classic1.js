// 科普内容分片：classic 前 8（gronsfeld/beaufort/autokey/porta/playfair/nihilist/columnar/trifid）。纯数据，无 import 无副作用。
export default {
  gronsfeld: {
    what: "Gronsfeld 密码：维吉尼亚的「数字密钥版」。密钥是一串数字，每个字母按对应数字做凯撒移位。",
    principle:
      "密钥是数字串（如 `31415`），循环对齐明文。第 $i$ 个字母移位 $c_i = (x_i + k_{i \\bmod L}) \\bmod 26$，$k$ 取密钥数字，$L$ 为密钥长度。\n\n" +
      "和维吉尼亚一模一样，只是密钥用 0-9 而不是字母（等价于位移量只能 0-9 的维吉尼亚）。",
    usage: "填数字密钥，粘密文解码；编码方向加密。只处理字母，其余原样。",
    examples: [
      { in: "HELLO", param: "密钥=31415", out: "KFPMT", desc: "H+3=K, E+1=F, L+4=P, L+1=M, O+5=T" },
    ],
    formulas: [
      { tex: "c_i = (x_i + k_{i \\bmod L}) \\bmod 26", caption: "k 取密钥的数字，L 为密钥长度" },
    ],
    tips: ["密钥是数字（不是单词）的多表移位密码，就是 Gronsfeld。", "每位移位只能 0-9，比维吉尼亚弱一点，密钥短时更容易爆破。"],
    aka: ["gronsfeld", "格朗斯菲尔德", "数字密钥维吉尼亚", "Gronsfeld", "格龙斯菲尔德", "gronsfeld cipher",
      "数字维吉尼亚", "数字密钥密码", "Gronsfeld cipher", "格朗斯菲尔德密码", "数字键维吉尼亚", "10进制维吉尼亚"],
  },

  beaufort: {
    what: "Beaufort 密码：维吉尼亚的变体，但用「密钥减明文」而不是相加。它是自反的，加密解密同一套操作。",
    principle:
      "对每个字母 $c_i = (k_{i \\bmod L} - x_i) \\bmod 26$，也就是拿密钥字母减去明文字母。\n\n" +
      "因为是「减」，再来一次 $(k - c) = (k - (k - x)) = x$ 就回到明文，所以编码解码同形。注意它和 Vigenère 的解密（明文减密钥）不是一回事。",
    usage: "填字母密钥，直接转换（编码解码同一操作）。只处理字母。",
    examples: [
      { in: "HELLO", param: "密钥=KEY", out: "DANZQ", desc: "K-H, E-E, Y-L… 逐位密钥减明文" },
    ],
    formulas: [
      { tex: "c_i = (k_{i \\bmod L} - x_i) \\bmod 26", caption: "自反：对密文再做一次得回明文" },
    ],
    tips: ["自反：不知道方向直接跑一遍，通了就对。", "别和 Vigenère 混：Vigenère 是加/减，Beaufort 恒为「密钥减字母」。"],
    aka: ["beaufort", "博福特", "自反维吉尼亚", "Beaufort", "波弗特", "beaufort cipher",
      "Beaufort cipher", "博福特密码", "波弗特密码", "对合密码", "密钥减明文", "reciprocal cipher"],
  },

  autokey: {
    what: "AutoKey 自动密钥：维吉尼亚的加强版。密钥只给一个短词开头，后面接上明文本身当密钥流，避免密钥短周期被破。",
    principle:
      "密钥流 = 关键词 + 明文。比如关键词 `KEY`、明文 `HELLO`，密钥流就是 `KEYHELLO`（用前面的明文补后面的密钥）。\n\n" +
      "加密 $c_i = (x_i + \\text{stream}_i) \\bmod 26$。因为密钥流不再循环，重合指数/Kasiski 这类靠周期的方法失效。解密时边解边把还原出的明文接回密钥流。",
    usage: "填关键词，粘密文解码；编码方向加密。只处理字母。",
    examples: [
      { in: "HELLO", param: "keyword=KEY", out: "RIJSS", desc: "密钥流 KEYHE，H+K, E+E, L+Y, L+H, O+E" },
    ],
    tips: ["它没有固定密钥周期，Kasiski/IC 对它基本无效，破解思路不同于普通维吉尼亚。", "解密必须顺序进行：每还原一个明文字符，就把它加进密钥流供后面用。"],
    aka: ["autokey", "自动密钥", "自密钥", "auto-key", "Autokey", "autokey cipher",
      "自动密钥密码", "自密钥密码", "Autokey cipher", "auto key", "维吉尼亚自动密钥", "明文自密钥"],
  },

  porta: {
    what: "Porta 密码：一种自反的多表替换。用密钥字母选一张替换表，表本身设计成「换两次回原文」。",
    principle:
      "26 个字母两两一组共 13 张表（A/B 用同一张、C/D 同一张…）。密钥字母决定当前字符用哪张表。\n\n" +
      "每张表把前 13 个字母和后 13 个字母对调映射，构造成自反：对密文用同一密钥再跑一次就还原。历史上属于较早的多表密码。",
    usage: "填字母密钥，直接转换（编码解码同一操作）。只处理字母。",
    examples: [
      { in: "HELLO", param: "密钥=KEY", out: "ZTXQM", desc: "按 K/E/Y 选表逐字符替换" },
    ],
    tips: ["自反：同一密钥跑两次回原文，不确定方向就再跑一遍。", "密钥字母成对共表（A=B、C=D…），所以密钥里 A 和 B 效果相同。"],
    aka: ["porta", "波尔塔", "自反多表", "Porta", "波塔", "porta cipher",
      "Porta cipher", "波尔塔密码", "波塔密码", "della Porta", "自反多表替换", "对合多表密码"],
  },

  playfair: {
    what: "Playfair 密码：一次加密两个字母的经典密码。把 25 个字母排进 5×5 方阵，按字母对在方阵里的位置替换。",
    principle:
      "用关键词去重后填 5×5 方阵（I/J 合并占一格），其余字母按序补满。明文两两分组，遇重复字母插 `X` 隔开，奇数补 `X`。\n\n" +
      "每对字母按规则替换：同行取各自右边一格、同列取各自下边一格、否则取「同行换列」的矩形对角。是最早能实用的双字母替换密码。",
    usage: "填关键词（keyword），粘密文解码；编码方向加密。J 会被当作 I。",
    examples: [
      { in: "HELLO", param: "keyword=MONARCHY", out: "CFSUPM", desc: "LL 被拆成 LX/LO，配成偶数对" },
    ],
    tips: ["密文长度必为偶数、且没有落单字母时不出现连续相同字母，是 Playfair 的特征。", "J 通常并入 I；解出来常见多余的 X，是分隔/补齐留下的。"],
    aka: ["playfair", "普莱费尔", "双字母密码", "5x5方阵", "Playfair", "playfair cipher",
      "普莱费尔密码", "Playfair cipher", "双字母替换", "bigram cipher", "Wheatstone", "5x5棋盘密码"],
  },

  nihilist: {
    what: "Nihilist 虚无党密码：用关键词打乱的 Polybius 方阵把字母转成两位坐标数字。19 世纪俄国虚无党人用过。",
    principle:
      "先用关键词去重生成 5×5 键控方阵（I/J 合并），每个字母对应「行号列号」两位数字（各 1-5）。\n\n" +
      "本工具实现的是键控 Polybius 版：字母 → 坐标对。完整的虚无党密码还会再叠加一个数字密钥相加，这里聚焦方阵坐标这一层。",
    usage: "填关键词，粘坐标数字串解码；编码方向把字母转坐标。",
    examples: [
      { in: "HELLO", param: "keyword=KEY", out: "2512323235", desc: "每字母 2 位坐标，按键控方阵" },
    ],
    tips: ["一串两两成对、每位都在 1-5 的数字，且方阵疑似被关键词打乱，考虑 Nihilist/键控 Polybius。", "方阵是关键词打乱的，不知道关键词坐标就对不上。"],
    aka: ["nihilist", "虚无党", "虚无主义者密码", "键控polybius", "Nihilist", "nihilist cipher",
      "虚无党密码", "Nihilist cipher", "虚无主义密码", "俄国虚无党密码", "键控波利比奥斯", "数字叠加密码"],
  },

  columnar: {
    what: "列移位密码（Columnar Transposition）：把明文按行填进表格，再按密钥字母的字典序一列一列读出来。换位密码。",
    principle:
      "密钥单词的每个字母排出一个读列顺序（按字母表排序，相同字母按原位置）。明文按行填入 `密钥长度` 列的网格，然后按这个顺序逐列读出。\n\n" +
      "字母本身没变，只是被打乱了顺序——频率分析看不出替换痕迹。",
    usage: "填密钥单词，粘密文解码；编码方向加密。只处理字母。",
    examples: [
      { in: "HELLOWORLD", param: "密钥=ZEBRA", out: "ODLREOLLHW", desc: "按 ZEBRA 排序后的列序 A→B→E→R→Z 读列" },
    ],
    tips: ["字母组成没变、只是顺序乱了，先怀疑换位类（列移位/栅栏）。", "密钥决定读列顺序；密钥长度 = 列数，密文长度是列数的整数倍时最规整。"],
    aka: ["列移位", "columnar transposition", "列换位", "列置换", "列移位密码", "columnar cipher",
      "列换位密码", "列置换密码", "换位密码", "transposition cipher", "密钥列换位", "栅栏类换位"],
  },

  trifid: {
    what: "Trifid 三分密码：Bifid 的三维版。把每个字母映射成三维坐标（3×3×3 立方体），拆开重排后再合回字母，混淆很强。",
    principle:
      "27 字符密钥填成三个 3×3 方块（共 27 格），每个字母对应三个坐标数字（层、行、列，各 1-3）。\n\n" +
      "按 period 分组，组内把所有第一坐标排一起、第二坐标排一起、第三坐标排一起，再每 3 个数字配回一个字母。相当于把字母「切成三份打散再拼」。",
    usage: "填 27 字符密钥表和 period（分组周期），粘密文解码；编码方向加密。",
    examples: [
      { in: "HELLO", param: "key=ABCDEFGHIJKLMNOPQRSTUVWXYZ. period=5", out: "BOJN.", desc: "标准 A-Z+句点 27 字符表" },
    ],
    tips: ["密钥必须正好 27 个字符（26 字母 + 1 个补位符，常用句点）。", "是 Bifid 的三维推广：Bifid 用 5×5 二维坐标，Trifid 用 3×3×3 三维坐标。"],
    aka: ["trifid", "三分密码", "三维分置", "德拉斯泰尔三分", "Trifid", "trifid cipher",
      "Trifid cipher", "德拉斯泰尔", "Delastelle", "三维坐标密码", "3x3x3密码", "Bifid三维版"],
  },
};
