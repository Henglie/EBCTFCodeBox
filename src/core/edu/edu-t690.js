/*
 * edu_t690_zh.js — T690 五 op 科普卡候选（中文）。
 *
 * 候选文件，未接线：M 归并到 edu 分片聚合时按现有契约合入。
 * EduEntry 契约见 eduContent.js 头注释；aka 经 eduAliases() 注入搜索别名索引。
 * 示例 out 值全部来自本项目三文件实跑（verify_t690.mjs 177/0），未编造。
 */
export default {
  // ============ 素数域 ECDH ============
  ecdhP: {
    what: "ECDH 椭圆曲线迪菲-赫尔曼密钥交换（素数域曲线版）——通信双方各持一对公私钥，交换公钥后各自算出同一个共享密钥。窃听者只看得到两个公钥，在椭圆曲线离散对数难题下推不出共享密钥。本工具覆盖 secp256k1 / P-256 / P-384 / P-521 四条短魏尔斯特拉斯曲线；X25519/X448（Montgomery 形式）见各自独立 op。",
    principle:
      "**算法流程（SEC 1 v2.0 §3.3.1 / ANSI X9.63）**：私钥是 $[1, n-1]$ 里的随机整数 $d$，公钥是曲线上的点 $Q = d \\cdot G$（$G$ 为生成元，$n$ 为群的阶）。A 方计算 $S_A = d_A \\cdot Q_B$，B 方计算 $S_B = d_B \\cdot Q_A$，由结合律 $d_A(d_B G) = d_B(d_A G)$，两者是同一个点。\n\n" +
      "**共享密钥 = 共享点的 x 坐标**，按域素数 $p$ 的字节长度定宽大端输出（RFC 5903 §5 口径：「The Diffie-Hellman shared secret value is girx」）。实际协议里还会把 x 坐标过一次 KDF（如 HKDF）再用；CTF 里常见的「ECDH 得到 key」直接用 x 坐标的情况更多。\n\n" +
      "**点乘实现**：本工具用 Jacobian 射影坐标做倍点/点加（避免每步模逆），最后一次性仿射化。曲线域参数与 ECDSA op 同源（SEC 2 v2.0 / FIPS 186-4 D.1.2），不是两份常量。\n\n" +
      "**为什么安全**：已知 $Q$ 和 $G$ 求 $d$ 是椭圆曲线离散对数问题（ECDLP）。P-256 级别的曲线目前没有已知实用攻击；secp256k1 因比特币而普及。务必用标准曲线——自造曲线的参数可能藏着后门（无效曲线攻击、小子群攻击正是利用非标准输入）。",
    usage:
      "单侧模式：填我方私钥 $d$（十进制或 0x hex）+ 对方公钥点 $Q$（04‖X‖Y 压缩/非压缩均认，与 eccCalc 同格式），直接出共享密钥。\n\n" +
      "双侧互验模式：再填对方私钥，工具会用两边视角各算一遍并核对 $d_A \\cdot Q_B = d_B \\cdot Q_A$，适合做题时验证参数是否配对。\n\n" +
      "私钥可以从「ECDSA 密钥生成」档产出后复制过来；公钥格式不懂就填完整的 04 开头非压缩 hex，工具会校验点是否真的在曲线上。",
    examples: [
      { in: "RFC 5903 §8.1 官方向量（P-256）：i = 0xC88F01F5…1433，对方公钥 = 04‖D12DFB52…BF63‖56FBF3CA…72AB", out: "共享密钥 = D6840F6B42F6EDAFD13116E0E12565202FEF8E9ECE7DCE03812464D04B9442DE", desc: "IETF IKE ECP 组 19 官方向量，逐字节一致" },
      { in: "私钥 12345，对方公钥 04‖…（secp256k1 上任一点）", out: "共享密钥 = （64 hex 字符）", desc: "十进制私钥直接认；输出恒为 32 字节（域素数定宽）" },
      { in: "私钥超出 n 的值", out: "报错：私钥 d 须在 [1, n-1] 内", desc: "私钥域校验，不静默约简（约简会破坏与对端的一致性）" },
    ],
    formulas: [
      { tex: "Q = d \\cdot G,\\qquad S = d_A \\cdot Q_B = d_B \\cdot Q_A = d_A d_B \\cdot G", caption: "公钥生成与共享点；两侧结合律成立" },
      { tex: "K = x(S)\\;\\text{(定宽大端)}", caption: "共享密钥取共享点 x 坐标，宽度 = 域素数字节长" },
    ],
    tips: [
      "认题：题目给两对（或一对半）椭圆曲线公私钥、要求算「共享密钥/agreed key/session key」，就是 ECDH；给的是 32 字节 04 开头之外的裸串先试 X25519 op。",
      "CTF 常见变体：私钥极小（直接枚举）、公钥点不在曲线上（无效曲线攻击）、共享后没过 KDF 直接当 AES key——本工具都能直接算。",
      "secp256k1 与 P-256 的参数不能混填：曲线选择错了点校验会直接报「不在曲线上」，这是最快的排错信号。",
      "P-384/P-521 输出分别是 48/66 字节；做 AES 前记得过 KDF 或哈希，别直接把 66 字节当 32 字节 key。",
      "与 X25519 的区别：X25519 只传 32 字节 u 坐标（无 y、无 04 前缀），且会 clamp 私钥；素数域 ECDH 的公钥带完整点坐标。",
      "标准来源：SEC 1 v2.0（算法）、SEC 2 v2.0（secp256k1 参数）、FIPS 186-4 D.1.2（NIST 曲线）、RFC 5903（IKE 官方向量，本工具逐字节验证）。",
    ],
    aka: ["ECDH", "椭圆曲线密钥交换", "ECDH 共享密钥", "EC Diffie-Hellman", "椭圆曲线迪菲赫尔曼",
      "secp256k1 ECDH", "P-256 ECDH", "prime256v1 共享密钥", "ECDH key agreement", "曲线点乘共享",
      "ECDH shared secret", "elliptic curve Diffie-Hellman", "P-384 密钥交换", "P-521 密钥交换", "短魏尔斯特拉斯 ECDH"],
  },

  // ============ RSA-OAEP ============
  rsaOaepEnc: {
    what: "RSA-OAEP 加密——目前标准化的 RSA 加密填充方案（PKCS#1 v2.2，RFC 8017 §7.1）。相比老旧的 PKCS#1 v1.5 填充，OAEP 把明文与随机种子经两轮 MGF1 掩码搅乱，可证明在随机预言机模型下抗选择密文攻击（OAEP = Optimal Asymmetric Encryption Padding）。CTF 里「RSA 加密给 n,e,c」的现代题、OpenSSL 默认 `openssl pkeyutl -encrypt`、WebCrypto RSA-OAEP 全是这套。",
    principle:
      "**编码（EME-OAEP）**：把明文 M 编成长度 $k$（模数字节数）的 EM：\n\n" +
      "$EM = 0x00 \\| maskedSeed \\| maskedDB$，其中 $DB = lHash \\| PS \\| 0x01 \\| M$（$lHash$ 是空标签的哈希，PS 是全 0 填充，0x01 是分隔字节）。\n\n" +
      "两轮掩码：$maskedDB = DB \\oplus MGF1(seed)$，$maskedSeed = seed \\oplus MGF1(maskedDB)$。seed 是 $hLen$ 字节随机数。\n\n" +
      "**加密**：$C = EM^e \\bmod n$，输出定宽 $k$ 字节。\n\n" +
      "**明文上限**：$k - 2hLen - 2$ 字节（RSA-2048 + SHA-256 时是 190 字节），超限明确报错——这是 OAEP 的硬约束，不是工具限制。\n\n" +
      "**MGF1**：掩码生成函数，$T = Hash(seed\\|I2OSP(i,4))$ 逐块串联截断，哈希与 OAEP 本体同档（SHA-1/SHA-256）。OpenSSL、WebCrypto、Java 默认都是「OAEP 哈希 = MGF1 哈希」同源口径，本工具与之逐字节互通。",
    usage:
      "加密：输入明文文本；公钥给 PEM（PUBLIC KEY/SPKI 或 RSA PUBLIC KEY/PKCS#1）或十进制 n,e；哈希档 SHA-1（互操作老系统）或 SHA-256（现代默认）。\n\n" +
      "seed 参数留空则取系统随机（每条密文不同，这是正确行为）；给定 seed 时密文完全可复现，用来对拍 RFC/OpenSSL 结果。\n\n" +
      "输出密文是定宽 k 字节 hex，直接交给「RSA-OAEP 解密」或 node:crypto / OpenSSL 验证。\n\n" +
      "解密端：私钥给 PEM（PRIVATE KEY/PKCS#8 或 RSA PRIVATE KEY/PKCS#1）或十进制 n,e,d，哈希档必须与加密一致。",
    examples: [
      { in: "attack at dawn（RSA-2048 + SHA-256 + 固定 seed）", out: "密文（256 字节 hex）= ……", desc: "同 seed 重跑密文逐字节相同；node:crypto publicEncrypt(RSA_PKCS1_OAEP_PADDING) 同档互认" },
      { in: "中文明文·混合 123", out: "密文可被 node:crypto privateDecrypt 逐字节还原", desc: "UTF-8 字节流整体进 EM，无字符集变换" },
      { in: "（256 字节明文，RSA-2048）", out: "报错：明文超长 190 字节上限", desc: "k-2hLen-2 = 256-64-2 = 190，超限硬报错" },
    ],
    formulas: [
      { tex: "EM = 0x00 \\|\\| maskedSeed \\|\\| maskedDB,\\quad C = EM^e \\bmod n", caption: "EME-OAEP 编码 + RSAEP 原语" },
      { tex: "|M| \\le k - 2h_{Len} - 2", caption: "明文长度上限；RSA-2048/SHA-256 为 190 字节" },
    ],
    tips: [
      "认题：RSA 题里密文长度 ≈ n 字节且解出后开头不是 0x00 0x02（v1.5 特征）的，先试 OAEP；题目说「padding=oaep」「RSAES-OAEP」「sha256 padding」都是它。",
      "解密报「OAEP 解密失败」通常四种原因：哈希档选错（SHA-1↔SHA-256）、密钥不对、密文被截断/改动、根本不是 OAEP 填充（试 v1.5 op）。",
      "拿到 c、n、e、d 手工题：直接把 c 当「EM^e mod n 的结果」反解出 EM，检查 EM 首字节是不是 0x00、结构是不是 maskedSeed‖maskedDB——手工 OAEP 需要 MGF1，可用本工具解密档代算。",
      "同一条明文两次加密密文不同是 OAEP 的设计（随机 seed），不是 bug；要用同 seed 复现才一致。",
      "OAEP 与 PKCS#1 v1.5 的填充字节完全不同，互不兼容；解不开先确认填充方案，别调哈希档碰运气。",
      "标准来源：RFC 8017 §7.1（v2.2，2024 承接 RFC 3447）；Bellare & Rogaway 1994 原论文；本工具与 node:crypto（OpenSSL 3）逐字节四路对拍通过。",
    ],
    aka: ["RSA-OAEP 加密", "RSA OAEP", "OAEP 加密", "RSAES-OAEP", "RSA 公钥加密",
      "RSA-OAEP encrypt", "OAEP padding", "RSA 现代填充", "RSA 加密 sha256", "PKCS#1 v2.2 加密",
      "optimal asymmetric encryption padding", "RSA 加密（OAEP）", "RSA-OAEP-ENCRYPT", "MGF1 加密", "RSA 加密"],
  },

  rsaOaepDec: {
    what: "RSA-OAEP 解密——RSAES-OAEP 的解密方向（RFC 8017 §7.1.2）：私钥模幂还原 EM，再逆向 EME-OAEP 去掩码、验 lHash 与分隔字节，恢复明文。与「RSA-OAEP 加密」配套，也与 OpenSSL / WebCrypto / node:crypto 的同档互解。",
    principle:
      "**解密两步**：① RSADP 原语：$EM = C^d \\bmod n$，按 $k$ 字节定宽还原；② EME-OAEP 解码：拆出 maskedSeed 与 maskedDB，$seed = maskedSeed \\oplus MGF1(maskedDB)$，$DB = maskedDB \\oplus MGF1(seed)$，然后检查 $DB$ 开头是 $lHash$（空标签哈希）、中间全 0、直到出现 0x01 分隔字节，其后就是明文。\n\n" +
      "**错误统一文案**：lHash 不符、找不到 0x01、EM 首字节非 0 等所有失败都报同一句「OAEP 解密失败」，不区分具体原因——这是 RFC 8017 §7.1.2 与 Manger 2001 攻击的侧信道要求（区分错误类型会给攻击者逐字节 oracle）。本工具如实遵守：所有格式失败同一句话，你只能靠换参数排查。\n\n" +
      "**与签名解密的区别**：RSA-OAEP 解密走的是 $C^d$（私钥加密方向），与 RSA 签名验证的 $S^e$ 不同。拿到「私钥求明文」的题先看填充结构再选 op。",
    usage:
      "输入密文 hex（定宽 k 字节）；私钥给 PEM（PKCS#8/PKCS#1）或十进制 n,e,d；哈希档与加密端一致。\n\n" +
      "输出给明文的 hex 与 UTF-8 两种视图：二进制明文（如密钥字节、另一层密文）用 hex 行，可读文本直接看 UTF-8 行。\n\n" +
      "配合「RSA-OAEP 加密」可自往返验证；配合 node:crypto 可做四路互证（本工具验证脚本就是这么做的）。",
    examples: [
      { in: "（node:crypto publicEncrypt 的输出，SHA-256 档）", out: "明文（UTF-8）= attack at dawn", desc: "OpenSSL 互通解密" },
      { in: "（加密档密文，但哈希档选了 SHA-1）", out: "报错：OAEP 解密失败（统一文案）", desc: "哈希档不一致与密文被篡改报同一句错——按 RFC 8017 防侧信道设计" },
      { in: "（密文长度 254 字节，k=256）", out: "报错：密文长度须等于模数字节数 k = 256", desc: "长度校验先行，数值 ≥ n 也单独报错" },
    ],
    formulas: [
      { tex: "EM = C^d \\bmod n", caption: "RSADP 私钥原语，先于 OAEP 解码" },
      { tex: "M = DB[k - |M| :],\\quad DB = maskedDB \\oplus MGF1(seed)", caption: "去掩码后按 0x01 分隔字节定位明文" },
    ],
    tips: [
      "CTF「给 d 求 m」通用套路：$m = c^d \\bmod n$ 先算出来，看字节结构——0x00‖maskedSeed‖maskedDB 开头就是 OAEP，0x00‖0x02‖PS‖0x00 开头是 v1.5，裸数据就是 textbook RSA。",
      "解出 EM 后不想手工去掩码：把 EM 的完整 hex 交给本工具解密档不行（输入是密文不是 EM）——用 Python 的 OAEP 或对照 MGF1 手算；其实大多数 CTF 题给的 c 直接解就行。",
      "报「OAEP 解密失败」时的排查顺序：①哈希档换另一档再试 ②确认密文没被 hex 转码截断 ③确认私钥与加密公钥同对 ④换 PKCS#1 v1.5 op 试试。",
      "错误信息只有一句话是刻意的：能区分「填充错/密钥错」的实现在真实世界里是 Bleichenbacher/Manger 轮回攻击的起点。",
      "标准来源：RFC 8017 §7.1.2；Manger 2001（错误统一化的原因）；本工具与 OpenSSL 四路对拍 + 篡改/错档/错钥异常面全绿。",
    ],
    aka: ["RSA-OAEP 解密", "OAEP 解密", "RSA 解密", "RSAES-OAEP 解密", "RSA 私钥解密",
      "RSA-OAEP decrypt", "RSA d 求明文", "RSA c^d", "RSA 私钥还原", "RSA 解密 sha256",
      "RSA 私钥求明文", "RSA-OAEP-DECRYPT", "RSA ciphertext decrypt", "RSA 给 d 解密", "OAEP 去填充"],
  },

  // ============ HPKE ============
  hpkeSeal: {
    what: "HPKE 加密（Base 模式）——RFC 9180 混合公钥加密（Hybrid Public Key Encryption），2024 年 IETF 标准，TLS Encrypted Client Hello（ECH）、MLS 消息加密的底层原语。把「临时密钥对 + KEM 封装 + KDF 派生 + AEAD 加密」串成一条标准管线，一次调用完成公钥加密。本工具实现固定套件：DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + ChaCha20-Poly1305（RFC 9180 附录 A.2 官方向量套件）。",
    principle:
      "**三件套（§5）**：\n\n" +
      "① **KEM 封装**：发送方生成临时密钥对 $(skE, pkE)$，$dh = X25519(skE, pkR)$，经 LabeledExtract/Expand（\"eae_prk\" → \"shared_secret\"，域分隔串 `KEM`‖0x0020）得 $shared\\_secret$；enc = pkE 随密文一起发送。\n\n" +
      "② **KeySchedule**：以 $shared\\_secret$ 为 ikm、info 为上下文，经 psk_id_hash/info_hash 拼出 key_schedule_context（base 模式首字节 0x00），派生 key（32B）、base_nonce（12B）、exporter_secret。标签域分隔串是 `HPKE`‖kem_id‖kdf_id‖aead_id。\n\n" +
      "③ **AEAD 加密**：ChaCha20-Poly1305 以 key、base_nonce（seq=0）加密明文，密文后附 16 字节 tag。多包发送时 nonce 按 seq 递增（本工具单包口径，nonce 即 base_nonce）。\n\n" +
      "**Base 模式**：只有「加密到公钥」这一个认证面（收方能确认只有私钥持有者能解）；发送方认证要 PSK 模式或 Auth 模式，本工具未实现（见 edu 边界说明）。",
    usage:
      "加密：输入明文 + 收方 X25519 公钥（32B hex，可用「X25519 密钥生成」产出）；info/aad 可选（hex）。输出 enc（=pkE，32 字节）与密文 ct（明文+16B tag）。\n\n" +
      "skE 参数留空则随机生成；给定 32B hex 时输出与 RFC 9180 A.2 向量逐字节一致（对拍用）。\n\n" +
      "解密端：把 enc、ct、info、aad 原样交给「HPKE 解密」+ 收方私钥。任一参数不一致都会 tag 校验失败报错。",
    examples: [
      { in: "RFC 9180 A.2 向量：skEm/pkRm/info 全给定，pt = 42656175…（Beauty is truth…）", out: "ct = 1c5250d8034e…（57 字节）", desc: "enc=pkEm、key、base_nonce、ct 逐字节复现官方向量" },
      { in: "secret message（随机 skE）", out: "enc=…… ct=……", desc: "每次 enc 不同是设计行为；固定 skE 才可复现" },
      { in: "空明文", out: "报错：明文为空", desc: "空明文无意义，明确报错" },
    ],
    formulas: [
      { tex: "shared\\_secret = Expand(Extract(\\text{\"eae\\_prk\"}, dh), pk_E \\| pk_R)", caption: "KEM 封装核心；dh = X25519(skE, pkR)" },
      { tex: "ct = \\mathrm{ChaCha20\\text{-}Poly1305.Seal}(key, base\\_nonce, aad, pt)", caption: "AEAD 层；nonce = base_nonce（seq=0）" },
    ],
    tips: [
      "认题：CTF 里出现「hpke」「RFC 9180」「ECH」「Encrypted Client Hello」「MLS 加密」字样，或题目直接给 enc/ct 分开的两个 hex 串 + X25519 密钥对，就是 HPKE。",
      "enc 和 ct 必须配对：enc 换成别的合法公钥，tag 必挂——KEM 上下文绑定了 pkE‖pkR。",
      "info 是绑定「这条消息属于哪个协议会话」的上下文；题目若给了协议常量字符串当 info，转 hex 填进去。",
      "本套件是 A.2（ChaCha20-Poly1305）；若对不上官方 AES-128-GCM 套件（A.1）的向量，是套件不同而非实现错。",
      "与其他 op 的关系：底层就是 X25519（ECDH）+ HKDF + ChaCha20-Poly1305 三件已有能力的标准组合；手工复现可拆开逐步对拍。",
      "标准来源：RFC 9180（§4 KEM/§5.1 KeySchedule/§5.1.3 Seal/§7 套件表）；向量取 CFRG 官方 test-vectors.json（mode=0, kem_id=32, kdf_id=1, aead_id=3），本工具逐字节验证。",
    ],
    aka: ["HPKE", "HPKE 加密", "RFC 9180", "混合公钥加密", "hybrid public key encryption",
      "HPKE seal", "HPKE base mode", "ECH 加密", "MLS 消息加密", "DHKEM X25519",
      "HPKE ChaCha20", "HPKE 封装", "RFC9180", "HPKE encrypt", "加密组套件"],
  },

  hpkeOpen: {
    what: "HPKE 解密（Base 模式）——RFC 9180 的收方侧（Open）：用 enc（发送方临时公钥）+ 自己的私钥重演 KEM 封装得 shared_secret，重放 KeySchedule 派生 key/nonce，ChaCha20-Poly1305 验 tag 后解出明文。与「HPKE 加密」同套件（DHKEM(X25519)+HKDF-SHA256+ChaCha20-Poly1305）。",
    principle:
      "**Decap（§4.1）**：$dh = X25519(skR, enc)$，kem_context = enc‖pkR（pkR 由私钥推出），经与加密侧完全相同的 LabeledExtract(\"eae_prk\")/LabeledExpand(\"shared_secret\") 得到同一个 shared_secret——这正是 X25519 结合律的又一次应用。\n\n" +
      "**KeySchedule 重放**：输入相同（shared_secret、info、mode=0），派生相同 key/base_nonce。AEAD 的认证性保证：info/aad/key 任一不一致、密文或 tag 改动一个 bit，tag 校验即失败。\n\n" +
      "**失败语义**：tag 校验不过统一报「解密失败」，不区分是密钥错、enc 错、info/aad 不一致还是密文被改——与加密认证的语义一致，也避免给攻击者区分信息。",
    usage:
      "输入四样：enc（32B hex）、密文 ct（hex，含尾 16 字节 tag）、收方私钥 skR（32B hex）、info/aad（与加密侧一致，可空）。输出明文 hex + UTF-8 双视图。\n\n" +
      "排查顺序：先确认 enc/ct 没被截断转码，再对 info/aad 与加密端逐项核对，最后确认 skR 与加密用的 pkR 同对。",
    examples: [
      { in: "（加密档随机输出 + 对应 skR）", out: "明文（UTF-8）= secret message", desc: "标准闭环" },
      { in: "（enc 改一位）", out: "报错：HPKE 解密失败：AEAD tag 校验不通过", desc: "enc 参与 kem_context，改动即失败" },
      { in: "（info 与加密侧不同）", out: "报错：HPKE 解密失败（统一文案）", desc: "info 参与 KeySchedule，不一致派生出不同 key" },
    ],
    formulas: [
      { tex: "dh = X25519(sk_R, enc),\\quad shared\\_secret = \\mathrm{ExtractAndExpand}(dh, enc \\| pk_R)", caption: "Decap 与 Encap 得到同一 shared_secret" },
      { tex: "pt = \\mathrm{ChaCha20\\text{-}Poly1305.Open}(key, base\\_nonce, aad, ct)", caption: "tag 不过即整体失败，无部分解密" },
    ],
    tips: [
      "解 HPKE 题的输入清单：enc、ct、skR（或 skE+pkR 对拍）、info、aad——题目一般全给，缺哪个就补哪个的默认值（空）。",
      "tag 失败但所有参数看似一致：检查 hex 是否被大小写/空白/0x 前缀处理过，本工具容忍这些变体；再检查 ct 是否把 tag 拆出去单独给了。",
      "拿到 skE 和 skR 的题（双方私钥都在）：可以直接用加密档固定 skE 复现 ct，与题目给的 ct 对拍来定位哪一环不一致。",
      "本工具只做单包（seq=0）；题目给多条 ct 的话只有第一条能用本工具直接解，后续条目 nonce 需要递增——如实告知，不硬算。",
      "标准来源：RFC 9180 §5.1.4 Open / §4.1 Decap；向量同「HPKE 加密」档（CFRG 官方 json），闭环 + 异常面全绿。",
    ],
    aka: ["HPKE 解密", "HPKE open", "RFC 9180 解密", "HPKE Open", "HPKE decrypt",
      "HPKE 收方", "混合公钥解密", "HPKE ChaCha 解密", "DHKEM 解封装", "HPKE 解封装",
      "hybrid public key decryption", "HPKE base decrypt", "ECH 解密", "MLS 解密", "HPKE-OPEN"],
  },
};
