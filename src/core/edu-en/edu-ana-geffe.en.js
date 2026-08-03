/*
 * edu-ana-geffe.en.js — Geffe generator / correlation attack English edu card (analysis category).
 *
 * Translation of src/core/edu/edu-ana-geffe.js.
 * Op covered: geffe
 * Pure data, no side effects. Export contract matches eduContent.js header.
 *
 * Example data is real (verified by 工具/_geffe_probe.mjs against src/core/geffe.js),
 * not fabricated — per project red line "algorithm correctness requires authoritative
 * implementation + reproducible examples".
 */
export default {
  geffe: {
    what: "Geffe generator — An LFSR combining generator proposed by P. R. Geffe in 1973: three independent LFSRs are combined by the nonlinear function f(x1,x2,x3)=x1·x2⊕x2·x3⊕x3 to produce a keystream. Once thought \"nonlinear = secure\", but Siegenthaler (1984) showed f has 3/4 correlation with x1 and x3, enabling a correlation attack that recovers each LFSR by brute force — a high-frequency CTF crypto stream cipher topic.",
    principle:
      "An LFSR (Linear Feedback Shift Register) uses a feedback polynomial `x^L+...+1` to recursively generate a periodic bit sequence; the initial state is the first L bits. Fibonacci LFSR recurrence: `s[n] = Σ s[n-t] (mod 2)`, where t ranges over the tap position set. E.g. taps `[1,4]` = polynomial `x^4+x+1`, degree L=4.\n\n" +
      "Geffe combination: three LFSRs output synchronously, combined by `f(x1,x2,x3) = x1·x2 ⊕ x2·x3 ⊕ x3`. Equivalently: when x2=0, f=x3; when x2=1, f=x1 — x2 acts as a \"selector\" that routes either L1 or L3 to the output.\n\n" +
      "The correlation vulnerability: since x2 is a selector, the correlation between f and x1 is `P(f=x1) = P(x2=1) + P(x2=0)·P(x3=x1) = 1/2 + 1/2·1/2 = 3/4`. Similarly `P(f=x3)=3/4`, while `P(f=x2)=1/2` (no linear correlation with x2). This is Geffe's fatal weakness — 3/4 ≫ 1/2 is statistically distinguishable.\n\n" +
      "Correlation attack: brute force all 2^L1 initial states of LFSR1; for each, generate an N-bit sequence and compare bitwise with the keystream. The correct initial state has match rate ≈0.75, wrong states ≈0.5 (independent random); with N large enough the statistics clearly separate. Same for LFSR3. LFSR2, with P=0.5 and no linear correlation, must be brute-forced over all 2^L2 initial states, verifying each candidate against the recovered L1/L3 (bruteL2).\n\n" +
      "Complexity comparison: brute-forcing Geffe directly = `2^(L1+L2+L3)`; correlation attack = `2^L1 + 2^L3 + 2^L2` (L2 portion) — an exponential reduction. E.g. with L1=L2=L3=20, direct brute force 2^60 is infeasible, but correlation attack 2^20+2^20+2^20≈3M runs in seconds.",
    usage:
      "Select mode: generate (known 3 LFSR taps + initial states → keystream, for constructing test cases) / attack (known keystream + 3 taps → recover L1/L3 initial states, optionally brute-force L2).\n\n" +
      "Tap format: \"1,4\" or \"1 4\" or \"x^4+x+1\"; the highest degree = LFSR length L. Initial state is a bitstring of length L (e.g. L=4 → 0001); hex (0x..) is also accepted.\n\n" +
      "Attack mode: paste the keystream (0/1 string, tolerates spaces/newlines/commas) into the input box, fill in the 3 tap parameters, optionally check bruteL2 (works when L2 ≤ 22). When L > 22 brute force is infeasible (2^22≈4M); use `lfsrRecover` (Berlekamp-Massey) instead.",
    examples: [
      {
        in: "",
        param: "mode=generate, lfsr1Taps=1,4 / lfsr2Taps=2,5 / lfsr3Taps=1,6, lfsr1Init=0001 / lfsr2Init=00001 / lfsr3Init=000001, length=40",
        out: "0000111110100010101111010100100001011010",
        desc: "Three short LFSRs (L1=4 / L2=5 / L3=6) combined into a 40-bit keystream via f=x1x2⊕x2x3⊕x3",
      },
      {
        in: "0000111110100010101111010100100001011010",
        param: "mode=attack, lfsr1Taps=1,4 / lfsr2Taps=2,5 / lfsr3Taps=1,6, bruteL2=true",
        out: "L1=0001(rate=0.8000)  L3=000001(rate=0.7250)  L2=00001(brute-force hit)",
        desc: "40 bits of keystream is enough to recover all three initial states. L1/L3 via correlation attack (rate≈0.75); L2 via brute force verified by L1/L3",
      },
    ],
    tips: [
      "A CTF stream-cipher challenge that hands you a long 0/1 string plus three feedback polynomials (e.g. x^4+x+1 / x^5+x^2+1 / x^6+x+1) is almost certainly Geffe — three LFSRs + a selector function is its fingerprint.",
      "Longer keystream = more accurate recovery: distinguishing 0.75 from 0.5 statistically needs enough samples, recommend N ≥ 10×max(L1,L3). N=30 may fail (short-sample noise), N≥40 is usually stable.",
      "LFSR2 with P=0.5 cannot be recovered by correlation attack directly — must check bruteL2 to brute-force + verify with L1/L3, or run lfsrRecover (Berlekamp-Massey) directly on the keystream to find an equivalent LFSR.",
      "When L > 22, 2^L brute force is infeasible (2^22≈4M); algebraic attacks (Gröbner basis / BM + known plaintext) are needed — this tool explicitly reports \"L too large\".",
      "The combining function f=x1x2⊕x2x3⊕x3 is equivalent to \"x2 is a selector\": x2=0 outputs x3, x2=1 outputs x1. Seeing this structure immediately suggests Geffe.",
      "The correlation attack idea generalizes: any LFSR combining generator whose combining function has P>1/2 correlation with some input can be recovered LFSR-by-LFSR by brute force (Siegenthaler 1984).",
    ],
    aka: [
      "Geffe生成器", "Geffe generator", "Geffe 相关攻击", "correlation attack",
      "相关攻击", "LFSR组合生成器", "组合生成器", "非线性组合生成器",
      "Geffe 1973", "Siegenthaler", "P=3/4", "选择器函数",
      "流密码攻击", "LFSR攻击", "CTF crypto", "Geffe cipher",
      "stream cipher attack", "LFSR correlation", "LFSR combining generator",
      "nonlinear combining function", "Geffe stream cipher",
    ],
  },
};
