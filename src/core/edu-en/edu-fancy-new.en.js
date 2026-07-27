/*
 * edu-fancy-new.en.js — English edu shard (fancy encoding).
 *
 * Covers 1 op:
 * fancy: jjencode
 *
 * Pure data, no side effects, no import, no register. Merged in eduContent.js.
 */
export default {
 // ============ fancy: JJEncode ============
  jjencode: {
    what: "JJEncode — encodes arbitrary JavaScript source into equivalent executable code containing only symbols like [ ] ( ) ! + $ _ \" . = , ; and so on, which runs in a browser with the same effect as the original.",
    principle:
      "Invented by Yosuke Hasegawa (utf-8.jp). The core tricks:\n\n" +
      "1. Use `~[]` to get -1, then `++` to increment and build the digits 0..9;\n" +
      "2. Index characters out of a few identity expressions: `(![]+\"\")` gives \"false\", `(!\"\"+\"\")` gives \"true\", `({}+\"\")` gives \"[object Object]\", from which constructor / return / individual letters are assembled;\n" +
      "3. The global variable gv (default $) has its `gv.$` eventually assigned to the Function constructor;\n" +
      "4. At the end, `gv.$(gv.$(\"return \\\"source\\\"\")())()` uses the Function constructor to reassemble the source string and execute it.\n\n" +
      "When decoding, the tool does NOT run the outermost call that actually executes the payload; it only evaluates the inner `Function('return \"...\"')()` to recover the source string. So any input (even invalid JS) can be safely restored without executing the encoded code. The algorithm follows the utf-8.jp official demo character-for-character (including the original's zero-padding behavior for non-ASCII characters ≥0x80).",
    usage: "Enter JavaScript source (e.g. alert(1)) in the input box; parameter gv is the global variable name (default $, must be a valid JS identifier). Encoding gives a string of symbol code; decoding auto-detects the JJEncode header (gv=~[];gv={___:++gv...}) and restores the source.",
    examples: [
      { in: "alert(1)", param: "gv=$", out: "$=~[];$={___:++$, ... (a long run of symbols) ...;$($($$+\"\\\"\"+\"source\"+\"\\\"\")())();", desc: "After encoding only symbols remain; paste into the browser console to run alert(1)" },
    ],
    tips: [
      "Recognition: the ciphertext starts with `gv=~[];gv={___:++gv` (gv is usually $), and the whole thing is almost all symbols with no letters.",
      "It's by the same author as AAEncode (kaomoji); AAEncode outputs emoticons while JJEncode outputs pure symbols.",
      "Decoding is safe: it only evaluates the inner string-assembly part and does not run the outermost payload call, so any JJEncode can be decoded safely.",
      "When you see a blob of symbol code like $=!+[] in a CTF, think JJEncode first.",
    ],
    aka: ["jjencode", "jj编码", "JS符号混淆", "Yosuke Hasegawa", "jjencode解码", "javascript符号编码", "js混淆", "符号代码", "js obfuscation", "utf-8.jp", "js encoder", "长谷川阳介", "非字母数字js"],
  },
};
