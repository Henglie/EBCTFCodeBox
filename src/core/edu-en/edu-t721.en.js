/*
 * edu-t721.en.js — English edu card for cmsVerify. Examples come from OpenSSL 3.5.7 fixtures and verify_t721 runs.
 */
export default {
  "cmsVerify": {
    "what": "CMS / PKCS#7 SignedData verification — parses a signature container per RFC 5652 and verifies each signer: attached (content embedded in eContent) or detached (content supplied separately), issuerAndSerialNumber or subjectKeyIdentifier signer IDs, signedAttrs contentType/messageDigest binding, RSA PKCS#1 v1.5 and ECDSA P-256/384/521. It answers whether the signatures in this CMS container were made over the specified content by the private keys of the signer certificates; it does not validate certificate chains, trust anchors, CRL/OCSP, timestamps or signature policies.",
    "principle": "**Container layout (RFC 5652 §5)**: ContentInfo has contentType signedData (1.2.840.113549.1.7.2) and content SignedData{version, digestAlgorithms, encapContentInfo, certificates?, crls?, signerInfos}. encapContentInfo.eContentType names the content type; eContent as a [0] EXPLICIT OCTET STRING means attached, while its absence means detached. certificates is a [0] IMPLICIT CertificateSet; this tool only consumes the X.509 Certificate choice.\n\n**SignerInfo (§5.3)**: each signer carries version, sid, digestAlgorithm, optional signedAttrs, signatureAlgorithm, signature and optional unsignedAttrs. For issuerAndSerialNumber the certificate is matched by exact issuer DER plus serial; for [0] subjectKeyIdentifier it is matched by the certificate SKID extension.\n\n**signedAttrs is the core trap (§5.4)**: in SignerInfo the field uses the [0] IMPLICIT tag, but the signature input must be the **DER SET OF encoding (tag 0x31)** of those attributes, not 0xA0. The contentType attribute must equal eContentType and messageDigest must equal the digestAlgorithm hash of the content. Either mismatch fails. RFC 5652 allows omitting signedAttrs and signing the content directly; this tool requires signedAttrs by default and exposes an explicit opt-out.\n\n**RSA PKCS#1 v1.5 (RFC 8017 §8.2.2/§9.2)**: the signature is exactly k=⌈bitlen(n)/8⌉ bytes; check s∈[1,n-1], compute $s^e \\bmod n$ to recover EM, require EM = 00 01 FF…FF 00 DigestInfo, and compare the DigestInfo digest byte-for-byte with the recomputed digest.\n\n**ECDSA (RFC 5758 §3.2)**: the signature is DER SEQUENCE{r,s}; hash the signature input, take the leftmost bitlen(n) bits as e, and verify $R = u_1 G + u_2 Q$ with $R_x \\bmod n = r$. Only P-256/P-384/P-521 are accepted.\n\n**Encoding and multiple signers**: the parser accepts DER and BER (including indefinite-length constructed forms); signature inputs, certificates and ECDSA signatures are re-encoded to DER before computation. Multiple SignerInfos are verified independently and the overall verdict is PASS only when every signer passes.",
    "usage": "Input: CMS/PKCS#7 DER in text form — PEM (-----BEGIN CMS----- or -----BEGIN PKCS7-----), hex, or base64.\n\nParameters: for detached CMS put the signed content in \"external content\" and choose UTF-8 text / hex / base64 encoding; for attached CMS the parameter is ignored. \"Extra certificates\" accepts multiple PEM CERTIFICATE blocks for CMS that omitted certificates (OpenSSL -nocerts). \"Require signedAttrs\" is on by default; turning it off accepts the RFC 5652 no-attribute form.\n\nOutput: ContentInfo/SignedData version, digestAlgorithms, eContentType, attached/detached mode and content length, certificate set, CRL presence, and per signer: sid, digest algorithm, signedAttrs checks, signature algorithm, certificate subject/validity/public key, content digest, verdict and failure reason, followed by an overall PASS or FAIL.\n\nTypical sources: OpenSSL `cms -sign`, S/MIME signed mail, code/document signature containers.",
    "examples": [
      {
        "in": "OpenSSL `cms -sign -in msg.txt -signer rsa2048.crt.pem -inkey rsa2048.key.pem -md sha256 -outform DER -nodetach` (1620-byte DER)",
        "out": "Overall PASS (1/1); eContentType=id-data; content 72 bytes; RSA PKCS#1 v1.5 (rsaEncryption); 4 signedAttrs, contentType matches, messageDigest=c7bcf9ed…17361b matches; signer certificate RSA 2048-bit e=65537",
        "desc": "RSA + SHA-256 + attached baseline"
      },
      {
        "in": "P-384 certificate `cms -sign -md sha384` detached DER (1057 bytes) + external msg.txt (72 bytes)",
        "out": "Overall PASS (1/1); ecdsa-with-SHA384; signedAttrs DER SET OF 247 bytes; messageDigest 076e4012…eac717 matches; certificate key EC P-384 (secp384r1)",
        "desc": "ECDSA P-384 + SHA-384 + detached"
      },
      {
        "in": "The same content signed with an RSA 2048 and a P-256 certificate via two `-signer` options (2507-byte DER)",
        "out": "2 SignerInfos; signer #1 ecdsa-with-SHA256 PASS; signer #2 RSA PKCS#1 v1.5 PASS; overall PASS (2/2)",
        "desc": "Multiple signers reported individually; overall PASS only if all pass"
      },
      {
        "in": "Flip one bit in the first byte of the attached sample's eContent (same length)",
        "out": "FAIL: messageDigest does not match the SHA-256 digest of the content (expected 71f22883…9dc66d02, attribute c7bcf9ed…17361b); the RSA signature over signedAttrs still verifies, but the content binding fails",
        "desc": "Content tampering is caught by messageDigest, never silently accepted"
      },
      {
        "in": "`cms -sign -noattr` sample without signedAttrs",
        "out": "Default FAIL: \"missing signedAttrs (RFC 5652 §5.4 allows signing the content directly; this tool requires signedAttrs by default…)\"; turning \"Require signedAttrs\" off yields PASS (1/1)",
        "desc": "Strict default and RFC-permitted mode reported separately"
      },
      {
        "in": "Replace the digestAlgorithm OID with an unknown same-length OID 2.16.840.1.101.3.4.2.9",
        "out": "FAIL: \"unsupported digest algorithm: 2.16.840.1.101.3.4.2.9; supported: SHA-256/SHA-384/SHA-512\"",
        "desc": "Unknown algorithms fail explicitly instead of being skipped"
      }
    ],
    "formulas": [
      {
        "tex": "\\mathrm{messageDigest} = H(\\mathrm{content})",
        "caption": "signedAttrs messageDigest must equal the content digest"
      },
      {
        "tex": "\\mathrm{signatureInput} = \\mathrm{DER}(\\mathrm{SignedAttributes}) \\;\\text{as SET OF (tag 0x31)}",
        "caption": "The signature input is not the [0] IMPLICIT tag used inside SignerInfo"
      },
      {
        "tex": "EM = 00 \\;\\|\\; 01 \\;\\|\\; \\mathrm{FF}^{\\ge 8} \\;\\|\\; 00 \\;\\|\\; \\mathrm{DigestInfo}",
        "caption": "RSA PKCS#1 v1.5 EM layout (RFC 8017 §9.2)"
      },
      {
        "tex": "s = \\mathrm{SIG}^{e} \\bmod n, \\qquad R = u_1 G + u_2 Q, \\qquad R_x \\bmod n = r",
        "caption": "RSA EM recovery; ECDSA verification equation (u1=e·s⁻¹, u2=r·s⁻¹)"
      }
    ],
    "tips": [
      "Build fixtures: attached with `openssl cms -sign ... -nodetach`, detached by dropping `-nodetach`; add `-binary` to preserve content bytes exactly and avoid false failures from newline canonicalization.",
      "Independent oracle: attached `openssl cms -verify -inform DER -in x.der -noverify`; add `-content` for detached and `-certfile` for a `-nocerts` sample. `-noverify` skips only the certificate chain, not the signature.",
      "`-stream` produces BER indefinite-length encoding, which this tool also accepts; if you need DER only, add `-noindef` or normalize the output to DER.",
      "A `-noattr` sample without signedAttrs is a legal RFC 5652 signature, but this tool rejects it by default under \"Require signedAttrs\"; disable that policy only when the source is trusted.",
      "Boundaries: RSASSA-PSS, SHA-1/MD5 and secp256k1 all fail explicitly as unsupported; they are never silently accepted. Extend the primitives before relying on them.",
      "This tool verifies only the signature and its binding to the signer certificate's public key; it does not validate the certificate chain, validity policy, mandatory KeyUsage, CRL/OCSP or timestamps. Pair it with certificate-chain verification in production.",
      "PEM labels `CMS` and `PKCS7` are both accepted; feeding a certificate PEM as CMS input fails with an explicit label error."
    ],
    "aka": [
      "CMS verify",
      "PKCS#7 verify",
      "CMS SignedData",
      "SignedData verification",
      "pkcs7 verify",
      "openssl cms -verify",
      "S/MIME signature verification",
      "attached signature",
      "detached signature",
      "multiple CMS signers",
      "SignerInfo",
      "signedAttrs verification",
      "messageDigest check",
      "digital signature container",
      "CMS/PKCS#7",
      "CMS 验签"
    ]
  }
};
