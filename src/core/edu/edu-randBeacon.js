/*
 * edu-randBeacon.js — 公开随机信标验证（drand / NIST）科普分片。
 *
 * 对账基准：op 实际参数面 provider/action/pubkey/prev/endpoint/round/allowNetwork，
 * 离线验证（粘贴 JSON）+ 显式联网拉取两动作；examples 用官方真实数据（drand 主网 round 100）。
 */
export default {
  randBeacon: {
    what: "公开随机信标验证：把 drand / NIST 公开随机信标发布的一条记录粘进来，用其官方签名（BLS12-381 / RSA）与哈希链离线复算，证明这条随机值确由信标发布、发布后未被篡改。信标是全球可复算的「公开抽签机」——本工具让任何人都能离线完成这份证明。",
    principle:
      "信标的价值不是「更随机」，而是「可公开验证、事后不可篡改」：\n\n" +
      "- drand（league of entropy）：每轮签名 $\\sigma$ 是对 $\\mathrm{SHA\\text{-}256}(\\text{上一轮签名} \\parallel \\text{轮号})$ 的 BLS12-381 签名（阈值门限集体签发），随机值 $= \\mathrm{SHA\\text{-}256}(\\sigma)$；上一轮签名被铸进下一轮消息，逐轮成链——改任一历史轮，其后所有轮全部失配。\n" +
      "- NIST Randomness Beacon 2.0：每个脉冲对逐字段序列化（长度前缀）的输入做 RSA-PKCS#1 v1.5 / SHA-512 签名（RSA-4096），输出值 $= \\mathrm{SHA\\text{-}512}(\\text{签名输入} \\parallel \\text{签名})$；上一脉冲输出值挂在下一脉冲字段里，同样逐脉冲成链。\n\n" +
      "验签信任根是信标官方公钥（drand 主网群公钥内置；NIST 用 certificateId 对应的 X.509 证书）。本工具与密钥生成路径完全隔离：NIST 官方明示信标值不得用作密钥材料。",
    usage: "信标来源选 drand / NIST；「验证（离线）」把记录 JSON（单条或多条数组）粘进主输入框运行——drand 可留空公钥用内置主网公钥，NIST 建议粘证书 PEM 或公钥 PEM 做 RSA 验签（不给则只验哈希链）；「拉取（联网）」需显式勾选「允许联网拉取」并填 round/脉冲序号，工具才向官方 endpoint 发请求。多条记录自动做逐轮 / 逐脉冲链式衔接校验。",
    examples: [
      { in: "{\"round\":100,\"randomness\":\"4bd45652d69c2060e3efcba3…\",\"signature\":\"82505eaf90b79cb29fcec082…\"}", param: "drand，验证（离线），公钥留空", out: "[drand] 公开随机信标验证（pedersen-bls-chained）\n  1) randomness = SHA-256(signature)  ✓\n  2) msg = SHA-256(round_be8) = …\n  3) BLS12-381 验签 e(σ,G1)=e(H(msg),pk)  ✓\n结果：通过（1 条 drand 记录真实、完整、未被篡改）", desc: "drand 主网 round 100 官方真实数据；篡改 randomness 任意一位立即失败" },
      { in: "两条 drand 记录数组（round 100、101）", param: "验证（离线）", out: "两条分别验签 ✓ + 链式关系：2 轮 previous_signature 逐轮衔接 ✓", desc: "跳轮（如 100、102）会报「哈希链断裂」并给出断裂位置" },
    ],
    tips: [
      "适用场景：抽签公平性存证、可审计的挑战-响应、事后证明「这个随机数当时就是它」——需要的是可验证，不是不可预测。",
      "验签是离线的：粘贴官方记录即可，全程零网络请求；只有「拉取」动作且显式允许后才联网。",
      "验签失败三连查：randomness/哈希链复算不符＝值被改；BLS/RSA 验签不符＝记录被篡改或公钥不匹配；链式断裂＝记录缺轮或缺脉冲。",
      "信标值绝不当密钥用：全球都能看到它——NIST 官方原文明确禁止；需要秘密随机请用「增强随机安全」的系统 / 混合档。",
    ],
    aka: ["公开随机信标验证", "随机信标", "drand 验证", "NIST 随机信标", "随机数信标", "信标验证", "randomness beacon", "drand league of entropy", "NIST beacon 2.0", "可验证随机数", "公开可验证随机", "防篡改随机数", "BLS12-381 信标", "verifiable randomness", "beacon verify"],
  },
};
