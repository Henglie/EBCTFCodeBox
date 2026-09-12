/*
 * edu-xwing-family.js — X-Wing 混合 KEM 三档算法族科普卡（T398 批A：PQC 迁移热点）。
 * 格式契约见 eduContent.js 头注释：纯数据、无 import、无副作用。
 * aka 均 ≥10 条真实别名（_alias_verify 三件套红线）。
 */
export default {
  xwingKeyGen: {
    what: "生成 X-Wing 混合 KEM 密钥对：私钥只有一个 32 字节种子 sk，公钥 pk（1216 字节）= ML-KEM-768 公钥（1184B）‖ X25519 公钥（32B）——一把钥匙同时锁「后量子」和「经典椭圆曲线」两道门。",
    principle:
      "X-Wing（draft-connolly-cfrg-xwing-kem）是 X25519 + ML-KEM-768 的混合 KEM，为「量子计算机哪天真能破解 ECDH」的迁移期设计：两条腿缺一条都还安全。\n\n" +
      "密钥生成极简：sk 就是 32 字节种子（不是两把私钥拼接！）。SHAKE256(sk, 96) 把种子扩展成 96 字节，切成三段：[0:32] 作 ML-KEM-768 的种子 d、[32:64] 作种子 z、[64:96] 直接作 X25519 私钥。ML-KEM 用 (d,z) 跑 FIPS 203 KeyGen_internal 出 1184B 公钥，X25519 私钥乘基点 9 出 32B 公钥，两个公钥拼起来就是 1216B 的 pk。\n\n" +
      "单一种子的好处：私钥传输/存储口径恒定 32B，且 MAL-BIND-K-PK 绑定性质成立（公钥与私钥死锁，防组件替换攻击）。",
    usage:
      "参数填 32 字节种子 sk（hex 64 字符，留空随机）。教学复现可填官方测试向量种子 7f9c2ba4e88f827d616045507605853ed73b8093f6efbc88eb1a6eacfa66ef26。输出 32B 私钥与 1216B 公钥，pk 可直接粘进封装档。",
    examples: [
      { in: "（无需输入，直接运行）", param: "seed=7f9c2ba4e88f827d616045507605853ed73b8093f6efbc88eb1a6eacfa66ef26", out: "sk = 7f9c2ba4…（32B）\npk = e2236b35…（1216B，草案附录 C 向量 #1）", desc: "官方向量逐字节复现；pk 前 1184B 是 ML-KEM ek，末 32B 是 X25519 公钥" },
    ],
    tips: [
      "X-Wing 的私钥是 32 字节种子，不是「X25519 私钥 ‖ ML-KEM 私钥」的拼接——网上有人按拼接理解会直接解出错误结构。",
      "pk 顺序：ML-KEM 公钥在前（1184B）、X25519 公钥在后（32B）；密文 ct 则是 ML-KEM ct 在前、X25519 临时公钥在后，两套顺序别记混。",
      "1216 = 1184 + 32，1120 = 1088 + 32：记住这两个和式就能在 CTF 里快速认出 X-Wing 的 pk/ct。",
      "TLS 里的实际用例：Chrome/Firefox 的 TLS 1.3 X25519Kyber768（后更名 X25519MLKEM768）混合密钥共享就是 X-Wing 的工程化前身。",
      "OID 是 1.3.6.1.4.1.62253.25722（id-XWing），25722 = 25519 + 203（X25519 的 25519 + FIPS 203），HPKE 代码点同为 0x647a。",
    ],
    aka: ["X-Wing 密钥生成", "X-Wing keygen", "X-Wing key generation", "XWing GenerateKeyPair", "X-Wing 混合密钥生成", "X-Wing 密钥对生成", "hybrid KEM keygen", "X25519 ML-KEM-768 密钥生成", "PQC 混合密钥生成", "后量子混合密钥", "draft-connolly-cfrg-xwing-kem keygen", "X-Wing seed 扩展", "X-Wing 私钥生成", "X-Wing 公钥生成"],
  },
  xwingEncaps: {
    what: "用 X-Wing 公钥 pk（1216B）封装出共享密钥 ss（32B）和密文 ct（1120B）：双组件各自封装，再把两个共享密钥用 SHA3-256 组合器搅成一把 32B 会话密钥。",
    principle:
      "封装三步（draft §5.4）：① X25519 侧：随机临时私钥 ek_X，ct_X = X25519(ek_X, 基点9)（即临时公钥），ss_X = X25519(ek_X, pk_X)；② ML-KEM 侧：对 pk_M 跑标准 ML-KEM-768.Encaps 得 (ss_M, ct_M)；③ 组合器（§5.3 逐字）：\n\n" +
      "ss = SHA3-256(ss_M ‖ ss_X ‖ ct_X ‖ pk_X ‖ XWingLabel)\n\n" +
      "XWingLabel = \"\\./\" ‖ \"/^\\\" = 5c2e2f2f5e5c（6 字节 ASCII）。注意三个细节：ct_M 不进组合器（安全性依赖 ML-KEM-768 特有的 FO 变换，草案 §6 明确警告换其他 KEM 不保安全）；ct_X 与 pk_X 都进（把临时公钥和接收方公钥死锁进哈希）；标签在末尾。密文 ct = ct_M ‖ ct_X（1120B）。安全性声明：只要 SHA3 安全，且 X25519 与 ML-KEM-768 至少一个安全，ss 就安全。",
    usage:
      "输入框填 X-Wing 公钥 pk（1216B hex，密钥生成档产出），eseed 留空随机；填 64B eseed 可复现官方向量（eseed 前 32B 给 ML-KEM 当随机性 m、后 32B 给 X25519 当临时私钥）。输出 ct 与 ss，ct 粘进解封装档、ss 与对方比对。",
    examples: [
      { in: "pk = e2236b35…（官方向量 #1 的 1216B 公钥）", param: "eseed=3cb1eea988004b93…（64B 官方向量）", out: "ct = b83aa828…（1120B）\nss = d2df0522128f09dd8e2c92b1e905c793d8f57a54c3da25861f10bf4ca613e384", desc: "draft-connolly-cfrg-xwing-kem 附录 C 测试向量 #1 逐字节复现" },
    ],
    tips: [
      "组合器输入顺序是 ss_M 在前、ss_X 在后——实现时写反了和官方向量对不上，CTF 复现时先查这里。",
      "标签 5c2e2f2f5e5c 拆开看是 ASCII「\\./」「/^\\」——画出来是个小飞机图案，所以好记：X-Wing 标签本身就是个 X 翼战斗机。",
      "ct_M 不进组合器不是疏忽：这是规范刻意为之，依赖 ML-KEM-768 的 FO 变换性质（SCHMIEG 攻击论文说明为何通用 KEM 组合器需要更多输入）。",
      "复现官方向量必须同时固定 sk（32B）和 eseed（64B）：pk 由 sk 决定，ss 由两者共同决定，缺一个都对不上。",
      "1120B 密文末 32B 就是 X25519 临时公钥——拿到 ct 和接收方 pk_X 其实已经能自己算出 ss_X，缺的只有 ss_M。",
    ],
    aka: ["X-Wing 封装", "X-Wing encapsulate", "XWing Encapsulate", "X-Wing 加密", "X-Wing 密钥封装", "hybrid encapsulation", "X25519 ML-KEM-768 encapsulation", "PQC 混合封装", "X-Wing HPKE encap", "X-Wing combiner", "X-Wing 组合器", "X-Wing shared secret 计算", "draft-connolly-cfrg-xwing-kem encapsulation", "后量子混合封装"],
  },
  xwingDecaps: {
    what: "用 X-Wing 私钥 sk（32 字节种子）解封装密文 ct（1120B）还原共享密钥 ss（32B）：从种子重新扩展出双组件私钥，两侧各自解密，重跑组合器——合法密文必与封装方一致。",
    principle:
      "解封装（draft §5.5）：先 expandDecapsulationKey(sk) 从 32B 种子重扩展出 ML-KEM 私钥与 X25519 私钥（与密钥生成同一函数，无需存扩展结果）；拆 ct = ct_M(1088B) ‖ ct_X(32B)；ss_M = ML-KEM-768 解封装 ct_M，ss_X = X25519(sk_X, ct_X)；最后 ss = SHA3-256(ss_M ‖ ss_X ‖ ct_X ‖ pk_X ‖ XWingLabel)——pk_X 由 sk_X 重算，与封装方天然一致。\n\n" +
      "任何一处被篡改（ct_M 或 ct_X），组合器输出都会雪崩成完全不同的 32B——通信双方密钥对不上即暴露，这就是 KEM 绑定性质在起作用。",
    usage:
      "输入框填密文 ct（1120B hex，封装档产出），参数填私钥 sk（32B hex 种子，密钥生成档产出）。输出 32B 共享密钥 ss，与封装方输出比对，一致即建立共享密钥。",
    examples: [
      { in: "ct = b83aa828…（官方向量 #1 的 1120B 密文）", param: "sk=7f9c2ba4e88f827d616045507605853ed73b8093f6efbc88eb1a6eacfa66ef26", out: "ss = d2df0522128f09dd8e2c92b1e905c793d8f57a54c3da25861f10bf4ca613e384（与封装档一致 ✓）", desc: "官方向量端到端：同一 ss 在封装/解封装两侧复现" },
    ],
    tips: [
      "sk 只要 32B 种子即可解封装——别去找 2400B 的 ML-KEM 私钥或 2544B 的「拼接私钥」，X-Wing 私钥口径就是种子本身。",
      "解封装会从种子重新扩展双组件私钥（SHAKE256 跑一遍 + ML-KEM keygen 重算），性能上比拼接式混合 KEM 略慢，但换来 MAL-BIND-K-PK/CT 绑定性质——这是规范刻意的取舍。",
      "解密失败不会报「密钥错」，而是输出一个「错误但确定」的 32B 值——两侧 ss 对不上就是失败信号，KEM 不提供额外报错信息。",
      "CTF 认结构：密文 1120B = 1088B ML-KEM-768 ct + 32B X25519 点；公钥 1216B = 1184B + 32B。长度对上基本就是 X-Wing。",
      "X-Wing 已进 HPKE（RFC 9180 扩展代码点 0x647a）与 TLS 混合共享草案，是当前部署面最广的后量子迁移 KEM 组合。",
    ],
    aka: ["X-Wing 解封装", "X-Wing decapsulate", "XWing Decapsulate", "X-Wing 解密", "X-Wing 密钥解封装", "hybrid decapsulation", "X25519 ML-KEM-768 decapsulation", "PQC 混合解封装", "X-Wing HPKE decap", "X-Wing shared secret 恢复", "draft-connolly-cfrg-xwing-kem decapsulation", "X-Wing 私钥扩展", "后量子混合解密", "X-Wing 会话密钥还原"],
  },
};
