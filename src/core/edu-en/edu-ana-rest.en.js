// English edu shard: analysis fallbacks (pwn offset / big integers / letter case / compressed-stream decompress & identify). Pure data, no imports, no side effects.
export default {
  debruijn: {
    what: "De Bruijn sequence: a character sequence in which every substring of a given length n appears exactly once. In pwn it's used to locate, in one shot, which bytes of the return address a stack overflow overwrote.",
    principle:
      "In a De Bruijn sequence of order n, every substring of length n is unique. Feed it as the overflow input; after the program crashes, the bytes in EIP/RIP correspond to a unique position in the sequence → reverse-lookup gives you the exact offset of 'how many bytes before the return address is overwritten'.",
    usage: "First generate a De Bruijn sequence as the overflow input; after the crash, feed back the overwritten address/bytes to look up the offset.",
    examples: [
      { in: "generate a sequence of order 4", out: "aaaabaaacaaad...", desc: "every 4-byte substring is unique" },
      { in: "EIP=0x61616168 at crash", param: "look up offset", out: "offset = some fixed value" },
    ],
    tips: ["Equivalent to pwntools' cyclic/cyclic_find. Take the crash register value (little-endian needs converting back to characters first) to look up the offset, locating it in one shot."],
    aka: ["de bruijn", "德布鲁因序列", "cyclic", "溢出偏移", "pattern", "de bruijn sequence", "德布鲁因", "cyclic pattern", "pwntools cyclic", "cyclic_find", "偏移定位", "溢出偏移计算", "栈溢出偏移"],
  },

  textIntConverter: {
    what: "Text ↔ big integer conversion: concatenate a byte string into one big integer in base 256, or restore a big integer back to bytes. In RSA challenges the plaintext is often given as a big integer.",
    principle:
      "RSA encrypts and decrypts numbers, not text. By convention a byte string is treated as a base-256 big integer: `m = Σ byte_i · 256^(len−1−i)` (equivalent to bytes-to-long). The reverse is long-to-bytes, splitting the big integer back into bytes 8 bits at a time.",
    usage: "The text direction converts a string into a big integer (to feed into RSA modular exponentiation); the integer direction restores a decrypted m back into plaintext.",
    examples: [
      { in: '"AB"', out: "16706", desc: "0x4142 = 16706" },
      { in: "16706", param: "restore", out: "AB" },
    ],
    formulas: [
      { tex: "m = \\sum_{i=0}^{L-1} b_i \\cdot 256^{\\,L-1-i}", caption: "byte string concatenated big-endian into a big integer (bytes_to_long)" },
    ],
    tips: ["Equivalent to pycryptodome's bytes_to_long / long_to_bytes. The m you solve from RSA is a big number; convert it back to text to see the flag."],
    aka: ["文本转大整数", "bytes to long", "long to bytes", "大整数互转", "bytes_to_long", "long_to_bytes", "字节转整数", "整数转字节", "文本大数转换", "256进制大数", "big integer convert", "RSA明文转换"],
  },

  getAllCasings: {
    what: "All-casings permutation: try upper and lower case for every letter of a word, generating all combinations. Used to brute-force case-insensitive passwords/flags.",
    principle:
      "n letters give 2^n case combinations. For each letter position take upper or lower case, enumerating the full Cartesian product. With many letters the combinations explode, so the tool limits input to ≤20 letters to avoid stalling.",
    usage: "Enter a word; outputs the list of all its case combinations.",
    examples: [
      { in: "abc", out: "abc, abC, aBc, aBC, Abc, AbC, ABc, ABC", desc: "3 letters → 2³=8 combinations" },
    ],
    tips: ["More than 20 letters is blocked (millions of combinations). Use it for 'flag with uncertain casing' or password-dictionary derivation."],
    aka: ["大小写全排列", "all casings", "大小写组合", "casing 爆破", "大小写枚举", "大小写笛卡尔积", "case permutation", "letter case brute", "大小写爆破", "2^n组合", "case variations", "大小写字典生成"],
  },

  alternatingCaps: {
    what: "Alternating caps: convert text into the alternating-case sPoNgEbOb style. Appears in meme text and simple obfuscation.",
    principle:
      "Decide upper or lower case for each letter by the parity of its position, producing zigzag-cased text. It's a purely typographic transform that doesn't change the letters themselves; restoring just needs uniform casing.",
    usage: "Enter text; outputs the alternating-case form.",
    examples: [
      { in: "hello world", out: "hElLo WoRlD" },
    ],
    tips: ["Commonly called SpongeBob/mocking case. When you see text with erratically jumping case, just read the content ignoring case."],
    aka: ["交替大小写", "alternating caps", "spongebob case", "mocking case", "海绵宝宝大小写", "嘲讽大小写", "锯齿大小写", "sPoNgEbOb", "mocking spongebob", "alternating case", "一大一小", "交替大小写文本"],
  },

  gzipCodec: {
    what: "Gzip decompress/compress: handles gzip streams like `.gz` files. In CTF, when binwalk carves out data starting with 1F 8B, use this to unpack it.",
    principle:
      "gzip = DEFLATE compressed data + a 10-byte header (magic `1F 8B`, method, timestamp, etc.) + a trailer with CRC32 and the original length. The tool processes both directions with the browser-native DecompressionStream; input as hex/base64/UTF-8 is auto-detected.",
    usage: "Paste gzip data (hex/base64/raw) to decompress to the original; the reverse compresses.",
    examples: [
      { in: "1f 8b 08 00 ...", out: "the decompressed original", desc: "1F 8B is the gzip magic" },
    ],
    tips: ["Magic `1F 8B` = gzip. Common in archive/traffic challenges; the decompressed result may be yet another layer of encoding — peel layer by layer."],
    aka: ["gzip", "gzip解压", "gz", "gzip codec", "gzip压缩", "gunzip", ".gz解压", "gzip解码", "1f8b", "gzip流", "GNU zip", "gzip decompress"],
  },

  zlibCodec: {
    what: "Zlib decompress/compress: handles the zlib format stream (2 more header bytes than raw deflate + an adler32 trailer checksum). PNG's IDAT and many protocols' embedded compression use it.",
    principle:
      "zlib = a 2-byte header (first byte commonly `78`, e.g. 78 9C/78 DA) + DEFLATE data + a 4-byte Adler-32 checksum trailer. The tool processes both directions using the browser natively.",
    usage: "Paste zlib data to decompress to the original; the reverse compresses.",
    examples: [
      { in: "78 9c ...", out: "the decompressed original", desc: "78 9C is the zlib default compression header" },
    ],
    tips: ["Starting `78 9C`/`78 DA`/`78 01` = zlib. A PNG's IDAT chunk content is a zlib stream, and so are Git objects."],
    aka: ["zlib", "zlib解压", "zlib codec", "deflate+adler", "zlib压缩", "zlib解码", "78 9c", "78da", "adler32", "zlib流", "zlib decompress", "IDAT解压"],
  },

  deflateRawCodec: {
    what: "Raw Deflate decompress/compress: handles bare DEFLATE data with no zlib/gzip header. Files inside a ZIP and some custom wrappers use the bare stream.",
    principle:
      "The DEFLATE body = LZ77 sliding-window matching + Huffman coding. Raw deflate is just the pure compressed data, without zlib's 2-byte header or gzip's 10-byte header and checksum trailer. The tool processes both directions using the browser.",
    usage: "Paste bare deflate data to decompress to the original; the reverse compresses.",
    examples: [
      { in: "raw deflate bytes", out: "the decompressed original" },
    ],
    tips: ["No 1F8B (gzip) and no 78 (zlib) header, but you suspect it's compressed → try raw deflate. It's what the compressed data stored inside a ZIP is."],
    aka: ["raw deflate", "裸deflate", "deflate", "deflate raw", "裸压缩流", "无头deflate", "DEFLATE解压", "LZ77+Huffman", "inflate", "raw inflate", "deflate解码", "裸压缩数据"],
  },

  archiveIdentify: {
    what: "Archive/compressed-stream identification: take a chunk of binary and identify by its opening magic whether it's gzip, zip, rar, 7z, bzip2, or tar — knowing the type is what tells you which tool to use to unpack it.",
    principle:
      "Each archive format has a fixed signature at the start: gzip `1F 8B`, zip `50 4B 03 04` (PK), rar `52 61 72 21` (Rar!), 7z `37 7A BC AF 27 1C`, bzip2 `42 5A 68` (BZh), zlib `78`, tar has `ustar` at offset 257. The tool compares these magics and parses the gzip/bzip2 header.",
    usage: "Paste data; the tool reports the format type and header info.",
    examples: [
      { in: "50 4b 03 04 ...", out: "ZIP archive (PK)" },
      { in: "42 5a 68 39 ...", out: "bzip2 (BZh9)" },
    ],
    tips: ["Can't identify a file type? Check the magic first: PK=zip, Rar!=rar, 7z=7-Zip, BZh=bzip2. tar's ustar is at byte 257, not at the start."],
    aka: ["归档识别", "archive identify", "magic识别", "文件类型识别"],
  },

  zipList: {
    what: "ZIP structure parsing: without decompressing, read only the ZIP's internal structure to list which files are inside, what compression method is used, and whether they're encrypted.",
    principle:
      "A ZIP consists of several 'local file header (PK\\x03\\x04) + data' segments plus a 'central directory (PK\\x01\\x02)' at the end. The central directory records each file's name, compression method, size, and flags. The tool parses both to list the files; the encryption flag is read from general-purpose bit-flag bit0.",
    usage: "Paste ZIP data; outputs the contained file names, compression methods, and encryption flags (reads the structure only, does not decrypt encrypted entries).",
    examples: [
      { in: "ZIP file bytes", out: "flag.txt (deflate, encrypted), readme.md (stored)" },
    ],
    tips: ["Pseudo-encryption challenge: the encryption flag bits in the central directory and the local header disagree; clearing the encryption bit lets it extract normally. See clearly which entries are truly encrypted."],
    aka: ["zip解析", "zip list", "zip结构", "zip文件列表"],
  },

  tarList: {
    what: "TAR header parsing: read the 512-byte block headers of a tar archive to list the file names, sizes, and types inside. tar doesn't compress, it's pure packaging.",
    principle:
      "tar aligns each file into 512-byte blocks: first a header block (with file name, octal size/permissions, type flag, `ustar` magic at offset 257), followed by content blocks. The tool reads each header block by block to list the files.",
    usage: "Paste tar data; outputs the file name / size / type list.",
    examples: [
      { in: "tar bytes", out: "./secret.txt (1024 B, regular file)" },
    ],
    tips: ["tar is often wrapped with gzip into .tar.gz: gzipCodec first to decompress, then tarList to see the contents. The ustar magic is at byte 257."],
    aka: ["tar解析", "tar list", "tar头", "ustar"],
  },

  b64CompressedProbe: {
    what: "Base64-embedded compressed-stream probe: scan the text for base64 segments, then auto-decode → identify magic → try gzip/zlib/deflate decompression, an end-to-end pipeline to dig out compressed data hidden inside base64.",
    principle:
      "Many challenges paste 'compressed data' with another base64 layer into the text. The tool first regex-finds base64 fragments, decodes them into bytes, uses the magic to judge whether it's a compressed stream, and if so tries gzip/zlib/raw deflate in turn until readable content emerges.",
    usage: "Paste text containing base64; the tool auto-decodes + identifies + tries to decompress, outputting the restored result.",
    examples: [
      { in: "data = 'H4sIA...' (base64)", out: "decoded to gzip → decompress to the original", desc: "H4sIA is the base64 signature of a gzip header" },
    ],
    tips: ["Remember the signatures: base64 starting with `H4sI` → the underlying data is gzip; starting with `eJ`/`eNq` → often zlib. When you see these prefixes, treat it directly as a compressed stream."],
    aka: ["base64压缩探测", "b64 compressed probe", "内嵌压缩", "base64解压", "base64内嵌压缩", "H4sI探测", "base64 gzip", "base64 zlib", "压缩流探测", "b64解码解压", "base64嵌套压缩", "自动解压探测"],
  },
};
