/*
 * flashswirl.js — FlashSwirl 闪旋 流密码（cat:'modern'）。
 *
 * 覆盖：
 * flashSwirl  作者「风之暇想」的 ARX（Add-Rotate-XOR）对称流密码。256-bit key +
 *             192-bit nonce，支持 8 轮（快速）/ 20 轮（标准，默认）。双向对称可逆。
 *
 * 约束：
 * - 核心算法（swirlRound / keyToState / makeBaseNonce / keystream）逐字取自作者官方
 *   JS 参考实现，等同 vendor 引入，不改一字。已用官方 test_vectors.json 的 stream 类
 *   100 条（8 轮 50 + 20 轮 50）逐条比对通过。
 * - 往返对称：decode(encode(x, p), p) === x。
 * - 零外发：纯本地计算。
 *
 * 参考：
 * - https://github.com/fzxx/FlashSwirl （SPECIFICATION.md v1.1，作者：风之暇想，2026-04-23）
 * - 结构灵感来自 ChaCha20，但采用双 Quarter Round + 对角线混合的状态策略。
 *
 * 契约：register({id, cat:"modern", name, desc, params, encode, decode})。
 * encode(text, p): text → UTF-8 bytes → 流加密 → hex 大写
 * decode(hex, p):  hex → bytes → 流解密（同 keystream XOR）→ UTF-8 文本
 */
import { register } from "./registry.js";

// ============================================================
// 通用工具
// ============================================================
function strToBytes(s) {
  return new TextEncoder().encode(String(s));
}
function bytesToStr(b) {
  return new TextDecoder("utf-8", { fatal: false }).decode(b);
}
function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s.toUpperCase();
}
function hexToBytes(s) {
  s = String(s).trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (s.length === 0) return new Uint8Array(0);
  if (s.length % 2 !== 0) throw new Error("Hex 长度须为偶数：" + s.length);
  if (!/^[0-9a-fA-F]+$/.test(s)) throw new Error("非法 Hex 字符");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

// ============================================================
// FlashSwirl 核心算法（逐字取自官方参考实现，勿改）
// ============================================================
const BLOCK_SIZE = 32; // 块大小 32 字节
const KEY_SIZE = 32;   // 密钥 32 字节（256-bit）
const NONCE_SIZE = 24; // nonce 24 字节（192-bit）

// 固定初始状态（"FlashSwirl闪旋 FengZhiXiaXiang" 的 32 字节 UTF-8）
const FIXED_INITIAL_STATE = new Uint8Array([
  0x46, 0x6c, 0x61, 0x73, 0x68, 0x53, 0x77, 0x69,
  0x72, 0x6c, 0xe9, 0x97, 0xaa, 0xe6, 0x97, 0x8b,
  0x20, 0x46, 0x65, 0x6e, 0x67, 0x5a, 0x68, 0x69,
  0x58, 0x69, 0x61, 0x58, 0x69, 0x61, 0x6e, 0x67,
]);

function readUint32LE(buf, offset) {
  return ((buf[offset]) | (buf[offset + 1] << 8) | (buf[offset + 2] << 16) | (buf[offset + 3] << 24)) >>> 0;
}
function writeUint32LE(buf, offset, value) {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >> 8) & 0xff;
  buf[offset + 2] = (value >> 16) & 0xff;
  buf[offset + 3] = (value >> 24) & 0xff;
}

// 闪旋轮：双 Quarter Round + 对角线混合（ARX，模 2^32 加 + 循环左移 + XOR）
function swirlRound(state) {
  let a = state[0], b = state[1], c = state[2], d = state[3];
  a = (a + b) >>> 0; d = ((d ^ a) << 16 | (d ^ a) >>> 16) >>> 0;
  c = (c + d) >>> 0; b = ((b ^ c) << 12 | (b ^ c) >>> 20) >>> 0;
  a = (a + b) >>> 0; d = ((d ^ a) << 8 | (d ^ a) >>> 24) >>> 0;
  c = (c + d) >>> 0; b = ((b ^ c) << 7 | (b ^ c) >>> 25) >>> 0;
  state[0] = a; state[1] = b; state[2] = c; state[3] = d;

  let e = state[4], f = state[5], g = state[6], h = state[7];
  e = (e + f) >>> 0; h = ((h ^ e) << 16 | (h ^ e) >>> 16) >>> 0;
  g = (g + h) >>> 0; f = ((f ^ g) << 12 | (f ^ g) >>> 20) >>> 0;
  e = (e + f) >>> 0; h = ((h ^ e) << 8 | (h ^ e) >>> 24) >>> 0;
  g = (g + h) >>> 0; f = ((f ^ g) << 7 | (f ^ g) >>> 25) >>> 0;
  state[4] = e; state[5] = f; state[6] = g; state[7] = h;

  a = state[0], f = state[5], c = state[2], h = state[7];
  a = (a + f) >>> 0; h = ((h ^ a) << 16 | (h ^ a) >>> 16) >>> 0;
  c = (c + h) >>> 0; f = ((f ^ c) << 12 | (f ^ c) >>> 20) >>> 0;
  a = (a + f) >>> 0; h = ((h ^ a) << 8 | (h ^ a) >>> 24) >>> 0;
  c = (c + h) >>> 0; f = ((f ^ c) << 7 | (f ^ c) >>> 25) >>> 0;
  state[0] = a; state[5] = f; state[2] = c; state[7] = h;

  b = state[1], e = state[4], d = state[3], g = state[6];
  b = (b + e) >>> 0; g = ((g ^ b) << 16 | (g ^ b) >>> 16) >>> 0;
  d = (d + g) >>> 0; e = ((e ^ d) << 12 | (e ^ d) >>> 20) >>> 0;
  b = (b + e) >>> 0; g = ((g ^ b) << 8 | (g ^ b) >>> 24) >>> 0;
  d = (d + g) >>> 0; e = ((e ^ d) << 7 | (e ^ d) >>> 25) >>> 0;
  state[1] = b; state[4] = e; state[3] = d; state[6] = g;
}

// 轮数归一化：8 或 20 轮 → swirlRound 调用次数（rounds/2），其余回落 10
function normalizeRounds(rounds) {
  return (rounds === 8 || rounds === 20) ? rounds / 2 : 10;
}

// 32 字节 → 8×uint32（小端）
function keyToState(key) {
  const state = new Uint32Array(8);
  for (let i = 0; i < 8; i++) {
    const offset = i * 4;
    if (offset + 4 <= key.length) {
      state[i] = readUint32LE(key, offset);
    } else {
      let tmp = 0;
      for (let j = 0; j < 4; j++) {
        if (offset + j < key.length) tmp |= key[offset + j] << (j * 8);
      }
      state[i] = tmp >>> 0;
    }
  }
  return state;
}
function bytesToState(bytes, offset = 0) {
  const state = new Uint32Array(8);
  for (let i = 0; i < 8; i++) state[i] = readUint32LE(bytes, offset + i * 4);
  return state;
}
function stateToBytes(state) {
  const out = new Uint8Array(BLOCK_SIZE);
  for (let i = 0; i < 8; i++) writeUint32LE(out, i * 4, state[i]);
  return out;
}

// 基础 nonce 块：FIXED_INITIAL_STATE ^ key ^ nonce（nonce 不足 32 字节的高位补 0）
function makeBaseNonce(key, nonce) {
  const baseNonce = new Uint8Array(BLOCK_SIZE);
  for (let i = 0; i < BLOCK_SIZE; i++) {
    const nonceByte = i < NONCE_SIZE ? nonce[i] : 0;
    baseNonce[i] = FIXED_INITIAL_STATE[i] ^ key[i] ^ nonceByte;
  }
  return baseNonce;
}

// 单个 keystream 块（32 字节）：混入计数器 → 轮运算 → 加原始状态（ChaCha-like finalization）
function keystreamBlock(baseNonce, counter, normalizedRounds) {
  const state = bytesToState(baseNonce);
  state[6] ^= Number((counter >> 32n) & 0xffffffffn);
  state[7] ^= Number(counter & 0xffffffffn);
  const original = new Uint32Array(state);
  for (let i = 0; i < normalizedRounds; i++) swirlRound(state);
  for (let i = 0; i < 8; i++) state[i] = (state[i] + original[i]) >>> 0;
  return stateToBytes(state);
}

// 流加解密（对称）：逐 32 字节块 XOR keystream，计数器每块 +1
function flashSwirlStream(bytes, key, nonce, rounds) {
  const normalizedRounds = normalizeRounds(rounds);
  const baseNonce = makeBaseNonce(key, nonce);
  const out = new Uint8Array(bytes.length);
  let counter = 0n;
  let off = 0;
  while (off < bytes.length) {
    const ks = keystreamBlock(baseNonce, counter, normalizedRounds);
    const len = Math.min(BLOCK_SIZE, bytes.length - off);
    for (let i = 0; i < len; i++) out[off + i] = bytes[off + i] ^ ks[i];
    off += BLOCK_SIZE;
    counter++;
  }
  return out;
}

// ============================================================
// op 契约包装
// ============================================================
function checkParams(p) {
  const key = hexToBytes((p && p.key) || "");
  const nonce = hexToBytes((p && p.nonce) || "");
  let rounds = Number((p && p.rounds != null) ? p.rounds : 20);
  if (rounds !== 8 && rounds !== 20) rounds = 20;
  if (key.length !== KEY_SIZE) throw new Error("FlashSwirl key 须 32 字节（64 hex），实为 " + key.length);
  if (nonce.length !== NONCE_SIZE) throw new Error("FlashSwirl nonce 须 24 字节（48 hex），实为 " + nonce.length);
  return { key, nonce, rounds };
}

function flashSwirlEncode(text, p) {
  const { key, nonce, rounds } = checkParams(p);
  return bytesToHex(flashSwirlStream(strToBytes(text), key, nonce, rounds));
}
function flashSwirlDecode(hex, p) {
  const { key, nonce, rounds } = checkParams(p);
  return bytesToStr(flashSwirlStream(hexToBytes(hex), key, nonce, rounds));
}

register({
  id: "flashSwirl",
  cat: "modern",
  name: "FlashSwirl 闪旋",
  desc: "作者「风之暇想」的 ARX 对称流密码（256-bit key + 192-bit nonce，8/20 轮）。encode: 文本→Hex 密文；decode: Hex→文本。对称可逆，官方 stream 测试向量已验证。",
  params: [
    { key: "key", label: "key (hex, 32 字节 / 64 位)", type: "text", default: "", placeholder: "如 45c2b970...（64 个 hex 字符）" },
    { key: "nonce", label: "nonce (hex, 24 字节 / 48 位)", type: "text", default: "", placeholder: "如 37c61b15...（48 个 hex 字符）" },
    { key: "rounds", label: "轮数", type: "select", options: [{ value: 20, label: "20 轮（标准）" }, { value: 8, label: "8 轮（快速）" }], default: 20 },
  ],
  encode: flashSwirlEncode,
  decode: flashSwirlDecode,
});

export { strToBytes, bytesToStr, bytesToHex, hexToBytes, swirlRound, keyToState, makeBaseNonce, keystreamBlock, flashSwirlStream };
