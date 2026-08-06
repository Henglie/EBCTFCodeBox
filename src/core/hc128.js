/*
 * hc128.js — HC-128 流密码（eSTREAM 决赛，cat:'modern'，encode/decode）。
 *
 * 算法照 Wu Hongjun FSE 2004 + Crypto++ hc128.cpp 逐行实现。
 *
 * 结构：
 *   - 128 位 key + 128 位 IV → 两步 W 扩展 → P/Q 各 512×32bit 表
 *   - warm-up 1024 步（update_P/update_Q：加法后 XOR tem3）
 *   - 正常步（step_P/step_Q：仅加法，XOR 只用于输出）
 *   - P 表用 rotr，Q 表用 rotl（照 Crypto++ step_Q 的 32-n 参数）
 *   - 偏移：tem0=T[j+1], tem1=T[j-3], tem2=T[j-10], tem3=h(T[j-12])
 *
 * 自反流密码：密文 = 明文 ⊕ 密钥流。encode 文本→hex，decode hex→文本。
 *
 * 红线：照 Crypto++ 参考实现逐行，不编造；纯本地零外发；core 层零 UI 依赖（仅 registry）。
 * 自检：Crypto++ TestVectors/hc128.txt 官方向量（key=IV=0，512B 明文全 0）。
 *
 * 契约：register({ id:"hc128", cat:"modern", name, desc, params, encode, decode })。
 */
import { register } from "./registry.js";

// ---- 32 位运算工具 ----
function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }
function rotl(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }
function f1(x) { return (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0; }
function f2(x) { return (rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10)) >>> 0; }

// ---- H 函数：用 x 的 byte0 和 byte2 索引表两个 256 项分区 ----
function h1(x, Q) { return (Q[x & 0xFF] + Q[256 + ((x >>> 16) & 0xFF)]) >>> 0; }
function h2(x, P) { return (P[x & 0xFF] + P[256 + ((x >>> 16) & 0xFF)]) >>> 0; }

// ---- 初始化：照 Crypto++ CipherResynchronize ----
function hc128Init(keyBytes, ivBytes) {
  // key/iv 各 4 个 32 位字（小端），复制为 8 字
  const key = [0, 0, 0, 0];
  const iv = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    key[i] = (keyBytes[i*4] | (keyBytes[i*4+1] << 8) | (keyBytes[i*4+2] << 16) | (keyBytes[i*4+3] << 24)) >>> 0;
    iv[i] = (ivBytes[i*4] | (ivBytes[i*4+1] << 8) | (ivBytes[i*4+2] << 16) | (ivBytes[i*4+3] << 24)) >>> 0;
  }
  // key[4..7] = key[0..3], iv[4..7] = iv[0..3]
  const K = [...key, ...key];
  const V = [...iv, ...iv];

  // T 数组 1024 项（前 512 = P，后 512 = Q）
  const T = new Uint32Array(1024);
  // T[0..7] = key, T[8..15] = iv
  for (let i = 0; i < 8; i++) T[i] = K[i];
  for (let i = 0; i < 8; i++) T[8 + i] = V[i];

  // 扩展 T[16..271]
  for (let i = 16; i < 272; i++) {
    T[i] = (f2(T[i - 2]) + T[i - 7] + f1(T[i - 15]) + T[i - 16] + i) >>> 0;
  }
  // 复制 T[256..271] → T[0..15]
  for (let i = 0; i < 16; i++) T[i] = T[256 + i];
  // 扩展 T[16..1023]
  for (let i = 16; i < 1024; i++) {
    T[i] = (f2(T[i - 2]) + T[i - 7] + f1(T[i - 15]) + T[i - 16] + 256 + i) >>> 0;
  }

  // 拆分 P 和 Q
  const P = T.subarray(0, 512);
  const Q = T.subarray(512, 1024);

  // warm-up 1024 步（update_P/update_Q）
  for (let idx = 0; idx < 1024; idx++) {
    hc128Update(P, Q, idx);
  }
  // warm-up 后 idx 重置为 0（1024 & 0x3ff = 0）
  return { P, Q, idx: 0 };
}

// ---- warm-up 步：T[u] = (T[u]+tem2+(tem0^tem1)) ^ tem3 ----
function hc128Update(P, Q, idx) {
  if (idx < 512) {
    const j = idx & 0x1FF;
    const tem0 = rotr(P[(j + 1) & 0x1FF], 23);
    const tem1 = rotr(P[(j - 3) & 0x1FF], 10);
    const tem2 = rotr(P[(j - 10) & 0x1FF], 8);
    const tem3 = h1(P[(j - 12) & 0x1FF], Q);
    P[j] = ((P[j] + tem2 + (tem0 ^ tem1)) ^ tem3) >>> 0;
  } else {
    const j = (idx - 512) & 0x1FF;
    const tem0 = rotl(Q[(j + 1) & 0x1FF], 23);
    const tem1 = rotl(Q[(j - 3) & 0x1FF], 10);
    const tem2 = rotl(Q[(j - 10) & 0x1FF], 8);
    const tem3 = h2(Q[(j - 12) & 0x1FF], P);
    Q[j] = ((Q[j] + tem2 + (tem0 ^ tem1)) ^ tem3) >>> 0;
  }
}

// ---- 正常步：T[u] += tem2+(tem0^tem1); output = tem3 ^ T[u] ----
function hc128Generate(state) {
  const { P, Q } = state;
  let idx = state.idx;
  let res;
  if (idx < 512) {
    const j = idx & 0x1FF;
    const tem0 = rotr(P[(j + 1) & 0x1FF], 23);
    const tem1 = rotr(P[(j - 3) & 0x1FF], 10);
    const tem2 = rotr(P[(j - 10) & 0x1FF], 8);
    P[j] = (P[j] + tem2 + (tem0 ^ tem1)) >>> 0;
    res = (h1(P[(j - 12) & 0x1FF], Q) ^ P[j]) >>> 0;
  } else {
    const j = (idx - 512) & 0x1FF;
    const tem0 = rotl(Q[(j + 1) & 0x1FF], 23);
    const tem1 = rotl(Q[(j - 3) & 0x1FF], 10);
    const tem2 = rotl(Q[(j - 10) & 0x1FF], 8);
    Q[j] = (Q[j] + tem2 + (tem0 ^ tem1)) >>> 0;
    res = (h2(Q[(j - 12) & 0x1FF], P) ^ Q[j]) >>> 0;
  }
  state.idx = (idx + 1) & 0x3FF;  // mod 1024，循环
  return res >>> 0;
}

// ---- 生成密钥流字节 ----
function hc128Keystream(keyBytes, ivBytes, numBytes) {
  const state = hc128Init(keyBytes, ivBytes);
  const out = new Uint8Array(numBytes);
  let buf = 0, used = 4;
  for (let i = 0; i < numBytes; i++) {
    if (used >= 4) {
      buf = hc128Generate(state);
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

function parseHex128(s, name) {
  const raw = cleanHex(s);
  if (raw.length !== 32) throw new Error(`${name}必须为 128 位（32 个 hex 字符 / 16 字节）`);
  return hexToBytes(raw);
}

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

function hc128Encode(text, p = {}) {
  const key = parseHex128(p && p.key, "密钥");
  const iv = parseHex128(p && p.iv, "IV");
  const data = te(text);
  const ks = hc128Keystream(key, iv, data.length);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ks[i];
  return bytesToHex(out);
}

function hc128Decode(text, p = {}) {
  const key = parseHex128(p && p.key, "密钥");
  const iv = parseHex128(p && p.iv, "IV");
  const cleanText = cleanHex(text);
  if (cleanText.length % 2 !== 0) throw new Error("密文 hex 长度必须为偶数");
  const dataBytes = hexToBytes(cleanText);
  const ks = hc128Keystream(key, iv, dataBytes.length);
  const out = new Uint8Array(dataBytes.length);
  for (let i = 0; i < dataBytes.length; i++) out[i] = dataBytes[i] ^ ks[i];
  return td(out);
}

// ---- 载入自校验：Crypto++ TestVectors/hc128.txt 官方向量 ----
(() => {
  // key=IV=0, 明文全 0（密文=keystream），前 32 字节
  const ks = bytesToHex(hc128Keystream(new Uint8Array(16), new Uint8Array(16), 32));
  const expect = "82001573a003fd3b7fd72ffb0eaf63aac62f12deb629dca72785a66268ec758b";
  if (ks !== expect) {
    throw new Error(`HC-128 自检失败（key=IV=0）：期望 ${expect}，实际 ${ks}`);
  }
  // key=80..0, IV=0, 前 32 字节
  const key2 = new Uint8Array(16); key2[0] = 0x80;
  const ks2 = bytesToHex(hc128Keystream(key2, new Uint8Array(16), 32));
  const expect2 = "378602b98f32a74847515654ae0de7ed8f72bc34776a065103e51595521ffe47";
  if (ks2 !== expect2) {
    throw new Error(`HC-128 自检失败（key=80..0）：期望 ${expect2}，实际 ${ks2}`);
  }
})();

register({
  id: "hc128",
  cat: "modern",
  name: "HC-128 流密码",
  desc: "HC-128 流密码（Wu Hongjun FSE 2004，eSTREAM 决赛）：P/Q 各 512×32bit 表 + f1/f2（SHA-256 σ）+ h1/h2 非线性映射。128 位 key + 128 位 IV。自反 XOR：encode 文本→密文 hex，decode 密文 hex→文本。已过 Crypto++ 官方向量（key=IV=0 + key=80..0）。",
  params: [
    { key: "key", type: "text", label: "密钥 (hex, 128 位)", default: "00000000000000000000000000000000", placeholder: "32 个 hex 字符" },
    { key: "iv", type: "text", label: "IV (hex, 128 位)", default: "00000000000000000000000000000000", placeholder: "32 个 hex 字符" },
  ],
  encode: hc128Encode,
  decode: hc128Decode,
});

export { hc128Encode, hc128Decode, hc128Keystream, hc128Init, hc128Generate, hc128Update };
