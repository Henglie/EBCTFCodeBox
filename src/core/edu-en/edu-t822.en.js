/*
 * edu-t822.en.js — English edu cards for the 21 CyberChef-aligned ops delivered by
 * the same implementations and wired into registerAll.
 *
 * Pure data: no imports, no side effects. Each entry mirrors the Chinese card schema
 * (what / principle / usage / examples / tips / aka). Example outputs were measured by
 * dynamically importing the real src/core/registerAll.js and running each op; see
 * verify_t822.mjs.
 *
 * Authoritative sources (one line per op):
 *   cartesianProduct  — set theory (Cartesian product); CyberChef "Cartesian Product" (#59)
 *   defangIp          — RFC 791 (IPv4), RFC 4291 (IPv6), RFC 4632 (CIDR); CyberChef "Defang IP Addresses" (#94)
 *   defangUrl         — RFC 3986 (URI); CyberChef "Defang URL" (#95), URL/domain regex from src/core/lib/Extract.mjs
 *   fangUrl           — RFC 3986; CyberChef "Fang URL" (#134)
 *   fromCiRegex       — ECMAScript/PCRE character-class semantics; CyberChef "From Case Insensitive Regex" (#164)
 *   haversine         — haversine formula, mean Earth radius 6371 km; CyberChef "Haversine distance" (#213)
 *   powerSet          — set theory (power set), bitmask enumeration; CyberChef "Power Set" (#323)
 *   stripIpv4         — RFC 791 §3.1 (Version/IHL); CyberChef "Strip IPv4 header" (#410)
 *   stripTcp          — RFC 9293 §3.1 (Data Offset); CyberChef "Strip TCP header" (#411)
 *   stripUdp          — RFC 768 (fixed 8-byte UDP header); CyberChef "Strip UDP header" (#412)
 *   cssSelector       — W3C Selectors Level 3; CyberChef "CSS selector" (#54), xmldom + nwmatcher
 *   jsBeautify        — ECMA-262; CyberChef "JavaScript Beautify" (#239), esprima + escodegen
 *   jsMinify          — ECMA-262; CyberChef "JavaScript Minify" (#240), terser
 *   jsParser          — ECMA-262 / ESTree; CyberChef "JavaScript Parser" (#241), esprima
 *   jsonataQuery      — JSON RFC 8259; JSONata 2.x; CyberChef "Jsonata Query" (#243)
 *   sqlBeautify       — MySQL syntax; sql-formatter; CyberChef "SQL Beautify" (#383)
 *   xpathQuery        — W3C XPath 1.0; CyberChef "XPath expression" (#496), xmldom + xpath
 *   jqQuery           — jq 1.6 manual; JSON RFC 8259; CyberChef "Jq" (#242), jq-web 0.5.1
 *   yaraScan          — YARA rule syntax; CyberChef "YARA Rules" (#503), libyara-wasm 1.2.1
 *   disasmArm         — Arm Architecture Reference Manual (A32/T32/A64); CyberChef "Disassemble ARM" (#101), Capstone
 *   disasmX86         — Intel SDM / AMD APM; CyberChef "Disassemble x86" (#102), Capstone
 */
export default {
  cartesianProduct: {
    what:
      "Cartesian product: split the input into sample groups, split each group into items, and print every possible ordered combination. For example, the groups {1,2} and {a,b} produce (1,a), (1,b), (2,a) and (2,b).",
    principle:
      "For sets $A$ and $B$, the Cartesian product $A \\times B$ is the set of all ordered pairs $(a,b)$ with $a \\in A$ and $b \\in B$. With three or more groups the operation is associative, so the implementation folds the groups left to right: it first builds every pair from the first two groups, then pairs each partial tuple with every item of the next group.\n\n" +
      "The input is split by the sample delimiter (default: a blank line, written `\\n\\n`). Each sample is split by the item delimiter (default: `,`). Every tuple is printed as `(item1,item2,...)` and the tuples are joined with the item delimiter.",
    usage:
      "Paste the groups separated by the sample delimiter. `sampleDelimiter` and `itemDelimiter` accept escaped characters such as `\\n`, `\\t`, `\\x5f` (underscore) and `\\uXXXX`. At least two groups are required; otherwise the op raises an error.\n" +
      "Empty groups are allowed and contribute an empty item, so `_` with sample delimiter `_` produces `(,)`.",
    examples: [
      {
        in: "1,2\n\na,b",
        out: "(1,a),(1,b),(2,a),(2,b)",
        desc: "2 × 2 = 4 ordered pairs, joined by the item delimiter",
      },
      {
        in: "1 2 3\n\na b",
        param: "sampleDelimiter=\\n\\n, itemDelimiter=space",
        out: "(1,a) (1,b) (2,a) (2,b) (3,a) (3,b)",
        desc: "the output separator follows itemDelimiter, while items inside a tuple stay comma-separated",
      },
    ],
    tips: [
      "The result grows multiplicatively: 5 × 5 × 5 groups already give 125 tuples. Count the product before running it on large lists.",
      "The sample delimiter must be unambiguous. A single `-` or `_` is common in CTF data; write escapes such as `\\x5f` when the delimiter is easy to confuse with content.",
      "The tool does not deduplicate items. Duplicate items produce duplicate-looking tuples, and the output is still the full product.",
    ],
    aka: [
      "Cartesian Product", "cartesian product", "cartesian", "cross product", "set product",
      "direct product", "product of sets", "all combinations", "combination generator",
      "tuple enumeration", "CROSS JOIN", "cross join", "笛卡尔积", "直积",
    ],
  },

  defangIp: {
    what:
      "Defang IP addresses: rewrite IPv4 and IPv6 addresses into a form that cannot be clicked or auto-linked, while keeping the original value readable to a human.",
    principle:
      "IPv4 addresses are matched with a dotted-quad regular expression that accepts 0–255 octets and an optional CIDR suffix; every `.` is replaced with `[.]`. IPv6 addresses are matched with CyberChef's IPv6 regular expression, which handles `::` compression and embedded IPv4; every `:` is replaced with `[:]`.\n\n" +
      "The transformation is purely textual. Defanging is a reporting convention: `192.0.2.1` becomes `192[.]0[.]2[.]1`, so an analyst can still read the IOC, but a chat or mail client will not turn it into a live link.",
    usage:
      "Paste text containing IPv4 or IPv6 addresses; there are no parameters. Text that is not an IP address is returned unchanged, and an IPv4 CIDR suffix such as `/24` is preserved.\n" +
      "Because every colon is replaced, the IPv6 `::` becomes `[:][:]`; for example, `2001:db8::1` becomes `2001[:]db8[:][:]1`.",
    examples: [
      {
        in: "192.168.1.1 | 2001:db8::1",
        out: "192[.]168[.]1[.]1 | 2001[:]db8[:][:]1",
        desc: "IPv4 dots and IPv6 colons are bracketed; the `::` shortcut becomes two bracketed colons",
      },
      {
        in: "10.0.0.1/24",
        out: "10[.]0[.]0[.]1/24",
        desc: "a CIDR suffix is not part of the address match and is left alone",
      },
    ],
    tips: [
      "This op only rewrites text. It does not resolve DNS, validate reachability, or decide whether an address is malicious.",
      "IPv4-like substrings can match: `256.1.1.1` is not a valid address, but the regular expression may still defang a matching substring. Check the result rather than assuming the whole token was validated.",
      "IPv6 loopback `::1` becomes `[:][:]1`. Uppercase hexadecimal digits are preserved. To reverse the change, replace `[.]` and `[:]` manually.",
    ],
    aka: [
      "Defang IP Addresses", "Defang IP", "IP defanging", "IP address defanging",
      "defanged IP address", "IOC defanging", "indicator defanging", "URL/IP defang",
      "IPv4 address defang", "IPv6 address defang", "click-safe IP", "safe IP rendering",
      "IP 地址去毒化", "IP 地址防误点",
    ],
  },

  defangUrl: {
    what:
      "Defang URL: turn URLs and domain names into non-clickable IOC text by bracketing dots, changing `http` to `hxxp`, and bracketing `://`.",
    principle:
      "The op uses two regular expressions adapted from CyberChef's Extract library: a full-URL pattern (`scheme://host[:port][/path]`) and a domain pattern. Depending on the `process` setting it rewrites only domains and full URLs, only full URLs, or the whole input. Each enabled substitution is a literal text replacement: `.` → `[.]`, `http` → `hxxp` (case-insensitive), and `://` → `[://]`.\n\n" +
      "The result keeps the original spelling and path so an analyst can still read it, while common auto-linkers will not treat it as a live URL.",
    usage:
      "Paste text and choose `process`: `domains` (default; valid domains and full URLs), `fullUrls` (only complete URLs) or `everything` (the entire input). The toggles `dots`, `http` and `slashes` are all on by default.\n" +
      "With `fullUrls`, a bare host name such as `localhost` is not matched. With `everything`, dots and colons outside URLs are replaced too.",
    examples: [
      {
        in: "Visit http://evil.com/a.txt and evil.org now",
        out: "Visit hxxp[://]evil[.]com/a[.]txt and evil[.]org now",
        desc: "the default process handles both the full URL and the bare domain",
      },
      {
        in: "http://evil.com/a",
        param: "dots=false, http=false, slashes=false, process=everything",
        out: "http://evil.com/a",
        desc: "all three substitutions off leaves the input unchanged",
      },
    ],
    tips: [
      "`hxxp` is a visual convention, not a protocol. Do not expect the defanged string to resolve.",
      "The default `domains` mode is usually what you want for reports: it catches both `http://...` URLs and bare domains.",
      "If a URL contains credentials or query parameters, those characters are preserved; only the three selected patterns change.",
    ],
    aka: [
      "Defang URL", "Defang URLs", "URL defanging", "defanged URL", "IOC defanging",
      "malware URL obfuscation", "hxxp conversion", "hxxp substitution", "click-safe URL",
      "safe URL rendering", "URL neutralization", "URL neutralisation", "URL 去毒化", "域名防误点",
    ],
  },

  fangUrl: {
    what:
      "Fang URL: reverse the usual defanging substitutions and turn a string such as `hxxp[://]evil[.]com` back into `http://evil.com`.",
    principle:
      "These are exactly the inverse text replacements of Defang URL: `[.]` → `.`, `hxxp` → `http`, and `[://]` → `://`. Each replacement is independent, so disabling one leaves that part in defanged form. Unlike the defanging direction, the `hxxp` match here is case-sensitive: `HXXP` is not restored.\n\n" +
      "This is a convenience for reports, notes and CTF write-ups. It does not resolve, fetch or validate the URL.",
    usage:
      "Paste defanged text and toggle `dots`, `http` and `slashes` (all on by default). To restore only dots, turn the other two off.",
    examples: [
      {
        in: "hxxp[://]evil[.]com/a[.]txt",
        out: "http://evil.com/a.txt",
        desc: "all three default substitutions are reversed",
      },
      {
        in: "HXXP[://]evil[.]com",
        out: "HXXP://evil.com",
        desc: "`hxxp` restoration is case-sensitive, so the uppercase protocol stays as it is",
      },
    ],
    tips: [
      "Only the exact spellings `[.]` and `[://]` are restored. Variants such as `(.)`, `[dot]` or spaces inside brackets are left alone.",
      "Use Defang URL for the opposite direction. The pair is useful for round-trip checks in IOC processing.",
      "Fang URL does not check that the restored URL is well formed.",
    ],
    aka: [
      "Fang URL", "Refang URL", "refang", "URL refanging", "defang undo", "defang reverse",
      "restore defanged URL", "revert hxxp", "hxxp to http", "bracket dot restore",
      "IOC refanging", "URL restoration", "URL 还原", "去毒 URL 还原",
    ],
  },

  fromCiRegex: {
    what:
      "From Case Insensitive Regex: collapse expanded case-insensitive character classes such as `[sS]` back into a single letter, making a generated pattern easier to read.",
    principle:
      "A common way to write a case-insensitive literal is to expand every letter into a two-letter class: `secret` → `[sS][eE][cC][rR][eE][tT]`. This op matches every character class containing exactly two ASCII letters whose letters are the same ignoring case, and keeps the first character. Thus `[sS]` → `s`, `[Gg]` → `G` and `[AA]` → `A`.\n\n" +
      "Classes that are not exactly two letters (`[0-9]`, `[abc]`, `[]`) and malformed classes such as an unclosed `[aA` are left unchanged. The original case cannot be recovered: `[sS]` could have stood for either `s` or `S`.",
    usage:
      "Paste the expanded regular expression; there are no parameters. Use the result to make a pattern readable or to compare two generators, not to recover the exact source spelling.",
    examples: [
      {
        in: "[sS]0[mM][eE][tT][hH]![nN][Gg] [wr][On][gG]",
        out: "s0meth!nG [wr][On]g",
        desc: "two-letter case pairs collapse; `[wr]` and `[On]` are not case pairs and stay unchanged",
      },
      {
        in: "[aA][bB][zZ]",
        out: "abz",
        desc: "the first letter of each pair is kept",
      },
    ],
    tips: [
      "This is a readability aid, not a canonicalisation step. It may change the meaning if the original pattern relied on matching both cases.",
      "Only two ASCII letters are handled. `[a-zA-Z]`, escaped letters and POSIX classes are not collapsed.",
      "An unclosed bracket is treated as plain text and is not repaired.",
    ],
    aka: [
      "From Case Insensitive Regex", "From Case-Insensitive Regex", "case-insensitive regex collapse",
      "regex case folding", "character class folding", "[aA] collapse", "case expansion removal",
      "regex simplification", "CI regex", "character class reduction",
      "大小写不敏感正则还原", "大小写正则还原",
    ],
  },

  haversine: {
    what:
      "Haversine distance: compute the great-circle distance between two latitude/longitude points on a sphere.",
    principle:
      "The haversine formula gives the central angle between two points:\n\n" +
      "$\\operatorname{hav}(\\Delta\\sigma)=\\operatorname{hav}(\\varphi_2-\\varphi_1)+\\cos\\varphi_1\\cos\\varphi_2\\operatorname{hav}(\\Delta\\lambda)$, where $\\operatorname{hav}(x)=\\sin^2(x/2)$.\n\n" +
      "The distance is $d=2R\\arctan2(\\sqrt{a},\\sqrt{1-a})$ with $R=6371000$ metres. The implementation parses exactly four comma-separated decimal values — `lat1, lng1, lat2, lng2` — in degrees, converts them to radians and returns the distance as a decimal string in metres.",
    usage:
      "Enter `lat1, lng1, lat2, lng2`, for example `51.487263,-0.124323, 38.9517,-77.1467`. One space after a comma is allowed, but leading spaces, doubled spaces or a different number of values raise an error.\n" +
      "Latitude comes first, then longitude. Negative values are accepted.",
    examples: [
      {
        in: "51.487263,-0.124323, 38.9517,-77.1467",
        out: "5902542.836307819",
        desc: "London to Washington, D.C., using R = 6371000 m",
      },
      {
        in: "51.487263,-0.124323, 51.487263,-0.124323",
        out: "0",
        desc: "identical points give zero distance",
      },
    ],
    tips: [
      "The Earth is treated as a sphere, not an ellipsoid, so the result can differ from a GPS geodesic distance by a few tenths of a percent.",
      "The radius is fixed at 6371 km; there is no unit selector. The output is always metres.",
      "A common mistake is swapping latitude and longitude. `lat,lng` is the expected order.",
    ],
    aka: [
      "Haversine distance", "Haversine formula", "haversine", "great-circle distance",
      "great circle distance", "orthodromic distance", "spherical distance", "geodesic distance",
      "air distance", "as-the-crow-flies distance", "latitude longitude distance", "GPS distance",
      "球面距离", "半正矢公式",
    ],
  },

  powerSet: {
    what:
      "Power set: list every subset of the items in the input, including the empty set and the full set.",
    principle:
      "For $n$ items there are $2^n$ subsets. The implementation assigns each subset a bitmask from $0$ to $2^n-1$: bit $i$ set means item $i$ is included. It renders each subset by joining its items with the delimiter, sorts the rendered strings by length (shortest first), and prints one subset per line.\n\n" +
      "Empty items are removed before enumeration. The empty subset is the first line (an empty line). Duplicate items are not deduplicated because the implementation compares item arrays by reference, so `a,a` produces repeated-looking subsets.",
    usage:
      "Enter items separated by `delimiter` (default `,`; escapes such as `\\n` work). The output has one subset per line, beginning with an empty line for the empty set.\n" +
      "Empty input returns an empty string, and the empty elements around delimiters are ignored.",
    examples: [
      {
        in: "1,2,3",
        out: "\n3\n2\n1\n2,3\n1,3\n1,2\n1,2,3\n",
        desc: "2^3 = 8 subsets; the first line is the empty set",
      },
      {
        in: "1 2 4",
        param: "delimiter=space",
        out: "\n4\n2\n1\n2 4\n1 4\n1 2\n1 2 4\n",
        desc: "the official CyberChef example; its output order is length-stable",
      },
    ],
    tips: [
      "The output size doubles with each item: 20 items produce 1,048,576 lines. Do not run it on a large word list by accident.",
      "Sorting is by the rendered string length, not by subset cardinality. With multi-character items, a two-item short string can appear before a one-item long string.",
      "Duplicate items are kept, and empty elements are dropped. Both behaviours match CyberChef.",
    ],
    aka: [
      "Power Set", "powerset", "power set", "set of all subsets", "all subsets",
      "subset enumeration", "subset generator", "boolean lattice", "2^n subsets",
      "exponential set", "superset enumeration", "幂集", "所有子集",
    ],
  },

  stripIpv4: {
    what:
      "Strip IPv4 header: skip the IPv4 header at the start of a packet and return only the payload bytes.",
    principle:
      "In the RFC 791 IPv4 header, the first byte contains Version (high nibble) and IHL (low nibble). IHL counts 32-bit words, so the header length is `IHL × 4` bytes. The minimum is 5 words = 20 bytes; IPv4 options make it longer.\n\n" +
      "The op reads IHL, checks that the input has at least that many bytes, and returns everything after the header. It does not validate the version, checksum or total-length field. IHL = 0 is accepted and returns the whole input, matching CyberChef; an IHL longer than the input raises an error.",
    usage:
      "Supply raw packet bytes through the byte view, or paste text (its UTF-8 bytes are used). There are no parameters.\n" +
      "The output is a Latin-1 string: each character code is one payload byte from 0x00 to 0xFF, so binary payloads may look garbled in a text view.",
    examples: [
      {
        in: "(byte view) 45 00 00 1c 00 01 00 00 40 06 00 00 c0 a8 00 01 c0 a8 00 02 48 45 4c 4c 4f",
        out: "HELLO",
        desc: "IHL = 5, so the first 20 bytes are the header and the remaining bytes spell HELLO",
      },
    ],
    tips: [
      "This expects a bare IPv4 header at offset 0. In an Ethernet frame, strip the 14-byte Ethernet header first.",
      "The total-length field is ignored; the op returns every byte after the header, including any capture padding.",
      "Use a hex view for binary payloads. The Latin-1 output preserves bytes but is not valid UTF-8 text.",
    ],
    aka: [
      "Strip IPv4 header", "Strip IPv4 Header", "remove IPv4 header", "IPv4 header removal",
      "skip IPv4 header", "IPv4 payload extraction", "IP header stripper", "strip IP header",
      "IHL-based header skip", "IPv4 header parser", "IPv4 头剥离", "去掉 IPv4 头",
    ],
  },

  stripTcp: {
    what:
      "Strip TCP header: skip the TCP header at the start of a segment and return only the payload.",
    principle:
      "In the RFC 9293 TCP header, byte 12 contains the Data Offset in its high nibble. Data Offset counts 32-bit words, so the header length is `Data Offset × 4` bytes. The minimum is 5 words = 20 bytes, and TCP options extend it.\n\n" +
      "The op reads byte 12, checks the input length and returns the bytes after the header. It does not verify checksums, ports or sequence numbers. A Data Offset of 0 returns the whole input, matching CyberChef.",
    usage:
      "Supply raw TCP segment bytes (the byte view is preferred). There are no parameters. The output is a Latin-1 byte string.",
    examples: [
      {
        in: "(byte view) 7f 90 00 50 00 0f a4 b2 00 0c b2 a4 50 10 bf f1 00 00 00 00 48 45 4c 4c 4f",
        out: "HELLO",
        desc: "byte 12 is 0x50, so Data Offset = 5 words = 20 bytes; the payload spells HELLO",
      },
      {
        in: "(byte view) 7f 90 00 50 00 0f a4 b2 00 0c b2 a4 70 10 bf f1 00 00 00 00 02 04 05 b4 04 02 00 00 48 45 4c 4c 4f",
        out: "HELLO",
        desc: "Data Offset = 7 words skips the 8 bytes of TCP options before the same payload",
      },
    ],
    tips: [
      "This expects a bare TCP header at offset 0. In a full packet, strip the IP header first.",
      "TCP options are skipped automatically through Data Offset; no option parsing is needed.",
      "The payload may be binary. Use a hex view rather than a text editor.",
    ],
    aka: [
      "Strip TCP header", "Strip TCP Header", "remove TCP header", "TCP header removal",
      "skip TCP header", "TCP payload extraction", "TCP data offset skip", "TCP header stripper",
      "TCP segment payload", "TCP 头剥离", "去掉 TCP 头",
    ],
  },

  stripUdp: {
    what:
      "Strip UDP header: remove the fixed 8-byte UDP header and return the datagram payload.",
    principle:
      "RFC 768 defines a fixed 8-byte UDP header: source port (2 bytes), destination port (2 bytes), length (2 bytes) and checksum (2 bytes). Unlike IPv4 or TCP there is no variable-length options field, so the payload always starts at byte 8.\n\n" +
      "The op checks for at least 8 bytes and returns the rest. It does not use the length field to truncate the payload, so any capture padding remains in the output.",
    usage:
      "Supply raw UDP datagram bytes (the byte view is preferred). There are no parameters. The output is a Latin-1 byte string.",
    examples: [
      {
        in: "(byte view) 81 11 00 35 00 0d 00 00 48 45 4c 4c 4f",
        out: "HELLO",
        desc: "the first 8 bytes are the UDP header; the payload spells HELLO",
      },
      {
        in: "(byte view) 81 11 00 35 00 08 00 00",
        out: "",
        desc: "a header-only datagram has an empty payload",
      },
    ],
    tips: [
      "This expects a bare UDP datagram, not a full IP packet. Strip the IPv4/IPv6 header first.",
      "The UDP length field is ignored; the op removes exactly 8 bytes.",
      "Fewer than 8 bytes raises an error because a complete UDP header cannot exist.",
    ],
    aka: [
      "Strip UDP header", "Strip UDP Header", "remove UDP header", "UDP header removal",
      "skip UDP header", "UDP payload extraction", "UDP datagram payload", "8-byte UDP header skip",
      "UDP header stripper", "UDP 头剥离", "去掉 UDP 头",
    ],
  },

  cssSelector: {
    what:
      "CSS selector: extract elements from an HTML document using a CSS selector such as `div.box`, `#main` or `a[href]`.",
    principle:
      "The HTML is parsed by `@xmldom/xmldom` (the same parser CyberChef uses) and the selector is evaluated by `nwmatcher`, a CSS3 selector engine. Each matched DOM node is serialised back to HTML with `node.toString()`, and the results are joined with the chosen delimiter.\n\n" +
      "Selectors follow CSS3 syntax: type, class, ID and attribute selectors, descendant/child/sibling combinators, and the pseudo-classes supported by nwmatcher. It is not a full browser engine: modern pseudo-elements and some dynamic pseudo-classes are unavailable.",
    usage:
      "Enter an HTML document and a selector in `query`. `delimiter` (default `\\n`) is inserted between results and accepts escapes such as `\\x7c` for `|`.\n" +
      "An empty query or empty input returns an empty string; an invalid selector raises an error.",
    examples: [
      {
        in: '<div><p class="x">Hello</p><p>World</p></div>',
        param: "query=p, delimiter=|",
        out: '<p class="x">Hello</p>|<p>World</p>',
        desc: "both paragraph elements are returned, serialised as HTML and joined with a vertical bar",
      },
      {
        in: '<div id="main" class="box"><a href="/b" class="link">Beta</a></div>',
        param: "query=div.box a[href], delimiter=\\n",
        out: '<a href="/b" class="link">Beta</a>',
        desc: "a descendant selector combined with an attribute selector",
      },
    ],
    tips: [
      "Results are elements, not their inner text. Use XPath `text()` or an HTML-to-text op to extract text.",
      "The parser repairs common malformed HTML, but a badly broken document can still change the tree.",
      "nwmatcher is CSS3-era. Selectors that rely on modern browser behaviour may not match.",
    ],
    aka: [
      "CSS selector", "CSS Selector", "CSS query", "HTML selector", "querySelector",
      "DOM selector", "CSS selector extract", "HTML node extraction", "CSS3 selector",
      "selector matching", "CSS 选择器", "网页节点提取",
    ],
  },

  jsBeautify: {
    what:
      "JavaScript Beautify: parse JavaScript and print it back with consistent indentation, quotes, semicolons and comments.",
    principle:
      "The source is parsed by esprima into an ESTree-compatible AST and regenerated by escodegen. Because the output comes from the AST, the code is normalised: indentation is rebuilt from the `indent` string, string quotes follow `quotes`, optional semicolons are inserted before `}`, and comments are attached back when `comments` is on.\n\n" +
      "This is a parser-based formatter, not a text reflow. It accepts valid JavaScript scripts only: a top-level JSON object such as `{\"a\":1}` is parsed as a block statement with a label, not as an expression, so esprima rejects it.",
    usage:
      "Paste JavaScript and choose `indent` (default `\\t`; escaped characters are allowed), `quotes` (`auto` keeps the source where possible, `single`, `double`), `semicolons` (add semicolons before closing braces) and `comments` (keep comments).\n" +
      "A syntax error raises `Unable to parse JavaScript.` with the parser message.",
    examples: [
      {
        in: "var a=1;",
        out: "var a = 1;",
        desc: "spacing and indentation are rebuilt by the generator",
      },
      {
        in: "function greet(name){if(name){console.log(\"Hello\");}else{console.log('Hi');}}",
        param: "indent=\\t, quotes=single, semicolons=true, comments=true",
        out: "function greet(name) {\n\tif (name) {\n\t\tconsole.log('Hello');\n\t} else {\n\t\tconsole.log('Hi');\n\t}\n}",
        desc: "double quotes are converted to single quotes and the block structure is indented",
      },
    ],
    tips: [
      "Use JavaScript Parser to inspect the AST and JavaScript Minify for the opposite operation.",
      "Only scripts are supported, not ES modules or JSX.",
      "Formatting can change quote style and whitespace but must not change program behaviour.",
    ],
    aka: [
      "JavaScript Beautify", "JS Beautify", "JavaScript beautifier", "JS beautifier",
      "pretty-print JavaScript", "JavaScript pretty print", "format JavaScript",
      "JavaScript formatter", "js-beautify", "code beautification",
      "JavaScript 美化", "JS 格式化",
    ],
  },

  jsMinify: {
    what:
      "JavaScript Minify: shrink JavaScript by removing whitespace and shortening local variable names with terser.",
    principle:
      "terser parses the script, applies its default compression passes (constant folding, dead-code removal and local renaming) and prints the smallest equivalent program. The output keeps only the semicolons and spacing required by the grammar.\n\n" +
      "Minification is not encryption: the code is still executable and can be beautified again. Local variable names are lost, but string literals, property names and program logic remain.",
    usage:
      "Paste valid JavaScript. There are no parameters. Empty input returns empty output; a syntax error raises `Error minifying JavaScript.`",
    examples: [
      {
        in: "function add(a, b) { return a + b; }",
        out: "function add(n,d){return n+d}",
        desc: "whitespace is removed and the local parameters are renamed by terser",
      },
      {
        in: "var n = 1 + 2;",
        out: "var n=3;",
        desc: "constant folding turns 1 + 2 into 3",
      },
    ],
    tips: [
      "Minified names cannot be recovered from the output, but the logic can still be read after beautifying.",
      "Never treat minification as a security boundary. Client-side secrets remain recoverable.",
      "JSON input is not a valid script and will raise an error; use a JSON minifier for JSON.",
    ],
    aka: [
      "JavaScript Minify", "JS Minify", "JavaScript minifier", "JS minifier",
      "minify JavaScript", "JavaScript compressor", "JS compression", "terser minify",
      "code minification", "JavaScript 压缩", "JS 压缩",
    ],
  },

  jsParser: {
    what:
      "JavaScript Parser: parse JavaScript and print its abstract syntax tree (AST) as indented JSON.",
    principle:
      "esprima parses the input as a script and produces an ESTree-shaped tree: `Program` → statements → expressions, with node types such as `VariableDeclaration`, `Literal` and `BinaryExpression`. The tree is serialised with `JSON.stringify(..., null, 2)`.\n\n" +
      "Optional fields are off by default: `loc` adds line/column positions, `range` adds `[start, end]` offsets, `tokens` adds the token stream and `comments` adds comments. `tolerant` collects recoverable errors instead of stopping at the first one.",
    usage:
      "Paste JavaScript and toggle the fields you need. The output is JSON text; use a JSON viewer for large programs.\n" +
      "Syntax errors are raised as parse errors unless `tolerant` can recover from them.",
    examples: [
      {
        in: "1",
        out: "{\n  \"type\": \"Program\",\n  \"body\": [\n    {\n      \"type\": \"ExpressionStatement\",\n      \"expression\": {\n        \"type\": \"Literal\",\n        \"value\": 1,\n        \"raw\": \"1\"\n      }\n    }\n  ],\n  \"sourceType\": \"script\"\n}",
        desc: "the smallest useful AST: a Program containing one expression statement",
      },
      {
        in: "var a = 1 + 2;",
        param: "loc=false, range=true, tokens=true, comments=false, tolerant=false",
        out: "{\n  \"type\": \"Program\",\n  \"body\": [\n    {\n      \"type\": \"VariableDeclaration\",\n      \"declarations\": [\n        {\n          \"type\": \"VariableDeclarator\",\n          \"id\": {\n            \"type\": \"Identifier\",\n            \"name\": \"a\",\n            \"range\": [\n              4,\n              5\n            ]\n          },\n          \"init\": {\n            \"type\": \"BinaryExpression\",\n            \"operator\": \"+\",\n            \"left\": {\n              \"type\": \"Literal\",\n              \"value\": 1,\n              \"raw\": \"1\",\n              \"range\": [\n                8,\n                9\n              ]\n            },\n            \"right\": {\n              \"type\": \"Literal\",\n              \"value\": 2,\n              \"raw\": \"2\",\n              \"range\": [\n                12,\n                13\n              ]\n            },\n            \"range\": [\n              8,\n              13\n            ]\n          },\n          \"range\": [\n            4,\n            13\n          ]\n        }\n      ],\n      \"kind\": \"var\",\n      \"range\": [\n        0,\n        14\n      ]\n    }\n  ],\n  \"sourceType\": \"script\",\n  \"range\": [\n    0,\n    14\n  ],\n  \"tokens\": [\n    {\n      \"type\": \"Keyword\",\n      \"value\": \"var\",\n      \"range\": [\n        0,\n        3\n      ]\n    },\n    {\n      \"type\": \"Identifier\",\n      \"value\": \"a\",\n      \"range\": [\n        4,\n        5\n      ]\n    },\n    {\n      \"type\": \"Punctuator\",\n      \"value\": \"=\",\n      \"range\": [\n        6,\n        7\n      ]\n    },\n    {\n      \"type\": \"Numeric\",\n      \"value\": \"1\",\n      \"range\": [\n        8,\n        9\n      ]\n    },\n    {\n      \"type\": \"Punctuator\",\n      \"value\": \"+\",\n      \"range\": [\n        10,\n        11\n      ]\n    },\n    {\n      \"type\": \"Numeric\",\n      \"value\": \"2\",\n      \"range\": [\n        12,\n        13\n      ]\n    },\n    {\n      \"type\": \"Punctuator\",\n      \"value\": \";\",\n      \"range\": [\n        13,\n        14\n      ]\n    }\n  ]\n}",
        desc: "range and tokens add source offsets to every node",
      },
    ],
    tips: [
      "The AST describes syntax, not runtime values; nothing is executed.",
      "`loc`/`range` are useful for source maps, linters and patching tools.",
      "`tolerant` collects errors but does not turn an invalid program into a valid one.",
    ],
    aka: [
      "JavaScript Parser", "JS Parser", "JavaScript AST", "JS AST", "parse JavaScript",
      "JavaScript syntax tree", "ESTree", "ESTree AST", "esprima parser",
      "JavaScript parsing", "JavaScript 解析", "JS 语法树",
    ],
  },

  jsonataQuery: {
    what:
      "Jsonata Query: query and transform JSON with a JSONata expression and return JSON.",
    principle:
      "JSONata is a functional query and transformation language for JSON. The expression is compiled once and evaluated against the parsed input; the result is serialised with `JSON.stringify`. This op also registers `$base64decode` and `$base64encode`, matching CyberChef.\n\n" +
      "Paths such as `Address.City` navigate objects, `Phone[type='office'].number` filters arrays, and expressions can compute values, concatenate strings with `&`, and build new objects or arrays. A missing path yields `undefined`, which the op renders as an empty JSON string (`\"\"`).",
    usage:
      "Enter valid JSON and a `query` (default `string`, which selects a top-level field named `string`). Invalid JSON or an invalid expression raises an explicit error.",
    examples: [
      {
        in: '{"string":"abc"}',
        out: '"abc"',
        desc: "the default query selects the string field and the result is JSON-quoted",
      },
      {
        in: '{"Age":28,"FirstName":"Fred","Surname":"Smith"}',
        param: "query=FirstName & ' ' & Surname",
        out: '"Fred Smith"',
        desc: "& concatenates strings; the result is still serialised as JSON",
      },
    ],
    tips: [
      "JSONata is not jq: `&` concatenates strings, and path navigation is implicit.",
      "Use backticks for field names that contain spaces or punctuation.",
      "Registering base64 helpers does not expose arbitrary functions or filesystem access.",
    ],
    aka: [
      "Jsonata Query", "JSONata", "JSONata query", "JSONata expression", "JSON query",
      "JSON transformation", "JSONata evaluator", "JSONata expression evaluator",
      "JSON query language", "JSONata 查询", "JSON 查询",
    ],
  },

  sqlBeautify: {
    what:
      "SQL Beautify: reformat SQL with indentation and line breaks while keeping `:name` bind variables intact.",
    principle:
      "The op uses `sql-formatter` with the MySQL dialect and the `standard` indent style. Before formatting, it temporarily replaces `:name` bind parameters with placeholders (`__BIND_n__`) so the formatter cannot split or quote them; the original names are restored afterwards.\n\n" +
      "`indent` selects tabs or spaces: an empty or non-tab string is treated as spaces with a width equal to its length, falling back to 4. Formatting changes layout, not semantics; keywords are upper-cased according to the library's rules.",
    usage:
      "Paste SQL and set `indent` (default `\\t`). The output is formatted SQL. Empty input returns empty; an unterminated string or another parse error raises an error.",
    examples: [
      {
        in: "SELECT MONTH, ID, RAIN_I, TEMP_F FROM STATS;",
        param: "indent=two spaces",
        out: "SELECT\n  MONTH,\n  ID,\n  RAIN_I,\n  TEMP_F\nFROM\n  STATS;",
        desc: "the official CyberChef vector with two-space indentation",
      },
      {
        in: "SELECT * FROM t WHERE id = :id;",
        param: "indent=\\t",
        out: "SELECT\n\t*\nFROM\n\tt\nWHERE\n\tid = :id;",
        desc: "the :id bind variable is protected and restored unchanged",
      },
    ],
    tips: [
      "The dialect is fixed to MySQL; PostgreSQL-only syntax may be formatted incorrectly.",
      "Bind-variable protection covers `:name`, not `?` or `$1`.",
      "Beautifying is not validation. Always run the SQL against the target engine.",
    ],
    aka: [
      "SQL Beautify", "SQL Beautifier", "SQL formatter", "format SQL", "pretty-print SQL",
      "SQL pretty print", "SQL indentation", "sql-formatter", "MySQL beautify",
      "SQL 美化", "SQL 格式化",
    ],
  },

  xpathQuery: {
    what:
      "XPath expression: extract nodes from XML with an XPath 1.0 expression.",
    principle:
      "The XML is parsed by `@xmldom/xmldom`, then the expression is evaluated by the `xpath` package. The result can contain element, attribute and text nodes; each is serialised with `node.toString()` and joined with the delimiter. The parser allows any namespace when the expression has no prefix, which makes simple paths work on namespaced documents.\n\n" +
      "XPath basics: `/root/item` selects children from the document root, `//item` searches descendants, `[@kind='b']` filters by attribute, `text()` selects text nodes and `@id` selects attributes.",
    usage:
      "Enter XML and an XPath `query`; `delimiter` (default `\\n`, escapes supported) separates results. An empty query or invalid XPath raises an error; the parser may recover from non-fatal XML errors.",
    examples: [
      {
        in: '<root><item id="1">Alpha</item><item id="2">Beta</item></root>',
        param: "query=//item/text(), delimiter=|",
        out: "Alpha|Beta",
        desc: "text() returns the two text nodes, joined with a vertical bar",
      },
      {
        in: '<root><item id="1" kind="a"><name>Alpha</name></item><item id="2" kind="b"><name>Beta</name></item></root>',
        param: "query=//item[@kind='b']/name, delimiter=\\n",
        out: "<name>Beta</name>",
        desc: "an attribute predicate selects one element",
      },
    ],
    tips: [
      "Attribute results serialise as ` id=\"1\"` with a leading space, because they are attribute nodes.",
      "XPath 1.0 has no `lower-case()` or `matches()` functions; those belong to XPath 2.0/XQuery.",
      "XML is case-sensitive: `item` and `Item` are different elements.",
    ],
    aka: [
      "XPath expression", "XPath query", "XPath selector", "XML XPath", "XPath extract",
      "XML node extraction", "XPath 1.0", "XPath evaluation", "XML query",
      "XPath 表达式", "XPath 查询",
    ],
  },

  jqQuery: {
    what:
      "jq JSON query: filter and transform JSON with jq expressions such as `.foo.bar` or `.[] | .name`.",
    principle:
      "The input is parsed as JSON and evaluated by jq compiled to asm.js (`jq-web`). jq treats a JSON document as a stream of values: `.` is identity, `.foo` selects a field, `.[]` iterates an array, `|` pipes, and functions such as `map(...)`, `select(...)` and `join(...)` transform values. Multiple outputs are collected into an array by this wrapper.\n\n" +
      "With `Raw` on and a string result, the string is emitted without JSON quotes; otherwise the result is serialised with `JSON.stringify`. An empty query returns the input unchanged.",
    usage:
      "Enter valid JSON and a jq `query` (default empty). Toggle `Raw` to strip quotes from string results. Invalid JSON or a jq syntax error raises an explicit error.",
    examples: [
      {
        in: '{"a":[1,2,3]}',
        param: "query=.a | map(.+1), raw=false",
        out: "[2,3,4]",
        desc: "map applies the expression to each array element",
      },
      {
        in: '{"data":"testString"}',
        param: "query=.data, raw=true",
        out: "testString",
        desc: "Raw removes the JSON quotes from a string result",
      },
    ],
    tips: [
      "jq is not JSONPath: use `.[]`, `|` and functions rather than `$..` syntax.",
      "`Raw` affects only string results; arrays and objects are still JSON-encoded.",
      "jq-web reports some errors tersely (for example `N compile error`), and the first use loads a ~1.75 MB engine.",
    ],
    aka: [
      "Jq", "jq", "jq query", "jq expression", "jq JSON query", "JSON jq", "jq filter",
      "jq-web", "JSON query with jq", "JQ", "jq 查询",
    ],
  },

  yaraScan: {
    what:
      "YARA Rules: scan bytes with YARA rules and report matching rules, string offsets and optional metadata.",
    principle:
      "YARA compiles rules that combine text, hexadecimal and regular-expression strings with a boolean condition. The rule set is compiled by libyara (WebAssembly) and run against the input bytes. For each match the op can show the rule name, metadata, match count, string identifier, offset, length and matched data; it can also show compile warnings and messages from YARA's `console` module.\n\n" +
      "Text input is encoded as UTF-8; when a byte view is present those bytes are used directly. Positions are zero-based byte offsets. A rule matches only when its `condition` is true, not merely because a string appears.",
    usage:
      "Paste YARA rules in `rules` and the data in the main input. Toggles: `showStrings`, `showLengths`, `showMeta`, `showCounts`, `showRuleWarns` and `showConsole`.\n" +
      "Rule syntax errors raise an error with the line number; no match returns an empty string.",
    examples: [
      {
        in: "xxflagyy",
        param: "rules=rule Demo { strings: $a = \"flag\" condition: $a }, showStrings=true, showLengths=true",
        out: 'Rule "Demo" matches (1 time):\nPos 2, length 4, identifier $a, data: "flag"\n',
        desc: "the match is reported at byte offset 2 with its identifier and matched bytes",
      },
      {
        in: "foobar",
        param: "rules=rule NoMatch { strings: $a = \"zzzz\" condition: $a }",
        out: "",
        desc: "a rule whose condition is false produces no output",
      },
    ],
    tips: [
      "Use `condition: $a` for a simple string match. Hexadecimal strings use `{ 48 65 6C 6C 6F }`; regular expressions use `/.../`.",
      "The first use loads a ~1.18 MB engine; it is lazy and local.",
      "YARA detects patterns, it does not decrypt or execute the data. Always validate a rule against benign samples.",
    ],
    aka: [
      "YARA Rules", "YARA", "YARA scan", "YARA rule scan", "YARA matcher",
      "YARA rule matching", "malware rule scan", "pattern matching rules", "libyara",
      "YARA 规则扫描", "YARA 规则",
    ],
  },

  disasmArm: {
    what:
      "Disassemble ARM: turn ARM, Thumb or ARM64 machine code into readable assembly instructions.",
    principle:
      "The bytes are decoded by Capstone (WebAssembly build). `arch` selects ARM (32-bit ARM mode), ARM Thumb (16/32-bit Thumb encoding) or ARM64 (AArch64). Each decoded instruction is printed as `address  hex-bytes  mnemonic operands`; the address starts at `base` and advances by the instruction size.\n\n" +
      "Thumb and A64 are different instruction sets, so the same bytes can mean different things in different modes. No code is executed and no process memory is read; this is static decoding only.",
    usage:
      "Enter machine code as hex (spaces, colons and `0x` are accepted) or base64, choose `arch` and `enc`, and set `base` if the code will run at a non-zero address.\n" +
      "Empty input, invalid hex, odd-length hex or an unsupported architecture raises an error.",
    examples: [
      {
        in: "00 00 a0 e1",
        param: "arch=arm, enc=hex, base=0",
        out: "0x0        00 00 a0 e1          mov r0, r0",
        desc: "the canonical ARM NOP (e1a00000 little-endian)",
      },
      {
        in: "00 bf",
        param: "arch=arm-thumb, enc=hex, base=0",
        out: "0x0        00 bf                nop",
        desc: "the same op in Thumb mode decodes a 16-bit NOP",
      },
    ],
    tips: [
      "ARM and Thumb bytes are not interchangeable; choose the mode that matches the code.",
      "For raw binary use the byte view. Capstone output is a disassembly, not a decompilation.",
      "The address column follows `base`; set it when matching a real firmware image or an ELF section.",
    ],
    aka: [
      "Disassemble ARM", "ARM disassembler", "ARM disassembly", "disassemble ARM",
      "ARM32 disassembly", "Thumb disassembly", "ARM64 disassembly", "AArch64 disassembly",
      "Capstone ARM", "ARM 反汇编", "ARM64 反汇编",
    ],
  },

  disasmX86: {
    what:
      "Disassemble x86: turn x86 or x86-64 machine code into Intel or AT&T assembly.",
    principle:
      "Capstone decodes the bytes in 32-bit or 64-bit mode. The same byte sequence can decode differently: `48 89 e5` is `dec eax; mov ebp, esp` in 32-bit mode but `mov rbp, rsp` in 64-bit mode, because `0x48` is a REX prefix only in long mode. Each instruction is printed as `address  hex-bytes  mnemonic operands`.\n\n" +
      "Intel syntax is the default (`mov rbp, rsp`). AT&T syntax reverses the operand order and uses `%` register prefixes (`movq %rsp, %rbp`).",
    usage:
      "Enter machine code as hex or base64, choose `arch` (`x86` or `x86-64`), `syntax` (`intel` or `att`), `enc` and `base`.\n" +
      "Invalid or odd-length hex raises an error, and so does an unsupported architecture.",
    examples: [
      {
        in: "90",
        param: "arch=x86, syntax=intel, enc=hex, base=0",
        out: "0x0        90                   nop",
        desc: "0x90 is the one-byte x86 NOP",
      },
      {
        in: "48 89 e5",
        param: "arch=x86-64, syntax=intel, enc=hex, base=0",
        out: "0x0        48 89 e5             mov rbp, rsp",
        desc: "in 64-bit mode the REX.W prefix makes this a 64-bit move",
      },
    ],
    tips: [
      "Pick the correct bitness first: x86-64 adds REX prefixes and 64-bit registers.",
      "`90` is `nop` and `c3` is `ret`. AT&T syntax is source-first; Intel syntax is destination-first.",
      "Use the byte view for non-text bytes and set `base` when disassembling a mapped image.",
    ],
    aka: [
      "Disassemble x86", "x86 disassembler", "x86 disassembly", "disassemble x86",
      "x86-64 disassembly", "AMD64 disassembly", "Intel syntax disassembly",
      "AT&T syntax disassembly", "Capstone x86", "x86 反汇编", "x86-64 反汇编",
    ],
  },
};
