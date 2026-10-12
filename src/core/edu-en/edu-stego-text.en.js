// English edu shard: stego text family (zero-width / variation selectors / Martian text / homoglyphs / normalization / inspection). Pure data, no imports, no side effects.
export default {
  zeroChar: {
    what: "Zero-width Morse code: first convert plaintext to Morse code, then use three 'invisible' zero-width characters to represent dot, dash, and separator respectively, hidden inside normal text.",
    principle:
      "Plaintext → Morse (`.`/`-`) → zero-width stand-ins: U+200B (separator), U+200C (`.`), U+200D (`-`). Completely invisible on screen, yet carried along when copy-pasted. Non-Morse characters like CJK degrade to `\\uXXXX` form before encoding.",
    usage: "Encode hides plaintext into a zero-width string; decode restores text mixed with zero-width characters back to plaintext.",
    examples: [
      { in: "SOS", out: "a string of invisible zero-width characters", desc: "S=... O=--- S=... expressed with zero-width dots/dashes" },
    ],
    tips: ["When the visible character count doesn't match the actual length, or the cursor lingers extra times in 'blank space' → suspect zero-width. Use invisibleViz to visualize it first."],
    aka: ["零宽摩斯", "zero width morse", "零宽字符隐写", "zerochar", "零宽度字符", "zero width characters", "zwsp隐写", "unicode零宽", "看不见的字符隐写", "invisible morse"],
  },

  zwTags: {
    what: "Unicode Tag smuggling: uses the entire U+E0000 'tags' plane to hide ASCII/UTF-8 bytes. In recent years, LLM prompt injection often uses it to sneak in instructions.",
    principle:
      "Unicode has a Tags block (U+E0000–U+E007F), historically for language tagging, now deprecated and not rendered on screen. Mapping each ASCII byte with a U+E0000 offset into a tag character lets you paste an entire hidden text after visible text, invisible to the eye and most editors.",
    usage: "Encode converts plaintext into a hidden stream of tag characters; decode restores tag characters back to ASCII/UTF-8.",
    examples: [
      { in: "hi", out: "U+E0068 U+E0069 (invisible)", desc: "'h'=0x68 → E0000+0x68" },
    ],
    tips: ["Be wary of text pasted from AI chats: beyond the visible content, tag-smuggled hidden instructions may lurk. Use charInspect to inspect code points character by character."],
    aka: ["tag走私", "unicode tags", "tag smuggling", "e0000隐写", "prompt注入载体", "unicode标签隐写", "tags block", "标签平面", "u+e0000", "ascii smuggling", "隐藏指令注入", "unicode tag characters"],
  },

  zwVarSel: {
    what: "Variation selector steganography: Paul Butler's 2024 trick — using Unicode variation selectors (characters meant to pick emoji styles) to attach an entire string of hidden bytes after any single character.",
    principle:
      "Variation selectors U+FE00–FE0F (16) and U+E0100–E01EF (240) total 256, exactly matching a byte's 256 values. Mapping each hidden data byte to a variation selector, all appended after a carrier character (like an emoji), renders invisibly yet gets copied along with the character.",
    usage: "Encode appends plaintext as a variation selector sequence onto a carrier; decode restores those selectors back to a byte stream.",
    examples: [
      { in: "carrier😀 + hidden 'A'", out: "😀︊… (selectors invisible)", desc: "each byte → one variation selector" },
    ],
    tips: ["An emoji 'trailing' a long string of invisible stuff → variation selector steganography. Attaching arbitrary-length data to a single character is its hallmark."],
    aka: ["变体选择器", "variation selector", "paul butler", "zwvarsel", "emoji变体隐写", "variation selector隐写", "vs隐写", "fe00隐写", "e0100隐写", "变体选择符", "emoji走私", "unicode变体选择器"],
  },

  emojiSubst: {
    what: "Emoji substitution steganography: the substitution layer of emoji-aes, replacing the 64 base64 characters one-for-one with emoji (plus a few extra), paired with a rotation offset. Note this does substitution only, no AES.",
    principle:
      "First treat the data as base64, then use a 65-emoji code table to replace each character of the base64 alphabet, with the rotation parameter rotating the whole table by a set amount for simple obfuscation. Decoding is reverse-looking-up the table + reverse rotation → base64 → original data.",
    usage: "Encode converts text into an emoji string; decode restores the emoji string (must match the rotation).",
    examples: [
      { in: "Hi", out: "😀🎉🚀…", desc: "base64 characters replaced one by one with emoji" },
    ],
    tips: ["Seeing 'a regular string of emoji, count like base64' → try this. If AES was actually applied (full emoji-aes version), you also need the key; here only the substitution layer is decoded."],
    aka: ["emoji隐写", "emoji-aes", "emoji替换", "emojisubst", "表情符号隐写", "emoji encode", "emoji密码", "emoji cipher", "表情替换", "emoji base64", "颜文字隐写"],
  },

  tadpole: {
    what: "Tadpole text: wraps plaintext in a string of Arabic decorative marks (which look like little tadpoles), with a checksum, supporting two formats.",
    principle:
      "Uses the U+06D6–U+06EC Arabic decorative marks as carriers; plaintext is encoded first then wrapped in these symbols, with a checksum attached to prevent copy errors. There's also a base64 dual-format variant. Decoding strips the decorations, verifies the checksum, and restores the plaintext.",
    usage: "Encode converts plaintext into tadpole text; decode restores tadpole text (verifies the checksum).",
    examples: [
      { in: "flag", out: "ۖۗۘ… (string of tadpole-like marks)" },
    ],
    tips: ["A screen full of small Arabic marks, dense like tadpoles → tadpole text. A checksum mismatch means the string was altered."],
    aka: ["蝌蚪文", "tadpole", "阿拉伯装饰符隐写", "arabic diacritics隐写", "阿拉伯变音符号", "arabic marks", "小蝌蚪文字", "阿拉伯符号密码", "tadpole cipher", "arabic tadpole", "阿拉伯文隐写"],
  },

  textBlindWatermark: {
    what: "Text blind watermark: guofei9987's text_blind_watermark (v1 JS format) — hides a watermark string inside cover text using zero-width character U+200C, completely invisible to the eye and preserved through copy-paste. Common in leak-tracing and CTF zero-width challenges.",
    principle:
      "Each watermark character becomes a binary string (variable length, zero-padded NOT; separated by spaces between characters, with one trailing space), then mapped bit by bit: `1` = one U+200C, space = two U+200C (separator), `0` = nothing added; each bit consumes one cover character (zero-width run inserted after it). Decoding scans with a state machine: single ZWNJ=1, double ZWNJ=separator, normal character=0, then splits on spaces to restore. No key, no encryption — pure steganography.",
    usage: "encode: watermark + cover text → stego text (cover length must be ≥ watermark bit count); decode: stego text → watermark.",
    examples: [
      { in: "watermark 'flag' + any cover text", out: "cover text with unchanged appearance (carrying U+200C)", desc: "flag → 1100110 1101100 1100001 1100111, 32 bits with separators" },
    ],
    tips: ["Incompatible with 'Zero-Width Steganography' (Misawa radix-4 fixed-length) — neither decodes the other's output. The original decoder emits an invisible U+0000 tail for cover residue; this implementation fixes that. Non-BMP characters are split per UTF-16 code unit and reassemble completely on decode."],
    aka: ["文本盲水印", "text blind watermark", "textBlindWatermark", "文本隐水印", "盲水印", "guofei9987", "零宽盲水印", "text watermark", "文字隐水印", "隐形水印", "文本隐形水印", "zwnj隐写", "郭飞盲水印"],
  },
};
