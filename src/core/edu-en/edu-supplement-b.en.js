// English cards for ops that previously fell back to Chinese: base62 / base85 / base91 / beaufortVariant / ebcdic.
export default {
  base85: {
    what: "A denser encoding than base64: every 4 bytes become 5 characters. Adobe's Ascii85 and ZeroMQ's Z85 are both variants of it.",
    principle: "Each 4-byte (32-bit) group is treated as an integer and written in base 85 as 5 characters ($85^5 > 2^{32}$, so it always fits).\n\nAscii85 is usually wrapped in `<~ ~>`, and a 4-byte all-zero group may be compressed to a single `z`.",
    usage: "Paste base85/Ascii85 text to decode; the encode direction goes the other way. The Z85 variant has its own z85 tool.",
    examples: [
      { in: "<~87cURDZ~>", param: "Direction: decode; alphabet=Standard (Adobe Ascii85); input carries the <~ ~> wrapper", out: "Hello", desc: "<~ ~> is the Ascii85 wrapper", run: { dir: "decode", params: { alphabet: "Standard", includeDelimiter: true } } },
      { in: "Hello", param: "Direction: encode; alphabet=Standard, includeDelimiter=true (output keeps the <~ ~> wrapper)", out: "<~87cURDZ~>", desc: "The encode direction is the reverse of the first row", run: { dir: "encode", params: { alphabet: "Standard", includeDelimiter: true } } },
    ],
    tips: ["A `<~ ~>` wrapper, or a wide character range (punctuation included) at high density, suggests base85."],
    aka: ["ascii85", "base 85", "a85", "Base85", "Ascii85", "Adobe ASCII85", "Z85", "base85 encode", "base85 decode", "radix 85"],
  },

  base91: {
    what: "A denser encoding than base85 using 91 printable characters; a high-density variant occasionally seen in CTF misc challenges.",
    principle: "Variable-length groups (13 or 14 bits) looking up a 91-character alphabet. The alphabet contains many punctuation marks, so the text looks messy.",
    usage: "Paste basE91 text to decode; the encode direction goes the other way. A custom alphabet is supported.",
    examples: [
      { in: "fPNKd", param: "Direction: decode (default 91-character alphabet)", out: "test", desc: "Punctuation-heavy, high density", run: { dir: "decode" } },
      { in: "test", param: "Direction: encode (default 91-character alphabet)", out: "fPNKd", desc: "The encode direction is the reverse; 5 characters carry 4 bytes", run: { dir: "encode" } },
    ],
    tips: ["A short string of mixed letters, digits and punctuation that is not valid base64/base85 territory may be basE91."],
    aka: ["base 91", "basE91", "Base91", "basE91 encoding", "b91", "base91 encode", "base91 decode", "high-density encoding"],
  },

  base62: {
    what: "A base encoding using only alphanumerics (0-9A-Za-z), no symbols at all — common for short links and IDs.",
    principle: "The bytes are treated as one big integer and repeatedly divided by 62, mapping the remainders through the alphabet. The character set is clean (no +/=), so it is URL-safe.",
    usage: "Paste a base62 string to decode; the encode direction goes the other way. A custom alphabet is supported.",
    examples: [
      { in: "AAwf93rvy4aWQVw", param: "Direction: decode (0-9A-Za-z alphabet, big integer back to bytes)", out: "hello world", desc: "Pure alphanumerics, no symbols and no padding", run: { dir: "decode" } },
      { in: "hello world", param: "Direction: encode (0-9A-Za-z alphabet)", out: "AAwf93rvy4aWQVw", desc: "The encode direction is the reverse", run: { dir: "encode" } },
    ],
    tips: ["Pure alphanumerics with no symbols and no = padding, of variable length, suggests base62."],
    aka: ["base 62", "b62", "Base62", "base62 encoding", "base62 encode", "radix 62", "alphanumeric encoding", "short link encoding", "0-9A-Za-z", "base62 decode"],
  },

  beaufortVariant: {
    what: "Variant Beaufort (also called the German variant of Beaufort): a letter-key subtraction that runs opposite to standard Beaufort — it subtracts the key from the plaintext, not the plaintext from the key. It looks like standard Beaufort but is NOT a reciprocal cipher: encryption and decryption are two different operations.",
    principle: "In the same letter-key add/subtract family, with letter values A=0…Z=25 modulo 26 there are three formulas:\nstandard Vigenere $c_i=(p_i+k_i)\\bmod 26$; standard Beaufort $c_i=(k_i-p_i)\\bmod 26$ (reciprocal); variant Beaufort $c_i=(p_i-k_i)\\bmod 26$.\n\nThe most useful equivalent description of variant Beaufort: encryption is standard Vigenere decryption and decryption is standard Vigenere encryption. Hence it is not reciprocal — encrypting the ciphertext again does not return the plaintext, you must use the decode direction.\n\nThe key repeats cyclically; negative results get +26 ($3-2=1$; $2-11=-9\\to17$). Each position is independent, so like Vigenere it keeps single-alphabet statistics and Kasiski/index-of-coincidence analysis can recover the key length.",
    usage: "Two parameters: the letter key (non-letters are ignored, but at least one letter must remain or the tool errors out) and the character mode (letters only / keep non-letters in place).\n\nEncode: plaintext → ciphertext; decode: ciphertext → plaintext. The direction cannot be omitted — it is not reciprocal, and the wrong direction yields plausible-looking gibberish. Non-letters are dropped by default (same as the standard Beaufort in this project); with keep non-letters, spaces and punctuation stay in place and do not consume key positions.\n\nWith the default key CLE and input DCODE the official example BRKBT reproduces directly, which makes a handy self-check.",
    examples: [
      { in: "DCODE", param: "Direction: encode; key=CLE, chars=letters (non-letters dropped)", out: "BRKBT", desc: "Official example: 3−2=1(B), 2−11=−9+26=17(R), 14−4=10(K), 3−2=1(B), 4−11=−7+26=19(T)", run: { dir: "encode", params: { key: "CLE", chars: "letters" } } },
      { in: "BRKBT", param: "Direction: decode; key=CLE, chars=letters (decryption = C+K)", out: "DCODE", desc: "Decryption adds the ciphertext and the key modulo 26", run: { dir: "decode", params: { key: "CLE", chars: "letters" } } },
      { in: "ATTACKATDAWN", param: "Direction: encode; key=FORTIFICATION (cycled), chars=letters", out: "VFCHUFSRDHOZ", desc: "A long key repeats; note it is not reciprocal, so re-encoding the result does not return the plaintext", run: { dir: "encode", params: { key: "FORTIFICATION", chars: "letters" } } },
      { in: "MEET ME AT DAWN!", param: "Direction: encode; key=key, chars=keep (spaces/punctuation stay, key positions not consumed)", out: "CAGJ IG QP FQSP!", desc: "Non-letters stay in place; decoding returns MEET ME AT DAWN!", run: { dir: "encode", params: { key: "key", chars: "keep" } } },
    ],
    tips: [
      "Telling the three apart at a glance: Vigenere $c=p+k$; standard Beaufort $c=k-p$ and reciprocal; variant Beaufort $c=p-k$ and NOT reciprocal.",
      "Quick test: run the ciphertext through encrypt once more — readable text means standard Beaufort (reciprocal); variant Beaufort needs the decode direction.",
      "Handy equivalence: to solve variant Beaufort with a plain Vigenere tool, swap the encrypt/decrypt buttons — variant Beaufort encryption is Vigenere decryption.",
      "It has many aliases: German variant, Variante allemande de Beaufort; it is not the same cipher as standard Beaufort.",
      "Non-letters in the key are silently ignored: `C-L-E` equals `CLE`; a key with no letters at all is an error rather than returning the input.",
      "Security boundary: a monoalphabetic polyalphabetic substitution; a short key falls to Kasiski/index of coincidence. Teaching and puzzle use only, never for real secrecy.",
    ],
    aka: ["variant beaufort", "beaufort variant cipher", "german variant beaufort", "variante de beaufort", "variante allemande de beaufort", "plaintext minus key cipher", "non-reciprocal beaufort", "beaufort third form"],
  },

  ebcdic: {
    what: "The old IBM mainframe character set, laid out completely differently from ASCII. You meet it in forensics or reverse engineering of legacy finance and government systems.",
    principle: "An 8-bit encoding whose letters and digits sit at different code points than in ASCII (for example `A` is 0xC1 in EBCDIC, not 0x41), and the letters are not contiguous. Because browsers' `TextDecoder` does not support it, the tool embeds the 037/1047 tables itself.",
    usage: "Pick a code page in the parameters (037, 1047, …). Decode: EBCDIC bytes → ASCII text; encode: text → EBCDIC bytes.",
    examples: [
      { in: "C8C9", param: "Direction: decode; codepage=cp1047 (default), format=hex", out: "HI", desc: "In EBCDIC H=0xC8 and I=0xC9", run: { dir: "decode", params: { codepage: "cp1047", format: "hex" } } },
      { in: "flag", param: "Direction: encode; codepage=cp037, format=hex", out: "86938187", desc: "Under cp037 f=0x86 l=0x93 a=0x81 g=0x87", run: { dir: "encode", params: { codepage: "cp037", format: "hex" } } },
      { in: "86938187", param: "Direction: decode; codepage=cp037, format=hex", out: "flag", desc: "Reverse of the encode row, confirming the hex round trip", run: { dir: "decode", params: { codepage: "cp037", format: "hex" } } },
    ],
    tips: [
      "Letters showing up in the 0xC1–0xE9 high range with `A`=0xC1 is the strongest EBCDIC fingerprint.",
      "Data exported from a mainframe, or garbled old bank messages: try EBCDIC.",
      "The default code page is **cp1047** (it contains `[]{}^~\\`, so `flag{}` encodes directly); cp037 lacks those symbols. Characters the table cannot represent raise an explicit error instead of silently becoming `?`.",
    ],
    aka: ["ebcdic", "cp037", "cp1047", "ibm mainframe encoding", "mainframe charset", "extended binary coded decimal", "ebcdic037", "ibm-037", "ibm-1047", "ebcdic decode"],
  },
};
