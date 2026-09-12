/*
 * rsatoolExt.js — RSA 攻击扩展组（cat:'crypto'，run 型）。
 *
 * 覆盖（全部 run 单向，返回多行报告文本）：
 * - rsaDpDqLeak：dp/dq 泄露求 d（完整算法实现，核心攻击）
 * - rsaLsbOracle：LSB Oracle 攻击（真实现：①自带 m 的完整模拟；②粘贴 oracle 响应序列逐轮恢复 m）
 * - rsaBleichenbacher：Bleichenbacher PKCS#1 v1.5 padding oracle 攻击（真实现：serverKey 本地
 *   模拟 oracle 侧私钥 d / p,q，标准区间归约循环解出 m，带 maxS 护栏与进度节流）
 * - rsaCoppersmith：Coppersmith 小根攻击（真实现：Howgrave-Graham 构格 + BigInt LLL，
 *   落地 CTF 最常用 stereotyped message 场景——已知明文前缀/后缀 + 未知字节数恢复完整明文）
 * - rsaBonehDurfee：Boneh-Durfee 攻击提示（d < N^0.292 条件检查）
 *
 * 复用 rsatool.js 的纯算法：parseBigInts, egcd, bigGcd, crt, isqrt, iroot；
 * 复用 lllAttack.js 的 BigInt LLL（lllReduce，精确有理数 GSO）——不重造格归约。
 *
 * 算法依据：
 * - Howgrave-Graham 1997《Approximate integer common divisors》+ Coppersmith 1997
 *   《Small solutions to polynomial equations...》；格构造照 Boneh《Twenty Years of Attacks
 *   on the RSA Cryptosystem》§5 的单变量 small_roots 标准构型（n^{m-j}·f^j·x^i + f^m·x^i 平移）。
 * - LSB Oracle 照标准二分（Ritzenhofen / CTF 惯例）：c·2^{e·i} 逐轮查询，区间 [L,R) 对分。
 * - Bleichenbacher 照原论文 1998《Chosen ciphertext attacks against protocols based on the
 *   RSA encryption standard PKCS #1》Step 1/2a/2b/2c/3/4 区间归约。
 * - oracle 模拟侧恒等式：c'^d = (c·s^e)^d ≡ m·s (mod n)（gcd(s,n)=1 时），本地模拟只需
 *   一次 m=c^d mod n 预计算 + 每查询一次 BigInt 乘法，等价于逐次 modPow 解密（概率上
 *   gcd(s,n)≠1 的可能性 ~2^{-500}，最终以 m^e≡c mod n 校验兜底）。
 *
 * 【红线遵守】
 * - 纯前端零外发：纯 BigInt，浏览器/Node 均可跑，无 node 专属 API。
 * - 独立文件自注册：文件内 register，不改 main.js / i18n 主表。
 * - core 层零 UI 依赖（仅 import registry / rsatool / lllAttack）。
 *
 * 契约：register({ id, cat:"crypto", name, desc, params, run })，无 detect。
 */
import { register } from "./registry.js";
import {
  egcd,
  bigGcd,
  crt,
  isqrt,
  iroot,
} from "./rsatool.js";
import { lllReduce } from "./lllAttack.js";

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

// BigInt 带符号整除：floor(a/b)（BigInt 原生 / 向 0 截断，负数需修正）
function divFloor(a, b) {
  const q = a / b;
  if (a % b !== 0n && (a < 0n) !== (b < 0n)) return q - 1n;
  return q;
}
// ceil(a/b)，b>0，a 可负
function divCeil(a, b) {
  if (a >= 0n) return (a + b - 1n) / b;
  return -((-a) / b);
}
// BigInt → 字节数组（MSB 优先，定长 k；不足左补零）
function bigToBytes(x, k) {
  const out = new Uint8Array(k);
  for (let i = k - 1; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}
// 字节数组 → BigInt（MSB 优先）
function bigFromBytes(bytes) {
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  return x;
}
function bytesToHexStr(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
function bytesToUtf8Safe(b) {
  try { return new TextDecoder("utf-8", { fatal: false }).decode(b); }
  catch { return "(解码失败)"; }
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
  const eStr = String((p && p.e) || "").trim();
  const nStr = String((p && p.n) || "").trim();
  const dpStr = String((p && p.dp) || "").trim();
  const dqStr = String((p && p.dq) || "").trim();
  if (!eStr || !nStr || !dpStr) return "需在参数框填入 e、n、dp（十进制，dq 可选；主输入框不再使用）";
  const e = BigInt(eStr), n = BigInt(nStr), dp = BigInt(dpStr);
  const dq = dqStr ? BigInt(dqStr) : undefined;
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

// ============ 2. LSB Oracle 攻击（真实现） ============
/**
 * RSA LSB Oracle 攻击（模拟模式：已知 m 时本地模拟 oracle，逐位恢复并验证）。
 * @param {bigint} n
 * @param {bigint} e
 * @param {bigint} c
 * @param {bigint} m 明文（模拟 oracle 用）
 * @param {number} maxBits 最多恢复位数
 * @returns {string} 多行报告
 */
export function lsbOracleAttack(n, e, c, m, maxBits = 0) {
  const nBits = Number(n.toString(2).length);
  const limit = maxBits > 0 ? Math.min(maxBits, nBits) : nBits;
  const twoE = modPow(2n, e, n);
 // 口径：第 i 轮（i≥1）响应 = LSB(m·2^i mod n) = floor(m·2^i/n) 的奇偶（n 奇）→ 决定第 i 次对分。
 // 第 0 轮响应 LSB(m) 本身不携带对分信息（floor(m/n)=0 恒），仅用于收尾修正/校验。
 // 恢复用精确网格：K_i = k_i 的二进制（b_1..b_i），m ∈ [n·K/2^N, n·(K+1)/2^N)，N=nBits-1。
  let cCur = c;
  let K = 0n;
  const steps = [];
  for (let i = 1; i < limit; i++) {
    cCur = (cCur * twoE) % n;
 // 模拟 oracle: Dec(cCur) = m * 2^i mod n 的最低位
    const shifted = (m * modPow(2n, BigInt(i), n)) % n;
    const bit = shifted & 1n;
    K = K * 2n + bit;
    if (i < 20 || i === limit - 1) {
      const lo = (n * K) >> BigInt(i);
      const hiC = ((n * (K + 1n)) + ((1n << BigInt(i)) - 1n)) >> BigInt(i);
      steps.push(`步骤 ${String(i).padStart(3)}: oracle(c*(2^e)^${i} mod n) → bit=${bit} | m ∈ [${lo}, ${hiC})`);
    } else if (i === 20) {
      steps.push("  ... (省略中间步骤) ...");
    }
  }
 // 终态：N = limit-1 次对分 → 区间宽 n/2^N < 2 → 候选 {⌊n·K/2^N⌋, +1}，LSB 奇偶 + m^e ≡ c 校验定夺
  const N2 = BigInt(Math.max(1, limit - 1));
  const c0 = (n * K) >> N2;
  const cands = [c0, c0 + 1n];
  let finalM = c0;
  for (const cand of cands) {
    if (cand >= 0n && cand < n && modPow(cand, e, n) === c) { finalM = cand; break; }
  }
  const correct = finalM === m;
  let lines = [
    "LSB Oracle 攻击（模拟模式，已知明文验证）",
    `  n = ${n}`,
    `  e = ${e}`,
    `  c = ${c}`,
    `  对分轮数: ${Math.max(0, limit - 1)}（响应序列含第 0 轮共 ${limit} 位）`,
    "",
    ...steps.slice(0, Math.min(steps.length, 25)),
    "",
    `恢复明文 m = ${finalM}`,
  ];
  lines.push(`实际明文 m = ${m}`);
  lines.push(`匹配: ${correct ? "✓ 成功" : "✗ 失败"}`);
  lines.push(`校验: m^e mod n ${modPow(finalM, e, n) === c ? "≡ c ✓" : "≠ c ✗"}`);
  lines.push("");
  lines.push("原理: oracle(Dec(c')) 返回明文最低位。c' = c * 2^e mod n → Dec(c') = 2m mod n。");
  lines.push("     若 2m < n → LSB=0, m ∈ [0, n/2)；若 2m ≥ n → LSB=1, m ∈ [n/2, n)。");
  lines.push("     每次乘 2（密文乘 2^e），二分逼近明文区间，log2(n) 轮恢复全部位。");
  return lines.join("\n");
}

/**
 * LSB Oracle 攻击（真实模式：用户粘贴逐轮 oracle 响应序列）。
 * 响应序列 = 每轮一位 0/1（第 i 轮对应查询 c·(2^e)^i mod n 的解密最低位），
 * 支持每行一位或连续 0/1 串（解析时忽略空白与其他字符）。
 * @param {bigint} n
 * @param {bigint} e
 * @param {bigint} c
 * @param {string} oracleLog 响应序列文本
 * @returns {string} 多行报告
 */
export function lsbOracleFromLog(n, e, c, oracleLog) {
  const nBits = Number(n.toString(2).length);
  const matches = String(oracleLog || "").match(/[01]/g) || [];
  const bits = matches.map((ch) => BigInt(ch));
  const lines = [];
  lines.push("LSB Oracle 攻击（oracle 响应序列模式）");
  lines.push(`  n = ${n}`);
  lines.push(`  e = ${e}`);
  lines.push(`  c = ${c}`);
  lines.push(`  解析到响应位: ${bits.length} 个（需要 ${nBits} 轮）`);
  if (bits.length === 0) {
    lines.push("");
    lines.push("× 响应序列为空：请在 oracleLog 参数粘贴逐轮 oracle 响应（每轮一位 0/1，每行一轮）。");
    lines.push(`  第 i 轮查询 = c·(2^e)^i mod n，响应 = 该密文解密结果的最低位。`);
    lines.push(`  共需 ${nBits} 轮（n 的位长）。`);
    return lines.join("\n");
  }
  if (bits.length < nBits) {
    lines.push("");
    lines.push(`× 响应不足：需要 ${nBits} 轮（n 的位长），实际只有 ${bits.length} 轮，还差 ${nBits - bits.length} 轮。`);
    lines.push("  请补齐剩余轮次的 oracle 响应后再运行。");
    lines.push(`  第 ${bits.length} 轮（下一轮）查询密文 = c·(2^e)^${bits.length} mod n。`);
    return lines.join("\n");
  }
  if (bits.length > nBits) {
    lines.push(`  响应多于需要，取前 ${nBits} 位（多余 ${bits.length - nBits} 位忽略）。`);
  }
 // 口径：响应第 i 个（i 从 0）= LSB(c·(2^i)^e mod n 的解密) = LSB(m·2^i mod n)。
 // i=0 → LSB(m)，不携带对分信息（floor(m/n)=0 恒），留作收尾修正；
 // i≥1 → floor(m·2^i/n) 的奇偶 → 依次决定第 i 次对分。
 // 恢复用精确网格：K = b_1..b_N 的二进制（N = nBits-1），m ∈ [n·K/2^N, n·(K+1)/2^N)（宽 <2），
 // 终态候选 {⌊n·K/2^N⌋, +1}，用第 0 位奇偶 + m^e ≡ c mod n 校验定夺（避免逐轮取整漂移）。
  const twoE = modPow(2n, e, n);
  let cCur = c;
  let K = 0n;
  const shown = [];
  const N = nBits - 1;
  for (let i = 1; i <= N; i++) {
    cCur = (cCur * twoE) % n;
    const bit = bits[i];
    K = K * 2n + bit;
    if (i < 6 || i >= N - 2) {
      const lo = (n * K) >> BigInt(i);
      const hiC = ((n * (K + 1n)) + ((1n << BigInt(i)) - 1n)) >> BigInt(i);
      shown.push(`  轮 ${String(i).padStart(3)}: 查询 c·(2^e)^${i} mod n → 响应 ${bit} | m ∈ [${lo}, ${hiC})`);
    } else if (i === 6) {
      shown.push("  ...（中间轮次省略）...");
    }
  }
 // 终态：精确网格候选 + 第 0 位奇偶 + m^e ≡ c 校验
  const lsb0 = bits[0];
  const c0 = (n * K) >> BigInt(N);
  const cands = [c0, c0 + 1n];
  let m = null;
  for (const cand of cands) {
    if (cand >= 0n && cand < n && (cand & 1n) === lsb0 && modPow(cand, e, n) === c) { m = cand; break; }
  }
  if (m === null) {
 // 奇偶口径不一致时退化为纯 m^e 校验
    for (const cand of cands) {
      if (cand >= 0n && cand < n && modPow(cand, e, n) === c) { m = cand; break; }
    }
  }
  lines.push("");
  lines.push("● 二分过程（首尾采样）");
  lines.push(...shown);
  lines.push("");
  if (m !== null) {
    const k = Math.ceil(Number(n.toString(2).length) / 8);
    const mb = bigToBytes(m, k);
    lines.push("=== 攻击成功 ===");
    lines.push(`恢复明文 m = ${m}`);
    lines.push(`hex = 0x${bytesToHexStr(mb)}`);
    lines.push(`UTF-8 尝试: ${bytesToUtf8Safe(mb)}`);
    lines.push(`校验: m^e mod n ≡ c ✓`);
  } else {
    lines.push("× 二分完成但候选均未通过校验。");
    lines.push(`  终态精确网格下界 ${c0}（候选 c0 / c0+1）`);
    lines.push("  请确认响应序列口径：第 i 个响应 = LSB(c·(2^i)^e mod n 的解密)，i 从 0 计（第 0 个 = c 本身的 LSB(m)）。");
  }
  lines.push("");
  lines.push("原理: 第 i 轮（i≥1）查询 c·(2^e)^i mod n，Dec = 2^i·m mod n，其最低位 = floor(2^i·m/n) 的奇偶，");
  lines.push("     给出 m 落在当前区间的上/下半区；第 0 轮响应 LSB(m) 用于终态奇偶修正。");
  return lines.join("\n");
}

function runLsbOracle(text, p) {
  const nStr = String((p && p.n) || "").trim();
  const eStr = String((p && p.e) || "").trim();
  const cStr = String((p && p.c) || "").trim();
  const mStr = String((p && p.m) || "").trim();
  const logStr = String((p && p.oracleLog) || "");
  if (!nStr || !eStr || !cStr) return "需在参数框填入 n、e、c（十进制）；oracle 响应序列或 m 二选一";
  const n = BigInt(nStr), e = BigInt(eStr), c = BigInt(cStr);
  const maxBits = Number((p && p.maxBits) || 0);
  if (logStr && logStr.trim()) {
    return lsbOracleFromLog(n, e, c, logStr);
  }
  if (mStr) {
    const m = BigInt(mStr);
    return lsbOracleAttack(n, e, c, m, maxBits);
  }
 // 两者都没给：方法说明
  const nBits = Number(n.toString(2).length);
  let lines = [
    "LSB Oracle 攻击",
    `  n = ${n}`,
    `  e = ${e}`,
    `  c = ${c}`,
    "",
    "两种用法（参数框二选一）：",
    `  1. oracleLog：粘贴逐轮 oracle 响应序列（每轮一位 0/1，每行一轮；连续 0/1 串亦可），`,
    `     共需 ${nBits} 位（n 的位长）。第 i 个响应 = LSB(c·(2^e)^i mod n 的解密)，i 从 0 计：`,
    "     第 0 个 = LSB(m)（终态修正用），第 i≥1 个决定第 i 次区间对分。",
    "  2. m：填入实际明文进入本地模拟模式（自带 oracle 验证攻击正确性）。",
    "",
    "原理：c' = c·2^e mod n → Dec(c') = 2m mod n；LSB(2m mod n) = floor(2m/n) 的奇偶 →",
    "     LSB=0 → m ∈ 下半区，LSB=1 → m ∈ 上半区。逐轮密文乘 2^e、区间对分，log2(n) 轮收敛。",
  ];
  return lines.join("\n");
}

// ============ 3. Bleichenbacher 攻击（真实现：双角色本地模拟） ============
/**
 * PKCS#1 v1.5 padding 合法性判定（EM = 00 02 PS(≥8 非零) 00 M）。
 * @param {bigint} mm 待判定的「明文」（解密结果）
 * @param {number} k 模数字节长
 * @returns {boolean}
 */
function isPkcsV15(mm, k) {
  if (mm <= 0n) return false;
  const bytes = bigToBytes(mm, k);
  if (bytes[0] !== 0x00 || bytes[1] !== 0x02) return false;
  let j = 2;
  while (j < k && bytes[j] !== 0x00) {
    if (bytes[j] === 0x00) break; // PS 中不允许 00（循环条件已保证，此处双保险）
    j++;
  }
  if (j >= k) return false;      // 没找到 00 分隔符
  return j - 2 >= 8;             // PS ≥ 8 字节且全非零
}

/**
 * 解析 serverKey（hex）：单个大数 = 私钥 d；含分隔符（, ; : 空白 / -）= p,q。
 * @returns {{d: bigint}}
 */
function parseServerKey(hexStr, n, e) {
  let s = String(hexStr || "").trim().replace(/^0x/i, "");
  if (!s) throw new Error("serverKey 为空");
  let parts;
  if (/[,;:\s-]/.test(s)) {
    parts = s.split(/[,;:\s-]+/).filter(Boolean);
    if (parts.length !== 2) throw new Error("serverKey p,q 格式：两个 hex 数用逗号/分号/冒号分隔");
    const p = BigInt("0x" + parts[0]);
    const q = BigInt("0x" + parts[1]);
    if (p * q !== n) throw new Error("p·q ≠ n：serverKey 与模数不匹配");
    const phi = (p - 1n) * (q - 1n);
    const d = modInverse(e, phi);
    return { d };
  }
  s = s.replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]+$/.test(s)) throw new Error("serverKey 含非法 hex 字符");
  return { d: BigInt("0x" + s) };
}

/**
 * 区间合并：按左端点排序后合并重叠/相邻区间。
 */
function mergeIntervals(list) {
  if (!list.length) return [];
  const sorted = list.slice().sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const out = [sorted[0].slice()];
  for (let i = 1; i < sorted.length; i++) {
    const [a, b] = sorted[i];
    const last = out[out.length - 1];
    if (a <= last[1] + 1n) { if (b > last[1]) last[1] = b; }
    else out.push([a, b]);
  }
  return out;
}

/**
 * Bleichenbacher 攻击主循环（标准 Step 1 / 2a / 2b / 2c / 3 / 4）。
 * oracle：本地模拟——m0 = c^d mod n 预计算一次，查询 s 的解密 = m0·s mod n
 * （恒等式 (c·s^e)^d ≡ m0·s mod n，gcd(s,n)=1 时精确成立）。
 * @returns {string} 多行报告
 */
export function bleichenbacherAttack(n, e, c, d, maxS) {
  const k = Math.ceil(Number(n.toString(2).length) / 8);
  const B = 1n << BigInt(8 * (k - 2));
  const lines = [];
  lines.push("Bleichenbacher PKCS#1 v1.5 Padding Oracle 攻击（双角色本地模拟）");
  lines.push(`  n = ${n} (${k} 字节)`);
  lines.push(`  e = ${e}`);
  lines.push(`  c = ${c}`);
  lines.push(`  B = 2^(8·(${k}-2)) = 2^${8 * (k - 2)}`);
  lines.push(`  maxS 护栏 = ${maxS} 次 oracle 查询`);

 // oracle 侧：本地模拟私钥解密
  const m0 = modPow(c, d, n);
  const m0Ok = isPkcsV15(m0, k);
  lines.push(`  oracle 侧解密 c^d mod n ${m0Ok ? "是合法 PKCS#1 v1.5 padding ✓（攻击前提成立）" : "不是合法 PKCS#1 v1.5 padding ✗（m 不在 [2B,3B)，攻击无法收敛）"}`);
  if (!m0Ok) {
    lines.push("");
    lines.push("说明：Bleichenbacher 攻击要求原始明文本身 padding 合法（m ∈ [2B, 3B-1]）。");
    lines.push("      请用 0x0002||随机非零 PS(≥8)||0x00||message 构造合法密文再试。");
    return lines.join("\n");
  }
 // 模拟 oracle：查询 s → Dec(c·s^e) = m0·s mod n（精确恒等式，见文件头注释）
  const oracle = (s) => isPkcsV15((m0 * s) % n, k);

  let intervals = [[2n * B, 3n * B - 1n]];
  let s = 0n;
  let queries = 0;
  let round = 0;
  const sTrace = [];
  const progress = [];
  const PROGRESS_EVERY = 5000; // 查询节流：每 5000 次记录一条进度快照
  let lastQ = 0;
  let mFound = null;
  let aborted = false;

  while (true) {
    round++;
 // ---- Step 2：寻找下一个 s ----
    let sNew = null;
    if (round === 1 || intervals.length >= 2) {
 // Step 1 / 2b：从 ceil(n/3B)（首轮）或 s+1（多区间）线性扫描
      let cand = round === 1 ? n / (3n * B) + 1n : s + 1n;
      while (true) {
        if (oracle(cand)) { sNew = cand; break; }
        queries++;
        if (queries > maxS) { aborted = true; break; }
        cand += 1n;
      }
    } else {
 // Step 2c：单区间 [a,b]（a<b），按论文公式逐 r 扫描
      const [a, b] = intervals[0];
      let r = divCeil(2n * (b * s - 2n * B), n);
      outer:
      while (!aborted) {
        const lo = divCeil(2n * B + r * n, b);
        const hi = divFloor(3n * B - 1n + r * n, a);
        let cand = lo > s + 1n ? lo : s + 1n;
        for (; cand <= hi; cand++) {
          if (oracle(cand)) { sNew = cand; break outer; }
          queries++;
          if (queries > maxS) { aborted = true; break outer; }
        }
        r++;
        if (r > 4n * B + 16n) break; // 病态防护（理论上到不了）
      }
    }
    if (aborted || sNew === null) break;
    s = sNew;
    if (sTrace.length < 8 || sTrace.length % 50 === 0) sTrace.push(s);

 // ---- Step 3：区间收缩 / 合并 ----
    const newIntervals = [];
    for (const [a, b] of intervals) {
      const rMin = divCeil(a * s - 3n * B + 1n, n);
      const rMax = divFloor(b * s - 2n * B, n);
      for (let r = rMin; r <= rMax; r++) {
        const lo = divCeil(2n * B + r * n, s);
        const hi = divFloor(3n * B - 1n + r * n, s);
        const na = a > lo ? a : lo;
        const nb = b < hi ? b : hi;
        if (na <= nb) newIntervals.push([na, nb]);
      }
    }
    intervals = mergeIntervals(newIntervals);
    if (!intervals.length) break; // 数学上不应发生（命中 s 的 r 必落在 rMin..rMax），保险
    let width = 0n;
    for (const [a, b] of intervals) width += b - a + 1n;

 // ---- Step 4：单点区间 → 解出 m ----
    if (intervals.length === 1 && intervals[0][0] === intervals[0][1]) {
      mFound = intervals[0][0];
      break;
    }
    if (queries - lastQ >= PROGRESS_EVERY) {
      progress.push({ round, q: queries, s, nInterval: intervals.length, width });
      lastQ = queries;
    }
  }

  lines.push("");
  lines.push("● s 轨迹（前 8 个 + 每 50 轮采样）");
  lines.push(`  ${sTrace.length ? sTrace.join(", ") : "(无)"}`);
  if (progress.length) {
    lines.push("");
    lines.push("● 进度快照（每 5000 次查询节流）");
    for (const pg of progress.slice(0, 6)) {
      lines.push(`  轮 ${pg.round} · 查询 ${pg.q} · s=${pg.s} · 区间数 ${pg.nInterval} · 区间总宽 ${pg.width}`);
    }
    if (progress.length > 6) lines.push(`  ...（共 ${progress.length} 条快照，略）`);
  }
  lines.push("");
  if (mFound !== null) {
 // 最终校验：m^e ≡ c mod n
    const ok = modPow(mFound, e, n) === c;
    const mb = bigToBytes(mFound, k);
    lines.push(ok ? "=== 攻击成功 ===" : "=== 结束（校验未通过）===");
    lines.push(`轮数: ${round}`);
    lines.push(`oracle 查询总数: ${queries + 1}`);
    lines.push(`最终区间: [${intervals[0][0]}, ${intervals[0][1]}]`);
    lines.push(`恢复明文 m = ${mFound}`);
    lines.push(`hex = 0x${bytesToHexStr(mb)}`);
    lines.push(`UTF-8 尝试: ${bytesToUtf8Safe(mb)}`);
    lines.push(`校验: m^e mod n ${ok ? "≡ c ✓" : "≠ c ✗"}`);
  } else if (aborted) {
    lines.push(`× 达到 maxS 护栏（${maxS} 次查询），攻击中止。`);
    lines.push(`轮数: ${round} · 已用查询: ${queries} · 当前 s = ${s}`);
    lines.push(`当前区间（${intervals.length} 个）:`);
    for (const [a, b] of intervals.slice(0, 5)) lines.push(`  [${a}, ${b}] 宽 ${b - a + 1n}`);
    lines.push("建议：增大 maxS（1024-bit 通常需 ~2^20 次查询），或确认 oracle 侧私钥正确。");
  } else {
    lines.push(`× 循环异常终止（轮数 ${round}，查询 ${queries}）。`);
  }
  lines.push("");
  lines.push("原理：oracle 只回答 padding 合法与否。构造 c' = c·s^e mod n 使 Dec(c') = m·s mod n 落在");
  lines.push("     [2B,3B) → 以 s 反解 m 的可行区间；Step 3 收缩合并区间，直到区间收缩为单点即 m。");
  return lines.join("\n");
}

function runBleichenbacher(text, p) {
  const nStr = String((p && p.n) || "").trim();
  const eStr = String((p && p.e) || "").trim();
  const cStr = String((p && p.c) || "").trim();
  const keyStr = String((p && p.serverKey) || "").trim();
  const maxS = Math.max(1000, Number((p && p.maxS) || 1000000));
  if (!nStr || !eStr || !cStr) return "需在参数框填入 n、e、c（十进制）+ serverKey（hex：私钥 d，或 p,q 用逗号分隔）";
  const n = BigInt(nStr), e = BigInt(eStr), c = BigInt(cStr);
  if (!keyStr) {
    const nBytes = Math.ceil(Number(n.toString(2).length) / 8);
    let lines = [
      "Bleichenbacher PKCS#1 v1.5 Padding Oracle 攻击",
      `  n = ${n} (${nBytes} 字节)`,
      `  e = ${e}`,
      `  c = ${c}`,
      "",
      "本次未提供 serverKey，仅输出参数与攻击前提：",
      "  PKCS#1 v1.5 格式：0x00 02 <PS≥8字节非零> 0x00 <message>",
      `  B = 2^(8·(${nBytes}-2)) = 2^${8 * (nBytes - 2)}（padding 下界），初始明文区间 [2B, 3B-1]`,
      `  明文最大长度: ${nBytes - 11} 字节`,
      "",
      "完整攻击需在 serverKey 填入 oracle 侧私钥（hex）：",
      "  · 私钥 d（单个 hex 大数），或",
      "  · p,q（两个 hex 数，逗号分隔）——自动算 d",
      "",
      "填入后本工具即运行标准 Bleichenbacher 区间归约循环（Step 1/2a/2b/2c/3/4）解出 m：",
      "  s1 从 ceil(n/3B) 起线性扫描找 PKCS 合规 s；随后按论文公式收缩/合并区间；",
      "  区间收缩为单点即明文。maxS 护栏默认 100 万次查询防卡死，每 5000 次查询输出进度快照。",
    ];
    return lines.join("\n");
  }
  let d;
  try {
    ({ d } = parseServerKey(keyStr, n, e));
  } catch (err) {
    return "serverKey 解析失败：" + (err && err.message ? err.message : String(err));
  }
  return bleichenbacherAttack(n, e, c, d, BigInt(maxS));
}

// ============ 4. Coppersmith 小根攻击（真实现：Howgrave-Graham + LLL） ============
// ---- 多项式工具：coeffs[i] = x^i 系数（BigInt），低次在前 ----
function polyTrim(a) {
  const r = a.slice();
  while (r.length && r[r.length - 1] === 0n) r.pop();
  return r;
}
function polyScale(a, c) { return a.map((x) => x * c); }
function polyAdd(a, b) {
  const r = new Array(Math.max(a.length, b.length)).fill(0n);
  for (let i = 0; i < a.length; i++) r[i] += a[i];
  for (let i = 0; i < b.length; i++) r[i] += b[i];
  return polyTrim(r);
}
function polyMul(a, b) {
  if (!a.length || !b.length) return [];
  const r = new Array(a.length + b.length - 1).fill(0n);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0n) continue;
    for (let j = 0; j < b.length; j++) r[i + j] += a[i] * b[j];
  }
  return polyTrim(r);
}
function polyDeriv(a) {
  const r = [];
  for (let i = 1; i < a.length; i++) r.push(a[i] * BigInt(i));
  return polyTrim(r);
}
function polyEval(a, x) {
  let s = 0n;
  for (let i = a.length - 1; i >= 0; i--) s = s * x + a[i];
  return s;
}

/** 伪余数（保号）：返回 lc(b)^iters · rem(a,b)，并把符号修正为「正倍数真余数」。 */
function polyPrem(a, b) {
  let r = polyTrim(a);
  const db = b.length - 1;
  if (db < 0) throw new Error("伪除法：除式为 0");
  const lb = b[db];
  let iters = 0;
  while (r.length - 1 >= db && r.length > 0) {
 // r ← lb·r − lc(r)·x^(deg r − db)·b（每次消去首项，次数严格下降）
    const lead = r[r.length - 1];
    r = polyScale(r, lb);
    const shift = r.length - 1 - db;
    const sub = polyScale(b, lead);
    for (let i = 0; i < sub.length; i++) r[i + shift] -= sub[i];
    r = polyTrim(r);
    iters++;
  }
 // r = lb^iters · rem(a,b)；lb<0 且 iters 奇数时整体再取负 → 恒为「正倍数真余数」
  if (lb < 0n && iters % 2 === 1) r = polyScale(r, -1n);
  return r;
}

/**
 * Sturm 链（带符号伪余数构造，序关系与标准 Sturm 序列等价）。
 * S0 = f（首项系数规整为正），S1 = f'，S_{i+1} = −prem(S_{i-1}, S_i)。
 */
function sturmChain(f) {
  let s0 = polyTrim(f);
  if (!s0.length) return [];
  if (s0[s0.length - 1] < 0n) s0 = polyScale(s0, -1n);
  const chain = [s0, polyTrim(polyDeriv(s0))];
  let guard = 0;
  while (guard++ < 512) {
    const last = chain[chain.length - 1];
    if (last.length <= 1) break; // 常数（含 0）终止
    const r = polyPrem(chain[chain.length - 2], last);
    const nxt = polyScale(r, -1n);
    if (!polyTrim(nxt).length) break;
    chain.push(polyTrim(nxt));
  }
  return chain;
}
/** Sturm 符号变化数（跳过 0 值） */
function sturmChanges(chain, x) {
  let prev = 0n, changes = 0;
  for (const p of chain) {
    const v = polyEval(p, x);
    if (v === 0n) continue;
    const sv = v < 0n ? -1n : 1n;
    if (prev !== 0n && sv !== prev) changes++;
    prev = sv;
  }
  return changes;
}
/**
 * 在整数区间 [lo, hi] 内隔离多项式（chain[0]）的整数根。
 * 返回候选整数（含端点零点），数量上限 maxRoots。
 */
function isolateIntegerRoots(chain, lo, hi, maxRoots) {
  const roots = [];
  if (!chain.length || !chain[0].length) return roots;
  const f0 = chain[0];
  const test = (x) => {
    if (x < lo || x > hi) return;
    if (polyEval(f0, x) === 0n && !roots.includes(x)) roots.push(x);
  };
  const rec = (a, b, depth) => {
    if (roots.length >= maxRoots || depth > 256) return;
    if (b - a <= 2n) {
      for (let x = a; x <= b; x++) test(x);
      return;
    }
    const va = sturmChanges(chain, a);
    const vb = sturmChanges(chain, b);
    if (va <= vb) return; // (a,b] 内无根
    const mid = (a + b) / 2n;
    rec(a, mid, depth + 1);
    rec(mid, b, depth + 1);
  };
  test(lo);
  rec(lo, hi, 0);
  test(hi);
  return roots;
}

/**
 * 依据 Howgrave-Graham 条件选格参数（m, t）：
 * 格基 g_{i,j} = n^{m-j}·x^i·f^j (j<m, i<δ) 与 h_i = x^i·f^m (i<t)，w = δm + t。
 * 条件：det^{1/w} < b^m/√w，其中 b = n^beta（根所在因子下界），det = n^{δm(m+1)/2}·X^{w(w-1)/2}。
 * 用浮点对数判定。另计入 LLL 近似因子 2^((w-1)/4)（Hermite 因子）——
 * m=1 的小格对「系数接近均匀 mod n」的多项式（如后缀场景首一化 f）实测不稳，
 * 保守判定会自动跳到 m=2（端到端验证卡 T2 实证：m=1 必败、m=2 稳过）。
 */
function pickLatticeParamsAll(nBits, d, lnX, beta, dimCap) {
  const lnN = Number(nBits) * Math.LN2;
  const lnB = beta * lnN;
  const lnLll = Math.LN2 / 4;
  const picks = [];
  for (let m = 1; m <= 64; m++) {
    for (const t of [0, 1, 2, 4, 8]) {
      const w = d * m + t;
      if (w < 2 || w > dimCap) continue;
      const logDet = (d * m * (m + 1) / 2) * lnN + (w * (w - 1) / 2) * lnX;
      const rhs = m * lnB - Math.log(w) / 2;
      if (logDet / w + (w - 1) * lnLll < rhs) picks.push({ m, t, w });
    }
  }
  picks.sort((a, b) => a.w - b.w);
  return picks;
}

/**
 * stereotyped message Coppersmith 攻击：
 * 已知明文前缀或后缀 + 未知字节数 u → 构造 f(x) = (已知部分 ± x)^e − c mod n，
 * Howgrave-Graham 构格 + BigInt LLL 求小根 x（|x| < X = 2^(8u)），恢复完整明文。
 * beta < 1 时支持根在 n 的因子 b ≥ n^beta 模意义下成立（命中即给出因子）。
 * @returns {string} 多行报告
 */
export function coppersmithStereotyped(n, e, c, prefixBytes, suffixBytes, unknownBytes, beta, dimCap, xMaxOverride) {
  const lines = [];
  const nBits = Number(n.toString(2).length);
  const d = Number(e); // 多项式次数 δ = e
  const X = xMaxOverride ? xMaxOverride : (1n << BigInt(8 * unknownBytes));
  const lnX = Number(X.toString(2).length) * Math.LN2;

  lines.push("Coppersmith 小根攻击 · stereotyped message（Howgrave-Graham 构格 + BigInt LLL）");
  lines.push(`  n = ${n} (${nBits} bits)`);
  lines.push(`  e = ${e}（多项式次数 δ = ${d}）`);
  lines.push(`  c = ${c}`);
  const u = Number(unknownBytes);
  lines.push(`  未知字节: ${u} → 根上界 X = 2^${8 * u}`);
  lines.push(`  beta = ${beta}（根所在因子下界 b ≥ n^beta；beta=1 即模 n）`);
  lines.push(`  理论界: X < n^(beta²/δ) = 2^${Math.floor(beta * beta * nBits / d)}`);

 // ---- 构造多项式 f(x) ----
  const hasPrefix = prefixBytes && prefixBytes.length > 0;
  const hasSuffix = suffixBytes && suffixBytes.length > 0;
  if (!hasPrefix && !hasSuffix) throw new Error("需在参数框提供已知明文前缀或后缀（二者之一）");
  if (hasPrefix && hasSuffix) throw new Error("前缀与后缀只能二选一（前缀场景：m = 前缀||未知；后缀场景：m = 未知||后缀）");
  let f;      // 多项式系数（BigInt[], mod n，首一）
  let mPoly;  // 描述
  if (hasPrefix) {
    const A = bigFromBytes(prefixBytes) * (1n << BigInt(8 * u));
 // m = A + x → f = (A + x)^e − c
    const coefs = new Array(d + 1).fill(0n);
 // 二项式展开：C(e,i)·A^(e-i)·x^i
    let binom = 1n; // C(e,0)
    let aPow = 1n;
    const aPows = [];
    for (let i = 0; i <= d; i++) { aPows.push(aPow); aPow *= BigInt(A); }
    for (let i = 0; i <= d; i++) {
      coefs[i] = (binom * aPows[d - i]) % n;
      binom = binom * BigInt(d - i) / BigInt(i + 1);
    }
    coefs[0] = (coefs[0] - c) % n;
    f = polyTrim(coefs.map((x) => ((x % n) + n) % n));
    mPoly = `f(x) = (${A} + x)^${e} − c  (mod n)，m = 前缀·256^${u} + x`;
  } else {
    const S = bigFromBytes(suffixBytes);
 // m = x·256^(后缀字节数) + S —— 未知段在高位，位移量由后缀长度决定（不是未知字节数）
    const K = 1n << BigInt(8 * suffixBytes.length);
 // f_raw = (K·x + S)^e − c，首项系数 K^e 非首一 → 乘模逆规整
    const coefs = new Array(d + 1).fill(0n);
    let binom = 1n;
    let sPow = 1n;
    const sPows = [];
    for (let i = 0; i <= d; i++) { sPows.push(sPow); sPow *= S; }
    let kPow = 1n;
    const kPows = [];
    for (let i = 0; i <= d; i++) { kPows.push(kPow); kPow *= K; }
    for (let i = 0; i <= d; i++) {
      coefs[i] = (binom * sPows[d - i] % n) * kPows[i] % n;
      binom = binom * BigInt(d - i) / BigInt(i + 1); // C(e,i) 迭代（前缀分支同式）
    }
    coefs[0] = (coefs[0] - c) % n;
    const fRaw = polyTrim(coefs.map((x) => ((x % n) + n) % n));
    const inv = modInverse(fRaw[d], n);
    f = polyTrim(fRaw.map((x) => (x * inv) % n));
    mPoly = `f(x) = (256^${suffixBytes.length}·x + ${S})^${e} − c  (mod n)（已首一化），m = x·256^${suffixBytes.length} + 后缀`;
  }
  lines.push(`  ${mPoly}`);
  lines.push("");

  if (u === 0 || X === 1n) {
 // 未知部分为 0：直接验证
    const cand = hasPrefix ? bigFromBytes(prefixBytes) * (1n << 0n) : bigFromBytes(suffixBytes);
    const ok = modPow(cand, e, n) === c;
    lines.push(ok ? `未知字节数为 0：直接验证 m=${cand}，m^e mod n ≡ c ✓` : "未知字节数为 0：验证未通过，检查输入");
    return lines.join("\n");
  }
  if (d < 2) throw new Error("e=1 时直接解线性方程（m=c），无需格攻击");
  if (d > 32) throw new Error(`e=${e} 过大：格维度 = δ·m 上限受限，单变量 Coppersmith 建议 e ≤ 16（大 e 请用 SageMath small_roots）`);

 // ---- 选格参数 ----
  const pickedList = pickLatticeParamsAll(nBits, d, lnX, beta, dimCap);
  if (!pickedList.length) {
    lines.push("× 无法构造满足 Howgrave-Graham 条件的格：根上界过大或格维度受限。");
    lines.push(`  当前 X = 2^${Number(X.toString(2).length)}，建议减小未知字节数、提高 dimCap，或 beta 更接近 1。`);
    return lines.join("\n");
  }

 // ---- 逐候选格升级重试（按维度 w 升序，最多 3 个）：H-G 判定是必要非充分，小维度格在
 // 「系数接近均匀 mod n」的多项式（如后缀场景首一化 f）上 LLL 实测可 miss——
 // 端到端验证卡实证 m=1,w=4 必败 / m=2,w=6 稳过，故逐候选重试。
 // LLL 耗时随维度指数涨（w=6≈17s、w=9≈10min 实测），3 个封顶防卡死。 ----
  let recovered = null;
  let factorFound = null;
  let triedRows = 0;
  let usedPick = pickedList[0];
  const triedDesc = [];
  for (const picked of pickedList.slice(0, 3)) {
    const { m, t, w } = picked;
    triedDesc.push(`m=${m},t=${t},w=${w}`);

 // ---- 构格：行 = 多项式系数 × X^k（g_{i,j} = n^{m-j}·x^i·f^j；h_i = x^i·f^m） ----
    const fPows = [polyTrim([1n])];
    for (let j = 1; j <= m; j++) fPows.push(polyTrim(polyMul(fPows[j - 1], f)));
    const rows = [];
    const polys = [];
    for (let j = 0; j < m; j++) {
      let mult = 1n;
      for (let z = 0; z < m - j; z++) mult *= n; // n^(m-j)
      for (let i = 0; i < d; i++) {
        const g = polyMul(fPows[j], zerosThenOne(i)); // x^i · f^j
        polys.push({ poly: g, mult });
      }
    }
    for (let i = 0; i < t; i++) {
      polys.push({ poly: polyMul(fPows[m], zerosThenOne(i)), mult: 1n });
    }
    for (const { poly, mult } of polys) {
      const row = new Array(w).fill(0n);
      for (let k2 = 0; k2 < poly.length && k2 < w; k2++) row[k2] = poly[k2] * X ** BigInt(k2) * mult;
      rows.push(row);
    }
    const basis = rows.map((r) => r.slice());
    lllReduce(basis, { n: 3n, d: 4n }, 200000);

 // ---- 从归约基各行读候选多项式，Sturm 找 [0,X] 内整数根并验证 ----
    triedRows = 0;
    for (const row of basis) {
      if (recovered !== null) break;
      if (triedRows++ >= 4) break;
 // 行向量 = coeffs(g(xX)) → g_k = row[k] / X^k（格组合保证整除）
      const g = [];
      let bad = false;
      for (let k2 = 0; k2 < w; k2++) {
        const den = X ** BigInt(k2);
        if (row[k2] % den !== 0n) { bad = true; break; }
        g.push(row[k2] / den);
      }
      if (bad) continue;
      const gp = polyTrim(g);
      if (gp.length < 2) continue; // 零/常数多项式
      const chain = sturmChain(gp);
      if (chain.length < 2) continue;
      const roots = isolateIntegerRoots(chain, 0n, X, 4);
      for (const x of roots) {
 // 还原完整明文并验证
        const fullM = hasPrefix
          ? bigFromBytes(prefixBytes) * (1n << BigInt(8 * u)) + x
          : x * (1n << BigInt(8 * suffixBytes.length)) + bigFromBytes(suffixBytes);
        if (beta === 1) {
          if (modPow(fullM, e, n) === c) { recovered = { x, fullM }; usedPick = picked; break; }
        } else {
          const g2 = bigGcd(((modPow(fullM, e, n) - c) % n + n) % n, n);
          if (g2 > 1n && g2 < n) { recovered = { x, fullM }; factorFound = g2; usedPick = picked; break; }
        }
      }
    }
    if (recovered) break;
  }
  lines.push(`● 尝试格序列（Howgrave-Graham 条件过筛）: ${triedDesc.join(" → ")}`);
  const { w } = usedPick;

  lines.push("");
  if (recovered) {
    const k = Math.ceil(nBits / 8);
    const mb = bigToBytes(recovered.fullM, k);
    lines.push("=== 攻击成功 ===");
    lines.push(`小根 x = ${recovered.x} (0x${recovered.x.toString(16)})`);
    lines.push(`完整明文 m = ${recovered.fullM}`);
    lines.push(`hex = 0x${bytesToHexStr(mb)}`);
    lines.push(`UTF-8 尝试: ${bytesToUtf8Safe(mb)}`);
    if (factorFound) {
      lines.push(`beta<1 命中：gcd((m^e − c) mod n, n) = ${factorFound}`);
      lines.push(`  另一因子 = ${n / factorFound}`);
    } else {
      lines.push(`校验: m^e mod n ≡ c ✓`);
    }
    lines.push(`格: ${w}×${w}，LLL 归约后第 ${triedRows} 行（含）内命中`);
  } else {
    lines.push("× LLL 归约完成，但各短向量多项式在 [0, X] 内未找到通过验证的整数根。");
    lines.push(`  格: ${w}×${w} · 已尝试前 ${triedRows} 行 · X = 2^${Number(X.toString(2).length)}`);
    lines.push("  可能原因：未知部分超出可恢复界（X 应明显小于 n^(beta²/δ)）、已知前后缀有误、或 e 过大格维度不足。");
  }
  return lines.join("\n");
}

// 辅助：x^i 的系数向量
function zerosThenOne(i) {
  const a = new Array(i + 1).fill(0n);
  a[i] = 1n;
  return a;
}

// 已知明文参数解析：UTF-8 字符串，或 0x 前缀 hex
function parseKnownBytes(str, label) {
  const s = String(str || "").trim();
  if (!s) return new Uint8Array(0);
  if (/^0x/i.test(s)) {
    const hex = s.slice(2).replace(/\s+/g, "");
    if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) throw new Error(`${label} hex 格式非法`);
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  return new TextEncoder().encode(s);
}

function runCoppersmith(text, p) {
  const nStr = String((p && p.n) || "").trim();
  const eStr = String((p && p.e) || "").trim();
  const cStr = String((p && p.c) || "").trim();
  const prefixStr = String((p && p.knownPrefix) || "").trim();
  const suffixStr = String((p && p.knownSuffix) || "").trim();
  const unknownBytes = Math.max(0, Math.floor(Number((p && p.unknownBytes) || 0)));
  const beta = Math.min(1, Math.max(0.5, Number((p && p.beta) || 1)));
  const dimCap = Math.max(8, Math.min(48, Math.floor(Number((p && p.maxDim) || 32))));
  const xMaxStr = String((p && p.xMax) || "").trim();
  if (!nStr || !eStr || !cStr) {
    return "需在参数框填入 n、e、c（十进制）+ 已知前缀（或后缀）+ 未知字节数；这是 stereotyped message 攻击的必要输入";
  }
  const n = BigInt(nStr), e = BigInt(eStr), c = BigInt(cStr);
  let prefixBytes, suffixBytes, xMax = 0n;
  try {
    prefixBytes = parseKnownBytes(prefixStr, "已知前缀");
    suffixBytes = parseKnownBytes(suffixStr, "已知后缀");
    if (xMaxStr) xMax = BigInt(xMaxStr);
  } catch (err) {
    return "参数解析失败：" + (err && err.message ? err.message : String(err));
  }
  try {
    return coppersmithStereotyped(n, e, c, prefixBytes, suffixBytes, unknownBytes, beta, dimCap, xMax);
  } catch (err) {
    return "Coppersmith 攻击失败：" + (err && err.message ? err.message : String(err));
  }
}

// ============ 5. Boneh-Durfee 提示 ============
function runBonehDurfee(text, p) {
  const nStr = String((p && p.n) || "").trim();
  const eStr = String((p && p.e) || "").trim();
  if (!nStr || !eStr) return "需在参数框填入 n、e（十进制；主输入框不再使用）";
  const n = BigInt(nStr), e = BigInt(eStr);
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
    "注意：多变量 Coppersmith（Boneh-Durfee）本工具未实现，此 op 提供条件检查和方法说明。",
    "      单变量 Coppersmith 已在 rsaCoppersmith 落地（stereotyped message 场景）。",
    "      实际多变量攻击推荐使用 SageMath + defund/coppersmith 实现。",
    "      若 d < N^0.25，可直接用 rsatool.js 的 rsaWiener（连分数法）。",
  ];
  return lines.join("\n");
}

// ============ 注册 ============
register({
  id: "rsaDpDqLeak", family: "rsaatk", familyLabel: "dpdq", cat: "crypto", name: "RSA dp/dq 泄露求 d",
  desc: "已知 e, n, dp(=d mod p-1) → 分解 n 求 d；可选 dq 验证（参数框填 e/n/dp，十进制，dq 可选；主输入框不再使用）",
  params: [
    { key: "e", label: "公钥指数 e", type: "text", default: "", placeholder: "十进制公钥指数" },
    { key: "n", label: "模数 n", type: "text", default: "", placeholder: "十进制模数" },
    { key: "dp", label: "泄露的 dp", type: "text", default: "", placeholder: "dp = d mod (p-1)，十进制" },
    { key: "dq", label: "泄露的 dq（可选）", type: "text", default: "", placeholder: "dq = d mod (q-1)，留空跳过验证" },
  ],
  run: runDpDqLeak,
});

register({
  id: "rsaLsbOracle", family: "rsaatk", familyLabel: "lsb", cat: "crypto", name: "RSA LSB Oracle 攻击",
  desc: "LSB Oracle 逐位二分恢复明文。两种用法：①oracleLog 粘贴逐轮 oracle 响应（0/1，每行一轮，共 n 位长轮数）按标准二分恢复 m；②填 m 进入本地模拟验证。参数框填 n/e/c（十进制）",
  params: [
    { key: "n", label: "模数 n", type: "text", default: "", placeholder: "十进制模数" },
    { key: "e", label: "公钥指数 e", type: "text", default: "", placeholder: "十进制公钥指数" },
    { key: "c", label: "密文 c", type: "text", default: "", placeholder: "c = m^e mod n，十进制" },
    { key: "oracleLog", label: "oracle 响应序列（每轮一位 0/1，每行一轮）", type: "text", default: "", placeholder: "第 i 轮 = c·(2^e)^i mod n 的解密最低位；共需 n 的位长轮；连续 0/1 串亦可" },
    { key: "m", label: "实际明文 m（可选，模拟模式）", type: "text", default: "", placeholder: "填入后本地模拟 oracle 并验证（oracleLog 优先）" },
    { key: "maxBits", label: "最多恢复位数（0=自动 n 的位数）", type: "number", default: 0, placeholder: "0=自动" },
  ],
  run: runLsbOracle,
});

register({
  id: "rsaBleichenbacher", family: "rsaatk", familyLabel: "bleichenbacher", cat: "crypto", name: "RSA Bleichenbacher 攻击",
  desc: "PKCS#1 v1.5 padding oracle 区间归约攻击（真实现）：serverKey 填 oracle 侧私钥（hex：d，或 p,q 逗号分隔）本地模拟判定，标准 Bleichenbacher 循环解出 m；maxS 护栏默认 100 万次查询，每 5000 次输出进度",
  params: [
    { key: "n", label: "模数 n", type: "text", default: "", placeholder: "十进制模数" },
    { key: "e", label: "公钥指数 e", type: "text", default: "", placeholder: "十进制公钥指数" },
    { key: "c", label: "密文 c", type: "text", default: "", placeholder: "c = m^e mod n（m 须为合法 PKCS#1 v1.5 padding），十进制" },
    { key: "serverKey", label: "serverKey（oracle 侧私钥，hex）", type: "text", default: "", placeholder: "私钥 d 单个 hex 大数；或 p,q 两个 hex 逗号分隔" },
    { key: "maxS", label: "maxS 查询护栏", type: "number", default: 1000000, placeholder: "oracle 查询上限，防卡死（默认 100 万）" },
  ],
  run: runBleichenbacher,
});

register({
  id: "rsaCoppersmith", family: "rsaatk", familyLabel: "coppersmith", cat: "crypto", name: "RSA Coppersmith 小根攻击",
  desc: "stereotyped message 小根恢复（真实现：Howgrave-Graham 构格 + BigInt LLL）：已知明文前缀或后缀 + 未知字节数，构造 f(x)=(已知±x)^e−c mod n 求小根恢复完整明文；beta<1 支持根在 n 的因子上（命中给因子）",
  params: [
    { key: "n", label: "模数 n", type: "text", default: "", placeholder: "十进制模数" },
    { key: "e", label: "公钥指数 e（小指数，建议 ≤16）", type: "text", default: "", placeholder: "十进制，如 3、5、17" },
    { key: "c", label: "密文 c", type: "text", default: "", placeholder: "c = m^e mod n，十进制" },
    { key: "knownPrefix", label: "已知明文前缀（与后缀二选一）", type: "text", default: "", placeholder: "UTF-8 字符串或 0x 开头 hex" },
    { key: "knownSuffix", label: "已知明文后缀（可选）", type: "text", default: "", placeholder: "m = 未知||后缀 时填这里" },
    { key: "unknownBytes", label: "未知字节数", type: "number", default: 8, placeholder: "未知部分长度（字节数）" },
    { key: "beta", label: "beta（根所在因子下界指数）", type: "number", default: 1, placeholder: "1=模 n 本身；<1 时根模 n 的因子 b≥n^beta" },
    { key: "xMax", label: "根上界 xMax（可选，十进制）", type: "text", default: "", placeholder: "留空按未知字节数取 2^(8·字节数)" },
    { key: "maxDim", label: "格维度上限 dimCap", type: "number", default: 32, placeholder: "8~48，防止 LLL 超时" },
  ],
  run: runCoppersmith,
});

register({
  id: "rsaBonehDurfee", family: "rsaatk", familyLabel: "bonehdurfee", cat: "crypto", name: "RSA Boneh-Durfee 提示",
  desc: "d < N^0.292 条件检查 + 格攻击方法说明（参数框填 n/e，十进制；主输入框不再使用）",
  params: [
    { key: "n", label: "模数 n", type: "text", default: "", placeholder: "十进制模数" },
    { key: "e", label: "公钥指数 e", type: "text", default: "", placeholder: "十进制公钥指数" },
  ],
  run: runBonehDurfee,
});

export { modPow, modInverse, isProbablePrime };
