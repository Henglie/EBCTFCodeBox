/*
 * edu-modern-new.js — 科普补缺分片（T310，现代加密 + 哈希/派生）。
 *
 * 覆盖 5 个真实缺失 op 的科普卡：
 * modern: rabbit, flashSwirl
 * hash: pbkdf2, hkdf, md2
 *
 * 覆盖核查（撞已引分片的已剔除）：
 * - rc5/idea/blowfish/rc6 → 已由 edu-modern1.js / edu-modern2.js 覆盖，删
 *
 * 纯数据无副作用，无 import 无 register。M 在 eduContent.js 归并。
 * EduEntry 格式照 eduContent.js 头注释契约。
 */
export default {
 // ============ modern: Rabbit 流密码 ============
  rabbit: {
    what: "Rabbit 流密码——RFC 4503 定义的高速对称流密码，用 128 位密钥 + 64 位 IV 生成密钥流，再和明文异或。",
    principle:
      "核心是 8 个 32 位状态量 X[0..7] 和 8 个计数器 C[0..7]，外加 1 位进位 b。\n\n" +
      "密钥装载：把 16 字节密钥拆成 8 个 16 位子密钥 K[0..7]，按 even/odd 不同公式初始化 X 和 C，再迭代 4 次 nextState 后把 C 与 X 交叉异或。\n\n" +
      "IV 装载：把 8 字节 IV 拆成 4 个 16 位片段，按 RFC 4503 §2.4 混入 C，再迭代 4 次 nextState。\n\n" +
      "nextState：先更新计数器（带进位链），再用 g 函数 $g(u) = \\text{low}_{32}(u^2) \\oplus \\text{high}_{32}(u^2)$ 算出 G[0..7]，最后按旋转加法公式更新 X。提取密钥流时把 X 的 16 位半字异或输出 16 字节块。\n\n" +
      "加解密同形：密文 = 明文 ⊕ 密钥流，解密用同样的 key/IV 再异或一次即还原。",
    usage: "输入框填文本，参数 key 填 32 位 hex（16 字节），iv 填 16 位 hex（8 字节）。编码输出 hex 密文；解码填同样的 key/iv 即可还原文本。",
    examples: [
      { in: "Hello", param: "key=00000000000000000000000000000000, iv=0000000000000000", out: "A5D2690B58", desc: "全 0 key/IV：密钥流取 RFC 4503 §3.2 的 S[0]=edb70567… 前 5 字节与 Hello 异或" },
    ],
    formulas: [
      { tex: "g(u) = \\text{lo}_{32}(u^2) \\oplus \\text{hi}_{32}(u^2)", caption: "Rabbit 的 g 函数：平方后高低 32 位异或" },
    ],
    tips: [
      "Rabbit 的 key 必须 16 字节（32 hex），IV 必须 8 字节（16 hex），少了会报错。",
      "流密码特征：加解密用同一套 key+IV，密文 = 明文 ⊕ 密钥流。",
      "CTF 里题目给 Rabbit 参数和密文，直接填 key/iv 解码即可。",
    ],
    aka: ["rabbit", "rabbit流密码", "rfc 4503", "Rabbit", "Rabbit cipher", "兔子流密码", "Rabbit stream cipher", "eSTREAM", "高速流密码", "对称流密码", "Rabbit加密", "128位流密码"],
  },

 // ============ modern: FlashSwirl 闪旋 流密码 ============
  flashSwirl: {
    what: "FlashSwirl（闪旋）——作者「风之暇想」设计的 ARX（加-旋转-异或）对称流密码，256 位密钥 + 192 位 nonce，结构灵感来自 ChaCha20，但用双 Quarter Round + 对角线混合的状态搅动策略。",
    principle:
      "内部状态是 8 个 32 位字 $[s_0, s_1, \\ldots, s_7]$（共 256 位），核心是 Quarter Round 和 Swirl Round 两级运算。\n\n" +
      "Quarter Round：对 4 个字 $(a,b,c,d)$ 做 ARX 混合——`a+=b; d=(d⊕a)<<<16; c+=d; b=(b⊕c)<<<12; a+=b; d=(d⊕a)<<<8; c+=d; b=(b⊕c)<<<7`，只用模 $2^{32}$ 加法、循环左移、异或，天然抗线性/差分攻击。\n\n" +
      "Swirl Round：先对 $(s_0..s_3)$ 和 $(s_4..s_7)$ 各跑一次 Quarter Round，再对角线取 $(s_0,s_5,s_2,s_7)$ 和 $(s_1,s_4,s_3,s_6)$ 各跑一次——对角混合让两组状态充分扩散。\n\n" +
      "密钥流：把 $\\text{固定初始状态} \\oplus \\text{key} \\oplus \\text{nonce}$ 作基础块，混入 64 位计数器后跑 8/20 轮 Swirl Round，最后加回原始状态（ChaCha 式 finalization 防逆推），输出 32 字节密钥流块与明文异或。\n\n" +
      "加解密同形：密文 = 明文 ⊕ 密钥流，解密用同样的 key/nonce 再异或一次即还原。",
    usage: "输入框填文本，参数 key 填 64 位 hex（32 字节），nonce 填 48 位 hex（24 字节），rounds 选 20 轮（标准）或 8 轮（快速）。编码输出 hex 密文；解码填同样的 key/nonce/rounds 即可还原。",
    examples: [
      { in: "Hello", param: "key=64 hex, nonce=48 hex, rounds=20", out: "(hex 密文)", desc: "对称流密码，加解密用同一套 key+nonce，密文 = 明文 ⊕ 密钥流" },
    ],
    formulas: [
      { tex: "a \\mathrel{+}= b;\\ d = (d \\oplus a) \\lll 16;\\ c \\mathrel{+}= d;\\ b = (b \\oplus c) \\lll 12", caption: "FlashSwirl Quarter Round 的前半（ARX：加-旋转-异或）" },
    ],
    tips: [
      "FlashSwirl 的 key 必须 32 字节（64 hex）、nonce 必须 24 字节（48 hex），少了会报错。",
      "轮数只有 8（快速）和 20（标准）两档，其余值会回落到 10 次 Swirl Round。",
      "和 ChaCha20 同属 ARX 流密码，区别在 FlashSwirl 用双 Quarter Round + 对角线混合、256 位状态、192 位 nonce。",
      "CTF 里题目给 key/nonce/轮数和 hex 密文，直接填参数解码即可。",
    ],
    aka: ["flashswirl", "闪旋", "闪旋算法", "FlashSwirl", "闪旋流密码", "风之暇想", "FlashSwirl cipher", "ARX流密码", "闪旋加密", "flash swirl", "FlashSwirl-20", "FlashSwirl-8", "闪旋对称加密"],
  },

 // ============ hash: PBKDF2 密钥派生 ============
  pbkdf2: {
    what: "PBKDF2——基于口令的密钥派生函数，把一个弱口令 + 盐值反复哈希很多次，拉伸成指定长度的密钥。",
    principle:
      "PBKDF2（Password-Based Key Derivation Function 2，RFC 2898/8018）用伪随机函数 PRF（通常是 HMAC-SHA-256）迭代计算：\n\n" +
      "$$DK = T_1 \\| T_2 \\| \\cdots \\| T_{dkLen/hLen}$$\n" +
      "其中每块 $T_i = F(\\text{Password}, \\text{Salt}, c, i)$，$F$ 的迭代式为 $U_1 = \\text{PRF}(P, S \\| i)$，$U_2 = \\text{PRF}(P, U_1)$，…，$U_c = \\text{PRF}(P, U_{c-1})$，最终 $T_i = U_1 \\oplus U_2 \\oplus \\cdots \\oplus U_c$。\n\n" +
      "迭代次数 c 越大，暴力破解越慢，安全性越高（典型 1 万到 10 万次）。本工具走 WebCrypto subtle.deriveBits 原生实现。",
    usage: "输入框填口令（UTF-8），参数 salt 填盐值、saltFormat 选格式（utf8/hex/base64）、iterations 填迭代次数（默认 1000）、keyLen 填输出字节数（默认 32）、hash 选哈希算法（SHA-1/256/384/512）。输出为 hex 串。",
    examples: [
      { in: "password", param: "salt=salt, saltFormat=utf8, iterations=1, keyLen=20, hash=SHA-1", out: "0c60c80f961f0e71f3a9b524af6012062fe037a6", desc: "RFC 6070 官方测试向量（PBKDF2-HMAC-SHA1）" },
    ],
    formulas: [
      { tex: "T_i = U_1 \\oplus U_2 \\oplus \\cdots \\oplus U_c,\\quad U_j = \\text{PRF}(P, U_{j-1})", caption: "PBKDF2 每块的迭代异或结构" },
    ],
    tips: [
      "CTF 给了口令、盐、迭代次数和算法就能算出密钥，参数全在题面里。",
      "iterations 是安全核心：真实系统用 10 万次以上抗暴力破解，CTF 题目常给小值方便计算。",
      "和 HKDF 的区别：PBKDF2 靠反复迭代拉伸弱口令，HKDF 靠 extract+expand 扩展已有高熵密钥。",
    ],
    aka: ["pbkdf2", "密钥派生", "rfc 2898", "rfc 8018", "password based key derivation", "PBKDF2", "基于口令的密钥派生", "口令派生密钥", "PKCS#5", "密码拉伸", "key stretching", "迭代哈希派生", "PBKDF2-HMAC"],
  },

 // ============ hash: HKDF 密钥派生 ============
  hkdf: {
    what: "HKDF——基于 HMAC 的密钥派生函数，把一段输入密钥材料（IKM）提取精炼再扩展成指定长度的密钥。",
    principle:
      "HKDF（HMAC-based Key Derivation Function，RFC 5869）分两步：\n\n" +
      "Extract（提取）：用盐 salt 对 IKM 做一次 HMAC，得到固定长度的伪随机密钥 PRK：$PRK = \\text{HMAC}(\\text{salt}, \\text{IKM})$。salt 为空时用全零串。\n\n" +
      "Expand（扩展）：用 PRK 和 info 上下文串迭代生成所需长度的密钥块：$OKM = T(1) \\| T(2) \\| \\cdots$，其中 $T(0)$ 为空，$T(i) = \\text{HMAC}(PRK, T(i-1) \\| \\text{info} \\| i)$。\n\n" +
      "本工具走 WebCrypto subtle.deriveBits 原生实现，IKM / salt / info 均支持 utf8/hex/base64 三种格式。",
    usage: "输入框填 IKM（输入密钥材料），参数 ikmFormat 选 IKM 格式、salt/saltFormat 填盐值（可空）、info/infoFormat 填上下文（可空）、keyLen 填输出字节数（默认 32）、hash 选哈希算法。输出为 hex 串。",
    examples: [
      { in: "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b", param: "ikmFormat=hex, salt=000102030405060708090a0b0c, saltFormat=hex, info=f0f1f2f3f4f5f6f7f8f9, infoFormat=hex, keyLen=42, hash=SHA-256", out: "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865", desc: "RFC 5869 测试用例 1（HKDF-SHA256）" },
    ],
    formulas: [
      { tex: "PRK = \\text{HMAC}(\\text{salt},\\,\\text{IKM}),\\quad T(i) = \\text{HMAC}(PRK,\\,T(i{-}1)\\|\\text{info}\\|i)", caption: "HKDF 的 extract + expand 两步" },
    ],
    tips: [
      "HKDF 适合 IKM 已经有足够熵（如 DH 共享密钥）的场景，不靠迭代抗暴力。",
      "info 用来把同一段 PRK 派生成不同用途的密钥（会话密钥/IV/MAC 密钥等），改 info 即得不同输出。",
      "和 PBKDF2 的区别：PBKDF2 拉伸弱口令靠迭代，HKDF 提炼高熵 IKM 靠 extract+expand。",
    ],
    aka: ["hkdf", "密钥派生", "rfc 5869", "hmac based key derivation", "HKDF", "基于HMAC的密钥派生", "extract expand", "提取扩展", "HKDF-SHA256", "HMAC密钥派生函数", "密钥扩展", "OKM派生"],
  },

 // ============ hash: MD2 摘要 ============
  md2: {
    what: "MD2——RSA 实验室早期设计的 128 位消息摘要算法（RFC 1319），专为 8 位机优化，现已不安全但 CTF 仍会出现。",
    principle:
      "MD2 处理流程：\n\n" +
      "1. 填充：把消息补到 16 字节整数倍，补 i 个值为 i 的字节（i = 16 - len%16，恒为 1..16）。\n\n" +
      "2. 校验和：用 16 字节 checksum 逐块更新，每字节 `checksum[j] ^= S[msg[off+j] ^ L]`，其中 L 是上一轮的 checksum 值，S 是 256 字节的 pi 置换表。\n\n" +
      "3. 主循环：48 字节状态 X，对每个 16 字节块（含尾接的 checksum 块）做 18 轮更新：`X[j] ^= S[t]`（t 是上一轮末值），每轮后 `t = (t + round) & 0xff`。\n\n" +
      "最终取 X 的前 16 字节作为 128 位摘要。WebCrypto 不支持 MD2，本工具纯 JS 实现并按 RFC 1319 附录验证。",
    usage: "输入框填文本，点运行即输出 128 位（32 位 hex）摘要。单向不可逆，无参数。",
    examples: [
      { in: "", out: "8350e5a3e24c153df2275c9f80692773", desc: "RFC 1319 空串测试向量" },
      { in: "a", out: "32ec01ec4a6dac72c0ab96fb34c0b5d1", desc: "RFC 1319 单字符测试向量" },
    ],
    tips: [
      "MD2 已被密码学界证明不安全（存在碰撞攻击），现代系统不用，但 CTF 老题里还会出现。",
      "输出固定 128 位（32 hex 字符），和 MD4/MD5 长度一样但算法完全不同。",
      "识别特征：题目给了一段 32 位 hex 且提示是老式摘要、8 位机优化 → 想 MD2。",
    ],
    aka: ["md2", "md2摘要", "rfc 1319", "rsa md2", "MD2", "MD2哈希", "Message Digest 2", "消息摘要2", "MD2算法", "128位摘要", "MD2 hash", "RSA实验室摘要"],
  },
};
