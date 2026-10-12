/*
 * eduImages.en.js — op edu-card reference-image map (opId → gallery reference image).
 *
 * Purpose: the gallery (public/codeimages/) has a set of encoding reference images that
 * "some op in this toolbox can auto-parse" (pigpen / Bacon / Braille / Polybius /
 * tap code / ADFGX / Morse variants…). Attaching these images to the corresponding op's
 * edu card lets users see the glyph/coordinate reference table right on the decode page,
 * without digging through the gallery.
 *
 * Why a standalone table (not folded into an eduContent shard):
 * eduContent's Object.assign is a **shallow merge** — a later shard object with the same
 * opId **entirely overrides** the earlier one. If image data were put in a new shard,
 * it would drag down and override that op's existing {what/principle/examples...}.
 * So the image map is maintained separately, and renderEduCard looks up this table
 * separately to overlay-render it — zero override risk, zero coupling.
 *
 * Contract: export default { [opId]: { src, cap } | Array<{src,cap}> }.
 * src is the image path relative to index.html (public/codeimages/xxx)
 * cap is the caption (describes what the image is)
 * One op can carry multiple images (e.g. morse has circular/mountain variant charts) → use an array.
 *
 * Red line: pure data, no import, no side effects. Only fill in opIds that truly exist in
 * the registry + files that truly exist in the gallery.
 * Image copyright: the 224-encoding images (webp/png) from similar tools belong to that
 * tool's studio, credited within this box; the svgs polybius/tapcode/adfgx/adfgvx are
 * made in-house (public-domain classic cipher rule tables), as are american-morse /
 * morse-rhythm / wabun / futhark / counting-rods / alien-alphabet / chuck-unary /
 * cardan-grille / tadpole / wingdings-zapf (per-image sources in the engineering archive).
 * baudot/decabit/pollux/morbit/straddle-checkerboard are likewise in-house (table values
 * taken from this tool's op runtime, slot-checked 363/0; provenance and licenses are archived in the project sources.md).
 */
export default {
  bacon: { src: "public/codeimages/bacon.png", cap: "Bacon cipher A/B five-bit letter reference table" },
  braille: { src: "public/codeimages/braille.png", cap: "Braille 6-dot ↔ letter reference table" },
  color: { src: "public/codeimages/color.webp", cap: "Color encoding reference" },
  dna: { src: "public/codeimages/dna.webp", cap: "DNA base codon ↔ letter reference table" },
  foursquare: { src: "public/codeimages/foursquare.webp", cap: "Four-square cipher 4-grid square diagram" },
  pigpen: { src: "public/codeimages/pigpen.webp", cap: "Pigpen cipher tic-tac-toe/cross grid ↔ letter reference" },
  semaphore: { src: "public/codeimages/semaphore.webp", cap: "Flag semaphore ↔ letter reference table" },
  polybius: { src: "public/codeimages/polybius.svg", cap: "Polybius 5×5 square (letter → row-column coordinate)" },
  adfgx: { src: "public/codeimages/adfgx.svg", cap: "ADFGX 5×5 cipher table (letter → double code A/D/F/G/X)" },
  adfgvx: { src: "public/codeimages/adfgvx.svg", cap: "ADFGVX 6×6 cipher table (26 letters + 10 digits → double code A/D/F/G/V/X)" },
  tapCode: { src: "public/codeimages/tapcode.svg", cap: "Tap code 5×5 table (row taps · pause · column taps)" },
  morse: [
    { src: "public/codeimages/morseircle.webp", cap: "Circular Morse reference dial" },
    { src: "public/codeimages/morsemountain.webp", cap: "Mountain-shape Morse reference chart" },
  ],
  americanMorse: { src: "public/codeimages/american-morse.svg", cap: "American Morse code table (. dot, - dash, _ long dash; spaces inside a code = internal gap)" },
  morseRhythm: { src: "public/codeimages/morse-rhythm.svg", cap: "Morse dot/dash symbol variant normalization chart (·− ↔ .-)" },
  wabun: { src: "public/codeimages/wabun.svg", cap: "Wabun (Japanese) Morse standard table (katakana/marks ↔ dots-dashes)" },
  futhark: { src: "public/codeimages/futhark.svg", cap: "Runic reference table (Elder 24 + Younger 16 + decode variants)" },
  countingRods: { src: "public/codeimages/counting-rods.svg", cap: "Counting rods: vertical/horizontal forms (units vertical, tens horizontal)" },
  alienAlphabet: { src: "public/codeimages/alien-alphabet.svg", cap: "Alien alphabet 26-symbol reference table (Unicode set, dCode table)" },
  chuckUnary: { src: "public/codeimages/chuck-unary.svg", cap: "Chuck Norris unary code rule chart (bitstream → runs → 0/00 groups)" },
  cardanGrille: { src: "public/codeimages/cardan-grille.svg", cap: "Cardan grille principle (X solid cells, _ holes; read letters through holes)" },
  tadpole: { src: "public/codeimages/tadpole.svg", cap: "Tadpole cipher 16 symbols ↔ hex nibble reference table" },
  wingdings: { src: "public/codeimages/wingdings-zapf.svg", cap: "Zapf Dingbats code table (wingdings op zapf range 0x21-0x7E)" },
  baudot: { src: "public/codeimages/baudot.svg", cap: "Baudot code table (ITA2/ITA1 letters + figures, 5-bit codes)" },
  decabit: { src: "public/codeimages/decabit.svg", cap: "Decabit pulse code table (values 0-126 ↔ 10-symbol +/− patterns)" },
  pollux: { src: "public/codeimages/pollux.svg", cap: "Pollux cipher symbol mapping (dot/dash/separator symbol sets)" },
  morbit: { src: "public/codeimages/morbit.svg", cap: "Morbit cipher symbol-pair ↔ digit reference (rank from 9-char key)" },
  straddleCheckerboard: { src: "public/codeimages/straddle-checkerboard.svg", cap: "Straddle checkerboard 3×10 board (top row 8 high-frequency letters + two blank-column prefixes)" },
};
