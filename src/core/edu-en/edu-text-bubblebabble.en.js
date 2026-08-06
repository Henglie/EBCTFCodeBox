/*
 * edu-text-bubblebabble.en.js — BubbleBabble Encoding English edu card (text).
 *
 * Translation of src/core/edu/edu-text-bubblebabble.js.
 * Op covered: bubblebabble
 * Pure data, no side effects. Export contract matches eduContent.js header.
 */
export default {
  bubblebabble: {
    what: "BubbleBabble — a misreading-resistant encoding designed by Antti Huima in 2000. It encodes binary data (hash fingerprints, checksums) into readable vowel-consonant strings, grouped 5 chars with hyphens and wrapped in 'x', e.g. `ping` → `xisak-nerek-loxix`. Designed so people can read it aloud and hand-copy without errors; also used for SSH host key fingerprints.",
    principle:
      "Alphabets: vowels = `aeiouy` (6), consonants = `bcdfghklmnprstvzx` (17, last is padding 'x').\n\n" +
      "Encoding (checksum seed c starts at 1):\n" +
      "① Each 2-byte group (byte1, byte2) outputs 6 characters:\n" +
      "   `vowels[((byte1>>6 & 3) + c) % 6]` `consonants[(byte1>>2) & 15]` `vowels[((byte1 & 3) + c//6) % 6]` `consonants[(byte2>>4) & 15]` `-` `consonants[byte2 & 15]`;\n" +
      "② After each group: `c = (c*5 + byte1*7 + byte2) % 36`;\n" +
      "③ Odd trailing byte: checksum tuple `vowels[c%6]` + `consonants[16]` + `vowels[c//6]`;\n" +
      "④ Wrap with padding 'x'; empty input → `xexax`.\n\n" +
      "Decoding reverses this: each 6-char group restores 2 bytes, and the checksum tuple verifies seed consistency (anti-tamper / anti-copy-error).\n\n" +
      "Key point: c is a content-rolling checksum seed, so any single-character tampering is detected at decode time — that is the essence of its misreading resistance.",
    usage: "Enter text (or BubbleBabble ciphertext) and run. encode produces the bubble string, decode restores. Input is processed as UTF-8 bytes; Chinese works.",
    examples: [
      { in: "ping", param: "", out: "xisak-nerek-loxix", desc: "Official spec example" },
      { in: "hello", param: "", out: "xipak-herek-serix", desc: "Classic English" },
      { in: "123456789", param: "", out: "xesef-disof-gytuf-katof-movix", desc: "Digits" },
      { in: "xisak-nerek-loxix", param: "", out: "ping", desc: "decode restores" },
    ],
    tips: [
      "Vowel-consonant string starting and ending with 'x', hyphen-grouped (e.g. xisak-nerek-loxix) → BubbleBabble.",
      "Distinguish from base encodings: BubbleBabble contains only vowels (aeiouy) + consonants (bcdfghklmnprstvzx) + hyphens, no digits or most symbols.",
      "SSH host key fingerprints (xxxxx-xxxxx-...) are often BubbleBabble — in CTF, use this op to recover original data from a fingerprint.",
      "It has a checksum: tampering one character reports 'checksum mismatch' instead of decoding wrong output — that is a feature, not a bug.",
      "Input is a byte stream: Chinese is UTF-8 encoded before encoding, and restored as UTF-8 after decoding.",
    ],
    aka: ["bubblebabble", "Bubble Babble", "bubble encoding", "misreading resistant", "bubblepy", "Antti Huima", "fingerprint encoding", "ssh fingerprint", "fingerprint encoding", "bubble babble encoding", "xi encoding", "bubblebabble decode", "bubble string", "bubble code", "xexax"],
  },
};
