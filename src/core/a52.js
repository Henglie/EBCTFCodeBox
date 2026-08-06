/*
 * a52.js — GSM A5/2 流密码（modern, 双向自反）。
 *
 * 算法照 Briceno / Goldberg / Wagner《A pedagogical implementation of the GSM
 * A5/1 and A5/2 "voice privacy" encryption algorithms》(1998) 参考实现
 * （osmocom airprobe a5-1-2.h 镜像，**norev 语义**——官方原版 keysetup 无字节
 * 反转，用户 key 输入按序装载；airprobe 镜像额外加的 `key_reversed` 反转是
 * 变异，M 已用官方向量实测排除：norev 版 A5/2 输出与官方向量逐字节一致）：
 *
 * 四个 LFSR（Galois 反向，Fibonacci 抽头）：
 *   R1：19 位，反馈抽头 bit 13/16/17/18，输出位 bit 18
 *   R2：22 位，反馈抽头 bit 20/21，       输出位 bit 21
 *   R3：23 位，反馈抽头 bit 7/20/21/22，  输出位 bit 22
 *   R4：17 位，反馈抽头 bit 11/16，       钟控源（恒移）
 *
 * A5/2 钟控（区别于 A5/1 的三寄存器择多）：R4 的 bit 10/3/7 做择多表决，
 * R1 由 bit 10 控、R2 由 bit 3 控、R3 由 bit 7 控（钟控位 == 择多值才移），
 * R4 每拍必移。
 * 密钥装载（64 位会话密钥 Kc + 22 位帧号 frame）：
 *   1) 四寄存器清零。
 *   2) 64 拍：强制钟控全部（不用择多），每拍把 1 个密钥位 XOR 进各寄存器 bit0
 *      （密钥按字节 LSB 优先：keybit = key[i>>3] >> (i&7) & 1，无字节反转）。
 *   3) 22 拍：强制钟控，每拍 1 个帧号位 XOR 进各寄存器 bit0；
 *      最后一拍（i==21）同时**强制置位**：R1 bit15、R2 bit16、R3 bit18、R4 bit10。
 *   4) 100 拍：择多钟控，丢弃输出（混合）。
 * 之后每产 1 比特：先 clock()（择多钟控），再取输出位。
 *
 * 输出位 = 三寄存器顶位 XOR 三个 majority 掩码项（非线性），且**延迟一拍**
 * （C 参考 getbit() 的 static delaybit：返回上一次算的位，预载在 keysetup 末尾
 * 调一次 getbit()）。官方向量已实测一致。
 *
 * 本 op：encode 取输入 UTF-8 字节 ⊕ 密钥流 → 输出 hex；decode 取输入 hex ⊕
 * 同密钥流 → UTF-8 文本。密钥流按连续比特 MSB 优先打包成字节（与参考实现
 * getbit()<<(7-(i&7)) 一致）。
 *
 * 红线：算法照参考实现，不编造；纯本地零外发；core 层零 UI 依赖（仅 registry）。
 * 自检：node 运行 `node --input-type=module -e "import('./src/core/a52.js').then(m=>m.selfCheck())"`，
 * 官方向量 key=00FCFFFFFFFFFFFF frame=0x21 → A→B f4512cac... B→A 4800d432...。
 *
 * 契约：register({ id:"a52", cat:"modern", name, desc, params, encode, decode })。
 */
import { register } from "./registry.js";

// ---- 寄存器掩码 / 钟控位 / 抽头 / 输出位 / 强置位（照参考实现常量） ----
const R1MASK = 0x07ffff; // 19 位
const R2MASK = 0x3fffff; // 22 位
const R3MASK = 0x7fffff; // 23 位
const R4MASK = 0x01ffff; // 17 位
const R4TAP1 = 0x000400; // R4 bit 10（控 R1）
const R4TAP2 = 0x000008; // R4 bit 3（控 R2）
const R4TAP3 = 0x000080; // R4 bit 7（控 R3）
const R1TAPS = 0x072000; // bits 18,17,16,13
const R2TAPS = 0x300000; // bits 21,20
const R3TAPS = 0x700080; // bits 22,21,20,7
const R4TAPS = 0x010800; // bits 16,11
const R1OUT = 0x040000;  // bit 18
const R2OUT = 0x200000;  // bit 21
const R3OUT = 0x400000;  // bit 22
// 装载末拍强置位（loaded << bit）
const R1LOAD = 0x008000; // bit 15
const R2LOAD = 0x010000; // bit 16
const R3LOAD = 0x040000; // bit 18
const R4LOAD = 0x000400; // bit 10

function parity(x) {
  x ^= x >>> 16;
  x ^= x >>> 8;
  x ^= x >>> 4;
  x ^= x >>> 2;
  x ^= x >>> 1;
  return x & 1;
}

// 择多表决：三个参数中非零个数 ≥2 返回 1（照 C 参考 majority(w1,w2,w3)）
function majority(w1, w2, w3) {
  const sum = (w1 !== 0 ? 1 : 0) + (w2 !== 0 ? 1 : 0) + (w3 !== 0 ? 1 : 0);
  return sum >= 2 ? 1 : 0;
}

// A5/2 引擎（局部状态封装为对象）
function makeA52(keyBytes, frame) {
  let R1 = 0, R2 = 0, R3 = 0, R4 = 0;
  let delaybit = 0;

  function clockone(reg, mask, taps, loadedBit) {
    const t = reg & taps;
    reg = (reg << 1) & mask;
    reg |= parity(t);
    reg |= loadedBit;
    return reg >>> 0;
  }
  // allP=1 强制全移（装载用）；loaded=1 末拍强置位
  function clock(allP, loaded) {
    const maj = majority(R4 & R4TAP1, R4 & R4TAP2, R4 & R4TAP3);
    if (allP || (((R4 & R4TAP1) !== 0 ? 1 : 0) === maj)) R1 = clockone(R1, R1MASK, R1TAPS, loaded ? R1LOAD : 0);
    if (allP || (((R4 & R4TAP2) !== 0 ? 1 : 0) === maj)) R2 = clockone(R2, R2MASK, R2TAPS, loaded ? R2LOAD : 0);
    if (allP || (((R4 & R4TAP3) !== 0 ? 1 : 0) === maj)) R3 = clockone(R3, R3MASK, R3TAPS, loaded ? R3LOAD : 0);
    R4 = clockone(R4, R4MASK, R4TAPS, loaded ? R4LOAD : 0);
  }
  // 输出位：顶位 ⊕ 三个 majority 掩码项，延迟一拍返回
  function getbit() {
    const topbits = (((R1 >> 18) ^ (R2 >> 21) ^ (R3 >> 22)) & 0x01);
    const nowbit = delaybit;
    delaybit = (
      topbits
      ^ majority(R1 & 0x8000, (~R1) & 0x4000, R1 & 0x1000)
      ^ majority((~R2) & 0x10000, R2 & 0x2000, R2 & 0x200)
      ^ majority(R3 & 0x40000, R3 & 0x10000, (~R3) & 0x2000)
    );
    return nowbit;
  }

  // ---- 密钥装载 ----
  // 1) 64 拍：密钥位（LSB 优先，无字节反转）
  for (let i = 0; i < 64; i++) {
    clock(1, 0);
    const keybit = (keyBytes[i >> 3] >> (i & 7)) & 1;
    R1 ^= keybit; R2 ^= keybit; R3 ^= keybit; R4 ^= keybit;
  }
  // 2) 22 拍：帧号位（末拍强置位）
  for (let i = 0; i < 22; i++) {
    clock(1, i === 21);
    const framebit = (frame >>> i) & 1;
    R1 ^= framebit; R2 ^= framebit; R3 ^= framebit; R4 ^= framebit;
  }
  // 3) 100 拍：择多钟控，丢弃
  for (let i = 0; i < 100; i++) clock(0, 0);
  // 预载延迟位（不改变寄存器状态）
  getbit();

  return {
    // 产 1 比特（先 clock 再取位，与参考 run() 一致）
    nextBit() { clock(0, 0); return getbit(); },
  };
}

// 生成 nbytes 密钥流字节（连续比特 MSB 优先打包）
function genKeystreamBytes(keyBytes, frame, nbytes) {
  const eng = makeA52(keyBytes, frame);
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
function a52Encode(text, p = {}) {
  const key = parseKey(p);
  const frame = parseFrame(p);
  const data = te(text);
  const ks = genKeystreamBytes(key, frame, data.length);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ks[i];
  return bytesToHex(out);
}

// decode：密文 hex → 文本
function a52Decode(text, p = {}) {
  const key = parseKey(p);
  const frame = parseFrame(p);
  const data = hexToBytes(text);
  const ks = genKeystreamBytes(key, frame, data.length);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ks[i];
  return td(out);
}

register({
  id: "a52",
  cat: "modern",
  name: "A5/2 流密码",
  desc: "GSM A5/2 语音加密流密码（Briceno/Goldberg/Wagner 参考实现）：四个 LFSR（19/22/23/17 位）R4 择多钟控 + 掩码位非线性输出，输出延迟一拍。64 位会话密钥 Kc + 22 位帧号。自反 XOR：encode 文本→密文 hex，decode 密文 hex→文本。",
  params: [
    { key: "key", type: "text", label: "会话密钥 Kc（hex）", default: "00FCFFFFFFFFFFFF", placeholder: "64 位，16 个十六进制字符" },
    { key: "frame", type: "text", label: "帧号 frame", default: "0x21", placeholder: "22 位帧号（十进制或 0x 十六进制）" },
  ],
  encode: a52Encode,
  decode: a52Decode,
});

// ---- 自检（node 手动调用；浏览器加载不自动跑，零噪音） ----
// 从连续密钥流字节中按位截取 [bitStart, bitStart+nbits) 并 MSB 打包（对齐 C run() 的 114bit 缓冲语义）
function takeBits(ks, bitStart, nbits) {
  const out = new Uint8Array(Math.ceil(nbits / 8));
  for (let i = 0; i < nbits; i++) {
    const srcBit = (ks[(bitStart + i) >> 3] >> (7 - ((bitStart + i) & 7))) & 1;
    out[i >> 3] |= srcBit << (7 - (i & 7));
  }
  return out;
}

function selfCheck() {
  const key = parseKey({ key: "00FCFFFFFFFFFFFF" });
  const frame = parseFrame({ frame: "0x21" });
  // 官方向量（Briceno 参考实现 test()）：run() 产出 114+114 bit
  const expectedA = "f4512cac13593764460b722dadd500";
  const expectedB = "4800d4328e16a14dcd7b9722265100";
  const ks = genKeystreamBytes(key, frame, 30);
  const cases = [
    { name: "官方向量 A→B（前 114 bit）", got: bytesToHex(takeBits(ks, 0, 114)), expected: expectedA },
    { name: "官方向量 B→A（第 114~228 bit）", got: bytesToHex(takeBits(ks, 114, 114)), expected: expectedB },
  ];
  let fail = 0;
  for (const c of cases) {
    if (c.got === c.expected) {
      console.log("PASS " + c.name);
    } else {
      console.log("FAIL " + c.name + "\n  got      " + c.got + "\n  expected " + c.expected);
      fail++;
    }
  }
  // 往返测试
  const rt = a52Decode(a52Encode("Hello A5/2 你好", { key: "0123456789ABCDEF", frame: 0x134 }), { key: "0123456789ABCDEF", frame: 0x134 });
  if (rt === "Hello A5/2 你好") {
    console.log("PASS 往返测试（文本→hex→文本）");
  } else {
    console.log("FAIL 往返测试: " + JSON.stringify(rt));
    fail++;
  }
  console.log(fail === 0 ? "A5/2 selfCheck 全部 PASS" : `A5/2 selfCheck ${fail} 项 FAIL`);
  return fail === 0;
}

export { a52Encode, a52Decode, genKeystreamBytes, makeA52, selfCheck };
