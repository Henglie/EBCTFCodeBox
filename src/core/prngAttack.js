/*
 * prngAttack.js — PRNG 破解（LCG 参数恢复 + MT19937 状态恢复，cat:'crypto'，run 型）。
 *
 * 定位：CTF crypto 高频题。Python random（MT19937）预测、glibc rand（LCG）参数恢复
 * 给定连续输出反推内部状态，预测/还原后续随机数。对应 ctf-wiki crypto/prng/。
 *
 * 两模式：
 * 1) LCG（线性同余）：x_{n+1} = (a*x_n + c) mod m
 * 给连续输出 ≥3 个，差分法恢复 a/c/m：
 * t_n = x_{n+1} - x_n
 * t_{n+1} = x_{n+2} - x_{n+1}
 * m = gcd(t_n, t_{n+1}, ...)（需 ≥5 输出才能稳定推 m；3 输出需用户给 m）
 * a = t_{n+1} * t_n^{-1} mod m
 * c = x_{n+1} - a*x_n mod m
 * 用户可选填 m（已知模数如 2^31 加速）；不填且 ≥5 输出则差值 gcd 推 m。
 * 2) MT19937（Python random 标准引擎）：给定 624 个连续 32 位输出，逆向 temper
 * 恢复 624 字 state，再 forward 一轮（generate）输出第 625 个值。
 * temper: y^=y>>11; y^=(y<<7)&0x9d2c5680; y^=(y<<15)&0xefc60000; y^=y>>18
 * 逆向 4 步可恢复原 state。
 *
 * 红线：
 * - 算法层零 UI 依赖（仅 registry）。
 * - 零外发：纯本地 BigInt/位运算。
 * - 件内自注册（register(op)）。
 *
 * 契约：register({id, cat:'crypto', name, desc, params, run})。
 *
 * 参考：
 * - LCG 参数恢复：cryptopals Set 3 / ctf-wiki crypto/prng/introduction
 * - MT19937 untemper：Python random 源码 + ctf-wiki crypto/prng/problem
 */
import { register } from "./registry.js";

// ============================================================
// 通用工具
// ============================================================
function parseNumbers(text) {
 // 每行一个数字（十进制/hex 0x 前缀），空行/注释跳过
  const out = [];
  for (const line of String(text || "").split(/[\r\n]+/)) {
    const s = line.trim();
    if (!s || s.startsWith("#") || s.startsWith("//")) continue;
    let n;
    if (/^0x[0-9a-fA-F]+$/.test(s)) n = BigInt(s);
    else if (/^-?\d+$/.test(s)) n = BigInt(s);
    else continue; // 非数字行跳过
    out.push(n);
  }
  return out;
}

function egcd(a, b) {
 // 扩展欧几里得：返回 [g, x, y] 使 a*x + b*y = g = gcd(|a|,|b|)
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  let oldR = a, r = b, oldS = 1n, s = 0n, oldT = 0n, t = 1n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  return [oldR, oldS, oldT];
}

function modInverse(a, m) {
 // a 在 mod m 下的逆，不存在返回 null
  const [g, x] = egcd(((a % m) + m) % m, m);
  if (g !== 1n) return null;
  return ((x % m) + m) % m;
}

function bigGcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}

// ============================================================
// LCG 参数恢复
// ============================================================
/**
 * 给定连续 LCG 输出 xs（≥3 个），可选填模数 m，恢复 (a, c, m)。
 * 返回 {a, c, m, nextPredict} 或抛错。
 *
 * 算法（差分法）：
 * t_n = x_{n+1} - x_n
 * m = gcd(|t_0|, |t_1|, ..., |t_{k-2}|)（≥5 输出可稳定推 m）
 * a = t_1 * t_0^{-1} mod m
 * c = x_1 - a*x_0 mod m
 *
 * 注意：差值 GCD 给出的 m 可能是真实 m 的因子（输出符号翻转或不足采样时）。
 * 用户给 m 更可靠。
 */
function lcgRecover(xs, knownM) {
  if (xs.length < 3) {
    throw new Error("LCG 恢复需至少 3 个连续输出（推荐 ≥5 个以稳定推模数）");
  }
  const diffs = [];
  for (let i = 0; i < xs.length - 1; i++) {
    diffs.push(xs[i + 1] - xs[i]);
  }

  let m;
  if (knownM && knownM > 0n) {
    m = knownM;
  } else {
 // 差值 gcd 推模数（需 ≥5 输出，即 ≥4 差值，才相对可靠）
    if (diffs.length < 4) {
      throw new Error("未填模数且输出 < 5 个：差值 GCD 推模数不稳定，请填已知模数（如 2^31）");
    }
    let g = bigGcd(diffs[0] < 0n ? -diffs[0] : diffs[0], diffs[1] < 0n ? -diffs[1] : diffs[1]);
    for (let i = 2; i < diffs.length; i++) {
      g = bigGcd(g, diffs[i] < 0n ? -diffs[i] : diffs[i]);
    }
    if (g === 0n) throw new Error("差值全 0，输入可能是常数序列");
    m = g;
 // gcd 给出的可能是真模数的因子。CTF 常见 m=2^31；若 g 远小，提示用户核实。
  }

 // a = t_1 * t_0^{-1} mod m
  const t0 = ((diffs[0] % m) + m) % m;
  const t1 = ((diffs[1] % m) + m) % m;
  const invT0 = modInverse(t0, m);
  if (invT0 === null) {
    throw new Error("t_0 在 mod m 下不可逆（差值与模数不互素）。请核对输入或填正确模数。");
  }
  const a = (t1 * invT0) % m;
 // c = x_1 - a*x_0 mod m
  const c = (((xs[1] - a * xs[0]) % m) + m) % m;

 // 验证：用恢复的 (a,c,m) 检查后续输出是否一致
  const mismatches = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const expected = (a * xs[i] + c) % m;
    if (expected !== xs[i + 1]) mismatches.push(i);
  }
 // 预测下一个
  const nextPredict = (a * xs[xs.length - 1] + c) % m;

  return { a, c, m, nextPredict, mismatches };
}

// ============================================================
// MT19937 状态恢复（untemper + regenerate）
// ============================================================
// Python random 用 MT19937：32 位 state[624]，index 指针。每次输出走 temper。
// temper(y): y^=y>>11; y^=(y<<7)&0x9d2c5680; y^=(y<<15)&0xefc60000; y^=y>>18
// untemper 反向 4 步可从输出反推 state。

const MT_N = 624;
const MT_M = 397;
const MT_MATRIX_A = 0x9908b0dfn;
const MT_UPPER_MASK = 0x80000000n;
const MT_LOWER_MASK = 0x7fffffffn;

// 32 位掩码
const M32 = 0xffffffffn;

// 32 位左移
function shl32(x, n) {
  return (x << BigInt(n)) & M32;
}
// 32 位右移（无符号）
function shr32(x, n) {
  return (x & M32) >> BigInt(n);
}

// untemper：从输出 y 反推 state
function untemper(y) {
 // 步骤 4 反向：y ^= y >> 18（可逆：高位 18 位不变，低 14 位 = 低 14 ^ 高 18 中对应低 14）
  y = undoRightShiftXor(y, 18);
 // 步骤 3 反向：y ^= (y << 15) & 0xefc60000
  y = undoLeftShiftXorMask(y, 15, 0xefc60000n);
 // 步骤 2 反向：y ^= (y << 7) & 0x9d2c5680
  y = undoLeftShiftXorMask(y, 7, 0x9d2c5680n);
 // 步骤 1 反向：y ^= y >> 11
  y = undoRightShiftXor(y, 11);
  return y & M32;
}

// 反向 y = x ^ (x >> n) ——x 高 n 位 = y 高 n 位，逐位块往下推
function undoRightShiftXor(y, n) {
  let x = 0n;
 // 从最高位块往下：高 n 位不变，下一块 = y 块 ^ x 上一块对应位
 // 32 位，块大小 n
  x = y & M32;
 // 迭代处理：每轮把当前已知的高段往低位扩展 n 位
  let known = n; // 已知高 known 位
  while (known < 32) {
    const shift = n;
 // 下一段 n 位：x[32-known-shift .. 32-known-1] = y[...] ^ x[32-known .. 32-known+shift-1] 高位对应
 // 简化：x ^= (x >> n)，单次操作即可还原（因 x >> n 时高位已知部分参与异或）
    x = x ^ (shr32(x, shift));
    known += n;
  }
 // 上面迭代收敛后 x 应等于原 state（高 n 位不变 → 高 2n 位确定 → 高 3n 位确定 …）
 // 但单次异或只覆盖一段，多段需迭代。重写更稳的版本：
  return undoRightShiftXorStable(y, n);
}

// 稳定版：分段异或，每次扩展 n 位
function undoRightShiftXorStable(y, n) {
  let x = y & M32;
 // 高 n 位不变，每轮往下扩展 n 位
  for (let bit = n; bit < 32; bit += n) {
 // 取当前已知的高 bit 位的 x 值，右移 n 位，与 y 异或得到下一段
    const highPart = shr32(x, n);
    x = (y & M32) ^ highPart;
 // 但这只扩展一段；下一段需要用新 x 再算
  }
 // 上面单次不够，多次迭代：
  x = y & M32;
  let prev = x;
  for (let i = 0; i < Math.ceil(32 / n); i++) {
    prev = (y & M32) ^ shr32(prev, n);
  }
  return prev & M32;
}

// 反向 y = x ^ ((x << n) & mask) ——x 低 n 位 = y 低 n 位，逐段往上推
function undoLeftShiftXorMask(y, n, mask) {
  let x = y & M32;
  let prev = x;
  for (let i = 0; i < Math.ceil(32 / n); i++) {
    prev = (y & M32) ^ (shl32(prev, n) & mask);
  }
  return prev & M32;
}

/**
 * MT19937 状态恢复：给 624 个连续 32 位输出，返回完整 state + 下一个输出。
 */
function mt19937Recover(outputs) {
  if (outputs.length < MT_N) {
    throw new Error("MT19937 恢复需 624 个连续 32 位输出（实给 " + outputs.length + "）");
  }
 // 把前 624 个输出 untemper 还原 state[0..623]
  const state = new Array(MT_N);
  for (let i = 0; i < MT_N; i++) {
    state[i] = untemper(outputs[i] & M32);
  }
 // 跑一次 generate（twist）得到下一轮 state，取 state[0] temper 作为第 625 个输出
 // generate: for i in 0..N: y = (state[i] & UPPER) | (state[(i+1)%N] & LOWER); state[i] = state[(i+M)%N] ^ (y>>1) ^ (y&1 ? MATRIX_A : 0)
  const nextState = new Array(MT_N);
  for (let i = 0; i < MT_N; i++) {
    const y = (state[i] & MT_UPPER_MASK) | (state[(i + 1) % MT_N] & MT_LOWER_MASK);
    nextState[i] = (state[(i + MT_M) % MT_N] ^ shr32(y, 1) ^ ((y & 1n) ? MT_MATRIX_A : 0n)) & M32;
  }
 // temper(nextState[0]) = 第 625 个输出
  const nextOut = temper(nextState[0]);
  return { state, nextState, nextOut };
}

function temper(y) {
  y = y & M32;
  y = y ^ shr32(y, 11);
  y = y ^ (shl32(y, 7) & 0x9d2c5680n);
  y = y ^ (shl32(y, 15) & 0xefc60000n);
  y = y ^ shr32(y, 18);
  return y & M32;
}

// ============================================================
// run：主入口
// ============================================================
function prngAttackRun(text, p) {
  const mode = (p && p.mode) || "lcg";
  const lines = [];
  lines.push("=== PRNG 破解（" + (mode === "lcg" ? "LCG 参数恢复" : "MT19937 状态恢复") + "） ===");
  lines.push("");

  const nums = parseNumbers(text);
  if (nums.length === 0) {
    lines.push("✗ 未解析到数字。每行一个十进制或 0x 十六进制数字（# 或 // 开头注释行可省略）。");
    return lines.join("\n");
  }
  lines.push("解析到 " + nums.length + " 个数字。");
  lines.push("");

  if (mode === "lcg") {
    const knownM = (p && p.modulus) ? String(p.modulus).trim() : "";
    let m = 0n;
    if (knownM) {
      if (/^0x[0-9a-fA-F]+$/.test(knownM)) m = BigInt(knownM);
      else if (/^\d+$/.test(knownM)) m = BigInt(knownM);
      else {
        lines.push("✗ 模数格式错误（需十进制或 0x 前缀十六进制）");
        return lines.join("\n");
      }
    }
    try {
      const r = lcgRecover(nums, m);
      lines.push("--- 恢复结果 ---");
      lines.push("a (乘数) = " + r.a.toString());
      lines.push("c (增量) = " + r.c.toString());
      lines.push("m (模数) = " + r.m.toString());
      lines.push("下一个预测值 = " + r.nextPredict.toString());
      if (r.mismatches.length > 0) {
        lines.push("");
        lines.push("⚠ 内部一致性检查：以下索引的输出与恢复参数不符（可能模数错或非纯 LCG）：");
        lines.push("  索引: " + r.mismatches.join(", "));
      } else {
        lines.push("");
        lines.push("✓ 内部一致性检查通过（所有输出均符合 x_{n+1} = (a*x_n + c) mod m）");
      }
      if (!knownM) {
        lines.push("");
        lines.push("⚠ 模数由差值 GCD 推出，可能是真实模数的因子。若结果异常请填已知模数重试。");
        lines.push("  CTF 常见 LCG 模数：2^31 (glibc rand)、2^32、2^48、2^64。");
      }
    } catch (e) {
      lines.push("✗ " + (e.message || String(e)));
    }
    return lines.join("\n");
  }

  if (mode === "mt19937") {
    if (nums.length < MT_N) {
      lines.push("✗ MT19937 需 624 个连续 32 位输出，实给 " + nums.length + "。");
      lines.push("  Python random.getrandbits(32) 连续输出 624 个即可。");
      return lines.join("\n");
    }
    try {
      const r = mt19937Recover(nums);
      lines.push("--- 恢复结果 ---");
      lines.push("✓ 已从 624 个输出恢复内部 state（624 × 32 位）。");
      lines.push("下一个预测输出（第 625 个）= " + r.nextOut.toString());
      lines.push("");
      lines.push("state[0..3]（前 4 个 32 位状态，校验用）:");
      for (let i = 0; i < 4 && i < r.state.length; i++) {
        lines.push("  state[" + i + "] = 0x" + r.state[i].toString(16).padStart(8, "0"));
      }
      lines.push("");
      lines.push("说明: ");
      lines.push("  · Python random.getrandbits(32) 走 MT19937，624 输出为一周期。");
      lines.push("  · 624 输出后 state 自动 twist（generate），第 625 个即新周期首个输出。");
      lines.push("  · untemper 反向 4 步（11/7/15/18 移位）恢复原 state。");
    } catch (e) {
      lines.push("✗ " + (e.message || String(e)));
    }
    return lines.join("\n");
  }

  return "未知模式: " + mode;
}

// ============================================================
// 注册
// ============================================================
register({
  id: "prngAttack",
  cat: "crypto",
  name: "PRNG 破解（LCG / MT19937）",
  desc: "LCG 参数恢复（差分法推 a/c/m，可填已知模数）+ MT19937 状态恢复（624 输出 untemper + 预测下一值，Python random 标准）",
  params: [
    {
      key: "mode", label: "模式", type: "select", default: "lcg",
      options: [
        { value: "lcg", label: "LCG 参数恢复（glibc rand 类）" },
        { value: "mt19937", label: "MT19937 状态恢复（Python random）" },
      ],
    },
    { key: "modulus", label: "已知模数 m（LCG 可选，留空自动推）", type: "text", default: "", placeholder: "如 2147483648 (2^31) 或 0x80000000，留空自动推" },
  ],
  run: prngAttackRun,
});

export { lcgRecover, mt19937Recover, untemper, temper };
