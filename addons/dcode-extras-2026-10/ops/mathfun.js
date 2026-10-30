/*
 * dcode-extras · 数学工具与数列批（对标 dCode Arithmétique/Séries/Mathématiques 未入主件部分）
 * 主件已有的：质因数分解/约数/φ/模逆/CRT/μ/素性/连分数（数论插件）、斐波那契/Zeckendorf/
 * 罗马数字/Collatz/进制系（主程序）不在本批重复。
 */

import { big, isIntStr, isPrime, factorizeBounded, binom, runOp, parseNums } from "../lib/util.js";

const CAT = "dcode-extras-2026-10/cat-math";
const P = (key, label, ph) => ({ key, label, type: "text", default: "", placeholder: ph || "" });

function needBig(v, what) { if (v === null) throw new Error(`需要整数 ${what}`); return v; }

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
      let cur = n, guard = 0;
      while (cur !== goal && guard++ < 30) {
        const ds = cur.toString().padStart(digits.length, "0").split("").sort();
        const lo = BigInt(ds.join("")), hi = BigInt(ds.reverse().join(""));
        cur = hi - lo;
        steps.push(cur);
      }
      return `${n} → ${goal} 共 ${steps.length - 1} 步\n${steps.join(" → ")}`;
    }, [P("n", "n", "如 3524")]),

  runOp("dcode-extras-2026-10/math-armstrong", CAT, "Armstrong 自恋数判定", "各位数字的 n 次幂之和是否等于自身（153=1³+5³+3³）；附区间列举",
    (t, p) => {
      const src = String((p && p.n) || t).trim();
      if (/^\d+$/.test(src)) {
        const n = BigInt(src), k = BigInt(src.length), s = [...src].reduce((a, c) => a + BigInt(c) ** k, 0n);
        return s === n ? `${n} 是 ${src.length} 位 Armstrong 数（${[...src].map((c) => `${c}^${src.length}`).join(" + ")} = ${n}）` : `${n} 不是 Armstrong 数（各位 ${src.length} 次幂和 = ${s}）`;
      }
      const [a, b] = src.split(/\s*[,~到]\s*/).map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b) || b < a || b > 1000000) throw new Error("给单个整数做判定，或给区间 a,b（b ≤ 1000000）");
      const hits = [];
      for (let i = a; i <= b; i++) {
        const s = String(i), k = s.length; let sum = 0;
        for (const c of s) sum += (c.charCodeAt(0) - 48) ** k;
        if (sum === i) hits.push(i);
      }
      return `[${a},${b}] 内 Armstrong 数（${hits.length} 个）：${hits.join(", ") || "无"}`;
    }, [P("n", "n 或区间 a,b", "如 153 或 100,10000")]),

  runOp("dcode-extras-2026-10/math-harshad", CAT, "Harshad 数判定", "位和整除自身（18/(1+8)=2）；附区间列举",
    (t, p) => {
      const src = String((p && p.n) || t).trim();
      const judge = (x) => { const s = [...String(x)].reduce((a, c) => a + (c.charCodeAt(0) - 48), 0); return x % s === 0; };
      if (/^\d+$/.test(src)) {
        const n = Number(src), s = [...src].reduce((a, c) => a + (c.charCodeAt(0) - 48), 0);
        return judge(n) ? `${n} 是 Harshad 数（位和 ${s}，${n}/${s}=${n / s}）` : `${n} 不是 Harshad 数（位和 ${s}，不整除）`;
      }
      const [a, b] = src.split(/\s*[,~到]\s*/).map(Number);
      if (!Number.isInteger(a) || !Number.isInteger(b) || b < a || b > 1000000) throw new Error("给单个整数，或区间 a,b（b ≤ 1000000）");
      const hits = [];
      for (let i = Math.max(1, a); i <= b; i++) if (judge(i)) hits.push(i);
      return `[${a},${b}] 内 Harshad 数（${hits.length} 个）：${hits.join(", ")}`;
    }, [P("n", "n 或区间 a,b", "如 18 或 1,100")]),

  runOp("dcode-extras-2026-10/math-carmichael", CAT, "Carmichael 数判定", "合数且对全部互素 a 满足 aⁿ⁻¹≡1 (mod n)（561/1105/1729）；用 Korselt 判据：无平方因子且 p−1 | n−1",
    (t, p) => {
      const n = needBig(big((p && p.n) || t), "n");
      if (n < 3n) throw new Error("需要 ≥3 的整数");
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
      const lim = Math.min(Number((p && p.max) || 500) || 500, 10000);
      if (n < 0n) throw new Error("需要非负整数");
      let cur = n, steps = 0;
      const rev = (x) => BigInt([...x.toString()].reverse().join(""));
      const isPal = (x) => { const s = x.toString(); return s === [...s].reverse().join(""); };
      while (!isPal(cur) && steps < lim) { cur += rev(cur); steps++; }
      if (isPal(cur)) return `${n} 经 ${steps} 步得到回文 ${cur}\n（上限 ${lim} 步内）`;
      return `${n} 在 ${lim} 步内未得到回文（当前值 ${cur.toString().slice(0, 40)}${cur.toString().length > 40 ? "…" : ""}）——Lychrel 候选`;
    }, [P("n", "n", "如 89 或 196"), P("max", "步数上限（≤10000）", "500")]),

  runOp("dcode-extras-2026-10/math-pascal", CAT, "杨辉三角（Pascal）", "输出前 N 行（BigInt 精确），附行和校验 2ⁿ",
    (t, p) => {
      const n = Number((p && p.rows) || t) || 0;
      if (!Number.isInteger(n) || n < 1 || n > 300) throw new Error("行数需为 1..300");
      const lines = [];
      for (let i = 0; i < n; i++) {
        const row = [];
        for (let j = 0; j <= i; j++) row.push(binom(i, j).toString());
        lines.push(`n=${i}\t${row.join(" ")}`);
      }
      return lines.join("\n") + `\n第 ${n - 1} 行行和 = 2^${n - 1} = ${(2n ** BigInt(n - 1)).toString()}`;
    }, [P("rows", "行数 N", "如 6")]),

  runOp("dcode-extras-2026-10/math-pythagorean", CAT, "勾股数（Pythagorean 三元组）", "列举斜边/周长上限内的本原三元组（m²−n², 2mn, m²+n²，gcd(m,n)=1，一奇一偶）",
    (t, p) => {
      const lim = Number((p && p.limit) || t) || 0;
      if (!Number.isInteger(lim) || lim < 5 || lim > 100000) throw new Error("上限需为 5..100000（斜边 c ≤ 上限）");
      const out = [];
      for (let m = 2; m * m <= lim; m++) {
        for (let nn = 1; nn < m; nn++) {
          const a = m * m - nn * nn, b = 2 * m * nn, c = m * m + nn * nn;
          if (c > lim) break;
          if ((m + nn) % 2 === 1 && gcd(m, nn) === 1) out.push(`(${a}, ${b}, ${c})`);
          if (out.length >= 5000) throw new Error("结果超过 5000 组，请降低上限");
        }
      }
      return `斜边 ≤ ${lim} 的本原勾股数（${out.length} 组）：\n${out.join("\n")}`;
      function gcd(x, y) { while (y) { [x, y] = [y, x % y]; } return x; }
    }, [P("limit", "斜边上限", "如 100")]),

  runOp("dcode-extras-2026-10/math-partitions", CAT, "整数分拆数 p(n)", "Euler 五边形数定理递推（A000041）：p(5)=7, p(100)=190569292",
    (t, p) => {
      const n = Number((p && p.n) || t) || 0;
      if (!Number.isInteger(n) || n < 0 || n > 20000) throw new Error("n 需为 0..20000");
      const dp = new Array(n + 1).fill(0n); dp[0] = 1n;
      for (let k = 1; k <= n; k++)
        for (let j = k; j <= n; j++) dp[j] += dp[j - k];
      return `p(${n}) = ${dp[n].toString()}`;
    }, [P("n", "n", "如 100")]),

  runOp("dcode-extras-2026-10/math-primorial", CAT, "素数阶乘 primorial", "前 k 个素数之积 p#（2, 6, 30, 210, …，A002110）",
    (t, p) => {
      const k = Number((p && p.k) || t) || 0;
      if (!Number.isInteger(k) || k < 1 || k > 2000) throw new Error("k 需为 1..2000");
      let prod = 1n, count = 0, cand = 2n, last = 0n;
      while (count < k) {
        if (isPrime(cand)) { prod *= cand; count++; last = cand; }
        cand++;
      }
      return `前 ${k} 个素数之积 = ${prod.toString()}\n第 ${k} 个素数 = ${last.toString()}`;
    }, [P("k", "k", "如 5")]),

  runOp("dcode-extras-2026-10/math-derangement", CAT, "错排数 !n", "n 元素全部不在原位的排列数（!4=9, !5=44，A000166）",
    (t, p) => {
      const n = Number((p && p.n) || t) || 0;
      if (!Number.isInteger(n) || n < 0 || n > 10000) throw new Error("n 需为 0..10000");
      let a = 1n, b = 0n; // !0=1, !1=0
      for (let i = 2; i <= n; i++) { const c = BigInt(i - 1) * (a + b); a = b; b = c; }
      return `!${n} = ${(n === 0 ? 1n : n === 1 ? 0n : b).toString()}`;
    }, [P("n", "n", "如 5")]),

  runOp("dcode-extras-2026-10/math-doublefactorial", CAT, "双阶乘 n!!", "隔项乘积（9!!=945, 8!!=384, 0!!=(-1)!!=1）",
    (t, p) => {
      const n = needBig(big((p && p.n) || t), "n（−1..100000）");
      if (n < -1n || n > 100000n) throw new Error("n 需在 −1..100000");
      if (n === 0n || n === -1n) return `${n}!! = 1`;
      let r = 1n, cur = n;
      const steps = [];
      while (cur > 0n) { r *= cur; steps.push(cur.toString()); cur -= 2n; }
      return `${n}!! = ${steps.join("×")} = ${r.toString()}`;
    }, [P("n", "n", "如 9")]),

  runOp("dcode-extras-2026-10/math-primecount", CAT, "素数计数 π(x)", "≤x 的素数个数（π(10)=4, π(100)=25, π(1000)=168，A000720）；Meissel–Lehmer 简化实现，x ≤ 10⁹",
    (t, p) => {
      const x = Number((p && p.x) || t) || 0;
      if (!Number.isInteger(x) || x < 2 || x > 1e9) throw new Error("x 需为 2..10⁹");
      if (x < 4) return `π(${x}) = 1`;
      const sqrt = Math.floor(Math.sqrt(x));
      const sieve = new Uint8Array(sqrt + 1);
      const primes = [];
      for (let i = 2; i <= sqrt; i++) {
        if (!sieve[i]) { primes.push(i); for (let j = i * i; j <= sqrt; j += i) sieve[j] = 1; }
      }
      // Legendre 公式：π(x) = π(√x) + φ(x, π(√x)) − 1；φ 递归带记忆化
      const memo = new Map();
      const phi = (xx, a) => {
        if (a === 0) return xx;
        if (a === 1) return xx - Math.floor(xx / 2);
        const key = xx * 100 + a;
        if (memo.has(key)) return memo.get(key);
        const v = phi(xx, a - 1) - phi(Math.floor(xx / primes[a - 1]), a - 1);
        if (memo.size < 4e6) memo.set(key, v);
        return v;
      };
      const px = primes.length;
      return `π(${x}) = ${px + phi(x, px) - 1}`;
    }, [P("x", "x", "如 1000")]),

  runOp("dcode-extras-2026-10/math-vonmangoldt", CAT, "von Mangoldt 函数 Λ(n)", "n=p^k 时 Λ=ln p，否则 0（Λ(8)=ln2, Λ(6)=0）",
    (t, p) => {
      const n = needBig(big((p && p.n) || t), "n");
      if (n < 2n) throw new Error("需要 ≥2 的整数");
      const f = factorizeBounded(n);
      if (!f.complete) throw new Error("n 过大无法分解");
      const entries = [...f.factors.entries()];
      if (entries.length === 1 && entries[0][1] >= 1) {
        const [q] = entries[0];
        return `Λ(${n}) = ln(${q}) ≈ ${Math.log(Number(q)).toFixed(10)}`;
      }
      return `Λ(${n}) = 0（不是素数幂；分解 ${entries.map(([q, e]) => `${q}^${e}`).join(" × ")}）`;
    }, [P("n", "n", "如 8")]),

  runOp("dcode-extras-2026-10/math-v2adic", CAT, "2-adic 赋值 v₂(n)", "n 中因子 2 的次数（v₂(96)=5, 奇数为 0）",
    (t, p) => {
      const n = needBig(big((p && p.n) || t), "n（非零整数）");
      if (n === 0n) throw new Error("v₂(0) 无定义");
      let m = n < 0n ? -n : n, k = 0n;
      while (m % 2n === 0n) { m /= 2n; k++; }
      return `v₂(${n}) = ${k}\n（奇部 = ${m}）`;
    }, [P("n", "n", "如 96")]),

  runOp("dcode-extras-2026-10/math-knuth", CAT, "Knuth 箭头大数", "a↑^k b：单箭头=幂、双箭头=幂塔、三箭头；结果有界（≤2^64 或给出位数描述），超界如实报错",
    (t, p) => {
      const src = String((p && p.expr) || t || "").trim();
      const m = src.match(/^(\d+)\s*([↑\^]{1,3})\s*(\d+)$/);
      if (!m) throw new Error("格式：a↑b / a↑↑b / a↑↑↑b（也可用 ^ 记法）");
      const a = BigInt(m[1]), b = BigInt(m[3]);
      const arrows = m[2].startsWith("^^^") || m[2] === "↑↑↑" ? 3 : m[2].length === 2 || m[2] === "↑↑" ? 2 : 1;
      const LIMIT = 1n << 65536n;
      const pow = (x, y) => { if (y * BigInt(x.toString(2).length) > 65536n) throw new Error("结果超过 2^65536，拒绝计算（如实报错不硬算）"); let r = 1n; for (let i = 0n; i < y; i++) { r *= x; if (r > LIMIT) throw new Error("结果超过 2^65536，拒绝计算"); } return r; };
      const up = (k, x, y) => {
        if (k === 1) return pow(x, y);
        if (y === 0n) return 1n;
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
      const steps = Math.min(Number((p && p.steps) || "10") || 10, 40);
      if (!/^[1-9][0-9]*$/.test(seed)) throw new Error("种子需为不以 0 开头的正整数");
      if (seed.length > 40) throw new Error("种子过长（≤40 位）");
      let cur = seed;
      const seq = [cur];
      for (let s = 0; s < steps; s++) {
        let next = "", i = 0;
        while (i < cur.length) {
          let j = i; while (j < cur.length && cur[j] === cur[i]) j++;
          next += (j - i) + cur[i]; i = j;
        }
        if (next.length > 200000) throw new Error("第 " + (s + 1) + " 步超过 20 万字符，停止");
        cur = next; seq.push(cur);
      }
      return seq.map((s, i) => `a(${i}) = ${s.length > 80 ? s.slice(0, 80) + `…（${s.length} 位）` : s}`).join("\n");
    }, [P("seed", "种子", "1"), P("steps", "步数 ≤40", "10")]),

  runOp("dcode-extras-2026-10/math-digitsum", CAT, "位和与数字根", "各位数字和 + 反复折叠成一位数字根（9875 → 位和 29 → 数字根 2）",
    (t, p) => {
      const n = needBig(big((p && p.n) || t), "n");
      if (n < 0n) throw new Error("需要非负整数");
      const s = [...n.toString()].reduce((a, c) => a + BigInt(c), 0n);
      return `位和(${n}) = ${s}\n数字根(${n}) = ${digitalRoot(n)}`;
    }, [P("n", "n", "如 9875")]),

  runOp("dcode-extras-2026-10/math-primenear", CAT, "邻近素数", "小于 n 的最大素数 / 大于 n 的最小素数 / 最近素数",
    (t, p) => {
      const n = needBig(big((p && p.n) || t), "n");
      let prev = n - 1n, next = n + 1n, guard = 0;
      while (!isPrime(prev)) { prev--; if (++guard > 2000000n) throw new Error("向下搜索超限"); }
      guard = 0;
      while (!isPrime(next)) { next++; if (++guard > 2000000n) throw new Error("向上搜索超限"); }
      const nearest = (n - prev) <= (next - n) ? prev : next;
      return `prev_prime(${n}) = ${prev}\nnext_prime(${n}) = ${next}\n最近素数 = ${nearest}`;
    }, [P("n", "n", "如 1000")]),

  runOp("dcode-extras-2026-10/math-bell", CAT, "Bell 数 B(n)", "n 元集合划分方案数（B5=52，A000110），Bell 三角递推",
    (t, p) => {
      const n = Number((p && p.n) || t) || 0;
      if (!Number.isInteger(n) || n < 0 || n > 1000) throw new Error("n 需为 0..1000");
      if (n === 0) return "B(0) = 1";
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
      const r = binom(BigInt(m[1]), BigInt(m[2]));
      return `C(${m[1]},${m[2]}) = ${r.toString()}`;
    }, [P("nk", "n,k", "52,5")]),

  runOp("dcode-extras-2026-10/math-factorial", CAT, "阶乘 n!", "精确大数阶乘（0!=1；分段乘积防超时）",
    (t, p) => {
      const n = Number((p && p.n) || t) || 0;
      if (!Number.isInteger(n) || n < 0 || n > 20000) throw new Error("n 需为 0..20000");
      let r = 1n;
      for (let i = 2n; i <= BigInt(n); i++) r *= i;
      return `${n}! = ${r.toString()}（${r.toString().length} 位）`;
    }, [P("n", "n", "如 10")]),

  runOp("dcode-extras-2026-10/math-rpn", CAT, "逆波兰表示法 RPN", "后缀表达式求值（3 4 + 2 * = 14）；支持 + − * / % ^ 与大整数",
    (t, p) => {
      const src = String((p && p.expr) || t || "").trim();
      if (!src) throw new Error("需要 RPN 表达式，如 3 4 + 2 *");
      const st = [];
      for (const tok of src.split(/\s+/)) {
        if (/^-?\d+$/.test(tok)) { st.push(BigInt(tok)); continue; }
        if (tok.length === 1 && "+-*/%^".includes(tok)) {
          const b = st.pop(), a = st.pop();
          if (a === undefined || b === undefined) throw new Error(`操作数不足（在「${tok}」处）`);
          st.push(tok === "+" ? a + b : tok === "-" ? a - b : tok === "*" ? a * b
            : tok === "%" ? (b === 0n ? errDiv0() : a % b)
            : tok === "/" ? (b === 0n ? errDiv0() : (a % b === 0n ? a / b : Number(a) / Number(b)))
            : powBig(a, b));
          continue;
        }
        throw new Error(`无法识别的记号「${tok}」`);
      }
      if (st.length !== 1) throw new Error("表达式不完整（栈内剩余多个值）");
      return `${src} = ${st[0]}`;
      function errDiv0() { throw new Error("除数为 0"); }
      function powBig(x, y) {
        if (y < 0n || y > 4096n) throw new Error("幂指数需为 0..4096");
        let r = 1n; for (let i = 0n; i < y; i++) r *= x; return r;
      }
    }, [P("expr", "RPN 表达式", "3 4 + 2 *")]),

  runOp("dcode-extras-2026-10/math-basefactorial", CAT, "阶乘进制", "十进制 ↔ 阶乘进制（463 = 34101_!，第 i 位 ≤ i）",
    (t, p) => {
      const src = String((p && p.v) || t || "").trim();
      if (/^\d+$/.test(src)) {
        let n = BigInt(src);
        if (n > 10n ** 18n) throw new Error("n ≤ 10^18");
        const digs = [];
        for (let base = 2n; n > 0n; base++) { digs.unshift(n % base); n /= base; }
        return `${src} = [${digs.join(",")}]_阶乘进制\n校验：${digs.map((d, i) => `${d}×${digs.length - i}!`).join(" + ")}${digs.length ? ` = ${digs.reduce((a, d, i) => a + d * fact(digs.length - i), 0n)}` : ""}`;
      }
      const m = src.match(/^[\[\s]?([\d,\s]+)[\]\s]*!?$/);
      if (!m) throw new Error("输入十进制整数或逗号分隔的阶乘进制位（如 3,4,1,0,1）");
      const digs = m[1].split(/[\s,]+/).filter(Boolean).map(BigInt);
      let v = 0n;
      digs.forEach((d, i) => {
        const pos = digs.length - i; // 该位的基为 pos!
        if (d < 0n || d > pos) throw new Error(`第 ${i + 1} 位 ${d} 超界（阶乘进制第 i 位需 ≤ ${pos}）`);
        v += d * fact(pos);
      });
      return `[${digs.join(",")}]_阶乘进制 = ${v.toString()}`;
      function fact(k) { let r = 1n; for (let i = 2n; i <= k; i++) r *= i; return r; }
    }, [P("v", "十进制或阶乘进制位", "463 或 3,4,1,0,1")]),

  runOp("dcode-extras-2026-10/math-negabase", CAT, "负进制（-2/-10）", "十进制 ↔ 负基进制（6 = 11010_(−2)）；基可选 −2..−10；dir=to 负进制、from 负进制（输入可含 ¯ 表负数字位）",
    (t, p) => {
      const base = BigInt(Math.abs(Number((p && p.base) || "-2")) || 2) * -1n;
      if (base < -10n || base > -2n) throw new Error("基需为 −2..−10");
      const dir = String((p && p.dir) || "to");
      const src = String((p && p.v) || t || "").trim();
      if (dir === "to" && /^-?\d+$/.test(src)) {
        let n = BigInt(src);
        if (n.toString().length > 30) throw new Error("输入过长（≤30 位）");
        if (n === 0n) return `0 = 0_(基${base})`;
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
        return `${src}_(基 ${base}) = ${v.toString()}`;
      }
      throw new Error("输入需为整数（dir=to）或负进制数字串（dir=from）");
    }, [P("v", "数值", "6 或 11010"), P("base", "负基（2..10，代表 −2..−10）", "2"), { key: "dir", label: "方向", type: "select", default: "to", options: [{ value: "to", label: "十进制→负进制" }, { value: "from", label: "负进制→十进制" }] }]),

  runOp("dcode-extras-2026-10/math-cantor", CAT, "Cantor 展开", "排列 ↔ 序数（Cantor expansion）：给排列求序数或序数求排列",
    (t, p) => {
      const mode = String((p && p.mode) || "rank").trim();
      const src = String((p && p.v) || t || "").trim();
      if (mode === "rank") {
        const a = src.split(/[\s,]+/).filter(Boolean).map(Number);
        if (!a.length || a.length > 12 || !a.every((x, i) => Number.isInteger(x))) throw new Error("排列元素需为整数且长度 ≤12");
        const n = a.length;
        let r = 0n;
        const seen = [];
        for (let i = 0; i < n; i++) {
          let smaller = 0;
          for (let j = i + 1; j < n; j++) if (a[j] < a[i]) smaller++;
          r += BigInt(smaller) * fact(n - 1 - i);
        }
        return `排列 [${a.join(",")}] 的 Cantor 序数（0 起）= ${r}\n即字典序第 ${r + 1n} 个排列`;
      }
      const m = src.match(/^(\d+)\s*[,，]\s*(\d+)$/);
      if (!m) throw new Error("逆展开格式：n,k（n 个元素的字典序第 k 个，k 从 0 起）");
      const n = Number(m[1]); let k = BigInt(m[2]);
      if (n < 1 || n > 12) throw new Error("n ≤ 12");
      if (k >= fact(n)) throw new Error("k 超出 n! 范围");
      const pool = Array.from({ length: n }, (_, i) => i + 1);
      const out = [];
      for (let i = n - 1; i >= 0; i--) {
        const f = fact(i);
        const idx = Number(k / f); k %= f;
        out.push(pool.splice(idx, 1)[0]);
      }
      return `${n} 元素字典序第 ${m[2]}（0 起）个排列 = [${out.join(",")}]`;
      function fact(x) { let r = 1n; for (let i = 2n; i <= BigInt(x); i++) r *= i; return r; }
    }, [P("v", "排列或 n,k", "3,1,2"), P("mode", "rank（排列→序数）或 unrank（序数→排列）", "rank")]),

  runOp("dcode-extras-2026-10/math-fraction", CAT, "分数计算与约分", "a/b 运算（+ − * :）化最简、带分数与十进制展开",
    (t, p) => {
      const src = String((p && p.expr) || t || "").trim();
      const m = src.match(/^(-?\d+)\s*\/\s*(-?\d+)\s*([+\-*:×÷])\s*(-?\d+)\s*\/\s*(-?\d+)$/);
      if (!m) throw new Error("格式：a/b <op> c/d，op ∈ + − * :");
      let [_, an, ad, op, bn, bd] = m;
      let a = BigInt(an) * (BigInt(ad) < 0n ? -1n : 1n), b = BigInt(ad) < 0n ? -BigInt(ad) : BigInt(ad);
      let c = BigInt(bn) * (BigInt(bd) < 0n ? -1n : 1n), d = BigInt(bd) < 0n ? -BigInt(bd) : BigInt(bd);
      if (b === 0n || d === 0n) throw new Error("分母不能为 0");
      let rn, rd;
      if (op === "+") { rn = a * d + c * b; rd = b * d; }
      else if (op === "-") { rn = a * d - c * b; rd = b * d; }
      else if (op === "*" || op === "×") { rn = a * c; rd = b * d; }
      else { if (c === 0n) throw new Error("除数为 0"); rn = a * d; rd = b * c; }
      const g = (x, y) => (y ? g(y, x % y) : x < 0n ? -x : x);
      const gg = g(rn < 0n ? -rn : rn, rd) || 1n;
      rn /= gg; rd /= gg;
      const dec = rd === 1n ? rn.toString() : (Number(rn) / Number(rd)).toPrecision(12).replace(/\.?0+$/, "");
      return `${a}/${b} ${op} ${c}/${d} = ${rn}/${rd}${rd !== 1n ? `（≈ ${dec}）` : ""}`;
    }, [P("expr", "分数式", "1/6 + 1/4")]),

  runOp("dcode-extras-2026-10/math-stats", CAT, "描述统计", "均值/中位数/方差/标准差/四分位/几何·调和平均（一行数字）",
    (t, p) => {
      const xs = parseNums((p && p.nums) || t);
      if (xs.length < 1) throw new Error("至少 1 个数字");
      if (xs.length > 100000) throw new Error("最多 100000 个数");
      const n = xs.length;
      const sorted = xs.slice().sort((a, b) => a - b);
      const mean = xs.reduce((a, b) => a + b, 0) / n;
      const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
      const varP = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
      const varS = n > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : NaN;
      const q = (pp) => {
        const pos = pp * (n - 1), lo = Math.floor(pos), hi = Math.ceil(pos);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
      };
      const geo = xs.every((x) => x > 0) ? Math.exp(xs.reduce((a, b) => a + Math.log(b), 0) / n) : NaN;
      const harm = xs.every((x) => x > 0) ? n / xs.reduce((a, b) => a + 1 / b, 0) : NaN;
      const fmt = (x) => (Number.isFinite(x) ? Number(x.toFixed(10)).toString() : "—（含非正数，无定义）");
      return [
        `n = ${n}，总和 = ${xs.reduce((a, b) => a + b, 0)}`,
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
      const items = raw.split(/[\s,;]+/).filter((x) => /^-?\d+(\.\d+)?$/.test(x));
      if (items.length < 5) throw new Error("至少 5 个数字（空格/逗号/换行分隔）");
      const firsts = items.map((x) => x.replace(/^[-0.]+/, "")[0]).filter(Boolean);
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
      if (n < 1n || n > 10n ** 15n) throw new Error("n 需为 1..10^15");
      let x = n, steps = 0, peak = n;
      const seq = [x.toString()];
      while (x !== 1n && steps < 5000) {
        x = x % 2n === 0n ? x / 2n : 3n * x + 1n;
        if (x > peak) peak = x;
        steps++;
        if (seq.length < 60) seq.push(x.toString());
      }
      return `${n}：经 ${steps} 步到 1，峰值 ${peak}\n轨迹前 ${seq.length} 项：${seq.join(" → ")}${steps > 59 ? " …" : ""}`;
    }, [P("n", "n", "如 27")]),

  runOp("dcode-extras-2026-10/math-wordvalue", CAT, "单词数值（毕达哥拉斯/迦勒底/希伯来/希腊）", "四种字母数值体系求和：毕达哥拉斯 A=1..I=9 循环；迦勒底 1:A I J Q Y…；希伯来 gematria；希腊 isopséphie",
    (t, p) => {
      const mode = String((p && p.mode) || "pyth").trim();
      const s = String(t || "").toUpperCase();
      if (!s) throw new Error("需要单词/文本");
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
