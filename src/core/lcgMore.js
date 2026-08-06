/*
 * lcgMore.js — RANDU 弱 LCG 演示 + 截断 LCG 种子恢复（cat:'analysis'）。
 *
 * RANDU：x_{n+1} = (65539 · x_n) mod 2^31，IBM 经典弱随机数，
 * 三维空间全落 15 个平面（教学演示：输出序列 + 周期性说明）。
 *
 * 截断 LCG：x_{n+1} = (a·x_n + c) mod 2^32，输出只给高 k 位
 * （低 32-k 位未知）。恢复：对首输出穷举低未知位（2^(32-k)），
 * 用后续输出校验连续性。CTF 常见（如 Python random 取高位）。
 *
 * 红线：算法层零 UI 依赖；纯本地；件内自注册。
 */
import { register } from "./registry.js";

const M32 = 0x100000000;

/** RANDU 序列（x0 种子，n 项）。 */
export function randuSeq(x0, n) {
  let x = BigInt(x0) & 0x7fffffffn;
  const out = [];
  for (let i = 0; i < n; i++) {
    x = (x * 65539n) % 0x80000000n;
    out.push(Number(x));
  }
  return out;
}

/**
 * 截断 LCG 种子恢复：mod 2^32、multiplier a、increment c、
 * 已知连续输出 truncated（每项仅高 k 位）。返回所有候选种子 x0
 * （首个输出的前驱状态，含真种子）。
 */
export function truncatedLcgRecover(truncated, a, c, k) {
  if (k < 1 || k > 32) throw new Error("k 须 1-32（已知高位位数）");
  const unknown = 32 - k;
  if (unknown > 24) throw new Error("未知低位过多（≤24 位，2^24 穷举）");
  const aN = BigInt(a >>> 0), cN = BigInt(c >>> 0);
  const t = truncated.map((v) => BigInt(v >>> 0));
  const found = [];
  const total = 1 << unknown;
  // a 的模逆（奇数乘数必有逆）
  const inv = (() => {
    let [r0, r1] = [aN, 0x100000000n];
    let [s0, s1] = [1n, 0n];
    while (r1) {
      const q = r0 / r1;
      [r0, r1] = [r1, r0 - q * r1];
      [s0, s1] = [s1, s0 - q * s1];
    }
    return ((s0 % 0x100000000n) + 0x100000000n) % 0x100000000n;
  })();
  for (let low = 0; low < total; low++) {
    // 首个完整状态 = 首项高 k 位 << unknown | low
    const x1 = (t[0] << BigInt(unknown)) | BigInt(low);
    let x = x1;
    let ok = true;
    for (let i = 1; i < t.length; i++) {
      x = (aN * x + cN) & 0xffffffffn;
      const hi = x >> BigInt(unknown);
      if (hi !== t[i]) { ok = false; break; }
    }
    if (ok) {
      // 回退一步：x0 = (x1 - c) · a⁻¹ mod 2^32
      const x0 = (((x1 - cN + 0x100000000n) % 0x100000000n) * inv) & 0xffffffffn;
      found.push(Number(x0));
    }
  }
  return found;
}

function randuOp(text, p = {}) {
  const x0 = Number(p.seed ?? 1) >>> 0;
  const n = Math.max(2, Math.min(20, Number(p.count) || 10));
  const seq = randuSeq(x0, n);
  return "RANDU（x = 65539·x mod 2^31）序列 " + n + " 项：\n" + seq.join(" ") +
    "\n\n周期 2^29（教学演示：三维空间全落 15 个平面，勿用于密码）";
}

function truncOp(text, p = {}) {
  const lines = String(text || "").trim().split(/\s+/).map(Number);
  if (lines.length < 2 || lines.some((v) => !Number.isFinite(v))) throw new Error("输入：连续截断输出（空格分隔，至少 2 项）");
  const a = Number(p.a ?? 1664525) >>> 0;
  const c = Number(p.c ?? 1013904223) >>> 0;
  const k = Math.max(1, Math.min(32, Number(p.k ?? 24)));
  const t0 = Date.now();
  const found = truncatedLcgRecover(lines, a, c, k);
  const ms = Date.now() - t0;
  if (!found.length) return "未找到候选种子（a=" + a + " c=" + c + " k=" + k + "，2^" + (32 - k) + " 穷举完成，耗时 " + ms + "ms）";
  return "候选种子 " + found.length + " 个（a=" + a + " c=" + c + " k=" + k + "，耗时 " + ms + "ms）：\n" +
    found.map((s) => s >>> 0).join("\n") +
    "\n\n验证：以每个种子重跑 LCG，应复现输入序列的高 " + k + " 位。";
}

register({
  id: "randu", cat: "analysis", name: "RANDU 弱 LCG",
  desc: "RANDU（x=65539·x mod 2^31）教学演示：生成序列 + 周期性说明，经典三维空间 15 平面弱随机数",
  params: [
    { key: "seed", label: "种子 x0", type: "number", default: 1 },
    { key: "count", label: "项数", type: "number", default: 10 },
  ],
  run: randuOp,
});

register({
  id: "truncLcgRecover", cat: "analysis", name: "截断 LCG 种子恢复",
  desc: "mod 2^32 截断 LCG（x=a·x+c）：已知连续输出高位（k 位）穷举低未知位恢复种子（未知 ≤24 位）",
  params: [
    { key: "a", label: "乘数 a", type: "number", default: 1664525 },
    { key: "c", label: "增量 c", type: "number", default: 1013904223 },
    { key: "k", label: "已知高位位数", type: "number", default: 24 },
  ],
  run: truncOp,
});

export { randuOp, truncOp };
