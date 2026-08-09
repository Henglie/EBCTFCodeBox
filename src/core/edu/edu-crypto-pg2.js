/*
 * edu-crypto-pg2.js — 科普补缺分片，密码学扩展第二批次。
 *
 * 覆盖 9 个 op 的科普卡：
 * modern: present
 * hash:   siphash, blake3, whirlpool, pearson
 * crypto: scrypt
 * analysis: xorshiftRecover
 * text:   yenc, binhex
 *
 * 纯数据无副作用，无 import 无 register。M 在 eduContent.js 归并。
 * EduEntry 格式照 eduContent.js 头注释契约。
 */
export default {
	// ============ modern: PRESENT 轻量分组密码 ============
	present: {
		what: "PRESENT——专为物联网等资源受限设备设计的超轻量分组密码（ISO/IEC 29192-2 标准）。64 位块、80 或 128 位密钥，31 轮 SPN 结构。",
		principle:
			"PRESENT 是典型的 SPN（代换-置换网络）分组密码，31 轮迭代。\n\n" +
			"轮函数：每轮包含三层操作——addRoundKey（轮密钥与状态异或）、sBoxLayer（16 个 4 位 S 盒并行查表）、pLayer（64 位按位置换，bit i → bit P(i)）。\n\n" +
			"密钥编排：80 位密钥存于 80 位寄存器 K，每轮取 K 的高 64 位作轮密钥，然后 K 左旋 61 位、高 4 位经 S 盒、轮数计数器异或到特定位。128 位密钥类似但寄存器更宽。\n\n" +
			"S 盒：4 入 4 出，十六进制表 {c,5,6,b,9,0,a,d,3,e,f,8,4,7,1,2}，精心选择以抵抗线性/差分攻击。\n\n" +
			"加解密：加密走正向 31 轮；解密走逆序 31 轮，用逆 S 盒和逆 P 置换。",
		usage: "参数 keyBits 选 80 或 128 位，key 填对应长度 hex（80 位 = 20 hex，128 位 = 32 hex）。输入框填 16 位 hex 明文块。编码输出 hex 密文，解码填同样 key 即可还原。",
		examples: [
			{ in: "0000000000000000", param: "keyBits=80, key=00000000000000000000", out: "5579c1387b228445", desc: "80 位全零密钥加密全零明文块，标准测试向量" },
		],
		formulas: [
			{ tex: "P(i) = \\begin{cases} i \\cdot 16 \\bmod 63, & i < 63 \\\\ 63, & i = 63 \\end{cases}", caption: "PRESENT 的 pLayer 位置换函数：bit i 移到 bit P(i)" },
		],
		tips: [
			"PRESENT 块大小 64 位（16 hex），输入必须是 16 hex 字符。",
			"keyBits 80 时 key 必须 20 hex，keyBits 128 时 key 必须 32 hex。",
			"SPN 结构意味着每个 bit 经过 31 轮置换后充分扩散，暴力破解不可行。",
			"CTF 里题目给 PRESENT 密钥 + 分组密文时，直接填 key 解码即可。",
		],
		aka: ["PRESENT", "轻量密码", "SPN", "IoT密码", "PRESENT-80", "PRESENT-128", "ISO 29192", "分组密码", "物联网加密", "超轻量密码", "31轮SPN", "ISO 29192-2", "PRESENT cipher", "PRESENT算法", "Bochum", "Orange Labs", "RUHR", "轻量级加密", "资源受限加密", "PRESENT加密"],
	},

	// ============ hash: SipHash 键控 PRF ============
	siphash: {
		what: "SipHash——短输入消息的键控伪随机函数（PRF），Aumasson 和 Bernstein 设计（2012）。16 字节密钥 + ARX 压缩，输出 64 位，常用于哈希表 DoS 防护。",
		principle:
			"SipHash 使用 ARX（加-旋转-异或）结构，核心是 SipRound 轮函数。内部状态 256 位（v0, v1, v2, v3），每个 SipRound 对相邻两个字做 ARX 混合：\n\n" +
			"v0 += v1; v1 <<<= 13; v1 ^= v0; v0 <<<= 32;\n" +
			"v2 += v3; v3 <<<= 16; v3 ^= v2;\n" +
			"v0 += v3; v3 <<<= 21; v3 ^= v0;\n" +
			"v2 += v1; v1 <<<= 17; v1 ^= v2; v2 <<<= 32;\n\n" +
			"初始化：把 16 字节密钥 k 拆分混入 v0..v3，加上常数。压缩阶段：每 8 字节消息块混入 v3，然后做 2 轮 SipRound（c 次）；最后一块特殊处理（加长度在末字节最高位）。终结阶段：v2 ^= 0xff，做 4 轮 SipRound（d 次）。\n\n" +
			"SipHash-c-d 指压缩阶段 c 轮、终结阶段 d 轮。标准是 SipHash-2-4，本工具支持 SipHash-1-3 和 SipHash-2-4。输出为小端 64 位 hash。",
		usage: "输入框填消息，参数 variant 选 2-4 或 1-3，key 填 32 位 hex（16 字节），默认 000102030405060708090a0b0c0d0e0f。inputMode 选输入格式（text/hex/base64）。输出为 16 位小端 hex。",
		examples: [
			{ in: "", param: "variant=2-4, key=000102030405060708090a0b0c0d0e0f, inputMode=text", out: "310e0edd47db6f72", desc: "标准测试向量：空消息、全递增 key，SipHash-2-4" },
		],
		formulas: [
			{ tex: "v_0 \\mathrel{+}= v_1;\\ v_1 \\lll 13;\\ v_1 \\mathrel{\\oplus}= v_0;\\ v_0 \\lll 32", caption: "SipRound 对 (v0,v1) 的半轮 ARX 操作" },
		],
		tips: [
			"key 必须 16 字节（32 hex），否则报错。",
			"SipHash-2-4 是标准变体，SipHash-1-3 更快但安全性稍低。",
			"输出为小端字节序的 64 位（8 字节），显示为 16 hex 字符。",
			"CTF 常见：给了 key 和明文，要求计算 SipHash → 直接填参数输出 hex。",
		],
		aka: ["SipHash", "键控哈希", "PRF", "SipHash-2-4", "短哈希", "MAC", "哈希表键", "伪随机函数", "64位哈希", "ARX哈希", "DoS防护", "短签名", "SipHash-1-3", "Aumasson", "Bernstein", "SipHash算法", "键控伪随机", "消息认证", "哈希函数", "SipHash64"],
	},

	// ============ crypto: scrypt 内存硬化 KDF ============
	scrypt: {
		what: "scrypt——Colin Percival 设计的密钥派生函数（RFC 7914），用大量内存 + 大规模迭代让暴力破解在 GPU/FPGA/ASIC 上成本极高。",
		principle:
			"scrypt（RFC 7914）的核心是内存硬化（Memory-hard）：强制派生过程必须占用大量 RAM，让并行暴力破解的硬件成本高不可攀。\n\n" +
			"算法流程：\n" +
			"1. PBKDF2-HMAC-SHA256 预处理：pass + salt 经 PBKDF2(c=1, dkLen=p*128*r) 输出初始字节。\n" +
			"2. BlockMix：把输出切成 2r 个 64 字节块，用 Salsa20/8 核心做 r 次混合（BlockMix 即 ROMix_v1 内循环）。\n" +
			"3. ROMix：BlockMix 迭代 N 次，每次需读取前一输出生成新块，所有 N 块必须存于内存中（这就是 N*r*128 字节的内存需求）。\n" +
			"4. 后处理：PBKDF2-HMAC-SHA256 对 ROMix 输出再迭代 1 次，生成最终 dkLen 字节密钥。\n\n" +
			"参数含义：N = 迭代次数（2 的幂，决定内存量，越大越安全越慢）；r = 块大小因子；p = 并行因子。内存用量约 N * r * p * 128 字节。",
		usage: "输入框填口令（passEnc 选格式），参数 salt 填盐值、saltEnc 选格式、N 填 2 的幂（默认 16384）、r 填块大小（默认 8）、p 填并行度（默认 1）、dkLen 填输出字节数（默认 32）。输出为 hex 串。",
		examples: [
			{ in: "password", param: "passEnc=utf8, salt=NaCl, saltEnc=utf8, N=1024, r=8, p=16, dkLen=64, hash=SHA-256", out: "fdbabe1c9d34790e5374f2f25c9cc9d2ae0514a823cac3ae5777be738eb6367fbec858f6dd49d71cfedd5abadba63e38767c4d7c2f0fad84c13f92e67f7f3e6a", desc: "标准测试向量：N=1024 r=8 p=16 dkLen=64，对拍 Node scryptSync ✓" },
		],
		formulas: [
			{ tex: "\\text{scrypt}(P,S,N,r,p,dkLen) = \\text{PBKDF2}(\\text{ROMix}(\\text{PBKDF2}(P,S,1,p\\cdot128r), N), S, 1, dkLen)", caption: "scrypt 的结构：PBKDF2 前后夹 ROMix" },
		],
		tips: [
			"scrypt 参数越大越慢，N=16384 r=8 p=1 是常用安全参数，CTF 里题目常给小值。",
			"N 必须是 2 的幂（2^x），填非幂值自动修正。",
			"同口令同盐同参数产出同密钥，key stretching 的效果全来自 N 的规模。",
		],
		aka: ["scrypt", "RFC 7914", "内存硬化", "密钥派生", "KDF", "scrypt派生", "抗ASIC", "口令哈希", "scrypt密钥", "强哈希", "Colin Percival", "Tarsnap", "scrypt加密", "scrypt算法", "内存密集型", "密码学KDF", "scrypt KDF", "多轮PBKDF2", "防暴力破解", "硬件不友好"],
	},

	// ============ hash: BLAKE3 加密哈希 ============
	blake3: {
		what: "BLAKE3——Jack O'Connor 等设计的下一代高速加密哈希（2020）。基于 Bao tree 二叉哈希树 + 简化版 ChaCha 轮函数，原生支持并行和可扩展输出（XOF）。",
		principle:
			"BLAKE3 的核心创新是用二叉哈希树（Bao tree）代替 Merkle-Damgard 链式结构，天然适合 SIMD 并行和增量更新。\n\n" +
			"压缩函数：对 16 个 32 位字 + 参数块（chaining value、消息块、计数器、flags）做 7 轮简化 ChaCha 轮函数（quarter round 的 4 字混合：a+=b, d=(d^a)<<<16, c+=d, b=(b^c)<<<12, a+=b, d=(d^a)<<<8, c+=d, b=(b^c)<<<7），每轮操作列和对角线。\n\n" +
			"树结构：叶子层每 1024 字节一块，父层对子节点 CV（chaining value）压缩。所有层并行计算后根 CV 即为 hash。\n\n" +
			"XOF（可扩展输出）：从根 CV 继续输出任意长度 hash，只需迭代计数器递增，天然支持。\n\n" +
			"BLAKE3 比 SHA-3 快约 10-20 倍（单线程），多线程线性加速。",
		usage: "输入框填消息，参数 inputMode 选 text/hex、outLen 填输出字节数（默认 32，XOF 模式可填任意值）。跑运算输出 hex 串，完全单向。",
		examples: [
			{ in: "abc", param: "inputMode=text, outLen=32", out: "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85", desc: "BLAKE3 官方测试向量：'abc' → 32 字节输出" },
		],
		formulas: [
			{ tex: "a \\mathrel{+}= b;\\ d = (d \\oplus a) \\lll 16;\\ c \\mathrel{+}= d;\\ b = (b \\oplus c) \\lll 12;\\ a \\mathrel{+}= b;\\ d = (d \\oplus a) \\lll 8;\\ c \\mathrel{+}= d;\\ b = (b \\oplus c) \\lll 7", caption: "BLAKE3 的 Quarter Round（7 轮，每轮 4 次 QR）" },
		],
		tips: [
			"BLAKE3 通过 Bao tree 实现并行：大文件可多线程同时哈希不同块。",
			"outLen 任意值（XOF），同样输入不同 outLen 输出是前缀关系（短输出 = 长输出的前缀）。",
			"CTF 里出现 BLAKE3 哈希直接填输入验证，官方 10 组向量全过。",
		],
		aka: ["BLAKE3", "Bao tree", "加密哈希", "XOF", "BLAKE", "高速哈希", "blake3哈希", "可扩展输出", "树哈希", "并行哈希", "BLAKE3算法", "O'Connor", "Aumasson", "Neves", "Wilcox", "BLAKE family", "SHA-3替代", "下一代哈希", "SIMD哈希", "二叉哈希树"],
	},

	// ============ hash: Whirlpool 512 位哈希 ============
	whirlpool: {
		what: "Whirlpool——Barreto 和 Rijmen 设计的 512 位加密哈希（ISO/IEC 10118-3 标准，NESSIE 推荐）。Miyaguchi-Preneel 模式 + 10 轮 AES 风格分组密码，输出 512 位（128 hex）。",
		principle:
			"Whirlpool 的核心是类 AES 的 512 位分组密码 W，以 Miyaguchi-Preneel 单程压缩模式构建哈希：\n\n" +
			"$$H_{i} = H_{i-1} \\oplus W_{H_{i-1}}(M_i) \\oplus M_i$$\n" +
			"即前态 H_{i-1} 做密钥、消息块 M_i 做输入、压缩后同时异或回密钥和明文（增强抗碰撞）。\n\n" +
			"分组密码 W 内部是 8×8 字节矩阵（64 字节 = 512 位状态），10 轮迭代替换-置换：SubBytes（8 位 S 盒，与 AES 不同）、ShiftColumns（列内字节循环移位）、MixRows（行乘 MDS 矩阵）、AddRoundKey（轮密钥异或）。\n\n" +
			"消息填充遵循 Merkle-Damgard 规则（补 1 + 若干 0 + 256 位长度），分 512 位块逐块压缩。最终输出 512 位摘要。",
		usage: "输入框填消息，参数 inputMode 选 text/hex。无密钥，直接跑输出 128 hex 字符摘要，完全单向。",
		examples: [
			{ in: "", param: "inputMode=text", out: "19fa61d75522a4669b44e39c1d2e1726c530232130d407f89afee0964997f7a73e83be698b288febcf88e3e03c4f0757ea8964e59b63d93708b138cc42a66eb3", desc: "Whirlpool 空串测试向量" },
			{ in: "abc", param: "inputMode=text", out: "4e2448a4c6f486bb16b6562c73b4020bf3043e3a731bce721ae1b303d97e6d4c7181eebd1a6f2abb91d5a0cbc0d7d1a663b4d07bdf1f0b8bcb16d5d3ec7b5e93", desc: "'abc' 测试向量，对拍 python hashlib ✓" },
		],
		formulas: [
			{ tex: "H_i = H_{i-1} \\oplus W_{H_{i-1}}(M_i) \\oplus M_i", caption: "Whirlpool 的 Miyaguchi-Preneel 单程压缩模式" },
		],
		tips: [
			"Whirlpool 输出 512 位（128 hex 字符），是少数几种非 SHA 的 ISO 标准哈希。",
			"和 SHA-512 结构相似但 S 盒/轮变换完全不同，二者中间态不可互换。",
			"CTF 里见到非 SHA 的长哈希输出（128 hex），大概率是 Whirlpool。",
		],
		aka: ["Whirlpool", "ISO 10118", "NESSIE", "512位哈希", "Barreto", "Rijmen", "Miyaguchi-Preneel", "漩涡哈希", "whirlpool哈希", "ISO标准哈希", "Whirlpool算法", "ISO/IEC 10118-3", "512位摘要", "whirlpool hash", "AES风格哈希", "漩涡算法", "Paulo Barreto", "Vincent Rijmen", "NEW欧洲签名", "单程压缩哈希"],
	},

	// ============ hash: Skein SHA-3 决赛候选哈希 ============
	skein: {
		what: "Skein——NIST SHA-3 决赛五强之一（Ferguson 等七人设计，2010 提交）。基于自家的 Threefish 可调分组密码，以 Miyaguchi-Preneel 模式构建，SHA-3 决赛圈里以极快速度著称。支持 Skein-256/512/1024 三种状态（32/64/128 字节块）与 224~1024 位多种输出。",
		principle:
			"Skein 的压缩函数就是 Threefish：把当前链值 X（如 8 个 64 位字）当密钥、消息块 M_i 当明文、tweak（[T0,T1] = 长度计数器 + 块类型/首末标志）当调节值，加密后与明文异或回馈（Miyaguchi-Preneel）：\n\n" +
			"$$X_{i} = \\mathrm{Threefish}_{X_{i-1},\\ T_0,T_1}(M_i) \\oplus M_i$$\n\n" +
			"块类型字段（MSG/OUT/CFG）和 FINAL/FIRST 标志嵌在 tweak 高位，输出阶段用同一压缩跑 counter 模式逐块产出摘要。",
		usage: "选 variant（状态-输出位，如 Skein-512-512），inputMode 选 text/hex。输入消息输出摘要 hex。CTF 里见到既非 MD5 系也非 SHA 系的长哈希，可试 Skein。",
		examples: [
			{ in: "", param: "variant=512-512, inputMode=text", out: "bc5b4c50925519c290cc634277ae3d6257212395cba733bbad37a4af0fa06af41fca7903d06564fea7a2d3730dbdb80c1f85562dfcc070334ea4d1d9e72cba7a", desc: "Skein-512-512 空串官方向量" },
			{ in: "abc", param: "variant=512-512, inputMode=text", out: "8f5dd9ec798152668e35129496b029a960c9a9b88662f7f9482f110b31f9f93893ecfb25c009baad9e46737197d5630379816a886aa05526d3a70df272d96e75", desc: "Skein-512-512 对 abc，C 参考 oracle 输出" },
		],
		formulas: [
			{ tex: "X_i = \\mathrm{Threefish}_{X_{i-1},T_0,T_1}(M_i) \\oplus M_i", caption: "Skein 的 Miyaguchi-Preneel 压缩（Threefish 做分组密码）" },
		],
		tips: [
			"Skein 与 Threefish 同核：Threefish 做压缩、Skein 只是套 Merkle-Damgard 外壳 + counter 输出。",
			"SHA-3 决赛五强（Keccak/Blake/Skein/Grøstl/JH）里 Skein 速度最快，但最终 Keccak 胜出。",
			"tweak 里的块类型是 Skein 特色：CFG/KEY/MSG/OUT 分阶段，天然支持 tree hashing 与 MAC。",
			"与 Whirlpool 同是 Miyaguchi-Preneel 结构，但 Whirlpool 用 AES 风分组密码、Skein 用 Threefish，二者不可互换。",
		],
		aka: ["Skein", "threefish哈希", "SHA-3决赛", "Threefish", "Miyaguchi-Preneel", "Skein-512", "Skein-256", "Skein-1024", "NIST SHA-3", "Skein哈希", "Ferguson", "Lucks", "Schneier", "Skein算法", "threefish压缩", "skein512", "skein256", "skein1024", "SHA3候选", "可调分组密码哈希"],
	},

	// ============ hash: Grøstl SHA-3 决赛候选哈希 ============
	grostl: {
		what: "Grøstl——NIST SHA-3 决赛五强之一（Thomsen/Matusiewicz，2010 提交）。宽管道（wide-pipe）设计的双置换哈希：两个独立置换 P/Q 并行压缩，输出状态两倍于摘要长度。名字是奥地利菜名，作者母语梗。",
		principle:
			"宽管道：状态 = 摘要长度的 2 倍（Grøstl-256 用 512 位状态、Grøstl-512 用 1024 位状态）。压缩函数是双置换并行：\n\n" +
			"$$H_i = P(H_{i-1} \\oplus M_i) \\oplus Q(M_i) \\oplus H_{i-1}$$\n\n" +
			"P/Q 都是 8×8 字节矩阵上的迭代置换（P 用 0x00..0x70 系轮常数、Q 用 0xff..0x8f 系），每轮 = 非线性层（AES 风 S 盒）+ 行移位 + 列混合（MDS 矩阵，经预计算 T 表查表）。\n\n" +
			"填充：补 0x80 + 0 到 64 字节块边界，末 8 字节 = 块计数（大端）。输出 = 压缩后链值的末摘要长度字节。",
		usage: "选 variant（Grøstl-256 / Grøstl-512），inputMode 选 text/hex。输入消息输出摘要 hex。CTF 里见到既非 MD5 系也非 SHA 系的长哈希可试 Grøstl。",
		examples: [
			{ in: "", param: "variant=512, inputMode=text", out: "6d3ad29d279110eef3adbd66de2a0345a77baede1557f5d099fce0c03d6dc2ba8e6d4a6633dfbd66053c20faa87d1a11f39a7fbe4a6c2f009801370308fc4ad8", desc: "Grøstl-512 空串官方向量" },
			{ in: "abc", param: "variant=512, inputMode=text", out: "70e1c68c60df3b655339d67dc291cc3f1dde4ef343f11b23fdd44957693815a75a8339c682fc28322513fd1f283c18e53cff2b264e06bf83a2f0ac8c1f6fbff6", desc: "Grøstl-512 对 abc，C oracle 输出" },
		],
		formulas: [
			{ tex: "H_i = P(H_{i-1} \\oplus M_i) \\oplus Q(M_i) \\oplus H_{i-1}", caption: "Grøstl 的宽管道双置换压缩" },
		],
		tips: [
			"Grøstl-256 用 512 位状态、Grøstl-512 用 1024 位状态——状态恒为摘要两倍，这就是「宽管道」。",
			"SHA-3 决赛五强（Keccak/Blake/Skein/Grøstl/JH）里 Grøstl 在哈希速度上排名靠前，最终 Keccak 胜出。",
			"P/Q 轮常数互为补码（P 用 0x00..、Q 用 0xff.. 系），保证两置换差异最大。",
			"输出变换再做一次 P(h)⊕h（截尾输出），是 Grøstl 防长度扩展的特征设计。",
		],
		aka: ["Grøstl", "grostl", "Groestl", "宽管道哈希", "wide-pipe", "SHA-3决赛", "双置换", "NIST SHA-3", "Thomsen", "Matusiewicz", "groestl哈希", "Grøstl-512", "Grøstl-256", "SHA3候选", "MDS矩阵", "宽管哈希", "grostl512", "grostl256", "Groestl算法", "双管道哈希"],
	},

	// ============ hash: JH SHA-3 决赛候选哈希 ============
	jh: {
		what: "JH——NIST SHA-3 决赛五强之一（Hongjun Wu 吴鸿君，清华/新加坡南洋理工，2010 提交）。1024 位状态上做 42 轮 bitslice 置换，JH-224/256/384/512 四种输出。bitslice 设计（逐位逻辑门并行）在 Intel 平台上实现极快。",
		principle:
			"状态 = 1024 位（8 行 × 2 个 64 位字），消息块 512 位。压缩函数 F8：消息异或进前一半状态 → E8 双射（42 轮）→ 再异或进后一半状态（宽管道风格）。\n\n" +
			"E8 每 7 轮一组 = 6 轮「S 盒（bitslice 逻辑门）+ MDS 线性扩散 + 位交换 SWAP{1,2,4,8,16,32}」+ 1 轮「S 盒 + MDS + 行间交换」。S 盒由 S0/S1 两个 4 位 S 盒 bitslice 而成，轮常数注入 S 盒选择位。\n\n" +
			"填充：补 1 位 + 0；消息长恰为 512 的倍数时单块 0x80...len，否则两块（第二块放 64 位长度）。输出 = 截尾链值（JH512 取全部 64 字节、JH224 取最后 28 字节）。",
		usage: "选 variant（JH-224/256/384/512），inputMode 选 text/hex。输入消息输出摘要 hex。CTF 里见到既非 MD5 系也非 SHA 系的长哈希可试 JH。",
		examples: [
			{ in: "", param: "variant=512, inputMode=text", out: "90ecf2f76f9d2c8017d979ad5ab96b87d58fc8fc4b83060f3f900774faa2c8fabe69c5f4ff1ec2b61d6b316941cedee117fb04b1f4c5bc1b919ae841c50eec4f", desc: "JH-512 空串官方向量" },
			{ in: "abc", param: "variant=512, inputMode=text", out: "a05eab9c641cb901107d9880bcdf0eedb19b0073188896365921bd200225d9176cf136e7af90d67bdb05dfa3037e48b757d23a905b2270db67255b9eca982973", desc: "JH-512 对 abc，C oracle 输出" },
		],
		formulas: [
			{ tex: "H' = H \\oplus \\mathrm{E8}(H \\oplus M)", caption: "JH 压缩：消息异或进前一半状态后做 E8 双射" },
		],
		tips: [
			"JH 与 Keccak 同代：SHA-3 决赛五强（Keccak/Blake/Skein/Grøstl/JH）之一，最终 Keccak 胜出。",
			"bitslice 是 JH 的标志：S 盒用逐位逻辑门表达，SIMD 友好，在 Intel 平台有极速实现。",
			"E8 的轮常数同时注入 S 盒选择位（cc0/cc1），常数本身即「密钥」的一部分。",
			"JH-224 输出只有 28 字节——比 SHA-224 还少 4 字节，是给低资源环境的变体。",
		],
		aka: ["JH", "jh哈希", "SHA-3决赛", "bitslice", "Hongjun Wu", "吴鸿君", "NIST SHA-3", "JH-512", "JH-256", "JH-384", "JH-224", "SHA3候选", "bitslice哈希", "E8双射", "jh512", "jh256", "JH算法", "宽管道", "MDS扩散"],
	},

	// ============ hash: Pearson 快速非加密哈希 ============
	pearson: {
		what: "Pearson 哈希——Peter K. Pearson 1990 年在 CACM 发表的极简快速非加密哈希。逐字节查 256 排列表 T[h^c] 累积，输出 1~32 字节。",
		principle:
			"Pearson 哈希极其简洁：维护一个 8 位寄存器 h，初始为 0。对消息每个字节 c：\n\n" +
			"$$h = T[h \\oplus c]$$\n\n" +
			"其中 T 是一张 0..255 的随机置换表（每个值恰好出现一次）。处理完所有字节后 h 即是单字节哈希。\n\n" +
			"多字节输出：用「首字节替身扩展」——每多生成一个字节，就对 h 异或 (i-1)（第 i 字节）再查 T 得到新字节。即 h1 = T[h0^0], h2 = T[h0^1], h3 = T[h0^2]...，所有 hi 拼成输出。\n\n" +
			"本工具的置换表预定义为合法置换（加载自检所有 256 值恰好出现一次），已嵌入代码。\n\n" +
			"不适用于安全场景（极容易碰撞），但极快（每字节一次异或+查表），适合哈希表、校验和等非安全场景。",
		usage: "输入框填消息，参数 inputMode 选 text/hex、bytes 填输出字节数 1~32（默认 8）。无密钥，输出为 hex 串。",
		examples: [
			{ in: "abc", param: "inputMode=text, bytes=8", out: "ac15d50e7b8c50f7", desc: "'abc' 的 8 字节 Pearson 哈希验证值" },
		],
		formulas: [
			{ tex: "h \\leftarrow T[h \\oplus c]\\quad\\text{for each byte }c", caption: "Pearson 哈希核心迭代：异或后查表" },
		],
		tips: [
			"Pearson 哈希不保证抗碰撞，仅适用于非安全场景（哈希表、校验和）。",
			"bytes 越大输出越长但不增加安全性，因为扩展完全由首字节 h0 决定。",
			"CTF 出现 Pearson 通常是题目要求实现/分析这一特定算法，或考察哈希性质。",
		],
		aka: ["Pearson哈希", "Pearson", "查表哈希", "CACM", "非加密哈希", "极简哈希", "8位哈希", "Pearson Hashing", "置换表", "一字节哈希", "Pearson 1990", "快哈希", "校验和", "lookup3", "快速校验", "CACM 1990", "Peter Pearson", "T表哈希", "异或查表", "迭代置换"],
	},

	// ============ analysis: xorshift PRNG 状态恢复 ============
	xorshiftRecover: {
		what: "xorshift 状态恢复——George Marsaglia 2003 年发明的 xorshift 伪随机数生成器，因其可逆性可从连续输出逆向恢复内部状态并预测后续随机数。",
		principle:
			"xorshift PRNG 只用异或和移位操作生成随机数。三个变体：\n\n" +
			"xorshift32（32 位种子）：state ^= state<<13, state ^= state>>17, state ^= state<<5。\n" +
			"xorshift64（64 位种子）：state ^= state<<13, state ^= state>>7, state ^= state<<17。\n" +
			"xorshift128（四字状态 [a,b,c,d]）：t=d, s=a; d=c, c=b, b=a; t^=t<<11, t^=t>>8; a=t^s^(s>>19)。\n\n" +
			"逆向原理：xorshift 每步都是可逆的——左移异或可通过逐步消除恢复（低位先没被搅动，直接恢复）。\n" +
			"xorshift32 反推：对 state >> 5, state >> 17, state << 13 的顺序逐位求逆。从最后一次 >>5 开始，高位由已知低位反推。完整过程需逆向三步，每次处理一个移位操作。\n\n" +
			"本工具从连续输出数中恢复内部状态，然后前向预测指定数量的下一个输出。",
		usage: "输入框填连续输出（空格/逗号分隔），参数 variant 选 xorshift32/64/128、radix 选 dec/hex、count 填预测数（默认 5）。输出状态和预测值。",
		examples: [
			{ in: "306711549, 3757459702, 3085120653, 1410003462, 2535397831", param: "variant=xorshift32, radix=dec, count=3", out: "seed=123456789, next=...", desc: "xorshift32 种子 123456789 的前 5 个 dec 输出，恢复 seed ✓，预测全命中" },
		],
		formulas: [
			{ tex: "x \\mathrel{\\oplus}= x \\ll 13;\\ x \\mathrel{\\oplus}= x \\gg 17;\\ x \\mathrel{\\oplus}= x \\ll 5", caption: "xorshift32 的经典三重移位" },
		],
		tips: [
			"xorshift 的每步异或移位都是可逆的，这是恢复的基础——没有信息损失。",
			"xorshift128 需要 4 个连续输出恢复四字状态，xorshift32/64 仅需 1 个。",
			"CTF 常见：给了 PRNG 连续输出要你预测下一个 → xorshiftRecover 直接解。",
		],
		aka: ["xorshift", "PRNG", "状态恢复", "随机数预测", "Marsaglia", "xorshift32", "伪随机", "种子恢复", "异或移位", "random crack", "xorshift64", "xorshift128", "随机数破解", "PRNG攻击", "状态逆向", "随机种子", "伪随机数", "线性反馈", "统计随机", "Marsaglia PRNG"],
	},

	// ============ text: yEnc Usenet 二进制编码 ============
	yenc: {
		what: "yEnc——专为 Usenet/NNTP 新闻组设计的二进制编码（yEnc v1.3）。将任意二进制字节转为可打印 ASCII 传输，效率远超 Base64/UUEncode。",
		principle:
			"yEnc 的编码规则极为简洁：\n\n" +
			"1. 每个字节 +42 mod 256，得到编码后的字节 c。\n" +
			"2. 转义：若 c 是 NUL(0x00)、CR(0x0d)、LF(0x0a)、'='（0x3d）、TAB（0x09，行首）、空格（0x20，行首）、'.'（0x2e，行首），则在该字节前加 '='（转义标志），并将该字节 +64 mod 256。\n" +
			"3. 行宽：可指定每行字节数（默认 128），到达宽度后插入 CRLF。\n\n" +
			"yEnc 头包含 ybegin/yend 行，记录文件名、大小、行宽等元信息。效率：编码膨胀仅 ~3%（vs Base64 的 ~33%、UUEncode 的 ~33%），因为每字节仅 +42 且仅少量需要转义。\n\n" +
			"解码即逆过程：去掉 '=' 前缀并把后面字节 -64 mod 256，然后所有非转义字节 -42 mod 256。",
		usage: "输入框填文本或二进制数据，参数 width 填行宽（默认 128）。编码输出带 ybegin/yend 头的 ASCII 文本；解码填同样内容即可还原。",
		examples: [
			{ in: "ABC", param: "width=128", out: "klm", desc: "'ABC' 全可打印 +42 编码，往返 PASS" },
		],
		formulas: [
			{ tex: "c_i = (b_i + 42) \\bmod 256", caption: "yEnc 基础编码：每字节 +42 mod 256" },
		],
		tips: [
			"yEnc 的编码效率远高于 Base64，适合大型二进制文件在 Usenet 上传输。",
			"转义规则保证 NUL/CR/LF/'=' 不会出现在编码体中，避免协议冲突。",
			"CTF 里看到以 =ybegin / =yend 开头的文本块 → yEnc 编码。",
		],
		aka: ["yEnc", "yEnc-1.3", "Usenet", "新闻组编码", "二进制传输", "yencode", "NNTP编码", "邮件附件", "Usenet编码", "转义编码", "yEnc v1.3", "Jürgen Helbing", "ydecode", "二进制文本化", "高效编码", "yEnc格式", "newsgroup", "网络新闻", "ASCII传输", "文件编码"],
	},

	// ============ text: BinHex 4.0 Mac 二进制编码（hqx） ============
	binhex: {
		what: "BinHex 4.0——经典 Macintosh 二进制编码格式，把任意二进制文件（含资源分支）转为 ASCII 文本（.hqx 文件），以便在非二进制通道传输。",
		principle:
			"BinHex 4.0 的编码流程：\n\n" +
			"1. RLE 压缩（行程编码）：连续相同字节用 0x90 + 计数 + 值 替换（计数从 0 开始表示 1 次重复，最大 255 次）。\n" +
			"2. 6 位编码：将 RLE 压缩后的比特流每 6 位一组映射为可打印字符。字符表从 '!'（0x21）开始，跳过 'i'（含 Delete 键意味）后继续到 'z'，总共 64 个字符（0..63）。\n" +
			"3. 格式头：文件以 \"This file must be converted with BinHex 4.0\" 行开始（或以冒号结尾），后续跟编码体，以 ':' 结尾。\n\n" +
			"BinHex 封装完整 Mac 文件元信息：文件名、文件类型（TYPE）、创建者（CREA）、Finder 标志、数据分支和资源分支。\n\n" +
			"解码：先解析头尾，去掉格式行，6 位解码回字节，再 RLE 解压即得原始文件。",
		usage: "输入框填文本或二进制数据，参数 filename 填文件名（默认 file.txt）。编码输出带头行的完整 BinHex 文本；解码填编码文本即可还原。",
		examples: [
			{ in: "Hello", out: "(BinHex 编码体，含 'This file must be converted with BinHex 4.0' 头)", desc: "'Hello' 编码产出标准 BinHex 头 + 编码体" },
		],
		formulas: [
			{ tex: "\\text{ch}(n) = \\begin{cases} \\text{chr}(33 + n), & n < 14 \\\\ \\text{chr}(34 + n), & n \\ge 14 \\end{cases}", caption: "BinHex 4.0 6 位编码字符映射（跳过 ASCII 105 'i'）" },
		],
		tips: [
			"BinHex 文件头 'This file must be converted with BinHex 4.0' 是识别标志。",
			"和 Base64 不同，BinHex 保留了 Mac 经典资源分叉（resource fork）信息。",
			"CTF 里看到 .hqx 文件或以此头开头的文本 → BinHex 编码。",
		],
		aka: ["BinHex", "BinHex 4.0", "hqx", "Mac编码", "Macintosh", "Classic Mac", "StuffIt", "MacBinary", "二进制转ASCII", "RLE编码", "Mac OS Classic", "Yves Lempereur", "BinHex格式", "Apple编码", "资源分叉", "文件传输", "Mac文件", "hqx文件", "Mac旧时代", "文本化编码"],
	},

	mars: {
		what: "MARS——IBM 于 1998 年提交 AES 竞赛的候选分组密码（Burwick/Coppersmith 等 11 位作者）。128 位分组，密钥 128-448 位，32 轮混合结构，AES 五强决赛圈成员。",
		principle:
			"MARS 把加密分成三阶段，混合了 Feistel 与 SPN 思想：\n\n" +
			"1. 预处理：明文加前 4 个密钥字后，做 8 轮前向混合（F_MIX：S0/S1 查表 + 旋转，间隔加 D 或 B）。\n" +
			"2. 加密核心 16 轮：每轮用一对密钥字 (k1,k2)，核心 CORE 做乘法取高位旋转（r = (a<<<13)*k2 <<<5）、S 盒查表、变量旋转加。前 8 轮正序、后 8 轮反序混合。\n" +
			"3. 后处理：8 轮后向混合（B_MIX，间隔减 D 或 B），最后减末 4 个密钥字。\n\n" +
			"密钥编排：15 字 T 数组 4 次迭代，每次先线性扩展再 4 轮 S 盒搅拌，产出 40 个字；再修正奇数下标乘法密钥字（保证乘法器不平凡，B 表 + 掩码）。\n\n" +
			"解密是完整逆序：逆核心 CORE_INV + 反向混合。",
		usage: "参数 keyBits 选 128/192/256，key 填对应长度 hex（128 位=32 hex，192 位=48 hex，256 位=64 hex）。输入框填 16 字节（32 hex）整数倍的明文/密文。编码输出 hex 密文，解码填同样 key 即可还原。",
		examples: [
			{ in: "00000000000000000000000000000000", param: "keyBits=128, key=80000000000000000000000000000000", out: "b3e2ad5608ac1b6733a7cb4fdf8f9952", desc: "MARS-128 官方向量（Crypto++ marsval.dat：key=8000.., pt=0）" },
		],
		formulas: [
			{ tex: "r = ((a \\lll 13) \\cdot k_2) \\lll 5;\\quad c \\mathrel{+}= m \\lll (r \\bmod 32);\\quad b \\mathrel{+}= l \\lll (r \\bmod 32)", caption: "MARS 加密核心 CORE：乘法取高位 + 变量旋转" },
		],
		tips: [
			"MARS 密钥 128/192/256 位任选；128 位分组不变。",
			"识别信号：IBM AES 候选、Burwick/Coppersmith、32 轮混合结构。",
			"CTF 里 AES 决赛圈五强（MARS/RC6/Serpent/Twofish/Rijndael）都该备着。",
			"已过 Crypto++ marsval.dat 全部官方向量（含 192/256 位密钥）。",
		],
		aka: ["MARS", "IBM MARS", "AES候选", "AES决赛圈", "分组密码", "128位分组", "Burwick", "Coppersmith", "32轮", "混合结构", "MARS-128", "MARS-192", "MARS-256", "MARS加密", "Feistel-SPN", "IBM AES", "Mars cipher", "五强密码", "AES finalist", "MARS算法"],
	},

	skipjack: {
		what: "Skipjack——美国 NSA 设计的对称分组密码（80 年代，1998 年解密），曾用于 Clipper/Fortezza 芯片。64 位分组，80 位密钥，32 轮。",
		principle:
			"Skipjack 结构 32 轮 = 8×规则A + 8×规则B + 8×规则A + 8×规则B。分组拆成 4 个 16 位字 w1-w4：\n\n" +
			"规则A：w1' = G_k(w1) ^ w4 ^ (k+1)；w2' = G_k(w1)；w3' = w2；w4' = w3。\n" +
			"规则B：w1' = w4；w2' = G_k(w1)；w3' = w1 ^ w2 ^ (k+1)；w4' = w3。\n\n" +
			"核心是 key 相关置换 G_k（4 轮 Feistel）：每轮用 1 个 key 字节（按 4k mod 10 轮转）查 256 项 F 表再异或。\n\n" +
			"解密用 G 的逆置换 h，规则反走，同一把 key 的 tab 预处理（tab[i][c]=F[c^key[9-i]]）。\n\n" +
			"设计目标是在硬件上快（当时支持 Clipper 芯片），但密码学界长期不透明；1994 年 Biham 等人攻击泄露了 16 轮结构。",
		usage: "参数 key 填 80 位 hex（20 字符）。输入框填 8 字节（16 hex）整数倍的明文/密文。编码输出 hex 密文，解码填同 key 即可还原（ECB 多块）。",
		examples: [
			{ in: "0000000000000000", param: "key=80000000000000000000", out: "7a00e49441461f5a", desc: "NIST SP800-17 Table 6 官方向量（key=8000.., pt=0）" },
		],
		formulas: [
			{ tex: "G_k(w):\\ g_3 = F[g_2 \\oplus kv_0] \\oplus g_1;\\ g_6 = F[g_5 \\oplus kv_3] \\oplus g_4", caption: "Skipjack G 置换：4 步 F 表查表（kv = key 4 字节轮转）" },
		],
		tips: [
			"Skipjack 密钥固定 80 位（20 hex），不能改长度。",
			"识别信号：Clipper 芯片、Fortezza 卡、NSA 分组密码、64 位块 80 位密钥。",
			"CTF 里看到 64 位分组 + 80 位密钥的题目，先试 Skipjack。",
			"已过 NIST SP800-17 Table 6 全部官方向量（加密+解密）。",
		],
		aka: ["Skipjack", "NSA", "Clipper", "Fortezza", "分组密码", "80位密钥", "64位分组", "32轮", "Skipjack算法", "美国国家安全局", "KEA", "Escrowed", "密钥托管", "Skipjack cipher", "NSAClip", "G置换", "F表", "硬件密码", "4轮Feistel", "NIST SP800-17"],
	},

	threefish: {
		what: "Threefish——Skein 哈希内建的可调分组密码（Ferguson/Lucks/Schneier 等，2010）。分组 256/512/1024 位，密钥同长，72/80 轮，128 位 tweak（可调参数）参与每一轮子密钥生成。",
		principle:
			"Threefish 的设计极简：没有复杂的密钥调度器，而是把密钥、tweak 和轮计数直接拼成子密钥，每 4 轮注入一次。\n\n" +
			"轮函数（每轮）：把状态字两两配对做 MIX——y0 = x0 + x1；y1 = (x1 循环左移 R) ^ y0，然后把字按固定置换表换位，让下一轮混合不同的配对。旋转常量 R 每 8 轮循环一次。\n\n" +
			"子密钥（第 s 个子密钥）：前 Nw-3 个字 = 循环取密钥字 K[(s+j) mod (Nw+1)]，后 3 个字分别加上 T[s mod 3]、T[(s+1) mod 3]、s（轮计数）。其中 K_{Nw} = C240 ^ K0 ^ ... ^ K_{Nw-1}（C240 是固定魔数），T2 = T0 ^ T1。\n\n" +
			"tweak 的意义：让同一个密钥在不同上下文（如哈希的分片计数、流加密的块位置）下产生不同密钥流，是 Skein 构造可调哈希的关键。",
		usage: "参数 size 选 256/512/1024 位分组，key 填与分组同长 hex，tweak 填 128 位 hex（默认全零）。输入框填分组长度整数倍的 hex 明文。编码输出 hex 密文，解码填同样 key/tweak 即可还原（ECB 多块）。",
		examples: [
			{ in: "00000000000000000000000000000000", param: "size=256, key=00000000000000000000000000000000, tweak=00000000000000000000000000000000", out: "84da2a1f8beaee947066ae3e3103f1ad536db1f4a1192495116b9f3ce6133fd8", desc: "Threefish-256 全零 key/tweak/pt 官方向量（Crypto++ threefish.txt）" },
		],
		formulas: [
			{ tex: "y_0 = x_0 + x_1;\\quad y_1 = (x_1 \\lll R) \\oplus y_0", caption: "Threefish MIX 轮操作：加 + 循环左移异或" },
		],
		tips: [
			"Threefish-256 分组 = 4 字（32 hex），512 = 8 字（64 hex），1024 = 16 字（128 hex），数据须为分组整数倍。",
			"tweak 默认全零即退化为普通分组密码；tweak 参与子密钥使相同密钥在不同 tweak 下输出不同。",
			"CTF 出现 Threefish 时题目通常给 key + tweak + 密文，直接填参解码即可。",
			"Threefish 是 Skein 哈希（SHA-3 决赛圈）的底层，理解它有助于看穿整个 Skein 结构。",
		],
		aka: ["Threefish", "Skein", "可调分组密码", "Tweakable", "Threefish-256", "Threefish-512", "Threefish-1024", "Ferguson", "Lucks", "Schneier", "Whiting", "Bellare", "Kohno", "Callas", "Walker", "可调密码", "Threefish算法", "无密钥调度器", "Threefish加密", "SHA-3决赛圈", "Tweakable Block Cipher"],
	},

	streebog: {
		what: "Streebog——俄罗斯联邦国标哈希（GOST R 34.11-2012，RFC 6986），512 位输出（可 256 位截断），Merkle-Damgård + 12 轮压缩函数，信创与俄系赛题常见。",
		principle:
			"Streebog 是 512 位输出哈希，内部用 512 位分组密码 E 构建：\n\n" +
			"压缩函数：$g_N(h,m) = E_{LPS(h\\oplus N)}(m) \\oplus h \\oplus m$\n" +
			"即前态 h 与计数 N 异或后过 LPS 得密钥 K，K 加密消息块 m（E 函数 = 12 轮 LPSX），再异或回 h 和 m（类似 Miyaguchi-Preneel）。\n\n" +
			"轮内变换 LPS：\n" +
			"1. S——逐字节过 Pi 替换盒（256 项）\n" +
			"2. P——64 字节按 8×8 矩阵转置\n" +
			"3. L——每 64 位字过 GF(2) 线性变换矩阵 A（$2^{64}$ 空间扩散）\n\n" +
			"密钥编排：$K_{i+1} = LPS(K_i \\oplus C_i)$，12 个迭代常数 C 取黄金比小数位。\n\n" +
			"消息按 512 位块从右往左压缩，末块补 $0^*||1||M$ 并编码长度；最终再压 N 和校验和（消息逐块加和）两轮。256 位输出取 512 位摘要的高 256 位，IV 不同。\n\n" +
			"本实现已验证 RFC 6986 §10.1 的 M1 向量与空串，512/256 位各一组共 4 条。注意本算法内部按「低位在后」处理 512 位块，与标准字节序相反，消息与摘要都需整体字节反转——全同字节的测试数据反转后不变，查不出这类错位，必须用 M1 这种非均匀向量。",
		usage:
			"输入框填消息（文本或 hex）。参数 len 选 512 或 256 位输出。输出固定 128/64 个 hex 字符，完全单向。",
		examples: [
			{ in: "012345678901234567890123456789012345678901234567890123456789012", param: "len=512", out: "1b54d01a4af5b9d5cc3d86d68d285462b19abc2475222f35c085122be4ba1ffa00ad30f8767b3a82384c6574f024c311e2a481332b08ef7f41797891c1646f48", desc: "RFC 6986 §10.1 M1 向量（63 字节 ASCII 数字 = 504 位消息）" },
			{ in: "012345678901234567890123456789012345678901234567890123456789012", param: "len=256", out: "9d151eefd8590b89daa6ba6cb74af9275dd051026bb149a452fd84e5e57b5500", desc: "同一 M1 向量的 256 位输出" },
		],
		formulas: [
			{ tex: "g_N(h,m) = E_{LPS(h\\oplus N)}(m) \\oplus h \\oplus m", caption: "Streebog 压缩函数：LPS 派生密钥加密消息块，再异或回 h 和 m" },
		],
		tips: [
			"Streebog 是俄罗斯国标（对应我国 SM3），俄系 CTF（如 RACTF）和信创考试常见。",
			"识别信号：Streebog、GOST R 34.11-2012、RFC 6986、512 位哈希 → 用这个 op。",
			"512 位输出 128 个 hex；256 位是取高 256 位，不是独立算法。",
			"压缩函数用 512 位分组密码 + Miyaguchi-Preneel 式构造，与 Whirlpool 结构相近。",
		],
		aka: ["streebog", "Streebog", "GOST R 34.11-2012", "RFC 6986", "俄罗斯哈希", "俄标哈希", "512位哈希", "Streebog512", "Streebog256", "GOST哈希", "俄罗斯国标", "Magma同族", "信创哈希", "Streebog hash", "俄系密码"],
	},

	cast128: {
		what: "CAST-128（CAST5）——RFC 2144 定义的分组密码，64 位分组、密钥 40~128 位。16 轮 Feistel，轮函数三种类型交替（Type1 加/Type2 异或/Type3 减 与子密钥组合后循环左移），八张 256 项 S 盒。CTF 里偶见，识别特征：密钥 5-16 字节、输出 8 字节块。",
		principle:
			"密钥扩展：128 位密钥 x 经 4 组 z 中间字迭代（S5-S8 参与），生成 32 个子密钥 K1..K32；K1..K16 作掩码 Kmi，K17..K32 低 5 位作旋转量 Kri。密钥 ≤ 80 位（10 字节）时只跑 12 轮，否则 16 轮。\n\n" +
			"轮函数：第 i 轮用 Type（i mod 3）+1——Type1: I=(Kmi+D)<<<Kri，f=((S1[Ia]^S2[Ib])-S3[Ic])+S4[Id]；Type2: I=(Kmi^D)<<<Kri，f=((S1-S2)+S3)^S4；Type3: I=(Kmi-D)<<<Kri，f=((S1+S2)^S3)-S4。Ia..Id 是 I 的四个字节。Feistel：Li=Ri-1，Ri=Li-1^f(Ri-1)，最后输出 (R16, L16)。",
		usage: "输入 hex 密钥（10-32 位，即 5-16 字节）和 hex 密文（8 字节倍数），encode 加密 / decode 解密。密钥 ≤ 10 字节自动走 12 轮。",
		examples: [
			{ in: "0123456789abcdef", param: "key=0123456712345678234567893456789a", out: "238b4fe5847e44b2", desc: "RFC 2144 附录 B.1 官方向量" },
			{ in: "238b4fe5847e44b2", param: "key=0123456712345678234567893456789a", out: "0123456789abcdef", desc: "解密还原" },
		],
		tips: ["RFC 2144 附录 B.1 三组向量（128/80/40 位密钥）可作正确性检验。密钥短于 16 字节右补零。与 CAST-256（CAST6，128 位分组）区分，别混。", "openssl legacy provider 的 cast5、pycryptodome 的 CAST 均可交叉验证。"],
		aka: ["cast128", "cast5", "CAST-128", "CAST5", "RFC 2144", "cast-128加密", "cast128分组密码", "cast5加密", "cast128解密", "cast5ecb", "cast128 算法", "cast密码", "cast5分组", "cast128密钥", "cast128向量"],
	},
};
