/*
 * dlp.js — 离散对数求解（Discrete Logarithm Problem）。
 *
 * 求解 g^x ≡ h (mod p) 中的指数 x。
 *
 * 双策略（自动 + 手选）：
 * - BSGS（Baby-step Giant-step）：确定性 O(√n) 时间 / O(√n) 空间
 * n = 子群阶（默认 p-1）。适合中小阶，命中即返回最小非负 x。
 * - Pollard's rho for logarithms：O(√n) 时间 / O(1) 空间
 * Floyd 环检测 + Teske 三分迭代，阶巨大时省内存（需已知子群阶 n 且为素数效果最佳）。
 *
 * 红线：
 * - 只新建本文件，不碰任何现有 core/*.js（含 rsatool.js / modern.js）。
 * - 纯 BigInt，零 UI 依赖，纯函数 + 模块加载即 register。
 * - 参考 rsatool.js 的 parseBigInts / bigGcd / egcd BigInt 范式（此处独立局部实现
 * 不 import 它以免耦合；modInverse 亦局部实现，算法同扩展欧几里得）。
 *
 * 输入约定：g / h / p 走 params（text，十进制大整数）；可选 order（子群阶，默认 p-1）。
 * 主输入框 text 兼容作为 h（若 params.h 空则取输入框）。
 *
 * 算法依据：
 * - BSGS：Shanks 1971，见 Handbook of Applied Cryptography §3.6.2 (Algorithm 3.56)。
 * - Pollard rho for logs：Pollard 1978 / Teske additive walk，HAC §3.6.3 (Algorithm 3.60)。
 */

import { register } from "./registry.js";

// ============================================================
// 通用数论工具（BigInt，局部实现，范式对齐 rsatool.js）
// ============================================================

/** 解析单个十进制大整数（去空白）。空/非法抛错。 */
function parseBig(s, label) {
  const t = String(s == null ? "" : s).trim();
  if (!t) throw new Error(`缺少参数 ${label}`);
  try {
    return BigInt(t);
  } catch {
    throw new Error(`参数 ${label} 不是合法整数：${t}`);
  }
}

/** 大数 gcd（非负）。 */
function bigGcd(a, b) {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

/** 正规化到 [0, m)。 */
function mod(a, m) {
  const r = a % m;
  return r < 0n ? r + m : r;
}

/** 扩展欧几里得：返回 [g, x, y] 使 a·x + b·y = g。 */
function egcd(a, b) {
  let oldR = a, r = b;
  let oldS = 1n, s = 0n;
  let oldT = 0n, t = 1n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  return [oldR, oldS, oldT];
}

/** 模逆 a⁻¹ mod m（要求 gcd(a,m)=1，否则抛错）。 */
function modInverse(a, m) {
  a = mod(a, m);
  const [g, x] = egcd(a, m);
  if (g !== 1n) throw new Error(`模逆不存在：gcd(${a}, ${m}) = ${g} ≠ 1`);
  return mod(x, m);
}

/** 大数模幂 base^exp mod m（exp ≥ 0）。 */
function powMod(base, exp, m) {
  if (m === 1n) return 0n;
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % m;
    exp >>= 1n;
    base = (base * base) % m;
  }
  return result;
}

/** 大数整数平方根 floor(√n)（牛顿法）。 */
function isqrt(n) {
  if (n < 0n) throw new Error("负数无实平方根");
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}

/** ceil(√n)：n 完全平方返回 √n，否则 floor+1。 */
function isqrtCeil(n) {
  const r = isqrt(n);
  return r * r === n ? r : r + 1n;
}

// ============================================================
// BSGS（Baby-step Giant-step）
// 求最小非负 x∈[0,n) 使 g^x ≡ h (mod p)，n = 子群阶（默认 p-1）。
// m = ceil(√n)；baby: g^j (j=0..m-1) 存表；giant: h·(g^{-m})^i 查表。
// 命中 ⇒ x = i·m + j。
// ============================================================
function bsgs(g, h, p, n, maxSteps) {
  g = mod(g, p);
  h = mod(h, p);
  if (h === 1n) return 0n;          // g^0 = 1
  if (g === h) return 1n;           // g^1
  const m = isqrtCeil(n);
  if (maxSteps && m > maxSteps) {
    throw new Error(
      `子群阶 √n ≈ ${m} 超出步数上限 ${maxSteps}，BSGS 需 O(√n) 内存，拒绝以防爆内存/超时。` +
      `可提高上限、缩小 order，或改用 Pollard rho（省内存但同样 O(√n) 时间）。`
    );
  }
 // baby steps：table[g^j] = j
  const table = new Map();
  let e = 1n; // g^0
  for (let j = 0n; j < m; j++) {
    if (!table.has(e)) table.set(e, j); // 保留最小 j
    e = (e * g) % p;
  }
 // factor = g^{-m} mod p
  const gm = powMod(g, m, p);
  const factor = modInverse(gm, p); // (g^m)^{-1}
  let gamma = h;
  for (let i = 0n; i <= m; i++) {
    const hit = table.get(gamma);
    if (hit !== undefined) {
      const x = i * m + hit;
 // 校验（防伪命中，如 g 非生成元时表内碰撞）
      if (powMod(g, x, p) === h) return mod(x, n);
    }
    gamma = (gamma * factor) % p;
  }
  return null;
}

// ============================================================
// Pollard's rho for logarithms
// 在阶为 n 的循环群里，用可加游走 x_{i+1}=f(x_i) 携带 (a,b) 使 x = g^a·h^b
// Floyd 环检测找碰撞 ⇒ g^{a1-a2} = h^{b2-b1} ⇒ x ≡ (a1-a2)/(b2-b1) (mod n)。
// n 为素数时除法直接模逆；n 合数且 (b2-b1) 与 n 不互质时按 gcd 收缩求解。
// O(√n) 时间、O(1) 空间。
// ============================================================
function pollardRhoLog(g, h, p, n, maxIter) {
  g = mod(g, p);
  h = mod(h, p);
  if (h === 1n) return 0n;
  if (g === h) return 1n;

 // 三分区可加游走：按 x mod 3 决定 x←x·g / x² / x·h（Teske additive walk 的经典三分版）
  const step = (x, a, b) => {
    const r = x % 3n;
    if (r === 0n) {          // x·g  ⇒ a+1
      return [(x * g) % p, mod(a + 1n, n), b];
    } else if (r === 1n) {   // x²   ⇒ 指数翻倍
      return [(x * x) % p, mod(a * 2n, n), mod(b * 2n, n)];
    } else {                 // x·h  ⇒ b+1
      return [(x * h) % p, a, mod(b + 1n, n)];
    }
  };

 // 由一次碰撞尝试解出 x：g^{a-A}=h^{B-b} ⇒ (a-A) ≡ x·(B-b) (mod n)。
 // r=(B-b)。r 与 n 互质→直接模逆；否则按 gcd 收缩，枚举 d 个候选并校验。
 // 返回 bigint（成功）/ null（本次碰撞退化或无匹配）。
  const solve = (a, b, A, B) => {
    const r = mod(B - b, n);
    const lhs = mod(a - A, n);
    if (r === 0n) return null; // 退化碰撞，交由外层换起点重试
    const d = bigGcd(r, n);
    if (d === 1n) {
      const cand = mod(lhs * modInverse(r, n), n);
      return powMod(g, cand, p) === h ? cand : null;
    }
    if (lhs % d !== 0n) return null;
    const rr = r / d, ll = lhs / d, nn = n / d;
    const base = mod(ll * modInverse(rr, nn), nn);
    for (let k = 0n; k < d; k++) {
      const cand = mod(base + k * nn, n);
      if (powMod(g, cand, p) === h) return cand;
    }
    return null;
  };

  const limit = maxIter || 100000000n;
  let used = 0n;
 // 多起点重试：起点 x0 = g^a0·h^b0（a0,b0 随尝试变化），退化碰撞不再直接放弃。
  const MAX_TRIES = 64;
  for (let tryI = 0; tryI < MAX_TRIES && used < limit; tryI++) {
    const a0 = mod(BigInt(tryI * 2 + 1), n);
    const b0 = mod(BigInt(tryI * 3 + 1), n);
    const start = (powMod(g, a0, p) * powMod(h, b0, p)) % p;
    let x = start, a = a0, b = b0;      // 慢指针
    let X = start, A = a0, B = b0;      // 快指针
    for (; used < limit; used++) {
      [x, a, b] = step(x, a, b);
      [X, A, B] = step(X, A, B);
      [X, A, B] = step(X, A, B);
      if (x === X) {
        const got = solve(a, b, A, B);
        if (got !== null) return got;   // 求解成功
        break;                          // 退化碰撞 → 换起点
      }
    }
  }
  return undefined; // 迭代/重试预算内未找到
}

// ============================================================
// run 入口
// ============================================================
function dlpRun(text, p) {
  const P = parseBig(p && p.p, "p（模数）");
  if (P < 2n) throw new Error("模数 p 必须 ≥ 2");
  const g = mod(parseBig(p && p.g, "g（底数/生成元）"), P);
 // h 优先取 params.h，空则用主输入框
  const hRaw = (p && p.h != null && String(p.h).trim()) ? p.h : text;
  const h = mod(parseBig(hRaw, "h（目标值，可填输入框）"), P);

 // 子群阶 order，默认 p-1
  const orderRaw = p && p.order != null ? String(p.order).trim() : "";
  const n = orderRaw ? parseBig(orderRaw, "order（子群阶）") : (P - 1n);
  if (n < 1n) throw new Error("子群阶 order 必须 ≥ 1");

  const method = (p && p.method) || "bsgs";
  const maxSteps = BigInt(Math.max(1000, Number((p && p.maxSteps) || 10000000)));

  const lines = [];
  lines.push("=== 离散对数求解 DLP ===");
  lines.push(`求 x 使 g^x ≡ h (mod p)`);
  lines.push(`g = ${g}`);
  lines.push(`h = ${h}`);
  lines.push(`p = ${p ? P : P}`);
  lines.push(`子群阶 n = ${n}${orderRaw ? "" : "  (默认 p-1)"}`);
  lines.push(`方法 = ${method === "rho" ? "Pollard rho for logarithms" : "BSGS (Baby-step Giant-step)"}`);
  lines.push(`√n ≈ ${isqrtCeil(n)}${method === "bsgs" ? `，步数/内存上限 = ${maxSteps}` : ""}`);
  lines.push("");

 // 平凡快捷校验
  if (bigGcd(g, P) !== 1n && P > 1n) {
    lines.push(`注意: gcd(g, p) = ${bigGcd(g, P)} ≠ 1，g 在模 p 下不可逆，可能非群元素，结果仅供参考。`);
    lines.push("");
  }

  let x;
  if (method === "rho") {
    const maxIter = BigInt(Math.max(1000, Number((p && p.maxSteps) || 100000000)));
    x = pollardRhoLog(g, h, P, n, maxIter);
    if (x === undefined) {
      lines.push(`✗ Pollard rho 在 ${maxIter} 次迭代内未找到 x（可增大上限，或该 DLP 无解/阶不对）。`);
      return lines.join("\n");
    }
    if (x === null) {
      lines.push("✗ Pollard rho 遇退化碰撞未能求解，建议改用 BSGS 或调整参数（更换 g）。");
      return lines.join("\n");
    }
  } else {
    x = bsgs(g, h, P, n, maxSteps);
    if (x === null) {
      lines.push("✗ 未找到 x（在 [0, n) 内无解）：h 可能不在 g 生成的子群中，或 order 填错。");
      return lines.join("\n");
    }
  }

  lines.push(`✓ x = ${x}`);
  lines.push(`校验: g^x mod p = ${powMod(g, x, P)}  (应 = h = ${h})`);
  return lines.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "dlp",
  cat: "modern",
  name: "离散对数求解（DLP）",
  desc: "求解 g^x ≡ h (mod p) 中的 x。BSGS（小阶 O(√n)）/ Pollard rho（大阶省内存）双策略，纯 BigInt。h 可填主输入框。",
  params: [
    { key: "g", label: "底数/生成元 g", type: "text", default: "", placeholder: "十进制，如 2 / 5" },
    { key: "h", label: "目标值 h（留空则取输入框）", type: "text", default: "", placeholder: "g^x ≡ h 的 h" },
    { key: "p", label: "模数 p", type: "text", default: "", placeholder: "十进制素数模数" },
    { key: "order", label: "子群阶 order（可选）", type: "text", default: "", placeholder: "默认 p-1，已知子群阶可填" },
    {
      key: "method", label: "算法", type: "select", default: "bsgs",
      options: [
        { value: "bsgs", label: "BSGS（小阶，确定性）" },
        { value: "rho", label: "Pollard rho（大阶，省内存）" },
      ],
    },
    { key: "maxSteps", label: "步数/迭代上限", type: "number", default: 10000000, placeholder: "防爆内存/超时" },
  ],
  run: dlpRun,
});

export {
  parseBig,
  bigGcd,
  egcd,
  modInverse,
  powMod,
  isqrt,
  isqrtCeil,
  bsgs,
  pollardRhoLog,
  dlpRun,
};
