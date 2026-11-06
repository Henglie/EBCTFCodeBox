/*
 * edu-historical-attacks.en.js — Bombe / MultipleBombe / Colossus English edu cards
 */
export default {
  bombe: {
    what: "The Bombe was the British electromechanical machine used to attack Enigma. Given a known-plaintext crib, it simulates many rotor starting positions in parallel and rejects wrong configurations through plugboard contradictions.",
    principle:
      "Crib/ciphertext correspondences form a menu graph: letters are nodes and Enigma transformations are edges. The Bombe energises one rotor start across the network; a diagonal board propagates plugboard constraints, and a configuration with no contradiction becomes a stop.\n\nA stop gives rotor starts and a partial plugboard, not the full key. The checking machine or manual reasoning is still needed. The Bombe ignores rotor stepping, so a crib that crosses middle-rotor stepping can fail.",
    usage:
      "Put one rotor per line in `rotors`, left to right, 3 or 4 rotors; `reflector` accepts B/C/B Thin/C Thin or 13 letter pairs; `crib` is the known plaintext and `offset` its position in the ciphertext; enable `check` for the checking machine. Output lists rotor stops, partial plugboard and a decryption preview.",
    examples: [
      { in: "BBYFLTHHYIJQAYBBYS", param: "rotors=I/II/III, reflector=B, crib=THISISATESTMESSAGE, offset=0, check=1", out: "LGA  SS AG BO CL EK FF HH II JJ TT YY  THISISATESTMESSAGE", desc: "standard 3-rotor checking-machine vector" },
    ],
    tips: [
      "Enigma never encrypts a letter to itself, so a crib letter equal to the ciphertext letter at that offset can be ruled out immediately.",
      "Longer cribs are more likely to cross middle-rotor stepping; if output is correct for a while and then breaks, suspect that first.",
      "A stop is not a unique solution; even after the checking machine, some plugboard pairs may remain unknown.",
    ],
    aka: ["Bombe", "Turing Bombe", "Bombe machine", "Enigma Bombe", "Bombe codebreaking", "Enigma attack", "known-plaintext attack", "crib attack", "Bombe cryptanalysis", "British Bombe", "Bombe computer", "Bombe cipher attack"],
  },

  multipleBombe: {
    what: "Multiple Bombe runs Bombe over a pool of rotor and reflector configurations when the rotor order is unknown, then ranks surviving candidates by quality.",
    principle:
      "It permutes configurations from the rotor pool and runs Bombe on each. Stops are scored by how many crib positions match the decryption preview and how many plugboard pairs were recovered; higher scores rank first.\n\nRuntime grows factorially with the pool, so a budget is mandatory. `maxRuns=0` means unlimited and should only be used for tiny pools.",
    usage:
      "`rotors` is the main rotor pool (one per line), `fourthRotors` the optional fourth-rotor pool, and `reflectors` the reflector pool. `crib`/`offset`/`check` match Bombe; `maxRuns` caps the number of runs. Output is grouped by run with the best candidate marked.",
    examples: [
      { in: "BBYFLTHHYIJQAYBBYS", param: "rotors=I/II/III/IV/V, reflector=B, crib=THISISATESTMESSAGE, maxRuns=60", out: "LGA  SS  VFISUSGTKSTMPSUNAK", desc: "locate LGA/SS in a 3-rotor pool" },
    ],
    tips: [
      "Larger pools explode quickly; validate the direction with a small pool and short crib first.",
      "Scores rank candidates, they do not prove a key; always read the decryption preview.",
      "A full fourth-rotor permutation may exceed a safe single-run budget; split the pool.",
    ],
    aka: ["Multiple Bombe", "MultipleBombe", "batch Bombe", "multi-configuration Bombe", "rotor-pool Bombe", "Enigma batch attack", "Bombe multi-run", "multiple rotor search", "Multiple Bombe machine", "Bombe search", "Enigma rotor search", "batch crib attack"],
  },

  colossus: {
    what: "Colossus was the world's first electronic computer, built in WWII to count pulse patterns in Lorenz SZ40/42 ciphertext and help break high-level German teleprinter traffic.",
    principle:
      "Colossus reads ITA2 characters from paper tape, combines Z (ciphertext), ΔZ, chi, Δchi, psi and Δpsi into five QBus pulses, then counts how often conditions and addition switches match.\n\nIt does not decrypt directly. Counters reveal likely chi or psi wheel starts; operators combine those with limitations and a crib to recover the key.",
    usage:
      "`pattern` selects KH/ZMUG/BREAM; `qbusZ/qbusChi/qbusPsi` choose pulse sources; `limitation` sets chi2/P5 constraints; `program` offers Letter Count, 1+2 Break In, 4=5=/1=2 and /,5,U; `starts` takes 12 wheel positions. Output is printer text plus C1-C5 counters.",
    examples: [
      { in: "CTBKJUVXHZ-H3L4QV+YEZUK+SXOZ/N", param: "KH Pattern, QBus Z, Letter Count, all starts 1", out: "00 00 : a30", desc: "count 30 characters" },
    ],
    tips: [
      "Colossus is a counting/breaking machine, not a Lorenz encryptor; use `lorenz` for encryption/decryption.",
      "The /,5,U program counts three marker characters to locate X3; Set Total directly controls how many lines the 1+2 and 4=5 programs print.",
      "QBus and limitation switches must match the tape sample; one wrong switch produces large meaningless counts.",
    ],
    aka: ["Colossus", "Colossus computer", "Colossus machine", "Colossus codebreaking", "Lorenz attack", "Tunny attack", "Bill Tutte", "Tommy Flowers", "Bletchley Colossus", "Colossus counting machine", "Colossus cryptanalysis", "Colossus Mk II"],
  },
};
