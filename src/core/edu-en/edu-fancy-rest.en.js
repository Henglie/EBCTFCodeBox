/*
 * edu-fancy-rest.en.js — English edu shard: fancy family completion.
 * Covers 53 fancy-category ops: morse/bacon/railFence/caesar/rot13/rot5/rot18/rot47/atbash/a1z26/dna/keyboard/brainfuck/ook/cetacean/yygq/braille/eightdiagram/whitespace/pigpen/keyboardShift/malbolge/aaencode/baudot/type7/decabit/scytale/keyCode/shiftKey/keyword9/keyboardSurround/qweAbc/layoutMap/t9Phone/multitap/kbdFullCoord/stenoLetter/arrowKey/americanMorse/cnTelegraphMorse/tapCode/semaphore/dtmf/morseRhythm/manchester/diffManchester/nrzi/miller/fourB5B/pwmPpm/musicNotation/musicInfo/fracmorse.
 * Sample values were obtained by actually running _probe_fancy.mjs. Pure data export — no imports, no side effects, no register.
 */
export default {
  morse: {
    what: "Morse code — represents letters and digits using dots (·) and dashes (−).",
    principle: "International Morse code defines a unique dot/dash combination for every letter and digit. Letters are separated by spaces, and information travels as combinations of short signals (dots) and long signals (dashes).",
    usage: "No parameters. Bidirectional encode/decode; direction is detected automatically from the input text.",
    examples: [{ in: "SOS", param: {}, out: "... --- ...", desc: "Morse for the distress signal SOS: three short, three long, three short." }],
    formulas: [{ tex: "\\text{Morse}(c) \\in \\{\\cdot, -\\}^{+}", caption: "Each character maps to a sequence of dots and dashes." }],
    tips: ["A dot is 1 time unit, a dash is 3 time units.", "Letter gap is 3 units, word gap is 7 units.", "SOS is the most recognizable distress code."],
    aka: ["国际摩尔斯电码", "Morse code", "摩斯电码", "摩尔斯电码", "摩斯密码", "Morse", "莫尔斯电码", "点划码", "电报码", "SOS", "point dash", "国际电码"]
  },
  bacon: {
    what: "Bacon cipher — represents each letter with a 5-position a/b combination.",
    principle: "Each letter is encoded as a 5-symbol a/b sequence (a=dot, b=dash). The 26-letter variant merges I/J and U/V; the 24-letter variant distinguishes all letters.",
    usage: "params: version(26/24, default 26). Bidirectional encode/decode.",
    examples: [{ in: "HELLO", param: { version: 26 }, out: "aabbb aabaa ababb ababb abbba", desc: "26-letter Bacon: H=aabbb, E=aabaa, L=ababb." }],
    formulas: [{ tex: "\\text{Bacon}(c) = \\text{bin}_5(\\text{idx}(c))", caption: "Letter index to 5-bit binary, 0→a, 1→b." }],
    tips: ["The 26-letter variant has 24 groups (I/J and U/V merged).", "The 24-letter variant distinguishes all 26 letters.", "Can be hidden inside any difference between two typefaces."],
    aka: ["培根密码", "Bacon cipher", "培根加密", "Baconian cipher", "Bacon's cipher", "培根隐写", "双字母隐写", "abab编码", "Francis Bacon", "弗朗西斯培根", "字体隐写", "biliteral cipher"]
  },
  railFence: {
    what: "Rail Fence cipher — arranges letters along a zigzag of rails.",
    principle: "Plaintext is written in a Z-shape across a number of rails, then read off row by row to form the ciphertext. Decryption restores positions using the rail period.",
    usage: "params: rails(default 2). Bidirectional encode/decode.",
    examples: [{ in: "HELLO", param: { rails: 2 }, out: "HLOEL", desc: "2 rails: H/L/O on top, E/L on the bottom, merged into HLOEL." }],
    formulas: [{ tex: "T = 2(r-1)", caption: "The period T is set by the rail count r; positions in the same column are symmetric." }],
    tips: ["rails=2 is equivalent to separating odd and even positions.", "More rails make a steeper zigzag.", "The rail count must be agreed on with the receiver."],
    aka: ["栅栏密码", "Rail Fence cipher", "篱笆密码", "锯齿密码", "railfence", "rail fence", "zigzag cipher", "Z字形密码", "W型密码", "换位密码", "栏栅密码", "曲折密码"]
  },
  caesar: {
    what: "Caesar cipher — shifts the whole alphabet by a fixed amount.",
    principle: "Each letter rotates a fixed shift amount within the alphabet; the shift is the key.",
    usage: "params: shift(default 3). Bidirectional encode/decode.",
    examples: [{ in: "HELLO", param: { shift: 3 }, out: "KHOOR", desc: "Shift 3: H→K, E→H, L→O, L→O, O→R." }],
    formulas: [{ tex: "E_n(x) = (x + n) \\bmod 26", caption: "Letter index x plus shift n, mod 26." }],
    tips: ["shift=13 is ROT13.", "Only 25 valid keys, so it's trivial to brute-force.", "Only letters are substituted; non-letters are unchanged."],
    aka: ["凯撒密码", "Caesar cipher", "恺撒密码", "Caesar shift", "移位密码", "shift cipher", "凯撒移位", "Caesar", "字母位移密码", "凯撒加密", "位移替换密码", "ROT-N"]
  },
  rot13: {
    what: "ROT13 — a self-inverse substitution that shifts the alphabet by 13.",
    principle: "Each letter moves 13 positions. Because the alphabet is 26 letters, shifting by 13 again restores the original, so encode equals decode.",
    usage: "No parameters, self-inverse; applying it again decodes.",
    examples: [{ in: "HELLO", param: {}, out: "URYYB", desc: "H→U, E→R, L→Y, L→Y, O→B." }],
    formulas: [{ tex: "E(x) = (x + 13) \\bmod 26", caption: "Shift by 13, self-inverse: E(E(x))=x." }],
    tips: ["Self-inverse: run it again to recover the plaintext.", "Commonly used to hide spoilers and puzzle answers.", "Leaves digits and symbols untouched."],
    aka: ["ROT13", "回转13", "rot 13", "rot-13", "ROT-13", "旋转13", "位移13密码", "凯撒13", "rotate13", "自反凯撒", "ROT13解码", "字母表旋转13"]
  },
  rot5: {
    what: "ROT5 — a self-inverse substitution that shifts digits by 5.",
    principle: "Each digit moves 5 positions (0-9 wraparound); shifting by 5 again restores the original.",
    usage: "No parameters, self-inverse; only affects digits 0-9.",
    examples: [{ in: "12345", param: {}, out: "67890", desc: "1→6, 2→7, 3→8, 4→9, 5→0." }],
    formulas: [{ tex: "E(d) = (d + 5) \\bmod 10", caption: "Digit d plus 5 mod 10, self-inverse." }],
    tips: ["Self-inverse: run it again to recover the original.", "Only processes digit characters.", "Often combined with ROT13 to form ROT18."],
    aka: ["ROT5", "数字位移5", "rot 5", "rot-5", "ROT-5", "旋转5", "数字ROT", "digit rotate 5", "数字回转5", "0-9位移", "ROT5解码", "数字移位密码"]
  },
  rot18: {
    what: "ROT18 — combines ROT13 for letters and ROT5 for digits.",
    principle: "Letters are substituted with ROT13 and digits with ROT5; combined, the result is self-inverse.",
    usage: "No parameters, self-inverse; letters and digits are handled together.",
    examples: [{ in: "ABC123", param: {}, out: "NOP678", desc: "Letters ABC→NOP, digits 123→678." }],
    formulas: [{ tex: "E(c) = \\begin{cases} (c+13)\\bmod 26 & \\text{字母} \\\\ (c+5)\\bmod 10 & \\text{数字} \\end{cases}", caption: "Letters use ROT13, digits use ROT5." }],
    tips: ["Self-inverse: run it again to recover the original.", "It's the combination of ROT13 and ROT5.", "Has no effect on symbols."],
    aka: ["ROT18", "组合位移", "rot 18", "rot-18", "ROT-18", "ROT13+ROT5", "字母数字位移", "旋转18", "ROT18解码", "混合ROT", "字母数字混合位移", "ROT13加ROT5"]
  },
  rot47: {
    what: "ROT47 — a self-inverse substitution shifting printable ASCII by 47.",
    principle: "Shifts all 94 printable ASCII characters (33-126) by 47 (mod 94); shifting by 47 again restores the original.",
    usage: "No parameters, self-inverse; covers all printable ASCII.",
    examples: [{ in: "Hello", param: {}, out: "w6==@", desc: "H→w, e→6, l→=, l→=, o→@." }],
    formulas: [{ tex: "E(x) = ((x - 33 + 47) \\bmod 94) + 33", caption: "Shift by 47 within the printable ASCII range." }],
    tips: ["Self-inverse: run it again to recover the original.", "Covers all printable ASCII: letters, digits, and symbols.", "Stronger than ROT13 since it handles symbols too."],
    aka: ["ROT47", "ASCII位移47", "rot 47", "rot-47", "ROT-47", "旋转47", "可打印ASCII位移", "ASCII ROT", "ROT47解码", "94字符位移", "符号位移密码", "ASCII rotate 47"]
  },
  atbash: {
    what: "Atbash cipher — a mirror-flip substitution of the alphabet.",
    principle: "A↔Z, B↔Y, C↔X… the alphabet is reversed end-to-end, mapping index x to 25-x.",
    usage: "No parameters, self-inverse; applying it again restores the original.",
    examples: [{ in: "HELLO", param: {}, out: "SVOOL", desc: "H↔S, E↔V, L↔O, L↔O, O↔L." }],
    formulas: [{ tex: "E(x) = 25 - x", caption: "Mirror the letter index; self-inverse." }],
    tips: ["Self-inverse: run it again to restore the original.", "The original Hebrew-alphabet version works the same way.", "No key, so security is very low."],
    aka: ["埃特巴什密码", "Atbash cipher", "Atbash", "阿特巴希密码", "镜像密码", "字母表反转", "希伯来密码", "首尾对调密码", "atbash解码", "反字母表密码", "埃特巴什", "字母镜像替换"]
  },
  a1z26: {
    what: "A1Z26 — converts letters to their position numbers (A=1, B=2, …, Z=26).",
    principle: "Uses each letter's position in the alphabet directly as the code, separated by spaces.",
    usage: "No parameters. Bidirectional encode/decode.",
    examples: [{ in: "ABC", param: {}, out: "1 2 3", desc: "A=1, B=2, C=3." }],
    formulas: [{ tex: "E(c) = \\text{idx}(c) + 1", caption: "Letter index starting from 1." }],
    tips: ["The most basic letter encoding.", "Often serves as an intermediate step for other ciphers.", "Case handling must be agreed on."],
    aka: ["A1Z26", "字母序号编码", "a1z26", "A1Z26 cipher", "字母表位置", "letter number cipher", "字母编号", "A=1密码", "字母数字对应", "序号密码", "letter to number", "字母位置编码"]
  },
  dna: {
    what: "DNA encoding — converts letters into DNA triplet codons.",
    principle: "Converts a letter's index to binary, then maps it to a base-4 A/T/C/G triplet (similar to biological codons).",
    usage: "No parameters. Bidirectional encode/decode.",
    examples: [{ in: "AB", param: {}, out: "CGG CGT", desc: "A=CGG, B=CGT, DNA base triplets." }],
    formulas: [{ tex: "\\text{DNA}(c) = \\text{base}_4^3(\\text{idx}(c))", caption: "Letter index to a 3-digit base-4 value, mapped to ATCG." }],
    tips: ["Each letter corresponds to 3 bases.", "The base symbols can be customized.", "Inspired by the biological genetic code."],
    aka: ["DNA 密码", "DNA cipher", "DNA编码", "DNA encoding", "碱基编码", "ATCG编码", "DNA密码子", "基因密码", "核苷酸编码", "DNA codon", "碱基密码", "生物密码"]
  },
  keyboard: {
    what: "Keyboard coordinate encoding — row/column numbers on a 3-row QWERTY keyboard.",
    principle: "Following the standard 3-row QWERTY layout, each key maps to a (row.col) coordinate.",
    usage: "No parameters (QWERTY 3-row coordinates). Bidirectional encode/decode.",
    examples: [{ in: "HI", param: {}, out: "26 18", desc: "H = row 2, col 6 = 26; I = row 1, col 8 = 18." }],
    formulas: [{ tex: "E(c) = (\\text{row}, \\text{col})", caption: "The key's row/column position on the keyboard." }],
    tips: ["Based on the standard QWERTY layout.", "Row numbers run 1-3 from top to bottom.", "Coordinates with no separator are written together."],
    aka: ["键盘坐标", "Keyboard coordinate", "键盘密码", "QWERTY坐标", "键盘行列", "keyboard cipher", "键位坐标", "键盘位置编码", "行列键盘码", "keyboard coord", "三行键盘坐标", "键盘映射"]
  },
  brainfuck: {
    what: "Brainfuck — a minimalist imperative programming language.",
    principle: "Just 8 instructions + - > < . , [ ] operate on a one-dimensional byte array and a pointer. + increments the current cell, . outputs it.",
    usage: "No parameters. Bidirectional encode (generate code) / decode (execute code).",
    examples: [{ in: "Hi", param: {}, out: "++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++.+++++++++++++++++++++++++++++++++..", desc: "72 pluses set the cell to 72 (H), . outputs it, then 33 more pluses reach 105 (i), and . outputs again." }],
    formulas: [{ tex: "\\text{cell} += 1\\ (\\text{当} +),\\ \\text{output}(\\text{cell})\\ (\\text{当} .)", caption: "+ increments the cell, . outputs the cell's current value." }],
    tips: ["8 instructions: + - > < . , [ ]", "Cells are 8-bit bytes (0-255).", "Turing-complete, but extremely hard to read."],
    aka: ["Brainfuck", "BF 语言", "brainfuck", "BF", "脑残语言", "布莱恩福克", "b***fuck", "极简语言", "esoteric language", "深奥编程语言", "图灵完备语言", "八指令语言"]
  },
  ook: {
    what: "Ook! language — a Brainfuck variant using three-word instructions Ook./Ook?/Ook!",
    principle: "Pairs up Brainfuck's 8 instructions into the three symbol pairs Ook. / Ook? / Ook!, semantically equivalent.",
    usage: "No parameters. Bidirectional encode/decode.",
    examples: [{ in: "Hi", param: {}, out: "Ook. Ook. ... Ook!", desc: "The Ook! sequence is equivalent to a Brainfuck program." }],
    formulas: [{ tex: "\\text{Ook!} \\equiv \\text{Brainfuck}", caption: "Ook! instruction pairs correspond one-to-one with Brainfuck instructions." }],
    tips: ["Three symbols Ook./Ook?/Ook! paired two at a time.", "Fully equivalent to Brainfuck.", "A joke language in an ape-speech style."],
    aka: ["Ook!", "猩猩语", "Ook", "ook语言", "猿语", "红毛猩猩语", "Brainfuck变体", "Ook. Ook? Ook!", "orangutan language", "三字指令语言", "BF变体", "深奥语言Ook"]
  },
  cetacean: {
    what: "Cetacean (whale language) — represents binary using e/E.",
    principle: "0 and 1 are written as e and E respectively, expanding a character's ASCII binary into an e/E sequence.",
    usage: "No parameters (1→E, 0→e); input can be binary or text.",
    examples: [{ in: "Hi", param: {}, out: "EEEEEEEEEeEEeEEEEEEEEEEEEeeEeEEe", desc: "H=01001000, i=01101001, converted to an e/E sequence." }],
    formulas: [{ tex: "E(b) = \\begin{cases} E & b=1 \\\\ e & b=0 \\end{cases}", caption: "Binary bit 1→E, 0→e." }],
    tips: ["1→E (uppercase), 0→e (lowercase).", "It's essentially a binary visualization.", "An encoding styled after whale calls."],
    aka: ["鲸语", "Cetacean", "cetacean", "鲸鱼语", "Whale language", "eE编码", "鲸语密码", "eeEE编码", "鲸鱼叫声编码", "Cetacean cipher", "二进制eE", "海豚语"]
  },
  yygq: {
    what: "yygq (passive-aggressive speak) — represents binary with catchphrases.",
    principle: "Uses the two catchphrases 「就这¿」 and 「不会吧？」 to represent 0 and 1, expanding a character's ASCII binary.",
    usage: "No parameters (就这¿ / 不会吧？); text input.",
    examples: [{ in: "Hi", param: {}, out: "就这¿就这¿不会吧？...", desc: "The ASCII binary of H/i expressed as a catchphrase sequence." }],
    formulas: [{ tex: "E(b) = \\begin{cases} \\text{不会吧？} & b=1 \\\\ \\text{就这¿} & b=0 \\end{cases}", caption: "Binary bit 1→不会吧？, 0→就这¿." }],
    tips: ["0→就这¿, 1→不会吧？", "An encoding derived from an internet meme.", "Essentially a colloquial wrapper around binary."],
    aka: ["阴阳怪气语", "yygq", "阴阳怪气", "阴阳怪气编码", "就这不会吧", "yygq编码", "阴阳语", "怪话编码", "网络梗编码", "口头禅二进制", "yin yang", "阴阳怪气密码"]
  },
  braille: {
    what: "Braille encoding — 8-dot braille from the Unicode U+2800 block.",
    principle: "Each character maps into the Unicode 8-dot braille block (U+2800-U+28FF), represented as an 8-position dot pattern.",
    usage: "No parameters (U+2800 block). Bidirectional encode/decode.",
    examples: [{ in: "AB", param: {}, out: "⡱⡲", desc: "A=⡱, B=⡲, 8-dot braille characters." }],
    formulas: [{ tex: "E(c) = \\text{U+28}\\text{XX}", caption: "Maps into the U+2800-U+28FF 8-dot braille block." }],
    tips: ["Uses the Unicode U+2800 block.", "8 dots (including an upper and lower layer).", "Distinct from standard 6-dot braille."],
    aka: ["8 点盲文", "Braille", "盲文", "braille", "盲文编码", "盲人点字", "点字", "Braille cipher", "布莱叶盲文", "点阵盲文", "Unicode盲文", "六点盲文"]
  },
  eightdiagram: {
    what: "64-hexagram encoding — maps base64 onto the 64 hexagrams.",
    principle: "After base64-encoding the data, each 6 bits maps to one of the 64 hexagram characters (I Ching trigram/hexagram symbols).",
    usage: "No parameters (base64 → 64 hexagrams). Bidirectional encode/decode.",
    examples: [{ in: "AB", param: {}, out: "师解谦", desc: "AB, once base64-encoded, maps to the three hexagrams 师解谦." }],
    formulas: [{ tex: "E(c) = \\text{Hexagram}(\\text{bin}_6(c))", caption: "Each group of 6 bits maps to a hexagram." }],
    tips: ["Based on the 64 hexagrams of the I Ching.", "6 binary bits → 1 hexagram.", "An encoding with a strong cultural flavor."],
    aka: ["六十四卦", "八卦编码", "64卦", "易经编码", "卦象编码", "周易编码", "六十四卦密码", "hexagram", "八卦密码", "I Ching", "易经卦象", "卦爻编码"]
  },
  whitespace: {
    what: "Whitespace encoding — represents binary with space/Tab/newline.",
    principle: "Uses three whitespace characters (space, Tab, newline) to represent binary bits or groups; it looks blank but carries hidden information.",
    usage: "No parameters (space/tab/newline). Bidirectional encode/decode.",
    examples: [{ in: "Hi", param: {}, out: "（由空格/Tab/换行组成的不可见序列）", desc: "Hi is encoded as a sequence of only whitespace characters, invisible to the eye." }],
    formulas: [{ tex: "E(b) \\in \\{\\text{Space}, \\text{Tab}, \\text{LF}\\}", caption: "Binary bits map to three whitespace characters." }],
    tips: ["Three whitespace characters represent binary.", "On the surface it looks like ordinary blank text.", "Requires a dedicated tool to read."],
    aka: ["空白编码", "Whitespace", "whitespace", "空白字符编码", "空格隐写", "Whitespace语言", "隐形编码", "不可见字符编码", "空白隐写", "Tab空格换行", "whitespace stego", "空白密码"]
  },
  pigpen: {
    what: "Pigpen cipher — grid tokens 1A-3H representing letters.",
    principle: "Letters are laid out across a 3-zone grid (1A-3H, 24 cells total), and each cell is written as a zone+cell token.",
    usage: "No parameters (3-zone grid, 1A-3H tokens). Bidirectional encode/decode.",
    examples: [{ in: "ABC", param: {}, out: "1A 1B 1C", desc: "A=1A, B=1B, C=1C, the first three cells of zone 1." }],
    formulas: [{ tex: "E(c) = (\\text{zone}, \\text{cell})", caption: "A letter's zone and cell number in the 3-zone grid." }],
    tips: ["3 zones with 8 cells each, 24 cells total.", "Tokens look like 1A, 2F, 3H.", "Derived from the Masonic pigpen cipher."],
    aka: ["猪圈密码", "Pigpen cipher", "pigpen", "共济会密码", "朱高密码", "栅格密码", "Freemason cipher", "Masonic cipher", "共济会暗号", "猪栏密码", "井字密码", "方格密码"]
  },
  keyboardShift: {
    what: "Keyboard shift — slides keys along the keyboard by a direction.",
    principle: "Slides each key left or right within its QWERTY keyboard row by the shift amount; direction sets which way.",
    usage: "params: shift(default 1), direction(right/left, default right). Bidirectional.",
    examples: [{ in: "hello", param: { shift: 1, direction: "right" }, out: "jraap", desc: "Each key shifts right by 1: h→j, e→r, l→a, l→a, o→p." }],
    formulas: [{ tex: "E(c) = \\text{kbd}[\\text{idx}(c) \\pm \\text{shift}]", caption: "Add/subtract shift to the key index to take the adjacent key." }],
    tips: ["shift controls the amount of movement.", "direction controls left vs. right.", "Only shifts within the same row, never across rows."],
    aka: ["键盘位移", "Keyboard shift", "键盘漂移", "keyboard shift", "键位平移", "键盘偏移", "键盘滑动密码", "keyboard drift", "键盘左右移", "键位偏移密码", "同行键位移", "keyboard offset"]
  },
  malbolge: {
    what: "Malbolge detection — detects printable ASCII text.",
    principle: "Malbolge is a language deliberately designed to be extremely difficult; this op only detects, it does not execute, and outputs recognizable information.",
    usage: "run one-way (detect only, does not execute).",
    examples: [{ in: "可打印ASCII文本", param: {}, out: "识别信息", desc: "Runs Malbolge recognizability detection on the input text." }],
    formulas: [{ tex: "\\text{out} = \\text{detect}(\\text{input})", caption: "Detects a Malbolge program only, without executing it." }],
    tips: ["Detects only, does not execute.", "Malbolge is called the hardest programming language.", "Input must be printable ASCII."],
    aka: ["Malbolge 识别", "玛尔波格", "Malbolge", "malbolge", "地狱语言", "最难编程语言", "但丁地狱语言", "深奥语言Malbolge", "Malbolge识别", "玛尔波各", "esolang", "最难esolang"]
  },
  aaencode: {
    what: "aaencode — kaomoji (emoticon) JavaScript encoding.",
    principle: "Converts JS code into a sequence of kaomoji (emoticons) that a JS engine can still execute.",
    usage: "No parameters (kaomoji JS); input text or numbers.",
    examples: [{ in: "1", param: {}, out: "ﾟωﾟﾉ= /｀ｍ´）ﾉ ~┻━┻   //*´∇｀*/ ['_']; ...", desc: "The number 1 encoded as a kaomoji JS sequence." }],
    formulas: [{ tex: "E(\\text{code}) = \\text{kaomoji}(\\text{JS})", caption: "JS code characters replaced by kaomoji." }],
    tips: ["The output is still valid JS.", "Kaomoji are Japanese-style emoticons.", "A joke encoding in the same family as jjencode."],
    aka: ["颜文字编码", "aaencode", "AAencode", "颜文字JS", "kaomoji编码", "颜文字混淆", "JS颜文字", "aaencode解码", "颜文字加密", "japanese emoticon", "颜文字代码", "JSFuck同类"]
  },
  baudot: {
    what: "Baudot code — a 5-bit telegraph code.",
    principle: "Characters are represented by 5 bits; ITA2 has two character sets — letters and figures (Figure/Letter shift).",
    usage: "params: variant(ita2/ita1, default ita2). Bidirectional encode/decode.",
    examples: [{ in: "HELLO", param: { variant: "ita2" }, out: "10100 00001 10010 10010 11000", desc: "ITA2 Baudot: H=10100, E=00001, L=10010, L=10010, O=11000." }],
    formulas: [{ tex: "E(c) = \\text{bin}_5(c)", caption: "Characters map to 5-bit binary." }],
    tips: ["ITA2 is the international telegraph standard.", "5 bits gives only 32 base codes.", "Needs Figure/Letter shift symbols."],
    aka: ["博多码", "Baudot code", "baudot", "博多电码", "五位电报码", "ITA2", "电传打字码", "Baudot-Murray", "国际电报字母表2", "5位码", "电报五单位码", "telex code"]
  },
  type7: {
    what: "Type7 encoding — a salted letter shift.",
    principle: "Shifts letters using the salt as a key; the salt ranges 0-52.",
    usage: "params: salt(0-52, default 0). Bidirectional encode/decode.",
    examples: [{ in: "test", param: { salt: 0 }, out: "0010161510", desc: "With salt=0, test encodes to 0010161510." }],
    formulas: [{ tex: "E(c, s) = f(\\text{idx}(c), s)", caption: "A function of the letter index and the salt s." }],
    tips: ["salt ranges 0-52.", "The salt is the key.", "Reversible in both directions."],
    aka: ["Type7", "带盐位移", "Cisco Type7", "type7", "Cisco密码", "思科Type7", "Cisco password 7", "思科口令7", "Vigenere变体", "Cisco IOS密码", "type 7", "路由器密码"]
  },
  decabit: {
    what: "Decabit — a 10-bit ternary encoding.",
    principle: "Each character is encoded as a 10-position + / - sequence; asNumber controls whether the numeric form is output.",
    usage: "params: asNumber(default false). Bidirectional encode/decode.",
    examples: [{ in: "AB", param: {}, out: "++-+++---- ++++--+---", desc: "A=++-+++----, B=++++--+---, each 10 bits." }],
    formulas: [{ tex: "E(c) = (b_i)_{i=1}^{10},\\ b_i \\in \\{+, -\\}", caption: "Characters map to a 10-position +/- sequence." }],
    tips: ["Fixed 10 positions per character.", "Used in power-line carrier communication.", "asNumber=true outputs the numeric form."],
    aka: ["Decabit", "十位码", "decabit", "Decabit脉冲码", "十位脉冲码", "电力线载波", "纹波控制", "ripple control", "10位码", "Decabit编码", "电力载波码", "脉冲编码Decabit"]
  },
  scytale: {
    what: "Scytale — transposition by writing around a rod.",
    principle: "Plaintext is written around the rod at a column width, then read off row by row — the ancient Spartan scytale.",
    usage: "params: column(default 2). Bidirectional encode/decode.",
    examples: [{ in: "HELLO", param: { column: 2 }, out: "HLOEL|", desc: "column=2: HLO first, EL after, with | as a trailing placeholder." }],
    formulas: [{ tex: "T = \\text{column}", caption: "The column width sets the transposition period." }],
    tips: ["column sets the rod's circumference.", "Shortfalls are padded with the placeholder |.", "One of the oldest transposition ciphers."],
    aka: ["密码棒", "Scytale", "scytale", "天书密码棒", "斯巴达密码棒", "斯巴达棒", "绕棒密码", "cane cipher", "密码卷轴", "换位密码棒", "Skytale", "古希腊密码棒"]
  },
  keyCode: {
    what: "Key code recognition — converts key codes to characters.",
    principle: "Recognizes the character corresponding to a keyboard keyCode (ASCII / virtual key code).",
    usage: "run one-way.",
    examples: [{ in: "65", param: {}, out: "65 → A", desc: "Key code 65 corresponds to the uppercase letter A." }],
    formulas: [{ tex: "\\text{out} = \\text{char}(\\text{keyCode})", caption: "Key code maps to a character." }],
    tips: ["Input is a key-code number.", "65-90 are A-Z.", "Recognition only, not reversible."],
    aka: ["键码", "KeyCode", "keyCode", "JS keyCode", "键盘键码", "虚拟键码", "keyCode表", "ASCII键码", "键盘代码", "keycode", "JS键码表", "键值码"]
  },
  shiftKey: {
    what: "Shift-key mapping — switches to the upper-register character.",
    principle: "Maps a character to its shifted (upper-register) symbol based on the Shift key state (e.g. 1→!); self-inverse.",
    usage: "No parameters (self-inverse); applying it again restores the original.",
    examples: [{ in: "1", param: {}, out: "!", desc: "The shifted symbol of 1 is !." }],
    formulas: [{ tex: "E(c) = \\text{shift}(c)", caption: "Character maps to its Shift upper-register counterpart." }],
    tips: ["Self-inverse: run it again to restore the original.", "Only works for keys that have an upper-register symbol.", "1→!, 2→@, 3→#..."],
    aka: ["上档键映射", "ShiftKey", "shiftKey", "上档键符号", "Shift键", "上档符号", "shift symbol", "数字符号切换", "键盘上档", "Shift映射", "上档字符", "shift key map"]
  },
  keyword9: {
    what: "keyword9 — four-mode T9 keypad recognition.",
    principle: "Recognizes T9 nine-key keypad input sequences, supporting four modes (multi-tap, word prediction, etc.).",
    usage: "run one-way (T9 four modes).",
    examples: [{ in: "abc", param: {}, out: "T9九宫格模式识别", desc: "Recognizes the T9 keypad input mode corresponding to abc." }],
    formulas: [{ tex: "\\text{out} = \\text{T9}_\\text{mode}(\\text{input})", caption: "Four-mode T9 keypad recognition." }],
    tips: ["Supports four recognition modes.", "2=abc, 3=def, 4=ghi...", "Old-style mobile phone input method."],
    aka: ["T9 九宫格", "keyword9", "T9九宫格", "九宫格识别", "T9识别", "手机九宫格", "T9 keyboard", "九宫格输入", "老年机输入", "T9 predictive", "九宫格密码", "手机键盘九宫格"]
  },
  keyboardSurround: {
    what: "Keyboard surrounding-key recognition — finds a key's neighbor set.",
    principle: "Finds the set of neighboring keys around a given key (up, down, left, right, and diagonals) on a QWERTY keyboard.",
    usage: "run one-way.",
    examples: [{ in: "q", param: {}, out: "识别: 包围键集合 结果: 1", desc: "Recognition result for the surrounding-key set of q." }],
    formulas: [{ tex: "\\text{out} = \\text{neighbors}(c)", caption: "The keyboard neighbor set of key c." }],
    tips: ["Considers eight-direction neighbors.", "Edge keys have fewer neighbors.", "Recognition only, not reversible."],
    aka: ["键盘包围键", "KeyboardSurround", "keyboardSurround", "键盘邻居键", "键盘周围键", "包围键", "键盘环绕", "邻键集合", "keyboard neighbors", "键盘八方向", "周围键识别", "键位邻居"]
  },
  qweAbc: {
    what: "qweAbc — multi-layout letter-mapping recognition.",
    principle: "Recognizes letter-position mappings across three keyboard layouts: qwerty/qwertz/azerty.",
    usage: "run one-way.",
    examples: [{ in: "abc", param: {}, out: "qwerty:kxv qwertz:kxv azerty:axv", desc: "The position mapping of abc under the three keyboard layouts." }],
    formulas: [{ tex: "\\text{out} = \\bigcup_{L} L(c)", caption: "The coordinates of letter c under multiple layouts L." }],
    tips: ["Covers qwerty/qwertz/azerty.", "Outputs coordinates for each layout.", "Recognition only, not reversible."],
    aka: ["多键盘映射", "qweAbc", "QWERTY转ABC", "qwe转abc", "键盘布局映射", "qwerty abc", "多布局映射", "qwertz azerty", "键盘位置识别", "qweabc", "布局字母映射", "键盘布局对应"]
  },
  layoutMap: {
    what: "Layout map — converts characters by keyboard layout.",
    principle: "Remaps QWERTY characters to the physical key positions of a target layout (dvorak/colemak).",
    usage: "params: layout(dvorak/colemak, default dvorak). Bidirectional encode/decode.",
    examples: [{ in: "hello", param: { layout: "dvorak" }, out: "d.nnr", desc: "hello maps to d.nnr under the dvorak key positions." }],
    formulas: [{ tex: "E(c) = \\text{layout}[\\text{qwerty}[c]]", caption: "The character at the corresponding key position in the target layout." }],
    tips: ["Supports dvorak/colemak.", "Keeps the physical key position, swaps the character.", "Useful for keyboard-layout learners."],
    aka: ["布局映射", "LayoutMap", "layoutMap", "键盘布局映射", "Dvorak", "Colemak", "德沃夏克布局", "键盘布局转换", "layout map", "布局重映射", "Dvorak Colemak", "键位布局转换"]
  },
  t9Phone: {
    what: "T9 phone encoding — letters to key number + press position.",
    principle: "a=21, b=22, c=23… each letter is encoded as two digits: the tens digit is the key number, the units digit is its press position on that key.",
    usage: "No parameters (a=21...z=94). Bidirectional encode/decode.",
    examples: [{ in: "ABC", param: {}, out: "212223", desc: "A=21, B=22, C=23 (the 1st/2nd/3rd position on the 2 key)." }],
    formulas: [{ tex: "E(c) = 10 \\cdot \\text{key}(c) + \\text{pos}(c)", caption: "Key number ×10 + press position." }],
    tips: ["a=21 ... z=94.", "2=abc, 3=def, 4=ghi, 5=jkl, 6=mno, 7=pqrs, 8=tuv, 9=wxyz.", "Distinct from multitap."],
    aka: ["T9 手机码", "t9Phone", "手机九宫格T9", "T9电话编码", "手机键盘编码", "电话九宫格", "phone keypad", "T9 phone", "手机数字键编码", "九宫格数字码", "键号位序编码", "T9手机键盘"]
  },
  multitap: {
    what: "Multitap encoding — number of key presses represents a letter.",
    principle: "2=a, 22=b, 222=c; the press count corresponds to the letter's order on the key, separated by spaces.",
    usage: "No parameters (2=a 22=b 222=c). Bidirectional encode/decode.",
    examples: [{ in: "ABC", param: {}, out: "2 22 222", desc: "A=2, B=22, C=222 (pressing the 2 key 1/2/3 times)." }],
    formulas: [{ tex: "E(c) = \\text{key}(c)^{\\text{pos}(c)}", caption: "The key number repeated pos times." }],
    tips: ["Old-style mobile phone input method.", "Press count = the letter's position on the key.", "Letters must be separated to avoid ambiguity."],
    aka: ["多击输入", "Multitap"]
  },
  kbdFullCoord: {
    what: "Full keyboard coordinates — R.C format including the number row.",
    principle: "A full 4-row keyboard layout (including the number row); each key maps to a row.column (R.C) coordinate.",
    usage: "No parameters (R.C format, includes number row). Bidirectional encode/decode.",
    examples: [{ in: "AB", param: {}, out: "3.1 4.5", desc: "A = row 3, col 1 = 3.1; B = row 4, col 5 = 4.5 (including the number row)." }],
    formulas: [{ tex: "E(c) = (\\text{row}.\\text{col})", caption: "The key's row/column coordinate on the number-row-inclusive keyboard." }],
    tips: ["4 rows total, including the number row.", "Format is row.column.", "Distinct from the 3-row keyboard op."],
    aka: ["键盘全坐标", "KbdFullCoord"]
  },
  stenoLetter: {
    what: "Steno letters — Plover chord representation.",
    principle: "Based on the Plover steno keyboard chords, each letter maps to a stenotype key chord combination.",
    usage: "No parameters (Plover chords). Bidirectional encode/decode.",
    examples: [{ in: "ABC", param: {}, out: "A PW KR", desc: "A=A chord, B=PW chord, C=KR chord." }],
    formulas: [{ tex: "E(c) = \\text{chord}(c)", caption: "Letters map to Plover steno chords." }],
    tips: ["Based on the Plover steno system.", "A chord is multiple keys pressed at once.", "Used for stenotype machine input."],
    aka: ["速记和弦", "StenoLetter", "stenoLetter", "Steno速记字母", "Plover速记", "速记字母", "速录和弦", "steno chord", "速记键盘", "Plover chord", "速录机编码", "钢速记"]
  },
  arrowKey: {
    what: "Arrow-key encoding — converts WASD to arrow symbols.",
    principle: "Maps W/A/S/D (or U/D/L/R, or numbers) to the corresponding direction arrows ↑↓←→.",
    usage: "params: scheme(wasd/udlr/numeric, default wasd). Bidirectional encode/decode.",
    examples: [{ in: "WASD", param: { scheme: "wasd" }, out: "↑←↓→", desc: "W=↑, A=←, S=↓, D=→." }],
    formulas: [{ tex: "E(c) = \\text{arrow}(\\text{dir}(c))", caption: "Direction characters map to arrow symbols." }],
    tips: ["Supports three schemes: wasd/udlr/numeric.", "W=↑, A=←, S=↓, D=→.", "Common in game controls."],
    aka: ["方向键", "ArrowKey", "arrowKey", "方向键编码", "WASD编码", "箭头编码", "上下左右", "arrow key", "方向箭头", "WASD转箭头", "方向符号编码", "UDLR编码"]
  },
  americanMorse: {
    what: "American Morse code — the 19th-century landline telegraph code.",
    principle: "Early American Morse code uses three elements — dot, dash, and long dash (_) — differing from International Morse.",
    usage: "No parameters (19th-century landline telegraph, includes long dash _). Bidirectional encode/decode.",
    examples: [{ in: "HELLO", param: {}, out: ".... / . / _ / _ / . .", desc: "American Morse: H=...., E=., L=_, L=_, O=.. " }],
    formulas: [{ tex: "\\text{Morse}_{US}(c) \\in \\{\\cdot, -, \\_\\}^{+}", caption: "Contains three elements: dot, dash, and long dash." }],
    tips: ["Contains the long-dash _ element.", "Distinct from International Morse.", "Used on 19th-century American landline telegraph."],
    aka: ["美式摩尔斯", "American Morse", "美式摩斯码", "American Morse code", "美国摩尔斯", "大陆电报码", "Railroad Morse", "铁路摩尔斯", "美式电码", "Morse landline", "含长划摩尔斯", "美式莫尔斯"]
  },
  cnTelegraphMorse: {
    what: "Chinese telegraph Morse — 4-digit Chinese telegraph codes converted to Morse.",
    principle: "Each Chinese character corresponds to a 4-digit numeric telegraph code, and the digits are then converted to Morse code.",
    usage: "No parameters (4-digit Chinese telegraph codes). Bidirectional encode/decode.",
    examples: [{ in: "1234", param: {}, out: ".---- ..--- ...-- ....-", desc: "The Morse code for each of the digits 1-4." }],
    formulas: [{ tex: "E(c) = \\text{Morse}(\\text{telegraph}_4(c))", caption: "Chinese telegraph 4-digit code, then converted to Morse." }],
    tips: ["Chinese telegraph codes are 4 digits.", "Morse is then taken of the digits.", "Introduced to China by a Dane in 1871."],
    aka: ["中文电报摩尔斯", "CN Telegraph Morse", "中文电码摩尔斯", "中文电码", "汉字电报码", "中文商用电码", "Chinese telegraph code", "四位电码", "标准电码本", "汉字四码", "中文电报", "电码摩斯"]
  },
  tapCode: {
    what: "Tap code — 5x5 Polybius-square row/column taps (the merge parameter chooses I/J merge or K→C merge).",
    principle: "The 5x5 square merges one cell: by default I/J share a cell (including K), or K→C share a cell (including J), with letters represented by row/column tap counts.",
    usage: "merge parameter: ij(default, I/J merged) | kc(K→C merged). Bidirectional encode/decode.",
    examples: [{ in: "HELLO", param: { merge: "ij" }, out: "23 15 31 31 34", desc: "H=23, E=15, L=31, L=31, O=34 (I/J merged)." }],
    formulas: [{ tex: "E(c) = (r, k),\\ r,k \\in [1,5]", caption: "A letter's row/column coordinate in the 5x5 square." }],
    tips: ["I/J or K/C share one cell (depending on merge).", "Row and column are both 1-5.", "Originated from POW wall-tapping communication."],
    aka: ["敲击码", "TapCode", "Tap code", "监狱密码", "tapcode", "敲墙码", "敲击密码", "Knock code", "波利比奥斯敲击", "战俘密码", "Polybius tap", "5x5敲击码"]
  },
  semaphore: {
    what: "Semaphore encoding — two flags in 8 directions represent letters.",
    principle: "Each hand holds a flag, and combinations of 8 directions represent letters, described by two directions (e.g. Down+UpRight).",
    usage: "No parameters (8-direction two-flag). Bidirectional encode/decode.",
    examples: [{ in: "ABC", param: {}, out: "Down+UpRight Down+Right Down+DownRight", desc: "A=Down+UpRight, B=Down+Right, C=Down+DownRight." }],
    formulas: [{ tex: "E(c) = (d_1, d_2),\\ d_i \\in \\text{8 dir}", caption: "A combination of each flag's 8 directions." }],
    tips: ["8 directions: Up/Down/Left/Right and diagonals.", "Two-flag combinations represent letters.", "A traditional method of maritime communication."],
    aka: ["旗语", "Semaphore", "semaphore", "旗语编码", "旗语密码", "信号旗语", "flag semaphore", "手旗语", "航海旗语", "Semaphore flag", "双旗信号", "海军旗语"]
  },
  dtmf: {
    what: "DTMF (dual-tone multi-frequency) — row/column frequency-pair recognition.",
    principle: "Each key on a phone keypad is represented by two frequencies (a row frequency + a column frequency), e.g. 1=697Hz+1209Hz.",
    usage: "run one-way (row/column frequency pair).",
    examples: [{ in: "1", param: {}, out: "1 → 697 Hz + 1209 Hz", desc: "Key 1 is synthesized from 697Hz (row) and 1209Hz (column)." }],
    formulas: [{ tex: "f = f_{\\text{row}} + f_{\\text{col}}", caption: "Two overlaid frequencies identify the pressed key." }],
    tips: ["Row frequencies: 697/770/852/941 Hz.", "Column frequencies: 1209/1336/1477/1633 Hz.", "The principle behind telephone dial tones."],
    aka: ["双音多频", "DTMF", "dtmf", "DTMF双音多频", "电话拨号音", "Touch-Tone", "双音多频信号", "拨号音", "dual tone multi frequency", "按键音", "电话音识别", "DTMF频率"]
  },
  morseRhythm: {
    what: "Morse rhythm — normalized conversion between ·− and .-",
    principle: "Bidirectionally normalizes between ·− (bullet/em-dash) and .- (dot/hyphen) notations.",
    usage: "Bidirectional (·−↔.- normalization).",
    examples: [{ in: ".- .- -", param: {}, out: ".- .- -（encode） / ·− ·− −（decode）", desc: "Encode keeps the .- form; decode converts to ·−." }],
    formulas: [{ tex: "\\cdot \\leftrightarrow .,\\ - \\leftrightarrow -", caption: "Conversion between the two symbol systems." }],
    tips: ["encode: outputs the .- form.", "decode: outputs the ·− form.", "Symbol normalization only."],
    aka: ["摩尔斯节奏", "MorseRhythm", "morseRhythm", "摩斯节奏规范化", "摩尔斯符号规范化", "摩斯符号转换", "morse rhythm", "点划规范化", "摩斯格式化", "摩尔斯归一化", "Morse normalize", "摩斯节奏"]
  },
  manchester: {
    what: "Manchester encoding — each bit represented by a transition.",
    principle: "A transition occurs mid-bit-period: under the IEEE convention, 0 is low→high and 1 is high→low (Thomas is the opposite).",
    usage: "params: inputFormat(auto/text/bits), convention(ieee/thomas, default ieee). Bidirectional.",
    examples: [{ in: "A", param: { inputFormat: "auto", convention: "ieee" }, out: "1001101010101001", desc: "A=01000001, IEEE Manchester uses 2 levels per bit." }],
    formulas: [{ tex: "E(b) = \\begin{cases} 10 & b=1\\ (\\text{IEEE}) \\\\ 01 & b=0\\ (\\text{IEEE}) \\end{cases}", caption: "Each bit maps to a half-bit transition." }],
    tips: ["IEEE: 1→10, 0→01.", "Thomas: 1→01, 0→10.", "Every bit has a mid-period transition."],
    aka: ["曼彻斯特码", "Manchester", "manchester", "曼彻斯特编码", "Manchester encoding", "曼码", "曼彻斯特线路码", "曼彻斯特调制", "Manchester code", "相位编码", "以太网曼码", "IEEE曼彻斯特"]
  },
  diffManchester: {
    what: "Differential Manchester encoding — a transition represents 0.",
    principle: "A transition at the start of a bit means 0, no transition means 1, and there is always a mid-bit transition; initialLevel sets the starting point.",
    usage: "params: inputFormat, initialLevel(0/1, default 0). Bidirectional.",
    examples: [{ in: "A", param: { inputFormat: "auto", initialLevel: 0 }, out: "1001010101010110", desc: "A=01000001, differential Manchester with initialLevel=0." }],
    formulas: [{ tex: "E(b) = \\begin{cases} \\text{跳变} & b=0 \\\\ \\text{不跳变} & b=1 \\end{cases}", caption: "A transition-or-not at the bit start distinguishes 0/1." }],
    tips: ["Transition at bit start = 0, no transition = 1.", "There's always a mid-bit transition (clock).", "initialLevel sets the starting level."],
    aka: ["差分曼彻斯特", "Diff Manchester", "diffManchester", "差分曼彻斯特编码", "Differential Manchester", "差分曼码", "差分曼彻斯特码", "DM编码", "差分相位编码", "differential manchester encoding", "令牌环编码", "差曼码"]
  },
  nrzi: {
    what: "NRZI — Non-Return-to-Zero Inverted encoding.",
    principle: "On a 1 the level flips, on a 0 the level holds; convention sets the flip rule and initialLevel sets the starting point.",
    usage: "params: inputFormat, convention(usb/classic, default usb), initialLevel. Bidirectional.",
    examples: [{ in: "A", param: { inputFormat: "auto", convention: "usb", initialLevel: 0 }, out: "11010100", desc: "A=01000001, USB-convention NRZI, initial 0." }],
    formulas: [{ tex: "E(b) = \\begin{cases} \\text{翻转} & b=1 \\\\ \\text{保持} & b=0 \\end{cases}", caption: "1 flips, 0 holds." }],
    tips: ["USB: 1 flips, 0 holds.", "The Classic convention is the opposite.", "initialLevel sets the starting level."],
    aka: ["NRZI", "不归零反转", "nrzi", "NRZI编码", "Non-Return-to-Zero Inverted", "不归零翻转", "反向不归零", "NRZ-I", "USB编码", "反转不归零码", "NRZI line code", "不归零倒置"]
  },
  miller: {
    what: "Miller encoding — delay encoding.",
    principle: "A 1 transitions mid-bit, a 0 does not transition mid-bit, and consecutive 0s transition at the bit boundary; initialLevel sets the starting point.",
    usage: "params: inputFormat, initialLevel(default 0). Bidirectional.",
    examples: [{ in: "A", param: { inputFormat: "auto", initialLevel: 0 }, out: "0001110011001110", desc: "A=01000001, Miller code with initialLevel=0." }],
    formulas: [{ tex: "E(b) = \\begin{cases} \\text{中间跳变} & b=1 \\\\ \\text{中间不跳变} & b=0 \\end{cases}", caption: "1 transitions mid-bit; 0 depends on the previous bit to decide a boundary transition." }],
    tips: ["1 transitions mid-bit.", "Consecutive 0s transition at the boundary.", "Relatively bandwidth-efficient."],
    aka: ["Miller 码", "延迟编码", "miller", "密勒码", "Miller code", "Miller编码", "Delay encoding", "密勒编码", "MFM相关", "延迟调制", "Miller cipher", "密勒延迟码"]
  },
  fourB5B: {
    what: "4B/5B encoding — maps 4 bits to 5 bits.",
    principle: "Each 4 bits of data maps to a 5-bit codeword, ensuring enough transitions for clock recovery.",
    usage: "params: inputFormat. Bidirectional encode/decode.",
    examples: [{ in: "A", param: { inputFormat: "auto" }, out: "0101001001", desc: "A=01000001, each 4-bit group maps to 5 bits." }],
    formulas: [{ tex: "E(b_4) = \\text{table}(b_4) \\in \\{0,1\\}^5", caption: "4 bits of data look up a table to get 5 bits." }],
    tips: ["4 bits → 5 bits via table lookup.", "Guarantees codewords contain enough transitions.", "Used in 100-Mbit Ethernet."],
    aka: ["4B/5B", "四位五位码", "fourB5B", "4B5B编码", "4B/5B编码", "4B5B", "四比特五比特", "block coding", "百兆以太网编码", "4b5b line code", "四位映射五位", "FDDI编码"]
  },
  pwmPpm: {
    what: "PWM/PPM modulation encoding.",
    principle: "PWM (pulse-width modulation) represents bits by pulse width, PPM (pulse-position modulation) represents bits by pulse position; mode switches between them.",
    usage: "params: inputFormat, mode(pwm/ppm, default pwm). Bidirectional.",
    examples: [{ in: "A", param: { inputFormat: "auto", mode: "pwm" }, out: "101101010101010110", desc: "A=01000001, PWM-mode pulse-width encoding." }],
    formulas: [{ tex: "E(b) = \\begin{cases} \\text{宽脉冲/窄脉冲} & \\text{PWM} \\\\ \\text{脉冲位置} & \\text{PPM} \\end{cases}", caption: "PWM modulates width, PPM modulates position." }],
    tips: ["PWM: 1 wide pulse, 0 narrow pulse.", "PPM: pulse position represents the bit.", "mode switches between the two modulations."],
    aka: ["脉宽/脉位调制", "PWM/PPM", "pwmPpm", "PWM", "PPM", "脉宽调制", "脉位调制", "pulse width modulation", "pulse position modulation", "脉冲宽度调制", "脉冲位置调制", "PWM PPM编码"]
  },
  musicNotation: {
    what: "Music notation conversion — converts between note name / MIDI / jianpu / solfege.",
    principle: "Converts among multiple music notations (note/midi/jianpu/solfeggio); key sets the key signature and preferFlat prefers flats.",
    usage: "params: from(auto/note/midi/jianpu/solfeggio, default auto), to(same, default midi), key(default C), preferFlat(default false). Bidirectional.",
    examples: [{ in: "C4", param: { from: "auto", to: "midi", key: "C", preferFlat: false }, out: "60", desc: "Note name C4 converts to MIDI number 60." }],
    formulas: [{ tex: "\\text{MIDI}(n) = 12(\\text{oct}+1) + \\text{pc}(n)", caption: "MIDI = 12×(octave+1) + pitch class." }],
    tips: ["C4 = MIDI 60.", "Middle C is C4.", "preferFlat prefers flat-based notation."],
    aka: ["乐谱转换", "MusicNotation", "musicNotation", "音乐记号互转", "乐谱记法", "音名MIDI转换", "简谱唱名", "music notation", "音名转MIDI", "唱名转换", "十二平均律记法", "音符记法转换"]
  },
  musicInfo: {
    what: "Note information lookup — outputs note name / MIDI / jianpu / solfege / frequency.",
    principle: "For a given note, outputs its multi-dimensional info: note name, MIDI number, jianpu, solfege, and frequency (based on 12-tone equal temperament).",
    usage: "run one-way, params: key, preferFlat.",
    examples: [{ in: "60", param: { key: "C", preferFlat: false }, out: "输入类型: midi 音名: C4 MIDI: 60 简谱: 1 唱名: do 频率: 261.63Hz", desc: "All music-theory information for MIDI 60." }],
    formulas: [{ tex: "f = 440 \\cdot 2^{(n-69)/12}", caption: "MIDI number n corresponds to a frequency (A4=69=440Hz)." }],
    tips: ["A4=440Hz is the reference.", "MIDI 60 = C4 = 1 (do) = 261.63Hz.", "Outputs multiple dimensions of info at once."],
    aka: ["音符信息", "MusicInfo", "musicInfo", "音符全息信息", "音符频率查询", "音名频率", "note info", "音高信息", "MIDI音符信息", "音符属性", "乐理信息查询", "音符频率计算"]
  },
  fracmorse: {
    what: "Fractionated Morse cipher — uses Morse length patterns for a keyed substitution.",
    principle: "Uses Morse-code length patterns as elements, encrypting via a substitution defined by the key alphabet.",
    usage: "params: key(26-letter alphabet, default ROUNDTABLECFGHIJKMPQSVWXYZ). Bidirectional encode/decode.",
    examples: [{ in: "HELLO", param: { key: "ROUNDTABLECFGHIJKMPQSVWXYZ" }, out: "RAQUNBI", desc: "HELLO becomes RAQUNBI via fractionated-Morse substitution." }],
    formulas: [{ tex: "E(c) = \\pi_{\\text{key}}(\\text{morse-pattern}(c))", caption: "Encrypts via the permutation π defined by the key." }],
    tips: ["key is a 26-letter permutation.", "Default key: ROUNDTABLECFGHIJKMPQSVWXYZ.", "Combines Morse code with a fractionated substitution."],
    aka: ["分式摩尔斯", "Fractional Morse", "fracmorse", "分数摩斯", "分式摩尔斯密码", "Fractionated Morse", "分组摩尔斯", "分数摩尔斯", "fractionated morse cipher", "摩斯置换密码", "分式摩斯码", "摩尔斯分数密码"]
  }
};
