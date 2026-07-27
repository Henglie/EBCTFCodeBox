export default {
  aes: {
    what: "AES 高级加密标准：当今最常用的对称加密算法——密钥长度 128/192/256 位，支持 ECB/CBC/CFB/OFB/CTR/GCM 多种模式。",
    principle: "AES 是分组密码，把明文按 16 字节（128 位）分块，每块经 10/12/14 轮（对应 128/192/256 位密钥）变换。每轮包含 4 步：SubBytes（S-box 字节替换）、ShiftRows（行移位）、MixColumns（列混淆，GF(2⁸) 矩阵乘法）、AddRoundKey（轮密钥异或）。ECB 模式每块独立加密（相同明文→相同密文，不安全），CBC/CFB/OFB/CTR 用 IV（初始向量）链接块间依赖。GCM 模式走 WebCrypto 原生加速。",
    formulas: [
      { tex: "\\text{State}' = \\text{AddRoundKey}(\\text{MixColumns}(\\text{ShiftRows}(\\text{SubBytes}(\\text{State}))), K_r)", caption: "AES 每轮四步变换" },
    ],
    usage: "输入框填明文（encode）或密文（decode）。参数选模式（ECB/CBC/...）、密钥（16/24/32 字节）、密钥编码、密文编码。ECB 不需要 IV，其他模式需要。",
    examples: [
      { in: "Hello", param: "mode=ECB, key='1234567890123456'(16字节)", out: "Sy+szA6t7l9kO128yIajHQ== (base64)", desc: "AES-128-ECB，PKCS7 填充" },
    ],
    tips: [
      "ECB 模式相同明文块加密后相同——图片加密后能看到轮廓（经典 ECB 企鹅图），CTF 可据此识别 ECB。",
      "密钥长度必须是 16/24/32 字节，否则报错——hex 编码的 32 字符密钥 = 16 字节。",
      "CBC 模式需要 IV（通常 16 字节零或随机），IV 错误会解出乱码但第一块可能部分正确。",
    ],
    aka: ["AES", "Rijndael", "Advanced Encryption Standard", "FIPS 197", "高级加密标准", "AES-128", "AES-256", "AES-GCM", "AES-CBC", "对称加密"],
  },

  des: {
    what: "DES 数据加密标准：1977 年发布的对称加密——64 位块、56 位有效密钥，已被 AES 取代但 CTF 仍常见。",
    principle: "DES 是 Feistel 网络：64 位明文经初始置换 IP 后分成左右两半 L₀/R₀，经过 16 轮 Feistel 变换。每轮：Rₙ = Lₙ₋₁ ⊕ F(Rₙ₋₁, Kₙ)，Lₙ = Rₙ₋₁。F 函数包含：扩展置换 E（32→48 位）、与子密钥异或、8 个 S-box 替换（48→32 位）、置换 P。密钥经 PC-1/PC-2 和循环左移生成 16 个 48 位子密钥。56 位密钥已可暴力破解（约几小时）。",
    usage: "输入框填明文或密文。参数选模式（ECB/CBC/CFB/OFB/CTR）、密钥（8 字节）、密钥编码、密文编码。",
    examples: [
      { in: "Hello", param: "mode=ECB, key='12345678'(8字节)", out: "oVmfzWxhH88= (base64)", desc: "DES-ECB，PKCS7 填充" },
    ],
    tips: [
      "DES 密钥 8 字节但每字节第 8 位是校验位，有效密钥仅 56 位——现代算力可暴力破解。",
      "CTF 中 DES 常出现在旧系统/遗留代码场景——弱密钥（全零/全FF）可秒破。",
      "DES 和 3DES 块大小都是 8 字节（AES 是 16），密文长度是 8 的倍数。",
    ],
    aka: ["DES", "Data Encryption Standard", "FIPS 46-3", "数据加密标准", "DES加密", "Feistel密码", "DEA", "56位密钥", "分组密码", "DES-ECB"],
  },

  des3: {
    what: "3DES 三重 DES：用 2 或 3 个密钥对 DES 做「加密-解密-加密」——有效密钥 112/168 位，是 DES 的安全增强版。",
    principle: "3DES（TDEA）的 EDE 模式：$C = E_{K3}(D_{K2}(E_{K1}(P)))$。用三个密钥 K1/K2/K3 各做一次 DES：先 K1 加密，再 K2 解密，再 K3 加密。如果 K1=K3（双密钥模式，16 字节），有效密钥 112 位；三密钥模式（24 字节）有效 168 位。解密反向：$P = D_{K1}(E_{K2}(D_{K3}(C)))$。块大小仍 8 字节。",
    formulas: [
      { tex: "C = E_{K3}(D_{K2}(E_{K1}(P)))", caption: "3DES EDE 加密：三步 DES" },
    ],
    usage: "输入框填明文或密文。参数选模式、密钥（16 或 24 字节）、密钥编码、密文编码。",
    examples: [
      { in: "Hello", param: "mode=ECB, key='1234567890abcdef1234567890abcdef'(16字节双密钥)", out: "base64 密文", desc: "3DES-ECB，K1=K3='1234567890abcdef' K2='1234567890abcdef'" },
    ],
    tips: [
      "3DES 速度是 DES 的 1/3，且块大小仍 8 字节——已被 AES 取代。",
      "16 字节密钥 = 双密钥模式（K1=K3），24 字节 = 三密钥模式。",
      "Sweet32 攻击可在 2³² 次加密内破解 3DES——不适合大数据量加密。",
    ],
    aka: ["3DES", "TripleDES", "TDEA", "Triple DES", "三重DES", "三重数据加密", "3DES加密", "EDE模式", "DES-EDE", "Triple Data Encryption Algorithm"],
  },

  rc4: {
    what: "RC4 流密码：用密钥初始化一个 256 字节状态表，然后逐字节生成伪随机密钥流与明文异或——自反（加解密同一操作），曾用于 WEP/TLS。",
    principle: "RC4 分两步：① KSA（Key Scheduling Algorithm）：用密钥打乱 S[0..255] 初始排列；② PRGA（Pseudo-Random Generation Algorithm）：每次交换 S[i] 和 S[j] 生成一个伪随机字节，与明文字节异或。KSA: `j = (j + S[i] + key[i % keylen]) % 256`，PRGA: `j = (j + S[i]) % 256`。加解密同一函数（XOR 自反）。",
    usage: "输入框填明文（encode）或密文（decode）。参数填密钥（任意长）、密钥编码、密文编码。encode 和 decode 用相同密钥。",
    examples: [
      { in: "Hello", param: "key='Key', outEnc=hex", out: "a3fa1bedd8", desc: "RC4('Hello', 'Key') → 5 字节密文" },
    ],
    tips: [
      "RC4 已被证明不安全（初始字节偏置、Fluhrer-Mantin-Shamir 攻击）——WEP 因此被淘汰。",
      "RC4 是流密码，加解密同一操作：encode(encode(m, k), k) = m。",
      "CTF 中 RC4 常见于旧系统——识别特征：密文长度 = 明文长度（无填充无块结构）。",
    ],
    aka: ["RC4", "ARC4", "ARCFOUR", "Rivest Cipher 4", "RC4流密码", "流密码", "rivest密码4", "WEP加密", "KSA PRGA", "RC4 stream cipher"],
  },

  xor: {
    what: "XOR 重复密钥异或：把密钥循环重复与明文字节逐个异或——CTF 最简单最常用的加密，自反。",
    principle: "明文字节 $m_i$ 与密钥字节 $k_{i \\bmod \\text{keylen}}$ 异或：$c_i = m_i \\oplus k_{i \\bmod \\text{keylen}}$。解密用相同操作：$m_i = c_i \\oplus k_{i \\bmod \\text{keylen}}$。XOR 自反（$a \\oplus k \\oplus k = a$），所以 encode=decode。密钥比明文短时循环重复——这是 XOR 加密的弱点（可用 Kasiski/重合指数求密钥长度，再逐位破解）。",
    formulas: [
      { tex: "c_i = m_i \\oplus k_{i \\bmod n}", caption: "XOR 加密：密钥循环重复异或" },
    ],
    usage: "输入框填明文（encode）或密文（decode）。参数填密钥、密钥编码、密文编码。",
    examples: [
      { in: "Hello", param: "key='ABC', outEnc=hex", out: "09272f2d2d", desc: "H⊕A=0x09 e⊕B=0x27 l⊕C=0x2f l⊕A=0x2d o⊕B=0x2d" },
    ],
    tips: [
      "XOR 密钥长度 < 明文长度时，密钥循环重复——可用 xorBrute 爆破单字节，或用频率分析求多字节密钥。",
      "encode 和 decode 是同一个操作：再跑一次 encode 就还原了。",
      "如果密钥长度 = 明文长度且密钥随机，就是一次一密（OTP）——理论不可破，但密钥分发是难题。",
    ],
    aka: ["XOR", "异或加密", "XOR cipher", "重复密钥异或", "异或", "xor运算", "repeating key xor", "循环异或加密", "位异或", "一次一密"],
  },

  rsa: {
    what: "RSA 教学版：直接输入十进制大数做模幂运算——加密 $c = m^e \\bmod n$，解密 $m = c^d \\bmod n$。CTF 中拿到 n/e/d 直接算。",
    principle: "RSA 基于大数模幂难题。密钥生成：选两个大素数 p, q，$n = pq$，$\\phi = (p-1)(q-1)$，选 $e$ 满足 $\\gcd(e, \\phi) = 1$，算 $d = e^{-1} \\bmod \\phi$。加密：$c = m^e \\bmod n$，解密：$m = c^d \\bmod n$。本工具是教学级——不做 PKCS 填充，直接十进制数进出，用 BigInt 实现模幂运算。实际 RSA 需要填充（OAEP/PSS）才安全。",
    formulas: [
      { tex: "c = m^e \\bmod n \\quad; \\quad m = c^d \\bmod n", caption: "RSA 加解密：公钥 (e,n) 加密，私钥 (d,n) 解密" },
    ],
    usage: "encode：输入框填明文 m（十进制），参数填 n 和 e。decode：输入框填密文 c（十进制），参数填 n 和 d。",
    examples: [
      { in: "65", param: "n=3233, e=17", out: "2790", desc: "加密：65^17 mod 3233 = 2790" },
      { in: "2790", param: "n=3233, d=2753", out: "65", desc: "解密：2790^2753 mod 3233 = 65" },
    ],
    tips: [
      "这是教学版——不处理 PEM 格式、不做填充。CTF 中拿到 n/e/c/d 的大数直接填进来算。",
      "RSA 攻击工具在 analysis 分类（rsaSmallE/rsaWiener/rsaFermat 等）——n 被分解或 e/d 有弱点时可破。",
      "实际 RSA 密文是十六进制大数——先转十进制再填入，或直接填 hex 让 BigInt 解析。",
    ],
    aka: ["RSA", "模幂运算", "RSA教学版", "RSA加密", "非对称加密", "公钥密码", "Rivest Shamir Adleman", "RSA算法", "公钥加密", "大数模幂"],
  },

  xorStrings: {
    what: "XOR 循环补齐：明文和密钥短的一侧循环补齐到长的一侧再逐字节异或，自反。",
    principle: "与普通 XOR 不同：xorStrings 把明文和密钥都视为等长的字节串，短的一侧循环重复直到与长的一侧等长，然后逐字节异或。例如明文 5 字节、密钥 2 字节，密钥循环补齐到 5 字节（ABABA）再异或。这样密文长度 = max(明文长度, 密钥长度)。",
    usage: "encode：输入框填明文，参数填密钥、密钥编码、明文编码、密文编码。decode：输入框填密文，参数同上。自反。",
    examples: [
      { in: "Hello", param: "key='AB', outEnc=hex", out: "09272d2e2e", desc: "密钥'AB'循环补齐为'ABABA'再异或：H⊕A e⊕B l⊕A l⊕B o⊕A" },
    ],
    tips: [
      "与普通 XOR（密钥循环补到明文长度）的区别：xorStrings 的密文长度 = max(明文, 密钥)，可能比明文长。",
      "自反：用相同密钥再跑一次 decode 就还原。",
      "两段不等长数据做循环异或。",
    ],
    aka: ["XOR循环补齐", "xor_strings", "循环异或", "XOR extend", "循环补齐异或", "xor strings", "等长循环异或", "cyclic xor", "随波逐流xor_strings", "双串循环异或"],
  },

  cast5: {
    what: "CAST-128/CAST5：RFC 2144 分组密码——64 位块、密钥 5-16 字节、12 或 16 轮 Feistel 结构，三种轮函数 + 8 个 S-box。",
    principle: "CAST-128 是 Feistel 网络：64 位明文分左右两半，经 12 轮（密钥 ≤80 位）或 16 轮（密钥 >80 位）。每轮使用三种轮函数之一（轮 1/4 用 Type 1，轮 2/5 用 Type 2，轮 3/6 用 Type 3，循环）：每种轮函数用不同的 S-box 组合做字节替换 + 密钥加法 + 循环移位。共 8 个 S-box（4 个用于密钥扩展，4 个用于轮函数），每个 256×32 位。子密钥由密钥扩展算法从主密钥生成。",
    usage: "输入框填明文或密文。参数选模式（ECB/CBC）、密钥（5-16 字节）、密钥编码、密文编码。",
    examples: [
      { in: "Hello", param: "mode=ECB, key='12345678'(8字节)", out: "base64 密文", desc: "CAST-128-ECB，8字节密钥=64位→12轮" },
    ],
    tips: [
      "CAST-128 块大小 8 字节（同 DES），密钥 5-16 字节可变——密钥 ≤80 位用 12 轮，>80 位用 16 轮。",
      "CAST-256 是 CAST-128 的扩展（128 位块，AES 候选），但 CTF 中更常见 CAST-128。",
      "PGP 早期版本使用 CAST-128 作为默认对称加密。",
    ],
    aka: ["CAST-128", "CAST5", "RFC 2144", "CAST cipher", "CAST128", "CAST密码", "CAST-5", "Feistel分组密码", "PGP CAST", "CAST-128分组密码"],
  },

  twofish: {
    what: "Twofish：Bruce Schneier 1998 年设计的 AES 候选算法——128 位块、16 轮 Feistel、密钥 128/192/256 位，使用密钥相关 S-box。",
    principle: "Twofish 是 16 轮 Feistel 网络：128 位明文分成两个 64 位半块，每轮用两个密钥相关的 S-box（由密钥通过 PHT 和 MDS 矩阵生成）做字节替换，结果经 PHT（Pseudo-Hadamard Transform）混合后与另一半异或。还使用 RS 矩阵从密钥提取子密钥。Twofish 的最大特色是 S-box 依赖密钥——每次加密 S-box 都不同，增强了安全性但降低了速度。",
    usage: "输入框填明文或密文。参数选模式（ECB/CBC）、密钥（16/24/32 字节）、密钥编码、密文编码。",
    examples: [
      { in: "Hello", param: "mode=ECB, key='1234567890123456'(16字节)", out: "base64 密文", desc: "Twofish-128-ECB，PKCS7 填充" },
    ],
    tips: [
      "Twofish 是 AES 五大候选之一（最终败给 Rijndael）——安全性高但速度略慢于 AES。",
      "块大小 16 字节（同 AES），密文长度是 16 的倍数。",
      "密钥相关 S-box 是 Twofish 的标志性设计——不同密钥产生不同的 S-box，攻击者无法预计算。",
    ],
    aka: ["Twofish", "Schneier AES候选", "Twofish cipher", "双鱼算法", "Twofish加密", "AES候选算法", "Bruce Schneier", "密钥相关S盒", "16轮Feistel", "Twofish分组密码"],
  },
};
