/*
 * fengCodec.js — 风之暇想（52pojie uid=243467）编码算法组。
 *
 * 逐字复刻两款作者原创的纯前端文本编码工具（源码逐行核验，非猜测）：
 * - dxBase64 DXBase64（thread-2058510）：raw deflate + 2 字节随机 salt 循环 XOR
 * + CRC16 校验，组帧后标准 Base64。带校验、每次密文不同、无需密钥（防和谐）。
 * - yueChang 曰唱（github.com/fzxx/YueChang）：deflate(zlib) + PBKDF2-SHA256(10 万次)
 * + AES-GCM-256，标准 Base64 再逐字符映射为 65 个中文拟声字，前缀「唱：」。
 * 默认口令 YueChang（口令可空则回退默认）。「与佛论禅」拟声字体系的加密版分支。
 *
 * 复用浏览器原生：CompressionStream/DecompressionStream（deflate / deflate-raw）
 * WebCrypto subtle（PBKDF2 / AES-GCM）、getRandomValues。node 18+ 实验性可用。
 *
 * 契约：双向 encode/decode。两者 encode 均非确定性（随机 salt/iv）→ 每次输出不同
 * 靠 decode 往返验证 + 源码逐行比对保证正确性。
 *
 * 参考源码：
 * DXBase64 资料/_dxb64/DXBase64算法示例.html（© 2025 风之暇想）
 * 曰唱 github.com/fzxx/YueChang js/main.js
 */
import { register } from "./registry.js";
import { streamCompress, streamDecompress } from "./compress.js"; // v0.1.5：安全流（超时+纯JS兜底）

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

// ============================================================
// 通用：流式 deflate / inflate（deflate / deflate-raw）
// v0.1.5：代理 compress.js 安全流（DecompressionStream 超时竞速 + 纯 JS inflate 兜底，
// Chromium 原生流对部分合法 deflate 会无限挂死）。
// ============================================================
async function streamThrough(mode, format, bytes) {
  if (mode === "compress") return streamCompress(format, bytes);
  return streamDecompress(format, bytes);
}

// 字节 ↔ 标准 Base64（与源码 btoa/atob 等价）
function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function b64ToBytes(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

// ============================================================
// DXBase64（thread-2058510）
// ============================================================
// CRC16（源码原样：init 0xFFFF、多项式 0x1021 直接右移形式；encode/decode 同一函数）
function dxCrc16(bytes) {
  let crc = 0xFFFF;
  for (const v of bytes) {
    crc ^= v;
    for (let i = 0; i < 8; i++) {
      crc = (crc & 1) ? (crc >>> 1) ^ 0x1021 : crc >>> 1;
    }
  }
  return crc & 0xFFFF;
}

// encode：UTF-8 → raw deflate → 2 字节随机 salt 循环 XOR → CRC16 → 帧 [crcHi,crcLo,salt0,salt1,...xor] → Base64
async function dxEncode(text) {
  if (!text) return "";
  const bin = te(text);
  const com = await streamThrough("compress", "deflate-raw", bin);
  const salt = randomBytes(2);
  const xor = com.map((v, i) => v ^ salt[i % 2]);
  const crc = dxCrc16(xor);
  const frame = new Uint8Array(4 + xor.length);
  frame[0] = (crc >>> 8) & 0xFF;
  frame[1] = crc & 0xFF;
  frame[2] = salt[0];
  frame[3] = salt[1];
  frame.set(xor, 4);
  return bytesToB64(frame);
}

// decode：Base64 → 拆帧 → CRC16 校验 → salt 循环 XOR 还原 → raw inflate → UTF-8
async function dxDecode(text) {
  if (!text || !text.trim()) return "";
  const f = b64ToBytes(text.trim());
  if (f.length < 4) throw new Error("DXBase64 数据帧过短");
  const crcW = (f[0] << 8) | f[1];
  const salt = f.slice(2, 4);
  const xor = f.slice(4);
  if (dxCrc16(xor) !== crcW) throw new Error("DXBase64 数据校验失败（CRC16 不匹配）");
  const com = xor.map((v, i) => v ^ salt[i % 2]);
  const bin = await streamThrough("decompress", "deflate-raw", com);
  return td(bin);
}

// ============================================================
// 曰唱（github.com/fzxx/YueChang）
// ============================================================
// Base64 字符 → 中文拟声字（65 条，逐字抄自 js/main.js charMap.encrypt）
const SONG_MAP = {
  "A": "啊", "B": "嘶", "C": "呼", "D": "呀", "E": "嗞", "F": "哦", "G": "啪", "H": "啦",
  "I": "呐", "J": "嘎", "K": "噜", "L": "啾", "M": "唦", "N": "唧", "O": "哈", "P": "吧",
  "Q": "嗨", "R": "嗡", "S": "呱", "T": "呦", "U": "吱", "V": "咩", "W": "喵", "X": "欸",
  "Y": "吖", "Z": "喂",
  "a": "噫", "b": "呜", "c": "咕", "d": "唉", "e": "唻", "f": "呢", "g": "喏", "h": "咦",
  "i": "哪", "j": "哇", "k": "喔", "l": "唷", "m": "噢", "n": "嗬", "o": "耶", "p": "呵",
  "q": "嘀", "r": "叽", "s": "哞", "t": "嘟", "u": "嘻", "v": "哩", "w": "喽", "x": "叮",
  "y": "哎", "z": "咿",
  "0": "嗒", "1": "哟", "2": "喳", "3": "哒", "4": "咯", "5": "嘿", "6": "嘘", "7": "隆",
  "8": "呗", "9": "咚",
  "+": "呃", "/": "嘛", "=": "嗯",
};
const SONG_REV = (() => {
  const m = {};
  for (const [k, v] of Object.entries(SONG_MAP)) m[v] = k;
  return m;
})();
const YC_DEFAULT_PW = "YueChang";
const YC_PREFIX = "唱："; // 「唱」+ 全角冒号 U+FF1A

const replaceForSong = (str) => str.split("").map((c) => SONG_MAP[c] || c).join("");
const replaceForOriginal = (str) => str.split("").map((c) => SONG_REV[c] || c).join("");

// PBKDF2(口令, salt, 10 万次, SHA-256) → AES-GCM-256 密钥
async function ycDeriveKey(password, salt) {
  const subtle = globalThis.crypto.subtle;
  const km = await subtle.importKey("raw", te(password), { name: "PBKDF2" }, false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
}

// encode：deflate(zlib) → AES-GCM(salt8/iv12) → 帧 salt||iv||ct+tag → Base64 → 映射拟声字 → 「唱：」前缀
async function ycEncode(text, p) {
  if (!text) return "";
  const pw = (p && typeof p.password === "string" && p.password) || YC_DEFAULT_PW;
  const compressed = await streamThrough("compress", "deflate", te(text));
  const iv = randomBytes(12);
  const salt = randomBytes(8);
  const key = await ycDeriveKey(pw, salt);
  const enc = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, compressed));
  const combined = new Uint8Array(8 + 12 + enc.length);
  combined.set(salt, 0);
  combined.set(iv, 8);
  combined.set(enc, 20);
  return YC_PREFIX + replaceForSong(bytesToB64(combined));
}

// decode：去「唱：」→ 反查拟声字 → Base64 → 拆帧 → AES-GCM 解密 → deflate 解压 → UTF-8
async function ycDecode(text, p) {
  const pw = (p && typeof p.password === "string" && p.password) || YC_DEFAULT_PW;
  const t = (text || "").trim();
  if (t.substring(0, 2) !== YC_PREFIX) throw new Error("曰唱密文须以「唱：」开头");
  const b64 = replaceForOriginal(t.substring(2));
  const combined = b64ToBytes(b64);
  if (combined.length < 8 + 12 + 16) throw new Error("曰唱密文过短（不足 salt+iv+GCM tag）");
  const salt = combined.slice(0, 8);
  const iv = combined.slice(8, 20);
  const ct = combined.slice(20);
  const key = await ycDeriveKey(pw, salt);
  let dec;
  try {
    dec = new Uint8Array(await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
  } catch {
    throw new Error("曰唱解密失败（口令错误或密文损坏，GCM 认证不通过）");
  }
  return td(await streamThrough("decompress", "deflate", dec));
}

// ============================================================
// 注册
// ============================================================
register({
  id: "dxBase64", cat: "base", name: "DXBase64",
  desc: "风之暇想 DXBase64：raw deflate + 随机 salt 循环 XOR + CRC16 校验的 Base64 变体（带校验、每次密文不同、无需密钥，防和谐）",
  encode: dxEncode,
  decode: dxDecode,
});

register({
  id: "yueChang", cat: "cn", name: "曰唱",
  desc: "风之暇想 曰唱：deflate + PBKDF2-SHA256(10万次) + AES-GCM-256，Base64 逐字符映射为中文拟声字（前缀「唱：」，口令可空则用默认 YueChang）",
  params: [
    { key: "password", label: "口令", type: "text", default: "", placeholder: "留空用默认口令 YueChang" },
  ],
  encode: ycEncode,
  decode: ycDecode,
});

export { dxEncode, dxDecode, ycEncode, ycDecode, dxCrc16, SONG_MAP, SONG_REV };
