export default {
  falconKeyGen: {
    what: "Falcon/FN-DSA key generation: creates a Falcon-512 (n=512) or Falcon-1024 (n=1024) key pair on an NTRU lattice. The public key is h=g/f mod (x^n+1,12289); the private key is a short polynomial tuple satisfying f·G−g·F=q.",
    principle: "Sample short polynomials f,g from a Gaussian, check coefficient and norm bounds, then apply the Berd bound to confirm the NTRU lattice has a short enough basis. Solve f·G−g·F=q for F,G and compute h=g/f. The private key is encoded with trim_i8 and the public key as a 14-bit coefficient stream.",
    usage: "Choose Falcon-512 or Falcon-1024. An empty seed draws 48 bytes from the unified random source; a fixed 48-byte hex seed reproduces the same key. Outputs public/private hex plus two download files. Keep the private key local.",
    examples: [
      { in: "Falcon-512; empty seed", param: "logn=9", out: "897-byte public key, 1281-byte private key; reports attempts and timing", desc: "common profile" },
      { in: "Falcon-1024; fixed 48-byte seed", param: "logn=10; seed=000102…2f", out: "1793-byte public key, 2305-byte private key; reproducible", desc: "high-security profile, typically <2 s" },
      { in: "Falcon-512 with a 47-byte seed", param: "logn=9", out: "explicit error: seed must be exactly 48 bytes", desc: "no silent padding" },
    ],
    tips: [
      "The public key is public; the private key can forge signatures if leaked.",
      "Keygen uses rejection sampling, so attempts and timing vary with the seed and profile.",
      "The official three-part private key is accepted directly by Falcon sign; a four-part compatibility format is also supported.",
    ],
    aka: [
      "Falcon keygen", "FN-DSA keygen", "Falcon key generation", "Falcon key pair generation",
      "Falcon-512 key generation", "Falcon-1024 key generation", "lattice key generation",
      "NIST PQC Falcon keygen", "falcon keypair", "falcon sk pk", "FN-DSA key pair", "Falcon key generator",
    ],
  },
  falconSign: {
    what: "Falcon/FN-DSA signing: produces a lattice signature with a Falcon private key. The signature carries a 40-byte nonce and compressed s2, and can be passed directly to Falcon verify.",
    principle: "Compute c=HashToPoint(nonce‖message), reduce signing to finding a short vector (s1,s2) with s1+s2·h=c in the NTRU lattice, and use ffSampling over the FFT/LDL tree. Resample while ‖(s1,s2)‖² exceeds ⌊β²⌋. The result is encoded as 0x39/0x3A (Falcon-512/1024) ‖ nonce ‖ comp(s2).",
    usage: "The message can be UTF-8 text or hex. The private key may be the official three-part format (0x59/0x5A) or this tool's four-part format. The 40-byte nonce and 48-byte signing seed may be left empty for random values, or filled in to reproduce KAT runs. Outputs signature hex and a .sig file.",
    examples: [
      { in: "message hello; Falcon-512 private key; empty nonce/seed", param: "msgMode=text", out: "signature hex (~666 B); reports norm and resampling count", desc: "normal signing" },
      { in: "same message with fixed nonce/seed", param: "msgMode=text; fixed 40B nonce/48B seed", out: "byte-identical reproducible signature", desc: "KAT/cross-check" },
      { in: "39-byte nonce", param: "msgMode=text", out: "explicit error: nonce must be exactly 40 bytes", desc: "no silent padding" },
      { in: "binary message", param: "msgMode=hex", out: "signs the raw bytes and outputs signature hex", desc: "binary input" },
    ],
    tips: [
      "Use a fixed nonce/seed only for reproducibility; production signing should leave them empty for the unified random source.",
      "The signature norm must be ≤⌊β²⌋ (34034726 for 512, 70265242 for 1024); otherwise signing resamples.",
      "Public key, signature and message must match; tampering with any of them makes verification fail.",
    ],
    aka: [
      "Falcon signature", "FN-DSA sign", "Falcon signing", "Falcon signature generation",
      "Falcon-512 sign", "Falcon-1024 sign", "lattice signature", "NIST PQC Falcon sign",
      "falcon sign", "falcon sig", "FN-DSA signature", "Falcon signing tool",
    ],
  },
};
