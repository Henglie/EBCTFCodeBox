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
 * tool's studio, credited within this box; the four svgs polybius/tapcode/adfgx/adfgvx are
 * made in-house (public-domain classic cipher rule tables).
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
};
