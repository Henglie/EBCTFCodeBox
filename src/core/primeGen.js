/*
 * primeGen.js — 大素数生成 + 素性检验（P1，cat:'radix'）。
 *
 * 算法：Miller-Rabin 素性检验：
 * - n < 2^64：7 个确定性基（[2,325,9375,28178,450775,9780504,1795265022]）确定性判定；
 * - 2^64 ≤ n < 3.317e24：前 13 个质数 witness 确定性判定（FIPS 186-4 Table C.2）；
 * - n ≥ 3.317e24：13 个固定基 + 多个 CSPRNG 随机基（强 MR 多轮），不再只依赖固定 13 基。
 * 生成：随机奇数 → 小素数候选窗筛（>=96 位，只跳过合数）→ 幸存候选 Miller-Rabin
 *       → 不通过则 +2 重试，直到找到素数。模幂走 Montgomery 规约 + 固定窗口。
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
import { randomBytes as randBytes } from "./randSource.js"; // 统一随机源（默认档 system 逐字节零回归）

// ============================================================
// Miller-Rabin 素性检验（64 位内/3.3e24 内确定性基；更大 n 固定基 + CSPRNG 随机基）
// ============================================================

// 对 n < 3,317,044,064,679,887,385,961,981，用以下 13 个质数做 witness 足够确定性判定
const MR_WITNESSES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n, 41n];
// n < 2^64 的确定性基集（Jim Sinclair 等已验证的 7 基组合）
const MR_64BIT_BASES = [2n, 325n, 9375n, 28178n, 450775n, 9780504n, 1795265022n];
const TWO64 = 1n << 64n;
// 超过确定性界后追加的随机基轮数（强 MR 多轮；误判概率 ≤ 4^-24）
const MR_RANDOM_ROUNDS = 24;

// ============================================================
// 快速模幂：Montgomery 规约 + 固定窗口（奇数模数）；偶数模数回落二进制法。
// 语义与旧实现一致：基归一化到 [0,m)，结果 [0,m)，m=1 → 0，exp<=0 → 1。
// ============================================================
const MONT_CTX_MAX = 8;
const _montCtxCache = new Map();

/** 预计算 Montgomery 上下文：R = 2^(64·words) > m，n0 = -m⁻¹ mod R。 */
function montCtx(m) {
  const hit = _montCtxCache.get(m);
  if (hit) return hit;
  const bits = m.toString(2).length;
  const words = Math.max(1, (bits + 63) >> 6);
  const R = 1n << BigInt(words * 64);
  const mask = R - 1n;
  let inv = 1n;
  let width = 2;
  for (;;) {
    inv = (inv * (2n - m * inv)) & ((1n << BigInt(width)) - 1n);
    if (width >= words * 64) break;
    width *= 2;
  }
  const ctx = { m, R, mask, n0: (-inv) & mask, shift: BigInt(words * 64), one: R % m };
  if (_montCtxCache.size >= MONT_CTX_MAX) _montCtxCache.delete(_montCtxCache.keys().next().value);
  _montCtxCache.set(m, ctx);
  return ctx;
}

/** Montgomery 乘法：返回 a·b·R⁻¹ mod m（a,b < m）。 */
function montMul(ctx, a, b) {
  const t = a * b;
  const u = t + ((((t & ctx.mask) * ctx.n0) & ctx.mask) * ctx.m);
  const r = u >> ctx.shift;
  return r >= ctx.m ? r - ctx.m : r;
}

/**
 * 模幂 (base^exp) mod m。
 * 模数为奇数且规模足够时走 Montgomery + 固定窗口（预计算表随模数缓存，
 * MR 多轮复用同一 n 时只需建表一次）；小指数/偶数模数走二进制法。
 */
function modPow(base, exp, m) {
  if (m === 1n) return 0n;
  base = base % m;
  if (base < 0n) base += m;
  if (exp <= 0n) return 1n;
  if (m < 0n) { // 负数模数不在数学定义域；保留旧二进制法逐位语义，避免进入 Montgomery
    let result = 1n;
    let b = base;
    for (let e = exp; e > 0n; e >>= 1n) {
      if (e & 1n) result = (result * b) % m;
      b = (b * b) % m;
    }
    return result;
  }
  const ebits = exp.toString(2).length;
  const mbits = m.toString(2).length;
  if (mbits < 96 || ebits < 64 || (m & 1n) === 0n) {
    // 左到右二进制：首位直接落 base，e=3/17/65537 等常见小指数少一次模乘
    if (ebits === 1) return base;
    let result = base;
    for (let bit = 1n << BigInt(ebits - 2); bit > 0n; bit >>= 1n) {
      result = (result * result) % m;
      if (exp & bit) result = (result * base) % m;
    }
    return result;
  }
  const ctx = montCtx(m);
  const w = ebits > 768 ? 6 : ebits > 192 ? 5 : 4;
  const nw = 1 << w;
  const table = new Array(nw);
  table[0] = ctx.one;
  table[1] = (base * ctx.R) % m;
  for (let i = 2; i < nw; i++) table[i] = montMul(ctx, table[i - 1], table[1]);
  const ws = BigInt(w);
  const wm = BigInt(nw - 1);
  const limbs = [];
  for (let e = exp; e > 0n; e >>= ws) limbs.push(Number(e & wm));
  let r = ctx.one;
  for (let i = limbs.length - 1; i >= 0; i--) {
    for (let j = 0; j < w; j++) r = montMul(ctx, r, r);
    const d = limbs[i];
    if (d !== 0) r = montMul(ctx, r, table[d]);
  }
  return montMul(ctx, r, 1n);
}

/** 模逆（扩展欧几里得，m > 0；无逆抛错）。CRT 参数补算用。 */
function modInvSmall(a, m) {
  let oldR = a, r = m, oldS = 1n, s = 0n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) throw new Error("CRT 参数 q 与 p 不互素，无法求 qinv");
  return ((oldS % m) + m) % m;
}

/**
 * RSA 私钥运算（RFC 8017 §5.1.2）：c^d mod n。
 * 有有效 p/q（p·q = n）时走 CRT：m1=c^dp mod p，m2=c^dq mod q，m=m2+h·q；
 * 缺 dp/dq/qinv 时由 d/p/q 补算；p/q 不完整或不匹配则回退普通 modPow。
 */
function modPowCrt(c, d, n, p, q, dp, dq, qinv) {
  if (typeof p !== "bigint" || typeof q !== "bigint" || p <= 1n || q <= 1n || p * q !== n) {
    return modPow(c, d, n);
  }
  const dpv = typeof dp === "bigint" ? dp : d % (p - 1n);
  const dqv = typeof dq === "bigint" ? dq : d % (q - 1n);
  let qiv = qinv;
  if (typeof qiv !== "bigint" || ((qiv * q) % p + p) % p !== 1n) qiv = modInvSmall(q % p, p);
  const m1 = modPow(c, dpv, p);
  const m2 = modPow(c, dqv, q);
  const h = (((qiv * (m1 - m2)) % p) + p) % p;
  return m2 + h * q;
}

// ---- 小素数表（试除 / 候选筛）----
const SMALL_TRIAL_LIMIT = 1000;   // isProbablePrime 入口快筛
const GEN_SIEVE_LIMIT = 100000;   // generatePrime 候选窗筛（跳过明显合数）
let _smallPrimeCache = null;

function smallPrimes(limit) {
  if (_smallPrimeCache && _smallPrimeCache.limit >= limit) return _smallPrimeCache;
  const comp = new Uint8Array(limit + 1);
  const list = [];
  for (let i = 2; i <= limit; i++) {
    if (!comp[i]) {
      list.push(i);
      for (let j = i * i; j <= limit; j += i) comp[j] = 1;
    }
  }
  _smallPrimeCache = { limit, list, blist: list.map((x) => BigInt(x)) };
  return _smallPrimeCache;
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

/** 分解 n-1 = d·2^r。 */
function decomposeNMinus1(n) {
  let d = n - 1n;
  let r = 0n;
  while (d % 2n === 0n) {
    d >>= 1n;
    r++;
  }
  return { d, r };
}

/** 依次用给定基数做 Miller-Rabin；任一基判定合数即返回 false。 */
function passesBases(n, bases, d, r) {
  for (const a of bases) {
    if (a >= n) continue; // witness 不能 >= n
    if (!millerRabinRound(n, a, d, r)) return false;
  }
  return true;
}

/** 取 [2, n-2] 内的 CSPRNG 随机 Miller-Rabin 基（仅用于超过确定性界的大 n）。 */
function randomWitness(n) {
  const bits = n.toString(2).length;
  const bytes = Math.ceil(bits / 8) + 8;
  const buf = new Uint8Array(bytes);
  buf.set(randBytes(bytes));
  let v = 0n;
  for (const b of buf) v = (v << 8n) | BigInt(b);
  return (v % (n - 3n)) + 2n;
}

/**
 * Miller-Rabin 素性检验
 * - n < 2^64：7 个确定性基，确定性判定；
 * - 2^64 ≤ n < 3.3e24：13 个固定质数 witness，确定性判定（FIPS 186-4 Table C.2）；
 * - n ≥ 3.3e24：13 个固定基 + 24 个随机基（强 MR 多轮，误判 ≤ 4^-24）。
 * @param {bigint} n 待检整数（奇数，>2）
 * @param {boolean} [skipTrial] 跳过小素数试除（generatePrime 的候选窗已筛过）
 * @returns {boolean} true=素数, false=合数
 */
function isProbablePrime(n, skipTrial = false) {
  if (n < 2n) return false;
  if (n === 2n || n === 3n) return true;
  if (n % 2n === 0n) return false;
  if (!skipTrial) {
    const { list, blist } = smallPrimes(SMALL_TRIAL_LIMIT);
    for (let i = 1; i < list.length && list[i] <= SMALL_TRIAL_LIMIT; i++) { // 跳过 2
      const pb = blist[i];
      if (n === pb) return true;
      if (n % pb === 0n) return false;
    }
  }
  const { d, r } = decomposeNMinus1(n);
  if (n < TWO64) return passesBases(n, MR_64BIT_BASES, d, r);
  if (n < MR_DETERMINISTIC_BOUND) return passesBases(n, MR_WITNESSES, d, r);
  if (!passesBases(n, MR_WITNESSES, d, r)) return false;
  for (let i = 0; i < MR_RANDOM_ROUNDS; i++) {
    if (!millerRabinRound(n, randomWitness(n), d, r)) return false;
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
  buf.set(randBytes(buf.length));
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
  const maxAttempts = bits * 50; // 安全阀，避免极端情况死循环
  if (bits < 96) {
    // 小位数保持原始「随机奇数 → +2 逐个试」路径（输出分布与此前完全一致；
    // 小模数下候选窗筛的固定开销反而更大）
    let candidate = randomOddBigInt(bits);
    let attempts = 0;
    while (!isProbablePrime(candidate)) {
      candidate += 2n;
      if (candidate >= (1n << BigInt(bits))) candidate = randomOddBigInt(bits);
      attempts++;
      if (attempts > maxAttempts) {
        throw new Error(`在 ${maxAttempts} 次尝试内未找到 ${bits} 位素数（极罕见，请重试）`);
      }
    }
    return candidate;
  }
  // 候选窗：先用 < 1e5 的小素数批量划掉明显合数，只对幸存候选做 MR。
  // 被划掉的都是合数（bits>=32 时候选远大于筛上界），故「首个素数」与逐个 +2
  // 的旧路径完全相同，仅省去无谓的 MR —— 输出分布不变。
  const { list, blist } = smallPrimes(GEN_SIEVE_LIMIT);
  const limit = 1n << BigInt(bits);
  const WINDOW = 2048;
  let candidate = randomOddBigInt(bits);
  let attempts = 0;
  for (;;) {
    const comp = new Uint8Array(WINDOW);
    for (let i = 1; i < list.length; i++) { // 跳过 2：候选恒为奇数
      const p = list[i];
      const r = Number(candidate % blist[i]);
      const off = r === 0 ? 0 : (((p - r) * ((p + 1) >> 1)) % p);
      for (let o = off; o < WINDOW; o += p) comp[o] = 1;
    }
    let crossed = false;
    for (let i = 0; i < WINDOW; i++) {
      const cand = candidate + BigInt(2 * i);
      if (cand >= limit) { crossed = true; break; }
      if (comp[i]) {
        if (++attempts > maxAttempts) break;
        continue;
      }
      if (isProbablePrime(cand, true)) return cand;
      if (++attempts > maxAttempts) break;
    }
    if (attempts > maxAttempts) {
      throw new Error(`在 ${maxAttempts} 次尝试内未找到 ${bits} 位素数（极罕见，请重试）`);
    }
    candidate = crossed ? randomOddBigInt(bits) : candidate + BigInt(2 * WINDOW);
  }
}

// ============================================================
// op 注册
// ============================================================
register({
  id: "primeGen", cat: "radix", name: "大素数生成",
  desc: "Miller-Rabin 检验生成指定位数的大素数（crypto CSPRNG；64 位内确定性基，64 位~3.3e24 用 13 个固定基确定性判定，更大用固定基+随机基多轮）（素性检验用 primeTest，四则/分解用 bigCalc）",
  params: [
    { key: "bits", label: "位数", type: "number", default: 64, placeholder: "2..1024 位" },
    { key: "minBits", label: "最小位数（Pseudo-Random Prime Generator，留空=用位数）", type: "number", default: "" },
    { key: "maxBits", label: "最大位数（留空=用位数）", type: "number", default: "" },
    { key: "count", label: "数量", type: "number", default: 1, placeholder: "生成几个" },
  ],
  run: (_text, p) => {
    const baseBits = Math.max(2, Math.min(1024, Number(p?.bits) || 64));
    const minBits = Math.max(2, Math.min(1024, Number(p?.minBits) || baseBits));
    const maxBits = Math.max(minBits, Math.min(1024, Number(p?.maxBits) || minBits));
    const count = Math.max(1, Math.min(100, Number(p?.count) || 1));
    const primes = [];
    for (let i = 0; i < count; i++) {
      let bits = baseBits;
      if (maxBits > minBits) {
        const span = maxBits - minBits + 1;
        const r = new Uint8Array(2); r.set(randBytes(2));
        bits = minBits + ((r[0] | (r[1] << 8)) % span);
      } else {
        bits = minBits;
      }
      primes.push(generatePrime(bits).toString(10));
    }
    return primes.join("\n");
  },
});

// ============================================================
// 素性检验 op（追加：不动上方任何既有逻辑/导出）
// ============================================================

// 13 个固定质数 witness（2..41）的确定性判定上界（FIPS 186-4 Table C.2）：
// n < 3,317,044,064,679,887,385,961,981 时上方 MR_WITNESSES 足以确定性判素/合。
const MR_DETERMINISTIC_BOUND = 3317044064679887385961981n;

/**
 * 轮数化 Miller-Rabin（primeTest op 用）：
 * - n < MR_DETERMINISTIC_BOUND：直接走 isProbablePrime（64 位内 7 基；
 *   64 位到 3.3e24 用 13 个固定质数 witness，确定性判定，FIPS 186-4 Table C.2）。
 * - 更大 n：13 个固定基 + t 个 CSPRNG 随机基逐轮检验。轮数依据 FIPS 186-5
 *   Appendix B（t 轮随机基误判概率 <= 4^-t）。
 * @param {bigint} n
 * @param {number} t 轮数，1..64
 * @returns {boolean} true=可能是素数（小数为确定性）, false=合数
 */
function isProbablePrimeRounds(n, t) {
  if (n < 2n) return false;
  if (n === 2n || n === 3n) return true;
  if (n % 2n === 0n) return false;
  if (n < MR_DETERMINISTIC_BOUND) return isProbablePrime(n);
  const { d, r } = decomposeNMinus1(n);
  if (!passesBases(n, MR_WITNESSES, d, r)) return false;
  const rounds = Math.max(1, Math.min(64, t));
  for (let i = 0; i < rounds; i++) {
    if (!millerRabinRound(n, randomWitness(n), d, r)) return false;
  }
  return true;
}

register({
  id: "primeTest", cat: "radix", name: "素性检验（Miller-Rabin）",
  desc: "判定大整数是否素数并给出位长与轮数说明：n < 2^64 用 7 个确定性基；2^64 ≤ n < 3.3e24 用 13 个固定质数 witness 确定性判定（FIPS 186-4 Table C.2）；更大 n 用 13 个固定基 + 随机基多轮（FIPS 186-5 App. B，误判 ≤ 4^-rounds）",
  params: [
    { key: "n", label: "n（十进制大整数）", type: "text", default: "",
      placeholder: "如 2305843009213693951（2^61-1）" },
    { key: "rounds", label: "Miller-Rabin 轮数", type: "number", default: 24,
      placeholder: "1..64（n >= 3.3e24 时生效）" },
  ],
  run: (_text, p) => {
    const raw = String(p?.n ?? "").trim();
    if (!raw) throw new Error("参数 n 不能为空（十进制大整数）");
    const cleaned = raw.replace(/[\s,　_]/g, "");
    if (!/^[+-]?\d+$/.test(cleaned)) throw new Error(`n 不是合法十进制整数：${raw.slice(0, 64)}`);
    const n = BigInt(cleaned);
    const t = Math.max(1, Math.min(64, Math.floor(Number(p?.rounds) || 24)));
    const neg = n < 0n;
    const absN = neg ? -n : n;
    const bl = absN === 0n ? 0 : absN.toString(2).length;
    const lines = [];
    if (neg || absN < 2n) {
      lines.push(`判定：非素数（${neg ? "负数" : "n < 2"}）`);
      lines.push(`位长：${bl} 位（二进制${neg ? "，负数按 |n| 计" : ""}）`);
      lines.push("方法：定义直接判定（素数需 n >= 2，此处不涉及 Miller-Rabin）");
      return lines.join("\n");
    }
    const isP = isProbablePrimeRounds(absN, t);
    const deterministic = absN < MR_DETERMINISTIC_BOUND;
    lines.push(`判定：${isP ? "素数" : "合数"}`);
    lines.push(`位长：${bl} 位（二进制）`);
    if (deterministic) {
      lines.push(absN < TWO64
        ? "方法：Miller-Rabin 7 个确定性基（n < 2^64 的确定性基集）"
        : "方法：Miller-Rabin 13 个固定质数 witness 确定性判定（n < 3,317,044,064,679,887,385,961,981，FIPS 186-4 Table C.2）");
    } else {
      lines.push(`方法：Miller-Rabin 13 个固定基 + ${t} 个 CSPRNG 随机基（强 MR 多轮，随机基误判概率 ≤ 4^-${t}，FIPS 186-5 App. B）`);
    }
    return lines.join("\n");
  },
});

export { isProbablePrime, generatePrime, modPow, modPowCrt };
