/*
 * edu-classic-rest.en.js — English edu shard, classic cipher completion.
 *
 * Covers 11 classic ops:
 * vigenere / hill / affine / bifid / polybius / adfgvx
 * otp / multiplicative / keywordcipher / simplesub / runningkey
 *
 * Pure data export, no import / no side effects / no register.
 */
export default {
  vigenere: {
    what: "Vigenère Cipher, the classic representative of polyalphabetic substitution ciphers. It appeared in the 16th century and was for three hundred years considered unbreakable (le chiffre indéchiffrable).",
    principle: "It uses a letter key, cyclically extended to the length of the plaintext. Each plaintext letter is added mod 26 to the matching key letter to get the ciphertext; decryption subtracts mod 26. Because the same plaintext letter maps to different key letters at different positions, frequency analysis is effectively broken up.",
    usage: "Enter plaintext and a key (default key), and it cycles the key and adds/subtracts mod 26 automatically. Case is preserved, non-letters pass through unchanged.",
    examples: [
      { in: "HELLO", param: { key: "KEY" }, out: "RIJVS", desc: "H+K=R, E+E=I, L+Y=J, L+K=R→corrected to (11+10)%26=21=V, O+E=S" },
      { in: "RIJVS", param: { key: "KEY" }, out: "HELLO", desc: "Decryption is the inverse of encryption" }
    ],
    formulas: [
      { tex: "C_i = (P_i + K_{i \\bmod m}) \\bmod 26", caption: "Encrypt: plaintext letter + key letter mod 26" },
      { tex: "P_i = (C_i - K_{i \\bmod m} + 26) \\bmod 26", caption: "Decrypt: ciphertext letter - key letter mod 26" }
    ],
    tips: [
      "The longer the key the more secure; when the key length equals the plaintext length it degenerates into a one-time pad (OTP)",
      "The Kasiski test and index of coincidence can recover the key length, then per-column frequency analysis follows",
      "Case is preserved; non-letters pass through without consuming the keystream"
    ],
    aka: ["Vigenère", "维吉尼亚", "多表替换", "le chiffre indéchiffrable", "Vigenere", "维吉尼亚密码",
      "维热纳尔", "polyalphabetic", "多表代换", "Vigenere cipher", "维吉尼亚加密", "不可破译密码", "表格密码"]
  },

  hill: {
    what: "Hill Cipher, a polygraphic substitution cipher invented by Lester S. Hill in 1929, encrypting with linear-algebra matrix operations.",
    principle: "Plaintext letters are grouped into n-dimensional vectors, multiplied by an n×n key matrix (elements 0-25), and reduced mod 26 to get the ciphertext. Decryption needs the inverse of the key matrix mod 26. The matrix determinant must be coprime with 26 (invertible).",
    usage: "The key is a letter or digit string whose length must be a perfect square (≥4, i.e. 2×2 and up). A letter string maps to matrix elements by A=0, B=1, …. Plaintext is padded with X if short.",
    examples: [
      { in: "HELLO", param: { key: "GYBNQKURP" }, out: "TFJJZX", desc: "3×3 matrix [[6,24,1],[13,16,10],[20,17,15]]; HELLO is padded with X to HELLOX and encrypted in two groups" },
      { in: "TFJJZX", param: { key: "GYBNQKURP" }, out: "HELLOX", desc: "Decrypt with the inverse matrix; the trailing X is padding" }
    ],
    formulas: [
      { tex: "\\mathbf{C} = (\\mathbf{K} \\cdot \\mathbf{P}) \\bmod 26", caption: "Encrypt: key matrix × plaintext vector mod 26" },
      { tex: "\\mathbf{P} = (\\mathbf{K}^{-1} \\cdot \\mathbf{C}) \\bmod 26", caption: "Decrypt: inverse matrix × ciphertext vector mod 26" },
      { tex: "\\det(\\mathbf{K}) \\perp 26", caption: "Invertibility: determinant coprime with 26" }
    ],
    tips: [
      "The key matrix must be invertible mod 26 (determinant coprime with 26), otherwise decryption is impossible",
      "A known-plaintext attack can solve for the key matrix with linear algebra",
      "The default key GYBNQKURP is the classic 3×3 teaching matrix"
    ],
    aka: ["Hill", "希尔", "矩阵密码", "希尔密码", "Hill cipher", "Hill Cipher",
      "线性代数密码", "矩阵加密", "希尔加密", "多字母替换", "Lester Hill", "模26矩阵"]
  },

  affine: {
    what: "Affine Cipher, a monoalphabetic substitution cipher combining a multiplicative and a shift cipher, with the form y = ax + b mod 26.",
    principle: "Encryption applies y = (a·x + b) mod 26 to each plaintext letter's index x. Decryption uses the modular inverse a⁻¹: x = a⁻¹·(y - b) mod 26. Requires a coprime with 26 (a ∈ {1,3,5,7,9,11,15,17,19,21,23,25}).",
    usage: "The parameter a (multiplier, default 5) must be coprime with 26, and b (shift, default 8). Case is preserved, non-letters pass through unchanged.",
    examples: [
      { in: "HELLO", param: { a: 5, b: 8 }, out: "RCLLA", desc: "H(7): 5×7+8=43%26=17=R; E(4):28%26=2=C; L(11):63%26=11=L" },
      { in: "RCLLA", param: { a: 5, b: 8 }, out: "HELLO", desc: "a⁻¹=21 (5×21=105≡1), x=21×(y-8) mod 26" }
    ],
    formulas: [
      { tex: "y = (a \\cdot x + b) \\bmod 26", caption: "Encrypt" },
      { tex: "x = a^{-1} \\cdot (y - b) \\bmod 26", caption: "Decrypt (a⁻¹ is the multiplicative inverse of a mod 26)" },
      { tex: "\\gcd(a, 26) = 1", caption: "Invertibility: a coprime with 26" }
    ],
    tips: [
      "When a=1 it degenerates into a Caesar shift; when b=0 it degenerates into a multiplicative cipher",
      "a has only 12 valid values (odd numbers coprime with 26, excluding multiples of 13)",
      "The key space is tiny (12×26=312), easily brute-forced"
    ],
    aka: ["Affine", "仿射", "ax+b", "仿射密码", "Affine cipher", "Affine Cipher",
      "仿射加密", "线性同余密码", "乘法移位密码", "y=ax+b", "仿射变换密码", "affine cipher"]
  },

  bifid: {
    what: "Bifid cipher, a fractionating substitution cipher invented by Félix-Marie Delastelle in 1901, based on recombining coordinates from a Polybius square.",
    principle: "First the plaintext is mapped through a 5×5 Polybius square (I/J merged) into row-column coordinate pairs. Grouping by period (default 5), each group concatenates all row coordinates together and all column coordinates together, then re-pairs them and maps back through the square to ciphertext. Recombining the coordinates breaks the monoalphabetic relationship.",
    usage: "Default 5×5 square (no J, I/J merged), period=5. Only letters are valid input.",
    examples: [
      { in: "HELLO", param: {}, out: "FNNVD", desc: "HELLO→coordinates(23,15,31,31,34)→rows 23133 cols 15314→recombine and re-pair→FNNVD" }
    ],
    formulas: [
      { tex: "\\text{row}_i, \\text{col}_i = \\text{divmod}(\\text{idx}_i, 5)", caption: "Letter → row-column coordinates" },
      { tex: "\\text{重组}: (r_1 r_2 \\cdots c_1 c_2 \\cdots) \\to \\text{新坐标对}", caption: "Within each block, concatenate row coordinates + column coordinates, then re-pair" }
    ],
    tips: [
      "The larger the period the stronger the confusion; period=1 degenerates into a plain Polybius",
      "I and J merge into the same cell, and must be disambiguated by context when decrypting",
      "It is a fractionation cipher, more resistant to frequency analysis than monoalphabetic ones"
    ],
    aka: ["Bifid", "德尔斯特勒", "分块替换", "双分密码", "Bifid cipher", "Bifid Cipher",
      "德拉斯泰尔", "Delastelle", "二分密码", "坐标重组密码", "fractionation", "波利比奥斯变体"]
  },

  polybius: {
    what: "Polybius Square, a coordinate substitution cipher invented by the ancient Greek historian Polybius, encoding letters as two-digit numbers.",
    principle: "A 5×5 square is filled with the 26 letters (I/J merged into one cell), each cell identified by its row and column. Encryption replaces a letter with its cell's two-digit row-column (row first). Decryption maps the two digits back to a letter.",
    usage: "Default 5×5 square ABCDE/FGHIK/… (no J), encoding maps to 12345. Non-letters pass through unchanged.",
    examples: [
      { in: "HELLO", param: {}, out: "2315313134", desc: "H=(2,3)→23, E=(1,5)→15, L=(3,1)→31, L→31, O=(3,4)→34" },
      { in: "2315313134", param: {}, out: "HELLO", desc: "Every two digits restore one letter" }
    ],
    formulas: [
      { tex: "\\text{code} = 5 \\cdot (\\text{row}-1) + (\\text{col}-1)", caption: "Letter index → square position" },
      { tex: "\\text{密文} = \\text{row} \\| \\text{col}", caption: "Row and column concatenated into a two-digit number" }
    ],
    tips: [
      "I and J share a cell (5×5=25 cells hold 26 letters)",
      "It is one of the oldest ciphers, and the basis for ADFGX/Bifid and others",
      "A keyword can scramble the square order to strengthen security"
    ],
    aka: ["Polybius", "波利比奥斯", "棋盘密码", "Polybius Square", "波利比奥斯方阵", "波利比乌斯",
      "波利比奥斯棋盘", "Polybius square", "5x5方阵", "坐标密码", "方阵密码", "棋盘格密码"]
  },

  adfgvx: {
    what: "ADFGVX cipher, a field cipher used by the German army late in WWI, combining a 6×6 square substitution (rows/columns marked by the six letters A/D/F/G/V/X) with a columnar transposition.",
    principle: "A 6×6 square is filled with A-Z and 0-9 (36 characters), rows/columns marked with ADFGVX. Step 1: each plaintext character is replaced by two ADFGVX letters (its row-column markers). Step 2: the intermediate ciphertext is rearranged by a columnar transposition key to get the final ciphertext. This tool implements only Step 1, the square substitution.",
    usage: "Default square ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789, row/column markers ADFGVX. Letters and digits are valid input.",
    examples: [
      { in: "HELLO", param: {}, out: "DDDXDFVFAX", desc: "H=(D,D) E=(D,X) L=(D,F) L=(D,F) O=(V,F)→take each one's row-column markers and concatenate" }
    ],
    formulas: [
      { tex: "\\text{row} = \\text{ADFGVX}[\\lfloor i/6 \\rfloor], \\quad \\text{col} = \\text{ADFGVX}[i \\bmod 6]", caption: "Row-column markers of character i in the square" },
      { tex: "\\text{密文} = \\text{列移位}(\\text{行列标记序列})", caption: "The full ADFGVX also needs a second columnar-transposition step" }
    ],
    tips: [
      "The 6×6 square holds 36 characters (26 letters + 10 digits), hence the 6 marker letters ADFGVX",
      "The full ADFGVX also needs a columnar transposition; this tool only does the square-substitution step",
      "It was broken by the French cryptanalyst Painvin during WWI, a milestone in cipher history"
    ],
    aka: ["ADFGVX", "ADFGX", "一战德军密码", "Painvin", "ADFGVX密码", "ADFGVX cipher",
      "6x6方阵密码", "德军字段密码", "Nebel", "字段密码", "方阵加列移位", "一战密码"]
  },

  otp: {
    what: "One-Time Pad (OTP), a theoretically unbreakable cipher whose key is as long as the plaintext and never reused.",
    principle: "The alphabet version of OTP: plaintext is added mod 26 to the key (not byte XOR). The key length must be ≥ the number of plaintext letters, and each message uses a fresh random key. When these three conditions hold, Shannon proved perfect secrecy.",
    usage: "The key defaults to SECRETKEY, must be letters, and be at least as long as the number of plaintext letters. Non-letters pass through without consuming the keystream. An insufficient key raises an error.",
    examples: [
      { in: "HELLO", param: { key: "SECRETKEY" }, out: "ZINCS", desc: "H+S=Z, E+E=I→(4+4)%26=8=I... add mod 26 letter by letter" },
      { in: "ZINCS", param: { key: "SECRETKEY" }, out: "HELLO", desc: "Subtract mod 26 to restore" }
    ],
    formulas: [
      { tex: "C_i = (P_i + K_i) \\bmod 26", caption: "Encrypt: add mod 26 letter by letter" },
      { tex: "P_i = (C_i - K_i + 26) \\bmod 26", caption: "Decrypt: subtract mod 26 letter by letter" }
    ],
    tips: [
      "The three conditions for perfect secrecy: the key is truly random, equal in length, and never reused — all are required",
      "Key reuse (two-time pad) is a fatal leak, vulnerable to a differencing attack bit by bit",
      "This tool is the alphabet mod-26 version, different from the byte-XOR OTP (see xor in the modern category)"
    ],
    aka: ["One-Time Pad", "OTP", "一次一密", "Vernam", "完美保密", "一次性密码本",
      "one time pad", "维尔南密码", "Vernam cipher", "perfect secrecy", "密钥本", "香农保密"]
  },

  keywordcipher: {
    what: "Keyword Cipher, a monoalphabetic substitution cipher that builds the substitution alphabet from a keyword.",
    principle: "Build the substitution table Beta: the deduplicated keyword leads, then the remaining letters follow in alphabetical order. Encrypt: Alpha[i] → Beta[i] (Alpha is the standard ABCDE…). Decrypt by reverse lookup.",
    usage: "The keyword defaults to KEYWORD. Case is preserved, non-letters pass through unchanged.",
    examples: [
      { in: "HELLO", param: { key: "KEYWORD" }, out: "AOGGJ", desc: "Beta=KEYWORDBCFGHIJLMNPQSUVXZ; H→Beta[7]=A, E→Beta[4]=O, L→Beta[11]=G" },
      { in: "AOGGJ", param: { key: "KEYWORD" }, out: "HELLO", desc: "Reverse lookup to restore" }
    ],
    formulas: [
      { tex: "\\text{Beta} = \\text{dedup}(\\text{keyword}) + (\\text{AZ} \\setminus \\text{keyword})", caption: "Substitution table construction" },
      { tex: "C = \\text{Beta}[P], \\quad P = \\text{Beta}^{-1}[C]", caption: "Encrypt/decrypt by table lookup" }
    ],
    tips: [
      "Leading with the deduplicated keyword is the key step (e.g. the second E in KEYWORD is removed)",
      "It is essentially a keyed monoalphabetic substitution, breakable by frequency analysis",
      "Its keyword usage differs from Playfair/Bifid (there the keyword builds a square)"
    ],
    aka: ["Keyword", "关键字密码", "keyword cipher", "Keyword cipher", "关键词密码", "密钥词密码",
      "关键字替换", "keyword substitution", "关键字单表", "keyed alphabet", "键控字母表", "关键字加密"]
  },

  simplesub: {
    what: "Simple Substitution, the most direct monoalphabetic substitution, where a 26-letter permutation table is given directly.",
    principle: "The key itself is a permutation of the 26 letters (some rearrangement of A-Z). Encrypt: plaintext letter A → key position 0, B → position 1, …. Decrypt in reverse: the ciphertext letter's position in the key → the corresponding standard letter.",
    usage: "The key defaults to AJPCZWRLFBDKOTYUQGENHXMIVS (the pycipher sample table), and must be 26 distinct letters. Case is preserved.",
    examples: [
      { in: "HELLO", param: { key: "AJPCZWRLFBDKOTYUQGENHXMIVS" }, out: "LZKKY", desc: "H(7)→key[7]=L, E(4)→key[4]=Z, L(11)→key[11]=K, O(14)→key[14]=Y" },
      { in: "LZKKY", param: { key: "AJPCZWRLFBDKOTYUQGENHXMIVS" }, out: "HELLO", desc: "Reverse: L is at key position 7→H" }
    ],
    formulas: [
      { tex: "C = K[P], \\quad P = K^{-1}[C]", caption: "K is a 26-letter permutation table; encrypt/decrypt are mutually inverse lookups" }
    ],
    tips: [
      "The key space is 26!≈4×10²⁶, infeasible to brute-force but trivial for frequency analysis",
      "English frequency analysis (E/T/A/O/I…) is a classic cryptography introductory exercise",
      "The key must be 26 distinct letters (a permutation of A-Z), otherwise it errors"
    ],
    aka: ["Simple Substitution", "简单替换", "monoalphabetic", "单表替换", "简单替换密码", "单字母替换",
      "substitution cipher", "替换密码", "单表代换", "monoalphabetic substitution", "字母置换密码", "26字母置换"]
  },

  runningkey: {
    what: "Running Key Cipher, a Vigenère variant that uses a long passage of text (like a book page) as the key.",
    principle: "The algorithm is identical to Vigenère (add/subtract mod 26); the difference is the key source: Vigenère cycles a short key, while a running key uses long text (like a passage) advancing with the plaintext, cycling only when exhausted. A long key greatly increases the difficulty of an index-of-coincidence attack.",
    usage: "The key defaults to THEQUICKBROWNFOX (a classic pangram fragment). Case is preserved, non-letters pass through unchanged.",
    examples: [
      { in: "HELLO", param: { key: "THEQUICKBROWNFOX" }, out: "ALPBI", desc: "H+T=A, E+H=L, L+E=P, L+Q=B, O+U=I (add mod 26)" },
      { in: "ALPBI", param: { key: "THEQUICKBROWNFOX" }, out: "HELLO", desc: "Subtract mod 26 to restore" }
    ],
    formulas: [
      { tex: "C_i = (P_i + K_i) \\bmod 26", caption: "Encrypt (K_i is the i-th letter of the long text, not cycled until exhausted)" },
      { tex: "P_i = (C_i - K_i + 26) \\bmod 26", caption: "Decrypt" }
    ],
    tips: [
      "The longer the key text the more secure; ideally a one-time random text (degenerating into OTP)",
      "If the key text has patterns (like repeated phrases), it can still be attacked by index of coincidence",
      "It is equivalent to the vigenere algorithm, differing only in key source and length strategy"
    ],
    aka: ["Running Key", "滚动密钥", "running key cipher", "Running key", "滚动密钥密码", "流动密钥",
      "长密钥维吉尼亚", "running key", "文本密钥密码", "书本密钥", "长文本密钥", "维吉尼亚变体"]
  }
};
