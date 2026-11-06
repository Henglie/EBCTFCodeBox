/*
 * edu-t813.js — 10 个 CyberChef 对齐 op 的科普卡。
 * 纯数据，无 import、无副作用。
 *
 * 权威来源（逐卡注明，未标注的一律取自项目内 op 实现与 CyberChef 操作名）：
 *   ipChecksum        — RFC 1071《Computing the Internet Checksum》§1/§2；CyberChef「TCP/IP Checksum」
 *   xorChecksum       — CyberChef「XOR Checksum」；列/块异或校验的通用定义
 *   parityBit         — CyberChef「Parity Bit」；奇偶校验的通用定义（ISO/IEC 2382 术语）
 *   hexToOid          — ITU-T X.690 §8.19（OBJECT IDENTIFIER 编码）；CyberChef「Hex to OID」
 *   oidToHex          — ITU-T X.690 §8.19；CyberChef「OID to Hex」
 *   fromHexContent    — SNORT 规则语法（content 修饰符的竖线十六进制段）；CyberChef「From Hex Content」
 *   toHexContent      — 同上；CyberChef「To Hex Content」
 *   escapeSmartChars  — CyberChef「Escape Smart Characters」；Unicode 标点字符的 ASCII 近似映射
 *   removeDiacritics  — Unicode 规范分解（NFD）与组合用附加符号区 U+0300–U+036F；CyberChef「Remove Diacritics」
 *   stripHttpHeaders  — RFC 7230 §3（HTTP 报文分帧：头字段区与消息体由空行分隔）；CyberChef「Strip HTTP Headers」
 */
export default {
  ipChecksum: {
    what:
      "TCP/IP 校验和：把整段数据按 16 位大端字相加，溢出的高位回卷加回低 16 位，最后取反码，得到一个 16 位十六进制值。IPv4 头、TCP/UDP 头里的 checksum 字段都是这套算法算出来的。",
    principle:
      "把字节两两配成 16 位字（奇数长度时最后一个字节当低 8 位），全部相加得到 $S$；$S$ 的高 16 位不能丢，要「回卷」加回低 16 位，直到只剩 16 位（end-around carry）。校验和就是 $S$ 的按位取反：$c = \\overline{S}$。\n\n" +
      "接收方把校验和字段本身也一起参与求和，正确时结果应为 0xFFFF。反码加法与字节序无关、可增量更新，所以路由器和网卡能边转发边修校验和。",
    usage:
      "输入要计算的数据即可，无参数；字节视图有真字节时按真字节算，否则按 UTF-8 文本。输出小写十六进制，最少两位。\n" +
      "本 op 只算你贴进来的字节：不补 IP 头、不清零校验和字段、不加 TCP/UDP 伪首部；算完整首部时先把覆盖区拼好。",
    examples: [
      { in: "abc", out: "3b9d", desc: "0x6162 + 0x6300 = 0xC462，取反码得 0x3B9D" },
      { in: "（字节视图）00 01 f2 03 f4 f5 f6 f7", out: "220d", desc: "RFC 1071 §4 的经典示例" },
    ],
    tips: [
      "校验和只查错、不防伪：攻击者改完数据可以重算校验和。",
      "IPv4 头校验只覆盖首部，TCP/UDP 校验和还要加伪首部（源/目的 IP、协议号、长度）。",
      "结果全 0 与全 1 要分清：本工具输出的是取反后的校验和，空输入是 ffff。",
    ],
    aka: [
      "TCP/IP 校验和", "TCP/IP Checksum", "Internet checksum", "网际校验和", "IP 校验和",
      "IP header checksum", "反码和校验", "ones' complement sum", "end-around carry", "RFC 1071",
      "16 位反码求和", "校验和（IP/TCP/UDP）",
    ],
  },

  xorChecksum: {
    what:
      "XOR 分块校验和：把数据按固定块大小切开，把所有块按「同一列」逐字节异或，得到与块大小等长的一串十六进制。它反映的是各块之间的差异，而不是整段数据的摘要。",
    principle:
      "设块大小为 $k$，第 $j$ 块第 $i$ 字节记作 $b_{j,i}$，则输出第 $i$ 字节为 $\\bigoplus_j b_{j,i}$。块不齐时缺失字节按 0 处理（异或 0 不改变结果）。因为 $x \\oplus x = 0$，同一位置上重复出现的字节会互相抵消；块大小为 1 时就是全部字节异或成一个字节。",
    usage:
      "填块大小（默认 4，正整数），输入文本或字节视图数据。输出是 $k$ 个字节的小写十六进制、连续无分隔。块大小为 1 时常见于嵌入式/串口的单字节异或校验。",
    examples: [
      { in: "ABCDEFGH", param: "blockSize=4", out: "04040404", desc: "0x41^0x45=0x04，其余三列同理" },
      { in: "ABCD", param: "blockSize=4", out: "41424344", desc: "只有一块时原样输出" },
    ],
    tips: [
      "异或校验能发现单列单字节错误，但两列同时错、或同一位置错两次会互相抵消，不能当密码学哈希。",
      "块大小要和发送端约定一致，否则结果完全不同；协议里通常写死为 1/2/4。",
      "输出全 00 表示各块逐列完全相同，不代表数据为空。",
    ],
    aka: [
      "XOR 分块校验和", "XOR Checksum", "异或校验和", "异或校验", "分块异或",
      "逐列异或", "block XOR checksum", "XOR block checksum", "exclusive OR checksum",
      "纵向异或校验", "XOR 校验", "列异或",
    ],
  },

  parityBit: {
    what:
      "奇偶校验位：数一段二进制里 1 的个数，按「偶校验 / 奇校验」在块首或块尾补一位 0 或 1，让整块 1 的总数变成偶数或奇数。",
    principle:
      "偶校验：1 的个数已是偶数就补 0，是奇数就补 1；奇校验相反。接收端重新数一遍，不符合约定就判定传输出错。它只能发现奇数个比特翻转，遇到偶数个同时翻转会漏检，而且不能定位、不能纠错。\n\n" +
      "本 op 的 decode 只是按记录的位置把头/尾那一位切掉，不会去核对这一位的值是否符合校验规则——它还原的是「去掉校验位后的原串」。",
    usage:
      "选校验类型（even/odd）、位置（start/end）、动作（encode/decode），可填分隔符把输入切成多块逐块处理（如空格分隔的多个字节）。输入只允许 0、1 和分隔符/空格。",
    examples: [
      { in: "1011", param: "mode=even, position=start, action=encode", out: "11011", desc: "3 个 1，补 1" },
      { in: "1011", param: "mode=odd, position=start, action=encode", out: "01011", desc: "奇校验补 0" },
    ],
    tips: [
      "串口常说的 8N1 是「8 数据位 + 无校验 + 1 停止位」，并不带奇偶位；带校验时一般是 8E1/8O1。",
      "内存 ECC 用的是 SECDED 等更强方案，普通奇偶位只能检一位错。",
      "分隔符参与切块但不会被计入 1 的个数；输入里出现 2 等其他字符会直接报错。",
    ],
    aka: [
      "奇偶校验位", "Parity Bit", "parity check", "偶校验", "奇校验",
      "even parity", "odd parity", "parity encoding", "校验位", "奇偶校验",
      "parity bit insertion", "垂直奇偶校验",
    ],
  },

  hexToOid: {
    what:
      "十六进制 → 对象标识符：把 ASN.1 OBJECT IDENTIFIER 的内容字节（不含 06 标签和长度字节）解成 1.2.840.113549 这样的点分十进制。",
    principle:
      "ITU-T X.690 §8.19 规定：前两个弧合成一个子标识符，值为 $40X + Y$（$X \\in \\{0,1,2\\}$）；从第三个弧起每个弧单独编码。每个子标识符用 base-128 变长整数表示：除最后一字节外，其余字节最高位置 1 表示「还有后续」。\n\n" +
      "解码时先读第一个变长整数 $n$，再拆回两个弧：$n<40$ 得 $0.n$；$40 \\le n < 80$ 得 $1.(n-40)$；否则得 $2.(n-80)$。",
    usage:
      "输入内容字节的十六进制，可带空格、冒号、逗号或短横，允许 `0x` 前缀。不要连 `06 0d` 这类标签和长度一起贴进来。输出点分十进制 OID。",
    examples: [
      { in: "2A864886F70D", out: "1.2.840.113549", desc: "RSA 加密 OID" },
      { in: "55 04 03", out: "2.5.4.3", desc: "X.509 的 commonName" },
    ],
    tips: [
      "证书/ASN.1 dump 里 OID 常写成 `06 0d 2a 86 48 ...`，`06` 是类型、`0d` 是长度，解析前要剥掉。",
      "变长整数可以超过 2^53，不要用浮点数算；本工具按字节逐段累加。",
      "OID 与 oidToHex 互为逆运算，可以拿来做往返自检。",
    ],
    aka: [
      "十六进制 → 对象标识符", "Hex to OID", "OID 解码", "OID 解析", "ASN.1 OID",
      "OBJECT IDENTIFIER", "对象标识符解码", "X.690 §8.19", "BER OID", "DER OID",
      "点分 OID", "OID hex decode",
    ],
  },

  oidToHex: {
    what:
      "对象标识符 → 十六进制：把 1.2.840.113549 这种点分 OID 编码成 ASN.1 内容字节的十六进制，结果可直接拼进 DER/BER 结构。",
    principle:
      "与 hexToOid 完全对称：先检查首段只能是 0/1/2，首段为 0 或 1 时第二段必须 ≤39；然后把前两弧合成 $40X+Y$，其余弧各自用 base-128 变长整数编码（多字节时前面的字节最高位置 1）。\n\n" +
      "输出的只是「内容字节」，不含 `06` 标签和长度，长度需要另外按编码规则计算。",
    usage:
      "输入点分十进制 OID，段之间用点分隔，段必须是非负十进制整数。输出小写、连续的十六进制。",
    examples: [
      { in: "1.2.840.113549", out: "2a864886f70d", desc: "RSA 加密 OID" },
      { in: "2.5.4.3", out: "550403", desc: "X.509 commonName" },
    ],
    tips: [
      "首段写成 3 或第二段写成 40（首段为 0/1 时）都会被明确拒绝，这是 X.690 的硬约束。",
      "大弧（如 2.25.xxx 的 UUID 型 OID）会产生多字节变长整数，别被长度吓到。",
      "和 hexToOid 往返可以验证自己手拼的 OID 有没有错段。",
    ],
    aka: [
      "对象标识符 → 十六进制", "OID to Hex", "OID 编码", "OID 转 hex", "ASN.1 OID 编码",
      "OBJECT IDENTIFIER encode", "X.690 §8.19", "BER OID 编码", "DER OID 编码",
      "OID hex encode", "点分转十六进制", "OID 序列化",
    ],
  },

  fromHexContent: {
    what:
      "SNORT Hex Content 解码：IDS 规则里常把不可打印字节写成 `|41 42 3a|`，这个 op 把竖线包住的十六进制段还原成真实字符，段外的规则文本原样保留。",
    principle:
      "SNORT/Suricata 的 content 修饰符用竖线界定十六进制字节序列，段内字节之间用空格分隔。解码时按空白切组，每组每两个十六进制字符取一个字节；段外字符逐个原样输出，所以整条规则的结构不会被破坏。\n\n" +
      "匹配只认 `|` 之间「全是十六进制数字和空格」且长度至少 2 的片段；`|zz|` 这类非法段不匹配，原样留在结果里。输出按 Latin-1 逐字节取字符，非打印字节会显示成对应控制字符。",
    usage:
      "直接粘贴规则片段或整个 content 值，无参数。要还原成可读文本时，可再串一个「From Hex」之外的显示层自行处理控制字符。",
    examples: [
      { in: "foo|3d|bar", out: "foo=bar", desc: "0x3d 就是等号" },
      { in: "|41 42 3a|", out: "AB:", desc: "大写字母与冒号" },
    ],
    tips: [
      "与 toHexContent 互为逆运算，可用来检查自己写的规则段有没有多空格/漏字节。",
      "竖线只是定界符，不会出现在解码结果里；规则正文里真正的 `|` 需要靠上下文区分。",
      "只处理 content 的十六进制写法，不解析 pcre、byte_test 等其他修饰符。",
    ],
    aka: [
      "SNORT Hex Content 解码", "From Hex Content", "Snort hex content decode",
      "SNORT 十六进制内容解码", "Snort 规则解码", "内容段解码", "hex content decoder",
      "IDS 规则 content 解析", "Suricata hex content", "|41 42| 解码",
      "SNORT content 还原", "规则内容 hex 还原",
    ],
  },

  toHexContent: {
    what:
      "SNORT Hex Content 编码：把规则里不方便直接写的字节（控制字符、标点、空格）转成 `|hh hh|` 十六进制段，生成合法的 SNORT/Suricata content 值。",
    principle:
      "「仅特殊字符」档只转不可打印或非字母数字的字节（0x00–0x2F 除空格外、0x3A–0x40、0x5B–0x60、0x7B 以上）；连续的多个特殊字节合并进同一个 `|...|`，普通字符原样输出。「特殊字符 + 空格」档额外把 0x20 转成 `|20|`。「全部字符」档把整段包成一个 `|hhhh|`。\n\n" +
      "「字节间加空格」只影响 hex 段内部的分隔，不改变段外文本。",
    usage:
      "输入原文，选转换范围（special / specialSpaces / all）与是否加空格。有字节视图时按真字节编码，否则按 UTF-8。",
    examples: [
      { in: "foo=bar", param: "convert=special", out: "foo|3d|bar", desc: "等号属于特殊字符" },
      { in: "A B", param: "convert=specialSpaces", out: "A|20|B", desc: "空格也被编码" },
      { in: "AB", param: "convert=all, spaces=false", out: "|4142|", desc: "整段十六进制" },
    ],
    tips: [
      "规则里 content 值通常还要用双引号包住，转义由规则语法负责，本 op 不额外加引号。",
      "中文/UTF-8 多字节字符会被拆成多个字节编码，规则匹配时按字节对齐。",
      "「全部字符」档会让规则可读性变差，排查时先用「仅特殊字符」。",
    ],
    aka: [
      "SNORT Hex Content 编码", "To Hex Content", "Snort hex content encode",
      "SNORT 十六进制内容编码", "Snort 规则编码", "内容段编码", "hex content encoder",
      "IDS 规则 content 生成", "Suricata hex content", "|hh| 编码",
      "SNORT content 编码", "特殊字符转 hex",
    ],
  },

  escapeSmartChars: {
    what:
      "转义智能字符：把 Word/网页/PDF 里的「聪明标点」换成 ASCII：弯引号变直引号，长短破折号变 - 或 --，省略号变 ...，©®™ 变 (c)(r)(tm)，箭头、书名号、×÷± 也各有映射。",
    principle:
      "映射表逐字符硬编码：U+201C–U+201F、U+2033 双引号族；U+2018–U+201B、U+2032 单引号族；U+2010–U+2015 破折号；U+2026 省略号；U+00A9/00AE/2122 商标；U+2190–U+21D4 箭头；U+00AB/00BB/2039/203A 书名号；U+00D7/00F7/00B1/2022/00B7 数学与项目符号；U+00A0/2002/2003/2009/200A 非 ASCII 空格。\n\n" +
      "ASCII 直通；表外非 ASCII（中文、emoji）按参数保留/删除/替换成点。",
    usage:
      "粘贴正文后选「无法映射字符」的处理方式；适合在替换、ROT、正则前先归一标点，避免弯引号破坏关键词匹配。",
    examples: [
      { in: "“Hello,” she said, ‘yes.’", out: "\"Hello,\" she said, 'yes.'", desc: "弯引号转直引号" },
      { in: "page 1–3 — wait…", out: "page 1-3 -- wait...", desc: "短破折号变 -，长破折号变 --" },
    ],
    tips: [
      "只做逐字符映射，不做 Unicode 兼容分解；全角字母、中文不会被改动。",
      "长破折号映射成两个连字符 `--`，写 Markdown 时注意别和语法冲突。",
      "无法映射时默认保留，若下游只吃 ASCII 请显式选「删除」或「替换为点」。",
    ],
    aka: [
      "转义智能字符", "Escape Smart Characters", "smart quotes", "smart punctuation",
      "弯引号转直引号", "智能引号", "排版字符转 ASCII", "typographic characters",
      "curly quotes", "em dash escape", "ASCII 化标点", "智能标点转义",
    ],
  },

  removeDiacritics: {
    what:
      "去除变音符号：把 café、Crème Brûlée 这类带重音/分音符的拉丁字母还原成 cafe、Creme Brulee，只保留基字符。",
    principle:
      "先做 Unicode NFD 规范分解：`é` 被拆成 `e` + U+0301 组合用尖音符；然后删除 U+0300–U+036F 这一整段组合用附加符号。所以 `â ã ä å ā ă ą` 等只要能被分解，就都会还原成 `a`。\n\n" +
      "不做额外的手工替换：`ø`、`ß`、`Ł`、`æ` 这些「本身就是一个独立字母」的字符不会被拆开，保持原样；同理中文、日文假名、emoji 不受影响。",
    usage:
      "直接输入文本，无参数。常见于把外文题干、人名、地名转成纯 ASCII 后再做关键词搜索或字典匹配。",
    examples: [
      { in: "Crème Brûlée", out: "Creme Brulee" },
      { in: "naïve résumé", out: "naive resume" },
    ],
    tips: [
      "NFD 只管「基字符 + 组合符号」的情况；预组合字符必须先分解才会被删，本 op 已自动做这一步。",
      "希腊语、越南语的多重附加符号同样会被清掉，可能得到空串，这是正常现象。",
      "德语 ü→ue、æ→ae 属于音译规则，不在本 op 范围；需要时请手动替换。",
    ],
    aka: [
      "去除变音符号", "Remove Diacritics", "去重音", "去掉重音符号", "strip accents",
      "unaccent", "deaccent", "diacritics removal", "accent folding",
      "变音符号剥离", "NFD 去附加符号", "accents to ASCII",
    ],
  },

  stripHttpHeaders: {
    what:
      "剥离 HTTP 头：抓包或复制出来的 HTTP 请求/响应文本，按第一个空行截断，只留下消息体。",
    principle:
      "RFC 7230 §3 规定，HTTP 报文的头字段区与消息体之间由一个空行分隔，即 `CRLF CRLF`（十六进制 0d0a0d0a）。本工具先找这个四字节序列；找不到再退一步找 `LF LF`，以兼容只保留换行、丢了回车的文本；两种都找不到就原样返回。\n\n" +
      "它只做「切分」，不解析头字段、不删 chunked 分块长度行、也不解压。chunked 正文需要再串一个 dechunk。",
    usage:
      "粘贴原始 HTTP 报文文本，无参数。请求和响应都能用：请求切出来是表单/JSON body，响应切出来是网页或二进制载荷（文本视图下非打印字节可能显示异常）。",
    examples: [
      { in: "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nhi", out: "hi" },
      { in: "POST /x HTTP/1.1\nHost: a\n\na=1", out: "a=1", desc: "只有 LF 的文本也能切" },
    ],
    tips: [
      "以第一个空行为准；如果消息体里也有空行，只影响第一个之后的内容，不会被再切。",
      "头里出现 `\\r\\n` 转义字面量（例如字符串形式的抓包）时，本 op 认的是真实换行，不是反斜杠转义。",
      "切完若看到 `1f 8b` 开头，说明响应体是 gzip，需要再解压；看到数字加 CRLF 的行则是 chunked，需要 dechunk。",
    ],
    aka: [
      "剥离 HTTP 头", "Strip HTTP Headers", "HTTP 头剥离", "移除 HTTP 头",
      "HTTP header stripping", "HTTP body extract", "HTTP 正文提取", "RFC 7230 §3",
      "CRLFCRLF 截断", "response body 提取", "去掉请求头", "HTTP 报文分离",
    ],
  },
};
