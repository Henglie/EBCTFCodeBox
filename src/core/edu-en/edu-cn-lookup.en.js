/*
 * edu-cn-lookup.en.js — English edu cards for the five Chinese lookup codecs added in v0.1.12.
 * Source: src/core/edu/edu-cn-lookup.js (Chinese), translated 1:1.
 * Examples and formulas are copied verbatim; only prose is translated.
 */
export default {
  wubi: {
    what: "Wubi (五笔字型, Five-Stroke) is a shape-based Chinese input method invented by Wang Yongmin in 1983. Each character is decomposed into roots and typed as 1–4 letters. In CTFs each Chinese character is often written as its full Wubi code, separated by spaces, producing a lowercase letter string.",
    principle:
      "Wubi assigns root components to 25 letter keys (A–Y; Z is a wildcard) and decomposes a character by writing order, preferring larger roots, keeping components connected and non-crossing. A character shorter than four roots gets a final-stroke identifier; a longer one uses roots 1, 2, 3 and the last root.\n\n" +
      "The 86 and 98 editions differ, for example 牺 is `trsg` in 86 and `csg` in 98. This tool ships full codes for 20,900 characters in both editions. Phrase codes and input-method short codes (such as the level-one short code R for 的) are not included, so a 1–2 letter short code must be expanded to a full code first.",
    usage:
      "Decode: paste a code string such as `ovty fgh wnn`; spaces or commas both work, and an unspaced string is segmented by longest match. Parameter `version` selects 86/98; when several characters share a code, `pick` selects the candidate (1-based) or `all` lists every candidate.\n\nEncode: each Chinese character becomes its full Wubi code; characters outside the table are kept as-is so gaps are visible.",
    examples: [
      { in: "数十亿", out: "ovty fgh wnn", desc: "First line of NSSCTF 2155; 数=ovty, 十=fgh, 亿=wnn" },
      { in: "ovty fgh wnn", out: "数十亿", desc: "Reverse direction; spaces are optional" },
      { in: "ovtyfghwnn", out: "数十亿", desc: "Unspaced input is segmented by longest match" },
      { in: "牺", param: "version=98", out: "csg", desc: "98-edition example; the 86 code is trsg" },
    ],
    formulas: [
      { tex: "\\mathrm{code}(c) = r_1 r_2 r_3 r_4,\\qquad r_i \\in \\{A,\\ldots,Y\\}", caption: "A full single-character code has at most four letters; shorter codes get a final-stroke identifier" },
    ],
    tips: [
      "Recognition: space-separated groups of 2–4 lowercase letters, almost all in A–Y (no z) — try Wubi first.",
      "Try both 86 and 98: common characters usually agree, but 牺, 我, 面 and others diverge. If the challenge does not specify, try 86 first.",
      "Wubi is not pinyin: a code does not read as a pronunciation. Check the whole sentence because single characters can collide.",
      "Short codes and phrase codes are out of scope: R (的) and W (人) are input-method shortcuts; four-character phrase codes are not supported.",
      "Challenge: NSSCTF 2155 line 1 `ovty fgh wnn` → 数十亿; the five lines form a 24-character phrase whose MD5 is the flag.",
    ],
    aka: ["五笔", "五笔字型", "五笔输入法", "王码五笔", "Wubi", "Wubi 86", "Wubi 98", "五笔编码",
      "五笔全码", "五笔反查", "汉字五笔", "five-stroke", "五码", "五笔字根"],
  },

  cnTelegraph: {
    what: "The Chinese Telegraph Code (中文电码) assigns a four-digit number to each Chinese character; it is also called the Chinese Commercial Code. In CTFs it is a string of four-digit groups separated by spaces.",
    principle:
      "Codes run from 0001 to 9999, one code per character; the mainland standard table assigns codes to roughly 7,000 common characters. Leading zeros are part of the code: `0155` is not `155`, which would be a different character.\n\n" +
      "Mainland and Taiwan/Hong Kong code books differ, and the same character can have different codes (for example 亍 may be 8015 or 8041). This tool uses Unicode Unihan `kMainlandTelegraph` as the main table, fills gaps from the MIT-licensed node-ctc project, and ships 7,099 characters with no collisions in the main table.",
    usage:
      "Decode: four digits per group, separated by spaces, commas or concatenated; short tokens are left-padded with zeros. Encode: each Chinese character produces a zero-padded four-digit code. No parameters.",
    examples: [
      { in: "中合法", out: "0022 0678 3127", desc: "中=0022, 合=0678, 法=3127" },
      { in: "0155", out: "作", desc: "The leading zero matters; 155 is a different code" },
      { in: "002206783127", out: "中合法", desc: "Concatenated input is grouped every four digits" },
    ],
    formulas: [
      { tex: "\\mathrm{code}(c) \\in \\{0001,0002,\\ldots,9999\\}", caption: "Fixed four digits; short tokens are left-padded" },
    ],
    tips: [
      "Recognition: four-digit groups, mostly in the 0001–9699 range, evenly spaced — try Chinese telegraph code.",
      "The leading zero is the classic trap: `0155` (作) and `0022` (中) become different characters if the zero is dropped.",
      "Chinese telegraph and four-corner codes are both numeric: telegraph groups are four digits, while four-corner often uses five digits or dotted forms such as 4022.7.",
      "Mainland and Taiwan tables may disagree; this tool defaults to the mainland table. If a common character fails, consider a Taiwan code book.",
      "Challenge: NSSCTF 2155 line 2 `0678 3127 2347 0155 5074` → 合法操作者.",
    ],
    aka: ["中文电码", "中文电报码", "电报码", "四位电码", "汉字电码", "Chinese telegraph code",
      "CTC", "Chinese Commercial Code", "中文商用电码", "标准电码", "电码本", "电报编码", "汉字电报码"],
  },

  zhengma: {
    what: "Zhengma (郑码) is a shape-based Chinese input method invented by Zheng Yili. It encodes a character as 1–4 uppercase letters by roots and stroke order. CTFs often show one uppercase letter group per character, such as `MAZY AGD MFJI`.",
    principle:
      "Zhengma decomposes a character into primary and secondary roots, preferring few roots, short codes and few collisions. A single character uses 1–4 codes with the full code preferred. Different tables may store different numbers of codes for the same character: 验 may be only `XO` in one table while its full code is `XOBV`; 的 has both `D` and `NKRS`.\n\n" +
      "This tool merges a BSD-2-Clause 20,902-character table with an Apache-2.0 Rime single-character table, keeps every code for each character, prefers the longest full code when encoding, and accepts both short and full codes when decoding.",
    usage:
      "Decode: upper or lower case is accepted, 1–4 letters per group; unspaced strings are segmented by longest match. When characters collide, `pick` selects the candidate (1-based) or `all` lists every candidate.\n\nEncode: each character produces its full (longest) code; characters outside the table are kept as-is.",
    examples: [
      { in: "每天种", out: "MAZY AGD MFJI", desc: "NSSCTF 2155 line 3 fragment; 每=MAZY, 天=AGD, 种=MFJI" },
      { in: "MAZY AGD MFJI", out: "每天种", desc: "Reverse direction" },
      { in: "验", out: "XOBV", desc: "Full code preferred; the short code XO also decodes" },
      { in: "的", out: "NKRS", desc: "The other code for 的 is D; encoding uses the full code" },
    ],
    formulas: [
      { tex: "\\mathrm{code}(c) \\in \\{A,\\ldots,Z\\}^{1..4}", caption: "1–4 uppercase letters per character; full code preferred" },
    ],
    tips: [
      "Recognition: uppercase groups of 1–4 letters that do not look like English — and unlike Cangjie, never longer than four.",
      "One character can have several codes: 的=D/NKRS, 验=XO/XOBV. A short code in the challenge is not an error; the decoder keeps both.",
      "Case is ignored, but encoding emits uppercase by convention; unspaced input is split by longest match.",
      "Wubi and Zhengma look alike (both letter codes), but Wubi is lowercase and Zhengma uppercase. If the case is mixed, try both ops.",
      "Challenge: NSSCTF 2155 line 3 `MAZY AGD BMY NFA XOBV UCL A MFJI` → 每天都体验着一种.",
    ],
    aka: ["郑码", "郑码输入法", "Zhengma", "郑码编码", "郑码反查", "郑码全码", "郑码字根",
      "郑码五代", "郑码六代", "中文郑码", "郑易里码", "郑码码表", "Zhengma code"],
  },

  fourCorner: {
    what: "The Four-Corner Code (四角号码) is a Chinese character lookup system invented by Wang Yunwu in 1925. It assigns a digit 0–9 to the shape at each of the four corners (upper-left, upper-right, lower-left, lower-right), optionally followed by a fifth digit. CTFs often show 4- or 5-digit groups.",
    principle:
      "Corner shapes map to digits: 0 head, 1 horizontal, 2 vertical, 3 dot, 4 cross, 5 pierce, 6 box, 7 corner, 8 eight, 9 small; the fifth digit is an extra mark. Corner order and extra-digit rules create heavy collisions: `40227` matches 有/内/南/布 and 11 more characters; `44801` matches 其/共/楚 and 8 more.\n\n" +
      "A four-corner decoder therefore cannot silently pick one character. This tool lists all candidates by frequency by default and omits brackets for a unique match. Some tables store only the 4-digit main code (识=3678); a 5-digit form ending in 0 such as `36780` falls back automatically.",
    usage:
      "Decode: accepts 5 digits (with the extra digit), 4-digit main codes, or dotted forms such as `4022.7`; concatenated digits are grouped by 5 or 4. Parameter `digits` controls whether encoding emits 5 or 4 digits; `pick` selects a candidate (1-based); `all` is on by default and lists every character sharing the code.\n\nEncode: each character produces its main code with the fifth digit by default; `digits=4` truncates to four digits.",
    examples: [
      { in: "有", out: "40227", desc: "NSSCTF 2155 line 4 fragment; 有=40227" },
      { in: "44801", out: "[其|共|楚|萁|茣|藇|趬|躉|萐|萣|躠]", desc: "All candidates by default; 共 in the challenge is candidate 2" },
      { in: "27620", out: "[的|句|翻|旬|甸|匐|訇|匒]", desc: "Many characters share a code; pick one that fits the sentence" },
      { in: "有", param: "digits=4", out: "4022", desc: "Emit the 4-digit main code only" },
      { in: "36780", out: "[识|误]", desc: "When the table only has 3678, a 5-digit form ending in 0 falls back" },
    ],
    formulas: [
      { tex: "\\mathrm{code}(c) = c_1 c_2 c_3 c_4 [c_5],\\qquad c_i \\in \\{0,\\ldots,9\\}", caption: "Four corners plus an optional fifth digit; 0 is a valid digit (empty corner)" },
    ],
    tips: [
      "Recognition: numeric groups of 4 or 5 digits, often 5; a single group can match many common characters. Telegraph groups are usually 4 digits with no extra digit.",
      "All candidates are shown by default: `[其|共|楚|…]` is expected, not an error. Choose by sentence meaning; the tool will not guess for you.",
      "The fifth digit is optional; `4022`, `40227` and `4022.7` are all accepted.",
      "0 is not “missing”: it is a valid code for a head/empty corner. Do not strip leading zeros.",
      "Challenge: NSSCTF 2155 line 4 `40227 44801 36780 27620` → 有共识的 (共 is candidate 2).",
    ],
    aka: ["四角号码", "四角码", "四角检字法", "Four-Corner", "Four Corner Code", "四角号码查字",
      "四角号码字典", "王云五四角号码", "四角编码", "四角号码反查", "四角码表", "四角号码检字法"],
  },

  cangjie: {
    what: "Cangjie (仓颉码) is a shape-based Chinese input method invented by Chu Bong-Foo in 1976. It uses 24 Cangjie letters (A–Y, no Z) and encodes a character in 1–5 codes. CTFs often show uppercase groups such as `YPTC QVIO MGBHU`.",
    principle:
      "Cangjie splits a character into a head and a body and takes codes from top to bottom, left to right, outside to inside, with at most five codes. The third and fifth generations differ; this tool uses Unicode Unihan `kCangjie` (29,000 characters, 27,500 within the BMP), which follows the common fifth-generation tables.\n\n" +
      "X is the “difficult character” key (for example 臼=HX); Z never appears in Cangjie codes. Collisions are common: `YPTC` matches both 虚 and 龔, so decoding lists candidates by frequency.",
    usage:
      "Decode: upper or lower case is accepted, 1–5 letters per group; unspaced strings are segmented by longest match. `pick` selects a candidate (1-based), `all` lists every candidate.\n\nEncode: each character produces its first (full) code; characters outside the table are kept as-is.",
    examples: [
      { in: "现虚拟", out: "MGBHU YPTC QVIO", desc: "NSSCTF 2155 line 5 fragment; 现=MGBHU, 虚=YPTC, 拟=QVIO" },
      { in: "YPTC QVIO MGBHU", out: "虚拟现", desc: "Reverse direction; the first candidate of YPTC is 虚" },
      { in: "实", out: "JYK", desc: "实=JYK" },
      { in: "YPTC", out: "虚", desc: "龔 shares the code; turn on all to see both" },
    ],
    formulas: [
      { tex: "\\mathrm{code}(c) \\in \\{A,\\ldots,Y\\}^{1..5}", caption: "1–5 letters, no Z; X is the difficult-character key" },
    ],
    tips: [
      "Recognition: uppercase groups of 1–5 letters, and five-letter groups are possible; Zhengma never exceeds four.",
      "Third- and fifth-generation codes differ. If the challenge does not specify, try fifth generation first and check the sentence.",
      "X is the difficult-character key (臼=HX), not corruption; Z never appears in a Cangjie code.",
      "Collisions such as YPTC=虚/龔 require all-candidates mode; the first candidate is not the only answer.",
      "Challenge: NSSCTF 2155 line 5 `YPTC QVIO MGBHU JYK` → 虚拟现实.",
    ],
    aka: ["仓颉", "仓颉码", "仓颉输入法", "仓颉编码", "Cangjie", "Cangjie code", "仓颉五代",
      "仓颉三代", "仓颉字母", "仓颉反查", "仓颉检字", "仓颉码表", "Cangjie input"],
  },
};
