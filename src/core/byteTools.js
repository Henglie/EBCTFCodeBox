/*
 * byteTools.js — UUID / VarInt / 字节序工具组（cat:'radix'）。
 *
 * 收录：
 * uuidParse UUID 解析（run 单向）：版本/变体/时间戳(v1)/MAC(v1)/命名空间说明
 * varint Protobuf LEB128 变长整数编解码（双向，支持无符号 + ZigZag 有符号）
 *
 * 实现说明：UUID 按 RFC 4122 解析；LEB128 按 Protobuf 编码规范；字节序按 IEEE 754。
 * 纯本地计算。
 *
 * 参考：
 * - RFC 4122 "A Universally Unique IDentifier (UUID) URN Namespace"
 * - Protobuf Encoding: https://protobuf.dev/programming-guides/encoding/（LEB128）
 * - Wikipedia "LEB128"
 *
 * 契约：register({id, cat:"radix", name, desc, params, encode?, decode?, run?})。
 */
import { register } from "./registry.js";

// ============================================================
// 工具：hex ↔ bytes
// ============================================================
function hexToBytes(s) {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("hex 长度必须为偶数（实为 " + clean.length + "）");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

// ============================================================
// 1. UUID 解析（run 单向）
// ============================================================
// UUID 格式：8-4-4-4-12 hex（带连字符），或 32 hex 无连字符
// 结构（RFC 4122）：
// time_low(32) - time_mid(16) - time_hi_and_version(16) - clock_seq_hi_res(8) clock_seq_low(8) - node(48)
// 版本：time_hi_and_version 的高 4 位
// 变体：clock_seq_hi_res 的高 3 位

const UUID_VERSION_NAMES = {
  1: "v1 时间戳（时间 + MAC 地址）",
  2: "v2 DCE Security（POSIX UID/GID）",
  3: "v3 命名空间 + 名字 MD5 哈希",
  4: "v4 随机生成",
  5: "v5 命名空间 + 名字 SHA-1 哈希",
  6: "v6 时间戳（字段重排序，便于字典序）",
  7: "v7 时间戳（Unix 毫秒 + 随机）",
  8: "v8 自定义",
};

const UUID_VARIANT_NAMES = {
  ncs: "NCS backward compatibility（0xx）",
  rfc4122: "RFC 4122 / ISO 11578（10x）",
  microsoft: "Microsoft Corporation（110x）",
  reserved: "保留（111x）",
};

// UUID v1 epoch：1582-10-15 00:00:00 UTC
const UUID_EPOCH_MS = Date.UTC(1582, 9, 15);

function uuidParse(text) {
  const s = String(text).trim().toLowerCase().replace(/[^0-9a-f]/g, "");
  if (s.length !== 32) {
    throw new Error("UUID 须为 32 hex 字符（带连字符 8-4-4-4-12 或无连字符），实为 " + s.length + " hex");
  }

 // 解析 16 字节
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(s.substr(i * 2, 2), 16);

 // 字段提取（big-endian）
  const timeLow = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]; // 32 位
  const timeMid = (bytes[4] << 8) | bytes[5]; // 16 位
  const timeHiAndVersion = (bytes[6] << 8) | bytes[7]; // 16 位
  const clockSeqHiReserved = bytes[8];
  const clockSeqLow = bytes[9];
  const node = bytes.slice(10, 16); // 48 位 MAC

 // 版本（高 4 位）
  const version = (timeHiAndVersion >>> 12) & 0xf;
 // 变体（clock_seq_hi_res 的高 3 位）
  let variant;
  const variantBits = (clockSeqHiReserved >>> 5) & 0x7;
  if ((variantBits & 0x4) === 0) variant = "ncs";
  else if ((variantBits & 0x6) === 0x4) variant = "rfc4122";
  else if ((variantBits & 0x7) === 0x6) variant = "microsoft";
  else variant = "reserved";

 // 格式化 UUID（标准 8-4-4-4-12）
  const hex = s;
  const formatted =
    hex.substr(0, 8) + "-" + hex.substr(8, 4) + "-" + hex.substr(12, 4) + "-" + hex.substr(16, 4) + "-" + hex.substr(20, 12);

 // 构造报告
  const lines = [];
  lines.push("UUID: " + formatted);
  lines.push("版本: " + (UUID_VERSION_NAMES[version] || "未知（v" + version + "）"));
  lines.push("变体: " + UUID_VARIANT_NAMES[variant]);

 // v1: 时间戳 + MAC
  if (version === 1) {
 // time_hi 的低 12 位
    const timeHi = timeHiAndVersion & 0x0fff;
 // 60 位时间戳（100ns 间隔，从 1582-10-15）
    const timestamp = (BigInt(timeHi) << 48n) | (BigInt(timeMid) << 32n) | BigInt(timeLow >>> 0);
    const ms = UUID_EPOCH_MS + Number(timestamp / 10000n);
    const d = new Date(ms);
    lines.push("时间戳: " + d.toISOString() + " (UTC)");
    lines.push("时间戳(100ns): " + timestamp.toString());
 // MAC 地址
    const mac = [...node].map((b) => b.toString(16).padStart(2, "0")).join(":");
    lines.push("MAC 地址: " + mac);
 // clock_seq
    const clockSeq = ((clockSeqHiReserved & 0x3f) << 8) | clockSeqLow;
    lines.push("时钟序列: " + clockSeq);
  }

 // v7: Unix 毫秒时间戳
  if (version === 7) {
 // 前 48 位是 Unix 毫秒
    const ms = (BigInt(bytes[0]) << 40n) | (BigInt(bytes[1]) << 32n) |
               (BigInt(bytes[2]) << 24n) | (BigInt(bytes[3]) << 16n) |
               (BigInt(bytes[4]) << 8n) | BigInt(bytes[5]);
    const d = new Date(Number(ms));
    lines.push("时间戳: " + d.toISOString() + " (UTC)");
    lines.push("Unix 毫秒: " + ms.toString());
  }

 // v3/v5: 命名空间哈希（无法逆推命名空间，仅说明）
  if (version === 3 || version === 5) {
    lines.push("说明: 命名空间 UUID + 名字的 " + (version === 3 ? "MD5" : "SHA-1") + " 哈希，无法逆推原命名空间和名字");
  }

 // v4: 随机
  if (version === 4) {
    lines.push("说明: 随机生成（除版本和变体位外，其余位全随机）");
  }

  return lines.join("\n");
}

// ============================================================
// 2. VarInt（LEB128 变长整数编解码，双向）
// ============================================================
// 无符号 LEB128 (ULEB128)：
// 每字节最高位是 continuation（1=还有后续，0=结束），低 7 位是数据，小端序
// 有符号 LEB128 (ZigZag)：
// 先 ZigZag 编码（n → (n << 1) ^ (n >> 63)），再 ULEB128
// 解码：先 ULEB128 解码，再 ZigZag 解码

function zigzagEncode(n) {
 // BigInt ZigZag: (n << 1) ^ (n >> 63n)，但 JS BigInt 的 >> 是算术右移
  if (n >= 0n) return n * 2n;
  return (-n) * 2n - 1n;
}
function zigzagDecode(n) {
  if (n % 2n === 0n) return n / 2n;
  return -(n + 1n) / 2n;
}

function uleb128Encode(num) {
  if (num < 0n) throw new Error("无符号 LEB128 不支持负数（请用 ZigZag 模式）");
  if (num === 0n) return [0];
  const bytes = [];
  let n = num;
  while (n > 0n) {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n > 0n) b |= 0x80; // continuation
    bytes.push(b);
  }
  return bytes;
}

function uleb128Decode(bytes) {
  let result = 0n;
  let shift = 0n;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value: result, bytesRead: i + 1 };
    shift += 7n;
  }
  throw new Error("LEB128 输入不完整（缺终止字节）");
}

function varintEncode(text, p) {
  const signed = p && p.signed;
  let n;
  try {
    n = BigInt(String(text).trim());
  } catch {
    throw new Error("输入不是合法整数: " + text);
  }
  if (signed) n = zigzagEncode(n);
  const bytes = uleb128Encode(n);
  return bytesToHex(bytes);
}

function varintDecode(text, p) {
  const signed = p && p.signed;
  const bytes = hexToBytes(text);
  const { value } = uleb128Decode(bytes);
  const result = signed ? zigzagDecode(value) : value;
  return result.toString();
}

// ============================================================
// 注册
// ============================================================
register({
  id: "uuidParse",
  cat: "radix",
  name: "UUID 解析",
  desc: "UUID v1-v8 解析（版本/变体/时间戳/MAC/命名空间说明，RFC 4122）",
  params: [],
  run: uuidParse,
});

register({
  id: "varint",
  cat: "radix",
  name: "VarInt (LEB128)",
  desc: "Protobuf LEB128 变长整数编解码（无符号 + ZigZag 有符号，BigInt 支持大数）",
  params: [
    { key: "signed", label: "ZigZag 有符号", type: "bool", default: false },
  ],
  encode: varintEncode,
  decode: varintDecode,
});
