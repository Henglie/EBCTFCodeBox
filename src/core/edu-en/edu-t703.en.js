/*
 * edu_t703_en.js — English edu cards for the 2 T703 ops (candidates, not wired).
 * Source: edu_t703_zh.js, translated 1:1. Example vectors (in/param/out) and TeX
 * formulas copied verbatim; only prose is translated. Aka lists keep every Chinese
 * alias and add English ones.
 */
export default {
  sha224: {
    what: "SHA-224 message digest — the 224-bit member of the SHA-2 family: it uses **exactly the same compression function and constants as SHA-256**, differing only in a dedicated initial hash value (IV) and truncating the output to the first 28 bytes (224 bits). In essence a \"truncated SHA-256 variant\". WebCrypto deliberately does not include SHA-224 (crypto.subtle raises NotSupportedError in browsers/Node), so this tool implements it in pure JS, byte-exact against OpenSSL (node:crypto).",
    principle:
      "**Relation to SHA-256 (FIPS 180-4 §5.3.2 / §6.2.2)**: message padding, message schedule (64 expanded words), the 64 compression rounds and the K constant table (fractional cube roots of the first 64 primes) are all identical to SHA-256. Only two things differ:\n\n" +
      "① **Initial hash value IV**: eight 32-bit words `c1059ed8 367cd507 3070dd17 f70e5939 ffc00b31 68581511 64f98fa7 befa4fa4` — the first 32 bits of the fractional square roots of the **9th through 16th primes** (23,29,31,37,41,43,47,53), whereas SHA-256's IV uses primes 1..8. ⚠ h7 = `befa4fa4` is often miscopied as befafa53 (which comes from the 64-bit SHA-512/224 IV segment) — this project's implementation hit exactly that trap and was caught by the FIPS 180-4 official vectors; see edu tips.\n\n" +
      "② **Output truncation**: of the final eight 32-bit words only the first seven (H0..H6, 28 bytes) are emitted.\n\n" +
      "**Relation to SHA-3**: the SHA-2 family (SHA-224/256/384/512) is Merkle-Damgård + Davies-Meyer compression; the SHA-3 family is the Keccak sponge — fully independent designs (SHA-3 exists precisely to hedge against structural risk in SHA-1/2). SHA-224 is not \"the 224-bit member of SHA-3\"; SHA-3's own 224-bit member is called SHA3-224 (the 224-bit option of this tool's sha3 op).\n\n" +
      "**Security**: 112-bit collision / 224-bit preimage resistance (the half-strength sibling of SHA-256's 128/256); no practical attacks known.",
    usage:
      "Enter any text (or bytes via the byte channel), get a 56-hex-character digest. The 256 option cross-checks the same implementation against the \"SHA-256\" op byte-exactly (same compression function, SHA-256's IV).\n\n" +
      "Use when a challenge names SHA-224, or when a hash is 56 hex characters (28 bytes) — 16/20/24/28/32/48/64 bytes are the signature lengths of MD5/SHA-1/SHA-224/SHA-256/SHA-384/SHA-512.\n\n" +
      "Remember this is a **one-way hash**: irreversible, so don't look for a \"decrypt\" button.",
    examples: [
      { in: "abc", out: "23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7", desc: "FIPS 180-4 official vector" },
      { in: "empty input", out: "d14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f", desc: "empty-string digest — 56 hex chars fingerprint SHA-224" },
      { in: "one million 'a'", out: "20794655980c91d8bbb4c1ea97618a4bf03f42581948b2ee4ee7ad67", desc: "FIPS 180-4 million-a vector, byte-exact" },
    ],
    formulas: [
      { tex: "H_i = H_{i-1} + \\mathrm{Compress}(H_{i-1}, M_i)\\quad(\\text{SHA-256 compression})", caption: "Shares the compression function and K table (64 prime cube roots) with SHA-256" },
      { tex: "\\mathrm{SHA\\text{-}224}(M) = H_0\\|H_1\\|\\cdots\\|H_6\\;(\\text{first 28 bytes})", caption: "The only differences = the primes-9..16 square-root IV + truncation" },
    ],
    tips: [
      "Recognition: a 56-hex-character (28-byte) hash → SHA-224; hashcat mode 1300.",
      "⚠ This project once miscopied IV h7 as befafa53 (from SHA-512/224's 64-bit IV), making every digest wrong (empty input gave 8bd1cfa3…) — caught immediately by the FIPS vectors. Lesson: **IVs/constants must be checked word-by-word against the standard text**; self round-trips cannot detect two mirrored errors (same lesson as the T629 gate precedent).",
      "SHA-224 vs SHA3-224: similar names, entirely different algorithms (Merkle-Damgård vs Keccak sponge); pick by length first, then try both.",
      "Interop: openssl dgst -sha224, Python hashlib.sha224 and node:crypto sha224 all match this op byte-exactly.",
      "WebCrypto omitting SHA-224 is a deliberate W3C spec choice (not a browser bug); hence pure JS here.",
      "Standards: FIPS 180-4 §5.3.2 (IV) / §6.2.2 (computation) / §6.2 (shared SHA-256 compression); verification includes the named FIPS vectors + node:crypto cross-check + one million a's.",
    ],
    aka: ["SHA-224", "sha224", "SHA224", "224 位哈希", "SHA-2 224",
      "sha-224 hash", "SHA2-224", "SHA-224 摘要", "sha 224 位", "28 字节哈希",
      "SHA-224 checksum", "sha224 sum", "SHA-2 族 224", "sha224 摘要算法", "FIPS 180-4 224"],
  },

  cshake: {
    what: "cSHAKE128/256, the customizable extendable-output function (NIST SP 800-185 §3.3) — the \"customizable\" SHAKE: on top of SHAKE it adds two domain-separation inputs — a **function name N** (distinguishing protocols/algorithms that consume the output) and a **customization string S** (distinguishing applications within one algorithm). Output length is arbitrary (XOF). cSHAKE is the common base of the three derived functions KMAC, TupleHash and ParallelHash.",
    principle:
      "**Construction**: cSHAKE128(X, L, N, S) = KECCAK[168](bytepad(encode_string(N) ‖ encode_string(S), 168) ‖ X, L). The three encodings (§2.3):\n\n" +
      "① `left_encode(x)` = [byte-count] ‖ x big-endian — self-describing length;\n" +
      "② `encode_string(s)` = left_encode(8·len(s)) ‖ s — length-prefixed string;\n" +
      "③ `bytepad(X, w)` = left_encode(w) ‖ X ‖ 0x00… — pads the prefix to whole rate blocks w.\n\n" +
      "N/S become a **whole-rate-block prefix** absorbed before the message; cSHAKE's domain padding is 0x04 (SHAKE uses 0x1f, SHA-3 uses 0x06 — one Keccak sponge, three functions separated by the domain byte).\n\n" +
      "**Spec equivalence rule**: when N and S are **both empty**, cSHAKE128(X, L, \"\", \"\") is just SHAKE128(X, L) — implementations must special-case and skip the prefix (otherwise bytepad(01 00 01 00, w) would break the equivalence); this tool asserts that property against its existing SHAKE op.\n\n" +
      "**The family in one line**: SHAKE = cSHAKE(N=S=empty) ⊂ cSHAKE ⊃ KMAC = cSHAKE(N=\"KMAC\") (SP 800-185 §4.3, this tool's KMAC op); TupleHash/ParallelHash follow the same pattern (N = \"TupleHash\"/\"ParallelHash\"). SHA-3 = the fixed-length tier (sponge pad 0x06) and does not go through cSHAKE.\n\n" +
      "**Rate**: cSHAKE128 rate = 168 bytes (capacity 512 bits, 128-bit collision resistance); cSHAKE256 rate = 136 (256-bit).",
    usage:
      "Parameters: security strength 128/256, function name N, customization string S (text as UTF-8 or hex byte-for-byte), output length in bytes (arbitrary). Input any text/bytes.\n\n" +
      "Leave N empty unless you are implementing an algorithm defined on top of cSHAKE (e.g. KMAC's N=\"KMAC\"); S is your application's label (the sample strings \"Email Signature\" and \"My Tagged Application\" come from SP 800-185).\n\n" +
      "Cross-check caveat: NIST published no official sample files with SP 800-185 (confirmed on the publication page) and CAVP does not cover cSHAKE. This tool's verification = pycryptodomex (the N=S=empty path) + the KMAC full-chain composition (anchoring the N=\"KMAC\" and S paths) + a cross-check against the project's own KMAC op — correctness for arbitrary N/S rests on the composition formula transcribed line-by-line from the spec plus the two anchors, honestly recorded here.",
    examples: [
      { in: "empty input, N=S=empty, 32B", out: "7f9c2ba4e88f827d… (= SHAKE128 of empty)", desc: "spec equivalence: cSHAKE degenerates to SHAKE" },
      { in: "00 01 02 03, S=\"Email Signature\", 32B", out: "(same parameters as the SP 800-185 sample customization string)", desc: "the S-prefix absorption path; N empty" },
      { in: "KMAC-composed input, N=\"KMAC\", S=\"Email Signature\"", out: "(byte-exact against pycryptodomex KMAC128)", desc: "KMAC ≡ cSHAKE(N=\"KMAC\") — the authoritative anchor for the N/S paths" },
    ],
    formulas: [
      { tex: "\\mathrm{cSHAKE128}(X,L,N,S) = \\mathrm{KECCAK}[168](\\mathrm{bytepad}(\\mathrm{encode\\_string}(N)\\|\\mathrm{encode\\_string}(S), 168)\\|X, L)", caption: "The cSHAKE definition (SP 800-185 §3.3); cSHAKE256 mirrors it with rate=136" },
      { tex: "\\mathrm{bytepad}(X,w) = \\mathrm{left\\_encode}(w)\\|X\\|0^{*}\\;(\\text{padded to } w \\text{ bytes})", caption: "The prefix fills whole rate blocks, keeping domain separation block-aligned" },
    ],
    tips: [
      "Recognition: challenges mentioning \"cSHAKE\", \"customizable SHAKE\", \"domain-separated SHAKE\", \"SP 800-185\", or KMAC/TupleHash/ParallelHash — the last three are all N-wrappers of cSHAKE.",
      "N vs S division of labor: N names the **protocol** (whose spec defines this use), S labels the **application** (scenarios within one protocol); in CTFs S is usually the string planted by the author — paste it directly.",
      "With N=S=empty the output equals SHAKE — run SHAKE first, then add customization strings, to quickly identify the extra layer.",
      "Encoding pitfall: text mode encodes N/S as UTF-8; if the challenge gives raw bytes use hex mode — do not mix.",
      "Arbitrary output length: the same input yields any length (XOF); the first 32 bytes of a 32B and a 64B output are identical — a property, not a bug, when comparing prefixes.",
      "Family map: SHA-3 = fixed-length (pad 0x06) → SHAKE = XOF (pad 0x1f) → cSHAKE = customizable XOF (pad 0x04) → KMAC/TupleHash/ParallelHash = N-wrapped cSHAKE; one sponge, four skins.",
      "Standards: NIST SP 800-185 §2.3 (the three encodings) / §3.3 (cSHAKE) / §4.3 (KMAC relation); the minimum XOF output length is bounded by the output security strength (§3.3, L ≥ strength/8).",
    ],
    aka: ["cSHAKE", "cSHAKE128", "cSHAKE256", "cSHAKE 可定制", "customizable SHAKE",
      "cshake hash", "cSHAKE 加密", "cSHAKE 摘要", "SP 800-185", "SP800-185",
      "KMAC 底座", "cSHAKE XOF", "域分隔 SHAKE", "cSHAKE128 hash", "TupleHash 底层"],
  },
};
