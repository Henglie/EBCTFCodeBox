// English edu shard: modern — aes/des/des3/rc4/xor/rsa/xorStrings/cast5/twofish
export default {
  aes: {
    what: "AES (Advanced Encryption Standard): today's most widely used symmetric cipher — key length 128/192/256 bits, supporting ECB/CBC/CFB/OFB/CTR/GCM modes.",
    principle: "AES is a block cipher that splits plaintext into 16-byte (128-bit) blocks, each transformed over 10/12/14 rounds (for 128/192/256-bit keys). Each round has 4 steps: SubBytes (S-box byte substitution), ShiftRows (row shifting), MixColumns (column mixing, GF(2⁸) matrix multiplication), AddRoundKey (round key XOR). ECB mode encrypts each block independently (identical plaintext → identical ciphertext, insecure); CBC/CFB/OFB/CTR use an IV (initialization vector) to chain block dependencies. GCM mode runs on native WebCrypto acceleration.",
    formulas: [
      { tex: "\\text{State}' = \\text{AddRoundKey}(\\text{MixColumns}(\\text{ShiftRows}(\\text{SubBytes}(\\text{State}))), K_r)", caption: "AES per-round four-step transform" },
    ],
    usage: "Enter plaintext (encode) or ciphertext (decode) in the input box. Params: choose mode (ECB/CBC/...), key (16/24/32 bytes), key encoding, ciphertext encoding. ECB needs no IV; other modes require one.",
    examples: [
      { in: "Hello", param: "mode=ECB, key='1234567890123456'(16 bytes)", out: "Sy+szA6t7l9kO128yIajHQ== (base64)", desc: "AES-128-ECB, PKCS7 padding" },
    ],
    tips: [
      "ECB mode encrypts identical plaintext blocks identically — an encrypted image still shows its outline (the classic ECB penguin), so CTF challenges can identify ECB this way.",
      "Key length must be 16/24/32 bytes or it errors — a hex-encoded 32-char key = 16 bytes.",
      "CBC mode needs an IV (usually 16 zero bytes or random); a wrong IV garbles output but the first block may be partly correct.",
    ],
    aka: ["AES", "Rijndael", "Advanced Encryption Standard", "FIPS 197", "高级加密标准", "AES-128", "AES-256", "AES-GCM", "AES-CBC", "对称加密"],
  },

  des: {
    what: "DES (Data Encryption Standard): a symmetric cipher published in 1977 — 64-bit blocks, 56-bit effective key. Replaced by AES but still common in CTF.",
    principle: "DES is a Feistel network: 64-bit plaintext goes through initial permutation IP, then splits into left/right halves L₀/R₀ over 16 Feistel rounds. Each round: Rₙ = Lₙ₋₁ ⊕ F(Rₙ₋₁, Kₙ), Lₙ = Rₙ₋₁. The F function includes: expansion permutation E (32→48 bits), XOR with subkey, 8 S-box substitutions (48→32 bits), permutation P. Subkeys are generated from the key via PC-1/PC-2 and cyclic left shifts, producing 16 48-bit subkeys. The 56-bit key is brute-forceable (a few hours).",
    usage: "Enter plaintext or ciphertext. Params: choose mode (ECB/CBC/CFB/OFB/CTR), key (8 bytes), key encoding, ciphertext encoding.",
    examples: [
      { in: "Hello", param: "mode=ECB, key='12345678'(8 bytes)", out: "oVmfzWxhH88= (base64)", desc: "DES-ECB, PKCS7 padding" },
    ],
    tips: [
      "DES keys are 8 bytes but every 8th bit is a parity bit, so the effective key is only 56 bits — brute-forceable with modern hardware.",
      "In CTF, DES appears in legacy-system scenarios — weak keys (all-zero / all-FF) crack instantly.",
      "DES and 3DES both use 8-byte blocks (AES uses 16), so ciphertext length is a multiple of 8.",
    ],
    aka: ["DES", "Data Encryption Standard", "FIPS 46-3", "数据加密标准", "DES加密", "Feistel密码", "DEA", "56位密钥", "分组密码", "DES-ECB"],
  },

  des3: {
    what: "3DES (Triple DES): runs DES as 'encrypt-decrypt-encrypt' with 2 or 3 keys — effective key 112/168 bits, the security-hardened version of DES.",
    principle: "3DES (TDEA) EDE mode: $C = E_{K3}(D_{K2}(E_{K1}(P)))$. Three keys K1/K2/K3 each do one DES pass: encrypt with K1, decrypt with K2, encrypt with K3. If K1=K3 (two-key mode, 16 bytes), effective key is 112 bits; three-key mode (24 bytes) is 168 bits. Decryption reverses: $P = D_{K1}(E_{K2}(D_{K3}(C)))$. Block size is still 8 bytes.",
    formulas: [
      { tex: "C = E_{K3}(D_{K2}(E_{K1}(P)))", caption: "3DES EDE encryption: three DES steps" },
    ],
    usage: "Enter plaintext or ciphertext. Params: choose mode, key (16 or 24 bytes), key encoding, ciphertext encoding.",
    examples: [
      { in: "Hello", param: "mode=ECB, key='1234567890abcdef1234567890abcdef'(16-byte two-key)", out: "base64 ciphertext", desc: "3DES-ECB, K1=K3='1234567890abcdef' K2='1234567890abcdef'" },
    ],
    tips: [
      "3DES is 1/3 the speed of DES and still uses 8-byte blocks — superseded by AES.",
      "A 16-byte key = two-key mode (K1=K3); 24 bytes = three-key mode.",
      "The Sweet32 attack can break 3DES within 2³² encryptions — unsuitable for large data volumes.",
    ],
    aka: ["3DES", "TripleDES", "TDEA", "Triple DES", "三重DES", "三重数据加密", "3DES加密", "EDE模式", "DES-EDE", "Triple Data Encryption Algorithm"],
  },

  rc4: {
    what: "RC4 stream cipher: uses a key to initialize a 256-byte state table, then generates a pseudorandom keystream byte by byte and XORs it with the plaintext — self-inverse (encrypt and decrypt are the same operation), once used in WEP/TLS.",
    principle: "RC4 has two steps: ① KSA (Key Scheduling Algorithm): uses the key to shuffle the initial S[0..255] arrangement; ② PRGA (Pseudo-Random Generation Algorithm): each step swaps S[i] and S[j] to generate a pseudorandom byte XORed with a plaintext byte. KSA: `j = (j + S[i] + key[i % keylen]) % 256`, PRGA: `j = (j + S[i]) % 256`. Encrypt and decrypt use the same function (XOR self-inverse).",
    usage: "Enter plaintext (encode) or ciphertext (decode). Params: key (any length), key encoding, ciphertext encoding. Encode and decode use the same key.",
    examples: [
      { in: "Hello", param: "key='Key', outEnc=hex", out: "a3fa1bedd8", desc: "RC4('Hello', 'Key') → 5-byte ciphertext" },
    ],
    tips: [
      "RC4 is proven insecure (initial-byte bias, Fluhrer-Mantin-Shamir attack) — this is why WEP was deprecated.",
      "RC4 is a stream cipher; encrypt and decrypt are the same operation: encode(encode(m, k), k) = m.",
      "In CTF, RC4 shows up in legacy systems — identifying trait: ciphertext length = plaintext length (no padding, no block structure).",
    ],
    aka: ["RC4", "ARC4", "ARCFOUR", "Rivest Cipher 4", "RC4流密码", "流密码", "rivest密码4", "WEP加密", "KSA PRGA", "RC4 stream cipher"],
  },

  xor: {
    what: "XOR repeating-key cipher: cyclically repeats the key and XORs it byte by byte with the plaintext — the simplest and most common CTF encryption, self-inverse.",
    principle: "Plaintext byte $m_i$ is XORed with key byte $k_{i \\bmod \\text{keylen}}$: $c_i = m_i \\oplus k_{i \\bmod \\text{keylen}}$. Decryption uses the same operation: $m_i = c_i \\oplus k_{i \\bmod \\text{keylen}}$. XOR is self-inverse ($a \\oplus k \\oplus k = a$), so encode=decode. When the key is shorter than the plaintext it repeats cyclically — this is XOR encryption's weakness (Kasiski / index of coincidence can find the key length, then break it position by position).",
    formulas: [
      { tex: "c_i = m_i \\oplus k_{i \\bmod n}", caption: "XOR encryption: cyclically repeated key XOR" },
    ],
    usage: "Enter plaintext (encode) or ciphertext (decode). Params: key, key encoding, ciphertext encoding.",
    examples: [
      { in: "Hello", param: "key='ABC', outEnc=hex", out: "09272f2d2d", desc: "H⊕A=0x09 e⊕B=0x27 l⊕C=0x2f l⊕A=0x2d o⊕B=0x2d" },
    ],
    tips: [
      "When the XOR key length < plaintext length, the key repeats cyclically — use xorBrute for single-byte, or frequency analysis for multi-byte keys.",
      "Encode and decode are the same operation: run encode again and it's restored.",
      "If key length = plaintext length and the key is random, it's a one-time pad (OTP) — theoretically unbreakable, but key distribution is the hard part.",
    ],
    aka: ["XOR", "异或加密", "XOR cipher", "重复密钥异或", "异或", "xor运算", "repeating key xor", "循环异或加密", "位异或", "一次一密"],
  },

  rsa: {
    what: "RSA teaching edition: directly input decimal big numbers for modular exponentiation — encrypt $c = m^e \\bmod n$, decrypt $m = c^d \\bmod n$. In CTF, given n/e/d, compute directly.",
    principle: "RSA is based on the hardness of large-number modular exponentiation. Key generation: pick two large primes p, q, $n = pq$, $\\phi = (p-1)(q-1)$, choose $e$ with $\\gcd(e, \\phi) = 1$, compute $d = e^{-1} \\bmod \\phi$. Encrypt: $c = m^e \\bmod n$, decrypt: $m = c^d \\bmod n$. This tool is teaching-grade — no PKCS padding, decimal numbers in and out, modular exponentiation via BigInt. Real RSA needs padding (OAEP/PSS) to be secure.",
    formulas: [
      { tex: "c = m^e \\bmod n \\quad; \\quad m = c^d \\bmod n", caption: "RSA encrypt/decrypt: public key (e,n) encrypts, private key (d,n) decrypts" },
    ],
    usage: "encode: enter plaintext m (decimal) in the input box, params n and e. decode: enter ciphertext c (decimal), params n and d.",
    examples: [
      { in: "65", param: "n=3233, e=17", out: "2790", desc: "Encrypt: 65^17 mod 3233 = 2790" },
      { in: "2790", param: "n=3233, d=2753", out: "65", desc: "Decrypt: 2790^2753 mod 3233 = 65" },
    ],
    tips: [
      "This is the teaching edition — no PEM format handling, no padding. In CTF, plug in the n/e/c/d big numbers directly.",
      "RSA attack tools are in the analysis category (rsaSmallE/rsaWiener/rsaFermat, etc.) — breakable when n is factored or e/d is weak.",
      "Real RSA ciphertext is a hex big number — convert to decimal first, or plug in hex and let BigInt parse it.",
    ],
    aka: ["RSA", "模幂运算", "RSA教学版", "RSA加密", "非对称加密", "公钥密码", "Rivest Shamir Adleman", "RSA算法", "公钥加密", "大数模幂"],
  },

  xorStrings: {
    what: "XOR cyclic-pad: the shorter of plaintext and key is cyclically padded to match the longer side, then XORed byte by byte, self-inverse.",
    principle: "Unlike ordinary XOR: xorStrings treats plaintext and key as equal-length byte strings, cyclically repeating the shorter side until it matches the longer, then XORing byte by byte. For example with a 5-byte plaintext and 2-byte key, the key is cyclically padded to 5 bytes (ABABA) then XORed. Thus ciphertext length = max(plaintext length, key length).",
    usage: "encode: enter plaintext, params key, key encoding, plaintext encoding, ciphertext encoding. decode: enter ciphertext, same params. Self-inverse.",
    examples: [
      { in: "Hello", param: "key='AB', outEnc=hex", out: "09272d2e2e", desc: "Key 'AB' cyclically padded to 'ABABA' then XORed: H⊕A e⊕B l⊕A l⊕B o⊕A" },
    ],
    tips: [
      "Difference from ordinary XOR (key padded to plaintext length): xorStrings ciphertext length = max(plaintext, key), which may exceed the plaintext.",
      "Self-inverse: run decode again with the same key to restore.",
      "Cyclic XOR of two unequal-length data segments.",
    ],
    aka: ["XOR循环补齐", "xor_strings", "循环异或", "XOR extend", "循环补齐异或", "xor strings", "等长循环异或", "cyclic xor", "随波逐流xor_strings", "双串循环异或"],
  },

  cast5: {
    what: "CAST-128/CAST5: an RFC 2144 block cipher — 64-bit blocks, key 5-16 bytes, 12 or 16 Feistel rounds, three round-function types + 8 S-boxes.",
    principle: "CAST-128 is a Feistel network: 64-bit plaintext splits into left/right halves over 12 rounds (key ≤80 bits) or 16 rounds (key >80 bits). Each round uses one of three round-function types (rounds 1/4 use Type 1, rounds 2/5 use Type 2, rounds 3/6 use Type 3, cyclically): each type uses different S-box combinations for byte substitution + key addition + cyclic shifting. There are 8 S-boxes total (4 for key expansion, 4 for the round function), each 256×32 bits. Subkeys are generated from the master key by the key-expansion algorithm.",
    usage: "Enter plaintext or ciphertext. Params: choose mode (ECB/CBC), key (5-16 bytes), key encoding, ciphertext encoding.",
    examples: [
      { in: "Hello", param: "mode=ECB, key='12345678'(8 bytes)", out: "base64 ciphertext", desc: "CAST-128-ECB, 8-byte key=64 bits→12 rounds" },
    ],
    tips: [
      "CAST-128 has an 8-byte block (same as DES), variable key 5-16 bytes — key ≤80 bits uses 12 rounds, >80 bits uses 16 rounds.",
      "CAST-256 is the extension of CAST-128 (128-bit block, AES candidate), but CAST-128 is more common in CTF.",
      "Early PGP versions used CAST-128 as the default symmetric cipher.",
    ],
    aka: ["CAST-128", "CAST5", "RFC 2144", "CAST cipher", "CAST128", "CAST密码", "CAST-5", "Feistel分组密码", "PGP CAST", "CAST-128分组密码"],
  },

  twofish: {
    what: "Twofish: an AES-candidate algorithm designed by Bruce Schneier in 1998 — 128-bit blocks, 16 Feistel rounds, key 128/192/256 bits, using key-dependent S-boxes.",
    principle: "Twofish is a 16-round Feistel network: 128-bit plaintext splits into two 64-bit halves; each round uses two key-dependent S-boxes (generated from the key via the PHT and MDS matrix) for byte substitution, the result mixed through the PHT (Pseudo-Hadamard Transform) then XORed with the other half. It also uses an RS matrix to derive subkeys from the key. Twofish's hallmark is key-dependent S-boxes — the S-box differs for every encryption, boosting security but lowering speed.",
    usage: "Enter plaintext or ciphertext. Params: choose mode (ECB/CBC), key (16/24/32 bytes), key encoding, ciphertext encoding.",
    examples: [
      { in: "Hello", param: "mode=ECB, key='1234567890123456'(16 bytes)", out: "base64 ciphertext", desc: "Twofish-128-ECB, PKCS7 padding" },
    ],
    tips: [
      "Twofish was one of the five AES finalists (ultimately losing to Rijndael) — high security but slightly slower than AES.",
      "Block size is 16 bytes (same as AES), so ciphertext length is a multiple of 16.",
      "Key-dependent S-boxes are Twofish's signature design — different keys produce different S-boxes, so attackers can't precompute them.",
    ],
    aka: ["Twofish", "Schneier AES候选", "Twofish cipher", "双鱼算法", "Twofish加密", "AES候选算法", "Bruce Schneier", "密钥相关S盒", "16轮Feistel", "Twofish分组密码"],
  },
};
