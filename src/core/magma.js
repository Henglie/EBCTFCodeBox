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
 * 模式（GOST R 34.13-2015 / 1989 变体按 RFC 5830）：
 *   - ECB/CBC/CFB/OFB/CTR；CBC/CFB/OFB 支持多分组 IV 反馈寄存器。
 *   - CTR：Magma 用 4 字节 nonce + 32 位低半计数器；1989 变体用 RFC 5830 计数器模式。
 *   - padding：ECB/CBC 用统一填充（默认 none）；keyMeshing：NO/CP（RFC 4357 §2.3.2）。
 *   - sbox：paramZ 为 2015 Magma；1989 选项同时切换小端字序。
 *
 * 约定：
 *   - encode: 明文 hex → 密文 hex（加密）；decode: 密文 hex → 明文 hex（解密）。
 *   - 默认 ECB + NoPadding 保持旧输出；CBC 默认不自动填充。
 *
 * 红线：算法照 GOST R 34.12-2015 实现，不编造；建表后自校验 t(fdb97531)=2a196f34；
 *   交付前过官方向量。纯本地零外发；core 层零 UI 依赖（仅 registry）。
 *
 * 契约：register({ id:"magma", cat:"modern", name, desc, params, encode, decode })。
 */
import { register } from "./registry.js";
import { PADDING_OPTIONS } from "./modern.js";
import {
  gostModeCrypt, gost89KeySchedule, gost89EncryptBlock, gost89DecryptBlock,
  normGost89Sbox,
} from "./gostModes.js";

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
function keyScheduleBytes(keyBytes) {
  if (!keyBytes || keyBytes.length !== 32) throw new Error("Magma 密钥须为 256 位（32 字节 / 64 hex 字符）");
  const K = [];
  for (let i = 0; i < 8; i++) {
    const o = i * 4;
    K.push(((keyBytes[o] << 24) | (keyBytes[o + 1] << 16) | (keyBytes[o + 2] << 8) | keyBytes[o + 3]) >>> 0);
  }
  // 轮 1-24：K1..K8 重复 3 遍；轮 25-32：K8..K1
  const rk = [];
  for (let r = 0; r < 24; r++) rk.push(K[r % 8]);
  for (let r = 0; r < 8; r++) rk.push(K[7 - r]);
  return rk;
}

function keySchedule(keyHex) {
  const clean = String(keyHex).replace(/[^0-9a-fA-F]/g, "");
  if (clean.length !== 64) throw new Error("Magma 密钥须为 256 位（64 hex 字符）");
  return keyScheduleBytes(hexToBytes(clean));
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

// hex（整字节）→ Uint8Array
function hexToBytes(hex) {
  const clean = String(hex).replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error("非法 hex 字符（仅允许 0-9/A-F 与空白）");
  if (clean.length % 2 !== 0) throw new Error("hex 串长度须为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function magmaEncryptBlock(blk, rk) {
  const [hi, lo] = crypt64(
    ((blk[0] << 24) | (blk[1] << 16) | (blk[2] << 8) | blk[3]) >>> 0,
    ((blk[4] << 24) | (blk[5] << 16) | (blk[6] << 8) | blk[7]) >>> 0,
    rk, false);
  const out = new Uint8Array(8);
  out[0] = (hi >>> 24) & 0xff; out[1] = (hi >>> 16) & 0xff; out[2] = (hi >>> 8) & 0xff; out[3] = hi & 0xff;
  out[4] = (lo >>> 24) & 0xff; out[5] = (lo >>> 16) & 0xff; out[6] = (lo >>> 8) & 0xff; out[7] = lo & 0xff;
  return out;
}
function magmaDecryptBlock(blk, rk) {
  const [hi, lo] = crypt64(
    ((blk[0] << 24) | (blk[1] << 16) | (blk[2] << 8) | blk[3]) >>> 0,
    ((blk[4] << 24) | (blk[5] << 16) | (blk[6] << 8) | blk[7]) >>> 0,
    rk, true);
  const out = new Uint8Array(8);
  out[0] = (hi >>> 24) & 0xff; out[1] = (hi >>> 16) & 0xff; out[2] = (hi >>> 8) & 0xff; out[3] = hi & 0xff;
  out[4] = (lo >>> 24) & 0xff; out[5] = (lo >>> 16) & 0xff; out[6] = (lo >>> 8) & 0xff; out[7] = lo & 0xff;
  return out;
}

// 1989 S 盒选项 → gostModes 表名
const MAGMA_SBOX_MAP = {
  paramZ: null,
  test1989: "test",
  cryptoPro1989: "cryptopro",
  "E-A": "E-A",
  "E-SC": "E-SC",
};

const MAGMA_MODES = new Set(["ECB", "CBC", "CFB", "OFB", "CTR"]);

function magmaCrypt(text, p, decrypt) {
  const keyHex = String((p && p.key) || "");
  const keyBytes = hexToBytes(keyHex);
  if (keyBytes.length !== 32) throw new Error("Magma 密钥须为 256 位（32 字节 / 64 hex 字符）");
  const mode = String((p && p.mode) || "ECB").toUpperCase();
  if (!MAGMA_MODES.has(mode)) throw new Error(`Magma 不支持模式: ${mode}`);
  const sboxName = String((p && p.sbox) || "paramZ");
  if (!(sboxName in MAGMA_SBOX_MAP)) throw new Error(`未知的 Magma S 盒选项: ${sboxName}`);
  const is1989 = MAGMA_SBOX_MAP[sboxName] != null;

  let makeSchedule, encryptBlock, decryptBlock;
  if (is1989) {
    const sbox = normGost89Sbox(MAGMA_SBOX_MAP[sboxName]);
    makeSchedule = (kb) => gost89KeySchedule(kb);
    encryptBlock = (blk, sch) => gost89EncryptBlock(blk, sch, sbox);
    decryptBlock = (blk, sch) => gost89DecryptBlock(blk, sch, sbox);
  } else {
    makeSchedule = (kb) => keyScheduleBytes(kb);
    encryptBlock = (blk, sch) => magmaEncryptBlock(blk, sch);
    decryptBlock = (blk, sch) => magmaDecryptBlock(blk, sch);
  }

  const ivHex = String((p && p.iv) || "").replace(/[^0-9a-fA-F]/g, "");
  const iv = ivHex ? hexToBytes(ivHex) : undefined;
  const data = hexToBytes(String(text || ""));
  const out = gostModeCrypt({
    mode, decrypt, data, blockSize: 8, iv,
    padding: (p && p.padding) || "none",
    keyMeshing: (p && p.keyMeshing) || "NO",
    keyBytes, makeSchedule, encryptBlock, decryptBlock,
    gamma89: is1989 && mode === "CTR",
  });
  return bytesToHex(out);
}

function magmaEncode(text, p) { return magmaCrypt(text, p, false); }
function magmaDecode(text, p) { return magmaCrypt(text, p, true); }

register({
  id: "magma",
  cat: "block",
  name: "Magma（GOST R 34.12-2015）",
  desc: "俄罗斯联邦标准 Magma 分组密码（GOST R 34.12-2015；1989 变体 GOST 28147-89）：64 位分组 / 256 位密钥 / 32 轮 Feistel。S 盒默认 id-tc26-gost-28147-param-Z；可选 1989 TestParamSet / CryptoProParamSet / E-A / E-SC（同时切换小端字序）。模式按 GOST R 34.13-2015：CTR 半块 nonce + 低半计数器，CBC/CFB/OFB 支持多分组反馈寄存器；1989 的 CTR 为 RFC 5830 计数器模式。keyMeshing CP 按 RFC 4357 §2.3.2 每 1024 字节更新密钥。ECB/CBC 支持统一填充（默认 NoPadding，保持旧输出）。明文/密文/密钥均 hex。encode 加密 / decode 解密。",
  params: [
    { key: "key", label: "密钥 (hex, 256 位 / 64 字符)", type: "text", default: "ffeeddccbbaa99887766554433221100f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff", placeholder: "64 hex 字符" },
    { key: "mode", label: "模式", type: "select", default: "ECB",
      options: ["ECB", "CBC", "CFB", "OFB", "CTR"].map((m) => ({ value: m, label: m })) },
    { key: "iv", label: "IV (hex)", type: "text", default: "", placeholder: "CBC/CFB/OFB 为 8 字节整数倍；CTR 4 字节（或 8 字节取前 4）；1989 CTR 8 字节" },
    { key: "padding", label: "填充（ECB/CBC 用；流模式忽略）", type: "select", default: "none", options: PADDING_OPTIONS },
    { key: "sbox", label: "S 盒 / 算法变体", type: "select", default: "paramZ",
      options: [
        { value: "paramZ", label: "param-Z（2015 Magma，默认）" },
        { value: "test1989", label: "1989 TestParamSet（切换小端字序）" },
        { value: "cryptoPro1989", label: "1989 CryptoProParamSet（切换小端字序）" },
        { value: "E-A", label: "1989 CryptoPro-A（E-A，切换小端字序）" },
        { value: "E-SC", label: "1989 SignalCom（E-SC，切换小端字序）" },
      ] },
    { key: "keyMeshing", label: "密钥更新（key meshing）", type: "select", default: "NO",
      options: [
        { value: "NO", label: "NO（不更新，默认）" },
        { value: "CP", label: "CP（CryptoPro，每 1024 字节；ECB 忽略）" },
      ] },
  ],
  encode: magmaEncode,
  decode: magmaDecode,
});

export {
  magmaEncode, magmaDecode, tTransform, g, keySchedule, keyScheduleBytes,
  magmaEncryptBlock, magmaDecryptBlock,
};
