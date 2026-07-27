/*
 * lfsrRecover.js — LFSR 序列恢复（Berlekamp-Massey，GF(2)，cat:'analysis'，run 型）。
 *
 * 定位：CTF crypto 高频。给一段 LFSR 输出比特，恢复反馈多项式（抽头 taps）+
 * 初始状态，进而预测后续比特。纯前端可做的经典密码分析。
 *
 * 算法：Berlekamp-Massey（GF(2) 上二元序列的最短 LFSR 综合）。
 * 对 0/1 序列 s[0..N-1]，求能生成它的最短线性反馈移位寄存器：
 * - 线性复杂度 L（= LFSR 级数）
 * - 连接/反馈多项式 c(x) = 1 + c1·x + c2·x^2 + ... + cL·x^L（GF(2)[x]）
 * - 初始状态（前 L 个比特）
 * GF(2) 里加减法都是 XOR（-1 就是 XOR），乘法是 AND。
 *
 * 标准 BM（多项式低次在前，c[0]=1）：
 * b=[1], c=[1], L=0, m=-1
 * for n in 0..N-1:
 * d = s[n] ^ Σ_{i=1..L} c[i]&s[n-i] // discrepancy in GF(2)
 * if d==1:
 * t = c.copy
 * shift = n - m
 * for i: c[i+shift] ^= b[i] // c ← c XOR (x^shift · b)
 * if 2L <= n: L = n+1-L; b = t; m = n
 *
 * 反馈多项式即 c(x)，级数 L，抽头由 c 的非零系数位置给出。
 * 求出 L 与 c 后用 LFSR 递推重现输入序列（自测的一部分）。
 *
 * 递推关系（Fibonacci LFSR，由 c(x)=1+Σc_i x^i 导出）：
 * s[n] = Σ_{i=1..L} c[i] & s[n-i] (GF(2))
 * 即当前比特 = 反馈多项式抽头位对应的历史比特 XOR。
 *
 * 模式：
 * - analyze：跑 BM，输出 L / 反馈多项式 / 抽头 / 初始状态 + 重现校验。
 * - predict：analyze 基础上再外推 predictN 个比特。
 *
 * 红线：算法层零 UI 依赖（仅 registry）；零外发纯本地；件内自注册。
 * 不写 detect：纯 0/1 串是很多 op 的公共入口，analysis 类爆破工具不参与
 * magic 自动预筛（对齐 nonogram / spiralMatrix / xorAnalyze 均无 detect）。
 *
 * 契约：register({id, cat:'analysis', name, desc, params, run})。
 *
 * 参考：
 * - Berlekamp-Massey algorithm（Wikipedia / Massey 1969）
 * - Handbook of Applied Cryptography §6.2.3（Linear complexity, BM）
 */
import { register } from "./registry.js";

// ============================================================
// 输入解析：容忍空格/换行/逗号分隔，也容忍纯 "010110..." 串
// ============================================================
function parseBits(text) {
  const s = String(text == null ? "" : text);
 // 只保留 0/1，其余分隔符（空格、换行、逗号、tab 等）全部丢弃
  const bits = [];
  for (const ch of s) {
    if (ch === "0") bits.push(0);
    else if (ch === "1") bits.push(1);
 // 其余字符（分隔符）忽略；若含非 0/1/分隔的字符也一并忽略
  }
  return bits;
}

// ============================================================
// Berlekamp-Massey（GF(2)）
// ============================================================
/**
 * @param {number[]} s 0/1 比特序列
 * @returns {{L:number, c:number[]}} L=线性复杂度，c=连接多项式系数（c[0]=1，低次在前）
 */
function berlekampMassey(s) {
  const N = s.length;
  let c = [1]; // 连接多项式，c[0]=1
  let b = [1]; // 上一次 L 变化时的 c 备份
  let L = 0;
  let m = -1; // 上一次 L 变化的下标

  for (let n = 0; n < N; n++) {
 // discrepancy d = s[n] ^ Σ_{i=1..L} c[i] & s[n-i]
    let d = s[n] & 1;
    for (let i = 1; i <= L; i++) {
      if (c[i] && s[n - i]) d ^= 1;
    }
    if (d === 1) {
      const t = c.slice(); // 备份当前 c
      const shift = n - m;
 // c ← c XOR (x^shift · b)
      for (let i = 0; i < b.length; i++) {
        const idx = i + shift;
        while (c.length <= idx) c.push(0);
        c[idx] ^= b[i];
      }
      if (2 * L <= n) {
        L = n + 1 - L;
        b = t;
        m = n;
      }
    }
  }
 // 规整：连接多项式有效长度为 L+1；截断/补齐到 L+1（高位应为 0 之外的系数已由算法保证）
  const cout = new Array(L + 1).fill(0);
  for (let i = 0; i <= L && i < c.length; i++) cout[i] = c[i] & 1;
  cout[0] = 1; // 恒为 1
  return { L, c: cout };
}

// ============================================================
// LFSR 递推：由连接多项式 c 与初始状态生成序列
// ============================================================
// 递推 s[n] = Σ_{i=1..L} c[i] & s[n-i] (GF(2))
/**
 * @param {number[]} c 连接多项式（c[0]=1，长度 L+1）
 * @param {number[]} init 初始状态（前 L 个比特）
 * @param {number} total 要生成的总比特数
 * @returns {number[]}
 */
function lfsrGenerate(c, init, total) {
  const L = c.length - 1;
  const out = init.slice(0, L);
 // 若初始状态不足 L，无法递推
  for (let n = out.length; n < total; n++) {
    let bit = 0;
    for (let i = 1; i <= L; i++) {
      if (c[i] && out[n - i]) bit ^= 1;
    }
    out.push(bit);
  }
  return out.slice(0, total);
}

// 抽头位置：连接多项式 c 中非零系数的次数（次数 ≥ 1 的项，即反馈抽头）
function tapsOf(c) {
  const taps = [];
  for (let i = 1; i < c.length; i++) if (c[i]) taps.push(i);
  return taps;
}

// 多项式可读式：x^4 + x + 1（含常数项 1）。次数高在前。
function polyToString(c) {
  const terms = [];
  for (let i = c.length - 1; i >= 0; i--) {
    if (!c[i]) continue;
    if (i === 0) terms.push("1");
    else if (i === 1) terms.push("x");
    else terms.push("x^" + i);
  }
  return terms.length ? terms.join(" + ") : "0";
}

// ============================================================
// 分析主入口（纯函数，供自测）
// ============================================================
/**
 * @param {number[]} bits 0/1 序列
 * @returns {{L, c, taps, poly, init, reproduced, ok}}
 */
function analyzeLFSR(bits) {
  const { L, c } = berlekampMassey(bits);
  const taps = tapsOf(c);
  const poly = polyToString(c);
  const init = bits.slice(0, L);
 // 用求得的 LFSR 重现整段输入，校验是否一致
  let reproduced = [];
  let ok = true;
  if (L === 0) {
 // 全 0 序列：L=0，无反馈，序列恒 0
    reproduced = bits.map(() => 0);
    ok = bits.every((b) => b === 0);
  } else if (bits.length >= L) {
    reproduced = lfsrGenerate(c, init, bits.length);
    ok = reproduced.length === bits.length && reproduced.every((b, i) => b === bits[i]);
  } else {
    ok = false;
  }
  return { L, c, taps, poly, init, reproduced, ok };
}

// ============================================================
// run：主入口
// ============================================================
function lfsrRecoverRun(text, p) {
  const mode = (p && p.mode) || "analyze";
  const predictN = Math.max(0, Math.min(4096, parseInt((p && p.predictN) != null ? p.predictN : 16, 10) || 0));

  const lines = [];
  lines.push("=== LFSR 序列恢复（Berlekamp-Massey / GF(2)） ===");
  lines.push("");

  const bits = parseBits(text);
  if (bits.length === 0) {
    lines.push("✗ 未解析到任何 0/1 比特。输入一串 0/1（可用空格/换行/逗号分隔，也可纯 \"010110…\"）。");
    return lines.join("\n");
  }

  lines.push("输入比特数: " + bits.length);
  lines.push("输入序列: " + bits.join("") + (bits.length > 200 ? "" : ""));
  lines.push("");

  const res = analyzeLFSR(bits);

  lines.push("--- 分析结果 ---");
  lines.push("线性复杂度 L（LFSR 级数）: " + res.L);
  lines.push("反馈多项式（连接多项式 c(x)）: " + res.poly);
  lines.push("抽头位置 taps（次数≥1 的非零系数）: [" + res.taps.join(", ") + "]");
  lines.push("初始状态（前 L 个比特）: " + (res.init.length ? res.init.join("") : "（空，L=0）"));
  lines.push("");

  lines.push("--- 重现校验 ---");
  if (res.ok) {
    lines.push("✓ 用求得的 LFSR 递推可完整重现输入序列。");
  } else {
    lines.push("⚠ 无法完整重现输入（序列可能非纯 LFSR 输出，或长度不足 2L）。");
    lines.push("  BM 仍给出能匹配已知前缀的最短 LFSR；若线性复杂度接近 N/2，多半不是简单 LFSR。");
  }
  lines.push("");

  if (mode === "predict") {
    lines.push("--- 预测（外推 " + predictN + " 个比特） ---");
    if (res.L === 0) {
      lines.push("L=0（全 0 序列），后续恒为 0。");
      lines.push("预测: " + "0".repeat(predictN));
    } else if (bits.length < res.L) {
      lines.push("✗ 已知比特数 (" + bits.length + ") 少于级数 L (" + res.L + ")，状态不足，无法外推。");
    } else {
 // 用整段已知序列作为状态种子，继续递推 predictN 个（避免只用前 L 位而丢失后续演化）
      const full = lfsrGenerate(res.c, bits.slice(0, res.L), bits.length + predictN);
      const predicted = full.slice(bits.length);
      lines.push("预测比特: " + predicted.join(""));
      lines.push("拼接完整序列: " + full.join(""));
    }
    lines.push("");
  }

  lines.push("说明:");
  lines.push("  · 算法: Berlekamp-Massey 求 GF(2) 上最短 LFSR（线性复杂度 L + 连接多项式）。");
  lines.push("  · 反馈递推: s[n] = Σ_{i=1..L} c[i]·s[n-i] (XOR)，抽头即 c(x) 中次数≥1 的项。");
  lines.push("  · 重现校验通过 = 该 LFSR 可完整生成输入；L 接近 N/2 通常意味着不是简单 LFSR。");
  lines.push("  · predict 模式用已知序列作种子继续递推，外推比特与真实 LFSR 后续一致（前提是输入确为 LFSR 输出）。");
  return lines.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "lfsrRecover",
  cat: "analysis",
  name: "LFSR 序列恢复",
  desc: "Berlekamp-Massey 求二元序列最短 LFSR：线性复杂度 L + 反馈多项式 + 抽头 + 初始状态，可外推预测后续比特。输入一串 0/1（容忍空格/换行/逗号分隔）",
  params: [
    {
      key: "mode", label: "模式", type: "select", default: "analyze",
      options: [
        { value: "analyze", label: "分析（求 L / 反馈多项式 / 初始状态）" },
        { value: "predict", label: "预测（分析 + 外推后续比特）" },
      ],
    },
    { key: "predictN", label: "预测比特数（predict 模式）", type: "number", default: 16, placeholder: "默认 16" },
  ],
  run: lfsrRecoverRun,
});

export { berlekampMassey, lfsrGenerate, analyzeLFSR, parseBits, tapsOf, polyToString };
