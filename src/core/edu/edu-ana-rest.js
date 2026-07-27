// 科普内容分片：analysis 兜底（pwn 偏移 / 大整数 / 大小写 / 压缩流解压识别）。纯数据，无 import 无副作用。
export default {
  debruijn: {
    what: "De Bruijn 序列：一串「任意长度 n 的子串都只出现一次」的字符序列。pwn 里用来一发定位栈溢出覆盖了返回地址的哪几个字节。",
    principle:
      "长度 n 的 De Bruijn 序列里，每个长为 n 的子片段都独一无二。缓冲区溢出时把它当输入喂进去，程序崩溃后 EIP/RIP 里那几个字节对应序列中唯一位置 → 反查就得到「溢出多少字节后开始覆盖返回地址」的精确偏移。",
    usage: "先生成一段 De Bruijn 序列做溢出输入；崩溃后把覆盖到的地址/字节丢回来查偏移。",
    examples: [
      { in: "生成长度 4 的序列", out: "aaaabaaacaaad...", desc: "每 4 字节子串唯一" },
      { in: "崩溃时 EIP=0x61616168", param: "查偏移", out: "偏移 = 某个确定值" },
    ],
    tips: ["等价于 pwntools 的 cyclic/cyclic_find。拿崩溃寄存器值（小端要先转回字符）查偏移，一次就定位。"],
    aka: ["de bruijn", "德布鲁因序列", "cyclic", "溢出偏移", "pattern", "de bruijn sequence", "德布鲁因", "cyclic pattern", "pwntools cyclic", "cyclic_find", "偏移定位", "溢出偏移计算", "栈溢出偏移"],
  },

  textIntConverter: {
    what: "文本 ↔ 大整数互转：把一段字节按 256 进制拼成一个大整数，或把大整数还原成字节。RSA 题里明文经常以大整数形式给出。",
    principle:
      "RSA 加解密对象是数，不是文本。约定俗成把字节串当作 256 进制大数：`m = Σ byte_i · 256^(len−1−i)`（等价于 bytes-to-long）。反向就是 long-to-bytes，把大整数按 8 位一组拆回字节。",
    usage: "文本方向把字符串转成大整数（喂给 RSA 模幂）；整数方向把解出的 m 还原成明文。",
    examples: [
      { in: '"AB"', out: "16706", desc: "0x4142 = 16706" },
      { in: "16706", param: "还原", out: "AB" },
    ],
    formulas: [
      { tex: "m = \\sum_{i=0}^{L-1} b_i \\cdot 256^{\\,L-1-i}", caption: "字节串按大端拼成大整数（bytes_to_long）" },
    ],
    tips: ["等价 pycryptodome 的 bytes_to_long / long_to_bytes。RSA 解出 m 是个大数，用它转回文本才见 flag。"],
    aka: ["文本转大整数", "bytes to long", "long to bytes", "大整数互转", "bytes_to_long", "long_to_bytes", "字节转整数", "整数转字节", "文本大数转换", "256进制大数", "big integer convert", "RSA明文转换"],
  },

  getAllCasings: {
    what: "大小写全排列：把一个单词的每个字母都试遍大写小写，生成所有组合。爆破大小写不敏感的口令/flag 时用。",
    principle:
      "n 个字母就有 2^n 种大小写组合。对每个字母位分别取大写或小写，笛卡尔积枚举全部。字母数一多组合爆炸，工具限制 ≤20 个字母防卡死。",
    usage: "输入一个词，输出它的全部大小写组合列表。",
    examples: [
      { in: "abc", out: "abc, abC, aBc, aBC, Abc, AbC, ABc, ABC", desc: "3 字母 → 2³=8 种" },
    ],
    tips: ["字母超 20 个会被拦（组合数百万级）。用于「flag 大小写不确定」或口令字典派生。"],
    aka: ["大小写全排列", "all casings", "大小写组合", "casing 爆破", "大小写枚举", "大小写笛卡尔积", "case permutation", "letter case brute", "大小写爆破", "2^n组合", "case variations", "大小写字典生成"],
  },

  alternatingCaps: {
    what: "交替大小写：把文本转成一大一小交替的 sPoNgEbOb 式写法。梗图文本、简单混淆里出现。",
    principle:
      "按位置奇偶决定每个字母大写还是小写，得到锯齿状大小写文本。纯粹的排版变换，不改字母本身，还原只需统一大小写。",
    usage: "输入文本，输出交替大小写形式。",
    examples: [
      { in: "hello world", out: "hElLo WoRlD" },
    ],
    tips: ["俗称 SpongeBob/mocking case。看到无规律大小写乱跳的文本，先无视大小写读内容。"],
    aka: ["交替大小写", "alternating caps", "spongebob case", "mocking case", "海绵宝宝大小写", "嘲讽大小写", "锯齿大小写", "sPoNgEbOb", "mocking spongebob", "alternating case", "一大一小", "交替大小写文本"],
  },

  gzipCodec: {
    what: "Gzip 解压/压缩：处理 `.gz` 那种 gzip 流。CTF 里 binwalk 出来一段 1F 8B 开头的数据，就用它解开。",
    principle:
      "gzip = DEFLATE 压缩数据 + 10 字节头（magic `1F 8B`、方法、时间戳等）+ 尾部 CRC32 和原始长度。工具走浏览器原生 DecompressionStream 双向处理，输入是 hex/base64/UTF-8 自动识别。",
    usage: "粘 gzip 数据（hex/base64/原始），解压得原文；反向可压缩。",
    examples: [
      { in: "1f 8b 08 00 ...", out: "解压后的原文", desc: "1F 8B 是 gzip magic" },
    ],
    tips: ["magic `1F 8B` = gzip。压缩包/流量题里常见，解出来可能又是另一层编码，层层剥。"],
    aka: ["gzip", "gzip解压", "gz", "gzip codec", "gzip压缩", "gunzip", ".gz解压", "gzip解码", "1f8b", "gzip流", "GNU zip", "gzip decompress"],
  },

  zlibCodec: {
    what: "Zlib 解压/压缩：处理 zlib 格式流（比 raw deflate 多 2 字节头 + 尾部 adler32 校验）。PNG 的 IDAT、很多协议内嵌压缩都是它。",
    principle:
      "zlib = 2 字节头（首字节常见 `78`，如 78 9C/78 DA）+ DEFLATE 数据 + 4 字节 Adler-32 校验尾。工具用浏览器实测双向处理。",
    usage: "粘 zlib 数据，解压得原文；反向可压缩。",
    examples: [
      { in: "78 9c ...", out: "解压后的原文", desc: "78 9C 是 zlib 默认压缩头" },
    ],
    tips: ["开头 `78 9C`/`78 DA`/`78 01` = zlib。PNG 的 IDAT chunk 内容就是 zlib 流，Git 对象也是。"],
    aka: ["zlib", "zlib解压", "zlib codec", "deflate+adler", "zlib压缩", "zlib解码", "78 9c", "78da", "adler32", "zlib流", "zlib decompress", "IDAT解压"],
  },

  deflateRawCodec: {
    what: "Raw Deflate 解压/压缩：处理没有 zlib/gzip 头的裸 DEFLATE 数据。ZIP 内文件、某些自定义封装用的就是裸流。",
    principle:
      "DEFLATE 本体 = LZ77 滑窗匹配 + Huffman 编码。raw deflate 就是纯压缩数据，不带 zlib 的 2 字节头也不带 gzip 的 10 字节头和校验尾。工具浏览器实测双向。",
    usage: "粘裸 deflate 数据，解压得原文；反向可压缩。",
    examples: [
      { in: "raw deflate 字节", out: "解压后的原文" },
    ],
    tips: ["没有 1F8B(gzip) 也没有 78(zlib) 头、但怀疑是压缩的 → 试 raw deflate。ZIP 里存的压缩数据就是它。"],
    aka: ["raw deflate", "裸deflate", "deflate", "deflate raw", "裸压缩流", "无头deflate", "DEFLATE解压", "LZ77+Huffman", "inflate", "raw inflate", "deflate解码", "裸压缩数据"],
  },

  archiveIdentify: {
    what: "归档/压缩流识别：拿一段二进制，按开头 magic 认出它是 gzip、zip、rar、7z、bzip2 还是 tar，认对了才知道用什么工具解。",
    principle:
      "各归档格式开头有固定签名：gzip `1F 8B`、zip `50 4B 03 04`(PK)、rar `52 61 72 21`(Rar!)、7z `37 7A BC AF 27 1C`、bzip2 `42 5A 68`(BZh)、zlib `78`、tar 在偏移 257 处有 `ustar`。工具比对这些 magic 并解析 gzip/bzip2 头。",
    usage: "粘数据，工具报出格式类型和头部信息。",
    examples: [
      { in: "50 4b 03 04 ...", out: "ZIP 归档 (PK)" },
      { in: "42 5a 68 39 ...", out: "bzip2 (BZh9)" },
    ],
    tips: ["认不出文件类型先看 magic：PK=zip、Rar!=rar、7z=7-Zip、BZh=bzip2。tar 的 ustar 在第 257 字节，不在开头。"],
    aka: ["归档识别", "archive identify", "magic识别", "文件类型识别"],
  },

  zipList: {
    what: "ZIP 结构解析：不解压，只读 ZIP 内部结构，列出里面有哪些文件、用什么压缩方式、是否加密。",
    principle:
      "ZIP 由「本地文件头（PK\\x03\\x04）+ 数据」若干段，加末尾的「中央目录（PK\\x01\\x02）」组成。中央目录记录每个文件的名字、压缩方法、大小和标志位。工具解析这两处列出文件清单，加密标志看通用位标记 bit0。",
    usage: "粘 ZIP 数据，输出内含文件名、压缩方式、加密标志（只读结构，不解密加密项）。",
    examples: [
      { in: "ZIP 文件字节", out: "flag.txt (deflate, 加密), readme.md (stored)" },
    ],
    tips: ["伪加密题：中央目录和本地头的加密标志位不一致，把加密位清零就能正常解压。看清哪些项真加密。"],
    aka: ["zip解析", "zip list", "zip结构", "zip文件列表"],
  },

  tarList: {
    what: "TAR 头解析：读 tar 归档的 512 字节块头，列出里面的文件名、大小、类型。tar 不压缩，纯打包。",
    principle:
      "tar 把每个文件对齐成 512 字节块：先一个头块（含文件名、八进制的大小/权限、类型标志、`ustar` 魔数在偏移 257），后跟内容块。工具逐块读头，列出文件清单。",
    usage: "粘 tar 数据，输出文件名 / 大小 / 类型列表。",
    examples: [
      { in: "tar 字节", out: "./secret.txt (1024 B, 普通文件)" },
    ],
    tips: ["tar 常和 gzip 套一起成 .tar.gz：先 gzipCodec 解压再 tarList 看内容。ustar 魔数在第 257 字节。"],
    aka: ["tar解析", "tar list", "tar头", "ustar"],
  },

  b64CompressedProbe: {
    what: "Base64 内嵌压缩流探测：扫文本里的 base64 段，自动解码 → 认 magic → 试着 gzip/zlib/deflate 解压，一条龙挖出藏在 base64 里的压缩数据。",
    principle:
      "很多题把「压缩后的数据」再 base64 一层贴进文本。工具先正则找 base64 片段，解码成字节，用 magic 判断是不是压缩流，是就依次试 gzip/zlib/raw deflate 解压，直到出可读内容。",
    usage: "粘含 base64 的文本，工具自动解码 + 识别 + 尝试解压，输出还原结果。",
    examples: [
      { in: "data = 'H4sIA...'（base64）", out: "解码后是 gzip → 解压得原文", desc: "H4sIA 是 gzip 头的 base64 特征" },
    ],
    tips: ["记特征：base64 以 `H4sI` 开头 → 底层是 gzip；`eJ`/`eNq` 开头 → 常是 zlib。看到这些前缀直接按压缩流解。"],
    aka: ["base64压缩探测", "b64 compressed probe", "内嵌压缩", "base64解压", "base64内嵌压缩", "H4sI探测", "base64 gzip", "base64 zlib", "压缩流探测", "b64解码解压", "base64嵌套压缩", "自动解压探测"],
  },
};
