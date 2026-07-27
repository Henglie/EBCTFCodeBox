/*
 * i18n/desc_supplement_en.js — High-frequency op description English supplement.
 *
 * Supplements op.{opId}.desc only; does not modify en.js main table. Keys are isomorphic with desc_supplement_zh.js.
 * Content derived from op name/desc in registry, accurately describing functionality.
 * Coverage: base family + classic core + modern core + hash core + stego core + fancy core.
 */
export default {
 // ---- base family ----
  "op.base16.desc": "Hexadecimal encoding, each byte as two hex chars, supports custom alphabet, uppercase, and space separator.",
  "op.base32.desc": "RFC 4648 Base32 encoding, 5-bit grouping, supports custom alphabet.",
  "op.base36.desc": "Treats whole bytes as a big integer, converts to base-36 string using 0-9a-z.",
  "op.base45.desc": "RFC 9285 Base45 encoding, 2 bytes to 3 chars, common in QR codes.",
  "op.base58.desc": "Base58 encoding (Bitcoin alphabet), omits ambiguous chars, supports custom alphabet.",
  "op.base62.desc": "Base62 encoding using 0-9A-Za-z charset, supports custom alphabet.",
  "op.base64.desc": "Standard Base64 encoding, supports URL-safe variant and custom alphabet.",
  "op.base85.desc": "Adobe Ascii85 encoding, wrapped in <~ ~>, z compresses zero groups.",
  "op.base91.desc": "basE91 encoding, maps byte stream to 91-char set, more efficient than Base64.",
  "op.base92.desc": "Base92 encoding, 13-bit blocks to char pairs, supports custom alphabet.",
  "op.base100.desc": "Base100 emoji encoding, each byte maps to one emoji (starting at U+1F3F7).",
  "op.radixN.desc": "Converts text to/from N-radix big integer (N = 2..95), custom alphabet supported.",
  "op.baseCustom.desc": "Custom-alphabet Base encoding, radix equals alphabet length.",

 // ---- classic ciphers ----
  "op.vigenere.desc": "Vigenere cipher: cyclic shift by letter key, key keeps letters only.",
  "op.gronsfeld.desc": "Gronsfeld cipher: Vigenere variant using a numeric string as key.",
  "op.beaufort.desc": "Beaufort cipher: self-reciprocal Vigenere variant, same function for enc/dec.",
  "op.autokey.desc": "AutoKey cipher: key stream extends from keyword with plaintext itself.",
  "op.porta.desc": "Porta cipher: self-reciprocal substitution, row selected by key letter.",
  "op.playfair.desc": "Playfair cipher: 5x5 keyed square, digraph row/column transform, J merged into I.",
  "op.nihilist.desc": "Nihilist cipher: keyed Polybius square maps letters to digit pairs.",
  "op.columnar.desc": "Columnar transposition: reorders columns by key letter order, reads column-wise.",
  "op.hill.desc": "Hill cipher: encrypts with nxn matrix mod 26, key length must be a perfect square.",
  "op.affine.desc": "Affine cipher: y = a*x + b mod 26, requires a coprime to 26.",
  "op.bifid.desc": "Bifid cipher: Polybius coordinate transposition grouped by period.",
  "op.trifid.desc": "Trifid cipher: 3x3x3 cube encoding, key table must be 27 chars.",
  "op.polybius.desc": "Polybius square: 5x5 grid (J->I) maps letters to row/column coordinate pairs.",
  "op.adfgx.desc": "ADFGX cipher: Polybius substitution (5x5) then columnar transposition, WWI German.",
  "op.adfgvx.desc": "ADFGVX cipher: 6x6 extension of ADFGX, alphabet includes digits.",
  "op.foursquare.desc": "Four-square cipher: digraph substitution using two 25-letter keyed squares.",
  "op.graycode.desc": "Gray code: converts text to/from Gray-code binary string, adjacent values differ by one bit.",

 // ---- modern crypto ----
  "op.aes.desc": "AES (Advanced Encryption Standard): ECB/CBC/CFB/OFB/CTR (pure JS) and GCM (WebCrypto), key 16/24/32 bytes.",
  "op.des.desc": "DES (Data Encryption Standard, FIPS-46-3): 8-byte key, 8-byte block.",
  "op.des3.desc": "3DES (Triple DES, EDE): 16 or 24-byte key, 8-byte block.",
  "op.rc4.desc": "RC4 stream cipher, same transform for enc/dec, key of any length.",
  "op.xor.desc": "XOR with repeating key, self-inverse, one of the most common symmetric transforms in CTF.",
  "op.fernet.desc": "Fernet symmetric token: AES-128-CBC encryption + HMAC-SHA256 signature, key is base64url-encoded 32 bytes.",
  "op.rsa.desc": "RSA (educational) modular exponentiation: encrypt c=m^e mod n, decrypt m=c^d mod n, decimal big numbers in/out.",

 // ---- hash / checksum ----
  "op.md5.desc": "MD5 message digest, 128-bit hash (RFC 1321, pure JS).",
  "op.md4.desc": "MD4 message digest, 128-bit hash (RFC 1320), basis of NTLM hash.",
  "op.sha1.desc": "SHA-1 message digest, 160-bit hash (WebCrypto).",
  "op.sha256.desc": "SHA-256 message digest, 256-bit hash (WebCrypto).",
  "op.sha384.desc": "SHA-384 message digest, 384-bit hash (WebCrypto).",
  "op.sha512.desc": "SHA-512 message digest, 512-bit hash (WebCrypto).",
  "op.hmac.desc": "HMAC message authentication code, requires key and hash algorithm choice (SHA-1/256/384/512, WebCrypto).",
  "op.crc32.desc": "CRC32 checksum, IEEE 802.3 polynomial, table-driven implementation.",
  "op.crc16.desc": "CRC16 checksum, CCITT-FALSE standard, polynomial 0x1021.",
  "op.ntlm.desc": "NTLM hash, MD4 of UTF-16LE encoded password, Windows password storage format.",
  "op.sha3.desc": "SHA-3 hash (FIPS 202), selectable width 224/256/384/512, pure JS Keccak.",
  "op.keccak256.desc": "Keccak-256 hash, used in Ethereum, padding 0x01 (differs from SHA3-256's 0x06).",
  "op.shake128.desc": "SHAKE128 extendable-output hash (FIPS 202), output length set by parameter.",
  "op.shake256.desc": "SHAKE256 extendable-output hash (FIPS 202), output length set by parameter.",

 // ---- stego ----
  "op.zeroWidth.desc": "Zero-width character steganography: encodes hidden text as zero-width chars (default U+200C/200D/202C/FEFF), embedded in cover text.",
  "op.zeroChar.desc": "Zero-width Morse: plaintext to Morse, then U+200B/200C/200D replace separator/dot/dash, CJK via \\uXXXX escape.",
  "op.zwTags.desc": "Unicode Tag smuggling: encodes bytes into U+E0000 plane Tag chars, common carrier for LLM prompt injection.",
  "op.zwVarSel.desc": "Variation selector steganography: appends arbitrary byte stream via U+FE00-FE0F and U+E0100-E01EF.",
  "op.emojiSubst.desc": "Emoji substitution steganography: base64 alphabet mapped to 65 emojis, supports rotation (no AES).",
  "op.tadpole.desc": "Tadpole script encryption: encodes with U+06D6-U+06EC decoration chars, includes checksum, supports tadpole and Base64 dual format.",
  "op.lsbImage.desc": "LSB pixel steganography: writes data into image pixel least significant bits, first 32 bits store length, supports R/G/B/A channel selection.",

 // ---- fancy / CTF encoding ----
  "op.morse.desc": "Morse code (ITU-R M.1677): letters/digits/punctuation mapped to dots and dashes, / separates words.",
  "op.bacon.desc": "Bacon cipher: each letter as 5-bit a/b string, supports 24-letter (I=J, U=V) and 26-letter versions.",
  "op.railFence.desc": "Rail Fence cipher: W-zigzag written across rails then read row by row, parameter is rail count.",
  "op.caesar.desc": "Caesar cipher: shifts letters by given amount, encrypt +shift, decrypt -shift.",
  "op.rot13.desc": "ROT13: shifts letters by 13, self-reciprocal (applying twice restores original).",
  "op.rot5.desc": "ROT5: shifts digits by 5, self-reciprocal.",
  "op.rot18.desc": "ROT18: combination of ROT13 and ROT5, handles both letters and digits, self-reciprocal.",
  "op.rot47.desc": "ROT47: shifts ASCII 33-126 range by 47, self-reciprocal.",
  "op.atbash.desc": "Atbash cipher: reversed alphabet mapping (A<->Z), self-reciprocal.",
  "op.a1z26.desc": "A1Z26 encoding: one-to-one mapping between letters and numbers 1-26.",
  "op.dna.desc": "DNA encoding: 3-letter codons (A/C/G/T) mapped to/from characters.",
  "op.keyboard.desc": "Keyboard coordinate encoding: letters as QWERTY row/column positions (e.g., Q=11).",
  "op.brainfuck.desc": "BrainFuck language: 8-instruction minimalist programming language, supports execution and code generation, 5 million step limit.",
};
