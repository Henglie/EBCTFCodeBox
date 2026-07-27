// English edu shard: base family — base65536/ecoji/base64steg/base64dict/multilineBase64/base64decompress
export default {
  base65536: {
    what: "Compact encoding by qntm: every 2 bytes map to 1 Unicode character (mostly CJK). Character count is half the byte count.",
    principle:
      "Two bytes $(b_1, b_2)$ are encoded as one code point: $b_2$ selects a 256-wide block, $b_1$ offsets within it.\n\n" +
      "For an odd number of bytes, the final byte uses a special 'length-1' block so the decoder knows to emit only 1 byte.",
    usage: "Paste base65536 text to decode; encode direction converts text to base65536.",
    examples: [
      { in: "鹈", out: "Hi", desc: "2 bytes → 1 CJK character" },
      { in: "襃ᕆ", out: "CTF", desc: "3 bytes → 2 chars (last uses odd-length block)" },
    ],
    tips: [
      "Screen full of obscure CJK/rare characters that make no semantic sense, character count ≈ half the byte count → try base65536.",
    ],
    aka: ["base 65536", "b65536", "qntm base65536", "Base65536", "unicode encoding", "double-byte-per-char"],
  },

  ecoji: {
    what: "Emoji-based encoding: a 1024-emoji alphabet, 5 bytes → 4 emoji. Trailing bytes are padded with fixed padding emoji.",
    principle:
      "Every 5 bytes (40 bits) split into 4 × 10-bit groups ($2^{10}=1024$), each looked up in the emoji table.\n\n" +
      "Fewer than 5 trailing bytes are padded with special padding emoji (e.g. ☕), and the last emoji encodes the actual remainder length.",
    usage: "Paste emoji string to decode; encode direction converts text to ecoji.",
    examples: [
      { in: "👖📸🎈☕", out: "abc", desc: "3 bytes → 3 data emoji + 1 padding ☕" },
    ],
    tips: [
      "Like base100, both use emoji — but ecoji groups 5 bytes into 4 emoji with padding; base100 is strict 1-byte-per-emoji.",
      "Trailing ☕ or similar fixed padding emoji is the ecoji giveaway.",
    ],
    aka: ["ecoji", "emoji base1024", "Ecoji", "emoji encoding", "emoji data encoding"],
  },

  base64steg: {
    what: "Base64 padding steganography: the ignored bits before a `=` padding character are repurposed to secretly carry data. Looks like normal Base64.",
    principle:
      "In padded Base64, the last encoded character has 2 or 4 bits that don't affect the decoded output. Overwriting those bits with secret data embeds information while the Base64 still decodes correctly.\n\n" +
      "Decoding: re-encode each line with standard Base64, compare the last non-padding character's offset to find the hidden bits; reconstruct the secret by collecting 2 bits per `=`.",
    usage: "Decode: paste multi-line Base64; the tool extracts hidden bits from each line's padding. Encode: embed short text as hidden bits inside padded Base64.",
    examples: [
      { in: "czB=\nc6==\nczI=\nc2==\nczS=\nc0==", out: "hi", desc: "Last char before = encodes hidden bits via offset" },
    ],
    tips: [
      "Many short Base64 lines all ending in `=`, content decodes to garbage filler → suspect padding steganography.",
      "Focus on how much the last-before-`=` character deviates from standard encoding, not the decoded content itself.",
    ],
    aka: ["base64 steg", "base64 steganography", "padding stego", "base64 padding steganography", "b64 steg"],
  },

  base64dict: {
    what: "Base64 with a custom alphabet (Caesar-dictionary variant): same encoding logic as standard Base64, but the 64 characters are replaced with a user-supplied set.",
    principle: "Encode normally with standard Base64, then substitute each character position-by-position using your custom table. Decode by reversing the substitution first, then standard Base64. `=` padding stays unchanged.",
    usage: "Fill in the 64-character custom table in the parameter field, paste ciphertext to decode; encode direction reverses. Table must be exactly 64 characters.",
    examples: [
      { in: "HTp=", param: "dict = shuffled 64-char table", out: "Hi", desc: "Same input decodes to SGk= with standard table" },
    ],
    tips: [
      "Looks like Base64 (multiple of 4 length, `=` padding) but decodes to garbage → probably custom-alphabet Base64. Find the correct table and plug it in.",
      "Essentially Base64 + monoalphabetic substitution — same idea as Caesar/substitution ciphers.",
    ],
    aka: ["custom alphabet base64", "custom dict base64", "base64 custom table", "non-standard base64", "Caesar base64"],
  },

  multilineBase64: {
    what: "Base64 split into fixed-width lines (as used in email MIME and PEM certificates). Decoded line-by-line then concatenated.",
    principle: "Encoding: standard Base64 wrapped at N characters per line (default 76, PEM convention). Decoding: each line is independently padded and decoded, all bytes concatenated, then interpreted as UTF-8 (avoids cutting multi-byte chars at line boundaries).",
    usage: "Decode: paste multi-line Base64 directly. Encode: set line width and convert text to wrapped Base64.",
    examples: [
      { in: "SGVsbG8gV29ybGQh\nIFRoaXMgaXMgYSBs\nb25nZXIgdGV4dCBm\nb3IgZGVtby4=", out: "Hello World! This is a longer text for demo." },
    ],
    tips: [
      "PEM certs (-----BEGIN...-----) and MIME-encoded email attachments use this. Strip headers/footers and paste.",
      "Wrapping is cosmetic — you can join all lines into one string and use standard Base64 decode.",
    ],
    aka: ["multiline base64", "wrapped base64", "PEM base64", "MIME base64", "folded base64"],
  },

  base64decompress: {
    what: "Base64 wrapping zlib-compressed data: decode Base64 to get compressed bytes, then decompress to get the original content.",
    principle: "Decode: Base64 → zlib (deflate) compressed bytes → decompress via browser `DecompressionStream`. Encode: compress first, then Base64. Zlib stream starts with a 2-byte header and ends with an Adler-32 checksum.",
    usage: "Paste the Base64-encoded compressed data to get the original; encode direction compresses then encodes.",
    examples: [
      { in: "(Base64-encoded zlib stream)", out: "decompressed content", desc: "Two steps: Base64 decode + decompress" },
    ],
    tips: [
      "Standard Base64 decodes to garbage but the first bytes look like `78 9c` (common zlib header) → decompress the result.",
      "Web apps often compress JSON before Base64-encoding for URL/cookie storage — this is that pattern.",
    ],
    aka: ["base64 zlib", "base64 deflate", "base64 decompress", "base64 + zlib", "compressed base64", "base64 inflate"],
  },
};
