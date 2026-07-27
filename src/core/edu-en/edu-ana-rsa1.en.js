// English edu shard: analysis RSA/number-theory attacks, first half (parameter computation + basic number-theory tools). Pure data, no imports, no side effects.
export default {
  rsaParams: {
    what: "RSA parameter calculator: given the two primes p, q and the public exponent e, compute in one step the modulus n, φ(n), the private key d, plus the CRT-acceleration values dp, dq, qinv. RSA challenges that hand you p and q are basically solved instantly with this.",
    principle:
      "All of RSA's secrets are determined by p and q: $n=pq$, $\\varphi(n)=(p-1)(q-1)$, and the private key $d \\equiv e^{-1} \\pmod{\\varphi(n)}$.\n\n" +
      "For faster decryption, implementations often store CRT parameters: $dp=d\\bmod(p-1)$, $dq=d\\bmod(q-1)$, $qinv=q^{-1}\\bmod p$. With these you can decrypt a ciphertext.",
    usage: "Fill p and q in the input box (one per line or comma-separated), set e (commonly 65537); outputs n, φ, d, dp, dq, qinv.",
    examples: [
      { in: "p=61, q=53", param: "e=17", out: "n=3233, φ=3120, d=2753", desc: "textbook small example, verifiable by hand" },
    ],
    formulas: [
      { tex: "n=pq,\\quad \\varphi(n)=(p-1)(q-1),\\quad d\\equiv e^{-1}\\!\\!\\pmod{\\varphi(n)}", caption: "RSA private-key derivation" },
    ],
    tips: [
      "The challenge gives p, q directly (or you factored them out with factordb/Fermat/Pollard) → immediately use it to find d, then modular-exponentiate to decrypt.",
      "e must be coprime with φ(n), otherwise d does not exist (change e or check p, q).",
    ],
    aka: ["rsa参数", "rsa params", "求私钥d", "rsa密钥推导", "rsa求d", "计算私钥", "rsa参数计算", "p q求n", "欧拉函数phi", "rsa key gen", "私钥生成", "rsa d计算", "crt参数"],
  },

  rsaPollard: {
    what: "Pollard's rho factorization: an integer-factoring algorithm much faster than trial division, especially good at splitting a composite n that 'contains a not-too-large prime factor'.",
    principle:
      "Use a pseudo-random iteration $x_{i+1}=x_i^2+c \\bmod n$ to produce a sequence, and use Floyd's tortoise-and-hare cycle detection to find two values satisfying $x_i \\equiv x_j \\pmod p$ (p being some prime factor). At that point $\\gcd(|x_i-x_j|,\\,n)$ is very likely a non-trivial factor of p.",
    usage: "Fill in the n to factor; the tool runs Pollard's rho to find a factor. Suited to semiprimes containing a smaller factor.",
    examples: [
      { in: "n=8051", out: "8051 = 83 × 97" },
    ],
    formulas: [
      { tex: "x_{i+1} = x_i^2 + c \\bmod n,\\quad p = \\gcd(|x_i - x_j|,\\, n)", caption: "Pollard's rho iteration and factor extraction" },
    ],
    tips: [
      "When both prime factors of n are very large and close together, Pollard doesn't have the edge → switch to Fermat (rsaFermat).",
      "If it won't factor, first throw n at factordb to look up a known factorization.",
    ],
    aka: ["pollard rho", "pollard分解", "rho分解", "整数分解", "波拉德rho", "pollard rho algorithm", "rho算法", "大数分解", "n分解", "半素数分解", "因子分解", "pollard因数分解", "floyd判环"],
  },

  rsaModinv: {
    what: "Modular inverse: find the multiplicative inverse of a modulo m, i.e. an x such that a·x ≡ 1 (mod m). RSA's private key d, common-modulus attacks, and many number-theory challenges all need it.",
    principle:
      "The inverse exists if and only if $\\gcd(a,m)=1$. Use the extended Euclidean algorithm to solve for x in $ax+my=1$, then reduce mod m to get the inverse. This tool is self-inverse: taking the inverse of the inverse returns the original number.",
    usage: "Fill in a and m; outputs the inverse of a mod m. encode/decode are mutually inverse (inv(inv(a))=a).",
    examples: [
      { in: "a=17, m=3120", out: "d=2753", desc: "exactly the private key for e=17 under φ=3120" },
      { in: "a=3, m=7", out: "5", desc: "3×5=15≡1 (mod 7)" },
    ],
    formulas: [
      { tex: "a\\,x \\equiv 1 \\pmod{m} \\;\\Leftrightarrow\\; a x + m y = 1", caption: "the inverse exists iff gcd(a,m)=1" },
    ],
    tips: ["In RSA, finding d is finding the inverse of e modulo φ(n); when gcd≠1 the inverse doesn't exist."],
    aka: ["模逆", "模逆元", "modular inverse", "乘法逆元", "modinv", "mod inverse", "逆元", "模反元素", "逆元计算", "模m逆元", "inverse mod", "求逆元", "模逆运算"],
  },

  rsaEgcd: {
    what: "Extended Euclidean: while computing the gcd(a,b), also produce the Bézout coefficients x, y such that a·x + b·y = gcd. The underlying building block for modular inverse and common-modulus attacks.",
    principle:
      "Plain Euclidean division only yields the gcd; the extended version back-substitutes each step's quotient to additionally solve for the coefficients x, y. When $\\gcd(a,b)=1$, x is the inverse of a modulo b.",
    usage: "Fill a and b in the input box; outputs the gcd along with integers x, y satisfying ax+by=g.",
    examples: [
      { in: "a=240, b=46", out: "gcd=2, x=-9, y=47", desc: "240·(-9)+46·47 = 2" },
    ],
    formulas: [
      { tex: "a\\,x + b\\,y = \\gcd(a,b)", caption: "Bézout's identity" },
    ],
    tips: ["In common-modulus attacks use it to solve a·e1+b·e2=1; for the inverse just take x mod m."],
    aka: ["扩展欧几里得", "extended euclidean", "egcd", "bezout", "贝祖", "扩展欧几里得算法", "贝祖系数", "bezout coefficients", "extended gcd", "ext euclid", "裴蜀定理", "ax+by=gcd", "扩展辗转相除"],
  },

  rsaModpow: {
    what: "Big-number fast modular exponentiation: compute base^exp mod m for huge exponents. It's the core operation of RSA encryption/decryption (c=m^e mod n, m=c^d mod n); computing it directly would blow up, so this is required.",
    principle:
      "Break the exponent into binary and process it bit by bit with 'square-and-multiply': each step squares the base and takes the modulus, and on each 1 bit of the exponent multiplies once more. This way even a dozens-of-digits e needs only dozens of multiplications, and intermediate results stay bounded by mod.",
    usage: "Fill base, exp, mod in the input box (one per line or comma-separated); outputs base^exp mod m.",
    examples: [
      { in: "base=65, exp=17, mod=3233", out: "2790", desc: "RSA encryption: m=65 → c=2790" },
      { in: "base=2790, exp=2753, mod=3233", out: "65", desc: "private-key decryption restores m" },
    ],
    formulas: [
      { tex: "c = m^e \\bmod n,\\qquad m = c^d \\bmod n", caption: "RSA encryption/decryption is modular exponentiation" },
    ],
    tips: ["Once you have p, q, e, use rsaParams to find d, then run c^d mod n with this to get the plaintext."],
    aka: ["快速幂", "模幂", "modular exponentiation", "modpow", "平方乘", "大数快速幂", "快速幂取模", "模幂运算", "square and multiply", "pow mod", "幂模", "二进制快速幂", "modexp"],
  },
};
