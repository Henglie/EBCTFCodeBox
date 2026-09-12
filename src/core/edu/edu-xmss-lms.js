/*
 * edu-xmss-lms.js — XMSS / LMS·HSS（基于状态的哈希签名）科普卡（T398 批A）。
 * 格式契约见 eduContent.js 头注释：纯数据、无 import、无副作用。
 * aka 均 ≥10 条真实别名。
 */
export default {
  xmssKeyGen: {
    what: "生成 XMSS（RFC 8391，eXtended Merkle Signature Scheme）密钥对：一个 1024 叶子的 Merkle 树（XMSS-SHA2_10_256），公钥只有 64 字节（root‖PUB_SEED），私钥本质上是 3 个 32 字节种子。",
    principle:
      "XMSS = WOTS+ 一次性签名 + Merkle 树。每个叶子是一副 WOTS+ 密钥：SK_i = SHA256(toByte(4,32)‖SK_SEED‖PUB_SEED‖ADRS) 展开 67 条链，每条链迭代 15 次 F(链式哈希+位掩码)，全部链尾再压进一棵不平衡的 L-tree 得到叶子。\n\n" +
      "1024 个叶子两两用 RAND_HASH（H 函数 + PRF 生成的密钥/位掩码）向上合并，树根就是公钥 root。PUB_SEED 公开但必须随机——它给每一次哈希调用生成不同密钥和位掩码，让哈希调用之间互相独立。",
    usage:
      "三个参数都可留空随机生成；要复现官方 KAT 向量就填参考实现的固定种子：SK_SEED=06155023…、SK_PRF=056A8C26…、PUB_SEED=04562AD3…。输出 root、pk（64B，也可带 OID 成 68B）与三个种子。树建房约百万次哈希，数秒。",
    examples: [
      { in: "（无需输入，直接运行）", param: "填 KAT 三种子", out: "root = B901B8D9332FE458…BB6DB84\npk  = B901B8D9…‖04562AD3…", desc: "与官方参考实现 KAT 逐字节一致" },
    ],
    tips: [
      "XMSS 私钥小巧（3×32B 种子），但每个 keypair 只能签 $2^{h} = 1024$ 条消息——树高 h 换签名的数量。",
      "SK_SEED 和 PUB_SEED 千万别填反：SK_SEED 派生 WOTS 私钥（机密），PUB_SEED 只派生掩码（公开）。",
      "CTF 复现向量直接抄 placeholder 里的 KAT 种子，root 应为 B901B8D9332FE458…。",
      "公钥两种口径都认：64B 裸 root‖PUB_SEED 或 68B 带算法 OID 0x00000001 前缀。",
    ],
    aka: ["XMSS 密钥生成", "XMSS keygen", "RFC 8391 密钥", "XMSS-SHA2_10_256 密钥", "XMSS Merkle 树生成", "基于哈希的签名密钥", "hash-based signature keygen", "XMSS 公钥生成", "WOTS+ 树密钥", "后量子签名密钥 XMSS", "XMSS root 计算", "有状态签名密钥", "XMSS key pair", "状态哈希签名密钥"],
  },
  xmssSign: {
    what: "用 XMSS 私钥对消息签名：签名 2500 字节 = 4 字节 index ‖ 32 字节随机数 r ‖ 2144 字节 WOTS+ 签名 ‖ 320 字节认证路径。",
    principle:
      "三步：① r = PRF(SK_PRF, toByte(idx,32))——由 index 确定性导出；② M' = H_msg(r‖root‖toByte(idx,32)‖M)——随机化哈希把消息、index、root 死锁在一起；③ 用第 idx 个 WOTS+ 密钥签 M'（67 条链各走 checksum 加权的步数），附上从叶子到树根的 10 个兄弟节点（认证路径）。\n\n" +
      "验证方从 WOTS+ 签名「恢复」出公钥候选，经 L-tree 得叶子，再沿认证路径重算到根比对公钥——验签不需要私钥。",
    usage:
      "输入框填消息（text/hex），参数填四个 32B 种子/根（密钥生成档输出）、签名 index（0..1023）。CTF 复现：官方 KAT 消息 33 字节 + index=0，签名应逐字节等于 KAT 的 sm。",
    examples: [
      { in: "（33 字节 KAT 消息，hex 模式填入）", param: "KAT 种子 + root，idx=0", out: "Sig = 00000000‖404DFF9B…‖(WOTS+ 2144B)‖(auth 320B)，与官方 KAT 逐字节一致", desc: "r 也是确定性导出的，可单独对拍 404DFF9B9F3931FE…" },
    ],
    tips: [
      "⚠ 铁律：同一个 index 绝对不能签两条消息——WOTS+ 是一次性签名，重用=私钥泄露（攻击者可合成第三条消息的合法签名）。",
      "真实系统必须把 index 持久化到磁盘再输出签名（RFC 8391 明确要求先更新 state 后发签名）。",
      "签名的 4 字节前缀就是 index——CTF 里看到 00000000 开头的 2500B blob 大概率就是 XMSS-SHA2_10_256 签名。",
      "index 由签名自带，验签方从签名里读——伪造者改 index 会导致 H_msg 重算不一致而验签失败。",
    ],
    aka: ["XMSS 签名", "XMSS sign", "RFC 8391 签名", "XMSS-SHA2_10_256 签名", "WOTS+ 签名", "Merkle 树签名", "哈希签名", "hash-based signature", "后量子签名 XMSS", "有状态签名", "stateful hash signature", "XMSS 一次性签名树", "XMSS authentication path", "L-tree 签名"],
  },
  xmssVerify: {
    what: "验证 XMSS 签名：只需 64 字节公钥 + 消息 + 签名，从签名恢复 WOTS+ 公钥、爬认证路径重算树根，与公钥 root 比对。",
    principle:
      "验签流程：① 从签名头部读 index，重算 M' = H_msg(r‖root‖idx‖M)；② WOTS_pkFromSig：把 67 个签名元素沿哈希链「补完」剩余步数得到公钥候选（checksum 保证链只能前进不能后退，篡改必被卡住）；③ L-tree 压成叶子；④ 叶子 + 认证路径逐层 RAND_HASH 到根。任何一步被动过手脚，根就对不上。\n\n" +
      "注意 XMSS 验签无法检测「index 重用」——这是签名方 state 管理的责任，验签只管单条签名的数学有效性。",
    usage:
      "输入框填消息（与签名时编码一致），参数填 pk（64B 或 68B 带 OID）与签名 hex（2500B）。长度不符或 index≥1024 直接判非法。",
    examples: [
      { in: "KAT 消息 + KAT 签名", param: "pk=B901B8D9…‖04562AD3…", out: "✓ 合法（WOTS+ → L-tree → Merkle 路径全部通过）", desc: "消息改 1 字节、签名改任意 1 字节都会变 ✗" },
    ],
    tips: [
      "验签快（约 1150 次哈希）而签名生成要重建大半棵树——这是 XMSS 小私钥方案的代价结构。",
      "验签通过 ≠ 安全：如果同一 index 的两条不同签名都流传，整棵树作废，CTF 题目常考这一点。",
      "排查验签失败：先查消息编码（text/hex 弄反必挂），再查 pk 是否多了/少了 OID 前缀。",
      "2500B 是 XMSS-SHA2_10_256 的标志尺寸；签名长度不对说明参数集认错了。",
    ],
    aka: ["XMSS 验签", "XMSS verify", "RFC 8391 验证", "XMSS 签名校验", "WOTS+ 验签", "Merkle 树验证", "哈希签名验证", "hash-based verify", "后量子验签", "XMSS root 重算", "认证路径验证", "XMSS signature verification", "有状态签名验证", "XMSS pkFromSig"],
  },
  lmsSign: {
    what: "LMS（RFC 8554，Leighton-Micali Signature）单级或 HSS 两级签名：LM-OTS 哈希链 + Merkle 树（LMS），多棵树层级相叠（HSS）实现海量签名。",
    principle:
      "LM-OTS：私钥元素 x[i]=H(I‖q‖i‖0xff‖SEED)（Appendix A 伪随机派生，只需记 32B SEED+16B I），对消息哈希 Q 的每个 w 位系数走对应步数的哈希链，Cksm 校验和防「只进不退」篡改。LMS 树：32 个 LM-OTS 公钥经 D_LEAF(0x8282)/D_INTR(0x8383) 域分隔哈希建树。\n\n" +
      "HSS：顶层树签「底层树的公钥」，底层树才签消息——密钥生成时间从 $2^{(h1+h2)}$ 降到 $2^{h1} + 2^{h2}$，这是它相对单棵大树的核心优势。",
    usage:
      "选模式（单级/两级）、各级参数集（h=5/10，w=4/8，RFC 允许两级不同，官方向量 TC2 就是顶层 H10/W4 + 底层 H5/W8）、各级 SEED/I/index/随机数 C。全固定即可逐字节复现 RFC 8554 Appendix F 的 Test Case 2 签名。",
    examples: [
      { in: "The enumeration in the Constitution…（TC2 消息）", param: "TC2 私钥种子：顶层 558b8966…/d08fabd4…，底层 a1c4696e…/215f83b7…，顶层 q=3，底层 q=4，C 取官方", out: "HSS 公钥 60B（levels=2，I=d08fabd4…，K=32a58885…）与 3860B 签名，与 RFC 官方逐字节一致", desc: "RFC 8554 Appendix F Test Case 2" },
    ],
    tips: [
      "LMS 签名自描述：开头 4 字节 q，后面 LMOTS typecode 决定签名长度——CTF 里可直接按 typecode 解析结构。",
      "w=8 签名短（p=34）但链长 255；w=4 签名长（p=67）但链短一半——空间换时间。",
      "D_MESG=0x8181、D_PBLC=0x8080、D_LEAF=0x8282、D_INTR=0x8383 四个域分隔符是 LMS 的身份证，实现错一个全盘皆输。",
      "HSS 的 Nspk 字段=级数-1；L=1 时 HSS 签名就是 u32str(0)‖LMS 签名。",
      "⚠ 和 XMSS 一样：q 是一次性资源，重用=私钥泄露。",
    ],
    aka: ["LMS 签名", "HSS 签名", "RFC 8554 签名", "LMS sign", "HSS hierarchical signature", "LM-OTS 签名", "Leighton-Micali 签名", "LMS 哈希签名", "hash-based signature LMS", "后量子签名 LMS", "多级 Merkle 签名", "LMS Merkle 树签名", "LMOTS Winternitz 签名", "有状态哈希签名", "NIST SP 800-208 LMS"],
  },
  lmsVerify: {
    what: "LMS/HSS 验签：从签名恢复 LM-OTS 公钥候选 Kc，经 D_LEAF/认证路径重算树根与公钥 K 比对；HSS 多级则逐层先验「被签的子公钥」再验消息。",
    principle:
      "单级：Kc = 哈希链补完（每元素从签名值走 $2^{w} - 1 - a_i$ 步）→ 域分隔哈希得到候选根 → 比对。多级：HSS 签名 = Nspk ‖ (签名_i‖子公钥_i)… ‖ 消息签名——验证链条像证书链：顶层公钥验下一级公钥，最后一级验消息，任何一环被换都断链。\n\n" +
      "签名自描述解析（typecode 内嵌），不需要额外传参数集。",
    usage:
      "输入框填消息，参数填公钥（HSS 60B=levels‖LMS type‖LMOTS type‖I‖K；LMS 单级 56B）与签名 hex。格式选 HSS（含 L=1）或 LMS 单级。可直接粘贴 RFC 8554 Test Case 1/2 的公钥+签名验证。",
    examples: [
      { in: "The powers not delegated to the United States…（TC1 消息）", param: "TC1 HSS 公钥 60B + 官方 2644B 签名，格式=HSS", out: "✓ 合法（候选根节点与公钥一致）", desc: "RFC 8554 Appendix F Test Case 1 逐字节输入" },
    ],
    tips: [
      "验签成本低（约一半哈希链长度/元素），HSS 三层验签也只是三倍——适合 IoT/固件签名场景（微软、Google 都在用）。",
      "验签失败排查顺序：typecode 是否被截断 → 公钥/签名字节长度 → 消息编码一致性。",
      "「候选根节点不符」但公钥没被改过？查消息是不是差了一个字节、或 C/y 元素被调换顺序。",
      "LMS 验签同样检测不出 index 重用——两个不同消息的签名共用一个 q 即为致命信号。",
    ],
    aka: ["LMS 验签", "HSS 验签", "RFC 8554 验证", "LMS verify", "LM-OTS 验证", "Leighton-Micali 验签", "LMS 签名校验", "hash-based verify LMS", "后量子验签 LMS", "HSS 证书链验证", "Merkle 树验证 LMS", "LMS signature verification", "多级哈希签名验证", "SP 800-208 验签"],
  },
};
