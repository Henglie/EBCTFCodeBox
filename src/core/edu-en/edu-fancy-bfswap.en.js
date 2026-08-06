/*
 * edu-fancy-bfswap.en.js — Brainfuck Swap-Rerun variant English edu card (fancy).
 *
 * Translation of src/core/edu/edu-fancy-bfswap.js.
 * Op covered: bfSwap
 * Pure data, no side effects. Export contract matches eduContent.js header.
 */
export default {
  bfSwap: {
    what: "Brainfuck character-swap variant — a common CTF trick: the BF program starts with an orphan `]` (no matching `[`). Standard interpreters either error out or skip it as a NOP, producing empty output. The real intent is that the first run FAILS, triggering a 7-character symmetric swap (`-↔+`, `>↔<`, `]↔[`, `,↔.`), and the swapped program is the one that actually prints the flag.",
    principle:
      "Full semantics (verified by decompiling a 2026 CTF tool's bytecode):\n\n" +
      "① Interpreter layer: standard 8-instruction Brainfuck, but with one key difference — the comma `,` is a NO-OP (does not read input, does not touch the tape); brackets are strictly matched, and an orphan `]` throws an exception.\n\n" +
      "② Outer logic: try the first run directly → on exception, swap 7 characters symmetrically and rerun → on second exception, return empty string.\n\n" +
      "③ The swap is an involution: `-`↔`+`, `>`↔`<`, `]`↔`[`, `,`↔`.`, other characters unchanged.\n\n" +
      "Typical payload: `----------]<-----<...` — the leading `-` sequence sets cell0 non-zero, then the orphan `]` executes with a non-zero cell → empty loop stack → exception → swap triggered → 32 commas become 32 dots (output instructions), turning the program into a standard hello-world-style BF that prints a 32-char flag.\n\n" +
      "Recognition: a BF program that starts with an orphan `]` and contains only `,` (no `.`) is not a copy error — it is the canonical look of a swap-variant challenge.",
    usage: "Paste a BF program (or generate one via encode) and run. It executes with standard semantics first; on exception it automatically swaps and reruns. Standard BF programs (e.g. hello world) succeed on the first run without swapping, matching standard interpreter output.",
    examples: [
      { in: "----------]<-----<-----------<--------<------->>>>+[<<<++++,+++,-----------,<+++,>,<---,>>-------------,+++++++,+++++++++++,++++++++++,-----,-----,+++++,+++++,-------------------,---,++++++,----------,<-----------,>>,-,-,<+++++++,++++++++,-------------,<--,---,-----------,>>,<<++++++,>>+,<------,", param: "", out: "LITCTF{ti_did_ruoy_234rjwado4i3}", desc: "Orphan ] at start triggers swap; 32 commas become dots and print the flag (real challenge reproduction)" },
      { in: "++++++++++[>+++++++>++++++++++>+++>+<<<<-]>++.>+.+++++++..+++.>++.<<+++++++++++++++.>.+++.------.--------.>+.>.", param: "", out: "Hello World!\n", desc: "Standard BF runs directly without swapping" },
    ],
    tips: [
      "A BF program that starts with an orphan `]` and has commas but no dots is the canonical swap-variant look — not a copy error.",
      "The swap is an involution: swapping twice restores the original, so you can always try swapping any program as a cross-check.",
      "Difference from the standard brainfuck op: standard `,` reads input (0 when empty) and tolerates orphan brackets as NOPs; this op's `,` is a NO-OP and an orphan `]` throws to trigger the swap. Run both on the same program — they may differ.",
      "encode produces pure `+-.` programs (no `,`, no `[`), which run directly without swapping — round-trip is always consistent.",
      "For BF variant challenges, try this op first.",
    ],
    aka: ["bfSwap", "brainfuck swap", "BF swap", "swap rerun", "Brainfuck character swap", "orphan bracket BF", "comma output BF", "BF variant", "swapped brainfuck", "dirty program BF", "BF reverse bracket", "BF交换", "交换重跑", "逗号输出BF"],
  },
};
