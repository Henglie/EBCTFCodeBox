/*
 * txtmoji.js —— txtmoji.com emoji 加密（cat: 'fancy'）。
 *
 * 对标 https://txtmoji.com/ （Next.js 站点，纯前端加密）。CTF 题「一串表情符号 +
 * 标题即密码」常出自此站（如 ctfshow 0x36d：密文 emoji + 标题十进制当密码）。
 *
 * 算法（从 txtmoji.com 前端 JS 逆出，2026-07 实测样本 + 真题验证）：
 * - 底层 = CryptoJS.AES 默认输出（OpenSSL "Salted__" 格式 + EVP_BytesToKey(MD5)
 *   + AES-256-CBC + PKCS7），与本项目 emojiAes.js / fuyouyue.js 同一套 AES 封装。
 * - 与标准 CryptoJS 的差异 = 两层「省字节 + emoji 替换」：
 *   encode：AES 密文 base64（必以 "U2FsdGVkX1" 开头）→ **切掉前 10 字符**（站点硬编码
 *           固定前缀，解码时补回）→ 剩余每个字符按 charCodeAt(0).toString(16) 取 hex，
 *           查 65 项 EMOJI_TABLE（键=字符 ASCII 的 hex）→ emoji 串。
 *   decode：每个 emoji → codePoint & 0xff → String.fromCharCode → 拼回字符串 →
 *           前面补 "U2FsdGVkX1" → CryptoJS.AES.decrypt(·, password) → UTF-8 明文。
 *   注：decode 只用 emoji 码点低字节（& 0xff），因 65 表里每个 emoji 的低字节唯一。
 *
 * EMOJI_TABLE：65 项，从站点运行时 AES 加密的表（密钥 "s1&["）解出，键为 base64 字母表
 * 每个字符的 ASCII hex（2b=+ 2f=/ 30-39=0-9 3d== 41-5a=A-Z 61-7a=a-z），值为 emoji。
 *
 * 红线：纯本地纯 JS，零外发（AES 走本项目 modern.js，非 CryptoJS）。密码为十进制/任意口令。
 */
import { register } from "./registry.js";
import { aesEncrypt, aesDecrypt } from "./modern.js";
import { md5Bytes } from "./hash.js";

const te = new TextEncoder();
const td = (bytes) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));

// txtmoji.com 固定前缀（OpenSSL "Salted__" base64 编码头恒为 "U2FsdGVkX1"）。
const FIXED_PREFIX = "U2FsdGVkX1";

// 65 项 emoji 表：键 = base64 字母表字符的 ASCII hex，值 = emoji（站点运行时解出）。
const EMOJI_TABLE = {
  "30": "😰", "31": "😱", "32": "😲", "33": "😳", "34": "😴", "35": "😵", "36": "😶",
  "37": "😷", "38": "😸", "39": "😹", "41": "🙁", "42": "🙂", "43": "🙃", "44": "🙄",
  "45": "🙅", "46": "🙆", "47": "🙇", "48": "🙈", "49": "🙉", "50": "👐", "51": "👑",
  "52": "👒", "53": "👓", "54": "👔", "55": "👕", "56": "👖", "57": "👗", "58": "👘",
  "59": "👙", "61": "👡", "62": "👢", "63": "👣", "64": "👤", "65": "👥", "66": "👦",
  "67": "👧", "68": "👨", "69": "👩", "70": "👰", "71": "👱", "72": "👲", "73": "👳",
  "74": "👴", "75": "👵", "76": "👶", "77": "👷", "78": "👸", "79": "👹", "4a": "🙊",
  "4b": "🙋", "4c": "👌", "4d": "🙍", "4e": "🙎", "4f": "👏", "5a": "👚", "6a": "👪",
  "6b": "👫", "6c": "👬", "6d": "👭", "6e": "👮", "6f": "👯", "7a": "👺", "2b": "😫",
  "2f": "😯", "3d": "😽",
};
// 反查：emoji → base64 字符（decode 用；实际 decode 只需码点低字节，此表作校验/encode 逆用）。
const EMOJI_TO_CHAR = (() => {
  const m = {};
  for (const hex in EMOJI_TABLE) m[EMOJI_TABLE[hex]] = String.fromCharCode(parseInt(hex, 16));
  return m;
})();
// 字符 → emoji（encode 用）。
const CHAR_TO_EMOJI = (() => {
  const m = {};
  for (const hex in EMOJI_TABLE) m[String.fromCharCode(parseInt(hex, 16))] = EMOJI_TABLE[hex];
  return m;
})();

// ---------- base64 ↔ 字节 ----------
function b64Dec(str) {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64Enc(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// ---------- OpenSSL EVP_BytesToKey(MD5)：口令+salt → 48 字节(32 key + 16 iv) ----------
function bytesToKey(password, salt, output = 48) {
  const data = new Uint8Array(password.length + salt.length);
  data.set(password);
  data.set(salt, password.length);
  let key = md5Bytes(data);
  const chunks = [key];
  let total = key.length;
  while (total < output) {
    const next = new Uint8Array(key.length + data.length);
    next.set(key);
    next.set(data, key.length);
    key = md5Bytes(next);
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

const SALTED = new Uint8Array([0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f]); // "Salted__"

function randomBytes(n) {
  const arr = new Uint8Array(n);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(arr);
  else for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256);
  return arr;
}

// ---------- emoji 串 → base64 本体（decode 第一步）----------
// 站点逻辑：对每个字符取码点末 2 hex（等价 & 0xff）→ char，跳过空白。
// ⚠ 不能只认 EMOJI_TABLE 的值：真实密文里的 emoji（如 😫=1F62B）与表值（encode 侧
// 😰=1F630 等）不同，只共享低字节（0x2b='+'）。站点 decode 从不查表，只取末字节。
// 故对所有非空白字符一律 & 0xff，还原 base64 本体。
function emojisToBody(text) {
  let out = "";
  for (const ch of text) {
    if (/\s/.test(ch)) continue;          // 跳过空白/换行
    const cp = ch.codePointAt(0);
    if (cp == null) continue;
    out += String.fromCharCode(cp & 0xff);
  }
  return out;
}

// ---------- 明文 base64 本体 → emoji 串（encode 最后一步）----------
function bodyToEmojis(body) {
  let out = "";
  for (const ch of body) {
    const emo = CHAR_TO_EMOJI[ch];
    if (emo == null) throw new Error("txtmoji: base64 字符无对应 emoji: " + ch);
    out += emo;
  }
  return out;
}

// ---------- decode：emoji 串 + 口令 → 明文 ----------
function txtmojiDecode(text, p = {}) {
  const pass = p && p.password != null ? String(p.password) : "";
  const body = emojisToBody(String(text).trim());
  if (!body) throw new Error("txtmoji: 无有效 emoji");
  const b64 = FIXED_PREFIX + body;                 // 补回站点切掉的固定前缀
  const raw = b64Dec(b64);
  for (let i = 0; i < 8; i++) {
    if (raw[i] !== SALTED[i]) throw new Error("txtmoji: 非 Salted__ 格式（emoji 表或密文不符）");
  }
  const salt = raw.subarray(8, 16);
  const ct = raw.subarray(16);
  const keyIv = bytesToKey(te.encode(pass), salt, 48);
  const plain = aesDecrypt(ct, keyIv.subarray(0, 32), { mode: "CBC", iv: keyIv.subarray(32, 48), pad: true });
  return td(plain);
}

// ---------- encode：明文 + 口令 → emoji 串 ----------
function txtmojiEncode(text, p = {}) {
  const pass = p && p.password != null ? String(p.password) : "";
  const salt = randomBytes(8);
  const keyIv = bytesToKey(te.encode(pass), salt, 48);
  const ct = aesEncrypt(te.encode(String(text)), keyIv.subarray(0, 32), { mode: "CBC", iv: keyIv.subarray(32, 48), pad: true });
  const out = new Uint8Array(16 + ct.length);
  out.set(SALTED, 0);
  out.set(salt, 8);
  out.set(ct, 16);
  const b64 = b64Enc(out);                          // 恒以 "U2FsdGVkX1" 开头
  const body = b64.slice(FIXED_PREFIX.length);      // 切掉固定前缀（站点行为）
  return bodyToEmojis(body);
}

register({
  id: "txtmoji",
  cat: "fancy",
  name: "txtmoji emoji 加密",
  desc: "txtmoji.com emoji 加密（AES-256-CBC OpenSSL + 65 emoji 表替换 + 切固定前缀）。密码为十进制/任意口令。CTF 常见「标题即密码」的表情符号密文",
  params: [
    { key: "password", label: "密码", type: "text", default: "", placeholder: "口令（常为标题的十进制数）" },
  ],
  encode: txtmojiEncode,
  decode: txtmojiDecode,
  // 指纹：串里 emoji 全落在 65 表内 + 数量≥3（能还原出 base64 本体）即高置信。
  detect: (t) => {
    const s = String(t || "").trim();
    if (!s) return 0;
    let inTable = 0, total = 0;
    for (const ch of s) {
      if (/\s/.test(ch)) continue;
      total++;
      if (EMOJI_TO_CHAR[ch] != null) inTable++;
    }
    if (total < 3) return 0;
    return inTable / total >= 0.9 ? 0.55 : 0;
  },
});

export { txtmojiEncode, txtmojiDecode, EMOJI_TABLE };
