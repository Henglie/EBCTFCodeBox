/*
 * edu-bls-family.js — BLS 签名三档科普卡（T398 批C）。
 * aka 均 ≥10 条真实别名。构造为 Boneh–Lynn–Shacham 2001 原始定义（曲线无关），
 * 本工具跑在项目 BN254/SM9 曲线（教学口径，非 BLS12-381，与 ETH2 不互通）。
 */
export default {
  blsKeyGen: {
    what: "生成 BLS 签名密钥对：私钥 sk 是一个随机数，公钥 pk = [sk]G2（曲线点，无需证书即可公开）。",
    principle:
      "BLS（Boneh–Lynn–Shacham 2001）是双线性对签名：pk = [sk]G2。本工具构造跑在项目 BN254/SM9 曲线上（教学口径，非 BLS12-381，与 ETH2 不互通）。\n\n" +
      "私钥就是一个 32B 大整数，公钥是 G2 上的点（129B）——最短的公钥/签名格式之一。",
    usage: "参数填固定 sk 可复现，留空随机。输出 sk（hex 32B，⚠ 保密）与 pk（129B hex）。",
    examples: [
      { in: "（无需输入，直接运行）", param: "sk 留空随机", out: "sk: 9f3a…\npk: 0497c3…（G2 点）", desc: "sk 喂给 BLS 签名档，pk 公开给验签方" },
    ],
    tips: [
      "BLS 公钥 129B、签名 65B——比 ECDSA 短一半，是它进 ETH2 的核心原因。",
      "sk 是纯标量（32B hex），不是点——别把 pk 当 sk 填。",
      "本实现跑在 SM9 BN 曲线（教学口径）；校验 BLS12-381 的签名请用对应标准工具。",
    ],
    aka: ["BLS 密钥生成", "BLS keygen", "BLS 密钥对", "BLS 公钥生成", "bls 密钥", "BLS 私钥", "双线性对签名密钥", "BLS12 密钥", "BLS signature key", "聚合签名密钥", "BLS 生成", "Boneh Lynn Shacham 密钥", "BLS bls12-381", "门限签名密钥"],
  },
  blsSign: {
    what: "BLS 签名：$\sigma = [\\mathrm{sk} \\cdot H(m)] G_1$，一个 65 字节曲线点——同构消息聚合后只需一次配对验证全部。",
    principle:
      "H(m) 是把消息哈希映射到 G1 的点（本工具用 SM9 H1 派生标量再点乘，域分隔 0x42）。签名 $[\\mathrm{sk} \cdot H(m)] G_1$。\n\n" +
      "验证：$e(\\sigma, G_2) = e(H(m), \\mathrm{pk})$。双线性让 $e([[\\mathrm{sk} \cdot X]], G_2)$ = $e(X, [\\mathrm{sk}] G_2)$ 自动成立——没有 sk 就凑不出这个等式。",
    usage: "主输入填消息，参数填 sk（密钥生成输出）。输出 65B 签名（hex）。",
    examples: [
      { in: "HENG{bls-test}", param: "sk=BLS 密钥生成输出", out: "σ: 0486…（65B G1 点）", desc: "同 sk 对同消息签名确定（非随机化签名）" },
    ],
    tips: [
      "BLS 签名是确定性签名——同消息同 sk 每次签名结果相同（这也是它可聚合的基础）。",
      "n 个签名的聚合 = 签名点直接相加，验证一次配对搞定——这是 ECDSA 做不到的。",
      "⚠ rogue key 攻击：聚合时公钥需证明拥有（PoP）或走消息内绑定，别裸聚合不可信公钥。",
      "$\\mathrm{sk} \\cdot H(m)$ 的顺序在加法群里就是标量乘——别写成 $H(\\mathrm{sk} \\cdot m)$。",
    ],
    aka: ["BLS 签名", "BLS sign", "BLS 数字签名", "双线性对签名", "bls 签名算法", "BLS 签名 65 字节", "BLS signature", "聚合签名", "BLS 聚合", "Boneh Lynn Shacham 签名", "BLS12 签名", "短签名", "BLS 短签名", "ETH2 签名算法"],
  },
  blsVerify: {
    what: "BLS 验签：只需公钥与签名各一个点，一次双线性配对 e(σ,G2) ?= e(H(m),pk) 即完成验证。",
    principle:
      "验方算两个配对：$e(\sigma, G_2)$ 生成元）与 $e(H(m) \\cdot G_1,\ \\mathrm{pk})$。BLS 的核心恒等式保证持正确 sk 的签名让两者相等；消息/公钥/签名任一被改即不等。\n\n" +
      "聚合验签（Boneh 原始口径）把 n 组的配对积合成一次：Πe(σᵢ,G2) ?= Πe(H(mᵢ),pkᵢ)——以太坊验证千笔投票就靠它。",
    usage: "主输入填原消息，参数填 pk（129B）与 σ（65B）。输出有效/无效。聚合验签 op 支持多组一次性验证。",
    examples: [
      { in: "HENG{bls-test}", param: "pk + σ", out: "✓ 验签通过", desc: "改消息一个字节立即变 ✗" },
    ],
    tips: [
      "验签只需要 pk 和签名——不需要证书（公钥即身份的又一种形态）。",
      "聚合验签时 n 组合成一次配对，验 n 个签名的成本≈1 个——区块验证的效率密码。",
      "验签失败先查：消息编码是否与签名时一致（UTF-8）、pk/sig 是否多空格换行。",
    ],
    aka: ["BLS 验签", "BLS verify", "BLS 签名验证", "双线性对验签", "BLS 聚合验签", "bls 验证", "BLS verify signature", "聚合签名验证", "BLS 配对验证", "BLS 聚合验证", "Boneh Lynn Shacham 验签", "BLS12 验签", "短签名验证", "ETH2 验签"],
  },
  blsAggVerify: {
    what: "BLS 聚合验签：把 n 个不同签名者的签名『压缩』成一个，再通过一次双线性配对检查验证全部——验 n 个签名的成本 ≈ 验 1 个。",
    principle:
      "Boneh 原始聚合：$\sigma_{\\mathrm{agg}} = \sigma_1 + \sigma_2 + \\cdots + \sigma_n$（G1 点加）。验证检查 $\\prod e(\sigma_i, G_2) \\stackrel{?}{=} \\prod e(H(m_i), \\mathrm{pk}_i)$——双线性把每个签名项分到自己的公钥上，任何人伪造一项都会让乘积失衡。\n\n" +
      "注意 rogue key 攻击：聚合不可信公钥时需 PoP（证明拥有私钥）或域内绑定，否则攻击者可构造恶意 pk 冒充他人聚合签名。",
    usage: "主输入每行一组：pk_hex 空格 签名_hex；参数框逐行填对应消息（行数一致）。输出聚合验签通过/失败。",
    examples: [
      { in: "pk1 sig1（每行一组，共 2 行）", param: "msgs=消息1\n消息2", out: "✓ 聚合验签通过（2 组签名聚合，一次配对检查）", desc: "任一组的消息/签名/公钥不匹配都会整体失败" },
    ],
    tips: [
      "这是 BLS 的招牌能力：以太坊每区块上千个投票签名就靠『一次配对验全部』——ECDSA 完全做不到。",
      "聚合前必须做 rogue key 防护（PoP 或 pk 参与哈希），否则恶意公钥可伪造他人签名。",
      "一组失败则整批失败——审计时逐组二分定位坏签名即可。",
    ],
    aka: ["BLS 聚合验签", "BLS 聚合验证", "聚合签名验证", "bls aggregate verify", "BLS 批量验签", "签名聚合", "聚合签名", "BLS 一次验证多个", "boneh 聚合", "BLS batch verify", "多签名聚合验证", "签名压缩验证", "BLS agg", "eth2 聚合验签"],
  },
};
