/*
 * lllAttack.js — 格基归约 LLL（Lenstra–Lenstra–Lovász）+ CTF 典型攻击（cat:'crypto'，run 型）。
 *
 * 【算法来源 / 不编造】
 * LLL 归约照标准伪码实现，参照：
 * - Cohen《A Course in Computational Algebraic Number Theory》Algorithm 2.6.3（LLL）；
 * - Wikipedia “Lenstra–Lenstra–Lovász lattice basis reduction algorithm” 词条标准伪码；
 * - 原论文 Lenstra, Lenstra & Lovász 1982《Factoring polynomials with rational coefficients》。
 * 为杜绝浮点误差，Gram–Schmidt 正交化（GSO）与 μ 系数全程用 **BigInt 精确有理数**（Fraction {n,d}）
 * 计算，δ 默认 3/4（标准参数），可选 99/100（更强归约）。基向量本身保持整数（BigInt）。
 * 本实现每次 size-reduce / swap 后重算 GSO（对 CTF 小规模矩阵足够，避免增量更新的实现风险）。
 *
 * 背包低密度攻击照 CJLOSS 构造（Coster, Joux, LaMacchia, Odlyzko, Schnorr 1992
 * 《Improved low-density subset sum algorithms》，在 Lagarias–Odlyzko 1985 基础上加 ±1/2 平移
 * 将可攻密度上界从 0.6463 提升到 0.9408）。子集和格（整数 ×2 形式，(n+1)×(n+1)）：
 *
 * 行 i (0..n-1): [ 0,..,2(在第 i 列),..,0 , N·β_i ]
 * 行 n : [ 1, 1, ..., 1 , N·c ]
 *
 * 取组合 Σ x_i·行_i − 行_n = ( 2x_0−1, …, 2x_{n−1}−1 , N·(Σx_iβ_i − c) )。
 * 当 (x_i) 是明文 0/1 位时最后一维精确为 0，前 n 维全 ∈{±1}，范数 = √n（极短）。
 * N 取 > √n（本实现 N = ⌊√n⌋+1，强制任何“最后一维非零”的向量范数 ≥ N > √n）→
 * LLL 归约后的短向量最后一维必为 0，前 n 维读出 ±1 即还原明文位。
 *
 * 【红线遵守】
 * - 纯前端零外发：纯 BigInt，浏览器/Node 均可跑，无 node 专属 API。
 * - 独立文件自注册：文件内 register，不改 main.js / i18n 主表。
 * - 算法照标准伪码，不编造；交付前跑归约正确性 + 背包攻击逐位复原自测。
 * - core 层零 UI 依赖（仅 import registry）。
 *
 * 契约：register({ id:"lllAttack", cat:"crypto", name, desc, params, run })，无 detect。
 */

import { register } from "./registry.js";

// ============================================================
// 精确有理数（Fraction）：{ n: BigInt 分子, d: BigInt 分母(>0，已约分) }
// ============================================================
function bgcd(a, b) {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b) { [a, b] = [b, a % b]; }
  return a;
}
function fmk(n, d) {
  if (d === 0n) throw new Error("有理数分母为 0");
  if (d < 0n) { n = -n; d = -d; }
  const g = bgcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}
function fromInt(x) { return { n: BigInt(x), d: 1n }; }
const FZERO = { n: 0n, d: 1n };
function fadd(a, b) { return fmk(a.n * b.d + b.n * a.d, a.d * b.d); }
function fsub(a, b) { return fmk(a.n * b.d - b.n * a.d, a.d * b.d); }
function fmul(a, b) { return fmk(a.n * b.n, a.d * b.d); }
function fdiv(a, b) {
  if (b.n === 0n) throw new Error("有理数除以 0");
  return fmk(a.n * b.d, a.d * b.n);
}
// 比较 a<b:-1 a==b:0 a>b:1
function fcmp(a, b) {
  const l = a.n * b.d, r = b.n * a.d; // 分母均正，可直接比分子交叉积
  return l < r ? -1 : l > r ? 1 : 0;
}
// 最近整数（round half up）：floor(a + 1/2) → BigInt
function fround(a) {
 // floor((2n + d) / (2d))
  const num = 2n * a.n + a.d;
  const den = 2n * a.d;
  let q = num / den;
  if (num % den !== 0n && num < 0n) q -= 1n; // BigInt 除法向 0 截断 → 修正 floor
  return q;
}

// ============================================================
// 向量点积（整数 BigInt 向量 · 有理向量 / 有理·有理）
// ============================================================
function dotIQ(intVec, qVec) { // int(BigInt[]) · rational(Fraction[])
  let s = FZERO;
  for (let t = 0; t < intVec.length; t++) s = fadd(s, fmul(fromInt(intVec[t]), qVec[t]));
  return s;
}
function dotQQ(a, b) { // rational · rational
  let s = FZERO;
  for (let t = 0; t < a.length; t++) s = fadd(s, fmul(a[t], b[t]));
  return s;
}

// ============================================================
// Gram–Schmidt 正交化（精确有理数）
// 输入整数基 B（BigInt[][]），返回 { mu, bstar, Bn }
// bstar[i] 正交向量（Fraction[]）
// Bn[i] <b*_i, b*_i>（Fraction）
// mu[i][j] = <b_i, b*_j> / Bn[j]（Fraction），j<i
// ============================================================
function gso(B) {
  const n = B.length;
  const mu = [];
  const bstar = [];
  const Bn = [];
  for (let i = 0; i < n; i++) {
    mu[i] = [];
    const v = B[i].map((x) => fromInt(x)); // b*_i 从 b_i 出发
    for (let j = 0; j < i; j++) {
      const m = fdiv(dotIQ(B[i], bstar[j]), Bn[j]); // μ_{i,j}
      mu[i][j] = m;
      for (let t = 0; t < v.length; t++) v[t] = fsub(v[t], fmul(m, bstar[j][t]));
    }
    bstar[i] = v;
    Bn[i] = dotQQ(v, v);
  }
  return { mu, bstar, Bn };
}

// ============================================================
// LLL 归约（标准伪码，δ 有理参数，默认 3/4）
// Cohen Alg 2.6.3 / Wikipedia。就地归约整数基 B（会被修改），返回同一 B。
// maxIter 防病态输入无限循环。
// ============================================================
function lllReduce(B, delta, maxIter) {
  const n = B.length;
  if (n === 0) return B;
  let { mu, Bn } = gso(B);
  let k = 1;
  let iter = 0;
  const LIMIT = maxIter || 200000;
  while (k < n) {
    if (++iter > LIMIT) throw new Error(`LLL 迭代超过上限 ${LIMIT}，输入可能过大或病态`);
 // ---- size reduction：对 j = k-1..0 ----
    for (let j = k - 1; j >= 0; j--) {
      const q = fround(mu[k][j]); // 最近整数
      if (q !== 0n) {
        for (let t = 0; t < B[k].length; t++) B[k][t] -= q * B[j][t];
        ({ mu, Bn } = gso(B)); // 基已变 → 重算 GSO
      }
    }
 // ---- Lovász 条件：Bn[k] >= (δ - μ_{k,k-1}^2)·Bn[k-1] ----
    const muk = mu[k][k - 1];
    const rhs = fmul(fsub(delta, fmul(muk, muk)), Bn[k - 1]);
    if (fcmp(Bn[k], rhs) >= 0) {
      k += 1;
    } else {
 // 交换 b_k, b_{k-1}
      const tmp = B[k]; B[k] = B[k - 1]; B[k - 1] = tmp;
      ({ mu, Bn } = gso(B));
      k = Math.max(k - 1, 1);
    }
  }
  return B;
}

// 整数向量欧氏范数平方（BigInt）
function normSq(v) {
  let s = 0n;
  for (const x of v) s += x * x;
  return s;
}

// ============================================================
// 应用 A：背包（子集和）低密度攻击 —— CJLOSS 构造 + LLL
// 输入 β（公钥，BigInt[] 长 n）、c（密文块 / 目标子集和，BigInt）。
// 返回 { ok, x } —— x 为 0/1 数组（长 n），Σ x_i β_i == c；失败 ok=false。
// ============================================================
function knapsackAttackBlock(beta, c, deltaFrac, maxIter) {
  const n = beta.length;
 // 整数平方根（floor）
  let N;
  {
    let lo = 0n, hi = BigInt(n) + 1n; // ⌊√n⌋
    let r = 0n;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1n;
      if (mid * mid <= BigInt(n)) { r = mid; lo = mid + 1n; } else hi = mid - 1n;
    }
    N = r + 1n; // N = ⌊√n⌋ + 1 > √n
  }
 // 构造 (n+1)×(n+1) 整数格（CJLOSS ×2 形式）
  const B = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(n + 1).fill(0n);
    row[i] = 2n;
    row[n] = N * beta[i];
    B.push(row);
  }
  const last = new Array(n + 1).fill(1n);
  last[n] = N * c;
  B.push(last);

  lllReduce(B, deltaFrac, maxIter);

 // 从归约基各行读候选：最后一维须为 0，前 n 维全 ∈{±1}
  const tryVec = (w) => {
    if (w[n] !== 0n) return null;
    const x = new Array(n);
    for (let i = 0; i < n; i++) {
      if (w[i] === 1n) x[i] = 1;        // 2x-1=1 → x=1
      else if (w[i] === -1n) x[i] = 0;  // 2x-1=-1 → x=0
      else return null;
    }
 // 校验 Σ x_i β_i == c
    let s = 0n;
    for (let i = 0; i < n; i++) if (x[i]) s += beta[i];
    return s === c ? x : null;
  };
  for (const w of B) {
    let x = tryVec(w);
    if (x) return { ok: true, x, N, basis: B };
 // 取负向量再试（LLL 输出方向不定）
    x = tryVec(w.map((e) => -e));
    if (x) return { ok: true, x, N, basis: B };
  }
  return { ok: false, x: null, N, basis: B };
}

// ============================================================
// 位 → 字节（MSB 优先），与 knapsack.js encryptBytes 位序一致
// ============================================================
function bitsToBytesMSB(bits) {
  const byteLen = Math.floor(bits.length / 8);
  const out = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | (bits[i * 8 + k] || 0);
    out[i] = b;
  }
  return out;
}
function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
function bytesToUtf8(b) {
  return new TextDecoder("utf-8", { fatal: false }).decode(b);
}

// ============================================================
// 解析工具
// ============================================================
function parseBigList(text, label) {
  const parts = String(text || "").trim().replace(/[\s\n\r]+/g, "").split(",").filter(Boolean);
  if (parts.length === 0) throw new Error(`缺少参数 ${label}`);
  return parts.map((s) => {
    try { return BigInt(s); } catch { throw new Error(`${label} 含非法整数：${s}`); }
  });
}
// 密文可能是多块（逗号分隔），逐块攻击 → 拼字节
function parseBlocks(text, label) {
  const parts = String(text || "").trim().replace(/[\s\n\r]+/g, "").split(",").filter(Boolean);
  if (parts.length === 0) throw new Error(`缺少参数 ${label}`);
  return parts.map((s) => {
    try { return BigInt(s); } catch { throw new Error(`${label} 含非法整数：${s}`); }
  });
}
// 通用矩阵：行以换行 / ; 分隔，行内以逗号 / 空白分隔
function parseMatrix(text) {
  const rows = String(text || "")
    .trim()
    .split(/[;\n\r]+/)
    .map((r) => r.trim())
    .filter(Boolean);
  if (rows.length === 0) throw new Error("矩阵为空");
  const M = rows.map((r, ri) => {
    const cols = r.split(/[\s,]+/).filter(Boolean).map((s) => {
      try { return BigInt(s); } catch { throw new Error(`第 ${ri + 1} 行含非法整数：${s}`); }
    });
    return cols;
  });
  const w = M[0].length;
  if (M.some((row) => row.length !== w)) throw new Error("矩阵各行列数不一致");
  if (w === 0) throw new Error("矩阵列数为 0");
  return M;
}
function deltaOf(p) {
  const v = (p && p.delta) || "0.75";
  if (v === "0.99") return fmk(99n, 100n);
  return fmk(3n, 4n); // 默认标准 δ=3/4
}
function fmtVec(v) { return "[" + v.map((x) => x.toString()).join(", ") + "]"; }

// ============================================================
// run 入口
// ============================================================
function lllRun(text, p) {
  const mode = (p && p.mode) || "knapsack";
  const delta = deltaOf(p);
  const maxIter = Math.max(1000, Number((p && p.maxIter) || 200000));
  const lines = [];

  if (mode === "general") {
 // ---- 应用 B：通用整数格 LLL 归约 ----
    const src = (p && p.matrix && String(p.matrix).trim()) ? p.matrix : text;
    const M = parseMatrix(src);
    if (M.length > 64) throw new Error("矩阵行数上限 64（防超时）");
    const B = M.map((r) => r.slice());
    lllReduce(B, delta, maxIter);

 // 最短向量（按范数平方）
    let sIdx = 0, sBest = null;
    for (let i = 0; i < B.length; i++) {
      const ns = normSq(B[i]);
      if (sBest === null || ns < sBest) { sBest = ns; sIdx = i; }
    }
    lines.push("=== 格基归约 LLL · 通用归约（应用 B） ===");
    lines.push(`δ = ${delta.n}/${delta.d}   维数 = ${B.length}×${B[0].length}`);
    lines.push("");
    lines.push("● 归约后基（每行一个格向量）");
    for (const row of B) lines.push(`  ${fmtVec(row)}   |v|² = ${normSq(row)}`);
    lines.push("");
    lines.push("● 最短向量");
    lines.push(`  ${fmtVec(B[sIdx])}   |v|² = ${sBest}  (|v| ≈ ${Math.sqrt(Number(sBest)).toFixed(4)})`);
    lines.push("");
    lines.push("说明：LLL 归约保持格不变（同一整数线性张成），输出基满足 |μ_{i,j}|≤1/2 与 Lovász 条件，");
    lines.push("      首向量为近似最短向量（近似因子 ≤ 2^{(n-1)/2}）。");
    return lines.join("\n");
  }

 // ---- 应用 A：背包低密度攻击 ----
  const beta = parseBigList((p && p.pubkey) || "", "公钥 β");
  const cipherSrc = (p && p.cipher && String(p.cipher).trim()) ? p.cipher : text;
  const blocks = parseBlocks(cipherSrc, "密文 c（逗号分隔块）");
  const n = beta.length;
  if (n < 2) throw new Error("公钥 β 至少 2 项");
  if (n > 64) throw new Error("公钥项数上限 64（防超时）");

 // 密度 d = n / log2(max β)
  let maxB = 0n;
  for (const b of beta) if (b > maxB) maxB = b;
  const log2max = maxB > 0n ? maxB.toString(2).length : 1;
  const density = n / log2max;

  lines.push("=== 格基归约 LLL · 背包低密度攻击（应用 A · CJLOSS） ===");
  lines.push(`δ = ${delta.n}/${delta.d}   背包项数 n = ${n}   密文块数 = ${blocks.length}`);
  lines.push(`背包密度 d = n / log2(max β) ≈ ${density.toFixed(4)}`);
  if (density < 0.9408) lines.push("  ✓ 低密度（d < 0.9408）：CJLOSS 格归约理论上可还原明文。");
  else lines.push("  × 密度 ≥ 0.9408：超出 CJLOSS 保证范围，攻击可能失败。");
  lines.push("");

  const allBits = [];
  let allOk = true;
  const perBlock = [];
  for (let bi = 0; bi < blocks.length; bi++) {
    const res = knapsackAttackBlock(beta, blocks[bi], delta, maxIter);
    if (!res.ok) { allOk = false; perBlock.push(`  块#${bi}: ✗ 未从短向量还原（尝试逐块失败）`); continue; }
    for (const x of res.x) allBits.push(x);
    perBlock.push(`  块#${bi}: x = ${fmtVec(res.x)}  (Σ x_iβ_i = ${blocks[bi]} 校验通过, 格维 ${n + 1}, N=${res.N})`);
  }

  lines.push("● 逐块恢复的明文位向量 x（x_i=1 表示取 β_i）");
  for (const l of perBlock) lines.push(l);
  lines.push("");

  if (allOk && allBits.length > 0) {
    const bytes = bitsToBytesMSB(allBits);
 // 去末尾补零字节（末块可能补 0）
    let end = bytes.length;
    while (end > 0 && bytes[end - 1] === 0) end--;
    const trimmed = bytes.subarray(0, end);
    lines.push("● 还原明文");
    lines.push(`  位串(MSB优先): ${allBits.join("")}`);
    lines.push(`  字节(hex): ${bytesToHex(bytes)}`);
    lines.push(`  UTF-8 尝试: ${bytesToUtf8(trimmed.length ? trimmed : bytes)}`);
  } else {
    lines.push("● 攻击未完全成功：部分块未能还原。可尝试 δ=0.99、确认 β/密文正确、或密度过高不适用。");
  }
  return lines.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "lllAttack",
  cat: "crypto",
  name: "格基归约 LLL 攻击",
  desc: "LLL（Lenstra–Lenstra–Lovász）格基归约，精确 BigInt 有理数 GSO（δ=3/4 标准，可选 0.99）。应用A：背包低密度攻击（CJLOSS 构造，由公钥 β+密文恢复 0/1 明文，配 Merkle-Hellman）；应用B：通用整数矩阵归约求短向量。",
  params: [
    {
      key: "mode", label: "模式", type: "select", default: "knapsack",
      options: [
        { value: "knapsack", label: "应用A · 背包低密度攻击（CJLOSS）" },
        { value: "general", label: "应用B · 通用格归约（整数矩阵）" },
      ],
    },
    { key: "pubkey", label: "公钥 β（应用A，逗号分隔）", type: "text", default: "", placeholder: "β1,β2,...,βn（Merkle-Hellman 公钥）" },
    { key: "cipher", label: "密文 c（应用A，可多块；留空取输入框）", type: "text", default: "", placeholder: "c1,c2,...（每块一个子集和）" },
    { key: "matrix", label: "整数矩阵（应用B；留空取输入框）", type: "text", default: "", placeholder: "行用换行/分号分隔，元素用逗号/空格，如 1 1 1; -1 0 2; 3 5 6" },
    {
      key: "delta", label: "δ 参数", type: "select", default: "0.75",
      options: [
        { value: "0.75", label: "3/4（标准）" },
        { value: "0.99", label: "99/100（更强归约）" },
      ],
    },
    { key: "maxIter", label: "LLL 迭代上限", type: "number", default: 200000, placeholder: "防病态输入死循环" },
  ],
  run: lllRun,
});

export {
  lllReduce,
  gso,
  knapsackAttackBlock,
  bitsToBytesMSB,
  normSq,
  fmk, fadd, fsub, fmul, fdiv, fcmp, fround, fromInt,
  lllRun,
};
