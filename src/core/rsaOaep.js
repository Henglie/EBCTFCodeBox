/*
 * rsaOaep.js — RSAES-OAEP 加密 / 解密（RFC 8017 §7.1，PKCS#1 v2.2）。
 *
 * 编码方法 EME-OAEP（RFC 8017 §7.1.1）：
 *   EM = 0x00 ‖ maskedSeed ‖ maskedDB
 *   DB  = lHash ‖ PS ‖ 0x01 ‖ M     （lHash = Hash(L)，L 为空标签 → Hash("")）
 *   maskedDB = DB ⊕ MGF1(seed, k-hLen-1)
 *   maskedSeed = seed ⊕ MGF1(maskedDB, hLen)
 *   密文 C = RSAEP((n,e), OS2IP(EM))，即 EM^e mod n，定宽 k 字节。
 * 哈希档：SHA-1（互操作默认）与 SHA-256；MGF1 与 OAEP 哈希同源
 *   （OpenSSL/Node `RSA_PKCS1_OAEP_PADDING` 同款口径，可互解）。
 *
 * 密钥输入：加密 = 公钥（PEM 或 n,e 十进制）；解密 = 私钥（PEM 或 n,e,d 十进制）。
 * 随机性：加密 seed 默认取统一随机源（randSource.randomBytes），
 *   可显式给 seed（hLen 字节 hex）用于确定性复现。解密不取随机。
 *
 * 红线：纯 BigInt 本地计算，零外发；与 node:crypto（OpenSSL）逐字节对拍通过。
 *       解密失败统一报错文案，不区分「格式错 / 密钥错」（RFC 8017 §7.1.2 侧信道要求，
 *       本工具按显式报错处理并如实告知该限制）。
 */

import { register } from "./registry.js";
import { modPow } from "./primeGen.js";
import { derDecode, derBytesToBigint } from "./rsagen.js";
import { randomBytes as randBytes } from "./randSource.js"; // 统一随机源（默认档 system 逐字节零回归）

const HASHES = {
  sha1: { label: "SHA-1", hLen: 20, subtleName: "SHA-1" },
  sha256: { label: "SHA-256", hLen: 32, subtleName: "SHA-256" },
};
const HASH_OPTIONS = Object.entries(HASHES).map(([value, h]) => ({
  value, label: `${h.label}（hLen=${h.hLen} 字节，MGF1 同源）`,
}));

async function hashBytes(hashKey, data) {
  const h = HASHES[hashKey];
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto（需 HTTPS 或 localhost）");
  return new Uint8Array(await crypto.subtle.digest(h.subtleName, data));
}

/** MGF1（RFC 8017 附录 B.2.1）：T = Hash(seed‖I2OSP(counter,4)) 串联截断。 */
async function mgf1(hashKey, seed, maskLen) {
  const hLen = HASHES[hashKey].hLen;
  const out = new Uint8Array(maskLen);
  const block = new Uint8Array(seed.length + 4);
  block.set(seed, 0);
  let o = 0;
  for (let counter = 0; o < out.length; counter++) {
    block[seed.length] = (counter >>> 24) & 0xff;
    block[seed.length + 1] = (counter >>> 16) & 0xff;
    block[seed.length + 2] = (counter >>> 8) & 0xff;
    block[seed.length + 3] = counter & 0xff;
    const t = await hashBytes(hashKey, block);
    const take = Math.min(t.length, out.length - o);
    out.set(t.subarray(0, take), o);
    o += take;
  }
  return out;
}

// ---- 字节助手 ----
function hexToBytes(hex, label = "hex") {
  const s = String(hex == null ? "" : hex).trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (!s) throw new Error(`缺少输入（${label}）`);
  if (s.length % 2 || /[^0-9a-fA-F]/.test(s)) throw new Error(`${label} 非法：须为偶数个 hex 字符`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(b) { return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join(""); }
function bigIntToBytes(v, len) {
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  if (v !== 0n) throw new Error("整数转字节：长度不足（数值超出定宽）");
  return out;
}
function bytesToBigInt(b) { let x = 0n; for (const c of b) x = (x << 8n) | BigInt(c); return x; }
function xorBytes(a, b) {
  if (a.length !== b.length) throw new Error("内部错误：XOR 长度不一致");
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] ^ b[i];
  return out;
}

// ---- RSA 密钥解析（十进制 / PEM） ----
function parseBigAuto(t, label) {
  const s = String(t == null ? "" : t).trim();
  if (!s) throw new Error(`缺少参数：${label}`);
  let v;
  if (/^0x/i.test(s)) {
    if (!/^[0-9a-f]+$/i.test(s.slice(2)) || s.slice(2).length === 0) throw new Error(`${label} 非法：0x 后须为 hex`);
    v = BigInt(s);
  } else if (/^[0-9]+$/.test(s)) {
    v = BigInt(s);
  } else {
    throw new Error(`${label} 非法：须为十进制或 0x 前缀 hex`);
  }
  return v;
}

function pemToDer(pem) {
  const s = String(pem || "").replace(/\r/g, "").trim();
  const m = s.match(/^-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----$/);
  if (!m) throw new Error("PEM 非法：未找到完整 BEGIN/END 段");
  const b64 = m[2].replace(/[^A-Za-z0-9+/=]/g, "");
  const bin = atob(b64);
  if (bin.length === 0) throw new Error("PEM 非法：Base64 体为空");
  return { label: m[1], der: Uint8Array.from(bin, (ch) => ch.charCodeAt(0)) };
}

/** DER SEQUENCE(RSAPublicKey) → {n,e}。 */
function rsaPubFromDer(der) {
  const root = derDecode(der);
  if (root.tag !== 0x30) throw new Error("RSA 公钥 DER 非法：根须为 SEQUENCE");
  const kids = root.children;
  if (kids.length === 2 && kids[0].tag === 0x02 && kids[1].tag === 0x02) {
    return { n: derBytesToBigint(kids[0].value), e: derBytesToBigint(kids[1].value) };
  }
  throw new Error("RSA 公钥 DER 非法：非 RSAPublicKey SEQUENCE{INTEGER n, INTEGER e}");
}

/** 公钥 PEM（PKCS#1 或 X.509 SubjectPublicKeyInfo）→ {n,e}。 */
function parsePublicPem(pem) {
  const { label, der } = pemToDer(pem);
  if (label === "RSA PUBLIC KEY") return rsaPubFromDer(der);
  if (label === "PUBLIC KEY") {
    const root = derDecode(der); // SubjectPublicKeyInfo
    if (root.tag !== 0x30 || root.children.length < 2) throw new Error("SPKI 非法：结构不符");
    const bit = root.children[1];
    if (bit.tag !== 0x03 || bit.value.length < 1 || bit.value[0] !== 0) {
      throw new Error("SPKI 非法：subjectPublicKey 须为 0 未用位的 BIT STRING");
    }
    return rsaPubFromDer(bit.value.subarray(1));
  }
  throw new Error(`PEM 非法：加密需公钥（RSA PUBLIC KEY / PUBLIC KEY），收到 ${label}`);
}

/** 私钥 PEM（PKCS#1 RSAPrivateKey 或 PKCS#8）→ {n,e,d}。 */
function parsePrivatePem(pem) {
  const { label, der } = pemToDer(pem);
  if (label === "RSA PRIVATE KEY") return rsaPrivFromDer(der);
  if (label === "PRIVATE KEY") {
    const root = derDecode(der); // PKCS#8 PrivateKeyInfo
    if (root.tag !== 0x30 || root.children.length < 3) throw new Error("PKCS#8 非法：结构不符");
    const oct = root.children[2];
    if (oct.tag !== 0x04) throw new Error("PKCS#8 非法：缺 privateKey OCTET STRING");
    return rsaPrivFromDer(oct.value);
  }
  throw new Error(`PEM 非法：解密需私钥（RSA PRIVATE KEY / PRIVATE KEY），收到 ${label}（加密口令私钥不支持）`);
}
function rsaPrivFromDer(der) {
  const root = derDecode(der);
  if (root.tag !== 0x30 || root.children.length < 4) throw new Error("RSAPrivateKey DER 非法：字段不足");
  const [v, n, e, d] = root.children;
  if (v.tag !== 0x02 || n.tag !== 0x02 || e.tag !== 0x02 || d.tag !== 0x02) {
    throw new Error("RSAPrivateKey DER 非法：前四项须为 INTEGER（version,n,e,d）");
  }
  if (derBytesToBigint(v.value) !== 0n) throw new Error("RSAPrivateKey 版本须为 0（多素数不支持）");
  return { n: derBytesToBigint(n.value), e: derBytesToBigint(e.value), d: derBytesToBigint(d.value) };
}

function keyModulusBytes(k) { return (k.n.toString(2).length + 7) >> 3; }

// ---- EME-OAEP ----
async function oaepEncode(hashKey, msg, k, seed) {
  const h = HASHES[hashKey];
  const hLen = h.hLen;
  const maxLen = k - 2 * hLen - 2;
  if (msg.length > maxLen) {
    throw new Error(`明文超长：${msg.length} 字节 > k-2hLen-2 = ${maxLen} 字节（k=${k}，${h.label}）`);
  }
  const lHash = await hashBytes(hashKey, new Uint8Array(0));
  const ps = new Uint8Array(maxLen - msg.length);
  const db = new Uint8Array(k - hLen - 1);
  db.set(lHash, 0);
  db.set(ps, hLen);
  db[hLen + ps.length] = 1;
  db.set(msg, hLen + ps.length + 1);
  const dbMask = await mgf1(hashKey, seed, k - hLen - 1);
  const maskedDB = xorBytes(db, dbMask);
  const seedMask = await mgf1(hashKey, maskedDB, hLen);
  const maskedSeed = xorBytes(seed, seedMask);
  const em = new Uint8Array(k);
  em[0] = 0;
  em.set(maskedSeed, 1);
  em.set(maskedDB, 1 + hLen);
  return em;
}

async function oaepDecode(hashKey, em, k) {
  const h = HASHES[hashKey];
  const hLen = h.hLen;
  if (em[0] !== 0) throw OAEP_ERR;
  const maskedSeed = em.slice(1, 1 + hLen);
  const maskedDB = em.slice(1 + hLen);
  const seedMask = await mgf1(hashKey, maskedDB, hLen);
  const seed = xorBytes(maskedSeed, seedMask);
  const dbMask = await mgf1(hashKey, seed, k - hLen - 1);
  const db = xorBytes(maskedDB, dbMask);
  const lHash = await hashBytes(hashKey, new Uint8Array(0));
  let bad = 0;
  for (let i = 0; i < hLen; i++) if (db[i] !== lHash[i]) bad = 1;
  let idx = hLen;
  while (idx < db.length && db[idx] === 0) idx++;
  if (idx >= db.length || db[idx] !== 1) bad = 1;
  if (bad) throw OAEP_ERR;
  return db.slice(idx + 1);
}

const OAEP_ERR = new Error("OAEP 解密失败：密文与密钥/哈希档不匹配，或数据被篡改（错误类型按统一文案报告，防侧信道区分）");

// 核心加密/解密原语（导出供验证/复用）
/** RSAES-OAEP 加密：返回定宽 k 字节密文。 */
export async function rsaOaepEncrypt(key, hashKey, msg, seed) {
  const k = keyModulusBytes(key);
  const em = await oaepEncode(hashKey, msg, k, seed);
  return bigIntToBytes(modPow(bytesToBigInt(em), key.e, key.n), k);
}
/** RSAES-OAEP 解密：返回明文字节；失败抛统一错误。 */
export async function rsaOaepDecrypt(key, hashKey, ct) {
  const k = keyModulusBytes(key);
  if (ct.length !== k) throw new Error(`密文长度须等于模数字节数 k = ${k}，当前 ${ct.length} 字节`);
  const c = bytesToBigInt(ct);
  if (c >= key.n) throw new Error(`密文数值 ≥ n（超出 RSA 定义域，k = ${k} 字节）`);
  const em = bigIntToBytes(modPow(c, key.d, key.n), k);
  return oaepDecode(hashKey, em, k);
}

function tryUtf8(b) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(b); } catch { return null; }
}

const PUB_PARAMS = [
  { key: "hash", label: "哈希（OAEP+MGF1 同源）", type: "select", default: "sha256", options: HASH_OPTIONS },
  { key: "keyEnc", label: "公钥格式", type: "select", default: "pem", options: [
    { value: "pem", label: "PEM（PUBLIC KEY / RSA PUBLIC KEY）" },
    { value: "dec", label: "十进制 n, e" },
  ] },
  { key: "n", label: "模数 n（dec 档）", type: "text", default: "", placeholder: "十进制或 0x hex" },
  { key: "e", label: "指数 e（dec 档）", type: "text", default: "65537", placeholder: "十进制，常用 65537" },
  { key: "pem", label: "公钥 PEM（pem 档）", type: "text", default: "", placeholder: "-----BEGIN PUBLIC KEY-----…" },
  { key: "seed", label: "seed（可选，hLen 字节 hex）", type: "text", default: "", placeholder: "留空取随机；给定则密文可复现" },
];

const PRIV_PARAMS = [
  { key: "hash", label: "哈希（OAEP+MGF1 同源）", type: "select", default: "sha256", options: HASH_OPTIONS },
  { key: "keyEnc", label: "私钥格式", type: "select", default: "pem", options: [
    { value: "pem", label: "PEM（PRIVATE KEY / RSA PRIVATE KEY）" },
    { value: "dec", label: "十进制 n, e, d" },
  ] },
  { key: "n", label: "模数 n（dec 档）", type: "text", default: "", placeholder: "十进制或 0x hex" },
  { key: "e", label: "指数 e（dec 档）", type: "text", default: "", placeholder: "十进制" },
  { key: "d", label: "私钥指数 d（dec 档）", type: "text", default: "", placeholder: "十进制或 0x hex" },
  { key: "pem", label: "私钥 PEM（pem 档）", type: "text", default: "", placeholder: "-----BEGIN PRIVATE KEY-----…" },
];

// ============================================================
// 两档（族滑块）：加密 / 解密
// ============================================================

register({
  id: "rsaOaepEnc",
  cat: "asym",
  family: "rsaOaep",
  familyLabel: "enc",
  name: "RSA-OAEP 加密",
  desc: "RSAES-OAEP（RFC 8017 §7.1，PKCS#1 v2.2）：EME-OAEP 填充 + RSAEP。哈希 SHA-1/SHA-256（MGF1 同源，与 OpenSSL/Node 口径一致可互解）。公钥 PEM（PKCS#1/SPKI）或 n,e 十进制；seed 可留空随机（增强随机性开关生效）或给定复现",
  params: PUB_PARAMS,
  run: async (text, p) => {
    const msg = typeof text === "string" ? new TextEncoder().encode(text) : new Uint8Array(text || []);
    if (msg.length === 0) throw new Error("明文为空：请输入要加密的文本");
    const hashKey = String((p && p.hash) || "sha256");
    if (!HASHES[hashKey]) throw new Error(`未知哈希档：${hashKey}`);
    const key = ((p && p.keyEnc) === "dec")
      ? { n: parseBigAuto(p.n, "模数 n"), e: parseBigAuto(p.e, "指数 e") }
      : parsePublicPem(p && p.pem);
    const k = keyModulusBytes(key);
    const hLen = HASHES[hashKey].hLen;
    const seedRaw = (p && p.seed && String(p.seed).trim());
    const seed = seedRaw ? (() => {
      const b = hexToBytes(seedRaw, "seed");
      if (b.length !== hLen) throw new Error(`seed 长度须等于 hLen = ${hLen} 字节（${hashKey}），当前 ${b.length} 字节`);
      return b;
    })() : randBytes(hLen);
    const em = await oaepEncode(hashKey, msg, k, seed);
    const c = modPow(bytesToBigInt(em), key.e, key.n);
    const ct = bigIntToBytes(c, k);
    const bits = k * 8;
    return [
      "=== RSA-OAEP 加密 ===",
      `密钥：${((p && p.keyEnc) === "dec") ? `n, e（十进制，${bits} 位）` : "PEM 公钥"}，哈希 ${HASHES[hashKey].label}`,
      `明文：${msg.length} 字节（上限 k-2hLen-2 = ${k - 2 * hLen - 2}）`,
      `seed（${seedRaw ? "给定" : "随机"}）= ${bytesToHex(seed)}`,
      "",
      `密文（${k} 字节 hex）= ${bytesToHex(ct)}`,
      "",
      "说明：对拍命令 node:crypto publicEncrypt(RSA_PKCS1_OAEP_PADDING, oaepHash 同档) 应逐字节相等（seed 给定时）。",
    ].join("\n");
  },
});

register({
  id: "rsaOaepDec",
  cat: "asym",
  family: "rsaOaep",
  familyLabel: "dec",
  name: "RSA-OAEP 解密",
  desc: "RSAES-OAEP 解密（RFC 8017 §7.1.2）：RSADP + EME-OAEP 解码。私钥 PEM（PKCS#1/PKCS#8）或 n,e,d 十进制；哈希档须与加密一致。失败统一文案报错（防 Manger 类区分）；解密不取随机",
  params: PRIV_PARAMS,
  run: async (text, p) => {
    const ct = hexToBytes(text, "密文 hex");
    const hashKey = String((p && p.hash) || "sha256");
    if (!HASHES[hashKey]) throw new Error(`未知哈希档：${hashKey}`);
    const key = ((p && p.keyEnc) === "dec")
      ? { n: parseBigAuto(p.n, "模数 n"), e: parseBigAuto(p.e, "指数 e"), d: parseBigAuto(p.d, "私钥指数 d") }
      : parsePrivatePem(p && p.pem);
    const k = keyModulusBytes(key);
    if (ct.length !== k) throw new Error(`密文长度须等于模数字节数 k = ${k}，当前 ${ct.length} 字节`);
    const c = bytesToBigInt(ct);
    if (c >= key.n) throw new Error(`密文数值 ≥ n（超出 RSA 定义域，k = ${k} 字节）`);
    const m = modPow(c, key.d, key.n);
    const em = bigIntToBytes(m, k);
    const msg = await oaepDecode(hashKey, em, k);
    const utf8 = tryUtf8(msg);
    const lines = [
      "=== RSA-OAEP 解密 ===",
      `密钥：${((p && p.keyEnc) === "dec") ? "n, e, d（十进制）" : "PEM 私钥"}，哈希 ${HASHES[hashKey].label}`,
      `明文（${msg.length} 字节 hex）= ${bytesToHex(msg)}`,
    ];
    if (utf8 != null) lines.push(`明文（UTF-8）= ${utf8}`);
    lines.push("", "说明：二进制明文请用 hex 行；与「RSA-OAEP 加密」往返自洽，node:crypto privateDecrypt 同档可互解。");
    return lines.join("\n");
  },
});
