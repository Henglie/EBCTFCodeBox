/*
 * edu-t508-b2.en.js — English edu cards for T508 batch 2 (encodingExt3.js).
 * crockford32 / alienAlphabet / futhark / countingRods / chuckUnary / wingdings / cardanGrille
 * Example outputs mirror the zh shard (real runs, test.mjs of 批2_编码映射).
 */
export default {
  crockford32: {
    what: "Crockford Base32 — the \"human-readable\" Base32 designed by Douglas Crockford (of JSON fame) in 2002, built to survive hand-copying. Four confusable letters are banned from the 32-symbol alphabet (I and L look like 1, O looks like 0, U averts accidental obscenity), and decoding tolerates o→0 and i/l→1.",
    principle:
      "Alphabet: `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (digits 0-9 plus 22 letters; value = index). Data is cut into 5-bit groups (5 bits per symbol, zero-padded tail) — same skeleton as RFC 4648 Base32, but no padding.\n\n" +
      "Optional check symbol: treat all bytes as one big-endian integer $N$ and append the symbol for $N \\bmod 37$ (37 = smallest prime above 32). Values 32-36 use five dedicated symbols `* ~ $ = U` — U, exiled from the data alphabet, returns as check value 36.\n\n" +
      "Hyphens are readability grouping only and ignored on decode; case-insensitive.",
    usage: "Plain Base32 transport by default; flip the check switch on both ends to catch transcription errors. The bit stream matches this toolbox's Base32 op (crockford variant) exactly — what's new here is the check symbol and hyphen discipline.",
    examples: [
      { in: "Hello", out: "91JPRV3F", desc: "5 bytes = 40 bits = exactly 8 symbols" },
      { in: "Hello", param: "check on", out: "91JPRV3FG", desc: "0x48656C6C6F mod 37 = 16 → append G" },
      { in: "91JPRV3FG", param: "check on, decrypt", out: "Hello", desc: "Verified then restored" },
    ],
    tips: [
      "A U in the ciphertext is almost certainly a check symbol — with the check off, U is rejected outright (not in the data alphabet).",
      "The mod-37 prime check detects single wrong symbols and adjacent transpositions — but only if you turn it on.",
      "Crockford's original page has no worked encoding example; outputs here are real runs. Reference: https://www.crockford.com/base32.html .",
    ],
    aka: ["crockford", "crockford base32", "Crockford Base32", "base32 crockford", "crockford base 32", "crockford encode", "crockford decode", "crockford32", "base32 checksum", "human readable base32", "克罗克福德", "crockford 校验"],
  },

  alienAlphabet: {
    what: "Alien alphabet — pop-culture \"alien speech\": the 26 Latin letters swapped one-for-one for 26 futuristic-looking Unicode symbols (⏃⏚☊⎅…, mostly from the Miscellaneous Technical block U+2300 plus APL signs). When ⏃⌰⟟⟒⋏ shows up in a CTF, this is it.",
    principle:
      "unicode mode (the dCode table): straight substitution, e.g. A=⏃(U+23C3), L=⌰(U+2330), Z=⋉(U+22C9). Non-letters pass through.\n\n" +
      "futurama2 mode (the Futurama AL2 \"self-modifying alphabet\", implemented at letter level): every symbol carries a value A=0…Z=25 and encryption is an autokey shift —\n\n" +
      "$$C_1 = P_1, \\quad C_i = (P_i + C_{i-1}) \\bmod 26$$\n\n" +
      "each letter is shifted by the value of the PREVIOUS CIPHERTEXT letter; decryption is $P_i = (C_i - C_{i-1} + 26) \\bmod 26$. The ciphertext is its own key — two identical adjacent symbols always decode the second one to A (difference 0).",
    usage: "unicode mode: paste letters in and out directly. futurama2 mode outputs a letter stream (the show's original glyphs exist only as images/fan fonts with no Unicode encoding — there is no standard codepoint table anywhere).",
    examples: [
      { in: "DCODE", out: "⎅☊⍜⎅⟒", desc: "dCode official example" },
      { in: "⏃⌰⟟⟒⋏", out: "ALIEN", desc: "The page-title example, reversed" },
      { in: "FUTURAMA", param: "futurama2 mode", out: "FZSMDDPP", desc: "dCode AL2 official example (autokey shift)" },
    ],
    tips: [
      "The show's AL1/AL2 glyphs are images and hobbyist fonts only; the unicode mode uses dCode's table — the only written Unicode mapping.",
      "AL2 recognition trick: the second of two identical adjacent symbols is always A; glyphs look angular, few wavy ones.",
      "Background signs hide AL1 easter eggs in many episodes (Drink Slurm, Venusians Go Home). Reference: https://www.dcode.fr/alien-language .",
    ],
    aka: ["alien alphabet", "alien language", "alienese", "futurama alien", "futurama alphabet", "AL1", "AL2", "alien symbols", "alien text", "alien language decoder", "外星字母", "外星文"],
  },

  futhark: {
    what: "Futhark — the runic alphabets of the ancient Germanic peoples, named after their first six letters f-u-th-a-r-k. Elder Futhark (2nd century) has 24 runes; the Viking Age compressed it into the 16-rune Younger Futhark (sounds merged). The Runic block lives at U+16A0–16FF.",
    principle:
      "elder mode, 24 runes in order: ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ. English A-Z follows dCode's practical mapping: C/K/Q→ᚲ, V/W→ᚹ, J/Y→ᛃ (same-sound mergers), X has no own rune and becomes ᚲᛊ (ks); TH→ᚦ and NG→ᛜ digraphs (THING→ᚦᛁᛜ).\n\n" +
      "younger mode, 16 long-branch runes fuþąrkhniastbmlʀ: ᚠᚢᚦᚬᚱᚴᚼᚾᛁᛅᛋᛏᛒᛘᛚᛦ, with heavier mergers — E/I→ᛁ, O→ᚬ, A→ᛅ, G/K→ᚴ, D/T→ᛏ, P/B→ᛒ, V/W/Y→ᚢ.\n\n" +
      "Decode tolerance: elder variants ᛋ/ᛝ and all younger short-twig forms (ᚭᚽᚿᛆᛌᛐᛓᛙᛧ).",
    usage: "Pick elder/younger, then paste English to encode or runes to decode. Encoding is lossy: C encodes to ᚲ which decodes to K (mergers are historical reality, not a bug) — for strict round-trips choose collision-free characters.",
    examples: [
      { in: "FUTHARK", out: "ᚠᚢᚦᚨᚱᚲ", desc: "elder: the alphabet's own name (TH digraph fires)" },
      { in: "FUTHARK", param: "younger mode", out: "ᚠᚢᚦᛅᚱᚴ", desc: "16 long-branch runes (A→ᛅ ár, K→ᚴ kaun)" },
      { in: "HELLO", param: "younger mode", out: "ᚼᛁᛚᛚᚬ", desc: "E/I merge→ᛁ, O→ᚬ (decodes back HILLO, by design)" },
    ],
    tips: [
      "Angular strings starting ᚠᚢᚦ are runes; 24 runes suggest Elder (early/continental), 16 suggest Younger (Viking inscriptions).",
      "TH/NG digraphs are on by default (THING→ᚦᛁᛜ is the phonetically right rendering); turn them off for letter-by-letter transliteration.",
      "ᛦ (ýr/ʀ) is the younger-only final rune, decoding to R; elder ᛇ(ï) decodes to Ï. Reference: https://www.dcode.fr/vieux-futhark .",
    ],
    aka: ["futhark", "futhorc", "runes", "runic alphabet", "elder futhark", "younger futhark", "runic", "viking alphabet", "norse runes", "卢恩符文", "如尼文", "runic decoder"],
  },

  countingRods: {
    what: "Counting rods — how China represented numbers with small sticks from the Spring-and-Autumn period through the Ming (Sunzi Suanjing: \"one is vertical, ten is horizontal\"). Unicode dedicates U+1D360+ to the vertical and horizontal forms of 1-9 plus 〇.",
    principle:
      "Vertical 𝍩-𝍱 (U+1D369-1D371) and horizontal 𝍠-𝍨 (U+1D360-1D368) alternate by position: counting from the right, odd positions (units, hundreds, hundred-thousands…) are vertical, even positions (tens, thousands…) horizontal — adjacent positions differ in form so a board layout never blurs. Zero is 〇 (U+3007; earlier just a blank).\n\n" +
      "Hence 231 = vertical-2 horizontal-3 vertical-1 → 𝍪𝍢𝍩; and 5089 = horizontal-5 〇 horizontal-8 vertical-9 → 𝍤〇𝍧𝍱.",
    usage: "Type decimal digit strings (spaces separate several numbers) to get rod numerals; paste rods to decode (either orientation accepted anywhere; 0 accepts 〇). No negatives/decimals (ancient red/black rods signed numbers — that's a combining character in Unicode, skipped for sanity).",
    examples: [
      { in: "231", out: "𝍪𝍢𝍩", desc: "Wikipedia example: vertical-2, horizontal-3, vertical-1" },
      { in: "5089", out: "𝍤〇𝍧𝍱", desc: "Wikipedia example: horizontal-5, zero, horizontal-8, vertical-9" },
      { in: "71824", out: "𝍯𝍠𝍰𝍡𝍤", desc: "Wikipedia example (Yongle Encyclopedia digits)" },
    ],
    tips: [
      "dCode's code-chinois page is a different thing (a scout stick cipher counting vowels/consonants) — name collision, unrelated.",
      "Recognition: only 𝍠-𝍱 and 〇; the top digit's orientation reveals the parity of the digit count.",
      "Song-era sources variant the shapes of 4/5/9; Unicode encodes the standard forms. Reference: https://en.wikipedia.org/wiki/Counting_rods .",
    ],
    aka: ["counting rods", "rod numerals", "rod calculus", "chinese counting rods", "算筹", "算筹数字", "rod numerals unicode", "sunzi suanjing", "vertical horizontal rods", "算筹记数", "rod digits", "chinese rods"],
  },

  chuckUnary: {
    what: "Chuck Norris unary code — the \"binary with only zeros\" made famous by a Codingame puzzle: information lives purely in the COUNT of zeros. Chuck Norris punched all the 1s out, so the ciphertext has none.",
    principle:
      "Each character becomes 7-bit (or 8-bit) ASCII and the whole bit stream is run-length encoded together:\n\n" +
      "- a run of $N$ ones → group `0` + group of $N$ zeros\n" +
      "- a run of $N$ zeros → group `00` + group of $N$ zeros\n\n" +
      "Groups are space-separated; there is NO separator between characters (runs merge across boundaries — in 1000011+1000011 the middle 11 and 1 fuse into one 111 run). Decoding walks group pairs to rebuild the bit stream, then re-slices by width.",
    usage: "Default 7-bit width (dCode/Codingame canon); if decoding fails try 8-bit. Ciphertext may contain only zeros and whitespace — anything else errors out.",
    examples: [
      { in: "CC", out: "0 0 00 0000 0 000 00 0000 0 00", desc: "bit stream 10000111000011: runs 1|0000|111|0000|11" },
      { in: "%", out: "00 0 0 0 00 00 0 0 00 0 0 0", desc: "0100101, six runs" },
      { in: "0 0 00 0000 0 000 00 0000 0 00", out: "CC", desc: "Reverse direction" },
    ],
    tips: [
      "Recognition: only 0s and spaces, with an even group count (prefix and count groups pair up).",
      "Bit length must be a multiple of the width — a 7-bit failure is usually an 8-bit message.",
      "The zero character can be swapped and ASCII replaced (A1Z26 etc.); this tool follows the dCode canon. Reference: https://www.dcode.fr/code-chuck-norris .",
    ],
    aka: ["chuck norris code", "chuck norris unary", "unary code", "unary coding", "codingame unary", "chuck norris", "binary run length", "unary cipher", "zeros only code", "一元码", "0 00 code", "norris code"],
  },

  wingdings: {
    what: "Wingdings — Microsoft's 1990s symbol fonts: the keyboard maps to hands, zodiac signs, religious symbols and small icons. The font's own Unicode cmap places its 224 glyphs at U+F020-F0FF private use (measured on this machine's wingding.ttf), while modern Unicode assigned real codepoints to most shapes (☺✈☠…).",
    principle:
      "Two codepoint modes:\n" +
      "- pua mode: char code + $\\mathrm{0xF000}$ (J→U+F04A). Needs the Wingdings font installed to see pictures, but is a strict 1:1 round-trip (exactly how Word represents symbol runs).\n" +
      "- unicode mode: real codepoints (J→☺ U+263A, Q→✈, N→☠, M→💣) visible in ordinary fonts. Tables from Alan Wood's font pages (all 95 slots 0x20-0x7E) and the Adobe ZapfDingbats encoding (zapf mode, unicode.org's official mapping file).\n\n" +
      "Four fonts: wingdings1 (mixed icons) / wingdings2 (checks and numbers) / wingdings3 (arrow family) / zapf (dingbat flourishes). Only visible ASCII 0x20-0x7E is mapped — unverifiable codepoints are not invented.",
    usage: "For CTF image challenges: look up glyphs to letters, paste here to decode; or encode plaintext into symbols for fun. In W2 unicode mode, T/W and S/X share codepoints (font-level duplicates) — decode takes the first.",
    examples: [
      { in: "JQNZ", out: "☺✈☠☪", desc: "The classics: J=smiley, Q=plane, N=skull, Z=crescent" },
      { in: "HI", out: "☟🖐", desc: "H=pointing-down hand, I=spread hand" },
      { in: "Hello", param: "zapf font", out: "★❅●●❏", desc: "Zapf Dingbats: H=★, e=❅, l=●, o=❏" },
    ],
    tips: [
      "\"Q33 NY\" was a 2001 hoax — Q33NY was not a World Trade flight number; the \"NYC\" eye-heart-city gag is Webdings, not Wingdings.",
      "The lone J in old Outlook emails is the Wingdings smiley ☺ — a fossil of rich-text quirks.",
      "pua output shows tofu without the font installed; use unicode mode to share. Reference: https://en.wikipedia.org/wiki/Wingdings .",
    ],
    aka: ["wingdings", "wingdings 2", "wingdings 3", "wingdings font", "dingbat", "dingbats", "zapf dingbats", "wingdings translator", "wingdings decoder", "symbol font", "webdings", "wingdings 转换"],
  },

  cardanGrille: {
    what: "Cardan grille — Girolamo Cardano's 1550 steganographic mask: a card with holes laid over paper; secrets are written only through the holes, the rest filled with innocent text. The recipient lays the same card on top and the secret appears. Unlike the 4-rotation turning grille, the Cardan grille never rotates.",
    principle:
      "The mask is an arbitrary-length string of `X` (solid) and `_` (hole).\n" +
      "- fill mode (dCode's main form): plaintext goes into the holes letter by letter; solid cells get seeded random uppercase letters (or a custom filler cycled).\n" +
      "- hide mode (the Cardinal Richelieu form): plaintext into the holes, cover-text characters fill the solid cells in order, surplus cover text dropped — producing a \"normal-looking\" passage.\n\n" +
      "Decryption: lay the mask over the equal-length ciphertext and read the holes. A ciphertext far longer than the plaintext is the tell; without the mask it's nearly unbreakable (probable-word attacks can estimate hole density).",
    usage: "Provide the mask (any length, not necessarily square); fill mode takes a seed or filler; hide mode needs a cover text at least as long as the solid cells. Decryption needs only mask + equal-length ciphertext.",
    examples: [
      { in: "OESDVBCNEOHDEEML", param: "mask XXX_XX_XX_X_X_XX", out: "DCODE", desc: "dCode's official decryption example" },
      { in: "DCODE", param: "same mask, fill mode, seed 7", out: "PSNLCADCJCMCOCBOKOVDLKCSOEEFOJ", desc: "Secret in holes, random letters elsewhere (seed-reproducible)" },
      { in: "DCODE", param: "hide mode + cover THEQUICKBROWN", out: "THEDQUCICOKDBERO", desc: "Solid cells spell THE DUC… — an innocent-looking line" },
    ],
    tips: [
      "Ciphertext length must equal mask length — cell-by-cell alignment is everything.",
      "Choose cover text that fits the context (love letters, memoranda) — exactly how Richelieu's people vetted mail.",
      "Without the mask, probable-word attacks estimate the hole rate; with it, decryption is instant. Reference: https://www.dcode.fr/grille-cardan .",
    ],
    aka: ["cardan grille", "grille de cardan", "cardano grille", "cardan cipher", "cardan mask", "grille cipher", "mask cipher", "卡丹格", "卡丹格栅", "cardano mask", "perforated grille", "cardan steganography"],
  },
};
