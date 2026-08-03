/*
 * edu-hash-xxhash.en.js — xxHash English edu card (hash category).
 *
 * Translation of src/core/edu/edu-hash-xxhash.js.
 * Op covered: xxhash
 * Pure data, no side effects. Export contract matches eduContent.js header.
 */
export default {
  xxhash: {
    what: "xxHash — An extremely fast non-cryptographic hash algorithm designed by Yann Collet (BSD licensed). Includes xxHash32 (32-bit) and xxHash64 (64-bit) variants. Much faster than CRC32/MD5, widely used for data integrity checks, file deduplication, and hash table indexing.",
    principle:
      "xxHash32 uses 4-way 32-bit striping + arithmetic mixing. Five prime constants (PRIME32_1 through PRIME32_5) drive three operations — multiplication, bitwise rotation, and XOR — to scramble input bits into a uniformly distributed 32-bit digest.\n\n" +
      "Large inputs (>= 16 bytes): Four lanes initialized with seed-derived values independently absorb 16-byte blocks. Each lane updates as `v = ((v + read4 × PRIME32_1) <<< 13) × PRIME32_2`. After all blocks, the four lanes are merged via rotation-sum, remaining bytes are absorbed one by one, and a final avalanche (3 rounds of XOR-multiply-shift) eliminates statistical bias.\n\n" +
      "Short inputs (< 16 bytes): Striping is skipped; a single accumulator starts from seed + PRIME32_5, absorbs all bytes, then goes through the same avalanche.\n\n" +
      "xxHash64 follows the same structure but uses BigInt for 64-bit precision, 8-byte blocks per lane, and additional XOR-multiply-add cross-mixing when merging lanes, producing a 64-bit (16 hex chars) digest. An optional seed parameter changes the starting value — same input with different seeds yields different outputs, providing hash table collision resistance via salting.",
    usage: "Enter text in the input box (or switch to hex mode for raw bytes). Select 32/64 variant, set an optional seed (decimal integer, default 0; 64-bit also accepts 0x-prefixed hex). Click Run to get the hex digest. One-way, non-reversible — no decode.",
    examples: [
      { in: "", param: "variant=32, seed=0", out: "02cc5d05", desc: "xxHash32 empty string official test vector" },
      { in: "abc", param: "variant=32, seed=0", out: "32d153ff", desc: "xxHash32 three-byte classic test vector" },
      { in: "a", param: "variant=64, seed=0", out: "d24ec4f1a98c6e5b", desc: "xxHash64 single character test vector" },
    ],
    tips: [
      "xxHash is NOT a cryptographic hash — it offers no collision or preimage resistance. Use it only for data integrity checks and high-speed dedup, never as a substitute for SHA-256.",
      "Changing the seed produces different outputs. If a CTF challenge provides a seed value, make sure to enter it — otherwise your hash won't match the expected answer.",
      "In CTF, if you see an 8-hex-char (32-bit) or 16-hex-char (64-bit) digest with hints like \"extremely fast\" or \"non-cryptographic\", suspect xxHash.",
      "xxHash64 outputs exactly 16 hex characters; xxHash32 outputs exactly 8 hex characters. Compare hex directly without extra conversion.",
    ],
    aka: ["xxhash", "xxHash", "xxHash32", "xxHash64", "xxh32", "xxh64", "extremely fast hash", "Yann Collet", "BSD hash", "non-cryptographic hash", "fast hash", "checksum", "CRC alternative", "data integrity", "file dedup", "XXH3", "xxHash family", "高速哈希", "极速哈希", "数据校验"],
  },
};
