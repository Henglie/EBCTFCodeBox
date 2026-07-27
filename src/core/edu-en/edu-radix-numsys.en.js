// English edu shard: radix "alternative number systems" family — 8 ops
// roman / chineseNum / negabase / balancedTernary / factorialBase / zeckendorf / continuedFraction / sternBrocot
// Pure data, no imports, no side effects. Example values are all computed live by radixExt.js.
export default {
  roman: {
    what: "Represents integers 1–3999 with the seven letters I V X L C D M: a smaller value to the left of a larger one subtracts, to the right adds.",
    principle:
      "Greedy method: from largest to smallest, seven base tiers `M=1000 D=500 C=100 L=50 X=10 V=5 I=1`; subtract whenever possible, writing the symbol as you subtract.\n\n" +
      "To avoid writing four identical letters in a row, six \"subtractive pairs\" are introduced: `IV=4 IX=9 XL=40 XC=90 CD=400 CM=900`. When decoding, check the two-letter subtractive pairs first, then single letters.",
    usage: "Encode direction: enter an Arabic number (range 1–3999) to convert to Roman numerals. Decode direction: enter Roman numerals to restore the Arabic number.",
    examples: [
      { in: "2024", out: "MMXXIV", desc: "2000=MM, 20=XX, 4=IV" },
      { in: "49", out: "XLIX", desc: "40=XL, 9=IX (not IL)" },
    ],
    tips: [
      "Roman numerals have no 0 and can't represent numbers greater than 3999 (that requires an overline notation, which this tool doesn't support).",
      "40 is written XL not XXXX, 9 is written IX not VIIII — the subtractive pairs are key to validating legality.",
    ],
    aka: ["罗马数字", "roman", "roman numerals", "罗马计数", "拉丁数字", "罗马数字转换", "IVXLCDM", "roman number", "罗马数字编码", "古罗马数字", "罗马数字互转"],
  },

  chineseNum: {
    what: "Digit-by-digit conversion between Arabic numerals and Chinese numerals: 2024 ↔ 二零二四. Note that it's one Chinese character per digit, not the \"两千零二十四\" reading style.",
    principle:
      "Replace each digit character one-to-one according to `零一二三四五六七八九`, with the minus sign led by the character 负.\n\n" +
      "It carries no place value (no 十/百/千), it's purely a translation of digit symbols, so `10` → `一零` rather than 十.",
    usage: "Encode direction: Arabic numerals to Chinese. Decode direction: Chinese numerals to Arabic. Decoding only recognizes 零, not the variant form 〇.",
    examples: [
      { in: "2024", out: "二零二四" },
      { in: "-105", out: "负一零五", desc: "minus sign → 负" },
    ],
    tips: [
      "Digit-by-digit translation, not the Chinese reading: `20` is 二零 not 二十.",
      "When decoding, zero must be written 零; writing it as 〇 raises an illegal-character error.",
    ],
    aka: ["中文数字", "汉字数字", "chinese number", "中文数字转换", "汉字数字互转", "数字转中文", "中文数码", "chinese numeral", "阿拉伯数字转中文", "逐位中文数字", "大写数字"],
  },

  negabase: {
    what: "A radix that uses a negative number as its base. The magic: using only non-negative digits like 0/1 (negabinary), it can represent both positive and negative numbers without a minus sign.",
    principle:
      "Like an ordinary radix, repeatedly divide by the base and take remainders, but the base is negative so remainders can be negative; in that case borrow the remainder positive (`rem -= base`) and increment the quotient (`num += 1`), keeping each digit within `[0, |base|)`.\n\n" +
      "Because even powers of a negative base are positive and odd powers are negative, positive and negative numbers are naturally encoded into the same string of digits.",
    usage: "Choose the base (-2 negabinary / -3 / -10). Encode direction takes a decimal integer, decode direction takes a negabase string. Supports big integers (BigInt).",
    examples: [
      { in: "6", param: "base=-2", out: "11010", desc: "16-8-2 = 6" },
      { in: "18", param: "base=-2", out: "10110" },
    ],
    formulas: [
      { tex: "n = \\sum_i d_i\\,(-2)^i,\\quad d_i \\in \\{0,1\\}", caption: "Negabinary: each place value is a power of -2" },
    ],
    tips: [
      "A negative base can represent negative numbers without a sign bit — that's its most interesting point relative to ordinary binary.",
      "Verify: 11010 = (-2)^4+(-2)^3+(-2)^1 = 16-8-2 = 6.",
    ],
    aka: ["负进制", "negabinary", "base -2", "负二进制", "负基数进制", "negative base", "负底数进制", "-2进制", "负三进制", "negaternary", "负数进制", "无符号负数表示"],
  },

  balancedTernary: {
    what: "A base-3 system where each digit can only be -1 / 0 / +1, with -1 written as the letter T. Naturally symmetric, it can represent negative numbers without a sign bit.",
    principle:
      "Ordinary base-3 division by 3 with remainders gives 0/1/2; in balanced ternary, when the remainder is 2 it's rewritten as -1 with a carry of 1 to the higher digit (`r=2 → r=-1, quotient+1`).\n\n" +
      "For a negative number, simply swap all the 1s and Ts in the whole string (thanks to the symmetry).",
    usage: "Encode direction takes a decimal integer (can be negative), decode direction takes a string containing only T/0/1.",
    examples: [
      { in: "8", out: "10T", desc: "9 - 1 = 8" },
      { in: "-4", out: "TT", desc: "-3 - 1 = -4" },
    ],
    tips: [
      "Knuth called it the \"most elegant\" numeral system; the classic \"balance-scale weights\" problem is a model of it.",
      "Swapping all 1s and Ts = negation, a beautiful property unique to balanced radices.",
    ],
    aka: ["平衡三进制", "balanced ternary", "三态进制", "平衡三进制转换", "对称三进制", "balanced base 3", "三值进制", "-1 0 1进制", "平衡进制", "天平砝码进制", "ternary balanced"],
  },

  factorialBase: {
    what: "A radix where place values are not powers but factorials: from right to left the weights are 1!, 2!, 3!… and the i-th digit ranges from 0 to i.",
    principle:
      "Repeatedly divide the number by increasing bases (first by 2, then 3, then 4…) and take remainders; those remainders are each digit, separated by colons.\n\n" +
      "Since the i-th digit maxes out at i, the representation is unique.",
    usage: "Encode direction takes a non-negative integer, decode direction takes colon-separated digits (e.g. `3:4:1:0:1`).",
    examples: [
      { in: "5", out: "2:1", desc: "5 = 2·2! + 1·1!" },
      { in: "463", out: "3:4:1:0:1", desc: "3·5!+4·4!+1·3!+0·2!+1·1! = 463" },
    ],
    formulas: [
      { tex: "n = \\sum_{i\\ge 1} d_i \\cdot i!,\\quad 0 \\le d_i \\le i", caption: "Factorial-base expansion" },
    ],
    tips: [
      "Factorial base is directly related to \"which permutation number\" (Lehmer code / factoradic), a common foundation for permutation numbering.",
    ],
    aka: ["阶乘进制", "factorial base", "factoradic", "阶乘数系", "阶乘数制", "factorial number system", "阶乘进制转换", "阶乘记数法", "lehmer码", "lehmer code", "排列编号进制"],
  },

  zeckendorf: {
    what: "Any positive integer can be written uniquely as a sum of \"non-adjacent\" Fibonacci numbers, recorded as a string of 0/1 — that's the Zeckendorf representation.",
    principle:
      "Fibonacci sequence `1,2,3,5,8,13,…`, greedily subtract the largest Fibonacci number not exceeding the remainder each time.\n\n" +
      "Because choosing one Fib means you can't choose its neighbor, the result string never contains two consecutive 1s.",
    usage: "Encode direction takes a positive integer, decode direction takes a 0/1 string (the highest bit corresponds to the larger Fibonacci number).",
    examples: [
      { in: "10", out: "10010", desc: "10 = 8 + 2" },
      { in: "100", out: "1000010100", desc: "100 = 89 + 8 + 3" },
    ],
    tips: [
      "A valid Zeckendorf string never contains `11` (two adjacent Fibonacci numbers can't both be chosen) — this is how you recognize it at a glance.",
      "It's the mathematical basis of \"Fibonacci coding\", often used for variable-length integer compression.",
    ],
    aka: ["Zeckendorf", "齐肯多夫表示", "斐波那契表示", "fibonacci representation", "zeckendorf定理", "zeckendorf表示法", "斐波那契编码", "fibonacci coding", "齐肯多夫定理", "不相邻斐波那契和", "斐波那契进制"],
  },

  continuedFraction: {
    what: "Writes a fraction in the nested form a0 + 1/(a1 + 1/(a2 + …)), keeping only that string of integers [a0; a1, a2, …].",
    principle:
      "Apply the Euclidean algorithm to numerator and denominator; the \"quotient\" at each step is the next term of the continued fraction, and the \"remainder\" feeds into the next step.\n\n" +
      "The continued fraction of a rational number is always finite in length.",
    usage: "Encode direction takes `p/q` (or an integer) and gives the continued-fraction sequence; decode direction takes `[a0, a1, …]` to restore the fraction.",
    examples: [
      { in: "13/11", out: "[1, 5, 2]", desc: "13=1·11+2, 11=5·2+1, 2=2·1" },
      { in: "415/93", out: "[4, 2, 6, 7]" },
    ],
    formulas: [
      { tex: "\\frac{p}{q}=a_0+\\cfrac{1}{a_1+\\cfrac{1}{a_2+\\cdots}}", caption: "The nested form of a continued fraction" },
    ],
    tips: [
      "The continued fraction of the golden ratio φ is all 1s (`[1;1,1,1,…]`), making it the number \"hardest to approximate with fractions\".",
      "The fraction from a truncated continued fraction is called a \"convergent\", the best rational approximation.",
    ],
    aka: ["连分数", "continued fraction", "简单连分数", "连分式", "continued fractions", "连分数展开", "渐近分数", "convergent", "有理数连分数", "连分数逼近", "分数展开"],
  },

  sternBrocot: {
    what: "Locates a positive fraction in lowest terms within the Stern-Brocot tree using a string of L/R (left/right), like a binary-search path.",
    principle:
      "Starting from the boundaries `0/1` and `1/0`, take their \"mediant\" `(a+c)/(b+d)`. If the target is larger go R (right), if smaller go L (left), and make that mediant the new boundary, until you hit the target.\n\n" +
      "Every positive fraction in lowest terms has a unique position in the tree, so its path is also unique.",
    usage: "Encode direction takes a positive fraction `p/q` (auto-reduced) and gives the L/R path; decode direction takes a path string to restore the fraction.",
    examples: [
      { in: "3/5", out: "LRL" },
      { in: "2/3", out: "LR" },
    ],
    tips: [
      "The \"run lengths\" of the L/R path correspond exactly to the continued-fraction expansion of that fraction — they're the same thing.",
      "The root node 1/1 has an empty path, which this tool displays as `(root)`.",
    ],
    aka: ["Stern-Brocot", "SB 树", "stern brocot tree", "分数树", "stern-brocot树", "斯特恩-布罗科树", "分数二叉树", "最简分数树", "LR路径分数", "mediant分数树", "有理数树"],
  },
};
