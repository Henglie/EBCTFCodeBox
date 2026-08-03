/*
 * ed25519.js — Ed25519 数字签名（RFC 8032）。
 *
 * 曲线：Edwards 曲线 -x² + y² = 1 + d·x²·y²，d = -121665/121666，p = 2²⁵⁵-19。
 * 群阶 L = 2²⁵² + 27742317777372353535851937790883648493。
 * 签名（RFC 8032 §5.1.6）：
 *   H = SHA-512。私钥 32B → h = H(sk)，a = clamp(h[0:32])，prefix = h[32:64]。
 *   公钥 A = encodePoint(a·B)。
 *   r = H(prefix || M) mod L；R = r·B。
 *   k = H(R || A || M) mod L；S = (r + k·a) mod L。
 *   签名 = R(32B) || S(32B)。
 * 验签：检查 8·S·B == 8·R + 8·k·A（这里用非批量：S·B == R + k·A）。
 *
 * 红线：算法照 RFC 8032，纯 BigInt + 内置纯 JS SHA-512，零外发。core 仅 import registry。
 *       随机私钥用 crypto.getRandomValues。用 RFC 8032 §7.1 官方测试向量验证。
 *
 * 契约：register({ id:"ed25519", cat:"crypto", run, params })。
 */

import { register } from "./registry.js";

// ============================================================
// 纯 JS 同步 SHA-512（用 BigInt 64-bit 字，仅用于摘要，非机密）
// ============================================================
const K512 = [
  0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
  0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
  0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
  0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
  0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
  0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
  0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
  0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
  0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
  0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n,
];
const MASK64 = (1n << 64n) - 1n;
const rotr = (x, n) => ((x >> n) | (x << (64n - n))) & MASK64;

/** SHA-512：输入 Uint8Array，返回 64 字节 Uint8Array。 */
function sha512(msg) {
  let h0 = 0x6a09e667f3bcc908n, h1 = 0xbb67ae8584caa73bn, h2 = 0x3c6ef372fe94f82bn, h3 = 0xa54ff53a5f1d36f1n;
  let h4 = 0x510e527fade682d1n, h5 = 0x9b05688c2b3e6c1fn, h6 = 0x1f83d9abfb41bd6bn, h7 = 0x5be0cd19137e2179n;

  const l = msg.length;
  const bitLen = BigInt(l) * 8n;
  // 补位：0x80，补零到 length ≡ 112 mod 128，末尾 128-bit 长度（大端）
  let padLen = (112 - (l + 1) % 128 + 128) % 128;
  const total = l + 1 + padLen + 16;
  const buf = new Uint8Array(total);
  buf.set(msg, 0);
  buf[l] = 0x80;
  // 128-bit 长度（大端），写低 64 位（消息 < 2^64 位）
  for (let i = 0; i < 8; i++) buf[total - 1 - i] = Number((bitLen >> BigInt(8 * i)) & 0xffn);

  const w = new Array(80);
  for (let off = 0; off < total; off += 128) {
    for (let i = 0; i < 16; i++) {
      let x = 0n;
      for (let j = 0; j < 8; j++) x = (x << 8n) | BigInt(buf[off + i * 8 + j]);
      w[i] = x;
    }
    for (let i = 16; i < 80; i++) {
      const s0 = rotr(w[i - 15], 1n) ^ rotr(w[i - 15], 8n) ^ (w[i - 15] >> 7n);
      const s1 = rotr(w[i - 2], 19n) ^ rotr(w[i - 2], 61n) ^ (w[i - 2] >> 6n);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & MASK64;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 80; i++) {
      const S1 = rotr(e, 14n) ^ rotr(e, 18n) ^ rotr(e, 41n);
      const ch = (e & f) ^ (~e & MASK64 & g);
      const t1 = (h + S1 + ch + K512[i] + w[i]) & MASK64;
      const S0 = rotr(a, 28n) ^ rotr(a, 34n) ^ rotr(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) & MASK64;
      h = g; g = f; f = e; e = (d + t1) & MASK64; d = c; c = b; b = a; a = (t1 + t2) & MASK64;
    }
    h0 = (h0 + a) & MASK64; h1 = (h1 + b) & MASK64; h2 = (h2 + c) & MASK64; h3 = (h3 + d) & MASK64;
    h4 = (h4 + e) & MASK64; h5 = (h5 + f) & MASK64; h6 = (h6 + g) & MASK64; h7 = (h7 + h) & MASK64;
  }
  const out = new Uint8Array(64);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((hh, i) => {
    for (let j = 0; j < 8; j++) out[i * 8 + j] = Number((hh >> BigInt(56 - 8 * j)) & 0xffn);
  });
  return out;
}

// ============================================================
// Ed25519 群运算（扭曲 Edwards，扩展坐标 X:Y:Z:T）
// ============================================================
const P = (1n << 255n) - 19n;
const L = (1n << 252n) + 27742317777372353535851937790883648493n;
const D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n; // -121665/121666 mod p
const I = 19681161376707505956807079304988542015446066515923890162744021073123829784752n; // sqrt(-1) mod p

function mod(a) { const r = a % P; return r < 0n ? r + P : r; }
function powMod(b, e) { let r = 1n; b = mod(b); while (e > 0n) { if (e & 1n) r = (r * b) % P; e >>= 1n; b = (b * b) % P; } return r; }
function inv(a) { return powMod(a, P - 2n); }

// 基点 B
const By = mod(4n * inv(5n));
const Bx = recoverX(By, 0n);
const B = [Bx, By, 1n, mod(Bx * By)];

// 点加（扭曲 Edwards 扩展坐标，RFC 8032 附录）
function edAdd(P1, P2) {
  const [X1, Y1, Z1, T1] = P1, [X2, Y2, Z2, T2] = P2;
  const A = mod((Y1 - X1) * (Y2 - X2));
  const Bb = mod((Y1 + X1) * (Y2 + X2));
  const C = mod(T1 * 2n * D * T2);
  const Dd = mod(Z1 * 2n * Z2);
  const E = Bb - A, F = Dd - C, G = Dd + C, H = Bb + A;
  return [mod(E * F), mod(G * H), mod(F * G), mod(E * H)];
}
function edDouble(Pt) { return edAdd(Pt, Pt); }
function scalarMul(Pt, e) {
  let Q = [0n, 1n, 1n, 0n]; // 中性元
  while (e > 0n) { if (e & 1n) Q = edAdd(Q, Pt); Pt = edDouble(Pt); e >>= 1n; }
  return Q;
}

// 从 y 恢复 x（sign = 期望的最低位）
function recoverX(y, sign) {
  const y2 = mod(y * y);
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  let x = mod(u * powMod(v, (P - 5n) / 8n) * powMod(mod(u * v * v), (P - 1n) / 4n)); // 组合公式
  // 标准做法：x = uv³ (uv⁷)^((p-5)/8)
  const uv3 = mod(u * powMod(v, 3n));
  const uv7 = mod(u * powMod(v, 7n));
  x = mod(uv3 * powMod(uv7, (P - 5n) / 8n));
  if (mod(v * x * x) === mod(P - u)) x = mod(x * I);
  if ((x & 1n) !== sign) x = mod(P - x);
  return x;
}

// 编码点为 32B（y 的 LE + x 的符号在最高位）
function encodePoint(Pt) {
  const zi = inv(Pt[2]);
  const x = mod(Pt[0] * zi);
  const y = mod(Pt[1] * zi);
  const out = encodeLE(y, 32);
  out[31] = (out[31] & 0x7f) | (Number(x & 1n) << 7);
  return out;
}
function decodePoint(bytes) {
  const b = bytes.slice(0, 32);
  const sign = BigInt((b[31] >> 7) & 1);
  b[31] &= 0x7f;
  const y = decodeLE(b);
  if (y >= P) throw new Error("point y ≥ p");
  const x = recoverX(y, sign);
  return [x, y, 1n, mod(x * y)];
}

// LE ↔ BigInt
function decodeLE(bytes) { let x = 0n; for (let i = 0; i < bytes.length; i++) x |= BigInt(bytes[i]) << (8n * BigInt(i)); return x; }
function encodeLE(x, len) { const out = new Uint8Array(len); for (let i = 0; i < len; i++) { out[i] = Number(x & 0xffn); x >>= 8n; } return out; }

function modL(x) { const r = x % L; return r < 0n ? r + L : r; }

// clamp 私钥 hash 前半
function clamp(h32) {
  const b = h32.slice(0, 32);
  b[0] &= 248; b[31] &= 127; b[31] |= 64;
  return decodeLE(b);
}

// 拼接
function concat(...arrs) {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

/** 私钥 32B → 公钥 32B。 */
function publicKey(sk) {
  const h = sha512(sk);
  const a = clamp(h);
  return encodePoint(scalarMul(B, a));
}

/** 签名：sk 32B, msg bytes → 64B 签名。 */
function sign(sk, msg) {
  const h = sha512(sk);
  const a = clamp(h);
  const prefix = h.slice(32, 64);
  const A = encodePoint(scalarMul(B, a));
  const r = modL(decodeLE(sha512(concat(prefix, msg))));
  const R = encodePoint(scalarMul(B, r));
  const k = modL(decodeLE(sha512(concat(R, A, msg))));
  const S = modL(r + k * a);
  return concat(R, encodeLE(S, 32));
}

/** 验签：pk 32B, msg bytes, sig 64B → bool。 */
function verify(pk, msg, sig) {
  if (sig.length !== 64) return false;
  const Rbytes = sig.slice(0, 32);
  const S = decodeLE(sig.slice(32, 64));
  if (S >= L) return false;
  let A, R;
  try { A = decodePoint(pk); R = decodePoint(Rbytes); } catch { return false; }
  const k = modL(decodeLE(sha512(concat(Rbytes, pk, msg))));
  const sB = scalarMul(B, S);
  const kA = scalarMul(A, k);
  const rhs = edAdd(R, kA);
  // 比较 sB == rhs（投影坐标：交叉相乘）
  const [X1, Y1, Z1] = sB, [X2, Y2, Z2] = rhs;
  return mod(X1 * Z2) === mod(X2 * Z1) && mod(Y1 * Z2) === mod(Y2 * Z1);
}

// ---- hex 辅助 ----
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
function need32(b, label) { if (b.length !== 32) throw new Error(`${label} 必须 32 字节，当前 ${b.length}`); return b; }

// 消息：hex 或 UTF-8 文本
function msgBytes(text, msgMode) {
  if (msgMode === "hex") return hexToBytes(text);
  return new TextEncoder().encode(String(text == null ? "" : text));
}

function ed25519Run(text, p) {
  const mode = (p && p.mode) || "sign";
  const msgMode = (p && p.msgMode) || "text";
  const lines = [];

  if (mode === "keygen") {
    const skRaw = (p && p.priv && String(p.priv).trim());
    const sk = skRaw ? need32(hexToBytes(skRaw), "私钥") : randomKey();
    const pk = publicKey(sk);
    lines.push("=== Ed25519 密钥生成 ===");
    lines.push(`私钥 (32B) = ${bytesToHex(sk)}`);
    lines.push(`公钥 (32B) = ${bytesToHex(pk)}`);
    return lines.join("\n");
  }

  if (mode === "sign") {
    const sk = need32(hexToBytes((p && p.priv) || ""), "私钥");
    const msg = msgBytes(text, msgMode);
    const pk = publicKey(sk);
    const sig = sign(sk, msg);
    lines.push("=== Ed25519 签名 ===");
    lines.push(`私钥 = ${bytesToHex(sk)}`);
    lines.push(`公钥 = ${bytesToHex(pk)}`);
    lines.push(`消息 (${msgMode}) = ${msgMode === "hex" ? bytesToHex(msg) : JSON.stringify(text || "")}`);
    lines.push("");
    lines.push(`签名 (64B) = ${bytesToHex(sig)}`);
    lines.push("");
    lines.push("自检验签：" + (verify(pk, msg, sig) ? "✓ 通过" : "✗ 失败"));
    return lines.join("\n");
  }

  if (mode === "verify") {
    const pk = need32(hexToBytes((p && p.pub) || ""), "公钥");
    const sig = hexToBytes((p && p.sig) || "");
    if (sig.length !== 64) throw new Error(`签名必须 64 字节，当前 ${sig.length}`);
    const msg = msgBytes(text, msgMode);
    const ok = verify(pk, msg, sig);
    lines.push("=== Ed25519 验签 ===");
    lines.push(`公钥 = ${bytesToHex(pk)}`);
    lines.push(`消息 (${msgMode}) = ${msgMode === "hex" ? bytesToHex(msg) : JSON.stringify(text || "")}`);
    lines.push(`签名 = ${bytesToHex(sig)}`);
    lines.push("");
    lines.push(ok ? "✓ 验签通过" : "✗ 验签失败");
    return lines.join("\n");
  }

  throw new Error(`未知 mode: ${mode}`);
}

register({
  id: "ed25519",
  cat: "crypto",
  name: "Ed25519 签名 / 验签",
  desc: "Ed25519 数字签名（RFC 8032）：生成密钥 / 签名 / 验签。扭曲 Edwards 曲线 + 内置纯 JS SHA-512，纯 BigInt 本地计算。",
  params: [
    {
      key: "mode", label: "模式", type: "select", default: "sign",
      options: [
        { value: "keygen", label: "生成密钥对（私钥→公钥）" },
        { value: "sign", label: "签名（私钥+消息→签名）" },
        { value: "verify", label: "验签（公钥+消息+签名）" },
      ],
    },
    {
      key: "msgMode", label: "消息形式", type: "select", default: "text",
      options: [
        { value: "text", label: "UTF-8 文本" },
        { value: "hex", label: "Hex 字节" },
      ],
    },
    { key: "priv", label: "私钥 (hex, keygen/sign)", type: "text", default: "", placeholder: "32B hex，keygen 留空随机" },
    { key: "pub", label: "公钥 (hex, verify)", type: "text", default: "", placeholder: "32B hex" },
    { key: "sig", label: "签名 (hex, verify)", type: "text", default: "", placeholder: "64B hex" },
  ],
  run: ed25519Run,
});

export { sha512, publicKey, sign, verify, hexToBytes, bytesToHex };
