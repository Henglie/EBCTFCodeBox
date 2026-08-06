/*
 * hc256.js — HC-256 流密码（eSTREAM 决赛，cat:'modern'，encode/decode）。
 *
 * 算法照 Wu Hongjun FSE 2004 + Bilibili 公开参考代码逐行实现。
 *
 * 结构：
 *   - 256 位 key + 256 位 IV → W[0..2559] 扩展 → P/Q 各 1024×32bit 表
 *   - warm-up 4096 步（与正常步同公式），idx 重置为 0
 *   - 更新公式：P[j] += P[j-10] + G1(P[j-3], P[j+1], Q)
 *   - G1/G2 有 Q/P 表查找项（与 HC-128 不同）
 *   - H 函数用 4 字节索引 4 个 256 项分区（与 HC-128 的 2 字节不同）
 *
 * 自反流密码：密文 = 明文 ⊕ 密钥流。encode 文本→hex，decode hex→文本。
 *
 * 红线：照参考实现逐行，不编造；纯本地零外发；core 层零 UI 依赖（仅 registry）。
 * 自检：Crypto++ TestVectors/hc256.txt 官方向量（key=IV=0，3 组向量）。
 *
 * 契约：register({ id:"hc256", cat:"modern", name, desc, params, encode, decode })。
 */
import { register } from "./registry.js";

// ---- 32 位运算工具 ----
function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }
function f1(x) { return (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0; }
function f2(x) { return (rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10)) >>> 0; }

// ---- H 函数：用 x 的 4 字节索引表 4 个 256 项分区 ----
function h1(x, Q) {
  return (Q[x & 0xFF] + Q[256 + ((x >>> 8) & 0xFF)] + Q[512 + ((x >>> 16) & 0xFF)] + Q[768 + ((x >>> 24) & 0xFF)]) >>> 0;
}
function h2(x, P) {
  return (P[x & 0xFF] + P[256 + ((x >>> 8) & 0xFF)] + P[512 + ((x >>> 16) & 0xFF)] + P[768 + ((x >>> 24) & 0xFF)]) >>> 0;
}

// ---- G 函数：含表查找项（HC-128 没有此项） ----
function g1(x, y, Q) { return ((rotr(x, 10) ^ rotr(y, 23)) + Q[(x ^ y) & 0x3FF]) >>> 0; }
function g2(x, y, P) { return ((rotr(x, 10) ^ rotr(y, 23)) + P[(x ^ y) & 0x3FF]) >>> 0; }

// ---- 初始化 ----
function hc256Init(keyBytes, ivBytes) {
  // 装载 key 和 IV 到 W[0..15]（小端 32 位字）
  const W = new Uint32Array(2560);
  for (let i = 0; i < 8; i++) {
    W[i] = (keyBytes[i*4] | (keyBytes[i*4+1] << 8) | (keyBytes[i*4+2] << 16) | (keyBytes[i*4+3] << 24)) >>> 0;
    W[i + 8] = (ivBytes[i*4] | (ivBytes[i*4+1] << 8) | (ivBytes[i*4+2] << 16) | (ivBytes[i*4+3] << 24)) >>> 0;
  }
  // 扩展 W[16..2559]
  for (let i = 16; i < 2560; i++) {
    W[i] = (f2(W[i - 2]) + W[i - 7] + f1(W[i - 15]) + W[i - 16] + i) >>> 0;
  }
  // 拆分到 P 和 Q
  const P = W.subarray(512, 1536);   // P[0..1023] = W[512..1535]
  const Q = W.subarray(1536, 2560);  // Q[0..1023] = W[1536..2559]

  // warm-up 4096 步（与正常步同公式）
  const state = { P, Q, idx: 0 };
  for (let i = 0; i < 4096; i++) {
    hc256Generate(state);
  }
  // warm-up 后 idx 重置（4096 & 0x7ff = 0）
  state.idx = 0;
  return state;
}

// ---- 正常步：生成 1 个 32 位字 ----
function hc256Generate(state) {
  const { P, Q } = state;
  const idx = state.idx;
  const j = idx & 0x3FF;  // mod 1024
  let res;
  if ((idx & 0x7FF) < 1024) {  // mod 2048 < 1024 -> 处理 P
    P[j] = (P[j] + P[(j - 10) & 0x3FF] + g1(P[(j - 3) & 0x3FF], P[(j - 1023) & 0x3FF], Q)) >>> 0;
    res = (h1(P[(j - 12) & 0x3FF], Q) ^ P[j]) >>> 0;
  } else {
    Q[j] = (Q[j] + Q[(j - 10) & 0x3FF] + g2(Q[(j - 3) & 0x3FF], Q[(j - 1023) & 0x3FF], P)) >>> 0;
    res = (h2(Q[(j - 12) & 0x3FF], P) ^ Q[j]) >>> 0;
  }
  state.idx = (idx + 1) & 0x7FF;  // mod 2048，循环
  return res >>> 0;
}

// ---- 生成密钥流字节 ----
function hc256Keystream(keyBytes, ivBytes, numBytes) {
  const state = hc256Init(keyBytes, ivBytes);
  const out = new Uint8Array(numBytes);
  let buf = 0, used = 4;
  for (let i = 0; i < numBytes; i++) {
    if (used >= 4) {
      buf = hc256Generate(state);
      used = 0;
    }
    out[i] = (buf >>> (used * 8)) & 0xFF;  // 小端
    used++;
  }
  return out;
}

// ---- hex/字节 工具 ----
function cleanHex(s) { return String(s || "").replace(/[^0-9a-fA-F]/g, ""); }
function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += (b & 0xff).toString(16).padStart(2, "0");
  return s;
}

function parseHex256(s, name) {
  const raw = cleanHex(s);
  if (raw.length !== 64) throw new Error(`${name}必须为 256 位（64 个 hex 字符 / 32 字节）`);
  return hexToBytes(raw);
}

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

function hc256Encode(text, p = {}) {
  const key = parseHex256(p && p.key, "密钥");
  const iv = parseHex256(p && p.iv, "IV");
  const data = te(text);
  const ks = hc256Keystream(key, iv, data.length);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ks[i];
  return bytesToHex(out);
}

function hc256Decode(text, p = {}) {
  const key = parseHex256(p && p.key, "密钥");
  const iv = parseHex256(p && p.iv, "IV");
  const cleanText = cleanHex(text);
  if (cleanText.length % 2 !== 0) throw new Error("密文 hex 长度必须为偶数");
  const data = hexToBytes(cleanText);
  const ks = hc256Keystream(key, iv, data.length);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ks[i];
  return td(out);
}

// ---- 载入自校验：Crypto++ TestVectors/hc256.txt 官方向量 ----
(() => {
  // 向量 1: key=IV=0, 明文全 0（密文=keystream），32 字节
  const ks1 = bytesToHex(hc256Keystream(new Uint8Array(32), new Uint8Array(32), 32));
  const expect1 = "5b078985d8f6f30d42c5c02fa6b6795153f06534801f89f24e74248b720b4818";
  if (ks1 !== expect1) {
    throw new Error(`HC-256 自检失败（key=IV=0）：期望 ${expect1}，实际 ${ks1}`);
  }
  // 向量 2: key=0, IV=01..0
  const iv2 = new Uint8Array(32); iv2[0] = 0x01;
  const ks2 = bytesToHex(hc256Keystream(new Uint8Array(32), iv2, 32));
  const expect2 = "afe2a2bf4f17cee9fec2058bd1b18bb15fc042ee712b3101dd501fc60b082a50";
  if (ks2 !== expect2) {
    throw new Error(`HC-256 自检失败（key=0,IV=01）：期望 ${expect2}，实际 ${ks2}`);
  }
  // 向量 3: key=55..0, IV=0
  const key3 = new Uint8Array(32); key3[0] = 0x55;
  const ks3 = bytesToHex(hc256Keystream(key3, new Uint8Array(32), 32));
  const expect3 = "1c404afe4fe25fed958f9ad1ae36c06f88a65a3cc0abe223aeb3902f420ed3a8";
  if (ks3 !== expect3) {
    throw new Error(`HC-256 自检失败（key=55,IV=0）：期望 ${expect3}，实际 ${ks3}`);
  }
})();

register({
  id: "hc256",
  cat: "modern",
  name: "HC-256 流密码",
  desc: "HC-256 流密码（Wu Hongjun FSE 2004，eSTREAM 决赛）：P/Q 各 1024×32bit 表 + f1/f2（SHA-256 σ）+ G1/G2（含表查找）+ h1/h2（4 字节索引）。256 位 key + 256 位 IV。自反 XOR：encode 文本→密文 hex，decode 密文 hex→文本。已过 Crypto++ 官方向量（3 组：key=IV=0 / IV=01 / key=55）。",
  params: [
    { key: "key", type: "text", label: "密钥 (hex, 256 位)", default: "0000000000000000000000000000000000000000000000000000000000000000", placeholder: "64 个 hex 字符" },
    { key: "iv", type: "text", label: "IV (hex, 256 位)", default: "0000000000000000000000000000000000000000000000000000000000000000", placeholder: "64 个 hex 字符" },
  ],
  encode: hc256Encode,
  decode: hc256Decode,
});

export { hc256Encode, hc256Decode, hc256Keystream, hc256Init, hc256Generate };
