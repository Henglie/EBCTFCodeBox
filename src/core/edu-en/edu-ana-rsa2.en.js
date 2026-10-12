// English edu shard: analysis RSA attacks, second half (side-channel / leaks / lattice attacks). Pure data, no imports, no side effects.
export default {
  rsaDpDqLeak: {
    what: "dp/dq leak attack: once the CRT-acceleration private-key fragment dp ($= d \\bmod (p-1)$) leaks, you can dig out p directly without factoring n, and thereby recover the full private key d.",
    principle:
      "Given e, n, dp, where $dp \\equiv d \\pmod{p-1}$, i.e. $e\\cdot dp \\equiv 1 \\pmod{p-1}$. Take any base g (e.g. 2); by Fermat's little theorem $g^{(p-1)} \\equiv 1 \\pmod p$, one can derive that $\\gcd(g^{\\,e\\cdot dp}-g,\\ n)$ is very likely the prime factor p.\n\n" +
      "Once you have p, $q=n/p$, $\\varphi=(p-1)(q-1)$, $d\\equiv e^{-1}\\pmod{\\varphi}$, and the whole private key is recovered. A given dq can cross-verify.",
    usage: "Fill e, n, dp (dq optional); the tool uses a base to find p, q, then computes the full d.",
    examples: [
      { in: "", param: "e=65537, n=100160063, dp=9353, dq=2177", out: "dp/dq 泄露攻击\n  e  = 65537\n  n  = 100160063\n  dp = 9353\n  dq = 2177\n\n=== 攻击成功 ===\n  p = 10007\n  q = 10009\n  d = 35910881\n  dq 验证: 通过 ✓\n\n原理: dp*e ≡ 1 (mod p-1) → dp*e-1 = k*(p-1), k ∈ [1,e)\n     遍历 k 求 p = (dp*e-1)/k + 1，检查 p | n", desc: "p=10007, q=10009, d=35910881; verbatim from the parameter boxes" },
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
      { in: "", param: "n=10403, e=5, c=6262, m=4242", out: "LSB Oracle 攻击（模拟模式，已知明文验证）\n  n = 10403\n  e = 5\n  c = 6262\n  对分轮数: 13（响应序列含第 0 轮共 14 位）\n\n步骤   1: oracle(c*(2^e)^1 mod n) → bit=0 | m ∈ [0, 5202)\n步骤   2: oracle(c*(2^e)^2 mod n) → bit=1 | m ∈ [2600, 5202)\n步骤   3: oracle(c*(2^e)^3 mod n) → bit=1 | m ∈ [3901, 5202)\n步骤   4: oracle(c*(2^e)^4 mod n) → bit=0 | m ∈ [3901, 4552)\n步骤   5: oracle(c*(2^e)^5 mod n) → bit=1 | m ∈ [4226, 4552)\n步骤   6: oracle(c*(2^e)^6 mod n) → bit=0 | m ∈ [4226, 4389)\n步骤   7: oracle(c*(2^e)^7 mod n) → bit=0 | m ∈ [4226, 4308)\n步骤   8: oracle(c*(2^e)^8 mod n) → bit=0 | m ∈ [4226, 4267)\n步骤   9: oracle(c*(2^e)^9 mod n) → bit=0 | m ∈ [4226, 4247)\n步骤  10: oracle(c*(2^e)^10 mod n) → bit=1 | m ∈ [4236, 4247)\n步骤  11: oracle(c*(2^e)^11 mod n) → bit=1 | m ∈ [4241, 4247)\n步骤  12: oracle(c*(2^e)^12 mod n) → bit=0 | m ∈ [4241, 4244)\n步骤  13: oracle(c*(2^e)^13 mod n) → bit=0 | m ∈ [4241, 4243)\n\n恢复明文 m = 4242\n实际明文 m = 4242\n匹配: ✓ 成功\n校验: m^e mod n ≡ c ✓\n\n原理: oracle(Dec(c')) 返回明文最低位。c' = c * 2^e mod n → Dec(c') = 2m mod n。\n     若 2m < n → LSB=0, m ∈ [0, n/2)；若 2m ≥ n → LSB=1, m ∈ [n/2, n)。\n     每次乘 2（密文乘 2^e），二分逼近明文区间，log2(n) 轮恢复全部位。", desc: "local simulation mode: 13 bisection rounds recover m=4242; verbatim run output" },
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
      { in: "", param: "n=79228162458009874658044684943, e=65537, c=77592157001850136626969509075", out: "Bleichenbacher PKCS#1 v1.5 Padding Oracle 攻击\n  n = 79228162458009874658044684943 (12 字节)\n  e = 65537\n  c = 77592157001850136626969509075\n\n本次未提供 serverKey，仅输出参数与攻击前提：\n  PKCS#1 v1.5 格式：0x00 02 <PS≥8字节非零> 0x00 <message>\n  B = 2^(8·(12-2)) = 2^80（padding 下界），初始明文区间 [2B, 3B-1]\n  明文最大长度: 1 字节\n\n完整攻击需在 serverKey 填入 oracle 侧私钥（hex）：\n  · 私钥 d（单个 hex 大数），或\n  · p,q（两个 hex 数，逗号分隔）——自动算 d\n\n填入后本工具即运行标准 Bleichenbacher 区间归约循环（Step 1/2a/2b/2c/3/4）解出 m：\n  s1 从 ceil(n/3B) 起线性扫描找 PKCS 合规 s；随后按论文公式收缩/合并区间；\n  区间收缩为单点即明文。maxS 护栏默认 100 万次查询防卡死，每 5000 次查询输出进度快照。", desc: "verbatim run output without serverKey: premises and parameters; supply p,q to run the real attack" },
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
      { in: "", param: "n=1000036000099, e=3, c=571985985655, knownPrefix=AB, unknownBytes=1", out: "Coppersmith 小根攻击 · stereotyped message（Howgrave-Graham 构格 + BigInt LLL）\n  n = 1000036000099 (40 bits)\n  e = 3（多项式次数 δ = 3）\n  c = 571985985655\n  未知字节: 1 → 根上界 X = 2^8\n  beta = 1（根所在因子下界 b ≥ n^beta；beta=1 即模 n）\n  理论界: X < n^(beta²/δ) = 2^13\n  f(x) = (4276736 + x)^3 − c  (mod n)，m = 前缀·256^1 + x\n\n● 尝试格序列（Howgrave-Graham 条件过筛）: m=2,t=2,w=8\n\n=== 攻击成功 ===\n小根 x = 42 (0x2a)\n完整明文 m = 4276778\nhex = 0x000041422a\nUTF-8 尝试: \u0000\u0000AB*\n校验: m^e mod n ≡ c ✓\n格: 8×8，LLL 归约后第 1 行（含）内命中", desc: "prefix AB + 1 unknown byte; the LLL run recovers x=42 → m=4276778" },
    ],
    formulas: [
      { tex: "|x_0| < n^{1/\\deg f}", caption: "rough upper bound for a solvable small root, deg f being the polynomial degree" },
    ],
    tips: ["Signature: small e + most of the plaintext known with only a small piece missing, or p's high bits leaked. The actual solving is left to SageMath."],
    aka: ["coppersmith", "小根攻击", "格攻击", "stereotyped message", "Coppersmith", "科波史密斯攻击",
      "LLL格约化", "small roots", "已知高位攻击", "coppersmith method", "格基约化攻击", "低指数明文攻击"],
  },

  rsaBonehDurfee: {
    what: "Boneh-Durfee attack: an upgraded version of Wiener's attack, raising the 'small private key is breakable' threshold from $d < N^{0.25}$ to $d < N^{0.292}$, taking down more small-d challenges.",
    principle:
      "When the private key $d < N^{0.292}$, the problem of finding d can be turned into a bivariate modular equation $f(x,y)\\equiv 0$, solved for a small root via Coppersmith-style lattice reduction (LLL) to get d, without factoring n.\n\n" +
      "This tool checks whether d falls within the attackable threshold and explains the lattice-construction method; the actual solving needs a SageMath lattice-reduction script.",
    usage: "Fill e, n (and, if known, the bit-length upper bound of d); the tool determines whether $d < N^{0.292}$ is satisfied and explains the method.",
    examples: [
      { in: "", param: "n=100160063, e=60084029", out: "Boneh-Durfee 攻击提示\n  n = 100160063 (27 bits)\n  e = 60084029\n\n攻击条件：\n  Boneh-Durfee: d < N^0.292\n    阈值: d < 2^7（约 1 字节）\n    若 d 小于此阈值 → 可用格方法恢复 d\n\n  对比 Wiener 攻击（rsatool.js 已实现）：\n    Wiener 条件: d < N^0.25 = 2^6\n    Boneh-Durfee 比 Wiener 覆盖范围更大（0.292 > 0.25）\n\n方法概述：\n  1. ed ≡ 1 (mod φ(n)) → ed - 1 = kφ(n) → ed + k*(p+q-1) - kn = 1\n  2. 设 s = -(p+q), 则 e*d + k*(s-1) - k*n = 1（含 d, k, s 三变量）\n  3. 用 Coppersmith 多变量方法求小根 (d, k, s)\n  4. 从 s = -(p+q) 恢复 p+q，结合 n = p*q 分解 n\n\n注意：多变量 Coppersmith（Boneh-Durfee）本工具未实现，此 op 提供条件检查和方法说明。\n      单变量 Coppersmith 已在 rsaCoppersmith 落地（stereotyped message 场景）。\n      实际多变量攻击推荐使用 SageMath + defund/coppersmith 实现。\n      若 d < N^0.25，可直接用 rsatool.js 的 rsaWiener（连分数法）。", desc: "threshold check for a huge e close to n (small-d signal), verbatim run output" },
    ],
    formulas: [
      { tex: "d < N^{0.292}", caption: "Boneh-Durfee attackable upper bound (better than Wiener's 0.25)" },
    ],
    tips: ["Try Wiener first (faster); if Wiener can't crack it but you suspect d is still small → go with Boneh-Durfee. The signature is still a huge e close to n."],
    aka: ["boneh durfee", "boneh-durfee", "小私钥攻击", "格攻击", "Boneh-Durfee", "博内-杜菲攻击",
      "小解密指数攻击", "Wiener加强版", "low private exponent", "d<N^0.292", "小d攻击", "格约化小私钥"],
  },
};
