/*
 * schnorr.js — Schnorr 签名 / 验签 / nonce 重用私钥恢复（cat:'crypto'，run 型）。
 *
 * 定位：与 ECDSA 对偶的经典签名体制。CTF crypto 高频，且 nonce 重用攻击
 * 是 ECDSA 重用 k 攻击的姊妹题（见 [[ecdsaReuseK]]）。曲线复用 secp256k1
 * （从 ecdsaReuseK.js 引入 CURVES/ecMul/ecToAffine/mod/modInverse，不重复造）。
 *
 * 签名（教学版经典 Schnorr，非 BIP340）：
 *   私钥 d ∈ [1, n-1]，公钥 P = d·G
 *   随机 nonce k ∈ [1, n-1]，R = k·G
 *   挑战 e = H(R.x ‖ P.x ‖ m) mod n
 *   s = (k + e·d) mod n
 *   签名 = (e, s)   （也支持 (R, s) 变体，这里用 (e, s) 便于教学）
 *
 * 验签：
 *   R' = s·G − e·P，e' = H(R'.x ‖ P.x ‖ m) mod n，检查 e' == e
 *
 * nonce 重用攻击（同一 d、同一 k 签两条不同消息 m1≠m2）：
 *   s1 = k + e1·d，s2 = k + e2·d
 *   ⇒ s1 − s2 = (e1 − e2)·d
 *   ⇒ d = (s1 − s2) / (e1 − e2) mod n
 *   ⇒ k = s1 − e1·d mod n
 *
 * 红线：
 * - 算法照经典 Schnorr 实现，不编造。
 * - nonce 用 crypto.getRandomValues。
 * - 交付前自验：sign→verify 通过 + 篡改消息验签失败 + 重用 nonce 恢复 d 匹配。
 * - 零外发：纯本地 BigInt。core 层零 UI 依赖（仅 registry）。
 * - SHA-256 自带（不依赖未导出的内部实现）。
 *
 * 契约：族滑块四档 op（T396-A）：schnorrKeyGen / schnorrSign / schnorrVerify /
 *        schnorrReuseK，family:"schnorr"。
 */
import { register } from "./registry.js";
import { CURVES, ecMul, ecToAffine, mod, modInverse } from "./ecdsaReuseK.js";

// ============================================================
// 自带 SHA-256（同步，纯 JS，FIPS 180-4）
// ============================================================
const K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
function sha256Bytes(bytes) {
  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const l = bytes.length;
  const withOne = l + 1;
  const k = (56 - (withOne % 64) + 64) % 64;
  const total = withOne + k + 8;
  const msg = new Uint8Array(total);
  msg.set(bytes, 0);
  msg[l] = 0x80;
  const bitLen = l * 8;
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  msg[total - 8] = (hi >>> 24) & 0xff; msg[total - 7] = (hi >>> 16) & 0xff;
  msg[total - 6] = (hi >>> 8) & 0xff;  msg[total - 5] = hi & 0xff;
  msg[total - 4] = (lo >>> 24) & 0xff; msg[total - 3] = (lo >>> 16) & 0xff;
  msg[total - 2] = (lo >>> 8) & 0xff;  msg[total - 1] = lo & 0xff;
  const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (msg[off + i * 4] << 24) | (msg[off + i * 4 + 1] << 16) | (msg[off + i * 4 + 2] << 8) | msg[off + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (h[i] >>> 24) & 0xff; out[i * 4 + 1] = (h[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (h[i] >>> 8) & 0xff; out[i * 4 + 3] = h[i] & 0xff;
  }
  return out;
}

// ============================================================
// 工具
// ============================================================
const CURVE = CURVES.secp256k1;
const { n: N, Gx: GX, Gy: GY, a: A, p: P } = CURVE;

function hexToBytes(s) {
  const clean = String(s).replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("hex 长度须为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
function bigToBytes32(v) {
  const out = new Uint8Array(32);
  let x = v;
  for (let i = 31; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}
function bytesToBig(bytes) {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}
function parseBig(s, name) {
  const t = String(s == null ? "" : s).trim();
  if (!t) throw new Error(`缺少参数：${name}`);
  try { return /^0x/i.test(t) ? BigInt(t) : BigInt(t); }
  catch { throw new Error(`${name} 不是合法整数：${t}`); }
}
function randScalar() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return (bytesToBig(b) % (N - 1n)) + 1n;
}

// 挑战 e = H(R.x ‖ P.x ‖ m) mod n
function challenge(Rx, Px, msgBytes) {
  const buf = new Uint8Array(64 + msgBytes.length);
  buf.set(bigToBytes32(Rx), 0);
  buf.set(bigToBytes32(Px), 32);
  buf.set(msgBytes, 64);
  return mod(bytesToBig(sha256Bytes(buf)), N);
}

// EC 点：s·G − e·P（用于验签）；点减 = 加负点
function pointSub(P1, P2) {
  // P1, P2 为仿射 [x,y]；返回 P1 + (−P2)
  const negP2 = [P2[0], mod(-P2[1], P)];
  return ecAdd(P1, negP2);
}
// 仿射点加（复用与 ecMul 相同的曲线参数）
function ecAdd(p1, p2) {
  if (p1 === null) return p2;
  if (p2 === null) return p1;
  const [x1, y1] = p1, [x2, y2] = p2;
  if (x1 === x2 && mod(y1 + y2, P) === 0n) return null; // 互为逆元 → ∞
  let m;
  if (x1 === x2 && y1 === y2) {
    m = mod((3n * x1 * x1 + A) * modInverse(2n * y1, P), P);
  } else {
    m = mod((y2 - y1) * modInverse(mod(x2 - x1, P), P), P);
  }
  const x3 = mod(m * m - x1 - x2, P);
  const y3 = mod(m * (x1 - x3) - y1, P);
  return [x3, y3];
}

// ============================================================
// 签名 / 验签
// ============================================================
function schnorrSign(d, msgBytes, kOverride) {
  const k = kOverride != null ? kOverride : randScalar();
  const R = ecToAffine(ecMul(k, GX, GY, A, P), P);
  const Pt = ecToAffine(ecMul(d, GX, GY, A, P), P);
  const e = challenge(R[0], Pt[0], msgBytes);
  const s = mod(k + e * d, N);
  return { e, s, R, P: Pt, k };
}

function schnorrVerify(Px, Py, e, s, msgBytes) {
  // R' = s·G − e·P
  const sG = ecToAffine(ecMul(s, GX, GY, A, P), P);
  const eP = ecToAffine(ecMul(e, Px, Py, A, P), P);
  const Rp = pointSub(sG, eP);
  if (Rp === null) return false;
  const ep = challenge(Rp[0], Px, msgBytes);
  return ep === e;
}

// nonce 重用恢复私钥：d = (s1−s2)/(e1−e2) mod n
function recoverPrivFromReusedNonce(e1, s1, e2, s2) {
  const den = mod(e1 - e2, N);
  if (den === 0n) throw new Error("e1 == e2，无法恢复（需两条不同消息）");
  const d = mod((s1 - s2) * modInverse(den, N), N);
  const k = mod(s1 - e1 * d, N);
  return { d, k };
}

// ============================================================
// Schnorr 四档算法族（T396-A，2026-09-04：同族多操作必须族滑块，废除下拉切模式）
// family:"schnorr" + familyLabel → fam.lbl.*（keygen/sign/verify 已有主表 key；
// 攻击档用 attack——需主控在 zh/en i18n 主表新增 fam.lbl.attack）。
// 底层 schnorrSign/schnorrVerify/recoverPrivFromReusedNonce 实现原样复用，
// 每个 op 只保留本档参数面。
// ============================================================

// ---- 档① 生成密钥对 ----
register({
  id: "schnorrKeyGen",
  cat: "asym",
  family: "schnorr",
  familyLabel: "keygen",
  name: "Schnorr 密钥对生成",
  desc: "生成 Schnorr 密钥对（secp256k1）：私钥 d ∈ [1,n-1]，公钥 P=d·G。配套「签名/验签/nonce 重用攻击」档使用",
  params: [],
  run: () => {
    const d = randScalar();
    const Pt = ecToAffine(ecMul(d, GX, GY, A, P), P);
    // T362 产物协议（2026-09-02）：私钥 / 公钥分开交付下载按钮（hex 文本）。
    return {
      text: [
        "生成密钥对：",
        "私钥 d  = " + bytesToHex(bigToBytes32(d)),
        "公钥 Px = " + bytesToHex(bigToBytes32(Pt[0])),
        "公钥 Py = " + bytesToHex(bigToBytes32(Pt[1])),
        "",
        "私钥 / 公钥已分开生成：私钥 ⚠ 敏感请妥善保管。点击下方按钮下载。",
      ].join("\n"),
      files: [
        { name: "schnorr_priv.hex", mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(bigToBytes32(d)) + "\n") },
        { name: "schnorr_pub.hex", mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(bigToBytes32(Pt[0])) + bytesToHex(bigToBytes32(Pt[1])) + "\n") },
      ],
    };
  },
});

// ---- 档② 签名 ----
register({
  id: "schnorrSign",
  cat: "asym",
  family: "schnorr",
  familyLabel: "sign",
  name: "Schnorr 签名",
  desc: "经典 Schnorr 签名（secp256k1，挑战 e=H(R.x‖P.x‖m) mod n）：R=k·G，s=(k+e·d) mod n，签名=(e,s)。私钥留空随机。⚠ 两条消息复用同一 nonce k 会泄露私钥（教学可用）",
  params: [
    { key: "msgMode", label: "消息形式", type: "select", default: "text", options: [{ value: "text", label: "文本" }, { value: "hex", label: "Hex" }] },
    { key: "priv", label: "私钥 d (hex)", type: "text", default: "", placeholder: "留空随机" },
    { key: "nonce", label: "nonce k (hex, 可选)", type: "text", default: "", placeholder: "留空随机；固定值用于演示重用攻击" },
  ],
  run: (text, p) => {
    const msgMode = (p && p.msgMode) || "text";
    const toMsgBytes = (s) => msgMode === "hex" ? hexToBytes(s) : new TextEncoder().encode(String(s || ""));
    const dRaw = (p && p.priv && String(p.priv).trim());
    const d = dRaw ? parseBig(dRaw, "私钥 d") : randScalar();
    const msg = toMsgBytes(text);
    const kRaw = (p && p.nonce && String(p.nonce).trim());
    const sig = schnorrSign(d, msg, kRaw ? parseBig(kRaw, "nonce k") : null);
    const lines = [];
    lines.push("=== Schnorr 签名（经典版，secp256k1，挑战 e=H(R.x‖P.x‖m)） ===");
    lines.push("");
    lines.push("消息: " + msg.length + " 字节（" + msgMode + "）");
    lines.push("私钥 d  = " + bytesToHex(bigToBytes32(d)));
    lines.push("公钥 Px = " + bytesToHex(bigToBytes32(sig.P[0])));
    lines.push("公钥 Py = " + bytesToHex(bigToBytes32(sig.P[1])));
    lines.push("");
    lines.push("签名：");
    lines.push("e = " + bytesToHex(bigToBytes32(sig.e)));
    lines.push("s = " + bytesToHex(bigToBytes32(sig.s)));
    if (kRaw) lines.push("（⚠ 你指定了固定 nonce k，两条消息复用同一 k 会泄露私钥）");
    return lines.join("\n");
  },
});

// ---- 档③ 验签 ----
register({
  id: "schnorrVerify",
  cat: "asym",
  family: "schnorr",
  familyLabel: "verify",
  name: "Schnorr 验签",
  desc: "Schnorr 验签：R' = s·G − e·P，e' = H(R'.x ‖ P.x ‖ m) mod n，e' == e 即有效。输入公钥 (Px,Py)、签名 (e,s) 与消息",
  params: [
    { key: "msgMode", label: "消息形式", type: "select", default: "text", options: [{ value: "text", label: "文本" }, { value: "hex", label: "Hex" }] },
    { key: "pubX", label: "公钥 Px (hex)", type: "text", default: "", placeholder: "verify 用" },
    { key: "pubY", label: "公钥 Py (hex)", type: "text", default: "", placeholder: "verify 用" },
    { key: "e", label: "e (hex)", type: "text", default: "", placeholder: "verify 用" },
    { key: "s", label: "s (hex)", type: "text", default: "", placeholder: "verify 用" },
  ],
  run: (text, p) => {
    const msgMode = (p && p.msgMode) || "text";
    const toMsgBytes = (s) => msgMode === "hex" ? hexToBytes(s) : new TextEncoder().encode(String(s || ""));
    const Px = parseBig(p && p.pubX, "公钥 Px");
    const Py = parseBig(p && p.pubY, "公钥 Py");
    const e = parseBig(p && p.e, "e");
    const s = parseBig(p && p.s, "s");
    const msg = toMsgBytes(text);
    const ok = schnorrVerify(Px, Py, e, s, msg);
    return [
      "=== Schnorr 验签（经典版，secp256k1） ===",
      "",
      "验签结果: " + (ok ? "✓ 有效签名" : "✗ 无效签名"),
    ].join("\n");
  },
});

// ---- 档④ nonce 重用攻击 ----
register({
  id: "schnorrReuseK",
  cat: "asym",
  family: "schnorr",
  familyLabel: "attack",
  name: "Schnorr nonce 重用攻击",
  desc: "Schnorr nonce 重用攻击（ECDSA 重用 k 的姊妹题）：同一私钥、同一 k 签两条不同消息 ⇒ d=(s1−s2)/(e1−e2) mod n，k=s1−e1·d mod n。输入两条签名 (e1,s1)(e2,s2)",
  params: [
    { key: "e1", label: "e1", type: "text", default: "", placeholder: "签名1 的挑战 e" },
    { key: "s1", label: "s1", type: "text", default: "", placeholder: "签名1 的 s" },
    { key: "e2", label: "e2", type: "text", default: "", placeholder: "签名2 的挑战 e" },
    { key: "s2", label: "s2", type: "text", default: "", placeholder: "签名2 的 s" },
  ],
  run: (_text, p) => {
    const e1 = parseBig(p && p.e1, "e1");
    const s1 = parseBig(p && p.s1, "s1");
    const e2 = parseBig(p && p.e2, "e2");
    const s2 = parseBig(p && p.s2, "s2");
    const r = recoverPrivFromReusedNonce(e1, s1, e2, s2);
    return [
      "=== Schnorr nonce 重用攻击 ===",
      "公式：d = (s1−s2)/(e1−e2) mod n,  k = s1 − e1·d mod n",
      "",
      "恢复私钥 d = " + bytesToHex(bigToBytes32(r.d)),
      "恢复 nonce k = " + bytesToHex(bigToBytes32(r.k)),
    ].join("\n");
  },
});

export { schnorrSign, schnorrVerify, recoverPrivFromReusedNonce, sha256Bytes };
