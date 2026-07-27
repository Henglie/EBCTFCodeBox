/*
 * emojiAes.js — emoji-aes 完整版（cat: 'fancy'）
 *
 * 对标 GitHub aaronhorler/emoji-aes：先用 CryptoJS.AES（OpenSSL "Salted__" 格式）
 * 加密明文得到 base64 密文，再把 base64 的每个字符按固定 65 emoji 表逐一替换成 emoji。
 *
 * 与项目现有 op 区别：
 * - emojiSubst（stego.js）只做「base64 ↔ emoji」替换层，不含加密（emoji-aes 的替换层）。
 * - 本 op = 完整版 = AES-256-CBC 加密 + emoji 替换（对标 emoji-aes 主功能）。
 * - 与 fuyouyue（cn.js 佛又曰）加密链相同（同一 OpenSSL/CryptoJS 格式），但 fuyouyue
 * 裁掉 "U2FsdGVk" 前缀并换心经字符表；emoji-aes 保留完整前缀 + 换 emoji 表。
 *
 * 复用纯函数（单向依赖底层，不重写不修改）：
 * - aesEncrypt / aesDecrypt（modern.js，AES-CBC + PKCS7）
 * - md5Bytes（hash.js，EVP_BytesToKey 密钥派生用）
 * - EMOJI_INIT（stego.js，65 emoji 表，Aaron Horler 2017 原表，单一真相源）
 *
 * OpenSSL Salted__ + EVP_BytesToKey(MD5) 薄封装与 fuyouyue.js 一致（即 CryptoJS.AES
 * 默认输出格式）：base64( "Salted__" + salt(8) + AES-256-CBC-ct )。
 */

import { aesEncrypt, aesDecrypt } from "./modern.js";
import { md5Bytes } from "./hash.js";
import { EMOJI_INIT } from "./stego.js";
import { register } from "./registry.js";

// ============================================================
// base64 辅助（自包含，同 fuyouyue.js 模式）
// ============================================================
const te = new TextEncoder();
const td = (bytes) => new TextDecoder("utf-8").decode(new Uint8Array(bytes));

function b64Enc(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64Dec(str) {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ============================================================
// EVP_BytesToKey（OpenSSL 密钥派生, MD5）——同 fuyouyue.js
// 输出 48 字节 = 32 key(AES-256) + 16 iv
// ============================================================
function bytesToKey(password, salt, output = 48) {
  const data = new Uint8Array(password.length + salt.length);
  data.set(password);
  data.set(salt, password.length);
  let key = md5Bytes(data); // 第一轮：md5(password + salt)
  const chunks = [key];
  let total = key.length;
  while (total < output) {
    const next = new Uint8Array(key.length + data.length);
    next.set(key);
    next.set(data, key.length);
    key = md5Bytes(next); // 迭代：md5(prevKey + password + salt)
    chunks.push(key);
    total += key.length;
  }
  const final = new Uint8Array(output);
  let off = 0;
  for (const c of chunks) {
    const len = Math.min(c.length, output - off);
    final.set(c.subarray(0, len), off);
    off += len;
    if (off >= output) break;
  }
  return final;
}

// ============================================================
// AES-256-CBC OpenSSL "Salted__" 格式（CryptoJS.AES 默认输出）
// ============================================================
const SALTED = new Uint8Array([0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f]); // "Salted__"

function randomBytes(n) {
  const arr = new Uint8Array(n);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return arr;
}

/** 加密：data + passphrase → base64( "Salted__" + salt(8) + AES-CBC-ct )（含 U2FsdGVk 前缀） */
function encryptSalted(data, passphrase) {
  const salt = randomBytes(8);
  const keyIv = bytesToKey(passphrase, salt, 48);
  const key = keyIv.subarray(0, 32);
  const iv = keyIv.subarray(32, 48);
  const ct = aesEncrypt(data, key, { mode: "CBC", iv, pad: true }); // PKCS7 自动
  const out = new Uint8Array(16 + ct.length);
  out.set(SALTED, 0);
  out.set(salt, 8);
  out.set(ct, 16);
  return b64Enc(out);
}

/** 解密：base64( "Salted__" + salt + ct ) + passphrase → 明文 bytes */
function decryptSalted(b64, passphrase) {
  const raw = b64Dec(b64);
  for (let i = 0; i < 8; i++) {
    if (raw[i] !== SALTED[i]) throw new Error("密文格式错误：缺少 Salted__ 头（密码或旋转不对？）");
  }
  const salt = raw.subarray(8, 16);
  const ct = raw.subarray(16);
  const keyIv = bytesToKey(passphrase, salt, 48);
  const key = keyIv.subarray(0, 32);
  const iv = keyIv.subarray(32, 48);
  return aesDecrypt(ct, key, { mode: "CBC", iv, pad: true }); // PKCS7 自动去 pad
}

// ============================================================
// base64 ↔ emoji 替换层（复用 stego.js 的 EMOJI_INIT 65 表 + rotation）
// emoji-aes 的 base64 索引：a-z=0..25, A-Z=26..51, 0-9=52..61, +=62, /=63, ==64
// ============================================================
function b64CharToIndex(c) {
  const code = c.charCodeAt(0);
  if (c >= "a" && c <= "z") return code - 97;
  if (c >= "A" && c <= "Z") return 26 + code - 65;
  if (c >= "0" && c <= "9") return 52 + code - 48;
  if (c === "+") return 62;
  if (c === "/") return 63;
  if (c === "=") return 64;
  return -1;
}
const B64_ALPHABET_BY_INDEX = (() => {
  const arr = new Array(65);
  for (let i = 0; i < 26; i++) arr[i] = String.fromCharCode(97 + i);
  for (let i = 0; i < 26; i++) arr[26 + i] = String.fromCharCode(65 + i);
  for (let i = 0; i < 10; i++) arr[52 + i] = String.fromCharCode(48 + i);
  arr[62] = "+"; arr[63] = "/"; arr[64] = "=";
  return arr;
})();

function emojiTable(rotation) {
  const rot = ((Number(rotation) || 0) % EMOJI_INIT.length + EMOJI_INIT.length) % EMOJI_INIT.length;
  if (rot === 0) return EMOJI_INIT.slice();
  const out = new Array(EMOJI_INIT.length);
  for (let i = 0; i < EMOJI_INIT.length; i++) out[i] = EMOJI_INIT[(i + rot) % EMOJI_INIT.length];
  return out;
}

/** base64 字符串 → emoji 串 */
function toEmoji(b64, rotation) {
  const emojis = emojiTable(rotation);
  let out = "";
  for (const c of b64) {
    const idx = b64CharToIndex(c);
    out += idx === -1 ? c : emojis[idx];
  }
  return out;
}

/** emoji 串 → base64 字符串（按 emoji 长度降序贪婪匹配，避免前缀歧义） */
function fromEmoji(text, rotation) {
  const emojis = emojiTable(rotation);
  const pairs = emojis
    .map((e, i) => [e, B64_ALPHABET_BY_INDEX[i]])
    .sort((a, b) => b[0].length - a[0].length);
  let b64 = "";
  let i = 0;
  outer: while (i < text.length) {
    for (const [emo, ch] of pairs) {
      if (text.startsWith(emo, i)) { b64 += ch; i += emo.length; continue outer; }
    }
    b64 += text[i++]; // 非 emoji 原样保留
  }
  return b64;
}

// ============================================================
// op 层（双向 encode / decode，params 对象约定）
// ============================================================
function emojiAesEncode(text, p = {}) {
  const pass = p.password != null ? String(p.password) : "";
  const b64 = encryptSalted(te.encode(text), te.encode(pass));
  return toEmoji(b64, p.rotation);
}

function emojiAesDecode(text, p = {}) {
  const pass = p.password != null ? String(p.password) : "";
  const b64 = fromEmoji(text.trim(), p.rotation);
  return td(decryptSalted(b64, te.encode(pass)));
}

// ============================================================
// 注册
// ============================================================
register({
  id: "emojiAes",
  cat: "fancy",
  name: "emoji-aes 加密",
  desc: "emoji-aes 完整版：AES-256-CBC(OpenSSL) 加密后 base64 → 65 emoji 表替换（对标 Aaron Horler emoji-aes）",
  params: [
    { key: "password", label: "密码", type: "text", default: "", placeholder: "AES 口令" },
    { key: "rotation", label: "旋转", type: "number", default: 0, placeholder: "0-64（emoji 表旋转）" },
  ],
  encode: emojiAesEncode,
  decode: emojiAesDecode,
 // 指纹：默认旋转下反查 base64，命中 OpenSSL "U2FsdGVk"（Salted__）前缀即高置信。
  detect: (t) => {
    try {
      return fromEmoji(t.trim(), 0).startsWith("U2FsdGVk") ? 0.6 : 0;
    } catch {
      return 0;
    }
  },
});

export { emojiAesEncode, emojiAesDecode };
