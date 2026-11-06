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
import { finishBytesDecode, decodeUtf8Lossy } from "./bytesIo.js";

// ============ 字符串 / 字节 / Hex 工具 ============
function strToBytes(s) {
  return new TextEncoder().encode(String(s));
}
// 保留导出面：有损解码实现已收敛到 bytesIo（全仓唯一一处 fatal:false）。
// 注意：decode 出口**不再**用它 —— 那里用 finishBytesDecode，否则会静默产出 U+FFFD。
function bytesToStr(b) {
  return decodeUtf8Lossy(b);
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
function byteSwapBytes(bytes, group, pad = false) {
  group = group | 0;
  if (group < 1) group = 1;
  const out = new Uint8Array(pad ? Math.ceil(bytes.length / group) * group : bytes.length);
  for (let i = 0; i < bytes.length; i += group) {
    const end = Math.min(i + group, bytes.length);
    const len = end - i;
    if (pad && len < group) {
      // CyberChef：末组先补 0 到 wordLength，再整组反转
      const word = new Uint8Array(group);
      word.set(bytes.subarray(i, end));
      for (let j = 0; j < group; j++) out[i + j] = word[group - 1 - j];
    } else {
      for (let j = 0; j < len; j++) out[i + j] = bytes[end - 1 - j];
    }
  }
  return out;
}

// hex↔hex 端序交换（复刻原 endianSwap；group 任意 ≥1；pad=true 时末组补 0）
function byteSwapHexIO(text, group, pad = false) {
  group = group | 0;
  if (group < 1) throw new Error("Word length 须 ≥1（实为 " + group + "）");
  const bytes = hexToBytes(text);
  return bytesToHex(byteSwapBytes(bytes, group, pad));
}

// 跨字节 carry 循环旋转（CyberChef Rotate.mjs 同构）
function rotRightCarry(bytes, amount) {
  amount = ((amount % 8) + 8) % 8;
  const out = new Uint8Array(bytes.length);
  let carry = 0;
  for (let i = 0; i < bytes.length; i++) {
    const old = bytes[i];
    out[i] = ((old >> amount) | carry) & 0xff;
    carry = (old & ((1 << amount) - 1)) << (8 - amount);
  }
  if (out.length) out[0] |= carry;
  return out;
}
function rotLeftCarry(bytes, amount) {
  amount = ((amount % 8) + 8) % 8;
  const out = new Uint8Array(bytes.length);
  let carry = 0;
  for (let i = bytes.length - 1; i >= 0; i--) {
    const old = bytes[i];
    out[i] = ((old << amount) | carry) & 0xff;
    carry = (old >> (8 - amount)) & ((1 << amount) - 1);
  }
  if (out.length) out[out.length - 1] |= carry;
  return out;
}
// 整串 Reverse by：byte / character（UTF-8 字符，含代理对）/ line（按 0x0a 分行）
function byteReverseBy(bytes, by) {
  if (by === "line") {
    const lines = [];
    let line = [];
    for (const b of bytes) {
      if (b === 0x0a) { lines.push(line); line = []; } else line.push(b);
    }
    lines.push(line);
    lines.reverse();
    const out = [];
    for (const l of lines) { out.push(...l, 0x0a); }
    return Uint8Array.from(out.slice(0, bytes.length));
  }
  if (by === "character") {
    const s = bytesToStr(bytes);
    let r = "";
    for (let i = s.length - 1; i >= 0; i--) {
      const c = s.charCodeAt(i);
      if (i > 0 && 0xdc00 <= c && c <= 0xdfff) {
        const c2 = s.charCodeAt(i - 1);
        if (0xd800 <= c2 && c2 <= 0xdbff) { r += s.charAt(i - 1) + s.charAt(i); i--; continue; }
      }
      r += s.charAt(i);
    }
    return strToBytes(r);
  }
  return byteReverseBytes(bytes);
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
// CC BitwiseOp 的 key 语义：key 是字节数组，不是单个数字。
// keyEnc 决定 keyText 的读法；keyAlign=right 时左侧补 0 对齐，否则按周期重复。
function parseByteArithKey(p) {
  const enc = (p && p.keyEnc) || "Decimal";
  const raw = (p && p.keyText != null && p.keyText !== "") ? String(p.keyText) : String((p && p.key != null) ? p.key : 1);
  let bytes;
  if (enc === "Decimal") {
    bytes = raw.split(/[\s,]+/).filter(Boolean).map((s) => {
      const n = Number(s);
      if (!Number.isInteger(n) || n < -128 || n > 255) throw new Error("byteArith Decimal key 字节须为 -128..255（实为 " + s + "）");
      return n < 0 ? n + 256 : n;
    });
  } else if (enc === "Hex") {
    const s = raw.replace(/0x/gi, "").replace(/[\s,]/g, "");
    if (s.length === 0) throw new Error("byteArith Hex key 为空");
    if (s.length % 2) throw new Error("byteArith Hex key 长度须为偶数（实为 " + s.length + "）");
    bytes = [];
    for (let i = 0; i < s.length; i += 2) bytes.push(parseInt(s.slice(i, i + 2), 16));
  } else if (enc === "Binary") {
    const s = raw.replace(/0x/gi, "").replace(/[\s,]/g, "");
    if (!/^[01]+$/.test(s)) throw new Error("byteArith Binary key 只能含 0/1");
    const g = [];
    for (let i = 0; i < s.length; i += 8) g.push(s.slice(i, i + 8));
    bytes = g.map((b) => parseInt(b.padEnd(8, "0"), 2));
  } else if (enc === "Base64") {
    const bin = atob(raw.replace(/\s/g, ""));
    bytes = [...bin].map((c) => c.charCodeAt(0));
  } else if (enc === "Latin1") {
    bytes = [...raw].map((c) => c.charCodeAt(0) & 0xff);
  } else if (enc === "UTF8") {
    bytes = [...new TextEncoder().encode(raw)];
  } else {
    throw new Error("byteArith keyEnc 须为 Hex/Decimal/Binary/Base64/UTF8/Latin1（实为 " + enc + "）");
  }
  if (!bytes.length) throw new Error("byteArith key 不能为空（not 模式除外）");
  return bytes;
}
function alignByteKey(keyBytes, len, align) {
  if (align === "right") {
    if (keyBytes.length >= len) return keyBytes.slice(keyBytes.length - len);
    const out = new Array(len - keyBytes.length).fill(0);
    return out.concat(keyBytes);
  }
  return Array.from({ length: len }, (_, i) => keyBytes[i % keyBytes.length]);
}
function byteArithBytes(bytes, op, key, keyAlign) {
  const keyBytes = Array.isArray(key) ? key : null;
  const k = keyBytes ? 0 : ((Number(key) % 256) + 256) % 256;
  const keys = keyBytes ? alignByteKey(keyBytes, bytes.length, keyAlign) : null;
  const out = new Uint8Array(bytes.length);
  const at = (i) => (keys ? keys[i] : k);
  if (op === "add") {
    for (let i = 0; i < bytes.length; i++) out[i] = (bytes[i] + at(i)) & 0xff;
  } else if (op === "sub") {
    for (let i = 0; i < bytes.length; i++) out[i] = (bytes[i] - at(i) + 256) & 0xff;
  } else if (op === "mul") {
    for (let i = 0; i < bytes.length; i++) out[i] = (bytes[i] * at(i)) & 0xff;
  } else if (op === "and") {
    for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] & at(i);
  } else if (op === "or") {
    for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] | at(i);
  } else if (op === "not") {
    for (let i = 0; i < bytes.length; i++) out[i] = ~bytes[i] & 0xff;
  } else {
    throw new Error("byteArith 未知操作: " + op + "（合法: add/sub/mul/and/or/not）");
  }
  return out;
}
// decode 侧：逆运算。and/or/not 不是一一映射，CC 同 op 只有单向 run；项目保持 encode/decode 双函数，
// 对这三档 decode 与 encode 同语义（并在帮助文案中标注「逻辑档 decode 不还原」）。
function byteArithDecodeOp(bytes, op, key, keyAlign) {
  if (op === "and" || op === "or" || op === "not") return byteArithBytes(bytes, op, key, keyAlign);
  const invOp = op === "add" ? "sub" : op === "sub" ? "add" : "mul";
  if (Array.isArray(key)) {
    const invKey = op === "mul" ? key.map((k) => modInverse256(k)) : key;
    return byteArithBytes(bytes, invOp, invKey, keyAlign);
  }
  const invKey = op === "mul" ? modInverse256(Number(key)) : key;
  return byteArithBytes(bytes, invOp, invKey, keyAlign);
}

// 1. bitReverse（自逆变换）
register({
  id: "bitReverse", cat: "radix", name: "位反转",
  desc: "每字节 8 位镜像翻转（bit 0↔7, 1↔6...）。encode: 文本→Hex；decode: Hex→文本。自逆变换。",
  params: [],
  encode: (t) => bytesToHex(bitReverseBytes(strToBytes(t))),
  decode: (t) => finishBytesDecode(bitReverseBytes(hexToBytes(t)), { textMode: "hex", name: "bitReverse" }),
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
    { key: "carryThrough", label: "Carry through（跨字节 carry）", type: "bool", default: false },
  ],
  encode: (t, p) => {
    const dir = (p && p.dir) || "left";
    const n = Number((p && p.bits) || 1);
    const bytes = strToBytes(t);
    return bytesToHex((p && p.carryThrough)
      ? (dir === "right" ? rotRightCarry(bytes, n) : rotLeftCarry(bytes, n))
      : bitRotateBytes(bytes, dir, n));
  },
  decode: (t, p) => {
    const dir = (p && p.dir) || "left";
    const n = Number((p && p.bits) || 1);
    const inv = dir === "right" ? "left" : "right";
    const bytes = hexToBytes(t);
    return finishBytesDecode((p && p.carryThrough)
      ? (inv === "right" ? rotRightCarry(bytes, n) : rotLeftCarry(bytes, n))
      : bitRotateBytes(bytes, inv, n), { textMode: "hex", name: "bitRotate" });
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
      { value: "raw", label: "Raw ↔ Raw（同 CyberChef Data format=Raw）" },
    ] },
    { key: "group", label: "分组字节数", type: "select", default: 2, options: [
      { value: 2, label: "2 字节（16 位）" },
      { value: 4, label: "4 字节（32 位）" },
      { value: 8, label: "8 字节（64 位）" },
    ] },
    { key: "wordLength", label: "Word length（字节，0=用分组档）", type: "number", default: 0, placeholder: "0 = 按分组档" },
    { key: "padIncomplete", label: "Pad incomplete words（末组补 0）", type: "bool", default: false },
  ],
  encode: (t, p) => {
    const group = Number((p && p.wordLength) || (p && p.group) || 2);
    if (p && p.mode === "hex") return byteSwapHexIO(t, group, !!(p && p.padIncomplete));
    if (p && p.mode === "raw") {
      const out = byteSwapBytes(strToBytes(t), group, !!(p && p.padIncomplete));
      let s = ""; for (const b of out) s += String.fromCharCode(b);
      return s;
    }
    return bytesToHex(byteSwapBytes(strToBytes(t), group, !!(p && p.padIncomplete)));
  },
  decode: (t, p) => {
    const group = Number((p && p.wordLength) || (p && p.group) || 2);
    if (p && p.mode === "hex") return byteSwapHexIO(t, group, !!(p && p.padIncomplete));
    if (p && p.mode === "raw") {
      const out = byteSwapBytes(strToBytes(t), group, !!(p && p.padIncomplete));
      let s = ""; for (const b of out) s += String.fromCharCode(b);
      return s;
    }
    return finishBytesDecode(byteSwapBytes(hexToBytes(t), group, !!(p && p.padIncomplete)), { textMode: "hex", name: "byteSwap" });
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
const BYTE_ARITH_KEYENC = [
  { value: "Hex", label: "Hex" },
  { value: "Decimal", label: "Decimal" },
  { value: "Binary", label: "Binary" },
  { value: "Base64", label: "Base64" },
  { value: "UTF8", label: "UTF8" },
  { value: "Latin1", label: "Latin1" },
];
function byteArithReadParams(p) {
  const op = (p && p.op) || "add";
  const key = op === "not" ? null : parseByteArithKey(p);
  return { op, key, keyAlign: (p && p.keyAlign) || "left" };
}
register({
  id: "byteArith", cat: "modern", name: "字节算术 (mod 256)",
  desc: "逐字节算术/位运算。算术档 add/sub/mul 模 256 可逆（mul 仅奇数 key 有逆元）；位运算档 and/or/not 为 CC BitwiseOp 语义（decode 不还原）。key 支持 Hex/Decimal/Binary/Base64/UTF8/Latin1 字节数组，left=周期重复、right=左补 0 对齐。",
  params: [
    { key: "op", label: "运算", type: "select", default: "add",
      options: [
        { value: "add", label: "加 (x + key)" },
        { value: "sub", label: "减 (x - key)" },
        { value: "mul", label: "乘 (x * key)" },
        { value: "and", label: "AND (x & key)" },
        { value: "or", label: "OR (x | key)" },
        { value: "not", label: "NOT (~x，忽略 key)" },
      ] },
    { key: "key", label: "key 单字节（Decimal 且 keyText 留空时生效，0-255）", type: "number", default: 1 },
    { key: "keyText", label: "key 字节数组（留空用 key；按 keyEnc 解析）", type: "text", default: "", placeholder: "如 Decimal: 1 2 3；Hex: 010203" },
    { key: "keyEnc", label: "key 编码", type: "select", default: "Decimal", options: BYTE_ARITH_KEYENC },
    { key: "keyAlign", label: "key 对齐", type: "select", default: "left",
      options: [
        { value: "left", label: "left（周期重复）" },
        { value: "right", label: "right（左补 0 对齐）" },
      ] },
  ],
  encode: (t, p) => {
    const r = byteArithReadParams(p);
    return bytesToHex(byteArithBytes(strToBytes(t), r.op, r.key, r.keyAlign));
  },
  decode: (t, p) => {
    const r = byteArithReadParams(p);
    return finishBytesDecode(byteArithDecodeOp(hexToBytes(t), r.op, r.key, r.keyAlign), { textMode: "hex", name: "byteArith" });
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
    { key: "by", label: "By（Byte / Character / Line）", type: "select", default: "byte",
      options: [
        { value: "byte", label: "Byte" },
        { value: "character", label: "Character" },
        { value: "line", label: "Line" },
      ] },
  ],
  encode: (t, p) => {
    const by = (p && p.by) || "byte";
    if (p && p.mode === "hex") return bytesToHex(byteReverseBy(hexToBytes(t), by));
    return bytesToHex(byteReverseBy(strToBytes(t), by));
  },
  decode: (t, p) => {
    const by = (p && p.by) || "byte";
    if (p && p.mode === "hex") return bytesToHex(byteReverseBy(hexToBytes(t), by));
    // 文本模式 decode：Hex → 倒序字节 → UTF-8 文本（还原原文）
    return finishBytesDecode(byteReverseBy(hexToBytes(t), by), { textMode: "hex", name: "byteReverse" });
  },
  detect: () => 0,
});

export {
  strToBytes, bytesToStr, bytesToHex, hexToBytes,
  reverseByte, bitReverseBytes,
  rotLeftByte, rotRightByte, bitRotateBytes,
  byteSwapBytes, byteSwapHexIO, rotLeftCarry, rotRightCarry, byteReverseBy,
  bitPlane,
  ror13Dword, ror13HashBytes, modInverse256, byteArithBytes,
  byteReverseBytes,
};
