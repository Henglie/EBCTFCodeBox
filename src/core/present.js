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
import { PADDING_OPTIONS, ecbEncrypt, ecbDecrypt, cbcEncrypt, cbcDecrypt } from "./modern.js";

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
function cleanHex(s) {
  const clean = String(s || "").replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error("非法 hex 字符（仅允许 0-9/A-F 与空白）");
  return clean;
}
function hexToBig(h) { return h === "" ? 0n : BigInt("0x" + h); }
function bigToHex(v, bytes) { return v.toString(16).padStart(bytes * 2, "0"); }
function bigToBytes(v, bytes = 8) {
  const out = new Uint8Array(bytes);
  let x = v;
  for (let i = bytes - 1; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}

function presentRun(text, p, dir) {
  const keyBits = (p && p.keyBits === "128") ? 128 : 80;
  const keyHex = cleanHex(p && p.key);
  const wantKeyHex = keyBits / 4;
  if (keyHex.length !== wantKeyHex) {
    throw new Error(`PRESENT-${keyBits} 密钥须为 ${wantKeyHex} 个 hex 字符（${keyBits / 8} 字节）`);
  }
  const rk = keySchedule(hexToBig(keyHex), keyBits);
  const mode = String((p && p.mode) || "ECB").toUpperCase();
  if (mode !== "ECB" && mode !== "CBC") throw new Error(`PRESENT 不支持模式: ${mode}（仅 ECB/CBC）`);
  const padding = (p && p.padding) || "none";
  const rawText = String(text == null ? "" : text);
  if (/[^0-9a-fA-F\s]/.test(rawText)) throw new Error("PRESENT：数据含非十六进制字符（仅允许 0-9a-fA-F）");
  const dataHex = cleanHex(rawText);
  if (dataHex.length % 2 !== 0) throw new Error("PRESENT：hex 串长度须为偶数（整字节）");
  const data = new Uint8Array(dataHex.length / 2);
  for (let i = 0; i < data.length; i++) data[i] = parseInt(dataHex.substr(i * 2, 2), 16);

  const encBlock = (blk) => {
    let v = 0n;
    for (const b of blk) v = (v << 8n) | BigInt(b);
    return bigToBytes(encryptBlock(v, rk));
  };
  const decBlock = (blk) => {
    let v = 0n;
    for (const b of blk) v = (v << 8n) | BigInt(b);
    return bigToBytes(decryptBlock(v, rk));
  };

  let out;
  if (mode === "ECB") {
    out = dir === "enc" ? ecbEncrypt(data, encBlock, 8, padding) : ecbDecrypt(data, decBlock, 8, padding);
  } else {
    const ivHex = cleanHex(p && p.iv);
    if (ivHex.length !== 16) throw new Error("PRESENT-CBC 需提供 8 字节 IV（16 hex 字符）");
    if (padding === "none" && data.length % 8 !== 0) {
      throw new Error("NoPadding 要求数据长度为 8 字节整数倍");
    }
    const iv = new Uint8Array(8);
    for (let i = 0; i < 8; i++) iv[i] = parseInt(ivHex.substr(i * 2, 2), 16);
    out = dir === "enc" ? cbcEncrypt(data, encBlock, 8, iv, padding) : cbcDecrypt(data, decBlock, 8, iv, padding);
  }
  let hex = "";
  for (const b of out) hex += b.toString(16).padStart(2, "0");
  return hex;
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
  cat: "block",
  name: "PRESENT 轻量分组密码",
  desc: "PRESENT 轻量级分组密码（Bogdanov 2007 / ISO/IEC 29192-2）：64 位分组，80/128 位密钥，31 轮 SPN（4-bit S 盒 + 比特置换）。明文/密文/密钥均 hex；支持 ECB/CBC 与 PKCS#7/NoPadding/Zero/Bit/ISO10126/ANSI X9.23（默认 NoPadding，保持旧输出）。encode 加密 / decode 解密。已过官方全零测试向量。",
  params: [
    {
      key: "keyBits", label: "密钥长度", type: "select", default: "80",
      options: [
        { value: "80", label: "PRESENT-80（80 位）" },
        { value: "128", label: "PRESENT-128（128 位）" },
      ],
    },
    { key: "key", label: "密钥 (hex)", type: "text", default: "00000000000000000000", placeholder: "PRESENT-80: 20 hex / PRESENT-128: 32 hex" },
    { key: "mode", label: "模式", type: "select", default: "ECB",
      options: [{ value: "ECB", label: "ECB" }, { value: "CBC", label: "CBC" }] },
    { key: "iv", label: "IV (hex)", type: "text", default: "", placeholder: "CBC 需 8 字节（16 hex）" },
    { key: "padding", label: "填充（ECB/CBC 用）", type: "select", default: "none", options: PADDING_OPTIONS },
  ],
  encode: (text, p) => presentRun(text, p, "enc"),
  decode: (text, p) => presentRun(text, p, "dec"),
});

export { encryptBlock, decryptBlock, keySchedule, sBoxLayer, pLayer };
