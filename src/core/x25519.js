/*
 * x25519.js — X25519 密钥交换（Curve25519 上的 ECDH，RFC 7748）。
 *
 * 曲线：Montgomery 曲线 v² = u³ + 486662·u² + u，p = 2²⁵⁵ - 19。
 * X25519(k, u)：用 Montgomery ladder 在 u 坐标做标量乘。
 *   - clamp 私钥 k（RFC 7748 §5：清低 3 位、清最高位、置次高位）。
 *   - 基点 u = 9（生成公钥用）。
 * 共享密钥：A 的私钥 · B 的公钥 == B 的私钥 · A 的公钥。
 *
 * 红线：算法照 RFC 7748，纯 BigInt 本地，零外发。core 仅 import registry。
 *       随机私钥用 crypto.getRandomValues。
 *
 * 契约：族滑块三档 op（T396-A）：x25519KeyGen / x25519Shared / x25519SharedFromPub，
 *        family:"x25519"。
 */

import { register } from "./registry.js";

const P = (1n << 255n) - 19n;
const A24 = 121665n; // (486662 - 2) / 4
const BITS = 255;

function mod(a) { const r = a % P; return r < 0n ? r + P : r; }
function powMod(b, e) {
  let r = 1n; b = mod(b);
  while (e > 0n) { if (e & 1n) r = (r * b) % P; e >>= 1n; b = (b * b) % P; }
  return r;
}
function inv(a) { return powMod(a, P - 2n); } // 费马小定理求逆

// 32 字节 little-endian ↔ BigInt
function decodeLE(bytes) {
  let x = 0n;
  for (let i = 0; i < bytes.length; i++) x |= BigInt(bytes[i]) << (8n * BigInt(i));
  return x;
}
function encodeLE(x, len = 32) {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}

// RFC 7748 decodeScalar25519（clamp）
function clampScalar(bytes) {
  const b = bytes.slice(0, 32);
  b[0] &= 248;
  b[31] &= 127;
  b[31] |= 64;
  return decodeLE(b);
}
// decodeUCoordinate：mask 最高位
function decodeU(bytes) {
  const b = bytes.slice(0, 32);
  b[31] &= 127;
  return mod(decodeLE(b));
}

// 常量时间条件交换（这里非硬约束，逻辑照 RFC 保证正确性）
function cswap(swap, a, b) { return swap ? [b, a] : [a, b]; }

/** X25519 标量乘：scalar (BigInt clamped) · u-coordinate (BigInt) → BigInt。 */
function ladder(k, u) {
  let x1 = u;
  let x2 = 1n, z2 = 0n, x3 = u, z3 = 1n;
  let swap = 0n;
  for (let t = BITS - 1; t >= 0; t--) {
    const kt = (k >> BigInt(t)) & 1n;
    swap ^= kt;
    [x2, x3] = cswap(swap, x2, x3);
    [z2, z3] = cswap(swap, z2, z3);
    swap = kt;

    const A = mod(x2 + z2);
    const AA = mod(A * A);
    const B = mod(x2 - z2);
    const BB = mod(B * B);
    const E = mod(AA - BB);
    const C = mod(x3 + z3);
    const D = mod(x3 - z3);
    const DA = mod(D * A);
    const CB = mod(C * B);
    x3 = mod((DA + CB) * (DA + CB));
    z3 = mod(x1 * mod((DA - CB) * (DA - CB)));
    x2 = mod(AA * BB);
    z2 = mod(E * (AA + mod(A24 * E)));
  }
  [x2, x3] = cswap(swap, x2, x3);
  [z2, z3] = cswap(swap, z2, z3);
  return mod(x2 * inv(z2));
}

/** X25519(k_bytes, u_bytes) → 32 字节 result（little-endian）。 */
function x25519(kBytes, uBytes) {
  const k = clampScalar(kBytes);
  const u = decodeU(uBytes);
  const res = ladder(k, u);
  return encodeLE(res, 32);
}

const BASE_U = (() => { const b = new Uint8Array(32); b[0] = 9; return b; })();

/** 私钥 → 公钥（基点 u=9）。 */
function scalarBase(kBytes) { return x25519(kBytes, BASE_U); }

// ---- hex/bytes 辅助 ----
function hexToBytes(hex) {
  const h = String(hex || "").trim().replace(/^0x/i, "").replace(/[\s:]/g, "");
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error(`非法 hex：${hex}`);
  if (h.length % 2) throw new Error("hex 长度必须为偶数");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(b) { return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join(""); }
function randomKey() { const b = new Uint8Array(32); crypto.getRandomValues(b); return b; }

function need32(bytes, label) {
  if (bytes.length !== 32) throw new Error(`${label} 必须为 32 字节（64 hex 字符），当前 ${bytes.length} 字节`);
  return bytes;
}

// ============================================================
// X25519 三档算法族（T396-A，2026-09-04：同族多操作必须族滑块，废除下拉切模式）
// family:"x25519"（与已有 x448 族命名区分）+ familyLabel → fam.lbl.*
// （keygen/shared 已有主表 key；「私钥+对方公钥」档用 sharedPub——需主控在
// zh/en i18n 主表新增 fam.lbl.sharedPub）。底层 x25519/scalarBase 实现原样复用，
// 每个 op 只保留本档参数面。
// ============================================================

// ---- 档① 生成密钥对 ----
register({
  id: "x25519KeyGen",
  cat: "asym",
  family: "x25519",
  familyLabel: "keygen",
  name: "X25519 密钥生成",
  desc: "X25519 密钥生成（RFC 7748）：私钥 32 字节随机（或给定）→ 公钥 = X25519(clamp(私钥), 基点 9)。配套「共享密钥」两档做 ECDH",
  params: [
    { key: "priv", label: "私钥 (32B hex)", type: "text", default: "", placeholder: "64 hex 字符，留空随机" },
  ],
  run: (_text, p) => {
    // 生成一对（或用给定私钥算公钥）
    const skRaw = (p && p.priv && String(p.priv).trim());
    const sk = skRaw ? need32(hexToBytes(skRaw), "私钥") : randomKey();
    const pk = scalarBase(sk);
    // T362 产物协议（2026-09-02）：私钥 / 公钥分开交付下载按钮（hex 文本）。
    return {
      text: [
        "=== X25519 密钥生成 ===",
        `私钥 (32B, hex) = ${bytesToHex(sk)}`,
        `公钥 (32B, hex) = ${bytesToHex(pk)}`,
        "",
        "说明：公钥 = X25519(clamp(私钥), 基点 9)。私钥留空则随机生成。",
        "",
        "私钥 / 公钥已分开生成：私钥 ⚠ 敏感请妥善保管。点击下方按钮下载。",
      ].join("\n"),
      files: [
        { name: "x25519_priv.hex", mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(sk) + "\n") },
        { name: "x25519_pub.hex", mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(pk) + "\n") },
      ],
    };
  },
});

// ---- 档② 共享密钥（双方私钥，教学本地推演）----
register({
  id: "x25519Shared",
  cat: "asym",
  family: "x25519",
  familyLabel: "shared",
  name: "X25519 共享密钥（双方私钥）",
  desc: "X25519 ECDH（RFC 7748 §6.2，教学口径：本地同时持有 A/B 双方私钥）：K = X25519(a, B公钥) == X25519(b, A公钥)，输出两侧互验一致",
  params: [
    { key: "privA", label: "私钥 A (32B hex)", type: "text", default: "", placeholder: "64 hex 字符" },
    { key: "privB", label: "私钥 B (32B hex)", type: "text", default: "", placeholder: "64 hex 字符" },
  ],
  run: (_text, p) => {
    const a = need32(hexToBytes((p && p.privA) || ""), "私钥 A");
    const b = need32(hexToBytes((p && p.privB) || ""), "私钥 B");
    const pkA = scalarBase(a), pkB = scalarBase(b);
    const s1 = x25519(a, pkB); // A 私钥 · B 公钥
    const s2 = x25519(b, pkA); // B 私钥 · A 公钥
    return [
      "=== X25519 共享密钥（双方私钥）===",
      `私钥 A = ${bytesToHex(a)}`,
      `私钥 B = ${bytesToHex(b)}`,
      `公钥 A = ${bytesToHex(pkA)}`,
      `公钥 B = ${bytesToHex(pkB)}`,
      "",
      `共享 K (A·pkB) = ${bytesToHex(s1)}`,
      `共享 K (B·pkA) = ${bytesToHex(s2)}`,
      bytesToHex(s1) === bytesToHex(s2) ? "✓ 两侧一致（ECDH 成立）" : "✗ 两侧不一致（参数异常）",
    ].join("\n");
  },
});

// ---- 档③ 共享密钥（我私钥 + 对方公钥，实战口径）----
register({
  id: "x25519SharedFromPub",
  cat: "asym",
  family: "x25519",
  familyLabel: "sharedPub",
  name: "X25519 共享密钥（私钥+对方公钥）",
  desc: "X25519 ECDH（RFC 7748 §6.2，实战口径）：只持己方私钥 + 对方公钥，K = X25519(私钥, 对方公钥)。与「双方私钥」档结果一致",
  params: [
    { key: "priv", label: "我的私钥 (32B hex)", type: "text", default: "", placeholder: "64 hex 字符" },
    { key: "pub", label: "对方公钥 (32B hex)", type: "text", default: "", placeholder: "64 hex 字符" },
  ],
  run: (_text, p) => {
    const sk = need32(hexToBytes((p && p.priv) || ""), "我的私钥");
    const pk = need32(hexToBytes((p && p.pub) || ""), "对方公钥");
    const s = x25519(sk, pk);
    return [
      "=== X25519 共享密钥（私钥 + 对方公钥）===",
      `我的私钥 = ${bytesToHex(sk)}`,
      `对方公钥 = ${bytesToHex(pk)}`,
      "",
      `共享密钥 K = X25519(私钥, 对方公钥) = ${bytesToHex(s)}`,
    ].join("\n");
  },
});

export { x25519, scalarBase, hexToBytes, bytesToHex };
