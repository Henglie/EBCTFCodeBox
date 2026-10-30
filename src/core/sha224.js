/*
 * sha224.js — SHA-224 消息摘要（FIPS 180-4 §6.2.2 / §5.3.2，纯 JS）。
 *
 * SHA-224 与 SHA-256 共用同一压缩函数与 K 常量表（§6.2.2），仅两处不同：
 *   ① 初始哈希值 IV（§5.3.2：c1059ed8 367cd507 3070dd17 f70e5939 ffc00b31
 *      68581511 64f98fa7 befa4fa4 —— 第 9..16 个素数平方根小数部分前 32 位，
 *      已逐词对照 FIPS 180-4 原文；h7 曾误抄 befafa53，被官方向量验证抓出修正）；
 *   ② 输出截断前 28 字节（224 位）。
 * 为什么纯 JS：WebCrypto digest 不支持 "SHA-224"（Chrome/Firefox/Node 实测
 * NotSupportedError），与 hash.js 的 sha256（WebCrypto）不同源但逐字节互认。
 *
 * 复用关系：不 import hash.js 的 WebCrypto sha256（它不是压缩函数）；压缩函数
 * 本体按 FIPS 180-4 在本文件实现，验证与 node:crypto(OpenSSL) 逐字节对拍 + 
 * FIPS 180-4 官方向量。
 *
 * 与 SHA-3 的关系：SHA-2 族（含 SHA-224）基于 Merkle-Damgård，与 Keccak 海绵
 * 结构的 SHA-3 完全不同系；SHA-224 是 SHA-256 的截断档（同族），不是 SHA-3 档。
 *
 * 红线：纯本地计算，零外发；不取随机字节。
 */

import { register } from "./registry.js";

// FIPS 180-4 §4.2.2 K 常量（前 64 个素数的立方根小数部分前 32 位）
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

// SHA-256 压缩（§6.2.2），iv 决定 SHA-224/SHA-256，outBytes 决定截断
function sha256Core(msg, iv, outBytes) {
  // 消息填充 §5.1.1：0x80 || 0x00* || 64 位大端长度
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
    for (let t = 0; t < 64; t++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H = H.map((v, i) => (v + [a, b, c, d, e, f, g, h][i]) >>> 0);
  }
  // 大端拼接后截断（SHA-224 取前 28 字节，§5.3.2/§6.2.2）
  const out = new Uint8Array(outBytes);
  for (let i = 0; i < outBytes; i++) out[i] = (H[i >> 2] >>> (24 - (i & 3) * 8)) & 0xff;
  return out;
}

const IV_224 = [0xc1059ed8, 0x367cd507, 0x3070dd17, 0xf70e5939, 0xffc00b31, 0x68581511, 0x64f98fa7, 0xbefa4fa4];
const IV_256 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const IV_BY_BITS = { 224: IV_224, 256: IV_256 };
const OUT_BY_BITS = { 224: 28, 256: 32 };

function toHex(b) { return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join(""); }

register({
  id: "sha224",
  cat: "hash",
  name: "SHA-224",
  family: "sha",
  familyLabel: "SHA-224",
  desc: "SHA-224 消息摘要（FIPS 180-4，纯 JS——WebCrypto 不支持 SHA-224）：SHA-256 压缩函数 + 专属 IV + 输出截断 224 位。与 SHA-256 同族同强度逻辑（SHA-256 截断档），与 SHA-3（Keccak 海绵结构）完全不同系。本实现与 node:crypto/OpenSSL 逐字节对拍",
  acceptsBytes: true, textTransit: true,
  params: [
    { key: "bits", label: "输出位数", type: "select", default: 224, options: [
      { value: 224, label: "224（SHA-224）" },
      { value: 256, label: "256（SHA-256，同实现交叉自证）" },
    ] },
  ],
  run: (t, p) => {
    const bits = (p && Number(p.bits)) === 256 ? 256 : 224;
    const raw = p && p.rawBytes;
    let msg;
    if (raw) msg = raw;
    else {
      msg = new TextEncoder().encode(String(t ?? ""));
    }
    return toHex(sha256Core(msg, IV_BY_BITS[bits], OUT_BY_BITS[bits]));
  },
});
