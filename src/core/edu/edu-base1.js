// 科普内容分片：base 家族前 12（base36/45/92/100/radixN/baseCustom/base58check/radix64/base69/z85/base85ipv6/base2048）。纯数据，无 import 无副作用。
export default {
  base36: {
    what: "用 0-9 加 a-z 共 36 个字符表示字节的编码。把整串数据当成一个大整数，再写成 36 进制。",
    principle:
      "把 UTF-8 字节序列拼成一个大整数，反复除以 36 取余，余数查字母表 `0-9a-z`。\n\n" +
      "开头的零字节对应开头的 `0`，其余按大整数展开。没有分组、没有 padding，长度不固定。",
    usage: "解码：粘 base36 串还原原文。编码：把原文转成 base36。可自定义 36 字符码表。",
    examples: [
      { in: "eax", out: "Hi" },
      { in: "flag", param: "编码方向", out: "sf2tlz", desc: "反过来把明文编码" },
    ],
    tips: ["只有小写字母数字、没有大写也没有符号，长度不定，考虑 base36。", "它和 base16/62 一样是大整数进制编码，不是按块切位。"],
    aka: ["base 36", "b36", "36进制", "base36编码", "三十六进制", "36进制编码",
      "0-9a-z编码", "大整数进制", "radix36", "alphanumeric base", "字母数字编码", "base thirty-six"],
  },

  base45: {
    what: "为 QR 码设计的编码（RFC 9285）：每 2 个字节用 3 个字符表示，字符集含大写字母、数字和少量符号。",
    principle:
      "每 2 字节看成一个 0-65535 的数，写成 3 位 45 进制（小端：低位在前）。\n\n" +
      "剩单个字节时用 2 位表示。字母表是 `0-9A-Z` 再加 ` $%*+-./:` 这 9 个符号，正好 45 个。",
    usage: "粘 base45 文本解码；编码方向把原文转 base45。注意空格是合法字符（码表第 37 位），不要随手删。",
    examples: [
      { in: "BB8", out: "AB", desc: "2 字节 → 3 字符" },
      { in: ".69", out: "Hi" },
    ],
    formulas: [
      { tex: "n = b_0 \\times 256 + b_1,\\quad n = c_0 + c_1\\times 45 + c_2\\times 45^2", caption: "2 字节 ↔ 3 字符（小端 45 进制）" },
    ],
    tips: ["QR 码题里出现全大写+数字+个别符号的短串，长度多是 3 的倍数附近，试 base45。", "COVID 疫苗证书（EU DCC）就用 base45，是它最出名的应用。"],
    aka: ["base 45", "b45", "rfc9285", "base45编码", "四十五进制", "RFC 9285",
      "QR码编码", "二维码base", "疫苗证书编码", "EU DCC", "COVID证书编码", "radix45"],
  },

  base92: {
    what: "高密度编码，用 91 个可打印字符（外加空串标记 `~`），每 13 位一块。字符集杂、密度比 base85 还高。",
    principle:
      "把字节流拼成比特串，每 13 位取一段：满 13 位的段值域 0-8191，拆成两个 91 进制字符输出；\n\n" +
      "末尾不足的段按 6 位输出一个字符。空输入约定输出 `~`。",
    usage: "粘 base92 文本解码；编码方向反向。支持自定义码表。",
    examples: [
      { in: "8q", out: "A", desc: "1 字节 8 位 → 末段 6 位规则" },
      { in: ";L*", out: "Hi" },
    ],
    tips: ["字符范围很宽（含各种标点），密度又高，长度没有明显规律，考虑 base92。", "单独一个 `~` 代表空串，别当成乱码。"],
    aka: ["base 92", "b92", "92进制", "base92编码", "九十二进制", "高密度编码",
      "91字符编码", "13位分块编码", "radix92", "base ninety-two", "高密base", "可打印字符编码"],
  },

  base100: {
    what: "把每个字节变成一个 emoji 的趣味编码。看起来满屏小图标，其实是一一对应的字节。",
    principle:
      "每个字节 $b$（0-255）映射到码点 $\\text{U+1F3F7} + b$，也就是从 🏷 起连续 256 个 emoji 里取第 $b$ 个。\n\n" +
      "一个字节对应一个 emoji（UTF-8 下是 4 个字节），所以还原时按 4 字节一组反查。",
    usage: "粘 emoji 串解码回原文；编码方向把文本转 emoji。",
    examples: [
      { in: "🐸", out: "A", desc: "'A'=65 → U+1F3F7+65" },
      { in: "🐿👠", out: "Hi" },
    ],
    formulas: [
      { tex: "\\text{emoji} = \\text{U+1F3F7} + b", caption: "b 为字节值 0-255" },
    ],
    tips: ["满屏都是同一区段的 emoji（动物、物件那一带），字符数正好等于原文字节数，就是 base100。"],
    aka: ["base 100", "b100", "emoji编码", "💯", "base100编码", "表情符号编码",
      "emoji base", "emojibase", "字节转emoji", "图标编码", "百分号编码", "emoji字节编码"],
  },

  radixN: {
    what: "任意 N 进制的大整数编码（N = 2..95）：把数据当一个大整数，用你指定的进制和码表写出来。base36/58/62 都是它的特例。",
    principle:
      "整串字节拼成大整数后反复除 N 取余查表。默认码表是从 ASCII 33（`!`）起的可打印字符，也可自己填码表。\n\n" +
      "进制 N 就等于码表长度。前导零字节 → 前导首字符。",
    usage: "填进制 N 和（可选）码表，粘输入转换。想要 16 进制就填 N=16、码表 `0123456789ABCDEF`。",
    examples: [
      { in: "Hi", param: "N=16, 码表=0123456789ABCDEF", out: "4869", desc: "等价于 hex" },
    ],
    tips: ["它是 base 家族的万能底座：调 N 和码表就能模拟各种 base 编码。", "无法自动识别，得知道对方用了几进制、什么码表。"],
    aka: ["任意进制", "radix n", "radixN", "n进制base", "任意base", "自定义进制",
      "大整数进制", "base n", "radix编码", "进制编码", "通用base", "N进制转换"],
  },

  baseCustom: {
    what: "自定义字母表 Base：你给一串不重复字符当码表，进制就等于码表长度。想怎么编就怎么编。",
    principle: "和 radixN 同一套大整数算法，只是进制由码表长度自动决定。码表必须无重复字符、至少 2 个。",
    usage: "在码表框里填字母表（如 `0123456789ABCDEF` 就是 16 进制），粘输入编解码。",
    examples: [
      { in: "Hi", param: "码表=0123456789ABCDEF", out: "4869" },
    ],
    tips: ["CTF 里常见「自造 base 表」题——把标准 base64/58 的码表打乱，用这个填对方的码表就能解。"],
    aka: ["自定义base", "custom base", "自定义字母表", "自定义码表", "custom alphabet",
      "自造base表", "打乱码表", "变体base", "自定义base64", "换表base", "custom charset", "码表自定义"],
  },

  base58check: {
    what: "在 base58 后面接一段校验码，比特币地址就用它。抄错一个字符会校验失败，防手滑。",
    principle:
      "先算数据的双重 SHA-256（$\\text{SHA256}(\\text{SHA256}(data))$），取前 4 字节当校验和，拼在数据后面，整体做 base58。\n\n" +
      "解码时重算校验和比对，不一致就报错。",
    usage: "粘 base58check 串解码（会自动验校验）；编码方向把原文加校验后转 base58。码表可自定义。",
    examples: [
      { in: "tzgy3cTQ", out: "hi", desc: "尾部 4 字节是双 SHA-256 校验" },
    ],
    formulas: [
      { tex: "checksum = \\text{SHA256}(\\text{SHA256}(payload))[0..4]", caption: "取前 4 字节附在末尾" },
    ],
    tips: ["比特币地址、WIF 私钥都是 base58check。识别到疑似地址，用它解能顺带验真伪。"],
    aka: ["base58 check", "b58check", "比特币地址编码", "base58check编码", "Base58Check",
      "bitcoin地址", "WIF私钥", "带校验base58", "双SHA256校验", "钱包地址编码", "checksum base58", "加密货币地址"],
  },

  radix64: {
    what: "Unix 密码 crypt 用的 base64 变体：码表是 `./A-Za-z0-9`，位打包方向和顺序都和标准 base64 不一样，无 padding。",
    principle: "6 位一组查表，和 base64 同理，但字母表换成 `./` 打头再接 `A-Za-z0-9`，且不补 `=`。",
    usage: "粘 radix64 串解码；编码方向反向。",
    examples: [
      { in: "QEi", out: "Hi" },
    ],
    tips: ["看到疑似 base64 但以 `.` `/` 打头、且是 crypt/htpasswd 相关场景，试 radix64。"],
    aka: ["radix 64", "crypt base64", "./A-Za-z0-9", "radix64编码", "crypt编码",
      "unix crypt", "htpasswd编码", "base64变体", "DES crypt", "密码哈希编码", "b64crypt", "非标准base64"],
  },

  base69: {
    what: "pshihn 的趣味编码：7 字节一块，末尾带 padding 标记。密度不高，纯粹好玩。",
    principle:
      "每 7 字节转成比特串，再每 7 位切一段，每段值 0-127 用「两个 69 进制字符」表示（低位在前）。\n\n" +
      "结尾附一对 `N=` 标记，$N = 7 - (\\text{字节数} \\bmod 7)$，用于还原原始长度。",
    usage: "粘 base69 文本解码；编码方向反向。可自定义 69 字符码表。",
    examples: [
      { in: "gA-AAAAAAAAAAA6=", out: "A", desc: "末尾 6= 是 padding 标记" },
      { in: "kAaAgAAAAAAAAA5=", out: "Hi" },
    ],
    tips: ["结尾是「一个数字 + 等号」（如 `6=`），中间一堆重复的 `A`，是 base69 的典型长相。"],
    aka: ["base 69", "b69", "pshihn base69", "base69编码", "六十九进制", "radix69",
      "趣味base", "7字节分块编码", "base sixty-nine", "娱乐编码", "base69.js", "冷门base"],
  },

  z85: {
    what: "ZeroMQ 的 Base85（Z85）：每 4 字节用 5 个字符表示，字符集专挑在字符串/源码里安全的可打印符号。",
    principle: "每 4 字节当一个 32 位整数，写成 5 位 85 进制。字母表 `0-9a-zA-Z.-:+=^!/*?&<>()[]{}@%$#`，避开了引号、反斜杠等易惹麻烦的字符。",
    usage: "粘 Z85 文本解码；编码方向反向。可自定义 85 字符码表。",
    examples: [
      { in: "nne", out: "Hi" },
      { in: "raQb)", out: "Test", desc: "4 字节 → 5 字符" },
    ],
    tips: ["和 Ascii85 密度一样（4→5），但字母表不同、没有 `<~ ~>` 包裹。ZeroMQ / CurveZMQ 密钥常用它。"],
    aka: ["z85", "zeromq base85", "z 85", "Z85编码", "ZeroMQ编码", "ZMQ base85",
      "CurveZMQ", "RFC 32", "ascii85变体", "base85 z85", "4字节5字符编码", "zeromq ascii85"],
  },

  base85ipv6: {
    what: "RFC 1924 定义的 Base85，本是给 IPv6 地址做紧凑表示的（现已废弃），码表和 Z85 不同。",
    principle: "同样是 4 字节 → 5 字符的 85 进制，但字母表为 `0-9A-Za-z` 再加一批符号，顺序与 Z85 不一样。",
    usage: "粘该变体文本解码；编码方向反向。可自定义 85 字符码表。",
    examples: [
      { in: "NNE", out: "Hi" },
    ],
    tips: ["RFC 1924 原是个愚人节玩笑式提案，CTF 里偶尔拿来当冷门 base85 变体考。"],
    aka: ["base85 ipv6", "rfc1924", "ipv6 base85", "RFC 1924", "base85 ipv6变体",
      "ipv6紧凑表示", "愚人节base85", "ascii85 ipv6", "b85 ipv6", "IPv6地址编码", "base85变体", "rfc1924 base85"],
  },

  base2048: {
    what: "qntm 设计的编码：每 11 位映射成 1 个 Unicode 字符，从一张 2048 字的表里取。目标是在按「字符数」限流的地方（如推文）塞更多数据。",
    principle:
      "把字节流当比特流，每 11 位取一个索引（$2^{11}=2048$），查 2048 字符表输出一个字符。\n\n" +
      "末尾不足 11 位时用一张 8 字的短表（3 位）收尾，并补 1 对齐。",
    usage: "粘 base2048 文本解码；编码方向把原文转 base2048。",
    examples: [
      { in: "ԋՈ", out: "Hi", desc: "16 位 → 11+5，一个主表字符+一个收尾字符" },
    ],
    tips: ["一串看不懂的各国文字字符、字符数明显比字节数少，可能是 base2048 或 base65536 这类 Unicode 紧凑编码。"],
    aka: ["base 2048", "b2048", "qntm base2048", "base2048编码", "Unicode紧凑编码",
      "11位编码", "推特编码", "tweet编码", "Unicode base", "2048字符表", "base65536同类", "高密Unicode编码"],
  },
};
