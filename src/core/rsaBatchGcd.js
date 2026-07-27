/*
 * rsaBatchGcd.js — RSA 公共因子分解 / 批量 GCD（T297，cat:'analysis'，单向 run）。
 *
 * 原理：多个 RSA 模数 N_i 两两求 GCD，若 GCD(N_i, N_j) > 1 则找到公共素因子 p
 * 可同时分解 N_i = p·q1 和 N_j = p·q2。CTF 规模 O(k²) 足够。
 *
 * 复用 rsatool.js 的纯算法：bigGcd, parseBigInts。
 * 红线：算法层零 UI 依赖，件内自注册，大数一律 BigInt。
 */
import { register } from "./registry.js";
import { parseBigInts, bigGcd } from "./rsatool.js";

/**
 * 公共因子分解纯算法。
 * @param {bigint[]} ns 模数数组
 * @returns {Array<{i: number, j: number, n1: bigint, n2: bigint, p: bigint, q1: bigint, q2: bigint}>}
 */
export function batchGcdAttack(ns) {
  const results = [];
  const len = ns.length;
  for (let i = 0; i < len; i++) {
    for (let j = i + 1; j < len; j++) {
      const g = bigGcd(ns[i], ns[j]);
      if (g > 1n && g < ns[i] && g < ns[j]) {
        results.push({
          i, j,
          n1: ns[i], n2: ns[j],
          p: g,
          q1: ns[i] / g,
          q2: ns[j] / g,
        });
      }
    }
  }
  return results;
}

function batchGcdRun(text, p) {
  const ns = parseBigInts(text);
  if (ns.length < 2) throw new Error("需至少 2 个模数 N（每行一个或逗号分隔）");

  const lines = [];
  lines.push("=== RSA 公共因子分解（批量 GCD）===");
  lines.push(`模数数量 = ${ns.length}`);
  lines.push("");

  const results = batchGcdAttack(ns);
  if (results.length === 0) {
    lines.push("✗ 未发现公共因子（所有 N 两两互质）");
    return lines.join("\n");
  }
  lines.push(`✓ 发现 ${results.length} 对公共因子：`);
  lines.push("");
  for (const r of results) {
    lines.push(`[${r.i}] & [${r.j}]:`);
    lines.push(`  N1 = ${r.n1}`);
    lines.push(`  N2 = ${r.n2}`);
    lines.push(`  p  = ${r.p}  (公共因子)`);
    lines.push(`  q1 = N1/p = ${r.q1}`);
    lines.push(`  q2 = N2/p = ${r.q2}`);
    lines.push(`  校验: p·q1 = ${r.p * r.q1} (应 = N1) ${r.p * r.q1 === r.n1 ? "✓" : "✗"}`);
    lines.push(`  校验: p·q2 = ${r.p * r.q2} (应 = N2) ${r.p * r.q2 === r.n2 ? "✓" : "✗"}`);
    lines.push("");
  }
  return lines.join("\n");
}

register({
  id: "rsaBatchGcd", cat: "crypto", name: "RSA 公共因子分解（批量 GCD）",
  desc: "多个 RSA 模数 N 两两求 GCD，找公共素因子分解",
  params: [],
  run: batchGcdRun,
});

export { batchGcdRun };
