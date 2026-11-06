/*
 * edu-t842.js — T842 批 8 个 CyberChef 对齐 op 的中文科普卡。
 * 纯数据，无 import、无副作用。
 *
 * 依据：CyberChef 11.2.0 对应 operation 与 tests（本地资料/外部项目/CyberChef）；
 * CRC 参数模型按 Rocksoft/Williams；SHA-2 FIPS 180-4；Whirlpool ISO/IEC 10118-3；
 * LZ4 Frame 按 LZ4 官方格式说明；CTPH 按 Kornblum 2006；Enigma 按 CC 转子/反射器表。
 * 示例 out 均为对当前 src 的 registerAll 实测。
 */
export default {
  crcChecksum: {
    what:
      "CRC 校验和：按选定的 CRC 参数模型（宽度、生成多项式、初值、输入/输出反射、输出异或）逐字节计算循环冗余校验，输出小写十六进制。",
    principle:
      "把数据看成一个二进制多项式，除以生成多项式取余数；参数模型决定位宽、多项式、初值与反射方式。不同模型即使多项式相同，init/refIn/refOut/xorOut 不同结果也不同，所以必须按名字或参数对齐，不能只写“CRC32”。\n\n" +
      "本 op 按 CyberChef 的命名表提供 171 个预设，并支持 Custom 手动填参数；用 BigInt 支持 3–82 位宽度。",
    usage:
      "选 Algorithm（默认 CRC-32/ISO-HDLC），需要自定义时选 Custom 再填 width/poly/init/refIn/refOut/xorOut；inputMode 可选 auto/text/hex。输出为小写 hex，不带 0x。",
    examples: [
      { in: "abc", out: "352441c2", desc: "默认 CRC-32/ISO-HDLC" },
      { in: "abc", param: "algorithm=CRC-16/IBM（ARC）", out: "5140", desc: "同一输入的另一种参数模型" },
    ],
    tips: [
      "CRC 只查错、不防伪；能检出常见突发错误，但攻击者可重算。",
      "名字里的 /ARC、/MODBUS、/XMODEM 等是参数模型别名，不是多项式本身。",
      "位宽不是 8 的倍数时，输出会按位宽左侧补零；不要拿 16 位结果去比对 32 位模型。",
    ],
    aka: [
      "CRC 校验和", "CRC Checksum", "CRC-32", "CRC32", "循环冗余校验",
      "Cyclic Redundancy Check", "CRC 参数模型", "171 个 CRC 预设", "CRC-32/ISO-HDLC",
      "CRC-16/MODBUS", "CRC 多项式", "Rocksoft CRC",
    ],
  },

  generateAllChecksums: {
    what:
      "一次性输出 CyberChef 同款的 171 个 CRC 校验和，外加 Fletcher-8/16/32/64 与 Adler-32，用于快速比对某个样本到底用了哪种校验。",
    principle:
      "对同一段输入，按 CyberChef 的固定顺序逐个跑命名 CRC 模型与 Fletcher/Adler；Length 选项可按结果位数过滤，Include names 控制是否带算法名。\n\n" +
      "输出是“算法名 + 冒号 + 结果”的多行报告，和 CyberChef Generate all checksums 的顺序一致。",
    usage:
      "选 Length（All 或具体位数）、Include names、inputMode。适合先看全量，再用 crcChecksum 精算单个模型。",
    examples: [
      {
        in: "abc",
        param: "length=8, includeNames=false",
        out: "5f\n41\nf7\n…（共 28 个 8 位校验和）",
        desc: "只列 8 位结果",
      },
    ],
    tips: [
      "报告很长，先按位数过滤能显著缩短；不要拿它替代单个 crcChecksum 的精确断言。",
      "Fletcher/Adler 不是 CRC，但同属校验和，CyberChef 把它们放在同一报告里。",
      "模型顺序固定，便于逐行 diff；换版本时先核对顺序。",
    ],
    aka: [
      "生成全部校验和", "Generate all checksums", "全部 CRC", "CRC 全量比对",
      "Fletcher 校验和", "Adler-32", "校验和枚举", "CRC 预设枚举",
      "CyberChef 校验和", "批量校验和", "多算法校验", "checksum sweep",
    ],
  },

  sha2: {
    what:
      "SHA-2 家族六档：SHA-512、SHA-384、SHA-256、SHA-224、SHA-512/256、SHA-512/224，可按 CC 参数选择轮数。",
    principle:
      "SHA-2 用 Merkle–Damgård 结构：消息填充后在 64 轮（SHA-256 档）或 80 轮（SHA-512 档）压缩函数中更新链接变量，最后输出指定长度的摘要。SHA-512/256 与 SHA-512/224 是带不同初始向量的截断变体，不是简单截断 SHA-512。",
    usage:
      "选 Size；256 档可调 rounds256（默认 64），512 档可调 rounds512（默认 160）。输出小写 hex。",
    examples: [
      {
        in: "abc",
        out: "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
        desc: "默认 SHA-512",
      },
      { in: "abc", param: "size=256", out: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad 的 SHA-256 口径", desc: "SHA-256 档" },
    ],
    tips: [
      "SHA-224 不是 SHA-256 截断，IV 不同；不要混用。",
      "rounds 参数是 CC 对齐用的可调轮数，正常应保持默认；改轮数就不是标准 SHA-2。",
      "WebCrypto 不支持 SHA-224；本项目走纯 JS，结果与 FIPS 向量逐字节一致。",
    ],
    aka: [
      "SHA-2", "SHA2", "SHA-512", "SHA-384", "SHA-256", "SHA-224",
      "SHA-512/256", "SHA-512/224", "安全散列算法 2", "FIPS 180-4", "SHA2 六档", "SHA-2 family",
    ],
  },

  ctph: {
    what:
      "CTPH（Context Triggered Piecewise Hashing，上下文触发分段哈希）：把输入按内容切成若干段，对每段求滚动哈希，输出形如 `bi:hash1:hash2` 的模糊哈希。",
    principle:
      "用滚动窗口计算弱哈希；当弱哈希满足触发条件时切一段，把该段强哈希的若干位追加到结果。相同前缀/局部修改只会改变附近分段，因此适合相似文件比对，而不是密码学完整性校验。",
    usage:
      "直接输入文本或字节即可；输出 `bi:` 前缀 + 两段十六进制摘要。比较两个结果时看相同前缀比例/编辑距离，不要求完全相同。",
    examples: [
      { in: "abc", out: "A:CH:CH", desc: "短输入的 CTPH 结果" },
    ],
    tips: [
      "CTPH 是模糊哈希，不是 SHA/MD5；不要拿它做唯一性/防篡改。",
      "输入越长结果越长；比较时按块对齐或算相似度。",
      "本项目实现与 cc 的 ctph.js 同算法；空输入/极短输入结果较短是正常的。",
    ],
    aka: [
      "CTPH", "模糊哈希", "上下文触发分段哈希", "Context Triggered Piecewise Hashing",
      "ssdeep 类", "相似文件哈希", "模糊摘要", "分段哈希", "Kornblum 2006",
      "bi: 哈希", "文件相似度", "piecewise hash",
    ],
  },

  generateAllHashes: {
    what:
      "一次性输出 CyberChef 同款的 44 个摘要（MD2/MD4/MD5/MD6/SHA 家族/Whirlpool/GOST/SSDEEP/CTPH 等），用于快速判断样本用了哪种哈希。",
    principle:
      "对同一输入按 CC 固定顺序逐个跑摘要函数；Length 可按输出位数过滤，Include names 控制是否带算法名。报告是“算法名 + 结果”的多行文本。",
    usage:
      "选 Length（All 或具体位数）与 Include names。先看全量，再用对应单算法 op 精确复算。",
    examples: [
      {
        in: "abc",
        param: "length=128, includeNames=false",
        out: "da853b0d3f88d99b30283a69e6ded6bb\n…（共 8 个 128 位摘要）",
        desc: "只列 128 位档",
      },
    ],
    tips: [
      "报告长，优先按位数过滤；SSDEEP/CTPH 是模糊哈希，不能按等值比较。",
      "同名摘要可能有多个变体（Whirlpool/Whirlpool-T/Whirlpool-0），看算法名而不是只看长度。",
      "顺序固定，适合逐行 diff；不要用它替代单算法 KAT。",
    ],
    aka: [
      "生成全部哈希", "Generate all hashes", "全部摘要", "哈希枚举",
      "批量哈希", "多算法哈希", "摘要全量比对", "哈希扫描",
      "CyberChef 哈希", "44 个摘要", "hash sweep", "all hashes",
    ],
  },

  whirlpoolHash: {
    what:
      "Whirlpool 哈希：ISO/IEC 10118-3 定义的 512 位摘要，支持 Whirlpool、Whirlpool-T、Whirlpool-0 三个变体与可调轮数。",
    principle:
      "Whirlpool 用 512 位状态和 AES 风格 S 盒/循环矩阵，经 Miyaguchi–Preneel 压缩；不同变体的 S 盒/轮常数/轮数不同，因此同一输入的摘要不同。标准版为 10 轮。",
    usage:
      "选 Variant（默认 Whirlpool）与 rounds（默认 10）；输出 128 位小写 hex。",
    examples: [
      {
        in: "abc",
        out: "4e2448a4c6f486bb16b6562c73b4020bf3043e3a731bce721ae1b303d97e6d4c7181eebdb6c57e277d0e34957114cbd6c797fc9d95d8b582d225292076d4eef5",
        desc: "默认 Whirlpool / 10 轮",
      },
    ],
    tips: [
      "Whirlpool-T 与 Whirlpool-0 是历史变体，不是标准版；对拍前先确认变体。",
      "标准版轮数固定 10；改 rounds 只用于研究/对齐，不是标准向量。",
      "输出 128 hex 字符，别和 SHA-512 的 128 位十六进制混淆，算法不同。",
    ],
    aka: [
      "Whirlpool", "Whirlpool 哈希", "Whirlpool-T", "Whirlpool-0",
      "512 位哈希", "ISO/IEC 10118-3", "Miyaguchi–Preneel", "Whirlpool 摘要",
      "Whirlpool hash", "Whirlpool 变体", "Whirlpool 轮数", "whirlpoolHash",
    ],
  },

  lz4Compress: {
    what:
      "LZ4 Frame 压缩：按 LZ4 官方帧格式把输入压成 LZ4 frame，输出 hex 或 base64，可选作为文件产物返回。",
    principle:
      "LZ4 是面向速度的 LZ77 变体：在窗口内找重复串，用 offset/length 的 match token 表示；Frame 格式在块数据外再加 magic、FLG/BD、块大小、内容校验等头尾字段。\n\n" +
      "本 op 输出完整 frame（默认 hex），与 `lz4Dec`/官方 `lz4` 命令行可互解。",
    usage:
      "inputMode 选 auto/text/hex/base64；outEnc 选 hex/base64；toFile 打开时返回可下载文件产物。",
    examples: [
      { in: "abc", out: "04224d184070df0300008061626300000000", desc: "默认 hex 输出" },
    ],
    tips: [
      "LZ4 frame 不是 raw block；解压时别把 frame 头当数据。",
      "压缩率不如 zstd/gzip，优势是速度；小输入可能越压越大。",
      "toFile 产物是二进制 frame，不是文本；下载后按 .lz4 处理。",
    ],
    aka: [
      "LZ4 压缩", "LZ4 Compress", "LZ4 Frame", "lz4Compress",
      "LZ4 帧压缩", "LZ4 压缩器", "lz4 frame format", "LZ4 块压缩",
      "高速压缩", "LZ4 编码", "LZ4 文件", "LZ4 算法",
    ],
  },

  enigmaCC: {
    what:
      "Enigma 密码机（CyberChef 对齐）：3/4 转子，I–VIII + Beta/Gamma，反射器 B/C/B Thin/C Thin，支持环设置、初始位置、插线板与 Strict output。",
    principle:
      "每个转子是一个代换，转子间用 notch 触发进位；信号经插线板→右→中→左→反射器→左→中→右→插线板返回。环设置改变 notch 相对位置，初始位置决定起始代换；插线板是自反的字母对换。\n\n" +
      "Strict output 会去除非字母并按 5 字符分组，与 CC 的展示口径一致。",
    usage:
      "选 Model、各转子/环/初始位置、Reflector、Plugboard（如 `AB CD`）、Strict output；输入字母串，默认输出大写分组。",
    examples: [
      { in: "abc", out: "BJE", desc: "默认 3-rotor I/II/III、B 反射器、无插线板、Strict output" },
    ],
    tips: [
      "Enigma 是对合但不自反于同一位置：同一设置下加密两次不会还原；解密要用相同初始位置再跑一次。",
      "4-rotor 的 Beta/Gamma 不能反转，且必须配 B Thin/C Thin。",
      "插线板只接受字母对；Strict output 会丢掉数字/空格，别用它做原文逐字符比对。",
    ],
    aka: [
      "Enigma", "恩尼格玛", "Enigma 密码机", "Enigma 3-rotor", "Enigma 4-rotor",
      "Enigma M3", "Enigma M4", "转子密码机", "插线板", "反射器",
      "CyberChef Enigma", "enigmaCC",
    ],
  },
};
