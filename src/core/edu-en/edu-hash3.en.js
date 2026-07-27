// English edu shard: hash segment 23-32 (murmur3_32/crcGeneric/crc16Modbus/crc16CcittTrue/crc16Arc/crc16Xmodem/fletcher/bsdSum/sysvSum). Pure data, no import, no side effects.
export default {
  murmur3_32: {
    what: "MurmurHash3 is a family of fast non-cryptographic hashes with high scatter quality and speed, widely used in hash tables / Bloom filters / consistent hashing. This is the x86 32-bit preset, seed default 0.",
    principle:
      "Process data in 4-byte blocks: each block is multiplied by a constant, bit-rotated, multiplied by another constant, then mixed into the hash; a trailing partial block of fewer than 4 bytes is handled separately; finally an 'avalanche' finalizer (repeated XOR-shift + multiply) ensures every input bit diffuses fully. Non-cryptographic, not resistant to malicious collisions.",
    usage: "Enter data, output the MurmurHash3 x86 32-bit hash (hex, one-way run).",
    examples: [
      { in: "(empty string)", param: "seed=0", out: "0x00000000", desc: "Empty input + seed 0 happens to be 0" },
    ],
    tips: [
      "In CTFs it often appears as an internal program scatter; changing the seed changes the result, so note the seed the challenge gives.",
      "A non-cryptographic hash whose collisions can be crafted deliberately — don't treat it as a security digest.",
    ],
    aka: ["murmurhash3", "murmur3", "murmur 32", "mmh3", "murmurhash", "murmur hash", "murmurhash3 x86 32", "非加密哈希", "murmur3_32", "murmur散列", "austin appleby"],
  },

  crcGeneric: {
    what: "A universal CRC calculator where you can fill in any parameters. There are hundreds of CRC variants, so rather than making a button for each, it exposes the six parameters for you to configure.",
    principle:
      "Any CRC variant is uniquely determined by six parameters: `width`, `poly` (generator polynomial), `init` (register initial value), `refIn` (whether input bits are reflected), `refOut` (whether output bits are reflected), `xorOut` (final XOR value). Fill these six correctly and you can reproduce any CRC. The tool also has built-in CRC-16 / CRC-32 common presets.",
    usage: "Fill in width/poly/init/refIn/refOut/xorOut (or pick a preset), enter data, output the hex check value (one-way run).",
    examples: [
      { in: "123456789", param: "CRC-32 preset", out: "0xCBF43926", desc: "With the parameters right, it reproduces the standard value" },
    ],
    tips: [
      "When you hit an unknown CRC, look up its six parameters in a CRC parameter catalogue and fill them in to reproduce it.",
      "Use the standard string `123456789` to verify the parameters match: if the computed value equals the catalogue's `check` value, you've filled them in correctly.",
    ],
    aka: ["通用crc", "crc参数化", "crc custom", "crc rocksoft", "自定义crc", "crc计算器", "parametric crc", "crc generic", "循环冗余校验", "cyclic redundancy check", "crc catalogue", "可配置crc"],
  },

  crc16Modbus: {
    what: "The MODBUS variant of CRC-16; the check at the tail of each frame in the industrial Modbus RTU protocol is exactly this. Parameters are fixed: poly=`0x8005`, init=`0xFFFF`, bit reflection.",
    principle: "16-bit CRC with poly=0x8005, init=0xFFFF, refIn/refOut=true (bit reflection), xorOut=0. In the reflected implementation the polynomial is often written as `0xA001`.",
    usage: "Enter data, output the CRC-16/MODBUS check value (hex, one-way run).",
    examples: [
      { in: "123456789", out: "0x4B37", desc: "CRC-16/MODBUS standard check value" },
    ],
    tips: [
      "When the challenge mentions Modbus / RTU / industrial control protocols → it's this preset.",
      "In Modbus frames the CRC is often placed little-endian (low byte first); mind the byte order when parsing.",
    ],
    aka: ["crc-16/modbus", "modbus crc", "crc16 modbus", "modbus rtu校验", "crc16/modbus", "工控crc", "0x8005 0xffff", "modbus checksum", "crc-16 modbus", "rtu crc", "工业协议校验"],
  },

  crc16CcittTrue: {
    what: "The CCITT-FALSE variant of CRC-16 (poly=`0x1021`, init=`0xFFFF`, no reflection). The 'FALSE' in the name is a historical misnomer, yet it is actually the most commonly used CCITT-style CRC-16 preset.",
    principle: "16-bit CRC with poly=0x1021, init=0xFFFF, refIn/refOut=false (no reflection), xorOut=0. The polynomial 0x1021 is shared across the CCITT family; the differences lie entirely in the combination of init / reflection / xorOut.",
    usage: "Enter data, output the CRC-16/CCITT-FALSE check value (hex, one-way run).",
    examples: [
      { in: "123456789", out: "0x29B1", desc: "CRC-16/CCITT-FALSE standard check value" },
    ],
    tips: [
      "The CCITT family (CCITT-FALSE / XMODEM / KERMIT etc.) all use poly=0x1021, indistinguishable by polynomial alone — you must check the init and reflection.",
    ],
    aka: ["crc-16/ccitt-false", "crc16 ccitt", "crc-16/ibm-3740", "ccitt false", "crc16/ccitt-false", "crc-16/autosar", "0x1021 0xffff", "ccitt crc", "crc16 ccitt false", "crc-ccitt", "ccitt风格crc"],
  },

  crc16Arc: {
    what: "The ARC variant of CRC-16 (poly=`0x8005`, init=0, bit reflection), used by the old LHA / ARC compression tools. When bare 'CRC-16' is mentioned, it usually means this preset.",
    principle: "16-bit CRC with poly=0x8005, init=0x0000, refIn/refOut=true (bit reflection), xorOut=0. It differs from the MODBUS preset only in init (here 0, MODBUS is 0xFFFF).",
    usage: "Enter data, output the CRC-16/ARC check value (hex, one-way run).",
    examples: [
      { in: "123456789", out: "0xBB3D", desc: "CRC-16/ARC standard check value" },
    ],
    tips: [
      "When someone just says 'CRC16' without parameters, in many contexts it defaults to this ARC preset — try it first.",
    ],
    aka: ["crc-16/arc", "crc16 arc", "crc-ibm", "lha crc", "crc-16", "crc16", "arc crc", "crc-16/lha", "0x8005 init0", "crc16/arc", "裸crc16", "crc-16 ibm"],
  },

  crc16Xmodem: {
    what: "The XMODEM variant of CRC-16 (poly=`0x1021`, init=0, no reflection), used by the XMODEM file transfer protocol.",
    principle: "16-bit CRC with poly=0x1021, init=0x0000, refIn/refOut=false, xorOut=0. Same polynomial and same no-reflection as CCITT-FALSE, differing only in init (here 0, that preset 0xFFFF).",
    usage: "Enter data, output the CRC-16/XMODEM check value (hex, one-way run).",
    examples: [
      { in: "123456789", out: "0x31C3", desc: "CRC-16/XMODEM standard check value" },
    ],
    tips: [
      "The poly is 0x1021 for both, so XMODEM and CCITT-FALSE differ only in init (0 vs 0xFFFF) — if it doesn't match, switch init first.",
    ],
    aka: ["crc-16/xmodem", "crc16 xmodem", "crc-16/zmodem", "crc-ccitt xmodem", "xmodem crc", "crc16/xmodem", "0x1021 init0", "crc-16/acorn", "zmodem crc", "xmodem文件校验", "crc16 zmodem"],
  },

  fletcher: {
    what: "The Fletcher checksum, implemented with two accumulators, computes faster than CRC with error detection close to it. It's a checksum, not a hash. Width is selectable 16/32 (default 16); 32-bit detects errors better than 16-bit.",
    principle:
      "Dual accumulators sum1, sum2: for each unit read, sum1 adds the unit and sum2 adds sum1, making it position-sensitive (reordering changes the result). 16-bit: over a byte stream, two 8-bit accumulators mod `255`, output `sum2<<8 | sum1`. 32-bit: over 16-bit words (little-endian), two 16-bit accumulators mod `65535`, an odd trailing byte padded with 0, output `sum2<<16 | sum1`. Both the grouping granularity and the modulus differ between the two presets.",
    usage: "Enter data, choose the width, output the Fletcher check value (hex, one-way run).",
    examples: [
      { in: "abcde (16)", out: "0xC8F0", desc: "The classic Wikipedia Fletcher-16 example" },
      { in: "abcde (32)", out: "0xF04FC729", desc: "The classic Wikipedia Fletcher-32 example" },
    ],
    formulas: [
      { tex: "\\text{sum1} \\mathrel{+}= d_i,\\quad \\text{sum2} \\mathrel{+}= \\text{sum1}\\ (\\bmod\\ M)", caption: "Fletcher dual accumulators (16-bit M=255, 32-bit M=65535)" },
    ],
    tips: [
      "Similar idea to Adler-32 (both dual-accumulator), the difference is the modulus: Fletcher-16 mod 255, Adler mod 65521.",
      "32-bit processes 16-bit words, so how odd-length data is padded affects the result — mind the implementation convention.",
    ],
    aka: ["fletcher-16", "fletcher16", "fletcher-32", "fletcher32", "弗莱彻校验和", "弗莱彻校验和32", "fletcher checksum", "弗莱彻校验", "双累加器校验和", "fletcher algorithm", "弗莱切校验和", "fletcher8"],
  },

  bsdSum: {
    what: "The checksum algorithm of the old BSD `sum` command, output 16 bits. Its core is 'rotate right first, then add', capturing byte-order changes better than plain accumulation.",
    principle:
      "Maintain a 16-bit value; for each byte read: first rotate the current value right by 1 bit (the lowest bit wraps to the highest), then add the byte, mod $2^{16}$. That circular rotation makes it byte-position-sensitive, stronger than plain summation.",
    usage: "Enter data, output the BSD checksum (hex / decimal, one-way run).",
    examples: [
      { in: "any data", out: "16-bit check value", desc: "Corresponds to the output of BSD `sum` / `sum -r`" },
    ],
    tips: [
      "BSD `sum` and SysV `sum` are two different algorithms giving different results for the same file — don't mix them.",
    ],
    aka: ["bsd checksum", "bsd sum", "sum -r", "bsd校验和", "bsd sum算法", "循环右移校验和", "unix sum", "bsd sum checksum", "16位bsd校验", "sum命令", "bsd风格校验和"],
  },

  sysvSum: {
    what: "The checksum algorithm of the System V `sum` command, output 16 bits. It 'sums all bytes then folds', simpler than the BSD version.",
    principle:
      "First accumulate all bytes directly into a large integer s; then fold it into 16 bits: take `s = (s & 0xFFFF) + (s >> 16)`, possibly folding once more, to get the final 16-bit result. There is no rotation, so it is byte-order-insensitive (reordering doesn't change the result).",
    usage: "Enter data, output the SysV checksum (hex / decimal, one-way run).",
    examples: [
      { in: "any data", out: "16-bit check value", desc: "Corresponds to the output of SysV `sum -s`" },
    ],
    tips: [
      "Pure additive folding → byte-order-insensitive, the essential difference from BSD sum (which rotates and is sensitive).",
    ],
    aka: ["sysv checksum", "system v sum", "sum -s", "sysv校验和", "system v校验和", "sysv sum算法", "折叠校验和", "unix sysv sum", "16位sysv校验", "sysv sum checksum", "系统v求和"],
  },
};
