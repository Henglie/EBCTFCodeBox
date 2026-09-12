/*
 * bigmath.js — BigInt 大数计算器（T346 批E1+E2，cat:'radix'）。
 *
 * 覆盖：四则 add/sub/mul/div/mod、整数幂 pow、模幂 modpow、模逆 modinv、
 *       gcd/extgcd/lcm、素性检验 isPrime、邻素数 nextPrime/prevPrime、
 *       素因子分解 factor、整数开方 sqrtInt、二进制位长 bitLen。
 *
 * 算法出处：
 * - Miller-Rabin 素性检验：n < 3,317,044,064,679,887,385,961,981（约 3.3e24）时
 *   用前 13 个质数（2..41）做 witness 即为确定性判定（FIPS 186-4 Table C.2 /
 *   Sorenson & Webster 2015 界）；更大 n 的轮数依据 FIPS 186-5 Appendix B：
 *   t 轮随机基误判概率 <= 4^-t，本实现取前 32 个小质数为固定基（t = 32，
 *   4^-32 约 5.2e-20，CTF 场景充分）。
 * - 素因子分解 factor：小素数试除（< 1e5，Eratosthenes 筛一次生成）+
 *   Pollard rho（J. M. Pollard 1975）的 Brent 变体（R. P. Brent 1980
 *   "An improved Monte Carlo factorization algorithm"：幂次步长 + 批量 gcd），
 *   商与因子递归下钻（显式栈展开防爆栈）。rho 迭代预算内拆不动的剩余因子
 *   标注「过大未分解」，绝不冒充素数结论。
 * - extgcd：扩展欧几里得迭代版（Bézout：a*x + b*y = g = gcd(|a|,|b|)）。
 *
 * 语义注意（UI desc 与输出均需与下面一致）：
 * - div = BigInt `/`：向零截断除法（truncated division），不是向下取整。
 * - mod = BigInt `%`：截断余数，符号跟随被除数（-7 % 3 = -1，7 % -3 = 1），
 *   与数学模（结果恒非负）不同；要非负结果用 modpow 场景或 ((a%m)+m)%m。
 *
 * 红线：core 层零 UI 依赖（仅 import registry）；零外发；纯函数，可 node 直跑。
 * 契约：register({ id:"bigCalc", cat:"radix", params:[op,a,b,m], run })，
 *       输入宽松解析（剥千分位逗号/下划线/空白，容许前导 +/-），非法输入中文报错。
 */
import { register } from "./registry.js";

// ============================================================
// 输入解析（宽松：千分位逗号 / 下划线 / 各种空白一律剥掉）
// ============================================================

/** 宽松解析十进制大整数字符串 → BigInt。非法/空抛中文错误。 */
function parseBigDec(raw, label) {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) throw new Error(`参数 ${label} 不能为空（十进制大整数，支持负号与千分位逗号）`);
  const s = trimmed.replace(/[\s,　_]/g, "");
  if (!/^[+-]?\d+$/.test(s)) {
    throw new Error(`参数 ${label} 不是合法十进制整数：${trimmed.slice(0, 64)}`);
  }
  return BigInt(s);
}

// ============================================================
// 基础数论纯函数
// ============================================================

/** |a| 的二进制位长（0 → 0）。 */
function bitLenOf(a) {
  const v = a < 0n ? -a : a;
  return v === 0n ? 0 : v.toString(2).length;
}

/** 大数 gcd（非负）。gcd(0,0) = 0。 */
function gcdBig(a, b) {
  if (a < 0n) a = -a;
  if (b < 0n) b = -b;
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

/**
 * 扩展欧几里得（迭代版，防爆栈）。
 * 返回 [g, x, y] 使 a*x + b*y = g = gcd(|a|,|b|) >= 0（对负输入自动吸收符号）。
 */
function extGcdBig(a, b) {
  const sa = a < 0n ? -1n : 1n;
  const sb = b < 0n ? -1n : 1n;
  let oldR = a < 0n ? -a : a;
  let r = b < 0n ? -b : b;
  let oldS = 1n, s = 0n;
  let oldT = 0n, t = 1n;
  while (r !== 0n) {
    const q = oldR / r;
    let pr = r; r = oldR - q * r; oldR = pr;
    pr = s; s = oldS - q * s; oldS = pr;
    pr = t; t = oldT - q * t; oldT = pr;
  }
  return [oldR, oldS * sa, oldT * sb];
}

/**
 * 模幂 a^b mod m（b >= 0，m >= 1）。
 * 基归一化到 [0, m)，结果落在 [0, m)；m = 1 恒为 0。
 * 语义与 primeGen.js 导出的 modPow(base, exp, m) 一致（同输入同输出）。
 */
function modPowBig(a, b, m) {
  if (m < 1n) throw new Error("模数 m 需为 >= 1 的整数");
  if (b < 0n) throw new Error("指数 b 需为非负整数（负指数请先求模逆再 modpow）");
  if (m === 1n) return 0n;
  let base = ((a % m) + m) % m;
  let exp = b;
  let result = 1n;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % m;
    exp >>= 1n;
    base = (base * base) % m;
  }
  return result;
}

/**
 * 模逆 a^{-1} mod m（m >= 1）。无逆元抛错并给出 gcd 值。
 * 结果归一化到 [0, m)，与 modern.js 的 modInverse 同语义（同输入同输出）。
 */
function modInvBig(a, m) {
  if (m < 1n) throw new Error("模数 m 需为 >= 1 的整数");
  const [g, x] = extGcdBig(((a % m) + m) % m, m);
  if (g !== 1n) {
    throw new Error(`a 在模 m 下无乘法逆元：gcd(a, m) = ${g} != 1（需 gcd = 1 才存在逆元）`);
  }
  return ((x % m) + m) % m;
}

/** 整数平方根 floor(sqrt(n))（牛顿法），n >= 0。 */
function isqrtBig(n) {
  if (n < 0n) throw new Error("负数无整数平方根");
  if (n < 2n) return n;
  // 初值取 2^ceil(bits/2) >= sqrt(n)，保证牛顿迭代单调收敛
  let x = 1n << BigInt(Math.ceil(bitLenOf(n) / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) return x;
    x = y;
  }
}

// ============================================================
// 素性检验（确定性 MR / FIPS 186-5 轮数）
// ============================================================

// 13 个固定质数 witness 的确定性判定上界（FIPS 186-4 Table C.2）：
// n < 3,317,044,064,679,887,385,961,981 时 {2..41} 足以确定性判素/合。
const MR13_BOUND = 3317044064679887385961981n;

// 大数（超过上界）时的固定基轮数。FIPS 186-5 App. B：t 轮随机基误判 <= 4^-t；
// 此处取前 32 个小质数为固定基，t = 32（4^-32 约 5.2e-20，CTF 场景充分）。
const MR_BIG_ROUNDS = 32;

let _smallPrimes = null;
/** Eratosthenes 筛一次生成 < 1e5 的全部质数（9592 个），供试除与 MR 固定基复用。 */
function smallPrimesList() {
  if (_smallPrimes) return _smallPrimes;
  const N = 100000;
  const comp = new Uint8Array(N + 1);
  const list = [];
  for (let i = 2; i <= N; i++) {
    if (!comp[i]) {
      list.push(i);
      for (let j = i * i; j <= N; j += i) comp[j] = 1;
    }
  }
  _smallPrimes = list;
  return list;
}

/** MR 单轮（n 为奇数 > 2；d/r 为 n-1 = d * 2^r 的分解，r 为 bigint）。 */
function mrRound(n, a, d, r) {
  let x = modPowBig(a, d, n);
  if (x === 1n || x === n - 1n) return true;
  for (let i = 0n; i < r - 1n; i++) {
    x = (x * x) % n;
    if (x === n - 1n) return true;
  }
  return false;
}

/**
 * 大整数素性检验。
 * n < MR13_BOUND：前 13 个质数 witness 确定性判定（FIPS 186-4 Table C.2）；
 * n >= MR13_BOUND：前 32 个小质数固定基（轮数依据 FIPS 186-5 App. B，见文件头）。
 * @returns {boolean}
 */
function isPrimeBigInt(n) {
  if (n < 2n) return false;
  if (n === 2n || n === 3n) return true;
  if (n % 2n === 0n) return false;
  const primes = smallPrimesList();
  // 小因子快筛：试除前 168 个质数（< 1000），命中即合数（n 本身等于该质数除外）
  for (let i = 0; i < 168; i++) {
    const p = primes[i];
    const pb = BigInt(p);
    if (n % pb === 0n) return n === pb;
  }
  let d = n - 1n;
  let r = 0n;
  while (d % 2n === 0n) {
    d >>= 1n;
    r++;
  }
  const t = n < MR13_BOUND ? 13 : MR_BIG_ROUNDS;
  for (let i = 0; i < t; i++) {
    const a = BigInt(primes[i]);
    if (a >= n) continue; // witness 不能 >= n（此处仅为防御，快筛后 n > 1000）
    if (!mrRound(n, a, d, r)) return false;
  }
  return true;
}

/** 严格大于 a 的最小素数（Bertrand 公理保证存在，步数上限仅作防御性保险丝）。 */
function nextPrimeBig(a) {
  if (a < 2n) return 2n;
  let c = a + 1n;
  if (c % 2n === 0n) c += 1n;
  for (let steps = 0; steps < 5000000; steps++) {
    if (isPrimeBigInt(c)) return c;
    c += 2n;
  }
  throw new Error("nextPrime 搜索步数超限（异常，请反馈）");
}

/** 严格小于 a 的最大素数；a <= 2 时不存在，报错。 */
function prevPrimeBig(a) {
  if (a <= 2n) throw new Error("a 以下没有素数（prevPrime 需 a >= 3）");
  let c = a - 1n;
  if (c === 2n) return 2n;
  if (c % 2n === 0n) c -= 1n;
  while (c >= 3n) {
    if (isPrimeBigInt(c)) return c;
    c -= 2n;
  }
  throw new Error("a 以下没有素数（prevPrime 需 a >= 3）");
}

// ============================================================
// 素因子分解：试除 + Pollard rho（Brent 变体）+ 递归下钻（显式栈）
// ============================================================

// 随机源：优先 crypto.getRandomValues（浏览器 CSPRNG / node webcrypto）；
// 不可用时退化为 64 位 xorshift（rho 只需统计随机性，不承载安全语义）。
let _rngState = 0n;
function rngNext64() {
  if (!_rngState) _rngState = BigInt(Date.now() % 0x10000) * 6364136223846793005n + 1n;
  let x = _rngState;
  x ^= x << 13n; x &= 0xffffffffffffffffn;
  x ^= x >> 7n;
  x ^= x << 17n; x &= 0xffffffffffffffffn;
  _rngState = x;
  return x;
}
function randBelow(n) {
  // 均匀 [0, n)：按位长生成 + 拒绝采样
  const bits = n.toString(2).length;
  const words = Math.ceil(bits / 64);
  const cryptoObj = globalThis.crypto;
  for (;;) {
    let v = 0n;
    if (cryptoObj && typeof cryptoObj.getRandomValues === "function") {
      const buf = new Uint8Array(words * 8);
      cryptoObj.getRandomValues(buf);
      for (const b of buf) v = (v << 8n) | BigInt(b);
    } else {
      for (let i = 0; i < words; i++) v = (v << 64n) | rngNext64();
    }
    v >>= BigInt(words * 64 - bits);
    if (v < n) return v;
  }
}

/**
 * Pollard rho · Brent 变体：拆 n（奇合数，所有因子 >= 1e5）的一个非平凡因子。
 * 幂次步长 r 倍增 + 每 128 步批量乘 |x-y| 后一次 gcd（Brent 1980）。
 * @param {bigint} n
 * @param {number} maxIter 单次尝试迭代步数上限
 * @returns {bigint|null} 1 < g < n 的因子；预算耗尽返回 null（交上层标「过大未分解」）
 */
function pollardBrent(n, maxIter) {
  if (n % 2n === 0n) return 2n;
  for (let attempt = 0; attempt < 3; attempt++) {
    let y = randBelow(n - 1n) + 1n; // [1, n-1]
    const c = randBelow(n - 1n) + 1n;
    const m = 128n; // 批量 gcd 步长
    let g = 1n, r = 1n, q = 1n, x = y, ys = y;
    let steps = 0;
    while (g === 1n && steps < maxIter) {
      x = y;
      for (let i = 0n; i < r && steps < maxIter; i++) {
        y = (y * y + c) % n;
        steps++;
      }
      let k = 0n;
      while (k < r && g === 1n && steps < maxIter) {
        ys = y;
        const lim = m < r - k ? m : r - k;
        for (let i = 0n; i < lim && steps < maxIter; i++) {
          y = (y * y + c) % n;
          q = (q * (x > y ? x - y : y - x)) % n;
          steps++;
        }
        g = gcdBig(q, n);
        k += m;
      }
      r <<= 1n;
    }
    if (g === n) {
      // 批量步进过头（gcd 命中整个 n）：从 ys 逐点回退定位真因子
      g = 1n;
      while (g === 1n) {
        ys = (ys * ys + c) % n;
        g = gcdBig(x > ys ? x - ys : ys - x, n);
      }
    }
    if (1n < g && g < n) return g;
    // g 仍是 1 或 n：换一组 (y, c) 重试
  }
  return null;
}

/**
 * 素因子分解。返回 { primes: BigInt[]（升序，重复因子重复列）, unfinished: BigInt[]（升序）}。
 * 流程：小素数试除（< 1e5 全部幂次剥干净）→ 剩余部分递归下钻
 * （素数直接收，合数 rho 拆两半继续；rho 预算耗尽的进 unfinished）。
 */
function factorBigInt(n) {
  if (n < 0n) throw new Error("factor 仅支持 >= 1 的整数（负数无标准素因子分解）");
  if (n === 0n) throw new Error("0 无法进行素因子分解（0 可被任意素数整除）");
  if (n === 1n) return { primes: [], unfinished: [] };
  const primes = [];
  const unfinished = [];
  let m = n;
  for (const p of smallPrimesList()) {
    const pb = BigInt(p);
    if (pb * pb > m) break;
    while (m % pb === 0n) {
      primes.push(pb);
      m /= pb;
    }
  }
  if (m > 1n) {
    // 递归下钻用显式栈展开，防深递归爆栈
    const stack = [m];
    while (stack.length) {
      const t = stack.pop();
      if (t === 1n) continue;
      if (isPrimeBigInt(t)) {
        primes.push(t);
        continue;
      }
      const d = pollardBrent(t, 1 << 20);
      if (d === null) {
        unfinished.push(t);
        continue;
      }
      stack.push(d);
      stack.push(t / d);
    }
  }
  primes.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  unfinished.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  return { primes, unfinished };
}

/** factor 的竖排输出：素因子一行一个，末行汇总式；未拆动的部分标注「过大未分解」。 */
function factorReport(n) {
  if (n === 1n) return "1 = 1（无素因子，空积）";
  const { primes, unfinished } = factorBigInt(n);
  const lines = [];
  const parts = [];
  for (const p of primes) {
    lines.push(p.toString());
    parts.push(p.toString());
  }
  for (const u of unfinished) {
    const s = `${u}（过大未分解）`;
    lines.push(s);
    parts.push(s);
  }
  const isPrimeItself = primes.length === 1 && unfinished.length === 0 && primes[0] === n;
  lines.push(`${n} = ${parts.join(" × ")}${isPrimeItself ? "（素数）" : ""}`);
  return lines.join("\n");
}

// ============================================================
// op 注册
// ============================================================

const BINARY_OPS = ["add", "sub", "mul", "pow", "div", "mod", "modpow", "gcd", "extgcd", "lcm"];
const POW_BIT_LIMIT = 1000000; // 整数幂结果位长上限（100 万位二进制，防浏览器卡死）

register({
  id: "bigCalc", cat: "radix", name: "大数计算器（BigInt）",
  desc: "BigInt 大整数运算：四则/截断余/整数幂/模幂/模逆/gcd·extgcd·lcm/素性检验/邻素数/素因子分解（试除+Pollard rho Brent）/整数开方/位长。div 为截断除、mod 符号随被除数（同 BigInt 语义）",
  params: [
    { key: "op", label: "运算", type: "select", default: "add",
      options: [
        { value: "add", label: "加 a + b" },
        { value: "sub", label: "减 a - b" },
        { value: "mul", label: "乘 a × b" },
        { value: "pow", label: "幂 a^b（整数幂，结果上限 100 万位）" },
        { value: "div", label: "除 a / b（向零截断）" },
        { value: "mod", label: "余 a % b（符号随被除数）" },
        { value: "modpow", label: "模幂 a^b mod m" },
        { value: "modinv", label: "模逆 a^-1 mod m（需 gcd(a,m)=1）" },
        { value: "gcd", label: "最大公约数 gcd(a, b)" },
        { value: "extgcd", label: "扩展 gcd（输出 g, x, y：a·x+b·y=g）" },
        { value: "lcm", label: "最小公倍数 lcm(a, b)" },
        { value: "isPrime", label: "素性检验（Miller-Rabin）" },
        { value: "nextPrime", label: "下一个素数（严格大于 a）" },
        { value: "prevPrime", label: "上一个素数（严格小于 a）" },
        { value: "factor", label: "素因子分解（试除 + Pollard rho）" },
        { value: "sqrtInt", label: "整数开方 floor(√a)" },
        { value: "bitLen", label: "二进制位长 |a|" },
      ] },
    { key: "a", label: "a（十进制大整数）", type: "text", ui: "bigText", rows: 5, default: "",
      placeholder: "支持负号与千分位逗号，如 -1,234,567,890" },
    { key: "b", label: "b（十进制，单参运算留空）", type: "text", ui: "bigText", rows: 5, default: "",
      placeholder: "二元运算第二操作数；modpow 的指数" },
    { key: "m", label: "m 模数（modpow/modinv 必填）", type: "text", default: "",
      placeholder: "十进制，>= 1" },
  ],
  run: (_text, p) => {
    const op = String(p?.op || "add");
    const a = parseBigDec(p?.a, "a");
    const b = BINARY_OPS.includes(op) ? parseBigDec(p?.b, "b") : null;
    const m = op === "modpow" || op === "modinv" ? parseBigDec(p?.m, "m（模数）") : null;

    switch (op) {
      case "add": return (a + b).toString();
      case "sub": return (a - b).toString();
      case "mul": return (a * b).toString();
      case "pow": {
        // 整数幂 a^b（b >= 0；0^0 按约定取 1）。位长上限防结果撑爆页面。
        if (b < 0n) throw new Error("整数幂指数 b 需为非负整数");
        if (b > 10000000n) throw new Error("指数 b 过大（上限 10^7）");
        const bits = BigInt(bitLenOf(a));
        if (bits > 1n && bits * b > BigInt(POW_BIT_LIMIT)) {
          throw new Error(`结果过大（约 ${bits * b} 位二进制，上限 ${POW_BIT_LIMIT} 位），请减少底数或指数`);
        }
        return (a ** b).toString();
      }
      // div：BigInt `/` = 向零截断除法（非向下取整，注意 -7 / 2 = -3）
      case "div": {
        if (b === 0n) throw new Error("除数 b 不能为 0");
        return (a / b).toString();
      }
      // mod：BigInt `%` = 截断余数，符号跟随被除数（-7 % 3 = -1；7 % -3 = 1），
      // 与数学模（恒非负）区分；需非负模请用 modpow 或 ((a%m)+m)%m
      case "mod": {
        if (b === 0n) throw new Error("取余的除数 b 不能为 0");
        return (a % b).toString();
      }
      case "modpow": return modPowBig(a, b, m).toString();
      case "modinv": return modInvBig(a, m).toString();
      case "gcd": return gcdBig(a, b).toString();
      case "extgcd": {
        const [g, x, y] = extGcdBig(a, b);
        return `g = ${g}\nx = ${x}\ny = ${y}\n校验：${a} × (${x}) + ${b} × (${y}) = ${g}`;
      }
      case "lcm": {
        const g = gcdBig(a, b);
        if (g === 0n) return "0"; // lcm(0, x) = 0
        const l = (a < 0n ? -a : a) / g * (b < 0n ? -b : b);
        return l.toString();
      }
      case "isPrime": {
        const verdict = a < 2n ? "非素数（n < 2）" : isPrimeBigInt(a) ? "素数" : "合数";
        return `${verdict}（${bitLenOf(a)} 位二进制）`;
      }
      case "nextPrime": return nextPrimeBig(a).toString();
      case "prevPrime": return prevPrimeBig(a).toString();
      case "factor": return factorReport(a);
      case "sqrtInt": {
        if (a < 0n) throw new Error("负数无整数平方根");
        return isqrtBig(a).toString();
      }
      case "bitLen": return bitLenOf(a).toString();
      default:
        throw new Error(`未知运算：${op}（合法值：add/sub/mul/pow/div/mod/modpow/modinv/gcd/extgcd/lcm/isPrime/nextPrime/prevPrime/factor/sqrtInt/bitLen）`);
    }
  },
});

export { parseBigDec, bitLenOf, gcdBig, extGcdBig, modPowBig, modInvBig, isqrtBig, isPrimeBigInt, nextPrimeBig, prevPrimeBig, pollardBrent, factorBigInt, factorReport, smallPrimesList };
