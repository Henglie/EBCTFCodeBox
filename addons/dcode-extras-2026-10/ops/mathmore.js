/*
 * dcode-extras · 数学补遗批（2026-10 · Agent A）
 * 纯 JS 确定性实现；搜索/区间类均有界，超限显式报错。
 */

import { big, isPrime, factorizeBounded, runOp } from "../lib/util.js";

const CAT = "dcode-extras-2026-10/cat-math";
const P = (key, label, ph) => ({ key, label, type: "text", default: "", placeholder: ph || "" });

function needBig(v, what) {
  if (v === null) throw new Error(`需要整数 ${what}`);
  return v;
}

function absBig(x) {
  return x < 0n ? -x : x;
}

function gcdBig(a, b) {
  a = absBig(a); b = absBig(b);
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}

function isqrtBig(n) {
  if (n < 0n) throw new Error("isqrt 需要非负整数");
  if (n < 2n) return n;
  let x = BigInt(Math.floor(Math.sqrt(Number(n))));
  while (x * x > n) x--;
  while ((x + 1n) * (x + 1n) <= n) x++;
  return x;
}

function modPowBig(b, e, m) {
  b %= m; if (b < 0n) b += m;
  let r = 1n;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

function aliquotSum(n) {
  if (n === 1n) return 0n;
  const f = factorizeBounded(n);
  if (!f.complete) throw new Error("n 过大无法完全分解，无法计算真因子和");
  let sum = 1n;
  for (const [p, e] of f.factors) {
    let term = 1n, pow = 1n;
    for (let i = 0; i < e; i++) { pow *= p; term += pow; }
    sum *= term;
  }
  return sum - n;
}

function happySteps(n) {
  if (n < 1n) throw new Error("快乐数定义在正整数上");
  const seen = new Set();
  let cur = n, steps = 0;
  const seq = [n.toString()];
  while (cur !== 1n) {
    const key = cur.toString();
    if (seen.has(key)) return { happy: false, steps, seq };
    seen.add(key);
    let next = 0n;
    for (const ch of key) next += BigInt(ch) * BigInt(ch);
    cur = next;
    steps++;
    seq.push(cur.toString());
    if (steps > 10000) throw new Error("快乐数迭代超过 10000 步（异常输入）");
  }
  return { happy: true, steps, seq };
}

function parseInterval(src) {
  const m = String(src).trim().match(/^(-?\d+)\s*[,~到]\s*(-?\d+)$/);
  if (!m) return null;
  return [BigInt(m[1]), BigInt(m[2])];
}

function farey(n) {
  if (n < 1) throw new Error("Farey 阶数需 ≥1");
  const out = [];
  let a = 0, b = 1, c = 1, d = n;
  out.push("0/1");
  while (c <= n) {
    const k = Math.floor((n + b) / d);
    const na = c, nb = d;
    c = k * c - a; d = k * d - b;
    a = na; b = nb;
    out.push(`${a}/${b}`);
  }
  return out;
}

const RAT_ZERO = [0n, 1n];
const rat = (n, d = 1n) => {
  if (d === 0n) throw new Error("有理数分母不能为 0");
  if (d < 0n) { n = -n; d = -d; }
  const g = gcdBig(n, d) || 1n;
  return [n / g, d / g];
};
const ratSub = (a, b) => rat(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const ratMul = (a, b) => rat(a[0] * b[0], a[1] * b[1]);
const ratDiv = (a, b) => {
  if (b[0] === 0n) throw new Error("有理数除法除数为 0");
  return rat(a[0] * b[1], a[1] * b[0]);
};
const ratNeg = (a) => [-a[0], a[1]];
const ratIsZero = (a) => a[0] === 0n;
const ratStr = (a) => (a[1] === 1n ? a[0].toString() : `${a[0]}/${a[1]}`);

function parseRat(s) {
  const t = String(s).trim();
  let m = t.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (m) return rat(BigInt(m[1]), BigInt(m[2]));
  m = t.match(/^(-?)(\d*)\.(\d+)$/);
  if (m) {
    const sign = m[1] === "-" ? -1n : 1n;
    const intPart = m[2] ? BigInt(m[2]) : 0n;
    const frac = m[3];
    const den = 10n ** BigInt(frac.length);
    return rat(sign * (intPart * den + BigInt(frac)), den);
  }
  if (/^-?\d+$/.test(t)) return rat(BigInt(t));
  throw new Error(`无法解析数字「${s}」（支持整数、a/b、十进制小数）`);
}

function parseMatrix(src) {
  const lines = String(src).replace(/[\[\]]/g, "").replace(/\r/g, "").split(/\n|;/).map((x) => x.trim()).filter(Boolean);
  if (!lines.length) throw new Error("需要矩阵：每行一项，元素用空格/逗号分隔");
  const m = lines.map((line) => line.split(/[\s,]+/).filter(Boolean).map(parseRat));
  const cols = m[0].length;
  if (!cols || !m.every((r) => r.length === cols)) throw new Error("矩阵每行列数必须一致");
  if (m.length > 12 || cols > 12) throw new Error("矩阵最大 12×12");
  return m;
}

function matDet(mat) {
  const n = mat.length;
  if (!n || mat.some((r) => r.length !== n)) throw new Error("行列式需要方阵");
  const a = mat.map((r) => r.map((x) => x.slice()));
  let det = rat(1n);
  for (let i = 0; i < n; i++) {
    let p = i;
    while (p < n && ratIsZero(a[p][i])) p++;
    if (p === n) return RAT_ZERO;
    if (p !== i) { [a[p], a[i]] = [a[i], a[p]]; det = ratNeg(det); }
    const pivot = a[i][i];
    det = ratMul(det, pivot);
    for (let r = i + 1; r < n; r++) {
      if (ratIsZero(a[r][i])) continue;
      const f = ratDiv(a[r][i], pivot);
      for (let c = i; c < n; c++) a[r][c] = ratSub(a[r][c], ratMul(f, a[i][c]));
    }
  }
  return det;
}

function matRank(mat) {
  const rows = mat.length, cols = mat[0].length;
  const a = mat.map((r) => r.map((x) => x.slice()));
  let rank = 0;
  for (let c = 0; c < cols && rank < rows; c++) {
    let p = rank;
    while (p < rows && ratIsZero(a[p][c])) p++;
    if (p === rows) continue;
    if (p !== rank) [a[p], a[rank]] = [a[rank], a[p]];
    const pivot = a[rank][c];
    for (let r = rank + 1; r < rows; r++) {
      if (ratIsZero(a[r][c])) continue;
      const f = ratDiv(a[r][c], pivot);
      for (let j = c; j < cols; j++) a[r][j] = ratSub(a[r][j], ratMul(f, a[rank][j]));
    }
    rank++;
  }
  return rank;
}

function matInverse(mat) {
  const n = mat.length;
  if (!n || mat.some((r) => r.length !== n)) throw new Error("求逆需要方阵");
  const a = mat.map((row, i) => [...row.map((x) => x.slice()), ...Array.from({ length: n }, (_, j) => rat(i === j ? 1n : 0n))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    while (p < n && ratIsZero(a[p][c])) p++;
    if (p === n) throw new Error("矩阵奇异，不可逆（存在全零主元列）");
    if (p !== c) [a[p], a[c]] = [a[c], a[p]];
    const pivot = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] = ratDiv(a[c][j], pivot);
    for (let r = 0; r < n; r++) {
      if (r === c || ratIsZero(a[r][c])) continue;
      const f = a[r][c];
      for (let j = 0; j < 2 * n; j++) a[r][j] = ratSub(a[r][j], ratMul(f, a[c][j]));
    }
  }
  return a.map((row) => row.slice(n));
}

function matrixRows(mat) {
  return mat.map((row) => row.map(ratStr).join(" ")).join("\n");
}

const SEL = (key, label, def, opts) => ({ key, label, type: "select", default: def, options: opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o)) });

export const OPS = [
  runOp("dcode-extras-2026-10/math-happy", CAT, "快乐数（Happy Numbers）", "反复把各位数字平方求和，最终到 1 为快乐数（A007770：1,7,10,13,19,23,28,31,32,44…）；支持单数判定或区间列举",
    (t, p) => {
      const src = String((p && p.n) || t || "").trim();
      const iv = parseInterval(src);
      if (iv) {
        const [a, b] = iv;
        if (a < 1n || b < a || b - a > 1000000n) throw new Error("区间需满足 1 ≤ a ≤ b 且跨度 ≤ 10^6");
        const hits = [];
        for (let n = a; n <= b; n++) if (happySteps(n).happy) hits.push(n.toString());
        return `${a}..${b} 内快乐数（${hits.length} 个）：\n${hits.join(", ") || "无"}`;
      }
      const n = needBig(big(src), "n");
      const r = happySteps(n);
      return r.happy
        ? `${n} 是快乐数（${r.steps} 步到达 1）\n${r.seq.join(" → ")}`
        : `${n} 不是快乐数（${r.steps} 步后进入循环）\n${r.seq.join(" → ")}`;
    }, [P("n", "n 或区间 a,b", "19 或 1,100")]),

  runOp("dcode-extras-2026-10/math-aliquot", CAT, "真因子和与完全/过剩/不足数", "s(n)=除自身外全部因子之和；s(n)=n 完全数（6/28/496）、s(n)>n 过剩数、s(n)<n 不足数",
    (t, p) => {
      const n = needBig(big((p && p.n) || t), "n（≥1）");
      if (n < 1n || n > 10n ** 15n) throw new Error("n 需在 1..10^15");
      const s = aliquotSum(n);
      const kind = s === n ? "完全数" : s > n ? "过剩数" : "不足数";
      return `真因子和 s(${n}) = ${s}\n判定：${n} 是${kind}（s(n) ${s === n ? "=" : s > n ? ">" : "<"} n）`;
    }, [P("n", "n", "28")]),

  runOp("dcode-extras-2026-10/math-amicable", CAT, "亲和数对（Amicable Pairs）", "枚举上限内满足 s(a)=b 且 s(b)=a 的 a<b 数对（220,284）、（1184,1210）…；倍数筛求因子和",
    (t, p) => {
      const lim = Number((p && p.limit) || t) || 0;
      if (!Number.isInteger(lim) || lim < 4 || lim > 1000000) throw new Error("上限需为 4..10^6");
      const sum = new Float64Array(lim + 1);
      for (let d = 1; d * 2 <= lim; d++) for (let m = d + d; m <= lim; m += d) sum[m] += d;
      const out = [];
      for (let a = 2; a <= lim; a++) {
        const b = sum[a];
        if (b > a && b <= lim && sum[b] === a) out.push(`(${a}, ${b})`);
        if (out.length > 10000) throw new Error("亲和数对超过 10000，请降低上限");
      }
      return `≤ ${lim} 的亲和数对（${out.length} 对）：\n${out.join("\n") || "无"}`;
    }, [P("limit", "上限", "10000")]),

  runOp("dcode-extras-2026-10/math-catalan", CAT, "Catalan 数 C(n)", "C(0..4)=1,1,2,5,14；C(10)=16796（A000108），BigInt 精确",
    (t, p) => {
      const n = Number((p && p.n) || t) || 0;
      if (!Number.isInteger(n) || n < 0 || n > 2000) throw new Error("n 需为 0..2000");
      let c = 1n;
      for (let i = 0; i < n; i++) c = c * 2n * BigInt(2 * i + 1) / BigInt(i + 2);
      return `C(${n}) = ${c.toString()}（${c.toString().length} 位）`;
    }, [P("n", "n", "10")]),

  runOp("dcode-extras-2026-10/math-stirling2", CAT, "第二类 Stirling 数 S(n,k)", "n 元集合划分为 k 个非空子集的方案数；S(4,2)=7、S(5,3)=25、S(10,5)=42525（A008277）",
    (t, p) => {
      const src = String((p && p.nk) || t || "").trim();
      const m = src.match(/^(-?\d+)\s*[,，\s]\s*(-?\d+)$/);
      if (!m) throw new Error("格式：n,k（如 10,5）");
      const n = Number(m[1]), k = Number(m[2]);
      if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0 || k < 0 || n > 500 || k > n) throw new Error("需 0 ≤ k ≤ n ≤ 500");
      const dp = new Array(k + 1).fill(0n);
      dp[0] = 1n;
      for (let i = 1; i <= n; i++) {
        for (let j = Math.min(i, k); j >= 1; j--) dp[j] = dp[j - 1] + BigInt(j) * dp[j];
        dp[0] = 0n;
      }
      if (n > 0) dp[0] = 0n;
      return `S(${n},${k}) = ${dp[k].toString()}`;
    }, [P("nk", "n,k", "10,5")]),

  runOp("dcode-extras-2026-10/math-lucas", CAT, "Lucas 数 L(n)", "L(0)=2, L(1)=1, L(n)=L(n-1)+L(n-2)；L(10)=123（A000032）",
    (t, p) => {
      const n = Number((p && p.n) || t) || 0;
      if (!Number.isInteger(n) || n < 0 || n > 10000) throw new Error("n 需为 0..10000");
      let a = 2n, b = 1n;
      if (n === 0) return "L(0) = 2";
      for (let i = 2; i <= n; i++) { const c = a + b; a = b; b = c; }
      return `L(${n}) = ${(n === 1 ? 1n : b).toString()}`;
    }, [P("n", "n", "10")]),

  runOp("dcode-extras-2026-10/math-josephus", CAT, "约瑟夫问题（Josephus）", "n 人围圈每数到 k 淘汰一人，返回最后幸存者编号（1 起）；J(7,3)=4、J(41,3)=31",
    (t, p) => {
      const src = String((p && p.nk) || t || "").trim();
      const m = src.match(/^(\d+)\s*[,，\s]\s*(\d+)$/);
      if (!m) throw new Error("格式：n,k（如 41,3）");
      const n = Number(m[1]), k = Number(m[2]);
      if (!Number.isInteger(n) || !Number.isInteger(k) || n < 1 || n > 10000000 || k < 1 || k > 1000000000) throw new Error("n 需 1..10^7，k 需 1..10^9");
      let r = 0;
      for (let i = 2; i <= n; i++) r = (r + k) % i;
      return `J(${n},${k}) = ${r + 1}（1 起；0 起为 ${r}）`;
    }, [P("nk", "n,k", "41,3")]),

  runOp("dcode-extras-2026-10/math-egyptian", CAT, "埃及分数（Egyptian Fraction）", "贪心分解为单位分数之和：4/13 = 1/4 + 1/18 + 1/468；结果项数有界，超限报错",
    (t, p) => {
      const src = String((p && p.v) || t || "").trim();
      const m = src.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (!m) throw new Error("格式：a/b（0 < a < b）");
      let a = BigInt(m[1]), b = BigInt(m[2]);
      if (a <= 0n || b <= 0n || a >= b) throw new Error("需要真分数 0 < a < b");
      const terms = [];
      while (a > 0n) {
        const q = (b + a - 1n) / a;
        terms.push(q);
        a = a * q - b;
        b = b * q;
        const g = gcdBig(a, b) || 1n;
        a /= g; b /= g;
        if (terms.length > 1000) throw new Error("埃及分数项数超过 1000，拒绝继续（避免无限展开）");
      }
      return `${m[1]}/${m[2]} = ${terms.map((q) => `1/${q}`).join(" + ")}（${terms.length} 项）`;
    }, [P("v", "a/b", "4/13")]),

  runOp("dcode-extras-2026-10/math-goldbach", CAT, "Goldbach 分拆", "偶数 n 写成两个素数之和的全部无序分拆；100 有 6 组（3+97, 11+89, …）",
    (t, p) => {
      const n = Number((p && p.n) || t) || 0;
      if (!Number.isInteger(n) || n < 4 || n > 1000000 || n % 2 !== 0) throw new Error("n 需为 4..10^6 的偶数");
      const sieve = new Uint8Array(n + 1);
      for (let i = 2; i * i <= n; i++) if (!sieve[i]) for (let j = i * i; j <= n; j += i) sieve[j] = 1;
      const pairs = [];
      for (let a = 2; a <= n / 2; a++) if (!sieve[a] && !sieve[n - a]) pairs.push(`${a} + ${n - a}`);
      if (pairs.length > 5000) throw new Error(`分拆数 ${pairs.length} 超过 5000，请换更小的 n`);
      return `${n} 的 Goldbach 分拆（${pairs.length} 组）：\n${pairs.join("\n") || "无（奇数或异常输入）"}`;
    }, [P("n", "偶数 n", "100")]),

  runOp("dcode-extras-2026-10/math-twinprimes", CAT, "孪生素数（Twin Primes）", "列举上限内相差 2 的素数对：(3,5), (5,7), (11,13), (17,19), (29,31), (41,43)…",
    (t, p) => {
      const lim = Number((p && p.limit) || t) || 0;
      if (!Number.isInteger(lim) || lim < 5 || lim > 1000000) throw new Error("上限需为 5..10^6");
      const sieve = new Uint8Array(lim + 1);
      for (let i = 2; i * i <= lim; i++) if (!sieve[i]) for (let j = i * i; j <= lim; j += i) sieve[j] = 1;
      const out = [];
      for (let q = 3; q + 2 <= lim; q += 2) if (!sieve[q] && !sieve[q + 2]) out.push(`(${q}, ${q + 2})`);
      if (out.length > 20000) throw new Error(`孪生素数对超过 20000，请降低上限`);
      return `≤ ${lim} 的孪生素数对（${out.length} 对）：\n${out.join(", ") || "无"}`;
    }, [P("limit", "上限", "50")]),

  runOp("dcode-extras-2026-10/math-persistence", CAT, "数位持久性（Persistence）", "加法持久性：位和反复折叠到一位的步数；乘法持久性：位积反复折叠（39→27→14→4 为 3 步；277777788888899 为已知 11 步）",
    (t, p) => {
      const n = needBig(big((p && p.n) || t), "n（非负整数）");
      if (n < 0n) throw new Error("需要非负整数");
      const addSeq = [n.toString()], mulSeq = [n.toString()];
      let a = n, addSteps = 0;
      while (a >= 10n) { let s = 0n; for (const ch of a.toString()) s += BigInt(ch); a = s; addSteps++; addSeq.push(a.toString()); }
      let m = n, mulSteps = 0;
      while (m >= 10n) { let s = 1n; for (const ch of m.toString()) s *= BigInt(ch); m = s; mulSteps++; mulSeq.push(m.toString()); if (mulSteps > 100) throw new Error("乘法持久性迭代超过 100 步"); }
      return `加法持久性 = ${addSteps}（${addSeq.join(" → ")}）\n乘法持久性 = ${mulSteps}（${mulSeq.join(" → ")}）`;
    }, [P("n", "n", "39")]),

  runOp("dcode-extras-2026-10/math-pell", CAT, "Pell 方程 x²−Dy²=1", "用 √D 连分数求最小正整数解；D=2 → (3,2)，D=61 → (1766319049,226153980)；D 不能是完全平方",
    (t, p) => {
      const D = needBig(big((p && p.d) || t), "D");
      if (D < 2n || D > 10n ** 9n) throw new Error("D 需在 2..10^9");
      const a0 = isqrtBig(D);
      if (a0 * a0 === D) throw new Error("D 是完全平方，x²−Dy²=1 只有平凡解");
      let m = 0n, d = 1n, a = a0;
      const period = [];
      for (let i = 0; i < 100000; i++) {
        m = d * a - m;
        d = (D - m * m) / d;
        a = (a0 + m) / d;
        period.push(a);
        if (a === 2n * a0) break;
      }
      let p0 = 0n, p1 = 1n, q0 = 1n, q1 = 0n;
      for (let round = 0; round < 4; round++) {
        for (const ai of (round === 0 ? [a0, ...period] : period)) {
          const p2 = ai * p1 + p0, q2 = ai * q1 + q0;
          p0 = p1; p1 = p2; q0 = q1; q1 = q2;
          if (p1 * p1 - D * q1 * q1 === 1n) return `x = ${p1}\ny = ${q1}\n校验：${p1}² − ${D}×${q1}² = 1`;
        }
      }
      throw new Error("连分数周期超过 4 轮仍未找到解（拒绝无限搜索）");
    }, [P("d", "D", "61")]),

  runOp("dcode-extras-2026-10/math-farey", CAT, "Farey 数列 F(n)", "0 到 1 之间分母 ≤ n 的最简分数按大小排列；F(5)=0/1,1/5,1/4,1/3,2/5,1/2,3/5,2/3,3/4,4/5,1/1",
    (t, p) => {
      const n = Number((p && p.n) || t) || 0;
      if (!Number.isInteger(n) || n < 1 || n > 100) throw new Error("n 需为 1..100（避免输出爆炸）");
      const seq = farey(n);
      return `F(${n}) 共 ${seq.length} 项：\n${seq.join(", ")}`;
    }, [P("n", "n", "5")]),

  runOp("dcode-extras-2026-10/math-thuemorse", CAT, "Thue–Morse 序列", "t(i)=i 的二进制 1 的个数奇偶；前 16 位 0110100110010110（A010060）；可给 check 串校验前缀",
    (t, p) => {
      const n = Number((p && p.n) || t) || 0;
      const chk = String((p && p.check) || "").trim();
      if (chk) {
        if (!/^[01]+$/.test(chk)) throw new Error("check 只能是 0/1 串");
        const bad = [];
        for (let i = 0; i < chk.length; i++) {
          let x = i, c = 0;
          while (x) { c ^= x & 1; x >>= 1; }
          if (chk[i] !== String(c)) bad.push(i);
        }
        return bad.length ? `不是 Thue–Morse 前缀：第 ${bad.slice(0, 20).join(",")} 位不符（共 ${bad.length} 处）` : `是 Thue–Morse 前缀（${chk.length} 位全部符合）`;
      }
      if (!Number.isInteger(n) || n < 1 || n > 100000) throw new Error("n 需为 1..100000");
      const seq = [];
      for (let i = 0; i < n; i++) { let x = i, c = 0; while (x) { c ^= x & 1; x >>= 1; } seq.push(c); }
      return `前 ${n} 位 Thue–Morse：${seq.join("")}\n校验式：t(i) = popcount(i) mod 2`;
    }, [P("n", "位数 n", "16"), P("check", "校验 0/1 串（可选）", "")]),

  runOp("dcode-extras-2026-10/math-matrix", CAT, "矩阵行列式 / 秩 / 逆（有理数精确）", "分数消元，BigInt 有理数精确计算；输入每行一项、元素空格/逗号分隔，支持 a/b 与十进制小数；最大 12×12",
    (t, p) => {
      const mode = String((p && p.mode) || "det");
      const mat = parseMatrix((p && p.m) || t);
      if (mode === "det") return `矩阵 ${mat.length}×${mat[0].length}\n行列式 = ${ratStr(matDet(mat))}`;
      if (mode === "rank") return `矩阵 ${mat.length}×${mat[0].length}\n秩 = ${matRank(mat)}`;
      if (mode === "inverse") return `逆矩阵：\n${matrixRows(matInverse(mat))}`;
      throw new Error(`未知模式 ${mode}（det/rank/inverse）`);
    }, [P("m", "矩阵", "1 2\n3 4"), SEL("mode", "运算", "det", [{ value: "det", label: "行列式" }, { value: "rank", label: "秩" }, { value: "inverse", label: "逆矩阵" }])]),

  runOp("dcode-extras-2026-10/math-tonelli", CAT, "模平方根（Tonelli–Shanks）", "求 x²≡a (mod p) 的两个根；p 为奇素数，无解时按 Legendre 符号明确报告；支持 BigInt",
    (t, p) => {
      const src = String((p && p.ap) || t || "").trim();
      const m = src.match(/^(-?\d+)\s*[,，\s]\s*(\d+)$/);
      if (!m) throw new Error("格式：a,p（如 10,13）");
      let a = BigInt(m[1]);
      const prime = BigInt(m[2]);
      if (prime < 2n || prime > 10n ** 18n) throw new Error("p 需在 2..10^18");
      if (prime === 2n) return `x² ≡ ${a} (mod 2) 的根：${((a % 2n) + 2n) % 2n}`;
      if (!isPrime(prime)) throw new Error("p 必须是素数");
      a = ((a % prime) + prime) % prime;
      if (a === 0n) return `x² ≡ 0 (mod ${prime}) 的根：0（重根）`;
      if (modPowBig(a, (prime - 1n) / 2n, prime) !== 1n) return `x² ≡ ${a} (mod ${prime}) 无解（Legendre 符号 = −1）`;
      let q = prime - 1n, s = 0n;
      while (q % 2n === 0n) { q /= 2n; s++; }
      let z = 2n;
      while (modPowBig(z, (prime - 1n) / 2n, prime) !== prime - 1n) z++;
      let mm = s, c = modPowBig(z, q, prime), tt = modPowBig(a, q, prime), r = modPowBig(a, (q + 1n) / 2n, prime);
      while (tt !== 1n) {
        let i = 1n, t2 = (tt * tt) % prime;
        while (t2 !== 1n) { t2 = (t2 * t2) % prime; i++; if (i >= mm) throw new Error("Tonelli–Shanks 未能收敛"); }
        const b = modPowBig(c, 1n << (mm - i - 1n), prime);
        r = (r * b) % prime;
        c = (b * b) % prime;
        tt = (tt * c) % prime;
        mm = i;
      }
      const other = prime - r;
      return `x² ≡ ${a} (mod ${prime}) 的根：${r < other ? `${r} 或 ${other}` : `${other} 或 ${r}`}\n校验：${r}² mod ${prime} = ${(r * r) % prime}`;
    }, [P("ap", "a,p", "10,13")]),
];
