/*
 * edu-t842.en.js — English edu cards for the 8 CyberChef-aligned ops added by T842.
 * Pure data: no imports, no side effects. Each card mirrors the Chinese schema.
 * Sources: CyberChef 11.2.0 operations/tests; Rocksoft/Williams CRC model;
 * FIPS 180-4; ISO/IEC 10118-3; LZ4 frame format; Kornblum 2006; Enigma rotor tables.
 */
export default {
  crcChecksum: {
    what:
      "CRC checksum: compute a cyclic redundancy check with a named parameter model (width, polynomial, init, reflection, xor-out) and print lowercase hex.",
    principle:
      "Treat the message as a binary polynomial, divide by the generator polynomial, and keep the remainder. The model fixes width, polynomial, initial value and reflections; two models with the same polynomial still differ when init/refIn/refOut/xorOut differ. This op ships 171 CyberChef presets plus a Custom model and uses BigInt for 3–82-bit widths.",
    usage:
      "Pick Algorithm (default CRC-32/ISO-HDLC), or Custom and fill width/poly/init/refIn/refOut/xorOut. inputMode accepts auto, text or hex. Output is lowercase hex without 0x.",
    examples: [
      { in: "abc", out: "352441c2", desc: "Default CRC-32/ISO-HDLC" },
      { in: "abc", param: "algorithm=CRC-16/IBM (ARC)", out: "5140", desc: "Same input, another model" },
    ],
    tips: [
      "CRC detects errors; it is not a MAC and an attacker can recompute it.",
      "Names such as /ARC, /MODBUS and /XMODEM are model aliases, not the polynomial itself.",
      "Widths not divisible by 8 are zero-padded on the left; do not compare a 16-bit result with a 32-bit model.",
    ],
    aka: [
      "CRC checksum", "CRC-32", "CRC32", "cyclic redundancy check", "CRC model",
      "CRC-32/ISO-HDLC", "CRC-16/MODBUS", "CRC polynomial", "Rocksoft CRC",
      "CRC presets", "CRC parameter model", "CRC calc",
    ],
  },

  generateAllChecksums: {
    what:
      "Print all 171 CyberChef CRC checksums plus Fletcher-8/16/32/64 and Adler-32 in one report, useful for identifying which checksum a sample uses.",
    principle:
      "Run every named CRC model and the Fletcher/Adler functions in CyberChef order. Length filters by result width and Include names toggles the algorithm labels. The report is a multi-line list of name + result.",
    usage:
      "Choose Length (All or a width), Include names, and inputMode. Use crcChecksum afterwards for a precise single-model check.",
    examples: [
      {
        in: "abc",
        param: "length=8, includeNames=false",
        out: "5f\n41\nf7\n… (28 eight-bit checksums)",
        desc: "Only 8-bit results",
      },
    ],
    tips: [
      "The full report is long; filter by width first.",
      "Fletcher/Adler are not CRCs but CyberChef groups them here.",
      "Order is fixed for line-by-line diffs; verify the order when upgrading.",
    ],
    aka: [
      "Generate all checksums", "all CRC", "checksum sweep", "CRC sweep",
      "Fletcher checksum", "Adler-32", "checksum enumeration", "CRC enumeration",
      "CyberChef checksums", "batch checksums", "multi checksum", "all checksums",
    ],
  },

  sha2: {
    what:
      "SHA-2 family with six sizes: SHA-512, SHA-384, SHA-256, SHA-224, SHA-512/256 and SHA-512/224, with CyberChef-compatible round options.",
    principle:
      "SHA-2 uses Merkle–Damgård: pad the message, run the 64-round (256 family) or 80-round (512 family) compression function, and output the requested digest. SHA-512/256 and SHA-512/224 are distinct IV variants, not plain truncations of SHA-512.",
    usage:
      "Pick Size; rounds256 defaults to 64 and rounds512 to 160. Output is lowercase hex.",
    examples: [
      {
        in: "abc",
        out: "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
        desc: "Default SHA-512",
      },
      { in: "abc", param: "size=256", out: "SHA-256 of abc", desc: "SHA-256 size" },
    ],
    tips: [
      "SHA-224 is not a truncation of SHA-256; the IV differs.",
      "Change rounds only for research/alignment; standard SHA-2 uses the defaults.",
      "WebCrypto omits SHA-224; this project uses pure JS matching FIPS vectors.",
    ],
    aka: [
      "SHA-2", "SHA2", "SHA-512", "SHA-384", "SHA-256", "SHA-224",
      "SHA-512/256", "SHA-512/224", "secure hash algorithm 2", "FIPS 180-4",
      "SHA2 six sizes", "SHA-2 family",
    ],
  },

  ctph: {
    what:
      "CTPH (Context Triggered Piecewise Hashing): split the input by content, hash each piece with a rolling/strong hash, and print `bi:hash1:hash2`.",
    principle:
      "A rolling weak hash triggers a boundary when it matches a condition; the strong hash of each piece contributes bits to the output. Local edits only disturb nearby pieces, so CTPH is for similarity, not cryptographic integrity.",
    usage:
      "Input text or bytes. Compare two results by shared-prefix ratio or edit distance, not exact equality.",
    examples: [
      { in: "abc", out: "A:CH:CH", desc: "Short-input CTPH result" },
    ],
    tips: [
      "CTPH is a fuzzy hash, not SHA/MD5; do not use it for tamper-proofing.",
      "Longer inputs produce longer results; align blocks when comparing.",
      "Very short inputs produce short output; that is expected.",
    ],
    aka: [
      "CTPH", "fuzzy hash", "context triggered piecewise hashing", "ssdeep-like",
      "similarity hash", "piecewise hash", "fuzzy digest", "Kornblum 2006",
      "bi: hash", "file similarity", "fuzzy hashing", "ctph hash",
    ],
  },

  generateAllHashes: {
    what:
      "Print 44 CyberChef-compatible digests (MD2/MD4/MD5/MD6, SHA family, Whirlpool variants, GOST, SSDEEP, CTPH and more) in one report.",
    principle:
      "Run each digest in CyberChef order. Length filters by output width and Include names toggles labels. The report is a multi-line list of name + result.",
    usage:
      "Choose Length (All or a width) and Include names. Use the single-algorithm op for a precise check.",
    examples: [
      {
        in: "abc",
        param: "length=128, includeNames=false",
        out: "da853b0d3f88d99b30283a69e6ded6bb\n… (8 digests at 128 bits)",
        desc: "Only 128-bit results",
      },
    ],
    tips: [
      "Filter by width first; the full report is long.",
      "SSDEEP/CTPH are fuzzy and must not be compared for equality.",
      "Watch the variant name (Whirlpool/Whirlpool-T/Whirlpool-0), not just the length.",
    ],
    aka: [
      "Generate all hashes", "all digests", "hash sweep", "digest enumeration",
      "batch hashes", "multi hash", "all hashes", "hash enumeration",
      "CyberChef hashes", "44 digests", "digest sweep", "hash scan",
    ],
  },

  whirlpoolHash: {
    what:
      "Whirlpool hash: a 512-bit digest from ISO/IEC 10118-3 with Whirlpool, Whirlpool-T and Whirlpool-0 variants plus an adjustable round count.",
    principle:
      "Whirlpool uses a 512-bit state, AES-style S-box and circulant matrix with Miyaguchi–Preneel compression. Variants differ in S-box/round constants/rounds; the standard version uses 10 rounds.",
    usage:
      "Pick Variant (default Whirlpool) and rounds (default 10); output is 128 lowercase hex characters.",
    examples: [
      {
        in: "abc",
        out: "4e2448a4c6f486bb16b6562c73b4020bf3043e3a731bce721ae1b303d97e6d4c7181eebdb6c57e277d0e34957114cbd6c797fc9d95d8b582d225292076d4eef5",
        desc: "Default Whirlpool / 10 rounds",
      },
    ],
    tips: [
      "Whirlpool-T and Whirlpool-0 are historical variants, not the standard.",
      "Standard Whirlpool is fixed at 10 rounds; changing rounds is for research.",
      "The 128-hex output is not SHA-512; the algorithms are unrelated.",
    ],
    aka: [
      "Whirlpool", "Whirlpool hash", "Whirlpool-T", "Whirlpool-0",
      "512-bit hash", "ISO/IEC 10118-3", "Miyaguchi–Preneel", "Whirlpool digest",
      "Whirlpool variant", "Whirlpool rounds", "whirlpoolHash", "Whirlpool family",
    ],
  },

  lz4Compress: {
    what:
      "LZ4 Frame compression: compress input into the official LZ4 frame format and output hex or base64, optionally as a downloadable file.",
    principle:
      "LZ4 is a speed-oriented LZ77 variant: repeated strings become offset/length match tokens. A frame adds magic, FLG/BD, block sizes and checksums around the blocks. This op emits a complete frame that `lz4Dec` and the official `lz4` tool can read.",
    usage:
      "Choose inputMode (auto/text/hex/base64), outEnc (hex/base64) and toFile. The file product is binary frame data.",
    examples: [
      { in: "abc", out: "04224d184070df0300008061626300000000", desc: "Default hex output" },
    ],
    tips: [
      "LZ4 frame is not a raw block; do not feed the frame header to a block decoder.",
      "Small inputs may grow; LZ4 favors speed over ratio.",
      "With toFile, the download is binary, not text.",
    ],
    aka: [
      "LZ4 compress", "LZ4 Frame", "lz4Compress", "LZ4 frame format",
      "LZ4 compressor", "LZ4 block", "fast compression", "LZ4 encode",
      "LZ4 file", "LZ4 algorithm", "LZ4 stream", "lz4 frame",
    ],
  },

  enigmaCC: {
    what:
      "Enigma machine (CyberChef-aligned): 3/4 rotors, I–VIII plus Beta/Gamma, reflectors B/C/B Thin/C Thin, ring settings, initial positions, plugboard and Strict output.",
    principle:
      "Each rotor is a substitution; notches advance the next rotor. The signal goes plugboard → right → middle → left → reflector → back. Ring settings shift the notch, initial positions pick the starting substitution, and the plugboard is a self-reciprocal letter swap. Strict output drops non-letters and groups by five.",
    usage:
      "Pick model, rotors/rings/positions, reflector, plugboard (e.g. `AB CD`) and Strict output; input letters, output is uppercase groups by default.",
    examples: [
      { in: "abc", out: "BJE", desc: "Default 3-rotor I/II/III, reflector B, no plugboard, Strict output" },
    ],
    tips: [
      "Enigma is reciprocal per setting but not involutive across runs; decrypt with the same initial positions.",
      "Beta/Gamma cannot be reversed and require B Thin/C Thin reflectors.",
      "Strict output removes digits/spaces; do not use it for character-exact plaintext comparison.",
    ],
    aka: [
      "Enigma", "Enigma machine", "Enigma 3-rotor", "Enigma 4-rotor",
      "Enigma M3", "Enigma M4", "rotor machine", "plugboard",
      "reflector", "CyberChef Enigma", "enigmaCC", "Enigma cipher",
    ],
  },
};
