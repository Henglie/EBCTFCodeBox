/*
 * dcode-extras · 数学补遗批（2026-10 · Agent A）
 * 纯 JS 确定性实现；搜索/区间类均有界，超限显式报错。
 */

import { big, isPrime, factorizeBounded, runOp, assertBudget, log10Factorial, BUDGET_LIMITS } from "../lib/util.js";

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

function assertItemsBig(amount, label) {
  if (amount > BigInt(BUDGET_LIMITS.items)) {
    throw new Error(`${label}超过当前 ${BUDGET_LIMITS.items.toLocaleString("en-US")} 项预算；请缩小输入或分段处理。`);
  }
  return assertBudget("items", Number(amount), label);
}

function isqrtBig(n) {
  if (n < 0n) throw new Error("isqrt 需要非负整数");
  if (n < 2n) return n;
  let x = 1n << BigInt((n.toString(2).length + 1) >> 1);
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
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

function aliquotSum(n, rhoIters) {
  if (n === 1n) return 0n;
  const f = factorizeBounded(n, rhoIters);
  if (!f.complete) throw new Error(`n 无法在预算内完全分解（Pollard rho 每种子 ${rhoIters} 次迭代），无法保证真因子和精确；请改用更小的 n`);
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
    if (steps > 10000) throw new Error("快乐数序列 10000 步内未进入已知循环（算法收敛保护，拒绝继续）");
  }
  return { happy: true, steps, seq };
}

function parseInterval(src) {
  const m = String(src).trim().match(/^(-?\d+)\s*[,~到]\s*(-?\d+)$/);
  if (!m) return null;
  return [BigInt(m[1]), BigInt(m[2])];
}

function fareyCount(n) {
  const phi = new Uint32Array(n + 1);
  for (let i = 0; i <= n; i++) phi[i] = i;
  for (let p = 2; p <= n; p++) {
    if (phi[p] !== p) continue;
    for (let k = p; k <= n; k += p) phi[k] -= Math.floor(phi[k] / p);
  }
  let count = 1;
  for (let i = 1; i <= n; i++) count += phi[i];
  return count;
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
  const text = String(src);
  assertBudget("chars", text.length, "矩阵输入");
  const lines = text.replace(/[\[\]]/g, "").replace(/\r/g, "").split(/\n|;/).map((x) => x.trim()).filter(Boolean);
  if (!lines.length) throw new Error("需要矩阵：每行一项，元素用空格/逗号分隔");
  const limitMsg = "矩阵最大 12×12：同步有理数精确消元的耗时/内存硬边界；更大规模需改用模算或数值实现";
  if (lines.length > 12 || lines[0].split(/[\s,]+/).filter(Boolean).length > 12) throw new Error(limitMsg);
  const m = lines.map((line) => line.split(/[\s,]+/).filter(Boolean).map(parseRat));
  const cols = m[0].length;
  if (!cols || !m.every((r) => r.length === cols)) throw new Error("矩阵每行列数必须一致");
  if (m.length > 12 || cols > 12) throw new Error(limitMsg);
  assertBudget("items", m.length * cols, "矩阵元素");
  let maxDigits = 1;
  for (const row of m) for (const x of row) {
    maxDigits = Math.max(maxDigits, absBig(x[0]).toString().length, x[1].toString().length);
  }
  const dim = Math.max(m.length, cols);
  assertBudget("chars", m.length * cols * (maxDigits * dim + 8) + 64, "矩阵结果");
  const words = Math.max(1, Math.ceil((maxDigits * dim) / 16));
  assertBudget("bigSteps", m.length * cols * dim * words * words, "矩阵有理消元");
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
      assertBudget("chars", src.length, "快乐数输入");
      const iv = parseInterval(src);
      if (iv) {
        const [a, b] = iv;
        if (a < 1n || b < a) throw new Error("区间需满足 1 ≤ a ≤ b");
        const span = b - a + 1n;
        assertItemsBig(span, "快乐数区间跨度");
        const maxDigits = Math.max(1, b.toString().length);
        assertBudget("bigSteps", Number(span) * maxDigits * 4, "快乐数区间数位处理");
        const hits = [];
        let work = 0;
        for (let n = a; n <= b; n++) {
          const r = happySteps(n);
          work += r.steps + 1;
          assertBudget("steps", work, "快乐数区间迭代");
          if (r.happy) hits.push(n.toString());
        }
        const body = hits.join(", ") || "无";
        assertBudget("chars", src.length + body.length + 128, "快乐数区间结果");
        return `${a}..${b} 内快乐数（${hits.length} 个）：\n${body}`;
      }
      const n = needBig(big(src), "n");
      assertBudget("bigSteps", src.length + 100000, "快乐数数位处理");
      assertBudget("chars", 2 * src.length + 110000 + 128, "快乐数结果");
      const r = happySteps(n);
      const body = r.seq.join(" → ");
      assertBudget("chars", body.length + 128, "快乐数结果");
      return r.happy
        ? `${n} 是快乐数（${r.steps} 步到达 1）\n${body}`
        : `${n} 不是快乐数（${r.steps} 步后进入循环）\n${body}`;
    }, [P("n", "n 或区间 a,b", "19 或 1,100")]),

  runOp("dcode-extras-2026-10/math-aliquot", CAT, "真因子和与完全/过剩/不足数", "s(n)=除自身外全部因子之和；s(n)=n 完全数（6/28/496）、s(n)>n 过剩数、s(n)<n 不足数",
    (t, p) => {
      const src = String((p && p.n) || t || "").trim();
      assertBudget("chars", src.length, "n 输入");
      const digits = Math.max(1, src.replace(/^[+-]/, "").replace(/^0+/, "").length);
      const words = Math.max(1, Math.ceil(digits / 16));
      assertBudget("bigSteps", 2_400_000 * words * words, "真因子和分解");
      const rhoIters = words <= 1
        ? 200000
        : Math.max(1000, Math.min(200000, Math.floor(BUDGET_LIMITS.bigSteps / (6000 * words * words))));
      const n = needBig(big(src), "n（≥1）");
      if (n < 1n) throw new Error("n 需为正整数");
      const s = aliquotSum(n, rhoIters);
      const kind = s === n ? "完全数" : s > n ? "过剩数" : "不足数";
      return `真因子和 s(${n}) = ${s}\n判定：${n} 是${kind}（s(n) ${s === n ? "=" : s > n ? ">" : "<"} n）`;
    }, [P("n", "n", "28")]),

  runOp("dcode-extras-2026-10/math-amicable", CAT, "亲和数对（Amicable Pairs）", "枚举上限内满足 s(a)=b 且 s(b)=a 的 a<b 数对（220,284）、（1184,1210）…；倍数筛求因子和",
    (t, p) => {
      const src = String((p && p.limit) || t || "").trim();
      assertBudget("chars", src.length, "上限输入");
      const lim = Number(src) || 0;
      if (!Number.isSafeInteger(lim) || lim < 4) throw new Error("上限需为 ≥4 的安全整数");
      assertBudget("items", lim + 1, "亲和数倍数筛表");
      assertBudget("steps", lim * Math.log(Math.max(2, lim)) + lim, "亲和数倍数筛");
      const sum = new Float64Array(lim + 1);
      for (let d = 1; d * 2 <= lim; d++) for (let m = d + d; m <= lim; m += d) sum[m] += d;
      const out = [];
      let outChars = 64;
      for (let a = 2; a <= lim; a++) {
        const b = sum[a];
        if (b > a && b <= lim && sum[b] === a) {
          out.push(`(${a}, ${b})`);
          assertBudget("items", out.length, "亲和数对");
          outChars += 8 + String(b).length * 2;
          assertBudget("chars", outChars, "亲和数对输出");
        }
      }
      return `≤ ${lim} 的亲和数对（${out.length} 对）：\n${out.join("\n") || "无"}`;
    }, [P("limit", "上限", "10000")]),

  runOp("dcode-extras-2026-10/math-catalan", CAT, "Catalan 数 C(n)", "C(0..4)=1,1,2,5,14；C(10)=16796（A000108），BigInt 精确",
    (t, p) => {
      const src = String((p && p.n) || t || "").trim();
      assertBudget("chars", src.length, "n 输入");
      if (!/^\d+$/.test(src)) throw new Error("n 需为非负整数（十进制数字，不接受空串/符号/小数）");
      const n = Number(src);
      if (!Number.isSafeInteger(n)) throw new Error("n 需为非负安全整数（≤ 2^53-1）");
      const digits = Math.floor(log10Factorial(2 * n) - 2 * log10Factorial(n) - Math.log10(n + 1)) + 1;
      assertBudget("chars", digits + 64, `C(${n})`);
      assertBudget("bigSteps", n * n + n + 1, "Catalan 递推");
      let c = 1n;
      for (let i = 0; i < n; i++) c = c * 2n * BigInt(2 * i + 1) / BigInt(i + 2);
      const text = c.toString();
      assertBudget("chars", text.length + 64, `C(${n})`);
      return `C(${n}) = ${text}（${text.length} 位）`;
    }, [P("n", "n", "10")]),

  runOp("dcode-extras-2026-10/math-stirling2", CAT, "第二类 Stirling 数 S(n,k)", "n 元集合划分为 k 个非空子集的方案数；S(4,2)=7、S(5,3)=25、S(10,5)=42525（A008277）",
    (t, p) => {
      const src = String((p && p.nk) || t || "").trim();
      const m = src.match(/^(-?\d+)\s*[,，\s]\s*(-?\d+)$/);
      if (!m) throw new Error("格式：n,k（如 10,5）");
      const n = Number(m[1]), k = Number(m[2]);
      if (!Number.isSafeInteger(n) || !Number.isSafeInteger(k) || n < 0 || k < 0 || k > n) throw new Error("需 0 ≤ k ≤ n（n、k 为安全整数）");
      if (k === 0) return `S(${n},${k}) = ${n === 0 ? 1 : 0}`;
      if (k === 1 || k === n) return `S(${n},${k}) = 1`;
      const logC = log10Factorial(n) - log10Factorial(k) - log10Factorial(n - k);
      const digits = Math.floor(logC + (n - k) * Math.log10(k)) + 1;
      assertBudget("chars", digits + 64, `S(${n},${k})`);
      assertBudget("bigSteps", n * k * Math.max(1, Math.ceil(n / 16)) + 1, "Stirling2 递推");
      const dp = new Array(k + 1).fill(0n);
      dp[0] = 1n;
      for (let i = 1; i <= n; i++) {
        for (let j = Math.min(i, k); j >= 1; j--) dp[j] = dp[j - 1] + BigInt(j) * dp[j];
        dp[0] = 0n;
      }
      const text = dp[k].toString();
      assertBudget("chars", text.length + 64, `S(${n},${k})`);
      return `S(${n},${k}) = ${text}`;
    }, [P("nk", "n,k", "10,5")]),

  runOp("dcode-extras-2026-10/math-lucas", CAT, "Lucas 数 L(n)", "L(0)=2, L(1)=1, L(n)=L(n-1)+L(n-2)；L(10)=123（A000032）",
    (t, p) => {
      const src = String((p && p.n) || t || "").trim();
      assertBudget("chars", src.length, "n 输入");
      if (!/^\d+$/.test(src)) throw new Error("n 需为非负整数（十进制数字，不接受空串/符号/小数）");
      const n = Number(src);
      if (!Number.isSafeInteger(n)) throw new Error("n 需为非负安全整数（≤ 2^53-1）");
      assertBudget("chars", Math.ceil(n * 0.20898764024997873) + 64, `L(${n})`);
      assertBudget("bigSteps", n * n / 100 + n + 1, "Lucas 递推");
      let a = 2n, b = 1n;
      if (n === 0) return "L(0) = 2";
      for (let i = 2; i <= n; i++) { const c = a + b; a = b; b = c; }
      return `L(${n}) = ${(n === 1 ? 1n : b).toString()}`;
    }, [P("n", "n", "10")]),

  runOp("dcode-extras-2026-10/math-josephus", CAT, "约瑟夫问题（Josephus）", "n 人围圈每数到 k 淘汰一人，返回最后幸存者编号（1 起）；J(7,3)=4、J(41,3)=31",
    (t, p) => {
      const src = String((p && p.nk) || t || "").trim();
      assertBudget("chars", src.length, "n,k 输入");
      const m = src.match(/^(\d+)\s*[,，\s]\s*(\d+)$/);
      if (!m) throw new Error("格式：n,k（如 41,3）");
      const n = Number(m[1]);
      if (!Number.isSafeInteger(n) || n < 1) throw new Error("n 需为正安全整数");
      if (/^0+$/.test(m[2])) throw new Error("k 需为正整数");
      assertBudget("steps", n, "Josephus 递推");
      const kNum = Number(m[2]);
      let r;
      if (Number.isSafeInteger(kNum)) {
        r = 0;
        for (let i = 2; i <= n; i++) r = (r + (kNum % i)) % i;
      } else {
        assertBudget("bigSteps", n * Math.ceil(m[2].length / 16), "Josephus 大数取模");
        const kBig = BigInt(m[2]);
        let rb = 0n;
        for (let i = 2; i <= n; i++) rb = (rb + (kBig % BigInt(i))) % BigInt(i);
        r = Number(rb);
      }
      return `J(${n},${Number.isSafeInteger(kNum) ? kNum : m[2]}) = ${r + 1}（1 起；0 起为 ${r}）`;
    }, [P("nk", "n,k", "41,3")]),

  runOp("dcode-extras-2026-10/math-egyptian", CAT, "埃及分数（Egyptian Fraction）", "贪心分解为单位分数之和：4/13 = 1/4 + 1/18 + 1/468；结果项数有界，超限报错",
    (t, p) => {
      const src = String((p && p.v) || t || "").trim();
      assertBudget("chars", src.length, "分数输入");
      const m = src.match(/^(\d+)\s*\/\s*(\d+)$/);
      if (!m) throw new Error("格式：a/b（0 < a < b）");
      const initWords = Math.max(1, Math.ceil(src.length / 16));
      assertBudget("bigSteps", initWords * initWords * 4, "埃及分数初始化");
      let a = BigInt(m[1]), b = BigInt(m[2]);
      if (a <= 0n || b <= 0n || a >= b) throw new Error("需要真分数 0 < a < b");
      const terms = [];
      let work = 0, outChars = m[1].length + m[2].length + 32;
      while (a > 0n) {
        const q = (b + a - 1n) / a;
        terms.push(q);
        a = a * q - b;
        b = b * q;
        const g = gcdBig(a, b) || 1n;
        a /= g; b /= g;
        const words = Math.max(1, Math.ceil((a.toString().length + b.toString().length) / 16));
        work += 8 + 4 * words * words;
        assertBudget("bigSteps", work, "埃及分数展开");
        assertBudget("items", terms.length, "埃及分数项数");
        outChars += q.toString().length + 5;
        assertBudget("chars", outChars, "埃及分数输出");
      }
      return `${m[1]}/${m[2]} = ${terms.map((q) => `1/${q}`).join(" + ")}（${terms.length} 项）`;
    }, [P("v", "a/b", "4/13")]),

  runOp("dcode-extras-2026-10/math-goldbach", CAT, "Goldbach 分拆", "偶数 n 写成两个素数之和的全部无序分拆；100 有 6 组（3+97, 11+89, …）",
    (t, p) => {
      const src = String((p && p.n) || t || "").trim();
      assertBudget("chars", src.length, "n 输入");
      const n = Number(src) || 0;
      if (!Number.isSafeInteger(n) || n < 4 || n % 2 !== 0) throw new Error("n 需为 ≥4 的偶数");
      assertBudget("items", n + 1, "Goldbach 素数筛表");
      assertBudget("steps", n * 8, "Goldbach 筛法");
      const sieve = new Uint8Array(n + 1);
      for (let i = 2; i * i <= n; i++) if (!sieve[i]) for (let j = i * i; j <= n; j += i) sieve[j] = 1;
      const pairs = [];
      let outChars = 64;
      for (let a = 2; a <= n / 2; a++) {
        if (!sieve[a] && !sieve[n - a]) {
          pairs.push(`${a} + ${n - a}`);
          assertBudget("items", pairs.length, "Goldbach 分拆");
          outChars += String(a).length + String(n - a).length + 10;
          assertBudget("chars", outChars, "Goldbach 输出");
        }
      }
      return `${n} 的 Goldbach 分拆（${pairs.length} 组）：\n${pairs.join("\n") || "无（奇数或异常输入）"}`;
    }, [P("n", "偶数 n", "100")]),

  runOp("dcode-extras-2026-10/math-twinprimes", CAT, "孪生素数（Twin Primes）", "列举上限内相差 2 的素数对：(3,5), (5,7), (11,13), (17,19), (29,31), (41,43)…",
    (t, p) => {
      const src = String((p && p.limit) || t || "").trim();
      assertBudget("chars", src.length, "上限输入");
      const lim = Number(src) || 0;
      if (!Number.isSafeInteger(lim) || lim < 5) throw new Error("上限需为 ≥5 的安全整数");
      assertBudget("items", lim + 1, "孪生素数筛表");
      assertBudget("steps", lim * 8, "孪生素数筛法");
      const sieve = new Uint8Array(lim + 1);
      for (let i = 2; i * i <= lim; i++) if (!sieve[i]) for (let j = i * i; j <= lim; j += i) sieve[j] = 1;
      const out = [];
      let outChars = 64;
      for (let q = 3; q + 2 <= lim; q += 2) {
        if (!sieve[q] && !sieve[q + 2]) {
          out.push(`(${q}, ${q + 2})`);
          assertBudget("items", out.length, "孪生素数对");
          outChars += String(q).length * 2 + 8;
          assertBudget("chars", outChars, "孪生素数输出");
        }
      }
      return `≤ ${lim} 的孪生素数对（${out.length} 对）：\n${out.join(", ") || "无"}`;
    }, [P("limit", "上限", "50")]),

  runOp("dcode-extras-2026-10/math-persistence", CAT, "数位持久性（Persistence）", "加法持久性：位和反复折叠到一位的步数；乘法持久性：位积反复折叠（39→27→14→4 为 3 步；277777788888899 为已知 11 步）",
    (t, p) => {
      const src = String((p && p.n) || t || "").trim();
      assertBudget("chars", src.length, "n 输入");
      assertBudget("chars", 2 * src.length + 256, "持久性序列输出");
      assertBudget("bigSteps", src.length + 1, "数位折叠");
      const n = needBig(big(src), "n（非负整数）");
      if (n < 0n) throw new Error("需要非负整数");
      const addSeq = [n.toString()], mulSeq = [n.toString()];
      let a = n, addSteps = 0;
      while (a >= 10n) { let s = 0n; for (const ch of a.toString()) s += BigInt(ch); a = s; addSteps++; addSeq.push(a.toString()); }
      let m = n, mulSteps = 0;
      while (m >= 10n) {
        let s = 1n;
        for (const ch of m.toString()) s *= BigInt(ch);
        m = s; mulSteps++; mulSeq.push(m.toString());
        if (mulSteps > 100) throw new Error("乘法持久性 100 步内未收敛（已知最大为 11；算法保护，拒绝继续）");
      }
      return `加法持久性 = ${addSteps}（${addSeq.join(" → ")}）\n乘法持久性 = ${mulSteps}（${mulSeq.join(" → ")}）`;
    }, [P("n", "n", "39")]),

  runOp("dcode-extras-2026-10/math-pell", CAT, "Pell 方程 x²−Dy²=1", "用 √D 连分数求最小正整数解；D=2 → (3,2)，D=61 → (1766319049,226153980)；D 不能是完全平方",
    (t, p) => {
      const src = String((p && p.d) || t || "").trim();
      assertBudget("chars", src.length, "D 输入");
      const srcDigits = src.replace(/^[+-]/, "").replace(/^0+/, "").length || 1;
      const srcWords = Math.max(1, Math.ceil(srcDigits / 16));
      assertBudget("bigSteps", srcWords * srcWords * 4, "Pell 大数运算");
      const D = needBig(big(src), "D");
      if (D < 2n) throw new Error("D 需为 ≥2 的整数");
      const digits = D.toString().length;
      const words = Math.max(1, Math.ceil(digits / 16));
      const a0 = isqrtBig(D);
      if (a0 * a0 === D) throw new Error("D 是完全平方，x²−Dy²=1 只有平凡解");
      assertBudget("chars", Math.ceil(digits * 4) + 64, "Pell 解输出");
      let m = 0n, d = 1n, a = a0;
      const period = [];
      let closed = false, work = 0;
      for (;;) {
        m = d * a - m;
        d = (D - m * m) / d;
        a = (a0 + m) / d;
        period.push(a);
        work += 12 * words * words;
        assertBudget("bigSteps", work, "Pell 连分数");
        assertBudget("items", period.length, "Pell 连分数周期");
        if (a === 2n * a0) { closed = true; break; }
      }
      if (!closed) throw new Error(`Pell 连分数周期超过 ${period.length} 项预算，已拒绝继续（周期长度无通用上界）`);
      assertBudget("bigSteps", work * 5, "Pell 收敛子展开");
      let p0 = 0n, p1 = 1n, q0 = 1n, q1 = 0n;
      for (let round = 0; round < 4; round++) {
        for (const ai of (round === 0 ? [a0, ...period] : period)) {
          const p2 = ai * p1 + p0, q2 = ai * q1 + q0;
          p0 = p1; p1 = p2; q0 = q1; q1 = q2;
          if (p1 * p1 - D * q1 * q1 === 1n) return `x = ${p1}\ny = ${q1}\n校验：${p1}² − ${D}×${q1}² = 1`;
        }
      }
      throw new Error("连分数展开 4 轮内未找到解（Pell 解的收敛子保证位于前 4 轮，拒绝无限搜索）");
    }, [P("d", "D", "61")]),

  runOp("dcode-extras-2026-10/math-farey", CAT, "Farey 数列 F(n)", "0 到 1 之间分母 ≤ n 的最简分数按大小排列；F(5)=0/1,1/5,1/4,1/3,2/5,1/2,3/5,2/3,3/4,4/5,1/1",
    (t, p) => {
      const src = String((p && p.n) || t || "").trim();
      assertBudget("chars", src.length, "n 输入");
      if (!/^\d+$/.test(src)) throw new Error("n 需为正整数（十进制数字，不接受空串/符号/小数）");
      const n = Number(src);
      if (!Number.isSafeInteger(n) || n < 1) throw new Error("n 需为正安全整数");
      assertBudget("items", n + 1, `F(${n}) φ 筛表`);
      assertBudget("steps", Math.ceil(2 * n * Math.log2(n + 1)), `F(${n}) φ 计数`);
      const count = fareyCount(n);
      const itemChars = 2 * String(n).length + 3;
      assertBudget("items", count, `F(${n}) 项数`);
      assertBudget("steps", count, `F(${n}) 生成`);
      assertBudget("chars", count * itemChars + 64, `F(${n}) 输出`);
      const seq = farey(n);
      if (seq.length !== count) throw new Error(`F(${n}) 实际生成 ${seq.length} 项，与精确计数 ${count} 不一致（内部一致性错误）`);
      assertBudget("items", seq.length, `F(${n}) 实际项数`);
      assertBudget("chars", seq.length * itemChars + 64, `F(${n}) 实际输出`);
      return `F(${n}) 共 ${seq.length} 项：\n${seq.join(", ")}`;
    }, [P("n", "n", "5")]),

  runOp("dcode-extras-2026-10/math-thuemorse", CAT, "Thue–Morse 序列", "t(i)=i 的二进制 1 的个数奇偶；前 16 位 0110100110010110（A010060）；可给 check 串校验前缀",
    (t, p) => {
      const n = Number((p && p.n) || t) || 0;
      const chk = String((p && p.check) || "").trim();
      if (chk) {
        if (!/^[01]+$/.test(chk)) throw new Error("check 只能是 0/1 串");
        assertBudget("chars", chk.length, "校验串");
        assertBudget("steps", chk.length + 1, "Thue–Morse 前缀校验");
        const bits = new Uint8Array(chk.length);
        for (let i = 1; i < chk.length; i++) bits[i] = bits[i >> 1] ^ (i & 1);
        let badCount = 0;
        const bad = [];
        for (let i = 0; i < chk.length; i++) {
          if (chk.charCodeAt(i) !== 48 + bits[i]) {
            badCount++;
            if (bad.length < 20) bad.push(i);
          }
        }
        return badCount ? `不是 Thue–Morse 前缀：第 ${bad.join(",")} 位不符（共 ${badCount} 处）` : `是 Thue–Morse 前缀（${chk.length} 位全部符合）`;
      }
      const src = String((p && p.n) || t || "").trim();
      assertBudget("chars", src.length, "n 输入");
      if (!Number.isSafeInteger(n) || n < 1) throw new Error("n 需为正安全整数");
      assertBudget("chars", n + 64, "Thue–Morse 输出");
      assertBudget("steps", n + 1, "Thue–Morse 生成");
      const bits = new Uint8Array(n);
      const parts = [];
      const CHUNK = 8192;
      for (let base = 0; base < n; base += CHUNK) {
        const end = Math.min(n, base + CHUNK);
        let s = "";
        for (let i = base; i < end; i++) {
          if (i > 0) bits[i] = bits[i >> 1] ^ (i & 1);
          s += bits[i] ? "1" : "0";
        }
        parts.push(s);
      }
      return `前 ${n} 位 Thue–Morse：${parts.join("")}\n校验式：t(i) = popcount(i) mod 2`;
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
      assertBudget("chars", src.length, "a,p 输入");
      const m = src.match(/^(-?\d+)\s*[,，\s]\s*(\d+)$/);
      if (!m) throw new Error("格式：a,p（如 10,13）");
      const pDigits = m[2].replace(/^0+/, "").length || 1;
      const bits = Math.ceil(pDigits * 3.3219280948873626);
      assertBudget("bigSteps", 16 * bits ** 3, "Tonelli–Shanks 模运算");
      const aDigits = m[1].replace(/^[+-]/, "").replace(/^0+/, "").length || 1;
      assertBudget("bigSteps", aDigits * Math.max(1, Math.ceil(bits / 16)) + 1, "Tonelli a 约简");
      assertBudget("chars", Math.ceil(pDigits * 2.5) + aDigits + 64, "Tonelli–Shanks 输出");
      let a = BigInt(m[1]);
      const prime = BigInt(m[2]);
      if (prime < 2n) throw new Error("p 需为 ≥2 的整数");
      if (prime === 2n) return `x² ≡ ${a} (mod 2) 的根：${((a % 2n) + 2n) % 2n}`;
      if (!isPrime(prime)) throw new Error("p 必须是素数");
      a = ((a % prime) + prime) % prime;
      if (a === 0n) return `x² ≡ 0 (mod ${prime}) 的根：0（重根）`;
      if (modPowBig(a, (prime - 1n) / 2n, prime) !== 1n) return `x² ≡ ${a} (mod ${prime}) 无解（Legendre 符号 = −1）`;
      let q = prime - 1n, s = 0n;
      while (q % 2n === 0n) { q /= 2n; s++; }
      let z = 2n;
      while (modPowBig(z, (prime - 1n) / 2n, prime) !== prime - 1n) {
        z++;
        assertBudget("steps", Number(z), "Tonelli 非剩余搜索");
      }
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
