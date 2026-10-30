/*
 * edu-p0-20261025.js — v0.1.12 P0 批科普卡（9 个新 op + 2 个进制 op 覆盖）。
 *
 * 覆盖：chacha20Poly1305 / poly1305 / ghash / aeadNonceReuse /
 *       pqcBlobParse / ntruPack / ntruUnpack / zipEntries / zipExtract，
 *       并覆盖 decimalToFloat / floatToDecimal 的新 2-36 BigInt 行为。
 * 纯数据、无 import、无副作用；契约见 eduContent.js 头注释。
 */
export default {
  chacha20Poly1305: {
    what: "RFC 8439 的 AEAD（带关联数据的认证加密）：ChaCha20 负责加密，Poly1305 负责认证。TLS 1.3、WireGuard、QUIC 都在用；同一 key+nonce 下不能加密两条消息。",
    principle:
      "ChaCha20 把 32B key、12B nonce、32 位块计数器排成状态矩阵，跑 20 轮后得到 64B 密钥流块；块计数器从 1 开始，$C = P \\oplus KS$。\n\n" +
      "认证密钥 $otk$ 取块计数器 0 的前 32B，Poly1305 对 `AAD ‖ pad16(AAD) ‖ C ‖ pad16(C) ‖ le64(|AAD|) ‖ le64(|C|)` 计算 16B tag。解密必须先验证 tag，失败就不能返回明文。",
    usage:
      "加密：填 `key`（32B hex）、`nonce`（12B hex）、`aad`（hex，可空），`inputMode` 选文本/hex，输出 `密文‖16B tag` 的 hex。\n\n" +
      "解密：主输入粘 `密文‖tag`，或在 `tag` 参数单独填 16B tag；tag 不符立即报错。",
    examples: [
      { in: "hello", param: "key=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f, nonce=000102030405060708090a0b, aad=空, inputMode=text", out: "e19e646c46f5939695c670586d63a69f58c41396dd", desc: "10B 密文 + 16B tag；改任意一位再解密会报认证失败" },
      { in: "e19e646c46f5939695c670586d63a69f58c41396dd", param: "key/nonce 同上, aad=空", out: "hello", desc: "反向解密" },
    ],
    tips: [
      "密文长度 = 明文长度，另加 16B tag；没有分组填充。",
      "nonce 是 12B，不是老 ChaCha20 的 8B；同一 key+nonce 复用会同时泄露密钥流和 Poly1305 一次性密钥。",
      "tag 校验失败就是失败，不要尝试“忽略 tag 解出明文”。",
      "看到 16B 尾部 tag + 12B nonce，可优先怀疑 ChaCha20-Poly1305。",
    ],
    aka: ["ChaCha20-Poly1305", "AEAD_CHACHA20_POLY1305", "chacha20poly1305", "chacha20-poly1305",
      "RFC 8439 ChaCha20-Poly1305", "IETF ChaCha20-Poly1305", "ChaCha20-Poly1305 AEAD", "ChaCha20 认证加密",
      "ChaCha20-Poly1305 认证加密", "TLS ChaCha20-Poly1305", "TLS_CHACHA20_POLY1305_SHA256", "chacha20_poly1305",
      "ChaCha20-Poly1305 加解密"],
  },

  poly1305: {
    what: "Poly1305 是 Bernstein 设计的一次性消息认证码，输出 16B tag；它只做认证，不加密。在 ChaCha20-Poly1305 里负责给密文加“防篡改封条”。",
    principle:
      "32B 一次性密钥拆成 r（前 16B，先 clamp）和 s（后 16B）。消息按 16B 分块、每块补 1 位当小端整数，在素数 $p = 2^{130}-5$ 上迭代 $acc \\leftarrow ((acc + m_i) \\cdot r) \\bmod p$，最后 $tag = (acc + s) \\bmod 2^{128}$。",
    usage: "填 `key`（32B hex），主输入消息，`inputMode` 选文本/hex，输出 16B tag 的 hex。只做 MAC，没有反向解密。",
    examples: [
      { in: "Cryptographic Forum Research Group", param: "key=85d6be7857556d337f4452fe42d506a80103808afb0db2fd4abff6af4149f51b, inputMode=text", out: "a8061dc1305136c6c22b8baf0c0127a9", desc: "RFC 8439 §2.5.2 官方向量" },
      { in: "", param: "key 同上", out: "0103808afb0db2fd4abff6af4149f51b", desc: "空消息的 tag 等于 s" },
    ],
    tips: [
      "16B tag 是固定输出，不是 32B 哈希。",
      "一次性密钥只能用于一条消息；复用会破坏安全性。",
      "AEAD 里的 Poly1305 key 不是用户 key，而是 ChaCha20 块 0 的前 32B。",
      "空消息也有合法 tag（等于 s），不是错误。",
    ],
    aka: ["Poly1305", "Poly1305 MAC", "Poly1305 消息认证码", "poly1305 mac", "RFC 8439 Poly1305",
      "Poly1305 一次性认证码", "Poly1305 one-time MAC", "Bernstein Poly1305", "poly1305 tag",
      "Poly1305 认证标签", "Poly1305 密钥", "Poly1305 计算器"],
  },

  ghash: {
    what: "GHASH 是 GCM 内部的认证哈希：在 GF(2^128) 上用 H 对 AAD 和密文做多项式求值。它本身不是完整 GCM tag，但理解它才能理解 GCM 认证和 nonce 重用问题。",
    principle:
      "GCM 先算 $H = E_K(0^{128})$，把 AAD/密文补零到 16B 倍数，逐块做 $Y_i = (Y_{i-1} \\oplus X_i) \\cdot H$（GF(2^128) 乘法），再吸收长度块。最终 tag 还要异或 $E_K(J_0)$；本 op 只算 GHASH 本身。",
    usage: "填 `H`（16B hex）、`aad`（hex，可空），主输入密文（hex），输出 16B GHASH。要得到 GCM tag 还需自己异或 $E_K(J_0)$。",
    examples: [
      { in: "0388dace60b6a392f328c2b971b2fe78", param: "H=66e94bd4ef8a2c3b884cfa59ca342b2e, aad=空", out: "f38cbb1ad69223dcc3457ae5b6b0f885", desc: "NIST GCM Test Case 2" },
      { in: "42831ec2217774244b7221b784d0d49ce3aa212f2c02a4e035c17e2329aca12e21d514b25466931c7d8f6a5aac84aa051ba30b396a0aac973d58e091", param: "H=b83b533708bf535d0aa6e52980d53b78, aad=feedfacedeadbeeffeedfacedeadbeefabaddad2", out: "698e57f70e6ecc7fd9463b7260a9ae5f", desc: "NIST GCM Test Case 4" },
    ],
    tips: [
      "H 不是用户 key，而是 AES 对全零块的加密结果。",
      "GCM tag ≠ GHASH：还要异或 $E_K(J_0)$。",
      "AAD/密文按 16B 补零；长度块是比特长度。",
      "本 op 不实现 GCM forbidden attack，别把 GHASH 当伪造 tag 的攻击工具。",
    ],
    aka: ["GHASH", "GHASH 函数", "GCM GHASH", "Galois hash", "Galois 哈希", "GHASH H",
      "GHASH 认证", "NIST SP 800-38D GHASH", "GHASH 计算", "GCM 认证哈希", "GF(2^128) 乘法", "GHASH 认证块"],
  },

  aeadNonceReuse: {
    what: "演示 ChaCha20-Poly1305 在同一 key+nonce 下加密两条消息的后果：两条密文共用密钥流和 Poly1305 一次性密钥；已知一侧明文即可恢复另一侧。",
    principle:
      "同 key+nonce 时 $C_1 = P_1 \\oplus KS$、$C_2 = P_2 \\oplus KS$，所以 $C_1 \\oplus C_2 = P_1 \\oplus P_2$。已知 $P_1$ 就能恢复 $KS = C_1 \\oplus P_1$，再算 $P_2 = C_2 \\oplus KS$。tag 都会通过，因为认证不能阻止跨密文恢复。",
    usage: "主输入粘两组密文 hex（换行/竖线/逗号分隔，默认末尾含 16B tag）；填共用的 `key`/`nonce`/`aad`；`knownMode` 选已知明文形式，`known` 填 ct1 对应的明文。输出恢复的密钥流、P2、tag 验证结论。",
    examples: [
      { in: "e88f7c614a7c8521c3a35b92ef73af52a0bc4333b0f2169aa931fc88514e\nfb9e7c724c76d160d9ec48d2b9339a7cbaca5de56e7bc7805eac3137fc", param: "key=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f, nonce=000102030405060708090a0b, aad=空, known=attack at dawn", out: "retreat now!!", desc: "恢复 P2；两条 tag 均通过" },
    ],
    tips: [
      "这不是破解 ChaCha20，而是 nonce 管理错误导致密钥流复用。",
      "两条密文长度可以不同；短的一侧只能恢复对应前缀。",
      "有 tag 时先验证两条 tag，确保样本来自同一 key+nonce。",
      "本 op 明确不实现 GCM forbidden attack。",
    ],
    aka: ["AEAD nonce 重用", "nonce reuse attack", "ChaCha20-Poly1305 nonce reuse", "ChaCha20 nonce 重用",
      "流密码 nonce 重用", "known-plaintext keystream recovery", "已知明文恢复密钥流", "ChaCha20 密钥流重用",
      "AEAD 密钥流重用", "nonce 重用已知明文攻击", "Poly1305 一次性密钥重用", "keystream reuse"],
  },

  pqcBlobParse: {
    what: "拿到一段来路不明的后量子密码 blob（公钥/私钥/KEM 密文/签名），先判断可能是哪个标准、哪个参数集、哪类对象、长度对不对。它不验签、不解密，只做格式/长度/OID 分类。",
    principle:
      "ML-KEM（FIPS 203）、ML-DSA（FIPS 204）、SLH-DSA（FIPS 205）的长度都是固定的；PEM 的 SPKI/PKCS#8 里能解析到已核对 OID 才能叫标准封装。裸 hex 只能按长度匹配，必须报歧义（例如 ML-KEM-1024 的 ek/ct 都是 1568B）。",
    usage: "主输入 PEM / DER hex / raw hex；`format` 选自动/PEM/DER/raw/base64，`kind` 筛对象，`scheme` 筛算法。输出来源、OID、参数集、期望/实际长度、歧义候选与限定。",
    examples: [
      { in: "1568 字节全零 raw hex", param: "format=raw, kind=auto", out: "候选：ML-KEM-1024 公钥 / ML-KEM-1024 KEM 密文（长度歧义）", desc: "没有 OID 时只报长度匹配，不硬猜" },
      { in: "SPKI PEM, OID=2.16.840.1.101.3.4.4.2, BIT STRING 1184B", param: "format=auto", out: "ML-KEM-768 公钥，长度 1184/1184 ✓", desc: "有 OID 才能唯一识别" },
    ],
    tips: [
      "ML-KEM-1024 的 ek/ct 都是 1568B，裸长度不能唯一确定类型。",
      "SLH-DSA 的 pk 只有 32/48/64B，sk 64/96/128B；同一长度跨 SHA2/SHAKE 多档。",
      "PKCS#8 可能是 seed 形态（ML-DSA 32B、ML-KEM 64B），比 expanded 私钥短。",
      "证书（CERTIFICATE）本 op 不解析；先提取 SPKI 再粘。",
      "没有 OID 时只能叫“候选”，不能叫“识别”。",
    ],
    aka: ["PQC blob 解析", "post-quantum blob parser", "ML-KEM 长度识别", "ML-DSA 长度识别",
      "SLH-DSA 长度识别", "PQC 公钥长度", "PQC 私钥长度", "PQC 签名长度", "Kyber blob", "Dilithium blob",
      "SPHINCS+ blob", "PQC OID 识别", "FIPS 203 长度", "FIPS 204 长度", "FIPS 205 长度"],
  },

  ntruPack: {
    what: "把 NTRU 的一维系数数组按固定位宽打成 hex：q 系数 11 bit，三元系数 2 bit。它是“系数 ↔ 字节”的序列化工具，不是加密/密钥生成。",
    principle:
      "EESS #1 四套参数 N∈{401,439,659}、q=2048、p=3。q 系数每项 11 bit；三元 0→00、1→01、-1→10（11 非法）；大端位流，尾部补 0；可选 1B 参数集 tag。",
    usage: "选参数集与系数域；主输入 N 个整数（空白/逗号分隔）；`tag` 打开时输出前缀 1B 参数集 tag；输出小写 hex，可直接粘到 `ntruUnpack`。",
    examples: [
      { in: "0 1 2047 2 3 1024 2047 0（其余补 0）", param: "set=ees401ep2, field=q, tag=false", out: "552B，hex 前缀 000007ff802007003ff8…", desc: "q 系数 11 bit；尾部补 0" },
      { in: "0 1 -1 0 1 -1 0 1（其余补 0）", param: "set=ees401ep2, field=ternary, tag=false", out: "101B，hex 前缀 1861…", desc: "三元 -1 编码为 10" },
    ],
    tips: [
      "11 bit 不是 16 bit；q=2048 正好占满 11 bit。",
      "三元 -1 是 10，不是补码 11；11 会被解包拒绝。",
      "位流是大端口径，与现有真参数 NTRU op 一致，不声称是 EESS 官方线格式。",
      "tag 只是本工具的参数集标识，不是 ASN.1/OID。",
    ],
    aka: ["NTRU 系数打包", "NTRU coefficient packing", "NTRU bit-pack", "NTRU pack", "EESS 系数编码",
      "NTRU 11 bit 系数", "NTRU 2 bit 三元系数", "NTRU 私钥打包", "NTRU 公钥打包", "NTRU 系数序列化",
      "EESS1 参数", "NTRU 多项式打包"],
  },

  ntruUnpack: {
    what: "`ntruPack` 的逆操作：按参数集与系数域把 hex 还原成 N 个系数，并严格检查长度、参数集 tag、尾部填充位和非法三元编码。",
    principle: "按 11 bit/2 bit 位宽从大端位流取值；q 系数校验 0..2047，三元校验 00/01/10（11 非法）；尾部填充位必须为 0；tag 必须匹配参数集。",
    usage: "选参数集与系数域，`tag` 与打包时一致；主输入 hex；输出 N 个系数（空格分隔）。遇到截断/多余字节/非法三元/填充位非 0 直接报错。",
    examples: [
      { in: "000007ff802007003ff8…（552B）", param: "set=ees401ep2, field=q, tag=false", out: "0 1 2047 2 3 1024 2047 0 …", desc: "与 ntruPack 往返" },
      { in: "11…（三元含 11）", param: "set=ees401ep2, field=ternary", out: "非法三元编码 11", desc: "异常面" },
    ],
    tips: ["解包长度必须精确等于参数集期望字节数；多余字节会报错。", "tag 打开时先校验 1B 参数集标识。", "三元 11 是非法编码，不是 -1。", "只做系数反序列化，不做 CCA-2/SVES。"],
    aka: ["NTRU 系数解包", "NTRU coefficient unpacking", "NTRU bit-unpack", "NTRU unpack", "EESS 系数解码",
      "NTRU 11 bit 解包", "NTRU 三元系数解包", "NTRU 私钥解包", "NTRU 公钥解包", "NTRU 系数反序列化",
      "EESS1 参数解包", "NTRU 多项式解包"],
  },

  zipEntries: {
    what: "只读 ZIP 中央目录，逐条列出文件名、压缩法、压缩/原始大小、CRC32、加密标志、DOS 时间与本地头偏移，并标出路径穿越风险。",
    principle: "从尾部找 EOCD → 读中央目录 → 逐条解析 CDH；遇到拼接件（前缀字节 + ZIP）按“中央目录紧贴 EOCD 之前”反推偏移。只读，不解压。",
    usage: "选输入编码（auto/hex/base64/UTF-8），主输入粘 ZIP 字节；run 输出条目表。加密条目只标记，不解密。",
    examples: [
      { in: "UEsDBBQAAAAAAAAAIVyGphA2BQAAAAUAAAAJAAAAaGVsbG8udHh0aGVsbG9QSwECFAAUAAAAAAAAACFchqYQNgUAAAAFAAAACQAAAAAAAAAAAAAAgAEAAAAAaGVsbG8udHh0UEsFBgAAAAABAAEANwAAACwAAAAAAA==", param: "inputEnc=base64", out: "=== ZIP 条目列表 ===\n输入: 121 字节\n条目: 1（目录 0 / 文件 1）\n\n#\t名称\t压缩法\t压缩大小\t原始大小\tCRC32\t加密\t时间\t路径\n1\thello.txt\tStored(0)\t5\t5\t0x3610A686\t否\t2026-01-01 00:00:00\t正常", desc: "报告型输出；字段随 ZIP 变化" },
    ],
    tips: ["先看加密标志：ZipCrypto / AES / 伪加密 的处理方式不同。", "路径穿越名只标记，不会写磁盘。", "拼接件（EXE+ZIP）也能按 EOCD 反推偏移。", "本 op 只读目录，不解压；解压用 `zipExtract`。"],
    aka: ["ZIP 条目列表", "ZIP 目录", "ZIP central directory", "zip listing", "zip entries", "ZIP 文件列表",
      "压缩包条目", "ZIP 目录读取", "ZIP 条目", "zipinfo", "ZIP 中央目录", "压缩包列表"],
  },

  zipExtract: {
    what: "按条目名（留空=全部）真解压 ZIP 的 Stored/Deflate 条目，逐条校验原始大小与 CRC32，返回文本预览 + 内存下载产物。",
    principle: "解析 CDH/LFH，method 0 直取、method 8 用 raw inflate；每条校验长度与 CRC。ZipCrypto 复用 zipCrack 原语解密；伪加密先按明文试解；WinZip AES 明确报暂不支持。",
    usage: "选输入编码；`entry` 填条目名（多个用逗号/分号，`#N` 按序号，留空=全部）；`password` 仅 ZipCrypto。产物只在内存，点击下载保存。",
    examples: [
      { in: "UEsDBBQAAAAAAAAAIVyGphA2BQAAAAUAAAAJAAAAaGVsbG8udHh0aGVsbG9QSwECFAAUAAAAAAAAACFchqYQNgUAAAAFAAAACQAAAAAAAAAAAAAAgAEAAAAAaGVsbG8udHh0UEsFBgAAAAABAAEANwAAACwAAAAAAA==", param: "inputEnc=base64, entry=hello.txt", out: "=== ZIP 提取 ===\n输入: 121 字节，条目 1，选中 1\n选择: hello.txt\n密码: 未提供\n\n[1] hello.txt — ✓ Stored(0)，原始 5 字节，CRC32 0x3610A686 通过\n    文本: hello\n\n结果: 成功 1，失败 0，跳过 0；生成下载文件 1 个。", desc: "文件内容为 hello；报告型输出" },
    ],
    tips: ["AES 条目只报不支持，不伪造明文；先用 `zipBrute` 取口令或另找工具。", "伪加密 ZIP 会自动按明文试解并通过 CRC。", "路径穿越名压平为安全下载名，不写磁盘。", "条目名可用 `#N` 按列表序号选择。"],
    aka: ["ZIP 提取", "ZIP 解压条目", "zip extract", "unzip entry", "ZIP 单文件提取", "ZIP 解压导出",
      "压缩包提取", "ZIP 解密导出", "ZipCrypto 解密", "ZIP 伪加密提取", "unzip", "ZIP 内容提取"],
  },

  decimalToFloat: {
    what: "把十进制小数/分数精确转成 2–36 进制小数；余数重复时自动标循环节，用 BigInt 有理数，不再用双精度浮点冒充精确。",
    principle:
      "输入先解析成精确分数 $p/q$（支持 `1/3`、科学计数法、`0.(3)`），再按目标进制做长除法；余数重复即循环节，精度只限制最多输出位数。`base=0` 仍输出 2/8/10/16 四档报告。",
    usage: "`base` 填目标进制（0=四档，2–36），`precision` 填小数精度上限（1–2048）。输入可带正负号、分数、科学计数法、循环节。",
    examples: [
      { in: "10.5", param: "base=0, precision=8", out: "输入: 10.5\n精度: 8 位小数（上限 2048）\n精确分数: 21/2（BigInt 有理数，无浮点误差）\n2 进制: 1010.1\n8 进制: 12.4\n10 进制: 10.5\n16 进制: A.8", desc: "base=0 兼容旧四档" },
      { in: "1/3", param: "base=2, precision=16", out: "输入: 1/3\n精度: 16 位小数（上限 2048）\n精确分数: 1/3（BigInt 有理数，无浮点误差）\n2 进制: 0.(01)（循环节 01，从第 1 位小数开始，节长 2）", desc: "循环节检测" },
      { in: "0.1", param: "base=2, precision=8", out: "输入: 0.1\n精度: 8 位小数（上限 2048）\n精确分数: 1/10（BigInt 有理数，无浮点误差）\n2 进制: 0.0(0011)（循环节 0011，从第 2 位小数开始，节长 4）", desc: "0.1 二进制循环" },
    ],
    tips: ["`base=0` 保留旧 2/8/10/16 四档报告，老题解不受影响。", "循环节用 `0.(3)`/`0.1(6)` 标记，不是省略号。", "精度上限 2048；超过会截断并标注。", "37–95 小数不支持：可见 ASCII 表含 `. ( ) + -`，会与语法冲突；整数用 `radixN`。"],
    aka: ["进制浮点", "decimal to float", "小数进制转换", "任意进制小数", "小数转进制", "十进制小数转换",
      "进制小数", "二进制小数", "任意进制浮点", "小数点进制", "radix fraction", "分数进制转换", "循环小数", "BigInt 进制小数"],
  },

  floatToDecimal: {
    what: "2–36 进制小数/循环小数 → 十进制精确值与分数；支持正负号、匹配进制的 0b/0o/0d/0x 前缀、循环节 0.(3)。",
    principle: "按位权展开为精确有理数：整数部分 $v = v \\cdot base + d$，小数部分 $d \\cdot base^{-k}$；循环节按几何级数解析。输出十进制值与精确分数，循环/截断明确标注。",
    usage: "`base` 填输入进制（2–36），`precision` 填输出小数位数（0–2048）。输入可带前缀、负号、循环节。",
    examples: [
      { in: "0b101.1", param: "base=2, precision=8", out: "2 进制浮点: 0b101.1\n十进制: 5.5\n精度: 8 位小数（上限 2048）\n精确分数: 11/2（BigInt 有理数，无浮点误差）", desc: "4+0+1+0.5=5.5" },
      { in: "0.(3)", param: "base=10, precision=8", out: "10 进制浮点: 0.(3)\n十进制: 0.(3)（循环节 3，从第 1 位小数开始，节长 1）\n精度: 8 位小数（上限 2048）\n精确分数: 1/3（BigInt 有理数，无浮点误差）", desc: "循环小数还原" },
      { in: "0.1", param: "base=2, precision=8", out: "2 进制浮点: 0.1\n十进制: 0.5\n精度: 8 位小数（上限 2048）\n精确分数: 1/2（BigInt 有理数，无浮点误差）", desc: "二进制 0.1 = 1/2" },
    ],
    tips: ["前缀必须与所选进制匹配；base16 的 0BEEF 是合法十六进制，不会被误判成二进制前缀。", "循环小数会保留循环节并给精确分数，不再只给双精度近似。", "输出小数位数只是显示精度，精确分数始终保留。", "37–95 小数不支持，原因同 `decimalToFloat`。"],
    aka: ["浮点转十进制", "任意进制浮点", "二进制浮点转十进制", "base-n float", "float decoder", "非十进制浮点",
      "0b 浮点", "浮点还原", "float to decimal", "进制浮点转换", "十六进制浮点转十进制", "binary fraction",
      "浮点进制转换", "float2dec", "循环小数转十进制"],
  },
};
