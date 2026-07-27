/*
 * edu-batch6.js — 科普补缺分片（T284）。
 *
 * 覆盖 9 个新增 op 的科普卡：
 * analysis: usbKeyboard, usbMouse, sevenZipExtract
 * classic: goldbug
 * stego: acrostic, everyN, caseBitStego, nthChar, wordSpacingBits
 *
 * 纯数据无副作用，无 import 无 register。M 在 eduContent.js 归并。
 * EduEntry 格式照 eduContent.js 头注释契约。
 */
export default {
 // ============ analysis: USB HID 流量 ============
  usbKeyboard: {
    what: "USB 键盘抓包还原——把抓到的 USB 键盘 HID 报文翻译成用户按了什么键。",
    principle: "USB 键盘每次按键会发 8 字节 HID 报告：第 1 字节是修饰键（Ctrl/Shift/Alt 等位掩码），第 2 字节保留，第 3-8 字节是同时按下的 1-6 个键码。键码 0x04-0x1D 对应 a-z，0x1E-0x27 对应 1-0，更高的是控制键和符号。查 USB HID 1.21 规范的 Keyboard usage page 表即可还原。",
    usage: "把 wireshark 抓到的 USB 键盘 leftover capture data（每行 8 字节 hex）粘进来，点运行就能看到用户打了什么字。Shift 按住时会自动大写或出符号。",
    examples: [
      { in: "00 00 04 00 00 00 00 00", out: "a", desc: "单按 a 键" },
      { in: "02 00 04 00 00 00 00 00", out: "A", desc: "Shift+a = A（byte0=0x02 是 Left Shift）" },
      { in: "00 00 0b 00 00 00 00 00\n00 00 11 00 00 00 00 00", out: "hn", desc: "先按 h(0x0b) 再按 n(0x11)" },
    ],
    tips: ["CTF 常见题型：给一个 pcapng 文件，里面是 USB 键盘流量，提取后还原 flag", "byte0 的 bit0=LeftCtrl, bit1=LeftShift, bit2=LeftAlt, bit3=LeftGUI", "同一条报告里多个键码表示同时按下（组合键）"],
    aka: ["USB keyboard capture", "USB HID keyboard", "键盘流量", "USB键盘流量", "键盘HID还原", "USB键盘抓包", "leftover capture data", "HID报文解析", "键盘按键还原", "usb keyboard pcap", "键盘流量分析", "USB HID键盘解析"],
  },

  usbMouse: {
    what: "USB 鼠标抓包还原——把 USB 鼠标 HID 报文翻译成鼠标移动轨迹和点击。",
    principle: "USB 鼠标 boot 协议每次发 4 字节报告：第 1 字节是按钮状态（bit0=左键, bit1=右键, bit2=中键），第 2 字节是 X 位移（有符号 -128~127），第 3 字节是 Y 位移，第 4 字节是滚轮。逐帧累加 X/Y 位移就能画出鼠标轨迹。",
    usage: "把 wireshark 抓到的 USB 鼠标 leftover capture data（每行 4 字节 hex）粘进来运行，输出每帧的按钮状态和位移。配合画图工具可还原鼠标轨迹（CTF 常见画图题）。",
    examples: [
      { in: "01 00 00 00", out: "左键按下, X+0, Y+0", desc: "单击左键" },
      { in: "00 0a 00 00", out: "无按键, X+10, Y+0", desc: "向右移 10 像素" },
    ],
    tips: ["CTF 题型：给 pcapng 里 USB 鼠标流量，还原画的字或图形", "X/Y 是相对位移不是绝对坐标，要累加", "byte0 bit0=左键, bit1=右键, bit2=中键"],
    aka: ["USB mouse capture", "USB HID mouse", "鼠标流量", "USB鼠标流量", "鼠标HID还原", "USB鼠标抓包", "鼠标轨迹还原", "mouse pcap", "鼠标流量分析", "USB HID鼠标解析", "鼠标位移还原", "鼠标画图题"],
  },

  sevenZipExtract: {
    what: "7z 压缩包解压——纯前端用 WebAssembly 解压 .7z 文件。",
    principle: "7z 是 LZMA/LZMA2 压缩格式，压缩率高但算法复杂。本项目用 7z-wasm（emscripten 编译的 7zz.js + 7zz.wasm）在浏览器里跑原生 7-Zip 解压逻辑，零服务器依赖。支持 AES-256 加密的 7z 需输密码。",
    usage: "拖入或粘贴 .7z 文件（加密码的在参数框填密码），点解压就能在浏览器里提取内容，零外发。",
    examples: [
      { in: "(二进制 .7z 文件)", out: "(解压后的文件列表+内容)", desc: "拖入 7z 文件自动解压" },
    ],
    tips: ["CTF 帆船题常见伪装成 .7z 或改后缀", "7z-wasm 在浏览器跑，不需要装 7-Zip 软件", "加密 7z 填密码解，空密码也要填"],
    aka: ["7-Zip", "LZMA", "7z extract", "7z解压", "7z归档", "7zip解压", "LZMA2", "7z-wasm", "7z文件解析", "seven zip", "7z decompress", "7z压缩包"],
  },

 // ============ classic: Goldbug ============
  goldbug: {
    what: "金甲虫密码——爱伦坡小说《金甲虫》里的 Kidd 船长密码，用数字和特殊符号替换字母。",
    principle: "每个字母替换成一个单字符符号：5→A, 8→E, ‡→O, †→D, ¶→B, 3→G, 4→H, 6→I, *→N, (→R, )→T, ;→S, ?→U, 0→M, 9→F, 1→L, :→W, 2→P, .→V, —→Y，剩余 6 字母用 §!&@[] 扩展。单字符替换无歧义，直接查表可逆。小说原文是多对一（靠频率分析消歧），本工具用一对一保证严格可逆。",
    usage: "输入字母文本点编码得到符号串；输入符号串点解码还原字母。非字母/非符号字符原样保留。",
    examples: [
      { in: "HELLO", out: "4811‡", desc: "H=4, E=8, L=1, L=1, O=‡" },
      { in: "5‡8", out: "AOE", desc: "5=A, ‡=O, 8=E" },
    ],
    formulas: [{ tex: "A \\to 5,\\ E \\to 8,\\ O \\to \\ddagger,\\ D \\to \\dagger,\\ B \\to \\P", caption: "部分映射（照《金甲虫》Kidd 密码）" }],
    tips: ["小说原文是多对一不可严格往返，本工具用一对一可逆方案", "特征符号 †‡¶ 是强信号，一把梭靠这个识别", "CTF 里看到一串数字+特殊符号混合的密文，想想金甲虫"],
    aka: ["GoldBug", "Kidd cipher", "金甲虫", "Poe cipher", "金甲虫密码", "the gold bug", "爱伦坡密码", "Kidd船长密码", "symbol substitution", "符号替换密码", "gold-bug cipher", "基德密码"],
  },

 // ============ stego: 文本隐写（T278 新增 5 op）============
  acrostic: {
    what: "藏头诗隐写——把秘密消息藏在每行（或每句/每词）的首字母里。",
    principle: "编码时把消息的每个字符替换到载体每个单元（行/句/词）的指定位置（首/尾/中）。解码时取每个单元的指定位置字符拼起来就是隐藏消息。藏头诗是中文古典文学传统，CTF 里常见于'每行第一个字连起来读'的题型。",
    usage: "载体文本填可见的掩护文字，选模式（line=按行, sentence=按句, word=按词），选位置（head=首, tail=尾, mid=中），编码后隐藏消息就藏在指定位置。解码时同样选模式和位置即可提取。",
    examples: [
      { in: "春明千万", param: "cover=春风又绿江南岸\\n明月何时照我还\\n千山鸟飞绝\\n万径人踪灭, mode=line, pos=head", out: "春明千万", desc: "藏头诗：每行首字连读" },
      { in: "XYZ", param: "cover=一二三\\n四五六\\n七八九, mode=line, pos=mid", out: "XYZ", desc: "藏中：每行中间字替换" },
    ],
    tips: ["藏头诗无法自动检测（detect=0），需人工识别", "载体不足时自动补占位行保证可逆", "word 模式适合英文载体"],
    aka: ["Acrostic", "藏头诗", "藏尾诗", "藏中诗", "acrostic cipher", "藏头隐写", "首字母隐写", "藏头文", "藏尾隐写", "首字连读", "acrostic stego", "藏头藏尾"],
  },

  everyN: {
    what: "等距取字隐写——每 N 个字符里藏一个秘密字符，第 N 个就是隐藏的。",
    principle: "编码时每 N-1 个载体字符后插入 1 个消息字符，形成'载体1, 载体2, ..., 消息1, 载体N, ...'的排列。解码时每 N 取第 N 个（索引 N-1, 2N-1, ...）拼起来就是隐藏消息。载体字符数须 >= (N-1)*消息长度，否则报错。",
    usage: "载体文本填掩护文字，N 填间距（默认 3），编码后隐藏字符均匀分布在载体中。解码时填同样的 N 即可提取。",
    examples: [
      { in: "嗨", param: "cover=01, n=3", out: "01嗨", desc: "2 个载体 + 1 个消息 = 3 字符一组" },
      { in: "AB", param: "cover=0123, n=3", out: "01A23B", desc: "2 组：01|A, 23|B" },
    ],
    tips: ["N>=2，N=1 自动调整为 2", "载体不足（<(N-1)*消息长度）会报错", "N 越大隐藏越分散但需要更长载体"],
    aka: ["Every-N", "等距取字", "间隔隐写", "every n stego", "每N字隐写", "间隔取字", "定距隐写", "等间距隐写", "每隔N个字符", "均匀分布隐写", "间距取字隐写", "等距隐写"],
  },

  caseBitStego: {
    what: "大小写位隐写——用字母的大小写承载二进制比特，把秘密消息藏在一段看似普通的大小写文本里。",
    principle: "消息转 UTF-8 字节再转比特串，前 32 比特存消息长度（自洽解码），后面是消息比特。遍历载体中的英文字母，大写=1，小写=0，逐比特替换大小写。非字母字符（数字、空格、标点）原样保留不影响。解码时读载体字母的大小写→比特→前 32 位长度→后 N*8 位消息。",
    usage: "载体文本填一段含英文字母的文字（越长能藏越多），编码后载体外观不变只有大小写变化。解码不需任何参数，靠 32 位长度前缀自洽还原。",
    examples: [
      { in: "Hi", param: "cover=aaaa...(48个a)", out: "aAaA...(大小写变化)", desc: "Hi→2字节→16比特+32长度=48比特→需48个字母" },
    ],
    tips: ["32 位长度前缀实现 decode 自洽，不需外部传长度", "载体字母不足时会报错（需 32+len*8 个字母）", "非字母字符原样保留，适合混在代码/文章里"],
    aka: ["Case-bit stego", "大小写隐写", "LSB case", "大小写位隐写", "case bit steganography", "字母大小写隐写", "大小写比特", "letter case stego", "大小写编码隐写", "case sensitive stego", "字母大小写位", "大小写承载比特"],
  },

  nthChar: {
    what: "第 N 字隐写——藏头的泛化版，把秘密消息藏在每行（或每句/每词）的第 N 个字里。",
    principle: "按分隔符（行/句/词）拆分载体为多个单元，把每个单元的第 N 个字符替换为消息字符。载体单元不足时补占位字符保证可逆。解码时取每个单元第 N 个字符拼接。N=1 就是经典藏头诗。",
    usage: "载体文本填掩护文字，N 填取第几个字（默认 1），sep 选分隔方式（line/sentence/word）。编码后第 N 字就是隐藏内容。解码时填同样的 N 和 sep。",
    examples: [
      { in: "甲乙丙", param: "cover=一二三\\n四五六\\n七八九, n=1, sep=line", out: "甲乙丙", desc: "N=1 等同藏头" },
      { in: "XYZ", param: "cover=一二三\\n四五六\\n七八九, n=2, sep=line", out: "一X三\n四Y六\n七Z九", desc: "N=2 每行第2字替换" },
    ],
    tips: ["N=1 是经典藏头诗", "载体不足自动补字保证可逆", "word 模式按空格拆分适合英文"],
    aka: ["Nth-char", "第N字隐写", "藏头泛化", "nth character stego", "第N个字", "每行第N字", "第n位取字", "藏头诗泛化", "nth char extract", "第N字符隐写", "取第N字", "行内第N字"],
  },

  wordSpacingBits: {
    what: "词距位隐写——用单词间空格的数量承载二进制比特，1 个空格=0，2 个空格=1。",
    principle: "消息转 UTF-8 字节再转比特串，前 32 比特存消息长度，后面是消息比特。遍历载体中词与词之间的空格，1 空格=0，2 空格=1，逐比特编码。解码时读词间空格数→比特→前 32 位长度→后 N*8 位消息。32 位长度前缀实现自洽解码。",
    usage: "载体文本填一段英文（词之间用空格分隔），编码后词距变化（有些地方出现双空格）但肉眼难察。解码不需参数，靠长度前缀自洽还原。",
    examples: [
      { in: "Hi", param: "cover=word1 word2 ...(49个词)", out: "word1  word2...(空格数变化)", desc: "Hi→16比特+32长度=48比特→需49个词" },
    ],
    tips: ["32 位长度前缀实现 decode 自洽", "载体词间距不足（<(32+len*8) 个间隙）会报错", "双空格在等宽字体里可见但比例字体难察", "detect 检测到多空格轻度可疑（0.15）"],
    aka: ["Word-spacing stego", "词距隐写", "空格位隐写", "word spacing steganography", "空格数量隐写", "词间距隐写", "双空格隐写", "空白隐写", "whitespace stego", "词距位隐写", "空格编码隐写", "单词间距隐写"],
  },
};
