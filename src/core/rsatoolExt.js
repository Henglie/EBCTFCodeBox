/*
 * rsatoolExt.js — RSA 攻击扩展组（cat:'analysis'）。
 *
 * 覆盖（全部 run 单向，返回多行报告文本）：
 * - rsaDpDqLeak：dp/dq 泄露求 d（完整算法实现，核心攻击）
 * - rsaLsbOracle：LSB Oracle 攻击框架（算法步骤 + 模拟演示）
 * - rsaBleichenbacher：Bleichenbacher PKCS#1 v1.5 padding oracle 识别
 * - rsaCoppersmith：Coppersmith 小根攻击提示（参数计算 + 方法说明）
 * - rsaBonehDurfee：Boneh-Durfee 攻击提示（d < N^0.292 条件检查）
 *
 * 复用 rsatool.js 的纯算法：parseBigInts, egcd, bigGcd, crt, isqrt, iroot。
 * 实现依据 RSA 攻击论文 / CTF Writeup；dp/dq 泄露用 gcd 完整实现
 * 格方法（Coppersmith/Boneh-Durfee）因纯 JS 无 LLL，给出参数计算和方法提示。
 */
import { register } from "./registry.js";
import {
  parseBigInts,
  egcd,
  bigGcd,
  crt,
  isqrt,
  iroot,
} from "./rsatool.js";

// ============ 通用工具 ============
function modPow(base, exp, mod) {
  base = ((base % mod) + mod) % mod;
  let result = 1n;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    base = (base * base) % mod;
    exp >>= 1n;
  }
  return result;
}

function modInverse(a, m) {
  const [g, x] = egcd(a, m);
  if (g !== 1n) throw new Error("模逆不存在: gcd=" + g);
  return ((x % m) + m) % m;
}

function isProbablePrime(n, rounds = 20) {
  if (n < 2n) return false;
  if (n === 2n || n === 3n) return true;
  if (n % 2n === 0n) return false;
 // Miller-Rabin
  let d = n - 1n, r = 0n;
  while (d % 2n === 0n) { d >>= 1n; r++; }
  const witnesses = [2n, 3n, 5n, 7n, 11n, 13n, 17n, 19n, 23n, 29n, 31n, 37n];
  for (let i = 0; i < Math.min(rounds, witnesses.length); i++) {
    const a = witnesses[i];
    if (a >= n) continue;
    let x = modPow(a, d, n);
    if (x === 1n || x === n - 1n) continue;
    let composite = true;
    for (let j = 0n; j < r - 1n; j++) {
      x = (x * x) % n;
      if (x === n - 1n) { composite = false; break; }
    }
    if (composite) return false;
  }
  return true;
}

// ============ 1. dp/dq 泄露求 d（完整实现） ============
/**
 * dp 泄露攻击：已知 e, n, dp = d mod (p-1) → 求 p → 求 d。
 * 原理：dp * e ≡ 1 (mod p-1) → dp*e - 1 = k*(p-1) for some k ∈ [1, e)
 * 遍历 k: p = (dp*e - 1)/k + 1，检查 p | n 且 p 是素数。
 * @param {bigint} e 公钥指数
 * @param {bigint} n 模数
 * @param {bigint} dp dp = d mod (p-1)
 * @returns {{p, q, d, k} | null}
 */
export function dpLeakFactor(e, n, dp) {
  const dpE = dp * e - 1n;
  for (let k = 1n; k < e; k++) {
    if (dpE % k !== 0n) continue;
    const pCandidate = dpE / k + 1n;
    if (pCandidate <= 1n || pCandidate >= n) continue;
    if (n % pCandidate === 0n) {
      const q = n / pCandidate;
      if (pCandidate * q === n) {
        const phi = (pCandidate - 1n) * (q - 1n);
        const d = modInverse(e, phi);
        return { p: pCandidate, q, d, k };
      }
    }
  }
  return null;
}

/**
 * dp + dq 泄露攻击：已知 e, n, dp, dq → 直接求 d（无需分解 n）。
 * 原理：d ≡ dp (mod p-1), d ≡ dq (mod q-1)，用 CRT 合并。
 * 但需要先知道 p, q。如果只有 dp 和 dq 而不知 p/q，先用 dp 泄露分解 n。
 * @param {bigint} e
 * @param {bigint} n
 * @param {bigint} dp
 * @param {bigint} dq
 * @returns {{p, q, d, dp, dq} | null}
 */
export function dpDqLeak(e, n, dp, dq) {
 // 先用 dp 泄露分解 n
  const factored = dpLeakFactor(e, n, dp);
  if (!factored) return null;
  const { p, q } = factored;
 // 验证 dq
  const d = modInverse(e, (p - 1n) * (q - 1n));
  const dqCheck = d % (q - 1n);
  return { p, q, d, dp, dq, dqValid: dqCheck === dq };
}

function runDpDqLeak(text, p) {
  const nums = parseBigInts(text);
  if (nums.length < 3) return "需要至少 3 个大整数: e, n, dp（可选 dq）";
  const [e, n, dp, dq] = nums;
  let header = `dp/dq 泄露攻击\n  e  = ${e}\n  n  = ${n}\n  dp = ${dp}`;
  if (dq !== undefined) header += `\n  dq = ${dq}`;

  const result = dq !== undefined
    ? dpDqLeak(e, n, dp, dq)
    : dpLeakFactor(e, n, dp);

  if (!result) {
    return header + "\n\n攻击失败：遍历 k=1..e-1 未找到合法因子 p。\n可能 dp 不是 d mod (p-1)，或 e 过大。";
  }

  let lines = [header, "", "=== 攻击成功 ==="];
  lines.push(`  p = ${result.p}`);
  lines.push(`  q = ${result.q}`);
  lines.push(`  d = ${result.d}`);
  if (result.k !== undefined) lines.push(`  k = ${result.k} (dp*e-1 = k*(p-1))`);
  if (result.dqValid !== undefined) {
    lines.push(`  dq 验证: ${result.dqValid ? "通过 ✓" : "不通过 ✗ (dq 可能不对应此密钥)"}`);
  }
  lines.push("");
  lines.push("原理: dp*e ≡ 1 (mod p-1) → dp*e-1 = k*(p-1), k ∈ [1,e)");
  lines.push("     遍历 k 求 p = (dp*e-1)/k + 1，检查 p | n");
  return lines.join("\n");
}

// ============ 2. LSB Oracle 攻击框架 ============
/**
 * RSA LSB Oracle 攻击模拟。
 * 已知：n, e, c = m^e mod n，以及一个 oracle：给定 c'，返回 LSB(Dec(c'))。
 * 攻击：逐位恢复 m，每次用 oracle(c * 2^e mod n) 判断。
 * 本函数模拟 oracle（已知 m 时），演示攻击过程并输出中间步骤。
 * @param {bigint} n
 * @param {bigint} e
 * @param {bigint} c
 * @param {bigint} m 明文（模拟 oracle 用，实际攻击中未知）
 * @param {number} maxBits 最多恢复位数
 * @returns {string} 多行报告
 */
export function lsbOracleAttack(n, e, c, m, maxBits = 0) {
  const nBits = BigInt(n.toString(2).length);
  const limit = maxBits > 0 ? BigInt(maxBits) : nBits;
  const twoE = modPow(2n, e, n);
  let cCur = c;
  let mRecovered = 0n;
  let lower = 0n, upper = n;
  const steps = [];
  steps.push("步骤  1: oracle(c) → LSB(m) = " + (m & 1n));
  for (let i = 0n; i < limit; i++) {
    cCur = (cCur * twoE) % n;
 // 模拟 oracle: Dec(cCur) = m * 2^(i+1) mod n
    const shifted = (m * modPow(2n, i + 1n, n)) % n;
    const bit = shifted & 1n;
    mRecovered |= (bit << i);
 // 区间二分
    const mid = (lower + upper) / 2n;
    if (bit === 0n) {
      upper = mid;
    } else {
      lower = mid;
    }
    if (i < 20n || i === limit - 1n) {
      steps.push(`步骤 ${String(i + 2n).padStart(3)}: oracle(c*2^${e * (i + 1n)} mod n) → bit=${bit} | m ≈ [${lower}, ${upper})`);
    } else if (i === 20n) {
      steps.push("  ... (省略中间步骤) ...");
    }
  }
 // 最终修正：m 在 [lower, upper) 区间内，取 lower
  const finalM = lower;
  const correct = finalM === m;
  let header = `LSB Oracle 攻击${m !== undefined ? "（模拟模式，已知明文验证）" : ""}`;
  let lines = [
    header,
    `  n = ${n}`,
    `  e = ${e}`,
    `  c = ${c}`,
    `  恢复位数: ${limit} / ${nBits}`,
    "",
    ...steps.slice(0, Math.min(steps.length, 25)),
    "",
    `恢复明文 m = ${finalM}`,
  ];
  if (m !== undefined) {
    lines.push(`实际明文 m = ${m}`);
    lines.push(`匹配: ${correct ? "✓ 成功" : "✗ 失败"}`);
  }
  lines.push("");
  lines.push("原理: oracle(Dec(c')) 返回明文最低位。c' = c * 2^e mod n → Dec(c') = 2m mod n。");
  lines.push("     若 2m < n → LSB=0, m ∈ [0, n/2)；若 2m ≥ n → LSB=1, m ∈ [n/2, n)。");
  lines.push("     每次乘 2（密文乘 2^e），二分逼近明文区间，log2(n) 次恢复全部位。");
  return lines.join("\n");
}

function runLsbOracle(text, p) {
  const nums = parseBigInts(text);
  if (nums.length < 3) return "需要至少 3 个大整数: n, e, c（可选 m 用于模拟验证）";
  const [n, e, c, m] = nums;
  const maxBits = Number((p && p.maxBits) || 0);
  if (m !== undefined) {
    return lsbOracleAttack(n, e, c, m, maxBits);
  }
 // 无 m 时给出框架说明
  let lines = [
    "LSB Oracle 攻击框架（未提供明文 m，仅给出方法说明）",
    `  n = ${n}`,
    `  e = ${e}`,
    `  c = ${c}`,
    "",
    "攻击前提：",
    "  1. 已知公钥 (n, e) 和密文 c = m^e mod n",
    "  2. 拥有 LSB Oracle：输入密文 c'，返回 Dec(c') 的最低位",
    "",
    "攻击步骤：",
    "  1. 初始化：c_0 = c, 区间 [L=0, R=n)",
    "  2. 第 i 轮（i=0,1,...,log2(n)-1）：",
    "     a. c_i = c_{i-1} * 2^e mod n",
    "     b. bit_i = Oracle(c_i)",
    "     c. mid = (L + R) / 2",
    "     d. 若 bit_i = 0: R = mid（明文在下半区）",
    "     e. 若 bit_i = 1: L = mid（明文在上半区）",
    "  3. 最终 m = L（或 L+1，取决于精度）",
    "",
    "模拟模式：在输入第 4 个数 m（实际明文）可模拟 oracle 并验证攻击正确性。",
    `示例：填入 n, e, c, m 四个数即可看到逐位恢复过程（限制 ${maxBits > 0 ? maxBits : "log2(n)"} 位）。`,
  ];
  return lines.join("\n");
}

// ============ 3. Bleichenbacher 识别 ============
function runBleichenbacher(text, p) {
  const nums = parseBigInts(text);
  if (nums.length < 2) return "需要至少 2 个大整数: n, e（可选 c 用于识别）";
  const [n, e, c] = nums;
  const nHex = n.toString(16).toUpperCase();
  const nBytes = Math.ceil(nHex.length / 2);

  let lines = [
    "Bleichenbacher PKCS#1 v1.5 Padding Oracle 攻击识别",
    `  n = ${n} (${nBytes} 字节)`,
    `  e = ${e}`,
  ];
  if (c !== undefined) lines.push(`  c = ${c}`);

  lines.push("");
  lines.push("攻击前提：");
  lines.push("  1. 目标使用 RSAES-PKCS1-v1.5 加密");
  lines.push("  2. Oracle 行为：给定密文 c'，返回 \"padding 是否正确\"（不是明文）");
  lines.push("  3. PKCS#1 v1.5 格式：0x00 02 <PS≥8字节非零> 0x00 <message>");
  lines.push("");
  lines.push("攻击概述：");
  lines.push("  - 利用 Oracle 的 \"padding 正确/不正确\" 响应，二分逼近明文区间");
  lines.push("  - 每次查询构造 c' = c * s^e mod n，寻找使 padding 正确的 s");
  lines.push("  - 通过 s 的范围缩小明文 m 的区间 [a, b]，直到区间只剩一个整数");
  lines.push("  - 需要约 2^20 次 Oracle 查询（1024-bit RSA）");
  lines.push("");
  lines.push("关键参数：");
  lines.push(`  模数字节数: ${nBytes}`);
  lines.push(`  PKCS#1 v1.5 头: 00 02 (2 字节)`);
  lines.push(`  最小 padding 长度: 8 字节（PS）+ 1 字节（00 分隔）= 11 字节`);
  lines.push(`  明文最大长度: ${nBytes - 11} 字节`);
  lines.push(`  B = 2^(8*(${nBytes}-2)) = 2^${8 * (nBytes - 2)}（padding 下界）`);
  lines.push(`  2B ≤ m ≤ 3B - 1（初始明文区间）`);
  lines.push("");
  lines.push("注意：此工具仅提供识别和参数计算，不执行实际 Oracle 查询。");
  lines.push("      实际攻击需配合可访问的 Padding Oracle（如 SSL/TLS 服务器）。");
  return lines.join("\n");
}

// ============ 4. Coppersmith 小根提示 ============
function runCoppersmith(text, p) {
  const nums = parseBigInts(text);
  if (nums.length < 2) return "需要至少 2 个大整数: n, e（可选 c 用于参数计算）";
  const [n, e, c] = nums;
  const nBits = BigInt(n.toString(2).length);
  const eVal = typeof e === "bigint" ? e : BigInt(e);

  let lines = [
    "Coppersmith 小根攻击提示",
    `  n = ${n} (${nBits} bits)`,
    `  e = ${eVal}`,
  ];
  if (c !== undefined) lines.push(`  c = ${c}`);

  lines.push("");
  lines.push("适用场景：");
  lines.push("  1. 已知明文高位：已知 m 的高位 m0，未知部分 x < N^(1/e)");
  lines.push("     → c ≡ (m0 + x)^e (mod n)，求 x（Coppersmith 定理）");
  lines.push("  2. 短明文：m 本身很小，m < N^(1/e)");
  lines.push("     → 直接开 e 次方（见 rsatool.js 的 rsaSmallE）");
  lines.push("  3. 部分 p 已知：已知 p 的高位 p0，未知部分 < N^(1/4)");
  lines.push("");
  lines.push("Coppersmith 定理界：");
  lines.push(`  单变量：可求 x < N^(1/e)（模 n 意义下的多项式小根）`);
  lines.push(`  本例: N^(1/e) ≈ 2^${Number(nBits / eVal)}（${Math.ceil(Number(nBits / eVal) / 8)} 字节）`);
  lines.push("");
  lines.push("方法：");
  lines.push("  1. 构造多项式 f(x) = (m0 + x)^e - c (mod n)");
  lines.push("  2. 用 LLL 格归约求 f(x) 的短向量");
  lines.push("  3. 从短向量恢复 x，进而求 m = m0 + x");
  lines.push("");
  lines.push("注意：纯 JS 无 LLL 实现，此工具仅提供参数计算和方法说明。");
  lines.push("      实际攻击推荐使用 SageMath：");
  lines.push('      sage: P.<x> = PolynomialRing(Zmod(n))');
  lines.push('      sage: f = (m0 + x)^e - c');
  lines.push('      sage: f.small_roots(X=bound, beta=1.0)');
  return lines.join("\n");
}

// ============ 5. Boneh-Durfee 提示 ============
function runBonehDurfee(text, p) {
  const nums = parseBigInts(text);
  if (nums.length < 2) return "需要至少 2 个大整数: n, e";
  const [n, e] = nums;
  const nBits = BigInt(n.toString(2).length);

 // d < N^0.292 条件检查
  const thresholdBits = Math.floor(Number(nBits) * 0.292);
  const threshold = 1n << BigInt(thresholdBits);

 // Wiener 条件：d < N^(1/4) ≈ N^0.25
  const wienerThreshold = Math.floor(Number(nBits) * 0.25);

  let lines = [
    "Boneh-Durfee 攻击提示",
    `  n = ${n} (${nBits} bits)`,
    `  e = ${e}`,
    "",
    "攻击条件：",
    "  Boneh-Durfee: d < N^0.292",
    `    阈值: d < 2^${thresholdBits}（约 ${Math.ceil(thresholdBits / 8)} 字节）`,
    `    若 d 小于此阈值 → 可用格方法恢复 d`,
    "",
    "  对比 Wiener 攻击（rsatool.js 已实现）：",
    `    Wiener 条件: d < N^0.25 = 2^${wienerThreshold}`,
    `    Boneh-Durfee 比 Wiener 覆盖范围更大（0.292 > 0.25）`,
    "",
    "方法概述：",
    "  1. ed ≡ 1 (mod φ(n)) → ed - 1 = kφ(n) → ed + k*(p+q-1) - kn = 1",
    "  2. 设 s = -(p+q), 则 e*d + k*(s-1) - k*n = 1（含 d, k, s 三变量）",
    "  3. 用 Coppersmith 多变量方法求小根 (d, k, s)",
    "  4. 从 s = -(p+q) 恢复 p+q，结合 n = p*q 分解 n",
    "",
    "注意：纯 JS 无 LLL/Coppersmith 多变量实现，此工具仅提供条件检查和方法说明。",
    "      实际攻击推荐使用 SageMath + defund/coppersmith 实现。",
    "      若 d < N^0.25，可直接用 rsatool.js 的 rsaWiener（连分数法）。",
  ];
  return lines.join("\n");
}

// ============ 注册 ============
register({
  id: "rsaDpDqLeak", cat: "crypto", name: "RSA dp/dq 泄露求 d",
  desc: "已知 e, n, dp(=d mod p-1) → 分解 n 求 d；可选 dq 验证",
  params: [],
  run: runDpDqLeak,
});

register({
  id: "rsaLsbOracle", cat: "crypto", name: "RSA LSB Oracle 攻击",
  desc: "LSB Oracle 逐位恢复明文（输入 n,e,c[,m]；提供 m 时模拟验证）",
  params: [
    { key: "maxBits", label: "最多恢复位数（0=自动 n 的位数）", type: "number", default: 0, placeholder: "0=自动" },
  ],
  run: runLsbOracle,
});

register({
  id: "rsaBleichenbacher", cat: "crypto", name: "RSA Bleichenbacher 识别",
  desc: "PKCS#1 v1.5 padding oracle 攻击识别 + 参数计算",
  params: [],
  run: runBleichenbacher,
});

register({
  id: "rsaCoppersmith", cat: "crypto", name: "RSA Coppersmith 小根提示",
  desc: "Coppersmith 小根攻击参数计算 + SageMath 用法提示",
  params: [],
  run: runCoppersmith,
});

register({
  id: "rsaBonehDurfee", cat: "crypto", name: "RSA Boneh-Durfee 提示",
  desc: "d < N^0.292 条件检查 + 格攻击方法说明",
  params: [],
  run: runBonehDurfee,
});

export { modPow, modInverse, isProbablePrime };
