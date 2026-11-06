/*
 * dcode-extras · 共享工具库
 *
 * 约定：
 * - 随机一律经主程序统一随机源 randomBytes（不直连 crypto.getRandomValues / Math.random 做安全用途）；
 * - 一切搜索/生成类函数必须有界（步数/节点/输出数量上限），超限显式报错，不静默截断冒充完整结果；
 * - 可逆映射用 makeMapOp 生成 encode/decode 双向；decode 遇到未知符号显式报错，不猜。
 */

import { randomBytes } from "../../../src/core/randSource.js";
export { randomBytes };

export const A26 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 均匀 [0, n) 随机整数（拒绝采样，n ≤ 2^31）。 */
export function randInt(n) {
  if (!Number.isInteger(n) || n <= 0) throw new Error("randInt 需要正整数上限");
  const max = 0x100000000;
  const limit = max - (max % n);
  for (let i = 0; i < 64; i++) {
    const b = randomBytes(4);
    const v = ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
    if (v < limit) return v % n;
  }
  return randomBytes(4)[0] % n; // 64 轮全部被拒的概率可忽略；兜底保证可返回
}

/** Fisher–Yates 原地洗牌（返回同一数组的拷贝）。 */
export function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const big = (s) => {
  try { return BigInt(String(s).trim()); } catch { return null; }
};
export const isIntStr = (s) => /^-?\d+$/.test(String(s).trim());

export function powmod(b, e, m) {
  b %= m; if (b < 0n) b += m;
  let r = 1n; e = e < 0n ? -e : e;
  while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; }
  return r;
}
const MR_BASES = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
export function isPrime(n) {
  if (n < 2n) return false;
  for (const p of MR_BASES) { if (n === p) return true; if (n % p === 0n) return false; }
  let d = n - 1n, s = 0n;
  while (d % 2n === 0n) { d /= 2n; s++; }
  for (const a of MR_BASES) {
    let x = powmod(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let ok = false;
    for (let i = 1n; i < s; i++) { x = (x * x) % n; if (x === n - 1n) { ok = true; break; } }
    if (!ok) return false;
  }
  return true;
}

const SMALL_PRIMES = (() => {
  const out = [];
  for (let i = 2n; i < 5000n; i++) { let p = true; for (let j = 2n; j * j <= i; j++) if (i % j === 0n) { p = false; break; } if (p) out.push(i); }
  return out;
})();

/** 有界质因数分解：试除 + 有界 Pollard rho（迭代上限，超限如实标注「未完全分解」）。 */
export function factorizeBounded(n, rhoIters = 200000) {
  const out = new Map();
  const bump = (p, k = 1) => out.set(p, (out.get(p) || 0) + k);
  let rest = n;
  for (const p of SMALL_PRIMES) while (rest % p === 0n) { bump(p); rest /= p; }
  if (rest === 1n) return { factors: out, complete: true };
  if (isPrime(rest)) { bump(rest); return { factors: out, complete: true }; }
  const gcd = (a, b) => (b ? gcd(b, a % b) : a < 0n ? -a : a);
  const rho = (m) => {
    if (m % 2n === 0n) return 2n;
    for (let c = 1n; c <= 12n; c++) {
      let x = 2n, y = 2n, d = 1n, it = 0;
      while (d === 1n && it++ < rhoIters) {
        x = (x * x + c) % m;
        y = (y * y + c) % m; y = (y * y + c) % m;
        d = gcd(x > y ? x - y : y - x, m);
      }
      if (d > 1n && d < m) return d;
    }
    return null;
  };
  const stack = [rest];
  let guard = 0, complete = true;
  while (stack.length && guard++ < 500) {
    const m = stack.pop();
    if (m === 1n) continue;
    if (isPrime(m)) { bump(m); continue; }
    const d = rho(m);
    if (d === null) { bump(m, 1); bump(0n, 0); out.set(m, out.get(m) || 1); complete = false; continue; }
    stack.push(d, m / d);
  }
  if (guard >= 500) complete = false;
  if (!complete) {
    // 把「未拆开的合数」原样保留并打标：调用方必须如实呈现
    out.set(-1n, 0n);
    out.delete(-1n);
  }
  return { factors: out, complete };
}

/**
 * 字母↔符号双向映射 op 工厂。
 * table: { "A": "⏃", ..., } 键为明文字符（大写字母/数字），值为符号串。
 * 约定：encode 大小写不敏感（统一转大写后映射，不在表内的字符原样保留）；
 * decode 采用最长匹配，遇到无法识别的符号报错并指出位置。
 * requireBijective: 校验表本身无重复值（保证可逆）。
 */
export function makeMapOp(opt) {
  const { id, cat, name, desc, table, encodeNote } = opt;
  const keys = Object.keys(table);
  const vals = new Set(keys.map((k) => table[k]));
  if (vals.size !== keys.length) throw new Error(`映射表 ${id} 存在重复符号，不可逆`);
  const sorted = keys.slice().sort((a, b) => table[b].length - table[a].length || (a < b ? -1 : 1));
  const plainSet = new Set(keys);
  return {
    id, cat, name, desc,
    params: [],
    encode(text) {
      let out = "";
      for (const ch of String(text)) {
        const up = ch.toUpperCase();
        out += plainSet.has(up) ? table[up] : ch;
      }
      return out + (encodeNote ? `\n${encodeNote}` : "");
    },
    decode(text) {
      const s = String(text);
      const out = [];
      let i = 0, consumed = new Set();
      while (i < s.length) {
        let hit = null;
        for (const k of sorted) {
          const v = table[k];
          if (v && s.startsWith(v, i)) { hit = k; break; }
        }
        if (hit === null) {
          const ch = s[i];
          if (/\s/.test(ch)) { out.push(ch); i++; continue; } // 空白透传
          throw new Error(`位置 ${i} 起的符号「${ch}」不在${name}符号表中`);
        }
        out.push(hit); consumed.add(hit);
        i += table[hit].length;
      }
      return out.join("");
    },
  };
}

/** 单向工具 op 工厂（run 型）。 */
export function runOp(id, cat, name, desc, run, params = [], meta = null) {
  const op = { id, cat, name, desc, params, run };
  if (meta && typeof meta === "object") Object.assign(op, meta);
  return op;
}

/** 解析「每行一项」或自定义分隔符的列表。 */
export function parseList(text, sep) {
  const s = String(text || "").trim();
  if (!s) return [];
  return sep ? s.split(sep).map((x) => x.trim()).filter(Boolean) : s.split(/\r?\n/).map((x) => x.trim()).filter((x) => x !== "");
}

/** 数字列表解析（支持空格/逗号/换行混排）。 */
export function parseNums(text) {
  return String(text || "").split(/[\s,;]+/).map((x) => Number(x)).filter((x) => Number.isFinite(x));
}

/** 组合数 C(n,k)（BigInt）。 */
/**
 * 物理预算（不是人为输入小上限）。
 * 达到上限时显式拒绝并说明规模；预算内不截断、不静默降级。
 */
export const BUDGET_LIMITS = Object.freeze({
  chars: 20_000_000,      // 输出字符
  items: 2_000_000,       // 列表项/组合项
  steps: 200_000_000,     // 普通数值循环
  bigSteps: 50_000_000,   // BigInt/大数循环
  nodes: 2_000_000,       // 搜索树节点
});

const BUDGET_UNITS = { chars: "字符", items: "项", steps: "次运算", bigSteps: "次大数运算", nodes: "个搜索节点" };

/** 预算检查：超限抛可读错误；amount 不是有限数也直接拒绝。 */
export function assertBudget(kind, amount, label = "本次计算") {
  const limit = BUDGET_LIMITS[kind];
  if (!Number.isFinite(limit)) throw new Error(`内部错误：未知预算类型 ${kind}`);
  const n = Number(amount);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label}规模无法估算（${amount}）`);
  if (n > limit) {
    throw new Error(
      `${label}约 ${Math.round(n).toLocaleString("en-US")} ${BUDGET_UNITS[kind]}，` +
      `超过当前 ${limit.toLocaleString("en-US")} ${BUDGET_UNITS[kind]}预算；请减小输入或分段处理。`,
    );
  }
  return n;
}

/** 让出事件循环：长循环分块后调用，避免页面冻结。 */
export function yieldToEventLoop() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "未知";
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MiB`;
  return `${(n / 1024 ** 3).toFixed(2)} GiB`;
}

export function log10Factorial(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) return NaN;
  if (x < 10) {
    let p = 1;
    for (let i = 2; i <= x; i++) p *= i;
    return Math.log10(p);
  }
  const ln = (x + 0.5) * Math.log(x) - x + 0.5 * Math.log(2 * Math.PI)
    + 1 / (12 * x) - 1 / (360 * x ** 3) + 1 / (1260 * x ** 5);
  return ln / Math.LN10;
}

export function estimateFactorialDigits(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0) throw new Error("n 必须是非负整数");
  if (x < 2) return 1;
  return Math.floor(log10Factorial(x)) + 1;
}

export function factorialBudgetBytes() {
  let budget = 512 * 1024 * 1024;
  try {
    const heap = typeof performance !== "undefined" && performance.memory && performance.memory.jsHeapSizeLimit;
    if (Number.isFinite(heap) && heap > 0) budget = heap * 0.45;
    else if (typeof navigator !== "undefined" && Number.isFinite(navigator.deviceMemory) && navigator.deviceMemory > 0) {
      budget = navigator.deviceMemory * 1024 ** 3 * 0.35;
    }
  } catch { /* 环境不提供内存信息，用保守默认值 */ }
  return Math.min(3 * 1024 ** 3, Math.max(128 * 1024 ** 2, budget));
}

export function assertFactorialBudget(n) {
  const x = Number(n);
  if (!Number.isSafeInteger(x) || x < 0) {
    throw new Error("n 超出 JS 可安全枚举的整数范围（需 ≤ 2^53-1）");
  }
  const digits = estimateFactorialDigits(x);
  const bits = Math.ceil(log10Factorial(x) / Math.log10(2));
  const textBytes = digits;
  const needBytes = Math.ceil(digits * 3.2) + 8 * 1024 ** 2;
  const budgetBytes = factorialBudgetBytes();
  if (digits > 500_000_000) {
    throw new Error(
      `${x}! 约 ${digits.toLocaleString("en-US")} 位，超过 V8 单字符串上限（约 5 亿字符），无法在一次结果中展开。\n` +
      `十进制文本约 ${formatBytes(textBytes)}；可改用「阶乘位数与规模估算」查看精确规模。`,
    );
  }
  if (needBytes > budgetBytes) {
    throw new Error(
      `${x}! 约 ${digits.toLocaleString("en-US")} 位，估算需要 ${formatBytes(needBytes)} 内存，` +
      `超过当前可用预算 ${formatBytes(budgetBytes)}，已拒绝展开（不静默截断）。\n` +
      `十进制文本约 ${formatBytes(textBytes)}；可改用「阶乘位数与规模估算」查看规模，或换内存更大的设备。`,
    );
  }
  return { digits, bits, textBytes, needBytes, budgetBytes };
}

function rangeProduct(lo, hi) {
  if (lo > hi) return 1n;
  if (lo === hi) return BigInt(lo);
  if (hi === lo + 1) return BigInt(lo) * BigInt(hi);
  const mid = Math.floor((lo + hi) / 2);
  return rangeProduct(lo, mid) * rangeProduct(mid + 1, hi);
}

export function factorialBigSync(n, block = 65536) {
  const x = Number(n);
  let acc = 1n;
  for (let start = 2; start <= x; start += block) {
    acc *= rangeProduct(start, Math.min(x, start + block - 1));
  }
  return acc;
}

export async function factorialBigAsync(n, opts = {}) {
  const x = Number(n);
  const block = Math.max(1024, Number(opts.block) || 65536);
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  let acc = 1n;
  for (let start = 2; start <= x; start += block) {
    acc *= rangeProduct(start, Math.min(x, start + block - 1));
    if (onProgress) onProgress(Math.min(1, (Math.min(x, start + block - 1) - 1) / Math.max(1, x - 1)));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return acc;
}

/** 前 k 个素数（埃氏筛）；k 很大时按当前内存预算直接拒绝，不静默截断。 */
export function firstPrimes(k) {
  const want = Number(k);
  if (!Number.isSafeInteger(want) || want < 1) throw new Error("k 需为正整数");
  const est = want < 6 ? 15 : Math.ceil(want * (Math.log(want) + Math.log(Math.log(want)))) + 10;
  if (est * 2 > factorialBudgetBytes() * 0.5) {
    throw new Error(`第 ${want.toLocaleString("en-US")} 个素数约在上限 ${est.toLocaleString("en-US")}，筛表需要约 ${formatBytes(est)} 内存，超过当前预算；请减小 k`);
  }
  const sieve = new Uint8Array(est + 1);
  const out = [];
  for (let i = 2; i <= est && out.length < want; i++) {
    if (sieve[i]) continue;
    out.push(i);
    if (i * i <= est) for (let j = i * i; j <= est; j += i) sieve[j] = 1;
  }
  if (out.length < want) throw new Error(`筛表上限 ${est} 只得到 ${out.length} 个素数，请重试或减小 k`);
  return out;
}

/** BigInt 数组的分治乘积（避免 O(n) 次巨型乘法）。 */
export function productTreeBig(values) {
  const a = values;
  if (!a.length) return 1n;
  const prod = (lo, hi) => {
    if (lo === hi) return BigInt(a[lo]);
    if (hi === lo + 1) return BigInt(a[lo]) * BigInt(a[hi]);
    const mid = Math.floor((lo + hi) / 2);
    return prod(lo, mid) * prod(mid + 1, hi);
  };
  return prod(0, a.length - 1);
}

export function binom(n, k) {
  n = BigInt(n); k = BigInt(k);
  if (k < 0n || k > n) return 0n;
  if (k > n - k) k = n - k;
  let r = 1n;
  for (let i = 0n; i < k; i++) r = (r * (n - i)) / (i + 1n);
  return r;
}

/** 全排列生成器（字典序，有界：n ≤ 9 输出全量；更大必须带 limit）。 */
export function* permutations(items, limit = 400000) {
  const a = items.slice();
  const c = new Array(a.length).fill(0);
  let count = 0;
  yield a.slice();
  let i = 0;
  while (i < a.length) {
    if (c[i] < i) {
      const j = i % 2 === 0 ? 0 : c[i];
      [a[i], a[j]] = [a[j], a[i]];
      if (++count > limit) throw new Error(`排列数量超过上限 ${limit}，请缩小输入`);
      yield a.slice();
      c[i]++; i = 0;
    } else { c[i] = 0; i++; }
  }
}

/** 最长公共子串（滚动 DP，长度上限保护）。 */
export function longestCommonSubstr(a, b) {
  a = String(a); b = String(b);
  if (a.length * b.length > 4e6) throw new Error("输入过长，最长公共子串上限 2000×2000 字符");
  let best = "", prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best.length) best = a.slice(i - cur[j], i);
      }
    }
    prev = cur;
  }
  return best;
}

/** 行级 LCS diff：返回 [{t:"=|-"|"+", line}]。 */
export function lineDiff(aLines, bLines) {
  const n = aLines.length, m = bLines.length;
  if (n * m > 4e6) throw new Error("文本行数过长，diff 上限 2000×2000 行");
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = aLines[i] === bLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) { out.push({ t: "=", line: aLines[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "-", line: aLines[i] }); i++; }
    else { out.push({ t: "+", line: bLines[j] }); j++; }
  }
  while (i < n) { out.push({ t: "-", line: aLines[i++] }); }
  while (j < m) { out.push({ t: "+", line: bLines[j++] }); }
  return out;
}
