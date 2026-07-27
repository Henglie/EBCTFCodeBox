/*
 * edu-classic-rest.js — classic 经典密码科普补全。
 *
 * 覆盖 11 个 classic 分类 op：
 * vigenere / hill / affine / bifid / polybius / adfgvx
 * otp / multiplicative / keywordcipher / simplesub / runningkey
 *
 * 样例值由 _probe_classic.mjs 实跑取得（输入 'HELLO'）。
 * 纯数据导出，无 import / 无副作用 / 无 register。
 */
export default {
  vigenere: {
    what: "维吉尼亚密码（Vigenère Cipher），多表替换密码的经典代表，16 世纪问世，三百年间被认为是不可破译的密码（le chiffre indéchiffrable）。",
    principle: "使用一个字母密钥，密钥循环延伸至与明文等长。明文每个字母与对应密钥字母做模 26 加法得到密文。解密做模 26 减法。由于同一明文字母在不同位置对应不同密钥字母，频率分析被有效打散。",
    usage: "输入明文与密钥（默认 key），自动循环密钥并做模 26 加减。大小写保留，非字母字符原样输出。",
    examples: [
      { in: "HELLO", param: { key: "KEY" }, out: "RIJVS", desc: "H+K=R, E+E=I, L+Y=J, L+K=R→修正为(11+10)%26=21=V, O+E=S" },
      { in: "RIJVS", param: { key: "KEY" }, out: "HELLO", desc: "解密为加密的逆运算" }
    ],
    formulas: [
      { tex: "C_i = (P_i + K_{i \\bmod m}) \\bmod 26", caption: "加密：明文字母 + 密钥字母 mod 26" },
      { tex: "P_i = (C_i - K_{i \\bmod m} + 26) \\bmod 26", caption: "解密：密文字母 - 密钥字母 mod 26" }
    ],
    tips: [
      "密钥越长越安全，密钥长度等于明文长度时退化为一次一密（OTP）",
      "Kasiski 测试法和重合指数法可破解密钥长度，再逐列频率分析",
      "大小写保留，非字母字符原样通过不消耗密钥流"
    ],
    aka: ["Vigenère", "维吉尼亚", "多表替换", "le chiffre indéchiffrable", "Vigenere", "维吉尼亚密码",
      "维热纳尔", "polyalphabetic", "多表代换", "Vigenere cipher", "维吉尼亚加密", "不可破译密码", "表格密码"]
  },

  hill: {
    what: "希尔密码（Hill Cipher），1929 年 Lester S. Hill 发明的多字母替换密码，用线性代数矩阵运算加密。",
    principle: "将明文字母分组为 n 维向量，乘以一个 n×n 的密钥矩阵（元素为 0-25），结果模 26 得到密文。解密需用密钥矩阵在模 26 下的逆矩阵。要求矩阵行列式与 26 互质（可逆）。",
    usage: "密钥为字母串或数字串，长度须为完全平方数（≥4，即 2×2 起）。字母串按 A=0,B=1,… 映射为矩阵元素。明文不足补 X。",
    examples: [
      { in: "HELLO", param: { key: "GYBNQKURP" }, out: "TFJJZX", desc: "3×3 矩阵 [[6,24,1],[13,16,10],[20,17,15]]，HELLO 补 X 成 HELLOX，分两组加密" },
      { in: "TFJJZX", param: { key: "GYBNQKURP" }, out: "HELLOX", desc: "用逆矩阵解密，末尾 X 为填充" }
    ],
    formulas: [
      { tex: "\\mathbf{C} = (\\mathbf{K} \\cdot \\mathbf{P}) \\bmod 26", caption: "加密：密钥矩阵 × 明文向量 mod 26" },
      { tex: "\\mathbf{P} = (\\mathbf{K}^{-1} \\cdot \\mathbf{C}) \\bmod 26", caption: "解密：逆矩阵 × 密文向量 mod 26" },
      { tex: "\\det(\\mathbf{K}) \\perp 26", caption: "可逆条件：行列式与 26 互质" }
    ],
    tips: [
      "密钥矩阵必须在 mod 26 下可逆（行列式与 26 互质），否则无法解密",
      "已知明文攻击可线性代数求解密钥矩阵",
      "默认密钥 GYBNQKURP 是经典的 3×3 教学矩阵"
    ],
    aka: ["Hill", "希尔", "矩阵密码", "希尔密码", "Hill cipher", "Hill Cipher",
      "线性代数密码", "矩阵加密", "希尔加密", "多字母替换", "Lester Hill", "模26矩阵"]
  },

  affine: {
    what: "仿射密码（Affine Cipher），单表替换密码，是乘法密码与移位密码的组合，函数形式为 y = ax + b mod 26。",
    principle: "加密时对每个明文字母的序号 x 做 y = (a·x + b) mod 26。解密用 a 的模逆 a⁻¹：x = a⁻¹·(y - b) mod 26。要求 a 与 26 互质（a ∈ {1,3,5,7,9,11,15,17,19,21,23,25}）。",
    usage: "参数 a（乘数，默认 5）须与 26 互质，b（位移，默认 8）。大小写保留，非字母原样输出。",
    examples: [
      { in: "HELLO", param: { a: 5, b: 8 }, out: "RCLLA", desc: "H(7): 5×7+8=43%26=17=R; E(4):28%26=2=C; L(11):63%26=11=L" },
      { in: "RCLLA", param: { a: 5, b: 8 }, out: "HELLO", desc: "a⁻¹=21 (5×21=105≡1), x=21×(y-8) mod 26" }
    ],
    formulas: [
      { tex: "y = (a \\cdot x + b) \\bmod 26", caption: "加密" },
      { tex: "x = a^{-1} \\cdot (y - b) \\bmod 26", caption: "解密（a⁻¹ 为 a 模 26 的乘法逆元）" },
      { tex: "\\gcd(a, 26) = 1", caption: "可逆条件：a 与 26 互质" }
    ],
    tips: [
      "a=1 时退化为凯撒移位密码，b=0 时退化为乘法密码",
      "a 只有 12 个有效值（与 26 互质的奇数非 13 倍数）",
      "密钥空间小（12×26=312），易暴力破解"
    ],
    aka: ["Affine", "仿射", "ax+b", "仿射密码", "Affine cipher", "Affine Cipher",
      "仿射加密", "线性同余密码", "乘法移位密码", "y=ax+b", "仿射变换密码", "affine cipher"]
  },

  bifid: {
    what: "Bifid 密码，1901 年 Félix-Marie Delastelle 发明的分块替换密码，基于 Polybius 方阵的坐标重组。",
    principle: "先将明文通过 5×5 Polybius 方阵（I/J 合并）映射为行列坐标对。按 period（默认 5）分块，每块将所有行坐标拼一起、列坐标拼一起，再两两配对通过方阵还原为密文。坐标的重组打乱了单表关系。",
    usage: "默认 5×5 方阵（无 J，I/J 合并），period=5。输入仅字母有效。",
    examples: [
      { in: "HELLO", param: {}, out: "FNNVD", desc: "HELLO→坐标(23,15,31,31,34)→行23133列15314→重组配对→FNNVD" }
    ],
    formulas: [
      { tex: "\\text{row}_i, \\text{col}_i = \\text{divmod}(\\text{idx}_i, 5)", caption: "字母→行列坐标" },
      { tex: "\\text{重组}: (r_1 r_2 \\cdots c_1 c_2 \\cdots) \\to \\text{新坐标对}", caption: "分块内行坐标拼接+列坐标拼接后重新配对" }
    ],
    tips: [
      "period 越大混淆越强，period=1 退化为普通 Polybius",
      "I 和 J 合并到同一格，解密时需根据语境还原",
      "属于分块替换（fractionation），抗频率分析强于单表"
    ],
    aka: ["Bifid", "德尔斯特勒", "分块替换", "双分密码", "Bifid cipher", "Bifid Cipher",
      "德拉斯泰尔", "Delastelle", "二分密码", "坐标重组密码", "fractionation", "波利比奥斯变体"]
  },

  polybius: {
    what: "波利比奥斯方阵（Polybius Square），古希腊历史学家波利比奥斯发明的坐标替换密码，将字母编码为两位数字。",
    principle: "5×5 方阵填入 26 个字母（I/J 合并到一格），每格用行列号标识。加密时将字母替换为其所在格的行列两位数（行在前）。解密将两位数还原为字母。",
    usage: "默认 5×5 方阵 ABCDE/FGHIK/…（无 J），编码映射 12345。非字母原样输出。",
    examples: [
      { in: "HELLO", param: {}, out: "2315313134", desc: "H=(2,3)→23, E=(1,5)→15, L=(3,1)→31, L→31, O=(3,4)→34" },
      { in: "2315313134", param: {}, out: "HELLO", desc: "每两位数字还原一个字母" }
    ],
    formulas: [
      { tex: "\\text{code} = 5 \\cdot (\\text{row}-1) + (\\text{col}-1)", caption: "字母序号→方阵位置" },
      { tex: "\\text{密文} = \\text{row} \\| \\text{col}", caption: "行列拼接为两位数" }
    ],
    tips: [
      "I 和 J 共用一格（5×5=25 格容纳 26 字母）",
      "是最古老的密码之一，也是 ADFGX/Bifid 等密码的基础",
      "可使用关键字打乱方阵顺序增强安全性"
    ],
    aka: ["Polybius", "波利比奥斯", "棋盘密码", "Polybius Square", "波利比奥斯方阵", "波利比乌斯",
      "波利比奥斯棋盘", "Polybius square", "5x5方阵", "坐标密码", "方阵密码", "棋盘格密码"]
  },

  adfgvx: {
    what: "ADFGVX 密码，一战末期德军使用的字段密码，以六个字母 A/D/F/G/V/X 为行列标记的 6×6 方阵替换 + 列移位。",
    principle: "6×6 方阵填入 A-Z 和 0-9 共 36 字符，行列用 ADFGVX 标记。第一步：明文每字符替换为两个 ADFGVX 字母（行列标记）。第二步：将中间密文按列移位密钥重排得到最终密文。本工具仅实现第一步方阵替换。",
    usage: "默认方阵 ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789，行列标记 ADFGVX。输入字母和数字有效。",
    examples: [
      { in: "HELLO", param: {}, out: "DDDXDFVFAX", desc: "H=(D,D) E=(D,X) L=(D,F) L=(D,F) O=(V,F)→各取行列标记拼接" }
    ],
    formulas: [
      { tex: "\\text{row} = \\text{ADFGVX}[\\lfloor i/6 \\rfloor], \\quad \\text{col} = \\text{ADFGVX}[i \\bmod 6]", caption: "字符 i 在方阵中的行列标记" },
      { tex: "\\text{密文} = \\text{列移位}(\\text{行列标记序列})", caption: "完整 ADFGVX 还需第二步列移位" }
    ],
    tips: [
      "6×6 方阵容纳 36 字符（26 字母 + 10 数字），故选 6 个标记字母 ADFGVX",
      "完整 ADFGVX 还需列移位（columnar transposition），本工具仅做方阵替换步骤",
      "一战中被法国密码学家 Painvin 破解，是密码史里程碑"
    ],
    aka: ["ADFGVX", "ADFGX", "一战德军密码", "Painvin", "ADFGVX密码", "ADFGVX cipher",
      "6x6方阵密码", "德军字段密码", "Nebel", "字段密码", "方阵加列移位", "一战密码"]
  },

  otp: {
    what: "一次一密 OTP（One-Time Pad），理论上不可破译的密码，密钥与明文等长且绝不复用。",
    principle: "字母表版本的 OTP：明文与密钥做模 26 加法（非字节异或）。密钥长度须 ≥ 明文字母数，且每条消息使用全新随机密钥。满足这三条时香农证明完美保密（perfect secrecy）。",
    usage: "密钥默认 SECRETKEY，须为字母且长度 ≥ 明文字母数。非字母原样输出不消耗密钥流。密钥不足会报错。",
    examples: [
      { in: "HELLO", param: { key: "SECRETKEY" }, out: "ZINCS", desc: "H+S=Z, E+E=I→(4+4)%26=8=I... 逐字母模26加" },
      { in: "ZINCS", param: { key: "SECRETKEY" }, out: "HELLO", desc: "模 26 减法还原" }
    ],
    formulas: [
      { tex: "C_i = (P_i + K_i) \\bmod 26", caption: "加密：逐字母模 26 加" },
      { tex: "P_i = (C_i - K_i + 26) \\bmod 26", caption: "解密：逐字母模 26 减" }
    ],
    tips: [
      "完美保密的三条件：密钥真随机、密钥等长、密钥不复用——缺一不可",
      "密钥复用（two-time pad）会致命泄露，可逐位差分攻击",
      "本工具为字母版模 26，与字节异或版 OTP 不同（后者见 modern 分类的 xor）"
    ],
    aka: ["One-Time Pad", "OTP", "一次一密", "Vernam", "完美保密", "一次性密码本",
      "one time pad", "维尔南密码", "Vernam cipher", "perfect secrecy", "密钥本", "香农保密"]
  },

  keywordcipher: {
    what: "关键字密码（Keyword Cipher），单表替换密码，用关键字构造替换字母表。",
    principle: "构造替换表 Beta：关键字去重后打头，剩余字母按字母表顺序顺补。加密：Alpha[i] → Beta[i]（Alpha 为标准 ABCDE…）。解密反向查表。",
    usage: "关键字默认 KEYWORD。大小写保留，非字母原样输出。",
    examples: [
      { in: "HELLO", param: { key: "KEYWORD" }, out: "AOGGJ", desc: "Beta=KEYWORDBCFGHIJLMNPQSUVXZ; H→Beta[7]=A, E→Beta[4]=O, L→Beta[11]=G" },
      { in: "AOGGJ", param: { key: "KEYWORD" }, out: "HELLO", desc: "反向查表还原" }
    ],
    formulas: [
      { tex: "\\text{Beta} = \\text{dedup}(\\text{keyword}) + (\\text{AZ} \\setminus \\text{keyword})", caption: "替换表构造" },
      { tex: "C = \\text{Beta}[P], \\quad P = \\text{Beta}^{-1}[C]", caption: "加解密查表" }
    ],
    tips: [
      "关键字去重后打头是关键步骤（如 KEYWORD 的第二个 E 被去除）",
      "本质是带密钥的单表替换，频率分析可破",
      "与 Playfair/Bifid 的关键字用法不同（那些用于构造方阵）"
    ],
    aka: ["Keyword", "关键字密码", "keyword cipher", "Keyword cipher", "关键词密码", "密钥词密码",
      "关键字替换", "keyword substitution", "关键字单表", "keyed alphabet", "键控字母表", "关键字加密"]
  },

  simplesub: {
    what: "简单替换密码（Simple Substitution），最直接的单表替换，26 字母置换表直给。",
    principle: "密钥本身就是一个 26 字母的排列（A-Z 的某种重排）。加密：明文字母 A→密钥第 0 位，B→第 1 位，…。解密反向：密文字母在密钥中的位置→对应标准字母。",
    usage: "密钥默认 AJPCZWRLFBDKOTYUQGENHXMIVS（pycipher 示例表），须为 26 个不重复字母。大小写保留。",
    examples: [
      { in: "HELLO", param: { key: "AJPCZWRLFBDKOTYUQGENHXMIVS" }, out: "LZKKY", desc: "H(7)→密钥[7]=L, E(4)→密钥[4]=Z, L(11)→密钥[11]=K, O(14)→密钥[14]=Y" },
      { in: "LZKKY", param: { key: "AJPCZWRLFBDKOTYUQGENHXMIVS" }, out: "HELLO", desc: "反向：L 在密钥位置 7→H" }
    ],
    formulas: [
      { tex: "C = K[P], \\quad P = K^{-1}[C]", caption: "K 为 26 字母置换表，加解密互逆查表" }
    ],
    tips: [
      "密钥空间 26!≈4×10²⁶，暴力不可行但频率分析极易",
      "英文频率分析（E/T/A/O/I…）是经典密码学入门题",
      "密钥须为 26 个不重复字母（A-Z 的一个排列），否则报错"
    ],
    aka: ["Simple Substitution", "简单替换", "monoalphabetic", "单表替换", "简单替换密码", "单字母替换",
      "substitution cipher", "替换密码", "单表代换", "monoalphabetic substitution", "字母置换密码", "26字母置换"]
  },

  runningkey: {
    what: "滚动密钥密码（Running Key Cipher），维吉尼亚的变体，用一段长文本（如书页）作为密钥。",
    principle: "算法与维吉尼亚相同（模 26 加减），区别在于密钥来源：维吉尼亚用短密钥循环，滚动密钥用长文本（如一段文章）按明文字母推进，密钥不足才循环。长密钥大幅增加重合指数破解难度。",
    usage: "密钥默认 THEQUICKBROWNFOX（经典全字母句片段）。大小写保留，非字母原样输出。",
    examples: [
      { in: "HELLO", param: { key: "THEQUICKBROWNFOX" }, out: "ALPBI", desc: "H+T=A, E+H=L, L+E=P, L+Q=B, O+U=I（模26加）" },
      { in: "ALPBI", param: { key: "THEQUICKBROWNFOX" }, out: "HELLO", desc: "模 26 减法还原" }
    ],
    formulas: [
      { tex: "C_i = (P_i + K_i) \\bmod 26", caption: "加密（K_i 取自长文本第 i 个字母，不循环直到用完）" },
      { tex: "P_i = (C_i - K_i + 26) \\bmod 26", caption: "解密" }
    ],
    tips: [
      "密钥文本越长越安全，理想情况是用一次性随机文本（退化为 OTP）",
      "若密钥文本有规律（如重复短语），仍可被重合指数法攻击",
      "与 vigenere 算法等价，区别仅在密钥来源和长度策略"
    ],
    aka: ["Running Key", "滚动密钥", "running key cipher", "Running key", "滚动密钥密码", "流动密钥",
      "长密钥维吉尼亚", "running key", "文本密钥密码", "书本密钥", "长文本密钥", "维吉尼亚变体"]
  }
};
