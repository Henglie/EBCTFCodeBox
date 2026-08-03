/*
 * skipjack.js — Skipjack 分组密码（cat:'modern'，encode/decode）。
 *
 * 算法照 NSA《SKIPJACK and KEA Algorithm Specifications v2.0》(1998)，
 * 实现结构与 Crypto++ skipjack.cpp 逐行一致（Crypto++ 通过 NIST SP800-17 Table 6 向量）。
 *
 * 结构：分组 64 位，密钥 80 位（10 字节），32 轮 = 8×A + 8×B + 8×A + 8×B。
 *   - G（key 相关置换）是 4 轮 Feistel，每轮用 1 个 key 字节的 F 表：
 *     w ^= F[w 低字节 ^ key_k]<<8; w ^= F[w 高字节 ^ key_k+1]; ...
 *   - 预处理：tab[i][c] = F[c ^ key[9-i]]（key 反序用于 tab，Crypto++ 约定）。
 *   - 展开轮（每步 g0..g4 循环取 tab，轮计数 k+1 异或进 w4/w3/w2/w1）。
 *   - 解密用逆置换 h（tab 参数同 g，步序反走）。
 * 字节序：word16 little-endian，块按 w4|w3|w2|w1 读入（w1 最低 16 位）。
 *
 * 红线：照 Crypto++ 参考实现逐行，不编造；纯本地；core 层零 UI 依赖（仅 registry）。
 *   载入自校验 NIST SP800-17 Table 6 Round 0（key=8000.., pt=0 → 7a00e49441461f5a）。
 *
 * 契约：register({ id:"skipjack", cat:"modern", name, desc, params, encode, decode })。
 *   明文/密文/密钥均 hex；ECB 多块；encode 加密 / decode 解密。
 */
import { register } from "./registry.js";

// F 置换表（NSA SKIPJACK spec 附录，与 Crypto++ fTable 逐项核对）
const F = new Uint8Array([
  0xa3,0xd7,0x09,0x83,0xf8,0x48,0xf6,0xf4,0xb3,0x21,0x15,0x78,0x99,0xb1,0xaf,0xf9,
  0xe7,0x2d,0x4d,0x8a,0xce,0x4c,0xca,0x2e,0x52,0x95,0xd9,0x1e,0x4e,0x38,0x44,0x28,
  0x0a,0xdf,0x02,0xa0,0x17,0xf1,0x60,0x68,0x12,0xb7,0x7a,0xc3,0xe9,0xfa,0x3d,0x53,
  0x96,0x84,0x6b,0xba,0xf2,0x63,0x9a,0x19,0x7c,0xae,0xe5,0xf5,0xf7,0x16,0x6a,0xa2,
  0x39,0xb6,0x7b,0x0f,0xc1,0x93,0x81,0x1b,0xee,0xb4,0x1a,0xea,0xd0,0x91,0x2f,0xb8,
  0x55,0xb9,0xda,0x85,0x3f,0x41,0xbf,0xe0,0x5a,0x58,0x80,0x5f,0x66,0x0b,0xd8,0x90,
  0x35,0xd5,0xc0,0xa7,0x33,0x06,0x65,0x69,0x45,0x00,0x94,0x56,0x6d,0x98,0x9b,0x76,
  0x97,0xfc,0xb2,0xc2,0xb0,0xfe,0xdb,0x20,0xe1,0xeb,0xd6,0xe4,0xdd,0x47,0x4a,0x1d,
  0x42,0xed,0x9e,0x6e,0x49,0x3c,0xcd,0x43,0x27,0xd2,0x07,0xd4,0xde,0xc7,0x67,0x18,
  0x89,0xcb,0x30,0x1f,0x8d,0xc6,0x8f,0xaa,0xc8,0x74,0xdc,0xc9,0x5d,0x5c,0x31,0xa4,
  0x70,0x88,0x61,0x2c,0x9f,0x0d,0x2b,0x87,0x50,0x82,0x54,0x64,0x26,0x7d,0x03,0x40,
  0x34,0x4b,0x1c,0x73,0xd1,0xc4,0xfd,0x3b,0xcc,0xfb,0x7f,0xab,0xe6,0x3e,0x5b,0xa5,
  0xad,0x04,0x23,0x9c,0x14,0x51,0x22,0xf0,0x29,0x79,0x71,0x7e,0xff,0x8c,0x0e,0xe2,
  0x0c,0xef,0xbc,0x72,0x75,0x6f,0x37,0xa1,0xec,0xd3,0x8e,0x62,0x8b,0x86,0x10,0xe8,
  0x08,0x77,0x11,0xbe,0x92,0x4f,0x24,0xc5,0x32,0x36,0x9d,0xcf,0xf3,0xa6,0xbb,0xac,
  0x5e,0x6c,0xa9,0x13,0x57,0x25,0xb5,0xe3,0xbd,0xa8,0x3a,0x01,0x05,0x59,0x2a,0x46,
]);

// tab[i][c] = F[c ^ key[9-i]]（10×256）
function makeTab(key) {
  const tab = new Array(10);
  for (let i = 0; i < 10; i++) {
    const t = new Uint8Array(256);
    const k = key[9 - i];
    for (let c = 0; c < 256; c++) t[c] = F[c ^ k];
    tab[i] = t;
  }
  return tab;
}

// g 宏（Crypto++）：w ^= tab[i][w&ff]<<8; w ^= tab[j][w>>8]; w ^= tab[k][w&ff]<<8; w ^= tab[l][w>>8]
function g(tab, w, i, j, k, l) {
  w ^= tab[i][w & 0xff] << 8;
  w ^= tab[j][w >> 8];
  w ^= tab[k][w & 0xff] << 8;
  w ^= tab[l][w >> 8];
  return w & 0xffff;
}
// h 宏（G 逆）：反序
function h(tab, w, i, j, k, l) {
  w ^= tab[l][w >> 8];
  w ^= tab[k][w & 0xff] << 8;
  w ^= tab[j][w >> 8];
  w ^= tab[i][w & 0xff] << 8;
  return w & 0xffff;
}

// ---- 块 16 位字字节流（word16 little-endian，照 Crypto++ BlockGetAndPut<word16,LittleEndian>）----
// 输入 hex16（16 hex = 8 字节）：字节 b0..b7 → w4=b0|b1<<8, w3=b2|b3<<8, w2=b4|b5<<8, w1=b6|b7<<8
function blockFromHex(hex16) {
  const p = (i) => parseInt(hex16.slice(2 * i, 2 * i + 2), 16);
  const w4 = p(0) | (p(1) << 8), w3 = p(2) | (p(3) << 8), w2 = p(4) | (p(5) << 8), w1 = p(6) | (p(7) << 8);
  return [w1, w2, w3, w4];
}
function blockToHex(w1, w2, w3, w4) {
  const le = (w) => (w & 0xff).toString(16).padStart(2, "0") + ((w >> 8) & 0xff).toString(16).padStart(2, "0");
  return le(w4) + le(w3) + le(w2) + le(w1);
}

function encryptBlock(blockHex, key) {
  const tab = makeTab(key);
  let [w1, w2, w3, w4] = blockFromHex(blockHex);
  // 规则 A
  w1 = g(tab, w1, 0, 1, 2, 3); w4 = (w4 ^ w1 ^ 1) & 0xffff;
  w4 = g(tab, w4, 4, 5, 6, 7); w3 = (w3 ^ w4 ^ 2) & 0xffff;
  w3 = g(tab, w3, 8, 9, 0, 1); w2 = (w2 ^ w3 ^ 3) & 0xffff;
  w2 = g(tab, w2, 2, 3, 4, 5); w1 = (w1 ^ w2 ^ 4) & 0xffff;
  w1 = g(tab, w1, 6, 7, 8, 9); w4 = (w4 ^ w1 ^ 5) & 0xffff;
  w4 = g(tab, w4, 0, 1, 2, 3); w3 = (w3 ^ w4 ^ 6) & 0xffff;
  w3 = g(tab, w3, 4, 5, 6, 7); w2 = (w2 ^ w3 ^ 7) & 0xffff;
  w2 = g(tab, w2, 8, 9, 0, 1); w1 = (w1 ^ w2 ^ 8) & 0xffff;
  // 规则 B
  w2 = (w2 ^ w1 ^ 9) & 0xffff; w1 = g(tab, w1, 2, 3, 4, 5);
  w1 = (w1 ^ w4 ^ 10) & 0xffff; w4 = g(tab, w4, 6, 7, 8, 9);
  w4 = (w4 ^ w3 ^ 11) & 0xffff; w3 = g(tab, w3, 0, 1, 2, 3);
  w3 = (w3 ^ w2 ^ 12) & 0xffff; w2 = g(tab, w2, 4, 5, 6, 7);
  w2 = (w2 ^ w1 ^ 13) & 0xffff; w1 = g(tab, w1, 8, 9, 0, 1);
  w1 = (w1 ^ w4 ^ 14) & 0xffff; w4 = g(tab, w4, 2, 3, 4, 5);
  w4 = (w4 ^ w3 ^ 15) & 0xffff; w3 = g(tab, w3, 6, 7, 8, 9);
  w3 = (w3 ^ w2 ^ 16) & 0xffff; w2 = g(tab, w2, 0, 1, 2, 3);
  // 规则 A
  w1 = g(tab, w1, 4, 5, 6, 7); w4 = (w4 ^ w1 ^ 17) & 0xffff;
  w4 = g(tab, w4, 8, 9, 0, 1); w3 = (w3 ^ w4 ^ 18) & 0xffff;
  w3 = g(tab, w3, 2, 3, 4, 5); w2 = (w2 ^ w3 ^ 19) & 0xffff;
  w2 = g(tab, w2, 6, 7, 8, 9); w1 = (w1 ^ w2 ^ 20) & 0xffff;
  w1 = g(tab, w1, 0, 1, 2, 3); w4 = (w4 ^ w1 ^ 21) & 0xffff;
  w4 = g(tab, w4, 4, 5, 6, 7); w3 = (w3 ^ w4 ^ 22) & 0xffff;
  w3 = g(tab, w3, 8, 9, 0, 1); w2 = (w2 ^ w3 ^ 23) & 0xffff;
  w2 = g(tab, w2, 2, 3, 4, 5); w1 = (w1 ^ w2 ^ 24) & 0xffff;
  // 规则 B
  w2 = (w2 ^ w1 ^ 25) & 0xffff; w1 = g(tab, w1, 6, 7, 8, 9);
  w1 = (w1 ^ w4 ^ 26) & 0xffff; w4 = g(tab, w4, 0, 1, 2, 3);
  w4 = (w4 ^ w3 ^ 27) & 0xffff; w3 = g(tab, w3, 4, 5, 6, 7);
  w3 = (w3 ^ w2 ^ 28) & 0xffff; w2 = g(tab, w2, 8, 9, 0, 1);
  w2 = (w2 ^ w1 ^ 29) & 0xffff; w1 = g(tab, w1, 2, 3, 4, 5);
  w1 = (w1 ^ w4 ^ 30) & 0xffff; w4 = g(tab, w4, 6, 7, 8, 9);
  w4 = (w4 ^ w3 ^ 31) & 0xffff; w3 = g(tab, w3, 0, 1, 2, 3);
  w3 = (w3 ^ w2 ^ 32) & 0xffff; w2 = g(tab, w2, 4, 5, 6, 7);
  return blockToHex(w1, w2, w3, w4);
}

function decryptBlock(blockHex, key) {
  const tab = makeTab(key);
  let [w1, w2, w3, w4] = blockFromHex(blockHex);
  // 逆规则 A（h1..h4 与 g1..g4 同参数，h 函数体内部反序使用 tab）
  w2 = h(tab, w2, 4, 5, 6, 7); w3 = (w3 ^ w2 ^ 32) & 0xffff;
  w3 = h(tab, w3, 0, 1, 2, 3); w4 = (w4 ^ w3 ^ 31) & 0xffff;
  w4 = h(tab, w4, 6, 7, 8, 9); w1 = (w1 ^ w4 ^ 30) & 0xffff;
  w1 = h(tab, w1, 2, 3, 4, 5); w2 = (w2 ^ w1 ^ 29) & 0xffff;
  w2 = h(tab, w2, 8, 9, 0, 1); w3 = (w3 ^ w2 ^ 28) & 0xffff;
  w3 = h(tab, w3, 4, 5, 6, 7); w4 = (w4 ^ w3 ^ 27) & 0xffff;
  w4 = h(tab, w4, 0, 1, 2, 3); w1 = (w1 ^ w4 ^ 26) & 0xffff;
  w1 = h(tab, w1, 6, 7, 8, 9); w2 = (w2 ^ w1 ^ 25) & 0xffff;
  // 逆规则 B
  w1 = (w1 ^ w2 ^ 24) & 0xffff; w2 = h(tab, w2, 2, 3, 4, 5);
  w2 = (w2 ^ w3 ^ 23) & 0xffff; w3 = h(tab, w3, 8, 9, 0, 1);
  w3 = (w3 ^ w4 ^ 22) & 0xffff; w4 = h(tab, w4, 4, 5, 6, 7);
  w4 = (w4 ^ w1 ^ 21) & 0xffff; w1 = h(tab, w1, 0, 1, 2, 3);
  w1 = (w1 ^ w2 ^ 20) & 0xffff; w2 = h(tab, w2, 6, 7, 8, 9);
  w2 = (w2 ^ w3 ^ 19) & 0xffff; w3 = h(tab, w3, 2, 3, 4, 5);
  w3 = (w3 ^ w4 ^ 18) & 0xffff; w4 = h(tab, w4, 8, 9, 0, 1);
  w4 = (w4 ^ w1 ^ 17) & 0xffff; w1 = h(tab, w1, 4, 5, 6, 7);
  // 逆规则 A
  w2 = h(tab, w2, 0, 1, 2, 3); w3 = (w3 ^ w2 ^ 16) & 0xffff;
  w3 = h(tab, w3, 6, 7, 8, 9); w4 = (w4 ^ w3 ^ 15) & 0xffff;
  w4 = h(tab, w4, 2, 3, 4, 5); w1 = (w1 ^ w4 ^ 14) & 0xffff;
  w1 = h(tab, w1, 8, 9, 0, 1); w2 = (w2 ^ w1 ^ 13) & 0xffff;
  w2 = h(tab, w2, 4, 5, 6, 7); w3 = (w3 ^ w2 ^ 12) & 0xffff;
  w3 = h(tab, w3, 0, 1, 2, 3); w4 = (w4 ^ w3 ^ 11) & 0xffff;
  w4 = h(tab, w4, 6, 7, 8, 9); w1 = (w1 ^ w4 ^ 10) & 0xffff;
  w1 = h(tab, w1, 2, 3, 4, 5); w2 = (w2 ^ w1 ^ 9) & 0xffff;
  // 逆规则 B
  w1 = (w1 ^ w2 ^ 8) & 0xffff; w2 = h(tab, w2, 8, 9, 0, 1);
  w2 = (w2 ^ w3 ^ 7) & 0xffff; w3 = h(tab, w3, 4, 5, 6, 7);
  w3 = (w3 ^ w4 ^ 6) & 0xffff; w4 = h(tab, w4, 0, 1, 2, 3);
  w4 = (w4 ^ w1 ^ 5) & 0xffff; w1 = h(tab, w1, 6, 7, 8, 9);
  w1 = (w1 ^ w2 ^ 4) & 0xffff; w2 = h(tab, w2, 2, 3, 4, 5);
  w2 = (w2 ^ w3 ^ 3) & 0xffff; w3 = h(tab, w3, 8, 9, 0, 1);
  w3 = (w3 ^ w4 ^ 2) & 0xffff; w4 = h(tab, w4, 4, 5, 6, 7);
  w4 = (w4 ^ w1 ^ 1) & 0xffff; w1 = h(tab, w1, 0, 1, 2, 3);
  return blockToHex(w1, w2, w3, w4);
}

// ---- hex/字节 工具 ----
function cleanHex(s) { return String(s || "").replace(/[^0-9a-fA-F]/g, ""); }
function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

function skipjackRun(text, p, dir) {
  const keyHex = cleanHex(p && p.key);
  if (keyHex.length !== 20) throw new Error("Skipjack 密钥须为 80 位（20 个 hex 字符 / 10 字节）");
  const key = hexToBytes(keyHex);
  const dataHex = cleanHex(text);
  if (dataHex.length % 16 !== 0) throw new Error("数据须为 8 字节（16 hex）的整数倍（ECB 分组）");
  let out = "";
  for (let i = 0; i < dataHex.length; i += 16) {
    const res = dir === "enc" ? encryptBlock(dataHex.slice(i, i + 16), key) : decryptBlock(dataHex.slice(i, i + 16), key);
    out += res;
  }
  return out;
}

// 载入自校验：NIST SP800-17 Table 6 Round 0
(() => {
  const key = hexToBytes("80000000000000000000");
  if (encryptBlock("0000000000000000", key) !== "7a00e49441461f5a") {
    throw new Error("Skipjack 自检失败（SP800-17 Round0 ≠ 7a00e49441461f5a）");
  }
})();

register({
  id: "skipjack",
  cat: "modern",
  name: "Skipjack 分组密码",
  desc: "Skipjack 分组密码（NSA 1998 解密，Clipper 芯片核心）：64 位分组，80 位密钥，32 轮（8A+8B+8A+8B）。明文/密文/密钥均 hex，ECB 多块。encode 加密 / decode 解密。已过 NIST SP800-17 Table 6 官方向量。",
  params: [
    { key: "key", label: "密钥 (hex, 80 位)", type: "text", default: "00998877665544332211", placeholder: "20 个 hex 字符" },
  ],
  encode: (text, p) => skipjackRun(text, p, "enc"),
  decode: (text, p) => skipjackRun(text, p, "dec"),
});

export { encryptBlock, decryptBlock, makeTab, g, h };
