/*
 * rsatool.js — 数论 / RSA 攻击工具组（T60，cat:'analysis'）。
 *
 * 覆盖：
 * - rsaParams RSA 参数计算（p,q,e → n,φ,d,dp,dq,qinv）
 * - rsaSmallE 小 e 攻击（c 开 e 次整数根，含 c+k·n 试探）
 * - rsaCommonModulus 共模攻击（e1,e2 互质 → 扩展欧几里得 → m = c1^a · c2^b mod n）
 * - rsaWiener Wiener 攻击（连分数展开 e/n 收敛子 → 小 d 密钥恢复）
 * - rsaFermat 费马分解（p,q 相近：n = a²-b² = (a-b)(a+b)）
 * - rsaPollard Pollard rho 分解（Floyd 环检测 + gcd）
 * - rsaModinv 模逆（双向自反：inv(inv(a)) = a）
 * - rsaEgcd 扩展欧几里得（a·x + b·y = g 报告）
 * - rsaCrt 中国剩余定理 CRT（x ≡ r_i mod m_i 合并）
 * - rsaModpow 大数快速幂（base^exp mod m）
 *
 * 红线：
 * - 只新建本文件，不碰任何现有 core/*.js。
 * - 大数一律 BigInt；modInverse / rsaPow 复用 modern.js 已导出的纯函数（import，不重造）。
 * - 攻击类用 run 单向；参数计算类如可逆则 encode+decode（rsaModinv 自反双向）。
 * - 注册契约：register({id, cat:"analysis", name, desc, params, run?})。
 *
 * 输入约定：大数十进制字符串；多值按换行或逗号分隔（parseBigInts）。
 * 主待处理数据（密文/待分解数/待求逆值）走输入框 text，结构化参数走 params。
 */

import { register } from "./registry.js";
import { modInverse, rsaPow } from "./modern.js";

// ============================================================
// 通用数论工具
// ============================================================

/** 解析文本为 BigInt 数组（按逗号/中文逗号/空白/换行分隔，过滤空段）。 */
function parseBigInts(text) {
  const parts = String(text).split(/[,，\s\n]+/).map((s) => s.trim()).filter(Boolean);
  return parts.map((s) => BigInt(s));
}

/** 大数 gcd（非负）。 */
function bigGcd(a, b) {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

/**
 * 扩展欧几里得（迭代版，防爆栈）：返回 [g, x, y] 使 a·x + b·y = g = gcd(a,b)。
 * 与 modern.js 内部 egcd 同算法；此处局部实现供 CRT / 共模 / Wiener 复用（不重造 modInverse）。
 */
function egcd(a, b) {
  let oldR = a, r = b;
  let oldS = 1n, s = 0n;
  let oldT = 0n, t = 1n;
  while (r !== 0n) {
    const q = oldR / r;
    const pr = r;
    r = oldR - q * r;
    oldR = pr;
    const ps = s, pt = t;
    s = oldS - q * s;
    t = oldT - q * t;
    oldS = ps;
    oldT = pt;
  }
  return [oldR, oldS, oldT]; // g, x, y
}

/** 大数整数平方根（牛顿法）：返回 floor(√n)。 */
function isqrt(n) {
  if (n < 0n) throw new Error("负数无实平方根");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** 大数整数 k 次方根（二分）：返回 floor(n^(1/k))。k 为正整数（BigInt 或 Number）。 */
function iroot(n, k) {
  if (typeof k !== "bigint") k = BigInt(k);
  if (k <= 0n) throw new Error("开方次数须为正整数");
  if (k === 1n) return n;
  if (n < 0n) throw new Error("负数不能开整数根");
  if (n === 0n) return 0n;
  if (k > 1000000n) throw new Error("开方次数过大");
  let lo = 1n, hi = 2n;
  while (hi ** k <= n) hi *= 2n;
  while (hi - lo > 1n) {
    const mid = (lo + hi) / 2n;
    if (mid ** k <= n) lo = mid;
    else hi = mid;
  }
  return lo;
}

// ============================================================
// RSA 参数计算（p,q,e → n,φ,d,dp,dq,qinv）
// ============================================================
function rsaParamsReport(text, p) {
  const nums = parseBigInts(text);
  if (nums.length < 2) throw new Error("需输入 p 和 q（每行一个或逗号分隔）");
  const pp = nums[0], qq = nums[1];
  const e = BigInt(String((p && p.e) || "65537").trim());
  const n = pp * qq;
  const phi = (pp - 1n) * (qq - 1n);
  const d = modInverse(e, phi);
  const dp = d % (pp - 1n);
  const dq = d % (qq - 1n);
  const qinv = modInverse(qq, pp);
  const lines = [];
  lines.push("=== RSA 参数计算 ===");
  lines.push(`p    = ${pp}`);
  lines.push(`q    = ${qq}`);
  lines.push(`e    = ${e}`);
  lines.push(`n    = ${n}`);
  lines.push(`φ(n) = ${phi}`);
  lines.push(`d    = ${d}`);
  lines.push(`dp   = d mod (p-1) = ${dp}`);
  lines.push(`dq   = d mod (q-1) = ${dq}`);
  lines.push(`qinv = q⁻¹ mod p   = ${qinv}`);
  lines.push("");
  lines.push("校验: e·d mod φ = " + ((e * d) % phi) + " (应为 1)");
  lines.push(`公钥  (n, e) = (${n}, ${e})`);
  lines.push(`私钥  (n, d) = (${n}, ${d})`);
  return lines.join("\n");
}

// ============================================================
// 小 e 攻击（c = m^e，e 很小时开整数根；含 c+k·n 试探应对 m^e 略 > n）
// ============================================================
function smallEAttack(c, e, n) {
  const E = BigInt(e);
  const r = iroot(c, E);
  if (r ** E === c) return r;
  if (n && n > 0n) {
 // c 可能为 m^e mod n，明文 m^e 略大于 n 被 mod 截断；试 c+k·n
    for (let k = 1n; k < 10000n; k++) {
      const cand = c + k * n;
      const rr = iroot(cand, E);
      if (rr ** E === cand) return rr;
    }
  }
  return null;
}

function rsaSmallEReport(text, p) {
  const c = BigInt(String(text).trim());
  const e = BigInt(String((p && p.e) || "3").trim());
  const nStr = String((p && p.n) || "").trim();
  const n = nStr ? BigInt(nStr) : 0n;
  const m = smallEAttack(c, e, n);
  const lines = [];
  lines.push("=== 小 e 攻击（整数开根）===");
  lines.push(`c = ${c}`);
  lines.push(`e = ${e}`);
  if (n) lines.push(`n = ${n}`);
  lines.push("");
  if (m !== null) {
    lines.push(`✓ 开根成功: m = ${m}`);
    lines.push(`校验: m^e = ${m ** e}${n ? " mod n = " + rsaPow(m, e, n) : ""} (应 = c${n ? " mod n" : ""})`);
  } else {
    lines.push("✗ 开根失败：c 不是完全 e 次幂（可能 e 不够小，或 m^e 被模 n 截断且超出试探范围）");
  }
  return lines.join("\n");
}

// ============================================================
// 共模攻击（同一 n、同一 m，不同 e1/e2 互质 → 恢复 m）
// egcd(e1,e2)=1=a·e1+b·e2 ⇒ m = c1^a · c2^b mod n
// 负指数转模逆处理。
// ============================================================
function commonModulusAttack(n, e1, e2, c1, c2) {
  const [g, a, b] = egcd(e1, e2);
  if (g !== 1n) return { ok: false, reason: `e1,e2 不互质（gcd=${g}），共模攻击不适用` };
  const powMod = (base, exp) => {
 // exp 可正可负；负 → 先求模逆再正幂
    if (exp < 0n) {
      const inv = modInverse(((base % n) + n) % n, n);
      return rsaPow(inv, -exp, n);
    }
    return rsaPow(((base % n) + n) % n, exp, n);
  };
  const m = (powMod(c1, a) * powMod(c2, b)) % n;
  return { ok: true, m: ((m % n) + n) % n, a, b };
}

function rsaCommonModulusReport(text, p) {
  const nums = parseBigInts(text);
  if (nums.length < 2) throw new Error("需输入 c1 和 c2（每行一个或逗号分隔）");
  const c1 = nums[0], c2 = nums[1];
  const n = BigInt(String((p && p.n) || "").trim());
  const e1 = BigInt(String((p && p.e1) || "").trim());
  const e2 = BigInt(String((p && p.e2) || "").trim());
  const r = commonModulusAttack(n, e1, e2, c1, c2);
  const lines = [];
  lines.push("=== 共模攻击 ===");
  lines.push(`n  = ${n}`);
  lines.push(`e1 = ${e1},  c1 = ${c1}`);
  lines.push(`e2 = ${e2},  c2 = ${c2}`);
  lines.push("");
  if (r.ok) {
    lines.push(`egcd(e1,e2): a = ${r.a}, b = ${r.b}  (a·e1 + b·e2 = 1)`);
    lines.push(`✓ m = ${r.m}`);
  } else {
    lines.push(`✗ ${r.reason}`);
  }
  return lines.join("\n");
}

// ============================================================
// Wiener 攻击（连分数展开 e/n，收敛子 k/d 验证 d < n^(1/4)/3 的小私钥）
// ============================================================
function wienerAttack(e, n) {
  let r0 = e, r1 = n;
 // 收敛子递推：k_{-2}=0,k_{-1}=1; d_{-2}=1,d_{-1}=0
  let kPrev = 0n, kCur = 1n;
  let dPrev = 1n, dCur = 0n;
  let steps = 0;
  while (r1 !== 0n && steps < 2000) {
    const a = r0 / r1;
    const k = a * kCur + kPrev;
    const d = a * dCur + dPrev;
 // 验证：phi = (e·d - 1)/k 须整数；再由 n,phi 求 p,q
    if (k !== 0n && (e * d - 1n) % k === 0n) {
      const phi = (e * d - 1n) / k;
      const s = n - phi + 1n; // p + q
      const disc = s * s - 4n * n;
      if (disc >= 0n) {
        const sq = isqrt(disc);
        if (sq * sq === disc && (s + sq) % 2n === 0n) {
          const pp = (s + sq) / 2n;
          const qq = (s - sq) / 2n;
          if (pp > 1n && qq > 1n && pp * qq === n) {
            return { d, p: pp, q: qq, phi, k };
          }
        }
      }
    }
    [r0, r1] = [r1, r0 - a * r1];
    [kPrev, kCur] = [kCur, k];
    [dPrev, dCur] = [dCur, d];
    steps++;
  }
  return null;
}

function rsaWienerReport(text, p) {
  const nums = parseBigInts(text);
  if (nums.length < 2) throw new Error("需输入 e 和 n（每行一个或逗号分隔）");
  const e = nums[0], n = nums[1];
  const r = wienerAttack(e, n);
  const lines = [];
  lines.push("=== Wiener 攻击（连分数，针对小 d）===");
  lines.push(`e = ${e}`);
  lines.push(`n = ${n}`);
  lines.push(`n^(1/4) ≈ ${isqrt(isqrt(n))}`);
  lines.push("");
  if (r) {
    lines.push(`✓ 恢复私钥 d = ${r.d}`);
    lines.push(`p = ${r.p}`);
    lines.push(`q = ${r.q}`);
    lines.push(`φ(n) = ${r.phi}`);
    lines.push(`校验: e·d mod φ = ${((e * r.d) % r.phi)} (应为 1)`);
  } else {
    lines.push("✗ 未找到满足 Wiener 条件（d < n^(1/4)/3）的私钥");
  }
  return lines.join("\n");
}

// ============================================================
// 费马分解（p,q 相近：n = a²-b² ⇒ p=a-b, q=a+b）
// ============================================================
function fermatFactor(n, maxIter) {
  if (n % 2n === 0n) return { p: 2n, q: n / 2n, iter: 0 };
  let a = isqrt(n);
  if (a * a === n) return { p: a, q: a, iter: 0 };
  a += 1n; // ceil(√n)
  let iter = 0;
  while (iter < maxIter) {
    const b2 = a * a - n;
    const b = isqrt(b2);
    if (b * b === b2) return { p: a - b, q: a + b, iter };
    a += 1n;
    iter++;
  }
  return null;
}

function rsaFermatReport(text, p) {
  const n = BigInt(String(text).trim());
  const maxIter = Math.max(1, Math.min(10000000, Number((p && p.maxIter) || 100000)));
  const r = fermatFactor(n, maxIter);
  const lines = [];
  lines.push("=== 费马分解（p,q 相近）===");
  lines.push(`n = ${n}`);
  lines.push(`maxIter = ${maxIter}`);
  lines.push("");
  if (r) {
    lines.push(`✓ 分解成功（${r.iter} 次迭代）:`);
    lines.push(`p = ${r.p}`);
    lines.push(`q = ${r.q}`);
    lines.push(`校验: p·q = ${r.p * r.q} (应 = n)`);
    lines.push(`|p - q| = ${r.p > r.q ? r.p - r.q : r.q - r.p}`);
  } else {
    lines.push(`✗ ${maxIter} 次迭代内未分解（p,q 可能差距过大，改用 Pollard rho）`);
  }
  return lines.join("\n");
}

// ============================================================
// Pollard rho 分解（Floyd 环检测 + gcd；适合含小因子的半素数）
// ============================================================
function pollardRho(n, maxIter) {
  if (n % 2n === 0n) return { factor: 2n, c: 0n, iter: 0 };
  for (let c = 1n; c < n; c++) {
    const f = (x) => (x * x + c) % n;
    let x = 2n, y = 2n, d = 1n;
    let iter = 0;
    while (d === 1n && iter < maxIter) {
      x = f(x);
      y = f(f(y));
      let diff = x - y;
      if (diff < 0n) diff = -diff;
      d = bigGcd(diff, n);
      iter++;
    }
    if (d > 1n && d < n) return { factor: d, c, iter };
 // d === n 则换 c 重试；d === 1 超过迭代上限也换 c
    if (iter >= maxIter && d === 1n) break;
  }
  return null;
}

function rsaPollardReport(text, p) {
  const n = BigInt(String(text).trim());
  const maxIter = Math.max(100, Math.min(100000000, Number((p && p.maxIter) || 1000000)));
  const r = pollardRho(n, maxIter);
  const lines = [];
  lines.push("=== Pollard rho 分解 ===");
  lines.push(`n = ${n}`);
  lines.push(`maxIter = ${maxIter}`);
  lines.push("");
  if (r) {
    const f = r.factor;
    const q = n / f;
    lines.push(`✓ 分解成功（参数 c = ${r.c}, ${r.iter} 次迭代）:`);
    lines.push(`factor = ${f}`);
    if (f !== q) lines.push(`cofactor = ${q}`);
    lines.push(`校验: ${f} · ${q} = ${f * q} (应 = n)`);
    if (f === q) lines.push("注: n 为完全平方数");
  } else {
    lines.push(`✗ 分解失败（可能 n 为素数，或因子过大超时；可增大 maxIter 重试）`);
  }
  return lines.join("\n");
}

// ============================================================
// 模逆（双向自反：encode = decode = 求 a⁻¹ mod m；inv(inv(a)) = a）
// ============================================================
function modinvOp(text) {
  const nums = parseBigInts(text);
  if (nums.length < 2) throw new Error("需输入 a 和 m（每行一个或逗号分隔）");
  const a = nums[0], m = nums[1];
  return modInverse(a, m).toString();
}

// ============================================================
// 扩展欧几里得报告（a·x + b·y = g）
// ============================================================
function rsaEgcdReport(text) {
  const nums = parseBigInts(text);
  if (nums.length < 2) throw new Error("需输入 a 和 b（每行一个或逗号分隔）");
  const a = nums[0], b = nums[1];
  const [g, x, y] = egcd(a, b);
  const lines = [];
  lines.push("=== 扩展欧几里得 ===");
  lines.push(`a = ${a}`);
  lines.push(`b = ${b}`);
  lines.push(`gcd(a, b) = ${g}`);
  lines.push(`x = ${x}`);
  lines.push(`y = ${y}`);
  lines.push("");
  lines.push(`Bézout 等式: a·x + b·y = ${a * x + b * y} (应 = g = ${g})`);
  if (g === 1n) {
    lines.push(`注: a,b 互质，x = ${x} 即 a⁻¹ mod b（若 0<x<b），y = ${y} 即 b⁻¹ mod a（若 0<y<a）`);
  }
  return lines.join("\n");
}

// ============================================================
// 中国剩余定理 CRT（x ≡ r_i mod m_i 合并）
// ============================================================
function crt(residues, moduli) {
  if (residues.length !== moduli.length || residues.length === 0) {
    throw new Error("残差与模数数量须一致且非空");
  }
 // 两两互质校验（非强制，但 CRT 经典式要求）
  for (let i = 0; i < moduli.length; i++) {
    for (let j = i + 1; j < moduli.length; j++) {
      if (bigGcd(moduli[i], moduli[j]) !== 1n) {
        throw new Error(`模数 m[${i}]=${moduli[i]} 与 m[${j}]=${moduli[j]} 不互质，经典 CRT 不适用（可用广义 CRT，本工具暂不实现）`);
      }
    }
  }
  let M = 1n;
  for (const m of moduli) M *= m;
  let x = 0n;
  for (let i = 0; i < residues.length; i++) {
    const Mi = M / moduli[i];
    const yi = modInverse(Mi, moduli[i]);
    x = (x + residues[i] * Mi * yi) % M;
  }
  return ((x % M) + M) % M;
}

function rsaCrtReport(text) {
  const lines0 = String(text).split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (lines0.length < 2) throw new Error("需两行：第一行残差 r1,r2,...，第二行模数 m1,m2,...");
  const residues = lines0[0].split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean).map(BigInt);
  const moduli = lines0[1].split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean).map(BigInt);
  const x = crt(residues, moduli);
  const M = moduli.reduce((a, b) => a * b, 1n);
  const lines = [];
  lines.push("=== 中国剩余定理 CRT ===");
  lines.push("同余方程组:");
  for (let i = 0; i < residues.length; i++) {
    lines.push(`  x ≡ ${residues[i]} (mod ${moduli[i]})`);
  }
  lines.push("");
  lines.push(`模数乘积 M = ${M}`);
  lines.push(`✓ x = ${x}`);
  lines.push("");
  lines.push("校验:");
  let allOk = true;
  for (let i = 0; i < moduli.length; i++) {
    const rem = ((x % moduli[i]) + moduli[i]) % moduli[i];
    const ok = rem === ((residues[i] % moduli[i]) + moduli[i]) % moduli[i];
    if (!ok) allOk = false;
    lines.push(`  x mod ${moduli[i]} = ${rem} ${ok ? "✓" : "✗"}`);
  }
  if (!allOk) lines.push("存在校验失败！");
  return lines.join("\n");
}

// ============================================================
// 大数快速幂（base^exp mod m，复用 modern.js rsaPow）
// ============================================================
function rsaModpowReport(text) {
  const nums = parseBigInts(text);
  if (nums.length < 3) throw new Error("需输入 base, exp, mod（每行一个或逗号分隔）");
  const [base, exp, mod] = nums;
  const r = rsaPow(base, exp, mod);
  const lines = [];
  lines.push("=== 大数快速幂 ===");
  lines.push(`base = ${base}`);
  lines.push(`exp  = ${exp}`);
  lines.push(`mod  = ${mod}`);
  lines.push("");
  lines.push(`✓ base^exp mod mod = ${r}`);
  return lines.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "rsaParams",
  cat: "crypto",
  name: "RSA 参数计算（p,q→n,φ,d）",
  desc: "由 p,q,e 推导 n、φ(n)、d、dp、dq、qinv（输入框填 p 和 q，每行一个或逗号分隔）",
  params: [
    { key: "e", label: "公钥指数 e", type: "text", default: "65537", placeholder: "十进制，如 65537 / 17 / 3" },
  ],
  run: rsaParamsReport,
});
register({
  id: "rsaSmallE",
  cat: "crypto",
  name: "RSA 小 e 攻击（整数开根）",
  desc: "e 很小时对密文 c 开 e 次整数根恢复 m（含 c+k·n 试探应对 m^e 略大于 n）",
  params: [
    { key: "e", label: "公钥指数 e", type: "text", default: "3", placeholder: "通常 3 / 5 / 7" },
    { key: "n", label: "模数 n（可选）", type: "text", default: "", placeholder: "若 c=m^e 精确可留空" },
  ],
  run: rsaSmallEReport,
});
register({
  id: "rsaCommonModulus",
  cat: "crypto",
  name: "RSA 共模攻击",
  desc: "同一 n 同一明文 m，不同互质 e1/e2 加密 → 扩展欧几里得恢复 m（输入框填 c1 和 c2）",
  params: [
    { key: "n", label: "模数 n", type: "text", default: "", placeholder: "十进制模数" },
    { key: "e1", label: "公钥指数 e1", type: "text", default: "", placeholder: "须与 e2 互质" },
    { key: "e2", label: "公钥指数 e2", type: "text", default: "", placeholder: "须与 e1 互质" },
  ],
  run: rsaCommonModulusReport,
});
register({
  id: "rsaWiener",
  cat: "crypto",
  name: "RSA Wiener 攻击（连分数）",
  desc: "连分数展开 e/n 找收敛子，恢复小 d 密钥（适用 d < n^(1/4)/3；输入框填 e 和 n）",
  params: [],
  run: rsaWienerReport,
});
register({
  id: "rsaFermat",
  cat: "crypto",
  name: "费马分解（p,q 相近）",
  desc: "n = a²-b² = (a-b)(a+b)，从 ceil(√n) 递增 a 找 b²（适用 |p-q| 较小；输入框填 n）",
  params: [
    { key: "maxIter", label: "最大迭代", type: "number", default: 100000, placeholder: "1-10000000" },
  ],
  run: rsaFermatReport,
});
register({
  id: "rsaPollard",
  cat: "crypto",
  name: "Pollard rho 分解",
  desc: "Floyd 环检测 + gcd 分解半素数 n（适合含较小因子；输入框填 n）",
  params: [
    { key: "maxIter", label: "单 c 最大迭代", type: "number", default: 1000000, placeholder: "100-100000000" },
  ],
  run: rsaPollardReport,
});
register({
  id: "rsaModinv",
  cat: "crypto",
  name: "模逆（a⁻¹ mod m）",
  desc: "扩展欧几里得求 a 在模 m 下的乘法逆元；双向自反（encode/decode 互逆：inv(inv(a))=a）",
  params: [],
  encode: modinvOp,
  decode: modinvOp,
});
register({
  id: "rsaEgcd",
  cat: "crypto",
  name: "扩展欧几里得（Bézout）",
  desc: "求 gcd(a,b) 及 Bézout 系数 x,y 使 a·x + b·y = g（输入框填 a 和 b）",
  params: [],
  run: rsaEgcdReport,
});
register({
  id: "rsaCrt",
  cat: "crypto",
  name: "中国剩余定理 CRT",
  desc: "合并同余方程组 x ≡ r_i mod m_i（残差、模数各一框，逗号分隔）",
  params: [],
 // 多输入框：残差、模数分两框（逗号分隔），UI 层按 fieldsJoin 换行拼回 rsaCrtReport 的「两行」约定。
  fields: [
    { key: "residues", label: "残差 r₁, r₂, …", placeholder: "例：2, 3, 2", rows: 2 },
    { key: "moduli", label: "模数 m₁, m₂, …", placeholder: "例：3, 5, 7", rows: 2 },
  ],
  fieldsJoin: "\n",
  run: rsaCrtReport,
});
register({
  id: "rsaModpow",
  cat: "crypto",
  name: "大数快速幂（base^exp mod m）",
  desc: "BigInt 模幂运算（输入框填 base, exp, mod，每行一个或逗号分隔）",
  params: [],
  run: rsaModpowReport,
});

export {
  rsaParamsReport,
  rsaSmallEReport,
  rsaCommonModulusReport,
  rsaWienerReport,
  rsaFermatReport,
  rsaPollardReport,
  modinvOp,
  rsaEgcdReport,
  rsaCrtReport,
  rsaModpowReport,
 // 导出纯算法供测试
  parseBigInts,
  bigGcd,
  egcd,
  isqrt,
  iroot,
  smallEAttack,
  commonModulusAttack,
  wienerAttack,
  fermatFactor,
  pollardRho,
  crt,
};
