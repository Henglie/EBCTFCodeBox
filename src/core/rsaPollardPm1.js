/*
 * rsaPollardPm1.js — RSA Pollard p-1 分解（T296，cat:'analysis'，单向 run）。
 *
 * 原理：若 RSA 模数 N 的某素因子 p 满足 p-1 是 B-光滑（p-1 的所有素数幂因子 ≤ B）
 * 令 M = ∏_{q≤B, q prime} q^floor(log_q B)，则 p-1 | M。
 * 由 Fermat 小定理 a^(p-1) ≡ 1 (mod p)，故 a^M ≡ 1 (mod p)，于是 p | gcd(a^M-1, N)。
 * 若 1 < gcd(a^M-1, N) < N 即得非平凡因子。
 * - 两因子都 B-光滑 → gcd = N（平凡，失败）
 * - 两因子都不 B-光滑 → gcd = 1（失败，B 太小）
 * 适用 p-1 光滑的 N；与 Pollard rho 互补。
 *
 * 复用：rsatool.js 的 bigGcd。modpow 本地实现（rsatool 未导出纯 modpow）。
 * 红线：算法层零 UI 依赖，件内自注册，大数一律 BigInt。
 * 参考：Wikipedia "Pollard's p − 1 algorithm" stage 1（素数幂累乘法）。
 */
import { register } from "./registry.js";
import { bigGcd } from "./rsatool.js";

// ============================================================
// 通用工具
// ============================================================

/** 大数快速幂 base^exp mod m（平方-乘，二进制扫描）。exp ≥ 0。 */
function modpow(base, exp, mod) {
  if (mod === 1n) return 0n;
  base = ((base % mod) + mod) % mod;
  let result = 1n;
  let e = BigInt(exp);
  while (e > 0n) {
    if (e & 1n) result = (result * base) % mod;
    e >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

/**
 * 埃拉托色尼筛：返回 ≤ bound 的所有素数（升序）。
 * @param {number} bound 正整数上界
 * @returns {number[]}
 */
export function smallPrimes(bound) {
  const b = Math.max(0, Math.floor(Number(bound)));
  if (b < 2) return [];
  const sieve = new Uint8Array(b + 1); // 0 = 素, 1 = 合
  for (let i = 2; i * i <= b; i++) {
    if (!sieve[i]) {
      for (let j = i * i; j <= b; j += i) sieve[j] = 1;
    }
  }
  const out = [];
  for (let i = 2; i <= b; i++) if (!sieve[i]) out.push(i);
  return out;
}

/**
 * 求 prime^e ≤ bound 的最大整数 e（BigInt 累乘，避免浮点误差）。
 * prime 为素数（Number），bound 为正整数（Number）。
 */
function primePowerExponent(prime, bound) {
  const p = BigInt(prime);
  const B = BigInt(bound);
  let e = 0n;
  let pow = 1n;
  while (pow * p <= B) {
    pow *= p;
    e++;
  }
  return e;
}

// ============================================================
// Pollard p-1 分解纯算法（stage 1）
// ============================================================

/**
 * Pollard p-1 分解纯算法。
 * @param {bigint} N 待分解模数（>1 的合数）
 * @param {bigint|number} base 基数 a（≥2，通常 2）
 * @param {number} bound 光滑上界 B（≥2）
 * @returns {{ok:true, p:bigint, q:bigint, a:bigint, bound:number}
 * | {ok:false, reason:string, a?:bigint, bound:number}}
 */
export function pollardPm1(N, base, bound) {
  const n = BigInt(N);
  const Bn = Number(bound);
  const B = Number.isFinite(Bn) && Bn >= 2 ? Math.floor(Bn) : 2;

  if (n < 4n) return { ok: false, reason: `N=${n} 太小（须为 ≥4 的合数）`, bound: B };
 // 偶数直接拆
  if (n % 2n === 0n) {
    return { ok: true, p: 2n, q: n / 2n, a: 2n, bound: B };
  }
  let a = BigInt(base);
  if (a < 2n) return { ok: false, reason: `基数 a=${base} 须 ≥2`, bound: B };
  a = ((a % n) + n) % n;
  if (a < 2n) return { ok: false, reason: `基数 a mod N = ${a}，无效（须 ≥2）`, bound: B };

 // stage 1：a = a^M mod N，M = ∏ q^floor(log_q B)
  const primes = smallPrimes(B);
  for (const q of primes) {
    const e = primePowerExponent(q, B); // q^e ≤ B
    a = modpow(a, BigInt(q) ** e, n);
  }
  const g = bigGcd(a - 1n, n);
  if (g === 1n) {
    return { ok: false, reason: `B=${B} 太小：p-1 与 q-1 均不 B-光滑，gcd(a-1, N)=1`, a, bound: B };
  }
  if (g === n) {
    return { ok: false, reason: `B=${B} 过大：p-1 与 q-1 均 B-光滑，gcd(a-1, N)=N（平凡）`, a, bound: B };
  }
  return { ok: true, p: g, q: n / g, a, bound: B };
}

// ============================================================
// run（单向分析报告）
// ============================================================
function pollardPm1Run(text, p) {
  const ns = String(text)
    .split(/[\n,，;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map(BigInt);
  if (ns.length === 0) throw new Error("请输入待分解的模数 N（十进制，每行一个）");

  const baseRaw = (p && p.base != null ? p.base : 2);
  const base = BigInt(String(baseRaw).trim());
  const boundRaw = Number((p && p.bound != null ? p.bound : 1000));
  const bound = Number.isFinite(boundRaw) && boundRaw >= 2 ? Math.floor(boundRaw) : 1000;

  const lines = [];
  lines.push("=== RSA Pollard p-1 分解 ===");
  lines.push(`基数 a = ${base}`);
  lines.push(`光滑上界 B = ${bound}`);
  lines.push("");

  for (let i = 0; i < ns.length; i++) {
    const n = ns[i];
    lines.push(`[N${i + 1}] = ${n}`);
    if (n < 4n) {
      lines.push(`  ✗ N=${n} 太小（须 ≥4 的合数）`);
      lines.push("");
      continue;
    }
    const r = pollardPm1(n, base, bound);
    if (r.ok) {
      lines.push(`  ✓ 分解成功:`);
      lines.push(`  p = ${r.p}`);
      lines.push(`  q = ${r.q}`);
      lines.push(`  校验: p·q = ${r.p * r.q} (应 = N) ${r.p * r.q === n ? "✓" : "✗"}`);
    } else {
      lines.push(`  ✗ ${r.reason}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

// ============================================================
// 注册
// ============================================================
register({
  id: "rsaPollardPm1",
  cat: "crypto",
  name: "RSA Pollard p-1 分解",
  desc: "Pollard p-1 算法分解 RSA 模数 N（适用 p-1 B-光滑；输入框填 N，每行一个或逗号分隔）",
  params: [
    { key: "base", label: "基数 a", type: "number", default: 2, placeholder: "通常 2" },
    { key: "bound", label: "光滑上界 B", type: "number", default: 1000, placeholder: "如 1000 / 10000" },
  ],
  run: pollardPm1Run,
});

export { pollardPm1Run };
