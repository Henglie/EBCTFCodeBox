/*
 * shaExt.js — SHA-1/SHA-256 纯 JS 实现 + 长度扩展攻击 + 生日碰撞演示（cat:'analysis'）。
 *
 * 为什么存在：hashLengthExtension.js 只支持 MD5（SHA-1/256 op 走 WebCrypto，
 * 拿不到内部状态）。这里提供纯 JS SHA-1/SHA-256（标准 Merkle-Damgård），
 * 支持从已知 (hash, 原长) 构造长度扩展消息。
 *
 * 长度扩展：msg2 = orig || pad(orig) || append；从 origHash 状态继续压缩
 * pad(orig) 块和 append 块，得到 H(msg2)——不知道密钥也能伪造 MAC。
 *
 * 生日碰撞：小空间（bitLen 位输出）随机输入找碰撞（教学演示，n≈2^(b/2)）。
 *
 * 红线：算法层零 UI 依赖；纯本地；件内自注册。
 */
import { register } from "./registry.js";

const te = new TextEncoder();

// ============ SHA-1 ============
const SHA1_K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6];
function rotl32(v, r) { return ((v << r) | (v >>> (32 - r))) >>> 0; }
export function sha1CompressBlock(H, block) {
  const w = new Array(80);
  for (let i = 0; i < 16; i++) {
    w[i] = ((block[i * 4] << 24) | (block[i * 4 + 1] << 16) | (block[i * 4 + 2] << 8) | block[i * 4 + 3]) >>> 0;
  }
  for (let i = 16; i < 80; i++) w[i] = rotl32(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
  let [a, b, c, d, e] = H;
  for (let i = 0; i < 80; i++) {
    let f, k;
    if (i < 20) { f = (b & c) | (~b & d); k = SHA1_K[0]; }
    else if (i < 40) { f = b ^ c ^ d; k = SHA1_K[1]; }
    else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = SHA1_K[2]; }
    else { f = b ^ c ^ d; k = SHA1_K[3]; }
    const tmp = (rotl32(a, 5) + f + e + k + w[i]) >>> 0;
    e = d; d = c; c = rotl32(b, 30); b = a; a = tmp;
  }
  H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0;
  H[3] = (H[3] + d) >>> 0; H[4] = (H[4] + e) >>> 0;
}
export function sha1Hex(bytes) {
  const H = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const len = bytes.length;
  const pad = padMessage(len, 64);
  const blocks = chunkBlocks(bytes, pad, 64);
  for (const b of blocks) sha1CompressBlock(H, b);
  let s = "";
  for (const h of H) s += (h >>> 0).toString(16).padStart(8, "0");
  return s;
}

// ============ SHA-256 ============
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
function rotr32(v, r) { return ((v >>> r) | (v << (32 - r))) >>> 0; }
export function sha256CompressBlock(H, block) {
  const w = new Array(64);
  for (let i = 0; i < 16; i++) {
    w[i] = ((block[i * 4] << 24) | (block[i * 4 + 1] << 16) | (block[i * 4 + 2] << 8) | block[i * 4 + 3]) >>> 0;
  }
  for (let i = 16; i < 64; i++) {
    const s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
    const s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
  }
  let [a, b, c, d, e, f, g, h] = H;
  for (let i = 0; i < 64; i++) {
    const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
    const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) >>> 0;
    h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
  }
  H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
  H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
}
export function sha256Hex(bytes) {
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const len = bytes.length;
  const pad = padMessage(len, 64);
  const blocks = chunkBlocks(bytes, pad, 64);
  for (const b of blocks) sha256CompressBlock(H, b);
  let s = "";
  for (const h of H) s += (h >>> 0).toString(16).padStart(8, "0");
  return s;
}

// ============ 填充/分块（公共） ============
function padMessage(lenBytes, blockSize) {
  const padLen = (blockSize - ((lenBytes + 8) % blockSize)) % blockSize;
  const pad = new Uint8Array(padLen + 8);
  pad[0] = 0x80;
  const bits = BigInt(lenBytes) * 8n;
  for (let i = 0; i < 8; i++) pad[padLen + 7 - i] = Number((bits >> BigInt(8 * i)) & 0xffn);
  return pad;
}
function chunkBlocks(bytes, pad, blockSize) {
  const total = bytes.length + pad.length;
  const blocks = [];
  for (let off = 0; off < total; off += blockSize) {
    const blk = new Uint8Array(blockSize);
    for (let i = 0; i < blockSize; i++) {
      const src = off + i;
      blk[i] = src < bytes.length ? bytes[src] : pad[src - bytes.length];
    }
    blocks.push(blk);
  }
  return blocks;
}
function stateFromHex(hex, n) {
  const H = [];
  for (let i = 0; i < n; i++) H.push(parseInt(hex.substr(i * 8, 8), 16) >>> 0);
  return H;
}
function stateToHex(H) {
  let s = "";
  for (const h of H) s += (h >>> 0).toString(16).padStart(8, "0");
  return s;
}

/** SHA-1 长度扩展：已知 (hash, 原消息长度) 伪造 append 后的哈希。 */
export function sha1LengthExtension(origHashHex, origLenBytes, appendData) {
  const H = stateFromHex(origHashHex, 5);
  const appendBytes = te.encode(appendData);
  // victim 视角：M = secret || pad(secret) || append。secret+pad(secret) 构成完整块
  // （origHash 即其压缩后状态），攻击者从该状态继续压缩 append + victim 填充。
  const padOrig = padMessage(origLenBytes, 64);
  const totalLen = origLenBytes + padOrig.length + appendBytes.length;
  const padLen = (64 - ((totalLen + 8) % 64)) % 64 + 8;
  const pad2 = new Uint8Array(padLen);
  pad2[0] = 0x80;
  const bits = BigInt(totalLen) * 8n;
  for (let i = 0; i < 8; i++) pad2[padLen - 8 + 7 - i] = Number((bits >> BigInt(8 * i)) & 0xffn);
  const blocks = chunkBlocks(appendBytes, pad2, 64);
  for (const b of blocks) sha1CompressBlock(H, b);
  return stateToHex(H);
}

/** SHA-256 长度扩展。 */
export function sha256LengthExtension(origHashHex, origLenBytes, appendData) {
  const H = stateFromHex(origHashHex, 8);
  const appendBytes = te.encode(appendData);
  const padOrig = padMessage(origLenBytes, 64);
  const totalLen = origLenBytes + padOrig.length + appendBytes.length;
  const padLen = (64 - ((totalLen + 8) % 64)) % 64 + 8;
  const pad2 = new Uint8Array(padLen);
  pad2[0] = 0x80;
  const bits = BigInt(totalLen) * 8n;
  for (let i = 0; i < 8; i++) pad2[padLen - 8 + 7 - i] = Number((bits >> BigInt(8 * i)) & 0xffn);
  const blocks = chunkBlocks(appendBytes, pad2, 64);
  for (const b of blocks) sha256CompressBlock(H, b);
  return stateToHex(H);
}

/** 生日碰撞演示：bitLen 位截断哈希，随机输入找碰撞（期望 n≈2^(b/2) 次尝试）。 */
export function birthdayCollision(bitLen, maxTries = 500000) {
  const b = Math.max(8, Math.min(40, bitLen));
  const mask = b >= 32 ? 0xffffffff : (1 << b) - 1;
  const seen = new Map();
  let nonce = 0;
  while (nonce < maxTries) {
    const input = "x" + nonce;
    const h = parseInt(sha256Hex(te.encode(input)).slice(0, 8), 16) & mask;
    const prev = seen.get(h);
    if (prev !== undefined && prev !== input) {
      return { a: prev, b: input, hash: h.toString(16).padStart(Math.ceil(b / 4), "0"), tries: nonce };
    }
    seen.set(h, input);
    nonce++;
  }
  return null;
}

// ============ op ============
function shaExtOp(text, p = {}) {
  const algo = (p && p.algo) || "sha256";
  const parts = String(text || "").split(/[\s,;]+/).filter(Boolean);
  if (parts.length < 3) throw new Error("输入：原始哈希 空格 原消息字节数 空格 追加内容");
  const origHash = parts[0].toLowerCase();
  const origLen = parseInt(parts[1], 10);
  const append = parts.slice(2).join(" ");
  if (!/^[0-9a-f]{40}$/.test(origHash) && !/^[0-9a-f]{64}$/.test(origHash)) throw new Error("哈希须 40（SHA-1）或 64（SHA-256）位 hex");
  if (algo === "sha1") {
    const expectLen = 40;
    if (origHash.length !== expectLen) throw new Error("SHA-1 哈希须 40 位 hex");
    return "扩展哈希（SHA-1，原长 " + origLen + " 字节）：\n" + sha1LengthExtension(origHash, origLen, append);
  }
  if (origHash.length !== 64) throw new Error("SHA-256 哈希须 64 位 hex");
  return "扩展哈希（SHA-256，原长 " + origLen + " 字节）：\n" + sha256LengthExtension(origHash, origLen, append);
}

function birthdayOp(text, p = {}) {
  const bitLen = Math.max(8, Math.min(40, Number((p && p.bitLen) || 24)));
  const res = birthdayCollision(bitLen);
  if (!res) return "未找到碰撞（" + bitLen + " 位，尝试上限内）";
  return "找到碰撞（" + bitLen + " 位截断 SHA-256）：\n" +
    "输入 A：\"" + res.a + "\"  → " + res.hash + "\n" +
    "输入 B：\"" + res.b + "\"  → " + res.hash + "\n" +
    "尝试次数：" + res.tries + "（期望 ≈2^" + (bitLen / 2) + "）";
}

register({
  id: "shaLengthExtend", cat: "analysis", name: "SHA 长度扩展",
  desc: "SHA-1/SHA-256 长度扩展攻击：已知 (hash, 原消息长度) 伪造追加内容后的哈希（MD5 版见 hashLengthExtension）",
  params: [
    { key: "algo", label: "算法", type: "select", default: "sha256",
      options: [{ value: "sha256", label: "SHA-256" }, { value: "sha1", label: "SHA-1" }] },
  ],
  run: shaExtOp,
});

register({
  id: "birthdayCollision", cat: "analysis", name: "生日碰撞演示",
  desc: "截断 SHA-256 的生日碰撞（bitLen 位，期望 2^(b/2) 次）：教学演示哈希碰撞的本质",
  params: [
    { key: "bitLen", label: "截断位数", type: "number", default: 24, placeholder: "8-40" },
  ],
  run: birthdayOp,
});

export { shaExtOp, birthdayOp };
