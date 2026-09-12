/*
 * edu-t508.en.js — English edu cards for T508 batch 1 (classicExt4.js).
 * homophonic / doubleTrans / pollux / morbit / bookCipher / turningGrille / kenny
 * Example outputs mirror the zh shard (real runs, test_batch1.mjs).
 */
export default {
  homophonic: {
    what: "Homophonic substitution — the advanced substitution cipher: each plaintext letter maps to a SET of ciphertext symbols (homophones). Encryption picks one per occurrence (round-robin or seeded random), spreading frequent letters over many symbols so frequency analysis collapses.",
    principle:
      "Agree on a symbol pool (default: two-digit numbers `00`–`99`, 100 symbols) and distribute it over the 26 letters — proportional to English letter frequency (E gets the most) or evenly. The result is the key table; each symbol belongs to exactly one letter (injective), so decryption is unambiguous.\n\n" +
      "Encrypt: letter → one homophone from its set (round-robin, or random by seed). Decrypt: symbol → its letter. Non-letters pass through unchanged.\n\n" +
      "The table is derived deterministically (FNV-1a hash + mulberry32 shuffle) from key + pool + distribution — the same parameters always rebuild the same table.",
    usage: "Defaults (00-99 pool, frequency distribution, round-robin) plus any key string; decrypt with the same parameters. Custom character pools (one homophone per character, ≥26 distinct) and seeded random selection are available.",
    examples: [
      { in: "HELLO", param: "key CTF, frequency, round-robin", out: "8002824511", desc: "The two L's took different homophones" },
      { in: "8002824511", param: "same params, decrypt", out: "HELLO", desc: "Symbol → letter, lossless round-trip" },
    ],
    tips: [
      "In digit-pool mode do not put digits in the plaintext — they collide with ciphertext symbols (the tool errors out).",
      "Cracking relies on pattern-word matching, not single-letter frequencies; suspect it when you see two-digit numbers about twice the plaintext length.",
      "Under frequency distribution E gets ~12 homophones and Z gets 1 — that is exactly the anti-frequency-analysis property. Reference: https://www.dcode.fr/chiffre-homophonique .",
    ],
    aka: ["同音替换", "同音密码", "homophonic", "homophonic substitution", "homophonique", "homophone cipher", "同形替换", "多符号替换", "同音替代", "抗频率分析替换", "homophonic cipher", "multi-symbol substitution"],
  },

  doubleTrans: {
    what: "Double transposition — columnar transposition applied twice: encrypt with key 1, then encrypt the result with key 2. A single pass leaks column-length statistics; two layers stacked defeat that, and both world wars actually used it.",
    principle:
      "Exactly the semantics of this toolbox's 「Columnar」 op, applied twice:\n\n" +
      "1. Keep A-Z only, write the plaintext row-wise into a grid of width = key length;\n" +
      "2. Read columns in the key's alphabetical order (ties by original position) → first layer;\n" +
      "3. Repeat with key 2 → final ciphertext.\n\n" +
      "Decryption inverts in reverse order (key 2 then key 1). Column lengths follow uniquely from ciphertext length mod key width, so no extra information is needed.",
    usage: "Type two key words (defaults BATTLE / FIELD); decrypt with the same pair. Spaces and punctuation are stripped (classical convention) — you get a pure letter stream back.",
    examples: [
      { in: "WEAREDISCOVEREDFLEEATONCE", param: "key1 BATTLE, key2 FIELD", out: "WDVDOEECAOEIELTSRENRAEECF", desc: "The classic sentence, double-encrypted" },
      { in: "WDVDOEECAOEIELTSRENRAEECF", param: "same keys, decrypt", out: "WEAREDISCOVEREDFLEEATONCE", desc: "Peel both layers in reverse" },
    ],
    tips: [
      "Identical keys degenerate to a single pass (much weaker) — avoid in practice.",
      "Identification matches single columnar: letter frequencies intact, digram statistics destroyed.",
      "Practice the single-layer 「Columnar」 op first. Reference: https://www.dcode.fr/chiffre-double-transposition .",
    ],
    aka: ["double transposition", "double columnar", "double columnar transposition", "双重列移位", "双重置换", "two-layer columnar", "double transposition cipher", "两次列移位", "双重换位", "double permutation", "双重移位", "双密钥列移位"],
  },

  pollux: {
    what: "Pollux cipher — Morse code wrapped in symbol pools: dots, dashes and separators each map to a group of digits (or other symbols); the ciphertext picks among them so the Morse structure disappears. Named after the star Pollux (β Geminorum).",
    principle:
      "Three disjoint symbol sets (dCode default partition):\n\n" +
      "- dot `.` → `0,4,7`\n- dash `-` → `1,5,8`\n- separator → `2,3,6,9`\n\n" +
      "The ten digits each belong to exactly one class. Encrypt: text → Morse (letter separator between letters; word gap = double separator in this tool's default policy — round-trippable; dCode's page reading uses a single separator, losing word gaps — both policies supported). Every dot/dash/separator becomes one symbol from its set (round-robin or seeded random).\n\n" +
      "Decrypt: symbol → dot/dash/separator → Morse → text. Only the class membership matters, not which member was chosen.",
    usage: "Defaults (partition + round-robin + double separator) work out of the box; the mapping field accepts custom sets including letters (e.g. dCode's extended `0378AEFMOPQXYZ,145BCGJNRTW,269DHIKLSUV`).",
    examples: [
      { in: "SOS", param: "default mapping, round-robin", out: "04721583047", desc: "Morse ...---... plus two letter separators = 11 symbols" },
      { in: "04721583047", param: "default mapping, decrypt", out: "SOS", desc: "Each symbol classified back to Morse" },
    ],
    tips: [
      "All-digit ciphertext with an even spread over every digit suggests Pollux.",
      "The three sets must be disjoint or decryption is ambiguous — the tool rejects overlaps and names the symbol.",
      "Single-separator policy compresses word gaps away on decrypt (the information is absent); letters remain intact. Reference: https://www.dcode.fr/chiffre-pollux .",
    ],
    aka: ["pollux", "pollux cipher", "pollux code", "morse pollux", "数字摩斯密码", "波吕克斯密码", "morbit pollux", "pollux 摩斯", "chiffre pollux", "morse digit substitution", "双子星座密码", "north river three"],
  },

  morbit: {
    what: "Morbit cipher — Morse code wrapped by pairing: the separator-bearing Morse stream is cut into pairs of symbols; there are 9 possible pairs, and a 9-character key maps each pair to a digit 1-9.",
    principle:
      "Standard order of the 9 two-symbol groups (`.` dot, `-` dash, `/` separator):\n\n" +
      "`..`(1)　`.-`(2)　`./`(3)　`-.`(4)　`--`(5)　`-/`(6)　`/.`(7)　`/-`(8)　`//`(9)\n\n" +
      "The key is 9 characters; stable-sort them alphabetically to get each position's rank (any 9-character key yields a permutation of 1-9). The ciphertext digit of standard group $i$ = the rank of key position $i$.\n\n" +
      "Encrypt: text → Morse stream (`/` between letters, `//` between words) → pairs → digits. An odd-length stream gets one trailing `/` (matching dCode's example). Decrypt reverses everything; trailing pad separators are dropped.",
    usage: "The key must be exactly 9 characters (default MORSECODE, dCode's worked example). Duplicate letters are fine — ranks are positional, never colliding.",
    examples: [
      { in: "MORE BITS", param: "key MORSECODE", out: "32379749578158", desc: "dCode's official example (rank table 568931724)" },
      { in: "32379749578158", param: "same key, decrypt", out: "MORE BITS", desc: "Official example round-trip" },
    ],
    tips: [
      "Ciphertext is digits 1-9 with no 0 — the quickest tell apart from Pollux (which uses 0).",
      "Keyless brute force is only $9! = 362880$ candidates, prunable by Morse validity (e.g. no three consecutive `/`).",
      "Wrong key length errors immediately; non-Morse characters likewise. Reference: https://www.dcode.fr/chiffre-morbit .",
    ],
    aka: ["morbit", "morbit cipher", "morbit code", "morse morbit", "摩斯配对密码", "morse pair cipher", "chiffre morbit", "9-pair morse", "morbit 摩斯", "morse bigram cipher", "数字摩斯组", "morbit password"],
  },

  bookCipher: {
    what: "Book cipher — the Beale lineage: both sides share the same book (or any long text); encryption replaces each word with its position number in that text, leaving only digits.",
    principle:
      "Two numbering schemes:\n\n" +
      "- `word`: number every word of the whole text in order; plaintext word → the $N$-th word (1-based);\n- `line-word`: plaintext word → line $l$, word $w$.\n\n" +
      "Occurrence policy: `first` always takes the first occurrence (same word → same number); `next` advances from the previous position like real usage (repeated words get varying numbers, harder to attack).\n\n" +
      "Matching policy: loose (case-insensitive, strip surrounding punctuation — recommended) or exact (whole-word equality). Words absent from the book error out with a list.",
    usage: "Paste the shared text into the reference field (that is your book) and pick scheme + policy. The decrypting side must use a byte-identical text — one word off shifts everything.",
    examples: [
      { in: "the dog", param: "book 「the quick brown fox … the end」, word mode", out: "1.9", desc: "the = 1st word, dog = 9th word" },
      { in: "1.9", param: "same book, decrypt", out: "the dog", desc: "Numbers fetch the words back" },
    ],
    tips: [
      "A long text plus a string of small numbers (or `line.word` pairs) in a CTF screams book cipher — the text in the challenge is usually the book.",
      "Under `next`, repeated words get increasing numbers; a flood of identical numbers means the encoder used `first`.",
      "Avoid overly famous books (the Declaration of Independence and the Beale meme are favorites). Reference: https://www.dcode.fr/chiffre-par-livre .",
    ],
    aka: ["book cipher", "book code", "beale", "beale cipher", "书卷密码", "书本密码", "dictionary cipher", "shared-text cipher", "chiffre par livre", "word position encoding", "字位密码", "词位置编码", "书密码"],
  },

  turningGrille: {
    what: "Turning grille (Fleissner grille) — the rotating evolution of Cardan's grille: an N×N hole template; fill the exposed cells, rotate the grille 90°, fill again — four rotations cover the whole board exactly once.",
    principle:
      "The core validity rule is the rotation-orbit constraint: cell (r, c) rotates clockwise to $(c, N-1-r)$, and four rotations return home — those 4 cells form one orbit. **Exactly one hole per orbit** makes the 4 passes cover everything without overlap.\n\n" +
      "Writable cells = $\\frac{N^2 - (N \\bmod 2)}{4}$ (the center cell of odd N is self-mapping and forbidden).\n\n" +
      "Encrypt: each pass writes plaintext row-wise into the currently open cells; rotate and repeat; pad with X if short. Ciphertext = the full board read row-wise. Decrypt lays the ciphertext row-wise and reads through the same four passes.",
    usage: "Size 2-12. The grille field accepts three forms: empty = canonical (lowest-index cell per orbit); `seed:anything` = seeded random orbit picks; or an explicit `#`/`.` string (36 chars for 6×6). Both rotation directions supported — sender and receiver just need to agree.",
    examples: [
      { in: "ABCDEFGHIJKLMNOP", param: "4×4 explicit grille ##../##../..../...., clockwise", out: "ABEFCDGHMNIJOPKL", desc: "Hand-checkable full example" },
      { in: "ATTACKATDAWN", param: "6×6 canonical, pad X", out: "ATTACAXKATWNXXDXXXXXXXXXXXXXXXXXXXXX", desc: "Short plaintext padded to a full board" },
    ],
    tips: [
      "If decryption fails, re-check all four: size, grille, direction, pad character — any mismatch scrambles everything.",
      "The center cell of odd sizes is never read (self-mapping, forbidden); a 5×5 ciphertext is 24 characters, not 25.",
      "Keyless attack enumerates orbit choices — feasible for small N, so don't pick tiny grids. Reference: https://www.dcode.fr/chiffre-grille-tournante .",
    ],
    aka: ["turning grille", "fleissner", "fleissner grille", "turning grille cipher", "转动格栅", "旋转格栅", "grille tournante", "rotating grille", "fleissner cipher", "格栅密码", "转动格板", "cardan turning"],
  },

  kenny: {
    what: "Kenny speak — how Kenny talks in South Park: each letter becomes a triple of the syllables m/p/f; three positions of three choices give $3^3 = 27$ combinations covering 26 letters.",
    principle:
      "It is plain base-3: M=0, P=1, F=2, and the letter index is written as 3 ternary digits.\n\n" +
      "$$v = 9 d_1 + 3 d_2 + d_3, \\quad A{=}000(MMM),\\ B{=}001(MMP),\\ \\ldots,\\ Z{=}221(FFP)$$\n\n" +
      "The combination 222 (FFF) is unassigned on dCode's table — this tool extends it to a space by default (more practical); a strict mode keeps the original table (FFF errors). Other non-letters are dropped.",
    usage: "Type English to get the triple stream; paste an m/p/f string to decode (case and stray whitespace tolerated). Ciphertext length must be a multiple of 3 or the tool errors.",
    examples: [
      { in: "DCODE", out: "MPMMMFPPFMPMMPP", desc: "dCode's official example: MPM,MMF,PPF,MPM,MPP" },
      { in: "HELLO", out: "MFPMPPPMFPMFPPF", desc: "H=MFP E=MPP L=PMF L=PMF O=PPF" },
    ],
    tips: [
      "A long string of only m/p/f (length divisible by 3) is Kenny.",
      "Isomorphic to Bacon (5-bit binary vs 3-digit ternary) — Bacon-solving intuition transfers directly.",
      "FFF defaults to space; switch to strict mode if the challenge follows dCode's table exactly. Reference: https://www.dcode.fr/code-kenny-southpark .",
    ],
    aka: ["kenny", "kenny code", "kenny speak", "kenny language", "kenny southpark", "Kenny 语", "south park language", "mpf cipher", "mpf code", "肯尼语", "ternary alphabet", "kenny cipher"],
  },
};
