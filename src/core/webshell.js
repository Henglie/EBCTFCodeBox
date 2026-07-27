/*
 * core/webshell.js —— webshell 流量解密预设（哥斯拉 / 冰蝎）
 *
 * 背景：
 * CTF Web/Misc 高频要「一眼认出并解开」哥斯拉(Godzilla)、
 * 冰蝎(Behinder)的加密流量。算法原语（AES-ECB / XOR / Base64）我方全有，缺的只是
 * 「固定套路封装」这层胶水——本文件补齐。
 *
 * 覆盖（默认 key 即工具默认口令派生值，可在参数里改）：
 * - 哥斯拉 PHP_XOR_BASE64：payload = base64( data XOR key )，
 *   XOR 逐字节偏移 key[(i+1)&15]（哥斯拉特有，非标准 i%len）。key 默认
 *   3c6e0b8a9c15224a（= md5("key")[:16]，工具默认密钥「key」的派生）。
 * - 冰蝎 AES-ECB：payload = base64( AES-128-ECB(data, key) )，key 默认
 *   e45e329feb5d925b（= md5("rebeyond")[:16]，冰蝎 v3 默认连接密码派生）。
 *
 * 红线：
 * - 纯本地纯 JS，零外发。复用 modern.js 的 aesEncrypt/aesDecrypt。
 * - key 做成可填参数（直接填 16 字节 ASCII 密钥），不做隐式 md5 派生——
 *   哥斯拉各版本 key 派生规则不一（md5(pass) / md5(pass+key)），隐式派生易错，
 *   显式填 key 最稳、最通用。默认值填工具默认口令的派生，开箱即用。
 * - encode/decode 对称（XOR 自反；AES-ECB 加解密互逆），可 round-trip 单测。
 *
 * detect：base64 且解码后疑似（哥斯拉难判，给低分；冰蝎需正确 key 才能验证，不做强 detect）。
 * 主要靠用户手动选用或一键解码 PARAM_SWEEP 带默认 key 试解。
 */
import { register } from "./registry.js";
import { aesEncrypt, aesDecrypt } from "./modern.js";

// ---------- base64 字节互转（自写，避免依赖 modern.js 内部未导出符号） ----------
function b64ToBytes(s) {
  const bin = atob(String(s).replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(b) {
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin);
}
function asciiToBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
// 明文按 UTF-8 编码（webshell payload 是 UTF-8 字节流，非 ASCII 截断）。
function utf8ToBytes(s) {
  return new TextEncoder().encode(String(s));
}
function bytesToUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

// ---------- 哥斯拉 XOR（偏移 key[(i+1)&15]，自反） ----------
function godzillaXor(data, keyBytes) {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] ^ keyBytes[(i + 1) & 15];
  }
  return out;
}

const GODZILLA_DEFAULT_KEY = "3c6e0b8a9c15224a"; // md5("key")[:16]
const BEHINDER_DEFAULT_KEY = "e45e329feb5d925b"; // md5("rebeyond")[:16]

// ============ 哥斯拉 PHP_XOR_BASE64 ============
register({
  id: "godzillaPhpXorBase64",
  cat: "modern",
  name: "哥斯拉 PHP_XOR_BASE64",
  desc: "Godzilla webshell PHP_XOR_BASE64 流量解密（base64 + XOR，偏移 key[(i+1)&15]）。key 默认 3c6e0b8a9c15224a（密钥「key」派生）",
  params: [
    { key: "key", label: "XOR 密钥（16 字节 ASCII）", type: "text", default: GODZILLA_DEFAULT_KEY, placeholder: GODZILLA_DEFAULT_KEY },
  ],
  // 解密：base64 解码 → XOR → 明文
  decode: (t, p) => {
    const key = asciiToBytes((p && p.key) || GODZILLA_DEFAULT_KEY);
    if (key.length === 0) throw new Error("key 不能为空");
    const cipher = b64ToBytes(t);
    return bytesToUtf8(godzillaXor(cipher, key));
  },
  // 加密：明文 → XOR → base64
  encode: (t, p) => {
    const key = asciiToBytes((p && p.key) || GODZILLA_DEFAULT_KEY);
    if (key.length === 0) throw new Error("key 不能为空");
    const data = utf8ToBytes(t);
    return bytesToB64(godzillaXor(data, key));
  },
});

// ============ 冰蝎 AES-ECB ============
register({
  id: "behinderAesEcb",
  cat: "modern",
  name: "冰蝎 AES-ECB",
  desc: "Behinder(冰蝎) v3 默认 AES-128-ECB 流量解密（base64 + AES-ECB）。key 默认 e45e329feb5d925b（密码「rebeyond」派生）",
  params: [
    { key: "key", label: "AES 密钥（16 字节 ASCII）", type: "text", default: BEHINDER_DEFAULT_KEY, placeholder: BEHINDER_DEFAULT_KEY },
  ],
  // 解密：base64 解码 → AES-ECB 解密 → 明文
  decode: (t, p) => {
    const key = asciiToBytes((p && p.key) || BEHINDER_DEFAULT_KEY);
    if (key.length !== 16) throw new Error("AES 密钥须为 16 字节");
    const cipher = b64ToBytes(t);
    const plain = aesDecrypt(cipher, key, { mode: "ECB", pad: true });
    return bytesToUtf8(plain);
  },
  // 加密：明文 → AES-ECB 加密 → base64
  encode: (t, p) => {
    const key = asciiToBytes((p && p.key) || BEHINDER_DEFAULT_KEY);
    if (key.length !== 16) throw new Error("AES 密钥须为 16 字节");
    const data = utf8ToBytes(t);
    const cipher = aesEncrypt(data, key, { mode: "ECB", pad: true });
    return bytesToB64(cipher);
  },
});

export default {};
