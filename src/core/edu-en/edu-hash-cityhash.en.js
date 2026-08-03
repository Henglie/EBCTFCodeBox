/*
 * edu-hash-cityhash.en.js — CityHash English edu card (hash category).
 *
 * Translation of src/core/edu/edu-hash-cityhash.js.
 * Op covered: cityhash
 * Pure data, no side effects. Export contract matches eduContent.js header.
 */
export default {
  cityhash: {
    what: "CityHash — A family of fast non-cryptographic hash functions released by Google in 2011 (Geoff Pike and Jyrki Alakuijala), covering CityHash32 / CityHash64 / CityHash128. It is designed for short strings: rather than one uniform loop, it dispatches to a dedicated code path per length bucket, which is why it beats general-purpose hashes on the keys a hash table actually sees.",
    principle:
      "CityHash64's defining trait is length-bucketed dispatch. Four separate code paths handle 0-16, 17-32, 33-64, and 65+ byte inputs, each hand-tuned for its size.\n\n" +
      "Three 64-bit prime-like constants drive the mixing: k0 = 0xc3a5c85c97cb3127, k1 = 0xb492b66fbe98f273, k2 = 0x9ae16a3b2f90404f. The core primitive HashLen16(u, v, mul) is Murmur-inspired: `a = (u^v)*mul; a ^= a>>47; b = (v^a)*mul; b ^= b>>47; b *= mul`.\n\n" +
      "Short inputs (0-16 bytes) split further. Length 0 returns k2 outright. Lengths 1-3 read only the first, middle, and last bytes, packing them into two 32-bit values before a single ShiftMix. Lengths 4-7 read two overlapping 32-bit words; 8-16 read two overlapping 64-bit words. The overlap trick means no branching on the exact byte count and no padding.\n\n" +
      "Long inputs (65+ bytes) hash the tail first, then carry 56 bytes of state (v, w, x, y, z) through a 64-byte-per-iteration loop. WeakHashLen32WithSeeds mixes each 32-byte half, and z/x swap every round so the two accumulator chains stay entangled.\n\n" +
      "CityHash32 is a different construction — it borrows Murmur3's c1 = 0xcc9e2d51, c2 = 0x1b873593 and fmix finalizer, processes 20 bytes per iteration, and uses PERMUTE3 to rotate the three accumulators f/g/h so no single lane dominates.\n\n" +
      "All rotations are RIGHT rotations (`(v >> s) | (v << (64-s))`) — a detail that silently breaks ports written from the paper rather than the source. Multiplications wrap modulo 2^64, and byte reads are little-endian.",
    usage: "Enter text in the input box (or switch to hex mode for raw bytes). Pick 64 (16 hex chars) or 32 (8 hex chars) for the output width, then click Run. One-way, non-reversible — no decode.",
    examples: [
      { in: "", param: "bits=64", out: "9ae16a3b2f90404f", desc: "Empty string returns the constant k2 verbatim" },
      { in: "abc", param: "bits=64", out: "24a5b3a074e7f369", desc: "3 bytes take the 1-3 byte path (first/middle/last byte only)" },
      { in: "Hello, world!", param: "bits=64", out: "307c26b3e0789a47", desc: "13 bytes take the 8-16 byte overlapping-64-bit-word path" },
      { in: "The quick brown fox jumps over the lazy dog", param: "bits=32", out: "a339c810", desc: "43 bytes exercise CityHash32's 20-byte main loop" },
    ],
    tips: [
      "CityHash is NOT cryptographic — no collision or preimage resistance, and it is not seeded against adversarial input by default. Never use it for signatures, passwords, or integrity against an attacker.",
      "Empty input returns 9ae16a3b2f90404f, which is the constant k2 itself, not a computed digest. Recognizing this value on sight tells you an empty string was hashed.",
      "In CTF, an 8- or 16-hex-char digest plus hints like \"Google\", \"fast hash\", or \"hash table\" points at CityHash. Try both bit widths — they are entirely different constructions, not truncations of each other.",
      "CityHash and xxHash occupy the same niche and produce same-length output, so length alone cannot distinguish them. Hash a known sample with both and compare.",
      "CityHash64 is length-bucketed, so a 1-byte change that crosses a bucket boundary (16→17, 32→33, 64→65 bytes) switches code paths entirely. Two nearly identical inputs can differ in which algorithm ran.",
      "Google later published FarmHash as CityHash's successor. Digests are NOT interchangeable between them despite the shared lineage.",
    ],
    aka: ["cityhash", "CityHash", "CityHash32", "CityHash64", "CityHash128", "Google hash", "Geoff Pike", "non-cryptographic hash", "fast hash", "short string hash", "hash table hash", "FarmHash predecessor", "Murmur variant", "k0k1k2", "9ae16a3b2f90404f", "HashLen16", "WeakHashLen32WithSeeds", "city-test", "字符串哈希", "高速哈希"],
  },
};
