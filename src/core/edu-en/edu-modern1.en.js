// English edu shard: modern segment, first 8 (fernet/tea/xtea/xxtea/sm4/salsa20/chacha20/rc5). Pure data, no imports, no side effects.
export default {
  fernet: {
    what: "An 'out of the box' symmetric encryption token format, the one that ships with Python's cryptography library. It packages encryption and tamper-proofing together; you just supply the key and data.",
    principle:
      "Internally it's AES-128-CBC for encryption + HMAC-SHA256 for tamper-proofing. The token structure is fixed:\n\n" +
      "`version(0x80) ‖ timestamp(8 bytes) ‖ IV(16 bytes) ‖ ciphertext ‖ HMAC(32 bytes)`, all base64url-encoded once.\n\n" +
      "The key is a 32-byte base64url string: the first 16 bytes are the signing key (for HMAC), the last 16 bytes are the encryption key (for AES). Decryption verifies the HMAC first, and only decrypts AES if it passes.",
    usage: "Enter the base64url 32-byte key, input a token to decrypt into plaintext; the encode direction wraps plaintext into a token.",
    examples: [
      { in: "gAAAAABh…(base64url token)", param: "key = base64url 32 bytes", out: "plaintext", desc: "decrypts only after signature verification passes" },
    ],
    tips: [
      "The token almost always starts with `gAAAAA` — that's how the version byte 0x80 looks in base64url, an instant Fernet giveaway.",
      "If the key is wrong or the data was altered, the HMAC check fails first and it never reaches decryption.",
    ],
    aka: ["fernet token", "对称令牌", "python fernet", "fernet", "fernet加密", "对称加密令牌", "cryptography fernet", "aes-cbc hmac令牌", "gaaaaa令牌", "fernet token格式", "认证加密令牌"],
  },

  tea: {
    what: "Tiny Encryption Algorithm — the famously 'short enough to memorize' block cipher, extremely common in reverse-engineering challenges.",
    principle:
      "Block length 64 bits (two 32-bit words), key 128 bits (four 32-bit words), 32 Feistel rounds. Each round mixes the two half-blocks together, accumulating a magic constant delta = `0x9E3779B9` (the golden ratio $2^{32}/\\phi$).\n\n" +
      "The simple structure also brings weaknesses: equivalent keys and related-key issues exist, so don't use it in real security scenarios.",
    usage: "Enter a 128-bit key (16 bytes), input the ciphertext to decrypt; the encode direction encrypts.",
    formulas: [
      { tex: "\\text{sum} \\mathrel{+}= \\delta,\\quad \\delta = \\mathtt{0x9E3779B9}", caption: "The golden-ratio constant accumulated each round" },
    ],
    tips: [
      "When you see the magic number `0x9E3779B9` in source, it's almost certainly the TEA / XTEA / XXTEA family.",
      "64-bit block → ciphertext length is a multiple of 8 bytes.",
    ],
    aka: ["tiny encryption algorithm", "tea密码", "wheeler needham", "tea", "微型加密算法", "tea算法", "tea cipher", "feistel分组密码", "0x9e3779b9", "tea block cipher", "小型加密算法"],
  },

  xtea: {
    what: "TEA's patched version (eXtended TEA), fixing TEA's related-key flaw with a more careful key schedule. Reverse-engineering challenges often test it alongside TEA.",
    principle:
      "Same 64-bit block, 128-bit key, 32 rounds, still using delta = `0x9E3779B9`. The difference is that each round uses different bits of sum to pick a key word (`key[(sum>>11)&3]` and the like), rather than a fixed order like TEA, mixing the key more evenly.",
    usage: "Enter a 16-byte key, input the ciphertext to decrypt; the encode direction encrypts.",
    tips: [
      "It looks almost identical to TEA; the distinguishing point is the key index: XTEA computes the subscript by shifting `sum`, while TEA just takes 0/1 directly.",
      "It also recognizes `0x9E3779B9`.",
    ],
    aka: ["extended tea", "xtea密码", "tean", "xtea", "扩展tea", "xtea算法", "xtea cipher", "extended tiny encryption algorithm", "tea补丁版", "0x9e3779b9", "xtea分组密码"],
  },

  xxtea: {
    what: "The TEA family's 'encrypt the whole block together' version (Corrected Block TEA). Instead of processing block by block, it treats the entire chunk of data as one big array and mixes it uniformly.",
    principle:
      "The data is arranged into an array of 32-bit words (at least 2 words, i.e. ≥8 bytes), 128-bit key. The number of rounds varies with length: $6 + \\lfloor 52/n \\rfloor$ rounds (n = number of words). The core is the MX mixing function, also carrying delta = `0x9E3779B9`. Because the whole array is coupled, changing one word spreads its effect to all words.",
    usage: "Enter a 16-byte key, input the ciphertext (≥8 bytes) to decrypt; the encode direction encrypts.",
    formulas: [
      { tex: "\\text{rounds} = 6 + \\lfloor 52/n \\rfloor", caption: "Round count varies with the data's word count n" },
    ],
    tips: [
      "It doesn't work on data under 8 bytes; input too short is returned unchanged.",
      "With the same key, a single error anywhere in the ciphertext causes large swaths to fail to decrypt — because the whole array is coupled.",
    ],
    aka: ["corrected block tea", "xxtea密码", "block tea", "xxtea", "修正块tea", "xxtea算法", "xxtea cipher", "整块tea", "0x9e3779b9", "corrected block tiny encryption algorithm", "块tea加密"],
  },

  sm4: {
    what: "The national commercial cipher block cipher (GM/T 0002), China's self-developed symmetric encryption standard. It appears often in domestic CTFs and compliance systems, the domestic counterpart to AES.",
    principle:
      "Block length 128 bits, key 128 bits, 32 rounds of nonlinear iteration. Each round performs a composite transform T of 'S-box nonlinear substitution + linear diffusion', and the key expansion generates 32 round keys with a similar structure. Decryption reuses the encryption flow, just with the round keys in reverse order.",
    usage: "Enter a 16-byte key, select the mode of operation (ECB/CBC etc., CBC needs an IV), input the ciphertext to decrypt; the encode direction encrypts.",
    tips: [
      "128-bit block, like AES the ciphertext length is a multiple of 16 bytes.",
      "When the problem mentions 'national cipher / commercial cipher / GM/T', it's most likely SM4 (encryption) or SM3 (hashing).",
    ],
    aka: ["sm4", "国密sm4", "商用密码", "gm/t 0002", "sm4分组密码", "sm4算法", "sm4 cipher", "国密算法", "商密sm4", "国产分组密码", "sms4", "gb/t 32907"],
  },

  salsa20: {
    what: "A stream cipher designed by Bernstein, fast and clean in structure. ChaCha20 is its improved sibling.",
    principle:
      "It builds a 64-byte initial state from key (16 or 32 bytes) + nonce (8 bytes) + block counter, repeatedly running 20 rounds of quarter-round (addition, XOR, rotation) to generate a keystream, then XORs it byte by byte with the plaintext. Stream ciphers are inherently self-inverse: running the same parameters over the ciphertext again yields the plaintext.",
    usage: "Enter the key and 8-byte nonce, input the ciphertext to XOR-recover the plaintext (encode and decode are the same form).",
    tips: [
      "Stream cipher — the ciphertext and plaintext are equal length (no padding), unlike a block cipher.",
      "An 8-byte nonce is a Salsa20 characteristic; if the nonce is 12 bytes it's most likely ChaCha20.",
    ],
    aka: ["salsa20", "salsa", "bernstein流密码", "salsa20流密码", "salsa cipher", "djb salsa", "salsa20算法", "daniel bernstein", "quarter round流密码", "salsa流密码", "estream salsa"],
  },

  chacha20: {
    what: "The upgraded version of Salsa20's stream cipher, with better diffusion and faster software implementation, a regular in TLS, WireGuard, and modern protocols (RFC 8439).",
    principle:
      "The state is a 4×4 matrix of 32-bit words: constant `expand 32-byte k` + key(32 bytes) + counter + nonce(12 bytes). It runs 20 rounds of quarter-round to scramble, adds the result to the initial state, outputs a 64-byte keystream block, and XORs it with the plaintext. Also self-inverse.",
    usage: "Enter a 32-byte key and 12-byte nonce, input the ciphertext to XOR-recover the plaintext.",
    tips: [
      "Recognize the signature: 32-byte key + 12-byte nonce + the constant string `expand 32-byte k`.",
      "It's often combined with Poly1305 into an AEAD (ChaCha20-Poly1305), the kind that carries a 16-byte authentication tag.",
    ],
    aka: ["chacha20", "chacha", "rfc8439", "chacha20-poly1305", "查查20", "chacha流密码", "chacha cipher", "rfc 8439", "chacha20 poly1305", "aead流密码", "expand 32-byte k", "chacha20算法"],
  },

  rc5: {
    what: "A parameterized block cipher designed by Rivest, whose biggest highlight is 'data-dependent rotation' — how many bits to rotate depends on the data itself.",
    principle:
      "Notated RC5-w/r/b: word length w, rounds r, key bytes b. This tool uses the common RC5-32/12/16 (32-bit words, 12 rounds, 16-byte key, 64-bit block). Each round mixes addition, XOR, and a rotation whose amount is decided by the other half; the key expansion also uses two magic constants related to the golden ratio and e.",
    usage: "Enter the key, select the mode (CBC needs an IV), input the ciphertext to decrypt; the encode direction encrypts.",
    tips: [
      "Data-dependent rotation is the hallmark of RC5/RC6; seeing something like `ROL(a, b & 31)` in reverse engineering is suspicious.",
      "64-bit block → ciphertext is a multiple of 8 bytes; its successor RC6 has a 128-bit block.",
    ],
    aka: ["rc5", "rivest cipher 5", "rc5-32/12/16", "ron rivest rc5", "rc5算法", "rc5 cipher", "数据依赖旋转密码", "rc5分组密码", "rc5-w/r/b", "rivest密码5", "参数化分组密码"],
  },
};
