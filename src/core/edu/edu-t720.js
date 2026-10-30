/*
 * edu-t720.js — x509Verify（X.509 证书链验签）科普卡。示例值来自 OpenSSL 3.5.7 样例与 verify_t720 实跑。
 */
export default {
  "x509Verify": {
    "what": "X.509 证书链验签（RFC 5280 路径验证）——不是「解密证书」，而是回答两个分开的问题：①链内每张证书的签名是否真的由上一级私钥签发、有效期/CA 位/名称衔接是否成立（完整性）；②链是否终止于你明确指定的信任锚（信任）。X.509 是 PKI 的容器格式：证书把「主体 + 公钥 + 扩展」装进 tbsCertificate，再由签发者用自己的私钥对这段 DER 签名；验签方从叶子一路向上，用每张签发者证书里的公钥验证下一张，直到自签名根或你 pin 的锚。\n\n本 op 面向通用密码学工具箱：输入 PEM 多证书或单张 DER，逐级验 RSA PKCS#1 v1.5（SHA-256/384/512）、ECDSA P-256/P-384/P-521、Ed25519；检查 issuer/subject 衔接、有效期、BasicConstraints CA 位、KeyUsage keyCertSign、pathLenConstraint；可选自备信任锚（完整证书或 SHA-256 指纹）。不联网、不内置系统根、不做 CRL/OCSP，所以「签名全过」与「可信」被显式拆成两行输出，绝不把链内自洽冒充信任。",
    "principle": "**证书结构（RFC 5280 §4.1）**：Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }。真正被签的是 tbsCertificate 的**原始 DER 字节**，不是解码后重新编码的节点——本实现用带绝对偏移的 DER 解析器保留 tbs 的字节切片，避免「重编码恰好不等」造成假验签。tbs 内含 version、serialNumber、signature（算法）、issuer、validity、subject、subjectPublicKeyInfo、可选扩展。issuer/subject 是 X.501 Name（RDNSequence），链式衔接比较的是规范化后的 DN：先比 DER 字节，不等再按 RDN 集合逐属性规范化比较（大小写/空白折叠），兼容 PrintableString 与 UTF8String 的等价写法。\n\n**三类签名原语**：①RSA PKCS#1 v1.5——签名整数 s 满足 s^e mod n = EM，EM = 00‖01‖FF…FF‖00‖DigestInfo(H(tbs))，PS 至少 8 字节；本实现重算 EM 并逐字节比较，同时接受 DigestInfo 省略 NULL 参数的兼容写法。②ECDSA——r,s 用 DER 编码；e = H(tbs) 最左 min(bitlen(n), hlen) 位；验证 R = u1·G + u2·Q 且 R.x mod n = r；曲线由 SPKI 的 namedCurve OID 决定（P-256/384/521），签名摘要与曲线长度独立。③Ed25519——PureEdDSA（RFC 8032/8410），对原始 tbs 直接验 64 字节签名，不做预哈希。\n\n**路径验证顺序（本实现）**：解析全部证书 → 自动选叶（不是任何其他证书的签发者；可用 leaf 参数覆盖）→ 按 issuer=subject 向上建链（同名多候选时优先 AKI/SKI 匹配）→ 每级验签 → 终端自签名验证 → 全链有效期 → 每个签发者的 CA 位/keyCertSign/pathLen → 未处理的关键扩展拒绝 → 信任锚匹配。**关键区分**：没有信任锚时，链内签名全过也只给 PASS + UNTRUSTED；只有终端（或链中某张）与你提供的锚证书 DER 相同/指纹相同，才给 ANCHORED。\n\n**明确不做**：CRL/OCSP 吊销、证书策略树、NameConstraints、CT、时间戳、系统根内置、网络抓取；也不校验叶子证书的 SAN/主机名或 EKU 用途——那是 TLS 客户端/服务端的职责，不是链验签本身。",
    "usage": "主输入粘贴 PEM 证书链（可多张，-----BEGIN CERTIFICATE-----），顺序任意；文件上传可直接喂单张 DER（多证书 DER 请先转 PEM 拼接）。参数：\n\n①「信任锚」：粘贴一张 PEM 证书，或该证书的 SHA-256 指纹（64 hex，大小写/冒号均可）。留空则只验链内一致性，输出 PASS + UNTRUSTED；填了锚但链终端不匹配则 FAIL + ANCHOR_MISMATCH。锚证书不必出现在主输入里——只给 leaf+intermediate、锚填 root 也能补全链。\n\n②「验证时刻」：ISO 8601（如 2026-06-01T00:00:00Z）或 10 位 epoch 秒；留空用当前时间。做历史链验收时固定时刻可复现。\n\n③「叶子证书序号」：0=自动（默认），1..N 强制指定第几张为叶子，适合输入里混有多条链或需要验证中间证书自身。\n\n输出先给「验签结论 PASS/FAIL」与「信任判定 ANCHORED/UNTRUSTED/MISMATCH」，再逐张列 subject/issuer/序列号/有效期/公钥/签名算法/SHA-256 指纹/BC/KU/SKI/AKI/链签名结果，最后按错误码逐条列错误与警告。错误码：FORMAT_ERROR、UNKNOWN_ALGORITHM、ALGORITHM_MISMATCH、SIGNATURE_INVALID、CHAIN_BROKEN、EXPIRED、NOT_YET_VALID、CA_CONSTRAINT、ANCHOR_MISMATCH、UNKNOWN_CRITICAL_EXTENSION、NO_CERTIFICATE。",
    "examples": [
      {
        "in": "（PEM：leaf.rsa2048 + intermediate + root；信任锚=root.pem；验证时刻=2026-06-01T00:00:00Z）",
        "out": "验签结论：PASS\n信任判定：ANCHORED（已用自备信任锚建立信任）\n[链路] 共 3 张（#1 = 叶子）\n#1 叶子：CN=leaf.rsa2048.example, O=Henglie Test, C=CN\n    签发者：CN=Henglie rsa2048 Intermediate, O=Henglie Test, C=CN\n    公钥：RSA 2048 位（e=65537）\n    签名算法：1.2.840.113549.1.1.11（RSA PKCS#1 v1.5 / SHA-256）\n    链签名：由 #2 验证 通过（RSA PKCS#1 v1.5 / SHA-256）\n…\n[检查汇总]\n  逐级验签：2/2 通过；终端自签名 通过\n  有效期：3/3 在有效期内\n  CA 约束：2/2 通过\n  未处理关键扩展：0\n[错误] 无",
        "desc": "完整 RSA-2048 三层链 + 证书锚：逐级验签、自签名、有效期、CA 约束全部通过"
      },
      {
        "in": "（同上链，但叶证书签名末字节被翻转）",
        "out": "验签结论：FAIL\n…\n    链签名：由 #2 验证 失败 [SIGNATURE_INVALID] RSA PKCS#1 v1.5 验签失败：恢复的 EM 与期望不符（头部标记（第 1 字节）；RFC 8017 §8.2.2 步骤 3）\n…\n[错误] 共 1 项（全部显式报出，不静默通过）\n  1. [SIGNATURE_INVALID] #1 → #2：RSA PKCS#1 v1.5 验签失败：恢复的 EM 与期望不符…",
        "desc": "篡改签名：逐字节 EM 比对失败，错误定位到具体区段，不静默通过"
      },
      {
        "in": "（过期叶证书链：notAfter=2021-01-01；验证时刻=2026-06-01）",
        "out": "验签结论：FAIL\n…\n  1. [EXPIRED] #1 CN=leaf.expired.example, O=Henglie Test, C=CN 已过期：notAfter = 2021-01-01T00:00:00Z，判定时刻 2026-06-01T00:00:00Z",
        "desc": "过期与签名错分开报：链签名仍全部通过，但有效期检查判 EXPIRED"
      },
      {
        "in": "（P-256 叶证书 + 同名的 P-384 中间证书 + P-256 根；锚=根）",
        "out": "验签结论：FAIL\n…\n#2 中间 CA：…\n    公钥：ECDSA P-384\n…\n  1. [SIGNATURE_INVALID] #1 → #2：ECDSA 验签失败：R.x mod n ≠ r（验签方程不成立）",
        "desc": "错曲线：名称衔接成立但公钥不是真正的签发者，ECDSA 方程失败"
      },
      {
        "in": "（Ed25519 三层链；不填信任锚）",
        "out": "验签结论：PASS\n信任判定：UNTRUSTED（未提供信任锚；自签名根通过只说明链内一致，不等于可信）\n信任锚：未提供（不内置系统根、不联网）\n…\n[检查汇总]\n  逐级验签：2/2 通过；终端自签名 通过\n  有效期：3/3 在有效期内\n  CA 约束：2/2 通过",
        "desc": "无锚模式：完整性 PASS 与信任 UNTRUSTED 分开展示，不把自签根冒充可信"
      }
    ],
    "formulas": [
      {
        "tex": "\\mathrm{EM} = 00 \\,\\|\\, 01 \\,\\|\\, \\underbrace{FF\\ldots FF}_{\\ge 8} \\,\\|\\, 00 \\,\\|\\, \\mathrm{DigestInfo}(H(\\mathrm{tbs}))",
        "caption": "RSA PKCS#1 v1.5：验签方重算 EM，与 s^e mod n 恢复值逐字节比较（RFC 8017 §9.2）"
      },
      {
        "tex": "R = u_1 G + u_2 Q,\\quad u_1 = e s^{-1},\\; u_2 = r s^{-1} \\pmod n,\\quad R_x \\bmod n \\stackrel{?}{=} r",
        "caption": "ECDSA 验签方程（FIPS 186-4 §6.4）；e 取 H(tbs) 最左 bitlen(n) 位"
      },
      {
        "tex": "\\mathrm{Path}:\\; \\mathrm{leaf} \\to \\mathrm{intermediate} \\to \\cdots \\to \\mathrm{anchor}",
        "caption": "路径验证：每级 issuer 名称等于下级签发者 subject，且签名由该级公钥验证通过"
      }
    ],
    "tips": [
      "先看两行结论：PASS 只代表链内签名/有效期/CA 约束全过；可信与否看 ANCHORED。没有锚时 PASS+UNTRUSTED 是正常输出，不是失败。",
      "信任锚可以是 root，也可以是链中某张中间证书：路径验证只到锚为止，锚以上的证书不参与。锚证书不必出现在主输入里。",
      "错误码就是排障顺序：FORMAT_ERROR/NO_CERTIFICATE 先修输入；CHAIN_BROKEN 补中间证书；SIGNATURE_INVALID 查错链/错曲线/篡改；EXPIRED/NOT_YET_VALID 调验证时刻；CA_CONSTRAINT 查 BC/KU/pathLen；UNKNOWN_ALGORITHM 看算法是否在支持清单。",
      "「缺 CA 位」有两种：basicConstraints 写了 CA:FALSE（直接 CA_CONSTRAINT），或 KeyUsage 没置 keyCertSign（也是 CA_CONSTRAINT）。完全没写 basicConstraints 的老证书按宽松口径放行并给警告，不静默当成 CA。",
      "本工具会验证自签名终端的自身签名（比 OpenSSL 信任锚语义更严）：根证书签名被篡改会 FAIL；若你明确把该根当锚，OpenSSL 可能仍判 OK——两种口径在报告与 verify 脚本里都单列说明。",
      "SHA-1、RSA-PSS、DSA、Ed448 的证书签名会显式报 UNKNOWN_ALGORITHM，不会「验不过就当签名错」。需要这些算法请换专用工具或等后续扩展。",
      "单张 DER 只支持一张证书；多张 DER 请转成 PEM 拼接。叶子证书的 SAN/主机名/EKU 用途不在本 op 范围——链验签通过不等于「这个证书能用于 example.com 的 TLS」。",
      "历史链复验用「验证时刻」固定时间；空值用当前时间。指纹锚适合只拿到根指纹、没有根文件的场景，指纹就是整张证书 DER 的 SHA-256。"
    ],
    "aka": [
      "X.509 证书链验签",
      "certificate chain verification",
      "证书链校验",
      "PKI 证书验证",
      "X.509 path validation",
      "RFC 5280 路径验证",
      "TLS 证书链",
      "根证书 中间证书 叶证书",
      "trust anchor",
      "信任锚",
      "自签名根证书",
      "PEM 多证书",
      "DER 证书验签",
      "openssl verify 替代",
      "CA 位校验",
      "KeyUsage keyCertSign",
      "证书有效期校验",
      "issuer subject 链",
      "证书 SHA-256 指纹",
      "PKIX",
      "certificate path building",
      "根证书指纹 pin",
      "X.509 证书解析验签",
      "证书链完整性",
      "certificate trust chain"
    ]
  }
};
