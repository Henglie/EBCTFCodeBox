/*
 * edu-sm9-family.js — SM9 五档算法族科普卡（T397 批1：标识密码完整运算，双线性对内核）。
 * 格式契约见 eduContent.js 头注释：纯数据、无 import、无副作用。
 * aka 均 ≥10 条真实别名（_alias_verify 三件套红线）。
 */
export default {
  sm9KeyGen: {
    what: "生成 SM9 标识密码（IBC）的整套密钥：签名/加密两套主密钥对（KGC 保管）+ 按用户标识（如邮箱、手机号）派生的用户签名/加密私钥与公钥。",
    principle:
      "SM9（GB/T 38635-2020）基于 BN 曲线双线性对 e(G1,G2)→GT。KGC 先生成签名主私钥 ks 与加密主私钥 ke（[1,n-1] 随机数），主公钥 Ppub_s=[ks]g2、Ppub_e=[ke]g1。\n\n" +
      "用户私钥由标识派生：$t_1 = (H1(\\mathrm{uid} \| \\mathrm{hid}) + \\mathrm{ks})^{-1} \\cdot \\mathrm{ks} \\bmod n$，签名私钥 $d_A = [t_1] g_1$（G1 点）；加密私钥同理落在 G2。公钥就是标识本身（映射点 PA=[H1(uid‖hid)]Ppub_s+g2'）——这就是「邮箱即公钥」的标识密码：无需证书，KGC 托管私钥。",
    usage:
      "参数填用户标识 uid（默认 Alice；签名 hid=01、加密 hid=03 固定），主私钥 ks/ke 留空即随机生成（KGC 口径）；填固定值可复现官方向量。输出签名/加密两套主密钥、用户私钥（⚠ 敏感）与公钥，各档 op 按注释对接。",
    examples: [
      { in: "（无需输入，直接运行）", param: "uid=Alice，ks/ke 留空随机", out: "签名主公钥 Ppub_s（G2，129B hex）\n用户签名私钥 dA（G1，65B）\n……两套体系八件套", desc: "每次运行不同；填官方 ks=000130E7… 可复现 GB/T 38635 附录 A 向量" },
    ],
    tips: [
      "SM9 是「标识密码」：公钥=uid 字符串本身（不用传证书），私钥必须找 KGC 领——这是它和 SM2/RSA 最大的区别。",
      "签名体系主公钥在 G2（129B，04 前缀）、用户私钥在 G1（65B）；加密体系恰好反过来——别填错档。",
      "CTF 复现官方向量：ks=000130E78459D78545CB54C587E02CF480CE0B66340F319F348A1D5B1F2DC5F4、uid=Alice、hid=01。",
      "主私钥 ks/ke 泄露=整个体系沦陷（KGC 能伪造任何用户私钥），题目给 ks 基本就是要你派生指定 uid 的私钥。",
    ],
    aka: ["SM9 密钥生成", "SM9 keygen", "SM9 标识密钥", "国密 SM9 密钥", "SM9 KGC", "SM9 主密钥", "SM9 用户私钥派生", "identity-based keygen", "SM9 密钥体系", "GB/T 38635 密钥", "标识密码密钥生成", "商密 SM9 密钥", "SM9 master key", "IBC 密钥生成"],
  },
  sm9Sign: {
    what: "SM9 标识数字签名：用自己的标识私钥 dA（G1 点）对消息产出签名 (h, S)——h 是 32 字节整数，S 是 G1 曲线点（65 字节 04‖x‖y）。",
    principle:
      "先算 g=e(g1, Ppub_s)（双线性对）。签名方取随机 $r \\in [1, n-1]$，算 $w = g^{r}$（GT 元素），$h = H2(M \\| w)$，$S = [r - h] d_A$（G1 点乘）。输出 (h,S)。\n\n" +
      "每次 r 随机，同消息签名不同（语义安全）；r 重用/可预测时与 ECDSA 同病——可直接暴露私钥。",
    usage: "输入框填消息（编码可选），参数填签名主公钥 Ppub_s（G2，129B hex）、用户签名私钥 dA（G1，65B，由密钥生成档产出）、uid、hid（默认 01）。固定 r 可复现官方向量。输出 h、S 与拼接签名。",
    examples: [
      { in: "Chinese IBS standard", param: "Ppub_s=官方向量主公钥，dA=Alice 私钥，fixedR=033C86…", out: "h=823C4B21…\nS=0473BF9692…（G1 点 65B）", desc: "GB/T 38635.2 附录 A 官方签名向量" },
    ],
    tips: [
      "签名档的私钥是 G1 点（65B，04 开头）——和加密档的 G2 私钥（129B）不同，填错直接报错。",
      "复现官方向量必须固定 r：r=033C8616B06704813203DFD00965022ED15975C662337AED648835DC4B1CBE。",
      "SM9 签名无 04 长前缀魔数（h 在前、S 在后）——CTF 里认「32B 整数 + 65B 04 开头点」的结构。",
      "h=H2(M‖w) 把消息和双线性对结果绑在一起，改一个字节验签即失败。",
    ],
    aka: ["SM9 签名", "SM9 sign", "国密 SM9 签名", "SM9 标识签名", "SM9 数字签名", "GB/T 38635.2 签名", "SM9 IBS", "identity-based signature", "标识签名", "SM9 h S 签名", "商密 SM9 签名", "SM9 signature", "国密 9 签名", "SM9 双线性对签名"],
  },
  sm9Verify: {
    what: "SM9 标识验签：只需签名主公钥 + 签名人标识 uid（无需对方公钥证书），验证 (h,S) 是否对应该消息。",
    principle:
      "验方算 g=e(g1,Ppub_s)，用标识派生公钥点 PA=[H1(uid‖hid)]Ppub_s+[ks 修正项]，再算 $t = g^{h}$、$w' = e(S, P_A) \\cdot t$，最后检查 $h \\stackrel{?}{=} H2(M \| w')$。双线性对的性质保证只有持 dA 的签名方能让等式成立。\n\n" +
      "标识密码优势在这：验签方拿 uid 就能验，不用先安全地拿到对方公钥。",
    usage: "输入框填原始消息（编码与签名时一致），参数填签名主公钥 Ppub_s、签名人 uid、hid（默认 01）、签名 h（32B hex）与 S（65B hex）。输出有效/无效。",
    examples: [
      { in: "Chinese IBS standard", param: "Ppub_s + uid=Alice + 官方 h/S", out: "验签结果：有效 ✓", desc: "消息、uid、h、S 任何一项被改都会变无效" },
    ],
    tips: [
      "验签不需要用户任何私钥/公钥点——uid 字符串本身就是「公钥」，这是 SM9 与 SM2 验签最大的体验差异。",
      "验不过排查顺序：消息编码 → uid 是否与签名时完全一致 → hid（01）→ h/S 有没有截断。",
      "篡改检测：改消息一个字节、或换一个 uid，H2 重算必不等于 h——双线性对把三者死锁在一起。",
    ],
    aka: ["SM9 验签", "SM9 verify", "国密 SM9 验签", "SM9 签名验证", "SM9 标识验签", "GB/T 38635.2 验签", "SM9 verify signature", "identity-based verify", "标识验签", "SM9 签名校验", "商密 SM9 验签", "国密 9 验签", "SM9 双线性验签"],
  },
  sm9Encrypt: {
    what: "SM9 标识加密：只知道收件人的标识（邮箱/手机号）和系统加密主公钥，就能把明文加密成 C1‖C3‖C2 三段式密文——无需对方证书或公钥点。",
    principle:
      "随机 r∈[1,n-1]；用户加密公钥点 QB=[H1(uid‖hid)]Ppub_e+g1'（由标识当场算出）。C1=[r]QB（64 字节 x‖y，不带 04 前缀）；$w = e(P_{\\mathrm{pub\_e}}, g_2)^{r}$（双线性对）；KDF(C1‖w‖uid) 派生密钥流：前段异或明文得 C2，后段 32 字节作 K2，C3=SM3(C2‖K2)（32 字节校验）。\n\n" +
      "同明文每次密文不同（随机 r）；只有持有对应 uid 私钥 dB 的收件人才能从 C1 重建 w 并解开。",
    usage: "输入框填明文（编码可选），参数填加密主公钥 Ppub_e（G1，65B hex）、收件人 uid（默认 Bob）、hid（默认 03）。固定 r 可复现官方向量。输出 hex（默认）或所选编码的 C1‖C3‖C2。",
    examples: [
      { in: "Chinese IBE standard", param: "Ppub_e=官方主公钥，uid=Bob，hid=03，fixedR=官方 r", out: "C1(64B)‖C3(32B)‖C2 的 hex 密文", desc: "GB/T 38635.4 附录 A 官方加密向量" },
    ],
    tips: [
      "SM9 密文结构 C1‖C3‖C2：C1 是 64 字节裸 x‖y（没有 SM2 那样的 04 前缀！），C3 固定 32 字节 SM3 校验，C2 与明文等长。",
      "「加密不用证书」是最大卖点：任何人在任何地方，拿 uid + 系统参数即可加密给对方。",
      "C3=SM3(C2‖K2)（gmsm/GmSSL 口径）——解密时先校验 C3 再出明文，防密文篡改。",
      "CTF 里题面给「收件人手机号/邮箱 + KGC 公钥」让你加密的，就是 SM9 标识加密无疑。",
    ],
    aka: ["SM9 加密", "SM9 encrypt", "国密 SM9 加密", "SM9 标识加密", "SM9 IBE", "identity-based encryption", "标识加密", "GB/T 38635.4 加密", "SM9 公钥加密", "SM9 C1C3C2", "商密 SM9 加密", "国密 9 加密", "SM9 双线性对加密", "邮箱即公钥加密"],
  },
  sm9Decrypt: {
    what: "SM9 标识解密：用收件人的加密私钥 dB（G2 点，KGC 派发）把 C1‖C3‖C2 密文还原成明文，并自动校验 C3 完整性。",
    principle:
      "解密方算 $w' = e(C1, d_B)$（双线性对——由 dA 派生关系保证 $w' = w = g^{r}$），KDF(C1‖w'‖uid) 重派密钥流：异或 C2 得明文，重算 C3' = SM3(C2‖K2) 比对 C3。对不上（篡改/错 uid/错私钥）直接报错。\n\n" +
      "私钥 $d_B = [(H1(\\mathrm{uid} \| \\mathrm{hid}) + \\mathrm{ke})^{-1} \\cdot \\mathrm{ke}] g_2$ 与 uid 一一绑定——uid 不对，e(C1,dB) 就不是正确的 w，KDF 输出全错。",
    usage: "输入框填密文（默认 hex，兼容 base64 等），参数填用户加密私钥 dB（G2，129B，04 前缀或 128B 裸）、加密时所用 uid（默认 Bob）。输出 utf8 明文。",
    examples: [
      { in: "C1‖C3‖C2 密文 hex", param: "dB=Bob 的 G2 私钥（129B），uid=Bob", out: "Chinese IBE standard", desc: "C3 校验通过才输出明文" },
    ],
    tips: [
      "解密档的私钥是 G2 点（129B）——比签名档的 G1 私钥（65B）长一倍，结构上先区分。",
      "「C3 校验失败」三大原因：uid 与加密时不一致 / 私钥不是这个 uid 的 / 密文被截断（C1 必须 64B + C3 32B + C2 明文长）。",
      "CTF 套路：给 KGC 主私钥 ke + 目标 uid，先在密钥生成档派生 dB 再来解密——SM9 私钥是算出来的不是猜的。",
      "错 uid 解密不会报「uid 错」而是 C3 校验失败——这是标识绑定的天然防错机制。",
    ],
    aka: ["SM9 解密", "SM9 decrypt", "国密 SM9 解密", "SM9 标识解密", "SM9 密文解密", "GB/T 38635.4 解密", "SM9 IBE 解密", "identity-based decryption", "标识解密", "商密 SM9 解密", "国密 9 解密", "SM9 C3 校验", "SM9 私钥解密"],
  },
};
