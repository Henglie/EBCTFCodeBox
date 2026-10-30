/*
 * edu-t723.js — sigVerify（统一验签入口）科普卡。
 */
export default {
  sigVerify: {
    what: "统一验签入口：自动识别输入属于 JWT/JWS、OpenPGP、OpenSSH SSHSIG、X.509 证书链还是 CMS/PKCS#7 SignedData，再路由到对应的验签实现，统一输出「协议 / 算法 / 签名者 / 有效期 / 结论 / 失败原因」。它只做格式分诊与报告，不重复实现底层验签，也不把「签名有效」冒充「身份可信」。",
    principle:
      "**分诊顺序**：JWT/JWS（三段 base64url 点分，JWE 五段显式拒绝）→ PGP armor（SIGNED MESSAGE / SIGNATURE / MESSAGE）→ SSHSIG armor/二进制 → X.509 PEM/DER → CMS/PKCS#7 DER。未知格式显式报错，不猜。\n\n" +
      "**路由**：JWT 交给 jwtVerify；PGP 交给 pgpVerify；X.509 交给 x509Verify（可带自备信任锚）；CMS 交给 cmsVerify；SSHSIG 交给 sshsigVerify。缺少密钥/原文/信任锚时标 UNVERIFIED，底层 op 未接线时标 BLOCKED，绝不伪造 PASS。\n\n" +
      "**结论分层**：PASS=底层验签通过且满足该入口的信任条件；FAIL=签名/内容/证书链失败；UNVERIFIED=格式已识别但缺少必要材料；BLOCKED=底层能力未接线。",
    usage: "输入签名/令牌/证书链/CMS。参数按协议取用：JWT 的 key 或 secret；PGP/CMS 的 content；X.509 的 anchor/at/leaf；SSHSIG 的 key/content/namespace。输出统一头部 + 底层原始报告。",
    examples: [
      { in: "X.509 leaf+inter+root PEM + 自备 root 信任锚", out: "协议 X.509；结论 PASS；失败原因「证书链逐级验签通过，且与自备信任锚匹配」", desc: "证书链路由" },
      { in: "CMS attached DER", out: "协议 CMS；结论 PASS；算法 RSA PKCS#1 v1.5 / SHA-256", desc: "CMS 路由" },
      { in: "SSHSIG + 原文 + authorized_keys 公钥", out: "协议 SSHSIG；结论 PASS；签名者 t723@example.com", desc: "SSHSIG 路由" },
      { in: "随机文本", out: "显式 FORMAT_ERROR，不猜协议", desc: "未知格式" },
    ],
    tips: [
      "JWT 只有 HS256/384/512、RS256、ES256 走现有实现；其他 alg 会明确说明不支持。",
      "X.509 不提供 anchor 时只验链，结论为 UNVERIFIED/UNTRUSTED，不冒充可信。",
      "PGP/CMS 的 detached 原文要在 content 里给；SSHSIG 的原文也在 content。",
      "CMS 不做证书链/时间戳/CRL/OCSP，证书链请先看 X.509。",
      "SSHSIG 的 namespace 必须与签名一致（默认 file）。",
    ],
    aka: ["统一验签", "验签入口", "签名验证中心", "signature verify", "sigVerify", "JWT 验签", "PGP 验签", "X.509 验签", "CMS 验签", "SSHSIG 验签", "证书链验签", "签名分诊"],
  },
};
