// 科普内容分片：T359 批（v0.1.6beta 收口）34 个新 op 的科普卡——RSA/ECDSA/ML-KEM/证书/CMAC/Ascon/JWT/Flask session 等。
// 纯数据，无 import 无副作用。examples 的 out 全部是 node 直跑真实输出摘录（RFC 官方向量已逐字核对），未编造。
export default {
  rsaGenKeyPair: {
    what: "本地生成一对 RSA 公私钥：私钥 (n,d) 自己留着，公钥 (n,e) 发给别人。全程在浏览器里算，不联网。",
    principle:
      "RSA 的骨料是两个大素数：随机生成 p、q，模数 $n = pq$，公钥指数 $e$ 常取 65537，私钥指数 $d = e^{-1} \\bmod \\varphi(n)$。\n\n" +
      "p/q 用 Miller-Rabin 检验（复用 primeGen 的实现），生成完自检 p/q 素性、$n=p \\cdot q$、$e d \\equiv 1 \\pmod{\\varphi(n)}$、加解密往返。输出除十进制全量参数外还打包 PEM（PKCS#1 / PKCS#8 / SPKI 三选一，DER 编码按 ITU-T X.690）。\n\n" +
      "位数的现实意义：512/1024 位已被现实攻破只配教学（512 位数秒出、4096 位要数秒会卡页面属预期），真实使用至少 2048 位。",
    usage: "选密钥位数（512 教学用 / 1024 / 2048 默认 / 3072 / 4096）、公钥指数 e、PEM 格式，运行即得十进制参数与 PEM。每次生成都不同。",
    examples: [
      { in: "（空输入，直接运行）", param: "512 位 / e=65537 / PKCS#1", out: "n = 8069550491692082330377286847863515305680292150278892430914085858082925870257619552073276451609584848017265413618681368440159046434924842873899795424569847 …（十进制 n/e/d/p/q/dp/dq/qinv + BEGIN RSA PRIVATE KEY PEM）", desc: "随机生成，每次不同；末尾提示 512 位仅供教学" },
    ],
    tips: [
      "CTF 里拿到 n 要判断位数：十进制转 BigInt 看 bitLength（bigCalc 的 bitLen 运算），位数直接决定能不能上指数/分解类攻击。",
      "题目只给 (n,e,d) 要还原 p/q：用 dp/dq 或 $e d - 1$ 做分解（经典做法：$k\\varphi(n)+1$ 的 2 的幂次提取）。",
      "PEM 三种格式别混：PKCS#1 头是 RSA PRIVATE KEY，PKCS#8 头是 PRIVATE KEY，SPKI 是 PUBLIC KEY——后续 PEM→JWK/私钥→公钥都认。",
    ],
    aka: ["rsa密钥生成", "生成rsa密钥对", "rsa keygen", "rsa key generator", "rsa keypair", "rsa密钥对生成", "openssl genrsa", "openssl genpkey", "rsa私钥生成", "生成rsa公私钥", "rsa 2048", "rsa-2048", "公私钥对生成", "rsa key pair generator", "非对称密钥生成"],
  },

  ecdsaKeyGen: {
    what: "生成椭圆曲线（ECDSA）密钥对：私钥是一个标量 d，公钥是曲线上一个点 $Q = d \\cdot G$。支持 secp256k1 和 NIST P-256/P-384/P-521。",
    principle:
      "私钥 d 从 $[1,\\ n-1]$ 随机抽（crypto.getRandomValues 拒绝采样保证无偏），公钥 $Q = d \\cdot G$ 是生成元 G 的 d 倍点。\n\n" +
      "椭圆曲线密码的看家本领：算 $d \\cdot G$ 很快，但从 Q 反推 d 是椭圆曲线离散对数问题（ECDLP），目前没有多项式算法——所以公钥可以随便发。\n\n" +
      "公钥给两种写法：非压缩 `04‖X‖Y`（65 字节）与压缩 `02/03‖X`（33 字节，Y 的奇偶藏在 02 还是 03 里）。域参数取自 SEC 2 v2.0 与 FIPS 186-4 D.1.2。",
    usage: "选曲线与公钥主格式运行即可。secp256k1 是比特币/以太坊那根曲线，P-256 是 TLS/JWT ES256 那根，别选错。",
    examples: [
      { in: "（空输入，直接运行）", param: "curve=secp256k1", out: "私钥 d（64 位 hex） + 公钥非压缩 04…（130 hex 字符）与压缩 02/03…（66 hex 字符）双格式", desc: "随机生成，每次不同" },
    ],
    tips: [
      "secp256k1 的私钥直接就是比特币/以太坊钱包私钥的原始形态（以太坊地址 = keccak256(公钥非压缩去 04 头) 的后 20 字节）。",
      "压缩公钥 33 字节开头 02/03 表示 Y 坐标奇偶；非压缩 65 字节开头 04。验签工具两者都收，但有些库只认一种。",
      "同一私钥在不同曲线上毫无关系——d 必须配对所属曲线用。",
    ],
    aka: ["ecdsa密钥生成", "椭圆曲线密钥生成", "ecdsa keygen", "ecc密钥对生成", "椭圆曲线密钥对", "ec key generator", "openssl ecparam", "openssl ec -genkey", "secp256k1密钥", "p-256密钥", "ecdsa key pair", "ecc keygen", "比特币密钥生成", "以太坊密钥生成", "生成椭圆曲线密钥"],
  },

  ecdsaSign: {
    what: "用椭圆曲线私钥给消息做数字签名（ECDSA）。支持 RFC 6979 确定 k（可复现）与随机 k 两种模式。",
    principle:
      "先哈希消息得 e = H(msg)，签名时抽临时随机数 k，算 $r = (kG)\\ x \\bmod n$、$s = k^{-1}(e + r d) \\bmod n$，签名就是 (r, s)。\n\n" +
      "k 是 ECDSA 的命门：k 重用或泄露 → 私钥直接被解（CTF 经典题 ecdsaReuseK）；k 有偏差也能被格攻击恢（Hidden Number Problem）。RFC 6979 用 HMAC(d, e) 派生确定 k，同钥同文签名必相同，教学复现友好。\n\n" +
      "输出 r/s 的十进制+hex、DER hex（ASN.1 编码）与所用 k，验算走「ECDSA 验签」。RFC 6979 A.2.5 官方向量逐字验证。",
    usage: "消息（text/hex）+ 私钥 d，选曲线（secp256k1/P-256/P-384/P-521）与哈希（SHA-256/384/512）、k 模式。默认 RFC 6979，结果可复现。",
    examples: [
      { in: "sample", param: "curve=P-256, sha256, RFC 6979, d=C9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721", out: "r (hex) = efd48b2aacb6a8fd1140dd9cd45e81d69d2c877b56aaf991c34d0ea84eaf3716 / s (hex) = f7cb1c942d657c41d436c7a1b6e29f65f3e900dbb9aff4064dc4ab2f843acda8", desc: "RFC 6979 A.2.5 官方向量，逐字一致" },
      { in: "同上再跑一次", out: "r/s 完全相同", desc: "确定 k 的可复现性" },
    ],
    tips: [
      "比特币/以太坊约定低 s（BIP62）：s > n/2 时换成 n-s，工具会给出候选提示但不自动替换。",
      "消息编码别选错：text 是按 UTF-8 哈希整条消息，很多链上签名实际是对「消息前缀+消息」再哈希，先看题面。",
      "同一 k 签两条不同消息 → $k = (e1-e2)/(s1-s2)$，私钥 $d = (s1 \\cdot k - e1)/r$，这是 ecdsaReuseK 攻击的算式。",
    ],
    aka: ["ecdsa签名", "椭圆曲线签名", "ecdsa sign", "ecdsa signature", "rfc 6979", "确定性签名", "deterministic ecdsa", "ecdsa签名生成", "elliptic curve digital signature algorithm", "椭圆曲线数字签名", "ecc签名", "secp256k1签名", "p-256签名", "私钥签名", "数字签名生成"],
  },

  ecdsaVerify: {
    what: "拿椭圆曲线公钥验证一条 ECDSA 签名：合法还是不合法，中间量 w/u1/u2/R 全过程给你看。",
    principle:
      "验签是把签名算式倒着走：$w = s^{-1} \\bmod n$，$u_1 = e·w$，$u_2 = r·w$，算点 $R = u_1 G + u_2 Q$，若 $R.x \\bmod n = r$ 则合法。\n\n" +
      "公钥自动识别压缩 `02/03‖X`、非压缩 `04‖X‖Y`、裸 `X‖Y` hex，特殊值 G=生成元；签名自动识别 raw（r;s 十进制或 hex）与 DER hex（ASN.1 SEQUENCE）。",
    usage: "消息 + 公钥 Q + 签名，选曲线与哈希（必须与签发时一致，否则必失败）。",
    examples: [
      { in: "sample", param: "curve=P-256, sha256, pub=0460FED4BA…4462299（非压缩），sig=r;s（ECDSA 签名产物）", out: "w = 69880503463384056598514622327964816651803683313052280065095964100306410098411 … R = u1·G + u2·Q → ✓ 签名合法（v == r）", desc: "与「ECDSA 签名」RFC 6979 官方向量配套" },
    ],
    tips: [
      "验签失败三连查：曲线选没选对、哈希选没选对、消息编码 text/hex 是否与签名时一致——参数错一个都不过。",
      "DER 签名直接整段粘 hex 即可（3046/3044 开头），工具自己拆 r/s。",
      "题目给了 (r, s) 让你伪造合法签名？没有私钥做不了，除非那条曲线的 n 与哈希截断有坑（如 e > n 时未取模）。",
    ],
    aka: ["ecdsa验签", "椭圆曲线验签", "ecdsa verify", "ecdsa signature verification", "验证签名", "椭圆曲线签名验证", "ecc验签", "数字签名验证", "ecdsa signature check", "verify ecdsa signature", "签名校验", "u1 u2 计算", "验签工具", "signature verifier"],
  },

  ecdsaSigConvert: {
    what: "ECDSA 签名的三种常见格式互转：raw（r;s 或定宽 hex）、DER（ASN.1）、JOSE（r||s 定宽 base64url）。",
    principle:
      "同一对 (r,s) 有三种皮：\n\n" +
      "- raw：`r;s` 十进制分号分隔，或 r、s 各按曲线元素宽（P-256=32 字节）拼 hex；\n" +
      "- DER：ASN.1 `SEQUENCE{INTEGER r, INTEGER s}`（ITU-T X.690），前导零字节有就加（02 21 00 …）；\n" +
      "- JOSE：r、s 定宽直接拼字节再 base64url，JWT 的 ES256 签名就是这个（RFC 7515）。\n\n" +
      "曲线参数决定定宽字节数（secp256k1/P-256=32、P-384=48、P-521=66）。",
    usage: "粘贴签名，选输入/输出格式与曲线（定宽用）。r;s 十进制、0x hex、DER hex 都能当输入。",
    examples: [
      { in: "3046022100efd48b2aacb6a8fd1140dd9cd45e81d69d2c877b56aaf991c34d0ea84eaf3716022100f7cb1c942d657c41d436c7a1b6e29f65f3e900dbb9aff4064dc4ab2f843acda8", param: "DER → JOSE, P-256", out: "JOSE = 79SLKqy2qP0RQN2c1F6B1p0sh3tWqvmRw00OqE6vNxb3yxyULWV8QdQ2x6G24p9l8-kA27mv9AZNxKsvhDrNqA", desc: "同页附 raw/DER/JOSE 全格式对照" },
    ],
    tips: [
      "JWT ES256 验签失败十有八九是格式：JWT 里是 JOSE 定宽，openssl 给的是 DER，先转再比。",
      "DER 里 INTEGER 有前导 00 是正常的（X.690 正数最高位为 1 时防歧义），不是填充错误。",
      "以太坊那种 65 字节 r||s||v 不属于这三种标准皮，v(27/28 或 0/1) 要单独处理。",
    ],
    aka: ["签名格式转换", "ecdsa签名转换", "der转raw", "raw转der", "der to raw", "der signature", "asn.1签名", "jose签名", "base64url签名", "定宽签名", "ecdsa signature format", "签名互转", "der转jose", "r;s", "r||s"],
  },

  eccCalc: {
    what: "椭圆曲线点运算计算器：点加、点减、标量乘、倍点，预设四条常用曲线或自定义 p/a/b/G。",
    principle:
      "椭圆曲线 $y^2 = x^3 + ax + b \\pmod{p}$ 上的点有套几何加法：两点相加是连线与曲线的第三点取负，自加即倍点。标量乘 $k \\cdot P$ 就是反复倍点相加（double-and-add）。\n\n" +
      "点支持压缩 `02/03‖X`、非压缩 `04‖X‖Y`、裸 `X‖Y`，特殊值 G（生成元）和 O（无穷远点，加法单位元）；k 支持十进制/0x hex/负数（负 k = $|k| \\cdot (-P)$）。\n\n" +
      "做 ECDH、ECDSA、SM2 手算题时全程靠它；离散对数（从 Q 反推 d）没有工具能算，那正是安全性的来源。",
    usage: "选运算（add/sub/mul/double）与曲线，填点 P（点加/点减再填 Q，标量乘再填 k）。自定义曲线填 p/a/b/Gx/Gy/n。",
    examples: [
      { in: "P=G, k=2", param: "标量乘, secp256k1", out: "非压缩 = 04c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee51ae168fea63dc339a3c58419466ceaeef7f632653266d0e1236431a950cfe52a", desc: "secp256k1 的 2G，与公开常数一致" },
      { in: "P=04c604…cfe52a（2G）", param: "倍点, secp256k1", out: "非压缩 = 04e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd1351ed993ea0d455b75642e2098ea51448d967ae33bfbdfe40cfe97bdc47739922", desc: "2G 再倍点 = 4G" },
    ],
    tips: [
      "解「已知 Q 和 G 求 k」的题不是算出来的：位数小就 BSGS/暴力，大了就该换攻击思路（曲线参数有鬼：相同 a、b 或 n=p 的异常曲线）。",
      "结果出现 Infinity 就是撞到无穷远点（比如 P + (-P)），属正常运算结果。",
      "自定义曲线记得填 n（子群阶），标量乘取模和负 k 都用到它。",
    ],
    aka: ["椭圆曲线计算器", "ecc计算器", "ecc calculator", "点加", "点乘", "标量乘", "倍点", "point addition", "scalar multiplication", "ec point multiplication", "椭圆曲线点运算", "曲线点计算", "secp256k1计算", "生成元g", "无穷远点", "double and add"],
  },

  bigCalc: {
    what: "BigInt 大整数计算器：四则、模幂、模逆、gcd/extgcd/lcm、素性、邻素数、素因子分解、开方、位长——RSA/ECC 手算题的全套工具。",
    principle:
      "全程 BigInt 精确运算，位数不限不丢精度。除法 div 是截断除（商向零取整），mod 符号随被除数（同 BigInt/JS 语义，与 Python 的 floor mod 不同）。\n\n" +
      "分解走试除 + Pollard rho（Brent 加速）：小因子先试除剥掉，剩下的大合数交给 rho 找分裂点，再递归。\n\n" +
      "素性判定复用 primeTest 的确定性 Miller-Rabin（$n < 3.3 \\times 10^{24}$ 固定 witness 集），不会像单独费马测试那样被卡迈克尔数骗。",
    usage: "选运算，填 a（与 b/m）。单参运算（isPrime/nextPrime/factor/sqrtInt/bitLen 等）b、m 留空。",
    examples: [
      { in: "a=123456789, b=65537, m=1000000007", param: "modpow", out: "560583526", desc: "模幂 123456789^65537 mod 1e9+7" },
      { in: "a=3, m=1000000007", param: "modinv", out: "333333336", desc: "3 的逆元 mod 1e9+7（3×333333336 ≡ 1）" },
      { in: "a=600851475143", param: "factor", out: "600851475143 = 71 × 839 × 1471 × 6857", desc: "Project Euler 3 经典分解" },
    ],
    tips: [
      "RSA 手算三件套：modpow 算 $c^{d} \\bmod n$，modinv 求 d 或 qinv，extgcd 的贝祖系数直接当逆元用。",
      "mod 的符号约定要看清：本工具 $-7 \\bmod 3 = -1$（随被除数），Python 里是 2，跨语言对拍别冤枉自己。",
      "分解 $2^{64}$ 以内的数秒出；更大的先丢 primeTest 确认是合数再动手。",
    ],
    aka: ["大数计算器", "大整数计算", "bigint计算器", "大数运算", "模幂", "幂模运算", "modpow", "模逆", "modinv", "求逆元", "扩展欧几里得", "extgcd", "素因子分解", "pollard rho", "big integer calculator", "modular exponentiation"],
  },

  primeTest: {
    what: "判定一个大整数是不是素数，附位长与所用方法说明。Miller-Rabin 检验，小数字走确定性判定。",
    principle:
      "费马小定理的加强版：对随机基 a 若 $a^{n-1} \\not\\equiv 1$ 或中间步骤出现「1 的非平凡平方根」，n 必是合数。\n\n" +
      "$n < 3.3 \\times 10^{24}$ 时用 13 个固定质数 witness 即可确定性判定（FIPS 186-4 Table C.2）；更大的 n 按轮数随机判定，误判概率 $< 4^{-\\mathrm{rounds}}$（FIPS 186-5 App. B；本实现取前若干小质数为固定基）。\n\n" +
      "Miller-Rabin 强于费马测试：卡迈克尔数（费马测试的克星）骗不过它。",
    usage: "n 填十进制大整数，轮数默认 24。输出 判定/位长/方法 三行。",
    examples: [
      { in: "170141183460469231731687303715884105727", param: "rounds=24", out: "判定：素数 / 位长：127 位（二进制）", desc: "梅森素数 2^127-1" },
      { in: "340282366920938463463374607431768211457", param: "rounds=24", out: "判定：合数 / 位长：129 位（二进制）", desc: "费马数 F7 = 2^128+1，已知因子 59649589127497217" },
    ],
    tips: [
      "RSA 题里 n 是合数（=pq）直接被判「合数」，这不代表 n 弱——重点是位数和因子形状。",
      "$2^{127}-1$ 这类梅森素数是检验「工具没坏」的标准样本；卡迈克尔数（如 561、41041）是检验「不是裸费马」的样本。",
      "确定性判定只覆盖到 $3.3 \\times 10^{24}$（约 81 位），再大就是概率意义——24 轮误判概率 $< 4^{-24}$，做题够用。",
    ],
    aka: ["素性检验", "素数判定", "质数判断", "miller-rabin", "米勒拉宾", "miller rabin test", "primality test", "素数测试", "isprime", "prime checker", "大素数判定", "强伪素数", "素数检验", "primality"],
  },

  elgamalKeyGen: {
    what: "一键生成 ElGamal 密钥对：安全素数 $p=2q+1$、原根 g、私钥 x、公钥 $y=g^{x}$，产物直接喂给「ElGamal」加解密 op。",
    principle:
      "ElGamal 建在离散对数上（HAC §8.4.1）：选安全素数 p（$p=2q+1$，q 也是素数）与原根 g，私钥 x 随机，公钥 $y = g^x \\bmod p$。\n\n" +
      "$p=2q+1$ 的好处：乘法群的子群阶是素数 q，无小子群攻击面；g 取原根时全体非 1 元素都生成大子群。生成时先造 q 再验 p=2q+1，勾选可看中间量。\n\n" +
      "与 ElGamal 加密 op 的对接：加密填 p/g/y，解密填 p/x。",
    usage: "选素数 p 位长（128 教学用 / 256 / 512 / 1024），运行。默认附 q 与中间量便于验算。",
    examples: [
      { in: "（空输入，直接运行）", param: "128 位", out: "素数 p = 303424230213264651417773451274662581027 / 公钥 g = 2 / 公钥 y = 181344096147371296112314154353872950019 / 私钥 x = 5413983650783152715765123558362946122（y=g^x 可自查）", desc: "随机生成，每次不同" },
    ],
    tips: [
      "ElGamal 是随机加密：同明文两次加密密文不同（r 随机），别拿「两次结果不一样」当 bug。",
      "手算验 $y = g^{x} \\bmod p$ 用 bigCalc 的 modpow，一致说明密钥对自洽。",
      "ElGamal 的 CTF 攻击面主要在离散对数可解（p 小 / p-1 光滑 / 共享 r），密钥生成本身不是考点。",
    ],
    aka: ["elgamal密钥生成", "elgamal keygen", "el gamal", "elgamal密钥对", "安全素数", "safe prime", "原根", "primitive root", "elgamal公钥", "生成elgamal密钥", "elgamal key generator", "离散对数密钥", "p=2q+1", "elgamal 参数生成"],
  },

  rsaSign: {
    what: "RSA 签名：RSASSA-PKCS#1 v1.5 与 PSS 两种模式（RFC 8017），私钥支持十进制 (n,d) 或 PEM。",
    principle:
      "v1.5 是「拼模板再解密」：消息哈希后包进 DigestInfo，前补 0001 + 一串 FF + 00 成 EM，签名 $s = EM^d \\bmod n$——确定性签名，同钥同文永远同结果。\n\n" +
      "PSS 是「加盐再哈希」：EM 里埋随机盐，通过 MGF1 掩码生成 DB，签名同上——每次盐不同所以两次签名不同，这是设计不是 bug（抗某些选择密文攻击）。\n\n" +
      "私钥认三种：十进制 n,d；PKCS#1 RSA PRIVATE KEY PEM；PKCS#8 PRIVATE KEY PEM。PSS 盐长默认 hLen，可调 0/16/20/32/max。",
    usage: "消息 + 私钥（选形式），签名模式/哈希/盐长按需。输出签名 hex 与十进制、EM 全量中间量。",
    examples: [
      { in: "attack at dawn", param: "PKCS#1 v1.5, SHA-256, 1024 位 PKCS#8 PEM 私钥", out: "签名 s (hex, 128 字节) = 798e63c8301652200538d6be40351785558719724596f24c4260bdb614481ce4e6b92886b70ee196a3fb9afc183d5fd7411d9700b7cd5817b5bf2c6130cc3d05969c973af3dd5e20b5a3567fa5a868d056d80da29cce3d76c722f9f2ee036bedf6ba96b23428befda5e0a5f043773749cf7610a12162be589d91d983ac3d80ee", desc: "确定性：换钥前重跑逐字节相同，可与 openssl dgst -sha256 -sign 对拍" },
      { in: "同消息换 PSS 模式", param: "PSS, SHA-256, sLen=hLen", out: "两次运行签名不同（随机盐），属预期", desc: "PSS 的随机性" },
    ],
    tips: [
      "512 位模数跑不了 SHA-256 以上的 PSS（emLen < hLen+sLen+2 直接报错），换大钥或减盐长。",
      "CTF 经典「Bleichenbacher'06 签名伪造」针对验证端没查 FF 填充长度——验签端逐字节比对的重要性看本工具「RSA 验签」的输出就懂。",
      "签名 ≠ 加密：签的是哈希的编码块，不是明文本身；别拿解密 op 反推 EM 当签名用。",
    ],
    aka: ["rsa签名", "rsa sign", "rsassa", "rsassa-pkcs1-v1_5", "pkcs1 v1.5", "rsassa-pss", "pss签名", "rsa私钥签名", "sha256withrsa", "rsa sha256签名", "openssl dgst -sign", "rsa signature", "消息签名", "数字签名rsa"],
  },

  rsaVerify: {
    what: "RSA 验签：用公钥验证签名合法性，v1.5 与 PSS 双模式（RFC 8017 §8.2.2/§8.1.2），失败时精确到第几字节哪里不符。",
    principle:
      "v1.5 验签：算 $m = s^e \\bmod n$ 恢复 EM，与本地重算的期望 EM（0001 FF…FF 00 DigestInfo）逐字节比对——头部、FF 长度、OID、摘要哪一环不对都指出来。\n\n" +
      "PSS 验签：查 EM 里的 0xbc 哨兵、DB 掩码还原（MGF1）、左端零、盐与哈希重算比对；盐长可选 auto 反推。\n\n" +
      "公钥认十进制 (n,e) 或 PEM（PUBLIC KEY SPKI / RSA PUBLIC KEY），签名认 hex 或十进制。",
    usage: "消息 + 签名 + 公钥（选形式），模式/哈希须与签发一致。PSS 验签时盐长要与签发一致或选 auto。",
    examples: [
      { in: "attack at dawn + 「RSA 签名」产物签名", param: "PKCS#1 v1.5, SHA-256, 公钥 PEM", out: "验签结果：合法 ✓（恢复的 EM 与期望 EM 逐字节一致，PS 长度 74 字节）", desc: "正例" },
      { in: "attack at dusk（同一签名）", param: "同上", out: "验签结果：不合法 ×（原因：DigestInfo/摘要区（第 96 字节）与期望不符）", desc: "换一个字符即拒，且指出位置" },
    ],
    tips: [
      "v1.5 验签的严格性是安全底线：老 Bleichenbacher 攻击就是钻「验证只看摘要不查 FF 填充」的空子伪造证书签名。",
      "PSS 验签失败先查盐长：签发端 sLen=hLen 是默认，auto 能容忍未知盐长。",
      "「合法」只代表签名与 (消息, 公钥) 匹配——公钥是不是本人的，得靠证书链（x509Parse）回答。",
    ],
    aka: ["rsa验签", "rsa verify", "rsassa验签", "rsa signature verification", "验证rsa签名", "openssl dgst -verify", "rsa公钥验签", "sha256withrsa验证", "签名验证rsa", "验签工具rsa", "verify rsa signature", "em恢复"],
  },

  jwtSign: {
    what: "签发一个 JWT（JSON Web Token）：填 payload JSON 和密钥，出完整三段式 token。支持 HS256/384/512、RS256、ES256。",
    principle:
      "JWT = `header.payload.signature` 三段，各段 base64url（RFC 4648 §5，无 padding）：\n\n" +
      "- header：{\"alg\":…, \"typ\":\"JWT\"}，alg 决定签名算法；\n" +
      "- payload：你的 claims（RFC 7519 §4），整段只是编码不是加密——别放秘密；\n" +
      "- signature：对 `header.payload` 这个字符串签名（HS* 是 HMAC，RS256 是 RSA PKCS#1 v1.5 SHA-256，ES256 是 ECDSA P-256 + JOSE 格式签名，RFC 7515/7518）。\n\n" +
      "alg=none 的空签名漏洞是老黄历：正规库都拒绝 none，但伪造 header 里 alg 互换（RS256→HS256 用公钥当 HMAC 密钥）的题还常见。",
    usage: "主输入框填 payload JSON（必须合法 JSON），按 alg 填密钥：HS* 填 secret 文本；RS256 填 n、d（hex 或十进制）；ES256 填 P-256 私钥 d。可选 kid 写进 header。",
    examples: [
      { in: '{"sub":"1234567890","name":"John Doe","admin":true,"iat":1516239022}', param: "HS256, secret=secret", out: "JWT = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWUsImlhdCI6MTUxNjIzOTAyMn0.39jkN-bckg4fbZQEb0xHIxzYL9qI_g4c4WyzEYNHZok", desc: "jwt.io 风格经典 payload" },
      { in: '{"sub":"t359"}', param: "ES256, P-256 私钥 d=C9AFA9D8…F6721", out: "签名 64 字节 JOSE 定宽 r||s，JWT = eyJhbGciOiJFUzI1NiIs…（RFC 6979 确定 k，可复现）", desc: "ECDSA 确定性签发" },
    ],
    tips: [
      "改 payload 里的 claims（admin: true）后必须重签，直接改中段会让第三段对不上——验签端一票否决。",
      "payload 是明文！拿 token 去 jwtVerify 或 base64 解码就能看，flag 藏 claims 里直接解，藏密钥里就等着被泄。",
      "CTF 常见利用链：拿到 RSA 公钥 → 把 token 的 alg 改 HS256 用公钥 PEM 文本当 secret 签 → 服务端若用同一公钥验 HMAC 就越权。",
    ],
    aka: ["jwt签发", "jwt生成", "jwt sign", "jwt encode", "json web token", "token生成", "生成token", "jwt编码", "jwt maker", "hs256", "hs384", "hs512", "rs256", "es256", "签发token", "jwt token generator"],
  },

  jwtVerify: {
    what: "JWT 验签：拆三段、解码 header/payload、用你给的密钥重算签名比对，明确指出不匹配的是哪一段。",
    principle:
      "结构检查（三段 base64url）→ 解码 header 看 alg → 用对应密钥对 `header.payload` 重算签名 → 与第三段常数比对。HS* 用 HMAC，RS256 用 (n,e) 公钥，ES256 用 P-256 公钥点。\n\n" +
      "三段任一环坏了都点名：header 不是 base64url、alg 不支持、签名长度不对、签名不匹配（重算值 vs 签名段并排给出）。",
    usage: "主输入框贴完整 JWT，按 alg 填密钥（HS* secret / RS256 的 n,e / ES256 的 04‖X‖Y 公钥）。",
    examples: [
      { in: "eyJhbGciOiJIUzI1NiIs…（jwtSign 产物）", param: "HS256, secret=secret", out: "✓ 签名匹配（signature 段校验通过）/ 结论: 合法（三段结构与签名均通过）", desc: "正例" },
      { in: "同一 token", param: "HS256, secret=wrong-secret", out: "✗ 签名不匹配（重算 HMAC = e8d016da… / 签名段 = dfd8e437…）/ 结论: 不合法", desc: "密钥错即拒，且并排展示两个值" },
    ],
    tips: [
      "先看 payload 再谈密钥：exp/nbf/aud 这些 claims 的逻辑漏洞（过期仍有效）验签是查不出来的，要人读。",
      "签名伪造题思路：alg=none 留空段、RS256→HS256 公钥重签、弱 secret 爆破（jwtCrack 就是专干这个的）。",
      "ES256 验签需要公钥点：私钥签出来的拿「ECDSA 签名」输出里的非压缩 04‖X‖Y 直接用。",
    ],
    aka: ["jwt验签", "jwt verify", "jwt解码", "jwt decode", "jwt校验", "jwt解析", "verify jwt", "验证token", "token验证", "jwt signature verification", "jwt.io", "检查jwt", "jwt checker", "jwt 签名验证"],
  },

  aesCmac: {
    what: "AES-CMAC 消息认证码（RFC 4493）：用 AES-128 密钥给消息生成 16 字节校验值 MAC，防篡改防伪造。",
    principle:
      "CMAC（aka OMAC1，NIST SP 800-38B）把分组密码变 MAC：密钥先算出两个子密钥 K1/K2（对全零块加密一次再左移，按最高位补 Rb），消息按 16 字节分组用 CBC-MAC 式链接加密，末块不足或整块时用 K1/K2 处理。\n\n" +
      "与 HMAC 的区别：CMAC 建在分组密码上（AES），HMAC 建在哈希上。嵌入式/金融 IC 卡领域 CMAC 更常见。\n\n" +
      "本实现按 RFC 4493（限 AES-128），官方向量全过。",
    usage: "填 16 字节 hex 密钥与消息（hex 或 text），运行得 16 字节 MAC。默认密钥就是 RFC 4493 测试密钥 2b7e1516…4f3c。",
    examples: [
      { in: "6bc1bee22e409f96e93d7e117393172a", param: "key=2b7e151628aed2a6abf7158809cf4f3c, hex", out: "T = AES-CMAC(K, M) = 070a16b46b4d4144f79bdd9dd04a287c", desc: "RFC 4493 Example 2，逐字一致" },
      { in: "（空消息）", param: "key=2b7e151628aed2a6abf7158809cf4f3c", out: "T = bb1d6929e95937287fa37d129b756746", desc: "RFC 4493 Example 1（空串也有 MAC）" },
    ],
    tips: [
      "MAC 不是加密：它只证明「消息+密钥」没被改，谁有密钥谁就能算——同一密钥双方都能伪造，不具签名性。",
      "题目给 CMAC 让你找规律时先想 K1/K2 派生：左移溢出补 0x87（Rb 常数）是 128 位 AES 的标志。",
      "与 HMAC-SHA256 输出长度都常见 32 字节，但 CMAC(AES-128) 恒 16 字节，长度本身就是提示。",
    ],
    aka: ["aes-cmac", "cmac", "omac1", "omac", "rfc 4493", "aes cmac", "nist sp 800-38b", "消息认证码", "mac计算", "cmac计算", "cmac生成", "mac校验", "aes-128 cmac", "cbc-mac", "mac tag"],
  },

  sm4Cmac: {
    what: "SM4-CMAC：用国密 SM4 分组密码按 CMAC 结构（ISO/IEC 9797-1 Method 2）算消息认证码。",
    principle:
      "结构与 AES-CMAC 完全同构（NIST SP 800-38B 的 CMAC 构造本就源自 Ikekawa-Matsumoto/Kurokawa-Ohta 的 OMAC 系）：K1/K2 子密钥派生、CBC 链接、末块特殊处理——只是把里面的分组密码换成 SM4。\n\n" +
      "SM4 是 128 位分组、GB/T 32907-2016 的国密算法；ISO/IEC 9797-1 是 MAC 构造的标准族。默认密钥 0123456789abcdeffedcba9876543210 即 GB/T 附录 A 测试密钥。",
    usage: "填 16 字节 hex 密钥与消息（hex 或 text），得 16 字节 MAC。",
    examples: [
      { in: "0123456789abcdeffedcba9876543210", param: "key=0123456789abcdeffedcba9876543210, hex", out: "T = SM4-CMAC(K, M) = 492950917932f9852dd47d1ba1aeb534", desc: "SM4 标准密钥+标准明文块" },
    ],
    tips: [
      "与 AES-CMAC 的差别只在内核分组密码：同样的 K/M 在两算法下 MAC 不同，先认准题面用哪个。",
      "国密协议里 SM4 的 MAC 更常见是 HMAC-SM3 或 SM3 摘要，CMAC 结构多见于海外标准套用到 SM4 的题目。",
      "密钥默认值就是 SM4 标准向量密钥，题目没给密钥时值得一试。",
    ],
    aka: ["sm4-cmac", "sm4 cmac", "国密cmac", "sm4消息认证码", "sm4 mac", "国密mac", "iso/iec 9797-1", "cmac sm4", "gb/t 32907", "sm4认证码", "国密mac计算", "sm4 cmac计算", "omac sm4"],
  },

  kmac: {
    what: "KMAC（Keccak MAC）：NIST SP 800-185 定义、基于 Keccak/cSHAKE 的消息认证码，KMAC128 与 KMAC256 双档。",
    principle:
      "KMAC = 带密钥的 SHA-3 家族 MAC：先做 bytepad(encode_string(K), rate) 把密钥前置于编码函数 new_bitstring(\"KMAC\")，定制串 S（customization）也进编码，消息接在后面走 cSHAKE128/256 海绵，按需出任意长度。\n\n" +
      "与 HMAC-SHA3 的区别：HMAC 套两层哈希是给 MD 型哈希补强度的，Keccak 海绵本来就不需要——KMAC 是「原生」方案，还支持定制串做域分离（不同用途 S 不同，MAC 互不通用）。\n\n" +
      "输出长度 L 字节可任选（KMAC128/KMAC256 指的是安全强度档位，不是摘要长度）。",
    usage: "选档位（128/256）、密钥 hex、定制串 S（text，可空）、消息（hex/text）、输出长度 L 字节。",
    examples: [
      { in: "000102", param: "KMAC128, key=404142434445464748494a4b4c4d4e4f, S=My Tagged Application, L=32", out: "KMAC128(K, X, L, S) = f227963f3cc6e696de257e5b42ca46a0c65f4073992eff24d24277e32f8b2f77", desc: "SP 800-185 样例密钥 40..4F" },
      { in: "0001020304", param: "KMAC256, key=40..5F（32B）, S=空, L=64", out: "KMAC256(K, X, L, S) = 99b190fd2f7a730b20528dc1890fa4d8d361ffd738195b3e8801991808e2bffe7f7e60a159f2eebf7b21a05a6e6672c5bf7401b18b88f06857f709310a92bbf4", desc: "64 字节长输出" },
    ],
    tips: [
      "定制串 S 是域分离的一部分：S 不同结果完全不同，对拍时 S 一个字符都不能差。",
      "KMAC128 配 cSHAKE128（rate 168 字节）、KMAC256 配 cSHAKE256（rate 136 字节），安全强度对应 128/256 位。",
      "和 SHAKE/vSHAKE 一家人：cSHAKE 是 KMAC/SHAKE 可定制的基座，看到 bytepad/KMAC 编码头就是这家族的指纹。",
    ],
    aka: ["kmac", "kmac128", "kmac256", "keccak mac", "nist sp 800-185", "cshake", "cshake128", "cshake256", "keccak消息认证码", "kmac计算", "keyed keccak", "sha-3 mac", "kmac 生成", "可定制mac", "domain separation mac"],
  },

  ascon: {
    what: "Ascon-AEAD128：NIST 2025 年轻量级密码标准（SP 800-232）里的认证加密——一条流水线同时做加密和防篡改。",
    principle:
      "Ascon 是 CAesar 竞赛冠军、NIST 轻量级密码（LWC）标准化项目胜者。AEAD128 用海绵结构：key/nonce 各 16 字节，初始化与终结跑 12 轮置换 p[12]，数据块跑 8 轮 p[8]，rate 128 位，小端字节序。\n\n" +
      "AEAD 的价值在「认证」：加密同时吃 aad（关联数据——不加密但要防篡改的头信息），末尾出 16 字节 tag。解密时 tag 对不上直接报错，密文被改一个 bit 都逃不掉。\n\n" +
      "注意版本：本工具是 2025 标准版（IV 0x00001000808c0001），与老 Ascon-128 v1.2 的参数互不通用，对拍要认准 SP 800-232。NIST LWC KAT + ACVP 官方向量验证。",
    usage: "选模式（加密/解密），key 与 nonce 各 16 字节 hex（加密时 nonce 可留空随机），可选 aad（text/hex）与 tag 长度。解密输入完整密文+tag。",
    examples: [
      { in: "ascon", param: "encrypt, key=000102030405060708090a0b0c0d0e0f, nonce=101112131415161718191a1b1c1d1e1f, aad=ascon", out: "密文 = 8d47855a81 / tag = 814432bbec572fe1d419f561d6633385（完整密文+tag: 8d47855a81814432bbec572fe1d419f561d6633385）", desc: "明文与 aad 同为 ascon" },
      { in: "8d47855a81814432bbec572fe1d419f561d6633385", param: "decrypt, 同 key/nonce/aad", out: "tag 校验: 通过 / 明文 = ascon", desc: "往返自洽" },
      { in: "上例 tag 改末字节 85→84", param: "decrypt, 同参数", out: "解密失败：tag 校验不符（密文、tag、key、nonce 或 aad 有误，或被篡改）", desc: "篡改即拒" },
    ],
    tips: [
      "CTF 里 Ascon 多出现在 IoT/嵌入式题；认 16 字节 key+nonce 与海绵结构。老题若是 v1.2 参数（IV 0x000008080c000001）结果会不同，先确认标准版。",
      "解密四要素 key/nonce/aad/tag 缺一不可：改 aad 一个字符 tag 也变——这就是「关联数据」的意义。",
      "nonce 绝不能重用：同 key 同 nonce 加两段明文，流密钥流复用，异或两条密文即双双泄露。",
    ],
    aka: ["ascon", "ascon-aead128", "ascon加密", "nist sp 800-232", "轻量级密码", "lightweight cryptography", "nist lwc", "aead", "认证加密", "authenticated encryption", "ascon 2025标准", "ascon解密", "caesar竞赛", "ascon tag", "ascon aead"],
  },

  asconHash: {
    what: "Ascon-Hash256：NIST 轻量级密码标准（SP 800-232）配套的哈希，海绵结构，输出 32 字节摘要。",
    principle:
      "与 AEAD 版同族不同参数：哈希模式 rate 64 位、全程 12 轮置换 p[12]、IV 0x0000080100cc0002，小端字节序，海绵吸收消息再挤出 256 位摘要。\n\n" +
      "定位是「低功耗设备上的 SHA-256 替代」：资源占用小得多，安全强度对齐 256 位摘要该有的水平。\n\n" +
      "注意与老 Ascon-Hash v1.2 的 IV/字节序/填充都不同，结果不通用。NIST LWC KAT + ACVP 官方向量验证。",
    usage: "输入选 text 或 hex，运行出 32 字节摘要（hex 与 base64 双格式）。",
    examples: [
      { in: "The quick brown fox jumps over the lazy dog", param: "text", out: "hex = 23414503bf4bde7ad0e85aec94c22ae2d7cd807996b537f9564fc2974053f139", desc: "真实运行输出" },
    ],
    tips: [
      "摘要长度恒 32 字节；题目给 64 hex 字符且来源不明时，与 SHA-256/SHA3-256 摘要比一下先排除。",
      "v1.2 与标准版结果不同：对拍不过先确认两边是不是同一版参数（IV 就是身份证）。",
      "哈希无密钥：要带密钥的用 Ascon AEAD 或 KMAC，别拿 hash(k||m) 自己拼（长度扩展类攻击面）。",
    ],
    aka: ["ascon-hash", "ascon hash", "ascon哈希", "ascon-hash256", "轻量级哈希", "lightweight hash", "sp 800-232 hash", "sponge哈希", "海绵结构哈希", "ascon摘要", "ascon 256位哈希", "ascon digest"],
  },

  aesKeyWrap: {
    what: "AES Key Wrap：把一个密钥（key data）用另一个密钥（KEK）包装保护，RFC 3394 经典模式 + RFC 5649 带填充模式。",
    principle:
      "RFC 3394 的思想像「洗牌」：初始值 A = A6 重复 8 次（AIV），明文按 64 位块与 A 交错做 6n 轮 AES 加密移位；要求明文是 8 字节倍数。\n\n" +
      "RFC 5649 补短板：AIV 改 A65959A6 + 32 位长度域，明文可以任意长度（1..$2^{32}$ 字节），不足 8 字节直接单块加密。\n\n" +
      "解包时完整性检查（AIV/长度域对不上）失败明示报错。KEK 支持 AES-128/192/256。RFC 3394 §4.1-4.6 五组 + RFC 5649 §6 两组官方向量验证。",
    usage: "选模式 wrap/unwrap 与标准 3394/5649，填 KEK（16/24/32 字节 hex）。主输入：包装时是 key data（hex），解包时是包装结果。",
    examples: [
      { in: "00112233445566778899aabbccddeeff", param: "wrap, RFC 3394, KEK=000102030405060708090a0b0c0d0e0f", out: "包装结果(hex): 1fa68b0a8112b447aef34bd8fb5a7b829d3e862371d2cfe5", desc: "RFC 3394 §4.1 官方向量，逐字一致" },
      { in: "c37b7e6492584340bed12207808941155068f738（20 字节非 8 倍数）", param: "wrap, RFC 5649, KEK=5840df6e29b02af1ab493b705bf16ea1ae8338f4dcc176a8", out: "包装结果(hex): 138bdeaa9b8fa7fc61f97742e72248ee5ae6ae5360d1ae6a5f54f373fa543b6a", desc: "RFC 5649 §6 官方向量" },
    ],
    tips: [
      "认特征：输入长度不是 8 倍数却要包装 → 必是 5649；密文比明文多 8 字节（3394）到 15 字节（5649 最坏）。",
      "unwrap 报「完整性校验失败」说明 KEK 错或密文被改——AIV 就是防拿包装密文张冠李戴的哨兵。",
      "真实协议里 Key Wrap 用于密钥传输/托管（如 PKCS#11、云 KMS 导入密钥），CTF 里常见于 Android keystore 与硬件安全模块取证。",
    ],
    aka: ["aes key wrap", "rfc 3394", "rfc 5649", "key wrap", "密钥包装", "key wrapping", "kek", "密钥加密密钥", "aes-kw", "kw", "kwp", "key wrap with padding", "wrap密钥", "unwrap", "nist sp 800-38f"],
  },

  mlkemKeyGen: {
    what: "生成 ML-KEM（后量子密钥封装）密钥对，FIPS 203 标准的 ML-KEM-512/768/1024 三档。种子 d/z 可固定，结果可复现。",
    principle:
      "ML-KEM 前身是 Crystals-Kyber（NIST 后量子竞赛胜者），2024 年定为 FIPS 203：安全性基于模格（Module Lattice）上的 LWE 变体问题，量子计算机也没有好的攻击算法。\n\n" +
      "密钥生成：种子 d 经 K-PKE.KeyGen 生成封装密钥 ek 与解封装密钥 dk_PKE，dk = $dk_{\\mathrm{PKE}} \\| ek \\| H(ek) \\| z$，末尾的 FO 变换（Fujisaki-Okamoto）把「能解密的格密码」升级成「可证明安全的 KEM」。\n\n" +
      "参数集差别在安全强度：512≈AES-128、768≈AES-192（默认）、1024≈AES-256。纯 JS 实现，768 单次毫秒级。",
    usage: "选参数集；教学复现可固定 d/z 两个 32 字节 hex 种子（留空则随机）。输出 ek（公钥）、dk（私钥）hex 与种子回显。",
    examples: [
      { in: "（空输入）", param: "ML-KEM-768, d=00112233…ccddeeff（32B）, z=11223344…ddeeff11（32B）", out: "公钥 ek (1184 B): d245c5841315e9278481d41acd54081c1a15c2281c0c2a5e4d22524cf57dcb59…（固定种子，结果逐字节可复现）", desc: "种子固定则每次运行完全相同" },
    ],
    tips: [
      "ek/dk 长度是指纹：512 档 ek=800B，768 档 ek=1184B/dk=2400B，1024 档 ek=1568B——拿到密文长度（768 档 ct=1088B）也能反推档位。",
      "Chrome/OpenSSH/Signal 都已部署 ML-KEM 做混合密钥交换（X25519+ML-KEM-768），流量分析题会遇到。",
      "真实场景 d/z 必须真随机（CSPRNG），固定种子只配教学演示。",
    ],
    aka: ["ml-kem", "ml-kem密钥生成", "mlkem keygen", "kyber", "crystals kyber", "kyber768", "ml-kem-768", "ml-kem-512", "ml-kem-1024", "fips 203", "后量子密钥", "post-quantum", "抗量子密码", "pqc", "module-lattice kem", "kem密钥生成"],
  },

  mlkemEncaps: {
    what: "ML-KEM 封装：拿接收方的公钥 ek，产出密文 ct 和共享密钥 SS——发方这边的一次密钥交换。",
    principle:
      "封装 = 「用公钥造一段密文，双方各自能从中算出同一个 32 字节共享密钥」：随机性 m 经哈希进入，K-PKE.Encrypt 加密出 ct，SS = ct 经 KDF 派生。\n\n" +
      "与 RSA 加密的本质区别：KEM 不加密任意明文，只「封装」密钥材料；SS 直接当对称密钥用（或再进 KDF）。\n\n" +
      "随机性 m 可固定 32 字节 hex 复现（教学），留空随机。含 ek 类型/模数检查。",
    usage: "主输入填 ek（公钥 hex），选参数集（须与 ek 档位一致），可固定 m。输出 ct 与 SS。",
    examples: [
      { in: "d245c5841315e9278481d41acd54081c…（ML-KEM-768 ek，配套密钥生成产物）", param: "ML-KEM-768, m=0f1e2d3c…2e1f0（32B）", out: "密文 ct (1088 B): 1eeacd9f5c2b6488009701641700ba85061cfa22… / 共享密钥 SS (32 B): 468ec2590278fc19fe43183b1fa0426233639b2aecc69aa642445635dc4990ef", desc: "与「ML-KEM 解封装」同钥对拍，SS 一致" },
    ],
    tips: [
      "封装与解封装要同一档位：拿 768 的 ek 跑 1024 档直接被类型/模数检查拦下。",
      "m 固定时 ct/SS 完全可复现，做题对拍方便；真实使用必须随机 m。",
      "混合模式（X25519+ML-KEM）里 SS 还要和 ECDH 的共享值拼接再 KDF，别拿裸 SS 直接当会话密钥。",
    ],
    aka: ["ml-kem封装", "mlkem encaps", "kyber encaps", "密钥封装", "encapsulation", "kem封装", "kem encaps", "共享密钥封装", "后量子密钥交换", "kem ct", "封装密文", "kyber encrypt"],
  },

  mlkemDecaps: {
    what: "ML-KEM 解封装：拿私钥 dk 和密文 ct，恢复 32 字节共享密钥 SS。密文被篡改时走「隐式拒绝」，不报错但给你伪随机值。",
    principle:
      "解封装先重加密验证（FO 变换）：用 H(ct) 当随机性重新加密比对 ct，一致则出真 SS；不一致不抛异常，而是返回 $\\bar{K} = J(z \\| c)$ 伪随机值——「隐式拒绝」是 FIPS 203 明文规定的防选择密文攻击（CCA）设计。\n\n" +
      "所以解封装永远「成功」：密文错只表现为 SS 对不上（发方那边 SS 是另一个值），没有错误信息可给攻击者当预言机。",
    usage: "主输入填 dk（私钥 hex），参数填 ct（封装输出的密文 hex），选参数集。",
    examples: [
      { in: "473049972928207944d8fc6e0c1a3d1d…（ML-KEM-768 dk，配套密钥生成产物）", param: "ML-KEM-768, ct=1eeacd9f5c2b6488…（封装输出）", out: "共享密钥 SS (32 B): 468ec2590278fc19fe43183b1fa0426233639b2aecc69aa642445635dc4990ef", desc: "与封装端 SS 逐字节一致" },
      { in: "同上，ct 末字节篡改", param: "同上", out: "SS = b41de26076b009668133e97cb200fd90251a46bbe660198570b5b3d6f372a0dc + 注: 隐式拒绝路径（重加密密文不符，SS = K̄ = J(z‖c) 伪随机值）", desc: "篡改不报错，给伪随机 K̄" },
    ],
    tips: [
      "双方 SS 对不上先查：ct 是否被截断/篡改（重加密比对很严）、dk 档位、dk 是否完整（dk 内嵌 $ek \\| H(ek) \\| z$）。",
      "「解封装永远成功」是特性不是缺陷：给攻击者可区分的错误信号会打开 CCA 攻击面。",
      "CTF 出题常拿隐式拒绝做文章：篡改 ct 后 SS 变但流程不炸，取证时别指望报错线索。",
    ],
    aka: ["ml-kem解封装", "mlkem decaps", "kyber decaps", "解封装", "decapsulation", "kem decaps", "共享密钥恢复", "隐式拒绝", "implicit rejection", "后量子解封装", "kem解封", "kyber decrypt", "fujisaki-okamoto"],
  },

  pemToHex: {
    what: "PEM 转 DER hex：把 `-----BEGIN/END-----` 块的 base64 肉剥出来，得原始 DER 字节（hex 或 hexdump 视图）。",
    principle:
      "PEM（Privacy-Enhanced Mail，RFC 7468）= 文本标签 + base64 正文（64 字符折行）。本工具做 §6 的「宽松清洗」：剥空白、丢注脚行（如 openssl 证书尾部注释）、跳过 EC PARAMETERS 参数块，再 base64 解码得 DER。\n\n" +
      "只提字节不解析结构——DER 里的 ASN.1 解读交给「PEM→JWK」「X.509 证书解析」这类后续工具。附带规范 base64 与识别出的标签。",
    usage: "粘贴任意 PEM（标签不限），选输出 hex 或 16 字节 dump。对拍可用 openssl asn1parse / xxd -r -p。",
    examples: [
      { in: "-----BEGIN PRIVATE KEY-----（P-256 PKCS#8 私钥）", param: "output=hex", out: "PEM 标签：PRIVATE KEY / DER 字节数：138（0x8a）/ 308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b…（附规范 base64）", desc: "真实运行输出" },
    ],
    tips: [
      "PEM 转存/复制时折行被合并不影响——宽松清洗自动处理；但 base64 字符缺了会解码失败。",
      "拿到 hex 后想看结构：丢「X.509 证书解析」（证书类）或「PEM→JWK」（密钥类）。",
      "hexdump 模式适合肉眼找 ASN.1 头指纹（30 开头的 SEQUENCE、06 07 2a8648ce3d 的 EC OID）。",
    ],
    aka: ["pem转der", "pem to der", "pem转hex", "pem解码", "pem解析", "pem提取", "der hex", "pem to hex", "rfc 7468", "asn.1转hex", "证书转hex", "pem转16进制", "base64 pem 解码"],
  },

  hexToPem: {
    what: "DER hex 或 base64 封装成 PEM：`-----BEGIN 标签-----` + 64 字符折行 base64 + 结尾，RFC 7468 §5.2 标准格式。",
    principle:
      "PEM 的正文就是 DER 的 base64：输入按 hex/base64 自动判别（auto 下全 hex 字符按 hex），编码后每 64 字符折一行。\n\n" +
      "标签可选 RSA PRIVATE KEY / PRIVATE KEY / PUBLIC KEY / EC PRIVATE KEY / CERTIFICATE 或自定义——标签只是给人看的，DER 内容才是本体（但很多工具按标签路由解析，写错标签会被拒收）。\n\n" +
      "附带尝试 DER 顶层结构提示（不强制合法 DER）。",
    usage: "粘贴 DER（hex 或 base64），选标签。产物可直接交 openssl 系工具。",
    examples: [
      { in: "308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b…（138 字节 DER）", param: "input=hex, label=PRIVATE KEY", out: "-----BEGIN PRIVATE KEY----- / MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgya+p2EW6dRZrXCFX…（64 字符折行）/ -----END PRIVATE KEY-----", desc: "与「PEM→DER」互为逆操作" },
    ],
    tips: [
      "写 burp/脚本时缺换行符的 base64 私钥常被库拒收——过一遍本工具得到规范折行 PEM 再用。",
      "标签与内容错配（如把 SPKI 公钥 DER 套 PRIVATE KEY 标签）部分库能容错部分直接崩，别赌。",
      "auto 判别规则：全 hex 字符按 hex 处理，有非 hex 字符按 base64——输入含 0-9a-f 混 base64 时手动指定。",
    ],
    aka: ["der转pem", "der to pem", "hex转pem", "pem编码", "生成pem", "pem封装", "der base64", "rfc 7468", "pem 64折行", "16进制转pem", "pem生成器", "make pem", "base64转pem"],
  },

  pemToJwk: {
    what: "PEM 密钥转 JWK（JSON Web Key）：RSA（PKCS#1/PKCS#8/SPKI）与 EC（SEC 1/PKCS#8/SPKI）私钥公钥都收，出标准 JWK JSON。",
    principle:
      "JWK（RFC 7517）是 JOSE 家族的 JSON 密钥格式：RSA 出 n,e(+d,p,q,dp,dq,qi)，EC 出 crv,x,y(+d)，字段一律 base64url 无 padding（RFC 4648 §5 / RFC 7518 §6）。\n\n" +
      "PEM 侧按标签与 ASN.1 结构自动识别：PKCS#1（RFC 8017 §A.1.2）、PKCS#8（RFC 5208）、SPKI（RFC 5280）、SEC 1（RFC 5915）；EC 曲线 OID 映射 P-256/P-384/P-521（RFC 5480）与 secp256k1（RFC 8812 §3.2）。\n\n" +
      "PKCS#8 若缺公钥坐标（只装了 d），现算 $d \\cdot G$ 补全。附 n 位长与 x/y hex 行，便于对拍 openssl -text。",
    usage: "粘贴 PEM（私钥或公钥），运行得 JWK JSON + 曲线/位长信息 + 自检（$d \\cdot G$ 与携带公钥一致性）。",
    examples: [
      { in: "-----BEGIN PRIVATE KEY-----（P-256 PKCS#8，私钥 d=C9AFA9D8…F6721）", out: '{"kty":"EC","crv":"P-256","x":"YP7UuiVanTHJYet0xjVtaMBJuJI7Yfps5mliLmDyn7Y","y":"eQP-EAi4vJmkGunpVii8ZPLxsgwtfp9Rd6PClNRGIpk","d":"ya-p2EW6dRZrXCFXZ7HWk05Qw9s26JsSe4piKxIPZyE"} + 自检 d·G 与携带公钥一致', desc: "RFC 6979 P-256 测试钥，字段 base64url" },
    ],
    tips: [
      "JWK 的 x/y/d 是 base64url（无 +/=），直接拿 hex 塞进去必错——转出来就别手改。",
      "secp256k1 的 JWK crv 写作 secp256k1（RFC 8812），非 JOSE 核心曲线，老库可能不认。",
      "验完整性看自检行：$d \\cdot G$ 与 PEM 里带的公钥不一致说明私钥文件本身被动过。",
    ],
    aka: ["pem转jwk", "pem to jwk", "jwk转换", "jwk生成", "json web key", "pem to json web key", "私钥转jwk", "公钥转jwk", "rfc 7517", "rfc 7518", "jwk json", "openssl转jwk", "pem key to jwk", "jwk提取"],
  },

  jwkToPem: {
    what: "JWK 转 PEM：JSON 密钥转回 openssl 系工具认的传统 PEM，RSA 与 EC 双支持，私钥双格式输出。",
    principle:
      "逆向工程「PEM→JWK」：RSA 私钥同时出 PKCS#1（BEGIN RSA PRIVATE KEY）与 PKCS#8（BEGIN PRIVATE KEY）两块——前者老工具用，后者现代标准；缺 CRT 参数（dp/dq/qi）时自动推导。\n\n" +
      "EC 私钥出 SEC 1 传统格式（RFC 5915）与 PKCS#8 两块（内嵌版按 RFC 5480 §2.2 省略 [0] 曲线参数）；公钥出 SPKI。私钥缺公钥坐标时现算 $d \\cdot G$ 补全。",
    usage: "粘贴 JWK JSON（kty=RSA 或 EC），运行得 PEM 块（可直接 openssl pkey 消费）。",
    examples: [
      { in: '{"kty":"EC","crv":"P-256","d":"ya-p2EW6dRZrXCFXZ7HWk05Qw9s26JsSe4piKxIPZyE",…}', out: "EC PRIVATE KEY（SEC 1 传统格式）+ PRIVATE KEY（PKCS#8）两块 PEM，曲线 P-256", desc: "与「PEM→JWK」互逆" },
    ],
    tips: [
      "openssl 老命令认 BEGIN EC PRIVATE KEY / RSA PRIVATE KEY，新版 pkey 通吃 PKCS#8——两块都给就是让你按需取。",
      "JWK 里只有 d 没有 x/y 也能转：工具现算 $d \\cdot G$ 补公钥坐标再组装 PEM。",
      "拿 web 前端代码里的 JWK 常量做逆向题时，先转 PEM 再进 openssl 生态最顺手。",
    ],
    aka: ["jwk转pem", "jwk to pem", "jwk生成pem", "json web key转pem", "jwk私钥导出", "jwk转pkcs8", "jwk转pkcs1", "jwk转spki", "jwk to openssl", "pem导出", "jwk export pem"],
  },

  pubFromPriv: {
    what: "从私钥提取公钥：PEM 或 JWK 输入，RSA 出 (n,e)、EC 现算 $d \\cdot G$，输出 SPKI PEM + JWK 公钥。",
    principle:
      "私钥文件里通常内嵌了公钥材料，但即使没有也能推：RSA 公钥就是 (n,e)（e 一般是 65537，d 才是秘密），EC 公钥 = $d \\cdot G$ 点乘（雅可比坐标实现抗侧信道写法）。\n\n" +
      "输出双格式：JWK 公钥（RFC 7518 §6.3.1/§6.2.1）与 SPKI PEM（RFC 5280 §4.1），与 openssl pkey -pubout 可逐字节对拍。EC 还做自检：d·G 与私钥携带的公钥坐标是否一致（不一致说明文件被拼接过）。",
    usage: "粘贴私钥（PKCS#1/PKCS#8/SEC 1 PEM 或含 d 的 JWK），运行。输入已是公钥会明确提示「无需提取」。",
    examples: [
      { in: '{"kty":"EC","crv":"P-256","d":"ya-p2EW6dRZrXCFXZ7HWk05Qw9s26JsSe4piKxIPZyE",…}', out: "JWK 公钥 {x:YP7UuiVanTHJ…,y:eQP-EAi4vJmk…} + SPKI PEM -----BEGIN PUBLIC KEY-----（自检 d·G 与私钥坐标一致）", desc: "d=C9AFA9D8… 测试钥" },
    ],
    tips: [
      "常见场景：拿到 RSA 私钥要给验签方公钥——直接提，别手动抄 n/e 抄错位数。",
      "EC 自检报「不一致」时信 $d \\cdot G$ 那份：PEM [1] 字段/JWK x,y 可能被人替换过。",
      "输入只有公钥（无 d）不是错误用法：工具会提示无需提取，顺带帮你确认手里这份到底是私钥还是公钥。",
    ],
    aka: ["私钥转公钥", "提取公钥", "从私钥提取公钥", "derive public key", "public key from private key", "私钥推导公钥", "openssl pkey -pubout", "d·G", "ec公钥计算", "私钥生成公钥", "pubkey derive", "private to public key"],
  },

  x509Parse: {
    what: "X.509 证书解析器：把一坨 base64 的证书拆成人话——版本/序列号/签发者/主体/有效期/公钥/扩展/签名值逐项列出。",
    principle:
      "证书（ITU-T X.509 / RFC 5280 §4.1）是 ASN.1 DER 结构：tbsCertificate（版本 v3 起有 [0] EXPLICIT 标记）+ 签名算法 + 签名值三段。\n\n" +
      "解析覆盖：序列号（原始字节+十进制）、有效期（UTCTime/GeneralizedTime，可指定判定基准时间）、Issuer/Subject DN（按编码顺序即 openssl -text 顺序，附 RFC 4514 串）、SubjectPublicKeyInfo（RSA 模数指数/EC 曲线坐标）、扩展区（critical 标记、SKID/AKI/basicConstraints 等 OID 总表）、签名值。\n\n" +
      "还做结构一致性检查：外层 AlgorithmIdentifier 与 tbs 内应一致（RFC 5280 §4.1.2.3）。",
    usage: "粘贴证书（PEM 或 DER hex）。可选过期判定基准时间（默认当前）。对拍 openssl x509 -text。",
    examples: [
      { in: "-----BEGIN CERTIFICATE-----（ECDSA P-256 自签证书）", out: "版本: v3 / 序列号: 52:75:71:82:…（20 字节）/ 签名算法: ecdsa-with-SHA256 / notBefore 2026-09-02 … notAfter 2026-10-02 / Issuer=Subject: CN=demo.example.com,O=EBCTF / 曲线 prime256v1 / 扩展 3 项（basicConstraints critical CA=TRUE）/ 签名值 70 字节", desc: "真实运行输出摘录" },
    ],
    tips: [
      "CTF 证书题三连：subject 里的 flag、SAN/自定义扩展里的 flag、序列号或有效期藏信息（本文档里的 16 进制序列号、UTCTime 秒数都当过载体）。",
      "Issuer == Subject 就是自签——配合 basicConstraints CA=TRUE 判断这证书想冒充谁。",
      "外层算法与 tbs 内不一致是「双算法证书」老漏洞形态，解析器的这个检查就是给你看它。",
    ],
    aka: ["x.509解析", "证书解析", "x509 parse", "certificate parser", "证书查看", "openssl x509 -text", "数字证书解析", "解析证书", "cert parse", "证书信息", "证书字段", "der证书解析", "证书在线解析", "certificate decoder"],
  },

  sshHostKeyParse: {
    what: "SSH 公钥行解析：authorized_keys/known_hosts 里的 `算法 base64 注释` 一行，拆出算法参数、公钥本体与双格式指纹。",
    principle:
      "SSH 公钥行（RFC 4251 §5 / RFC 4253 §6.6）里那坨 base64 解开后是一串 SSH 专有的 wire 格式：算法名字符串 + 按算法排的参数（RSA 的 e/n、ECDSA 的曲线/点、Ed25519 的 32 字节 A，RFC 5656/8709）。\n\n" +
      "指纹 = 对公钥 blob（不带前缀主机名/注释）哈希：SHA256 base64（ssh-keygen -lf 默认）与 MD5 十六进制冒分（ssh-keygen -E md5 -lf），与本地 ssh-keygen 可直接对拍。\n\n" +
      "known_hosts 与 authorized_keys 的差别只在行首有没有主机名前缀，解析器两种都收，还做规范行重建。",
    usage: "粘贴一整行（带或不带主机名前缀、带或不带注释），运行。",
    examples: [
      { in: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIK/qogyXzVE4dZH7BEUErGYJ+ecdfryPGRu9Pav+SPMw t359@demo", out: "算法: ssh-ed25519 / 公钥 A (32 字节): AFEAA20C97CD51387591FB044504AC6609F9E71D7EBC8F191BBD3DABFE48F330 / SHA-256: SHA256:Xje16V8UER2L9XsqrCf8GbrEp4vuMdCFqcOncOIAA1M / MD5: MD5:4c:88:2e:1a:5c:cc:bd:68:ea:d5:0f:c2:58:14:f3:64", desc: "真实运行输出" },
      { in: "127.0.0.1 ssh-ed25519 AAAA…（known_hosts 格式）", out: "同上（自动剥主机名前缀）", desc: "known_hosts 行也收" },
    ],
    tips: [
      "取证题给 known_hosts/authorized_keys 让你认主机：指纹比对是标准动作，SHA256 base64 那串就是 ssh-keyscan 的输出形态。",
      "RSA 行（ssh-rsa）解开是 e（通常 6 个字节的 0x010001）+ n（2048 位是 257 字节带前导零）——要拿去别处算就提 n。",
      "注释字段随便写不能当身份依据；算法字段才决定后面参数怎么读。",
    ],
    aka: ["ssh公钥解析", "authorized_keys解析", "known_hosts解析", "ssh key解析", "ssh host key", "ssh公钥格式", "ssh指纹", "ssh key fingerprint", "ssh-keygen -lf", "主机公钥", "openssh公钥解析", "ssh-rsa解析", "ssh-ed25519解析", "ecdsa-sha2解析", "ssh public key parser"],
  },

  csrParse: {
    what: "CSR（证书签名请求）解析：PKCS#10 格式的 `.csr` 文件拆开看主体、公钥与自签证明。",
    principle:
      "CSR（RFC 2986）是「申请证书的表单」：certificationRequestInfo（版本固定 0 + 主体 DN + 公钥 + 可选属性如 SAN 扩展请求）+ 用申请者自己私钥的签名——证明「我持有该公钥对应私钥」。\n\n" +
      "解析输出主体 DN（编码顺序 + RFC 4514 串）、subjectPKInfo（算法/曲线/公钥点）、attributes [0] 区（CTF 常见 extensionRequest 藏 SAN）、签名算法与 ECDSA r/s 结构合法性。对拍 openssl req -text。",
    usage: "粘贴 PEM（BEGIN CERTIFICATE REQUEST 或 BEGIN NEW CERTIFICATE REQUEST）。",
    examples: [
      { in: "-----BEGIN CERTIFICATE REQUEST-----（P-256 CSR）", out: "版本: 0 / Subject: CN=csr.example.com,O=EBCTF,ST=CTF,C=CN / 曲线 prime256v1 / attributes: 无属性 / 签名算法 ecdsa-with-SHA256，r,s 结构合法", desc: "真实运行输出摘录" },
    ],
    tips: [
      "证书题目常配一个 CSR：对比 CSR 与签出证书的 subject/SAN 是否被 CA 篡改（越权加域名是真实世界的 CA 事故剧本）。",
      "attributes 区的 extensionRequest（OID 1.2.840.113549.1.9.14）是 SAN 等「想要的扩展」的清单——flag 常躲这。",
      "CSR 签名是自签（用申请者私钥），不是 CA 签的——别在 CSR 里找签发链。",
    ],
    aka: ["csr解析", "证书请求解析", "pkcs#10", "pkcs10", "certificate signing request", "openssl req -text", "csr查看", "证书签名请求", "csr parse", "csr信息", "解析csr", "csr to text", "csr decoder", "证书申请解析"],
  },

  crlParse: {
    what: "CRL（证书吊销列表）解析：CA 定期发布的「这些序列号已作废」清单，拆出签发者、有效期与每条吊销记录。",
    principle:
      "CRL（RFC 5280 §5.1）结构类似证书的镜像：tbsCertList（版本 v2、签名算法、签发者、thisUpdate/nextUpdate 更新窗口、revokedCertificates 序列号+吊销日期+可选原因、crlExtensions）+ CA 签名。\n\n" +
      "解析输出全量字段：每条吊销记录的序列号（原始字节+十进制）、吊销日期；cRLNumber 扩展（单调递增的 CRL 序号，客户端据此判断是不是最新列表）；对更新窗口做「是否过期」判定。对拍 openssl crl -text。",
    usage: "粘贴 PEM（BEGIN X509 CRL）。",
    examples: [
      { in: "-----BEGIN X509 CRL-----（含 1 条吊销）", out: "版本: v2 / 签名算法: sha256WithRSAEncryption / Issuer: CN=DemoCA / thisUpdate 2026-09-02 … nextUpdate 2026-09-16（未过期）/ 已吊销 1 条：序列号 19:8A:24:3D:…（吊销日期 2026-09-02）/ cRLNumber: 4096", desc: "真实运行输出摘录" },
    ],
    tips: [
      "验证书三步走：签名链（x509Parse）→ 有效期 → 是否在 CRL 里；CTF 里序列号字段本身藏过 flag。",
      "现代 Web 走 OCSP/OCSP-Stapling 居多，CRL 更多出现在企业 PKI 与离线场景——题目给了就照单解析。",
      "cRLNumber 与 nextUpdate 是「新鲜度」证据：拿旧 CRL 说证书没吊销不算数。",
    ],
    aka: ["crl解析", "证书吊销列表", "吊销列表", "certificate revocation list", "证书黑名单", "crl查看", "openssl crl -text", "吊销证书查询", "crl number", "x.509 crl", "证书撤销列表", "revocation list", "crl parse", "已吊销证书"],
  },

  flaskSessionDecode: {
    what: "解 Flask session cookie：`payload.timestamp.signature` 三段解开成 JSON——Flask 的 session 只是「签名」不是「加密」，不带密钥也能读。",
    principle:
      "Flask 默认 session 方案基于 itsdangerous 的 URLSafeTimedSerializer：payload 是 JSON 的 base64url（可能 zlib 压缩，特征是段首有 `.`），timestamp 是 epoch 秒的 base64url（用于 max-age 过期检查），signature 是 HMAC。\n\n" +
      "三段里没有一环是加密——「看不懂」只是 base64。填了 secret 可以顺带验签；不填就纯解（CTF 第一步永远是先解出来看 claims）。\n\n" +
      "支持 itsdangerous v1/v2 两种序列化习惯与 zlib 压缩格式。",
    usage: "粘贴整条 cookie，secret 可留空（只解不验）。salt/派生方式/摘要算法默认 cookie-session/hmac/SHA1（Flask 默认），非默认配置的题要改。",
    examples: [
      { in: "eyJmbGFnIjoiZmxhZ3tmbDRza19kM20wfSIsInVzZXIiOiJhZG1pbiJ9.aLakAA.-eMcv6ln3KYX8efsyiC8XQlAH84", param: "secret=ctf-secret（其余默认）", out: 'payload JSON: {"flag":"flag{fl4sk_d3m0}","user":"admin"} / 时间戳: 1756800000（2025-09-02T08:00:00Z）/ 签名校验: ✓ 合法', desc: "解+验一体" },
      { in: "同上", param: "secret 留空", out: "同样解出 JSON 与时间戳，附注「未填 secret：只解不验」", desc: "无密钥纯解" },
    ],
    tips: [
      "payload 段以 `.` 开头说明被 zlib 压缩了，工具自动处理；手解的话记得先 decompress 再 JSON。",
      "时间戳段能还原签发时刻——「什么时候伪造的」在取证题里是关键证据。",
      "看懂了就想改：改完要重签（flaskSessionSign），否则验签必挂。",
    ],
    aka: ["flask session解码", "flask session decode", "flask cookie解码", "flask session cookie", "itsdangerous解码", "flask会话解码", "session解密", "flask session解析", "flask cookie 解析", "flask session cookie manager", "flask session 查看", "解flask cookie"],
  },

  flaskSessionSign: {
    what: "Flask session 伪造签发：给你 payload JSON 和 secret，产出一条验签能过的完整 Flask session cookie。",
    principle:
      "与解码互逆：JSON 紧凑序列化（v2 按原序 ≈ itsdangerous _CompactJSON，v1 按 Flask TaggedJSON 且 key 排序）→ base64url；时间戳段 epoch 秒（可固定，默认当前）；签名 = HMAC-SHA1(derived_key, payload‖.‖ts)。\n\n" +
      "密钥派生按 Flask 配置：salt 默认 cookie-session，key_derivation 默认 hmac，摘要默认 SHA1——三个参数都得和目标一致，差一个签名就对不上。\n\n" +
      "zlib 压缩默认 auto（按 itsdangerous 规则长 payload 自动压）。",
    usage: "主输入填 payload JSON，secret 必填；时间戳可固定（复现/配合 maxAge 测试）；v1/v2 格式按目标 Flask 版本选。",
    examples: [
      { in: '{"flag":"flag{fl4sk_d3m0}","user":"admin"}', param: "secret=ctf-secret, ts=1756800000, 其余默认", out: "cookie: eyJmbGFnIjoiZmxhZ3tmbDRza19kM20wfSIsInVzZXIiOiJhZG1pbiJ9.aLakAA.-eMcv6ln3KYX8efsyiC8XQlAH84（时间戳段 aLakAA=1756800000，压缩: 否）", desc: "与「Flask Session 解码」链路互证" },
    ],
    tips: [
      "改 admin 字段重签是 Flask 题的万能套路——前提是 secret 已知（.git 泄露/配置文件/弱口令爆破）。",
      "v1/v2 序列化差异：老 Flask（<2.3）默认 v1（key 排序+TaggedJSON 特殊类型标记），拿错格式验签必挂，看目标版本。",
      "时间戳别瞎填：服务器有 max-age 检查的话签发时间太老会被拒。",
    ],
    aka: ["flask session签发", "flask session sign", "flask session伪造", "flask cookie伪造", "伪造flask会话", "flask session生成", "itsdangerous签名", "flask cookie 签名", "生成flask session", "session伪造工具", "flask session cookie manager", "flask session maker"],
  },

  flaskSessionVerify: {
    what: "Flask session 验签：重算 HMAC 常数时间比对，给「签名真伪 + 时间戳 + maxAge 过期检查」三份结论。",
    principle:
      "拿你给的 secret 按同样派生流程重算签名，与 cookie 第三段常数时间比较（防时序侧信道）——合法/不合法给并排的两个签名值便于查参数错在哪。\n\n" +
      "再加时间维度的检查：解出时间戳段，按 maxAge（秒）判定是否过期；payload 概览一并给出。这就是 Flask 服务端 session 校验的完整动作，只是搬到浏览器里跑。",
    usage: "粘贴整条 cookie，填 secret（必填）与可选 maxAge。salt/派生/摘要按目标配置改。",
    examples: [
      { in: "eyJmbGFnIjoiZmxhZ3tmbDRza19kM20wfSIsInVzZXIiOiJhZG1pbiJ9.aLakAA.-eMcv6ln3KYX8efsyiC8XQlAH84", param: "secret=ctf-secret, maxAge 留空", out: "签名: ✓ 合法（常数时间比较通过，期望=实际）/ 时间戳: 1756800000 /（未填 maxAge：不做过期检查）", desc: "正例" },
      { in: "同 cookie", param: "secret=ctf-secret, maxAge=3600", out: "签名 ✓ 合法；过期检查(maxAge=3600s): × 已过期（签发于 31526662 秒前）", desc: "签名对但太老，服务端也会拒" },
    ],
    tips: [
      "「签名不合法」先别怀疑 cookie：九成是 salt/派生方式/摘要与目标配置不一致（期望 vs 实际两个值并排就是给你对拍用的）。",
      "maxAge 语义 = 距签发的秒数上限；签个新时间戳的 cookie（flaskSessionSign 的时间戳参数）就能绕过纯 maxAge 检查。",
      "常数时间比较不是仪式感：比较耗时泄露前缀匹配度是真攻击面（时序攻击）。",
    ],
    aka: ["flask session验签", "flask session verify", "flask session校验", "itsdangerous验签", "flask cookie验证", "session签名校验", "验证flask session", "flask cookie 真伪", "flask session checker", "hmac校验session", "flask cookie 验证"],
  },
};
