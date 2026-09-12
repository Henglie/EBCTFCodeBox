// English edu shard: modern segment completion 7 (ror13Hash/byteArith/lzstring/hotp/totp/zuc/sm2; cast5/twofish now solely from edu-modern-rest.en.js, bwt from edu-batch5-new.en.js; sm9 moved to edu-sm9-family.js five cards).
// Pure data, no import, no side effects, no register. All examples are actual run values (aligned with authoritative RFC/GM/T vectors).
export default {
  ror13Hash: {
    what: "The most common API-name hash in PE malware — feed a string byte by byte into a \"32-bit rotate-right-13 + accumulate\" state machine, output a 32-bit fingerprint.",
    principle:
      "Maintain a 32-bit accumulator h (initial value 0). For each incoming byte: first rotate h right by 13 bits (ROR13), then add the byte, all mod $2^{32}$.\n\n" +
      "This is the signature trick of Windows shellcode / PE import-table obfuscation — malicious code doesn't store the `LoadLibraryA` string directly, but stores its ROR13 hash, and at runtime walks the export table computing hashes to compare, dodging static signature scans. One-way, irreversible; reverse-lookup relies on a preset API-name table.",
    usage: "Fill the input box with the API name (or any string), select the case param (as-is/lowercase/uppercase), click run to output an 8-digit hex hash. One-way, no decode.",
    formulas: [
      { tex: "h \\leftarrow \\mathrm{ROR}_{13}(h) + b_i \\pmod{2^{32}}", caption: "Each byte: rotate right 13 first, then add the byte" },
    ],
    examples: [
      { in: "LoadLibraryA", param: "case=as-is", out: "0xEC0E4E8E", desc: "The standard PE API hash vector; reverse challenges often give this value to have you reverse-lookup the API name" },
      { in: "GetProcAddress", param: "case=as-is", out: "0x7C0DFCAA", desc: "The ROR13 hash of another high-frequency API" },
    ],
    tips: [
      "When reversing you see a loop with `ror edx, 13` / `rol` paired with accumulation, it's basically this hash — note constants like 0xEC0E4E8E and reverse-lookup them.",
      "Case-sensitive: the challenge often specifies all-lowercase or as-is; if it won't compute, try switching case first.",
      "One-way, irreversible; brute-forcing relies on maintaining an \"API name → hash\" lookup table, while this tool's run is the forward computation.",
    ],
    aka: ["ror13", "pe api hash", "api 哈希", "shellcode 哈希", "ror13 hash", "循环右移哈希", "api name hash", "ror13哈希", "windows api 哈希", "导出表哈希", "rotate right 13", "pe导入哈希"],
  },

  byteArith: {
    what: "Byte-by-byte add/subtract/multiply mod 256 — the most naive byte-level arithmetic transform, often the \"last obfuscation layer\" in reverse challenges.",
    principle:
      "For each byte $b$, compute per operation op and key k: add $b'=(b+k)\\bmod 256$, subtract $b'=(b-k)\\bmod 256$, multiply $b'=(b\\cdot k)\\bmod 256$. Add/subtract are mutual inverses; the inverse of multiplication is multiplying by the modular inverse of k $\\bmod 256$ — but only odd k has an inverse (since only odd numbers are coprime to 256), so an even k is irreversible after encryption.",
    usage: "encode: input text → byte-by-byte operation → Hex string. decode: input Hex → inverse operation → restore text. Select the operation param (add/sub/mul) and key (0-255). mul decryption is only reversible for an odd key.",
    formulas: [
      { tex: "b' = (b \\mathbin{\\text{op}} k) \\bmod 256", caption: "Byte-by-byte arithmetic mod 256" },
    ],
    examples: [
      { in: "Hello", param: "op=add, key=1", out: "49666D6D70 (hex)", desc: "Each byte +1: H(0x48)→0x49 … the inverse of add is subtract, decode restores" },
      { in: "Hello", param: "op=mul, key=3", out: "D82F44444D (hex)", desc: "Each byte ×3 mod 256; 3 is odd and has an inverse (171), decode can restore" },
    ],
    tips: [
      "In mul mode an even key loses information after encryption and can't be reversed — when you see multiplicative obfuscation, first judge the key's parity.",
      "Like XOR, each byte is independent with no block structure — ciphertext length equals plaintext length.",
      "In CTF reversing it's often nested with XOR: byteArith first then XOR; watch the order when peeling the onion.",
    ],
    aka: ["字节算术", "byte arithmetic", "模 256 加减乘", "byte arith", "字节加减乘", "mod 256", "逐字节运算", "字节算术运算", "模256加密", "byte math", "字节级混淆", "加减乘模256"],
  },

  lzstring: {
    what: "A lightweight implementation of LZW dictionary compression (based on the pieroxy/lz-string idea) — build the dictionary while reading, compressing repeated substrings into dictionary indices.",
    principle:
      "The initial dictionary is pre-filled with 256 single-character ASCII entries (indices 0-255). Scan the input: maintain the current match string w; if w+next-char is in the dictionary, keep extending, otherwise output w's index and add w+next-char as a new word to the dictionary.\n\n" +
      "Decompression is symmetric: read the index array and rebuild the dictionary by the same rules to restore the text. This implementation carries the indices in a JSON number array (e.g. `[97,98,256]`), doing no bit-packing — prioritizing strictly correct round-trips. Only supports Latin-1 (0-255); for Chinese and other multi-byte characters, UTF-8 encode first before compressing.",
    usage: "encode: input text → output a JSON number-array string (e.g. `[97,98,256,258,98]`). decode: input that array → restore text. No params.",
    examples: [
      { in: "abababab", param: "(no params)", out: "[97,98,256,258,98]", desc: "ab enters the dictionary first (256), aba (257), abab (258)… repeated substrings compressed into indices" },
      { in: "HelloHello", param: "(no params)", out: "[72,101,108,108,111,256,258,111]", desc: "The second Hello matches dictionary entries like 256=Hello and gets compressed" },
    ],
    tips: [
      "The output is a JSON array of the form `[number,number,…]` — recognizable at a glance, don't confuse it with base64.",
      "The more repeated patterns, the higher the compression ratio; a completely non-repeating random string may actually get longer after compression.",
      "Latin-1 only: compressing Chinese directly errors, so convert to a UTF-8 byte sequence first.",
    ],
    aka: ["lz-string", "lzw 压缩", "lzstring", "字典压缩", "lzw", "lempel-ziv-welch", "lz string", "字典编码压缩", "lzw字典", "lz-string压缩", "滑动字典压缩", "词典压缩"],
  },

  hotp: {
    what: "HOTP — the RFC 4226 counter-based one-time password (HMAC-Based OTP), the kind your hardware token spits out on a keypress.",
    principle:
      "Compute HMAC-SHA1 (also SHA-256/512) with key K and counter C, taking the 20-byte result. Dynamic truncation: take the low 4 bits of the last byte as offset, from offset take 4 bytes, clear the top bit to get a 31-bit integer, then mod $10^{digits}$ for the specified number of digits (usually 6), zero-padded on the left.\n\n" +
      "The counter increments on each use, kept in sync between client and server. One-way (hash), irreversible. In the OTP ecosystem the key is Base32-encoded by default.",
    usage: "Fill the input box with the secret key (default Base32, optionally hex/utf8), fill the counter, digits (6-8), and HMAC algorithm params. Click run to output the OTP digit string. One-way, no decode.",
    formulas: [
      { tex: "\\text{OTP} = \\mathrm{Truncate}(\\mathrm{HMAC}(K, C)) \\bmod 10^{d}", caption: "HMAC + dynamic truncation + modulo" },
    ],
    examples: [
      { in: "12345678901234567890", param: "format=utf8, counter=0, digits=6, SHA-1", out: "755224", desc: "RFC 4226 Appendix D authoritative vector" },
      { in: "12345678901234567890", param: "format=utf8, counter=1, digits=6, SHA-1", out: "287082", desc: "The next OTP after counter +1" },
    ],
    tips: [
      "The key is Base32 by default — a string like `JBSWY3DPEHPK3PXP` given by a challenge is a Base32 key.",
      "The counter must be synced between client/server; a mismatch fails verification; TOTP uses time instead of a counter to solve the sync problem.",
      "The `12345678901234567890` (20-byte ASCII) from RFC 4226 Appendix D is the standard test key, use it for cross-checking.",
    ],
    aka: ["hotp", "计数器 otp", "rfc 4226", "hmac 一次性密码", "hmac-based otp", "hmac otp", "计数器一次性密码", "一次性口令hotp", "hmac based one-time password", "硬件令牌otp", "计数式动态口令", "hotp令牌"],
  },

  totp: {
    what: "TOTP — the RFC 6238 time-based one-time password (Time-Based OTP), the kind Google Authenticator flips through every 30 seconds.",
    principle:
      "HOTP's \"time version\": divide the current Unix time by the step period (usually 30 seconds) to get the counter $C=\\lfloor T/P \\rfloor$, then feed it into HOTP's HMAC + dynamic-truncation flow.\n\n" +
      "Because the counter comes from time, client and server sync just by looking at their own clocks, needing no counter-increment protocol. The time param at 0 uses the current time; a specific value reproduces a historical code (for testing). Supports SHA-1/256/512.",
    usage: "Fill the input box with the secret key (default Base32, optionally hex/utf8), fill the time-step period (default 30 seconds), Unix time (0=current), digits, and HMAC algorithm params. Click run to output the OTP. One-way, no decode.",
    formulas: [
      { tex: "C = \\left\\lfloor \\frac{T_{\\text{unix}}}{P} \\right\\rfloor,\\quad \\text{OTP}=\\mathrm{HOTP}(K, C)", caption: "Convert time to counter, then run HOTP" },
    ],
    examples: [
      { in: "12345678901234567890", param: "format=utf8, time=59, period=30, digits=8, SHA-1", out: "94287082", desc: "RFC 6238 Appendix B authoritative vector (T=59, i.e. 1970-01-01 00:00:59)" },
    ],
    tips: [
      "time=0 uses the current time — the result changes every run; to reproduce, fill a specific Unix timestamp.",
      "Default 30-second step, 6-digit code — exactly matching phone authenticator apps; a challenge giving a QR code / otpauth link is likely it.",
      "The RFC 6238 test vectors use 8-digit codes (digits=8), don't confuse with the common 6-digit.",
    ],
    aka: ["totp", "时间 otp", "rfc 6238", "google authenticator", "time-based otp", "时间一次性密码", "动态验证码", "谷歌验证器", "时间同步otp", "authenticator验证码", "基于时间的一次性口令", "totp动态码"],
  },

  zuc: {
    what: "The ZUC stream cipher — a Chinese national cryptography standard (GB/T 33133.1-2016, formerly GM/T 0001-2012), a domestic scheme for 3GPP LTE communication encryption, on par with Snow and AES-CTR.",
    principle:
      "A 128-bit key + 128-bit IV initialize a 16-stage LFSR (linear feedback over the finite field $\\mathrm{GF}(2^{31}-1)$). Each tick first does \"bit reorganization\" to extract four 32-bit words W0-W3 from the LFSR state, then passes through a nonlinear function F (containing two S-boxes S0/S1 and two linear transforms L1/L2) to output a 32-bit key word.\n\n" +
      "Stream cipher, self-inverse: XOR the keystream byte-by-byte with plaintext to get ciphertext, XOR the same keystream again to restore plaintext. This tool's encode/decode share the same encryption function, differing only in input/output encoding.",
    usage: "Fill the key (16-byte hex) and IV (16-byte hex), select data encoding and output encoding. encode: XOR plaintext into ciphertext (default hex output); decode: XOR ciphertext to restore plaintext (default utf8 output). Self-inverse, same params for encode/decode.",
    examples: [
      { in: "00000000", param: "key=00*16, iv=00*16, dataEnc=hex, outEnc=hex", out: "27BEDE74", desc: "GB/T 33133.1-2016 standard vector: first 4 bytes of keystream for all-0 key/iv" },
      { in: "Hello", param: "key=0123456789abcdef0123456789abcdef, iv=same as key", out: "7149B6DBD1 (hex)", desc: "decode with same params after encode restores Hello" },
    ],
    tips: [
      "Stream cipher — ciphertext and plaintext are equal length (no padding, no block structure), unlike the SM4/AES block ciphers.",
      "Recognizing the Chinese-crypto scenario: 3GPP/mobile communication encryption, GB/T 33133 standard references, likely ZUC.",
      "Both key and IV must be exactly 16 bytes of hex (32 chars); one digit short errors.",
    ],
    aka: ["zuc", "祖冲之", "gm/t 0001", "3gpp 流密码", "祖冲之密码", "祖冲之序列密码", "zuc算法", "国密流密码", "128-eea3", "128-eia3", "商密流密码", "zuc stream cipher"],
  },

  sm2: {
    what: "SM2 — the Chinese national elliptic-curve public-key cryptography (GB/T 32918-2016, formerly GM/T 0003-2012), the domestic counterpart to RSA/ECC. This tool supports full sign/verify and encrypt/decrypt computation.",
    principle:
      "Based on point operations on a 256-bit prime-field elliptic curve (recommended curve sm2p256v1). The encrypted ciphertext uses `C1||C3||C2` assembly: C1 is a 65-byte elliptic curve point (uncompressed format starting with `0x04`), C3 is a 32-byte SM3 hash (for verification), C2 is the ciphertext. Signing derives the hash value e via SM3; ZA is computed from the identifier ID_A and the public key (GB/T 32918.2).\n\n" +
      "This tool implements full operations: sign/verify (GB/T 32918.2-2016) and encrypt/decrypt (GB/T 32918.4-2016), verified byte-for-byte against official examples (load-time self-check). Pick the operation via the mode param; fill private key / public key / identifier accordingly.",
    usage: "Pick mode encrypt/decrypt/sign/verify: encrypt fills pubX/pubY, decrypt fills private key, sign fills private key (public key optional), verify fills public key + r + s. Identifier ID_A defaults to the official sample 1234567812345678.",
    examples: [
      { in: "encryption standard", param: "mode=encrypt, pubX/pubY=official sample public key", out: "04 + C1(65B) + C3(32B) + C2 hex ciphertext", desc: "Official sample encryption" },
      { in: "message digest", param: "mode=sign, privKey=official sample private key", out: "r(32B) + s(32B) hex signature", desc: "Official sample signing" },
      { in: "hello world", param: "mode=verify, mismatched public key + r + s", out: "✗ signature invalid", desc: "Verify-fail path" },
    ],
    tips: [
      "Recognition trait: a hex string starting with `04` and length ≥194 chars (97 bytes), or the same condition after base64 decoding — structurally like SM2 ciphertext.",
      "C1||C3||C2 is the GB/T 32918.4 order; the newer spec (GM/T 0009-2023 SM2 Application Specification) sometimes uses C1||C2||C3, so check the challenge notes.",
      "Private key and public key must be on the same curve (sm2p256v1); if verification fails, first check whether pubX/pubY are correct.",
    ],
    aka: ["sm2", "国密椭圆曲线", "gm/t 0003", "国密公钥密码", "sm2算法", "国密ecc", "商密椭圆曲线", "sm2p256v1", "国密非对称加密", "sm2椭圆曲线密码", "商用密码sm2", "国密公钥算法"],
  },

  // Old sm9 recognition-only card removed: SM9 upgraded to a full five-op family
  // (sm9KeyGen/Sign/Verify/Encrypt/Decrypt); see edu/edu-sm9-family.js (T397 batch 1).
};
