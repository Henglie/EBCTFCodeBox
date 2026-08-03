/*
 * ecdsaReuseK.js — ECDSA nonce(k) 重用攻击（crypto, run）。
 *
 * CTF 经典：同一私钥 d 用同一随机数 k 签两条不同消息，签名共享 r（因 r 只依赖 k）。
 * 由两组 (r, s1, z1) / (r, s2, z2) 与阶 n 可恢复 k 与私钥 d，纯数论（不需 EC 群运算）：
 *
 *   ECDSA 签名：s = k⁻¹·(z + r·d) mod n
 *   两式相减：s1 - s2 = k⁻¹·(z1 - z2) mod n
 *     ⇒ k = (z1 - z2)·(s1 - s2)⁻¹ mod n
 *   回代：d = (s1·k - z1)·r⁻¹ mod n
 *
 * s 可能有两个候选（因 s 与 -s mod n 同样合法，低-s 规范化），本 op 对 (s1,s2) 与
 * (s1, n-s2)、(n-s1, s2)、(n-s1, n-s2) 四种符号组合都尝试，若提供公钥则挑选校验通过者。
 *
 * 参数（run）：
 *   curve   预设曲线（提供 n；secp256k1 / secp256r1(P-256) / 自定义 n）
 *   n       自定义阶（curve=custom 时用）
 *   r, s1, s2, z1, z2  签名与消息 hash 整数（十进制或 0x 十六进制）
 *   （可选）Gx,Gy,p,a + Qx,Qy：提供曲线点与公钥 Q 时反向校验 d·G == Q（secp256k1/P-256 已内置）
 *
 * 内置 secp256k1 / secp256r1 域参数用于可选校验（EC 点乘：雅可比坐标 + 二进制展开）。
 *
 * 红线：算法照 ECDSA 标准（FIPS 186 / SEC1）；纯本地零外发；core 层零 UI 依赖（仅 registry）；
 *   纯 JS BigInt。交付前自造 secp256k1 签名（同 k 签两条）→ 攻击还原 d 匹配私钥验证。
 *
 * 契约：register({ id:"ecdsaReuseK", cat:"crypto", name, desc, params, run })。
 */
import { register } from "./registry.js";

// ============================================================
// 数论工具（BigInt）
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
  if (g !== 1n) throw new Error(`模逆不存在：gcd(${a}, ${m}) = ${g}（≠1）`);
  return mod(x, m);
}

function parseBig(s, label) {
  const t = String(s == null ? "" : s).trim();
  if (!t) throw new Error(`缺少参数 ${label}`);
  try { return BigInt(/^0x/i.test(t) ? t : t); }
  catch { throw new Error(`参数 ${label} 不是合法整数：${t}`); }
}

// ============================================================
// 内置曲线域参数（用于可选公钥校验）
// ============================================================
const CURVES = {
  secp256k1: {
    p: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn,
    a: 0n,
    b: 7n,
    n: 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n,
    Gx: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
    Gy: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
  },
  secp256r1: { // NIST P-256
    p: 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn,
    a: 0xffffffff00000001000000000000000000000000fffffffffffffffffffffffcn,
    b: 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn,
    n: 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n,
    Gx: 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n,
    Gy: 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n,
  },
};

// ============================================================
// 椭圆曲线点运算（雅可比坐标，短 Weierstrass y²=x³+ax+b mod p）
// ============================================================
function ecPointDouble(P, a, p) {
  const [X1, Y1, Z1] = P;
  if (Y1 === 0n) return [0n, 1n, 0n];
  const A = mod(X1 * X1, p);
  const B = mod(Y1 * Y1, p);
  const C = mod(B * B, p);
  const Z1sq = mod(Z1 * Z1, p);
  let D = mod(2n * (mod((X1 + B) * (X1 + B), p) - A - C), p);
  const E = mod(3n * A + a * mod(Z1sq * Z1sq, p), p);
  const F = mod(E * E, p);
  const X3 = mod(F - 2n * D, p);
  const Y3 = mod(E * (D - X3) - 8n * C, p);
  const Z3 = mod(2n * Y1 * Z1, p);
  return [X3, Y3, Z3];
}
function ecPointAdd(P, Q, a, p) {
  if (P[2] === 0n) return Q;
  if (Q[2] === 0n) return P;
  const [X1, Y1, Z1] = P, [X2, Y2, Z2] = Q;
  const Z1Z1 = mod(Z1 * Z1, p);
  const Z2Z2 = mod(Z2 * Z2, p);
  const U1 = mod(X1 * Z2Z2, p);
  const U2 = mod(X2 * Z1Z1, p);
  const S1 = mod(Y1 * Z2 * Z2Z2, p);
  const S2 = mod(Y2 * Z1 * Z1Z1, p);
  if (U1 === U2) {
    if (S1 !== S2) return [0n, 1n, 0n]; // 无穷远点
    return ecPointDouble(P, a, p);
  }
  const H = mod(U2 - U1, p);
  const I = mod((2n * H) * (2n * H), p);
  const J = mod(H * I, p);
  const rr = mod(2n * (S2 - S1), p);
  const V = mod(U1 * I, p);
  const X3 = mod(rr * rr - J - 2n * V, p);
  const Y3 = mod(rr * (V - X3) - 2n * S1 * J, p);
  const Z3 = mod((mod((Z1 + Z2) * (Z1 + Z2), p) - Z1Z1 - Z2Z2) * H, p);
  return [X3, Y3, Z3];
}
function ecMul(k, Px, Py, a, p) {
  let R = [0n, 1n, 0n]; // 无穷远点
  let Q = [mod(Px, p), mod(Py, p), 1n];
  let kk = k;
  while (kk > 0n) {
    if (kk & 1n) R = ecPointAdd(R, Q, a, p);
    Q = ecPointDouble(Q, a, p);
    kk >>= 1n;
  }
  return R;
}
function ecToAffine(P, p) {
  if (P[2] === 0n) return null; // 无穷远点
  const zinv = modInverse(P[2], p);
  const zinv2 = mod(zinv * zinv, p);
  const x = mod(P[0] * zinv2, p);
  const y = mod(P[1] * zinv2 * zinv, p);
  return [x, y];
}

// ============================================================
// 攻击：由 (r, s1, s2, z1, z2, n) 恢复 k 与 d
// ============================================================
function recoverK(z1, z2, s1, s2, n) {
  const num = mod(z1 - z2, n);
  const den = mod(s1 - s2, n);
  if (den === 0n) throw new Error("s1 - s2 ≡ 0 (mod n)，无法求逆（两签名可能相同或 n 有误）");
  return mod(num * modInverse(den, n), n);
}
function recoverD(z1, s1, r, k, n) {
  const rInv = modInverse(mod(r, n), n);
  return mod((s1 * k - z1) * rInv, n);
}

// ============================================================
// run
// ============================================================
function ecdsaReuseKRun(text, p = {}) {
  const curveName = (p && p.curve) || "secp256k1";
  let n, curveParams = null;
  if (curveName === "custom") {
    n = parseBig(p && p.n, "n（自定义阶）");
  } else {
    curveParams = CURVES[curveName];
    if (!curveParams) throw new Error(`未知曲线：${curveName}`);
    n = curveParams.n;
  }

  const r = parseBig(p && p.r, "r");
  const s1 = parseBig(p && p.s1, "s1");
  const s2 = parseBig(p && p.s2, "s2");
  const z1 = parseBig(p && p.z1, "z1");
  const z2 = parseBig(p && p.z2, "z2");

  if (mod(r, n) === 0n) throw new Error("r ≡ 0 (mod n)，非法签名");

  const lines = [];
  lines.push("=== ECDSA nonce(k) 重用攻击 ===");
  lines.push("前提：两条签名使用同一私钥 d 与同一随机数 k（表现为 r1 == r2）");
  lines.push("公式：k=(z1-z2)/(s1-s2) mod n,  d=(s1·k - z1)/r mod n");
  lines.push("");
  lines.push(`曲线 = ${curveName}`);
  lines.push(`n  = ${n}`);
  lines.push(`r  = ${r}`);
  lines.push(`z1 = ${z1}, s1 = ${s1}`);
  lines.push(`z2 = ${z2}, s2 = ${s2}`);
  lines.push("");

  // 可选公钥校验点
  let Qx = null, Qy = null, hasQ = false;
  const qxRaw = p && p.Qx != null && String(p.Qx).trim();
  const qyRaw = p && p.Qy != null && String(p.Qy).trim();
  if (qxRaw && qyRaw) { Qx = parseBig(qxRaw, "Qx"); Qy = parseBig(qyRaw, "Qy"); hasQ = true; }

  // 若自定义曲线且要校验，需 p/a/Gx/Gy
  let ecP = null, ecA = null, ecGx = null, ecGy = null, canVerify = false;
  if (hasQ) {
    if (curveParams) {
      ecP = curveParams.p; ecA = curveParams.a; ecGx = curveParams.Gx; ecGy = curveParams.Gy;
      canVerify = true;
    } else {
      const pRaw = p && p.p != null && String(p.p).trim();
      const gxRaw = p && p.Gx != null && String(p.Gx).trim();
      const gyRaw = p && p.Gy != null && String(p.Gy).trim();
      if (pRaw && gxRaw && gyRaw) {
        ecP = parseBig(pRaw, "p"); ecA = parseBig((p && p.a) || "0", "a");
        ecGx = parseBig(gxRaw, "Gx"); ecGy = parseBig(gyRaw, "Gy");
        canVerify = true;
      }
    }
  }

  // s 的符号歧义（低-s 规范化）→ 尝试 4 组符号组合
  const combos = [
    [s1, s2, "(+s1,+s2)"],
    [s1, mod(-s2, n), "(+s1,-s2)"],
    [mod(-s1, n), s2, "(-s1,+s2)"],
    [mod(-s1, n), mod(-s2, n), "(-s1,-s2)"],
  ];

  let chosen = null;
  const attempts = [];
  for (const [S1, S2, tag] of combos) {
    try {
      const den = mod(S1 - S2, n);
      if (den === 0n) { attempts.push({ tag, err: "s1-s2≡0" }); continue; }
      const k = recoverK(z1, z2, S1, S2, n);
      const d = recoverD(z1, S1, r, k, n);
      let ok = null;
      if (canVerify) {
        const Q = ecToAffine(ecMul(d, ecGx, ecGy, ecA, ecP), ecP);
        ok = Q && Q[0] === mod(Qx, ecP) && Q[1] === mod(Qy, ecP);
      }
      attempts.push({ tag, k, d, ok });
      if (canVerify) { if (ok && !chosen) chosen = { tag, k, d }; }
      else if (!chosen) chosen = { tag, k, d };
    } catch (e) {
      attempts.push({ tag, err: e.message });
    }
  }

  if (canVerify) {
    lines.push("符号组合尝试（含公钥 d·G == Q 校验）：");
    for (const a of attempts) {
      if (a.err) lines.push(`  ${a.tag}: 跳过（${a.err}）`);
      else lines.push(`  ${a.tag}: d=${a.d}  ${a.ok ? "✓ 校验通过" : "✗ 校验失败"}`);
    }
    lines.push("");
    if (chosen) {
      lines.push(`✓ 命中符号组合 ${chosen.tag}`);
      lines.push(`✓ 恢复出 nonce k = ${chosen.k}`);
      lines.push(`✓ 恢复出私钥 d = ${chosen.d}`);
      lines.push(`  d (hex) = 0x${chosen.d.toString(16)}`);
    } else {
      lines.push("✗ 四种符号组合均未通过公钥校验。检查 r/s/z/曲线是否正确，或两签名的 k 实际不同。");
    }
  } else {
    // 无公钥：直接给主组合结果 + 列出符号候选
    const main = attempts.find((a) => a.tag === "(+s1,+s2)" && !a.err);
    if (!main) throw new Error("主组合计算失败：" + (attempts[0] && attempts[0].err));
    lines.push(`k = (z1-z2)·(s1-s2)⁻¹ mod n = ${main.k}`);
    lines.push(`d = (s1·k - z1)·r⁻¹ mod n = ${main.d}`);
    lines.push(`d (hex) = 0x${main.d.toString(16)}`);
    lines.push("");
    lines.push("提示：ECDSA 的 s 有低-s 规范化歧义。若上面的 d 验证不通过公钥，请尝试以下符号候选，");
    lines.push("      或填入公钥 Qx/Qy（secp256k1/P-256 内置曲线参数）让本工具自动挑选正确组合：");
    for (const a of attempts) {
      if (!a.err) lines.push(`  ${a.tag}: d = ${a.d}`);
    }
  }

  return lines.join("\n");
}

register({
  id: "ecdsaReuseK",
  cat: "crypto",
  name: "ECDSA nonce 重用攻击",
  desc: "ECDSA nonce(k) 重用攻击（CTF 经典）：同私钥同 k 签两条消息（共享 r）→ 由 (r,s1,s2,z1,z2,n) 纯数论恢复 k 与私钥 d。k=(z1-z2)/(s1-s2) mod n, d=(s1·k-z1)/r mod n。内置 secp256k1/P-256，填公钥 Qx/Qy 可自动校验并消除 s 符号歧义。",
  params: [
    {
      key: "curve", label: "曲线（提供阶 n）", type: "select", default: "secp256k1",
      options: [
        { value: "secp256k1", label: "secp256k1（比特币/以太坊）" },
        { value: "secp256r1", label: "secp256r1 / NIST P-256" },
        { value: "custom", label: "自定义（手填 n）" },
      ],
    },
    { key: "n", label: "阶 n（custom 用）", type: "text", default: "", placeholder: "自定义曲线的阶（十进制或 0x）" },
    { key: "r", label: "r（两签名公共 r）", type: "text", default: "", placeholder: "共享的 r" },
    { key: "s1", label: "s1", type: "text", default: "", placeholder: "签名1 的 s" },
    { key: "s2", label: "s2", type: "text", default: "", placeholder: "签名2 的 s" },
    { key: "z1", label: "z1（消息1 hash 整数）", type: "text", default: "", placeholder: "H(m1) 整数" },
    { key: "z2", label: "z2（消息2 hash 整数）", type: "text", default: "", placeholder: "H(m2) 整数" },
    { key: "Qx", label: "公钥 Qx（可选·校验）", type: "text", default: "", placeholder: "填则自动校验 d·G==Q 并消歧" },
    { key: "Qy", label: "公钥 Qy（可选·校验）", type: "text", default: "", placeholder: "与 Qx 成对" },
  ],
  run: ecdsaReuseKRun,
});

export { ecdsaReuseKRun, recoverK, recoverD, ecMul, ecToAffine, CURVES, modInverse, mod };
