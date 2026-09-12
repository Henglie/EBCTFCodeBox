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
import { chacha20Poly1305Decrypt, chacha20Poly1305Encrypt } from "./poly1305.js";
import { aesDecrypt, aesEncrypt } from "./modern.js";
import { streamDecompress, streamCompress } from "./compress.js"; // v0.1.5：安全流解压（超时+纯JS inflate 兜底）/ T511 加密侧 deflate
import {
  combinedCharMap, combinedCharMap2, combinedCharMap4, combinedCharMap5, combinedCharMap6,
  ReverseCharSets3, CharSets, CharSets2, CharSets3, CharSets4, CharSets5, CharSets6, XY_ALPHABET,
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

// 源码 extract_emojis 的语义（T511 修复：改按 Unicode 码点切分，对齐 Python 原版）
// 原正则按 UTF-16 码元匹配，星面 emoji（U+1F3xx 等）裂成两个孤立代理项 →
// charToUnicode 得 U+D83D 类键 → isEmoji 判否，星面密文永远解不开。
// 码点化后 BMP 区间与原正则等价，星面整码点提取；序列（ZWJ/fe0f）按段提取，
// 与 map2 单码点键口径一致。EMOJI_RE 保留仅作历史参照。
function extractEmojis(text) {
  const out = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x1f000 || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2300 && cp <= 0x23ff) ||
        cp === 0x2b50 || cp === 0x2b55 || cp === 0x23ee || cp === 0x2139 ||
        (cp >= 0x2500 && cp <= 0x25ff) || cp === 0xfe0f || cp === 0x200d) out.push(ch);
  }
  return out;
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
// v0.1.5：代理 compress.js 安全流（DecompressionStream 超时 + 纯 JS inflate 兜底）
const inflateOne = (bytes, fmt) => streamDecompress(fmt, bytes);
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
  family: "xiangyue",
  familyLabel: "decrypt",
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

// ============ 加密方向（T511：严格逆推上方解密链，零新密码学代码） ============
// 明文 → zlib deflate（RFC1950，解密 inflateThenUtf8 先试 raw 失败后试 deflate）
// → AES-CTR → ChaCha20-Poly1305 → salt(16)‖nonce(12)‖ct‖tag(16)（format2）
//   / seed(16)‖ct‖tag(16)（format1，AAD=seed）→ Base64 → 按 mapId 映射输出。
// format2 的 chacha 明文前 16B 必须是随机 aesIv（解密 L233 提取），字节序不可换。
// 映射输出对齐自动识别判定序（zh>jp>kr>pict>emoji>zw>b64），低优先表构造时
// 排除高优先表的键（防御性，实测各表键零重叠）。

function randomBytes(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}
function concatBytes(...parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}
function bytesToB64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

const ENC_MAP_DEFS = {
  zh:   { label: "中文",     higher: [] },
  jp:   { label: "日文",     higher: [combinedCharMap] },
  kr:   { label: "韩文",     higher: [combinedCharMap, combinedCharMap4] },
  pict: { label: "象形文字", higher: [combinedCharMap, combinedCharMap4, combinedCharMap5] },
  emoji: { label: "Emoji",   emoji: true },
  zw:   { label: "零宽字符", zw: true },
  b64:  { label: "Base64",   identity: true },
};
const ENC_CHARSETS = { zh: CharSets, jp: CharSets4, kr: CharSets5, pict: CharSets6 };
const _encTableCache = new Map();

// emoji 键候选：T511 已修复 extractEmojis 码点化，星面 emoji 可整码点解码，
// 全候选可用（修复前仅 BMP 候选，17/65 键缺口）。
function emojiCandidates(key) {
  const out = [];
  for (const cp of CharSets2[key]) {
    const v = parseInt(cp.slice(2), 16);
    const ch = String.fromCodePoint(v);
    const ex = extractEmojis(ch);
    if (ex.length === 1 && ex[0] === ch && cp in combinedCharMap2) out.push(ch);
  }
  return out;
}
function getEncodeTable(mapId) {
  if (_encTableCache.has(mapId)) return _encTableCache.get(mapId);
  const def = ENC_MAP_DEFS[mapId];
  if (!def) throw new Error("未知映射 mapId: " + mapId + "（可用: " + Object.keys(ENC_MAP_DEFS).join("/") + "）");
  if (def.identity || def.zw) { _encTableCache.set(mapId, null); return null; }
  const table = {};
  const missing = [];
  for (const ch of XY_ALPHABET) {
    let cands;
    if (def.emoji) cands = emojiCandidates(ch);
    else {
      const raw = ENC_CHARSETS[mapId][ch] || [];
      cands = raw.filter((c) => def.higher.every((m) => !(c in m)));
      if (!cands.length && raw.length) cands = raw; // 兜底：全被过滤时保留原候选（当前不触发）
    }
    if (!cands.length) missing.push(ch);
    table[ch] = cands;
  }
  if (missing.length) table.__missing = missing;
  _encTableCache.set(mapId, table);
  return table;
}

// 零宽：b64 每字符 charCode 拆高/低 nibble 顺序排放 + 末位 pad '0'
// （数据位恒 8 倍数 → pad_bits=0）；首字符必为高 nibble ∈2..7、末位 '0'→非 U+FEFF，
// 不被解密入口 trim() 吃掉。
function zwEncode(b64) {
  const nib = [];
  for (let i = 0; i < b64.length; i++) {
    const c = b64.charCodeAt(i);
    if (c > 0xff) throw new Error("零宽编码遇到非 ASCII 字符: " + b64[i]);
    nib.push((c >> 4) & 0xf, c & 0xf);
  }
  nib.push(0);
  let out = "";
  for (const n of nib) out += CharSets3[n.toString(16)];
  if (out[0].trim() !== out[0] || out[out.length - 1].trim() !== out[out.length - 1]) {
    throw new Error("零宽密文首尾字符会被 trim() 吃掉（不应发生）");
  }
  return out;
}
function b64ToMapped(b64, mapId, variant) {
  const def = ENC_MAP_DEFS[mapId];
  if (!def) throw new Error("未知映射 mapId: " + mapId);
  if (def.identity) return b64;
  if (def.zw) return zwEncode(b64);
  const table = getEncodeTable(mapId);
  const missing = table.__missing || [];
  for (const ch of b64) {
    if (!table[ch] || !table[ch].length) {
      throw new Error("映射 " + mapId + "(" + def.label + ") 无法编码 Base64 字符 '" + ch + "'；该映射缺失键 [" + missing.join(" ") + "]，请换映射。");
    }
  }
  let out = "";
  for (const ch of b64) {
    const cands = table[ch];
    out += variant === "random" ? cands[secureIndex(cands.length)] : cands[0];
  }
  return out;
}
function secureIndex(n) {
  if (n <= 1) return 0;
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0] % n; // 候选仅 3-10 个，模偏差可忽略（非密钥材料，仅字符选择）
}

async function encryptBinaryFormat2(plaintextBytes, password) {
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const aesIv = randomBytes(16); // 前置进 chacha 明文（解密提取）
  const pbkdfKey = await pbkdf2(password, salt, 500000, "SHA-256", 64);
  const emptySalt = new Uint8Array(0);
  const aesKey = await hkdf(pbkdfKey, emptySalt, "AES-CTR", "SHA-256", 32);
  const chachaKey = await hkdf(pbkdfKey, emptySalt, "ChaCha20", "SHA-256", 32);
  const aesCt = aesEncrypt(plaintextBytes, aesKey, { mode: "CTR", iv: aesIv, pad: false });
  const { ciphertext, tag } = chacha20Poly1305Encrypt(chachaKey, nonce, concatBytes(aesIv, aesCt), undefined);
  return concatBytes(salt, nonce, ciphertext, tag); // 解密 slice 逆序
}
async function encryptBinaryFormat1(plaintextBytes, password) {
  const seed = randomBytes(16);
  const master = argon2id(te(password), seed, { t: 2, m: 65536, p: 1, tagLen: 64 });
  const aesKey = await hkdf(master, seed, "AES-CTR-Key", "SHA-512", 32);
  const chachaKey = await hkdf(master, seed, "ChaCha20-Key", "SHA-512", 32);
  const aesIv = await hkdf(master, seed, "AES-CTR-IV", "SHA-512", 16);
  const chachaNonce = await hkdf(master, seed, "ChaCha20-Nonce", "SHA-512", 12);
  const aesCt = aesEncrypt(plaintextBytes, aesKey, { mode: "CTR", iv: aesIv, pad: false });
  const { ciphertext, tag } = chacha20Poly1305Encrypt(chachaKey, chachaNonce, aesCt, seed); // AAD=seed
  return concatBytes(seed, ciphertext, tag);
}

/**
 * 想曰加密：输出串可被 xiangyueDecode 用同一口令自动识别解回原文。
 * @param {string} text 明文（非空）
 * @param {string} [password] 缺省用内置 DEFAULT_PASSWORD
 * @param {{format?:1|2, mapId?:string, variant?:"first"|"random"}} [opts]
 */
async function encryptXiangyue(text, password, opts) {
  const { format = 2, mapId = "zh", variant = "first" } = opts || {};
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("明文不能为空（解密侧对空输入返回空串，加密侧拒绝生成空密文）");
  }
  const pw = (typeof password === "string" && password) || DEFAULT_PASSWORD;
  if (format !== 1 && format !== 2) throw new Error("format 必须为 1 或 2");
  const deflated = await streamCompress("deflate", te(text));
  const data = format === 1 ? await encryptBinaryFormat1(deflated, pw) : await encryptBinaryFormat2(deflated, pw);
  return b64ToMapped(bytesToB64(data), mapId, variant);
}

// ============ 注册：加密方向（T511，与解密同族——族滑块「解密/加密」两档） ============
register({
  id: "xiangyueEnc",
  cat: "cn",
  name: "想曰 XiangYue 加密",
  desc: "想曰加密方向：明文 → zlib + AES-CTR + ChaCha20-Poly1305 → 中文/日文/韩文/象形/Emoji/零宽/Base64 密文，可被本工具箱「想曰」解密自动识别还原（format2 快；format1 Argon2id 64MiB 单次数秒）",
  family: "xiangyue",
  familyLabel: "encrypt",
  noAuto: true,
  params: [
    { key: "password", label: "口令", type: "text", default: DEFAULT_PASSWORD, placeholder: "加密口令（默认内置；解密须用同一口令）" },
    { key: "format", label: "密文格式", type: "select", default: "2", options: [
      { value: "2", label: "format2 · PBKDF2（快，推荐）" },
      { value: "1", label: "format1 · Argon2id 64MiB（慢，单次数秒）" },
    ] },
    { key: "mapId", label: "密文外观", type: "select", default: "zh", options: [
      { value: "zh", label: "中文" }, { value: "jp", label: "日文" }, { value: "kr", label: "韩文" },
      { value: "pict", label: "象形文字" }, { value: "emoji", label: "Emoji" },
      { value: "zw", label: "零宽字符" }, { value: "b64", label: "Base64" },
    ] },
    { key: "randomPick", label: "候选字符随机", type: "checkbox", default: false },
  ],
  run: async (t, p) => {
    const text = t || "";
    const password = (p && typeof p.password === "string" && p.password) || DEFAULT_PASSWORD;
    const format = p && p.format === "1" ? 1 : 2;
    const mapId = (p && p.mapId) || "zh";
    const variant = p && p.randomPick ? "random" : "first";
    const cipher = await encryptXiangyue(text, password, { format, mapId, variant });
    return cipher; // 纯密文输出：可直接复制回「想曰」解密（闭环），不掺说明行
  },
});

export { xiangyueDecode, encryptXiangyue, ciphertextToBase64 };
