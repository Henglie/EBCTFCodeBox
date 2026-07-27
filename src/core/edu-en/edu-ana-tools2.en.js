// English edu shard: analysis brute-force/recovery tools — xorBrute/caesarBrute/freqAnalysis/hashTypeIdentify/hashDictCrack/pngSizeRecover/trailerCarve
export default {
  xorBrute: {
    what: "XOR the input byte by byte against all 256 keys 0–255, and list all possible results at once — the most common brute-force technique for single-byte XOR ciphers.",
    principle: "XOR encryption XORs each plaintext byte with the same byte `k`: `c = m XOR k`. Because XOR is self-inverse (`m = c XOR k`), brute-forcing only needs to iterate `k=0..255`, XORing the ciphertext byte by byte with `k` to see which yields readable text. Enabling the 'printable only' filter keeps only results where 80%+ of characters are printable, greatly reducing manual sifting.",
    usage: "Paste the ciphertext (or the text of raw bytes after hex-decoding) into the input box. Check 'show printable results only' to filter out garbage. Outputs one key per line: `0xNN (N): decrypted text`.",
    examples: [
      { in: "\\x01\\x02\\x03 (3 non-printable bytes)", out: "256 lines of results; key 0x01 gives \\x00\\x03\\x02 (still non-printable), key 0x42 gives C@A (printable)", desc: "0x01^0x42=0x43('C'), 0x02^0x42=0x40('@'), 0x03^0x42=0x41('A')" },
    ],
    tips: [
      "In CTF the XOR key is usually a single visible character (e.g. 0x20~0x7e); turn on the filter first and eyeball-scan is fastest.",
      "If the ciphertext is a hex string, first hex-decode it to raw bytes before feeding it in, otherwise you're XORing the hex characters themselves rather than the data bytes.",
      "The result for key=0x00 is the original text itself — if it ranks first and looks like plaintext, the ciphertext may not be encrypted at all.",
    ],
    aka: ["XOR爆破", "异或爆破", "single-byte XOR brute force", "XOR single key", "单字节异或爆破", "xor brute", "异或密钥爆破", "256密钥爆破", "xor crack", "单字节xor", "xor暴力破解", "异或穷举"],
  },

  caesarBrute: {
    what: "Automatically crack the shift amount of a Caesar cipher: decrypt for all shifts 0–25 and score each; the one with the highest quadgram score is the answer.",
    principle: "The Caesar cipher shifts each letter by a fixed value `k`. Brute-forcing iterates `k=0..25`, recovering the plaintext for each shift, then uses <b>quadgram scoring</b> to measure 'how English-like' it is — English has high frequencies of four-letter combinations like THE/AND/ING, so a higher score means more like plaintext. It also outputs the <b>chi-square value</b> (lower means closer to English letter-frequency distribution) for cross-validation. Bonus ROT47 (ASCII 33~126 shifted by 47, self-inverse, covering symbols and digits).",
    formulas: [
      { tex: "D_i(c) = (c - i) \\bmod 26", caption: "decryption for shift i: ciphertext letter c minus i mod 26" },
    ],
    usage: "Enter the Caesar ciphertext (pure letters or with punctuation, either works), no parameters needed. Outputs the best shift + a ranking table of all 26 shifts + full decryption + ROT47 result.",
    examples: [
      { in: "KHOOR ZRUOG", out: "best shift: 3 → HELLO WORLD", desc: "shift 3 is the classic Caesar, K→H, H→E, O→L...; highest quadgram score" },
    ],
    tips: [
      "Shift 13 = ROT13 (self-inverse, decrypt again to restore).",
      "If the best shift is 0, the input may already be plaintext, or it isn't Caesar-encrypted.",
      "ROT47 handles letters + digits + symbols at once, suitable for mixed content.",
    ],
    aka: ["凯撒爆破", "ROT自动求位移", "Caesar cipher brute force", "shift cipher solver", "凯撒自动破解", "caesar brute", "rot爆破", "移位密码爆破", "凯撒位移求解", "自动凯撒", "rot13爆破", "位移穷举", "凯撒解密器"],
  },

  freqAnalysis: {
    what: "Tally the ciphertext's monogram/bigram/trigram frequency distribution, with an ASCII bar chart — an entry-level tool for cracking substitution ciphers.",
    principle: "English has a stable letter-frequency signature: E is highest (~12.7%), followed by T/A/O/I/N, with Z/Q/X lowest. A monoalphabetic substitution cipher only swaps letters, not frequencies, so the most frequent ciphertext letter most likely maps to plaintext E. Bigrams (TH/HE/IN) and trigrams (THE/AND/ING) are even more distinctive. The tool tallies by sliding-window n-gram, sorts descending and draws a bar chart, and also outputs JSON-format data for front-end plotting.",
    usage: "Enter the ciphertext text, choose the mode (all/mono/bi/tri), set the top-N per category. Outputs n-gram, count, ratio, and bar chart.",
    examples: [
      { in: "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG", param: "mode=mono, top=5", out: "O:4 times(11.43%) / E:3 times(8.57%) / T:2 times(5.71%) / H:2 times(5.71%) / U:2 times(5.71%)", desc: "frequency distribution of a pangram; O appears most because it occurs 4 times" },
    ],
    tips: [
      "The longer the ciphertext, the more accurate the frequencies; samples under 100 letters have large error.",
      "The most frequent letter isn't necessarily E — check bigrams first (TH is usually highest) for cross-validation.",
      "If the frequency distribution is very flat (close to 1/26), it may be a polyalphabetic substitution (like Vigenère), not monoalphabetic.",
    ],
    aka: ["频率分析", "n-gram统计", "frequency analysis", "letter frequency", "字母频率", "词频分析", "字频统计", "频率统计", "单表替换分析", "ngram", "字母频率分析", "频度分析", "双字母统计"],
  },

  hashTypeIdentify: {
    what: "Based on a hash value's length, character set, and prefix, identify which algorithm produced it — the first step when you get a hash string and don't know what tool to crack it with.",
    principle: "Different hash algorithms have fixed output lengths: MD5=32 hex (128-bit), SHA-1=40 hex (160-bit), SHA-256=64 hex (256-bit), SHA-512=128 hex. Prefixed formats are also recognizable: `$2b$`=bcrypt, `*`=MySQL5 (SHA1(SHA1(pass))), `$1$`=MD5 crypt, `$6$`=SHA-512 crypt, `{SSHA}`=LDAP. It can also recognize Base64-encoded hashes (judged by byte length after decoding).",
    usage: "Paste the hash string into the input box, no parameters needed. Outputs the length, a list of possible algorithms, and disambiguation suggestions.",
    examples: [
      { in: "d41d8cd98f00b204e9800998ecf8427e", out: "32 hex = 128-bit → MD5 / NTLM / MD4 / LM etc. (★length alone can't distinguish MD5 from NTLM at 32 hex, need context)", desc: "this is the MD5 of the empty string" },
      { in: "*A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2", out: "MySQL5 / MySQL 4.1 password hash (* + 40 hex = SHA1(SHA1(pass)))", desc: "41 chars total, leading *, the following 40 hex are double SHA-1" },
    ],
    tips: [
      "32-hex in a Windows forensics scenario should first suspect NTLM (MD4 of UTF-16LE); in a web scenario, first suspect MD5.",
      "For 64-hex don't forget SM3 (Chinese national standard), common in domestic CTFs.",
      "bcrypt ($2b$) and Argon2 are slow hashes; dictionary brute doesn't apply, they need hashcat's dedicated modes.",
    ],
    aka: ["哈希识别", "hash type detect", "hash identifier", "哈希算法识别", "哈希类型猜测", "hash identify", "analyse hash", "hashid", "哈希类型识别", "hash类型判断", "识别哈希算法", "哈希指纹"],
  },

  hashDictCrack: {
    what: "Brute-force MD5/SHA-1/SHA-256/NTLM hashes with a dictionary — take a weak-password dictionary, pure digits, or date combinations, compute the hash for each one and compare; a hit gives the plaintext.",
    principle: "The core of dictionary brute force: pregenerate a candidate plaintext list (top 300 weak passwords / digits 0~10^N / dates 1970-2030), compute the specified algorithm's hash for each candidate, and compare with the target. MD5/NTLM take a pure-JS synchronous fast path; SHA-1/SHA-256 take the WebCrypto async path. auto mode guesses the algorithm by length (32-bit→MD5, 40-bit→SHA-1, 64-bit→SHA-256). SHA-family auto-aborts past 2 million attempts to prevent blowup.",
    usage: "Enter the target hash, choose the algorithm (auto guesses by length), dictionary source (top weak passwords/pure numeric/dates/all), and max digit count. Outputs hit status + plaintext + attempt count.",
    examples: [
      { in: "e10adc3949ba59abbe56e057f20f883e", param: "algo=auto, dict=numeric, maxDigits=6", out: "hit ✓ algorithm: md5 plaintext: 123456 attempts: 123457", desc: "this is the MD5 of 123456; the pure-numeric dictionary hits on the 123457th (including 0)" },
    ],
    tips: [
      "In auto mode, 32-bit tries MD5 first — if it's actually NTLM you must specify manually.",
      "More numeric digits = slower: 6 digits = 1 million attempts (seconds), 8 digits = 100 million attempts, needs workerPool parallelism.",
      "The top weak-password dictionary is about 300 entries, covering common weak passwords like password/123456/admin, enough for CTF.",
    ],
    aka: ["哈希爆破", "hash crack", "dictionary attack", "hash dictionary", "字典爆破", "哈希字典爆破", "md5解密", "哈希破解", "hash dict crack", "弱口令爆破", "hash brute", "撞库解哈希"],
  },

  pngSizeRecover: {
    what: "Detect whether a PNG's width/height has been tampered with, and brute-force to recover the true dimensions — the classic challenge type of altering PNG height to hide a flag.",
    principle: "A PNG's IHDR chunk stores width and height (4 bytes big-endian each), followed by a CRC32 checksum. When the width/height is tampered but the CRC isn't, the stored CRC ≠ computed CRC, and the tool detects tampering accordingly. Recovery strategy: keep the 5-byte attributes unchanged, brute the width/height combinations (1~8192), and the one whose CRC matches is the true size. First brute height only (90% of CTF scenarios, O(N), comes out in seconds), then width, and finally double-brute as a fallback. CRC32 uses the IEEE 802.3 polynomial `0xEDB88320`.",
    formulas: [
      { tex: "\\text{CRC32} = \\text{CRC}(\\texttt{IHDR\\text{-}type} \\| \\text{width} \\| \\text{height} \\| \\text{5B\\ attrs})", caption: "the IHDR CRC covers chunk type + 13 bytes of data" },
    ],
    usage: "Paste the PNG file's base64 into the input box. Outputs the current width/height, CRC validation result, the brute-recovered true dimensions, and the repaired base64.",
    examples: [
      { in: "base64 of a normal 1×1 PNG", out: "current dimensions: 1 × 1 / IHDR CRC32: stored=907753de computed=907753de (validation passed, not tampered)", desc: "a normal image's CRC matches, no brute needed" },
      { in: "the same PNG with height tampered to 2 (CRC unchanged)", out: "stored=907753de computed=16e32170 (mismatch) → brute recovery [height-only]: true dimensions = 1 × 1", desc: "height changed 1→2 but the CRC is still the original; brute restores the true height of 1" },
    ],
    tips: [
      "The input must be base64 — you can first use file reading or hex→base64 conversion.",
      "The brute upper limit is 8192; extra-wide images may exceed the range.",
      "If the CRC was also tampered in sync (an expert-level challenge), CRC detection is useless, and you must rely on eyeballing anomalies in the image content.",
    ],
    aka: ["PNG宽高修复", "PNG CRC爆破", "PNG height recover", "IHDR CRC brute force", "png高度恢复", "png尺寸恢复", "ihdr修复", "png宽高爆破", "png crc修复", "png height fix", "图片高度还原", "png真实尺寸"],
  },

  trailerCarve: {
    what: "Identify the end position of a file's main body (PNG IEND / JPEG FFD9 / GIF 3B / ZIP EOCD etc.) and strip out the hidden data appended to the trailer — the classic challenge type of concatenating a flag after an image in CTF.",
    principle: "Each file format has a fixed end marker: PNG's IEND chunk (`00 00 00 00 49 45 4E 44 AE 42 60 82`), JPEG's EOI (`FF D9`), GIF's trailer (`3B`), ZIP's EOCD, and BMP/RIFF/PDF etc. The tool first identifies the carrier type, locates the main-body end offset, then slices out the following bytes and tries to identify the appended data's magic. It also supports binwalk mode: full-text scanning for embedded file magics.",
    usage: "Paste the file's base64 into the input box. Choose the mode (trailer strip / full-text magic scan) and the appended-data output format (preview/hex/ascii/base64). Outputs the main-body type, end offset, appended-data content, and magic identification.",
    examples: [
      { in: "base64 of PNG + IEND + \"APPEND_HIDDEN_DATA\"", param: "mode=trailer, format=ascii", out: "file size: 63 bytes / main body: PNG / main-body end offset: 45(0x2d) / appended data: 18 bytes / ascii: APPEND_HIDDEN_DATA", desc: "the 18 bytes appended after IEND are stripped out intact" },
    ],
    tips: [
      "When the appended data's start doesn't match a known magic, it may be plaintext flag or encrypted data — slice it out and look at the hex/ascii.",
      "binwalk mode suits a file with multiple nested files (e.g. a ZIP embedded in a PNG).",
      "Some challenges hide the flag inside the file's main body (e.g. a PNG's zTXt chunk), not appended to the trailer — you'll need other tools.",
    ],
    aka: ["文件附加数据剥离", "trailer carve", "文件分离", "binwalk scan", "文件雕刻", "文件尾部数据", "附加数据提取", "file carving", "内嵌文件提取", "foremost", "尾部数据剥离", "文件魔数扫描"],
  },
};
