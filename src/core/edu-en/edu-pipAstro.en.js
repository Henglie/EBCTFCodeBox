/*
 * edu-pipAstro.en.js — English edu cards for the symbol-numeral group (astroSymbols.js / pipNumerals.js).
 * astroSymbols (astronomical / zodiac symbols) · pipNumerals (pip numerals: dice / domino)
 * Example outputs come from the four-way verification runs (authority = CPython unicodedata name lookup).
 */
export default {
  astroSymbols: {
    what:
      "Astronomical / zodiac symbols — write celestial and zodiac names as their standard Unicode symbols: " +
      "SUN → ☉, MOON → ☽, MARS → ♂, and the twelve zodiac signs ARIES→♈ … PISCES→♓. It is a name ↔ single-symbol " +
      "character map; use it when a ciphertext mixes ♀♁♂♃♄-style glyphs.",
    principle:
      "The mapping is grounded in the **official character names** of The Unicode Standard character database: each " +
      "code point is uniquely identified by its Unicode name (U+2609 is named SUN, U+263D FIRST QUARTER MOON, and " +
      "U+2648–U+2653 are the twelve zodiac signs in order).\n\n" +
      "Two names disagree with common astronomical usage and are recorded verbatim: U+2640 is officially FEMALE SIGN " +
      "(astronomically Venus) and U+2642 is MALE SIGN (astronomically Mars) — the same glyphs serve both senses, which " +
      "is an existing Unicode fact.\n\n" +
      "Contract: encode splits input into letter runs; each whole word must be a name of the current set " +
      "(case-insensitive); unknown names and abbreviations are rejected explicitly, no abbreviation guessing; " +
      "punctuation and whitespace pass through. decode scans per character: a symbol of the current set maps to its " +
      "canonical uppercase name; a symbol of the other set raises a switch-set error; foreign symbols (e.g. ★) raise " +
      "an error. Historical glyphs of the same body (☀☼ for the Sun, the two half-moon phases, ⛢ vs ♅ for Uranus) " +
      "are accepted as decode aliases.",
    usage:
      "Encode English names (punctuation allowed) → symbol string; paste symbols to decode → uppercase names. " +
      "Pick the set first: planetary (☉☽☿♀♁♂♃♄♅♆♇ plus Ceres/Pallas/Juno/Vesta) or zodiac. If decoding fails, " +
      "check you are on the right set — cross-set symbols produce an explicit switch-set error.",
    examples: [
      { in: "SUN MOON MARS", param: "planetary", out: "☉ ☽ ♂", desc: "All four verification paths pass" },
      { in: "☉ ☽ ♂", param: "planetary · decode", out: "SUN MOON MARS", desc: "Aliases ☀☼→SUN, ☽☾→MOON also accepted" },
      { in: "Sun, Moon / Mars", param: "planetary", out: "☉, ☽ / ♂", desc: "Punctuation and spaces pass through" },
      { in: "☉, ☽ / ♂", param: "planetary · decode", out: "SUN, MOON / MARS", desc: "Reversible even with punctuation" },
      { in: "LEO VIRGO LIBRA", param: "zodiac", out: "♌ ♍ ♎", desc: "Zodiac set" },
      { in: "CAPRICORN AQUARIUS SAGITTARIUS", param: "zodiac", out: "♑ ♒ ♐", desc: "Canonical uppercase names on decode" },
    ],
    tips: [
      "Ciphertexts made of planetary glyphs or the twelve zodiac signs are the target shape; on failure switch sets first, then check spelling.",
      "U+2640/U+2642 double as gender signs: a ♀♂ mix may be an astronomical cipher or gender notation — judge by context.",
      "This op maps names ↔ symbols only; it does no birthday → sign inference (not a codec capability).",
      "Abbreviations (MER) and misspellings (VENUSX) are rejected — no invented IAU-abbreviation mappings.",
      "Authority: The Unicode Standard character database (locally verified via CPython unicodedata 15.1.0), rebuilt independently by name lookup.",
    ],
    aka: [
      "astro symbols", "astronomical symbols", "zodiac symbols", "planetary symbols",
      "天文符号", "黄道符号", "星座符号", "行星符号", "太阳月亮符号", "alchemical symbols",
      "planet emojis", "horoscope symbols", "十二宫符号", "占星符号", "venus mars symbols",
    ],
  },

  pipNumerals: {
    what:
      "Pip numerals — write digits with dice / domino pips: the dice set maps 1–6 to ⚀⚁⚂⚃⚄⚅, and the domino set maps " +
      "two-digit pairs (0–6) to one domino-tile character (🀱🀲🀹 and friends). Use it on tile/dice-styled ciphertexts.",
    principle:
      "The mapping follows the pip semantics in official Unicode character names: U+2680–U+2685 are named " +
      "DIE FACE-1 … DIE FACE-6 (one code point per face); domino tiles from U+1F031 on are named DOMINO TILE " +
      "HORIZONTAL-00… and DOMINO TILE VERTICAL-00…, where the two digits in the name are the pips on each half " +
      "(each 0–6), 28 tiles in total.\n\n" +
      "Contract: dice mode encodes decimal digits one symbol per digit; 0 and 7–9 are explicit errors (no such faces). " +
      "Domino mode takes digits two at a time; odd lengths, values outside 0–6, back-face tiles and mismatched " +
      "orientations are explicit errors. Separators (space, comma, slash, pipe, parentheses) pass through.",
    usage:
      "Pick the system: dice (1–6, one symbol per digit) or domino (one tile per digit pair); domino mode also takes " +
      "an orientation (horizontal / vertical). Encode a digit string → symbols; paste symbols to decode → digits. " +
      "On failure check for 0/7–9 in dice mode, out-of-range digits in domino mode, or a flipped orientation.",
    examples: [
      { in: "123456", param: "dice", out: "⚀⚁⚂⚃⚄⚅", desc: "One die face per digit" },
      { in: "⚅⚄⚁⚃⚂⚀", param: "dice · decode", out: "652431", desc: "Lossless round trip" },
      { in: "00 01 11", param: "domino · horizontal", out: "🀱 🀲 🀹", desc: "One tile per digit pair" },
      { in: "🁡 🀺 🁊", param: "domino · horizontal · decode", out: "66 12 34", desc: "Orientation must match" },
      { in: "012345", param: "domino · horizontal", out: "🀲🁂🁒", desc: "Separators optional" },
    ],
    tips: [
      "Ciphertext over the six faces ⚀–⚅ → dice mode; over domino tiles 🀰–🁫 → domino mode (mind the orientation).",
      "Dice faces have no 0: a 0 anywhere makes dice mode fail by design — pad or switch to domino.",
      "Each domino tile carries two digits (0–6), denser than one digit per die face.",
      "The four-way verification authority is an independent CPython-unicodedata name-derived mapping, not the same source as this implementation.",
      "This is a digit ↔ symbol character map, not a dice/domino game simulator.",
    ],
    aka: [
      "pip numerals", "dice numerals", "die face symbols", "domino tiles", "domino numerals",
      "骰面记数", "骨牌记数", "点数符号", "骰子符号", "多米诺骨牌", "die face", "domino tile symbols",
      "dice cipher", "骨牌密码", "骰子密码",
    ],
  },
};
