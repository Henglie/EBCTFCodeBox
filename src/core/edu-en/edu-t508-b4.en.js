/*
 * edu-t508-b4.en.js — English edu cards for T508 batch 4 (engEncoding.js).
 * hexdump / modhex / citrixCtx1 / scriptDecoder / rison / unixPerms
 * Example outputs mirror the zh shard (real runs, test.mjs of 批4_工程编码).
 */
export default {
  hexdump: {
    what: "Hexdump — the classic three-column byte view (offset: hexadecimal + ASCII) that is the standard language of reverse engineering and forensics. The encode direction of this tool reproduces the xxd default format byte-for-byte (diffed against a real xxd run); the decode direction restores raw data from dumps produced by xxd, hexdump -C, CyberChef and other common tools.",
    principle:
      "Each line has three columns:\n\n" +
      "1. Offset: position of the line's first byte in the file, 8 hex digits (line $k$ = $k \\times$ width);\n" +
      "2. Hex column: two hex digits per byte, **grouped in byte pairs** (xxd's signature — 4 hex chars per group, single space between groups);\n" +
      "3. ASCII column: printable bytes (0x20-0x7E) shown literally, everything else as `.`.\n\n" +
      "Short lines pad the hex column with spaces so the ASCII column stays aligned. Decoding reverses this: strip the offset, collect hex tokens — and stop at a **double space** (the ASCII column boundary, so ASCII text like `abcdef` is never mistaken for data). A `*` line means the previous line repeats (xxd -a / hexdump squashing); the repeat count comes from the next line's offset gap.",
    usage: "Encode: paste any text (converted to UTF-8 bytes); default 16 bytes per line, lowercase, width (1-512) and case adjustable. Decode: paste any common dump format; detection is automatic. Cross-check trick: Git Bash ships xxd — `echo -n text | xxd` output must match this tool exactly; `xxd -r` verifies the decode direction.",
    examples: [
      { in: "CTF{hex_dump!}", param: "default 16 bytes/line", out: "00000000: 4354 467b 6865 785f 6475 6d70 217d       CTF{hex_dump!}", desc: "Byte-identical to xxd (short line auto-pads the ASCII column)" },
      { in: "00000000: 5468 6520 7175 6963 6b20 6272 6f77 6e  The quick brown", param: "decode direction", out: "The quick brown", desc: "Restore text from an xxd dump" },
    ],
    tips: [
      "The ASCII column is human-friendly redundancy; the real data lives in the hex column — copying the hex region is enough.",
      "Common pitfall: a long run of spaces before the ASCII column on short lines is structural padding — the tool detects the column boundary by double space, don't hand-delete it.",
      "For plain hex strings (no offset, no ASCII) use the Hex op instead of this one (bare hex lines would be misread as data). Reference: https://wikipedia.org/wiki/Hex_dump .",
    ],
    aka: ["hexdump", "十六进制转储", "hex dump", "xxd", "xxd format", "hex view", "hex viewer", "hex 转储", "hexdump -C", "od style dump", "hex listing", "十六进制视图"],
  },

  modhex: {
    what: "Modhex — YubiKey's keyboard-layout-independent hexadecimal: the sixteen digits 0-f are swapped for the sixteen letters cbdefghijklnrtuv. YubiKeyOTP token IDs, public key moduli and friends are modhex strings; a weird lowercase blob starting with `cccccc…` in a CTF should ring the bell.",
    principle:
      "A YubiKey types like a keyboard, and keyboard layouts disagree on which character a physical key emits. The chosen 16 letters (c b d e f g h i j k l n r t u v) sit on the same physical keys across QWERTY / AZERTY / QWERTZ / Dvorak, so the same string is read regardless of the host layout.\n\n" +
      "Encoding is digit substitution: byte → two hex digits → look up two modhex letters. Mapping (hex → modhex):\n\n" +
      "`0→c 1→b 2→d 3→e 4→f 5→g 6→h 7→i 8→j 9→k a→l b→n c→r d→t e→u f→v`\n\n" +
      "Example: byte 0xE6 → `e6` → `uh`. Multi-byte text (e.g. Chinese) expands to its UTF-8 byte stream first.",
    usage: "Paste-and-go both directions: encode takes any text (UTF-8); decode is case-insensitive and tolerates common delimiters (space, colon, comma, …). This is exactly the table behind YubiKey's official OTP decoding examples (modhex → hex → bytes).",
    examples: [
      { in: "hello", param: "no delimiter", out: "hjhghrhrhv", desc: "Byte-by-byte two-letter substitution" },
      { in: "uhkgkbuhkgkbugltlkugltkc", param: "decode", out: "救救孩子", desc: "CyberChef test vector: modhex → UTF-8 Chinese" },
      { in: "aberystwyth", param: "default", out: "hbhdhgidikieifiiikifhj", desc: "CyberChef test vector" },
    ],
    tips: [
      "Recognition: the string consists only of the 16 letters cbdefghijklnrtuv — notably missing common letters like a, m, o, p, q, s.",
      "A YubiKey OTP is 32 modhex bytes: first 12 chars are the token ID, followed by counters + randomness + CRC.",
      "Mixed case (e.g. `uhKGkb`) decodes fine; odd length raises an error about a dropped character. Reference: https://en.wikipedia.org/wiki/YubiKey#ModHex .",
    ],
    aka: ["modhex", "modhex encoding", "yubikey encoding", "yubikey modhex", "modified hexadecimal", "mod hex", "layout independent hex", "yubico modhex", "modhex decode", "modhex convert", "yubikey hex", "cbdefghijklnrtuv"],
  },

  citrixCtx1: {
    what: "Citrix CTX1 — the light obfuscation Citrix uses to store passwords client-side: the result is a string of letters A-P (4 letters per plaintext character). Found in .ica files, Citrix Web Interface configs and registry Autologon entries; security audits routinely need to reverse it.",
    principle:
      "Two steps:\n\n" +
      "1. Expand the plaintext as UTF-16LE bytes (2 bytes per character, CJK included);\n" +
      "2. Chained XOR: $temp_i = b_i \\oplus \\mathrm{0xA5} \\oplus temp_{i-1}$ ($temp$ starts at 0) — each step folds in the previous result, so the same plaintext byte encodes differently at different positions;\n" +
      "3. Split each $temp$ into nibbles and add 0x41 to each, mapping to two `A`-`P` letters (high nibble first).\n\n" +
      "Decoding inverts everything: restore $val$ from letter pairs, $b_i = val_i \\oplus \\mathrm{0xA5} \\oplus val_{i-1}$, then reassemble the string as UTF-16LE. Ciphertext length must be a multiple of 4.",
    usage: "No parameters, both directions. Ciphertext accepts A-P only (either case). Hand-verification: plaintext `P` (0x50) → temp = 0x50⊕0xA5 = 0xF5 → outputs `PF`; second byte 0x00 → temp = 0xA5⊕0xF5 = 0x50 → outputs `FA`; together `PFFA`.",
    examples: [
      { in: "Password1", param: "encode", out: "PFFAJEDBOHECJEDBODEGIMCJPOFLJKDPKLAO", desc: "CyberChef official test vector (9 chars → 36 letters)" },
      { in: "PFFAJEDBOHECJEDBODEGIMCJPOFLJKDPKLAO", param: "decode", out: "Password1", desc: "Official vector, reversed" },
    ],
    tips: [
      "Recognition: ciphertext entirely within A-P and a multiple of 4 in length — a much narrower alphabet than base64.",
      "This is encoding, not encryption (no key): anyone can restore it, so audits flag it as plaintext-equivalent storage.",
      "The chained XOR means repeated characters never repeat in ciphertext — single-letter frequency guessing fails. Reference: CyberChef Citrix CTX1 Encode/Decode (algorithm from the original reddit r/AskNetsec thread).",
    ],
    aka: ["citrix ctx1", "ctx1", "citrix password encoding", "citrix ctx1 encode", "citrix ctx1 decode", "citrix credentials decode", "ica password", "citrix autologon", "citrix hash decode", "思杰密码", "citrix 密码编码", "ctx1 解码"],
  },

  scriptDecoder: {
    what: "Microsoft Script Decoder (scrdec) — restores Microsoft 'encoded scripts': VBScript/JScript encrypted by screnc.exe and renamed to .vbe / .jse. The file body is a blob of noise wrapped in `#@~^…^#~@`. Common in malicious email attachments and dropped phishing files; a forensics staple.",
    principle:
      "Layout: `#@~^` + 6-char length marker + `==` + encoded body + 6 chars + `==` + `^#~@` (the length marker is not verified when decoding).\n\n" +
      "The body decodes in two steps:\n\n" +
      "1. Escape replacement: `@&`→LF, `@#`→CR, `@*`→`>`, `@!`→`<`, `@$`→`@`;\n" +
      "2. Table substitution: every 'decodable' character (TAB and 32-127 except `<` `>` `@`) is looked up in a 128-row × 3-column table; which column is taken is decided per-position by a 64-step cyclic combination sequence — the same ciphertext character decodes differently at different positions, which is what defeats eyeballing.\n\n" +
      "The position counter only counts ASCII characters (non-ASCII passes through uncounted); CR/LF after escape replacement each count 1.",
    usage: "One-way decode: paste the whole .vbe/.jse file; the tool locates the `#@~^…==…==^#~@` block automatically. What comes out is the plain VBS/JS source.",
    examples: [
      { in: "#@~^RQAAAA==-mD~sX|:/TP{~J:+dYbxL~@!F@*@!+@*@!&@*eEI@#@&@#@&\u007fjm.raY 214Wv:zms/obI0xEAAA==^#~@", param: "none", out: "var my_msg = \"Testing <1><2><3>!\";\r\n\r\nWScript.Echo(my_msg);", desc: "CyberChef official test vector (MS.mjs)" },
    ],
    tips: [
      "Recognition: the file starts with `#@~^` — the signature header of JScript.Encode / VBScript.Encode.",
      "Real-world samples may contain several encoded blocks (include scenarios); this tool takes the first regex-matchable block, same as CyberChef.",
      "Never execute the decoded VBS right away — the typical next step is hunting IOCs like DownloadString / ShellExecute. Reference: https://wikipedia.org/wiki/JScript.Encode and Didier Stevens' original scrdec.",
    ],
    aka: ["microsoft script decoder", "scrdec", "vbe decode", "jse decode", "vbe decrypt", "jse decrypt", "screnc reverse", "script decode", "jscript encode decode", "vbscript encode decode", "encoded script restore", "vbe 解码"],
  },

  rison: {
    what: "Rison — 'compact JSON for URLs': it expresses exactly the same data structures as JSON but is 35-45% shorter than URI-encoded JSON (Freebase's measured numbers) and needs almost no %-escaping. Seeing something like `(q:'*',start:10)` in REST query parameters means rison.",
    principle:
      "Token mapping versus JSON: `(`=`{` object, `!(`=`[` array, `!t`/`!f`=true/false, `!n`=null, `'`=`\"` quote, `!`=backslash escape.\n\n" +
      "- Identifiers go unquoted: any string without `' ! : ( ) , * @ $` or spaces that does not start with `-` or a digit is written bare;\n" +
      "- Inside quoted strings only `'` and `!` need escaping (written `!'` and `!!`);\n" +
      "- Numbers are a JSON subset: exponents use `e`/`E`, `+` is forbidden (unsafe in URIs), `-` kept;\n" +
      "- No whitespace at all; objects are encoded with keys lexically sorted (URL-cache friendly);\n" +
      "- Variants: O-Rison drops the object parens (`a:1,b:2`), A-Rison drops the array `!()` (`a,b,c`), and URI mode applies a lenient URL quoting layer (space → `+`).\n\n" +
      "Note: the '~ lookup-table compression' and '!1 array shorthand' sometimes mentioned do not exist in the authoritative spec (Nanonid/rison); this tool implements the real grammar.",
    usage: "Encode takes JSON text (value / O / A / URI modes); decode outputs indented JSON. Nesting, empty strings `''`, negative numbers, fractions and exponents all work; bad escapes, unclosed brackets and trailing junk raise positioned errors.",
    examples: [
      { in: "{\"any\":\"json\",\"yes\":true}", param: "value mode", out: "(any:json,yes:!t)", desc: "Spec homepage example" },
      { in: "{\"supportsObjects\":true,\"ints\":435}", param: "O-Rison", out: "ints:435,supportsObjects:!t", desc: "Keys auto-sorted (spec example)" },
      { in: "[\"A\",\"B\",{\"supportsObjects\":true}]", param: "A-Rison", out: "A,B,(supportsObjects:!t)", desc: "Bare array + nested object (spec example)" },
      { in: "(name:'Tom',tags:!(a,b),ok:!t)", param: "decode", out: "{\n  \"name\": \"Tom\",\n  \"tags\": [\n    \"a\",\n    \"b\"\n  ],\n  \"ok\": true\n}", desc: "Nested structure restored to indented JSON (real run)" },
    ],
    tips: [
      "Quick recognition: bare parens/bangs/colons in a URL parameter (`!(`, `:!t`) — if %-encoded, URL-decode first.",
      "Unlike JSON5/PSON, rison is a strict re-spelling of JSON semantics: no comments, no trailing commas.",
      "Encoding reorders keys — round-tripping JSON changes object key order (content intact). Reference: https://github.com/Nanonid/rison .",
    ],
    aka: ["rison", "rison encode", "rison decode", "compact json", "url json", "rison json", "o-rison", "a-rison", "orison", "arison", "url serialized json", "rison 解码", "rison 编码"],
  },

  unixPerms: {
    what: "UNIX file permissions — the 10 leading characters of every `ls -l` line (`-rwsr-xr-t`) and the chmod number (`4755`) converted into each other, as a full report: read/write/execute for owner/group/other plus the setuid/setgid/sticky special bits. Used when triaging webshell permissions and writing deployment scripts.",
    principle:
      "The 9 basic bits split into three triples (u owner / g group / o others); each rwx triple maps to $4+2+1$: `rwxr-xr-x` = $(4{+}2{+}1)(4{+}1)(4{+}1) = 755$.\n\n" +
      "The leading fourth digit adds special bits the same way: setuid=4 (execute as the file's owner), setgid=2 (execute as the group; on directories new files inherit the group), sticky=1 (only the owner may delete files inside the directory — `/tmp` is 1777). So `4755` = setuid + 755.\n\n" +
      "In symbolic form special bits occupy the execute slot: with execute they show `s`/`t`, without it uppercase `S`/`T` — e.g. 4644 → `rwSr--r--` (setuid, no execute). Leading type char: `-` regular, `d` directory, `l` link, `c`/`b` devices, `p` pipe, `s` socket.",
    usage: "Run-type report: feed any one form (755 / 0755 / 4755 / rwxr-xr-x / drwxr-xr-t / -rwSr--r--) and get every other form: symbolic, with type char, 3/4-digit octal, binary bits, numeric and symbolic chmod commands, special-bit explanations, and per-identity details.",
    examples: [
      { in: "755", param: "none", out: "符号形（9 位）：rwxr-xr-x\n带类型位（10 位）：-rwxr-xr-x\n八进制（4 位，含特殊位）：0755\n二进制位：111 101 101\nchmod 命令：chmod 0755 文件\n符号 chmod：chmod u=rwx,g=rx,o=rx 文件\n特殊位：无（setuid / setgid / sticky 均未设置）", desc: "Excerpt of the real report (full report adds per-identity details)" },
      { in: "4755", param: "none", out: "符号形（9 位）：rwsr-xr-x\nchmod 命令：chmod 4755 文件\n特殊位（八进制首位 4）：setuid——以文件属主身份执行", desc: "setuid folds into the owner execute slot as s (real-run excerpt)" },
      { in: "drwxrwxrwt", param: "none", out: "八进制（4 位，含特殊位）：1777\n文件类型：目录（d）\n特殊位：sticky——仅属主可删改目录内文件，典型如 /tmp", desc: "The actual /tmp permissions (real-run excerpt)" },
    ],
    tips: [
      "See an `s`, think privilege escalation: setuid binaries (e.g. an old `4755` nmap) are classic privesc scan targets.",
      "Uppercase `S`/`T` = special bit set but no execute bit — usually a misconfiguration, what happens when you chmod and forget the x.",
      "Reading numbers: three digits get a leading zero (755 = 0755); in four digits the FIRST digit is the special bits, not the owner! Reference: https://en.wikipedia.org/wiki/File_system_permissions .",
    ],
    aka: ["unix file permissions", "linux file permissions", "file permissions", "chmod calculator", "permission convert", "rwx conversion", "octal permissions", "chmod numeric", "setuid", "setgid", "sticky bit", "permission bits", "ls -l permissions", "unix 权限"],
  },
};
