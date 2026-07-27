// English edu shard: base family — base36/45/92/100/radixN/baseCustom/base58check/radix64/base69/z85/base85ipv6/base2048
export default {
  base36: {
    what: "Encodes bytes using 36 characters (0–9 and a–z) by treating the entire byte string as one big integer in base 36.",
    principle:
      "Concatenate UTF-8 bytes into a big integer, then repeatedly divide by 36 and read remainders using the alphabet `0-9a-z`.\n\n" +
      "Leading zero bytes produce leading `0` characters; the rest unfold from the integer. No grouping, no padding — output length varies.",
    usage: "Decode: paste a base36 string to recover the original. Encode: convert text to base36. Custom 36-char alphabets are supported.",
    examples: [
      { in: "eax", out: "Hi" },
      { in: "flag", param: "Encode direction", out: "sf2tlz", desc: "Encodes plaintext to base36" },
    ],
    tips: [
      "Lowercase letters + digits only, no uppercase, no symbols, variable length → suspect base36.",
      "Like base16/62, it's a big-integer radix encoding, not bit-chunk-based.",
    ],
    aka: ["base 36", "b36", "radix36", "alphanumeric base", "base thirty-six"],
  },

  base45: {
    what: "An encoding designed for QR codes (RFC 9285): 2 bytes → 3 characters. Alphabet: uppercase letters, digits, and a few symbols.",
    principle:
      "Treat every 2 bytes as a number 0–65535 and write it in 3 digits of base 45 (little-endian: low digit first).\n\n" +
      "A lone trailing byte becomes 2 digits. The alphabet is `0-9A-Z` plus ` $%*+-./:` — exactly 45 characters. Space is a valid alphabet character (index 36).",
    usage: "Paste base45 text to decode. Encode direction converts input to base45. Do NOT strip spaces — space is a valid character (alphabet index 36).",
    examples: [
      { in: "BB8", out: "AB", desc: "2 bytes → 3 chars" },
      { in: ".69", out: "Hi" },
    ],
    formulas: [
      { tex: "n = b_0 \\times 256 + b_1,\\quad n = c_0 + c_1\\times 45 + c_2\\times 45^2", caption: "2 bytes ↔ 3 chars (little-endian base 45)" },
    ],
    tips: [
      "All-uppercase + digits + occasional symbol, length near a multiple of 3 inside a QR code challenge → try base45.",
      "EU DCC (COVID vaccine certificates) uses base45 — its most famous application.",
    ],
    aka: ["base 45", "b45", "rfc9285", "RFC 9285", "radix45"],
  },

  base92: {
    what: "High-density encoding using 91 printable characters (plus `~` for empty input), processing 13 bits per chunk — denser than base85.",
    principle:
      "Concatenate bytes into a bit stream. Each full 13-bit chunk (0–8191) is split into two base-91 characters.\n\n" +
      "A trailing partial chunk of ≤12 bits is encoded as one 6-bit character. Empty input encodes as `~`.",
    usage: "Paste base92 text to decode; encode direction reverses. Custom alphabets are supported.",
    examples: [
      { in: "8q", out: "A", desc: "1-byte trailing 6-bit rule" },
      { in: ";L*", out: "Hi" },
    ],
    tips: [
      "Wide character set (including punctuation), high density, no obvious length pattern → suspect base92.",
      "A lone `~` represents the empty string — don't treat it as garbage.",
    ],
    aka: ["base 92", "b92", "radix92", "base ninety-two"],
  },

  base100: {
    what: "A fun encoding that maps each byte to one emoji. Looks like a wall of icons but is a straightforward 1-byte-to-1-emoji mapping.",
    principle:
      "Each byte $b$ (0–255) maps to code point $\\text{U+1F3F7} + b$, i.e. the $b$-th emoji in 256 consecutive code points starting at 🏷.\n\n" +
      "One byte → one emoji (4 UTF-8 bytes), so decoding processes 4 bytes per emoji in reverse.",
    usage: "Paste emoji string to decode back to text; encode direction converts text to emoji.",
    examples: [
      { in: "🐸", out: "A", desc: "'A'=65 → U+1F3F7+65" },
      { in: "🐿👠", out: "Hi" },
    ],
    tips: [
      "All emojis from the same contiguous Unicode block → base100.",
      "Output length is always 4× the original in bytes (each emoji is 4 UTF-8 bytes).",
    ],
    aka: ["base 100", "b100", "emoji encoding", "emoji base", "base one hundred"],
  },

  radixN: {
    what: "Convert between arbitrary numeric bases (2–36) for a raw integer value.",
    principle:
      "Any integer can be written in any base 2–36 using digits `0-9a-z`. The tool converts between any two bases.\n\n" +
      "Useful for base-2 (binary), base-8 (octal), base-16 (hex), and less common bases like base-3, base-7, etc.",
    usage: "Enter the source base and target base, paste the number string to convert.",
    examples: [
      { in: "FF", param: "hex→decimal", out: "255" },
      { in: "1010", param: "binary→hex", out: "a" },
    ],
    tips: [
      "Unlike base64/base36, this treats the input as a pure number, not an encoded byte string.",
      "Useful when a CTF challenge gives a number in an unusual base.",
    ],
    aka: ["arbitrary radix", "radix convert", "base conversion", "numeral system"],
  },

  baseCustom: {
    what: "Base64-style encoding with a custom user-defined alphabet instead of the standard A-Z/a-z/0-9+/ characters.",
    principle:
      "Same 6-bits-per-character chunking as Base64, but the 64-character alphabet is whatever the user provides.\n\n" +
      "If the custom alphabet has a different length, the bit-per-character ratio changes accordingly.",
    usage: "Enter your custom alphabet in the param field, then encode/decode. Alphabet length determines the base.",
    examples: [
      { in: "SGk=", param: "standard", out: "Hi", desc: "Standard Base64 = custom base with default alphabet" },
    ],
    tips: [
      "When Base64 output looks scrambled but you suspect a shifted or custom alphabet, try this.",
      "Common CTF variant: standard Base64 alphabet with characters shuffled.",
    ],
    aka: ["custom alphabet base64", "caesar custom base64", "custom base", "user-defined alphabet"],
  },

  base58check: {
    what: "Bitcoin's address encoding: Base58 (no 0/O/I/l) with a 4-byte checksum appended before encoding.",
    principle:
      "1. Append a 4-byte checksum: first 4 bytes of SHA256(SHA256(payload)).\n2. Encode the result in Base58 (same big-integer method, alphabet `123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz`).\n\n" +
      "Decoding validates the checksum — a single typo changes the address and fails verification.",
    usage: "Paste a Base58Check string to decode and verify checksum. Encode direction computes and appends the checksum.",
    examples: [
      { in: "1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf", out: "Bitcoin genesis block coinbase address" },
    ],
    tips: [
      "Bitcoin addresses (starting with 1 or 3), WIF private keys, extended keys — all use Base58Check.",
      "If decode throws a checksum error, the data was corrupted or it's not actually Base58Check.",
    ],
    aka: ["base58check", "bitcoin address encoding", "WIF", "Base58 with checksum"],
  },

  radix64: {
    what: "OpenPGP's Base64 variant (RFC 4880): same encoding as standard Base64 but adds a 24-bit CRC-24 checksum after the data.",
    principle:
      "Encodes binary data with standard Base64 (A-Z/a-z/0-9+/), then appends `=` padding and a `=<CRC24_base64>` line.\n\n" +
      "OpenPGP armored blocks (-----BEGIN PGP MESSAGE-----) use this format.",
    usage: "Paste radix-64 / OpenPGP-armored text to decode. Checksum is verified automatically.",
    examples: [
      { in: "SGk=\n=ZjNS", out: "Hi", desc: "data + CRC24 checksum line" },
    ],
    tips: [
      "If you see -----BEGIN PGP...----- headers and a `=XXXX` line at the end, that's Radix-64.",
      "The checksum can detect accidental corruption; a mismatch means the data is damaged.",
    ],
    aka: ["radix 64", "OpenPGP armor", "PGP base64", "RFC 4880", "crypt(3) base64"],
  },

  base69: {
    what: "A niche encoding using a 69-character printable ASCII alphabet. Packs bits at slightly better density than Base64.",
    principle:
      "Similar to Base64 but with a 69-char alphabet, producing a different bit-per-character ratio. Rarely seen outside CTF puzzles.",
    usage: "Paste base69-encoded text to decode; encode direction converts input.",
    examples: [
      { in: "1Pr", out: "Hi" },
    ],
    tips: [
      "Unusual printable characters in roughly uniform distribution, not matching Base64 alphabet → try base69.",
    ],
    aka: ["base 69", "b69"],
  },

  z85: {
    what: "ZeroMQ's binary-to-text encoding: 5 bytes → 5 printable characters using an 85-character alphabet. Denser than Base64.",
    principle:
      "Every 4 bytes are treated as a 32-bit big-endian integer, then written in 5 base-85 digits.\n\n" +
      "The 85-char alphabet is `0-9a-zA-Z.-:+=^!/*?&<>()[]{}@%$#`. Input must be a multiple of 4 bytes.",
    usage: "Paste z85 text to decode; encode direction requires input length divisible by 4.",
    examples: [
      { in: "HelloWorld", out: "Hm#K{GkRl!" },
    ],
    tips: [
      "Fixed 4-byte input → 5-char output ratio. Input length not divisible by 4 means it's probably not z85.",
      "Used in ZeroMQ binary frames embedded in text protocols.",
    ],
    aka: ["z85", "ZeroMQ base85", "ZMQ encoding", "base85 zmq"],
  },

  base85ipv6: {
    what: "A compact 20-character textual representation of IPv6 addresses defined in RFC 1924, using base85.",
    principle:
      "An IPv6 address is 128 bits = 16 bytes. Treat as a 128-bit integer, encode in base85 with the RFC 1924 alphabet.\n\n" +
      "Result is exactly 20 printable characters — shorter than the standard colon-hex notation.",
    usage: "Paste a 20-char base85 IPv6 string to expand to standard colon notation, or paste an IPv6 address to compress.",
    examples: [
      { in: "4)+k&C#VzJ4br>0wv%Yp", out: "2001:db8::1", desc: "20-char base85 → IPv6" },
    ],
    tips: [
      "Exactly 20 printable characters from the RFC 1924 alphabet → likely base85 IPv6.",
      "RFC 1924 was actually an April Fools' joke, but the encoding is technically valid.",
    ],
    aka: ["base85 IPv6", "RFC 1924", "ipv6 base85", "compact ipv6"],
  },

  base2048: {
    what: "Encodes binary data using 2048 carefully selected Unicode characters — mostly emoji and symbols — optimized for Twitter/SMS character limits.",
    principle:
      "Every 11 bits map to one Unicode code point from a fixed 2048-character table.\n\n" +
      "Each encoded character is visually distinct and survives most Unicode-normalizing platforms. Denser than Base64 in characters-per-tweet.",
    usage: "Paste base2048 text (likely emoji/symbols) to decode; encode direction converts binary to the Unicode representation.",
    examples: [
      { in: "ŤƐ", out: "Hi", desc: "2 Unicode chars encode 2 bytes" },
    ],
    tips: [
      "A string of unusual Unicode characters/emoji that looks random but is the same length every few characters → try base2048.",
      "Designed so each character takes exactly the same visual space in environments that count characters, not bytes.",
    ],
    aka: ["base 2048", "b2048", "base2048", "unicode base encoding"],
  },
};
