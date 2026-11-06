/*
 * dcode-extras · 数学工具与数列批（对标 dCode Arithmétique/Séries/Mathématiques 未入主件部分）
 * 主件已有的：质因数分解/约数/φ/模逆/CRT/μ/素性/连分数（数论插件）、斐波那契/Zeckendorf/
 * 罗马数字/Collatz/进制系（主程序）不在本批重复。
 */

import {
  big, isIntStr, isPrime, factorizeBounded, binom, runOp, parseNums,
  log10Factorial, estimateFactorialDigits, assertFactorialBudget, assertBudget,
  factorialBudgetBytes, factorialBigAsync, factorialBigSync, formatBytes, firstPrimes, productTreeBig,
} from "../lib/util.js";

const CAT = "dcode-extras-2026-10/cat-math";
const P = (key, label, ph) => ({ key, label, type: "text", default: "", placeholder: ph || "" });

function needBig(v, what) { if (v === null) throw new Error(`需要整数 ${what}`); return v; }

function absB(x) { return x < 0n ? -x : x; }

/** 大整数十进制对数（只取前 15 位尾数，避免 Number(BigInt) 溢出）。 */
function log10Big(x) {
  if (x === 0n) return -Infinity;
  const s = absB(x).toString();
  if (s.length <= 15) return Math.log10(Number(s));
  return Math.log10(Number(s.slice(0, 15))) + (s.length - 15);
}

/** 大整数自然对数（同样走「尾数 + 10 的幂」路径）。 */
function lnBig(x) {
  if (x === 0n) return -Infinity;
  const s = absB(x).toString();
  if (s.length <= 15) return Math.log(Number(s));
  return Math.log(Number(s.slice(0, 15))) + (s.length - 15) * Math.LN10;
}

function gcdB(a, b) {
  a = absB(a); b = absB(b);
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}

const STRIP_PRIMES = (() => {
  const out = [];
  for (let i = 2; i < 5000; i++) {
    let p = true;
    for (let j = 2; j * j <= i; j++) if (i % j === 0) { p = false; break; }
    if (p) out.push(BigInt(i));
  }
  return out;
})();

/**
 * factorizeBounded 的输入侧预算。
 * 先剥掉分解器同样会试除的 <5000 小素数：大素数幂/光滑数不因位数被误拒；
 * 剩余若是素数，Miller–Rabin 可快速判定；只有「硬合数」才按 Pollard rho 单轮 200000 次迭代计费。
 */
function assertFactorSearch(n, label) {
  let r = absB(n);
  for (const p of STRIP_PRIMES) while (r % p === 0n) r /= p;
  if (r <= 1n) {
    assertBudget("bigSteps", 1, `${label}（小素数试除）`);
    return 1;
  }
  const digits = r.toString().length;
  if (isPrime(r)) {
    assertBudget("bigSteps", Math.max(1, digits * digits), `${label}（Miller–Rabin 素性判定）`);
    return digits;
  }
  assertBudget("bigSteps", digits * 200_000, `${label}（Pollard rho 单轮 200000 次迭代）`);
  return digits;
}

/**
 * 有理数 n/d 的十进制展开。
 * 分母只含因子 2/5 时给精确值；否则按 sig 位有效数字截断并明确标注「近似」。
 */
function decimalOfFraction(n, d, label, sig = 24) {
  const neg = n < 0n;
  const a = neg ? -n : n;
  const int = a / d;
  let rem = a % d;
  const sign = neg ? "-" : "";
  if (rem === 0n) return { text: sign + int.toString(), exact: true };
  assertBudget("chars", absB(d).toString().length * 4 + int.toString().length + sig + 8, `${label}十进制展开`);
  let dd = d, twos = 0, fives = 0;
  while (dd % 2n === 0n) { dd /= 2n; twos++; }
  while (dd % 5n === 0n) { dd /= 5n; fives++; }
  if (dd === 1n) {
    const places = Math.max(twos, fives);
    const scaled = (a * 10n ** BigInt(places)) / d;
    const s = scaled.toString().padStart(places + 1, "0");
    return { text: `${sign}${s.slice(0, -places)}.${s.slice(-places)}`, exact: true };
  }
  let frac = "";
  for (let i = 0; i < sig && rem !== 0n; i++) {
    rem *= 10n;
    frac += (rem / d).toString();
    rem %= d;
  }
  return { text: `${sign}${int.toString()}.${frac}…`, exact: false };
}

/** 数字根（反复求位和到一位）。 */
function digitalRoot(n) {
  let s = 0n;
  for (const ch of n.toString()) s += BigInt(ch);
  return s < 10n ? s : digitalRoot(s);
}

export const OPS = [
  runOp("dcode-extras-2026-10/math-kaprekar", CAT, "Kaprekar 例行程序", "四位（或三位）Kaprekar：位降序−位升序反复迭代至 6174/495，给步数轨迹（OEIS A099009 口径）",
    (t, p) => {
      const n = needBig(big((p && p.n) || t), "n（3 或 4 位，各位不全同）");
      const digits = n.toString();
      if (digits.length !== 3 && digits.length !== 4) throw new Error("n 必须是 3 位或 4 位正整数");
      if (new Set(digits).size === 1) throw new Error("各位全相同的数在 Kaprekar 例行中永远不动，请换一个");
      const goal = digits.length === 3 ? 495n : 6174n;
      const steps = [n];
      const maxSteps = 6 * digits.length;
      let cur = n, guard = 0;
      while (cur !== goal && guard++ < maxSteps) {
        const ds = cur.toString().padStart(digits.length, "0").split("").sort();
        const lo = BigInt(ds.join("")), hi = BigInt(ds.reverse().join(""));
        cur = hi - lo;
        steps.push(cur);
      }
      if (cur !== goal) throw new Error(`Kaprekar 例行在 ${maxSteps} 步内未到达 ${goal}（3/4 位算法域理论上界被打破）`);
      return `${n} → ${goal} 共 ${steps.length - 1} 步\n${steps.join(" → ")}`;
    }, [P("n", "n", "如 3524")]),

  runOp("dcode-extras-2026-10/math-armstrong", CAT, "Armstrong 自恋数判定", "各位数字的 n 次幂之和是否等于自身（153=1³+5³+3³）；附区间列举",
    (t, p) => {
      const src = String((p && p.n) || t).trim();
      if (/^\d+$/.test(src)) {
        const L = src.length;
        assertBudget("chars", L * L + L * 8 + 50, "Armstrong 判定输出（每位 L 位幂值）");
        assertBudget("bigSteps", L * Math.max(1, Math.log2(L + 1)) * Math.max(1, Math.ceil(L / 9)), "Armstrong 大数幂运算");
        const n = BigInt(src), k = BigInt(L), s = [...src].reduce((a, c) => a + BigInt(c) ** k, 0n);
        return s === n ? `${n} 是 ${L} 位 Armstrong 数（${[...src].map((c) => `${c}^${L}`).join(" + ")} = ${n}）` : `${n} 不是 Armstrong 数（各位 ${L} 次幂和 = ${s}）`;
      }
      const [a, b] = src.split(/\s*[,~到]\s*/).map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b) || b < a) throw new Error("给单个整数做判定，或给区间 a,b");
      if (b > Number.MAX_SAFE_INTEGER) throw new Error("区间端点需 ≤ 2^53-1（JS 可精确枚举的整数域）");
      const count = b - a + 1, digits = String(b).length;
      assertBudget("steps", count * digits, `Armstrong 区间 ${a}..${b} 逐数判定`);
      const hits = [];
      for (let i = a; i <= b; i++) {
        const s = String(i), k = s.length; let sum = 0;
        for (const c of s) sum += (c.charCodeAt(0) - 48) ** k;
        if (sum === i) hits.push(i);
      }
      assertBudget("chars", hits.length * (digits + 8) + 80, `Armstrong 区间 ${a}..${b} 结果输出`);
      return `[${a},${b}] 内 Armstrong 数（${hits.length} 个）：${hits.join(", ") || "无"}`;
    }, [P("n", "n 或区间 a,b", "如 153 或 100,10000")]),

  runOp("dcode-extras-2026-10/math-harshad", CAT, "Harshad 数判定", "位和整除自身（18/(1+8)=2）；附区间列举",
    (t, p) => {
      const src = String((p && p.n) || t).trim();
      const digitSumBig = (x) => { let s = 0n; for (const c of x.toString()) s += BigInt(c.charCodeAt(0) - 48); return s; };
      if (/^\d+$/.test(src)) {
        assertBudget("chars", src.length, "Harshad 输入位数");
        assertBudget("steps", src.length, "Harshad 位和判定");
        const n = big(src);
        const s = digitSumBig(n);
        return n % s === 0n
          ? `${n} 是 Harshad 数（位和 ${s}，${n}/${s}=${n / s}）`
          : `${n} 不是 Harshad 数（位和 ${s}，不整除）`;
      }
      const [a, b] = src.split(/\s*[,~到]\s*/).map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b) || b < a) throw new Error("给单个整数，或区间 a,b");
      if (b > Number.MAX_SAFE_INTEGER) throw new Error("区间端点需 ≤ 2^53-1（JS 可精确枚举的整数域）");
      const lo = Math.max(1, a);
      if (b < lo) return `[${a},${b}] 内 Harshad 数（0 个）：`;
      const count = b - lo + 1, digits = String(b).length;
      assertBudget("steps", count * digits, `Harshad 区间 ${a}..${b} 逐数判定`);
      const hits = [];
      for (let i = lo; i <= b; i++) {
        const n = BigInt(i), s = digitSumBig(n);
        if (n % s === 0n) hits.push(i);
      }
      assertBudget("chars", hits.length * (digits + 6) + 80, `Harshad 区间 ${a}..${b} 结果输出`);
      return `[${a},${b}] 内 Harshad 数（${hits.length} 个）：${hits.join(", ")}`;
    }, [P("n", "n 或区间 a,b", "如 18 或 1,100")]),

  runOp("dcode-extras-2026-10/math-carmichael", CAT, "Carmichael 数判定", "合数且对全部互素 a 满足 aⁿ⁻¹≡1 (mod n)（561/1105/1729）；用 Korselt 判据：无平方因子且 p−1 | n−1",
    (t, p) => {
      const n = needBig(big((p && p.n) || t), "n");
      if (n < 3n) throw new Error("需要 ≥3 的整数");
      assertFactorSearch(n, "Carmichael 质因数分解");
      if (isPrime(n)) return `${n} 是素数，不是 Carmichael 数（Carmichael 数必须是合数）`;
      const f = factorizeBounded(n);
      if (!f.complete) throw new Error("n 过大无法完全分解，Carmichael 判定需要完整分解");
      for (const e of f.factors.values()) if (e > 1) return `${n} 含平方因子，不满足 Korselt 判据，不是 Carmichael 数`;
      const bad = [...f.factors.keys()].find((q) => (n - 1n) % (q - 1n) !== 0n);
      if (bad !== undefined) return `${n} 的素因子 ${bad} 不满足 (p−1) | (n−1)，不是 Carmichael 数`;
      return `${n} 是 Carmichael 数（Korselt 判据：squarefree 且全部 p−1 整除 n−1；素因子 ${[...f.factors.keys()].join(", ")}）`;
    }, [P("n", "n", "如 561")]),

  runOp("dcode-extras-2026-10/math-lychrel", CAT, "Lychrel 候选（逆序相加）", "n + reverse(n) 反复迭代寻找回文；196 是著名候选；步数上限内找不到则如实报告「未得到回文」",
    (t, p) => {
      const n = needBig(big((p && p.n) || t), "n");
      if (n < 0n) throw new Error("需要非负整数");
      const rawLim = p && p.max !== undefined && String(p.max).trim() !== "" ? Number(p.max) : 500;
      if (!Number.isInteger(rawLim) || rawLim < 0) throw new Error("步数上限需为非负整数");
      const lim = rawLim;
      const digits0 = n.toString().length;
      assertBudget("steps", Math.max(1, lim) * (digits0 + lim), `Lychrel ${lim} 步逆序相加`);
      let cur = n, steps = 0;
      const rev = (x) => BigInt([...x.toString()].reverse().join(""));
      const isPal = (x) => { const s = x.toString(); return s === [...s].reverse().join(""); };
      while (!isPal(cur) && steps < lim) { cur += rev(cur); steps++; }
      if (isPal(cur)) return `${n} 经 ${steps} 步得到回文 ${cur}\n（上限 ${lim} 步内）`;
      return `${n} 在 ${lim} 步内未得到回文（当前值 ${cur.toString().slice(0, 40)}${cur.toString().length > 40 ? "…" : ""}）——Lychrel 候选`;
    }, [P("n", "n", "如 89 或 196"), P("max", "步数上限（受步数预算保护）", "500")]),

  runOp("dcode-extras-2026-10/math-pascal", CAT, "杨辉三角（Pascal）", "输出前 N 行（BigInt 精确），附行和校验 2ⁿ",
    (t, p) => {
      const n = Number((p && p.rows) || t) || 0;
      if (!Number.isInteger(n) || n < 1) throw new Error("行数需为正整数");
      const estChars = Math.ceil(0.5 * n * n * (0.302 * n + 1));
      assertBudget("chars", estChars, `Pascal 前 ${n} 行输出`);
      assertBudget("bigSteps", n * (n + 1) / 2, `Pascal 前 ${n} 行二项式系数`);
      const lines = [];
      let used = 0;
      for (let i = 0; i < n; i++) {
        const row = [];
        for (let j = 0; j <= i; j++) row.push(binom(i, j).toString());
        const line = `n=${i}\t${row.join(" ")}`;
        used += line.length + 1;
        assertBudget("chars", used + Math.ceil(0.302 * n) + 80, "Pascal 实际输出");
        lines.push(line);
      }
      return lines.join("\n") + `\n第 ${n - 1} 行行和 = 2^${n - 1} = ${(2n ** BigInt(n - 1)).toString()}`;
    }, [P("rows", "行数 N", "如 6")]),

  runOp("dcode-extras-2026-10/math-pythagorean", CAT, "勾股数（Pythagorean 三元组）", "列举斜边/周长上限内的本原三元组（m²−n², 2mn, m²+n²，gcd(m,n)=1，一奇一偶）",
    (t, p) => {
      const lim = Number((p && p.limit) || t) || 0;
      if (!Number.isInteger(lim) || lim < 5) throw new Error("上限需为 ≥5 的整数（斜边 c ≤ 上限）");
      assertBudget("steps", lim, `勾股数斜边 ≤ ${lim} 的双重枚举`);
      assertBudget("chars", lim * 5, `勾股数斜边 ≤ ${lim} 的组结果输出`);
      const out = [];
      for (let m = 2; m * m <= lim; m++) {
        for (let nn = 1; nn < m; nn++) {
          const a = m * m - nn * nn, b = 2 * m * nn, c = m * m + nn * nn;
          if (c > lim) break;
          if ((m + nn) % 2 === 1 && gcd(m, nn) === 1) {
            out.push(`(${a}, ${b}, ${c})`);
            if (out.length % 8192 === 0) assertBudget("chars", out.length * 28, "勾股数结果输出");
          }
        }
      }
      assertBudget("chars", out.length * 28 + 80, "勾股数结果输出");
      return `斜边 ≤ ${lim} 的本原勾股数（${out.length} 组）：\n${out.join("\n")}`;
      function gcd(x, y) { while (y) { [x, y] = [y, x % y]; } return x; }
    }, [P("limit", "斜边上限", "如 100")]),

  runOp("dcode-extras-2026-10/math-partitions", CAT, "整数分拆数 p(n)", "Euler 五边形数定理递推（A000041）：p(5)=7, p(100)=190569292",
    (t, p) => {
      const n = Number((p && p.n) || t) || 0;
      if (!Number.isInteger(n) || n < 0) throw new Error("n 需为非负整数");
      assertBudget("bigSteps", n * (n + 1) / 2, `整数分拆 p(${n}) 的 O(n²) BigInt 递推`);
      const dp = new Array(n + 1).fill(0n); dp[0] = 1n;
      for (let k = 1; k <= n; k++)
        for (let j = k; j <= n; j++) dp[j] += dp[j - k];
      assertBudget("chars", dp[n].toString().length, `整数分拆 p(${n}) 输出`);
      return `p(${n}) = ${dp[n].toString()}`;
    }, [P("n", "n", "如 100")]),

  runOp("dcode-extras-2026-10/math-primorial", CAT, "素数阶乘 primorial", "前 k 个素数之积 p#（2, 6, 30, 210, …，A002110）",
    (t, p) => {
      const k = Number((p && p.k) || t) || 0;
      if (!Number.isInteger(k) || k < 1) throw new Error("k 需为正整数");
      assertBudget("items", k, "primorial 素数个数");
      const primes = firstPrimes(k);
      const last = primes[primes.length - 1];
      let logsum = 0;
      for (const q of primes) logsum += Math.log10(q);
      const digits = Math.floor(logsum) + 1;
      assertBudget("chars", digits + 200, `前 ${k} 个素数之积输出`);
      const need = digits * 3.2 + 8 * 1024 ** 2;
      const budget = factorialBudgetBytes();
      if (need > budget) throw new Error(`${k} 个素数之积约 ${digits.toLocaleString("en-US")} 位，估算需要 ${formatBytes(need)}，超过当前预算 ${formatBytes(budget)}；请减小 k`);
      const prod = productTreeBig(primes);
      return `前 ${k} 个素数之积 = ${prod.toString()}\n第 ${k} 个素数 = ${last}（${digits.toLocaleString("en-US")} 位）`;
    }, [P("k", "k", "如 5")]),

  runOp("dcode-extras-2026-10/math-derangement", CAT, "错排数 !n", "n 元素全部不在原位的排列数（!4=9, !5=44，A000166）",
    (t, p) => {
      const n = Number((p && p.n) || t) || 0;
      if (!Number.isSafeInteger(n) || n < 0) throw new Error("n 需为非负安全整数");
      const digits = n < 2 ? 1 : Math.ceil(log10Factorial(n) - Math.log10(Math.E)) + 1;
      assertBudget("chars", digits, `错排数 !${n} 输出`);
      assertBudget("bigSteps", n * Math.max(1, Math.ceil(digits / 9)), `错排数 !${n} BigInt 递推`);
      let a = 1n, b = 0n; // !0=1, !1=0
      for (let i = 2; i <= n; i++) { const c = BigInt(i - 1) * (a + b); a = b; b = c; }
      return `!${n} = ${(n === 0 ? 1n : n === 1 ? 0n : b).toString()}`;
    }, [P("n", "n", "如 5")]),

  runOp("dcode-extras-2026-10/math-doublefactorial", CAT, "双阶乘 n!!", "隔项乘积（9!!=945, 8!!=384, 0!!=(-1)!!=1）",
    (t, p) => {
      const n = needBig(big((p && p.n) || t), "n（−1 或非负整数）");
      if (n < -1n) throw new Error("n 需为 −1 或非负整数");
      if (n === 0n || n === -1n) return `${n}!! = 1`;
      const m = n / 2n, mNum = Number(m);
      const digits = n % 2n === 0n
        ? Math.floor(mNum * Math.log10(2) + log10Factorial(mNum)) + 1
        : Math.floor(log10Factorial(Number(n)) - mNum * Math.log10(2) - log10Factorial(mNum)) + 1;
      const termLen = n.toString().length + 1;
      assertBudget("chars", digits + (mNum + 1) * termLen + 16, `双阶乘 ${n}!! 展开输出`);
      assertBudget("bigSteps", mNum + 1, `双阶乘 ${n}!! 隔项乘`);
      const halfFact = factorialBigSync(mNum);
      const twoPow = 2n ** m;
      const r = n % 2n === 0n ? twoPow * halfFact : factorialBigSync(Number(n)) / (twoPow * halfFact);
      const steps = [];
      for (let cur = n; cur > 0n; cur -= 2n) steps.push(cur.toString());
      return `${n}!! = ${steps.join("×")} = ${r.toString()}`;
    }, [P("n", "n", "如 9")]),

  runOp("dcode-extras-2026-10/math-primecount", CAT, "素数计数 π(x)", "≤x 的素数个数（π(10)=4, π(100)=25, π(1000)=168，A000720）；Lehmer 公式 + 显式栈 φ（无递归栈溢出），受筛表/状态预算保护",
    (t, p) => {
      const x = Number((p && p.x) || t) || 0;
      if (!Number.isSafeInteger(x) || x < 2) throw new Error("x 需为 ≥2 的安全整数");
      if (x < 4) return `π(${x}) = 1`;
      const root = Math.floor(Math.sqrt(x));
      const S = x < 2_000_000 ? x : root;
      assertBudget("items", S + 1, `π(${x}) 的素数筛表`);
      assertBudget("steps", S * Math.max(1, Math.log2(Math.log2(S + 2))), `π(${x}) 的筛法`);
      const sieve = new Uint8Array(S + 1);
      const primes = [];
      for (let i = 2; i <= S; i++) {
        if (!sieve[i]) { primes.push(i); for (let j = i * i; j <= S; j += i) sieve[j] = 1; }
      }
      const piTable = new Uint32Array(S + 1);
      for (let i = 1; i <= S; i++) piTable[i] = piTable[i - 1] + (i >= 2 && !sieve[i] ? 1 : 0);
      // Lehmer：π(x) = φ(x,a) + (b+a−2)(b−a+1)/2 − Σ π(x/p_i) − ΣΣ(π(x/(p_i p_j))−j)，
      // a=π(x^¼), b=π(√x), c=π(x^⅓)。φ 用显式栈后序求值，替代递归避免栈溢出；a ≤ 7 用周期表。
      const SMALL_A = 7;
      const smallPhi = [];
      {
        let ps = [], P = 1;
        for (let a = 0; a <= SMALL_A; a++) {
          if (a > 0) { ps.push(primes[a - 1]); P *= primes[a - 1]; }
          const tab = new Uint32Array(P + 1);
          for (let r = 1; r <= P; r++) {
            let ok = true;
            for (const p of ps) if (r % p === 0) { ok = false; break; }
            tab[r] = tab[r - 1] + (ok ? 1 : 0);
          }
          const phiP = tab[P], stepP = P, stepTab = tab;
          smallPhi[a] = (xx) => Math.floor(xx / stepP) * phiP + stepTab[xx % stepP];
        }
      }
      const memo = new Map();
      const keyOf = (xx, a) => `${xx}:${a}`;
      let nodes = 0;
      const phi = (X, A) => {
        const stack = [{ x: X, a: A, phase: 0, key: null, first: 0 }];
        const vals = [];
        while (stack.length) {
          const f = stack[stack.length - 1];
          if (f.phase === 0) {
            if (f.a <= SMALL_A) { vals.push(smallPhi[f.a](f.x)); stack.pop(); continue; }
            f.key = keyOf(f.x, f.a);
            const hit = memo.get(f.key);
            if (hit !== undefined) { vals.push(hit); stack.pop(); continue; }
            if ((++nodes & 0x3ff) === 0) assertBudget("nodes", nodes, `π(${x}) 的 Legendre φ 状态`);
            f.phase = 1;
            stack.push({ x: f.x, a: f.a - 1, phase: 0, key: null, first: 0 });
          } else if (f.phase === 1) {
            f.first = vals.pop();
            f.phase = 2;
            stack.push({ x: Math.floor(f.x / primes[f.a - 1]), a: f.a - 1, phase: 0, key: null, first: 0 });
          } else {
            const v = f.first - vals.pop();
            if (memo.size < 2_000_000) memo.set(f.key, v);
            vals.push(v);
            stack.pop();
          }
        }
        return vals.pop();
      };
      const memoPi = new Map();
      const iroot = (n, k) => {
        let r = Math.floor(Math.pow(n, 1 / k));
        while (Math.pow(r + 1, k) <= n) r++;
        while (Math.pow(r, k) > n) r--;
        return r;
      };
      const piLehmer = (n) => {
        if (n <= S) return piTable[n];
        const cached = memoPi.get(n);
        if (cached !== undefined) return cached;
        const a = piLehmer(iroot(n, 4));
        const b = piLehmer(iroot(n, 2));
        const c = piLehmer(iroot(n, 3));
        let sum = phi(n, a) + Math.floor(((b + a - 2) * (b - a + 1)) / 2);
        for (let i = a; i < b; i++) {
          const w = Math.floor(n / primes[i]);
          sum -= piLehmer(w);
          if (i < c) {
            const lim = piLehmer(iroot(w, 2));
            for (let j = i; j < lim; j++) {
              sum -= piLehmer(Math.floor(w / primes[j])) - j;
            }
          }
        }
        memoPi.set(n, sum);
        return sum;
      };
      return `π(${x}) = ${piLehmer(x)}`;
    }, [P("x", "x", "如 1000")]),

  runOp("dcode-extras-2026-10/math-vonmangoldt", CAT, "von Mangoldt 函数 Λ(n)", "n=p^k 时 Λ=ln p，否则 0（Λ(8)=ln2, Λ(6)=0）",
    (t, p) => {
      const n = needBig(big((p && p.n) || t), "n");
      if (n < 2n) throw new Error("需要 ≥2 的整数");
      assertFactorSearch(n, "von Mangoldt 质因数分解");
      const f = factorizeBounded(n);
      if (!f.complete) throw new Error("n 过大无法完全分解（分解器已到 Pollard rho 内部上限）");
      const entries = [...f.factors.entries()];
      if (entries.length === 1 && entries[0][1] >= 1) {
        const [q] = entries[0];
        const ln = lnBig(q);
        if (!Number.isFinite(ln)) throw new Error("ln(p) 规模超出可表示范围");
        return `Λ(${n}) = ln(${q}) ≈ ${ln.toFixed(10)}`;
      }
      return `Λ(${n}) = 0（不是素数幂；分解 ${entries.map(([q, e]) => `${q}^${e}`).join(" × ")}）`;
    }, [P("n", "n", "如 8")]),

  runOp("dcode-extras-2026-10/math-v2adic", CAT, "2-adic 赋值 v₂(n)", "n 中因子 2 的次数（v₂(96)=5, 奇数为 0）",
    (t, p) => {
      const n = needBig(big((p && p.n) || t), "n（非零整数）");
      if (n === 0n) throw new Error("v₂(0) 无定义");
      const digits = absB(n).toString().length;
      assertBudget("chars", digits, "v₂ 输入位数");
      assertBudget("bigSteps", digits * 4, "v₂ 除 2 迭代");
      let m = n < 0n ? -n : n, k = 0n;
      while (m % 2n === 0n) { m /= 2n; k++; }
      return `v₂(${n}) = ${k}\n（奇部 = ${m}）`;
    }, [P("n", "n", "如 96")]),

  runOp("dcode-extras-2026-10/math-knuth", CAT, "Knuth 箭头大数", "a↑^k b：单箭头=幂、双箭头=幂塔、三箭头；结果受计算保护上限 2^65536（约 19729 位）约束，超界如实报错",
    (t, p) => {
      const src = String((p && p.expr) || t || "").trim();
      const m = src.match(/^(\d+)\s*([↑\^]{1,3})\s*(\d+)$/);
      if (!m) throw new Error("格式：a↑b / a↑↑b / a↑↑↑b（也可用 ^ 记法）");
      const a = BigInt(m[1]), b = BigInt(m[3]);
      const arrows = m[2].startsWith("^^^") || m[2] === "↑↑↑" ? 3 : m[2].length === 2 || m[2] === "↑↑" ? 2 : 1;
      const LIMIT = 1n << 65536n;
      const pow = (x, y) => {
        if (y === 0n) return 1n;
        if (x === 0n) return 0n;
        if (x === 1n) return 1n;
        if (y * BigInt(x.toString(2).length) > 65536n) throw new Error("结果超过 2^65536（约 19729 位）的计算保护上限，拒绝计算（如实报错不硬算）");
        assertBudget("bigSteps", Number(y) * x.toString(2).length, "Knuth 单箭头乘法");
        let r = 1n;
        for (let i = 0n; i < y; i++) { r *= x; if (r > LIMIT) throw new Error("结果超过 2^65536（约 19729 位）的计算保护上限，拒绝计算"); }
        return r;
      };
      const up = (k, x, y) => {
        if (x === 0n) return y === 0n ? 1n : 0n;
        if (x === 1n) return 1n;
        if (k === 1) return pow(x, y);
        if (y === 0n) return 1n;
        assertBudget("bigSteps", Number(y), "Knuth 箭头迭代");
        if (k === 2) { let r = 1n; for (let i = 0n; i < y; i++) r = up(1, x, r); return r; }
        let r = 1n;
        for (let i = 0n; i < y; i++) r = up(k - 1, x, r);
        return r;
      };
      try {
        const r = up(arrows, a, b);
        return `${a}${"↑".repeat(arrows)}${b} = ${r.toString()}`;
      } catch (e) {
        return `${a}${"↑".repeat(arrows)}${b} 超出计算上限（${e.message}）`;
      }
    }, [P("expr", "表达式", "如 2↑↑4 或 3↑↑↑3")]),

  runOp("dcode-extras-2026-10/math-lookandsay", CAT, "外观数列（Look-and-Say）", "Conway 外观数列：1 → 11 → 21 → 1211 → 111221；给定种子与步数",
    (t, p) => {
      const seed = String((p && p.seed) || t || "1").trim();
      const steps = (p && p.steps !== undefined && String(p.steps).trim() !== "") ? Number(p.steps) : 10;
      if (!/^[1-9][0-9]*$/.test(seed)) throw new Error("种子需为不以 0 开头的正整数");
      if (!Number.isInteger(steps) || steps < 0) throw new Error("步数需为非负整数");
      assertBudget("chars", seed.length, "外观数列种子");
      assertBudget("steps", steps * Math.max(1, seed.length), "外观数列步数×种子长度");
      assertBudget("chars", steps * 110 + seed.length, "外观数列轨迹输出");
      let cur = seed;
      const seq = [cur];
      for (let s = 0; s < steps; s++) {
        assertBudget("chars", Math.ceil(cur.length * 2.1), `外观数列第 ${s + 1} 步中间项`);
        let next = "", i = 0;
        while (i < cur.length) {
          let j = i; while (j < cur.length && cur[j] === cur[i]) j++;
          next += (j - i) + cur[i]; i = j;
        }
        assertBudget("chars", next.length, `外观数列第 ${s + 1} 步`);
        cur = next; seq.push(cur);
      }
      return seq.map((s, i) => `a(${i}) = ${s.length > 80 ? s.slice(0, 80) + `…（${s.length} 位）` : s}`).join("\n");
    }, [P("seed", "种子", "1"), P("steps", "步数（受预算保护）", "10")]),

  runOp("dcode-extras-2026-10/math-digitsum", CAT, "位和与数字根", "各位数字和 + 反复折叠成一位数字根（9875 → 位和 29 → 数字根 2）",
    (t, p) => {
      const n = needBig(big((p && p.n) || t), "n");
      if (n < 0n) throw new Error("需要非负整数");
      const digits = n.toString().length;
      assertBudget("chars", digits * 2 + 80, "位和/数字根输出");
      assertBudget("steps", digits * 3, "位和/数字根折叠");
      const s = [...n.toString()].reduce((a, c) => a + BigInt(c), 0n);
      return `位和(${n}) = ${s}\n数字根(${n}) = ${digitalRoot(n)}`;
    }, [P("n", "n", "如 9875")]),

  runOp("dcode-extras-2026-10/math-primenear", CAT, "邻近素数", "小于 n 的最大素数 / 大于 n 的最小素数 / 最近素数",
    (t, p) => {
      const n = needBig(big((p && p.n) || t), "n");
      if (n <= 2n) throw new Error("n 需 ≥3（2 以下没有更小的素数，邻近素数三元组无定义）");
      assertBudget("chars", n.toString().length, "邻近素数输入位数");
      let prev = n - 1n, next = n + 1n, guard = 0;
      while (!isPrime(prev)) { prev--; assertBudget("nodes", ++guard, "邻近素数向下搜索"); }
      guard = 0;
      while (!isPrime(next)) { next++; assertBudget("nodes", ++guard, "邻近素数向上搜索"); }
      const nearest = (n - prev) <= (next - n) ? prev : next;
      return `prev_prime(${n}) = ${prev}\nnext_prime(${n}) = ${next}\n最近素数 = ${nearest}`;
    }, [P("n", "n", "如 1000")]),

  runOp("dcode-extras-2026-10/math-bell", CAT, "Bell 数 B(n)", "n 元集合划分方案数（B5=52，A000110），Bell 三角递推",
    (t, p) => {
      const n = Number((p && p.n) || t) || 0;
      if (!Number.isSafeInteger(n) || n < 0) throw new Error("n 需为非负安全整数");
      if (n === 0) return "B(0) = 1";
      const digits = n < 2 ? 1 : Math.ceil(n * Math.log10(n) - n * Math.LOG10E + 0.5 * Math.log10(2 * Math.PI * n));
      assertBudget("chars", digits + 16, `Bell 数 B(${n}) 输出`);
      assertBudget("bigSteps", n * (n + 1) / 2, `Bell 三角 B(${n}) BigInt 递推`);
      // Bell 三角：行 i 首元素=上行尾；B(n)=第 n−1 行的尾元素
      let row = [1n];
      for (let i = 1; i <= n - 1; i++) {
        const next = [row[row.length - 1]];
        for (let j = 1; j <= i; j++) next.push(next[j - 1] + row[j - 1]);
        row = next;
      }
      return `B(${n}) = ${row[row.length - 1].toString()}`;
    }, [P("n", "n", "如 5")]),

  runOp("dcode-extras-2026-10/math-binom", CAT, "组合数 C(n,k)", "二项式系数（BigInt 精确）",
    (t, p) => {
      const src = String((p && p.nk) || t || "").trim();
      const m = src.match(/^(-?\d+)\s*[,，]\s*(-?\d+)$/);
      if (!m) throw new Error("格式：n,k（如 52,5）");
      const n = BigInt(m[1]), k = BigInt(m[2]);
      if (n < 0n || k < 0n || k > n) return `C(${m[1]},${m[2]}) = 0`;
      const kk = k > n - k ? n - k : k;
      const kNum = Number(kk);
      const digits = kk === 0n ? 1 : Math.floor(kNum * log10Big(n) - log10Factorial(kNum)) + 1;
      assertBudget("bigSteps", kNum * Math.max(1, Math.ceil(digits / 18)), `组合数 C(${m[1]},${m[2]}) 的 BigInt 迭代`);
      assertBudget("chars", digits + 8, `组合数 C(${m[1]},${m[2]}) 输出`);
      const r = binom(n, k);
      return `C(${m[1]},${m[2]}) = ${r.toString()}`;
    }, [P("nk", "n,k", "52,5")]),

  runOp("dcode-extras-2026-10/math-factorial", CAT, "阶乘 n!", "精确大数阶乘（0!=1）；分块分治乘积，按当前内存预算展开，超限给位数/内存估算并明确拒绝，不静默截断。",
    async (t, p) => {
      const raw = String((p && p.n) || t || "").trim();
      const nBig = big(raw);
      if (nBig === null || nBig < 0n) throw new Error("n 需为非负整数");
      const size = assertFactorialBudget(nBig);
      const n = Number(nBig);
      const r = await factorialBigAsync(n);
      const s = r.toString();
      if (s.length !== size.digits) {
        throw new Error(`内部校验失败：实际 ${s.length} 位，预估 ${size.digits} 位；已拒绝输出不一致结果`);
      }
      if (size.digits > 1_000_000) {
        const head = s.slice(0, 2000);
        const tail = s.slice(-2000);
        const bytes = new TextEncoder().encode(s);
        return {
          text:
            `${n}! = ${size.digits.toLocaleString("en-US")} 位（结果过大，输出区只显示首尾）。\n` +
            `十进制文本约 ${formatBytes(size.textBytes)}，已生成可下载文件。\n\n` +
            `前 2000 位：${head}\n…（中间省略 ${size.digits - 4000} 位）…\n后 2000 位：${tail}`,
          files: [{ name: `factorial-${n}.txt`, mime: "text/plain;charset=utf-8", bytes }],
        };
      }
      return `${n}! = ${s}\n（${size.digits.toLocaleString("en-US")} 位）`;
    }, [P("n", "n", "如 10；支持超大 n，受内存预算保护")], { updatedIn: "v0.1.13" }),

  runOp("dcode-extras-2026-10/math-factorialscale", CAT, "阶乘位数与规模估算",
    "不展开 n!，直接给出十进制位数、二进制位数、文本体积与内存需求；任意 n 秒回，适合先判断能否展开。",
    (t, p) => {
      const raw = String((p && p.n) || t || "").trim();
      const nBig = big(raw);
      if (nBig === null || nBig < 0n) throw new Error("n 需为非负整数");
      const n = Number(nBig);
      if (!Number.isSafeInteger(n)) throw new Error("n 超出 JS 可安全枚举的整数范围（需 ≤ 2^53-1）");
      const digits = estimateFactorialDigits(n);
      const bits = Math.ceil(log10Factorial(n) / Math.log10(2));
      const textBytes = digits;
      const needBytes = Math.ceil(digits * 3.2) + 8 * 1024 ** 2;
      const budget = factorialBudgetBytes();
      const verdict = digits > 500_000_000
        ? "超过 V8 单字符串上限，不能一次展开"
        : needBytes > budget
          ? "超过当前内存预算，不能展开"
          : "在当前内存预算内，可展开";
      const frac = log10Factorial(n) - Math.floor(log10Factorial(n));
      const lead = n < 2 ? "1" : Math.floor(10 ** (frac + 11)).toString().slice(0, 12);
      return [
        `n = ${n}`,
        `n! 十进制位数：${digits.toLocaleString("en-US")}`,
        `n! 二进制位数：${bits.toLocaleString("en-US")}`,
        `十进制文本约：${formatBytes(textBytes)}`,
        `展开估算内存：${formatBytes(needBytes)}（当前预算 ${formatBytes(budget)}）`,
        `结论：${verdict}`,
        `前 12 位有效数字（近似）：${lead}`,
      ].join("\n");
    }, [P("n", "n", "如 3999999990")], { since: "2026.11.0", addedIn: "v0.1.13", isNew: true }),

  runOp("dcode-extras-2026-10/math-rpn", CAT, "逆波兰表示法 RPN", "后缀表达式求值（3 4 + 2 * = 14）；支持 + − * / % ^ 与大整数",
    (t, p) => {
      const src = String((p && p.expr) || t || "").trim();
      if (!src) throw new Error("需要 RPN 表达式，如 3 4 + 2 *");
      assertBudget("chars", src.length, "RPN 表达式文本");
      const tokens = src.split(/\s+/);
      assertBudget("items", tokens.length, "RPN 记号数");
      const st = [];
      const isFrac = (v) => typeof v === "object";
      const toFrac = (v) => (isFrac(v) ? v : { n: v, d: 1n });
      const norm = (rn, rd) => {
        if (rd === 0n) errDiv0();
        if (rd < 0n) { rn = -rn; rd = -rd; }
        const g = gcdB(rn, rd) || 1n;
        return { n: rn / g, d: rd / g };
      };
      const fmtValue = (v) => {
        if (!isFrac(v) || v.d === 1n) return (isFrac(v) ? v.n : v).toString();
        const dec = decimalOfFraction(v.n, v.d, "RPN 结果");
        return dec.exact ? dec.text : `${v.n}/${v.d}（≈ ${dec.text}）`;
      };
      for (const tok of tokens) {
        if (/^-?\d+$/.test(tok)) { assertBudget("chars", tok.length, "RPN 数字记号"); st.push(BigInt(tok)); continue; }
        if (tok.length === 1 && "+-*/%^".includes(tok)) {
          const b = st.pop(), a = st.pop();
          if (a === undefined || b === undefined) throw new Error(`操作数不足（在「${tok}」处）`);
          const A = toFrac(a), B = toFrac(b);
          if (tok === "+") st.push(norm(A.n * B.d + B.n * A.d, A.d * B.d));
          else if (tok === "-") st.push(norm(A.n * B.d - B.n * A.d, A.d * B.d));
          else if (tok === "*") st.push(norm(A.n * B.n, A.d * B.d));
          else if (tok === "/") { if (B.n === 0n) errDiv0(); st.push(norm(A.n * B.d, A.d * B.n)); }
          else if (tok === "%") {
            if (A.d !== 1n || B.d !== 1n) throw new Error("取模仅支持整数操作数（当前结果为分数，请显式化整）");
            if (B.n === 0n) errDiv0();
            st.push(A.n % B.n);
          } else st.push(powRational(A, B));
          continue;
        }
        throw new Error(`无法识别的记号「${tok}」`);
      }
      if (st.length !== 1) throw new Error("表达式不完整（栈内剩余多个值）");
      const rendered = fmtValue(st[0]);
      assertBudget("chars", rendered.length + src.length + 8, "RPN 结果输出");
      return `${src} = ${rendered}`;
      function errDiv0() { throw new Error("除数为 0"); }
      function powRational(base, exp) {
        if (exp.d !== 1n) throw new Error("幂指数需为整数");
        const y = exp.n;
        if (y < 0n) throw new Error("幂指数需为非负整数");
        const xn = base.n, xd = base.d;
        if (y === 0n) return 1n;
        if (xn === 0n) return 0n;
        if (absB(xn) === 1n && xd === 1n) return xn === 1n || y % 2n === 0n ? 1n : -1n;
        const yNum = Number(y);
        const lgN = absB(xn) <= 1n ? 0 : log10Big(xn);
        const lgD = xd <= 1n ? 0 : log10Big(xd);
        const digits = Math.ceil(yNum * Math.max(0.01, lgN, lgD)) + 1;
        assertBudget("chars", digits * 2 + 16, "RPN 幂结果输出");
        assertBudget("bigSteps", yNum * Math.max(1, Math.ceil(digits / 18)), "RPN 幂迭代");
        return norm(xn ** y, xd ** y);
      }
    }, [P("expr", "RPN 表达式", "3 4 + 2 *")]),

  runOp("dcode-extras-2026-10/math-basefactorial", CAT, "阶乘进制", "十进制 ↔ 阶乘进制（463 = 34101_!，第 i 位 ≤ i）",
    (t, p) => {
      const src = String((p && p.v) || t || "").trim();
      if (/^\d+$/.test(src)) {
        assertBudget("chars", src.length, "阶乘进制输入位数");
        const kEst = Math.max(1, Math.ceil(src.length / Math.max(1, Math.log10(src.length + 1))));
        assertBudget("chars", 0.5 * kEst * kEst * Math.max(1, Math.log10(kEst + 1)) + kEst * 8 + 200, "阶乘进制校验展开输出");
        assertBudget("bigSteps", src.length * 2, "阶乘进制转换");
        let n = BigInt(src);
        const digs = [];
        for (let base = 2n; n > 0n; base++) { digs.unshift(n % base); n /= base; }
        const k = digs.length;
        assertBudget("bigSteps", k * (k + 1) / 2, "阶乘进制校验展开");
        assertBudget("chars", 0.5 * k * k * Math.max(1, Math.log10(k + 1)) + k * 8 + 200, "阶乘进制输出");
        return `${src} = [${digs.join(",")}]_阶乘进制\n校验：${digs.map((d, i) => `${d}×${digs.length - i}!`).join(" + ")}${digs.length ? ` = ${digs.reduce((a, d, i) => a + d * fact(digs.length - i), 0n)}` : ""}`;
      }
      const m = src.match(/^[\[\s]?([\d,\s]+)[\]\s]*!?$/);
      if (!m) throw new Error("输入十进制整数或逗号分隔的阶乘进制位（如 3,4,1,0,1）");
      assertBudget("chars", src.length, "阶乘进制位输入");
      const digs = m[1].split(/[\s,]+/).filter(Boolean).map(BigInt);
      const k = digs.length;
      assertBudget("items", k, "阶乘进制位数");
      assertBudget("bigSteps", k * 2, "阶乘进制位权展开");
      let factK = 1n;
      for (let i = 2; i <= k; i++) factK *= BigInt(i);
      let v = 0n, f = factK;
      digs.forEach((d, i) => {
        const pos = k - i; // 该位的基为 pos!
        if (d < 0n || d > pos) throw new Error(`第 ${i + 1} 位 ${d} 超界（阶乘进制第 i 位需 ≤ ${pos}）`);
        v += d * f;
        if (pos > 0) f /= BigInt(pos);
      });
      assertBudget("chars", v.toString().length + k * 8 + 80, "阶乘进制结果输出");
      return `[${digs.join(",")}]_阶乘进制 = ${v.toString()}`;
      function fact(k2) { let r = 1n; for (let i = 2n; i <= BigInt(k2); i++) r *= i; return r; }
    }, [P("v", "十进制或阶乘进制位", "463 或 3,4,1,0,1")]),

  runOp("dcode-extras-2026-10/math-negabase", CAT, "负进制（-2/-10）", "十进制 ↔ 负基进制（6 = 11010_(−2)）；基可选 −2..−10；dir=to 负进制、from 负进制（输入可含 ¯ 表负数字位）",
    (t, p) => {
      const base = BigInt(Math.abs(Number((p && p.base) || "-2")) || 2) * -1n;
      if (base < -10n || base > -2n) throw new Error("基需为 −2..−10");
      const dir = String((p && p.dir) || "to");
      const src = String((p && p.v) || t || "").trim();
      if (dir === "to" && /^-?\d+$/.test(src)) {
        assertBudget("chars", src.length, "负进制输入位数");
        let n = BigInt(src);
        if (n === 0n) return `0 = 0_(基${base})`;
        const digitsEst = Math.ceil(log10Big(n) / Math.log10(2)) + 1;
        assertBudget("chars", digitsEst + 80, "负进制输出位数");
        assertBudget("bigSteps", digitsEst * 2, "负进制转换");
        const digs = [];
        let x = n;
        while (x !== 0n) {
          let r = x % base;
          x /= base;
          if (r < 0n) { r -= base; x += 1n; }
          digs.unshift(r < 0n ? "¯" + (-r).toString() : r.toString());
        }
        return `${n} = ${digs.join("")}_(基 ${base})`;
      }
      if (/^[¯\d]+$/.test(src)) {
        assertBudget("chars", src.length, "负进制数字串输入");
        assertBudget("items", src.length, "负进制位数");
        assertBudget("bigSteps", src.length, "负进制解析");
        let v = 0n, powv = 1n, bad = false;
        const toks = [];
        for (const ch of src) {
          if (ch === "¯") { toks.push("¯"); continue; }
          if (toks.length && toks[toks.length - 1] === "¯") { toks[toks.length - 1] = "-" + ch; }
          else toks.push(ch);
        }
        if (bad) throw new Error("非法数字");
        for (let i = toks.length - 1; i >= 0; i--) {
          const d = BigInt(toks[i]);
          if (d < 0n && base > -3n) throw new Error("该基下不应出现负数字位");
          v += d * powv; powv *= base;
        }
        assertBudget("chars", v.toString().length + 80, "负进制结果输出");
        return `${src}_(基 ${base}) = ${v.toString()}`;
      }
      throw new Error("输入需为整数（dir=to）或负进制数字串（dir=from）");
    }, [P("v", "数值", "6 或 11010"), P("base", "负基（2..10，代表 −2..−10）", "2"), { key: "dir", label: "方向", type: "select", default: "to", options: [{ value: "to", label: "十进制→负进制" }, { value: "from", label: "负进制→十进制" }] }]),

  runOp("dcode-extras-2026-10/math-cantor", CAT, "Cantor 展开", "排列 ↔ 序数（Cantor expansion）：给排列求序数或序数求排列",
    (t, p) => {
      const mode = String((p && p.mode) || "rank").trim();
      const src = String((p && p.v) || t || "").trim();
      assertBudget("chars", src.length, "Cantor 输入文本");
      if (mode === "rank") {
        const a = src.split(/[\s,]+/).filter(Boolean).map(Number);
        if (!a.length || !a.every((x) => Number.isInteger(x))) throw new Error("排列元素需为整数");
        const n = a.length;
        assertBudget("items", n, "Cantor 排列元素");
        assertBudget("steps", n * n / 2, `Cantor ${n} 元素逆序对统计`);
        assertBudget("chars", n * 20 + Math.ceil(log10Factorial(n)) + 100, "Cantor 序数输出");
        assertBudget("bigSteps", n, "Cantor 阶乘构造");
        let f = 1n;
        for (let i = 2; i < n; i++) f *= BigInt(i);
        let r = 0n;
        for (let i = 0; i < n; i++) {
          let smaller = 0;
          for (let j = i + 1; j < n; j++) if (a[j] < a[i]) smaller++;
          r += BigInt(smaller) * f;
          if (n - 1 - i > 0) f /= BigInt(n - 1 - i);
        }
        return `排列 [${a.join(",")}] 的 Cantor 序数（0 起）= ${r}\n即字典序第 ${r + 1n} 个排列`;
      }
      const m = src.match(/^(\d+)\s*[,，]\s*(\d+)$/);
      if (!m) throw new Error("逆展开格式：n,k（n 个元素的字典序第 k 个，k 从 0 起）");
      const nBig = BigInt(m[1]);
      if (nBig < 1n || nBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("n 需为 1..2^53-1 的整数");
      const n = Number(nBig);
      let k = BigInt(m[2]);
      assertBudget("items", n, "Cantor 输出排列长度");
      assertBudget("steps", n * n / 2, `Cantor ${n} 元素展开`);
      assertBudget("chars", n * 20 + Math.ceil(log10Factorial(n)) + 100, "Cantor 排列输出");
      assertBudget("bigSteps", n, "Cantor 阶乘构造");
      let f = 1n;
      for (let i = 2; i < n; i++) f *= BigInt(i);
      if (k >= f * BigInt(n)) throw new Error("k 超出 n! 范围");
      const pool = Array.from({ length: n }, (_, i) => i + 1);
      const out = [];
      for (let i = n - 1; i >= 0; i--) {
        const idx = Number(k / f); k %= f;
        out.push(pool.splice(idx, 1)[0]);
        if (i > 0) f /= BigInt(i);
      }
      return `${n} 元素字典序第 ${m[2]}（0 起）个排列 = [${out.join(",")}]`;
    }, [P("v", "排列或 n,k", "3,1,2"), P("mode", "rank（排列→序数）或 unrank（序数→排列）", "rank")]),

  runOp("dcode-extras-2026-10/math-fraction", CAT, "分数计算与约分", "a/b 运算（+ − * :）化最简、带分数与十进制展开",
    (t, p) => {
      const src = String((p && p.expr) || t || "").trim();
      const m = src.match(/^(-?\d+)\s*\/\s*(-?\d+)\s*([+\-*:×÷])\s*(-?\d+)\s*\/\s*(-?\d+)$/);
      if (!m) throw new Error("格式：a/b <op> c/d，op ∈ + − * :");
      assertBudget("chars", src.length, "分数式输入");
      let [_, an, ad, op, bn, bd] = m;
      const totalDigits = an.length + ad.length + bn.length + bd.length;
      assertBudget("bigSteps", totalDigits * totalDigits / 18 + 16, "分数 BigInt 运算");
      let a = BigInt(an) * (BigInt(ad) < 0n ? -1n : 1n), b = BigInt(ad) < 0n ? -BigInt(ad) : BigInt(ad);
      let c = BigInt(bn) * (BigInt(bd) < 0n ? -1n : 1n), d = BigInt(bd) < 0n ? -BigInt(bd) : BigInt(bd);
      if (b === 0n || d === 0n) throw new Error("分母不能为 0");
      let rn, rd;
      if (op === "+") { rn = a * d + c * b; rd = b * d; }
      else if (op === "-") { rn = a * d - c * b; rd = b * d; }
      else if (op === "*" || op === "×") { rn = a * c; rd = b * d; }
      else { if (c === 0n) throw new Error("除数为 0"); rn = a * d; rd = b * c; }
      const gg = gcdB(rn, rd) || 1n;
      rn /= gg; rd /= gg;
      assertBudget("chars", rn.toString().length + rd.toString().length + 120, "分数结果输出");
      let tail = "";
      if (rd !== 1n) {
        const dec = decimalOfFraction(rn, rd, "分数十进制");
        tail = dec.exact ? `（= ${dec.text}）` : `（≈ ${dec.text}，精确分数 ${rn}/${rd}；循环/超长小数按 24 位显示）`;
      }
      return `${a}/${b} ${op} ${c}/${d} = ${rn}/${rd}${tail}`;
    }, [P("expr", "分数式", "1/6 + 1/4")]),

  runOp("dcode-extras-2026-10/math-stats", CAT, "描述统计", "均值/中位数/方差/标准差/四分位/几何·调和平均（一行数字）",
    (t, p) => {
      const raw = String((p && p.nums) || t || "");
      assertBudget("chars", raw.length, "统计输入文本");
      const xs = parseNums(raw);
      if (xs.length < 1) throw new Error("至少 1 个数字");
      assertBudget("items", xs.length, "统计样本数");
      assertBudget("steps", xs.length * 4, "统计遍历");
      const n = xs.length;
      const sorted = xs.slice().sort((a, b) => a - b);
      const allSafeInt = xs.every(Number.isSafeInteger);
      const totalBig = allSafeInt ? xs.reduce((a, b) => a + BigInt(b), 0n) : null;
      let sum = 0, comp = 0;
      for (const v of xs) { const y = v - comp; const t = sum + y; comp = (t - sum) - y; sum = t; }
      const mean = allSafeInt ? Number(totalBig) / n : sum / n;
      assertBudget("chars", (allSafeInt ? totalBig.toString().length : String(sum).length) + 400, "统计输出");
      const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
      let wMean = 0, m2 = 0;
      for (let i = 0; i < n; i++) {
        const d = xs[i] - wMean;
        wMean += d / (i + 1);
        m2 += d * (xs[i] - wMean);
      }
      const varP = m2 / n;
      const varS = n > 1 ? m2 / (n - 1) : NaN;
      const q = (pp) => {
        const pos = pp * (n - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
      };
      const geo = xs.every((x) => x > 0) ? Math.exp(xs.reduce((a, b) => a + Math.log(b), 0) / n) : NaN;
      const harm = xs.every((x) => x > 0) ? n / xs.reduce((a, b) => a + 1 / b, 0) : NaN;
      const fmt = (x) => (Number.isFinite(x) ? Number(x.toFixed(10)).toString() : "—（含非正数，无定义）");
      return [
        `n = ${n}，总和 = ${allSafeInt ? totalBig.toString() : sum}`,
        `算术平均 = ${fmt(mean)}`,
        `中位数 = ${fmt(median)}`,
        `方差（总体）= ${fmt(varP)}，标准差（总体）= ${fmt(Math.sqrt(varP))}`,
        `方差（样本）= ${fmt(varS)}，标准差（样本）= ${fmt(Math.sqrt(varS))}`,
        `Q1 = ${fmt(q(0.25))}，Q2 = ${fmt(q(0.5))}，Q3 = ${fmt(q(0.75))}，IQR = ${fmt(q(0.75) - q(0.25))}`,
        `几何平均 = ${fmt(geo)}`,
        `调和平均 = ${fmt(harm)}`,
        `最小 = ${sorted[0]}，最大 = ${sorted[n - 1]}，极差 = ${sorted[n - 1] - sorted[0]}`,
      ].join("\n");
    }, [P("nums", "数字列表", "2 4 4 4 5 5 7 9")]),

  runOp("dcode-extras-2026-10/math-benford", CAT, "Benford 首位数律", "对数字列表统计首位分布并与 Benford 期望 P(d)=log10(1+1/d) 对照",
    (t, p) => {
      const raw = String((p && p.nums) || t || "").trim();
      assertBudget("chars", raw.length, "Benford 输入文本");
      const items = raw.split(/[\s,;]+/).filter((x) => /^-?\d+(\.\d+)?$/.test(x));
      if (items.length < 5) throw new Error("至少 5 个数字（空格/逗号/换行分隔）");
      assertBudget("items", items.length, "Benford 样本数");
      const firsts = items.map((x) => x.replace(/^[-0.]+/, "")[0]).filter(Boolean);
      if (!firsts.length) throw new Error("样本中没有可识别的非零首位数字");
      const counts = new Array(10).fill(0);
      for (const f of firsts) counts[+f]++;
      const lines = ["首位\t实际占比\tBenford 期望"];
      for (let d = 1; d <= 9; d++) {
        const actual = counts[d] / firsts.length;
        const exp = Math.log10(1 + 1 / d);
        lines.push(`${d}\t${(actual * 100).toFixed(2)}%\t${(exp * 100).toFixed(2)}%`);
      }
      let chi2 = 0;
      for (let d = 1; d <= 9; d++) {
        const e = Math.log10(1 + 1 / d) * firsts.length;
        chi2 += (counts[d] - e) ** 2 / e;
      }
      return `样本 ${firsts.length} 个\n${lines.join("\n")}\nχ²（8 自由度）= ${chi2.toFixed(3)}（>15.5 时 p<0.05，显著偏离）`;
    }, [P("nums", "数字列表", "")]),

  runOp("dcode-extras-2026-10/math-sydney", CAT, "Syracuse 高度与轨迹", "3n+1 步数/最高点（主程序 Collatz 已有序列输出，本件给轨迹摘要与峰值统计）",
    (t, p) => {
      const n = needBig(big((p && p.n) || t), "n");
      if (n < 1n || n > 10n ** 15n) throw new Error("n 需为 1..10^15（Collatz 搜索保护域；更大值请分段验证）");
      assertBudget("chars", n.toString().length, "Syracuse 输入位数");
      let x = n, steps = 0, peak = n;
      const seq = [x.toString()];
      while (x !== 1n) {
        x = x % 2n === 0n ? x / 2n : 3n * x + 1n;
        if (x > peak) peak = x;
        steps++;
        if ((steps & 0xfffff) === 0) assertBudget("steps", steps, "Syracuse 迭代");
        if (seq.length < 60) seq.push(x.toString());
      }
      assertBudget("chars", seq.join(" → ").length + 200, "Syracuse 轨迹输出");
      return `${n}：经 ${steps} 步到 1，峰值 ${peak}\n轨迹前 ${seq.length} 项：${seq.join(" → ")}${steps > 59 ? " …" : ""}`;
    }, [P("n", "n", "如 27")]),

  runOp("dcode-extras-2026-10/math-wordvalue", CAT, "单词数值（毕达哥拉斯/迦勒底/希伯来/希腊）", "四种字母数值体系求和：毕达哥拉斯 A=1..I=9 循环；迦勒底 1:A I J Q Y…；希伯来 gematria；希腊 isopséphie",
    (t, p) => {
      const mode = String((p && p.mode) || "pyth").trim();
      const s = String(t || "").toUpperCase();
      if (!s) throw new Error("需要单词/文本");
      assertBudget("chars", s.length * 4 + 200, "单词数值输出");
      assertBudget("steps", s.length * 4, "单词数值遍历");
      const PYTH = {}; "ABCDEFGHI".split("").forEach((c, i) => PYTH[c] = i + 1);
      "JKLMNOPQR".split("").forEach((c, i) => PYTH[c] = i + 1);
      "STUVWXYZ".split("").forEach((c, i) => PYTH[c] = i + 1);
      const CHALD = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 8, G: 3, H: 5, I: 1, J: 1, K: 2, L: 3, M: 4, N: 5, O: 7, P: 8, Q: 1, R: 2, S: 1, T: 4, U: 6, V: 6, W: 6, X: 5, Y: 1, Z: 7 };
      const HEB = { "א": 1, "ב": 2, "ג": 3, "ד": 4, "ה": 5, "ו": 6, "ז": 7, "ח": 8, "ט": 9, "י": 10, "כ": 20, "ך": 20, "ל": 30, "מ": 40, "ם": 40, "נ": 50, "ן": 50, "ס": 60, "ע": 70, "פ": 80, "ף": 80, "צ": 90, "ץ": 90, "ק": 100, "ר": 200, "ש": 300, "ת": 400 };
      const GREEK = { "Α": 1, "Β": 2, "Γ": 3, "Δ": 4, "Ε": 5, "Ϝ": 6, "Ζ": 7, "Η": 8, "Θ": 9, "Ι": 10, "Κ": 20, "Λ": 30, "Μ": 40, "Ν": 50, "Ξ": 60, "Ο": 70, "Π": 80, "Ϙ": 90, "Ρ": 100, "Σ": 200, "Τ": 300, "Υ": 400, "Φ": 500, "Χ": 600, "Ψ": 700, "Ω": 800, "Ϡ": 900 };
      const GREEK_LATIN = { A: 1, B: 2, G: 3, D: 4, E: 5, Z: 7, H: 8, TH: 9, I: 10, K: 20, L: 30, M: 40, N: 50, X: 60, O: 70, P: 80, R: 100, S: 200, T: 300, U: 400, PH: 500, KH: 600, PS: 700, OM: 800 };
      const parts = [];
      if (mode === "pyth" || mode === "all") {
        const parts2 = [...s].map((c) => PYTH[c]).filter((v) => v);
        parts.push(`毕达哥拉斯：${parts2.join("+") || 0} = ${parts2.reduce((a, b) => a + b, 0)}`);
      }
      if (mode === "chald" || mode === "all") {
        const parts2 = [...s].map((c) => CHALD[c]).filter((v) => v);
        parts.push(`迦勒底：${parts2.join("+") || 0} = ${parts2.reduce((a, b) => a + b, 0)}`);
      }
      if (mode === "heb" || mode === "all") {
        const parts2 = [...s].map((c) => HEB[c]).filter((v) => v);
        parts.push(`希伯来 Gematria：${parts2.length ? parts2.join("+") + " = " + parts2.reduce((a, b) => a + b, 0) : "无希伯来字母（输入需含 א–ת）"}`);
      }
      if (mode === "greek" || mode === "all") {
        const parts2 = [...s].map((c) => GREEK[c]).filter((v) => v);
        parts.push(`希腊 Isopséphie：${parts2.length ? parts2.join("+") + " = " + parts2.reduce((a, b) => a + b, 0) : "无希腊字母（输入需含 Α–Ω）"}`);
      }
      if (!parts.length) throw new Error("mode 需为 pyth/chald/heb/greek/all");
      return parts.join("\n");
    }, [{ key: "mode", label: "体系", type: "select", default: "pyth", options: [{ value: "pyth", label: "毕达哥拉斯" }, { value: "chald", label: "迦勒底" }, { value: "heb", label: "希伯来" }, { value: "greek", label: "希腊" }, { value: "all", label: "全部" }] }]),
];
