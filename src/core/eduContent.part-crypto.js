/*
 * eduContent.part-crypto.js — 科普卡数据分片：现代加密 + 哈希/校验 + 分析(RSA 攻击/爆破)。
 * 纯数据，无 import、无副作用。格式契约见 eduContent.js 头注释。
 * 面向大一大二学生：通俗、准确、能跑通的例子。
 */

export default {
 // ============ 现代对称加密 ============
  aes: {
    what: "现代最主流的分组对称加密。同一把密钥既加密又解密，安全性经得住实战，CTF 密码题的主力。",
    principle:
      "AES 把数据切成 16 字节一块，密钥可选 16/24/32 字节（对应 AES-128/192/256），做多轮字节替换、行移位、列混淆、轮密钥加。\n\n" +
      "单块只有 16 字节，长数据要靠「工作模式」把块串起来：`ECB` 每块独立（不安全，相同明文出相同密文）、`CBC` 用前一块结果搅拌当前块（要 IV）、`CFB/OFB/CTR` 把分组密码当流密码用（要 IV/nonce）、`GCM` 带认证标签。",
    usage:
      "选模式（ECB/CBC/CFB/OFB/CTR/GCM）、填密钥（和 IV，若模式需要），输入密文一键解密；编码方向做加密。\n" +
      "拿不准模式和编码组合时，用「现代加密」里的 `密钥+密文一键尝试`，它会枚举 AES/DES/… × 各模式 × 各编码帮你打分。",
    examples: [
      { in: "U2FsdGVk…（base64 密文）", param: "CBC + key + iv", out: "明文", desc: "CBC 必须给对 IV" },
    ],
    tips: [
      "密钥长度必须是 16/24/32 字节，不对就先看是不是要补齐或做过 hex/base64。",
      "ECB 模式相同明文块 → 相同密文块，看到密文里有重复 16 字节片段，多半是 ECB。",
      "不知道模式/编码就丢 `cryptoTryAll` 一键尝试，省得手动试组合。",
    ],
    aka: ["rijndael", "aes-128", "aes-256", "高级加密标准"],
  },

  des: {
    what: "上一代的分组对称加密标准，56 位有效密钥现在算短，但 CTF 里作为经典算法仍常出现。",
    principle: "16 轮 Feistel 结构，块长 8 字节，密钥 8 字节（含奇偶校验位，有效 56 位）。模式与 AES 同理（ECB/CBC/…）。",
    usage: "填 8 字节密钥、选模式（CBC 要 IV），输入密文解密；编码方向加密。",
    examples: [{ in: "hex 密文", param: "ECB + 8字节key", out: "明文" }],
    tips: ["key 必须正好 8 字节。块长 8 字节 → 密文长度是 8 的倍数。"],
    aka: ["data encryption standard", "数据加密标准"],
  },

  des3: {
    what: "把 DES 做三遍（加密-解密-加密）的加强版，密钥 16 或 24 字节，安全性远高于单 DES。",
    principle: "3DES/TripleDES：$C = E_{k_3}(D_{k_2}(E_{k_1}(P)))$。两密钥版 $k_1=k_3$（16 字节），三密钥版全不同（24 字节）。块长仍 8 字节。",
    usage: "填 16 或 24 字节密钥、选模式，输入密文解密。",
    examples: [{ in: "hex 密文", param: "CBC + 24字节key + iv", out: "明文" }],
    formulas: [{ tex: "C = E_{k_3}\\big(D_{k_2}(E_{k_1}(P))\\big)", caption: "3DES 的 EDE 结构" }],
    aka: ["tripledes", "triple des", "3des", "三重des"],
  },

  rc4: {
    what: "经典流密码，加解密同一套运算（自反）。逆向题里常见，还原出 key 就能解。",
    principle:
      "两个阶段：KSA 用密钥打乱一个 256 字节的状态表 S；PRGA 从 S 不断吐出密钥流字节，和明文逐字节异或。\n\n" +
      "因为异或自反，用同一密钥再跑一遍密文就得回明文。",
    usage: "填密钥（任意长），输入密文解密即得明文（编码/解码同形）。",
    examples: [{ in: "hex 密文", param: "key=Secret", out: "明文" }],
    tips: ["加解密对称：拿到 key 直接跑就行，不用管方向。逆向题常把 RC4 的 KSA 循环特征暴露出来，认出就是它。"],
    aka: ["arcfour", "rc-4", "流密码rc4"],
  },

  xor: {
    what: "重复密钥异或——CTF crypto/reverse 的万金油。运算极简、天然自反，出现频率极高。",
    principle:
      "把密钥循环重复到和明文一样长，逐字节异或。异或有 $a \\oplus b \\oplus b = a$ 的性质，所以同一密钥异或两次还原。\n\n" +
      "若不知道密钥：单字节 key 用 `xorBrute` 爆破 256 种；多字节 key 先用重合指数/汉明距离估计 key 长度，再分组频率分析。",
    usage: "填密钥（文本或 hex），输入密文异或即得明文。未知单字节 key 请用分析类的 `xorBrute`。",
    examples: [
      { in: "hex 密文", param: "key=flag", out: "明文", desc: "key 循环补齐后逐字节异或" },
    ],
    formulas: [{ tex: "P_i = C_i \\oplus K_{i \\bmod |K|}", caption: "重复密钥异或" }],
    tips: [
      "已知部分明文（如 flag 头）异或对应密文，能直接反推出那几字节密钥。",
      "单字节 key → xorBrute；长 key → 先估 key 长（汉明距离/IC）再逐位破。",
    ],
    aka: ["异或", "xor cipher", "重复密钥异或", "^"],
  },

  xorStrings: {
    what: "两串按各自循环补齐后异或的变体，同样自反。",
    principle: "明文与密钥谁短谁循环补齐到较长一侧再逐字节异或；再异或一次还原。",
    usage: "填密钥串，输入另一串，一键异或。",
    examples: [{ in: "密文串", param: "key=ab", out: "明文串" }],
    aka: ["xor strings", "循环异或"],
  },

 // ============ RSA 与攻击套件 ============
  rsa: {
    what: "最著名的非对称加密：公钥加密、私钥解密。CTF 密码题的半壁江山，大多数题在考它的各种破解姿势。",
    principle:
      "选两个大素数 $p,q$，令 $n=pq$、$\\varphi(n)=(p-1)(q-1)$；公钥指数 $e$ 与 $\\varphi$ 互质，私钥 $d \\equiv e^{-1} \\pmod{\\varphi(n)}$。\n\n" +
      "加密 $c = m^e \\bmod n$，解密 $m = c^d \\bmod n$。安全性建立在「大数分解 $n$ 很难」上——一旦分解出 $p,q$ 就能算 $d$。",
    usage: "本功能是教学用模幂：填 e/d 和 n，直接算 $m^e \\bmod n$。分解 n、求 d 等请用分析类的 rsaParams / rsaFermat / rsaWiener 等专项工具。",
    examples: [
      { in: "c=2790", param: "d, n", out: "m", desc: "私钥解密 = c^d mod n" },
    ],
    formulas: [
      { tex: "c = m^e \\bmod n, \\qquad m = c^d \\bmod n", caption: "RSA 加解密" },
      { tex: "d \\equiv e^{-1} \\pmod{\\varphi(n)}, \\quad \\varphi(n)=(p-1)(q-1)", caption: "私钥由 φ 求逆得到" },
    ],
    tips: [
      "拿到 RSA 题先看给了什么：给 p,q → rsaParams 直接求 d；n 能分解（小/相近/含小因子）→ Fermat/Pollard；e 很小 → rsaSmallE；d 很小 → Wiener；同 n 多密文 → 共模。",
    ],
    aka: ["rivest shamir adleman", "非对称加密", "公钥加密"],
  },

  rsaWiener: {
    what: "当私钥 d 太小时的经典攻击：用连分数展开 e/n 就能把 d 挖出来，不用分解 n。",
    principle:
      "当 $d < \\frac{1}{3} n^{1/4}$ 时，$\\frac{e}{n}$ 的连分数收敛子里就藏着 $\\frac{k}{d}$。逐个收敛子当作候选 $d$ 验证即可。",
    usage: "输入框填 e 和 n（每行一个或逗号分隔），自动跑连分数找小 d。",
    examples: [{ in: "e=..., n=...", out: "d=... (若满足小 d 条件)" }],
    formulas: [{ tex: "d < \\tfrac{1}{3}\\,n^{1/4}", caption: "维纳攻击的适用门槛" }],
    tips: ["特征：e 特别大（接近 n），往往暗示 d 很小 → 试 Wiener。"],
    aka: ["wiener attack", "维纳攻击", "连分数攻击", "wiener", "威纳攻击", "小d攻击", "小私钥指数攻击", "continued fraction attack", "rsa wiener", "低解密指数攻击", "连分数展开", "wiener's attack"],
  },

  rsaCommonModulus: {
    what: "共模攻击：同一个 n、同一段明文，被两个互质的 e 各加密一次，就能不解密直接还原明文。",
    principle:
      "已知 $c_1=m^{e_1}, c_2=m^{e_2} \\pmod n$ 且 $\\gcd(e_1,e_2)=1$。由扩展欧几里得求 $a e_1 + b e_2 = 1$，则 $c_1^a c_2^b \\equiv m \\pmod n$（负指数用模逆）。",
    usage: "填 n、e1、e2，输入框填 c1 和 c2，自动恢复 m。",
    examples: [{ in: "c1=..., c2=...", param: "n, e1, e2", out: "m" }],
    formulas: [{ tex: "a e_1 + b e_2 = 1 \\Rightarrow m \\equiv c_1^{a} c_2^{b} \\pmod n", caption: "贝祖系数组合还原 m" }],
    tips: ["特征：同一个 n 出现两次，两个不同的 e 和对应密文 → 共模攻击。"],
    aka: ["common modulus", "共模攻击", "rsa共模", "common modulus attack", "同模攻击", "共模数攻击", "共享模数攻击", "贝祖攻击", "rsa common modulus", "共n攻击", "同n不同e", "扩展欧几里得攻击"],
  },

  rsaSmallE: {
    what: "低指数攻击：e 很小（如 3）且明文也不大时，密文其实就是 m 的 e 次方，直接开整数根就还原。",
    principle: "若 $m^e < n$，则 $c=m^e$ 没有取模，$m=\\sqrt[e]{c}$ 整数开根即可。若略大于 n，试 $\\sqrt[e]{c+k n}$ 逐个 k。",
    usage: "填 e（通常 3/5/7）、可选 n，输入密文 c，自动开 e 次整数根。",
    examples: [{ in: "c=...", param: "e=3", out: "m" }],
    formulas: [{ tex: "m = \\sqrt[e]{c + k\\,n}, \\quad k=0,1,2,\\dots", caption: "低指数开根（含 k·n 试探）" }],
    tips: ["特征：e=3 这种超小指数 + 明文短 → 先试开根。"],
    aka: ["low exponent", "小e攻击", "低指数攻击", "hastad", "rsa低指数", "小指数攻击", "整数开根攻击", "e=3攻击", "low public exponent", "cube root attack", "开立方攻击", "rsa small e"],
  },

  rsaFermat: {
    what: "当两个素数 p、q 挨得很近时的秒解分解法。费马把 n 写成两平方差。",
    principle:
      "$n = a^2 - b^2 = (a-b)(a+b)$。从 $a=\\lceil\\sqrt n\\rceil$ 起递增，检查 $a^2-n$ 是否为完全平方 $b^2$；一旦是，$p=a-b,\\ q=a+b$。$|p-q|$ 越小收敛越快。",
    usage: "输入框填 n，设最大迭代次数，自动找 p、q。",
    examples: [{ in: "n=...", out: "p=..., q=..." }],
    formulas: [{ tex: "n = a^2 - b^2 = (a-b)(a+b)", caption: "费马分解" }],
    tips: ["特征：p、q 位数接近、生成时刻意相邻 → Fermat 几步就出。"],
    aka: ["fermat factorization", "费马分解", "费马因式分解", "fermat", "费马分解法", "费马因子分解", "平方差分解", "pq相近攻击", "fermat's factorization", "费马方法", "近素数分解", "rsa fermat"],
  },

  rsaCrt: {
    what: "中国剩余定理：把「x 除以若干个两两互质的数各余多少」的方程组，合并出唯一的 x。CRT/广播攻击的基础。",
    principle:
      "解 $x \\equiv r_i \\pmod{m_i}$（$m_i$ 两两互质）。令 $M=\\prod m_i$、$M_i=M/m_i$、$t_i=M_i^{-1}\\bmod m_i$，则 $x \\equiv \\sum r_i M_i t_i \\pmod M$。",
    usage: "第一行填残差 r1,r2,…，第二行填模数 m1,m2,…（逗号分隔），自动合并求 x 并校验。",
    examples: [
      { in: "2,3,2\n3,5,7", out: "x = 23", desc: "x≡2(3)、≡3(5)、≡2(7) 的唯一解" },
    ],
    formulas: [{ tex: "x \\equiv \\sum_i r_i\\,M_i\\,(M_i^{-1}\\bmod m_i) \\pmod{M}", caption: "CRT 合并公式，M=∏mᵢ" }],
    tips: ["RSA Hastad 广播：同明文、同小 e、多个互质 n 各出一个密文，用 CRT 合并再开 e 次根。"],
    aka: ["中国剩余定理", "crt", "孙子定理", "chinese remainder", "chinese remainder theorem", "crt定理", "同余方程组", "孙子算经", "剩余定理", "rsa crt", "广播攻击", "中国余数定理"],
  },

 // ============ 哈希 / 校验 ============
  md5: {
    what: "最常见的哈希函数，把任意数据压成固定 128 位（32 个十六进制字符）。不可逆，但已不抗碰撞。",
    principle:
      "分块迭代压缩，输出固定 128 位。哈希是单向的：只能算 `数据→摘要`，不能反推。\n\n" +
      "CTF 里破 MD5 靠「猜原文再算一遍比对」——即字典/爆破，不是真的逆运算。",
    usage: "输入任意文本，输出其 MD5 摘要（单向）。想由摘要反查原文，用分析类的 hashDictCrack / rainbowQuery。",
    examples: [
      { in: "admin", out: "21232f297a57a5a743894a0e4a801fc3", desc: "32 位十六进制就是 MD5 长相" },
    ],
    tips: [
      "拿到 32 位十六进制串，先猜 MD5；40 位是 SHA-1，64 位是 SHA-256。不确定用 hashTypeIdentify。",
      "MD5 不可逆，题目让你「解密 MD5」实际是让你爆破弱口令。",
    ],
    aka: ["message digest 5", "md-5", "md5", "md5哈希", "md5摘要", "报文摘要算法5", "md5 hash", "信息摘要算法", "32位哈希", "md5加密", "md5校验", "消息摘要5"],
  },

  sha1: {
    what: "输出 160 位（40 个十六进制字符）的哈希，比 MD5 稍长，同样已不推荐用于安全场景。",
    principle: "分块迭代压缩，输出 160 位固定摘要。单向不可逆。",
    usage: "输入文本，输出 SHA-1 摘要。反查用 hashDictCrack。",
    examples: [{ in: "admin", out: "d033e22ae348aeb5660fc2140aec35850c4da997" }],
    tips: ["40 位十六进制 → SHA-1。"],
    aka: ["sha-1", "secure hash 1", "sha1", "安全哈希算法1", "sha1哈希", "sha1摘要", "sha-1 hash", "40位哈希", "安全散列算法1", "sha1校验", "secure hash algorithm 1", "sha1加密"],
  },

  sha256: {
    what: "SHA-2 家族里最常用的一档，输出 256 位（64 个十六进制字符）。比特币、证书、口令存储都靠它。",
    principle: "分块迭代压缩输出 256 位。目前抗碰撞良好，安全场景主力。单向不可逆。",
    usage: "输入文本，输出 SHA-256 摘要。反查弱口令用 hashDictCrack。",
    examples: [{ in: "admin", out: "8c6976e5b5410415bde908bd4dee15dfb167a9c873fc4bb8a81f6f2ab448a918" }],
    tips: ["64 位十六进制 → SHA-256。"],
    aka: ["sha-256", "sha2-256", "sha256", "安全哈希算法256", "sha256哈希", "sha256摘要", "sha-2", "64位哈希", "安全散列256", "sha256校验", "secure hash 256", "sha2 256"],
  },

  sha512: {
    what: "SHA-2 家族的长档，输出 512 位（128 个十六进制字符）。",
    principle: "64 位字运算的分块迭代压缩，输出 512 位。单向不可逆。",
    usage: "输入文本，输出 SHA-512 摘要。",
    examples: [{ in: "abc", out: "ddaf35a1…（128 位十六进制）" }],
    tips: ["128 位十六进制 → SHA-512。"],
    aka: ["sha-512", "sha2-512", "sha512", "安全哈希算法512", "sha512哈希", "sha512摘要", "128位哈希", "安全散列512", "sha512校验", "secure hash 512", "sha2 512", "sha512加密"],
  },

  hmac: {
    what: "带密钥的哈希，用来验证消息「没被篡改且来自持钥方」。JWT 的 HS256 签名就是 HMAC。",
    principle:
      "$\\text{HMAC}(K,m) = H\\big((K\\oplus opad)\\,\\|\\,H((K\\oplus ipad)\\,\\|\\,m)\\big)$。把密钥揉进两层哈希，没密钥算不出正确值。",
    usage: "填密钥、选底层哈希算法（SHA-1/256/…），输入消息，输出 HMAC 值。",
    examples: [{ in: "hello", param: "key=secret, SHA-256", out: "HMAC 值" }],
    formulas: [{ tex: "\\text{HMAC}(K,m)=H\\big((K\\oplus opad)\\|H((K\\oplus ipad)\\|m)\\big)", caption: "HMAC 双层结构" }],
    tips: ["JWT 弱密钥题：拿签名和 header.payload 用 hmacKeyBrute 爆破 key。"],
    aka: ["hash mac", "消息认证码", "hmac-sha256", "hmac", "带密钥哈希", "keyed hash", "hash-based mac", "hmac-sha1", "消息鉴别码", "散列消息认证码", "hmac算法", "jwt签名"],
  },

  ntlm: {
    what: "Windows 存口令用的哈希，本质是把 UTF-16LE 口令做一次 MD4。取证/域渗透题常见。",
    principle: "$\\text{NTLM} = \\text{MD4}(\\text{UTF-16LE}(password))$。长得和 MD5 一样是 32 位十六进制，但算法不同。",
    usage: "输入口令，输出 NTLM 哈希。反查用 hashDictCrack（支持 NTLM）。",
    examples: [{ in: "password", out: "8846f7eaee8fb117ad06bdd830b7586c" }],
    tips: ["32 位十六进制但题目背景是 Windows/SAM/域，优先按 NTLM 而非 MD5 试。"],
    aka: ["nt hash", "ntlm hash", "windows口令哈希", "ntlm", "nt哈希", "md4哈希", "windows密码哈希", "网络登录哈希", "ntlm认证", "windows hash", "md4 utf16", "域口令哈希"],
  },

  hashTypeIdentify: {
    what: "拿到一串哈希先别急着爆破——先用它判断这是什么算法（MD5？SHA？NTLM？bcrypt？）。",
    principle: "综合长度、字符集、特征前缀（如 `$2y$` 是 bcrypt、`$1$` 是 crypt-md5）给出候选算法排名。",
    usage: "把哈希串粘进来，输出可能的算法类型列表。确定类型后再选对应爆破工具。",
    examples: [
      { in: "21232f297a57a5a743894a0e4a801fc3", out: "MD5 / NTLM (32 hex)" },
      { in: "$2y$10$...", out: "bcrypt" },
    ],
    tips: ["爆破前必做这一步，省得拿 SHA-256 的串去撞 MD5。"],
    aka: ["hash id", "哈希识别", "identify hash", "哈希类型"],
  },

  hashDictCrack: {
    what: "字典爆破：用一堆常见口令逐个算哈希，撞中就还原出原文。「解密哈希」题的真正做法。",
    principle: "对字典里每个候选算哈希，和目标比对，命中即原文。内置弱口令+纯数字+日期小字典，大字典需自行导入。",
    usage: "选哈希类型（MD5/SHA1/SHA256/NTLM）、粘目标哈希，跑字典爆破。",
    examples: [
      { in: "21232f297a57a5a743894a0e4a801fc3", param: "MD5", out: "admin", desc: "命中弱口令字典" },
    ],
    tips: ["先 hashTypeIdentify 定类型；内置字典撞不中就导入 rockyou 等大字典。"],
    aka: ["dictionary crack", "字典爆破", "哈希爆破", "撞库"],
  },

 // ============ 分析类：频率/异或爆破 ============
  xorBrute: {
    what: "单字节异或爆破：不知道 key 时，把 0~255 全试一遍，看哪个结果像人话。",
    principle: "对整段密文分别异或 0x00~0xFF 共 256 种单字节 key，输出全部（或只留全可打印 ASCII 的）结果供肉眼挑。",
    usage: "粘密文，跑爆破；勾选「仅可打印」能过滤掉乱码，快速锁定正确 key。",
    examples: [
      { in: "hex 密文", out: "256 行结果，其中一行是明文", desc: "找含 flag{ 的那行" },
    ],
    tips: ["配合 crib（如已知 flag 前缀）能一步筛出正确 key。多字节 key 用不了它，得先估 key 长度。"],
    aka: ["xor brute", "单字节异或爆破", "异或爆破"],
  },

  freqAnalysis: {
    what: "频率分析：统计字母出现频率，是破单表替换/凯撒/维吉尼亚的第一把钥匙。",
    principle:
      "英文里 `e t a o i n` 等字母天生高频。单表替换只是换了字母长相、没换频率分布，所以统计密文字母频率、和英语标准频率对齐，就能猜替换关系。\n\n" +
      "还给双字母（th/he）、三字母（the/and）统计，进一步定位。",
    usage: "粘密文，输出单/双/三字母频率 + 条形图数据。破单表替换时对照英语频率手工或用 subCipherSolver 自动解。",
    examples: [{ in: "密文", out: "字母频率排行 + n-gram 统计" }],
    tips: ["密文越长频率越准。太短（几十字符）频率分析不可靠。"],
    aka: ["frequency analysis", "词频分析", "字频统计", "n-gram"],
  },
};
