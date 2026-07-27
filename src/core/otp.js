/*
 * otp.js — 一次性密码组。
 *
 * 覆盖：HOTP（RFC 4226，HMAC-SHA1 + 动态截断）/ TOTP（RFC 6238，HOTP + 时间步长）。
 * HMAC 走 WebCrypto subtle.sign（globalThis.crypto.subtle，浏览器/Node 一致）
 * 动态截断纯 JS。与 hash.js 解耦，自写工具。
 *
 * 契约：单向 run(text, params) → OTP 数字串（左侧补 0 到 digits 位）。
 * input 文本 = 密钥 secret（默认按 Base32 解析，OTP 生态标准；可选 hex/utf8）。
 * HOTP：counter/digits/algo 为参数。
 * TOTP：period/time/digits/algo 为参数，time=0 表示用当前 Unix 时间。
 *
 * 权威向量：
 * HOTP RFC 4226 附录 D（secret="12345678901234567890" ASCII）。
 * TOTP RFC 6238 附录 B（SHA1/256/512 三种 seed）。
 * 用 RFC 4226/6238 附录官方向量对拍验证。
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(s);

// RFC 4648 Base32 解码（大写，忽略空白与 = 填充）。
function base32Decode(str) {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const s = (str || "").toUpperCase().replace(/[=\s]/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s) {
    const idx = alpha.indexOf(ch);
    if (idx === -1) throw new Error(`Base32 非法字符: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

// hex 解码
function hexDecode(str) {
  const s = (str || "").replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

// 按格式取密钥字节
function secretBytes(str, fmt) {
  if (fmt === "hex") return hexDecode(str);
  if (fmt === "utf8") return te(str);
  return base32Decode(str); // 默认 base32
}

// WebCrypto HMAC 签名
async function hmacSign(algo, keyBytes, msgBytes) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto");
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: algo }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, msgBytes);
  return new Uint8Array(sig);
}

// HOTP 核心：counter（BigInt）→ digits 位数字串（RFC 4226 动态截断）
async function hotpCore(keyBytes, counter, digits, algo) {
 // 8 字节大端计数器
  const msg = new Uint8Array(8);
  let c = BigInt(counter) & 0xFFFFFFFFFFFFFFFFn;
  for (let i = 7; i >= 0; i--) {
    msg[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  const hs = await hmacSign(algo, keyBytes, msg);
 // 动态截断
  const offset = hs[hs.length - 1] & 0x0f;
  const binCode =
    ((hs[offset] & 0x7f) << 24) |
    ((hs[offset + 1] & 0xff) << 16) |
    ((hs[offset + 2] & 0xff) << 8) |
    (hs[offset + 3] & 0xff);
  const mod = 10 ** digits;
  return String(binCode % mod).padStart(digits, "0");
}

async function hotp(secret, p) {
  const keyBytes = secretBytes(secret, (p && p.format) || "base32");
  const counter = (p && p.counter != null) ? p.counter : 0;
  const digits = Math.max(1, Math.min(10, (p && p.digits | 0) || 6));
  const algo = (p && p.algo) || "SHA-1";
  return hotpCore(keyBytes, counter, digits, algo);
}

async function totp(secret, p) {
  const keyBytes = secretBytes(secret, (p && p.format) || "base32");
  const period = Math.max(1, (p && p.period | 0) || 30);
  const digits = Math.max(1, Math.min(10, (p && p.digits | 0) || 6));
  const algo = (p && p.algo) || "SHA-1";
 // time=0 → 当前 Unix 时间；否则用给定值（供 RFC 向量测试）
  const now = (p && p.time) ? Number(p.time) : Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / period);
  return hotpCore(keyBytes, counter, digits, algo);
}

// ============ 参数声明公用片段 ============
const FORMAT_OPTIONS = [
  { value: "base32", label: "Base32（OTP 标准）" },
  { value: "hex", label: "十六进制" },
  { value: "utf8", label: "UTF-8 文本" },
];
const ALGO_OPTIONS = [
  { value: "SHA-1", label: "SHA-1（默认）" },
  { value: "SHA-256", label: "SHA-256" },
  { value: "SHA-512", label: "SHA-512" },
];

// ============ 注册 ============
register({
  id: "hotp", cat: "modern", name: "HOTP",
  desc: "HOTP 计数器一次性密码（RFC 4226，input=密钥；HMAC + 动态截断）",
  params: [
    { key: "format", label: "密钥格式", type: "select", default: "base32", options: FORMAT_OPTIONS },
    { key: "counter", label: "计数器", type: "number", default: 0, placeholder: "计数器值" },
    { key: "digits", label: "位数", type: "number", default: 6, placeholder: "6-8" },
    { key: "algo", label: "HMAC 算法", type: "select", default: "SHA-1", options: ALGO_OPTIONS },
  ],
  run: (t, p) => hotp(t, p || {}),
});

register({
  id: "totp", cat: "modern", name: "TOTP",
  desc: "TOTP 时间一次性密码（RFC 6238，input=密钥；time=0 用当前时间）",
  params: [
    { key: "format", label: "密钥格式", type: "select", default: "base32", options: FORMAT_OPTIONS },
    { key: "period", label: "时间步长(秒)", type: "number", default: 30, placeholder: "默认 30" },
    { key: "time", label: "Unix 时间", type: "number", default: 0, placeholder: "0=当前时间" },
    { key: "digits", label: "位数", type: "number", default: 6, placeholder: "6-8" },
    { key: "algo", label: "HMAC 算法", type: "select", default: "SHA-1", options: ALGO_OPTIONS },
  ],
  run: (t, p) => totp(t, p || {}),
});

export { hotp, totp, hotpCore, base32Decode };
