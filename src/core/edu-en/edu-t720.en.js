/*
 * edu-t720.en.js — English edu card for x509Verify. Examples come from OpenSSL 3.5.7 fixtures and verify_t720 runs.
 */
export default {
  "x509Verify": {
    "what": "X.509 certificate chain verification (RFC 5280 path validation) — this is not \"decrypting a certificate\"; it answers two separate questions: ① is every certificate in the chain genuinely signed by the next issuer's private key, with valid dates, CA bits and name chaining (integrity); ② does the chain terminate at a trust anchor you explicitly supply (trust)? X.509 is PKI's container format: a certificate packs subject + public key + extensions into tbsCertificate, and the issuer signs those DER bytes. A verifier walks leaf → intermediate → root, using each issuer certificate's public key to check the one below, until a self-signed root or a pinned anchor.\n\nThis op targets a general crypto toolbox: PEM multi-certificate or single DER input; RSA PKCS#1 v1.5 (SHA-256/384/512), ECDSA P-256/P-384/P-521 and Ed25519; issuer/subject chaining, validity, BasicConstraints CA, KeyUsage keyCertSign, pathLenConstraint; optional self-supplied trust anchor (full certificate or SHA-256 fingerprint). No network, no built-in system roots, no CRL/OCSP — so \"all signatures pass\" and \"trusted\" are printed as separate lines, never conflated.",
    "principle": "**Certificate layout (RFC 5280 §4.1)**: Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }. What is signed is the **original DER byte slice** of tbsCertificate, not a re-encoding of decoded nodes — this implementation keeps absolute offsets during DER parsing and preserves the exact tbs slice, avoiding false failures from re-encoding differences. tbs contains version, serialNumber, signature algorithm, issuer, validity, subject, subjectPublicKeyInfo and optional extensions. issuer/subject are X.501 Names (RDNSequence); chaining compares canonicalized DNs: DER bytes first, then per-RDN attribute normalization (case/whitespace folding) so equivalent PrintableString and UTF8String spellings match.\n\n**Three signature families**: ① RSA PKCS#1 v1.5 — s^e mod n must equal EM = 00‖01‖FF…FF‖00‖DigestInfo(H(tbs)), with PS ≥ 8 bytes; this implementation rebuilds EM and compares byte-for-byte, and tolerates the DigestInfo-without-NULL variant. ② ECDSA — r,s DER; e = leftmost min(bitlen(n), hlen) bits of H(tbs); verify R = u1·G + u2·Q and R.x mod n = r; the curve comes from the SPKI namedCurve OID (P-256/384/521), independent of the digest length. ③ Ed25519 — PureEdDSA (RFC 8032/8410) over the raw tbs, 64-byte signature, no prehash.\n\n**Validation order**: parse all certificates → pick the leaf automatically (a certificate that issues no other certificate; overridable via leaf) → build the chain by issuer=subject (AKI/SKI preferred when several candidates share a name) → verify every link → verify the terminal self-signature → validity for the whole chain → CA/keyCertSign/pathLen on every issuer → reject unhandled critical extensions → match the trust anchor. **Key distinction**: with no anchor, a fully consistent chain reports PASS + UNTRUSTED; only when the terminal (or a chain member) is DER-identical / fingerprint-identical to your anchor does it report ANCHORED.\n\n**Explicitly out of scope**: CRL/OCSP revocation, policy trees, NameConstraints, CT, timestamps, built-in roots, network fetching; it also does not check the leaf's SAN/hostname or EKU purpose — that belongs to a TLS client/server, not to chain verification itself.",
    "usage": "Paste a PEM chain (any order, multiple -----BEGIN CERTIFICATE----- blocks) into the main input; file upload accepts a single DER certificate (convert multi-cert DER to concatenated PEM). Parameters:\n\n① \"Trust anchor\": paste one PEM certificate, or that certificate's SHA-256 fingerprint (64 hex, case/colons optional). Empty = verify chain consistency only, reporting PASS + UNTRUSTED. A provided anchor that does not match the chain terminal fails with ANCHOR_MISMATCH. The anchor need not be inside the main input: leaf+intermediate plus a root anchor completes the chain.\n\n② \"Verification time\": ISO 8601 (e.g. 2026-06-01T00:00:00Z) or 10-digit epoch seconds; empty = now. Fixing the time makes historical-chain checks reproducible.\n\n③ \"Leaf certificate index\": 0 = automatic (default), 1..N forces the Nth certificate as leaf — useful when several chains are pasted or when validating an intermediate itself.\n\nOutput starts with \"verdict PASS/FAIL\" and \"trust ANCHORED/UNTRUSTED/MISMATCH\", then per certificate: subject/issuer/serial/validity/public key/signature algorithm/SHA-256 fingerprint/BC/KU/SKI/AKI/link signature result, and finally every error and warning with its code. Codes: FORMAT_ERROR, UNKNOWN_ALGORITHM, ALGORITHM_MISMATCH, SIGNATURE_INVALID, CHAIN_BROKEN, EXPIRED, NOT_YET_VALID, CA_CONSTRAINT, ANCHOR_MISMATCH, UNKNOWN_CRITICAL_EXTENSION, NO_CERTIFICATE.",
    "examples": [
      {
        "in": "(PEM: leaf.rsa2048 + intermediate + root; anchor=root.pem; at=2026-06-01T00:00:00Z)",
        "out": "验签结论：PASS\n信任判定：ANCHORED（已用自备信任锚建立信任）\n[链路] 共 3 张（#1 = 叶子）\n#1 叶子：CN=leaf.rsa2048.example, O=Henglie Test, C=CN\n    签发者：CN=Henglie rsa2048 Intermediate, O=Henglie Test, C=CN\n    公钥：RSA 2048 位（e=65537）\n    签名算法：1.2.840.113549.1.1.11（RSA PKCS#1 v1.5 / SHA-256）\n    链签名：由 #2 验证 通过（RSA PKCS#1 v1.5 / SHA-256）\n…\n[检查汇总]\n  逐级验签：2/2 通过；终端自签名 通过\n  有效期：3/3 在有效期内\n  CA 约束：2/2 通过\n  未处理关键扩展：0\n[错误] 无",
        "desc": "Full RSA-2048 three-level chain + certificate anchor: links, self-signature, validity and CA checks all pass"
      },
      {
        "in": "(same chain, last signature byte of the leaf flipped)",
        "out": "验签结论：FAIL\n…\n    链签名：由 #2 验证 失败 [SIGNATURE_INVALID] RSA PKCS#1 v1.5 验签失败：恢复的 EM 与期望不符（头部标记（第 1 字节）；RFC 8017 §8.2.2 步骤 3）\n…\n[错误] 共 1 项（全部显式报出，不静默通过）",
        "desc": "Tampered signature: byte-level EM comparison fails and localizes the mismatching segment; no silent pass"
      },
      {
        "in": "(expired leaf: notAfter=2021-01-01; at=2026-06-01)",
        "out": "验签结论：FAIL\n…\n  1. [EXPIRED] #1 CN=leaf.expired.example, O=Henglie Test, C=CN 已过期：notAfter = 2021-01-01T00:00:00Z，判定时刻 2026-06-01T00:00:00Z",
        "desc": "Expiry is reported separately from signature failure: links still pass, the validity check yields EXPIRED"
      },
      {
        "in": "(P-256 leaf + same-name P-384 intermediate + P-256 root; anchor=root)",
        "out": "验签结论：FAIL\n…\n#2 中间 CA：…\n    公钥：ECDSA P-384\n…\n  1. [SIGNATURE_INVALID] #1 → #2：ECDSA 验签失败：R.x mod n ≠ r（验签方程不成立）",
        "desc": "Wrong curve: names chain correctly, but the key is not the real signer, so the ECDSA equation fails"
      },
      {
        "in": "(Ed25519 three-level chain; no trust anchor)",
        "out": "验签结论：PASS\n信任判定：UNTRUSTED（未提供信任锚；自签名根通过只说明链内一致，不等于可信）\n信任锚：未提供（不内置系统根、不联网）\n…\n[检查汇总]\n  逐级验签：2/2 通过；终端自签名 通过\n  有效期：3/3 在有效期内\n  CA 约束：2/2 通过",
        "desc": "No-anchor mode: integrity PASS and trust UNTRUSTED are shown separately; a self-signed root is not silently promoted to trusted"
      }
    ],
    "formulas": [
      {
        "tex": "\\mathrm{EM} = 00 \\,\\|\\, 01 \\,\\|\\, \\underbrace{FF\\ldots FF}_{\\ge 8} \\,\\|\\, 00 \\,\\|\\, \\mathrm{DigestInfo}(H(\\mathrm{tbs}))",
        "caption": "RSA PKCS#1 v1.5: the verifier rebuilds EM and compares it byte-for-byte with s^e mod n (RFC 8017 §9.2)"
      },
      {
        "tex": "R = u_1 G + u_2 Q,\\quad u_1 = e s^{-1},\\; u_2 = r s^{-1} \\pmod n,\\quad R_x \\bmod n \\stackrel{?}{=} r",
        "caption": "ECDSA verification equation (FIPS 186-4 §6.4); e is the leftmost bitlen(n) bits of H(tbs)"
      },
      {
        "tex": "\\mathrm{Path}:\\; \\mathrm{leaf} \\to \\mathrm{intermediate} \\to \\cdots \\to \\mathrm{anchor}",
        "caption": "Path validation: each issuer name equals the subject of the certificate above, and its key verifies the signature below"
      }
    ],
    "tips": [
      "Read the two verdict lines first: PASS means signatures, dates and CA constraints all passed; trustworthiness is ANCHORED. PASS + UNTRUSTED with no anchor is a normal, honest result — not a failure.",
      "The trust anchor can be the root or any intermediate in the chain: validation stops at the anchor, and certificates above it are irrelevant. The anchor does not need to be in the main input.",
      "Error codes are a triage order: FORMAT_ERROR/NO_CERTIFICATE → fix input; CHAIN_BROKEN → supply the missing intermediate; SIGNATURE_INVALID → wrong chain/curve/tamper; EXPIRED/NOT_YET_VALID → adjust the verification time; CA_CONSTRAINT → inspect BC/KU/pathLen; UNKNOWN_ALGORITHM → check the supported list.",
      "Two forms of \"missing CA bit\": basicConstraints says CA:FALSE (CA_CONSTRAINT), or KeyUsage lacks keyCertSign (also CA_CONSTRAINT). Certificates with no basicConstraints at all are accepted with a warning — never silently treated as a CA.",
      "The terminal self-signature is checked too (stricter than OpenSSL's trust-anchor semantics): a tampered root signature fails here, while OpenSSL may still say OK when that root is pinned as the CAfile. Both behaviours are documented and separately asserted.",
      "SHA-1, RSA-PSS, DSA and Ed448 certificate signatures produce an explicit UNKNOWN_ALGORITHM — they are never mislabeled as a bad signature. Use a dedicated tool or wait for later coverage.",
      "A single DER input is exactly one certificate; concatenate multiple certificates as PEM. SAN/hostname/EKU usage is out of scope — a valid chain does not mean the certificate is valid for example.com's TLS.",
      "For historical chains, pin the verification time. Fingerprint anchors fit cases where you only have the root's fingerprint; the fingerprint is the SHA-256 of the entire certificate DER."
    ],
    "aka": [
      "X.509 certificate chain verification",
      "certificate chain validation",
      "PKIX path validation",
      "X.509 path validation",
      "RFC 5280 path validation",
      "TLS certificate chain",
      "root intermediate leaf certificate",
      "trust anchor",
      "self-signed root certificate",
      "PEM certificate bundle",
      "DER certificate verification",
      "openssl verify alternative",
      "CA bit validation",
      "KeyUsage keyCertSign",
      "certificate validity check",
      "issuer subject chaining",
      "SHA-256 certificate fingerprint",
      "certificate path building",
      "root fingerprint pinning",
      "X.509 certificate verify",
      "PKI chain of trust",
      "certificate trust chain",
      "end-entity certificate validation",
      "certificate chain integrity",
      "X.509 chain verification"
    ]
  }
};
