/*
 * bitops.js — 位运算工具组（cat:'radix'）。
 *
 * 覆盖：
 * - bitReverse 位反转：每字节 8 位镜像翻转（自逆变换）。
 * - bitRotate 循环移位：字节内循环左/右移 1-7 位（encode 正向 / decode 反向）。
 * - byteSwap 字节序反转：按 2/4/8 字节分组反转（端序转换，自逆变换）。
 * - bitPlaneExtract 位平面提取（run 单向）：抽每字节第 k 位组成比特串。
 *
 * 注：字节级/数值级格雷码已并入 classic.js 的 graycode（mode=bytes/num）。
 *
 * I/O 契约：
 * - encode(text): 文本 → UTF-8 字节 → 变换 → 连续大写 Hex 串。
 * - decode(hex): Hex 串（容错空格 / 0x 前缀）→ 字节 → 逆变换 → UTF-8 文本。
 * - bitPlaneExtract 为 run 单向（提取有损，输出全部/指定位平面比特串）。
 *
 * 纯算法无外部依赖；变换在字节层，往返可逆（bitPlaneExtract 除外，标注单向）。
 */
import { register } from "./registry.js";

// ============ 字符串 / 字节 / Hex 工具 ============
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
  if (!/^[0-9a-fA-F]+$/.test(s)) throw new Error("非法 Hex 字符：" + s);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

// ============ 位反转（字节内 8 位镜像） ============
function reverseByte(b) {
  b &= 0xff;
  b = ((b & 0xf0) >> 4) | ((b & 0x0f) << 4);
  b = ((b & 0xcc) >> 2) | ((b & 0x33) << 2);
  b = ((b & 0xaa) >> 1) | ((b & 0x55) << 1);
  return b & 0xff;
}
function bitReverseBytes(bytes) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = reverseByte(bytes[i]);
  return out;
}

// ============ 循环移位（字节内） ============
function rotLeftByte(b, n) {
  n &= 7;
  if (n === 0) return b & 0xff;
  return ((b << n) | (b >>> (8 - n))) & 0xff;
}
function rotRightByte(b, n) {
  n &= 7;
  if (n === 0) return b & 0xff;
  return ((b >>> n) | (b << (8 - n))) & 0xff;
}
function bitRotateBytes(bytes, dir, n) {
  const fn = dir === "right" ? rotRightByte : rotLeftByte;
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = fn(bytes[i], n);
  return out;
}

// ============ 字节序反转（按组，自逆） ============
function byteSwapBytes(bytes, group) {
  group = group | 0;
  if (group < 2) group = 2;
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += group) {
    const end = Math.min(i + group, bytes.length);
    const len = end - i;
    for (let j = 0; j < len; j++) out[i + j] = bytes[end - 1 - j];
  }
  return out;
}

// hex↔hex 端序交换（复刻原 endianSwap，带整组长度校验，自逆）
// group 2/4/8 对应 16/32/64 位。整组时反转逻辑与 byteSwapBytes 一致。
function byteSwapHexIO(text, group) {
  group = group | 0;
  if (![2, 4, 8].includes(group)) throw new Error("分组字节数须为 2/4/8（实为 " + group + "）");
  const bytes = hexToBytes(text);
  if (bytes.length % group !== 0) {
    throw new Error("字节长度 " + bytes.length + " 不是 " + group + " 的整数倍（" + (group * 8) + " 位组）");
  }
  return bytesToHex(byteSwapBytes(bytes, group));
}

// ============ 位平面提取（单向，有损） ============
function bitPlane(bytes, k) {
 // k: 0=LSB .. 7=MSB
  let s = "";
  for (const b of bytes) s += ((b >>> k) & 1).toString();
  return s;
}

// ============ 注册 op ============

// ---- ROR13 API 哈希 + 字节算术 ----

// 6. ror13Hash（run 单向，PE API 哈希用的 32 位循环右移 13 累加）
// 恶意软件分析常见：对 API 名（ASCII，小写或原样）逐字节累加 + 32 位 ROR 13。
// 参考：PE 内嵌 API 哈希（ROR13 算法），权威源 multiple malware analysis 教材。
// 注：单向哈希不可逆；不同 API 名哈希值不同（碰撞理论可能但实际罕见）。
function ror13Dword(v) {
 // 32 位循环右移 13 位
  return (((v >>> 13) | (v << 19)) >>> 0);
}
function ror13HashBytes(bytes) {
  let h = 0;
  for (let i = 0; i < bytes.length; i++) {
 // 标准 PE ROR13 哈希：先 ROR 13 再加字节（顺序不可反）
    h = ror13Dword(h);
    h = (h + bytes[i]) >>> 0;
  }
  return h >>> 0;
}

// 7. byteArith（字节加减模 256，双向）
// encode：每字节 + key（mod 256）；decode：每字节 - key（mod 256）
// 支持 add/sub/mul（mul 用模 256 逆元解码，仅奇数 key 有逆元）
function modInverse256(a) {
 // 求 a 模 256 的乘法逆元（仅奇数有逆元，因 gcd(奇,256)=1）
  a = ((a % 256) + 256) % 256;
  if (a % 2 === 0) throw new Error("byteArith 乘法逆元仅奇数 key 有（" + a + " 为偶数）");
 // 扩展欧几里得求逆元（256 是 2^8，奇数必互素）
  let g = 256, x = 0, y = 1, og = a, ox = 1, oy = 0;
  while (g !== 0) {
    const q = Math.floor(og / g);
    [og, g] = [g, og - q * g];
    [ox, x] = [x, ox - q * x];
    [oy, y] = [y, oy - q * y];
  }
  return ((ox % 256) + 256) % 256;
}
function byteArithBytes(bytes, op, key) {
  const k = ((key % 256) + 256) % 256;
  const out = new Uint8Array(bytes.length);
  if (op === "add") {
    for (let i = 0; i < bytes.length; i++) out[i] = (bytes[i] + k) & 0xff;
  } else if (op === "sub") {
    for (let i = 0; i < bytes.length; i++) out[i] = (bytes[i] - k + 256) & 0xff;
  } else if (op === "mul") {
    for (let i = 0; i < bytes.length; i++) out[i] = (bytes[i] * k) & 0xff;
  } else {
    throw new Error("byteArith 未知操作: " + op + "（合法: add/sub/mul）");
  }
  return out;
}

// 1. bitReverse（自逆变换）
register({
  id: "bitReverse", cat: "radix", name: "位反转",
  desc: "每字节 8 位镜像翻转（bit 0↔7, 1↔6...）。encode: 文本→Hex；decode: Hex→文本。自逆变换。",
  params: [],
  encode: (t) => bytesToHex(bitReverseBytes(strToBytes(t))),
  decode: (t) => bytesToStr(bitReverseBytes(hexToBytes(t))),
});

// 2. bitRotate（循环移位，encode 正向 / decode 反向）
register({
  id: "bitRotate", cat: "radix", name: "位循环移位",
  desc: "字节内循环移位 1-7 位。encode 按所选方向移；decode 反向移还原。文本↔Hex。",
  params: [
    { key: "dir", label: "方向", type: "select", default: "left", options: [
      { value: "left", label: "循环左移" },
      { value: "right", label: "循环右移" },
    ] },
    { key: "bits", label: "位数（1-7）", type: "number", default: 1 },
  ],
  encode: (t, p) => {
    const dir = (p && p.dir) || "left";
    const n = Number((p && p.bits) || 1);
    return bytesToHex(bitRotateBytes(strToBytes(t), dir, n));
  },
  decode: (t, p) => {
    const dir = (p && p.dir) || "left";
    const n = Number((p && p.bits) || 1);
    const inv = dir === "right" ? "left" : "right";
    return bytesToStr(bitRotateBytes(hexToBytes(t), inv, n));
  },
});

// 3. byteSwap（字节序反转，自逆）
// mode=text（默认）：文本↔Hex，encode 文本→Hex，decode Hex→文本。
// mode=hex：Hex↔Hex 端序交换（复刻旧 endianSwap），encode/decode 均自逆，带整组长度校验。
register({
  id: "byteSwap", cat: "radix", name: "字节序反转",
  desc: "按 2/4/8 字节分组反转字节顺序（大小端转换，自逆）。文本模式: 文本↔Hex；Hex 模式: Hex↔Hex（大小端互转，长度须为组的整数倍）。",
  params: [
    { key: "mode", label: "模式", type: "select", default: "text", options: [
      { value: "text", label: "文本 ↔ Hex" },
      { value: "hex", label: "Hex ↔ Hex（大小端）" },
    ] },
    { key: "group", label: "分组字节数", type: "select", default: 2, options: [
      { value: 2, label: "2 字节（16 位）" },
      { value: 4, label: "4 字节（32 位）" },
      { value: 8, label: "8 字节（64 位）" },
    ] },
  ],
  encode: (t, p) => {
    const group = Number((p && p.group) || 2);
    if (p && p.mode === "hex") return byteSwapHexIO(t, group);
    return bytesToHex(byteSwapBytes(strToBytes(t), group));
  },
  decode: (t, p) => {
    const group = Number((p && p.group) || 2);
    if (p && p.mode === "hex") return byteSwapHexIO(t, group);
    return bytesToStr(byteSwapBytes(hexToBytes(t), group));
  },
});

// 5. bitPlaneExtract（run 单向，有损提取）
register({
  id: "bitPlaneExtract", cat: "radix", name: "位平面提取",
  desc: "抽取每字节指定位组成比特串（k=0 LSB .. 7 MSB）。有损单向。默认输出全部 8 个位平面。",
  params: [
    { key: "plane", label: "位平面", type: "select", default: "all", options: [
      { value: "all", label: "全部（0-7）" },
      { value: "7", label: "位 7 (MSB)" },
      { value: "6", label: "位 6" },
      { value: "5", label: "位 5" },
      { value: "4", label: "位 4" },
      { value: "3", label: "位 3" },
      { value: "2", label: "位 2" },
      { value: "1", label: "位 1" },
      { value: "0", label: "位 0 (LSB)" },
    ] },
  ],
  run: (t, p) => {
    const bytes = strToBytes(t);
    const plane = (p && p.plane) || "all";
    if (plane === "all") {
      const lines = [];
      for (let k = 7; k >= 0; k--) {
        const tag = k === 7 ? " (MSB)" : (k === 0 ? " (LSB)" : "");
        lines.push("位 " + k + tag + ": " + bitPlane(bytes, k));
      }
      return lines.join("\n");
    }
    const k = Number(plane);
    if (k < 0 || k > 7) throw new Error("位平面须为 0-7：" + plane);
    return bitPlane(bytes, k);
  },
});

// 6. ror13Hash（run 单向，PE API 哈希 ROR13 累加）
// 恶意软件分析常见：对 API 名逐字节累加 + 32 位循环右移 13。
// 输出 8 位十六进制哈希值（32 位无符号）。
// 注：单向不可逆；bitRotate（字节级）已覆盖循环移位，本 op 是 32 位哈希专用。
register({
  id: "ror13Hash", cat: "modern", name: "ROR13 API 哈希",
  desc: "PE 恶意软件 API 哈希（32 位循环右移 13 累加）。对输入逐字节累加 + ROR 13，输出 8 位 hex 哈希。单向不可逆。常见 API 权威向量: LoadLibraryA=0xEC0E4E8E、GetProcAddress=0x7C0DFCAA。",
  params: [
    { key: "case", label: "大小写", type: "select", default: "asis",
      options: [
        { value: "asis", label: "原样" },
        { value: "lower", label: "转小写" },
        { value: "upper", label: "转大写" },
      ] },
  ],
  run: (t, p) => {
    let s = String(t || "");
    const c = (p && p.case) || "asis";
    if (c === "lower") s = s.toLowerCase();
    else if (c === "upper") s = s.toUpperCase();
    const bytes = strToBytes(s);
    const h = ror13HashBytes(bytes);
    return "0x" + h.toString(16).toUpperCase().padStart(8, "0");
  },
});

// 7. byteArith（字节算术模 256，双向）
// encode：每字节按 op 运算（add/sub/mul）模 256；decode：逆运算还原。
// add 的逆是 sub；sub 的逆是 add；mul 的逆是乘以模 256 逆元（仅奇数 key）。
register({
  id: "byteArith", cat: "modern", name: "字节算术 (mod 256)",
  desc: "逐字节算术运算模 256。encode 按 op(add/sub/mul) + key 运算→Hex；decode 逆运算还原。mul 仅奇数 key 可逆（偶数无模 256 逆元）。",
  params: [
    { key: "op", label: "运算", type: "select", default: "add",
      options: [
        { value: "add", label: "加 (x + key)" },
        { value: "sub", label: "减 (x - key)" },
        { value: "mul", label: "乘 (x * key)" },
      ] },
    { key: "key", label: "key (0-255)", type: "number", default: 1 },
  ],
  encode: (t, p) => {
    const op = (p && p.op) || "add";
    const key = Number((p && p.key) || 1);
    return bytesToHex(byteArithBytes(strToBytes(t), op, key));
  },
  decode: (t, p) => {
    const op = (p && p.op) || "add";
    const key = Number((p && p.key) || 1);
 // 逆运算：add→sub, sub→add, mul→mul(逆元)
    const invOp = op === "add" ? "sub" : op === "sub" ? "add" : "mul";
    const invKey = op === "mul" ? modInverse256(key) : key;
    return bytesToStr(byteArithBytes(hexToBytes(t), invOp, invKey));
  },
});

// 8. byteReverse（整串字节倒序，File-Reverse，自逆）
// File-Reverse：整个字节流首尾倒序（区别于 byteSwap 的定长分组端序反转）。
// 文本模式：文本 → UTF-8 字节整串倒序 → Hex（因倒序后多字节 UTF-8 序列被打散，无法直接还原文本）。
// Hex 模式：Hex ↔ Hex 整串字节倒序（自逆，最常用于二进制文件字节流反转）。
function byteReverseBytes(bytes) {
  const out = bytes.slice();
  out.reverse();
  return out;
}
register({
  id: "byteReverse", cat: "radix", name: "整串字节倒序",
  desc: "整个字节流首尾倒序（File-Reverse，区别于 byteSwap 定长分组端序反转）。文本模式: 文本→倒序字节 Hex；Hex 模式: Hex↔Hex 整串倒序（自逆）。",
  params: [
    { key: "mode", label: "模式", type: "select", default: "text", options: [
      { value: "text", label: "文本 → 倒序 Hex" },
      { value: "hex", label: "Hex ↔ Hex（整串倒序，自逆）" },
    ] },
  ],
  encode: (t, p) => {
    if (p && p.mode === "hex") return bytesToHex(byteReverseBytes(hexToBytes(t)));
    return bytesToHex(byteReverseBytes(strToBytes(t)));
  },
  decode: (t, p) => {
    if (p && p.mode === "hex") return bytesToHex(byteReverseBytes(hexToBytes(t)));
    // 文本模式 decode：Hex → 倒序字节 → UTF-8 文本（还原原文）
    return bytesToStr(byteReverseBytes(hexToBytes(t)));
  },
  detect: () => 0,
});

export {
  strToBytes, bytesToStr, bytesToHex, hexToBytes,
  reverseByte, bitReverseBytes,
  rotLeftByte, rotRightByte, bitRotateBytes,
  byteSwapBytes, byteSwapHexIO,
  bitPlane,
  ror13Dword, ror13HashBytes, modInverse256, byteArithBytes,
  byteReverseBytes,
};
