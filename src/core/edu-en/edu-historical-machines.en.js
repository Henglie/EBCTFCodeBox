/*
 * edu-historical-machines.en.js — Typex / SIGABA / Lorenz English edu cards
 */
export default {
  typex: {
    what: "Typex is the British WWII five-rotor cipher machine derived from Enigma. The two right-hand rotors are static; the left three step like Enigma. It also has an input plugboard and a reflector plugboard.",
    principle:
      "Each letter passes through the input plugboard, five rotors, the reflector, and back. Rotor wiring, reversal, ring setting and initial position determine the mapping.\n\nDifferences from Enigma:\n\n1. five rotors, the two right-hand rotors do not step;\n2. rotors can be installed reversed;\n3. the input plugboard is an arbitrary 26-letter permutation, not pair swaps;\n4. keyboard emulation uses `Z` to enter symbol mode and `V` to leave it, packing digits and punctuation into A-Z.",
    usage:
      "Put one rotor per line in `rotors`: `wiring<steps|reversed|ring|initial`; `reflector` takes 13 letter pairs; `plugboard` takes a 26-letter wiring. Encode and decode use the same settings (self-reciprocal). `keyboard` selects Encrypt/Decrypt emulation.",
    examples: [
      { in: "hello world, this is a test message.", param: "default example rotors, keyboard=None, strict=true", out: "VIXQQ VHLPN UCVLA QDZNZ EAYAT HWC", desc: "standard example vector" },
      { in: "hello world, this is a test message.", param: "keyboard=Encrypt, other defaults", out: "VIXQQ FDJXT WKLDQ DFQOD CNCSK NULBG JKQDD MVGQ", desc: "keyboard symbol mode" },
      { in: "VIXQQ FDJXT WKLDQ DFQOD CNCSK NULBG JKQDD MVGQ", param: "keyboard=Decrypt, other defaults", out: "HELLO WORLD, THIS IS A TEST MESSAGE.", desc: "self-reciprocal decryption" },
    ],
    tips: [
      "Real Typex rotor wirings are not public; like other public implementations, this tool uses example wirings, so it is not a historical key-recovery tool.",
      "The two static right-hand rotors are the clearest difference from Enigma.",
      "When ring and initial position are both set, step points shift with the ring; check both first if a vector does not match.",
    ],
    aka: ["Typex", "Typex cipher machine", "Typex Mark 22", "British Typex", "British rotor cipher", "Typex rotor machine", "RAF Typex", "Typex cipher", "Typex machine", "Typex encrypt", "Typex decrypt", "Typex Mark XXII"],
  },

  sigaba: {
    what: "SIGABA (ECM Mark II) was a high-security US rotor cipher machine used from WWII into the 1950s. It has 15 rotors: five cipher rotors, five control rotors and five index rotors.",
    principle:
      "Each letter is enciphered by the five cipher rotors. The control rotors then produce four outputs from right to left, the index rotors map them to 0-9 stepping signals, and fixed logic decides which cipher rotors advance.\n\nBecause the control and index rotors keep changing, cipher-rotor stepping is highly irregular. Encryption and decryption run in opposite directions and are not self-reciprocal.\n\nOnly three control rotors step: the fast rotor every character, the middle rotor when the fast rotor reaches O, and the slow rotor when the middle rotor also reaches O.",
    usage:
      "`cipherRotors` and `controlRotors` take five lines each: `wiring|reversed|initial`; `indexRotors` takes five lines: `0-9 wiring|initial`. Use encode for encryption and decode for decryption. A space becomes `Z` before encryption, and plaintext `Z` becomes `X`.",
    examples: [
      { in: "HELLO WORLD TESTING THE SIGABA MACHINE", param: "default example rotors", out: "ULBECJCZJBJFVUDWAVRGRBMPSQHOTTNVQEESKN", desc: "example encryption vector" },
      { in: "ULBECJCZJBJFVUDWAVRGRBMPSQHOTTNVQEESKN", param: "default example rotors, decode", out: "HELLO WORLD TESTING THE SIGABA MACHINE", desc: "reverse decryption" },
    ],
    tips: [
      "The 15 rotor wirings are public examples, not real historical key material.",
      "Encryption and decryption are separate buttons; decode must use the same rotors and initial positions as encryption.",
      "Control and index rotors do not substitute letters; they only drive cipher-rotor stepping, so do not treat them as ordinary rotors.",
    ],
    aka: ["SIGABA", "ECM Mark II", "ECM Mk II", "US SIGABA", "SIGABA cipher machine", "US WWII cipher machine", "15-rotor cipher machine", "SIGABA rotor machine", "SIGABA cipher", "SIGABA machine", "ECM cipher machine", "SIGABA encrypt", "SIGABA decrypt"],
  },

  lorenz: {
    what: "Lorenz SZ40/42 was a German WWII twelve-wheel cipher attachment for high-level teleprinter traffic: five chi wheels, five psi wheels and two mu motor wheels produce an ITA2 five-bit key stream XORed with the plaintext.",
    principle:
      "Each ITA2 character has five bits, XORed with the current chi and psi cam bits. Chi wheels step on every character; psi wheels step only when the motor condition allows; mu61 steps every character and mu37 is controlled by the mu61 cam.\n\nSZ42a/42b add limitation conditions (chi2, psi1, P5), and KT-Schalter changes the limitation test.\n\nSender and receiver use the same key stream, so encryption and decryption are the same XOR process, but the direction affects the limitation logic.",
    usage:
      "`starts` takes 12 one-based positions in `psi1-5 mu37 mu61 chi1-5` order. `pattern` selects KH/ZMUG/BREAM/No Pattern/Custom; for Custom, `customLugs` takes 12 lines of cams (`.` inactive, `x` active). Use encode to send and decode to receive.",
    examples: [
      { in: "HELLO WORLD, THIS IS A TEST MESSAGE.", param: "SZ40 / KH Pattern / all starts 1", out: "VIC3TS/CUJA/3II9W9JWDI5DAFXT4SOIF3999IZD9T", desc: "KH pattern example" },
      { in: "HELLO WORLD, THIS IS A TEST MESSAGE.", param: "SZ40 / No Pattern / all starts 1", out: "HELLO9WORLD55N889THIS9IS9A9TEST9MESSAGE55M", desc: "ITA2 conversion only, no encryption" },
      { in: "HELLO WORLD, THIS IS A TEST MESSAGE.", param: "SZ42a / KH Pattern / all starts 1", out: "VIC3TS/ZOHUYXWLTUXPV9ZNOTW9IXJPFDLIBB5ZD9K", desc: "SZ42a limitation logic" },
    ],
    tips: [
      "Lorenz and Enigma are different machines; Lorenz has no reflector and XORs a binary key stream.",
      "ITA2 5/8/9 are letter/figure/space shift characters, not ordinary digits; plaintext mode inserts them automatically.",
      "Start positions are one-based wheel positions, not zero-based; ranges vary by wheel size, and one wrong position shifts the whole message.",
    ],
    aka: ["Lorenz", "Lorenz SZ40", "Lorenz SZ42", "SZ40", "SZ42a", "SZ42b", "Lorenz cipher", "Lorenz machine", "Lorenz cipher attachment", "Tunny", "German Lorenz", "Lorenz SZ"],
  },
};
