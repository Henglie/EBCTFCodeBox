// English edu shard: radix number / charset / math core — 16 ops. Pure data, no imports, no side effects.
// asciiRadix/ieee754/grayNum/bcd/binPad/hybridCode/separationAscii/asciiOffset/
// decimalToFloat/binaryComplement/completion/splitHex/standardCode/gcd/primeFactor/fibonacci
export default {
  asciiRadix: {
    what: "Writes each character's byte value as a string of digits in a chosen radix, with characters and numbers in one-to-one correspondence. Binary, octal, decimal, and hex all work.",
    principle:
      "Text is first converted to UTF-8 bytes, then each byte is written in the chosen radix. To keep the pieces separable, fixed widths are used: 8 digits for binary, 3 for octal, 3 for decimal, 2 for hex, with spaces between groups.\n\n" +
      "Decoding splits each group by space, or slices a fixed-width string with no spaces by bit width, then converts back to bytes.",
    usage: "Choose radix (2/8/10/16). encode turns text into a digit string, decode restores the digit string. Chinese/emoji are supported too (per UTF-8 byte).",
    examples: [
      { in: "Hi", param: "hex", out: "48 69", desc: "H=0x48, i=0x69" },
      { in: "A", param: "binary", out: "01000001", desc: "fixed width 8 bits" },
      { in: "48 69", param: "hex, decode", out: "Hi" },
    ],
    tips: ["A string of numbers separated by spaces, each group the same width, is the signature of an ASCII-code challenge. Groups of 8 bits are usually binary ASCII.", "Essentially the same as hex/bin encoding, just with an explicit radix choice and fixed width."],
    aka: ["ascii码", "字符进制", "ascii radix", "十进制ascii", "二进制ascii", "字符转进制", "进制ascii", "ascii进制转换", "octal ascii", "hex ascii", "char radix", "ascii码转换", "字符编码进制"],
  },

  ieee754: {
    what: "Writes a floating-point number's bit pattern in hex per the IEEE 754 standard, and can also restore a float from hex. This is how computers store decimals.",
    principle:
      "IEEE 754 splits a float into three parts: sign bit, exponent bits, mantissa bits. Single precision is `1+8+23=32` bits, double `1+11+52=64` bits, half `1+5+10=16` bits.\n\n" +
      "This tool reads those raw 32/64/16 bits of the float directly as an integer, then outputs it in hex.",
    usage: "Choose precision (half/single/double). encode turns a decimal into a hex bit pattern, decode restores hex into a decimal.",
    examples: [
      { in: "1.5", param: "single precision", out: "3FC00000" },
      { in: "1.5", param: "double precision", out: "3FF8000000000000" },
      { in: "3FC00000", param: "single precision, decode", out: "1.5" },
    ],
    formulas: [
      { tex: "x = (-1)^{s}\\times 1.m \\times 2^{e-127}", caption: "Single precision: s sign, e exponent (bias 127), m mantissa" },
    ],
    tips: ["Seeing memory-dump-like hex such as `0x40490FDB`, try decoding it as IEEE 754 — it may hide a number like 3.14.", "0x7F800000 is +∞, 0xFFC00000 is NaN; don't panic when you hit these special values."],
    aka: ["ieee754", "浮点数编码", "float hex", "浮点位模式", "单精度双精度", "ieee 754", "浮点数转hex", "float to hex", "double hex", "半精度浮点", "尾数指数", "IEEE浮点标准", "浮点二进制表示"],
  },

  bcd: {
    what: "BCD (Binary-Coded Decimal): each decimal digit is represented separately by 4 binary bits, without any whole-number radix conversion. Common in old-style electronic watches and calculator chips.",
    principle:
      "Decimal digits 0-9 each map to 4 binary bits (`0000`-`1001`), so one digit occupies half a byte (one hex character).\n\n" +
      "Therefore every hex character in a BCD string must be ≤ 9; the appearance of A-F means it's not valid BCD.",
    usage: "encode turns a decimal digit string into a BCD hex string, decode reverses it. Only handles digits.",
    examples: [
      { in: "1234", out: "1234", desc: "each digit → 4 bits, happens to equal the original digits" },
      { in: "1234", param: "decode", out: "1234" },
    ],
    tips: ["A BCD string looks the same as the original decimal digits (because the 4-bit code for 0-9 is the value itself), but the byte count is fixed and it never contains A-F.", "In hardware/firmware reversing, date-time registers are often BCD, e.g. 0x59 represents decimal 59 seconds, not 89."],
    aka: ["bcd码", "bcd", "二进制编码十进制", "8421码", "binary coded decimal", "二-十进制码", "8421 bcd", "bcd编码", "十进制数字编码", "4位二进制码", "bcd转换", "压缩bcd"],
  },

  binPad: {
    what: "Converts a decimal number into a fixed-width binary string, padded with leading zeros to align. Basically \"give me an 8-bit/16-bit binary\".",
    principle: "After converting decimal to binary, use `padStart` to pad `0` in front up to the specified bit width. If the width can't hold the value, it errors.",
    usage: "Enter bit width (default 8). encode turns a decimal into fixed-width binary, decode restores binary to decimal.",
    examples: [
      { in: "5", param: "width=8", out: "00000101" },
      { in: "00000101", param: "decode", out: "5" },
    ],
    tips: ["Use it when you need \"the binary representation of one byte\" — easier than padding zeros by hand.", "Picking the wrong width will drop high bits or error; mind the value range."],
    aka: ["二进制补零", "定宽二进制", "bin pad", "补零对齐", "二进制补齐", "定宽二进制转换", "binary padding", "padstart二进制", "固定位宽二进制", "8位二进制", "二进制填充", "补零二进制"],
  },

  hybridCode: {
    what: "A string mixing character codes in different radixes, distinguished by prefix: `b`=binary, `x`=hex, `o`=octal, `d`=decimal, each segment decoding to one character.",
    principle:
      "Split by separator (space/backslash/comma); the first letter of each segment is the radix prefix, the rest is the character code in that radix, converted to a code point and then joined into characters.\n\n" +
      "The encode direction writes each character's code point in the chosen radix with a prefix.",
    usage: "encode chooses the output radix (hex/dec/oct/bin/auto shortest) and turns text into a prefixed code string; decode directly decodes a prefixed mixed string.",
    examples: [
      { in: "x48 x69", param: "decode", out: "Hi", desc: "x=hex" },
      { in: "b1101000", param: "decode", out: "h" },
      { in: "Hi", param: "hex encode", out: "x48 x69" },
    ],
    tips: ["Seeing a code string mixing `b.../x.../o.../d...` means this radix-prefixed encoding.", "Mixed-radix decoding, occasionally used as a red herring in CTFs."],
    aka: ["混合进制", "hybrid code", "前缀进制", "bxod", "混合进制解码", "带前缀进制", "进制前缀混合", "随波逐流混合进制", "多进制混合", "prefix radix", "bxod编码", "混合进制编码"],
  },

  separationAscii: {
    what: "Given a long run of consecutive digits (with no separators), automatically tries a greedy split by printable ASCII range to guess the original text.",
    principle:
      "Accumulate character by character from the left; once the current accumulated value falls in the printable ASCII range (32-126), cut there as one character and continue.\n\n" +
      "It tries radix 10/16/8/2 each in turn, and only outputs the schemes that split cleanly all the way through.",
    usage: "Paste a long run of digits, run outputs the feasible splits in each radix. Good for \"a string of digits with no spaces\" ASCII challenges.",
    examples: [
      { in: "72101108108111", out: "radix 10: Hello", desc: "72=H,101=e,108=l,108=l,111=o" },
      { in: "48656c6c6f", out: "radix 16: Hello" },
    ],
    tips: ["For an unbroken string of digits with no separators, drop it in first to see if it splits into readable text.", "The greedy split can be ambiguous; glance at the results from multiple radixes."],
    aka: ["数字串分割", "separation ascii", "贪婪分割", "无分隔ascii", "数字串切分", "无分隔符ascii", "ascii贪婪切分", "连续数字分割", "数字分段", "无空格ascii", "ascii自动分割", "数字串还原ascii"],
  },

  asciiOffset: {
    what: "Adds a fixed offset to every character's ASCII code, like Caesar but applied to all characters (not just letters). An offset of 0 brute-forces all offsets.",
    principle: "For each character `c`, output `chr(ord(c) + offset)`. encode adds the offset, decode subtracts it. When offset=0 it tries all of -26..26 and lists them.",
    usage: "Enter the offset. encode adds it, decode subtracts it. Entering offset 0 brute-forces all results from -26 to 26 for easy cracking.",
    examples: [
      { in: "Khoor", param: "offset=-3", out: "Hello" },
      { in: "Hello", param: "offset=3", out: "Khoor" },
    ],
    tips: ["Difference from Caesar: Caesar only cycles within the alphabet, this one adds directly to the ASCII code and can overflow into the symbol range.", "Set offset 0 to see all offset results at once and eyeball the flag."],
    aka: ["ascii偏移", "ascii offset", "码位偏移", "全字符凯撒", "ascii码偏移", "字符偏移", "码点偏移", "ascii加减", "全字符偏移", "ascii移位", "ascii shift", "字符码偏移"],
  },

  decimalToFloat: {
    what: "Converts a decimal fraction into its \"fractional\" representation in other radixes, e.g. 10.5 in binary is 1010.1. Shows the radix conversion of the integer and fractional parts separately.",
    principle:
      "The integer part uses the usual divide-by-base, take-remainder; the fractional part repeatedly multiplies by the base and takes the integer part, giving each digit after the point. By default it gives four representations in radix 2/8/10/16.\n\n" +
      "Fractions often don't terminate in non-decimal radixes, so the fractional precision must be limited.",
    usage: "Enter the fractional precision (default 16), run outputs the number's floating representation in radix 2/8/10/16.",
    examples: [
      { in: "10.5", param: "precision=8", out: "radix 2: 1010.1\nradix 8: 12.4\nradix 10: 10.5\nradix 16: A.8", desc: "multi-line output" },
    ],
    tips: ["Different from IEEE754: this is the \"mathematical radix fraction\", not a memory bit pattern.", "0.1 is a repeating fraction in binary, so you can directly see the source of floating-point error."],
    aka: ["进制浮点", "decimal to float", "小数进制转换", "任意进制小数", "小数转进制", "十进制小数转换", "进制小数", "二进制小数", "任意进制浮点", "小数点进制", "radix fraction", "分数进制转换"],
  },

  binaryComplement: {
    what: "Given a decimal integer, computes its sign-magnitude, ones' complement, and two's complement. This is the basis for how computers store negative numbers; the bit width adapts to 8/16/32 bits based on magnitude.",
    principle:
      "Sign-magnitude: sign bit + the binary of the absolute value. Ones' complement: same as sign-magnitude for positives, for negatives it's the value bits of sign-magnitude inverted. Two's complement: same as sign-magnitude for positives, for negatives it's ones' complement +1.\n\n" +
      "Computers actually store integers in two's complement, because it unifies addition/subtraction and gives 0 a single representation.",
    usage: "Paste a decimal integer (may be negative), run outputs the sign-magnitude / ones' complement / two's complement and the bit width used.",
    examples: [
      { in: "-5", out: "width: 8 bit\nsign-magnitude: 10000101\nones' complement: 11111010\ntwo's complement: 11111011", desc: "the three codes differ for negatives" },
      { in: "5", out: "sign-magnitude: 00000101\nones' complement: 00000101\ntwo's complement: 00000101", desc: "the three codes are the same for positives" },
    ],
    tips: ["Positive numbers have identical sign-magnitude/ones'/two's codes, only negatives differ — this is the most common exam point.", "The top bit of two's complement is the sign bit but also carries weight ($-2^{n-1}$); don't read it as plain binary."],
    aka: ["原码反码补码", "补码", "complement", "twos complement", "机器数", "反码", "原码", "二进制补码", "ones complement", "补码运算", "符号位", "机器数表示", "sign magnitude"],
  },

  completion: {
    what: "Pads multiple binary strings of differing lengths with zeros to equal length for tidy vertical alignment. Can also strip leading zeros in reverse.",
    principle: "First strip any `0b/0x/0o` prefix, split by space into segments; when encoding, padStart every segment with zeros to the longest (or a specified width); decoding strips leading zeros.",
    usage: "Enter the target bit width (0=align to the longest segment). encode pads with zeros to align, decode strips leading zeros. Segments are separated by spaces.",
    examples: [
      { in: "1 101 11", param: "width=0", out: "001 101 011", desc: "padded to the longest segment, 3 bits" },
      { in: "001 010", param: "decode", out: "1 10" },
    ],
    tips: ["Used for aligning multi-segment binary layout, handy when tidying up bitwise-operation results.", "Setting the width to 8 or 16 forces padding to whole bytes."],
    aka: ["补零对齐", "completion", "位对齐", "二进制对齐", "二进制补零对齐", "补齐位宽", "位宽对齐", "前导零", "二进制等长", "补零填充", "对齐补零", "去前导零"],
  },

  splitHex: {
    what: "Splits a long hex string into groups of 2/4/8 characters to make byte/halfword/word boundaries clear.",
    principle: "After removing whitespace, cut every 2, 4, and 8 hex characters respectively and list all three groupings. 2 chars = 1 byte, 4 chars = 2 bytes, 8 chars = 4 bytes.",
    usage: "Paste a hex string, run gives all three splits of 2/4/8 chars at once.",
    examples: [
      { in: "48656c6c6f", out: "2-char split: 48 65 6c 6c 6f\n4-char split: 4865 6c6c 6f\n8-char split: 48656c6c 6f" },
    ],
    tips: ["When you get a long hex string, split it first; the 2-char grouping paired with an ASCII table reads directly, while 4/8-char groupings show multi-byte structure."],
    aka: ["hex分割", "split hex", "十六进制分组", "hex切分", "hex分组", "十六进制分割", "字节分组", "hex按位分组", "hex拆分", "十六进制字节分割", "hex grouping", "hex切割"],
  },

  standardCode: {
    what: "Encodes text into hex under multiple charsets (UTF-8/UTF-16/GBK/Big5 etc.), or decodes hex under multiple charsets, to help compare and find the right one.",
    principle:
      "When the input is text, it lists hex encodings under each charset (the browser's TextEncoder can only encode UTF-8, others are marked unsupported).\n\n" +
      "When the input is hex, it decodes with each charset's TextDecoder, marking any that contain the replacement character U+FFFD, to help you judge which encoding is correct.",
    usage: "Paste text or a hex string, run outputs a multi-charset encode/decode comparison. Use it in mojibake challenges to find the correct charset.",
    examples: [
      { in: "Hi", out: "utf-8 encode: 4869\nutf-16le encode: 48006900\nutf-16be encode: 00480069", desc: "text → multi-charset hex (excerpt)" },
    ],
    tips: ["Chinese mojibake challenge: drop the hex in and see which charset decodes without U+FFFD and into fluent Chinese.", "Browser limits encoding to UTF-8 only, but decoding supports GBK/Big5/Shift-JIS etc."],
    aka: ["字符集互转", "standard code", "编码对照", "charset convert", "多字符集", "字符集编码", "字符集转换", "charset", "gbk big5", "utf-8编码", "编码转换", "字符集解码", "encoding convert"],
  },

  gcd: {
    what: "Computes the greatest common divisor (GCD) and least common multiple (LCM) of multiple integers. A basic tool for number-theory problems, fraction reduction, and period calculation.",
    principle: "Use the Euclidean algorithm to compute GCD pairwise: $\\gcd(a,b)=\\gcd(b, a\\bmod b)$. LCM comes from $\\text{lcm}=a\\cdot b/\\gcd(a,b)$, merged in turn for multiple numbers.",
    usage: "Paste several numbers (space- or comma-separated), run outputs the GCD and LCM.",
    examples: [
      { in: "12 18", out: "GCD: 6\nLCM: 36" },
    ],
    formulas: [
      { tex: "\\gcd(a,b)=\\gcd(b,\\,a\\bmod b)", caption: "Euclidean algorithm" },
    ],
    tips: ["In RSA, checking whether two moduli share a factor is just taking the GCD of n1, n2 — anything other than 1 means they factor.", "Kasiski's method for the Vigenère key length also relies on it, taking the GCD of repeated-interval distances."],
    aka: ["最大公约数", "gcd", "最小公倍数", "lcm", "辗转相除", "欧几里得算法", "euclidean", "最大公因数", "greatest common divisor", "least common multiple", "辗转相除法", "公约数", "公倍数"],
  },

  primeFactor: {
    what: "Factors an integer into a product of primes, e.g. 360 = 2³ × 3² × 5. Uses BigInt to support large numbers.",
    principle: "Trial-divide starting from 2; each time it divides evenly, record a prime factor and keep dividing, until the trial divisor squared exceeds the remaining value; whatever's left at the end (if >1) is also a prime factor. Identical factors are merged into exponents.",
    usage: "Paste a non-negative integer, run outputs the prime factorization.",
    examples: [
      { in: "360", out: "360 = 2^3 × 3^2 × 5" },
    ],
    tips: ["If RSA's modulus n isn't large, factoring it directly gives p, q and breaks it. Large-number factoring is the security foundation of RSA.", "Trial division only suits smaller numbers or those with small factors; truly large semiprimes need Pollard's rho etc. (see rsaPollard)."],
    aka: ["质因数分解", "素数分解", "prime factor", "因式分解", "分解质因数", "质因子分解", "prime factorization", "素因子分解", "factorization", "因数分解", "integer factorization", "质数分解"],
  },

  fibonacci: {
    what: "Replaces the \"larger Fibonacci numbers\" appearing in text back with the character corresponding to their position in the sequence. The decode side of a fun encoding that hides characters as Fibonacci numbers.",
    principle:
      "Fibonacci sequence $F_1=1, F_2=1, F_n=F_{n-1}+F_{n-2}$. Starting from the 32nd term (to avoid harming small numbers), replaces digit strings in the text equal to $F_i$ with the character `chr(i+1)`.\n\n" +
      "Replacement goes from large to small to prevent large numbers from being broken apart.",
    usage: "Paste text containing large Fibonacci numbers, run replaces them with the corresponding characters.",
    examples: [
      { in: "3524578", out: "!", desc: "F32=3524578 → chr(33)='!'" },
    ],
    tips: ["Use this to restore a challenge where a string looks like random large integers but they're all actually Fibonacci numbers.", "Replacement only starts from the 32nd term, so small numbers (like 1, 2, 3) won't be harmed by mistake."],
    aka: ["斐波那契解码", "fibonacci", "fib编码", "斐波那契数列", "斐波那契", "fibonacci sequence", "fib解码", "斐波那契编码", "fibonacci decode", "斐波那契数", "黄金数列", "菲波那契"],
  },
};
