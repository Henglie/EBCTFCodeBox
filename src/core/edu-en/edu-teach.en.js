/*
 * edu-teach.en.js — English edu cards for the three teaching ops (BFV toy / MPC toy / quantum toy).
 * Source: edu/edu-teach.js, translated 1:1. Example vectors copied verbatim; only prose is translated.
 * All three state "teaching demo, not production grade" and its boundaries up front.
 */
export default {
  bfvToy: {
    what:
      "A **teaching implementation** of BFV homomorphic encryption (Fan–Vercauteren, ePrint 2012/144): negacyclic convolution over R_q = Z_q[x]/(x^n+1), " +
      "a ternary secret and Δ=⌊q/t⌋ scaling, so you can **add and multiply ciphertexts directly** and get the corresponding plaintext operation after decryption. " +
      "It demonstrates BFV's algebraic skeleton and its **noise ledger** — it is not a usable FHE library.",
    principle:
      "**Why it is homomorphic**: a BFV ciphertext is (c0, c1) with c0 + c1·s ≈ Δ·m + e (mod q), where e is small noise. " +
      "Adding two ciphertexts gives Δ(m1+m2) + (e1+e2) — noise adds but stays within budget, so decryption yields m1+m2. " +
      "Multiplying (tensor product) produces Δ²m1m2 plus cross terms, which must be scaled back by t/q; noise is amplified accordingly (no relinearisation here, so the ciphertext grows from 2 to 3 components).\n\n" +
      "**Noise budget**: correct decryption requires ‖e‖∞ < Δ/2 = q/(2t). This op prints the measured ‖e‖∞ and the budget usage after every operation; " +
      "once multiplication overflows it **fails explicitly with a reason** (`✗ explicit failure, no garbage`), never returning something that merely looks like plaintext.\n\n" +
      "**Why the parameters are tiny**: n ≤ 16, q ≤ 2³², t ≤ 2¹⁶. At this size the instance is directly breakable by lattice reduction; it is only good for watching noise grow. " +
      "Real BFV needs n ≥ 4096, NTT acceleration, relinearisation keys and modulus switching — none of which are implemented here.",
    usage:
      "Pick `demo` for the full flow (encrypt → homomorphic add → homomorphic mul); the output lists each step's ciphertext, decrypted value, expected value, noise and budget usage. " +
      "For a single step choose `encrypt` / `decrypt` / `add` / `mul`; the latter three need the previous ciphertext hex in `ctA` / `ctB` (components separated by `;`).\n\n" +
      "`seed` selects the random source: the same seed reproduces everything (needed for teaching and cross-checking); leave it empty to use the current randomness tier. " +
      "**Note**: `decrypt` / `add` / `mul` need the same seed and key parameters as encryption, otherwise decryption fails — this is a teaching implementation with no key serialisation format.",
    examples: [
      { in: "(demo, defaults n=8 q=4294967291 t=256 m=42)", out: "decrypt = 42; add 84; mul 228; noise 5 → 10 → 51634", desc: "Default full flow: all three self-checks ✓, 0.62% budget used after multiplication" },
      { in: "(demo, q=65536 t=256 m=200)", out: "✗ explicit failure: noise budget exhausted (‖e‖∞ = 9683 ≥ Δ/2 = 128)", desc: "q too small makes multiplication overflow — failure is explicit, not garbage" },
      { in: "(n=16, other defaults)", out: "multiplication noise ≈ 88014 (1.05% of the 8388607 budget)", desc: "Larger ring dimension slows noise growth, but breakability is unchanged" },
    ],
    formulas: [
      { tex: "c_0 + c_1 s = \\Delta m + e \\pmod q,\\quad \\Delta=\\lfloor q/t\\rfloor", caption: "BFV ciphertext invariant: decrypt = drop noise, divide by Δ" },
      { tex: "\\|e\\|_\\infty < \\Delta/2 = q/(2t)", caption: "Noise budget for correct decryption; multiplication amplifies it, overflow fails explicitly" },
    ],
    tips: [
      "Watch the noise, not the ciphertext: length and randomness never tell you whether an operation still holds — only ‖e‖∞ versus Δ/2 does.",
      "Multiplication noise grows roughly with both ciphertexts' noise times plaintext scale, then scaled by t/q; chained multiplications exhaust the budget fast, which is why real FHE needs bootstrapping or modulus switching.",
      "Ciphertexts here are not a standard serialisation (no relin keys, no parameter-set identifier) and **cannot** interoperate with other FHE libraries.",
      "n ≤ 16 BFV instances are directly breakable: never use this to protect real data — it is an algebra lesson you can see.",
      "To verify the implementation: with the same seed, encryption must reproduce byte-for-byte; the decrypted value must equal m mod t.",
    ],
    aka: ["BFV", "bfv 同态加密", "同态加密", "homomorphic encryption", "FHE", "全同态加密",
      "格密码", "lattice", "BFV toy", "同态加法", "同态乘法", "噪声预算",
      "Fan-Vercauteren", "ePrint 2012/144", "教学同态", "环上同态"],
  },

  mpcToy: {
    what:
      "A **teaching toy** for secure multi-party computation: `beaver` mode uses 3-party additive sharing plus a Beaver 1991 multiplication triple to compute a×b, printing each party's share, the masked values d/e and a reconstruction self-check; " +
      "`ot` mode simulates 1-of-2 oblivious transfer (blind → two masked messages → open exactly one). It demonstrates protocol **shape**, not real security.",
    principle:
      "**Additive sharing**: split a into a₁+a₂+a₃ ≡ a (mod p). A single share is uniformly random and reveals nothing about a.\n\n" +
      "**Beaver triple**: pre-generate (x, y, z=x·y) independent of the inputs, shared the same way. Online, each party publishes d_i = a_i − x_i and e_i = b_i − y_i, " +
      "which combine to d = a−x and e = b−y; each computes w_i = z_i + d·y_i + e·x_i (one party adds d·e), and the sum of the w's is a·b. " +
      "The point: **d and e are masked differences**, publishing them leaks neither a nor b — the classic \"offline preprocessing, online additions only\" structure.\n\n" +
      "**1-of-2 OT simulation**: the sender masks two messages, the receiver can open only the selected one. This implementation uses a deterministic PRF, " +
      "**with no RSA/DDH trapdoor** — anyone holding the seed can open both, so it is a flow demo, not cryptographic OT.\n\n" +
      "**Security boundary**: no MAC, no commitment, no zero-knowledge proof ⇒ a malicious party deviating from the protocol goes unnoticed; real MPC needs information-theoretic MACs and preprocessing extension (SPDZ/TinyOT class).",
    usage:
      "`beaver`: fill `a`, `b` (integers) and `seed`; output lists the triple, each party's shares, the masked values, the reconstruction and an algebraic self-check. " +
      "`ot`: `a` is the choice bit (0/1), `b` is the message base value; output shows blinding and unblinding.\n\n" +
      "The same seed reproduces everything, which is handy for classroom cross-checking. The field is fixed at p = 2³¹−1 (a Mersenne prime), so inputs should be far below p; " +
      "oversized inputs are rejected explicitly rather than silently reduced.",
    examples: [
      { in: "beaver, a=7 b=9", out: "reconstruction 63 == a·b mod p = 63 ✓", desc: "Three shares sum to the product, with the algebraic expansion as proof" },
      { in: "beaver, single-party view", out: "P1 only sees a₁, b₁, w₁; none equals the decimal string of a, b or a·b", desc: "The privacy check is heuristic (string level), not an information-theoretic proof" },
      { in: "ot, choice bit 0", out: "only m₀ is opened; m₁ stays masked", desc: "Simulation only; the public seed opens both, so there is no real OT security" },
    ],
    formulas: [
      { tex: "a=\\sum_i a_i,\\ b=\\sum_i b_i,\\ z=xy=\\sum_i z_i \\pmod p", caption: "Additive sharing: the shares sum back to the secret" },
      { tex: "w_i = z_i + d\\,y_i + e\\,x_i\\ (+\\,d e\\ \\text{for one party})", caption: "Beaver online phase: additions only, using public masks d and e" },
    ],
    tips: [
      "Beaver's essence is turning multiplication into addition: no multiplication round-trip online, at the cost of pre-generating triples offline.",
      "Do not treat this op's OT as a secure primitive: it masks with a public-seed PRF, so anyone can open both — the report says so explicitly.",
      "The reconstruction must equal a·b mod p; if not, check whether a share was altered (there is no MAC, so tampering silently produces a wrong value).",
      "Real malicious-security MPC needs MACs to check share consistency; this toy only shows the semi-honest shape.",
      "Classroom use: have three students each hold one row, then sum their w's — far more intuitive than staring at the formula.",
    ],
    aka: ["MPC", "安全多方计算", "secure multiparty computation", "Beaver 三元组", "Beaver triple",
      "秘密分享", "secret sharing", "加法分享", "additive sharing", "不经意传输", "OT", "1-of-2 OT",
      "oblivious transfer", "隐私计算", "半诚实模型", "教学 MPC"],
  },

  quantumToy: {
    what:
      "A **statevector teaching simulation** of two quantum algorithms: `grover` runs the full H → oracle phase flip → diffusion evolution and prints the hit probability per round; " +
      "`shor` only does the order-finding slice for N=15/21 (modular-exponentiation permutation + DFT + continued fractions) and self-checks p×q=N. " +
      "It is not a quantum computer simulator — it lays out the **algebraic skeleton** of both algorithms.",
    principle:
      "**Grover**: over the uniform superposition of n qubits the target amplitude is 1/√N. Each round (oracle flips the target's sign, then reflection about the mean) moves amplitude toward the target: " +
      "after k rounds the hit probability is sin²((2k+1)θ) with θ = arcsin(1/√N). The optimal count is k_opt = round(π/(4θ) − 1/2); " +
      "the common approximation ⌈π/4·√N⌉ **overestimates by one** for small N (this op prints both: 3 vs 4 at n=4). Past the optimum the probability falls again (over-rotation), which is observable here.\n\n" +
      "**Shor**: period finding → continued fractions give r → if r is even, gcd(a^{r/2} ± 1, N) yields a factor. " +
      "This implementation applies the modular-exponentiation permutation directly to the joint statevector |x⟩|y⟩ (length M×N) and then does a DFT on the counting register; " +
      "**this is not a gate-level decomposition** (no controlled modular-multiply gates, no gate-by-gate inverse QFT), and measurement is a deterministic max-probability pick rather than truly random.\n\n" +
      "**Complexity boundary**: n ≤ 5 (statevector length ≤ 32); Shor accepts only 15/21. Every extra bit doubles the statevector — " +
      "N ≥ 35 is rejected outright, because beyond that it is exponential blow-up, not \"slow\".",
    usage:
      "`grover`: pick `n` 2–5, put the target basis index in `target`, leave `iters` empty for the theoretical optimum (or set 0–32 to watch over-rotation). " +
      "`shor`: set `target` to 15 or 21; the output lists the period, continued-fraction convergents, factors and a self-check.\n\n" +
      "The output prints the complexity boundary (statevector length, memory, operation counts) so classes can compare against the classical cost directly.",
    examples: [
      { in: "grover n=4 target=5", out: "6.2500% → 47.2656% → 90.8447% → 96.1319% (k_opt=3)", desc: "Probability rises monotonically, optimum at round 3; the common ⌈π/4·√N⌉=4 overshoots" },
      { in: "grover n=4, 5 rounds", out: "hit probability falls back (over-rotation)", desc: "Past k_opt the amplitude is moved back, so probability stops being monotonic" },
      { in: "shor N=15", out: "period r=4, factors 3 × 5 = 15 ✓", desc: "continued fraction 4/16 → 1/4 gives denominator r=4; gcd(3,15)=3, gcd(5,15)=5" },
      { in: "shor N=21", out: "period r=6, factors 7 × 3 = 21 ✓", desc: "Factor order is not fixed, but the product self-checks" },
    ],
    formulas: [
      { tex: "P_k = \\sin^2\\!\\big((2k+1)\\theta\\big),\\quad \\theta=\\arcsin(1/\\sqrt{N})", caption: "Grover hit probability after k rounds; optimum k_opt = round(π/(4θ) − 1/2)" },
      { tex: "a^{r/2}\\pm 1 \\ \\Rightarrow\\ \\gcd(a^{r/2}\\pm1, N)", caption: "Shor post-processing: two gcds give non-trivial factors when r is even" },
    ],
    tips: [
      "Grover's \"√N speedup\" is relative to classical unordered search O(N); at N=16 only 3 rounds are optimal, but each round still costs O(N) oracle calls — the speedup is in round count, not per-round cost.",
      "Falling probability is not a bug: that is over-rotation, the intuitive lesson in \"knowing when to stop\".",
      "Shor's hard part is **gate-level modular exponentiation** (controlled modular multiplies, gate-by-gate QFT); this op bypasses it by acting on the statevector directly — so it does not prove \"quantum computers can factor large numbers\".",
      "N=15/21 are the classic teaching cases (small period, small statevector); anything larger blows up exponentially and is rejected rather than attempted.",
      "Classroom use: run grover to see the probability curve, then change iters to see the fall-back; for shor, follow the continued-fraction expansion to see why measuring 4/16 implies r=4.",
    ],
    aka: ["Grover", "格罗弗算法", "量子搜索", "quantum search", "Shor", "肖尔算法", "量子因数分解",
      "statevector", "量子模拟", "量子算法", "QFT", "连分数", "continued fraction",
      "教学量子计算", "振幅放大", "quantum toy"],
  },
};
