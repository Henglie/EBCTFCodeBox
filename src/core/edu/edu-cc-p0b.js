/*
 * edu-cc-p0b.js — CyberChef 全量对齐 P0-B 科普卡（serialEnc 出站编码 5 + textUtils 文本工具 28 + OCR 1）。
 * 纯数据，无 import、无副作用、不注册。
 */
export default {
  // ============================ serialEnc：序列化出站编码 5 ============================
  cborEncode: {
    what: "把一段 JSON 文本编码成 CBOR 二进制（Concise Binary Object Representation），再按所选编码输出成 hex 或 Base64。它是「把结构化数据压实成字节」的格式，不是加密。",
    principle:
      "CBOR 用「1 字节类型头 + 长度/值」表示数据，类型头高 3 位是主类型（major type），低 5 位是附加信息：小于 24 的数值直接内联，24/25/26/27 分别表示后面跟 1/2/4/8 字节长度或数值。\n\n" +
      "本实现覆盖 null(0xf6)、true/false(0xf5/0xf4)、无符号整数(主类型 0)、负整数(主类型 1，编码 -1-n)、字符串(主类型 3，UTF-8)、数组(主类型 4)、映射/对象(主类型 5)；浮点一律走 float64(0xfb)。RFC 8949 里还有 indefinite 长度、tag(语义标签)、half/single 精度浮点，这里都未实现。",
    usage: "输入必须是合法 JSON（对象/数组/标量均可）。参数 outEnc 选 hex 或 base64。数字按是否能安全整数决定：整数走最小宽度整数编码，非整数走 float64。",
    examples: [
      { in: "{\"a\":1}", param: "outEnc=hex", out: "a1616101" },
      { in: "[1,true,null]", param: "outEnc=hex", out: "8301f5f6" },
      { in: "\"hi\"", param: "outEnc=hex", out: "626869" },
    ],
    tips: ["CBOR 与 MessagePack 常被拿来比较，CBOR 是 IETF 标准（RFC 8949，源自 RFC 7049），MessagePack 是社区规范。", "看到 0x9f/0xbf/0xff 之类是 indefinite 长度或 break 码，本工具不收这类输入。", "输出前 1 字节的主类型即可推断结构，抓包时很好认。"],
    aka: [
      "CBOR", "CBOR 编码", "CBOR 序列化", "Concise Binary Object Representation",
      "RFC 8949", "RFC 7049", "cbor encode", "cbor encoder", "cbor serialize",
      "CBOR 二进制", "cbor2", "cbor-x", "cbor to hex", "binary object representation",
    ],
  },
  msgpackEncode: {
    what: "把 JSON 文本编码成 MessagePack 二进制。MessagePack 是紧凑的二进制序列化格式，空间效率接近 JSON 的压缩版，速度很快。同样不是加密。",
    principle:
      "MessagePack 用「格式字节（format byte）」区分类型：正定点数 0x00-0x7f 直接表示 0..127；负数 0xe0-0xff 表示 -32..-1；定长串/数组/映射用高位组合内联长度（如 0xa0|n 表示长度 n 的 str，0x90|n 表示数组，0x80|n 表示映射）。长度不够时才用 0xd9/0xda/0xdb（str）、0xdc/0xdd（array）、0xde/0xdf（map）加后缀字节。\n\n" +
      "本实现覆盖 nil(0xc0)、true/false(0xc3/0xc2)、整数（按最小宽度选 0xcc-0xcf 无符号、0xd0-0xd3 有符号）、float64(0xcb)、str、bin、array、map。",
    usage: "输入合法 JSON。outEnc 选 hex 或 base64。nil 与 undefined 在本工具都输出 0xc0（JSON 本身无 nil）。",
    examples: [
      { in: "{\"a\":1}", param: "outEnc=hex", out: "81a161a101" },
      { in: "[1,2,3]", param: "outEnc=hex", out: "93010203" },
      { in: "\"hello\"", param: "outEnc=hex", out: "a568656c6c6f" },
    ],
    tips: ["MessagePack 的 str 与 bin 是两种类型，UTF-8 文本用 str(0xa0 区)，原始字节用 bin(0xc4 区)。", "整数按最小宽度，所以别指望定长；要定长看 Protobuf 的 fixed。", "Redis、许多 RPC 框架默认就用 msgpack。"],
    aka: [
      "MessagePack", "msgpack", "msgpack 编码", "msgpack 序列化", "MessagePack 编码",
      "MessagePack 二进制", "msgpack encode", "msgpack encoder", "msgpack serializer",
      "msgpack to hex", "MessagePack binary", "msgpack format", "message pack",
    ],
  },
  bsonSerialize: {
    what: "把 JSON 文本序列化成 BSON 文档（Binary JSON）。BSON 是 MongoDB 使用的二进制文档格式，比 JSON 多带了长度前缀和类型信息，便于数据库快速遍历。",
    principle:
      "一个 BSON 文档 = int32 总长度 + 若干元素 + 结尾 0x00。每个元素 = 类型字节 + 以 NUL 结尾的键名 + 值。本实现支持 null(0x0a)、bool(0x08)、string(0x02，值前带 int32 长度含结尾 NUL)、int32(0x10)、int64(0x12)、double(0x01)、数组(0x04)、嵌套文档(0x03)。\n\n" +
      "所有整数按小端存储。BSON 的 ObjectId、日期、二进制、正则、Decimal128 等扩展类型未实现，遇到超出范围的整数按 int64/double 处理。",
    usage: "输入合法 JSON，顶层必须是对象或数组。outEnc 选 hex 或 base64。整数优先 int32，放不下再 int64，非整数走 double。",
    examples: [
      { in: "{\"a\":1}", param: "outEnc=hex", out: "0c0000001061000100000000" },
      { in: "{\"ok\":true}", param: "outEnc=hex", out: "09000000086f6b000100" },
    ],
    tips: ["BSON 文档开头 4 字节是总长（含自身），和结尾一个 0x00，很好肉眼验证。", "键名必须以 NUL 结尾，且键名内不能含 NUL 字节。", "MongoDB 的 ObjectId 是 12 字节，本工具不生成，只做基础类型。"],
    aka: [
      "BSON", "BSON 序列化", "Binary JSON", "bson encode", "bson serialize",
      "BSON 文档", "bson document", "bsonspec", "bson binary", "mongo bson",
      "BSON encoder", "binary json", "bson to hex",
    ],
  },
  phpSerializeGenerate: {
    what: "把 JSON 文本转成 PHP 的 serialize() 字符串。PHP 用它把变量（数组、对象、标量）存成可还原的字符串，常出现在 Cookie、Session、序列化反序列化漏洞题里。",
    principle:
      "PHP 序列化用「类型码 + 内容」的文本格式：N; = null，b:1;/b:0; = 布尔，i:123; = 整数，d:1.5; = 浮点，s:长度:\"内容\"; = 字符串（长度是字节数，不是你看到的字符数），a:项数:{键 值 键 值 ...} = 数组。\n\n" +
      "本实现把 JSON 数组映射成 PHP 的 list（键从 0 递增），JSON 对象映射成 PHP 的 map（字符串键）。对象(o:)、自定义序列化(C:)、引用(R:/r:)不生成。",
    usage: "输入合法 JSON，输出就是 serialize() 字符串。字符串长度按 UTF-8 字节数计算，纯数字串也当字符串。",
    examples: [
      { in: "{\"a\":1}", out: "a:1:{s:1:\"a\";i:1;}" },
      { in: "[1,\"x\"]", out: "a:2:{i:0;i:1;i:1;s:1:\"x\";}" },
      { in: "null", out: "N;" },
    ],
    tips: ["PHP 反序列化漏洞的关键就是能构造这里的长度/键类型；长度不匹配会报错或截断。", "s: 的长度是字节数，中文一个字通常 3 字节（UTF-8）。", "JSON 数组（[]）与对象（{}）在这里分别是 list 和 map，别搞混。"],
    aka: [
      "PHP serialize", "PHP 序列化", "php serialize 生成", "serialize()",
      "PHP 序列化字符串", "php serialized string", "PHP serialize generator",
      "php serialize encode", "PHP 对象序列化", "php array serialize",
      "serialize php", "php serialize format", "PHP deserialize 题",
    ],
  },
  protobufEncode: {
    what: "给一份简化的 .proto 字段表，再把 JSON 数据编码成 Protobuf 的二进制 wire 格式。Protobuf 是 Google 的接口序列化格式，字段靠「字段号」而不是名字传输，所以特别省空间。",
    principle:
      "wire 格式里每个字段先写一个 tag：tag = 字段号 × 8 + wire 类型，再用 varint 编码。wire 类型 0 = varint（int32/int64/uint/bool/sint），1 = 64 位定长（fixed64/double），2 = 长度前缀（string/bytes），5 = 32 位定长（fixed32/float）。\n\n" +
      "本工具支持标量字段和 repeated（重复字段，逐项写 tag+值，不打包）。map、oneof、嵌套 message、枚举、packed repeated 都没实现。sint 用 zigzag 编码，负数才不浪费空间。",
    usage: "参数 schema 填 .proto 风格文本（如 `message Foo { int32 a = 1; string b = 2; }`），输入框填 JSON 对象。字段名要和 schema 一致；字段号必须 1..536870911。outEnc 选 hex 或 base64。",
    examples: [
      { in: "{\"a\":150}", param: "schema=message Foo { int32 a = 1; }", out: "089601" },
      { in: "{\"b\":\"hi\"}", param: "schema=message Foo { string b = 2; }", out: "12026869" },
    ],
    tips: ["int32 的负数会编码成 10 字节 varint（符号扩展），要省空间用 sint32。", "字段号 19000-19999 是 Protobuf 保留区间，实践中要避开。", "wire 类型 3/4（旧 group）本工具完全不支持。"],
    aka: [
      "Protobuf", "Protocol Buffers", "protobuf 编码", "protobuf 序列化",
      "protobuf encode", "protobuf encoder", "protobuf serializer", "proto encode",
      "protobuf wire", "protobuf wire format", "google protobuf", "protobuf binary",
      "protoc encode", "protobuf 二进制",
    ],
  },

  // ============================ textUtils：文本 / 字节小工具 28 ============================
  textSort: {
    what: "按指定分隔符把文本切成若干段，再按你选的规则排序后拼回去。最常用的是「按行排序」。",
    principle:
      "先 split 分隔符，再用不同比较器排序：字母（可直接比字符串）、字母忽略大小写、IPv4（按点分四段算成 32 位整数）、数值（把字符串拆成数字段和非数字段交替比较）、16 进制数值、长度。勾了倒序就 reverse 一下。",
    usage: "delim 选分隔符（默认换行）。order 选排序方式。reverse 倒序。IP 排序对非 IP 行会排到后面。",
    examples: [
      { in: "banana\napple\ncherry", param: "delim=Line feed, order=Alphabetical (case sensitive)", out: "apple\nbanana\ncherry" },
      { in: "10\n2\n1", param: "order=Numeric", out: "1\n2\n10" },
      { in: "a\nccc\nbb", param: "order=Length", out: "a\nbb\nccc" },
    ],
    tips: ["字母排序是逐码点比较，大写会排在小写前面（ASCII）。", "数值排序会把文本切碎成数字/非数字段交替比较，所以 a2 在 a10 前面。", "IP 排序对 192.168.1.10 这类才正确，带端口会解析失败。"],
    aka: [
      "sort", "排序", "sort lines", "行排序", "alphabetical sort", "字母排序",
      "sort by length", "长度排序", "ip sort", "numeric sort", "数值排序",
      "文本排序", "line sort", "sort text",
    ],
  },
  textUnique: {
    what: "按分隔符切分后去掉重复项，保留第一次出现的顺序。可以顺便统计每项出现次数。",
    principle: "遍历切分结果，用一个集合记录见过没有；见到新的就输出。计数模式下统计次数，然后按整数字符串键的顺序输出「次数 值」。",
    usage: "delim 选分隔符，count 勾选后输出「次数 值」而不是单纯去重结果。",
    examples: [
      { in: "a\nb\na\nc\nb", param: "delim=Line feed", out: "a\nb\nc" },
      { in: "a\nb\na", param: "delim=Line feed, count=true", out: "2 a\n1 b" },
    ],
    tips: ["保序去重，不是排序去重；要排序请接 Sort。", "计数模式输出顺序受对象整数键重排影响，不一定等于首次出现顺序。", "对超大文件注意内存。"],
    aka: [
      "unique", "去重", "deduplicate", "remove duplicates", "删除重复", "uniq",
      "unique lines", "去重复行", "distinct", "去重计数", "unique text",
      "dedupe", "去重复",
    ],
  },
  textSplit: {
    what: "用一个分隔符把文本切开，再用另一个分隔符拼回去。本质是「批量替换分隔符」。",
    principle: "对输入字符串做 split(拆分符) 得到数组，再 join(连接符)。两个分隔符都支持 \\n、\\t、\\xHH 这类转义写法。",
    usage: "splitDelim 是拆分用的字面串（经转义解析），joinDelim 是连接用的字面串。默认把逗号换成换行。",
    examples: [
      { in: "a,b,c", param: "splitDelim=,, joinDelim=\\n", out: "a\nb\nc" },
      { in: "a1b1c", param: "splitDelim=1, joinDelim=-", out: "a-b-c" },
    ],
    tips: ["splitDelim 为空串时按单字符拆分（相邻字符之间都是切点）。", "转义是 `\\xHH` 十六进制、`\\n` 换行、`\\t` 制表符等。", "想做正则替换用「通用正则」op。"],
    aka: [
      "split", "拆分", "split and join", "拆分重组", "delimiter split",
      "分隔符拆分", "split text", "text split", "join delimiter", "rejoin",
      "替换分隔符", "split join", "分隔符替换",
    ],
  },
  textHead: {
    what: "按分隔符取前 N 项，类似命令行 head。N 为负时表示「去掉末尾 |N| 项」。",
    principle: "切分后逐项编号（从 1 开始）。N 为正：保留编号 ≤ N 的项；N 为负：保留编号 ≤ 总项数 + N 的项。最后用原分隔符 join。",
    usage: "delim 选分隔符，number 填数量。默认取前 10 行。",
    examples: [
      { in: "1\n2\n3\n4\n5", param: "number=2", out: "1\n2" },
      { in: "1\n2\n3\n4\n5", param: "number=-2", out: "1\n2\n3" },
    ],
    tips: ["number=-0 之类的边界会按 0 处理。", "与 Tail 一起用可以「掐头去尾」。", "分隔符默认是换行，但也能按逗号/空格切。"],
    aka: [
      "head", "取前N", "first n lines", "取前几行", "head lines", "前N项",
      "first lines", "text head", "head -n", "取前", "top n lines", "前几行",
      "取前N行",
    ],
  },
  textTail: {
    what: "按分隔符取后 N 项，类似命令行 tail。N 为负时表示「跳过前 |N| 项」。",
    principle: "切分后逐项编号。N 为正：保留编号 > 总项数 − N 的项（即最后 N 项）；N 为负：保留编号 > |N| 的项。再用原分隔符 join。",
    usage: "delim 选分隔符，number 填数量。默认取后 10 行。",
    examples: [
      { in: "1\n2\n3\n4\n5", param: "number=2", out: "4\n5" },
      { in: "1\n2\n3\n4\n5", param: "number=-2", out: "3\n4\n5" },
    ],
    tips: ["看日志末尾通常用 Tail。", "N 超过总项数时返回全部。", "和 Head 组合可做区间取样。"],
    aka: [
      "tail", "取后N", "last n lines", "取后几行", "tail lines", "后N项",
      "last lines", "text tail", "tail -n", "取后", "bottom n lines", "后几行",
      "取后N行",
    ],
  },
  takeNthBytes: {
    what: "从某个起始位置开始，每隔 N 个字节取出 1 个字节。是字节级的抽样/提取，不是按字符。",
    principle: "遍历字节序列，维护一个 offset（遇到换行且勾了逐行时重置）。当 i−offset ≥ start 且 (i−(start+offset)) % n == 0 时收集该字节。",
    usage: "every 填间隔 N，start 填起始位置，eachLine 勾上则每行独立计算。输入为真字节时优先用原始字节。",
    examples: [
      { in: "ABCDEFGH", param: "every=2, start=0", out: "ACEG" },
      { in: "ABCDEFGH", param: "every=3, start=1", out: "BEH" },
    ],
    tips: ["这是「等间隔抽样」，和 base64 每 3 字节取 1 字节这类隐写手法相关。", "参数非法（N≤0 或 start<0）会直接报错。", "输出优先按 UTF-8 解码，解码不了会转义显示原字节。"],
    aka: [
      "take nth bytes", "每隔N字节取样", "sample every nth byte", "byte sampling",
      "字节抽样", "every nth byte", "nth byte extract", "byte stride", "抽取字节",
      "step bytes", "take bytes", "stride sampling", "等间隔取字节",
    ],
  },
  dropBytes: {
    what: "从 Start 位置起删掉 Length 个字节，剩下前后两段拼起来。支持负数下标（从末尾算）。",
    principle: "非逐行模式：start 为负则加上总长度；length 为负会先左移起点再调整。最后取 [0,start) 和 [start+length, end) 两段拼接。逐行模式对每行分别处理再补回换行。",
    usage: "start 起始位置，length 长度，可都为负；eachLine 勾上则逐行删。",
    examples: [
      { in: "ABCDEFGH", param: "start=2, length=3", out: "ABFGH" },
      { in: "ABCDEFGH", param: "start=-2, length=2", out: "ABCDEF" },
    ],
    tips: ["「删掉文件头/尾的固定字节」常用它。", "注意这是字节不是字符，中文会按 UTF-8 多字节算。", "负长度会改变语义，处理前先想清楚起点。"],
    aka: [
      "drop bytes", "删除字节", "remove bytes", "截断字节", "byte drop",
      "byte removal", "delete bytes", "substring bytes", "删字节", "cut bytes",
      "trim bytes", "byte delete", "去除字节",
    ],
  },
  dropNthBytes: {
    what: "从起始位置起，每隔 N 个字节删掉 1 个字节。和「每隔 N 字节取 1 字节」正好互补。",
    principle: "遍历字节序列，维护 offset（逐行时遇换行重置）。当 i−offset < start，或 (i−(start+offset)) % n != 0 时保留该字节，否则丢弃。",
    usage: "every 填间隔 N，start 填起始位置，eachLine 逐行应用。",
    examples: [
      { in: "ABCDEFGH", param: "every=2, start=0", out: "BDFH" },
      { in: "ABCDEFGH", param: "every=3, start=1", out: "ACDFG" },
    ],
    tips: ["常用于去掉插入的填充字节，逆向「每隔 N 字节插 1 字节」的隐写。", "N≤0 或 start<0 会报错。", "逐行模式每行独立计数。"],
    aka: [
      "drop nth bytes", "每隔N字节删除", "remove every nth byte", "skip every nth byte",
      "字节间隔删除", "delete nth byte", "stride drop", "隔字节删除", "drop every",
      "byte skip", "delete every nth", "nth byte drop", "等间隔删字节",
    ],
  },
  removeWhitespace: {
    what: "按勾选项删除空白字符：空格、回车、换行、制表符、换页符，还可以顺带删句点。",
    principle: "对输入字符串依次做正则替换：空格 /\\x20/、CR /\\r/、LF /\\n/、Tab /\\t/、FF /\\f/，全被勾上就得到一个「挤成一坨」的串。fullStops 再删点号。",
    usage: "每个复选框对应一类字符，默认前五类都开、句点关。取消勾选就保留该类。",
    examples: [
      { in: "a b\nc\td", param: "全部空白=true", out: "abcd" },
      { in: "1.2.3", param: "fullStops=true", out: "123" },
    ],
    tips: ["做 XOR、进制转换前常先删空白，避免解析失败。", "它不删全角空格（U+3000）等 Unicode 空白。", "只想删首尾空格用 Trim 类操作，这里会删所有出现。"],
    aka: [
      "remove whitespace", "删除空白", "strip whitespace", "去空格", "remove spaces",
      "删除空格", "whitespace remover", "去空白", "trim whitespace", "remove tabs",
      "delete whitespace", "compact text", "去除空白",
    ],
  },
  removeNullBytes: {
    what: "删掉输入里所有的 0x00（NUL）字节。二进制文件清理、CTF 字节处理常用。",
    principle: "逐字节遍历，只保留非 0 字节，重新拼成一个字节序列。",
    usage: "无参数。输入可以是文本，也可以是拖进来的真实字节；输出解码为文本或转义字节。",
    examples: [
      { in: "a\\x00b\\x00c", param: "", out: "abc" },
    ],
    tips: ["NUL 常被当作填充或分隔塞进数据里。", "删除后可能破坏定长结构，处理前存好原文件。", "若只想按文本删，确保输入以转义字节视图传入。"],
    aka: [
      "remove null bytes", "删除NUL", "strip null bytes", "去NULL", "remove 0x00",
      "删除零字节", "null byte remover", "去空字节", "remove zero bytes",
      "strip NUL", "delete nulls", "trim null bytes", "删除空字节",
    ],
  },
  removeAnsiEscapeCodes: {
    what: "删掉终端里的 ANSI 转义序列（比如颜色码、光标控制），把带色日志变成纯文本。",
    principle: "用正则匹配 CSI（Control Sequence Introducer）序列：ESC(0x1B) + '[' + 参数字节 + 中间字节 + 终止字节，整体替换为空。",
    usage: "无参数，输入带 ANSI 码的文本即可。ESC 字符在粘贴时可能看不到，但会被正确匹配。",
    examples: [
      { in: "\\x1b[31mERROR\\x1b[0m ok", param: "", out: "ERROR ok" },
    ],
    tips: ["CSI 之外还有 OSC 等序列，本实现只处理最常见的 CSI。", "抓终端日志、ctf 里清理带颜色的输出很好用。", "ESC 是 0x1B，不是可见字符。"],
    aka: [
      "remove ansi", "删除ANSI转义", "strip ansi", "ANSI escape remover", "去颜色码",
      "remove ansi codes", "clean ansi", "ANSI 去色", "remove terminal codes",
      "strip terminal escape", "ansi cleaner", "去终端转义", "清除ANSI",
    ],
  },
  addLineNumbers: {
    what: "给每一行前面加上行号，类似 cat -n / nl。行号宽度按总行数自动对齐。",
    principle: "把输入按 \\n 切开，计算总行数文本宽度 width，逐行输出 `(序号+offset).padStart(width) + 空格 + 原行`，行间用 \\n 连接。",
    usage: "offset 是行号起始偏移，默认 0（即从 1 开始）。",
    examples: [
      { in: "a\nb", param: "offset=0", out: "1 a\n2 b" },
      { in: "a\nb", param: "offset=10", out: "11 a\n12 b" },
    ],
    tips: ["行号与正文之间是一个空格，方便再被 Remove line numbers 还原。", "显示代码行号、讲解样本时常用。", "行号不改变内容本身。"],
    aka: [
      "add line numbers", "添加行号", "number lines", "行号", "line numbering",
      "cat -n", "nl", "加行号", "prepend line numbers", "numbering", "行编号",
      "line numbers", "编号行",
    ],
  },
  removeLineNumbers: {
    what: "删掉行首那些简单可识别的行号，是 Add line numbers 的逆向。",
    principle: "用正则匹配行首可选的 0-5 个空白、一串数字、以及紧随其后的分隔符（空格、冒号、竖线、逗号、短横、点、右括号、右方括号之一），整体替换为空。",
    usage: "无参数。对形如 `1 ` / `12.` / `3:` / `4|` 的行首编号有效。",
    examples: [
      { in: "1 a\n2 b", param: "", out: "a\nb" },
      { in: "10: hello", param: "", out: "hello" },
    ],
    tips: ["只删能被规则识别的行首号，正文里的数字不受影响。", "行号后必须有那个分隔符，纯「123abc」不会被动。", "与 Add line numbers 配套使用可往返。"],
    aka: [
      "remove line numbers", "删除行号", "strip line numbers", "去行号", "unnumber",
      "line number remover", "remove numbering", "去除行号", "delete line numbers",
      "unnumber lines", "strip numbering", "line number strip", "清除行号",
    ],
  },
  padLines: {
    what: "在每一行的开头或结尾补上指定字符，把行补齐。常用于对齐或填充。",
    principle: "按 \\n 切行，对每行用 String.padStart / padEnd 补到「原长 + length」，填充字符经转义解析。",
    usage: "position 选 Start（行首）或 End（行尾），length 是补几个字符，char 是填充字符（支持转义）。",
    examples: [
      { in: "a\nbb", param: "position=Start, length=3, char=0", out: "000a\n000bb" },
      { in: "a\nbb", param: "position=End, length=2, char=-", out: "a--\nbb--" },
    ],
    tips: ["length 是「额外补几个」，不是目标总宽。", "填充字符可以填制表符 \\t 等。", "配合对齐查看二进制表格有用。"],
    aka: [
      "pad lines", "行补齐", "line padding", "补行", "pad text", "对齐行",
      "padstart", "padend", "行填充", "pad each line", "line pad", "补位",
      "行首行尾补齐",
    ],
  },
  toUpperCase: {
    what: "把文本转成大写，可选只对大写「每个词/句/段」的首字母。",
    principle: "All 模式直接 toUpperCase。Scoped 模式用正则匹配词/句/段的首个单词字符并只把它大写。",
    usage: "scope 选 All（全部）/ Word（每词首字母）/ Sentence（每句首字母）/ Paragraph（每段首字母）。",
    examples: [
      { in: "hello world", param: "scope=All", out: "HELLO WORLD" },
      { in: "hello world. bye", param: "scope=Word", out: "Hello World. Bye" },
    ],
    tips: ["不是标题大小写规则（the/of 不会变小写）。", "对非英文字符的行为取决于 JS 的 toUpperCase。", "要逐字母翻转大小写用 Swap case。"],
    aka: [
      "to upper case", "转大写", "uppercase", "大写", "upper", "toUpperCase",
      "大写转换", "capitalize", "all caps", "转大写字", "upper case convert",
      "text upper", "转成大写",
    ],
  },
  toLowerCase: {
    what: "把整段文本全部转成小写。",
    principle: "直接调用 String.prototype.toLowerCase，按 Unicode 规则映射。",
    usage: "无参数。",
    examples: [
      { in: "Hello WORLD 123", param: "", out: "hello world 123" },
    ],
    tips: ["数字和符号不变。", "大小写不敏感比对前常先转小写。", "土耳其语 i 等特例遵循 JS 实现。"],
    aka: [
      "to lower case", "转小写", "lowercase", "小写", "lower", "toLowerCase",
      "小写转换", "downcase", "lower case convert", "文本小写", "lower text",
      "transform lower", "转成小写",
    ],
  },
  swapCase: {
    what: "把每个字母的大小写对调：大写变小写、小写变大写。",
    principle: "逐字符判断：如果该字符 toUpperCase 后等于自己（说明本来是大写或非字母），就转小写，否则转大写。",
    usage: "无参数。",
    examples: [
      { in: "Hello World", param: "", out: "hELLO wORLD" },
      { in: "AbC", param: "", out: "aBc" },
    ],
    tips: ["常用于识别「大小写交替」的隐写/花式编码。", "非字母字符原样保留。", "是全局翻转，不是标题化。"],
    aka: [
      "swap case", "大小写互换", "toggle case", "swapcase", "大小写反转",
      "invert case", "toggle text", "大小写切换", "case swap", "flip case",
      "交换大小写", "case toggle", "翻转大小写",
    ],
  },
  toCamelCase: {
    what: "把字符串转成 camelCase（首词小写、后续词首字母大写，词间无分隔符）。移植 lodash 的 camelCase。",
    principle: "先用 lodash 的 words() 把串切成词（会处理下划线、短横、空格、大小写边界、重音字母 deburr），再去撇号；首词全小写，后续词首字母大写拼接。smart 模式只改代码里的标识符（跳过字符串字面量）。",
    usage: "输入任意串。勾 smart（上下文感知）时，只对形如变量的 token 转换，字符串里的内容不动。",
    examples: [
      { in: "hello world_foo-bar", param: "smart=false", out: "helloWorldFooBar" },
      { in: "HTTPServer", param: "smart=false", out: "httpServer" },
    ],
    tips: ["跟 lodash.camelCase 行为一致，大小写边界（如 HTTPServer→httpServer）也会拆。", "smart 模式适合直接改一段代码的命名风格。", "重音字母会先 deburr，é→e。"],
    aka: [
      "camelCase", "转驼峰", "to camel case", "驼峰命名", "camel case convert",
      "lodash camelCase", "驼峰式", "lowerCamelCase", "camel", "小驼峰",
      "字符串驼峰", "camelizer", "驼峰转换",
    ],
  },
  toSnakeCase: {
    what: "把字符串转成 snake_case（全小写、词间用下划线连接）。移植 lodash 的 snakeCase。",
    principle: "用 lodash 的 words() 切词后，每个词转小写，用 `_` 连接。smart 模式只改代码标识符。",
    usage: "输入任意串；smart 勾选时只对变量名生效。",
    examples: [
      { in: "helloWorld Foo", param: "smart=false", out: "hello_world_foo" },
      { in: "XMLHttpRequest", param: "smart=false", out: "xml_http_request" },
    ],
    tips: ["数据库列名、常量常要 snake_case。", "与 lodash 一致，连续大写也会被拆开。", "deburr 后重音字母归一。"],
    aka: [
      "snake_case", "转下划线", "to snake case", "下划线命名", "snake case convert",
      "lodash snakeCase", "蛇形命名", "snake", "underscore case", "下划线分隔",
      "snakecase", "under_score", "下划线转换",
    ],
  },
  toKebabCase: {
    what: "把字符串转成 kebab-case（全小写、词间用短横线连接）。移植 lodash 的 kebabCase。",
    principle: "用 lodash 的 words() 切词，每词转小写，用 `-` 连接。smart 模式只改代码标识符。",
    usage: "输入任意串；smart 勾选时只对变量名生效。",
    examples: [
      { in: "helloWorld Foo", param: "smart=false", out: "hello-world-foo" },
      { in: "UserName", param: "smart=false", out: "user-name" },
    ],
    tips: ["CSS 类名、URL slug 常要 kebab-case。", "与 snake 只差连接符。", "smart 模式可用于批量改前端类名。"],
    aka: [
      "kebab-case", "转短横线", "to kebab case", "短横线命名", "kebab case convert",
      "lodash kebabCase", "串烧命名", "kebab", "dash case", "短横线分隔",
      "kebabcase", "hyphen case", "短横线转换",
    ],
  },
  countOccurrences: {
    what: "统计你给的搜索串在文本里出现了多少次。支持纯文本、转义扩展、正则三种模式。",
    principle: "正则模式编译带 g 的正则并匹配计数；扩展模式先解析 \\n \\t \\xHH 转义再按字面切分；纯文本模式直接 split(搜索串).length−1。没给搜索串返回 0。",
    usage: "mode 选 Regex / Extended / Simple string，search 填搜索串。正则非法时返回 0（不抛错）。",
    examples: [
      { in: "abcabcABC", param: "mode=Regex, search=abc", out: "3" },
      { in: "a,b,c", param: "mode=Simple string, search=,", out: "2" },
    ],
    tips: ["正则模式带 i 标志，默认忽略大小写。", "纯文本模式是字面匹配，特殊字符不解释。", "扩展模式适合统计换行 \\n 这类不可见字符。"],
    aka: [
      "count occurrences", "出现次数", "count", "计数", "occurrence count",
      "统计出现", "count matches", "字符串计数", "frequency count", "count substring",
      "occurrences", "match count", "统计次数",
    ],
  },
  expandAlphabetRange: {
    what: "把 a-z 这种范围写法展开成完整字符序列，比如输入 `a-c` 得到 `abc`。",
    principle: "从左往右扫描：遇到 `X-Y` 且 X 不是转义反斜杠时，取两端字符的 Unicode 码点，逐个生成字符；`\\-` 表示字面短横。其余字符原样输出。支持多字节码点（surrogate pair）。",
    usage: "输入范围串，delim 是输出字符之间的连接符（默认空，即直接相连）。",
    examples: [
      { in: "a-c", param: "delim=", out: "abc" },
      { in: "0-3A", param: "delim=,", out: "0,1,2,3,A" },
      { in: "a\\-c", param: "delim=", out: "a-c" },
    ],
    tips: ["常用于快速构造自定义字母表。", "范围两端会按 Unicode 码点顺序枚举，包含两端。", "想要字面短横用 \\- 转义。"],
    aka: [
      "expand alphabet range", "展开字母表范围", "alphabet expansion", "字母范围展开",
      "range expand", "扩展范围", "a-z expand", "char range", "字符范围展开",
      "expand range", "alphabet range", "sequence expand", "范围展开",
    ],
  },
  textWrap: {
    what: "按指定宽度给长文本折行，超过宽度的部分换到下一行。",
    principle: "用正则 `.{1,width}` 全局匹配，匹配到的每个块之间插入 \\n。宽度必须是 1..65536 的整数。",
    usage: "width 填行宽（默认 64），输入为空返回空串。",
    examples: [
      { in: "1234567", param: "width=3", out: "123\n456\n7" },
      { in: "abcdef", param: "width=4", out: "abcd\nef" },
    ],
    tips: ["按字符数硬折，不认单词边界，不会在空格处优先断。", "base64/textwrap 常见宽度是 64。", "宽度非法（<1 或 >65536 或非整数）直接报错。"],
    aka: [
      "wrap", "折行", "word wrap", "自动换行", "line wrap", "折行处理",
      "text wrapping", "按宽折行", "wrap text", "fold text", "文本折行",
      "line folding", "按宽度换行",
    ],
  },
  xmlMinify: {
    what: "压缩 XML：去掉标签之间的空白缩进和无用注释，让文档更紧凑。移植 vkbeautify 的 xmlmin。",
    principle: "默认先删除注释（`<!-- ... -->`）并把 `xmlns` 前的连续空白压成一个空格，然后把 `>\\s*<` 之间的空白全部删掉，使标签首尾相接。",
    usage: "preserveComments 勾选则保留注释。输入为 XML 文本。",
    examples: [
      { in: "<a>\n  <b>1</b>\n</a>", param: "preserveComments=false", out: "<a><b>1</b></a>" },
      { in: "<a>  x  </a>", param: "", out: "<a>  x  </a>" },
    ],
    tips: ["只压缩标签间空白，标签内的文本（如 `<a> x </a>`）不动。", "它对空白敏感的 XML 基本安全，但签名前仍需谨慎。", "要美化（反向加缩进）请用数据转换里的 XML 美化。"],
    aka: [
      "XML minify", "XML压缩", "minify xml", "压缩XML", "xml minifier",
      "XML去空白", "xml compact", "xml one line", "xml compress", "XML 精简",
      "compact xml", "xml strip whitespace", "XML 压缩去除空白",
    ],
  },
  htmlToText: {
    what: "把 HTML 输出转成普通字符串。在 CyberChef 里它其实是一次「输入类型 html → 字符串」的转换，所以对本工具来说语义等价于原样输出。",
    principle: "op 本身是恒等函数：输入什么返回什么。区别只在于上游把它当作 HTML 类型处理，本项目没有独立的 html 输入/输出类型，因此不做任何重写。",
    usage: "无参数，直接把内容传过去即可。",
    examples: [
      { in: "<b>hi</b>", param: "", out: "<b>hi</b>" },
    ],
    tips: ["它不会删标签，删标签请用 Strip HTML tags。", "存在的意义主要是对齐 CyberChef 的配方类型链。", "把它当「透传/占位」理解即可。"],
    aka: [
      "HTML to text", "HTML转文本", "html2text", "HTML 转纯文本", "html to string",
      "提取文本", "strip to text", "html text", "html2string", "HTML 文本化",
      "html text convert", "plain text from html", "HTML 输出转字符串",
    ],
  },
  stripHtmlTags: {
    what: "删除 HTML 里所有的标签，只留下文字内容。可选去缩进、去多余空行。",
    principle: "反复用正则删除 `<...>`，直到长度不再变化（处理嵌套/残留）。若开启，会先递归删除 `<script>...</script>` 和 `<style>...</style>` 整块，再做缩进与空行整理。",
    usage: "removeIndentation 去行首缩进，removeLineBreaks 合并多余空行，默认都开。",
    examples: [
      { in: "<p>Hello <b>world</b></p>", param: "removeIndentation=true, removeLineBreaks=true", out: "Hello world" },
      { in: "<div>\n  <span>x</span>\n</div>", param: "removeLineBreaks=true", out: "x" },
    ],
    tips: ["它删标签不解析 HTML 实体（&amp; 之类不会自动还原）。", "script/style 是否删除取决于实现，本工具默认会连同内容一起删。", "网页取文本、爬虫清洗常用。"],
    aka: [
      "strip html tags", "剥离HTML标签", "remove html tags", "删除HTML标签",
      "html tag remover", "去标签", "strip tags", "HTML去标签", "remove tags",
      "clean html", "html cleaner", "标签剥离", "去除HTML标签",
    ],
  },
  generateUuid: {
    what: "生成 UUID（通用唯一标识符），版本可选 v1/v3/v4/v5/v6/v7，符合 RFC 9562。",
    principle:
      "UUID 是 128 位标识。v1/v6 基于时间（100ns 粒度 + 时钟序列 + 节点），v4 基于随机数，v7 用 Unix 毫秒 + 随机。v3/v5 是「命名空间 + 名字」经 MD5/SHA-1 摘要得到的确定性 UUID，同一个名字永远得到同一个值。版本号和变体位会被强制写进指定比特。",
    usage: "version 选版本；v3/v5 必须提供一个合法的 namespace UUID（默认给了个示例），输入框内容就是「名字」。v1/v4/v6/v7 忽略输入。",
    examples: [
      { in: "", param: "version=v4", out: "e.g. 2f1c8b7a-6d3e-4a91-9c2b-7f0d5e6a1b34" },
      { in: "hello", param: "version=v5, namespace=1b671a64-40d5-491e-99b0-da01ff1f3341", out: "确定性值，同名同结果" },
    ],
    tips: ["v3/v5 是确定性的，常用于「按名字生成稳定 ID」。", "v4 完全随机，最常用。", "namespace 必须是合法 UUID，非法会明确报错。"],
    aka: [
      "generate uuid", "生成UUID", "uuid generator", "UUID 生成", "guid",
      "generate guid", "uuid v4", "uuid v5", "uuid gen", "生成GUID",
      "uuid generator tool", "random uuid", "通用唯一标识符",
    ],
  },
  fileTree: {
    what: "把一堆文件路径渲染成树形结构图，方便一眼看清目录层级。",
    principle: "先把条目保序去重并排序，然后对每条路径按路径分隔符逐级展开：第一层直接显示，后续层级前面加 `|   ` 重复若干次的缩进和 `|---` 前缀；已出现过的前缀不重复输出。",
    usage: "fileDelim 是路径分隔符（默认 /），entryDelim 是条目分隔符（默认换行）。",
    examples: [
      { in: "a/b/c\na/b/d\na/e", param: "fileDelim=/, entryDelim=Line feed", out: "a\n|---b\n|   |---c\n|   |---d\n|---e" },
    ],
    tips: ["输出用 `|---`/`|   ` 画层，纯文本也能看清结构。", "路径前导分隔符会被忽略。", "条目先去重再排序，所以顺序是字母序。"],
    aka: [
      "file tree", "文件树", "directory tree", "目录树", "tree view",
      "文件树渲染", "folder tree", "路径树", "file tree generator", "list to tree",
      "tree renderer", "path tree", "路径转树",
    ],
  },

  // ============================ ocr：图片文字识别 1 ============================
  ocr: {
    what: "OCR 文字识别：把图片里的文字提取成可编辑文本。支持 png/jpg/bmp/pbm，语言可选英文、简体中文或中英混合。引擎是 tesseract.js，全部在浏览器本地跑，不上传图片。",
    principle:
      "tesseract.js 是 tesseract OCR 的 WebAssembly 版。它先把图片转成灰度/二值，做页面分析找出文本行，再用语言模型（LSTM + 字符特征）逐行识别，最后输出文本和整体置信度。worker（识别线程）、core（WASM 引擎）、语言模型（traineddata）都随包放在 public/vendor/ocr/，首次加载后进 IndexedDB 缓存。\n\n" +
      "语言模型决定识别哪套字符：eng 只认英文，chi_sim 认简体中文，eng+chi_sim 两套一起加载（更慢但对中英混排更好）。",
    usage: "输入 png/jpg/bmp/pbm（可拖文件或给 dataURL/base64）。lang 选 eng / chi_sim / eng+chi_sim；showConfidence 决定首行是否输出 `Confidence: N%`。首次使用要等引擎 + 模型加载完成。",
    examples: [
      { in: "screenshot.png（含英文）", param: "lang=eng, showConfidence=true", out: "Confidence: 92%\n\nHello World" },
      { in: "captcha.bmp", param: "lang=eng, showConfidence=false", out: "识别出的文字" },
    ],
    tips: ["识别质量很依赖清晰度与对比度，模糊/倾斜图片先做预处理。", "中文模型比英文大，首次加载更慢。", "图片不会离开本机；但资源缺失时会明确报错而不是静默失败。"],
    aka: [
      "OCR", "光学字符识别", "文字识别", "tesseract", "tesseract.js",
      "图片转文字", "图像识别", "image to text", "image ocr", "picture to text",
      "screenshot to text", "extract text from image", "扫描识别", "图片文字提取",
    ],
  },
};
