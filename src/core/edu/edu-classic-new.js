/*
 * edu-classic-new.js — 科普补缺分片（古典新 op）。
 *
 * 覆盖 5 个真实缺失 op 的科普卡：
 * classic: routeCipher, rotSpecial, chaocipher, straddleCheckerboard
 * text: fullwidth
 *
 * 覆盖核查（撞已引分片的已剔除）：
 * - trithemius → 已由 edu-classic2.js 覆盖，删
 * - rot8000 → 已由 edu-fancy-cn.js 覆盖，删
 * - nihilist/beaufort/porta/gronsfeld → 已由 edu-classic1.js 覆盖，删
 *
 * 纯数据无副作用，无 import 无 register。在 eduContent.js 归并。
 * EduEntry 格式照 eduContent.js 头注释契约。
 */
export default {
 // ============ classic: 曲路密码 ============
  routeCipher: {
    what: "曲路密码（Route Cipher）——把明文逐行填进一个矩阵，再按蛇形或垂直路由逐列读出，是一种不改变字符只打乱顺序的置换密码。",
    principle:
      "明文按行填入 cols 列的矩阵（grid[r][c] = text[r*cols + c]），再按列读出。两种路由：\n\n" +
      "snake（垂直蛇形，默认，CTF 最常见）：偶数列（第 1、3、5…列，索引 0、2、4…）从上往下读，奇数列从下往上读，逐列上下折返（boustrophedon）。\n\n" +
      "vertical（垂直）：所有列统一从上往下读。\n\n" +
      "解码时按同样的列数和路由把密文切回每列，再按行重组即得原文。保留全部字符（含空格、标点、中文），保证 encode→decode 100% 复原。",
    usage: "输入框填文本，参数 cols 设列数（默认 5），route 选路由（snake 蛇形 / vertical 垂直）。编码后字符不变只是顺序重排；解码填同样的 cols 和 route 即可还原。",
    examples: [
      { in: "HELLO", param: "cols=3, route=snake", out: "HLOEL", desc: "3列蛇形：H L 行 + E O 反读 + L" },
      { in: "HELLO", param: "cols=3, route=vertical", out: "HLEOL", desc: "3列垂直：列0 HL + 列1 EO + 列2 L" },
    ],
    tips: [
      "CTF 里看到一段字符没变但顺序乱的密文，且题目暗示「矩阵」「列」「路由」→ 想曲路密码。",
      "snake 是最常见的路由方式，列数 cols 是关键参数，需要枚举试。",
      "单列（cols=1）时读法即原文，无加密效果。",
    ],
    aka: ["route cipher", "曲路密码", "蛇形密码", "boustrophedon", "路由密码", "route transposition", "路线密码", "矩阵置换", "蛇形读取", "垂直路由", "route cipher decode", "曲路换位"],
  },

 // ============ classic: ROT 任意位移 ============
  rotSpecial: {
    what: "ROT 任意位移——ROT13 的泛化版，可指定任意位移量 N，在选定字母表上循环移位。",
    principle:
      "在长度 n 的循环表内做 (idx + shift) mod n 移位，decode 就是反向 -shift。三种字母表：\n\n" +
      "letters（默认）：大写在 A-Z(26) 内移、小写在 a-z(26) 内移，数字和符号原样保留。N=13 就是经典 ROT13。\n\n" +
      "alnum：额外让数字在 0-9(10) 内移（类比 rot18 = rot13 + rot5），字母和数字各自循环。\n\n" +
      "ascii94：全可打印 ASCII 0x21..0x7E(94) 内移（类比 rot47 的任意位移版），其余字符原样。",
    usage: "输入框填文本，参数 shift 填位移量（默认 13），alphabet 选字母表（letters / alnum / ascii94）。编码正向移位，解码自动反向移位。",
    examples: [
      { in: "ABC", param: "shift=13, alphabet=letters", out: "NOP", desc: "ROT13 经典位移" },
      { in: "abc123", param: "shift=1, alphabet=alnum", out: "bcd234", desc: "字母数字各自 +1" },
      { in: "abc", param: "shift=47, alphabet=ascii94", out: "234", desc: "全 ASCII 94 字符表内移 47（即 rot47，a→2 b→3 c→4）" },
    ],
    tips: [
      "不知道位移量时可以枚举 1-25 试一遍（letters 模式），肉眼看哪个像英文。",
      "ascii94 + shift=47 就是 ROT47，专治含数字和符号的密文。",
      "alnum 模式同时处理字母和数字，适合密文里数字也跟着变的场景。",
    ],
    aka: ["rot n", "rot任意位移", "caesar shift", "凯撒位移泛化", "rotN", "rot-n", "任意位移", "自定义位移", "rot任意", "shift cipher", "ROT13泛化", "任意ROT"],
  },

 // ============ text: 全角密码 ============
  fullwidth: {
    what: "全角密码——半角 ASCII 可打印字符 ↔ 全角字符的互转，密文看起来像一串全角符号但本质是 ASCII。",
    principle:
      "半角 ASCII 可打印字符 (0x21-0x7E) 加上偏移 0xFEE0 即得全角 (0xFF01-0xFF5E)。半角空格 0x20 特殊映射到全角空格 0x3000。其余字符（含中文、已全角字符）原样保留。\n\n" +
      "映射是一一对应，编解码严格可逆。等价于常见的「全角/半角互转」。",
    usage: "输入框填半角文本点编码得到全角串；输入全角串点解码还原半角。非 ASCII 可打印范围内的字符原样透传。",
    examples: [
      { in: "Hi", out: "Ｈｉ", desc: "H(0x48)→Ｈ(0xFF28), i(0x69)→ｉ(0xFF69)" },
      { in: "A B", out: "Ａ　Ｂ", desc: "空格 0x20 → 全角空格 0x3000" },
    ],
    tips: [
      "CTF 里看到一段「全角英文/数字」就是它，肉眼特征明显：字距宽、字符胖。",
      "全角空格 0x3000 比普通空格宽很多，是识别信号。",
      "和 Base 系列不同，这不是编码而是字符形态变换，没有压缩。",
    ],
    aka: ["fullwidth", "全角", "半角全角互转", "全角密码", "全角字符", "全半角转换", "全角编码", "fullwidth encode", "full-width", "全宽字符", "全角转半角", "半角转全角"],
  },

 // ============ classic: Chaocipher ============
  chaocipher: {
    what: "Chaocipher——John Byrne 1918 年发明、2010 年才公开算法的双转子置换密码。两个字母盘（左=密文盘，右=明文盘）每加密一个字符后按 zenith/nadir 规则动态置换，使密码非线性。",
    principle:
      "核心机制：两个各含 26 个不重复字母的盘（左盘输出密文，右盘输入明文）。\n" +
      "1. 在右盘找到明文字母 p，位置记为 pn\n" +
      "2. 取左盘同样位置 pn 的字母作为密文 c\n" +
      "3. 对两盘做 zenith 置换：以 pn 为中心，把盘分成两半互换\n" +
      "4. 对两盘做 nadir 置换：在 zenith 之后再以 nadir 位置（盘的对面）为中心做类似互换\n\n" +
      "每加密一个字符两盘都变，使得相同的明文字母在不同位置加密成不同的密文字母——这是它区别于传统多表替换（Vigenère）的关键。\n\n" +
      "默认盘为 Byrne 官方展品的字母表（STD_LEFT/STD_RIGHT），可自定义。仅处理 A-Z。",
    usage: "填左右盘（默认官方展品字母表），输入明文（A-Z）点编码得密文，输入密文点解码还原。非字母字符原样保留。",
    examples: [
      { in: "WELLDONEISBETTERTHANWELSAID", param: "默认盘", out: "OAHQHCNYNXTSZJRRHJBYHQKNEDC", desc: "Byrne 官方展品盘编码结果（实跑核对）" },
    ],
    formulas: [
      { tex: "c_i = \\text{left}[\\text{pos}_i],\\ \\text{盘}_{i+1} = \\text{zenith/nadir}(\\text{盘}_i)", caption: "每步两盘动态置换，使密码非线性" },
    ],
    tips: [
      "Chaocipher 沉寂 90 年才公开算法，是密码史上的著名谜题",
      "特征：相同明文字母在不同位置加密成不同密文字母，频率分析失效",
      "默认盘是 Byrne 官方展品字母表（HXUCZVAMDSLKPEFJRIGTWOBNYQ / PTLNBQDEOYSFAVZKGJRIHWXUMC），换盘即换密钥",
      "CTF 里出现 Chaocipher 通常会给盘的初始排列或提示",
    ],
    aka: ["chaocipher", "混沌密码", "双转子", "byrne cipher", "混沌密码机", "拜恩密码", "chao cipher", "双转子密码", "动态置换密码", "Byrne cipher", "查奥密码", "自动置换密码"],
  },

 // ============ classic: 跨界棋盘 ============
  straddleCheckerboard: {
    what: "跨界棋盘（Straddling checkerboard）——变长编码棋盘：8 个高频字母占单数字，其余字母占双数字，自定界无需分隔符即可解码。",
    principle:
      "3 行 × 10 列棋盘：\n" +
      "- 首行：8 个高频字母（如 ATONESIR）+ 2 个空列前缀位（如 2、6）\n" +
      "- 第 2 行：前缀 2 引出，填 10 个字母（B C D F G H J K L M）\n" +
      "- 第 3 行：前缀 6 引出，填 10 个字母（P Q U V W X Y Z . / ,）\n\n" +
      "编码规则：\n" +
      "- 首行字母 → 单数字（列号 0-9，跳过空列前缀位）\n" +
      "- 第 2 行字母 → 前缀 2 + 列号（如 B → 20）\n" +
      "- 第 3 行字母 → 前缀 6 + 列号（如 P → 60）\n\n" +
      "解码时遇到 2 或 6 就知道下一个数字是行内列号，其他数字直接是首行字母——无需分隔符自定界。\n\n" +
      "变长编码让高频字母更短（1 数字），低频字母更长（2 数字），整体比固定长度更紧凑，类似哈夫曼编码的思想。",
    usage: "填首行高频字母（默认 ATONESIR）、空列前缀（默认 2/6）、下两行字符（默认 20 个），输入明文点编码得数字串，输入数字串点解码还原。",
    examples: [
      { in: "ATTACKATDAWN", param: "默认棋盘 ATONESIR/26", out: "0110212701220644", desc: "Wikipedia 经典向量：A→0, T→1, T→1, A→0, C→21, K→27, A→0, T→1, D→22, A→0, W→60, N→4" },
    ],
    formulas: [
      { tex: "\\text{首行字母} \\to \\text{col},\\ \\text{其他} \\to \\text{prefix} + \\text{col}", caption: "变长编码：高频单数字，低频双数字" },
    ],
    tips: [
      "跨界棋盘是间谍密码学经典，二战期间被多个情报机构使用",
      "变长编码类似哈夫曼：高频字母短、低频字母长，整体更紧凑",
      "自定界特性：遇到前缀数字(2/6)就知道下一个数字是列号，无需分隔符",
      "可与一次性密码本(OTP)结合：先棋盘编码再 OTP 加密，是终极间谍密码",
      "CTF 里给一串数字 + 提示棋盘配置，就是跨界棋盘",
    ],
    aka: ["straddling checkerboard", "跨界棋盘", "变长棋盘", "straddle", "跨立棋盘", "间谍棋盘", "straddle checkerboard", "变长编码棋盘", "棋盘密码", "跨界棋盘密码", "spy checkerboard", "VIC密码棋盘"],
  },
};
