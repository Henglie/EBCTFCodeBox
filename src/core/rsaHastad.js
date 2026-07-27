/*
 * rsaHastad.js — RSA Håstad 广播攻击（T295，cat:'analysis'，单向 run）。
 *
 * 原理：同一明文 m 用相同 e 和 e 个互质 n_i 加密得 c_i = m^e mod n_i。
 * CRT 合并得 M ≡ c_i (mod n_i)，因 m < min(n_i) 故 m^e < Π n_i
 * M = m^e 精确值；开 e 次整数根得 m。
 *
 * 复用 rsatool.js 的纯算法：crt, iroot。
 * 红线：算法层零 UI 依赖，件内自注册，大数一律 BigInt。
 * Håstad 攻击照经典论文实现，不编造。
 */
import { register } from "./registry.js";
import { crt, iroot } from "./rsatool.js";

/**
 * 尝试将 BigInt 转为 ASCII 字符串（大端字节序）。
 * 仅当所有字节均可打印（0x20-0x7E）时返回字符串，否则返回 null。
 */
function tryBigIntToAscii(n) {
  if (n <= 0n) return null;
  const hex = n.toString(16);
  const padded = hex.length % 2 === 0 ? hex : "0" + hex;
  const bytes = [];
  for (let i = 0; i < padded.length; i += 2) {
    bytes.push(parseInt(padded.slice(i, i + 2), 16));
  }
  if (bytes.every((b) => b >= 0x20 && b <= 0x7e)) {
    return String.fromCharCode(...bytes);
  }
  return null;
}

/**
 * Håstad 广播攻击纯算法。
 * @param {Array<{n: bigint, c: bigint}>} pairs (n_i, c_i) 数组，长度须 ≥ e
 * @param {bigint} e 公钥指数（正整数）
 * @returns {{ok: true, m: bigint, M: bigint} | {ok: false, reason: string}}
 */
export function hastadAttack(pairs, e) {
  if (e <= 0n) return { ok: false, reason: "e 须为正整数" };
  if (pairs.length < Number(e)) {
    return { ok: false, reason: `需要至少 e=${e} 组密文，实际 ${pairs.length} 组` };
  }
  const use = pairs.slice(0, Number(e));
  const residues = use.map((p) => p.c);
  const moduli = use.map((p) => p.n);
  let M;
  try {
    M = crt(residues, moduli);
  } catch (err) {
    return { ok: false, reason: "CRT 合并失败：" + err.message };
  }
  const m = iroot(M, e);
  if (m ** e !== M) {
    return { ok: false, reason: "开根验证失败：m^e ≠ M（明文可能不满足 m < min n_i，或 e 与密文数不匹配）" };
  }
  return { ok: true, m, M };
}

/**
 * 解析输入文本为 (n, c) 对数组。
 * 每行一组 "n,c"（逗号/中文逗号/空白分隔），忽略空行。
 */
function parsePairs(text) {
  const lines = String(text).split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const pairs = [];
  for (const line of lines) {
    const parts = line.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
    if (parts.length < 2) throw new Error(`行 "${line}" 需 n,c 两个值`);
    pairs.push({ n: BigInt(parts[0]), c: BigInt(parts[1]) });
  }
  return pairs;
}

function hastadRun(text, p) {
  const e = BigInt(String((p && p.e) || 3).trim());
  const pairs = parsePairs(text);
  if (pairs.length === 0) throw new Error("输入为空，需每行一组 n,c（逗号分隔）");

  const lines = [];
  lines.push("=== Håstad 广播攻击 ===");
  lines.push(`e = ${e}`);
  lines.push(`密文组数 = ${pairs.length}${pairs.length > Number(e) ? `（使用前 ${e} 组）` : ""}`);
  lines.push("");
  for (let i = 0; i < pairs.length; i++) {
    lines.push(`  [${i}] n=${pairs[i].n}, c=${pairs[i].c}`);
  }
  lines.push("");

  const r = hastadAttack(pairs, e);
  if (!r.ok) {
    lines.push(`✗ ${r.reason}`);
    return lines.join("\n");
  }
  lines.push(`CRT 合并 M = m^e mod (n1·n2·…·n_e) = ${r.M}`);
  lines.push(`✓ 开 ${e} 次整数根得 m = ${r.m}`);
  lines.push(`校验: m^e = ${r.m ** e} (应 = M = ${r.M}) ${r.m ** e === r.M ? "✓" : "✗"}`);
  const ascii = tryBigIntToAscii(r.m);
  if (ascii !== null) {
    lines.push(`ASCII: ${ascii}`);
  }
  return lines.join("\n");
}

register({
  id: "rsaHastad", cat: "crypto", name: "RSA Hastad 广播攻击",
  desc: "同一明文用相同 e 和多个互质 n 加密，CRT 合并后开 e 次根恢复明文",
  params: [{ key: "e", label: "公钥指数 e", type: "number", default: 3 }],
  run: hastadRun,
});

export { hastadRun, parsePairs, tryBigIntToAscii };
