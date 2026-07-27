/*
 * edu-unified-misc.en.js — English edu shard: unified/misc gap-filling.
 *
 * Covers 5 ops:
 * analysis: archiveUnified, cryptoAddrUnified, imageStructUnified
 * cn: numToPinyin, hanziToPinyin
 *
 * Pure data, no side effects, no import, no register.
 */
export default {
 // ============ analysis: unified entry ============
  archiveUnified: {
    what: "Compression/archive unified analysis — drop in a blob of binary, and it automatically recognizes whether it's gzip/zip/7z/tar or something else, lists the structure, and decompresses what it can.",
    principle:
      "Dispatches by file-header magic bytes: `1f 8b` is gzip, `78 9c/78 da` is zlib, `42 5a 68` is bzip2, `50 4b 03 04` is ZIP, `52 61 72 21` is RAR, `37 7a bc af 27 1c` is 7z, and tar is recognized by `ustar` at offset 257.\n\n" +
      "Once the format is recognized, it handles it in four tiers: gzip/zlib/deflate use pure-JS streaming decompression for a preview; ZIP parses the central directory + pseudo-encryption detection (the classic trap where the compression-method bit is flipped back to 0); 7z uses wasm for listing/decompression (lazy-loaded from local public/wasm/, gracefully degrading if missing); bzip2/rar are recognition-only hints (pure JS can't decompress them). Input supports auto-detection of hex/base64/UTF-8.",
    usage: "Paste the compressed file's hex or base64 into the input box (or drop a file), click run to output format recognition + structure listing + decompression preview. For encrypted 7z archives, fill the password in the '7z password' parameter box, and choose 'list' or 'decompress' for the 7z operation.",
    examples: [
      { in: "(gzip file's base64, e.g. H4sIAAAAAAAAA0...)", out: "Format: gzip (magic 1f 8b)\nRaw data: Hello World", desc: "gzip auto-recognition + decompression preview" },
      { in: "(ZIP file's base64, with pseudo-encryption)", out: "Format: ZIP\nPseudo-encryption detection: yes (compression-method bit altered)\nFile listing: flag.txt", desc: "ZIP pseudo-encryption auto-detection" },
    ],
    tips: [
      "The first step in a CTF misc workflow: throw a binary blob in to recognize the format, faster than reading magic bytes by eye.",
      "ZIP pseudo-encryption is a classic trap — the compression-method bit in the central directory is changed to 9 (encrypted) but the data isn't actually encrypted; this tool detects and flags it automatically.",
      "7z decompression uses wasm and is a bit slow on first load; when wasm is unavailable it degrades to listing structure only, without erroring.",
      "bzip2/rar can only be recognized, not decompressed (no pure-JS implementation); use an external tool instead.",
    ],
    aka: ["压缩归档分析", "archive unified", "归档归一", "magic识别", "压缩文件分析", "归档格式识别", "archive analysis", "压缩包分析", "文件头识别", "gzip zip 7z识别", "压缩流分析", "归档统一分析"],
  },

  cryptoAddrUnified: {
    what: "Cryptocurrency address parsing — drop in a BTC or ETH address, and it automatically recognizes its type, whether the checksum is valid, and which network.",
    principle:
      "BTC addresses fall into three categories by prefix: `1` is P2PKH (Legacy, Base58Check), `3` is P2SH (Legacy, Base58Check), `bc1q` is P2WPKH/P2WSH (SegWit, Bech32), `bc1p` is P2TR (Taproot, Bech32m).\n\n" +
      "ETH addresses are 0x + 40 hex digits, checked via EIP-55 mixed case — hash the address once, and use hash bits to decide the case of each hex letter; change one character and the checksum fails.\n\n" +
      "Base58Check carries a 4-byte checksum tail (first 4 bytes of double SHA256); Bech32 uses a BCH-code checksum (const=1), and Bech32m is the BIP350 variant for Taproot (const=0x2bc830a3). This tool only parses checksums and never generates private keys.",
    usage: "Enter a BTC or ETH address, click run to output the address type, network (mainnet/testnet), encoding, and whether the checksum passes. No parameters needed.",
    examples: [
      { in: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa", out: "Type: BTC P2PKH (Legacy)\nNetwork: mainnet\nEncoding: Base58Check\nChecksum: pass", desc: "genesis block address, P2PKH" },
      { in: "0x52908400098527886E0F7030069857D2E4169EE7", out: "Type: ETH\nEncoding: EIP-55 mixed case\nChecksum: pass", desc: "EIP-55 valid ETH address" },
    ],
    tips: [
      "In CTF, seeing a string starting with `1` / `3` / `bc1` and about 34 chars long, throw it in first to verify whether it's a BTC address.",
      "ETH address checksums rely on case; an all-lowercase/all-uppercase ETH address can't be EIP-55 validated (but is still a valid address).",
      "Bech32 and Bech32m are easy to confuse: witver=0 uses Bech32, witver≥1 (Taproot) uses Bech32m; picking the wrong one fails the checksum.",
      "This tool only parses, never generates private keys — safe and risk-free.",
    ],
    aka: ["crypto address", "加密货币地址", "btc地址", "eth地址", "区块链地址", "比特币地址", "以太坊地址", "钱包地址", "bitcoin address", "ethereum address", "地址校验", "Base58Check Bech32"],
  },

  imageStructUnified: {
    what: "Image structure unified analysis — drag in an image, and it automatically recognizes PNG/JPG/GIF/BMP, outputting the file header, dimensions, chunk structure, EXIF, and whether data is hidden in the trailer, all at once.",
    principle:
      "Dispatches by magic bytes: `89 50 4e 47` is PNG, `ff d8 ff` is JPEG, `47 49 46 38` is GIF, `42 4d` is BMP.\n\n" +
      "PNG is parsed chunk by chunk (length+type+data+CRC), focusing on IHDR's width/height, text chunks (tEXt/iTXt), whether there's appended data after IEND, and whether IHDR's CRC was tampered with (the signal in width/height brute-force challenges). JPEG parses the SOF marker for dimensions + EXIF/XMP metadata. GIF reads the logical screen descriptor + frame list. BMP parses BITMAPFILEHEADER + BITMAPINFOHEADER. Each format's appended trailer data (after IEND/EOI/trailer) is flagged separately — that's a favorite hiding spot for steganography.",
    usage: "Paste the image's base64 (or data URI) into the input box (or drag the file directly), click run to output a unified report: format, dimensions, chunk listing, EXIF/XMP, appended trailer data, width/height anomaly repair suggestions.",
    examples: [
      { in: "(PNG file's base64)", out: "Format: PNG\nDimensions: 100×50\nChunks: IHDR / IDAT / IEND\nAppended trailer data: none\nWidth/height anomaly: no", desc: "full PNG structure report" },
      { in: "(PNG with altered width/height, IHDR CRC mismatch)", out: "Format: PNG\nDimensions: 10×10\n⚠ IHDR CRC check failed, width/height may be tampered\nRecommend brute-forcing the true dimensions", desc: "width/height tampering auto-detection" },
    ],
    tips: [
      "The first step for CTF image challenges: throw it in to recognize the format + check whether there's appended trailer data, faster than by eye.",
      "IHDR CRC mismatch = width/height was altered; use a width/height brute-force tool (pngSizeRecover) to recover the true dimensions.",
      "Appended trailer data (after IEND/EOI) is a high-frequency steganography spot; extract it directly to see whether it's a zip/flag.",
      "Merges the five ops pngChunks/imgMeta/pngSizeRecover/jpegSizeRead/gifSizeRead into one entry to see everything.",
    ],
    aka: ["图像结构分析", "image structure", "图片结构", "图像归一", "图片结构分析", "PNG结构分析", "图像取证", "image forensics", "图片元数据", "宽高爆破", "图像chunk分析", "图片隐写检测"],
  },

 // ============ cn: pinyin ============
  numToPinyin: {
    what: "Number to pinyin — reads Arabic numerals as Chinese pinyin, supporting both per-digit and numeric-value reading modes.",
    principle:
      "Per-digit (perDigit): each digit is looked up in a hard-coded table `0→líng, 1→yī, 2→èr, … 9→jiǔ`, the decimal point reads `diǎn`, and the minus sign reads `fù`. In phone/house-number scenarios, 1 can read as `yāo` (yao parameter).\n\n" +
      "Numeric value (value): first converts the integer into Chinese numeral notation (e.g. `123` → `一百二十三`), then looks up each character in the pinyin table. Supports up to the '兆' level ($10^{16}$); the algorithm is standard Chinese numeral composition: group every 4 digits, use the '千百十' places within a group, use '万亿兆' units between groups, omit the leading '一' in teens, and compress consecutive zeros.\n\n" +
      "Three tone forms: with diacritic marks (`yī`, default), numeric tone (`yi1`), and no tone (`yi`). Numeric-tone mode writes `ü` as `v` (CTF/input-method convention).",
    usage: "Choose the reading (per-digit/numeric value, default per-digit), whether 1 reads as yāo (default no), and the tone form (marks/numeric/none, default marks). Enter a number string, output pinyin.",
    examples: [
      { in: "123", param: "mode=perDigit, tone=mark", out: "yī èr sān", desc: "per-digit reading: 1 2 3" },
      { in: "123", param: "mode=value, tone=mark", out: "yī bǎi èr shí sān", desc: "numeric reading: 一百二十三" },
      { in: "119", param: "mode=perDigit, yao=true, tone=mark", out: "yāo yāo jiǔ", desc: "fire emergency number, 1 reads yāo" },
    ],
    tips: [
      "Per-digit reading suits phone/ID numbers; numeric reading suits amounts/quantities.",
      "Numeric reading only supports a single integer or decimal (e.g. 1234 / 3.14 / -8), not expressions.",
      "Numeric-tone mode's `yi1` notation matches input methods, occasionally used as an encoding in CTF.",
    ],
    aka: ["数字转拼音", "number to pinyin", "数字拼音", "拼音数字", "阿拉伯数字读法", "数字读拼音", "数字念法", "num to pinyin", "数字转中文拼音", "数字发音", "digit pinyin", "数字转读音"],
  },

  hanziToPinyin: {
    what: "Chinese character to pinyin — converts Chinese characters into pinyin, with about 300 high-frequency common characters built in; polyphonic characters take their most common reading.",
    principle:
      "Looks up the built-in `PINYIN_MAP` (about 300 characters, covering the high-frequency chars of the Table of Common Modern Chinese Characters), outputting pinyin character by character. Polyphonic characters default to their most common reading (e.g. `长→cháng`, `了→le`), with no guarantee of contextual correctness.\n\n" +
      "Out-of-table characters (obscure ones not in the 300-char table) are handled per parameter: kept as-is (`keep`, default) or marked as `?` (`mark`). Whitespace is skipped.\n\n" +
      "Three tone forms: with diacritic marks (`nǐ`, default), numeric tone (`ni3`), and no tone (`ni`). Numeric-tone mode writes `ü` as `v`.",
    usage: "Choose the tone form (marks/numeric/none, default marks) and out-of-table handling (keep as-is/mark ?, default keep). Enter a Chinese-character string, output pinyin (space-separated).",
    examples: [
      { in: "你好", param: "tone=mark", out: "nǐ hǎo", desc: "basic conversion" },
      { in: "中国", param: "tone=number", out: "zhong1 guo2", desc: "numeric tone form" },
    ],
    tips: [
      "Covers only about 300 high-frequency characters; obscure ones are kept as-is or marked ?, not an all-purpose dictionary.",
      "Polyphonic characters take their most common reading; manual correction is needed when context doesn't match.",
      "CTF occasionally uses pinyin initials or numeric tones as an encoding; this tool can quickly convert full text to pinyin.",
    ],
    aka: ["汉字转拼音", "hanzi to pinyin", "中文转拼音", "拼音转换", "汉字拼音", "中文拼音标注", "拼音注音", "chinese to pinyin", "汉字注音", "pinyin converter", "汉字读音", "中文转读音"],
  },
};
