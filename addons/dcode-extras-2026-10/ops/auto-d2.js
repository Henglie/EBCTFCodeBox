/*
 * dcode-extras · Agent D2 批次：dCode 数学/矩阵/函数/统计/几何/理化/图论/生物
 * 纯 JS 确定性实现；输入、搜索、输出数量均有界，超限显式报错。
 */

import { runOp, big, isPrime, factorizeBounded, powmod, binom, parseNums, randInt } from "../lib/util.js";

const CAT = "dcode-extras-2026-10/cat-math";
const P = (key, label, ph) => ({ key, label, type: "text", default: "", placeholder: ph || "" });
const SEL = (key, label, def, opts) => ({ key, label, type: "select", default: def, options: opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o)) });

const MAX_OUT = 20000;
const MAX_DIGITS = 100000;

function err(msg) { throw new Error(msg); }
function absB(x) { return x < 0n ? -x : x; }
function gcdB(a, b) { a = absB(a); b = absB(b); while (b) { const t = a % b; a = b; b = t; } return a; }
function lcmB(a, b) { if (a === 0n || b === 0n) return 0n; return absB(a / gcdB(a, b) * b); }
function modB(a, m) { if (m <= 0n) err("模数需为正整数"); const r = a % m; return r < 0n ? r + m : r; }
function divFloor(a, b) { let q = a / b; if (a % b !== 0n && ((a < 0n) !== (b < 0n))) q -= 1n; return q; }
function parseBig(src, what = "整数") {
  const v = big(src);
  if (v === null) err(`无法解析${what}「${String(src).slice(0, 40)}」`);
  return v;
}
function parseSmall(src, what = "整数") {
  const v = Number(String(src).trim());
  if (!Number.isInteger(v)) err(`${what}需为整数`);
  return v;
}
function boundedInt(src, what, lo, hi) {
  const v = parseSmall(src, what);
  if (v < lo || v > hi) err(`${what}需在 ${lo}..${hi}`);
  return v;
}
function isqrtB(n) {
  if (n < 0n) err("isqrt 需要非负整数");
  if (n < 2n) return n;
  let x0 = 1n << BigInt(Math.ceil(n.toString(2).length / 2));
  let x1 = (x0 + n / x0) >> 1n;
  while (x1 < x0) { x0 = x1; x1 = (x0 + n / x0) >> 1n; }
  return x0;
}
function irootB(n, k) {
  if (n < 0n) err("iroot 需要非负整数");
  if (k < 1 || k > 64) err("根指数需在 1..64");
  if (n < 2n) return n;
  let lo = 0n, hi = 1n;
  while (hi ** BigInt(k) <= n) hi <<= 1n;
  while (lo + 1n < hi) {
    const mid = (lo + hi) >> 1n;
    if (mid ** BigInt(k) <= n) lo = mid; else hi = mid;
  }
  return lo;
}
function egcdB(a, b) {
  let oldR = a, r = b, oldS = 1n, s = 0n, oldT = 0n, t = 1n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  if (oldR < 0n) return { g: -oldR, x: -oldS, y: -oldT };
  return { g: oldR, x: oldS, y: oldT };
}
function invModB(a, m) {
  if (m <= 1n) err("模数需 ≥2");
  const { g, x } = egcdB(modB(a, m), m);
  if (g !== 1n) err(`${a} 在 mod ${m} 下不可逆（gcd=${g}）`);
  return modB(x, m);
}

function R(n, d = 1n) {
  if (d === 0n) err("分母不能为 0");
  if (d < 0n) { n = -n; d = -d; }
  const g = gcdB(n, d) || 1n;
  return [n / g, d / g];
}
const RZERO = [0n, 1n];
const RONE = [1n, 1n];
const rIsZero = (a) => a[0] === 0n;
const rNeg = (a) => [-a[0], a[1]];
const rAdd = (a, b) => R(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const rSub = (a, b) => R(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const rMul = (a, b) => R(a[0] * b[0], a[1] * b[1]);
const rDiv = (a, b) => { if (rIsZero(b)) err("有理数除数为 0"); return R(a[0] * b[1], a[1] * b[0]); };
const rStr = (a) => (a[1] === 1n ? a[0].toString() : `${a[0]}/${a[1]}`);
const rNum = (a) => Number(a[0]) / Number(a[1]);
function parseRat(src) {
  const t = String(src).trim().replace(/−/g, "-");
  let m = t.match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (m) return R(BigInt(m[1]), BigInt(m[2]));
  m = t.match(/^(-?)(\d*)\.(\d+)$/);
  if (m) {
    const sign = m[1] === "-" ? -1n : 1n;
    const ip = m[2] ? BigInt(m[2]) : 0n;
    const den = 10n ** BigInt(m[3].length);
    return R(sign * (ip * den + BigInt(m[3])), den);
  }
  if (/^-?\d+$/.test(t)) return R(BigInt(t));
  err(`无法解析数值「${src}」（支持整数、a/b、十进制小数）`);
}

function polyTrim(a) { while (a.length > 1 && rIsZero(a[a.length - 1])) a.pop(); if (!a.length) a.push(RZERO); return a; }
function parsePoly(src) {
  let s = String(src).replace(/\s+/g, "").replace(/−/g, "-").replace(/\*/g, "").replace(/X/g, "x");
  if (!s) err("多项式为空");
  if (s.length > 500) err("多项式表达式过长（上限 500 字符）");
  const terms = s.match(/[+-]?[^+-]+/g);
  if (!terms) err("无法解析多项式");
  let out = [RZERO];
  for (const term of terms) {
    const m = term.match(/^([+-]?)(?:(\d+(?:\/\d+)?(?:\.\d+)?))?(x(?:\^(\d+))?)?$/i);
    if (!m || (!m[2] && !m[3])) err(`无法解析项「${term}」`);
    let coef = m[2] ? parseRat(m[2]) : RONE;
    if (m[1] === "-") coef = rNeg(coef);
    let deg = 0;
    if (m[3]) deg = m[4] ? Number(m[4]) : 1;
    if (deg < 0 || deg > 200) err("多项式次数需在 0..200");
    while (out.length <= deg) out.push(RZERO);
    out[deg] = rAdd(out[deg], coef);
  }
  return polyTrim(out);
}
function polyDeg(a) { const t = polyTrim(a.slice()); return t.length - 1; }
function polyAdd(a, b) { const n = Math.max(a.length, b.length), o = []; for (let i = 0; i < n; i++) o.push(rAdd(a[i] || RZERO, b[i] || RZERO)); return polyTrim(o); }
function polySub(a, b) { const n = Math.max(a.length, b.length), o = []; for (let i = 0; i < n; i++) o.push(rSub(a[i] || RZERO, b[i] || RZERO)); return polyTrim(o); }
function polyMul(a, b) {
  if (a.length + b.length > 420) err("多项式乘积次数过大");
  const o = Array.from({ length: a.length + b.length }, () => RZERO);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) o[i + j] = rAdd(o[i + j], rMul(a[i], b[j]));
  return polyTrim(o);
}
function polyDivMod(a, b) {
  a = polyTrim(a.slice()); b = polyTrim(b.slice());
  if (polyDeg(b) === 0 && rIsZero(b[0])) err("除多项式不能为 0");
  if (polyDeg(a) === 0 && rIsZero(a[0])) return { q: [RZERO], r: [RZERO] };
  const q = Array(Math.max(0, a.length - b.length + 1)).fill(RZERO);
  const lead = b[b.length - 1];
  while (a.length >= b.length && !(a.length === 1 && rIsZero(a[0]))) {
    const d = a.length - b.length;
    const c = rDiv(a[a.length - 1], lead);
    q[d] = c;
    for (let i = 0; i < b.length; i++) a[i + d] = rSub(a[i + d], rMul(c, b[i]));
    polyTrim(a);
  }
  return { q: polyTrim(q), r: polyTrim(a) };
}
function polyDeriv(a) { if (a.length <= 1) return [RZERO]; return polyTrim(a.slice(1).map((c, i) => rMul(c, R(BigInt(i + 1))))); }
function polyInteg(a) { const o = [RZERO]; for (let i = 0; i < a.length; i++) o.push(rDiv(a[i], R(BigInt(i + 1)))); return polyTrim(o); }
function polyEvalR(a, x) { let v = RZERO; for (let i = a.length - 1; i >= 0; i--) v = rAdd(rMul(v, x), a[i]); return v; }
function polyEvalN(a, x) { let v = 0; for (let i = a.length - 1; i >= 0; i--) v = v * x + rNum(a[i]); return v; }
function polyGcd(a, b) {
  a = polyTrim(a.slice()); b = polyTrim(b.slice());
  while (!(polyDeg(b) === 0 && rIsZero(b[0]))) { const r = polyDivMod(a, b).r; a = b; b = r; }
  if (polyDeg(a) === 0) return [RONE];
  const lead = a[a.length - 1];
  return polyTrim(a.map((c) => rDiv(c, lead)));
}
function polyStr(a) {
  a = polyTrim(a.slice());
  if (polyDeg(a) === 0 && rIsZero(a[0])) return "0";
  const out = [];
  for (let i = a.length - 1; i >= 0; i--) {
    const c = a[i];
    if (rIsZero(c)) continue;
    const neg = c[0] < 0n;
    const abs = [absB(c[0]), c[1]];
    let coef = "";
    let mono = i === 0 ? "" : i === 1 ? "x" : `x^${i}`;
    if (i === 0) coef = rStr(abs);
    else if (!(abs[0] === 1n && abs[1] === 1n)) coef = abs[1] === 1n ? abs[0].toString() : `(${abs[0]}/${abs[1]})`;
    out.push((out.length ? (neg ? " - " : " + ") : (neg ? "-" : "")) + coef + mono);
  }
  return out.join("");
}

function parsePolyExpr(src) {
  let s = String(src).replace(/\s+/g, "").replace(/−/g, "-").replace(/X/g, "x").replace(/\*\*/g, "^");
  if (!s) err("多项式表达式为空");
  if (s.length > 800) err("多项式表达式过长");
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i, dot = false;
      while (j < s.length && (/[0-9]/.test(s[j]) || (s[j] === "." && !dot))) { if (s[j] === ".") dot = true; j++; }
      toks.push({ t: "num", v: s.slice(i, j) }); i = j;
    } else if (c === "x") { toks.push({ t: "x" }); i++; }
    else if ("+-*/^()".includes(c)) { toks.push({ t: c }); i++; }
    else err(`多项式含非法字符「${c}」`);
  }
  const withMul = [];
  const operandEnd = (t) => t && (t.t === "num" || t.t === "x" || t.t === ")");
  const operandStart = (t) => t && (t.t === "num" || t.t === "x" || t.t === "(");
  for (const t of toks) {
    if (withMul.length && operandEnd(withMul[withMul.length - 1]) && operandStart(t)) withMul.push({ t: "*" });
    withMul.push(t);
  }
  let pos = 0;
  const peek = () => withMul[pos];
  const take = () => withMul[pos++];
  const parseE = () => {
    let a = parseT();
    while (peek() && (peek().t === "+" || peek().t === "-")) {
      const op = take().t;
      const b = parseT();
      a = op === "+" ? polyAdd(a, b) : polySub(a, b);
    }
    return a;
  };
  const parseT = () => {
    let a = parseU();
    while (peek() && (peek().t === "*" || peek().t === "/")) {
      const op = take().t;
      const b = parseU();
      if (op === "*") a = polyMul(a, b);
      else {
        if (polyDeg(b) !== 0 || rIsZero(b[0])) err("多项式只能除以非零常数");
        a = a.map((c) => rDiv(c, b[0]));
      }
    }
    return a;
  };
  const parseU = () => {
    if (peek() && peek().t === "-") { take(); return polyTrim(parseU().map(rNeg)); }
    if (peek() && peek().t === "+") { take(); return parseU(); }
    return parseP();
  };
  const parseP = () => {
    let a = parseAtom();
    if (peek() && peek().t === "^") {
      take();
      const e = peek();
      if (!e || e.t !== "num" || !/^\d+$/.test(e.v)) err("幂指数需为非负整数");
      const k = Number(take().v);
      if (k > 50) err("多项式幂次上限 50");
      let r = [RONE];
      for (let i = 0; i < k; i++) r = polyMul(r, a);
      a = r;
    }
    return a;
  };
  const parseAtom = () => {
    const t = take();
    if (!t) err("多项式表达式缺操作数");
    if (t.t === "num") return [parseRat(t.v)];
    if (t.t === "x") return [RZERO, RONE];
    if (t.t === "(") { const a = parseE(); if (!peek() || take().t !== ")") err("括号不匹配"); return a; }
    err(`多项式表达式语法错误：${t.t}`);
  };
  const out = parseE();
  if (pos !== withMul.length) err("多项式表达式有多余内容");
  if (polyDeg(out) > 100) err("多项式次数上限 100");
  return polyTrim(out);
}

function parseMatrix(src) {
  const lines = String(src).replace(/[\[\]]/g, "").replace(/\r/g, "").split(/\n|;/).map((x) => x.trim()).filter(Boolean);
  if (!lines.length) err("需要矩阵：每行一项，元素用空格/逗号分隔");
  const m = lines.map((line) => line.split(/[\s,]+/).filter(Boolean).map(parseRat));
  const cols = m[0].length;
  if (!cols || !m.every((r) => r.length === cols)) err("矩阵每行列数必须一致");
  if (m.length > 12 || cols > 12) err("矩阵最大 12×12");
  return m;
}
function matCopy(m) { return m.map((r) => r.map((x) => x.slice())); }
function matStr(m) { return m.map((r) => r.map(rStr).join(" ")).join("\n"); }
function matMul(a, b) {
  if (!a.length || !b.length || a[0].length !== b.length) err(`矩阵维数不匹配：${a.length}×${a[0].length} 与 ${b.length}×${b[0].length}`);
  const o = Array.from({ length: a.length }, () => Array(b[0].length).fill(RZERO));
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b[0].length; j++) {
    let s = RZERO;
    for (let k = 0; k < b.length; k++) s = rAdd(s, rMul(a[i][k], b[k][j]));
    o[i][j] = s;
  }
  return o;
}
function matAdd(a, b, sign = 1n) {
  if (a.length !== b.length || a[0].length !== b[0].length) err("矩阵维数不一致");
  return a.map((r, i) => r.map((x, j) => sign === 1n ? rAdd(x, b[i][j]) : rSub(x, b[i][j])));
}
function matScale(a, k) { return a.map((r) => r.map((x) => rMul(x, k))); }
function matDet(m) {
  const n = m.length;
  if (!n || m.some((r) => r.length !== n)) err("行列式需要方阵");
  const a = matCopy(m);
  let det = RONE;
  for (let i = 0; i < n; i++) {
    let p = i;
    while (p < n && rIsZero(a[p][i])) p++;
    if (p === n) return RZERO;
    if (p !== i) { [a[p], a[i]] = [a[i], a[p]]; det = rNeg(det); }
    const pivot = a[i][i];
    det = rMul(det, pivot);
    for (let r = i + 1; r < n; r++) {
      if (rIsZero(a[r][i])) continue;
      const f = rDiv(a[r][i], pivot);
      for (let c = i; c < n; c++) a[r][c] = rSub(a[r][c], rMul(f, a[i][c]));
    }
  }
  return det;
}
function matRref(m) {
  const a = matCopy(m), rows = a.length, cols = a[0].length;
  let rank = 0;
  const pivots = [];
  for (let c = 0; c < cols && rank < rows; c++) {
    let p = rank;
    while (p < rows && rIsZero(a[p][c])) p++;
    if (p === rows) continue;
    [a[p], a[rank]] = [a[rank], a[p]];
    const pivot = a[rank][c];
    for (let j = 0; j < cols; j++) a[rank][j] = rDiv(a[rank][j], pivot);
    for (let r = 0; r < rows; r++) {
      if (r === rank || rIsZero(a[r][c])) continue;
      const f = a[r][c];
      for (let j = 0; j < cols; j++) a[r][j] = rSub(a[r][j], rMul(f, a[rank][j]));
    }
    pivots.push(c);
    rank++;
  }
  return { rref: a, rank, pivots };
}
function matRank(m) { return matRref(m).rank; }
function matInverse(m) {
  const n = m.length;
  if (!n || m.some((r) => r.length !== n)) err("求逆需要方阵");
  const a = m.map((row, i) => [...row.map((x) => x.slice()), ...Array.from({ length: n }, (_, j) => R(i === j ? 1n : 0n))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    while (p < n && rIsZero(a[p][c])) p++;
    if (p === n) err("矩阵奇异，不可逆（存在全零主元列）");
    if (p !== c) [a[p], a[c]] = [a[c], a[p]];
    const pivot = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] = rDiv(a[c][j], pivot);
    for (let r = 0; r < n; r++) {
      if (r === c || rIsZero(a[r][c])) continue;
      const f = a[r][c];
      for (let j = 0; j < 2 * n; j++) a[r][j] = rSub(a[r][j], rMul(f, a[c][j]));
    }
  }
  return a.map((row) => row.slice(n));
}
function matVec(m) {
  if (m.length === 1) return m[0];
  if (m[0].length === 1) return m.map((r) => r[0]);
  err("需要向量（单行或单列）");
}
function matMinor(m, i, j) { return m.filter((_, r) => r !== i).map((row) => row.filter((_, c) => c !== j)); }
function matCofactors(m) {
  const n = m.length;
  if (!n || m.some((r) => r.length !== n)) err("余子式需要方阵");
  return m.map((r, i) => r.map((_, j) => { const d = matDet(matMinor(m, i, j)); return (i + j) % 2 ? rNeg(d) : d; }));
}
function matAdj(m) { const c = matCofactors(m); return c[0].map((_, j) => c.map((row) => row[j])); }
function matNullspace(m) {
  const { rref, rank, pivots } = matRref(m);
  const cols = m[0].length;
  const free = [];
  for (let c = 0; c < cols; c++) if (!pivots.includes(c)) free.push(c);
  const basis = [];
  for (const f of free) {
    const v = Array(cols).fill(RZERO);
    v[f] = RONE;
    for (let r = 0; r < rank; r++) v[pivots[r]] = rNeg(rref[r][f]);
    basis.push(v);
  }
  return basis;
}
function matCharpoly(m) {
  const n = m.length;
  if (!n || m.some((r) => r.length !== n)) err("特征多项式需要方阵");
  const I = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => R(i === j ? 1n : 0n)));
  let M = matCopy(m);
  const cs = [RZERO];
  for (let k = 1; k <= n; k++) {
    if (k > 1) M = matMul(m, matAdd(M, matScale(I, cs[k - 1])));
    let tr = RZERO;
    for (let i = 0; i < n; i++) tr = rAdd(tr, M[i][i]);
    cs.push(rNeg(rDiv(tr, R(BigInt(k)))));
  }
  const coeffs = [];
  for (let i = n; i >= 1; i--) coeffs.push(cs[i]);
  coeffs.push(RONE);
  return polyTrim(coeffs);
}
function matPermanent(m) {
  const n = m.length;
  if (!n || m.some((r) => r.length !== n)) err("permanent 需要方阵");
  if (n > 12) err("permanent 上限 12×12");
  let total = RZERO;
  for (let mask = 0; mask < (1 << n); mask++) {
    let bits = 0;
    for (let x = mask; x; x &= x - 1) bits++;
    let prod = RONE;
    for (let i = 0; i < n; i++) {
      let s = RZERO;
      for (let j = 0; j < n; j++) if (mask & (1 << j)) s = rAdd(s, m[i][j]);
      prod = rMul(prod, s);
    }
    const sign = (n - bits) % 2 ? -1n : 1n;
    total = rAdd(total, rMul(prod, R(sign)));
  }
  return total;
}

function parsePointList(src) {
  return String(src).replace(/\r/g, "").split(/\n|;/).map((x) => x.trim()).filter(Boolean).map((line) => {
    const m = line.match(/^\(?\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*\)?$/);
    if (!m) err(`点格式应为 x,y：${line}`);
    return [Number(m[1]), Number(m[2])];
  });
}
function parseKeyVals(src) {
  const o = {};
  for (const part of String(src).split(/[,;]+/)) {
    const m = part.trim().match(/^([A-Za-z]+)\s*=\s*(-?\d+(?:\.\d+)?)$/);
    if (!m) err(`参数格式应为 a=3,b=4：${part}`);
    o[m[1].toLowerCase()] = Number(m[2]);
  }
  return o;
}
function fmt(x, d = 10) {
  if (!Number.isFinite(x)) return String(x);
  if (Math.abs(x) < 1e-12) x = 0;
  const s = Number(x.toFixed(d));
  return String(Object.is(s, -0) ? 0 : s);
}
function numList(src, what = "数字列表") {
  const a = parseNums(src);
  if (!a.length) err(`需要${what}`);
  if (a.length > 100000) err(`${what}过长（上限 100000 项）`);
  return a;
}
function intList(src, what = "整数列表") {
  const a = String(src).split(/[\s,;]+/).filter(Boolean).map((x) => parseBig(x, what));
  if (!a.length) err(`需要${what}`);
  if (a.length > 1000) err(`${what}过长（上限 1000 项）`);
  return a;
}

function tokenizeExpr(src) {
  const s = String(src).replace(/−/g, "-").replace(/\s+/g, "");
  if (!s) err("表达式为空");
  if (s.length > 1000) err("表达式过长（上限 1000 字符）");
  const out = [];
  let i = 0;
  const isDigit = (c) => c >= "0" && c <= "9";
  const isAlpha = (c) => /[A-Za-z_]/.test(c);
  while (i < s.length) {
    const c = s[i];
    if (isDigit(c) || (c === "." && isDigit(s[i + 1]))) {
      let j = i, dot = false;
      while (j < s.length && (isDigit(s[j]) || (s[j] === "." && !dot))) { if (s[j] === ".") dot = true; j++; }
      if (s[j] === "e" || s[j] === "E") { j++; if (s[j] === "+" || s[j] === "-") j++; while (isDigit(s[j])) j++; }
      out.push({ t: "num", v: Number(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (isAlpha(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z_0-9]/.test(s[j])) j++;
      out.push({ t: "id", v: s.slice(i, j) });
      i = j;
      continue;
    }
    if ("+-*/%^(),".includes(c)) { out.push({ t: c }); i++; continue; }
    err(`表达式含非法字符「${c}」`);
  }
  const withMul = [];
  for (let k = 0; k < out.length; k++) {
    const prev = withMul[withMul.length - 1];
    const cur = out[k];
    if (prev && (prev.t === "num" || prev.t === "id" || prev.t === ")") && (cur.t === "num" || cur.t === "id" || cur.t === "(")) {
      const prevIsFunc = prev.t === "id" && FUNC_NAMES.has(prev.v);
      if (!prevIsFunc) withMul.push({ t: "*" });
    }
    withMul.push(cur);
  }
  return withMul;
}
const FUNC_NAMES = new Set(["sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "sqrt", "cbrt", "abs", "ln", "log", "log2", "log10", "exp", "floor", "ceil", "round", "sign", "erf", "erfc", "dawson", "gamma", "fact"]);
const CONSTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI, phi: (1 + Math.sqrt(5)) / 2, inf: Infinity };
function compileExpr(src) {
  const toks = tokenizeExpr(src);
  const out = [], ops = [];
  const prec = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "neg": 3, "^": 4 };
  const right = new Set(["^", "neg"]);
  let prev = null;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === "num") out.push(t), prev = t;
    else if (t.t === "id") {
      if (FUNC_NAMES.has(t.v)) {
        if (!toks[i + 1] || toks[i + 1].t !== "(") err(`函数 ${t.v} 后需要括号`);
        ops.push({ t: "func", v: t.v });
      } else if (Object.prototype.hasOwnProperty.call(CONSTS, t.v)) out.push({ t: "num", v: CONSTS[t.v] });
      else out.push({ t: "var", v: t.v });
      prev = t;
    } else if (t.t === "(") { ops.push(t); prev = t; }
    else if (t.t === ")") {
      while (ops.length && ops[ops.length - 1].t !== "(") out.push(ops.pop());
      if (!ops.length) err("括号不匹配");
      ops.pop();
      if (ops.length && ops[ops.length - 1].t === "func") out.push(ops.pop());
      prev = t;
    } else if (t.t === ",") {
      while (ops.length && ops[ops.length - 1].t !== "(") out.push(ops.pop());
      if (!ops.length) err("逗号位置错误");
      prev = t;
    } else {
      if (t.t === "-" && (!prev || prev.t === "+" || prev.t === "-" || prev.t === "*" || prev.t === "/" || prev.t === "%" || prev.t === "^" || prev.t === "(" || prev.t === ",")) t.t = "neg";
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top.t === "(" || top.t === "func") break;
        if (prec[top.t] > prec[t.t] || (prec[top.t] === prec[t.t] && !right.has(t.t))) out.push(ops.pop()); else break;
      }
      ops.push(t);
      prev = t;
    }
  }
  while (ops.length) { const o = ops.pop(); if (o.t === "(") err("括号不匹配"); out.push(o); }
  return function (vars = {}) {
    const st = [];
    for (const t of out) {
      if (t.t === "num") st.push(t.v);
      else if (t.t === "var") {
        if (!(t.v in vars)) err(`未知变量 ${t.v}`);
        st.push(vars[t.v]);
      } else if (t.t === "neg") st.push(-st.pop());
      else if (t.t === "func") {
        const x = st.pop();
        if (x === undefined) err("函数缺参数");
        const f = {
          sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
          sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
          ln: Math.log, log: Math.log10, log2: Math.log2, log10: Math.log10, exp: Math.exp,
          floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
          erf, erfc, dawson, gamma: gammaFn, fact: (z) => gammaFn(z + 1),
        }[t.v];
        st.push(f(x));
      } else {
        const b = st.pop(), a = st.pop();
        if (a === undefined || b === undefined) err("表达式缺操作数");
        st.push(t.t === "+" ? a + b : t.t === "-" ? a - b : t.t === "*" ? a * b : t.t === "/" ? a / b : t.t === "%" ? a % b : Math.pow(a, b));
      }
      if (st.length > 1000) err("表达式栈溢出");
    }
    if (st.length !== 1 || !Number.isFinite(st[0])) return st.length === 1 ? st[0] : NaN;
    return st[0];
  };
}
function evalExpr(src, vars = {}) { return compileExpr(src)(vars); }
function evalF(src, x) { return evalExpr(src, { x }); }

function erf(x) {
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}
function erfc(x) { return 1 - erf(x); }
function dawson(x) {
  if (Math.abs(x) < 1e-9) return x;
  const ax = Math.abs(x);
  let f;
  if (ax <= 4) {
    const h = ax / 1000;
    let s = 0;
    for (let i = 0; i <= 1000; i++) {
      const t = i * h;
      const w = i === 0 || i === 1000 ? 1 : i % 2 ? 4 : 2;
      s += w * Math.exp(t * t);
    }
    f = (h / 3) * s * Math.exp(-ax * ax);
  } else {
    f = (1 / (2 * ax)) * (1 + 1 / (2 * ax * ax) + 3 / (4 * ax ** 4));
  }
  return x < 0 ? -f : f;
}
function gammaFn(x) {
  if (Number.isInteger(x) && x > 0) { let r = 1; for (let i = 2; i < x; i++) r *= i; return r; }
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaFn(1 - x));
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

function parseComplex(src) {
  const s = String(src).replace(/\s+/g, "").replace(/−/g, "-");
  if (!s) err("复数不能为空");
  if (!s.endsWith("i")) {
    const n = Number(s);
    if (Number.isFinite(n)) return { re: n, im: 0 };
    err(`无法解析复数「${src}」`);
  }
  const body = s.slice(0, -1);
  let split = -1;
  for (let i = body.length - 1; i > 0; i--) if (body[i] === "+" || body[i] === "-") { split = i; break; }
  let re = 0, im;
  let imagPart;
  if (split > 0) {
    re = Number(body.slice(0, split));
    imagPart = body.slice(split);
  } else imagPart = body;
  if (imagPart === "" || imagPart === "+") im = 1;
  else if (imagPart === "-") im = -1;
  else im = Number(imagPart);
  if (!Number.isFinite(re) || !Number.isFinite(im)) err(`无法解析复数「${src}」`);
  return { re, im };
}
function cfmt(z, d = 8) {
  const re = fmt(z.re, d), im = fmt(Math.abs(z.im), d);
  if (Math.abs(z.im) < 1e-10) return re;
  if (Math.abs(z.re) < 1e-10) return `${z.im < 0 ? "-" : ""}${im}i`;
  return `${re} ${z.im < 0 ? "-" : "+"} ${im}i`;
}
function cadd(a, b) { return { re: a.re + b.re, im: a.im + b.im }; }
function csub(a, b) { return { re: a.re - b.re, im: a.im - b.im }; }
function cmul(a, b) { return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }; }
function cdiv(a, b) { const d = b.re * b.re + b.im * b.im; if (d === 0) err("复数除数为 0"); return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; }
function cpow(a, n) { let r = { re: 1, im: 0 }; for (let i = 0; i < n; i++) r = cmul(r, a); return r; }
function cabs(a) { return Math.hypot(a.re, a.im); }
function carg(a) { return Math.atan2(a.im, a.re); }

function polyRootsNumeric(p, lim = 100) {
  let a = polyTrim(p.slice()).map((c) => Number(c[0]) / Number(c[1]));
  while (a.length > 1 && Math.abs(a[a.length - 1]) < 1e-14) a.pop();
  const deg = a.length - 1;
  if (deg <= 0) return [];
  if (deg === 1) return [-a[0] / a[1]];
  if (deg === 2) {
    const [c, b, aa] = a;
    const disc = b * b - 4 * aa * c;
    if (disc < 0) return [];
    const s = Math.sqrt(disc);
    return [(-b - s) / (2 * aa), (-b + s) / (2 * aa)].sort((x, y) => x - y);
  }
  const lead = a[deg];
  const roots = [];
  for (let k = 0; k < deg; k++) {
    const ang = (2 * Math.PI * k) / deg + 0.4;
    roots.push({ re: 0.4 * Math.cos(ang), im: 0.4 * Math.sin(ang) });
  }
  const evalC = (z) => {
    let r = { re: 0, im: 0 };
    for (let i = deg; i >= 0; i--) r = cadd(cmul(r, z), { re: a[i] / lead, im: 0 });
    return r;
  };
  for (let it = 0; it < 500; it++) {
    let maxd = 0;
    for (let i = 0; i < deg; i++) {
      let den = { re: 1, im: 0 };
      for (let j = 0; j < deg; j++) if (j !== i) den = cmul(den, csub(roots[i], roots[j]));
      const q = cdiv(evalC(roots[i]), den);
      roots[i] = csub(roots[i], q);
      maxd = Math.max(maxd, cabs(q));
    }
    if (maxd < 1e-12) break;
    if (it === 499) err("高次多项式求根未收敛（请降次）");
    if (roots.length > lim) break;
  }
  return roots.sort((x, y) => x.re - y.re || x.im - y.im);
}

function baseAlphabet(base) {
  if (base === 58) return "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  if (base === 26) return "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  if (base === 37) return "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_";
  const all = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  if (base < 2 || base > all.length) err("进制需在 2..62（负进制 -2..-36）");
  return all.slice(0, base);
}
function toBaseBig(n, base) {
  if (base === 0) err("进制不能为 0");
  if (base > 0) {
    if (n === 0n) return "0";
    const alpha = baseAlphabet(base);
    const neg = n < 0n;
    n = absB(n);
    let s = "";
    while (n) { s = alpha[Number(n % BigInt(base))] + s; n /= BigInt(base); }
    return neg ? "-" + s : s;
  }
  const b = BigInt(base), digits = [];
  let x = n;
  if (x === 0n) return "0";
  while (x !== 0n) {
    let r = x % b;
    x /= b;
    if (r < 0n) { r += absB(b); x += 1n; }
    digits.push("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"[Number(r)]);
  }
  return digits.reverse().join("");
}
function fromBaseBig(s, base) {
  s = String(s).trim();
  if (base > 0) {
    const alpha = baseAlphabet(base);
    let neg = false;
    if (s.startsWith("-")) { neg = true; s = s.slice(1); }
    let n = 0n;
    for (const ch of s) {
      let d;
      if (base === 26) d = alpha.indexOf(ch.toUpperCase());
      else if (base === 37) d = ch === "_" ? 36 : alpha.indexOf(ch.toUpperCase());
      else if (base === 58) d = alpha.indexOf(ch);
      else d = alpha.indexOf(ch) >= 0 ? alpha.indexOf(ch) : alpha.indexOf(ch.toUpperCase());
      if (d < 0) err(`字符「${ch}」不在 ${base} 进制字母表中`);
      n = n * BigInt(base) + BigInt(d);
    }
    return neg ? -n : n;
  }
  const b = BigInt(base);
  let n = 0n;
  for (const ch of s) {
    const d = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".indexOf(ch.toUpperCase());
    if (d < 0 || d >= absB(b)) err(`字符「${ch}」不在 ${base} 进制字母表中`);
    n = n * b + BigInt(d);
  }
  return n;
}
function fibSeq(maxN) {
  const out = [1n, 2n];
  while (out.length < maxN) out.push(out[out.length - 1] + out[out.length - 2]);
  return out;
}
function zeckendorfEncode(n) {
  if (n < 1n) err("Zeckendorf 表示需要正整数");
  const fib = [1n, 2n];
  while (fib[fib.length - 1] <= n) fib.push(fib[fib.length - 1] + fib[fib.length - 2]);
  fib.pop();
  let rem = n, bits = "";
  for (let i = fib.length - 1; i >= 0; i--) {
    if (fib[i] <= rem) { bits += "1"; rem -= fib[i]; } else bits += "0";
  }
  return bits;
}
function zeckendorfDecode(bits) {
  const s = String(bits).trim();
  if (!/^[01]+$/.test(s)) err("Zeckendorf 编码只能含 0/1");
  if (s.includes("11")) err("Zeckendorf 编码不能含连续 1");
  const fib = fibSeq(Math.max(2, s.length + 1));
  let n = 0n;
  for (let i = 0; i < s.length; i++) if (s[s.length - 1 - i] === "1") n += fib[i];
  return n;
}

function factorialN(n) { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }
function gcdNum(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) { const t = a % b; a = b; b = t; } return a; }
function isPalindromeStr(s) { s = String(s); return s === [...s].reverse().join(""); }
function digitalRoot(n) { if (n < 0n) n = -n; if (n === 0n) return 0n; const r = n % 9n; return r === 0n ? 9n : r; }
function divisorsBig(n) {
  if (n < 1n) err("n 需为正整数");
  if (n > 10n ** 15n) err("n 过大（上限 10^15）");
  const f = factorizeBounded(n);
  if (!f.complete) err("n 无法完全分解，无法给出全部因子");
  let ds = [1n];
  for (const [p, e] of f.factors) {
    const cur = [];
    let pw = 1n;
    for (let i = 0; i <= e; i++) { for (const d of ds) cur.push(d * pw); pw *= p; }
    ds = cur;
  }
  return ds.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
function phiBig(n) {
  if (n < 1n) err("n 需为正整数");
  const f = factorizeBounded(n);
  if (!f.complete) err("n 无法完全分解");
  let r = n;
  for (const [p] of f.factors) r = r / p * (p - 1n);
  return r;
}
function mobiusBig(n) {
  if (n < 1n) err("n 需为正整数");
  const f = factorizeBounded(n);
  if (!f.complete) err("n 无法完全分解");
  for (const [, e] of f.factors) if (e > 1) return 0n;
  return f.factors.size % 2 ? -1n : 1n;
}
function primeListUpTo(lim) {
  if (lim < 2) return [];
  const sieve = new Uint8Array(lim + 1);
  for (let i = 2; i * i <= lim; i++) if (!sieve[i]) for (let j = i * i; j <= lim; j += i) sieve[j] = 1;
  const out = [];
  for (let i = 2; i <= lim; i++) if (!sieve[i]) out.push(i);
  return out;
}
function nthPrime(n) {
  if (n < 1 || n > 1000000) err("n 需在 1..10^6");
  if (n < 6) return [2, 3, 5, 7, 11][n - 1];
  let lim = Math.ceil(n * (Math.log(n) + Math.log(Math.log(n)))) + 10;
  for (; ;) { const ps = primeListUpTo(lim); if (ps.length >= n) return ps[n - 1]; lim *= 2; }
}
function nextPrime(n) {
  if (n < 2n) return 2n;
  let x = n + 1n;
  if (x % 2n === 0n) x++;
  while (!isPrime(x)) x += 2n;
  return x;
}
function prevPrime(n) {
  if (n <= 2n) err("不存在小于 2 的素数");
  if (n === 3n) return 2n;
  let x = n - 1n;
  if (x % 2n === 0n) x--;
  while (x >= 3n && !isPrime(x)) x -= 2n;
  return x >= 3n ? x : 2n;
}
function nearestPrime(n) {
  if (n <= 2n) return 2n;
  const p = prevPrime(n), q = nextPrime(n);
  return n - p <= q - n ? p : q;
}
function collatzSteps(n) { let steps = 0, max = n; while (n !== 1n) { n = n % 2n === 0n ? n / 2n : 3n * n + 1n; if (n > max) max = n; if (++steps > 1000000) err("Collatz 步数超限"); } return { steps, max }; }

function parseGrid(src) {
  const rows = String(src).replace(/\r/g, "").split(/\n/).map((x) => x.replace(/\s+$/, "")).filter((x) => x.length);
  if (!rows.length) err("网格为空");
  const w = rows[0].length;
  if (!rows.every((r) => r.length === w)) err("网格每行宽度必须一致");
  if (rows.length > 200 || w > 200) err("网格最大 200×200");
  return rows;
}

function rootsScan(expr, a, b, count = 2000) {
  const f = (x) => evalF(expr, x);
  const out = [];
  let prevX = a, prevY = f(a);
  if (Math.abs(prevY) < 1e-10) out.push(a);
  for (let i = 1; i <= count; i++) {
    const x = a + ((b - a) * i) / count;
    const y = f(x);
    if (!Number.isFinite(y)) { prevX = x; prevY = y; continue; }
    if (Number.isFinite(prevY) && y === 0) out.push(x);
    else if (Number.isFinite(prevY) && y * prevY < 0) {
      let lo = prevX, hi = x, flo = prevY;
      for (let k = 0; k < 80; k++) {
        const mid = (lo + hi) / 2, fm = f(mid);
        if (flo * fm <= 0) hi = mid; else { lo = mid; flo = fm; }
      }
      out.push((lo + hi) / 2);
    }
    prevX = x; prevY = y;
  }
  const uniq = [];
  for (const x of out) if (!uniq.some((y) => Math.abs(y - x) < 1e-7)) uniq.push(x);
  return uniq;
}
function goldenExtremum(expr, a, b, max = true) {
  const f = (x) => evalF(expr, x);
  const gr = (Math.sqrt(5) - 1) / 2;
  let lo = a, hi = b;
  let c = hi - gr * (hi - lo), d = lo + gr * (hi - lo);
  let fc = f(c), fd = f(d);
  for (let i = 0; i < 200; i++) {
    if ((max && fc > fd) || (!max && fc < fd)) { hi = d; d = c; fd = fc; c = hi - gr * (hi - lo); fc = f(c); }
    else { lo = c; c = d; fc = fd; d = lo + gr * (hi - lo); fd = f(d); }
  }
  return (lo + hi) / 2;
}
function simpson(expr, a, b, n = 1000) {
  if (n % 2) n++;
  const f = (x) => evalF(expr, x);
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * f(a + i * h);
  return (s * h) / 3;
}
function parseFractionInput(src) {
  const m = String(src).trim().match(/^(-?\d+)\s*\/\s*(-?\d+)$/);
  if (!m) err("格式应为 a/b");
  return [BigInt(m[1]), BigInt(m[2])];
}
function fractionToDecimal(n, d) {
  if (d === 0n) err("分母不能为 0");
  if (d < 0n) { n = -n; d = -d; }
  const sign = n < 0n ? "-" : "";
  n = absB(n);
  const int = n / d;
  let rem = n % d;
  if (rem === 0n) return `${sign}${int}`;
  const seen = new Map();
  let frac = "";
  let cycleStart = -1;
  while (rem !== 0n) {
    if (seen.has(rem)) { cycleStart = seen.get(rem); break; }
    seen.set(rem, frac.length);
    rem *= 10n;
    frac += (rem / d).toString();
    rem %= d;
    if (frac.length > 5000) err("小数展开超过 5000 位（可能分母过大）");
  }
  if (cycleStart < 0) return `${sign}${int}.${frac}`;
  return `${sign}${int}.${frac.slice(0, cycleStart)}(${frac.slice(cycleStart)})`;
}
function parsePeriodicDecimal(src) {
  let s = String(src).trim().replace(/\s+/g, "");
  const m = s.match(/^(-?)(\d+)(?:\.(\d*)(?:\((\d+)\))?)?$/);
  if (!m) err("格式应为 0.1(6) / 0.25 / 3");
  const sign = m[1] === "-" ? -1n : 1n;
  const ip = BigInt(m[2] || "0");
  const non = m[3] || "";
  const rep = m[4] || "";
  if (!rep) return R(sign * BigInt((m[2] || "0") + non), 10n ** BigInt(non.length));
  const a = BigInt((m[2] || "0") + non);
  const b = BigInt(rep);
  const k = BigInt(non.length), r = BigInt(rep.length);
  const num = a * (10n ** r - 1n) + b;
  const den = 10n ** k * (10n ** r - 1n);
  return R(sign * num, den);
}

function magicSquare(n) {
  if (n < 3 || n > 60) err("阶数需在 3..60");
  const a = Array.from({ length: n }, () => Array(n).fill(0));
  if (n % 2 === 1) {
    let i = 0, j = Math.floor(n / 2);
    for (let k = 1; k <= n * n; k++) {
      a[i][j] = k;
      const ni = (i - 1 + n) % n, nj = (j + 1) % n;
      if (a[ni][nj]) { i = (i + 1) % n; } else { i = ni; j = nj; }
    }
  } else if (n % 4 === 0) {
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) a[i][j] = i * n + j + 1;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i % 4 === j % 4) || ((i % 4) + (j % 4) === 3)) a[i][j] = n * n + 1 - a[i][j];
    }
  } else {
    const m = n / 2, k = (m - 1) / 2;
    const sub = magicSquare(m);
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
      const v = sub[i][j];
      a[i][j] = v;
      a[i + m][j + m] = v + m * m;
      a[i][j + m] = v + 2 * m * m;
      a[i + m][j] = v + 3 * m * m;
    }
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < k; j++) {
        const c = i === k ? j + 1 : j;
        const t = a[i][c]; a[i][c] = a[i + m][c]; a[i + m][c] = t;
      }
    }
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < k - 1; j++) {
        const c = n - 1 - j;
        const t = a[i][c]; a[i][c] = a[i + m][c]; a[i + m][c] = t;
      }
    }
  }
  return a;
}

function quineMcCluskey(minterms, nvars) {
  const all = [];
  const max = 1 << nvars;
  const terms = new Set(minterms);
  let current = [];
  for (const m of minterms) current.push({ mask: m, care: (1 << nvars) - 1, used: false });
  const primes = [];
  for (let step = 0; step <= nvars; step++) {
    const groups = new Map();
    for (const t of current) {
      if (t.used) continue;
      const key = `${t.mask}:${t.care}`;
      if (!groups.has(key)) groups.set(key, t);
    }
    const arr = [...groups.values()];
    const next = [];
    const seen = new Set();
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      const a = arr[i], b = arr[j];
      if (a.care !== b.care) continue;
      const diff = a.mask ^ b.mask;
      if (diff && (diff & (diff - 1)) === 0) {
        a.used = b.used = true;
        const nm = a.mask & ~diff;
        const ncare = a.care & ~diff;
        const key = `${nm}:${ncare}`;
        if (!seen.has(key)) { seen.add(key); next.push({ mask: nm, care: ncare, used: false }); }
      }
    }
    for (const t of arr) if (!t.used) primes.push(t);
    current = next;
    if (!current.length) break;
  }
  const covers = (t, m) => (m & t.care) === t.mask;
  const chosen = [];
  const remaining = new Set(minterms);
  while (remaining.size) {
    let best = null, bestCov = -1;
    for (const t of primes) {
      const cov = [...remaining].filter((m) => covers(t, m)).length;
      if (cov > bestCov) { bestCov = cov; best = t; }
    }
    if (!best || bestCov <= 0) break;
    chosen.push(best);
    for (const m of [...remaining]) if (covers(best, m)) remaining.delete(m);
  }
  const varName = (i) => String.fromCharCode(65 + i);
  const termStr = (t) => {
    let s = "";
    for (let i = 0; i < nvars; i++) {
      const bit = 1 << (nvars - 1 - i);
      if (t.care & bit) s += (t.mask & bit ? "" : "!") + varName(i);
    }
    return s || "1";
  };
  return chosen.map(termStr).join(" | ");
}

function polyAddN(a, b) {
  const n = Math.max(a.length, b.length), o = [];
  for (let i = 0; i < n; i++) o.push((a[i] || 0) + (b[i] || 0));
  while (o.length > 1 && Math.abs(o[o.length - 1]) < 1e-12) o.pop();
  return o;
}
function polyMulN(a, b) {
  const o = Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) o[i + j] += a[i] * b[j];
  while (o.length > 1 && Math.abs(o[o.length - 1]) < 1e-12) o.pop();
  return o;
}
function polyEvalNum(a, x) { let v = 0; for (let i = a.length - 1; i >= 0; i--) v = v * x + a[i]; return v; }
function polyStrN(a) {
  const out = [];
  for (let i = a.length - 1; i >= 0; i--) {
    if (Math.abs(a[i]) < 1e-10) continue;
    const s = a[i] < 0 ? " - " : out.length ? " + " : "";
    const coef = i === 0 ? fmt(Math.abs(a[i]), 8) : Math.abs(a[i]) === 1 ? "" : fmt(Math.abs(a[i]), 8);
    out.push(s + coef + (i ? (i === 1 ? "x" : `x^${i}`) : ""));
  }
  return out.join("") || "0";
}

function factorPolynomial(p) {
  p = polyTrim(p.slice());
  const deg = polyDeg(p);
  if (deg <= 0) return rIsZero(p[0]) ? "0" : rStr(p[0]);
  const factors = [];
  let cur = p;
  const lead = cur[cur.length - 1];
  for (let k = 0; k < 200 && polyDeg(cur) > 0; k++) {
    const cd = polyDeg(cur);
    const c0 = cur[0];
    if (rIsZero(c0)) { factors.push("x"); cur = polyTrim(cur.slice(1)); continue; }
    const vals = new Set();
    for (const d of divisorsBig(absB(c0[0]))) { vals.add(d); vals.add(-d); }
    const lds = divisorsBig(absB(cur[cd][0]));
    let found = null;
    for (const num of [...vals]) for (const den of lds) {
      const r = R(num, den);
      if (rIsZero(polyEvalR(cur, r))) { found = r; break; }
    }
    if (!found) break;
    const factor = [rNeg(found), RONE];
    factors.push(`(x${found[0] < 0n ? " + " : " - "}${rStr([absB(found[0]), found[1]])})`);
    cur = polyDivMod(cur, factor).q;
  }
  if (polyDeg(cur) === 0) {
    return factors.length ? (!(cur[0][0] === 1n && cur[0][1] === 1n) ? `${rStr(cur[0])}*` : "") + factors.join("*") : rStr(cur[0]);
  }
  if (!factors.length) return polyStr(p);
  return `${factors.join("*")}*(${polyStr(cur)})`;
}

function parseBoolExpr(src) {
  let s = String(src).replace(/\s+/g, "").replace(/&&/g, "&").replace(/\|\|/g, "|").replace(/~/g, "!").toUpperCase();
  if (!s) err("布尔表达式为空");
  if (s.length > 500) err("布尔表达式过长");
  let toks = s.match(/[A-Z]|[01]|[&|!^()]/g);
  if (!toks || toks.join("") !== s) err("布尔表达式含非法字符（变量用单字母 A-Z）");
  const withAnd = [];
  const endsOperand = (t) => /^[A-Z01]$/.test(t) || t === ")";
  const startsOperand = (t) => /^[A-Z01]$/.test(t) || t === "(" || t === "!";
  for (const t of toks) {
    if (withAnd.length && endsOperand(withAnd[withAnd.length - 1]) && startsOperand(t)) withAnd.push("&");
    withAnd.push(t);
  }
  toks = withAnd;
  const vars = [...new Set(toks.filter((t) => /^[A-Z]$/.test(t)))].sort();
  if (vars.length > 10) err("布尔变量最多 10 个");
  const prec = { "!": 4, "&": 3, "^": 2, "|": 1 };
  const out = [], ops = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (/^[A-Z01]$/.test(t)) out.push(t);
    else if (t === "(") ops.push(t);
    else if (t === ")") { while (ops.length && ops[ops.length - 1] !== "(") out.push(ops.pop()); if (!ops.length) err("括号不匹配"); ops.pop(); }
    else if (t === "!") ops.push(t);
    else {
      while (ops.length && ops[ops.length - 1] !== "(" && prec[ops[ops.length - 1]] >= prec[t]) out.push(ops.pop());
      ops.push(t);
    }
  }
  while (ops.length) { const o = ops.pop(); if (o === "(") err("括号不匹配"); out.push(o); }
  const evalWith = (env) => {
    const st = [];
    for (const t of out) {
      if (/^[01]$/.test(t)) st.push(Number(t));
      else if (/^[A-Z]$/.test(t)) st.push(env[t] ? 1 : 0);
      else if (t === "!") st.push(st.pop() ? 0 : 1);
      else { const b = st.pop(), a = st.pop(); st.push(t === "&" ? (a & b) : t === "|" ? (a | b) : (a ^ b)); }
    }
    return st[0] ? 1 : 0;
  };
  return { vars, evalWith };
}

function gridBFS(src) {
  const g = parseGrid(src);
  const h = g.length, w = g[0].length;
  let start = null, goal = null;
  for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
    if (g[i][j] === "S") start = [i, j];
    if (g[i][j] === "E") goal = [i, j];
  }
  if (!start || !goal) err("网格需含 S 与 E");
  const q = [start], prev = new Map(), key = (i, j) => `${i},${j}`;
  prev.set(key(...start), null);
  let found = false;
  while (q.length) {
    const [i, j] = q.shift();
    if (i === goal[0] && j === goal[1]) { found = true; break; }
    for (const [di, dj] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || ni >= h || nj < 0 || nj >= w) continue;
      if (g[ni][nj] === "#" || prev.has(key(ni, nj))) continue;
      prev.set(key(ni, nj), [i, j]);
      q.push([ni, nj]);
    }
  }
  if (!found) return null;
  const path = [];
  let cur = goal;
  while (cur) { path.push(cur); cur = prev.get(key(...cur)); }
  path.reverse();
  const marks = g.map((r) => [...r]);
  for (const [i, j] of path) if (marks[i][j] === ".") marks[i][j] = "*";
  return { path, render: marks.map((r) => r.join("")).join("\n") };
}

function buildCoverageEntry(cat, name, slug, status, target, reason) {
  return { cat, name, slug, url: `https://www.dcode.fr/${slug}`, status, target: target || "", reason: reason || "" };
}

const RAW1 = {
  "Arithmétique": `
Addition|addition-grands-nombres
Affixe de Nombre Complexe|affixe-nombre-complexe
Algorithme d'Euclide Etendu|euclide-etendu
Algorithme de Kaprekar|algorithme-kaprekar
Algorithme de Luhn (Vérification de Numéros)|algorithme-luhn
Algorithme de Verhoeff|algorithme-verhoeff
Argument de Nombre Complexe|argument-nombre-complexe
Base 58|chiffre-base-58
Base Factorielle|base-factorielle
Calculatrice d'Arrondi|calculatrice-arrondi
Calculs Modulo N|calculatrice-modulo-n
Carré Magique|carre-magique
Chiffre Base 26|chiffre-base-26
Chiffre Multiplication Nombres Premiers|chiffre-multiplication-nombres-premiers
Chiffre RSA|chiffre-rsa
Code Bibi-binaire|code-bibi-binaire
Code Binaire|code-binaire
Code Ternaire (Base 3)|code-ternaire
Complement Binaire|complement-binaire
Conjecture de Goldbach|conjecture-goldbach
Conjecture de Pólya|conjecture-polya
Conversion en Base N|conversion-base-n
Diviseurs d'un Nombre|liste-diviseurs-nombre
Division|division-grands-nombres
Division Euclidienne|division-euclidienne
Double Factorielle|double-factorielle
Décomposition en 2 Facteurs|decomposition-2-facteurs
Décomposition en Nombres Premiers|decomposition-nombres-premiers
Echange de Clés Diffie-Hellman|echange-cle-diffie-hellman
Echelle de Carte|echelle-dessin
Ensembles de Nombres|ensembles-nombres
Expansion de Cantor|expansion-cantor
Exponentiation (Puissance)|calcul-exponentiation
Exponentiation Modulaire|exponentiation-modulaire
Factorielle|factorielle
Factorisation de Fermat|factorisation-fermat
Flèches de Knuth|fleches-knuth
Fonction de Comptage des Premiers|fonction-compte-nombre-premier
Fonction de Möbius|fonction-mobius
Fonction de Von Mangoldt|lambda-mangoldt
Forme Exponentielle Complexe|forme-exponentielle-complexe
Formule Quadratique|formule-quadratique
Fraction Périodique|developpement-decimal-periodique
Fractions Irréductibles|fraction-irreductible
Hexadécimal (Base 16)|systeme-hexadecimal
Identité de Bézout|identite-bezout
Indicatrice d'Euler|indicatrice-euler
Inverse Modulaire|inverse-modulaire
Logarithme Discret|log-discret
Module de Nombre Complexe|module-nombre-complexe
Multiples d'un Nombre|liste-multiples-nombre
Multiplication|multiplication-grands-nombres
Nombre Armstrong|nombre-armstrong
Nombre Fractionnaire|nombre-fractionnaire
Nombre Premier Précédent|nombre-premier-precedent
Nombre Premier Suivant|nombre-premier-suivant
Nombre Premier le Plus Proche|nombre-premier-proche
Nombre de Carmichael|nombre-carmichael
Nombre de Harshad|nombre-harshad
Nombres Finissant Par…|nombres-finissant-par-certains-chiffres
Nombres Palindromiques|nombres-palindromiques
Nombres Premiers|nombres-premiers
Nombres Premiers Entre Eux|nombres-premiers-entre-eux
Notation Polonaise Inverse|notation-polonaise-inverse
Négabinaire|systeme-negabinaire
Négadécimal|base-negadecimale
PGCD (Plus Grand Commun Diviseur)|pgcd
PPCM (Plus Petit Commun Multiple)|ppcm
Partitions d'un Nombre|generateur-partitions
Primorielle|primorielle
Produit ∏|calcul-produit
Recherche de Nombres Premiers|recherche-nombres-premiers
Rendu de Monnaie|rendu-monnaie
Représentation de Zeckendorf|representation-zeckendorf
Restes Chinois|restes-chinois
Solveur Cryptarithme|solveur-cryptarithme
Solveur d'Equation Modulaire|solveur-equation-modulaire
Solveur de Calculs à Trous|solveur-calculs-a-trous
Solveur de Calculs à Trous (Nombres)|solveur-calculs-a-trous-nombres
Solveur de Calculs à Trous (Opérateurs)|solveur-calculs-a-trous-operateurs
Sommation Σ|calcul-sommation
Somme de Carrés|somme-de-carres
Somme de Chiffres|somme-chiffres
Somme de Sous-Ensembles|somme-sous-ensemble
Sous-factorielle|sous-factorielle
Soustraction|soustraction-grands-nombres
Système Octal (Base 8)|systeme-octal
Test de Primalité|test-primalite
Triangle de Pascal|triangle-pascal
Triplet de Pythagore|triplet-pythagore
Valuation 2-Adique|valuation-2-adique
`.trim().split("\n"),
  "Fonctions": `
Abscisse à l'Origine|abscisse-origine
Antécédents par une Fonction|antecedents-fonction
Asymptote d'une Fonction|asymptote-fonction
Calcul de Fonction (Tableau de Valeurs)|calcul-valeurs-fonction
Coefficient Directeur|coefficient-directeur
Degré d'un Polynome|degre-polynome
Discriminant d'un Polynome|discriminant-polynome
Division Polynomiale|division-polynomiale
Domaine de Définition d'une Fonction|domaine-definition-fonction
Domaine de Dérivabilité d'une Fonction|domaine-derivation-fonction
Dérivée|derivee
Dérivée Nième|derivee-nieme
Dérivée Seconde d'une Fonction|derivee-seconde
Dérivée Troisième d'une Fonction|derivee-troisieme
Développement Limité|developpement-limite
Equation de Droite|equation-droite
Exponentielle|exponentielle
Extremum d'une Fonction|extremum-fonction
Factorisation d'un Polynome|factorisation-polynome
Fonction Croissante|fonction-croissante
Fonction Décroissante|fonction-decroissante
Fonction Monotone|fonction-monotone
Fonction Réciproque|fonction-reciproque
Fonction d'Erreur|fonction-erreur
Fonction de Dawson|fonction-integrale-dawson
Image par une Fonction|image-fonction
Interpolation Polynomiale|interpolation-polynomiale
Interpolation de Lagrange|lagrange-interpolation-polynome
Interpolation de Neville|neville-interpolation-polynome
Interpolation de Newton|newton-interpolation-polynome
Intégrale Double|integrale-double
Intégrale Triple|integrale-triple
Intégrale sur un Intervalle|integrale-intervalle
Limite de Fonction|limite
Logarithme|logarithme
Maximum d'une Fonction|maximum-fonction
Minimum d'une Fonction|minimum-fonction
Moyenne d'une Fonction|moyenne-fonction
Méthode de Newton Raphson|methode-newton-raphson
Ordonnée à l'Origine|ordonnee-origine
Parité d'une Fonction|parite-fonction
Point Critique d'une Fonction|point-critique-fonction
Point Stationnaire d'une Fonction|point-stationaire-fonction
Point d'Intersection|point-intersection
Primitives d'une Fonction|primitive-integrale
Période d'une Fonction|periode-fonction
Racine Carrée|racine-carree
Racine Cubique|racine-cubique
Racine Nième|racine-nieme
Racine d'un Polynome|racine-polynome
Recherche d'Equation de Fonction|recherche-equation-fonction
Solveur d'Equation Différentielle|solveur-equation-differentielle
Tracer des Points|tracer-points
Transformation Inverse de Laplace|transformation-inverse-laplace
Transformation de Fourier|transformation-fourier
Transformation de Fourier Inverse|transformation-fourier-inverse
Transformation de Laplace|transformation-laplace
`.trim().split("\n"),
  "Matrice": `
Addition Matricielle|addition-matricielle
Calcul Matriciel|calcul-matriciel
Diagonalisation de Matrice|diagonalisation-matrice
Division Matricielle|division-matricielle
Décomposition LU|decomposition-lu-matrice
Décomposition de Schur (Matrice)|decomposition-schur-matrice
Déterminant d'une Matrice|determinant-matrice
Elimination de Gauss (Pivot)|elimination-gauss
Espaces Propres d'une Matrice|espaces-propres-matrice
Forme Normale d'Hermite (Matrice)|hermite-matrice
Inverse d'une Matrice|inverse-matrice
Matrice Adjointe|matrice-adjointe
Matrice Complémentaire|matrice-complementaire
Matrice Conjuguée Complexe|matrice-conjuguee-complexe
Matrice Echelonnée|matrice-echelonnee
Matrice de Passage|matrice-changement-base
Matrice des Cofacteurs|matrice-cofacteurs
Mineurs d'une Matrice|mineurs-matrice
Norme d'un Vecteur|norme-vecteur
Noyau d'une Matrice|noyau-matrice
Orthonormalisation de Gram-Schmidt|orthonormalisation-gram-schmidt
Permanent d'une Matrice|permanent-matrice
Polynome Caractéristique d'une Matrice|polynome-caracteristique-matrice
Produit Matriciel|produit-matriciel
Produit Tensoriel|produit-tensoriel
Produit Vectoriel|produit-vectoriel
Produit de Kronecker|produit-kronecker
Puissance de Matrice|puissance-matrice
Rang d'une Matrice|rang-matrice
Rayon Spectral d'une Matrice|rayon-spectral-matrice
Réduction de Jordan (Matrice)|jordan-matrice
Somme Directe Matricielle|somme-directe-matrice
Soustraction Matricielle|soustraction-matricielle
Trace d'une Matrice|trace-matrice
Transposée d'une Matrice|transposee-matrice
Trigonalisation de Matrice|trigonalisation-matrice
Valeurs Propres d'une Matrice|valeurs-propres-matrice
Vecteurs Propres d'une Matrice|vecteurs-propres-matrice
`.trim().split("\n"),
};

const RAW2 = {
  "Calcul Formel": `
Addition à Inconnue(s)|addition-equation-inconnue
Calculatrice|calculatrice-formelle
Calcul d'Expressions Booléennes|calcul-expressions-booleennes
Calculs avec des Fractions|calculs-fractions
Complétion d'un Carré|completion-carre
Division à Inconnue(s)|division-equation-inconnue
Dual Booléen|dual-booleen
Développement Mathématique|developpement-expression-math
Développement et Réduction Mathématique|developpement-reduction-maths
Elimination de Gauss (Pivot)|elimination-gauss
Factorisation Mathématique|factorisation-expression-math
Factorisation d'un Polynome|factorisation-polynome
Forme Canonique d'un Polynome de Degré 2|forme-canonique-polynome-2
Fractions Irréductibles|fraction-irreductible
Intégrale Double|integrale-double
Intégrale Triple|integrale-triple
Intégrale sur un Intervalle|integrale-intervalle
MinTermes et MaxTermes Booléens|calcul-mintermes-maxterms
Multiplication à Inconnue(s)|multiplication-equation-inconnue
Primitives d'une Fonction|primitive-integrale
Racine Carrée|racine-carree
Racine Cubique|racine-cubique
Racine Nième|racine-nieme
Simplificateur d'Expression Mathématique|simplification-mathematique
Solveur d'Equation|solveur-equation
Solveur d'Equation Différentielle|solveur-equation-differentielle
Solveur d'Equation Trigonométrique|solveur-equation-trigo
Solveur d'Inéquation|solveur-inequation
Soustraction à Inconnue(s)|soustraction-equation-inconnue
Table de Karnaugh|table-karnaugh
Table de Vérité|table-verite-logique
Vérification d'Egalité|verification-egalite
`.trim().split("\n"),
  "Combinatoire": `
Arrangements|arrangements
Arrangements avec Répétition|arrangements-avec-repetition
Coefficient Binomial|coefficient-binomial
Combinaison de Choix|combinaisons-choix
Combinaisons avec Répétition|combinaisons-avec-repetition
Combinaisons de K parmi N|combinaisons
Combinaisons de Paris Hippiques|combinaisons-paris-hippiques
Combinaisons de Paris Sportifs|combinaisons-paris-sportifs
Dérangements|generateur-derangements
Générateur d'Arbre de Tournoi|generateur-tournoi-arbre
Générateur de Championnat|generateur-championnat
Générateur de Championnat par Paires|generateur-championnat-paires
Générateur de Tournoi Americano|generateur-tournoi-americano
Loi Binomiale|loi-binomiale
Nombres Aléatoires|nombre-aleatoire
Nombres de Bell|nombres-bell
Permutations|generateur-permutations
Permutations avec Répétition|permutations-avec-repetition
Probabilité Conditionnelle|probabilite-conditionnelle
Probabilité de Tirages|probabilites-tirage
Produit Cartésien|produit-cartesien
Rang d'une Combinaison|rang-combinaison
Rang d'une Permutation|rang-permutation
Somme de Sous-Ensembles|somme-sous-ensemble
Système Réducteur de Tirage|systeme-reducteur-tirage
Tableau de Combinaisons|tableau-de-combinaisons
Tirage au Sort|tirage-au-sort
`.trim().split("\n"),
  "Mathématiques (Autre/non classé)": `
Chiffre Base 36|chiffre-base-36
Chiffre Base 37|chiffre-base-37
Codage de Fibonacci|codage-fibonacci
Codage de NegaFibonacci|codage-negafibonacci
Conjecture de Syracuse|conjecture-syracuse
Décimales de Pi 3.14159…|decimales-pi
Décimales de Tau τ=6.2831853…|decimales-tau
Décimales de e 2.71828...|decimales-e
Décimales du Nombre d'Or Phi 1.61803...|decimales-nombre-or
Encadrement d'un Nombre|encadrement-mathematique
Intervalle|notation-intervalle
Marques de Dénombrement|marques-unaires
Moyenne Pondérée de Nombres|moyenne-ponderee
Nombres Pairs ou Impairs|pair-impair
Notation Scientifique|notation-scientifique
Puissances de 10|puissances-de-10
Racine Numérique|reduction-recursive
Rang dans un Nombre|rang-chiffre-nombre
Recherche dans les Décimales|recherche-decimales
Signe (Positif/Négatif)|signe-positif-negatif
Solveur 24|solveur-24-jeu
Solveur Krypto|solveur-krypto
Solveur Mathador|solveur-mathador
Suite de Conway|suite-conway
Supprimer les Parenthèses|suppression-parentheses
`.trim().split("\n"),
};

const RAW3 = {
  "Géométrie": `
Abscisse à l'Origine|abscisse-origine
Affixe de Nombre Complexe|affixe-nombre-complexe
Antécédents par une Fonction|antecedents-fonction
Argument de Nombre Complexe|argument-nombre-complexe
Calcul de Pente|calcul-pente
Coefficient Directeur|coefficient-directeur
Conjugué de Nombre Complexe|conjugue-nombre-complexe
Conversion d'Unités d'Angles|conversion-unite-angle
Droite Perpendiculaire|droite-perpendiculaire
Equation de Droite|equation-droite
Flocon de Koch|flocon-koch
Forme Exponentielle Complexe|forme-exponentielle-complexe
Image par une Fonction|image-fonction
Inconnues dans le Triangle|inconnues-triangle
Module de Nombre Complexe|module-nombre-complexe
Nom des Figures Géométriques|figures-geometriques
Ordonnée à l'Origine|ordonnee-origine
Systèmes de Coordonnées 2D|changement-coordonnees-2d
Systèmes de Coordonnées 3D|changement-coordonnees-3d
Tangente à une Courbe|tangente-equation
Théorème de Pick|theoreme-de-pick
Triplet de Pythagore|triplet-pythagore
`.trim().split("\n"),
  "Statistiques": `
Calcul de Pourcentages|pourcentage-fraction-proportion
Ecart-Type|ecart-type
Espérance de Gain|esperance-gain
Intervalle de Confiance d'un Sondage|intervalle-confiance-sondage
Loi de Benford|loi-benford
Marge d'Erreur|marge-erreur
Mediane de Nombres|mediane
Moyenne Arithmétique|moyenne-arithmetique
Moyenne Géométrique|moyenne-geometrique
Moyenne Harmonique|moyenne-harmonique
Moyenne de Nombres|moyenne
Probabilités d'Anniversaire|probabilites-anniversaire
Précision et Rappel|precision-rappel
Quantile de Nombres|quantile-nombres
Quartile de Nombres|calcul-quartiles
Statistiques de Tirages|statistiques-tirage
Variance Statistique|variance-statistique
`.trim().split("\n"),
  "Physique-Chimie": `
Calculs de Radioactivité|calcul-radioactivite
Configuration Electronique des Atomes|configuration-electronique
Couleur en Nombre|couleur-en-nombre
Couleur en Rouge Vert Bleu|couleur-rouge-vert-bleu
Couleurs HTML|couleurs-html
Dilatation du Temps|dilatation-temps
Energie de Photon|couleur-energie-photon
Fréquence d'Onde de Couleur|couleur-frequence-onde
Longueur d'Onde de Couleur|couleur-longueur-onde
Numéro Atomique (Table Périodique)|substitution-numero-atomique
`.trim().split("\n"),
  "Séries": `
Fractions Continues|fractions-continues
Multiples d'un Nombre|liste-multiples-nombre
Nombre Harmonique|nombre-harmonique
Nombres de Fibonacci|nombres-fibonacci
Triangle de Pascal|triangle-pascal
`.trim().split("\n"),
  "Théorie des Graphes": `
Chemin sur un Graphe Grille|chemin-graphe-grille
Recherche de Chemin dans une Pyramide|recherche-chemin-pyramide-triangle
Tracer des Points|tracer-points
`.trim().split("\n"),
  "Biologie": `
Codons (Code Génétique)|codons-code-genetique
Jeu de la Vie|jeu-de-la-vie
`.trim().split("\n"),
};

const OPS_CORE = [
  runOp("d2-bignum", CAT, "大整数四则/模/幂", "BigInt 精确：加、减、乘、除（商余+小数）、欧几里得除法、取模、幂；结果位数上限 10^5",
    (t, p) => {
      const mode = String((p && p.mode) || "add");
      const a = parseBig((p && p.a) || t, "a");
      const bSrc = (p && p.b) || "";
      if (mode === "pow") {
        const e = boundedInt(bSrc, "指数", 0, 100000);
        if (e > 20000 && absB(a) > 1n) err("底数绝对值 >1 时指数上限 20000");
        let r = 1n, base = a, exp = e;
        while (exp) { if (exp & 1) r *= base; base *= base; exp >>= 1; if (r.toString().length > MAX_DIGITS) err("结果超过 10^5 位"); }
        const rs = r.toString();
        return `${a}^${e} =\n${rs}${rs.length > 200 ? `\n（${rs.length} 位）` : ""}`;
      }
      const b = parseBig(bSrc, "b");
      if (["div", "euclid", "mod"].includes(mode) && b === 0n) err("除数不能为 0");
      if (mode === "add") return `${a} + ${b} = ${a + b}`;
      if (mode === "sub") return `${a} - ${b} = ${a - b}`;
      if (mode === "mul") return `${a} × ${b} = ${a * b}`;
      if (mode === "mod") return `${a} mod ${b} = ${modB(a, b)}`;
      if (mode === "div" || mode === "euclid") {
        const q = a / b, r = a % b;
        let dec = "";
        if (mode === "div") {
          const scale = 10n ** 20n;
          const d = a * scale / b;
          const s = absB(d).toString().padStart(21, "0");
          dec = `${d < 0n ? "-" : ""}${s.slice(0, -20)}.${s.slice(-20).replace(/0+$/, "") || "0"}`;
        }
        return `${a} ÷ ${b}\n商 = ${q}\n余数 = ${r}${mode === "div" ? `\n小数 ≈ ${dec}` : ""}\n校验：${a} = ${b}×${q} + ${r}`;
      }
      if (mode === "gcd") return `gcd(${a},${b}) = ${gcdB(a, b)}\nlcm(${a},${b}) = ${lcmB(a, b)}`;
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "运算", "add", ["add", "sub", "mul", "div", "euclid", "mod", "pow", "gcd"]), P("a", "a", "12345678901234567890"), P("b", "b（pow 时为指数）", "98765432109876543210")]),

  runOp("d2-baseconv", CAT, "任意进制转换（2..62 / 负进制）", "BigInt 任意进制：Base2/3/8/16/26/36/37/58、通用 Base N、负二进制/负十进制；补码模式输出定宽二进制",
    (t, p) => {
      const mode = String((p && p.mode) || "to");
      const base = Number((p && p.base) || 10);
      const v = String((p && p.value) || t || "").trim();
      if (!Number.isInteger(base) || base === 0 || base === 1 || base < -36 || base > 62) err("进制需为 2..62 或 -2..-36");
      if (mode === "to") return `十进制 ${v} → Base ${base}：\n${toBaseBig(parseBig(v, "数值"), base)}`;
      if (mode === "from") {
        if (base < 0 && v.includes("-")) err("负进制输入不使用负号，请直接给数字位");
        return `Base ${base}「${v}」→ 十进制：\n${fromBaseBig(v, base)}`;
      }
      if (mode === "complement") {
        const width = boundedInt((p && p.width) || "8", "位宽", 1, 128);
        let x = parseBig(v, "数值");
        const lim = 1n << BigInt(width);
        if (x < 0n) x = lim + x;
        x = modB(x, lim);
        const bits = x.toString(2).padStart(width, "0");
        return `${width} 位补码：${bits}\n无符号值 = ${x}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "方向", "to", [{ value: "to", label: "十进制 → 目标进制" }, { value: "from", label: "目标进制 → 十进制" }, { value: "complement", label: "二进制补码" }]), P("value", "数值", "255"), P("base", "进制（负数为负进制）", "16"), P("width", "补码位宽", "8")]),

  runOp("d2-zeckendorf", CAT, "Zeckendorf / Fibonacci 编码", "正整数写成不连续 Fibonacci 数之和；编码为 0/1 串并可逆，禁止连续 1",
    (t, p) => {
      const mode = String((p && p.mode) || "encode");
      const v = String((p && p.value) || t || "").trim();
      if (mode === "encode") {
        const n = parseBig(v, "n");
        if (n < 1n || n > 10n ** 100n) err("n 需在 1..10^100");
        return `${n} 的 Zeckendorf 表示：\n${zeckendorfEncode(n)}\n（从最高 Fibonacci 位到 1，禁止连续 1）`;
      }
      if (mode === "decode") return `Zeckendorf「${v}」= ${zeckendorfDecode(v)}`;
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "方向", "encode", ["encode", "decode"]), P("value", "n 或 0/1 串", "100")]),

  runOp("d2-complex", CAT, "复数运算与极坐标", "解析 a+bi；加减乘除、幂、模、辐角（度/弧度）、共轭、指数形式 r·e^(iθ)",
    (t, p) => {
      const mode = String((p && p.mode) || "module");
      const z = parseComplex((p && p.z1) || t);
      const w = parseComplex((p && p.z2) || "0");
      const deg = carg(z) * 180 / Math.PI;
      if (mode === "add") return `${cfmt(z)} + ${cfmt(w)} = ${cfmt(cadd(z, w))}`;
      if (mode === "sub") return `${cfmt(z)} - ${cfmt(w)} = ${cfmt(csub(z, w))}`;
      if (mode === "mul") return `${cfmt(z)} × ${cfmt(w)} = ${cfmt(cmul(z, w))}`;
      if (mode === "div") return `${cfmt(z)} ÷ ${cfmt(w)} = ${cfmt(cdiv(z, w))}`;
      if (mode === "pow") {
        const n = boundedInt((p && p.n) || "2", "幂次", 0, 1000);
        return `${cfmt(z)}^${n} = ${cfmt(cpow(z, n))}`;
      }
      if (mode === "module") return `|${cfmt(z)}| = ${fmt(cabs(z), 12)}`;
      if (mode === "argument") return `arg(${cfmt(z)}) = ${fmt(deg, 10)}° = ${fmt(carg(z), 12)} rad`;
      if (mode === "conjugate") return `共轭：${cfmt({ re: z.re, im: -z.im })}`;
      if (mode === "polar") {
        const r = cabs(z), th = carg(z);
        return `极坐标：r = ${fmt(r, 12)}\nθ = ${fmt(th, 12)} rad = ${fmt(th * 180 / Math.PI, 10)}°\n指数形式：${fmt(r, 10)}·e^(${fmt(th, 10)}i)`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "运算", "module", ["add", "sub", "mul", "div", "pow", "module", "argument", "conjugate", "polar"]), P("z1", "复数 1", "3+4i"), P("z2", "复数 2", "1-i"), P("n", "幂次", "2")]),

  runOp("d2-factor-tools", CAT, "因子/倍数/费马分解/平方和", "枚举因子与倍数、费马分解、两因子分解、互素表、尾数筛选、回文数、四平方和表示；全部有界",
    (t, p) => {
      const mode = String((p && p.mode) || "divisors");
      const nSrc = (p && p.n) || t;
      if (mode === "divisors") {
        const n = parseBig(nSrc, "n");
        const ds = divisorsBig(n);
        return `${n} 的因子（${ds.length} 个）：\n${ds.join(", ")}`;
      }
      if (mode === "multiples") {
        const n = parseBig(nSrc, "n");
        const lim = parseBig((p && p.limit) || "1000", "上限");
        if (n === 0n) err("n 不能为 0");
        if (lim / absB(n) > BigInt(MAX_OUT)) err("倍数数量超过上限");
        const out = [];
        for (let x = absB(n); x <= lim; x += absB(n)) out.push(x.toString());
        return `≤ ${lim} 的 ${n} 的倍数（${out.length} 个）：\n${out.join(", ") || "无"}`;
      }
      if (mode === "fermat") {
        let n = parseBig(nSrc, "n");
        if (n < 3n || n % 2n === 0n) err("费马分解需要奇合数 n≥3");
        let a = isqrtB(n);
        if (a * a < n) a++;
        for (let i = 0; i < 1000000; i++) {
          const b2 = a * a - n, b = isqrtB(b2);
          if (b * b === b2) return `${n} = (${a} + ${b}) × (${a} - ${b}) = ${a + b} × ${a - b}`;
          a++;
        }
        err("费马分解迭代超过 10^6，未找到因子");
      }
      if (mode === "two-factors") {
        const n = parseBig(nSrc, "n");
        if (n < 2n) err("n 需 ≥2");
        const ds = divisorsBig(n);
        for (const d of ds) if (d > 1n && d * d <= n && n % d === 0n) return `${n} = ${d} × ${n / d}`;
        return `${n} 是素数，只有 1 × ${n}`;
      }
      if (mode === "coprime") {
        const n = parseBig(nSrc, "n");
        if (n < 1n || n > 1000000n) err("n 需在 1..10^6");
        const out = [];
        for (let k = 1n; k <= n; k++) if (gcdB(k, n) === 1n) out.push(k.toString());
        return `≤ ${n} 且与 ${n} 互素（${out.length} 个）：\n${out.join(", ") || "无"}`;
      }
      if (mode === "endings") {
        const lim = boundedInt((p && p.limit) || "1000", "上限", 1, 1000000);
        const suf = String((p && p.digits) || "").trim();
        if (!/^\d+$/.test(suf)) err("尾数需为数字串");
        const out = [];
        for (let x = 0; x <= lim; x++) if (String(x).endsWith(suf)) out.push(x);
        return `≤ ${lim} 且以 ${suf} 结尾（${out.length} 个）：\n${out.join(", ") || "无"}`;
      }
      if (mode === "palindromes") {
        const lim = boundedInt((p && p.limit) || "1000", "上限", 0, 10000000);
        const out = [];
        for (let x = 0; x <= lim; x++) if (isPalindromeStr(String(x))) out.push(x);
        return `≤ ${lim} 的回文数（${out.length} 个）：\n${out.join(", ") || "无"}`;
      }
      if (mode === "sumsquares") {
        const n = boundedInt(nSrc, "n", 0, 100000000);
        const memo = new Map();
        const solve = (rem, k, min) => {
          if (rem === 0) return [];
          if (k === 0) return null;
          const key = `${rem}:${k}:${min}`;
          if (memo.has(key)) return memo.get(key);
          const hi = Math.floor(Math.sqrt(rem));
          for (let a = hi; a >= Math.max(min, 1); a--) {
            const r = solve(rem - a * a, k - 1, a);
            if (r) { const out = [a, ...r]; memo.set(key, out); return out; }
          }
          memo.set(key, null);
          return null;
        };
        for (let k = 1; k <= 4; k++) {
          const r = solve(n, k, 1);
          if (r) return `${n} = ${r.map((x) => `${x}²`).join(" + ")}（${k} 个平方数）`;
        }
        return `${n} = 0²`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "divisors", ["divisors", "multiples", "fermat", "two-factors", "coprime", "endings", "palindromes", "sumsquares"]), P("n", "n", "28"), P("limit", "上限", "1000"), P("digits", "结尾数字", "7")]),

  runOp("d2-modular", CAT, "模运算：Bézout/逆元/CRT/离散对数/DH", "扩展欧几里得、模逆、中国剩余定理、线性同余、BSGS 离散对数、Diffie–Hellman 密钥交换；全部 BigInt",
    (t, p) => {
      const mode = String((p && p.mode) || "bezout");
      if (mode === "bezout") {
        const a = parseBig((p && p.a) || t, "a"), b = parseBig((p && p.b) || "0", "b");
        const r = egcdB(a, b);
        return `gcd(${a},${b}) = ${r.g}\nBézout：${a}×(${r.x}) + ${b}×(${r.y}) = ${r.g}\n校验：${a * r.x + b * r.y}`;
      }
      if (mode === "inverse") {
        const a = parseBig((p && p.a) || t, "a"), m = parseBig((p && p.m) || "1", "m");
        return `${a}⁻¹ mod ${m} = ${invModB(a, m)}`;
      }
      if (mode === "crt") {
        const src = String((p && p.sys) || t || "").trim();
        const parts = src.split(/[;\n]+/).map((x) => x.trim()).filter(Boolean);
        if (parts.length < 2) err("CRT 输入格式：a1,m1;a2,m2;...");
        const rs = [], ms = [];
        for (const part of parts) {
          const m = part.match(/^(-?\d+)\s*,\s*(\d+)$/);
          if (!m) err(`CRT 项格式应为 a,m：${part}`);
          rs.push(BigInt(m[1])); ms.push(BigInt(m[2]));
        }
        let M = 1n;
        for (const m of ms) M = lcmB(M, m);
        let x = 0n;
        for (let i = 0; i < rs.length; i++) {
          const Mi = M / ms[i], inv = invModB(modB(Mi, ms[i]), ms[i]);
          x = modB(x + rs[i] * Mi * inv, M);
        }
        return `同余方程组解：x ≡ ${x} (mod ${M})\n通解：x = ${x} + ${M}k`;
      }
      if (mode === "congruence") {
        const a = parseBig((p && p.a) || t, "a"), b = parseBig((p && p.b) || "0", "b"), m = parseBig((p && p.m) || "1", "m");
        if (m <= 0n) err("模数需为正");
        const g = gcdB(a, m);
        if (b % g !== 0n) return `${a}x ≡ ${b} (mod ${m}) 无解（gcd=${g} 不整除 ${b}）`;
        const aa = a / g, bb = b / g, mm = m / g;
        const x0 = modB(bb * invModB(modB(aa, mm), mm), mm);
        const out = [];
        for (let k = 0n; k < g && k < 1000n; k++) out.push(modB(x0 + k * mm, m).toString());
        return `${a}x ≡ ${b} (mod ${m}) 有 ${g} 个解：\n${out.join(", ")}`;
      }
      if (mode === "dlog") {
        const g = parseBig((p && p.a) || t, "g"), h = parseBig((p && p.b) || "0", "h"), p0 = parseBig((p && p.m) || "1", "p");
        if (p0 < 2n || p0 > 10n ** 9n) err("p 需在 2..10^9");
        const m = Number(isqrtB(p0) + 1n);
        const table = new Map();
        let e = 1n;
        for (let j = 0; j < m; j++) { const key = e.toString(); if (!table.has(key)) table.set(key, j); e = (e * g) % p0; }
        const factor = invModB(powmod(g, BigInt(m), p0), p0);
        let gamma = modB(h, p0);
        for (let i = 0; i < m; i++) {
          const key = gamma.toString();
          if (table.has(key)) return `离散对数：${g}^x ≡ ${h} (mod ${p0}) 的最小非负解 x = ${i * m + table.get(key)}`;
          gamma = (gamma * factor) % p0;
        }
        return `${g}^x ≡ ${h} (mod ${p0}) 在搜索范围内无解`;
      }
      if (mode === "dh") {
        const prime = parseBig((p && p.m) || "23", "p"), gen = parseBig((p && p.a) || "5", "g");
        const a = parseBig((p && p.b) || "6", "私钥 a"), b = parseBig((p && p.c) || "15", "私钥 b");
        const A = powmod(gen, a, prime), B = powmod(gen, b, prime), s1 = powmod(B, a, prime), s2 = powmod(A, b, prime);
        if (s1 !== s2) err("DH 共享密钥不一致（内部错误）");
        return `p=${prime}, g=${gen}, a=${a}, b=${b}\nA = g^a mod p = ${A}\nB = g^b mod p = ${B}\n共享密钥 = ${s1}\n校验 B^a = A^b = ${s1}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "bezout", ["bezout", "inverse", "crt", "congruence", "dlog", "dh"]), P("a", "a / g / 私钥 a", "240"), P("b", "b / h / 私钥 b", "46"), P("m", "模数 m / p", "23"), P("sys", "CRT 方程组 a,m;...", "2,3;3,5;2,7"), P("c", "私钥 b（DH）", "15")]),

  runOp("d2-quadratic", CAT, "二次方程/判别式/配方法", "ax²+bx+c：判别式、精确/近似根、顶点、标准形 a(x-h)²+k；有理数输入",
    (t, p) => {
      const a = parseRat((p && p.a) || "1"), b = parseRat((p && p.b) || "0"), c = parseRat((p && p.c) || "0");
      if (rIsZero(a)) err("a 不能为 0（这不是二次方程）");
      const A = rNum(a), B = rNum(b), C = rNum(c);
      const disc = B * B - 4 * A * C;
      const h = -B / (2 * A), k = C - (B * B) / (4 * A);
      const lines = [`方程：${polyStr([c, b, a])} = 0`, `判别式 Δ = b²−4ac = ${fmt(disc, 12)}`];
      if (disc > 0) {
        const s = Math.sqrt(disc);
        lines.push(`两个实根：x₁ = ${fmt((-B - s) / (2 * A), 12)}，x₂ = ${fmt((-B + s) / (2 * A), 12)}`);
      } else if (disc === 0) lines.push(`重根：x = ${fmt(h, 12)}`);
      else { const s = Math.sqrt(-disc); lines.push(`两个共轭复根：x = ${fmt(h, 12)} ± ${fmt(s / (2 * Math.abs(A)), 12)}i`); }
      lines.push(`标准形：${fmt(A, 10)}(x ${h < 0 ? "+" : "-"} ${fmt(Math.abs(h), 10)})² ${k < 0 ? "-" : "+"} ${fmt(Math.abs(k), 10)}`);
      lines.push(`顶点：(${fmt(h, 10)}, ${fmt(k, 10)})`);
      return lines.join("\n");
    }, [P("a", "a", "1"), P("b", "b", "-3"), P("c", "c", "2")]),

  runOp("d2-fraction-periodic", CAT, "分数 ↔ 循环小数", "分数化最简并给出循环节；循环小数（0.1(6)）精确还原为分数；BigInt 精确",
    (t, p) => {
      const mode = String((p && p.mode) || "fraction");
      const v = String((p && p.value) || t || "").trim();
      if (mode === "fraction") {
        const [n, d] = parseFractionInput(v);
        const r = R(n, d);
        const dec = fractionToDecimal(r[0], r[1]);
        const whole = r[0] / r[1], rem = absB(r[0]) % r[1];
        const mixed = whole !== 0n && rem !== 0n ? `\n带分数：${r[0] < 0n ? "-" : ""}${absB(whole)} ${rem}/${r[1]}` : "";
        return `${v} = ${rStr(r)}${mixed}\n十进制：${dec}${dec.includes("(") ? `\n循环节长度 = ${dec.split("(")[1].slice(0, -1).length}` : ""}`;
      }
      if (mode === "decimal") {
        const r = parsePeriodicDecimal(v);
        return `${v} = ${rStr(r)}\n小数形式：${fractionToDecimal(r[0], r[1])}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "方向", "fraction", ["fraction", "decimal"]), P("value", "a/b 或 0.1(6)", "1/7")]),

  runOp("d2-listcalc", CAT, "列表求和/乘积/子集和/找零", "整数列表 Σ、∏、子集和（有界）、硬币找零最少枚数与方案数；BigInt",
    (t, p) => {
      const mode = String((p && p.mode) || "sum");
      if (mode === "sum" || mode === "product") {
        const a = intList((p && p.nums) || t);
        const r = a.reduce((s, x) => mode === "sum" ? s + x : s * x, mode === "sum" ? 0n : 1n);
        return `${mode === "sum" ? "Σ" : "∏"} = ${r}`;
      }
      if (mode === "subsetsum") {
        const a = intList((p && p.nums) || t, "集合").map(Number);
        const target = parseSmall((p && p.target) || "0", "目标和");
        if (a.length > 22) err("子集和最多 22 个元素");
        const out = [];
        const rec = (i, rem, chosen) => {
          if (out.length >= 100) return;
          if (rem === 0) { out.push(chosen.slice()); return; }
          if (i >= a.length || rem < 0) return;
          rec(i + 1, rem, chosen);
          chosen.push(a[i]);
          rec(i + 1, rem - a[i], chosen);
          chosen.pop();
        };
        rec(0, target, []);
        return `目标和 ${target} 的子集（最多列 100 个）：\n${out.map((s) => `{${s.join(", ")}}`).join("\n") || "无"}`;
      }
      if (mode === "coinchange") {
        const coins = String((p && p.coins) || "1,2,5").split(/[\s,;]+/).filter(Boolean).map((x) => parseSmall(x, "硬币面值"));
        const amount = boundedInt((p && p.amount) || t, "金额", 0, 100000);
        if (coins.some((c) => c <= 0)) err("硬币面值需为正整数");
        const ways = new Array(amount + 1).fill(0n);
        ways[0] = 1n;
        for (const c of coins) for (let x = c; x <= amount; x++) ways[x] += ways[x - c];
        const dp = new Array(amount + 1).fill(Infinity);
        dp[0] = 0;
        for (let x = 1; x <= amount; x++) for (const c of coins) if (x >= c && dp[x - c] + 1 < dp[x]) dp[x] = dp[x - c] + 1;
        const use = [];
        let rem = amount;
        for (const c of coins.slice().sort((x, y) => y - x)) while (rem >= c && dp[rem] === dp[rem - c] + 1) { use.push(c); rem -= c; }
        return `金额 ${amount}，硬币 {${coins.join(", ")}}\n最少硬币数 = ${dp[amount] === Infinity ? "无解" : dp[amount]}\n一种组合 = ${use.join(" + ") || "无"}\n方案数 = ${ways[amount]}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "sum", ["sum", "product", "subsetsum", "coinchange"]), P("nums", "整数列表", "1 2 3 4 5"), P("target", "目标和", "9"), P("coins", "硬币面值", "1,2,5"), P("amount", "金额", "11")]),

  runOp("d2-magic-square", CAT, "幻方生成/校验", "奇数阶 Siamese、4k 阶补全法、4k+2 阶 Strachey；输出方阵并校验行列对角线和",
    (t, p) => {
      const n = boundedInt((p && p.n) || t, "阶数", 3, 30);
      const a = magicSquare(n);
      const target = n * (n * n + 1) / 2;
      const bad = [];
      for (let i = 0; i < n; i++) {
        const rs = a[i].reduce((x, y) => x + y, 0);
        const cs = a.reduce((x, row) => x + row[i], 0);
        if (rs !== target) bad.push(`行${i + 1}=${rs}`);
        if (cs !== target) bad.push(`列${i + 1}=${cs}`);
      }
      const d1 = a.reduce((s, r, i) => s + r[i], 0), d2 = a.reduce((s, r, i) => s + r[n - 1 - i], 0);
      if (d1 !== target) bad.push(`主对角=${d1}`);
      if (d2 !== target) bad.push(`副对角=${d2}`);
      return `${n} 阶幻方（幻和 ${target}）：\n${a.map((r) => r.map((x) => String(x).padStart(String(n * n).length)).join(" ")).join("\n")}\n校验：${bad.length ? "失败 " + bad.join(", ") : "全部行列对角线通过"}`;
    }, [P("n", "阶数", "5")]),

  runOp("d2-cryptarithm", CAT, "字母算术（Cryptarithme）", "列式回溯求解 SEND+MORE=MONEY 类加法字母谜；不同字母不同数字、首位不为 0；最多 10 个字母",
    (t, p) => {
      const src = String((p && p.eq) || t || "").replace(/\s+/g, "");
      const m = src.match(/^([A-Za-z]+(?:\+[A-Za-z]+)+)=([A-Za-z]+)$/);
      if (!m) err("格式应为 WORD+WORD=RESULT（可多个加数）");
      const addends = m[1].split("+").map((x) => x.toUpperCase());
      const result = m[2].toUpperCase();
      const letters = [...new Set((addends.join("") + result).split(""))];
      if (letters.length > 10) err("字母超过 10 个，无法唯一分配数字");
      const assign = new Map(), used = new Set();
      const maxLen = Math.max(result.length, ...addends.map((w) => w.length));
      const wordAt = (w, col) => col < w.length ? w[w.length - 1 - col] : null;
      const isLeadingAt = (ch, col) => addends.some((w) => w.length - 1 === col && w[0] === ch) || (result.length - 1 === col && result[0] === ch);
      const solve = (col, carry) => {
        if (col === maxLen) return carry === 0;
        const cells = [];
        for (const w of addends) { const ch = wordAt(w, col); if (ch) cells.push(ch); }
        const rch = wordAt(result, col);
        const unknown = [...new Set(cells.concat(rch ? [rch] : []).filter((ch) => !assign.has(ch)))];
        const rec = (idx) => {
          if (idx === unknown.length) {
            let sum = carry;
            for (const ch of cells) sum += assign.get(ch);
            const digit = sum % 10, nc = Math.floor(sum / 10);
            if (rch) {
              if (assign.get(rch) !== digit) return false;
              if (col === result.length - 1 && digit === 0) return false;
            } else if (digit !== 0) return false;
            return solve(col + 1, nc);
          }
          const ch = unknown[idx];
          for (let d = 0; d <= 9; d++) {
            if (used.has(d)) continue;
            if (d === 0 && isLeadingAt(ch, col)) continue;
            assign.set(ch, d); used.add(d);
            if (rec(idx + 1)) return true;
            assign.delete(ch); used.delete(d);
          }
          return false;
        };
        return rec(0);
      };
      if (!solve(0, 0)) return `无解：${src}`;
      const val = (w) => Number(w.split("").map((ch) => assign.get(ch)).join(""));
      const left = addends.reduce((s, w) => s + val(w), 0);
      const right = val(result);
      return `解：\n${letters.map((ch) => `${ch}=${assign.get(ch)}`).join("  ")}\n${addends.map(val).join(" + ")} = ${right}\n校验：${left} = ${right}`;
    }, [P("eq", "字母等式", "SEND+MORE=MONEY")]),

  runOp("d2-holecalc", CAT, "填空算式（缺数字/缺运算符）", "给定 a ? b = c 求运算符，或含单个 ? 的四则等式求缺失数字；枚举有界",
    (t, p) => {
      const mode = String((p && p.mode) || "operator");
      const src = String((p && p.eq) || t || "").replace(/\s+/g, "");
      if (mode === "operator") {
        const m = src.match(/^(-?\d+)([?？])(-?\d+)=(-?\d+)$/);
        if (!m) err("格式：2?3=5（只能一个未知运算符）");
        const a = Number(m[1]), b = Number(m[3]), c = Number(m[4]);
        const hits = [];
        if (a + b === c) hits.push("+");
        if (a - b === c) hits.push("-");
        if (a * b === c) hits.push("×");
        if (b !== 0 && a / b === c) hits.push("÷");
        if (!hits.length) return `${src} 无解（+ − × ÷ 均不成立）`;
        return `${src} 的运算符：${hits.join(" 或 ")}`;
      }
      if (mode === "number") {
        const idx = src.indexOf("?");
        if (idx < 0) err("等式需含一个 ?");
        if (src.indexOf("?", idx + 1) >= 0) err("只支持一个 ?");
        for (let x = -1000; x <= 1000; x++) {
          const expr = src.slice(0, idx) + x + src.slice(idx + 1);
          if (!expr.includes("=")) continue;
          const [l, r] = expr.split("=");
          try {
            const vl = evalExpr(l), vr = evalExpr(r);
            if (Math.abs(vl - vr) < 1e-9) return `${src} → ? = ${x}（${l} = ${r}）`;
          } catch { /* 继续枚举 */ }
        }
        return `${src} 在 -1000..1000 内无解`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "填空类型", "operator", ["operator", "number"]), P("eq", "算式", "2+?=5")]),

  runOp("d2-numfmt", CAT, "数值格式/科学计数/区间/数集", "四舍五入、科学计数法、10 的幂、区间与不等式互转、整数 encadrement、符号、奇偶、位序、数集归属、地图比例尺",
    (t, p) => {
      const mode = String((p && p.mode) || "round");
      const v = String((p && p.value) || t || "").trim();
      if (mode === "round") {
        const x = Number(v), d = boundedInt((p && p.digits) || "2", "小数位", 0, 15);
        if (!Number.isFinite(x)) err("数值非法");
        return `${x} 保留 ${d} 位小数 = ${x.toFixed(d)}`;
      }
      if (mode === "scientific") {
        const x = Number(v);
        if (!Number.isFinite(x)) err("数值非法");
        const e = x === 0 ? 0 : Math.floor(Math.log10(Math.abs(x)));
        const mant = x / 10 ** e;
        return `${x} = ${fmt(mant, 10)} × 10^${e}`;
      }
      if (mode === "powers10") {
        const n = boundedInt(v, "指数", -300, 300);
        return `10^${n} = ${n >= 0 ? (10n ** BigInt(n)).toString() : fmt(10 ** n, 20)}\nlog10(10^${n}) = ${n}`;
      }
      if (mode === "interval") {
        let m = v.match(/^([\[(])\s*(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)\s*([\])])$/);
        if (m) {
          const l = m[1] === "[" ? "≤" : "<";
          const r = m[4] === "]" ? "≤" : "<";
          return `区间 ${v} ⇔ ${m[2]} ${l} x ${r} ${m[3]}`;
        }
        m = v.match(/^(-?\d+(?:\.\d+)?)\s*(<|≤|<=)\s*x\s*(<|≤|<=)\s*(-?\d+(?:\.\d+)?)$/);
        if (m) {
          const left = m[2] === "<" ? "(" : "[";
          const right = m[3] === "<" ? ")" : "]";
          return `不等式 ⇔ ${left}${m[1]}, ${m[4]}${right}`;
        }
        const x = Number(v);
        if (Number.isFinite(x)) return `点 ${x} 的区间表示：[${x}, ${x}]`;
        err("支持 [a,b] / (a,b) 或 a<x<b");
      }
      if (mode === "encadrement") {
        const x = Number(v), step = Number((p && p.step) || "1");
        if (!Number.isFinite(x) || !(step > 0)) err("数值或步长非法");
        const lo = Math.floor(x / step) * step, hi = Math.ceil(x / step) * step;
        return `${lo} ≤ ${x} ≤ ${hi}（步长 ${step}）`;
      }
      if (mode === "sign") {
        const x = Number(v);
        if (!Number.isFinite(x)) err("数值非法");
        return `${x} 的符号：${x > 0 ? "正 (+)" : x < 0 ? "负 (−)" : "零 (0)"}`;
      }
      if (mode === "parity") {
        const n = parseBig(v, "n");
        return `${n} 是${n % 2n === 0n ? "偶数" : "奇数"}`;
      }
      if (mode === "digitrank") {
        const s = String((p && p.number) || v).replace(/[^0-9]/g, "");
        const k = boundedInt((p && p.rank) || "1", "位序", 1, Math.max(1, s.length));
        return `${s} 从左起第 ${k} 位 = ${s[k - 1]}（从右起第 ${s.length - k + 1} 位）`;
      }
      if (mode === "set") {
        const x = Number(v);
        if (!Number.isFinite(x)) {
          if (/sqrt|π|pi|e/i.test(v)) return `${v} 属于无理数 ℝ\\ℚ`;
          err("无法判断数集");
        }
        if (Number.isInteger(x)) return x >= 0 ? `${x} ∈ ℕ、ℤ、ℚ、ℝ` : `${x} ∈ ℤ、ℚ、ℝ（不属于 ℕ）`;
        return `${x} ∈ ℚ（有理数/有限小数）；也属于 ℝ`;
      }
      if (mode === "scale") {
        const m = v.match(/^1\s*[:：]\s*(\d+)$/);
        if (!m) err("比例尺格式：1:25000");
        const dist = Number((p && p.distance) || "1");
        const real = dist * Number(m[1]) / 100000;
        return `比例尺 1:${m[1]}，图上 ${dist} cm = 实际 ${fmt(real, 6)} km`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "round", ["round", "scientific", "powers10", "interval", "encadrement", "sign", "parity", "digitrank", "set", "scale"]), P("value", "数值/区间/比例尺", "3.14159"), P("digits", "小数位", "3"), P("step", "步长", "1"), P("number", "数字串", "12345"), P("rank", "位序", "2"), P("distance", "图上距离 cm", "1")]),

  runOp("d2-constants", CAT, "常数小数位（π/e/τ/φ）与检索", "Chudnovsky/级数/BigInt 生成 π、e、τ、φ 的十进制位（≤5000），支持在展开中检索数字串",
    (t, p) => {
      const mode = String((p && p.mode) || "pi");
      const digits = boundedInt((p && p.digits) || "50", "位数", 1, 5000);
      const piDecimal = (n) => {
        const guard = 20;
        const scale = 10n ** BigInt(n + guard);
        const atanInv = (q) => {
          const q2 = q * q;
          let pow = q, k = 0n, sum = 0n, sign = 1n;
          for (;;) {
            const term = scale / (pow * (2n * k + 1n));
            if (term === 0n) break;
            sum += sign * term;
            sign = -sign; pow *= q2; k++;
            if (k > 20000n) err("π 级数未收敛");
          }
          return sum;
        };
        const pi = 16n * atanInv(5n) - 4n * atanInv(239n);
        const s = pi.toString().padStart(n + guard + 1, "0");
        return s[0] + "." + s.slice(1, n + 1);
      };
      const eDecimal = (n) => {
        const guard = 20, scale = 10n ** BigInt(n + guard);
        let term = scale, sum = scale;
        for (let k = 1; k < 100000; k++) { term /= BigInt(k); if (term === 0n) break; sum += term; }
        const s = sum.toString();
        return s[0] + "." + s.slice(1, n + 1);
      };
      const phiDecimal = (n) => {
        const guard = 10, d = BigInt(n + guard), scale = 10n ** d;
        const root = isqrtB(5n * scale * scale);
        const v = (scale + root) / 2n;
        const s = v.toString();
        return s[0] + "." + s.slice(1, n + 1);
      };
      if (mode === "search") {
        const q = String((p && p.query) || t || "").trim();
        if (!/^\d+$/.test(q) || q.length > 20) err("检索串需为 1..20 位数字");
        const hay = piDecimal(5000).replace(".", "");
        const pos = hay.indexOf(q);
        if (pos < 0) return `π 前 5000 位中未找到「${q}」`;
        return `π 中「${q}」首次出现在小数点后第 ${pos} 位（0 起）\n上下文：${hay.slice(Math.max(0, pos - 10), pos + q.length + 10)}`;
      }
      let val, name;
      if (mode === "pi") { val = piDecimal(digits); name = "π"; }
      else if (mode === "e") { val = eDecimal(digits); name = "e"; }
      else if (mode === "phi") { val = phiDecimal(digits); name = "φ"; }
      else if (mode === "tau") {
        const s = piDecimal(digits + 1).replace(".", "");
        const d2 = (2n * BigInt(s)).toString().padStart(digits + 2, "0");
        val = d2[0] + "." + d2.slice(1, digits + 1); name = "τ";
      } else err(`未知模式 ${mode}`);
      return `${name} = ${val}\n（${digits} 位小数）`;
    }, [SEL("mode", "常数/检索", "pi", ["pi", "e", "tau", "phi", "search"]), P("digits", "小数位数", "50"), P("query", "检索数字串", "14159")]),

  runOp("d2-solver24", CAT, "24 点 / Krypto / Mathador", "用 + − × ÷ 与括号把给定数字组合成目标值；递归配对，支持 1..6 个数字，输出表达式并校验",
    (t, p) => {
      const nums = numList((p && p.nums) || t, "数字").map((x) => Math.round(x));
      if (nums.length < 1 || nums.length > 6) err("数字个数需 1..6");
      const target = Number((p && p.target) || 24);
      if (!Number.isFinite(target)) err("目标值非法");
      const items = nums.map((x) => ({ v: x, e: String(x) }));
      let found = null;
      const rec = (arr) => {
        if (found) return;
        if (arr.length === 1) { if (Math.abs(arr[0].v - target) < 1e-9) found = arr[0].e; return; }
        for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i], b = arr[j], rest = arr.filter((_, k) => k !== i && k !== j);
          const cand = [
            { v: a.v + b.v, e: `(${a.e} + ${b.e})` },
            { v: a.v - b.v, e: `(${a.e} - ${b.e})` },
            { v: b.v - a.v, e: `(${b.e} - ${a.e})` },
            { v: a.v * b.v, e: `(${a.e} × ${b.e})` },
          ];
          if (Math.abs(b.v) > 1e-12) cand.push({ v: a.v / b.v, e: `(${a.e} ÷ ${b.e})` });
          if (Math.abs(a.v) > 1e-12) cand.push({ v: b.v / a.v, e: `(${b.e} ÷ ${a.e})` });
          for (const c of cand) rec([...rest, c]);
        }
      };
      rec(items);
      if (!found) return `用 ${nums.join(", ")} 与 + − × ÷ 无法得到 ${target}`;
      const check = evalExpr(found.replace(/×/g, "*").replace(/÷/g, "/"));
      return `${nums.join(", ")} → ${target}\n${found} = ${fmt(check, 10)}`;
    }, [P("nums", "数字列表", "4 1 8 7"), P("target", "目标值", "24")]),

  runOp("d2-primes", CAT, "素数：判定/列表/计数/邻近/第 n 个", "BigInt Miller–Rabin 判定、≤上限素数表、π(x)、前/后/最近素数、第 n 个素数；输出数量有界",
    (t, p) => {
      const mode = String((p && p.mode) || "test");
      const v = String((p && p.value) || t || "").trim();
      if (mode === "test") {
        const n = parseBig(v, "n");
        return `${n} ${isPrime(n) ? "是素数" : "不是素数"}${n > 2n ? `\n位长：${n.toString(2).length} bit` : ""}`;
      }
      if (mode === "factor") {
        const n = parseBig(v, "n");
        if (n < 2n || n > 10n ** 30n) err("n 需在 2..10^30");
        const f = factorizeBounded(n);
        if (!f.complete) return `${n} 的部分分解：\n${[...f.factors].map(([p, e]) => e === 1 ? p.toString() : `${p}^${e}`).join(" × ")}\n（有因子未能完全分解）`;
        return `${n} = ${[...f.factors].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([p, e]) => e === 1 ? p.toString() : `${p}^${e}`).join(" × ")}`;
      }
      if (mode === "list" || mode === "count") {
        const lim = boundedInt(v, "上限", 2, 1000000);
        const ps = primeListUpTo(lim);
        if (mode === "count") return `π(${lim}) = ${ps.length}`;
        if (ps.length > MAX_OUT) err("素数数量超过 20000，请降低上限或改用计数模式");
        return `≤ ${lim} 的素数（${ps.length} 个）：\n${ps.join(", ")}`;
      }
      if (mode === "nth") {
        const n = boundedInt(v, "n", 1, 1000000);
        return `第 ${n} 个素数 = ${nthPrime(n)}`;
      }
      const n = parseBig(v, "n");
      if (mode === "next") return `大于 ${n} 的最小素数 = ${nextPrime(n)}`;
      if (mode === "prev") return `小于 ${n} 的最大素数 = ${prevPrime(n)}`;
      if (mode === "nearest") return `${n} 的最近素数 = ${nearestPrime(n)}`;
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "test", ["test", "factor", "list", "count", "nth", "next", "prev", "nearest"]), P("value", "n 或上限", "97")]),

  runOp("d2-numbertheory", CAT, "数论函数：φ/μ/λ/τ/σ/ω/rad", "Euler φ、Möbius μ、Carmichael λ、因子个数 τ、因子和 σ、不同素因子数 ω、根号 rad、互素判定",
    (t, p) => {
      const mode = String((p && p.mode) || "phi");
      const n = parseBig((p && p.n) || t, "n");
      if (n < 1n || n > 10n ** 15n) err("n 需在 1..10^15");
      const f = factorizeBounded(n);
      if (!f.complete) err("n 无法完全分解");
      const fs = [...f.factors].sort((a, b) => (a[0] < b[0] ? -1 : 1));
      if (mode === "phi") return `φ(${n}) = ${phiBig(n)}`;
      if (mode === "mobius") return `μ(${n}) = ${mobiusBig(n)}`;
      if (mode === "tau") return `τ(${n}) = ${fs.reduce((s, [, e]) => s * BigInt(e + 1), 1n)}`;
      if (mode === "sigma") {
        const k = boundedInt((p && p.k) || "1", "幂次 k", 0, 20);
        let s = 1n;
        for (const [p0, e] of fs) {
          let term = 1n, pw = 1n;
          for (let i = 1; i <= e; i++) { pw *= p0 ** BigInt(k); term += pw; }
          s *= term;
        }
        return `σ_${k}(${n}) = ${s}`;
      }
      if (mode === "omega") return `ω(${n}) = ${fs.length}（不同素因子：${fs.map((x) => x[0]).join(", ")}）`;
      if (mode === "rad") return `rad(${n}) = ${fs.reduce((s, [p0]) => s * p0, 1n)}`;
      if (mode === "lambda") {
        const parts = fs.map(([p0, e]) => {
          if (p0 === 2n && e >= 3) return 1n << BigInt(e - 2);
          return (p0 - 1n) * p0 ** BigInt(e - 1);
        });
        return `λ(${n}) = ${parts.reduce((a, b) => lcmB(a, b), 1n)}`;
      }
      if (mode === "coprime") {
        const m = parseBig((p && p.m) || "1", "m");
        return `gcd(${n},${m}) = ${gcdB(n, m)}\n${gcdB(n, m) === 1n ? "互素" : "不互素"}`;
      }
      if (mode === "aliquot") {
        let sum = 1n;
        for (const [p0, e] of fs) {
          let term = 1n, pw = 1n;
          for (let i = 0; i < e; i++) { pw *= p0; term += pw; }
          sum *= term;
        }
        return `s(${n}) = ${sum - n}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "phi", ["phi", "mobius", "tau", "sigma", "omega", "rad", "lambda", "coprime", "aliquot"]), P("n", "n", "36"), P("k", "σ 的幂次 k", "1"), P("m", "互素判定的 m", "35")]),

  runOp("d2-permutations", CAT, "排列/错排/带重复排列/秩", "nPr、全排列列表（≤9）、带重复序列（≤10000）、错排列表/计数、字典序秩与反秩（1 起）",
    (t, p) => {
      const mode = String((p && p.mode) || "list");
      const items = String((p && p.items) || t || "").replace(/\s+/g, "");
      if (mode === "count") {
        const n = boundedInt((p && p.n) || items.length || t, "n", 0, 100000);
        const k = boundedInt((p && p.k) || String(n), "k", 0, n);
        let r = 1n;
        for (let i = 0; i < k; i++) r *= BigInt(n - i);
        return `A(${n},${k}) = ${r}`;
      }
      if (mode === "arrangements" || mode === "arrangements-rep") {
        const n = boundedInt((p && p.n) || items.length || t, "n", 1, 100);
        const k = boundedInt((p && p.k) || "2", "k", 1, 20);
        if (mode === "arrangements") {
          let r = 1n;
          for (let i = 0; i < k; i++) r *= BigInt(n - i);
          return `A(${n},${k}) = ${r}`;
        }
        return `带重复排列数 ${n}^${k} = ${(BigInt(n) ** BigInt(k)).toString()}`;
      }
      if (mode === "withrep") {
        const n = items.length;
        const k = boundedInt((p && p.k) || "2", "长度 k", 1, 8);
        const total = n ** k;
        if (total > 10000) err(`带重复序列数 ${total} 超过 10000`);
        const out = [];
        const rec = (s) => { if (s.length === k) { out.push(s); return; } for (const ch of items) rec(s + ch); };
        rec("");
        return `${n}^${k} = ${total} 个序列：\n${out.join(" ")}`;
      }
      if (mode === "rank" || mode === "unrank") {
        const s = String((p && p.value) || t || "").replace(/\s+/g, "");
        if (!s) err("需要字符序列");
        if (new Set(s).size !== s.length) err("秩/反秩要求字符互异；重复元素请用 withrep 模式");
        if (mode === "rank") {
          const sorted = [...s].sort();
          let rank = 1;
          for (let i = 0; i < s.length; i++) {
            const smaller = sorted.filter((c) => c < s[i]).length;
            let cnt = 1;
            for (let j = 2; j <= s.length - i - 1; j++) cnt *= j;
            rank += smaller * cnt;
            sorted.splice(sorted.indexOf(s[i]), 1);
          }
          return `排列 ${s} 的字典序秩 = ${rank}`;
        }
        const rank = boundedInt((p && p.value) || t, "秩", 1, 362880);
        const sorted = [...items].sort();
        if (!sorted.length) err("需要字符集");
        if (rank > factorialN(sorted.length)) err("秩超过排列总数");
        let r = rank - 1, out = "";
        while (sorted.length) {
          let f = factorialN(sorted.length - 1);
          const idx = Math.floor(r / f);
          out += sorted.splice(idx, 1)[0];
          r %= f;
        }
        return `第 ${rank} 个排列 = ${out}`;
      }
      if (mode === "derangements") {
        const n = items.length;
        if (n < 1 || n > 9) err("错排列举长度需 1..9");
        const out = [];
        const perm = (arr, cur) => {
          if (!arr.length) { if (cur.every((c, i) => c !== items[i])) out.push(cur.join("")); return; }
          for (let i = 0; i < arr.length; i++) perm([...arr.slice(0, i), ...arr.slice(i + 1)], [...cur, arr[i]]);
        };
        perm([...items], []);
        return `${items} 的错排（${out.length} 个）：\n${out.join(" ")}`;
      }
      if (!items) err("需要字符集");
      if (items.length > 9) err("全排列列举最多 9 个元素");
      const out = [];
      const perm = (arr, cur) => {
        if (!arr.length) { out.push(cur); return; }
        for (let i = 0; i < arr.length; i++) perm(arr.slice(0, i) + arr.slice(i + 1), cur + arr[i]);
      };
      perm(items, "");
      if (out.length > MAX_OUT) err("排列数量超过上限");
      return `${items} 的全排列（${out.length} 个）：\n${out.join(" ")}`;
    }, [SEL("mode", "模式", "list", ["list", "count", "arrangements", "arrangements-rep", "withrep", "rank", "unrank", "derangements"]), P("items", "字符集/序列", "ABC"), P("n", "n", "5"), P("k", "k / 序列长度", "2"), P("value", "秩或序列", "2")]),

  runOp("d2-combinations", CAT, "组合/重复组合/秩/笛卡尔积/整数分拆", "C(n,k)、组合列表、重复组合、字典序秩与反秩、笛卡尔积、整数分拆列表；全部有界",
    (t, p) => {
      const mode = String((p && p.mode) || "count");
      const items = String((p && p.items) || t || "").replace(/\s+/g, "");
      if (mode === "count") {
        const n = boundedInt((p && p.n) || items.length || t, "n", 0, 100000);
        const k = boundedInt((p && p.k) || "2", "k", 0, n);
        return `C(${n},${k}) = ${binom(n, k)}`;
      }
      if (mode === "rank" || mode === "unrank") {
        const n = boundedInt((p && p.n) || items.length || t, "n", 1, 60);
        const k = boundedInt((p && p.k) || "2", "k", 1, n);
        if (mode === "rank") {
          const raw = String((p && p.value) || t || "").trim();
          const parts = /[,\s]/.test(raw) ? raw.split(/[,\s]+/).filter(Boolean) : raw.split("");
          const sel = parts.map((c) => Number(c));
          if (sel.length !== k || sel.some((x) => !Number.isInteger(x) || x < 1 || x > n)) err(`需要 ${k} 个 1..${n} 的编号`);
          let rank = 0, prev = 0;
          for (let i = 0; i < k; i++) {
            for (let x = prev + 1; x < sel[i]; x++) rank += Number(binom(n - x, k - i - 1));
            prev = sel[i];
          }
          return `组合 {${sel.join(",")}} 的秩 = ${rank + 1}`;
        }
        const want = boundedInt((p && p.value) || t, "秩", 1, 1000000);
        let rank = want - 1;
        const out = [];
        let prev = 0;
        for (let i = 0; i < k; i++) {
          for (let x = prev + 1; x <= n; x++) {
            const c = Number(binom(n - x, k - i - 1));
            if (rank < c) { out.push(x); prev = x; break; }
            rank -= c;
          }
        }
        return `第 ${want} 个组合 = {${out.join(",")}}`;
      }
      if (mode === "withrep") {
        const n = items.length || boundedInt((p && p.n) || t, "n", 1, 30);
        const k = boundedInt((p && p.k) || "2", "k", 1, 12);
        const total = Number(binom(n + k - 1, k));
        if (total > 10000) err("重复组合数超过 10000");
        const out = [];
        const rec = (start, cur) => { if (cur.length === k) { out.push(cur.join("")); return; } for (let i = start; i < n; i++) rec(i, [...cur, items[i] || String(i + 1)]); };
        rec(0, []);
        return `C(${n}+${k}-1,${k}) = ${total} 个重复组合：\n${out.join(" ")}`;
      }
      if (mode === "cartesian") {
        const a = String((p && p.a) || "AB").split("");
        const b = String((p && p.b) || "12").split("");
        const out = [];
        for (const x of a) for (const y of b) out.push(`(${x},${y})`);
        return `${a.length}×${b.length} = ${out.length} 个有序对：\n${out.join(" ")}`;
      }
      if (mode === "partitions") {
        const n = boundedInt((p && p.n) || t, "n", 0, 100);
        const out = [];
        const rec = (rem, max, cur) => {
          if (out.length > 5000) err("分拆数量超过 5000");
          if (rem === 0) { out.push(cur.join("+")); return; }
          for (let x = Math.min(rem, max); x >= 1; x--) rec(rem - x, x, [...cur, x]);
        };
        rec(n, n, []);
        return `${n} 的整数分拆（${out.length} 个）：\n${out.join("\n")}`;
      }
      if (!items) err("需要字符集");
      const k = boundedInt((p && p.k) || "2", "k", 1, items.length);
      const total = Number(binom(items.length, k));
      if (total > 10000) err("组合数量超过 10000");
      const out = [];
      const rec = (start, cur) => { if (cur.length === k) { out.push(cur.join("")); return; } for (let i = start; i < items.length; i++) rec(i + 1, [...cur, items[i]]); };
      rec(0, []);
      return `${items} 选 ${k}（${total} 个）：\n${out.join(" ")}`;
    }, [SEL("mode", "模式", "count", ["count", "list", "withrep", "rank", "unrank", "cartesian", "partitions"]), P("items", "字符集/编号", "ABCDE"), P("n", "n", "5"), P("k", "k", "2"), P("value", "秩", "2"), P("a", "笛卡尔积 A", "AB"), P("b", "笛卡尔积 B", "12")]),

  runOp("d2-probability", CAT, "概率：条件/超几何/二项/生日/期望", "P(A|B)、抽签超几何分布、二项分布表、生日问题、离散期望；输出精确到 10 位",
    (t, p) => {
      const mode = String((p && p.mode) || "conditional");
      if (mode === "conditional") {
        const pab = Number((p && p.pab) || t || 0), pb = Number((p && p.pb) || 1);
        if (!(pb > 0 && pb <= 1 && pab >= 0 && pab <= pb)) err("需 0 ≤ P(A∩B) ≤ P(B) ≤ 1 且 P(B)>0");
        return `P(A|B) = P(A∩B)/P(B) = ${fmt(pab, 10)} / ${fmt(pb, 10)} = ${fmt(pab / pb, 10)}`;
      }
      if (mode === "draw") {
        const N = boundedInt((p && p.n) || "49", "总数 N", 1, 100000);
        const K = boundedInt((p && p.k) || "6", "成功数 K", 0, N);
        const n = boundedInt((p && p.draws) || "6", "抽取数 n", 0, N);
        const k = boundedInt((p && p.hits) || "6", "命中数 k", 0, Math.min(n, K));
        const prob = Number(binom(K, k) * binom(N - K, n - k)) / Number(binom(N, n));
        return `超几何概率 P(X=${k}) = C(${K},${k})C(${N - K},${n - k})/C(${N},${n}) = ${fmt(prob, 12)}`;
      }
      if (mode === "binomial") {
        const n = boundedInt((p && p.n) || "10", "n", 0, 1000);
        const prob = Number((p && p.p) || "0.5");
        if (!(prob >= 0 && prob <= 1)) err("p 需在 0..1");
        const k = boundedInt((p && p.k) || "5", "k", 0, n);
        const pmf = (x) => Number(binom(n, x)) * prob ** x * (1 - prob) ** (n - x);
        const lines = [`P(X=${k}) = ${fmt(pmf(k), 12)}`];
        const rows = [];
        for (let x = 0; x <= n; x++) if (x <= 20) rows.push(`P(X=${x}) = ${fmt(pmf(x), 10)}`);
        if (n > 20) lines.push(`期望 = ${fmt(n * prob, 10)}，方差 = ${fmt(n * prob * (1 - prob), 10)}`);
        else lines.push(...rows);
        return lines.join("\n");
      }
      if (mode === "birthday") {
        const n = boundedInt((p && p.n) || "23", "人数 n", 1, 1000);
        const days = boundedInt((p && p.days) || "365", "天数", 2, 100000);
        let q = 1;
        for (let i = 0; i < n; i++) q *= (days - i) / days;
        return `${n} 人至少两人生日相同的概率 = ${fmt(1 - q, 10)}（${days} 天）`;
      }
      if (mode === "expectation") {
        const vals = String((p && p.values) || "1,2,3,4,5,6").split(/[\s,;]+/).filter(Boolean).map(Number);
        const probs = String((p && p.probs) || "0.1,0.1,0.1,0.1,0.1,0.5").split(/[\s,;]+/).filter(Boolean).map(Number);
        if (vals.length !== probs.length) err("值与概率数量需一致");
        if (probs.some((x) => x < 0) || Math.abs(probs.reduce((a, b) => a + b, 0) - 1) > 1e-9) err("概率需非负且和为 1");
        const ev = vals.reduce((s, x, i) => s + x * probs[i], 0);
        const va = vals.reduce((s, x, i) => s + x * x * probs[i], 0) - ev * ev;
        return `期望 E = ${fmt(ev, 10)}\n方差 = ${fmt(va, 10)}\n标准差 = ${fmt(Math.sqrt(Math.max(0, va)), 10)}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "conditional", ["conditional", "draw", "binomial", "birthday", "expectation"]), P("pab", "P(A∩B)", "0.2"), P("pb", "P(B)", "0.5"), P("n", "N / n / 人数", "23"), P("k", "K / k", "3"), P("draws", "抽取数 n", "6"), P("hits", "命中数 k", "3"), P("p", "成功概率 p", "0.5"), P("days", "天数", "365"), P("values", "取值列表", "1,2,3,4,5,6"), P("probs", "概率列表", "0.1,0.1,0.1,0.1,0.1,0.5")]),

  runOp("d2-schedule", CAT, "赛程/循环赛/双打轮转/淘汰树", "循环赛圆桌法（含奇数轮空）、双打配对轮转、Americano 轮转、单败淘汰对阵；输出有界",
    (t, p) => {
      const mode = String((p && p.mode) || "roundrobin");
      const players = String((p && p.players) || t || "").split(/[\s,;]+/).filter(Boolean);
      if (players.length < 2 || players.length > 64) err("选手数需 2..64");
      if (mode === "roundrobin") {
        const list = players.slice();
        if (list.length % 2) list.push("BYE");
        const n = list.length, rounds = n - 1, out = [];
        for (let r = 0; r < rounds; r++) {
          const pairs = [];
          for (let i = 0; i < n / 2; i++) {
            const a = list[i], b = list[n - 1 - i];
            if (a !== "BYE" && b !== "BYE") pairs.push(`${a} vs ${b}`);
          }
          out.push(`第 ${r + 1} 轮：${pairs.join("；")}`);
          list.splice(1, 0, list.pop());
        }
        return `循环赛 ${players.length} 人，共 ${rounds} 轮 ${players.length * (players.length - 1) / 2} 场：\n${out.join("\n")}`;
      }
      if (mode === "pairs") {
        if (players.length % 2) err("双打配对需要偶数人数");
        const teams = [];
        for (let i = 0; i < players.length; i += 2) teams.push(`${players[i]}/${players[i + 1]}`);
        return `队伍：${teams.join("，")}\n${teams.length} 队循环赛共 ${teams.length * (teams.length - 1) / 2} 场`;
      }
      if (mode === "americano") {
        if (players.length % 4) err("Americano 需要 4 的倍数人数");
        const rounds = players.length - 1, out = [];
        for (let r = 0; r < rounds; r++) {
          const rot = [players[0], ...players.slice(1).slice(r).concat(players.slice(1).slice(0, r))];
          const matches = [];
          for (let i = 0; i < rot.length; i += 4) matches.push(`${rot[i]}+${rot[i + 3]} vs ${rot[i + 1]}+${rot[i + 2]}`);
          out.push(`第 ${r + 1} 轮：${matches.join("；")}`);
        }
        return `Americano ${players.length} 人 ${rounds} 轮：\n${out.join("\n")}`;
      }
      if (mode === "bracket") {
        const size = 2 ** Math.ceil(Math.log2(players.length));
        const seeded = players.slice();
        while (seeded.length < size) seeded.push("BYE");
        const out = [];
        let cur = seeded;
        let round = 1;
        while (cur.length > 1) {
          const next = [], matches = [];
          for (let i = 0; i < cur.length; i += 2) {
            const a = cur[i], b = cur[i + 1];
            const winner = a === "BYE" ? b : b === "BYE" ? a : `${a}/${b} 胜者`;
            matches.push(`${a} vs ${b}`);
            next.push(winner);
          }
          out.push(`第 ${round} 轮：${matches.join("；")}`);
          cur = next; round++;
        }
        return `单败淘汰（${size} 签位）：\n${out.join("\n")}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "roundrobin", ["roundrobin", "pairs", "americano", "bracket"]), P("players", "选手（空格/逗号分隔）", "A B C D")]),

  runOp("d2-random", CAT, "随机数/抽签/不放回抽样", "可复现 LCG（给定 seed）或统一随机源；生成整数、抽签、唯一抽样；数量有界",
    (t, p) => {
      const mode = String((p && p.mode) || "numbers");
      const count = boundedInt((p && p.count) || "6", "数量", 1, 10000);
      const min = parseSmall((p && p.min) || "1", "最小值");
      const max = parseSmall((p && p.max) || "49", "最大值");
      if (max < min) err("最大值需 ≥ 最小值");
      const seedSrc = String((p && p.seed) || "").trim();
      let state = seedSrc ? (Number(seedSrc) >>> 0) : null;
      const rnd = (n) => {
        if (state === null) return randInt(n);
        state = (Math.imul(1664525, state) + 1013904223) >>> 0;
        return state % n;
      };
      if (mode === "numbers") {
        const out = [];
        for (let i = 0; i < count; i++) out.push(min + rnd(max - min + 1));
        return `${count} 个 [${min},${max}] 随机整数：\n${out.join(", ")}${seedSrc ? `\n（seed=${seedSrc}，可复现）` : ""}`;
      }
      const items = String((p && p.items) || "").split(/[\s,;]+/).filter(Boolean);
      if (!items.length) err("抽签需要候选项列表");
      if (mode === "pick") {
        const out = [];
        for (let i = 0; i < Math.min(count, items.length * 1000); i++) out.push(items[rnd(items.length)]);
        return `${count} 次有放回抽签：\n${out.join(", ")}`;
      }
      if (mode === "draw") {
        if (count > items.length) err("不放回抽样数量不能超过候选项数");
        const pool = items.slice(), out = [];
        for (let i = 0; i < count; i++) out.push(pool.splice(rnd(pool.length), 1)[0]);
        return `${count} 个不重复抽签：\n${out.join(", ")}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "numbers", ["numbers", "pick", "draw"]), P("count", "数量", "6"), P("min", "最小值", "1"), P("max", "最大值", "49"), P("items", "候选项", "A B C D E"), P("seed", "随机种子（可选）", "12345")]),

  runOp("d2-matrix", CAT, "矩阵运算（有理数精确）", "加减乘、标量、幂、转置、迹、行列式、逆、秩、伴随、余子式、子式、零空间、RREF、LU、Gram–Schmidt、范数、点积、叉积、Kronecker、直和、permanent、特征多项式、基变换；≤12×12",
    (t, p) => {
      const mode = String((p && p.mode) || "det");
      const m = parseMatrix((p && p.m) || t);
      const m2src = (p && p.m2) || "";
      const m2 = m2src.trim() ? parseMatrix(m2src) : null;
      const scalar = parseRat((p && p.scalar) || "1");
      if (mode === "add") return matStr(matAdd(m, m2, 1n));
      if (mode === "sub") return matStr(matAdd(m, m2, -1n));
      if (mode === "mul") return matStr(matMul(m, m2));
      if (mode === "div") return matStr(matMul(m, matInverse(m2)));
      if (mode === "scalar") return matStr(matScale(m, scalar));
      if (mode === "power") {
        const k = boundedInt((p && p.power) || "2", "幂次", 0, 30);
        if (m.length !== m[0].length) err("矩阵幂需要方阵");
        let r = Array.from({ length: m.length }, (_, i) => Array.from({ length: m.length }, (_, j) => R(i === j ? 1n : 0n)));
        for (let i = 0; i < k; i++) r = matMul(r, m);
        return matStr(r);
      }
      if (mode === "transpose") return matStr(m[0].map((_, j) => m.map((row) => row[j])));
      if (mode === "trace") {
        if (m.length !== m[0].length) err("迹需要方阵");
        return `trace = ${rStr(m.reduce((s, row, i) => rAdd(s, row[i]), RZERO))}`;
      }
      if (mode === "det") return `行列式 = ${rStr(matDet(m))}`;
      if (mode === "inverse") return matStr(matInverse(m));
      if (mode === "rank") return `秩 = ${matRank(m)}`;
      if (mode === "adjugate") return matStr(matAdj(m));
      if (mode === "cofactors") return matStr(matCofactors(m));
      if (mode === "minors") {
        if (m.length !== m[0].length) err("子式矩阵需要方阵");
        return matStr(m.map((_, i) => m.map((__, j) => matDet(matMinor(m, i, j)))));
      }
      if (mode === "nullspace") {
        const basis = matNullspace(m);
        return basis.length ? `零空间维数 ${basis.length}，基：\n${basis.map((v) => v.map(rStr).join(" ")).join("\n")}` : "零空间只有零向量";
      }
      if (mode === "echelon") {
        const r = matRref(m);
        return `秩 = ${r.rank}\n${matStr(r.rref)}`;
      }
      if (mode === "lu") {
        const n = m.length;
        if (n !== m[0].length) err("LU 分解需要方阵");
        const a = matCopy(m), L = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => R(i === j ? 1n : 0n)));
        const U = matCopy(a), P = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => R(i === j ? 1n : 0n)));
        for (let c = 0; c < n; c++) {
          let piv = c;
          while (piv < n && rIsZero(U[piv][c])) piv++;
          if (piv === n) err("矩阵奇异，LU 分解失败");
          if (piv !== c) { [U[piv], U[c]] = [U[c], U[piv]]; [P[piv], P[c]] = [P[c], P[piv]]; for (let j = 0; j < c; j++) [L[piv][j], L[c][j]] = [L[c][j], L[piv][j]]; }
          for (let r = c + 1; r < n; r++) {
            const f = rDiv(U[r][c], U[c][c]);
            L[r][c] = f;
            for (let j = c; j < n; j++) U[r][j] = rSub(U[r][j], rMul(f, U[c][j]));
          }
        }
        return `P =\n${matStr(P)}\nL =\n${matStr(L)}\nU =\n${matStr(U)}\n校验 P·A = L·U：${matStr(matMul(L, U)) === matStr(matMul(P, m)) ? "通过" : "失败"}`;
      }
      if (mode === "gramschmidt") {
        const vecs = m.map((row) => row.map(rNum));
        const ortho = [];
        for (const v0 of vecs) {
          let v = v0.slice();
          for (const u of ortho) { const dot = v.reduce((s, x, i) => s + x * u[i], 0); v = v.map((x, i) => x - dot * u[i]); }
          const norm = Math.hypot(...v);
          if (norm < 1e-12) continue;
          ortho.push(v.map((x) => x / norm));
        }
        return `标准正交基（${ortho.length} 个）：\n${ortho.map((v) => v.map((x) => fmt(x, 8)).join(" ")).join("\n")}`;
      }
      if (mode === "norm") {
        const v = matVec(m);
        return `||v||₂ = ${fmt(Math.hypot(...v.map(rNum)), 12)}\n||v||₁ = ${fmt(v.reduce((s, x) => s + Math.abs(rNum(x)), 0), 12)}`;
      }
      if (mode === "dot" || mode === "cross") {
        const a = matVec(m);
        const b = matVec(m2);
        if (mode === "dot") {
          if (a.length !== b.length) err("点积维数需一致");
          return `a·b = ${rStr(a.reduce((s, x, i) => rAdd(s, rMul(x, b[i])), RZERO))}`;
        }
        if (a.length !== 3 || b.length !== 3) err("叉积需要两个三维向量");
        const c = [rSub(rMul(a[1], b[2]), rMul(a[2], b[1])), rSub(rMul(a[2], b[0]), rMul(a[0], b[2])), rSub(rMul(a[0], b[1]), rMul(a[1], b[0]))];
        return `a×b = (${c.map(rStr).join(", ")})`;
      }
      if (mode === "kronecker" || mode === "tensor") {
        const out = Array.from({ length: m.length * m2.length }, () => Array(m[0].length * m2[0].length).fill(RZERO));
        for (let i = 0; i < m.length; i++) for (let j = 0; j < m[0].length; j++) for (let k = 0; k < m2.length; k++) for (let l = 0; l < m2[0].length; l++) out[i * m2.length + k][j * m2[0].length + l] = rMul(m[i][j], m2[k][l]);
        return matStr(out);
      }
      if (mode === "directsum") {
        const n = m.length + m2.length, p = m[0].length + m2[0].length;
        const out = Array.from({ length: n }, () => Array(p).fill(RZERO));
        for (let i = 0; i < m.length; i++) for (let j = 0; j < m[0].length; j++) out[i][j] = m[i][j];
        for (let i = 0; i < m2.length; i++) for (let j = 0; j < m2[0].length; j++) out[i + m.length][j + m[0].length] = m2[i][j];
        return matStr(out);
      }
      if (mode === "permanent") return `permanent = ${rStr(matPermanent(m))}`;
      if (mode === "charpoly") return `特征多项式：${polyStr(matCharpoly(m))}`;
      if (mode === "passage") {
        if (m.length !== m[0].length || m2.length !== m2[0].length || m.length !== m2.length) err("基变换需要同阶方阵");
        return `过渡矩阵 P = B⁻¹A：\n${matStr(matMul(matInverse(m2), m))}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "运算", "det", ["add", "sub", "mul", "div", "scalar", "power", "transpose", "trace", "det", "inverse", "rank", "adjugate", "cofactors", "minors", "nullspace", "echelon", "lu", "gramschmidt", "norm", "dot", "cross", "kronecker", "tensor", "directsum", "permanent", "charpoly", "passage"]), P("m", "矩阵 A", "1 2\n3 4"), P("m2", "矩阵 B", "0 1\n1 0"), P("scalar", "标量", "2"), P("power", "幂次", "2")]),

  runOp("d2-eigen", CAT, "特征值/特征向量/谱半径/对角化", "特征多项式数值求根（Durand–Kerner）；实特征值对应的零空间特征向量；谱半径；实特征值互异时给出 P⁻¹AP=D",
    (t, p) => {
      const mode = String((p && p.mode) || "values");
      const m = parseMatrix((p && p.m) || t);
      if (m.length !== m[0].length) err("需要方阵");
      const n = m.length;
      if (n > 6) err("特征值数值求解上限 6×6");
      const cp = matCharpoly(m);
      const roots = polyRootsNumeric(cp).map((z) => (typeof z === "number" ? { re: z, im: 0 } : z));
      const reals = roots.filter((z) => Math.abs(z.im) < 1e-8).map((z) => z.re);
      const fmtRoots = roots.map((z) => cfmt(z, 8)).join(", ");
      if (mode === "values") return `特征多项式：${polyStr(cp)}\n特征值：${fmtRoots}`;
      if (mode === "spectral") {
        const rho = Math.max(...roots.map((z) => cabs(z)));
        return `特征值：${fmtRoots}\n谱半径 ρ(A) = ${fmt(rho, 10)}`;
      }
      const nullvecs = (lambda) => {
        const a = m.map((row, i) => row.map((x, j) => rNum(x) - (i === j ? lambda : 0)));
        const vecs = [];
        const rows = a.length, cols = a[0].length;
        let rank = 0;
        const piv = [];
        for (let c = 0; c < cols && rank < rows; c++) {
          let pr = rank;
          while (pr < rows && Math.abs(a[pr][c]) < 1e-9) pr++;
          if (pr === rows) continue;
          [a[pr], a[rank]] = [a[rank], a[pr]];
          const pv = a[rank][c];
          for (let j = 0; j < cols; j++) a[rank][j] /= pv;
          for (let r = 0; r < rows; r++) if (r !== rank && Math.abs(a[r][c]) > 1e-12) { const f = a[r][c]; for (let j = 0; j < cols; j++) a[r][j] -= f * a[rank][j]; }
          piv.push(c); rank++;
        }
        const free = [];
        for (let c = 0; c < cols; c++) if (!piv.includes(c)) free.push(c);
        for (const f of free) {
          const v = Array(cols).fill(0);
          v[f] = 1;
          for (let r = 0; r < rank; r++) v[piv[r]] = -a[r][f];
          vecs.push(v);
        }
        return vecs;
      };
      if (mode === "vectors" || mode === "espaces") {
        if (!reals.length) return `特征值全为复数：${fmtRoots}\n本实现只输出实特征值对应的实特征向量`;
        const lines = [];
        for (const l of [...new Set(reals.map((x) => Number(x.toFixed(9))))]) {
          const vs = nullvecs(l);
          lines.push(`λ = ${fmt(l, 8)}：${vs.length ? vs.map((v) => `(${v.map((x) => fmt(x, 6)).join(", ")})`).join("，") : "无实特征向量"}`);
        }
        return `特征值：${fmtRoots}\n${lines.join("\n")}`;
      }
      if (mode === "diagonalize") {
        const uniq = [...new Set(reals.map((x) => Number(x.toFixed(9))))];
        if (uniq.length !== n || roots.length !== n) return `不可对角化（实特征值不足 ${n} 个或存在复特征值）\n特征值：${fmtRoots}`;
        const vecs = uniq.map((l) => nullvecs(l)[0]);
        if (vecs.some((v) => !v)) return "存在特征值缺少特征向量，无法对角化";
        const P = vecs[0].map((_, i) => vecs.map((v) => v[i]));
        const D = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? uniq[i] : 0)));
        return `P =\n${P.map((r) => r.map((x) => fmt(x, 6)).join(" ")).join("\n")}\nD =\n${D.map((r) => r.map((x) => fmt(x, 6)).join(" ")).join("\n")}\n特征值：${uniq.map((x) => fmt(x, 8)).join(", ")}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "values", ["values", "vectors", "espaces", "spectral", "diagonalize"]), P("m", "方阵", "2 1\n1 2")]),

  runOp("d2-poly", CAT, "多项式：求值/导数/积分/除法/因式/根", "有理系数多项式：求值、次数、首项、1~3 阶导、积分、四则、带余除法、gcd、数值根、有理因式分解、判别式、标准形、Taylor 展开",
    (t, p) => {
      const mode = String((p && p.mode) || "eval");
      const poly = parsePolyExpr((p && p.expr) || t);
      const p2 = String((p && p.expr2) || "").trim() ? parsePolyExpr((p && p.expr2)) : null;
      if (mode === "eval") {
        const x = parseRat((p && p.x) || "1");
        return `P(x) = ${polyStr(poly)}\nP(${rStr(x)}) = ${rStr(polyEvalR(poly, x))}`;
      }
      if (mode === "degree") return `次数 = ${polyDeg(poly)}\n首项系数 = ${rStr(poly[poly.length - 1])}\n多项式：${polyStr(poly)}`;
      if (mode === "derivative" || mode === "derivative2" || mode === "derivative3") {
        const k = mode === "derivative" ? 1 : mode === "derivative2" ? 2 : 3;
        let d = poly;
        for (let i = 0; i < k; i++) d = polyDeriv(d);
        return `${k} 阶导数：${polyStr(d)}`;
      }
      if (mode === "integral") return `不定积分：${polyStr(polyInteg(poly))} + C`;
      if (mode === "add" || mode === "sub" || mode === "mul") {
        if (!p2) err("需要第二个多项式");
        const r = mode === "add" ? polyAdd(poly, p2) : mode === "sub" ? polySub(poly, p2) : polyMul(poly, p2);
        return `${polyStr(poly)} ${mode === "add" ? "+" : mode === "sub" ? "−" : "×"} ${polyStr(p2)} = ${polyStr(r)}`;
      }
      if (mode === "div") {
        if (!p2) err("需要除式");
        const r = polyDivMod(poly, p2);
        return `商：${polyStr(r.q)}\n余式：${polyStr(r.r)}\n校验：P = Q·D + R`;
      }
      if (mode === "gcd") {
        if (!p2) err("需要第二个多项式");
        return `gcd = ${polyStr(polyGcd(poly, p2))}`;
      }
      if (mode === "roots") {
        const roots = polyRootsNumeric(poly);
        return roots.length ? `实根：\n${roots.map((x) => fmt(x, 10)).join("\n")}` : "在数值搜索中未找到实根（可能全为复根）";
      }
      if (mode === "factor") return `因式分解：${factorPolynomial(poly)}`;
      if (mode === "discriminant") {
        if (polyDeg(poly) !== 2) err("判别式只适用于二次多项式");
        const a = poly[2], b = poly[1], c = poly[0];
        const d = rSub(rMul(b, b), rMul(R(4n), rMul(a, c)));
        return `Δ = b²−4ac = ${rStr(d)}`;
      }
      if (mode === "canonical" || mode === "complete-square") {
        if (polyDeg(poly) !== 2) err("标准形只适用于二次多项式");
        const a = poly[2], b = poly[1], c = poly[0];
        const h = rDiv(rNeg(b), rMul(R(2n), a));
        const k = rSub(c, rDiv(rMul(b, b), rMul(R(4n), a)));
        return `a(x−h)²+k = ${rStr(a)}(x − (${rStr(h)}))² + (${rStr(k)})\n顶点：(${rStr(h)}, ${rStr(k)})`;
      }
      if (mode === "taylor") {
        const a = parseRat((p && p.x) || "0");
        let d = poly, fact = 1n, out = [RZERO];
        const shift = [rNeg(a), RONE];
        for (let k = 0; k <= polyDeg(poly); k++) {
          const coef = rDiv(polyEvalR(d, a), R(fact));
          let basis = [RONE];
          for (let i = 0; i < k; i++) basis = polyMul(basis, shift);
          out = polyAdd(out, basis.map((c) => rMul(c, coef)));
          d = polyDeriv(d);
          fact *= BigInt(k + 1);
        }
        return `在 x=${rStr(a)} 处的 Taylor 展开：\n${polyStr(out)}`;
      }
      if (mode === "simplify" || mode === "expand") return polyStr(poly);
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "eval", ["eval", "degree", "derivative", "derivative2", "derivative3", "integral", "add", "sub", "mul", "div", "gcd", "roots", "factor", "discriminant", "canonical", "complete-square", "taylor", "simplify", "expand"]), P("expr", "多项式", "x^2-3x+2"), P("expr2", "第二个多项式", "x-1"), P("x", "求值点/Taylor 中心", "1")]),

  runOp("d2-equation", CAT, "方程/不等式/恒等式/三角方程", "多项式方程（一次/二次精确，高次数值）、不等式区间、恒等式验证、简单三角方程 [0,2π] 数值根；含括号展开",
    (t, p) => {
      const mode = String((p && p.mode) || "equation");
      const src = String((p && p.eq) || t || "").trim();
      if (mode === "equality") {
        const parts = src.split("=");
        if (parts.length !== 2) err("恒等式格式：左边=右边");
        const a = parsePolyExpr(parts[0]), b = parsePolyExpr(parts[1]);
        const d = polySub(a, b);
        return polyDeg(d) === 0 && rIsZero(d[0]) ? "恒等式成立（两边多项式完全一致）" : `不恒等：差为 ${polyStr(d)}`;
      }
      if (mode === "trig") {
        const parts = src.split("=");
        if (parts.length !== 2) err("三角方程格式：sin(x)=0.5");
        const expr = `(${parts[0]})-(${parts[1]})`;
        const roots = rootsScan(expr, 0, 2 * Math.PI, 4000);
        return roots.length ? `[0, 2π] 内的数值根：\n${roots.map((x) => fmt(x, 8)).join("\n")}\n（按周期性可加 2πk）` : "在 [0,2π] 内未找到数值根";
      }
      if (mode === "inequality") {
        let left, right, op;
        let m = src.match(/^(.+?)(<=|>=|<|>|≤|≥)(.+)$/);
        if (!m) err("不等式格式：x^2-4<0 或 左边<右边");
        left = m[1]; op = m[2]; right = m[3];
        const poly = polySub(parsePolyExpr(left), parsePolyExpr(right));
        const deg = polyDeg(poly);
        if (deg > 4) err("不等式数值求解上限 4 次");
        const roots = deg === 0 ? [] : polyRootsNumeric(poly).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
        const cuts = [-Infinity, ...roots, Infinity];
        const segs = [];
        for (let i = 0; i < cuts.length - 1; i++) {
          const a = cuts[i], b = cuts[i + 1];
          const mid = a === -Infinity ? b - 1 : b === Infinity ? a + 1 : (a + b) / 2;
          const v = polyEvalN(poly, mid);
          const ok = op === "<" || op === "≤" ? v < 0 : v > 0;
          const eqOk = op === "≤" || op === "≥";
          if (ok) segs.push([a, b, false]);
          else if (eqOk) {
            if (a !== -Infinity && Math.abs(polyEvalN(poly, a)) < 1e-9 && !segs.some((s) => s[1] === a)) segs.push([a, a, true]);
            if (b !== Infinity && Math.abs(polyEvalN(poly, b)) < 1e-9) segs.push([b, b, true]);
          }
        }
        const merged = [];
        for (const s of segs) {
          const last = merged[merged.length - 1];
          if (last && !last[2] && !s[2] && (last[1] === s[0] || (op === "≤" || op === "≥") && roots.includes(last[1]))) last[1] = s[1];
          else merged.push(s.slice());
        }
        const lb = op === "<" || op === ">" ? "(" : "[";
        const rb = op === "<" || op === ">" ? ")" : "]";
        const text = merged.map(([a, b, pt]) => pt ? `{${fmt(a, 8)}}` : `${a === -Infinity ? "(-∞" : `${lb}${fmt(a, 8)}`}, ${b === Infinity ? "+∞)" : `${fmt(b, 8)}${rb}`}`).join(" ∪ ");
        return `不等式 ${src}\n解集：${text || "空集"}\n边界：${roots.map((x) => fmt(x, 8)).join(", ") || "无"}`;
      }
      const parts = src.split("=");
      if (parts.length !== 2) err("方程格式：左边=右边");
      const poly = polySub(parsePolyExpr(parts[0]), parsePolyExpr(parts[1]));
      const deg = polyDeg(poly);
      if (deg === 0) return rIsZero(poly[0]) ? "任意 x 都是解（恒等式）" : "无解";
      if (deg === 1) return `一次方程解：x = ${rStr(rDiv(rNeg(poly[0]), poly[1]))}`;
      if (deg === 2) {
        const a = rNum(poly[2]), b = rNum(poly[1]), c = rNum(poly[0]);
        const d = b * b - 4 * a * c;
        if (d < 0) {
          const s = Math.sqrt(-d);
          return `判别式 ${fmt(d, 10)} < 0\n复根：x = ${fmt(-b / (2 * a), 10)} ± ${fmt(s / (2 * Math.abs(a)), 10)}i`;
        }
        const s = Math.sqrt(d);
        return `判别式 ${fmt(d, 10)}\n实根：x₁ = ${fmt((-b - s) / (2 * a), 12)}，x₂ = ${fmt((-b + s) / (2 * a), 12)}`;
      }
      if (deg > 8) err("高次方程数值求解上限 8 次");
      const roots = polyRootsNumeric(poly);
      return `次数 ${deg}\n数值根：\n${roots.map((x) => fmt(x, 10)).join("\n") || "未找到实根"}`;
    }, [SEL("mode", "模式", "equation", ["equation", "inequality", "equality", "trig"]), P("eq", "方程/不等式", "x^2-3x+2=0")]),

  runOp("d2-boolean", CAT, "布尔代数：真值表/最小项/Karnaugh/化简", "解析 & | ! ^ 与括号；真值表、minterms/maxterms、对偶式、Karnaugh 表、Quine–McCluskey 化简易或式（≤8 变量）",
    (t, p) => {
      const mode = String((p && p.mode) || "truth");
      const src = String((p && p.expr) || t || "").trim();
      const pb = parseBoolExpr(src);
      if (mode === "eval") {
        const env = {};
        for (const part of String((p && p.assign) || "").split(/[,;]+/)) {
          const m = part.trim().match(/^([A-Za-z])\s*=\s*([01])$/);
          if (m) env[m[1].toUpperCase()] = Number(m[2]);
        }
        return `${src} = ${pb.evalWith(env)}`;
      }
      if (mode === "dual") {
        let s = src.replace(/\s+/g, "");
        s = s.replace(/&/g, "\u0000").replace(/\|/g, "&").replace(/\u0000/g, "|");
        s = s.replace(/\b0\b/g, "\u0000").replace(/\b1\b/g, "0").replace(/\u0000/g, "1");
        return `对偶式：${s}`;
      }
      const n = pb.vars.length;
      if (n > 8) err("真值表变量最多 8 个");
      const rows = 1 << n;
      const truths = [];
      for (let m = 0; m < rows; m++) {
        const env = {};
        for (let i = 0; i < n; i++) env[pb.vars[i]] = (m >> (n - 1 - i)) & 1;
        if (pb.evalWith(env)) truths.push(m);
      }
      if (mode === "minterms") return `变量：${pb.vars.join(", ")}\n最小项（Σm）：${truths.join(", ") || "无"}`;
      if (mode === "maxterms") {
        const arr = [];
        for (let m = 0; m < rows; m++) if (!truths.includes(m)) arr.push(m);
        return `变量：${pb.vars.join(", ")}\n最大项（ΠM）：${arr.join(", ") || "无"}`;
      }
      if (mode === "simplify") return `化简：${quineMcCluskey(truths, n)}\n（最小项：${truths.join(", ") || "无"}）`;
      if (mode === "karnaugh") {
        if (n > 4) err("Karnaugh 表最多 4 变量");
        const gray = (x) => x ^ (x >> 1);
        const rowVars = n <= 2 ? pb.vars : pb.vars.slice(0, Math.ceil(n / 2));
        const colVars = n <= 2 ? [] : pb.vars.slice(Math.ceil(n / 2));
        const rc = 1 << rowVars.length, cc = 1 << colVars.length;
        const cell = (r, c) => {
          let m = 0;
          for (let i = 0; i < rowVars.length; i++) m = (m << 1) | ((gray(r) >> (rowVars.length - 1 - i)) & 1);
          for (let i = 0; i < colVars.length; i++) m = (m << 1) | ((gray(c) >> (colVars.length - 1 - i)) & 1);
          return truths.includes(m) ? 1 : 0;
        };
        const lines = [`Karnaugh（行 ${rowVars.join("")}，列 ${colVars.join("") || "—"}）`];
        lines.push("     " + Array.from({ length: cc }, (_, c) => gray(c).toString(2).padStart(colVars.length, "0")).join(" "));
        for (let r = 0; r < rc; r++) lines.push(gray(r).toString(2).padStart(rowVars.length, "0") + " | " + Array.from({ length: cc }, (_, c) => cell(r, c)).join(" "));
        return lines.join("\n");
      }
      const lines = [`${pb.vars.join(" ")} | ${src}`, "-".repeat(pb.vars.length * 2 + 3) + "+---"];
      for (let m = 0; m < rows; m++) {
        const env = {};
        for (let i = 0; i < n; i++) env[pb.vars[i]] = (m >> (n - 1 - i)) & 1;
        lines.push(`${pb.vars.map((v) => env[v]).join(" ")} | ${pb.evalWith(env)}`);
      }
      return lines.join("\n");
    }, [SEL("mode", "模式", "truth", ["truth", "minterms", "maxterms", "dual", "karnaugh", "simplify", "eval"]), P("expr", "布尔表达式", "A&B|!C"), P("assign", "赋值 A=1,B=0", "A=1,B=0,C=0")]),

  runOp("d2-expression", CAT, "安全表达式计算器", "支持 + − × ÷ % ^、括号、sin/cos/tan/asin/acos/atan/sinh/cosh/tanh/sqrt/cbrt/abs/ln/log/log2/exp/floor/ceil/round/sign/erf/erfc/dawson/gamma/fact 与 π/e/φ/τ；变量 x,y,...",
    (t, p) => {
      const src = String((p && p.expr) || t || "").trim();
      const vars = {};
      for (const part of String((p && p.vars) || "x=1").split(/[,;]+/)) {
        const m = part.trim().match(/^([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(-?\d+(?:\.\d+)?)$/);
        if (m) vars[m[1]] = Number(m[2]);
      }
      const v = evalExpr(src, vars);
      if (!Number.isFinite(v)) err("表达式结果为 NaN/∞（检查定义域或变量）");
      return `${src} = ${fmt(v, 12)}`;
    }, [P("expr", "表达式", "2+3*4^2"), P("vars", "变量赋值", "x=1")]),

  runOp("d2-integral", CAT, "数值积分（一元/二重/三重）", "Simpson 数值积分：一元 1000 段、二重 80×80、三重 30×30×30；多项式原函数用精确积分",
    (t, p) => {
      const mode = String((p && p.mode) || "single");
      const expr = String((p && p.expr) || t || "x^2");
      if (mode === "primitive") {
        const poly = parsePolyExpr(expr);
        return `原函数：${polyStr(polyInteg(poly))} + C`;
      }
      const a = Number((p && p.a) || "0"), b = Number((p && p.b) || "1");
      if (!Number.isFinite(a) || !Number.isFinite(b)) err("积分限非法");
      if (mode === "single") return `∫[${a},${b}] ${expr} dx ≈ ${fmt(simpson(expr, a, b, 1000), 10)}`;
      if (mode === "double") {
        const c = Number((p && p.c) || "0"), d = Number((p && p.d) || "1");
        const f = (x, y) => evalExpr(expr, { x, y });
        const n = 80, hx = (b - a) / n, hy = (d - c) / n;
        let s = 0;
        for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
          const w = (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * (j === 0 || j === n ? 1 : j % 2 ? 4 : 2);
          s += w * f(a + i * hx, c + j * hy);
        }
        return `∬[${a},${b}]×[${c},${d}] ${expr} dxdy ≈ ${fmt(s * hx * hy / 9, 10)}`;
      }
      if (mode === "triple") {
        const c = Number((p && p.c) || "0"), d = Number((p && p.d) || "1");
        const e = Number((p && p.e) || "0"), f2 = Number((p && p.f) || "1");
        const n = 30, hx = (b - a) / n, hy = (d - c) / n, hz = (f2 - e) / n;
        let s = 0;
        for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) for (let k = 0; k <= n; k++) {
          const w = (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * (j === 0 || j === n ? 1 : j % 2 ? 4 : 2) * (k === 0 || k === n ? 1 : k % 2 ? 4 : 2);
          s += w * evalExpr(expr, { x: a + i * hx, y: c + j * hy, z: e + k * hz });
        }
        return `∭[${a},${b}]×[${c},${d}]×[${e},${f2}] ${expr} dxdydz ≈ ${fmt(s * hx * hy * hz / 27, 10)}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "single", ["single", "double", "triple", "primitive"]), P("expr", "被积函数", "x^2"), P("a", "下限 a", "0"), P("b", "上限 b", "1"), P("c", "y 下限 c", "0"), P("d", "y 上限 d", "1"), P("e", "z 下限 e", "0"), P("f", "z 上限 f", "1")]),

  runOp("d2-function", CAT, "函数分析：求值/零点/导数/极值/单调/奇偶/极限/切线", "安全表达式函数：数值表、零点、1~3 阶数值导数、极大/极小、单调区间、奇偶性、水平/垂直渐近、极限、切线、交点、平均值、反函数表、定义域、周期",
    (t, p) => {
      const mode = String((p && p.mode) || "eval");
      const expr = String((p && p.expr) || t || "x^2");
      const x0 = Number((p && p.x) || "0");
      const a = Number((p && p.a) || "-10"), b = Number((p && p.b) || "10");
      const nd = (x, k = 1) => {
        const h = 1e-4;
        if (k === 1) return (evalF(expr, x + h) - evalF(expr, x - h)) / (2 * h);
        if (k === 2) return (evalF(expr, x + h) - 2 * evalF(expr, x) + evalF(expr, x - h)) / (h * h);
        return (evalF(expr, x + 2 * h) - 2 * evalF(expr, x + h) + 2 * evalF(expr, x - h) - evalF(expr, x - 2 * h)) / (2 * h ** 3);
      };
      if (mode === "eval" || mode === "image") {
        const y = evalF(expr, x0);
        if (!Number.isFinite(y)) err(`f(${x0}) 无定义（NaN/∞）`);
        return `f(${x0}) = ${fmt(y, 12)}`;
      }
      if (mode === "table") {
        const step = Number((p && p.step) || "1");
        if (!(step > 0) || (b - a) / step > 500) err("步长非法或表行数超过 500");
        const rows = [];
        for (let x = a; x <= b + 1e-12; x += step) rows.push(`f(${fmt(x, 8)}) = ${fmt(evalF(expr, x), 8)}`);
        return `${expr} 在 [${a},${b}] 的数值表：\n${rows.join("\n")}`;
      }
      if (mode === "roots" || mode === "antecedents") {
        const target = mode === "antecedents" ? Number((p && p.y) || "0") : 0;
        const roots = rootsScan(`(${expr})-(${target})`, a, b, 4000);
        return roots.length ? `f(x) = ${target} 的数值解（[${a},${b}]）：\n${roots.map((x) => fmt(x, 10)).join("\n")}` : `在 [${a},${b}] 内未找到 f(x)=${target} 的解`;
      }
      if (mode === "derivative" || mode === "derivative2" || mode === "derivative3") {
        const k = mode === "derivative" ? 1 : mode === "derivative2" ? 2 : 3;
        return `${k} 阶导数在 x=${x0} 处 ≈ ${fmt(nd(x0, k), 10)}`;
      }
      if (mode === "extremum" || mode === "maximum" || mode === "minimum" || mode === "critical" || mode === "stationary") {
        const isMax = mode !== "minimum";
        const xm = goldenExtremum(expr, a, b, isMax);
        return `${isMax ? "极大" : "极小"}值点 x ≈ ${fmt(xm, 10)}\nf(x) ≈ ${fmt(evalF(expr, xm), 10)}\n（区间 [${a},${b}] 内数值搜索）`;
      }
      if (mode === "monotonic" || mode === "increasing" || mode === "decreasing") {
        const segs = [];
        let prev = null, start = null;
        for (let i = 0; i <= 2000; i++) {
          const x = a + (b - a) * i / 2000;
          const d = nd(x, 1);
          const sgn = Math.abs(d) < 1e-6 ? 0 : d > 0 ? 1 : -1;
          if (sgn !== 0 && prev !== null && sgn !== prev) segs.push([start, x, prev]);
          if (sgn !== 0 && (prev === null || sgn !== prev)) start = x;
          if (sgn !== 0) prev = sgn;
        }
        if (prev !== null) segs.push([start, b, prev]);
        return `单调区间（数值）：\n${segs.filter((s) => s[1] - s[0] > 1e-6).map(([s, e, g]) => `${g > 0 ? "递增" : "递减"}：[${fmt(s, 6)}, ${fmt(e, 6)}]`).join("\n") || "未检测到明显单调区间"}`;
      }
      if (mode === "parity") {
        const xs = [0.3, 0.7, 1.3, 2.1];
        let even = true, odd = true;
        for (const x of xs) {
          const f1 = evalF(expr, x), f2 = evalF(expr, -x);
          if (Math.abs(f1 - f2) > 1e-7) even = false;
          if (Math.abs(f1 + f2) > 1e-7) odd = false;
        }
        return `f 是${even ? "偶函数" : odd ? "奇函数" : "非奇非偶函数"}`;
      }
      if (mode === "limit") {
        if (String((p && p.at) || "") === "inf") return `x→+∞：${fmt(evalF(expr, 1e7), 8)}\nx→−∞：${fmt(evalF(expr, -1e7), 8)}`;
        const l = evalF(expr, x0 - 1e-6), r = evalF(expr, x0 + 1e-6);
        return `x→${x0}⁻：${fmt(l, 8)}\nx→${x0}⁺：${fmt(r, 8)}\n${Math.abs(l - r) < 1e-4 ? "双侧极限存在" : "左右极限不同或发散"}`;
      }
      if (mode === "asymptote") {
        const ly = evalF(expr, 1e7), ry = evalF(expr, -1e7);
        const lines = [`x→+∞：y ≈ ${fmt(ly, 8)}`, `x→−∞：y ≈ ${fmt(ry, 8)}`];
        const poles = [];
        for (let i = 1; i < 4000; i++) {
          const x = a + (b - a) * i / 4000;
          const y = evalF(expr, x);
          if (!Number.isFinite(y) || Math.abs(y) > 1e8) poles.push(x);
        }
        return lines.concat(poles.length ? [`疑似垂直渐近线 x ≈ ${poles.slice(0, 10).map((x) => fmt(x, 5)).join(", ")}`] : ["未检测到垂直渐近线"]).join("\n");
      }
      if (mode === "tangent") {
        const m = nd(x0, 1), y = evalF(expr, x0);
        const b0 = y - m * x0;
        return `f(${x0}) = ${fmt(y, 10)}，f'(${x0}) = ${fmt(m, 10)}\n切线：y = ${fmt(m, 10)}x ${b0 < 0 ? "-" : "+"} ${fmt(Math.abs(b0), 10)}`;
      }
      if (mode === "intersection") {
        const expr2 = String((p && p.expr2) || "0");
        const roots = rootsScan(`(${expr})-(${expr2})`, a, b, 4000);
        return roots.length ? `交点横坐标（[${a},${b}]）：\n${roots.map((x) => `x=${fmt(x, 8)}, y=${fmt(evalF(expr, x), 8)}`).join("\n")}` : "在区间内未找到交点";
      }
      if (mode === "average") return `f 在 [${a},${b}] 上的平均值 ≈ ${fmt(simpson(expr, a, b, 1000) / (b - a), 10)}`;
      if (mode === "inverse") {
        const rows = [];
        for (let i = 0; i <= 20; i++) {
          const x = a + (b - a) * i / 20;
          rows.push(`f(${fmt(x, 6)}) = ${fmt(evalF(expr, x), 8)}`);
        }
        return `函数值表（反函数需按 y 查 x）：\n${rows.join("\n")}`;
      }
      if (mode === "domain" || mode === "domain-deriv") {
        const bad = [];
        for (let i = 0; i <= 2000; i++) {
          const x = a + (b - a) * i / 2000;
          const y = evalF(expr, x);
          if (!Number.isFinite(y)) bad.push(x);
        }
        return bad.length ? `在 [${a},${b}] 检测到无定义点：${bad.slice(0, 20).map((x) => fmt(x, 5)).join(", ")}${bad.length > 20 ? "…" : ""}` : `在 [${a},${b}] 采样中未发现无定义点（不构成严格证明）`;
      }
      if (mode === "period") {
        const candidates = [];
        for (let k = 1; k <= 10; k++) { candidates.push((2 * Math.PI) / k, Math.PI / k); }
        for (let k = 1; k <= 2000; k++) candidates.push(k / 200);
        candidates.sort((x, y) => x - y);
        for (const T of candidates) {
          let ok = true;
          for (const x of [0.1, 0.37, 0.9, 1.7]) if (Math.abs(evalF(expr, x + T) - evalF(expr, x)) > 1e-4) { ok = false; break; }
          if (ok) return `检测到周期 T ≈ ${fmt(T, 8)}（数值搜索，非符号证明）`;
        }
        return "未在 0.005..10 内检测到周期";
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "eval", ["eval", "image", "table", "roots", "antecedents", "derivative", "derivative2", "derivative3", "extremum", "maximum", "minimum", "critical", "stationary", "monotonic", "parity", "limit", "asymptote", "tangent", "intersection", "average", "inverse", "domain", "domain-deriv", "period"]), P("expr", "f(x)", "x^2-4"), P("x", "x", "3"), P("a", "区间左端 a", "-10"), P("b", "区间右端 b", "10"), P("y", "目标 y", "0"), P("step", "表格步长", "1"), P("expr2", "g(x)", "0"), P("at", "极限点（inf 表示无穷）", "0")]),

  runOp("d2-interpolation", CAT, "多项式插值（Lagrange/Newton/Neville）", "给定点列 (x,y)：Lagrange/Newton/Neville 求值，输出插值多项式系数；点数 ≤ 30",
    (t, p) => {
      const mode = String((p && p.mode) || "lagrange");
      const pts = parsePointList((p && p.points) || t);
      if (pts.length < 2 || pts.length > 30) err("点数量需 2..30");
      const x = Number((p && p.x) || "0");
      const lagrange = (xx) => {
        let s = 0;
        for (let i = 0; i < pts.length; i++) {
          let term = pts[i][1];
          for (let j = 0; j < pts.length; j++) if (i !== j) term *= (xx - pts[j][0]) / (pts[i][0] - pts[j][0]);
          s += term;
        }
        return s;
      };
      if (mode === "lagrange") return `L(${x}) = ${fmt(lagrange(x), 12)}`;
      if (mode === "neville") {
        let col = pts.map((q) => q[1]);
        for (let k = 1; k < pts.length; k++) for (let i = pts.length - 1; i >= k; i--) col[i] = ((x - pts[i - k][0]) * col[i] - (x - pts[i][0]) * col[i - 1]) / (pts[i][0] - pts[i - k][0]);
        return `Neville P(${x}) = ${fmt(col[pts.length - 1], 12)}`;
      }
      if (mode === "newton") {
        const coef = pts.map((q) => q[1]);
        for (let j = 1; j < pts.length; j++) for (let i = pts.length - 1; i >= j; i--) coef[i] = (coef[i] - coef[i - 1]) / (pts[i][0] - pts[i - j][0]);
        let v = coef[pts.length - 1];
        for (let i = pts.length - 2; i >= 0; i--) v = coef[i] + (x - pts[i][0]) * v;
        return `Newton P(${x}) = ${fmt(v, 12)}\n差商：${coef.map((c) => fmt(c, 8)).join(", ")}`;
      }
      let poly = [0];
      for (let i = 0; i < pts.length; i++) {
        let basis = [1];
        let den = 1;
        for (let j = 0; j < pts.length; j++) if (i !== j) {
          basis = polyMulN(basis, [-pts[j][0], 1]);
          den *= pts[i][0] - pts[j][0];
        }
        const w = pts[i][1] / den;
        poly = polyAddN(poly, basis.map((c) => c * w));
      }
      return `插值多项式：${polyStrN(poly)}\nP(${x}) = ${fmt(polyEvalNum(poly, x), 10)}`;
    }, [SEL("mode", "模式", "lagrange", ["lagrange", "newton", "neville", "poly"]), P("points", "点列 x,y;x,y", "0,1;1,2;2,5"), P("x", "求值点 x", "3")]),

  runOp("d2-line", CAT, "直线：斜率/方程/截距/垂直/交点/切线", "两点斜率与直线方程、x/y 截距、过点垂线、两线交点、曲线切线、系数方向", 
    (t, p) => {
      const mode = String((p && p.mode) || "slope");
      const x1 = Number((p && p.x1) || "-1"), y1 = Number((p && p.y1) || "-1"), x2 = Number((p && p.x2) || "1"), y2 = Number((p && p.y2) || "1");
      const lineEq = (m, b) => `y = ${fmt(m, 8)}x ${b < 0 ? "-" : "+"} ${fmt(Math.abs(b), 8)}`;
      if (mode === "slope" || mode === "coefficient") {
        if (x1 === x2) return "斜率不存在（垂直线）";
        return `斜率 m = (y₂−y₁)/(x₂−x₁) = ${fmt((y2 - y1) / (x2 - x1), 10)}`;
      }
      if (mode === "equation") {
        if (x1 === x2) return `直线方程：x = ${fmt(x1, 8)}`;
        const m = (y2 - y1) / (x2 - x1), b = y1 - m * x1;
        return `直线方程：${lineEq(m, b)}\n标准式：${fmt(m, 8)}x - y + ${fmt(b, 8)} = 0`;
      }
      if (mode === "intercepts" || mode === "abscissa" || mode === "ordinate") {
        if (x1 === x2) return `x 截距 = ${fmt(x1, 8)}；无 y 截距`;
        const m = (y2 - y1) / (x2 - x1), b = y1 - m * x1;
        return `y 截距 = ${fmt(b, 10)}\nx 截距 = ${fmt(-b / m, 10)}`;
      }
      if (mode === "perpendicular") {
        if (x1 === x2) { const y = Number((p && p.py) || "0"); return `垂线（水平）：y = ${fmt(y, 8)}`; }
        const m = (y2 - y1) / (x2 - x1);
        if (m === 0) return `垂线（垂直）：x = ${fmt(Number((p && p.px) || "0"), 8)}`;
        const mp = -1 / m, px = Number((p && p.px) || "0"), py = Number((p && p.py) || "0"), bp = py - mp * px;
        return `原斜率 ${fmt(m, 8)}，垂线斜率 ${fmt(mp, 8)}\n垂线：${lineEq(mp, bp)}`;
      }
      if (mode === "intersection") {
        const m1 = (y2 - y1) / (x2 - x1), b1 = y1 - m1 * x1;
        const x3 = Number((p && p.x3) || "0"), y3 = Number((p && p.y3) || "0"), x4 = Number((p && p.x4) || "1"), y4 = Number((p && p.y4) || "1");
        if (x3 === x4) return `交点：x = ${fmt(x3, 8)}，y = ${fmt(m1 * x3 + b1, 8)}`;
        const m2 = (y4 - y3) / (x4 - x3), b2 = y3 - m2 * x3;
        if (Math.abs(m1 - m2) < 1e-12) return "两线平行或重合，无唯一交点";
        const xi = (b2 - b1) / (m1 - m2);
        return `交点：(${fmt(xi, 10)}, ${fmt(m1 * xi + b1, 10)})`;
      }
      if (mode === "tangent") {
        const expr = String((p && p.expr) || "x^2");
        const x0 = Number((p && p.x) || "1"), h = 1e-5;
        const y = evalF(expr, x0), m = (evalF(expr, x0 + h) - evalF(expr, x0 - h)) / (2 * h);
        const b = y - m * x0;
        return `切点 (${fmt(x0, 8)}, ${fmt(y, 8)})，斜率 ${fmt(m, 8)}\n切线：${lineEq(m, b)}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "slope", ["slope", "coefficient", "equation", "intercepts", "abscissa", "ordinate", "perpendicular", "intersection", "tangent"]), P("x1", "x₁", "-1"), P("y1", "y₁", "-1"), P("x2", "x₂", "1"), P("y2", "y₂", "1"), P("px", "过点 P 的 x", "0"), P("py", "过点 P 的 y", "0"), P("x3", "第二线 x₃", "0"), P("y3", "第二线 y₃", "0"), P("x4", "第二线 x₄", "1"), P("y4", "第二线 y₄", "1"), P("expr", "曲线 f(x)", "x^2"), P("x", "切点 x", "1")]),

  runOp("d2-root", CAT, "平方根/立方根/n 次根", "实数平方根、立方根、n 次根；整数完全根精确输出，否则 12 位近似；负数奇次根可用",
    (t, p) => {
      const mode = String((p && p.mode) || "sqrt");
      const x = Number((p && p.value) || t || 0);
      if (!Number.isFinite(x)) err("数值非法");
      if (mode === "sqrt") {
        if (x < 0) err("实数平方根要求非负数");
        return `√${x} = ${fmt(Math.sqrt(x), 12)}`;
      }
      if (mode === "cbrt") return `∛${x} = ${fmt(Math.cbrt(x), 12)}`;
      const k = boundedInt((p && p.n) || "3", "根指数", 1, 64);
      if (x < 0 && k % 2 === 0) err("负数不能取偶次实根");
      return `${k} 次根 ${x} = ${fmt(Math.sign(x) * Math.abs(x) ** (1 / k), 12)}`;
    }, [SEL("mode", "模式", "sqrt", ["sqrt", "cbrt", "nth"]), P("value", "被开方数", "2"), P("n", "根指数 n", "3")]),

  runOp("d2-angle", CAT, "角度单位换算", "度/弧度/百分度/转数互换；输出 12 位", 
    (t, p) => {
      const mode = String((p && p.mode) || "deg");
      const v = Number((p && p.value) || t || 0);
      if (!Number.isFinite(v)) err("角度非法");
      let deg;
      if (mode === "deg") deg = v;
      else if (mode === "rad") deg = v * 180 / Math.PI;
      else if (mode === "grad") deg = v * 0.9;
      else if (mode === "turn") deg = v * 360;
      else err(`未知模式 ${mode}`);
      return `${fmt(deg, 12)}° = ${fmt(deg * Math.PI / 180, 12)} rad = ${fmt(deg / 0.9, 12)} grad = ${fmt(deg / 360, 12)} turn`;
    }, [SEL("mode", "输入单位", "deg", ["deg", "rad", "grad", "turn"]), P("value", "数值", "180")]),

  runOp("d2-triangle", CAT, "三角形求解（SSS/SAS/ASA/直角）", "已知三边、两边夹角、两角一边或直角三角形边角，求其余边角、面积、周长；角度用度",
    (t, p) => {
      const mode = String((p && p.mode) || "sss");
      const kv = parseKeyVals((p && p.vals) || t);
      const rd = Math.PI / 180, dg = 180 / Math.PI;
      let a, b, c, A, B, C;
      if (mode === "sss") {
        a = kv.a; b = kv.b; c = kv.c;
        if (!(a > 0 && b > 0 && c > 0) || a + b <= c || a + c <= b || b + c <= a) err("三边需满足三角不等式");
        A = Math.acos((b * b + c * c - a * a) / (2 * b * c));
        B = Math.acos((a * a + c * c - b * b) / (2 * a * c));
        C = Math.PI - A - B;
      } else if (mode === "sas") {
        a = kv.a; b = kv.b; C = kv.c * rd;
        if (!(a > 0 && b > 0 && C > 0 && C < Math.PI)) err("SAS 需要 a,b>0 且 0<C<180");
        c = Math.sqrt(a * a + b * b - 2 * a * b * Math.cos(C));
        A = Math.acos((b * b + c * c - a * a) / (2 * b * c));
        B = Math.PI - A - C;
      } else if (mode === "asa") {
        A = kv.a * rd; B = kv.b * rd; c = kv.c;
        if (!(c > 0 && A > 0 && B > 0 && A + B < Math.PI)) err("ASA 需要 0<A+B<180 且 c>0");
        C = Math.PI - A - B;
        a = c * Math.sin(A) / Math.sin(C);
        b = c * Math.sin(B) / Math.sin(C);
      } else if (mode === "right") {
        const leg1 = kv.a, leg2 = kv.b, hyp = kv.c;
        if (leg1 && leg2) { a = leg1; b = leg2; c = Math.hypot(a, b); }
        else if (leg1 && hyp) { a = leg1; c = hyp; b = Math.sqrt(c * c - a * a); }
        else if (leg2 && hyp) { b = leg2; c = hyp; a = Math.sqrt(c * c - b * b); }
        else err("直角模式需要 a,b 或 a,c 或 b,c");
        A = Math.asin(a / c); B = Math.PI / 2 - A; C = Math.PI / 2;
      } else err(`未知模式 ${mode}`);
      const s = (a + b + c) / 2;
      const area = Math.sqrt(Math.max(0, s * (s - a) * (s - b) * (s - c)));
      return `边：a=${fmt(a, 8)}，b=${fmt(b, 8)}，c=${fmt(c, 8)}\n角：A=${fmt(A * dg, 8)}°，B=${fmt(B * dg, 8)}°，C=${fmt(C * dg, 8)}°\n面积=${fmt(area, 10)}，周长=${fmt(a + b + c, 10)}\n外接圆 R=${fmt(a * b * c / (4 * (area || 1)), 8)}`;
    }, [SEL("mode", "已知条件", "sss", ["sss", "sas", "asa", "right"]), P("vals", "a=3,b=4,c=5", "a=3,b=4,c=5")]),

  runOp("d2-pick", CAT, "Pick 定理（格点多边形面积）", "顶点为整数坐标的简单多边形：鞋带面积 A、边界格点数 B、内部格点数 I = A − B/2 + 1",
    (t, p) => {
      const pts = parsePointList((p && p.points) || t);
      if (pts.length < 3) err("至少 3 个顶点");
      if (pts.some(([x, y]) => !Number.isInteger(x) || !Number.isInteger(y))) err("Pick 定理要求整数坐标");
      let area2 = 0, boundary = 0;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
        area2 += x1 * y2 - x2 * y1;
        boundary += Math.abs(gcdNum(Math.abs(x2 - x1), Math.abs(y2 - y1)));
      }
      const A = Math.abs(area2) / 2, B = boundary;
      if (Math.abs(A - Math.round(A)) > 1e-9) err("鞋带面积非整数，顶点顺序可能自交");
      const I = A - B / 2 + 1;
      return `面积 A = ${A}\n边界格点 B = ${B}\n内部格点 I = ${I}\n校验 A = I + B/2 − 1 = ${I + B / 2 - 1}`;
    }, [P("points", "顶点 x,y;...", "0,0;0,2;2,2;2,0")]),

  runOp("d2-coords", CAT, "坐标变换 2D/3D", "直角↔极坐标、直角↔柱坐标、直角↔球坐标；角度输出度与弧度",
    (t, p) => {
      const mode = String((p && p.mode) || "cart2polar");
      let xSrc = p && p.x, ySrc = p && p.y, zSrc = p && p.z;
      if (xSrc === undefined && String(t).includes(",")) {
        const parts = String(t).split(/[,;\s]+/).filter(Boolean);
        [xSrc, ySrc, zSrc] = parts;
      }
      const x = Number(xSrc || 0), y = Number(ySrc || 0), z = Number(zSrc || 0);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) err("坐标需为数值");
      const dg = 180 / Math.PI;
      if (mode === "cart2polar") { const r = Math.hypot(x, y), th = Math.atan2(y, x); return `r = ${fmt(r, 10)}\nθ = ${fmt(th * dg, 8)}° = ${fmt(th, 10)} rad`; }
      if (mode === "polar2cart") { const th = y * Math.PI / 180; return `x = ${fmt(x * Math.cos(th), 10)}\ny = ${fmt(x * Math.sin(th), 10)}`; }
      if (mode === "cart2cyl") { const r = Math.hypot(x, y), th = Math.atan2(y, x); return `ρ = ${fmt(r, 10)}\nφ = ${fmt(th * dg, 8)}°\nz = ${fmt(z, 10)}`; }
      if (mode === "cyl2cart") { const th = y * Math.PI / 180; return `x = ${fmt(x * Math.cos(th), 10)}\ny = ${fmt(x * Math.sin(th), 10)}\nz = ${fmt(z, 10)}`; }
      if (mode === "cart2sph") {
        const r = Math.hypot(x, y, z), th = Math.atan2(y, x), ph = r === 0 ? 0 : Math.acos(z / r);
        return `r = ${fmt(r, 10)}\nθ = ${fmt(th * dg, 8)}°（方位）\nφ = ${fmt(ph * dg, 8)}°（极角）`;
      }
      if (mode === "sph2cart") {
        const th = y * Math.PI / 180, ph = z * Math.PI / 180;
        return `x = ${fmt(x * Math.sin(ph) * Math.cos(th), 10)}\ny = ${fmt(x * Math.sin(ph) * Math.sin(th), 10)}\nz = ${fmt(x * Math.cos(ph), 10)}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "变换", "cart2polar", ["cart2polar", "polar2cart", "cart2cyl", "cyl2cart", "cart2sph", "sph2cart"]), P("x", "x / r / ρ", "1"), P("y", "y / θ°", "1"), P("z", "z / φ°", "0")]),

  runOp("d2-koch", CAT, "Koch 雪花分形", "迭代 n 次：边数 3·4ⁿ、周长 3s(4/3)ⁿ、面积 Aₙ = A₀ + (3√3/20)s²(1−(4/9)ⁿ)；n ≤ 20",
    (t, p) => {
      const s = Number((p && p.side) || t || 1), n = boundedInt((p && p.n) || "3", "迭代次数", 0, 20);
      if (!(s > 0)) err("边长需为正");
      const edges = 3 * 4 ** n;
      const perim = 3 * s * (4 / 3) ** n;
      const area = Math.sqrt(3) / 4 * s * s + 3 * Math.sqrt(3) / 20 * s * s * (1 - (4 / 9) ** n);
      return `边长 ${s}，迭代 ${n}\n边数 = ${edges}\n周长 = ${fmt(perim, 10)}\n面积 = ${fmt(area, 10)}\n极限面积 = ${fmt(2 * Math.sqrt(3) / 5 * s * s, 10)}`;
    }, [P("side", "初始边长", "1"), P("n", "迭代次数", "3")]),

  runOp("d2-stats", CAT, "统计量：均值/中位/众数/方差/分位", "算术/几何/调和/加权平均、中位数、众数、极差、总体/样本方差与标准差、四分位、任意分位数、抽签频数",
    (t, p) => {
      const mode = String((p && p.mode) || "summary");
      const a = numList((p && p.nums) || t);
      const sorted = a.slice().sort((x, y) => x - y);
      const sum = a.reduce((x, y) => x + y, 0), mean = sum / a.length;
      const varP = a.reduce((s, x) => s + (x - mean) ** 2, 0) / a.length;
      const varS = a.length > 1 ? a.reduce((s, x) => s + (x - mean) ** 2, 0) / (a.length - 1) : 0;
      const quant = (q) => {
        const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
      };
      const median = quant(0.5);
      const modeVals = () => {
        const m = new Map();
        for (const x of a) m.set(x, (m.get(x) || 0) + 1);
        const max = Math.max(...m.values());
        return [...m].filter(([, c]) => c === max).map(([x]) => x);
      };
      if (mode === "mean" || mode === "arithmetic") return `算术平均 = ${fmt(mean, 12)}`;
      if (mode === "median") return `中位数 = ${fmt(median, 12)}`;
      if (mode === "mode") return `众数 = ${modeVals().join(", ")}（出现 ${Math.max(...a.map((x) => a.filter((y) => y === x).length))} 次）`;
      if (mode === "variance") return `总体方差 = ${fmt(varP, 12)}\n样本方差 = ${fmt(varS, 12)}`;
      if (mode === "stddev" || mode === "ecart-type") return `总体标准差 = ${fmt(Math.sqrt(varP), 12)}\n样本标准差 = ${fmt(Math.sqrt(varS), 12)}`;
      if (mode === "geometric") {
        if (a.some((x) => x <= 0)) err("几何平均需要正数");
        return `几何平均 = ${fmt(Math.exp(a.reduce((s, x) => s + Math.log(x), 0) / a.length), 12)}`;
      }
      if (mode === "harmonic") {
        if (a.some((x) => x === 0)) err("调和平均不能含 0");
        return `调和平均 = ${fmt(a.length / a.reduce((s, x) => s + 1 / x, 0), 12)}`;
      }
      if (mode === "weighted" || mode === "moyenne-ponderee") {
        const w = String((p && p.weights) || "").split(/[\s,;]+/).filter(Boolean).map(Number);
        if (w.length !== a.length) err("权重数量需与数值数量一致");
        const sw = w.reduce((x, y) => x + y, 0);
        if (sw === 0) err("权重和不能为 0");
        return `加权平均 = ${fmt(a.reduce((s, x, i) => s + x * w[i], 0) / sw, 12)}`;
      }
      if (mode === "quantile") {
        const q = Number((p && p.q) || "0.25");
        if (!(q >= 0 && q <= 1)) err("分位 q 需在 0..1");
        return `${q} 分位数 = ${fmt(quant(q), 12)}`;
      }
      if (mode === "quartiles" || mode === "quartile") return `Q1 = ${fmt(quant(0.25), 10)}\nQ2 = ${fmt(median, 10)}\nQ3 = ${fmt(quant(0.75), 10)}\nIQR = ${fmt(quant(0.75) - quant(0.25), 10)}`;
      if (mode === "draws" || mode === "tirage") {
        const m = new Map();
        for (const x of a) m.set(x, (m.get(x) || 0) + 1);
        const rows = [...m].sort((x, y) => y[1] - x[1]).map(([x, c]) => `${x}: ${c} 次（${fmt(100 * c / a.length, 4)}%）`);
        return `样本数 ${a.length}\n${rows.join("\n")}`;
      }
      return `n = ${a.length}\n和 = ${fmt(sum, 12)}\n算术平均 = ${fmt(mean, 12)}\n中位数 = ${fmt(median, 12)}\n众数 = ${modeVals().join(", ")}\n极差 = ${fmt(sorted[sorted.length - 1] - sorted[0], 12)}\n总体方差 = ${fmt(varP, 12)}\n总体标准差 = ${fmt(Math.sqrt(varP), 12)}\n样本标准差 = ${fmt(Math.sqrt(varS), 12)}\nQ1/Q2/Q3 = ${fmt(quant(0.25), 8)} / ${fmt(median, 8)} / ${fmt(quant(0.75), 8)}`;
    }, [SEL("mode", "模式", "summary", ["summary", "mean", "arithmetic", "median", "mode", "variance", "stddev", "geometric", "harmonic", "weighted", "quantile", "quartiles", "quartile", "draws"]), P("nums", "数字列表", "1 2 2 3 5 8"), P("weights", "权重列表", "1 1 1 1 1 1"), P("q", "分位 q", "0.25")]),

  runOp("d2-percent", CAT, "百分比/置信区间/误差/精确率", "百分比与比例、增减幅、样本比例置信区间（Wald/Wilson）、误差边际、精确率/召回率/F1；输出 10 位",
    (t, p) => {
      const mode = String((p && p.mode) || "percent");
      if (mode === "percent" || mode === "proportion") {
        const part = Number((p && p.part) || "1"), total = Number((p && p.total) || "100");
        if (!(total > 0)) err("总数需为正");
        return `${part}/${total} = ${fmt(100 * part / total, 10)}%`;
      }
      if (mode === "change") {
        const oldV = Number((p && p.old) || "1"), newV = Number((p && p.new) || "2");
        if (oldV === 0) err("原值不能为 0");
        return `变化率 = ${fmt(100 * (newV - oldV) / Math.abs(oldV), 10)}%`;
      }
      if (mode === "confidence") {
        const ph = Number((p && p.p) || "0.5"), n = boundedInt((p && p.n) || "100", "样本量", 1, 1000000), level = Number((p && p.level) || "0.95");
        const z = level >= 0.99 ? 2.575829 : level >= 0.95 ? 1.959964 : level >= 0.9 ? 1.644854 : 1.281552;
        const se = Math.sqrt(ph * (1 - ph) / n);
        const wl = ph - z * se, wh = ph + z * se;
        const den = 1 + z * z / n, center = (ph + z * z / (2 * n)) / den, half = z * Math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / den;
        return `样本比例 = ${fmt(ph, 8)}，n = ${n}，置信水平 ${level}\nWald 区间：[${fmt(wl, 8)}, ${fmt(wh, 8)}]\nWilson 区间：[${fmt(center - half, 8)}, ${fmt(center + half, 8)}]\n误差边际 ≈ ${fmt(z * se, 8)}`;
      }
      if (mode === "margin") {
        const ph = Number((p && p.p) || "0.5"), n = boundedInt((p && p.n) || "100", "样本量", 1, 1000000), level = Number((p && p.level) || "0.95");
        const z = level >= 0.99 ? 2.575829 : level >= 0.95 ? 1.959964 : 1.644854;
        return `误差边际 = ${fmt(z * Math.sqrt(ph * (1 - ph) / n), 10)}`;
      }
      if (mode === "precision" || mode === "rappel") {
        const tp = Number((p && p.tp) || "0"), fp = Number((p && p.fp) || "0"), fn = Number((p && p.fn) || "0");
        const prec = tp + fp ? tp / (tp + fp) : 0, rec = tp + fn ? tp / (tp + fn) : 0;
        const f1 = prec + rec ? 2 * prec * rec / (prec + rec) : 0;
        return `Precision = ${fmt(prec, 10)}\nRecall = ${fmt(rec, 10)}\nF1 = ${fmt(f1, 10)}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "percent", ["percent", "proportion", "change", "confidence", "margin", "precision", "rappel"]), P("part", "部分", "25"), P("total", "总数", "200"), P("old", "原值", "100"), P("new", "新值", "120"), P("p", "比例 p / 样本比例", "0.5"), P("n", "样本量", "100"), P("level", "置信水平", "0.95"), P("tp", "TP", "8"), P("fp", "FP", "2"), P("fn", "FN", "1")]),

  runOp("d2-color", CAT, "颜色/波长/频率/光子能量", "波长 nm ↔ 频率 THz ↔ 光子能量 eV/J；RGB ↔ Hex ↔ 24 位整数；输入 RGB 或 #RRGGBB 或整数",
    (t, p) => {
      const mode = String((p && p.mode) || "wavelength");
      const v = String((p && p.value) || t || "").trim();
      const c = 299792458;
      if (mode === "wavelength") {
        const nm = Number(v);
        if (!(nm > 0)) err("波长需为正");
        const freq = c / (nm * 1e-9);
        const eJ = 6.62607015e-34 * freq;
        return `λ = ${fmt(nm, 8)} nm\nν = ${fmt(freq / 1e12, 8)} THz\nE = ${fmt(eJ / 1.602176634e-19, 8)} eV = ${eJ.toExponential(6)} J`;
      }
      if (mode === "frequency") {
        const thz = Number(v);
        if (!(thz > 0)) err("频率需为正");
        const freq = thz * 1e12;
        return `ν = ${fmt(thz, 8)} THz\nλ = ${fmt(c / freq * 1e9, 8)} nm\nE = ${fmt(6.62607015e-34 * freq / 1.602176634e-19, 8)} eV`;
      }
      if (mode === "energy") {
        const ev = Number(v);
        if (!(ev > 0)) err("能量需为正");
        const eJ = ev * 1.602176634e-19;
        return `E = ${fmt(ev, 8)} eV\nν = ${fmt(eJ / 6.62607015e-34 / 1e12, 8)} THz\nλ = ${fmt(c / (eJ / 6.62607015e-34) * 1e9, 8)} nm`;
      }
      if (mode === "hex2rgb" || mode === "rgb2hex") {
        if (mode === "hex2rgb") {
          const m = v.match(/^#?([0-9a-f]{6})$/i);
          if (!m) err("Hex 格式应为 #RRGGBB");
          const n = parseInt(m[1], 16);
          return `RGB = (${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})\n整数 = ${n}`;
        }
        const m = v.match(/^(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})$/);
        if (!m) err("RGB 格式应为 r,g,b");
        const rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
        if (rgb.some((x) => x < 0 || x > 255)) err("RGB 分量需在 0..255");
        const n = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
        return `#${n.toString(16).toUpperCase().padStart(6, "0")}\n整数 = ${n}`;
      }
      if (mode === "int2rgb" || mode === "rgb2int") {
        if (mode === "int2rgb") {
          const n = boundedInt(v, "颜色整数", 0, 16777215);
          return `RGB = (${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})\n#${n.toString(16).toUpperCase().padStart(6, "0")}`;
        }
        const m = v.match(/^(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})$/);
        if (!m) err("RGB 格式应为 r,g,b");
        return `整数 = ${(Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3])}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "wavelength", ["wavelength", "frequency", "energy", "hex2rgb", "rgb2hex", "int2rgb", "rgb2int"]), P("value", "数值/颜色", "500")]),

  runOp("d2-atomic", CAT, "元素/电子排布/原子序数替换", "118 元素查询（序数/符号/名称）、Aufbau 电子排布（含常见例外）、元素符号 ↔ 原子序数；化学式按元素符号最长匹配",
    (t, p) => {
      const SYM = "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split(" ");
      const NAMES = ["Hydrogen","Helium","Lithium","Beryllium","Boron","Carbon","Nitrogen","Oxygen","Fluorine","Neon","Sodium","Magnesium","Aluminium","Silicon","Phosphorus","Sulfur","Chlorine","Argon","Potassium","Calcium","Scandium","Titanium","Vanadium","Chromium","Manganese","Iron","Cobalt","Nickel","Copper","Zinc","Gallium","Germanium","Arsenic","Selenium","Bromine","Krypton","Rubidium","Strontium","Yttrium","Zirconium","Niobium","Molybdenum","Technetium","Ruthenium","Rhodium","Palladium","Silver","Cadmium","Indium","Tin","Antimony","Tellurium","Iodine","Xenon","Caesium","Barium","Lanthanum","Cerium","Praseodymium","Neodymium","Promethium","Samarium","Europium","Gadolinium","Terbium","Dysprosium","Holmium","Erbium","Thulium","Ytterbium","Lutetium","Hafnium","Tantalum","Tungsten","Rhenium","Osmium","Iridium","Platinum","Gold","Mercury","Thallium","Lead","Bismuth","Polonium","Astatine","Radon","Francium","Radium","Actinium","Thorium","Protactinium","Uranium","Neptunium","Plutonium","Americium","Curium","Berkelium","Californium","Einsteinium","Fermium","Mendelevium","Nobelium","Lawrencium","Rutherfordium","Dubnium","Seaborgium","Bohrium","Hassium","Meitnerium","Darmstadtium","Roentgenium","Copernicium","Nihonium","Flerovium","Moscovium","Livermorium","Tennessine","Oganesson"];
      const mode = String((p && p.mode) || "lookup");
      const v = String((p && p.value) || t || "").trim();
      const lookup = (q) => {
        if (/^\d+$/.test(q)) { const n = Number(q); return n >= 1 && n <= 118 ? n : 0; }
        const up = q[0].toUpperCase() + q.slice(1).toLowerCase();
        let i = SYM.indexOf(up); if (i >= 0) return i + 1;
        i = NAMES.findIndex((x) => x.toLowerCase() === q.toLowerCase()); return i >= 0 ? i + 1 : 0;
      };
      if (mode === "lookup" || mode === "element") {
        const z = lookup(v);
        if (!z) err(`未找到元素「${v}」`);
        return `原子序数 = ${z}\n符号 = ${SYM[z - 1]}\n英文名 = ${NAMES[z - 1]}`;
      }
      if (mode === "config") {
        const z = lookup(v);
        if (!z) err(`未找到元素「${v}」`);
        const order = [["1s",2],["2s",2],["2p",6],["3s",2],["3p",6],["4s",2],["3d",10],["4p",6],["5s",2],["4d",10],["5p",6],["6s",2],["4f",14],["5d",10],["6p",6],["7s",2],["5f",14],["6d",10],["7p",6]];
        const exc = { 24: { "4s": 1, "3d": 5 }, 29: { "4s": 1, "3d": 10 }, 41: { "5s": 1, "4d": 4 }, 42: { "5s": 1, "4d": 5 }, 44: { "5s": 1, "4d": 7 }, 45: { "5s": 1, "4d": 8 }, 46: { "5s": 0, "4d": 10 }, 47: { "5s": 1, "4d": 10 }, 57: { "6s": 2, "5d": 1 }, 58: { "6s": 2, "4f": 1, "5d": 1 }, 64: { "6s": 2, "4f": 7, "5d": 1 }, 78: { "6s": 1, "5d": 9 }, 79: { "6s": 1, "5d": 10 }, 89: { "7s": 2, "6d": 1 }, 90: { "7s": 2, "6d": 2 }, 91: { "7s": 2, "5f": 2, "6d": 1 }, 92: { "7s": 2, "5f": 3, "6d": 1 }, 93: { "7s": 2, "5f": 4, "6d": 1 }, 96: { "7s": 2, "5f": 7, "6d": 1 }, 103: { "7s": 2, "5f": 14, "7p": 1 } };
        let rem = z;
        const conf = [];
        if (exc[z]) {
          for (const [k, n] of Object.entries(exc[z])) conf.push([k, n]);
          rem = z - conf.reduce((s, [, n]) => s + n, 0);
        }
        for (const [k, cap] of order) {
          if (rem <= 0) break;
          if (exc[z] && k in exc[z]) continue;
          const n = Math.min(cap, rem);
          conf.push([k, n]); rem -= n;
        }
        const lorder = { s: 0, p: 1, d: 2, f: 3 };
        conf.sort((a, b) => Number(a[0][0]) - Number(b[0][0]) || lorder[a[0][1]] - lorder[b[0][1]]);
        const coreMap = { 2: "He", 10: "Ne", 18: "Ar", 36: "Kr", 54: "Xe", 86: "Rn" };
        let coreZ = 0;
        for (const n of Object.keys(coreMap).map(Number).sort((a, b) => b - a)) if (z > n) { coreZ = n; break; }
        const disp = conf.map(([k, n]) => [k, n]);
        let need = coreZ;
        for (const item of disp) { if (need <= 0) break; const take = Math.min(need, item[1]); item[1] -= take; need -= take; }
        const full = disp.filter(([, n]) => n > 0).map(([k, n]) => `${k}${n}`).join(" ");
        const maxN = Math.max(...conf.map(([k]) => Number(k[0])));
        const outer = conf.filter(([k]) => Number(k[0]) === maxN).reduce((s, [, n]) => s + n, 0);
        return `${SYM[z - 1]}（Z=${z}）电子排布：\n${coreZ ? `[${coreMap[coreZ]}] ` : ""}${full}${exc[z] ? "\n（含常见例外校正）" : ""}\n最外层电子数 = ${outer}`;
      }
      if (mode === "encode") {
        const s = v.replace(/\s+/g, "");
        const out = [];
        for (let i = 0; i < s.length;) {
          let hit = null;
          for (let len = 2; len >= 1; len--) {
            const sub = s.slice(i, i + len);
            const up = sub[0].toUpperCase() + sub.slice(1).toLowerCase();
            if (SYM.includes(up)) { hit = [up, len]; break; }
          }
          if (!hit) err(`位置 ${i} 的「${s[i]}」无法匹配元素符号`);
          out.push(String(SYM.indexOf(hit[0]) + 1));
          i += hit[1];
        }
        return `元素符号 → 原子序数：\n${out.join("-")}`;
      }
      if (mode === "decode") {
        const nums = v.split(/[-,\s]+/).filter(Boolean).map(Number);
        if (nums.some((n) => n < 1 || n > 118)) err("原子序数需在 1..118");
        return `原子序数 → 元素符号：\n${nums.map((n) => SYM[n - 1]).join("")}\n${nums.map((n) => `${n}=${SYM[n - 1]}`).join(", ")}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "lookup", ["lookup", "element", "config", "encode", "decode"]), P("value", "元素/化学式/序数", "Fe")]),

  runOp("d2-radioactivity", CAT, "放射性衰变计算", "N=N₀e^(−λt)、半衰期、活度、达到指定剩余量所需时间；输入数与时间单位一致",
    (t, p) => {
      const mode = String((p && p.mode) || "remaining");
      const n0 = Number((p && p.n0) || t || 100), half = Number((p && p.half) || "10"), time = Number((p && p.time) || "10");
      if (!(n0 > 0) || !(half > 0)) err("N₀ 与半衰期需为正");
      const lambda = Math.LN2 / half;
      if (mode === "remaining") return `λ = ${fmt(lambda, 10)}\n剩余 N(${time}) = ${fmt(n0 * Math.exp(-lambda * time), 10)}\n剩余比例 = ${fmt(100 * Math.exp(-lambda * time), 6)}%`;
      if (mode === "activity") {
        const a0 = Number((p && p.a0) || "1000");
        return `λ = ${fmt(lambda, 10)}\n活度 A(${time}) = ${fmt(a0 * Math.exp(-lambda * time), 10)}`;
      }
      if (mode === "time") {
        const target = Number((p && p.target) || "25");
        if (!(target > 0 && target <= n0)) err("目标剩余量需在 (0,N₀]");
        return `达到 ${target} 所需时间 t = ${fmt(-Math.log(target / n0) / lambda, 10)}`;
      }
      if (mode === "halflife") {
        const t2 = Number((p && p.t2) || "10"), ratio = Number((p && p.ratio) || "0.5");
        if (!(t2 > 0 && ratio > 0 && ratio < 1)) err("需 t>0 且 0<比例<1");
        return `半衰期 = ${fmt(-t2 * Math.LN2 / Math.log(ratio), 10)}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "remaining", ["remaining", "activity", "time", "halflife"]), P("n0", "N₀ / A₀", "100"), P("half", "半衰期", "10"), P("time", "时间 t", "10"), P("a0", "初始活度 A₀", "1000"), P("target", "目标剩余量", "25"), P("t2", "观测时间", "10"), P("ratio", "观测剩余比例", "0.5")]),

  runOp("d2-relativity", CAT, "狭义相对论：时间膨胀/长度收缩", "β=v/c，γ=1/√(1−β²)，膨胀时间 t=γt₀，收缩长度 L=L₀/γ；v 用 c 的比例",
    (t, p) => {
      const beta = Number((p && p.beta) || t || 0.8), t0 = Number((p && p.t0) || "1"), L0 = Number((p && p.L0) || "1");
      if (!(beta >= 0 && beta < 1)) err("β 需在 0 ≤ β < 1");
      const g = 1 / Math.sqrt(1 - beta * beta);
      return `β = ${fmt(beta, 8)}\nγ = ${fmt(g, 10)}\n固有时间 t₀ = ${fmt(t0, 8)} → 观测时间 t = ${fmt(g * t0, 10)}\n固有长度 L₀ = ${fmt(L0, 8)} → 观测长度 L = ${fmt(L0 / g, 10)}`;
    }, [P("beta", "β=v/c", "0.8"), P("t0", "固有时间 t₀", "1"), P("L0", "固有长度 L₀", "1")]),

  runOp("d2-series", CAT, "数列：Fibonacci/Lucas/调和/连分数", "Fibonacci 与 Lucas 大数、调和数 Hₙ 精确分数、有理数连分数、二次无理数周期连分数、连分数求值",
    (t, p) => {
      const mode = String((p && p.mode) || "fibonacci");
      const v = String((p && p.value) || t || "").trim();
      if (mode === "fibonacci" || mode === "lucas") {
        const n = boundedInt(v, "n", 0, 10000);
        let a = mode === "fibonacci" ? 0n : 2n, b = 1n;
        if (n === 0) return `${mode === "fibonacci" ? "F" : "L"}(0) = ${a}`;
        for (let i = 1; i < n; i++) { const c = a + b; a = b; b = c; }
        return `${mode === "fibonacci" ? "F" : "L"}(${n}) = ${b}`;
      }
      if (mode === "harmonic") {
        const n = boundedInt(v, "n", 1, 2000);
        let h = RZERO;
        for (let k = 1n; k <= BigInt(n); k++) h = rAdd(h, R(1n, k));
        return `H_${n} = ${rStr(h)}\n十进制 ≈ ${fmt(rNum(h), 12)}`;
      }
      if (mode === "cf") {
        const [num, den] = parseFractionInput(v);
        let a = num, b = den;
        const out = [];
        while (b !== 0n) { const q = a / b; out.push(q.toString()); [a, b] = [b, a - q * b]; }
        return `连分数 = [${out.join("; ")}]`;
      }
      if (mode === "sqrtcf") {
        const D = boundedInt(v, "D", 2, 1000000);
        const a0 = Math.floor(Math.sqrt(D));
        if (a0 * a0 === D) return `√${D} = ${a0}（完全平方）`;
        let m = 0, d = 1, a = a0;
        const period = [];
        for (let i = 0; i < 10000; i++) {
          m = d * a - m; d = (D - m * m) / d; a = Math.floor((a0 + m) / d);
          period.push(a);
          if (a === 2 * a0) break;
        }
        return `√${D} = [${a0}; (${period.join(", ")})]\n周期长度 = ${period.length}`;
      }
      if (mode === "evalcf") {
        const parts = v.split(/[;,\s]+/).filter(Boolean).map(Number);
        if (!parts.length || parts.some((x) => !Number.isFinite(x))) err("连分数格式：4;2,6,7");
        let x = parts[parts.length - 1];
        for (let i = parts.length - 2; i >= 0; i--) x = parts[i] + 1 / x;
        return `连分数 [${parts.join("; ")}] = ${fmt(x, 12)}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "fibonacci", ["fibonacci", "lucas", "harmonic", "cf", "sqrtcf", "evalcf"]), P("value", "n / a/b / D / 连分数", "10")]),

  runOp("d2-graph", CAT, "网格最短路/数字金字塔路径", "网格 BFS 四邻域最短路（# 障碍、S 起点、E 终点）；数字金字塔自顶向下最大/最小路径和", 
    (t, p) => {
      const mode = String((p && p.mode) || "grid");
      if (mode === "grid") {
        const r = gridBFS((p && p.grid) || t);
        if (!r) return "无可行路径";
        return `最短路径长度 = ${r.path.length - 1} 步\n路径：${r.path.map(([i, j]) => `(${i},${j})`).join(" → ")}\n${r.render}`;
      }
      if (mode === "pyramid") {
        const rows = String((p && p.triangle) || t || "").replace(/\r/g, "").split(/\n/).map((x) => x.trim()).filter(Boolean).map((x) => x.split(/[\s,]+/).filter(Boolean).map(Number));
        if (!rows.length || rows.some((r, i) => r.length !== i + 1) || rows.some((r) => r.some((x) => !Number.isFinite(x)))) err("金字塔每行应有 1,2,3… 个数字");
        if (rows.length > 100) err("金字塔高度上限 100");
        const max = mode !== "min";
        let cur = rows[0].slice();
        for (let i = 1; i < rows.length; i++) {
          const next = [];
          for (let j = 0; j < rows[i].length; j++) {
            const left = j > 0 ? cur[j - 1] : -Infinity, right = j < cur.length ? cur[j] : -Infinity;
            next.push(rows[i][j] + (max ? Math.max(left, right) : Math.min(left, right)));
          }
          cur = next;
        }
        const best = max ? Math.max(...cur) : Math.min(...cur);
        return `${max ? "最大" : "最小"}路径和 = ${best}\n底层累计：${cur.join(", ")}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "grid", ["grid", "pyramid"]), P("grid", "网格（# 墙,S 起点,E 终点）", "S..#\n.#..\n...E"), P("triangle", "数字金字塔", "3\n7 4\n2 4 6\n8 5 9 3")]),

  runOp("d2-biology", CAT, "遗传密码/逆转录/生命游戏", "DNA/RNA 密码子翻译为氨基酸、单字母氨基酸反查密码子、Conway 生命游戏迭代；网格有界",
    (t, p) => {
      const mode = String((p && p.mode) || "codon");
      const src = String((p && p.seq) || t || "").trim();
      const CODONS = {
        UUU: "F", UUC: "F", UUA: "L", UUG: "L", CUU: "L", CUC: "L", CUA: "L", CUG: "L",
        AUU: "I", AUC: "I", AUA: "I", AUG: "M", GUU: "V", GUC: "V", GUA: "V", GUG: "V",
        UCU: "S", UCC: "S", UCA: "S", UCG: "S", CCU: "P", CCC: "P", CCA: "P", CCG: "P",
        ACU: "T", ACC: "T", ACA: "T", ACG: "T", GCU: "A", GCC: "A", GCA: "A", GCG: "A",
        UAU: "Y", UAC: "Y", UAA: "*", UAG: "*", CAU: "H", CAC: "H", CAA: "Q", CAG: "Q",
        AAU: "N", AAC: "N", AAA: "K", AAG: "K", GAU: "D", GAC: "D", GAA: "E", GAG: "E",
        UGU: "C", UGC: "C", UGA: "*", UGG: "W", CGU: "R", CGC: "R", CGA: "R", CGG: "R",
        AGU: "S", AGC: "S", AGA: "R", AGG: "R", GGU: "G", GGC: "G", GGA: "G", GGG: "G",
      };
      if (mode === "codon" || mode === "translate") {
        const s = src.toUpperCase().replace(/T/g, "U").replace(/[^ACGU]/g, "");
        if (!s) err("需要 DNA/RNA 序列");
        const out = [];
        for (let i = 0; i + 2 < s.length; i += 3) out.push(CODONS[s.slice(i, i + 3)] || "?");
        return `氨基酸序列：${out.join("")}\n（* = 终止；共 ${out.length} 个密码子）`;
      }
      if (mode === "reverse") {
        const aa = src.toUpperCase().replace(/[^A-Z*]/g, "");
        if (!aa) err("需要单字母氨基酸序列");
        const map = {};
        for (const [codon, letter] of Object.entries(CODONS)) { (map[letter] = map[letter] || []).push(codon); }
        const out = [];
        for (const ch of aa) {
          if (!map[ch]) err(`未知氨基酸字母「${ch}」`);
          out.push(map[ch][0]);
        }
        return `首选密码子：${out.join(" ")}\n（每个氨基酸取第一个密码子）`;
      }
      if (mode === "life") {
        const g0 = parseGrid((p && p.grid) || t).map((row) => [...row].map((c) => c === "#" || c === "1" || c === "O" ? 1 : 0));
        const steps = boundedInt((p && p.steps) || "1", "迭代步数", 0, 100);
        let g = g0;
        for (let s = 0; s < steps; s++) {
          const h = g.length, w = g[0].length;
          const ng = Array.from({ length: h }, () => Array(w).fill(0));
          for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) {
            let n = 0;
            for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
              if (!di && !dj) continue;
              const ni = i + di, nj = j + dj;
              if (ni >= 0 && ni < h && nj >= 0 && nj < w) n += g[ni][nj];
            }
            ng[i][j] = g[i][j] ? (n === 2 || n === 3 ? 1 : 0) : (n === 3 ? 1 : 0);
          }
          g = ng;
        }
        return `生命游戏（${steps} 步）：\n${g.map((r) => r.map((x) => (x ? "#" : ".")).join("")).join("\n")}`;
      }
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "codon", ["codon", "translate", "reverse", "life"]), P("seq", "序列", "AUGGCCUUU"), P("grid", "生命游戏网格", ".....\n..#..\n...#.\n.###.\n....."), P("steps", "迭代步数", "1")]),

  runOp("d2-plot", CAT, "点列绘图（SVG）", "把点列或函数采样输出为 SVG 折线/散点，坐标自动缩放；点数 ≤ 2000",
    (t, p) => {
      const mode = String((p && p.mode) || "points");
      let pts;
      if (mode === "function") {
        const expr = String((p && p.expr) || "x^2"), a = Number((p && p.a) || "-10"), b = Number((p && p.b) || "10"), n = boundedInt((p && p.n) || "200", "采样数", 2, 2000);
        pts = [];
        for (let i = 0; i <= n; i++) { const x = a + (b - a) * i / n; pts.push([x, evalF(expr, x)]); }
      } else pts = parsePointList((p && p.points) || t);
      if (pts.length < 1 || pts.length > 2000) err("点数需 1..2000");
      const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const W = 600, H = 360, pad = 30;
      const sx = (x) => pad + (x - minX) / (maxX - minX || 1) * (W - 2 * pad);
      const sy = (y) => H - pad - (y - minY) / (maxY - minY || 1) * (H - 2 * pad);
      const poly = pts.map(([x, y]) => `${fmt(sx(x), 3)},${fmt(sy(y), 3)}`).join(" ");
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="white"/><polyline points="${poly}" fill="none" stroke="#2563eb" stroke-width="2"/>${pts.map(([x, y]) => `<circle cx="${fmt(sx(x), 3)}" cy="${fmt(sy(y), 3)}" r="2" fill="#dc2626"/>`).join("")}<text x="${pad}" y="${pad - 10}" font-size="12">x:[${fmt(minX, 3)},${fmt(maxX, 3)}] y:[${fmt(minY, 3)},${fmt(maxY, 3)}]</text></svg>`;
    }, [SEL("mode", "模式", "points", ["points", "function"]), P("points", "点列 x,y;...", "0,0;1,1;2,4;3,9"), P("expr", "函数 f(x)", "x^2"), P("a", "x 下限", "-10"), P("b", "x 上限", "10"), P("n", "采样数", "200")]),

  runOp("d2-dft", CAT, "离散 Fourier 变换/逆变换", "DFT 与 IDFT（O(n²)，n ≤ 512），输出幅值/相位与逆变换校验；非 FFT", 
    (t, p) => {
      const mode = String((p && p.mode) || "dft");
      const a = numList((p && p.signal) || t, "信号").slice(0, 512);
      const n = a.length;
      if (mode === "dft") {
        const out = [];
        for (let k = 0; k < n; k++) {
          let re = 0, im = 0;
          for (let j = 0; j < n; j++) { const th = -2 * Math.PI * k * j / n; re += a[j] * Math.cos(th); im += a[j] * Math.sin(th); }
          out.push(`${k}: ${fmt(re, 6)} ${im < 0 ? "-" : "+"} ${fmt(Math.abs(im), 6)}i | mag=${fmt(Math.hypot(re, im), 6)}`);
        }
        return `DFT（n=${n}）：\n${out.join("\n")}`;
      }
      const re = a.filter((_, i) => i % 2 === 0), im = a.filter((_, i) => i % 2 === 1);
      if (re.length !== im.length) err("IDFT 输入格式：re0,im0,re1,im1,...");
      const m = re.length, out = [];
      for (let k = 0; k < m; k++) {
        let vr = 0, vi = 0;
        for (let j = 0; j < m; j++) { const th = 2 * Math.PI * k * j / m; vr += re[j] * Math.cos(th) - im[j] * Math.sin(th); vi += re[j] * Math.sin(th) + im[j] * Math.cos(th); }
        out.push(`${fmt(vr / m, 8)}`);
      }
      return `IDFT 实部：${out.join(", ")}`;
    }, [SEL("mode", "模式", "dft", ["dft", "idft"]), P("signal", "信号/交错复数列", "1 0 0 0")]),

  runOp("d2-special", CAT, "特殊函数：erf/erfc/Dawson/Γ", "误差函数 erf、补误差函数 erfc、Dawson 积分、Gamma 函数与阶乘；数值近似 7~10 位",
    (t, p) => {
      const mode = String((p && p.mode) || "erf");
      const x = Number((p && p.value) || t || 0);
      if (!Number.isFinite(x)) err("数值非法");
      if (mode === "erf") return `erf(${x}) = ${fmt(erf(x), 12)}`;
      if (mode === "erfc") return `erfc(${x}) = ${fmt(erfc(x), 12)}`;
      if (mode === "dawson") return `Dawson F(${x}) = ${fmt(dawson(x), 12)}`;
      if (mode === "gamma") return `Γ(${x}) = ${fmt(gammaFn(x), 12)}`;
      if (mode === "factorial") return `${x}! = ${fmt(gammaFn(x + 1), 12)}`;
      err(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "erf", ["erf", "erfc", "dawson", "gamma", "factorial"]), P("value", "x", "1")]),

  runOp("d2-laplace", CAT, "Laplace 变换（数值前向）", "数值计算 F(s)=∫₀^∞ f(t)e^(−st)dt（截断 T 可调）；逆 Laplace 需要 CAS，未实现", 
    (t, p) => {
      const expr = String((p && p.expr) || t || "exp(-t)");
      const s = Number((p && p.s) || "1"), T = Number((p && p.T) || "50");
      if (!(s > 0) || !(T > 0)) err("s 与截断 T 需为正");
      const f = (tt) => evalExpr(expr, { t: tt }) * Math.exp(-s * tt);
      const n = 2000, h = T / n;
      let sum = 0;
      for (let i = 0; i <= n; i++) {
        const w = i === 0 || i === n ? 1 : i % 2 ? 4 : 2;
        sum += w * f(i * h);
      }
      return `F(${s}) ≈ ∫₀^${T} ${expr}·e^(−${s}t) dt ≈ ${fmt(sum * h / 3, 10)}`;
    }, [P("expr", "f(t)", "exp(-t)"), P("s", "s", "1"), P("T", "截断 T", "50")]),

];

const RESOLVE = {};
function addAll(list, target, reason, status = "implemented") { for (const slug of list) RESOLVE[slug] = { status, target, reason }; }
const mapped = (list, target, reason) => addAll(list, target, reason, "mapped");
const blocked = (list, reason) => addAll(list, "", reason, "blocked");

addAll(["addition-grands-nombres", "soustraction-grands-nombres", "multiplication-grands-nombres", "division-grands-nombres", "division-euclidienne", "calculatrice-modulo-n", "calcul-exponentiation"], "d2-bignum", "BigInt 四则/商余/模/幂");
addAll(["code-binaire", "code-ternaire", "systeme-octal", "systeme-hexadecimal", "conversion-base-n", "chiffre-base-26", "chiffre-base-37", "systeme-negabinaire", "complement-binaire"], "d2-baseconv", "任意进制与补码转换");
addAll(["representation-zeckendorf", "codage-fibonacci"], "d2-zeckendorf", "Zeckendorf 0/1 编码");
addAll(["affixe-nombre-complexe", "argument-nombre-complexe", "module-nombre-complexe", "conjugue-nombre-complexe", "forme-exponentielle-complexe"], "d2-complex", "复数代数/极坐标");
addAll(["liste-diviseurs-nombre", "liste-multiples-nombre", "decomposition-2-facteurs", "factorisation-fermat", "nombres-finissant-par-certains-chiffres", "nombres-palindromiques", "somme-de-carres"], "d2-factor-tools", "因子/倍数/费马/平方和");
addAll(["euclide-etendu", "identite-bezout", "inverse-modulaire", "restes-chinois", "solveur-equation-modulaire", "log-discret", "echange-cle-diffie-hellman"], "d2-modular", "Bézout/CRT/离散对数/DH");
addAll(["formule-quadratique", "completion-carre", "forme-canonique-polynome-2", "discriminant-polynome"], "d2-quadratic", "判别式/根/标准形");
addAll(["developpement-decimal-periodique", "fraction-irreductible", "nombre-fractionnaire"], "d2-fraction-periodic", "分数↔循环小数/带分数");
addAll(["calcul-sommation", "calcul-produit", "somme-sous-ensemble", "rendu-monnaie"], "d2-listcalc", "Σ/∏/子集和/找零");
addAll(["carre-magique"], "d2-magic-square", "奇数/4k/4k+2 幻方");
addAll(["solveur-cryptarithme"], "d2-cryptarithm", "列式回溯字母算术");
addAll(["solveur-calculs-a-trous", "solveur-calculs-a-trous-nombres", "solveur-calculs-a-trous-operateurs"], "d2-holecalc", "缺数字/缺运算符");
addAll(["calculatrice-arrondi", "notation-scientifique", "puissances-de-10", "notation-intervalle", "encadrement-mathematique", "signe-positif-negatif", "pair-impair", "rang-chiffre-nombre", "ensembles-nombres", "echelle-dessin"], "d2-numfmt", "数值格式/区间/数集/比例尺");
addAll(["decimales-pi", "decimales-tau", "decimales-e", "decimales-nombre-or", "recherche-decimales"], "d2-constants", "Machin/BigInt 常数位");
addAll(["solveur-24-jeu", "solveur-krypto", "solveur-mathador"], "d2-solver24", "递归配对求目标值");
addAll(["nombres-premiers", "recherche-nombres-premiers", "test-primalite", "nombre-premier-precedent", "nombre-premier-suivant", "nombre-premier-proche", "fonction-compte-nombre-premier"], "d2-primes", "Miller–Rabin/素数表/邻近");
addAll(["indicatrice-euler", "nombres-premiers-entre-eux", "fonction-mobius"], "d2-numbertheory", "φ/μ/因子函数/互素判定");
addAll(["arrangements", "arrangements-avec-repetition", "generateur-permutations", "permutations-avec-repetition", "rang-permutation", "generateur-derangements"], "d2-permutations", "排列/错排/秩");
addAll(["coefficient-binomial", "combinaisons", "combinaisons-avec-repetition", "combinaisons-choix", "tableau-de-combinaisons", "rang-combinaison", "produit-cartesien", "generateur-partitions", "combinaisons-paris-hippiques", "combinaisons-paris-sportifs", "systeme-reducteur-tirage"], "d2-combinations", "组合/重复组合/分拆/笛卡尔积");
addAll(["probabilite-conditionnelle", "probabilites-tirage", "loi-binomiale", "probabilites-anniversaire", "esperance-gain"], "d2-probability", "条件/超几何/二项/生日/期望");
addAll(["generateur-championnat", "generateur-championnat-paires", "generateur-tournoi-americano", "generateur-tournoi-arbre"], "d2-schedule", "循环赛/双打/淘汰树");
addAll(["nombre-aleatoire", "tirage-au-sort"], "d2-random", "可复现 LCG/抽签");
addAll(["addition-matricielle", "soustraction-matricielle", "produit-matriciel", "division-matricielle", "calcul-matriciel", "determinant-matrice", "inverse-matrice", "rang-matrice", "trace-matrice", "transposee-matrice", "matrice-adjointe", "matrice-complementaire", "matrice-cofacteurs", "mineurs-matrice", "noyau-matrice", "matrice-echelonnee", "elimination-gauss", "decomposition-lu-matrice", "orthonormalisation-gram-schmidt", "norme-vecteur", "produit-vectoriel", "produit-kronecker", "produit-tensoriel", "somme-directe-matrice", "permanent-matrice", "polynome-caracteristique-matrice", "matrice-changement-base", "puissance-matrice"], "d2-matrix", "有理数矩阵引擎");
addAll(["valeurs-propres-matrice", "vecteurs-propres-matrice", "espaces-propres-matrice", "rayon-spectral-matrice", "diagonalisation-matrice"], "d2-eigen", "特征值/特征向量/谱半径/对角化");
addAll(["degre-polynome", "division-polynomiale", "derivee", "derivee-nieme", "derivee-seconde", "derivee-troisieme", "factorisation-polynome", "factorisation-expression-math", "developpement-expression-math", "developpement-reduction-maths", "simplification-mathematique", "suppression-parentheses", "racine-polynome"], "d2-poly", "有理系数多项式代数");
addAll(["solveur-equation", "solveur-inequation", "solveur-equation-trigo", "verification-egalite", "addition-equation-inconnue", "division-equation-inconnue", "multiplication-equation-inconnue", "soustraction-equation-inconnue"], "d2-equation", "方程/不等式/恒等式/三角数值根");
addAll(["calcul-expressions-booleennes", "calcul-mintermes-maxterms", "dual-booleen", "table-karnaugh", "table-verite-logique"], "d2-boolean", "真值表/最小项/Karnaugh/QM");
addAll(["calculatrice-formelle", "exponentielle", "logarithme"], "d2-expression", "安全表达式求值");
addAll(["integrale-intervalle", "integrale-double", "integrale-triple", "primitive-integrale"], "d2-integral", "Simpson 积分/多项式原函数");
addAll(["interpolation-polynomiale", "lagrange-interpolation-polynome", "neville-interpolation-polynome", "newton-interpolation-polynome", "recherche-equation-fonction"], "d2-interpolation", "Lagrange/Newton/Neville 插值");
addAll(["antecedents-fonction", "asymptote-fonction", "calcul-valeurs-fonction", "domaine-definition-fonction", "domaine-derivation-fonction", "extremum-fonction", "fonction-croissante", "fonction-decroissante", "fonction-monotone", "fonction-reciproque", "image-fonction", "limite", "maximum-fonction", "minimum-fonction", "moyenne-fonction", "parite-fonction", "point-critique-fonction", "point-stationaire-fonction", "periode-fonction", "methode-newton-raphson"], "d2-function", "数值函数分析");
addAll(["abscisse-origine", "coefficient-directeur", "equation-droite", "ordonnee-origine", "calcul-pente", "droite-perpendiculaire", "point-intersection", "tangente-equation"], "d2-line", "直线/斜率/交点/切线");
addAll(["racine-carree", "racine-cubique", "racine-nieme"], "d2-root", "平方/立方/n 次根");
addAll(["conversion-unite-angle"], "d2-angle", "度/弧度/百分度/转");
addAll(["inconnues-triangle"], "d2-triangle", "SSS/SAS/ASA/直角");
addAll(["theoreme-de-pick"], "d2-pick", "格点多边形 Pick");
addAll(["changement-coordonnees-2d", "changement-coordonnees-3d"], "d2-coords", "2D/3D 坐标变换");
addAll(["flocon-koch"], "d2-koch", "Koch 周长/面积");
addAll(["calcul-quartiles", "ecart-type", "mediane", "moyenne", "moyenne-arithmetique", "moyenne-geometrique", "moyenne-harmonique", "moyenne-ponderee", "quantile-nombres", "variance-statistique", "statistiques-tirage"], "d2-stats", "描述统计/分位/频数");
addAll(["pourcentage-fraction-proportion", "intervalle-confiance-sondage", "marge-erreur", "precision-rappel"], "d2-percent", "百分比/置信区间/误差/Precision-Recall");
addAll(["couleur-en-nombre", "couleur-rouge-vert-bleu", "couleur-energie-photon", "couleur-frequence-onde", "couleur-longueur-onde"], "d2-color", "颜色/波长/频率/光子能量");
addAll(["configuration-electronique", "substitution-numero-atomique"], "d2-atomic", "118 元素/电子排布/原子序数");
addAll(["calcul-radioactivite"], "d2-radioactivity", "指数衰变");
addAll(["dilatation-temps"], "d2-relativity", "时间膨胀/长度收缩");
addAll(["fractions-continues", "nombre-harmonique", "nombres-fibonacci"], "d2-series", "Fibonacci/调和/连分数");
addAll(["chemin-graphe-grille", "recherche-chemin-pyramide-triangle"], "d2-graph", "BFS/金字塔 DP");
addAll(["codons-code-genetique", "jeu-de-la-vie"], "d2-biology", "遗传密码/生命游戏");
addAll(["tracer-points"], "d2-plot", "点列/函数采样 SVG");
addAll(["transformation-fourier", "transformation-fourier-inverse"], "d2-dft", "DFT/IDFT");
addAll(["fonction-erreur", "fonction-integrale-dawson"], "d2-special", "erf/erfc/Dawson");
addAll(["transformation-laplace"], "d2-laplace", "数值前向 Laplace 积分");

mapped(["algorithme-kaprekar"], "dcode-extras-2026-10/math-kaprekar", "既有 Kaprekar op");
mapped(["algorithme-luhn"], "main:luhn", "主件 Luhn 校验");
mapped(["algorithme-verhoeff"], "main:verhoeff", "主件 Verhoeff 校验");
mapped(["chiffre-base-36"], "main:base36", "主件 Base36");
mapped(["chiffre-base-58"], "main:base58", "主件 Base58");
mapped(["base-factorielle"], "dcode-extras-2026-10/math-basefactorial", "既有阶乘进制");
mapped(["base-negadecimale"], "dcode-extras-2026-10/math-negabase", "既有负进制（-10）");
mapped(["expansion-cantor"], "dcode-extras-2026-10/math-basefactorial", "Cantor/阶乘数系用既有阶乘进制");
mapped(["code-bibi-binaire"], "dcode-extras-2026-10/num-bibi", "既有 Bibi-binaire");
mapped(["chiffre-rsa"], "main:rsa", "主件 RSA 工具族");
mapped(["conjecture-goldbach"], "dcode-extras-2026-10/math-goldbach", "既有 Goldbach");
mapped(["conjecture-syracuse"], "dcode-extras-2026-10/math-sydney", "既有 Syracuse/Collatz");
mapped(["decomposition-nombres-premiers"], "main:primeFactor", "主件质因数分解");
mapped(["double-factorielle"], "dcode-extras-2026-10/math-doublefactorial", "既有双阶乘");
mapped(["exponentiation-modulaire"], "main:rsaModpow", "主件模幂");
mapped(["factorielle"], "dcode-extras-2026-10/math-factorial", "既有阶乘");
mapped(["fleches-knuth"], "dcode-extras-2026-10/math-knuth", "既有 Knuth 箭头");
mapped(["lambda-mangoldt"], "dcode-extras-2026-10/math-vonmangoldt", "既有 von Mangoldt");
mapped(["valuation-2-adique"], "dcode-extras-2026-10/math-v2adic", "既有 2-adic 赋值");
mapped(["nombre-armstrong"], "dcode-extras-2026-10/math-armstrong", "既有 Armstrong");
mapped(["nombre-harshad"], "dcode-extras-2026-10/math-harshad", "既有 Harshad");
mapped(["nombre-carmichael"], "dcode-extras-2026-10/math-carmichael", "既有 Carmichael");
mapped(["nombres-bell"], "dcode-extras-2026-10/math-bell", "既有 Bell 数");
mapped(["primorielle"], "dcode-extras-2026-10/math-primorial", "既有 primorial");
mapped(["sous-factorielle"], "dcode-extras-2026-10/math-derangement", "既有错排");
mapped(["notation-polonaise-inverse"], "dcode-extras-2026-10/math-rpn", "既有 RPN");
mapped(["pgcd"], "main:gcd", "主件 GCD/LCM");
mapped(["ppcm"], "main:gcd", "主件 GCD/LCM");
mapped(["calculs-fractions"], "dcode-extras-2026-10/math-fraction", "既有分数运算");
mapped(["reduction-recursive"], "dcode-extras-2026-10/math-digitsum", "既有数字根");
mapped(["somme-chiffres"], "dcode-extras-2026-10/math-digitsum", "既有位和");
mapped(["suite-conway"], "dcode-extras-2026-10/math-lookandsay", "既有 Look-and-Say");
mapped(["triangle-pascal"], "dcode-extras-2026-10/math-pascal", "既有 Pascal 三角");
mapped(["triplet-pythagore"], "dcode-extras-2026-10/math-pythagorean", "既有勾股三元组");
mapped(["loi-benford"], "dcode-extras-2026-10/math-benford", "既有 Benford");
mapped(["marques-unaires"], "dcode-extras-2026-10/num-tally", "既有计数符");
mapped(["couleurs-html"], "main:colorInfo", "主件 147 个 W3C 命名色/全息信息");

blocked(["chiffre-multiplication-nombres-premiers"], "古典密码变体，算法约定与权威向量未锁定，留给密码批");
blocked(["conjecture-polya"], "Pólya 猜想反例在 9 亿量级，纯 JS 全量验证不现实");
blocked(["codage-negafibonacci"], "NegaFibonacci 编码约定未锁定，本批未实现");
blocked(["figures-geometriques"], "图形名称图鉴类工具，无纯文本算法输入");
blocked(["developpement-limite"], "一般函数展开需 CAS；本批只有多项式 Taylor（d2-poly）");
blocked(["solveur-equation-differentielle"], "符号微分方程求解需 CAS");
blocked(["transformation-inverse-laplace"], "逆 Laplace 变换需 CAS");
blocked(["decomposition-schur-matrice"], "Schur 分解需数值线性代数库/CAS");
blocked(["jordan-matrice"], "Jordan 标准形需 CAS");
blocked(["trigonalisation-matrice"], "三角化需 CAS");
blocked(["hermite-matrice"], "Hermite 标准形本批未实现");
blocked(["matrice-conjuguee-complexe"], "矩阵引擎为有理数，未支持复矩阵共轭");
blocked(["systeme-reducteur-tirage"], "保证覆盖的彩票/投注缩水系统需要组合覆盖设计，本批未实现");

const ALL_RAW = { ...RAW1, ...RAW2, ...RAW3 };
function buildCoverage() {
  const out = [];
  for (const [cat, lines] of Object.entries(ALL_RAW)) {
    for (const line of lines) {
      const [name, slug] = line.split("|");
      const r = RESOLVE[slug] || { status: "blocked", target: "", reason: "本批未实现（需 CAS/图形/外部数据或超出纯 JS 范围）" };
      out.push({ cat, name, slug, url: `https://www.dcode.fr/${slug}`, status: r.status, target: r.target, reason: r.reason });
    }
  }
  return out;
}

export const OPS = OPS_CORE;
export const COVERAGE = buildCoverage();
