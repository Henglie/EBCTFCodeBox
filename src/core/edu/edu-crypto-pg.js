/*
 * edu-crypto-pg.js — 科普补缺分片（T311，密码学专题：秘密共享 + 签名攻击 + 公钥密码 + 流/分组密码）。
 *
 * 覆盖 9 个真实缺失 op 的科普卡：
 * crypto: shamir, schnorr, ecdsaReuseK, rabin, x25519, ed25519, paillier
 * modern: a51, magma
 *
 * 纯数据无副作用，无 import 无 register。M 在 eduContent.js 归并。
 * EduEntry 格式照 eduContent.js 头注释契约。
 */
export default {
 // ============ crypto: Shamir 秘密共享 ============
  shamir: {
    what: "Shamir 秘密共享——把秘密拆成 n 份分片，任取 k 份就能还原，少于 k 份则什么信息也得不到。",
    principle:
      "核心思想：用一个 $k-1$ 次多项式隐藏秘密，秘密是常数项 $a_0$，其余系数随机生成。\n\n" +
      "分割：在有限域 $GF(2^8)$（模 $x^8+x^4+x^3+x+1$）上构造多项式 $f(x) = a_0 + a_1 x + a_2 x^2 + \\cdots + a_{k-1} x^{k-1}$，其中 $a_0$ 是秘密的每个字节，$a_1..a_{k-1}$ 是随机字节。对 $x=1,2,\\ldots,n$ 计算 $f(x)$ 得到 n 片分片，每片格式为 $(x, f(x))$ 的 hex 编码。\n\n" +
      "合并：搜集任意 k 片 $(x_1,y_1),\\ldots,(x_k,y_k)$，用拉格朗日插值公式 $f(x) = \\sum_{j=1}^k y_j \\prod_{m\\neq j} \\frac{x - x_m}{x_j - x_m}$ 在 $GF(2^8)$ 中算出 $f(0)=a_0$，逐个字节恢复秘密。\n\n" +
      "安全保证：已知少于 $k$ 片，多项式系数不唯一，无法确定 $a_0$，信息论安全。",
    usage:
      "编码=分割：输入框填要拆分的秘密（UTF-8 文本或 hex），参数 n 是总分片数（默认 5），k 是还原所需最少片数（默认 3），点击「编码」输出 n 行 hex 分片。\n" +
      "解码=合并：把任意 k 片 hex 分片（每行一片）粘到输入框，点击「解码」还原原始秘密。\n" +
      "注意：k 不能超过 n，且分片必须来自同一次分割操作——不同秘密的分片混在一起无法正确还原。",
    examples: [
      { in: "flag{s}", param: "mode=split, n=5, k=3", out: "5 行 hex 分片（随机，每次不同）", desc: "分割：5 份分片中任取 3 份即可还原" },
      { in: "（上述 5 行中任意 3 行）", param: "mode=combine, k=3", out: "flag{s}", desc: "合并：拉格朗日插值还原原始秘密" },
    ],
    formulas: [
      { tex: "f(x) = a_0 + a_1 x + a_2 x^2 + \\cdots + a_{k-1} x^{k-1} \\pmod{GF(2^8)}", caption: "Shamir 秘密共享的多项式构造" },
      { tex: "f(0) = \\sum_{j=1}^{k} y_j \\prod_{m \\neq j} \\frac{x_m}{x_m - x_j}", caption: "拉格朗日插值还原常数项 $f(0)$" },
    ],
    tips: [
      "看到题面有「把秘密分成 n 份，k 份还原」、分片列表、$(k,n)$ 格式 → 直接想到 Shamir 秘密共享。",
      "拆分结果是随机的，每次运行都不一样，但任意 k 片合并后结果一致。",
      "少于 k 片无法还原，这是信息论安全的保证——不要尝试用少于 k 片的组合。",
      "CTF 里常见做法：给一组十六进制分片和 k 值，把分片粘进来解码即可。",
    ],
    aka: ["shamir", "Shamir秘密共享", "拉格朗日插值", "秘密分割", "门限方案", "Shamir's Secret Sharing", "SSS", "(k,n)门限", "密钥分片", "秘密共享", "Lagrange插值", "多项式秘密共享", "Shamir门限", "门限秘密共享", "秘密拆分"],
  },

 // ============ crypto: Schnorr 签名/验签/攻击 ============
  schnorr: {
    what: "Schnorr 签名——高效简洁的椭圆曲线数字签名方案，基于离散对数难题，在 secp256k1 上用 SHA-256。支持签名、验签、以及 nonce 重用攻击恢复私钥。",
    principle:
      "Schnorr 签名协议基于 Fiat-Shamir 变换，将交互式零知识证明转成非交互式数字签名。\n\n" +
      "密钥生成：在 secp256k1 曲线上随机选私钥 $d$，计算公钥 $Q = d \\cdot G$（$G$ 是基点）。\n\n" +
      "签名：随机选 nonce $k$，计算承诺 $R = k \\cdot G$，取 $R$ 的 x 坐标 $r = R_x$；计算挑战 $e = H(r \\| Q \\| m)$（H=SHA-256）；签名 $s = k - e \\cdot d \\pmod{n}$；输出 $(e, s)$ 或 $(r, s)$。\n\n" +
      "验签：计算 $R' = s \\cdot G + e \\cdot Q$，验证 $H(R'_x \\| Q \\| m) \\stackrel{?}{=} e$。\n\n" +
      "nonce 重用攻击：若同一私钥 $d$ 用相同 $k$ 签两条不同消息 $m_1$、$m_2$，则 $s_1 = k - e_1 d$ 且 $s_2 = k - e_2 d$。相减消去 $k$：$s_1 - s_2 = d (e_2 - e_1)$，推出 $d = (s_1 - s_2) \\cdot (e_2 - e_1)^{-1} \\pmod{n}$。两个签名即可恢复私钥。",
    usage:
      "参数选 mode：keygen（生成密钥对）、sign（签名）、verify（验签）、attack（nonce 重用攻击）。\n" +
      "签名：mode=sign，填私钥 (hex)、消息 msg (text 或 hex)，输出签名 $(e,s)$。\n" +
      "验签：mode=verify，填公钥 Qx/Qy (hex)、消息 msg、签名 e/s，输出 valid/invalid。\n" +
      "攻击：mode=attack，填两条用同一 k 的签名 $(e_1,s_1)$ 和 $(e_2,s_2)$，自动恢复私钥 $d$。",
    examples: [
      { in: "hello", param: "mode=sign, msgFormat=text, priv=0x0000000000000000000000000000000000000000000000000000000000000003", out: "签名 (e, s)", desc: "用极简私钥 3 对 'hello' 签名" },
      { in: "（两条同 k 签名）", param: "mode=attack", out: "恢复的私钥 d（hex）", desc: "nonce 重用攻击：从两条同 k 签名恢复私钥" },
    ],
    formulas: [
      { tex: "s = k - e \\cdot d \\pmod{n},\\quad e = H(R_x \\| Q \\| m)", caption: "Schnorr 签名：nonce k、挑战 e、私钥 d 的关系" },
      { tex: "d = (s_1 - s_2) \\cdot (e_2 - e_1)^{-1} \\pmod{n}", caption: "nonce 重用攻击：消去 k 恢复私钥 d" },
    ],
    tips: [
      "CTF 里看到两条签名用相同的 r（或 e）值 → nonce 重用漏洞，用 attack 模式直接恢复私钥。",
      "Schnorr 签名比 ECDSA 更简洁（无求逆步骤），且天然支持多重签名聚合。",
      "和 ECDSA 的区别：Schnorr 的 nonce 重用攻击能直接从 $(s_1-s_2)$ 和 $(e_2-e_1)$ 解出 d，公式更直接。",
    ],
    aka: ["schnorr", "Schnorr签名", "Schnorr验签", "nonce重用", "k重用", "Schnorr Signature", "Fiat-Shamir", "零知识证明", "Schnorr ZKP", "离散对数签名", "Schnorr数字签名", "Claus Schnorr", "Schnorr协议", "Sigma协议", "Schnorr识别"],
  },

 // ============ crypto: ECDSA nonce 重用攻击 ============
  ecdsaReuseK: {
    what: "ECDSA nonce(k) 重用攻击——当 ECDSA 签名两次使用同一个随机数 k，攻击者能直接计算出私钥。支持 secp256k1/secp256r1/自定义曲线。",
    principle:
      "ECDSA 签名里每条签名都有一个随机 nonce $k$——必须是一次性的且不可预测。若两条不同消息用同一个 $k$ 签名，攻击者能恢复私钥。\n\n" +
      "ECDSA 签名：选随机 $k$，算 $R = k \\cdot G$，$r = R_x \\bmod n$；$s = k^{-1}(z + r \\cdot d) \\bmod n$，其中 $z$ 是消息哈希，$d$ 是私钥。\n\n" +
      "nonce 重用推导：已知两条签名 $(r, s_1)$ 和 $(r, s_2)$（注意 r 相同！），对消息 $m_1$（哈希 $z_1$）和 $m_2$（哈希 $z_2$）：\n" +
      "$s_1 = k^{-1}(z_1 + r d) \\bmod n$\n$s_2 = k^{-1}(z_2 + r d) \\bmod n$\n\n" +
      "两式相减消去 $r d$ 项：$s_1 - s_2 = k^{-1}(z_1 - z_2) \\bmod n$\n" +
      "解出 $k = (z_1 - z_2) \\cdot (s_1 - s_2)^{-1} \\bmod n$\n" +
      "代入回 $s_1$ 得 $d = r^{-1}(s_1 \\cdot k - z_1) \\bmod n$\n\n" +
      "可选的公钥校验：提供 $Q_x$、$Q_y$ 则自动验证 $Q \\stackrel{?}{=} d \\cdot G$。",
    usage:
      "选曲线（secp256k1/secp256r1/custom），填两条签名的 r（相同值）、s1、s2、以及对应的消息哈希 z1、z2。\n" +
      "可选填公钥 Qx、Qy 做校验——填了会自动验证恢复的私钥是否跟公钥匹配。\n" +
      "各值均用 hex 格式（可选 0x 前缀），点击运行即输出恢复的 k 和 d。",
    examples: [
      { in: "r=0x7b516c..., s1=0x16ab..., s2=0xce60..., z1=0x1111111111111111, z2=0x2222222222222222, Qx=0xf973a..., Qy=0x4b4a...", param: "curve=secp256k1", out: "d=0x1234567890abcdef ✓", desc: "secp256k1 上的 nonce 重用攻击，从同 r 签名恢复私钥" },
    ],
    formulas: [
      { tex: "k = (z_1 - z_2) \\cdot (s_1 - s_2)^{-1} \\pmod{n}", caption: "从同 k 签名的两条消息哈希差和 s 差求 nonce k" },
      { tex: "d = r^{-1}(s_1 \\cdot k - z_1) \\pmod{n}", caption: "由 k 代回签名方程求私钥 d" },
    ],
    tips: [
      "标志性特征：两条 ECDSA 签名的 r 值相同 → nonce 重用，直接上本工具恢复 d。",
      "PS3 固件签名就是被这个漏洞破解的——Sony 对所有代码用同一个 k 签名。",
      "z1、z2 是消息的哈希值（SHA-256 等），不是消息原文。CTF 题目通常会直接给 z 值。",
      "如果不知道用的是哪条曲线，两个都试试（secp256k1 最常见，Bitcoin 也用这个）。",
    ],
    aka: ["ecdsaReuseK", "ECDSA", "nonce重用", "k重用攻击", "ECDSA nonce reuse", "私钥恢复", "椭圆曲线签名", "secp256k1", "弱随机数", "nonce leakage", "签名重放", "PS3漏洞", "Sony签名漏洞", "ECDSA攻击", "随机数重用"],
  },

 // ============ crypto: Rabin 密码 ============
  rabin: {
    what: "Rabin 密码——基于二次剩余困难问题的公钥加密，加密只需一次模平方（极快），解密需解四个根并用魔数消歧。",
    principle:
      "Rabin 密码的安全性等价于大整数分解，困难假设比 RSA 更强（Rabin 破解 ⇒ 分解 n，但 RSA 破解未必能分解 n）。\n\n" +
      "密钥生成：选两个大素数 $p \\equiv 3 \\pmod{4}$、$q \\equiv 3 \\pmod{4}$（均为 31 位左右，使 n 的模平方运算在 JS 精度内），$n = p \\times q$。公钥 n，私钥 $(p,q)$。\n\n" +
      "加密 $c = m^2 \\bmod n$：只需一次模平方，计算极快，适合资源受限设备。\n\n" +
      "解密：解 $m^2 \\equiv c \\pmod{n}$。先用中国剩余定理在模 p 和模 q 下各开平方：$m_p = c^{(p+1)/4} \\bmod p$，$m_q = c^{(q+1)/4} \\bmod q$（利用 $p \\equiv 3 \\pmod{4}$ 的性质）。得到四个根 $\\{m_1, m_2, m_3, m_4\\}$。\n\n" +
      "消歧：加密时在明文后附加魔数字节（0xAB 0xCD），解密后在四个候选根中寻找含魔数的那个，即为原始明文。\n\n" +
      "本实现支持 text/int 两种输入模式。int 模式直接把整数当消息（适合小数字验证算法）；text 模式用魔数消歧。",
    usage:
      "选 inputMode：text（UTF-8 文本 + 魔数消歧）或 int（纯整数加密，输出可能含多个根）。\n" +
      "参数 p、q 默认分别为 2147483647 和 2305843009213693951（两个 ≡3 mod4 的大素数），可自定。\n" +
      "编码=加密：输入明文，输出密文 c（十进制整数或 hex）。\n" +
      "解码=解密：输入密文 c，输出还原的明文（int 模式可能列出四个候选根；text 模式自动选含魔数的根）。",
    examples: [
      { in: "42", param: "inputMode=int", out: "c=1764", desc: "整数模式：42² mod n = 1764，验证二次剩余加密" },
      { in: "1764", param: "inputMode=int", out: "四个候选根（含 42）", desc: "解密：从 c 求平方根，输出四个候选值" },
    ],
    formulas: [
      { tex: "c = m^2 \\bmod n,\\quad n = p \\times q", caption: "Rabin 加密：明文 m 平方模公钥 n" },
      { tex: "m_p = c^{(p+1)/4} \\bmod p,\\quad m_q = c^{(q+1)/4} \\bmod q", caption: "Rabin 解密：利用 $p,q \\equiv 3 \\pmod{4}$ 快速开平方" },
    ],
    tips: [
      "Rabin 安全性等价于整数分解，破了 Rabin = 能分解 n，比 RSA 的困难假设更强。",
      "解密时有四个候选根——这是 Rabin 的特征，不是 bug。魔数消歧是实用解决方案。",
      "CTF 常见考法：给 n 和密文 c，叫选手解二次剩余恢复明文。",
      "和 RSA 的区别：RSA 加密用 $m^e$（大指数），Rabin 加密只用 $m^2$（平方），计算快但解密要消歧。",
    ],
    aka: ["rabin", "Rabin密码", "Rabin公钥", "二次剩余", "模平方根", "Rabin Cryptosystem", "m² mod n", "Chinese Remainder Theorem", "四根", "Rabin加密", "Michael Rabin", "平方模n", "Rabin解密", "二次剩余密码", "Rabin公钥加密"],
  },

 // ============ crypto: X25519 密钥交换 ============
  x25519: {
    what: "X25519——RFC 7748 定义的椭圆曲线 Diffie-Hellman 密钥交换，用 Curve25519 的 x-only 标量乘法，速度快、安全、是现代 TLS 的基础。",
    principle:
      "X25519 基于 Montgomery 曲线 $y^2 = x^3 + 486662 x^2 + x$ 在素域 $\\mathbb{F}_{2^{255}-19}$ 上。\n\n" +
      "核心操作：标量乘法 $x_{out} = \\text{X25519}(\\text{scalar},\\, x_{in})$，在曲线上计算 $\\text{scalar} \\cdot P$ 的 x 坐标，只处理 x 坐标（Montgomery 阶梯算法），忽略 y 坐标。\n\n" +
      "clamp：私钥标量在计算前要 clamp——低 3 位清零、高位置 0x40、次高位置 0x80——清除小阶子群点和保证高位固定。\n\n" +
      "密钥交换：Alice 生成私钥 a 和公钥 A = X25519(a, G)；Bob 生成私钥 b 和公钥 B = X25519(b, G)。Alice 算共享密钥 K = X25519(a, B)，Bob 算 K = X25519(b, A)。两端结果一致。",
    usage:
      "三个 mode：\n" +
      "keygen：随机生成 32 字节私钥和对应公钥（均 hex）。\n" +
      "双方私钥求共享：填 Alice 私钥和 Bob 私钥（均为 32 字节 hex），各自算出公钥后交换计算共享密钥，验证两侧是否一致。\n" +
      "己方私钥+对方公钥：填己方私钥和对方公钥（均为 32 字节 hex），算出共享密钥。",
    examples: [
      { in: "privA=77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a, privB=5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb", param: "mode=双方私钥", out: "共享K=4a5d9d5ba4ce2de1728e3bf4800a5084d0c0140155f2eed7b53e5e0e33e0e801（两侧一致✓）", desc: "RFC 7748 §6.1 官方测试向量，Alice 和 Bob 算出相同共享密钥" },
    ],
    formulas: [
      { tex: "K = \\text{X25519}(a, B) = \\text{X25519}(b, A)", caption: "X25519 DH 密钥交换：双方用对方公钥和自己的私钥算出共享密钥" },
    ],
    tips: [
      "X25519 是 x-only 的——不传 y 坐标，只传 32 字节的 x 坐标。公钥就是 32 字节 hex。",
      "别把 X25519 和 Ed25519 搞混：前者做密钥交换（DH），后者做数字签名。两者曲线不同（Montgomery vs twisted Edwards）但共享同一底层素域。",
      "私钥会自动 clamp，不用担心弱密钥。但私钥必须 32 字节。",
      "CTF 常见场景：给 Alice/Bob 的私钥或公钥，叫选手算出共享密钥，然后用共享密钥解密对称加密的数据。",
    ],
    aka: ["x25519", "X25519", "Curve25519", "RFC 7748", "ECDH", "密钥交换", "椭圆曲线DH", "x25519密钥协商", "Montgomery曲线", "DH密钥交换", "X25519 ECDH", "Daniel Bernstein", "DH", "Curve25519 DH", "25519密钥交换"],
  },

 // ============ crypto: Ed25519 签名/验签 ============
  ed25519: {
    what: "Ed25519——RFC 8032 定义的高速椭圆曲线数字签名方案，基于 twisted Edwards 曲线 + SHA-512，签名短（64 字节）、速度快、无分支。",
    principle:
      "Ed25519 工作在 twisted Edwards 曲线 $-x^2 + y^2 = 1 - \\frac{121665}{121666} x^2 y^2$ 上，基域同 Curve25519 的 $\\mathbb{F}_{2^{255}-19}$。\n\n" +
      "密钥生成：32 字节随机种子，用 SHA-512 哈希后取低 256 位做私钥标量（clamp 处理），高 256 位做 nonce 前缀。公钥 $A = a \\cdot B$（$B$ 是基点）。\n\n" +
      "签名：对消息 m，算 $r = \\text{SHA-512}(\\text{prefix} \\| m)$（确定性 nonce），$R = r \\cdot B$，$S = r + \\text{SHA-512}(R \\| A \\| m) \\cdot a \\pmod{\\ell}$。签名 = $R \\| S$（64 字节）。\n\n" +
      "验签：检查 $S \\cdot B \\stackrel{?}{=} R + \\text{SHA-512}(R \\| A \\| m) \\cdot A$。\n\n" +
      "特点：确定性签名（同消息同私钥签名相同，无随机数风险）、抗侧信道、批量验签。SHA-512 用纯 JS 实现。",
    usage:
      "三个 mode：keygen（生成密钥对）、sign（签名）、verify（验签）。\n" +
      "签名：mode=sign，填私钥（32 字节 hex）和消息 msg（支持 text/hex 格式），输出 64 字节签名（hex）。\n" +
      "验签：mode=verify，填公钥（32 字节 hex）、消息 msg、签名（64 字节 hex），输出 valid/invalid。\n" +
      "keygen：随机生成私钥和对应公钥。",
    examples: [
      { in: "", param: "mode=sign, msgFormat=hex, priv=9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", out: "签名=e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b", desc: "RFC 8032 §7.1 空消息测试向量，自检验签 ✓" },
    ],
    formulas: [
      { tex: "R = r \\cdot B,\\quad S = r + H(R \\| A \\| m) \\cdot a \\pmod{\\ell}", caption: "Ed25519 签名：确定性 nonce r + 标量 S" },
      { tex: "S \\cdot B \\stackrel{?}{=} R + H(R \\| A \\| m) \\cdot A", caption: "Ed25519 验签方程：核对基点标量乘法" },
    ],
    tips: [
      "Ed25519 是确定性的——同一私钥同一消息，签名永远一样，没有 nonce 重用风险。",
      "别和 X25519 搞混：Ed25519 做签名（twisted Edwards 曲线），X25519 做密钥交换（Montgomery 曲线），两者共享同一素域但用途不同。",
      "Ed25519 公钥 32 字节、签名 64 字节，比 ECDSA 的 DER 编码紧凑很多。",
      "CTF 常见：给 Ed25519 公钥和签名，要验证某消息是不是被该私钥签的——用 verify 模式。",
    ],
    aka: ["ed25519", "Ed25519", "EdDSA", "RFC 8032", "twisted Edwards", "爱德华兹曲线", "Ed25519签名", "高速签名", "Curve25519签名", "Daniel Bernstein", "Edwards曲线", "确定性签名", "Ed25519验签", "扭曲爱德华兹曲线", "EdDSA签名"],
  },

 // ============ crypto: Paillier 加法同态加密 ============
  paillier: {
    what: "Paillier 同态加密——支持密文直接做加法运算（结果解密等于明文之和），基于复合剩余类的困难问题，是隐私计算的核心原语。",
    principle:
      "Paillier 加密基于 $n^2$ 模运算的复合剩余类假设（$n = p \\times q$）。\n\n" +
      "密钥生成：选大素数 $p$、$q$，$n = p \\times q$，$\\lambda = \\text{lcm}(p-1, q-1)$，选 $g = n+1$（简化），预计算 $\\mu = \\lambda^{-1} \\bmod n$。公钥 $(n, g)$，私钥 $(\\lambda, \\mu)$。\n\n" +
      "加密 $E(m) = g^m \\cdot r^n \\bmod n^2$：随机 $r \\in \\mathbb{Z}_n^*$ 提供语义安全性——同一明文每次加密产生不同密文。\n\n" +
      "解密：$m = L(c^\\lambda \\bmod n^2) \\cdot \\mu \\bmod n$，其中 $L(x) = (x-1)/n$。\n\n" +
      "同态加法：$E(m_1) \\cdot E(m_2) \\bmod n^2 = E(m_1 + m_2)$——要算两个数的加密和，只需把密文相乘。\n" +
      "标量乘法：$E(m)^k \\bmod n^2 = E(k \\cdot m)$——加密值乘以常数。\n" +
      "同态减法和取反也可通过密文操作实现。\n\n" +
      "demo 模式展示完整流程：E(42) · E(100) mod n² 解密得 142=42+100 ✓。",
    usage:
      "五个 mode：\n" +
      "demo：完整演示——自动生成密钥、加密 42 和 100、做同态加法、解密验证 42+100=142。\n" +
      "keygen：生成 Paillier 密钥对（默认 256 位，可调 keySize）。\n" +
      "encrypt：用公钥 n 加密明文（整数）。\n" +
      "decrypt：用私钥 λ 解密密文。\n" +
      "add：做同态加法——输入两个密文，输出加密的和。",
    examples: [
      { in: "（自动）", param: "mode=demo", out: "142=42+100 ✓", desc: "demo 模式自动演示同态加法完整流程" },
      { in: "42", param: "mode=encrypt, 公钥 n=...", out: "密文 c（每次不同）", desc: "Paillier 加密：语义安全，同明文每次加密结果不同" },
    ],
    formulas: [
      { tex: "E(m) = g^m \\cdot r^n \\bmod n^2,\\quad g = n+1", caption: "Paillier 加密：明文 m 被随机数 r 掩蔽" },
      { tex: "E(m_1) \\cdot E(m_2) \\equiv E(m_1 + m_2) \\pmod{n^2}", caption: "同态加法：密文相乘对应明文相加" },
    ],
    tips: [
      "Paillier 是加法同态（半同态）——只支持加法和标量乘，不支持密文相乘。全同态（FHE）需要更复杂的方案。",
      "同一明文的每次加密结果不同（随机数 r 的作用），这是语义安全的保证。",
      "CTF 里看到同态计算、密文运算的题目，多半是 Paillier。demo 模式给你直观演示。",
    ],
    aka: ["paillier", "Paillier", "同态加密", "加法同态", "Paillier Cryptosystem", "半同态", "加法同态加密", "隐私计算", "密文计算", "n²模运算", "复合剩余", "Pascal Paillier", "Paillier公钥", "部分同态", "HE"],
  },

 // ============ modern: A5/1 GSM 流密码 ============
  a51: {
    what: "A5/1——GSM 手机的空中接口流密码，用 3 个 LFSR 加择多钟控生成密钥流。1999 年被逆向公布，现已被密码分析攻破。",
    principle:
      "A5/1 有三个线性反馈移位寄存器（LFSR），长度分别为 19、22、23 位，总状态 64 位：\n" +
      "R1（19 位）：反馈多项式 $x^{19} + x^{18} + x^{17} + x^{14} + 1$，钟控位第 8 位（CL1）\n" +
      "R2（22 位）：反馈多项式 $x^{22} + x^{21} + 1$，钟控位第 10 位（CL2）\n" +
      "R3（23 位）：反馈多项式 $x^{23} + x^{22} + x^{21} + x^{8} + 1$，钟控位第 10 位（CL3）\n\n" +
      "择多钟控：每轮取 CL1、CL2、CL3 的多数值，钟控位等于多数值的寄存器前进一拍，其余不动——每轮至少 2 个寄存器、最多 3 个寄存器移动。\n\n" +
      "密钥装载：64 位密钥 + 22 位帧号，寄存器初始为 0，逐个异或移入（不输出），每个时钟所有寄存器都移位。\n" +
      "输出：三个寄存器的最高位异或作为输出比特，每帧输出 228 位（114 位给下行、114 位给上行）。\n\n" +
      "加解密同形：密钥流与明文异或。本实现已验证往返：key=0f0e0d0c0b0a0908, frame=000000, 'Hello' → 4c1049ee05 → decode 还原 'Hello'。",
    usage:
      "参数：key 填 64 位 hex（16 字符），frame 填帧号（十进制或 0x hex，默认 000000）。\n" +
      "输入框填待处理数据（UTF-8 文本或 hex）。编码=加密（明文→hex 密文），解码=解密（hex 密文→明文）。\n" +
      "加解密用同一套 key+frame，记得把解码的 encoding 切到 hex。",
    examples: [
      { in: "Hello", param: "key=0f0e0d0c0b0a0908, frame=000000", out: "4c1049ee05(hex)", desc: "加密：Hello → hex 密文，已验证往返 PASS" },
      { in: "4c1049ee05", param: "key=0f0e0d0c0b0a0908, frame=000000, encoding=hex", out: "Hello", desc: "解密：hex 密文 → 还原 Hello" },
    ],
    formulas: [
      { tex: "\\text{CL1}=R1[8],\\ \\text{CL2}=R2[10],\\ \\text{CL3}=R3[10];\\ \\text{移位}=\\text{majority}(\\text{CL1,CL2,CL3})", caption: "A5/1 择多钟控：每轮至少 2 个寄存器前进" },
    ],
    tips: [
      "A5/1 密钥 64 位（16 hex），帧号 22 位（0-4194303 或 0x 格式）。加解密 key+frame 必须完全一致。",
      "1999 年 Briceno 等逆向公布了 A5/1，后来有彩虹表攻击可在数秒内从已知明文恢复密钥。",
      "A5/1 是 GSM 标准，A5/2 是弱化出口版（故意削弱），A5/3 基于 KASUMI。",
      "CTF 题目可能给 GSM 截获数据和已知明文字段，叫选手利用彩虹表或直接解密。",
    ],
    aka: ["a51", "A5/1", "GSM加密", "LFSR", "流密码", "择多钟控", "A51", "GSM A5/1", "手机加密", "钟控LFSR", "Briceno", "A5/1算法", "GSM流密码", "三寄存器", "GSM A5"],
  },

 // ============ modern: GOST Magma 分组密码 ============
  magma: {
    what: "Magma（GOST R 34.12-2015）——俄罗斯联邦标准分组密码，32 轮 Feistel 网络 + 256 位密钥 + 8 个 S 盒，前身是 GOST 28147-89。",
    principle:
      "Magma 是 64 位块长的分组密码（GOST 28147-89 的现代化重命名），密钥 256 位（64 hex），32 轮 Feistel 结构。\n\n" +
      "Feistel 轮函数：\n" +
      "1. 右半 32 位 + 轮密钥（模 $2^{32}$ 加法）\n" +
      "2. 拆成 8 个 4 位 nibble，各过一个自定义 S 盒（8 个独立 S 盒，替换值固化）\n" +
      "3. 循环左移 11 位\n" +
      "4. 与左半异或，左右交换\n\n" +
      "密钥编排：256 位密钥 K 分成 8 个 32 位子密钥 $K_0..K_7$。1-24 轮按 $K_0,K_1,K_2,K_3,K_4,K_5,K_6,K_7$ 顺序循环（共 3 遍），25-32 轮逆序 $K_7..K_0$。\n\n" +
      "输出：32 轮后左右 32 位拼接→64 位密文块。\n\n" +
      "本实现已验证：key=ffeeddccbbaa99887766554433221100f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff, 加密 92def06b3c130a59 → 2b073f0494f372a0。支持 ECB 模式处理长数据。",
    usage:
      "参数：key 填 256 位 hex（64 字符）。可选 iv 填 64 位 hex（16 字符）用于 CBC/CFB/OFB/CTR 模式，ECB 模式不需要 IV。\n" +
      "输入框填待处理数据（UTF-8 文本或 hex）。编码=加密（输出 hex 密文），解码=解密（输入 hex 密文还原明文）。\n" +
      "和 AES 的区别：块长只有 64 位（AES 是 128 位），轮数 32（AES-256 是 14 轮）。",
    examples: [
      { in: "92def06b3c130a59", param: "key=ffeeddccbbaa99887766554433221100f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff, encoding=hex, mode=ECB", out: "2b073f0494f372a0(hex)", desc: "GOST 28147-89 官方测试向量，加密验证 ✓" },
    ],
    formulas: [
      { tex: "\\text{Feistel round: } L_{i+1}=R_i,\\ R_{i+1}=L_i \\oplus f(R_i, K_i)", caption: "Magma 的 Feistel 轮结构，每轮用 32 位子密钥 K_i" },
    ],
    tips: [
      "GOST 28147-89 在 2015 年后官方改称 Magma（GOST R 34.12-2015），CTF 里两种名字都可能出现。",
      "S 盒不是固定的——GOST 允许不同应用使用不同的 S 盒。本实现用 id-GostR3411-94-CryptoProParamSet 的 test sbox。",
      "块长 64 位（8 字节），不比 AES 的 128 位，分组密码经典结构。",
      "CTF 里看到 GOST、Magma、俄罗斯加密、28147-89 这些关键词 → 用这个 op 解密。",
    ],
    aka: ["magma", "Magma", "GOST", "GOST 28147-89", "GOST R 34.12-2015", "俄罗斯加密", "GOST分组密码", "Feistel密码", "俄联邦标准", "8 S盒", "GOST Magma", "ГOCT", "GOST块密码", "俄罗斯国密", "GOST cipher"],
  },

  // ============ modern: ARIA 分组密码 ============
  aria: {
    what: "ARIA——韩国标准分组密码（KS X 1213 / RFC 5794），128 位分组，密钥 128/192/256 位，12/14/16 轮 SPN 结构，信创与韩国密码学竞赛常见。",
    principle:
      "ARIA 是 128 位块长的 SPN 分组密码，密钥 128/192/256 位对应 12/14/16 轮，末尾多一层密钥加。\n\n" +
      "轮结构：\n" +
      "1. 与轮密钥异或\n" +
      "2. 替换层 SL1 / SL2 交替（奇轮 SL1、偶轮 SL2，SL2 是 SL1 的逆）——4 个 8 位 S 盒 SB1/SB2/SB3/SB4 按 4 字节一组轮换\n" +
      "3. 扩散层 A：把每个输出字节写成固定 7 个输入字节的异或（线性层，且是对合，A(A(x))=x）\n\n" +
      "密钥编排：把密钥补零到 256 位得 KL||KR，再过 3 轮 Feistel 得到中间值 $W_0..W_3$，最后按循环左移/右移组合出 $ek_1..ek_{17}$。常数 CK1/CK2/CK3 来自 $1/\\pi$ 的小数部分。\n\n" +
      "解密与加密同结构，只需把轮密钥按规则重排（dk1=ek_{n+1}、中间用 A 变换、末个取 ek1）。\n\n" +
      "本实现已验证 RFC 5794 附录 A 三组向量（128/192/256 位密钥）全部通过。",
    usage:
      "参数：key 填 128/192/256 位 hex（32/48/64 字符），密钥长度决定轮数。\n" +
      "输入框填 hex（16 字节/32 hex 的整数倍，ECB 不自动填充）。编码=加密（输出 hex 密文），解码=解密（输入 hex 密文还原明文）。",
    examples: [
      { in: "00112233445566778899aabbccddeeff", param: "key=000102030405060708090a0b0c0d0e0f", out: "d718fbd6ab644c739da95f3be6451778(hex)", desc: "RFC 5794 附录 A.1，128 位密钥加密验证 ✓" },
    ],
    formulas: [
      { tex: "\\text{FO}(D,RK)=A(\\text{SL1}(D \\oplus RK)),\\quad \\text{FE}(D,RK)=A(\\text{SL2}(D \\oplus RK))", caption: "ARIA 奇偶轮函数：异或 → 替换层 → 扩散层 A" },
    ],
    tips: [
      "ARIA 是韩国标准，与国密 SM4 类似都是 128 位分组；CTF 韩国赛题（如 suninatas、CodeGate）常见。",
      "识别信号：题目提到 ARIA、KS X 1213、RFC 5794、韩国加密 → 用这个 op。",
      "ECB 模式块长 16 字节；CTF 里常配合已知明文或往返要求用加密/解密对。",
      "扩散层 A 是对合（自己两次等于原样），所以解密轮密钥只是重排 + 对部分轮密钥再跑一次 A，实现简洁。",
    ],
    aka: ["aria", "ARIA", "KS X 1213", "RFC 5794", "韩国标准", "韩国加密", "ARIA密码", "ARIA加密", "KATS", "韩标分组密码", "ARIA cipher", "SEED姊妹", "韩国国密", "ARIA-128", "ARIA-256"],
  },

  // ============ modern: SEED 分组密码 ============
  seed: {
    what: "SEED——韩国 KISA 开发的国家标准分组密码（RFC 4269 / RFC 4009），128 位分组 / 128 位密钥 / 16 轮 Feistel，韩国金融与加密通信广泛使用。",
    principle:
      "SEED 是 128 位块长的 Feistel 分组密码，128 位密钥，16 轮。\n\n" +
      "轮函数 F：把 64 位右半分成 R0/R1 两个 32 位块，先与子密钥异或，再经 3 层 G 函数 + 模 $2^{32}$ 加法交叉混合：\n" +
      "  t = (R0^Ki0) ^ (R1^Ki1)，a = R0^Ki0\n" +
      "  R0' = G[ G[G(t)+a] + G(t) ] + G[G(t)+a]\n" +
      "  R1' = G[ G[G(t)+a] + G(t) ]\n\n" +
      "G 函数：32 位输入拆 4 字节，两个 8x8 S 盒 S0/S1 交替，再用掩码 m0=0xFC/m1=0xF3/m2=0xCF/m3=0x3F 做字节线性混合（等价 4 个扩展 SS 盒）。\n\n" +
      "密钥调度：128 位密钥分 4 个 32 位块 Key0..Key3，16 个常数 KC1..KC16（黄金比 0x9E3779B9 循环移位）每轮生成两个子密钥 Ki0/Ki1；奇数轮后 Key0||Key1 右旋 8 位，偶数轮后 Key2||Key3 左旋 8 位。\n\n" +
      "本实现已验证 RFC 4269 附录 B 两组向量 + 多轮中间子密钥全部一致。",
    usage:
      "参数：key 填 128 位 hex（32 字符）。\n" +
      "输入框填 hex（16 字节/32 hex 的整数倍，ECB 不自动填充）。编码=加密（输出 hex 密文），解码=解密（输入 hex 密文还原明文）。",
    examples: [
      { in: "000102030405060708090a0b0c0d0e0f", param: "key=00000000000000000000000000000000", out: "5ebac6e0054e166819aff1cc6d346cdb(hex)", desc: "RFC 4269 附录 B.1 加密验证 ✓" },
    ],
    formulas: [
      { tex: "Z_0=\\{S_0(X_0)\\&m_0\\}\\oplus\\{S_1(X_1)\\&m_1\\}\\oplus\\{S_0(X_2)\\&m_2\\}\\oplus\\{S_1(X_3)\\&m_3\\}", caption: "SEED G 函数（Z0 低字节），S 盒 + 掩码线性混合" },
    ],
    tips: [
      "SEED 与 ARIA 同为韩国标准；RFC 4009 是旧版（S 盒定义有歧义），RFC 4269 修正后 SEED 算法本体没变。",
      "识别信号：SEED、KISA、韩国加密、RFC 4269 → 用这个 op。",
      "FEAL 系/韩国金融系统题目可能出现 SEED-CBC；本 op 提供 ECB 块原语。",
      "CTF 里若题目给的是 16 字节密钥 + 16 字节密文，多半就是 SEED/ARIA/SM4 一类 128 位分组密码，可逐个试。",
    ],
    aka: ["seed", "SEED", "KISA", "RFC 4269", "RFC 4009", "韩国加密", "韩国标准密码", "SEED密码", "KISA SEED", "韩国国密", "SEED cipher", "ARIA姊妹", "128位分组", "韩标密码", "SEED加密"],
  },

  // ============ modern: Camellia 分组密码 ============
  camellia: {
    what: "Camellia——NTT/三菱开发的 128 位分组密码（RFC 3713），128/192/256 位密钥，18/24 轮 Feistel，被 EU NESSIE 与日本 CRYPTREC 推荐，日本电子政务与 TLS 可用。",
    principle:
      "Camellia 是 128 位块长 Feistel 分组密码，密钥 128/192/256 位对应 18/24 轮，每 6 轮插入 FL/FLINV 函数打破 Feistel 对称性。\n\n" +
      "F 函数：64 位输入与子密钥异或 → 4 个 S 盒（SBOX2/3/4 由 SBOX1 旋转派生：$S_2[x]=S_1[x]\\lll1$、$S_3[x]=S_1[x]\\lll7$、$S_4[x]=S_1[x\\lll1]$）→ 8 输出字节线性混合（P 层）。\n\n" +
      "FL 函数（非线性层）：把 64 位拆两个 32 位，做 x2 ^= rol1(x1&k1)、x1 ^= x2|k2 的带进位交互；FLINV 是其逆。\n\n" +
      "密钥调度：128 位密钥 K 直接用为 KL、KR=0（192 位补 ~KR）；KL、KR 过 6 个 Sigma 常数（SHA-1 常数）混出 KA、KB；对 KL/KR/KA/KB 循环左移 15/30/45/60/77/94/111 位取半得子密钥。\n\n" +
      "本实现已验证 RFC 3713 附录 C 三向量（128/192/256 位）加解密全部一致，并与参考实现逐段对拍。",
    usage:
      "参数：key 填 128/192/256 位 hex（32/48/64 字符），密钥长度决定轮数。\n" +
      "输入框填 hex（16 字节/32 hex 的整数倍，ECB 不自动填充）。编码=加密（输出 hex 密文），解码=解密（输入 hex 密文还原明文）。",
    examples: [
      { in: "0123456789abcdeffedcba9876543210", param: "key=0123456789abcdeffedcba9876543210", out: "67673138549669730857065648eabe43(hex)", desc: "RFC 3713 附录 C，128 位密钥加密验证 ✓" },
    ],
    formulas: [
      { tex: "\\text{F}(F_{in},KE)=P(S\\_box(F_{in}\\oplus KE)),\\quad S_2[x]=S_1[x]\\lll1", caption: "Camellia F 函数：异或子密钥 → S 盒 → 线性层；S2 由 S1 旋转派生" },
    ],
    tips: [
      "Camellia 与 AES 并列被 NESSIE/CRYPTREC 推荐；日本系题目（SECCON 等）可能出现。",
      "识别信号：Camellia、RFC 3713、NESSIE、CRYPTREC、NTT → 用这个 op。",
      "FL/FLINV 每 6 轮插入一次是 Camellia 结构特征；192/256 位密钥都是 24 轮。",
      "ECB 块长 16 字节；CTF 里常配合已知明文或往返。",
    ],
    aka: ["camellia", "Camellia", "RFC 3713", "NESSIE", "CRYPTREC", "NTT加密", "三菱加密", "Camellia密码", "128位分组", "日本标准", "Camellia cipher", "日本加密", "Camellia-128", "Camellia-256", "FL函数"],
  },

  // ============ modern: Serpent 分组密码 ============
  serpent: {
    what: "Serpent——Anderson/Biham/Knudsen 设计的 AES 竞赛亚军分组密码，128 位分组，128/192/256 位密钥，32 轮 SPN，8 个 bit-sliced S 盒，安全余量极大。",
    principle:
      "Serpent 是 128 位块长的 SPN 分组密码，32 轮，密钥 128/192/256 位。\n\n" +
      "轮结构：\n" +
      "1. 与 32 位轮密钥异或\n" +
      "2. 8 个 4×4 S 盒之一（bit-sliced 查表，S0..S7 循环使用）\n" +
      "3. 线性变换：固定位排列 + 循环左移（13/3、1/7、5/22 组合）\n\n" +
      "最后一轮（第 32 轮）不做线性变换，只做 S 盒 + 异或。\n\n" +
      "密钥调度：密钥补 1 位到 256 位 → 8 个 32 位字 → 仿射递推 $w_i = rol(w_{i-8}\\oplus w_{i-5}\\oplus w_{i-3}\\oplus w_{i-1}\\oplus 0x9E3779B9\\oplus(i-8), 11)$ 生成 132 个预密钥 → 用逆序 S 盒变换得 33 组轮密钥。\n\n" +
      "本实现已验证 NESSIE 全部 514 组官方测试向量（128/192/256 位密钥）。",
    usage:
      "参数：key 填 128/192/256 位 hex（32/48/64 字符）。\n" +
      "输入框填 hex（16 字节/32 hex 的整数倍，ECB 不自动填充，little-endian 字序）。编码=加密（输出 hex 密文），解码=解密（输入 hex 密文还原明文）。",
    examples: [
      { in: "00000000000000000000000000000000", param: "key=80000000000000000000000000000000", out: "264e5481eff42a4606abda06c0bfda3d(hex)", desc: "NESSIE 测试向量，128 位密钥加密验证 ✓" },
    ],
    formulas: [
      { tex: "\\text{round: } X = S_{r\\%8}(X \\oplus K_r),\\quad X = L(X)", caption: "Serpent 轮：异或轮密钥 → bit-sliced S 盒 → 线性变换 L" },
    ],
    tips: [
      "Serpent 是 AES 竞赛亚军，32 轮超多轮数，安全设计最保守；CTF 偶见。",
      "识别信号：Serpent、Anderson/Biham/Knudsen、AES 决赛 → 用这个 op。",
      "8 个 S 盒是 4×4 的，用 bit-sliced 技术实现；与本项目的 PRESENT 同为轻量级风格。",
      "128 位密钥 32 轮；NESSIE 向量是最权威的验证来源。",
    ],
    aka: ["serpent", "Serpent", "Anderson", "Biham", "Knudsen", "AES决赛", "AES竞赛亚军", "32轮SPN", "Serpent密码", "bit-sliced", "NESSIE", "Serpent cipher", "serpent-128", "serpent-256", "ABK密码"],
  },
};
