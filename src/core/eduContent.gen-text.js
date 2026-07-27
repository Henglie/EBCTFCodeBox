/*
 * eduContent.gen-text.js — 科普卡数据分片：文本/传输编码分类补充。
 * 纯数据，无 import、无副作用。格式契约见 eduContent.js 头注释。
 * 面向大一大二学生：通俗、准确、能跑通的例子。
 * 覆盖 text 分类中 uuencode 等 25 个 op（不含已在别处覆盖的 url/htmlEntity/unicodeEscape/quotedPrintable/jsfuck/mixHexOctBin）。
 */

export default {
 // ============ Unix 系历史编码 ============
  uuencode: {
    what: "UNIX 早期把二进制文件塞进纯文本邮件/新闻组用的编码，全称 Unix-to-Unix encoding。Base64 出现前就是靠它传附件。",
    principle:
      "和 base64 一样按每 3 字节（24 位）拆成 4 组 6 位，但映射方式不同：每个 6 位值（0~63）直接加上 32，得到可打印 ASCII（空格到下划线，即 `chr(v+32)`）。\n\n" +
      "整体是行结构：`begin <权限> <文件名>` 开头，每一行首字符是「本行编码了多少原始字节」的计数（同样 `+32`），行尾以 ` ` 或 `` ` `` 结束，最后 `end` 收尾。",
    usage: "解码方向：粘 `begin ...` 到 `end` 的整段一键还原。编码方向：输原文，自动加 begin/end 包裹。",
    examples: [
      { in: "begin 644 a.txt\n#0V%T\n`\nend", out: "Cat", desc: "行首 # 是计数字符（值 3=编码了 3 字节）" },
      { in: "Cat", param: "编码方向", out: "begin 644 -\n#0V%T\n`\nend" },
    ],
    tips: [
      "看到 `begin 644 文件名` 开头、`end` 结尾、正文全是 32~95 区间可打印符号，就是 UUencode。",
      "和 XXencode 结构一模一样，区别只在码表：UU 用 32~95 连续区间（含空格和标点），XX 用字母数字。",
    ],
    aka: ["uuencode", "uuenc", "Unix-to-Unix", "uu 编码", "uu编码", "unix to unix encoding", "uue", "begin end 编码", "uuencoding", "uu 编码解码", "unix邮件编码", "uu format"],
  },

  xxencode: {
    what: "UUencode 的兄弟版：结构完全相同，但把码表换成了纯字母数字（`+-0-9A-Za-z`），避开空格和标点，方便过一些会吃掉特殊字符的老系统。",
    principle:
      "同样每 3 字节 → 4 个 6 位组，但 6 位值查一张固定 64 字符表：`+-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz`。\n\n" +
      "行结构和 UU 一致：`begin` 头、每行首字符编码本行字节数、`end` 尾。",
    usage: "粘整段 `begin...end` 一键解码；编码方向输原文自动包裹。",
    examples: [
      { in: "begin 644 a\n0G4Y+\n+\nend", out: "Hi", desc: "码表全是字母数字，没有空格标点" },
      { in: "Hi", param: "编码方向", out: "begin 644 -\n0G4Y+\n+\nend" },
    ],
    tips: [
      "长得像 UUencode 但正文只有 `+-` 加字母数字、没有空格标点，就是 XXencode。",
      "两者极易混淆，解错了就换另一个试。",
    ],
    aka: ["xxencode", "xxenc", "XX 编码", "xx编码", "xxencoding", "xx format", "字母数字uu", "xx 编码解码", "uuencode变体", "xxe编码", "xx 变体编码"],
  },

 // ============ UTF 变体 / 域名 ============
  utf7: {
    what: "一种把 Unicode 塞进 7 位 ASCII 通道的编码（RFC 2152），当年为只认 7 位的老邮件系统设计。因为能藏东西，也是 XSS 绕过的经典手法。",
    principle:
      "ASCII 可打印字符大多直接原样输出；非 ASCII 字符先转成 UTF-16BE 字节，再用「修改版 base64」编码，用 `+` 开头、`-` 结尾包起来。\n\n" +
      "例如 `+` 自身要写成 `+-`。这种「一段普通文本 + 一段 `+xxx-`」交替的样子是它的招牌。",
    usage: "解码方向：粘 UTF-7 文本还原成正常 Unicode；编码方向：把含中文/符号的文本转成 UTF-7。",
    examples: [
      { in: "+ZeVnLIqe-", out: "日本語", desc: "+...- 包住的是 base64 化的 UTF-16BE" },
      { in: "Hi +AKM-", out: "Hi £", desc: "英文直出，£ 被编码" },
    ],
    tips: [
      "看到文本里夹着 `+XXXX-` 这种 `+` 开头 `-` 结尾的片段，优先考虑 UTF-7。",
      "Web 题里 UTF-7 常用来绕 XSS 过滤（旧 IE 会自动按 UTF-7 解析页面）。",
    ],
    aka: ["utf-7", "utf7", "RFC 2152", "unicode transformation format 7", "7位unicode编码", "utf-7编码", "邮件unicode编码", "utf7 xss", "修改版base64", "utf-7 xss绕过", "7位ascii unicode"],
  },

  punycode: {
    what: "把含中文、emoji 等非 ASCII 的域名，转成纯 ASCII 的 `xn--` 形式（RFC 3492），让老 DNS 系统也能处理国际化域名（IDN）。",
    principle:
      "先把字符串里的 ASCII 部分原样保留，再用一套「增量 + 广义变长整数」算法，把非 ASCII 码点按顺序编码追加在后面，整段加 `xn--` 前缀。\n\n" +
      "算法核心是 Bootstring：用不断调整的偏移和阈值，把大码点差值压成尽量短的字母数字串。工具按 `.` 分段处理，只对含非 ASCII 的标签加 `xn--`。",
    usage: "解码方向：粘 `xn--` 域名还原成 Unicode；编码方向：把中文域名转成 `xn--` 形式。",
    examples: [
      { in: "xn--fsq.com", out: "例.com", desc: "「例.com」的 Punycode" },
      { in: "中文.网", param: "编码方向", out: "xn--fiq228c.xn--ur0a" },
    ],
    tips: [
      "看到 `xn--` 前缀基本就是 Punycode 域名，钓鱼域名常用它伪装成正常网址。",
      "只对每个 `.` 分段单独处理，纯 ASCII 段不加前缀。",
    ],
    aka: ["punycode", "puny", "IDN", "xn--", "国际化域名", "RFC 3492", "中文域名编码", "bootstring", "internationalized domain name", "puny 编码", "域名编码", "xn--前缀"],
  },

  utf16: {
    what: "Unicode 的一种字节表示：每个字符用 2 或 4 字节。Windows 内部、Java/JS 字符串底层都用它。关键坑是字节序（BE/LE）。",
    principle:
      "基本多语言平面（BMP，U+0000~U+FFFF）的字符直接用 2 字节表示；超出的用 4 字节「代理对」。\n\n" +
      "字节序决定谁在前：BE（大端）高字节在前，LE（小端）低字节在前。文件开头的 BOM（`FE FF` = BE，`FF FE` = LE）用来标记字节序。工具编码时可选加不加 BOM，解码时能自动识别 BOM。",
    usage: "参数选 BE/LE 和是否加 BOM。解码时若串带 BOM 会自动判方向。输入通常是 hex 字节。",
    examples: [
      { in: "00480049", param: "BE", out: "HI", desc: "大端：每字符高字节在前" },
      { in: "48004900", param: "LE", out: "HI", desc: "小端：字节两两互换" },
    ],
    tips: [
      "hex 里每隔一个字节就出现一个 `00`（英文场景），是 UTF-16 的强特征。",
      "开头 `FEFF`/`FFFE` 是 BOM，能直接判出字节序。",
    ],
    aka: ["utf-16", "utf16", "ucs-2", "UTF-16BE", "UTF-16LE", "utf-16le", "utf-16be", "unicode 16位", "大端小端编码", "BOM 字节序", "宽字符编码", "双字节unicode"],
  },

 // ============ 字节转义 / 变换 ============
  jsHex: {
    what: "把字节写成 `\\xXX` 形式的转义，JS/PHP/C 字符串里常见。注意它是「按字节」，和 `\\uXXXX`（按 Unicode 码点）不是一回事。",
    principle:
      "每个字节转成 `\\x` + 两位十六进制。多字节字符（如中文）会被拆成它 UTF-8 编码的每个字节，各自一个 `\\xXX`，所以一个汉字通常变成 3 个 `\\x`。",
    usage: "解码方向：粘 `\\xXX...` 还原成原文；编码方向：把原文按字节转成 `\\xXX` 串。参数可控制是否只转非 ASCII。",
    examples: [
      { in: "\\x48\\x69", out: "Hi" },
      { in: "flag", param: "编码方向", out: "\\x66\\x6c\\x61\\x67" },
    ],
    tips: [
      "满屏 `\\x` 加两位 hex 就是它。混进代码字符串里的 payload 常这么藏。",
      "和 `\\uXXXX` 区分：`\\x` 两位是字节级，`\\u` 四位是码点级。",
    ],
    aka: ["\\x escape", "js hex", "hex escape", "字节转义", "\\xXX", "十六进制转义", "hex转义", "php hex escape", "c hex escape", "反斜杠x转义", "字节级转义", "hex string escape"],
  },

  hexReverse: {
    what: "把每两位一组的 hex 字节内高低位互换：`1a2b` → `a1b2`。一个小把戏，做两次就还原（自反）。",
    principle:
      "把输入按每 2 个 hex 字符（= 一个字节）分组，组内两个字符互换位置。因为只是「换回来又换回去」，编码和解码是同一个操作。",
    usage: "编解码方向相同，粘 hex 串直接跑。常和真正的 hex 解码配合，用来纠正被打乱的字节。",
    examples: [
      { in: "1a2b", out: "a1b2", desc: "组内两字符互换" },
      { in: "a1b2", out: "1a2b", desc: "再跑一次就回来了" },
    ],
    tips: [
      "题目给的 hex 解出来是乱码，试试组内反转再解，常有奇效。",
      "自反操作，不用纠结方向。",
    ],
    aka: ["hex reverse", "nibble swap", "字节内反转", "半字节交换", "hex nibble swap", "字节反转", "hex高低位互换", "nibble reverse", "高低位交换", "字节内高低位互换", "hex swap", "半字节反转"],
  },

  leetSpeak: {
    what: "黑客俚语「1337」写法：把字母换成长得像的数字符号，A→4、E→3、O→0、S→5、T→7 等。密码、ID、flag 里常见。",
    principle:
      "一张字母到相似字符的替换表（`leet` 本身就写作 `1337`）。编码按表替换，解码把数字符号还原回字母。因为一个字母可能对应多种写法，解码通常取最常见映射。",
    usage: "编码方向把普通文本「黑话化」；解码方向把 `1337` 文本还原。",
    examples: [
      { in: "leet", param: "编码方向", out: "1337", desc: "l→1, e→3, t→7" },
      { in: "h4ck3r", out: "hacker" },
    ],
    tips: [
      "文本里字母和数字混着、读出来像英文单词（`p455w0rd`=password），就是 Leet。",
      "解码有歧义时结合上下文猜，一个符号可能来自多个字母。",
    ],
    aka: ["leet", "1337", "leetspeak", "火星文英文版", "leet speak", "黑客俚语", "leet code", "1337speak", "l33t", "数字替字母", "eleet", "黑话编码"],
  },

  netbios: {
    what: "老 Windows 网络（NetBIOS）里对名字的一种编码：每个字节拆成两个半字节，各自加上字母 'A' 的偏移，结果全是大写字母对。",
    principle:
      "每个字节拆成高 4 位、低 4 位（各 0~15），每个半字节值 $v$ 映射成字符 $\\mathtt{A}+v$。\n\n" +
      "所以 1 字节固定变 2 个字母（范围 A~P），一段名字长度总是翻倍、且只含 A~P。",
    usage: "解码方向：粘 A~P 字母对还原；编码方向：把原文转成 NetBIOS 名。",
    examples: [
      { in: "FEEC", out: "TB", desc: "每字节 2 字母：T=0x54→FE，B=0x42→EC（半字节+A）" },
      { in: "Cat", param: "编码方向", out: "EDGBHE", desc: "每字节 2 字母，范围 A~P" },
    ],
    tips: [
      "整串只有 A~P 十六个大写字母、长度是偶数，优先想 NetBIOS 名编码。",
      "抓包看到 SMB/NetBIOS 会话里这种 `CKAAAA...` 名字就是它。",
    ],
    aka: ["netbios", "netbios name", "第一级半字节编码", "netbios name encoding", "NetBIOS 名编码", "L1 encoding", "第一级编码", "半字节加A", "SMB 名编码", "netbios 命名", "A-P 编码", "nbt name"],
  },

  caretMdecode: {
    what: "UNIX 里控制字符的两种可读写法：`^X` 表示 Ctrl+X（如 `^M` 是回车），`M-X` 表示 Meta/带高位的字符。cat -v、终端转储里常见。",
    principle:
      "`^X`：把字母 X 与 `0x1F` 做与运算得到控制码，即 `Ctrl+字母 = 字母 & 0x1F`（`^A`=0x01，`^M`=0x0D）。`^?` 特指 DEL(0x7F)。\n\n" +
      "`M-X`：Meta 前缀，把后面字符值「或上 `0x80`」（`| 0x80`），表示带高位的字节。两者可组合成 `M-^X`。",
    usage: "解码方向：粘含 `^X`/`M-X` 的文本还原成真实字节；编码方向：把控制字符转成可读的 `^`/`M-` 记法。",
    examples: [
      { in: "^M", out: "\\r", desc: "^M = Ctrl+M = 0x0D = 回车" },
      { in: "^I", out: "\\t", desc: "^I = Tab" },
    ],
    tips: [
      "`cat -v` 输出、终端日志里看到 `^M`、`^@`、`^[` 就是控制字符的这种表示。",
      "`^[` 是 ESC(0x1B)，抓 ANSI 转义序列时经常撞到。",
    ],
    aka: ["caret notation", "^X", "M-notation", "cat -v", "控制字符记法", "脱字符记法", "caret 记法", "Meta 记法", "^M", "M-X", "控制字符可视化", "caret M notation"],
  },

 // ============ 拼读 / 名称表 ============
  natoAlphabet: {
    what: "北约音标字母表：A→Alpha、B→Bravo、C→Charlie……无线电通话里用单词代替字母，防止听错。CTF 里偶尔当趣味编码。",
    principle:
      "一张 26 字母到固定单词的对照表（Alpha Bravo Charlie Delta Echo Foxtrot...）。编码逐字母替单词，解码取每个单词首字母还原。",
    usage: "编码方向把文本转成音标单词串；解码方向把单词串还原成字母。",
    examples: [
      { in: "Foxtrot Lima Alpha Golf", out: "FLAG", desc: "取每个单词首字母" },
      { in: "HI", param: "编码方向", out: "Hotel India" },
    ],
    tips: [
      "看到一串 Alpha/Bravo/Charlie 这类固定单词，取首字母连起来就是答案。",
      "数字也有读法（如 niner=9），但核心是 26 字母表。",
    ],
    aka: ["nato", "phonetic alphabet", "北约音标", "无线电字母表", "Alpha Bravo Charlie", "nato alphabet", "北约音标字母", "音标字母表", "无线电拼读", "军用字母表", "国际音标字母", "spelling alphabet"],
  },

  asciiControl: {
    what: "ASCII 前 32 个（0~31）加 DEL(127) 是不可打印的控制字符，各有名字（NUL、SOH、STX、LF、CR、ESC...）。这个功能做名称、数值、符号之间的互查。",
    principle:
      "每个控制字符有：十进制/十六进制值、缩写名（如 `CR`=0x0D）、Unicode 里的「控制图形」符号（如 `\\u2400` 系列）。工具在名称 ↔ 数值 ↔ 符号之间转换。",
    usage: "输名字（CR/LF/ESC）查值，或输值查名。参数可选输出用缩写名还是可视符号。",
    examples: [
      { in: "CR", out: "ASCII 值: 13 (0x0D), 名称: CR, 符号: ␍, 转义: \\r", desc: "名称 → 值：回车 = 0x0D = 13" },
      { in: "ESC", out: "ASCII 值: 27, 名称: ESC, 符号: ␛", desc: "名称 → 值：ESC = 0x1B = 27" },
    ],
    tips: [
      "记几个高频的：`09`=Tab、`0A`=LF换行、`0D`=CR回车、`1B`=ESC、`00`=NUL、`7F`=DEL。",
      "分析二进制/协议时用来快速认出控制字节的含义。",
    ],
    aka: ["ascii control", "控制字符", "control code", "C0 controls", "ascii控制字符", "控制码", "control character", "不可打印字符", "C0控制码", "NUL SOH STX", "控制字符表", "ascii control chars"],
  },

 // ============ 中文/东亚字符集 ============
  gbCharset: {
    what: "中文常用字符集家族：GB2312（老，简体常用字）、GBK（扩到繁体和更多字）、GB18030（覆盖全 Unicode）。Windows 中文系统默认就是这套。",
    principle:
      "都是「ASCII 单字节直通 + 汉字用多字节」的变长编码，且向后兼容：GB2312 ⊂ GBK ⊂ GB18030。汉字通常用双字节（首字节 ≥0x81），GB18030 还有四字节区覆盖冷僻字。\n\n" +
      "工具用浏览器 `TextDecoder` 解码，编码方向靠运行时反向建表实现。",
    usage: "参数选具体字符集（gb2312/gbk/gb18030）。解码方向：粘 hex 字节还原中文；编码方向：中文转对应字节。",
    examples: [
      { in: "C4E3BAC3", param: "gbk", out: "你好", desc: "「你好」的 GBK 编码" },
      { in: "中文", param: "gbk / 编码方向", out: "D6D0CEC4" },
    ],
    tips: [
      "中文乱码显示成一堆西欧怪符号，多半是 GBK 字节被当 Latin-1/UTF-8 解了，反向即可修。",
      "双字节、首字节大多在 0x81~0xFE，是 GB 系的特征。",
    ],
    aka: ["gbk", "gb2312", "gb18030", "国标码", "中文字符集", "国标编码", "汉字编码", "cp936", "简体中文编码", "gb码", "chinese charset", "gb系编码"],
  },

  gb2312QuWei: {
    what: "GB2312 的「区位码」表示：每个汉字用 4 位十进制数字，前两位是「区」（01~94），后两位是「位」（01~94）。老式中文输入法和电报常用。",
    principle:
      "把汉字定位到一张 94×94 的方阵：区号、位号各 1~94。转成 GB2312 字节时，两个字节分别是「区+0xA0」和「位+0xA0」。ASCII 字符透传不变。\n\n" +
      "所以区位码 ↔ 字节：$\\text{高字节}=\\text{区}+0\\mathrm{xA0}$，$\\text{低字节}=\\text{位}+0\\mathrm{xA0}$。",
    usage: "解码方向：粘 4 位区位码串还原汉字；编码方向：汉字转区位码。",
    examples: [
      { in: "1601", out: "啊", desc: "区 16 位 01 → 「啊」（GB2312 首字）" },
      { in: "中", param: "编码方向", out: "5448", desc: "「中」= 区54 位48" },
    ],
    tips: [
      "一串每 4 位一组、每组两个两位数都在 01~94 之间的纯数字，考虑区位码。",
      "区位 + 0xA0 就得到 GB2312 字节，两者可互转。",
    ],
    aka: ["区位码", "quwei", "gb2312 区位", "电报码风格", "quwei code", "区位编码", "gb2312区位码", "94区位", "区号位号", "location code", "区位定位码", "汉字区位码"],
  },

  big5: {
    what: "繁体中文的主流字符集，台湾、香港地区常用。双字节编码，和 GBK 不兼容，所以简繁系统间传文件常撞乱码。",
    principle:
      "ASCII 单字节直通，繁体汉字用双字节（首字节 0x81~0xFE，次字节分两段）。工具用 `TextDecoder('big5')` 解码，编码靠反向建表。",
    usage: "参数选编解码方向。解码：粘 Big5 hex 字节出繁体；编码：繁体转 Big5 字节。",
    examples: [
      { in: "繁體", param: "编码方向", out: "C163C5E9", desc: "「繁體」的 Big5 编码" },
      { in: "B0EAA672", out: "國字", desc: "Big5 字节还原繁体「國字」" },
    ],
    tips: [
      "繁体内容乱码、且不是 GBK，多半是 Big5 被错解。",
      "Big5 和 GBK 都双字节但码位不同，解错就互换试。",
    ],
    aka: ["big5", "big-5", "大五码", "繁体字符集", "big five", "五大码", "cp950", "繁体中文编码", "台湾编码", "香港繁体编码", "traditional chinese charset", "big5繁体"],
  },

  shiftJis: {
    what: "日文的经典字符集（微软推的 Shift-JIS，即 CP932），覆盖假名和汉字。日本游戏、老软件、文本文件里到处都是。",
    principle:
      "兼容 ASCII 和半角片假名（单字节），全角字符用双字节。因为它把双字节的首字节「移位」到特定区间（故名 Shift），和其它编码冲突。工具用 `TextDecoder('shift_jis')` 解码。",
    usage: "选方向。解码：粘 Shift-JIS 字节出日文；编码：日文转字节。",
    examples: [
      { in: "あ", param: "编码方向", out: "82A0", desc: "平假名「あ」的 Shift-JIS" },
      { in: "83458343", out: "ウイ", desc: "字节还原片假名" },
    ],
    tips: [
      "日文乱码、字节里常见 0x82/0x83 开头，多半是 Shift-JIS。",
      "半角片假名是单字节（0xA1~0xDF），全角双字节。",
    ],
    aka: ["shift-jis", "shift_jis", "sjis", "cp932", "日文字符集", "shiftjis", "移位jis", "日语编码", "japanese charset", "windows-31j", "ms932", "日文shift jis"],
  },

  eucKr: {
    what: "韩文的常用字符集（EUC-KR，即 CP949），覆盖谚文（한글）和汉字。韩国老网站、软件常用。",
    principle:
      "ASCII 单字节直通，谚文/汉字用双字节（首字节 0xA1~0xFE 等区间）。工具用 `TextDecoder('euc-kr')` 解码，编码靠反向建表。",
    usage: "选方向。解码：粘 EUC-KR 字节出韩文；编码：韩文转字节。",
    examples: [
      { in: "안녕", param: "编码方向", out: "BEC8B3E7", desc: "「안녕」的 EUC-KR（示意）" },
      { in: "C7D1B1DB", out: "한글", desc: "字节还原谚文「한글」" },
    ],
    tips: [
      "韩文乱码、双字节且首字节多在 0xB0~0xC8 区间，考虑 EUC-KR。",
      "CP949 是 EUC-KR 的微软扩展，绝大多数场景可当同一个处理。",
    ],
    aka: ["euc-kr", "euckr", "cp949", "ks c 5601", "韩文字符集", "euc kr", "韩语编码", "谚文编码", "korean charset", "ksc5601", "uhc", "韩文euc"],
  },

  latinCharset: {
    what: "西欧/单字节字符集大家族：ISO-8859 全系列（Latin-1 到 Latin-15）和 Windows 码页（1252 等）。每个字节直接对一个字符，是最简单的编码。",
    principle:
      "0~127 就是 ASCII，128~255 各码页定义不同字符（重音字母、货币符号等）。因为一字节一字符、没有多字节，所以「解码永不失败」——这也是它常被误用来当中转、制造乱码的原因。",
    usage: "参数选具体码页（iso-8859-1/-15、windows-1252 等）。解码：字节 → 字符；编码：字符 → 字节。",
    examples: [
      { in: "E9", param: "iso-8859-1", out: "é", desc: "0xE9 在 Latin-1 = é" },
      { in: "80", param: "windows-1252", out: "€", desc: "0x80 在 CP1252 = €（Latin-1 里则是控制符）" },
    ],
    tips: [
      "任意字节都能被 Latin-1 无损解出，所以它是修乱码的万能中转层。",
      "UTF-8 中文被 Latin-1 解会变成一串 Ã©â 之类，反向按 Latin-1 编码回字节再按 UTF-8 解就能救。",
    ],
    aka: ["iso-8859", "latin-1", "latin1", "windows-1252", "cp1252", "西欧编码", "iso8859-1", "latin 1", "拉丁编码", "单字节编码", "西欧字符集", "iso latin", "windows西欧码页"],
  },

  ebcdic: {
    what: "IBM 大型机（主机/mainframe）用的老字符集，和 ASCII 完全不同的排布。做金融、政企老系统逆向或取证时会撞到。",
    principle:
      "8 位编码，但字母数字的码位和 ASCII 不一样（比如 `A` 在 EBCDIC 是 0xC1 而非 0x41），字母之间还不连续。因浏览器 `TextDecoder` 不支持，工具内嵌了 037/1047 等码表做转换。",
    usage: "参数选码页（037、1047 等）。解码：EBCDIC 字节 → ASCII 文本；编码：文本 → EBCDIC 字节。",
    examples: [
      { in: "C8C9", out: "HI", desc: "EBCDIC 里 H=0xC8 I=0xC9" },
      { in: "flag", param: "编码方向 / cp037", out: "86938187" },
    ],
    tips: [
      "字母出现在 0xC1~0xE9 高位区、`A`=0xC1，是 EBCDIC 的强特征。",
      "从大型机导出的数据、老银行报文乱码，试 EBCDIC。",
    ],
    aka: ["ebcdic", "cp037", "cp1047", "ibm 主机编码", "大型机字符集", "扩展二进制编码", "extended binary coded decimal", "ibm编码", "mainframe编码", "主机字符集", "ebcdic037", "ibm主机码"],
  },

  mojibakeFix: {
    what: "「乱码修复」工具：中文/日文被错误字符集解读成一堆怪符号（日语叫 mojibake 文字化け）时，尝试还原成正确文本。",
    principle:
      "乱码本质是「字节用错了字符集解码」。修复就是逆推：把乱码文本按它被误解的字符集重新编码回原始字节，再用正确字符集解码。\n\n" +
      "常见错配链：UTF-8 字节被当 Latin-1/GBK 解；GBK 字节被当 UTF-8 解。工具枚举常见错配组合，decode=尝试修复，encode=按指定错配制造乱码样例。部分方向有损、无法完美还原。",
    usage: "把乱码粘进来，选或让它枚举错配方向。修复不保证 100%，有损时会尽量还原可读部分。",
    examples: [
      { in: "ä½ å¥½", out: "你好", desc: "UTF-8 的「你好」被 Latin-1 误解后修回" },
      { in: "浣犲風", out: "——", desc: "GBK↔UTF-8 错配的典型乱码（示意）" },
    ],
    tips: [
      "满屏 Ã©â€ 之类 → UTF-8 被 Latin-1 解，最常见。",
      "满屏「锟斤拷」→ UTF-8 替换符被 GBK 解的经典中文乱码。",
      "「烫烫烫/屯屯屯」是未初始化内存 + GBK，不是编码错配，修不回。",
    ],
    aka: ["mojibake", "乱码修复", "文字化け", "锟斤拷", "garbled text", "乱码还原", "编码修复", "charset fix", "encoding fix", "乱码转换", "fix mojibake", "中文乱码修复"],
  },

 // ============ Web / 网络协议解析 ============
  urlQueryParse: {
    what: "把 URL 里 `?` 后面的查询串（`k=v&k=v&...`）拆开，逐个列出键值对。做 Web 题、抓包分析时快速看参数。",
    principle:
      "按 `&` 切成一个个 `key=value`，对键和值分别做 percent-decode（`%XX` 还原），并把 `+` 当空格处理（`application/x-www-form-urlencoded` 规则）。支持直接粘完整 URL，会自动取 `?` 之后部分。",
    usage: "粘查询串或整条 URL，一键得到逐行的键值列表。",
    examples: [
      { in: "?name=%E4%BD%A0&id=1", out: "name = 你\nid = 1", desc: "%E4%BD%A0 解回「你」" },
      { in: "https://a.com/x?q=a+b&p=2", out: "q = a b\np = 2", desc: "+ 转空格，整 URL 也能吃" },
    ],
    tips: [
      "同名键出现多次会各列一行，别漏。",
      "值里还有 base64/JSON 是常态，拆出来接着丢一把梭。",
    ],
    aka: ["url query", "query string", "查询串解析", "querystring", "url参数解析", "query参数", "GET参数", "urlencoded", "表单编码", "url参数拆分", "问号参数"],
  },

  cookieParse: {
    what: "解析 HTTP Cookie：既能拆请求里的 `Cookie:`（多个 `name=value`），也能拆响应里的 `Set-Cookie:`（键值 + Path/Expires/HttpOnly 等属性）。",
    principle:
      "请求头 `Cookie:` 用 `;` 分隔多个 `name=value`。响应头 `Set-Cookie:` 第一段是主键值，后面用 `;` 跟一串属性（Domain、Path、Expires、Max-Age、Secure、HttpOnly、SameSite）。工具自动去掉 `Cookie:`/`Set-Cookie:` 前缀再逐项列出。",
    usage: "把整行 Cookie 或 Set-Cookie 粘进来，得到结构化的键值和属性列表。",
    examples: [
      { in: "Cookie: sid=abc; theme=dark", out: "sid = abc\ntheme = dark" },
      { in: "Set-Cookie: token=xyz; HttpOnly; Path=/", out: "token = xyz\n[属性] HttpOnly, Path=/", desc: "拆出主值和安全属性" },
    ],
    tips: [
      "Cookie 值常是 base64/JWT，拆出来接着解。",
      "看 HttpOnly/Secure/SameSite 判断能不能被 JS 读、能不能 CSRF。",
    ],
    aka: ["cookie", "set-cookie", "cookie 解析", "http cookie", "cookie解析", "会话cookie", "浏览器cookie", "cookie键值", "sessionid", "httponly", "cookie属性"],
  },

  httpBasicAuth: {
    what: "HTTP 最基础的认证：把「用户名:密码」base64 后放进 `Authorization: Basic xxx` 头。base64 不是加密，等于明文，这功能一键正反转。",
    principle:
      "编码：`user:pass` 拼接后整体 base64，前面加 `Basic `。解码：去掉 `Basic ` 前缀，base64 还原，再按第一个 `:` 拆成用户名和密码。冒号只认第一个，所以密码里可以含 `:`。",
    usage: "编码方向：输 `user:pass` 得 `Basic <base64>`。解码方向：粘 `Basic xxx` 或裸 base64 还原出账号密码。",
    examples: [
      { in: "Basic YWRtaW46MTIzNA==", out: "admin:1234", desc: "base64 一解就是明文账密" },
      { in: "user:secret", param: "编码方向", out: "Basic dXNlcjpzZWNyZXQ=" },
    ],
    tips: [
      "抓包看到 `Authorization: Basic` 直接 base64 解，账密立现——Basic 认证毫无保密性。",
      "裸 base64 解出来含一个 `:` 分两段，多半就是 Basic 凭据。",
    ],
    aka: ["basic auth", "http basic", "authorization basic", "基础认证", "http basic auth", "basic认证", "http基础认证", "authorization头", "basic凭据", "用户名密码base64", "rfc7617"],
  },

  dataUriParse: {
    what: "解析/构造 `data:` URI——那种把图片、文本直接内联进 `src` 的 `data:image/png;base64,....`。前端和 CTF 里很常见。",
    principle:
      "格式是 `data:[<MIME>][;charset=..][;base64],<数据>`。有 `base64` 标记则数据段是 base64，否则是 percent-encoded 文本。decode：拆出 MIME 和内容；encode：把文本按选定 MIME + 编码方式（base64 或 URL 编码）包成 data URI。",
    usage: "解码方向：粘 `data:` URI 输出 MIME 类型 + 内容。编码方向：输内容并选 MIME/编码方式生成 data URI。",
    examples: [
      { in: "data:text/plain;base64,SGVsbG8=", out: "MIME: text/plain\nHello", desc: "拆出类型和 base64 内容" },
      { in: "Hi", param: "编码方向 / text/plain", out: "data:text/plain;base64,SGk=" },
    ],
    tips: [
      "`data:image/...;base64,` 后面一大坨就是图片本体，拆出来存成文件再分析。",
      "没有 `base64,` 标记时数据是 URL 编码的纯文本。",
    ],
    aka: ["data uri", "data url", "内联资源", "data: 协议", "data协议", "内联图片", "base64图片", "dataurl解析", "内嵌数据", "data scheme", "rfc2397"],
  },

  magnetParse: {
    what: "解析磁力链接 `magnet:?...`：拆出种子哈希、显示名、Tracker 列表、文件大小等。分析下载线索、取证时常用。",
    principle:
      "magnet 是一串 `key=value` 参数：`xt`（exact topic，精确主题，含 BTIH 种子哈希，形如 `urn:btih:<40位hex或32位base32>`）、`dn`（display name 显示名）、`tr`（tracker，可多个）、`xl`（exact length 文件字节数）等。工具逐项解析并提取 BTIH 哈希。",
    usage: "粘 `magnet:?` 整串，得到结构化的哈希 / 名称 / Tracker / 大小列表。",
    examples: [
      { in: "magnet:?xt=urn:btih:ABC123...&dn=file.iso&tr=udp://t.co", out: "BTIH: ABC123...\ndn: file.iso\ntr: udp://t.co", desc: "提取种子哈希和 Tracker" },
    ],
    tips: [
      "`urn:btih:` 后 40 位 hex（或 32 位 base32）就是 BitTorrent info-hash，是种子的唯一标识。",
      "`dn` 里的文件名常被 URL 编码，解出来能看真实名字。",
    ],
    aka: ["magnet", "磁力链接", "magnet link", "btih", "磁力协议", "种子哈希", "info-hash", "bt磁力", "urn:btih", "磁链解析", "bittorrent磁力"],
  },
};
