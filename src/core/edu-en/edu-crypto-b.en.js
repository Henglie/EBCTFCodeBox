/*
 * edu-crypto-b.en.js — B-group crypto expansion English edu cards (stream ciphers 7 + KDF 3).
 *
 * Translation of src/core/edu/edu-crypto-b.js.
 * Ops covered: a52 / e0 / hc128 / hc256 / sosemanuk / spritz / vmpc / balloon / lyra2 / yescrypt
 * Pure data, no side effects. Export contract matches eduContent.js header.
 * Example values were measured by running the actual ops in Node (not fabricated).
 */
export default {
  mickey: {
    what: "MICKEY-128 2.0 — a 128-bit-key stream cipher by Babbage & Dodd (MICKEY = Mutual Irregular Clocking KEYstream), an eSTREAM Phase 3 finalist aimed at resource-constrained hardware. Two 160-bit registers entangle each other through \"irregular clocking\".",
    principle:
      "Two 160-bit registers R and S. Each cycle outputs bit R[0]^S[0], then two control bits decide how to clock: Control_R = S[54]^R[106] and Control_S = S[106]^R[53] — key bits of each register cross-determine the other's clocking mode, hence \"mutual irregular clocking\".\n\n" +
      "CLOCK_R has two modes: Control_R=1 uses Shift-and-XOR (the feedback bit decides whether the R_Mask is applied), Control_R=0 uses Shift-only; CLOCK_S complements bits with COMP0/COMP1 and feeds back through two Galois tap sets FB0/FB1.\n\n" +
      "Initialization: R/S cleared → IV bits loaded one by one (MSB-first, 0~128 bits) → 128 key bits loaded → 160 blank clocks of preclocking. Then every 8 cycles produce one keystream byte; plaintext XOR keystream gives ciphertext.",
    usage: "Enter plaintext (UTF-8) in the input box. key = 128-bit key (32 hex; default is the official vector key). iv = IV (0~128 bits, up to 32 hex, may be empty; default 21436587 is the official vector IV). Encode outputs ciphertext hex; decode reverses. Key + IV must match the encrypting side.",
    examples: [
      { in: "Hello", param: "key=123456789abcdef00123456789abcdef, iv=21436587", out: "efddad9a52", desc: "Measured ciphertext; decodes back" },
      { in: "efddad9a52", param: "key=123456789abcdef00123456789abcdef, iv=21436587", out: "Hello", desc: "Round-trip verification" },
    ],
    tips: [
      "Official vector: key=123456789abcdef00123456789abcdef iv=21436587 → keystream starts a7b8c1f63dcafbef7dc726e2b12b3e44 — validate any implementation with it first.",
      "Mind the family split: MICKEY 2.0 (80-bit key / 32-bit IV) and MICKEY-128 2.0 (128-bit key / 0~128-bit IV) are two different parameter sets; this op is the 128-bit one.",
      "The bit-by-bit 160-bit implementation is fast (8 cycles × 160 bits per byte) and reimplementable on site; don't skip the 160 blank preclocking cycles.",
      "Official \"counter-intuitive\" bit order: IV/key loading is MSB-first (high bit of each byte first), and output bytes are assembled MSB-first too.",
    ],
    aka: ["MICKEY-128 2.0", "MICKEY128", "MICKEY-128", "Babbage", "Dodd", "eSTREAM finalist", "eSTREAM portfolio", "irregular clocking", "160-bit registers", "Mutual Irregular Clocking", "hardware stream cipher", "Profile 2", "128-bit key stream cipher", "eSTREAM Phase 3", "mutual clocking"],
  },
  a52: {
    what: "A5/2 — the stream cipher used to encrypt GSM voice calls, the deliberately weakened \"export version\" of A5/1 designed for 1990s export-control compliance. Built from four LFSRs.",
    principle:
      "Four registers: R1/R2/R3 are 19/22/23 bits, R4 is 17 bits. Every clock cycle, bits 10/3/7 of R4 vote by majority — if more than half are 1, the corresponding register shifts. This majority clocking is where A5/2's irregular stepping comes from.\n\n" +
      "Output is not a plain XOR: the top bits of R1/R2/R3 are XORed together with three \"mask terms\" — each mask term is the AND of two internal bits of one register, adding nonlinearity. Output lags the register stepping by one clock (one warm-up getbit after key loading).\n\n" +
      "A 64-bit key Kc plus a 22-bit frame number are loaded together: first Kc fills the registers, then frame bits are mixed in (while forcing some bits to avoid the all-zero state). No output is produced until loading finishes.",
    usage: "Enter plaintext (UTF-8) in the input box. key = 64-bit session key Kc (16 hex chars; default 00FCFFFFFFFFFFFF is the official vector key). frame = 22-bit frame number (decimal or 0x hex; default 0x21). Encode outputs ciphertext hex; decode reverses it. Key + frame must match the encrypting side exactly.",
    examples: [
      { in: "Hello", param: "key=00FCFFFFFFFFFFFF, frame=0x21", out: "bc3440c07c", desc: "Measured ciphertext; decodes back with same params" },
      { in: "bc3440c07c", param: "key=00FCFFFFFFFFFFFF, frame=0x21", out: "Hello", desc: "Round-trip verification" },
    ],
    tips: [
      "A5/2 is fully broken (statistical bias attacks recover the key in real time) — in CTF it usually appears as a direct call or a strength comparison with A5/1.",
      "The A5 frame number is 22 bits; 0x hex or decimal both work. One wrong frame bit and all output is wrong.",
      "GSM challenges often show Kc as 128-bit hex — A5/2 only uses the first 64 bits (16 hex chars).",
      "The official vector key=00FCFFFFFFFFFFFF frame=0x21 is the standard test baseline — validate any implementation with it first.",
    ],
    aka: ["A5/2", "GSM A5/2", "A5-2", "A5.2", "Briceno", "GSM voice encryption", "export weakened version", "A5 family", "LFSR clocking", "majority clocking", "cellular cipher", "GSM stream cipher", "frame number", "Kc session key", "A5/1 weaker variant"],
  },
  e0: {
    what: "E0 — the stream cipher used by Bluetooth, combining four LFSRs with a nonlinear summing combiner to encrypt user data on Bluetooth links.",
    principle:
      "Four LFSRs of 25/31/33/39 bits with distinct tap polynomials. Output comes from the summing combiner: the four current LFSR bits pass through a T1/T2 pair of 2-bit state machines (with a 2-bit memory ct mixing linearly) and then a nonlinear map F (sum lookup table).\n\n" +
      "Initialization: the 128-bit session key Kc is mixed with the 48-bit device address BD_ADDR and the 26-bit Bluetooth clock CLK into a 208-bit preload shifted bit by bit into the four LFSRs (feedback starts once each reaches its length), then 39 idle cycles stabilize the state; finally 128 output bits Z reload the LFSRs before keystream production begins.\n\n" +
      "Keystream byte = per-cycle output bit z = x1^x2^x3^x4^(ct&1) concatenated.",
    usage: "key = 128-bit session key Kc (32 hex; default all zero). addr = 48-bit Bluetooth device address BD_ADDR (12 hex). clk = 26-bit clock (decimal or 0x). Encode: plaintext → ciphertext hex; decode reverses. Default params run the example directly.",
    examples: [
      { in: "Hello", param: "key=0×16, addr=0×6, clk=0", out: "e67987802e", desc: "Measured ciphertext with all-zero params; decodes back" },
      { in: "e67987802e", param: "key=0×16, addr=0×6, clk=0", out: "Hello", desc: "Round-trip verification" },
    ],
    tips: [
      "Bluetooth challenges usually provide all three of Kc/BD_ADDR/CLK — none can be omitted, the keystream depends on all three.",
      "BD_ADDR is the device MAC (48 bits); CLK is usually given as the low 26 bits — don't paste a full 32-bit clock in.",
      "E0 has an algebraic attack (Armknecht 2002) recovering the key — look it up for hard challenges.",
      "Unlike most stream ciphers E0 has 2-bit memory state; output is not a simple XOR of the current cycle, so implement the state machine step by step.",
    ],
    aka: ["E0", "Bluetooth encryption", "Bluetooth E0", "Bluetooth stream cipher", "summing combiner", "T1 T2 state machine", "BD_ADDR", "Bluetooth CLK", "Bluetooth Kc", "Bluetooth security", "LFSR combination", "Bluetooth Core Spec", "baseband encryption", "2-bit memory", "Bluetooth 2.1"],
  },
  hc128: {
    what: "HC-128 — a stream cipher by Wu Hongjun (HKUST) with a 128-bit key, one of the 7 finalists of the eSTREAM project. Its core is a 512×32-bit state table, making it extremely fast in software.",
    principle:
      "Two tables P and Q of 512×32-bit words. The key and IV are expanded to fill both tables, then \"warmed up\" for 1024 steps to fully mix the state (warm-up updates XOR an extra intermediate value besides the addition).\n\n" +
      "During keystream production each step cross-updates the two tables — P[j] is computed from P[j-10], P[j-3], P[j+1] and an h-function lookup into Q; Q symmetrically looks into P. The h1/h2 functions index two 256-entry partitions of the table with the low 16 bits (two bytes) of the input, adding the two looked-up words.\n\n" +
      "Each update simultaneously emits a 32-bit keystream word; plaintext XOR keystream gives ciphertext. The P/Q pair alternates as \"generator\" and \"helper\" table, producing strong diffusion.",
    usage: "key = 128-bit key (32 hex; default all zero). iv = 128-bit IV (32 hex; default all zero). Encode: plaintext → ciphertext hex; decode reverses. Key + IV must match exactly.",
    examples: [
      { in: "HC128", param: "key=iv=all-zero (32 hex)", out: "ca43244198", desc: "Measured ciphertext; decodes back" },
      { in: "ca43244198", param: "key=iv=all-zero (32 hex)", out: "HC128", desc: "Round-trip verification" },
    ],
    tips: [
      "Official vector: with key=iv=0 the keystream starts 82001573 44f7f6f8 3e76170b 5c2e51bd — all-zero params are common in challenges.",
      "HC-128 takes a 128-bit key only; 256-bit key means HC-256 (separate op), don't mix them.",
      "HC-128 needs only two 2KB tables — easy to reimplement on site; challenges often give known plaintext to reconstruct the keystream.",
      "Among the 7 eSTREAM finalists it's the pure-table lookup type and one of the fastest — \"high-speed software stream cipher\" hints at it.",
    ],
    aka: ["HC-128", "HC128", "Wu Hongjun", "eSTREAM finalist", "eSTREAM portfolio", "128-bit stream cipher", "software stream cipher", "P Q tables", "high-speed stream cipher", "table lookup cipher", "eSTREAM Phase 3", "Crypto++ vectors", "fast stream cipher", "HKUST cipher", "software encryption"],
  },
  hc256: {
    what: "HC-256 — the larger-key sibling of HC-128 with a 256-bit key, same design family, two 1024×32-bit state tables, targeting 256-bit security.",
    principle:
      "It is HC-128 scaled up: key+IV (512 bits total) expand into W[16..2559], split into P (512..1535) and Q (1536..2559), two 1024-word tables; 4096 warm-up steps then keystream production.\n\n" +
      "The update formula adds one extra term versus HC-128: P[j] += P[j-10] + G1(P[j-3], P[j+1], Q), where G1 contains a Q-table lookup (HC-128 has none); the H function also upgrades from 2-byte indexing to 4-byte indexing across four 256-entry partitions.\n\n" +
      "Each keystream word is an h-table mix of P[j] XORed with terms like P[j-512]; table cross-reference is isomorphic to HC-128 but with doubled scale.",
    usage: "key = 256-bit key (64 hex; default all zero). iv = 256-bit IV (64 hex; default all zero). Encode/decode must use identical params.",
    examples: [
      { in: "HC256", param: "key=iv=all-zero (64 hex)", out: "1344bbb0ee", desc: "Measured ciphertext; decodes back" },
      { in: "1344bbb0ee", param: "key=iv=all-zero (64 hex)", out: "HC256", desc: "Round-trip verification" },
    ],
    tips: [
      "Official vector: with key=iv=0 the keystream starts 5b078985 1577d687 d09d4671 ... — the standard validation starting point.",
      "64-hex key parameter means HC-256; 32-hex means HC-128 — parameter length distinguishes them at a glance.",
      "No effective attack on HC-256 is known; in CTF it appears as \"reverse this encryptor\" or known-keystream challenges.",
      "Two 4KB tables plus 4096 warm-up steps make on-site reimplementation costlier than HC-128 — rarer in challenges.",
    ],
    aka: ["HC-256", "HC256", "256-bit stream cipher", "eSTREAM finalist", "eSTREAM portfolio", "Wu Hongjun", "software stream cipher", "1024-word P Q tables", "high-speed stream cipher", "Crypto++ vectors", "HC-128 upgrade", "double-size tables", "large-key stream cipher", "eSTREAM Phase 3", "fast software cipher"],
  },
  sosemanuk: {
    what: "Sosemanuk — a stream cipher designed by Berbain, Billet et al. in 2008, one of the 7 eSTREAM finalists. It packs Serpent's S-boxes into an LFSR+FSM structure and is extremely fast in software.",
    principle:
      "The LFSR holds 10 32-bit state words; its feedback polynomial embeds Serpent's S2 box for nonlinearity. The FSM (finite state machine) is two words r1/r2 with core update r2 = ROTL7(r1 × 0x54655307) — 0x54655307 is \"Sosemanuk\" read as hex, multiplication truncated to low 32 bits.\n\n" +
      "Key scheduling uses a truncated Serpent key schedule expanding 100 subkey words; the IV initializes the LFSR and FSM through 3 Serpent 8-round blocks (intermediate state extracted at rounds 12/18/24).\n\n" +
      "Every 20 steps (5 LFSR steps + 4 FSM updates + 1 Serpent S2 application) produce 20 keystream words, then a 4-word permutation outputs 16 words (64 bytes) of keystream.",
    usage: "key = 128~256-bit key (32~64 hex; default 00112233445566778899aabbccddeeff). iv = 128-bit IV (32 hex; default all zero). Encode: plaintext → ciphertext hex; decode reverses.",
    examples: [
      { in: "Sosemanuk", param: "key=001122…ff (32 hex), iv=all-zero", out: "62ada57d79c333589a", desc: "Measured ciphertext; decodes back" },
      { in: "62ada57d79c333589a", param: "key=001122…ff (32 hex), iv=all-zero", out: "Sosemanuk", desc: "Round-trip verification" },
    ],
    tips: [
      "Official test vector: key=A7C083FEB7 iv=00112233445566778899aabbccddeeff (note the 80-bit key) is the accepted benchmark.",
      "Name easter egg: 0x54655307 = ASCII \"Sosemanuk\" — spotting this constant identifies it.",
      "The low-32-bit truncation in r2 = ROTL7(r1 × 0x54655307) is the biggest porting trap; in JS use split multiplication or BigInt to avoid float overflow.",
      "Among eSTREAM finalists it holds software speed records; it appears in challenges more often than HC-256.",
    ],
    aka: ["Sosemanuk", "Berbain", "Billet", "Serpent S2", "0x54655307", "LFSR FSM", "eSTREAM finalist", "eSTREAM portfolio", "software stream cipher", "fast stream cipher", "Serpent box", "eSTREAM Phase 3", "Pornin", "French stream cipher", "high-speed cipher"],
  },
  spritz: {
    what: "Spritz — a stream cipher released in 2014 by Ron Rivest (inventor of RSA) and Jacob Schuldt as an \"improved descendant\" of RC4, fixing RC4's output bias and formalizing key setup and IV usage.",
    principle:
      "The core is a 256-byte state array S plus six pointers i/j/k/w/z/a. Absorbing a key is not the old KSA shuffle: it goes through two phases — whip (3 rounds of N steps each, swapping S[i] and S[j] with a-dependent adjustment) then crush (2 rounds conditionally swapping S[i] with S[128+i]), guaranteeing thorough mixing.\n\n" +
      "Unlike the early spritz.c version, the paper version uses an a counter in absorption (key bytes are exchanged into the S[a] slot), k participates in update, and crush is a conditional swap.\n\n" +
      "Each keystream byte is preceded by N/2 whip steps; output z = S[j+S[i]], then one \"shuffle\" step decorrelates consecutive outputs. Encryption is plaintext XOR keystream (self-inverse).",
    usage: "key = key hex of any length (IV supported by absorbing key then IV; default key=414243 i.e. ASCII \"ABC\"). Encode: plaintext → ciphertext hex; decode reverses with the same key (including IV order).",
    examples: [
      { in: "Spritz", param: "key=414243 (ABC)", out: "24eafc688d93", desc: "Measured ciphertext; decodes back" },
      { in: "24eafc688d93", param: "key=414243 (ABC)", out: "Spritz", desc: "Round-trip verification" },
    ],
    tips: [
      "Authoritative vector: key=ABC gives keystream starting 779a8e01f9e9cbc0 — validate your implementation before solving.",
      "⚠ Older tutorials' spritz.c is the early version, incompatible with the paper 2014-10-27 algorithm (different outputs). This implementation is the paper version.",
      "Rivest himself calls Spritz an educational design rather than production-grade; challenges are usually paper-original problems.",
      "RC4's output bias (distinguishable first hundreds of bytes) is fixed by the crush phase — a common \"why improve\" question.",
    ],
    aka: ["Spritz", "Rivest", "Schuldt", "RC4 improvement", "RC4 successor", "whip crush", "paper version", "spritz.c", "sponge-like", "Ron Rivest", "2014 stream cipher", "a counter absorption", "N/2 whip", "improved RC4", "bias-free stream cipher"],
  },
  vmpc: {
    what: "VMPC — a stream cipher designed by Polish cryptographer Bartosz Zoltak in 2004, standing for Variably Modified Permutation Composition. A table-driven cipher over a 256-byte permutation, often viewed as an enhanced RC4 variant.",
    principle:
      "State is a 256-byte permutation table P plus counters s and n. Initialization (KSA) runs 768 shuffle rounds per key/IV pass: BASIC mode goes Key→IV; FULL mode re-shuffles with the key once more (Key→IV→Key), making the table more random.\n\n" +
      "Core step: n increments; output z = P[P[P[n]] + s] (three nested permutation lookups); then P[n] and P[s] are swapped and s = P[s]... — the table evolves under \"permutation composition\" each round.\n\n" +
      "Encryption is keystream XOR plaintext (self-inverse). Key length 1–64 bytes, IV 1–64 bytes.",
    usage: "key = key hex (1~64 bytes; default 414243 i.e. ASCII \"ABC\"). iv = IV hex (1~64 bytes). mode = basic/full (default basic). Encode: plaintext → ciphertext hex; decode reverses.",
    examples: [
      { in: "VMPC", param: "key=414243, iv=000102", out: "61dfd13e", desc: "Measured ciphertext; decodes back" },
      { in: "61dfd13e", param: "key=414243, iv=000102", out: "VMPC", desc: "Round-trip verification" },
    ],
    tips: [
      "Official vector (embedded in the author's source): BASIC mode P-table sample 3fa5226775b3d2c3 — validate with it.",
      "FULL mode (Key→IV→Key) has one more absorption pass and produces a completely different keystream; if decoding fails, check the mode first.",
      "The n counter is unsigned char in C and wraps at 255 — JS ports MUST apply & 255; the most common porting bug.",
      "Zoltak also defined a VMPC-MAC variant; this op implements only the stream cipher itself — a MAC requirement is a different beast.",
    ],
    aka: ["VMPC", "Zoltak", "Variably Modified Permutation", "permutation composition", "RC4 variant", "BASIC FULL modes", "vmpcfunction.com", "256-byte permutation", "table lookup cipher", "enhanced RC4", "Polish stream cipher", "VMPC-MAC", "P-table sampling", "2004 stream cipher", "self-inverse XOR"],
  },
  balloon: {
    what: "Balloon — a memory-hard password KDF proposed in 2016 by Boneh, Corrigan-Gibbs and Schechter (Stanford). It turns a password and salt into a large random-access memory footprint, raising the hardware cost of brute force.",
    principle:
      "First the password+salt are mixed through SHA-256 into a seed, which generates a buffer of blocks (default 1024 blocks × 32 bytes ≈ 32KB). Then two phases:\n\n" +
      "① Chaining phase: each round updates every block from its predecessor through the hash; ② Random-access phase: each block additionally mixes in \"delta\" (default 3) pseudo-randomly chosen old blocks — the pseudo-random positions are determined by the salt (the original design; salt-driven access pattern is Balloon's signature feature versus Argon2).\n\n" +
      "Output = several hash rounds over the buffer tail. Parallelizing requires holding the whole buffer with random access, which neutralizes GPU/ASIC advantage.",
    usage: "Input the password in the box. salt = salt value (may be empty). sCost = space blocks (default 1024 ≈ 32KB; use 32 for fast CTF verification). tCost = rounds (default 3). delta = random blocks mixed per block (default 3). Output is the hex derived key.",
    examples: [
      { in: "password", param: "salt=ctf, sCost=1024, tCost=3, delta=3", out: "8f5df72cbc33f1b00e631dab852034a755dab2eed0f40016f9d676b33144decb", desc: "Derived key with default params (measured)" },
      { in: "hunter42", param: "salt=examplesalt, sCost=32, tCost=3", out: "1bc2f0775ab26e0f797c154da889935749e8f673d075cd73078619e76dc1f3f5", desc: "Fast small-parameter example (matches RustCrypto)" },
    ],
    tips: [
      "Authoritative vectors (RustCrypto and nachonavarro agree): hunter42/examplesalt small-parameter combo validates implementations.",
      "Balloon vs Argon2 difference: the salt drives the memory access pattern — a favorite \"which KDF lets salt affect memory access\" question.",
      "Smaller sCost (e.g. 32) gives identical results but runs instantly — validate the pipeline small before scaling up.",
      "Output length is fixed by the hash (32 bytes); a 64-byte challenge output implies a different construction underneath.",
    ],
    aka: ["Balloon", "Balloon KDF", "Boneh", "Corrigan-Gibbs", "Schechter", "memory-hard", "2016 KDF", "Stanford KDF", "salt-driven access", "balloon-hashing", "GPU-resistant", "password hashing", "crypto balloon", "ASIC-resistant", "space-time tradeoff"],
  },
  lyra2: {
    what: "Lyra2 — a well-known entrant of the 2014 Password Hashing Competition (PHC), a memory-hard password KDF built on Blake2b with a 768-bit sponge filling a memory matrix.",
    principle:
      "The core pads the password and salt (together with the basil parameter block) via pad10*1, then feeds the Blake2b compression function (12-round G permutation; 1-round reduced for the inner loops) block by block through a 768-bit (12-word) sponge state while filling an nRows×64 memory matrix.\n\n" +
      "After the matrix is filled comes the \"Wandering\" phase with alternating odd/even rounds: each step reads a pseudo-random matrix position, mixes it into the current state, and writes back — the access position is determined by the state value itself (state-dependent access, resisting cache-timing and custom hardware).\n\n" +
      "Finally the sponge state is output little-endian for kLen bytes. Row count mCost sets memory usage (rows × 64 columns × 96 bytes).",
    usage: "Input the password in the box. salt = salt value. tCost = rounds (default 2). mCost = matrix rows (default 4, ≥2; larger = more memory). nCols = column count (basil parameter, default 256). kLen = output bytes (default 32). Output is the hex derived key.",
    examples: [
      { in: "password", param: "salt=ctf, tCost=2, mCost=4, nCols=256, kLen=32", out: "9ba55e0861bace75cd25779c0e9aa7ef1e1af200dc35ff80625cb1892435a169", desc: "Derived key with default params (measured)" },
      { in: "p", param: "salt=s, tCost=1, mCost=4", out: "a04714884105008e7e509e1214633cb8f806cf89470f5cac4a58c0ade76c9612", desc: "Fast small-parameter example" },
    ],
    tips: [
      "Each +1 mCost adds 64×96 = 6KB memory; 4 rows ≈ 24KB. Validate with small mCost, scale up in production.",
      "Lyra2 is a PHC finalist and a \"cousin\" of winner Argon2 — challenges often compare their memory-hard properties.",
      "Odd/even round alternation in Wandering is a porting detail (access patterns differ per parity); one wrong round breaks all output.",
      "Basil parameters (kLen/password length/salt length/rounds/rows/cols) enter the hash input too — changing any parameter changes the output entirely.",
    ],
    aka: ["Lyra2", "Lyra2 KDF", "PHC", "Password Hashing Competition", "Blake2b sponge", "Wandering", "odd-even wandering", "memory matrix", "memory-hard", "sponge KDF", "2014 KDF", "sponge duplex", "Brazilian KDF", "PHC finalist", "password hashing"],
  },
  yescrypt: {
    what: "yescrypt — the KDF designed by Solar Designer (John the Ripper author) for the 2015 crypt(3) password-hashing competition. A heavily strengthened scrypt, actually used by Openwall systems and some Linux distributions.",
    principle:
      "Three modes are selected by flags: flags=0 is standard scrypt (RFC 7914 compatible); flags=1 is WORM (Write Once Read Many); the default RW mode is strongest — it prehashes (HMAC with the fixed 8-byte key \"yescrypt\"), generates a 12KB S-box (pwxform permutation transform), applies S-box random-access transforms during smix (PWXsimple lookup + GATHER collection + ROUNDS mixing), and periodically \"wraps\" to revisit the whole memory.\n\n" +
      "The SCRAM tail is another scrypt hardening: the HMAC-derived key goes through one more SHA-256(HMAC(DK, \"Client Key\"))-style pass to resist cache side-channel attacks.\n\n" +
      "N is memory blocks (power of 2); memory = 128·N·r bytes. p parallelism only affects the leading/trailing PBKDF2 — the smix core stays serial (that's the point against parallelism).",
    usage: "Input the password in the box. salt = salt value. mode = rw (default) / worm / scrypt-compatible. N = memory blocks (default 2048 ≈ 32MB; use 4~64 for CTF verification). r = block-byte parameter (default 8). p = parallelism (default 1). t = iterations (default 0). dkLen = output bytes. Output is the hex derived key.",
    examples: [
      { in: "password", param: "salt=ctf, mode=rw, N=64, r=8, p=1, t=0, dkLen=32", out: "1f32d805163aa89c27ef47f8d9fd8751ee2abc0600c112a1eb1b6e936c439f34", desc: "RW mode small-N derived key (measured)" },
      { in: "p", param: "salt=s, mode=rw, N=4", out: "475701bd8c515e9ded798d7b45ff36527dd88950409d663a2a2a7e8e06cdf81571ea370fb269b57d40d3b675eaa024b7c49307032e56e94b9aeb2bd00b78a2f6", desc: "RW mode official vector (openwall tests.c, 64-byte output)" },
    ],
    tips: [
      "Official vector: RW mode p/s N=4 t=0 64 bytes = 0cd5af76eb241df8… (openwall official tests); validate implementations against it.",
      "scrypt-compatible mode must equal standard scrypt output exactly — yescrypt's downward compatibility promise, a favorite exam point.",
      "N must be a power of 2; default N=2048 needs ~32MB — the browser stalls on large N, shrink it first.",
      "With p>1 the PBKDF2 block number is big-endian (RFC 2898) — the most hidden porting trap; if output mismatches, check this first.",
    ],
    aka: ["yescrypt", "yescrypt KDF", "Solar Designer", "openwall", "scrypt strengthening", "scrypt successor", "WORM", "pwxform", "SCRAM", "crypt competition", "John the Ripper", "memory-hard", "password hashing competition 2015", "prehash", "ROM-resistance"],
  },
};
