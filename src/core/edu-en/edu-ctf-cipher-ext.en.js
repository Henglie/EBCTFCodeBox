export default {
  twinHex: {
    what: "Twin-Hex encodes pairs of ASCII characters as three-character base36 indices in a 96 by 96 table. It is an encoding, not encryption.",
    principle: "For character codes x and y in 32..127, the index is (x - 32) * 96 + (y - 32). Write it in base36 and right-pad the token to three characters with spaces. Odd-length plaintext is padded with one space. Decoding preserves each complete character pair: the format has no original-length field to distinguish padding from a real trailing space.",
    usage: "Encode ASCII 32..127 (127 is DEL), or decode fixed-width base36 groups. Preserve ciphertext spaces. Decoding odd-length plaintext includes the padding space; real trailing spaces are never stripped.",
    examples: [
      { in: "dCode", out: "52b5wk540", desc: "Decodes to dCode followed by one space." },
      { in: "Twin Hex", out: "3x35gu14 56g", desc: "Even-length plaintext is preserved." },
    ],
    tips: ["a and a followed by one space have the same encoding.", "Reference: https://www.dcode.fr/twin-hex-cipher", "Twin-Hex uses base36, not hexadecimal."],
    aka: ["twin hex", "twinhex", "twin-hex", "Twin Hex cipher", "character pair encoding", "96x96 table", "base36 pairs", "Twin Hex decoder", "Twin Hex encoder", "paired ASCII encoding", "双字符编码", "双字符查表"],
  },
};
