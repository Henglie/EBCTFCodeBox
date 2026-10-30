/*
 * edu_t703_zh.js — T703 两 op 科普卡候选（中文）。
 * 候选文件，未接线；示例 out 值全部来自本项目实跑（verify_t703.mjs 34/0），未编造。
 */
export default {
  sha224: {
    what: "SHA-224 消息摘要——SHA-2 族的 224 位档：与 SHA-256 用**完全相同的压缩函数与常量**，只换了一套初始哈希值（IV）并截断输出前 28 字节（224 位）。本质是「SHA-256 的截断变体」。WebCrypto 标准故意不收 SHA-224（浏览器/Node 的 crypto.subtle 报 NotSupportedError），本工具用纯 JS 实现，与 OpenSSL（node:crypto）逐字节对拍。",
    principle:
      "**与 SHA-256 的关系（FIPS 180-4 §5.3.2 / §6.2.2）**：消息填充、消息调度（64 个扩展字）、64 轮压缩、K 常量表（前 64 个素数的立方根小数部分）全部与 SHA-256 一致，仅两处不同：\n\n" +
      "① **初始哈希值 IV**：8 个 32 位词 `c1059ed8 367cd507 3070dd17 f70e5939 ffc00b31 68581511 64f98fa7 befa4fa4`——取**第 9..16 个素数**（23,29,31,37,41,43,47,53）平方根小数部分的前 32 位（SHA-256 的 IV 用的是第 1..8 个素数）。⚠ h7 = `befa4fa4` 常被误抄成 befafa53（后者来自 SHA-512/224 的 64 位 IV 段）——本项目实现曾踩这个坑，被 FIPS 180-4 官方向量验证当场抓出，见 edu tips。\n\n" +
      "② **输出截断**：最终 8 个字（256 位）只取前 7 个字（H0..H6，28 字节）。\n\n" +
      "**与 SHA-3 的关系**：SHA-2 族（SHA-224/256/384/512）基于 Merkle-Damgård 结构 + Davies-Meyer 压缩；SHA-3 族基于 Keccak 海绵结构——两者是完全独立的设计（SHA-3 正是为应对 SHA-1/2 的结构风险而生）。SHA-224 不是「SHA-3 的 224 位档」，别混淆；SHA-3 的 224 位档叫 SHA3-224（本工具 sha3 op 的 224 位选档）。\n\n" +
      "**安全强度**：抗碰撞 112 位、原像 224 位（SHA-256 的 128/256 相应减半档），目前无实用攻击。",
    usage:
      "输入任意文本（或字节通道），输出 56 个 hex 字符的摘要。选档 256 可用同一实现交叉自证（与「SHA-256」op 输出逐字节一致——同一压缩函数、SHA-256 的 IV）。\n\n" +
      "适用场景：CTF 题目明说 SHA-224；拿到 56 字符 hex 摘要（28 字节）优先试它——16/20/24/28/32/48/64 字节分别对应 MD5/SHA-1/SHA-224/SHA-256/SHA-384/SHA-512 的特征长度。\n\n" +
      "注意本 op 是**单向哈希**：不可逆，别找「解密」。",
    examples: [
      { in: "abc", out: "23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7", desc: "FIPS 180-4 官方向量" },
      { in: "（空输入）", out: "d14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f", desc: "空串摘要——56 hex 字符是 SHA-224 的指纹长度" },
      { in: "（100 万个 a）", out: "20794655980c91d8bbb4c1ea97618a4bf03f42581948b2ee4ee7ad67", desc: "FIPS 180-4 百万 a 向量，逐字节一致" },
    ],
    formulas: [
      { tex: "H_i = H_{i-1} + \\mathrm{Compress}(H_{i-1}, M_i)\\quad(\\text{SHA-256 压缩})", caption: "与 SHA-256 共用压缩函数与 K 表（64 个素数立方根）" },
      { tex: "\\mathrm{SHA\\text{-}224}(M) = H_0\\|H_1\\|\\cdots\\|H_6\\;(\\text{前 28 字节})", caption: "唯一差异 = 第 9..16 素数平方根 IV + 截断" },
    ],
    tips: [
      "认题：56 个 hex 字符（28 字节）的哈希 → SHA-224；配合 hashcat/john 的命名 hashcat -m 1300。",
      "⚠ 本项目曾把 IV h7 误抄成 befafa53（来自 SHA-512/224 的 64 位 IV），空输入输出 8bd1cfa3… 全错——被 FIPS 向量当场抓出。教训：**IV/常量必须逐词对照标准原文**，自往返不能发现两处同错互逆（T629 门禁判例同款）。",
      "SHA-224 vs SHA3-224：名字像但完全不同算法（Merkle-Damgård vs Keccak 海绵）；拿到哈希先按长度二选一再按算法试。",
      "与其他工具互认：openssl dgst -sha224、hashlib.sha224（Python）、node:crypto sha224 输出与本 op 逐字节一致。",
      "WebCrypto 不支持 SHA-224 是 W3C 规范刻意取舍（非浏览器 bug）；本工具因此走纯 JS。",
      "标准来源：FIPS 180-4 §5.3.2（IV）/ §6.2.2（计算）/ §6.2（SHA-256 压缩共用）；验证含 FIPS 记名向量 + node:crypto 对拍 + 百万 a。",
    ],
    aka: ["SHA-224", "sha224", "SHA224", "224 位哈希", "SHA-2 224",
      "sha-224 hash", "SHA2-224", "SHA-224 摘要", "sha 224 位", "28 字节哈希",
      "SHA-224 checksum", "sha224 sum", "SHA-2 族 224", "sha224 摘要算法", "FIPS 180-4 224"],
  },

  cshake: {
    what: "cSHAKE128/256 可定制可扩展输出函数（NIST SP 800-185 §3.3）——SHAKE 的「可定制」版：在 SHAKE 之上加两个域分隔输入——「函数名 N」（区分使用该输出的不同协议/算法）与「定制串 S」（区分同一算法的不同应用场景）。输出长度任意（XOF 可扩展输出）。cSHAKE 是 KMAC、TupleHash、ParallelHash 三个派生函数的共同底座。",
    principle:
      "**构造**：cSHAKE128(X, L, N, S) = KECCAK[168](bytepad(encode_string(N) ‖ encode_string(S), 168) ‖ X, L)。三件套（§2.3）：\n\n" +
      "① `left_encode(x)` = [x 的字节数] ‖ x 大端——长度自描述编码；\n" +
      "② `encode_string(s)` = left_encode(8·len(s)) ‖ s——带长度的串；\n" +
      "③ `bytepad(X, w)` = left_encode(w) ‖ X ‖ 0x00…——把前缀凑满整个速率块 w。\n\n" +
      "N/S 经这三件套变成一个**完整速率块的前缀**，先于消息被吸收；cSHAKE 的域填充用 0x04（SHAKE 是 0x1f、SHA-3 是 0x06——同一条 Keccak 海绵靠域字节区分三种函数）。\n\n" +
      "**spec 等价规则**：N 与 S **同时为空**时 cSHAKE128(X, L, \"\", \"\") 就是 SHAKE128(X, L)——实现必须特判跳过前缀（否则 bytepad(01 00 01 00, w) 会破坏等价）；本工具实现已用现有 SHAKE op 断言该性质。\n\n" +
      "**家族关系一张图**：SHAKE = cSHAKE(N=S=空) ⊂ cSHAKE ⊃ KMAC = cSHAKE(N=\"KMAC\")（SP 800-185 §4.3，本工具 KMAC op）→ TupleHash/ParallelHash 同理（N 各为 \"TupleHash\"/\"ParallelHash\"）。SHA-3 = 定长档（Keccak 海绵 pad 0x06），不经过 cSHAKE。\n\n" +
      "**rate**：cSHAKE128 rate=168 字节（容量 512 位，碰撞抗性 128 位）；cSHAKE256 rate=136（碰撞 256 位）。",
    usage:
      "参数：安全强度 128/256、函数名 N、定制串 S（text 按 UTF-8 或 hex 逐字节）、输出字节数（任意长）。输入任意文本/字节。\n\n" +
      "N 通常留空（除非你实现的是某个以 cSHAKE 为底座的算法，如 KMAC 的 N=\"KMAC\"）；S 是应用自己的定制标签（样例 \"Email Signature\"、\"My Tagged Application\" 来自 SP 800-185）。\n\n" +
      "对拍口径提醒：NIST 未随 SP 800-185 分发官方样例文件（出版页确认）；CAVP 也不测 cSHAKE。本工具的对拍 = pycryptodomex（N=S=空路径）+ KMAC 全链组装关系（锚定 N=\"KMAC\" 与 S 路径）+ 同项目 KMAC op 交叉——任意 N/S 组合的正确性由「组装公式逐行照 spec」+ 双锚点支撑，edu 如实记录该边界。",
    examples: [
      { in: "（空输入，N=S=空，32B）", out: "7f9c2ba4e88f827d…（= SHAKE128 空输入）", desc: "spec 等价性质：cSHAKE 退化为 SHAKE" },
      { in: "00 01 02 03，S=\"Email Signature\"，32B", out: "（与 SP 800-185 样例定制串同参）", desc: "S 前缀吸收路径；N 留空" },
      { in: "KMAC 组装输入，N=\"KMAC\"，S=\"Email Signature\"", out: "（与 pycryptodomex KMAC128 输出逐字节一致）", desc: "KMAC ≡ cSHAKE(N=\"KMAC\")——N/S 路径的权威锚点" },
    ],
    formulas: [
      { tex: "\\mathrm{cSHAKE128}(X,L,N,S) = \\mathrm{KECCAK}[168](\\mathrm{bytepad}(\\mathrm{encode\\_string}(N)\\|\\mathrm{encode\\_string}(S), 168)\\|X, L)", caption: "cSHAKE 主式（SP 800-185 §3.3）；cSHAKE256 同构 rate=136" },
      { tex: "\\mathrm{bytepad}(X,w) = \\mathrm{left\\_encode}(w)\\|X\\|0^{*}\\;(\\text{凑满 } w \\text{ 字节})", caption: "前缀凑满整个速率块，保证域分隔与消息不跨块混淆" },
    ],
    tips: [
      "认题：题目提「cSHAKE」「customizable SHAKE」「domain-separated SHAKE」「SP 800-185」或出现 KMAC/TupleHash/ParallelHash 时——后三者都是 cSHAKE 的 N 封装。",
      "N 与 S 的分工：N 是**协议名**（谁的规范定义了这个用法），S 是**应用标签**（同一协议下区分场景）；CTF 里 S 常是出题人埋的字符串，直接填。",
      "N=S=空时输出与 SHAKE 完全一致——先跑 SHAKE 再加定制串，能快速定位「多出来的一层」是什么。",
      "字节序坑：N/S 的 text 模式按 UTF-8 编码；题目给的是原始字节就用 hex 模式，别混。",
      "输出长度任意：同一输入可派生任意长度（XOF），32B 与 64B 的前 32 字节相同——验证实现时注意别拿不同 L 的输出首段互比（前缀一致是性质不是 bug）。",
      "与 SHA-3/KMAC 的关系：SHA-3=定长（pad 0x06）→ SHAKE=XOF（pad 0x1f）→ cSHAKE=可定制 XOF（pad 0x04）→ KMAC/TupleHash/ParallelHash=cSHAKE 的 N 封装；一条海绵四层皮。",
      "标准来源：NIST SP 800-185 §2.3（编码三件套）/ §3.3（cSHAKE）/ §4.3（KMAC 关系）；XOF 输出长度下限受密钥/输出安全强度约束（§3.3 L ≥ 输出安全强度/8）。",
    ],
    aka: ["cSHAKE", "cSHAKE128", "cSHAKE256", "cSHAKE 可定制", "customizable SHAKE",
      "cshake hash", "cSHAKE 加密", "cSHAKE 摘要", "SP 800-185", "SP800-185",
      "KMAC 底座", "cSHAKE XOF", "域分隔 SHAKE", "cSHAKE128 hash", "TupleHash 底层"],
  },
};
