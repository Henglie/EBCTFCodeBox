/*
 * a51.js — GSM A5/1 流密码（modern, 双向自反）。
 *
 * 算法照 Briceno / Goldberg / Wagner《A pedagogical implementation of the GSM
 * A5/1 and A5/2 "voice privacy" encryption algorithms》(1998) 参考实现，不编造：
 *
 * 三个 LFSR（Galois 反向，Fibonacci 抽头）：
 *   R1：19 位，反馈抽头 bit 13/16/17/18，钟控位 bit 8，输出位 bit 18
 *   R2：22 位，反馈抽头 bit 20/21，       钟控位 bit 10，输出位 bit 21
 *   R3：23 位，反馈抽头 bit 7/20/21/22，   钟控位 bit 10，输出位 bit 22
 *
 * 多数表决钟控（stop/go）：maj = 三个钟控位的多数值；钟控位 == maj 的寄存器才移位。
 * 每次 clockone：t = reg & taps；reg = (reg<<1) & mask；reg |= parity(t)。
 * 输出位：parity(R1&R1OUT) ^ parity(R2&R2OUT) ^ parity(R3&R3OUT)。
 *
 * 密钥装载（64 位会话密钥 Kc + 22 位帧号 frame）：
 *   1) 三寄存器清零。
 *   2) 64 拍：强制钟控全部三个（不用多数表决），每拍把 1 个密钥位 XOR 进各寄存器 bit0
 *      （密钥按字节 LSB 优先：keybit = key[i>>3] >> (i&7) & 1）。
 *   3) 22 拍：强制钟控全部三个，每拍把 1 个帧号位 XOR 进各寄存器 bit0（frame>>i & 1）。
 *   4) 100 拍：多数表决钟控，丢弃输出（混合）。
 * 之后每产 1 比特：先 clock()（多数表决），再取输出位。
 *
 * A5/1 是自反流密码：密文 = 明文 ⊕ 密钥流，解密与加密同一操作。
 * 本 op：encode 取输入 UTF-8 字节 ⊕ 密钥流 → 输出 hex；decode 取输入 hex ⊕ 同密钥流 → UTF-8 文本。
 * 密钥流按连续比特 MSB 优先打包成字节（与参考实现 getbit()<<(7-(i&7)) 一致）。
 *
 * 红线：算法照参考实现，不编造；纯本地零外发；core 层零 UI 依赖（仅 registry）。
 * 交付前用 Briceno/Goldberg/Wagner 官方测试向量（key=123456789ABCDEF0, frame=0x134）验证密钥流。
 *
 * 契约：register({ id:"a51", cat:"modern", name, desc, params, encode, decode })。
 */
import { register } from "./registry.js";

// ---- 寄存器掩码 / 钟控位 / 抽头 / 输出位（照参考实现常量） ----
const R1MASK = 0x07ffff; // 19 位
const R2MASK = 0x3fffff; // 22 位
const R3MASK = 0x7fffff; // 23 位
const R1MID = 0x000100;  // bit 8
const R2MID = 0x000400;  // bit 10
const R3MID = 0x000400;  // bit 10
const R1TAPS = 0x072000; // bits 18,17,16,13
const R2TAPS = 0x300000; // bits 21,20
const R3TAPS = 0x700080; // bits 22,21,20,7
const R1OUT = 0x040000;  // bit 18
const R2OUT = 0x200000;  // bit 21
const R3OUT = 0x400000;  // bit 22

function parity(x) {
  x ^= x >>> 16;
  x ^= x >>> 8;
  x ^= x >>> 4;
  x ^= x >>> 2;
  x ^= x >>> 1;
  return x & 1;
}

// A5/1 引擎（局部状态封装为对象）
function makeA51(keyBytes, frame) {
  let R1 = 0, R2 = 0, R3 = 0;

  function clockone(reg, mask, taps) {
    const t = reg & taps;
    reg = (reg << 1) & mask;
    reg |= parity(t);
    return reg >>> 0;
  }
  function clockAllThree() {
    R1 = clockone(R1, R1MASK, R1TAPS);
    R2 = clockone(R2, R2MASK, R2TAPS);
    R3 = clockone(R3, R3MASK, R3TAPS);
  }
  function majority() {
    const sum = parity(R1 & R1MID) + parity(R2 & R2MID) + parity(R3 & R3MID);
    return sum >= 2 ? 1 : 0;
  }
  function clock() {
    const maj = majority();
    if (((R1 & R1MID) !== 0 ? 1 : 0) === maj) R1 = clockone(R1, R1MASK, R1TAPS);
    if (((R2 & R2MID) !== 0 ? 1 : 0) === maj) R2 = clockone(R2, R2MASK, R2TAPS);
    if (((R3 & R3MID) !== 0 ? 1 : 0) === maj) R3 = clockone(R3, R3MASK, R3TAPS);
  }
  function getbit() {
    return parity(R1 & R1OUT) ^ parity(R2 & R2OUT) ^ parity(R3 & R3OUT);
  }

  // ---- 密钥装载 ----
  // 1) 64 拍：密钥位（LSB 优先）
  for (let i = 0; i < 64; i++) {
    clockAllThree();
    const keybit = (keyBytes[i >> 3] >> (i & 7)) & 1;
    R1 ^= keybit; R2 ^= keybit; R3 ^= keybit;
  }
  // 2) 22 拍：帧号位
  for (let i = 0; i < 22; i++) {
    clockAllThree();
    const framebit = (frame >>> i) & 1;
    R1 ^= framebit; R2 ^= framebit; R3 ^= framebit;
  }
  // 3) 100 拍：多数表决钟控，丢弃
  for (let i = 0; i < 100; i++) clock();

  return {
    // 产 1 比特（先 clock 再取位，与参考 run() 一致）
    nextBit() { clock(); return getbit(); },
  };
}

// 生成 nbits 比特密钥流（返回 0/1 数组）
function genKeystreamBits(keyBytes, frame, nbits) {
  const eng = makeA51(keyBytes, frame);
  const bits = new Uint8Array(nbits);
  for (let i = 0; i < nbits; i++) bits[i] = eng.nextBit();
  return bits;
}

// 生成 nbytes 密钥流字节（连续比特 MSB 优先打包）
function genKeystreamBytes(keyBytes, frame, nbytes) {
  const eng = makeA51(keyBytes, frame);
  const out = new Uint8Array(nbytes);
  for (let i = 0; i < nbytes; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | eng.nextBit();
    out[i] = b & 0xff;
  }
  return out;
}

// ---- 参数解析 ----
function parseKey(p) {
  const raw = String((p && p.key) != null ? p.key : "").trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (!raw) throw new Error("请填写 64 位会话密钥 Kc（16 位十六进制）");
  if (!/^[0-9a-fA-F]+$/.test(raw)) throw new Error(`密钥必须为十六进制：${raw}`);
  if (raw.length > 16) throw new Error("密钥最长 64 位（16 个十六进制字符）");
  const hex = raw.padStart(16, "0"); // 不足 64 位高位补 0
  const key = new Uint8Array(8);
  for (let i = 0; i < 8; i++) key[i] = parseInt(hex.substr(i * 2, 2), 16);
  return key;
}
function parseFrame(p) {
  const raw = String((p && p.frame) != null ? p.frame : "0").trim();
  let f;
  try { f = /^0x/i.test(raw) ? parseInt(raw, 16) : parseInt(raw, 10); }
  catch { throw new Error(`帧号解析失败：${raw}`); }
  if (!Number.isFinite(f) || f < 0) throw new Error(`帧号必须为非负整数：${raw}`);
  return f & 0x3fffff; // 22 位
}

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += (b & 0xff).toString(16).padStart(2, "0");
  return s;
}
function hexToBytes(s) {
  const clean = String(s || "").replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("十六进制密文长度必须为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

// encode：文本 → 密文 hex
function a51Encode(text, p = {}) {
  const key = parseKey(p);
  const frame = parseFrame(p);
  const data = te(text);
  const ks = genKeystreamBytes(key, frame, data.length);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ks[i];
  return bytesToHex(out);
}

// decode：密文 hex → 文本
function a51Decode(text, p = {}) {
  const key = parseKey(p);
  const frame = parseFrame(p);
  const data = hexToBytes(text);
  const ks = genKeystreamBytes(key, frame, data.length);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ks[i];
  return td(out);
}

register({
  id: "a51",
  cat: "modern",
  name: "A5/1 流密码",
  desc: "GSM A5/1 语音加密流密码（Briceno/Goldberg/Wagner 参考实现）：三个 LFSR（19/22/23 位）多数表决钟控。64 位会话密钥 Kc + 22 位帧号。自反 XOR：encode 文本→密文 hex，decode 密文 hex→文本。",
  params: [
    { key: "key", type: "text", label: "会话密钥 Kc（hex）", default: "1223456789ABCDEF", placeholder: "64 位，16 个十六进制字符" },
    { key: "frame", type: "text", label: "帧号 frame", default: "0x134", placeholder: "22 位帧号（十进制或 0x 十六进制）" },
  ],
  encode: a51Encode,
  decode: a51Decode,
});

export { a51Encode, a51Decode, genKeystreamBits, genKeystreamBytes, makeA51 };
