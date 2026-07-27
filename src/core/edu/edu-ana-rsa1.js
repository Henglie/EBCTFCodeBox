// 科普内容分片：analysis RSA/数论攻击前半（参数计算 + 基础数论工具）。纯数据，无 import 无副作用。
export default {
  rsaParams: {
    what: "RSA 参数计算器：知道两个素数 p、q 和公钥指数 e，一步算出模数 n、φ(n)、私钥 d，以及 CRT 加速用的 dp、dq、qinv。给了 p、q 的 RSA 题基本靠它秒解。",
    principle:
      "RSA 的全部秘密都由 p、q 决定：$n=pq$、$\\varphi(n)=(p-1)(q-1)$，私钥 $d \\equiv e^{-1} \\pmod{\\varphi(n)}$。\n\n" +
      "为了解密更快，实现常存 CRT 参数：$dp=d\\bmod(p-1)$、$dq=d\\bmod(q-1)$、$qinv=q^{-1}\\bmod p$。有了这些就能对密文解密。",
    usage: "输入框填 p 和 q（每行一个或逗号分隔），设定 e（常见 65537），输出 n、φ、d、dp、dq、qinv。",
    examples: [
      { in: "p=61, q=53", param: "e=17", out: "n=3233, φ=3120, d=2753", desc: "教科书小例子，可手推验证" },
    ],
    formulas: [
      { tex: "n=pq,\\quad \\varphi(n)=(p-1)(q-1),\\quad d\\equiv e^{-1}\\!\\!\\pmod{\\varphi(n)}", caption: "RSA 私钥推导" },
    ],
    tips: [
      "题目直接给了 p、q（或你用 factordb/Fermat/Pollard 分解出来了）→ 立刻用它求 d，再模幂解密。",
      "e 与 φ(n) 必须互质，否则 d 不存在（换 e 或检查 p、q）。",
    ],
    aka: ["rsa参数", "rsa params", "求私钥d", "rsa密钥推导", "rsa求d", "计算私钥", "rsa参数计算", "p q求n", "欧拉函数phi", "rsa key gen", "私钥生成", "rsa d计算", "crt参数"],
  },

  rsaPollard: {
    what: "Pollard rho 分解：一种比试除快得多的整数分解算法，特别擅长把「含有一个不太大的素因子」的合数 n 拆开。",
    principle:
      "用一个伪随机迭代 $x_{i+1}=x_i^2+c \\bmod n$ 制造一串数，靠 Floyd 龟兔判环找到两个满足 $x_i \\equiv x_j \\pmod p$ 的数（p 是某素因子）。此时 $\\gcd(|x_i-x_j|,\\,n)$ 大概率就是 p 的非平凡因子。",
    usage: "输入框填要分解的 n，工具跑 Pollard rho 找因子。适合半素数里含较小因子的情况。",
    examples: [
      { in: "n=8051", out: "8051 = 83 × 97" },
    ],
    formulas: [
      { tex: "x_{i+1} = x_i^2 + c \\bmod n,\\quad p = \\gcd(|x_i - x_j|,\\, n)", caption: "Pollard rho 迭代与因子提取" },
    ],
    tips: [
      "n 的两个素因子都非常大且相近时，Pollard 不占优 → 改用 Fermat（rsaFermat）。",
      "分解不出来先把 n 丢 factordb 查已知分解。",
    ],
    aka: ["pollard rho", "pollard分解", "rho分解", "整数分解", "波拉德rho", "pollard rho algorithm", "rho算法", "大数分解", "n分解", "半素数分解", "因子分解", "pollard因数分解", "floyd判环"],
  },

  rsaModinv: {
    what: "模逆元：求 a 在模 m 下的乘法逆元，即找 x 使得 a·x ≡ 1 (mod m)。RSA 求私钥 d、共模攻击、很多数论题都要它。",
    principle:
      "逆元存在的充要条件是 $\\gcd(a,m)=1$。用扩展欧几里得算法求出 $ax+my=1$ 里的 x，再取模 m 就是逆元。本工具自反：对逆元再求一次逆元还原回原数。",
    usage: "填 a 和 m，输出 a 模 m 的逆元。encode/decode 互逆（inv(inv(a))=a）。",
    examples: [
      { in: "a=17, m=3120", out: "d=2753", desc: "正是 e=17 在 φ=3120 下的私钥" },
      { in: "a=3, m=7", out: "5", desc: "3×5=15≡1 (mod 7)" },
    ],
    formulas: [
      { tex: "a\\,x \\equiv 1 \\pmod{m} \\;\\Leftrightarrow\\; a x + m y = 1", caption: "逆元存在当且仅当 gcd(a,m)=1" },
    ],
    tips: ["RSA 里求 d 就是求 e 模 φ(n) 的逆元；gcd≠1 时逆元不存在。"],
    aka: ["模逆", "模逆元", "modular inverse", "乘法逆元", "modinv", "mod inverse", "逆元", "模反元素", "逆元计算", "模m逆元", "inverse mod", "求逆元", "模逆运算"],
  },

  rsaEgcd: {
    what: "扩展欧几里得：在求最大公约数 gcd(a,b) 的同时，还给出 Bézout 系数 x、y，使 a·x + b·y = gcd。求模逆、共模攻击的底层零件。",
    principle:
      "普通欧几里得辗转相除只得 gcd；扩展版把每步的商回代，额外解出系数 x、y。当 $\\gcd(a,b)=1$ 时，x 就是 a 模 b 的逆元。",
    usage: "输入框填 a 和 b，输出 gcd 以及满足 ax+by=g 的整数 x、y。",
    examples: [
      { in: "a=240, b=46", out: "gcd=2, x=-9, y=47", desc: "240·(-9)+46·47 = 2" },
    ],
    formulas: [
      { tex: "a\\,x + b\\,y = \\gcd(a,b)", caption: "Bézout 恒等式" },
    ],
    tips: ["共模攻击里用它解 a·e1+b·e2=1；求逆元时取 x mod m 即可。"],
    aka: ["扩展欧几里得", "extended euclidean", "egcd", "bezout", "贝祖", "扩展欧几里得算法", "贝祖系数", "bezout coefficients", "extended gcd", "ext euclid", "裴蜀定理", "ax+by=gcd", "扩展辗转相除"],
  },

  rsaModpow: {
    what: "大数快速幂：算 base^exp mod m 这种超大指数的模幂。RSA 加解密（c=m^e mod n、m=c^d mod n）的核心运算，直接算会爆掉，必须用它。",
    principle:
      "把指数拆成二进制，用「平方-乘」逐位处理：每一步都对底数平方并取模，遇到指数的 1 位就额外乘一次。这样 e 有几十位也只需几十次乘法，且中间结果始终被 mod 压在范围内。",
    usage: "输入框填 base、exp、mod（每行一个或逗号分隔），输出 base^exp mod m。",
    examples: [
      { in: "base=65, exp=17, mod=3233", out: "2790", desc: "RSA 加密：m=65 → c=2790" },
      { in: "base=2790, exp=2753, mod=3233", out: "65", desc: "私钥解密还原 m" },
    ],
    formulas: [
      { tex: "c = m^e \\bmod n,\\qquad m = c^d \\bmod n", caption: "RSA 加解密即模幂" },
    ],
    tips: ["拿到 p、q、e 用 rsaParams 求出 d，再用它跑 c^d mod n 就得明文。"],
    aka: ["快速幂", "模幂", "modular exponentiation", "modpow", "平方乘", "大数快速幂", "快速幂取模", "模幂运算", "square and multiply", "pow mod", "幂模", "二进制快速幂", "modexp"],
  },
};
