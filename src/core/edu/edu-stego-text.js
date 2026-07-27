// 科普内容分片：stego 文本类（零宽 / 变体选择器 / 火星文 / 同形字 / 规范化 / 透视）。纯数据，无 import 无副作用。
export default {
  zeroChar: {
    what: "零宽摩斯密码：先把明文转成摩斯电码，再用三种「看不见」的零宽字符分别代表点、划、分隔，藏进正常文本里。",
    principle:
      "明文 → 摩斯（`.`/`-`）→ 用零宽字符替身：U+200B(分隔)、U+200C(`.`)、U+200D(`-`)。屏幕上完全不显示，复制粘贴却带着走。CJK 等非摩斯字符退化成 `\\uXXXX` 形式再编。",
    usage: "编码把明文藏成零宽串；解码把混着零宽字符的文本还原成明文。",
    examples: [
      { in: "SOS", out: "一串看不见的零宽字符", desc: "S=... O=--- S=... 用零宽点划表示" },
    ],
    tips: ["肉眼字数和实际长度对不上、光标能在「空白」里多停几下 → 疑似零宽。先用 invisibleViz 可视化看清。"],
    aka: ["零宽摩斯", "zero width morse", "零宽字符隐写", "zerochar", "零宽度字符", "zero width characters", "zwsp隐写", "unicode零宽", "看不见的字符隐写", "invisible morse"],
  },

  zwTags: {
    what: "Unicode Tag 走私：用 U+E0000 那一整个「标签」平面藏 ASCII/UTF-8 字节。近年 LLM prompt 注入常拿它偷偷夹指令。",
    principle:
      "Unicode 有个 Tags 区块（U+E0000–U+E007F），历史上给语言标记用，现在废弃、屏幕不渲染。把每个 ASCII 字节加上 U+E0000 偏移映射成一个 tag 字符，就能把整段隐藏文本贴在可见文字后面，肉眼与多数编辑器都看不见。",
    usage: "编码把明文转成 tag 字符隐藏流；解码把 tag 字符还原成 ASCII/UTF-8。",
    examples: [
      { in: "hi", out: "U+E0068 U+E0069（不可见）", desc: "'h'=0x68 → E0000+0x68" },
    ],
    tips: ["AI 聊天里粘来的文本要警惕：可见内容之外可能藏了 tag 走私的隐藏指令。用 charInspect 逐字符看码位。"],
    aka: ["tag走私", "unicode tags", "tag smuggling", "e0000隐写", "prompt注入载体", "unicode标签隐写", "tags block", "标签平面", "u+e0000", "ascii smuggling", "隐藏指令注入", "unicode tag characters"],
  },

  zwVarSel: {
    what: "变体选择器隐写：Paul Butler 2024 的把戏——用 Unicode 变体选择器（本该给 emoji 选样式的字符）在任意一个字符后面挂载一整串隐藏字节。",
    principle:
      "变体选择器 U+FE00–FE0F（16 个）和 U+E0100–E01EF（240 个）共 256 个，正好对应一个字节的 256 种取值。把隐藏数据每字节映射成一个变体选择器，全都附在某个载体字符（如一个 emoji）后面，渲染时不显示，却随字符一起被复制。",
    usage: "编码把明文附加成变体选择器序列挂到载体后；解码把这些选择器还原成字节流。",
    examples: [
      { in: "载体😀 + 隐藏'A'", out: "😀︊…（选择器不可见）", desc: "每字节 → 一个变体选择器" },
    ],
    tips: ["一个 emoji「后面拖着」一长串看不见的东西 → 变体选择器隐写。单个字符能挂任意长度数据是它的特点。"],
    aka: ["变体选择器", "variation selector", "paul butler", "zwvarsel", "emoji变体隐写", "variation selector隐写", "vs隐写", "fe00隐写", "e0100隐写", "变体选择符", "emoji走私", "unicode变体选择器"],
  },

  emojiSubst: {
    what: "emoji 替换隐写：emoji-aes 的替换层，把 base64 的 64 个字符一一换成 emoji（外加几个），配一个 rotation 偏移。注意这里只做替换，不含 AES。",
    principle:
      "先把数据当 base64 看待，再拿一张 65 个 emoji 的码表替换 base64 字母表的每个字符，rotation 参数把码表整体旋转一定位数做简单混淆。解码就是反查码表 + 反旋转 → base64 → 原数据。",
    usage: "编码把文本转成 emoji 串；解码把 emoji 串还原（需对上 rotation）。",
    examples: [
      { in: "Hi", out: "😀🎉🚀…", desc: "base64 字符逐个换成 emoji" },
    ],
    tips: ["看到「一串规律 emoji、数量像 base64」就试它。若真做了 AES 加密（emoji-aes 完整版），还需密钥，这里只解替换层。"],
    aka: ["emoji隐写", "emoji-aes", "emoji替换", "emojisubst", "表情符号隐写", "emoji encode", "emoji密码", "emoji cipher", "表情替换", "emoji base64", "颜文字隐写"],
  },

  hxw: {
    what: "火星文：网络流行的汉字变形写法，用三套 CJK 码表纯查表把简体/繁体换成长得像、但生僻的同音近形字。",
    principle:
      "维护简体↔火星文、繁体↔火星文的固定映射表，编码就是逐字查表替换，解码反查还原。纯查表、无算法，字库里没有的字原样保留。",
    usage: "编码把简体/繁体转成火星文；解码把火星文转回简体。",
    examples: [
      { in: "你好", out: "祢好（火星文形近替换）", desc: "逐字查码表" },
    ],
    tips: ["满屏似曾相识的怪汉字、读音相近 → 火星文，直接丢进来解码还原。"],
    aka: ["火星文", "hxw", "非主流文字", "形近字替换"],
  },

  tadpole: {
    what: "蝌蚪文：把明文包上一串阿拉伯文装饰符号（长得像小蝌蚪），带 checksum 校验，支持两种格式。",
    principle:
      "用 U+06D6–U+06EC 这段阿拉伯文装饰记号做载体，明文先编码再套上这些符号，附一个校验和防止抄错。另有 base64 双格式变体。解码剥掉装饰、验 checksum、还原明文。",
    usage: "编码把明文转成蝌蚪文；解码把蝌蚪文还原（会校验 checksum）。",
    examples: [
      { in: "flag", out: "ۖۗۘ…（蝌蚪状符号串）" },
    ],
    tips: ["满屏阿拉伯文小记号、密密麻麻像蝌蚪 → 蝌蚪文。checksum 对不上说明串被改动过。"],
    aka: ["蝌蚪文", "tadpole", "阿拉伯装饰符隐写", "arabic diacritics隐写", "阿拉伯变音符号", "arabic marks", "小蝌蚪文字", "阿拉伯符号密码", "tadpole cipher", "arabic tadpole", "阿拉伯文隐写"],
  },

  confusablesScan: {
    what: "同形异义字检测：揪出文本里那些「长得像拉丁字母、其实是西里尔/希腊字母」的冒牌货。钓鱼域名、仿冒串的常见伎俩。",
    principle:
      "西里尔的 а(U+0430)、希腊的 ο(U+03BF) 和拉丁 a、o 在屏幕上几乎一模一样，但码位完全不同。工具遍历文本，标出脚本（书写系统）混用的可疑字符——正常英文单词里混进一个西里尔字母就是红旗。",
    usage: "粘可疑文本/域名，工具列出混用的同形字及其真实脚本。",
    examples: [
      { in: "раypal（含西里尔 р/а）", out: "检出 2 个西里尔字符伪装成拉丁" },
    ],
    tips: ["钓鱼题/仿冒域名题的核心检查。看着是英文却混了别的语言字母 = homoglyph 攻击。"],
    aka: ["同形字检测", "homoglyph", "confusables scan", "混淆字符", "同形异义字", "homoglyph attack", "homograph", "西里尔伪装", "钓鱼域名检测", "混淆字检测", "idn homograph", "相似字符检测", "unicode混淆检测"],
  },

  unicodeNormalize: {
    what: "Unicode 规范化：同一个字符可能有好几种编码写法，规范化把它们统一成标准形。NFC/NFD/NFKC/NFKD 四种形式互转。",
    principle:
      "如 é 可以是单码位 U+00E9，也可以是 e + 组合重音 U+0301。NFC/NFD 是「组合/分解」的等价规范化（保义），NFKC/NFKD 是「兼容」规范化（会把 ① ﬁ ² 这类展开成 1 fi 2，改变外观）。工具做四种转换 + 变化点分析。",
    usage: "粘文本，选目标形式（NFC/NFD/NFKC/NFKD），输出规范化结果和变化的位置。",
    examples: [
      { in: "ﬁ（连字 U+FB01）", param: "NFKC", out: "fi（拆成两字母）" },
    ],
    tips: ["绕过过滤/藏 flag 常靠兼容字符：NFKC 一化就现原形。全角、连字、上下标都会被 NFKC 摊平。"],
    aka: ["unicode规范化", "normalization", "nfc", "nfkc", "nfd", "nfkd", "unicode normalization", "规范化形式", "normalization form", "兼容规范化", "组合分解", "全角半角规范化", "unicode标准化"],
  },

  whitespaceScan: {
    what: "空格隐写检测：文本里不只有普通空格，还有一堆长得一样的特殊空白（NBSP、Em Space、细空格…）。工具把它们扫出来，还试着解行尾空白编码的隐藏数据。",
    principle:
      "Unicode 有几十种空白字符，视觉上都是「空」，码位却不同（U+00A0 NBSP、U+2003 Em Space、U+2009 Thin Space…）。工具遍历标出所有非普通空格，并尝试 Snow 类手法：把行尾的空格/制表符当二进制位解码。",
    usage: "粘可疑文本，输出各类空白字符命中位置 + 行尾空白 LSB 解码尝试。",
    examples: [
      { in: "行尾藏空格/Tab 的文本", out: "特殊空白清单 + 尝试解出的隐藏比特" },
    ],
    tips: ["行尾看不见的空格/Tab 组合是 Snow 隐写的招牌。普通空格和 NBSP 混用也值得警惕。"],
    aka: ["空格隐写", "whitespace scan", "snow隐写", "空白字符检测", "whitespace steganography", "空白隐写", "snow steganography", "行尾空格隐写", "nbsp检测", "特殊空白检测", "制表符隐写", "tab space隐写"],
  },

  bidiScan: {
    what: "双向控制符检测：揪出 U+202E(RLO) 这类能让文本「从右往左」显示的控制符。Trojan Source 攻击就靠它让源码看起来是一回事、编译起来是另一回事。",
    principle:
      "Bidi 控制符（RLO/LRO/RLE/PDF 等）本用于阿拉伯语/希伯来语混排，能强行改变字符显示顺序。恶意利用时可把代码/文件名的可见顺序和实际字节顺序错开，人看到的和机器执行的不一致。工具检出这些控制符、评风险、可一键剥离。",
    usage: "粘可疑文本/源码，输出 Bidi 控制符命中 + 风险评级 + 剥离后文本。",
    examples: [
      { in: "含 U+202E 的字符串", out: "检出 RLO，风险高，建议剥离" },
    ],
    tips: ["文件名如 `exe.txt` 实为 `txt.exe` 被 RLO 翻转 → 经典伪装。源码审计题看有没有 Bidi 控制符。"],
    aka: ["bidi检测", "trojan source", "rlo", "u+202e", "双向控制符", "bidi override", "从右向左覆盖", "rtl override", "双向文本攻击", "bidi control characters", "lro rle pdf", "特洛伊源码", "unicode bidi"],
  },

  charInspect: {
    what: "字符属性透视：逐个字符摊开看它的码位、UTF-8/UTF-16 字节、属于什么脚本、Unicode 类别和所在区块。看不懂的怪字符靠它验明正身。",
    principle:
      "对每个字符查 Unicode 数据库：码位（U+XXXX）、UTF-8/UTF-16 编码字节、Script（拉丁/西里尔/汉字…）、General Category（字母/标点/控制符…）、Block 名称。一字一行列清楚。",
    usage: "粘文本，输出逐字符的完整属性表。",
    examples: [
      { in: "A你", out: "A: U+0041 拉丁字母; 你: U+4F60 CJK 统一表意" },
    ],
    tips: ["怀疑有隐藏/伪装字符但不知是啥，用它逐字看码位最靠谱。零宽、同形字、控制符一览无余。"],
    aka: ["字符透视", "char inspect", "码位查看", "字符属性", "character inspector", "码点分析", "codepoint viewer", "unicode属性查看", "字符详情", "字符解剖", "codepoint inspect", "字符码位分析"],
  },

  invisibleViz: {
    what: "不可见字符可视化：把文本里所有零宽、控制符、BOM、各种空白统一换成看得见的占位符，一眼看清藏了什么、藏在哪。",
    principle:
      "维护一张「不可见/易混字符 → 可见标记」的映射，遍历文本命中就替换成醒目占位符，并统计各类型数量、列出命中清单，同时提供一键剥离得到干净文本。",
    usage: "粘可疑文本，输出可视化后的文本 + 命中清单 + 类型统计 + 剥离结果。",
    examples: [
      { in: "含零宽和 BOM 的文本", out: "[ZWSP][BOM] 等占位符标出位置" },
    ],
    tips: ["零宽/tag 走私/空白隐写题的通用第一步：先可视化看清有没有货、大概是哪类，再选对应解码工具。"],
    aka: ["不可见字符可视化", "invisible viz", "隐藏字符可视化", "字符透视", "invisible character visualization", "零宽字符可视化", "show invisible", "不可见字符显示", "隐藏字符检测", "reveal hidden characters", "控制符可视化", "空白可视化"],
  },

  confusablesSkeleton: {
    what: "同形字骨架归一化：把西里尔/希腊/全角等同形字统一替换成它们的 ASCII「视觉骨架」，用来做仿冒串、钓鱼域名的比对。",
    principle:
      "Unicode 维护一张 confusables 表，规定每个易混字符的「骨架」（视觉上等价的标准形）。工具按表把 раypal 里的西里尔字符换回拉丁骨架 paypal，这样伪装串和真串归一后就能直接比对是否相同。",
    usage: "粘文本，输出骨架归一化后的 ASCII 串（单向）。",
    examples: [
      { in: "раypal（含西里尔）", out: "paypal", desc: "同形字全归一到拉丁骨架" },
    ],
    tips: ["和 confusablesScan 配套：Scan 告诉你哪儿有诈，Skeleton 把它拍回原形好和白名单比对。"],
    aka: ["同形字骨架", "confusables skeleton", "骨架归一化", "钓鱼域名比对", "unicode skeleton", "confusable skeleton", "视觉骨架", "同形字归一", "skeleton algorithm", "混淆字骨架", "相似字归一化", "homoglyph skeleton"],
  },
};
