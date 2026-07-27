// 科普内容分片：radix 数论工具 collatz。纯数据，无 import 无副作用。
// 注：negabase/balancedTernary/factorialBase/zeckendorf/roman/chineseNum/continuedFraction/
// sternBrocot/timestamp 由 edu-radix-numsys.js / edu-radix-time.js 覆盖，本文件不重复。
// 注：modInverse 已删（并入 rsaModinv，见 edu-ana-rsa1.js）。
export default {
  collatz: {
    what: "对一个正整数反复做「偶数除 2、奇数乘 3 加 1」，生成一条最终会掉到 1 的序列。这就是著名的 Collatz（3n+1）猜想。",
    principle:
      "规则很简单：$n$ 是偶数就变 $n/2$，是奇数就变 $3n+1$，一直迭代。\n\n" +
      "猜想说：不管从哪个正整数出发，最后总会到 1。至今无人证明也无人找到反例，是数学界著名的未解难题。",
    usage: "直接粘一个正整数，run 输出完整序列、步数和过程中的峰值。",
    examples: [
      { in: "6", out: "步数: 8\n峰值: 16\n序列(9 项): 6 → 3 → 10 → 5 → 16 → 8 → 4 → 2 → 1" },
    ],
    formulas: [
      { tex: "f(n)=\\begin{cases} n/2 & n\\ \\text{偶}\\\\ 3n+1 & n\\ \\text{奇}\\end{cases}", caption: "Collatz 迭代规则" },
    ],
    tips: ["又叫「冰雹数」「角谷猜想」，序列忽高忽低像冰雹起落。", "CTF 里偶尔用步数或峰值当谜题答案，或把序列当某种编码载体。"],
    aka: ["collatz", "3n+1", "冰雹数", "角谷猜想", "考拉兹猜想", "Collatz conjecture", "考拉茨猜想", "3n加1", "冰雹猜想", "Collatz序列", "hailstone sequence", "乌拉姆猜想", "Syracuse问题"],
  },
};
