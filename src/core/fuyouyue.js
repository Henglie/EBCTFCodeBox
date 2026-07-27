/*
 * fuyouyue.js — 佛又曰（与佛论禅V2）+ 天书（cat: 'cn'）
 *
 * 组成：
 * - fuyouyue_encropto / fuyouyue_decropto
 * - encrypt / decrypt (AES-CBC OpenSSL Salted__)
 * - bytes_to_key (EVP_BytesToKey, MD5)
 * - pad / unpad (PKCS7, block=16)
 * - get_map_list1/2 (佛又曰 映射表)
 * - get_map_list3/4 (天书 映射表)
 *
 * 算法：UTF-8 → AES-256-CBC(OpenSSL Salted__格式, 随机salt, EVP_BytesToKey/MD5)
 * → base64 → 去掉 "U2FsdGVkX1" 前缀(10字符, = base64("Salted__") 前10字符)
 * → 心经/道经字符映射 → 加前缀
 *
 * 与项目现有 foyu（cn.js 简化版：仅 base64+心经映射，无 AES）的区别：
 * 佛又曰是完整版，多一层 AES-256-CBC 加密，映射表也不同（非心经去重64字）。
 *
 * 复用纯函数：aesEncrypt/aesDecrypt（modern.js）+ md5Bytes（hash.js），单向依赖底层。
 *
 * 注：原实现 get_map_list1/3 中 re_str.replace("\\+", "咩"/"太") 是工具产物
 * "\\+" 在 str.replace 里是字面量 `\+`（base64 不含反斜杠，永不匹配）。
 * decode 侧（list2/4）映射 咩→+ / 太→+，故 encode 正确行为是 +→咩 / +→太。
 * JS 实现照此修正，注释标注。
 */

import { aesEncrypt, aesDecrypt } from "./modern.js";
import { md5Bytes } from "./hash.js";
import { register } from "./registry.js";

// ============================================================
// 字符映射表（get_map_list1-4）
// 格式：src tgt src tgt ...（每 2 字符一对，src=base64字符, tgt=佛经/道经字符）
// ============================================================

// 佛又曰 编码表（get_map_list1，65 对：A-Z a-z 0-9 + / =）
const MAP1 = "e啰E羯t婆T提a摩A埵o诃O迦i耶I吉n娑N佛s夜S驮h那H谨r悉R墀d阿D呼l萨L尼c陀C唵u唎U伊m卢M喝w帝W烁f醯F蒙g罚G沙y嚧Y他p南P豆b无B孕v菩V伽k怛K俱j哆J度x皤X阇q室Q地z利Z遮0穆1参2舍3苏4钵5曳6数7写8栗9楞+咩/输=漫";

// 天书 编码表（get_map_list3，65 对）
const MAP3 = "e渺E莽t茫T乐a生A终o仙O鬼i人I吉n凶N清s灵S空h命H精r炁R神d魔D梵l周L量c道C天u地U荡m度M罗w色W元f始F玄g御G浩y劫Y虚p界P真b实B华v威V运k魂K魄j融J象x霄X冥q照Q净z微Z幽0观1陀2阿3龙4阎5东6西7南8北9玉+太/坤=尊";

// 构建正反映射
function buildMap(pairs) {
  const enc = new Map(); // base64 char → CJK char
  const dec = new Map(); // CJK char → base64 char
  for (let i = 0; i < pairs.length; i += 2) {
    enc.set(pairs[i], pairs[i + 1]);
    dec.set(pairs[i + 1], pairs[i]);
  }
  return { enc, dec };
}

const M1 = buildMap(MAP1); // 佛又曰
const M3 = buildMap(MAP3); // 天书

// ============================================================
// base64 辅助（自包含，同 cn.js 模式）
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
// EVP_BytesToKey（OpenSSL key derivation, MD5）
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
// AES-CBC OpenSSL Salted__ 格式（encrypt/decrypt）
// ============================================================

function randomBytes(n) {
  const arr = new Uint8Array(n);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  return arr;
}

const SALTED = new Uint8Array([0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f]); // "Salted__"

/** 加密：data + passphrase → base64( "Salted__" + salt(8) + AES-CBC-ct ) */
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
  return b64Enc(out); // 返回 base64 字符串
}

/** 解密：base64( "Salted__" + salt + ct ) + passphrase → 明文 bytes */
function decryptSalted(b64, passphrase) {
  const raw = b64Dec(b64);
 // 校验 "Salted__" 头
  for (let i = 0; i < 8; i++) {
    if (raw[i] !== SALTED[i]) throw new Error("密文格式错误：缺少 Salted__ 头");
  }
  const salt = raw.subarray(8, 16);
  const ct = raw.subarray(16);
  const keyIv = bytesToKey(passphrase, salt, 48);
  const key = keyIv.subarray(0, 32);
  const iv = keyIv.subarray(32, 48);
  return aesDecrypt(ct, key, { mode: "CBC", iv, pad: true }); // PKCS7 自动去 pad
}

// ============================================================
// 通用编解码核心（vers=1 佛又曰, vers=2 天书）
// ============================================================

const PROFILES = {
  1: {
    prefix: "佛又曰：",
    prefixAlt: "佛又曰:",
    defaultKey: "takuron.top",
    map: M1,
    stripLen: 4, // "佛又曰：" = 4 字符
  },
  2: {
    prefix: "曰：",
    prefixAlt: "曰:",
    defaultKey: "BlackCat184",
    map: M3,
    stripLen: 2, // "曰：" = 2 字符
  },
};

function fuyouyueEncodeCore(text, vers, keyStr) {
  const p = PROFILES[vers];
  const key = keyStr || p.defaultKey;
  const data = te.encode(text);
  const keyBytes = te.encode(key);
  let b64 = encryptSalted(data, keyBytes);
 // 去掉 "U2FsdGVkX1"（10 字符 = base64("Salted__") 前 10 字符，固定不变）
  b64 = b64.slice(10);
 // 映射 base64 字符 → 佛经/道经字符
  let mapped = "";
  for (const c of b64) mapped += p.map.enc.get(c) || c;
  return p.prefix + mapped;
}

function fuyouyueDecodeCore(text, vers, keyStr) {
  const p = PROFILES[vers];
  const key = keyStr || p.defaultKey;
  let body = text.trim();
 // 去前缀
  if (body.startsWith(p.prefix)) body = body.slice(p.stripLen);
  else if (body.startsWith(p.prefixAlt)) {
 // 半角冒号变体，按字符切
    body = body.slice([...p.prefixAlt].length);
  }
 // 逆映射 佛经/道经字符 → base64 字符
  let b64 = "";
  for (const c of body) b64 += p.map.dec.get(c) || c;
 // 补回 "U2FsdGVkX1"
  b64 = "U2FsdGVkX1" + b64;
 // base64 解码 + AES 解密
  const keyBytes = te.encode(key);
  const pt = decryptSalted(b64, keyBytes);
  return td(pt);
}

// ============================================================
// op 层（params 对象约定，同项目其他 op）
// ============================================================

function fuyouyueEncode(text, params = {}) {
  const key = params.key != null ? params.key : params;
  return fuyouyueEncodeCore(text, 1, typeof key === "string" ? key : "");
}

function fuyouyueDecode(text, params = {}) {
  const key = params.key != null ? params.key : params;
  return fuyouyueDecodeCore(text, 1, typeof key === "string" ? key : "");
}

function tianshuEncode(text, params = {}) {
  const key = params.key != null ? params.key : params;
  return fuyouyueEncodeCore(text, 2, typeof key === "string" ? key : "");
}

function tianshuDecode(text, params = {}) {
  const key = params.key != null ? params.key : params;
  return fuyouyueDecodeCore(text, 2, typeof key === "string" ? key : "");
}

// ============================================================
// 注册
// ============================================================

register({
  id: "fuyouyue", cat: "cn", name: "佛又曰", desc: "与佛论禅V2（AES-256-CBC + 心经字符映射，完整版）",
  encode: fuyouyueEncode, decode: fuyouyueDecode,
  detect: (t) => {
    const s = t.trim();
    return s.startsWith("佛又曰：") || s.startsWith("佛又曰:") ? 0.7 : 0;
  },
});

register({
  id: "tianshu", cat: "cn", name: "天书", desc: "天书曰（AES-256-CBC + 道经字符映射，佛又曰变体）",
  encode: tianshuEncode, decode: tianshuDecode,
  detect: (t) => {
    const s = t.trim();
    if (!s.startsWith("曰：") && !s.startsWith("曰:")) return 0;
 // "曰：" 太泛（日常文本可能含），检查 body 是否全为天书字符
    const body = s.startsWith("曰：") ? s.slice(2) : s.slice([...":"].length);
    if (!body) return 0;
    for (const c of body) {
      if (!M3.dec.has(c)) return 0;
    }
    return 0.15; // 低置信度，防误报
  },
});

export { fuyouyueEncode, fuyouyueDecode, tianshuEncode, tianshuDecode };
