/*
 * pairing.js — SM9 BN 曲线 R-ate 双线性对内核（GB/T 38635.1-2020 / GM/T 0044.1-2016）。
 *
 * 覆盖：
 * - Fp2（u^2 = -2）→ Fp4（v^2 = u）→ Fp12（w^3 = v）三层扩域塔：四则/逆/共轭/Frobenius(P/P2/P6)/平方；
 * - G1：y^2 = x^3 + 5 mod p（Fp 雅可比坐标）；G2：y^2 = x^3 + 5u mod Fp2（雅可比坐标）点运算；
 * - lineFunctionDouble / lineFunctionAdd（GF(p^2) 线函数 a,b,c）+ mulLine 稀疏乘；
 * - Miller loop（6u+2 的 NAF 循环）+ Q1/minusQ2 收尾 + finalExponentiation（easy + hard, T26(Fp2) 圆周幂）；
 * - H1/H2（SM3 双块计数器，40 字节 mod n）、KDF（SM3 计数器式）、G1/G2/GT 序列化。
 *
 * 结构与常数逐行对照 github.com/emmansun/gmsm（MIT）internal/sm9/bn256：
 * constants.go / curve.go / twist.go / gfp2.go / gfp4.go / gfp12.go / gfp12_exp_u.go / bn_pair.go / gt.go。
 * 存储序照 gmsm：gfP2{x=u系数, y=常数}，gfP4{x=v项, y=常数}，gfP12{x=w^2项, y=w项, z=常数}。
 *
 * 北极星：算法零 UI 依赖、纯函数、导出核心，可被独立摘取当权威源（也为 BLS 铺路）。
 */
import { sm3Bytes } from "./hashExt.js";

// ============================================================
// 数论（BigInt，模运算）
// ============================================================
function mod(a, m) { const r = a % m; return r < 0n ? r + m : r; }
function egcd(a, b) {
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
  const [g, x] = egcd(mod(a, m), m);
  if (g !== 1n) throw new Error(`模逆不存在：gcd = ${g}（≠1）`);
  return mod(x, m);
}

// ============================================================
// 曲线参数（GM/T 0044.1-2016 / GB/T 38635.1-2020；与 gmsm constants.go 一致）
// ============================================================
// u = 0x600000000058f98a
export const SM9_U = 0x600000000058f98an;
// p = 36u^4+36u^3+24u^2+6u+1
export const SM9_P = 0xb640000002a3a6f1d603ab4ff58ec74521f2934b1a7aeedbe56f9b27e351457dn;
// n = 36u^4+36u^3+18u^2+6u+1（注意 18u^2，p 是 24u^2）
export const SM9_N = 0xb640000002a3a6f1d603ab4ff58ec74449f2934b18ea8beee56ee19cd69ecf25n;
const P = SM9_P;
const N = SM9_N;

// 6u+2 = 0x2400000000215d93e 的 NAF（小端 66 项，gmsm constants.go 原样，自检校验其和 = 6u+2）
const SIX_U_PLUS_2_NAF = [
  0, -1, 0, 0, 0, 0, 1, 0, 1, 0, 0, -1, 0, -1, 0, 0, 0, -1, 0, -1,
  0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 1, 0, 0, 1,
];

// Frobenius 常数（gmsm constants.go 原样）
const FROB_CONSTANT = 0x3f23ea58e5720bdb843c6cfa9c08674947c5c86e0ddd04eda91d8354377b698bn; // i^((p-1)/6)，即 w^(p-1)
const V_TO_P_MINUS_1 = 0x6c648de5dc0a3f2cf55acc93ee0baf159f9d411806dc5177f5b21fd3da24d011n; // v^(p-1)
const W2_TO_P_MINUS_1 = 0x0000000000000000f300000002a3a6f2780272354f8b78f4d5fc11967be65334n; // (w^2)^(p-1)，即 w^(p^2-1)
const W2_TO_P2_MINUS_1 = 0x0000000000000000f300000002a3a6f2780272354f8b78f4d5fc11967be65333n; // (w^2)^(p^2-1)
const V_TO_P_MINUS_1_M_W2_TO_P_MINUS_1 = 0x2d40a38cf6983351711e5f99520347cc57d778a9f8ff4c8a4c949c7fa2a96686n; // v^(p-1)·(w^2)^(p-1)
const BETA_TO_NEG_P_PLUS_1_OVER_3 = 0xb640000002a3a6f0e303ab4ff2eb2052a9f02115caef75e70f738991676af24an; // i^(-(p-1)/3)
const BETA_TO_NEG_P_PLUS_1_OVER_2 = 0x49db721a269967c4e0a8debc0783182f82555233139e9d63efbd7b54092c756cn; // i^(-(p-1)/2)
const BETA_TO_NEG_P2_PLUS_1_OVER_3 = 0xb640000002a3a6f0e303ab4ff2eb2052a9f02115caef75e70f738991676af249n; // i^(-(p^2-1)/3)
const BETA_TO_NEG_P2_PLUS_1_OVER_2 = 0xb640000002a3a6f1d603ab4ff58ec74521f2934b1a7aeedbe56f9b27e351457cn; // i^(-(p^2-1)/2)

// G1 生成元（y^2 = x^3 + 5 mod p，gmsm curve.go curveGen）
export const G1_GEN = [
  0x93de051d62bf718ff5ed0704487d01d6e1e4086909dc3280e8c4e4817c66ddddn,
  0x21fe8dda4f21e607631065125c395bbc1c1c00cbfa6024350c464cd70a3ea616n,
];
// G2 生成元（六次扭曲线 y^2 = x^3 + 5u mod Fp2，gmsm twist.go twistGen；{x=u系数, y=常数}）
export const G2_GEN = [
  {
    x: 0x85aef3d078640c98597b6027b441a01ff1dd2c190f5e93c454806c11d8806141n,
    y: 0x3722755292130b08d2aab97fd34ec120ee265948d19c17abf9b7213baf82d65bn,
  },
  {
    x: 0x17509b092e845c1266ba0d262cbee6ed0736a96fa347c8bd856dc76b84ebeb96n,
    y: 0xa7cf28d519be3da65f3170153d278ff247efba98a71a08116215bba5c999a7c7n,
  },
];
// 扭曲线 b = 5u
const TWIST_B = { x: 5n, y: 0n };

// ============================================================
// 字节 ↔ 大整数 / hex（大端）
// ============================================================
export function bytesToBig(bytes) {
  let x = 0n;
  for (const c of bytes) x = (x << 8n) | BigInt(c);
  return x;
}
export function bigToBytes(x, len = 32) {
  const out = new Uint8Array(len);
  let v = x;
  for (let i = len - 1; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
}
export function hexToBytes(s) {
  const clean = String(s == null ? "" : s).replace(/[^0-9a-fA-F]/g, "");
  if (!clean.length) throw new Error("hex 输入为空");
  if (clean.length % 2) throw new Error("hex 长度必须为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
export function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
export function concatBytes(...arrays) {
  let len = 0;
  for (const a of arrays) len += a.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// 随机标量 k ∈ [1, n-1]
export function sm9RandomScalar() {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") throw new Error("当前环境无密码学安全随机源，无法执行 SM9 密钥生成");
  const bytes = new Uint8Array(32);
  while (true) {
    crypto.getRandomValues(bytes);
    const k = bytesToBig(bytes);
    if (k >= 1n && k < N) return k;
  }
}

// ============================================================
// Fp2 = Fp[u]/(u^2+2)，元素 {x, y} 表示 x·u + y（gmsm gfP2 存储序）
// ============================================================
const F2_ZERO = () => ({ x: 0n, y: 0n });
const F2_ONE = () => ({ x: 0n, y: 1n });
function f2Add(a, b) { return { x: mod(a.x + b.x, P), y: mod(a.y + b.y, P) }; }
function f2Sub(a, b) { return { x: mod(a.x - b.x, P), y: mod(a.y - b.y, P) }; }
function f2Neg(a) { return { x: mod(-a.x, P), y: mod(-a.y, P) }; }
function f2Double(a) { return { x: mod(2n * a.x, P), y: mod(2n * a.y, P) }; }
function f2Triple(a) { return { x: mod(3n * a.x, P), y: mod(3n * a.y, P) }; }
// Karatsuba：(a1·u+a0)(b1·u+b0) = (a0b0-2a1b1) + (a0b1+a1b0)·u
function f2Mul(a, b) {
  const v0 = mod(a.y * b.y, P);
  const v1 = mod(a.x * b.x, P);
  return {
    x: mod((a.x + a.y) * (b.x + b.y) - v0 - v1, P),
    y: mod(v0 - 2n * v1, P),
  };
}
function f2MulU1(a) { return { x: a.y, y: mod(-2n * a.x, P) }; } // a·u
function f2Square(a) { return { x: mod(2n * a.x * a.y, P), y: mod(a.y * a.y - 2n * a.x * a.x, P) }; } // (xu+y)^2 = (y^2-2x^2) + 2xy·u
function f2SquareU(a) { return { x: mod(a.y * a.y - 2n * a.x * a.x, P), y: mod(-4n * a.x * a.y, P) }; } // a^2·u
function f2MulScalar(a, s) { return { x: mod(a.x * s, P), y: mod(a.y * s, P) }; }
function f2Conj(a) { return { x: mod(-a.x, P), y: a.y }; }
function f2Eq(a, b) { return mod(a.x, P) === mod(b.x, P) && mod(a.y, P) === mod(b.y, P); }
function f2IsZero(a) { return a.x === 0n && a.y === 0n; }
function f2IsOne(a) { return a.x === 0n && a.y === 1n; }
// 逆元：(xu+y)^-1 = (-xu+y)/(y^2+2x^2)
function f2Inv(a) {
  const t = modInverse(mod(2n * a.x * a.x + a.y * a.y, P), P);
  return { x: mod(-a.x * t, P), y: mod(a.y * t, P) };
}

// ============================================================
// Fp4 = Fp2[v]/(v^2-u)，元素 {x, y} 表示 x·v + y（gmsm gfP4 存储序）
// ============================================================
const F4_ZERO = () => ({ x: F2_ZERO(), y: F2_ZERO() });
const F4_ONE = () => ({ x: F2_ZERO(), y: F2_ONE() });
function f4Add(a, b) { return { x: f2Add(a.x, b.x), y: f2Add(a.y, b.y) }; }
function f4Sub(a, b) { return { x: f2Sub(a.x, b.x), y: f2Sub(a.y, b.y) }; }
function f4Neg(a) { return { x: f2Neg(a.x), y: f2Neg(a.y) }; }
function f4Double(a) { return { x: f2Double(a.x), y: f2Double(a.y) }; }
function f4Triple(a) { return { x: f2Triple(a.x), y: f2Triple(a.y) }; }
function f4MulScalarF2(a, b) { return { x: f2Mul(a.x, b), y: f2Mul(a.y, b) }; }
function f4MulScalarP(a, s) { return { x: f2MulScalar(a.x, s), y: f2MulScalar(a.y, s) }; }
// Karatsuba：(a1·v+a0)(b1·v+b0) = (a0b0 + a1b1·u) + (a0b1+a1b0)·v
function f4Mul(a, b) {
  const v0 = f2Mul(a.y, b.y);
  const v1 = f2Mul(a.x, b.x);
  const cross = f2Sub(f2Sub(f2Mul(f2Add(a.x, a.y), f2Add(b.x, b.y)), v0), v1);
  return { x: cross, y: f2Add(f2MulU1(v1), v0) };
}
// a·(x·v+y)（mulLine 专用稀疏乘，gmsm gfP4.MulNC2）
function f4MulNC2(a, x, y) {
  const v0 = f2Mul(a.y, y);
  const v1 = f2Mul(a.x, x);
  const cross = f2Sub(f2Sub(f2Mul(f2Add(a.x, a.y), f2Add(x, y)), v0), v1);
  return { x: cross, y: f2Add(f2MulU1(v1), v0) };
}
function f4MulV1(a) { return { x: a.y, y: f2MulU1(a.x) }; } // a·v
// (a·b)·v：v 项 = a·b 的常数项，常数项 = a·b 的 v 项 ·u（gmsm gfP4.MulVNC）
function f4MulV(a, b) {
  const v0 = f2Mul(a.y, b.y);
  const v1 = f2Mul(a.x, b.x);
  const cross = f2Sub(f2Sub(f2Mul(f2Add(a.x, a.y), f2Add(b.x, b.y)), v0), v1);
  return { x: f2Add(f2MulU1(v1), v0), y: f2MulU1(cross) };
}
function f4Square(a) { // (xv+y)^2 = (x^2·u + y^2) + 2xy·v
  const s1 = f2SquareU(a.x);
  const s2 = f2Square(a.y);
  return { x: f2Double(f2Mul(a.x, a.y)), y: f2Add(s1, s2) };
}
function f4SquareV(a) { // (a^2)·v：v 项 = x^2·u + y^2，常数项 = 2xy·u
  const s1 = f2SquareU(a.x);
  const s2 = f2Square(a.y);
  return { x: f2Add(s1, s2), y: f2Double(f2MulU1(f2Mul(a.x, a.y))) };
}
function f4Conj(a) { return { x: f2Neg(a.x), y: a.y }; }
function f4Eq(a, b) { return f2Eq(a.x, b.x) && f2Eq(a.y, b.y); }
function f4IsZero(a) { return f2IsZero(a.x) && f2IsZero(a.y); }
function f4IsOne(a) { return f2IsZero(a.x) && f2IsOne(a.y); }
// 逆元：a^-1 = (-xv+y)/(y^2-x^2·u)
function f4Inv(a) {
  const t3 = f2Sub(f2SquareU(a.x), f2Square(a.y));
  const inv = f2Inv(t3);
  return { x: f2Mul(a.x, inv), y: f2Neg(f2Mul(a.y, inv)) };
}
// Frobenius：(y+xv)^p = f(y) + f(x)·v^(p-1)，f 为 Fp2 共轭
function f4Frobenius(a) {
  return { x: f2MulScalar(f2Conj(a.x), V_TO_P_MINUS_1), y: f2Conj(a.y) };
}

// ============================================================
// Fp12 = Fp4[w]/(w^3-v)，元素 {x, y, z} 表示 x·w^2 + y·w + z（gmsm gfP12 存储序）
// ============================================================
const F12_ONE = () => ({ x: F4_ZERO(), y: F4_ZERO(), z: F4_ONE() });
function f12Add(a, b) { return { x: f4Add(a.x, b.x), y: f4Add(a.y, b.y), z: f4Add(a.z, b.z) }; }
function f12Sub(a, b) { return { x: f4Sub(a.x, b.x), y: f4Sub(a.y, b.y), z: f4Sub(a.z, b.z) }; }
function f12Neg(a) { return { x: f4Neg(a.x), y: f4Neg(a.y), z: f4Neg(a.z) }; }
function f12IsOne(e) { return f4IsZero(e.x) && f4IsZero(e.y) && f4IsOne(e.z); }
// 三次 Karatsuba（gmsm gfP12.MulNC）：
// tz = ((ay+ax)(by+bx)-v1-v2)·v + v0；ty = (az+ay)(bz+by)-v0-v1+v2·v；tx = (az+ax)(bz+bx)-v0+v1-v2
function f12Mul(a, b) {
  const v0 = f4Mul(a.z, b.z);
  const v1 = f4Mul(a.y, b.y);
  const v2 = f4Mul(a.x, b.x);
  let t = f4Mul(f4Add(a.y, a.x), f4Add(b.y, b.x));
  t = f4Sub(f4Sub(t, v1), v2);
  const tz = f4Add(f4MulV1(t), v0);
  t = f4Mul(f4Add(a.z, a.y), f4Add(b.z, b.y));
  let ty = f4Sub(f4Sub(t, v0), v1);
  ty = f4Add(ty, f4MulV1(v2));
  t = f4Mul(f4Add(a.z, a.x), f4Add(b.z, b.x));
  let tx = f4Sub(t, v0);
  tx = f4Add(f4Sub(tx, v2), v1);
  return { x: tx, y: ty, z: tz };
}
function f12Square(a) {
  const v0 = f4Square(a.z);
  const v1 = f4Square(a.y);
  const v2 = f4Square(a.x);
  let t = f4Square(f4Add(a.y, a.x));
  t = f4Sub(f4Sub(t, v1), v2);
  const tz = f4Add(f4MulV1(t), v0);
  t = f4Square(f4Add(a.z, a.y));
  let ty = f4Sub(f4Sub(t, v0), v1);
  ty = f4Add(ty, f4MulV1(v2));
  t = f4Square(f4Add(a.z, a.x));
  let tx = f4Sub(t, v0);
  tx = f4Add(f4Sub(tx, v2), v1);
  return { x: tx, y: ty, z: tz };
}
function f12Exp(f, power) {
  let sum = F12_ONE();
  const bits = power.toString(2);
  for (const bit of bits) {
    sum = f12Square(sum);
    if (bit === "1") sum = f12Mul(sum, f);
  }
  return sum;
}
// 逆元（gmsm gfP12.Invert）：A=z^2-xyv，B=x^2v-yz，C=y^2-xz，F=Az+(Cy+Bx)v
function f12Inv(a) {
  const t1 = f4MulV(a.x, a.y);
  const A = f4Sub(f4Square(a.z), t1);
  const B = f4Sub(f4SquareV(a.x), f4Mul(a.y, a.z));
  const C = f4Sub(f4Square(a.y), f4Mul(a.x, a.z));
  let F = f4MulV(C, a.y);
  F = f4Add(F, f4Mul(A, a.z));
  F = f4Add(F, f4MulV(B, a.x));
  F = f4Inv(F);
  return { x: f4Mul(C, F), y: f4Mul(B, F), z: f4Mul(A, F) };
}
// Frobenius（p 次幂，gmsm gfP12.Frobenius）
function f12Frobenius(a) {
  return {
    z: { x: f2MulScalar(f2Conj(a.z.x), V_TO_P_MINUS_1), y: f2Conj(a.z.y) },
    y: { x: f2MulScalar(f2Conj(a.y.x), W2_TO_P2_MINUS_1), y: f2MulScalar(f2Conj(a.y.y), FROB_CONSTANT) },
    x: { x: f2MulScalar(f2Conj(a.x.x), V_TO_P_MINUS_1_M_W2_TO_P_MINUS_1), y: f2MulScalar(f2Conj(a.x.y), W2_TO_P_MINUS_1) },
  };
}
// FrobeniusP2（p^2 次幂）
function f12FrobeniusP2(a) {
  return {
    z: f4Conj(a.z),
    y: f4MulScalarP(f4Conj(a.y), W2_TO_P_MINUS_1),
    x: f4MulScalarP(f4Conj(a.x), W2_TO_P2_MINUS_1),
  };
}
// FrobeniusP6（p^6 次幂）
function f12FrobeniusP6(a) {
  return {
    z: f4Conj(a.z),
    y: f4Neg(f4Conj(a.y)),
    x: f4Conj(a.x),
  };
}
// Fp12/Fp6 共轭（圆分子群内等价于求逆，gmsm gfP12.Conjugate）
function f12Conjugate(a) {
  return {
    z: f4Conj(a.z),
    y: f4Neg(f4Conj(a.y)),
    x: f4Conj(a.x),
  };
}

// ---- 圆分子群专用平方（Granger/Scott PKC2010，gmsm gfP12.Cyclo6SquareNC）----
function cyclo6SquareNC(a) {
  const v0 = f4SquareV(a.x); // x^2·v
  const v1 = f4Square(a.y);
  const v2 = f4Square(a.z);
  const tx = f4Triple(v0);
  const ty = f4Triple(v1);
  const tz = f4Triple(v2);
  const d0 = { x: f2Double(a.x.x), y: f2Neg(f2Double(a.x.y)) }; // 2a.x，常数项取负
  const d1 = { x: f2Neg(f2Double(a.y.x)), y: f2Double(a.y.y) }; // 2a.y，v 项取负
  const d2 = { x: f2Double(a.z.x), y: f2Neg(f2Double(a.z.y)) }; // 2a.z，常数项取负
  return {
    x: f4Add(ty, d0),
    y: f4Add(tx, d1),
    z: f4Add(tz, d2),
  };
}
function cyclo6Squares(a, n) {
  let cur = a;
  for (let i = 0; i < n; i++) cur = cyclo6SquareNC(cur);
  return cur;
}
// 圆分子群 u 次幂（gmsm gfp12_exp_u.go 加法链：10 乘 + 61 平方）
function cyclo6PowToU(x) {
  let t2 = cyclo6SquareNC(x);
  let t1 = cyclo6SquareNC(t2);
  let z = f12Mul(x, t1);
  let t0 = f12Mul(t1, z);
  t2 = f12Mul(t2, t0);
  let t3 = f12Mul(x, t2);
  t3 = cyclo6Squares(t3, 40);
  t3 = f12Mul(t2, t3);
  t3 = cyclo6Squares(t3, 7);
  t2 = f12Mul(t2, t3);
  t1 = f12Mul(t1, t2);
  t1 = cyclo6Squares(t1, 4);
  t0 = f12Mul(t0, t1);
  t0 = cyclo6SquareNC(t0);
  t0 = f12Mul(x, t0);
  t0 = cyclo6Squares(t0, 6);
  z = f12Mul(z, t0);
  z = cyclo6SquareNC(z);
  return z;
}

// ============================================================
// G1：y^2 = x^3 + 5 mod p（雅可比坐标 [X, Y, Z]，x=X/Z^2, y=Y/Z^3）
// ============================================================
export function g1OnCurve(x, y) {
  return mod(y * y, P) === mod(x * x * x + 5n, P);
}
export function g1Double(Pt) {
  const [X1, Y1, Z1] = Pt;
  if (Y1 === 0n) return [0n, 1n, 0n];
  const A = mod(X1 * X1, P);
  const B = mod(Y1 * Y1, P);
  const C = mod(B * B, P);
  const D = mod(2n * (mod((X1 + B) * (X1 + B), P) - A - C), P);
  const E = mod(3n * A, P); // a=0
  const F = mod(E * E, P);
  const X3 = mod(F - 2n * D, P);
  const Y3 = mod(E * (D - X3) - 8n * C, P);
  const Z3 = mod(2n * Y1 * Z1, P);
  return [X3, Y3, Z3];
}
export function g1Add(P1, P2) {
  if (P1[2] === 0n) return P2;
  if (P2[2] === 0n) return P1;
  const [X1, Y1, Z1] = P1, [X2, Y2, Z2] = P2;
  const Z1Z1 = mod(Z1 * Z1, P);
  const Z2Z2 = mod(Z2 * Z2, P);
  const U1 = mod(X1 * Z2Z2, P);
  const U2 = mod(X2 * Z1Z1, P);
  const S1 = mod(Y1 * Z2 * Z2Z2, P);
  const S2 = mod(Y2 * Z1 * Z1Z1, P);
  if (U1 === U2) {
    if (S1 !== S2) return [0n, 1n, 0n];
    return g1Double(P1);
  }
  const H = mod(U2 - U1, P);
  const I = mod(4n * H * H, P);
  const J = mod(H * I, P);
  const rr = mod(2n * (S2 - S1), P);
  const V = mod(U1 * I, P);
  const X3 = mod(rr * rr - J - 2n * V, P);
  const Y3 = mod(rr * (V - X3) - 2n * S1 * J, P);
  const Z3 = mod((mod((Z1 + Z2) * (Z1 + Z2), P) - Z1Z1 - Z2Z2) * H, P);
  return [X3, Y3, Z3];
}
export function g1Mul(k, Pt) {
  let R = [0n, 1n, 0n];
  let Q = [mod(Pt[0], P), mod(Pt[1], P), mod(Pt[2] === 0n ? 1n : Pt[2], P)];
  let kk = mod(k, N);
  while (kk > 0n) {
    if (kk & 1n) R = g1Add(R, Q);
    Q = g1Double(Q);
    kk >>= 1n;
  }
  return R;
}
export function g1Affine(Pt) {
  if (Pt[2] === 0n) return null;
  const zinv = modInverse(Pt[2], P);
  const zinv2 = mod(zinv * zinv, P);
  return [mod(Pt[0] * zinv2, P), mod(Pt[1] * zinv2 * zinv, P)];
}
// 64B 大端 x‖y（gmsm G1.Marshal）；uncompressed 加 04 前缀
export function g1Marshal(pt) {
  return concatBytes(bigToBytes(pt[0]), bigToBytes(pt[1]));
}
export function g1MarshalUncompressed(pt) {
  return concatBytes(new Uint8Array([0x04]), g1Marshal(pt));
}
export function g1Unmarshal(bytes) {
  let d = bytes;
  if (d.length === 65 && d[0] === 0x04) d = d.slice(1);
  if (d.length !== 64) throw new Error("SM9 G1 点须为 64 字节 x‖y（或 65 字节 04 前缀）");
  const x = bytesToBig(d.slice(0, 32));
  const y = bytesToBig(d.slice(32));
  if (x >= P || y >= P) throw new Error("SM9 G1 点坐标越界（≥p）");
  if (!g1OnCurve(x, y)) throw new Error("SM9 G1 点不在曲线 y^2=x^3+5 上");
  return [x, y];
}

// ============================================================
// G2：y^2 = x^3 + 5u mod Fp2（雅可比坐标 [X, Y, Z]，各分量为 Fp2）
// ============================================================
export function g2OnCurve(x, y) {
  return f2Eq(f2Square(y), f2Add(f2Mul(f2Square(x), x), TWIST_B));
}
export function g2Double(Pt) {
  const [X1, Y1, Z1] = Pt;
  if (f2IsZero(Y1)) return [F2_ZERO(), F2_ONE(), F2_ZERO()];
  const A = f2Square(X1);
  const B = f2Square(Y1);
  const C = f2Square(B);
  const D = f2Double(f2Sub(f2Sub(f2Square(f2Add(X1, B)), A), C));
  const E = f2Add(f2Double(A), A); // 3X^2（a=0）
  const F = f2Square(E);
  const X3 = f2Sub(f2Sub(F, D), D);
  const Y3 = f2Sub(f2Mul(E, f2Sub(D, X3)), f2Double(f2Double(f2Double(C))));
  const Z3 = f2Double(f2Mul(Y1, Z1));
  return [X3, Y3, Z3];
}
export function g2Add(P1, P2) {
  if (f2IsZero(P1[2])) return P2;
  if (f2IsZero(P2[2])) return P1;
  const [X1, Y1, Z1] = P1, [X2, Y2, Z2] = P2;
  const Z1Z1 = f2Square(Z1);
  const Z2Z2 = f2Square(Z2);
  const U1 = f2Mul(X1, Z2Z2);
  const U2 = f2Mul(X2, Z1Z1);
  const S1 = f2Mul(f2Mul(Y1, Z2), Z2Z2);
  const S2 = f2Mul(f2Mul(Y2, Z1), Z1Z1);
  if (f2Eq(U1, U2)) {
    if (!f2Eq(S1, S2)) return [F2_ZERO(), F2_ONE(), F2_ZERO()];
    return g2Double(P1);
  }
  const H = f2Sub(U2, U1);
  const I = f2Square(f2Double(H));
  const J = f2Mul(H, I);
  const rr = f2Double(f2Sub(S2, S1));
  const V = f2Mul(U1, I);
  const X3 = f2Sub(f2Sub(f2Square(rr), J), f2Double(V));
  const Y3 = f2Sub(f2Mul(rr, f2Sub(V, X3)), f2Double(f2Mul(S1, J)));
  const Z3 = f2Mul(f2Sub(f2Sub(f2Square(f2Add(Z1, Z2)), Z1Z1), Z2Z2), H);
  return [X3, Y3, Z3];
}
export function g2Mul(k, Pt) {
  let R = [F2_ZERO(), F2_ONE(), F2_ZERO()];
  let Q = [Pt[0], Pt[1], Pt[2]];
  let kk = mod(k, N);
  while (kk > 0n) {
    if (kk & 1n) R = g2Add(R, Q);
    Q = g2Double(Q);
    kk >>= 1n;
  }
  return R;
}
export function g2Affine(Pt) {
  if (f2IsZero(Pt[2])) return null;
  const zinv = f2Inv(Pt[2]);
  const zinv2 = f2Square(zinv);
  return [f2Mul(Pt[0], zinv2), f2Mul(f2Mul(Pt[1], zinv), zinv2)];
}
// 128B：x.u‖x.c‖y.u‖y.c（gmsm G2.Marshal 序）；uncompressed 加 04 前缀
export function g2Marshal(pt) {
  return concatBytes(
    bigToBytes(pt[0].x), bigToBytes(pt[0].y),
    bigToBytes(pt[1].x), bigToBytes(pt[1].y),
  );
}
export function g2MarshalUncompressed(pt) {
  return concatBytes(new Uint8Array([0x04]), g2Marshal(pt));
}
export function g2Unmarshal(bytes) {
  let d = bytes;
  if (d.length === 129 && d[0] === 0x04) d = d.slice(1);
  if (d.length !== 128) throw new Error("SM9 G2 点须为 128 字节（或 129 字节 04 前缀）");
  const x = { x: bytesToBig(d.slice(0, 32)), y: bytesToBig(d.slice(32, 64)) };
  const y = { x: bytesToBig(d.slice(64, 96)), y: bytesToBig(d.slice(96, 128)) };
  for (const c of [x.x, x.y, y.x, y.y]) if (c >= P) throw new Error("SM9 G2 点坐标越界（≥p）");
  if (!g2OnCurve(x, y)) throw new Error("SM9 G2 点不在扭曲线 y^2=x^3+5u 上");
  return [x, y];
}

// ============================================================
// 线函数 + mulLine（gmsm bn_pair.go，"Faster Computation of the Tate Pairing"）
// r：雅可比 twist 点 {x, y, z, t}（t=z^2）；p：仿射 twist 点 {x, y}；q：仿射 G1 点 [xBig, yBig]
// ============================================================
function lineFunctionAdd(r, p, q, r2) {
  const B = f2Mul(p.x, r.t);
  let D = f2Add(p.y, r.z);
  D = f2Mul(f2Sub(f2Sub(f2Square(D), r2), r.t), r.t); // 2Yp·Zr^3
  const H = f2Sub(B, r.x);
  const I = f2Square(H);
  let E = f2Double(I);
  E = f2Double(E);
  const J = f2Mul(H, E);
  let L1 = f2Sub(D, r.y);
  L1 = f2Sub(L1, r.y); // 2YpZr^3 - 2Yr
  const V = f2Mul(r.x, E);
  const x3 = f2Sub(f2Sub(f2Sub(f2Square(L1), J), V), V);
  const z3 = f2Sub(f2Sub(f2Square(f2Add(r.z, H)), r.t), I);
  const t3 = f2Square(z3);
  const y3 = f2Sub(f2Mul(f2Sub(V, x3), L1), f2Double(f2Mul(r.y, J)));
  let t = f2Sub(f2Sub(f2Square(f2Add(p.y, z3)), r2), t3); // 2Yp·z3
  let t2 = f2Double(f2Mul(L1, p.x)); // 2L1·Xp
  const a = f2Sub(t2, t);
  let c = f2Double(f2MulScalar(z3, q[1]));
  let b = f2Double(f2MulScalar(f2Neg(L1), q[0]));
  return [a, b, c, { x: x3, y: y3, z: z3, t: t3 }];
}
function lineFunctionDouble(r, q) {
  const A = f2Square(r.x);
  const B = f2Square(r.y);
  const C = f2Square(B);
  let D = f2Square(f2Add(r.x, B));
  D = f2Double(f2Sub(f2Sub(D, A), C));
  const E = f2Add(f2Double(A), A); // 3Xr^2
  const G = f2Square(E);
  const x3 = f2Sub(f2Sub(G, D), D);
  const z3 = f2Sub(f2Sub(f2Square(f2Add(r.y, r.z)), B), r.t);
  const t3 = f2Square(z3);
  let y3 = f2Mul(f2Sub(D, x3), E);
  let t = f2Double(f2Double(f2Double(C))); // 8Yr^4
  y3 = f2Sub(y3, t);
  t = f2Double(f2Mul(E, r.t)); // 2E·Tr
  const b = f2MulScalar(f2Neg(t), q[0]);
  let a = f2Square(f2Add(r.x, E));
  a = f2Sub(f2Sub(a, A), G);
  t = f2Double(f2Double(B)); // 4B
  a = f2Sub(a, t);
  let c = f2Double(f2MulScalar(f2Mul(z3, r.t), q[1]));
  return [a, b, c, { x: x3, y: y3, z: z3, t: t3 }];
}
// ret·((cv+a) + b·w^2)（gmsm bn_pair.go mulLine 稀疏乘）
function mulLine(ret, a, b, c) {
  let tz = f4MulNC2(ret.z, c, a);
  let t = f4MulV1(f4MulScalarF2(ret.y, b));
  tz = f4Add(tz, t);
  t = f4MulNC2(ret.y, c, a);
  const newY = f4Add(f4MulV1(f4MulScalarF2(ret.x, b)), t);
  t = f4MulNC2(ret.x, c, a);
  const newX = f4Add(f4MulScalarF2(ret.z, b), t);
  return { x: newX, y: newY, z: tz };
}

// ============================================================
// Miller loop（R-ate，gmsm bn_pair.go miller）
// ============================================================
function miller(q, p) {
  let ret = F12_ONE();
  const aAffine = { x: q[0], y: q[1] }; // 仿射 twist 点
  const minusA = { x: q[0], y: f2Neg(q[1]) };
  const bAffine = p; // 仿射 G1 点 [x, y]
  let r = { x: aAffine.x, y: aAffine.y, z: F2_ONE(), t: F2_ONE() };
  let r2 = f2Square(aAffine.y);
  let a, b, c, newR;
  const nafLen = SIX_U_PLUS_2_NAF.length;
  for (let i = nafLen - 1; i > 0; i--) {
    [a, b, c, newR] = lineFunctionDouble(r, bAffine);
    if (i !== nafLen - 1) ret = f12Square(ret);
    ret = mulLine(ret, a, b, c);
    r = newR;
    const ni = SIX_U_PLUS_2_NAF[i - 1];
    if (ni === 0) continue;
    [a, b, c, newR] = lineFunctionAdd(r, ni === 1 ? aAffine : minusA, bAffine, r2);
    ret = mulLine(ret, a, b, c);
    r = newR;
  }
  // Q1 = Frobenius(q) 映回扭曲线；minusQ2 = -FrobeniusP2(q) 映回扭曲线
  const q1 = {
    x: f2MulScalar(f2Conj(aAffine.x), BETA_TO_NEG_P_PLUS_1_OVER_3),
    y: f2MulScalar(f2Conj(aAffine.y), BETA_TO_NEG_P_PLUS_1_OVER_2),
  };
  const minusQ2 = {
    x: f2MulScalar(aAffine.x, BETA_TO_NEG_P2_PLUS_1_OVER_3),
    y: f2MulScalar(f2Neg(aAffine.y), BETA_TO_NEG_P2_PLUS_1_OVER_2),
  };
  r2 = f2Square(q1.y);
  [a, b, c, newR] = lineFunctionAdd(r, q1, bAffine, r2);
  ret = mulLine(ret, a, b, c);
  r = newR;
  r2 = f2Square(minusQ2.y);
  [a, b, c, newR] = lineFunctionAdd(r, minusQ2, bAffine, r2);
  ret = mulLine(ret, a, b, c);
  return ret;
}

// ============================================================
// finalExponentiation（gmsm bn_pair.go：easy (p^6-1)(p^2+1) + hard T26(Fp2)）
// ============================================================
function finalExponentiation(input) {
  let t1 = f12FrobeniusP6(input);
  const inv = f12Inv(input);
  t1 = f12Mul(t1, inv);
  const t2 = f12FrobeniusP2(t1);
  t1 = f12Mul(t1, t2); // in^((p^6-1)·(p^2+1))

  const fp = f12Frobenius(t1);
  const fp2 = f12FrobeniusP2(t1);
  const fp3 = f12Frobenius(fp2);
  const y0 = f12Mul(f12Mul(fp, fp2), fp3);

  const fu = cyclo6PowToU(t1);
  const fu2 = cyclo6PowToU(fu);
  const fu3 = cyclo6PowToU(fu2);
  const fu2p = f12Frobenius(fu2);
  const fu3p = f12Frobenius(fu3);

  const y1 = f12Conjugate(t1);
  const y2 = f12FrobeniusP2(fu2);
  const y3 = f12Conjugate(f12Frobenius(fu));
  const y4 = f12Conjugate(f12Mul(fu, fu2p));
  const y5 = f12Conjugate(fu2);
  const y6 = f12Conjugate(f12Mul(fu3, fu3p));

  let t0 = f12Mul(f12Mul(cyclo6SquareNC(y6), y4), y5);
  let tt1 = f12Mul(f12Mul(y3, y5), t0);
  t0 = f12Mul(t0, y2);
  tt1 = cyclo6SquareNC(tt1);
  tt1 = f12Mul(tt1, t0);
  tt1 = cyclo6SquareNC(tt1);
  t0 = f12Mul(tt1, y1);
  tt1 = f12Mul(tt1, y0);
  t0 = f12Mul(cyclo6SquareNC(t0), tt1);
  return t0;
}

// ============================================================
// 双线性对 e: G1 × G2 → GT（R-ate）
// g1：仿射 G1 点 [x, y]（BigInt）；g2：仿射 G2 点 [x, y]（Fp2）
// ============================================================
export function pairing(g1, g2) {
  if (!g1 || !g2) return F12_ONE();
  const e = miller(g2, g1);
  return finalExponentiation(e);
}

// ============================================================
// GT 运算与序列化（gmsm GT：ScalarMult=幂，Add=乘）
// ============================================================
export function gtMul(a, b) { return f12Mul(a, b); }
export function gtExp(a, k) { return f12Exp(a, mod(k, N)); }
export function gtIsOne(e) { return f12IsOne(e); }
export function gtMarshal(e) {
  // 12×32B：x.xx,x.xy,x.yx,x.yy, y.xx,y.xy,y.yx,y.yy, z.xx,z.xy,z.yx,z.yy（gmsm GT.Marshal 序）
  return concatBytes(
    bigToBytes(e.x.x.x), bigToBytes(e.x.x.y), bigToBytes(e.x.y.x), bigToBytes(e.x.y.y),
    bigToBytes(e.y.x.x), bigToBytes(e.y.x.y), bigToBytes(e.y.y.x), bigToBytes(e.y.y.y),
    bigToBytes(e.z.x.x), bigToBytes(e.z.x.y), bigToBytes(e.z.y.x), bigToBytes(e.z.y.y),
  );
}

// ============================================================
// H1/H2（GB/T 38635.1-2020 / GM/T 0044.1：SM3 双块计数器，前 40 字节 → (Ha mod (n-1)) + 1）
// ============================================================
function sm9Hash(z, mode) {
  const ct = (v) => new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
  const h1 = sm3Bytes(concatBytes(new Uint8Array([mode]), z, ct(1)));
  const h2 = sm3Bytes(concatBytes(new Uint8Array([mode]), z, ct(2)));
  const Ha = bytesToBig(concatBytes(h1, h2).slice(0, 40));
  return (Ha % (N - 1n)) + 1n;
}
export function sm9H1(z) { return sm9Hash(z, 0x01); }
export function sm9H2(z) { return sm9Hash(z, 0x02); }

// ============================================================
// KDF（SM3 计数器式，gmsm sm3.Kdf：klen 单位=字节，ct 从 1 起 4B 大端）
// ============================================================
export function sm9Kdf(z, klenBytes) {
  if (!Number.isSafeInteger(klenBytes) || klenBytes <= 0) throw new Error("SM9 KDF 长度需为正整数（字节）");
  const nBlocks = Math.ceil(klenBytes / 32);
  const chunks = [];
  for (let i = 1; i <= nBlocks; i++) {
    const ct = new Uint8Array(4);
    ct[0] = (i >>> 24) & 0xff; ct[1] = (i >>> 16) & 0xff; ct[2] = (i >>> 8) & 0xff; ct[3] = i & 0xff;
    chunks.push(sm3Bytes(concatBytes(z, ct)));
  }
  return concatBytes(...chunks).slice(0, klenBytes);
}

// ============================================================
// 加载自检（常数多项式 + NAF + 生成元 + 塔内乘逆往返；不符即抛错）
// ============================================================
(function selfCheck() {
  const u = SM9_U;
  const poly = (c4, c3, c2, c1) => (((c4 * u + c3) * u + c2) * u + c1) * u + 1n;
  if (poly(36n, 36n, 24n, 6n) !== P) throw new Error("SM9 自检失败：p ≠ 36u^4+36u^3+24u^2+6u+1");
  if (poly(36n, 36n, 18n, 6n) !== N) throw new Error("SM9 自检失败：n ≠ 36u^4+36u^3+18u^2+6u+1");
  // NAF 校验：sum(naf[i]·2^i) == 6u+2
  let nafSum = 0n;
  for (let i = SIX_U_PLUS_2_NAF.length - 1; i >= 0; i--) nafSum = nafSum * 2n + BigInt(SIX_U_PLUS_2_NAF[i]);
  if (nafSum !== 6n * u + 2n) throw new Error("SM9 自检失败：sixUPlus2NAF 与 6u+2 不符");
  if (!g1OnCurve(G1_GEN[0], G1_GEN[1])) throw new Error("SM9 自检失败：G1 生成元不在曲线上");
  if (!g2OnCurve(G2_GEN[0], G2_GEN[1])) throw new Error("SM9 自检失败：G2 生成元不在扭曲线上");
  // [n]G = ∞
  const g1n = g1Affine(g1Mul(N, [G1_GEN[0], G1_GEN[1], 1n]));
  if (g1n !== null) throw new Error("SM9 自检失败：[n]G1 ≠ ∞");
  const g2n = g2Affine(g2Mul(N, [G2_GEN[0], G2_GEN[1], F2_ONE()]));
  if (g2n !== null) throw new Error("SM9 自检失败：[n]G2 ≠ ∞");
  // 塔内乘逆往返
  const a2 = { x: 0x1234567890abcdefn, y: 0xfedcba0987654321n };
  if (!f2Eq(f2Mul(f2Inv(a2), a2), F2_ONE())) throw new Error("SM9 自检失败：Fp2 乘逆往返");
  const a4 = { x: a2, y: f2Square(a2) };
  if (!f4Eq(f4Mul(f4Inv(a4), a4), F4_ONE())) throw new Error("SM9 自检失败：Fp4 乘逆往返");
  const a12 = { x: a4, y: f4Square(a4), z: f4Mul(a4, a4) };
  const r12 = f12Mul(f12Inv(a12), a12);
  if (!f12IsOne(r12)) throw new Error("SM9 自检失败：Fp12 乘逆往返");
})();
