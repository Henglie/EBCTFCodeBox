/*
 * primeInspectorCore.js — 素数判定与筛选纯函数库（零 register / 零 UI / 零外发）。
 *
 * 覆盖 8 档判定 + 条件筛选：
 *   1. 梅森素数（M_p = 2^p−1，Lucas-Lehmer 判定，非泛用 Miller-Rabin 糊弄）
 *   2. 孪生素数对（p 与 p+2 均素；筛选取 OEIS A001359 口径 = 孪生对较小成员）
 *   3. 索菲·热尔曼素数（2p+1 亦素）/ 安全素数（p = 2q+1，q 素）
 *   4. 费马素数（F_k = 2^(2^k)+1；已知仅 k = 0..4 为素，k = 5..32 已知合数）
 *   4b. `2^(2^e) − 1` 形（产品负责人口径里的「P素数」形）：恒等于**前 e 个费马数之积**
 *      F_0·F_1·…·F_{e−1} ⇒ e = 1 得 3（该形唯一素数），**e ≥ 2 恒为合数**。
 *      ⚠ 与「梅森素数 2^p−1」不是一类（本形指数是 2 的幂）。
 *   5. 强素数（档A：p−1 有大素因子；档B：p−1 与 p+1 均有大素因子；另报 Gordon 完整版第三条件）
 *   6. p−1 / p+1 B-光滑（最大素因子 ≤ B；试除 + Pollard rho 分解后判定，Pollard p−1 /
 *      Williams p+1 口径）
 *   7. 概率素数档：直接复用 bigmath.isPrimeBigInt（n < 3.3e24 用 13 个固定质数 witness
 *      确定性判定（FIPS 186-4 Table C.2），更大 n 取前 32 个小质数固定基（FIPS 186-5
 *      App. B，误判 < 4^-32）），本库不重写素性检验器。
 *
 * 复用（不重写）：
 *   - bigmath.js：isPrimeBigInt / factorBigInt / smallPrimesList / modPowBig / bitLenOf
 *   - primeGen.js：随机素数生成口径（本库的 generatePrimeBudgeted 为其可中断薄封装，
 *     素性判定共用 bigmath.isPrimeBigInt 同一套 Miller-Rabin 例程）
 *
 * 判定依据出处（逐项详见配套文档）：
 *   - Lucas-Lehmer 定理（E. Lucas 1876/1878；D. H. Lehmer 1930s）、GIMPS 已知梅森素数表、
 *     OEIS A000043（梅森指数）/ A000668（梅森素数值）
 *   - OEIS A001359（孪生对较小成员）/ A005384（索菲·热尔曼）/ A005385（安全素数）/
 *     A019434（费马素数）
 *   - J. A. Gordon, "Strong primes are easy to find", EUROCRYPT '84（强素数）；
 *     HAC（Menezes / van Oorschot / Vanstone, 1996）第 4 章 strong prime 口径
 *   - J. M. Pollard (1974)（p−1 方法）；H. C. Williams (1982)（p+1 方法）；B-光滑定义
 *   - Wikipedia "Fermat number" / PrimePages（费马数状态表，F_5..F_32 已知合数）
 *
 * 可取消/限时：筛选函数带 maxMs 时间预算 + shouldStop() 钩子 + maxResults/maxTry 上限，
 * 供显式触发白名单 / Worker 通道 / 未来分片接线（长扫描绝不阻塞主线程无上限）。
 *
 * 红线：纯函数核心；分解预算耗尽如实报「过大未分解」，绝不冒充光滑/素性结论；
 * 已知表（费马因子、梅森表）在启用前须经对拍脚本逐项真跑验证。
 */
import { isPrimeBigInt, factorBigInt, pollardBrent, smallPrimesList, modPowBig, bitLenOf } from "./bigmath.js";
import { randomBytes as randBytes } from "./randSource.js"; // 统一随机源（默认档 system 逐字节零回归）

// ============================================================
// 基础工具
// ============================================================

/** Miller-Rabin 确定性判定上界（与 bigmath.js / primeGen.js 同一口径，仅用于输出文案）。 */
const MR13_BOUND = 3317044064679887385961981n;

/**
 * 因子列表 → 「2 · 3^2 · 7」串。primes 升序可重复；unfinished 原样标注「过大未分解」。
 */
function factorStr(primes, unfinished = []) {
  const counts = new Map();
  for (const p of primes) counts.set(p, (counts.get(p) || 0n) + 1n);
  const parts = [];
  for (const [p, c] of counts) parts.push(c === 1n ? p.toString() : `${p}^${c}`);
  for (const u of unfinished) parts.push(`${u}（过大未分解）`);
  return parts.length ? parts.join(" · ") : "1";
}

/** m 的分解串（m ≥ 1；m = 1 返回 "1"）。 */
function decomposeStr(m) {
  const { primes, unfinished } = factorBigInt(m);
  return { str: factorStr(primes, unfinished), primes, unfinished };
}

/**
 * 证据分解（带位长预算）：bitLenOf(m) ≤ maxBits 时才做完整分解，否则返回 null
 * （判定结论由 isPrimeBigInt 给出，不依赖分解；分解证据只是锦上添花，
 * 对大合数跑满 rho 预算会烧掉数十秒——实测 1023 位半素数 ~20s）。
 */
function decomposeEvidence(m, maxBits = 96) {
  if (bitLenOf(m) > maxBits) return null;
  return decomposeStr(m);
}

/** 试除剥离 primes ≤ bound（bound ≤ 1e5），返回 { parts: [[p,e]…], rem }。
 *  循环完 rem 的素因子全部 > bound（不含提前退出，保证 B-光滑判定决定性）。 */
function trialStrip(m, bound) {
  const parts = [];
  let rem = m;
  for (const p of smallPrimesList()) {
    const pb = BigInt(p);
    if (pb > bound) break;
    if (rem % pb === 0n) {
      let e = 0n;
      while (rem % pb === 0n) { rem /= pb; e += 1n; }
      parts.push([pb, e]);
    }
  }
  return { parts, rem };
}

// ============================================================
// 1. 梅森素数（Lucas-Lehmer）
// ============================================================

/**
 * n 为梅森数（2^p−1 形）时返回指数 p（BigInt），否则 null。
 * 判据：n + 1 是 2 的幂 → p = log2(n+1)。
 */
export function mersenneExponentOf(n) {
  if (n < 3n) return null; // M_1 = 1、M_2 = 3 以下无意义
  const m = n + 1n;
  if (m <= 0n || (m & (m - 1n)) !== 0n) return null; // n+1 不是 2 的幂
  try {
    return BigInt(m.toString(2).length - 1); // m 为精确 2 的幂，位长−1 即指数
  } catch {
    return { tooBig: true }; // 逐位解析超出引擎能力（超大梅森数粘贴场景）
  }
}

/**
 * Lucas-Lehmer 判定：对奇素数 p，M_p = 2^p − 1 为素数 ⟺ s_{p−2} ≡ 0 (mod M_p)，
 * 其中 s_0 = 4，s_{i+1} = s_i^2 − 2（均在模 M_p 下）。p = 2 时 M_2 = 3 直接判素。
 * 调用方应先用 isPrimeBigInt 保证 p 为素数（合数指数不在定理保证范围）。
 * @param {bigint} p 素数指数
 * @returns {boolean} true = M_p 素数
 */
export function lucasLehmer(p) {
  if (p < 2n) return false;
  if (p === 2n) return true; // M_2 = 3
  const M = (1n << p) - 1n;
  let s = 4n;
  for (let i = 0n; i < p - 2n; i++) {
    s = (s * s - 2n) % M;
  }
  return s === 0n;
}

/**
 * M_p 为合数时的 best-effort 小因子搜索：
 * 定理（Lucas 1876 / 自守形式初等推论）：q 为素数且 q | M_p ⇒ q ≡ 1 (mod 2p)。
 * 只扫 q = 2·k·p + 1 ≤ √M_p 的素数 q 并验证 2^p ≡ 1 (mod q)；k ≤ maxK 封顶。
 * @returns {bigint|null} 找到的因子（不保证最小/全部分解）；预算内未找到返回 null
 */
export function mersenneSmallFactor(p, maxK = 20000) {
  const M = (1n << p) - 1n;
  const kMax = BigInt(maxK);
  for (let k = 1n; k <= kMax; k++) {
    const q = 2n * k * p + 1n;
    if (q * q > M) break; // 合数必有 ≤ √M 的素因子，扫过 √M 仍无即可停
    if (isPrimeBigInt(q) && modPowBig(2n, p, q) === 1n) return q;
  }
  return null;
}

/**
 * 梅森档判定（对任意 n 给依据）。
 * @returns {{form:boolean, ok:boolean|null, detail:string}}
 *   form = n 是否梅森数形式；ok = 是否梅森素数（非梅森形为 null）
 */
export function mersenneJudge(n) {
  const exp = mersenneExponentOf(n);
  if (exp === null) {
    return { form: false, ok: null, detail: "不是梅森数（n + 1 不是 2 的幂，即 n 非 2^p−1 形）" };
  }
  if (exp && exp.tooBig) {
    return { form: true, ok: null, detail: "数值过大（n + 1 的二进制表示超出逐位解析能力），无法本地判定梅森形与素性；请给出十进制可粘贴范围内的数，或用梅森表档按指数 p 判定" };
  }
  if (!isPrimeBigInt(exp)) {
    return {
      form: true, ok: false,
      detail: `是梅森数 M_${exp} = 2^${exp}−1，但指数 p = ${exp} 非素数 → M_p 必为合数（a | b ⇒ 2^a−1 整除 2^b−1）`,
    };
  }
  if (lucasLehmer(exp)) {
    return {
      form: true, ok: true,
      detail: `是梅森素数：M_${exp} = 2^${exp}−1，Lucas-Lehmer 判定通过（s_{p−2} ≡ 0 (mod M_p)，指数 p = ${exp} 为素数）`,
    };
  }
  let f = null;
  try { f = mersenneSmallFactor(exp); } catch { /* 分解失败不阻塞结论 */ }
  return {
    form: true, ok: false,
    detail: `是梅森数 M_${exp} = 2^${exp}−1，Lucas-Lehmer 判定不通过（s_{p−2} ≢ 0）→ 合数${f ? `（小因子 ${f}，满足 q ≡ 1 (mod 2p)）` : "（小因子预算内未找到，LL 不通过已是完整判定）"}`,
  };
}

// ============================================================
// 2. 孪生素数对
// ============================================================

/**
 * 孪生档判定：p 与 p±2 任一侧构成都算（判定报告口径）。
 * 筛选条件用严格口径（见 twinLesser）：p 与 p+2 均素 = 孪生对较小成员（A001359）。
 */
export function twinJudge(p) {
  if (!isPrimeBigInt(p)) return { ok: false, detail: "p 非素数，谈不上孪生素数对" };
  if (p === 2n) return { ok: false, detail: "p = 2：p + 2 = 4 非素数，不构成孪生素数对" };
  const up = p + 2n;
  if (isPrimeBigInt(up)) {
    return { ok: true, mate: up, detail: `是孪生素数对较小成员：p 与 p + 2 = ${up} 均为素数` };
  }
  const down = p - 2n;
  if (down >= 3n && isPrimeBigInt(down)) {
    return { ok: true, mate: down, detail: `与 p − 2 = ${down} 构成孪生素数对（p 为较大成员；OEIS A001359 只收较小成员）` };
  }
  return { ok: false, detail: "p − 2 与 p + 2 均非素数，不构成孪生素数对" };
}

/** 筛选严格口径：p 与 p + 2 均素（p 为孪生对较小成员，OEIS A001359）。 */
export function twinLesser(p) {
  return isPrimeBigInt(p) && isPrimeBigInt(p + 2n);
}

// ============================================================
// 3. 索菲·热尔曼素数 / 安全素数
// ============================================================

/**
 * 索菲·热尔曼档：p 素且 2p+1 素（OEIS A005384）。
 * 失败时给出 2p+1 的分解证据（预算内拆得动才列）。
 */
export function sophieGermainJudge(p) {
  if (!isPrimeBigInt(p)) return { ok: false, detail: "p 非素数，不满足索菲·热尔曼素数前提" };
  const q = 2n * p + 1n;
  if (isPrimeBigInt(q)) {
    return { ok: true, q, detail: `是索菲·热尔曼素数：2p + 1 = ${q} 亦为素数` };
  }
  let evidence = "";
  try {
    const d = decomposeEvidence(q);
    if (d && !d.unfinished.length) evidence = `（${q} = ${d.str}）`;
  } catch { /* 证据缺失不阻塞结论 */ }
  return { ok: false, q, detail: `2p + 1 = ${q} 非素数${evidence}，故不是索菲·热尔曼素数` };
}

/** 安全素数档：p 素且 q = (p−1)/2 素（p = 2q+1，OEIS A005385）。 */
export function safePrimeJudge(p) {
  if (!isPrimeBigInt(p) || p % 2n === 0n) return { ok: false, detail: "p 非奇素数，不满足安全素数前提" };
  const q = (p - 1n) / 2n;
  if (isPrimeBigInt(q)) {
    return { ok: true, q, detail: `是安全素数：p = 2·${q} + 1，q = ${q} 为素数` };
  }
  let evidence = "";
  try {
    const d = decomposeEvidence(q);
    if (d && !d.unfinished.length) evidence = `（${q} = ${d.str}）`;
  } catch { /* 证据缺失不阻塞结论 */ }
  return { ok: false, q, detail: `p = 2·${q} + 1，但 q = ${q} 非素数${evidence}，故不是安全素数` };
}

// ============================================================
// 4. 费马素数
// ============================================================

/** 已知全部 5 个费马素数（OEIS A019434）：F_0..F_4 = 3, 5, 17, 257, 65537。 */
export const FERMAT_KNOWN_PRIME_K = [0, 1, 2, 3, 4];

/**
 * 已知最小素因子表（k → 十进制串）。来源：Wikipedia "Fermat number" / PrimePages /
 * W. Keller 费马数状态表。候选启用前须经对拍脚本逐项验证整除（2^(2^k) ≡ −1 (mod f)），
 * 验证不过的条目一律不得用于输出结论。
 */
export const FERMAT_SMALLEST_FACTOR = {
  5: "641", // Euler 1732：F_5 = 641 × 6700417
  6: "274177",
  7: "59649589127497217",
  8: "1238926361552897",
  9: "2424833",
  10: "45592577",
  11: "319489",
  12: "114689",
  13: "2710954639361",
  14: "116928085873074369829035993834596371340386703423373313",
};

/** F_5..F_32 均已知为合数（出处：Wikipedia "Fermat number" / Keller 状态表）。 */
export const FERMAT_COMPOSITE_KNOWN_MAX = 32;

/**
 * n 为费马数（F_k = 2^(2^k)+1 形）时返回 { idx: k }，否则 null；n 过大到无法逐位解析
 * （n−1 的二进制串超引擎上限）时返回 { tooBig: true }。
 * 判据：n − 1 是 2 的幂（n = 2^m + 1）且 m 也是 2 的幂（m = 2^k）。
 */
export function fermatIndexOf(n) {
  if (n < 3n) return null;
  const m = n - 1n;
  if (m <= 0n || (m & (m - 1n)) !== 0n) return null; // n−1 不是 2 的幂
  let e;
  try {
    e = m.toString(2).length - 1; // m 为精确 2 的幂，位长−1 即指数
  } catch {
    return { tooBig: true }; // 逐位解析超出引擎能力
  }
  if ((e & (e - 1)) !== 0) return null; // e 不是 2 的幂 → 不是 F_k 形
  return { idx: 31 - Math.clz32(e) };
}

/** 验证 f 是否整除 F_k：2^(2^k) ≡ −1 (mod f) ⟺ f | (2^(2^k)+1)。只用到小 BigInt。 */
export function fermatFactorDivides(k, f) {
  if ((f & 1n) === 0n || f < 3n) return false;
  return modPowBig(2n, 1n << BigInt(k), f) === f - 1n;
}

/**
 * 按指数 k 的费马数判定（主 API：k 可以很大，全程不构造大费马数）。
 * k ≤ 4 → 素数；k = 5..14 → 用已知最小素因子本地验证整除后报合数；
 * k = 15..32 → 报「已知合数」并注明出处（本地不硬分解）；
 * k > 32 → 状态未知，如实说明（费马素数是否只有 5 个是未决问题）。
 * @returns {{ok:boolean|null, detail:string}}
 */
export function fermatJudgeByIndex(k) {
  if (!Number.isInteger(k) || k < 0) return { ok: null, detail: "k 需为非负整数指数" };
  if (k <= 4) {
    const F = (1n << BigInt(1 << k)) + 1n;
    return { ok: true, detail: `是费马素数：F_${k} = 2^(2^${k}) + 1 = ${F}（已知仅有的 5 个费马素数之一，OEIS A019434）` };
  }
  const fStr = FERMAT_SMALLEST_FACTOR[k];
  if (fStr && fermatFactorDivides(k, BigInt(fStr))) {
    return { ok: false, detail: `是费马数 F_${k} = 2^(2^${k}) + 1 → 已知合数（已知最小素因子 ${fStr}，本地验证 2^(2^${k}) ≡ −1 (mod ${fStr}) 成立）` };
  }
  if (k <= FERMAT_COMPOSITE_KNOWN_MAX) {
    return { ok: false, detail: `是费马数 F_${k} = 2^(2^${k}) + 1 → 已知合数（F_5..F_32 均已知为合数，出处 Wikipedia "Fermat number" / Keller 状态表；本数未在本地完成分解验证，不硬分解）` };
  }
  return { ok: null, detail: `是费马数 F_${k} = 2^(2^${k}) + 1（${(1 << Math.min(k, 30)) + 1} 位起）；k > 32 的费马数是否有素数属未决问题，本工具不硬下结论` };
}

/**
 * 费马档判定（对粘贴的任意 n 给依据；内部委托 fermatJudgeByIndex）。
 * @returns {{form:boolean, ok:boolean|null, detail:string}}
 */
export function fermatJudge(n) {
  const info = fermatIndexOf(n);
  if (!info) {
    return { form: false, ok: null, detail: "不是费马数（n − 1 不是 2 的幂，或幂指数不是 2 的幂，即 n 非 2^(2^k)+1 形）" };
  }
  if (info.tooBig) {
    return { form: true, ok: null, detail: "数值过大（n − 1 的二进制表示超出逐位解析能力），无法本地判定费马形与素性；请用费马状态表档按指数 k 判定" };
  }
  const j = fermatJudgeByIndex(info.idx);
  return { form: true, ok: j.ok, detail: j.detail };
}

/**
 * 判定 n 是否为 `2^(2^e) − 1` 形，返回指数 e。
 * 判据：n + 1 是 2 的幂（n = 2^m − 1）且 m 也是 2 的幂（m = 2^e）。
 * 与费马档（n = 2^(2^k) + 1）互为「同一构造的 ±1 两侧」。
 */
export function pepinFormIndexOf(n) {
  if (n < 3n) return null;
  const m = n + 1n;
  if (m <= 0n || (m & (m - 1n)) !== 0n) return null; // n + 1 不是 2 的幂
  let e;
  try {
    e = m.toString(2).length - 1; // m 为精确 2 的幂，位长−1 即指数
  } catch {
    return { tooBig: true };
  }
  if ((e & (e - 1)) !== 0) return null; // e 不是 2 的幂 → 不是该形
  return { idx: 31 - Math.clz32(e) };
}

/**
 * `2^(2^e) − 1` 形判定（产品负责人口径里的「P素数」形；对粘贴的任意 n 给依据）。
 *
 * 关键事实（必须先说清，否则会被当成素数族）：该形**恒等于前 e 个费马数之积**
 *   2^(2^e) − 1 = (2^(2^(e−1)) − 1)(2^(2^(e−1)) + 1) = F_0·F_1·…·F_{e−1}
 * 故 e = 1 得 3（该形唯一的素数），**e ≥ 2 恒为合数**（必含因子 3 = F_0）。
 * 与「梅森素数 2^p − 1」不是一类：梅森形的指数 p 是任意素数，本形的指数是 2 的幂。
 * @returns {{form:boolean, ok:boolean|null, detail:string}}
 */
export function pepinFormJudge(n) {
  const info = pepinFormIndexOf(n);
  if (!info) {
    return { form: false, ok: null, detail: "不是 2^(2^e) − 1 形（n + 1 不是 2 的幂，或幂指数不是 2 的幂）" };
  }
  if (info.tooBig) {
    return { form: true, ok: null, detail: "数值过大（n + 1 的二进制表示超出逐位解析能力），无法本地判定该形与素性" };
  }
  const e = info.idx;
  if (e === 1) {
    return { form: true, ok: true, detail: `是 2^(2^1) − 1 = 3 → 素数（该形唯一的素数；e = 1 时之积只有 F_0）` };
  }
  const fs = [];
  for (let k = 0; k < Math.min(e, 6); k++) fs.push(`F_${k}`);
  const shown = e <= 6 ? fs.join("·") : `${fs.join("·")}·…·F_${e - 1}`;
  return {
    form: true,
    ok: false,
    detail: `是 2^(2^${e}) − 1 = ${shown}（前 ${e} 个费马数之积）→ 必为合数（e ≥ 2 恒含因子 3 = F_0）；`
      + "注意这与「梅森素数 2^p − 1」不是一类：本形的指数是 2 的幂，且该形只有 e = 1 时是素数",
  };
}

// ============================================================
// 5. 强素数（RSA 口径）
// ============================================================

/**
 * 强素数判定（两档口径，输出注明用的哪档）：
 *  - 档A（单边）：p − 1 有大素因子 r1。
 *  - 档B（双边）：p − 1 有大素因子 r1 且 p + 1 有大素因子 r2。
 *  - 另报 Gordon 完整版第三条件：r1 − 1 亦有大素因子 r3（档B 成立时才计算）。
 * 「大素因子」阈值：默认 2^⌊位长(p)/2⌋（约 √p 量级），可用 opts.threshold（十进制串/number）覆盖。
 * 出处：J. A. Gordon, EUROCRYPT '84；HAC 第 4 章 strong prime；单边版见部分教材口径。
 *
 * 因子预算：判定需要 p±1 的最大素因子 = 需要分解 p±1。p±1 超过 160 位时
 * Pollard rho 预算内拆不动大剩余部分（大素数的 p±1 分解本身不可行——这正是
 * RSA 的安全性所在），此时 gradeA/gradeB = null，如实报「无法判定」，不硬下结论。
 *
 * @returns {{gradeA:boolean|null, gradeB:boolean|null, ok:boolean|null,
 *            r1:bigint|null, r2:bigint|null, r3:bigint|null,
 *            thr:bigint, minusStr:string, plusStr:string, detail:string}}
 */
export function strongPrimeJudge(p, opts = {}) {
  if (!isPrimeBigInt(p) || p < 5n) {
    return { ok: false, gradeA: false, gradeB: false, r1: null, r2: null, r3: null,
      thr: 0n, minusStr: "", plusStr: "", detail: "p 需为 ≥ 5 的奇素数才能判强素数" };
  }
  const bits = bitLenOf(p);
  const thr = opts.threshold != null ? BigInt(opts.threshold) : (1n << BigInt(Math.floor(bits / 2)));
  const EVIDENCE_BITS = 160; // p±1 超此位长 → rho 拆不动，如实报无法判定
  const minus = bitLenOf(p - 1n) <= EVIDENCE_BITS ? factorBigInt(p - 1n) : null;
  const plus = bitLenOf(p + 1n) <= EVIDENCE_BITS ? factorBigInt(p + 1n) : null;
  const r1 = (minus && !minus.unfinished.length && minus.primes.length) ? minus.primes[minus.primes.length - 1] : null;
  const r2 = (plus && !plus.unfinished.length && plus.primes.length) ? plus.primes[plus.primes.length - 1] : null;

  if (r1 === null || r2 === null) {
    const miss = [];
    if (r1 === null) miss.push(`p − 1 = ${p - 1n}（${bitLenOf(p - 1n)} 位，剩余部分因子预算内拆不动）`);
    if (r2 === null) miss.push(`p + 1 = ${p + 1n}（${bitLenOf(p + 1n)} 位，剩余部分因子预算内拆不动）`);
    return {
      ok: null, gradeA: null, gradeB: null, r1, r2, r3: null, thr,
      minusStr: minus ? factorStr(minus.primes, minus.unfinished) : "", plusStr: plus ? factorStr(plus.primes, plus.unfinished) : "",
      detail: `强素数档无法判定：${miss.join("；")}。最大素因子未知（大素数的 p±1 完整分解本身不可行，这正是 RSA 的安全性所在）；如需判定请在生成 p 时保留 r1/r2 的构造记录，或改用较小的 p`,
    };
  }
  const gradeA = r1 >= thr;
  const gradeB = gradeA && r2 >= thr;

  const minusLine = `p − 1 = ${p - 1n} = ${factorStr(minus.primes, minus.unfinished)}，最大素因子 ${r1} ${r1 >= thr ? "≥" : "<"} 阈值 ${thr}`;
  const plusLine = `p + 1 = ${p + 1n} = ${factorStr(plus.primes, plus.unfinished)}，最大素因子 ${r2} ${r2 >= thr ? "≥" : "<"} 阈值 ${thr}`;

  let r3 = null;
  let r3Line = "";
  if (gradeA) {
    const f3 = factorBigInt(r1 - 1n);
    r3 = f3.primes.length ? f3.primes[f3.primes.length - 1] : null;
    r3Line = `；Gordon 完整版第三条件：r1 − 1 = ${r1 - 1n} = ${factorStr(f3.primes, f3.unfinished)}，最大素因子 ${r3}`;
  }

  const verdict = gradeB
    ? `是强素数（档B 双边口径成立${r3Line}）`
    : gradeA
      ? `非档B 强素数，但档A（仅 p − 1 有大素因子）成立${r3Line}`
      : `非强素数（p − 1 无 ≥ 阈值的大素因子）`;
  const detail = `${verdict}。${minusLine}；${plusLine}（阈值 2^⌊位长/2⌋ ≈ √p，档A 单边 / 档B 双边两档口径，出处 Gordon EUROCRYPT '84 / HAC 第 4 章）`;
  return { ok: gradeB, gradeA, gradeB, r1, r2, r3, thr, minusStr: factorStr(minus.primes, minus.unfinished), plusStr: factorStr(plus.primes, plus.unfinished), detail };
}

// ============================================================
// 6. p−1 / p+1 B-光滑（Pollard p−1 / Williams p+1 口径）
// ============================================================

/**
 * B-光滑判定：m 的最大素因子 ≤ B ⟺ m 为 B-光滑。
 *
 * 高效判定（避免对大 m 跑满 rho 预算）：
 *  1. 试除剥离全部 primes ≤ min(B, 10^5) → parts + rem；
 *  2. rem = 1 → 光滑（最大素因子 = parts 最大者）；
 *  3. B ≤ 10^5 且 rem > 1 → 决定性非光滑（rem 的素因子全部 > B）；
 *  4. B > 10^5 且 rem > 1 → 需要拆 rem 才能定论：bitLen(rem) ≤ 128 时走完整分解，
 *     否则小预算 rho（pollardBrent）提因子——提出 > B 的因子即非光滑；
 *     预算内拆不动 → smooth = null（「无法判定」，绝不冒充结论）。
 *
 * @param {bigint} m 待分解整数（≥ 1，典型为 p−1 或 p+1）
 * @param {bigint|number} B 光滑界
 * @returns {{smooth:boolean|null, largest:bigint|null, str:string, detail:string}}
 */
export function smoothJudge(m, B) {
  const Bb = typeof B === "bigint" ? B : BigInt(Math.max(1, Math.floor(Number(B) || 0)));
  if (m < 1n) throw new Error("B-光滑判定需要 m ≥ 1");
  if (m === 1n) {
    return { smooth: true, largest: null, str: "1", detail: "m = 1（无素因子，按约定视为 B-光滑）" };
  }
  const trialBound = Bb < 100000n ? Bb : 100000n;
  const { parts, rem } = trialStrip(m, trialBound);
  const partStr = parts.map(([p, e]) => (e === 1n ? p.toString() : `${p}^${e}`)).join(" · ");
  if (rem === 1n) {
    const largest = parts.length ? parts[parts.length - 1][0] : null;
    return {
      smooth: true, largest, str: partStr,
      detail: `m = ${m} = ${partStr}，最大素因子 ${largest} ≤ B = ${Bb} → B-光滑`,
    };
  }
  const remBits = bitLenOf(rem);
  // rem 的素因子全部 > trialBound
  if (Bb <= 100000n) {
    // 决定性：非光滑。补证据：rem 小则全分解给最大素因子，否则小预算 rho 提一个因子
    let largest = null;
    let evidence = `（已知其素因子全部 > ${trialBound}）`;
    if (isPrimeBigInt(rem)) {
      largest = rem;
      evidence = `剩余 ${rem} 为素数`;
    } else if (remBits <= 96) {
      const d = factorBigInt(rem);
      if (!d.unfinished.length) { largest = d.primes[d.primes.length - 1]; evidence = `剩余部分 = ${factorStr(d.primes)}`; }
    } else if (remBits <= 192) {
      const f = pollardBrent(rem, 1 << 16);
      if (f) evidence = `已提取因子 ${f} > ${trialBound}（剩余部分未继续分解）`;
    }
    return {
      smooth: false, largest, str: `${partStr}${partStr ? " · " : ""}${rem}（未完全分解）`,
      detail: `m = ${m} = ${partStr}${partStr ? " · " : ""}${rem}，剩余部分素因子全部 > B = ${Bb} → 非B-光滑${largest ? `，最大素因子 ${largest}` : evidence}`,
    };
  }
  // B > 1e5：需要 rem 对 B 的分解结论
  if (remBits <= 128) {
    const d = factorBigInt(rem);
    if (!d.unfinished.length) {
      const all = [...parts.map(([p]) => p), ...d.primes].sort((a, b) => (a < b ? -1 : 1));
      const largest = all[all.length - 1];
      const smooth = largest <= Bb;
      const str = `${partStr}${partStr ? " · " : ""}${factorStr(d.primes)}`;
      return {
        smooth, largest, str,
        detail: `m = ${m} = ${str}，最大素因子 ${largest} ${smooth ? "≤" : ">"} B = ${Bb} → ${smooth ? "" : "非"}B-光滑`,
      };
    }
  }
  // 小预算 rho：rem ≤ 192 位时值得一试（提出 > B 的因子即非光滑）；
  // 更大位数的 rem 直接无法判定（rho 对未知大因子无望，不烧预算）
  let f = remBits <= 192 ? pollardBrent(rem, 1 << 18) : null;
  if (f) {
    // f 可能是合数：只要能确认它含 > B 的素因子即可——f > B 时其某个素因子可能 ≤ B，
    // 需要继续拆 f（f < rem，递归收窄）；f ≤ B 时 f 整体是 ≤ B 的因子，剥离后继续
    const stack = [f];
    let undetermined = false;
    const known = [];
    while (stack.length) {
      const t = stack.pop();
      if (t === 1n) continue;
      if (isPrimeBigInt(t)) { known.push(t); continue; }
      if (bitLenOf(t) > 128) { undetermined = true; break; }
      const d2 = pollardBrent(t, 1 << 18);
      if (!d2) { undetermined = true; break; }
      stack.push(d2); stack.push(t / d2);
    }
    if (!undetermined) {
      const all = [...parts.map(([p]) => p), ...known].sort((a, b) => (a < b ? -1 : 1));
      const largest = all[all.length - 1];
      const smooth = largest <= Bb;
      const str = `${partStr}${partStr ? " · " : ""}${factorStr(known)}`;
      return {
        smooth, largest, str,
        detail: `m = ${m} = ${str}，最大素因子 ${largest} ${smooth ? "≤" : ">"} B = ${Bb} → ${smooth ? "" : "非"}B-光滑`,
      };
    }
  }
  return {
    smooth: null, largest: null,
    str: `${partStr}${partStr ? " · " : ""}${rem}（未完全分解）`,
    detail: `m = ${m} = ${partStr}${partStr ? " · " : ""}${rem}；剩余部分（${remBits} 位）因子预算内拆不动（已知素因子均 > 10^5）→ B-光滑性无法判定，不硬下结论`,
  };
}

// ============================================================
// 7. 汇总判定报告（单数 judge 档）
// ============================================================

/**
 * 对单个 n 输出 7 档判定依据报告（行数组）。
 * 合数也保留梅森/费马形判定（如 2047 = M_11 能给出 LL 失败 + 小因子 23）。
 *
 * @param {bigint} n
 * @param {{smoothB?:bigint|number}} opts
 */
export function judgeAll(n, opts = {}) {
  const B = opts.smoothB != null ? opts.smoothB : 1000000;
  const lines = [];
  const a = n < 0n ? -n : n;
  lines.push(`n = ${n}`);
  if (a < 2n) {
    lines.push("素性：非素数（|n| < 2，各条件档不适用）");
    return lines;
  }
  const prime = isPrimeBigInt(a);
  lines.push(`素性：${prime ? "素数" : "合数"}（Miller-Rabin：${a < MR13_BOUND
    ? "n < 3.3e24，13 个固定质数 witness 确定性判定（FIPS 186-4 Table C.2）"
    : "n 超过确定性界，前 32 个小质数固定基轮数档（FIPS 186-5 App. B，误判 < 4^-32）"}）`);
  lines.push(`位长：${bitLenOf(a)} 位（二进制）`);
  lines.push(`[1] ${mersenneJudge(a).detail}`);
  if (!prime) {
    lines.push("[2] 孪生素数对 / [3] 索菲·热尔曼·安全 / [5] 强素数 / [6] p±1 光滑：不适用（n 非素数）");
  } else {
    lines.push(`[2] ${twinJudge(a).detail}`);
    lines.push(`[3] ${sophieGermainJudge(a).detail}`);
    lines.push(`[3b] ${safePrimeJudge(a).detail}`);
    lines.push(`[5] ${strongPrimeJudge(a).detail}`);
    lines.push(`[6a] p−1 光滑判定：${smoothJudge(a - 1n, B).detail}`);
    lines.push(`[6b] p+1 光滑判定：${smoothJudge(a + 1n, B).detail}`);
  }
  lines.push(`[4] ${fermatJudge(a).detail}`);
  lines.push(`[4b] ${pepinFormJudge(a).detail}`);
  lines.push("[7] 概率素数档说明：见上方素性行——小 n 确定性、大 n 轮数档（FIPS 186-5 App. B）；"
    + "BPSW（MR base-2 + Lucas）无已知反例，本工具未内置，口径以 primeTest 为准");
  return lines;
}

// ============================================================
// 8. 条件筛选（区间扫描 / 位数随机生成 / 特形枚举）
// ============================================================

/** 筛选条件定义（op 参数面板按此渲染 bool 勾选；key 对应 run 参数）。 */
export const COND_DEFS = [
  { key: "condMersenne", label: "梅森素数（2^p−1，特形枚举）" },
  { key: "condTwin", label: "孪生素数对（p 与 p+2 均素）" },
  { key: "condSG", label: "索菲·热尔曼素数（2p+1 亦素）" },
  { key: "condSafe", label: "安全素数（p = 2q+1，q 素）" },
  { key: "condFermat", label: "费马素数（2^(2^k)+1，特形枚举）" },
  { key: "condStrong", label: "强素数（p±1 均有大素因子）" },
  { key: "condPm1Smooth", label: "p−1 B-光滑（最大素因子 ≤ B）" },
  { key: "condPp1Smooth", label: "p+1 B-光滑（最大素因子 ≤ B）" },
];

/**
 * 单个素数 p 的条件评估：对勾选的每个条件给一行证据，全部通过才 pass。
 * 梅森/费马是特形条件（随机素数几乎不可能命中），不在本函数内评估——
 * 由特形枚举（mersenneSweep / fermatSweep）作为候选来源，再过其余条件。
 */
function condEval(p, conds, B) {
  const lines = [];
  let pass = true;
  const chk = (ok, line) => { lines.push(line); if (!ok) pass = false; };
  if (conds.condTwin) {
    const ok = isPrimeBigInt(p + 2n);
    chk(ok, ok ? `是孪生素数对较小成员：p + 2 = ${p + 2n} 亦为素数` : `p + 2 = ${p + 2n} 非素数（孪生档不满足）`);
  }
  if (conds.condSG) {
    const j = sophieGermainJudge(p);
    chk(j.ok, j.detail);
  }
  if (conds.condSafe) {
    const j = safePrimeJudge(p);
    chk(j.ok, j.detail);
  }
  if (conds.condStrong) {
    const j = strongPrimeJudge(p);
    chk(j.gradeB, j.detail);
  }
  if (conds.condPm1Smooth) {
    const j = smoothJudge(p - 1n, B);
    chk(j.smooth === true, `p − 1 光滑：${j.detail}`);
  }
  if (conds.condPp1Smooth) {
    const j = smoothJudge(p + 1n, B);
    chk(j.smooth === true, `p + 1 光滑：${j.detail}`);
  }
  return { pass, lines };
}

/** 任何条件勾了梅森/费马 → 候选来源须切换为特形枚举。 */
export function needsSpecialSource(conds) {
  return !!(conds.condMersenne || conds.condFermat);
}

/**
 * 梅森特形枚举：指数 e ∈ [1, maxExp] 中素数 e，LL 判 M_e = 2^e−1，素数者作为候选
 * 再过其余条件。maxExp 硬上限 4096（M_4096 约 1233 位十进制，LL 代价可控）。
 * 可选 range [lo, hi] 只留落在区间内的 M_e。
 */
export function mersenneSweep(opts = {}) {
  const maxExp = Math.min(4096, Math.max(2, Math.floor(Number(opts.maxExp) || 64)));
  const range = opts.range || null;
  const conds = opts.conds || {};
  const B = opts.B != null ? opts.B : 1000000;
  const maxResults = opts.maxResults || 20;
  const maxMs = opts.maxMs || 10000;
  const shouldStop = opts.shouldStop || null;
  const t0 = Date.now();
  const results = [];
  let truncated = false, stopped = false;
  for (let e = 2; e <= maxExp; e++) {
    if (shouldStop && shouldStop()) { stopped = true; break; }
    if (Date.now() - t0 > maxMs) { truncated = true; break; }
    if (!isPrimeBigInt(BigInt(e))) continue; // 指数须素数（合数指数 M_e 必合数）
    const M = (1n << BigInt(e)) - 1n;
    if (range && (M < range[0] || M > range[1])) continue;
    if (!lucasLehmer(BigInt(e))) continue;
    const { pass, lines } = condEval(M, conds, B);
    if (!pass) continue;
    results.push({
      n: M,
      lines: [`${M}（M_${e} = 2^${e}−1，Lucas-Lehmer 判定通过 → 梅森素数）`, ...lines],
    });
    if (results.length >= maxResults) { truncated = true; break; }
  }
  return { results, scanned: maxExp, truncated, stopped, elapsedMs: Date.now() - t0, source: "特形枚举：梅森数 2^p−1（p 素数指数逐个 Lucas-Lehmer）" };
}

/**
 * 费马特形枚举：k ∈ [0, maxK]（≤ 32）逐个报 F_k = 2^(2^k)+1 状态
 * （素数 / 已知合数含最小因子 / 未知），可选再过其余条件（只收素数）。
 * 全程按指数 k 判定（fermatJudgeByIndex），不构造大费马数。
 */
export function fermatSweep(opts = {}) {
  const maxK = Math.min(32, Math.max(0, Math.floor(Number(opts.maxK) || 12)));
  const conds = opts.conds || {};
  const B = opts.B != null ? opts.B : 1000000;
  const maxResults = opts.maxResults || 20;
  const t0 = Date.now();
  const results = [];
  const allLines = [];
  for (let k = 0; k <= maxK; k++) {
    const j = fermatJudgeByIndex(k);
    const shown = k <= 6 ? ((1n << BigInt(1 << k)) + 1n).toString() : `2^(2^${k})+1（${(1 << k) + 1} 位）`;
    allLines.push(`F_${k} = ${shown} → ${j.detail}`);
    if (j.ok !== true) continue; // 状态表全列；筛选口径只收素数（k ≤ 4 才可能）
    const F = (1n << BigInt(1 << k)) + 1n; // 素数者 k ≤ 4，构造无压力
    const { pass, lines } = condEval(F, conds, B);
    if (!pass) continue;
    results.push({ n: F, lines: [j.detail, ...lines] });
    if (results.length >= maxResults) break;
  }
  return { results, allLines, scanned: maxK + 1, truncated: false, stopped: false, elapsedMs: Date.now() - t0, source: "特形枚举：费马数 F_k = 2^(2^k)+1（k ≤ 32 状态表口径）" };
}

/**
 * 区间筛选：扫描 [lo, hi] 的奇数，isPrimeBigInt 判素后过勾选条件。
 * 限时（maxMs，超时即停并如实标 truncated）+ shouldStop 钩子 + maxResults 上限。
 * 梅森/费马条件勾选时自动切换特形枚举（调用方用 needsSpecialSource 判断或本函数内部处理——
 * 此处明确：本函数只做普通奇数扫描，梅森/费马条件请走 mersenneSweep/fermatSweep）。
 *
 * @param {{lo:bigint|string, hi:bigint|string, conds:object, B?:bigint|number,
 *          maxResults?:number, maxMs?:number, shouldStop?:function}} opts
 */
export function filterRange(opts = {}) {
  const lo = typeof opts.lo === "bigint" ? opts.lo : BigInt(String(opts.lo ?? "1").trim() || "1");
  const hi = typeof opts.hi === "bigint" ? opts.hi : BigInt(String(opts.hi ?? "1000").trim() || "1000");
  const conds = opts.conds || {};
  const B = opts.B != null ? opts.B : 1000000;
  const maxResults = Math.max(1, Math.min(500, Math.floor(Number(opts.maxResults) || 20)));
  const maxMs = Math.max(1, Math.min(120000, Math.floor(Number(opts.maxMs) || 10000)));
  const shouldStop = opts.shouldStop || null;
  if (lo > hi) throw new Error("区间下界 lo 不能大于上界 hi");
  if (needsSpecialSource(conds)) {
    return mersenneFermatInRange({ lo, hi, conds, B, maxResults, maxMs, shouldStop });
  }
  const t0 = Date.now();
  const results = [];
  let scanned = 0, truncated = false, stopped = false;
  let c = lo < 3n ? 2n : (lo % 2n === 0n ? lo + 1n : lo);
  const HARD_SCAN_CAP = 20000000; // 防御性扫描数硬上限
  for (; c <= hi; c += (c === 2n ? 1n : 2n)) {
    scanned++;
    if (scanned > HARD_SCAN_CAP) { truncated = true; break; }
    if (shouldStop && shouldStop()) { stopped = true; break; }
    if (Date.now() - t0 > maxMs) { truncated = true; break; }
    if (!isPrimeBigInt(c)) continue;
    const { pass, lines } = condEval(c, conds, B);
    if (!pass) continue;
    results.push({ n: c, lines });
    if (results.length >= maxResults) { truncated = true; break; }
  }
  return { results, scanned, truncated, stopped, elapsedMs: Date.now() - t0, source: `区间扫描 [${lo}, ${hi}]（奇数步进 + Miller-Rabin）` };
}

/** 梅森/费马条件下的区间特形候选：M_e / F_k 落在 [lo, hi] 内的候选 + 其余条件过滤。 */
function mersenneFermatInRange(opts) {
  const { lo, hi, conds, B, maxResults, maxMs, shouldStop } = opts;
  const t0 = Date.now();
  const results = [];
  let truncated = false, stopped = false, scanned = 0;
  const bitsHi = bitLenOf(hi);
  if (conds.condMersenne && bitsHi <= 4096) {
    for (let e = 2; e <= bitsHi; e++) {
      const M = (1n << BigInt(e)) - 1n;
      if (M > hi) break;
      if (M < lo) continue;
      scanned++;
      if (shouldStop && shouldStop()) { stopped = true; break; }
      if (Date.now() - t0 > maxMs) { truncated = true; break; }
      if (!isPrimeBigInt(BigInt(e))) continue;
      if (!lucasLehmer(BigInt(e))) continue;
      const { pass, lines } = condEval(M, conds, B);
      if (!pass) continue;
      results.push({ n: M, lines: [`${M}（M_${e} = 2^${e}−1，Lucas-Lehmer 判定通过 → 梅森素数）`, ...lines] });
      if (results.length >= maxResults) { truncated = true; break; }
    }
  }
  if (!stopped && !truncated && conds.condFermat) {
    for (let k = 0; k <= 32; k++) {
      if ((1 << k) > (1 << 24)) break; // F_k 超 1600 万位不再构造（超任何可粘贴区间）
      const F = (1n << BigInt(1 << k)) + 1n;
      if (F > hi) break;
      if (F < lo) continue;
      scanned++;
      if (shouldStop && shouldStop()) { stopped = true; break; }
      if (Date.now() - t0 > maxMs) { truncated = true; break; }
      const j = fermatJudge(F);
      if (j.ok !== true) continue;
      const { pass, lines } = condEval(F, conds, B);
      if (!pass) continue;
      results.push({ n: F, lines: [j.detail, ...lines] });
      if (results.length >= maxResults) { truncated = true; break; }
    }
  }
  return { results, scanned, truncated, stopped, elapsedMs: Date.now() - t0, source: `特形枚举（梅森/费马）∩ [${lo}, ${hi}]` };
}

/**
 * 可中断的 bits 位随机素数生成：CSPRNG 随机奇数（最高位/最低位置 1）+ isPrimeBigInt，
 * 不通过 +2 步进、越界重掷（与 primeGen 的生成口径一致）。
 * 与 primeGen.generatePrime 的唯一差别：每个候选间检查 deadline / shouldStop——
 * generatePrime 内部循环无中断钩子，直接复用会让时间预算被单次搜索击穿（实测 1024 位
 * 一次搜索可达 20s+）。素性例程仍是同一个 isPrimeBigInt，不算重写检验器。
 */
function randomOddBits(bits) {
  const bytes = Math.ceil(bits / 8);
  const buf = randBytes(bytes); // 统一随机源（默认 system 档与原 crypto.getRandomValues 等价）
  let n = 0n;
  for (const b of buf) n = (n << 8n) | BigInt(b);
  n &= (1n << BigInt(bits)) - 1n;
  n |= 1n << BigInt(bits - 1); // 保证位数
  n |= 1n; // 保证奇数
  return n;
}

/**
 * @returns {{prime?:bigint, stopped?:boolean, timeout?:boolean}}
 */
function generatePrimeBudgeted(bits, deadline, shouldStop) {
  if (bits === 2) return { prime: 3n };
  let c = randomOddBits(bits);
  const limit = bits * 200; // 与 primeGen 同级的尝试保险丝（素数密度 1/ln2^bits）
  for (let attempts = 0; attempts < limit; attempts++) {
    if (shouldStop && shouldStop()) return { stopped: true };
    if (Date.now() > deadline) return { timeout: true };
    if (isPrimeBigInt(c)) return { prime: c };
    c += 2n;
    if (c >= 1n << BigInt(bits)) c = randomOddBits(bits);
  }
  return { timeout: true };
}

/**
 * 位数筛选：随机生成 bits 位素数 + 逐个过勾选条件，收满 count 或预算
 * （maxTry / maxMs / shouldStop）为止。生成器逐候选查预算，超时如实截断。
 * 梅森/费马条件禁止随机搜索（概率≈0），报错指路特形档。
 *
 * @param {{bits:number, count?:number, conds:object, B?:bigint|number,
 *          maxTry?:number, maxMs?:number, maxResults?:number, shouldStop?:function}} opts
 */
export function filterBits(opts = {}) {
  const bits = Math.max(2, Math.min(1024, Math.floor(Number(opts.bits) || 64)));
  const count = Math.max(1, Math.min(100, Math.floor(Number(opts.count) || 5)));
  const conds = opts.conds || {};
  const B = opts.B != null ? opts.B : 1000000;
  const maxTry = Math.max(1, Math.min(200000, Math.floor(Number(opts.maxTry) || 10000)));
  const maxMs = Math.max(1, Math.min(120000, Math.floor(Number(opts.maxMs) || 10000)));
  const shouldStop = opts.shouldStop || null;
  if (needsSpecialSource(conds)) {
    throw new Error("梅森/费马素数是特形数（2^p−1 / 2^(2^k)+1），随机生成命中概率≈0；请改用判定档输入具体值，或区间筛选档（自动特形枚举）");
  }
  const t0 = Date.now();
  const deadline = t0 + maxMs;
  const results = [];
  let tries = 0, truncated = false, stopped = false;
  while (tries < maxTry && results.length < count) {
    const g = generatePrimeBudgeted(bits, deadline, shouldStop);
    if (g.stopped) { stopped = true; break; }
    if (g.timeout) { truncated = true; break; }
    tries++;
    const { pass, lines } = condEval(g.prime, conds, B);
    if (!pass) continue;
    results.push({ n: g.prime, lines });
  }
  return { results, tries, truncated, stopped, elapsedMs: Date.now() - t0, source: `随机生成 ${bits} 位素数 + 条件筛选（CSPRNG + Miller-Rabin，尝试 ${tries} 次）` };
}
