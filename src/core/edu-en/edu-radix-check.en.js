// English edu shard: radix "barcode/check-digit" family — 6 ops. Pure data, no imports, no side effects.
// luhn / isbn / ean13 / cnidCheck / upc / bankBin (example values all produced by running checkdigit.js)
export default {
  luhn: {
    what: "The Luhn algorithm: the algorithm behind that last \"check digit\" on bank cards and IMEI numbers, used to catch typos. Compute the check digit for a body, or verify whether a complete number is valid.",
    principle:
      "Going right to left, double every other digit except the even positions (the check digit is position 1 and stays put); if a product exceeds 9, subtract 9 (equivalent to adding its two digits), then sum all the digits.\n\n" +
      "A valid complete number has a total sum divisible by 10. The check digit is exactly the digit needed to round the sum up to a multiple of 10.",
    usage: "encode takes a body without the check digit and returns the required check digit. decode takes a complete number and returns whether it's valid (if invalid, it hints the correct check digit).",
    examples: [
      { in: "7992739871", param: "Encode (compute check digit)", out: "3", desc: "complete number 79927398713" },
      { in: "79927398713", param: "Decode (verify)", out: "Valid (passes Luhn check)" },
    ],
    formulas: [
      { tex: "\\sum d_i \\equiv 0 \\pmod{10}", caption: "A valid number including its check digit sums to a multiple of 10" },
    ],
    tips: ["Credit cards, debit cards, and IMEI all use Luhn; a card number you make up off the top of your head almost certainly won't pass it.", "It only guards against typos, not deliberate forgery (since the algorithm is public)."],
    aka: ["luhn", "模10算法", "信用卡校验", "mod10", "luhn算法", "Luhn algorithm", "模10校验", "卢恩算法", "IMEI校验", "银行卡校验位", "mod 10 checksum", "Luhn公式"],
  },

  isbn: {
    what: "Book number (ISBN) check digits: ISBN-10 uses mod 11, ISBN-13 uses mod 10. The tool auto-distinguishes by length and can both compute the check digit and verify validity.",
    principle:
      "ISBN-10: multiply the first 9 digits by 10,9,…,2 and sum; the check digit makes the total divisible by 11; when the remainder is 10 the check digit is written `X`.\n\n" +
      "ISBN-13: 13 digits, multiply odd positions ×1 and even positions ×3 and sum; the check digit rounds up to a multiple of 10 (same algorithm as EAN-13).",
    usage: "encode takes a body (9 or 12 digits) and computes the check digit. decode takes a complete number (10 or 13 digits) and verifies validity.",
    examples: [
      { in: "030640615", param: "ISBN-10 encode", out: "2", desc: "complete 0306406152" },
      { in: "978030640615", param: "ISBN-13 encode", out: "7", desc: "complete 9780306406157" },
    ],
    tips: ["An ISBN-10 check digit may be the letter `X` (representing 10) — that's a hallmark of mod 11.", "Since 2007, new books uniformly use ISBN-13, mostly beginning with 978 or 979."],
    aka: ["isbn", "书号", "国际标准书号", "isbn10", "isbn13", "ISBN-10", "ISBN-13", "International Standard Book Number", "图书编号", "书号校验", "书号校验位", "国际书号"],
  },

  ean13: {
    what: "The check-digit algorithm for the EAN-13 product barcode (the 13-digit barcode scanned at supermarkets). Compute the check digit or verify validity.",
    principle: "Over the first 12 digits from the left, multiply odd positions (1st, 3rd, 5th…) ×1 and even positions ×3 and sum; the check digit rounds up to a multiple of 10. This is also the algorithm ISBN-13 uses.",
    usage: "encode takes a 12-digit body and computes the 13th check digit. decode takes a 13-digit complete code and verifies validity.",
    examples: [
      { in: "400638133393", param: "Encode", out: "1", desc: "complete 4006381333931" },
    ],
    formulas: [
      { tex: "d_{13} = (10 - (\\textstyle\\sum_{i} w_i d_i) \\bmod 10) \\bmod 10", caption: "odd positions weight 1, even positions weight 3" },
    ],
    tips: ["The first 2–3 digits are a country/region code, e.g. 690–699 is mainland China.", "EAN-13 and UPC-A have opposite weights (EAN odd position ×1, UPC odd position ×3) — don't mix them up."],
    aka: ["ean13", "ean-13", "商品条码", "商品码", "条形码校验", "EAN13", "European Article Number", "欧洲商品编码", "国际商品条码", "超市条码", "条码校验位", "商品条形码"],
  },

  cnidCheck: {
    what: "The algorithm for the last check digit of China's 18-digit resident ID number (GB 11643-1999). It only explains/computes the check digit and does NOT generate real numbers.",
    principle:
      "Multiply the first 17 digits by a fixed set of weights `[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2]` and sum, take mod 11, then look up a mapping table to get the check digit.\n\n" +
      "In the mapping table, a remainder of 2 gives a check digit of `X` (Roman numeral 10).",
    usage: "encode takes a 17-digit body and computes the check digit. decode takes an 18-digit complete number and verifies validity.",
    examples: [
      { in: "00000000000000000", param: "Encode (all-0 demo body)", out: "1", desc: "demonstrates the algorithm only, not a real number" },
    ],
    formulas: [
      { tex: "c = \\text{map}\\big[(\\textstyle\\sum_{i=1}^{17} w_i d_i)\\bmod 11\\big]", caption: "GB 11643 weighted mod 11" },
    ],
    tips: ["A trailing `X` represents a check digit of 10, not a letter — don't treat it as an input error.", "Privacy line: this tool only demonstrates the check-digit algorithm (with an all-0 body) and never generates or completes real ID numbers."],
    aka: ["身份证校验位", "身份证校验", "cnid", "gb11643", "身份证第18位", "身份证号校验", "居民身份证校验码", "GB 11643-1999", "身份证尾号校验", "18位身份证校验", "中国身份证校验", "身份证末位X"],
  },

  upc: {
    what: "The check-digit algorithm for the UPC-A product barcode (the 12-digit North American barcode). Compute the check digit or verify validity.",
    principle: "Over the first 11 digits from the left, multiply odd positions ×3 and even positions ×1 and sum; the check digit rounds up to a multiple of 10. The weights are exactly odd/even-swapped versus EAN-13.",
    usage: "encode takes an 11-digit body and computes the 12th check digit. decode takes a 12-digit complete code and verifies validity.",
    examples: [
      { in: "03600029145", param: "Encode", out: "2", desc: "complete 036000291452" },
    ],
    tips: ["Prepending a single leading 0 to a UPC-A makes it equivalent to EAN-13; scanning systems often unify them this way internally.", "UPC odd-position weight 3, EAN odd-position weight 1 — this is the key difference between the two checks."],
    aka: ["upc", "upc-a", "北美条码", "统一产品代码", "UPC-A", "Universal Product Code", "通用产品代码", "美国商品条码", "12位条码", "UPC条码", "UPC校验位", "北美商品码"],
  },

  bankBin: {
    what: "Bank-card first-6-digits (BIN/IIN) identification: reads out the card network (Visa/MasterCard/UnionPay etc.) and the rough issuing bank, plus a Luhn check along the way.",
    principle:
      "The leading digits of a card number are the Issuer Identification Number (IIN, formerly BIN). Look up a table by longest-prefix match: `4` starts Visa, `51-55` is MasterCard, `62` is UnionPay, `34/37` is Amex, etc.\n\n" +
      "The tool also runs a Luhn check over complete card numbers of 13–19 digits.",
    usage: "Paste a card number (at least the first 6 digits), run outputs the card network, issuing bank, length compliance, and Luhn result.",
    examples: [
      { in: "6222021234567890", out: "Card network: China UnionPay\nIssuing bank: Industrial and Commercial Bank of China", desc: "622202 → UnionPay / ICBC (excerpt)" },
    ],
    tips: ["The first 6 digits determine card network and issuing bank and are public information; but a complete card number is sensitive data — don't paste real card numbers carelessly.", "UnionPay cards mostly start with 62, Visa always starts with 4 — you can roughly recognize them at a glance."],
    aka: ["bin", "iin", "银行卡识别", "发卡行识别", "卡bin", "BIN", "IIN", "Bank Identification Number", "Issuer Identification Number", "发卡行标识号", "银行卡前6位", "卡组织识别"],
  },
};
