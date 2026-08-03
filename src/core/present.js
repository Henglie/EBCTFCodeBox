/*
 * present.js — PRESENT 轻量级分组密码（cat:'modern'，encode/decode）。
 *
 * 算法照 PRESENT 规范（Bogdanov et al. 2007, CHES；ISO/IEC 29192-2 轻量密码标准）：
 *   分组 64 位，密钥 80 位（PRESENT-80）或 128 位（PRESENT-128），31 轮 SPN。
 *   每轮：addRoundKey（异或轮密钥）→ sBoxLayer（16 个 4-bit S 盒）→ pLayer（比特置换）。
 *   末轮后再异或第 32 个轮密钥。
 *
 * S 盒（4-bit）：C 5 6 B 9 0 A D 3 E F 8 4 7 1 2
 * pLayer：P(i) = (16·i) mod 63（i=0..62），P(63)=63。
 * 密钥编排（PRESENT-80）：K 为 80 位寄存器，轮密钥 = 高 64 位；
 *   随后 K 循环左移 61 位 → 高 4 位过 S 盒 → 位 [19:15] 异或轮计数。
 * PRESENT-128：K 为 128 位，轮密钥 = 高 64 位；循环左移 61 → 高两个 4-bit 过 S 盒
 *   → 位 [66:62] 异或轮计数。
 *
 * 红线：算法照规范实现，不编造；纯本地 BigInt 计算；core 层零 UI 依赖（仅 registry）。
 *   载入时自校验官方全零向量（PRESENT-80: key=0,pt=0 → 5579C1387B228445）。
 *
 * 契约：register({ id:"present", cat:"modern", name, desc, params, encode, decode })。
 *   明文/密文/密钥均 hex；ECB 多块；encode 加密 / decode 解密。
 */
import { register } from "./registry.js";

const SBOX = [0xC, 0x5, 0x6, 0xB, 0x9, 0x0, 0xA, 0xD, 0x3, 0xE, 0xF, 0x8, 0x4, 0x7, 0x1, 0x2];
const SBOX_INV = (() => { const inv = new Array(16); for (let i = 0; i < 16; i++) inv[SBOX[i]] = i; return inv; })();

// pLayer 置换表：P[i] = 目标位置（i=0..63），P(i)=(16i)mod63, P(63)=63
const PPERM = (() => {
  const p = new Array(64);
  for (let i = 0; i < 63; i++) p[i] = (16 * i) % 63;
  p[63] = 63;
  return p;
})();
const PPERM_INV = (() => { const inv = new Array(64); for (let i = 0; i < 64; i++) inv[PPERM[i]] = i; return inv; })();

const MASK64 = (1n << 64n) - 1n;

function sBoxLayer(state) {
  let out = 0n;
  for (let i = 0; i < 16; i++) {
    const nib = Number((state >> BigInt(4 * i)) & 0xfn);
    out |= BigInt(SBOX[nib]) << BigInt(4 * i);
  }
  return out;
}
function sBoxLayerInv(state) {
  let out = 0n;
  for (let i = 0; i < 16; i++) {
    const nib = Number((state >> BigInt(4 * i)) & 0xfn);
    out |= BigInt(SBOX_INV[nib]) << BigInt(4 * i);
  }
  return out;
}
function pLayer(state) {
  let out = 0n;
  for (let i = 0; i < 64; i++) {
    if ((state >> BigInt(i)) & 1n) out |= 1n << BigInt(PPERM[i]);
  }
  return out;
}
function pLayerInv(state) {
  let out = 0n;
  for (let i = 0; i < 64; i++) {
    if ((state >> BigInt(i)) & 1n) out |= 1n << BigInt(PPERM_INV[i]);
  }
  return out;
}

// 密钥编排：返回 32 个 64 位轮密钥（BigInt）
function keySchedule(keyBig, keyBits) {
  const rounds = 32;
  const rk = [];
  const KMASK = (1n << BigInt(keyBits)) - 1n;
  let K = keyBig & KMASK;
  for (let r = 1; r <= rounds; r++) {
    // 轮密钥 = 高 64 位
    rk.push((K >> BigInt(keyBits - 64)) & MASK64);
    if (r === rounds) break;
    // 循环左移 61 位
    K = ((K << 61n) | (K >> BigInt(keyBits - 61))) & KMASK;
    if (keyBits === 80) {
      // 高 4 位过 S 盒（位 79..76）
      const top = Number((K >> 76n) & 0xfn);
      K = (K & ~(0xfn << 76n)) | (BigInt(SBOX[top]) << 76n);
      // 位 [19:15] 异或轮计数 r
      K ^= BigInt(r) << 15n;
    } else { // 128
      // 高两个 4-bit 过 S 盒（位 127..120）
      const t1 = Number((K >> 124n) & 0xfn);
      const t0 = Number((K >> 120n) & 0xfn);
      K = (K & ~(0xffn << 120n)) | (BigInt(SBOX[t1]) << 124n) | (BigInt(SBOX[t0]) << 120n);
      // 位 [66:62] 异或轮计数 r
      K ^= BigInt(r) << 62n;
    }
    K &= KMASK;
  }
  return rk;
}

function encryptBlock(pt, rk) {
  let state = pt & MASK64;
  for (let i = 0; i < 31; i++) {
    state ^= rk[i];
    state = sBoxLayer(state);
    state = pLayer(state);
  }
  state ^= rk[31];
  return state & MASK64;
}
function decryptBlock(ct, rk) {
  let state = ct & MASK64;
  state ^= rk[31];
  for (let i = 30; i >= 0; i--) {
    state = pLayerInv(state);
    state = sBoxLayerInv(state);
    state ^= rk[i];
  }
  return state & MASK64;
}

// ---- hex/BigInt 工具 ----
function cleanHex(s) { return String(s || "").replace(/[^0-9a-fA-F]/g, ""); }
function hexToBig(h) { return h === "" ? 0n : BigInt("0x" + h); }
function bigToHex(v, bytes) { return v.toString(16).padStart(bytes * 2, "0"); }

function presentRun(text, p, dir) {
  const keyBits = (p && p.keyBits === "128") ? 128 : 80;
  const keyHex = cleanHex(p && p.key);
  const wantKeyHex = keyBits / 4;
  if (keyHex.length !== wantKeyHex) {
    throw new Error(`PRESENT-${keyBits} 密钥须为 ${wantKeyHex} 个 hex 字符（${keyBits / 8} 字节）`);
  }
  const rk = keySchedule(hexToBig(keyHex), keyBits);
  const dataHex = cleanHex(text);
  if (dataHex.length % 16 !== 0) throw new Error("数据须为 8 字节（16 hex）的整数倍（ECB 分组）");
  let out = "";
  for (let i = 0; i < dataHex.length; i += 16) {
    const block = hexToBig(dataHex.slice(i, i + 16));
    const res = dir === "enc" ? encryptBlock(block, rk) : decryptBlock(block, rk);
    out += bigToHex(res, 8);
  }
  return out;
}

// 载入自校验：官方向量 PRESENT-80 key=0, pt=0 → 5579c1387b228445
(() => {
  const rk = keySchedule(0n, 80);
  const c = encryptBlock(0n, rk);
  if (bigToHex(c, 8) !== "5579c1387b228445") {
    throw new Error("PRESENT 自检失败（PRESENT-80 全零向量≠5579c1387b228445）");
  }
})();

register({
  id: "present",
  cat: "modern",
  name: "PRESENT 轻量分组密码",
  desc: "PRESENT 轻量级分组密码（Bogdanov 2007 / ISO/IEC 29192-2）：64 位分组，80/128 位密钥，31 轮 SPN（4-bit S 盒 + 比特置换）。明文/密文/密钥均 hex，ECB 多块。encode 加密 / decode 解密。已过官方全零测试向量。",
  params: [
    {
      key: "keyBits", label: "密钥长度", type: "select", default: "80",
      options: [
        { value: "80", label: "PRESENT-80（80 位）" },
        { value: "128", label: "PRESENT-128（128 位）" },
      ],
    },
    { key: "key", label: "密钥 (hex)", type: "text", default: "00000000000000000000", placeholder: "PRESENT-80: 20 hex / PRESENT-128: 32 hex" },
  ],
  encode: (text, p) => presentRun(text, p, "enc"),
  decode: (text, p) => presentRun(text, p, "dec"),
});

export { encryptBlock, decryptBlock, keySchedule, sBoxLayer, pLayer };
