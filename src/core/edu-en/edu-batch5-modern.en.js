// English edu shard: modern segment completion 11 (ror13Hash/byteArith/bwt/lzstring/cast5/twofish/hotp/totp/zuc/sm2/sm9).
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
      "For each byte $b$, compute per operation op and key k: add $b'=(b+k)\\bmod 256$, subtract $b'=(b-k)\\bmod 256$, multiply $b'=(b\\cdot k)\\bmod 256$. Add/subtract are mutual inverses; the inverse of multiplication is multiplying by the modular inverse of k mod 256 — but only odd k has an inverse (since only odd numbers are coprime to 256), so an even k is irreversible after encryption.",
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

  bwt: {
    what: "The Burrows-Wheeler Transform — the core preprocessing step of bzip2 compression. Reversible but not encrypting; it rearranges data into a form where \"identical characters clump together\" for easier compression.",
    principle:
      "Construct all cyclic rotations of the input string, sort them lexicographically, take the last column as the BWT output, and record the row number of the original string in the sorted matrix (primary).\n\n" +
      "After rearrangement, characters with the same context cluster together (e.g. `banana` → `nnbaaa`), aiding subsequent RLE/MTF compression. The inverse uses LF-mapping: starting from primary, iteratively restore by the \"last column → first column\" correspondence. There's also an optional `$` sentinel mode — append a `$` smaller than all characters to the end, so primary is implicitly the position of `$` in the BWT string, and the output needs no index.",
    usage: "encode: input text → output `BWTstring|primary` (separator configurable); sentinel mode outputs a BWT string containing `$`. decode: input the same format → restore. Note sentinel mode requires the original text not contain `$`.",
    examples: [
      { in: "banana", param: "no sentinel (separator |)", out: "nnbaaa|3", desc: "BWT string=nnbaaa, primary=3; decode restores banana" },
      { in: "banana", param: "sentinel mode (add $)", out: "annb$aa", desc: "The position of $ is the implicit primary; decode drops the trailing $" },
    ],
    tips: [
      "Reversible, not encrypting — in CTF it's often a preprocessing layer for compression or steganography; a \"shuffled string + index\" look like `nnbaaa|number` is it.",
      "Sentinel-mode input can't contain `$` (it's commandeered as the EOF marker).",
      "Often chained with MTF (Move-to-Front) and RLE: BWT → MTF → RLE → entropy coding is bzip2's standard pipeline.",
    ],
    aka: ["burrows-wheeler", "bwt 变换", "块排序变换", "bzip2 前置", "bwt", "burrows wheeler transform", "块排序压缩变换", "循环移位排序", "bzip2变换", "b-w变换", "bwt编码", "字符重排变换"],
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

  cast5: {
    what: "CAST-128 (CAST5) — the RFC 2144 block cipher, the default symmetric algorithm of early PGP. 64-bit block, 5-16 byte key, 12 or 16 Feistel rounds.",
    principle:
      "Feistel network: 64-bit plaintext split into left and right halves; a key ≤80 bits (≤10 bytes) runs 12 rounds, >80 bits runs 16 rounds. Each round uses one of three round functions (cycling Type 1/2/3 by round number), each using a different S-box combination for byte substitution + key add/xor/subtract + rotation. There are 8 S-boxes total (S1-S4 for round functions, S5-S8 for key expansion), each 256×32 bits, with data copied verbatim from RFC 2144 Appendix A. Subkeys are derived from the master key by key expansion; decryption uses the same structure with reversed round keys.",
    usage: "Fill the key (5-16 bytes), select the mode (ECB/CBC, CBC needs an IV), and the key encoding and ciphertext encoding. encode encrypts, decode decrypts. 8-byte block, PKCS7 padding.",
    examples: [
      { in: "Hello", param: "mode=ECB, key='12345678'(8 bytes), outEnc=base64", out: "0nHCcDfF0Ys=", desc: "8-byte key = 64 bits → 12 rounds; decode with same params restores" },
    ],
    tips: [
      "8-byte block (same as DES), ciphertext length is a multiple of 8 — distinguish from AES's 16-byte block.",
      "Key length determines rounds: ≤10 bytes 12 rounds, >10 bytes 16 rounds.",
      "It was early PGP's default; when a challenge mentions PGP but the block size doesn't look like AES/DES, think CAST5.",
    ],
    aka: ["cast-128", "cast5", "rfc 2144", "pgp 默认密码"],
  },

  twofish: {
    what: "Twofish — one of the AES top-five finalists designed by Schneier in 1998, 128-bit block, 16 Feistel rounds, signature feature is \"key-dependent S-boxes\".",
    principle:
      "128-bit plaintext split into four 32-bit words, 16 rounds. Each round uses two key-dependent S-boxes for byte substitution — the S-boxes are derived from the key via fixed q0/q1 permutations + an MDS matrix (GF(2⁸), polynomial 0x169), so the S-boxes differ every encryption. The result is mixed by PHT and XORed with the other half, then combined with round subkeys derived from an RS matrix (GF(2⁸), polynomial 0x14D). Key is 128/192/256 bits, and input/output also do a whitening XOR. Decryption reuses the same structure with reversed round keys.\n\n" +
      "The key-dependent S-boxes are its biggest difference from AES — an attacker can't precompute a fixed S-box, giving high security but slightly slower speed than Rijndael, which ultimately lost the AES selection.",
    usage: "Fill the key (16/24/32 bytes), select the mode (ECB/CBC, CBC needs an IV), and the key encoding and ciphertext encoding. encode encrypts, decode decrypts. 16-byte block, PKCS7 padding.",
    examples: [
      { in: "Hello", param: "mode=ECB, key='1234567890123456'(16 bytes), outEnc=base64", out: "kZd8pH5FNfZ4CuHQVqR52w==", desc: "Twofish-128 ECB; decode with same params restores" },
    ],
    tips: [
      "16-byte block (same as AES) → ciphertext is a multiple of 16.",
      "One of the AES top five (alongside Rijndael/MARS/RC6/Serpent); when reversing, key-derived S-boxes + an MDS matrix is likely it.",
      "The key must be one of 16/24/32 bytes; other lengths error out directly.",
    ],
    aka: ["twofish", "schneier aes 候选", "密钥相关 s-box"],
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
    what: "The ZUC stream cipher — a Chinese national cryptography standard (GM/T 0001-2012), a domestic scheme for 3GPP LTE communication encryption, on par with Snow and AES-CTR.",
    principle:
      "A 128-bit key + 128-bit IV initialize a 16-stage LFSR (linear feedback over the finite field $\\mathrm{GF}(2^{31}-1)$). Each tick first does \"bit reorganization\" to extract four 32-bit words W0-W3 from the LFSR state, then passes through a nonlinear function F (containing two S-boxes S0/S1 and two linear transforms L1/L2) to output a 32-bit key word.\n\n" +
      "Stream cipher, self-inverse: XOR the keystream byte-by-byte with plaintext to get ciphertext, XOR the same keystream again to restore plaintext. This tool's encode/decode share the same encryption function, differing only in input/output encoding.",
    usage: "Fill the key (16-byte hex) and IV (16-byte hex), select data encoding and output encoding. encode: XOR plaintext into ciphertext (default hex output); decode: XOR ciphertext to restore plaintext (default utf8 output). Self-inverse, same params for encode/decode.",
    examples: [
      { in: "00000000", param: "key=00*16, iv=00*16, dataEnc=hex, outEnc=hex", out: "27BEDE74", desc: "GM/T 0001-2012 standard vector: first 4 bytes of keystream for all-0 key/iv" },
      { in: "Hello", param: "key=0123456789abcdef0123456789abcdef, iv=same as key", out: "7149B6DBD1 (hex)", desc: "decode with same params after encode restores Hello" },
    ],
    tips: [
      "Stream cipher — ciphertext and plaintext are equal length (no padding, no block structure), unlike the SM4/AES block ciphers.",
      "Recognizing the Chinese-crypto scenario: 3GPP/mobile communication encryption, GM/T 0001 standard references, likely ZUC.",
      "Both key and IV must be exactly 16 bytes of hex (32 chars); one digit short errors.",
    ],
    aka: ["zuc", "祖冲之", "gm/t 0001", "3gpp 流密码", "祖冲之密码", "祖冲之序列密码", "zuc算法", "国密流密码", "128-eea3", "128-eia3", "商密流密码", "zuc stream cipher"],
  },

  sm2: {
    what: "SM2 — the Chinese national elliptic-curve public-key cryptography (GM/T 0003-2012), the domestic counterpart to RSA/ECC. This tool only does ciphertext-structure recognition, no encrypt/decrypt computation.",
    principle:
      "Based on point operations on a 256-bit prime-field elliptic curve (recommended curve sm2p256v1). The encrypted ciphertext uses `C1||C3||C2` assembly: C1 is a 65-byte elliptic curve point (uncompressed format starting with `0x04`), C3 is a 32-byte SM3 hash (for verification), C2 is the ciphertext.\n\n" +
      "This tool's recognition logic is naive: after decoding the input as hex/base64, if the length is ≥97 bytes and the first byte is `0x04`, it's judged as suspected SM2 (confidence 0.7/0.6). Real encrypt/decrypt requires a full ECC point-multiplication implementation, not currently supported — in CTF, first recognize the structure, use a dedicated library for computation.",
    usage: "Fill the input box with suspected SM2 ciphertext (hex or base64), click run to output the recognition result and confidence. No params, no encrypt/decrypt, no decode.",
    examples: [
      { in: "04 + 00 repeated 96 times (194 hex chars)", param: "(no params)", out: "Recognized as SM2 ciphertext (confidence 0.7): format C1||C3||C2…", desc: "First byte 04 and length ≥97 bytes triggers recognition" },
      { in: "hello world", param: "(no params)", out: "Not recognized as SM2 ciphertext", desc: "Ordinary text doesn't match" },
    ],
    tips: [
      "Recognition trait: a hex string starting with `04` and length ≥194 chars (97 bytes), or the same condition after base64 decoding — structurally like SM2.",
      "C1||C3||C2 is the old standard order; the new standard (GM/T 0009) sometimes uses C1||C2||C3, so check the challenge notes.",
      "To actually decrypt, use a library with full ECC (e.g. Python gmssl / GmSSL); this tool only recognizes the shell.",
    ],
    aka: ["sm2", "国密椭圆曲线", "gm/t 0003", "国密公钥密码", "sm2算法", "国密ecc", "商密椭圆曲线", "sm2p256v1", "国密非对称加密", "sm2椭圆曲线密码", "商用密码sm2", "国密公钥算法"],
  },

  sm9: {
    what: "SM9 — the Chinese national identity-based cryptography (GM/T 0044-2016), signature feature being \"use email/phone number as the public key\" bilinear-pairing cryptography. This tool only does keyword recognition, no computation.",
    principle:
      "An identity-based cryptography system based on bilinear pairing: the user's public key is generated directly from an identity (e.g. `alice@example.com`) hash-mapped to a point on the elliptic curve, and the private key is issued by a Key Generation Center (KGC) using a master key. Signing/key-encapsulation both use the properties of the bilinear pairing.\n\n" +
      "Because bilinear-pairing operations are complex and have no fixed short prefix, this tool's recognition is crude: only judges as suspected when the input text contains the `sm9` keyword (low confidence 0.5). Real computation requires a full pairing implementation, not currently supported.",
    usage: "Fill the input box with any text, click run to output the recognition result. No params, no encrypt/decrypt, no decode.",
    examples: [
      { in: "sm9 identity-based crypto", param: "(no params)", out: "Recognized as SM9-related input (confidence 0.5). SM9 is based on bilinear pairing; computation not currently supported.", desc: "Containing the sm9 keyword triggers recognition" },
      { in: "ordinary text", param: "(no params)", out: "Not recognized as SM9 input", desc: "No sm9 wording, no match" },
    ],
    tips: [
      "SM9 ciphertext/signatures have no fixed prefix like SM2 — recognizing by structural features is hard, so this tool relies on the keyword alone.",
      "Recognizing the scenario: a challenge mentioning \"identity-based cryptography / IBC / bilinear pairing / KGC / email as public key\" is basically SM9.",
      "Computation needs a dedicated library (e.g. GmSSL, the PBC library); this tool only marks, it doesn't compute.",
    ],
    aka: ["sm9", "标识密码", "gm/t 0044", "双线性对密码", "ibc", "sm9算法", "基于标识的密码", "identity-based cryptography", "国密标识密码", "商密sm9", "标识加密", "身份基密码"],
  },
};
