/*
 * slhdsa.js — SLH-DSA（Hash-based Digital Signature Algorithm）keygen / sign / verify
 *
 * 标准：FIPS 205（final，2024-08-13）。算法号引用 FIPS 205 编号：
 *   Alg 18 = slh_keygen    Alg 19 = slh_keygen_internal
 *   Alg 21 = slh_sign      Alg 22 = slh_sign_internal（确定性）
 *   Alg 23 = slh_verify    Alg 24 = slh_verify_internal
 *   §10.2 = 签名/验签主流程，§11 = 地址结构（Table 2 参数集，Table 4 地址字段）
 *
 * 数学核心（与 ML-DSA/Ed25519 无共享，纯哈希树，自实现；底层不 import mldsa 数学）：
 *   WOTS+（w=16 链式哈希，§8）· FORS（t 参数树，§9）· hypertree（XMSS 层 d/T，§10.1）
 *   ADRSG 地址结构（8×uint32，§11 Table 4，SHA2 偏移见 ref/sha2_offsets.h）
 *   T_l / F / PRF / H_msg 分工（§5.3，ref/hash_sha2.c）
 * 参数组（FIPS 205 §11 Table 2，实测自 sphincsplus ref/params/*.h，与卡上数字一致）：
 *   128s n=16 h=63 d=7 FORS_H=12 FORS_T=14（全 SHA-256）
 *   128f n=16 h=66 d=22 FORS_H=6  FORS_T=33（全 SHA-256）
 *   192s n=24 h=63 d=7 FORS_H=14 FORS_T=17（H / T_l(l≥2) 用 SHA-512）
 *   256s n=32 h=64 d=8 FORS_H=14 FORS_T=22（H / T_l(l≥2) 用 SHA-512）
 *   （SPX_SHA512 宏：192s/256s 为 1，H/HMAC/MGF1 与 T_l 多块用 SHA-512；PRF/F 恒 SHA-256。）
 *
 * 验证：NIST ACVP-Server SlhdsaKeyGen/SigGen/SigVer FIPS205 官方向量全过（含负例）；node 直跑。
 *
 * op id：slhdsaKeyGen / slhdsaSign / slhdsaVerify。
 */

import { register } from "./registry.js";

// ============================================================
// 字节工具
// ============================================================

function hexToBytes(hex) {
  let h = String(hex == null ? "" : hex).replace(/^0x/i, "").replace(/\s+/g, "");
  if (!h) return new Uint8Array(0);
  if (h.length % 2) h = "0" + h;
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error(`含非 hex 字符: ${hex}`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function concatBytes(...arrs) {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

/** 大端 u64 → 8 字节。 */
function ullToBytes8(v) {
  const b = new Uint8Array(8);
  let x = BigInt(v);
  for (let i = 7; i >= 0; i--) { b[i] = Number(x & 0xffn); x >>= 8n; }
  return b;
}

/** 大端 u32 → 4 字节。 */
function u32ToBytes(v) {
  const b = new Uint8Array(4);
  const x = v >>> 0;
  b[0] = (x >> 24) & 0xff; b[1] = (x >> 16) & 0xff; b[2] = (x >> 8) & 0xff; b[3] = x & 0xff;
  return b;
}

function bytesToUllBE(inp, inlen) {
  let r = 0n;
  for (let i = 0; i < inlen; i++) r = (r << 8n) | BigInt(inp[i]);
  return r;
}

function randomBytes(n) {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    const b = new Uint8Array(n);
    c.getRandomValues(b);
    return b;
  }
  throw new Error("无可用 CSPRNG（crypto.getRandomValues），无法生成随机种子");
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ============================================================
// 参数集（FIPS 205 §11 Table 2）
// ============================================================

const PARAM_SETS = {
  "128s": { n: 16, h: 63, d: 7, forsHeight: 12, forsTrees: 14, sha512: false },
  "128f": { n: 16, h: 66, d: 22, forsHeight: 6, forsTrees: 33, sha512: false },
  "192s": { n: 24, h: 63, d: 7, forsHeight: 14, forsTrees: 17, sha512: true },
  "256s": { n: 32, h: 64, d: 8, forsHeight: 14, forsTrees: 22, sha512: true },
};

function getSet(key) {
  const name = String(key == null ? "128s" : key)
    .replace(/^SLH-DSA-SHA2-/i, "").replace(/^SLH-DSA-SHAKE-/i, "")
    .replace(/^SPHINCS\s*-/i, "").replace(/^SPHINCS\s*\+\s*-/i, "")
    .trim();
  const b = PARAM_SETS[name];
  if (!b) throw new Error(`未知参数集: ${key}（可选 SLH-DSA-SHA2-128s / 128f / 192s / 256s）`);
  const wotsLogW = 4;                       // w=16
  const wotsLen1 = (8 * b.n) / wotsLogW;    // 2n
  const wotsLen2 = 3;                        // n≤136 → 3（ref params.h）
  const wotsLen = wotsLen1 + wotsLen2;
  const treeHeight = b.h / b.d;
  const forsMsgBytes = Math.ceil((b.forsHeight * b.forsTrees) / 8);
  const forsBytes = (b.forsHeight + 1) * b.forsTrees * b.n;
  const wotsBytes = wotsLen * b.n;
  const treeBits = treeHeight * (b.d - 1);
  const treeBytes = Math.ceil(treeBits / 8);
  const leafBytes = Math.ceil(treeHeight / 8);
  const dgstBytes = forsMsgBytes + treeBytes + leafBytes;
  return {
    name, ...b, wotsLogW, wotsLen1, wotsLen2, wotsLen, treeHeight,
    forsMsgBytes, forsBytes, wotsBytes, treeBits, treeBytes, leafBytes, dgstBytes,
    pkLen: 2 * b.n,
    skLen: 4 * b.n,
    sigLen: b.n + forsBytes + b.d * wotsBytes + b.h * b.n,
  };
}

// ============================================================
// SHA-256（纯 JS 32 位，FIPS 180-4）
// ============================================================

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256(msg) {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const l = msg.length;
  const bitLen = l * 8;
  let padLen = (56 - (l + 1) % 64 + 64) % 64;
  const total = l + 1 + padLen + 8;
  const padded = new Uint8Array(total);
  padded.set(msg, 0);
  padded[l] = 0x80;
  const bitLenB = BigInt(bitLen);
  for (let i = 0; i < 8; i++) padded[total - 1 - i] = Number((bitLenB >> BigInt(8 * i)) & 0xffn);

  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (padded[off + i * 4] << 24) | (padded[off + i * 4 + 1] << 16) | (padded[off + i * 4 + 2] << 8) | padded[off + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (H[i] >> 24) & 0xff; out[i * 4 + 1] = (H[i] >> 16) & 0xff;
    out[i * 4 + 2] = (H[i] >> 8) & 0xff; out[i * 4 + 3] = H[i] & 0xff;
  }
  return out;
}

// ============================================================
// SHA-512（纯 JS BigInt，FIPS 180-4；192s/256s 才用）
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
const MASK64L = (1n << 64n) - 1n;
const rotr64 = (x, n) => ((x >> n) | (x << (64n - n))) & MASK64L;

function sha512(msg) {
  let H = [0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
    0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n];
  const l = msg.length;
  const bitLen = BigInt(l) * 8n;
  let padLen = (112 - (l + 1) % 128 + 128) % 128;
  const total = l + 1 + padLen + 16;
  const padded = new Uint8Array(total);
  padded.set(msg, 0);
  padded[l] = 0x80;
  for (let i = 0; i < 8; i++) padded[total - 1 - i] = Number((bitLen >> BigInt(8 * i)) & 0xffn);

  const w = new Array(80);
  for (let off = 0; off < total; off += 128) {
    for (let i = 0; i < 16; i++) {
      let x = 0n;
      for (let j = 0; j < 8; j++) x = (x << 8n) | BigInt(padded[off + i * 8 + j]);
      w[i] = x;
    }
    for (let i = 16; i < 80; i++) {
      const s0 = rotr64(w[i - 15], 1n) ^ rotr64(w[i - 15], 8n) ^ (w[i - 15] >> 7n);
      const s1 = rotr64(w[i - 2], 19n) ^ rotr64(w[i - 2], 61n) ^ (w[i - 2] >> 6n);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) & MASK64L;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 80; i++) {
      const S1 = rotr64(e, 14n) ^ rotr64(e, 18n) ^ rotr64(e, 41n);
      const ch = (e & f) ^ (~e & MASK64L & g);
      const t1 = (h + S1 + ch + K512[i] + w[i]) & MASK64L;
      const S0 = rotr64(a, 28n) ^ rotr64(a, 34n) ^ rotr64(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) & MASK64L;
      h = g; g = f; f = e; e = (d + t1) & MASK64L; d = c; c = b; b = a; a = (t1 + t2) & MASK64L;
    }
    const hv = [a, b, c, d, e, f, g, h];
    for (let i = 0; i < 8; i++) H[i] = (H[i] + hv[i]) & MASK64L;
  }
  const out = new Uint8Array(64);
  for (let i = 0; i < 8; i++) {
    const hh = H[i];
    for (let j = 0; j < 8; j++) out[i * 8 + j] = Number((hh >> BigInt(56 - 8 * j)) & 0xffn);
  }
  return out;
}

// ============================================================
// ADRSG 地址结构（FIPS 205 §11 Table 4，32B；SHA2 偏移 ref/sha2_offsets.h）
// ============================================================
const ADDR_TYPE_WOTS = 0, ADDR_TYPE_WOTSPK = 1, ADDR_TYPE_HASHTREE = 2,
  ADDR_TYPE_FORSTREE = 3, ADDR_TYPE_FORSPK = 4, ADDR_TYPE_WOTSPRF = 5, ADDR_TYPE_FORSPRF = 6;

const ADDR_BYTES = 22; // SPX_SHA256_ADDR_BYTES

function newAddr() { return new Uint8Array(32); }
function setLayerAddr(addr, layer) { addr[0] = layer & 0xff; }
function setTreeAddr(addr, tree) { const b = ullToBytes8(tree); for (let i = 0; i < 8; i++) addr[1 + i] = b[i]; }
function setType(addr, type) { addr[9] = type & 0xff; }
function setKeypairAddr(addr, kp) { const b = u32ToBytes(kp); for (let i = 0; i < 4; i++) addr[10 + i] = b[i]; }
function setChainAddr(addr, chain) { addr[17] = chain & 0xff; }
function setHashAddr(addr, hash) { addr[21] = hash & 0xff; }
function setTreeHeight(addr, h) { addr[17] = h & 0xff; }
function setTreeIndex(addr, idx) { const b = u32ToBytes(idx); for (let i = 0; i < 4; i++) addr[18 + i] = b[i]; }
function copySubtreeAddr(out, inp) { for (let i = 0; i < 9; i++) out[i] = inp[i]; }
function copyKeypairAddr(out, inp) { for (let i = 0; i < 9; i++) out[i] = inp[i]; for (let i = 10; i < 14; i++) out[i] = inp[i]; }
function makeCtx(s, pubSeed, skSeed) {
  return { s, pubSeed, skSeed };
}

// 统一次哈希 T_l。inblocks：1（F）或 2+（T_l 多块）；in 为 inblocks*n 字节。
// thash(out, in, inblocks, ctx, addr) 写 n 字节到 out。
function thash(out, inp, inblocks, ctx, addr) {
  const s = ctx.s;
  const n = s.n;
  const data = inp.subarray(0, inblocks * n);
  if (inblocks > 1 && s.sha512) {
    // SHA-512 变体：pub_seed || 0^(128-n) || addr[0:22] || data
    const msg = concatBytes(ctx.pubSeed, new Uint8Array(128 - n), addr.subarray(0, ADDR_BYTES), data);
    out.set(sha512(msg).subarray(0, n));
  } else {
    // SHA-256：pub_seed || 0^(64-n) || addr[0:22] || data
    const msg = concatBytes(ctx.pubSeed, new Uint8Array(64 - n), addr.subarray(0, ADDR_BYTES), data);
    out.set(sha256(msg).subarray(0, n));
  }
}

// PRF(pk_seed, sk_seed, addr) → n 字节（恒用 SHA-256，ref hash_sha2.c prf_addr）
function prfAddr(out, ctx, addr) {
  const n = ctx.s.n;
  const msg = concatBytes(ctx.pubSeed, new Uint8Array(64 - n), addr.subarray(0, ADDR_BYTES), ctx.skSeed);
  out.set(sha256(msg).subarray(0, n));
}

// shaX：H / MGF1 / HMAC 用。n>=24 → SHA-512，否则 SHA-256
function shaX(s, msg) { return (s.sha512 ? sha512 : sha256)(msg); }
function shaXOutLen(s) { return s.sha512 ? 64 : 32; }

// MGF1-SHAX(out, outlen, in, inlen)
function mgf1X(s, out, outlen, inp) {
  const hlen = shaXOutLen(s);
  let off = 0;
  for (let i = 0; off < outlen; i++) {
    const digest = shaX(s, concatBytes(inp, u32ToBytes(i)));
    const take = Math.min(hlen, outlen - off);
    out.set(digest.subarray(0, take), off);
    off += take;
  }
}

// ============================================================
// base_w / WOTS+（FIPS 205 §8，w=16）
// ============================================================

function baseW(output, outLen, input) {
  let inIdx = 0, bits = 0, total = 0;
  for (let consumed = 0; consumed < outLen; consumed++) {
    if (bits === 0) { total = input[inIdx]; inIdx++; bits += 8; }
    bits -= 4;
    output[consumed] = (total >> bits) & 0xf;
  }
}

function wotsChainLengths(msg, s) {
  const lengths = new Uint8Array(s.wotsLen);
  baseW(lengths, s.wotsLen1, msg);
  let csum = 0;
  for (let i = 0; i < s.wotsLen1; i++) csum += 15 - lengths[i];
  csum = csum << ((8 - ((s.wotsLen2 * 4) % 8)) % 8);
  const csumBytes = new Uint8Array((s.wotsLen2 * 4 + 7) >> 3);
  const be = ullToBytes8(csum);
  csumBytes.set(be.subarray(8 - csumBytes.length));
  baseW(lengths.subarray(s.wotsLen1), s.wotsLen2, csumBytes);
  return lengths;
}

function genChain(out, inp, start, steps, ctx, addr) {
  const n = ctx.s.n;
  out.set(inp.subarray(0, n));
  for (let i = start; i < start + steps; i++) {
    if (i >= 16) break;
    setHashAddr(addr, i);
    thash(out.subarray(0, n), out.subarray(0, n), 1, ctx, addr);
  }
}

// WOTS 从签名恢复公钥
function wotsPkFromSig(pk, sig, msg, ctx, addr) {
  const s = ctx.s;
  const n = s.n;
  const lengths = wotsChainLengths(msg, s);
  for (let i = 0; i < s.wotsLen; i++) {
    setChainAddr(addr, i);
    genChain(pk.subarray(i * n), sig.subarray(i * n), lengths[i], 16 - 1 - lengths[i], ctx, addr);
  }
}

// WOTS 叶子生成（大树建房），leafIdx 为当前树内叶子索引，info: {wotsSig, wotsSteps, wotsSignLeaf, leafAddr, pkAddr}
// 写 n 字节叶子到 dest（gen_leaf 的 dest = current[N]）。
function wotsGenLeaf(dest, ctx, leafIdx, info) {
  const s = ctx.s;
  const n = s.n;
  const leafAddr = info.leafAddr.slice();
  const pkAddr = info.pkAddr.slice();
  setKeypairAddr(leafAddr, leafIdx);
  setKeypairAddr(pkAddr, leafIdx);
  const pkBuf = new Uint8Array(s.wotsBytes);
  const buf = new Uint8Array(n);
  const isSign = (leafIdx === info.wotsSignLeaf);
  for (let i = 0; i < s.wotsLen; i++) {
    const wotsK = isSign ? info.wotsSteps[i] : 0xffffffff;
    setChainAddr(leafAddr, i);
    setHashAddr(leafAddr, 0);
    setType(leafAddr, ADDR_TYPE_WOTSPRF);
    prfAddr(buf, ctx, leafAddr);
    setType(leafAddr, ADDR_TYPE_WOTS);
    for (let k = 0; ; k++) {
      if (k === wotsK) info.wotsSig.set(buf.subarray(0, n), i * n);
      if (k === 15) break;
      setHashAddr(leafAddr, k);
      thash(buf.subarray(0, n), buf.subarray(0, n), 1, ctx, leafAddr);
    }
    pkBuf.set(buf.subarray(0, n), i * n);
  }
  thash(dest.subarray(0, n), pkBuf, s.wotsLen, ctx, pkAddr);
}

// ============================================================
// 通用 Merkle TreeHash（utilsx1.c treehashx1）
// ============================================================
// genLeaf(dest, ctx, idx, info) → dest 写 n 字节叶子（dest = current[N..2N] 的可写槽）。
function treehashx1(root, authPath, ctx, leafIdx, idxOffset, treeHeight, genLeaf, treeAddr, info) {
  const s = ctx.s;
  const n = s.n;
  const stack = new Uint8Array(treeHeight * n);
  const current = new Uint8Array(2 * n);
  const maxIdx = (1 << treeHeight) - 1;
  for (let idx = 0; ; idx++) {
    genLeaf(current.subarray(n, 2 * n), ctx, idx + idxOffset, info);
    let internalIdxOffset = idxOffset;
    let internalIdx = idx;
    let internalLeaf = leafIdx;
    let stackTop = 0; // M 修（T369）：内层 let h 跨不出作用域；语义=新叶已合并到的层级
    for (let h = 0; ; h++, internalIdx >>= 1, internalLeaf >>= 1) {
      if (h === treeHeight) { root.set(current.subarray(n, 2 * n)); return; }
      if ((internalIdx ^ internalLeaf) === 1) {
        authPath.set(current.subarray(n, 2 * n), h * n);
      }
      if ((internalIdx & 1) === 0 && idx < maxIdx) break;
      internalIdxOffset >>= 1;
      setTreeHeight(treeAddr, h + 1);
      setTreeIndex(treeAddr, ((internalIdx >> 1) + internalIdxOffset) >>> 0);
      current.set(stack.subarray(h * n, (h + 1) * n), 0);
      thash(current.subarray(n, 2 * n), current.subarray(0, 2 * n), 2, ctx, treeAddr);
      stackTop = h + 1; // 每次 thash 上推一层
    }
    stack.set(current.subarray(n, 2 * n), stackTop * n);
  }
}

function computeRoot(root, leaf, leafIdx, idxOffset, authPath, treeHeight, ctx, addr) {
  const s = ctx.s;
  const n = s.n;
  const buf = new Uint8Array(2 * n);
  let leafIdxNum = leafIdx >>> 0;
  let idxOff = idxOffset >>> 0;
  if (leafIdxNum & 1) {
    buf.set(leaf.subarray(0, n), n);
    buf.set(authPath.subarray(0, n), 0);
  } else {
    buf.set(leaf.subarray(0, n), 0);
    buf.set(authPath.subarray(0, n), n);
  }
  let ap = n;
  for (let i = 0; i < treeHeight - 1; i++) {
    leafIdxNum >>= 1; idxOff >>= 1;
    setTreeHeight(addr, i + 1);
    setTreeIndex(addr, (leafIdxNum + idxOff) >>> 0);
    const tmp = new Uint8Array(n);
    if ((leafIdxNum & 1) === 1) {
      thash(tmp.subarray(0, n), buf, 2, ctx, addr);
      buf.set(tmp.subarray(0, n), n);
      buf.set(authPath.subarray(ap, ap + n), 0);
    } else {
      thash(tmp.subarray(0, n), buf, 2, ctx, addr);
      buf.set(tmp.subarray(0, n), 0);
      buf.set(authPath.subarray(ap, ap + n), n);
    }
    ap += n;
  }
  leafIdxNum >>= 1; idxOff >>= 1;
  setTreeHeight(addr, treeHeight);
  setTreeIndex(addr, (leafIdxNum + idxOff) >>> 0);
  thash(root.subarray(0, n), buf, 2, ctx, addr);
}

// ============================================================
// FORS（FIPS 205 §9）
// ============================================================

function messageToIndices(indices, m, s) {
  let offset = 0;
  for (let i = 0; i < s.forsTrees; i++) {
    let idx = 0;
    for (let j = 0; j < s.forsHeight; j++) {
      const bit = (m[offset >> 3] >> (~offset & 7)) & 1;
      idx ^= bit << (s.forsHeight - 1 - j);
      offset++;
    }
    indices[i] = idx >>> 0;
  }
}

// FORS 叶子：prf(addr) 产生 SK，再 T_l 还原 leaf。写 n 字节到 dest（dest = current[N..2N]）。
function forsGenLeaf(dest, ctx, addrIdx, info) {
  const s = ctx.s;
  const n = s.n;
  const leafAddr = info.leafAddr.slice();
  setTreeIndex(leafAddr, addrIdx);
  setType(leafAddr, ADDR_TYPE_FORSPRF);
  const buf = new Uint8Array(n);
  prfAddr(buf, ctx, leafAddr);
  setType(leafAddr, ADDR_TYPE_FORSTREE);
  thash(dest.subarray(0, n), buf, 1, ctx, leafAddr);
}

function forsSign(sig, pk, m, ctx, forsAddr) {
  const s = ctx.s;
  const n = s.n;
  const t = s.forsTrees;
  const indices = new Uint32Array(t);
  messageToIndices(indices, m, s);
  const roots = new Uint8Array(t * n);
  const forsTreeAddr = forsAddr.slice();
  const forsLeafAddr = forsAddr.slice();
  const forsPkAddr = forsAddr.slice();
  setType(forsPkAddr, ADDR_TYPE_FORSPK);
  let sigOff = 0;
  for (let i = 0; i < t; i++) {
    const idxOffset = i * (1 << s.forsHeight);
    setTreeHeight(forsTreeAddr, 0);
    setTreeIndex(forsTreeAddr, (indices[i] + idxOffset) >>> 0);
    // 存 FORS SK 部分：直接取 PRF 值，不经过 T_l
    setType(forsTreeAddr, ADDR_TYPE_FORSPRF);
    const skSlot = sig.subarray(sigOff, sigOff + n);
    prfAddr(skSlot, ctx, forsTreeAddr);
    setType(forsTreeAddr, ADDR_TYPE_FORSTREE);
    const authPath = sig.subarray(sigOff + n, sigOff + (s.forsHeight + 1) * n);
    const rootSlot = roots.subarray(i * n, i * n + n);
    const info = { leafAddr: forsLeafAddr };
    treehashx1(rootSlot, authPath, ctx, indices[i], idxOffset, s.forsHeight,
      forsGenLeaf, forsTreeAddr, info);
    sigOff += (s.forsHeight + 1) * n;
  }
  thash(pk.subarray(0, n), roots, t, ctx, forsPkAddr);
}

function forsPkFromSig(pk, sig, m, ctx, forsAddr) {
  const s = ctx.s;
  const n = s.n;
  const t = s.forsTrees;
  const indices = new Uint32Array(t);
  messageToIndices(indices, m, s);
  const roots = new Uint8Array(t * n);
  const forsTreeAddr = forsAddr.slice();
  const forsPkAddr = forsAddr.slice();
  setType(forsTreeAddr, ADDR_TYPE_FORSTREE);
  setType(forsPkAddr, ADDR_TYPE_FORSPK);
  let sigOff = 0;
  const leaf = new Uint8Array(n);
  for (let i = 0; i < t; i++) {
    const idxOffset = i * (1 << s.forsHeight);
    setTreeHeight(forsTreeAddr, 0);
    setTreeIndex(forsTreeAddr, (indices[i] + idxOffset) >>> 0);
    forsSkToLeaf(leaf, sig.subarray(sigOff, sigOff + n), ctx, forsTreeAddr);
    sigOff += n;
    const rootSlot = roots.subarray(i * n, i * n + n);
    computeRoot(rootSlot, leaf, indices[i], idxOffset, sig.subarray(sigOff, sigOff + s.forsHeight * n), s.forsHeight, ctx, forsTreeAddr);
    sigOff += s.forsHeight * n;
  }
  thash(pk.subarray(0, n), roots, t, ctx, forsPkAddr);
}

function forsSkToLeaf(leaf, sk, ctx, leafAddr) {
  thash(leaf.subarray(0, ctx.s.n), sk.subarray(0, ctx.s.n), 1, ctx, leafAddr);
}

// ============================================================
// hypertree / Merkle（FIPS 205 §10.1）
// ============================================================

// 生成一个子树（layer i）的 WOTS 签名 + auth path + root。
function merkleSign(sig, root, ctx, wotsAddr, treeAddr, leafIdx) {
  const s = ctx.s;
  const n = s.n;
  const authPath = sig.subarray(s.wotsBytes, s.wotsBytes + s.treeHeight * n);
  const info = {
    wotsSig: sig.subarray(0, s.wotsBytes),
    wotsSteps: wotsChainLengths(root, s),
    wotsSignLeaf: leafIdx,
    leafAddr: wotsAddr.slice(),
    pkAddr: wotsAddr.slice(),
  };
  setType(treeAddr, ADDR_TYPE_HASHTREE);
  setType(info.pkAddr, ADDR_TYPE_WOTSPK);
  setType(info.leafAddr, ADDR_TYPE_WOTSPRF);
  treehashx1(root.subarray(0, n), authPath, ctx, leafIdx, 0, s.treeHeight,
    (dest, ctx2, idx, info2) => wotsGenLeaf(dest, ctx, idx, info), treeAddr, info);
}

// keygen：顶层子树（layer d-1）建房求 root（不生成签名）。
function merkleGenTopRoot(root, ctx) {
  const s = ctx.s;
  const n = s.n;
  const topTreeAddr = newAddr();
  const wotsAddr = newAddr();
  setLayerAddr(topTreeAddr, s.d - 1);
  setLayerAddr(wotsAddr, s.d - 1);
  const info = {
    wotsSig: new Uint8Array(s.wotsBytes),
    wotsSteps: new Uint8Array(s.wotsLen),
    wotsSignLeaf: 0xffffffff,
    leafAddr: wotsAddr.slice(),
    pkAddr: wotsAddr.slice(),
  };
  setType(topTreeAddr, ADDR_TYPE_HASHTREE);
  setType(info.pkAddr, ADDR_TYPE_WOTSPK);
  setType(info.leafAddr, ADDR_TYPE_WOTSPRF);
  treehashx1(root.subarray(0, n), new Uint8Array(s.treeHeight * n), ctx, 0, 0, s.treeHeight,
    (dest, ctx2, idx, info2) => wotsGenLeaf(dest, ctx, idx, info), topTreeAddr, info);
}

// ============================================================
// H_msg / R（FIPS 205 §10.2，hash_sha2.c）
// ============================================================

// HMAC-SHAX：HMAC(sk_prf, optrand || pre || m)，取前 n 字节 → R
function genMessageRandom(R, skPrf, optrand, pre, m, ctx) {
  const s = ctx.s;
  const n = s.n;
  const block = s.sha512 ? 128 : 64;
  const hash = (x) => shaX(s, x); // M 修（代理死前未完成）：shaX 需两参（s,msg），此处取的是部分应用
  const ipad = new Uint8Array(block);
  for (let i = 0; i < n; i++) ipad[i] = 0x36 ^ skPrf[i];
  for (let i = n; i < block; i++) ipad[i] = 0x36;
  const inner = hash(concatBytes(ipad, optrand, pre, m));
  const opad = new Uint8Array(block);
  for (let i = 0; i < n; i++) opad[i] = 0x5c ^ skPrf[i];
  for (let i = n; i < block; i++) opad[i] = 0x5c;
  const outer = hash(concatBytes(opad, inner));
  R.set(outer.subarray(0, n));
}

// hash_message：seed = SHA-X(R || FULL_PK || pre || m)，H_msg = MGF1-SHAX(R || pub_seed || seed)，
// 拆分 FORS_MSG / tree / leaf。返回 { tree: bigint, leafIdx }。
function hashMessage(mhash, R, pk, pre, m, ctx) {
  const s = ctx.s;
  const n = s.n;
  const shOut = shaXOutLen(s);
  const hash = (x) => shaX(s, x); // M 修（代理死前未完成）：shaX 需两参（s,msg），此处取的是部分应用
  const seed = new Uint8Array(2 * n + shOut);
  seed.set(R, 0);
  seed.set(pk.subarray(0, n), n);           // PUB_SEED
  const inner = hash(concatBytes(R, pk, pre, m)); // FULL_PK
  seed.set(inner.subarray(0, shOut), 2 * n);
  const dgst = new Uint8Array(s.dgstBytes);
  mgf1X(s, dgst, s.dgstBytes, seed);
  mhash.set(dgst.subarray(0, s.forsMsgBytes));
  let off = s.forsMsgBytes;
  let tree = bytesToUllBE(dgst.subarray(off, off + s.treeBytes), s.treeBytes);
  off += s.treeBytes;
  let leafIdx = Number(bytesToUllBE(dgst.subarray(off, off + s.leafBytes), s.leafBytes));
  off += s.leafBytes;
  if (s.d !== 1) tree = tree & ((1n << BigInt(s.treeBits)) - 1n);
  else tree = 0n;
  leafIdx = leafIdx & ((1 << s.treeHeight) - 1);
  return { tree, leafIdx };
}

// ============================================================
// 顶层：keygen / sign / verify
// ============================================================

/** KeyGen（FIPS 205 Alg 18）：seed(3n B = SK.seed‖SK.PRF‖PK.seed) → pk(2n B), sk(4n B)。 */
export function slhdsaKeyGenBytes(setKey, seedHex) {
  const s = getSet(setKey);
  const n = s.n;
  let seed;
  if (seedHex == null || String(seedHex).trim() === "") {
    seed = randomBytes(3 * n);
  } else {
    seed = hexToBytes(seedHex);
    if (seed.length !== 3 * n) throw new Error(`种子须为 ${3 * n} 字节 hex（当前 ${seed.length}）`);
  }
  const skSeed = seed.subarray(0, n);
  const skPrf = seed.subarray(n, 2 * n);
  const pubSeed = seed.subarray(2 * n, 3 * n);
  const ctx = makeCtx(s, pubSeed.slice(), skSeed.slice());
  const pk = new Uint8Array(2 * n);
  const sk = new Uint8Array(4 * n);
  sk.set(skSeed, 0);
  sk.set(skPrf, n);
  sk.set(pubSeed, 2 * n);
  merkleGenTopRoot(sk.subarray(3 * n, 4 * n), ctx);
  pk.set(pubSeed, 0);
  pk.set(sk.subarray(3 * n, 4 * n), n);
  return { set: s.name, s, pk, sk };
}

/** Sign（FIPS 205 §10.2 slh_sign）。rndHex 空 → 确定性（addrnd=PK.seed）；指定 → hedged。 */
export function slhdsaSignBytes(setKey, skHex, msg, ctxStr, rndHex) {
  const s = getSet(setKey);
  const n = s.n;
  const sk = hexToBytes(skHex);
  if (sk.length !== s.skLen) throw new Error(`sk 长度错误：SLH-DSA-${s.name} 应为 ${s.skLen} 字节，实得 ${sk.length}`);
  const skSeed = sk.subarray(0, n);
  const skPrf = sk.subarray(n, 2 * n);
  const pk = sk.subarray(2 * n, 4 * n); // PUB_SEED || root
  const pubSeed = pk.subarray(0, n);
  const ctx = makeCtx(s, pubSeed.slice(), skSeed.slice());

  // pre = 0x00 || |ctx| || ctx（FIPS 205 §10.2 build_pre）
  // ctxStr 为字符串 → UTF-8；为 Uint8Array/Buffer → 原字节直用（ACVP 二进制 context 兼容）
  let ctxB;
  if (ctxStr instanceof Uint8Array) ctxB = ctxStr;
  else if (ctxStr && typeof ctxStr === "object" && typeof ctxStr.length === "number") ctxB = new Uint8Array(ctxStr);
  else ctxB = new TextEncoder().encode(ctxStr == null ? "" : String(ctxStr));
  if (ctxB.length > 255) throw new Error(`上下文 ctx 须 ≤255 字节（当前 ${ctxB.length}）`);
  const pre = new Uint8Array(2 + ctxB.length);
  pre[0] = 0x00;
  pre[1] = ctxB.length;
  pre.set(ctxB, 2);

  // optrand（addrnd）
  let optrand;
  if (rndHex == null || String(rndHex).trim() === "") optrand = pubSeed;
  else {
    optrand = hexToBytes(rndHex);
    if (optrand.length !== n) throw new Error(`rnd 须为 ${n} 字节 hex（当前 ${optrand.length}）`);
  }

  const R = new Uint8Array(n);
  genMessageRandom(R, skPrf, optrand, pre, msg, ctx);

  const mhash = new Uint8Array(s.forsMsgBytes);
  const hm = hashMessage(mhash, R, pk, pre, msg, ctx);
  let tree = hm.tree, leafIdx = hm.leafIdx;

  const sig = new Uint8Array(s.sigLen);
  sig.set(R, 0);
  let off = n;
  const wotsAddr = newAddr();
  const treeAddr = newAddr();
  setType(wotsAddr, ADDR_TYPE_WOTS);
  setType(treeAddr, ADDR_TYPE_HASHTREE);
  setTreeAddr(wotsAddr, tree);
  setKeypairAddr(wotsAddr, leafIdx);
  const forsRoot = new Uint8Array(n);
  forsSign(sig.subarray(off, off + s.forsBytes), forsRoot, mhash, ctx, wotsAddr);
  off += s.forsBytes;
  let root = forsRoot;
  for (let i = 0; i < s.d; i++) {
    setLayerAddr(treeAddr, i);
    setTreeAddr(treeAddr, tree);
    copySubtreeAddr(wotsAddr, treeAddr);
    setKeypairAddr(wotsAddr, leafIdx);
    merkleSign(sig.subarray(off, off + s.wotsBytes + s.treeHeight * n), root, ctx, wotsAddr, treeAddr, leafIdx);
    off += s.wotsBytes + s.treeHeight * n;
    leafIdx = Number(tree & BigInt((1 << s.treeHeight) - 1));
    tree = tree >> BigInt(s.treeHeight);
  }
  return { set: s.name, s, sig };
}

/** Verify（FIPS 205 §10.2 slh_verify）。 */
export function slhdsaVerifyBytes(setKey, pkHex, msg, ctxStr, sigHex) {
  const s = getSet(setKey);
  const n = s.n;
  const pk = hexToBytes(pkHex);
  const sig = hexToBytes(sigHex);
  const detail = { sigLen: sig.length, expectedSigLen: s.sigLen, pkLen: pk.length, expectedPkLen: s.pkLen };
  if (sig.length !== s.sigLen) return { valid: false, reason: "签名长度不符", ...detail };

  const pubSeed = pk.subarray(0, n);
  const pubRoot = pk.subarray(n, 2 * n);
  const ctx = makeCtx(s, pubSeed.slice(), new Uint8Array(n));

  const ctxB = (ctxStr instanceof Uint8Array) ? ctxStr
    : (ctxStr && typeof ctxStr === "object" && typeof ctxStr.length === "number") ? new Uint8Array(ctxStr)
    : new TextEncoder().encode(ctxStr == null ? "" : String(ctxStr));
  if (ctxB.length > 255) return { valid: false, reason: "上下文 ctx >255 字节", ...detail };
  const pre = new Uint8Array(2 + ctxB.length);
  pre[0] = 0x00;
  pre[1] = ctxB.length;
  pre.set(ctxB, 2);

  const R = sig.subarray(0, n);
  const mhash = new Uint8Array(s.forsMsgBytes);
  const hm = hashMessage(mhash, R, pk, pre, msg, ctx);
  let tree = hm.tree, leafIdx = hm.leafIdx;

  let off = n;
  const wotsAddr = newAddr();
  const treeAddr = newAddr();
  const wotsPkAddr = newAddr();
  setType(wotsAddr, ADDR_TYPE_WOTS);
  setType(treeAddr, ADDR_TYPE_HASHTREE);
  setType(wotsPkAddr, ADDR_TYPE_WOTSPK);
  setTreeAddr(wotsAddr, tree);
  setKeypairAddr(wotsAddr, leafIdx);
  let root = new Uint8Array(n);
  forsPkFromSig(root, sig.subarray(off, off + s.forsBytes), mhash, ctx, wotsAddr);
  off += s.forsBytes;

  for (let i = 0; i < s.d; i++) {
    setLayerAddr(treeAddr, i);
    setTreeAddr(treeAddr, tree);
    copySubtreeAddr(wotsAddr, treeAddr);
    setKeypairAddr(wotsAddr, leafIdx);
    copyKeypairAddr(wotsPkAddr, wotsAddr);
    const wotsPk = new Uint8Array(s.wotsBytes);
    wotsPkFromSig(wotsPk, sig.subarray(off, off + s.wotsBytes), root, ctx, wotsAddr);
    off += s.wotsBytes;
    const leaf = new Uint8Array(n);
    thash(leaf.subarray(0, n), wotsPk, s.wotsLen, ctx, wotsPkAddr);
    const newRoot = new Uint8Array(n);
    computeRoot(newRoot, leaf, leafIdx, 0, sig.subarray(off, off + s.treeHeight * n), s.treeHeight, ctx, treeAddr);
    off += s.treeHeight * n;
    root = newRoot;
    leafIdx = Number(tree & BigInt((1 << s.treeHeight) - 1));
    tree = tree >> BigInt(s.treeHeight);
  }
  const valid = bytesEqual(root, pubRoot);
  return { valid, reason: valid ? "根节点重算与公钥一致（哈希树验证通过）" : "根节点重算不符（哈希树验证失败）", ...detail };
}

// ============================================================
// op 包装
// ============================================================

const SET_OPTIONS = [
  { value: "128s", label: "SLH-DSA-SHA2-128s (签名 7856B, 慢)" },
  { value: "128f", label: "SLH-DSA-SHA2-128f (签名 17088B, 快)" },
  { value: "192s", label: "SLH-DSA-SHA2-192s (签名 16224B, 慢)" },
  { value: "256s", label: "SLH-DSA-SHA2-256s (签名 29792B, 慢)" },
];
const MSG_MODE_OPTIONS = [
  { value: "text", label: "文本 (UTF-8)" },
  { value: "hex", label: "Hex" },
];
const ENC = new TextEncoder();

function setSummary(s) {
  return `参数集: SLH-DSA-SHA2-${s.name} (n=${s.n}, h=${s.h}, d=${s.d}, FORS_H=${s.forsHeight}, FORS_T=${s.forsTrees}, 树高=${s.treeHeight}, WOTS_LEN=${s.wotsLen})`;
}

function msgBytes(t, mode) {
  const s0 = String(t == null ? "" : t);
  if (mode === "hex") return hexToBytes(s0.replace(/\s+/g, ""));
  return new TextEncoder().encode(s0);
}

register({
  id: "slhdsaKeyGen",
  family: "slhdsa", familyLabel: "keygen",
  cat: "asym",
  name: "SLH-DSA 密钥生成",
  desc: "FIPS 205 SLH-DSA-SHA2（后量子哈希签名）密钥对生成，种子 3n 字节可固定复现（Alg 18），纯 JS。顶层子树建房 2^树高 个 WOTS 叶子，秒级起",
  params: [
    { key: "set", label: "参数集", type: "select", default: "128s", options: SET_OPTIONS },
    { key: "seed", label: "种子 (hex 3n B，留空随机)", type: "text", default: "", placeholder: "SK.seed‖SK.PRF‖PK.seed，教学可固定" },
  ],
  run: (t, p = {}) => {
    const r = slhdsaKeyGenBytes(p.set, p.seed);
    return {
      text: [
        setSummary(r.s),
        `公钥 pk (${r.pk.length} B = PK.seed‖top-root):`,
        bytesToHex(r.pk),
        `私钥 sk (${r.sk.length} B = SK.seed‖SK.PRF‖PK.seed‖root):`,
        bytesToHex(r.sk),
        "",
        "sk ⚠ 敏感请妥善保管。点击下方按钮下载（hex 文本）。",
      ].join("\n"),
      files: [
        { name: `slhdsa${r.set}_pk.hex`, mime: "text/plain", bytes: ENC.encode(bytesToHex(r.pk) + "\n") },
        { name: `slhdsa${r.set}_sk.hex`, mime: "text/plain", bytes: ENC.encode(bytesToHex(r.sk) + "\n") },
      ],
    };
  },
});

register({
  id: "slhdsaSign",
  family: "slhdsa", familyLabel: "sign",
  cat: "asym",
  name: "SLH-DSA 签名",
  desc: "FIPS 205 签名：私钥 sk + 消息（text/hex）+ 上下文 ctx(≤255B)；hedged 随机 rnd 或确定性 rnd=空（Alg 22，R=HMAC(sk_prf, addrnd‖0x00‖|ctx|‖ctx‖M)）。纯哈希树 WOTS+/FORS/hypertree 逐层建房，128s/192s/256s 生成秒级起（~10^5 次哈希），128f 快但签名大",
  params: [
    { key: "set", label: "参数集", type: "select", default: "128s", options: SET_OPTIONS },
    { key: "sk", label: "私钥 sk (hex)", type: "text", default: "", placeholder: "密钥生成的 sk hex" },
    { key: "msgMode", label: "消息形式", type: "select", default: "text", options: MSG_MODE_OPTIONS },
    { key: "ctx", label: "上下文 ctx (≤255B，默认空)", type: "text", default: "", placeholder: "FIPS 205 §10.2 域分隔上下文" },
    { key: "rndMode", label: "随机性模式", type: "select", default: "hedged", options: [
      { value: "hedged", label: "随机 rnd（hedged）" },
      { value: "det", label: "确定性（rnd=PK.seed，可复现）" },
    ] },
    { key: "rnd", label: "rnd (hex n B，留空随机；det 忽略)", type: "text", default: "", placeholder: "教学复现可固定" },
  ],
  run: (t, p = {}) => {
    const s = getSet(p.set);
    const msg = msgBytes(t, p.msgMode);
    // det → 确定性（rnd 忽略）；hedged → 若 rnd 显式给 hex 则用之；留空仍走确定性（PK.seed）
    let rnd;
    if (p.rndMode === "det") rnd = null;
    else rnd = (String(p.rnd == null ? "" : p.rnd).trim() === "" ? null : p.rnd);
    const r = slhdsaSignBytes(p.set, p.sk, msg, p.ctx, rnd);
    return {
      text: [
        setSummary(s),
        `消息 M: ${msg.length} B（${p.msgMode === "hex" ? "hex" : "UTF-8"}）`,
        `签名 σ (${r.sig.length} B = R${s.n} + FORS${s.forsBytes} + ${s.d}×(WOTS${s.wotsBytes}+auth${s.treeHeight * s.n})):`,
        bytesToHex(r.sig),
        `注意：128s/192s/256s 生成慢（秒级起），128f 快但签名大。`,
      ].join("\n"),
      files: [
        { name: `slhdsa${r.set}.sig`, mime: "application/octet-stream", bytes: r.sig },
      ],
    };
  },
});

register({
  id: "slhdsaVerify",
  family: "slhdsa", familyLabel: "verify",
  cat: "asym",
  name: "SLH-DSA 验签",
  desc: "FIPS 205 验签：pk + 消息 + 签名 → 合法/不合法（FORS+HT 路径重算根节点比对公钥根）；签名长度不符直接判非法",
  params: [
    { key: "set", label: "参数集", type: "select", default: "128s", options: SET_OPTIONS },
    { key: "pk", label: "公钥 pk (hex)", type: "text", default: "", placeholder: "密钥生成的 pk hex" },
    { key: "sig", label: "签名 σ (hex)", type: "text", default: "", placeholder: "签名输出的 σ hex" },
    { key: "msgMode", label: "消息形式", type: "select", default: "text", options: MSG_MODE_OPTIONS },
    { key: "ctx", label: "上下文 ctx (≤255B，须与签名一致)", type: "text", default: "", placeholder: "FIPS 205 §10.2 域分隔上下文" },
  ],
  run: (t, p = {}) => {
    const s = getSet(p.set);
    const msg = msgBytes(t, p.msgMode);
    const r = slhdsaVerifyBytes(p.set, p.pk, msg, p.ctx, p.sig);
    const lines = [
      setSummary(s),
      `消息 M: ${msg.length} B（${p.msgMode === "hex" ? "hex" : "UTF-8"}），ctx: ${String(p.ctx || "").length} B`,
      `签名长度: ${r.sigLen}/${r.expectedSigLen} B ${r.sigLen === r.expectedSigLen ? "✓" : "✗"}`,
    ];
    lines.push(`结论: ${r.valid ? "✓ 合法（验证通过）" : "✗ 不合法"} — ${r.reason}`);
    return { text: lines.join("\n") };
  },
});

export { getSet }; // slhdsaVerifyBytes 已于函数声明处 export（代理死亡前的重复导出行，M 清理）
