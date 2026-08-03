/*
 * magma.js — GOST R 34.12-2015 「Magma」分组密码（cat:'modern'，双向）。
 *
 * 俄罗斯联邦标准（原 GOST 28147-89 的现代化定义），信创/国际赛题常见：
 *   - 分组 64 位，密钥 256 位，32 轮 Feistel。
 *   - S 盒采用 id-tc26-gost-28147-param-Z（2015 标准指定集合）。
 *   - 轮函数 g[k](a) = t((a ⊞ k) mod 2^32) <<< 11（⊞ 模 2^32 加，<<< 循环左移 11）。
 *   - t 变换：把 32 位拆 8 个 4 位半字节，第 i 个半字节过 S 盒 π_i（半字节 0 = 最低位）。
 *   - 轮密钥：K1..K8 顺序重复 3 遍（轮 1-24），末 8 轮（25-32）用 K8..K1 逆序。
 *
 * 官方测试向量（GOST R 34.12-2015 §A.2）：
 *   Key = ffeeddccbbaa99887766554433221100f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff
 *   明文 fedcba9876543210 → 密文 4ee901e5c2d8ca3d
 *
 * 约定（与其它分组密码 op 一致）：
 *   - encode: 明文 hex → 密文 hex（加密）；decode: 密文 hex → 明文 hex（解密）。ECB，可多块。
 *   - 明文/密文按 8 字节（16 hex）分块，最后不足块报错（ECB 不自动填充）。
 *
 * 红线：算法照 GOST R 34.12-2015 实现，不编造；建表后自校验 t(fdb97531)=2a196f34；
 *   交付前过官方向量。纯本地零外发；core 层零 UI 依赖（仅 registry）。
 *
 * 契约：register({ id:"magma", cat:"modern", name, desc, params, encode, decode })。
 */
import { register } from "./registry.js";

// ============================================================
// S 盒 id-tc26-gost-28147-param-Z（8 个，各 16 个 4 位值；π_i 作用于半字节 i）
// ============================================================
const SBOX = [
  [12, 4, 6, 2, 10, 5, 11, 9, 14, 8, 13, 7, 0, 3, 15, 1],
  [6, 8, 2, 3, 9, 10, 5, 12, 1, 14, 4, 7, 11, 13, 0, 15],
  [11, 3, 5, 8, 2, 15, 10, 13, 14, 1, 7, 4, 12, 9, 6, 0],
  [12, 8, 2, 1, 13, 4, 15, 6, 7, 0, 10, 5, 3, 14, 9, 11],
  [7, 15, 5, 10, 8, 1, 6, 13, 0, 9, 3, 14, 11, 4, 2, 12],
  [5, 13, 15, 6, 9, 2, 12, 10, 11, 7, 8, 1, 4, 3, 14, 0],
  [8, 14, 2, 5, 6, 9, 1, 12, 15, 4, 11, 0, 13, 10, 3, 7],
  [1, 7, 14, 13, 0, 5, 8, 3, 4, 15, 10, 6, 9, 12, 11, 2],
];

// t 变换：32 位 → 32 位，逐半字节过 S 盒（半字节 0 = 最低 4 位）
function tTransform(x) {
  let out = 0;
  for (let i = 0; i < 8; i++) {
    const nib = (x >>> (4 * i)) & 0xf;
    out |= SBOX[i][nib] << (4 * i);
  }
  return out >>> 0;
}

// 轮函数 g[k](a) = t((a + k) mod 2^32) <<< 11
function g(a, k) {
  const s = tTransform(((a >>> 0) + (k >>> 0)) >>> 0);
  return ((s << 11) | (s >>> 21)) >>> 0;
}

// 建表自校验（规范锚点）：t(fdb97531) = 2a196f34
if (tTransform(0xfdb97531) >>> 0 !== 0x2a196f34) {
  // eslint-disable-next-line no-console
  console.error("Magma t() 自检失败:", (tTransform(0xfdb97531) >>> 0).toString(16));
  throw new Error("Magma S 盒/ t 变换构造自检失败（t(fdb97531)≠2a196f34）");
}

// ============================================================
// 密钥调度：256 位 → K1..K8（K1 为高 32 位），32 轮密钥
// ============================================================
function keySchedule(keyHex) {
  const clean = keyHex.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length !== 64) throw new Error("Magma 密钥须为 256 位（64 hex 字符）");
  const K = [];
  for (let i = 0; i < 8; i++) K.push(parseInt(clean.substr(i * 8, 8), 16) >>> 0);
  // 轮 1-24：K1..K8 重复 3 遍；轮 25-32：K8..K1
  const rk = [];
  for (let r = 0; r < 24; r++) rk.push(K[r % 8]);
  for (let r = 0; r < 8; r++) rk.push(K[7 - r]);
  return rk;
}

// ============================================================
// 单块加/解密（64 位，输入 [hi32, lo32]）
// ============================================================
function crypt64(hi, lo, rk, decrypt) {
  let a1 = hi >>> 0;
  let a0 = lo >>> 0;
  const order = decrypt ? [...rk].reverse() : rk;
  for (let i = 0; i < 31; i++) {
    const t = (a1 ^ g(a0, order[i])) >>> 0;
    a1 = a0;
    a0 = t;
  }
  a1 = (a1 ^ g(a0, order[31])) >>> 0;
  return [a1 >>> 0, a0 >>> 0];
}

function hexToBlocks(hex) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 16 !== 0) throw new Error("输入须为 8 字节（16 hex）的整数倍（ECB 不自动填充）");
  const blocks = [];
  for (let i = 0; i < clean.length; i += 16) {
    blocks.push([parseInt(clean.substr(i, 8), 16) >>> 0, parseInt(clean.substr(i + 8, 8), 16) >>> 0]);
  }
  return blocks;
}

function u32Hex(x) { return (x >>> 0).toString(16).padStart(8, "0"); }

function magmaCrypt(text, p, decrypt) {
  const keyHex = String((p && p.key) || "");
  const rk = keySchedule(keyHex);
  const blocks = hexToBlocks(String(text || ""));
  if (blocks.length === 0) throw new Error("输入为空");
  let out = "";
  for (const [hi, lo] of blocks) {
    const [rhi, rlo] = crypt64(hi, lo, rk, decrypt);
    out += u32Hex(rhi) + u32Hex(rlo);
  }
  return out;
}

function magmaEncode(text, p) { return magmaCrypt(text, p, false); }
function magmaDecode(text, p) { return magmaCrypt(text, p, true); }

register({
  id: "magma",
  cat: "modern",
  name: "Magma（GOST R 34.12-2015）",
  desc: "俄罗斯联邦标准 Magma 分组密码（原 GOST 28147-89 现代化定义）：64 位分组 / 256 位密钥 / 32 轮 Feistel，S 盒 id-tc26-gost-28147-param-Z。ECB 多块，明文/密文/密钥均 hex。encode 加密 / decode 解密。过官方 §A.2 向量。",
  params: [
    { key: "key", label: "密钥 (hex, 256 位 / 64 字符)", type: "text", default: "ffeeddccbbaa99887766554433221100f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff", placeholder: "64 hex 字符" },
  ],
  encode: magmaEncode,
  decode: magmaDecode,
});

export { magmaEncode, magmaDecode, tTransform, g, keySchedule };
