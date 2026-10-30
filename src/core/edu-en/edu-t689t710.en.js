/*
 * edu-t689t710.en.js — 2026-10-26 接线批：Falcon / Poseidon / KZG / OpenSSH·PKCS#12·JWK / GCM·NTRU-CCA2 / Xoodyak / ECC 攻击共 17 op 科普卡（English）。
 * aka 经 eduAliases() 注入搜索别名索引；示例值均来自各卡 verify harness 实跑。
 */
export default {
  "falconPkParse": {
    "what": "Falcon public-key parsing — decodes a Falcon/FN-DSA (the lattice signature selected in NIST's post-quantum competition) public key blob (spec §3.11.4: a 1-byte header 0000 nnnn followed by a 14-bit big-endian bitstream per coefficient) into structured fields: the parameter set (Falcon-512/1024), N, the coefficients of the polynomial h (mod q=12289), and a SHA256 fingerprint. The first step before verifying, and the entry point when a challenge hands you a .pub or a public-key hex.",
    "principle": "**The public key is the ring element h ∈ Z_q[x]/(x^n+1)** (q=12289, n=512/1024): the encoding is minimal — a header byte `0000 nnnn` (low 4 bits = log2(n): 0x09 → n=512, 0x0A → n=1024), then n coefficients of 14 bits each (12289 < 2^14) concatenated MSB-first with no separators, totaling 1 + ⌈14n/8⌉ = 897/1793 bytes.\n\n**Validity checks during parsing** (each errors out explicitly): exact length match; header byte within the supported sets; every 14-bit coefficient < q=12289 (out-of-range means corruption — 14 bits can express 16384 while valid values stop at 12288, and that headroom acts as a natural check).\n\n**The role of h**: verification computes $s_2 + s_1 \\cdot h \\bmod q$ which must equal the hash-to-point c — h is all a verifier needs (no private key involved).",
    "usage": "Input: the public key as hex (897/1793 bytes = 1794/3586 hex chars) or base64.\n\nOutput: parameter set/N/q/header byte, all h coefficients (decimal list), coefficient count and fingerprint; errors classified by kind (length / header / coefficient range / hex / base64).\n\nUse cases: PQC challenges that hand out a Falcon public key (parse first to confirm the parameter set); combine with \"Falcon verify\" for the full verification chain.",
    "examples": [
      {
        "in": "(a Falcon-512 official KAT public key, 897 bytes hex)",
        "out": "Set = Falcon-512 (logn=9, n=512, q=12289); header 0x09; 512 h coefficients (listed); fingerprint SHA256:…",
        "desc": "NIST Round-3 KAT public key parses cleanly"
      },
      {
        "in": "the same key minus its last 2 hex chars (1 byte)",
        "out": "explicit error \"public key length 896 bytes ≠ header 1 + ⌈14·512/8⌉ = 897\"",
        "desc": "Byte-exact length validation"
      },
      {
        "in": "first coefficient raised to ≥12289 (in-range for 14 bits)",
        "out": "explicit error \"coefficient … ≥ q=12289\"",
        "desc": "The 14-bit headroom doubles as an integrity check"
      }
    ],
    "formulas": [
      {
        "tex": "pk = \\text{0x0} n_{\\mathrm{log}} \\;\\|\\; \\mathrm{bits}_{14}(h_0) \\| \\cdots \\| \\mathrm{bits}_{14}(h_{n-1})",
        "caption": "Public-key encoding (spec §3.11.4), 1+⌈14n/8⌉ bytes"
      },
      {
        "tex": "0 \\le h_i < q = 12289 < 2^{14}",
        "caption": "The 14-bit encoding headroom is what makes the range check possible"
      }
    ],
    "tips": [
      "Spotting it: challenges with FN-DSA / Falcon / post-quantum lattice .pub or key hex → parse here first; 897 bytes means Falcon-512, 1793 means Falcon-1024.",
      "Header quick reference: 0x09 = Falcon-512, 0x0A = Falcon-1024; other low nibbles (n=256 etc.) are unsupported and error out explicitly.",
      "A coefficient ≥12289 is almost certainly corruption or a deliberate trap — valid public keys can never contain one.",
      "Public keys are public material; verification needs only the key, never any private material.",
      "Sources: Falcon Specification v1.2 §3.11.4 (encoding) and §2.6 Table 3.3 (parameters); NIST Round-3 submission Reference_Implementation (nist.c/codec.c conventions)."
    ],
    "aka": [
      "Falcon public key parse",
      "Falcon PK",
      "FN-DSA public key",
      "Falcon-512 pubkey",
      "Falcon-1024 pubkey",
      "lattice signature pubkey",
      "Falcon key parse",
      "PQC key parse",
      "Falcon h polynomial",
      "falcon pubkey hex",
      "NTRU lattice public key",
      "post-quantum signature key",
      "Falcon PK parse",
      "897-byte public key",
      "Falcon 公钥解析"
    ]
  },
  "falconVerify": {
    "what": "Falcon verification (verify-only) — full specification verification (spec Algorithm 16) of a Falcon/FN-DSA signature: three encapsulations auto-detected (spec compressed 0x39/0x3A, CT uncompressed 0x59/0x5A, NIST API signed-message KAT style), then hash-to-point, negacyclic convolution and the norm bound, with format errors and signature errors reported as distinct classes. Pure JS O(n²) convolution (no NTT dependency); Falcon-1024 verification runs in milliseconds.",
    "principle": "**Three verification steps (spec §3.10 Algorithm 16)**:\n① **hash-to-point**: $c = \\mathrm{HashToPoint}(r \\| m)$ — SHAKE-256 sampled 16 bits big-endian at a time, accepting only $t < 61445$ ($= \\lfloor 2^{16}/q \\rfloor \\cdot q$ rejection sampling), $c_i = t \\bmod q$ (spec Algorithm 3);\n② **decompress and convolve**: the signature carries s2's compressed stream (each coefficient = sign bit ‖ low 7 bits ‖ unary-coded high part, k zeros then a 1); decompression performs the three uniqueness checks (exact length / no \"−0\" / trailing bits zero); then $s_1 = c - s_2 \\cdot h \\bmod (x^n+1, q)$ with coefficients centered into $[-6144, 6144]$;\n③ **norm bound**: $\\| (s_1, s_2) \\|^2 \\le \\lfloor \\beta^2 \\rfloor$ (Falcon-512 = 34 034 726, Falcon-1024 = 70 265 242, equality allowed) — the security core of the lattice scheme: a legitimate signature lands inside the bound via Gaussian sampling, while a forger can hardly satisfy both the convolution equation and the short norm.\n\n**Encapsulation auto-detection**: header byte `0 cc 1 nnnn` (cc=01 compressed / 10 = the CT 12-bit fixed-length uncompressed form); NIST API format = [2-byte big-endian sig_len] + nonce(40) + msg + esig (esig header 0x20+logn), with the message taken from the blob itself. The compressed-stream cap follows the official C reference's COMPRESSED_MAXSIZE; CT is always 1+40+12n/8.",
    "usage": "Input: message (UTF-8 or hex) + public key hex + signature (hex/base64; all three encapsulations auto-detected).\n\nOutput: the format line, the verdict (valid/invalid with reason: c mismatch / norm over bound), the s1/s2 norm values, performance data; format errors (length / header / \"−0\" / NIST length mismatch) and signature errors (c mismatch / norm over bound) are reported separately.\n\nUse cases: verifying Falcon signatures in PQC challenges, self-checking KAT vectors, classifying tampered samples (changed message / changed coefficient stream / changed nonce each fail differently). Verification is deterministic — no randomness, zero exfiltration.",
    "examples": [
      {
        "in": "(NIST Round-3 KAT Falcon-512 message/public key/signature)",
        "out": "Format = NIST API signed-message; verdict = ✓ valid (‖(s1,s2)‖² = … ≤ ⌊β²⌋ = 34034726); full c/s1/s2 fields",
        "desc": "Official KATs pass in full (both the 512 and 1024 sets)"
      },
      {
        "in": "the same signature with one message byte changed",
        "out": "verdict = ✗ invalid: c mismatch (the hash-to-point result differs) — message binding broken",
        "desc": "The changed-message failure mode"
      },
      {
        "in": "a \"−0\" manufactured in the coefficient stream (zero coefficient with sign bit)",
        "out": "format error: the decompression uniqueness checks reject \"−0\" — distinguished from signature errors",
        "desc": "The spec's three uniqueness checks in action"
      }
    ],
    "formulas": [
      {
        "tex": "c = \\mathrm{HashToPoint}_{n}(r \\| m),\\quad t < k \\cdot q,\\; k = \\lfloor 2^{16}/q \\rfloor = 5",
        "caption": "Hash-to-point (spec Algorithm 3): SHAKE-256 16-bit rejection sampling"
      },
      {
        "tex": "s_1 = c - s_2 \\cdot h \\bmod (x^n+1,\\, q)",
        "caption": "The convolution equation: negacyclic, coefficients centered"
      },
      {
        "tex": "\\|(s_1, s_2)\\|^2 \\le \\lfloor \\beta^2 \\rfloor",
        "caption": "The norm bound: 34034726 / 70265242 (equality allowed) — the scheme's security anchor"
      }
    ],
    "tips": [
      "Spotting it: challenges asking to verify FN-DSA/Falcon signatures or to diff a tampered one → this op; keygen/sign need FFT and Gaussian sampling and are out of scope (stated honestly in edu).",
      "Check the first byte for the encapsulation: 0x39/0x3A = spec compressed, 0x59/0x5A = CT fixed-length, 0x20-headed NIST structure (the first 2 bytes are the esig length) — KAT files use the third form.",
      "\"Format errors\" and \"signature errors\" are separate classes: the former are encoding/length/no-\"−0\" issues, the latter are c mismatch or norm over bound — triage by class first.",
      "Changing the nonce changes the hash input → c changes entirely → verification fails; changing high bits of the coefficient stream may hit format checks before the norm check — try both tamper paths.",
      "Performance: pure-JS schoolbook convolution O(n²), about 2–4 ms per Falcon-1024 verification (modern desktop, node median 2.76 ms); no WASM needed.",
      "Sources: Falcon Specification v1.2 (Algorithms 3/16/17/18, Table 3.3); the NIST Round-3 submission (nist.c/vrfy.c/codec.c) and Extra/c/falcon.c (encapsulation conventions); KATs = the official NIST submission KAT files."
    ],
    "aka": [
      "Falcon verify",
      "FN-DSA verify",
      "Falcon signature verification",
      "Falcon-512 verify",
      "Falcon-1024 verify",
      "lattice signature verify",
      "PQC signature verification",
      "Falcon 验签",
      "Falcon norm check",
      "HashToPoint",
      "post-quantum verify",
      "Falcon KAT",
      "NIST Falcon",
      "Falcon signature check",
      "Falcon 范数界"
    ]
  },
  "poseidon": {
    "what": "Poseidon prime-field hash — one of the most widely used \"ZK-friendly\" algebraic hashes in zero-knowledge proof systems (Grassi, Khovratovich, Rechberger, Roy, Schofnegger, USENIX Security 2021). It is NOT SHA-3: computation happens not on bitstrings but on elements of the prime field Z/p — the S-box is the power map x^5 and the linear layer is a Cauchy MDS matrix multiplication over the field, so a circuit needs only addition gates and constant multiplications, making proofs far cheaper than bit-level hashes (SHA-3/Keccak is a bit-level sponge; the two share nothing in structure or constants). The de-facto standard of the circomlib/snarkjs ecosystem (BN254).",
    "principle": "**HADES structure (paper §2)**: the state is a vector of t field elements (t = inputs + 1); there are R_F full rounds and R_P partial rounds arranged as \"first R_F/2 full rounds → R_P partial rounds → last R_F/2 full rounds\", each round in three steps:\n\n① **ARK**: add round constants element-wise (constants derived by the Grain LFSR self-shrinking generator from the instance parameters — transparent and reproducible);\n② **S-box**: full rounds apply $x^5$ to all t elements, partial rounds apply it only to the first element (the key to small circuits);\n③ **Mix**: multiply by the t×t Cauchy MDS matrix ($M_{i,j}=1/(x_i+y_j)$, guarantees diffusion).\n\n**S-box rule**: $x^\\alpha$ must be a field permutation, so $\\gcd(\\alpha, p-1)=1$; both the BN254 and BLS12-381 scalar fields satisfy $\\gcd(3,p-1)=3$ and $\\gcd(5,p-1)=1$, hence $\\alpha=5$ (as in the paper).\n\n**Round numbers (paper Table 2, with security margin)**: for x5-POSEIDON-128, t=3 gives R_F=8, R_P=57; t=5 gives R_P=60. circomlib follows the 128-bit-security derivation: t=2→56, t=3→57, t=5→60, t=6→60.\n\n**The two constant flavors shipped here**: ① circomlib/IAIK (BN254 t=2/3/5/6; constants generated by the official Grain script of the paper authors' lab at IAIK — this tool re-derived every constant with the same Grain generator as corroboration; circomlib is the CTF/snarkjs de-facto standard but not the paper's official parameter table); ② the HorizenLabs reference implementation (BN254 t=3 with R_P=56, and BLS12-381 t=2/3, taken from the official repository of the paper's author team). **The two \"BN254 t=3\" flavors are NOT interchangeable** (different R_P → different Grain seed); check which one the challenge uses.",
    "usage": "Input: 1 to t-1 field elements (0 ≤ x < p, decimal or hex, comma/space separated); the first state slot holds the \"initial state\" (default 0 — this matches circomlib). Or pick the \"tail zeros\" mode to place elements from slot 1 (k=t means the official permutation applied verbatim). Remaining slots are zero-padded.\n\nOutput: the permuted state elements — default is the first element as the hash; \"full state\" is available (multi-output Merkle use). Formats: decimal / 32-byte big-endian hex / minimal hex.\n\nTypical scenarios: a Poseidon digest produced by a circom/snarkjs challenge (usually ~77-78 decimal digits or 64 hex chars), ZK Merkle tree roots/leaves, nullifier computation. **One-way** — there is no \"decrypt\".",
    "examples": [
      {
        "in": "1,2 (BN254 t=3, initial state 0)",
        "out": "115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a",
        "desc": "official circomlibjs vector (poseidonperm_x5_254_3), 32-byte big-endian hex mode"
      },
      {
        "in": "1,2,3,4,5,6 (BN254 t=6, initial state 0)",
        "out": "20400040500897583745843009878988256314335038853985262692600694741116813247201",
        "desc": "official circomlibjs vector, decimal mode — t=6 is the most common circom-circuit width"
      },
      {
        "in": "0,1,2 (BLS12-381 t=3, tail zeros = verbatim permutation)",
        "out": "200e6982ac00df8fa65cef1fde9f21373fdbbfd98f2df1eb5fa04f3302ab0397",
        "desc": "first element of the official reference-implementation KAT (HorizenLabs flavor)"
      }
    ],
    "formulas": [
      {
        "tex": "S(x) = x^{5},\\quad \\gcd(5, p-1) = 1",
        "caption": "S-box: x^3 is not a permutation on the BN254/BLS12-381 scalar fields (3 | p-1), so x^5"
      },
      {
        "tex": "v^{(r+1)} = M_\\mathrm{MDS}\\,(S(v^{(r)} + c^{(r)}))",
        "caption": "Each round ARK→S-box→Mix; partial rounds apply S to v[0] only (HADES)"
      },
      {
        "tex": "(M_\\mathrm{MDS})_{i,j} = \\frac{1}{x_i + y_j}",
        "caption": "Cauchy MDS matrix (paper §2.3; same origin as the official IAIK generator)"
      }
    ],
    "tips": [
      "Recognition: a challenge mentioning circom/snarkjs/gnark or a ZK Merkle tree plus \"Poseidon\"; a digest under 254 bits (~77-78 decimal digits or 64 hex chars) → likely BN254 Poseidon.",
      "⚠ Identify the constant flavor first: circomlib-style (R_P=57 at t=3) vs HorizenLabs-reference-style (R_P=56 at t=3) are not interchangeable — different output for the same input is not a bug.",
      "Completely unrelated to this tool's SHA-3 op: SHA-3 eats byte strings, Poseidon eats field elements; pushing a flag string byte-wise into Poseidon yields an entirely different value. If a challenge asks for \"Poseidon of a string\", it usually means converting the string to field elements first (common: 31-byte chunks, big-endian to integers).",
      "Merkle-tree scenario: paper §4.2 suggests domain separation via the capacity element (e.g. $2^{arity}-1$); trees of different arity/height hash differently — confirm the separation rule before recomputing a root.",
      "Inputs are field elements, not bytes: negatives, decimals and out-of-field (≥ p) values are explicitly rejected by this op.",
      "The official circomlibjs vectors for t=7/t=17 (16 inputs) are not shipped as instance slots here (size trade-off); they can be added the same way if needed. t=2/3/5/6 cover all shipped official vectors.",
      "Sources: USENIX Security 2021 paper (ePrint 2021/458) Table 2 and §2/§4; the constant provenance chain = official IAIK Grain script (parameters recorded in circomlibjs source: 1 0 254 <t> 8 <RP>) + official circomlibjs test vectors + the HorizenLabs repository KAT."
    ],
    "aka": [
      "Poseidon",
      "Poseidon hash",
      "x5-Poseidon",
      "Poseidonπ",
      "Poseidon permutation",
      "HADES hash",
      "Hades permutation",
      "ZK hash",
      "zk-friendly hash",
      "arithmetic hash",
      "circomlib Poseidon",
      "snarkjs Poseidon",
      "BN254 Poseidon",
      "BLS12-381 Poseidon",
      "poseidonperm_x5_254_3",
      "ZK Merkle tree hash",
      "prime-field hash",
      "Poseidon 哈希",
      "零知识友好哈希",
      "Grain LFSR round constants"
    ]
  },
  "poseidon2": {
    "what": "Poseidon2 prime-field hash — the improved Poseidon (Grassi, Khovratovich, Rechberger, Roy, Schofnegger, CRYPTO 2023): the linear layer becomes a two-level design of an \"external matrix M_E\" plus a \"sparse internal matrix M_I\", cutting circuit constraints further while keeping security (partial rounds need only a sum for their linear layer). It is the default hash of newer proof systems (Plonky3 / RISC Zero / zkSync ecosystems). Also NOT SHA-3: it operates on prime-field elements of Z/p and shares nothing with the Keccak bit-sponge.",
    "principle": "**Three differences from the original Poseidon (paper §3)**:\n\n① **External full rounds** use a cheap circulant matrix $M_E$ (t=2: circ(2,1); t=3: circ(2,1,1); t=4: the cheap M4 matrix), applied once before the first round as well;\n② **Internal partial rounds** use a sparse matrix $M_I$ (diagonal plus all-ones, e.g. t=3 is [[2,1,1],[1,2,1],[1,1,3]]) — summing the state is enough for the linear layer;\n③ partial rounds add the round constant to state[0] only and S-box it (the original adds to the whole state).\n\n**Round structure**: $M_E$ → (full rounds: full-width ARK → $x^5$ → $M_E$) × R_F/2 → (partial rounds: state[0] ARK → $x^5$ → $M_I$) × R_P → (full rounds) × R_F/2.\n\n**Parameters (paper instance table / official repository, verbatim)**: BN254 t=3: d=5, R_F=8, R_P=56; BLS12-381 t=2/3/4: R_P=56. Same S-box rule as Poseidon: $\\gcd(5,p-1)=1$ → $x^5$.",
    "usage": "Parameters: instance slot (BN254 t=3 / BLS12-381 t=2/3/4 — constants from the paper authors' official repository reference implementation), input padding mode, input format (dec/hex), output (first element / full state), output format (decimal/hex).\n\nInput accepts 0..t field elements: the default \"tail zeros (compress-style)\" places elements from slot 1 and pads zeros at the tail; k=t means the official permutation verbatim (Merkle two-leaf compress = permutation([left,right,0]) taking the first element, as defined in the official repository). The \"leading initial state\" mode is also available. **One-way**.",
    "examples": [
      {
        "in": "0,1,2 (BN254 t=3, tail zeros = verbatim permutation)",
        "out": "0bb61d24daca55eebcb1929a82650f328134334da98ea4f847f760054f4a3033, 303b6f7c86d043bfcbcc80214f26a30277a15d3f74ca654992defe7ff8d03570, 1ed25194542b12eef8617361c3ba7c52e660b145994427cc86296242cf766ec8",
        "desc": "official reference KAT, full state (verbatim against the Rust test)"
      },
      {
        "in": "0,1 (BLS12-381 t=2, verbatim permutation)",
        "out": "73c46dd530e248a87b61d19e67fa1b4ed30fc3d09f16531fe189fb945a15ce4e, 1f0e305ee21c9366d5793b80251405032a3fee32b9dd0b5f4578262891b043b4",
        "desc": "official KAT (BLS12-381 t=2)"
      },
      {
        "in": "0,1,2,3 (BLS12-381 t=4, verbatim permutation)",
        "out": "28ff6c4edf9768c08ae26290487e93449cc8bc155fc2fad92a344adceb3ada6d, 0e56f2b6fad25075aa93560185b70e2b180ed7e269159c507c288b6747a0db2d, 6d8196f28da6006bb89b3df94600acdc03d0ba7c2b0f3f4409a54c1db6bf30d0, 07cfb49540ee456cce38b8a7d1a930a57ffc6660737f6589ef184c5e15334e36",
        "desc": "official KAT (BLS12-381 t=4)"
      }
    ],
    "formulas": [
      {
        "tex": "M_E^{(t=3)} = \\mathrm{circ}(2,1,1),\\quad M_I^{(t=3)} = \\begin{pmatrix}2&1&1\\\\1&2&1\\\\1&1&3\\end{pmatrix}",
        "caption": "External/internal linear layers (verbatim identical to the official MAT_INTERNAL instance constants)"
      },
      {
        "tex": "\\mathrm{Poseidon2}^{\\pi}_{R_F,R_P} = M_E \\circ (\\text{full rounds}) \\circ (\\text{partial rounds with } M_I)",
        "caption": "One M_E up front; full rounds ARK→x^5→M_E, partial rounds S-box state[0] only"
      },
      {
        "tex": "\\mathrm{compress}(a,b) = \\big[\\mathrm{Poseidon2}^{\\pi}([a,b,0])\\big]_0",
        "caption": "Merkle two-leaf compression = the official compress convention (this tool's tail-zeros mode)"
      }
    ],
    "tips": [
      "Recognition: challenges mentioning Poseidon2, Plonky3, RISC Zero or zkSync Era hashing, or the words \"external/internal rounds\".",
      "⚠ Constants are a completely different system from the original Poseidon: R_F=8, R_P=56 (BN254 t=3), but no round constant or MDS entry coincides with circomlib Poseidon — confirm the algorithm version before comparing values.",
      "The official BLS12-381 t=8 instance (R_P=57) and the small-field instances (Goldilocks/BabyBear) are not shipped here (size trade-off); they can be added the same way if needed.",
      "Poseidon2's official KATs are permutation-style: inputs are [0,1,…,t-1] verbatim. Hash-style padding (zero-pad/compress) is ecosystem-defined; this tool ships both and names the convention in each slot label.",
      "Output is still a field element (< p): decimal and hex outputs are interconvertible; don't mistake 32-byte big-endian hex for a different value than minimal hex.",
      "Unrelated to this tool's SHA-3/SHA-2 ops: Poseidon2 has no \"message padding\"; length semantics are the caller's (Merkle tree / compress) business.",
      "Sources: CRYPTO 2023 paper (ePrint 2023/323) plus the paper authors' official repository plain_implementations instances and KATs (BN254/BLS12-381 constants extracted verbatim; the round-constant derivation also cross-checked with the same Sage generation approach)."
    ],
    "aka": [
      "Poseidon2",
      "Poseidon2 hash",
      "Poseidon2 permutation",
      "x5-Poseidon2",
      "Poseidon 2",
      "poseidon2 vs poseidon",
      "external internal rounds",
      "M_E M_I matrices",
      "HorizenLabs Poseidon2",
      "BN254 Poseidon2",
      "BLS12-381 Poseidon2",
      "zk-friendly hash",
      "ZK hash",
      "零知识哈希",
      "ZK Merkle tree hash",
      "Poseidon successor",
      "Grassì Poseidon2",
      "prime-field hash",
      "HADES Poseidon2",
      "Poseidon2 哈希"
    ]
  },
  "kzgVerify": {
    "what": "Opening verification for KZG polynomial commitments (EIP-4844 semantics) — given a commitment C (48-byte compressed group element), evaluation point z, claimed value y and proof π, one bilinear pairing identity decides whether \"the polynomial bound by the commitment really evaluates to y at z\". BLS12-381, pairing from the in-repo noble implementation, trusted-setup G2 points are Ethereum mainnet public constants. KZG underlies zk-rollups and danksharding; in CTFs it appears in EIP-4844 blob forensics and zk challenges.",
    "principle": "**Commitment**: a polynomial f(X) of degree < 4096 is committed to C = f(s)·G1, where s is the secret of the trusted-setup ceremony (destroyed after the ceremony; only the group elements are public — nobody knows s).\n\n**Proof**: to prove p(z) = y, publish the commitment of the quotient polynomial q(X) = (f(X) − y)/(X − z) (exact division since f(z) = y), i.e. π = q(s)·G1.\n\n**Verification identity** (bilinearity turns the polynomial divisibility into a group equation):\n\n$e(C - y\\cdot G_1,\\ [1]_2) = e(\\pi,\\ [s]_2 - z\\cdot [1]_2)$\n\nLHS = e((f(s) − y)·G1, G2) = e(G1,G2)^((s−z)q(s)); RHS = e(q(s)·G1, (s − z)·G2) = e(G1,G2)^(q(s)(s−z)). The two sides match iff f(s) − y = (s − z)·q(s), and the Schwartz–Zippel lemma guarantees this can only come from a genuine polynomial relation when s is unknown. The verifier **never needs the polynomial** — just 4 arguments and one pairing.\n\n**Point-at-infinity semantics**: when f is a constant (or zero) polynomial the quotient is identically zero and π is the point at infinity; then e(O, X) = 1 and verification treats it as the GT identity — the official vectors (c-kzg-4844) deliberately include such \"valid proof = infinity\" cases, so implementations must special-case it instead of erroring.\n\n**Difference from Pedersen/Feldman commitments** (the most important section of this card):\n① **Pedersen commitment** = Σmᵢ·Gᵢ (message linear in group elements): perfectly hiding and homomorphic (additive), but **commit-only** — no pairing, so no \"open at an evaluation point\" style verification; you can only reveal the full message preimage.\n② **Feldman commitment** = Σaⱼ·Gʲ (coefficients on powers of a fixed generator): can **reveal individual coefficients** for verification (used in VSS), but can only verify coefficients themselves, cannot open at an arbitrary point, and the commitment grows linearly with the polynomial degree.\n③ **KZG commitment**: **constant 48-byte** commitment regardless of degree, pairing gives **opening at any point** (one pairing verifies the value at any z), plus aggregate proofs and data-availability sampling. The price: **it requires a trusted setup** (the ceremony output s), which Pedersen/Feldman do not.\nOne-liner: Pedersen hides, Feldman verifies coefficients, KZG opens at any point with constant size; none of the three is encryption.",
    "usage": "Two modes:\n① **Manual quadruple**: fill commitment (0x+96 hex), z (0x+64 hex), y (0x+64 hex), proof (0x+96 hex) in the parameters; output PASS/FAIL. z/y must be 32-byte field elements strictly below the curve order r; C/π must be on-curve and in the r-order subgroup (infinity allowed, encoding 0xc000…00).\n② **Blob sidecar**: paste the full blob hex (131072 bytes = 262144 hex chars) as the main input, fill commitment and proof in the parameters; z/y are derived automatically via Fiat-Shamir (domain tag FSBLOBVERIFY_V1_, SHA-256 then big-endian integer mod r) — exactly the EIP-4844 verify_blob_kzg_proof semantics.\n\nVerdicts: PASS means the pairing identity holds (data/commitment/proof are self-consistent); FAIL means at least one item was altered or mismatched; invalid input (length/characters/out-of-range/not a group element) raises an explicit reason, never silent. One verification takes tens of milliseconds (two pairings).",
    "examples": [
      {
        "in": "(manual) commitment=0xa421e229…bb94d9d06, z=0x000…000, y=0x50625ad8…6367c359, proof=0xb72d8039…c9d2f400b",
        "out": "Verdict: PASS (pairing identity holds)",
        "desc": "c-kzg-4844 official vector verify_kzg_proof_case_correct_proof_2_0"
      },
      {
        "in": "(blob mode) main input = full 131072-byte blob, commitment=0xc000…00, proof=0xc000…00",
        "out": "Verdict: PASS; Fiat-Shamir z = 0x04b7b22a…56096",
        "desc": "official blob vector: zero blob + infinity commitment/proof (z is exactly this value)"
      },
      {
        "in": "(manual) flip one hex character 0→1 in the middle of proof",
        "out": "Verdict: FAIL (pairing identity does not hold)",
        "desc": "tamper surface: any altered field yields FAIL"
      }
    ],
    "formulas": [
      {
        "tex": "C = f(s)\\cdot G_1,\\quad \\pi = \\left(\\frac{f(X)-y}{X-z}\\right)(s)\\cdot G_1",
        "caption": "commitment and quotient-polynomial proof; s is the destroyed ceremony secret"
      },
      {
        "tex": "e(C - y\\cdot G_1,\\ [1]_2) = e(\\pi,\\ [s]_2 - z\\cdot [1]_2)",
        "caption": "verification identity (bilinear pairing, one check)"
      },
      {
        "tex": "z = \\mathrm{int}_{be}(\\mathrm{SHA\\text{-}256}(\\text{“FSBLOBVERIFY\\_V1\\_”}\\|0^8\\|\\mathrm{uint64be}(4096)\\|\\mathrm{blob}\\|C))\\ \\mathrm{mod}\\ r",
        "caption": "Fiat-Shamir evaluation point for blob mode (c-kzg compute_challenge)"
      }
    ],
    "tips": [
      "Spot it: a challenge handing you a 48-byte \"commitment\" + 48-byte \"proof\" + 32-byte z/y, or mentioning EIP-4844, blobs, danksharding, proto-danksharding, verifyKzgProof — that is KZG.",
      "Do not confuse with BLS signatures: same BLS12-381 curve, but BLS signature verification is e(G1,σ) = e(pk,H(m)) (signature vs hash) while KZG is e(C−yG1,[1]₂) = e(π,[s]₂−z[1]₂) (commitment vs quotient) — the parameter shapes are entirely different.",
      "48 bytes = compressed G1 point (0xa4/0xb7/0xc0… prefix); 96 bytes = compressed G2. KZG commitments/proofs are 48 bytes; BLS signatures are the 96-byte ones.",
      "0xc000…00 (48 bytes all zero except the first) is the point at infinity and a legal input; \"infinity proof + infinity commitment ⇒ PASS\" is official semantics, not a bug.",
      "z/y at or above the curve order r (e.g. starting with ff bytes) are not canonical field elements — the implementation rejects them explicitly, never reducing mod r silently.",
      "A versioned hash (32 bytes starting 0x01) is only the SHA-256 truncation fingerprint of the commitment; a 32-byte 0x01-prefixed hash tied to an EIP-4844 transaction is a blob versioned hash.",
      "Pedersen/Feldman/KZG in one line: Pedersen hides the message, Feldman verifies coefficients, KZG opens at any point with a constant 48-byte commitment but needs a trusted setup; none of them is encryption.",
      "Sources: EIP-4844 (blob transactions and versioned hash), the Ethereum consensus spec polynomial-commitments (KZG interface), c-kzg-4844 v2.1.8 (reference implementation and all test vectors — this tool replays 122+29 cases byte-for-byte)."
    ],
    "aka": [
      "KZG",
      "KZG 验证",
      "KZG proof verify",
      "verifyKzgProof",
      "verify_kzg_proof",
      "verifyBlobKzgProof",
      "KZG commitment verify",
      "KZG 承诺验证",
      "KZG 多项式承诺",
      "polynomial commitment",
      "EIP-4844",
      "EIP-4844 blob",
      "proto-danksharding",
      "danksharding",
      "blob proof",
      "Kate-Zaverucha-Goldberg",
      "KZG opening",
      "KZG pairing check",
      "blob_kzg_proof",
      "KZG opening verification"
    ]
  },
  "kzgCommit": {
    "what": "Computes the KZG commitment and versioned hash from an EIP-4844 blob. A blob is 131072 bytes = 4096 32-byte BLS12-381 field elements (a polynomial in evaluation form); the commitment is the linear combination of the evaluation vector against the mainnet trusted-setup G1 Lagrange points, always 48 bytes; the versioned hash is 0x01 ‖ SHA-256(commitment)[1..31] — exactly the 32 bytes listed in a type-3 transaction's blob_versioned_hashes. Optionally also generates the opening proof and self-verifies.",
    "principle": "**Polynomial semantics of a blob**: the i-th 32-byte chunk of the blob is the value of f at the i-th root of the order-4096 multiplicative subgroup. Note the index is in **12-bit bit-reversal order** (the FFT-friendly brp ordering of c-kzg) — interpreting the same blob in natural order yields a completely different polynomial and a wrong commitment (the easiest trap here, provable with the official vectors).\n\n**Commitment = linear combination in the Lagrange domain**: C = Σᵢ f(ωᵢ)·[Lᵢ(τ)]·G1 where [Lᵢ(τ)]·G1 is the i-th trusted-setup G1 point (Lagrange form). No coefficient conversion (IFFT) needed — one pass of 4096 scalar multiplications; this tool accelerates it with the Pippenger bucket method, ~0.3–0.5 s per blob.\n\n**Versioned hash**: $\\mathrm{vh} = \\texttt{0x01} \\| \\mathrm{SHA\\text{-}256}(C)[1..31]$ — the version byte 0x01 marks KZG (currently the only defined version in EIP-4844), the remaining 31 bytes truncate the commitment hash. Transactions carry only the versioned hash; the execution layer uses it to index blobs, the consensus layer verifies commitment and proof.\n\n**Opening proof (optional output)**: z is derived Fiat-Shamir style from (blob, C); y = f(z) is computed directly in evaluation form by barycentric interpolation (no coefficients needed); the quotient evaluations q(ωᵢ) = (f(ωᵢ) − y)/(ωᵢ − z) are combined once more into π — entirely in the Lagrange domain, byte-identical to c-kzg compute_blob_kzg_proof (including the L'Hôpital branch when z lands inside the evaluation domain).\n\n**Not encryption**: the commitment is a many-to-one group-element binding — neither C nor the versioned hash reveals the blob; it only proves \"some polynomial exists and is bound\". Hiding comes from the polynomial's uncertainty, not from a key.",
    "usage": "Paste the blob hex (131072 bytes, 0x allowed, whitespace/newline tolerated) as the main input. Every 32-byte chunk must be a canonical field element strictly below the curve order r; out-of-range chunks raise an explicit error (same as c-kzg blob_to_polynomial).\n\nOutput: commitment (0x + 96 hex) + versioned hash (0x + 64 hex) + timing. Ticking \"also generate the opening proof and self-verify\" appends proof/z/y and performs one pairing self-check (about twice the time).\n\nOn-chain cross-check: take a 32-byte entry of the transaction's blob_versioned_hashes and compare byte-for-byte with the versioned hash computed locally from the blob — equality proves the blob was not tampered with.",
    "examples": [
      {
        "in": "(the full 131072-byte blob of blob_to_kzg_commitment_case_valid_blob_2)",
        "out": "commitment: 0xa421e229…bb94d9d06; versioned hash: 0x014edfed…e2567f1",
        "desc": "byte-exact against the c-kzg-4844 official vector; vh = 0x01 + SHA-256(C)[1..31]"
      },
      {
        "in": "same blob with \"generate proof and self-verify\" ticked",
        "out": "proof: 0xa2aeea08…4470b65c8; z: 0x4f00eef9…3bfbb31a; self-check PASS",
        "desc": "the compute_blob_kzg_proof Fiat-Shamir chain"
      },
      {
        "in": "change one 32-byte chunk to all ff (≥ r)",
        "out": "error: chunk N is not a canonical field element (≥ r)",
        "desc": "same verdict as the official invalid_blob vectors: explicit rejection, never silent"
      }
    ],
    "formulas": [
      {
        "tex": "C = \\sum_{i=0}^{4095} f(\\omega^{\\mathrm{rev}_{12}(i)})\\cdot [L_i(\\tau)]\\cdot G_1",
        "caption": "commitment = linear combination of evaluations (bit-reversed domain order) with the Lagrange trusted setup"
      },
      {
        "tex": "\\mathrm{vh} = \\texttt{0x01}\\,\\|\\,\\mathrm{SHA\\text{-}256}(C)[1..31]",
        "caption": "versioned hash (VERSIONED_HASH_VERSION_KZG = 0x01)"
      },
      {
        "tex": "y = \\frac{z^{4096}-1}{4096}\\sum_i \\frac{\\omega^{\\mathrm{rev}_{12}(i)}\\cdot f(\\omega^{\\mathrm{rev}_{12}(i)})}{z-\\omega^{\\mathrm{rev}_{12}(i)}}",
        "caption": "barycentric evaluation in evaluation form (no IFFT)"
      }
    ],
    "tips": [
      "Spot it: a 131072-byte (262144 hex chars) blob of hex, or wording like \"blob sidecar / blob data\" asking for the commitment or versioned hash — use this.",
      "The blob length is always 131072 bytes (4096×32B, FIELD_ELEMENTS_PER_BLOB); even one byte off is not a blob — check length first, then field-element canonicality.",
      "Domain-order trap: blob indices are bit-reversed (brp), not natural — the wrong order yields a commitment that mismatches on-chain values with no error at all; always validate implementations against official vectors.",
      "The versioned hash hashes the 48-byte commitment only, not the blob — compute the commitment first, then hash; the order cannot be swapped.",
      "Cross-check: the generated proof must pass \"KZG proof verification\" (blob mode); the two ops validate each other.",
      "Performance: one commitment ≈ 0.3–0.5 s (4096-point Pippenger MSM); proof generation adds one more equivalent pass; verification takes only tens of milliseconds.",
      "Pedersen/Feldman contrast: a KZG commitment is a constant 48 bytes and opens at any point via pairing; Pedersen cannot open, Feldman only verifies coefficients and grows linearly with degree; KZG needs a trusted setup, the other two do not.",
      "Sources: EIP-4844 (blob structure and versioned hash), c-kzg-4844 v2.1.8 (blob_to_kzg_commitment/compute_blob_kzg_proof reference, 11+15 cases replayed byte-for-byte), the Ethereum mainnet trusted setup (public output of the KZG ceremony)."
    ],
    "aka": [
      "KZG commitment",
      "blob_to_kzg_commitment",
      "KZG blob 承诺",
      "blob commitment",
      "versioned hash",
      "blob versioned hash",
      "blobVersionedHash",
      "VERSIONED_HASH_VERSION_KZG",
      "EIP-4844 blob",
      "KZG 承诺计算",
      "blob 承诺",
      "KZG commit",
      "4844 blob",
      "proto-danksharding blob",
      "blob sidecar",
      "KZG linear combination",
      "Lagrange commitment",
      "danksharding blob",
      "blob hash",
      "type-3 transaction"
    ]
  },
  "kzgBlobParse": {
    "what": "Structural parsing and display of EIP-4844-related fields: identifies and decomposes a blob (131072 bytes = 4096 32-byte field elements), the blob_versioned_hashes list of a type-3 transaction (32-byte versioned hashes starting with the 0x01 version byte), or a single 48-byte KZG commitment. Read-only parsing — no computation (use the other two ops for commitments/verification).",
    "principle": "**Three data shapes in EIP-4844** (this op identifies each):\n① **Blob body**: always 131072 bytes, split into 4096 BLS12-381 scalar field elements of 32 bytes each; every element must be strictly below the curve order r (0x73eda753…00000001) — an out-of-range element makes the sidecar invalid. Displayed: element count, canonicality check, zero-element count, first/last element samples.\n② **Versioned hash**: 32 bytes = version byte + 31-byte payload. Version byte 0x01 = KZG (currently the only defined version), payload = SHA-256(commitment) bytes 1..31; other version bytes are honestly labeled \"unknown\", never disguised as a known structure. Displayed: version verdict, payload, first-4-byte view (version byte + first 3 payload bytes).\n③ **KZG commitment**: a 48-byte compressed G1 point (0xc0 prefix = point at infinity). Displayed: curve/subgroup check verdict.\n\n**How they relate**: blob --(KZG commitment)--> 48B commitment --(0x01 + SHA-256 truncation)--> 32B versioned hash; a type-3 transaction's blobs array and blob_versioned_hashes array correspond one-to-one in order. The versioned hash is a one-way fingerprint of the commitment — **not invertible**: you cannot recover the blob or the commitment from a versioned hash.",
    "usage": "The main input is one of three (auto-detected):\n① a blob (262144 hex chars) → field-element structure and canonicality check;\n② one or more 32-byte hashes (64 hex each, whitespace/newline separated) → per-hash version verdict and payload;\n③ one 48-byte point (96 hex) → commitment-form check.\nAnything else raises an explicit error listing the three accepted shapes. Pure parsing finishes in milliseconds and never loads the trusted setup.",
    "examples": [
      {
        "in": "014edfed8547661f6cb416eba53061a2f6dce872c0497e6dd485a876fe2567f1 02abab…ab (two 32-byte values)",
        "out": "#1 version byte 0x01 → KZG, payload=SHA-256(C)[1..31]; #2 version byte 0x02 → unknown version (honestly labeled)",
        "desc": "per-entry verdict of a type-3 transaction's blob_versioned_hashes list"
      },
      {
        "in": "(a 131072-byte blob hex)",
        "out": "identified: blob; 4096 field elements; all canonical / first out-of-range index; zero-element count; first/last elements",
        "desc": "sidecar data structure view"
      },
      {
        "in": "a421e229…bb94d9d06 (48 bytes)",
        "out": "identified: 48-byte compressed G1 point = KZG commitment form (on curve, in r-order subgroup)",
        "desc": "commitment-form check"
      }
    ],
    "formulas": [
      {
        "tex": "\\mathrm{vh} = \\texttt{0x01}\\,\\|\\,\\mathrm{SHA\\text{-}256}(C)[1..31]\\quad(\\text{version byte} = 1\\ \\text{byte})",
        "caption": "byte layout of a versioned hash (first-4-byte view = version + first 3 payload bytes)"
      },
      {
        "tex": "\\mathrm{blob} = \\underbrace{b_0\\|b_1\\|\\cdots\\|b_{4095}}_{4096\\times 32\\mathrm{B}},\\quad b_i < r",
        "caption": "field-element split of a blob and its canonicality condition"
      }
    ],
    "tips": [
      "Spot it: an EIP-4844 transaction (type 0x03) whose blob fields you want to inspect, or 131072 bytes of hex of unknown type — feed it here first.",
      "Length triage: 64 hex = versioned hash; 96 hex = commitment; 262144 hex = blob; anything else lands in the error message listing the three shapes.",
      "A 32-byte value starting with 0x01 is a KZG versioned hash; any other leading byte is honestly labeled an unknown version — never force the SHA-256-truncation semantics onto it.",
      "A versioned hash is not a hash of the blob: it truncates 31 bytes (248 bits) and hashes the commitment — you must compute the commitment first to obtain the versioned hash.",
      "Blobs with out-of-range field elements (≥ r) are rejected outright by c-kzg — the parser marks the first offending index so you can locate the tampered bytes.",
      "Use together with \"KZG blob commitment\" and \"KZG proof verification\": this op only inspects structure; the other two compute and verify.",
      "Sources: EIP-4844 (blob transaction structure, versioned hash definition), c-kzg-4844 v2.1.8 (blob field-element canonicality rules)."
    ],
    "aka": [
      "EIP-4844 blob 解析",
      "blob parse",
      "blob 字段解析",
      "blobVersionedHash 解析",
      "versioned hash parse",
      "blob_versioned_hashes",
      "type-3 交易",
      "blob transaction",
      "KZG 承诺解析",
      "blob structure",
      "4844 blob structure",
      "blob sidecar 解析",
      "版本哈希解析",
      "KZG blob fields",
      "blob hex 识别",
      "BLS12-381 域元素",
      "blob domain",
      "blob structure viewer",
      "proto-danksharding 解析",
      "blob forensics"
    ]
  },
  "sshKeyParse": {
    "what": "OpenSSH private key parsing — turns `-----BEGIN OPENSSH PRIVATE KEY-----` (the openssh-key-v1 container, ssh-keygen's default private key format) into a structure report, the SHA256 fingerprint, the authorized_keys public line, and standard PKCS#8/SPKI PEM files. Supports passphrase decryption (bcrypt KDF + AES-256-CTR/CBC) and the unencrypted case, for ssh-ed25519, ssh-rsa and ecdsa-sha2-nistp256/384/521 keys. The first stop when a forensics challenge hands you an id_ed25519/id_rsa file (possibly encrypted).",
    "principle": "**Container format (OpenSSH PROTOCOL.key)**: after the 15-byte `openssh-key-v1\\0` magic come SSH wire fields: `string ciphername`, `string kdfname`, `string kdfoptions`, `uint32 N`, `string pubkey×N`, `string encrypted, padded list of private keys`. Once decrypted, the private list is `uint32 checkint ×2` + per-key wire fields + `string comment` + 1,2,3,… padding; equal checkints mean the passphrase was right (a fast check).\n\n**KDF = bcrypt_pbkdf (OpenSSH openbsd-compat/bcrypt_pbkdf.c)**: password and salt are pre-hashed with SHA-512; each 32-byte output block is the XOR accumulation of $r$ bcrypt_hash rounds, then the bytes are scattered with a stride (unlike PBKDF2's linear output, preventing \"compute one block, assemble a subkey\"); the bcrypt_hash magic text is `OxychromaticBlowfishSwatDynamite` (note: different from bcrypt's own OrpheanBeholderScryDoubt), and the EksBlowfish expand0 order is salt-then-password. The 48 derived bytes = 32B AES-256 key + 16B IV.\n\n**PEM export**: Ed25519 → PKCS#8 (RFC 5958, curve OID 1.3.101.112); RSA → PKCS#8 wrapping PKCS#1 (RFC 8017 A.1.2, dP/dQ computed as d mod p−1/q−1, qInv taken from the container's iqmp); ECDSA → both PKCS#8 and legacy SEC 1 v2; public keys → SPKI. Fingerprint = `SHA256:` + base64(SHA-256(public key blob)) (RFC 4716/FIDO convention, matches `ssh-keygen -l`).",
    "usage": "Input: the whole key file (with BEGIN/END markers) or bare base64. Parameter: passphrase (only for encrypted keys; empty only supports unencrypted).\n\nOutput: cipher/kdf/rounds/salt structure, each key's type/SHA256 fingerprint/comment, Ed25519 seed and public key hex, RSA n/e/d/p/q/dP/dQ/qInv, ECDSA curve/d/public point, the authorized line; buttons below download the private PKCS#8 PEM and the public SPKI PEM (EC also gets SEC1).\n\nUse cases: CTF forensics key recovery, converting OpenSSH keys into openssl/node-usable PEM, verifying fingerprints and comments. **Passphrase and key material stay in local memory; nothing is uploaded**.",
    "examples": [
      {
        "in": "-----BEGIN OPENSSH PRIVATE KEY----- (unencrypted ed25519, comment \"plain\")",
        "out": "Type = ssh-ed25519; Fingerprint = SHA256:R1CGvcz/GxYBpA90zfnu+1QcwyrneCPN6wgzofQcl9E; seed (32B hex) = 2deebd0c6da224edd4c5dbd37533960ad5abad96d0da5199204fb06ccc26ee27; public = ae4947c08c13b654a9fb1b72dea39feec37ec8e6812cc4f4b0cdfc6ea5f95971 (excerpt)",
        "desc": "Real run: structure + fingerprint + seed/pubkey hex; PEM via download buttons"
      },
      {
        "in": "aes256-ctr + bcrypt KDF (rounds=16) encrypted ed25519, passphrase ctp4ss",
        "out": "Decrypted, checkints match, seed/pub/PEM as above; a wrong passphrase reports \"checkint mismatch (wrong passphrase or corrupted ciphertext)\"",
        "desc": "Encrypted case: correct passphrase decrypts; wrong one errors out explicitly"
      },
      {
        "in": "Encrypted RSA 2048 (passphrase rsapass)",
        "out": "Type = ssh-rsa; full n/p/q/d/iqmp fields with p·q=n, e·d≡1 mod φ, iqmp=q⁻¹ mod p self-checks passing; PKCS#8 PEM accepted by openssl pkey",
        "desc": "RSA case: six mpint fields (n,e,d,iqmp,p,q) parsed with math self-checks"
      }
    ],
    "formulas": [
      {
        "tex": "km = \\mathrm{bcrypt\\text{-}pbkdf}(\\mathrm{pass},\\mathrm{salt},48,r),\\quad key=km_{[0..32)},\\; iv=km_{[32..48)}",
        "caption": "bcrypt KDF derives the AES-256-CTR/CBC key and IV (PROTOCOL.key §4)"
      },
      {
        "tex": "out_i = \\bigoplus_{j=1}^{r} \\mathrm{bcrypt\\text{-}hash}(\\mathrm{SHA512}(\\mathrm{pass}),\\, \\mathrm{SHA512}(\\cdot))",
        "caption": "Each 32B block is r bcrypt_hash rounds XORed, scattered by stride"
      },
      {
        "tex": "d_P = d \\bmod (p-1),\\quad d_Q = d \\bmod (q-1),\\quad q_{inv} = q^{-1} \\bmod p",
        "caption": "RSA CRT parameters: the container stores only iqmp; dP/dQ are computed on the fly (RFC 8017 A.1.2)"
      }
    ],
    "tips": [
      "Spotting it: forensics challenges with an id_rsa/id_ed25519 attachment where `ssh-keygen -y -f key` demands a passphrase → this op; challenges giving a `SHA256:xxx` fingerprint to match → compare the fingerprint line directly.",
      "Encrypted keys only accept `kdfname=bcrypt`; ciphers supported are aes256-ctr / aes256-cbc / none. Legacy PEM (`BEGIN RSA PRIVATE KEY` + Proc-Type header) is NOT an openssh-key-v1 container — use the PEM/JWK ops instead.",
      "A wrong passphrase shows up as a checkint mismatch or invalid padding — this op errors out explicitly instead of dumping garbage PEM.",
      "The openssh-key-v1 private section is inline wire fields (string type + parameters + string comment), not a length-prefixed blob — a classic pitfall for hand parsers.",
      "bcrypt_pbkdf ≠ the bcrypt password hash: the former is a KDF (arbitrary-length keystream, magic OxychromaticBlowfishSwatDynamite); the latter's magic is OrpheanBeholderScryDoubt with a fixed 23-byte output. They are not interchangeable.",
      "The Ed25519 seed and public key are mutually derivable (public = base-point scalar multiplication of seed); this op cross-checks against the container's public key. X25519-style private keys are not part of the OpenSSH user-key system.",
      "Sources: OpenSSH PROTOCOL.key (v1.4 2024-03-30), openbsd-compat/bcrypt_pbkdf.c (v1.17 2022-12-27), RFC 4251/4253 (wire format), RFC 5958/8017/SEC1 v2 (PEM export), RFC 4716 (fingerprint)."
    ],
    "aka": [
      "OpenSSH private key parse",
      "openssh-key-v1",
      "OpenSSH 私钥解析",
      "ssh-keygen private key",
      "BEGIN OPENSSH PRIVATE KEY",
      "id_ed25519 parser",
      "id_rsa parser",
      "SSH key decrypt",
      "OpenSSH key decrypt",
      "bcrypt KDF",
      "bcrypt_pbkdf",
      "aes256-ctr ssh key",
      "SSH key to PEM",
      "OpenSSH to PKCS#8",
      "ssh key fingerprint",
      "SHA256 fingerprint",
      "authorized_keys line",
      "SSH private key converter",
      "OpenSSH container parse"
    ]
  },
  "pkcs12Parse": {
    "what": "PKCS#12 / PFX container parsing (RFC 7292) — .p12/.pfx is the password-protected bundle for \"certificates + private keys + attributes\" (browser/Windows certificate import-export; a common CTF forensics attachment). This op lists the container tree, verifies the macData integrity MAC, decrypts encryptedData and encrypted key bags with the passphrase, and exports certificates and keys as standard PEM. No certificate chain validation.",
    "principle": "**Structure (RFC 7292 §4)**: `PFX ::= SEQ{ version=3, authSafe ContentInfo, macData optional }`. The authSafe (data type) embeds a DER AuthenticatedSafe = a list of ContentInfos, each either plaintext data (SafeContents) or encryptedData (password-encrypted SafeContents). SafeContents is a list of SafeBags: keyBag (plaintext PKCS#8 key), pkcs8ShroudedKeyBag (encrypted PKCS#8), certBag (embedding the X.509 certificate DER); attributes carry friendlyName (BMPString) and localKeyID (pairs a certificate with its key).\n\n**Password KDF (RFC 7292 Appendix B)**: the password becomes a BMPString (UTF-16BE + 0x0000 terminator; empty password = terminator only — verified against OpenSSL); `D` = the ID byte repeated (1=key/2=IV/3=MAC), salt and password are each cycled to multiples of 64 bytes and concatenated into I; each output block is $A = H^r(D\\|I)$, then stirred via $I_j = (I_j + B + 1) \\bmod 2^v$. SHA-1 uses u=20/v=64, SHA-256 u=32/v=64.\n\n**Algorithm coverage**: legacy pbeWithSHAAnd{3-Key,2-Key}TripleDES-CBC and pbeWithSHAAnd{128,40}BitRC2-CBC (RC2 fully implemented per RFC 2268, including the 40-bit effective key); modern PBES2 = PBKDF2 (PRF HMAC-SHA1/224/256/384/512) + AES-128/192/256-CBC or 3DES — note that **inside PKCS#12 the PBES2 password uses the raw UTF-8 bytes, not the BMPString** (RFC 8018 semantics, verified against OpenSSL). The MAC key comes from the ID=3 KDF and the HMAC runs over the authSafe content bytes.",
    "usage": "Input: the .p12/.pfx file's base64 (or hex). Parameter: passphrase (empty tries the empty password — many CTF attachments use one).\n\nOutput: version/structure tree, macData algorithm/iterations/verification result, each bag's type and attributes (name, localKeyID), certificate version/serial/subject/issuer/validity, key algorithm; buttons download certificate PEM (CERTIFICATE) and key PEM (PRIVATE KEY).\n\nUse cases: forensics challenges handing out a .p12 and asking for the key/cert, splitting a PFX into openssl-consumable PEMs, checking whether a passphrase is right (MAC pass = correct). **Passphrase stays local; zero exfiltration**.",
    "examples": [
      {
        "in": "a .p12 generated by openssl pkcs12 -export with defaults, passphrase secret123",
        "out": "macData: SHA256, 2048 iterations → MAC: ✓ pass; content 1 (encryptedData, PBES2 (PBKDF2-HMAC-SHA256 ×2048 + aes-256-cbc)) decrypted: certBag X.509 v3 serial… subject CN=…; content 2 (data, plaintext) → pkcs8ShroudedKeyBag decrypted, rsaEncryption (excerpt)",
        "desc": "OpenSSL 3 default shape: PBES2+AES outer + plaintext SafeContents inner"
      },
      {
        "in": "a legacy .p12 with -keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-RC2-40 -macalg sha1",
        "out": "macData: sha1, 2048 iterations → ✓ pass; encryptedData pbeWithSHAAnd3-KeyTripleDES-CBC (×2048) decrypted; certBag pbeWithSHAAnd40BitRC2-CBC decrypted",
        "desc": "Full legacy PBE coverage (3DES/RC2-40 implemented here; RC2 passes all 8 RFC 2268 official vectors)"
      },
      {
        "in": "the same .p12 with a wrong passphrase",
        "out": "MAC: ✗ mismatch (wrong passphrase or tampered data) plus \"decryption failed: invalid padding\" for each encrypted section — two clues both pointing at the passphrase",
        "desc": "Wrong passphrase is reported inside the report — no crash, no silence"
      }
    ],
    "formulas": [
      {
        "tex": "I_j = (I_j + B + 1) \\bmod 2^{v},\\quad B = A \\text{ repeated to } v \\text{ bytes}",
        "caption": "The feedback-stirring step of RFC 7292 B.2 (what distinguishes it from PBKDF2)"
      },
      {
        "tex": "pass \\to \\mathrm{BMPString}: \\sum 2\\text{-byte UTF-16BE} \\,\\|\\, 0x0000",
        "caption": "Password encoding: legacy PBE/MAC use BMPString; PBES2 uses raw UTF-8 bytes"
      },
      {
        "tex": "T8 = \\lceil T_1/8 \\rceil,\\quad TM = 255 \\bmod 2^{8 + T_1 - 8 T_8}",
        "caption": "RC2 effective-key-bits mask (RFC 2268 §2; the 40-bit tier relies on it)"
      }
    ],
    "tips": [
      "Spotting it: a .p12/.pfx attachment with \"unknown/weak passphrase\" → try the empty password first; MAC ✓ means the passphrase is right; ✗ with intact structure → feed the algorithm/iteration info from this report to cracking tools (p12crack-style).",
      "MAC pass only means the passphrase matches macData; some files use a different password for encryption (rare) — check each bag's own \"decrypted/failed\" line.",
      "friendlyName is BMPString (UTF-16BE), not UTF-8 — grepping the raw bytes for a Chinese certificate name fails; this op decodes it properly.",
      "PBES2's PBKDF2 often omits keyLen (OpenSSL does); the key length then follows the encryption scheme (AES-256→32B, 3DES→24B). Don't get stuck here when hand-parsing.",
      "Inside PKCS#12 the PBES2 password is raw UTF-8 while legacy PBE/MAC use BMPString — two encodings for one password is spec behavior, not a bug.",
      "This op parses and displays only; it does not validate certificate chains or signatures — use openssl verify for that. Exported keys are unencrypted PKCS#8 PEM; handle with care.",
      "Sources: RFC 7292 (PKCS#12 v1.1), RFC 8018 (PBES2/PBKDF2), RFC 2268 (RC2, incl. all 8 official test vectors), RFC 5958 (PKCS#8)."
    ],
    "aka": [
      "PKCS#12",
      "PKCS12",
      "PFX",
      ".p12",
      ".pfx parser",
      "PKCS#12 decrypt",
      "PKCS12 password",
      "PKCS#12 to PEM",
      "pbeWithSHAAnd3-KeyTripleDES-CBC",
      "pbeWithSHAAnd40BitRC2-CBC",
      "PBES2",
      "PKCS#12 MAC",
      "certBag",
      "pkcs8ShroudedKeyBag",
      "keyBag",
      "PKCS#12 KDF",
      "RFC 7292",
      "certificate bundle parse",
      "PFX passphrase"
    ]
  },
  "jwkOkpImport": {
    "what": "JWK OKP import — converts an RFC 8037 OKP (Octet Key Pair) JWK JSON (Ed25519/X25519) into the hex and standard PEM this toolbox uses: public key → SPKI (PUBLIC KEY), private key → PKCS#8 (PRIVATE KEY). Ed25519 keys are consistency-checked by recomputing the public key from the private seed. The entry point when a JWT (EdDSA) or modern-protocol challenge hands you a {\"kty\":\"OKP\",...} object.",
    "principle": "**JWK fields (RFC 7517/8037 §2)**: `kty:\"OKP\"`, `crv:\"Ed25519\"|\"X25519\"`, `x` = the 32-byte public key in unpadded base64url (RFC 7515 §3.2), `d` = the 32-byte private key in base64url (for Ed25519, d is the 32-byte seed).\n\n**PEM mapping (RFC 8410/5958)**: Ed25519 curve OID = 1.3.101.112, X25519 = 1.3.101.110; PKCS#8 = `SEQ{INTEGER 0, SEQ{OID}, OCTET STRING(OCTET STRING(seed))}` (the extra OCTET STRING wrapping the private key is RFC 5958's CurvePrivateKey rule — hand-written encoders often miss it); SPKI = `SEQ{SEQ{OID}, BIT STRING(0x00‖pub)}`.\n\n**Consistency check**: the Ed25519 public key = base-point scalar multiplication of the clamped SHA-512(seed) — recomputed here and compared with x; a mismatched pair errors out. X25519 has no separate \"verify public from private\" signature semantic (public = X25519(d, 9); RFC 8037 §4 does not require the check), so structural checks are applied and stated honestly.",
    "usage": "Input: JWK JSON (kty OKP). x is required (32 bytes), d optional (32 bytes).\n\nOutput: x/d in hex, the consistency-check result; buttons download the public SPKI PEM and (when d is present) the private PKCS#8 PEM.\n\nUse cases: JWT EdDSA challenges that give a JWK private key for signing, modern-protocol X25519 JWKs needing conversion before ECDH, turning OKP JSON from a web page or config into openssl-usable formats. Key material stays local; zero exfiltration.",
    "examples": [
      {
        "in": "{\"kty\":\"OKP\",\"crv\":\"Ed25519\",\"d\":\"nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A\",\"x\":\"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo\"}",
        "out": "d (private 32B hex) = 9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60; x (public 32B hex) = d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a; check: publicKey(d) ✓ equals x",
        "desc": "RFC 8037 §A.3 official vector, field-by-field match"
      },
      {
        "in": "same but with one bit of d changed",
        "out": "explicit error \"Ed25519 consistency check failed: publicKey(d) ≠ x (mismatched pair or corrupted data)\"",
        "desc": "A mismatched d/x violates the contract — hard error, no PEM"
      },
      {
        "in": "{\"kty\":\"OKP\",\"crv\":\"X25519\",…}",
        "out": "structural check + x/d hex + both PEMs; the check line states \"X25519 has no independent public-recomputation path (RFC 8037); structural check applied\"",
        "desc": "X25519 case: the check boundary is stated honestly"
      }
    ],
    "formulas": [
      {
        "tex": "pk = \\mathrm{clamp}(\\mathrm{SHA512}(d)_{[0..32]})\\cdot B \\in \\mathbb{E}",
        "caption": "Ed25519 public-key recomputation (the basis of the RFC 8037 §4 consistency check)"
      },
      {
        "tex": "\\mathrm{PrivateKeyInfo} = \\mathrm{SEQ}\\{0,\\,\\mathrm{SEQ}\\{OID\\},\\,\\mathrm{OCTET\\,STRING}(\\mathrm{OCTET\\,STRING}(d))\\}",
        "caption": "RFC 5958's double OCTET STRING wrapping — the most common hand-written PKCS#8 pitfall"
      }
    ],
    "tips": [
      "Spotting it: JWT header alg=EdDSA / a challenge giving JWK JSON → this op; if it gives PEM instead, use the export op in reverse.",
      "base64url differs from base64: alphabet -_ and no '='; padding is a hard error (RFC 7515 §3.2) — don't append equal signs by habit.",
      "Ed25519's d is the seed, not the 64-byte expanded private key — JWK always carries 32 bytes; truncate the first 32 when handed 64.",
      "An X25519 JWK plays the \"private/public keypair\" role in ECDH challenges (Curve25519 negotiation) — same shape as Ed25519 signing keys, different use; read the protocol context.",
      "A JWK with mismatched pair makes JWT verification fail as \"invalid signature\" rather than erroring — use this op's check line to rule that out first.",
      "Sources: RFC 8037 (OKP), RFC 7517/7515 (JWK/JWS encoding), RFC 8410 (Curve25519/Ed25519 OIDs and PKIX), RFC 5958 (PKCS#8)."
    ],
    "aka": [
      "JWK OKP import",
      "OKP JWK",
      "Ed25519 JWK",
      "X25519 JWK",
      "JWK importer",
      "kty OKP",
      "RFC 8037",
      "JWK to PEM",
      "Ed25519 public key JSON",
      "Octet Key Pair",
      "crv Ed25519",
      "JWK d x fields",
      "base64url JWK",
      "OKP private key import",
      "EdDSA JWK",
      "JSON Web Key OKP"
    ]
  },
  "jwkOkpExport": {
    "what": "JWK OKP export — the reverse: turns an SPKI public-key PEM / PKCS#8 private-key PEM / raw hex (public 32B, Ed25519 seed‖public 64B) into a standard JWK JSON (kty OKP, unpadded base64url). A PKCS#8 carrying only the private key gets its x recomputed automatically. The exit when signing JWT EdDSA, building a JWK Set, or writing up a solution.",
    "principle": "**Input discrimination**: PEM is recognized by its BEGIN/END label — SPKI (PUBLIC KEY → x) or PKCS#8 (PRIVATE KEY → d, public recomputed from the private: Ed25519 via base-point scalar multiplication, X25519 via X25519(d, 9)); raw hex is discriminated by length — 32B is treated as a public key (X25519's 32B cannot distinguish public from private, so public is assumed and a note is shown), 64B is split as Ed25519 seed‖public with a recomputation check.\n\n**Encoding (RFC 7515 §3.2)**: base64url without padding — `+→-`, `/→_`, strip `=`. Field order kty/crv/x/d follows convention; parsers must not depend on order.\n\n**Checks**: a 64B Ed25519 input has publicKey(seed) recomputed and compared with the attached public key (hard error on mismatch); PKCS#8 imports are recomputed as well — guaranteeing the emitted JWK is self-consistent (so a corrupted private key never reaches your writeup).",
    "usage": "Input: PEM or raw hex. Parameter: curve dropdown (for raw hex; PEM auto-detects).\n\nOutput: x/d hex + the formatted JWK JSON (downloadable as .jwk.json).\n\nUse cases: converting openssl/node-generated Ed25519/X25519 keys into the JWK a JWT library wants, adding members to a JWK Set, pasting standard JSON into a writeup. Key material stays local; zero exfiltration.",
    "examples": [
      {
        "in": "(PEM) -----BEGIN PRIVATE KEY----- (Ed25519 PKCS#8, seed 9d61b19d…7f60)",
        "out": "JWK: {\"kty\":\"OKP\",\"crv\":\"Ed25519\",\"x\":\"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo\",\"d\":\"nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A\"} — x recomputed from d, matching RFC 8037 §A.3",
        "desc": "PKCS#8 → full JWK (x recomputed on the fly)"
      },
      {
        "in": "(64B hex) 9d61b19d…7f60d75a9801…511a (seed‖public)",
        "out": "recomputation check passes → the same JWK; mismatched halves error out explicitly",
        "desc": "raw hex case: 64B auto-split with verification"
      },
      {
        "in": "(32B hex, X25519 dropdown)",
        "out": "x = the 32 bytes, no d; note \"X25519's 32B input cannot distinguish public from private — treated as public\"",
        "desc": "X25519 32B case: the ambiguity boundary is stated honestly"
      }
    ],
    "formulas": [
      {
        "tex": "\\mathrm{b64url}(b) = \\mathrm{b64}(b) \\text{ with } +\\!\\to\\!-\\;,\\;/\\!\\to\\!\\_\\;,\\; =\\!\\to\\!\\epsilon",
        "caption": "JWK's unpadded base64url encoding (RFC 7515 §3.2)"
      },
      {
        "tex": "pk_{X25519} = X25519(d, 9)",
        "caption": "X25519 public-key recomputation: Montgomery ladder scalar multiplication on base point u=9"
      }
    ],
    "tips": [
      "JWT flow: a challenge gives the PKCS#8 private PEM → this op yields the JWK → feed it to a jwt library (alg=EdDSA) for signing; verifiers only need x.",
      "The exported d is sensitive private material: confirm it belongs in the environment before pasting; this tool neither stores nor uploads it.",
      "openssl's Ed25519 PEM is PKCS#8 (BEGIN PRIVATE KEY); a BEGIN PUBLIC KEY can only produce the d-less public JWK.",
      "A JWK array (JWK Set) = {\"keys\":[…]}; concatenate several outputs of this op into it.",
      "Forms a byte-stable round trip with the import op: JWK→PEM→JWK (covered in the verification script).",
      "Sources: RFC 8037/7517/7515/8410/5958."
    ],
    "aka": [
      "JWK OKP export",
      "export JWK",
      "PEM to JWK",
      "Ed25519 PEM to JWK",
      "X25519 JWK export",
      "OKP JSON",
      "public JWK",
      "private JWK",
      "RFC 8037 export",
      "JWK Set member",
      "EdDSA key JSON",
      "JSON Web Key export",
      "JWK base64url",
      "OKP export",
      "JWT EdDSA key",
      "JWK x d fields",
      "JWKS Ed25519"
    ]
  },
  "gcmForbidden": {
    "what": "GCM nonce-reuse attack (teaching demo) — the two-stage break of AES-GCM when a nonce is **reused under the same key**: ① same nonce ⇒ identical CTR keystream, so a known plaintext on one side recovers the keystream and decrypts the other (confidentiality break); ② with ≥2 same-nonce samples, Joux's forbidden attack solves a tag-difference polynomial equation for the authenticator H over GF(2^128), recovers the mask $E_K(J_0)$, and forges tags that pass verification for arbitrary new (aad, ct) (integrity break). A standalone attack op; the AEAD primitives are untouched.",
    "principle": "**GCM authentication structure (SP 800-38D §7.1)**: $T = \\mathrm{GHASH}_H(A, C) \\oplus E_K(J_0)$, where $H = E_K(0^{128})$ and $J_0$ is derived from the nonce. GHASH is a polynomial in $H$: the block sequence $B_1..B_n$ (A blocks‖C blocks‖length block) gives $S(H) = \\sum_j B_j H^{n-j+1}$.\n\n**forbidden attack (Joux 2006)**: two messages under the same nonce share the mask, so $T_1 \\oplus T_2 = S_1(H) \\oplus S_2(H) = q(H)$ — a polynomial with known coefficients whose root is $H$. Root-finding: take gcd with $x^{2^{128}} \\oplus x$ to extract all linear factors, then split them recursively with the trace map $\\mathrm{Tr}(\\alpha x) = \\sum_{i=0}^{127} (\\alpha x)^{2^i}$ (this implementation derives α deterministically from a sample fingerprint — no random source consumed). Each candidate $H$ is filtered by full-sample mask consistency ($S_i(H) \\oplus T_i$ must all be equal; with ≥3 samples the true H is almost surely unique).\n\n**Forgery**: once $H$ is known, the mask $= S_i(H) \\oplus T_i$ (same nonce ⇒ same $E_K(J_0)$), and for any $(A', C')$: $T' = \\mathrm{GHASH}_H(A', C') \\oplus \\mathrm{mask}$ — this tag passes any standard GCM verification. Changing the nonce or key invalidates everything immediately.",
    "usage": "Input (H-recovery mode): one sample per line, `aadHex|ctHex|tagHex` (pipe-separated, aad may be empty); at least 2, preferably ≥3 samples under the **same key+nonce**; forgery targets (aad/ct) go in the parameters.\nInput (keystream mode): the same samples + the known plaintext hex (matching the first sample's ct).\n\nOutput: candidate H and the mask (keystream mode gives the keystream and the other side's plaintext); forged tags; all failure boundaries error out explicitly (different nonce / single sample / degenerate equation).\n\nUse cases: CTF challenges with GCM traffic that reused a nonce, protocols with broken nonce counters, restoring the other side's plaintext. **Defense = never reuse a nonce under the same key**; this is a protocol-misuse demo, not an attack on AES itself.",
    "examples": [
      {
        "in": "three AES-256-GCM samples from node:crypto with the same nonce (ciphertexts 16/40/64 bytes)",
        "out": "candidate H1 = 75e6f7e8…a3dd (== the E_K(0^128) ground truth); mask E_K(J0) = …; full-sample consistency = 1",
        "desc": "The recovered H matches the AES-ECB encryption of the all-zero block byte-for-byte"
      },
      {
        "in": "same samples + forgery target ct (50 random bytes, empty aad)",
        "out": "forged tag (candidate H1) = … — feeding that tag back into node:crypto's AES-GCM decipher (same key/nonce/aad/ct) verifies and the plaintext is fully recovered",
        "desc": "The forged tag passes the authoritative implementation (integrity break proven)"
      },
      {
        "in": "two samples with a different nonce mixed in",
        "out": "explicit error \"no candidate root passes full-sample mask consistency — samples look like different nonce/key\"",
        "desc": "Refuses when the nonce-reuse premise does not hold"
      }
    ],
    "formulas": [
      {
        "tex": "T_i = \\sum_{j} B_{i,j} H^{n_i-j+1} \\oplus E_K(J_0)",
        "caption": "The polynomial structure of the GCM tag (SP 800-38D §7.1)"
      },
      {
        "tex": "q(H) = T_1 \\oplus T_2 = S_1(H) \\oplus S_2(H)",
        "caption": "The same-nonce difference equation: H is a root of q over GF(2^128) (Joux 2006)"
      },
      {
        "tex": "\\mathrm{Tr}(z) = z \\oplus z^{2} \\oplus \\cdots \\oplus z^{2^{127}}",
        "caption": "Trace-map splitting: gcd(Tr(αx), f) cuts equal-degree factors with probability 1/2"
      }
    ],
    "tips": [
      "Spotting it: the same key with repeated nonces across GCM records / the challenge says \"nonce reuse\" / you must forge a GCM record that passes verification → this op.",
      "Sample requirements: 2 same-key+nonce samples minimum, 3+ auto-filters false roots; aad/ciphertext lengths set the polynomial degree (blocks+1) — degrees above 256 blocks are refused.",
      "Division of labor with the \"AEAD nonce reuse\" op: that one does ChaCha20-Poly1305 keystream recovery (the Poly1305 one-time key is reused with the nonce); this op does GCM H recovery and forgery — one card per AEAD family.",
      "The keystream mode only recovers a prefix (as long as the known plaintext); decrypting the other side fully needs a sufficiently long known plaintext.",
      "The forgery only works under the same nonce: the mask is bound to $E_K(J_0)$, and J0 is derived from the nonce — a new nonce means collecting new samples.",
      "The GF(2^128) reflected bit-order pitfall: the multiplicative identity is the block 0x80…00, not 0x01 — this implementation follows SP 800-38D and is cross-checked against node:crypto.",
      "Sources: NIST SP 800-38D §6.4/§7.1; A. Joux, \"Authentication Failures in NIST Version of GCM\" (2006)."
    ],
    "aka": [
      "GCM nonce reuse",
      "GCM forbidden attack",
      "forbidden attack",
      "Joux attack",
      "GCM authentication break",
      "GHASH H recovery",
      "GCM H recovery",
      "GCM tag forgery",
      "GCM forgery",
      "nonce reuse attack",
      "AES-GCM nonce reuse",
      "GCM keystream reuse",
      "GCM 密钥流复用",
      "SP 800-38D attack",
      "AEAD misuse",
      "GCM forgery attack",
      "GHASH polynomial root finding",
      "禁止攻击 GCM"
    ]
  },
  "ntruCca2Encrypt": {
    "what": "NTRU CCA-2 variant encryption (hash-based SVES, teaching demo) — on top of EESS1/NTRUEncrypt's SVES byte mapping, a \"hash binding\" is added: the random b field and the blinding polynomial r are both derived from the **plaintext via MGF1-SHA256**, making encryption fully deterministic; the decryptor recomputes the MGF and compares it with the recovered b, rejecting on mismatch — the re-encryption-check idea for CCA-2 hardening. The underlying PKE/SVES is shared with the plain \"NTRU keygen/encrypt/decrypt\" ops.",
    "principle": "**Differences from plain NTRU encryption**: in plain SVES the b field is random bytes and the decryptor cannot verify — a flipped ciphertext decrypts to another \"valid\" plaintext (CCA-1 style). This variant replaces b with $\\mathrm{MGF1\\text{-}SHA256}(\\text{parameter set} \\| \\text{plaintext})$ and samples r deterministically from a hash of $(b \\| \\text{plaintext})$, so:\n① encryption is deterministic (same (public key, plaintext) always yields the same ciphertext) — reproducible and verifiable;\n② after recovering M, the decryptor recomputes $\\mathrm{MGF1}(\\text{plaintext})$ and compares with the recovered b — a tampered ciphertext ⇒ different plaintext ⇒ b check fails ⇒ reject (the core mechanism of chosen-ciphertext security).\n\n**Underlying math unchanged (EESS1 v3.1 / P1363.1 §9.2.2/9.2.3)**: M = b‖octL‖msg‖0 → SVES 3bit→2-coefficient mapping → m ∈ {−1,0,1}^N; e = r∗h + m mod q (negacyclic convolution, q=2048). Decryption = f∗e centered → mod 3 → SVES inverse mapping (illegal pairs rejected).",
    "usage": "Input: plaintext (UTF-8) + public key hex (from \"NTRU keygen\"). The parameter set is auto-detected from the public key's tag byte (ees401ep1/ees401ep2/ees439ep1/ees659ep1).\n\nOutput: ciphertext hex (with a 1-byte parameter-set tag), downloadable. The plaintext limit is set by the parameter set (e.g., 51 bytes for ees401ep1).\n\nUse cases: teaching the CCA-2 hardening idea, comparison experiments against plain NTRU encryption. **Honest boundary**: a teaching implementation without official KATs — for production use standard KEMs such as ML-KEM; deterministic encryption leaks \"whether two sends had the same plaintext\" (stated as part of the demo scope).",
    "examples": [
      {
        "in": "(ees401ep1 public key + plaintext \"NTRU CCA-2 roundtrip 测试!\")",
        "out": "553-byte ciphertext (incl. 1-byte tag) = 01c8c9…; re-encrypting the same plaintext gives a byte-identical ciphertext (determinism)",
        "desc": "Real run: determinism + round trip"
      },
      {
        "in": "the same ciphertext with 1 bit flipped in the middle, then decrypted",
        "out": "explicit error \"CCA-2 check failed: recovered b does not match MGF(plaintext) (ciphertext tampered or not this scheme)\"",
        "desc": "Tampering rejected by the hash binding (plain NTRU encryption cannot do this)"
      },
      {
        "in": "an over-long plaintext (above the parameter-set limit)",
        "out": "explicit error stating the byte limit for that parameter set",
        "desc": "Length boundary refused honestly"
      }
    ],
    "formulas": [
      {
        "tex": "b = \\mathrm{MGF1\\text{-}SHA256}(\\text{name} \\| \\mathrm{msg})_{[0..d_b/8)}",
        "caption": "The b field is hash-derived (the source of determinism)"
      },
      {
        "tex": "e = r \\ast h + m \\bmod q,\\quad r = \\mathrm{sample}(H(b \\| \\mathrm{msg}))",
        "caption": "Deterministic sampling of the blinding polynomial (EESS1 T_N sampling)"
      },
      {
        "tex": "b \\stackrel{?}{=} \\mathrm{MGF1}(\\mathrm{msg})",
        "caption": "Decryptor check: reject on mismatch (the CCA-2 re-encryption-check idea)"
      }
    ],
    "tips": [
      "Spotting it: challenges handing out NTRU keys and asking for \"tamper-proof NTRU encryption\" / discussing CCA-2 hardening comparisons → this variant; plain NTRU challenges use the original NTRU ops.",
      "The side effect of deterministic encryption: encrypting the same plaintext twice gives the same ciphertext — useful in CTFs for ciphertext-equivalence analysis, and exactly why it is labeled a teaching demo.",
      "The first ciphertext byte is the parameter-set tag (01..04); the decryptor picks N/q from it — hand-editing the tag is rejected.",
      "The plaintext limit = mLen − db/8 − 2 (51 bytes for ees401ep1); split or compress long data first.",
      "Ciphertexts are decryptable by the plain NTRU decryptor (same underlying PKE), but only this variant's decryption performs the b check.",
      "Sources: EESS1 v3.1 (SVES encoding), IEEE P1363.1 §9.2.2/9.2.3 (coefficient mapping), PKCS#1 v2.2 Appendix B.2.1 (MGF1); the hash-based variant is a teaching-scope self-implementation."
    ],
    "aka": [
      "NTRU CCA-2 encrypt",
      "NTRU CCA2",
      "hash-based SVES",
      "NTRU authenticated encryption",
      "NTRUEncrypt CCA-2",
      "NTRU re-encryption check",
      "SVES hash variant",
      "NTRU NAEP",
      "EESS1 SVES",
      "NTRU tamper-proof encryption",
      "NTRU deterministic encryption",
      "ees401ep1 encrypt",
      "ees439ep1",
      "NTRU teaching encryption",
      "post-quantum CCA-2"
    ]
  },
  "ntruCca2Decrypt": {
    "what": "NTRU CCA-2 variant decryption — pairs with \"NTRU CCA-2 encrypt\": after the EESS1 decryption math (f∗e centered → mod 3 → SVES inverse mapping) recovers M, it **recomputes MGF1-SHA256(plaintext) and compares with the recovered b**, rejecting with an explicit \"ciphertext tampered\" on mismatch; there are also octL length and zero-padding checks as a second line of defense. Teaching demo scope (no official KAT).",
    "principle": "**Three gates in order** (any failure errors out explicitly):\n① SVES inverse mapping: m ∈ {0,1,2}^N → the byte stream M; an illegal pair (2,2) rejects immediately (a strong tampering signal);\n② octL and zero padding: the length field ≤ the limit and the tail all-zero — the structural checks plain SVES already has;\n③ **the b binding check (the core of this variant)**: recompute $\\mathrm{MGF1\\text{-}SHA256}$ from the recovered plaintext and compare with the first $d_b/8$ bytes of M — an attacker's change to the ciphertext ⇒ a different plaintext ⇒ b mismatch ⇒ reject.\n\n**Why this constitutes CCA-2 protection (conceptually)**: the decryption oracle answers tampered ciphertexts with \"reject\" only, leaking no plaintext-difference information; deterministic encryption + the equality check makes \"constructing a valid transformed ciphertext\" equivalent to knowing the plaintext itself.",
    "usage": "Input: private key hex (from \"NTRU keygen\") + ciphertext hex (from \"NTRU CCA-2 encrypt\", with the parameter-set tag).\n\nOutput: the CCA-2 check line + plaintext hex + UTF-8 interpretation. Failures distinguish four messages: SVES decode failure / illegal length / zero-padding failure / CCA-2 check failure.\n\nUse cases: closing the round trip with the encrypt op; tamper-detection demos (contrast: plain NTRU decryption silently outputs a wrong plaintext for a tampered ciphertext). **Honest boundary**: teaching scope — use standard KEMs in production.",
    "examples": [
      {
        "in": "(ees401ep1 private key + a valid CCA-2 ciphertext)",
        "out": "CCA-2 check: ✓ pass (b == MGF1-SHA256(plaintext), ciphertext untampered); plaintext 28 bytes = 4e545255…9521; UTF-8: NTRU CCA-2 roundtrip 测试!",
        "desc": "Real run: round trip + check passing"
      },
      {
        "in": "the same ciphertext with 1 bit flipped in the middle",
        "out": "explicit error (SVES decode failure or CCA-2 check failure, depending on the tamper position)",
        "desc": "Tampering intercepted at the decryptor; no wrong plaintext is emitted"
      },
      {
        "in": "a ciphertext whose parameter-set tag mismatches the key (ees401ep1 key, tag 03)",
        "out": "explicit error \"ciphertext parameter-set tag (03) does not match the private key (01)\"",
        "desc": "The tag is the parameter-set fingerprint; mismatches are refused"
      }
    ],
    "formulas": [
      {
        "tex": "a = f \\ast e \\bmod q \\to \\mathrm{center}(a) \\to \\bmod 3 \\to M",
        "caption": "The EESS1 decryption chain (shared with ntruReal, negacyclic convolution)"
      },
      {
        "tex": "\\mathrm{MGF1}(\\mathrm{msg}) \\stackrel{?}{=} b_{\\mathrm{rec}}",
        "caption": "The third gate: the b binding check (the core of this variant)"
      },
      {
        "tex": "(c_1, c_2) = (2, 2) \\Rightarrow \\mathrm{reject}",
        "caption": "The illegal-pair rejection of the SVES inverse mapping (P1363.1 §9.2.3)"
      }
    ],
    "tips": [
      "The four failure messages map to four kinds of damage: SVES decode failure (strong tampering), illegal length, zero-padding failure (weak tampering/truncation), CCA-2 check failure (plaintext-region edit) — start triage from the error class.",
      "The contrast experiment against plain NTRU decryption: the same flipped ciphertext — plain decryption silently emits a wrong plaintext, this variant rejects — exactly the value of the CCA-2 check.",
      "The private key and the ciphertext's parameter-set tags must match (first byte): the index into ees401ep1..ees659ep1.",
      "The decryption result gives both hex and UTF-8 (non-UTF-8 honestly labeled) for easy flag matching.",
      "Sources: EESS1 v3.1, IEEE P1363.1 §9.2.3, PKCS#1 v2.2 Appendix B.2.1 (MGF1); the variant is a teaching-scope self-implementation."
    ],
    "aka": [
      "NTRU CCA-2 decrypt",
      "NTRU CCA2 decrypt",
      "SVES decryption check",
      "NTRU tamper detection",
      "NTRUEncrypt CCA-2 decrypt",
      "NTRU authenticated decryption",
      "hash-based SVES decrypt",
      "NTRU re-encryption check",
      "ees401ep1 decrypt",
      "NTRU decrypt check",
      "post-quantum decryption demo",
      "NTRU teaching decryption",
      "NTRU ciphertext check",
      "SVES inverse mapping",
      "NTRU CCA2 verify"
    ]
  },
  "xoodyakHash": {
    "what": "Xoodyak-Hash — the hash mode of Xoodyak, a finalist of the NIST Lightweight Cryptography (LWC) competition: the underlying permutation is Xoodoo with a 384-bit state (12 rounds, five steps θ/ρwest/ι/χ/ρeast, a lightweight sibling built on the same design ideas as Keccak-p), wrapped in the single-color-domain Cyclist sponge with a 16-byte absorb rate, producing a fixed 32-byte digest. Designed for resource-constrained devices (IoT/embedded); also appears in lightweight-crypto CTF challenges.",
    "principle": "**Two layers**:\n\n① **The Xoodoo[12] permutation**: the state is 3 planes × 4 columns × 32-bit lanes = 384 bits. Each round has five steps —\nθ (column parity mixer: $P = A_0 + A_1 + A_2$, $E = P \\ll(1,5) + P \\ll(1,14)$) → ρwest (plane shift) → ι (round constants, 12 of them in Table 2 of the spec, $c_{-11}$=0x058 … $c_0$=0x012) → χ (non-linear layer $A_y \\mathrel{+}= \\lnot A_{y+1}\\cdot A_{y+2}$) → ρeast. Lanes map to bytes little-endian ($i = z + 32(x + 4y)$).\n② **The Cyclist sponge mode**: hash mode is the single-color domain — each absorbed block gets a frame bit 0x01 and a first-block color byte (&0x01); the color is ignored on Squeeze. The absorb rate Rhash = 16 bytes and the squeeze rate is also 16: Up yields 16 bytes, then Down(ε) + Up fills up to 32.\n\n**Relation to SHA-3**: both are sponge designs from the Keccak team (Daemen/Van Assche et al.), but the permutations differ (Xoodoo 384-bit vs Keccak-f 1600-bit) and so do the frame rules (Cyclist frame bit + color vs Keccak pad) — outputs are not interchangeable, and Xoodyak-Hash is not a \"lightweight tier\" of SHA-3.\n\n**Security positioning**: 128-bit security strength (NIST LWC finalist level); the spec states the forgeability/collision bound for hash mode in the same document.",
    "usage": "Enter any text (or the hex byte channel), get a 64-hex-character (32-byte) digest.\n\nUse when a challenge names Xoodyak/Xoodoo/LWC or gives a lightweight-crypto context; also try it when a 64-hex digest matches neither SHA-256 nor SHA3-256.\n\nRemember: one-way and irreversible; the output length is fixed at 32 bytes (as defined by the spec) — there is no variable-length option.",
    "examples": [
      {
        "in": "empty input",
        "out": "ea152f2b47bce24efb66c479d4adf17bd324d806e85ff75ee369ee50dc8f8bd1",
        "desc": "verbatim from NIST KAT entry 1 (official submission package LWC_HASH_KAT_256.txt)"
      },
      {
        "in": "hex 0001",
        "out": "dd3f12e89db41c61d3c05779705fa946a8c69c79eefdc1b4a966a5f1ab35073d",
        "desc": "verbatim from NIST KAT entry 3"
      },
      {
        "in": "abc",
        "out": "661f71b331a0c1214441c4b4a811697e9109bc0b3c4e1e647c4d1127b18e2a1e",
        "desc": "produced by this tool (implementation verified against all 1025 official hash KAT entries)"
      }
    ],
    "formulas": [
      {
        "tex": "\\mathrm{Xoodyak\\text{-}Hash}(M) = \\mathrm{SqueezeAny}(32,\\,\\texttt{40}) \\circ \\mathrm{AbsorbAny}(M, 16, \\texttt{03})",
        "caption": "Cyclist hash-mode composition (spec Algorithm 2; single-color domain, Up adds no color)"
      },
      {
        "tex": "P = A_0 + A_1 + A_2,\\quad E = P \\ll (1,5) + P \\ll (1,14),\\quad A_y \\mathrel{+}= E",
        "caption": "The θ step of Xoodoo (column parity mixer, spec Algorithm 1)"
      }
    ],
    "tips": [
      "Recognition: the challenge mentions \"Xoodyak\", \"Xoodoo\", \"NIST LWC\", \"lightweight cryptography finalist\" or an IoT/embedded lightweight context; it is a NIST LWC finalist like Ascon but an entirely different algorithm — never merge them into one \"LWC\" entry.",
      "The 64-hex (32-byte) output matches SHA-256/SHA3-256 in length — try all three and pick by context.",
      "Round constants are easy to miscopy: the 12 constants in Table 2 of the spec (0x058/0x038/0x3C0/0x0D0/0x120/0x014/0x060/0x02C/0x380/0x0F0/0x1A0/0x012) must be checked word-by-word against the original; an error like 0x059 instead of 0x058 is caught immediately by the official KAT.",
      "The θ step $P \\ll (1,5)$ is a composite shift (column shift by 1 + lane rotation by 5); when implementing, read $p_{x-1}$ per lane — don't do a lane-only rotation.",
      "Fast self-test path: verify the empty input (KAT entry 1, ea152f2b…) and short inputs like hex 000102 first — this localizes whether Xoodoo or the Cyclist frame rule is wrong.",
      "Standards: NIST LWC final-round spec (the updated-spec-doc on csrc.nist.gov, same document linked from keccak.team/xoodyak.html) Algorithm 1/Table 2/Algorithm 2 + the official C reference (NIST submission package, CC0); this implementation is byte-exact against the full official genKAT."
    ],
    "aka": [
      "Xoodyak-Hash",
      "xoodyakHash",
      "Xoodyak 哈希",
      "Xoodyak hash",
      "Xoodyak 摘要",
      "Xoodoo hash",
      "Xoodoo 海绵哈希",
      "NIST LWC 哈希",
      "轻量级密码哈希",
      "轻量密码竞赛 Xoodyak",
      "Cyclist hash",
      "Xoodyak digest",
      "Xoodyak sponge hash",
      "32 字节轻量哈希",
      "IoT 哈希算法",
      "Xoodyak 256 位哈希",
      "Xoodyak sponge",
      "lightweight hash function"
    ]
  },
  "xoodyakAead": {
    "what": "Xoodyak-AEAD — the authenticated encryption mode of Xoodyak, a finalist of the NIST Lightweight Cryptography competition: the two-color-domain Cyclist mode, with a 16-byte key, 16-byte nonce, optional associated data and a fixed 16-byte tag. Plaintext blocks are absorbed into the state during encryption (same rule in both directions) and the tag authenticates key/nonce/ad/ciphertext together; nonce reuse leaks the equivalent of up to 24 bytes of plaintext (a limit the spec itself acknowledges).",
    "principle": "**The Cyclist keyed mode (spec Algorithm 2/3)**:\n\n① **Initialization AbsorbKey**: absorbs $K \\| \\mathrm{id} \\| \\mathrm{enc8}(\\|\\mathrm{id}\\|)$ (in AEAD the id is the nonce, 16+16+1=33 bytes < Rkin−1=43), first-block color '02'; from then on the absorb rate is Rkin = 44 bytes.\n② **Absorb(ad)**: associated data is absorbed in 44-byte blocks, first block color '03', the rest '00'.\n③ **Crypt**: the plaintext is split into Rkout = 24-byte blocks — each block first Up (first block color '80') to produce keystream, $O_i = I_i \\oplus Y_i$, then Down absorbs the **plaintext block** (same rule for encryption and decryption — a key difference from stream ciphers that absorb ciphertext).\n④ **Squeeze tag**: Up(16, '40') yields the 16-byte tag.\n\n**Two-color domain**: in keyed mode the color byte is XORed into the last state byte (offset 47) before Up, and Down's frame bit 0x01 lands right after each data block — frame bit + color byte jointly separate the four semantics \"key/AAD/plaintext/squeeze\", the structural source of Xoodyak's resistance to domain confusion.\n\n**Security positioning**: 128-bit security strength; authentication does not depend on the nonce (nonce misuse leaks at most plaintext-equivalent information, never the key).",
    "usage": "Parameters: key as 16-byte hex, nonce as 16-byte hex (required, one-time use — this tool does not generate a random one for you), aad (text or hex, optional).\nEncrypt: plaintext (UTF-8 text or hex bytes) → hex output (ciphertext ‖ 16-byte tag, no separator).\nDecrypt: paste hex in the same format; key/nonce/aad must match the encryption values; a tag mismatch raises an error immediately (no unverified plaintext is released).\n\nUse for ciphertext streams with a Xoodyak/LWC context; (key, nonce, ad, tag) tuple verification; lightweight-crypto teaching demos.",
    "examples": [
      {
        "in": "key=000102030405060708090a0b0c0d0e0f, nonce=101112131415161718191a1b1c1d1e1f, plaintext hex empty, aad hex 00",
        "out": "25966dd6af69a7aa336d13dd35e9dc64",
        "desc": "verbatim from NIST KAT entry 2 (empty plaintext + 1-byte aad, output is just the 16-byte tag)"
      },
      {
        "in": "plaintext flag{x00dy4k_cycl1st}, aad text ctf ad, key 000102…0f, nonce 101112…1f",
        "out": "726559678e99fcaa1f82b0148dea4a70ea6e3db96c62acbabb47d453d23542cc4e080ed47a",
        "desc": "produced by this tool (21-byte ciphertext + 16-byte tag; implementation verified against all 1089 official AEAD KAT entries in both directions)"
      },
      {
        "in": "same ciphertext, flip any 1 bit of the tag",
        "out": "error: authentication failed",
        "desc": "the tag covers key/nonce/ad/ciphertext — any change is rejected"
      }
    ],
    "formulas": [
      {
        "tex": "O_i = I_i \\oplus \\mathrm{Up}(|I_i|,\\, \\texttt{80}\\text{ if first else }\\texttt{00}),\\quad \\mathrm{Down}(P_i, \\texttt{00})",
        "caption": "Cyclist Crypt: XOR with keystream, then absorb the plaintext block (both directions, spec Algorithm 3)"
      },
      {
        "tex": "\\mathrm{AbsorbKey}\\colon \\mathrm{AbsorbAny}(K\\|\\mathrm{id}\\|\\mathrm{enc8}(\\|\\mathrm{id}\\|),\\ R_{kin},\\ \\texttt{02})",
        "caption": "The key block: key‖nonce‖length-byte absorbed at once, color '02' (spec Algorithm 3)"
      }
    ],
    "tips": [
      "Recognition: the challenge mentions \"Xoodyak\", \"Cyclist\", \"Xoodoo\", \"NIST LWC AEAD\" or a lightweight/IoT context; a fellow NIST finalist like Ascon-AEAD but with different algorithm, block sizes and tag semantics — never merge them.",
      "The three block sizes (Rkin=44 absorb / Rkout=24 encrypt / tag 16) are the Xoodyak fingerprint: when validating a self-implementation, start with empty plaintext + empty aad (the output is just the 16-byte tag, official KAT entry 1: 4968dc9c…), then a 45-byte aad cross-block sample.",
      "The nonce is 16 bytes (128 bits) — longer than AES-GCM's 12 bytes; a 12-byte nonce means the algorithm is not Xoodyak.",
      "The nonce must be used exactly once: reusing key+nonce reuses the keystream (block-level leakage up to 24 bytes, acknowledged in §1 of the spec); this tool deliberately does not auto-generate a random nonce, leaving the one-time-use responsibility with the user.",
      "Decryption recovers the plaintext before verifying the tag: a \"decryption result\" does not mean authentication passed — this tool errors out instead of releasing unverified plaintext (proper AEAD semantics); when scripting, don't treat unverified output as authentic.",
      "Standards: NIST LWC final-round spec (updated-spec-doc on csrc.nist.gov) Definition 2/Algorithm 2/3 + the official C reference encrypt.c/hash.c (NIST submission package, CC0); this implementation is byte-exact against the full official genKAT (1089 AEAD + 1025 hash entries)."
    ],
    "aka": [
      "Xoodyak-AEAD",
      "xoodyakAead",
      "Xoodyak AE",
      "Xoodyak 加密",
      "Xoodyak 解密",
      "Xoodyak 认证加密",
      "Xoodyak authenticated encryption",
      "Cyclist AEAD",
      "Xoodoo AEAD",
      "NIST LWC AEAD",
      "轻量级认证加密",
      "轻量密码竞赛 AEAD",
      "Xoodyak-AE",
      "IoT 认证加密",
      "Xoodyak tag",
      "Xoodyak crypto",
      "Cyclist mode",
      "Xoodyak decrypt"
    ]
  },
  "eccSubgroupAttack": {
    "what": "ECDH missing-point-validation attack demo (local teaching loop) — two classic \"unvalidated peer point\" breakages: ① **X25519 small-subgroup attack** (RFC 7748 §6.8.1 scenario): feed small-order points' u-coordinates to an X25519 implementation that skips point validation; the shared secret collapses to a few values, leaking the private key's cofactor residue from oracle outputs (a bare unclamped implementation leaks at most 2 bits); clamping plus the all-zero check is the defense. ② **Invalid-curve attack** (Biehl–Durmus–Lucks 2000): Weierstrass point addition depends only on a, not b — a victim that scalar-multiplies attacker-supplied points without on-curve validation works on y²=x³+ax+b′ curves of smooth order, letting the attacker collect d mod ℓ and recombine via CRT. Simulated oracle, closed loop, teaching demo — not a remote attack tool.",
    "principle": "**X25519 side (real parameters p=2^255−19, A=486662)**: the curve plus its twist contain exactly 5 low-order u values (order 2 at u=0, order 4 at u=1, two curve order-8, one twist order-4). This implementation **trusts no transcribed constants**: each of 11 candidate u values goes through runtime order determination by a doubling chain (2P/4P landing on (0,0) ⇒ order 4/8) plus a quadratic-character side test (is u³+Au²+u a QR ⇒ curve, else twist); candidates that fail are dropped automatically (11 → 5, six bogus transcribed values eliminated on the spot). The mathematical truth of x-only leakage: for an order-4 point, 2P=(0,0) and 4P=∞ both output 0 and 1P/3P share one u — a single point yields only d mod 2; an order-8 point gives 3 output classes, pinning d mod 4 (even scalars) or d ≡ ±r (mod 8) (odd scalars). Constraints are combined by intersecting the mod-8 candidate set, and the truth landing inside is the proof.\n\n**Invalid-curve side (toy curve y²=x³+2x+2 mod 1000003, full pipeline)**: deterministically enumerate b′=1,2,… for non-singular invalid curves with smooth group order → BSGS for the order → query the oracle with small-prime-order points → recover d mod ℓ → CRT. When the covered prime product reaches p the private key is **fully recovered** (built-in example: 5·47·227·7·19 = 7094885 ≥ 1000003; CRT value matches the truth digit for digit).\n\n**Defense (same conclusion for both modes)**: ① validate every peer point (on-curve / subgroup); ② X25519 clamping (built into RFC 7748 §5 — the low 3 bits cleared force scalars to be multiples of 8) plus the §6.8.1 all-zero shared-secret check (must abort). Measured: after clamping every low-order query returns all zeros.",
    "usage": "Pick the mode: ① \"X25519 small subgroup (real parameters)\": leave the private key empty for the built-in example (d mod 8 = 3, non-zero oracle outputs, readable verdicts), or supply 64 hex chars (32 bytes); the output lists the low-order points (including the number of eliminated fake candidates), per-point constraints, the mod-8 candidate set, leaked bits, truth check, and the clamping defense comparison. ② \"Invalid curve (toy curve, full pipeline)\": private key as a decimal integer (< 1000003; empty = built-in 123456); output includes each curve's order/residues, CRT combination, and the full-recovery verdict.\n\nUse for: CTF challenges with custom ECDH that accepts arbitrary 32-byte strings / arbitrary points for scalar multiplication, or tasks that say \"no point/subgroup validation\". **Honest scope**: the X-mode leak is capped at 2 bits (x-only erases ±y, so d mod 8 is presented as ±r constraints when undecomposable); the invalid-curve mode uses a toy curve — group-order factorization at real-curve scale (P-256 class) is out of teaching scope.",
    "examples": [
      {
        "in": "(X mode, built-in key a3b1c2…ff)",
        "out": "Candidates 11 → 5: order 2 (curve) u=0; order 4 (curve) u=1; order 8 (curve) u=3256062509…, 3938235723…; order 4 (twist) u=5789604461…. Oracle: d·(order-8 curve point u=325606250916…) = 57119fd0… ⇒ d mod 8 ∈ {3,5}…… mod-8 candidates {3,5} (2.00 bits leaked); truth check: d mod 8 = 3 ∈ candidate set ⇒ ✓ consistent; after clamping all queries return zeros ✓",
        "desc": "Live run: runtime order determination + side test, cofactor-leak proof, clamping defense comparison"
      },
      {
        "in": "(invalid-curve mode, built-in key 123456)",
        "out": "b′=2: |E′| = 998280, order-5 point ⇒ d mod 5 = 1; b′=2: order-47 point ⇒ d mod 47 = 34; b′=3: order-227 point ⇒ d mod 227 = 195; b′=10: order-7 point ⇒ d mod 7 = 4; b′=14: order-19 point ⇒ d mod 19 = 13. CRT: d ≡ 123456 (mod 7094885); mod ≥ p ⇒ private key **fully recovered** (CRT value = 123456, truth = 123456: match)",
        "desc": "Live run: smooth-order invalid-curve search + small-prime-order queries + full CRT recovery"
      },
      {
        "in": "(invalid-curve mode, key 0 or -5)",
        "out": "Explicit errors: \"private key 0 (meaningless)\" / \"toy-curve private key must be a decimal integer\"",
        "desc": "Edge cases rejected explicitly, no forced output"
      }
    ],
    "formulas": [
      {
        "tex": "2P = \\left(\\frac{(u^2-1)^2}{4(u^3+Au^2+u)},\\,\\cdot\\right)",
        "caption": "x-only Montgomery doubling — the backbone of runtime order determination (2P lands on (0,0) ⇒ P has order 4)"
      },
      {
        "tex": "\\chi(f(u)) = f(u)^{\\frac{p-1}{2}} \\bmod p \\;\\in\\{1,p-1\\}",
        "caption": "Quadratic-character side test: f(u)=u³+Au²+u a QR ⇒ main curve, otherwise the twist"
      },
      {
        "tex": "d \\bmod \\ell_j \\;\\xrightarrow{\\mathrm{CRT}}\\; d \\pmod{\\prod_j \\ell_j}",
        "caption": "Shared skeleton of both attacks: small-order points leak residues, CRT recombines (Biehl 2000)"
      }
    ],
    "tips": [
      "Spot it: custom ECDH accepting any 32-byte string / any point for scalar multiplication, or wording like \"no point/subgroup validation\" → use both modes of this op.",
      "The 5 low-order u values are determined at runtime — do not memorize constant lists; transcribed values online are error-prone, and this implementation's candidate pool eliminated 6 bogus values on the spot.",
      "Read the x-only leak cap carefully: even scalars pin d mod 4, odd scalars only d ≡ ±1 or ±3 (mod 8) — the x-coordinate erases ±y, true for every implementation; never expect a full d mod 8.",
      "Clamping is RFC 7748's built-in defense: low 3 bits cleared, bit 254 set, bit 255 cleared — scalars become multiples of 8 and low-order queries always return zeros; the all-zero check (§6.8.1) is the second gate.",
      "The invalid-curve mode demonstrates mechanism, not scale: on the toy curve p=1000003 CRT coverage ≥ p means full recovery; on real curves the same flow applies, but smooth-order curve search and big-integer factorization exceed teaching scope.",
      "All failure boundaries error out explicitly: wrong X-mode key length, invalid-curve d=0 / non-decimal — never a silent fake result.",
      "Sources: RFC 7748 §5/§5.2/§6.1/§6.8.1 (authoritative vectors cross-checked one by one, outputs compared in LE byte order); Biehl, Durmus, Lucks, \"Distributing the Elliptic Curve Discrete Logarithm\" (ASIACRYPT 2000); low-order-point literature: eprint 2019/526."
    ],
    "aka": [
      "ECDH small subgroup attack",
      "small subgroup attack",
      "invalid curve attack",
      "X25519 small subgroup",
      "small subgroup confinement attack",
      "ECDH point validation flaw",
      "cofactor leak",
      "clamping defense",
      "twist attack",
      "twist-curve attack",
      "CRT ECDH private key recovery",
      "Biehl invalid curve",
      "Montgomery ladder attack",
      "curve point injection",
      "ECDH oracle attack",
      "low order point attack",
      "subgroup confinement",
      "X25519 cofactor leak",
      "invalid curve point validation",
      "ECC subgroup attack"
    ]
  }
};
