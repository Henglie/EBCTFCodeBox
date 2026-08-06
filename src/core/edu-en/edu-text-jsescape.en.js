/*
 * edu-text-jsescape.en.js — JS escape Encoding English edu card (text).
 *
 * Translation of src/core/edu/edu-text-jsescape.js.
 * Op covered: jsEscape
 * Pure data, no side effects. Export contract matches eduContent.js header.
 */
export default {
  jsEscape: {
    what: "The legacy JavaScript escape()/unescape() global function encoding — pre-RFC 2396 URL encoding. Alphanumerics and @ * _ + - . / pass through; other ASCII becomes %XX; non-ASCII (Chinese, emoji) becomes %uXXXX (UTF-16 code units). CTF challenges occasionally use this old-style escape encoding, which is completely different from encodeURI/encodeURIComponent (UTF-8 bytes).",
    principle:
      "Encoding rules (escape() behavior):\n\n" +
      "① Safe characters: ASCII letters, digits, and @ * _ + - . / output as-is;\n" +
      "② Other ASCII (control chars, space, punctuation) → %XX (two uppercase hex digits);\n" +
      "③ Non-ASCII (>= U+0080) → %uXXXX (four uppercase hex digits, UTF-16 code unit; surrogate pairs like emoji split into two %u sequences).\n\n" +
      "Decoding (unescape()) reverses this: %XX → one byte, %uXXXX → one UTF-16 unit.\n\n" +
      "Key difference from encodeURIComponent: that encodes Chinese as multi-byte UTF-8 (%E4%B8%AD); escape encodes as a single UTF-16 %u4E2D segment. The %u prefix is the tell.",
    usage: "Enter text (or %XX/%uXXXX ciphertext) and run. encode produces escape ciphertext, decode restores plaintext. Bidirectional.",
    examples: [
      { in: "Hello World!", param: "", out: "Hello%20World%21", desc: "ASCII: space/punctuation → %XX" },
      { in: "中文", param: "", out: "%u4E2D%u6587", desc: "Non-ASCII: UTF-16 code unit → %uXXXX" },
      { in: "%u4E2D%u6587", param: "", out: "中文", desc: "decode restores" },
    ],
    tips: [
      "Seeing %uXXXX (lowercase u + 4 hex) → legacy escape encoding, not the multi-byte %XX UTF-8 form.",
      "Distinguish from encodeURIComponent: Chinese 中 → escape gives %u4E2D, encodeURIComponent gives %E4%B8%AD. The %u prefix decides.",
      "escape is deprecated but supported by every browser; CTF %u-form ciphertext decodes directly with this op.",
      "Supplementary-plane chars (emoji): escape splits into two %u sequences (surrogate pair); decode reassembles them automatically.",
    ],
    aka: ["escape", "unescape", "JS escape", "javascript escape", "%u encoding", "legacy URL encoding", "escape code", "unescape decode", "%uXXXX", "url escape", "js escape code", "escape function", "old urlencode", "jsEscape"],
  },
};
