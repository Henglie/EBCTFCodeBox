// 科普内容分片：classic 后 7（adfgx/foursquare/graycode/trithemius/yuanYin/columnReplace/rowsReplace）。纯数据，无 import 无副作用。
export default {
  adfgx: {
    what: "ADFGX：一战德军战地密码，先用 5×5 方阵把每个字母转成两个 A/D/F/G/X 字母，再用关键词做列换位打乱。是 ADFGVX 的无数字版。",
    principle:
      "第一步「分数化」：25 字母（J 并入 I）排进 5×5 方阵，行列都用 A/D/F/G/X 标记，每个字母 → 两个标记字母，明文长度翻倍。\n\n" +
      "第二步「列换位」：把这串双字母按换位密钥的字母表顺序读列，彻底打散位置。选 A/D/F/G/X 是因为它们的摩斯码差异大，电报发送不易听错。",
    usage: "填 25 字母方阵表（默认标准表，J→I）和列换位密钥，粘密文（全是 ADFGX 五个字母）解码；编码方向反向。",
    examples: [
      { in: "HELLO", param: "方阵=默认, 密钥=BATTLE", out: "FFDAFGXFAA", desc: "先转 ADFGX 对，再列换位" },
    ],
    tips: [
      "密文只由 A D F G X 五个字母组成，一眼可认。带数字的兄弟版是 ADFGVX（6×6）。",
      "破解要同时攻方阵和换位两层，纯手工很难，通常靠已知明文或统计。",
    ],
    aka: ["adfgx", "战地密码", "德军密码", "ADFGX", "ADFGX cipher", "adfgx密码",
      "一战德军密码", "5x5方阵换位", "ADFGX加密", "无数字ADFGVX", "德军战地密码", "分数化换位密码"],
  },

  foursquare: {
    what: "四方密码（Four-square）：用两个 25 字母密钥方阵 + 两个标准方阵，成对加密字母。比 Playfair 更难，因为用了两个独立密钥表。",
    principle:
      "画四个 5×5 方阵排成田字：左上、右下是标准字母表，右上、左下是两个密钥方阵。\n\n" +
      "明文两两一组，第一个字母在左上定位、第二个在右下定位，取它们「行列交叉」落在两个密钥方阵里的字母作为密文。解密反向查。",
    usage: "填两个 25 字母密钥方阵（各不含 J），粘密文解码；编码方向反向。明文奇数长会补 X。",
    examples: [
      { in: "HELLO", param: "两个默认密钥方阵", out: "UNWXRK", desc: "两两一组交叉查表，末尾补 X" },
    ],
    tips: [
      "和 Playfair 一样是双字母替换，但用两张密钥表，频率分析更难。",
      "密文长度是偶数（奇数明文补了 X），字母全大写无数字。",
    ],
    aka: ["四方密码", "four-square", "foursquare", "田字密码", "Four-square", "four square cipher",
      "四方形密码", "4方密码", "Foursquare cipher", "双方阵密码", "四格密码", "Delastelle four-square"],
  },

  graycode: {
    what: "格雷码：一种相邻数值只差 1 个比特的二进制编码。这里把文本每字节转成 8 位二进制后，整体做格雷码变换，输出一长串 0/1。",
    principle:
      "先把文本按 UTF-8 转成二进制串。格雷码规则：第一位照抄，之后每一位 = 当前二进制位 $\\oplus$ 前一位（异或）。\n\n" +
      "解码反向：第一位照抄，之后每一位 = 当前格雷位 $\\oplus$ 已还原的前一位，逐位推回原二进制，再按字节转文本。",
    usage: "直接粘文本编码成格雷码 0/1 串；解码方向粘 0/1 串还原文本（非 0/1 字符会被忽略）。",
    examples: [
      { in: "A", out: "01100001", desc: "A=0x41=01000001，首位照抄后逐位异或" },
      { in: "Hi", out: "0110110001011101" },
    ],
    formulas: [
      { tex: "g_i = b_i \\oplus b_{i-1}", caption: "编码：格雷位 = 当前位异或前一位（g_0 = b_0）" },
      { tex: "b_i = g_i \\oplus b_{i-1}", caption: "解码：逐位推回原二进制" },
    ],
    tips: ["一长串 0/1、又不像直接的 ASCII 二进制时，试试当格雷码解一层。"],
    aka: ["格雷码", "gray code", "格雷编码", "循环码", "Gray code", "格莱码",
      "反射二进制码", "reflected binary", "格雷二进制", "gray编码", "单步码", "RBC码"],
  },

  trithemius: {
    what: "特里特米乌斯密码（Trithemius，1508）：维吉尼亚的雏形，没有密钥，第 i 个字母就固定往后移 i 位。是「渐进移位」多表密码的最早形式。",
    principle:
      "第 0 个字母移 0 位、第 1 个移 1 位、第 2 个移 2 位……第 $i$ 个字母 $c_i = (x_i + \\text{start} + i) \\bmod 26$。本工具的 start 是起始移位，默认 0 就是标准版。\n\n" +
      "可以看成密钥为 `ABCDEF...` 的维吉尼亚，位置本身就是移位量，所以不需要单独的密钥。",
    usage: "直接粘文本编码（可选起始移位 start，默认 0）；解码方向逐位减回。",
    examples: [
      { in: "HELLO", param: "start=0", out: "HFNOS", desc: "H+0, E+1, L+2, L+3, O+4" },
      { in: "abc", param: "start=0", out: "ace", desc: "a+0=a, b+1=c, c+2=e" },
    ],
    formulas: [
      { tex: "c_i = (x_i + \\text{start} + i) \\bmod 26", caption: "第 i 个字母（从 0 计）" },
    ],
    tips: ["无密钥、移位随位置递增，是识别它的关键。相当于密钥 ABCDE… 的维吉尼亚。"],
    aka: ["trithemius", "特里特米乌斯", "渐进移位", "tabula recta", "Trithemius", "trithemius cipher",
      "特里特米乌斯密码", "渐进密钥密码", "progressive key", "维吉尼亚雏形", "无密钥多表", "特里特米乌斯移位"],
  },

  yuanYin: {
    what: "元音密码：一套数字↔字母的映射。5 个元音 a/e/i/o/u 用单个数字 1-5 表示，辅音用两位数字（所属元音组 + 位序）。",
    principle:
      "元音 a=1, e=2, i=3, o=4, u=5。辅音按字母表分到各元音后面，用两位数：如 b=11, c=12, d=13（a 组），f=21, g=22, h=23（e 组），依此类推到 z=55。\n\n" +
      "解码时按分隔符切成一个个数字再查表；编码时把字母映射回数字，用分隔符连接。",
    usage: "粘数字串（可用空格、逗号、点分隔）解码成字母；编码方向把文本转数字（默认空格分隔，可改分隔符）。",
    examples: [
      { in: "23 3", out: "hi", desc: "23=h（e 组第 3 个）, 3=i" },
      { in: "12 1 45", out: "cat", desc: "12=c, 1=a, 45=t" },
    ],
    tips: [
      "一串 1-5 打头的一两位数字、又能整齐切分，试元音密码。",
      "单个 1-5 是元音，两位数首位 1-5 指示所属元音组。",
    ],
    aka: ["元音密码", "yuanyin", "vowel cipher", "元音表", "元音编码", "yuan yin",
      "元音辅音编码", "元音分组密码", "vowel code", "数字元音密码", "元音数字映射", "元音字母表"],
  },

  columnReplace: {
    what: "列置换密码：把明文按固定列数排成表格，再按密钥字母的排序顺序一列一列读出来。是列换位的一种写法。",
    principle:
      "密钥每个字母决定一列。先把密钥字母排序，得到每列的读取先后（`ZEBRA` 排序后 A<B<E<R<Z，对应原列的新次序）。\n\n" +
      "明文按行填入 keylen 列的表格（不足补空格），再按排序次序逐列拼接读出。解密时按列长切回、恢复原列序、逐行读。",
    usage: "填密钥（建议无重复字母，默认 ZEBRA），粘密文解码；编码方向反向。明文会补空格到密钥长度整数倍。",
    examples: [
      { in: "HELLOWORLD", param: "密钥=ZEBRA", out: "ODLREOLLHW", desc: "按 ZEBRA 字母序读列" },
    ],
    tips: [
      "换位密码——字母没变只是顺序乱了，频率分布和明文一样。",
      "和「行置换」区别：这个是整体排表后按列读，行置换是每块内单独重排。",
    ],
    aka: ["列置换", "columnar", "列换位", "column transposition", "列置换密码", "columnar transposition",
      "列排序密码", "按列读取密码", "列换位密码", "keyed columnar", "密钥列置换", "表格列置换"],
  },

  rowsReplace: {
    what: "行置换密码：把明文每 keylen 个字符切成一块，在每一块内部按密钥字母的排序顺序重新排列。打乱范围只在块内。",
    principle:
      "密钥字母排序后得到块内的重排次序 ids。把明文按 keylen 切块，每块内的字符按 ids 重新摆放。\n\n" +
      "比如密钥 `KEY`，排序 E<K<Y 对应原位置 [1,0,2]，每 3 个字符按这个次序重排。解密用逆置换还原。",
    usage: "填密钥（默认 KEY），粘密文解码；编码方向反向。明文会补空格到密钥长度整数倍。",
    examples: [
      { in: "HELLO", param: "密钥=KEY", out: "EHLOL ", desc: "每 3 字符块内按 E<K<Y 次序重排，末块补空格" },
    ],
    tips: [
      "块内重排、块之间不混，是它和列置换的关键区别。",
      "密钥长度就是分块大小，观察密文能否整齐分块能帮你猜 keylen。",
    ],
    aka: ["行置换", "rows replace", "行换位", "块内重排", "行置换密码", "行换位密码",
      "row transposition", "块内置换", "分块重排密码", "rows replacement", "行内重排密码", "按行置换"],
  },
};
