/*
 * edu-batch5-new.en.js — English education content for the batch-5 new/exclusive codecs.
 *
 * Pure data: export default { [opId]: EduEntry }. No import, no side effects, no register.
 * Covers the exclusive ops: rotor machines (enigma/m209), exclusive fancy
 * (bazeries/fenham/pizzini/kamasutra/lolcode/clockCipher), block transform (bwt),
 * whitespace stego (snow), the QQ-Xiuzi family (qqxiuzi_*),
 * and Chinese-style codecs (huoxingwen/jianfan/fuyouyue/tianshu).
 *
 * Op keys: enigma, m209, bazeries, fenham, pizzini, kamasutra, lolcode, clockCipher,
 * bwt, snow, qqxiuzi_arrow, qqxiuzi_flower, qqxiuzi_ipa, qqxiuzi_letter,
 * qqxiuzi_braille, qqxiuzi_chinese, qqxiuzi_music, huoxingwen, jianfan, fuyouyue, tianshu.
 *
 * EduEntry contract: what/principle/usage/examples/formulas/tips/aka.
 */

export default {
 // ============================================================
 // Rotor machines
 // ============================================================
  enigma: {
    what: "Enigma, the most famous rotor cipher machine of the German army in WWII. Three rotatable wiring rotors plus a reflector map each letter to another letter; the rotors step on every keypress, so the same letter maps differently every time.",
    principle:
      "Current leaves the keyboard, first crosses the plugboard (Steckerbrett), passes through the right, middle and left rotors to the reflector, then travels back the same path through all three rotors to light a lamp. Each rotor is a 26→26 wiring table; every time a rotor steps one position the whole table shifts.\n\nKey mechanics:\n\n1. **Stepping**: on a keypress the rotors step first, then encrypt. The right rotor advances one position per key; when it reaches its notch it carries the middle rotor, and the middle rotor at its notch carries the left rotor.\n2. **Double-stepping anomaly**: when the middle rotor is at its notch, the next keypress makes it step again together with the left rotor. This is Enigma's famous mechanical quirk.\n3. **Ring setting (Ringstellung)**: shifts the rotor wiring relative to the index ring — `(c - ring + pos) mod 26` on entry, `(c - pos + ring) mod 26` on exit.\n4. **Reciprocity**: the reflector guarantees that if A encrypts to K, then K encrypts to A under the same configuration. So Enigma encryption and decryption are the same operation — but this also gives the fatal weakness that a letter can never map to itself, which Turing's team exploited to break it.",
    usage:
      "Enter the rotor sequence (left→right, e.g. `I II III`, choose from the five rotors I-V), the reflector (B or C), the ring setting Ringstellung (e.g. `AAA`), the initial rotor positions (e.g. `AAA`), and the plugboard (e.g. `AB CD EF`, may be empty). Encryption and decryption share one configuration, so encode/decode give the same result (reciprocal). Non-letter characters pass through unchanged.",
    examples: [
      { in: "HELLOWORLD", param: "rotors=I II III, refl=B, ring=AAA, pos=AAA, no plugboard", out: "ILBDAAMTAZ", desc: "Standard Enigma I configuration" },
      { in: "ILBDAAMTAZ", param: "same configuration", out: "HELLOWORLD", desc: "Reciprocal: same configuration decrypts back to the plaintext" },
      { in: "AAAAA", param: "rotors=I II III, refl=B, ring/pos=AAA", out: "BDZGO", desc: "First 5 letters of the famous historical vector BDZGOWCXLT" },
    ],
    tips: [
      "In CTFs, an all-uppercase string where no plaintext letter ever appears at the same position in the ciphertext is almost certainly Enigma.",
      "Breaking it does not need a brute-force sweep of the whole 26^3×… space — the fact that a letter never maps to itself, plus a known-plaintext crib, prunes the search massively.",
      "Get any setting wrong and everything scrambles: rotor order, reflector, ring setting, initial position and plugboard are all required, and challenges usually provide them all.",
    ],
    aka: ["Enigma", "恩尼格玛", "恩尼格玛机", "德军密码机", "转子机", "Enigma machine", "谜机", "转轮密码机", "德国密码机", "转子密码机", "英格玛", "Enigma密码", "rotor machine"],
  },

  m209: {
    what: "M-209 (Hagelin C-38), the portable mechanical cipher machine of the US army in WWII. Palm-sized and purely gear-driven, it uses 6 letter wheels plus a 27-bar lug cage to produce a displacement value and encrypts in the Beaufort style.",
    principle:
      "The 6 key wheels have coprime letter counts: `26, 25, 23, 21, 19, 17` (the period equals their product, extremely long). Each wheel carries a ring of pins that can be pushed down or lifted.\n\nFor each letter encrypted:\n\n1. Read whether the pin at each of the 6 wheels' current window letters is 'active' (pushed down).\n2. Each of the 27 lug-cage bars carries 0/1/2 lugs pointing at some wheel; if that wheel is active the bar is displaced. The number of displaced bars is the shift K (0..27).\n3. Beaufort encryption: `C = (K - P) mod 26`. This is naturally reciprocal — `P = (K - C) mod 26` — so encryption and decryption are the same operation.\n4. Each of the 6 wheels steps one position, moving on to the next letter.",
    usage:
      "Enter the pin settings (6 groups, each listing the 'active' letters of that wheel), the lug cage (27 bars in `a-b` form, a/b∈0..6, 0=neutral), and the initial wheel positions (6 letters, e.g. `AAAAAA`). Pins/lugs are key material; this tool provides one self-consistent default configuration. Same configuration gives the same result for encrypt/decrypt. Non-letters pass through unchanged.",
    examples: [
      { in: "HELLO", param: "default pin/lug/start=AAAAAA", out: "POHHI", desc: "Encryption with the default configuration" },
      { in: "POHHI", param: "same configuration", out: "HELLO", desc: "Beaufort reciprocity, decrypts back to the plaintext" },
    ],
    tips: [
      "The wheel periods 26/25/23/21/19/17 are the M-209 fingerprint; the coprime design makes the overall period about 101 million.",
      "M-209 only encrypts A-Z and was traditionally sent grouped in fives; digits and punctuation must be transliterated first.",
      "Sources disagree on the 'pin-reading window offset' convention, so the same key can produce an overall shift in the ciphertext — check that convention before matching against historical ciphertext.",
    ],
    aka: ["M-209", "M209", "Hagelin", "哈格林", "C-38", "转轮密码机", "Hagelin C-38", "哈格林密码机", "美军密码机", "杆笼密码机", "Converter M-209", "机械密码机", "lug cage cipher"],
  },

 // ============================================================
 // Exclusive fancy / classical
 // ============================================================
  bazeries: {
    what: "Bazeries cipher, designed by the 19th-century French cryptologist Bazeries. It stacks Polybius-square substitution and 'digit-group reversal' into two steps, making it more resistant to analysis than plain square substitution.",
    principle:
      "A numeric key (e.g. 81257) drives two things:\n\n1. Spell the number as an English word (num2words) and use its letter order to build a 5×5 key square (I/J merged).\n2. First group the plaintext by the digits of the number, reverse the letter order within each group, then apply Polybius coordinate substitution using the square.\n\nDecryption reverses the order to restore.",
    usage: "Enter the numeric key (e.g. `81257`). encode encrypts, decode decrypts. Only letters are processed; non-letters pass through. A key containing 0 causes grouping anomalies, and the tool blocks it with an error.",
    examples: [
      { in: "HELLO", param: "key=81257", out: "cggmd", desc: "Square substitution + group reversal (output may carry a trailing group space, reversible after trim)" },
    ],
    tips: ["Bazeries is a mixed 'transposition + substitution' cipher, harder to crack directly with frequency analysis than pure substitution."],
    aka: ["Bazeries", "巴泽里斯密码", "Bazeries cipher", "巴泽里密码", "Étienne Bazeries", "波利比奥斯变体", "Polybius变体", "数字分组反转", "换位替换混合密码", "法国密码", "巴泽利斯", "方阵替换密码", "Polybius variant"],
  },

  fenham: {
    what: "Fenham cipher writes each A-Z letter as the 7-bit binary of its ASCII code, then XORs it bit by bit with the key letter's binary, outputting a long string of 0/1.",
    principle:
      "A-Z correspond to ASCII 65-90, which happen to all be 7-bit binary (A=`1000001` … Z=`1011010`). To encrypt, XOR the plaintext letter's 7 bits with the key letter's 7 bits bit by bit (same→0, different→1), cycling through the key. To decrypt, take each 7-bit group and XOR again with the key letter to restore.",
    usage: "Enter a letter key (e.g. `KEY`). encode outputs a binary string, decode consumes a binary string to restore. Only A-Z supported.",
    examples: [
      { in: "HELLO", param: "key=KEY", out: "00000110000000001010100001110001010", desc: "5 letters → 35 bits (7 bits per letter)" },
    ],
    tips: ["A pure 0/1 string whose length is a multiple of 7, suspected to be a letter cipher, is worth trying as Fenham.", "It is essentially a 7-bit fixed-length Vigenère XOR."],
    aka: ["Fenham", "芬厄姆密码", "Fenham cipher", "芬汉姆密码", "7位二进制异或", "二进制异或密码", "字母XOR密码", "ASCII异或密码", "维吉尼亚XOR", "位异或密码", "binary XOR cipher", "芬厄姆"],
  },

  pizzini: {
    what: "Pizzini cipher, a fixed 'letter → number' substitution table where A-Z map to the numbers 4 through 29. It is a fancy variant of simple monoalphabetic substitution.",
    principle:
      "A-Z correspond in order to 4,5,6,…,29 (copied from the authoritative table). To encrypt, look each letter up in the table to a number; to decrypt, look the numbers back up to letters. Since some values are two digits, decoding relies on the numeric pattern to split them.",
    usage: "encode turns letters into a number string, decode restores a number string to letters. Only A-Z processed.",
    examples: [
      { in: "HELLO", out: "118151518", desc: "H=11 E=8 L=15 L=15 O=18" },
    ],
    tips: ["A pure number string with values concentrated in 4-29 suggests Pizzini."],
    aka: ["Pizzini", "皮齐尼密码", "Pizzini cipher", "皮奇尼密码", "字母数字替换表", "4-29替换", "单表替换密码", "字母转数字密码", "数字替换密码", "皮齐尼", "Pizzini code", "意大利黑手党密码", "Italian mafia cipher"],
  },

  kamasutra: {
    what: "Kamasutra cipher, a pairing substitution recorded in the ancient Indian Kama Sutra: letters are paired up two by two and swapped for each other on encryption. Because it is a pairing, encryption and decryption are the same operation (reciprocal).",
    principle:
      "Given a pairing table (e.g. `AB CD EF …`), the two letters in each pair swap for each other: A↔B, C↔D… Encryption and decryption are perfectly symmetric. Characters not in any pair are kept unchanged.",
    usage: "Enter the pairing table (pairs), which supports three notations: space-separated, comma-separated, or every 2 characters as one pair. encode/decode give the same result (reciprocal).",
    examples: [
      { in: "HELLO", param: "key=AB CD EF GH IJ KL MN OP QR ST UV WX YZ", out: "GFKKP", desc: "Swap by the pairing table: H↔G, E↔F, L↔K, O↔P" },
    ],
    tips: ["Reciprocity is its signature: encrypt twice and you are back to the plaintext.", "The pairing table is the key, and challenges usually provide it."],
    aka: ["Kamasutra", "爱经密码", "Vatsyayana", "Kamasutra cipher", "卡玛经密码", "欲经密码", "配对替换密码", "自反替换密码", "婆蹉衍那密码", "字母配对密码", "古印度密码", "Kama Sutra"],
  },

  lolcode: {
    what: "LOLCODE character-shift encoding, a simple character substitution that offsets by ASCII code in segments. The name comes from the LOLCODE meme programming language.",
    principle:
      "Decoding rule (per the authoritative source): for each character `num = ord(c) - 3`; if `num > 69` then add another `+5`, otherwise `+2`, then take `chr(num)`. Encryption is its inverse. Because the mapping is not a bijection, the plaintext characters H/I/J have no corresponding ciphertext, and encryption errors out when it hits them.",
    usage: "encode encrypts, decode decrypts. The ciphertext is shifted visible ASCII with no fixed character-set signature, so the one-click solver skips auto-detection for it (to avoid false positives).",
    examples: [
      { in: "NUAACTF", out: "LSBBDRG", desc: "Character-shift encryption" },
      { in: "LSBBDRG", out: "NUAACTF", desc: "Decrypts back to the plaintext" },
    ],
    tips: ["The mapping is not a bijection, so encrypting H/I/J errors out — this is a limitation of the algorithm itself, not a bug.", "In CTFs it often pairs with the flag format; the ciphertext looks like garbage ASCII to the eye."],
    aka: ["LOLCODE", "LOLCODE 语言", "lolcode cipher", "LOLCODE编码", "梗语言编码", "字符移位编码", "ASCII移位密码", "LOL密码", "分段偏移编码", "lolspeak", "LOLCODE移位", "笑话语言编码"],
  },

  clockCipher: {
    what: "Clock cipher, mapping letters to 'hour:minute' on a clock face and encoding via the hand positions. An intuitive fancy encoding.",
    principle:
      "Letters are mapped in order onto the 12-hour ring plus the minute-hand ticks, each letter corresponding to a unique 'hour:minute' moment. Decoding just looks the moment back up to a letter. The rule is clear and reversible (see the in-tool comments).",
    usage: "encode turns text into a string of moments (e.g. `1:35 1:20 …`), decode restores a moment string to text.",
    examples: [
      { in: "HELLO", out: "1:35 1:20 1:55 1:55 2:10", desc: "One moment per letter, space-separated" },
    ],
    tips: ["A string of hour:minute values with a regular minute pattern suggests the clock cipher."],
    aka: ["clock cipher", "表盘码", "时钟码", "指针码", "钟表密码", "时钟密码", "clock code", "时钟编码", "钟面码", "时分密码", "时刻编码", "表盘密码"],
  },

 // ============================================================
 // Block transform
 // ============================================================
  bwt: {
    what: "BWT (Burrows-Wheeler Transform), the core step of bzip2 compression. It does not compress data; it rearranges bytes into a form where 'identical characters are more likely to sit together', paving the way for later compression, and it is fully reversible.",
    principle:
      "Arrange all cyclic rotations of the string into a table, sort them lexicographically, take the last column as the output, and record the row number of the original string in the sorted table (the primary index). The inverse transform uses LF-mapping (last-to-first mapping) to rebuild the original string from the last column plus the primary index.\n\nExample `banana`: sort all rotations, take the last column to get `nnbaaa`; the original string is at row 3, so the output is `nnbaaa|3`.",
    usage: "encode outputs 'transform string + primary index' (separated by `|`), decode consumes this format and inverse-transforms to restore. Handles edge cases like empty string, single character and repeated characters.",
    examples: [
      { in: "banana", out: "nnbaaa|3", desc: "Transform string nnbaaa, primary index 3" },
      { in: "nnbaaa|3", out: "banana", desc: "LF-mapping inverse transform restores" },
    ],
    tips: ["BWT itself does not compress, but it clusters runs like `aaa` and `nn`, only achieving compression when combined with MTF+RLE+entropy coding.", "In CTFs, a 'reordered string with an unchanged character set plus an index number' suggests BWT."],
    aka: ["BWT", "Burrows-Wheeler", "块排序变换", "bzip2 变换", "Burrows-Wheeler Transform", "block-sorting transform"],
  },

 // ============================================================
 // Whitespace stego
 // ============================================================
  snow: {
    what: "SNOW whitespace steganography (Steganographic Nature Of Whitespace) hides secret information in the 'spaces/tabs' at the end of each line of text — a space means 0, a tab means 1 — completely invisible to the eye.",
    principle:
      "First encode the message into binary (with a 4-byte length header), then append these bits line by line to the end of each line of the container text: space=0, tab=1. Because trailing whitespace is invisible in editors, the carrier reads exactly like ordinary text. To decode, extract the trailing whitespace of each line, restore the bits, and read the length header to slice out the message.",
    usage: "On encode, provide a 'container text (optional)' and the message is hidden into the line ends of the container; decode consumes the text containing the stego and extracts the message. If the container has too few lines, blank lines are added automatically.",
    examples: [
      { in: "Hi (message) + 2-line container", param: "text=container text", out: "space/tab sequences appended to each line end", desc: "Line-end whitespace encodes the bits of 'Hi', body text unchanged" },
    ],
    tips: ["Given text that 'looks normal but seems to have trailing whitespace', turn on 'show invisible characters' first, then try SNOW.", "Many editors auto-trim trailing whitespace, so protect it with an attachment or code block when transmitting."],
    aka: ["SNOW", "空白隐写", "whitespace stego", "行尾空白隐写", "空格隐写", "制表符隐写", "whitespace steganography", "空白字符隐写", "snow stego", "tab空格隐写", "不可见字符隐写", "SNOW隐写"],
  },

 // ============================================================
 // QQ-Xiuzi character cipher family (qqxiuzi_*)
 // ============================================================
  qqxiuzi_arrow: {
    what: "QQ-Xiuzi · Arrow cipher XORs the text bytes, turns them into hexadecimal, then substitutes each hex digit with one of 16 arrow symbols (←↑→↓ etc). An optional password is supported.",
    principle:
      "Unified algorithm: each byte becomes `ord ^ 48 ^ keyValue`, where keyValue = the sum of the password characters' ASCII XOR-ed with `48` (0 when there is no password). The result is encoded to hex, and each nibble (0-15) maps to one arrow symbol; a single byte uses 2 symbols + `=` suffix, multiple bytes use 4 symbols + `==` suffix.",
    usage: "encode encrypts, decode decrypts. Optional password (leave empty for no password). Arrow set: `←↑→↓↔↕↖↗↘↙↰↱↲↳↺↻`.",
    examples: [
      { in: "中", out: "↔↺↑↳==", desc: "No password, UTF-8 3 bytes → 4 symbols + == suffix" },
    ],
    tips: ["The four QQ-Xiuzi families (arrow/flower/IPA/letter) share the same algorithm and differ only in the symbol table; the `=`/`==` suffix tells single- vs multi-byte."],
    aka: ["QQ秀箭头", "箭头密码", "arrow cipher", "QQ秀·箭头", "qqxiuzi arrow", "QQ秀火星文箭头", "箭头符号密码", "方向箭头密码", "QQ秀加密箭头", "箭头编码", "arrow code", "QQ秀符号密码"],
  },

  qqxiuzi_flower: {
    what: "QQ-Xiuzi · Flower cipher uses the same algorithm as the arrow cipher, just mapping each hex digit to one of 16 flower symbols (✻✼✽✾✿❀ etc, consecutive Unicode flower glyphs).",
    principle:
      "Exactly the same XOR + hex + symbol-mapping flow as qqxiuzi_arrow, with the symbol table replaced by the 16 consecutive flower characters starting at `chr(10043)`. Single byte 2 symbols + `=`, multiple bytes 4 symbols + `==`.",
    usage: "encode/decode, optional password. Flower table: `✻✼✽✾✿❀❁❂❃❄❅❆❇❈❉❊`.",
    examples: [
      { in: "中", out: "✿❉✼❈==", desc: "No password, 4 flower symbols + == suffix" },
    ],
    tips: ["A string of consecutive flower-emoji-style symbols ending in `=`/`==` is basically the QQ-Xiuzi flower cipher."],
    aka: ["QQ秀花", "花密码", "flower cipher", "QQ秀·花", "qqxiuzi flower", "花朵密码", "花朵符号密码", "QQ秀花朵", "花符密码", "flower code", "QQ秀鲜花密码", "花卉密码"],
  },

  qqxiuzi_ipa: {
    what: "QQ-Xiuzi · IPA cipher, same algorithm, with the symbol table replaced by 16 International Phonetic Alphabet (IPA) consonant letters (ɐɑɒɓɔɕ etc).",
    principle:
      "Same flow as qqxiuzi_arrow, with the symbol table being the IPA consonants `ɐɑɒɓɔɕɖɘəɛɜɟɠɡɢɣ`. Note the 14th, `ɡ`, is U+0261 (the single-story g variant), not ASCII g.",
    usage: "encode/decode, optional password.",
    examples: [
      { in: "中", out: "ɔɢɑɡ==", desc: "No password, 4 IPA symbols + == suffix" },
    ],
    tips: ["`ɡ` (U+0261) looks like ordinary g but has a different code point; do not mix them when copying or decoding will misalign."],
    aka: ["QQ秀IPA", "IPA密码", "音标密码", "QQ秀·IPA", "qqxiuzi ipa", "国际音标密码", "IPA cipher", "音标符号密码", "phonetic cipher", "QQ秀音标", "国际音标编码", "辅音符号密码"],
  },

  qqxiuzi_letter: {
    what: "QQ-Xiuzi · Letter cipher, same algorithm, with the symbol table being a scrambled set of Latin letters (TUVWXYZABCNOPQRS).",
    principle:
      "Same flow as qqxiuzi_arrow, with the symbol table being the 16 scrambled letters `TUVWXYZABCNOPQRS`. Because the symbols are ordinary letters, recognition must rely on the trailing `=`/`==` suffix, otherwise it is easily confused with ordinary English.",
    usage: "encode/decode, optional password.",
    examples: [
      { in: "中", out: "XRUQ==", desc: "No password, 4 letters + == suffix" },
    ],
    tips: ["The alphabet overlaps with English, so the one-click solver must require a `=`/`==` suffix before flagging it, to avoid mislabeling ordinary English."],
    aka: ["QQ秀字母", "字母密码", "QQ秀·字母", "qqxiuzi letter", "打乱字母密码", "letter cipher", "拉丁字母密码", "乱序字母密码", "QQ秀拉丁字母", "字母替换密码", "letter code", "QQ秀英文密码"],
  },

  qqxiuzi_braille: {
    what: "QQ-Xiuzi · Braille cipher maps bytes to braille dot symbols (the U+2800 block). With a password it goes through hex encoding; without one it uses a compact '1 character = 1 byte' form.",
    principle:
      "With a password: each byte is XOR-ed then mapped to braille by hex; single byte 1 symbol + `=`, two bytes 2 symbols + `==`. Without a password: the byte is directly XOR-ed with 48; if less than 128 it uses 1 braille symbol, otherwise it is split into high/low nibbles (high `|128`) as 2 symbols + `=`.",
    usage: "encode/decode, optional password. Braille base U+2800 (⠀-⣿).",
    examples: [
      { in: "A", out: "⡱=", desc: "No password, single byte 1 braille symbol + = suffix" },
    ],
    tips: ["The braille block U+2800-U+28FF is an obvious fingerprint, and a trailing `=`/`==` makes it even more certain."],
    aka: ["QQ秀盲文", "盲文密码", "braille cipher", "QQ秀·盲文", "qqxiuzi braille", "盲文点字密码", "点字密码", "布莱叶密码", "braille code", "QQ秀点字", "盲文符号密码", "U+2800密码"],
  },

  qqxiuzi_chinese: {
    what: "QQ-Xiuzi · Chinese-character cipher maps bytes to common Chinese characters, using three substitution tables (single-byte/double-byte/triple-byte) to cover different code-point ranges, distinguished by `=`/`==`/`===` suffixes.",
    principle:
      "Pick the table by the character's code-point size: single byte uses the SB table + `=`, double byte (256-0xFFFF) uses the MB table + `==`, triple byte uses a three-table combination + `===`. The password derives two components kH/kL that participate in the XOR. When a byte is empty in the SB table, it falls back to the FIRST_EX special-case table.",
    usage: "encode/decode, optional password. The number of suffix characters = the byte count of each character.",
    examples: [
      { in: "A", out: "霄=", desc: "No password, single byte → 1 Chinese character + = suffix" },
    ],
    tips: ["The ciphertext is 'a string of common Chinese characters plus 1~3 trailing equals signs', and the number of equals signs reveals the byte width of the original character."],
    aka: ["QQ秀汉字", "汉字密码", "QQ秀·汉字", "qqxiuzi chinese", "中文密码", "常用汉字密码", "chinese cipher", "汉字替换密码", "QQ秀中文", "汉字编码", "chinese code", "QQ秀汉字加密"],
  },

  qqxiuzi_music: {
    what: "QQ-Xiuzi · Music cipher turns bytes into decimal then encodes them with 10 musical symbols (♭♯§∮♪♩♫♬ etc), using three prefix/suffix combinations to distinguish short/standard/wide modes.",
    principle:
      "Each byte is XOR-ed then turned into decimal, represented by 3 musical symbols (one digit per symbol). The mode is chosen by the numeric magnitude: short mode `♯=` prefix (value < 100), standard `§=`, wide mode `♪==` (value ≥ 10000, compressed into 5 symbols).",
    usage: "encode/decode, optional password. Symbol set `‖♭♯§∮♪♩♫♬¶`.",
    examples: [
      { in: "A", out: "♭♭§§=", desc: "No password, short mode" },
    ],
    tips: ["Leading with musical symbols `♭♯♪♫`; look at the `♯=`/`§=`/`♪==` prefix to tell the mode."],
    aka: ["QQ秀音乐", "音乐密码", "music cipher", "QQ秀·音乐", "qqxiuzi music", "音乐符号密码", "乐谱密码", "音符密码", "music code", "QQ秀音符", "音乐记号密码", "五线谱密码"],
  },

 // ============================================================
 // Chinese-style codecs
 // ============================================================
  huoxingwen: {
    what: "Martian text (huoxingwen) replaces common simplified Chinese characters with visually similar rare characters, phonetic symbols and traditional characters. It was a popular 'alternative' text game in the early days of the Chinese internet.",
    principle:
      "It ships three one-to-one character libraries (simplified/traditional/martian, each with several thousand characters). Encryption (to martian) looks up simplified/traditional characters and replaces them with the corresponding visually similar martian characters; decryption looks martian back up to simplified as much as possible. Because the martian table contains duplicate characters (several simplified characters map to the same martian one), decoding does not guarantee a perfect round-trip.",
    usage: "encode converts to martian text, decode converts back to simplified. Characters not in the table are kept unchanged.",
    examples: [
      { in: "你好", out: "沵恏", desc: "Simplified → visually similar martian characters" },
    ],
    tips: ["Martian text does not guarantee a perfect round-trip (duplicate characters cause mapping drift); aim for 'output that looks like martian' rather than exact restoration."],
    aka: ["火星文", "非主流文字", "martian text", "火星语", "非主流字体", "网络火星文", "形近字替换", "注音符号密码", "martian language", "火星文转换", "非主流文字转换", "生僻字密码"],
  },

  jianfan: {
    what: "Simplified-traditional conversion, converting between simplified and traditional Chinese based on a built-in mapping table.",
    principle:
      "Using two one-to-one character libraries (simplified/traditional, each about 2800 common characters), encode replaces simplified characters with traditional character by character, and decode converts traditional back to simplified. Characters not in the table (English, punctuation, rare characters) are kept unchanged.",
    usage: "encode simplified→traditional, decode traditional→simplified.",
    examples: [
      { in: "简体转换", out: "簡體轉換", desc: "Simplified → traditional" },
      { in: "簡體轉換", out: "简体转换", desc: "Traditional → simplified" },
    ],
    tips: ["It only does one-to-one mapping of common characters and does not handle 'one simplified to many traditional' semantic ambiguity (e.g. 后/後, 里/裡 are fixed to one per the table)."],
    aka: ["简繁转换", "繁简转换", "简繁体", "traditional-simplified", "简体繁体互转", "繁体转简体", "简体转繁体", "简繁互转", "简中繁中", "Simplified Chinese", "Traditional Chinese", "中文简繁"],
  },

  fuyouyue: {
    what: "Fo-You-Yue ('the Buddha said again', Discussing Zen with the Buddha V2), the upgraded encrypted version of the Buddhist-style cipher: on top of the Heart Sutra character mapping it adds real AES-256-CBC encryption, so the ciphertext looks like '佛又曰：…', all Buddhist-scripture characters.",
    principle:
      "Use OpenSSL EVP_BytesToKey(MD5) to derive key+iv from the passphrase, encrypt with AES-256-CBC, wrap it in OpenSSL `Salted__` format as base64, then map each of the 65 base64 characters one by one to a Heart Sutra / Buddhist-scripture character and add the '佛又曰：' prefix. Each encryption uses a random salt, so the same plaintext produces different output twice, but both decrypt back.",
    usage: "Enter the key (default `takuron.top`), encode encrypts, decode decrypts. Because AES is asynchronous, the op is internally async.",
    examples: [
      { in: "Hello", param: "key=takuron.top", out: "佛又曰：… (random salt each time, output differs)", desc: "AES-256-CBC + Heart Sutra mapping; decode restores Hello" },
    ],
    tips: ["Not interchangeable with the simplified foyu: foyu is just base64+mapping with no real encryption, while fuyouyue is real AES encryption.", "A wrong passphrase means it won't decrypt; the default passphrase is takuron.top."],
    aka: ["佛又曰", "与佛论禅V2", "新佛曰", "Buddha says V2", "佛曰V2", "与佛论禅2", "佛系密码V2", "心经密码", "佛经密码", "AES佛曰", "禅语密码", "佛又曰加密"],
  },

  tianshu: {
    what: "Heavenly script (tianshu) shares the same AES-256-CBC + character-mapping core as fuyouyue, just replacing the Buddhist-scripture characters with Taoist-scripture characters, so the ciphertext looks like '曰：…'.",
    principle:
      "Exactly the same EVP_BytesToKey(MD5) + AES-256-CBC + OpenSSL Salted__ base64 flow as fuyouyue, with the character mapping table replaced by 65 Taoist-scripture characters and the prefix changed to '曰：'. It also uses a random salt each time.",
    usage: "Enter the key (default `BlackCat184`), encode/decode, op is internally async.",
    examples: [
      { in: "Hi", param: "key=BlackCat184", out: "曰：… (random salt)", desc: "AES-256-CBC + Taoist-scripture mapping; decode restores Hi" },
    ],
    tips: ["Same core as fuyouyue but a different character table, told apart by the '曰：' prefix and the Taoist-scripture characters.", "Default passphrase BlackCat184."],
    aka: ["天书", "道经密码", "heavenly scripture", "天书密码", "道经加密", "道教密码", "AES天书", "曰密码", "道藏密码", "天书加密", "heavenly book", "道经字符密码"],
  },
};
