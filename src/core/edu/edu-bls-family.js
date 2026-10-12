/*
 * edu-bls-family.js — BLS 签名族科普卡。
 * aka 均 ≥10 条真实别名。构造对齐 IETF draft-irtf-cfrg-bls-signature：
 * 曲线 BLS12-381 + RFC 9380 hash-to-curve，ciphersuite
 * BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_（pk∈G1 48B / σ∈G2 96B，与 ETH2 相同套）。
 */
export default {
  blsKeyGen: {
    what: "生成 BLS 签名密钥对：私钥 sk 是一个随机标量，公钥 pk = [sk]G1（48 字节压缩曲线点，无需证书即可公开，与 ETH2 同一套）。",
    principle:
      "BLS（Boneh–Lynn–Shacham 2001）是双线性对签名。本工具按 IETF draft-irtf-cfrg-bls-signature 对齐：曲线 BLS12-381，公钥 $pk = [sk]G_1$（48 字节压缩 G1）。\n\n" +
      "私钥是 32 字节标量（留空随机，填固定值可复现）。\n\n" +
      "曲线/配对/hash-to-curve 实现取自 @noble/curves 2.4.0（作者 Paul Miller，MIT License © 2022 Paul Miller）。来源：https://github.com/paulmillr/noble-curves 与 https://www.npmjs.com/package/@noble/curves（tarball SHA256 55279c71b0201d6c0e58d0206d15825359e02a3932f326ba7b7909ac2d334aa9）；其唯一运行时依赖 @noble/hashes 2.4.0（MIT，同作者；tarball SHA256 e1946149b780017b2564fcc092cb01c04e1d7f20627d0296c17da8868f4436dc）。两库内联于本项目源码 src/core/lib/noble/（许可文本随目录保留）。访问日期：2026-10-08。审计：Trail of Bits 2026-08（全量）、Cure53 2024-09（覆盖 bls12-381 与 hash-to-curve）。",
    usage: "参数填固定 sk（hex 32B）可复现，留空随机。输出 sk（hex 32B，⚠ 保密）与 pk（48 字节压缩 G1，96 个 hex 字符）。",
    examples: [
      { in: "（无需输入，直接运行）", param: "sk 留空随机", out: "sk: 9f3a…\npk: b2e4…（48B 压缩 G1，96 个 hex 字符）", desc: "sk 喂给 BLS 签名档，pk 公开给验签方" },
    ],
    tips: [
      "公钥 48B / 签名 96B——minimal-pubkey-size 口径（与 ETH2 相同），签名短是它进 ETH2 的核心原因。",
      "sk 是纯标量（32B hex），不是点——别把 pk 当 sk 填。",
      "旧版本（≤v0.1.8）生成的密钥与本版不兼容：曲线与编码格式已变更，无法互验。",
    ],
    aka: ["BLS 密钥生成", "BLS keygen", "BLS 密钥对", "BLS 公钥生成", "bls 密钥", "BLS 私钥", "双线性对签名密钥", "BLS12 密钥", "BLS signature key", "聚合签名密钥", "BLS 生成", "Boneh Lynn Shacham 密钥", "BLS bls12-381", "门限签名密钥"],
  },
  blsSign: {
    what: "BLS 签名：$\\sigma = [\\mathrm{sk}] \\cdot H(m)$，H 为 RFC 9380 hash-to-curve（恒定时间）——输出 96 字节压缩 G2 点；同 sk 同消息必同签名（确定性）。",
    principle:
      "消息经 RFC 9380 hash-to-curve 映射为 G2 点（ciphersuite $\\mathsf{BLS\\_SIG\\_BLS12381G2\\_XMD\\!:\\!SHA\\text{-}256\\_SSWU\\_RO\\_}$，恒定时间），签名 $\\sigma = [\\mathrm{sk}] \\cdot H(m)$（96 字节压缩 G2）。\n\n" +
      "验证：$e(\\sigma, G_1) = e(H(m), \\mathrm{pk})$。hash-to-curve 的映射点离散对数不可知——旧版「消息哈希成公开标量再乘基点」的映射可被跨消息伪造，标准构造下此类伪造全部失效。",
    usage: "主输入填消息，参数填 sk（BLS 密钥生成输出，hex 32B）。输出 96 字节压缩 G2 签名（192 个 hex 字符）。",
    examples: [
      { in: "HENG{bls-test}", param: "sk=BLS 密钥生成输出", out: "σ: a1…（96B 压缩 G2，192 个 hex 字符）", desc: "同 sk 对同消息签名确定（非随机化签名）" },
    ],
    tips: [
      "BLS 签名是确定性签名——同消息同 sk 每次签名结果相同（这也是它可聚合的基础）。",
      "n 个签名的聚合 = 签名点直接相加，验证一次配对搞定——这是 ECDSA 做不到的。",
      "同一条消息出现两次的聚合会被显式拒绝（basic 方案的 rogue-key 防护，见聚合验签）。",
      "$[\\mathrm{sk}] \\cdot H(m)$ 的顺序在加法群里就是标量乘——别写成 $H([\\mathrm{sk}] \\cdot m)$。",
    ],
    aka: ["BLS 签名", "BLS sign", "BLS 数字签名", "双线性对签名", "bls 签名算法", "BLS 签名 96 字节", "BLS signature", "聚合签名", "BLS 聚合", "Boneh Lynn Shacham 签名", "BLS12 签名", "短签名", "BLS 短签名", "ETH2 签名算法"],
  },
  blsVerify: {
    what: "BLS 验签：公钥与签名各一个点，一次双线性配对 $e(\\sigma, G_1) \\stackrel{?}{=} e(H(m), \\mathrm{pk})$ 即完成验证；含 KeyValidate（非无穷远 + 子群校验）。",
    principle:
      "验方算两个配对并比对：$e(\\sigma, G_1)$ 与 $e(H(m), \\mathrm{pk})$。BLS 的核心恒等式保证持正确 sk 的签名让两者相等；消息/公钥/签名任一被改即不等。\n\n" +
      "公钥先过 KeyValidate：非无穷远点、属于正确子群——非子群公钥直接拒绝（旧版不校验子群可被恶意公钥伪造，此为修复点）。聚合验签把 n 组的配对积合成一次：$\\prod e(\\sigma_i, G_1) \\stackrel{?}{=} \\prod e(H(m_i), \\mathrm{pk}_i)$——以太坊验证千笔投票就靠它。",
    usage: "主输入填原消息；参数填 pk（48 字节压缩 G1，96 个 hex 字符）与 σ（96 字节压缩 G2，192 个 hex 字符）。输出有效/无效。聚合验签 op 支持多组一次性验证。",
    examples: [
      { in: "HENG{bls-test}", param: "pk + σ", out: "✓ 验签通过", desc: "改消息一个字节立即变 ✗" },
    ],
    tips: [
      "验签只需要 pk 和签名——不需要证书（公钥即身份的又一种形态）。",
      "聚合验签时 n 组合成一次配对，验 n 个签名的成本≈1 个——区块验证的效率密码。",
      "验签失败先查：消息编码是否与签名时一致（UTF-8）、pk/sig 是否多空格换行、pk/σ 是否用了旧版本的 129B/65B 格式。",
    ],
    aka: ["BLS 验签", "BLS verify", "BLS 签名验证", "双线性对验签", "BLS 聚合验签", "bls 验证", "BLS verify signature", "聚合签名验证", "BLS 配对验证", "BLS 聚合验证", "Boneh Lynn Shacham 验签", "BLS12 验签", "短签名验证", "ETH2 验签"],
  },
  blsAggVerify: {
    what: "BLS 聚合验签（basic 方案）：n 组 (pk, 消息, 签名) 聚合成一次配对检查——验 n 个签名的成本 ≈ 验 1 个。",
    principle:
      "聚合 = 签名点相加：$\\sigma_{\\mathrm{agg}} = \\sigma_1 + \\sigma_2 + \\cdots + \\sigma_n$。验证检查 $\\prod e(\\sigma_i, G_1) \\stackrel{?}{=} \\prod e(H(m_i), \\mathrm{pk}_i)$——双线性把每个签名项分到自己的公钥上，任何人伪造一项都会让乘积失衡。\n\n" +
      "basic 方案的 rogue-key 防护 = 消息两两互异：同一条消息出现两次会被显式拒绝；逐组 KeyValidate 拦截无穷远/非子群公钥。",
    usage: "主输入每行一组：pk_hex 空格 签名_hex；参数框逐行填对应消息（行数一致，须两两互异）。输出聚合验签通过/失败。",
    examples: [
      { in: "pk1 sig1（每行一组，共 2 行）", param: "msgs=消息1\n消息2", out: "✓ 聚合验签通过（2 组签名聚合，一次配对检查）", desc: "任一组的消息/签名/公钥不匹配都会整体失败" },
    ],
    tips: [
      "这是 BLS 的招牌能力：以太坊每区块上千个投票签名就靠『一次配对验全部』——ECDSA 完全做不到。",
      "basic 方案不含 PoP（证明拥有私钥）：要聚合「不可信公钥 + 相同消息」的场景需要 PoP 档，本工具按 basic 口径显式拒绝重复消息。",
      "一组失败则整批失败——审计时逐组二分定位坏签名即可。",
    ],
    aka: ["BLS 聚合验签", "BLS 聚合验证", "聚合签名验证", "bls aggregate verify", "BLS 批量验签", "签名聚合", "聚合签名", "BLS 一次验证多个", "boneh 聚合", "BLS batch verify", "多签名聚合验证", "签名压缩验证", "BLS agg", "eth2 聚合验签"],
  },
};
