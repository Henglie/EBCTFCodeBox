/*
 * hash.js — 哈希 / 校验（cat:'hash'，单向 run）。
 * MD5、MD4（NTLM 用）、SHA1/256/384/512（WebCrypto）、HMAC（WebCrypto）
 * CRC32（IEEE 802.3 查表法）、CRC16（CCITT-FALSE）、NTLM（MD4 of UTF-16LE）。
 *
 * 单向工具，用 run(text, params) 返回 hex 串。SHA/HMAC 走 WebCrypto（异步）
 * MD5/MD4/CRC/NTLM 纯 JS（同步）。每项用权威向量验证。
 * SHA3 家族（SHA3-224/256/384/512、Keccak-224/256/384/512、SHAKE128/256）纯 JS Keccak-f[1600]
 * 双 32 位字模拟 64 位；SHA3 与 Keccak 仅 padding 不同（0x06 vs 0x01），SHAKE 用 0x1f。
 * SHA3 用 FIPS 202 权威向量验证；Keccak 用以太坊常用向量与 Keccak 原规范交叉验证。
 */
import { register } from "./registry.js";

// 文本 → UTF-8 字节；已是 Uint8Array 则原样直通（F02：哈希族要吃真字节）
const te = (s) => (s instanceof Uint8Array ? s : new TextEncoder().encode(s));
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const toHexUpper = (bytes) => toHex(bytes).toUpperCase();

// 32 位循环左移
function rotl(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

// ============ MD5（RFC 1321，纯 JS） ============
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

function md5Bytes(bytes) {
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
 // 消息填充：0x80 + 0x00... + 64 位小端长度（位）
  const origLen = bytes.length;
  const withOne = origLen + 1;
  const k = (56 - (withOne % 64) + 64) % 64;
  const total = withOne + k + 8;
  const msg = new Uint8Array(total);
  msg.set(bytes, 0);
  msg[origLen] = 0x80;
  const bitLen = BigInt(origLen) * 8n;
  const dv = new DataView(msg.buffer);
  dv.setUint32(total - 8, Number(bitLen & 0xffffffffn), true);
  dv.setUint32(total - 4, Number((bitLen >> 32n) & 0xffffffffn), true);

  for (let off = 0; off < total; off += 64) {
    const M = new Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + MD5_K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, MD5_S[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true);
  odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true);
  odv.setUint32(12, d0, true);
  return out;
}
function md5(text) { return toHex(md5Bytes(te(text))); }

// ============ MD4（RFC 1320，纯 JS，NTLM 用） ============
function md4Bytes(bytes) {
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const origLen = bytes.length;
  const withOne = origLen + 1;
  const k = (56 - (withOne % 64) + 64) % 64;
  const total = withOne + k + 8;
  const msg = new Uint8Array(total);
  msg.set(bytes, 0);
  msg[origLen] = 0x80;
  const bitLen = BigInt(origLen) * 8n;
  const dv = new DataView(msg.buffer);
  dv.setUint32(total - 8, Number(bitLen & 0xffffffffn), true);
  dv.setUint32(total - 4, Number((bitLen >> 32n) & 0xffffffffn), true);

  for (let off = 0; off < total; off += 64) {
    const M = new Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
 // 第 1 轮：F=(B&C)|(~B&D)，移位 [3,7,11,19]
    for (let i = 0; i < 16; i++) {
      A = rotl((A + ((B & C) | (~B & D)) + M[i]) >>> 0, [3, 7, 11, 19][i % 4]) >>> 0;
      [A, B, C, D] = [D, A, B, C];
    }
 // 第 2 轮：G=(B&C)|(B&D)|(C&D)，常量 0x5A827999，移位 [3,5,9,13]
    const gIdx = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15];
    for (let i = 0; i < 16; i++) {
      A = rotl((A + ((B & C) | (B & D) | (C & D)) + M[gIdx[i]] + 0x5a827999) >>> 0, [3, 5, 9, 13][i % 4]) >>> 0;
      [A, B, C, D] = [D, A, B, C];
    }
 // 第 3 轮：H=B^C^D，常量 0x6ED9EBA1，移位 [3,9,11,15]
    const hIdx = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
    for (let i = 0; i < 16; i++) {
      A = rotl((A + (B ^ C ^ D) + M[hIdx[i]] + 0x6ed9eba1) >>> 0, [3, 9, 11, 15][i % 4]) >>> 0;
      [A, B, C, D] = [D, A, B, C];
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true);
  odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true);
  odv.setUint32(12, d0, true);
  return out;
}
function md4(text) { return toHex(md4Bytes(te(text))); }

// ============ CRC32（IEEE 802.3，多项式 0xEDB88320，查表法） ============
const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(text) {
  const bytes = te(text);
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC32_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0").toUpperCase();
}

// ============ CRC16（CCITT-FALSE，多项式 0x1021，init 0xFFFF，不反射） ============
function crc16(text) {
  const bytes = te(text);
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= (b << 8);
    for (let i = 0; i < 8; i++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).padStart(4, "0").toUpperCase();
}

// ============ NTLM（MD4 of UTF-16LE password） ============
function ntlm(text) {
 // UTF-16LE 编码（Uint16Array 自动处理代理对）
  const u16 = new Uint16Array(text.length);
  for (let i = 0; i < text.length; i++) u16[i] = text.charCodeAt(i);
  return toHexUpper(md4Bytes(new Uint8Array(u16.buffer)));
}

// SHA-1 压缩（FIPS 180-4 §6.1.2），rounds 可调；默认 80 与 WebCrypto/CC 一致。
function sha1Bytes(bytes, rounds = 80) {
  const r = Math.max(1, Math.min(80, Math.floor(Number(rounds) || 80)));
  const bitLenHi = Math.floor(bytes.length / 0x20000000);
  const bitLenLo = (bytes.length << 3) >>> 0;
  const paddedLen = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(paddedLen - 8, bitLenHi, false);
  dv.setUint32(paddedLen - 4, bitLenLo, false);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < r; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = rotl(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, h0, false); odv.setUint32(4, h1, false); odv.setUint32(8, h2, false);
  odv.setUint32(12, h3, false); odv.setUint32(16, h4, false);
  return out;
}

// ============ SHA 系（WebCrypto，异步） ============
async function sha(algo, text) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto");
  const buf = await crypto.subtle.digest(algo, te(text));
  return toHex(new Uint8Array(buf));
}

// ============ HMAC（WebCrypto，异步） ============
// HMAC-MD5 走纯 JS：WebCrypto 只认 SHA 系列，不支持 MD5。
// 标准构造 H((K'^opad) ‖ H((K'^ipad) ‖ m))，MD5 分组 64 字节（RFC 2104）。
function hmacMd5(key, text) {
  const BLOCK = 64;
  let k = te(key);
  if (k.length > BLOCK) k = md5Bytes(k);       // 超长密钥先摘要
  const k0 = new Uint8Array(BLOCK);            // 不足则右补 0
  k0.set(k);
  const ipad = new Uint8Array(BLOCK), opad = new Uint8Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) {
    ipad[i] = k0[i] ^ 0x36;
    opad[i] = k0[i] ^ 0x5c;
  }
  const msg = te(text);
  const inner = new Uint8Array(BLOCK + msg.length);
  inner.set(ipad); inner.set(msg, BLOCK);
  const innerHash = md5Bytes(inner);
  const outer = new Uint8Array(BLOCK + innerHash.length);
  outer.set(opad); outer.set(innerHash, BLOCK);
  return toHex(md5Bytes(outer));
}

async function hmac(algo, key, text) {
  if (algo === "MD5") return hmacMd5(key, text);
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto");
  const keyData = await crypto.subtle.importKey(
    "raw", te(key), { name: "HMAC", hash: algo }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", keyData, te(text));
  return toHex(new Uint8Array(sig));
}

// ============ 注册 ============
register({
  id: "md5", cat: "hash", name: "MD5", family: "md", familyLabel: "MD5", desc: "MD5 消息摘要（128 位，RFC 1321，纯 JS）",
  acceptsBytes: true, textTransit: true,
  run: (t, p) => md5(p?.rawBytes ?? t),
});

register({
  id: "md4", cat: "hash", name: "MD4", family: "md", familyLabel: "MD4", desc: "MD4 消息摘要（128 位，RFC 1320，纯 JS，NTLM 基础）",
  acceptsBytes: true, textTransit: true,
  run: (t, p) => md4(p?.rawBytes ?? t),
});

register({
  id: "sha1", cat: "hash", name: "SHA-1", family: "sha", familyLabel: "SHA-1",
  desc: "SHA-1 消息摘要（160 位，FIPS 180-4 纯 JS）；Rounds 可调（默认 80，与 CyberChef SHA1 对齐）",
  acceptsBytes: true, textTransit: true,
  params: [
    { key: "rounds", label: "轮数", labelKey: "op.sha1.param.rounds", type: "number", default: 80, placeholder: "默认 80（最小 16）" },
  ],
  run: (t, p) => {
    const raw = p?.rawBytes;
    const bytes = raw != null ? (raw instanceof Uint8Array ? raw : new Uint8Array(raw)) : te(t);
    return toHex(sha1Bytes(bytes, Number((p && p.rounds != null) ? p.rounds : 80)));
  },
});

register({
  id: "sha256", cat: "hash", name: "SHA-256", family: "sha", familyLabel: "SHA-256", desc: "SHA-256 消息摘要（256 位，WebCrypto）；mode=all 时输出全部可用摘要（同 CyberChef Generate all hashes）",
  params: [
    { key: "mode", label: "模式", type: "select", default: "single", options: [
      { value: "single", label: "仅 SHA-256（原有模式）" },
      { value: "all", label: "Generate all hashes（全部摘要）" },
    ] },
    { key: "includeNames", label: "包含名称", type: "bool", default: true },
  ],
  acceptsBytes: true, textTransit: true,
  run: async (t, p) => {
    if (!(p && p.mode === "all")) return sha("SHA-256", p?.rawBytes ?? t);
    const data = p?.rawBytes ?? t;
    const rows = [
      ["MD5", md5(data)],
      ["SHA-1", await sha("SHA-1", data)],
      ["SHA-256", await sha("SHA-256", data)],
      ["SHA-384", await sha("SHA-384", data)],
      ["SHA-512", await sha("SHA-512", data)],
    ];
    return rows.map(([n, v]) => (p.includeNames === false ? v : n + ": " + v)).join("\n");
  },
});

register({
  id: "sha384", cat: "hash", name: "SHA-384", family: "sha", familyLabel: "SHA-384", desc: "SHA-384 消息摘要（384 位，WebCrypto）",
  acceptsBytes: true, textTransit: true,
  run: async (t, p) => sha("SHA-384", p?.rawBytes ?? t),
});

register({
  id: "sha512", cat: "hash", name: "SHA-512", family: "sha", familyLabel: "SHA-512", desc: "SHA-512 消息摘要（512 位，WebCrypto）",
  acceptsBytes: true, textTransit: true,
  run: async (t, p) => sha("SHA-512", p?.rawBytes ?? t),
});

register({
  id: "hmac", cat: "hash", name: "HMAC", desc: "HMAC 消息认证码（参数：密钥 + 哈希算法，WebCrypto）",
  params: [
    { key: "key", label: "密钥", type: "text", default: "", placeholder: "HMAC 密钥" },
    { key: "algo", label: "算法", type: "select", default: "SHA-256", options: [
      { value: "MD5", label: "MD5" },
      { value: "SHA-1", label: "SHA-1" },
      { value: "SHA-256", label: "SHA-256" },
      { value: "SHA-384", label: "SHA-384" },
      { value: "SHA-512", label: "SHA-512" },
    ] },
  ],
  acceptsBytes: true, textTransit: true,
  run: async (t, p) => hmac((p && p.algo) || "SHA-256", (p && p.key) || "", p?.rawBytes ?? t),
});

register({
  id: "crc32", cat: "hash", name: "CRC32", family: "crc", familyLabel: "CRC-32/ISO-HDLC", desc: "CRC32 校验（IEEE 802.3，查表法）",
  acceptsBytes: true, textTransit: true,
  run: (t, p) => crc32(p?.rawBytes ?? t),
});

register({
  id: "crc16", cat: "hash", name: "CRC16", family: "crc", familyLabel: "CRC-16/IBM-3740", desc: "CRC16 校验（CCITT-FALSE，多项式 0x1021）",
  acceptsBytes: true, textTransit: true,
  run: (t, p) => crc16(p?.rawBytes ?? t),
});

register({
  id: "ntlm", cat: "hash", name: "NTLM", desc: "NTLM 哈希（MD4 of UTF-16LE 密码，Windows 密码存储）",
  acceptsBytes: true, textTransit: true,
  run: (t, p) => {
    if (p?.rawBytes != null) throw new Error("NTLM 仅支持文本口令输入，不支持二进制原始字节（rawBytes）");
    if (typeof t !== "string") throw new Error("NTLM 仅支持文本口令输入（UTF-16LE），不支持二进制数据");
    return ntlm(t);
  },
});

// ============ SHA3 / Keccak / SHAKE（纯 JS Keccak-f[1600]，双 32 位模拟 64 位） ============
// FIPS 202。SHA3 与 Keccak 仅 padding 不同（domain 0x06 vs 0x01），SHAKE 用 0x1f。
// 每条 lane 存为 (lo, hi) 两个 32 位无符号字；state 25 lane。

// 24 轮迭代常量，拆成低/高 32 位
const KECCAK_RC_LO = [
  0x00000001, 0x00008082, 0x0000808a, 0x80008000, 0x0000808b, 0x80000001,
  0x80008081, 0x00008009, 0x0000008a, 0x00000088, 0x80008009, 0x8000000a,
  0x8000808b, 0x0000008b, 0x00008089, 0x00008003, 0x00008002, 0x00000080,
  0x0000800a, 0x8000000a, 0x80008081, 0x00008080, 0x80000001, 0x80008008,
];
const KECCAK_RC_HI = [
  0x00000000, 0x00000000, 0x80000000, 0x80000000, 0x00000000, 0x00000000,
  0x80000000, 0x80000000, 0x00000000, 0x00000000, 0x00000000, 0x00000000,
  0x00000000, 0x80000000, 0x80000000, 0x80000000, 0x80000000, 0x80000000,
  0x00000000, 0x80000000, 0x80000000, 0x80000000, 0x00000000, 0x80000000,
];

// scratch 复用，避免每次置换新建数组
const K_B_LO = new Uint32Array(25), K_B_HI = new Uint32Array(25);
const K_SLO = new Uint32Array(25), K_SHI = new Uint32Array(25);
const K_MSG = new Uint8Array(168); // 最大 rate（SHAKE128）

// Keccak-f[1600] 就地置换（theta/rho/pi/chi 展开，scratch 复用）。
function keccakF1600(sLo, sHi) {
  const bLo = K_B_LO, bHi = K_B_HI;
  for (let r = 0; r < 24; r++) {
    let c0Lo = sLo[0] ^ sLo[5] ^ sLo[10] ^ sLo[15] ^ sLo[20];
    let c0Hi = sHi[0] ^ sHi[5] ^ sHi[10] ^ sHi[15] ^ sHi[20];
    let c1Lo = sLo[1] ^ sLo[6] ^ sLo[11] ^ sLo[16] ^ sLo[21];
    let c1Hi = sHi[1] ^ sHi[6] ^ sHi[11] ^ sHi[16] ^ sHi[21];
    let c2Lo = sLo[2] ^ sLo[7] ^ sLo[12] ^ sLo[17] ^ sLo[22];
    let c2Hi = sHi[2] ^ sHi[7] ^ sHi[12] ^ sHi[17] ^ sHi[22];
    let c3Lo = sLo[3] ^ sLo[8] ^ sLo[13] ^ sLo[18] ^ sLo[23];
    let c3Hi = sHi[3] ^ sHi[8] ^ sHi[13] ^ sHi[18] ^ sHi[23];
    let c4Lo = sLo[4] ^ sLo[9] ^ sLo[14] ^ sLo[19] ^ sLo[24];
    let c4Hi = sHi[4] ^ sHi[9] ^ sHi[14] ^ sHi[19] ^ sHi[24];
    let d0Lo = c4Lo ^ (((c1Lo << 1) | (c1Hi >>> 31)) >>> 0);
    let d0Hi = c4Hi ^ (((c1Hi << 1) | (c1Lo >>> 31)) >>> 0);
    let d1Lo = c0Lo ^ (((c2Lo << 1) | (c2Hi >>> 31)) >>> 0);
    let d1Hi = c0Hi ^ (((c2Hi << 1) | (c2Lo >>> 31)) >>> 0);
    let d2Lo = c1Lo ^ (((c3Lo << 1) | (c3Hi >>> 31)) >>> 0);
    let d2Hi = c1Hi ^ (((c3Hi << 1) | (c3Lo >>> 31)) >>> 0);
    let d3Lo = c2Lo ^ (((c4Lo << 1) | (c4Hi >>> 31)) >>> 0);
    let d3Hi = c2Hi ^ (((c4Hi << 1) | (c4Lo >>> 31)) >>> 0);
    let d4Lo = c3Lo ^ (((c0Lo << 1) | (c0Hi >>> 31)) >>> 0);
    let d4Hi = c3Hi ^ (((c0Hi << 1) | (c0Lo >>> 31)) >>> 0);
    {
      const lo = sLo[0] ^ d0Lo, hi = sHi[0] ^ d0Hi;
      bLo[0] = lo; bHi[0] = hi;
    }
    {
      const lo = sLo[1] ^ d1Lo, hi = sHi[1] ^ d1Hi;
      bLo[10] = ((lo << 1) | (hi >>> 31)) >>> 0;
      bHi[10] = ((hi << 1) | (lo >>> 31)) >>> 0;
    }
    {
      const lo = sLo[2] ^ d2Lo, hi = sHi[2] ^ d2Hi;
      bLo[20] = ((hi << 30) | (lo >>> 2)) >>> 0;
      bHi[20] = ((lo << 30) | (hi >>> 2)) >>> 0;
    }
    {
      const lo = sLo[3] ^ d3Lo, hi = sHi[3] ^ d3Hi;
      bLo[5] = ((lo << 28) | (hi >>> 4)) >>> 0;
      bHi[5] = ((hi << 28) | (lo >>> 4)) >>> 0;
    }
    {
      const lo = sLo[4] ^ d4Lo, hi = sHi[4] ^ d4Hi;
      bLo[15] = ((lo << 27) | (hi >>> 5)) >>> 0;
      bHi[15] = ((hi << 27) | (lo >>> 5)) >>> 0;
    }
    {
      const lo = sLo[5] ^ d0Lo, hi = sHi[5] ^ d0Hi;
      bLo[16] = ((hi << 4) | (lo >>> 28)) >>> 0;
      bHi[16] = ((lo << 4) | (hi >>> 28)) >>> 0;
    }
    {
      const lo = sLo[6] ^ d1Lo, hi = sHi[6] ^ d1Hi;
      bLo[1] = ((hi << 12) | (lo >>> 20)) >>> 0;
      bHi[1] = ((lo << 12) | (hi >>> 20)) >>> 0;
    }
    {
      const lo = sLo[7] ^ d2Lo, hi = sHi[7] ^ d2Hi;
      bLo[11] = ((lo << 6) | (hi >>> 26)) >>> 0;
      bHi[11] = ((hi << 6) | (lo >>> 26)) >>> 0;
    }
    {
      const lo = sLo[8] ^ d3Lo, hi = sHi[8] ^ d3Hi;
      bLo[21] = ((hi << 23) | (lo >>> 9)) >>> 0;
      bHi[21] = ((lo << 23) | (hi >>> 9)) >>> 0;
    }
    {
      const lo = sLo[9] ^ d4Lo, hi = sHi[9] ^ d4Hi;
      bLo[6] = ((lo << 20) | (hi >>> 12)) >>> 0;
      bHi[6] = ((hi << 20) | (lo >>> 12)) >>> 0;
    }
    {
      const lo = sLo[10] ^ d0Lo, hi = sHi[10] ^ d0Hi;
      bLo[7] = ((lo << 3) | (hi >>> 29)) >>> 0;
      bHi[7] = ((hi << 3) | (lo >>> 29)) >>> 0;
    }
    {
      const lo = sLo[11] ^ d1Lo, hi = sHi[11] ^ d1Hi;
      bLo[17] = ((lo << 10) | (hi >>> 22)) >>> 0;
      bHi[17] = ((hi << 10) | (lo >>> 22)) >>> 0;
    }
    {
      const lo = sLo[12] ^ d2Lo, hi = sHi[12] ^ d2Hi;
      bLo[2] = ((hi << 11) | (lo >>> 21)) >>> 0;
      bHi[2] = ((lo << 11) | (hi >>> 21)) >>> 0;
    }
    {
      const lo = sLo[13] ^ d3Lo, hi = sHi[13] ^ d3Hi;
      bLo[12] = ((lo << 25) | (hi >>> 7)) >>> 0;
      bHi[12] = ((hi << 25) | (lo >>> 7)) >>> 0;
    }
    {
      const lo = sLo[14] ^ d4Lo, hi = sHi[14] ^ d4Hi;
      bLo[22] = ((hi << 7) | (lo >>> 25)) >>> 0;
      bHi[22] = ((lo << 7) | (hi >>> 25)) >>> 0;
    }
    {
      const lo = sLo[15] ^ d0Lo, hi = sHi[15] ^ d0Hi;
      bLo[23] = ((hi << 9) | (lo >>> 23)) >>> 0;
      bHi[23] = ((lo << 9) | (hi >>> 23)) >>> 0;
    }
    {
      const lo = sLo[16] ^ d1Lo, hi = sHi[16] ^ d1Hi;
      bLo[8] = ((hi << 13) | (lo >>> 19)) >>> 0;
      bHi[8] = ((lo << 13) | (hi >>> 19)) >>> 0;
    }
    {
      const lo = sLo[17] ^ d2Lo, hi = sHi[17] ^ d2Hi;
      bLo[18] = ((lo << 15) | (hi >>> 17)) >>> 0;
      bHi[18] = ((hi << 15) | (lo >>> 17)) >>> 0;
    }
    {
      const lo = sLo[18] ^ d3Lo, hi = sHi[18] ^ d3Hi;
      bLo[3] = ((lo << 21) | (hi >>> 11)) >>> 0;
      bHi[3] = ((hi << 21) | (lo >>> 11)) >>> 0;
    }
    {
      const lo = sLo[19] ^ d4Lo, hi = sHi[19] ^ d4Hi;
      bLo[13] = ((lo << 8) | (hi >>> 24)) >>> 0;
      bHi[13] = ((hi << 8) | (lo >>> 24)) >>> 0;
    }
    {
      const lo = sLo[20] ^ d0Lo, hi = sHi[20] ^ d0Hi;
      bLo[14] = ((lo << 18) | (hi >>> 14)) >>> 0;
      bHi[14] = ((hi << 18) | (lo >>> 14)) >>> 0;
    }
    {
      const lo = sLo[21] ^ d1Lo, hi = sHi[21] ^ d1Hi;
      bLo[24] = ((lo << 2) | (hi >>> 30)) >>> 0;
      bHi[24] = ((hi << 2) | (lo >>> 30)) >>> 0;
    }
    {
      const lo = sLo[22] ^ d2Lo, hi = sHi[22] ^ d2Hi;
      bLo[9] = ((hi << 29) | (lo >>> 3)) >>> 0;
      bHi[9] = ((lo << 29) | (hi >>> 3)) >>> 0;
    }
    {
      const lo = sLo[23] ^ d3Lo, hi = sHi[23] ^ d3Hi;
      bLo[19] = ((hi << 24) | (lo >>> 8)) >>> 0;
      bHi[19] = ((lo << 24) | (hi >>> 8)) >>> 0;
    }
    {
      const lo = sLo[24] ^ d4Lo, hi = sHi[24] ^ d4Hi;
      bLo[4] = ((lo << 14) | (hi >>> 18)) >>> 0;
      bHi[4] = ((hi << 14) | (lo >>> 18)) >>> 0;
    }
    sLo[0] = (bLo[0] ^ ((~bLo[1]) & bLo[2])) >>> 0;
    sHi[0] = (bHi[0] ^ ((~bHi[1]) & bHi[2])) >>> 0;
    sLo[1] = (bLo[1] ^ ((~bLo[2]) & bLo[3])) >>> 0;
    sHi[1] = (bHi[1] ^ ((~bHi[2]) & bHi[3])) >>> 0;
    sLo[2] = (bLo[2] ^ ((~bLo[3]) & bLo[4])) >>> 0;
    sHi[2] = (bHi[2] ^ ((~bHi[3]) & bHi[4])) >>> 0;
    sLo[3] = (bLo[3] ^ ((~bLo[4]) & bLo[0])) >>> 0;
    sHi[3] = (bHi[3] ^ ((~bHi[4]) & bHi[0])) >>> 0;
    sLo[4] = (bLo[4] ^ ((~bLo[0]) & bLo[1])) >>> 0;
    sHi[4] = (bHi[4] ^ ((~bHi[0]) & bHi[1])) >>> 0;
    sLo[5] = (bLo[5] ^ ((~bLo[6]) & bLo[7])) >>> 0;
    sHi[5] = (bHi[5] ^ ((~bHi[6]) & bHi[7])) >>> 0;
    sLo[6] = (bLo[6] ^ ((~bLo[7]) & bLo[8])) >>> 0;
    sHi[6] = (bHi[6] ^ ((~bHi[7]) & bHi[8])) >>> 0;
    sLo[7] = (bLo[7] ^ ((~bLo[8]) & bLo[9])) >>> 0;
    sHi[7] = (bHi[7] ^ ((~bHi[8]) & bHi[9])) >>> 0;
    sLo[8] = (bLo[8] ^ ((~bLo[9]) & bLo[5])) >>> 0;
    sHi[8] = (bHi[8] ^ ((~bHi[9]) & bHi[5])) >>> 0;
    sLo[9] = (bLo[9] ^ ((~bLo[5]) & bLo[6])) >>> 0;
    sHi[9] = (bHi[9] ^ ((~bHi[5]) & bHi[6])) >>> 0;
    sLo[10] = (bLo[10] ^ ((~bLo[11]) & bLo[12])) >>> 0;
    sHi[10] = (bHi[10] ^ ((~bHi[11]) & bHi[12])) >>> 0;
    sLo[11] = (bLo[11] ^ ((~bLo[12]) & bLo[13])) >>> 0;
    sHi[11] = (bHi[11] ^ ((~bHi[12]) & bHi[13])) >>> 0;
    sLo[12] = (bLo[12] ^ ((~bLo[13]) & bLo[14])) >>> 0;
    sHi[12] = (bHi[12] ^ ((~bHi[13]) & bHi[14])) >>> 0;
    sLo[13] = (bLo[13] ^ ((~bLo[14]) & bLo[10])) >>> 0;
    sHi[13] = (bHi[13] ^ ((~bHi[14]) & bHi[10])) >>> 0;
    sLo[14] = (bLo[14] ^ ((~bLo[10]) & bLo[11])) >>> 0;
    sHi[14] = (bHi[14] ^ ((~bHi[10]) & bHi[11])) >>> 0;
    sLo[15] = (bLo[15] ^ ((~bLo[16]) & bLo[17])) >>> 0;
    sHi[15] = (bHi[15] ^ ((~bHi[16]) & bHi[17])) >>> 0;
    sLo[16] = (bLo[16] ^ ((~bLo[17]) & bLo[18])) >>> 0;
    sHi[16] = (bHi[16] ^ ((~bHi[17]) & bHi[18])) >>> 0;
    sLo[17] = (bLo[17] ^ ((~bLo[18]) & bLo[19])) >>> 0;
    sHi[17] = (bHi[17] ^ ((~bHi[18]) & bHi[19])) >>> 0;
    sLo[18] = (bLo[18] ^ ((~bLo[19]) & bLo[15])) >>> 0;
    sHi[18] = (bHi[18] ^ ((~bHi[19]) & bHi[15])) >>> 0;
    sLo[19] = (bLo[19] ^ ((~bLo[15]) & bLo[16])) >>> 0;
    sHi[19] = (bHi[19] ^ ((~bHi[15]) & bHi[16])) >>> 0;
    sLo[20] = (bLo[20] ^ ((~bLo[21]) & bLo[22])) >>> 0;
    sHi[20] = (bHi[20] ^ ((~bHi[21]) & bHi[22])) >>> 0;
    sLo[21] = (bLo[21] ^ ((~bLo[22]) & bLo[23])) >>> 0;
    sHi[21] = (bHi[21] ^ ((~bHi[22]) & bHi[23])) >>> 0;
    sLo[22] = (bLo[22] ^ ((~bLo[23]) & bLo[24])) >>> 0;
    sHi[22] = (bHi[22] ^ ((~bHi[23]) & bHi[24])) >>> 0;
    sLo[23] = (bLo[23] ^ ((~bLo[24]) & bLo[20])) >>> 0;
    sHi[23] = (bHi[23] ^ ((~bHi[24]) & bHi[20])) >>> 0;
    sLo[24] = (bLo[24] ^ ((~bLo[20]) & bLo[21])) >>> 0;
    sHi[24] = (bHi[24] ^ ((~bHi[20]) & bHi[21])) >>> 0;
    sLo[0] = (sLo[0] ^ KECCAK_RC_LO[r]) >>> 0;
    sHi[0] = (sHi[0] ^ KECCAK_RC_HI[r]) >>> 0;
  }
}

function keccakAbsorb(sLo, sHi, bytes, off, rate) {
  for (let i = 0; i < rate; i += 8) {
    const li = i >> 3;
    const p = off + i;
    const lo = (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)) >>> 0;
    const hi = (bytes[p + 4] | (bytes[p + 5] << 8) | (bytes[p + 6] << 16) | (bytes[p + 7] << 24)) >>> 0;
    sLo[li] ^= lo;
    sHi[li] ^= hi;
  }
}

function keccak(rate, padByte, msg, outLen) {
  const sLo = K_SLO, sHi = K_SHI;
  sLo.fill(0);
  sHi.fill(0);
  const msgLen = msg.length;
 // 直接吸收完整块，末尾块在 168 字节 scratch 中补齐（不复制整条消息）
  let off = 0;
  for (; off + rate <= msgLen; off += rate) {
    keccakAbsorb(sLo, sHi, msg, off, rate);
    keccakF1600(sLo, sHi);
  }
  const rem = msgLen - off; // 0..rate-1
  const buf = K_MSG;
  for (let i = 0; i < rem; i++) buf[i] = msg[off + i];
  buf.fill(0, rem, rate);
  buf[rem] = padByte;
  buf[rate - 1] |= 0x80; // 与 padByte 同字节时自动合并成 padByte|0x80
  keccakAbsorb(sLo, sHi, buf, 0, rate);
  keccakF1600(sLo, sHi);
 // 挤出（按 32 位字写，尾部逐字节）
  const out = new Uint8Array(outLen);
  let produced = 0;
  while (produced < outLen) {
    const blockBytes = Math.min(rate, outLen - produced);
    let i = 0;
    for (; i + 8 <= blockBytes; i += 8) {
      const laneIdx = i >> 3;
      const lo = sLo[laneIdx], hi = sHi[laneIdx];
      out[produced] = lo & 0xff;
      out[produced + 1] = (lo >>> 8) & 0xff;
      out[produced + 2] = (lo >>> 16) & 0xff;
      out[produced + 3] = (lo >>> 24) & 0xff;
      out[produced + 4] = hi & 0xff;
      out[produced + 5] = (hi >>> 8) & 0xff;
      out[produced + 6] = (hi >>> 16) & 0xff;
      out[produced + 7] = (hi >>> 24) & 0xff;
      produced += 8;
    }
    for (; i < blockBytes; i++) {
      const laneIdx = i >> 3;
      const bil = i & 7;
      const word = bil < 4 ? sLo[laneIdx] : sHi[laneIdx];
      out[produced++] = (word >>> ((bil & 3) * 8)) & 0xff;
    }
    if (produced < outLen) keccakF1600(sLo, sHi);
  }
  return out;
}

// rate = (1600 - capacity)/8；capacity = 2*输出位数
function sha3(bits, text) {
  const outLen = bits / 8;
  const rate = (1600 - bits * 2) / 8;
  return toHex(keccak(rate, 0x06, te(text), outLen));
}
// Keccak 原规范：rate=(1600-2*bits)/8，padding 0x01。默认 256 与以太坊 Keccak-256 完全一致。
function keccakBits(bits, text) {
  const b = Number(bits);
  if (![224, 256, 384, 512].includes(b)) {
    throw new Error(`Keccak 输出位数只支持 224/256/384/512（拿到 ${JSON.stringify(bits)}）`);
  }
  return toHex(keccak((1600 - 2 * b) / 8, 0x01, te(text), b / 8));
}
function keccak256(text) {
  return keccakBits(256, text);
}
// SHAKE 可变长输出。security 位数决定 rate（128→rate 168 / 256→rate 136），pad 用 0x1f
function shake(security, text, outLen) {
  const rate = (1600 - security * 2) / 8;
  const n = Math.max(0, Math.floor(outLen) || 0);
  return toHex(keccak(rate, 0x1f, te(text), n));
}

// ============ SHA3 / Keccak / SHAKE 注册 ============
register({
  id: "sha3", cat: "hash", name: "SHA-3", family: "sha", familyLabel: "SHA-3", desc: "SHA-3（FIPS 202，纯 JS Keccak，位宽可选 224/256/384/512）",
  params: [
    { key: "bits", label: "输出位数", type: "select", default: 256, options: [
      { value: 224, label: "224" },
      { value: 256, label: "256" },
      { value: 384, label: "384" },
      { value: 512, label: "512" },
    ] },
  ],
  acceptsBytes: true, textTransit: true,
  run: (t, p) => sha3(Number((p && p.bits != null) ? p.bits : 256), p?.rawBytes ?? t),
});
register({
  id: "keccak256", cat: "hash", name: "Keccak（多档）",
  desc: "Keccak 海绵函数（原 Keccak padding 0x01，位宽 224/256/384/512，默认 256；256 位与以太坊 Keccak-256 一致）",
  params: [
    { key: "bits", label: "输出位数", type: "select", default: 256, options: [
      { value: 224, label: "224" },
      { value: 256, label: "256" },
      { value: 384, label: "384" },
      { value: 512, label: "512" },
    ] },
  ],
  acceptsBytes: true, textTransit: true,
  run: (t, p) => keccakBits(Number((p && p.bits != null) ? p.bits : 256), p?.rawBytes ?? t),
});
register({
  id: "shake128", cat: "hash", name: "SHAKE128", family: "shake", familyLabel: "SHAKE128", desc: "SHAKE128 可扩展输出（FIPS 202，参数：输出字节数）",
  params: [
    { key: "outLen", label: "输出字节数", type: "number", default: 32, placeholder: "输出字节数" },
  ],
  acceptsBytes: true, textTransit: true,
  run: (t, p) => shake(128, p?.rawBytes ?? t, (p && p.outLen != null) ? p.outLen : 32),
});
register({
  id: "shake256", cat: "hash", name: "SHAKE256", family: "shake", familyLabel: "SHAKE256", desc: "SHAKE256 可扩展输出（FIPS 202，参数：输出字节数）",
  params: [
    { key: "outLen", label: "输出字节数", type: "number", default: 32, placeholder: "输出字节数" },
  ],
  acceptsBytes: true, textTransit: true,
  run: (t, p) => shake(256, p?.rawBytes ?? t, (p && p.outLen != null) ? p.outLen : 32),
});

export { sha1Bytes,
  md5, md5Bytes, md4, md4Bytes,
  crc32, crc16, ntlm,
  sha, hmac,
  keccak, keccakF1600, sha3, keccakBits, keccak256, shake,
};
