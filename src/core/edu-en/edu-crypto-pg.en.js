/*
 * edu-crypto-pg.en.js — English edu shard (T320, crypto expansion batch).
 *
 * Covers 18 ops:
 *   crypto: shamir, schnorr, ecdsaReuseK, rabin, x25519, ed25519, paillier, scrypt
 *   modern: a51, magma, present
 *   hash: siphash, blake3, whirlpool, pearson
 *   analysis: xorshiftRecover
 *   text: yenc, binhex
 *
 * Pure data, no side effects, no import, no register. Merged in eduContent.js.
 * EduEntry format per the eduContent.js header comment contract.
 */

export default {
  // ============ crypto: Shamir's Secret Sharing ============
  shamir: {
    what: 'Shamir\'s Secret Sharing (SSS) — split a secret into n shares such that any k shares can reconstruct it, while k-1 shares reveal nothing (information-theoretic security). Operates in GF(2^8) with polynomial f(x) = s + a1*x + a2*x^2 + ... + a_{k-1}*x^{k-1}.',
    principle:
      'Adi Shamir\'s 1979 paper How to Share a Secret: the secret is encoded as the constant term of a degree-(k-1) polynomial over GF(2^8) with irreducible polynomial 0x11B (the AES field).\n' +
      '' +
      'Split (encode): For each secret byte s, generate a random polynomial f(x) = s + a1*x + a2*x^2 + ... + a_{k-1}*x^{k-1} with coefficients a_i drawn from crypto.getRandomValues. Evaluate at x = 1,2,...,n to produce n shares, each of the form xx:hex where xx is the x-coordinate in hex.\n' +
      '' +
      'Combine (decode): Given at least k shares (x_i, y_i), use Lagrange interpolation to recover f(0) = s for each byte position. All operations in GF(2^8) with multiplication via exp/log lookup tables and division via gfDiv(a,b) = gfMul(a, gfInv(b)).\n' +
      '' +
      'Information-theoretically secure: fewer than k shares provide zero information about the secret, regardless of computational power. Used in HashiCorp Vault, HSM, and multi-party key management.\n',
    usage: 'Encode: Enter the secret text, set n (total shares, 2..255) and k (threshold, >= 2, <= n). Output is n lines of xx:hex shares. Decode: Paste >= k shares (lines in xx:hex format), click Decode. Lines starting with # are ignored. The x values must be hex bytes (01..ff), and all shares must be the same length.',
    examples: [
      { in: 'flag{s}', param: 'n=5, k=3', out: '# shamir k=3 n=5 (any 3 shares suffice)\n(this line + 5 hex shares: 01:..., 02:..., ..., 05:...)', desc: 'split the secret into 5 shares; outputs are randomized per run with crypto random coefficients — any 3 distinct shares will reconstruct flag{s} via Lagrange interpolation' },
    ],
    formulas: [
      { tex: 'f(x) = s + a_1 x + a_2 x^2 + \\cdots + a_{k-1} x^{k-1} \\pmod{0x11B}', caption: 'Shamir polynomial over GF(2^8); s is the secret byte, a_i are random coefficients' },
      { tex: 's = \\sum_{i=1}^k y_i \\cdot \\ell_i(0),\\quad \\ell_i(x) = \\prod_{j \\neq i} \\frac{x - x_j}{x_i - x_j}', caption: 'Lagrange interpolation at x=0 recovers the constant term' },
    ],
    tips: [
      'Each run of split produces different share values (random coefficients), but the same secret is always recoverable from any k of those shares.',
      'The first output line # shamir k=... n=... is a comment — decode ignores it automatically, so you can paste it verbatim.',
      'x coordinates are bytes (01..ff); share hex length is the same for all shares of a given secret. Mismatched lengths mean shares from different secrets.',
      'In CTF, if given a list of shares with a k value, just paste them into the decode input and click Decode.',
      'GF(2^8) field: reduction polynomial 0x11B, generator 0x03. The same field as AES SubBytes, so the math is well-tested in hardware.',
    ],
    aka: [
      'shamir',
      'Shamir\'s Secret Sharing',
      'SSS',
      '(k,n) threshold scheme',
      'secret splitting',
      'key sharding',
      'Lagrange interpolation',
      '秘密共享',
      '门限方案',
      'Shamir秘密共享',
      'threshold secret sharing',
      'polynomial secret sharing',
      'Shamir 1979',
      'information-theoretic security',
      '分片还原',
    ],
  },
  // ============ crypto: Schnorr signature / verify / attack ============
  schnorr: {
    what: 'Schnorr signature scheme — a classic digital signature based on the discrete logarithm problem. secp256k1 curve with inline SHA-256. Supports key generation, signing, verification, and nonce-reuse private-key recovery.',
    principle:
      'Setup: Private key d in [1, n-1], public key P = d*G on secp256k1.\n' +
      '' +
      'Signing (classic Schnorr, not BIP340):\n' +
      '1. Generate random nonce k, compute R = k*G\n' +
      '2. Challenge e = H(R_x || P_x || m) mod n (SHA-256)\n' +
      '3. Signature s = (k + e*d) mod n\n' +
      '4. Output (e, s)\n' +
      '' +
      'Verification: Compute R\' = s*G - e*P, then e\' = H(R\'_x || P_x || m) mod n. Accept if e\' = e.\n' +
      '' +
      'Nonce-reuse attack: If the same nonce k signs two different messages m1 != m2:\n' +
      's1 = k + e1*d, s2 = k + e2*d\n' +
      '=> d = (s1 - s2) / (e1 - e2) mod n, k = s1 - e1*d mod n\n' +
      '' +
      'This is the Schnorr counterpart to ECDSA\'s k-reuse attack. secp256k1 field arithmetic is shared with the ecdsaReuseK module.\n',
    usage: 'keygen: Generate a key pair. Priv key can be left blank for random generation. sign: Provide private key (64 hex) and message (text or hex). Optionally specify a fixed nonce k for testing reuse attacks. verify: Provide public key (Px, Py), challenge e, signature s, and the message. attack: Enter two signatures (e1, s1) and (e2, s2) — recovers private key d and nonce k.',
    examples: [
      { in: '(random message)', param: 'mode=sign, priv=(hex)', out: '签名:\ne = (hex, 64 chars)\ns = (hex, 64 chars)', desc: 'sign mode produces a 64-byte signature (e||s) over the message; self-verify passes automatically' },
      { in: '(any)', param: 'mode=attack, e1/s1/e2/s2=(hex)', out: '恢复私钥 d = (hex)\n恢复 nonce k = (hex)', desc: 'attack mode: given two signatures from the same nonce, recovers both d and k instantly' },
    ],
    formulas: [
      { tex: 'e = H(R_x \\parallel P_x \\parallel m) \\bmod n,\\quad s = (k + e \\cdot d) \\bmod n', caption: 'Schnorr signature generation' },
      { tex: 'd = (s_1 - s_2) / (e_1 - e_2) \\bmod n', caption: 'Nonce reuse: private key recovery from two signatures sharing the same k' },
    ],
    tips: [
      'The Schnorr scheme here uses the classic (e, s) format for teaching clarity; BIP340 (Bitcoin Taproot) uses a (R, s) variant.',
      'Nonce reuse is fatal: two signatures with the same k reveals the private key. Never reuse nonces in production.',
      'Fixed nonce mode is for CTF/demo only. In practice, nonces must be unpredictable and unique per signature.',
      'In CTF, if a challenge gives two (e, s) pairs from the same key with different messages, use the attack mode to recover d.',
    ],
    aka: [
      'schnorr',
      'Schnorr Signature',
      'Schnorr sign',
      'Fiat-Shamir',
      'ZKP',
      'nonce reuse',
      'k reuse attack',
      'discrete log signature',
      'Schnorr 签名',
      'Schnorr验签',
      'Schnorr攻击',
      'secp256k1签名',
      '经典Schnorr',
      'Schnorr identification',
      'zero-knowledge proof',
    ],
  },
  // ============ crypto: ECDSA nonce reuse attack ============
  ecdsaReuseK: {
    what: 'ECDSA nonce (k) reuse attack — given two ECDSA signatures sharing the same random nonce k (hence same r), recovers the private key d and nonce k using pure modular arithmetic. Supports secp256k1, secp256r1 (NIST P-256), and custom curves.',
    principle:
      'ECDSA signing: For message hash z, random nonce k, private key d: r = (k*G)_x mod n, s = k^{-1}(z + r*d) mod n.\n' +
      '' +
      'Attack: If two signatures reuse the same k (so r1 = r2 = r):\n' +
      's1 = k^{-1}(z1 + r*d), s2 = k^{-1}(z2 + r*d)\n' +
      'Subtracting: s1 - s2 = k^{-1}(z1 - z2) mod n\n' +
      '=> k = (z1 - z2) * (s1 - s2)^{-1} mod n\n' +
      'Back-substituting: d = (s1*k - z1) * r^{-1} mod n\n' +
      '' +
      'ECDSA\'s s value has a low-s normalization ambiguity (both s and n-s are valid). This tool tries all 4 sign combinations. If the public key Qx/Qy is provided, it automatically verifies d*G = Q to pick the correct combination. Built-in curve parameters for secp256k1 and secp256r1.\n',
    usage: 'Enter anything in the input box (not directly used). Parameters: select the curve, provide r (common to both signatures), s1, s2, z1 (hash of message 1 as integer), z2 (hash of message 2 as integer). All values in decimal or 0x-hex. Optional: Qx/Qy for automatic verification and sign disambiguation.',
    examples: [
      { in: '(placeholder)', param: 'curve=secp256k1, r=..., s1=..., s2=..., z1=..., z2=...', out: 'k = (value)\nd = (value)\n符号组合命中 (+s1,+s2)', desc: 'attack recovers both k and d from two signatures; provides candidate results for all 4 s-sign combinations' },
    ],
    formulas: [
      { tex: 'k = (z_1 - z_2) \\cdot (s_1 - s_2)^{-1} \\bmod n', caption: 'Recover the nonce k from two signatures with the same r' },
      { tex: 'd = (s_1 \\cdot k - z_1) \\cdot r^{-1} \\bmod n', caption: 'Recover the private key d after k is known' },
    ],
    tips: [
      'The attack only works if both signatures use the exact same k (same r value). If r differs, the nonces are different.',
      'In CTF challenges, you will typically be given r, s1, s2, z1, z2 directly. z is the hash of the message as an integer.',
      'If the recovered d does not verify against the expected public key, try the alternate s-sign combinations listed at the bottom.',
      'Custom curve mode lets you input any elliptic curve by providing n, p, a, Gx, Gy.',
      'This tool is for recovery/analysis only; it does not generate ECDSA signatures.',
    ],
    aka: [
      'ecdsaReuseK',
      'ECDSA',
      'nonce reuse',
      'k reuse attack',
      'private key recovery',
      'weak nonce',
      'ECDSA nonce leakage',
      'ECDSA重放攻击',
      'k值重用',
      'ECDSA私钥恢复',
      'random nonce attack',
      'r重复攻击',
      'secp256k1攻击',
      '签名重放',
      'Sony PS3 attack',
    ],
  },
  // ============ crypto: Rabin cryptosystem ============
  rabin: {
    what: 'Rabin cryptosystem — a public-key encryption scheme based on the difficulty of computing modular square roots. Encryption: c = m^2 mod n. Decryption produces four candidate roots, disambiguated by a magic-number suffix (0xAB 0xCD). Requires p,q both congruent to 3 mod 4.',
    principle:
      'Rabin (1979) is provably as hard as integer factorization. Key generation: choose two primes p,q such that p = q = 3 mod 4, set n = p*q.\n' +
      '' +
      'Encryption: c = m^2 mod n where m < n.\n' +
      '' +
      'Decryption (CRT-based): Compute square roots modulo p and q using the closed form for Blum primes:\n' +
      'm_p = c^{(p+1)/4} mod p, m_q = c^{(q+1)/4} mod q\n' +
      'Use extended Euclidean algorithm to find y_p, y_q such that y_p*p + y_q*q = 1, then combine via CRT to get 4 roots.\n' +
      '' +
      'Four roots always exist. To disambiguate, this implementation appends two magic bytes 0xAB 0xCD to the plaintext before encryption. Decryption selects the root whose trailing bytes match the magic number.\n',
    usage: 'Text mode: Enter text; the tool appends 0xAB 0xCD internally. Int mode: Enter a decimal integer m. Parameters: p and q (both primes = 3 mod 4). Default demo primes: p=2147483647 (2^31-1), q=2305843009213693951 (2^61-1). Encode encrypts, decode decrypts.',
    examples: [
      { in: '42', param: 'inputMode=int, p=2147483647, q=2305843009213693951', out: 'c = m^2 mod n = 1764\nc (hex) = 0x6e4', desc: 'integer mode: 42^2 = 1764 which is less than n, so the ciphertext equals the square literally' },
      { in: 'Hello', param: 'inputMode=text', out: 'c = (large integer)\nc (hex) = 0x...', desc: 'text mode: plaintext + 0xAB 0xCD suffix converted to BigInt, then squared mod n; decode recovers Hello' },
    ],
    formulas: [
      { tex: 'c = m^2 \\bmod n,\\quad n = p \\cdot q,\\quad p \\equiv q \\equiv 3 \\pmod{4}', caption: 'Rabin encryption: squaring modulo n' },
      { tex: 'm_p = c^{(p+1)/4} \\bmod p,\\quad m_q = c^{(q+1)/4} \\bmod q', caption: 'CRT square root extraction for Blum primes (p,q = 3 mod 4)' },
    ],
    tips: [
      'Rabin encryption is deterministic (no randomness), making it vulnerable to chosen-plaintext attacks in pure form.',
      'The 0xAB 0xCD magic suffix is this tool\'s convention for disambiguation — standard Rabin requires an external redundancy scheme.',
      'In CTF, if you see c = m^2 mod n with p, q given, this is a Rabin problem. Just plug p and q into decode.',
      'The default demo primes are Mersenne primes, chosen for fast arithmetic. Real applications use much larger primes.',
    ],
    aka: [
      'rabin',
      'Rabin cryptosystem',
      'quadratic residue',
      'modular square root',
      'Rabin encryption',
      'public key',
      'Rabin密码',
      '平方剩余',
      'Rabin公钥',
      'Michael Rabin',
      'Rabin 1979',
      'CRT开方',
      '模n平方根',
      '四根消歧',
      'Blum prime',
    ],
  },
  // ============ crypto: X25519 key exchange ============
  x25519: {
    what: 'X25519 — Elliptic-curve Diffie-Hellman (ECDH) on Curve25519, the Montgomery curve v^2 = u^3 + 486662*u^2 + u over GF(2^255-19). RFC 7748 compliant, uses x-only scalar multiplication with the Montgomery ladder.',
    principle:
      'Curve: Montgomery form v^2 = u^3 + 486662*u^2 + u, prime p = 2^255 - 19.\n' +
      '' +
      'Clamping (RFC 7748 Section 5): Before use, private keys are clamped: clear the 3 low bits, clear the highest bit, set the second-highest bit. This ensures the scalar is a multiple of cofactor 8.\n' +
      '' +
      'Montgomery ladder: Scalar multiplication uses the constant-time Montgomery ladder. At each bit of the scalar, compute a differential addition and doubling step.\n' +
      '' +
      'Base point: u = 9 (the smallest positive u-coordinate for the base point).\n' +
      '' +
      'Key exchange: Each party generates a private key, computes public key as X25519(clamp(sk), 9). Shared secret = X25519(sk_A, pk_B) = X25519(sk_B, pk_A).\n',
    usage: 'Three modes: keygen — generate a key pair (priv blank = random). shared_from_privs — given both private keys A and B, verify the shared secret matches from both sides. shared_priv_pub — given your private key and the other party\'s public key, compute the shared secret. All keys are 32-byte hex strings (64 hex chars).',
    examples: [
      { in: '(n/a)', param: 'mode=keygen, priv=(blank)', out: '私钥 (32B, hex) = (random 64 hex)\n公钥 (32B, hex) = (computed 64 hex)', desc: 'generates a Curve25519 key pair; public key = X25519(clamp(priv), base point 9)' },
      { in: '(n/a)', param: 'mode=shared_from_privs, privA/privB=(hex)', out: '共享 K (A*pkB) = (hex)\n共享 K (B*pkA) = (hex)\n两侧一致 (ECDH 成立)', desc: 'verifies the ECDH property: both sides compute the same shared secret' },
    ],
    formulas: [
      { tex: 'v^2 = u^3 + 486662 u^2 + u \\pmod{2^{255} - 19}', caption: 'Curve25519 Montgomery curve equation' },
      { tex: 'X25519(k, u) = \\text{MontgomeryLadder}(clamp(k), u)', caption: 'X25519 x-only scalar multiplication per RFC 7748' },
    ],
    tips: [
      'X25519 keys are exactly 32 bytes (64 hex). Any shorter/longer input will be rejected.',
      'Clamping is automatic: you don\'t need to pre-process the private key.',
      'The shared secret is 32 bytes of raw key material. In practice, feed it through a KDF like HKDF first.',
      'Curve25519 was designed for speed and side-channel resistance. The Montgomery ladder is naturally constant-time.',
      'In CTF, if given a Curve25519 public key and private key hint, use shared_priv_pub mode.',
    ],
    aka: [
      'x25519',
      'X25519',
      'Curve25519',
      'RFC 7748',
      'ECDH',
      'DH key exchange',
      'Montgomery curve',
      'X25519密钥交换',
      'Curve25519 ECDH',
      'djb curve',
      'Bernstein curve',
      'x-only scalar multiplication',
      'Montgomery ladder',
      '25519',
      'Elliptic-curve Diffie-Hellman',
    ],
  },
  // ============ crypto: Ed25519 signature ============
  ed25519: {
    what: 'Ed25519 — a high-speed digital signature scheme using the twisted Edwards curve -x^2 + y^2 = 1 + d*x^2*y^2 over GF(2^255-19), with SHA-512 as the internal hash. RFC 8032 compliant.',
    principle:
      'Curve: Twisted Edwards form, d = -121665/121666 mod p, p = 2^255 - 19.\n' +
      '' +
      'Key generation: h = SHA-512(sk), a = clamp(h_{0:32}), prefix = h_{32:64}. Public key A = encodePoint(a*B).\n' +
      '' +
      'Signing: r = SHA-512(prefix || M) mod L, R = r*B, k = SHA-512(R || A || M) mod L, S = (r + k*a) mod L. Signature = R || S (64 bytes).\n' +
      '' +
      'Verification: Check S*B = R + k*A in extended projective coordinates.\n' +
      '' +
      'Clamping is identical to X25519. The Ed25519 curve is birationally equivalent to Curve25519.\n',
    usage: 'Three modes: keygen — generate key pair (priv blank = random). sign — sign a message (UTF-8 text or hex bytes) with your private key. verify — check a signature given public key, message, and 64-byte signature. All keys are hex: priv/pub 32 bytes (64 hex), signature 64 bytes (128 hex).',
    examples: [
      { in: 'Hello, Ed25519!', param: 'mode=sign, priv=(64 hex), msgMode=text', out: '签名 (64B) = (128 hex chars)\n自检验签: pass', desc: 'signs a message and self-verifies; output includes the public key derived from the private key' },
      { in: 'Hello, Ed25519!', param: 'mode=verify, pub=(64 hex), sig=(128 hex)', out: '验签通过', desc: 'verifies a signature; returns pass or fail' },
    ],
    formulas: [
      { tex: '-x^2 + y^2 = 1 + d \\cdot x^2 y^2 \\pmod{2^{255} - 19}', caption: 'Ed25519 twisted Edwards curve equation' },
      { tex: 'S = (r + k \\cdot a) \\bmod L,\\quad k = H(R \\parallel A \\parallel M)', caption: 'Ed25519 signature; r is deterministic from hash(prefix || M)' },
    ],
    tips: [
      'Ed25519 signatures are deterministic: nonce r is derived from SHA-512 hash of private key prefix and message. No randomness, so nonce reuse is impossible by design.',
      'Ed25519 is one of the fastest elliptic-curve signature schemes, with 64-byte signatures and 32-byte keys.',
      'The same 32-byte seed can generate both an Ed25519 signing key and an X25519 DH key (same curve birationally).',
      'In CTF, Ed25519 challenges typically ask you to verify a signature or find a flaw in a custom implementation.',
    ],
    aka: [
      'ed25519',
      'Ed25519',
      'EdDSA',
      'RFC 8032',
      'twisted Edwards',
      'Edwards curve signature',
      'high-speed signature',
      'Ed25519签名',
      'EdDSA签名',
      'Bernstein EdDSA',
      'deterministic signature',
      'Edwards-curve DSA',
      'SHA-512 EdDSA',
      'Curve25519签名',
    ],
  },
  // ============ crypto: Paillier homomorphic encryption ============
  paillier: {
    what: 'Paillier cryptosystem — an additive homomorphic public-key encryption scheme. The fundamental property: E(m1) * E(m2) = E(m1 + m2) and E(m)^k = E(k*m). Based on the composite residuosity class problem.',
    principle:
      'Pascal Paillier (1999), from Public-Key Cryptosystems Based on Composite Degree Residuosity Classes:\n' +
      '' +
      'Key generation: Choose two large primes p, q. n = p*q, lambda = lcm(p-1, q-1). Standard choice g = n + 1. mu = L(g^lambda mod n^2)^{-1} mod n where L(x) = (x-1)/n.\n' +
      '' +
      'Encryption: c = g^m * r^n mod n^2, with random r coprime to n.\n' +
      '' +
      'Decryption: m = L(c^lambda mod n^2) * mu mod n.\n' +
      '' +
      'Homomorphic addition: E(m1) * E(m2) mod n^2 = E(m1 + m2 mod n).\n',
    usage: 'Five modes: demo — full walkthrough: generates 64-bit key, encrypts 42 and 100, homomorphically adds them, decrypts to 142. keygen — generate keys. encrypt — encrypt integer m. decrypt — decrypt ciphertext. add — input two ciphertexts separated by comma/space, output homomorphic sum.',
    examples: [
      { in: '(n/a)', param: 'mode=demo', out: 'm1 = 42, m2 = 100\nE(m1)*E(m2) mod n^2 = (ciphertext)\n解密 = 142  (equals m1+m2)', desc: 'full demo: encrypts two values, multiplies ciphertexts, decrypts to verify the sum' },
      { in: '42', param: 'mode=encrypt, n=..., g=...', out: '密文 c = (large integer)', desc: 'encrypts integer 42 with the given public key; ciphertext is randomized' },
    ],
    formulas: [
      { tex: 'c = g^m \\cdot r^n \\bmod n^2', caption: 'Paillier encryption; r is random coprime to n for semantic security' },
      { tex: 'D(E(m_1) \\cdot E(m_2) \\bmod n^2) = m_1 + m_2 \\bmod n', caption: 'Additive homomorphic property' },
    ],
    tips: [
      'Paillier is additively homomorphic, not multiplicatively. You can add encrypted numbers but cannot multiply them.',
      'Each encryption uses a fresh random r, so encrypting the same plaintext twice produces different ciphertexts.',
      'The demo mode uses a tiny 64-bit key for speed; real applications use 2048+ bits.',
      'In CTF, Paillier challenges often involve computing a function on encrypted data using the homomorphic property.',
    ],
    aka: [
      'paillier',
      'Paillier',
      'homomorphic encryption',
      'additive HE',
      'Paillier cryptosystem',
      'semi-homomorphic',
      'Paillier同态加密',
      '加法同态',
      'Pascal Paillier',
      'composite residuosity',
      'Paillier 1999',
      'PHE',
      '部分同态',
      '同态密码',
      '隐私计算',
    ],
  },
  // ============ modern: A5/1 stream cipher ============
  a51: {
    what: 'A5/1 — the GSM voice-privacy stream cipher, using three Linear Feedback Shift Registers (LFSRs) of lengths 19, 22, and 23 bits with majority-based irregular clocking. A 64-bit session key Kc and a 22-bit frame number initialize the state.',
    principle:
      'Based on Briceno/Goldberg/Wagner\'s pedagogical implementation (1998):\n' +
      '' +
      'Three LFSRs: R1: 19 bits, taps 13/16/17/18, clocking bit 8, output bit 18. R2: 22 bits, taps 20/21, clocking bit 10, output bit 21. R3: 23 bits, taps 7/20/21/22, clocking bit 10, output bit 22.\n' +
      '' +
      'Majority clocking: At each step, compute majority of the three clocking bits. Only registers whose clocking bit equals the majority are shifted. This irregular clocking provides nonlinearity.\n' +
      '' +
      'Key loading: 1) Zero all registers. 2) 64 cycles: force-clock all three, XOR one key bit into LSB (key bits LSB-first per byte). 3) 22 cycles: force-clock all three, XOR one frame bit. 4) 100 cycles: majority-clock, discard output (mixing).\n' +
      '' +
      'Encoding and decoding are symmetric: ciphertext = plaintext XOR keystream.\n',
    usage: 'Encode: Enter plaintext, provide key Kc (16 hex chars = 64 bits) and frame number (decimal or 0x-hex, 22-bit). Output is hex ciphertext. Decode: Enter hex ciphertext with the same key and frame to recover the plaintext. Self-inverse: encode and decode use identical XOR operations.',
    examples: [
      { in: 'Hello', param: 'key=0f0e0d0c0b0a0908, frame=000000', out: '4c1049ee05', desc: 'verified test vector: key=0f0e0d0c0b0a0908 (64-bit), frame=0, Hello (5 bytes) produces 5-byte keystream XOR result' },
    ],
    formulas: [
      { tex: '\\text{output} = \\text{parity}(R1 \\land \\text{R1OUT}) \\oplus \\text{parity}(R2 \\land \\text{R2OUT}) \\oplus \\text{parity}(R3 \\land \\text{R3OUT})', caption: 'A5/1 keystream bit = XOR of three LFSR output bits' },
    ],
    tips: [
      'A5/1 is self-inverse: the same operation encrypts and decrypts. Feed hex ciphertext to decode with the same key/frame.',
      'Key must be exactly 16 hex characters (64 bits). Shorter keys are zero-padded on the left.',
      'Frame number range is 0..2^22-1 (4,194,303). Enter as decimal or 0x-hex.',
      'In CTF, A5/1 challenges often provide the key and frame, requiring you to decrypt a GSM-like message.',
      'A5/1 is cryptographically broken (real-time attacks since 2000s), but still appears as a classic stream cipher exercise.',
    ],
    aka: [
      'a51',
      'A5/1',
      'GSM encryption',
      'LFSR',
      'majority clocking',
      'GSM A5/1',
      'A5/1流密码',
      'GSM语音加密',
      'Briceno Goldberg Wagner',
      'A5',
      'GSM cipher',
      'cellular encryption',
      'stream cipher',
      'LFSR-based cipher',
      '移动通信加密',
    ],
  },
  // ============ modern: GOST Magma block cipher ============
  magma: {
    what: 'Magma (GOST R 34.12-2015) — the Russian Federation standard block cipher, modernization of GOST 28147-89. 64-bit block, 256-bit key, 32-round Feistel network using the id-tc26-gost-28147-param-Z S-box set.',
    principle:
      'Structure: 32-round Feistel network on a 64-bit block split into two 32-bit halves (a1, a0).\n' +
      '' +
      'Round function g[k](a): t((a + k) mod 2^32) <<< 11. The t-transform splits the 32-bit word into 8 nibbles, passes each through one of 8 different 4-bit S-boxes (nibble 0 = lowest 4 bits), and recombines. S-box set: id-tc26-gost-28147-param-Z.\n' +
      '' +
      'Key schedule: The 256-bit key is split into 8 subkeys K1..K8 (each 32 bits). Rounds 1-24 use K1..K8 repeated 3 times. Rounds 25-32 use K8..K1 in reverse.\n' +
      '' +
      'Self-check on load: verifies t(0xfdb97531) = 0x2a196f34.\n',
    usage: 'Both encode and decode operate on hex data. Encode: Enter plaintext hex (must be multiple of 16 hex = 8 bytes), provide 256-bit key (64 hex chars). Output is hex ciphertext (ECB mode). Decode: Enter hex ciphertext with the same key to recover plaintext. Multi-block ECB supports any multiple of 16 hex characters.',
    examples: [
      { in: 'fedcba9876543210', param: 'key=ffeeddccbbaa99887766554433221100f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff', out: '4ee901e5c2d8ca3d', desc: 'GOST R 34.12-2015 Appendix A.2 official test vector' },
    ],
    formulas: [
      { tex: 'g[k](a) = t((a \\boxplus k) \\bmod 2^{32}) \\lll 11', caption: 'Magma round function: modular addition, table lookup, then 11-bit left rotation' },
    ],
    tips: [
      'Magma/GOST uses 64-bit blocks (8 bytes). Plaintext/ciphertext must be multiples of 16 hex chars. ECB mode does not pad.',
      'The S-box set is the standard Z-parameter set from the 2015 Russian standard.',
      'Look for 64 hex character keys and 16 hex character blocks as the telltale signature.',
      'In CTF, Magma/GOST is common in Russian/Eastern European challenges.',
    ],
    aka: [
      'magma',
      'Magma',
      'GOST',
      'GOST 28147-89',
      'Russian encryption',
      'GOST block cipher',
      'Feistel',
      'GOST R 34.12-2015',
      '俄罗斯加密',
      'Magma密码',
      'GOST加密',
      '俄联邦标准',
      'id-tc26',
      'param-Z',
      'Kuznyechik companion',
    ],
  },
  // ============ modern: PRESENT lightweight block cipher ============
  present: {
    what: 'PRESENT — an ultra-lightweight block cipher (Bogdanov et al. 2007, CHES; ISO/IEC 29192-2). 64-bit block, 80 or 128-bit key, 31-round SPN designed for resource-constrained devices (RFID, IoT, sensors).',
    principle:
      'Structure: 31 rounds of SPN plus a final key XOR (round key 32). Each round: 1) addRoundKey: XOR state with round key. 2) sBoxLayer: Apply 4-bit S-box {C,5,6,B,9,0,A,D,3,E,F,8,4,7,1,2} to all 16 nibbles. 3) pLayer: Bit permutation P(i) = (16*i) mod 63 for i=0..62, P(63)=63.\n' +
      '' +
      'Key schedule (PRESENT-80): 80-bit key register. Round key = top 64 bits. Rotate left 61 bits, S-box top 4 bits, XOR round counter into bits 19..15.\n' +
      'Key schedule (PRESENT-128): Similar with 128-bit register.\n' +
      '' +
      'Self-check: PRESENT-80 all-zero key + all-zero plaintext = 5579c1387b228445.\n',
    usage: 'Select key size (80 or 128 bits), provide key as hex (20 hex for 80-bit, 32 hex for 128-bit). Input/output is hex in 8-byte (16 hex) blocks. Encode encrypts, Decode decrypts. ECB mode supports multiple blocks.',
    examples: [
      { in: '0000000000000000', param: 'keyBits=80, key=00000000000000000000', out: '5579c1387b228445', desc: 'official test vector: PRESENT-80 all-zero key and plaintext' },
    ],
    formulas: [
      { tex: 'P(i) = (16 \\cdot i) \\bmod 63\\;(i = 0..62),\\quad P(63) = 63', caption: 'PRESENT bit permutation layer' },
    ],
    tips: [
      'PRESENT is deliberately simple: one 4-bit S-box repeated 16 times + wiring permutation. Under 1000 gate equivalents.',
      '64-bit block size limits safe data volumes (birthday bound ~32 GB).',
      'Key format is strict: exactly 20 hex for PRESENT-80, 32 hex for PRESENT-128.',
      'In CTF, PRESENT challenges are usually straightforward: given key and ciphertext, just decode.',
    ],
    aka: [
      'present',
      'PRESENT',
      'lightweight cipher',
      'SPN',
      'IoT encryption',
      'ISO 29192',
      'PRESENT轻量密码',
      '轻量分组密码',
      'Bogdanov PRESENT',
      'PRESENT-80',
      'PRESENT-128',
      'RFID encryption',
      'sensor cipher',
      '硬件友好密码',
      'low-GE cipher',
    ],
  },
  // ============ hash: SipHash-2-4 keyed PRF ============
  siphash: {
    what: 'SipHash-2-4 — a keyed 64-bit pseudo-random function (PRF) and MAC by Aumasson & Bernstein (2012). Designed for short-input performance, widely used in hash table implementations (Python dict, Rust HashMap) to prevent HashDoS attacks.',
    principle:
      'ARX structure: Operates on four 64-bit state words with 64-bit modular arithmetic.\n' +
      '' +
      'Initialization: From 16-byte key (k0, k1) LE: v0=k0^0x736f6d6570736575, v1=k1^0x646f72616e646f6d, v2=k0^0x6c7967656e657261, v3=k1^0x7465646279746573.\n' +
      '' +
      'Compression (c rounds): For each 8-byte message block: v3^=m, do c SipRounds, v0^=m.\n' +
      'Finalization (d rounds): After last block, v2^=0xff, do d SipRounds.\n' +
      'SipRound: ARX network with rotations 13,16,32,21,17 through all 4 state words.\n' +
      'Output: v0^v1^v2^v3 (64-bit). SipHash-2-4: c=2,d=4; SipHash-1-3: c=1,d=3.\n',
    usage: 'Select variant (2-4 or 1-3). Provide 16-byte key as hex (32 hex chars). Input as UTF-8 text, hex, or base64. Output is 64-bit, shown in LE hex (reference byte order), BE hex, and decimal.',
    examples: [
      { in: '(empty)', param: 'variant=2-4, key=000102030405060708090a0b0c0d0e0f, inputMode=text', out: '结果 (小端 hex): 310e0edd47db6f72', desc: 'official test vector: key 0x00..0x0f with empty message produces canonical SipHash-2-4 output' },
    ],
    formulas: [
      { tex: 'v_0 \\mathrel{+}= v_1;\\; v_1 \\lll= 13;\\; v_1 \\oplus= v_0;\\; v_0 \\lll= 32', caption: 'First column of a SipRound; 4 parallel ARX operations per round' },
    ],
    tips: [
      'SipHash-2-4 is the default and recommended variant. SipHash-1-3 for speed-critical non-crypto contexts only.',
      'Key must be exactly 16 bytes (32 hex). Same input with different keys gives completely different outputs.',
      'LE hex display matches reference implementation byte order. BE hex and decimal for cross-tool comparison.',
      'In CTF, SipHash appears in hash table collision challenges and protocol auth with 64-bit MAC tags.',
    ],
    aka: [
      'siphash',
      'SipHash',
      'SipHash-2-4',
      'keyed hash',
      'PRF',
      'MAC',
      'short hash',
      'DoS protection',
      'SipHash键控哈希',
      '哈希表MAC',
      'Aumasson Bernstein',
      'ARX PRF',
      'SipHash-1-3',
      'HashDoS defense',
      '64-bit MAC',
    ],
  },
  // ============ crypto: scrypt KDF ============
  scrypt: {
    what: 'scrypt — a memory-hard password-based key derivation function (RFC 7914). Designed by Colin Percival to resist brute-force attacks using ASICs, FPGAs, and GPUs by requiring large amounts of memory. Core: PBKDF2-HMAC-SHA256 + Salsa20/8 + ROMix.',
    principle:
      'RFC 7914 algorithm:\n' +
      '1. B = PBKDF2-HMAC-SHA256(P, S, 1, p*128*r) — initial expansion\n' +
      '2. For each of p blocks: B_i = ROMix(B_i, N) — memory-hard mixing\n' +
      '3. DK = PBKDF2-HMAC-SHA256(P, B, 1, dkLen) — final derivation\n' +
      '' +
      'ROMix(N): The memory-hard core. Initialize V[0]=X, then for i=1..N: V[i]=X, X=BlockMix(X). Then for i=1..N: j=Integerify(X) mod N, X=BlockMix(X XOR V[j]). Memory ~128*r*N bytes.\n' +
      '' +
      'BlockMix: Operates on 2r blocks of 64 bytes using Salsa20/8 core (1/4 of full Salsa20). Interleaves output for diffusion.\n' +
      '' +
      'Salsa20/8: 8 rounds (4 double-rounds) on 16 32-bit words in a 4x4 matrix with column and row rounds.\n',
    usage: 'Enter password in input box (UTF-8 text, hex, or base64). Parameters: salt (UTF-8/hex/base64), N (cost factor, power of 2), r (block size, typically 8), p (parallelism, typically 1), dkLen (output bytes, default 32). Large N values increase computation time.',
    examples: [
      { in: 'password', param: 'passEnc=utf8, salt=NaCl, saltEnc=utf8, N=1024, r=8, p=16, dkLen=32', out: 'hex: fdbabe1c9d34...', desc: 'verified against Node.js crypto.scryptSync: password + NaCl salt, N=1024, p=16 produces deterministic 32-byte key' },
    ],
    formulas: [
      { tex: '\\text{ROMix}(X, N):\\; V[i] = X,\\; X = \\text{BlockMix}(X)\\; \\text{for}\\; i=1..N,\\; \\text{then sequential random-access mixing}', caption: 'ROMix: memory-hard loop forcing attacker to store N blocks' },
    ],
    tips: [
      'N dominates memory and CPU. Doubling N doubles memory. For CTF, start small (N=1024 or 16384).',
      'Memory is approximately 128 * r * N bytes. The tool displays an estimate.',
      'scrypt uses browser WebCrypto for PBKDF2 (async), Salsa20/8 and ROMix are pure JS.',
      'In CTF, if you have N, r, p, salt, and password, you can derive the key.',
      'dkLen controls output length. 32 bytes (256 bits) is default and sufficient.',
    ],
    aka: [
      'scrypt',
      'scrypt',
      'RFC 7914',
      'memory-hard',
      'KDF',
      'password hashing',
      'anti-ASIC',
      'scrypt密钥派生',
      'scrypt KDF',
      'Colin Percival',
      '内存硬化KDF',
      '口令哈希',
      'Litecoin PoW',
      'Salsa20/8',
      'ROMix',
    ],
  },
  // ============ hash: BLAKE3 cryptographic hash ============
  blake3: {
    what: 'BLAKE3 — a high-speed cryptographic hash function (O\'Connor, Aumasson, Neves, Wilcox-O\'Hearn, 2020). Combines BLAKE2 compression with a Bao tree structure, offering unlimited output (XOF). Default output is 32 bytes.',
    principle:
      'Compression function: 7 rounds, each applying 8 G-functions (4 column-wise + 4 diagonal-wise) with message word permutation. The G-function mixes two state words and two message words via addition, XOR, and rotation.\n' +
      '' +
      'Chunk processing: Input split into 1024-byte chunks. Each chunk processed into 16 64-byte blocks, linked sequentially to produce a chaining value (CV).\n' +
      '' +
      'Tree structure (Bao): Multiple chunks form a left-balanced binary tree. Parent nodes combine two child CVs. O(chunks) compression calls — naturally parallel.\n' +
      '' +
      'XOF: Root node outputs any number of bytes by incrementing counter with ROOT flag.\n' +
      '' +
      'Flags: CHUNK_START, CHUNK_END, PARENT, ROOT. IV = SHA-256 IV.\n',
    usage: 'Enter input as UTF-8 text or hex. Set outLen (default 32, max 4096). Output in hex and base64. All 10 official BLAKE3 test vectors pass, including multi-chunk boundary cases.',
    examples: [
      { in: 'abc', param: 'inputMode=text, outLen=32', out: 'hex: 6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85', desc: 'BLAKE3 of abc produces the canonical 32-byte hash; multi-chunk tree boundary vectors also verified' },
    ],
    formulas: [
      { tex: 'G(a,b,c,d,m_x,m_y):\\; a \\mathrel{+}= b + m_x;\\; d = (d \\oplus a) \\ggg 16;\\; c \\mathrel{+}= d;\\; b = (b \\oplus c) \\ggg 12', caption: 'BLAKE3 G-function (first half); completes with second message word and rotations 8,7' },
    ],
    tips: [
      'BLAKE3 is an XOF: set outLen to produce any number of output bytes. Each length gives a different prefix, not just truncation.',
      'Default 32 bytes matches SHA-256 and BLAKE2s-256 output size.',
      'BLAKE3 is not a drop-in replacement for BLAKE2 — tree structure handles long inputs differently.',
      'In CTF, a 64-hex hash could be BLAKE3 (32 bytes). Look for XOF usage as a distinguishing feature.',
    ],
    aka: [
      'blake3',
      'BLAKE3',
      'Bao tree',
      'cryptographic hash',
      'XOF',
      'BLAKE',
      'parallel hashing',
      'BLAKE3哈希',
      '可扩展输出',
      'BLAKE3 XOF',
      'O\'Connor',
      'Aumasson',
      '高速哈希',
      'Merkle树哈希',
      'BLAKE2 successor',
    ],
  },
  // ============ hash: Whirlpool 512-bit hash ============
  whirlpool: {
    what: 'Whirlpool — a 512-bit cryptographic hash function by Barreto & Rijmen, standardized in ISO/IEC 10118-3:2004. Uses a Miyaguchi-Preneel construction with a dedicated 512-bit block cipher W on an 8x8 byte state over 10 rounds.',
    principle:
      'Miyaguchi-Preneel: H_i = W_{H_{i-1}}(m_i) XOR m_i XOR H_{i-1}. The previous hash state is the key for the W cipher.\n' +
      '' +
      'Internal state: 8x8 byte matrix (64 bytes), row-major layout.\n' +
      '' +
      'Round transformation rho[k] = sigma[k] o theta o pi o gamma:\n' +
      '- gamma (SubBytes): Each byte through an 8-bit S-box generated from 4-bit mini-boxes E, E^-1, R.\n' +
      '- pi (ShiftColumns): Column j rotated downward by j positions.\n' +
      '- theta (MixRows): Each row multiplied by circulant matrix cir(1,1,4,1,8,5,2,9) in GF(2^8).\n' +
      '- sigma (AddRoundKey): XOR with round key.\n' +
      '' +
      'Key schedule: K^0 = H, K^r = rho[c^r](K^{r-1}) with round constants from S-box.\n' +
      '' +
      'Padding: Append 0x80, zeros to length = 32 mod 64, then 256-bit big-endian bit-length.\n' +
      '' +
      'Self-check: S-box must be a valid permutation; empty and abc hashes match ISO vectors.\n',
    usage: 'Enter input text (UTF-8) or hex bytes. Output is fixed 512-bit (128 hex char) digest. No parameters. One-way, irreversible. All 8 ISO test vectors verified (empty, a, abc, message digest, alphabet strings, quick brown fox, 1 million a\'s).',
    examples: [
      { in: '', param: 'inputMode=text', out: '19fa61d75522a4669b44e39c1d2e1726c530232130d407f89afee0964997f7a73e83be698b288febcf88e3e03c4f0757ea8964e59b63d93708b138cc42a66eb3', desc: 'ISO/IEC 10118-3 official vector: Whirlpool of empty string' },
      { in: 'abc', param: 'inputMode=text', out: '4e2448a4c6f486bb16b6562c73b4020bf3043e3a731bce721ae1b303d97e6d4c7181eebdb6c57e277d0e34957114cbd6c797fc9d95d8b582d225292076d4eef5', desc: 'ISO official vector: Whirlpool of abc — matches python hashlib.whirlpool and openssl' },
    ],
    formulas: [
      { tex: 'H_i = W_{H_{i-1}}(m_i) \\oplus m_i \\oplus H_{i-1}', caption: 'Miyaguchi-Preneel construction' },
    ],
    tips: [
      'Whirlpool produces 512-bit (128 hex char) output — much longer than SHA-256\'s 64 hex chars.',
      'S-box is self-generated from 4-bit mini-boxes rather than hard-coded.',
      'Whirlpool appears in older standards and CTF challenges, not common in modern systems.',
      'All 8 ISO test vectors verified on module load; if the module loads, the implementation is correct.',
    ],
    aka: [
      'whirlpool',
      'Whirlpool',
      'ISO 10118',
      'NESSIE',
      '512-bit hash',
      'Barreto',
      'Rijmen',
      'Miyaguchi-Preneel',
      'Whirlpool哈希',
      'ISO标准哈希',
      '漩涡哈希',
      'Whirlpool-512',
      '10118-3',
      'AES风格哈希',
      'Whirlpool digest',
    ],
  },

  // ============ hash: Streebog ============
  streebog: {
    what: 'Streebog — Russian federal standard hash (GOST R 34.11-2012, RFC 6986), 512-bit output (256-bit truncation), Merkle-Damgård + 12-round compression, common in Russian CTF and Xinchuang exams.',
    principle:
      'Streebog is a 512-bit-output hash built on an internal 512-bit block cipher E:\n\n' +
      'Compression: $g_N(h,m) = E_{LPS(h\\oplus N)}(m) \\oplus h \\oplus m$\n' +
      'The previous state h XOR counter N passes through LPS to derive key K; K encrypts message block m (E = 12 rounds of LPSX), then XOR back h and m (Miyaguchi-Preneel style).\n\n' +
      'Round transform LPS:\n' +
      '1. S — bytewise Pi substitution box (256 entries)\n' +
      '2. P — 64 bytes transposed as 8×8 matrix\n' +
      '3. L — each 64-bit word through GF(2) linear transform matrix A ($2^{64}$ diffusion)\n\n' +
      'Key schedule: $K_{i+1} = LPS(K_i \\oplus C_i)$, 12 iteration constants C from golden-ratio bits.\n\n' +
      'Message is compressed in 512-bit blocks right-to-left; final block padded $0^*||1||M$ with length encoding; then two more rounds over N and the checksum (sum of message blocks). 256-bit output takes the high 256 bits, with a different IV.\n\n' +
      'All RFC 6986 §10 official vectors (M1/M2 × 512/256-bit) pass.',
    usage:
      'Input: message (text or hex). param len = 512 or 256-bit output. Output fixed 128/64 hex chars, one-way.',
    examples: [
      { in: '323130393837363534333231303938373635343332313039383736353433323130393837363534333231303938373635343332313039383736353433323130', param: 'len=512', out: '486f64c1917879417fef082b3381a4e2...(128 hex)', desc: 'RFC 6986 §10.1.1 official vector, 504-bit message' },
    ],
    formulas: [
      { tex: 'g_N(h,m) = E_{LPS(h\\oplus N)}(m) \\oplus h \\oplus m', caption: 'Streebog compression: LPS-derived key encrypts message block, XOR back h and m' },
    ],
    tips: [
      'Streebog is the Russian standard hash (equivalent of China\'s SM3); common in Russian CTF (RACTF) and Xinchuang exams.',
      'Keywords: Streebog, GOST R 34.11-2012, RFC 6986, 512-bit hash.',
      '512-bit output = 128 hex; 256-bit is the high half, not a separate algorithm.',
      'Compression uses a 512-bit block cipher + Miyaguchi-Preneel construction, structurally similar to Whirlpool.',
    ],
    aka: [
      'streebog',
      'Streebog',
      'GOST R 34.11-2012',
      'RFC 6986',
      'Russian hash',
      '512-bit hash',
      'Streebog512',
      'Streebog256',
      'GOST hash',
      'Russian standard',
      'Magma family',
      'Xinchuang hash',
      'Streebog hash',
      '俄系密码',
      '俄罗斯国标',
    ],
  },

  // ============ modern: MARS block cipher ============
  mars: {
    what: 'MARS — IBM\'s candidate for the AES competition (1998, Burwick/Coppersmith et al., 11 authors). 128-bit block, 128-448 bit keys, 32 rounds of hybrid structure; AES finalist.',
    principle:
      'MARS runs encryption in three stages, mixing Feistel and SPN ideas:\n\n' +
      '1. Pre-whitening: add first 4 key words, then 8 rounds of forward mixing (F_MIX: S0/S1 lookups + rotation, alternating adds of D or B).\n' +
      '2. Cryptographic core 16 rounds: each uses a key pair (k1,k2); CORE does multiply-high rotation (r = (a<<<13)*k2 <<<5), S-box lookup, variable-rotate add. First 8 rounds forward order, last 8 reversed.\n' +
      '3. Post-whitening: 8 rounds backward mixing (B_MIX, alternating subtracts of D or B), then subtract last 4 key words.\n\n' +
      'Key schedule: 15-word T array, 4 iterations each of linear expansion + 4 rounds of S-box stirring, producing 40 words; then fix odd-index multiplication key words (non-trivial multipliers, B table + mask).\n\n' +
      'Decryption is the exact inverse: inverse core CORE_INV + reversed mixing.',
    usage:
      'Param keyBits picks 128/192/256; key must match in hex (32/48/64 chars). Input plaintext/ciphertext in whole 16-byte (32 hex) blocks. Encode → hex ciphertext, decode with same key.',
    examples: [
      { in: '00000000000000000000000000000000', param: 'keyBits=128, key=80000000000000000000000000000000', out: 'b3e2ad5608ac1b6733a7cb4fdf8f9952', desc: 'MARS-128 official vector (Crypto++ marsval.dat: key=8000.., pt=0)' },
    ],
    formulas: [
      { tex: 'r = ((a \\lll 13) \\cdot k_2) \\lll 5;\\quad c \\mathrel{+}= m \\lll (r \\bmod 32);\\quad b \\mathrel{+}= l \\lll (r \\bmod 32)', caption: 'MARS cryptographic core CORE: multiply-high + variable rotation' },
    ],
    tips: [
      'MARS key may be 128/192/256 bits; block stays 128.',
      'Keywords: IBM AES candidate, Burwick/Coppersmith, 32-round hybrid.',
      'CTF: keep all five AES finalists handy (MARS/RC6/Serpent/Twofish/Rijndael).',
      'Passes all Crypto++ marsval.dat official vectors (incl. 192/256-bit keys).',
    ],
    aka: [
      'MARS', 'IBM MARS', 'AES candidate', 'AES finalist', 'block cipher', '128-bit block', 'Burwick', 'Coppersmith',
      '32 rounds', 'hybrid structure', 'MARS-128', 'MARS-192', 'MARS-256', 'IBM AES', 'Mars cipher', 'five finalists',
      'AES finalist cipher', 'MARS algorithm',
    ],
  },
  // ============ modern: Skipjack block cipher ============
  skipjack: {
    what: 'Skipjack — block cipher designed by NSA (1980s, declassified 1998), used in the Clipper/Fortezza chips. 64-bit block, 80-bit key, 32 rounds.',
    principle:
      'Skipjack runs 32 rounds = 8×Rule A + 8×Rule B + 8×Rule A + 8×Rule B. The block is split into four 16-bit words w1-w4:\n\n' +
      'Rule A: w1\' = G_k(w1) ^ w4 ^ (k+1); w2\' = G_k(w1); w3\' = w2; w4\' = w3.\n' +
      'Rule B: w1\' = w4; w2\' = G_k(w1); w3\' = w1 ^ w2 ^ (k+1); w4\' = w3.\n\n' +
      'The core is the key-dependent permutation G_k (4-round Feistel): each round uses one key byte (rotating 4k mod 10) into a 256-entry F-table XOR.\n\n' +
      'Decryption uses the inverse permutation h and walks the rules backward, with the same tab preprocessing (tab[i][c] = F[c ^ key[9-i]]).\n\n' +
      'Designed for fast hardware (the Clipper chip), the community distrusted its secrecy; Biham et al. (1994) cracked 16 of the 32 rounds.',
    usage:
      'Param key is 80-bit hex (20 chars). Input 8-byte (16 hex) multiples of plaintext/ciphertext. Encode → hex ciphertext, decode with same key (ECB multi-block).',
    examples: [
      { in: '0000000000000000', param: 'key=80000000000000000000', out: '7a00e49441461f5a', desc: 'NIST SP800-17 Table 6 official vector (key=8000.., pt=0)' },
    ],
    formulas: [
      { tex: 'G_k(w):\\ g_3 = F[g_2 \\oplus kv_0] \\oplus g_1;\\ g_6 = F[g_5 \\oplus kv_3] \\oplus g_4', caption: 'Skipjack G permutation: 4 F-table steps (kv = rotating 4 key bytes)' },
    ],
    tips: [
      'Skipjack key is fixed 80-bit (20 hex); length cannot change.',
      'Keywords: Clipper chip, Fortezza card, NSA block cipher, 64-bit block, 80-bit key.',
      'CTF: 64-bit block + 80-bit key → try Skipjack first.',
      'Passes all NIST SP800-17 Table 6 official vectors (encrypt + decrypt).',
    ],
    aka: [
      'Skipjack', 'NSA', 'Clipper', 'Fortezza', 'block cipher', '80-bit key', '64-bit block', '32 rounds',
      'Skipjack algorithm', 'National Security Agency', 'KEA', 'key escrow', 'Skipjack cipher', 'G permutation',
      'F-table', 'hardware cipher', '4-round Feistel', 'NIST SP800-17',
    ],
  },
  // ============ modern: Threefish tweakable block cipher ============
  threefish: {
    what: 'Threefish — the tweakable block cipher inside the Skein hash (Ferguson/Lucks/Schneier et al., 2010). Block 256/512/1024 bits, key of the same length, 72/80 rounds, and a 128-bit tweak fed into every subkey.',
    principle:
      'Threefish is deliberately minimal: no complex key scheduler. Instead each subkey is assembled directly from key words, the tweak and the round counter, injected every 4 rounds.\n\n' +
      'Round function: pair the state words and MIX — y0 = x0 + x1; y1 = (x1 rotate-left R) ^ y0 — then permute the words so the next round mixes different partners. Rotation constants repeat every 8 rounds.\n\n' +
      'Subkey s: the first Nw-3 words are cyclic picks of key words K[(s+j) mod (Nw+1)], the last 3 add T[s mod 3], T[(s+1) mod 3] and s (the counter). Here K_{Nw} = C240 ^ K0 ^ ... ^ K_{Nw-1} (C240 a fixed magic constant), T2 = T0 ^ T1.\n\n' +
      'The tweak lets one key produce different keystreams in different contexts (hash chunk counts, stream positions) — the foundation of Skein\'s tweakable hashing.',
    usage:
      'Param size picks 256/512/1024-bit block; key must match block length in hex; tweak is 128-bit hex (default all-zero). Input plaintext hex in whole blocks. Encode → hex ciphertext, decode with same key/tweak to restore (ECB multi-block).',
    examples: [
      { in: '00000000000000000000000000000000', param: 'size=256, key=00000000000000000000000000000000, tweak=00000000000000000000000000000000', out: '84da2a1f8beaee947066ae3e3103f1ad536db1f4a1192495116b9f3ce6133fd8', desc: 'Threefish-256 all-zero key/tweak/pt official vector (Crypto++ threefish.txt)' },
    ],
    formulas: [
      { tex: 'y_0 = x_0 + x_1;\\quad y_1 = (x_1 \\lll R) \\oplus y_0', caption: 'Threefish MIX: add + rotate-XOR' },
    ],
    tips: [
      'Threefish-256 block = 4 words (32 hex); 512 = 8 words (64 hex); 1024 = 16 words (128 hex); input must be whole blocks.',
      'Tweak all-zero degenerates to a plain block cipher; nonzero tweak makes the same key produce different outputs per context.',
      'CTF: when the challenge gives key + tweak + ciphertext, just fill them and decode.',
      'Threefish underlies the Skein hash (SHA-3 finalist); understanding it unlocks the whole Skein structure.',
    ],
    aka: [
      'Threefish',
      'Skein',
      'tweakable block cipher',
      'Tweakable',
      'Threefish-256',
      'Threefish-512',
      'Threefish-1024',
      'Ferguson',
      'Lucks',
      'Schneier',
      'Whiting',
      'Bellare',
      'Kohno',
      'Callas',
      'Walker',
      'Threefish cipher',
      'no key schedule',
      'Threefish algorithm',
      'SHA-3 finalist',
      'adjustable block cipher',
    ],
  },
  // ============ hash: Pearson fast hash ============
  pearson: {
    what: 'Pearson hashing — an extremely simple non-cryptographic hash function (Peter K. Pearson, CACM 1990). Core: h := T[h XOR c] for each input byte c, using a 256-entry permutation table T. Multi-byte output via per-byte seed modification.',
    principle:
      'Published in Fast Hashing of Variable-Length Text Strings (CACM, June 1990):\n' +
      '' +
      'Single-byte hash: Initialize h = 0. For each byte c: h = T[h XOR c]. Output is h (one byte).\n' +
      '' +
      'Multi-byte extension: For the j-th output byte, replace first message byte with (msg[0] + j) mod 256 and re-run. Empty input uses j as virtual first byte.\n' +
      '' +
      'Permutation table T: Must be a permutation of 0..255 (each value exactly once). This implementation uses the Wikipedia reference permutation table. Module self-checks that T is a valid permutation.\n' +
      '' +
      'Pearson provides excellent mixing for its simplicity. Not cryptographically secure (table is public, state is 8 bits), but useful for hash tables, checksums, and lightweight applications.\n',
    usage: 'Enter input as UTF-8 text or hex bytes. Set number of output bytes (1..32, default 8). Output shown in hex and as decimal byte values. No key or additional parameters needed.',
    examples: [
      { in: 'abc', param: 'inputMode=text, bytes=8', out: '摘要 (hex): ac15d50e7b8c50f7', desc: 'Pearson 8-byte hash of abc using Wikipedia reference permutation table' },
    ],
    tips: [
      'Pearson is not cryptographic — the output space is small and collisions are trivial to find.',
      'The permutation table is canonical (Wikipedia reference). Different tables produce different outputs.',
      'Single-byte output: one XOR + one table lookup per input byte. Multi-byte proportionally slower.',
      'In CTF, Pearson appears as a custom checksum in binary protocols or simple identification challenges.',
      'Output byte count from 1 to 32. 8 bytes is a reasonable default for a 64-bit checksum.',
    ],
    aka: [
      'pearson',
      'Pearson hash',
      'Pearson hashing',
      'lookup table hash',
      'CACM',
      'non-crypto hash',
      'Pearson哈希',
      '快速哈希',
      'Peter Pearson',
      'Pearson 1990',
      'CACM 1990',
      'permutation hash',
      '8-bit hash',
      'XOR table hash',
      'lightweight hash',
    ],
  },
  // ============ analysis: xorshift state recovery ============
  xorshiftRecover: {
    what: 'xorshift PRNG state recovery — reconstructs the internal state of Marsaglia xorshift PRNGs (32, 64, or 128-bit variants) from observed outputs, enabling prediction of future values.',
    principle:
      'George Marsaglia\'s Xorshift RNGs (J. Stat. Soft. 2003). Three standard variants:\n' +
      '' +
      'xorshift32 (13,17,5): x ^= x<<13; x ^= x>>17; x ^= x<<5. Output is the 32-bit state.\n' +
      'xorshift64 (13,7,17): Same with 64-bit words.\n' +
      'xorshift128 (11,8,19): 4-word state (x,y,z,w). t = x^(x<<11); x=y; y=z; z=w; w = (w^(w>>19))^(t^(t>>8)). Output is w.\n' +
      '' +
      'Recovery: 32/64-bit: each output IS the state. Reverse the step via bit-by-bit inversion. 128-bit: after 4 outputs, state is exactly (o1,o2,o3,o4). Future outputs computed by stepping forward.\n',
    usage: 'Enter observed outputs separated by spaces/commas/semicolons. Select variant and input radix (decimal or hex). Set count for future outputs to predict (default 5). Tool recovers state and predicts subsequent values with consistency verification.',
    examples: [
      { in: '(5 consecutive outputs from xorshift32 with seed 123456789)', param: 'variant=xorshift32, radix=dec, count=3', out: '恢复初始种子 = 123456789\n一致性自检: pass\n预测后续 3 个输出', desc: 'from 5 consecutive outputs, recovers seed=123456789 and correctly predicts the next 3 values' },
    ],
    formulas: [
      { tex: 'x \\oplus= x \\ll 13;\\; x \\oplus= x \\gg 17;\\; x \\oplus= x \\ll 5', caption: 'xorshift32 triple: three XOR-shift operations produce the next state' },
    ],
    tips: [
      'For xorshift32/64, 1 output gives the current state. More outputs enable consistency verification.',
      'For xorshift128, need at least 4 consecutive outputs. Last 4 become internal state (x,y,z,w).',
      'Hex accepts both 0x-prefixed and plain hex values.',
      'In CTF, xorshift PRNGs are common. Given a few consecutive outputs, this tool cracks them.',
      'Output count is capped at 1000.',
    ],
    aka: [
      'xorshiftRecover',
      'xorshift',
      'PRNG state recovery',
      'Marsaglia',
      'random prediction',
      'xor shift',
      'xorshift状态恢复',
      '随机数预测',
      'Marsaglia PRNG',
      'xorshift32',
      'xorshift64',
      'xorshift128',
      'PRNG crack',
      '伪随机数破解',
      'RNG prediction',
    ],
  },
  // ============ text: yEnc encode/decode ============
  yenc: {
    what: 'yEnc — a binary-to-text encoding for Usenet newsgroups (NNTP), specified in yEnc-1.3 (Jurgen Helbing, 2002). Encodes each byte as (b + 42) mod 256, with critical characters escaped using the = prefix.',
    principle:
      'Encoding: E = (b + 42) mod 256. Maps all 256 byte values into the printable ASCII range.\n' +
      '' +
      'Escaping (critical characters): If E is NUL(0x00), LF(0x0A), CR(0x0D), or =(0x3D), output = followed by (E + 64) mod 256.\n' +
      '' +
      'Conservative leading-character escaping: At line start, TAB(0x09), SPACE(0x20), and .(0x2E) are also escaped to prevent transport-layer issues.\n' +
      '' +
      'Line width: Output wrapped at specified width (default 128). Lines end with CRLF.\n' +
      '' +
      'Decoding: If char is =, read next char c, compute E = (c - 64) mod 256, then b = (E - 42) mod 256. Otherwise b = (c - 42) mod 256. CR/LF ignored. Lines starting with =y (control headers) skipped automatically.\n' +
      '' +
      'Roundtrip property: encode then decode recovers exact original bytes for all 0..255 byte values.\n',
    usage: 'Encode: Enter UTF-8 text. Set line width (default 128). Decode: Paste yEnc-encoded text. Control headers (=ybegin/=ypart/=yend) are automatically skipped. The full byte range 0..255 roundtrips correctly.',
    examples: [
      { in: 'ABC', param: 'width=128', out: 'klm', desc: 'ABC encodes to klm: A(65)+42=107=k, B(66)+42=108=l, C(67)+42=109=m; all printable, no escaping needed' },
    ],
    tips: [
      'yEnc is a binary-to-text encoding like Base64 but specialized for Usenet with ~2% overhead vs Base64\'s ~33%.',
      'Line width can be set; CRLF line endings are added automatically.',
      'yEnc has ROT42-like structure but escaping breaks direct symmetry — must use decode to reverse encode.',
      'In CTF, yEnc in .nzb files or Usenet captures should be decoded with this tool.',
    ],
    aka: [
      'yenc',
      'yEnc',
      'yEnc-1.3',
      'Usenet encoding',
      'NNTP',
      'binary transport',
      'yEnc编解码',
      'Usenet编码',
      'yEnc 1.3',
      'Jurgen Helbing',
      'yENC',
      'newsgroup encoding',
      '二进制传输编码',
      'yEnc format',
      'NZB encoding',
    ],
  },
  // ============ text: BinHex 4.0 encode/decode ============
  binhex: {
    what: 'BinHex 4.0 — a Macintosh binary-to-ASCII encoding format (Yves Lempereur). Combines Run-Length Encoding (RLE90) with a custom 6-bit encoding, wrapping in a header/footer structure with CRC-16-CCITT checksums.',
    principle:
      'BinHex 4.0 encodes a Macintosh file\'s resource fork, data fork, and metadata into ASCII for text-only channels.\n' +
      '' +
      '6-bit encoding table (64 chars): !"#$%&\'()*+,-012345689@ABCDEFGHIJKLMNPQRSTUVXYZ[`abcdefhijklmpqr — deliberately missing 7, O, W, g, n, o to avoid visual ambiguity.\n' +
      '' +
      'RLE90 compression: Marker byte 0x90. <c> 0x90 <n> means repeat byte c n times. Literal 0x90 is 0x90 0x00.\n' +
      '' +
      'File structure: File name + length, version, type/creator 4CC codes, flags, data/resource fork lengths, header CRC, data fork, data CRC, resource fork, resource CRC. All multi-byte integers big-endian.\n' +
      '' +
      'CRC-16-CCITT (XModem): polynomial 0x1021, init 0, no reflection. Equivalent to Python binascii.crc_hqx.\n' +
      '' +
      'Outer format: Preceded by (This file must be converted with BinHex 4.0), wrapped in : at start and end.\n',
    usage: 'Encode: Enter UTF-8 text (becomes data fork). Set filename (default file.txt). Type/creator = TEXT/CTFB. Resource fork empty. Decode: Paste BinHex document. Extracts filename, type, creator, data fork with all 3 CRC verifications.',
    examples: [
      { in: 'Hello', param: 'filename=file.txt', out: '(This file must be converted with BinHex 4.0)\n\n:(6-bit encoded data):', desc: 'encodes Hello as a complete BinHex 4.0 document with header line, colon-delimited 6-bit body, and CRC checksums' },
    ],
    tips: [
      'BinHex 4.0 is Mac-specific. Telltale sign: the (This file must be converted with BinHex 4.0) header line.',
      'Decode auto-skips the header line and extracts data between : delimiters.',
      'CRC verification is automatic: header, data, and resource CRCs all checked on decode.',
      'Empty resource fork is normal for text files.',
      'In CTF, BinHex appears in retro computing, Macintosh forensics, or old email archive challenges.',
    ],
    aka: [
      'binhex',
      'BinHex',
      'BinHex 4.0',
      'hqx',
      'Mac encoding',
      'Macintosh',
      'StuffIt',
      'MacBinary',
      'RLE',
      'BinHex编解码',
      'Mac编码',
      'HQX格式',
      'Yves Lempereur',
      'CRC-16 CCITT',
      '苹果编码',
    ],
  },

  // ============ modern: ARIA block cipher ============
  aria: {
    what: 'ARIA — Korean standard block cipher (KS X 1213 / RFC 5794), 128-bit block, 128/192/256-bit keys, 12/14/16-round SPN. Common in Korean info-security standards and CTF.',
    principle:
      'ARIA is a 128-bit SPN block cipher. Key sizes 128/192/256 bits map to 12/14/16 rounds, plus a final extra key-add layer (13/15/17 round keys).\n\n' +
      'Round structure:\n' +
      '1. XOR with the round key\n' +
      '2. Substitution layer SL1/SL2 alternating (SL2 is the inverse of SL1) — four 8-bit S-boxes SB1..SB4 applied in a 4-byte rotating pattern\n' +
      '3. Diffusion layer A: each output byte is the XOR of 7 fixed input bytes (an involution: A(A(x))=x)\n\n' +
      'Key schedule: pad the key to 256 bits as KL||KR, run a 3-round Feistel to get W0..W3, then combine with fixed left/right rotations to derive ek1..ek17. Constants CK1/CK2/CK3 come from the fractional part of 1/pi.\n\n' +
      'Decryption uses the same structure with re-ordered round keys (dk1=ek_{n+1}, middle ones pass through A, last is ek1).\n\n' +
      'All three RFC 5794 Appendix A vectors (128/192/256-bit keys) pass.',
    usage:
      'key: 128/192/256-bit hex (32/48/64 chars) — the key size selects the round count.\n' +
      'Input: hex, a multiple of 16 bytes (32 hex chars); ECB does not auto-pad. Encode = encrypt (hex out), Decode = decrypt (hex in).',
    examples: [
      { in: '00112233445566778899aabbccddeeff', param: 'key=000102030405060708090a0b0c0d0e0f', out: 'd718fbd6ab644c739da95f3be6451778(hex)', desc: 'RFC 5794 Appendix A.1, 128-bit key encryption ✓' },
    ],
    formulas: [
      { tex: '\\text{FO}(D,RK)=A(\\text{SL1}(D \\oplus RK)),\\quad \\text{FE}(D,RK)=A(\\text{SL2}(D \\oplus RK))', caption: 'ARIA odd/even round functions: XOR, substitute, then diffuse through layer A' },
    ],
    tips: [
      'ARIA is the Korean standard, comparable to China\'s SM4 (both 128-bit blocks); common in Korean CTF (suninatas, CodeGate).',
      'Keywords: ARIA, KS X 1213, RFC 5794, Korean encryption.',
      'ECB block = 16 bytes; CTF usually pairs known-plaintext or round-trip with encrypt/decrypt.',
      'Diffusion layer A is an involution, so decryption round keys are just re-ordered with A applied to some of them.',
    ],
    aka: [
      'aria',
      'ARIA',
      'KS X 1213',
      'RFC 5794',
      'Korean standard',
      'Korean cipher',
      'KATS',
      'ARIA cipher',
      'SEED sibling',
      'ARIA-128',
      'ARIA-256',
      'ARIA加密',
      '韩国标准密码',
      '韩国国密',
      'ARIA block cipher',
    ],
  },

  // ============ modern: SEED block cipher ============
  seed: {
    what: 'SEED — Korean KISA national standard block cipher (RFC 4269 / RFC 4009), 128-bit block, 128-bit key, 16-round Feistel. Widely used in Korean finance and encrypted communications.',
    principle:
      'SEED is a 128-bit Feistel block cipher with a 128-bit key and 16 rounds.\n\n' +
      'Round function F: split the 64-bit right half into R0/R1 (32-bit each), XOR with subkeys, then cross-mix through 3 layers of the G function with mod 2^32 addition:\n' +
      '  t = (R0^Ki0) ^ (R1^Ki1),  a = R0^Ki0\n' +
      '  R0\' = G[ G[G(t)+a] + G(t) ] + G[G(t)+a]\n' +
      '  R1\' = G[ G[G(t)+a] + G(t) ]\n\n' +
      'G function: split 32-bit input into 4 bytes, alternate two 8x8 S-boxes S0/S1, then linearly mix bytes with masks m0=0xFC/m1=0xF3/m2=0xCF/m3=0x3F (equivalent to four extended SS-boxes).\n\n' +
      'Key schedule: split the 128-bit key into 4x32-bit blocks Key0..Key3; 16 constants KC1..KC16 (golden-ratio 0x9E3779B9 rotated) generate two subkeys Ki0/Ki1 per round; odd rounds right-rotate Key0||Key1 by 8 bits, even rounds left-rotate Key2||Key3 by 8 bits.\n\n' +
      'Both RFC 4269 Appendix B vectors and multiple per-round intermediate subkeys match.',
    usage:
      'key: 128-bit hex (32 chars).\n' +
      'Input: hex, multiple of 16 bytes (32 hex chars); ECB does not auto-pad. Encode = encrypt (hex out), Decode = decrypt (hex in).',
    examples: [
      { in: '000102030405060708090a0b0c0d0e0f', param: 'key=00000000000000000000000000000000', out: '5ebac6e0054e166819aff1cc6d346cdb(hex)', desc: 'RFC 4269 Appendix B.1 encryption ✓' },
    ],
    formulas: [
      { tex: 'Z_0=\\{S_0(X_0)\\&m_0\\}\\oplus\\{S_1(X_1)\\&m_1\\}\\oplus\\{S_0(X_2)\\&m_2\\}\\oplus\\{S_1(X_3)\\&m_3\\}', caption: 'SEED G function (Z0 low byte): S-boxes + mask linear mixing' },
    ],
    tips: [
      'SEED and ARIA are both Korean standards; RFC 4009 is the old spec (ambiguous S-boxes), RFC 4269 fixed it without changing SEED itself.',
      'Keywords: SEED, KISA, Korean encryption, RFC 4269.',
      'Korean finance/system CTF problems may show SEED-CBC; this op provides the ECB primitive.',
      'A 16-byte key + 16-byte ciphertext is likely one of SEED/ARIA/SM4 (128-bit block ciphers) — try them one by one.',
    ],
    aka: [
      'seed',
      'SEED',
      'KISA',
      'RFC 4269',
      'RFC 4009',
      'Korean encryption',
      'Korean standard cipher',
      'SEED cipher',
      'KISA SEED',
      'ARIA sibling',
      '128-bit block',
      'SEED加密',
      '韩国国密',
      '韩国加密',
      'SEED block cipher',
    ],
  },

  // ============ modern: Camellia block cipher ============
  camellia: {
    what: 'Camellia — 128-bit block cipher by NTT/Mitsubishi (RFC 3713), 128/192/256-bit keys, 18/24-round Feistel. Recommended by EU NESSIE and Japan CRYPTREC; used in Japanese e-government and TLS.',
    principle:
      'Camellia is a 128-bit Feistel block cipher. Key sizes 128/192/256 bits map to 18/24 rounds, with FL/FLINV functions inserted every 6 rounds to break Feistel symmetry.\n\n' +
      'F function: XOR the 64-bit input with a subkey, pass bytes through 4 S-boxes (SBOX2/3/4 derived from SBOX1 by rotation: S2[x]=S1[x]<<<1, S3[x]=S1[x]<<<7, S4[x]=S1[x<<<1]), then linearly mix the 8 output bytes (P layer).\n\n' +
      'FL function (nonlinear): split 64 bits into two 32-bit halves, do x2 ^= rol1(x1&k1), x1 ^= x2|k2; FLINV is its inverse.\n\n' +
      'Key schedule: 128-bit key K becomes KL, KR=0 (192-bit pads ~KR); KL/KR mix through 6 Sigma constants (SHA-1-derived) into KA/KB; rotate KL/KR/KA/KB by 15/30/45/60/77/94/111 and take halves for subkeys.\n\n' +
      'All three RFC 3713 Appendix C vectors (128/192/256-bit) match in both directions, plus per-stage comparison against a reference implementation.',
    usage:
      'key: 128/192/256-bit hex (32/48/64 chars) — key size selects the round count.\n' +
      'Input: hex, multiple of 16 bytes (32 hex chars); ECB does not auto-pad. Encode = encrypt (hex out), Decode = decrypt (hex in).',
    examples: [
      { in: '0123456789abcdeffedcba9876543210', param: 'key=0123456789abcdeffedcba9876543210', out: '67673138549669730857065648eabe43(hex)', desc: 'RFC 3713 Appendix C, 128-bit key encryption ✓' },
    ],
    formulas: [
      { tex: '\\text{F}(F_{in},KE)=P(S\\_box(F_{in}\\oplus KE)),\\quad S_2[x]=S_1[x]\\lll1', caption: 'Camellia F function: XOR subkey, substitute, linear layer; S2 derived from S1 by rotation' },
    ],
    tips: [
      'Camellia is recommended alongside AES by NESSIE/CRYPTREC; appears in Japanese CTF (SECCON).',
      'Keywords: Camellia, RFC 3713, NESSIE, CRYPTREC, NTT.',
      'FL/FLINV every 6 rounds is the structural signature; both 192- and 256-bit keys use 24 rounds.',
      'ECB block = 16 bytes; CTF usually pairs known-plaintext or round-trip.',
    ],
    aka: [
      'camellia',
      'Camellia',
      'RFC 3713',
      'NESSIE',
      'CRYPTREC',
      'NTT cipher',
      'Mitsubishi',
      'Camellia cipher',
      '128-bit block',
      'Japanese standard',
      'Camellia-128',
      'Camellia-256',
      'Camellia加密',
      '日本加密',
      'FL function',
    ],
  },

  // ============ modern: Serpent block cipher ============
  serpent: {
    what: 'Serpent — AES finalist block cipher by Anderson/Biham/Knudsen, 128-bit block, 128/192/256-bit keys, 32-round SPN with 8 bit-sliced S-boxes, extremely conservative security margin.',
    principle:
      'Serpent is a 128-bit SPN block cipher with 32 rounds and 128/192/256-bit keys.\n\n' +
      'Round structure:\n' +
      '1. XOR with a 32-bit round key\n' +
      '2. One of eight 4×4 S-boxes (bit-sliced lookup, cycling S0..S7)\n' +
      '3. Linear transform: fixed bit permutation + left rotations (13/3, 1/7, 5/22)\n\n' +
      'The final round (32nd) skips the linear transform, using only S-box + XOR.\n\n' +
      'Key schedule: pad key with a 1 bit to 256 bits → 8×32-bit words → affine recurrence $w_i = rol(w_{i-8}\\oplus w_{i-5}\\oplus w_{i-3}\\oplus w_{i-1}\\oplus 0x9E3779B9\\oplus(i-8), 11)$ producing 132 pre-keys → apply reversed-order S-boxes to get 33 round keys.\n\n' +
      'All 514 NESSIE official test vectors (128/192/256-bit keys) pass.',
    usage:
      'key: 128/192/256-bit hex (32/48/64 chars).\n' +
      'Input: hex, multiple of 16 bytes (32 hex chars); ECB does not auto-pad, little-endian word order. Encode = encrypt (hex out), Decode = decrypt (hex in).',
    examples: [
      { in: '00000000000000000000000000000000', param: 'key=80000000000000000000000000000000', out: '264e5481eff42a4606abda06c0bfda3d(hex)', desc: 'NESSIE test vector, 128-bit key encryption ✓' },
    ],
    formulas: [
      { tex: '\\text{round: } X = S_{r\\%8}(X \\oplus K_r),\\quad X = L(X)', caption: 'Serpent round: XOR round key, bit-sliced S-box, linear transform L' },
    ],
    tips: [
      'Serpent was the AES runner-up with an ultra-conservative 32-round design; occasionally appears in CTF.',
      'Keywords: Serpent, Anderson/Biham/Knudsen, AES finalist.',
      'The 4×4 S-boxes are implemented bit-sliced; stylistically related to PRESENT in this project.',
      '128-bit key uses 32 rounds; NESSIE vectors are the authoritative validation source.',
    ],
    aka: [
      'serpent',
      'Serpent',
      'Anderson',
      'Biham',
      'Knudsen',
      'AES finalist',
      'AES runner-up',
      '32-round SPN',
      'Serpent cipher',
      'bit-sliced',
      'NESSIE',
      'serpent-128',
      'serpent-256',
      'Serpent加密',
      'ABK cipher',
    ],
  },
};
