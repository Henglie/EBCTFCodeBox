/*
 * edu-analysis-crc32rev.en.js — CRC32 Reverse Collision English edu card (analysis).
 *
 * Translation of src/core/edu/edu-analysis-crc32rev.js.
 * Op covered: crc32Reverse
 * Pure data, no side effects. Export contract matches eduContent.js header.
 */
export default {
  crc32Reverse: {
    what: "CRC32 reverse collision — given a target CRC32 checksum, derive data whose CRC32 equals exactly that target. Unlike brute-force collision (crc32Collision), this op solves it with a reverse lookup table: O(1) table lookups instead of trying combinations. Used in CTF for ZIP pseudo-encryption, file header repair, and forging data with a desired checksum.",
    principle:
      "The core is the inverse of standard CRC32 (poly 0xEDB88320, reflected / lsbit-first).\n\n" +
      "① Forward table: the standard 256-entry CRC table table[i] (each entry iterates 8 bits with the reflected polynomial).\n" +
      "② Reverse table: for each high-byte value m (0..255), collect all bytes j where table[j]>>24 == m — the candidate set for one reverse step.\n" +
      "③ Reverse solve: start from the target final CRC, walk the reverse table in a 4-level DFS (each level picks a byte j, register = ((reg ^ table[j]) << 8)); at level 4, derive the 4 original bytes and verify with the forward calc.\n" +
      "④ Since CRC32 has 2^32 possible values and 4-byte patches also number 2^32, every target CRC has (on average) exactly 1 four-byte solution — the mathematical guarantee that solving always works.\n\n" +
      "Optional 'printable prefix' mode: enumerate 2-character prefixes in a chosen charset, compute their CRC, then reverse-solve 4 patch bytes (requiring patch bytes also in the charset) to get a readable 6-byte collision string (e.g. for forging ZIP file names).",
    usage: "Enter a target CRC32 (hex, 1-8 digits, optional 0x prefix). Run to get: ① the 4-byte patch (hex); ② readable collision strings via printable prefix + patch. The prefix charset parameter controls readability (printable ASCII / alphanumeric / digits / hex).",
    examples: [
      { in: "8e234ae0", param: "prefix=printable", out: "0e f5 08 69  →  \"!WE6AQ\" etc", desc: "Standard test target, patch verifies OK" },
      { in: "cbf43926", param: "prefix=printable", out: "2a 0d cd f2", desc: "CRC32(\"123456789\") official test vector, reverse-verified OK" },
    ],
    tips: [
      "Any 8-digit hex has a 4-byte solution (1 on average) — it never fails. If output says 'no solution', check the input format (1-8 hex digits, optional 0x).",
      "ZIP pseudo-encryption: change a file's CRC32 inside a ZIP to a known value, then reverse-forge a file name — the printable-prefix mode is designed for this.",
      "Difference from crc32Collision: that one is brute-force (length-by-length DFS); this one is a table-driven analytic solve, orders of magnitude faster, but the output is fixed at 4 bytes (or 6 with prefix), not arbitrary length.",
      "The patch is arbitrary data, not a printable string — use the prefix search mode for readable strings; smaller charsets make solutions rarer (pure digits often has none).",
      "CRC32 is a linear checksum with zero cryptographic strength: trivially forgeable, never use it for integrity against attackers.",
    ],
    aka: ["crc32Reverse", "CRC32 reverse", "CRC reverse", "crc reverse", "CRC32 collision", "ZIP pseudo encryption", "crc32 forge", "CRC patch", "crc32 collision", "reverse CRC", "CRC32 反向", "CRC 反推", "checksum forge", "crc32 construct", "4-byte patch"],
  },
};
