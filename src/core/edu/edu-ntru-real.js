/*
 * edu-ntru-real.js — 真 NTRU（EESS/NTRU Encrypt 产品式口径）三档科普卡（T398 批A）。
 * 格式契约见 eduContent.js 头注释：纯数据、无 import、无副作用。
 * 键 = op id：ntruKeyGen / ntruEncrypt / ntruDecrypt（src/core/ntruReal.js）。
 * aka 均 ≥10 条真实别名。
 */
export default {
  ntruKeyGen: {
    what: "生成真参数 NTRU 密钥对：公钥是一个 401~659 维的多项式 h，私钥是一个「稀疏三元小多项式」F（系数只有 −1/0/1）。NTRU 是 1996 年提出的格密码，也是最早被视为「抗量子」的公钥算法之一。",
    principle:
      "一切发生在多项式环 $R = \\mathbb{Z}[x]/(x^N-1)$ 里：乘法是「循环卷积」，$x^N$ 自动折回 $x^0$。\n\n" +
      "私钥用「产品式」$f = 1 + p \\cdot F_1 \\cdot F_2 + p \\cdot F_3$（EESS 口径，p=3）：$F_1,F_2,F_3$ 各是只有几十个 ±1 的稀疏三元多项式。乘积展开后 f 的系数仍然很小，但想从 f 反推三个分量极其困难——这是速度与安全的平衡设计。$f \\equiv 1 \\pmod p$（常数多项式 1）保证解密时模 p 还原明文无需求逆。\n\n" +
      "公钥 $h = p \\cdot g \\cdot f_q \\bmod q$（q=2048）：g 是另一个三元多项式，$f_q = f^{-1} \\bmod q$ 用「先 mod 2 欧几里得求逆、再 Hensel 逐级升幂到 $2^{11}$」算出。h 看起来是 0~2047 的随机数列，但只有持 f 的人能解开它混合进去的明文——其 hardness 归结为格中最短向量问题（SVP）。",
    usage:
      "选参数集（默认 ees401ep2，产品式 112-bit；也有标准式与 128-bit 档），点运行。输出公钥 h 与私钥（hex）。seed 留空用系统 CSPRNG；填固定 hex 可教学复现（同 seed 同密钥）。公钥粘进「NTRU 加密（真参数）」，私钥粘进「NTRU 解密（真参数）」。私钥 ⚠ 敏感。",
    examples: [
      { in: "（无需输入，直接运行）", param: "set=ees401ep2，seed 留空", out: "参数集: ees401ep2（N=401, q=2048, p=3, 产品式 d=8/8/6, dg=133…）\n公钥 h (552 B, hex): a401…\n私钥 (304 B, hex): 0201…", desc: "每次运行不同；固定 seed 可复现同一密钥" },
    ],
    tips: [
      "「产品式」指的是私钥 f 的构造方式 $f = 1 + p \\cdot F1 \\cdot F2 + p \\cdot F3$（三个稀疏多项式相乘相加），不是指密文格式；EESS 里标准式（$f = 1 + p \\cdot F$，F 是单个三元多项式）同样存在，本工具两种都支持。",
      "参数集名别张冠李戴：ees401ep1 / ees659ep1 在 IEEE 1363.1-2008 里是「标准式」，真正的产品式 112-bit 档叫 ees401ep2；ees439ep1 则是产品式 128-bit。",
      "私钥解密时只需要 f（由 F 分量重建），不需要 g 和 fq——所以本工具导出的私钥只有 F 分量，比公钥还短。",
      "CTF 里遇到 NTRU 题目先看参数：N、q、p 对上 ees 系列才能互通；ntruToy（n=8, q=257）是教学玩具，与真参数密钥完全不兼容。",
    ],
    aka: ["NTRU 密钥生成", "NTRU keygen", "NTRU 密钥对生成", "NTRUEncrypt 密钥生成", "EESS NTRU keygen", "NTRU 公私钥生成", "ees401ep2 密钥", "NTRU 产品式私钥", "NTRU key pair", "格密码 NTRU 密钥", "NTRU 后量子密钥", "NTRU 密钥对", "NTRUEncrypt keygen", "NTRU 真参数密钥"],
  },
  ntruEncrypt: {
    what: "用 NTRU 公钥 h 把明文加密成等长的多项式密文 $e = r \\cdot h + m \\pmod{q}$。加密速度极快（一次卷积），被认为能抵抗量子计算机的攻击。",
    principle:
      "三步（EESS 核心口径）：\n\n" +
      "① 编码：明文前拼一个随机 b 字段和长度字节，按 P1363.1 §9.2.2 的「3 bit → 2 个三元系数」表映射成多项式 m（系数 ∈ {−1,0,1}）；\n\n" +
      "② 盲化：随机抽一个与私钥同重量的三元多项式 r（产品式集用同样的 $F1 \\cdot F2 + F3$ 结构），算 $R = r \\cdot h \\bmod q$；\n\n" +
      "③ 合成：$e = R + m \\bmod q$。因为 $h = p \\cdot g \\cdot f_q$，接收方算 $f \\cdot e = p \\cdot r \\cdot g + f \\cdot m$：第一项是「噪声」，第二项里 $f \\equiv 1 \\pmod p$，模 3 一约减，噪声（含 p 因子）整个消失，只剩 m。\n\n" +
      "安全性：从 e 反推 r 或 m 需要解「nearly shortest vector」格问题；同一明文每次加密的 b、r 都随机，密文完全不同。",
    usage:
      "输入框填明文（UTF-8），粘贴「NTRU 密钥生成（真参数）」输出的公钥 hex，参数集选与生成时同一档。输出密文 hex（N=401 时 552 字节）。seed 留空随机；固定 seed 可复现同密文（教学用）。明文上限 = ⌈3⌈N/2⌉/8⌉ − db/8 − 2 字节（如 ees401ep2 为 60 字节），超长请先对称压缩或分片。",
    examples: [
      { in: "flag{ntru_is_fun}", param: "set=ees401ep2 + 公钥 hex", out: "参数集: ees401ep2（N=401, q=2048）\n明文 (14 B): 666c6167…\n密文 e (552 B, hex): 03a9…", desc: "同明文再加密一次，密文完全不同（随机 b 与 r）" },
    ],
    tips: [
      "NTRU 是「加噪 → 模 q」的格加密：密文里 e = 噪声 + 消息，解密靠「噪声的 p 倍模 3 归零」。这与 RSA 的「模幂」结构完全不同，CTF 里认准「q=2048、系数 0~2047 的密文串」。",
      "明文长度上限比 RSA 小得多（60 字节级），实战里 NTRU 只用来封装对称密钥（KEM 用法），大文件用 AES 加。",
      "加密输出密文前有一个 tag 字节标识参数集，解密时选错档会直接报 tag 不符——先对齐参数集再排查别的。",
      "本工具实现的是 EESS v3.1 的核心 PKE（被动安全）：未做 SVES 的 MGF 掩码与重加密检查，密文可塑性保留——不要拿它当生产库用。",
    ],
    aka: ["NTRU 加密", "NTRU encrypt", "NTRUEncrypt 加密", "NTRU 公钥加密", "EESS NTRU encrypt", "格密码加密 NTRU", "NTRU 后量子加密", "ees659ep1 加密", "NTRU 加密算法", "NTRU Encrypt", "NTRU 真参数加密", "NTRU 加密工具"],
  },
  ntruDecrypt: {
    what: "用 NTRU 私钥 f 把密文 e 还原成明文：一次卷积 + 一次「减法中心化」+ 一次模 3，就完成解密——这是 NTRU 比 RSA 快得多的原因。",
    principle:
      "解密四步（EESS 口径，与 libntru 的 decrypt_poly 逐行一致）：\n\n" +
      "① $a = f \\cdot e \\bmod q$：由 $e = r \\cdot h + m$、$h = p \\cdot g \\cdot f_q$ 展开，$f \\cdot e = p \\cdot r \\cdot g + f \\cdot m \\pmod q$；\n\n" +
      "② 中心化：把 a 的每个系数从 $[0,\ q)$ 搬回 $(-q/2,\ q/2]$（减法中心化）。设计参数保证真实值落在这个区间内，不会「绕回」；\n\n" +
      "③ mod 3：$p \\cdot r \\cdot g$ 的系数全被 3 整除，而 $f \\equiv$ 常数 1 $\\pmod p$，所以模 3 后噪声彻底消失，剩下 m 的系数（0/1/2，2 代表 −1）；\n\n" +
      "④ SVES 逆映射：m 的系数两两一组（3 bit 一对）解回字节流，校验零填充与长度字段，取出明文。\n\n" +
      "若密文被篡改或参数不符，「绕回」会使 m 出现非法 (2,2) 系数对或破坏零填充——工具据此报错而非输出乱码。",
    usage:
      "粘贴「NTRU 密钥生成（真参数）」输出的私钥 hex 和「NTRU 加密（真参数）」输出的密文 hex，参数集选同一档。输出 UTF-8 明文（非 UTF-8 时给 hex）。解密失败会明确报错（长度非法 / 零填充校验失败 / 非法系数对），不会输出假明文。",
    examples: [
      { in: "密文 hex（552 B）", param: "set=ees401ep2 + 私钥 hex", out: "参数集: ees401ep2\n明文 (14 B):\nflag{ntru_is_fun}", desc: "改密文任意系数再解，几乎必然报错或得到损坏明文" },
    ],
    tips: [
      "解密三件套按顺序排查：tag 与参数集是否一致 → 私钥 hex 是否完整（产品式 3 段、标准式 1 段，长度固定）→ 密文是否被截断（N=401 必须 552 字节）。",
      "「解密失败」在 NTRU 里有严格含义：真实噪声值超出 q/2 导致绕回。EESS 的产品式参数把失败率压到 $2^{-112}$ 以下（ees401ep2 理论值 $2^{-217}$），正常使用碰不到。",
      "核心 PKE 不含完整性校验：攻击者改密文个别系数可能只损坏明文个别字节而不报错（可塑性）。这是教科书式 NTRU 的固有性质，生产方案用 SVES 变换补 CCA-2 防护。",
      "CTF 套路：题目给「私钥多项式系数列表」让你手解——按 $a = f \\cdot e \\bmod q$ → 中心化 → mod 3 三步走即可，注意系数中心化到 $(-q/2,\ q/2]$ 再取模 3。",
    ],
    aka: ["NTRU 解密", "NTRU decrypt", "NTRUEncrypt 解密", "NTRU 私钥解密", "EESS NTRU decrypt", "格密码解密 NTRU", "NTRU 后量子解密", "NTRU 解密算法", "NTRU Decrypt", "NTRU 密文还原", "NTRU 真参数解密", "NTRU 解密工具"],
  },
};
