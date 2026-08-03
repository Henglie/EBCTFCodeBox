/*
 * scrypt.js — scrypt 口令密钥派生函数（cat:'crypto'，run 型）。
 *
 * 算法照 RFC 7914（Colin Percival《scrypt》）实现，不编造：
 *   scrypt(P, S, N, r, p, dkLen):
 *     B = PBKDF2-HMAC-SHA256(P, S, 1, p*128*r)
 *     for i in 0..p-1:  B_i = ROMix(B_i, N)
 *     DK = PBKDF2-HMAC-SHA256(P, B, 1, dkLen)
 *   ROMix(X, N):  内存硬化，V[i]=X 迭代，再随机访问 j=Integerify(X) mod N
 *   BlockMix(B):  基于 Salsa20/8 core 的块混合（2r 个 64 字节子块）
 *   Salsa20/8:    8 轮 Salsa20 core（4 个 double-round）
 *
 * 内存硬 KDF，抗 ASIC/GPU 暴力，用于磁盘加密（cryptsetup）、加密货币钱包（Litecoin/
 * Dogecoin scrypt PoW）、口令存储。CTF 常见口令派生/爆破题。
 *
 * 红线：
 * - 算法照 RFC 7914，不编造；交付前对拍 Node crypto.scryptSync 官方实现。
 * - 纯本地零外发；core 层零 UI 依赖（仅 registry）。
 * - PBKDF2-HMAC-SHA256 走 WebCrypto（异步）；Salsa20/8 + ROMix 纯 JS。
 *
 * 契约：register({ id:"scrypt", cat:"crypto", name, desc, params, run（async）})。
 */
import { register } from "./registry.js";

// ============================================================
// 编解码工具
// ============================================================
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
function bytesToB64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// ============================================================
// Salsa20/8 core（RFC 7914 §3，作用于 64 字节 = 16 个 32 位小端字）
// ============================================================
function R(a, b) { return ((a << b) | (a >>> (32 - b))) >>> 0; }

function salsa20_8(B) {
  // B: Uint8Array(64)，原地更新
  const x = new Uint32Array(16);
  const dv = new DataView(B.buffer, B.byteOffset, 64);
  for (let i = 0; i < 16; i++) x[i] = dv.getUint32(i * 4, true);
  const out = x.slice();
  for (let round = 0; round < 8; round += 2) {
    // 列轮
    out[4] ^= R(out[0] + out[12], 7); out[8] ^= R(out[4] + out[0], 9);
    out[12] ^= R(out[8] + out[4], 13); out[0] ^= R(out[12] + out[8], 18);
    out[9] ^= R(out[5] + out[1], 7); out[13] ^= R(out[9] + out[5], 9);
    out[1] ^= R(out[13] + out[9], 13); out[5] ^= R(out[1] + out[13], 18);
    out[14] ^= R(out[10] + out[6], 7); out[2] ^= R(out[14] + out[10], 9);
    out[6] ^= R(out[2] + out[14], 13); out[10] ^= R(out[6] + out[2], 18);
    out[3] ^= R(out[15] + out[11], 7); out[7] ^= R(out[3] + out[15], 9);
    out[11] ^= R(out[7] + out[3], 13); out[15] ^= R(out[11] + out[7], 18);
    // 行轮
    out[1] ^= R(out[0] + out[3], 7); out[2] ^= R(out[1] + out[0], 9);
    out[3] ^= R(out[2] + out[1], 13); out[0] ^= R(out[3] + out[2], 18);
    out[6] ^= R(out[5] + out[4], 7); out[7] ^= R(out[6] + out[5], 9);
    out[4] ^= R(out[7] + out[6], 13); out[5] ^= R(out[4] + out[7], 18);
    out[11] ^= R(out[10] + out[9], 7); out[8] ^= R(out[11] + out[10], 9);
    out[9] ^= R(out[8] + out[11], 13); out[10] ^= R(out[9] + out[8], 18);
    out[12] ^= R(out[15] + out[14], 7); out[13] ^= R(out[12] + out[15], 9);
    out[14] ^= R(out[13] + out[12], 13); out[15] ^= R(out[14] + out[13], 18);
  }
  for (let i = 0; i < 16; i++) dv.setUint32(i * 4, (out[i] + x[i]) >>> 0, true);
}

// BlockMix（RFC 7914 §4）：输入 2r 个 64 字节子块 → 输出重排后的 2r 子块
function blockMix(B, r) {
  const out = new Uint8Array(128 * r);
  const X = B.slice((2 * r - 1) * 64, (2 * r - 1) * 64 + 64); // 最后一个子块
  const Y = new Uint8Array(128 * r);
  for (let i = 0; i < 2 * r; i++) {
    // T = X xor B_i
    for (let k = 0; k < 64; k++) X[k] ^= B[i * 64 + k];
    salsa20_8(X);
    Y.set(X, i * 64);
  }
  // 输出交错：Y0,Y2,...,Y_{2r-2},Y1,Y3,...,Y_{2r-1}
  for (let i = 0; i < r; i++) {
    out.set(Y.subarray((2 * i) * 64, (2 * i) * 64 + 64), i * 64);
    out.set(Y.subarray((2 * i + 1) * 64, (2 * i + 1) * 64 + 64), (r + i) * 64);
  }
  return out;
}

// Integerify：取 X 最后 64 字节子块的前 4 字节（小端 32 位）
function integerify(B, r) {
  const off = (2 * r - 1) * 64;
  return (B[off] | (B[off + 1] << 8) | (B[off + 2] << 16) | (B[off + 3] << 24)) >>> 0;
}

// ROMix（RFC 7914 §5）：内存硬化
function roMix(B, N, r) {
  let X = B.slice();
  const V = new Array(N);
  for (let i = 0; i < N; i++) {
    V[i] = X.slice();
    X = blockMix(X, r);
  }
  for (let i = 0; i < N; i++) {
    const j = integerify(X, r) % N;
    for (let k = 0; k < 128 * r; k++) X[k] ^= V[j][k];
    X = blockMix(X, r);
  }
  return X;
}

// ============================================================
// PBKDF2-HMAC-SHA256（WebCrypto）
// ============================================================
async function pbkdf2Sha256(pass, salt, iterations, dkLen) {
  const key = await crypto.subtle.importKey("raw", pass, { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key, dkLen * 8,
  );
  return new Uint8Array(bits);
}

// ============================================================
// scrypt 主函数（RFC 7914）
// ============================================================
async function scrypt(pass, salt, N, r, p, dkLen) {
  // 参数校验（RFC 7914 §2）
  if (N < 2 || (N & (N - 1)) !== 0) throw new Error("N 须为 >1 的 2 的幂");
  if (r <= 0 || p <= 0) throw new Error("r, p 须为正整数");
  if (r * p >= (1 << 30)) throw new Error("r*p 过大（须 < 2^30）");
  const B = await pbkdf2Sha256(pass, salt, 1, p * 128 * r);
  for (let i = 0; i < p; i++) {
    const Bi = B.subarray(i * 128 * r, (i + 1) * 128 * r);
    const mixed = roMix(Bi.slice(), N, r);
    B.set(mixed, i * 128 * r);
  }
  return pbkdf2Sha256(pass, B, 1, dkLen);
}

// ============================================================
// run 入口
// ============================================================
function decodeInput(s, enc) {
  const t = String(s || "");
  if (enc === "hex") return hexToBytes(t.trim());
  if (enc === "base64") {
    const bin = atob(t.trim().replace(/\s/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(t);
}

async function scryptRun(text, p = {}) {
  const lines = [];
  lines.push("=== scrypt 口令密钥派生（RFC 7914，内存硬化 KDF）===");
  lines.push("");
  const passEnc = p.passEnc || "utf8";
  const saltEnc = p.saltEnc || "utf8";
  const pass = decodeInput(text, passEnc);
  const salt = decodeInput(p.salt != null ? p.salt : "", saltEnc);
  const N = parseInt(p.N, 10) || 16384;
  const r = parseInt(p.r, 10) || 8;
  const pp = parseInt(p.p, 10) || 1;
  const dkLen = parseInt(p.dkLen, 10) || 32;
  lines.push(`口令: ${pass.length} 字节（${passEnc}）`);
  lines.push(`盐:   ${salt.length} 字节（${saltEnc}）`);
  lines.push(`参数: N=${N}, r=${r}, p=${pp}, dkLen=${dkLen}`);
  // 内存占用提示
  const memMB = (128 * r * N) / (1024 * 1024);
  lines.push(`预计内存: ~${memMB.toFixed(1)} MB（128·r·N）`);
  lines.push("");
  try {
    const dk = await scrypt(pass, salt, N, r, pp, dkLen);
    lines.push("--- 派生密钥 (Derived Key) ---");
    lines.push("hex:    " + bytesToHex(dk));
    lines.push("base64: " + bytesToB64(dk));
  } catch (e) {
    lines.push("✗ " + (e.message || String(e)));
  }
  return lines.join("\n");
}

register({
  id: "scrypt",
  cat: "crypto",
  name: "scrypt 密钥派生",
  desc: "scrypt 内存硬化口令密钥派生（RFC 7914）：Salsa20/8 + BlockMix + ROMix 内存硬化，抗 ASIC/GPU 爆破。用于磁盘加密、加密货币钱包、口令存储。参数 N（2 的幂）/r/p/dkLen。",
  params: [
    { key: "passEnc", label: "口令编码", type: "select", default: "utf8", options: [
      { value: "utf8", label: "UTF-8 文本" }, { value: "hex", label: "Hex" }, { value: "base64", label: "Base64" },
    ] },
    { key: "salt", label: "盐 (salt)", type: "text", default: "", placeholder: "盐值" },
    { key: "saltEnc", label: "盐编码", type: "select", default: "utf8", options: [
      { value: "utf8", label: "UTF-8 文本" }, { value: "hex", label: "Hex" }, { value: "base64", label: "Base64" },
    ] },
    { key: "N", label: "N（CPU/内存代价，2 的幂）", type: "number", default: 16384, placeholder: "16384" },
    { key: "r", label: "r（块大小）", type: "number", default: 8, placeholder: "8" },
    { key: "p", label: "p（并行度）", type: "number", default: 1, placeholder: "1" },
    { key: "dkLen", label: "输出字节数 dkLen", type: "number", default: 32, placeholder: "32" },
  ],
  run: scryptRun,
});

export { scrypt, salsa20_8, blockMix, roMix };
