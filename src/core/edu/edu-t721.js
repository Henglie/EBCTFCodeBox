/*
 * edu-t721.js — cmsVerify（CMS/PKCS#7 验签）科普卡。示例值来自 OpenSSL 3.5.7 样例与 verify_t721 实跑。
 */
export default {
  "cmsVerify": {
    "what": "CMS / PKCS#7 SignedData 验签——按 RFC 5652 解析签名容器，逐个验证签名者：attached（原文内嵌在 eContent）与 detached（原文另给）、issuerAndSerialNumber 与 subjectKeyIdentifier 两种签名者标识、signedAttrs 的 contentType/messageDigest 绑定、RSA PKCS#1 v1.5 与 ECDSA P-256/384/521。它回答的是「这份 CMS 容器里的签名是否由证书私钥对指定内容签发」，不做证书链、信任锚、CRL/OCSP、时间戳或签名策略验证。",
    "principle": "**容器结构（RFC 5652 §5）**：ContentInfo 的 contentType 为 signedData（1.2.840.113549.1.7.2），content 里是 SignedData{version, digestAlgorithms, encapContentInfo, certificates?, crls?, signerInfos}。encapContentInfo.eContentType 标明内容类型，eContent 为 [0] EXPLICIT OCTET STRING 时是 attached，缺省时是 detached。certificates 是 [0] IMPLICIT CertificateSet，本工具只取 X.509 Certificate 选择。\n\n**SignerInfo（§5.3）**：每个签名者含 version、sid、digestAlgorithm、signedAttrs?、signatureAlgorithm、signature、unsignedAttrs?。sid 为 issuerAndSerialNumber 时按证书 issuer DER 与 serial 精确匹配；为 [0] subjectKeyIdentifier 时按证书 SKID 扩展匹配。\n\n**signedAttrs 是验签的核心陷阱（§5.4）**：signedAttrs 在 SignerInfo 里用 [0] IMPLICIT 标签携带，但签名输入必须是这些属性的 **DER SET OF 编码（标签 0x31）**，不是 0xA0。contentType 属性必须等于 eContentType，messageDigest 属性必须等于对原文求 digestAlgorithm 摘要的结果。二者任一不符即失败。没有 signedAttrs 时 RFC 允许直接对原文签名；本工具默认要求 signedAttrs，可显式关闭该策略。\n\n**RSA PKCS#1 v1.5（RFC 8017 §8.2.2/§9.2）**：签名字节按 k=⌈bitlen(n)/8⌉ 定长，检查 s∈[1,n-1]，计算 $s^e \\bmod n$ 得到 EM，要求 EM = 00 01 FF…FF 00 DigestInfo，DigestInfo 内的摘要与重算摘要逐字节相等。\n\n**ECDSA（RFC 5758 §3.2）**：签名是 DER SEQUENCE{r,s}；对签名输入求摘要后取最左 bitlen(n) 位为 e，验证 $R = u_1 G + u_2 Q$ 且 $R_x \\bmod n = r$。曲线只接受 P-256/P-384/P-521。\n\n**编码与多签名者**：解析器同时接受 DER 与 BER（含不定长构造形式）；签名输入、证书与 ECDSA 签名统一重编码为 DER 后计算。多个 SignerInfo 逐个独立验证，只有全部通过才给总体 PASS。",
    "usage": "输入：CMS/PKCS#7 的 DER，支持 PEM（-----BEGIN CMS----- 或 -----BEGIN PKCS7-----）、hex、base64 三种文本形态。\n\n参数：detached 时在「外部原文」填被签名内容，编码可选 UTF-8 文本 / hex / base64；attached 时该参数忽略。「补充证书」可填多张 PEM CERTIFICATE，用于 CMS 未内嵌证书（OpenSSL -nocerts）的情况；「要求 signedAttrs」默认开，关闭后接受 RFC 5652 允许的无属性签名。\n\n输出：ContentInfo/SignedData 版本、digestAlgorithms、eContentType、attached/detached 与内容长度、证书集、CRL 有无、每个签名者的 sid/摘要算法/signedAttrs 校验/签名算法/证书 subject/有效期/公钥/内容摘要/结论与失败原因，最后给总体 PASS 或 FAIL。\n\n典型来源：OpenSSL `cms -sign`、S/MIME 签名邮件、代码/文档签名容器。",
    "examples": [
      {
        "in": "OpenSSL `cms -sign -in msg.txt -signer rsa2048.crt.pem -inkey rsa2048.key.pem -md sha256 -outform DER -nodetach`（1620 字节 DER）",
        "out": "总体结论 PASS（1/1）；eContentType=id-data；内容 72 字节；RSA PKCS#1 v1.5（rsaEncryption）；signedAttrs 4 项，contentType 匹配，messageDigest=c7bcf9ed…17361b 匹配；签名者证书 RSA 2048 位 e=65537",
        "desc": "RSA + SHA-256 + attached 基线"
      },
      {
        "in": "P-384 证书 `cms -sign -md sha384` 的 detached DER（1057 字节）+ 外部原文 msg.txt（72 字节）",
        "out": "总体结论 PASS（1/1）；ecdsa-with-SHA384；signedAttrs 的 DER SET OF 247 字节；messageDigest 076e4012…eac717 匹配；证书公钥 EC P-384 (secp384r1)",
        "desc": "ECDSA P-384 + SHA-384 + detached"
      },
      {
        "in": "同一原文用 RSA 2048 与 P-256 两张证书分别 `-signer`（2507 字节 DER）",
        "out": "SignerInfos 2 个；签名者 #1 ecdsa-with-SHA256 PASS；签名者 #2 RSA PKCS#1 v1.5 PASS；总体 PASS（2/2）",
        "desc": "多签名者逐项报告，全部通过才总体 PASS"
      },
      {
        "in": "把 attached 样本 eContent 的首字节翻转 1 bit（长度不变）",
        "out": "FAIL：messageDigest 与外部内容的 SHA-256 摘要不一致（期望 71f22883…9dc66d02，属性 c7bcf9ed…17361b）；RSA 签名本身仍能通过 signedAttrs 验证，但内容绑定失败",
        "desc": "内容篡改被 messageDigest 拦下，不静默通过"
      },
      {
        "in": "`cms -sign -noattr` 生成的无 signedAttrs 样本",
        "out": "默认 FAIL：「缺少 signedAttrs（RFC 5652 §5.4 允许直接对内容签名；本工具默认要求 signedAttrs…）」；把「要求 signedAttrs」关掉后 PASS（1/1）",
        "desc": "默认严格策略与 RFC 允许口径分列"
      },
      {
        "in": "把 digestAlgorithm OID 改成同长度的未知 OID 2.16.840.1.101.3.4.2.9",
        "out": "FAIL：「不支持的摘要算法：2.16.840.1.101.3.4.2.9；支持 SHA-256/SHA-384/SHA-512」",
        "desc": "未知算法显式失败，不退化成跳过"
      }
    ],
    "formulas": [
      {
        "tex": "\\mathrm{messageDigest} = H(\\mathrm{content})",
        "caption": "signedAttrs 的 messageDigest 必须等于原文摘要"
      },
      {
        "tex": "\\mathrm{signatureInput} = \\mathrm{DER}(\\mathrm{SignedAttributes}) \\;\\text{as SET OF (tag 0x31)}",
        "caption": "签名输入不是 SignerInfo 里的 [0] IMPLICIT 标签"
      },
      {
        "tex": "EM = 00 \\;\\|\\; 01 \\;\\|\\; \\mathrm{FF}^{\\ge 8} \\;\\|\\; 00 \\;\\|\\; \\mathrm{DigestInfo}",
        "caption": "RSA PKCS#1 v1.5 的 EM 结构（RFC 8017 §9.2）"
      },
      {
        "tex": "s = \\mathrm{SIG}^{e} \\bmod n, \\qquad R = u_1 G + u_2 Q, \\qquad R_x \\bmod n = r",
        "caption": "RSA 恢复 EM；ECDSA 的验证等式（u1=e·s⁻¹, u2=r·s⁻¹）"
      }
    ],
    "tips": [
      "构造样例：attached 用 `openssl cms -sign ... -nodetach`，detached 去掉 `-nodetach`；加 `-binary` 可保持原文逐字节不变，避免文本换行规范化造成的假失败。",
      "独立对拍：attached 用 `openssl cms -verify -inform DER -in x.der -noverify`；detached 加 `-content 原文`；`-nocerts` 样本加 `-certfile 证书.pem`。`-noverify` 只跳过证书链，签名照验。",
      "`-stream` 生成的是 BER 不定长编码，本工具同样支持；若只接受 DER，可加 `-noindef` 或对输出再做一次 DER 规范化。",
      "缺 signedAttrs 的 `-noattr` 样本在 RFC 5652 下是合法签名，但本工具默认按「要求 signedAttrs」拒绝；确认来源可信后再关闭该策略。",
      "边界：RSASSA-PSS、SHA-1/MD5、secp256k1 均显式报「不支持」，不会静默通过；需要这些算法时应先扩展验签原语。",
      "本工具只验证签名与签名者证书公钥的绑定，不验证证书链、有效期策略、KeyUsage 强制、CRL/OCSP 或时间戳；生产场景应与证书链验证配合。",
      "PEM 标签常见 `CMS` 与 `PKCS7`；证书 PEM 不要直接当 CMS 输入，工具会明确提示标签不符。"
    ],
    "aka": [
      "CMS 验签",
      "PKCS#7 验签",
      "CMS SignedData",
      "SignedData 验签",
      "pkcs7 verify",
      "openssl cms -verify",
      "S/MIME 签名验证",
      "attached 签名",
      "detached 签名",
      "分离签名",
      "多签名者 CMS",
      "SignerInfo",
      "signedAttrs 校验",
      "messageDigest 校验",
      "数字签名容器",
      "CMS/PKCS#7"
    ]
  }
};
