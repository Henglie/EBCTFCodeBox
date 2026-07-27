// English edu shard: classic first 8 (gronsfeld/beaufort/autokey/porta/playfair/nihilist/columnar/trifid). Pure data, no import, no side effects.
export default {
  gronsfeld: {
    what: "Gronsfeld cipher: the 'numeric-key version' of Vigenère. The key is a string of digits, and each letter is Caesar-shifted by the matching digit.",
    principle:
      "The key is a digit string (e.g. `31415`) cyclically aligned to the plaintext. The $i$-th letter is shifted $c_i = (x_i + k_{i \\bmod L}) \\bmod 26$, where $k$ is the key digit and $L$ is the key length.\n\n" +
      "Identical to Vigenère, except the key uses 0-9 instead of letters (equivalent to a Vigenère whose shift amounts are limited to 0-9).",
    usage: "Enter a numeric key and paste ciphertext to decode; encode direction encrypts. Only letters are processed, everything else passes through unchanged.",
    examples: [
      { in: "HELLO", param: "key=31415", out: "KFPMT", desc: "H+3=K, E+1=F, L+4=P, L+1=M, O+5=T" },
    ],
    formulas: [
      { tex: "c_i = (x_i + k_{i \\bmod L}) \\bmod 26", caption: "k is the key digit, L is the key length" },
    ],
    tips: ["A polyalphabetic shift cipher whose key is digits (not a word) is Gronsfeld.", "Each shift can only be 0-9, slightly weaker than Vigenère, and easier to brute-force with a short key."],
    aka: ["gronsfeld", "格朗斯菲尔德", "数字密钥维吉尼亚", "Gronsfeld", "格龙斯菲尔德", "gronsfeld cipher",
      "数字维吉尼亚", "数字密钥密码", "Gronsfeld cipher", "格朗斯菲尔德密码", "数字键维吉尼亚", "10进制维吉尼亚",
      "numeric-key Vigenère", "digit key cipher", "decimal Vigenère"],
  },

  beaufort: {
    what: "Beaufort cipher: a Vigenère variant that uses 'key minus plaintext' instead of addition. It is reciprocal — the same operation both encrypts and decrypts.",
    principle:
      "For each letter $c_i = (k_{i \\bmod L} - x_i) \\bmod 26$, i.e. subtract the plaintext letter from the key letter.\n\n" +
      "Because it subtracts, running it again $(k - c) = (k - (k - x)) = x$ returns the plaintext, so encoding and decoding are identical. Note this is NOT the same as Vigenère decryption (plaintext minus key).",
    usage: "Enter a letter key and convert directly (encode and decode are the same operation). Only letters are processed.",
    examples: [
      { in: "HELLO", param: "key=KEY", out: "DANZQ", desc: "K-H, E-E, Y-L… key minus plaintext, letter by letter" },
    ],
    formulas: [
      { tex: "c_i = (k_{i \\bmod L} - x_i) \\bmod 26", caption: "Reciprocal: run it again on the ciphertext to recover plaintext" },
    ],
    tips: ["Reciprocal: if unsure of direction, just run it once — if it reads, you're done.", "Don't confuse it with Vigenère: Vigenère adds/subtracts, Beaufort is always 'key minus letter'."],
    aka: ["beaufort", "博福特", "自反维吉尼亚", "Beaufort", "波弗特", "beaufort cipher",
      "Beaufort cipher", "博福特密码", "波弗特密码", "对合密码", "密钥减明文", "reciprocal cipher"],
  },

  autokey: {
    what: "Autokey: a strengthened Vigenère. The key is only a short starting word, then the plaintext itself is appended as the keystream, avoiding the short-period weakness.",
    principle:
      "Keystream = keyword + plaintext. For example keyword `KEY` and plaintext `HELLO` give keystream `KEYHELLO` (the earlier plaintext fills in the later key).\n\n" +
      "Encrypt $c_i = (x_i + \\text{stream}_i) \\bmod 26$. Because the keystream no longer repeats, period-based methods like index of coincidence and Kasiski fail. When decrypting, each recovered plaintext letter is fed back into the keystream.",
    usage: "Enter a keyword and paste ciphertext to decode; encode direction encrypts. Only letters are processed.",
    examples: [
      { in: "HELLO", param: "keyword=KEY", out: "RIJSS", desc: "Keystream KEYHE: H+K, E+E, L+Y, L+H, O+E" },
    ],
    tips: ["It has no fixed key period, so Kasiski/IC are basically useless against it — cracking requires a different approach than plain Vigenère.", "Decryption must be sequential: each recovered plaintext character is appended to the keystream for the ones that follow."],
    aka: ["autokey", "自动密钥", "自密钥", "auto-key", "Autokey", "autokey cipher",
      "自动密钥密码", "自密钥密码", "Autokey cipher", "auto key", "维吉尼亚自动密钥", "明文自密钥"],
  },

  porta: {
    what: "Porta cipher: a reciprocal polyalphabetic substitution. A key letter selects a substitution table, and the tables are designed so that substituting twice returns the original.",
    principle:
      "The 26 letters are paired into 13 tables (A/B share one, C/D share one…). The current key letter decides which table to use.\n\n" +
      "Each table swaps the first 13 letters with the last 13, making it reciprocal: running the same key over the ciphertext again restores the plaintext. Historically it is one of the earlier polyalphabetic ciphers.",
    usage: "Enter a letter key and convert directly (encode and decode are the same operation). Only letters are processed.",
    examples: [
      { in: "HELLO", param: "key=KEY", out: "ZTXQM", desc: "Substitute each character using the table chosen by K/E/Y" },
    ],
    tips: ["Reciprocal: the same key run twice returns the original, so if unsure of direction just run it again.", "Key letters share tables in pairs (A=B, C=D…), so A and B have the same effect in a key."],
    aka: ["porta", "波尔塔", "自反多表", "Porta", "波塔", "porta cipher",
      "Porta cipher", "波尔塔密码", "波塔密码", "della Porta", "自反多表替换", "对合多表密码"],
  },

  playfair: {
    what: "Playfair cipher: a classic cipher that encrypts two letters at a time. It arranges 25 letters into a 5×5 grid and substitutes each letter pair by its positions in the grid.",
    principle:
      "A keyword (deduplicated) fills a 5×5 grid (I/J share one cell), and the remaining letters fill in order. The plaintext is split into pairs; repeated letters are separated by `X`, and an odd length is padded with `X`.\n\n" +
      "Each pair is substituted by rule: same row → take the letter to each one's right; same column → take the letter below each; otherwise → take the rectangle's opposite corner in the same row. It's the earliest practical digraph substitution cipher.",
    usage: "Enter a keyword and paste ciphertext to decode; encode direction encrypts. J is treated as I.",
    examples: [
      { in: "HELLO", param: "keyword=MONARCHY", out: "CFSUPM", desc: "LL is split into LX/LO to form even pairs" },
    ],
    tips: ["A ciphertext of even length with no consecutive identical letters (when no letter is left alone) is a Playfair signature.", "J is usually merged into I; the extra X's you often see when decrypting are separator/padding leftovers."],
    aka: ["playfair", "普莱费尔", "双字母密码", "5x5方阵", "Playfair", "playfair cipher",
      "普莱费尔密码", "Playfair cipher", "双字母替换", "bigram cipher", "Wheatstone", "5x5棋盘密码"],
  },

  nihilist: {
    what: "Nihilist cipher: uses a keyword-scrambled Polybius square to turn letters into two-digit coordinates. Used by 19th-century Russian nihilists.",
    principle:
      "First a keyword (deduplicated) generates a 5×5 keyed square (I/J merged), and each letter maps to a two-digit 'row-column' coordinate (each 1-5).\n\n" +
      "This tool implements the keyed-Polybius version: letter → coordinate pair. The full Nihilist cipher also adds a numeric key on top; here we focus on the square-coordinate layer.",
    usage: "Enter a keyword and paste a coordinate digit string to decode; encode direction turns letters into coordinates.",
    examples: [
      { in: "HELLO", param: "keyword=KEY", out: "2512323235", desc: "Each letter is a 2-digit coordinate per the keyed square" },
    ],
    tips: ["A string of digit pairs where every digit is 1-5, with a square that seems keyword-scrambled, points to Nihilist / keyed Polybius.", "The square is scrambled by the keyword — without it the coordinates won't line up."],
    aka: ["nihilist", "虚无党", "虚无主义者密码", "键控polybius", "Nihilist", "nihilist cipher",
      "虚无党密码", "Nihilist cipher", "虚无主义密码", "俄国虚无党密码", "键控波利比奥斯", "数字叠加密码"],
  },

  columnar: {
    what: "Columnar Transposition: fill the plaintext into a grid row by row, then read it out column by column in the alphabetical order of the key letters. A transposition cipher.",
    principle:
      "Each letter of the key word yields a column read order (sorted alphabetically, ties broken by original position). The plaintext fills a grid of `key length` columns row by row, then columns are read out in that order.\n\n" +
      "The letters themselves don't change, only their order is scrambled — frequency analysis shows no substitution trace.",
    usage: "Enter a key word and paste ciphertext to decode; encode direction encrypts. Only letters are processed.",
    examples: [
      { in: "HELLOWORLD", param: "key=ZEBRA", out: "ODLREOLLHW", desc: "Read columns in ZEBRA's sorted order A→B→E→R→Z" },
    ],
    tips: ["When the letters are unchanged but the order is scrambled, suspect the transposition family first (columnar/rail fence).", "The key decides the column read order; key length = number of columns, and it's cleanest when ciphertext length is a whole multiple of the columns."],
    aka: ["列移位", "columnar transposition", "列换位", "列置换", "列移位密码", "columnar cipher",
      "列换位密码", "列置换密码", "换位密码", "transposition cipher", "密钥列换位", "栅栏类换位"],
  },

  trifid: {
    what: "Trifid cipher: the 3D version of Bifid. Each letter maps to a 3D coordinate (a 3×3×3 cube), which is split, rearranged, then recombined into letters — strong confusion.",
    principle:
      "A 27-character key fills three 3×3 blocks (27 cells total), and each letter maps to three coordinate digits (layer, row, column, each 1-3).\n\n" +
      "Group by period, then within each group line up all the first coordinates, all the second, all the third, and pair every 3 digits back into a letter. It effectively 'cuts each letter into three parts, scatters, and reassembles them'.",
    usage: "Enter the 27-character key table and period (grouping period), paste ciphertext to decode; encode direction encrypts.",
    examples: [
      { in: "HELLO", param: "key=ABCDEFGHIJKLMNOPQRSTUVWXYZ. period=5", out: "BOJN.", desc: "Standard A-Z + period, 27-character table" },
    ],
    tips: ["The key must be exactly 27 characters (26 letters + 1 padding symbol, commonly a period).", "It's the 3D generalization of Bifid: Bifid uses 5×5 2D coordinates, Trifid uses 3×3×3 3D coordinates."],
    aka: ["trifid", "三分密码", "三维分置", "德拉斯泰尔三分", "Trifid", "trifid cipher",
      "Trifid cipher", "德拉斯泰尔", "Delastelle", "三维坐标密码", "3x3x3密码", "Bifid三维版"],
  },
};
