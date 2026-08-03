/*
 * xorshiftRecover.js — xorshift PRNG 状态恢复 / 预测（analysis, run 单向）。
 *
 * 算法照 George Marsaglia《Xorshift RNGs》(J. Stat. Soft. 2003) 的标准变体实现，不编造：
 *
 *   xorshift32（Marsaglia 三元组 13,17,5）：
 *     x ^= x << 13; x ^= x >> 17; x ^= x << 5;  返回 x（32bit）
 *   xorshift64（三元组 13,7,17）：
 *     x ^= x << 13; x ^= x >> 7;  x ^= x << 17;  返回 x（64bit）
 *   xorshift128（4 字 32bit 版，常量 11,8,19）：
 *     t = x ^ (x << 11); x=y; y=z; z=w; w = (w ^ (w>>19)) ^ (t ^ (t>>8)); 返回 w
 *
 * 关键事实：
 * - 单寄存器版（32/64）的每次输出即为其内部状态本身 → 拿到 1 个完整输出即知当前状态，
 *   直接迭代 step 可预测后续；且每个 step 都是双射（异或移位可逐位求逆），故可把状态
 *   反推回「初始种子」（第一个观测输出之前的状态）。
 * - xorshift128 的状态为 (x,y,z,w) 四字；因 x←y←z←w←新w 逐次左移，产出 4 个连续输出
 *   o1,o2,o3,o4 后，内部状态恰为 (o1,o2,o3,o4)（可逐步推导验证）。故拿到 ≥4 个连续输出，
 *   取末 4 个即当前状态，迭代 step 预测后续。
 *
 * 逐位求逆（异或移位的逆）：
 *   y = x ^ (x << s)：低 s 位 x==y，其余 x[i] = y[i] ^ x[i-s]，自低位向高位重建。
 *   y = x ^ (x >> s)：高 s 位 x==y，其余 x[i] = y[i] ^ x[i+s]，自高位向低位重建。
 *
 * 红线：
 * - 算法照 Marsaglia 标准变体，不编造。
 * - 纯本地零外发；core 层零 UI 依赖（仅 registry）；纯 JS BigInt。
 * - 交付前跑自验：已知 seed 生成序列 → 喂输出 → 恢复状态/种子 → 预测下一个匹配。
 *
 * 契约：register({ id:"xorshiftRecover", cat:"analysis", name, desc, params, run })。
 */
import { register } from "./registry.js";

// ============================================================
// 位运算工具（BigInt，n-bit）
// ============================================================
function maskBits(bits) {
  return (1n << BigInt(bits)) - 1n;
}

// 前向：y = x ^ (x << s)  （n-bit）
function xorLeft(x, s, bits) {
  const M = maskBits(bits);
  return (x ^ ((x << BigInt(s)) & M)) & M;
}
// 前向：y = x ^ (x >> s)  （右移无进位丢失，天然 n-bit 内）
function xorRight(x, s) {
  return x ^ (x >> BigInt(s));
}

// 逆：给定 y = x ^ (x << s) 求 x（自低位向高位）
function invXorLeft(y, s, bits) {
  let x = 0n;
  for (let i = 0; i < bits; i++) {
    let xb = (y >> BigInt(i)) & 1n;
    if (i >= s) xb ^= (x >> BigInt(i - s)) & 1n;
    x |= xb << BigInt(i);
  }
  return x & maskBits(bits);
}
// 逆：给定 y = x ^ (x >> s) 求 x（自高位向低位）
function invXorRight(y, s, bits) {
  let x = 0n;
  for (let i = bits - 1; i >= 0; i--) {
    let xb = (y >> BigInt(i)) & 1n;
    if (i + s < bits) xb ^= (x >> BigInt(i + s)) & 1n;
    x |= xb << BigInt(i);
  }
  return x & maskBits(bits);
}

// ============================================================
// 各变体 step / 逆 step
// ============================================================
const VARIANTS = {
  xorshift32: {
    bits: 32,
    minSamples: 1,
    step(x) {
      x = xorLeft(x, 13, 32);
      x = xorRight(x, 17);
      x = xorLeft(x, 5, 32);
      return x & maskBits(32);
    },
    // 逆序撤销：先撤 <<5，再撤 >>17，最后撤 <<13
    inv(x) {
      x = invXorLeft(x, 5, 32);
      x = invXorRight(x, 17, 32);
      x = invXorLeft(x, 13, 32);
      return x & maskBits(32);
    },
  },
  xorshift64: {
    bits: 64,
    minSamples: 1,
    step(x) {
      x = xorLeft(x, 13, 64);
      x = xorRight(x, 7);
      x = xorLeft(x, 17, 64);
      return x & maskBits(64);
    },
    inv(x) {
      x = invXorLeft(x, 17, 64);
      x = invXorRight(x, 7, 64);
      x = invXorLeft(x, 13, 64);
      return x & maskBits(64);
    },
  },
  // xorshift128：状态 (x,y,z,w)，输出 w。无单值逆，靠 4 连续输出即状态。
  xorshift128: {
    bits: 32,
    minSamples: 4,
    // 输入 4 字状态，输出 [新状态, 输出值]
    step128(st) {
      const M = maskBits(32);
      let [x, y, z, w] = st;
      const t = (x ^ ((x << 11n) & M)) & M;
      const nx = y, ny = z, nz = w;
      const nw = ((w ^ (w >> 19n)) ^ (t ^ (t >> 8n))) & M;
      return [[nx, ny, nz, nw], nw];
    },
  },
};

// ============================================================
// 解析观测输出
// ============================================================
function parseSamples(text, radix) {
  const toks = String(text || "")
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!toks.length) throw new Error("请在输入框填入观测到的连续 PRNG 输出（十进制或十六进制，空白/逗号分隔）");
  const out = [];
  for (const tok of toks) {
    let v;
    try {
      if (radix === "hex") {
        v = BigInt(/^0x/i.test(tok) ? tok : "0x" + tok);
      } else if (/^0x/i.test(tok)) {
        v = BigInt(tok);
      } else {
        v = BigInt(tok);
      }
    } catch {
      throw new Error(`无法解析为整数：${tok}`);
    }
    if (v < 0n) throw new Error(`输出不能为负：${tok}`);
    out.push(v);
  }
  return out;
}

function hex(v, bits) {
  return "0x" + v.toString(16).padStart(bits / 4, "0");
}

// ============================================================
// run
// ============================================================
function xorshiftRecoverRun(text, p = {}) {
  const variant = (p && p.variant) || "xorshift32";
  const V = VARIANTS[variant];
  if (!V) throw new Error(`未知变体：${variant}`);
  const radix = (p && p.radix) || "dec";
  let count = parseInt(p && p.count, 10);
  if (!Number.isFinite(count) || count < 0) count = 5;
  if (count > 1000) count = 1000;

  const samples = parseSamples(text, radix);
  const M = maskBits(V.bits);
  for (const s of samples) {
    if (s > M) throw new Error(`输出 ${s} 超出 ${V.bits}bit 范围（该变体每个输出应为 ≤ ${V.bits} 位无符号整数）`);
  }
  if (samples.length < V.minSamples) {
    throw new Error(`${variant} 需要至少 ${V.minSamples} 个连续输出才能恢复状态（当前 ${samples.length} 个）`);
  }

  const lines = [];
  lines.push(`=== xorshift 状态恢复 / 预测 ===`);
  lines.push(`变体 = ${variant}（${V.bits}bit）`);
  lines.push(`观测输出 = ${samples.length} 个`);
  lines.push("");

  if (variant === "xorshift128") {
    // 末 4 个连续输出即当前状态 (x,y,z,w)
    const st = samples.slice(-4);
    lines.push(`当前内部状态 (x,y,z,w) = 末 4 个连续输出：`);
    lines.push(`  x = ${st[0]}  ${hex(st[0], 32)}`);
    lines.push(`  y = ${st[1]}  ${hex(st[1], 32)}`);
    lines.push(`  z = ${st[2]}  ${hex(st[2], 32)}`);
    lines.push(`  w = ${st[3]}  ${hex(st[3], 32)}`);
    lines.push("");
    // 自检：若观测 >4 个，用前 4 个推进应能重现其余观测
    if (samples.length > 4) {
      let s = samples.slice(0, 4);
      let ok = true;
      for (let i = 4; i < samples.length; i++) {
        const [ns, out] = V.step128(s);
        if (out !== samples[i]) { ok = false; break; }
        s = ns;
      }
      lines.push(`一致性自检（前 4 输出推进重现其余观测）：${ok ? "✓ 通过" : "✗ 不一致（可能非连续或非此变体）"}`);
      lines.push("");
    }
    lines.push(`预测后续 ${count} 个输出：`);
    let s = st.slice();
    for (let i = 1; i <= count; i++) {
      const [ns, out] = V.step128(s);
      lines.push(`  #${i}: ${out}  ${hex(out, 32)}`);
      s = ns;
    }
    return lines.join("\n");
  }

  // 单寄存器版（32/64）：输出即状态
  const cur = samples[samples.length - 1];
  lines.push(`当前内部状态 = 最后一个观测输出（单寄存器版输出即状态）：`);
  lines.push(`  state = ${cur}  ${hex(cur, V.bits)}`);
  lines.push("");

  // 反推初始种子：把第一个观测输出再逆一次 step，得其「前一个状态」= 生成第一个输出所用的种子
  const seed = V.inv(samples[0]);
  lines.push(`恢复初始种子（第一个观测输出之前的状态）：`);
  lines.push(`  seed = ${seed}  ${hex(seed, V.bits)}`);
  lines.push("");

  // 一致性自检：从 seed 迭代 step 应逐一重现全部观测输出
  {
    let s = seed;
    let ok = true;
    for (let i = 0; i < samples.length; i++) {
      s = V.step(s);
      if (s !== samples[i]) { ok = false; break; }
    }
    lines.push(`一致性自检（seed 迭代重现全部观测）：${ok ? "✓ 通过" : "✗ 不一致（输入可能非连续或非此变体）"}`);
    lines.push("");
  }

  lines.push(`预测后续 ${count} 个输出：`);
  let s = cur;
  for (let i = 1; i <= count; i++) {
    s = V.step(s);
    lines.push(`  #${i}: ${s}  ${hex(s, V.bits)}`);
  }
  return lines.join("\n");
}

register({
  id: "xorshiftRecover",
  cat: "analysis",
  name: "xorshift 状态恢复",
  desc: "Marsaglia xorshift32/64/128 PRNG：喂入连续输出，恢复内部状态（单寄存器版反推初始种子）并预测后续输出。32/64 需 1 个输出，128 需 4 个连续输出。CTF 高频。",
  params: [
    {
      key: "variant", label: "变体", type: "select", default: "xorshift32",
      options: [
        { value: "xorshift32", label: "xorshift32 (13,17,5)" },
        { value: "xorshift64", label: "xorshift64 (13,7,17)" },
        { value: "xorshift128", label: "xorshift128 (11,8,19)" },
      ],
    },
    {
      key: "radix", label: "输入进制", type: "select", default: "dec",
      options: [
        { value: "dec", label: "十进制" },
        { value: "hex", label: "十六进制" },
      ],
    },
    { key: "count", label: "预测后续个数", type: "number", default: 5, placeholder: "预测多少个未来输出（0..1000）" },
  ],
  run: xorshiftRecoverRun,
});

export { xorshiftRecoverRun, VARIANTS, invXorLeft, invXorRight };
