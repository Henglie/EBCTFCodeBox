// English edu shard: hash first 11 (md4/sha384/crc32/crc16/sha3_224/sha3_256/sha3_384/sha3_512/keccak256/shake128/shake256). Pure data, no import, no side effects.
export default {
  md4: {
    what: "A very old message digest algorithm, output 128 bits (32 hex characters). Barely used for security today, but it's the basis of Windows NTLM password hashing, common in forensics / domain penetration challenges.",
    principle:
      "Block iterative compression: split data into 512-bit blocks and stir a 128-bit internal state through 3 rounds totaling 48 bit-operation steps, finally outputting a 128-bit digest. One-way, irreversible — you can only 'compute' it, not 'reverse' it.\n\n" +
      "MD4's collision resistance was broken long ago, but because it's fast and part of NTLM, it still shows up in reverse engineering and forensics.",
    usage: "Enter any text, output the MD4 digest (one-way run). To recover the original from a digest, use dictionary brute-force.",
    examples: [
      { in: "(empty string)", out: "31d6cfe0d16ae931b73c59d7e0c089c0", desc: "MD4 of empty input, which is also exactly the NTLM of an empty password" },
      { in: "abc", out: "a448017aaf21d8525fc10ae87aa6729d", desc: "RFC 1320 test vector" },
    ],
    tips: [
      "A 32-hex string could be MD5 or MD4/NTLM — length alone can't tell them apart, you need the challenge context.",
      "When the challenge mentions Windows / SAM / domain accounts → NTLM (= MD4(UTF-16LE password)) takes priority over MD5.",
    ],
    aka: ["message digest 4", "md-4", "md4摘要", "MD4", "消息摘要4", "NTLM", "NTLM哈希", "NT hash", "RFC 1320", "128位摘要", "md4 hash", "windows口令哈希"],
  },

  sha384: {
    what: "A member of the SHA-2 family, output 384 bits (96 hex characters). Essentially a 'truncated SHA-512' using the same 64-bit word operations, just with different initial values and a truncated end.",
    principle:
      "Internally isomorphic to SHA-512 (64-bit words, 80 compression rounds), differing only in two points: it uses a different set of initial hash values, and it truncates the 512-bit result to the first 384 bits. Truncation blocks length-extension attacks. One-way, irreversible.",
    usage: "Enter text, output the SHA-384 digest (computed via WebCrypto, one-way).",
    examples: [
      { in: "(empty string)", out: "(96-hex digest)", desc: "Output is always 96 hex characters" },
    ],
    tips: [
      "96 hex characters → SHA-384, the only common algorithm of this length among hashes.",
      "It's immune to length-extension attacks (because of truncation), which makes it steadier than SHA-256 in that respect.",
    ],
    aka: ["sha-384", "sha2-384", "SHA384", "SHA-384", "安全散列算法384", "secure hash algorithm 384", "sha2 384", "384位哈希", "96位十六进制哈希", "sha384摘要", "SHA-2 384", "截断SHA-512"],
  },

  crc32: {
    what: "The most common cyclic redundancy check, output 32 bits. It's not a cryptographic hash — it exists to detect whether data was 'transmitted or stored wrong'. It's everywhere in zip, png, and Ethernet frames.",
    principle:
      "Treat the data as one big binary polynomial, divide it by a fixed generator polynomial (IEEE 802.3 uses `0x04C11DB7`, reflected implementations often written as `0xEDB88320`), and the remainder is the check value. In practice a table-lookup method advances one byte at a time for speed.\n\n" +
      "It's linear and can be deliberately constructed, so it must never be used as a security hash — but for verifying data integrity it's fast and good.",
    usage: "Enter data, output the CRC32 check value (hex, one-way run).",
    examples: [
      { in: "123456789", out: "0xCBF43926", desc: "The recognized standard check string and result in the CRC world" },
    ],
    tips: [
      "When you see an 8-hex 'checksum' rather than a 32-hex digest, it's probably CRC32 rather than a hash.",
      "CRC is reversibly constructible: you can compute patch bytes that make CRC equal a target value — zero security.",
    ],
    aka: ["crc-32", "crc32/ieee", "循环冗余校验", "CRC32", "cyclic redundancy check", "循环冗余校验码", "crc32 checksum", "crc校验", "IEEE 802.3 CRC", "0xEDB88320", "crc32/iso-hdlc", "32位校验和"],
  },

  crc16: {
    what: "A 16-bit cyclic redundancy check; this preset uses CCITT-FALSE parameters (polynomial `0x1021`, init `0xFFFF`). Old protocols like serial ports and modems often use it to guard against transmission errors.",
    principle:
      "Same principle as CRC32, just with a 16-bit polynomial and register width. CRC-16 has a whole pile of parameter variants (init, whether bits are reflected, final XOR can all differ); CCITT-FALSE is one fixed combination: poly=0x1021, init=0xFFFF, no reflection, xorOut=0.",
    usage: "Enter data, output the 16-bit CRC check value (hex, one-way run).",
    examples: [
      { in: "123456789", out: "0x29B1", desc: "The standard check value for CRC-16/CCITT-FALSE" },
    ],
    tips: [
      "CRC-16 has many variants; the same data gives completely different results under different parameters — if it doesn't match, first suspect the parameters (init / reflection) are wrong and try a generic CRC one by one.",
    ],
    aka: ["crc-16", "crc16/ccitt-false", "循环冗余校验16", "CRC16", "CRC-16/CCITT", "16位循环冗余校验", "crc16 checksum", "0x1021多项式", "CCITT校验", "16位CRC", "crc16校验和", "串口CRC"],
  },

  sha3: {
    what: "The SHA-3 family of hashes, width selectable 224/256/384/512 (default 256). SHA-3 looks like SHA-2 but has a completely different core: it's based on the Keccak sponge construction, a backup standard (FIPS 202) prepared 'in case SHA-2 fails'. The 256 preset is the most common (64 hex characters).",
    principle:
      "Sponge construction: 'absorb' data block by block into a 1600-bit large state, running 24 rounds of the Keccak-f permutation to stir between blocks, then 'squeeze' out the required number of bits. Larger output means a smaller absorption rate. The padding tail byte is always `0x06` (unlike original Keccak's `0x01`). Width only changes the squeeze length and absorption rate; the main algorithm is the same.",
    usage: "Enter text, choose the width, output the SHA3 digest (pure JS Keccak, one-way).",
    examples: [
      { in: "(empty string, 256)", out: "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a", desc: "SHA3-256 of empty input" },
      { in: "(empty string, 224)", out: "(56-hex digest)", desc: "224 bits = 56 hex characters" },
    ],
    tips: [
      "SHA-3 is naturally immune to length-extension attacks (a property of the sponge construction), a major selling point over SHA-2.",
      "SHA3-* and the same-named Keccak-* differ by just one padding byte, with completely different results — don't mix them up.",
      "At 64 hex characters, SHA3-256 and SHA-256 can't be told apart by eye; you need the challenge's declaration.",
    ],
    aka: ["sha3", "sha3-224", "sha3-256", "sha3-384", "sha3-512", "keccak sha3", "SHA-3", "FIPS 202", "海绵结构哈希", "sponge hash", "安全散列算法3", "secure hash algorithm 3"],
  },

  keccak256: {
    what: "The original version of Keccak (padding tail byte `0x01`), output 256 bits. Ethereum uses it throughout for addresses, transactions, and contract hashes — a must-encounter in blockchain challenges.",
    principle:
      "The core is exactly the same sponge construction + 24 rounds of Keccak-f permutation as SHA3-256; the only difference is that padding uses the original `0x01` rather than the `0x06` adopted during SHA-3 standardization. That one-byte difference makes the two produce completely different results for the same input.",
    usage: "Enter text, output the Keccak-256 digest (one-way run).",
    examples: [
      { in: "(empty string)", out: "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470", desc: "The most-cited empty Keccak-256 in the Ethereum context" },
    ],
    tips: [
      "When the challenge mentions Ethereum / Solidity / EVM / 0x address checksums → use Keccak-256, not SHA3-256 by mistake.",
      "Ethereum's EIP-55 mixed-case address checksum is computed bit by bit with Keccak-256.",
    ],
    aka: ["keccak-256", "keccak256", "以太坊哈希", "ethereum keccak", "Keccak-256", "Keccak", "以太坊keccak", "keccak原始版", "ethereum hash", "EVM哈希", "solidity keccak", "keccak256哈希"],
  },

  shake128: {
    what: "SHAKE is the 'extendable output function' (XOF) in SHA-3: you decide how long the output is. SHAKE128 provides about 128-bit security strength; squeeze out as many bytes of digest as you want.",
    principle:
      "Still the Keccak sponge construction, but the 'squeeze' phase can continue indefinitely — as many bits as you ask for. The padding tail byte is `0x1F` (unlike SHA3's `0x06`). Security strength is denoted by the number (128) and is independent of output length.",
    usage: "Enter text + the desired number of output bytes, output a hex digest of the corresponding length (one-way).",
    examples: [
      { in: "(empty string)", param: "32 bytes", out: "7f9c2ba4e88f827d616045507605853ed73b8093f6efbc88eb1a6eacfa66ef26", desc: "Squeeze 32 bytes from empty input" },
    ],
    tips: [
      "For the same input, squeezing 16 bytes gives exactly the first 16 bytes of the 32-byte result (the prefix property) — a hallmark of XOF.",
      "Variable length is the giveaway: if the challenge gives a digest of an odd length (not a standard value like 32/64) → think SHAKE.",
    ],
    aka: ["shake-128", "xof", "可扩展输出函数", "SHAKE128", "SHAKE-128", "extendable output function", "可变长哈希", "keccak XOF", "shake128摘要", "变长输出哈希", "FIPS 202 XOF", "sha3 xof"],
  },

  shake256: {
    what: "The high-strength SHAKE preset, providing about 256-bit security strength, with an equally arbitrary output length (XOF, FIPS 202).",
    principle: "Same sponge + extendable squeeze as SHAKE128, just with a smaller absorption rate and a denoted strength of 256; the padding tail byte is still `0x1F`.",
    usage: "Enter text + the desired number of output bytes, output a digest of the corresponding length (one-way).",
    examples: [
      { in: "(empty string)", param: "32 bytes", out: "46b9dd2b0ba88d13233b3feb743eeb243fcd52ea62b81b82b50c27646ed5762f", desc: "Squeeze 32 bytes from empty input" },
    ],
    tips: [
      "It also has the prefix property: a shorter output is a prefix of a longer one.",
    ],
    aka: ["shake-256", "xof256", "可扩展输出函数256", "SHAKE256", "SHAKE-256", "extendable output function 256", "可变长哈希256", "keccak XOF256", "shake256摘要", "变长输出哈希256", "FIPS 202 XOF256", "高强度XOF"],
  },
};
