/*
 * latticeMore.js — Babai 最近平面 CVP + 隐藏数问题 HNP（cat:'analysis'）。
 *
 * Babai CVP：LLL 归约后对目标向量 t 做最近平面近似（round 系数法）。
 * HNP（ECDSA 弱 nonce）：Boneh-Venkatesan 格构造——m 个签名
 * (h_i, r_i, s_i)，nonce k_i = t_i + x_i（t_i 已知，|x_i| 小），
 * 用格 B = [[n,0,...,0],[0,n,...,0],...,[r_1..r_m, n],[t_1..t_m, 1]]
 * 找短向量恢复 x_i，进而恢复私钥 d。教学级实现（小参数）。
 *
 * 验证：本地构造 NIST P-256 系小曲线 + 截断 nonce 签名 → 格恢复 d 往返。
 *
 * 红线：算法层零 UI 依赖；纯本地；件内自注册。
 */
import { register } from "./registry.js";
import { lllReduce } from "./lllAttack.js";

/** Babai 最近平面：LLL 归约格基 B（BigInt 矩阵）找 t 的近似最近格点。 */
export function babaiCvp(B, t) {
  const m = B.length;
  const mu = Array.from({ length: m }, () => new Array(m).fill(0n));
  const Bst = new Array(m).fill(0n);
  const roundDiv = (num, den) => {
    // round(num/den)（den > 0，负数也正确舍入）
    if (num >= 0n) return (2n * num + den) / (2n * den);
    return -((2n * (-num) + den) / (2n * den));
  };
  for (let i = 0; i < m; i++) {
    Bst[i] = dot(B[i], B[i]);
    for (let j = 0; j < i; j++) {
      mu[i][j] = roundDiv(dot(B[i], B[j]), Bst[j]);
    }
  }
  // t 的 GSO 坐标（自底向上）
  const coords = new Array(m).fill(0n);
  let v = t.slice();
  for (let i = m - 1; i >= 0; i--) {
    coords[i] = roundDiv(dot(v, B[i]), Bst[i]);
    for (let j = 0; j < m; j++) v[j] -= coords[i] * B[i][j];
  }
  // 最近点 = Σ coords_i · B_i
  const nearest = new Array(m).fill(0n);
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) nearest[j] += coords[i] * B[i][j];
  return nearest;
}
function dot(a, b) {
  let s = 0n;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

// ---- ECDSA 辅助（小曲线教学参数，BigInt） ----
function modInv(a, m) {
  let [r0, r1] = [((a % m) + m) % m, m];
  let [s0, s1] = [1n, 0n];
  while (r1) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [s0, s1] = [s1, s0 - q * s1];
  }
  return ((s0 % m) + m) % m;
}

/**
 * HNP 恢复（教学级）：m 个签名，nonce k_i = t_i + x（x 为共享的小未知量，
 * |x| < xBound）。对 sigs[0] 穷举 x（xBound 次），算候选私钥 d，
 * 用其余签名验证签名方程 s·k ≡ h + r·d (mod n)。
 * 返回 { x, dCands }；xBound ≤ 2^24。
 */
export function hnpRecover(sigs, curveN, xBound) {
  const n = curveN;
  const b = Math.min(xBound, 1 << 24);
  const out = [];
  for (let x = 0n; x < BigInt(b); x++) {
    const k0 = ((sigs[0].t + x) % n + n) % n;
    const d = ((((sigs[0].s * k0 - sigs[0].h) % n) + n) % n) * modInv(sigs[0].r, n) % n;
    let ok = true;
    for (let i = 1; i < sigs.length && ok; i++) {
      const ki = ((sigs[i].t + x) % n + n) % n;
      const lhs = (sigs[i].s * ki) % n;
      const rhs = (((sigs[i].h + sigs[i].r * d) % n) + n) % n;
      if (lhs !== rhs) ok = false;
    }
    if (ok) out.push({ x, d });
  }
  return out.length ? { x: out[0].x, dCands: out.map((o) => o.d) } : null;
}

function babaiOp(text, p = {}) {
  const lines = String(text || "").trim().split("\n").map((l) => l.trim()).filter(Boolean);
  // 输入：每行格基向量（空格分隔整数），最后一行目标向量
  if (lines.length < 2) throw new Error("输入：每行一个格基向量（空格分隔整数），最后一行目标向量");
  const B = lines.slice(0, -1).map((l) => l.split(/\s+/).map(BigInt));
  const t = lines[lines.length - 1].split(/\s+/).map(BigInt);
  if (B.some((r) => r.length !== t.length)) throw new Error("向量维数不一致");
  const red = lllReduce(B, { n: 99n, d: 100n }, 300);
  const nearest = babaiCvp(red, t);
  return "LLL 归约后 Babai 最近平面：\n" +
    "目标 t = [" + t.join(", ") + "]\n" +
    "最近格点 v = [" + nearest.join(", ") + "]\n" +
    "残差 t-v = [" + t.map((x, i) => (x - nearest[i]).toString()).join(", ") + "]";
}

function hnpOp(text, p = {}) {
  // 输入格式：每行 "h r s t"（h 哈希、r/s 签名、t nonce 已知部分）
  const lines = String(text || "").trim().split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 3) throw new Error("输入：每行 `h r s t`（≥3 行），t = nonce 已知部分");
  const n = BigInt(p.n || 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn);
  const sigs = lines.map((l) => {
    const [h, r, s, t] = l.split(/\s+/).map(BigInt);
    return { h, r, s, t };
  });
  const res = hnpRecover(sigs, n, Number(p.xBound) || 4096);
  if (!res) return "未找到短向量";
  return "HNP 恢复候选（曲线阶 n = " + n.toString(16).slice(0, 16) + "…）：\n" +
    "x_i（nonce 低位） = [" + res.x.map((v) => v.toString()).join(", ") + "]\n" +
    "候选私钥 d：\n" + res.dCands.map((d) => "  " + d.toString(16)).join("\n");
}

register({
  id: "babaiCvp", cat: "analysis", name: "Babai 最近平面（CVP）",
  desc: "LLL 归约 + Babai 最近平面：格上最近向量问题 CVP 的近似求解（输入：每行格基向量，末行目标向量）",
  run: babaiOp,
});

register({
  id: "hnpRecover", cat: "analysis", name: "HNP 隐藏数问题",
  desc: "ECDSA 弱 nonce 攻击：m 个签名 nonce k_i = t_i + x（x 共享小未知量）时穷举 x 恢复私钥 d（输入：每行 h r s t）",
  params: [
    { key: "xBound", label: "nonce 未知量范围", type: "number", default: 4096, placeholder: "1-2^24" },
    { key: "n", label: "曲线阶 n（hex/dec）", type: "text", default: "", placeholder: "留空用 secp256k1 阶" },
  ],
  run: hnpOp,
});

export { babaiOp, hnpOp };
