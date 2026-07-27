// English edu shard: analysis RSA attacks, second half (side-channel / leaks / lattice attacks). Pure data, no imports, no side effects.
export default {
  rsaDpDqLeak: {
    what: "dp/dq leak attack: once the CRT-acceleration private-key fragment dp (=d mod p−1) leaks, you can dig out p directly without factoring n, and thereby recover the full private key d.",
    principle:
      "Given e, n, dp, where $dp \\equiv d \\pmod{p-1}$, i.e. $e\\cdot dp \\equiv 1 \\pmod{p-1}$. Take any base g (e.g. 2); by Fermat's little theorem $g^{(p-1)} \\equiv 1 \\pmod p$, one can derive that $\\gcd(g^{\\,e\\cdot dp}-g,\\ n)$ is very likely the prime factor p.\n\n" +
      "Once you have p, $q=n/p$, $\\varphi=(p-1)(q-1)$, $d\\equiv e^{-1}\\pmod{\\varphi}$, and the whole private key is recovered. A given dq can cross-verify.",
    usage: "Fill e, n, dp (dq optional); the tool uses a base to find p, q, then computes the full d.",
    examples: [
      { in: "e, n, dp", out: "p, q, d", desc: "derive the prime factor from dp, then find the private key" },
    ],
    formulas: [
      { tex: "p = \\gcd\\big(g^{\\,e\\cdot dp} - g,\\ n\\big)", caption: "g is an arbitrary base; in most cases this gives the non-trivial factor p" },
    ],
    tips: ["When the problem statement gives dp, dmp1 (the CRT parameters in a PEM) separately → this is the challenge. dp being far smaller than p is the key to it being exploitable."],
    aka: ["dp leak", "dq leak", "dp泄露", "crt参数泄露", "dp dq leak", "RSA dp泄露",
      "CRT参数攻击", "dmp1 dmq1", "dp dq攻击", "dp leak attack", "私钥碎片泄露", "CRT指数泄露"],
  },

  rsaLsbOracle: {
    what: "RSA LSB Oracle attack: as long as there's a 'service' willing to tell you the least significant bit (parity) of a decryption result, you can force out the entire plaintext bit by bit, without the private key.",
    principle:
      "Exploiting RSA's homomorphism: multiply the ciphertext c by $2^e$ and send it for decryption, which is equivalent to doubling the plaintext to $2m \\bmod n$. Since n is odd, $2m$ becomes odd if it exceeds n (one subtraction of n), and even if not — the least significant bit the oracle returns tells you which half of the interval m falls in.\n\n" +
      "Each query halves the possible interval for m; after $\\log_2 n$ bisections (about the number of ciphertext bits) the interval converges to the unique m.",
    usage: "Fill n, e, ciphertext c (when m is provided, it can simulate and verify locally); the tool does bisection to recover the plaintext.",
    examples: [
      { in: "n, e, c", out: "the plaintext interval narrowing each round → m", desc: "needs about (bit count) oracle queries" },
    ],
    formulas: [
      { tex: "c' = c\\cdot 2^e \\bmod n \\;\\Rightarrow\\; \\text{dec}(c') = 2m \\bmod n", caption: "multiplying by 2^e doubles the plaintext; the last bit leaks interval information" },
    ],
    tips: ["Signature: the problem gives an interface you can repeatedly query for 'decryption result parity / least significant bit' → bisection oracle."],
    aka: ["lsb oracle", "最低位oracle", "rsa奇偶oracle", "parity oracle", "RSA LSB Oracle", "LSB预言机",
      "奇偶预言机", "least significant bit oracle", "RSA最低位攻击", "二分oracle", "位泄露攻击", "RSA parity oracle"],
  },

  rsaBleichenbacher: {
    what: "Bleichenbacher attack (PKCS#1 v1.5 padding oracle): as long as a service is willing to distinguish 'is the padding format correct', you can peel out the plaintext bit by bit like an onion — hence the name 'million message attack'.",
    principle:
      "After PKCS#1 v1.5 encryption the plaintext starts with `00 02 …`. If some interface reacts differently to 'valid padding' vs 'invalid padding' (error, timing, status code), it becomes a padding oracle. The attacker keeps multiplying the ciphertext by different coefficients s and sending them, progressively tightening the interval where the plaintext lies by 'whether the padding is valid', ultimately locking in m.\n\n" +
      "This tool does the identification and parameter computation, explaining the conditions for the attack to be feasible (whether a distinguishable padding response exists).",
    usage: "Fill n, e and related response info; the tool determines whether the Bleichenbacher prerequisites are met and gives parameter hints.",
    examples: [
      { in: "n, e, padding response signature", out: "feasibility determination + attack parameter interval explanation" },
    ],
    tips: ["In reality the ROBOT vulnerability is its resurrection. Recognition point: the service gives distinguishable feedback for malformed ciphertexts."],
    aka: ["bleichenbacher", "padding oracle", "pkcs1 v1.5 攻击", "robot", "Bleichenbacher", "填充预言机攻击",
      "PKCS1填充攻击", "百万消息攻击", "million message attack", "ROBOT攻击", "PKCS#1 v1.5", "填充oracle"],
  },

  rsaCoppersmith: {
    what: "Coppersmith small-root attack: when only a small part of the plaintext/private key is unknown (e.g. the high bits are known and only the low dozens of bits are missing), lattice reduction can solve out that small unknown directly.",
    principle:
      "Core theorem: for a polynomial $f(x)\\equiv 0 \\pmod n$ modulo n, if the existing root $x_0$ is small enough (about $|x_0| < n^{1/\\deg f}$), it can be found in polynomial time with LLL lattice reduction.\n\n" +
      "Typical scenarios: known plaintext high bits with low bits to fill (stereotyped message), p high-bits leak to factor n, low-exponent broadcast with padding. This tool computes parameters (degree d, upper bound X) and gives a usage hint for SageMath's `small_roots`.",
    usage: "Fill n, e, and the structure of the known/unknown quantities; the tool gives the polynomial degree, an estimated upper bound on the root, and a Sage script template.",
    examples: [
      { in: "n, e, known plaintext high bits", out: "root upper bound X + SageMath small_roots hint", desc: "the actual solving runs in Sage" },
    ],
    formulas: [
      { tex: "|x_0| < n^{1/\\deg f}", caption: "rough upper bound for a solvable small root, deg f being the polynomial degree" },
    ],
    tips: ["Signature: small e + most of the plaintext known with only a small piece missing, or p's high bits leaked. The actual solving is left to SageMath."],
    aka: ["coppersmith", "小根攻击", "格攻击", "stereotyped message", "Coppersmith", "科波史密斯攻击",
      "LLL格约化", "small roots", "已知高位攻击", "coppersmith method", "格基约化攻击", "低指数明文攻击"],
  },

  rsaBonehDurfee: {
    what: "Boneh-Durfee attack: an upgraded version of Wiener's attack, raising the 'small private key is breakable' threshold from d < N^0.25 to d < N^0.292, taking down more small-d challenges.",
    principle:
      "When the private key $d < N^{0.292}$, the problem of finding d can be turned into a bivariate modular equation $f(x,y)\\equiv 0$, solved for a small root via Coppersmith-style lattice reduction (LLL) to get d, without factoring n.\n\n" +
      "This tool checks whether d falls within the attackable threshold and explains the lattice-construction method; the actual solving needs a SageMath lattice-reduction script.",
    usage: "Fill e, n (and, if known, the bit-length upper bound of d); the tool determines whether d < N^0.292 is satisfied and explains the method.",
    examples: [
      { in: "e, n", out: "d < N^0.292 threshold determination + lattice-attack method hint" },
    ],
    formulas: [
      { tex: "d < N^{0.292}", caption: "Boneh-Durfee attackable upper bound (better than Wiener's 0.25)" },
    ],
    tips: ["Try Wiener first (faster); if Wiener can't crack it but you suspect d is still small → go with Boneh-Durfee. The signature is still a huge e close to n."],
    aka: ["boneh durfee", "boneh-durfee", "小私钥攻击", "格攻击", "Boneh-Durfee", "博内-杜菲攻击",
      "小解密指数攻击", "Wiener加强版", "low private exponent", "d<N^0.292", "小d攻击", "格约化小私钥"],
  },
};
