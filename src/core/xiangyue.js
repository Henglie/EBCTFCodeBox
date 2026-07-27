/*
 * xiangyue.js — 想曰 XiangYue 完整版解密（cn 类）。
 *
 * 解密链纯前端可审计、无 WASM、无第三方：
 * 密文（中文/Emoji/零宽/日文/韩文/象形）→ 自动识别映射 → Base64
 * → 二格式自动侦测 + fallback：
 * format1: seed(16) + ChaCha20-Poly1305 密文
 * master = Argon2id(pw, seed, t=2 m=64MiB p=1 len=64)
 * HKDF-SHA512 派生 aes_key/chacha_key/aes_iv/chacha_nonce
 * ChaCha20-Poly1305(AAD=seed) → AES-CTR → zlib inflate
 * format2: salt(16) + nonce(12) + ChaCha20-Poly1305 密文
 * pbkdf = PBKDF2-SHA256(pw, salt, 500000, 64)
 * HKDF-SHA256(salt='') 派生 aes_key/chacha_key
 * ChaCha20-Poly1305 → 前16B=aes_iv → AES-CTR → zlib inflate
 *
 * 复用本仓已验证原语：
 * argon2id.js（RFC9106，argon2-cffi 向量 3/3）
 * poly1305.js（RFC8439 AEAD，向量 8/8）
 * modern.js aesDecrypt CTR（FIPS-197）
 * WebCrypto subtle：HKDF / PBKDF2
 * DecompressionStream：zlib inflate
 * xiangyueMaps.js（Python 权威 exec 提取，反查表各 650 条）
 *
 * 默认口令：a184f7b849ffed24d266a30298c72ef2f5ad040db73bf37151fac767630728
 * （源码内置默认密码，format1/2 通用）
 *
 * 注：原始实现仅含解密方向（无 encrypt 函数），故本 op 单向 decode。
 */
import { register } from "./registry.js";
import { argon2id } from "./argon2id.js";
import { chacha20Poly1305Decrypt } from "./poly1305.js";
import { aesDecrypt } from "./modern.js";
import {
  combinedCharMap, combinedCharMap2, combinedCharMap4,
  combinedCharMap5, combinedCharMap6, ReverseCharSets3,
} from "./xiangyueMaps.js";

const DEFAULT_PASSWORD = "a184f7b849ffed24d266a30298c72ef2f5ad040db73bf37151fac767630728";

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8").decode(b);

// ============ Base64 → 字节（标准表） ============
function b64ToBytes(s) {
  s = (s || "").replace(/\s+/g, "");
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ============ 6 种映射的密文 → Base64 串（还原自源码） ============

// U+ 码点串（emoji 用）：变体选择符只取主字符
function charToUnicode(ch) {
  const cps = [...ch];
  let main = cps[0];
  if (cps.length > 1) {
    const c1 = cps[1].codePointAt(0);
    if (c1 >= 0xfe00 && c1 <= 0xfe0f) main = cps[0];
    else main = ch; // 整体（多码点视作一个键，与源一致）
  }
  const code = [...main][0].codePointAt(0);
  return "U+" + code.toString(16).toUpperCase();
}

// 源码 extract_emojis 的正则（照搬，不加 u flag，按 UTF-16 code unit 匹配）
const EMOJI_RE = new RegExp(
  "(?:[^\\u0000-\\uD7FF\\uE000-\\uFFFF]|(?:\\uD83C[\\uDC00-\\uDFFF])|(?:\\uD83D[\\uDC00-\\uDEFF])|(?:\\uD83E[\\uDD00-\\uDDFF])|[\\u2600-\\u26FF\\u2700-\\u27BF\\u2300-\\u23FF\\u2B50\\u2B55\\u23EE\\u2139\\u2500-\\u25FF]|(?:\\uD83C[\\uDDE0-\\uDDFF]{1,2})|(?:\\u200D[\\u2640\\u2642\\u2695\\u2696\\u2708\\uD83C\\uD83D\\uD83E]+)+|[\\ufe0f])\\ufe0f?",
  "g"
);
function extractEmojis(text) {
  return text.match(EMOJI_RE) || [];
}

// 判定：全部字符命中某映射表（空串同 Python for 循环行为 → true，但上游已过滤空）
function allIn(text, map) {
  for (const ch of text) if (!(ch in map)) return false;
  return true;
}
function isChinese(text) { return allIn(text, combinedCharMap); }
function isJapanese(text) { return allIn(text, combinedCharMap4); }
function isKorean(text) { return allIn(text, combinedCharMap5); }
function isPictographic(text) { return allIn(text, combinedCharMap6); }
function isEmoji(text) {
  const em = extractEmojis(text);
  for (const e of em) if (!(charToUnicode(e) in combinedCharMap2)) return false;
  return em.length > 0;
}
function isZeroWidth(text) {
  for (const ch of text) if (ch in ReverseCharSets3) return true;
  return false;
}

function chineseToB64(text) {
  let out = "";
  for (const ch of text) {
    if (ch in combinedCharMap) out += combinedCharMap[ch];
    else throw new Error("未知中文字符: " + ch);
  }
  return out;
}
function mapToB64(text, map, label) {
  let out = "";
  for (const ch of text) {
    if (ch in map) out += map[ch];
    else throw new Error("未知" + label + "字符: " + ch);
  }
  return out;
}
function emojiToB64(text) {
  const em = extractEmojis(text);
  let out = "";
  for (const e of em) {
    const key = charToUnicode(e);
    if (key === "U+FE0F") continue;
    if (key in combinedCharMap2) out += combinedCharMap2[key];
    else throw new Error("未知 Emoji 码点: " + key);
  }
  return out;
}
// 零宽：nibble 序列重组 → ascii（=Base64 串），末 nibble 为 pad_bits/4
function zeroWidthToB64(text) {
  const nib = [];
  for (const ch of text) {
    if (ch in ReverseCharSets3) nib.push(parseInt(ReverseCharSets3[ch], 16));
  }
  if (nib.length < 2) throw new Error("零宽 nibble 长度 < 2");
  const padBits = nib.pop() * 4;
  const dataBits = nib.length * 4 - padBits;
  const byteLen = Math.floor(dataBits / 8);
  if (byteLen <= 0) throw new Error("零宽 byteLen <= 0");
  const out = new Uint8Array(byteLen);
  let buf = 0, bits = 0, idx = 0;
  for (const val of nib) {
    buf = (buf << 4) | val;
    bits += 4;
    if (bits >= 8) {
      out[idx++] = (buf >> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  let s = "";
  for (let i = 0; i < byteLen; i++) s += String.fromCharCode(out[i]);
  return s;
}

// 密文 → Base64 串（自动识别映射，顺序同源码 decrypt）
function ciphertextToBase64(text) {
  if (isChinese(text)) return { b64: chineseToB64(text), kind: "中文" };
  if (isJapanese(text)) return { b64: mapToB64(text, combinedCharMap4, "日文"), kind: "日文" };
  if (isKorean(text)) return { b64: mapToB64(text, combinedCharMap5, "韩文"), kind: "韩文" };
  if (isPictographic(text)) return { b64: mapToB64(text, combinedCharMap6, "象形"), kind: "象形文字" };
  if (isEmoji(text)) return { b64: emojiToB64(text), kind: "Emoji" };
  if (isZeroWidth(text)) return { b64: zeroWidthToB64(text), kind: "零宽字符" };
  return { b64: text.replace(/\s+/g, ""), kind: "Base64" };
}

// ============ 格式侦测（源码 detect_ciphertext_format） ============
function detectFormat(len) {
  if (len >= 45 && len - 28 >= 17) return "format2";
  if (len >= 33 && len - 16 >= 17) return "format1";
  return "unknown";
}

// ============ WebCrypto：HKDF / PBKDF2 ============
async function hkdf(ikm, salt, info, hash, len) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", salt, info: te(info), hash }, key, len * 8
  );
  return new Uint8Array(bits);
}
async function pbkdf2(pwd, salt, iterations, hash, len) {
  const key = await crypto.subtle.importKey("raw", te(pwd), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash }, key, len * 8
  );
  return new Uint8Array(bits);
}

// ============ zlib inflate（-15 raw → 标准 zlib → 原样） ============
async function inflateOne(bytes, fmt) {
  const ds = new DecompressionStream(fmt);
  const w = ds.writable.getWriter();
  w.write(bytes); w.close();
  const chunks = [];
  const r = ds.readable.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    chunks.push(value);
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
async function inflateThenUtf8(bytes) {
  for (const fmt of ["deflate-raw", "deflate"]) {
    try { return td(await inflateOne(bytes, fmt)); } catch (_) { /* 试下一个 */ }
  }
  return td(bytes); // 未压缩，直接 UTF-8
}

// ============ format1（Argon2id 路径） ============
async function decryptFormat1(data, password) {
  const seed = data.slice(0, 16);
  const chachaCt = data.slice(16);
  if (chachaCt.length < 17) throw new Error("format1 ChaCha20-Poly1305 密文过短");

  const master = argon2id(te(password), seed, { t: 2, m: 65536, p: 1, tagLen: 64 });
  const aesKey = await hkdf(master, seed, "AES-CTR-Key", "SHA-512", 32);
  const chachaKey = await hkdf(master, seed, "ChaCha20-Key", "SHA-512", 32);
  const aesIv = await hkdf(master, seed, "AES-CTR-IV", "SHA-512", 16);
  const chachaNonce = await hkdf(master, seed, "ChaCha20-Nonce", "SHA-512", 12);

  const message = chachaCt.slice(0, -16);
  const tag = chachaCt.slice(-16);
  const res = chacha20Poly1305Decrypt(chachaKey, chachaNonce, message, tag, seed);
  if (!res.ok) throw new Error("format1 ChaCha20-Poly1305 认证失败");

  const aesPlain = aesDecrypt(res.plaintext, aesKey, { mode: "CTR", iv: aesIv, pad: false });
  return inflateThenUtf8(aesPlain);
}

// ============ format2（PBKDF2 路径） ============
async function decryptFormat2(data, password) {
  const salt = data.slice(0, 16);
  const nonce = data.slice(16, 28);
  const chachaCt = data.slice(28);
  if (chachaCt.length < 17) throw new Error("format2 ChaCha20-Poly1305 密文过短");

  const pbkdfKey = await pbkdf2(password, salt, 500000, "SHA-256", 64);
  const emptySalt = new Uint8Array(0);
  const aesKey = await hkdf(pbkdfKey, emptySalt, "AES-CTR", "SHA-256", 32);
  const chachaKey = await hkdf(pbkdfKey, emptySalt, "ChaCha20", "SHA-256", 32);

  const message = chachaCt.slice(0, -16);
  const tag = chachaCt.slice(-16);
  const res = chacha20Poly1305Decrypt(chachaKey, nonce, message, tag, undefined);
  if (!res.ok) throw new Error("format2 ChaCha20-Poly1305 认证失败");

  const plain = res.plaintext;
  if (plain.length < 16) throw new Error("format2 解密结果过短，无法提取 AES IV");
  const aesIv = plain.slice(0, 16);
  const aesCt = plain.slice(16);
  const aesPlain = aesDecrypt(aesCt, aesKey, { mode: "CTR", iv: aesIv, pad: false });
  return inflateThenUtf8(aesPlain);
}

// ============ 顶层解密（主选 + fallback，同源码 decrypt） ============
async function xiangyueDecode(text, password) {
  const { b64, kind } = ciphertextToBase64(text);
  let data;
  try { data = b64ToBytes(b64); }
  catch (e) { throw new Error("Base64 解码失败：" + e.message); }

  const fmt = detectFormat(data.length);
  if (fmt === "unknown") throw new Error("无法识别密文格式（长度 " + data.length + "）");

  let plaintext, used;
  const tryF1 = () => decryptFormat1(data, password);
  const tryF2 = () => decryptFormat2(data, password);
  if (fmt === "format1") {
    try { plaintext = await tryF1(); used = "format1"; }
    catch (_) { plaintext = await tryF2(); used = "format2"; }
  } else {
    try { plaintext = await tryF2(); used = "format2"; }
    catch (_) { plaintext = await tryF1(); used = "format1"; }
  }
  return { plaintext, kind, used };
}

// ============ 注册 ============
register({
  id: "xiangyue",
  cat: "cn",
  name: "想曰 XiangYue",
  desc: "想曰全流程解密：中文/Emoji/零宽/日/韩/象形密文 → Argon2id/PBKDF2 + ChaCha20-Poly1305 + AES-CTR + zlib（默认口令内置；format1 派生较慢约数秒）",
  // Argon2id 64MiB 派生单次约 8-10 秒，且需用户显式提供口令，不适合自动穷举——
  // 排除出一键解码的批量遍历，仅在用户主动选择时运行。
  noAuto: true,
  params: [
    { key: "password", label: "口令", type: "text", default: DEFAULT_PASSWORD, placeholder: "解密口令（默认内置）" },
    { key: "showMeta", label: "附带识别信息", type: "checkbox", default: false },
  ],
  run: async (t, p) => {
    const text = (t || "").trim();
    if (!text) return "";
    const password = (p && typeof p.password === "string" && p.password) || DEFAULT_PASSWORD;
    const { plaintext, kind, used } = await xiangyueDecode(text, password);
    if (p && p.showMeta) return `[映射:${kind} 格式:${used}]\n${plaintext}`;
    return plaintext;
  },
});

export { xiangyueDecode, ciphertextToBase64 };
