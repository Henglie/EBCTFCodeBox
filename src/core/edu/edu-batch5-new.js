/*
 * edu-batch5-new.js — 新增独有编码科普补全。
 *
 * 纯数据 export default { [opId]: EduEntry }，无 import、无副作用、无 register（机制四低耦合）。
 * 覆盖 22 个新增 op：机械密码机（enigma/m209）、独有花式
 * （bazeries/fenham/pizzini/kamasutra/lolcode/clockCipher）、块变换（bwt）
 * 空白隐写（snow）、QQ秀 7 族（qqxiuzi_*）、中式（huoxingwen/jianfan/xiongyue/fuyouyue/tianshu）。
 *
 * examples 全部由对应 op 的 encode/decode 实跑取值，非编造。
 * EduEntry 契约见 eduContent.js 头注释：what/principle/usage/examples/formulas/tips/aka。
 */

export default {
 // ============================================================
 // 机械密码机
 // ============================================================
  enigma: {
    what: "二战德军最著名的转子密码机 Enigma（恩尼格玛），靠 3 个可旋转的接线转子 + 反射器把字母加密成另一个字母，每按一次键转子就转动，同一个字母每次映射都不一样。",
    principle:
      "电流从键盘出发，先过插线板 Steckerbrett，依次穿过右、中、左三个转子到达反射器，再原路折返穿三个转子回来点亮灯。每个转子是一张 26→26 的接线表（wiring），转子每转一格整张表就整体偏移。\n\n关键机制：\n\n1. **步进**：按键先转子步进再加密。右转子每键转一格；转到自己的 notch（缺口）时带动中转子，中转子到 notch 带动左转子。\n2. **双步进异常 double-stepping**：中转子在 notch 位时，下一次按键它会连着左转子一起再转一格，这是 Enigma 著名的机械怪癖。\n3. **环设置 Ringstellung**：把转子接线相对刻度环整体偏移，`(c - ring + pos) mod 26` 进、`(c - pos + ring) mod 26` 出。\n4. **自反**：反射器保证「A 加密成 K，同配置下 K 也加密成 A」，所以 Enigma 加解密是同一个操作——但也因此有「字母绝不映射到自己」这个致命弱点，被图灵团队用来破译。",
    usage:
      "填转子序列（左→右，如 `I II III`，可选 I-V 五款）、反射器（B 或 C）、环设置 Ringstellung（如 `AAA`）、初始轮位（如 `AAA`）、插线板（如 `AB CD EF`，可空）。加密解密同一配置，encode/decode 结果一致（自反）。非字母字符原样透传。",
    examples: [
      { in: "HELLOWORLD", param: "rotors=I II III, refl=B, ring=AAA, pos=AAA, 无插线板", out: "ILBDAAMTAZ", desc: "标准 Enigma I 配置" },
      { in: "ILBDAAMTAZ", param: "同上配置", out: "HELLOWORLD", desc: "自反：同配置解回原文" },
      { in: "AAAAA", param: "rotors=I II III, refl=B, ring/pos=AAA", out: "BDZGO", desc: "著名历史向量 BDZGOWCXLT 的前 5 位" },
    ],
    tips: [
      "CTF 里看到「一串全大写字母、明文里的字母绝不出现在密文同一位」几乎可断定 Enigma。",
      "破译不需暴力试 26^3×… 全空间——利用「字母不映射到自己」+ 已知明文 crib 可大幅剪枝。",
      "配置对不上就全乱：转子顺序、反射器、环设置、初始位、插线板五项缺一不可，题目通常会给全。",
    ],
    aka: ["Enigma", "恩尼格玛", "恩尼格玛机", "德军密码机", "转子机", "Enigma machine", "谜机", "转轮密码机", "德国密码机", "转子密码机", "英格玛", "Enigma密码"],
  },

  m209: {
    what: "二战美军的便携机械密码机 M-209（Hagelin C-38），巴掌大小、纯齿轮驱动，靠 6 个字母轮 + 27 根杆笼（lug cage）产生位移量，用 Beaufort 方式加密。",
    principle:
      "6 个密钥轮的字母数互质：`26, 25, 23, 21, 19, 17`（周期 = 它们的乘积，极长）。每个轮上有一圈可按下/抬起的销 pin。\n\n每加密一个字母：\n\n1. 读 6 个轮当前窗口字母对应的 pin 是否「有效」（按下）。\n2. 27 根杆笼每根挂 0/1/2 个 lug，lug 指向某个轮；只要它指的轮 active，这根杆就被推动。数出被推动的杆数 = 位移量 K（0..27）。\n3. Beaufort 加密：`C = (K - P) mod 26`。这天然自反——`P = (K - C) mod 26`，加解密同一操作。\n4. 6 个轮各自步进一格，进入下一个字母。",
    usage:
      "填 Pin 设置（6 组，每组写该轮「有效」的字母集合）、Lug 杆笼（27 根 `a-b` 形式，a/b∈0..6，0=中性）、初始轮位（6 字母，如 `AAAAAA`）。pin/lug 是密钥材料，本工具给了一套自洽默认配置。加解密同配置结果一致。非字母原样透传。",
    examples: [
      { in: "HELLO", param: "默认 pin/lug/start=AAAAAA", out: "POHHI", desc: "默认配置加密" },
      { in: "POHHI", param: "同配置", out: "HELLO", desc: "Beaufort 自反，解回原文" },
    ],
    tips: [
      "轮周期 26/25/23/21/19/17 是 M-209 的指纹，互质设计让整体周期长达约 1.01 亿。",
      "M-209 只加密 A-Z，传统按 5 字母一组分组发报；数字标点需先转写。",
      "不同资料对「读 pin 的窗口偏移」约定不一，导致同 key 密文可能有整体偏移差异——对拍历史密文时先核对该约定。",
    ],
    aka: ["M-209", "M209", "Hagelin", "哈格林", "C-38", "转轮密码机", "Hagelin C-38", "哈格林密码机", "美军密码机", "杆笼密码机", "Converter M-209", "机械密码机"],
  },

 // ============================================================
 // 独有花式 / 古典
 // ============================================================
  bazeries: {
    what: "Bazeries 密码，19 世纪法国密码学家 Bazeries 设计，把 Polybius 方阵替换和「数字分组反转」两步叠在一起，比单纯的方阵替换更抗分析。",
    principle:
      "用一个数字密钥（如 81257）驱动两件事：\n\n1. 把数字念成英文单词（num2words），取其字母顺序构造一张 5×5 密钥方阵（I/J 合并）。\n2. 明文先按数字的各位分组、每组内部字母顺序反转，再用方阵做 Polybius 坐标替换。\n\n解密逆序还原。",
    usage: "填数字密钥（如 `81257`）。encode 加密、decode 解密。仅处理字母，非字母透传。密钥含 0 会导致分组异常，工具会拦截报错。",
    examples: [
      { in: "HELLO", param: "key=81257", out: "cggmd", desc: "方阵替换 + 分组反转（输出可能带分组尾空格，trim 后可逆）" },
    ],
    tips: ["Bazeries 是「换位 + 替换」的混合密码，比纯替换难用频率分析直接打穿。"],
    aka: ["Bazeries", "巴泽里斯密码", "Bazeries cipher", "巴泽里密码", "Étienne Bazeries", "波利比奥斯变体", "Polybius变体", "数字分组反转", "换位替换混合密码", "法国密码", "巴泽利斯", "方阵替换密码"],
  },

  fenham: {
    what: "Fenham 密码，把 A-Z 每个字母写成它 ASCII 码的 7 位二进制，再和密钥字母的二进制逐位异或，输出一长串 0/1。",
    principle:
      "A-Z 对应 ASCII 65-90，正好都是 7 位二进制（A=`1000001` … Z=`1011010`）。加密时明文字母的 7 位与密钥字母的 7 位逐位 XOR（相同得 0，不同得 1），密钥循环使用。解密把每 7 位一组，再和密钥字母异或还原。",
    usage: "填字母密钥（如 `KEY`）。encode 输出二进制串，decode 吃二进制串还原。只支持 A-Z。",
    examples: [
      { in: "HELLO", param: "key=KEY", out: "00000110000000001010100001110001010", desc: "5 字母 → 35 位（每字母 7 位）" },
    ],
    tips: ["看到「长度是 7 的倍数的纯 0/1 串」且疑似字母密码，可试 Fenham。", "本质是 7 位定长的维吉尼亚 XOR。"],
    aka: ["Fenham", "芬厄姆密码", "Fenham cipher", "芬汉姆密码", "7位二进制异或", "二进制异或密码", "字母XOR密码", "ASCII异或密码", "维吉尼亚XOR", "位异或密码", "binary XOR cipher", "芬厄姆"],
  },

  pizzini: {
    what: "Pizzini 密码，一张固定的「字母 → 数字」替换表，A-Z 映射到 4 到 29 的数字，是简单单表替换的一种花式变体。",
    principle:
      "A-Z 依次对应 4,5,6,…,29（照权威表照抄）。加密逐字母查表出数字，解密靠数字重新查回字母。因为部分是两位数，解码时靠数字规律切分。",
    usage: "encode 把字母转成数字串，decode 把数字串还原字母。只处理 A-Z。",
    examples: [
      { in: "HELLO", out: "118151518", desc: "H=11 E=8 L=15 L=15 O=18" },
    ],
    tips: ["纯数字串、值域集中在 4-29，可怀疑 Pizzini。"],
    aka: ["Pizzini", "皮齐尼密码", "Pizzini cipher", "皮奇尼密码", "字母数字替换表", "4-29替换", "单表替换密码", "字母转数字密码", "数字替换密码", "皮齐尼", "Pizzini code", "意大利黑手党密码"],
  },

  kamasutra: {
    what: "Kamasutra（爱经）密码，古印度《爱经》里记载的一种配对替换：把字母两两配成对，加密时互相替换。因为是配对，加密和解密是同一个操作（自反）。",
    principle:
      "给一张配对表（如 `AB CD EF …`），每一对里的两个字母互相替换：A↔B、C↔D……加密解密完全对称。没配对到的字符原样保留。",
    usage: "填配对表 pairs（支持空格分隔、逗号分隔、或每 2 字符一对三种写法）。encode/decode 结果一致（自反）。",
    examples: [
      { in: "HELLO", param: "key=AB CD EF GH IJ KL MN OP QR ST UV WX YZ", out: "GFKKP", desc: "按配对表互换：H↔G, E↔F, L↔K, O↔P" },
    ],
    tips: ["自反是它的招牌：加密两次回原文。", "配对表就是密钥，题目一般会给。"],
    aka: ["Kamasutra", "爱经密码", "Vatsyayana", "Kamasutra cipher", "卡玛经密码", "欲经密码", "配对替换密码", "自反替换密码", "婆蹉衍那密码", "字母配对密码", "古印度密码", "Kama Sutra"],
  },

  lolcode: {
    what: "LOLCODE 语言字符移位编码，一种简单的按 ASCII 码分段偏移的字符替换，名字取自 LOLCODE 这门玩梗编程语言。",
    principle:
      "解码规则（照权威源）：每个字符 `num = ord(c) - 3`，若 `num > 69` 则再 `+5`，否则 `+2`，取 `chr(num)`。加密是它的逆运算。因为映射不是双射，明文里的 H/I/J 三个字符无对应密文，加密遇到会报错。",
    usage: "encode 加密、decode 解密。密文是移位后的可见 ASCII，无固定字符集特征，一把梭不做自动识别（避免误报）。",
    examples: [
      { in: "NUAACTF", out: "LSBBDRG", desc: "字符移位加密" },
      { in: "LSBBDRG", out: "NUAACTF", desc: "解回原文" },
    ],
    tips: ["映射非双射，H/I/J 加密会报错，这是算法本身的限制不是 bug。", "CTF 里常与 flag 格式配合，密文肉眼看是乱码 ASCII。"],
    aka: ["LOLCODE", "LOLCODE 语言", "lolcode cipher", "LOLCODE编码", "梗语言编码", "字符移位编码", "ASCII移位密码", "LOL密码", "分段偏移编码", "lolspeak", "LOLCODE移位", "笑话语言编码"],
  },

  clockCipher: {
    what: "表盘码 / 时钟码，把字母映射成时钟上的「几点几分」，用指针位置来编码，是一种直观的花式编码。",
    principle:
      "把字母按顺序映射到 12 小时环 + 分针刻度的组合，每个字母对应一个唯一的「时:分」时刻。解码就是把时刻查回字母。规则清晰可逆（详见工具内注释）。",
    usage: "encode 把文本转成一串时刻（如 `1:35 1:20 …`），decode 把时刻串还原文本。",
    examples: [
      { in: "HELLO", out: "1:35 1:20 1:55 1:55 2:10", desc: "每字母一个时刻，空格分隔" },
    ],
    tips: ["看到「一串 时:分 格式、分钟数规律」可怀疑表盘码。"],
    aka: ["clock cipher", "表盘码", "时钟码", "指针码", "钟表密码", "时钟密码", "clock code", "时钟编码", "钟面码", "时分密码", "时刻编码", "表盘密码"],
  },

 // ============================================================
 // 块变换
 // ============================================================
  bwt: {
    what: "BWT（Burrows-Wheeler 变换），bzip2 压缩的核心步骤。它不压缩数据，而是把字节重排成「相同字符更容易挨在一起」的形式，为后续压缩铺路，且完全可逆。",
    principle:
      "把字符串的所有循环移位排成一张表并按字典序排序，取最后一列作为输出，同时记下原串在排序后表中的行号（主索引 primary index）。逆变换靠 LF-mapping（last-to-first 映射）从最后一列 + 主索引重建原串。\n\n举例 `banana`：所有旋转排序后取末列得 `nnbaaa`，原串位于第 3 行，故输出 `nnbaaa|3`。",
    usage: "encode 输出「变换串 + 主索引」（用 `|` 分隔），decode 吃这个格式逆变换还原。支持空串/单字符/重复字符等边界。",
    examples: [
      { in: "banana", out: "nnbaaa|3", desc: "变换串 nnbaaa，主索引 3" },
      { in: "nnbaaa|3", out: "banana", desc: "LF-mapping 逆变换还原" },
    ],
    tips: ["BWT 本身不压缩，但让 `aaa`、`nn` 这种游程聚集，配合 MTF+RLE+熵编码才有压缩效果。", "CTF 里出现「乱序但字符集不变、还带一个索引数字」可怀疑 BWT。"],
    aka: ["BWT", "Burrows-Wheeler", "块排序变换", "bzip2 变换"],
  },

 // ============================================================
 // 空白隐写
 // ============================================================
  snow: {
    what: "SNOW 空白隐写（Steganographic Nature Of Whitespace），把秘密信息藏在每行文本行尾的「空格/制表符」里——空格代表 0、制表符代表 1，肉眼完全看不出。",
    principle:
      "先把消息编成二进制（带 4 字节长度头），再逐行把这些比特追加到容器文本各行末尾：空格=0、Tab=1。因为行尾空白在编辑器里不可见，载体读起来和普通文本一模一样。解码时提取每行行尾空白、还原比特、读长度头切出消息。",
    usage: "encode 时填「容器文本（可选）」，把消息藏进容器行尾；decode 吃含隐写的文本提取消息。容器行数不够会自动补空行。",
    examples: [
      { in: "Hi（消息） + 两行容器", param: "text=容器文本", out: "各行行尾追加空格/Tab 序列", desc: "行尾空白编码 'Hi' 的比特，正文不变" },
    ],
    tips: ["拿到一段「看起来正常但行尾疑似有空白」的文本，先开「显示不可见字符」再试 SNOW。", "很多编辑器会自动 trim 行尾空白，传输时用附件或代码块保护。"],
    aka: ["SNOW", "空白隐写", "whitespace stego", "行尾空白隐写", "空格隐写", "制表符隐写", "whitespace steganography", "空白字符隐写", "snow stego", "tab空格隐写", "不可见字符隐写", "SNOW隐写"],
  },

 // ============================================================
 // QQ秀字符密码族（qqxiuzi_*）
 // ============================================================
  qqxiuzi_arrow: {
    what: "QQ秀·箭头密码，把文本按字节异或后转成十六进制，再用 16 个箭头符号（←↑→↓ 等）替换 hex 的每一位，可选带密码。",
    principle:
      "统一算法：每字节 `ord ^ 48 ^ 密钥值`，密钥值 = 密码各字符 ASCII 之和再 `^48`（无密码时为 0）。结果编成 hex，每半字节（0-15）映射到一个箭头符号；单字节用 2 符号 + `=` 后缀，多字节用 4 符号 + `==` 后缀。",
    usage: "encode 加密、decode 解密。可选密码（留空即无密码）。箭头集：`←↑→↓↔↕↖↗↘↙↰↱↲↳↺↻`。",
    examples: [
      { in: "中", out: "↔↺↑↳==", desc: "无密码，UTF-8 3 字节 → 4 符号 + == 后缀" },
    ],
    tips: ["QQ秀四族（箭头/花/IPA/字母）算法相同，只是符号表不同，看后缀 `=`/`==` 判单/多字节。"],
    aka: ["QQ秀箭头", "箭头密码", "arrow cipher", "QQ秀·箭头", "qqxiuzi arrow", "QQ秀火星文箭头", "箭头符号密码", "方向箭头密码", "QQ秀加密箭头", "箭头编码", "arrow code", "QQ秀符号密码"],
  },

  qqxiuzi_flower: {
    what: "QQ秀·花密码，和箭头密码同一套算法，只是把 hex 每一位映射成 16 个花朵符号（✻✼✽✾✿❀ 等连续 Unicode 花符）。",
    principle:
      "与 qqxiuzi_arrow 完全相同的异或 + hex + 符号映射流程，符号表换成从 `chr(10043)` 起的连续 16 个花朵字符。单字节 2 符号 + `=`，多字节 4 符号 + `==`。",
    usage: "encode/decode，可选密码。花符表：`✻✼✽✾✿❀❁❂❃❄❅❆❇❈❉❊`。",
    examples: [
      { in: "中", out: "✿❉✼❈==", desc: "无密码，4 花符 + == 后缀" },
    ],
    tips: ["一串连续花朵 emoji 风格符号 + 结尾 `=`/`==`，基本是 QQ秀花密码。"],
    aka: ["QQ秀花", "花密码", "flower cipher", "QQ秀·花", "qqxiuzi flower", "花朵密码", "花朵符号密码", "QQ秀花朵", "花符密码", "flower code", "QQ秀鲜花密码", "花卉密码"],
  },

  qqxiuzi_ipa: {
    what: "QQ秀·IPA 密码，同套算法，符号表换成 16 个国际音标（IPA）辅音字母（ɐɑɒɓɔɕ 等）。",
    principle:
      "与 qqxiuzi_arrow 相同流程，符号表为 IPA 辅音 `ɐɑɒɓɔɕɖɘəɛɜɟɠɡɢɣ`。注意第 14 个 `ɡ` 是 U+0261（小型大写 G 的变体），不是 ASCII 的 g。",
    usage: "encode/decode，可选密码。",
    examples: [
      { in: "中", out: "ɔɢɑɡ==", desc: "无密码，4 IPA 符号 + == 后缀" },
    ],
    tips: ["`ɡ`(U+0261) 与普通 g 长得像但码位不同，抄写时别混，否则解码错位。"],
    aka: ["QQ秀IPA", "IPA密码", "音标密码", "QQ秀·IPA", "qqxiuzi ipa", "国际音标密码", "IPA cipher", "音标符号密码", "phonetic cipher", "QQ秀音标", "国际音标编码", "辅音符号密码"],
  },

  qqxiuzi_letter: {
    what: "QQ秀·字母密码，同套算法，符号表是一组打乱顺序的拉丁字母（TUVWXYZABCNOPQRS）。",
    principle:
      "与 qqxiuzi_arrow 相同流程，符号表为打乱的 16 个字母 `TUVWXYZABCNOPQRS`。因为符号是普通字母，识别时必须靠结尾的 `=`/`==` 后缀，否则容易和普通英文混淆。",
    usage: "encode/decode，可选密码。",
    examples: [
      { in: "中", out: "XRUQ==", desc: "无密码，4 字母 + == 后缀" },
    ],
    tips: ["字母表和英文重叠，一把梭必须要求 `=`/`==` 后缀才判它，避免把普通英文误报。"],
    aka: ["QQ秀字母", "字母密码", "QQ秀·字母", "qqxiuzi letter", "打乱字母密码", "letter cipher", "拉丁字母密码", "乱序字母密码", "QQ秀拉丁字母", "字母替换密码", "letter code", "QQ秀英文密码"],
  },

  qqxiuzi_braille: {
    what: "QQ秀·盲文密码，把字节映射成盲文点字符号（U+2800 区段），有密码时走 hex 编码，无密码时用「1 字符 = 1 字节」的紧凑形式。",
    principle:
      "有密码：每字节异或后按 hex 映射盲文，单字节 1 符号 + `=`，双字节 2 符号 + `==`。无密码：字节直接异或 48，小于 128 用 1 盲文符，否则拆高低位（高位 `|128`）2 符号 + `=`。",
    usage: "encode/decode，可选密码。盲文基址 U+2800（⠀-⣿）。",
    examples: [
      { in: "A", out: "⡱=", desc: "无密码，单字节 1 盲文符 + = 后缀" },
    ],
    tips: ["盲文点字区段 U+2800-U+28FF 是明显指纹，结尾带 `=`/`==` 更确定。"],
    aka: ["QQ秀盲文", "盲文密码", "braille cipher", "QQ秀·盲文", "qqxiuzi braille", "盲文点字密码", "点字密码", "布莱叶密码", "braille code", "QQ秀点字", "盲文符号密码", "U+2800密码"],
  },

  qqxiuzi_chinese: {
    what: "QQ秀·汉字密码，把字节映射成常用汉字，用三张替换表（单字节/双字节/三字节）覆盖不同码位范围，后缀 `=`/`==`/`===` 区分。",
    principle:
      "按字符码位大小选表：单字节走 SB 表 + `=`，双字节（256-0xFFFF）走 MB 表 + `==`，三字节走三表组合 + `===`。密码推导出双分量 kH/kL 参与异或。某些字节在 SB 表为空时回退查 FIRST_EX 特例表。",
    usage: "encode/decode，可选密码。后缀个数 = 每字符字节数。",
    examples: [
      { in: "A", out: "霄=", desc: "无密码，单字节 → 1 汉字 + = 后缀" },
    ],
    tips: ["密文是「一串常用汉字 + 结尾 1~3 个等号」，等号个数暴露原字符字节宽度。"],
    aka: ["QQ秀汉字", "汉字密码", "QQ秀·汉字", "qqxiuzi chinese", "中文密码", "常用汉字密码", "chinese cipher", "汉字替换密码", "QQ秀中文", "汉字编码", "chinese code", "QQ秀汉字加密"],
  },

  qqxiuzi_music: {
    what: "QQ秀·音乐密码，把字节转十进制后用 10 个音乐符号（♭♯§∮♪♩♫♬ 等）编码，三种前缀后缀区分短/标准/宽模式。",
    principle:
      "每字节异或后转成十进制，用 3 个音乐符号表示（每符号一个数字位）。按数值大小选模式：短模式 `♯=` 前缀（值<100）、标准 `§=`、宽模式 `♪==`（值≥10000，5 符号压缩）。",
    usage: "encode/decode，可选密码。符号集 `‖♭♯§∮♪♩♫♬¶`。",
    examples: [
      { in: "A", out: "♭♭§§=", desc: "无密码，短模式" },
    ],
    tips: ["音乐符号 `♭♯♪♫` 打头，看前缀 `♯=`/`§=`/`♪==` 判模式。"],
    aka: ["QQ秀音乐", "音乐密码", "music cipher", "QQ秀·音乐", "qqxiuzi music", "音乐符号密码", "乐谱密码", "音符密码", "music code", "QQ秀音符", "音乐记号密码", "五线谱密码"],
  },

 // ============================================================
 // 中式编码
 // ============================================================
  huoxingwen: {
    what: "火星文，用形近的生僻字、注音符号、繁体字替换常用简体字，是早年网络流行的「非主流」文字游戏。",
    principle:
      "内置简体/繁体/火星文三张一一对应的字库（各数千字）。加密（转火星文）把简/繁体字查表换成对应的火星文形近字；解密尽量把火星文查回简体。因为火星文表存在重复字符（多个简体对应同一火星文字），解码不保证完美还原原文。",
    usage: "encode 转火星文，decode 转回简体。表外字符原样保留。",
    examples: [
      { in: "你好", out: "沵恏", desc: "简体 → 火星文形近字" },
    ],
    tips: ["火星文不保证完美往返（重复字符导致映射偏移），以「转出去像火星文」为目标而非精确还原。"],
    aka: ["火星文", "非主流文字", "martian text", "火星语", "非主流字体", "网络火星文", "形近字替换", "注音符号密码", "martian language", "火星文转换", "非主流文字转换", "生僻字密码"],
  },

  jianfan: {
    what: "简繁转换，简体中文与繁体中文互转，基于内置的简繁对照表。",
    principle:
      "用简/繁两张一一对应的字库（各约 2800 常用字），encode 把简体字逐字换成繁体，decode 把繁体换回简体。表外字符（英文、标点、生僻字）原样保留。",
    usage: "encode 简→繁，decode 繁→简。",
    examples: [
      { in: "简体转换", out: "簡體轉換", desc: "简 → 繁" },
      { in: "簡體轉換", out: "简体转换", desc: "繁 → 简" },
    ],
    tips: ["只做常用字一对一映射，不处理「一简对多繁」的语义歧义（如「后/後」「里/裡」按表固定取一个）。"],
    aka: ["简繁转换", "繁简转换", "简繁体", "traditional-simplified", "简体繁体互转", "繁体转简体", "简体转繁体", "简繁互转", "简中繁中", "Simplified Chinese", "Traditional Chinese", "中文简繁"],
  },

  fuyouyue: {
    what: "佛又曰（与佛论禅 V2），佛系密码的加密升级版：在心经字符映射之外加了 AES-256-CBC 真加密，密文形如「佛又曰：…」全是佛经字符。",
    principle:
      "用 OpenSSL EVP_BytesToKey(MD5) 从口令派生 key+iv，AES-256-CBC 加密后套 OpenSSL `Salted__` 格式做 base64，再把 base64 的 65 个字符逐一映射成心经/佛经字符，加「佛又曰：」前缀。每次加密随机 salt，故同一明文两次输出不同，但都能解回。",
    usage: "填密钥 key（默认 `takuron.top`），encode 加密、decode 解密。因 AES 异步，op 内部 async。",
    examples: [
      { in: "Hello", param: "key=takuron.top", out: "佛又曰：…（每次随机 salt，输出不同）", desc: "AES-256-CBC + 心经映射，decode 可还原 Hello" },
    ],
    tips: ["和简化版 foyu 不互通：foyu 只是 base64+映射无真加密，fuyouyue 是 AES 真加密。", "口令错则解不出，默认口令 takuron.top。"],
    aka: ["佛又曰", "与佛论禅V2", "新佛曰", "Buddha says V2", "佛曰V2", "与佛论禅2", "佛系密码V2", "心经密码", "佛经密码", "AES佛曰", "禅语密码", "佛又曰加密"],
  },

  tianshu: {
    what: "天书，和佛又曰共用同一套 AES-256-CBC + 字符映射内核，只是把佛经字符换成道经字符，密文形如「曰：…」。",
    principle:
      "与 fuyouyue 完全相同的 EVP_BytesToKey(MD5) + AES-256-CBC + OpenSSL Salted__ base64 流程，字符映射表换成 65 个道经字符，前缀改成「曰：」。同样每次随机 salt。",
    usage: "填密钥 key（默认 `BlackCat184`），encode/decode，op 内部 async。",
    examples: [
      { in: "Hi", param: "key=BlackCat184", out: "曰：…（随机 salt）", desc: "AES-256-CBC + 道经映射，decode 还原 Hi" },
    ],
    tips: ["与佛又曰同内核不同字表，靠前缀「曰：」和道经字符区分。", "默认口令 BlackCat184。"],
    aka: ["天书", "道经密码", "heavenly scripture", "天书密码", "道经加密", "道教密码", "AES天书", "曰密码", "道藏密码", "天书加密", "heavenly book", "道经字符密码"],
  },
};
