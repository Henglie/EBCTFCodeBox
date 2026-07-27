// English edu shard: gap-fill batch (T284).
// Covers 9 ops:
// analysis: usbKeyboard, usbMouse, sevenZipExtract
// classic: goldbug
// stego: acrostic, everyN, caseBitStego, nthChar, wordSpacingBits
export default {
 // ============ analysis: USB HID traffic ============
  usbKeyboard: {
    what: "USB keyboard capture recovery — translate captured USB keyboard HID reports back into the keys the user pressed.",
    principle: "Every keypress sends an 8-byte HID report: byte 1 is the modifier keys (Ctrl/Shift/Alt etc. as a bitmask), byte 2 is reserved, and bytes 3-8 hold 1-6 keycodes pressed simultaneously. Keycodes 0x04-0x1D map to a-z, 0x1E-0x27 map to 1-0, and higher values are control keys and symbols. Look up the Keyboard usage page table in the USB HID 1.21 spec to recover the input.",
    usage: "Paste the USB keyboard leftover capture data from wireshark (8 hex bytes per line) and run it to see what the user typed. When Shift is held, uppercase or symbols appear automatically.",
    examples: [
      { in: "00 00 04 00 00 00 00 00", out: "a", desc: "Single 'a' key press" },
      { in: "02 00 04 00 00 00 00 00", out: "A", desc: "Shift+a = A (byte0=0x02 is Left Shift)" },
      { in: "00 00 0b 00 00 00 00 00\n00 00 11 00 00 00 00 00", out: "hn", desc: "Press h(0x0b) then n(0x11)" },
    ],
    tips: ["Common CTF setup: a pcapng file containing USB keyboard traffic — extract it to recover the flag", "byte0 bit0=LeftCtrl, bit1=LeftShift, bit2=LeftAlt, bit3=LeftGUI", "Multiple keycodes in one report mean simultaneous presses (chords)"],
    aka: ["USB keyboard capture", "USB HID keyboard", "键盘流量", "USB键盘流量", "键盘HID还原", "USB键盘抓包", "leftover capture data", "HID报文解析", "键盘按键还原", "usb keyboard pcap", "键盘流量分析", "USB HID键盘解析"],
  },

  usbMouse: {
    what: "USB mouse capture recovery — translate USB mouse HID reports into movement paths and clicks.",
    principle: "The USB mouse boot protocol sends a 4-byte report each time: byte 1 is button state (bit0=left, bit1=right, bit2=middle), byte 2 is X displacement (signed -128 to 127), byte 3 is Y displacement, and byte 4 is the scroll wheel. Accumulating X/Y displacement frame by frame draws out the mouse path.",
    usage: "Paste the USB mouse leftover capture data from wireshark (4 hex bytes per line) and run it to output per-frame button state and displacement. Combined with a plotting tool, this reconstructs the mouse trail (a common CTF drawing challenge).",
    examples: [
      { in: "01 00 00 00", out: "Left button down, X+0, Y+0", desc: "Left click" },
      { in: "00 0a 00 00", out: "No button, X+10, Y+0", desc: "Move 10 pixels right" },
    ],
    tips: ["CTF setup: USB mouse traffic inside a pcapng, recover the drawn text or shape", "X/Y are relative displacements, not absolute coordinates — accumulate them", "byte0 bit0=left, bit1=right, bit2=middle"],
    aka: ["USB mouse capture", "USB HID mouse", "鼠标流量", "USB鼠标流量", "鼠标HID还原", "USB鼠标抓包", "鼠标轨迹还原", "mouse pcap", "鼠标流量分析", "USB HID鼠标解析", "鼠标位移还原", "鼠标画图题"],
  },

  sevenZipExtract: {
    what: "7z archive extraction — extract .7z files entirely in the browser using WebAssembly.",
    principle: "7z is the LZMA/LZMA2 compression format — high compression ratio but complex algorithm. This project uses 7z-wasm (emscripten-compiled 7zz.js + 7zz.wasm) to run native 7-Zip extraction logic in the browser with zero server dependency. AES-256-encrypted 7z archives require a password.",
    usage: "Drop or paste a .7z file (put the password in the param box if encrypted) and click extract to pull the contents out in the browser, with nothing leaving your machine.",
    examples: [
      { in: "(binary .7z file)", out: "(extracted file list + contents)", desc: "Drop a 7z file to auto-extract" },
    ],
    tips: ["CTF sailboat-style challenges often disguise files as .7z or with a changed extension", "7z-wasm runs in the browser — no 7-Zip installation needed", "For encrypted 7z, fill in the password to decrypt; even an empty password must be entered"],
    aka: ["7-Zip", "LZMA", "7z extract", "7z解压", "7z归档", "7zip解压", "LZMA2", "7z-wasm", "7z文件解析", "seven zip", "7z decompress", "7z压缩包"],
  },

 // ============ classic: Goldbug ============
  goldbug: {
    what: "The Gold-Bug cipher — Captain Kidd's cipher from Edgar Allan Poe's story 'The Gold-Bug', substituting letters with digits and special symbols.",
    principle: "Each letter maps to a single symbol: 5→A, 8→E, ‡→O, †→D, ¶→B, 3→G, 4→H, 6→I, *→N, (→R, )→T, ;→S, ?→U, 0→M, 9→F, 1→L, :→W, 2→P, .→V, —→Y, and the remaining 6 letters use §!&@[]. Single-character substitution is unambiguous — a direct table lookup is reversible. The story's original was many-to-one (disambiguated via frequency analysis); this tool uses one-to-one to guarantee strict reversibility.",
    usage: "Enter letter text and click encode to get the symbol string; enter a symbol string and click decode to recover the letters. Non-letter/non-symbol characters pass through unchanged.",
    examples: [
      { in: "HELLO", out: "4811‡", desc: "H=4, E=8, L=1, L=1, O=‡" },
      { in: "5‡8", out: "AOE", desc: "5=A, ‡=O, 8=E" },
    ],
    formulas: [{ tex: "A \\to 5,\\ E \\to 8,\\ O \\to \\ddagger,\\ D \\to \\dagger,\\ B \\to \\P", caption: "Partial mapping (from Kidd's cipher in 'The Gold-Bug')" }],
    tips: ["The original story's cipher is many-to-one and not strictly round-trippable; this tool uses a reversible one-to-one scheme", "The signature symbols †‡¶ are a strong signal — recognize the cipher by them alone", "In CTF, a mixed string of digits + special symbols should make you think of the Gold-Bug"],
    aka: ["GoldBug", "Kidd cipher", "金甲虫", "Poe cipher", "金甲虫密码", "the gold bug", "爱伦坡密码", "Kidd船长密码", "symbol substitution", "符号替换密码", "gold-bug cipher", "基德密码"],
  },

 // ============ stego: text steganography (5 ops added in T278) ============
  acrostic: {
    what: "Acrostic steganography — hide a secret message in the first letter of each line (or sentence/word).",
    principle: "When encoding, each character of the message is placed at a chosen position (head/tail/mid) of each cover unit (line/sentence/word). When decoding, take the character at that position from every unit and join them to get the hidden message. The acrostic is a classical Chinese literary tradition, and CTF often features the 'read the first character of each line' style.",
    usage: "Fill the cover text with visible camouflage text, choose a mode (line/sentence/word), choose a position (head/tail/mid), and after encoding the hidden message sits at the chosen position. Choose the same mode and position when decoding to extract it.",
    examples: [
      { in: "春明千万", param: "cover=春风又绿江南岸\\n明月何时照我还\\n千山鸟飞绝\\n万径人踪灭, mode=line, pos=head", out: "春明千万", desc: "Acrostic: read the first character of each line" },
      { in: "XYZ", param: "cover=一二三\\n四五六\\n七八九, mode=line, pos=mid", out: "XYZ", desc: "Hide in the middle: replace the middle character of each line" },
    ],
    tips: ["Acrostics can't be auto-detected (detect=0) — they need manual recognition", "When the cover is too short, placeholder lines are added automatically to keep it reversible", "Word mode suits English cover text"],
    aka: ["Acrostic", "藏头诗", "藏尾诗", "藏中诗", "acrostic cipher", "藏头隐写", "首字母隐写", "藏头文", "藏尾隐写", "首字连读", "acrostic stego", "藏头藏尾"],
  },

  everyN: {
    what: "Every-N steganography — hide one secret character in every N characters; the Nth one is the hidden character.",
    principle: "When encoding, one message character is inserted after every N-1 cover characters, forming the arrangement 'cover1, cover2, ..., message1, coverN, ...'. When decoding, take every Nth character (indices N-1, 2N-1, ...) and join them to get the hidden message. The cover character count must be >= (N-1) × message length, or it errors.",
    usage: "Fill the cover text with camouflage text, set N as the spacing (default 3), and after encoding the hidden characters are spread evenly through the cover. Fill in the same N when decoding to extract them.",
    examples: [
      { in: "嗨", param: "cover=01, n=3", out: "01嗨", desc: "2 cover + 1 message = a group of 3 chars" },
      { in: "AB", param: "cover=0123, n=3", out: "01A23B", desc: "2 groups: 01|A, 23|B" },
    ],
    tips: ["N>=2; N=1 is auto-adjusted to 2", "If the cover is too short (<(N-1)*message length) it errors", "Larger N spreads the hidden data more but needs a longer cover"],
    aka: ["Every-N", "等距取字", "间隔隐写", "every n stego", "每N字隐写", "间隔取字", "定距隐写", "等间距隐写", "每隔N个字符", "均匀分布隐写", "间距取字隐写", "等距隐写"],
  },

  caseBitStego: {
    what: "Case-bit steganography — use the case of letters to carry binary bits, hiding a secret message inside seemingly ordinary mixed-case text.",
    principle: "The message is converted to UTF-8 bytes then to a bit string; the first 32 bits store the message length (for self-contained decoding) and the rest are the message bits. Walking through the English letters in the cover, uppercase=1 and lowercase=0, replacing case bit by bit. Non-letter characters (digits, spaces, punctuation) pass through unchanged and don't affect it. When decoding, read the case of the cover letters → bits → first 32 bits for length → next N*8 bits for the message.",
    usage: "Fill the cover text with text containing English letters (the longer, the more it can hide); after encoding the cover looks the same except for case changes. Decoding needs no parameters — the 32-bit length prefix recovers it self-contained.",
    examples: [
      { in: "Hi", param: "cover=aaaa...(48 a's)", out: "aAaA...(case varies)", desc: "Hi→2 bytes→16 bits + 32 length = 48 bits → needs 48 letters" },
    ],
    tips: ["The 32-bit length prefix makes decoding self-contained — no external length needed", "It errors when the cover has too few letters (needs 32+len*8 letters)", "Non-letter characters pass through unchanged, so it blends into code/articles"],
    aka: ["Case-bit stego", "大小写隐写", "LSB case", "大小写位隐写", "case bit steganography", "字母大小写隐写", "大小写比特", "letter case stego", "大小写编码隐写", "case sensitive stego", "字母大小写位", "大小写承载比特"],
  },

  nthChar: {
    what: "Nth-character steganography — the generalized version of the acrostic, hiding a secret message in the Nth character of each line (or sentence/word).",
    principle: "Split the cover into units by delimiter (line/sentence/word), then replace the Nth character of each unit with a message character. When there aren't enough cover units, placeholder characters are added to keep it reversible. When decoding, take the Nth character of each unit and concatenate them. N=1 is the classic acrostic.",
    usage: "Fill the cover text with camouflage text, set N as which character to take (default 1), and choose sep as the split method (line/sentence/word). After encoding the Nth character is the hidden content. Fill in the same N and sep when decoding.",
    examples: [
      { in: "甲乙丙", param: "cover=一二三\\n四五六\\n七八九, n=1, sep=line", out: "甲乙丙", desc: "N=1 is equivalent to an acrostic" },
      { in: "XYZ", param: "cover=一二三\\n四五六\\n七八九, n=2, sep=line", out: "一X三\n四Y六\n七Z九", desc: "N=2 replaces the 2nd character of each line" },
    ],
    tips: ["N=1 is the classic acrostic", "When the cover is too short, characters are added automatically to keep it reversible", "Word mode splits on spaces, suited for English"],
    aka: ["Nth-char", "第N字隐写", "藏头泛化", "nth character stego", "第N个字", "每行第N字", "第n位取字", "藏头诗泛化", "nth char extract", "第N字符隐写", "取第N字", "行内第N字"],
  },

  wordSpacingBits: {
    what: "Word-spacing steganography — use the number of spaces between words to carry binary bits: 1 space=0, 2 spaces=1.",
    principle: "The message is converted to UTF-8 bytes then to a bit string; the first 32 bits store the message length and the rest are the message bits. Walking through the spaces between words in the cover, 1 space=0 and 2 spaces=1, encoding bit by bit. When decoding, read the space counts between words → bits → first 32 bits for length → next N*8 bits for the message. The 32-bit length prefix makes decoding self-contained.",
    usage: "Fill the cover text with English text (words separated by spaces); after encoding the word spacing changes (double spaces appear in places) but is hard to notice by eye. Decoding needs no parameters — the length prefix recovers it self-contained.",
    examples: [
      { in: "Hi", param: "cover=word1 word2 ...(49 words)", out: "word1  word2...(space counts vary)", desc: "Hi→16 bits + 32 length = 48 bits → needs 49 words" },
    ],
    tips: ["The 32-bit length prefix makes decoding self-contained", "It errors when the cover has too few word gaps (<(32+len*8) gaps)", "Double spaces are visible in monospace fonts but hard to spot in proportional fonts", "detect flags multiple spaces as mildly suspicious (0.15)"],
    aka: ["Word-spacing stego", "词距隐写", "空格位隐写", "word spacing steganography", "空格数量隐写", "词间距隐写", "双空格隐写", "空白隐写", "whitespace stego", "词距位隐写", "空格编码隐写", "单词间距隐写"],
  },
};
