/*
 * geffe.js — Geffe 生成器 + 相关攻击（cat:'analysis'，run 型）。
 *
 * 定位：CTF crypto 高频。Geffe 生成器是经典 LFSR 组合生成器（Geffe 1973），
 * 3 个 LFSR + 非线性组合函数 f(x1,x2,x3) = x1·x2 ⊕ x2·x3 ⊕ x3。
 * 因 f 与 x1、x3 的相关性 P(f=x1)=P(f=x3)=3/4，可用相关攻击（correlation
 * attack）逐 LFSR 穷举初态恢复——衔接已有 lfsrRecover（Berlekamp-Massey）。
 *
 * 算法：
 * - LFSR 表示：反馈多项式用抽头位置数组（含最高次 L），如 [1,4] = x^4+x+1，L=4。
 *   标准 Fibonacci LFSR 递推：s[n] = Σ_{t∈taps} s[n-t] (GF(2))。
 *   初态 = 前 L 个比特（state[0]=s[0]...state[L-1]=s[L-1]）。
 * - Geffe 组合：f(x1,x2,x3) = x1·x2 ⊕ x2·x3 ⊕ x3。
 *   等价：x2=0 时 f=x3，x2=1 时 f=x1（x2 是选择器）。
 *   相关性：P(f=x1)=3/4，P(f=x3)=3/4，P(f=x2)=1/2（x2 无线性相关性）。
 * - 相关攻击（mode=attack）：
 *   对 LFSR1：穷举 2^L1 个初态，每个生成 N bit，与 keystream 按位比对，
 *   匹配率最高的为候选初态（正确初态匹配率 ≈0.75，错误初态 ≈0.5）。
 *   对 LFSR3：同上。
 *   LFSR2：P(f=x2)=0.5 无相关性，需穷举 2^L2 + 用 L1/L3 验证（bruteL2 开关）。
 *
 * 模式：
 * - generate：已知 3 LFSR（抽头+初态）+ 长度 → 输出 keystream（自验/构造测试用）。
 * - attack：已知 keystream + 3 LFSR 抽头 → 相关攻击恢复 L1/L3 初态，可选穷举 L2。
 *
 * 红线：算法层零 UI 依赖（仅 registry）；零外发纯本地；件内自注册。
 * 不写 detect：纯 0/1 串是多 op 公共入口，analysis 类爆破工具不参与
 * magic 自动预筛（对齐 lfsrRecover / nonogram / spiralMatrix / xorAnalyze）。
 *
 * 契约：register({id, cat:'analysis', name, desc, params, run})。
 *
 * 参考：
 * - Geffe generator（Geffe 1973, IEEE Trans. Inf. Theory IT-19）
 * - Siegenthaler 1984《Correlation-immunity and nonlinear combining functions》
 * - Handbook of Applied Cryptography §6.3（Combining generators & correlation attacks）
 * - ctf-wiki crypto/stream-cipher/fsr（LFSR 组合生成器 + 相关攻击）
 */
import { register } from "./registry.js";

// ============================================================
// 输入解析
// ============================================================
// 抽头位置解析：容忍 "1,4" / "1 4" / "1, 4" / "x^4+x+1" 形式
function parseTaps(text) {
  const s = String(text == null ? "" : text).trim();
  if (!s) return null;
  // 若含 x^ 或 x，按多项式解析
  if (/x/i.test(s)) {
    // 形如 x^4+x+1 或 x^5+x^2+1
    const terms = s.toLowerCase().replace(/\s/g, "").split("+");
    const taps = [];
    for (const t of terms) {
      if (t === "1") continue; // 常数项 1（c[0]，非抽头）
      if (t === "x") taps.push(1);
      else if (t.startsWith("x^")) taps.push(parseInt(t.slice(2), 10));
      else return null;
    }
    return taps.length ? taps.sort((a, b) => a - b) : null;
  }
  // 数字逗号/空格分隔
  const parts = s.split(/[\s,]+/).filter(Boolean);
  const taps = [];
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (!Number.isFinite(n) || n < 1) return null;
    taps.push(n);
  }
  return taps.length ? taps.sort((a, b) => a - b) : null;
}

// 初态解析：容忍 "0001" / "0 0 0 1" / hex（0x..）
function parseInit(text, L) {
  const s = String(text == null ? "" : text).trim();
  if (!s) return null;
  // 纯 0/1 串（含分隔符）
  if (/^[01\s,]+$/.test(s)) {
    const bits = [];
    for (const ch of s) {
      if (ch === "0") bits.push(0);
      else if (ch === "1") bits.push(1);
    }
    if (bits.length === 0) return null;
    if (bits.length < L) return null; // 不足 L 位
    return bits.slice(0, L);
  }
  // hex 形式（0x... 或纯 hex）
  let hex = s;
  if (hex.startsWith("0x") || hex.startsWith("0X")) hex = hex.slice(2);
  if (/^[0-9a-fA-F]+$/.test(hex)) {
    const bits = [];
    for (const ch of hex) {
      const v = parseInt(ch, 16);
      bits.push((v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1);
    }
    if (bits.length < L) return null;
    return bits.slice(bits.length - L); // 取低 L 位
  }
  return null;
}

// 0/1 串解析（keystream 输入）
function parseBits(text) {
  const s = String(text == null ? "" : text);
  const bits = [];
  for (const ch of s) {
    if (ch === "0") bits.push(0);
    else if (ch === "1") bits.push(1);
  }
  return bits;
}

// ============================================================
// LFSR 生成（Fibonacci LFSR）
// ============================================================
/**
 * @param {number[]} taps 抽头位置数组（含最高次 L），如 [1,4] = x^4+x+1
 * @param {number[]} init 初态比特数组，长度 = L = max(taps)
 * @param {number} n 输出比特数
 * @returns {number[]} n bit 输出
 */
function lfsrGenerate(taps, init, n) {
  const L = Math.max(...taps);
  const state = init.slice(0, L);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(state[0]);
    // 新位 = Σ state[L - t] for t in taps
    // state[0]=s[n-L], state[L-t]=s[n-t]
    let bit = 0;
    for (const t of taps) {
      bit ^= state[L - t];
    }
    state.shift();
    state.push(bit);
  }
  return out;
}

// ============================================================
// Geffe 组合函数
// ============================================================
// f(x1,x2,x3) = x1·x2 ⊕ x2·x3 ⊕ x3
function geffeCombine(x1, x2, x3) {
  return (x1 & x2) ^ (x2 & x3) ^ x3;
}

// 生成 Geffe keystream
function geffeKeystream(taps1, init1, taps2, init2, taps3, init3, n) {
  const o1 = lfsrGenerate(taps1, init1, n);
  const o2 = lfsrGenerate(taps2, init2, n);
  const o3 = lfsrGenerate(taps3, init3, n);
  const out = [];
  for (let i = 0; i < n; i++) out.push(geffeCombine(o1[i], o2[i], o3[i]));
  return out;
}

// ============================================================
// 相关攻击
// ============================================================
/**
 * 对单个 LFSR 做相关攻击：穷举所有 2^L 初态，找与 keystream 匹配率最高的。
 * @param {number[]} keystream 已知输出序列
 * @param {number[]} taps LFSR 抽头
 * @param {number} maxBrute 最大可穷举级数（防爆炸）
 * @returns {{bestInit, bestMatch, bestRate, candidates[], exhausted:boolean}}
 */
function correlationAttack(keystream, taps, maxBrute = 22) {
  const L = Math.max(...taps);
  const N = keystream.length;
  if (L > maxBrute) {
    return { bestInit: null, bestMatch: -1, bestRate: 0, candidates: [], exhausted: false, tooLarge: L };
  }
  let bestMatch = -1;
  let bestInit = null;
  const candidates = [];
  const total = 1 << L;
  for (let guess = 0; guess < total; guess++) {
    // 构造初态：guess 的高位在前（与 parseInit 的 bitstring 对齐）
    const init = [];
    for (let i = 0; i < L; i++) init.push((guess >> (L - 1 - i)) & 1);
    const out = lfsrGenerate(taps, init, N);
    let match = 0;
    for (let i = 0; i < N; i++) if (out[i] === keystream[i]) match++;
    if (match > bestMatch) {
      bestMatch = match;
      bestInit = init;
    }
    if (match >= N * 0.7) {
      candidates.push({ init: init.join(""), match, rate: match / N });
    }
  }
  // 候选按匹配率降序
  candidates.sort((a, b) => b.match - a.match);
  return {
    bestInit: bestInit ? bestInit.join("") : null,
    bestMatch,
    bestRate: bestMatch / N,
    candidates: candidates.slice(0, 10),
    exhausted: true,
  };
}

/**
 * 穷举 LFSR2：用已恢复的 L1/L3 验证每个 L2 候选。
 * @returns {string|null} 匹配的 L2 初态 bitstring
 */
function bruteL2(keystream, taps1, init1, taps3, init3, taps2, maxBrute = 22) {
  const L2 = Math.max(...taps2);
  if (L2 > maxBrute) return { ok: false, tooLarge: L2 };
  const N = keystream.length;
  const o1 = lfsrGenerate(taps1, init1, N);
  const o3 = lfsrGenerate(taps3, init3, N);
  const total = 1 << L2;
  for (let guess = 0; guess < total; guess++) {
    const init2 = [];
    for (let i = 0; i < L2; i++) init2.push((guess >> (L2 - 1 - i)) & 1);
    const o2 = lfsrGenerate(taps2, init2, N);
    let ok = true;
    for (let i = 0; i < N; i++) {
      if (geffeCombine(o1[i], o2[i], o3[i]) !== keystream[i]) { ok = false; break; }
    }
    if (ok) return { ok: true, init: init2.join("") };
  }
  return { ok: false, notFound: true };
}

// ============================================================
// 多项式可读式
// ============================================================
function polyToString(taps) {
  const L = Math.max(...taps);
  const terms = [];
  for (const t of [...taps].sort((a, b) => b - a)) {
    if (t === 1) terms.push("x");
    else terms.push("x^" + t);
  }
  terms.push("1"); // 常数项
  return terms.join(" + ") + "  (L=" + L + ")";
}

// ============================================================
// run：主入口
// ============================================================
function geffeRun(text, p) {
  const mode = (p && p.mode) || "generate";
  const lines = [];
  lines.push("=== Geffe 生成器 + 相关攻击 ===");
  lines.push("");

  // 解析 3 个 LFSR 抽头
  const taps1 = parseTaps(p && p.lfsr1Taps);
  const taps2 = parseTaps(p && p.lfsr2Taps);
  const taps3 = parseTaps(p && p.lfsr3Taps);
  if (!taps1 || !taps2 || !taps3) {
    lines.push("✗ LFSR 抽头解析失败。请填反馈多项式抽头，例如 1,4 表示 x^4+x+1（含最高次=级数）。");
    lines.push("  支持格式：\"1,4\" / \"1 4\" / \"x^4+x+1\"");
    return lines.join("\n");
  }
  const L1 = Math.max(...taps1);
  const L2 = Math.max(...taps2);
  const L3 = Math.max(...taps3);
  lines.push("LFSR1 反馈多项式: " + polyToString(taps1));
  lines.push("LFSR2 反馈多项式: " + polyToString(taps2));
  lines.push("LFSR3 反馈多项式: " + polyToString(taps3));
  lines.push("组合函数: f(x1,x2,x3) = x1·x2 ⊕ x2·x3 ⊕ x3  (x2=0→f=x3, x2=1→f=x1)");
  lines.push("相关性: P(f=x1)=3/4, P(f=x3)=3/4, P(f=x2)=1/2");
  lines.push("");

  if (mode === "generate") {
    const init1 = parseInit(p && p.lfsr1Init, L1);
    const init2 = parseInit(p && p.lfsr2Init, L2);
    const init3 = parseInit(p && p.lfsr3Init, L3);
    if (!init1 || !init2 || !init3) {
      lines.push("✗ 初态解析失败。generate 模式需填 3 个 LFSR 初态（bitstring，长度=级数）。");
      lines.push("  例如 L=4 填 0001；也支持 hex（0x..）。");
      return lines.join("\n");
    }
    const length = Math.max(1, Math.min(8192, parseInt((p && p.length) != null ? p.length : 64, 10) || 64));
    lines.push("--- 生成 keystream ---");
    lines.push("LFSR1 初态: " + init1.join(""));
    lines.push("LFSR2 初态: " + init2.join(""));
    lines.push("LFSR3 初态: " + init3.join(""));
    lines.push("输出长度: " + length + " bit");
    const ks = geffeKeystream(taps1, init1, taps2, init2, taps3, init3, length);
    lines.push("keystream: " + ks.join(""));
    lines.push("");
    lines.push("说明: 该 keystream 可作为 attack 模式的输入，验证相关攻击能否还原初态。");
    return lines.join("\n");
  }

  // mode === "attack"
  const keystream = parseBits(text);
  if (keystream.length === 0) {
    lines.push("✗ attack 模式：输入框需填 keystream（0/1 串，容忍空格/换行/逗号分隔）。");
    return lines.join("\n");
  }
  lines.push("--- 相关攻击 ---");
  lines.push("输入 keystream: " + keystream.length + " bit");
  lines.push("");

  // LFSR1 相关攻击
  lines.push("▶ LFSR1 相关攻击（P(f=x1)=3/4，穷举 2^" + L1 + " 初态）:");
  const atk1 = correlationAttack(keystream, taps1);
  if (atk1.tooLarge != null) {
    lines.push("  ✗ L=" + atk1.tooLarge + " 过大（>22），穷举不可行。请手动缩小或用 lfsrRecover 辅助。");
  } else {
    lines.push("  穷举 " + (1 << L1) + " 个初态，最佳匹配率: " + atk1.bestRate.toFixed(4) +
      " (" + atk1.bestMatch + "/" + keystream.length + ")");
    lines.push("  最佳候选初态: " + (atk1.bestInit || "（无）"));
    if (atk1.candidates.length > 1) {
      lines.push("  其他高匹配候选 (率≥0.7):");
      for (const c of atk1.candidates.slice(1, 6)) {
        lines.push("    " + c.init + "  率=" + c.rate.toFixed(4) + " (" + c.match + "/" + keystream.length + ")");
      }
    }
    if (atk1.bestRate < 0.65) {
      lines.push("  ⚠ 最佳匹配率 < 0.65，可能 LFSR1 抽头不对，或 keystream 太短（建议 ≥ 10×L1）。");
    }
  }
  lines.push("");

  // LFSR3 相关攻击
  lines.push("▶ LFSR3 相关攻击（P(f=x3)=3/4，穷举 2^" + L3 + " 初态）:");
  const atk3 = correlationAttack(keystream, taps3);
  if (atk3.tooLarge != null) {
    lines.push("  ✗ L=" + atk3.tooLarge + " 过大（>22），穷举不可行。");
  } else {
    lines.push("  穷举 " + (1 << L3) + " 个初态，最佳匹配率: " + atk3.bestRate.toFixed(4) +
      " (" + atk3.bestMatch + "/" + keystream.length + ")");
    lines.push("  最佳候选初态: " + (atk3.bestInit || "（无）"));
    if (atk3.bestRate < 0.65) {
      lines.push("  ⚠ 最佳匹配率 < 0.65，可能 LFSR3 抽头不对，或 keystream 太短。");
    }
  }
  lines.push("");

  // LFSR2
  lines.push("▶ LFSR2（P(f=x2)=1/2，无线性相关性，需穷举+验证）:");
  const bruteL2Flag = !!(p && p.bruteL2);
  if (!bruteL2Flag) {
    lines.push("  bruteL2 未开启。LFSR2 无法用相关攻击恢复（P=0.5）。");
    lines.push("  如需恢复：开启 bruteL2 参数穷举 2^" + L2 + "（L≤22 时可行），用 L1/L3 验证。");
    lines.push("  或：用 lfsrRecover（Berlekamp-Massey）直接分析 keystream 求等效 LFSR。");
  } else {
    if (atk1.bestInit && atk3.bestInit) {
      lines.push("  穷举 2^" + L2 + " 个初态，用 L1=" + atk1.bestInit + " / L3=" + atk3.bestInit + " 验证...");
      const init1Arr = atk1.bestInit.split("").map(Number);
      const init3Arr = atk3.bestInit.split("").map(Number);
      const res2 = bruteL2(keystream, taps1, init1Arr, taps3, init3Arr, taps2);
      if (res2.ok) {
        lines.push("  ✓ 命中: LFSR2 初态 = " + res2.init);
      } else if (res2.tooLarge != null) {
        lines.push("  ✗ L=" + res2.tooLarge + " 过大（>22），穷举不可行。");
      } else {
        lines.push("  ✗ 全部穷举未命中。可能 L1/L3 初态错（匹配率不足），或 L2 抽头不对。");
      }
    } else {
      lines.push("  ✗ L1/L3 未恢复，无法穷举 L2 验证。");
    }
  }
  lines.push("");

  // 汇总
  lines.push("--- 恢复汇总 ---");
  lines.push("LFSR1 初态: " + (atk1.bestInit || "（未恢复）") +
    (atk1.bestRate ? "  匹配率=" + atk1.bestRate.toFixed(4) : ""));
  lines.push("LFSR3 初态: " + (atk3.bestInit || "（未恢复）") +
    (atk3.bestRate ? "  匹配率=" + atk3.bestRate.toFixed(4) : ""));
  let l2Summary = "（未穷举）";
  if (bruteL2Flag && atk1.bestInit && atk3.bestInit) {
    const init1Arr = atk1.bestInit.split("").map(Number);
    const init3Arr = atk3.bestInit.split("").map(Number);
    const r = bruteL2(keystream, taps1, init1Arr, taps3, init3Arr, taps2);
    l2Summary = r.ok ? r.init : "（穷举未命中）";
  }
  lines.push("LFSR2 初态: " + l2Summary);
  lines.push("");
  lines.push("说明:");
  lines.push("  · 相关攻击原理: f 与 x1/x3 的相关性 P=3/4 > 1/2，正确初态匹配率 ≈0.75，错误初态 ≈0.5。");
  lines.push("  · keystream 越长越准: 统计区分 0.75 vs 0.5 需要足够样本，建议 ≥ 10×max(L1,L3)。");
  lines.push("  · LFSR2 P=0.5 无相关性: 需穷举+L1/L3 验证（bruteL2），或用 lfsrRecover 直接分析。");
  lines.push("  · 级数 L>22 时穷举不可行（2^22≈4M），需用代数攻击或 BM + 已知明文辅助。");
  return lines.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "geffe",
  cat: "analysis",
  name: "Geffe 生成器 / 相关攻击",
  desc: "Geffe 组合生成器（3 LFSR + f=x1x2⊕x2x3⊕x3）双向：generate 生成 keystream，attack 用相关攻击（P=3/4）穷举恢复 L1/L3 初态，可选穷举 L2",
  params: [
    {
      key: "mode", label: "模式", type: "select", default: "generate",
      options: [
        { value: "generate", label: "生成（已知 3 LFSR 抽头+初态 → keystream）" },
        { value: "attack", label: "相关攻击（已知 keystream+3 抽头 → 恢复 L1/L3 初态）" },
      ],
    },
    { key: "lfsr1Taps", label: "LFSR1 抽头", type: "text", default: "1,4", placeholder: "如 1,4 表示 x^4+x+1（含最高次=级数 L）" },
    { key: "lfsr2Taps", label: "LFSR2 抽头", type: "text", default: "2,5", placeholder: "如 2,5 表示 x^5+x^2+1" },
    { key: "lfsr3Taps", label: "LFSR3 抽头", type: "text", default: "1,6", placeholder: "如 1,6 表示 x^6+x+1" },
    { key: "lfsr1Init", label: "LFSR1 初态 (generate)", type: "text", default: "0001", placeholder: "bitstring 长度=L1，如 0001" },
    { key: "lfsr2Init", label: "LFSR2 初态 (generate)", type: "text", default: "00001", placeholder: "bitstring 长度=L2" },
    { key: "lfsr3Init", label: "LFSR3 初态 (generate)", type: "text", default: "000001", placeholder: "bitstring 长度=L3" },
    { key: "length", label: "输出长度 (generate)", type: "number", default: 200, placeholder: "默认 200 bit" },
    { key: "bruteL2", label: "attack 时穷举 L2", type: "bool", default: false },
  ],
  run: geffeRun,
});

export { lfsrGenerate, geffeCombine, geffeKeystream, correlationAttack, bruteL2, parseTaps, parseInit, parseBits, polyToString };
