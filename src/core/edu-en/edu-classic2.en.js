// English edu shard: classic last 7 (adfgx/foursquare/graycode/trithemius/yuanYin/columnReplace/rowsReplace). Pure data, no import, no side effects.
export default {
  adfgx: {
    what: "ADFGX: a WWI German field cipher. It first turns each letter into two A/D/F/G/X letters via a 5×5 square, then scrambles them with a keyword columnar transposition. It's the no-digits version of ADFGVX.",
    principle:
      "Step 1 'fractionation': 25 letters (J merged into I) fill a 5×5 square, with rows and columns labeled A/D/F/G/X. Each letter → two label letters, doubling the plaintext length.\n\n" +
      "Step 2 'columnar transposition': read these digraphs by column in the alphabetical order of the transposition key, thoroughly scrambling positions. A/D/F/G/X were chosen because their Morse codes differ a lot, making telegraph transmission less error-prone.",
    usage: "Enter the 25-letter square (default standard table, J→I) and the columnar transposition key, paste ciphertext (all ADFGX letters) to decode; encode direction reverses.",
    examples: [
      { in: "HELLO", param: "square=default, key=BATTLE", out: "FFDAFGXFAA", desc: "First convert to ADFGX pairs, then columnar transposition" },
    ],
    tips: [
      "The ciphertext consists only of the five letters A D F G X — recognizable at a glance. The digit-bearing sibling is ADFGVX (6×6).",
      "Cracking requires attacking both the square and the transposition; pure manual work is very hard, usually relying on known plaintext or statistics.",
    ],
    aka: ["adfgx", "战地密码", "德军密码", "ADFGX", "ADFGX cipher", "adfgx密码",
      "一战德军密码", "5x5方阵换位", "ADFGX加密", "无数字ADFGVX", "德军战地密码", "分数化换位密码"],
  },

  foursquare: {
    what: "Four-square cipher: encrypts letters in pairs using two 25-letter key squares plus two standard squares. Harder than Playfair because it uses two independent key tables.",
    principle:
      "Draw four 5×5 squares in a 2×2 layout: top-left and bottom-right are the standard alphabet, top-right and bottom-left are two key squares.\n\n" +
      "The plaintext is split into pairs; the first letter is located in the top-left, the second in the bottom-right, and their 'row-column crossing' letters in the two key squares become the ciphertext. Decryption reverses the lookup.",
    usage: "Enter two 25-letter key squares (each without J), paste ciphertext to decode; encode direction reverses. Odd-length plaintext is padded with X.",
    examples: [
      { in: "HELLO", param: "two default key squares", out: "UNWXRK", desc: "Cross-lookup in pairs, padded with X at the end" },
    ],
    tips: [
      "Like Playfair it's a digraph substitution, but with two key tables, making frequency analysis harder.",
      "The ciphertext length is even (odd plaintext gets X-padded), all uppercase with no digits.",
    ],
    aka: ["四方密码", "four-square", "foursquare", "田字密码", "Four-square", "four square cipher",
      "四方形密码", "4方密码", "Foursquare cipher", "双方阵密码", "四格密码", "Delastelle four-square"],
  },

  graycode: {
    what: "Gray code: a binary encoding where adjacent values differ by exactly 1 bit. Here each byte of text is turned into 8 bits, then the whole stream undergoes a Gray-code transform, outputting a long run of 0/1.",
    principle:
      "First convert text to a binary string via UTF-8. Gray-code rule: the first bit is copied as-is, then each bit = current binary bit $\\oplus$ previous bit (XOR).\n\n" +
      "Decoding reverses: the first bit is copied, then each bit = current Gray bit $\\oplus$ the already-recovered previous bit, working back to the original binary, then bytes back to text.",
    usage: "Paste text directly to encode into a Gray-code 0/1 string; decode direction pastes a 0/1 string to recover text (non-0/1 characters are ignored).",
    examples: [
      { in: "A", out: "01100001", desc: "A=0x41=01000001, copy the first bit then XOR bit by bit" },
      { in: "Hi", out: "0110110001011101" },
    ],
    formulas: [
      { tex: "g_i = b_i \\oplus b_{i-1}", caption: "Encode: Gray bit = current bit XOR previous bit (g_0 = b_0)" },
      { tex: "b_i = g_i \\oplus b_{i-1}", caption: "Decode: work back to the original binary bit by bit" },
    ],
    tips: ["When you have a long 0/1 string that doesn't look like direct ASCII binary, try decoding a layer of Gray code."],
    aka: ["格雷码", "gray code", "格雷编码", "循环码", "Gray code", "格莱码",
      "反射二进制码", "reflected binary", "格雷二进制", "gray编码", "单步码", "RBC码"],
  },

  trithemius: {
    what: "Trithemius cipher (1508): a precursor to Vigenère, with no key — the i-th letter is simply shifted by i positions. It's the earliest form of the 'progressive-shift' polyalphabetic cipher.",
    principle:
      "The 0th letter shifts 0, the 1st shifts 1, the 2nd shifts 2… the $i$-th letter $c_i = (x_i + \\text{start} + i) \\bmod 26$. This tool's start is the starting shift; the default 0 is the standard version.\n\n" +
      "It can be seen as a Vigenère with key `ABCDEF...`, where the position itself is the shift amount, so no separate key is needed.",
    usage: "Paste text directly to encode (optional starting shift start, default 0); decode direction subtracts back bit by bit.",
    examples: [
      { in: "HELLO", param: "start=0", out: "HFNOS", desc: "H+0, E+1, L+2, L+3, O+4" },
      { in: "abc", param: "start=0", out: "ace", desc: "a+0=a, b+1=c, c+2=e" },
    ],
    formulas: [
      { tex: "c_i = (x_i + \\text{start} + i) \\bmod 26", caption: "The i-th letter (counting from 0)" },
    ],
    tips: ["No key, and the shift increases with position — that's the key to recognizing it. Equivalent to a Vigenère with key ABCDE…"],
    aka: ["trithemius", "特里特米乌斯", "渐进移位", "tabula recta", "Trithemius", "trithemius cipher",
      "特里特米乌斯密码", "渐进密钥密码", "progressive key", "维吉尼亚雏形", "无密钥多表", "特里特米乌斯移位"],
  },

  yuanYin: {
    what: "Vowel cipher: a digit↔letter mapping. The 5 vowels a/e/i/o/u use single digits 1-5, and consonants use two digits (their vowel group + position).",
    principle:
      "Vowels a=1, e=2, i=3, o=4, u=5. Consonants are grouped after each vowel and use two digits: e.g. b=11, c=12, d=13 (group a), f=21, g=22, h=23 (group e), and so on up to z=55.\n\n" +
      "When decoding, split by delimiter into individual numbers and look them up; when encoding, map letters back to numbers joined by a delimiter.",
    usage: "Paste a digit string (space, comma, or dot delimited) to decode into letters; encode direction turns text into digits (default space-delimited, delimiter configurable).",
    examples: [
      { in: "23 3", out: "hi", desc: "23=h (3rd of group e), 3=i" },
      { in: "12 1 45", out: "cat", desc: "12=c, 1=a, 45=t" },
    ],
    tips: [
      "A string of one- or two-digit numbers starting with 1-5 that splits cleanly suggests the vowel cipher.",
      "A single 1-5 is a vowel; the leading 1-5 of a two-digit number indicates its vowel group.",
    ],
    aka: ["元音密码", "yuanyin", "vowel cipher", "元音表", "元音编码", "yuan yin",
      "元音辅音编码", "元音分组密码", "vowel code", "数字元音密码", "元音数字映射", "元音字母表"],
  },

  columnReplace: {
    what: "Column permutation cipher: arrange the plaintext into a grid of fixed column count, then read column by column in the sorted order of the key letters. A form of columnar transposition.",
    principle:
      "Each letter of the key decides a column. Sorting the key letters gives the read order of the columns (after sorting `ZEBRA`, A<B<E<R<Z, corresponding to a new order of the original columns).\n\n" +
      "The plaintext fills a grid of keylen columns row by row (padded with spaces if short), then columns are concatenated in the sorted order. Decryption slices by column length, restores the original column order, and reads row by row.",
    usage: "Enter a key (ideally with no repeated letters, default ZEBRA), paste ciphertext to decode; encode direction reverses. Plaintext is space-padded to a whole multiple of the key length.",
    examples: [
      { in: "HELLOWORLD", param: "key=ZEBRA", out: "ODLREOLLHW", desc: "Read columns in ZEBRA's letter order" },
    ],
    tips: [
      "A transposition cipher — the letters are unchanged, only the order is scrambled, so the frequency distribution matches the plaintext.",
      "Difference from 'row permutation': this arranges the whole table then reads by column; row permutation rearranges within each block separately.",
    ],
    aka: ["列置换", "columnar", "列换位", "column transposition", "列置换密码", "columnar transposition",
      "列排序密码", "按列读取密码", "列换位密码", "keyed columnar", "密钥列置换", "表格列置换"],
  },

  rowsReplace: {
    what: "Row permutation cipher: split the plaintext into blocks of keylen characters, then rearrange within each block by the sorted order of the key letters. The scrambling scope stays inside each block.",
    principle:
      "Sorting the key letters yields the in-block reorder sequence ids. The plaintext is split into blocks of keylen, and characters within each block are repositioned by ids.\n\n" +
      "For example key `KEY`, sorted E<K<Y maps to original positions [1,0,2], and every 3 characters are rearranged in this order. Decryption uses the inverse permutation to restore.",
    usage: "Enter a key (default KEY), paste ciphertext to decode; encode direction reverses. Plaintext is space-padded to a whole multiple of the key length.",
    examples: [
      { in: "HELLO", param: "key=KEY", out: "EHLOL ", desc: "Rearrange within each 3-char block by order E<K<Y, last block space-padded" },
    ],
    tips: [
      "Rearranging within blocks with no mixing between blocks is the key difference from column permutation.",
      "The key length is the block size; checking whether the ciphertext splits cleanly into blocks helps you guess keylen.",
    ],
    aka: ["行置换", "rows replace", "行换位", "块内重排", "行置换密码", "行换位密码",
      "row transposition", "块内置换", "分块重排密码", "rows replacement", "行内重排密码", "按行置换"],
  },
};
