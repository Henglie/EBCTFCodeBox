/*
 * e0.js — 蓝牙 E0 流密码（modern, 双向自反）。
 *
 * 算法照 Bluetooth Core Spec Vol 2 Part C §3 + edderick/E0_Python (StateMachine.py)
 * + 博客 https://blog.csdn.net/wenbo13579/article/details/139158517 的算法结构。
 *
 * 结构：
 *   - 4 LFSR（25/31/33/39 位）+ 求和组合器 T1/T2 + 2 位 blend 记忆 ct
 *   - 初始化 239 步：208 位 preload 移入 LFSR（达到长度后开启反馈）+ t=39 重置 blend
 *   - 最后 128 位输出 Z 重新装载 LFSR（位映射 MSB-first）
 *   - 密钥流：blend 更新 + LFSR 纯反馈步进 + z = x1^x2^x3^x4^(ct&1)
 *
 * 参数：128 位 K_c（hex）+ 48 位 BD_ADDR（hex）+ 26 位 CLK。
 * L=16 时 K_session = K_c（g1=x^128, g2=1），故跳过多项式派生。
 *
 * 自反流密码：密文 = 明文 ⊕ 密钥流。encode 文本→hex，decode hex→文本。
 *
 * 红线：照参考实现不编造；纯本地零外发；core 层零 UI 依赖（仅 registry）。
 * 自检：与 Python 参考实现（工具/_e0_ref.py）交叉验证，5 组测试向量全过。
 *
 * 契约：register({ id:"e0", cat:"modern", name, desc, params, encode, decode })。
 */
import { register } from "./registry.js";

// ---- 常量（LFSR 寄存器超出 32 位安全范围，全程用 BigInt） ----
const LFSR_LENS = [25n, 31n, 33n, 39n];
const LFSR_TAPS = [
  [25n, 20n, 12n, 8n],
  [31n, 24n, 16n, 12n],
  [33n, 28n, 24n, 4n],
  [39n, 36n, 28n, 4n],
];
const LFSR_OUT = [23n, 23n, 31n, 31n]; // 输出位位置（0-indexed from LSB）
const T1_TABLE = [0, 1, 2, 3];
const T2_TABLE = [0, 3, 1, 2];

// 反转 4 位: bit0<->bit3, bit1<->bit2
function reverse4bit(x) {
  return (((x & 1) << 3) | ((x & 2) << 1) | ((x & 4) >> 1) | ((x & 8) >> 3)) & 0xf;
}

// ---- 单步 LFSR（博客约定: LSB-first, shift left, new bit at LSB） ----
// input_val: BigInt（外部输入流，逐位移入），last: BigInt（LFSR 内容）
// taps 1-indexed，length 是 LFSR 位数
function lfsrStep(inputVal, last, taps, length, feedbackEn) {
  let xor = Number(inputVal & 1n);
  inputVal >>= 1n;
  if (feedbackEn) {
    for (const t of taps) {
      if ((last >> (t - 1n)) & 1n) xor ^= 1;
    }
  }
  last = ((last << 1n) | BigInt(xor)) & ((1n << length) - 1n);
  return [inputVal, last];
}

// 从字节数组构建大整数（big-endian）
function bytesToBigInt(bytes) {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

// 构建 4 个 LFSR 的 preload（208 位总输入）
function buildPreloads(kc, addr, clk) {
  const cl = [
    BigInt(clk & 0xff),
    BigInt((clk >>> 8) & 0xff),
    BigInt((clk >>> 16) & 0xff),
    BigInt((clk >>> 24) & 0xff),
  ];
  const clu = Number((cl[0] >> 4n) & 0xfn);
  const cllRaw = Number(cl[0] & 0xfn);
  const cll = reverse4bit(cllRaw);
  const cl24 = (clk >>> 24) & 1;
  const cl25 = (clk >>> 25) & 1;

  // L1 (49 bits): addr[2] + cl[1] + kc[12] + kc[8] + kc[4] + kc[0] + cl24
  const l1 = bytesToBigInt([addr[2], Number(cl[1]), kc[12], kc[8], kc[4], kc[0], cl24 << 7]) >> 7n;
  // L2 (55 bits): addr[3] + addr[0] + kc[13] + kc[9] + kc[5] + kc[1] + (cll<<4 | 001<<1)
  const l2 = bytesToBigInt([addr[3], addr[0], kc[13], kc[9], kc[5], kc[1], (cll << 4) | (0b001 << 1)]) >> 1n;
  // L3 (49 bits): addr[4] + cl[2] + kc[14] + kc[10] + kc[6] + kc[2] + cl25
  const l3 = bytesToBigInt([addr[4], Number(cl[2]), kc[14], kc[10], kc[6], kc[2], cl25 << 7]) >> 7n;
  // L4 (55 bits): addr[5] + addr[1] + kc[15] + kc[11] + kc[7] + kc[3] + (clu<<4 | 111<<1)
  const l4 = bytesToBigInt([addr[5], addr[1], kc[15], kc[11], kc[7], kc[3], (clu << 4) | (0b111 << 1)]) >> 1n;

  return [l1, l2, l3, l4];
}

// 从 output_Z 的指定位重新装载 LFSR（MSB-first 装载: bit_positions[0] -> MSB）
function reloadLfsr(outputZ, bitPositions, length) {
  let val = 0n;
  for (let i = 0; i < bitPositions.length; i++) {
    const bit = (outputZ >> BigInt(bitPositions[i])) & 1n;
    val |= bit << (length - 1n - BigInt(i));
  }
  return val;
}

// 位映射（MSB-first 装载，照 StateMachine.py 装载顺序）
const L1_BITS = [
  0, 1, 2, 3, 4, 5, 6, 7, 32, 33, 34, 35, 36, 37, 38, 39, 64, 65, 66, 67, 68, 69, 70, 71, 96,
];
const L2_BITS = [
  8, 9, 10, 11, 12, 13, 14, 15, 40, 41, 42, 43, 44, 45, 46, 47,
  72, 73, 74, 75, 76, 77, 78, 79, 97, 98, 99, 100, 101, 102, 103,
];
const L3_BITS = [
  16, 17, 18, 19, 20, 21, 22, 23, 48, 49, 50, 51, 52, 53, 54, 55,
  80, 81, 82, 83, 84, 85, 86, 87, 104, 105, 106, 107, 108, 109, 110, 111, 120,
];
const L4_BITS = [
  24, 25, 26, 27, 28, 29, 30, 31, 56, 57, 58, 59, 60, 61, 62, 63,
  88, 89, 90, 91, 92, 93, 94, 95, 112, 113, 114, 115, 116, 117, 118, 119,
  121, 122, 123, 124, 125, 126, 127,
];

// ---- E0 引擎：生成 numBytes 字节密钥流（返回 Uint8Array） ----
function e0Keystream(kcBytes, addrBytes, clk, numBytes) {
  // ---- 初始化阶段（239 步）----
  let inputs = buildPreloads(kcBytes, addrBytes, clk);
  let lasts = [0n, 0n, 0n, 0n];
  let ctNeg1 = 0, ct = 0, ct1 = 0;
  let outputZ = 0n;
  const totalInit = 200 + 39; // 239
  const startPos = totalInit - 128; // 111

  for (let index = 0; index < totalInit; index++) {
    if (index > 0) {
      ctNeg1 = ct;
      ct = ct1;
    }
    const t = index + 1;
    if (t === 39) {
      ct = 0;
      ctNeg1 = 0;
    }
    // LFSR 步进
    for (let i = 0; i < 4; i++) {
      const fb = index >= Number(LFSR_LENS[i]);
      [inputs[i], lasts[i]] = lfsrStep(inputs[i], lasts[i], LFSR_TAPS[i], LFSR_LENS[i], fb);
    }
    // 输出位
    const x0 = Number((lasts[0] >> LFSR_OUT[0]) & 1n);
    const x1 = Number((lasts[1] >> LFSR_OUT[1]) & 1n);
    const x2 = Number((lasts[2] >> LFSR_OUT[2]) & 1n);
    const x3 = Number((lasts[3] >> LFSR_OUT[3]) & 1n);
    const y = x0 + x1 + x2 + x3;
    const st1 = (ct + y) >> 1; // 整除 2
    ct1 = T1_TABLE[ct] ^ T2_TABLE[ctNeg1] ^ st1;
    const z = x0 ^ x1 ^ x2 ^ x3 ^ (ct & 1);

    // 收集最后 128 位
    if (t > startPos) {
      const pos = t - startPos - 1;
      outputZ |= BigInt(z) << BigInt(pos);
    }
  }

  // ---- 重新装载 LFSR ----
  lasts = [
    reloadLfsr(outputZ, L1_BITS, LFSR_LENS[0]),
    reloadLfsr(outputZ, L2_BITS, LFSR_LENS[1]),
    reloadLfsr(outputZ, L3_BITS, LFSR_LENS[2]),
    reloadLfsr(outputZ, L4_BITS, LFSR_LENS[3]),
  ];

  // ---- 密钥流生成 ----
  const out = new Uint8Array(numBytes);
  for (let i = 0; i < numBytes * 8; i++) {
    // 1. 更新 blend 寄存器
    ctNeg1 = ct;
    ct = ct1;
    // 2. LFSR 步进（纯反馈，无输入）
    for (let j = 0; j < 4; j++) {
      let xor = 0;
      const lj = lasts[j];
      const tapsJ = LFSR_TAPS[j];
      for (let k = 0; k < tapsJ.length; k++) {
        if ((lj >> (tapsJ[k] - 1n)) & 1n) xor ^= 1;
      }
      lasts[j] = ((lj << 1n) | BigInt(xor)) & ((1n << LFSR_LENS[j]) - 1n);
    }
    // 3. 计算输出
    const x0 = Number((lasts[0] >> LFSR_OUT[0]) & 1n);
    const x1 = Number((lasts[1] >> LFSR_OUT[1]) & 1n);
    const x2 = Number((lasts[2] >> LFSR_OUT[2]) & 1n);
    const x3 = Number((lasts[3] >> LFSR_OUT[3]) & 1n);
    const y = x0 + x1 + x2 + x3;
    const st1 = (ct + y) >> 1;
    ct1 = T1_TABLE[ct] ^ T2_TABLE[ctNeg1] ^ st1;
    const z = x0 ^ x1 ^ x2 ^ x3 ^ (ct & 1);
    // MSB-first 打包
    out[i >> 3] |= z << (7 - (i & 7));
  }
  return out;
}

// ---- 参数解析 ----
function parseHex(s, name, expectLen) {
  const raw = String(s != null ? s : "").trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (!raw) throw new Error(`请填写${name}（hex）`);
  if (!/^[0-9a-fA-F]+$/.test(raw)) throw new Error(`${name}必须为十六进制：${raw}`);
  if (expectLen && raw.length > expectLen) throw new Error(`${name}最长 ${expectLen} 个十六进制字符`);
  const hex = expectLen ? raw.padStart(expectLen, "0") : raw;
  if (hex.length % 2) throw new Error(`${name}十六进制长度必须为偶数`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function parseClk(p) {
  const raw = String((p && p.clk) != null ? p.clk : "0").trim();
  let v;
  if (/^0x/i.test(raw)) v = parseInt(raw, 16);
  else if (/^\d+$/.test(raw)) v = parseInt(raw, 10);
  else throw new Error(`CLK 解析失败：${raw}`);
  if (!Number.isFinite(v) || v < 0) throw new Error(`CLK 必须为非负整数：${raw}`);
  return v & 0x3ffffff; // 26 位
}

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += (b & 0xff).toString(16).padStart(2, "0");
  return s;
}

// encode：文本 → 密文 hex
function e0Encode(text, p = {}) {
  const key = parseHex(p && p.key, "会话密钥 Kc", 32); // 128 位 = 32 hex
  const addr = parseHex(p && p.addr, "BD_ADDR", 12); // 48 位 = 12 hex
  const clk = parseClk(p);
  const data = te(text);
  const ks = e0Keystream(key, addr, clk, data.length);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ks[i];
  return bytesToHex(out);
}

// decode：密文 hex → 文本
function e0Decode(text, p = {}) {
  const key = parseHex(p && p.key, "会话密钥 Kc", 32);
  const addr = parseHex(p && p.addr, "BD_ADDR", 12);
  const clk = parseClk(p);
  const data = parseHex(text, "密文");
  const ks = e0Keystream(key, addr, clk, data.length);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ks[i];
  return td(out);
}

// ---- 载入自校验：与 Python 参考实现（工具/_e0_ref.py）交叉验证 ----
(() => {
  // Case 1: 全 0 输入
  const kc1 = new Uint8Array(16);
  const addr1 = new Uint8Array(6);
  const ks1 = bytesToHex(e0Keystream(kc1, addr1, 0, 16));
  if (ks1 !== "ae1cebec41f8590d08fcae1067077fea") {
    throw new Error(`E0 自检失败（Case 1 全 0 输入）：期望 ae1cebec41f8590d08fcae1067077fea，实际 ${ks1}`);
  }
  // Case 5: Kc=0, addr=aabbccddeeff, clk=0x21
  const kc5 = new Uint8Array(16);
  const addr5 = Uint8Array.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
  const ks5 = bytesToHex(e0Keystream(kc5, addr5, 0x21, 8));
  if (ks5 !== "398a332ab82bd44c") {
    throw new Error(`E0 自检失败（Case 5 addr+clk）：期望 398a332ab82bd44c，实际 ${ks5}`);
  }
})();

register({
  id: "e0",
  cat: "modern",
  name: "E0 流密码",
  desc: "蓝牙 E0 流密码（Bluetooth Core Spec 卷 2 §3）：4 个 LFSR（25/31/33/39 位）+ 求和组合器 T1/T2 + 2 位 blend 记忆。128 位 Kc + 48 位 BD_ADDR + 26 位 CLK。自反 XOR：encode 文本→密文 hex，decode 密文 hex→文本。已与 Python 参考实现交叉验证 5 组向量。",
  params: [
    { key: "key", type: "text", label: "会话密钥 Kc（hex）", default: "00000000000000000000000000000000", placeholder: "128 位，32 个十六进制字符" },
    { key: "addr", type: "text", label: "BD_ADDR（hex）", default: "000000000000", placeholder: "48 位蓝牙地址，12 个十六进制字符" },
    { key: "clk", type: "text", label: "CLK 蓝牙时钟", default: "0", placeholder: "26 位时钟（十进制或 0x 十六进制）" },
  ],
  encode: e0Encode,
  decode: e0Decode,
});

export { e0Encode, e0Decode, e0Keystream, buildPreloads, lfsrStep, reloadLfsr };
