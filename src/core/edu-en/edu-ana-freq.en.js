// English edu shard: analysis frequency analysis / classical-cipher auto-solvers — freqDist/entropy/wordFreq/hammingDistance/levenshtein/strContrast/icAnalysis/kasiskiTest/chiSquareAnalysis/subCipherSolver/vigenereAuto/hillKnownPlain/playfairCrack
export default {
  freqDist: {
    what: "Character frequency distribution: count how many times each character appears and its percentage, sorted high to low. The first step of any analysis.",
    principle:
      "Every frequency analysis starts with counting. In English plaintext e/t/a/o are common and space is the most common; monoalphabetic substitution only changes what letters look like, not their frequency, so the highest-frequency ciphertext letter is very likely the stand-in for e or space.",
    usage: "Paste text; outputs each character's count and percentage (descending). Pair it with subCipherSolver or manual substitution reasoning.",
    examples: [{ in: "aabbbc", out: "b×3(50%) a×2(33%) c×1(17%)" }],
    tips: ["The longer the ciphertext, the more trustworthy the frequencies; on short ciphertext of a few dozen characters, frequency analysis is basically unreliable."],
    aka: ["frequency distribution", "字符频率", "频率分布", "字频", "字符统计", "频率统计",
      "char frequency", "字母频率", "letter frequency", "频次统计", "字符计数", "character count"],
  },

  entropy: {
    what: "Shannon entropy: a quantitative measure of how random / how hard-to-compress a chunk of data is, in bits/character. Tells plaintext from encoding, encryption, or compressed data.",
    principle:
      "Entropy measures uncertainty. Uniformly random bytes have maximum entropy = 8 bit/byte; English text is about 4.0–4.5; encoded strings with only a few characters are lower.\n\n" +
      "Practical judgment: entropy near 8 → encrypted or compressed data (no pattern); entropy 4–5 → natural language or base64-like; very low entropy → highly repetitive encoding.",
    usage: "Paste data; outputs Shannon entropy (bit/char). Use it to tell 'is this ciphertext/an archive, or ordinary text'.",
    examples: [
      { in: "Random byte stream", out: "≈ 8.0 (high entropy, looks encrypted/compressed)" },
      { in: "English paragraph", out: "≈ 4.2 (medium entropy, natural language)" },
    ],
    formulas: [{ tex: "H = -\\sum_{i} p_i \\log_2 p_i", caption: "pᵢ is the probability of symbol i" }],
    tips: ["A high-entropy chunk that binwalk pulls out is often an encrypted block; boundaries where entropy jumps are often file/field delimiters."],
    aka: ["shannon entropy", "香农熵", "信息熵", "entropy", "熵", "熵值", "熵计算",
      "information entropy", "bit熵", "随机性检测", "熵分析", "shannon"],
  },

  wordFreq: {
    what: "Word frequency: tokenize by word (not by single character) and count, to see which words recur.",
    principle:
      "Split on whitespace/punctuation, then count each word's occurrences, sorted descending. High-frequency function words (the/of/and) corroborate language identification; an unusually frequent odd word may be a key, a marker, or a clue hidden in the text.",
    usage: "Paste text; outputs the word-frequency ranking (descending).",
    examples: [{ in: "the cat the dog the", out: "the×3 cat×1 dog×1" }],
    aka: ["word frequency", "词频", "词频统计", "单词频率", "词语统计", "词汇统计",
      "word count", "词计数", "单词计数", "词频排行", "高频词", "token frequency"],
  },

  hammingDistance: {
    what: "Hamming distance: how many bits differ between two equal-length chunks of data. Used to estimate key length when breaking multi-byte XOR.",
    principle:
      "XOR the two strings bit by bit; the number of 1s in the result is the Hamming distance. Breaking repeating-key XOR: at the correct key length L, adjacent blocks (of L bytes each) have the smallest normalized Hamming distance — because they are XORed by the same keystream, the regularity of English plaintext shows through.",
    usage: "Paste two equal-length texts separated by a newline; outputs the byte-level Hamming distance. When estimating XOR key length, compare normalized distances across different block lengths.",
    examples: [
      { in: "this is a test\nwokka wokka!!!", out: "37", desc: "The classic Cryptopals example" },
    ],
    formulas: [{ tex: "d_H(a,b) = \\text{popcount}(a \\oplus b)", caption: "count the 1s after XOR" }],
    tips: ["Key-length L candidates: for each L, take the first few blocks pairwise and compute normalized distance (÷L); the L with the smallest value is the most likely true key length."],
    aka: ["hamming distance", "汉明距离", "海明距离", "hamming", "汉明", "比特距离",
      "bit distance", "异或距离", "xor距离", "汉明重量", "hamming weight", "popcount距离"],
  },

  levenshtein: {
    what: "Edit distance: the minimum number of insertions/deletions/substitutions to turn one string into another. Measures how similar two strings are.",
    principle:
      "Dynamic programming fills an (m+1)×(n+1) table where dp[i][j] is the minimum operations to turn prefix a[..i] into b[..j]. If characters match, inherit the top-left cell; if not, take the minimum of three directions +1.",
    usage: "Separate two texts with a newline; outputs the minimum edit distance. Use it for fuzzy matching and finding near-identical strings.",
    examples: [{ in: "kitten\nsitting", out: "3", desc: "k→s, e→i, append g at the end" }],
    formulas: [
      { tex: "dp[i][j] = \\min(dp[i-1][j]+1,\\ dp[i][j-1]+1,\\ dp[i-1][j-1]+[a_i\\ne b_j])", caption: "edit-distance recurrence" },
    ],
    aka: ["levenshtein", "编辑距离", "edit distance", "莱文斯坦距离", "字符串相似度", "levenshtein distance",
      "最小编辑距离", "字符串距离", "模糊匹配", "相似度算法", "字符串比对", "序列相似度"],
  },

  strContrast: {
    what: "Equal-length ASCII difference comparison: subtract two equal-length texts character by character to see how much each position differs.",
    principle:
      "Align the two strings and compute the ASCII difference b−a per position. A constant difference → a Caesar-style uniform shift; a patterned difference → possibly the keystream of a Vigenère/stream cipher; positions with difference 0 are identical characters.",
    usage: "Separate two equal-length texts with a newline; outputs the per-character ASCII difference sequence.",
    examples: [{ in: "ABC\nBCD", out: "+1 +1 +1", desc: "uniform shift of 1, looks like Caesar" }],
    tips: ["All differences equal → Caesar; periodically repeating differences → Vigenère, and the period is the key length."],
    aka: ["string contrast", "ascii 差值", "等长对比", "字符差值", "ascii 对比", "逐字符相减",
      "码值差", "差值序列", "char diff", "ascii diff", "字符串对比", "偏移检测"],
  },

  icAnalysis: {
    what: "Index of coincidence, advanced version: not only the overall IC, but also grouped IC by different group lengths, estimating the Vigenère key length in one step.",
    principle:
      "For each candidate key length L, take every L-th character of the ciphertext as one column (L columns total), compute IC per column, then average. If L is the true key length (or a multiple), every column is a single Caesar → the average IC jumps back near the English value 0.066, forming a clear peak.",
    usage: "Paste ciphertext; outputs the overall IC plus a table of average IC per group length. The L whose IC is closest to 0.066 is the key-length candidate. Overall IC near 0.066 looks monoalphabetic/plaintext; near 0.038 looks polyalphabetic or random.",
    examples: [
      { in: "Vigenère ciphertext", out: "at L=6 average IC≈0.065 (peak) → key length is very likely 6" },
      { in: "English ciphertext", out: "overall IC ≈ 0.065 (leans monoalphabetic) or ≈ 0.041 (leans polyalphabetic)" },
    ],
    formulas: [{ tex: "IC = \\frac{\\sum_{i} n_i(n_i-1)}{N(N-1)}", caption: "nᵢ is the count of letter i, N is the total" }],
    tips: [
      "Consider both the peak L and its divisors (a peak at L=6 could really be 3 or 6). Once the length is fixed, hand it to vigenereAuto to recover the key.",
      "Reference values: English≈0.0667, French≈0.078, random≈0.0385. An overall IC well below 0.05 basically indicates a polyalphabetic cipher.",
    ],
    aka: ["ic analysis", "分组重合指数", "密钥长估计", "index of coincidence", "重合指数", "ic",
      "重合指数分析", "IC分析", "密钥长度估计", "coincidence index", "Kappa检验", "维吉尼亚密钥长"],
  },

  kasiskiTest: {
    what: "Kasiski examination: find repeated fragments in the ciphertext, measure the gaps between them, and the greatest common divisor of the gaps is often the Vigenère key length.",
    principle:
      "In Vigenère, if identical plaintext happens to be encrypted by the identical key fragment, it produces identical ciphertext fragments. The spacing between such repeats must be an integer multiple of the key length. Collect the gaps of all repeated n-grams and take the greatest common divisor (GCD) as the key-length candidate.",
    usage: "Paste ciphertext; the tool finds repeated 3–4 letter groups, computes the gaps, takes the GCD, and gives key-length candidates.",
    examples: [
      { in: "ciphertext with repeated n-grams", out: "gaps {9,6,15} → GCD=3 → key length is likely 3" },
    ],
    tips: ["Cross-validating with icAnalysis is more robust. Occasional coincidental repeats add noise, so look at the common factor of the majority of gaps."],
    aka: ["kasiski test", "kasiski 检验", "卡西斯基", "kasiski", "卡西斯基检验", "卡西斯基测试",
      "kasiski examination", "重复片段间隔", "密钥长度分析", "维吉尼亚破解", "n-gram间隔", "GCD密钥长"],
  },

  chiSquareAnalysis: {
    what: "Chi-square test, detailed version: gives a table comparing each ciphertext letter's observed count against its English expected count, not just a single overall score.",
    principle:
      "It expands the intermediate steps on top of chiSquare: it lists observed/expected/contribution values for each of the 26 letters. It computes the overall score and also makes clear which letters deviate most — helping manual inference of the substitution mapping.",
    usage: "Paste ciphertext; outputs a per-letter observed-vs-English-expected comparison table plus the total chi-square. Among the 26 Caesar shifts, pick the smallest score (the lower the chi-square, the more it looks like English plaintext).",
    examples: [
      { in: "English ciphertext", out: "per-letter comparison table + total χ²" },
      { in: "text at the correct shift", out: "minimum chi-square → correct solution", desc: "wrong shifts have a much larger chi-square" },
    ],
    formulas: [{ tex: "\\chi^2 = \\sum_{i} \\frac{(O_i - E_i)^2}{E_i}", caption: "Oᵢ observed count, Eᵢ expected count" }],
    tips: ["Chi-square + exhaustive 26 shifts = fully automatic Caesar breaking, faster than eyeballing frequencies."],
    aka: ["chi square analysis", "卡方详细", "卡方对照表", "chi square", "卡方检验", "卡方统计",
      "chi-squared", "卡方分析", "χ²检验", "chi2", "凯撒破解", "字母分布检验"],
  },

  subCipherSolver: {
    what: "Automatic monoalphabetic substitution solver: without a key, uses a hill-climbing algorithm to find the 26-letter substitution mapping and directly outputs the plaintext.",
    principle:
      "Treat the 'ciphertext letter → plaintext letter' mapping as a permutation to optimize. Score candidate plaintexts with English quadgram log-probabilities, randomly swap two letters' mappings, accept if the score improves and accept a worse score with some probability (hill climbing / annealing), and iterate repeatedly until it converges on the best mapping.",
    usage: "Paste a sufficiently long monoalphabetic substitution ciphertext (longer is more accurate); the tool hill-climbs automatically and outputs the recovered mapping and plaintext.",
    examples: [{ in: "a fairly long monoalphabetic substitution ciphertext", out: "recovered plaintext + 26-letter mapping table" }],
    tips: ["On too-short ciphertext (<100 characters) hill climbing easily gets stuck in local optima; run it several times and take the best result. Digits/symbols don't matter, it only solves the letters."],
    aka: ["substitution solver", "单表替换求解", "爬山破解", "单表替换破解", "substitution cracker",
      "hill climbing", "爬山算法", "模拟退火破解", "quadgram", "四元组打分", "自动替换求解", "monoalphabetic solver"],
  },

  vigenereAuto: {
    what: "Fully automatic Vigenère breaking: goes all the way from ciphertext to plaintext, with no need for you to supply the key or the key length.",
    principle:
      "A three-step pipeline: ① estimate key length L with IC/Kasiski; ② split the ciphertext into L columns, each column being a Caesar, and find the best shift per column with chi-square → assemble the key; ③ decrypt with the recovered key. The whole process is based on English statistics.",
    usage: "Paste Vigenère ciphertext (English, sufficiently long); one click outputs the estimated key, key length, and decrypted plaintext.",
    examples: [{ in: "English Vigenère ciphertext", out: "key=LEMON + plaintext", desc: "auto length estimation + per-column chi-square" }],
    tips: ["Longer ciphertext is more accurate. If the result looks half-readable, the key length may have been estimated as a divisor/multiple of the true value; adjust L manually and decrypt again."],
    aka: ["vigenere auto", "维吉尼亚自动破解", "vigenere 破解", "维吉尼亚全自动", "vigenere crack",
      "vigenere solver", "维吉尼亚爆破", "多表替换破解", "自动求密钥", "维吉尼亚攻击", "vigenere breaker", "无密钥破解"],
  },

  hillKnownPlain: {
    what: "Hill cipher known-plaintext attack: with a piece of plaintext and its corresponding ciphertext, you can solve for the key matrix used to encrypt.",
    principle:
      "Hill takes plaintext in groups of n letters as vectors and multiplies by key matrix K (mod 26) to get ciphertext: $C = KP \\bmod 26$. With enough plaintext-ciphertext pairs assembled into matrices P and C, then $K = C P^{-1} \\bmod 26$ — this requires P to be invertible mod 26 (its determinant coprime with 26).",
    usage: "Enter the plaintext and corresponding ciphertext (long enough to build an invertible P), choose the block order n, and the tool solves for the key matrix K.",
    examples: [
      { in: "known plaintext + ciphertext", param: "n=2", out: "2×2 key matrix K", desc: "requires P invertible mod 26" },
    ],
    formulas: [{ tex: "K = C\\,P^{-1} \\bmod 26", caption: "recover the key matrix from plaintext-ciphertext pairs" }],
    tips: ["The P assembled from the chosen plaintext blocks must be invertible (gcd(det P, 26)=1); if not invertible, swap in a few other plaintext groups and retry."],
    aka: ["hill known plaintext", "hill 已知明文", "希尔密码攻击", "希尔已知明文", "hill攻击",
      "known plaintext attack", "已知明文攻击", "hill密钥矩阵求解", "矩阵密码破解", "希尔密码破解", "求密钥矩阵", "hill cipher attack"],
  },

  playfairCrack: {
    what: "Playfair hill-climbing solver: uses simulated annealing to automatically search for the 5×5 key square and recover the plaintext.",
    principle:
      "Playfair encrypts by digram (bigram) rules using a 5×5 letter square. The solver treats the square as the object to optimize, scores with English quadgrams, applies random perturbations (row/column swaps, whole-row/column swaps, square transpose), accepts better solutions via simulated annealing, and gradually approaches the true square.",
    usage: "Paste Playfair ciphertext (longer is more stable); the tool anneals/hill-climbs and outputs the recovered square and plaintext.",
    examples: [{ in: "a fairly long Playfair ciphertext", out: "5×5 square + plaintext" }],
    tips: ["On short ciphertext the result is unstable; run it several times. Note Playfair merges I/J and inserts padding letters into the plaintext, so the recovered text carries these traces."],
    aka: ["playfair crack", "playfair 爬山", "playfair 破解", "playfair破解", "普莱费尔破解",
      "playfair solver", "playfair爬山", "模拟退火", "双字母密码破解", "5x5方阵破解", "playfair cracker", "普莱费尔爬山"],
  },
};
