/*
 * edu-p0-20261025.en.js — English cards for the v0.1.12 P0 batch.
 * Source: src/core/edu/edu-p0-20261025.js (Chinese), translated 1:1.
 * Examples are copied verbatim. Pure data, no imports.
 */
export default {
  chacha20Poly1305: {
    what: "The RFC 8439 AEAD (authenticated encryption with associated data): ChaCha20 encrypts, Poly1305 authenticates. TLS 1.3, WireGuard and QUIC use it; a key+nonce pair must never encrypt two messages.",
    principle:
      "ChaCha20 arranges a 32-byte key, 12-byte nonce and 32-bit block counter into a state matrix, runs 20 rounds and produces a 64-byte keystream block; the counter starts at 1, and $C = P \\oplus KS$.\n\nThe one-time Poly1305 key $otk$ is the first 32 bytes of block 0; Poly1305 authenticates `AAD ‖ pad16(AAD) ‖ C ‖ pad16(C) ‖ le64(|AAD|) ‖ le64(|C|)` into a 16-byte tag. Decryption must verify the tag before returning plaintext.",
    usage:
      "Encrypt: fill `key` (32B hex), `nonce` (12B hex), `aad` (hex, optional), choose text/hex input, and get `ciphertext‖16B tag` as hex.\n\nDecrypt: paste `ciphertext‖tag`, or provide the 16B tag separately; a bad tag fails immediately.",
    examples: [
      { in: "hello", param: "key=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f, nonce=000102030405060708090a0b, aad=empty, inputMode=text", out: "e19e646c46f5939695c670586d63a69f58c41396dd", desc: "10B ciphertext + 16B tag; flipping any bit makes decryption fail" },
      { in: "e19e646c46f5939695c670586d63a69f58c41396dd", param: "same key/nonce, aad=empty", out: "hello", desc: "Reverse direction" },
    ],
    tips: [
      "Ciphertext length equals plaintext length, plus a 16-byte tag; there is no block padding.",
      "The nonce is 12 bytes, not the old 8-byte ChaCha20 nonce; reusing key+nonce leaks both the keystream and the Poly1305 one-time key.",
      "A tag failure is a failure; do not try to decrypt while ignoring the tag.",
      "A 16-byte trailing tag and a 12-byte nonce are good hints for ChaCha20-Poly1305.",
    ],
    aka: ["ChaCha20-Poly1305", "AEAD_CHACHA20_POLY1305", "chacha20poly1305", "chacha20-poly1305",
      "RFC 8439 ChaCha20-Poly1305", "IETF ChaCha20-Poly1305", "ChaCha20-Poly1305 AEAD", "ChaCha20 authenticated encryption",
      "ChaCha20-Poly1305 AEAD cipher", "TLS ChaCha20-Poly1305", "TLS_CHACHA20_POLY1305_SHA256", "chacha20_poly1305",
      "ChaCha20-Poly1305 encrypt/decrypt"],
  },

  poly1305: {
    what: "Poly1305 is Bernstein's one-time message authentication code, producing a 16-byte tag. It authenticates but does not encrypt; inside ChaCha20-Poly1305 it seals the ciphertext.",
    principle:
      "The 32-byte one-time key splits into r (first 16 bytes, clamped) and s (last 16 bytes). The message is split into 16-byte blocks, each padded with a 1 bit and read as a little-endian integer, then iterated over the prime $p = 2^{130}-5$: $acc \\leftarrow ((acc + m_i) \\cdot r) \\bmod p$; finally $tag = (acc + s) \\bmod 2^{128}$.",
    usage: "Fill `key` (32B hex), enter the message, choose text/hex input, and get a 16-byte tag in hex. MAC only; there is no inverse.",
    examples: [
      { in: "Cryptographic Forum Research Group", param: "key=85d6be7857556d337f4452fe42d506a80103808afb0db2fd4abff6af4149f51b, inputMode=text", out: "a8061dc1305136c6c22b8baf0c0127a9", desc: "RFC 8439 §2.5.2 official vector" },
      { in: "", param: "same key", out: "0103808afb0db2fd4abff6af4149f51b", desc: "The empty-message tag equals s" },
    ],
    tips: [
      "The 16-byte tag is fixed; it is not a 32-byte hash.",
      "A one-time key must be used for exactly one message; reuse breaks security.",
      "In AEAD the Poly1305 key is not the user key; it is the first 32 bytes of ChaCha20 block 0.",
      "An empty message still has a valid tag (equal to s); it is not an error.",
    ],
    aka: ["Poly1305", "Poly1305 MAC", "Poly1305 message authentication code", "poly1305 mac", "RFC 8439 Poly1305",
      "Poly1305 one-time authenticator", "Poly1305 one-time MAC", "Bernstein Poly1305", "poly1305 tag",
      "Poly1305 authentication tag", "Poly1305 key", "Poly1305 calculator"],
  },

  ghash: {
    what: "GHASH is the authentication hash inside GCM: it evaluates a polynomial over AAD and ciphertext in GF(2^128) with H. It is not the full GCM tag, but it is the key to understanding GCM authentication and nonce reuse.",
    principle:
      "GCM first computes $H = E_K(0^{128})$, pads AAD/ciphertext to 16-byte blocks, and iterates $Y_i = (Y_{i-1} \\oplus X_i) \\cdot H$ in GF(2^128), then absorbs the length block. The final tag also XORs $E_K(J_0)$; this op computes GHASH only.",
    usage: "Fill `H` (16B hex), `aad` (hex, optional), and the ciphertext (hex) as the main input; output is the 16-byte GHASH. To get a GCM tag, XOR $E_K(J_0)$ yourself.",
    examples: [
      { in: "0388dace60b6a392f328c2b971b2fe78", param: "H=66e94bd4ef8a2c3b884cfa59ca342b2e, aad=empty", out: "f38cbb1ad69223dcc3457ae5b6b0f885", desc: "NIST GCM Test Case 2" },
      { in: "42831ec2217774244b7221b784d0d49ce3aa212f2c02a4e035c17e2329aca12e21d514b25466931c7d8f6a5aac84aa051ba30b396a0aac973d58e091", param: "H=b83b533708bf535d0aa6e52980d53b78, aad=feedfacedeadbeeffeedfacedeadbeefabaddad2", out: "698e57f70e6ecc7fd9463b7260a9ae5f", desc: "NIST GCM Test Case 4" },
    ],
    tips: [
      "H is not the user key; it is AES applied to the all-zero block.",
      "GCM tag ≠ GHASH: the tag also XORs $E_K(J_0)$.",
      "AAD/ciphertext are zero-padded to 16-byte blocks; the length block counts bits.",
      "This op does not implement the GCM forbidden attack; do not use GHASH as a tag-forgery tool.",
    ],
    aka: ["GHASH", "GHASH function", "GCM GHASH", "Galois hash", "Galois field hash", "GHASH H",
      "GHASH authentication", "NIST SP 800-38D GHASH", "GHASH calculation", "GCM authentication hash", "GF(2^128) multiply", "GHASH authentication block"],
  },

  aeadNonceReuse: {
    what: "Shows what happens when ChaCha20-Poly1305 encrypts two messages with the same key+nonce: both ciphertexts share the keystream and the Poly1305 one-time key; knowing one plaintext recovers the other.",
    principle:
      "With the same key+nonce, $C_1 = P_1 \\oplus KS$ and $C_2 = P_2 \\oplus KS$, so $C_1 \\oplus C_2 = P_1 \\oplus P_2$. Knowing $P_1$ recovers $KS = C_1 \\oplus P_1$, then $P_2 = C_2 \\oplus KS$. Both tags still verify because authentication cannot stop cross-message recovery.",
    usage: "Paste two ciphertext hex strings (newline/pipe/comma separated, each ending in a 16B tag); fill the shared `key`/`nonce`/`aad`; choose `knownMode` and put the plaintext for ct1 in `known`. Outputs the recovered keystream, P2 and tag-verification result.",
    examples: [
      { in: "e88f7c614a7c8521c3a35b92ef73af52a0bc4333b0f2169aa931fc88514e\nfb9e7c724c76d160d9ec48d2b9339a7cbaca5de56e7bc7805eac3137fc", param: "key=000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f, nonce=000102030405060708090a0b, aad=empty, known=attack at dawn", out: "retreat now!!", desc: "Recovered P2; both tags verify" },
    ],
    tips: [
      "This is not breaking ChaCha20; it is a nonce-management failure that reuses the keystream.",
      "The two ciphertexts may have different lengths; the shorter one only recovers a prefix.",
      "When tags are present, both are verified first to ensure they really share key+nonce.",
      "This op explicitly does not implement the GCM forbidden attack.",
    ],
    aka: ["AEAD nonce reuse", "nonce reuse attack", "ChaCha20-Poly1305 nonce reuse", "ChaCha20 nonce reuse",
      "stream cipher nonce reuse", "known-plaintext keystream recovery", "known plaintext keystream recovery", "ChaCha20 keystream reuse",
      "AEAD keystream reuse", "nonce reuse known-plaintext attack", "Poly1305 one-time key reuse", "keystream reuse"],
  },

  pqcBlobParse: {
    what: "Given an unknown post-quantum blob (public key, private key, KEM ciphertext or signature), classify its standard, parameter set, object type and expected length. It does not verify, decrypt or validate certificates; it only parses format/length/OID.",
    principle:
      "ML-KEM (FIPS 203), ML-DSA (FIPS 204) and SLH-DSA (FIPS 205) have fixed lengths. Only an OID parsed from PEM SPKI/PKCS#8 can justify calling it a standard encoding; raw hex is matched by length and must report ambiguity (for example ML-KEM-1024 ek and ct are both 1568B).",
    usage: "Paste PEM / DER hex / raw hex; `format` selects auto/PEM/DER/raw/base64, `kind` filters the object and `scheme` filters the algorithm. The report shows source, OID, parameter set, expected/actual length, ambiguous candidates and limitations.",
    examples: [
      { in: "1568 bytes of zero raw hex", param: "format=raw, kind=auto", out: "Candidates: ML-KEM-1024 public key / ML-KEM-1024 KEM ciphertext (length ambiguity)", desc: "Without an OID it only reports a length match" },
      { in: "SPKI PEM, OID=2.16.840.1.101.3.4.4.2, BIT STRING 1184B", param: "format=auto", out: "ML-KEM-768 public key, length 1184/1184 ✓", desc: "An OID makes the identification unique" },
    ],
    tips: [
      "ML-KEM-1024 ek and ct are both 1568B; a bare length cannot decide the type.",
      "SLH-DSA pk is only 32/48/64B and sk 64/96/128B; the same length spans SHA2/SHAKE parameter sets.",
      "PKCS#8 may store a seed form (ML-DSA 32B, ML-KEM 64B), much shorter than the expanded private key.",
      "CERTIFICATE is not parsed; extract SPKI first.",
      "Without an OID, call it a candidate, not an identification.",
    ],
    aka: ["PQC blob parser", "post-quantum blob parser", "ML-KEM length identification", "ML-DSA length identification",
      "SLH-DSA length identification", "PQC public key length", "PQC private key length", "PQC signature length", "Kyber blob", "Dilithium blob",
      "SPHINCS+ blob", "PQC OID identification", "FIPS 203 length", "FIPS 204 length", "FIPS 205 length"],
  },

  ntruPack: {
    what: "Packs an NTRU coefficient array into hex at fixed widths: q coefficients use 11 bits, ternary coefficients 2 bits. It is a coefficient-to-byte serializer, not encryption or key generation.",
    principle:
      "EESS #1 uses N∈{401,439,659}, q=2048, p=3. Each q coefficient takes 11 bits; ternary 0→00, 1→01, -1→10 (11 is illegal); the bitstream is big-endian with zero padding; an optional 1-byte parameter-set tag can prefix it.",
    usage: "Choose the parameter set and coefficient field; enter N integers (space/comma separated); enabling `tag` prefixes a 1-byte parameter-set tag; output is lowercase hex, ready for `ntruUnpack`.",
    examples: [
      { in: "0 1 2047 2 3 1024 2047 0 (rest zero)", param: "set=ees401ep2, field=q, tag=false", out: "552B, hex prefix 000007ff802007003ff8…", desc: "q coefficients at 11 bits; zero padded" },
      { in: "0 1 -1 0 1 -1 0 1 (rest zero)", param: "set=ees401ep2, field=ternary, tag=false", out: "101B, hex prefix 1861…", desc: "Ternary -1 is encoded as 10" },
    ],
    tips: [
      "11 bits, not 16; q=2048 exactly fills 11 bits.",
      "Ternary -1 is 10, not two's-complement 11; 11 is rejected on unpack.",
      "The bitstream is this tool's big-endian convention, matching the existing real-parameter NTRU op; it is not claimed to be the EESS wire format.",
      "The tag is this tool's parameter-set identifier, not ASN.1/OID.",
    ],
    aka: ["NTRU coefficient packing", "NTRU bit-pack", "NTRU pack", "EESS coefficient encoding",
      "NTRU 11-bit coefficient", "NTRU 2-bit ternary coefficient", "NTRU private key packing", "NTRU public key packing", "NTRU coefficient serialization",
      "EESS1 parameters", "NTRU polynomial packing", "NTRU coefficient encoder"],
  },

  ntruUnpack: {
    what: "The inverse of `ntruPack`: restores N coefficients from hex by parameter set and field, strictly checking length, parameter-set tag, trailing padding and illegal ternary encodings.",
    principle: "Read 11-bit/2-bit values from the big-endian bitstream; q coefficients must be 0..2047, ternary must be 00/01/10 (11 illegal); trailing padding bits must be zero; the tag must match the parameter set.",
    usage: "Choose the parameter set and field, set `tag` to match the packing, paste hex, and get N space-separated coefficients. Truncation, extra bytes, illegal ternary or non-zero padding raise errors.",
    examples: [
      { in: "000007ff802007003ff8… (552B)", param: "set=ees401ep2, field=q, tag=false", out: "0 1 2047 2 3 1024 2047 0 …", desc: "Round-trips with ntruPack" },
      { in: "11… (ternary contains 11)", param: "set=ees401ep2, field=ternary", out: "Illegal ternary encoding 11", desc: "Exception surface" },
    ],
    tips: ["The decoded length must exactly match the parameter set; extra bytes are errors.", "With tag enabled, the 1-byte parameter-set tag is checked first.", "Ternary 11 is illegal, not -1.", "This is coefficient deserialization only, not CCA-2/SVES."],
    aka: ["NTRU coefficient unpacking", "NTRU bit-unpack", "NTRU unpack", "EESS coefficient decoding",
      "NTRU 11-bit unpack", "NTRU ternary coefficient unpack", "NTRU private key unpack", "NTRU public key unpack", "NTRU coefficient deserialization",
      "EESS1 parameter unpack", "NTRU polynomial unpack", "NTRU coefficient decoder"],
  },

  zipEntries: {
    what: "Reads a ZIP central directory and lists each entry's name, compression method, compressed/original size, CRC32, encryption flag, DOS time and local-header offset, marking path-traversal risks.",
    principle: "Find EOCD from the end → read the central directory → parse each CDH. For prefixed archives (prefix bytes + ZIP), infer the offset from the central directory immediately before EOCD. Read-only; no extraction.",
    usage: "Choose the input encoding (auto/hex/base64/UTF-8) and paste ZIP bytes; run prints the entry table. Encrypted entries are only marked, not decrypted.",
    examples: [
      { in: "UEsDBBQAAAAAAAAAIVyGphA2BQAAAAUAAAAJAAAAaGVsbG8udHh0aGVsbG9QSwECFAAUAAAAAAAAACFchqYQNgUAAAAFAAAACQAAAAAAAAAAAAAAgAEAAAAAaGVsbG8udHh0UEsFBgAAAAABAAEANwAAACwAAAAAAA==", param: "inputEnc=base64", out: "=== ZIP entry list ===\nInput: 121 bytes\nEntries: 1 (dirs 0 / files 1)\n\n#\tname\tmethod\tcompressed\toriginal\tCRC32\tencrypted\ttime\tpath\n1\thello.txt\tStored(0)\t5\t5\t0x3610A686\tno\t2026-01-01 00:00:00\tnormal", desc: "Report output; fields vary with the ZIP" },
    ],
    tips: ["Check the encryption flag first: ZipCrypto / AES / pseudo-encryption are handled differently.", "Path-traversal names are only marked; nothing is written to disk.", "Prefixed archives (EXE+ZIP) are handled from EOCD.", "This op only lists; extraction is `zipExtract`."],
    aka: ["ZIP entry list", "ZIP directory", "ZIP central directory", "zip listing", "zip entries", "ZIP file list",
      "archive entries", "ZIP directory reader", "ZIP entries", "zipinfo", "ZIP central directory reader", "archive listing"],
  },

  zipExtract: {
    what: "Extracts Stored/Deflate entries by name (empty = all), verifies each original size and CRC32, and returns a text preview plus in-memory download products.",
    principle: "Parse CDH/LFH; method 0 is copied, method 8 uses raw inflate; each entry is checked for length and CRC. ZipCrypto reuses zipCrack primitives; pseudo-encryption is tried as plaintext; WinZip AES is explicitly unsupported.",
    usage: "Choose the input encoding; `entry` is a name (comma/semicolon separated, `#N` by index, empty = all); `password` is for ZipCrypto only. Products live in memory and are downloaded on demand.",
    examples: [
      { in: "UEsDBBQAAAAAAAAAIVyGphA2BQAAAAUAAAAJAAAAaGVsbG8udHh0aGVsbG9QSwECFAAUAAAAAAAAACFchqYQNgUAAAAFAAAACQAAAAAAAAAAAAAAgAEAAAAAaGVsbG8udHh0UEsFBgAAAAABAAEANwAAACwAAAAAAA==", param: "inputEnc=base64, entry=hello.txt", out: "=== ZIP extract ===\nInput: 121 bytes, 1 entry, 1 selected\nSelected: hello.txt\nPassword: not provided\n\n[1] hello.txt — ✓ Stored(0), original 5 bytes, CRC32 0x3610A686 passed\n    text: hello\n\nResult: 1 succeeded, 0 failed, 0 skipped; 1 download product.", desc: "File content is hello; report output" },
    ],
    tips: ["AES entries are reported as unsupported, never faked; use `zipBrute` or another tool for the password.", "Pseudo-encrypted ZIPs are tried as plaintext and pass CRC.", "Path-traversal names are flattened to safe download names; nothing is written to disk.", "Use `#N` to select an entry by list index."],
    aka: ["ZIP extract", "ZIP entry extraction", "zip extract", "unzip entry", "ZIP single-file extract", "ZIP extract export",
      "archive extract", "ZIP decrypt export", "ZipCrypto decrypt", "ZIP pseudo-encryption extract", "unzip", "ZIP content extraction"],
  },

  decimalToFloat: {
    what: "Converts a decimal fraction or fraction into base 2–36 exactly; repeating remainders are marked as cycles. It uses BigInt rationals instead of double-precision approximation.",
    principle:
      "Parse the input into an exact fraction $p/q$ (supporting `1/3`, scientific notation and `0.(3)`), then do long division in the target base; a repeated remainder is a cycle, and precision only caps the number of output digits. `base=0` keeps the legacy 2/8/10/16 report.",
    usage: "`base` is the target base (0=four-base report, 2–36); `precision` is the fractional digit cap (1–2048). The input may be signed, a fraction, scientific notation or a repeating decimal.",
    examples: [
      { in: "10.5", param: "base=0, precision=8", out: "Input: 10.5\nPrecision: 8 decimal places (max 2048)\nExact fraction: 21/2 (BigInt rational, no floating-point error)\nBase 2: 1010.1\nBase 8: 12.4\nBase 10: 10.5\nBase 16: A.8", desc: "base=0 keeps the legacy four-base report" },
      { in: "1/3", param: "base=2, precision=16", out: "Input: 1/3\nPrecision: 16 decimal places (max 2048)\nExact fraction: 1/3 (BigInt rational, no floating-point error)\nBase 2: 0.(01) (cycle 01, starts at digit 1, length 2)", desc: "Cycle detection" },
      { in: "0.1", param: "base=2, precision=8", out: "Input: 0.1\nPrecision: 8 decimal places (max 2048)\nExact fraction: 1/10 (BigInt rational, no floating-point error)\nBase 2: 0.0(0011) (cycle 0011, starts at digit 2, length 4)", desc: "0.1 in binary is repeating" },
    ],
    tips: ["`base=0` keeps the old 2/8/10/16 report, so old writeups still work.", "Cycles use `0.(3)`/`0.1(6)` notation, not an ellipsis.", "Precision is capped at 2048; beyond that output is truncated and marked.", "Bases 37–95 are not supported for fractions: the visible ASCII table contains `. ( ) + -`, which conflicts with the syntax; use `radixN` for integers."],
    aka: ["radix float", "decimal to float", "decimal fraction to base N", "arbitrary-radix fraction", "fraction to radix",
      "decimal fraction conversion", "radix fraction", "binary fraction", "any-base float", "radix point conversion", "repeating decimal", "BigInt radix fraction"],
  },

  floatToDecimal: {
    what: "Converts a base 2–36 fraction or repeating decimal to an exact decimal value and fraction; supports signs, matching 0b/0o/0d/0x prefixes and cycles such as 0.(3).",
    principle: "Expand by place value into an exact rational: integer part $v = v \\cdot base + d$, fractional digits $d \\cdot base^{-k}$; a cycle is parsed as a geometric series. Output shows the decimal value and exact fraction, marking cycles/truncation.",
    usage: "`base` is the input base (2–36); `precision` is the output decimal places (0–2048). The input may have a prefix, sign or cycle.",
    examples: [
      { in: "0b101.1", param: "base=2, precision=8", out: "Base-2 float: 0b101.1\nDecimal: 5.5\nPrecision: 8 decimal places (max 2048)\nExact fraction: 11/2 (BigInt rational, no floating-point error)", desc: "4+0+1+0.5=5.5" },
      { in: "0.(3)", param: "base=10, precision=8", out: "Base-10 float: 0.(3)\nDecimal: 0.(3) (cycle 3, starts at digit 1, length 1)\nPrecision: 8 decimal places (max 2048)\nExact fraction: 1/3 (BigInt rational, no floating-point error)", desc: "Repeating decimal" },
      { in: "0.1", param: "base=2, precision=8", out: "Base-2 float: 0.1\nDecimal: 0.5\nPrecision: 8 decimal places (max 2048)\nExact fraction: 1/2 (BigInt rational, no floating-point error)", desc: "Binary 0.1 = 1/2" },
    ],
    tips: ["The prefix must match the chosen base; in base 16, 0BEEF is a valid hex number and is not mistaken for a binary prefix.", "Repeating decimals keep their cycle and exact fraction instead of a double approximation.", "The displayed decimal places only limit display; the exact fraction is always kept.", "Bases 37–95 are unsupported for the same reason as `decimalToFloat`."],
    aka: ["base-N float to decimal", "arbitrary-radix float", "binary fraction to decimal", "base-n float", "float decoder", "non-decimal float",
      "0b float", "float restore", "float to decimal", "radix float conversion", "hex float to decimal", "binary fraction",
      "float base conversion", "float2dec", "repeating decimal to decimal"],
  },
};
