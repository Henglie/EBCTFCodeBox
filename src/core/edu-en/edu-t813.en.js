/*
 * English edu cards for the ten CyberChef-aligned ops.
 * Source: the Chinese shard; examples are kept verbatim (in/out/param are real data).
 *
 * Authoritative sources (same as the Chinese shard):
 *   ipChecksum       — RFC 1071 "Computing the Internet Checksum"; CyberChef "TCP/IP Checksum"
 *   xorChecksum      — CyberChef "XOR Checksum"; the general definition of a column/block XOR check
 *   parityBit        — CyberChef "Parity Bit"; standard even/odd parity terminology
 *   hexToOid         — ITU-T X.690 §8.19 (OBJECT IDENTIFIER encoding); CyberChef "Hex to OID"
 *   oidToHex         — ITU-T X.690 §8.19; CyberChef "OID to Hex"
 *   fromHexContent   — SNORT rule syntax (pipe-delimited hex inside the content modifier); CyberChef "From Hex Content"
 *   toHexContent     — same; CyberChef "To Hex Content"
 *   escapeSmartChars — CyberChef "Escape Smart Characters"; ASCII approximations of Unicode punctuation
 *   removeDiacritics — Unicode NFD and the combining-diacritics block U+0300–U+036F; CyberChef "Remove Diacritics"
 *   stripHttpHeaders — RFC 7230 §3 (HTTP message framing: header section and body split by an empty line); CyberChef "Strip HTTP Headers"
 */
export default {
  ipChecksum: {
    what:
      "TCP/IP checksum: add the data as 16-bit big-endian words, fold the high half back into the low half, then take the one's complement. The result is a 16-bit hex value; this is the checksum found in IPv4, TCP and UDP headers.",
    principle:
      "Bytes are paired into 16-bit words (an odd trailing byte occupies the low 8 bits), and all words are summed into $S$. The carry out of bit 16 is not dropped: it is added back into the low 16 bits (end-around carry) until only 16 bits remain. The checksum is the bitwise complement $c = \\overline{S}$.\n\n" +
      "A receiver sums the checksum field along with the data and should get 0xFFFF. One's-complement addition is endian-independent and incrementally updatable, which is why routers and NICs can fix up a checksum while forwarding.",
    usage:
      "Enter the data; there are no parameters. Real bytes from the byte view are used when present, otherwise the UTF-8 encoding of the text. The output is lowercase hex, at least two digits.\n" +
      "This op only sums the bytes you paste in. It does not build an IP header, zero the checksum field, or add the TCP/UDP pseudo-header; assemble the full covered region first for a complete header checksum.",
    examples: [
      { in: "abc", out: "3b9d", desc: "0x6162 + 0x6300 = 0xC462, complemented to 0x3B9D" },
      { in: "(byte view) 00 01 f2 03 f4 f5 f6 f7", out: "220d", desc: "the classic RFC 1071 §4 example" },
    ],
    tips: [
      "A checksum detects errors, it does not authenticate: an attacker can change data and recompute it.",
      "The IPv4 header checksum covers the header only; TCP/UDP also include the pseudo-header (addresses, protocol, length).",
      "Distinguish an all-zero result from all-ones: this tool outputs the complemented checksum, so empty input gives ffff.",
    ],
    aka: [
      "TCP/IP Checksum", "TCP/IP 校验和", "Internet checksum", "IP checksum", "IP header checksum",
      "one's complement checksum", "ones' complement sum", "end-around carry", "RFC 1071",
      "16-bit one's complement sum", "网际校验和", "反码和校验",
    ],
  },

  xorChecksum: {
    what:
      "XOR block checksum: split the data into fixed-size blocks and XOR every block column by column, producing one hex byte per column. It describes differences between blocks rather than a digest of the whole input.",
    principle:
      "With block size $k$, the output byte $i$ is $\\bigoplus_j b_{j,i}$, where $b_{j,i}$ is byte $i$ of block $j$. A short final block is padded with zero bytes (XOR 0 is a no-op). Because $x \\oplus x = 0$, repeated bytes in the same column cancel out; with block size 1 the result is a single XOR of all bytes.",
    usage:
      "Set the block size (default 4, positive integer) and enter text or byte-view data. The output is $k$ bytes of lowercase hex with no separator. Block size 1 is the usual single-byte XOR check in embedded/serial protocols.",
    examples: [
      { in: "ABCDEFGH", param: "blockSize=4", out: "04040404", desc: "0x41^0x45=0x04 and likewise for the other three columns" },
      { in: "ABCD", param: "blockSize=4", out: "41424344", desc: "with a single block the input is echoed as hex" },
    ],
    tips: [
      "It catches a single error per column, but two errors in the same column cancel; never use it as a cryptographic hash.",
      "The block size must match the sender, otherwise the result is completely different; protocols usually fix it at 1/2/4.",
      "All-zero output means the blocks are column-identical, not that the input was empty.",
    ],
    aka: [
      "XOR Checksum", "XOR 分块校验和", "XOR block checksum", "block XOR checksum",
      "exclusive OR checksum", "column XOR checksum", "byte-wise XOR check", "异或校验",
      "分块异或", "逐列异或", "纵向异或校验", "XOR 校验",
    ],
  },

  parityBit: {
    what:
      "Parity bit: count the 1s in a binary string and append or prepend a 0 or 1 so the total number of 1s becomes even (even parity) or odd (odd parity).",
    principle:
      "With even parity, add 0 when the count of 1s is already even and 1 when it is odd; odd parity does the opposite. The receiver recounts and flags a mismatch. It detects only an odd number of flipped bits, misses an even number, and cannot locate or correct errors.\n\n" +
      "The decode action simply removes the bit at the recorded position; it does not verify that the removed bit obeyed the parity rule. It restores the original string minus the parity bit.",
    usage:
      "Choose the parity type (even/odd), position (start/end) and action (encode/decode). An optional delimiter splits the input into blocks handled independently (e.g. space-separated bytes). Only 0, 1, spaces and the delimiter are accepted.",
    examples: [
      { in: "1011", param: "mode=even, position=start, action=encode", out: "11011", desc: "three 1s, so a 1 is added" },
      { in: "1011", param: "mode=odd, position=start, action=encode", out: "01011", desc: "odd parity adds a 0" },
    ],
    tips: [
      "Serial 8N1 means 8 data bits, no parity, 1 stop bit; parity variants are usually written 8E1/8O1.",
      "Memory ECC uses stronger schemes such as SECDED; a plain parity bit only detects a single-bit error.",
      "Delimiters split blocks but are not counted as 1s; any other character (e.g. 2) raises an error.",
    ],
    aka: [
      "Parity Bit", "奇偶校验位", "parity check", "even parity", "odd parity",
      "parity encoding", "parity bit insertion", "vertical parity", "parity generation",
      "校验位", "奇偶校验", "偶校验",
    ],
  },

  hexToOid: {
    what:
      "Hex to OID: decode the content bytes of an ASN.1 OBJECT IDENTIFIER (without the 06 tag and length) into dotted decimal such as 1.2.840.113549.",
    principle:
      "ITU-T X.690 §8.19: the first two arcs are merged into one subidentifier of value $40X + Y$ ($X \\in \\{0,1,2\\}$), and every later arc is encoded separately. Each subidentifier is a base-128 variable-length integer: all bytes except the last have the high bit set to mean \"more follows\".\n\n" +
      "Decoding reads the first varint $n$ and splits it back: $n<40$ gives $0.n$; $40 \\le n < 80$ gives $1.(n-40)$; otherwise $2.(n-80)$.",
    usage:
      "Enter the content bytes as hex; spaces, colons, commas, dashes and a `0x` prefix are accepted. Do not paste the `06 0d` tag and length. The output is a dotted-decimal OID.",
    examples: [
      { in: "2A864886F70D", out: "1.2.840.113549", desc: "the RSA encryption OID" },
      { in: "55 04 03", out: "2.5.4.3", desc: "X.509 commonName" },
    ],
    tips: [
      "In certificate/ASN.1 dumps an OID often appears as `06 0d 2a 86 48 ...`; `06` is the type and `0d` the length, so strip both before decoding.",
      "A varint can exceed 2^53; this tool accumulates per byte instead of using floating point.",
      "hexToOid and oidToHex are inverses, so use them for round-trip self-checks.",
    ],
    aka: [
      "Hex to OID", "十六进制 → 对象标识符", "OID decoder", "OID parser", "ASN.1 OID decode",
      "OBJECT IDENTIFIER decode", "X.690 §8.19", "BER OID", "DER OID", "dotted OID",
      "OID hex decode", "对象标识符解码",
    ],
  },

  oidToHex: {
    what:
      "OID to hex: encode a dotted OID such as 1.2.840.113549 into the ASN.1 content bytes as hex, ready to embed in a DER/BER structure.",
    principle:
      "Exactly symmetric with hexToOid: the first arc must be 0/1/2, and when it is 0 or 1 the second arc must be ≤39. The first two arcs are merged into $40X+Y$; later arcs are each encoded as base-128 varints (leading bytes have the high bit set).\n\n" +
      "Only the content bytes are produced: there is no `06` tag and no length, which must be computed according to the chosen encoding rules.",
    usage:
      "Enter a dotted-decimal OID, one non-negative decimal integer per arc. The output is lowercase, contiguous hex.",
    examples: [
      { in: "1.2.840.113549", out: "2a864886f70d", desc: "the RSA encryption OID" },
      { in: "2.5.4.3", out: "550403", desc: "X.509 commonName" },
    ],
    tips: [
      "A first arc of 3, or a second arc of 40 when the first is 0/1, is rejected explicitly; X.690 requires it.",
      "Large arcs (e.g. UUID-style 2.25.xxx) become multi-byte varints; the extra length is expected.",
      "Round-trip with hexToOid to check a hand-assembled OID for wrong arcs.",
    ],
    aka: [
      "OID to Hex", "对象标识符 → 十六进制", "OID encoder", "OID serialiser", "ASN.1 OID encode",
      "OBJECT IDENTIFIER encode", "X.690 §8.19", "BER OID encoding", "DER OID encoding",
      "OID hex encode", "dotted to hex", "OID 编码",
    ],
  },

  fromHexContent: {
    what:
      "From Hex Content: IDS rules often write unprintable bytes as `|41 42 3a|`; this op turns the pipe-delimited hex segments back into real characters and leaves the rest of the rule text untouched.",
    principle:
      "The SNORT/Suricata content modifier delimits a run of hex bytes with pipes, separated by spaces. Decoding splits on whitespace and takes one byte per pair of hex digits; characters outside the segments are copied through, so the structure of the rule survives.\n\n" +
      "Only runs between pipes that consist solely of hex digits and spaces (length ≥2) match. `|zz|` is not a match and stays as-is. Output is taken byte by byte as Latin-1, so unprintable bytes appear as their control characters.",
    usage:
      "Paste a rule fragment or a whole content value; there are no parameters. For fully readable text, handle the remaining control characters with another display step.",
    examples: [
      { in: "foo|3d|bar", out: "foo=bar", desc: "0x3d is the equals sign" },
      { in: "|41 42 3a|", out: "AB:", desc: "uppercase letters and a colon" },
    ],
    tips: [
      "It is the inverse of toHexContent, so use it to check a hand-written segment for extra spaces or missing bytes.",
      "Pipes are delimiters and never appear in the decoded output; a literal pipe in rule text has to be recognised from context.",
      "It handles only the hex form of content and does not parse pcre, byte_test or other modifiers.",
    ],
    aka: [
      "From Hex Content", "SNORT Hex Content 解码", "Snort hex content decode",
      "SNORT hex content decoder", "SNORT rule decoder", "content segment decode",
      "hex content decoder", "IDS rule content parser", "Suricata hex content",
      "|41 42| decode", "SNORT content restore", "规则内容 hex 还原",
    ],
  },

  toHexContent: {
    what:
      "To Hex Content: encode bytes that are awkward to write literally (control characters, punctuation, spaces) as `|hh hh|` segments, producing a valid SNORT/Suricata content value.",
    principle:
      "The \"special characters\" mode converts only unprintable or non-alphanumeric bytes (0x00–0x2F except space, 0x3A–0x40, 0x5B–0x60, and 0x7B upward). Consecutive special bytes share one `|...|` group while ordinary characters pass through. \"Special + spaces\" also converts 0x20 to `|20|`, and \"all characters\" wraps the entire input in a single `|hhhh|`.\n\n" +
      "The space separator only affects bytes inside a hex segment, never the surrounding text.",
    usage:
      "Enter the plaintext and choose the conversion range (special / specialSpaces / all) and whether to insert spaces. Byte-view data is encoded as real bytes; text is encoded as UTF-8.",
    examples: [
      { in: "foo=bar", param: "convert=special", out: "foo|3d|bar", desc: "the equals sign counts as special" },
      { in: "A B", param: "convert=specialSpaces", out: "A|20|B", desc: "the space is encoded too" },
      { in: "AB", param: "convert=all, spaces=false", out: "|4142|", desc: "the whole input as hex" },
    ],
    tips: [
      "A content value is usually wrapped in double quotes by the rule syntax; this op adds no quotes and does no escaping.",
      "Multi-byte UTF-8 characters are split into their bytes and matched byte-wise by the rule.",
      "The \"all characters\" mode hurts readability; start with \"special characters\" when debugging.",
    ],
    aka: [
      "To Hex Content", "SNORT Hex Content 编码", "Snort hex content encode",
      "SNORT hex content encoder", "SNORT rule encoder", "content segment encode",
      "hex content encoder", "IDS rule content builder", "Suricata hex content",
      "|hh| encoding", "SNORT content encode", "特殊字符转 hex",
    ],
  },

  escapeSmartChars: {
    what:
      "Escape Smart Characters: replace the \"smart punctuation\" copied from Word, web pages or PDFs with ASCII: curly quotes become straight quotes, en/em dashes become - or --, the ellipsis becomes ..., ©®™ become (c)(r)(tm), and arrows, guillemets, ×÷± have their own mappings.",
    principle:
      "The table is hard-coded character by character: the double-quote family U+201C–U+201F and U+2033, the single-quote family U+2018–U+201B and U+2032, the hyphen/dash range U+2010–U+2015, U+2026 ellipsis, U+00A9/00AE/2122, U+2190–U+21D4 arrows, U+00AB/00BB/2039/203A guillemets, U+00D7/00F7/00B1/2022/00B7 maths and bullets, and the non-ASCII spaces U+00A0/2002/2003/2009/200A.\n\n" +
      "ASCII characters pass through untouched. Non-ASCII characters outside the table follow the parameter: keep, remove, or replace with a dot.",
    usage:
      "Paste the text and choose how unmappable characters are handled. Use it before substitutions, ROT or regex matching so a single curly quote cannot break a keyword match.",
    examples: [
      { in: "“Hello,” she said, ‘yes.’", out: "\"Hello,\" she said, 'yes.'", desc: "curly quotes become straight quotes" },
      { in: "page 1–3 — wait…", out: "page 1-3 -- wait...", desc: "en dash to -, em dash to --" },
    ],
    tips: [
      "It is a character-by-character map, not a Unicode compatibility decomposition; full-width letters and Chinese stay unchanged.",
      "An em dash maps to two hyphens `--`, which can collide with Markdown syntax.",
      "Unmappable characters are kept by default; pick remove or replace with a dot when downstream needs pure ASCII.",
    ],
    aka: [
      "Escape Smart Characters", "转义智能字符", "smart quotes", "smart punctuation",
      "curly quotes", "typographic characters", "microsoft smart quotes", "em dash escape",
      "ASCII-fy punctuation", "smart character escaping", "弯引号转直引号", "智能标点转义",
    ],
  },

  removeDiacritics: {
    what:
      "Remove Diacritics: strip the accents and diaereses from Latin letters so café becomes cafe and Crème Brûlée becomes Creme Brulee, keeping only the base letter.",
    principle:
      "Text is first normalised to Unicode NFD, which splits `é` into `e` plus the combining acute U+0301; then the whole combining-diacritics block U+0300–U+036F is deleted. Any letter that decomposes (â ã ä å ā ă ą ...) collapses to its base.\n\n" +
      "No extra hand-written replacements are applied: `ø`, `ß`, `Ł` and `æ` are single letters rather than base + mark, so they stay unchanged, as do Chinese characters, kana and emoji.",
    usage:
      "Enter text; there are no parameters. Commonly used to turn foreign-language prompts, names and place names into plain ASCII before keyword search or dictionary matching.",
    examples: [
      { in: "Crème Brûlée", out: "Creme Brulee" },
      { in: "naïve résumé", out: "naive resume" },
    ],
    tips: [
      "NFD only helps for base + combining mark sequences; precomposed characters must be decomposed first, which this op does automatically.",
      "Greek and Vietnamese stacked marks are removed too and may leave an empty string; that is expected.",
      "German ü→ue or æ→ae are transliteration rules, out of scope here; replace them manually if needed.",
    ],
    aka: [
      "Remove Diacritics", "去除变音符号", "strip accents", "unaccent", "deaccent",
      "diacritics removal", "accent folding", "remove accents", "diacritic stripping",
      "NFD normalize", "accents to ASCII", "变音符号剥离",
    ],
  },

  stripHttpHeaders: {
    what:
      "Strip HTTP Headers: given a captured HTTP request or response, cut at the first empty line and return only the message body.",
    principle:
      "RFC 7230 §3 separates the header section from the body with one empty line, i.e. `CRLF CRLF` (hex 0d0a0d0a). The tool looks for that four-byte sequence first, falls back to `LF LF` for text that lost the carriage returns, and returns the input unchanged when neither is found.\n\n" +
      "It only splits the message: it does not parse header fields, remove chunk-size lines or decompress. A chunked body still needs dechunk.",
    usage:
      "Paste the raw HTTP message; there are no parameters. Both requests and responses work: a request yields a form/JSON body, a response yields a page or binary payload (unprintable bytes may look odd in the text view).",
    examples: [
      { in: "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nhi", out: "hi" },
      { in: "POST /x HTTP/1.1\nHost: a\n\na=1", out: "a=1", desc: "LF-only text is handled too" },
    ],
    tips: [
      "The first empty line wins; empty lines inside the body only affect content after that point and are not split again.",
      "Literal `\\r\\n` escape sequences in a copied string are not real newlines and will not be recognised.",
      "If the body starts with `1f 8b` it is gzip and needs decompressing; lines of digits followed by CRLF mean chunked encoding and need dechunk.",
    ],
    aka: [
      "Strip HTTP Headers", "剥离 HTTP 头", "HTTP header stripping", "strip headers",
      "HTTP body extract", "HTTP body extractor", "RFC 7230 §3", "CRLFCRLF split",
      "response body extract", "remove HTTP headers", "HTTP 报文分离", "HTTP 正文提取",
    ],
  },
};
