/*
 * edu-t722.js — sshsigVerify（OpenSSH SSHSIG 验签）科普卡。
 * 样例值来自本机 ssh-keygen -Y sign/verify 与 verify_t722 实跑。
 */
export default {
  sshsigVerify: {
    what: "OpenSSH SSHSIG 验签——验证 `ssh-keygen -Y sign` 生成的签名文件（armored 或二进制）。SSHSIG 是 OpenSSH 的「签名消息」格式，签名里内嵌公钥、命名空间和消息哈希；本工具验签 Ed25519、RSA（rsa-sha2-256/512）与 ECDSA P-256/384/521，并可选择用期望公钥或 SHA-256 指纹确认签名者身份。它回答的是「这条消息是否由该 SSH 密钥签发」，不读取私钥、不联网。",
    principle:
      "**文件结构（PROTOCOL.sshsig v1）**：6 字节魔数 `SSHSIG` + uint32 版本 1 + SSH wire string 公钥 + string namespace + string reserved + string hash_algorithm + string signature。signature 内再含签名密钥类型与签名字节。\n\n" +
      "**签名输入**：`\"SSHSIG\" || string(namespace) || string(reserved) || string(hash_algorithm) || string(H(message))`，其中 H 由 hash_algorithm 指定（sha256/sha512），string() 是 SSH wire 的 uint32 大端长度前缀。namespace 是域分隔（如 `git`、`file`），不同 namespace 的签名不能互换。\n\n" +
      "**算法**：ssh-ed25519 用 Ed25519（内部 SHA-512）；ssh-rsa 只接受 rsa-sha2-256 / rsa-sha2-512（PKCS#1 v1.5），拒绝 SHA-1；ecdsa-sha2-nistp256/384/521 用对应曲线的 ECDSA。\n\n" +
      "**信任模型**：签名内嵌公钥只能证明「签名由该密钥生成」。只有调用方提供期望公钥（authorized_keys 行）或 SHA-256 指纹并与内嵌公钥一致时，才判定身份可信；不提供时只报签名有效，不冒充身份验证通过。",
    usage: "输入：SSHSIG 签名文件（粘贴 armored 文本，或上传二进制/hex）。参数：被签名的消息（文本/hex/base64）、期望公钥（authorized_keys 行或 SHA256: 指纹，可空）、期望 namespace（留空用签名内值）。输出：公钥类型/指纹、签名类型、hash_algorithm、namespace、签名验证结论、身份信任结论与失败原因。",
    examples: [
      { in: "ssh-keygen -Y sign -f ed25519 -n file msg.txt 生成的 ed25519.sig + 原文 hello sshsig + allowed_signers 公钥", out: "签名验证：通过；公钥信任：与期望一致；namespace=file；hash=sha512", desc: "官方 ssh-keygen 样例闭环" },
      { in: "同一签名 + 被篡改的消息", out: "签名验证：失败（消息哈希不匹配）", desc: "消息完整性" },
      { in: "同一签名 + 另一把 ed25519 公钥", out: "签名验证：通过；公钥信任：与期望不一致", desc: "签名有效 ≠ 身份可信" },
    ],
    tips: [
      "namespace 是签名的一部分：git 签名不能拿去验 file 命名空间。",
      "签名内嵌公钥；验签通过只说明密钥持有者签过，身份是否可信要额外给期望公钥/指纹。",
      "ssh-rsa 的 SHA-1 签名明确拒绝，只支持 rsa-sha2-256/512。",
      "sk-* 安全密钥、SSH 证书密钥（*-cert-v01）与 DSA 不在支持范围。",
      "二进制签名以 `SSHSIG` 魔数开头，可直接上传或转 hex。",
    ],
    aka: ["SSHSIG", "OpenSSH 签名", "SSH 签名验证", "ssh-keygen -Y sign", "签名消息", "SSH signed message", "SSH 文件签名", "git 提交签名验证", "SSH 公钥验签", "OpenSSH signature", "SSHSIG verify", "SSH 签名文件"],
  },
};
