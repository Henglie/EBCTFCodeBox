/*
 * kdf.js — 密钥派生函数组。
 *
 * 覆盖：PBKDF2（RFC 2898 / 8018）/ HKDF（RFC 5869）。
 * 均走 WebCrypto subtle.deriveBits（globalThis.crypto.subtle，浏览器/Node 一致）
 * 与 hash.js / hashExt.js 完全解耦，独立实现。
 *
 * 契约：单向 run(text, params) → hex 串（哈希/派生类不需双向）。
 * PBKDF2：input 文本 = 口令（UTF-8），salt/iterations/keyLen/hash 为参数。
 * HKDF： input 文本 = IKM 输入密钥材料，salt/info/keyLen/hash 为参数。
 *
 * 权威向量：
 * PBKDF2 RFC 6070（HMAC-SHA1）。
 * HKDF RFC 5869 附录 A（SHA-256）。
 */
import { register } from "./registry.js";
import { aesDecrypt } from "./modern.js";

const te = (s) => new TextEncoder().encode(s);
const td = (bytes) => new TextDecoder("utf-8", { fatal: false }).decode(bytes);
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// 按格式把字符串解析为字节（utf8 / hex / base64），供 salt / info / IKM 用。
function parseBytes(str, fmt) {
  str = str || "";
  if (fmt === "hex") {
    const s = str.replace(/[^0-9a-fA-F]/g, "");
    const out = new Uint8Array(s.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }
  if (fmt === "base64") {
    const bin = atob(str.replace(/\s/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return te(str); // utf8
}

function ensureSubtle() {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto");
}

// ============ PBKDF2（RFC 2898 / RFC 8018，WebCrypto 原生） ============
async function pbkdf2(password, p) {
  ensureSubtle();
  const salt = parseBytes((p && p.salt) || "", (p && p.saltFormat) || "utf8");
  const iterations = Math.max(1, (p && p.iterations | 0) || 1);
  const dkLen = Math.max(1, (p && p.keyLen | 0) || 1); // 字节
  const hash = (p && p.hash) || "SHA-256";
  const keyMaterial = await crypto.subtle.importKey(
    "raw", te(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash }, keyMaterial, dkLen * 8
  );
  return toHex(new Uint8Array(bits));
}

// ============ HKDF（RFC 5869，extract+expand，WebCrypto 原生） ============
async function hkdf(ikmStr, p) {
  ensureSubtle();
  const ikm = parseBytes(ikmStr, (p && p.ikmFormat) || "hex");
  const salt = parseBytes((p && p.salt) || "", (p && p.saltFormat) || "hex");
  const info = parseBytes((p && p.info) || "", (p && p.infoFormat) || "hex");
  const dkLen = Math.max(1, (p && p.keyLen | 0) || 1); // 字节
  const hash = (p && p.hash) || "SHA-256";
  const keyMaterial = await crypto.subtle.importKey(
    "raw", ikm, "HKDF", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", salt, info, hash }, keyMaterial, dkLen * 8
  );
  return toHex(new Uint8Array(bits));
}

// ============ 参数声明公用片段 ============
const HASH_OPTIONS = [
  { value: "SHA-1", label: "SHA-1" },
  { value: "SHA-256", label: "SHA-256" },
  { value: "SHA-384", label: "SHA-384" },
  { value: "SHA-512", label: "SHA-512" },
];
const FORMAT_OPTIONS = [
  { value: "utf8", label: "UTF-8 文本" },
  { value: "hex", label: "十六进制" },
  { value: "base64", label: "Base64" },
];

// ============ 注册 ============
register({
  id: "pbkdf2", cat: "hash", name: "PBKDF2",
  desc: "PBKDF2 密钥派生（RFC 2898/8018，input=口令，输出 hex；CTF 高频）",
  params: [
    { key: "salt", label: "盐值 salt", type: "text", default: "", placeholder: "盐值" },
    { key: "saltFormat", label: "盐值格式", type: "select", default: "utf8", options: FORMAT_OPTIONS },
    { key: "iterations", label: "迭代次数", type: "number", default: 1000, placeholder: "迭代次数" },
    { key: "keyLen", label: "密钥长度(字节)", type: "number", default: 32, placeholder: "输出字节数" },
    { key: "hash", label: "哈希算法", type: "select", default: "SHA-256", options: HASH_OPTIONS },
  ],
  run: (t, p) => pbkdf2(t, p || {}),
});

register({
  id: "hkdf", cat: "hash", name: "HKDF",
  desc: "HKDF 密钥派生（RFC 5869，input=IKM 输入密钥材料，输出 hex）",
  params: [
    { key: "ikmFormat", label: "IKM 格式", type: "select", default: "hex", options: FORMAT_OPTIONS },
    { key: "salt", label: "盐值 salt", type: "text", default: "", placeholder: "盐值（可空）" },
    { key: "saltFormat", label: "盐值格式", type: "select", default: "hex", options: FORMAT_OPTIONS },
    { key: "info", label: "info 上下文", type: "text", default: "", placeholder: "info（可空）" },
    { key: "infoFormat", label: "info 格式", type: "select", default: "hex", options: FORMAT_OPTIONS },
    { key: "keyLen", label: "密钥长度(字节)", type: "number", default: 32, placeholder: "输出字节数" },
    { key: "hash", label: "哈希算法", type: "select", default: "SHA-256", options: HASH_OPTIONS },
  ],
  run: (t, p) => hkdf(t, p || {}),
});

// ============ PBE-AES 口令字典爆破 ============
// input = 密文（hex 或 base64），口令字典逐行 → PBKDF2 派生 key → AES 解密 → crib/可打印率判定。
// 覆盖 openssl enc -aes-256-cbc -pbkdf2 及一般 PBKDF2+AES 场景。
// 参数：salt/saltFormat、iterations、hash、keyBits(128/192/256)、mode(CBC/ECB)、
//       ivHex（CBC 用，默认全0）、cipherFormat(hex/base64)、crib、wordlist（多行口令，input 为空时用内置小字典）。
function _hexToBytes(s) {
  const clean = String(s).replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function _b64ToBytes(s) {
  const bin = atob(String(s).replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function _printableRatio(str) {
  if (!str.length) return 0;
  let ok = 0;
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c > 0x2e80) ok++;
  }
  return ok / str.length;
}
// 内置小字典（CTF 高频弱口令），input 密文外若未提供 wordlist 用它兜底。
const PBE_DEFAULT_WORDS = [
  "password", "123456", "admin", "root", "flag", "ctf", "secret", "key",
  "letmein", "qwerty", "123456789", "12345678", "111111", "000000", "toor",
  "pass", "test", "hello", "welcome", "master", "dragon", "monkey", "abc123",
];
async function pbeAesBrute(cipherInput, p) {
  ensureSubtle();
  const salt = parseBytes((p && p.salt) || "", (p && p.saltFormat) || "utf8");
  const iterations = Math.max(1, (p && p.iterations | 0) || 1000);
  const hash = (p && p.hash) || "SHA-256";
  const keyBits = Number((p && p.keyBits) || 256);
  const mode = ((p && p.mode) || "CBC").toUpperCase();
  const cipherFormat = (p && p.cipherFormat) || "hex";
  const crib = (p && p.crib) || "";
  const cipherBytes = cipherFormat === "base64" ? _b64ToBytes(cipherInput) : _hexToBytes(cipherInput);
  if (!cipherBytes.length) return "密文为空或格式错误（应为 hex 或 base64）。";
  const iv = mode === "ECB" ? null : ((p && p.ivHex) ? _hexToBytes(p.ivHex) : new Uint8Array(16));
  // 口令来源：wordlist 参数（多行）优先，否则内置字典
  const rawList = (p && p.wordlist) ? String(p.wordlist).split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : PBE_DEFAULT_WORDS;
  const dkLen = keyBits / 8;
  let cribRe = null;
  if (crib) { try { cribRe = new RegExp(crib); } catch { cribRe = null; } }
  const hits = [];
  let tried = 0;
  for (const pw of rawList) {
    tried++;
    let plainText;
    try {
      const km = await crypto.subtle.importKey("raw", te(pw), "PBKDF2", false, ["deriveBits"]);
      const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash }, km, dkLen * 8);
      const key = new Uint8Array(bits);
      const plain = aesDecrypt(cipherBytes, key, { mode, iv, pad: true });
      plainText = td(plain);
    } catch { continue; } // PKCS7 校验失败等 = 口令错，正常
    const hit = cribRe ? cribRe.test(plainText) : (crib ? plainText.includes(crib) : false);
    const ratio = _printableRatio(plainText);
    if (hit || ratio >= 0.9) {
      hits.push({ pw, plainText, hit, ratio });
      if (hit) break; // crib 命中即停
    }
  }
  if (!hits.length) return `已试 ${tried} 个口令，未找到能解出（crib 命中或高可打印率）的口令。\n可在参数里提供更大的口令字典（wordlist，多行）。`;
  hits.sort((a, b) => (b.hit ? 1 : 0) - (a.hit ? 1 : 0) || b.ratio - a.ratio);
  const lines = [`已试 ${tried} 个口令，命中 ${hits.length} 个候选：\n`];
  for (const h of hits.slice(0, 10)) {
    lines.push(`口令="${h.pw}"${h.hit ? "（crib 命中）" : `（可打印率 ${(h.ratio * 100).toFixed(0)}%）`}`);
    lines.push(`  → ${h.plainText.slice(0, 200)}`);
  }
  return lines.join("\n");
}
register({
  id: "pbeAesBrute", cat: "crypto", name: "PBE-AES 口令爆破",
  desc: "PBKDF2+AES 口令字典爆破。input=密文(hex/base64)，用口令字典逐个 PBKDF2 派生 key 解 AES，crib 命中或高可打印率即报。覆盖 openssl enc -aes-256-cbc -pbkdf2。",
  params: [
    { key: "cipherFormat", label: "密文格式", type: "select", default: "hex", options: [
      { value: "hex", label: "十六进制" }, { value: "base64", label: "Base64" },
    ] },
    { key: "wordlist", label: "口令字典（每行一个，空=内置弱口令表）", type: "text", default: "", placeholder: "password\\n123456\\nadmin..." },
    { key: "salt", label: "盐值 salt", type: "text", default: "", placeholder: "盐值" },
    { key: "saltFormat", label: "盐值格式", type: "select", default: "utf8", options: FORMAT_OPTIONS },
    { key: "iterations", label: "迭代次数", type: "number", default: 1000 },
    { key: "keyBits", label: "AES 密钥位数", type: "select", default: 256, options: [
      { value: 128, label: "128" }, { value: 192, label: "192" }, { value: 256, label: "256" },
    ] },
    { key: "mode", label: "AES 模式", type: "select", default: "CBC", options: [
      { value: "CBC", label: "CBC" }, { value: "ECB", label: "ECB" },
    ] },
    { key: "ivHex", label: "IV (hex, CBC 用，空=全0)", type: "text", default: "", placeholder: "全0 IV" },
    { key: "crib", label: "已知明文特征 (crib, 正则/子串)", type: "text", default: "", placeholder: "如 flag\\{" },
  ],
  run: (t, p) => pbeAesBrute(t, p || {}),
});

export { pbkdf2, hkdf, parseBytes, pbeAesBrute };
