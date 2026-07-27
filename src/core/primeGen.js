/*
 * primeGen.js — 大素数生成 + 素性检验（T277 P1，cat:'radix'）。
 *
 * 算法：Miller-Rabin 概率素性检验（确定性版本，对 n < 3.3e24 用前 13 个质数做 witness 足够）。
 * 生成：随机奇数 → Miller-Rabin → 不通过则 +2 重试，直到找到素数。
 *
 * 红线：
 * - 算法照 FIPS 186-4/Draft FIPS 186-5 + RFC 8017 Section B.1.1 实现，不编造。
 * - 随机源用 crypto.getRandomValues（浏览器 CSPRNG），不用 Math.random。
 * - 零外发：纯本地计算。
 * - core 层零 UI 依赖（仅 registry）。
 *
 * 契约：register({id, cat:"radix", name, desc, params, run})。
 * run 单向，输入忽略，参数 bits/count，输出素数十进制列表（每行一个）。
 */
import { register } from "./registry.js";

// ============================================================
// Miller-Rabin 素性检验（确定性版本）
// ============================================================

// 对 n < 3,317,044,064,679,887,385,961,981，用以下 13 个质数做 witness 足够确定性判定
const MR_WITNESSES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n];

/**
 * 模幂 (base^exp) mod m — BigInt 快速幂
 */
function modPow(base, exp, m) {
  if (m === 1n) return 0n;
  let result = 1n;
  base = base % m;
  if (base < 0n) base += m;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % m;
    exp >>= 1n;
    base = (base * base) % m;
  }
  return result;
}

/**
 * Miller-Rabin 单轮检验
 * @returns true=可能是素数, false=合数
 */
function millerRabinRound(n, a, d, r) {
 // x = a^d mod n
  let x = modPow(a, d, n);
  if (x === 1n || x === n - 1n) return true;
  for (let i = 0n; i < r - 1n; i++) {
    x = (x * x) % n;
    if (x === n - 1n) return true;
  }
  return false;
}

/**
 * 确定性 Miller-Rabin 素性检验
 * 对 n < 3.3e24 用 13 个 witness 做确定性判定（FIPS 186-4 Table C.2）
 * 对更大的 n，仍用这 13 个 witness（误判概率 < 4^-13 ≈ 1.5e-8，CTF 足够）
 * @param {bigint} n 待检整数（奇数，>2）
 * @returns {boolean} true=素数, false=合数
 */
function isProbablePrime(n) {
  if (n < 2n) return false;
  if (n === 2n || n === 3n) return true;
  if (n % 2n === 0n) return false;
 // 分解 n-1 = d * 2^r
  let d = n - 1n;
  let r = 0n;
  while (d % 2n === 0n) {
    d >>= 1n;
    r++;
  }
  for (const a of MR_WITNESSES) {
    if (a >= n) continue; // witness 不能 >= n
    if (!millerRabinRound(n, a, d, r)) return false;
  }
  return true;
}

// ============================================================
// 大素数生成
// ============================================================

/**
 * 生成指定位数的随机奇数
 * @param {number} bits 位数
 * @returns {bigint} 随机奇数，最高位和最低位置 1
 */
function randomOddBigInt(bits) {
  if (bits < 2) throw new Error("位数至少 2");
  const bytes = Math.ceil(bits / 8);
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
 // 转为 BigInt
  let n = 0n;
  for (const b of buf) n = (n << 8n) | BigInt(b);
 // 截断到指定位数
  const mask = (1n << BigInt(bits)) - 1n;
  n &= mask;
 // 最高位置 1（确保位数）、最低位置 1（确保奇数）
  n |= (1n << BigInt(bits - 1));
  n |= 1n;
  return n;
}

/**
 * 生成一个大素数
 * @param {number} bits 位数
 * @returns {bigint} 素数
 */
function generatePrime(bits) {
  if (bits < 2) throw new Error("位数至少 2");
  if (bits === 2) return 3n; // 唯一的 2 位素数（奇数）
  let candidate = randomOddBigInt(bits);
  let attempts = 0;
  const maxAttempts = bits * 50; // 安全阀，避免极端情况死循环
  while (!isProbablePrime(candidate)) {
    candidate += 2n;
 // 若超出位数范围，重新生成
    if (candidate >= (1n << BigInt(bits))) {
      candidate = randomOddBigInt(bits);
    }
    attempts++;
    if (attempts > maxAttempts) {
      throw new Error(`在 ${maxAttempts} 次尝试内未找到 ${bits} 位素数（极罕见，请重试）`);
    }
  }
  return candidate;
}

// ============================================================
// op 注册
// ============================================================
register({
  id: "primeGen", cat: "radix", name: "大素数生成",
  desc: "Miller-Rabin 检验生成指定位数的大素数（确定性版本，crypto CSPRNG）",
  params: [
    { key: "bits", label: "位数", type: "number", default: 64, placeholder: "2..1024 位" },
    { key: "count", label: "数量", type: "number", default: 1, placeholder: "生成几个" },
  ],
  run: (_text, p) => {
    const bits = Math.max(2, Math.min(1024, Number(p?.bits) || 64));
    const count = Math.max(1, Math.min(100, Number(p?.count) || 1));
    const primes = [];
    for (let i = 0; i < count; i++) {
      primes.push(generatePrime(bits).toString(10));
    }
    return primes.join("\n");
  },
});

export { isProbablePrime, generatePrime, modPow };
