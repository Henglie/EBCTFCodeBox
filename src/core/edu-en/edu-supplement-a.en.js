// English cards for ops that previously fell back to Chinese: base32 / x509Parse / zipCommentExtract.
export default {
  base32: {
    what: "An encoding using 32 characters (A-Z and 2-7). Longer than base64 but uses only uppercase letters and a few digits, easy to recognize.",
    principle: "Every 5 bytes (40 bits) are split into 8 groups of 5 bits; each 5-bit index maps into a 32-character alphabet (RFC 4648 uses `A-Z2-7`).\n\nWhen fewer than 5 bytes remain, zeros are appended and `=` padding is added, so base32 strings have lengths that are multiples of 8 and often end with a run of `=`.",
    usage: "Paste base32 text to decode; the encode direction turns plaintext into base32. A custom alphabet is supported.",
    examples: [
      { in: "NBSWY3DP", param: "Direction: decode; typical base32 look (uppercase + digits)", out: "hello", desc: "All uppercase plus digits; a typical base32 string", run: { dir: "decode" } },
      { in: "JBSWY3DPEBLW64TMMQ======", param: "Direction: decode", out: "Hello World", desc: "A long run of trailing = is the hallmark", run: { dir: "decode" } },
    ],
    tips: [
      "Only uppercase A-Z and digits 2-7 (no 0/1/8/9), often several trailing =: that is basically base32.",
      "No lowercase, no +/: the clearest way to tell it from base64.",
    ],
    aka: ["base 32", "b32", "Base32", "base32 encoding", "base32 encode", "radix 32", "RFC 4648", "A-Z2-7 encoding", "base32 decode", "thirty-two"],
  },

  x509Parse: {
    what: "An X.509 certificate parser: it turns a blob of base64 into readable fields — version, serial, issuer, subject, validity, public key, extensions, signature — listed one by one.",
    principle: "A certificate (ITU-T X.509 / RFC 5280 §4.1) is an ASN.1 DER structure: tbsCertificate (with a [0] EXPLICIT tag from v3), signature algorithm, signature value.\n\nParsing covers: serial number (raw bytes + decimal), validity (UTCTime/GeneralizedTime, with a selectable reference time), Issuer/Subject DN (in encoding order, i.e. openssl -text order, with an RFC 4514 string), SubjectPublicKeyInfo (RSA modulus/exponent, EC curve coordinates), the extensions area (critical flags, SKID/AKI/basicConstraints and a full OID table), and the signature value.\n\nIt also checks structural consistency: the outer AlgorithmIdentifier must match the one inside tbs (RFC 5280 §4.1.2.3).",
    usage: "Paste a certificate (PEM or DER hex). Optionally set the reference time for expiry checks (default: now). Cross-checkable with openssl x509 -text.",
    examples: [
      { in: "DER hex (example: an 803-byte self-signed certificate; first 32 bytes shown here)", param: "Input is full DER hex; output is a multi-section report; shown here is a fragment", out: "X.509 证书解析（ITU-T X.509 / RFC 5280 §4.1）", desc: "This tool only parses certificate structure (version/serial/algorithm/validity/subject/extensions); it does NOT verify signatures or judge trust-chain validity. The example keeps only the report title line", run: { dir: "run", inputHex: "3082031f30820207a00302010202141f986dc922071fd2b0e198e58a20519f2a80dd9d300d06092a864886f70d01010b0500301f310d300b06035504030c0464656d6f310e300c060355040a0c054542435446301e170d3236313131373030313335345a170d3236313131383030313335345a301f310d300b06035504030c0464656d6f310e300c060355040a0c05454243544630820122300d06092a864886f70d01010105000382010f003082010a0282010100ac171e3e3313eb09a010ff8e48059a6accd56fa12cc183f23c11cc6acd3c4c16c4d38045835630c858b623109df8cc403653914b82907e9565e7ad37432ba4ee481001ab2f53c8f6a6eababe08795ae710efba6065ac1a48cfa072604be731aaa05327e536dd5e83c54222a287c6085976cf439fd092b66b462c99432560ba08f7619c37beedd74c1290de72a59e0c6a988c0b2941fec21b8d4d612eba217882c70c84472f1419ac1220511f72de3c96e170bf214672ecd9317df55c748b6b3cd22fe2f7deb848dcabec29cc9244f22f503d63e3fbadf3d443947cd0388deb47526c4b1883099cc5fa6ea687344b5ad06add9ff12da104d0eb166b9732a99ec70203010001a3533051301d0603551d0e0416041425de653085b7445d29d81bc0195ac83e53494e34301f0603551d2304183016801425de653085b7445d29d81bc0195ac83e53494e34300f0603551d130101ff040530030101ff300d06092a864886f70d01010b0500038201010052c0623d005075c351cd7817af133a3afb6928063ae9ef5cbe06939af09c730a7e72d3873456d068f4c1a1fd4d116b556c2a3fb3b9b345f13d3950a49d062090d806c60d5d43eb180578847e11a58d99e2517952d25a0b4628f1a728a93868323fbc589418d50c47302e10742ba1f0ce711a12b39cdfaa8c3d8ab1c8440493a7a017f868761d991960f8096a676b4fb9b176a73b26a722a3c818aa49aec2e0507a9e2c35e512a53d219d3b2cb276aa58de1794369b08919accafb3055f9b5da1837f74b8e909c974bda581db4403199b66e85f7dca4956ad347187b2e8fd9f8e19663511bf1e732cbfa3703f13f8226789fe4418251f54d0dba997130f108898", match: "contains" } },
    ],
    tips: [
      "Classic CTF certificate tricks: flag in subject, flag in SAN/custom extensions, or data hidden in the serial number or validity (hex serials and UTCTime seconds have both been used).",
      "Issuer == Subject means self-signed — together with basicConstraints CA=TRUE, see which CA the cert pretends to be.",
      "An outer algorithm differing from the tbs one is the old 'dual-algorithm certificate' attack shape; this parser's check shows exactly that.",
    ],
    aka: ["x.509 parse", "certificate parse", "x509 parse", "certificate parser", "certificate viewer", "openssl x509 -text", "digital certificate parser", "parse certificate", "cert parse", "certificate info", "certificate fields", "der certificate parse", "certificate decoder"],
  },

  zipCommentExtract: {
    what: "ZIP comment extraction — a ZIP has two legal comment locations: the archive comment (tail of the EOCD record) and each entry's own comment (in the central directory header, after the filename). CTF misc authors love hiding flags or hints in these two spots (`unzip -z` only shows the archive comment; entry comments are often overlooked); forensically, comments can reveal the packing tool, timestamps, or next-step instructions. It shares the EOCD→central-directory path with 'ZIP fake-encryption repair' without conflict.",
    principle: "EOCD (signature 50 4B 05 06, searched backwards from EOF): offset 20 is the archive-comment length (2 bytes little-endian, max 65535), and the comment body starts at offset 22 (APPNOTE §4.3.16).\nA central-directory file header (50 4B 01 02, whose offset and entry count are stored in the EOCD): offsets 28/30/32 are filename length / extra length / comment length (2 bytes little-endian), and the comment follows the name and extra field (§4.3.7).\nThe local file header (LFH) has no comment field — only the central-directory side can hide one. General-purpose bit flag bit11=1 (EFS) means names and comments are UTF-8 (§4.4.0.4); when unset, UTF-8 is tried first, then latin1 with a hex fallback.\nFor concatenated files (image/junk bytes + ZIP): the EOCD offset is ZIP-relative; the real position is derived from 'EOCD minus cdSize bytes' with a correction warning — consistent with mainstream unarchivers.",
    usage: "Drop in a ZIP file (or paste base64). The report has two sections: the EOCD archive comment (with raw hex) and per-entry comments (with byte offsets in the file). With no comments at all it says so explicitly; non-ZIP / truncated EOCD / entry-count mismatch / RAR / ZIP64 are reported as errors.",
    examples: [
      { in: "A ZIP with an archive comment (example, 125 bytes)", param: "Input ZIP bytes; extract the EOCD archive comment and entry comments", out: "see the EOCD", desc: "Comments follow ZIP APPNOTE 6.3.x encoding: the EOCD flag decides CP437 or UTF-8; this example uses ASCII-compatible bytes", run: { dir: "run", inputHex: "504b0304140000000000c141715d86a61036050000000500000005000000612e74787468656c6c6f504b01021400140000000000c141715d86a610360500000005000000050000000000000000000000800100000000612e747874504b0506000000000100010033000000280000000c007365652074686520454f4344", match: "contains" } },
    ],
    tips: [
      "`unzip -z` only prints the archive comment; to see entry comments check the central directory or a dedicated tool.",
      "A JPEG header + ZIP tail is a common stego layout; this tool corrects the EOCD-relative offset automatically.",
      "When bit11 (EFS) is unset, non-ASCII comment bytes are CP437, not UTF-8 — a classic mojibake trap.",
    ],
    aka: ["zip comment", "zip comment extract", "archive comment", "eocd comment", "zip 注释", "zip notes", "zip metadata", "central directory comment"],
  },
};
