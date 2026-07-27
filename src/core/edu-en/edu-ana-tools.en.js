// English edu shard: analysis hash identify/brute + hex view/stats/diff tools family. Pure data, no imports, no side effects.
export default {
  extractHashes: {
    what: "Extract hash strings: from a big blob of logs, source code, or dump text, use regex to automatically dig out all hash-like hexadecimal strings (32–128 digits).",
    principle:
      "A hash digest is a fixed-length pure-hex string. Regex matches fragments of 32/40/56/64/96/128 consecutive hex characters, batch-grabbing them from messy text, then hands them off to identification/cracking.",
    usage: "Paste text containing hashes (e.g. a leaked database, config file); outputs all the hex hash strings scanned.",
    examples: [
      { in: "user=admin pass=21232f297a57a5a743894a0e4a801fc3 ...", out: "21232f297a57a5a743894a0e4a801fc3" },
    ],
    tips: ["In forensics/data-leak challenges, run this first to net all the hashes cleanly, then hashTypeIdentify + crack each one."],
    aka: ["提取哈希", "extract hashes", "哈希抓取", "hash extract", "哈希提取", "hash finder", "find hashes", "hash extractor", "哈希扫描", "hash grep", "摘要提取"],
  },

  rainbowQuery: {
    what: "Rainbow-table lookup: precompute hashes for common passwords into a table, so a digest can be reverse-looked up to its original in O(1), faster than cracking one by one.",
    principle:
      "Hashes are irreversible, but you can precompute a bunch of 'common password → digest' pairs into a table and look up the original directly from a target digest. The tool ships MD5/NTLM prebuilt tables (a small dictionary of a few hundred entries) for table lookup, and computes SHA-family tables on the fly to compare. A real rainbow table uses reduction chains to compress storage; this is a simplified direct lookup table.",
    usage: "Paste the target hash; the tool reverse-looks it up in the built-in small dictionary table. A miss means it's not in the weak-password table.",
    examples: [
      { in: "21232f297a57a5a743894a0e4a801fc3", out: "admin", desc: "hit in the prebuilt table" },
    ],
    tips: ["The built-in dictionary is small; a miss doesn't mean it's uncrackable → switch to hmacKeyBrute or import a large dictionary to crack. Weak-password challenges basically hit on lookup."],
    aka: ["彩虹表", "rainbow table", "彩虹表查询", "哈希反查", "rainbow query", "hash lookup", "哈希查表", "彩虹表攻击", "rainbow table attack", "哈希破解", "查表破解", "预计算表"],
  },

  hmacKeyBrute: {
    what: "HMAC key brute force: given a message and its HMAC value, brute a key dictionary to find which key was used. The mainstay of JWT weak-secret challenges.",
    principle:
      "HMAC(key, message) is determined jointly by the key and the message. Knowing the message and target HMAC, compute HMAC with each candidate key from the dictionary; a match is the correct key. The tool ships a top common-password + pure-numeric dictionary and supports HMAC-SHA1/256/384/512.",
    usage: "Fill in the message, the target HMAC value, and choose the hash algorithm; the tool runs a dictionary brute for the key.",
    examples: [
      { in: "message + HMAC-SHA256 value", param: "dictionary brute", out: "key=secret (if in the dictionary)" },
    ],
    tips: ["A JWT (HS256) signature is HMAC: take header.payload as the message, the signature segment as the target HMAC, and brute out the key to forge any token."],
    aka: ["hmac爆破", "hmac brute", "hmac密钥爆破", "jwt密钥爆破", "hmac key brute", "hmac密钥破解", "jwt secret brute", "jwt弱密钥", "hmac secret crack", "jwt签名爆破", "hmac字典爆破"],
  },

  hexView: {
    what: "Hexadecimal viewer: lay out arbitrary data in the classic hexdump format — offset on the left, hex bytes in the middle, printable ASCII on the right. Essential for examining file structure and finding magic headers.",
    principle:
      "16 bytes per line: the line starts with an offset address, the middle is the two-digit hex of 16 bytes, and the end displays printable characters as-is with `.` as placeholder for non-printable ones. Cross-referencing the hex and ASCII columns lets you both recognize file signatures and spot readable strings embedded in the binary.",
    usage: "Paste data (or hex); outputs a hexdump view, with support for highlighting a specified range.",
    examples: [
      { in: "PNG file bytes", out: "00000000  89 50 4e 47 0d 0a 1a 0a  ...  .PNG....", desc: "leading 89 50 4E 47 is the PNG magic" },
    ],
    tips: ["To recognize a file type, look at the first few bytes: 89504E47=PNG, FFD8FF=JPEG, 504B0304=ZIP, 25504446=PDF. You can often glimpse a hidden flag in the ASCII column."],
    aka: ["hexdump", "十六进制查看", "hex view", "hex 视图", "hex viewer", "hex查看器", "十六进制查看器", "hex dump", "字节查看器", "十六进制转储", "hexdump视图", "hex显示"],
  },

  hexRange: {
    what: "Hex range extraction: cut out the bytes at a specified offset range from the data, and display them at once in hex/decimal/octal/binary/ASCII/UTF-8.",
    principle:
      "First locate the byte range [start offset, end offset), then interpret those same bytes at different radixes/encodings. The same byte string read as an integer, as ASCII, or as UTF-8 may be completely different information; multi-format cross-referencing helps you judge a field's true meaning.",
    usage: "Fill in the start and end offsets; the tool cuts out the bytes in that range and displays them in multiple formats.",
    examples: [
      { in: "file bytes + range [16,20)", out: "hex=00 00 01 F4 / dec=500 / ...", desc: "reading the 4 bytes as an integer yields 500" },
    ],
    tips: ["Pair with hexView — locate first, then extract: dump to see the structure clearly, pin down the suspect field's offset, then use this to precisely fetch and interpret the value."],
    aka: ["hex区间", "hex range", "字节提取", "区间提取", "hex range extract", "字节区间", "hex片段提取", "byte range", "偏移提取", "字节切片", "hex slice", "区段提取"],
  },

  hexStats: {
    what: "Byte-distribution statistics: count how many times each of the 256 byte values appears in the data, then compute the printable ratio and Shannon entropy, so you can tell at a glance whether it's text, encoding, or encrypted/compressed data.",
    principle:
      "Tally the frequency of each byte value 0–255 (256 buckets) and group into 3 buckets: printable/control/high-bit. High printable ratio + low entropy → text; uniform distribution + entropy near 8 → encrypted or compressed; a few bytes clustering → encoding or padding. Includes the top-N most frequent bytes.",
    usage: "Paste data; outputs byte-frequency distribution + printable ratio + Shannon entropy + top-N frequent bytes.",
    examples: [
      { in: "encrypted data block", out: "entropy≈7.99, uniform distribution → looks encrypted/compressed" },
      { in: "English text", out: "printable ratio≈99%, entropy≈4.3 → natural language" },
    ],
    tips: ["Entropy near 8 with a flat distribution → an encrypted block, don't expect to read it directly. An abnormally frequent byte is often a trace of padding or an XOR key=0."],
    aka: ["字节统计", "byte stats", "字节分布", "hex 统计", "byte distribution", "字节频率", "香农熵", "shannon entropy", "byte frequency", "熵分析", "字节直方图", "byte histogram"],
  },

  diffTool: {
    what: "Difference comparison: compare two inputs byte by byte or line by line, marking where they differ. In CTF, finding 'the hidden difference between two nearly identical files' relies entirely on this.",
    principle:
      "Equal-length inputs take a fast path of bit-by-bit comparison; unequal-length inputs are aligned with LCS (longest common subsequence), then insert/delete/replace ranges are marked. It can diff at both the byte and line level, locating the position and content of differences.",
    usage: "Paste two inputs (separated per the tool's convention), choose byte/line mode; outputs the difference ranges.",
    examples: [
      { in: "original file vs modified file", out: "at offset 0x1A: 42 → 43", desc: "locate the tampered byte" },
    ],
    tips: ["For 'find the difference between two images/two files' challenges, a diff of the difference range is often exactly where the flag is hidden. Byte diff is fastest when lengths are equal."],
    aka: ["diff", "差异对比", "diff tool", "文件对比", "文本对比", "字节对比", "byte diff", "text diff", "比较工具", "差异比较", "文件比较", "diff比对"],
  },
};
