/*
 * eduContent.part-base.js — 科普卡数据分片：Base 家族 + 文本/传输编码 + 进制/字符集。
 * 纯数据，无 import、无副作用。格式契约见 eduContent.js 头注释。
 * 面向大一大二学生：通俗、准确、能跑通的例子。
 */

export default {
 // ============ Base 家族 ============
  base64: {
    what: "把任意字节用 64 个可打印字符（A-Z a-z 0-9 + /）表示出来的编码，让二进制数据能安全地放进文本里传输。",
    principle:
      "每 3 个字节（24 位）切成 4 组、每组 6 位，6 位刚好能索引一张 64 字符的表。\n\n" +
      "3 字节不够时用 0 补齐，末尾按补了几个字节打 1~2 个 `=` 号：所以 base64 串长度总是 4 的倍数，结尾常见 `=` 或 `==`。",
    usage:
      "解码方向：把 base64 文本粘进来 → 一键解码得原文。编码方向：切到「编码」把原文转成 base64。\n" +
      "URL-safe 变体把 `+/` 换成 `-_`，可在参数里选码表；也支持自定义字母表。",
    examples: [
      { in: "SGVsbG8=", out: "Hello", desc: "结尾一个 = 表示补了 1 字节" },
      { in: "flag{b64}", param: "编码方向", out: "ZmxhZ3tiNjR9", desc: "反过来把明文编码" },
    ],
    formulas: [
      { tex: "3\\text{ 字节} \\times 8\\text{ 位} = 24\\text{ 位} = 4 \\times 6\\text{ 位}", caption: "base64 的 3→4 换算关系" },
    ],
    tips: [
      "看到只有大小写字母数字加 +/ 且长度是 4 的倍数、可能带 = 结尾，八成是 base64。",
      "末尾 = 的个数：1 个补了 2 字节，2 个补了 1 字节，没有则正好整除。",
      "拿到不确定的串先丢首页「一把梭」，它会自动嵌套试 base 家族。",
    ],
    aka: ["base 64", "b64", "标准base64", "Base64", "基64", "base64编码", "base64 encode", "RFC 4648", "MIME编码", "六十四进制"],
  },

  base32: {
    what: "用 32 个字符（A-Z 和 2-7）表示字节的编码，比 base64 更长但只用大写字母和少量数字，肉眼好认。",
    principle:
      "每 5 个字节（40 位）切成 8 组、每组 5 位，5 位索引 32 字符表（RFC 4648 用 `A-Z2-7`）。\n\n" +
      "不足 5 字节时补 0 并用 `=` 填充，所以 base32 串长度是 8 的倍数，结尾常见一串 `=`。",
    usage: "粘 base32 文本一键解码；编码方向把原文转 base32。支持自定义码表。",
    examples: [
      { in: "NBSWY3DP", out: "hello", desc: "全大写+数字，典型 base32 长相" },
      { in: "JBSWY3DPEBLW64TMMQ======", out: "Hello World", desc: "结尾一长串 = 是它的标志" },
    ],
    tips: [
      "只有大写字母 A-Z 和数字 2-7（没有 0/1/8/9），结尾常带多个 =，基本就是 base32。",
      "没有小写、没有 +/，是和 base64 最好区分的一点。",
    ],
    aka: ["base 32", "b32", "Base32", "base32编码", "base32 encode", "基32", "RFC 4648", "A-Z2-7编码", "base32解码", "三十二进制"],
  },

  base16: {
    what: "就是十六进制（Hex）：每个字节用两个 0-9A-F 字符表示。最直白的字节写法，几乎所有工具都用它显示二进制。",
    principle:
      "一个字节 8 位，拆成高 4 位、低 4 位，每 4 位（0~15）用一个十六进制符号表示。\n\n" +
      "所以每字节固定 2 个字符，Hex 串长度总是偶数。",
    usage: "粘 hex（可带或不带空格）一键解码成原文；编码方向把原文转 hex。",
    examples: [
      { in: "48656c6c6f", out: "Hello" },
      { in: "66 6c 61 67", out: "flag", desc: "带空格也能解" },
    ],
    tips: [
      "只有 0-9 和 a-f/A-F、长度为偶数，就是 hex。",
      "开头是 `504b` (PK)、`ffd8` (JPEG)、`8950` (PNG) 等，往往是文件的十六进制——先看文件魔数。",
    ],
    aka: ["hex", "十六进制", "base 16", "Base16", "hex编码", "hexadecimal", "十六进制编码", "16进制", "hex string", "hex转字符"],
  },

  base58: {
    what: "去掉了容易混淆字符（0/O、I/l）的 base 编码，比特币地址和短链接爱用它，人抄写不容易出错。",
    principle:
      "把整串字节当成一个大整数，不停除以 58 取余，余数查 58 字符表。\n\n" +
      "字母表去掉了 `0`、`O`、`I`、`l` 这几个长得像的，所以没有分组、长度不固定。",
    usage: "粘 base58 串解码；编码方向把原文转 base58。可选 Bitcoin/Flickr/Ripple 等不同字母表。",
    examples: [
      { in: "StV1DL6CwTryKyV", out: "hello world" },
    ],
    tips: ["没有 0、大写 O、大写 I、小写 l 的一串字母数字，很可能是 base58。"],
    aka: ["base 58", "b58", "比特币编码", "Base58", "base58编码", "base58check", "bitcoin base58", "base58 encode", "比特币地址编码", "五十八进制"],
  },

  base85: {
    what: "密度比 base64 更高的编码：每 4 字节用 5 个字符表示。Adobe 的 Ascii85 和 ZeroMQ 的 Z85 都是它的变体。",
    principle:
      "每 4 字节（32 位）当作一个整数，用 85 进制表示成 5 个字符（$85^5 > 2^{32}$，够用）。\n\n" +
      "Ascii85 常用 `<~ ~>` 包裹，全零的 4 字节可压成一个 `z`。",
    usage: "粘 base85/Ascii85 文本解码；编码方向反向。Z85 变体见单独的 z85 功能。",
    examples: [
      { in: "<~87cURDZ~>", out: "Hello", desc: "<~ ~> 是 Ascii85 的包裹标记" },
    ],
    tips: ["出现 <~ ~> 包裹，或字符范围很宽（含标点符号）密度又高，考虑 base85。"],
    aka: ["ascii85", "base 85", "a85", "Base85", "Ascii85", "base85编码", "Adobe ASCII85", "Z85", "base85 encode", "八十五进制"],
  },

  base91: {
    what: "比 base85 密度更高的编码，用 91 个可打印字符，CTF misc 里偶尔出现的高密度变体。",
    principle: "变长分组（每组 13 或 14 位），查 91 字符表。字符集包含大量标点，长相比较杂。",
    usage: "粘 basE91 文本解码，编码方向反向。支持自定义码表。",
    examples: [
      { in: "fPNKd", out: "test", desc: "含标点、密度高" },
    ],
    aka: ["base 91", "basE91", "Base91", "base91编码", "basE91编码", "b91", "base91 encode", "九十一进制", "高密度编码", "base91解码"],
  },

  base62: {
    what: "只用字母数字（0-9A-Za-z）的 base 编码，没有任何符号，常用于短链接和 ID。",
    principle: "把字节当大整数反复除 62 取余查表。字符集干净（无 +/=），URL 里可直接用。",
    usage: "粘 base62 串解码；编码方向反向。支持自定义码表。",
    examples: [{ in: "AAwf93rvy4aWQVw", out: "hello world" }],
    tips: ["纯字母数字、没有任何符号也没有 = 补齐，长度不定，考虑 base62。"],
    aka: ["base 62", "b62", "Base62", "base62编码", "base62 encode", "六十二进制", "字母数字编码", "短链接编码", "0-9A-Za-z", "base62解码"],
  },

  base64url: {
    what: "base64 的 URL 安全版：把 `+ /` 换成 `- _`，去掉或保留 `=`。JWT 的每一段就是它。",
    principle: "编码规则和 base64 完全一样，只是最后两个字符换成 URL 里不需要转义的 `-` 和 `_`。",
    usage: "粘 base64url 文本解码。看到 JWT（三段用 . 分隔）时，每段单独用它解。",
    examples: [
      { in: "SGVsbG8_d29ybGQ", out: "Hello?world", desc: "用了 _，且无 = 补齐" },
    ],
    tips: ["出现 - 或 _ 而没有 + /，是 base64url 的标志。JWT 各段都是它。"],
    aka: ["base64 url", "url safe base64", "b64url"],
  },

 // ============ 文本 / 传输编码 ============
  url: {
    what: "URL 百分号编码：把 URL 里不能直接出现的字符（空格、中文、符号）写成 `%` 加两位十六进制。Web 题最常见。",
    principle:
      "按 UTF-8 把字符转成字节，每个「不安全」字节写成 `%XX`（XX 是该字节的十六进制）。\n\n" +
      "空格有两种写法：`%20`，或在查询串里写成 `+`。",
    usage: "粘含 %XX 的文本一键解码；编码方向把原文转百分号编码。可选 standard/full/plus 三种强度。",
    examples: [
      { in: "flag%7Bh3ll0%7D", out: "flag{h3ll0}", desc: "%7B=左花括号 %7D=右花括号" },
      { in: "a%20b+c", out: "a b c", desc: "%20 和 + 都是空格" },
    ],
    tips: ["满屏 %XX 就是 URL 编码。%7B/%7D 是花括号，flag 常被这样包起来。"],
    aka: ["urlencode", "percent encoding", "百分号编码", "url编码", "URL编码", "url encode", "urldecode", "%XX编码", "百分比编码", "网址编码"],
  },

  htmlEntity: {
    what: "HTML 实体编码：把 `< > &` 等在网页里有特殊含义的字符写成 `&lt;` `&#60;` 这样的转义形式。",
    principle:
      "两种写法：命名实体（`&amp;` `&lt;`）和数字实体（十进制 `&#60;` 或十六进制 `&#x3C;`）。\n\n" +
      "数字实体指向字符的 Unicode 码点，所以任何字符都能这样写。",
    usage: "粘含 & ...; 的文本解码；编码方向反向。命名与数字实体都能识别。",
    examples: [
      { in: "&lt;script&gt;", out: "<script>", desc: "XSS 题里常见" },
      { in: "&#102;&#108;&#97;&#103;", out: "flag", desc: "纯数字实体也能藏 flag" },
    ],
    tips: ["满屏 &#数字; 或 &名字; 就是 HTML 实体。可以逐字符藏 flag。"],
    aka: ["html实体", "html entities", "字符实体", "HTML实体编码", "html entity", "html转义", "数字实体", "命名实体", "&#编码", "字符实体编码"],
  },

  quotedPrintable: {
    what: "邮件里用的编码：把非 ASCII 字节写成 `=XX`，行太长用 `=` 结尾软换行。看到满屏 `=XX` 想到它。",
    principle: "可打印 ASCII 原样保留，其余字节写成 `=` 加两位十六进制；`=` 本身写成 `=3D`；行末 `=` 表示软换行（拼接下一行）。",
    usage: "粘 QP 文本解码；编码方向反向。",
    examples: [
      { in: "=E4=BD=A0=E5=A5=BD", out: "你好", desc: "中文被拆成 UTF-8 字节的 =XX" },
    ],
    tips: ["和 URL 编码像，但用 = 不是 %，且常出现在邮件源码里。"],
    aka: ["qp", "quoted printable", "=XX编码", "Quoted-Printable", "QP编码", "quoted-printable编码", "邮件编码", "MIME QP", "可打印引用", "软换行编码"],
  },

  unicodeEscape: {
    what: "把字符写成 `\\uXXXX` 或 `U+XXXX` 这类转义形式，常出现在 JS/JSON 源码和被混淆的字符串里。",
    principle: "每个字符用它的 Unicode 码点表示，`\\u` 后跟 4 位十六进制（BMP 内），或 `U+`、`&#x..;` 等写法。",
    usage: "粘 \\uXXXX 文本解码成原字符；编码方向把原文转义。支持三种格式。",
    examples: [
      { in: "\\u0066\\u006c\\u0061\\u0067", out: "flag" },
    ],
    tips: ["满屏 \\u 开头四位十六进制，就是 Unicode 转义。"],
    aka: ["unicode转义", "\\u编码", "utf escape", "Unicode转义", "\\uXXXX", "unicode escape", "u+编码", "码点转义", "js unicode", "unicode码点"],
  },

 // ============ 进制 / 字符集 ============
  radixConvert: {
    what: "任意进制之间互转（2~36）：二进制、八进制、十进制、十六进制随便换，用 BigInt 不怕大数溢出。",
    principle: "把源进制的数解析成一个整数，再按目标进制展开。$0\\text{-}9$ 之后用字母 $a\\text{-}z$ 表示 $10\\text{-}35$。",
    usage: "填源进制和目标进制，输入数字串即可转换。大数也没问题。",
    examples: [
      { in: "255", param: "10 → 16", out: "ff" },
      { in: "1010", param: "2 → 10", out: "10" },
    ],
    tips: ["CTF 里常把 flag 的每个字符 ASCII 码写成某个进制，先转十进制再查 ASCII。"],
    aka: ["进制转换", "radix", "base convert", "进制互转"],
  },

  mixHexOctBin: {
    what: "把 `0x`/`0b`/`0o`/`0d` 前缀混在一起的一串数字，按各自进制解析回字符。混合进制题专用。",
    principle: "识别每段前缀：`0x` 十六进制、`0b` 二进制、`0o` 八进制、`0d` 十进制，各自转成字节再拼成文本。",
    usage: "把带前缀的混排数字串粘进来，一键解码出原文。",
    examples: [
      { in: "0x66 0b1101100 0o141 0d103", out: "flag", desc: "四种进制混排，各自解成 f/l/a/g" },
    ],
    aka: ["混合进制", "混排进制", "混排进制解码", "混合进制解码", "多进制混排", "进制前缀混排", "0x0b0o前缀", "前缀进制解析", "mixed radix", "0x 0b 0o 0d"],
  },
};
