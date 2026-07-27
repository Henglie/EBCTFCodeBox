/*
 * hash.js — 哈希 / 校验（cat:'hash'，单向 run）。
 * MD5、MD4（NTLM 用）、SHA1/256/384/512（WebCrypto）、HMAC（WebCrypto）
 * CRC32（IEEE 802.3 查表法）、CRC16（CCITT-FALSE）、NTLM（MD4 of UTF-16LE）。
 *
 * 单向工具，用 run(text, params) 返回 hex 串。SHA/HMAC 走 WebCrypto（异步）
 * MD5/MD4/CRC/NTLM 纯 JS（同步）。每项用权威向量验证。
 * SHA3 家族（SHA3-224/256/384/512、Keccak-256、SHAKE128/256）纯 JS Keccak-f[1600]
 * 双 32 位字模拟 64 位；SHA3 与 Keccak 仅 padding 不同（0x06 vs 0x01），SHAKE 用 0x1f。
 * SHA3/Keccak 用 FIPS 202 权威向量验证。
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(s);
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

// ============ SHA 系（WebCrypto，异步） ============
async function sha(algo, text) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto");
  const buf = await crypto.subtle.digest(algo, te(text));
  return toHex(new Uint8Array(buf));
}

// ============ HMAC（WebCrypto，异步） ============
async function hmac(algo, key, text) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto");
  const keyData = await crypto.subtle.importKey(
    "raw", te(key), { name: "HMAC", hash: algo }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", keyData, te(text));
  return toHex(new Uint8Array(sig));
}

// ============ 注册 ============
register({
  id: "md5", cat: "hash", name: "MD5", desc: "MD5 消息摘要（128 位，RFC 1321，纯 JS）",
  run: (t) => md5(t),
});

register({
  id: "md4", cat: "hash", name: "MD4", desc: "MD4 消息摘要（128 位，RFC 1320，纯 JS，NTLM 基础）",
  run: (t) => md4(t),
});

register({
  id: "sha1", cat: "hash", name: "SHA-1", desc: "SHA-1 消息摘要（160 位，WebCrypto）",
  run: async (t) => sha("SHA-1", t),
});

register({
  id: "sha256", cat: "hash", name: "SHA-256", desc: "SHA-256 消息摘要（256 位，WebCrypto）",
  run: async (t) => sha("SHA-256", t),
});

register({
  id: "sha384", cat: "hash", name: "SHA-384", desc: "SHA-384 消息摘要（384 位，WebCrypto）",
  run: async (t) => sha("SHA-384", t),
});

register({
  id: "sha512", cat: "hash", name: "SHA-512", desc: "SHA-512 消息摘要（512 位，WebCrypto）",
  run: async (t) => sha("SHA-512", t),
});

register({
  id: "hmac", cat: "hash", name: "HMAC", desc: "HMAC 消息认证码（参数：密钥 + 哈希算法，WebCrypto）",
  params: [
    { key: "key", label: "密钥", type: "text", default: "", placeholder: "HMAC 密钥" },
    { key: "algo", label: "算法", type: "select", default: "SHA-256", options: [
      { value: "SHA-1", label: "SHA-1" },
      { value: "SHA-256", label: "SHA-256" },
      { value: "SHA-384", label: "SHA-384" },
      { value: "SHA-512", label: "SHA-512" },
    ] },
  ],
  run: async (t, p) => hmac((p && p.algo) || "SHA-256", (p && p.key) || "", t),
});

register({
  id: "crc32", cat: "hash", name: "CRC32", desc: "CRC32 校验（IEEE 802.3，查表法）",
  run: (t) => crc32(t),
});

register({
  id: "crc16", cat: "hash", name: "CRC16", desc: "CRC16 校验（CCITT-FALSE，多项式 0x1021）",
  run: (t) => crc16(t),
});

register({
  id: "ntlm", cat: "hash", name: "NTLM", desc: "NTLM 哈希（MD4 of UTF-16LE 密码，Windows 密码存储）",
  run: (t) => ntlm(t),
});

// ============ SHA3 / Keccak / SHAKE（纯 JS Keccak-f[1600]，双 32 位模拟 64 位） ============
// FIPS 202。SHA3 与 Keccak 仅 padding 不同（domain 0x06 vs 0x01），SHAKE 用 0x1f。
// 每条 lane 存为 (lo, hi) 两个 32 位无符号字；state 25 lane。

// rho 旋转量，索引 idx = x + 5*y
const KECCAK_RHO = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
];
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

// Keccak-f[1600] 就地置换。sLo/sHi 为 25 长 Int32/普通数组。
function keccakF1600(sLo, sHi) {
  const cLo = new Array(5), cHi = new Array(5);
  const dLo = new Array(5), dHi = new Array(5);
  const bLo = new Array(25), bHi = new Array(25);
  for (let r = 0; r < 24; r++) {
 // theta：列奇偶校验
    for (let x = 0; x < 5; x++) {
      cLo[x] = (sLo[x] ^ sLo[x + 5] ^ sLo[x + 10] ^ sLo[x + 15] ^ sLo[x + 20]) >>> 0;
      cHi[x] = (sHi[x] ^ sHi[x + 5] ^ sHi[x + 10] ^ sHi[x + 15] ^ sHi[x + 20]) >>> 0;
    }
    for (let x = 0; x < 5; x++) {
      const x1 = (x + 1) % 5, x4 = (x + 4) % 5;
 // rotl(C[x+1], 1)
      const rlLo = ((cLo[x1] << 1) | (cHi[x1] >>> 31)) >>> 0;
      const rlHi = ((cHi[x1] << 1) | (cLo[x1] >>> 31)) >>> 0;
      dLo[x] = (cLo[x4] ^ rlLo) >>> 0;
      dHi[x] = (cHi[x4] ^ rlHi) >>> 0;
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const idx = x + 5 * y;
        sLo[idx] = (sLo[idx] ^ dLo[x]) >>> 0;
        sHi[idx] = (sHi[idx] ^ dHi[x]) >>> 0;
      }
    }
 // rho + pi：B[y][(2x+3y)%5] = rotl(A[x][y], RHO[idx])
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        const idx = x + 5 * y;
        const destIdx = y + 5 * ((2 * x + 3 * y) % 5);
        const n = KECCAK_RHO[idx];
        const lo = sLo[idx], hi = sHi[idx];
        let rLo, rHi;
        if (n === 0) { rLo = lo; rHi = hi; }
        else if (n < 32) {
          rLo = ((lo << n) | (hi >>> (32 - n))) >>> 0;
          rHi = ((hi << n) | (lo >>> (32 - n))) >>> 0;
        } else if (n === 32) { rLo = hi; rHi = lo; }
        else {
          const m = n - 32;
          rLo = ((hi << m) | (lo >>> (32 - m))) >>> 0;
          rHi = ((lo << m) | (hi >>> (32 - m))) >>> 0;
        }
        bLo[destIdx] = rLo; bHi[destIdx] = rHi;
      }
    }
 // chi
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        const idx = x + 5 * y;
        const i1 = ((x + 1) % 5) + 5 * y;
        const i2 = ((x + 2) % 5) + 5 * y;
        sLo[idx] = (bLo[idx] ^ ((~bLo[i1]) & bLo[i2])) >>> 0;
        sHi[idx] = (bHi[idx] ^ ((~bHi[i1]) & bHi[i2])) >>> 0;
      }
    }
 // iota
    sLo[0] = (sLo[0] ^ KECCAK_RC_LO[r]) >>> 0;
    sHi[0] = (sHi[0] ^ KECCAK_RC_HI[r]) >>> 0;
  }
}

/**
 * Keccak 海绵函数。
 * @param {number} rate 速率（字节，恒为 8 的倍数）
 * @param {number} padByte domain 分隔 + pad10*1 首字节（SHA3=0x06 / Keccak=0x01 / SHAKE=0x1f）
 * @param {Uint8Array} msg 输入字节
 * @param {number} outLen 输出字节数
 * @returns {Uint8Array}
 */
function keccak(rate, padByte, msg, outLen) {
  const sLo = new Array(25).fill(0);
  const sHi = new Array(25).fill(0);
  const msgLen = msg.length;
 // 多速率填充 pad10*1，凑到 rate 的整数倍
  const padLen = rate - (msgLen % rate); // 1..rate
  const total = msgLen + padLen;
  const padded = new Uint8Array(total);
  padded.set(msg);
  padded[msgLen] = padByte;
  padded[total - 1] |= 0x80; // 与 padByte 同字节时自动合并成 padByte|0x80
 // 吸收
  for (let off = 0; off < total; off += rate) {
    for (let i = 0; i < rate; i += 8) {
      const li = i >> 3;
      const p = off + i;
      const lo = (padded[p] | (padded[p + 1] << 8) | (padded[p + 2] << 16) | (padded[p + 3] << 24)) >>> 0;
      const hi = (padded[p + 4] | (padded[p + 5] << 8) | (padded[p + 6] << 16) | (padded[p + 7] << 24)) >>> 0;
      sLo[li] = (sLo[li] ^ lo) >>> 0;
      sHi[li] = (sHi[li] ^ hi) >>> 0;
    }
    keccakF1600(sLo, sHi);
  }
 // 挤出
  const out = new Uint8Array(outLen);
  let produced = 0;
  while (produced < outLen) {
    const blockBytes = Math.min(rate, outLen - produced);
    for (let i = 0; i < blockBytes; i++) {
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
// Keccak-256（以太坊）：rate 同 SHA3-256（136），但 padding 用 0x01
function keccak256(text) {
  return toHex(keccak(136, 0x01, te(text), 32));
}
// SHAKE 可变长输出。security 位数决定 rate（128→rate 168 / 256→rate 136），pad 用 0x1f
function shake(security, text, outLen) {
  const rate = (1600 - security * 2) / 8;
  const n = Math.max(0, Math.floor(outLen) || 0);
  return toHex(keccak(rate, 0x1f, te(text), n));
}

// ============ SHA3 / Keccak / SHAKE 注册 ============
register({
  id: "sha3", cat: "hash", name: "SHA-3", desc: "SHA-3（FIPS 202，纯 JS Keccak，位宽可选 224/256/384/512）",
  params: [
    { key: "bits", label: "输出位数", type: "select", default: 256, options: [
      { value: 224, label: "224" },
      { value: 256, label: "256" },
      { value: 384, label: "384" },
      { value: 512, label: "512" },
    ] },
  ],
  run: (t, p) => sha3(Number((p && p.bits != null) ? p.bits : 256), t),
});
register({
  id: "keccak256", cat: "hash", name: "Keccak-256", desc: "Keccak-256（以太坊，padding 0x01，256 位）",
  run: (t) => keccak256(t),
});
register({
  id: "shake128", cat: "hash", name: "SHAKE128", desc: "SHAKE128 可扩展输出（FIPS 202，参数：输出字节数）",
  params: [
    { key: "outLen", label: "输出字节数", type: "number", default: 32, placeholder: "输出字节数" },
  ],
  run: (t, p) => shake(128, t, (p && p.outLen != null) ? p.outLen : 32),
});
register({
  id: "shake256", cat: "hash", name: "SHAKE256", desc: "SHAKE256 可扩展输出（FIPS 202，参数：输出字节数）",
  params: [
    { key: "outLen", label: "输出字节数", type: "number", default: 32, placeholder: "输出字节数" },
  ],
  run: (t, p) => shake(256, t, (p && p.outLen != null) ? p.outLen : 32),
});

export {
  md5, md5Bytes, md4, md4Bytes,
  crc32, crc16, ntlm,
  sha, hmac,
  keccak, keccakF1600, sha3, keccak256, shake,
};
