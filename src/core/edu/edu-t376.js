// 科普内容分片：T376 批（v0.1.6beta 全量补齐波收口）32 个新 op 的科普卡——
// noekeon/shacal2/cast6/cmacExt/ls47/Ed448/X448/GOST R 34.10-2012/PGP 8op/BB84/JWS/JWE/PASETO v4/ML-DSA/SLH-DSA。
// 纯数据，无 import 无副作用。examples 的 out 全部是 node 直跑真实输出摘录（RFC/FIPS 官方向量逐字核对），未编造。
export default {
  noekeon: {
    what: "Noekeon 分组密码：128 位分组/128 位密钥，16 轮 SPN structure（直序轮，direct round），NESSIE 项目提交/获提名的轻量密码。",
    principle:
      "Noekeon 是 2000 年 Daemen/Peeters/Assche/Peeters 提交给 NESSIE 的分组密码（NESSIE = New European Schemes for Signatures, Integrity and Encryption，欧盟 2000-2003 多算法评估项目）。\n\n" +
      "结构是 SP 网络：16 轮，轮函数由非线性 S 盒层（γ，基于 $x^{-1}$ 的 4 位 S 盒）、线性扩散层（θ）、置换字节（π，按位数循环移位）与轮常量异或（σ 用黄金率常数）拼成。加解密只有一个非一致之处——轮序 direction（direct/inverse），这点在代码里用一个布尔标记实现。\n\n" +
      "128 位分组、密钥即轮常量素材，加密和解密几乎对称，适合资源受限环境。本工具过 botan noekeon.vec 与 NESSIE 向量（1029 组单块 KAT）。",
    usage: "选模式（ECB/CBC），填 16 字节 hex 密钥与明文（hex，16 字节整数倍，不自动填充）。CBC 额外填 16 字节 IV。",
    examples: [
      { in: "00112233445566778899aabbccddeeff", param: "ECB, key=2b7e151628aed2a6abf7158809cf4f3c", out: "密文(hex) = 55280d0df35fc6238346f28b29d73f60", desc: "node 直跑真实输出" },
      { in: "同一密文", param: "CBC 解密, 同 key + IV=000102030405060708090a0b0c0d0e0f", out: "解密回原明文", desc: "往返自洽" },
    ],
    tips: [
      "CTF 里 Noekeon 多为「识别算法→对拍向量」题：特征 = 128 位块 + 16 轮 + 全小写 16 字节密钥。",
      "与 AES 同为 128 位块/128 位密钥，但 Noekeon 无 S 盒子层（用更简单的位级非线性），识别靠实现细节。",
      "明文必须是 16 字节的整数倍：非整块要自己补位（PKCS#7 再喂），工具不自动填充。",
    ],
    aka: ["noekeon", "noekeon加密", "密码noekeon", "nessie noekeon", "128位分组密码", "noekeon block cipher", "noekeon 加密", "nessie候选算法", "lightweight block cipher", "noekeon解密", "daemen noekeon", "spn分组密码", "noekeon katie"],
  },

  shacal2: {
    what: "SHACAL-2 分组密码：256 位分组，密钥最长 512 位，基于 SHA-256 压缩函数构造（NESSIE 入选算法）。",
    principle:
      "SHACAL-2 是 Handschuh-Naccache 基于 SHA-256 的 Davies-Meyer 方式构造的分组密码：把 SHA-256 的压缩函数反向使用，消息调度部分当密钥、压缩函数当分组加密，256 位输入分组经 64 轮（每组 32 位）变换得到 256 位输出。\n\n" +
      "它入选 NESSIE 最终方案集（SELECTED，2003），在 IEEE 802.11i（WPA3 前身标准栈）等场景曾被建议用作底层原语。分组是 256 位（不是常见的 128 位），密钥长度可变 128-512 位。\n\n" +
      "因为建在 SHA-256 压缩函数上，加解密几乎只有轮序与加法减法方向的小差异。本工具过 botan shacal2.vec（1019 组单块 KAT）。",
    usage: "选模式（ECB/CBC），填 16-64 字节（128-512 位）hex 密钥与明文（hex，32 字节/ 256 位整数倍）。CBC 填 32 字节 IV。",
    examples: [
      { in: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff", param: "ECB, key=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", out: "密文(hex) = 59f0d37c7dbed6e9724fe20099e54b6dea5a753128547c4f0f9977b21c05fa26", desc: "node 直跑真实输出(256 位分组/32 字节块)" },
    ],
    tips: [
      "特征 = 分组 256 位（32 字节）：明文长度必须是 32 的倍数，否则工具报「明文须为 32 字节（256 位分组）的整数倍」。",
      "与 SHA-256 的关系：SHACAL-2 是 SHACAL-2 加密，SHA-256 是哈希，二者共用压缩函数但方向不同，别混。",
      "CTF 里单块 KAT 对拍是主流考法；密钥可达 64 字节（512 位），比 AES 密钥长是它的特点。",
    ],
    aka: ["shacal-2", "shacal2", "shacal2加密", "shacal2 cipher", "nessie shacal", "256位分组密码", "shacal-2 block cipher", "基于sha-256的分组密码", "nessie入选算法", "shacal2解密", "handschuh分组密码", "shacal2 block cipher", "big block cipher"],
  },

  cast6: {
    what: "CAST-256（又名 CAST6）分组密码：128 位分组，128/192/256 位密钥，RFC 2612 标准化的 CAST 家族成员。",
    principle:
      "CAST-256 是 CAST 家族（Carlisle Adams & Stafford Tavares 设计）的 128 位成员，RFC 2612 标准化。结构是 12 轮 quad-round（4 轮一组）：前 6 轮正向、后 6 轮反向，共 48 轮。\n\n" +
      "每轮 Q 函数把 32 位数据与轮密钥经加法、异或、S 盒查找混合（CAST-128 是它的前辈，CAST-256 可看成 128 位块的扩展）；密钥调度用同样的 Q 函数反复吃主密钥生成 12 组轮密钥（Km 掩码 + Kr 旋转量）。\n\n" +
      "安全性基于 CAST 特有的 S 盒（由 bent 函数构造）与混合结构。本工具过 RFC 2612 附录 A 三组终态 KAT（128/192/256 位密钥各一组）。",
    usage: "选模式（ECB/CBC），填 16/24/32 字节密钥，明文为 16 字节（128 位分组）整数倍。",
    examples: [
      { in: "00112233445566778899aabbccddeeff", param: "ECB, key=2342bb9efa85742c0c8fcef38d0bf98b (128 位)", out: "密文(hex) = a2639d8b98644300a2db90266da27634", desc: "node 直跑真实输出，RFC 2612 官方密钥" },
    ],
    tips: [
      "CAST-256/CAST6 常见于旧版邮件与 PGP 时代的算法清单；CTF 出现多为「认名 + 对拍 RFC 2612 向量」。",
      "是 CAST-128（CAST5）的 128 位块后继：CAST-128 是 64 位块，CAST-256 是 128 位块，别拿 key length 去猜算法。",
      "密钥 128/192/256 位可任选，但都必须正好是 16/24/32 字节——不足不填充。",
    ],
    aka: ["cast-256", "cast6", "cast256", "rfc 2612", "cast加密", "cast-256加密", "cast6加密", "128位分组密码", "cast cipher", "cast家族", "cast256密钥", "cast6 decrypt", "cast-256 block cipher"],
  },

  cmacExt: {
    what: "通用 CMAC 消息认证码扩展：底层分组密码可选 Camellia/SEED/Twofish/RC6（128 位块）或 IDEA/Blowfish/CAST-128（64 位块）。",
    principle:
      "CMAC（OMAC1，NIST SP 800-38B，结构源自 ISO/IEC 9797-1 Method 2）把任意分组密码变 MAC：先对全零块加密得 L，按最高位移位派生子密钥 K1/K2（128 位块异或 Rb=0x87，64 位块异或 Rb=0x1B），末尾不足块补 10* 再按块处理。\n\n" +
      "本 op 不锁定 AES，而是把内核分组密码做成下拉可选——Camellia/SEED/Twofish/RC6 走 128 位块（Rb=0x87），IDEA/Blowfish/CAST-128 走 64 位块（Rb=0x1B，ISO/IEC 9797-1 语义）。\n\n" +
      "背书方式：各底层分组密码用官方单块 KAT（RFC 3713/4269、botan vec 等）+ CMAC 结构用 RFC 4493 四组 AES-CMAC 向量做「组合等价」双背书。",
    usage: "选底层算法 alg，填对应长度 hex 密钥 K，消息选 hex 或 text 编码，运行得 T = CMAC(alg, K, M)。",
    examples: [
      { in: "6bc1bee22e409f96e93d7e117393172a", param: "alg=camellia, key=0123456789abcdeffedcba9876543210, msgEnc=hex", out: "T = CMAC(camellia, K, M) = dac259b031262650346baa4c2dede130", desc: "node 直跑真实输出" },
    ],
    tips: [
      "128 位块与 64 位块的子密钥常数不同（0x87 vs 0x1B），对拍前先确认题图用的是哪种块——这是 CMAC 题第一大坑。",
      "与 AES-CMAC 的关系：本 op 换内核，结构与 RFC 4493 完全一致，搞懂 AES-CMAC 即可平移。",
      "MAC 不加密：它证明「消息 + 密钥」未被改，持有密钥的双方都能算，不具备签名性。",
    ],
    aka: ["cmac扩展", "通用cmac", "cmac camellia", "cmac seed", "cmac twofish", "cmac rc6", "cmac blowfish", "cmac cast5", "iso/iec 9797-1", "omac1", "kmac", "消息认证码cmac", "cmac generic", "rfc 4493结构"],
  },

  ls47: {
    what: "LS47 字母牌密码：ElsieFour/LC4 的 7×7 扩展（49 字符，含小写字母/数字/常用符号），每字符牌面行列旋转 + marker 混合位。",
    principle:
      "LS47 是 Michal Buszkiewicz / Mirek Kratochvil 2017 年发布的手工密码（官方参考实现 ls47.py）：49 字符字母表（下划线 + 26 小写 + 点 + 10 数字 + , - + * / : ? ! ' ( )）排成 7×7 牌面 key，每字符恰出现一次。\n\n" +
      "加密每个明文字符：找它在牌面坐标 pp，取 marker 处字符的固有坐标 mix，密文位置 $cp = pp + mix \\pmod{7}$；随后把 pp 所在行右旋 1 格、密文新位置所在列下旋 1 格，marker 再加密文字符固有坐标。解密是逆过程（$cp - mix$），状态更新完全一致。\n\n" +
      "这是状态自同步的自同步流密码式结构——牌面随着每个字符演化，所以同一明文不同实现位置输出不同。密钥可给 49 字符原始排列，也可用口令派生（derive_key）。",
    usage: "选密钥方式（口令派生默认 / 49 字符原始牌面），填密钥或口令。空格透明按下划线处理。",
    examples: [
      { in: "hello world", param: "口令派生, key=s3cret_p4ssw0rd/31337", out: "密文 = 87?5qn82y3)", desc: "node 直跑真实输出（空格转 _ 再加密）" },
    ],
    tips: [
      "LS47 是 ElsieFour 的扩展：ElsieFour/LC4 用 36 字符表，LS47 扩到 49 字符含符号——认出 7×7 牌面即此族。",
      "自同步特性导致加密结果依赖密钥与消息起始位置；对拍务必用同一条官方参考实现的同一密钥。",
      "CTF 题干给「ElsieFour/LC4/LS47」任意一名字别被绕：同族算法，按给定密钥与字母表对拍即可。",
    ],
    aka: ["ls47", "ls47密码", "ls47加密", "elsiefour", "elsiefour密码", "lc4", "lc4密码", "字母牌密码", "7x7密码", "elsiefour扩展", "ls47解密", "密文牌面", "mirek kratochvil ls47", "密码盘密码", "polybius立体密码"],
  },

  ed448Sign: {
    what: "Ed448 纯 EdDSA 签名：RFC 8032 的 Ed448（Goldilocks 曲线），SHAKE-256 哈希，57 字节密钥/114 字节签名，安全级约 224 位。",
    principle:
      "Ed448 用非扭转 Edwards 曲线 $x^2 + y^2 = 1 + d x^2 y^2$，$p = 2^{448} - 2^{224} - 1$（Goldilocks），基点阶为 $2^{446}$ 附近的素数 L。签名哈希用 SHAKE256（FIPS 202），且带域分离串 $dom4(F,C) = \\text{\"SigEd448\"} \\| \\text{octet}(F) \\| \\text{octet}(len(C)) \\| C$。\n\n" +
      "私钥 57 字节 → SHAKE256(sk, 114) 展开：前 57 字节 prune（首字节低 2 位清、末字节清、倒数第二字节最高位置 1）成标量 s，后 57 字节作 prefix。签名 $(R,S)$：$r = H(prefix \\| M) \\bmod L$，$R=[r]B$，$k = H(ENC(R)\\|A\\|M) \\bmod L$，$S = (r + k s) \\bmod L$。\n\n" +
      "Ed448 是「确定性」签名：同钥同文永远同签名（RFC 6979 式的可复现），CTF 对拍友好。本工具过 RFC 8032 §7.4 全部 9 组官方向量。",
    usage: "消息（text/hex），私钥 57 字节 hex 可填（留空随机生成），可选 context（hex，≤255 字节，读 RFC 8032 dom4）。输出公钥、R、S 与完整签名。",
    examples: [
      { in: "sample", param: "text, priv=fede5498…4c427（57B hex）", out: "公钥 (57B) = ff789dd3…be80 / 签名 R = 6494224b…7580 / 签名 S = 9cb58e03…1300 / 签名 (114B) = 649422…1300", desc: "node 直跑真实输出；私钥固定即可复现" },
    ],
    tips: [
      "Ed448 大：密钥 57 字节、签名 114 字节，比 Ed25519（32/64 字节）大一倍，安全级约 224 位——认长度即可区分。",
      "签名必须带 context 一致：签发与验签的 context 一个字节不同都失败。",
      "确定性签名在 CTF 里是双刃：同钥同文输出恒定便于对拍，但也意味着拿同一签名辅以侧信道可复现（鉴权场景）。",
    ],
    aka: ["ed448签名", "ed448 sign", "eddsa ed448", "rfc 8032", "goldilocks", "goldilocks签名", "ed448", "curve448签名", "ed448 eddsa", "sha-3签名", "shake256签名", "ed448私钥签名", "ed448 signature", "ed448生成签名"],
  },

  ed448Verify: {
    what: "Ed448 验签：公钥 + 114 字节签名 + 原消息，校验 [4][S]B = [4]R + [4][k]A（乘 cofactor 4），篡改任一字节即拒。",
    principle:
      "验签把签名方程倒着走：解压公钥点 A 与 R（点编码非法直接失败），标量 S 须满足 $S < L$（否则是可延展性攻击，RFC 8032 §8.4 明确要求）；重算挑战 $k = H(ENC(R)\\|A\\|M) \\bmod L$，最后查 $[4][S]B = [4][k]A + [4]R$。\n\n" +
      "cofactor 4 的含义：Ed448 的曲线阶含 4 因子，方程两边同乘 4 避免小阶点/扭点攻击（小阶点攻击即经典的无密钥伪造变体）。\n\n" +
      "输出会逐步给过程：公钥点解压、R 点解压、S 范围检查、群方程成立与否。本工具过 RFC 8032 §7.4 九组官方向量（含负例）。",
    usage: "消息 + 公钥 57 字节 hex + 签名 114 字节 hex，context 须与签发一致（可空）。",
    examples: [
      { in: "sample + Ed448 签名产物", param: "pub=ff789dd3…be80, sig=649422…1300", out: "公钥点解压成功 / R 点解压成功 / 标量 S 范围检查通过 / ✓ 签名有效（[4][S]B = [4]R + [4][k]A 成立）", desc: "node 直跑真实输出，与签名卡配套" },
      { in: "同签名改末字节", param: "同 pub/ctx", out: "✗ 签名无效（群方程不成立/R 点解压失败等）", desc: "篡改即拒" },
    ],
    tips: [
      "验签失败三连查：context 是否与签发一致、公钥/签名是否恰好 57/114 字节、消息 text/hex 编码是否一致。",
      "出现「标量 S 范围检查失败」说明签名 $S \\ge L$——可延展性攻击形态，正常签名不会出现。",
      "Ed448 曲线阶含 4 因子，与 Ed25519（cofactor 8）不同，验签方程不一样，别套用 Ed25519 验签脚本。",
    ],
    aka: ["ed448验签", "ed448 verify", "eddsa ed448验签", "rfc 8032验签", "验证ed448签名", "ed448签名验证", "goldilocks验签", "ed448 signature verification", "ed448校验", "sha-3验签", "ed448 public key verify", "ed448 verify signature"],
  },

  x448KeyGen: {
    what: "X448（Curve448）密钥对生成：私钥 56 字节随机（或给定），公钥 = X448(clamp(私钥), 基点 5)。配套「X448 共享密钥」做 ECDH。",
    principle:
      "X448 是 RFC 7748 定义的 Curve448 上的 X25519 姊妹钥交换（Montgomery 曲线 $v^2 = u^3 + 156326 u^2 + u$）。私钥 56 字节，标量 clamp 与 X25519 不同：$k[0] \\&= 252$，$k[55] \\|= 128$。公钥 = 私钥标量对基点 $u=5$ 做 Montgomery ladder 标量乘，结果 56 字节 LE。\n\n" +
      "Curve448 是「高安全级友好」曲线：约 224 位安全级，配合 Ed448 使用（同族 Goldilocks 参数）。\n\n" +
      "私钥可留空随机生成，也可给定 56 字节 hex（教学/复现）。公钥可下载为 hex 文件。",
    usage: "私钥 56 字节 hex 可填（留空随机）。运行得私钥与公钥，可用「X448 共享密钥」算 ECDH。",
    examples: [
      { in: "（空输入，直接运行）", param: "priv=c8ce8b26…1fd15（56B hex）", out: "私钥 (56B, hex) = c8ce8b26…1fd15 / 公钥 (56B, hex) = 6ff0bdb6…e783", desc: "node 直跑真实输出；公钥 = X448(clamp(priv), 基点 5)" },
    ],
    tips: [
      "与 X25519 的差别在长度：X448 私钥/公钥都是 56 字节，X25519 是 32 字节——认长度区分。",
      "clamp 细节：X448 不 mask u 坐标最高位（因为 p 可被 8 整除无空闲位），与 X25519 处理不同。",
      "公钥就是交换给对方的那 56 字节：拿到对方公钥用「X448 共享密钥」算共享密钥。",
    ],
    aka: ["x448密钥生成", "x448 keygen", "curve448密钥", "x448生成", "rfc 7748", "curve448", "x448密钥对", "montgomery曲线密钥", "x448 public key", "curve448 keygen", "x448生成密钥对", "keypair x448"],
  },

  x448Shared: {
    what: "Curve448 上的 ECDH（RFC 7748 §6.2）：双方私钥算共享密钥（两侧互验一致），或我方私钥 + 对方公钥直接算。",
    principle:
      "ECDH 核心：双方各自用「自己私钥 × 对方公钥」做 Montgomery ladder 标量乘，得到同一条共享密钥——因为椭圆曲线标量乘法满足交换性 $k_A(k_B G) = k_B(k_A G)$。\n\n" +
      "X448 的共享值就是那个 56 字节 LE 结果。工具提供两种模式：双方私钥模式（给 privA/privB，验 $A \\cdot \\mathrm{pkB}$ 与 $B \\cdot \\mathrm{pkA}$ 是否一致，用于证明自洽）与我私钥+对方公钥模式（真实两人交互时的用法）。\n\n" +
      "RFC 7748 强调共享值用前要过 KDF（不能直接当对称密钥用），本工具也加了这句提醒。",
    usage: "选模式。双方私钥模式填 privA/privB；我私钥+对方公钥模式填 priv 与 pub（均 56 字节 hex）。",
    examples: [
      { in: "（空输入，直接运行）", param: "双方私钥: privA=c8ce8b26…1fd15, privB=10080dc6…56f8", out: "共享 K (A·pkB) = 921e3a3f…c1 / 共享 K (B·pkA) = 921e3a3f…c1 / ✓ 两侧一致（ECDH 成立）", desc: "node 直跑真实输出；两张公钥已先算出并列出" },
    ],
    tips: [
      "共享值两侧应逐字节相等：不一致说明参数填错或用到不同曲线/基点。",
      "RFC 7748 警告：X448 共享值要再过 KDF（如 HKDF/SHAKE）才能当会话密钥，别直接当 AES 密钥。",
      "X448 与 Ed448 是同一族 Goldilocks 参数：公钥长度 56 字节，与 Ed448 的 57 字节不同（Ed448 加密点带符号位）。",
    ],
    aka: ["x448共享密钥", "x448 ecdh", "x448 shared", "curve448 ecdh", "x448密钥协商", "rfc 7748 ecdh", "x448交换密钥", "diffie hellman x448", "x448共享", "x448 agreement", "curve448 dh", "x448 key exchange"],
  },

  gostSign: {
    what: "GOST R 34.10-2012 数字签名（RFC 7091）：俄罗斯国标 EC 签名，哈希用 Streebog（GOST R 34.11-2012 / RFC 6986），256/512 位两参数集。",
    principle:
      "算法（RFC 7091 §6.1 Algorithm I）建在椭圆曲线 $y^2 = x^3 + ax + b \\pmod p$ 上：私钥 $d$，公钥 $Q = d·P$（注意是正号，与许多惯例相反）。\n\n" +
      "签名：$e = \\alpha \\bmod q$（$\\alpha$ = Streebog(M) 大端整数，$e=0$ 时置 1）；随机 $k \\in (0,q)$，$r = x(kP) \\bmod q$，$s = (r·d + k·e) \\bmod q$。签名 $\\zeta = R \\| S$ 大端（本工具 R 在前 S 在后）。\n\n" +
      "⚠ pygost 等库输出 s‖r（两半互换），互通时需交换两半——这是本工具与其他实现互操作最常见的坑。参数集：256 位用 id-GostR3410-2001-TestParamSet（= RFC 7091 §7.1 官方示例），512 位用 id-tc26-gost-3410-12-512-paramSetA。",
    usage: "选参数集（256/512）、消息格式，私钥 d 与随机数 k 可填（教学复现），留空随机。输出公钥 Q、r、s 与签名 ζ。",
    examples: [
      { in: "sample", param: "256 位, priv=55986d0b…795c, k=7d1a1a4b…898a（教学固定）", out: "Streebog-256(M) = 226b66f6…c993 / e = 15568400…2707 / r = 7afd97e0…f916 / s = 56040295…c7ed / 签名 ζ(R||S) = 7afd97…7ed", desc: "node 直跑真实输出（k 固定即可复现）" },
    ],
    tips: [
      "GOST 是俄罗斯/东欧系曲线题常用算法；256 位参数集就是 RFC 7091 官方测试集，对拍认准它。",
      "签名顺序坑：本工具 ζ=R||S 大端，pygost 等输出 s||r——拿到外部签名先看顺序。",
      "哈希固定用 Streebog-256/512（按参数集），不能换成 SHA 系，对拍时别拿 SHA-256 去比摘要。",
    ],
    aka: ["gost签名", "gost r 34.10-2012", "gostr3410-2012", "rfc 7091", "俄罗斯签名", "gost 34.10签名", "gost digital signature", "streebog签名", "国标签名gost", "gost34.10签名", "gost sign", "rfc 7091签名", "gost曲线签名"],
  },

  gostVerify: {
    what: "GOST R 34.10-2012 验签：公钥 Q(x,y) + 签名 ζ=R‖S + 原消息，复算 $C = z1 \\cdot P + z2 \\cdot Q$ 比对 $x(C) \\bmod q$。篡改任一环节即失败。",
    principle:
      "Algorithm II（RFC 7091 §6.2）：先查 $0 < r,s < q$ 范围（攻击面拦截），算 $v = e^{-1} \\bmod q$，$z_1 = s·v \\bmod q$，$z_2 = -r·v \\bmod q$，再算 $C = z_1·P + z_2·Q$，若 $x(C) \\bmod q = r$ 则签名有效。\n\n" +
      "这正是把签名方程 $s = rd + ke$ 用两倍点还原：$z_1 = s/e$、$z_2 = -r/e$ 时 $C = (s/e)P + (-r/e)Q = (s - rd)/e · P = kP$，$x(C)$ 应回到 $kP$ 的横坐标 $r$。\n\n" +
      "输出每一步：v、z1、z2、C 的 x 坐标再与 r 比对。公钥必须落在曲线上（onCurve 检查），否则拒绝。",
    usage: "消息 + 公钥 Q.x/Q.y（hex）+ 签名 ζ（hex，R 在前 S 在后）。参数集、消息格式须与签发一致。",
    examples: [
      { in: "sample + GOST 签名产物", param: "256 位, pubx=1eee38f2…ac3, puby=7acbeff1…190", out: "e = 15568400…2707 / v = 1b91d094…0b4 / z1/z2 = … / C: x(C) mod q = 7afd97e0…f916 / ✓ 签名有效（x(C) mod q = r）", desc: "node 直跑真实输出，与签名卡配套" },
      { in: "同签名改消息 sample2", param: "同 pub/参数", out: "✗ 签名无效（x(C) mod q ≠ r）", desc: "篡改即拒" },
    ],
    tips: [
      "公钥不合法会先报「公钥 Q 不在曲线上」——先确认 Q 是曲线上点，再谈验签。",
      "签名长度须为 2×size 字节（256 位 → 64 字节）：R、S 各 size 字节，顺序错会直接判负。",
      "「合法」只证明签名与 (消息, 公钥) 匹配；公钥是不是本人的要另查证书链。",
    ],
    aka: ["gost验签", "gost verify", "gost r34.10验签", "rfc 7091验签", "gost signature verification", "验证gost签名", "gost2012验签", "gost 34.10-2012验证", "gost digital signature verify", "streebog验签", "gost r 34.10验签"],
  },

  pgpGenKeyPair: {
    what: "生成一对 PGP 密钥：公钥发给别人加密，私钥自己留着解密。基于 openpgp.js v5.11.2（RFC 4880），支持 Curve25519 或 RSA-3072。",
    principle:
      "PGP/OpenPGP（RFC 4880）密钥不是单密钥，是一串可扩展的密钥包：主钥（签名）通常带一个子钥（加密），字符 ID（userID）形如 \"姓名 <邮箱>\"。\n\n" +
      "本工具用 openpgp.js v5.11.2 的 generateKey：Curve25519 模式出一对 ECDH + EdDSA 钥（主钥 EdDSA 签名、子钥 ECDH 加密），RSA-3072 模式出 RSA 主/子钥。私钥可选口令保护（passphrase），输出为 ASCII Armor 带 `-----BEGIN PGP PUBLIC/PRIVATE KEY BLOCK-----` 壳。\n\n" +
      "公钥可分发，私钥是敏感产物（带口令则需口令才能导出用）。指纹/KeyID 用于识别密钥身份。",
    usage: "填用户名（默认 EBCTFCodeBox）、邮箱（默认 user@local.dev）、私钥口令（可空）、算法（ecc 默认 / rsa3072）。",
    examples: [
      { in: "（空输入，直接运行）", param: "ecc, name=EBCTFCodeBox, email=user@local.dev", out: "算法: Curve25519（ECDH+EdDSA）/ 创建: 2026-09-03… / 指纹: F879 49EF A41C 8B34 FF60 D96F 0117 0A7F C504 E626 + BEGIN PGP PUBLIC/PRIVATE KEY BLOCK", desc: "node 直跑真实输出；KeyID 字段在 v5.11.2 里显示 undefined（库未暴露），指纹正常" },
    ],
    tips: [
      "PGP 密钥只该生成一次并备份私钥——公钥能随时从私钥推，私钥丢了签名/解密都完蛋。",
      "指纹（fingerprint）是密钥的完整身份证，KeyID 只是它的短后 8 位，验证对方身份看指纹。",
      "敏感：私钥（尤其无口令时）别外传。Curve25519 兼容性好，RSA-3072 兼容最老客户端。",
    ],
    aka: ["pgp密钥生成", "pgp keygen", "生成pgp密钥", "openpgp密钥", "gpg密钥生成", "rfc 4880密钥", "pgp key pair", "pgp密钥对", "gpg keygen", "openpgp keygen", "asymmetric pgp", "pgp私钥生成", "pgp公钥生成", "curve25519 pgp"],
  },

  pgpEncrypt: {
    what: "拿对方 PGP 公钥块加密一段明文，输出 ASCII Armor 密文（可选附带签名，先签后加）。",
    principle:
      "OpenPGP 加密（RFC 4880 CFB 模式 / 6637 后加了 EAX/OCB）用会话密钥加密明文，再把会话密钥用对方公钥包装（encryption key wrap），所以密文只能由持有对应私钥的人解开。\n\n" +
      "可选附带签名：`signingKeys` 传本方私钥，openpgp 会先对消息签名再加密（先签后加密），解密端能拿到签名信息。\n\n" +
      "输入是 `-----BEGIN PGP PUBLIC KEY BLOCK-----` 块（ASCII Armor），输出同样是 Armor 壳的 PGP MESSAGE。配合 PGP 密钥对生成卡用。",
    usage: "明文进主输入框，粘贴对方公钥块（pubKey），可选填签名私钥块与口令。",
    examples: [
      { in: "attack at dawn", param: "pubKey=（PGP 密钥对生成的公钥块）", out: "明文 14 字节 → 密文 281 字符 + -----BEGIN PGP MESSAGE-----\n…\n-----END PGP MESSAGE-----", desc: "node 直跑真实输出（长度随密钥/随机性变化）" },
    ],
    tips: [
      "PGP 加密是「随机」的：同一明文两次密文不同（会话密钥随机），别当 bug。",
      "密文能被解密 ≠ 密文对应你——附了签名才能确认发送者身份（见 pgpEncryptAndSign）。",
      "加密时对方公钥可以是仅公钥块（无私有材料），安全传递。",
    ],
    aka: ["pgp加密", "pgp encrypt", "openpgp加密", "gpg加密", "rfc 4880加密", "pgp密文生成", "公钥加密pgp", "openpgp encrypt", "pgp message", "gpg encrypt", "pgp加密消息", "public key encrypt pgp"],
  },

  pgpDecrypt: {
    what: "用私钥块解 PGP 密文得明文；密文若内含签名顺带给出验签结果。",
    principle:
      "OpenPGP 解密：用私钥解开被包装的会话密钥，再用会话密钥解开密文负载。若密文是「加密并签名」，解密端会返回签名数组 `signatures`，可逐一查验（但需要签名者公钥）。\n\n" +
      "私钥块可以是 ASCII Armor 的 PRIVATE KEY BLOCK；带口令的私钥要先解密（decryptKey）。无口令私钥在 openpgp.js v5 下单步解密（已有实现处理了 \"Key packet is already decrypted\" 的实测行为）。\n\n" +
      "输出明文与签名状态行（已验证 ✓ / 无效 ✗ / 未验证——未提供签名者公钥时）。",
    usage: "密文（ASCII Armor PGP MESSAGE）进主输入框，粘贴私钥块与口令（可空）。",
    examples: [
      { in: "-----BEGIN PGP MESSAGE-----…（pgpEncrypt 产物）", param: "privKey=（PGP 密钥对生成的私钥块）", out: "=== PGP 解密成功 ===\n明文 14 字节：\nattack at dawn", desc: "node 直跑真实输出" },
    ],
    tips: [
      "解密失败常见原因：私钥与密文不对应、口令错误、密文被篡改。",
      "密文带签名时 openpgp 返回 signatures，只有给了签名者公钥才显示出 「已验证」; 没给会标「未验证」。",
      "PGP 解密的明文可能含任意二进制——工具用 utf8 格式解，非文本内容可能乱码。",
    ],
    aka: ["pgp解密", "pgp decrypt", "openpgp解密", "gpg解密", "rfc 4880解密", "pgp明文恢复", "解密pgp", "openpgp decrypt", "gpg decrypt", "pgp decode", "私钥解密pgp"],
  },

  pgpSign: {
    what: "用 PGP 私钥给消息签名，可出 Cleartext 签名（原文可读）或 Detached 分离签名（.sig）。",
    principle:
      "PGP 签名（RFC 4880）用签名者的私钥对消息摘要签名，附签名者身份与算法信息，验签方用公钥确认「消息确实由该密钥持有人签名」。\n\n" +
      "两种形态：Cleartext signature（`-----BEGIN PGP SIGNED MESSAGE-----`）正文明文可见、Hash 头 + 附加签名块，适合邮件/公告（人可读）；Detached signature（`-----BEGIN PGP SIGNATURE-----`）只有签名、需和原消息一起用，适合传输而不改动原文。\n\n" +
      "openpgp.js v5 实测：cleartext 块必须用 createCleartextMessage（普通 message 会出 PGP MESSAGE 包），工具已处理。输出可下载 .sig 文件。",
    usage: "消息进主输入框，私钥块 + 口令，签名形态选 Cleartext 或 Detached。",
    examples: [
      { in: "attack at dawn", param: "私钥块, mode=clear", out: "-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\nattack at dawn\n-----BEGIN PGP SIGNATURE-----\n…", desc: "node 直跑真实输出（cleartext 原文可读）" },
    ],
    tips: [
      "验签（pgpVerify）认两种块：SIGNED MESSAGE（cleartext）与 SIGNATURE（detached），都会自动判别。",
      "签名 ≠ 加密：签名只证明「消息 + 私钥持有人」关系，明文仍是明文——要保密得再加 pgpEncrypt。",
      "签名的 Hash 头默认 SHA512（openpgp 新版本），验签端自动识别。",
    ],
    aka: ["pgp签名", "pgp sign", "openpgp签名", "gpg签名", "rfc 4880签名", "cleartext签名", "分离签名", "pgp digital signature", "gpg sign", "clearsign", "detached signature", "pgp signed message", "openpgp sign"],
  },

  pgpVerify: {
    what: "用签名者公钥验证 PGP 签名（cleartext 或 detached）合法与否，输出签名人 KeyID 与原文。",
    principle:
      "OpenPGP 验签：读取签名块（cleartext message 或 detached signature 的 PGP MESSAGE），用签名者公钥重算并比对签名，`sig.verified` 给布尔结论。\n\n" +
      "自动判别输入是 cleartext（含 `BEGIN PGP SIGNED MESSAGE`）还是分离签名（含 `BEGIN PGP SIGNATURE`）；分离签名需与原文一起验证（工具从签名块重构消息内容并返回原文）。\n\n" +
      "验签结果的可靠性取决于你手里的公钥确实是发送者本人的——公钥信任链（Web of Trust）是 OpenPGP 的另一层话题。",
    usage: "签名文本/分离签名块进主输入框，粘贴签名者公钥块。",
    examples: [
      { in: "-----BEGIN PGP SIGNED MESSAGE-----…（pgpSign cleartext 产物）", param: "pubKey=（签名者公钥块）", out: "✓ 签名有效（KeyID undefined）\n原文：\nattack at dawn", desc: "node 直跑真实输出；KeyID 在 v5.11.2 显示 undefined，验签结论正常" },
    ],
    tips: [
      "「✓ 签名有效」只代表签名与 (消息, 公钥) 匹配——公钥是否属于本人要靠 Web of Trust 或指纹比对。",
      "验签失败先看签名块完整与公钥正确：cleartext 含 Hash 头，detached 只有签名包。",
      "分离签名单独粘验签工具读不出原文，需与消息一起提交。",
    ],
    aka: ["pgp验签", "pgp verify", "openpgp验签", "gpg验签", "pgp签名验证", "验证pgp签名", "cleartext验签", "detached验签", "rfc 4880验签", "pgp signature verification", "gpg verify", "pgp check signature"],
  },

  pgpEncryptAndSign: {
    what: "加密并签名（先签后加密）：明文 + 对方公钥 + 本方私钥 → 密文（内嵌签名，解密端能验证发送者）。",
    principle:
      "OpenPGP 的 encrypt 接口同时传 encryptionKeys（对方公钥）与 signingKeys（本方私钥），会先对消息签名、再用会话密钥加密封装。密文里同时含加密负载与被保护的签名包。\n\n" +
      "好处：对方解出明文的同时能验发送者身份，实现「只有对方能读 + 只有你能签」双重保障。前提是加密密钥与签名密钥来自不同方（对方公钥加密、本方私钥签名）。\n\n" +
      "输出是 ASCII Armor 的 PGP MESSAGE，解密端用 PGP 解密并验签（pgpDecryptAndVerify）。",
    usage: "明文进主输入框，粘贴对方公钥块（pubKey）、本方私钥块（signPriv）与口令（可空）。",
    examples: [
      { in: "attack at dawn", param: "pubKey=（对方公钥）, signPriv=（本方私钥）", out: "密文 506 字符 + -----BEGIN PGP MESSAGE---…（加密并签名的密文）", desc: "node 直跑真实输出；用「PGP 解密并验签」可还原+验签" },
    ],
    tips: [
      "密文内含签名但仍加密：没有对应私钥的人连签名都看不到，这是「先签后加密」的设计。",
      "对方解密要他的私钥 + 你的公钥（验签），与「PGP 解密并验签」卡配套。",
      "密钥别搞混：加密用对方公钥，签名用本方私钥，填反会直接报错或验签失败。",
    ],
    aka: ["pgp加密签名", "pgp encrypt and sign", "openpgp加密签名", "gpg加密签名", "加密并签名", "pgp sign encrypt", "先签后加密", "pgp digital envelope", "gpg encrypt and sign", "rfc 4880加密签名", "pgp签名加密封装"],
  },

  pgpDecryptAndVerify: {
    what: "解密并验签：密文 + 本方私钥 + 签名者公钥 → 明文 + 验签结论（一条链路同时做保密与身份确认）。",
    principle:
      "OpenPGP decrypt 接口同时传 decryptionKeys（本方私钥）与 verificationKeys（签名者公钥，可选）：解出明文的同时对内嵌签名做验证。r.signatures 数组里每条的 verified 给结论。\n\n" +
      "不提供签名者公钥时，签名标「未验证」（仅解密成功）——这是安全优先设计：宁可不给结论也不报假「有效」。\n\n" +
      "与「PGP 解密」的区别：本卡把验签也当第一等公民，输出明文 + 每条签名的明确结论。",
    usage: "密文进主输入框，粘贴本方私钥块、口令（可空）、签名者公钥块（可空）。",
    examples: [
      { in: "-----BEGIN PGP MESSAGE-----…（pgpEncryptAndSign 产物）", param: "privKey=（本方私钥）, pubKey=（签名者公钥）", out: "=== PGP 解密并验签 ===\nattack at dawn\n✓ 签名有效（KeyID undefined）", desc: "node 直跑真实输出" },
    ],
    tips: [
      "「未验证」是降级安全：给了签名者公钥才显示有效/无效，否则只解出明文。",
      "解密成功但签名无效说明密文完整性被破坏或有中间人——别收。",
      "与 pgpDecrypt 二选一：需要验签结论用本卡，只解密出明文用 pgpDecrypt。",
    ],
    aka: ["pgp解密验签", "pgp decrypt and verify", "openpgp解密验签", "gpg解密验签", "解密并验签", "pgp decrypt verify", "签名验证解密", "rfc 4880解密验签", "pgp authenticated decrypt", "gpg decrypt and verify"],
  },

  pgpParseKey: {
    what: "解析 PGP 公钥/私钥块：用户 ID、主钥与子钥的 KeyID/算法/创建时间/能力/指纹、子钥数量全列出。",
    principle:
      "OpenPGP 密钥（RFC 4880）由多个密钥包构成：主钥（primary key，负责签名）+ 若干子钥（subkey，负责加密等）。ASCII Armor 块 decoded 后按包解析。\n\n" +
      "openpgp.js 的 readKey 给出 getUserIDs()、getKeyID()、getAlgorithmInfo()、getCreationTime()、getFingerprint() 与 subkeys。能力标志（加密/签名）在 v5.11.2 里无法直接调 canEncrypt/canSign（实测方法缺失），工具按算法名正则推断（eddsa→签名、ecdh→加密、rsa→双能）。\n\n" +
      "指纹是完整密钥 ID，KeyID 是其短 8 位。输出区分公钥/私钥（isPrivate）。",
    usage: "粘贴公钥或私钥块（ASCII Armor），运行。",
    examples: [
      { in: "-----BEGIN PGP PUBLIC KEY BLOCK-----…（密钥对生成产物）", param: "armored=公钥块", out: "用户ID: EBCTFCodeBox <user@local.dev> / 主钥: KeyID undefined, 算法 eddsa, 创建 …, 能力 签名, 指纹 35D0…AC4 / 子钥 1 个: [1] ecdh … 能力 加密", desc: "node 直跑真实输出；v5.11.2 KeyID 显示 undefined，指纹/算法正常" },
    ],
    tips: [
      "解析私钥块也能看公钥信息（私钥内含公钥材料），常用于核对身份。",
      "指纹是首要信任凭据；KeyID 易冲突别当唯一标识。",
      "能力行（签名/加密）来自算法名推断：eddsa 主钥 → 签名，ecdh 子钥 → 加密。",
    ],
    aka: ["pgp密钥解析", "pgp parse key", "openpgp密钥解析", "gpg密钥查看", "rfc 4880解析", "pgp fingerprint", "pgp fingerprint查询", "查看pgp密钥", "pgp密钥信息", "gpg --list-keys", "pgp userid", "pgp subkey", "openpgp key info"],
  },

  bb84Qkd: {
    what: "BB84 量子密钥分发教学仿真：随机基矢发送-测量 → 基矢比对筛密 → 抽样估误码率检出窃听 → 剩余为最终密钥。经典概率模型。",
    principle:
      "BB84 协议（Bennett & Brassard 1984）是第一个量子密钥分发协议：Alice 对每个比特随机选基矢（+ 直角 / × 对角）发偏振光子；Bob 每光子再随机选基测量——基相同结果确定（无噪声 100% 一致），基不同结果均匀随机（测不准原理）。\n\n" +
      "公开信道只比对基矢（不公开比特），弃掉基不同的位置得筛后密钥（期望 n/2 位）；再从筛后密钥抽样公开比对估误码率 QBER：无窃听无噪声时 QBER=0；截获-重发式窃听（Eve 每光子以概率 eve 拦截、随机基测量后转发）在筛后位引入错率 ≈ eve/4（全拦时 ≈ 25%，超 BB84 安全阈值 ~11%）。QBER 超阈值 → 判定信道不安全，协议中止。\n\n" +
      "本仿真用 splitmix64 可复现 PRNG（seed 留空随机并回显），经典概率模型演示 sift-then-check 逻辑；真实 QKD 需量子信道与单光子源。",
    usage: "设发送光子数 n、信道误码率 err、Eve 窃听率 eve、抽样比例 sampleRatio、检出门限 threshold、过程表显示行数 tableRows，种子 seed 可固定（复现）。",
    examples: [
      { in: "（空输入，直接运行）", param: "n=128, err=0.02, eve=0.1, seed=demo, threshold=0.11", out: "④ 基相同 63 位 → 筛后密钥 / ⑤ 抽样 31 位不一致 1 位 → 实测 QBER = 3.23%（理论 ≈4.30%）/ ⑥ QBER 在门限内未检出窃听 / ⑦ 最终密钥 (32 bit) hex = a7b0c853", desc: "node 直跑真实输出（seed=demo 可复现）" },
      { in: "同 seed，eve 调到 1（全拦）", param: "n=128, eve=1, seed=demo", out: "实测 QBER ≈ 25% → QBER 超门限，Eve 被检出，本次密钥作废", desc: "窃听检出演示" },
    ],
    tips: [
      "BB84 的核心是「量子不可克隆」+ 测不准原理：Eve 一测量就扰动状态，Alice/Bob 用抽样误码率自检。",
      "安全阈值 ~11%：超过就认定有窃听者并作废密钥（真实协议会换信道重来）。",
      "CTF 出现 BB84 多为概念题：给出 QBER 让你判「是否有窃听/Eve 概率」，套 eve/4 关系。",
    ],
    aka: ["bb84", "bb84协议", "量子密钥分发", "quantum key distribution", "qkd", "bennett brassard", "bb84 qkd", "量子密码", "量子通信", "bb84仿真", "量子密钥分发仿真", "bb84 1984", "截获重发"],
  },

  jwsSign: {
    what: "JWS 签发（RFC 7515 compact）：HS256/384/512 对称、RS256（RSA PKCS#1 v1.5）、ES256（P-256）。header/payload JSON + 密钥 → JWS token。",
    principle:
      "JWS（JSON Web Signature，RFC 7515）是 JOSE 家族的签名载体，compact 序列化为 `header.payload.signature` 三段 base64url（RFC 4648 §5 无填充）：\n\n" +
      "- header：`{\"alg\":…,\"typ\":\"JWT\"}`，alg 决定签名算法；\n" +
      "- payload：你的数据（通常 JSON，RFC 7519 claims），只是编码不是加密；\n" +
      "- signature：对 `header.payload` 这个字符串签名——HS* 用 HMAC（RFC 7518 §3.2），RS256 用 RSA PKCS#1 v1.5 + SHA-256（§3.3），ES256 用 ECDSA P-256 + JOSE 定宽 r‖s（§3.4）。\n\n" +
      "与 JWT 的关系：JWT 把 JWS/JWE 串加 payload 语义；JWS 本身只管签名，不含 token 类型。本工具过 RFC 7515 A.2.1 官方向量（HS256 固定 JWS 逐字）。",
    usage: "payload JSON 进主输入框，选 alg，填密钥：HS* 填口令文本（长 base64url 形自动按字节解），RS256 填 n、d 两行，ES256 填 P-256 JWK JSON。可选额外 header 字段。",
    examples: [
      { in: '{"sub":"1234567890","name":"John Doe"}', param: "HS256, key=secret", out: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.Q6CM1qIz2WTgTlhMzpFL8jI8xbu9FFfj5DY_bGVY98Y", desc: "node 直跑真实输出（HS256 + secret）" },
    ],
    tips: [
      "header/payload 只是 base64url 编码——改中段（payload）后必须重签，否则第三段对不上。",
      "alg 是 header 里的字段，篡改 alg 是 CTF 经典：RS256→HS256 用公钥当 HMAC 密钥、alg=none 空签名等，验签端要按校验过的 alg 工作。",
      "HS* 的口令敏感：知道 secret 就能签任意 token，别用弱口令（可用 jwtCrack 爆）。",
    ],
    aka: ["jws签发", "jws sign", "json web signature", "rfc 7515", "jws生成", "jose签名", "hs256签发", "rs256签发", "es256签发", "jws token", "签名token", "jws encoding", "jws生成器"],
  },

  jwsVerify: {
    what: "JWS 验签：重算签名逐字节比对，输出合法/不合法 + payload + header 全字段。篡改任一字节即拒。",
    principle:
      "JWS 验签（RFC 7515 compact）：拆三段 base64url → 解码 header 看 alg → 用对应密钥对 `header.payload` 重算签名 → 与第三段逐字节比对。HS* 用 HMAC，RS256 用公钥 n/e 恢复 EM 再与期望 EMSA-PKCS1 比（逐字节找不一致），ES256 当前验签走 WebCrypto 待接（签名签发已支持）。\n\n" +
      "输出合法/不合法 + 原因（签名不匹配 / EM 与重算不一致），并附 header、payload 全字段解码，便于查参数错在哪。\n\n" +
      "支持 alg 自动识别（从 header 读），但密钥形态须与 alg 匹配（HS 口令 / RS 的 n,e 两行）。",
    usage: "完整 JWS 进主输入框，填密钥（与签发同形态：HS 口令 / RS256 的 n、e 两行）。",
    examples: [
      { in: "eyJhbGciOiJIUzI1NiIs…Q6CM1qIz…V98Y（jwsSign 产物）", param: "key=secret", out: "✓ 签名有效\nheader: {\"alg\":\"HS256\",\"typ\":\"JWT\"}\npayload: {\"sub\":\"1234567890\",\"name\":\"John Doe\"}", desc: "node 直跑真实输出" },
      { in: "同 JWS", param: "key=wrong", out: "✗ 签名无效（签名不匹配）", desc: "密钥错即拒" },
    ],
    tips: [
      "验签失败先看 header 的 alg 与实际用的是否一致——alg 是攻击面，别只信 header。",
      "RS256 比对的是恢复的 EM vs 重算 EMSA-PKCS1：不一致会指出「EM 与重算不一致」。",
      "严格校验应把 alg 锁定到白名单（防 alg 互换攻击），CTF 里常考这一步。",
    ],
    aka: ["jws验签", "jws verify", "json web signature验证", "rfc 7515验签", "jws校验", "验证jws", "jws signature verification", "jws decoding", "jws checker", "jws验证工具", "检查jws", "jws 签名验证"],
  },

  jweEncrypt: {
    what: "JWE 加密（RFC 7516 compact）：dir + AES-256-GCM——CEK 直接给 32B hex，密文用 A256GCM 加密，附认证标签。四段输出。",
    principle:
      "JWE（JSON Web Encryptiom，RFC 7516）compact 序列化为五段：`protected_header.encrypted_key.iv.ciphertext.tag`。本 op 用简化 peg：alg=dir（direct，CEK 即对称密钥）、enc=A256GCM（AES-256-GCM 认证加密）。\n\n" +
      "流程：header JSON → base64url（作 AAD）；ceK 32 字节 hex；随机 12 字节 IV；AES-256-GCM 加密明文，输出密文 + 16 字节 tag；encrypted_key 段为空（dir 模式不包装密钥）。\n\n" +
      "AES-GCM 认证加密：加密同时产认证标签，解密时标签不符直接拒——密文被改一个 bit 都逃不掉。与 RFC 7516 结构对齐；A 组 RSA-OAEP 向量用于结构验证（本 op 是 dir + A256GCM 的 A 组实测）。",
    usage: "明文进主输入框，填 CEK（32 字节 hex，A256GCM 直接内容加密密钥），可选额外 header 字段。",
    examples: [
      { in: "attack at dawn", param: "cek=606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f", out: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..2Iak9XKWM6MiSarF.w8fySw55EZYJdJiH4AQ.9bfr-REJvX5YjKuoYyCE_w", desc: "node 直跑真实输出（IV 随机，两次不同）" },
    ],
    tips: [
      "dir + A256GCM 是「共享密钥」加密：通信双方先用某种方式（如 ECDH）共享 CEK，再用它直接加密。",
      "五段中 encrypted_key 空是因为 dir 模式不包装密钥——看到 `..iv.ct.tag` 空第二段即 dir。",
      "IV 随机 12 字节：AES-GCM 的 nonce 绝不能重用（同 CEK 同 nonce 加两段明文会泄露）。",
    ],
    aka: ["jwe加密", "jwe encrypt", "json web encryption", "rfc 7516", "jwe生成", "dir a256gcm", "aes-256-gcm加密", "jose加密", "jwe token", "jwe加密器", "authenticated encryption jwe", "jwe message"],
  },

  jweDecrypt: {
    what: "JWE 解密（RFC 7516 compact，dir + A256GCM）：重算 GCM 认证标签，输出明文 + header 全字段；篡改任一段必拒。",
    principle:
      "JWE 解密：拆五段 → 解码 protected header 验 alg/enc（须 dir / A256GCM）→ 取 IV 与密文 → 用 CEK 对 header + IV + 密文 + tag 做 AES-256-GCM 解密与认证。\n\n" +
      "GCM 认证失败会抛异常（标签不符），工具转为明确报错「密文/IV/header 被篡改或 CEK 错误」，不会静默给伪明文。\n\n" +
      "输出明文与解码后的 header JSON。CEK 是那个 32 字节对称密钥（须与加密一致）。",
    usage: "完整 JWE 进主输入框，填 CEK（32B hex）。",
    examples: [
      { in: "eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..2Iak9XKWM6MiSarF.w8fySw55EZYJdJiH4AQ.9bfr-REJvX5YjKuoYyCE_w", param: "cek=60616263…7e7f", out: "=== JWE 解密成功 ===\nheader: {\"alg\":\"dir\",\"enc\":\"A256GCM\"}\nattack at dawn", desc: "node 直跑真实输出，与 JWE 加密卡配套" },
      { in: "改末段一字符", param: "同 CEK", out: "JWE 解密失败：GCM 认证标签不符（密文/IV/header 被篡改或 CEK 错误）", desc: "篡改即拒" },
    ],
    tips: [
      "CEK 必须与加密时完全一致（32 字节）；不对则 GCM 标签不符。",
      "tag 段是完整性保证：任何一段（含 header、IV）被改都会在解密时被认证拦截。",
      "JWE 与 JWS 区别：JWE 加密（保密），JWS 仅签名（完整性），本族题先分清是加密还是签名。",
    ],
    aka: ["jwe解密", "jwe decrypt", "json web encryption解密", "rfc 7516解密", "jwe解码", "aes-256-gcm解密", "jose解密", "jwe校验", "jwe解密器", "解jwe token", "jwe untoken"],
  },

  pasetoV4Sign: {
    what: "PASETO v4.public 签发：payload JSON + Ed25519 私钥 hex（64B 种子‖公钥）+ 可选 footer/implicit → v4.public token。",
    principle:
      "PASETO（Platform-Agnostic Security Tokens）v4.public 是「非对称」版本，签名用 Ed25519（RFC 8032）。格式 `v4.public.payload.signature[.footer]`，版本与目的各一段 base64url。\n\n" +
      "PAE（Pre-Authentication Encoding）做域分离（协议规范 §3）：`PAE([\"v4.public.\", payload, footer, implicit])` 把各段长度显式编码，防「截断/拼接」攻击——这是 PASETO 比手写 JWT 更安全的点。\n\n" +
      "v4.public 用 Ed25519 的 64 字节私钥（32 字节种子 + 32 字节公钥，标准 libsodium-like 形态）。payload 是 JSON 但签的是规范化字符串（工具会 try 重排 JSON）。本 op 支持 v4.public（v4.local 用 XChaCha20 暂不支持，desc 已注明）。",
    usage: "payload JSON 进主输入框，填 Ed25519 私钥 64 字节 hex、footer（JSON 或文本可空）、implicit assertion（可空）。",
    examples: [
      { in: '{"sub":"test","iat":1577836800}', param: "skHex=22a3f972…3f4f（64B）", out: "v4.public.eyJzdWIiOiJ0ZXN0IiwiaWF0IjoxNTc3ODM2ODAwfQ.aG2JB9xWzkkLfzOd0dw-mR9KOnivIKz_JOv44A80704WKO4l1UkgsyKnBOP075r4gI30N0VVvQ69HYYGbgHMAA", desc: "node 直跑真实输出" },
    ],
    tips: [
      "PASETO 与 JWT 的核心差异：版本化 + PAE 域分离 + 明确不允许 alg=none 等历史坑，号称「更不容易用错」。",
      "payload 仍是明文 base64url——v4.public 只保证签名，不加密；要保密用 v4.local（对称）。",
      "私钥 64 字节 = 种子‖公钥：与 32 字节裸种子的 Ed25519 私钥可转换，但 PASETO 标准用 64 字节形态。",
    ],
    aka: ["paseto签发", "paseto v4 sign", "paseto公钥签名", "v4.public", "paseto token生成", "paseto签名", "ed25519 token", "paseto v4.public", "paseto maker", "platform-agnostic security tokens", "paseto signing", "paseto token"],
  },

  pasetoV4Verify: {
    what: "PASETO v4.public 验签：token + Ed25519 公钥（32B hex）→ 合法/不合法 + payload + footer；PAE 域分离防拼接。",
    principle:
      "验签：拆 v4.public 的段（段数须 4 或 5，footer 可选），解出 payload 字节与签名；用 Ed25519 公钥对 `PAE([\"v4.public.\", payload, footer, implicit])` 验签名——PAE 把段与长度编码进去，不能像无域分离方案那样去拼接段。\n\n" +
      "公钥 32 字节 hex 必须精确；implicit assertion 若签发时用了，验签时也必须一致。\n\n" +
      "输出 ✓/✗ + payload JSON + footer 存在与否。篡改 payload/footer/signature 任一段都过不了。",
    usage: "完整 PASETO token 进主输入框，填 Ed25519 公钥 32 字节 hex、implicit（可空，须与签发一致）。",
    examples: [
      { in: "v4.public.eyJzdWIiOiJ0ZXN0IiwiaWF0IjoxNTc3ODM2ODAwfQ.aG2JB9xWzkkLfzOd0dw-mR9KOnivIKz_JOv44A80704WKO4l1UkgsyKnBOP075r4gI30N0VVvQ69HYYGbgHMAA", param: "pkHex=60120280…89ae（32B）", out: "✓ 签名有效\npayload: {\"sub\":\"test\",\"iat\":1577836800}\nfooter: (无)", desc: "node 直跑真实输出（公钥须与私钥对应）" },
    ],
    tips: [
      "公钥与私钥务必配套：Ed25519 公钥由私钥种子推导，拿错公钥必验签失败。",
      "payload 是 base64url 明文——任何人都能读，验签只证明真实性不保密。",
      "PASETO 比 JWT 的一个强项是它「版本化 + 强制 PAE」；做题时若攻击 JWT 失败可试 PASETO 的 v4.local 对称类（本工具暂不覆盖）。",
    ],
    aka: ["paseto验签", "paseto v4 verify", "paseto公钥验签", "v4.public验签", "paseto校验", "验证paseto", "ed25519验签token", "paseto token验证", "paseto checker", "paseto verify signature", "paseto 解密读"],
  },

  mldsaKeyGen: {
    what: "ML-DSA 密钥生成：FIPS 204（后量子签名，源自 CRYSTALS-Dilithium）ML-DSA-44/65/87，种子 ξ 可固定复现。",
    principle:
      "ML-DSA（Module-Lattice-Based Digital Signature Algorithm）是 NIST 2024 年定稿的 FIPS 204 后量子签名标准，前身是 CRYSTALS-Dilithium（NIST 后量子竞赛胜者）。名字里的 ML 指向 Module Lattice，安全性基于格上困难问题，量子计算机也无好算法。\n\n" +
      "密钥生成：种子 ξ 经 SHAKE/SHA-3 扩展（FIPS 204 §6.1）生成 $\\rho$（公钥头）、$K$（签名随机性种子）、$tr$（域分离）与秘密向量 $s_1, s_2$、$t_0$。公钥 pk = $\\rho \\| t_1$，私钥 sk = $\\rho \\| K \\| tr \\| s_1 \\| s_2 \\| t_0$。\n\n" +
      "参数集 ML-DSA-44/65/87 对应 NIST 强度 Level 2/3/5（≈AES-128/192/256）。本工具纯 JS 实现毫秒级；种 ξ 可固定（教学复现），留空随机。",
    usage: "选参数集（44/65/87，44 档最快），种子 ξ 32 字节 hex 可填（留空随机）。输出 pk 与 sk（hex，可下载）。",
    examples: [
      { in: "（空输入，直接运行）", param: "set=44, zeta=00112233…eeff（32B 固定）", out: "参数集: ML-DSA-44 (k=4,l=4,η=2,τ=39,γ1=2^17,γ2=(q-1)/88,ω=80,β=78) / 公钥 pk (1312 B) = 07414384…1917 / 私钥 sk (2560 B) = 07414384…4fc0 / 种子 ξ = 00112233…eeff", desc: "node 直跑真实输出；种子固定则完全可复现" },
    ],
    tips: [
      "pk/sk 长度是指纹：44 档 pk=1312B/sk=2560B、签名 2420B；65 档更大（pk 1952B）；87 档最大。",
      "ML-DSA 已随 Chrome/OpenSSH/Signal 部署做后量子混合签名——流量分析题可能遇到。",
      "真实用 ξ 必须 CSPRNG 随机；固定种子只配教学演示。",
    ],
    aka: ["ml-dsa", "ml-dsa密钥生成", "mldsa keygen", "dilithium", "crystals-dilithium", "ml-dsa-44", "fips 204", "后量子签名", "post-quantum signature", "pqc签名", "格密码签名", "module lattice签名", "抗量子签名", "ml-dsa 密钥生成"],
  },

  mldsaSign: {
    what: "ML-DSA 签名：私钥 sk + 消息 + 上下文 ctx → 签名 σ。hedged 随机 or 确定性 rnd=0；Fiat-Shamir with aborts。",
    principle:
      "ML-DSA 签名是 Fiat-Shamir with aborts 结构（FIPS 204 §5.3）：对消息哈希出挑战 c，用秘密向量 $s_1, s_2$ 算候选 $z$，若 $\\|z\\|_\\infty$ 超界或 hint 不满足则「拒绝」重采——所以才叫 with aborts（拒绝采样）。c 的挑战封装在 c̃（对 c 再编码哈希，32B）。\n\n" +
      "随机性：hedged（默认）用随机 rnd（§5.4 推荐，防侧信道）；确定性 rnd=0 可复现（教学）。输出含拒绝采样轮数与 c̃、hint 数。\n\n" +
      "签名 σ = c̃ ‖ z ‖ h（z 与 hint 编码）。上下文 ctx 是域分隔符（≤255B），须与验签一致。本工具过 FIPS 204 ACVP 官方向量。",
    usage: "消息（text/hex）+ 私钥 sk（hex）+ 上下文 ctx + 参数集，随机性选 hedged / 确定性。",
    examples: [
      { in: "sample", param: "set=44, sk=（密钥生成产物）, rndMode=det", out: "消息 M: 6 B（UTF-8） / 随机性 rnd: 0000…0000（确定性 rnd=0） / 拒绝采样轮数: 3（Fiat–Shamir with aborts） / 签名 σ (2420 B = c̃32 + z2304 + h84) = …", desc: "node 直跑真实输出" },
    ],
    tips: [
      "签名长度随档位：44 档 2420B，65 档 3309B，87 档 4627B——长度可反推档位。",
      "拒绝采样轮数反映签名计算成本；轮数高说明运气不好重采多。",
      "ctx 必须与验签完全一致（包括空 vs 非空），否则验签必失败——域分隔的设计。",
    ],
    aka: ["ml-dsa签名", "mldsa sign", "dilithium签名", "后量子签名生成", "fips 204签名", "ml-dsa-44签名", "格密码签名", "pqc签名", "fiat-shamir签名", "ml-dsa sign", "抗量子签名生成", "ml-dsa 签名"],
  },

  mldsaVerify: {
    what: "ML-DSA 验签：pk + 消息 + 签名 → 合法/不合法（含 sigDecode 严格结构检查、‖z‖∞ 与 hint 上限校验、c̃ 重算比对）。",
    principle:
      "ML-DSA 验签（FIPS 204 §5.5）：对签名做严格的 sigDecode（结构/长度检查），校验 $\\|z\\|_\\infty \\le \\gamma_1 - \\beta$ 与 hint 数 `≤ ω`，重算挑战 c̃ 并与签名携带的 c̃ 比对——一致才合法。\n\n" +
      "参数集须与签发一致（pk/sig 长度按档位校验）。输出会给出签名长度是否匹配、hint 数、‖z‖∞ 与上限、结论。\n\n" +
      "它是结构化校验：不合法会报具体原因（如「签名长度不符」「c̃ 重算不符（挑战不匹配）」）。",
    usage: "消息 + 公钥 pk（hex）+ 签名 σ（hex）+ 上下文 ctx + 参数集（须与签发一致）。",
    examples: [
      { in: "sample + ML-DSA-44 签名产物", param: "set=44, pk=（密钥生成产物）, sig=（签名产物）", out: "签名长度: 2420/2420 B ✓ / hint 数: 65 / ‖z‖∞ = 130835（上限 γ1−β = 130994） / 结论: ✓ 合法（验证通过） — c̃ 重算一致（Fiat–Shamir 挑战匹配）", desc: "node 直跑真实输出" },
      { in: "同签名改消息 sample2", param: "同 pk/set", out: "结论: ✗ 不合法 — c̃ 重算不符（挑战不匹配）", desc: "篡改即拒" },
    ],
    tips: [
      "验签失败先看「签名长度不符」还是「c̃ 重算不符」：前者多半参数集/私钥档位不符，后者消息或签名被改。",
      "「合法」只证明签名与 (消息, 公钥) 匹配，公钥身份另由证书/密钥管理保证。",
      "ML-DSA 验证是全结构校验，别只比对签名首尾——它是格签名，c̃/z/h 任一环节错都拒。",
    ],
    aka: ["ml-dsa验签", "mldsa verify", "dilithium验签", "后量子验签", "fips 204验签", "ml-dsa签名验证", "格密码验签", "pqc验签", "抗量子验签", "mldsa verification", "ml-dsa verify signature"],
  },

  slhdsaKeyGen: {
    what: "SLH-DSA 密钥生成：FIPS 205（后量子哈希签名，源自 SPHINCS+）SLH-DSA-SHA2-128s/128f/192s/256s，种子 3n 字节可固定。",
    principle:
      "SLH-DSA（Stateless Hash-Based Digital Signature Algorithm）是 NIST 2024 定稿的 FIPS 205 后量子签名标准，前身是 SPHINCS+。它不是格密码而是纯哈希树签名（stateful 的是 XMSS/LMS，SLH-DSA 是 stateless）。\n\n" +
      "结构：WOTS+（w=16 链式哈希，§8）+ FORS（t 参数树，§9）+ hypertree（XMSS 层 d/T，§10.1），全用 SHA-2 族（SHA2 变体）。密钥生成（Alg 18）把 3n 字节种子（SK.seed‖SK.PRF‖PK.seed）扩展，顶层子树建房 $2^{\\text{树高}}$ 个 WOTS 叶子。\n\n" +
      "公钥很小（32-64B = PK.seed‖top-root），私钥 48-96B。参数集 128s/128f/192s/256s 覆盖不同安全级（128f 快但签名大 17088B，128s 慢但签名 7856B）。本工具纯 JS，秒级起。",
    usage: "选参数集（128f 最快示例合适），种子 3n 字节 hex 可填（留空随机）。输出 pk/sk（hex，可下载）。",
    examples: [
      { in: "（空输入，直接运行）", param: "set=128f, seed=001122…eeff（48B 固定）", out: "参数集: SLH-DSA-SHA2-128f (n=16,h=66,d=22,FORS_H=6,FORS_T=33,树高=3,WOTS_LEN=35) / 公钥 pk (32 B) = 00112233…df49 / 私钥 sk (64 B) = 00112233…df49", desc: "node 直跑真实输出；种子固定则完全可复现" },
    ],
    tips: [
      "SLH-DSA 公钥极小（32/48/64B）但签名巨大（7.8KB-29KB），与 ML-DSA 的「大公钥小签名」相反——签名长度可反推是哈希系还是格系。",
      "128s/192s/256s 生成慢（秒级起甚至更久），128f 快但签名大 17088B——示例/对拍用 128f。",
      "SLH-DSA 是 stateless 哈希签名，适合担心格密码不确定性的场景。",
    ],
    aka: ["slh-dsa", "slh-dsa密钥生成", "slhdsa keygen", "sphincs+", "sphincs plus", "slh-dsa-128s", "slh-dsa-128f", "fips 205", "后量子哈希签名", "哈希签名", "hash-based signature", "stateless签名", "抗量子签名哈希", "slh-dsa 密钥生成"],
  },

  slhdsaSign: {
    what: "SLH-DSA 签名：私钥 sk + 消息 + 上下文 ctx → 签名 σ。hedged 随机 or 确定性；纯哈希树 WOTS+/FORS/hypertree 逐层建房。",
    principle:
      "SLH-DSA 签名（FIPS 205 §10.2，Alg 21/22）：确定性版本 R = HMAC(sk_prf, addr‖0x00‖|ctx|‖ctx‖M)，再用 R 派生 FORS 树叶密钥选择、由 hypertree 逐层签出 WOTS+ 链——各层经认证路径连接回 root，构成一棵随时可验的哈希树。\n\n" +
      "输出 σ = R ‖ FORS 签名 ‖ hypertree 各层 WOTS+ 签名与认证路径（长度按参数集，128f 为 17088B）。\n\n" +
      "hedged 用随机 rnd（防侧信道），确定性（rnd=空）可复现。生成耗时：128s 秒级起、128f 较快但签名大。本工具过 FIPS 205 ACVP 官方向量。",
    usage: "消息（text/hex）+ 私钥 sk（hex）+ 上下文 ctx + 参数集，随机性 hedged / 确定性。示例用 128f。",
    examples: [
      { in: "sample", param: "set=128f, sk=（密钥生成产物）, rndMode=det", out: "签名 σ (17088 B = R16 + FORS1536 + 22×(WOTS700+auth48)) = 34176 hex 字符… + 注: 128s/192s/256s 生成慢（秒级起），128f 快但签名大", desc: "node 直跑真实输出" },
    ],
    tips: [
      "签名时长与参数集强相关：128f 快、128s/192s/256s 慢；示例/对拍优先 128f。",
      "ctx 是域分隔符（≤255B），签发与验签必须逐字节一致。",
      "哈希树签名是 deterministic 主（rnd 可固定），同钥同文可复现——但别把可复现当 bug。",
    ],
    aka: ["slh-dsa签名", "slhdsa sign", "sphincs+签名", "后量子哈希签名生成", "fips 205签名", "slh-dsa-128f签名", "哈希签名生成", "stateless签名", "slhdsa signing", "抗量子签名生成哈希", "slh-dsa sign"],
  },

  slhdsaVerify: {
    what: "SLH-DSA 验签：pk + 消息 + 签名 → 合法/不合法（FORS+HT 路径重算根节点比对公钥根）；签名长度不符直接判非法。",
    principle:
      "SLH-DSA 验签（FIPS 205 §10.2，Alg 23/24）：先做签名长度/结构检查（不符直接判非法）；从签名中取 R，重建 FORS 树与 hypertree 各层路径，逐层哈希重算根节点，与公钥里的 top-root 比对——一致才合法。\n\n" +
      "根节点重算是纯哈希运算（SHA-2 族），因此验签稳定、无条件真，不依赖格假设。\n\n" +
      "输出会给出签名长度是否匹配与结论（根节点重算一致/不符）。",
    usage: "消息 + 公钥 pk（hex）+ 签名 σ（hex）+ 上下文 ctx + 参数集（须与签发一致）。",
    examples: [
      { in: "sample + SLH-DSA-128f 签名产物", param: "set=128f, pk=（密钥生成产物）, sig=（签名产物）", out: "签名长度: 17088/17088 B ✓ / 结论: ✓ 合法（验证通过） — 根节点重算与公钥一致（哈希树验证通过）", desc: "node 直跑真实输出" },
      { in: "同签名改消息 sample2", param: "同 pk/set", out: "结论: ✗ 不合法 — 根节点重算不符（哈希树验证失败）", desc: "篡改即拒" },
    ],
    tips: [
      "签名长度不符首查参数集/签名是否配套（128f=17088B 与 128s=7856B 差很多）。",
      "验证靠哈希树重算，不含格假设，故比 ML-DSA 更「确定性」——对拍结果稳定。",
      "「合法」只证明签名与 (消息, 公钥) 匹配，公钥身份另靠密钥管理。",
    ],
    aka: ["slh-dsa验签", "slhdsa verify", "sphincs+验签", "后量子哈希验签", "fips 205验签", "slh-dsa-128f验签", "哈希签名验证", "stateless验签", "slhdsa verification", "抗量子验签哈希", "slh-dsa verify signature"],
  },
};
