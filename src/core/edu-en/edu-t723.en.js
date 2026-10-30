/*
 * edu-t723.en.js — English edu card for sigVerify (unified signature verification entry).
 */
export default {
  sigVerify: {
    what: "Unified signature verification entry: detects whether the input is JWT/JWS, OpenPGP, OpenSSH SSHSIG, an X.509 certificate chain or CMS/PKCS#7 SignedData, then routes it to the matching verifier and reports protocol / algorithm / signer / validity / verdict / failure reason. It only dispatches and reports; it never reimplements the underlying verification and never pretends a valid signature means a trusted identity.",
    principle:
      "**Dispatch order**: JWT/JWS (three base64url segments; five-segment JWE rejected explicitly) → PGP armor (SIGNED MESSAGE / SIGNATURE / MESSAGE) → SSHSIG armor/binary → X.509 PEM/DER → CMS/PKCS#7 DER. Unknown formats fail explicitly; the tool does not guess.\n\n" +
      "**Routing**: JWT → jwtVerify; PGP → pgpVerify; X.509 → x509Verify (optional self-supplied anchor); CMS → cmsVerify; SSHSIG → sshsigVerify. Missing key/content/anchor yields UNVERIFIED, an unwired backend yields BLOCKED, and PASS is never faked.\n\n" +
      "**Verdicts**: PASS = underlying verification succeeded and the entry's trust condition is met; FAIL = signature/content/chain failed; UNVERIFIED = format recognized but material missing; BLOCKED = backend not wired.",
    usage: "Input a signature/token/certificate chain/CMS. Parameters are protocol-specific: JWT key or secret; PGP/CMS content; X.509 anchor/at/leaf; SSHSIG key/content/namespace. The output is a unified header plus the original sub-report.",
    examples: [
      { in: "X.509 leaf+inter+root PEM with a self-supplied root anchor", out: "Protocol X.509; PASS; reason: each chain link verified and the trust anchor matched", desc: "Certificate chain routing" },
      { in: "CMS attached DER", out: "Protocol CMS; PASS; algorithm RSA PKCS#1 v1.5 / SHA-256", desc: "CMS routing" },
      { in: "SSHSIG + message + authorized_keys public key", out: "Protocol SSHSIG; PASS; signer t723@example.com", desc: "SSHSIG routing" },
      { in: "Random text", out: "Explicit FORMAT_ERROR; no guessing", desc: "Unknown format" },
    ],
    tips: [
      "JWT supports HS256/384/512, RS256 and ES256 through the existing implementation; other alg values are reported as unsupported.",
      "Without an X.509 anchor the result is UNVERIFIED/UNTRUSTED, never falsely trusted.",
      "Detached PGP/CMS content and the SSHSIG message both go in the content parameter.",
      "CMS does not validate chains, timestamps, CRL or OCSP; use X.509 for chain validation first.",
      "The SSHSIG namespace must match the signature (default file).",
    ],
    aka: ["unified verify", "signature verification entry", "signature verify", "sigVerify", "JWT verify", "PGP verify", "X.509 verify", "CMS verify", "SSHSIG verify", "certificate chain verify", "signature dispatch", "verify center"],
  },
};
