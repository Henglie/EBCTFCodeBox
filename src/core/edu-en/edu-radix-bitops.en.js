// English edu shard: radix bit-ops family — 5 ops. Pure data, no imports, no side effects.
// bitReverse/bitRotate/byteSwap/grayCodeBytes/bitPlaneExtract
export default {
  bitReverse: {
    what: "Mirror-flips the 8 bits of each byte left-to-right (bit 0 ↔ bit 7, 1 ↔ 6…). Doing it twice restores the original, so it's a self-inverse transform.",
    principle:
      "Bit-mirror each byte: `bit i` moves to `bit 7-i`. Implemented with divide-and-conquer swaps (first swap the high/low 4 bits, then 2 bits, then 1 bit).\n\n" +
      "Text is first converted to UTF-8 bytes, then each byte is flipped and output as Hex; decoding turns Hex back into bytes and flips once more to restore.",
    usage: "encode turns text into flipped Hex, decode flips Hex back into text. No parameters.",
    examples: [
      { in: "A", out: "82", desc: "'A'=0x41=01000001 → 10000010=0x82" },
      { in: "82", param: "Decode", out: "A" },
    ],
    tips: ["Some serial/LSB-first protocols send the low bit first; bit reversal corrects this kind of \"within-byte bit-order reversal\".", "Self-inverse: encoding and decoding are the same operation, so if it won't decode, try running it the other way as an encode."],
    aka: ["位反转", "bit reverse", "位镜像", "字节内翻转", "bit mirror", "比特反转", "bit reversal", "位序反转", "反转位", "reverse bits", "bit flip镜像", "位倒序", "reverse bits in byte", "bit-order reversal"],
  },

  bitRotate: {
    what: "Circularly shifts the 8 bits within each byte (bits shifted out wrap around from the other end). Left or right, 1–7 positions. encode rotates, decode rotates back to restore.",
    principle:
      "Rotate left by n bits: `(b << n) | (b >> (8-n))` then take the low 8 bits; rotate right is the reverse. No bit is lost, it just wraps around.\n\n" +
      "Text is converted to UTF-8 bytes, each byte is rotated, and the result is output as Hex. decode rotates the same number of bits in the opposite direction.",
    usage: "Choose direction (left/right) and bit count (1–7). encode rotates forward, decode rotates back to restore. Text ↔ Hex.",
    examples: [
      { in: "A", param: "Rotate left 1 bit", out: "82", desc: "01000001 rotated left by 1 → 10000010" },
      { in: "82", param: "Rotate left 1 bit, decode", out: "A" },
    ],
    tips: ["Difference from a plain shift: rotation loses no bits and is reversible. A plain `<<` pushes the high bits off the end.", "ROL/ROR are common assembly instructions; reverse-engineering challenges often use them for data obfuscation."],
    aka: ["位循环移位", "bit rotate", "循环移位", "rol", "ror", "位旋转", "循环左移", "循环右移", "bit rotation", "rotate left right", "字节内循环移位", "比特旋转", "circular shift", "rotate bits"],
  },

  byteSwap: {
    what: "Reverses the byte order within groups of 2/4/8 bytes. That's endianness (big-endian ↔ little-endian) conversion. Doing it twice with the same group size restores the original.",
    principle:
      "Split the byte stream into groups and swap the first and last bytes within each group (`0↔n-1, 1↔n-2`…). A 2-byte group = 16-bit endian swap, 4-byte = 32-bit, 8-byte = 64-bit.\n\n" +
      "Text is converted to UTF-8 bytes, grouped and reversed, then output as Hex.",
    usage: "Choose group size in bytes (2/4/8). encode turns text into byte-order-reversed Hex, decode does the same operation to restore (self-inverse).",
    examples: [
      { in: "AB", param: "2-byte group", out: "4241", desc: "41 42 → 42 41" },
      { in: "4241", param: "2-byte group, decode", out: "AB" },
    ],
    tips: ["In reverse engineering, a \"backwards-looking\" hex number like `0x78563412` is usually little-endian storage; use this to turn it back into `0x12345678`.", "Network byte order is big-endian, x86 memory is little-endian — try this when a packet capture/dump doesn't line up."],
    aka: ["字节序反转", "byte swap", "大小端转换", "endian", "端序转换", "字节交换", "byte order swap", "大端小端", "big endian little endian", "字节反序", "bswap", "字节序转换", "endianness swap", "byte order reversal"],
  },

  grayCodeBytes: {
    what: "Applies the Gray code transform ($g = b \\oplus (b\\gg1)$) to each byte independently. Unlike the numeric grayNum, this processes a byte stream one byte at a time.",
    principle:
      "Per byte: `g = b ^ (b>>1)` to encode; to decode, accumulate XOR downward bit by bit (`g ^= g>>1; g ^= g>>2; g ^= g>>4`) to restore.\n\n" +
      "Text is converted to UTF-8 bytes, done per byte, and output as Gray Hex.",
    usage: "encode turns text into per-byte Gray-code Hex, decode reverses it. No parameters.",
    examples: [
      { in: "A", out: "61", desc: "0x41=01000001 → 01100001=0x61" },
      { in: "61", param: "Decode", out: "A" },
    ],
    tips: ["Distinguish from grayNum: grayNum treats a whole decimal number as one integer, this one operates on each byte independently and targets byte data.", "Image/signal data is sometimes Gray-coded per byte to reduce adjacent noise; watch for it when reverse-engineering data streams."],
    aka: ["字节级格雷码", "gray code bytes", "逐字节格雷码", "字节格雷", "per-byte gray code", "byte-wise gray code"],
  },

  bitPlaneExtract: {
    what: "Pulls a specified bit (bit k) out of each byte and concatenates that bit from all bytes into one bit string. It's a lossy, one-way operation.",
    principle:
      "Bit plane: extract bit k of the data (k=0 is the least-significant bit LSB, 7 is the most-significant bit MSB) on its own into a string. By default it outputs all 8 bit planes.\n\n" +
      "Because it keeps only one bit and drops the other 7, it can't be reversed, hence one-way.",
    usage: "Choose the bit plane (0–7 or all), run outputs the bit string made of that bit. This is the seed of image LSB steganalysis.",
    examples: [
      { in: "Hi", param: "All", out: "bit 7 (MSB): 00\nbit 0 (LSB): 01", desc: "H=0x48,i=0x69 take bit 7 / bit 0 (excerpt)" },
    ],
    tips: ["Image steganography often hides information in the least-significant bit (LSB) of pixels; extracting the bit 0 plane can reveal hidden patterns.", "If extracting the MSB of text bytes gives all 0, that means it's pure ASCII (every byte < 128)."],
    aka: ["位平面提取", "bit plane", "位平面", "lsb平面", "比特平面", "bit plane extraction", "位平面分离", "lsb位平面", "图像位平面", "bit plane slicing", "msb位平面", "比特平面提取"],
  },
};
