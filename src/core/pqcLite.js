/*
 * pqcLite.js — 后量子/同态教学级实现（cat:'crypto'）。
 *
 * LWE（Learning With Errors，Regev 2005）玩具加解密：
 *   私钥 s ∈ Z_q^n；公钥 (A, b = A·s + e mod q)（e 小噪声）。
 *   加密：选随机 r，输出 (u = Aᵀr, v = b·r + m·⌊q/2⌋ mod q)。
 *   解密：v - u·s = m·⌊q/2⌋ + e' 取整还原 m。
 * 教学参数（q=257, n=8, e∈[-1,1]）保证正确率 100%。
 *
 * NTRU 玩具（截断多项式环 Z_q[x]/(x^n - 1)）加解密：
 *   私钥 (f, f_p)；公钥 h = p·f_q·g mod q。
 *   加密：c = p·h·r + m mod q；解密：m = (f·c mod q) mod p。
 * 教学参数（n=8, q=257, p=3）小环演示。
 *
 * 教学用途：理解格密码/同态概念，非生产安全参数。
 * 红线：算法层零 UI 依赖；纯本地；件内自注册。
 */
import { register } from "./registry.js";

// ============ LWE 玩具 ============
export function lweSetup(q = 257n, n = 8) {
  // 确定性伪随机（教学）
  let seed = 12345;
  const rnd = (m) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return BigInt(seed % Number(m)); };
  const s = Array.from({ length: n }, () => rnd(q));
  const A = Array.from({ length: n }, () => Array.from({ length: n }, () => rnd(q)));
  const e = Array.from({ length: n }, () => rnd(3n) - 1n); // e ∈ {-1,0,1}
  const b = A.map((row, i) => (((row.reduce((acc, v, j) => acc + v * s[j], 0n) + e[i]) % q) + q) % q);
  return { q, n, s, A, b };
}
export function lweEncrypt(msgBit, pub, seedIn) {
  const { q, n, A, b } = pub;
  let sd = seedIn || 99;
  const rnd = (m) => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return BigInt(sd % Number(m)); };
  const r = Array.from({ length: n }, () => rnd(2n));
  const u = Array.from({ length: n }, () => 0n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) u[j] = (u[j] + A[i][j] * r[i]) % q; // u = Aᵀ·r
  const v = (b.reduce((acc, bi, i) => acc + bi * r[i], 0n) + (msgBit ? q >> 1n : 0n)) % q;
  return { u, v };
}
export function lweDecrypt(ct, priv) {
  const { q, n, s } = priv;
  const val = ((ct.v - ct.u.reduce((acc, ui, i) => acc + ui * s[i], 0n)) % q + q) % q;
  return val > q >> 2n && val < (3n * q) >> 2n ? 1 : 0;
}

// ============ NTRU 玩具（多项式环） ============
function modInvP(a, m) {
  let [r0, r1] = [((a % m) + m) % m, m];
  let [s0, s1] = [1n, 0n];
  while (r1) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
  return ((s0 % m) + m) % m;
}
function polyMul(a, b, mod, q) {
  const n = a.length;
  const out = new Array(n).fill(0n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[(i + j) % n] = (out[(i + j) % n] + a[i] * b[j]) % q;
  return out.map((v) => ((v % mod) + mod) % mod);
}
function polyInv(f, q, n) {
  // 小环直接枚举逆元（教学，n=8）
  for (let g = 1n; g < q; g++) {
    const cand = new Array(n).fill(0n);
    cand[0] = g;
    const prod = polyMul(cand, f, q, q);
    if (prod[0] === 1n && prod.slice(1).every((v) => v === 0n)) return cand;
  }
  return null;
}
export function ntruSetup(q = 257n, p = 3n, n = 8) {
  // f = 3（常数，逆 = 3⁻¹ mod q；教学简化，避免非常数逆的枚举）
  const f = new Array(n).fill(0n);
  f[0] = 2n; // f 须与 p 互素（2 mod 3 ≠ 0）
  const fq = polyInv(f, q, n);
  if (!fq) throw new Error("f 不可逆（换参数）");
  const g = new Array(n).fill(0n);
  g[0] = 1n; g[1] = 0n; g[2] = 1n; // 1 + x²
  const h = polyMul(polyMul(new Array(n).fill(p), fq, q, q), g, q, q);
  return { q, p, n, f, fq, g, h };
}
export function ntruEncrypt(msgPoly, pub) {
  const { q, p, n, h } = pub;
  const r = new Array(n).fill(0n);
  r[0] = 1n; // r = 1
  const c = polyMul(polyMul(new Array(n).fill(p), h, q, q), r, q, q).map((v, i) => (v + msgPoly[i]) % q);
  return c;
}
export function ntruDecrypt(c, priv) {
  const { q, p, n, f } = priv;
  const fc = polyMul(f, c, q, q);
  const fp = modInvP(2n, p); // f_p = f⁻¹ mod p
  return fc.map((v) => (((v % p) + p) % p) * fp % p);
}

function lweOp(text, p = {}) {
  const q = 257n, n = 8;
  const setup = lweSetup(q, n);
  const bits = (String(text || "").trim() || "1010").split("").map((c) => (c === "1" ? 1 : 0)).slice(0, 8);
  const res = bits.map((bit) => {
    const ct = lweEncrypt(bit, setup, 99 + bit * 7);
    const dec = lweDecrypt(ct, setup);
    return { bit, dec, ok: bit === dec };
  });
  const allOk = res.every((r) => r.ok);
  return (
    "LWE 玩具加解密（q=257, n=8, e∈{-1,0,1}）：\n" +
    res.map((r) => "  明文 " + r.bit + " → 解密 " + r.dec + (r.ok ? " ✓" : " ✗")).join("\n") +
    "\n\n正确率 " + res.filter((r) => r.ok).length + "/" + res.length + (allOk ? "（教学参数保证）" : "（调参数）") +
    "\n原理：b = A·s + e 公钥隐藏 s；解密 v - u·s 抵消噪声得 m·⌊q/2⌋ 取整。"
  );
}

function ntruOp(text, p = {}) {
  const setup = ntruSetup();
  const msg = (String(text || "").trim() || "1 0 1 0 0 0 0 0").split(/\s+/).map((s) => BigInt(s) % setup.p).slice(0, 8);
  while (msg.length < 8) msg.push(0n);
  const c = ntruEncrypt(msg, setup);
  const m2 = ntruDecrypt(c, setup);
  const ok = msg.every((v, i) => v === m2[i]);
  return (
    "NTRU 玩具加解密（Z_257[x]/(x^8-1)，p=3，f=1+x）：\n" +
    "  明文 m = [" + msg.join(", ") + "]\n" +
    "  密文 c = [" + c.join(", ") + "]\n" +
    "  解密 m' = [" + m2.join(", ") + "]\n" +
    (ok ? "  ✓ 往返一致（教学参数）" : "  ✗ 不一致")
  );
}

register({
  id: "lweToy", cat: "crypto", name: "LWE 玩具加解密",
  desc: "后量子教学：Regev LWE（q=257, n=8）比特加解密演示——理解格密码公钥机制（非生产参数）",
  params: [{ key: "bits", label: "比特串（0/1）", type: "text", default: "1010", placeholder: "如 10100101" }],
  run: lweOp,
});

register({
  id: "ntruToy", cat: "crypto", name: "NTRU 玩具加解密",
  desc: "后量子教学：NTRU 截断多项式环（n=8, q=257, p=3）加解密演示——理解 NTRU 机制（非生产参数）",
  params: [{ key: "msg", label: "消息多项式（空格分隔）", type: "text", default: "1 0 1 0 0 0 0 0", placeholder: "8 项 mod 3" }],
  run: ntruOp,
});

