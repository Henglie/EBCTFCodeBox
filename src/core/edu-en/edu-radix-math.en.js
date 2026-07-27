// English edu shard: radix number-theory tool collatz. Pure data, no imports, no side effects.
// Note: negabase/balancedTernary/factorialBase/zeckendorf/roman/chineseNum/continuedFraction/
// sternBrocot/timestamp are covered by edu-radix-numsys.js / edu-radix-time.js and are not repeated here.
// Note: modInverse was removed (merged into rsaModinv, see edu-ana-rsa1.js).
export default {
  collatz: {
    what: "Repeatedly applies \"even → divide by 2, odd → times 3 plus 1\" to a positive integer, generating a sequence that eventually falls to 1. This is the famous Collatz (3n+1) conjecture.",
    principle:
      "The rule is simple: if $n$ is even it becomes $n/2$, if it's odd it becomes $3n+1$, iterating forever.\n\n" +
      "The conjecture says: no matter which positive integer you start from, you always reach 1 in the end. No one has proved it and no counterexample has been found — it's a famous unsolved problem in mathematics.",
    usage: "Paste a positive integer directly, run outputs the full sequence, step count, and the peak value along the way.",
    examples: [
      { in: "6", out: "步数: 8\n峰值: 16\n序列(9 项): 6 → 3 → 10 → 5 → 16 → 8 → 4 → 2 → 1" },
    ],
    formulas: [
      { tex: "f(n)=\\begin{cases} n/2 & n\\ \\text{偶}\\\\ 3n+1 & n\\ \\text{奇}\\end{cases}", caption: "the Collatz iteration rule" },
    ],
    tips: ["Also called \"hailstone numbers\" or the \"Kakutani conjecture\" — the sequence rises and falls like hailstones.", "CTF challenges occasionally use the step count or peak value as a puzzle answer, or use the sequence as a kind of encoding carrier."],
    aka: ["collatz", "3n+1", "冰雹数", "角谷猜想", "考拉兹猜想", "Collatz conjecture", "考拉茨猜想", "3n加1", "冰雹猜想", "Collatz序列", "hailstone sequence", "乌拉姆猜想", "Syracuse问题"],
  },
};
