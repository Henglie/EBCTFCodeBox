/*
 * streebog.js — Streebog 哈希（cat:'hash'，run）。
 *
 * 俄罗斯国标哈希 GOST R 34.11-2012（RFC 6986），信创/国际赛题常见，512 位输出：
 *   - Merkle-Damgård + 12 轮压缩函数 g_N，轮内 8×8 字节矩阵 S/P/L 变换。
 *   - S：逐字节过 Pi 替换盒；P：8×8 字节矩阵转置；L：每 64 位字过 GF(2) 线性变换矩阵 A。
 *   - 压缩函数 g_N(h,m) = E(LPS(h⊕N), m) ⊕ h ⊕ m；E = 12 轮 LPSX + 终 XOR。
 *   - 256 位输出 = 512 位哈希的高 256 位（MSB），IV 不同。
 *
 * 官方测试向量（RFC 6986 §10，逐中间值核对）：
 *   M1（504 bit）→ 512 位 H = 486f64c1917879417fef082b3381a4e2…
 *   M1 → 256 位 H = 00557be5e584fd52a449b16b0251d05d…
 *
 * 红线：RFC 6986 原文实现不编造；S 盒/矩阵/常量照表抄；交付前过官方向量。core 零 UI 依赖。
 */
import { register } from "./registry.js";

// ============================================================
// Pi S-box（RFC 6986 §6.2，256 项）
// ============================================================
const PI = Uint8Array.from([
  252,238,221, 17,207,110, 49, 22,251,196,250,218, 35,197,  4, 77,
  233,119,240,219,147, 46,153,186, 23, 54,241,187, 20,205, 95,193,
  249, 24,101, 90,226, 92,239, 33,129, 28, 60, 66,139,  1,142, 79,
    5,132,  2,174,227,106,143,160,  6, 11,237,152,127,212,211, 31,
  235, 52, 44, 81,234,200, 72,171,242, 42,104,162,253, 58,206,204,
  181,112, 14, 86,  8, 12,118, 18,191,114, 19, 71,156,183, 93,135,
   21,161,150, 41, 16,123,154,199,243,145,120,111,157,158,178,177,
   50,117, 25, 61,255, 53,138,126,109, 84,198,128,195,189, 13, 87,
  223,245, 36,169, 62,168, 67,201,215,121,214,246,124, 34,185,  3,
  224, 15,236,222,122,148,176,188,220,232, 40, 80, 78, 51, 10, 74,
  167,151, 96,115, 30,  0, 98, 68, 26,184, 56,130,100,159, 38, 65,
  173, 69, 70,146, 39, 94, 85, 47,140,163,165,125,105,213,149, 59,
    7, 88,179, 64,134,172, 29,247, 48, 55,107,228,136,217,231,137,
  225, 27,131, 73, 76, 63,248,254,141, 83,170,144,202,216,133, 97,
   32,113,103,164, 45, 43,  9, 91,203,155, 37,208,190,229,108, 82,
   89,166,116,210,230,244,180,192,209,102,175,194, 57, 75, 99,182,
]);

// ============================================================
// 线性变换矩阵 A（RFC 6986 §6.4，64 行 × 64 位）
// ============================================================
const A_ROWS = [
  0x8e20faa72ba0b470n,0x47107ddd9b505a38n,0xad08b0e0c3282d1cn,0xd8045870ef14980en,
  0x6c022c38f90a4c07n,0x3601161cf205268dn,0x1b8e0b0e798c13c8n,0x83478b07b2468764n,
  0xa011d380818e8f40n,0x5086e740ce47c920n,0x2843fd2067adea10n,0x14aff010bdd87508n,
  0x0ad97808d06cb404n,0x05e23c0468365a02n,0x8c711e02341b2d01n,0x46b60f011a83988en,
  0x90dab52a387ae76fn,0x486dd4151c3dfdb9n,0x24b86a840e90f0d2n,0x125c354207487869n,
  0x092e94218d243cban,0x8a174a9ec8121e5dn,0x4585254f64090fa0n,0xaccc9ca9328a8950n,
  0x9d4df05d5f661451n,0xc0a878a0a1330aa6n,0x60543c50de970553n,0x302a1e286fc58ca7n,
  0x18150f14b9ec46ddn,0x0c84890ad27623e0n,0x0642ca05693b9f70n,0x0321658cba93c138n,
  0x86275df09ce8aaa8n,0x439da0784e745554n,0xafc0503c273aa42an,0xd960281e9d1d5215n,
  0xe230140fc0802984n,0x71180a8960409a42n,0xb60c05ca30204d21n,0x5b068c651810a89en,
  0x456c34887a3805b9n,0xac361a443d1c8cd2n,0x561b0d22900e4669n,0x2b838811480723ban,
  0x9bcf4486248d9f5dn,0xc3e9224312c8c1a0n,0xeffa11af0964ee50n,0xf97d86d98a327728n,
  0xe4fa2054a80b329cn,0x727d102a548b194en,0x39b008152acb8227n,0x9258048415eb419dn,
  0x492c024284fbaec0n,0xaa16012142f35760n,0x550b8e9e21f7a530n,0xa48b474f9ef5dc18n,
  0x70a6a56e2440598en,0x3853dc371220a247n,0x1ca76e95091051adn,0x0edd37c48a08a6d8n,
  0x07e095624504536cn,0x8d70c431ac02a736n,0xc83862965601dd1bn,0x641c314b2b8ee083n,
];
const MASK64 = (1n << 64n) - 1n;
// 预计算 l 变换表：L_TABLE[p][v]，p=字节位置(0=最高字节)，v=字节值 → 64 位输出
const L_TABLE = (() => {
  const tbl = new Array(8);
  for (let p = 0; p < 8; p++) {
    const row = new Array(256);
    for (let v = 0; v < 256; v++) {
      let out = 0n;
      for (let k = 0; k < 8; k++) if (v & (1 << (7 - k))) out ^= A_ROWS[8 * p + k];
      row[v] = out;
    }
    tbl[p] = row;
  }
  return tbl;
})();
// 64 位 l 变换
function l64(w) {
  let out = 0n;
  for (let p = 0; p < 8; p++) {
    const byte = Number((w >> BigInt(8 * (7 - p))) & 0xffn);
    out ^= L_TABLE[p][byte];
  }
  return out & MASK64;
}

// ============================================================
// 512 位状态变换：S / P / L / LPS
// ============================================================
function S512(u8) { for (let i = 0; i < 64; i++) u8[i] = PI[u8[i]]; return u8; }
// P：8×8 转置。输出[k] = 输入[(k&7)*8 + (k>>3)]
function P512(u8) {
  const out = new Uint8Array(64);
  for (let k = 0; k < 64; k++) out[k] = u8[(k & 7) * 8 + (k >> 3)];
  return out;
}
// L：每 8 字节一个字过 l64。字序：a_7(最高) 在前
function L512(u8) {
  const out = new Uint8Array(64);
  for (let i = 0; i < 8; i++) {
    let w = 0n;
    for (let j = 0; j < 8; j++) w = (w << 8n) | BigInt(u8[i * 8 + j]);
    w = l64(w);
    for (let j = 0; j < 8; j++) out[i * 8 + j] = Number((w >> BigInt(8 * (7 - j))) & 0xffn);
  }
  return out;
}
function LPS(u8) { return L512(P512(S512(u8.slice()))); }
function Xor(a, b) { const r = new Uint8Array(64); for (let i = 0; i < 64; i++) r[i] = a[i] ^ b[i]; return r; }

// ============================================================
// 迭代常量 C[1..12]（RFC §6.5）
// ============================================================
const CARR = [
  "b1085bda1ecadae9ebcb2f81c0657c1f2f6a76432e45d016714eb88d7585c4fc4b7ce09192676901a2422a08a460d31505767436cc744d23dd806559f2a64507",
  "6fa3b58aa99d2f1a4fe39d460f70b5d7f3feea720a232b9861d55e0f16b501319ab5176b12d699585cb561c2db0aa7ca55dda21bd7cbcd56e679047021b19bb7",
  "f574dcac2bce2fc70a39fc286a3d843506f15e5f529c1f8bf2ea7514b1297b7bd3e20fe490359eb1c1c93a376062db09c2b6f443867adb31991e96f50aba0ab2",
  "ef1fdfb3e81566d2f948e1a05d71e4dd488e857e335c3c7d9d721cad685e353fa9d72c82ed03d675d8b71333935203be3453eaa193e837f1220cbebc84e3d12e",
  "4bea6bacad4747999a3f410c6ca923637f151c1f1686104a359e35d7800fffbdbfcd1747253af5a3dfff00b723271a167a56a27ea9ea63f5601758fd7c6cfe57",
  "ae4faeae1d3ad3d96fa4c33b7a3039c02d66c4f95142a46c187f9ab49af08ec6cffaa6b71c9ab7b40af21f66c2bec6b6bf71c57236904f35fa68407a46647d6e",
  "f4c70e16eeaac5ec51ac86febf240954399ec6c7e6bf87c9d3473e33197a93c90992abc52d822c3706476983284a05043517454ca23c4af38886564d3a14d493",
  "9b1f5b424d93c9a703e7aa020c6e41414eb7f8719c36de1e89b4443b4ddbc49af4892bcb929b069069d18d2bd1a5c42f36acc2355951a8d9a47f0dd4bf02e71e",
  "378f5a541631229b944c9ad8ec165fde3a7d3a1b258942243cd955b7e00d0984800a440bdbb2ceb17b2b8a9aa6079c540e38dc92cb1f2a607261445183235adb",
  "abbedea680056f52382ae548b2e4f3f38941e71cff8a78db1fffe18a1b3361039fe76702af69334b7a1e6c303b7652f43698fad1153bb6c374b4c7fb98459ced",
  "7bcd9ed0efc889fb3002c6cd635afe94d8fa6bbbebab076120018021148466798a1d71efea48b9caefbacd1d7d476e98dea2594ac06fd85d6bcaa4cd81f32d1b",
  "378ee767f11631bad21380b00449b17acda43c32bcdf1d77f82012d430219f9b5d80ef9d1891cc86e71da4aa88e12852faf417d5d9b21b9948bc924af11bd720",
].map(hex => {
  const b = new Uint8Array(64);
  for (let i = 0; i < 64; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16);
  return b;
});

// ============================================================
// 压缩函数 g_N
// ============================================================
function gN(h, m, N) {
  const K = LPS(Xor(h, N)); // K = LPS(h⊕N)
  const Ks = [K];
  for (let i = 1; i < 13; i++) Ks.push(LPS(Xor(Ks[i - 1], CARR[i - 1])));
  let state = m.slice();
  for (let i = 0; i < 12; i++) state = LPS(Xor(state, Ks[i]));
  state = Xor(state, Ks[12]);
  return Xor(Xor(state, h), m);
}

// 512 位字节数组按整数加法（mod 2^512）
function addInt(u8, n) {
  let carry = n;
  for (let i = 63; i >= 0 && carry > 0n; i--) {
    const sum = BigInt(u8[i]) + (carry & 0xffn);
    u8[i] = Number(sum & 0xffn);
    carry = (carry >> 8n) + (sum >> 8n);
  }
  return u8;
}
function addBytes(u8, blk) {
  let carry = 0n;
  for (let i = 63; i >= 0; i--) {
    const sum = BigInt(u8[i]) + BigInt(blk[i]) + carry;
    u8[i] = Number(sum & 0xffn);
    carry = sum >> 8n;
  }
  return u8;
}

// ============================================================
// 主哈希
// ============================================================
function streebog(input, outputBits = 512) {
  const raw = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
 // 本实现内部把 512 位块当「低位在后」的大整数处理，与标准的字节序相反：
 // 消息须整体字节反转后送入，摘要再整体字节反转输出，才与 GOST R 34.11-2012 一致。
 // 注意：全同字节的测试数据（"000…0"）反转后不变，无法暴露此错位——
 // 必须用非均匀向量（RFC 6986 §10 的 M1）校验。
  const msg = new Uint8Array(raw).reverse();
  const IV = new Uint8Array(64);
  if (outputBits === 256) for (let i = 0; i < 64; i++) IV[i] = 1;
  let h = IV.slice();
  let N = new Uint8Array(64);
  let EPS = new Uint8Array(64);
  let m = msg.slice();
  while (m.length >= 64) {
    const blk = m.slice(m.length - 64);
    h = gN(h, blk, N);
    addInt(N, 512n);
    addBytes(EPS, blk);
    m = m.slice(0, m.length - 64);
  }
  // 填充：0^(511-|M|) || 1 || M（|M| 为剩余 bit 数）
  const totalBits = m.length * 8;
  const padded = new Uint8Array(64);
  for (let i = 0; i < totalBits; i++) {
    const bit = (m[m.length - 1 - (i >> 3)] >> (i & 7)) & 1;
    if (bit) padded[63 - (i >> 3)] |= 1 << (i & 7);
  }
  padded[63 - (totalBits >> 3)] |= 1 << (totalBits & 7);
  h = gN(h, padded, N);
  addInt(N, BigInt(totalBits));
  addBytes(EPS, padded);
  const zN = new Uint8Array(64), zE = new Uint8Array(64);
  h = gN(h, N, zN);
  h = gN(h, EPS, zE);
  const nbytes = outputBits / 8;
  const out = new Uint8Array(h.slice(0, nbytes)).reverse(); // 见上：输出同样需反转
  return Array.from(out).map(b => b.toString(16).padStart(2, "0")).join("");
}

register({
  id: "streebog",
  cat: "hash",
  name: "Streebog（GOST R 34.11-2012）",
  desc: "俄罗斯国标哈希 Streebog（GOST R 34.11-2012 / RFC 6986）：512 位输出（可选 256 位截断），Merkle-Damgård + 12 轮压缩函数，信创与俄系赛题常见。参数 len=512/256。过 RFC 6986 §10 官方向量。",
  params: [
    { key: "len", label: "输出长度", type: "select", default: "512", options: ["512", "256"] },
  ],
  run: async (text, p) => streebog(text, (p && p.len) === "256" ? 256 : 512),
});

export { streebog, gN, LPS, l64 };