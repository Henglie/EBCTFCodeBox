// English edu shard: fancy 8 (albam/blub/cow/carbonaro/emojiAes/pietExec/spoon/wabun)
// + modern 8 (rc2/dlp/elgamal/knapsack/trivium/grainV1/grain128aead/simonSpeck).
// Pure data, no import, no side effects.
export default {
 // ============ fancy ============
  albam: {
    what: "The Latin-alphabet version of the traditional Hebrew Albam substitution cipher: split the 26 letters into two halves and swap the paired positions.",
    principle:
      "Split the 26 letters into two halves `ABCDEFGHIJKLM` and `NOPQRSTUVWXYZ`, then swap by position: A↔N, B↔O, …, M↔Z.\n\n" +
      "Since each half is exactly 13 letters, \"shifting by half the alphabet\" is numerically equivalent to a shift of 13, i.e. $c \\equiv (c+13) \\bmod 26$ — the result is identical to ROT13. It is an involution: the same table both encrypts and decrypts, so running it twice returns the original.",
    usage: "encode and decode use the same table (involution); non-letters pass through unchanged, and case is preserved per character.",
    examples: [
      { in: "HELLO", out: "URYYB", desc: "A↔N…M↔Z, equivalent to ROT13" },
      { in: "URYYB", out: "HELLO", desc: "run it again to restore" },
    ],
    tips: [
      "The Latin Albam output is byte-for-byte identical to ROT13 — recognizing one means recognizing the other.",
      "The Hebrew tradition has three forms Atbash / Albam / Atbah; Albam is the \"half-shift swap\" one.",
    ],
    aka: ["albam", "albam cipher", "albam码", "希伯来albam", "אלב״ם", "半移位互换", "字母对半互换",
          "希伯来置换密码", "atbash albam atbah", "albam置换", "拉丁albam", "rot13等价",
          "Hebrew albam", "letter half-swap", "Latin albam", "rot13 equivalent"],
  },

  blub: {
    what: "An Ook-family dialect of Brainfuck: it replaces BF's 8 instructions with pairwise combinations of the three tokens `Blub. Blub? Blub!`.",
    principle:
      "Just like Ook!, it pairs up three tokens (`Blub.`, `Blub?`, `Blub!`) into 8 combinations, each mapping one-to-one to Brainfuck's 8 instructions:\n\n" +
      "`Blub. Blub?`→`>`, `Blub? Blub.`→`<`, `Blub. Blub.`→`+`, `Blub! Blub!`→`-`, `Blub! Blub.`→`.`, `Blub. Blub!`→`,`, `Blub! Blub?`→`[`, `Blub? Blub!`→`]`.\n\n" +
      "This tool's encode compiles text into Blub source; decode runs a built-in BF interpreter (30000-byte tape, 8-bit wraparound, 5-million-step cap to prevent infinite loops) and outputs the result.",
    usage: "encode: text → Blub source; decode: run the Blub source as a program and output the result. The token count must be even.",
    examples: [
      { in: "Hi", out: "Blub. Blub. …（a stream of paired tokens）", desc: "encode increments/decrements per byte then outputs" },
    ],
    tips: [
      "A screen full of `Blub.` `Blub?` `Blub!` is it — an Ook! family dialect, just with Ook swapped for Blub.",
      "The total token count is always even; parse two at a time.",
    ],
    aka: ["blub", "blub!", "blub语言", "blub方言", "ook同族", "ook家族", "brainfuck方言", "bf方言",
          "blub esolang", "深奥语言blub", "blub. blub? blub!", "brainfuck变体", "bf衍生",
          "blub language", "blub dialect", "ook family", "brainfuck variant"],
  },

  cow: {
    what: "The COW (MOO) esoteric language, designed by Sean Heber in 2003: 12 instructions all built from case variations of `moo`, riffing on cow sounds.",
    principle:
      "All 12 instructions are spelled from case combinations of m/o/O: `moo` (loop end), `mOo` (move pointer left), `moO` (move pointer right), `mOO` (execute the current cell's value as an instruction code), `Moo` (if current cell is 0 read input, else output as ASCII), `MOo` (decrement current cell), `MoO` (increment current cell), `MOO` (loop start, if cell is 0 jump past the matching moo), `OOO` (zero the cell), `MMM` (register store/load), `oom` (read integer), `OOM` (output integer).\n\n" +
      "Case-sensitive. `MOO … moo` forms a while loop, and `mOO` gives it a \"self-interpreting\" ability. This tool's encode generates source linearly (adjust the value to the target then output with `Moo`, no loops); decode runs a built-in interpreter (5-million-step cap).",
    usage: "encode: text → COW source (linear version, cannot encode NUL bytes); decode: execute the COW program and output the result.",
    examples: [
      { in: "Hi", out: "MoO MoO … Moo …", desc: "MoO accumulates to the target ASCII then Moo outputs" },
    ],
    tips: [
      "A screen full of mixed-case moo/mOo/moO/MOO is COW — don't confuse it with plain Brainfuck.",
      "This tool's linear encode errors on a NUL byte (Moo seeing 0 reads input instead of outputting).",
    ],
    aka: ["cow", "moo", "cow语言", "moo语言", "cow esolang", "奶牛语言", "sean heber", "cow深奥语言",
          "brainfuck衍生", "12指令", "moo指令集", "cowlang", "牛语言",
          "cow language", "moo language", "cow esoteric language", "brainfuck derivative"],
  },

  carbonaro: {
    what: "A monoalphabetic substitution cipher used by the early-19th-century Neapolitan Carbonari secret society, based on the 21-letter Italian alphabet.",
    principle:
      "The Italian alphabet has only 21 letters (no J K W X Y). The plaintext alphabet `ABCDEFGHILMNOPQRSTUVZ` maps by position to the ciphertext alphabet `OPGTIVCHERNMABQLZDUFS`: A→O, B→P, C→G…\n\n" +
      "This table happens to be an involution: A↔O, B↔P, C↔G, D↔T, E↔I, F↔V, L↔R, M↔N, S↔Z swap pairwise, while H/Q/U are fixed points. So encryption and decryption share the same table. Characters outside the alphabet (including J K W X Y, digits, symbols) pass through unchanged.",
    usage: "encode and decode use the same involutive table; case is preserved per character, and characters outside the 21 letters are unchanged.",
    examples: [
      { in: "CIAO", out: "GEOA", desc: "C→G I→E A→O O→A" },
      { in: "GEOA", out: "CIAO", desc: "same table restores" },
    ],
    tips: [
      "An Italian context + 21 letters (missing J K W X Y) is its signature.",
      "This implementation uses the published authoritative historical table (the Carbonaro alphabet from thecipher site), not some tool's internal table.",
    ],
    aka: ["carbonaro", "carbonaro cipher", "carbonaro码", "烧炭党密码", "carboneria", "烧炭党",
          "那不勒斯密码", "意大利单表替换", "carbonari cipher", "carbonaro alphabet", "共济会式社团密码", "意大利21字母",
          "Carbonari cipher", "Neapolitan cipher", "Italian monoalphabetic substitution", "Italian 21-letter alphabet"],
  },

  emojiAes: {
    what: "The full emoji-aes (matching GitHub aaronhorler/emoji-aes): AES-encrypt first, then replace each base64 ciphertext character with an emoji.",
    principle:
      "Two layers: ① AES-256-CBC in CryptoJS's OpenSSL `Salted__` format — a random 8-byte salt is run through EVP_BytesToKey(MD5) to derive a 32-byte key + 16-byte IV, producing `base64(\"Salted__\" + salt + ciphertext)` (with the `U2FsdGVk` prefix). ② Each of the 65 possible base64 characters (a-z A-Z 0-9 + / =) is replaced one-by-one with an emoji per a fixed emoji table.\n\n" +
      "There's also a rotation parameter: rotate the 65-emoji table by some amount, effectively layering an extra offset onto the substitution layer.",
    usage: "Fill in password (AES passphrase) and rotation (0-64, emoji-table rotation, default 0). encode: plaintext → emoji string; decode: emoji string → plaintext.",
    examples: [
      { in: "flag{demo}", param: "password=key, rotation=0", out: "🍎🍏…（emoji string）", desc: "AES-encrypted then converted to emoji" },
    ],
    tips: [
      "If reverse-mapping the emoji yields base64 starting with `U2FsdGVk` (i.e. Salted__), it's almost certainly emoji-aes.",
      "If it won't decode, check the password first, then whether the rotation matches — both must line up.",
    ],
    aka: ["emoji-aes", "emojiaes", "emoji aes", "emoji加密", "表情加密", "aaron horler", "emoji-aes加密",
          "aes emoji", "表情符号加密", "salted emoji", "u2fsdgvk emoji", "cryptojs emoji", "emoji密文",
          "emoji encryption", "emoji ciphertext"],
  },

  pietExec: {
    what: "A Piet graphical-language interpreter: a Piet program is a colorful abstract painting; this tool treats the color-block grid as a program, executes it, and outputs the result (matching npiet).",
    principle:
      "Piet uses 18 colors (6 hues × 3 lightnesses) plus black and white, for 20 \"codels\" total. The program starts at the top-left; a direction pointer DP (right/down/left/up) and a codel chooser CC (left/right) control movement. On each step it moves from the current same-color block to the next, and the instruction is looked up from \"hue-change steps (0-5) × lightness-change steps (0-2)\" (push/pop/add/sub/…/outnum/outchar, etc.); a push pushes the size of the block just left. Black blocks block movement; white blocks let it slide freely without executing instructions.\n\n" +
      "This tool's input is a plain-text grid (to avoid depending on image decoding): each block is written as a color-code token — hue initial R/Y/G/C/B/M + lightness suffix l (light) / blank (normal) / d (dark), black K, white W; 6-digit hex is also accepted and auto-quantized to the nearest Piet color. As a Turing-complete language it has no inverse operation, so it only executes (one-way run), with a step cap (1 million) + an output cap to prevent infinite loops.",
    usage: "Input the color-block grid text (each line is space-separated tokens, must be rectangular). Running outputs the program result + an execution summary (steps, final stack). Execute only, no reverse.",
    examples: [
      { in: "Rl R Rd\nR  W  R", out: "(program output) + execution summary", desc: "tokens: Rl=light red R=red Rd=dark red K=black W=white" },
    ],
    tips: [
      "Remember the instruction is decided by \"hue difference × lightness difference between adjacent blocks\", not the color itself.",
      "No stdin, so innum/inchar read empty; halting is detected by repetition of the (cx,cy,dp,cc) state.",
    ],
    aka: ["piet", "pietexec", "piet执行", "piet解释器", "piet语言", "npiet", "彩色深奥语言", "图形编程语言",
          "codel", "david morgan-mar", "piet interpreter", "色块语言", "抽象画程序",
          "piet execution", "color-block language", "graphical programming language"],
  },

  spoon: {
    what: "The Spoon esoteric language (designed by Steven Goodwin): it replaces Brainfuck's 8 instructions with a set of Huffman-style prefix codes, turning the whole program into a string of 0s and 1s.",
    principle:
      "Each of the 8 BF instructions maps to a variable-length prefix code: `+`=`1`, `-`=`000`, `>`=`010`, `<`=`011`, `[`=`00100`, `]`=`0011`, `.`=`001010`, `,`=`0010110`, plus Debug=`00101110` (no BF equivalent; consumed during decode but produces no character).\n\n" +
      "These are prefix codes (no code is a prefix of another), so they can be greedily parsed bit-by-bit without ambiguity. This tool's encode converts BF source into a 0/1 string (non-instruction characters ignored); decode restores the 0/1 string back to BF source (strict round-trip, errors on illegal bits or trailing leftovers). Note: it does BF↔Spoon code conversion, it does not execute the program.",
    usage: "encode: Brainfuck source → Spoon binary string; decode: Spoon 0/1 string → Brainfuck source. decode first strips non-0/1 characters.",
    examples: [
      { in: "+-", out: "1000", desc: "+ → 1, - → 000" },
      { in: "1000", out: "+-", desc: "prefix-code greedy restore" },
    ],
    tips: [
      "A string of pure 0/1 that doesn't look like a base encoding — try decoding it as Spoon prefix code into Brainfuck.",
      "Spoon is a BF↔binary converter; what you decode is BF source, and you still have to run the BF to get plaintext.",
    ],
    aka: ["spoon", "spoon语言", "spoon esolang", "steven goodwin", "brainfuck前缀码", "bf二进制", "霍夫曼式前缀码",
          "spoon深奥语言", "brainfuck变体", "bf方言", "prefix code brainfuck", "01串brainfuck", "spoon码",
          "spoon language", "brainfuck prefix code", "bf binary", "spoon code"],
  },

  wabun: {
    what: "Wabun code (和文モールス符号): the mapping between Japanese kana and Morse code.",
    principle:
      "Unlike Latin Morse, Wabun gives each kana its own dot-dash code, e.g. `イ`=`.-`, `ロ`=`.-.-`, `ハ`=`-...`. Voiced/semi-voiced sounds are not encoded separately but as the base sound followed by a standalone mark: dakuten `゛`=`..`, handakuten `゜`=`..--.`, plus the long-vowel `ー`=`.--.-`, comma `、`, etc.\n\n" +
      "This tool's encode first NFD-decomposes the input (ガ → カ + combining dakuten), normalizes hiragana to katakana and small kana to large kana, then looks up each; decode, on hitting a voiced/semi-voiced mark, re-inserts the combining mark and NFC-composes back to the voiced sound. Convention: dots/dashes within a kana are space-separated, and words are separated by ` / `.",
    usage: "encode: kana → Morse (dots/dashes space-separated, words by /); decode: Morse → kana. Both hiragana and katakana can be input; internally handled uniformly.",
    examples: [
      { in: "イロハ", out: ".- .-.- -...", desc: "look up each kana in the Wabun table" },
      { in: "-... ..", out: "バ", desc: "ハ + dakuten → バ (NFC composition)" },
    ],
    tips: [
      "When a dot-dash code decodes into gibberish as Latin letters, try Wabun (decode by kana).",
      "Voiced sounds are represented in two parts \"base sound + dakuten `..`\" — don't treat it as one whole code.",
    ],
    aka: ["wabun", "wabun code", "和文摩尔斯", "和文モールス", "和文モールス符号", "日文摩尔斯", "假名摩尔斯",
          "日语摩尔斯电码", "kana morse", "japanese morse", "wabun摩尔斯", "片假名摩尔斯", "和文电码",
          "Japanese Morse", "kana Morse code"],
  },

 // ============ modern ============
  rc2: {
    what: "The RC2 symmetric block cipher (Rivest 1987, published as RFC 2268): 64-bit blocks, variable-length key, common in early export-grade encryption.",
    principle:
      "64-bit block (four 16-bit little-endian words), key 1..128 bytes, plus an \"effective key bits\" parameter T1 controlling the key's real strength (an export-control legacy; this tool defaults to key bytes × 8). The key is first expanded through an official 256-byte permutation table `PITABLE` into 64 16-bit round-key words.\n\n" +
      "Encryption alternates two round types: MIXING (addition, AND/AND-NOT combinations, rotate-left by 1/2/3/5 bits) and MASHING (use the low 6 bits of the current word to index the round key). The order is 5 mix rounds → mash → 6 mix rounds → mash → 5 mix rounds. This tool supports ECB/CBC + PKCS#7 padding.",
    usage: "Fill in the key (optional encoding utf8/hex/base64/latin1), effective key bits (0=auto), mode (ECB/CBC; CBC needs an 8-byte IV), and ciphertext encoding. encode to encrypt / decode to decrypt.",
    examples: [
      { in: "hello", param: "key=secret, mode=CBC, iv=0000000000000000", out: "base64 ciphertext", desc: "RFC 2268 core" },
    ],
    tips: [
      "64-bit block → ciphertext length is a multiple of 8 bytes.",
      "If it won't decode, check the \"effective key bits\" first — RC2 ciphertext is bound to this parameter, not just the key itself.",
    ],
    aka: ["rc2", "rc2密码", "rivest cipher 2", "rfc 2268", "rfc2268", "arc2", "ron rivest rc2",
          "rc2分组密码", "rc2 cipher", "pitable", "可变密钥分组密码", "rc2算法",
          "rc2 block cipher", "variable-key block cipher"],
  },

  dlp: {
    what: "A discrete-logarithm solver: given g, h, p, find the exponent x such that $g^x \\equiv h \\pmod p$. The discrete log is the security foundation of DH / ElGamal / DSA.",
    principle:
      "Two algorithms are provided (both $O(\\sqrt n)$ time, where n is the subgroup order, default p-1):\n\n" +
      "① BSGS (Baby-step Giant-step): let $m=\\lceil\\sqrt n\\rceil$, first store $g^j\\,(j=0..m-1)$ in a hash table (baby step), then compute $h\\cdot(g^{-m})^i$ and look it up (giant step); a hit gives $x=i\\cdot m+j$. Deterministic, returns the smallest non-negative x, but needs $O(\\sqrt n)$ memory.\n\n" +
      "② Pollard's rho for logarithms: a three-partition additive walk + Floyd cycle detection finds a collision to solve for x, in $O(1)$ space, saving memory when the order is huge. Works best when the subgroup order is prime.",
    usage: "In params fill g, h (leave blank to take from the input box), p, optional order (subgroup order, default p-1), method (bsgs/rho), and step cap. Outputs x and a verification.",
    examples: [
      { in: "", param: "g=2, h=22, p=29", out: "x = ...（such that 2^x ≡ 22 mod 29）", desc: "BSGS computes small orders directly" },
    ],
    tips: [
      "DLP is easy to solve when the order is small or factors into small prime powers; getting order right greatly shrinks the search.",
      "BSGS is memory-hungry, rho saves memory, both $O(\\sqrt n)$ — don't expect it to break a real 2048-bit DH.",
    ],
    aka: ["dlp", "离散对数", "discrete logarithm", "discrete log", "离散对数问题", "bsgs", "baby step giant step",
          "大步小步", "pollard rho", "求离散对数", "discrete logarithm problem", "dlog", "离散对数求解",
          "discrete log solver"],
  },

  elgamal: {
    what: "ElGamal public-key encryption (1985): asymmetric encryption based on the discrete-log problem, where the ciphertext is a pair of numbers (c1, c2).",
    principle:
      "Public parameters: a large prime p, a primitive root g. Private key x, public key $y=g^x \\bmod p$.\n\n" +
      "Encryption (plaintext $m<p$): pick random $k\\in[1,p-2]$, compute $c_1=g^k \\bmod p$, $c_2=m\\cdot y^k \\bmod p$; ciphertext = $(c_1,c_2)$.\n\n" +
      "Decryption: shared secret $s=c_1^x \\bmod p$, invert via Fermat's little theorem $s^{-1}=s^{p-2}\\bmod p$, plaintext $m=c_2\\cdot s^{-1}\\bmod p$. This tool uses crypto.getRandomValues for random k; plaintext must be < p.",
    usage: "For encryption fill p, g, y (ciphertext format `c1,c2` comma-separated); for decryption fill p, x. Plaintext/output encoding can be dec/hex/base64/utf8.",
    examples: [
      { in: "5", param: "p=2357, g=2, y=1185", out: "c1,c2（e.g. 1490,2042）", desc: "the same plaintext gives different c1/c2 each time (random k)" },
    ],
    tips: [
      "The same plaintext encrypts to different ciphertext each time (probabilistic encryption), because k is random every time.",
      "Reusing the same k for two messages leaks information — a classic ElGamal attack point.",
    ],
    aka: ["elgamal", "elgamal加密", "elgamal cipher", "elgamal encryption", "埃尔加莫尔", "taher elgamal",
          "公钥加密", "非对称加密", "离散对数加密", "elgamal公钥", "c1 c2密文", "elgamal算法",
          "public-key encryption", "asymmetric encryption", "discrete-log encryption"],
  },

  knapsack: {
    what: "Merkle-Hellman knapsack public-key encryption (1978): one of the earliest public-key schemes, relying on the \"trapdoor\" of a superincreasing sequence, later broken by Shamir.",
    principle:
      "Private key: a superincreasing sequence $w=(w_1..w_n)$ (each term greater than the sum of all preceding), modulus $q>\\sum w_i$, multiplier r (gcd(r,q)=1). Public key: $\\beta_i=(w_i\\cdot r)\\bmod q$, a seemingly ordinary knapsack.\n\n" +
      "Encryption: take plaintext bit-by-bit, n bits per block, ciphertext $c=\\sum m_i\\beta_i$. Decryption: compute $c'=(c\\cdot r^{-1})\\bmod q$; since $c'\\equiv\\sum m_i w_i$ and this sum is < q so isn't truncated, a greedy pass (largest to smallest) over the superincreasing sequence uniquely recovers each bit.\n\n" +
      "Security: density $d=n/\\log_2(\\max\\beta_i)$; when $d<0.9408$ LLL lattice reduction almost certainly breaks it. The original scheme was broken by Shamir (1984), so it's for teaching/CTF only.",
    usage: "Choose key source: demo (built-in n=8) / gen (enter term count n to generate on the spot) / manual (hand-enter w,q,r or public key β). encode outputs ciphertext blocks + key report, decode needs w/q/r filled back in. Ciphertext = comma-separated decimal blocks.",
    examples: [
      { in: "A", param: "keyMode=demo", out: "=== encryption report …CT: comma-separated blocks", desc: "built-in demo w=[2,3,6,13,27,52,105,210]" },
    ],
    tips: [
      "Low-density knapsacks (d<0.9408) crack almost instantly with LLL lattice reduction — a common CTF point.",
      "Decryption greedily subtracts largest to smallest; a nonzero remainder after subtracting means the key/ciphertext don't match.",
    ],
    aka: ["knapsack", "背包加密", "merkle hellman", "merkle-hellman", "背包密码", "背包公钥", "超递增背包",
          "knapsack cipher", "subset sum", "子集和加密", "背包公钥密码", "trapdoor knapsack", "mh背包",
          "knapsack encryption", "superincreasing knapsack"],
  },

  trivium: {
    what: "The Trivium stream cipher (selected in eSTREAM's hardware profile): 80-bit key + 80-bit IV, 288-bit internal state, extremely simple structure.",
    principle:
      "The internal state is 288 bits, strung into a ring by three nonlinear feedback shift registers. Initialization loads the 80-bit key into the first section, the 80-bit IV into the middle, sets the last three bits to 1, then idles for 1152 rounds (4×288) to warm up; afterward each round outputs 1 keystream bit, XORed with the plaintext. As a stream cipher it is self-inverse: running the ciphertext through with the same key+IV again yields the plaintext.\n\n" +
      "⚠ This tool's compatibility target is the \"fzxx (Feng Zhi Xia Xiang) / Trivium-Grain online site\" (trivium-grain.js.org). Its bit-order convention (key/IV not reversed, keystream MSB-first) differs from the official eSTREAM standard test vectors — so this box's output differs from the official KAT but is byte-for-byte identical to that author's library.",
    usage: "Fill in key (20 hex digits = 80 bits), IV (20 hex digits = 80 bits), and plaintext-side encoding. encode: plaintext → hex ciphertext; decode: hex → plaintext. Symmetric and reversible.",
    examples: [
      { in: "hello", param: "key=80000…(20hex), iv=00000…(20hex)", out: "hex ciphertext", desc: "XOR keystream, self-inverse" },
    ],
    tips: [
      "Recognition: 80-bit key + 80-bit IV + 288-bit state + 1152 warm-up rounds.",
      "This box follows the author's library bit order, so mismatch with official eSTREAM vectors is expected (compatible with the online site, not the KAT).",
    ],
    aka: ["trivium", "trivium流密码", "trivium cipher", "estream", "estream trivium", "特里维姆", "轻量流密码",
          "288位流密码", "trivium stream cipher", "de canniere preneel", "硬件流密码", "trivium算法",
          "lightweight stream cipher", "hardware stream cipher"],
  },

  grainV1: {
    what: "The Grain v1 stream cipher (selected in eSTREAM's hardware profile): 80-bit key + 64-bit IV, one 80-bit LFSR + one 80-bit NFSR + a filter function h.",
    principle:
      "It's built from an 80-bit linear feedback shift register (LFSR) and an 80-bit nonlinear feedback shift register (NFSR) plus a nonlinear filter/output function h, with an extremely small hardware footprint. After loading key/IV, initialization idles for 160 clocks (output fed back into both registers) to warm up; afterward each clock outputs 1 keystream bit XORed with the plaintext. Symmetric and reversible.\n\n" +
      "⚠ Same library and same caveats as Trivium: compatible with the \"fzxx (Feng Zhi Xia Xiang) / Trivium-Grain online site\". Its bit-order convention (bit array → byte LSB-first) differs from the official standard test vectors but is byte-interoperable with that author's library.",
    usage: "Fill in key (20 hex digits = 80 bits), IV (16 hex digits = 64 bits), and plaintext-side encoding. encode: plaintext → hex ciphertext; decode: hex → plaintext. Symmetric and reversible.",
    examples: [
      { in: "hello", param: "key=80000…(20hex), iv=0000…(16hex)", out: "hex ciphertext", desc: "LFSR80+NFSR80+h, 160-clock warm-up" },
    ],
    tips: [
      "Recognition: 80-bit key + 64-bit IV (shorter IV than Trivium), LFSR+NFSR dual registers.",
      "Same as Trivium: this box's bit order aligns with the online site, not the official eSTREAM KAT.",
    ],
    aka: ["grain", "grain v1", "grainv1", "grain流密码", "grain cipher", "grain v1流密码", "estream grain",
          "轻量流密码", "lfsr nfsr", "hell johansson maximov", "grain stream cipher", "grain算法",
          "lightweight stream cipher"],
  },

  grain128aead: {
    what: "Grain-128AEAD authenticated encryption (a NIST lightweight-cryptography standardization candidate): 128-bit key + 96-bit nonce, encrypting while producing a 64-bit authentication tag.",
    principle:
      "On the Grain-128 stream-cipher skeleton (128-bit LFSR + 128-bit NFSR) it adds a 64-bit authentication module. It both encrypts and authenticates (AEAD): encode output = ciphertext + a trailing 8-byte (64-bit) tag; decode decrypts first then recomputes the tag to compare, and if the tag doesn't match reports \"authentication failed\" and refuses output. It supports associated data AD (authenticated together but not encrypted).\n\n" +
      "⚠ Same-library caveat: compatible with the \"fzxx (Feng Zhi Xia Xiang) / Trivium-Grain online site\". The implementation does per-byte bit flipping via `swapBitsInByte` throughout, differing from the official NIST standard test vectors but byte-interoperable with that author's library.",
    usage: "Fill in key (32 hex digits = 16 bytes), nonce (24 hex digits = 12 bytes), optional AD (hex), and plaintext-side encoding. encode: plaintext+AD → hex ciphertext (with trailing 8-byte tag); decode: verify tag then output plaintext, erroring on failure. Not self-inverse.",
    examples: [
      { in: "hello", param: "key=000102…0F(32hex), nonce=…(24hex)", out: "hex ciphertext + 8-byte tag", desc: "change one byte and the tag won't match" },
    ],
    tips: [
      "AEAD is not self-inverse: the trailing 8 bytes are the tag; tampering causes authentication failure and refused decryption.",
      "Any mismatch in key/nonce/AD makes the tag fail — when debugging, check each one.",
    ],
    aka: ["grain128aead", "grain-128aead", "grain 128 aead", "grain128 aead", "认证加密", "aead", "nist轻量密码",
          "轻量级aead", "grain128", "认证加密流密码", "grain-128 aead", "lightweight aead", "grain aead",
          "authenticated encryption", "nist lightweight crypto"],
  },

  simonSpeck: {
    what: "The NSA's Simon and Speck families of lightweight block ciphers (2013): Simon is hardware-friendly, Speck is software-friendly, switched by parameter within one op.",
    principle:
      "The two families share the same set of sizes (block 32/48/64/96/128 bits × several key lengths), named `block-bits/key-bits`, e.g. Speck64/128. A block consists of two n-bit words (x,y), running a Feistel-style structure:\n\n" +
      "Speck is ARX (add-rotate-xor): $x=(\\mathrm{ROR}(x,\\alpha)+y)\\oplus k,\\ y=\\mathrm{ROL}(y,\\beta)\\oplus x$, with rotation constants α=7,β=2 when n=16 else α=8,β=3.\n\n" +
      "Simon is AND-rotate: $f(x)=(\\mathrm{ROL}(x,1)\\ \\&\\ \\mathrm{ROL}(x,8))\\oplus\\mathrm{ROL}(x,2)$, round transform $x'=y\\oplus f(x)\\oplus k$. The key schedule includes 5 62-bit constant sequences z. Round counts vary by variant. This tool uses BigInt throughout (>32-bit words to avoid overflow), ECB single/multi-block, and passes the official test vectors from the paper's Appendix C.",
    usage: "Choose algo (speck/simon), variant (block/key bits like 64/128), fill in key (hex, high word first). Plaintext/ciphertext are both hex. encode to encrypt / decode to decrypt. Data must be a whole multiple of the block size.",
    examples: [
      { in: "6574694c", param: "algo=speck, variant=32/64, key=1918111009080100", out: "a86842f2（paper vector）", desc: "Speck32/64 official KAT" },
    ],
    tips: [
      "NSA-made; recognize the ARX (Speck) / AND-rotate (Simon) structure; hex plaintext block size = block-bits/8.",
      "This op aligns with the official test vectors from the paper's Appendix C, so you can verify directly with the standard vectors.",
    ],
    aka: ["simon", "speck", "simonspeck", "simon speck", "simon/speck", "nsa轻量密码", "simon cipher", "speck cipher",
          "轻量级分组密码", "arx密码", "and-rotate", "lightweight block cipher", "simon and speck", "beaulieu",
          "nsa lightweight cipher", "arx cipher"],
  },
};
