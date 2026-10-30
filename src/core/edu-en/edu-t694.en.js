/*
 * edu_t694_en.js — English edu cards for the 2 T694 ops (candidates, not wired).
 * Source: edu_t694_zh.js, translated 1:1. Example vectors (in/param/out) and TeX
 * formulas copied verbatim; only prose is translated. Aka lists keep every Chinese
 * alias and add English ones.
 */
export default {
  gb18030: {
    what: "GB18030 strict codec — the mandatory national standard character set of China (GB18030-2022; historically GB18030-2000/2005), a variable-length byte encoding: ASCII 1 byte, common hanzi 2 bytes, rare characters and supplementary-plane 4 bytes. Chinese regulations require support on systems sold in China, and it maps the full Unicode code space. This op follows the WHATWG Encoding Standard (the same source as browsers/Node). Difference from the legacy \"GBK / GB2312 / GB18030\" op: **encoding no longer silently falls back to UTF-8 bytes for untabled characters, and decoding no longer silently replaces invalid sequences with U+FFFD — everything raises an explicit error**.",
    principle:
      "**Four layers**: ① 0x00-0x7F single byte = ASCII; ② 0x80 single byte = the euro sign € (U+20AC, a spec step); ③ two bytes 0x81-0xFE × 0x40-0xFE (except 0x7F) — about 23k entries covering common hanzi; ④ four bytes 0x81-0xFE × 0x30-0x39 × 0x81-0xFE × 0x30-0x39 — a linear mapping region covering supplementary-plane hanzi, ancient characters, emoji, etc.\n\n" +
      "**Pointer arithmetic (WHATWG §index-gb18030)**: two bytes (lead,trail) → pointer $p = (lead-0x81) \\times 190 + (trail-0x40) - [trail > 0x7F]$; four bytes → $p = ((b_1-0x81) \\times 10 + (b_2-0x30)) \\times 1260 + (b_3-0x81) \\times 10 + (b_4-0x30)$. Pointers ≤ 23939 look up the two-byte index table; larger pointers look up the ranges table (207 piecewise-linear entries). The spec defines explicit holes: pointers in (39419, 189000) or above 1237575 have no mapping (left vacant on purpose to avoid mapping unassigned Unicode).\n\n" +
      "**Three asymmetric special cases** (encode picks different bytes than decode, for GB18030-2005 compatibility): 0xA3A0 maps to U+3000 IDEOGRAPHIC SPACE in the index (not U+E5E5), so **U+E5E5 cannot round-trip and the encoder raises an error for it** (the only mandatory encoder error in the spec); U+E7C7 encodes as four bytes 8135F437 (pointer 7457 special case) while decoding 0xA8BC yields U+1E3F; plus an 18-entry asymmetric PUA side table (U+E78D..U+E864 → 0xA6D9..0xFEA0 etc.).\n\n" +
      "**Data source**: the official WHATWG Encoding Standard index files (index-gb18030.txt + index-gb18030-ranges.txt, generated with fixed SHA256), the same table Chrome/Firefox/Node TextDecoder(\"gb18030\") implement.",
    usage:
      "Encoding: enter text, get GB18030 bytes as hex. Rare hanzi (𠀀 U+20000 → 95328236) and emoji (😀 → 9439FC36) come out as proper four-byte GB18030, never silently swapped for UTF-8 bytes.\n\n" +
      "Decoding: enter bytes as hex, get text. Truncated sequences, invalid trail bytes and out-of-range pointers all raise \"GB18030 解码失败（严格模式，偏移 N）\" naming the exact byte, so bad points are easy to locate.\n\n" +
      "When to use the legacy op: GBK/GB2312 settings, or when you want lenient (fault-tolerant) behavior — use \"GBK / GB2312 / GB18030\". Use this op when a challenge explicitly says GB18030 or the bytes contain four-byte sequences.\n\n" +
      "Recognition: a lead byte ≥ 0x81 followed by a byte in 0x30-0x39 is a GB18030 four-byte sequence — the clearest difference from GBK (whose trail bytes are ≥ 0x40).",
    examples: [
      { in: "中", out: "字节 hex（2 字节）：d6d0", out2: "", desc: "Common hanzi via the two-byte region, same as GBK" },
      { in: "𠀀 (U+20000)", out: "字节 hex（4 字节）：95328236", desc: "Supplementary-plane hanzi via the four-byte linear region; the legacy gbCharset outputs UTF-8 bytes f0a08080 for the same character (the silent-fallback defect)" },
      { in: "8836d930 (pointer 100000, unmapped per spec)", out: "报错：GB18030 解码失败（严格模式）：四字节指针 100000 不在 GB18030 ranges 定义域内", desc: "The spec leaves pointers 39420-188999 vacant; the strict version raises instead of emitting U+FFFD" },
    ],
    formulas: [
      { tex: "p = (lead-0x81)\\cdot 190 + (trail-0x40) - [trail > 0x7F]", caption: "Two-byte pointer; 190 = legal trail bytes per row (0x40-0xFE except 0x7F)" },
      { tex: "p = ((b_1-0x81)\\cdot 10 + (b_2-0x30))\\cdot 1260 + (b_3-0x81)\\cdot 10 + (b_4-0x30)", caption: "Four-byte pointer; the 0x30-0x39 second/fourth bytes mark the four-byte region" },
    ],
    tips: [
      "Recognition: sequences starting 0x81-0xFE with second byte 0x30-0x39 → GB18030 four-byte region; wording like \"national standard\", \"GB18030-2005\", \"four-byte\" also points here.",
      "Try GBK first, then this op: if GBK yields mojibake but this op decodes cleanly, the original text used four-byte-region characters.",
      "Common CTF trap: a flag GB18030-encoded and hidden in an image/traffic dump — when diffing bytes remember 0x80 is €, not padding.",
      "Python cross-check caveat: CPython codecs and WHATWG differ on a few entries (0xA3A0: WHATWG→U+3000, CPython→U+E5E5; similar for U+E7C7 and some PUA entries). This tool follows WHATWG (browser behavior); these are known divergences, not bugs.",
      "Distinguishing from UTF-8: both can be 4 bytes, but UTF-8 leads with 11110xxx (F0-F7) while GB18030 four-byte leads with 0x81-0xFE and has 0x30-0x39 in the second byte — completely different shapes.",
      "Standards: GB18030-2022 (national standard) and WHATWG Encoding Standard §gb18030 (this implementation); it is not an IETF protocol but an encoding specification.",
    ],
    aka: ["GB18030", "GB18030 严格", "GB18030 四字节", "国标码", "GB18030 编码",
      "GB18030 解码", "gb18030 codec", "四字节汉字", "GB18030-2022", "GB18030-2005",
      "中文国标扩展", "GB18030 emoji", "严格 GB18030", "GB18030 严格版", "国标字符集"],
  },

  utf32: {
    what: "UTF-32 codec — encodes every Unicode code point as a fixed 4 bytes (UTF-32 is the implementation form of UCS-4). LE (little-endian, low byte first — common in x86/Windows files) and BE (big-endian — network/cross-platform files) plus BOM handling. Compared with the variable-length UTF-8/16, UTF-32 is fixed-width with O(1) random access but the largest size — rare in real files, mostly in-memory representation or hidden data in misc challenges. Decoding validates strictly: length not a multiple of 4, surrogate range and values above 0x10FFFF all raise explicit errors.",
    principle:
      "**Encoding**: each code point $c \\in [0, 0x10FFFF]$ goes out as 4 bytes: LE emits $c_0 c_1 c_2 c_3$ (lowest first), BE emits $c_3 c_2 c_1 c_0$. No variable length, no combining logic — the only \"what you see is what you store\" Unicode form.\n\n" +
      "**BOM (byte order mark)**: LE = FF FE 00 00, BE = 00 00 FE FF. Note the **first two bytes are identical to the UTF-16 BOM** (FF FE / FE FF); the 00 00 in bytes 3/4 is the discriminator — an \"FF FE\"-prefixed file whose bytes 3/4 are 00 00 is UTF-32 LE, otherwise UTF-16 LE. On decode the BOM is auto-detected and honored (a marker, not content — stripped after detection); without a BOM the selected endianness applies.\n\n" +
      "**Strict validation (differs from lenient TextDecoder)**: ① length must be a multiple of 4; ② no unit may fall in D800-DFFF (the surrogate range — surrogates only exist as a UTF-16 pairing mechanism; UTF-32 represents full code points directly, so a surrogate means corrupted data); ③ values must not exceed U+10FFFF. Any violation raises an explicit error instead of silently substituting U+FFFD.\n\n" +
      "**Relation to UTF-16 surrogate pairs**: a supplementary character like U+20000 is a **single 4-byte unit** 00020000 in UTF-32 (BE) but two 2-byte surrogates D840 DC00 in UTF-16 — same byte count, entirely different structure and semantics.",
    usage:
      "Encoding: enter text, pick LE/BE and whether to prepend a BOM, get bytes as hex. Every character costs 4 bytes — \"A\" → 41000000 (LE) whether ASCII or hanzi.\n\n" +
      "Decoding: enter bytes as hex; BOM auto-detection takes priority (a detected BOM overrides the endianness parameter and is stripped from the text); without a BOM the selected endianness applies.\n\n" +
      "Troubleshooting: \"not a multiple of 4\" usually means truncated/re-padded hex; \"surrogate range\" means the data is probably UTF-16 in disguise (try the UTF-16 op).",
    examples: [
      { in: "A (LE)", out: "字节 hex（4 字节）：41000000", desc: "Fixed 4 bytes, zero-padded high side" },
      { in: "𠀀 (U+20000, BE)", out: "字节 hex（4 字节）：00020000", desc: "Supplementary plane as a single unit; UTF-16 BE would be the pair D840 DC00" },
      { in: "00d80000 (surrogate range)", out: "报错：UTF-32 解码失败（严格模式，偏移 0）：码位 U+D800 落在代理区 D800-DFFF", desc: "Strict surrogate check instead of silent U+FFFD" },
    ],
    formulas: [
      { tex: "c \\;\\longrightarrow\\; c_3\\,c_2\\,c_1\\,c_0\\;(\\text{BE}) \\;\\; /\\;\\; c_0\\,c_1\\,c_2\\,c_3\\;(\\text{LE})", caption: "UTF-32 emits 4 bytes directly; no variable-length logic" },
      { tex: "\\text{LE BOM} = \\text{FF FE 00 00},\\quad \\text{BE BOM} = \\text{00 00 FE FF}", caption: "Four-byte BOMs; distinguished from UTF-16 by bytes 3/4" },
    ],
    tips: [
      "Recognition: data whose length is a multiple of 4 with an \"XX 00 00 00\" (LE) or \"00 00 00 XX\" (BE) pattern per character → UTF-32; common in memory dumps, process strings and Windows-API-flavored challenges (Windows wchar is UTF-16, but heavy 00 padding can mimic UTF-32 — try UTF-16 LE first).",
      "Do not label \"FF FE\"-prefixed data UTF-16 LE immediately: check the total length — a multiple of 4 with 00 00 in bytes 3/4 means UTF-32 LE.",
      "Text streams with lots of interleaved 00 bytes may be UTF-32 LE (three 00s per character) rather than UTF-16 LE (one 00 per character) — judge by density.",
      "A surrogate-range decode error strongly suggests UTF-16: UTF-32 forbids D800-DFFF, while UTF-16 needs surrogates for the supplementary plane.",
      "Cross-check note: Node ICU has no utf-32 label; this tool's verification uses Python codecs (utf-32-le/be) in four directions plus structural checks on the official boundary code points (U+0000/0080/FFFF/10000/10FFFF).",
      "Standards: the Unicode Standard §3.9 (UTF-32 encoding form) and §2.6 (encoding schemes / BOM); the strict checks mirror the standard's own constraints (units ≤ 10FFFF, no surrogates) — not tool-invented rules.",
    ],
    aka: ["UTF-32", "UTF-32 LE", "UTF-32 BE", "UTF-32 编码", "UTF-32 解码",
      "UCS-4", "ucs4", "UTF32", "utf-32 codec", "32 位 Unicode",
      "UTF-32 BOM", "UCS-4 编码", "utf32le", "utf32be", "四字节 Unicode"],
  },
};
