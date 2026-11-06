/*
 * t842Hashes.js — CyberChef 对齐的 SHA2 / CTPH / Generate all hashes 候选实现（T842）。
 *
 * 只新增 op，不改既有哈希默认输出：
 *   sha2                —— 与 CC SHA2 同六档（224/256/384/512/512-224/512-256）+ Rounds
 *   ctph                —— 与 CC CTPH（ctph.js）同算法、同签名格式
 *   generateAllHashes   —— 与 CC Generate all hashes 同顺序/同标签填充/同 Length 过滤
 *
 * SHA-2 按 FIPS 180-4 实现；CTPH 按 Kornblum CTPH 论文与 ctph.js 参考语义实现；
 * 其余算法复用仓内既有 op（getOp），不复制实现。
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(s);
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// ============================================================
// SHA-2（FIPS 180-4）
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
const IV256 = {
  "224": [0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4],
  "256": [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19],
};
function sha256Bytes(msg, bits, rounds) {
  const iv = IV256[String(bits)];
  const outBytes = bits === 224 ? 28 : 32;
  const bitLenHi = Math.floor(msg.length / 0x20000000);
  const bitLenLo = (msg.length << 3) >>> 0;
  const paddedLen = (((msg.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(paddedLen - 8, bitLenHi, false);
  dv.setUint32(paddedLen - 4, bitLenLo, false);
  let H = iv.slice();
  const w = new Uint32Array(64);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let t = 0; t < 16; t++) w[t] = dv.getUint32(off + t * 4, false);
    for (let t = 16; t < 64; t++) {
      const s0 = ((w[t - 15] >>> 7) | (w[t - 15] << 25)) ^ ((w[t - 15] >>> 18) | (w[t - 15] << 14)) ^ (w[t - 15] >>> 3);
      const s1 = ((w[t - 2] >>> 17) | (w[t - 2] << 15)) ^ ((w[t - 2] >>> 19) | (w[t - 2] << 13)) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < rounds; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[t] + w[t]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H = H.map((v, i) => (v + [a, b, c, d, e, f, g, h][i]) >>> 0);
  }
  const out = new Uint8Array(outBytes);
  for (let i = 0; i < outBytes; i++) out[i] = (H[i >> 2] >>> (24 - (i & 3) * 8)) & 0xff;
  return out;
}

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
const IV512 = {
  "512": [0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n, 0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n],
  "384": [0xcbbb9d5dc1059ed8n, 0x629a292a367cd507n, 0x9159015a3070dd17n, 0x152fecd8f70e5939n, 0x67332667ffc00b31n, 0x8eb44a8768581511n, 0xdb0c2e0d64f98fa7n, 0x47b5481dbefa4fa4n],
  "512/224": [0x8c3d37c819544da2n, 0x73e1996689dcd4d6n, 0x1dfab7ae32ff9c82n, 0x679dd514582f9fcfn, 0x0f6d2b697bd44da8n, 0x77e36f7304c48942n, 0x3f9d85a86a1d36c8n, 0x1112e6ad91d692a1n],
  "512/256": [0x22312194fc2bf72cn, 0x9f555fa3c84c64c2n, 0x2393b86b6f53b151n, 0x963877195940eabdn, 0x96283ee2a88effe3n, 0xbe5e1e2553863992n, 0x2b0199fc2c85b8aan, 0x0eb72ddc81c52ca2n],
};
const OUT512 = { "512": 64, "384": 48, "512/224": 28, "512/256": 32 };
const MASK64 = (1n << 64n) - 1n;
const rotr64 = (x, n) => ((x >> n) | (x << (64n - n))) & MASK64;
function sha512Bytes(msg, bits, rounds) {
  const iv = IV512[String(bits)];
  const outBytes = OUT512[String(bits)];
  const iterations = Math.max(1, Math.floor(rounds / 2));
  const bitLen = BigInt(msg.length) * 8n;
  const padZeros = (128 - ((msg.length + 17) % 128)) % 128;
  const padded = new Uint8Array(msg.length + 1 + padZeros + 16);
  padded.set(msg);
  padded[msg.length] = 0x80;
  for (let i = 0; i < 16; i++) padded[padded.length - 1 - i] = Number((bitLen >> BigInt(8 * i)) & 0xffn);
  let H = iv.slice();
  const w = new Array(80).fill(0n);
  const dv = new DataView(padded.buffer);
  for (let off = 0; off < padded.length; off += 128) {
    for (let t = 0; t < 16; t++) w[t] = dv.getBigUint64(off + t * 8, false);
    for (let t = 16; t < 80; t++) {
      const s0 = rotr64(w[t - 15], 1n) ^ rotr64(w[t - 15], 8n) ^ (w[t - 15] >> 7n);
      const s1 = rotr64(w[t - 2], 19n) ^ rotr64(w[t - 2], 61n) ^ (w[t - 2] >> 6n);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) & MASK64;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let t = 0; t < iterations; t++) {
      const S1 = rotr64(e, 14n) ^ rotr64(e, 18n) ^ rotr64(e, 41n);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K512[t] + w[t]) & MASK64;
      const S0 = rotr64(a, 28n) ^ rotr64(a, 34n) ^ rotr64(a, 39n);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) & MASK64;
      h = g; g = f; f = e; e = (d + t1) & MASK64;
      d = c; c = b; b = a; a = (t1 + t2) & MASK64;
    }
    H = H.map((v, i) => (v + [a, b, c, d, e, f, g, h][i]) & MASK64);
  }
  const out = new Uint8Array(outBytes);
  for (let i = 0; i < outBytes; i++) out[i] = Number((H[i >> 3] >> BigInt(56 - (i & 7) * 8)) & 0xffn);
  return out;
}

function sha2Run(t, p = {}) {
  const size = String(p.size || "512");
  const raw = p.rawBytes;
  const msg = raw ? (raw instanceof Uint8Array ? raw : new Uint8Array(raw)) : te(String(t == null ? "" : t));
  if (size === "224" || size === "256") {
    const rounds = Math.max(16, Math.min(64, Number(p.rounds256 || 64)));
    return toHex(sha256Bytes(msg, Number(size), rounds));
  }
  if (["384", "512", "512/224", "512/256"].includes(size)) {
    const rounds = Math.max(32, Math.min(160, Number(p.rounds512 || 160)));
    return toHex(sha512Bytes(msg, size, rounds));
  }
  throw new Error("SHA2：未知 Size " + size);
}

register({
  id: "sha2",
  cat: "hash",
  name: "SHA-2（CC 六档）",
  desc: "SHA-2 全六档（SHA-512/384/256/224/512-256/512-224）+ Rounds，输出小写 hex；参数与 CyberChef SHA2 对齐。",
  acceptsBytes: true,
  params: [
    { key: "size", label: "Size", type: "select", default: "512", options: ["512", "384", "256", "224", "512/256", "512/224"] },
    { key: "rounds256", label: "Rounds（SHA-256 档）", type: "number", default: 64 },
    { key: "rounds512", label: "Rounds（SHA-512 档）", type: "number", default: 160 },
  ],
  run: sha2Run,
});

// ============================================================
// CTPH（Kornblum context triggered piecewise hashing）
// 与 CC 依赖 ctph.js 0.0.5 同算法（B64 字母表、FNV-1、滚动哈希、触发值 3<<bi）。
// ============================================================
const CTPH_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const HASH_PRIME = 0x01000193;
const HASH_INIT = 0x28021967;
function fnv1(base, b) { return ((base * HASH_PRIME) ^ b) >>> 0; }
class RollHash {
  constructor() { this.x = 0; this.y = 0; this.z = 0; this.c = 0; this.window = new Array(7).fill(0); }
  update(d) {
    this.y -= this.x;
    this.y += 7 * d;
    this.x += d;
    this.x -= this.window[this.c % 7] || 0;
    this.window[this.c % 7] = d;
    this.c++;
    this.z = (this.z << 5) >>> 0;
    this.z = (this.z ^ d) >>> 0;
  }
  sum() { return (this.x + this.y + this.z) >>> 0; }
}
function ctphPiecewise(bytes, triggerValue) {
  const signatures = ["", ""];
  let h1 = HASH_INIT, h2 = HASH_INIT;
  const rh = new RollHash();
  for (let i = 0; i < bytes.length; i++) {
    h1 = fnv1(h1, bytes[i]);
    h2 = fnv1(h2, bytes[i]);
    rh.update(bytes[i]);
    if (i === bytes.length - 1 || rh.sum() % triggerValue === triggerValue - 1) {
      signatures[0] += CTPH_B64.charAt(h1 & 63);
      h1 = HASH_INIT;
    }
    if (i === bytes.length - 1 || rh.sum() % (triggerValue * 2) === triggerValue * 2 - 1) {
      signatures[1] += CTPH_B64.charAt(h2 & 63);
      h2 = HASH_INIT;
    }
  }
  return signatures;
}
export function ctphDigest(bytes) {
  const minb = 3;
  let bi = Math.ceil(Math.log(bytes.length / (64 * minb)) / Math.log(2));
  bi = Math.max(3, bi);
  let signatures = ctphPiecewise(bytes, minb << bi);
  while (bi > 0 && signatures[0].length < 32) {
    signatures = ctphPiecewise(bytes, minb << --bi);
  }
  return CTPH_B64.charAt(bi) + ":" + signatures[0] + ":" + signatures[1];
}
function ctphRun(t, p = {}) {
  const raw = p.rawBytes;
  const bytes = raw ? (raw instanceof Uint8Array ? raw : new Uint8Array(raw)) : te(String(t == null ? "" : t));
  return ctphDigest(bytes);
}
register({ id: "ctph", cat: "hash", name: "CTPH（模糊哈希）", desc: "Context Triggered Piecewise Hashing（Kornblum 2006，ctph.js 同算法），输出 bi:hash1:hash2。", acceptsBytes: true, run: ctphRun });

// ============================================================
// Generate all hashes（CC 同顺序/同格式）
// ============================================================
const HASH_SPECS = [
  ["MD2", "md2", "bytes", {}],
  ["MD4", "md4", "bytes", {}],
  ["MD5", "md5", "bytes", {}],
  ["MD6", "md6", "bytes", {}],
  ["SHA0", "sha0", "bytes", {}],
  ["SHA1", "sha1", "bytes", { rounds: 80 }],
  ["SHA2 224", "sha2", "bytes", { size: "224" }],
  ["SHA2 256", "sha2", "bytes", { size: "256" }],
  ["SHA2 384", "sha2", "bytes", { size: "384" }],
  ["SHA2 512", "sha2", "bytes", { size: "512" }],
  ["SHA3 224", "sha3", "bytes", { bits: 224 }],
  ["SHA3 256", "sha3", "bytes", { bits: 256 }],
  ["SHA3 384", "sha3", "bytes", { bits: 384 }],
  ["SHA3 512", "sha3", "bytes", { bits: 512 }],
  ["Keccak 224", "keccak256", "bytes", { bits: 224 }],
  ["Keccak 256", "keccak256", "bytes", { bits: 256 }],
  ["Keccak 384", "keccak256", "bytes", { bits: 384 }],
  ["Keccak 512", "keccak256", "bytes", { bits: 512 }],
  ["Shake 128", "shake128", "bytes", { outLen: 32 }],
  ["Shake 256", "shake256", "bytes", { outLen: 64 }],
  ["RIPEMD-128", "ripemd160", "bytes", { size: 128 }],
  ["RIPEMD-160", "ripemd160", "bytes", { size: 160 }],
  ["RIPEMD-256", "ripemd160", "bytes", { size: 256 }],
  ["RIPEMD-320", "ripemd160", "bytes", { size: 320 }],
  ["HAS-160", "has160", "bytes", {}],
  ["Whirlpool-0", "whirlpoolHash", "bytes", { variant: "Whirlpool-0", rounds: 10 }],
  ["Whirlpool-T", "whirlpoolHash", "bytes", { variant: "Whirlpool-T", rounds: 10 }],
  ["Whirlpool", "whirlpoolHash", "bytes", { variant: "Whirlpool", rounds: 10 }],
  ["BLAKE2b-128", "blake2b", "bytes", { hashLen: 16, outFormat: "Hex" }],
  ["BLAKE2b-160", "blake2b", "bytes", { hashLen: 20, outFormat: "Hex" }],
  ["BLAKE2b-256", "blake2b", "bytes", { hashLen: 32, outFormat: "Hex" }],
  ["BLAKE2b-384", "blake2b", "bytes", { hashLen: 48, outFormat: "Hex" }],
  ["BLAKE2b-512", "blake2b", "bytes", { hashLen: 64, outFormat: "Hex" }],
  ["BLAKE2s-128", "blake2s", "bytes", { hashLen: 16, outFormat: "Hex" }],
  ["BLAKE2s-160", "blake2s", "bytes", { hashLen: 20, outFormat: "Hex" }],
  ["BLAKE2s-256", "blake2s", "bytes", { hashLen: 32, outFormat: "Hex" }],
  ["Streebog-256", "streebog", "bytes", { len: "256" }],
  ["Streebog-512", "streebog", "bytes", { len: "512" }],
  ["GOST", "gostHash", "bytes", { sbox: "D-A" }],
  ["LM Hash", "lmHash", "text", {}],
  ["NT Hash", "ntlm", "text", {}],
  ["SSDEEP", "ssdeep", "text", {}],
  ["CTPH", "ctph", "text", {}],
];
const ALL_LENGTHS = ["All", "128", "160", "224", "256", "320", "384", "512"];

function bytesToLatin1(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return s;
}

async function generateAllHashesRun(t, p = {}) {
  const { getOp } = await import("./registry.js");
  const raw = p.rawBytes;
  const bytes = raw ? (raw instanceof Uint8Array ? raw : new Uint8Array(raw)) : te(String(t == null ? "" : t));
  const text = raw ? bytesToLatin1(bytes) : String(t == null ? "" : t);
  const length = String(p.length || "All");
  const includeNames = p.includeNames !== false;
  let out = "";
  for (const [name, id, mode, params] of HASH_SPECS) {
    const op = getOp(id);
    if (!op) throw new Error("Generate all hashes：缺少 op " + id);
    const runParams = { ...params };
    let digest;
    if (mode === "bytes") {
      runParams.rawBytes = bytes;
      digest = await op.run(text, runParams);
    } else {
      digest = await op.run(text, runParams);
    }
    digest = String(digest == null ? "" : digest);
    if (length !== "All" && digest.length * 4 !== parseInt(length, 10)) continue;
    out += includeNames ? name + ":" + " ".repeat(13 - name.length) + digest + "\n" : digest + "\n";
  }
  return out;
}

register({
  id: "generateAllHashes",
  cat: "hash",
  name: "Generate all hashes（CC 对齐）",
  desc: "CyberChef Generate all hashes 对齐：按 CC 同顺序输出 44 个摘要（含 Whirlpool 三变体、GOST、SSDEEP、CTPH），支持 Length (bits) 过滤与 Include names。",
  acceptsBytes: true,
  params: [
    { key: "length", label: "Length (bits)", type: "select", default: "All", options: ALL_LENGTHS },
    { key: "includeNames", label: "Include names", type: "bool", default: true },
  ],
  run: generateAllHashesRun,
});

export { sha2Run, sha256Bytes, sha512Bytes, HASH_SPECS };
