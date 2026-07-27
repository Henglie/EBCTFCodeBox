// English edu shard: hash segment 12-22 (sm3/ripemd160/blake2b/blake2s/adler32/crc8/crc8_maxim/crc64/crc32c/fnv1a). Pure data, no import, no side effects.
export default {
  sm3: {
    what: "The Chinese national cryptographic hash algorithm (GM/T 0004), China's self-developed digest, output 256 bits (64 hex characters). Very common in domestic Chinese CTFs, it's the domestic counterpart to SHA-256.",
    principle:
      "Structurally a close relative of SHA-256: split data into 512-bit blocks, stir a 256-bit internal state with a 64-step compression function, and finally output a 256-bit digest. It uses two boolean functions and a set of constants for nonlinear diffusion. One-way, irreversible.",
    usage: "Enter any text, output the SM3 digest (one-way run). To reverse to the original, use dictionary brute-force.",
    examples: [
      { in: "abc", out: "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0", desc: "GM/T 0004 standard test vector" },
    ],
    tips: [
      "In 64 hex characters, SM3 is visually indistinguishable from SHA-256, SHA3-256, and Keccak-256 — decide from the challenge wording ('national crypto / commercial crypto / GM').",
      "When a challenge mentions the Chinese national crypto suite, the hash is usually SM3 and the block cipher is usually SM4.",
    ],
    aka: ["sm3", "国密sm3", "商用密码哈希", "gm/t 0004", "国密哈希", "sm3哈希", "商密sm3", "中国哈希算法", "国产哈希", "sm-3", "gm sm3", "sm3摘要"],
  },

  ripemd160: {
    what: "A European-designed hash algorithm, output 160 bits (40 hex characters). Its most famous use: a Bitcoin address is computed by SHA-256 followed by RIPEMD-160.",
    principle:
      "Block-iterative compression, output 160 bits. Its distinctive feature is 'dual parallel lines': the same block of data runs two different 5-round operation chains simultaneously, then merges the two results, making it more analysis-resistant than a single-chain design. One-way, irreversible.",
    usage: "Enter text, output the RIPEMD-160 digest (one-way run).",
    examples: [
      { in: "abc", out: "8eb208f7e05d987a9b044a8e98c6b087f15a0bfc", desc: "Official test vector" },
    ],
    tips: [
      "40 hex characters could be either SHA-1 or RIPEMD-160 — same length, distinguished by the challenge wording.",
      "When the challenge mentions Bitcoin / P2PKH address / `HASH160` → it's SHA-256 wrapped in RIPEMD-160.",
    ],
    aka: ["ripemd-160", "ripemd", "比特币hash160", "ripemd160", "hash160", "ripe md 160", "比特币地址哈希", "ripemd哈希", "race integrity primitives", "160位哈希", "ripe-md", "p2pkh哈希"],
  },

  blake2b: {
    what: "The 64-bit optimized version of the modern high-speed hash BLAKE2 (RFC 7693), fast and secure, defaulting to 512-bit output, up to 64 bytes. Many new software use it to replace MD5/SHA.",
    principle:
      "Descended from BLAKE, a SHA-3 finalist runner-up, its core is a ChaCha-style quarter-round mix using 64-bit word operations, optimized for 64-bit platforms. The output length is customizable (1-64 bytes), and it also supports being used as a MAC with a key. One-way, irreversible.",
    usage: "Enter text, output the BLAKE2b digest (default 512 bits = 128 hex characters, one-way run).",
    examples: [
      { in: "abc", out: "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923", desc: "RFC 7693 default 512-bit output" },
    ],
    tips: [
      "Faster than SHA-256 and more secure, a common choice for modern projects.",
      "64-bit word operations are blake2b's niche; on 32-bit platforms blake2s is faster.",
    ],
    aka: ["blake2b", "blake2", "blake-2b", "blake 2b", "rfc 7693", "blake2哈希", "blake二代", "blake2b-512", "64位blake2", "blake2b hash", "现代快速哈希", "blake家族"],
  },

  blake2s: {
    what: "The 32-bit version of BLAKE2 (RFC 7693), optimized for 32-bit platforms and small devices, defaulting to 256-bit output, up to 32 bytes. Functionally equivalent to blake2b, just with a smaller word length.",
    principle: "The same ChaCha-style mix of the BLAKE2 family, switching to 32-bit words and 10 rounds, suited for embedded and 32-bit environments. Output length is customizable (1-32 bytes). One-way, irreversible.",
    usage: "Enter text, output the BLAKE2s digest (default 256 bits = 64 hex characters, one-way run).",
    examples: [
      { in: "abc", out: "508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982", desc: "RFC 7693 default 256-bit output" },
    ],
    tips: [
      "blake2s vs blake2b: `s` = small (32-bit words, output up to 32 bytes), `b` = big (64-bit words, up to 64 bytes).",
    ],
    aka: ["blake2s", "blake-2s", "blake 2s", "blake2s-256", "32位blake2", "blake2s hash", "小端blake2", "blake二代32位", "blake2 small", "rfc 7693 blake2s", "嵌入式哈希", "blake家族32位"],
  },

  adler32: {
    what: "A fast checksum used by zlib (RFC 1950), output 32 bits. It computes faster than CRC32 but has weaker error detection on short data. It's a checksum, not a hash.",
    principle:
      "Maintain two accumulators A and B: A is the sum of all bytes, B is the running sum of A at each step, both taken modulo the prime `65521`, finally combined as `B<<16 | A`. Addition is lighter than CRC's polynomial division, hence faster.\n\n" +
      "A starts at 1 (not 0), one of its small details.",
    usage: "Enter data, output the Adler-32 check value (hex, one-way run).",
    examples: [
      { in: "Wikipedia", out: "0x11E60398", desc: "The classic example from the Wikipedia article" },
    ],
    formulas: [
      { tex: "A = 1 + \\textstyle\\sum d_i \\bmod 65521,\\quad B = \\textstyle\\sum A_i \\bmod 65521", caption: "Adler-32 dual accumulators" },
    ],
    tips: [
      "The last 4 bytes at the tail of a zlib data stream are Adler-32, usable to verify decompression is correct.",
      "On short data Adler-32 detects errors worse than CRC32, but wins on speed.",
    ],
    aka: ["adler-32", "adler", "zlib校验和", "adler32", "adler校验和", "adler checksum", "rfc 1950", "zlib adler", "adler32校验", "adler32 checksum", "校验和adler", "双累加器校验"],
  },

  crc8: {
    what: "An 8-bit cyclic redundancy check; this preset uses SMBus parameters (polynomial `0x07`). Short-message protocols like sensors, SMBus/PMBus use it for single-byte checking.",
    principle: "Same principle as CRC32, just with an 8-bit register and polynomial `0x07`, init=0, no reflection, xorOut=0. Output is a single byte (two hex digits). A table-lookup method advances byte by byte.",
    usage: "Enter data, output the 8-bit CRC check value (hex, one-way run).",
    examples: [
      { in: "123456789", out: "0xF4", desc: "CRC-8/SMBUS standard check value" },
    ],
    tips: [
      "Only a single byte of check, high collision probability, used only for short-data error detection.",
      "CRC-8 also has many variants; if it doesn't match, first suspect the wrong parameters.",
    ],
    aka: ["crc-8", "crc8/smbus", "循环冗余校验8", "crc8", "crc-8/smbus", "8位crc", "crc8校验", "smbus crc", "crc8 poly 0x07", "循环冗余校验码8", "crc8 checksum", "单字节crc"],
  },

  crc8_maxim: {
    what: "The Dallas/Maxim 1-Wire variant of CRC-8 (polynomial `0x31`, reflected implementation). Used by 1-Wire devices like the DS18B20 temperature sensor for ROM checksums.",
    principle: "8-bit CRC with parameters poly=0x31, init=0, refIn/refOut=true (bit reflection), xorOut=0. Reflection means processing bits from the least significant end, exactly the opposite of the SMBus preset.",
    usage: "Enter data, output the CRC-8/MAXIM check value (hex, one-way run).",
    examples: [
      { in: "123456789", out: "0xA1", desc: "CRC-8/MAXIM standard check value" },
    ],
    tips: [
      "When the challenge mentions 1-Wire / DS18B20 / Dallas / Maxim → use this preset, not the SMBus one.",
    ],
    aka: ["crc-8/maxim", "crc8 dallas", "1-wire crc", "crc8/maxim-dow", "crc8 maxim", "ds18b20 crc", "dallas 1-wire", "crc8/dow", "maxim crc8", "crc8 poly 0x31", "1线crc", "单总线crc"],
  },

  crc64: {
    what: "A 64-bit cyclic redundancy check; this preset uses ECMA-182 parameters (polynomial `0x42F0E1EBA9EA3693`). The XZ compression format uses it to verify integrity of large files.",
    principle: "Same principle as other CRCs, with a register as wide as 64 bits and a longer polynomial, hence extremely low collision probability, suited for large-data integrity checking. ECMA-182 variant: init=0, no reflection, xorOut=0.",
    usage: "Enter data, output the 64-bit CRC check value (hex, one-way run).",
    examples: [
      { in: "123456789", out: "0x6C40DF5F0B497347", desc: "CRC-64/ECMA-182 standard check value" },
    ],
    tips: [
      "A 16-hex checksum is probably CRC-64.",
      "XZ / .xz files use CRC-64 checksums, so think of this when the challenge mentions it.",
    ],
    aka: ["crc-64", "crc64/ecma-182", "crc64/xz", "crc64", "64位crc", "crc64 ecma", "ecma-182", "xz crc", "crc64校验", "循环冗余校验64", "crc64 checksum", "大文件crc"],
  },

  crc32c: {
    what: "The Castagnoli variant of CRC-32 (polynomial `0x1EDC6F41`), with better error detection than the IEEE version. iSCSI, ext4, and SSE4.2 hardware instructions all use it; note its result differs from ordinary CRC32.",
    principle: "The same polynomial division as CRC32, just with the Castagnoli polynomial `0x1EDC6F41` (reflected implementation `0x82F63B78`), init=0xFFFFFFFF, bit reflection, final XOR 0xFFFFFFFF. This polynomial is superior in error-detection properties to the IEEE 802.3 one.",
    usage: "Enter data, output the CRC-32C check value (hex, one-way run).",
    examples: [
      { in: "123456789", out: "0xE3069283", desc: "CRC-32C/Castagnoli standard check value (differs from IEEE CRC32's 0xCBF43926)" },
    ],
    tips: [
      "Both are 8 hex characters, but CRC-32C and ordinary CRC32 give completely different results — don't mix them. The x86 `crc32` instruction computes exactly this one.",
      "When the challenge mentions iSCSI / ext4 / SSE4.2 → CRC-32C.",
    ],
    aka: ["crc-32c", "crc32c", "castagnoli", "crc32/iscsi", "crc32 castagnoli", "iscsi crc", "sse4.2 crc", "crc32c校验", "ext4 crc", "crc32 poly 0x1edc6f41", "castagnoli crc", "硬件crc32"],
  },

  fnv1a: {
    what: "FNV-1a is a family of minimalist non-cryptographic hashes, designed for hash tables / fast scatter, not security. Width is selectable 32/64 (default 32): 32-bit outputs 8 hex characters, 64-bit outputs 16.",
    principle:
      "Byte by byte 'XOR first, then multiply' (`1a` refers to this order; FNV-1 is multiply first, XOR after). 32-bit: offset=`0x811C9DC5`, prime=`0x01000193`, mod $2^{32}$. 64-bit: offset=`0xCBF29CE484222325`, prime=`0x100000001B3`, mod $2^{64}$. The two presets differ only in offset basis and prime; the loop structure is identical.",
    usage: "Enter data, choose the width, output the FNV-1a hash (hex, one-way run).",
    examples: [
      { in: "(empty string, 32)", out: "0x811C9DC5", desc: "Empty input is directly the 32-bit offset basis" },
      { in: "(empty string, 64)", out: "0xCBF29CE484222325", desc: "Empty input is directly the 64-bit offset basis" },
    ],
    formulas: [
      { tex: "h \\leftarrow (h \\oplus b_i)\\times \\mathtt{prime} \\bmod 2^{n}", caption: "FNV-1a per byte: XOR first, then multiply (n=32 or 64)" },
    ],
    tips: [
      "Recognize by signature: constants `0x811C9DC5`/`0x01000193` → 32-bit; `0xCBF29CE484222325`/`0x100000001B3` → 64-bit.",
      "A non-cryptographic hash — don't treat it as a security digest, common in internal program scatter / consistent hashing.",
    ],
    aka: ["fnv-1a", "fnv1a-32", "fnv1a-64", "fnv 32位", "fnv 64位", "fowler noll vo", "fnv1a", "fnv哈希", "fnv hash", "非加密哈希", "fowler-noll-vo", "fnv散列"],
  },
};
