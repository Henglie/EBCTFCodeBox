/*
 * ecdhP.js — 素数域椭圆曲线 ECDH 共享密钥（短魏尔斯特拉斯形式）。
 *
 * 覆盖 X25519（Montgomery，见 x25519.js）之外的短 Weierstrass 曲线：
 *   secp256k1（SEC 2 v2.0 §2.4.1）/ P-256 / P-384 / P-521（FIPS 186-4 D.1.2）。
 *
 * 算法（ANSI X9.63 / SEC 1 v2.0 §3.3.1 口径）：
 *   共享点 S = d · Q_peer（对方公钥点），共享密钥 = S 的 x 坐标
 *   （定宽 byteLen(p) 大端输出；RFC 5903 §5：「shared secret value is girx」）。
 *   dA·QB == dB·QA（双方私钥互换一致）。
 *
 * 红线：纯 BigInt 本地计算，零外发；不取随机字节；曲线域参数复用 ecdsa.js
 *       权威常量（与 ECDSA 同源，不另抄一份防漂移）。
 */

import { register } from "./registry.js";
import { CURVES, parsePoint, fmtUncompressed } from "./ecdsa.js";

// ---- 素数域点乘（Jacobian 坐标，避免每次点加做模逆） ----
function mod(a, p) { const r = a % p; return r < 0n ? r + p : r; }

function jDouble(X, Y, Z, c) {
  const { p, a } = c;
  if (Y === 0n) return [0n, 0n, 0n];
  const YY = mod(Y * Y, p);
  const S = mod(4n * X * YY, p);
  const M = mod(3n * X * X + a * Z * Z * Z * Z, p); // a24 优化不适用一般 a
  const X3 = mod(M * M - 2n * S, p);
  const Y3 = mod(M * (S - X3) - 8n * YY * YY, p);
  const Z3 = mod(2n * Y * Z, p);
  return [X3, Y3, Z3];
}

function jAdd(X1, Y1, Z1, X2, Y2, Z2, c) {
  const { p } = c;
  if (Z1 === 0n) return [X2, Y2, Z2];
  if (Z2 === 0n) return [X1, Y1, Z1];
  const Z1Z1 = mod(Z1 * Z1, p);
  const Z2Z2 = mod(Z2 * Z2, p);
  const U1 = mod(X1 * Z2Z2, p);
  const U2 = mod(X2 * Z1Z1, p);
  const S1 = mod(Y1 * Z2 * Z2Z2, p);
  const S2 = mod(Y2 * Z1 * Z1Z1, p);
  if (U1 === U2) {
    if (S1 !== S2) return [0n, 0n, 0n]; // 相加为无穷远点
    return jDouble(X1, Y1, Z1, c);
  }
  const H = mod(U2 - U1, p);
  const r = mod(S2 - S1, p);
  const HH = mod(H * H, p);
  const HHH = mod(H * HH, p);
  const V = mod(U1 * HH, p);
  const X3 = mod(r * r - HHH - 2n * V, p);
  const Y3 = mod(r * (V - X3) - S1 * HHH, p);
  const Z3 = mod(Z1 * Z2 * H, p);
  return [X3, Y3, Z3];
}

/** k · P（仿射入、仿射出；k ≥ 0；P=null 返回 null）。 */
function scalarMul(P, k, c) {
  if (P == null || k === 0n) return null;
  let R = [0n, 0n, 0n]; // 无穷远点
  let Q = [P[0], P[1], 1n];
  let e = k;
  while (e > 0n) {
    if (e & 1n) R = jAdd(R[0], R[1], R[2], Q[0], Q[1], Q[2], c);
    Q = jDouble(Q[0], Q[1], Q[2], c);
    e >>= 1n;
  }
  if (R[2] === 0n) return null;
  const zInv = modPowP(R[2], c.p - 2n, c.p);
  const zInv2 = mod(zInv * zInv, c.p);
  return [mod(R[0] * zInv2, c.p), mod(R[1] * zInv2 * zInv, c.p)];
}

/** ECDH 核心共享点：S = d · Q（导出供验证/复用；Q 须已在曲线上）。 */
export function ecdhSharedPoint(d, Q, curveKey = "secp256k1") {
  const c = CURVES[curveKey];
  if (!c) throw new Error(`未知曲线：${curveKey}`);
  return scalarMul(Q, d, c);
}

function modPowP(b, e, p) {
  let r = 1n;
  b = mod(b, p);
  while (e > 0n) { if (e & 1n) r = (r * b) % p; e >>= 1n; b = (b * b) % p; }
  return r;
}

// ---- 输出定宽 hex（byteLen(p) 大端） ----
function fixedHex(v, p) {
  const bl = (BigInt(p).toString(2).length + 7) >> 3;
  return v.toString(16).padStart(bl * 2, "0");
}

// ---- 私钥解析（十进制 / 0x hex） ----
function parsePriv(raw, label) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) throw new Error(`缺少参数：${label}`);
  let v;
  if (/^0x/i.test(s)) {
    if (!/^[0-9a-f]+$/i.test(s.slice(2)) || s.slice(2).length === 0) throw new Error(`${label} 非法：0x 后须为 hex`);
    v = BigInt(s);
  } else if (/^[0-9]+$/.test(s)) {
    v = BigInt(s);
  } else {
    throw new Error(`${label} 非法：须为十进制或 0x 前缀 hex`);
  }
  if (v <= 0n) throw new Error(`${label} 须为正整数`);
  return v;
}

const CURVE_OPTIONS = [
  { value: "secp256k1", label: "secp256k1（比特币/以太坊，SEC 2 v2）" },
  { value: "p256", label: "P-256 / secp256r1（NIST）" },
  { value: "p384", label: "P-384 / secp384r1（NIST）" },
  { value: "p521", label: "P-521 / secp521r1（NIST）" },
];

register({
  id: "ecdhP",
  cat: "asym",
  name: "ECDH 共享密钥（素数域曲线）",
  desc: "素数域 ECDH（SEC 1 v2.0 §3.3.1 / RFC 5903 口径）：我方私钥 d + 对方公钥点 Q → 共享点 d·Q 的 x 坐标即共享密钥。曲线 secp256k1/P-256/P-384/P-521。X25519/X448 见各自独立 op。RFC 5903 §8 P-256/384/521 官方向量逐字节验证",
  params: [
    { key: "curve", label: "曲线", type: "select", default: "secp256k1", options: CURVE_OPTIONS },
    { key: "priv", label: "我方私钥 d", type: "text", default: "", placeholder: "十进制或 0x hex（可用 ECDSA 密钥生成档产出）" },
    { key: "peerPub", label: "对方公钥点 Q", type: "text", default: "04…", placeholder: "04‖X‖Y / 02|03‖X / X‖Y（hex，与 eccCalc 同格式）" },
    { key: "mode", label: "验证模式", type: "select", default: "single", options: [
      { value: "single", label: "单侧（我方私钥 + 对方公钥）" },
      { value: "both", label: "双侧互验（另填对方私钥，验证 dA·QB == dB·QA）" },
    ] },
    { key: "peerPriv", label: "对方私钥（both 模式用）", type: "text", default: "", placeholder: "十进制或 0x hex" },
  ],
  run: (_text, p) => {
    const c = CURVES[String((p && p.curve) || "secp256k1")];
    if (!c) throw new Error(`未知曲线：${p.curve}（可选 secp256k1 / p256 / p384 / p521）`);
    const d = parsePriv(p && p.priv, "我方私钥 d");
    if (d >= c.n) throw new Error(`私钥 d 须在 [1, n-1] 内（n 为曲线阶，当前曲线 n = ${c.n}）`);
    const Q = parsePoint(p && p.peerPub, c, "对方公钥点 Q");
    if (Q == null) throw new Error("对方公钥点不能是无穷远点");
    const S = scalarMul(Q, d, c);
    if (S == null) throw new Error("标量乘结果为无穷远点（输入异常）");
    const lines = [
      "=== ECDH 共享密钥（素数域）===",
      `曲线：${c.name}（${c.std}）`,
      `我方私钥 d = ${d.toString(10)}`,
      `对方公钥 Q = ${fmtUncompressed(Q, c)}`,
      "",
      `共享密钥（x 坐标，${(BigInt(c.p).toString(2).length + 7) >> 3} 字节大端）= ${fixedHex(S[0], c.p)}`,
      `共享点（参考） = ${fmtUncompressed(S, c)}`,
    ];
    if ((p && p.mode) === "both") {
      const dB = parsePriv(p && p.peerPriv, "对方私钥（both 模式）");
      if (dB >= c.n) throw new Error(`对方私钥须在 [1, n-1] 内（当前曲线 n = ${c.n}）`);
      // 由我方私钥推我方公钥，再走对方视角
      const myPub = scalarMul([c.Gx, c.Gy], d, c);
      const S2 = scalarMul(myPub, dB, c);
      if (S2 == null) throw new Error("对方视角标量乘为无穷远点（输入异常）");
      const a = fixedHex(S[0], c.p), b = fixedHex(S2[0], c.p);
      lines.push("", `对方视角 dB·Q_A x 坐标 = ${b}`, a === b
        ? "✓ 两侧一致（ECDH 成立：dA·QB == dB·QA）"
        : "✗ 两侧不一致（输入参数不配对，请检查）");
    } else {
      lines.push("", "说明：共享密钥 = 共享点 x 坐标（SEC 1 v2.0 / RFC 5903 口径）；" +
        "要验证双方一致，可切换「双侧互验」模式，或交换角色再跑一次。");
    }
    return lines.join("\n");
  },
});
