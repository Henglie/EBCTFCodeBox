/*
 * checksumExt.js — 校验和扩展组（T75，cat:'hash'）。
 *
 * 覆盖：
 * - crcGeneric：通用 CRC（参数化 width/poly/init/refIn/refOut/xorOut），覆盖 CRC-8/16/32
 * - crc16Modbus：CRC-16/MODBUS（poly=0x8005, init=0xFFFF, refIn/out=true, xorOut=0）
 * - crc16CcittTrue：CRC-16/CCITT-FALSE（poly=0x1021, init=0xFFFF, refIn/out=false, xorOut=0）
 * - crc16Arc：CRC-16/ARC（poly=0x8005, init=0x0000, refIn/out=true, xorOut=0）
 * - crc16Xmodem：CRC-16/XMODEM（poly=0x1021, init=0x0000, refIn/out=false, xorOut=0）
 * - fletcher16：Fletcher-16（RFC 905 等）
 * - fletcher32：Fletcher-32（按 16 位字小端，RFC 905）
 * - bsdSum：BSD checksum（4-bit rotated sum，BSD `sum` 命令）
 * - sysvSum：SysV checksum（16-bit sum + 折叠，SysV `sum` 命令）
 *
 * 算法标准：
 * - CRC：宽度位空间内的位运算（width ∈ [8,32]），反射用 reflect 函数。
 * - Fletcher-16：8 位字节流，模 255 累加，输出 (sum2<<8)|sum1。
 * - Fletcher-32：16 位字（小端），模 65535 累加，输出 (sum2<<16)|sum1。
 * - BSD sum：crc = (crc>>1) + ((crc&1)<<15) + b，16 位截断。
 * - SysV sum：累加 + 16 位折叠。
 *
 * 红线：
 * - CRC 多项式/初值照抄 CRC Catalog（reveng.com）不编造。
 * - 纯算法无外部依赖；输入 UTF-8 → 字节流。
 * - 全部 run 单向，输出十六进制（部分附加十进制）。
 */
import { register } from "./registry.js";

// ============ 通用工具 ============
function strToBytes(s) {
 // 允许 hex 输入（0x 前缀或纯 hex），否则 UTF-8
  const t = String(s).trim();
  if (/^0x[0-9a-fA-F]+$/.test(t)) {
    const hex = t.slice(2);
    const out = [];
    for (let i = 0; i < hex.length; i += 2) {
      out.push(parseInt(hex.substr(i, 2), 16));
    }
    return new Uint8Array(out);
  }
  if (/^[0-9a-fA-F]+$/.test(t) && t.length % 2 === 0 && t.length >= 2) {
 // 纯 hex 字符串（偶数长度 ≥2）当 hex 解
    const out = [];
    for (let i = 0; i < t.length; i += 2) {
      out.push(parseInt(t.substr(i, 2), 16));
    }
    return new Uint8Array(out);
  }
  return new TextEncoder().encode(s);
}

function parseHexOrDec(s) {
 // 解析数字（支持 0x 前缀十六进制 / 十进制）
  const t = String(s).trim();
  if (/^0x[0-9a-fA-F]+$/.test(t)) return parseInt(t.slice(2), 16);
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (n <= 0xFFFFFFFF) return n;
    return Number(t);
  }
  throw new Error("非法数字（支持十进制或 0x 十六进制）：" + s);
}

// ============ 反射函数 ============
function reflect8(b) {
  let r = 0;
  for (let i = 0; i < 8; i++) {
    if (b & (1 << i)) r |= (1 << (7 - i));
  }
  return r & 0xff;
}
function reflect(v, width) {
  let r = 0;
  for (let i = 0; i < width; i++) {
    if (v & (1 << i)) r |= (1 << (width - 1 - i));
  }
  return r;
}

// ============ 通用 CRC 计算 ============
// 参数：{ width, poly, init, refIn, refOut, xorOut }
// width ∈ [8, 32]
function crcCompute(bytes, opts) {
  const width = opts.width;
  if (width < 8 || width > 32) throw new Error("CRC width 须 ∈ [8,32]，得到 " + width);
  const mask = (width === 32) ? 0xFFFFFFFF : ((1 << width) - 1);
  const highBit = 1 << (width - 1);
  let crc = opts.init & mask;
  const poly = opts.poly & mask;
  for (const b of bytes) {
    const byte = opts.refIn ? reflect8(b) : b;
    crc ^= (byte << (width - 8)) & mask;
    for (let i = 0; i < 8; i++) {
      if (crc & highBit) {
        crc = ((crc << 1) ^ poly) & mask;
      } else {
        crc = (crc << 1) & mask;
      }
    }
  }
  if (opts.refOut) crc = reflect(crc, width);
  return (crc ^ opts.xorOut) & mask;
}

// ============ Fletcher-16 ============
function fletcher16(bytes) {
  let sum1 = 0, sum2 = 0;
  for (const b of bytes) {
    sum1 = (sum1 + b) % 255;
    sum2 = (sum2 + sum1) % 255;
  }
  return ((sum2 << 8) | sum1) & 0xFFFF;
}

// ============ Fletcher-32（16 位字小端） ============
function fletcher32(bytes) {
  let sum1 = 0, sum2 = 0;
  const MOD = 65535;
  const n = bytes.length;
  const even = n - (n % 2); // 处理偶数个字节
  let i = 0;
  while (i < even) {
    const word = bytes[i] | (bytes[i + 1] << 8);
    sum1 = (sum1 + word) % MOD;
    sum2 = (sum2 + sum1) % MOD;
    i += 2;
  }
 // 奇数尾字节补 0
  if (i < n) {
    const word = bytes[i];
    sum1 = (sum1 + word) % MOD;
    sum2 = (sum2 + sum1) % MOD;
  }
 // 标准输出：sum2 高 16 位 + sum1 低 16 位
  const r = ((sum2 << 16) | sum1) >>> 0;
  return r;
}

// ============ BSD sum ============
function bsdSum(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc = (crc >> 1) + ((crc & 1) << 15) + b;
    crc = crc & 0xFFFF;
  }
  return crc & 0xFFFF;
}

// ============ SysV sum ============
function sysvSum(bytes) {
  let s = 0;
  for (const b of bytes) {
    s += b;
  }
  s = (s & 0xFFFF) + (s >>> 16);
  s = (s & 0xFFFF) + (s >>> 16);
  return s & 0xFFFF;
}

// ============ 格式化输出 ============
function toHex(n, width) {
 // width = CRC 位宽 → hex 字符数
  const chars = Math.ceil(width / 4);
 // >>> 0 把 32 位有符号整数转无符号（修复 CRC-32 负数 hex 问题）
  return (n >>> 0).toString(16).toUpperCase().padStart(chars, "0");
}

// ============ 注册 op ============

// 1. crcGeneric：通用 CRC（参数化 width/poly/init/refIn/refOut/xorOut）
const CRC_PRESETS = [
  { value: "custom", label: "自定义" },
  { value: "crc16Modbus", label: "CRC-16/MODBUS (poly=0x8005,init=0xFFFF,ref)" },
  { value: "crc16CcittFalse", label: "CRC-16/CCITT-FALSE (poly=0x1021,init=0xFFFF,noref)" },
  { value: "crc16Arc", label: "CRC-16/ARC (poly=0x8005,init=0x0000,ref)" },
  { value: "crc16Xmodem", label: "CRC-16/XMODEM (poly=0x1021,init=0x0000,noref)" },
  { value: "crc32", label: "CRC-32/ISO-HDLC (poly=0x04C11DB7,init=0xFFFFFFFF,ref,xor=0xFFFFFFFF)" },
  { value: "crc32c", label: "CRC-32C (poly=0x1EDC6F41,init=0xFFFFFFFF,ref,xor=0xFFFFFFFF)" },
];
const CRC_PRESET_MAP = {
  crc16Modbus: { width: 16, poly: 0x8005, init: 0xFFFF, refIn: true, refOut: true, xorOut: 0x0000 },
  crc16CcittFalse: { width: 16, poly: 0x1021, init: 0xFFFF, refIn: false, refOut: false, xorOut: 0x0000 },
  crc16Arc: { width: 16, poly: 0x8005, init: 0x0000, refIn: true, refOut: true, xorOut: 0x0000 },
  crc16Xmodem: { width: 16, poly: 0x1021, init: 0x0000, refIn: false, refOut: false, xorOut: 0x0000 },
  crc32: { width: 32, poly: 0x04C11DB7, init: 0xFFFFFFFF, refIn: true, refOut: true, xorOut: 0xFFFFFFFF },
  crc32c: { width: 32, poly: 0x1EDC6F41, init: 0xFFFFFFFF, refIn: true, refOut: true, xorOut: 0xFFFFFFFF },
};

register({
  id: "crcGeneric", cat: "hash", name: "通用 CRC（参数化）",
  desc: "CRC 通用计算（width/poly/init/refIn/refOut/xorOut 可配置，含 CRC-16/CRC-32 常用预设）。run 单向，输出十六进制",
  params: [
    { key: "preset", label: "预设", type: "select", default: "crc16Modbus", options: CRC_PRESETS },
    { key: "width", label: "位宽（8/16/32，自定义时生效）", type: "number", default: 16, placeholder: "8/16/32" },
    { key: "poly", label: "多项式（0x 十六进制）", type: "text", default: "0x8005", placeholder: "如 0x1021" },
    { key: "init", label: "初值（0x 十六进制）", type: "text", default: "0xFFFF", placeholder: "如 0xFFFF" },
    { key: "refIn", label: "输入反射", type: "bool", default: true },
    { key: "refOut", label: "输出反射", type: "bool", default: true },
    { key: "xorOut", label: "输出异或（0x 十六进制）", type: "text", default: "0x0000", placeholder: "如 0x0000" },
  ],
  run: function (t, p) {
    const bytes = strToBytes(t);
    let opts;
    if (p.preset && p.preset !== "custom" && CRC_PRESET_MAP[p.preset]) {
      opts = CRC_PRESET_MAP[p.preset];
    } else {
      const width = Math.floor(Number(p.width) || 16);
      opts = {
        width: width,
        poly: parseHexOrDec(p.poly != null ? p.poly : "0x8005"),
        init: parseHexOrDec(p.init != null ? p.init : "0xFFFF"),
        refIn: p.refIn !== false,
        refOut: p.refOut !== false,
        xorOut: parseHexOrDec(p.xorOut != null ? p.xorOut : "0x0000"),
      };
    }
    const crc = crcCompute(bytes, opts);
    return toHex(crc, opts.width) + "  // " + crc + " (width=" + opts.width + ")";
  },
});

// 2. crc16Modbus：CRC-16/MODBUS
register({
  id: "crc16Modbus", cat: "hash", name: "CRC-16/MODBUS",
  desc: "CRC-16/MODBUS（poly=0x8005, init=0xFFFF, refIn/refOut=true, xorOut=0x0000，Modbus RTU 用）",
  params: [],
  run: function (t) {
    const crc = crcCompute(strToBytes(t), CRC_PRESET_MAP.crc16Modbus);
    return toHex(crc, 16) + "  // " + crc;
  },
});

// 3. crc16CcittTrue：CRC-16/CCITT-FALSE
register({
  id: "crc16CcittTrue", cat: "hash", name: "CRC-16/CCITT-FALSE",
  desc: "CRC-16/CCITT-FALSE（poly=0x1021, init=0xFFFF, refIn/refOut=false, xorOut=0x0000）",
  params: [],
  run: function (t) {
    const crc = crcCompute(strToBytes(t), CRC_PRESET_MAP.crc16CcittFalse);
    return toHex(crc, 16) + "  // " + crc;
  },
});

// 4. crc16Arc：CRC-16/ARC
register({
  id: "crc16Arc", cat: "hash", name: "CRC-16/ARC",
  desc: "CRC-16/ARC（poly=0x8005, init=0x0000, refIn/refOut=true, xorOut=0x0000，LHA/ARC 用）",
  params: [],
  run: function (t) {
    const crc = crcCompute(strToBytes(t), CRC_PRESET_MAP.crc16Arc);
    return toHex(crc, 16) + "  // " + crc;
  },
});

// 5. crc16Xmodem：CRC-16/XMODEM
register({
  id: "crc16Xmodem", cat: "hash", name: "CRC-16/XMODEM",
  desc: "CRC-16/XMODEM（poly=0x1021, init=0x0000, refIn/refOut=false, xorOut=0x0000，XMODEM 协议用）",
  params: [],
  run: function (t) {
    const crc = crcCompute(strToBytes(t), CRC_PRESET_MAP.crc16Xmodem);
    return toHex(crc, 16) + "  // " + crc;
  },
});

// 6. fletcher（16/32 合并）
register({
  id: "fletcher", cat: "hash", name: "Fletcher",
  desc: "Fletcher 校验和（位宽可选 16/32；16 位按字节流模 255，32 位按 16 位字小端模 65535）",
  params: [
    { key: "bits", label: "输出位数", type: "select", default: 16, options: [
      { value: 16, label: "16" },
      { value: 32, label: "32" },
    ] },
  ],
  run: function (t, p) {
    const bits = Number((p && p.bits != null) ? p.bits : 16);
    if (bits === 32) {
      const v = fletcher32(strToBytes(t));
      return toHex(v, 32) + "  // " + v;
    }
    const v = fletcher16(strToBytes(t));
    return toHex(v, 16) + "  // " + v;
  },
});

// 8. bsdSum
register({
  id: "bsdSum", cat: "hash", name: "BSD checksum",
  desc: "BSD checksum（4-bit rotated sum，BSD `sum` 命令，输出 16 位）",
  params: [],
  run: function (t) {
    const v = bsdSum(strToBytes(t));
    return toHex(v, 16) + "  // " + v;
  },
});

// 9. sysvSum
register({
  id: "sysvSum", cat: "hash", name: "SysV checksum",
  desc: "SysV checksum（16 位累加 + 折叠，SysV `sum` 命令，输出 16 位）",
  params: [],
  run: function (t) {
    const v = sysvSum(strToBytes(t));
    return toHex(v, 16) + "  // " + v;
  },
});

export {
  crcCompute, fletcher16, fletcher32, bsdSum, sysvSum,
  reflect8, reflect, strToBytes, parseHexOrDec, toHex,
  CRC_PRESET_MAP, CRC_PRESETS,
};
