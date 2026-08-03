/*
 * serpent.js — Serpent 分组密码（cat:'modern'，双向）。
 *
 * Ross Anderson / Eli Biham / Lars Knudsen 设计，AES 竞赛亚军，128 位分组：
 *   - 128/192/256 位密钥，32 轮 SPN，8 个 4×4 S 盒（bit-sliced）。
 *   - 密钥调度：密钥补 1 位到 256 位 → W0..W7 → 仿射递推生成 W8..W139 →
 *     轮密钥 RK_i = S_{(3-i)%8}(W[8+4i .. 8+4i+3])。
 *   - 线性层：每轮后做固定位排列 + 左旋。
 *
 * 验证：与 encryption-for-node 参考实现逐向量对拍（128/192/256 位密钥 + 往返）。
 *
 * 约定（与其它分组密码 op 一致）：encode=加密 decode=解密（明文/密文/密钥 hex，ECB 多块）；
 *   128 位分组 = 16 字节 = 32 hex，末块不足报错（ECB 不填充）。明文/密文按 little-endian 字序。
 *
 * 红线：S 盒/线性层照 Serpent 规范；交付前过参考实现对拍。core 零 UI 依赖。
 */
import { register } from "./registry.js";

// ============================================================
// 标准 Serpent 4×4 S 盒（从参考实现提取，与论文一致）
// ============================================================
const SBOX = [
  [3,8,15,1,10,6,5,11,14,13,4,2,7,0,9,12],
  [15,12,2,7,9,0,5,10,1,11,14,8,6,13,3,4],
  [8,6,7,9,3,12,10,15,13,1,14,4,0,11,5,2],
  [0,15,11,8,12,9,6,3,13,1,2,4,10,7,5,14],
  [1,15,8,3,12,0,11,6,2,5,4,10,9,14,7,13],
  [15,5,2,11,4,10,9,12,0,3,14,8,13,6,7,1],
  [7,2,12,5,8,4,6,11,14,9,1,15,13,3,10,0],
  [1,13,15,0,14,8,2,11,7,4,12,10,9,3,5,6],
];
const ISBOX = SBOX.map(tbl => { const inv = new Array(16); for (let i = 0; i < 16; i++) inv[tbl[i]] = i; return inv; });

const rol32 = (v, n) => ((v << n) | (v >>> (32 - n))) >>> 0;
const ror32 = (v, n) => ((v >>> n) | (v << (32 - n))) >>> 0;

// bit-sliced S 盒：4 个 32 位字第 i 位组成 nibble，查表后写回
function applySbox(s, x0, x1, x2, x3) {
  let r0 = 0, r1 = 0, r2 = 0, r3 = 0;
  for (let i = 0; i < 32; i++) {
    const nib = ((x0 >>> i) & 1) | (((x1 >>> i) & 1) << 1) | (((x2 >>> i) & 1) << 2) | (((x3 >>> i) & 1) << 3);
    const out = s[nib];
    r0 |= (out & 1) ? (1 << i) : 0;
    r1 |= (out & 2) ? (1 << i) : 0;
    r2 |= (out & 4) ? (1 << i) : 0;
    r3 |= (out & 8) ? (1 << i) : 0;
  }
  return [r0 >>> 0, r1 >>> 0, r2 >>> 0, r3 >>> 0];
}

// ============================================================
// 线性变换（Serpent 规范）
// ============================================================
function linearTransform(x0, x1, x2, x3) {
  x0 = rol32(x0, 13); x2 = rol32(x2, 3);
  x1 ^= x0 ^ x2; x3 ^= x2 ^ (x0 << 3);
  x1 = rol32(x1, 1); x3 = rol32(x3, 7);
  x0 ^= x1 ^ x3; x2 ^= x3 ^ (x1 << 7);
  x0 = rol32(x0, 5); x2 = rol32(x2, 22);
  return [x0 >>> 0, x1 >>> 0, x2 >>> 0, x3 >>> 0];
}
function invLinearTransform(x0, x1, x2, x3) {
  x2 = ror32(x2, 22); x0 = ror32(x0, 5);
  x2 ^= x3 ^ (x1 << 7); x0 ^= x1 ^ x3;
  x3 = ror32(x3, 7); x1 = ror32(x1, 1);
  x3 ^= x2 ^ (x0 << 3); x1 ^= x0 ^ x2;
  x2 = ror32(x2, 3); x0 = ror32(x0, 13);
  return [x0 >>> 0, x1 >>> 0, x2 >>> 0, x3 >>> 0];
}

// ============================================================
// 密钥调度
// ============================================================
function serpentKeySchedule(keyHex) {
  const c = keyHex.replace(/[^0-9a-fA-F]/g, "");
  if (![32, 48, 64].includes(c.length)) throw new Error("Serpent 密钥须为 128/192/256 位（32/48/64 hex）");
  const key = new Uint8Array(c.length / 2);
  for (let i = 0; i < key.length; i++) key[i] = parseInt(c.substr(i * 2, 2), 16);
  const W = new Uint32Array(140);
  for (let i = 0; i < key.length; i++) W[i >>> 2] |= key[i] << ((i & 3) * 8);
  if (key.length < 32) { W[key.length >>> 2] |= 1 << ((key.length & 3) * 8); }
  for (let i = 8; i < 140; i++) {
    W[i] = rol32(W[i - 8] ^ W[i - 5] ^ W[i - 3] ^ W[i - 1] ^ 0x9e3779b9 ^ (i - 8), 11);
  }
  const rk = [];
  for (let i = 0; i < 33; i++) {
    rk.push(applySbox(SBOX[(3 - i % 8 + 8) % 8], W[8 + 4 * i], W[8 + 4 * i + 1], W[8 + 4 * i + 2], W[8 + 4 * i + 3]));
  }
  return rk;
}

// ============================================================
// 加解密
// ============================================================
function serpentEncryptBlock(block, rk) {
  let [x0, x1, x2, x3] = block;
  for (let r = 0; r < 31; r++) {
    x0 ^= rk[r][0]; x1 ^= rk[r][1]; x2 ^= rk[r][2]; x3 ^= rk[r][3];
    [x0, x1, x2, x3] = applySbox(SBOX[r % 8], x0, x1, x2, x3);
    [x0, x1, x2, x3] = linearTransform(x0, x1, x2, x3);
  }
  x0 ^= rk[31][0]; x1 ^= rk[31][1]; x2 ^= rk[31][2]; x3 ^= rk[31][3];
  [x0, x1, x2, x3] = applySbox(SBOX[7], x0, x1, x2, x3);
  x0 ^= rk[32][0]; x1 ^= rk[32][1]; x2 ^= rk[32][2]; x3 ^= rk[32][3];
  return [x0 >>> 0, x1 >>> 0, x2 >>> 0, x3 >>> 0];
}
function serpentDecryptBlock(block, rk) {
  let [x0, x1, x2, x3] = block;
  x0 ^= rk[32][0]; x1 ^= rk[32][1]; x2 ^= rk[32][2]; x3 ^= rk[32][3];
  [x0, x1, x2, x3] = applySbox(ISBOX[7], x0, x1, x2, x3);
  x0 ^= rk[31][0]; x1 ^= rk[31][1]; x2 ^= rk[31][2]; x3 ^= rk[31][3];
  for (let r = 30; r >= 0; r--) {
    [x0, x1, x2, x3] = invLinearTransform(x0, x1, x2, x3);
    [x0, x1, x2, x3] = applySbox(ISBOX[r % 8], x0, x1, x2, x3);
    x0 ^= rk[r][0]; x1 ^= rk[r][1]; x2 ^= rk[r][2]; x3 ^= rk[r][3];
  }
  return [x0 >>> 0, x1 >>> 0, x2 >>> 0, x3 >>> 0];
}

// little-endian 4 字节 ↔ u32（hex 串为字节序，u32 = LE 读：首字节为低位）
function le32(hex) {
  return parseInt(hex.substr(0, 2), 16) | (parseInt(hex.substr(2, 2), 16) << 8) | (parseInt(hex.substr(4, 2), 16) << 16) | (parseInt(hex.substr(6, 2), 16) << 24);
}
function u32le(v) {
  const b0 = (v >>> 0) & 0xff, b1 = (v >>> 8) & 0xff, b2 = (v >>> 16) & 0xff, b3 = (v >>> 24) & 0xff;
  return b0.toString(16).padStart(2, "0") + b1.toString(16).padStart(2, "0") + b2.toString(16).padStart(2, "0") + b3.toString(16).padStart(2, "0");
}

function serpentCrypt(text, p, decrypt) {
  const keyHex = String((p && p.key) || "");
  const rk = serpentKeySchedule(keyHex);
  const inHex = String(text || "").replace(/[^0-9a-fA-F]/g, "");
  if (inHex.length === 0 || inHex.length % 32 !== 0) throw new Error("输入须为 16 字节（32 hex）的整数倍，ECB 不自动填充");
  let out = "";
  for (let off = 0; off < inHex.length; off += 32) {
    const h = inHex.slice(off, off + 32);
    const res = decrypt
      ? serpentDecryptBlock([le32(h), le32(h.slice(8, 16)), le32(h.slice(16, 24)), le32(h.slice(24, 32))], rk)
      : serpentEncryptBlock([le32(h), le32(h.slice(8, 16)), le32(h.slice(16, 24)), le32(h.slice(24, 32))], rk);
    out += u32le(res[0]) + u32le(res[1]) + u32le(res[2]) + u32le(res[3]);
  }
  return out;
}
const serpentEncode = (t, p) => serpentCrypt(t, p, false);
const serpentDecode = (t, p) => serpentCrypt(t, p, true);

register({
  id: "serpent",
  cat: "modern",
  name: "Serpent",
  desc: "Serpent 分组密码（Anderson/Biham/Knudsen）：AES 竞赛亚军，128 位分组，128/192/256 位密钥，32 轮 SPN，8 个 bit-sliced S 盒。ECB 多块，明文/密文/密钥均 hex。encode 加密 / decode 解密。与参考实现逐向量对拍。",
  params: [
    { key: "key", label: "密钥 (hex, 128/192/256 位)", type: "text", default: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", placeholder: "32/48/64 hex 字符" },
  ],
  encode: serpentEncode,
  decode: serpentDecode,
});

export { serpentEncode, serpentDecode, serpentKeySchedule };