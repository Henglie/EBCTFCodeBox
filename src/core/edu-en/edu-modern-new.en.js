/*
 * edu-modern-new.en.js — English edu shard (T310, modern crypto + hash/derivation).
 *
 * Covers the edu cards for 4 genuinely-missing ops:
 * modern: rabbit
 * hash: pbkdf2, hkdf, md2
 *
 * Pure data, no side effects, no import, no register. Merged in eduContent.js.
 * EduEntry format per the eduContent.js header comment contract.
 */
export default {
 // ============ modern: FlashSwirl stream cipher ============
  flashSwirl: {
    what: "FlashSwirl — an ARX (Add-Rotate-XOR) symmetric stream cipher designed by author 风之暇想, with a 256-bit key + 192-bit nonce. Its structure is inspired by ChaCha20, but uses a dual Quarter Round + diagonal-mixing state-stirring strategy.",
    principle:
      "The internal state is 8 32-bit words $[s_0, s_1, \\ldots, s_7]$ (256 bits total); the core is two levels of operation, Quarter Round and Swirl Round.\n\n" +
      "Quarter Round: ARX-mixes 4 words $(a,b,c,d)$ — `a+=b; d=(d⊕a)<<<16; c+=d; b=(b⊕c)<<<12; a+=b; d=(d⊕a)<<<8; c+=d; b=(b⊕c)<<<7` — using only modulo-$2^{32}$ addition, circular left rotation, and XOR, giving natural resistance to linear/differential attacks.\n\n" +
      "Swirl Round: first runs one Quarter Round each over $(s_0..s_3)$ and $(s_4..s_7)$, then runs one each over the diagonals $(s_0,s_5,s_2,s_7)$ and $(s_1,s_4,s_3,s_6)$ — the diagonal mixing lets the two state groups diffuse fully.\n\n" +
      "Keystream: take $\\text{fixed initial state} \\oplus \\text{key} \\oplus \\text{nonce}$ as the base block, mix in a 64-bit counter, run 8/20 Swirl Rounds, then add back the original state (ChaCha-style finalization to prevent inversion), outputting a 32-byte keystream block XORed with the plaintext.\n\n" +
      "Encryption and decryption are identical: ciphertext = plaintext ⊕ keystream, and decryption XORs again with the same key/nonce to recover it.",
    usage: "Enter text in the input box; for parameters, key is 64 hex digits (32 bytes), nonce is 48 hex digits (24 bytes), and rounds selects 20 (standard) or 8 (fast). Encode outputs hex ciphertext; decode with the same key/nonce/rounds recovers it.",
    examples: [
      { in: "Hello", param: "key=64 hex, nonce=48 hex, rounds=20", out: "(hex ciphertext)", desc: "symmetric stream cipher; encryption and decryption use the same key+nonce, ciphertext = plaintext ⊕ keystream" },
    ],
    formulas: [
      { tex: "a \\mathrel{+}= b;\\ d = (d \\oplus a) \\lll 16;\\ c \\mathrel{+}= d;\\ b = (b \\oplus c) \\lll 12", caption: "The first half of FlashSwirl's Quarter Round (ARX: Add-Rotate-XOR)" },
    ],
    tips: [
      "FlashSwirl's key must be 32 bytes (64 hex) and the nonce must be 24 bytes (48 hex); anything shorter errors out.",
      "Rounds has only two settings, 8 (fast) and 20 (standard); any other value falls back to 10 Swirl Rounds.",
      "Like ChaCha20 it is an ARX stream cipher; the difference is FlashSwirl uses dual Quarter Round + diagonal mixing, a 256-bit state, and a 192-bit nonce.",
      "In CTF, when a challenge gives the key/nonce/rounds and hex ciphertext, just fill in the parameters and decode.",
    ],
    aka: ["flashswirl", "闪旋", "闪旋算法", "FlashSwirl", "闪旋流密码", "风之暇想", "FlashSwirl cipher", "ARX流密码", "闪旋加密", "flash swirl", "FlashSwirl-20", "FlashSwirl-8", "闪旋对称加密"],
  },

 // ============ modern: Rabbit stream cipher ============
  rabbit: {
    what: "Rabbit stream cipher — a high-speed symmetric stream cipher defined in RFC 4503, using a 128-bit key + 64-bit IV to generate a keystream, then XORing it with the plaintext.",
    principle:
      "The core is 8 32-bit state variables X[0..7] and 8 counters C[0..7], plus a 1-bit carry b.\n\n" +
      "Key setup: split the 16-byte key into 8 16-bit subkeys K[0..7], initialize X and C by different formulas for even/odd indices, iterate nextState 4 times, then cross-XOR C with X.\n\n" +
      "IV setup: split the 8-byte IV into 4 16-bit fragments, mix them into C per RFC 4503 §2.4, then iterate nextState 4 times.\n\n" +
      "nextState: first update the counters (with a carry chain), then use the g function $g(u) = \\text{low}_{32}(u^2) \\oplus \\text{high}_{32}(u^2)$ to compute G[0..7], finally update X by rotate-and-add formulas. To extract keystream, XOR the 16-bit half-words of X to output a 16-byte block.\n\n" +
      "Encryption and decryption are identical: ciphertext = plaintext ⊕ keystream, and decryption XORs again with the same key/IV to recover it.",
    usage: "Enter text in the input box; for parameters, key is 32 hex digits (16 bytes) and iv is 16 hex digits (8 bytes). Encode outputs hex ciphertext; decode with the same key/iv recovers the text.",
    examples: [
      { in: "Hello", param: "key=00000000000000000000000000000000, iv=0000000000000000", out: "(hex ciphertext)", desc: "the all-zero key/IV RFC 4503 §3 test-vector scenario; encode/decode are symmetric and reversible" },
    ],
    formulas: [
      { tex: "g(u) = \\text{lo}_{32}(u^2) \\oplus \\text{hi}_{32}(u^2)", caption: "Rabbit's g function: square, then XOR the high and low 32 bits" },
    ],
    tips: [
      "Rabbit's key must be 16 bytes (32 hex) and the IV must be 8 bytes (16 hex); anything shorter errors out.",
      "Stream-cipher trait: encryption and decryption use the same key+IV, ciphertext = plaintext ⊕ keystream.",
      "In CTF, when a challenge gives Rabbit parameters and ciphertext, just fill in the key/iv and decode.",
    ],
    aka: ["rabbit", "rabbit流密码", "rfc 4503", "Rabbit", "Rabbit cipher", "兔子流密码", "Rabbit stream cipher", "eSTREAM", "高速流密码", "对称流密码", "Rabbit加密", "128位流密码"],
  },

 // ============ hash: PBKDF2 key derivation ============
  pbkdf2: {
    what: "PBKDF2 — a password-based key derivation function that hashes a weak password + salt many times over, stretching it into a key of a specified length.",
    principle:
      "PBKDF2 (Password-Based Key Derivation Function 2, RFC 2898/8018) iterates using a pseudo-random function PRF (usually HMAC-SHA-256):\n\n" +
      "$$DK = T_1 \\| T_2 \\| \\cdots \\| T_{dkLen/hLen}$$\n" +
      "where each block $T_i = F(\\text{Password}, \\text{Salt}, c, i)$, and $F$'s iteration is $U_1 = \\text{PRF}(P, S \\| i)$, $U_2 = \\text{PRF}(P, U_1)$, …, $U_c = \\text{PRF}(P, U_{c-1})$, with the final $T_i = U_1 \\oplus U_2 \\oplus \\cdots \\oplus U_c$.\n\n" +
      "The larger the iteration count c, the slower brute-forcing becomes and the higher the security (typically 10 thousand to 100 thousand). This tool uses the native WebCrypto subtle.deriveBits implementation.",
    usage: "Enter the password (UTF-8) in the input box; for parameters, salt is the salt value, saltFormat picks the format (utf8/hex/base64), iterations is the iteration count (default 1000), keyLen is the output byte length (default 32), and hash picks the hash algorithm (SHA-1/256/384/512). Output is a hex string.",
    examples: [
      { in: "password", param: "salt=salt, saltFormat=utf8, iterations=1, keyLen=20, hash=SHA-1", out: "0c60c80f961f0e71f3a9b524af6012062fe037a6", desc: "RFC 6070 official test vector (PBKDF2-HMAC-SHA1)" },
    ],
    formulas: [
      { tex: "T_i = U_1 \\oplus U_2 \\oplus \\cdots \\oplus U_c,\\quad U_j = \\text{PRF}(P, U_{j-1})", caption: "PBKDF2's per-block iterative-XOR structure" },
    ],
    tips: [
      "In CTF, given the password, salt, iteration count, and algorithm you can compute the key — all the parameters are in the challenge text.",
      "iterations is the security core: real systems use 100 thousand+ to resist brute force, while CTF challenges often give a small value for easy computation.",
      "Difference from HKDF: PBKDF2 stretches a weak password by repeated iteration, while HKDF expands an existing high-entropy key via extract+expand.",
    ],
    aka: ["pbkdf2", "密钥派生", "rfc 2898", "rfc 8018", "password based key derivation", "PBKDF2", "基于口令的密钥派生", "口令派生密钥", "PKCS#5", "密码拉伸", "key stretching", "迭代哈希派生", "PBKDF2-HMAC"],
  },

 // ============ hash: HKDF key derivation ============
  hkdf: {
    what: "HKDF — an HMAC-based key derivation function that extracts and refines a piece of input keying material (IKM) then expands it into a key of a specified length.",
    principle:
      "HKDF (HMAC-based Key Derivation Function, RFC 5869) has two steps:\n\n" +
      "Extract: apply one HMAC over the IKM using the salt, yielding a fixed-length pseudo-random key PRK: $PRK = \\text{HMAC}(\\text{salt}, \\text{IKM})$. When salt is empty, an all-zero string is used.\n\n" +
      "Expand: use PRK and an info context string to iteratively generate key blocks of the required length: $OKM = T(1) \\| T(2) \\| \\cdots$, where $T(0)$ is empty and $T(i) = \\text{HMAC}(PRK, T(i-1) \\| \\text{info} \\| i)$.\n\n" +
      "This tool uses the native WebCrypto subtle.deriveBits implementation; IKM / salt / info all support the utf8/hex/base64 formats.",
    usage: "Enter the IKM (input keying material) in the input box; for parameters, ikmFormat picks the IKM format, salt/saltFormat set the salt (may be empty), info/infoFormat set the context (may be empty), keyLen is the output byte length (default 32), and hash picks the hash algorithm. Output is a hex string.",
    examples: [
      { in: "0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b", param: "ikmFormat=hex, salt=000102030405060708090a0b0c, saltFormat=hex, info=f0f1f2f3f4f5f6f7f8f9, infoFormat=hex, keyLen=42, hash=SHA-256", out: "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865", desc: "RFC 5869 test case 1 (HKDF-SHA256)" },
    ],
    formulas: [
      { tex: "PRK = \\text{HMAC}(\\text{salt},\\,\\text{IKM}),\\quad T(i) = \\text{HMAC}(PRK,\\,T(i{-}1)\\|\\text{info}\\|i)", caption: "HKDF's extract + expand two steps" },
    ],
    tips: [
      "HKDF suits scenarios where the IKM already has enough entropy (e.g. a DH shared secret); it does not rely on iteration for brute-force resistance.",
      "info is used to derive the same PRK into keys for different purposes (session key/IV/MAC key, etc.); changing info yields a different output.",
      "Difference from PBKDF2: PBKDF2 stretches a weak password via iteration, while HKDF refines high-entropy IKM via extract+expand.",
    ],
    aka: ["hkdf", "密钥派生", "rfc 5869", "hmac based key derivation", "HKDF", "基于HMAC的密钥派生", "extract expand", "提取扩展", "HKDF-SHA256", "HMAC密钥派生函数", "密钥扩展", "OKM派生"],
  },

 // ============ hash: MD2 digest ============
  md2: {
    what: "MD2 — a 128-bit message-digest algorithm designed early on by RSA Laboratories (RFC 1319), optimized for 8-bit machines. Now insecure, but it still shows up in CTF.",
    principle:
      "MD2 processing flow:\n\n" +
      "1. Padding: pad the message to a multiple of 16 bytes, appending i bytes each of value i (i = 16 - len%16, always 1..16).\n\n" +
      "2. Checksum: update a 16-byte checksum block by block, with each byte `checksum[j] ^= S[msg[off+j] ^ L]`, where L is the previous round's checksum value and S is the 256-byte pi permutation table.\n\n" +
      "3. Main loop: a 48-byte state X; for each 16-byte block (including the appended checksum block), do 18 rounds of updates: `X[j] ^= S[t]` (t is the previous round's ending value), and after each round `t = (t + round) & 0xff`.\n\n" +
      "Finally take the first 16 bytes of X as the 128-bit digest. WebCrypto does not support MD2, so this tool is a pure-JS implementation verified against the RFC 1319 appendix.",
    usage: "Enter text in the input box, click run to output the 128-bit (32-hex) digest. One-way and irreversible, no parameters.",
    examples: [
      { in: "", out: "8350e5a3e24c153df2275c9f80692773", desc: "RFC 1319 empty-string test vector" },
      { in: "a", out: "32ec01ec4a6dac72c0ab96fb34c0b5d1", desc: "RFC 1319 single-character test vector" },
    ],
    tips: [
      "MD2 has been proven insecure by cryptographers (collision attacks exist); modern systems don't use it, but it still appears in old CTF challenges.",
      "Output is a fixed 128 bits (32 hex characters), same length as MD4/MD5 but a completely different algorithm.",
      "Recognition signature: a challenge gives a 32-hex string and hints at an old-style digest optimized for 8-bit machines → think MD2.",
    ],
    aka: ["md2", "md2摘要", "rfc 1319", "rsa md2", "MD2", "MD2哈希", "Message Digest 2", "消息摘要2", "MD2算法", "128位摘要", "MD2 hash", "RSA实验室摘要"],
  },
};
