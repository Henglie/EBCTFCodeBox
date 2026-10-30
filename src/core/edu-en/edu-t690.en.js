/*
 * edu_t690_en.js — English edu cards for the 5 T690 ops (candidates, not wired).
 * Source: edu_t690_zh.js (Chinese), translated 1:1. Example vectors (in/param/out)
 * and TeX formulas are copied verbatim; only prose is translated. Aka lists keep
 * every Chinese alias and add English ones.
 */
export default {
  // ============ Prime-field ECDH ============
  ecdhP: {
    what: "ECDH elliptic-curve Diffie-Hellman key exchange (prime-field curves) — both parties hold a key pair, exchange public keys, and each derives the same shared secret. An eavesdropper sees only the two public keys and cannot recover the secret under the elliptic-curve discrete logarithm problem. This tool covers the four short-Weierstrass curves secp256k1 / P-256 / P-384 / P-521; X25519/X448 (Montgomery form) have their own dedicated ops.",
    principle:
      "**Algorithm (SEC 1 v2.0 §3.3.1 / ANSI X9.63)**: the private key is a random integer $d \\in [1, n-1]$; the public key is the curve point $Q = d \\cdot G$ ($G$ the generator, $n$ the group order). Party A computes $S_A = d_A \\cdot Q_B$, party B computes $S_B = d_B \\cdot Q_A$; by associativity $d_A(d_B G) = d_B(d_A G)$, so both are the same point.\n\n" +
      "**The shared secret is the x-coordinate of the shared point**, output big-endian at the field-prime byte width (RFC 5903 §5: \"The Diffie-Hellman shared secret value is girx\"). Real protocols usually pass the x-coordinate through a KDF (e.g. HKDF) before use; CTF challenges that say \"ECDH gives the key\" most often use the raw x-coordinate.\n\n" +
      "**Scalar multiplication**: this tool uses Jacobian projective coordinates for doubling/addition (avoiding a modular inversion per step) with a single final affine conversion. Curve domain parameters are shared with the ECDSA op (SEC 2 v2.0 / FIPS 186-4 D.1.2) — one source of constants, not two.\n\n" +
      "**Why it is secure**: recovering $d$ from $Q$ and $G$ is the elliptic-curve discrete logarithm problem (ECDLP). P-256-class curves have no known practical attacks; secp256k1 is popular because of Bitcoin. Always use standard curves — custom curve parameters may hide backdoors, and invalid-curve / small-subgroup attacks specifically exploit non-standard inputs.",
    usage:
      "Single-side mode: enter your private key $d$ (decimal or 0x hex) and the peer public-key point $Q$ (04‖X‖Y, compressed or uncompressed — same format as eccCalc) and get the shared secret.\n\n" +
      "Mutual-verification mode: also enter the peer private key; the tool computes from both sides and checks $d_A \\cdot Q_B = d_B \\cdot Q_A$, handy for confirming challenge parameters are paired.\n\n" +
      "Private keys can be produced by the ECDSA key-generation op and pasted here; if unsure about public-key format, paste the full uncompressed hex starting with 04 — the tool verifies the point is actually on the curve.",
    examples: [
      { in: "RFC 5903 §8.1 official vector (P-256): i = 0xC88F01F5…1433, peer pubkey = 04‖D12DFB52…BF63‖56FBF3CA…72AB", out: "shared secret = D6840F6B42F6EDAFD13116E0E12565202FEF8E9ECE7DCE03812464D04B9442DE", desc: "IETF IKE ECP group 19 official vector, byte-exact" },
      { in: "private key 12345, peer pubkey 04‖… (any secp256k1 point)", out: "shared secret = (64 hex chars)", desc: "decimal private keys accepted; output is always 32 bytes (field-prime width)" },
      { in: "a private key ≥ n", out: "error: private key d must be in [1, n-1]", desc: "private-key range check; no silent reduction (reduction would break agreement with the peer)" },
    ],
    formulas: [
      { tex: "Q = d \\cdot G,\\qquad S = d_A \\cdot Q_B = d_B \\cdot Q_A = d_A d_B \\cdot G", caption: "Public-key generation and the shared point; associativity makes both sides agree" },
      { tex: "K = x(S)\\;\\text{(fixed-width big-endian)}", caption: "Shared secret = x-coordinate of the shared point, width = field-prime byte length" },
    ],
    tips: [
      "Recognition: a challenge handing you elliptic-curve public/private keys and asking for a \"shared key / agreed key / session key\" is ECDH; if the input is a bare 32-byte string without a 04 prefix, try the X25519 op first.",
      "Common CTF variants: tiny private key (brute-force it), public point not on the curve (invalid-curve attack), shared secret used directly as an AES key without a KDF — all computable here.",
      "secp256k1 and P-256 parameters must not be mixed: picking the wrong curve fails the on-curve check immediately with \"not on curve\", the fastest triage signal.",
      "P-384/P-521 outputs are 48/66 bytes; hash or KDF them before AES, and never treat a 66-byte secret as a 32-byte key.",
      "Difference from X25519: X25519 transmits only the 32-byte u-coordinate (no y, no 04 prefix) and clamps the private key; prime-field ECDH public keys carry full point coordinates.",
      "Standards: SEC 1 v2.0 (algorithm), SEC 2 v2.0 (secp256k1), FIPS 186-4 D.1.2 (NIST curves), RFC 5903 (IKE official vectors — byte-exact in this tool).",
    ],
    aka: ["ECDH", "椭圆曲线密钥交换", "ECDH 共享密钥", "EC Diffie-Hellman", "椭圆曲线迪菲赫尔曼",
      "secp256k1 ECDH", "P-256 ECDH", "prime256v1 共享密钥", "ECDH key agreement", "曲线点乘共享",
      "ECDH shared secret", "elliptic curve Diffie-Hellman", "P-384 密钥交换", "P-521 密钥交换", "短魏尔斯特拉斯 ECDH"],
  },

  // ============ RSA-OAEP ============
  rsaOaepEnc: {
    what: "RSA-OAEP encryption — the standardized RSA padding scheme (PKCS#1 v2.2, RFC 8017 §7.1). Compared with the legacy PKCS#1 v1.5 padding, OAEP mixes the plaintext with a random seed through two rounds of MGF1 masking and is provably CCA-secure in the random-oracle model (OAEP = Optimal Asymmetric Encryption Padding). Modern CTF RSA challenges that give n,e,c, `openssl pkeyutl -encrypt` defaults, and WebCrypto RSA-OAEP all use this scheme.",
    principle:
      "**Encoding (EME-OAEP)**: the plaintext M is encoded into an $k$-byte EM ($k$ = modulus byte length):\n\n" +
      "$EM = 0x00 \\| maskedSeed \\| maskedDB$, where $DB = lHash \\| PS \\| 0x01 \\| M$ ($lHash$ is the hash of the empty label, PS is all-zero padding, 0x01 the separator byte).\n\n" +
      "Two masking rounds: $maskedDB = DB \\oplus MGF1(seed)$, $maskedSeed = seed \\oplus MGF1(maskedDB)$. The seed is $hLen$ random bytes.\n\n" +
      "**Encryption**: $C = EM^e \\bmod n$, output at fixed width $k$ bytes.\n\n" +
      "**Plaintext limit**: $k - 2hLen - 2$ bytes (190 for RSA-2048 + SHA-256); exceeding it raises a hard error — an OAEP constraint, not a tool limit.\n\n" +
      "**MGF1**: the mask generation function, $T = Hash(seed\\|I2OSP(i,4))$ concatenated and truncated; the hash is the same one chosen for OAEP (SHA-1/SHA-256). OpenSSL, WebCrypto and Java all use the \"OAEP hash = MGF1 hash\" convention by default, and this tool interoperates byte-exactly with them.",
    usage:
      "Encryption: enter the plaintext; give the public key as PEM (PUBLIC KEY/SPKI or RSA PUBLIC KEY/PKCS#1) or decimal n,e; pick SHA-1 (legacy interop) or SHA-256 (modern default).\n\n" +
      "Leave `seed` empty for system randomness (every ciphertext differs — correct behavior); supply a seed to make the ciphertext fully reproducible for cross-checking RFC/OpenSSL results.\n\n" +
      "The ciphertext is fixed-width k-byte hex; hand it to the \"RSA-OAEP decrypt\" op or to node:crypto / OpenSSL.\n\n" +
      "Decryption side: private key as PEM (PRIVATE KEY/PKCS#8 or RSA PRIVATE KEY/PKCS#1) or decimal n,e,d; the hash setting must match encryption.",
    examples: [
      { in: "attack at dawn (RSA-2048 + SHA-256 + fixed seed)", out: "ciphertext (256-byte hex) = …", desc: "same seed reproduces the same ciphertext byte-exactly; node:crypto publicEncrypt(RSA_PKCS1_OAEP_PADDING) matches" },
      { in: "中文明文·混合 123", out: "ciphertext decodable byte-exactly by node:crypto privateDecrypt", desc: "the UTF-8 byte stream enters EM whole, no charset transformation" },
      { in: "a 256-byte plaintext with RSA-2048", out: "error: plaintext exceeds the 190-byte limit", desc: "k-2hLen-2 = 256-64-2 = 190; hard error on overflow" },
    ],
    formulas: [
      { tex: "EM = 0x00 \\|\\| maskedSeed \\|\\| maskedDB,\\quad C = EM^e \\bmod n", caption: "EME-OAEP encoding + the RSAEP primitive" },
      { tex: "|M| \\le k - 2h_{Len} - 2", caption: "Plaintext length bound; 190 bytes for RSA-2048/SHA-256" },
    ],
    tips: [
      "Recognition: an RSA ciphertext whose length ≈ the modulus and whose decryption does not start with 0x00 0x02 (the v1.5 signature) is a candidate for OAEP; challenge wording like \"padding=oaep\", \"RSAES-OAEP\", \"sha256 padding\" all point here.",
      "\"OAEP decryption failed\" has four usual causes: wrong hash setting (SHA-1↔SHA-256), wrong key, truncated/corrupted ciphertext, or it is not OAEP at all (try the v1.5 op).",
      "For pen-and-paper challenges with c, n, e, d: recover $EM = c^d \\bmod n$ and inspect — 0x00‖maskedSeed‖maskedDB means OAEP. Manual unmasking needs MGF1; the decrypt op does it for you.",
      "Two encryptions of the same plaintext differ because the seed is random — by design, not a bug; reproducibility requires a fixed seed.",
      "OAEP and PKCS#1 v1.5 padding bytes are entirely different and incompatible; confirm the scheme before blaming the hash setting.",
      "Standards: RFC 8017 §7.1 (v2.2, carried over from RFC 3447); Bellare & Rogaway 1994. This tool was cross-verified byte-exactly against node:crypto (OpenSSL 3) in all four directions.",
    ],
    aka: ["RSA-OAEP 加密", "RSA OAEP", "OAEP 加密", "RSAES-OAEP", "RSA 公钥加密",
      "RSA-OAEP encrypt", "OAEP padding", "RSA 现代填充", "RSA 加密 sha256", "PKCS#1 v2.2 加密",
      "optimal asymmetric encryption padding", "RSA 加密（OAEP）", "RSA-OAEP-ENCRYPT", "MGF1 加密", "RSA 加密"],
  },

  rsaOaepDec: {
    what: "RSA-OAEP decryption — the decrypt direction of RSAES-OAEP (RFC 8017 §7.1.2): a private-key modular exponentiation recovers EM, then EME-OAEP decoding strips the masks, checks lHash and the separator byte, and returns the plaintext. Pairs with the \"RSA-OAEP encrypt\" op and interoperates with OpenSSL / WebCrypto / node:crypto at the same settings.",
    principle:
      "**Two steps**: ① RSADP: $EM = C^d \\bmod n$, restored at fixed width $k$; ② EME-OAEP decode: split maskedSeed and maskedDB, $seed = maskedSeed \\oplus MGF1(maskedDB)$, $DB = maskedDB \\oplus MGF1(seed)$, then check that $DB$ starts with $lHash$ (hash of the empty label), followed by zeros up to a 0x01 separator byte, after which the plaintext begins.\n\n" +
      "**Uniform error message**: every failure — lHash mismatch, missing 0x01, leading EM byte nonzero — reports the same \"OAEP decryption failed\". This follows RFC 8017 §7.1.2 and the Manger 2001 side-channel requirement (distinguishable errors give an attacker a byte-by-byte oracle). Expect the same sentence for all format failures and troubleshoot by changing parameters.\n\n" +
      "**Not the same as signature verification**: OAEP decryption applies $C^d$ (the private-key direction of encryption), unlike RSA signature verification's $S^e$. Look at the padding structure of the recovered bytes before choosing an op.",
    usage:
      "Enter the ciphertext hex (fixed width k); give the private key as PEM (PKCS#8/PKCS#1) or decimal n,e,d; set the same hash as the encrypting side.\n\n" +
      "Output shows both hex and UTF-8 views: binary plaintext (key bytes, another layer of ciphertext) reads from the hex line, readable text from the UTF-8 line.\n\n" +
      "Round-trip against \"RSA-OAEP encrypt\", or cross-verify with node:crypto in all four directions (the tool's verification script does exactly that).",
    examples: [
      { in: "output of node:crypto publicEncrypt (SHA-256)", out: "plaintext (UTF-8) = attack at dawn", desc: "OpenSSL interop decryption" },
      { in: "a valid ciphertext decoded with the SHA-1 setting", out: "error: OAEP decryption failed (uniform message)", desc: "hash mismatch and tampering share one message, per RFC 8017 side-channel design" },
      { in: "a 254-byte ciphertext with k=256", out: "error: ciphertext length must equal modulus byte length k = 256", desc: "length checked first; value ≥ n gets its own error" },
    ],
    formulas: [
      { tex: "EM = C^d \\bmod n", caption: "RSADP primitive, applied before OAEP decoding" },
      { tex: "M = DB[k - |M| :],\\quad DB = maskedDB \\oplus MGF1(seed)", caption: "After unmasking, the 0x01 separator locates the plaintext" },
    ],
    tips: [
      "The universal \"given d, find m\" flow: compute $m = c^d \\bmod n$ and inspect the bytes — 0x00‖maskedSeed‖maskedDB is OAEP, 0x00‖0x02‖PS‖0x00 is v1.5, bare data is textbook RSA.",
      "Troubleshooting \"OAEP decryption failed\": ① try the other hash setting ② confirm the ciphertext hex was not truncated/re-encoded ③ confirm the private key pairs with the encrypting public key ④ try the PKCS#1 v1.5 op.",
      "A single uniform error is deliberate: implementations that distinguish \"padding error\" from \"key error\" are exactly how Bleichenbacher/Manger oracles start.",
      "Standards: RFC 8017 §7.1.2; Manger 2001 (why errors are uniform). Four-direction interop with OpenSSL plus tamper/wrong-hash/wrong-key exception tests all green.",
    ],
    aka: ["RSA-OAEP 解密", "OAEP 解密", "RSA 解密", "RSAES-OAEP 解密", "RSA 私钥解密",
      "RSA-OAEP decrypt", "RSA d 求明文", "RSA c^d", "RSA 私钥还原", "RSA 解密 sha256",
      "RSA 私钥求明文", "RSA-OAEP-DECRYPT", "RSA ciphertext decrypt", "RSA 给 d 解密", "OAEP 去填充"],
  },

  // ============ HPKE ============
  hpkeSeal: {
    what: "HPKE encryption (Base mode) — RFC 9180 Hybrid Public Key Encryption, the 2024 IETF standard underpinning TLS Encrypted Client Hello (ECH) and MLS message encryption. It chains \"ephemeral key pair + KEM encapsulation + KDF derivation + AEAD encryption\" into one standard pipeline that performs public-key encryption in a single call. This tool implements the fixed suite DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + ChaCha20-Poly1305 — the RFC 9180 Appendix A.2 official vector suite.",
    principle:
      "**The three layers (§5)**:\n\n" +
      "① **KEM encapsulation**: the sender generates an ephemeral pair $(skE, pkE)$; $dh = X25519(skE, pkR)$; LabeledExtract/Expand (\"eae_prk\" → \"shared_secret\", domain string `KEM`‖0x0020) yields $shared\\_secret$; enc = pkE travels with the ciphertext.\n\n" +
      "② **KeySchedule**: with $shared\\_secret$ as ikm and info as context, psk_id_hash/info_hash build the key_schedule_context (first byte 0x00 in base mode); key (32B), base_nonce (12B) and exporter_secret are expanded from it. The KDF domain string is `HPKE`‖kem_id‖kdf_id‖aead_id.\n\n" +
      "③ **AEAD**: ChaCha20-Poly1305 encrypts the plaintext under key and base_nonce (seq=0), appending a 16-byte tag. Multi-packet sending increments the nonce per sequence number (this tool covers the single-packet case, nonce = base_nonce).\n\n" +
      "**Base mode**: the only authentication is \"encrypted to the public key\" (the recipient knows only the private-key holder could have addressed them); sender authentication requires PSK or Auth mode, which this tool does not implement (see the boundary note).",
    usage:
      "Encryption: enter the plaintext and the recipient's X25519 public key (32B hex, from the \"X25519 key generation\" op); info/aad optional (hex). Output: enc (=pkE, 32 bytes) and the ciphertext ct (plaintext + 16B tag).\n\n" +
      "Leave `skE` empty for randomness; supplying 32B hex reproduces the RFC 9180 A.2 vectors byte-exactly (for cross-checking).\n\n" +
      "Decryption side: pass enc, ct, info and aad unchanged to \"HPKE decrypt\" together with the recipient's private key. Any mismatch fails the tag check with an error.",
    examples: [
      { in: "RFC 9180 A.2 vector: skEm/pkRm/info all given, pt = 42656175… (Beauty is truth…)", out: "ct = 1c5250d8034e… (57 bytes)", desc: "enc=pkEm, key, base_nonce and ct all reproduce the official vector byte-exactly" },
      { in: "secret message (random skE)", out: "enc=… ct=…", desc: "a different enc each run is by design; fix skE to reproduce" },
      { in: "empty plaintext", out: "error: plaintext is empty", desc: "empty plaintext is meaningless; explicit error" },
    ],
    formulas: [
      { tex: "shared\\_secret = Expand(Extract(\\text{\"eae\\_prk\"}, dh), pk_E \\| pk_R)", caption: "KEM encapsulation core; dh = X25519(skE, pkR)" },
      { tex: "ct = \\mathrm{ChaCha20\\text{-}Poly1305.Seal}(key, base\\_nonce, aad, pt)", caption: "AEAD layer; nonce = base_nonce (seq=0)" },
    ],
    tips: [
      "Recognition: challenges mentioning \"hpke\", \"RFC 9180\", \"ECH\", \"Encrypted Client Hello\" or \"MLS encryption\", or handing you two separate hex blobs (enc/ct) plus an X25519 key pair, point to HPKE.",
      "enc and ct are a pair: substituting any other valid public key for enc breaks the tag — the KEM context binds pkE‖pkR.",
      "info binds the message to a protocol session; if the challenge names a constant string as info, convert it to hex and enter it.",
      "This suite is A.2 (ChaCha20-Poly1305); vectors from the AES-128-GCM suite (A.1) will not match — a suite difference, not an implementation error.",
      "Relation to other ops: the pipeline is the standard composition of three existing capabilities — X25519 (ECDH), HKDF and ChaCha20-Poly1305; you can reproduce it step by step with those ops.",
      "Standards: RFC 9180 (§4 KEM / §5.1 KeySchedule / §5.1.3 Seal / §7 suite table); vectors from the official CFRG test-vectors.json (mode=0, kem_id=32, kdf_id=1, aead_id=3), byte-exact in this tool.",
    ],
    aka: ["HPKE", "HPKE 加密", "RFC 9180", "混合公钥加密", "hybrid public key encryption",
      "HPKE seal", "HPKE base mode", "ECH 加密", "MLS 消息加密", "DHKEM X25519",
      "HPKE ChaCha20", "HPKE 封装", "RFC9180", "HPKE encrypt", "加密组套件"],
  },

  hpkeOpen: {
    what: "HPKE decryption (Base mode) — the recipient side of RFC 9180 (Open): re-derive shared_secret from enc (the sender's ephemeral public key) and your own private key, replay the KeySchedule to recover key/nonce, verify the ChaCha20-Poly1305 tag and release the plaintext. Same suite as \"HPKE encrypt\": DHKEM(X25519) + HKDF-SHA256 + ChaCha20-Poly1305.",
    principle:
      "**Decap (§4.1)**: $dh = X25519(skR, enc)$; kem_context = enc‖pkR (pkR derived from the private key); the same LabeledExtract(\"eae_prk\")/LabeledExpand(\"shared_secret\") as the sender yields the identical shared_secret — once again thanks to the X25519 associativity.\n\n" +
      "**KeySchedule replay**: identical inputs (shared_secret, info, mode=0) produce identical key/base_nonce. AEAD authentication guarantees that a one-bit change to info/aad/key, the ciphertext or the tag fails the check.\n\n" +
      "**Failure semantics**: a failed tag check reports one uniform \"decryption failed\" — it does not say whether the key, enc, info/aad or ciphertext was wrong, matching AEAD semantics and denying attackers distinguishability.",
    usage:
      "Four inputs: enc (32B hex), the ciphertext ct (hex, including the trailing 16-byte tag), the recipient private key skR (32B hex), and info/aad matching the encrypting side (may be empty). Output: plaintext in both hex and UTF-8 views.\n\n" +
      "Troubleshooting order: first confirm enc/ct were not truncated or re-encoded, then compare info/aad against the encrypting side item by item, finally confirm skR pairs with the pkR used for encryption.",
    examples: [
      { in: "output of the encrypt op with its skR", out: "plaintext (UTF-8) = secret message", desc: "standard round trip" },
      { in: "the same inputs with enc changed by one bit", out: "error: HPKE decryption failed: AEAD tag check failed", desc: "enc participates in kem_context; any change fails" },
      { in: "an info different from the encrypting side", out: "error: HPKE decryption failed (uniform message)", desc: "info feeds the KeySchedule; a mismatch derives a different key" },
    ],
    formulas: [
      { tex: "dh = X25519(sk_R, enc),\\quad shared\\_secret = \\mathrm{ExtractAndExpand}(dh, enc \\| pk_R)", caption: "Decap lands on the same shared_secret as Encap" },
      { tex: "pt = \\mathrm{ChaCha20\\text{-}Poly1305.Open}(key, base\\_nonce, aad, ct)", caption: "Tag failure fails the whole operation; no partial decryption" },
    ],
    tips: [
      "The input checklist for HPKE challenges: enc, ct, skR (or skE+pkR for cross-checking), info, aad — challenges usually supply all of them; fill in the empty default for whatever is missing.",
      "Tag fails but everything looks right: check whether the hex was case-normalized, stripped of whitespace or 0x prefixes (this tool tolerates those variants), and whether the tag was split out of ct.",
      "Challenges giving both skE and skR: reproduce ct with the encrypt op at that fixed skE and compare — a fast way to localize which input disagrees.",
      "This tool covers the single-packet case (seq=0); for multiple ct values only the first is directly decryptable here — later nonces increment and this is stated honestly rather than faked.",
      "Standards: RFC 9180 §5.1.4 Open / §4.1 Decap; vectors as in the encrypt op (official CFRG json); round-trip and exception tests all green.",
    ],
    aka: ["HPKE 解密", "HPKE open", "RFC 9180 解密", "HPKE Open", "HPKE decrypt",
      "HPKE 收方", "混合公钥解密", "HPKE ChaCha 解密", "DHKEM 解封装", "HPKE 解封装",
      "hybrid public key decryption", "HPKE base decrypt", "ECH 解密", "MLS 解密", "HPKE-OPEN"],
  },
};
