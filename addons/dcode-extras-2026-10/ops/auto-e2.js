/*
 * dcode-extras · Agent E2 · 数学阻塞项攻坚 + 公式缺口补齐
 * 纯 JS 实现：泰勒级数、逆 Laplace（有理函数）、Schur/三角化、Hermite 标准形、
 * 复矩阵、轮转覆盖、NegaFibonacci、几何图形命名、数值 ODE、数独/填色推理等。
 * 一切输入有界，超限显式报错；无外部 CAS/网络。
 */

import { runOp, big, isPrime, factorizeBounded, powmod, binom, parseNums } from "../lib/util.js";

const CAT = "dcode-extras-2026-10/cat-math";
const P = (key, label, ph) => ({ key, label, type: "text", default: "", placeholder: ph || "" });
const SEL = (key, label, def, opts) => ({ key, label, type: "select", default: def, options: opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o)) });

const MAX_N = 40;
const MAX_MATRIX = 10;

function err(msg) { throw new Error(msg); }
function absB(x) { return x < 0n ? -x : x; }
function gcdB(a, b) { a = absB(a); b = absB(b); while (b) { const t = a % b; a = b; b = t; } return a; }
function lcmB(a, b) { if (a === 0n || b === 0n) return 0n; return absB(a / gcdB(a, b) * b); }
function modB(a, m) { if (m <= 0n) err("模数必须为正"); const r = a % m; return r < 0n ? r + m : r; }
function divFloor(a, b) { let q = a / b; if (a % b !== 0n && ((a < 0n) !== (b < 0n))) q -= 1n; return q; }

function R(n, d = 1n) {
  if (d === 0n) err("分母不能为 0");
  if (d < 0n) { n = -n; d = -d; }
  const g = gcdB(n, d) || 1n;
  return [n / g, d / g];
}
const RZ = [0n, 1n];
const RO = [1n, 1n];
const rIsZero = (a) => a[0] === 0n;
const rNeg = (a) => [-a[0], a[1]];
const rAdd = (a, b) => R(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const rSub = (a, b) => R(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const rMul = (a, b) => R(a[0] * b[0], a[1] * b[1]);
const rDiv = (a, b) => { if (rIsZero(b)) err("有理数除以 0"); return R(a[0] * b[1], a[1] * b[0]); };
const rEq = (a, b) => a[0] * b[1] === b[0] * a[1];
const rStr = (a) => (a[1] === 1n ? a[0].toString() : `${a[0]}/${a[1]}`);
const rNum = (a) => Number(a[0]) / Number(a[1]);

function factorialB(n) { let r = 1n; for (let i = 2; i <= n; i++) r *= BigInt(i); return r; }

function parseRat(src, what = "有理数") {
  const t = String(src).trim().replace(/−/g, "-");
  let m = t.match(/^([+-]?\d+)\s*\/\s*(\d+)$/);
  if (m) return R(BigInt(m[1]), BigInt(m[2]));
  m = t.match(/^([+-]?)(\d*)\.(\d+)$/);
  if (m) {
    const sign = m[1] === "-" ? -1n : 1n;
    const ip = m[2] ? BigInt(m[2]) : 0n;
    const den = 10n ** BigInt(m[3].length);
    return R(sign * (ip * den + BigInt(m[3])), den);
  }
  if (/^[+-]?\d+$/.test(t)) return R(BigInt(t));
  err(`无法解析${what}「${src}」`);
}

function parseIntVal(src, what, lo, hi) {
  const v = Number(String(src).trim());
  if (!Number.isInteger(v)) err(`${what}必须为整数`);
  if (v < lo || v > hi) err(`${what}需在 ${lo}..${hi}`);
  return v;
}

function pTrim(a) {
  const out = a.slice();
  while (out.length > 1 && rIsZero(out[out.length - 1])) out.pop();
  if (!out.length) out.push(RZ);
  return out;
}
function pDeg(a) { return pTrim(a.slice()).length - 1; }
function pIsZero(a) { return pDeg(a) === 0 && rIsZero(pTrim(a.slice())[0]); }
function pAdd(a, b) { const n = Math.max(a.length, b.length), o = []; for (let i = 0; i < n; i++) o.push(rAdd(a[i] || RZ, b[i] || RZ)); return pTrim(o); }
function pSub(a, b) { const n = Math.max(a.length, b.length), o = []; for (let i = 0; i < n; i++) o.push(rSub(a[i] || RZ, b[i] || RZ)); return pTrim(o); }
function pScale(a, k) { return pTrim(a.map((x) => rMul(x, k))); }
function pShift(a, k) { return pTrim(Array(k).fill(RZ).concat(a)); }
function pMul(a, b) {
  const o = Array(a.length + b.length - 1).fill(RZ);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) o[i + j] = rAdd(o[i + j], rMul(a[i], b[j]));
  return pTrim(o);
}
function pPow(a, e) { let r = [RO]; for (let i = 0; i < e; i++) r = pMul(r, a); return pTrim(r); }
function pEval(a, x) { let v = RZ; for (let i = a.length - 1; i >= 0; i--) v = rAdd(rMul(v, x), a[i]); return v; }
function pDivMod(a, b) {
  const B = pTrim(b.slice());
  if (pIsZero(B)) err("多项式除数不能为 0");
  let r = pTrim(a.slice());
  const q = Array(Math.max(0, pDeg(r) - pDeg(B) + 1)).fill(RZ);
  while (pDeg(r) >= pDeg(B) && !pIsZero(r)) {
    const k = pDeg(r) - pDeg(B);
    const c = rDiv(r[pDeg(r)], B[pDeg(B)]);
    q[k] = rAdd(q[k], c);
    r = pSub(r, pShift(pScale(B, c), k));
  }
  return { q: pTrim(q), r: pTrim(r) };
}
function pStr(a) {
  const t = pTrim(a.slice());
  const terms = [];
  for (let i = t.length - 1; i >= 0; i--) {
    if (rIsZero(t[i])) continue;
    const c = t[i];
    const mon = i === 0 ? "" : i === 1 ? "s" : `s^${i}`;
    let body;
    if (i === 0) body = rStr(c);
    else if (c[0] === 1n && c[1] === 1n) body = mon;
    else if (c[0] === -1n && c[1] === 1n) body = "-" + mon;
    else body = `${rStr(c)}*${mon}`;
    if (!terms.length) terms.push(body);
    else if (body.startsWith("-")) terms.push(" - " + body.slice(1));
    else terms.push(" + " + body);
  }
  return terms.length ? terms.join("") : "0";
}

function tokenizeExpr(src) {
  const s = String(src).replace(/\s+/g, "").replace(/−/g, "-").replace(/×/g, "*").replace(/÷/g, "/").replace(/π/g, "pi");
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      out.push({ t: "num", v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z_0-9]/.test(s[j])) j++;
      out.push({ t: "id", v: s.slice(i, j).toLowerCase() });
      i = j;
      continue;
    }
    if ("+-*/^()".includes(c)) { out.push({ t: "op", v: c }); i++; continue; }
    err(`表达式含非法字符「${c}」`);
  }
  return out;
}

function seriesParser(src, N, varName) {
  const toks = tokenizeExpr(src);
  let pos = 0;
  const peek = () => toks[pos];
  const eat = (v) => { const t = toks[pos]; if (!t || (v && t.v !== v)) err(`表达式语法错误：期望「${v}」`); pos++; return t; };
  const zeros = () => Array(N + 1).fill(RZ);
  const startsPrimary = (t) => !!t && (t.t === "num" || t.t === "id" || (t.t === "op" && t.v === "("));
  function parseExpr() {
    let v = parseTerm();
    while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = eat().v;
      const w = parseTerm();
      v = op === "+" ? sAdd(v, w, N) : sSub(v, w, N);
    }
    return v;
  }
  function parseTerm() {
    let v = parseFactor();
    for (;;) {
      const t = peek();
      if (t && t.t === "op" && (t.v === "*" || t.v === "/")) {
        const op = eat().v;
        const w = parseFactor();
        v = op === "*" ? sMul(v, w, N) : sDiv(v, w, N);
      } else if (startsPrimary(t)) {
        v = sMul(v, parseFactor(), N);
      } else break;
    }
    return v;
  }
  function parseFactor() {
    let v = parseUnary();
    if (peek() && peek().t === "op" && peek().v === "^") {
      eat("^");
      let sign = 1;
      if (peek() && peek().t === "op" && peek().v === "-") { sign = -1; eat("-"); }
      const t = eat();
      if (t.t !== "num" || !/^\d+$/.test(t.v)) err("指数必须是非负整数");
      const e = Number(t.v) * sign;
      if (e < 0 || e > 64) err("指数需在 0..64");
      v = sPow(v, e, N);
    }
    return v;
  }
  function parseUnary() {
    if (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = eat().v;
      const v = parseUnary();
      return op === "-" ? sScale(v, R(-1n)) : v;
    }
    return parsePrimary();
  }
  function parsePrimary() {
    const t = eat();
    if (t.t === "num") {
      const c = parseRat(t.v);
      const a = zeros(); a[0] = c; return a;
    }
    if (t.t === "id") {
      const name = t.v;
      if (name === varName) { const a = zeros(); if (N >= 1) a[1] = RO; return a; }
      if (name === "pi" || name === "e") err("本展开只接受有理系数，不把 pi/e 当有理数");
      if (!peek() || peek().v !== "(") err(`函数 ${name} 缺少括号`);
      eat("(");
      const arg = parseExpr();
      eat(")");
      return applySeriesFn(name, arg, N);
    }
    if (t.t === "op" && t.v === "(") {
      const v = parseExpr();
      eat(")");
      return v;
    }
    err("表达式语法错误：缺少数字、变量或括号");
  }
  const v = parseExpr();
  if (pos !== toks.length) err("表达式尾部存在多余内容");
  return v;
}

function sAdd(a, b, N) { const o = []; for (let i = 0; i <= N; i++) o.push(rAdd(a[i] || RZ, b[i] || RZ)); return o; }
function sSub(a, b, N) { const o = []; for (let i = 0; i <= N; i++) o.push(rSub(a[i] || RZ, b[i] || RZ)); return o; }
function sScale(a, k) { return a.map((x) => rMul(x, k)); }
function sMul(a, b, N) {
  const o = Array(N + 1).fill(RZ);
  for (let i = 0; i <= N; i++) {
    if (rIsZero(a[i] || RZ)) continue;
    for (let j = 0; i + j <= N; j++) {
      if (rIsZero(b[j] || RZ)) continue;
      o[i + j] = rAdd(o[i + j], rMul(a[i], b[j]));
    }
  }
  return o;
}
function sDiv(a, b, N) {
  if (rIsZero(b[0] || RZ)) err("级数除法要求除数常数项非 0");
  const o = Array(N + 1).fill(RZ);
  for (let k = 0; k <= N; k++) {
    let v = a[k] || RZ;
    for (let j = 1; j <= k; j++) v = rSub(v, rMul(o[k - j], b[j] || RZ));
    o[k] = rDiv(v, b[0]);
  }
  return o;
}
function sPow(a, e, N) { let r = Array(N + 1).fill(RZ); r[0] = RO; for (let i = 0; i < e; i++) r = sMul(r, a, N); return r; }
function sZeroArg(v, name) { if (!rIsZero(v[0])) err(`${name} 的展开要求参数常数项为 0`); }
function sOneArg(v, name) { if (!rEq(v[0], RO)) err(`${name} 的展开要求参数常数项为 1`); }

function applySeriesFn(name, v, N) {
  const z = v.slice(0, N + 1);
  if (name === "sin") {
    sZeroArg(z, "sin");
    const z2 = sMul(z, z, N);
    let out = Array(N + 1).fill(RZ);
    let term = z.slice();
    for (let k = 0; 2 * k + 1 <= N; k++) {
      out = sAdd(out, sScale(term, R(k % 2 ? -1n : 1n, factorialB(2 * k + 1))), N);
      term = sMul(term, z2, N);
    }
    return out;
  }
  if (name === "cos") {
    sZeroArg(z, "cos");
    const z2 = sMul(z, z, N);
    let out = Array(N + 1).fill(RZ);
    let term = Array(N + 1).fill(RZ); term[0] = RO;
    for (let k = 0; 2 * k <= N; k++) {
      out = sAdd(out, sScale(term, R(k % 2 ? -1n : 1n, factorialB(2 * k))), N);
      term = sMul(term, z2, N);
    }
    return out;
  }
  if (name === "exp") {
    sZeroArg(z, "exp");
    let out = Array(N + 1).fill(RZ);
    let term = Array(N + 1).fill(RZ); term[0] = RO;
    for (let k = 0; k <= N; k++) {
      out = sAdd(out, term, N);
      term = sMul(term, z, N);
      term = sScale(term, R(1n, BigInt(k + 1)));
    }
    return out;
  }
  if (name === "log" || name === "ln") {
    sOneArg(z, "log");
    const w = z.slice(); w[0] = rSub(w[0], RO);
    let out = Array(N + 1).fill(RZ);
    let term = w.slice();
    for (let k = 1; k <= N; k++) {
      out = sAdd(out, sScale(term, R(k % 2 ? 1n : -1n, BigInt(k))), N);
      term = sMul(term, w, N);
    }
    return out;
  }
  if (name === "sqrt") {
    sOneArg(z, "sqrt");
    const w = z.slice(); w[0] = rSub(w[0], RO);
    let out = Array(N + 1).fill(RZ);
    out[0] = RO;
    let term = Array(N + 1).fill(RZ); term[0] = RO;
    let c = RO;
    for (let k = 1; k <= N; k++) {
      term = sMul(term, w, N);
      c = rMul(c, R(3n - 2n * BigInt(k), 2n * BigInt(k)));
      out = sAdd(out, sScale(term, c), N);
    }
    return out;
  }
  if (name === "atan") {
    sZeroArg(z, "atan");
    const z2 = sMul(z, z, N);
    let out = Array(N + 1).fill(RZ);
    let term = z.slice();
    for (let k = 0; 2 * k + 1 <= N; k++) {
      out = sAdd(out, sScale(term, R(k % 2 ? -1n : 1n, BigInt(2 * k + 1))), N);
      term = sMul(term, z2, N);
    }
    return out;
  }
  if (name === "sinh") {
    sZeroArg(z, "sinh");
    const z2 = sMul(z, z, N);
    let out = Array(N + 1).fill(RZ);
    let term = z.slice();
    for (let k = 0; 2 * k + 1 <= N; k++) {
      out = sAdd(out, sScale(term, R(1n, factorialB(2 * k + 1))), N);
      term = sMul(term, z2, N);
    }
    return out;
  }
  if (name === "cosh") {
    sZeroArg(z, "cosh");
    const z2 = sMul(z, z, N);
    let out = Array(N + 1).fill(RZ);
    let term = Array(N + 1).fill(RZ); term[0] = RO;
    for (let k = 0; 2 * k <= N; k++) {
      out = sAdd(out, sScale(term, R(1n, factorialB(2 * k))), N);
      term = sMul(term, z2, N);
    }
    return out;
  }
  if (name === "tan") return sDiv(applySeriesFn("sin", z, N), applySeriesFn("cos", z, N), N);
  if (name === "tanh") return sDiv(applySeriesFn("sinh", z, N), applySeriesFn("cosh", z, N), N);
  err(`不支持的函数「${name}」`);
}

function seriesStr(a, N) {
  const terms = [];
  for (let k = 0; k <= N; k++) {
    const c = a[k] || RZ;
    if (rIsZero(c)) continue;
    const neg = c[0] < 0n;
    const n = absB(c[0]), d = c[1];
    let body;
    if (k === 0) body = rStr([n, d]);
    else {
      let mon = k === 1 ? "x" : `x^${k}`;
      if (d === 1n) body = `${n === 1n ? "" : n.toString()}${mon}`;
      else if (n === 1n) body = `${mon}/${d}`;
      else body = `${n}/${d}*${mon}`;
    }
    terms.push((neg ? "-" : "") + body);
  }
  if (!terms.length) return "0";
  let out = terms[0];
  for (let i = 1; i < terms.length; i++) out += terms[i].startsWith("-") ? " - " + terms[i].slice(1) : " + " + terms[i];
  return out;
}

function parsePolyExpr(src, varName = "s", N = 24) {
  const a = seriesParser(src, N, varName);
  return pTrim(a.slice(0, N + 1));
}

function splitTopSlash(src) {
  let depth = 0, at = -1;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "/" && depth === 0) {
      if (at >= 0) err("只支持一个顶层除号");
      at = i;
    }
  }
  return at < 0 ? [src, "1"] : [src.slice(0, at), src.slice(at + 1)];
}

function polyToInt(p) {
  let L = 1n;
  for (const c of p) L = lcmB(L, c[1]);
  let ints = p.map((c) => c[0] * (L / c[1]));
  let g = 0n;
  for (const x of ints) g = gcdB(g, absB(x));
  if (g > 1n) ints = ints.map((x) => x / g);
  return ints;
}

function divisorsOf(n) {
  n = absB(n);
  if (n === 0n) return [];
  if (n === 1n) return [1n];
  const { factors, complete } = factorizeBounded(n);
  if (!complete) err("常数项过大，无法枚举有理根");
  let out = [1n];
  for (const [p, e] of factors) {
    if (p <= 1n) continue;
    const base = out.slice();
    let mul = 1n;
    for (let i = 0; i < Number(e); i++) {
      mul *= p;
      for (const d of base) out.push(d * mul);
    }
  }
  return out;
}

function ratRootsOf(p) {
  let q = pTrim(p.slice());
  const roots = [];
  let zeros = 0;
  while (q.length > 1 && rIsZero(q[0])) { q = pTrim(q.slice(1)); zeros++; }
  if (zeros) roots.push({ root: RZ, mult: zeros });
  if (pDeg(q) <= 0) return { roots, rem: q };
  const ints = polyToInt(q);
  const lead = ints[ints.length - 1], cons = ints[0];
  if (cons === 0n || lead === 0n) err("有理根枚举失败：常数为 0");
  const pd = divisorsOf(cons), qd = divisorsOf(lead);
  if (pd.length * qd.length > 40000) err("有理根候选过多，请缩小系数");
  const seen = new Set();
  const cands = [];
  for (const a of pd) for (const b of qd) for (const s of [1n, -1n]) {
    const key = `${s * a}/${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cands.push(R(s * a, b));
  }
  for (const c of cands) {
    let m = 0;
    while (pDeg(q) > 0 && rIsZero(pEval(q, c))) {
      q = pDivMod(q, [rNeg(c), RO]).q;
      m++;
      if (m > 20) err("重根次数异常");
    }
    if (m) roots.push({ root: c, mult: m });
  }
  return { roots, rem: q };
}

function solveRatSystem(rows, rhs) {
  const n = rows.length;
  if (!n) return [];
  const m = rows[0].length;
  const a = rows.map((r, i) => r.concat([rhs[i] || RZ]));
  let rank = 0;
  for (let col = 0; col < m && rank < n; col++) {
    let piv = -1;
    for (let i = rank; i < n; i++) if (!rIsZero(a[i][col])) { piv = i; break; }
    if (piv < 0) continue;
    [a[rank], a[piv]] = [a[piv], a[rank]];
    const pv = a[rank][col];
    for (let j = col; j <= m; j++) a[rank][j] = rDiv(a[rank][j], pv);
    for (let i = 0; i < n; i++) {
      if (i === rank || rIsZero(a[i][col])) continue;
      const f = a[i][col];
      for (let j = col; j <= m; j++) a[i][j] = rSub(a[i][j], rMul(f, a[rank][j]));
    }
    rank++;
  }
  for (let i = rank; i < n; i++) if (!rIsZero(a[i][m])) err("部分分式方程无解");
  if (rank < m) err("部分分式系数不唯一，超出本实现");
  const x = Array(m).fill(RZ);
  for (let i = 0; i < rank; i++) {
    let col = -1;
    for (let j = 0; j < m; j++) if (!rIsZero(a[i][j])) { col = j; break; }
    if (col >= 0) x[col] = a[i][m];
  }
  return x;
}

function fmtNum(x, digits = 8) {
  if (!Number.isFinite(x)) err("数值溢出");
  const s = x.toFixed(digits).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

function expFactor(root) {
  if (rEq(root, RO)) return "e^(t)";
  if (rEq(root, [-1n, 1n])) return "e^(-t)";
  return `e^(${rStr(root)}t)`;
}

function invLaplace(src) {
  const [ns, ds] = splitTopSlash(String(src).trim());
  if (!ns.trim() || !ds.trim()) err("分式不完整");
  const N = pTrim(parsePolyExpr(ns, "s"));
  const D = pTrim(parsePolyExpr(ds, "s"));
  if (pDeg(D) < 1) err("分母必须是非常数多项式");
  if (pDeg(N) >= pDeg(D)) err("只支持真分式（分子次数 < 分母次数）");
  if (pDeg(D) > 10) err("分母次数上限 10");
  const { roots, rem } = ratRootsOf(D);
  const factors = roots.map((r) => ({ type: "lin", root: r.root, mult: r.mult }));
  let quad = null;
  const R2 = pTrim(rem);
  if (pDeg(R2) === 2) {
    const disc = rSub(rMul(R2[1], R2[1]), rMul(R(4n), rMul(R2[2], R2[0])));
    if (disc[0] >= 0n) err("分母剩余二次因子有实根但不是有理根，需 CAS/数值分解");
    quad = { type: "quad", b: R2[1], c: R2[0], mult: 1 };
    factors.push(quad);
  } else if (pDeg(R2) > 0) {
    err("分母含非有理根高次不可约因子，部分分式需 CAS");
  }
  if (!factors.length) err("分母没有可用因子");
  const factorPolyOf = (f) => (f.type === "lin" ? [rNeg(f.root), RO] : [f.c, f.b, RO]);
  const productExcept = (idx) => {
    let p = [RO];
    for (let i = 0; i < factors.length; i++) if (i !== idx) p = pMul(p, factorPolyOf(factors[i]));
    return pTrim(p);
  };
  const cols = [];
  for (let fi = 0; fi < factors.length; fi++) {
    const f = factors[fi];
    if (f.type === "lin") {
      for (let j = 1; j <= f.mult; j++) {
        let basis = productExcept(fi);
        basis = pMul(basis, pPow([rNeg(f.root), RO], f.mult - j));
        cols.push({ kind: "lin", root: f.root, power: j, basis: pTrim(basis) });
      }
    } else {
      const base = productExcept(fi);
      cols.push({ kind: "quadB", b: f.b, c: f.c, basis: pTrim(pMul(base, [RZ, RO])) });
      cols.push({ kind: "quadC", b: f.b, c: f.c, basis: pTrim(base) });
    }
  }
  const deg = pDeg(D);
  const M = [];
  for (let k = 0; k < deg; k++) M.push(cols.map((c) => c.basis[k] || RZ));
  const rhs = [];
  for (let k = 0; k < deg; k++) rhs.push(N[k] || RZ);
  const coef = solveRatSystem(M, rhs);
  const terms = [];
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i];
    if (col.kind === "lin") {
      const C = coef[i];
      if (rIsZero(C)) continue;
      const p = col.power;
      const c = rMul(C, R(1n, factorialB(p - 1)));
      if (rIsZero(c)) continue;
      const mono = p === 1 ? "" : p === 2 ? "t" : `t^${p - 1}`;
      const exp = rIsZero(col.root) ? "" : expFactor(col.root);
      const cs = rStr(c);
      let base;
      if (!mono) base = cs;
      else if (cs === "1") base = mono;
      else if (cs === "-1") base = "-" + mono;
      else base = `${cs}*${mono}`;
      let body = base;
      if (exp) {
        if (base === "1") body = exp;
        else if (base === "-1") body = "-" + exp;
        else body = `${base}*${exp}`;
      }
      terms.push(body);
    } else if (col.kind === "quadB") {
      const B = rNum(coef[i]);
      const Cc = rNum(coef[i + 1] || RZ);
      if (B === 0 && Cc === 0) { i++; continue; }
      const aRat = rDiv(col.b, R(2n));
      const w2 = rSub(col.c, rMul(aRat, aRat));
      if (w2[0] <= 0n) err("二次因子配平方失败");
      const a = rNum(aRat);
      const w = Math.sqrt(rNum(w2));
      const Dcoef = (Cc - B * a) / w;
      const exp = a === 0 ? "" : (a === -1 ? "e^(t)" : a === 1 ? "e^(-t)" : `e^(${fmtNum(-a)}t)`);
      const arg = w === 1 ? "t" : `${fmtNum(w)}*t`;
      const parts = [];
      if (B !== 0 || Dcoef === 0) {
        const cs = B === 1 ? "" : B === -1 ? "-" : fmtNum(B) + "*";
        parts.push(`${cs}cos(${arg})`);
      }
      if (Dcoef !== 0) {
        const ds = Dcoef === 1 ? "" : Dcoef === -1 ? "-" : fmtNum(Math.abs(Dcoef)) + "*";
        const sign = Dcoef < 0 ? (parts.length ? " - " : "-") : (parts.length ? " + " : "");
        parts.push(`${sign}${ds}sin(${arg})`);
      }
      const inner = parts.join("");
      terms.push(exp ? `${exp}*(${inner})` : `(${inner})`);
      i++;
    }
  }
  const body = terms.length ? terms.join(" + ").replace(/\+ -/g, "- ") : "0";
  return `F(s) = (${pStr(N)}) / (${pStr(D)})\nf(t) = ${body}`;
}

const OPS_CORE = [
  runOp("e2-taylor", CAT, "泰勒/幂级数展开（有理系数）", "对 sin/cos/tan/exp/log/sqrt/atan/sinh/cosh/tanh 及四则、整数幂表达式在 x=0 处展开到指定阶；系数为精确有理数", (text, p) => {
    const src = String(text || "").trim() || String(p.expr || "").trim();
    if (!src) err("请输入函数表达式，如 sin(x)");
    const N = parseIntVal(p.n || 8, "展开阶数", 1, 30);
    const a = seriesParser(src, N, "x");
    return `f(x) = ${seriesStr(a, N)} + O(x^${N + 1})`;
  }, [P("expr", "函数表达式", "sin(x)"), P("n", "展开阶数", "8")]),

  runOp("e2-invlaplace", CAT, "逆 Laplace 变换（有理函数）", "对真分式 F(s)=P(s)/Q(s) 做部分分式分解，分母限一次/共轭二次因子（次数≤10），输出 e^(rt)、t^n e^(rt)、e^(at)(cos+sin) 组合", (text, p) => {
    const src = String(text || "").trim() || String(p.expr || "").trim();
    if (!src) err("请输入 F(s)，如 1/(s^2+1)");
    return invLaplace(src);
  }, [P("expr", "F(s)", "1/(s^2+1)")]),
];

function parseMatrix(text, what = "矩阵") {
  const lines = String(text || "").trim().split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (!lines.length) err(`请输入${what}`);
  if (lines.length > MAX_MATRIX) err(`${what}行数上限 ${MAX_MATRIX}`);
  const m = lines.map((line) => line.split(/[\s,]+/).map((x) => {
    const v = Number(x);
    if (!Number.isFinite(v)) err(`${what}含非数字项「${x}」`);
    return v;
  }));
  const n = m[0].length;
  if (!n) err(`${what}为空`);
  if (n > MAX_MATRIX) err(`${what}列数上限 ${MAX_MATRIX}`);
  if (!m.every((r) => r.length === n)) err(`${what}各行长度不一致`);
  return m;
}

function matId(n) { return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))); }
function matMulN(a, b) {
  const n = a.length, m = b[0].length, k = b.length;
  const o = Array.from({ length: n }, () => Array(m).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { let s = 0; for (let t = 0; t < k; t++) s += a[i][t] * b[t][j]; o[i][j] = s; }
  return o;
}
function matT(a) { return a[0].map((_, j) => a.map((r) => r[j])); }
function matMaxAbs(a) { let v = 0; for (const r of a) for (const x of r) v = Math.max(v, Math.abs(x)); return v; }
function matStr(a, fmt = (x) => fmtNum(x, 8)) { return a.map((r) => r.map(fmt).join(" ")).join("\n"); }
function matNear(a, b, tol = 1e-7) { if (a.length !== b.length || a[0].length !== b[0].length) return false; for (let i = 0; i < a.length; i++) for (let j = 0; j < a[0].length; j++) if (Math.abs(a[i][j] - b[i][j]) > tol) return false; return true; }

function qrDecomp(a) {
  const n = a.length;
  const R = a.map((r) => r.slice());
  const Q = matId(n);
  for (let k = 0; k < n; k++) {
    let norm = 0;
    for (let i = k; i < n; i++) norm += R[i][k] * R[i][k];
    norm = Math.sqrt(norm);
    if (norm < 1e-15) continue;
    const alpha = R[k][k] >= 0 ? -norm : norm;
    const v = [];
    for (let i = k; i < n; i++) v.push(R[i][k]);
    v[0] -= alpha;
    let vn = 0;
    for (const x of v) vn += x * x;
    vn = Math.sqrt(vn);
    if (vn < 1e-15) continue;
    for (let i = 0; i < v.length; i++) v[i] /= vn;
    for (let j = k; j < n; j++) {
      let dot = 0;
      for (let i = 0; i < v.length; i++) dot += v[i] * R[k + i][j];
      for (let i = 0; i < v.length; i++) R[k + i][j] -= 2 * dot * v[i];
    }
    for (let i = 0; i < n; i++) {
      let dot = 0;
      for (let t = 0; t < v.length; t++) dot += Q[i][k + t] * v[t];
      for (let t = 0; t < v.length; t++) Q[i][k + t] -= 2 * dot * v[t];
    }
  }
  return { Q, R };
}

function jacobiEigen(a, tol = 1e-12, maxIter = 200) {
  const n = a.length;
  const D = a.map((r) => r.slice());
  const V = matId(n);
  for (let it = 0; it < maxIter * n * n; it++) {
    let p = 0, q = 1, best = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const v = Math.abs(D[i][j]);
      if (v > best) { best = v; p = i; q = j; }
    }
    if (best < tol) break;
    const app = D[p][p], aqq = D[q][q], apq = D[p][q];
    const theta = 0.5 * Math.atan2(2 * apq, aqq - app);
    const c = Math.cos(theta), s = Math.sin(theta);
    for (let i = 0; i < n; i++) {
      const dip = D[i][p], diq = D[i][q];
      D[i][p] = c * dip - s * diq;
      D[i][q] = s * dip + c * diq;
    }
    for (let j = 0; j < n; j++) {
      const dpi = D[p][j], dqi = D[q][j];
      D[p][j] = c * dpi - s * dqi;
      D[q][j] = s * dpi + c * dqi;
    }
    for (let i = 0; i < n; i++) {
      const vip = V[i][p], viq = V[i][q];
      V[i][p] = c * vip - s * viq;
      V[i][q] = s * vip + c * viq;
    }
  }
  return { T: D, Q: V };
}

function schurReal(a, tol = 1e-10, maxIter = 2000) {
  const n = a.length;
  let sym = true;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (Math.abs(a[i][j] - a[j][i]) > tol) sym = false;
  if (sym) { const j = jacobiEigen(a, tol); return { T: j.T, Q: j.Q }; }
  let H = a.map((r) => r.slice());
  let Qtot = matId(n);
  let hi = n - 1;
  let iter = 0;
  while (hi > 0 && iter < maxIter) {
    iter++;
    if (Math.abs(H[hi][hi - 1]) < tol * (Math.abs(H[hi][hi]) + Math.abs(H[hi - 1][hi - 1]) + 1)) {
      H[hi][hi - 1] = 0;
      hi--;
      continue;
    }
    if (hi === 1) {
      const tr = H[0][0] + H[1][1], det = H[0][0] * H[1][1] - H[0][1] * H[1][0];
      if (tr * tr - 4 * det < 0) break;
    }
    if (hi >= 1) {
      const tr = H[hi - 1][hi - 1] + H[hi][hi];
      const det = H[hi - 1][hi - 1] * H[hi][hi] - H[hi - 1][hi] * H[hi][hi - 1];
      const disc = tr * tr - 4 * det;
      if (disc < 0 && hi >= 2) { hi -= 2; continue; }
    }
    const tr = H[hi - 1][hi - 1] + H[hi][hi];
    const det = H[hi - 1][hi - 1] * H[hi][hi] - H[hi - 1][hi] * H[hi][hi - 1];
    const disc = tr * tr - 4 * det;
    let mu;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      const l1 = (tr + s) / 2, l2 = (tr - s) / 2;
      mu = Math.abs(l1 - H[hi][hi]) <= Math.abs(l2 - H[hi][hi]) ? l1 : l2;
    } else mu = tr / 2;
    const size = hi + 1;
    const sub = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => H[i][j] - (i === j ? mu : 0)));
    const { Q, R } = qrDecomp(sub);
    const next = matMulN(R, Q);
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) H[i][j] = next[i][j] + (i === j ? mu : 0);
    const Qbig = matId(n);
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) Qbig[i][j] = Q[i][j];
    Qtot = matMulN(Qtot, Qbig);
  }
  return { T: H, Q: Qtot };
}

function cAdd(a, b) { return { re: a.re + b.re, im: a.im + b.im }; }
function cSub(a, b) { return { re: a.re - b.re, im: a.im - b.im }; }
function cMul(a, b) { return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }; }
function cDiv(a, b) { const d = b.re * b.re + b.im * b.im; if (d === 0) err("复数除法分母为 0"); return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; }
function cConj(a) { return { re: a.re, im: -a.im }; }
function cAbs(a) { return Math.hypot(a.re, a.im); }
function cSqrt(a) {
  const r = Math.hypot(a.re, a.im);
  const re = Math.sqrt(Math.max(0, (r + a.re) / 2));
  const im = (a.im < 0 ? -1 : 1) * Math.sqrt(Math.max(0, (r - a.re) / 2));
  return { re, im };
}
function cfmt(z, d = 8) {
  const re = Math.abs(z.re) < 1e-12 ? 0 : z.re;
  const im = Math.abs(z.im) < 1e-12 ? 0 : z.im;
  if (im === 0) return fmtNum(re, d);
  if (re === 0) return `${fmtNum(im, d)}i`;
  return `${fmtNum(re, d)}${im >= 0 ? "+" : ""}${fmtNum(im, d)}i`;
}
function parseComplex(src) {
  let s = String(src).trim().replace(/\s+/g, "").replace(/−/g, "-").replace(/i/g, "i");
  if (!s) err("复数不能为空");
  if (s === "i") return { re: 0, im: 1 };
  if (s === "-i") return { re: 0, im: -1 };
  let m = s.match(/^([+-]?\d+(?:\.\d+)?(?:[+-]\d+(?:\.\d+)?)?)i$/);
  if (m) {
    const part = m[1];
    let cut = -1;
    for (let i = 1; i < part.length; i++) if ((part[i] === "+" || part[i] === "-") && part[i - 1] !== "e") cut = i;
    if (cut > 0) return { re: Number(part.slice(0, cut)), im: Number(part.slice(cut)) || (part.slice(cut) === "+" ? 1 : -1) };
    return { re: 0, im: Number(part) };
  }
  m = s.match(/^([+-]?\d+(?:\.\d+)?(?:[+-]\d+(?:\.\d+)?)?)([+-])i$/);
  if (m) return { re: Number(m[1]), im: m[2] === "-" ? -1 : 1 };
  m = s.match(/^([+-]?\d+(?:\.\d+)?)([+-]\d+(?:\.\d+)?)i$/);
  if (m) return { re: Number(m[1]), im: Number(m[2]) };
  m = s.match(/^([+-]?\d+(?:\.\d+)?)$/);
  if (m) return { re: Number(m[1]), im: 0 };
  err(`无法解析复数「${src}」`);
}
function parseComplexMatrix(text) {
  const lines = String(text || "").trim().split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (!lines.length) err("请输入复矩阵");
  if (lines.length > MAX_MATRIX) err(`矩阵行数上限 ${MAX_MATRIX}`);
  const m = lines.map((line) => line.split(/[\s,]+/).filter(Boolean).map(parseComplex));
  const n = m[0].length;
  if (!n || n > MAX_MATRIX) err(`矩阵列数需在 1..${MAX_MATRIX}`);
  if (!m.every((r) => r.length === n)) err("复矩阵各行长度不一致");
  return m;
}
function cmatStr(a) { return a.map((r) => r.map((z) => cfmt(z)).join(" ")).join("\n"); }
function cmatId(n) { return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => ({ re: i === j ? 1 : 0, im: 0 }))); }
function cmatMul(a, b) {
  const n = a.length, m = b[0].length, k = b.length;
  return Array.from({ length: n }, (_, i) => Array.from({ length: m }, (_, j) => {
    let s = { re: 0, im: 0 };
    for (let t = 0; t < k; t++) s = cAdd(s, cMul(a[i][t], b[t][j]));
    return s;
  }));
}
function cmatT(a) { return a[0].map((_, j) => a.map((r) => r[j])); }
function cmatConj(a) { return a.map((r) => r.map(cConj)); }
function cmatAdj(a) { return cmatConj(cmatT(a)); }
function cqr(a) {
  const n = a.length;
  const Q = Array.from({ length: n }, () => Array(n).fill(null));
  const R = Array.from({ length: n }, () => Array(n).fill(null).map(() => ({ re: 0, im: 0 })));
  for (let j = 0; j < n; j++) {
    let v = a.map((r) => ({ ...r[j] }));
    for (let i = 0; i < j; i++) {
      let dot = { re: 0, im: 0 };
      for (let k = 0; k < n; k++) dot = cAdd(dot, cMul(cConj(Q[k][i]), v[k]));
      R[i][j] = dot;
      for (let k = 0; k < n; k++) v[k] = cSub(v[k], cMul(dot, Q[k][i]));
    }
    let nv = 0;
    for (const z of v) nv += z.re * z.re + z.im * z.im;
    nv = Math.sqrt(nv);
    if (nv < 1e-15) {
      let chosen = null;
      for (let cand = 0; cand < n; cand++) {
        const w = Array.from({ length: n }, (_, k) => ({ re: k === cand ? 1 : 0, im: 0 }));
        let x = w;
        for (let i = 0; i < j; i++) {
          let dot = { re: 0, im: 0 };
          for (let k = 0; k < n; k++) dot = cAdd(dot, cMul(cConj(Q[k][i]), x[k]));
          for (let k = 0; k < n; k++) x[k] = cSub(x[k], cMul(dot, Q[k][i]));
        }
        let xn = 0;
        for (const z of x) xn += z.re * z.re + z.im * z.im;
        xn = Math.sqrt(xn);
        if (xn > 1e-12) { chosen = { v: x, n: xn }; break; }
      }
      if (!chosen) err("复 QR 正交补失败");
      v = chosen.v;
      nv = chosen.n;
      R[j][j] = { re: 0, im: 0 };
    } else {
      R[j][j] = { re: nv, im: 0 };
    }
    for (let k = 0; k < n; k++) Q[k][j] = cDiv(v[k], { re: nv, im: 0 });
  }
  return { Q, R };
}

function trigonalComplexReal(a, tol = 1e-10, maxIter = 3000) {
  const n = a.length;
  let T = a.map((r) => r.map((x) => ({ re: x, im: 0 })));
  let Qtot = cmatId(n);
  let iter = 0;
  while (iter++ < maxIter) {
    let hi = n - 1;
    while (hi > 0 && cAbs(T[hi][hi - 1]) < tol * (cAbs(T[hi][hi]) + cAbs(T[hi - 1][hi - 1]) + 1)) { T[hi][hi - 1] = { re: 0, im: 0 }; hi--; }
    if (hi === 0) break;
    const a0 = T[hi - 1][hi - 1], b0 = T[hi - 1][hi], c0 = T[hi][hi - 1], d0 = T[hi][hi];
    const tr = cAdd(a0, d0);
    const disc = cAdd(cMul(cSub(a0, d0), cSub(a0, d0)), { re: 4 * (b0.re * c0.re - b0.im * c0.im), im: 4 * (b0.re * c0.im + b0.im * c0.re) });
    const sq = cSqrt(disc);
    const l1 = cMul({ re: 0.5, im: 0 }, cAdd(tr, sq));
    const l2 = cMul({ re: 0.5, im: 0 }, cSub(tr, sq));
    const mu = cAbs(cSub(l1, d0)) <= cAbs(cSub(l2, d0)) ? l1 : l2;
    const size = hi + 1;
    const sub = Array.from({ length: size }, (_, i) => Array.from({ length: size }, (_, j) => (i === j ? cSub(T[i][j], mu) : { ...T[i][j] })));
    const { Q, R } = cqr(sub);
    const next = cmatMul(R, Q);
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) T[i][j] = i === j ? cAdd(next[i][j], mu) : next[i][j];
    const Qbig = cmatId(n);
    for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) Qbig[i][j] = Q[i][j];
    Qtot = cmatMul(Qtot, Qbig);
  }
  return { T, Q: Qtot };
}

function egcdBig(a, b) {
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

function parseBigMatrix(text) {
  const lines = String(text || "").trim().split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (!lines.length) err("请输入整数矩阵");
  const m = lines.map((line) => line.split(/[\s,]+/).filter(Boolean).map((x) => {
    const v = big(x);
    if (v === null) err(`非整数项「${x}」`);
    return v;
  }));
  const n = m[0].length;
  if (!n || n > MAX_MATRIX || m.length > MAX_MATRIX) err(`矩阵尺寸上限 ${MAX_MATRIX}×${MAX_MATRIX}`);
  if (!m.every((r) => r.length === n)) err("矩阵各行长度不一致");
  return m;
}

function rowLineCombination(H, U, dst, a, rowA, b, rowB) {
  const w = H[0].length, u = U[0].length;
  const h = [], uu = [];
  for (let j = 0; j < w; j++) h.push(a * H[rowA][j] + b * H[rowB][j]);
  for (let j = 0; j < u; j++) uu.push(a * U[rowA][j] + b * U[rowB][j]);
  H[dst] = h;
  U[dst] = uu;
}

function hermiteNormalForm(M) {
  const H = M.map((r) => r.slice());
  const rows = H.length, cols = H[0].length;
  const U = Array.from({ length: rows }, (_, i) => Array.from({ length: rows }, (_, j) => (i === j ? 1n : 0n)));
  let r = 0;
  for (let c = 0; c < cols && r < rows; c++) {
    let piv = -1;
    for (let i = r; i < rows; i++) if (H[i][c] !== 0n) { piv = i; break; }
    if (piv < 0) continue;
    if (piv !== r) { [H[r], H[piv]] = [H[piv], H[r]]; [U[r], U[piv]] = [U[piv], U[r]]; }
    for (let i = r + 1; i < rows; i++) {
      if (H[i][c] === 0n) continue;
      const a = H[r][c], b = H[i][c];
      const { g, x, y } = egcdBig(a, b);
      const oldR = H[r].slice(), oldI = H[i].slice();
      const oldUR = U[r].slice(), oldUI = U[i].slice();
      for (let j = 0; j < cols; j++) {
        H[r][j] = x * oldR[j] + y * oldI[j];
        H[i][j] = (-b / g) * oldR[j] + (a / g) * oldI[j];
      }
      for (let j = 0; j < rows; j++) {
        U[r][j] = x * oldUR[j] + y * oldUI[j];
        U[i][j] = (-b / g) * oldUR[j] + (a / g) * oldUI[j];
      }
    }
    if (H[r][c] < 0n) { for (let j = 0; j < cols; j++) H[r][j] = -H[r][j]; for (let j = 0; j < rows; j++) U[r][j] = -U[r][j]; }
    const p = H[r][c];
    for (let i = 0; i < r; i++) {
      const q = divFloor(H[i][c], p);
      if (q === 0n) continue;
      for (let j = 0; j < cols; j++) H[i][j] -= q * H[r][j];
      for (let j = 0; j < rows; j++) U[i][j] -= q * U[r][j];
    }
    r++;
  }
  return { H, U };
}

function bigMatStr(a) { return a.map((r) => r.map((x) => x.toString()).join(" ")).join("\n"); }

const OPS_MATRIX = [
  runOp("e2-schur", CAT, "实 Schur 分解（数值）", "对实矩阵做 QR 迭代，返回正交 Q 与准上三角 T（QᵀAQ=T）；对称矩阵走 Jacobi，复特征值保留 2×2 块。数值结果，非符号精确", (text, p) => {
    const A = parseMatrix(text, "实矩阵");
    const tol = Number(p.tol || 1e-10);
    const { T, Q } = schurReal(A, Number.isFinite(tol) && tol > 0 ? tol : 1e-10);
    const errQ = matMaxAbs(matMulN(matT(Q), Q).map((r, i) => r.map((x, j) => x - (i === j ? 1 : 0))));
    return `Q =\n${matStr(Q)}\nT =\n${matStr(T)}\n正交误差 ‖QᵀQ−I‖∞ = ${fmtNum(errQ, 10)}`;
  }, [P("tol", "收敛容差", "1e-10")]),

  runOp("e2-trigonal", CAT, "复三角化 / 复 Schur（数值）", "复数域 QR 迭代把矩阵化为上三角 T，返回酉矩阵 Q 使 QᴴAQ=T；输入为实矩阵，允许复特征值", (text, p) => {
    const A = parseMatrix(text, "实矩阵");
    const { T, Q } = trigonalComplexReal(A);
    const prod = cmatMul(cmatAdj(Q), Q);
    let errQ = 0;
    for (let i = 0; i < prod.length; i++) for (let j = 0; j < prod.length; j++) errQ = Math.max(errQ, cAbs(cSub(prod[i][j], { re: i === j ? 1 : 0, im: 0 })));
    return `Q =\n${cmatStr(Q)}\nT =\n${cmatStr(T)}\n酉误差 = ${fmtNum(errQ, 10)}`;
  }),

  runOp("e2-hermite", CAT, "Hermite 标准形（整数矩阵）", "行 Hermite 标准形 H=U·M：欧几里得行变换，主元为正、主元上方约化到 [0,pivot)，输出 H 与幺模矩阵 U", (text) => {
    const M = parseBigMatrix(text);
    const { H, U } = hermiteNormalForm(M);
    const check = U.map((row) => {
      const out = Array(M[0].length).fill(0n);
      for (let i = 0; i < M.length; i++) for (let j = 0; j < M[0].length; j++) out[j] += row[i] * M[i][j];
      return out;
    });
    const ok = check.every((r, i) => r.every((x, j) => x === H[i][j]));
    if (!ok) err("Hermite 内部校验失败");
    return `H =\n${bigMatStr(H)}\nU =\n${bigMatStr(U)}\nU·M = H 校验通过`;
  }),

  runOp("e2-cmatconj", CAT, "复矩阵共轭 / 共轭转置", "逐项取共轭或转置后取共轭；输入如 1+i, 2, -3i，每行一项用空格/逗号分隔", (text, p) => {
    const A = parseComplexMatrix(text);
    const mode = String(p.mode || "conj");
    const out = mode === "adjoint" ? cmatAdj(A) : cmatConj(A);
    return `${mode === "adjoint" ? "Aᴴ" : "conj(A)"} =\n${cmatStr(out)}`;
  }, [SEL("mode", "模式", "conj", ["conj", "adjoint"])]),
];

function combinationsOf(n, k) {
  const out = [];
  const cur = [];
  const rec = (start) => {
    if (cur.length === k) { out.push(cur.slice()); return; }
    for (let i = start; i <= n; i++) {
      cur.push(i);
      rec(i + 1);
      cur.pop();
      if (out.length > 200000) err("组合数量超过上限 200000");
    }
  };
  rec(1);
  return out;
}

function wheelingSystem(n, k, g) {
  if (!(n >= 1 && k >= 1 && g >= 1 && g <= k && k <= n)) err("需满足 1 ≤ g ≤ k ≤ n");
  if (n > 16) err("号码池 n 上限 16");
  const tickets = combinationsOf(n, k);
  if (tickets.length > 50000) err("票面候选超过 50000，请缩小 n/k");
  const groups = combinationsOf(n, g);
  if (groups.length > 200000) err("保证组合超过 200000，请缩小 n/g");
  const gIndex = new Map(groups.map((gset, i) => [gset.join(","), i]));
  const cov = tickets.map((t) => {
    const idx = [];
    const rec = (start, cur) => {
      if (cur.length === g) { idx.push(gIndex.get(cur.slice().sort((a, b) => a - b).join(","))); return; }
      for (let i = start; i < t.length; i++) { cur.push(t[i]); rec(i + 1, cur); cur.pop(); }
    };
    rec(0, []);
    return idx;
  });
  const uncovered = new Set(groups.map((_, i) => i));
  const chosen = [];
  let guard = 0;
  while (uncovered.size && guard++ < tickets.length + 10) {
    let best = -1, bestCount = 0;
    for (let i = 0; i < tickets.length; i++) {
      let cnt = 0;
      for (const gi of cov[i]) if (uncovered.has(gi)) cnt++;
      if (cnt > bestCount) { bestCount = cnt; best = i; }
    }
    if (best < 0 || bestCount === 0) break;
    chosen.push(best);
    for (const gi of cov[best]) uncovered.delete(gi);
  }
  if (uncovered.size) err(`未能在上限内覆盖全部 ${groups.length} 个 ${g}-组合`);
  return { tickets: chosen.map((i) => tickets[i]), total: groups.length };
}

function negafibTable(K = 300) {
  const f = [0n];
  const fib = [0n, 1n, 1n];
  for (let i = 3; i <= K; i++) fib[i] = fib[i - 1] + fib[i - 2];
  for (let i = 1; i <= K; i++) f[i] = i % 2 === 1 ? fib[i] : -fib[i];
  const odd = Array(K + 1).fill(0n), even = Array(K + 1).fill(0n);
  for (let i = 1; i <= K; i++) {
    odd[i] = odd[i - 1];
    even[i] = even[i - 1];
    if (i % 2 === 1) odd[i] += f[i]; else even[i] += f[i];
  }
  return { f, odd, even, K };
}

function negafibEncode(x) {
  if (x === 0n) return { bits: "0", set: [] };
  const { f, odd, even, K } = negafibTable();
  const bits = new Set();
  let guard = 0;
  while (x !== 0n && guard++ < 10000) {
    if (x > 0n) {
      let k = 1;
      while (k + 2 <= K && odd[k] < x) k += 2;
      if (k > K || odd[k] < x) err("数字过大，超出 NegaFibonacci 表上限");
      bits.add(k);
      x -= f[k];
    } else {
      let k = 2;
      while (k + 2 <= K && even[k] > x) k += 2;
      if (k > K || even[k] > x) err("数字过小，超出 NegaFibonacci 表上限");
      bits.add(k);
      x -= f[k];
    }
  }
  if (x !== 0n) err("NegaFibonacci 编码未收敛");
  const max = Math.max(...bits);
  let s = "";
  for (let i = max; i >= 1; i--) s += bits.has(i) ? "1" : "0";
  return { bits: s, set: [...bits].sort((a, b) => a - b) };
}

function negafibDecode(s) {
  s = String(s).trim().replace(/\s+/g, "");
  if (!/^[01]+$/.test(s)) err("NegaFibonacci 码只能是 0/1");
  const { f } = negafibTable(Math.max(300, s.length + 10));
  let sum = 0n;
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "1") continue;
    const idx = s.length - i;
    if (idx > f.length - 1) err("码长超出 NegaFibonacci 表上限");
    sum += f[idx];
  }
  return sum;
}

const POLY_NAMES = {
  1: "henagone/monogone", 2: "digone", 3: "triangle/trigone", 4: "quadrilatere/quadrangle/tetragone",
  5: "pentagone", 6: "hexagone", 7: "heptagone", 8: "octogone", 9: "enneagone/nonagone", 10: "decagone",
  11: "hendecagone", 12: "dodecagone", 13: "tridecagone", 14: "tetradecagone", 15: "pentadecagone",
  16: "hexadecagone", 17: "heptadecagone", 18: "octadecagone", 19: "enneadecagone", 20: "icosagone",
  21: "henicosagone", 22: "doicosagone", 23: "triaicosagone", 24: "tetraicosagone", 25: "pentaicosagone",
  26: "hexaicosagone", 27: "heptaicosagone", 28: "octaicosagone", 29: "enneaicosagone", 30: "triacontagone",
  31: "hentriacontagone", 32: "dotriacontagone", 33: "tritriacontagone", 34: "tetratriacontagone",
  35: "pentatriacontagone", 36: "hexatriacontagone", 37: "heptatriacontagone", 38: "octatriacontagone",
  39: "enneatriacontagone", 40: "tetracontagone", 50: "pentacontagone", 60: "hexacontagone",
  70: "heptacontagone", 80: "octacontagone", 90: "enneacontagone", 100: "hectogone", 200: "dihectogone",
  300: "trihectogone", 400: "tetrahectogone", 500: "pentahectogone", 600: "hexahectogone",
  700: "heptahectogone", 800: "octahectogone", 900: "enneahectogone", 1000: "chiliogone",
  10000: "myriagone", 1000000: "megagone",
};
const HEDRA_NAMES = {
  1: "henaedre/monoedre", 2: "diedre", 3: "triedre", 4: "tetraedre", 5: "pentaedre", 6: "hexaedre",
  7: "heptaedre", 8: "octaedre", 9: "enneaedre", 10: "decaedre", 11: "hendecaedre", 12: "dodecaedre",
  13: "tridecaedre", 14: "tetradecaedre", 15: "pentadecaedre", 16: "hexadecaedre", 17: "heptadecaedre",
  18: "octadecaedre", 19: "enneadecaedre", 20: "icosaedre", 21: "henicoeaedre", 22: "doicoeaedre",
  23: "triaicoeaedre", 24: "tetraicoeaedre", 25: "pentaicoeaedre", 26: "hexaicoeaedre", 27: "heptaicoeaedre",
  28: "octaicoeaedre", 29: "enneaicoeaedre", 30: "triacontaedre", 40: "tetracontaedre", 50: "pentacontaedre",
  60: "hexacontaedre", 70: "heptacontaedre", 80: "octacontaedre", 90: "enneacontaedre", 100: "hectoedre",
  200: "dihectoedre", 300: "trihectoedre", 400: "tetrahectoedre", 500: "pentahectoedre",
  600: "hexahectoedre", 700: "heptahectoedre", 800: "octahectoedre", 900: "enneahectoedre",
  1000: "chilioedre", 10000: "myriaedre", 1000000: "megaedre",
};
function polyName(n) { return POLY_NAMES[n] || `${n}-gone`; }
function hedraName(n) { return HEDRA_NAMES[n] || `${n}-edre`; }
const SHAPE_REVERSE = (() => {
  const out = new Map();
  for (const [n, names] of Object.entries(POLY_NAMES)) for (const s of names.split("/")) out.set(s.replace(/[éè]/g, "e").toLowerCase(), { n: Number(n), dim: 2 });
  for (const [n, names] of Object.entries(HEDRA_NAMES)) for (const s of names.split("/")) out.set(s.replace(/[éè]/g, "e").toLowerCase(), { n: Number(n), dim: 3 });
  out.set("cercle", { n: Infinity, dim: 2 });
  out.set("sphere", { n: Infinity, dim: 3 });
  return out;
})();

function evalNumExpr(src, vars) {
  const toks = tokenizeExpr(src);
  let pos = 0;
  const peek = () => toks[pos];
  const eat = (v) => { const t = toks[pos]; if (!t || (v && t.v !== v)) err(`表达式语法错误：期望「${v}」`); pos++; return t; };
  const startsPrimary = (t) => !!t && (t.t === "num" || t.t === "id" || (t.t === "op" && t.v === "("));
  function expr() {
    let v = term();
    while (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = eat().v;
      const w = term();
      v = op === "+" ? v + w : v - w;
    }
    return v;
  }
  function term() {
    let v = factor();
    for (;;) {
      const t = peek();
      if (t && t.t === "op" && (t.v === "*" || t.v === "/")) {
        const op = eat().v;
        const w = factor();
        v = op === "*" ? v * w : v / w;
      } else if (startsPrimary(t)) v *= factor();
      else break;
    }
    return v;
  }
  function factor() {
    let v = unary();
    if (peek() && peek().t === "op" && peek().v === "^") {
      eat("^");
      const e = expr();
      v = Math.pow(v, e);
    }
    return v;
  }
  function unary() {
    if (peek() && peek().t === "op" && (peek().v === "+" || peek().v === "-")) {
      const op = eat().v;
      const v = unary();
      return op === "-" ? -v : v;
    }
    return primary();
  }
  function primary() {
    const t = eat();
    if (t.t === "num") return Number(t.v);
    if (t.t === "id") {
      if (t.v === "pi") return Math.PI;
      if (t.v === "e") return Math.E;
      if (Object.prototype.hasOwnProperty.call(vars, t.v)) return Number(vars[t.v]);
      if (!peek() || peek().v !== "(") err(`未知变量「${t.v}」`);
      eat("(");
      const a = expr();
      eat(")");
      const fn = { sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log, ln: Math.log, sqrt: Math.sqrt, atan: Math.atan, abs: Math.abs, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh }[t.v];
      if (!fn) err(`不支持的函数「${t.v}」`);
      return fn(a);
    }
    if (t.t === "op" && t.v === "(") { const v = expr(); eat(")"); return v; }
    err("数值表达式语法错误");
  }
  const v = expr();
  if (pos !== toks.length) err("表达式尾部存在多余内容");
  return v;
}

const OPS_MATH2 = [
  runOp("e2-wheeling", CAT, "彩票/投注轮转覆盖系统", "给定号码池 n、每注 k 个号、保证 g 个号，贪心构造票面集合，使任意 g 个号至少完整出现在一注中；输出票面并验证覆盖率", (text, p) => {
    const raw = String(text || "").trim() || `${p.n || ""} ${p.k || ""} ${p.g || ""}`;
    const nums = raw.split(/[\s,;]+/).filter(Boolean).map(Number);
    if (nums.length < 3) err("请输入 n k g，如 8 4 3");
    const [n, k, g] = nums;
    const { tickets, total } = wheelingSystem(n, k, g);
    const body = tickets.map((t) => t.join(" ")).join("\n");
    return `号码池 1..${n}，每注 ${k} 个，保证任意 ${g} 个号全覆盖\n票面数 = ${tickets.length}\n${body}\n覆盖 ${total} 个 ${g}-组合 = ${tickets.length ? "全部" : "空"}`;
  }, [P("n", "号码池 n", "8"), P("k", "每注个数 k", "4"), P("g", "保证 g 个号", "3")]),

  runOp("e2-negafib", CAT, "NegaFibonacci 编码/解码", "dCode/Wikipedia 约定：n=Σβ_iF_{-i}，输出 β_k..β_1 二进制串（无连续 1）；解码按位累加广义 Fibonacci 数", (text, p) => {
    const src = String(text || "").trim();
    if (!src) err("请输入整数或二进制码");
    if (String(p.mode || "encode") === "decode") {
      const n = negafibDecode(src);
      return `NegaFibonacci 码 ${src.replace(/\s+/g, "")} = ${n}`;
    }
    const n = big(src);
    if (n === null) err("编码输入必须是整数");
    const { bits, set } = negafibEncode(n);
    return `${n} 的 NegaFibonacci 表示 = ${bits}\n置位 F_{-i}: ${set.map((x) => `F_-${x}`).join(", ") || "无"}`;
  }, [SEL("mode", "模式", "encode", ["encode", "decode"])]),

  runOp("e2-shapes", CAT, "几何图形名称（多边形/多面体）", "按边数/面数给出 2D 多边形与 3D 多面体名称，支持 1..40、整十、100..900、1000/10000/1000000；也可按名称反查", (text, p) => {
    const src = String(text || "").trim();
    if (!src) err("请输入边数/面数或图形名称");
    const dim = String(p.dim || "both");
    const norm = src.toLowerCase().replace(/[éè]/g, "e");
    if (/^[+-]?\d+$/.test(norm)) {
      const n = Number(norm);
      if (!Number.isInteger(n) || n < 1 || n > 1000000) err("数量需在 1..1000000");
      const lines = [];
      if (dim !== "3d") lines.push(`2D ${n} 边：${polyName(n)}${n >= 3 ? `（正 ${n} 边形有 ${n} 条对称轴${n % 2 === 0 ? "，中心对称" : ""}）` : ""}`);
      if (dim !== "2d") lines.push(`3D ${n} 面：${hedraName(n)}`);
      return lines.join("\n");
    }
    const hit = SHAPE_REVERSE.get(norm);
    if (!hit) err(`未知图形名称「${src}」`);
    if (!Number.isFinite(hit.n)) return `${src} 是曲线/曲面，不是多边形/多面体`;
    return `${src} → ${hit.dim === 2 ? `${hit.n} 边，${polyName(hit.n)}` : `${hit.n} 面，${hedraName(hit.n)}`}`;
  }, [SEL("dim", "维度", "both", ["both", "2d", "3d"])]),

  runOp("e2-ode", CAT, "常微分方程数值解（RK4）", "y'=f(x,y) 的四阶 Runge–Kutta 数值解；输出节点表与终点值。明确是数值解，不是符号解析解", (text, p) => {
    const src = String(text || "").trim() || String(p.expr || "").trim();
    if (!src) err("请输入 y'=f(x,y) 的右端表达式");
    const x0 = Number(p.x0 ?? 0), y0 = Number(p.y0 ?? 1), x1 = Number(p.x1 ?? 1);
    if (![x0, y0, x1].every(Number.isFinite)) err("x0/y0/x1 必须是数字");
    const steps = parseIntVal(p.steps || 100, "步数", 1, 100000);
    const h = (x1 - x0) / steps;
    if (h === 0) err("区间长度不能为 0");
    const f = (x, y) => evalNumExpr(src, { x, y, t: x });
    let x = x0, y = y0;
    const rows = [`x=${fmtNum(x, 8)} y=${fmtNum(y, 8)}`];
    for (let i = 0; i < steps; i++) {
      const k1 = f(x, y);
      const k2 = f(x + h / 2, y + h * k1 / 2);
      const k3 = f(x + h / 2, y + h * k2 / 2);
      const k4 = f(x + h, y + h * k3);
      y += h * (k1 + 2 * k2 + 2 * k3 + k4) / 6;
      x += h;
      if (steps <= 40 || i === steps - 1 || i % Math.ceil(steps / 20) === 0) rows.push(`x=${fmtNum(x, 8)} y=${fmtNum(y, 8)}`);
    }
    return `RK4 数值解（非符号 CAS）\n${rows.join("\n")}\ny(${fmtNum(x1, 8)}) ≈ ${fmtNum(y, 12)}`;
  }, [P("expr", "y'=f(x,y)", "y"), P("x0", "x0", "0"), P("y0", "y0", "1"), P("x1", "x1", "1"), P("steps", "步数", "100")]),
];

const SUDOKU_CHARS = "123456789ABCDEFG";

function gridLines(text, what) {
  const lines = String(text || "").trim().split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (!lines.length) err(`请输入${what}`);
  if (lines.length > 16) err(`${what}尺寸上限 16`);
  return lines;
}
function splitGridLine(line) {
  if (/[\s,]/.test(line)) return line.split(/[\s,]+/).filter(Boolean);
  return [...line];
}
function defaultRegions(n) {
  const dims = { 4: [2, 2], 6: [2, 3], 8: [2, 4], 9: [3, 3], 10: [2, 5], 12: [3, 4], 16: [4, 4] };
  const d = dims[n];
  if (!d) err(`${n}×${n} 无默认宫格，请提供区域图（每行 N 个标签，每个标签出现 N 次）`);
  const [bh, bw] = d;
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => Math.floor(r / bh) * (n / bw) + Math.floor(c / bw)));
}
function parseRegionGrid(text, n) {
  if (!String(text || "").trim()) return defaultRegions(n);
  const lines = gridLines(text, "区域图");
  if (lines.length !== n) err(`区域图行数应为 ${n}`);
  const labels = new Map();
  const reg = [];
  for (const line of lines) {
    const cells = splitGridLine(line);
    if (cells.length !== n) err(`区域图每行应有 ${n} 个标签`);
    reg.push(cells.map((x) => {
      if (!labels.has(x)) labels.set(x, labels.size);
      return labels.get(x);
    }));
  }
  const cnt = new Map();
  for (const row of reg) for (const x of row) cnt.set(x, (cnt.get(x) || 0) + 1);
  for (const [x, c] of cnt) if (c !== n) err(`区域 ${x} 有 ${c} 格，应为 ${n}`);
  return reg;
}
function solveSudokuGrid(text, regionText) {
  const lines = gridLines(text, "数独盘面");
  const n = lines.length;
  const rows = lines.map((line) => {
    const cells = splitGridLine(line);
    if (cells.length !== n) err(`盘面每行应有 ${n} 格`);
    return cells.map((x) => {
      if (x === "." || x === "0" || x === "*" || x === "?") return 0;
      const v = SUDOKU_CHARS.indexOf(x.toUpperCase()) + 1;
      if (v <= 0 || v > n) err(`盘面符号「${x}」超出 1..${n}`);
      return v;
    });
  });
  const regions = parseRegionGrid(regionText, n);
  const full = (1 << n) - 1;
  const rowM = Array(n).fill(0), colM = Array(n).fill(0), regM = Array(n).fill(0);
  const grid = rows.map((r) => r.slice());
  let empty = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    const v = grid[r][c];
    if (!v) { empty++; continue; }
    const bit = 1 << (v - 1), rg = regions[r][c];
    if ((rowM[r] & bit) || (colM[c] & bit) || (regM[rg] & bit)) err(`盘面初始冲突：第 ${r + 1} 行第 ${c + 1} 列`);
    rowM[r] |= bit; colM[c] |= bit; regM[rg] |= bit;
  }
  let nodes = 0;
  const popcount = (x) => { let c = 0; while (x) { x &= x - 1; c++; } return c; };
  function dfs(left) {
    if (left === 0) return true;
    if (++nodes > 2000000) err("数独搜索节点超过 2000000，已中止");
    let br = -1, bc = -1, best = 99, bestMask = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (grid[r][c]) continue;
      const mask = full & ~(rowM[r] | colM[c] | regM[regions[r][c]]);
      const cnt = popcount(mask);
      if (cnt === 0) return false;
      if (cnt < best) { best = cnt; br = r; bc = c; bestMask = mask; }
    }
    if (br < 0) return false;
    for (let v = 1; v <= n; v++) {
      const bit = 1 << (v - 1);
      if (!(bestMask & bit)) continue;
      const rg = regions[br][bc];
      grid[br][bc] = v; rowM[br] |= bit; colM[bc] |= bit; regM[rg] |= bit;
      if (dfs(left - 1)) return true;
      grid[br][bc] = 0; rowM[br] &= ~bit; colM[bc] &= ~bit; regM[rg] &= ~bit;
    }
    return false;
  }
  if (!dfs(empty)) err("数独无解");
  const checkUnit = (cells) => {
    const seen = new Set(cells);
    if (seen.size !== n || cells.some((v) => v < 1 || v > n)) err("数独校验失败");
  };
  for (let r = 0; r < n; r++) checkUnit(grid[r]);
  for (let c = 0; c < n; c++) checkUnit(grid.map((row) => row[c]));
  const byReg = Array.from({ length: n }, () => []);
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) byReg[regions[r][c]].push(grid[r][c]);
  for (const cells of byReg) checkUnit(cells);
  return { n, grid, regions, nodes, empty };
}

function fillapixSolve(text) {
  const lines = gridLines(text, "Fill-A-Pix 线索盘面");
  const n = lines.length;
  if (n > 8) err("Fill-A-Pix 尺寸上限 8×8");
  const clues = lines.map((line) => {
    const cells = splitGridLine(line);
    if (cells.length !== n) err(`线索盘面每行应有 ${n} 格`);
    return cells.map((x) => {
      if (!/^[0-9]$/.test(x)) err(`线索只能是 0..9，遇到「${x}」`);
      return Number(x);
    });
  });
  const neigh = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => {
    const out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && rr < n && cc >= 0 && cc < n) out.push(rr * n + cc);
    }
    return out;
  }));
  const flatClues = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) flatClues[r * n + c] = clues[r][c];
  const propagate = (st) => {
    let changed = true, guard = 0;
    while (changed && guard++ < 20000) {
      changed = false;
      for (let idx = 0; idx < n * n; idx++) {
        const clue = flatClues[idx];
        let black = 0, unk = [];
        for (const j of neigh[Math.floor(idx / n)][idx % n]) {
          if (st[j] === 1) black++;
          else if (st[j] === -1) unk.push(j);
        }
        if (black > clue || black + unk.length < clue) return false;
        if (black === clue && unk.length) { for (const j of unk) { st[j] = 0; changed = true; } }
        else if (black + unk.length === clue && unk.length) { for (const j of unk) { st[j] = 1; changed = true; } }
      }
    }
    return true;
  };
  let nodes = 0;
  const dfs = (st) => {
    if (++nodes > 1000000) err("Fill-A-Pix 搜索节点超过 1000000，已中止");
    if (!propagate(st)) return null;
    let best = -1, bestDeg = -1;
    for (let i = 0; i < n * n; i++) if (st[i] === -1) {
      let deg = 0;
      for (const j of neigh[Math.floor(i / n)][i % n]) if (st[j] !== -1) deg++;
      if (deg > bestDeg) { bestDeg = deg; best = i; }
    }
    if (best < 0) return st;
    for (const val of [1, 0]) {
      const cp = st.slice(); cp[best] = val;
      const r = dfs(cp);
      if (r) return r;
    }
    return null;
  };
  const state = Array(n * n).fill(-1);
  const sol = dfs(state);
  if (!sol) err("Fill-A-Pix 无解或线索矛盾");
  const out = Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => (sol[r * n + c] === 1 ? "#" : ".")).join(""));
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    let cnt = 0;
    for (const j of neigh[r][c]) if (sol[j] === 1) cnt++;
    if (cnt !== clues[r][c]) err("Fill-A-Pix 解的线索校验失败");
  }
  return { n, grid: out, nodes };
}

function bernoulliNumbers(n) {
  const A = Array(n + 1).fill(RZ);
  const out = [];
  for (let m = 0; m <= n; m++) {
    A[m] = R(1n, BigInt(m + 1));
    for (let j = m; j >= 1; j--) A[j - 1] = rMul(R(BigInt(j)), rSub(A[j - 1], A[j]));
    out.push(A[0]);
  }
  return out;
}
function eulerianRow(n) {
  let row = [1n];
  for (let m = 1; m <= n; m++) {
    const next = Array(m + 1).fill(0n);
    for (let k = 0; k <= m; k++) next[k] = BigInt(m - k) * (row[k - 1] || 0n) + BigInt(k + 1) * (row[k] || 0n);
    row = next;
  }
  return row.slice(0, Math.max(1, n));
}
function stirling1Row(n) {
  let row = [1n];
  for (let m = 1; m <= n; m++) {
    const next = Array(m + 1).fill(0n);
    for (let k = 1; k <= m; k++) next[k] = (row[k - 1] || 0n) - BigInt(m - 1) * (row[k] || 0n);
    row = next;
  }
  return row;
}
function ulamSpiral(n) {
  if (n % 2 === 0 || n < 3 || n > 51) err("Ulam 螺旋尺寸需为 3..51 的奇数");
  const g = Array.from({ length: n }, () => Array(n).fill(0));
  let r = Math.floor(n / 2), c = r, v = 1;
  g[r][c] = 1;
  const dr = [0, -1, 0, 1], dc = [1, 0, -1, 0];
  let dir = 0, len = 1;
  while (v < n * n) {
    for (let rep = 0; rep < 2 && v < n * n; rep++) {
      for (let i = 0; i < len && v < n * n; i++) {
        r += dr[dir]; c += dc[dir]; v++; g[r][c] = v;
      }
      dir = (dir + 1) % 4;
    }
    len++;
  }
  let out = "", primes = 0;
  for (let i = 0; i < n; i++) {
    let line = "";
    for (let j = 0; j < n; j++) {
      const p = g[i][j] > 1 && isPrime(BigInt(g[i][j]));
      if (p) primes++;
      line += p ? "#" : ".";
    }
    out += line + "\n";
  }
  return { out: out.trimEnd(), primes };
}
function reverseDigits(n) { return Number(String(n).split("").reverse().join("")); }
function emirpsUpTo(n) {
  const out = [];
  for (let i = 2; i <= n; i++) {
    if (!isPrime(BigInt(i))) continue;
    const r = reverseDigits(i);
    if (r !== i && isPrime(BigInt(r))) out.push(i);
  }
  return out;
}
function matAddN(a, b) { return a.map((r, i) => r.map((x, j) => x + b[i][j])); }
function matExpNumeric(a, t, terms = 20) {
  let M = a.map((r) => r.map((x) => x * t));
  let norm = 0;
  for (const row of M) norm = Math.max(norm, row.reduce((s, x) => s + Math.abs(x), 0));
  let s = 0;
  while (norm > 0.5) { norm /= 2; s++; }
  const scale = 2 ** s;
  const B = M.map((r) => r.map((x) => x / scale));
  let sum = matId(a.length);
  let term = matId(a.length);
  for (let k = 1; k <= terms; k++) {
    term = matMulN(term, B).map((r) => r.map((x) => x / k));
    sum = matAddN(sum, term);
  }
  for (let i = 0; i < s; i++) sum = matMulN(sum, sum);
  return sum;
}
function parseEdges(text) {
  const names = new Map();
  const edges = [];
  for (const line of String(text || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
    const m = line.match(/^([A-Za-z0-9_]+)\s*(?:-|->)\s*([A-Za-z0-9_]+)(?:\s*[:=]\s*(-?\d+(?:\.\d+)?))?$/);
    if (!m) err(`边格式错误：${line}（示例 A-B:3 或 A->B:3）`);
    const [, u, v, w] = m;
    for (const x of [u, v]) if (!names.has(x)) names.set(x, names.size);
    const weight = w === undefined ? 1 : Number(w);
    if (!Number.isFinite(weight)) err(`边权不是数字：${line}`);
    edges.push({ u: names.get(u), v: names.get(v), w: weight, un: u, vn: v });
  }
  const rev = [...names.keys()];
  return { n: rev.length, rev, edges };
}
function dijkstraGraph(n, edges, src, dst) {
  const adj = Array.from({ length: n }, () => []);
  for (const e of edges) { adj[e.u].push({ to: e.v, w: e.w }); adj[e.v].push({ to: e.u, w: e.w }); }
  const dist = Array(n).fill(Infinity), prev = Array(n).fill(-1);
  dist[src] = 0;
  const used = Array(n).fill(false);
  for (let it = 0; it < n; it++) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!used[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0) break;
    used[u] = true;
    for (const e of adj[u]) if (dist[u] + e.w < dist[e.to]) { dist[e.to] = dist[u] + e.w; prev[e.to] = u; }
  }
  if (!Number.isFinite(dist[dst])) err("目标不可达");
  const path = [];
  for (let x = dst; x !== -1; x = prev[x]) path.push(x);
  path.reverse();
  return { dist: dist[dst], path };
}

const OPS_EXTRA = [
  runOp("e2-sudoku-regions", CAT, "任意 N×N 数独/不规则宫求解", "支持 4..16 阶；可用区域图定义任意不规则宫（每行 N 个标签，每个标签 N 格）。5×5/7×7/不规则数独均可解；MRV + 位掩码回溯", (text, p) => {
    const { n, grid, regions, nodes } = solveSudokuGrid(text, p.regions);
    const out = grid.map((r) => r.map((v) => SUDOKU_CHARS[v - 1]).join("")).join("\n");
    return `${n}×${n} 数独解\n${out}\n回溯节点 = ${nodes}`;
  }, [P("regions", "区域图（可空）", "AABBC\nAABBC\n...")]),

  runOp("e2-fillapix", CAT, "Fill-A-Pix 填色推理", "每个线索格给出其 3×3 邻域内黑格数量；用约束传播 + 回溯求黑白盘面，输出 # 黑 / . 白", (text) => {
    const { n, grid, nodes } = fillapixSolve(text);
    return `${n}×${n} Fill-A-Pix 解\n${grid.join("\n")}\n搜索节点 = ${nodes}`;
  }),

  runOp("e2-bernoulli", CAT, "Bernoulli 数（精确分数）", "Akiyama–Tanigawa 算法输出 B0..Bn 的精确有理数；约定 B1=+1/2", (text, p) => {
    const n = parseIntVal(String(text || "").trim() || p.n || 10, "n", 0, 80);
    const b = bernoulliNumbers(n);
    return b.map((x, i) => `B${i} = ${rStr(x)}`).join("\n");
  }, [P("n", "n", "10")]),

  runOp("e2-eulerian", CAT, "Eulerian 数", "递推 A(n,k)=(n−k)A(n−1,k−1)+(k+1)A(n−1,k)，输出第 n 行与行和 n!", (text, p) => {
    const n = parseIntVal(String(text || "").trim() || p.n || 6, "n", 0, 80);
    const row = eulerianRow(n);
    const sum = row.reduce((a, b) => a + b, 0n);
    return `n=${n}: ${row.join(", ")}\n行和 = ${sum}（应等于 ${n}!）`;
  }, [P("n", "n", "6")]),

  runOp("e2-stirling1", CAT, "第一类 Stirling 数", "带符号第一类 Stirling 数 s(n,k)，输出 k=1..n 一行、绝对值行与行和 n!", (text, p) => {
    const n = parseIntVal(String(text || "").trim() || p.n || 6, "n", 0, 80);
    const row = stirling1Row(n).slice(1);
    const abs = row.map((x) => (x < 0n ? -x : x));
    const sum = abs.reduce((a, b) => a + b, 0n);
    return `s(${n},k) = ${row.join(", ")}\n|s(${n},k)| = ${abs.join(", ")}\n行和 = ${sum}（应等于 ${n}!）`;
  }, [P("n", "n", "6")]),

  runOp("e2-ulam", CAT, "Ulam 素数螺旋", "生成 n×n（奇数）Ulam 螺旋，# 表示素数、. 表示合数/1，并给出素数计数", (text, p) => {
    const n = parseIntVal(String(text || "").trim() || p.n || 7, "n", 3, 51);
    const { out, primes } = ulamSpiral(n);
    return `${n}×${n} Ulam 螺旋\n${out}\n素数个数 = ${primes}`;
  }, [P("n", "n（奇数）", "7")]),

  runOp("e2-emirp", CAT, "Emirp（反素数）", "列出 ≤n 的 emirp：本身是素数、十进制反转后仍是不同素数；上限 200000", (text, p) => {
    const n = parseIntVal(String(text || "").trim() || p.n || 1000, "n", 2, 200000);
    const list = emirpsUpTo(n);
    return `≤${n} 的 emirp（${list.length} 个）\n${list.join(", ")}`;
  }, [P("n", "上限 n", "1000")]),

  runOp("e2-matrixexp", CAT, "矩阵指数 exp(A·t)（数值）", "缩放-平方 + Taylor 级数计算矩阵指数；输出数值矩阵，适合小矩阵线性 ODE/旋转验证", (text, p) => {
    const A = parseMatrix(text, "矩阵");
    const t = Number(p.t ?? 1);
    if (!Number.isFinite(t)) err("t 必须是数字");
    const terms = parseIntVal(p.terms || 20, "Taylor 项数", 4, 60);
    const out = matExpNumeric(A, t, terms);
    return `exp(A·${fmtNum(t)}) =\n${matStr(out, (x) => fmtNum(x, 10))}`;
  }, [P("t", "t", "1"), P("terms", "Taylor 项数", "20")]),

  runOp("e2-graphalgo", CAT, "图算法（Dijkstra/MST/拓扑/连通）", "边列表 A-B:权重（无向；拓扑模式按 A->B 有向）。支持最短路、最小生成树、拓扑排序、连通分量、全源最短路", (text, p) => {
    const { n, rev, edges } = parseEdges(text);
    const mode = String(p.mode || "dijkstra");
    if (mode === "dijkstra") {
      const s = rev.indexOf(String(p.source || "").trim());
      const t = rev.indexOf(String(p.target || "").trim());
      if (s < 0 || t < 0) err("source/target 必须是边列表中出现过的节点");
      const { dist, path } = dijkstraGraph(n, edges, s, t);
      return `最短距离 = ${fmtNum(dist)}\n路径 = ${path.map((x) => rev[x]).join(" → ")}`;
    }
    if (mode === "mst") {
      const parent = Array.from({ length: n }, (_, i) => i);
      const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
      const es = edges.slice().sort((a, b) => a.w - b.w);
      let total = 0, cnt = 0;
      const used = [];
      for (const e of es) {
        const a = find(e.u), b = find(e.v);
        if (a === b) continue;
        parent[a] = b; total += e.w; cnt++; used.push(`${e.un}-${e.vn}(${fmtNum(e.w)})`);
        if (cnt === n - 1) break;
      }
      if (cnt !== n - 1) err("图不连通，无生成树");
      return `MST 总权重 = ${fmtNum(total)}\n边 = ${used.join(", ")}`;
    }
    if (mode === "topo") {
      const indeg = Array(n).fill(0), adj = Array.from({ length: n }, () => []);
      for (const e of edges) { adj[e.u].push(e.v); indeg[e.v]++; }
      const q = [];
      for (let i = 0; i < n; i++) if (!indeg[i]) q.push(i);
      const order = [];
      while (q.length) {
        const u = q.shift();
        order.push(rev[u]);
        for (const v of adj[u]) if (--indeg[v] === 0) q.push(v);
      }
      if (order.length !== n) err("图中存在环，无法拓扑排序");
      return `拓扑序 = ${order.join(" → ")}`;
    }
    if (mode === "components") {
      const adj = Array.from({ length: n }, () => []);
      for (const e of edges) { adj[e.u].push(e.v); adj[e.v].push(e.u); }
      const seen = Array(n).fill(false);
      const comps = [];
      for (let i = 0; i < n; i++) {
        if (seen[i]) continue;
        const stack = [i]; seen[i] = true; const comp = [];
        while (stack.length) {
          const u = stack.pop(); comp.push(rev[u]);
          for (const v of adj[u]) if (!seen[v]) { seen[v] = true; stack.push(v); }
        }
        comps.push(comp);
      }
      return `连通分量数 = ${comps.length}\n${comps.map((c) => c.join(", ")).join("\n")}`;
    }
    if (mode === "floyd") {
      const d = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)));
      for (const e of edges) { d[e.u][e.v] = Math.min(d[e.u][e.v], e.w); d[e.v][e.u] = Math.min(d[e.v][e.u], e.w); }
      for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) d[i][j] = Math.min(d[i][j], d[i][k] + d[k][j]);
      const body = d.map((row) => row.map((x) => (Number.isFinite(x) ? fmtNum(x) : "∞")).join(" ")).join("\n");
      return `节点：${rev.join(" ")}\n全源最短路：\n${body}`;
    }
    err("未知图算法模式");
  }, [SEL("mode", "模式", "dijkstra", ["dijkstra", "floyd", "mst", "topo", "components"]), P("source", "起点", "A"), P("target", "终点", "C")]),

  runOp("e2-quaternion", CAT, "四元数运算", "解析 a+bi+cj+dk，支持加、乘、共轭、逆、模、单位化；Hamilton 乘法约定 i²=j²=k²=ijk=−1", (text, p) => {
    const q = parseQuat(text);
    const mode = String(p.mode || "norm");
    if (mode === "norm") return `|q| = ${fmtNum(Math.hypot(q.a, q.b, q.c, q.d), 10)}`;
    if (mode === "conj") return `conj(q) = ${quatStr(quatConj(q))}`;
    if (mode === "inverse") return `q⁻¹ = ${quatStr(quatInv(q))}`;
    if (mode === "normalize") return `q/|q| = ${quatStr(quatScale(q, 1 / Math.hypot(q.a, q.b, q.c, q.d)))}`;
    const r = parseQuat(p.q2 || "");
    if (mode === "add") return `q1 + q2 = ${quatStr(quatAdd(q, r))}`;
    if (mode === "mul") return `q1 × q2 = ${quatStr(quatMul(q, r))}`;
    err("未知四元数模式");
  }, [P("q2", "第二个四元数", "1-i"), SEL("mode", "模式", "norm", ["norm", "conj", "inverse", "normalize", "add", "mul"])]),
];

function parseQuat(src) {
  let s = String(src || "").replace(/\s+/g, "").replace(/−/g, "-");
  if (!s) err("四元数不能为空");
  if (!/^[+-]/.test(s)) s = "+" + s;
  const parts = s.match(/[+-][^+-]+/g);
  if (!parts || parts.join("") !== s) err(`无法解析四元数「${src}」`);
  const q = { a: 0, b: 0, c: 0, d: 0 };
  for (const part of parts) {
    const sign = part[0] === "-" ? -1 : 1;
    const body = part.slice(1);
    const unit = body[body.length - 1];
    let coeff = body;
    if ("ijk".includes(unit)) coeff = body.slice(0, -1) || "1";
    const v = Number(coeff);
    if (!Number.isFinite(v)) err(`四元数系数不是数字「${part}」`);
    if (unit === "i") q.b += sign * v;
    else if (unit === "j") q.c += sign * v;
    else if (unit === "k") q.d += sign * v;
    else q.a += sign * v;
  }
  return q;
}
function quatAdd(a, b) { return { a: a.a + b.a, b: a.b + b.b, c: a.c + b.c, d: a.d + b.d }; }
function quatConj(a) { return { a: a.a, b: -a.b, c: -a.c, d: -a.d }; }
function quatScale(a, k) { return { a: a.a * k, b: a.b * k, c: a.c * k, d: a.d * k }; }
function quatMul(a, b) {
  return {
    a: a.a * b.a - a.b * b.b - a.c * b.c - a.d * b.d,
    b: a.a * b.b + a.b * b.a + a.c * b.d - a.d * b.c,
    c: a.a * b.c - a.b * b.d + a.c * b.a + a.d * b.b,
    d: a.a * b.d + a.b * b.c - a.c * b.b + a.d * b.a,
  };
}
function quatInv(a) { const n = a.a * a.a + a.b * a.b + a.c * a.c + a.d * a.d; if (n === 0) err("零四元数不可逆"); return quatScale(quatConj(a), 1 / n); }
function quatStr(q) {
  const parts = [];
  const push = (v, unit) => {
    if (Math.abs(v) < 1e-12) return;
    const s = fmtNum(v, 8);
    parts.push(`${s}${unit}`);
  };
  push(q.a, "");
  push(q.b, "i");
  push(q.c, "j");
  push(q.d, "k");
  if (!parts.length) return "0";
  return parts.join("+").replace(/\+-/g, "-");
}

const COVERAGE_ITEMS = [
  ["Arithmétique", "Chiffre Multiplication Nombres Premiers", "chiffre-multiplication-nombres-premiers", "blocked", "", "古典密码变体，算法约定与权威向量未锁定，留密码批"],
  ["Arithmétique", "Conjecture de Pólya", "conjecture-polya", "blocked", "", "Pólya 猜想的首个反例在 9 亿量级，纯 JS 全量验证不现实"],
  ["Fonctions", "Développement Limité", "developpement-limite", "implemented", "e2-taylor", "有理系数幂级数展开（sin/cos/exp/log/sqrt/atan 等组合）"],
  ["Fonctions", "Solveur d'Equation Différentielle", "solveur-equation-differentielle", "mapped", "e2-ode", "数值 RK4 解；符号解析解仍需 CAS"],
  ["Fonctions", "Transformation Inverse de Laplace", "transformation-inverse-laplace", "implemented", "e2-invlaplace", "真分式部分分式分解，一次/共轭二次因子"],
  ["Matrice", "Décomposition de Schur", "decomposition-schur-matrice", "implemented", "e2-schur", "实 QR 迭代 + Jacobi，数值 Q/T"],
  ["Matrice", "Forme Normale d'Hermite", "hermite-matrice", "implemented", "e2-hermite", "BigInt 行 HNF，输出 H 与幺模 U"],
  ["Matrice", "Matrice Conjuguée Complexe", "matrice-conjuguee-complexe", "implemented", "e2-cmatconj", "逐项共轭/共轭转置"],
  ["Matrice", "Réduction de Jordan", "jordan-matrice", "mapped", "d2-eigen", "仅对角化（Jordan 为对角）场景；一般 Jordan 块仍需 CAS"],
  ["Matrice", "Trigonalisation", "trigonalisation-matrice", "implemented", "e2-trigonal", "复 QR 迭代，输出酉 Q 与上三角 T"],
  ["Calcul Formel", "Solveur d'Equation Différentielle", "solveur-equation-differentielle", "mapped", "e2-ode", "同一 URL 跨分区重复；数值 RK4 解"],
  ["Combinatoire", "Système Réducteur de Tirage", "systeme-reducteur-tirage", "implemented", "e2-wheeling", "贪心覆盖设计，任意 g 个号至少一注全中"],
  ["Mathématiques (Autre/non classé)", "Codage de NegaFibonacci", "codage-negafibonacci", "implemented", "e2-negafib", "dCode/Wikipedia 约定，BigInt 编解码"],
  ["Géométrie", "Nom des Figures Géométriques", "figures-geometriques", "implemented", "e2-shapes", "2D 多边形/3D 多面体命名与反查表"],
  ["Jeux de Nombres", "Solveur Fill-A-Pix", "solveur-fill-a-pix", "implemented", "e2-fillapix", "线索约束传播 + 回溯，输出 #/. 盘面"],
  ["Jeux de Nombres", "Solveur Sudoku 5x5", "solveur-sudoku-5x5", "implemented", "e2-sudoku-regions", "任意区域图 + MRV 位掩码回溯"],
  ["Jeux de Nombres", "Solveur Sudoku 7x7", "solveur-sudoku-7x7", "implemented", "e2-sudoku-regions", "任意区域图 + MRV 位掩码回溯"],
  ["Jeux de Nombres", "Solveur Sudoku NxN Irrégulier", "solveur-sudoku-irregulier", "implemented", "e2-sudoku-regions", "不规则宫区域图求解"],
  ["Jeux de Nombres", "Solveur Tectonic", "solveur-tectonic", "blocked", "", "Suguru/Tectonic 的区域邻接禁同 + 和值规则求解器未实现"],
  ["Jeux de Nombres", "Solveur Picture Sweep", "solveur-picture-sweep", "blocked", "", "专有图片扫雷玩法，规则/盘面格式未文档化"],
  ["Jeux de Nombres", "Générateur d'Autogramme", "generateur-auto-description", "blocked", "", "自描述句子的自然语言/计数约束，确定性生成未实现"],
];

export const COVERAGE = COVERAGE_ITEMS.map(([cat, name, slug, status, target, reason]) => ({
  cat, name, slug, url: `https://www.dcode.fr/${slug}`, status, target, reason,
}));

export const COVERAGE_COUNTS = COVERAGE.reduce((acc, x) => { acc[x.status] = (acc[x.status] || 0) + 1; return acc; }, { implemented: 0, mapped: 0, blocked: 0 });

export const OPS = OPS_CORE.concat(OPS_MATRIX, OPS_MATH2, OPS_EXTRA);

