/*
 * edu-fancy-roar.en.js — Roar Translator (4-char codec) English edu card (fancy).
 *
 * Translation of src/core/edu/edu-fancy-roar.js.
 * Op covered: roar
 * Pure data, no side effects. Export contract matches eduContent.js header.
 */
export default {
  roar: {
    what: "Roar translator — turns plain text into readable 'cipher' made of 4 beast-sound characters like 嗷呜啊~. This is a DIFFERENT algorithm from the 2-token bit-stream version (local yygq op). It uses the core encoding of roar.iiilab.com: each character's Unicode code point becomes 4 hex digits, each hex digit is position-offset then mapped to 2 of the 4 codec characters, wrapped with a prefix and suffix.",
    principle:
      "Encoding (codec = 4 distinct characters, default 嗷呜啊~):\n\n" +
      "① For each character in the plaintext, take its Unicode code point as a 4-digit hex string (e.g. 'A' → 0041), concatenated into a hex string;\n" +
      "② For hex position s (0-based): take the hex value n0, add s%16 (position offset), wrap if > 15;\n" +
      "③ Split n into quotient n//4 and remainder n%4, used as codec indices — each hex digit becomes 2 codec characters;\n" +
      "④ Prefix t = codec[3]+codec[1]+codec[0], suffix = codec[2]; ciphertext = prefix + middle + suffix.\n\n" +
      "Decoding reverses this: locate prefix and suffix, take the middle; map each codec pair back to n = 4*idx1+idx2, subtract the position offset; regroup 4 hex digits per code point.\n\n" +
      "The position offset (s%16) is key: the same hex digit maps to different codec pairs at different positions, so ciphertext is not aligned to character boundaries — that is its anti-misreading design.",
    usage: "Enter text (or ciphertext) in the input box. The codec parameter defaults to 嗷呜啊~ but can be any 4 distinct characters (e.g. 喵汪哞咩). Run to get ciphertext/plaintext. Bidirectional: encode generates, decode restores.",
    examples: [
      { in: "A", param: "codec=嗷呜啊~", out: "~呜嗷嗷嗷嗷呜呜啊呜嗷啊", desc: "Single char: A(0041) → 8 codec chars + prefix/suffix" },
      { in: "Hello", param: "codec=嗷呜啊~", out: "~呜嗷嗷嗷嗷呜呜啊啊~呜嗷呜呜~嗷~嗷啊嗷啊呜嗷嗷呜~~嗷~呜呜嗷啊~嗷嗷嗷呜啊嗷嗷啊啊", desc: "5-char English roundtrip" },
      { in: "flag", param: "codec=喵汪哞咩", out: "咩汪喵喵喵喵汪哞喵哞汪汪喵汪汪咩喵喵咩哞喵哞汪喵喵咩喵咩喵咩汪汪喵汪哞哞", desc: "Custom codec" },
    ],
    tips: [
      "Ciphertext made of 4 repeating characters (like 嗷呜啊~) → try this op first (default codec is exactly those 4).",
      "yygq (就这¿/不会吧？) and this op are both called 'beast language translator' but are different algorithms: yygq is 2-token bit-stream mapping, this op is 4-codec hex-offset mapping. Try both on the same ciphertext.",
      "The codec must be 4 distinct characters or it errors. If the challenge hints a codec, fill it in to decode.",
      "Decoding locates prefix codec[3]+codec[1]+codec[0] and suffix codec[2] — extra text prepended to the ciphertext does not break decoding (it takes the last occurrence of the suffix).",
      "Chinese supported: Unicode code points encode directly as 4 hex digits, no UTF-8 byte conversion.",
    ],
    aka: ["roar", "roar translator", "beast language", "嗷呜啊", "兽音译者", "iiilab roar", "roar.iiilab", "兽音", "4-char codec", "beast sound cipher", "roar encode", "roar decode", "兽语加密", "喵汪哞咩", "兽语编码"],
  },
};
