/*
 * edu-text-ppencode.en.js — PPEncode encoding English edu card (text).
 *
 * Translation of src/core/edu/edu-text-ppencode.js.
 * Op covered: ppencode
 * Pure data, no side effects. Export contract matches eduContent.js header.
 */
export default {
  ppencode: {
    what: "PPEncode — Perl keyword encoding. Encodes arbitrary byte streams into text that looks like a Perl program: a wall of Perl keywords (abs/ord/uc/print…) beginning with `#!/usr/bin/perl -w`. In CTF, a full page of Perl keyword gibberish is usually this.",
    principle:
      "Each raw byte randomly picks one 'candidate' from a pre-generated dictionary: a string of 2~45 Perl keywords, where each keyword maps to an index in a built-in 256-word table (index = alphabetical position), the whole string serving as an argument chain for chr. Output structure:\n\n" +
      "`#!/usr/bin/perl -w` + random prefix + `and print chr <candidate words> and print chr <candidate words> ...`\n\n" +
      "Each byte has 3 candidate encodings chosen at random, so the same input encodes differently every time. Decoding reverses it: the keyword sequence after each `chr` is looked up in a 768-entry reverse table to restore the original byte, then decoded as UTF-8.",
    usage: "encode: enter text, output the Perl keyword pseudo-program (UTF-8 byte stream, Chinese works). decode: paste the Perl keyword text to restore the original.",
    examples: [
      { in: "hi", param: "", out: "#!/usr/bin/perl -w\\n<keywords> and print chr ...", desc: "output differs every run (random candidates)" },
      { in: "flag{...}", param: "", out: "keyword pseudo-program", desc: "decode restores the original" },
    ],
    tips: [
      "Text starting with `#!/usr/bin/perl -w` and made of Perl function names (ord/uc/q/chr) → ppencode.",
      "Distinguish from aaencode/jjencode (JS symbol encodings): ppencode uses only Perl keywords; aaencode uses ﾟωﾟﾉ emoji-like symbols, jjencode uses `$=~[]` symbols.",
      "The random prefix is meaningless and dropped on decode; real data starts after `and print chr`.",
      "Encoding is a UTF-8 byte stream: Chinese takes 3 bytes and restores losslessly.",
    ],
    aka: ["ppencode", "perl编码", "perl关键字", "PPEncode", "perl混淆", "perl keyword encoding", "perl程序编码", "ppenc", "perl伪程序", "关键字编码"],
  },
};
