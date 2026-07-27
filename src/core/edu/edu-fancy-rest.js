/*
 * edu-fancy-rest.js — fancy 花式编码科普补全。
 * 覆盖 55 个 fancy 分类 op。
 * 样例值由 _probe_fancy.mjs 实跑取得。
 * 纯数据导出，无 import / 无副作用 / 无 register。
 */
export default {
  morse: {
    what: "摩尔斯电码，用点（·）和划（−）表示字母与数字",
    principle: "国际摩尔斯电码为每个字母/数字定义唯一的点划组合，字母间以空格分隔，通过短信号（点）与长信号（划）的长短组合传递信息",
    usage: "无参数，双向 encode/decode，输入文本自动识别方向",
    examples: [{ in: "SOS", param: {}, out: "... --- ...", desc: "求救信号 SOS 的摩尔斯编码，三短三长三短" }],
    formulas: [{ tex: "\\text{Morse}(c) \\in \\{\\cdot, -\\}^{+}", caption: "每个字符映射为点划序列" }],
    tips: ["点为 1 单位时长，划为 3 单位时长", "字母间隔 3 单位，单词间隔 7 单位", "SOS 是最易识别的求救码"],
    aka: ["国际摩尔斯电码", "Morse code", "摩斯电码", "摩尔斯电码", "摩斯密码", "Morse", "莫尔斯电码", "点划码", "电报码", "SOS", "point dash", "国际电码"]
  },
  bacon: {
    what: "培根密码，用 a/b 五位组合表示字母",
    principle: "将每个字母编码为 5 位 a/b 序列（a=点，b=划），26 版本 I/J 同码、U/V 同码，24 版本区分全部字母",
    usage: "params: version(26/24，默认26)，双向 encode/decode",
    examples: [{ in: "HELLO", param: { version: 26 }, out: "aabbb aabaa ababb ababb abbba", desc: "26 版本培根编码，H=aabbb, E=aabaa, L=ababb" }],
    formulas: [{ tex: "\\text{Bacon}(c) = \\text{bin}_5(\\text{idx}(c))", caption: "字母序号转 5 位二进制，0→a, 1→b" }],
    tips: ["26 版本共 24 组（I/J、U/V 合并）", "24 版本区分 26 个字母", "可隐藏于任意两种字体差异中"],
    aka: ["培根密码", "Bacon cipher", "培根加密", "Baconian cipher", "Bacon's cipher", "培根隐写", "双字母隐写", "abab编码", "Francis Bacon", "弗朗西斯培根", "字体隐写", "biliteral cipher"]
  },
  railFence: {
    what: "栅栏密码，沿锯齿形轨道排列字母",
    principle: "明文按 Z 字形沿 rails 条轨道书写，再逐行读取密文；解密按轨道周期还原位置",
    usage: "params: rails(默认2)，双向 encode/decode",
    examples: [{ in: "HELLO", param: { rails: 2 }, out: "HLOEL", desc: "2 条轨道：H/L/O 在上，E/L 在下，合并为 HLOEL" }],
    formulas: [{ tex: "T = 2(r-1)", caption: "周期 T 由轨道数 r 决定，同列位置呈对称分布" }],
    tips: ["rails=2 等价于奇偶位分离", "rails 越大锯齿越陡", "需与接收方约定轨道数"],
    aka: ["栅栏密码", "Rail Fence cipher", "篱笆密码", "锯齿密码", "railfence", "rail fence", "zigzag cipher", "Z字形密码", "W型密码", "换位密码", "栏栅密码", "曲折密码"]
  },
  caesar: {
    what: "凯撒密码，字母表整体位移替换",
    principle: "每个字母按固定位移量 shift 在字母表内循环移动，移位量即密钥",
    usage: "params: shift(默认3)，双向 encode/decode",
    examples: [{ in: "HELLO", param: { shift: 3 }, out: "KHOOR", desc: "位移 3：H→K, E→H, L→O, L→O, O→R" }],
    formulas: [{ tex: "E_n(x) = (x + n) \\bmod 26", caption: "字母序号 x 加位移 n 模 26" }],
    tips: ["shift=13 即 ROT13", "仅 25 种有效密钥，易暴力破解", "仅替换字母，非字母字符不变"],
    aka: ["凯撒密码", "Caesar cipher", "恺撒密码", "Caesar shift", "移位密码", "shift cipher", "凯撒移位", "Caesar", "字母位移密码", "凯撒加密", "位移替换密码", "ROT-N"]
  },
  rot13: {
    what: "ROT13，字母表位移 13 的自反替换",
    principle: "每个字母移动 13 位，由于字母表共 26 位，再位移 13 即还原，故 encode=decode",
    usage: "无参数，自反；再次应用即解密",
    examples: [{ in: "HELLO", param: {}, out: "URYYB", desc: "H→U, E→R, L→Y, L→Y, O→B" }],
    formulas: [{ tex: "E(x) = (x + 13) \\bmod 26", caption: "位移 13，自反：E(E(x))=x" }],
    tips: ["自反性：再转一次即明文", "常用于隐藏剧透/谜底", "不处理数字与符号"],
    aka: ["ROT13", "回转13", "rot 13", "rot-13", "ROT-13", "旋转13", "位移13密码", "凯撒13", "rotate13", "自反凯撒", "ROT13解码", "字母表旋转13"]
  },
  rot5: {
    what: "ROT5，数字位移 5 的自反替换",
    principle: "每个数字字符移动 5 位（0-9 循环），再位移 5 即还原",
    usage: "无参数，自反；仅作用于数字 0-9",
    examples: [{ in: "12345", param: {}, out: "67890", desc: "1→6, 2→7, 3→8, 4→9, 5→0" }],
    formulas: [{ tex: "E(d) = (d + 5) \\bmod 10", caption: "数字 d 加 5 模 10，自反" }],
    tips: ["自反性：再转一次即还原", "仅处理数字字符", "常与 ROT13 组合成 ROT18"],
    aka: ["ROT5", "数字位移5", "rot 5", "rot-5", "ROT-5", "旋转5", "数字ROT", "digit rotate 5", "数字回转5", "0-9位移", "ROT5解码", "数字移位密码"]
  },
  rot18: {
    what: "ROT18，对字母 ROT13、对数字 ROT5 的组合",
    principle: "字母用 ROT13、数字用 ROT5 分别替换，合并后自反",
    usage: "无参数，自反；字母与数字同时处理",
    examples: [{ in: "ABC123", param: {}, out: "NOP678", desc: "字母 ABC→NOP，数字 123→678" }],
    formulas: [{ tex: "E(c) = \\begin{cases} (c+13)\\bmod 26 & \\text{字母} \\\\ (c+5)\\bmod 10 & \\text{数字} \\end{cases}", caption: "字母走 ROT13，数字走 ROT5" }],
    tips: ["自反：再转一次即还原", "ROT13 + ROT5 的组合", "对符号无效"],
    aka: ["ROT18", "组合位移", "rot 18", "rot-18", "ROT-18", "ROT13+ROT5", "字母数字位移", "旋转18", "ROT18解码", "混合ROT", "字母数字混合位移", "ROT13加ROT5"]
  },
  rot47: {
    what: "ROT47，可打印 ASCII 位移 47 的自反替换",
    principle: "对 ASCII 33-126 共 94 个可打印字符整体位移 47（模 94），再位移 47 即还原",
    usage: "无参数，自反；覆盖所有可打印 ASCII",
    examples: [{ in: "Hello", param: {}, out: "w6==@", desc: "H→w, e→6, l→=, l→=, o→@" }],
    formulas: [{ tex: "E(x) = ((x - 33 + 47) \\bmod 94) + 33", caption: "可打印 ASCII 区间内位移 47" }],
    tips: ["自反：再转一次即还原", "覆盖字母、数字、符号全部可打印 ASCII", "比 ROT13 更强，可处理符号"],
    aka: ["ROT47", "ASCII位移47", "rot 47", "rot-47", "ROT-47", "旋转47", "可打印ASCII位移", "ASCII ROT", "ROT47解码", "94字符位移", "符号位移密码", "ASCII rotate 47"]
  },
  atbash: {
    what: "埃特巴什密码，字母表镜像翻转替换",
    principle: "A↔Z, B↔Y, C↔X… 将字母表首尾对调，映射为序号 25-x",
    usage: "无参数，自反；再次应用即还原",
    examples: [{ in: "HELLO", param: {}, out: "SVOOL", desc: "H↔S, E↔V, L↔O, L↔O, O↔L" }],
    formulas: [{ tex: "E(x) = 25 - x", caption: "字母序号取镜像，自反" }],
    tips: ["自反：再转一次即还原", "希伯来字母原始版本同理", "无密钥，安全性低"],
    aka: ["埃特巴什密码", "Atbash cipher", "Atbash", "阿特巴希密码", "镜像密码", "字母表反转", "希伯来密码", "首尾对调密码", "atbash解码", "反字母表密码", "埃特巴什", "字母镜像替换"]
  },
  a1z26: {
    what: "A1Z26，字母转序号（A=1, B=2, …, Z=26）",
    principle: "直接以字母在字母表中的位置作为编码，空格分隔",
    usage: "无参数，双向 encode/decode",
    examples: [{ in: "ABC", param: {}, out: "1 2 3", desc: "A=1, B=2, C=3" }],
    formulas: [{ tex: "E(c) = \\text{idx}(c) + 1", caption: "字母序号从 1 开始" }],
    tips: ["最朴素的字母编码", "常作为其他密码的中间步骤", "区分大小写需约定"],
    aka: ["A1Z26", "字母序号编码", "a1z26", "A1Z26 cipher", "字母表位置", "letter number cipher", "字母编号", "A=1密码", "字母数字对应", "序号密码", "letter to number", "字母位置编码"]
  },
  dna: {
    what: "DNA 编码，字母转 DNA 三联密码子",
    principle: "将字母序号转为二进制后映射为 A/T/C/G 四进制三联体（类似生物密码子）",
    usage: "无参数，双向 encode/decode",
    examples: [{ in: "AB", param: {}, out: "CGG CGT", desc: "A=CGG, B=CGT，三联 DNA 碱基" }],
    formulas: [{ tex: "\\text{DNA}(c) = \\text{base}_4^3(\\text{idx}(c))", caption: "字母序号转 4 进制 3 位，映射 ATCG" }],
    tips: ["每个字母对应 3 个碱基", "碱基符号可自定义", "灵感源于生物遗传密码"],
    aka: ["DNA 密码", "DNA cipher", "DNA编码", "DNA encoding", "碱基编码", "ATCG编码", "DNA密码子", "基因密码", "核苷酸编码", "DNA codon", "碱基密码", "生物密码"]
  },
  keyboard: {
    what: "键盘坐标编码，QWERTY 三行键盘的行列号",
    principle: "按标准 QWERTY 键盘三行布局，每个键映射为(行.列)坐标",
    usage: "无参数(QWERTY 3 行坐标)，双向 encode/decode",
    examples: [{ in: "HI", param: {}, out: "26 18", desc: "H=第2行第6列=26, I=第1行第8列=18" }],
    formulas: [{ tex: "E(c) = (\\text{row}, \\text{col})", caption: "键在键盘上的行列位置" }],
    tips: ["以 QWERTY 标准布局为准", "行号自上而下 1-3", "坐标无分隔即连写"],
    aka: ["键盘坐标", "Keyboard coordinate", "键盘密码", "QWERTY坐标", "键盘行列", "keyboard cipher", "键位坐标", "键盘位置编码", "行列键盘码", "keyboard coord", "三行键盘坐标", "键盘映射"]
  },
  brainfuck: {
    what: "Brainfuck，极简指令式编程语言",
    principle: "仅 8 个指令 + - > < . , [ ]，操作一维字节数组与指针，+ 增加当前单元值，. 输出",
    usage: "无参数，双向 encode(生成代码)/decode(执行代码)",
    examples: [{ in: "Hi", param: {}, out: "++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++.+++++++++++++++++++++++++++++++++..", desc: "72 个 + 设置单元为 72(H)，. 输出，再加 33 个 + 至 105(i)，. 输出" }],
    formulas: [{ tex: "\\text{cell} += 1\\ (\\text{当} +),\\ \\text{output}(\\text{cell})\\ (\\text{当} .)", caption: "+ 增单元，. 输出单元当前值" }],
    tips: ["8 指令：+ - > < . , [ ]", "单元为 8 位字节（0-255）", "图灵完备，但极难阅读"],
    aka: ["Brainfuck", "BF 语言", "brainfuck", "BF", "脑残语言", "布莱恩福克", "b***fuck", "极简语言", "esoteric language", "深奥编程语言", "图灵完备语言", "八指令语言"]
  },
  ook: {
    what: "Ook! 语言，Brainfuck 的变体，三字指令 Ook./Ook?/Ook!",
    principle: "将 Brainfuck 的 8 指令两两组合成 Ook. / Ook? / Ook! 三种符号对，语义等价",
    usage: "无参数，双向 encode/decode",
    examples: [{ in: "Hi", param: {}, out: "Ook. Ook. ... Ook!", desc: "Ook! 序列等价于 Brainfuck 程序" }],
    formulas: [{ tex: "\\text{Ook!} \\equiv \\text{Brainfuck}", caption: "Ook! 指令对与 Brainfuck 指令一一对应" }],
    tips: ["三符号 Ook./Ook?/Ook! 两两配对", "完全等价于 Brainfuck", "趣味性语言，猿语风格"],
    aka: ["Ook!", "猩猩语", "Ook", "ook语言", "猿语", "红毛猩猩语", "Brainfuck变体", "Ook. Ook? Ook!", "orangutan language", "三字指令语言", "BF变体", "深奥语言Ook"]
  },
  cetacean: {
    what: "Cetacean 鲸语，二进制以 e/E 表示",
    principle: "0 与 1 分别用 e 与 E 表示，将字符 ASCII 二进制展开为 e/E 序列",
    usage: "无参数(1→E, 0→e)；输入二进制/文本",
    examples: [{ in: "Hi", param: {}, out: "EEEEEEEEEeEEeEEEEEEEEEEEEeeEeEEe", desc: "H=01001000, i=01101001，转 e/E 序列" }],
    formulas: [{ tex: "E(b) = \\begin{cases} E & b=1 \\\\ e & b=0 \\end{cases}", caption: "二进制位 1→E, 0→e" }],
    tips: ["1→E（大写）, 0→e（小写）", "本质是二进制可视化", "鲸鱼叫声风格的编码"],
    aka: ["鲸语", "Cetacean", "cetacean", "鲸鱼语", "Whale language", "eE编码", "鲸语密码", "eeEE编码", "鲸鱼叫声编码", "Cetacean cipher", "二进制eE", "海豚语"]
  },
  yygq: {
    what: "yygq 阴阳怪气语，用口头禅表示二进制",
    principle: "以「就这¿」「不会吧？」两种口头禅分别表示 0 和 1，将字符 ASCII 二进制展开",
    usage: "无参数(就这¿/不会吧？)；输入文本",
    examples: [{ in: "Hi", param: {}, out: "就这¿就这¿不会吧？...", desc: "H/i 的 ASCII 二进制以口头禅序列表示" }],
    formulas: [{ tex: "E(b) = \\begin{cases} \\text{不会吧？} & b=1 \\\\ \\text{就这¿} & b=0 \\end{cases}", caption: "二进制位 1→不会吧？, 0→就这¿" }],
    tips: ["0→就这¿, 1→不会吧？", "网络梗衍生编码", "本质是二进制的口语化包装"],
    aka: ["阴阳怪气语", "yygq", "阴阳怪气", "阴阳怪气编码", "就这不会吧", "yygq编码", "阴阳语", "怪话编码", "网络梗编码", "口头禅二进制", "yin yang", "阴阳怪气密码"]
  },
  braille: {
    what: "盲文编码，Unicode U+2800 块 8 点盲文",
    principle: "每个字符映射到 Unicode 8 点盲文区（U+2800-U+28FF），8 位点阵表示",
    usage: "无参数(U+2800 块)，双向 encode/decode",
    examples: [{ in: "AB", param: {}, out: "⡱⡲", desc: "A=⡱, B=⡲，8 点盲文字符" }],
    formulas: [{ tex: "E(c) = \\text{U+28}\\text{XX}", caption: "映射到 U+2800-U+28FF 8 点盲文区" }],
    tips: ["使用 Unicode U+2800 块", "8 点（含上下两层）", "区别于 6 点标准盲文"],
    aka: ["8 点盲文", "Braille", "盲文", "braille", "盲文编码", "盲人点字", "点字", "Braille cipher", "布莱叶盲文", "点阵盲文", "Unicode盲文", "六点盲文"]
  },
  eightdiagram: {
    what: "六十四卦编码，base64 映射到 64 卦",
    principle: "将数据 base64 后，每 6 位映射到一个六十四卦字符（易经卦象）",
    usage: "无参数(base64→64 卦)，双向 encode/decode",
    examples: [{ in: "AB", param: {}, out: "师解谦", desc: "AB 经 base64 后映射为 师解谦 三卦" }],
    formulas: [{ tex: "E(c) = \\text{Hexagram}(\\text{bin}_6(c))", caption: "6 位一组映射为六十四卦" }],
    tips: ["基于易经六十四卦", "6 位二进制→1 卦", "文化味浓厚的编码"],
    aka: ["六十四卦", "八卦编码", "64卦", "易经编码", "卦象编码", "周易编码", "六十四卦密码", "hexagram", "八卦密码", "I Ching", "易经卦象", "卦爻编码"]
  },
  whitespace: {
    what: "Whitespace 编码，以空格/Tab/换行表示二进制",
    principle: "用三种空白字符（空格、Tab、换行）表示二进制位或分组，表面看似空白实含信息",
    usage: "无参数(space/tab/newline)，双向 encode/decode",
    examples: [{ in: "Hi", param: {}, out: "（由空格/Tab/换行组成的不可见序列）", desc: "Hi 编码为仅含空白字符的序列，肉眼不可见" }],
    formulas: [{ tex: "E(b) \\in \\{\\text{Space}, \\text{Tab}, \\text{LF}\\}", caption: "二进制位映射为三种空白字符" }],
    tips: ["三种空白字符表示二进制", "表面与普通空文本无异", "需专门工具读取"],
    aka: ["空白编码", "Whitespace", "whitespace", "空白字符编码", "空格隐写", "Whitespace语言", "隐形编码", "不可见字符编码", "空白隐写", "Tab空格换行", "whitespace stego", "空白密码"]
  },
  pigpen: {
    what: "猪圈密码，栅格 token 1A-3H 表示字母",
    principle: "将字母按 3 区栅格（1A-3H 共 24 格）分布，每格以 区号+格号 token 表示",
    usage: "无参数(3 区栅格 1A-3H token)，双向 encode/decode",
    examples: [{ in: "ABC", param: {}, out: "1A 1B 1C", desc: "A=1A, B=1B, C=1C，第 1 区前三格" }],
    formulas: [{ tex: "E(c) = (\\text{zone}, \\text{cell})", caption: "字母在 3 区栅格中的区号与格号" }],
    tips: ["3 区每区 8 格，共 24 格", "token 形如 1A、2F、3H", "源自共济会猪圈密码变体"],
    aka: ["猪圈密码", "Pigpen cipher", "pigpen", "共济会密码", "朱高密码", "栅格密码", "Freemason cipher", "Masonic cipher", "共济会暗号", "猪栏密码", "井字密码", "方格密码"]
  },
  keyboardShift: {
    what: "键盘位移，按方向在键盘上平移键位",
    principle: "在 QWERTY 键盘行内按 shift 量左右平移每个键，direction 决定方向",
    usage: "params: shift(默认1), direction(right/left，默认right)，双向",
    examples: [{ in: "hello", param: { shift: 1, direction: "right" }, out: "jraap", desc: "每键右移 1：h→j, e→r, l→a, l→a, o→p" }],
    formulas: [{ tex: "E(c) = \\text{kbd}[\\text{idx}(c) \\pm \\text{shift}]", caption: "键位索引加减 shift 取相邻键" }],
    tips: ["shift 控制位移量", "direction 控制左/右", "仅在同行内位移，不跨行"],
    aka: ["键盘位移", "Keyboard shift", "键盘漂移", "keyboard shift", "键位平移", "键盘偏移", "键盘滑动密码", "keyboard drift", "键盘左右移", "键位偏移密码", "同行键位移", "keyboard offset"]
  },
  malbolge: {
    what: "Malbolge 识别，检测可打印 ASCII 文本",
    principle: "Malbolge 为故意设计为极难的语言，此 op 仅识别不执行，输出可识别信息",
    usage: "run 单向(仅识别不执行)",
    examples: [{ in: "可打印ASCII文本", param: {}, out: "识别信息", desc: "对输入文本进行 Malbolge 可识别性检测" }],
    formulas: [{ tex: "\\text{out} = \\text{detect}(\\text{input})", caption: "仅识别不执行 Malbolge 程序" }],
    tips: ["仅识别，不执行", "Malbolge 被称为最难编程语言", "输入需为可打印 ASCII"],
    aka: ["Malbolge 识别", "玛尔波格", "Malbolge", "malbolge", "地狱语言", "最难编程语言", "但丁地狱语言", "深奥语言Malbolge", "Malbolge识别", "玛尔波各", "esolang", "最难esolang"]
  },
  aaencode: {
    what: "aaencode，颜文字 JavaScript 编码",
    principle: "将 JS 代码转为颜文字（kaomoji）序列，仍可被 JS 引擎执行",
    usage: "无参数(颜文字 JS)；输入文本/数字",
    examples: [{ in: "1", param: {}, out: "ﾟωﾟﾉ= /｀ｍ´）ﾉ ~┻━┻   //*´∇｀*/ ['_']; ...", desc: "数字 1 编码为颜文字 JS 序列" }],
    formulas: [{ tex: "E(\\text{code}) = \\text{kaomoji}(\\text{JS})", caption: "JS 代码字符替换为颜文字" }],
    tips: ["输出仍为合法 JS", "颜文字即 kaomoji", "与 jjencode 同类趣味编码"],
    aka: ["颜文字编码", "aaencode", "AAencode", "颜文字JS", "kaomoji编码", "颜文字混淆", "JS颜文字", "aaencode解码", "颜文字加密", "japanese emoticon", "颜文字代码", "JSFuck同类"]
  },
  baudot: {
    what: "博多电码，5 位电报码",
    principle: "5 位二进制表示字符，ITA2 含字母/数字两套字符集（Figure/Letter shift）",
    usage: "params: variant(ita2/ita1，默认ita2)，双向 encode/decode",
    examples: [{ in: "HELLO", param: { variant: "ita2" }, out: "10100 00001 10010 10010 11000", desc: "ITA2 博多码：H=10100, E=00001, L=10010, L=10010, O=11000" }],
    formulas: [{ tex: "E(c) = \\text{bin}_5(c)", caption: "字符映射为 5 位二进制" }],
    tips: ["ITA2 为国际电报标准", "5 位故仅 32 个基本码", "需 Figure/Letter 切换符"],
    aka: ["博多码", "Baudot code", "baudot", "博多电码", "五位电报码", "ITA2", "电传打字码", "Baudot-Murray", "国际电报字母表2", "5位码", "电报五单位码", "telex code"]
  },
  type7: {
    what: "Type7 编码，带盐的字母位移",
    principle: "以 salt 作为密钥对字母进行位移变换，盐值范围 0-52",
    usage: "params: salt(0-52，默认0)，双向 encode/decode",
    examples: [{ in: "test", param: { salt: 0 }, out: "0010161510", desc: "salt=0 时 test 编码为 0010161510" }],
    formulas: [{ tex: "E(c, s) = f(\\text{idx}(c), s)", caption: "字母序号与盐值 s 的函数" }],
    tips: ["salt 范围 0-52", "盐值即密钥", "双向可逆"],
    aka: ["Type7", "带盐位移", "Cisco Type7", "type7", "Cisco密码", "思科Type7", "Cisco password 7", "思科口令7", "Vigenere变体", "Cisco IOS密码", "type 7", "路由器密码"]
  },
  decabit: {
    what: "Decabit，10 位三元编码",
    principle: "每个字符编码为 10 位 + / - 序列，asNumber 控制是否输出数值形式",
    usage: "params: asNumber(默认false)，双向 encode/decode",
    examples: [{ in: "AB", param: {}, out: "++-+++---- ++++--+---", desc: "A=++-+++----, B=++++--+---，各 10 位" }],
    formulas: [{ tex: "E(c) = (b_i)_{i=1}^{10},\\ b_i \\in \\{+, -\\}", caption: "字符映射为 10 位 +/- 序列" }],
    tips: ["每字符固定 10 位", "用于电力线载波通信", "asNumber=true 输出数字形式"],
    aka: ["Decabit", "十位码", "decabit", "Decabit脉冲码", "十位脉冲码", "电力线载波", "纹波控制", "ripple control", "10位码", "Decabit编码", "电力载波码", "脉冲编码Decabit"]
  },
  scytale: {
    what: "密码棒，绕柱书写换位",
    principle: "明文按 column 列宽绕柱书写后逐行读取，古斯巴达密码棒",
    usage: "params: column(默认2)，双向 encode/decode",
    examples: [{ in: "HELLO", param: { column: 2 }, out: "HLOEL|", desc: "column=2：HLO 在前，EL 在后，末尾 | 占位" }],
    formulas: [{ tex: "T = \\text{column}", caption: "列宽 column 决定换位周期" }],
    tips: ["column 决定柱周长", "不足补占位符 |", "最古老的换位密码之一"],
    aka: ["密码棒", "Scytale", "scytale", "天书密码棒", "斯巴达密码棒", "斯巴达棒", "绕棒密码", "cane cipher", "密码卷轴", "换位密码棒", "Skytale", "古希腊密码棒"]
  },
  keyCode: {
    what: "键码识别，将键码转字符",
    principle: "以键盘 keyCode（ASCII/虚拟键码）识别对应字符",
    usage: "run 单向",
    examples: [{ in: "65", param: {}, out: "65 → A", desc: "键码 65 对应大写字母 A" }],
    formulas: [{ tex: "\\text{out} = \\text{char}(\\text{keyCode})", caption: "键码映射为字符" }],
    tips: ["输入为键码数字", "65-90 为 A-Z", "仅识别不反向"],
    aka: ["键码", "KeyCode", "keyCode", "JS keyCode", "键盘键码", "虚拟键码", "keyCode表", "ASCII键码", "键盘代码", "keycode", "JS键码表", "键值码"]
  },
  shiftKey: {
    what: "Shift 键映射，上档字符切换",
    principle: "按 Shift 键的状态映射字符到其上档符号（如 1→!），自反",
    usage: "无参数(自反)；再次应用即还原",
    examples: [{ in: "1", param: {}, out: "!", desc: "1 的上档符号为 !" }],
    formulas: [{ tex: "E(c) = \\text{shift}(c)", caption: "字符映射到 Shift 上档对应字符" }],
    tips: ["自反：再转一次即还原", "仅对有上档符号的键有效", "1→!, 2→@, 3→#..."],
    aka: ["上档键映射", "ShiftKey", "shiftKey", "上档键符号", "Shift键", "上档符号", "shift symbol", "数字符号切换", "键盘上档", "Shift映射", "上档字符", "shift key map"]
  },
  keyword9: {
    what: "keyword9，T9 九宫格四模式识别",
    principle: "识别 T9 九宫格键盘输入序列，支持四种模式（多 tap/单词预测等）",
    usage: "run 单向(T9 四模式)",
    examples: [{ in: "abc", param: {}, out: "T9九宫格模式识别", desc: "识别 abc 对应的 T9 九宫格输入模式" }],
    formulas: [{ tex: "\\text{out} = \\text{T9}_\\text{mode}(\\text{input})", caption: "T9 九宫格四模式识别" }],
    tips: ["支持四种识别模式", "2=abc, 3=def, 4=ghi...", "老式手机输入法"],
    aka: ["T9 九宫格", "keyword9", "T9九宫格", "九宫格识别", "T9识别", "手机九宫格", "T9 keyboard", "九宫格输入", "老年机输入", "T9 predictive", "九宫格密码", "手机键盘九宫格"]
  },
  keyboardSurround: {
    what: "键盘包围键识别，求键的邻居集合",
    principle: "在 QWERTY 键盘上找出指定键的周围（上下左右斜向）邻居键集合",
    usage: "run 单向",
    examples: [{ in: "q", param: {}, out: "识别: 包围键集合 结果: 1", desc: "q 的包围键集合识别结果" }],
    formulas: [{ tex: "\\text{out} = \\text{neighbors}(c)", caption: "键 c 的键盘邻居集合" }],
    tips: ["考虑八方向邻居", "边缘键邻居较少", "仅识别不反向"],
    aka: ["键盘包围键", "KeyboardSurround", "keyboardSurround", "键盘邻居键", "键盘周围键", "包围键", "键盘环绕", "邻键集合", "keyboard neighbors", "键盘八方向", "周围键识别", "键位邻居"]
  },
  qweAbc: {
    what: "qweAbc，多键盘布局字母映射识别",
    principle: "在 qwerty/qwertz/azerty 三种键盘布局上识别字母位置映射",
    usage: "run 单向",
    examples: [{ in: "abc", param: {}, out: "qwerty:kxv qwertz:kxv azerty:axv", desc: "abc 在三种键盘布局下的位置映射" }],
    formulas: [{ tex: "\\text{out} = \\bigcup_{L} L(c)", caption: "字母 c 在多种布局 L 下的坐标" }],
    tips: ["覆盖 qwerty/qwertz/azerty", "输出各布局坐标", "仅识别不反向"],
    aka: ["多键盘映射", "qweAbc", "QWERTY转ABC", "qwe转abc", "键盘布局映射", "qwerty abc", "多布局映射", "qwertz azerty", "键盘位置识别", "qweabc", "布局字母映射", "键盘布局对应"]
  },
  layoutMap: {
    what: "布局映射，按键盘布局转换字符",
    principle: "将 QWERTY 字符按目标布局（dvorak/colemak）物理键位重新映射",
    usage: "params: layout(dvorak/colemak，默认dvorak)，双向 encode/decode",
    examples: [{ in: "hello", param: { layout: "dvorak" }, out: "d.nnr", desc: "hello 按 dvorak 键位映射为 d.nnr" }],
    formulas: [{ tex: "E(c) = \\text{layout}[\\text{qwerty}[c]]", caption: "QWERTY 键位在目标布局中对应的字符" }],
    tips: ["支持 dvorak/colemak", "保持物理键位不变换字符", "用于键盘布局学习者"],
    aka: ["布局映射", "LayoutMap", "layoutMap", "键盘布局映射", "Dvorak", "Colemak", "德沃夏克布局", "键盘布局转换", "layout map", "布局重映射", "Dvorak Colemak", "键位布局转换"]
  },
  t9Phone: {
    what: "T9 手机编码，字母转数字键+位序",
    principle: "a=21, b=22, c=23… 每字母编码为两位：十位为键号，个位为该键第几位",
    usage: "无参数(a=21...z=94)，双向 encode/decode",
    examples: [{ in: "ABC", param: {}, out: "212223", desc: "A=21, B=22, C=23（2 键的第 1/2/3 位）" }],
    formulas: [{ tex: "E(c) = 10 \\cdot \\text{key}(c) + \\text{pos}(c)", caption: "键号×10 + 位序" }],
    tips: ["a=21 ... z=94", "2=abc, 3=def, 4=ghi, 5=jkl, 6=mno, 7=pqrs, 8=tuv, 9=wxyz", "区别于 multitap"],
    aka: ["T9 手机码", "t9Phone", "手机九宫格T9", "T9电话编码", "手机键盘编码", "电话九宫格", "phone keypad", "T9 phone", "手机数字键编码", "九宫格数字码", "键号位序编码", "T9手机键盘"]
  },
  multitap: {
    what: "多击编码，重复按键次数表示字母",
    principle: "2=a, 22=b, 222=c；按键次数对应键上字母顺序，空格分隔",
    usage: "无参数(2=a 22=b 222=c)，双向 encode/decode",
    examples: [{ in: "ABC", param: {}, out: "2 22 222", desc: "A=2, B=22, C=222（2 键按 1/2/3 次）" }],
    formulas: [{ tex: "E(c) = \\text{key}(c)^{\\text{pos}(c)}", caption: "键号重复 pos 次" }],
    tips: ["老式手机输入法", "按键次数=字母在键上的位置", "字母间需分隔避免歧义"],
    aka: ["多击输入", "Multitap"]
  },
  kbdFullCoord: {
    what: "键盘全坐标，含数字行的 R.C 格式",
    principle: "完整键盘（含数字行）4 行布局，每个键映射为 行.列(R.C) 坐标",
    usage: "无参数(R.C 格式 含数字行)，双向 encode/decode",
    examples: [{ in: "AB", param: {}, out: "3.1 4.5", desc: "A=第3行第1列=3.1, B=第4行第5列=4.5（含数字行）" }],
    formulas: [{ tex: "E(c) = (\\text{row}.\\text{col})", caption: "键在含数字行键盘上的行列坐标" }],
    tips: ["含数字行共 4 行", "格式 行.列", "区别于 3 行 keyboard"],
    aka: ["键盘全坐标", "KbdFullCoord"]
  },
  stenoLetter: {
    what: "速记字母，Plover 和弦表示",
    principle: "基于 Plover 速记键盘和弦，每个字母映射为速记机的键和弦组合",
    usage: "无参数(Plover 和弦)，双向 encode/decode",
    examples: [{ in: "ABC", param: {}, out: "A PW KR", desc: "A=A 和弦, B=PW 和弦, C=KR 和弦" }],
    formulas: [{ tex: "E(c) = \\text{chord}(c)", caption: "字母映射为 Plover 速记和弦" }],
    tips: ["基于 Plover 速记系统", "和弦为多键同时按下", "用于速录机输入"],
    aka: ["速记和弦", "StenoLetter", "stenoLetter", "Steno速记字母", "Plover速记", "速记字母", "速录和弦", "steno chord", "速记键盘", "Plover chord", "速录机编码", "钢速记"]
  },
  arrowKey: {
    what: "方向键编码，WASD 转箭头符号",
    principle: "将 W/A/S/D（或 U/D/L/R、数字）映射为对应方向箭头符号 ↑↓←→",
    usage: "params: scheme(wasd/udlr/numeric，默认wasd)，双向 encode/decode",
    examples: [{ in: "WASD", param: { scheme: "wasd" }, out: "↑←↓→", desc: "W=↑, A=←, S=↓, D=→" }],
    formulas: [{ tex: "E(c) = \\text{arrow}(\\text{dir}(c))", caption: "方向字符映射为箭头符号" }],
    tips: ["支持 wasd/udlr/numeric 三种方案", "W=↑, A=←, S=↓, D=→", "游戏控制常用"],
    aka: ["方向键", "ArrowKey", "arrowKey", "方向键编码", "WASD编码", "箭头编码", "上下左右", "arrow key", "方向箭头", "WASD转箭头", "方向符号编码", "UDLR编码"]
  },
  americanMorse: {
    what: "美式摩尔斯电码，19 世纪大陆电报",
    principle: "美国早期摩尔斯电码，使用点、划及长划（_）三种元素，与国际摩尔斯不同",
    usage: "无参数(19 世纪大陆电报 含 _ 长划)，双向 encode/decode",
    examples: [{ in: "HELLO", param: {}, out: ".... / . / _ / _ / . .", desc: "美式摩尔斯：H=...., E=., L=_, L=_, O=.. " }],
    formulas: [{ tex: "\\text{Morse}_{US}(c) \\in \\{\\cdot, -, \\_\\}^{+}", caption: "含点、划、长划三种元素" }],
    tips: ["含长划 _ 元素", "区别于国际摩尔斯", "19 世纪美国大陆电报用"],
    aka: ["美式摩尔斯", "American Morse", "美式摩斯码", "American Morse code", "美国摩尔斯", "大陆电报码", "Railroad Morse", "铁路摩尔斯", "美式电码", "Morse landline", "含长划摩尔斯", "美式莫尔斯"]
  },
  cnTelegraphMorse: {
    what: "中文电报摩尔斯，4 位中文电码转摩尔斯",
    principle: "每个中文字符对应 4 位数字电码，再将数字转摩尔斯电码",
    usage: "无参数(4 位中文电码)，双向 encode/decode",
    examples: [{ in: "1234", param: {}, out: ".---- ..--- ...-- ....-", desc: "数字 1-4 各自的摩尔斯码" }],
    formulas: [{ tex: "E(c) = \\text{Morse}(\\text{telegraph}_4(c))", caption: "中文电码 4 位数字再转摩尔斯" }],
    tips: ["中文电码为 4 位数字", "再对数字取摩尔斯", "1871 年丹麦人引入中国"],
    aka: ["中文电报摩尔斯", "CN Telegraph Morse", "中文电码摩尔斯", "中文电码", "汉字电报码", "中文商用电码", "Chinese telegraph code", "四位电码", "标准电码本", "汉字四码", "中文电报", "电码摩斯"]
  },
  tapCode: {
    what: "敲击码，5x5 波利比奥斯方阵行列敲击（merge 参数选 I/J 合并 或 K→C 合并）",
    principle: "5x5 方阵合并一格：默认 I/J 同格（含 K），或 K→C 同格（含 J），以行列敲击数表示字母",
    usage: "merge 参数：ij(默认，I/J 合并) | kc(K→C 合并)，双向 encode/decode",
    examples: [{ in: "HELLO", param: { merge: "ij" }, out: "23 15 31 31 34", desc: "H=23, E=15, L=31, L=31, O=34（I/J 合并）" }],
    formulas: [{ tex: "E(c) = (r, k),\\ r,k \\in [1,5]", caption: "字母在 5x5 方阵中的行列坐标" }],
    tips: ["I/J 或 K/C 共用一格（视 merge）", "行列均 1-5", "源于战俘敲墙通信"],
    aka: ["敲击码", "TapCode", "Tap code", "监狱密码", "tapcode", "敲墙码", "敲击密码", "Knock code", "波利比奥斯敲击", "战俘密码", "Polybius tap", "5x5敲击码"]
  },
  semaphore: {
    what: "旗语编码，8 方向双旗表示字母",
    principle: "双手各持一旗，8 个方向组合表示字母，以双方向描述（如 Down+UpRight）",
    usage: "无参数(8 方向双旗)，双向 encode/decode",
    examples: [{ in: "ABC", param: {}, out: "Down+UpRight Down+Right Down+DownRight", desc: "A=Down+UpRight, B=Down+Right, C=Down+DownRight" }],
    formulas: [{ tex: "E(c) = (d_1, d_2),\\ d_i \\in \\text{8 dir}", caption: "两旗各自 8 方向的组合" }],
    tips: ["8 方向：Up/Down/Left/Right 及斜向", "双旗组合表示字母", "航海通信传统方式"],
    aka: ["旗语", "Semaphore", "semaphore", "旗语编码", "旗语密码", "信号旗语", "flag semaphore", "手旗语", "航海旗语", "Semaphore flag", "双旗信号", "海军旗语"]
  },
  dtmf: {
    what: "DTMF 双音多频，行列频率对识别",
    principle: "电话键盘每个键由两个频率（行频+列频）组合表示，如 1=697Hz+1209Hz",
    usage: "run 单向(行列频率对)",
    examples: [{ in: "1", param: {}, out: "1 → 697 Hz + 1209 Hz", desc: "键 1 由 697Hz（行）与 1209Hz（列）合成" }],
    formulas: [{ tex: "f = f_{\\text{row}} + f_{\\text{col}}", caption: "双频叠加识别按键" }],
    tips: ["行频 697/770/852/941 Hz", "列频 1209/1336/1477/1633 Hz", "电话拨号音原理"],
    aka: ["双音多频", "DTMF", "dtmf", "DTMF双音多频", "电话拨号音", "Touch-Tone", "双音多频信号", "拨号音", "dual tone multi frequency", "按键音", "电话音识别", "DTMF频率"]
  },
  morseRhythm: {
    what: "摩尔斯节奏，·− 与 .- 规范化互转",
    principle: "将 ·−（圆点破折）与 .-（点减号）两种表示双向规范化转换",
    usage: "双向(·−↔.- 规范化)",
    examples: [{ in: ".- .- -", param: {}, out: ".- .- -（encode） / ·− ·− −（decode）", desc: "encode 保持 .-，decode 转为 ·−" }],
    formulas: [{ tex: "\\cdot \\leftrightarrow .,\\ - \\leftrightarrow -", caption: "两种符号系统互转" }],
    tips: ["encode: 输出 .- 形式", "decode: 输出 ·− 形式", "仅做符号规范化"],
    aka: ["摩尔斯节奏", "MorseRhythm", "morseRhythm", "摩斯节奏规范化", "摩尔斯符号规范化", "摩斯符号转换", "morse rhythm", "点划规范化", "摩斯格式化", "摩尔斯归一化", "Morse normalize", "摩斯节奏"]
  },
  manchester: {
    what: "曼彻斯特编码，每位用跳变表示",
    principle: "每位周期中间跳变：IEEE 规约下 0 为低→高、1 为高→低（Thomas 相反）",
    usage: "params: inputFormat(auto/text/bits), convention(ieee/thomas，默认ieee)，双向",
    examples: [{ in: "A", param: { inputFormat: "auto", convention: "ieee" }, out: "1001101010101001", desc: "A=01000001，IEEE 曼彻斯特每位 2 电平" }],
    formulas: [{ tex: "E(b) = \\begin{cases} 10 & b=1\\ (\\text{IEEE}) \\\\ 01 & b=0\\ (\\text{IEEE}) \\end{cases}", caption: "每位映射为半位跳变" }],
    tips: ["IEEE: 1→10, 0→01", "Thomas: 1→01, 0→10", "每位中间必有跳变"],
    aka: ["曼彻斯特码", "Manchester", "manchester", "曼彻斯特编码", "Manchester encoding", "曼码", "曼彻斯特线路码", "曼彻斯特调制", "Manchester code", "相位编码", "以太网曼码", "IEEE曼彻斯特"]
  },
  diffManchester: {
    what: "差分曼彻斯特编码，跳变表示 0",
    principle: "每位起始有跳变为 0、无跳变为 1，中间必有跳变；初始电平 initialLevel 决定起点",
    usage: "params: inputFormat, initialLevel(0/1，默认0)，双向",
    examples: [{ in: "A", param: { inputFormat: "auto", initialLevel: 0 }, out: "1001010101010110", desc: "A=01000001，initialLevel=0 的差分曼彻斯特" }],
    formulas: [{ tex: "E(b) = \\begin{cases} \\text{跳变} & b=0 \\\\ \\text{不跳变} & b=1 \\end{cases}", caption: "位起始跳变与否区分 0/1" }],
    tips: ["位起始跳变=0，不跳变=1", "中间必有跳变（时钟）", "initialLevel 决定起始电平"],
    aka: ["差分曼彻斯特", "Diff Manchester", "diffManchester", "差分曼彻斯特编码", "Differential Manchester", "差分曼码", "差分曼彻斯特码", "DM编码", "差分相位编码", "differential manchester encoding", "令牌环编码", "差曼码"]
  },
  nrzi: {
    what: "NRZI 不归零反转编码",
    principle: "遇 1 电平翻转、遇 0 电平保持，convention 决定翻转规则，initialLevel 设起点",
    usage: "params: inputFormat, convention(usb/classic，默认usb), initialLevel，双向",
    examples: [{ in: "A", param: { inputFormat: "auto", convention: "usb", initialLevel: 0 }, out: "11010100", desc: "A=01000001，USB 规约 NRZI，初始 0" }],
    formulas: [{ tex: "E(b) = \\begin{cases} \\text{翻转} & b=1 \\\\ \\text{保持} & b=0 \\end{cases}", caption: "1 翻转 0 保持" }],
    tips: ["USB: 1 翻转，0 保持", "Classic 规约相反", "initialLevel 决定起始电平"],
    aka: ["NRZI", "不归零反转", "nrzi", "NRZI编码", "Non-Return-to-Zero Inverted", "不归零翻转", "反向不归零", "NRZ-I", "USB编码", "反转不归零码", "NRZI line code", "不归零倒置"]
  },
  miller: {
    what: "Miller 编码，延迟编码",
    principle: "1 在位中间跳变，0 在位中间不跳变，连续 0 在位边界跳变；initialLevel 设起点",
    usage: "params: inputFormat, initialLevel(默认0)，双向",
    examples: [{ in: "A", param: { inputFormat: "auto", initialLevel: 0 }, out: "0001110011001110", desc: "A=01000001，initialLevel=0 的 Miller 码" }],
    formulas: [{ tex: "E(b) = \\begin{cases} \\text{中间跳变} & b=1 \\\\ \\text{中间不跳变} & b=0 \\end{cases}", caption: "1 中间跳变，0 看前位决定边界跳变" }],
    tips: ["1 在位中间跳变", "连续 0 在边界跳变", "带宽效率较高"],
    aka: ["Miller 码", "延迟编码", "miller", "密勒码", "Miller code", "Miller编码", "Delay encoding", "密勒编码", "MFM相关", "延迟调制", "Miller cipher", "密勒延迟码"]
  },
  fourB5B: {
    what: "4B/5B 编码，4 位映射 5 位",
    principle: "每 4 位数据映射为 5 位码字，保证足够跳变便于时钟恢复",
    usage: "params: inputFormat，双向 encode/decode",
    examples: [{ in: "A", param: { inputFormat: "auto" }, out: "0101001001", desc: "A=01000001，按 4 位分组各映射 5 位" }],
    formulas: [{ tex: "E(b_4) = \\text{table}(b_4) \\in \\{0,1\\}^5", caption: "4 位数据查表得 5 位码" }],
    tips: ["4 位→5 位查表映射", "保证码字含足够跳变", "用于百兆以太网"],
    aka: ["4B/5B", "四位五位码", "fourB5B", "4B5B编码", "4B/5B编码", "4B5B", "四比特五比特", "block coding", "百兆以太网编码", "4b5b line code", "四位映射五位", "FDDI编码"]
  },
  pwmPpm: {
    what: "PWM/PPM 调制编码",
    principle: "PWM 脉宽调制以脉冲宽度表示位，PPM 脉位调制以脉冲位置表示位；mode 切换",
    usage: "params: inputFormat, mode(pwm/ppm，默认pwm)，双向",
    examples: [{ in: "A", param: { inputFormat: "auto", mode: "pwm" }, out: "101101010101010110", desc: "A=01000001，PWM 模式脉冲宽度编码" }],
    formulas: [{ tex: "E(b) = \\begin{cases} \\text{宽脉冲/窄脉冲} & \\text{PWM} \\\\ \\text{脉冲位置} & \\text{PPM} \\end{cases}", caption: "PWM 调宽，PPM 调位" }],
    tips: ["PWM: 1 宽脉冲，0 窄脉冲", "PPM: 脉冲位置表示位", "mode 切换两种调制"],
    aka: ["脉宽/脉位调制", "PWM/PPM", "pwmPpm", "PWM", "PPM", "脉宽调制", "脉位调制", "pulse width modulation", "pulse position modulation", "脉冲宽度调制", "脉冲位置调制", "PWM PPM编码"]
  },
  musicNotation: {
    what: "乐谱记法转换，音名/MIDI/简谱/唱名互转",
    principle: "在 note/midi/jianpu/solfeggio 多种乐谱表示间转换，key 决定调号，preferFlat 偏好降号",
    usage: "params: from(auto/note/midi/jianpu/solfeggio，默认auto), to(同上默认midi), key(默认C), preferFlat(默认false)，双向",
    examples: [{ in: "C4", param: { from: "auto", to: "midi", key: "C", preferFlat: false }, out: "60", desc: "C4 音名转 MIDI 编号为 60" }],
    formulas: [{ tex: "\\text{MIDI}(n) = 12(\\text{oct}+1) + \\text{pc}(n)", caption: "MIDI = 12×(八度+1) + 音级" }],
    tips: ["C4 = MIDI 60", "中央 C 为 C4", "preferFlat 偏好降号记谱"],
    aka: ["乐谱转换", "MusicNotation", "musicNotation", "音乐记号互转", "乐谱记法", "音名MIDI转换", "简谱唱名", "music notation", "音名转MIDI", "唱名转换", "十二平均律记法", "音符记法转换"]
  },
  musicInfo: {
    what: "音符信息查询，输出音名/MIDI/简谱/唱名/频率",
    principle: "对输入音符输出其多维信息：音名、MIDI 号、简谱、唱名、频率（基于十二平均律）",
    usage: "run 单向, params: key, preferFlat",
    examples: [{ in: "60", param: { key: "C", preferFlat: false }, out: "输入类型: midi 音名: C4 MIDI: 60 简谱: 1 唱名: do 频率: 261.63Hz", desc: "MIDI 60 的全部乐理信息" }],
    formulas: [{ tex: "f = 440 \\cdot 2^{(n-69)/12}", caption: "MIDI 号 n 对应频率（A4=69=440Hz）" }],
    tips: ["A4=440Hz 为基准", "MIDI 60 = C4 = 1(do) = 261.63Hz", "一次输出多维信息"],
    aka: ["音符信息", "MusicInfo", "musicInfo", "音符全息信息", "音符频率查询", "音名频率", "note info", "音高信息", "MIDI音符信息", "音符属性", "乐理信息查询", "音符频率计算"]
  },
  fracmorse: {
    what: "分式摩尔斯密码，摩尔斯长度作密钥置换",
    principle: "以摩尔斯码长度模式为元素，用 key 字母表定义的置换进行加密",
    usage: "params: key(26 字母表，默认 ROUNDTABLECFGHIJKMPQSVWXYZ)，双向 encode/decode",
    examples: [{ in: "HELLO", param: { key: "ROUNDTABLECFGHIJKMPQSVWXYZ" }, out: "RAQUNBI", desc: "HELLO 经分式摩尔斯置换为 RAQUNBI" }],
    formulas: [{ tex: "E(c) = \\pi_{\\text{key}}(\\text{morse-pattern}(c))", caption: "按 key 定义的置换 π 加密" }],
    tips: ["key 为 26 字母置换", "默认 key: ROUNDTABLECFGHIJKMPQSVWXYZ", "结合摩尔斯与分式置换"],
    aka: ["分式摩尔斯", "Fractional Morse", "fracmorse", "分数摩斯", "分式摩尔斯密码", "Fractionated Morse", "分组摩尔斯", "分数摩尔斯", "fractionated morse cipher", "摩斯置换密码", "分式摩斯码", "摩尔斯分数密码"]
  }
};
