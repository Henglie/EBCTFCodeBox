/*
 * edu-classic-new.en.js — English edu shard (classic new ops).
 *
 * Covers 5 ops:
 * classic: routeCipher, rotSpecial, chaocipher, straddleCheckerboard
 * text: fullwidth
 *
 * Pure data, no side effects, no import, no register. Merged in eduContent.js.
 * EduEntry format follows the eduContent.js header contract.
 */
export default {
 // ============ classic: Route Cipher ============
  routeCipher: {
    what: "Route Cipher — fill the plaintext into a matrix row by row, then read it out column by column along a snake or vertical route. A transposition cipher that reorders characters without changing them.",
    principle:
      "The plaintext fills a matrix of cols columns row by row (grid[r][c] = text[r*cols + c]), then it is read out by column. Two routes:\n\n" +
      "snake (vertical boustrophedon, default, most common in CTF): even columns (columns 1, 3, 5…, indices 0, 2, 4…) are read top to bottom, odd columns bottom to top, folding back and forth column by column (boustrophedon).\n\n" +
      "vertical: all columns are read uniformly top to bottom.\n\n" +
      "To decode, split the ciphertext back into columns using the same column count and route, then reassemble by row to get the original. All characters are preserved (including spaces, punctuation, Chinese), guaranteeing 100% encode→decode recovery.",
    usage: "Enter text in the input box, set cols to the number of columns (default 5), and route to the route (snake / vertical). Encoding keeps the characters and only reorders them; decoding with the same cols and route restores the original.",
    examples: [
      { in: "HELLO", param: "cols=3, route=snake", out: "HLOEL", desc: "3 columns snake: H L row + E O read backward + L" },
      { in: "HELLO", param: "cols=3, route=vertical", out: "HLEOL", desc: "3 columns vertical: col0 HL + col1 EO + col2 L" },
    ],
    tips: [
      "In CTF, ciphertext whose characters are unchanged but reordered, with hints of 'matrix', 'column', or 'route' → think Route Cipher.",
      "snake is the most common route; the column count cols is the key parameter and needs enumeration.",
      "With a single column (cols=1) the read order equals the original, so there's no encryption effect.",
    ],
    aka: ["route cipher", "曲路密码", "蛇形密码", "boustrophedon", "路由密码", "route transposition", "路线密码", "矩阵置换", "蛇形读取", "垂直路由", "route cipher decode", "曲路换位"],
  },

 // ============ classic: ROT arbitrary shift ============
  rotSpecial: {
    what: "ROT arbitrary shift — a generalization of ROT13 that lets you specify any shift amount N and rotate cyclically over a chosen alphabet.",
    principle:
      "Shift by (idx + shift) mod n within a cyclic table of length n; decode simply reverses with -shift. Three alphabets:\n\n" +
      "letters (default): uppercase shifts within A-Z(26), lowercase within a-z(26), digits and symbols pass through. N=13 is classic ROT13.\n\n" +
      "alnum: additionally shifts digits within 0-9(10) (analogous to rot18 = rot13 + rot5); letters and digits cycle independently.\n\n" +
      "ascii94: shifts within all printable ASCII 0x21..0x7E(94) (an arbitrary-shift version of rot47); other characters pass through.",
    usage: "Enter text in the input box, set shift to the shift amount (default 13) and alphabet to the alphabet (letters / alnum / ascii94). Encoding shifts forward, decoding shifts back automatically.",
    examples: [
      { in: "ABC", param: "shift=13, alphabet=letters", out: "NOP", desc: "Classic ROT13 shift" },
      { in: "abc123", param: "shift=1, alphabet=alnum", out: "bcd234", desc: "Letters and digits each +1" },
      { in: "abc", param: "shift=47, alphabet=ascii94", out: "234", desc: "Shift 47 within the full 94-char ASCII table (i.e. rot47, a→2 b→3 c→4)" },
    ],
    tips: [
      "When the shift amount is unknown, enumerate 1-25 (letters mode) and eyeball which one reads as English.",
      "ascii94 + shift=47 is ROT47, ideal for ciphertext containing digits and symbols.",
      "alnum mode processes letters and digits together, suited to ciphertext where digits also change.",
    ],
    aka: ["rot n", "rot任意位移", "caesar shift", "凯撒位移泛化", "rotN", "rot-n", "任意位移", "自定义位移", "rot任意", "shift cipher", "ROT13泛化", "任意ROT"],
  },

 // ============ text: Fullwidth ============
  fullwidth: {
    what: "Fullwidth cipher — converts between halfwidth printable ASCII and fullwidth characters. The ciphertext looks like a run of fullwidth symbols but is essentially ASCII.",
    principle:
      "Halfwidth printable ASCII (0x21-0x7E) plus offset 0xFEE0 gives the fullwidth form (0xFF01-0xFF5E). The halfwidth space 0x20 maps specially to the fullwidth space 0x3000. Other characters (including Chinese and already-fullwidth characters) pass through unchanged.\n\n" +
      "The mapping is one-to-one and strictly reversible. Equivalent to the common 'fullwidth/halfwidth conversion'.",
    usage: "Enter halfwidth text and click encode to get a fullwidth string; enter a fullwidth string and click decode to restore halfwidth. Characters outside the ASCII printable range pass through unchanged.",
    examples: [
      { in: "Hi", out: "Ｈｉ", desc: "H(0x48)→Ｈ(0xFF28), i(0x69)→ｉ(0xFF69)" },
      { in: "A B", out: "Ａ　Ｂ", desc: "space 0x20 → fullwidth space 0x3000" },
    ],
    tips: [
      "In CTF, a run of 'fullwidth English/digits' is this — the visual signature is obvious: wide spacing, fat characters.",
      "The fullwidth space 0x3000 is much wider than a normal space, a recognition signal.",
      "Unlike the Base family, this isn't an encoding but a character-form transformation, with no compression.",
    ],
    aka: ["fullwidth", "全角", "半角全角互转", "全角密码", "全角字符", "全半角转换", "全角编码", "fullwidth encode", "full-width", "全宽字符", "全角转半角", "半角转全角"],
  },

 // ============ classic: Chaocipher ============
  chaocipher: {
    what: "Chaocipher — a two-rotor permutation cipher invented by John Byrne in 1918 whose algorithm was only revealed in 2010. Two letter disks (left = ciphertext disk, right = plaintext disk) are dynamically permuted by zenith/nadir rules after each character, making the cipher nonlinear.",
    principle:
      "Core mechanism: two disks each holding 26 distinct letters (the left disk outputs ciphertext, the right disk takes plaintext).\n" +
      "1. Find the plaintext letter p on the right disk, note its position pn\n" +
      "2. Take the letter at the same position pn on the left disk as the ciphertext c\n" +
      "3. Apply the zenith permutation to both disks: split each disk into two halves centered on pn and swap them\n" +
      "4. Apply the nadir permutation to both disks: after zenith, do a similar swap centered on the nadir position (the opposite side of the disk)\n\n" +
      "Both disks change after every character, so the same plaintext letter encrypts to different ciphertext letters at different positions — this is the key difference from traditional polyalphabetic substitution (Vigenère).\n\n" +
      "The default disks are the alphabet from Byrne's official exhibit (STD_LEFT/STD_RIGHT), customizable. Only A-Z are processed.",
    usage: "Enter the left and right disks (default: official exhibit alphabet), enter plaintext (A-Z) and click encode to get ciphertext, or enter ciphertext and click decode to restore. Non-letters pass through unchanged.",
    examples: [
      { in: "WELLDONEISBETTERTHANWELSAID", param: "default disks", out: "OAHQHCNYNXTSZJRRHJBYHQKNEDC", desc: "Result with Byrne's official exhibit disks (verified by running)" },
    ],
    formulas: [
      { tex: "c_i = \\text{left}[\\text{pos}_i],\\ \\text{盘}_{i+1} = \\text{zenith/nadir}(\\text{盘}_i)", caption: "Both disks are dynamically permuted each step, making the cipher nonlinear" },
    ],
    tips: [
      "Chaocipher stayed silent for 90 years before its algorithm was revealed, a famous puzzle in cipher history",
      "Signature: the same plaintext letter encrypts to different ciphertext letters at different positions, defeating frequency analysis",
      "The default disks are Byrne's official exhibit alphabet (HXUCZVAMDSLKPEFJRIGTWOBNYQ / PTLNBQDEOYSFAVZKGJRIHWXUMC); changing the disks is changing the key",
      "When Chaocipher appears in CTF, the initial disk arrangement or a hint is usually provided",
    ],
    aka: ["chaocipher", "混沌密码", "双转子", "byrne cipher", "混沌密码机", "拜恩密码", "chao cipher", "双转子密码", "动态置换密码", "Byrne cipher", "查奥密码", "自动置换密码"],
  },

 // ============ classic: Straddling checkerboard ============
  straddleCheckerboard: {
    what: "Straddling checkerboard — a variable-length encoding board: 8 high-frequency letters take single digits, the rest take two digits, self-delimiting so it decodes without separators.",
    principle:
      "A 3-row × 10-column board:\n" +
      "- First row: 8 high-frequency letters (e.g. ATONESIR) + 2 empty-column prefix positions (e.g. 2, 6)\n" +
      "- Second row: introduced by prefix 2, filled with 10 letters (B C D F G H J K L M)\n" +
      "- Third row: introduced by prefix 6, filled with 10 letters (P Q U V W X Y Z . / ,)\n\n" +
      "Encoding rules:\n" +
      "- First-row letters → single digit (column number 0-9, skipping the empty-column prefix positions)\n" +
      "- Second-row letters → prefix 2 + column number (e.g. B → 20)\n" +
      "- Third-row letters → prefix 6 + column number (e.g. P → 60)\n\n" +
      "When decoding, a 2 or 6 signals that the next digit is an in-row column number; other digits are first-row letters directly — self-delimiting without separators.\n\n" +
      "Variable-length encoding makes high-frequency letters shorter (1 digit) and low-frequency ones longer (2 digits), overall more compact than fixed length — similar in spirit to Huffman coding.",
    usage: "Enter the first-row high-frequency letters (default ATONESIR), empty-column prefixes (default 2/6), and the two lower rows (default 20 characters), enter plaintext and click encode to get a digit string, or enter a digit string and click decode to restore.",
    examples: [
      { in: "ATTACKATDAWN", param: "default board ATONESIR/26", out: "0110212701220644", desc: "Classic Wikipedia vector: A→0, T→1, T→1, A→0, C→21, K→27, A→0, T→1, D→22, A→0, W→60, N→4" },
    ],
    formulas: [
      { tex: "\\text{首行字母} \\to \\text{col},\\ \\text{其他} \\to \\text{prefix} + \\text{col}", caption: "Variable-length encoding: high-frequency single digit, low-frequency two digits" },
    ],
    tips: [
      "The straddling checkerboard is a classic of espionage cryptography, used by several intelligence agencies during WWII",
      "Variable-length encoding is like Huffman: high-frequency letters short, low-frequency long, overall more compact",
      "Self-delimiting property: a prefix digit (2/6) signals the next digit is a column number, so no separators are needed",
      "It can be combined with a one-time pad (OTP): checkerboard-encode first, then OTP-encrypt — the ultimate spy cipher",
      "In CTF, a digit string + a hint about the board configuration is the straddling checkerboard",
    ],
    aka: ["straddling checkerboard", "跨界棋盘", "变长棋盘", "straddle", "跨立棋盘", "间谍棋盘", "straddle checkerboard", "变长编码棋盘", "棋盘密码", "跨界棋盘密码", "spy checkerboard", "VIC密码棋盘"],
  },
};
