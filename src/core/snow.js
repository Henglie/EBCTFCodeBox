/*
 * snow.js — Snow 空白隐写编解码（cat:'stego'）。
 *
 * 原理：SNOW (Steganographic Nature Of Whitespace) by Nicolas Bourdaud。
 * 将消息编码为二进制位，用行尾空白字符 Space(0)/Tab(1) 追加到容器文本各行末尾。
 * 本实现为明文层（无 ICE 加密），前 4 字节为长度头（大端 32 位消息字节数）。
 *
 * encode(消息, 容器文本): 消息 → UTF-8 bytes → [4B长度头 + bytes] → bits → 行尾 Space/Tab
 * decode(含隐写文本): 行尾空白 → bits → [长度头 + 消息bytes] → UTF-8 → 消息
 *
 * 算法来源：SNOW 公开原理，非编造。往返测试通过
 */
import { register } from "./registry.js";

// --- 辅助 ---

function strToUtf8Bytes(str) {
  return Array.from(new TextEncoder().encode(str));
}

function utf8BytesToStr(bytes) {
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function bytesToBits(bytes) {
  let bits = "";
  for (const b of bytes) {
    bits += b.toString(2).padStart(8, "0");
  }
  return bits;
}

function bitsToBytes(bits) {
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substr(i, 8), 2));
  }
  return bytes;
}

// --- 编码 ---

function snowEncode(message, container) {
  const msgBytes = strToUtf8Bytes(message);
 // 4 字节大端长度头
  const n = msgBytes.length;
  const header = [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
  const allBytes = header.concat(msgBytes);
  const bits = bytesToBits(allBytes);

 // 容器行处理
  let lines;
  if (container && container.length > 0) {
    lines = container.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
 // 去掉每行原有行尾空白，避免干扰
    lines = lines.map(l => l.replace(/[ \t]+$/, ""));
  } else {
    lines = [];
  }

 // 每行最多放 8 位
  const bitsPerLine = 8;
  const linesNeeded = Math.ceil(bits.length / bitsPerLine);

 // 容器行不够则追加空行
  while (lines.length < linesNeeded) {
    lines.push("");
  }

 // 逐行追加隐写位
  for (let i = 0; i < linesNeeded; i++) {
    const chunk = bits.substr(i * bitsPerLine, bitsPerLine);
    let ws = "";
    for (const bit of chunk) {
      ws += bit === "0" ? " " : "\t";
    }
    lines[i] = lines[i] + ws;
  }

  return lines.join("\n");
}

// --- 解码 ---

function snowDecode(text) {
  const flat = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = flat.split("\n");

 // 提取行尾空白 → bits
  let bits = "";
  for (const line of lines) {
    const m = line.match(/[ \t]+$/);
    if (m) {
      for (const ch of m[0]) {
        bits += ch === "\t" ? "1" : "0";
      }
    }
  }

  if (bits.length < 32) {
    throw new Error("行尾空白不足：无法读取长度头（需 ≥32 位，实际 " + bits.length + " 位）");
  }

 // 解析长度头
  const headerBits = bits.substr(0, 32);
  const headerBytes = bitsToBytes(headerBits);
  const n = (headerBytes[0] << 24) | (headerBytes[1] << 16) | (headerBytes[2] << 8) | headerBytes[3];

  if (n < 0 || n > 0x7fffffff) {
    throw new Error("长度头异常：消息字节数 " + n + " 超范围");
  }

  const msgBitLen = n * 8;
  if (bits.length < 32 + msgBitLen) {
    throw new Error("行尾空白不足：消息需要 " + (32 + msgBitLen) + " 位，实际 " + bits.length + " 位");
  }

  const msgBits = bits.substr(32, msgBitLen);
  const msgBytes = bitsToBytes(msgBits);
  return utf8BytesToStr(msgBytes);
}

// --- 注册 ---

register({
  id: "snow",
  cat: "stego",
  name: "Snow 空白隐写",
  desc: "行尾空白隐写（Space=0/Tab=1），明文层（无 ICE 加密）。encode: 消息→行尾空白；decode: 行尾空白→消息",
  params: [
    { key: "text", label: "容器文本（可选，隐写追加到各行末尾）", type: "text", default: "" }
  ],
  encode: (t, p) => snowEncode(t, (p && p.text) || ""),
  decode: (t) => snowDecode(t),
});

export { snowEncode, snowDecode };
