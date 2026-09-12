/*
 * edu-protocol-c.js — T398 批C 协议原语科普卡（Merkle / Pedersen / Feldman / LSAG）。
 * aka 均 ≥10 条真实别名。
 */
export default {
  merkleProve: {
    what: "构造 Merkle 包含证明：证明「某个叶子确实在这棵 SHA-256 哈希树里」——只需一条从叶子到根的兄弟哈希路径（对数级大小）。",
    principle:
      "叶子 = SHA-256(原文)；父 = SHA-256(左 ‖ 右)；逐层向上到根。包含证明 = 目标叶子的兄弟哈希序列，验证方重算到根比对即可，无需整棵树。\n\n" +
      "单叶层奇数节点补自身合成（Bitcoin 口径）。",
    usage: "主输入每行一个叶子，参数给目标叶子序号。输出根、叶子哈希与兄弟路径 JSON（可直接喂给验证 op）。",
    examples: [
      { in: "a\\nb\\nc\\nd", param: "leafIndex=2", out: "根 + 叶子哈希 + L/R 路径 JSON", desc: "验证 op 用原文 + JSON 即可复核，无需整棵树" },
    ],
    tips: [
      "证明大小 = $\\lceil \\log_2 n \\rceil$ 个哈希——百万叶子也只要 20 个哈希，这是区块链轻节点的基础。",
      "路径里的 side（L/R）标记兄弟在合成时在左还是右，顺序错一个根就对不上。",
      "CTF 里给一棵树的 JSON 让你找 flag 叶子，就是考这个结构。",
    ],
    aka: ["Merkle 包含证明", "merkle proof", "默克尔证明", "Merkle 证明生成", "哈希树证明", "merkle tree proof", "Merkle 树", "默克尔树包含", "merkle inclusion", "Merkle 路径", "区块链 Merkle", "merkle 根验证", "默克尔路径", "Merkle audit"],
  },
  merkleVerify: {
    what: "验证 Merkle 包含证明：用叶子原文 + 兄弟路径重算根，与声明根比对——O(log n) 即确认归属。",
    principle:
      "重算：leaf = SHA-256(原文)，沿路径逐层 H(cur ‖ sibling) 或 H(sibling ‖ cur)（按 side），最终根与声明根一致则证明有效。\n\n" +
      "根是全部内容的承诺——改任何一个叶子，根必变。",
    usage: "主输入填目标叶子原文，参数粘 merkleProve 输出的 JSON。输出有效/无效。",
    examples: [
      { in: "c", param: "merkleProve 的 JSON", out: "✓ 包含证明有效", desc: "把原文改成 c! 立即 ✗" },
    ],
    tips: [
      "验证只需要叶子原文 + 路径 + 根——不需要其他任何叶子。",
      "被『信任根』替代的场景：根本身要对（来自区块头/证书等可信来源）。",
      "证明 JSON 里的 index 与路径要配套——拿 A 叶子的路径验 B 叶子必败。",
    ],
    aka: ["Merkle 证明验证", "merkle verify", "默克尔验证", "Merkle 验证", "哈希树验证", "merkle proof verify", "Merkle 包含验证", "默克尔根比对", "merkle root check", "Merkle 包含", "区块链证明验证", "merkle audit verify", "轻节点验证", "Merkle 路径验证"],
  },
  pedersenCommit: {
    what: "Pedersen 承诺：对数值 m 生成承诺 $C = m \\cdot G + r \\cdot H$——承诺后 m 无法反推（隐藏性），事后也无法改口（绑定向量）。",
    principle:
      "$C = m \\cdot G + r \\cdot H$（SM2 群点加）：隐藏性来自 r 的随机性（C 均匀分布）；绑定向量来自离散对数——已知 C 想找 m'≠m, r' 使 C=m'G+r'H 等于解椭圆曲线 DLP。\n\n" +
      "打开 = 公布 (m, r)，验证方重算 $m \\cdot G + r \\cdot H$ 与 C 比对。H 是与 G 无代数关系的第二基点（本工具确定性派生）。",
    usage: "参数填 m（数字），r 留空随机——输出承诺 C 与 r（⚠ r 必须保存，打开时要用）。勾选验证模式则填 C/m/r 校验打开是否成立。",
    examples: [
      { in: "（无需主输入）", param: "m=42，r 留空随机", out: "C: 04…（130 hex）\\nr: 3f…（保存！）", desc: "验证模式填回 C/m/r → ✓ 通过；m 改成 43 → ✗" },
    ],
    tips: [
      " Pedersen 承诺是『加法同态』：$C(m_1) + C(m_2) = C(m_1 + m_2)$——可证明两笔金额之和而不揭开金额（ Confidential Transaction 核心）。",
      "r 丢了承诺就永远打不开——这是特性不是 bug（r 本质是『保密的钥匙』）。",
      "承诺阶段 m 要小于曲线阶 n；本工具 m 用数字输入。",
    ],
    aka: ["Pedersen 承诺", "pedersen commitment", "密码学承诺", "椭圆曲线承诺", "Pedersen 承诺打开", "承诺方案", "commitment scheme", "Pedersen 打开", "隐藏承诺", "绑定向量承诺", "同态承诺", "pedersen hash 承诺", "CT 承诺", "门罗承诺"],
  },
  feldmanVss: {
    what: "Feldman 可验证秘密分享（VSS）：把秘密 s 按 Shamir 思想拆成 n 份、门限 t 份恢复——且每份份额可独立验证真伪（伪造份额当场识破）。",
    principle:
      "随机多项式 $f(x) = s + a_1 x + \\cdots + a_{t-1} x^{t-1}$（mod 阶），份额 = (i, f(i))。发布系数承诺 A_j = [a_j]G（点）。\n\n" +
      "验证份额 i：检查 $[y_i]G \\stackrel{?=} A_0 + i \\cdot A_1 + i^{2} \\cdot A_2 \\cdots$（点运算）——多项式同态让伪造份额过不了这一关，而承诺不泄露 s。",
    usage: "参数填秘密 s、门限 t、份额数 n → 输出全部份额与承诺 JSON。验证模式：粘 JSON + 待验份额 (i, y) → 有效/无效。",
    examples: [
      { in: "（无需主输入）", param: "s=20260905, t=3, n=5", out: "A₀…A₂ 承诺 + 5 份份额 JSON", desc: "任意 3 份可拉格朗日插值恢复 s；每份可独立验证" },
    ],
    tips: [
      "Shamir 分享 + Feldman 承诺 = 『可验证』：拿到份额先验证再保存，防分发方耍赖。",
      "少于 t 份在信息论上对 s 零信息——比『藏起来』强得多。",
      " commitments 是点的列表（公开），shares 是标量（发给各参与方）——别把两者搞混。",
    ],
    aka: ["Feldman VSS", "feldman 可验证秘密分享", "秘密分享", "Shamir VSS", "feldman vss", "可验证秘密共享", "门限秘密分享", "secret sharing", "Feldman 承诺", "VSS 可验证", "拉格朗日秘密分享", "秘密拆分验证", "feldman 分享", "门限恢复"],
  },
  lsagSign: {
    what: "LSAG 环签名：以环中任一成员身份匿名签名——验证者确信签名来自环内，但不知道是谁；同私钥在同环的两次签名会被关联（key image）。",
    principle:
      "Liu–Wei–Wong 2004（eprint 2004/027）。签名者生成 key image $\\tilde{y} = x_\\pi \\cdot H_p(L)$，然后沿环铺一次性挑战链 $c_{i+1} = H(L, \\tilde{y}, m, s_i \\cdot G + c_i \\cdot y_i,\ s_i \\cdot h + c_i \\cdot \\tilde{y})$，假成员用随机 $s_i$，真成员用自己的私钥解一次方程闭环。\n\n" +
      "匿名性来自环内 n 选一不可区分；可链接性来自 key image——同私钥再签 ỹ 相同即暴露『同一人签了两次』。",
    usage: "参数填环公钥列表（每行 04x‖y）、自己的私钥与环中 index；主输入填消息。输出签名 JSON（含 key image）。",
    examples: [
      { in: "HENG{ring}", param: "环 3 公钥 + sk + index=1", out: "key image + c₀ + s₀…s₂ JSON", desc: "验签只知『环内某人签的』；同环同私钥再签 → key image 相同被关联" },
    ],
    tips: [
      "环签名 ≠ 多人共同签名——是『n 选一的匿名单人签名』，别和门限签名混淆。",
      "key image 的可链接性是双刃剑：防双花（Monero 用它）但也意味着同环重复签名会露馅。",
      "签名大小与环成员数线性相关——环越大越匿名但也越大。",
      "伪造者可以把任意公钥拉进环（spontaneous），验证者只管『环内某人签的』成立与否。",
    ],
    aka: ["LSAG 环签名", "环签名", "lsag", "环形签名", "LSAG 签名", "linkable ring signature", "匿名环签名", "群签名 LSAG", "Liu Wei Wong 签名", "环签名生成", "key image 签名", "可链接环签名", "ring signature", "门罗环签名"],
  },
  lsagVerify: {
    what: "LSAG 环签名验证：确认签名出自环内某个成员（匿名）、消息未被篡改；对比两次签名的 key image 可判断是否同一签者。",
    principle:
      "验证沿环重算挑战链 $c_{i+1} = H(L, \\tilde{y}, m, s_i \\cdot G + c_i \\cdot y_i,\ s_i \\cdot h + c_i \\cdot \\tilde{y})$，i=0..n-1，最后 $c_n' = c_0$ 则有效。\n\n" +
      "链的闭环只在真签名者那一步靠私钥成立——伪造者要让链闭合等价于解离散对数。",
    usage: "主输入填原消息；参数填环公钥列表与签名 JSON（lsagSign 产物）。输出有效/无效。",
    examples: [
      { in: "HENG{ring}", param: "环列表 + 签名 JSON", out: "✓ 环签名有效（匿名）", desc: "对比两次签名的 key image 字段可做链接判定" },
    ],
    tips: [
      "验证不揭示签名者——连『不是哪个成员』都无法排除。",
      "消息改一个字节、环少一个成员、签名 JSON 任何字段变动都会使链断裂。",
      "想查『是否同一人签的』：比对两次签名的 key image 字段是否相同。",
    ],
    aka: ["LSAG 验签", "环签名验证", "lsag verify", "LSAG 验证", "环签名校验", "linkable ring verify", "环形签名验证", "key image 检查", "环签名确认", "匿名签名验证", "LSAG 签名验证", "环成员验证", "ring signature verify", "可链接验证"],
  },
};
