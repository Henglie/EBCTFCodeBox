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

  hxw: {
    what: "Martian text (huoxingwen): an internet-popular deformed way of writing Chinese characters, using three CJK code tables to purely table-map simplified/traditional characters into look-alike but obscure homophone/homograph characters.",
    principle:
      "Maintains fixed mapping tables of simplified↔Martian and traditional↔Martian; encoding is character-by-character table substitution, decoding is reverse lookup. Purely table-based, no algorithm; characters not in the library are kept as-is.",
    usage: "Encode converts simplified/traditional to Martian text; decode converts Martian text back to simplified.",
    examples: [
      { in: "你好", out: "祢好 (Martian look-alike substitution)", desc: "character-by-character table lookup" },
    ],
    tips: ["A screen full of vaguely familiar odd Chinese characters with similar pronunciations → Martian text, just drop it in to decode and restore."],
    aka: ["火星文", "hxw", "非主流文字", "形近字替换"],
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

  confusablesScan: {
    what: "Homoglyph detection: catches those 'look like Latin letters but are actually Cyrillic/Greek letters' impostors in text. A common trick for phishing domains and impersonation strings.",
    principle:
      "Cyrillic а (U+0430), Greek ο (U+03BF), and Latin a, o look nearly identical on screen but have completely different code points. The tool walks the text and flags suspicious characters mixing scripts (writing systems) — a Cyrillic letter mixed into a normal English word is a red flag.",
    usage: "Paste suspicious text/domain, and the tool lists mixed homoglyphs and their true scripts.",
    examples: [
      { in: "раypal (contains Cyrillic р/а)", out: "detected 2 Cyrillic characters disguised as Latin" },
    ],
    tips: ["The core check for phishing/impersonation-domain challenges. Looks like English but mixes other-language letters = homoglyph attack."],
    aka: ["同形字检测", "homoglyph", "confusables scan", "混淆字符", "同形异义字", "homoglyph attack", "homograph", "西里尔伪装", "钓鱼域名检测", "混淆字检测", "idn homograph", "相似字符检测", "unicode混淆检测"],
  },

  unicodeNormalize: {
    what: "Unicode normalization: the same character may have several encoding forms; normalization unifies them into a standard form. Converts between the four forms NFC/NFD/NFKC/NFKD.",
    principle:
      "For example é can be a single code point U+00E9, or e + combining accent U+0301. NFC/NFD are 'compose/decompose' canonical normalization (meaning-preserving); NFKC/NFKD are 'compatibility' normalization (they expand things like ① ﬁ ² into 1 fi 2, changing appearance). The tool does all four conversions + change-point analysis.",
    usage: "Paste text, choose the target form (NFC/NFD/NFKC/NFKD), output the normalized result and the changed positions.",
    examples: [
      { in: "ﬁ (ligature U+FB01)", param: "NFKC", out: "fi (split into two letters)" },
    ],
    tips: ["Bypassing filters/hiding flags often relies on compatibility characters: one NFKC normalization reveals the original form. Full-width, ligatures, super/subscripts all get flattened by NFKC."],
    aka: ["unicode规范化", "normalization", "nfc", "nfkc", "nfd", "nfkd", "unicode normalization", "规范化形式", "normalization form", "兼容规范化", "组合分解", "全角半角规范化", "unicode标准化"],
  },

  whitespaceScan: {
    what: "Whitespace steganography detection: text has not only ordinary spaces but also a bunch of look-alike special whitespace (NBSP, Em Space, Thin Space...). The tool scans them out and also tries to decode hidden data encoded in line-trailing whitespace.",
    principle:
      "Unicode has dozens of whitespace characters, all visually 'empty' but with different code points (U+00A0 NBSP, U+2003 Em Space, U+2009 Thin Space...). The tool walks the text and flags all non-ordinary spaces, and attempts Snow-style techniques: decoding line-trailing spaces/tabs as binary bits.",
    usage: "Paste suspicious text, output the hit positions of each kind of whitespace + a line-trailing whitespace LSB decode attempt.",
    examples: [
      { in: "text with spaces/Tabs hidden at line ends", out: "special whitespace list + attempted decoded hidden bits" },
    ],
    tips: ["Invisible space/Tab combinations at line ends are the signature of Snow steganography. Mixing ordinary spaces with NBSP is also worth suspicion."],
    aka: ["空格隐写", "whitespace scan", "snow隐写", "空白字符检测", "whitespace steganography", "空白隐写", "snow steganography", "行尾空格隐写", "nbsp检测", "特殊空白检测", "制表符隐写", "tab space隐写"],
  },

  bidiScan: {
    what: "Bidirectional control character detection: catches control characters like U+202E (RLO) that can make text display 'right to left'. The Trojan Source attack relies on it to make source code look like one thing but compile as another.",
    principle:
      "Bidi control characters (RLO/LRO/RLE/PDF, etc.) are normally used for mixing Arabic/Hebrew, and can forcibly change character display order. Maliciously exploited, they desynchronize the visible order of code/filenames from the actual byte order, so what a human sees differs from what the machine executes. The tool detects these control characters, rates the risk, and can strip them with one click.",
    usage: "Paste suspicious text/source code, output Bidi control character hits + a risk rating + the stripped text.",
    examples: [
      { in: "string containing U+202E", out: "detected RLO, high risk, stripping recommended" },
    ],
    tips: ["A filename like `exe.txt` that is actually `txt.exe` flipped by RLO → a classic disguise. In source-audit challenges, check for Bidi control characters."],
    aka: ["bidi检测", "trojan source", "rlo", "u+202e", "双向控制符", "bidi override", "从右向左覆盖", "rtl override", "双向文本攻击", "bidi control characters", "lro rle pdf", "特洛伊源码", "unicode bidi"],
  },

  charInspect: {
    what: "Character attribute inspection: unfolds each character to see its code point, UTF-8/UTF-16 bytes, which script it belongs to, its Unicode category, and its block. Verifies the identity of odd characters you can't make sense of.",
    principle:
      "For each character, looks up the Unicode database: code point (U+XXXX), UTF-8/UTF-16 encoding bytes, Script (Latin/Cyrillic/Han...), General Category (letter/punctuation/control...), Block name. One character per line, laid out clearly.",
    usage: "Paste text, output a full attribute table for each character.",
    examples: [
      { in: "A你", out: "A: U+0041 Latin letter; 你: U+4F60 CJK Unified Ideograph" },
    ],
    tips: ["When you suspect hidden/disguised characters but don't know what they are, inspecting code points one by one is the most reliable. Zero-width, homoglyphs, and control characters are all laid bare."],
    aka: ["字符透视", "char inspect", "码位查看", "字符属性", "character inspector", "码点分析", "codepoint viewer", "unicode属性查看", "字符详情", "字符解剖", "codepoint inspect", "字符码位分析"],
  },

  invisibleViz: {
    what: "Invisible character visualization: uniformly replaces all zero-width, control, BOM, and various whitespace characters in text with visible placeholders, so you can see at a glance what's hidden and where.",
    principle:
      "Maintains a 'invisible/confusable character → visible marker' mapping, walks the text replacing hits with prominent placeholders, counts each type, lists the hits, and provides one-click stripping to get clean text.",
    usage: "Paste suspicious text, output the visualized text + hit list + type statistics + stripped result.",
    examples: [
      { in: "text with zero-width and BOM", out: "[ZWSP][BOM] etc. placeholders mark the positions" },
    ],
    tips: ["The universal first step for zero-width/tag-smuggling/whitespace-steganography challenges: visualize first to see whether there's anything and roughly what kind, then pick the corresponding decode tool."],
    aka: ["不可见字符可视化", "invisible viz", "隐藏字符可视化", "字符透视", "invisible character visualization", "零宽字符可视化", "show invisible", "不可见字符显示", "隐藏字符检测", "reveal hidden characters", "控制符可视化", "空白可视化"],
  },

  confusablesSkeleton: {
    what: "Homoglyph skeleton normalization: uniformly replaces Cyrillic/Greek/full-width homoglyphs with their ASCII 'visual skeleton', for comparing impersonation strings and phishing domains.",
    principle:
      "Unicode maintains a confusables table specifying each confusable character's 'skeleton' (the visually equivalent standard form). The tool replaces the Cyrillic characters in раypal back to the Latin skeleton paypal per the table, so after normalization the disguised string and the real string can be directly compared for equality.",
    usage: "Paste text, output the skeleton-normalized ASCII string (one-way).",
    examples: [
      { in: "раypal (contains Cyrillic)", out: "paypal", desc: "all homoglyphs normalized to Latin skeleton" },
    ],
    tips: ["Pairs with confusablesScan: Scan tells you where the trickery is, Skeleton bashes it back to original form for comparison against a whitelist."],
    aka: ["同形字骨架", "confusables skeleton", "骨架归一化", "钓鱼域名比对", "unicode skeleton", "confusable skeleton", "视觉骨架", "同形字归一", "skeleton algorithm", "混淆字骨架", "相似字归一化", "homoglyph skeleton"],
  },
};
