/*
 * edu-openssl.en.js — opensslDec English edu card (pure data, no imports, no side effects).
 * Vectors generated with OpenSSL 3.5.7; the truncated sample is a real 42-byte ciphertext.
 */
export default {
  opensslDec: {
    what:
      "OpenSSL passphrase encrypt/decrypt: turns a `U2FsdGVkX1…` string (Salted__ header + salt + ciphertext) back into plaintext with a single passphrase, and produces the same format in the other direction so the system openssl can decrypt it.",
    principle:
      "The layout comes from OpenSSL `enc` (also the default of several language libraries): `\"Salted__\"` (8 bytes) ‖ salt (8 bytes) ‖ ciphertext.\n\n" +
      "Key and IV are derived by EVP_BytesToKey with count=1: `D₁ = H(passphrase ‖ salt)`, `Dᵢ = H(Dᵢ₋₁ ‖ passphrase ‖ salt)`. The digests are concatenated; the first keyLen bytes are the key and the next 16 bytes are the CBC IV. Two digest choices: MD5 (`-md md5`, the classic default) and SHA-256 (`-md sha256`, the OpenSSL 3 default).\n\n" +
      "Encryption is AES-128/192/256-CBC with PKCS#7 padding: the last byte gives a length 1..16 and the same number of trailing bytes must all equal it. CBC XORs each block with the previous one, so one wrong key/IV byte garbles the whole plaintext.\n\n" +
      "auto mode runs all 8 combinations (3 AES key sizes × 2 digests + RC4 × 2 digests): block ciphers are checked for PKCS#7 validity first, stream ciphers are scored directly by plaintext plausibility (valid UTF-8, ASCII printable ratio, known file magic), then the best is picked and every attempt listed.\n\n" +
      "**RC4 variant**: CryptoJS RC4 uses the same Salted__ wrapper but is a stream cipher — the ciphertext length need not be a multiple of 16, the key is 32 bytes derived by EVP_BytesToKey, with no padding and no drop. A 42-byte ciphertext like this (not an AES block multiple) should make you suspect RC4 first.",
    usage:
      "Decrypt: enter the passphrase that followed `-k`; leave cipher and KDF on auto when unsure. Input may be base64 (an optional `data:…;base64,` prefix is accepted), hex, or a dropped file through the raw-byte channel.\n" +
      "Encrypt: choose direction \"encode\", set passphrase/cipher/KDF and get base64 starting with `U2FsdGVkX1` that `openssl enc -d` can read. auto encoding uses AES-256-CBC + MD5 (the classic pair); pick `sha256` explicitly to match OpenSSL 3 defaults.\n" +
      "A length that is not a multiple of 16 raises \"ciphertext length N is not a multiple of 16 (missing M bytes)\" — no truncation, no zero padding, no garbage output. A missing `Salted__` header, invalid padding and a wrong passphrase also raise.",
    examples: [
      {
        in: "U2FsdGVkX1/+VhjF1yB94/NBL+GgUVpObI3orI+tfNFO3FbMpga9SjxqJ9omMUaR",
        param: "passphrase=HAPPYNEWYEAR2026, cipher=aes-256-cbc, kdf=md5, mode=decode",
        out: "Hello OpenSSL vector one",
      },
      {
        in: "hello",
        param: "passphrase=demo, cipher=auto, kdf=auto, mode=encode",
        out: "U2FsdGVkX1… (random salt each run, so the value differs; decrypt with openssl enc -d -aes-256-cbc -md md5 -k demo)",
      },
      {
        in: "U2FsdGVkX19j9ML+b3YCvo9YcSIpc1lJDhAooMzHrhN7xtMqjnejx2iYI+Usoq203Ry+tYp7R1ZaTQ==",
        param: "passphrase=any",
        out: "error: ciphertext length 42 is not a multiple of 16 (missing 6 bytes)",
      },
    ],
    tips: [
      "Check the prefix first: base64 beginning with `U2FsdGVkX1` is almost certainly OpenSSL/CryptoJS Salted__; suspect the passphrase, the digest and the key size in that order.",
      "With `-k`, OpenSSL 3 already defaults to SHA-256 while older recipes usually say `-md md5`; trying both is the safe move, which is exactly what auto does.",
      "The format has no MAC, so a wrong passphrase is caught only by padding and plaintext plausibility (chance padding passes is about 1/256). Pure binary without file magic may therefore be rejected as suspicious; use the aes op with an explicit key/IV in that case.",
      "Reproduce on the command line: `openssl enc -aes-256-cbc -salt -md md5 -k PASS -in plain -out enc`, add `-d` to decrypt; `-P` prints the derived key/IV for comparison.",
      "Truncation detection covers only lengths that are not multiples of 16; a cut of exactly 16 bytes keeps the length legal and must be spotted from the decrypted result.",
      "The RC4 key is 32 bytes after derivation (the CryptoJS default), not 16; if it fails, check whether cipher is auto or rc4. A comma-separated ASCII code string needs one more code-to-character conversion.",
    ],
    aka: [
      "openssl decrypt", "openssl enc decrypt", "Salted__ decrypt", "U2FsdGVkX1 decrypt",
      "OpenSSL passphrase decrypt", "EVP_BytesToKey", "openssl enc -d", "AES passphrase decrypt",
      "AES passphrase encrypt", "PKCS7 unpad", "openssl salted cipher", "openssl enc ciphertext",
      "Salted__ cipher", "openssl password encryption",
      "RC4 decrypt", "CryptoJS RC4", "rc4 salted", "Salted__ RC4",
    ],
  },
};
