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
 * 契约：register({ id:"x25519", cat:"crypto", run, params })。
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

function x25519Run(text, p) {
  const mode = (p && p.mode) || "keygen";
  const lines = [];

  if (mode === "keygen") {
    // 生成一对（或用给定私钥算公钥）
    const skRaw = (p && p.priv && String(p.priv).trim());
    const sk = skRaw ? need32(hexToBytes(skRaw), "私钥") : randomKey();
    const pk = scalarBase(sk);
    lines.push("=== X25519 密钥生成 ===");
    lines.push(`私钥 (32B, hex) = ${bytesToHex(sk)}`);
    lines.push(`公钥 (32B, hex) = ${bytesToHex(pk)}`);
    lines.push("");
    lines.push("说明：公钥 = X25519(clamp(私钥), 基点 9)。私钥留空则随机生成。");
    return lines.join("\n");
  }

  if (mode === "shared_from_privs") {
    // 双方私钥算共享密钥（教学：本地同时持有 A、B 私钥）
    const a = need32(hexToBytes((p && p.privA) || ""), "私钥 A");
    const b = need32(hexToBytes((p && p.privB) || ""), "私钥 B");
    const pkA = scalarBase(a), pkB = scalarBase(b);
    const s1 = x25519(a, pkB); // A 私钥 · B 公钥
    const s2 = x25519(b, pkA); // B 私钥 · A 公钥
    lines.push("=== X25519 共享密钥（双方私钥）===");
    lines.push(`私钥 A = ${bytesToHex(a)}`);
    lines.push(`私钥 B = ${bytesToHex(b)}`);
    lines.push(`公钥 A = ${bytesToHex(pkA)}`);
    lines.push(`公钥 B = ${bytesToHex(pkB)}`);
    lines.push("");
    lines.push(`共享 K (A·pkB) = ${bytesToHex(s1)}`);
    lines.push(`共享 K (B·pkA) = ${bytesToHex(s2)}`);
    lines.push(bytesToHex(s1) === bytesToHex(s2) ? "✓ 两侧一致（ECDH 成立）" : "✗ 两侧不一致（参数异常）");
    return lines.join("\n");
  }

  if (mode === "shared_priv_pub") {
    // 我的私钥 + 对方公钥 算共享密钥
    const sk = need32(hexToBytes((p && p.priv) || ""), "我的私钥");
    const pk = need32(hexToBytes((p && p.pub) || ""), "对方公钥");
    const s = x25519(sk, pk);
    lines.push("=== X25519 共享密钥（私钥 + 对方公钥）===");
    lines.push(`我的私钥 = ${bytesToHex(sk)}`);
    lines.push(`对方公钥 = ${bytesToHex(pk)}`);
    lines.push("");
    lines.push(`共享密钥 K = X25519(私钥, 对方公钥) = ${bytesToHex(s)}`);
    return lines.join("\n");
  }

  throw new Error(`未知 mode: ${mode}`);
}

register({
  id: "x25519",
  cat: "crypto",
  name: "X25519 密钥交换",
  desc: "Curve25519 上的 ECDH（RFC 7748）：生成密钥对 / 双方私钥算共享密钥 / 私钥+对方公钥算共享密钥。Montgomery ladder，纯 BigInt 本地。",
  params: [
    {
      key: "mode", label: "模式", type: "select", default: "keygen",
      options: [
        { value: "keygen", label: "生成密钥对（私钥→公钥）" },
        { value: "shared_from_privs", label: "共享密钥（双方私钥）" },
        { value: "shared_priv_pub", label: "共享密钥（我私钥+对方公钥）" },
      ],
    },
    { key: "priv", label: "私钥 (hex, keygen/私钥+公钥)", type: "text", default: "", placeholder: "32B hex，留空随机" },
    { key: "pub", label: "对方公钥 (hex)", type: "text", default: "", placeholder: "32B hex" },
    { key: "privA", label: "私钥 A (hex, 双方模式)", type: "text", default: "", placeholder: "32B hex" },
    { key: "privB", label: "私钥 B (hex, 双方模式)", type: "text", default: "", placeholder: "32B hex" },
  ],
  run: x25519Run,
});

export { x25519, scalarBase, hexToBytes, bytesToHex };
