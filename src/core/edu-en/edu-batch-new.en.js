// English edu shard: newly added ops this round (capability fill + emoji reversing).
// Covers 9 ops: txtmoji / godzillaPhpXorBase64 / behinderAesEcb / byteReverse /
//   base32steg / pbeAesBrute / bin2img / imgFft / bmpSizeRecover.
export default {
  // ============ emoji encryption ============
  txtmoji: {
    what: "The 'a string of emoji' encryption like txtmoji.com: at its core it's AES encryption with the base64 ciphertext swapped out for emoji. CTF challenges often pair it with 'the title is the password'.",
    principle:
      "Underneath is standard CryptoJS.AES (OpenSSL `Salted__` format + EVP_BytesToKey(MD5) derivation + AES-256-CBC).\n\n" +
      "The encrypted base64 ciphertext always begins with `U2FsdGVkX1` (the base64 of `Salted_`); the site strips those 10 fixed characters and replaces each remaining character with an emoji per a 65-entry emoji table. To decrypt, first map the emoji back to characters, restore the `U2FsdGVkX1` prefix, then run AES decryption.\n\n" +
      "Each encryption carries a random salt, so the same plaintext with the same password yields different ciphertext every time.",
    usage:
      "Decode direction: fill in the password (in CTF this is often the decimal value of the challenge title, e.g. 0x36d→877), paste the emoji string, and one-click recover the plaintext.\n" +
      "Encode direction: fill in password + plaintext to produce the emoji string. One-click decode can also solve it automatically when the correct password is in the password box.",
    examples: [
      { in: "😫🙄👰… (54 emoji)", param: "password 877", out: "ctfshow{emoji_is_funny}", desc: "The real ctfshow 0x36d challenge, with the title's decimal as the password" },
    ],
    tips: [
      "Seeing 'pure emoji + a hint that the title is a number' almost certainly means this — try the title's decimal as the password first.",
      "The algorithm itself accepts any passphrase; txtmoji.com's UI just limits input to decimal.",
      "It's in the same AES+emoji-substitution family as emoji-aes (Aaron Horler), but the table and prefix handling differ — don't mix them up.",
    ],
    aka: ["txtmoji", "emoji加密", "表情加密", "表情符号密码", "emoji aes", "颜文字加密"],
  },

  // ============ webshell traffic decryption preset ============
  godzillaPhpXorBase64: {
    what: "The PHP_XOR_BASE64 traffic decryption preset for the Godzilla webshell. In CTF Web/traffic forensics, once you recognize Godzilla traffic, recover it in one click.",
    principle:
      "Godzilla PHP_XOR_BASE64: `payload = base64( plaintext XOR key )`, where the XOR uses a per-byte offset `key[(i+1) & 15]` (Godzilla-specific, not the standard `i % len`).\n\n" +
      "The default key `3c6e0b8a9c15224a` = `md5(\"key\")[:16]` (derived from the connection password 'key').",
    usage: "Decode direction: paste base64 traffic + fill in the key (the site default is pre-filled) to recover the plaintext; encode direction does the reverse. The key can be changed to the md5[:16] of the challenge's actual connection password.",
    examples: [
      { in: "base64 ciphertext", param: "key=3c6e0b8a9c15224a", out: "webshell plaintext command/response" },
    ],
    tips: [
      "When you catch Godzilla traffic, try the default key first; if the connection password was changed, use md5(password)[:16].",
      "The XOR offset is (i+1)&15, not i%len — don't panic if a generic XOR won't solve it, use this preset.",
    ],
    aka: ["godzilla", "哥斯拉", "webshell", "php_xor_base64", "冰蝎哥斯拉", "流量解密"],
  },

  behinderAesEcb: {
    what: "The Behinder v3 default AES traffic decryption preset. In CTF Web/traffic forensics, once you recognize Behinder traffic, recover it in one click.",
    principle:
      "Behinder v3 defaults to `base64( AES-128-ECB(plaintext, key) )`. The default key `e45e329feb5d925b` = `md5(\"rebeyond\")[:16]` (derived from the author's default connection password 'rebeyond').",
    usage: "Decode direction: paste base64 traffic + fill in the 16-byte key (pre-filled by default), AES-ECB to recover the plaintext; encode direction does the reverse.",
    examples: [
      { in: "base64 ciphertext", param: "key=e45e329feb5d925b", out: "webshell plaintext" },
    ],
    tips: [
      "The Behinder v3 default key comes from md5('rebeyond')[:16]; for a changed password use md5(new password)[:16].",
      "From Behinder v4 onward key negotiation is more complex; this preset targets the v3 fixed-key scenario.",
    ],
    aka: ["behinder", "冰蝎", "webshell", "aes-ecb", "rebeyond", "流量解密"],
  },

  // ============ binary/byte transforms ============
  byteReverse: {
    what: "Reverse the entire byte stream end to end (File-Reverse). The classic recovery for a 'file played in reverse' in misc/forensics.",
    principle:
      "Unlike byteSwap (fixed-length 2/4/8-byte grouped endian reversal), this op flips the whole byte string end to end: the 1st byte swaps with the last, and so on. It's self-inverse — reversing again restores it.",
    usage:
      "Text mode: text → UTF-8 bytes reversed whole → Hex; Hex mode: Hex ↔ Hex reversed whole (self-inverse, most commonly used to reverse binary file byte streams).",
    examples: [
      { in: "48656c6c6f", param: "Hex mode", out: "6f6c6c6548", desc: "The bytes of \"Hello\" reversed whole" },
    ],
    tips: [
      "When a file's magic number appears at the end (e.g. ending in 474e5089 = a reversed PNG header 89504e47), the whole file was probably played backwards.",
      "Different from 'grouped endian reversal': this flips the whole string, without grouping.",
    ],
    aka: ["file reverse", "字节倒序", "整串倒序", "文件倒放", "reverse bytes"],
  },

  // ============ Base32 steganography ============
  base32steg: {
    what: "Base32 padding-bit steganography: hide secret bits in the 'redundant bits' of the last character of each Base32-encoded line. The Base32 version of Base64 steganography.",
    principle:
      "Base32 packs 5 bits per character; when the encoded data isn't a multiple of 5 bits, the last character has a few 'don't-affect-decoding' redundant low bits (reflected in the number of `=` padding). Writing secret bits into these redundant bits leaves normal Base32 decoding looking fine — only comparing the 'canonically re-encoded' last character against the actual one reveals the difference.",
    usage: "Decode direction: paste multiple lines of padded Base32 text, and it takes the redundant bits line by line to assemble the hidden info; encode direction: write the secret into a constructed Base32 cover.",
    examples: [
      { in: "multi-line Base32 (last char holds hidden bits)", out: "flag{...}", desc: "Concatenate redundant bits from each line's last char" },
    ],
    tips: [
      "When you see a bunch of Base32 lines with varying padding that decode normally into meaningless content, suspect padding-bit steganography.",
      "Same idea as base64steg, just with the grouping changed from 6 bits to 5 bits.",
    ],
    aka: ["base32 隐写", "base32 steg", "padding隐写", "base32 stego"],
  },

  // ============ passphrase brute-force ============
  pbeAesBrute: {
    what: "PBKDF2 + AES passphrase dictionary brute-force. Targets ciphertext from things like `openssl enc -aes-256-cbc -pbkdf2` that derive keys from a passphrase.",
    principle:
      "PBE (Password-Based Encryption): a passphrase is run through PBKDF2 to derive an AES key, then used for encryption. Brute-forcing tries each passphrase in a dictionary; for each one it runs PBKDF2 to derive the key → AES-decrypts → judges a hit via a crib (known-plaintext feature) or a high printable-character rate.",
    usage:
      "Enter the ciphertext (hex/base64), fill in the salt, iteration count, AES bits/mode, and crib (e.g. `flag\\{`); leave the passphrase dictionary blank to use the built-in weak-password list, or paste your own multi-line dictionary. On a hit, it reports the passphrase + plaintext.",
    examples: [
      { in: "hex ciphertext", param: "salt + iterations + crib=flag\\{", out: "passphrase=letmein → flag{...}" },
    ],
    tips: [
      "openssl defaults to 10000 PBKDF2 iterations, with the salt in the 8 bytes after the `Salted__` header in the ciphertext.",
      "The built-in dictionary only has common weak passwords; real challenges may require importing a larger dictionary.",
    ],
    aka: ["pbe爆破", "pbkdf2 brute", "aes口令爆破", "openssl enc爆破", "password brute"],
  },

  // ============ image generation/analysis ============
  bin2img: {
    what: "Render a stream of 0/1 bits into a black-and-white dot matrix image. In misc, a 'long binary string' laid out by width often spells out flag text or a QR code.",
    principle: "The 0/1 bits are wrapped to a specified width into a matrix, with 1=black and 0=white (invertible), each bit scaled to an N×N pixel block, output as PNG. When width is left blank, it auto-picks an approximate square.",
    usage: "Paste the 0/1 bit stream, set width (blank for auto), scale factor, and whether to invert, and it outputs a downloadable PNG. See whether the graphic forms text or a code.",
    examples: [
      { in: "010011010… (long 0/1 string)", param: "width=32", out: "black-and-white dot matrix PNG", desc: "Often spells out flag text / a QR code" },
    ],
    tips: [
      "The bit count is best as an integer multiple of some width; trying a few widths (like factors of the total) can align the graphic.",
      "If the result is noise, try inverting, or change the width.",
    ],
    aka: ["二进制转图片", "bit转图", "01转图片", "bits to image", "binary image"],
  },

  imgFft: {
    what: "Do a 2D Fourier transform of an image to view the magnitude spectrum. A CTF frequency-domain steganography classic: the flag is drawn directly in the spectrum, looking normal in the spatial domain and only revealed by FFT.",
    principle:
      "Grayscale the image, resample to a power-of-two size, do a row-column separable 2D FFT, take the `log(1+|F|)` magnitude spectrum, then fftshift to move low frequencies to the center and normalize to a grayscale image. Symmetric bright spots/text embedded in the frequency domain will appear.",
    usage: "Drop in a PNG/BMP and it outputs the magnitude spectrum PNG. Look for text/regular patterns outside the spectrum center.",
    examples: [
      { in: "an image that looks normal/noisy", out: "magnitude spectrum PNG (flag text revealed)" },
    ],
    tips: [
      "Use it when the spatial domain shows nothing and the challenge hints at 'frequency domain/Fourier/FFT'.",
      "Text in the magnitude spectrum usually appears twice with central symmetry (FFT conjugate symmetry).",
    ],
    aka: ["图像fft", "傅里叶频谱", "频域隐写", "2d fft", "fourier", "频谱图"],
  },

  bmpSizeRecover: {
    what: "Repair for a BMP whose width/height were altered. BMP has no CRC check, so it infers the true dimensions from the pixel data byte count. The BMP version of hiding an image by changing the height.",
    principle:
      "Each BMP row is aligned to 4 bytes (rowSize = ⌈bpp×width/32⌉×4). Available pixel bytes = file end − data offset. Enumerate widths so that `pixel bytes % rowSize == 0`, which gives the height. It prioritizes keeping the declared width and brute-forcing the height, then keeping the height and brute-forcing the width, then falls back to full enumeration.",
    usage: "Drop in a BMP; it automatically checks whether the width/height match the pixel data amount, and if not, infers the true dimensions and outputs the repaired base64.",
    examples: [
      { in: "a 24-bit BMP with altered dimensions", out: "repaired BMP (true dimensions) + inference report" },
    ],
    tips: [
      "BMP has no CRC, so changing the dimensions won't error like PNG does — you have to infer from the data amount.",
      "Pairs with PNG dimension brute-force recovery (pngSizeRecover) to cover both major dimension-altering image-hiding tricks.",
    ],
    aka: ["bmp修复", "bmp宽高", "fix bmp", "bmp尺寸修复", "改宽高藏图"],
  },
};
