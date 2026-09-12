/*
 * rsasign.js — RSASSA PKCS#1 v1.5 / RSASSA-PSS 签名与验签（任务卡 T347 · 批B1）
 *
 * 标准引用：
 * - RFC 8017 §9.2   EMSA-PKCS1-v1_5：EM = 0x00 || 0x01 || PS(0xFF×≥8) || 0x00 || DigestInfo
 * - RFC 8017 §9.2 注 1：五种哈希 DigestInfo 的 DER 前缀表
 * - RFC 8017 §8.2.2 RSASSA-PKCS1-v1_5 验签（EM 重算逐字节比较）
 * - RFC 8017 §9.1.1 EMSA-PSS 编码（emBits = modBits(n) - 1，DB 掩码后清最左 8·emLen-emBits 位）
 * - RFC 8017 §9.1.2 EMSA-PSS 验证（0xbc 哨兵 / 左位零校验 / DB 结构 / H 重算比对）
 * - RFC 8017 附录 B.2.1 MGF1（掩码生成，counter 4 字节大端）
 * - RFC 8017 §A.1.2 RSAPrivateKey（PKCS#1 私钥 DER）/ RFC 5208 §5 PrivateKeyInfo（PKCS#8）
 * - RFC 5280 §4.1 SubjectPublicKeyInfo（公钥 SPKI DER，BIT STRING 内嵌 RSAPublicKey）
 *
 * 哈希策略（沿 ecdsa.js 既有模式）：SHA-1/256/384/512 走 globalThis.crypto.subtle（异步，
 * 浏览器与 Node 18+ 全有，不 import node:crypto）；MD5 WebCrypto 不支持 → 复用 hash.js
 * 纯实现 md5Bytes。运算复用：modPow 复用 primeGen.js，DER 解析复用 rsagen.js。
 * PSS salt 由 crypto.getRandomValues 生成（RSASSA-PSS 签名天然随机，同钥同文两次签名不同，属预期）。
 */

import { register } from "./registry.js";
import { modPow } from "./primeGen.js";
import { derDecode, derBytesToBigint } from "./rsagen.js";
import { md5Bytes } from "./hash.js";

// ============================================================
// 基础字节工具
// ============================================================

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** 十六进制串 → Uint8Array。容忍空白与 0x 前缀；奇数长度报错（防静默丢位）。 */
function hexToBytes(hex) {
  const s = String(hex || "").trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]*$/.test(s)) throw new Error("hex 输入含非十六进制字符");
  if (s.length % 2) throw new Error("hex 输入长度为奇数（hex 必须按字节成对）");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

/** 十进制字符串 → BigInt（容忍空白/下划线；非十进制字符报错） */
function decToBigint(s, what) {
  const t = String(s || "").trim().replace(/[\s_]/g, "");
  if (!/^[0-9]+$/.test(t)) throw new Error(`${what} 不是合法十进制整数`);
  return BigInt(t);
}

/** 非负 BigInt → 固定 len 字节大端（I2OSP，RFC 8017 §4.1；越界报错） */
function bigintToBytes(v, len, what) {
  if (v < 0n) throw new Error(`${what} 为负数，无法按大端无符号输出`);
  const b = v.toString(16).padStart(2, "0");
  const raw = hexToBytes(b.length % 2 ? "0" + b : b);
  if (raw.length > len) throw new Error(`${what} 超出 ${len} 字节（I2OSP 越界）`);
  const out = new Uint8Array(len);
  out.set(raw, len - raw.length);
  return out;
}

/** 字节串 → BigInt（OS2IP，RFC 8017 §4.2，大端无符号） */
function bytesToBigint(bytes) {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

/** BigInt 位长（正整数） */
function bigintBitLen(v) {
  return v.toString(2).length;
}

// ============================================================
// 哈希分发
// ============================================================

/** 五种哈希：摘要长度 + DigestInfo DER 前缀 hex（RFC 8017 §9.2 注 1） */
const HASHES = {
  md5: {
    label: "MD5", hLen: 16,
    digestInfo: "3020300c06082a864886f70d020505000410", // DigestInfo(MD5)
  },
  sha1: {
    label: "SHA-1", hLen: 20,
    digestInfo: "3021300906052b0e03021a05000414", // DigestInfo(SHA-1)
  },
  sha256: {
    label: "SHA-256", hLen: 32,
    digestInfo: "3031300d060960864801650304020105000420", // DigestInfo(SHA-256)
  },
  sha384: {
    label: "SHA-384", hLen: 48,
    digestInfo: "3041300d060960864801650304020205000430", // DigestInfo(SHA-384)
  },
  sha512: {
    label: "SHA-512", hLen: 64,
    digestInfo: "3051300d060960864801650304020305000440", // DigestInfo(SHA-512)
  },
};

const HASH_OPTIONS = Object.entries(HASHES).map(([value, h]) => ({
  value, label: `${h.label}（${h.hLen} 字节摘要）`,
}));

/** 字节级摘要。MD5 纯 JS，其余 WebCrypto（与 ecdsa.js shaBytes 同模式） */
async function hashBytes(hashKey, data) {
  const h = HASHES[hashKey];
  if (!h) throw new Error(`未知哈希 ${hashKey}`);
  if (hashKey === "md5") return md5Bytes(data);
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto（需 HTTPS 或 localhost）");
  return new Uint8Array(await crypto.subtle.digest(h.label, data));
}

// ============================================================
// MGF1（RFC 8017 附录 B.2.1）
// ============================================================

/** mask = T0||T1||…，Ti = Hash(seed || I2OSP(i, 4))，截取 maskLen */
async function mgf1(hashKey, seed, maskLen) {
  const hLen = HASHES[hashKey].hLen;
  const out = new Uint8Array(Math.ceil(maskLen / hLen) * hLen);
  const block = new Uint8Array(seed.length + 4);
  block.set(seed, 0);
  let o = 0;
  for (let counter = 0; o < out.length; counter++) {
    block[seed.length] = (counter >>> 24) & 0xff;
    block[seed.length + 1] = (counter >>> 16) & 0xff;
    block[seed.length + 2] = (counter >>> 8) & 0xff;
    block[seed.length + 3] = counter & 0xff;
    const t = await hashBytes(hashKey, block);
    out.set(t, o);
    o += t.length;
  }
  return out.subarray(0, maskLen);
}

// ============================================================
// EMSA-PKCS1-v1_5（RFC 8017 §9.2）
// ============================================================

/** 构造 EM = 0x00 || 0x01 || PS(0xFF) || 0x00 || DigestInfo||mHash */
function buildV15Em(mHash, hashKey, emLen) {
  const h = HASHES[hashKey];
  const prefix = hexToBytes(h.digestInfo);
  const tLen = prefix.length + h.hLen;
  if (emLen < tLen + 11) {
    // RFC 8017 §9.2 步骤 3：emLen < tLen + 11 → "intended encoded message length too short"
    throw new Error(`模数太短：emLen=${emLen} < tLen+11=${tLen + 11}（${h.label} 的 v1.5 签名至少需 ${(tLen + 11) * 8} 位模数）`);
  }
  const em = new Uint8Array(emLen);
  em[0] = 0x00;
  em[1] = 0x01;
  const psLen = emLen - tLen - 3; // RFC 8017 §9.2 步骤 4：PS 全 0xFF，长度 emLen - tLen - 3 ≥ 8
  em.fill(0xff, 2, 2 + psLen);
  em[2 + psLen] = 0x00;
  em.set(prefix, 3 + psLen);
  em.set(mHash, 3 + psLen + prefix.length);
  return em;
}

// ============================================================
// EMSA-PSS（RFC 8017 §9.1.1 编码 / §9.1.2 验证）
// ============================================================

/** 编码：EM = maskedDB || H || 0xbc，emBits = modBits(n) - 1。返回 { em, salt } */
async function buildPssEm(mHash, hashKey, emBits, sLen) {
  const hLen = HASHES[hashKey].hLen;
  const emLen = Math.ceil(emBits / 8);
  if (emLen < hLen + sLen + 2) {
    // RFC 8017 §9.1.1 步骤 3：emLen < hLen + sLen + 2 → "encoding error"
    throw new Error(`模数太短：emLen=${emLen} < hLen+sLen+2=${hLen + sLen + 2}（PSS 需降低哈希档位或减小盐长）`);
  }
  // 盐：密码学随机（RFC 8017 §9.1.1 步骤 4）
  const salt = new Uint8Array(sLen);
  if (sLen > 0) globalThis.crypto.getRandomValues(salt);
  // M' = 0x00×8 || mHash || salt（步骤 5-6）
  const mPrime = new Uint8Array(8 + hLen + sLen);
  mPrime.set(mHash, 8);
  mPrime.set(salt, 8 + hLen);
  const H = await hashBytes(hashKey, mPrime);
  // DB = PS(0x00) || 0x01 || salt（步骤 7-8）
  const dbLen = emLen - hLen - 1;
  const DB = new Uint8Array(dbLen);
  DB[dbLen - sLen - 1] = 0x01;
  DB.set(salt, dbLen - sLen);
  // maskedDB = DB ⊕ MGF1(H, emLen - hLen - 1)（步骤 9-10）
  const dbMask = await mgf1(hashKey, H, dbLen);
  const maskedDB = new Uint8Array(dbLen);
  for (let i = 0; i < dbLen; i++) maskedDB[i] = DB[i] ^ dbMask[i];
  // 清 maskedDB 最左 8·emLen - emBits 位（步骤 11）
  const clearBits = 8 * emLen - emBits;
  maskedDB[0] &= 0xff >> clearBits;
  const em = new Uint8Array(emLen);
  em.set(maskedDB, 0);
  em.set(H, dbLen);
  em[emLen - 1] = 0xbc; // 步骤 12
  return { em, salt };
}

/**
 * 验证：按 §9.1.2 步骤 3-11 检查 EM。
 * sLen = null 表示"自动"：从 DB 恢复的 0x01 边界反推盐长（OpenSSL rsa_pss_saltlen:auto 同义）。
 * @returns {{ok: boolean, reason: string, salt?: Uint8Array, H?: Uint8Array}}
 */
async function verifyPssEm(em, mHash, hashKey, emBits, sLen) {
  const hLen = HASHES[hashKey].hLen;
  const emLen = em.length;
  if (emLen < hLen + 2) return { ok: false, reason: `EM 过短（${emLen} < hLen+2=${hLen + 2}）` };
  if (em[emLen - 1] !== 0xbc) return { ok: false, reason: "EM 末字节不是哨兵 0xbc" };
  const dbLen = emLen - hLen - 1;
  const maskedDB = em.subarray(0, dbLen);
  const H = em.subarray(dbLen, dbLen + hLen);
  // 最左 8·emLen - emBits 位必须全零（§9.1.2 步骤 6）
  const clearBits = 8 * emLen - emBits;
  if (clearBits && (maskedDB[0] >> (8 - clearBits)) !== 0) {
    return { ok: false, reason: `maskedDB 最左 ${clearBits} 位不全为 0` };
  }
  // DB = maskedDB ⊕ MGF1(H, ...)（步骤 7-8），并把最左位重新清零
  const dbMask = await mgf1(hashKey, H, dbLen);
  const DB = new Uint8Array(dbLen);
  for (let i = 0; i < dbLen; i++) DB[i] = maskedDB[i] ^ dbMask[i];
  DB[0] &= 0xff >> clearBits;
  // 自动盐长：找 PS 全零段后的 0x01 边界
  let sLenEff = sLen;
  if (sLen == null) {
    let idx = 0;
    while (idx < dbLen && DB[idx] === 0) idx++;
    if (idx >= dbLen || DB[idx] !== 0x01) {
      return { ok: false, reason: "DB 中找不到 PS 全零段后的 0x01 边界（自动盐长失败）", H };
    }
    sLenEff = dbLen - idx - 1;
  }
  if (emLen < hLen + sLenEff + 2) {
    return { ok: false, reason: `盐长不合法：emLen=${emLen} < hLen+sLen+2=${hLen + sLenEff + 2}`, H };
  }
  // 步骤 9：DB 前 emLen - hLen - sLenEff - 2 字节全零
  const psLen = emLen - hLen - sLenEff - 2;
  for (let i = 0; i < psLen; i++) {
    if (DB[i] !== 0) return { ok: false, reason: `DB 的 PS 段第 ${i} 字节非 0x00（盐长与签名不符）`, H };
  }
  // 步骤 10：DB[psLen] == 0x01
  if (DB[psLen] !== 0x01) {
    return { ok: false, reason: `DB 的 PS 段后一字节是 0x${DB[psLen].toString(16).padStart(2, "0")} 不是 0x01`, H };
  }
  const salt = DB.subarray(psLen + 1);
  // 步骤 11：H' = Hash(0x00×8 || mHash || salt) 与 H 比对
  const mPrime = new Uint8Array(8 + hLen + salt.length);
  mPrime.set(mHash, 8);
  mPrime.set(salt, 8 + hLen);
  const hCheck = await hashBytes(hashKey, mPrime);
  for (let i = 0; i < hLen; i++) {
    if (hCheck[i] !== H[i]) return { ok: false, reason: "H' ≠ H（消息或签名被篡改，或哈希/盐长不匹配）", salt, H };
  }
  return { ok: true, reason: "PSS 全部校验通过", salt, H };
}

// ============================================================
// PEM 解析（复用 rsagen.js 的 DER 解码）
// ============================================================

/** PEM → { label, der }。剥头尾行、聚 base64、atob 解码（RFC 7468 文本约定） */
function pemToDer(pem) {
  const m = String(pem || "").replace(/\r/g, "").match(
    /-----BEGIN ([A-Z0-9 ]+)-----([A-Za-z0-9+/=\s]+?)-----END \1-----/,
  );
  if (!m) throw new Error("PEM 未找到 -----BEGIN/END----- 区块");
  const b64 = m[2].replace(/\s+/g, "");
  if (typeof atob !== "function") throw new Error("当前环境缺少 atob，无法解析 PEM");
  const bin = atob(b64);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return { label: m[1], der };
}

/** 校验 DER 节点是 tag 期望的 INTEGER 并转 BigInt */
function childInt(seq, i, what, ctx) {
  const node = seq.children[i];
  if (!node || node.tag !== 0x02) throw new Error(`${ctx}：第 ${i} 个子节点不是 INTEGER（${what}）`);
  return derBytesToBigint(node.value);
}

/**
 * 私钥 PEM → { n, e, d }。
 * 支持三种标签：RSA PRIVATE KEY（PKCS#1，RFC 8017 §A.1.2）、PRIVATE KEY（PKCS#8，RFC 5208）
 */
function parsePrivatePem(pem) {
  const { label, der } = pemToDer(pem);
  const root = derDecode(der);
  if (root.tag !== 0x30) throw new Error("PEM 根节点不是 SEQUENCE");
  if (label === "RSA PRIVATE KEY") {
    // RSAPrivateKey ::= SEQUENCE { version, n, e, d, p, q, dp, dq, qinv }
    if (root.children.length < 4) throw new Error("PKCS#1 私钥字段不足（需 version/n/e/d）");
    return { n: childInt(root, 1, "n", "PKCS#1 私钥"), e: childInt(root, 2, "e", "PKCS#1 私钥"), d: childInt(root, 3, "d", "PKCS#1 私钥") };
  }
  if (label === "PRIVATE KEY") {
    // PrivateKeyInfo ::= SEQUENCE { version, AlgorithmIdentifier, privateKey OCTET STRING }
    const octet = root.children && root.children[2];
    if (!octet || octet.tag !== 0x04) throw new Error("PKCS#8 私钥第 3 字段不是 OCTET STRING");
    const inner = derDecode(octet.value); // privateKey 字段内嵌完整 PKCS#1 RSAPrivateKey（RFC 5208 §5）
    if (inner.tag !== 0x30 || inner.children.length < 4) throw new Error("PKCS#8 内嵌 PKCS#1 私钥结构不完整");
    return { n: childInt(inner, 1, "n", "PKCS#8 内嵌私钥"), e: childInt(inner, 2, "e", "PKCS#8 内嵌私钥"), d: childInt(inner, 3, "d", "PKCS#8 内嵌私钥") };
  }
  throw new Error(`私钥 PEM 标签「${label}」不受支持（支持 RSA PRIVATE KEY / PRIVATE KEY）`);
}

/**
 * 公钥 PEM → { n, e }。
 * 支持两种标签：PUBLIC KEY（SPKI，RFC 5280 §4.1）、RSA PUBLIC KEY（PKCS#1 RSAPublicKey）
 */
function parsePublicPem(pem) {
  const { label, der } = pemToDer(pem);
  const root = derDecode(der);
  if (root.tag !== 0x30) throw new Error("PEM 根节点不是 SEQUENCE");
  if (label === "PUBLIC KEY") {
    // SubjectPublicKeyInfo ::= SEQUENCE { AlgorithmIdentifier, subjectPublicKey BIT STRING }
    const bit = root.children && root.children[1];
    if (!bit || bit.tag !== 0x03) throw new Error("SPKI 公钥第 2 字段不是 BIT STRING");
    if (bit.value[0] !== 0) throw new Error("SPKI BIT STRING 的 unused-bits 非 0（X.690 §8.6.4）");
    const inner = derDecode(bit.value.subarray(1)); // BIT STRING 内容 = RSAPublicKey SEQUENCE{n,e}
    if (inner.tag !== 0x30 || inner.children.length < 2) throw new Error("SPKI 内嵌 RSAPublicKey 结构不完整");
    return { n: childInt(inner, 0, "n", "SPKI 公钥"), e: childInt(inner, 1, "e", "SPKI 公钥") };
  }
  if (label === "RSA PUBLIC KEY") {
    // RSAPublicKey ::= SEQUENCE { n, e }（RFC 8017 §A.1.1）
    if (root.children.length < 2) throw new Error("PKCS#1 公钥字段不足（需 n/e）");
    return { n: childInt(root, 0, "n", "PKCS#1 公钥"), e: childInt(root, 1, "e", "PKCS#1 公钥") };
  }
  throw new Error(`公钥 PEM 标签「${label}」不受支持（支持 PUBLIC KEY / RSA PUBLIC KEY）`);
}

// ============================================================
// 签名 / 验签公共入口
// ============================================================

/** 消息 → 字节（text 走 UTF-8，hex 走字节对） */
function messageBytes(text, msgEnc) {
  if (msgEnc === "hex") return hexToBytes(text);
  return new TextEncoder().encode(String(text ?? ""));
}

/** 解析 saltLen 参数 → 实际值（hLen / emLen-hLen-2 上限 / 数字）；null = 自动（仅验签） */
function resolveSaltLen(raw, hashKey, emLen, what) {
  const hLen = HASHES[hashKey].hLen;
  if (raw == null || raw === "" || raw === "hlen") return hLen;
  if (raw === "max") return emLen - hLen - 2;
  if (raw === "auto") {
    if (what === "sign") throw new Error("签名不能用「自动」盐长（自动是验签时从 DB 反推的选项）");
    return null;
  }
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 0 || v > 65535) throw new Error(`盐长「${raw}」不合法（0..65535 的整数）`);
  return v;
}

/** EM → 签名 s = EM^d mod n → k 字节大端 hex */
function rsaSignEm(em, d, n) {
  const k = Math.ceil(bigintBitLen(n) / 8);
  const s = modPow(bytesToBigint(em), d, n); // RSASP1（RFC 8017 §5.2.1）：s = m^d mod n
  return { sigBytes: bigintToBytes(s, k, "签名值"), s };
}

/**
 * 签名。mode = "pkcs1v15" | "pss"。
 * @returns {{sig: Uint8Array, mHash: Uint8Array, em?: Uint8Array, salt?: Uint8Array, emBits, emLen, sLen}}
 */
async function rsaSignRaw(msgBytes, hashKey, mode, d, n, sLenRaw) {
  const k = Math.ceil(bigintBitLen(n) / 8);
  const mHash = await hashBytes(hashKey, msgBytes);
  if (mode === "pkcs1v15") {
    const em = buildV15Em(mHash, hashKey, k); // v1.5 的 emBits 即 8k（n 首位为 1 时等价 modBits）
    const { sigBytes } = rsaSignEm(em, d, n);
    return { sig: sigBytes, mHash, em, emBits: 8 * k, emLen: k, sLen: null };
  }
  const emBits = bigintBitLen(n) - 1; // PSS：emBits = modBits(n) - 1（RFC 8017 §9.1.1 步骤 1-2）
  const emLen = Math.ceil(emBits / 8);
  const sLen = resolveSaltLen(sLenRaw, hashKey, emLen, "sign");
  const { em, salt } = await buildPssEm(mHash, hashKey, emBits, sLen);
  const { sigBytes } = rsaSignEm(em, d, n);
  return { sig: sigBytes, mHash, em, salt, emBits, emLen, sLen };
}

/** 验签。返回 { ok, reason, 中间量 } */
async function rsaVerifyRaw(msgBytes, sigBytes, hashKey, mode, e, n, sLenRaw) {
  const k = Math.ceil(bigintBitLen(n) / 8);
  const s = bytesToBigint(sigBytes);
  // RFC 8017 §8.2.2 步骤 2：s 不在 [0, n-1] → invalid
  if (s <= 0n || s >= n) return { ok: false, reason: `签名整数 s 不在 [1, n-1] 区间（s 位长 ${bigintBitLen(s)} vs n 位长 ${bigintBitLen(n)}）` };
  const mHash = await hashBytes(hashKey, msgBytes);
  const em = bigintToBytes(modPow(s, e, n), k, "恢复的 EM"); // RSAVP1（RFC 8017 §5.2.2）
  if (mode === "pkcs1v15") {
    let expected;
    try {
      expected = buildV15Em(mHash, hashKey, k); // RFC 8017 §8.2.2 步骤 3：重算 EM 逐字节比较
    } catch (err) {
      return { ok: false, reason: `期望 EM 构造失败：${err.message}`, em, mHash };
    }
    const psLen = k - (HASHES[hashKey].digestInfo.length / 2 + HASHES[hashKey].hLen) - 3;
    for (let i = 0; i < k; i++) {
      if (em[i] !== expected[i]) {
        const where = i < 2 ? `头部标记位（第 ${i} 字节）` : i < 2 + psLen ? `PS 0xFF 段（第 ${i} 字节，实为 0x${em[i].toString(16).padStart(2, "0")}）` : `DigestInfo/摘要区（第 ${i} 字节）`;
        return { ok: false, reason: `EM 结构或摘要比对失败：${where}与期望不符`, em, expected, mHash, psLen };
      }
    }
    return { ok: true, reason: "PKCS#1 v1.5 全部校验通过", em, expected, mHash, psLen };
  }
  const emBits = bigintBitLen(n) - 1;
  const emLen = Math.ceil(emBits / 8);
  if (em.length !== emLen && em.length !== k) {
    return { ok: false, reason: `恢复 EM 长度 ${em.length} 异常（k=${k}）`, em, mHash };
  }
  const sLen = resolveSaltLen(sLenRaw, hashKey, emLen, "verify");
  const r = await verifyPssEm(em, mHash, hashKey, emBits, sLen);
  return { ...r, em, mHash, emBits, emLen, sLen: sLen == null ? r.salt?.length ?? null : sLen };
}

// ============================================================
// op 参数选项
// ============================================================

const MODE_OPTIONS = [
  { value: "pkcs1v15", label: "PKCS#1 v1.5（确定性，RFC 8017 §8.2/§9.2）" },
  { value: "pss", label: "PSS（概率性，RFC 8017 §8.1/§9.1）" },
];

const MSG_ENC_OPTIONS = [
  { value: "text", label: "文本（UTF-8）" },
  { value: "hex", label: "hex 字节" },
];

const KEY_ENC_OPTIONS = [
  { value: "dec", label: "十进制参数" },
  { value: "pem", label: "PEM" },
];

const SIG_ENC_OPTIONS = [
  { value: "hex", label: "hex" },
  { value: "dec", label: "十进制" },
];

const saltOption = (v, label) => ({ value: v, label });
const SALT_OPTIONS_SIGN = [
  saltOption("hlen", "默认 = hLen（摘要长度）"),
  saltOption("0", "0（无盐）"),
  saltOption("16", "16 字节"),
  saltOption("20", "20 字节"),
  saltOption("32", "32 字节"),
  saltOption("max", "最大 = emLen - hLen - 2"),
];
const SALT_OPTIONS_VERIFY = [
  ...SALT_OPTIONS_SIGN,
  saltOption("auto", "自动（从 DB 的 0x01 边界反推，OpenSSL auto 同义）"),
];

// ============================================================
// op 注册
// ============================================================

register({
  id: "rsaSign", family: "rsa", familyLabel: "sign",
  cat: "asym",
  name: "RSA 签名",
  desc: "RSASSA PKCS#1 v1.5 与 PSS 签名（RFC 8017）：EM 按 §9.2/§9.1 构造后 s = EM^d mod n（modPow 复用 primeGen）。私钥支持十进制 n,d 或 PEM（PKCS#1 RSA PRIVATE KEY / PKCS#8 PRIVATE KEY）。PSS 盐长默认 hLen；同钥同文两次签名不同是 PSS 随机盐的预期行为。512 位模数跑不了 SHA-256 以上的 PSS（emLen < hLen+sLen+2），换大钥或减盐长",
  params: [
    { key: "mode", label: "签名模式", type: "select", default: "pkcs1v15", options: MODE_OPTIONS },
    { key: "hash", label: "哈希", type: "select", default: "sha256", options: HASH_OPTIONS },
    { key: "msgEnc", label: "消息输入", type: "select", default: "text", options: MSG_ENC_OPTIONS },
    { key: "keyEnc", label: "私钥形式", type: "select", default: "dec", options: KEY_ENC_OPTIONS },
    { key: "n", label: "模数 n（十进制）", type: "text", default: "", placeholder: "keyEnc=十进制参数时必填" },
    { key: "d", label: "私钥指数 d（十进制）", type: "text", default: "", placeholder: "keyEnc=十进制参数时必填" },
    { key: "privPem", label: "私钥 PEM", type: "text", default: "", placeholder: "keyEnc=PEM 时必填（-----BEGIN RSA PRIVATE KEY----- 或 PRIVATE KEY）" },
    { key: "saltLen", label: "盐长 sLen（仅 PSS）", type: "select", default: "hlen", options: SALT_OPTIONS_SIGN },
  ],
  run: async (text, p = {}) => {
    const mode = p.mode || "pkcs1v15";
    const hashKey = p.hash || "sha256";
    if (!HASHES[hashKey]) throw new Error(`不支持的哈希 ${hashKey}`);
    let n, d;
    if ((p.keyEnc || "dec") === "pem") {
      ({ n, d } = parsePrivatePem(p.privPem));
    } else {
      n = decToBigint(p.n, "模数 n");
      d = decToBigint(p.d, "私钥指数 d");
    }
    if (n < 3n || d <= 0n || d >= n) throw new Error("n/d 参数不合法（需 n ≥ 3 且 0 < d < n）");
    const msg = messageBytes(text, p.msgEnc || "text");

    const r = await rsaSignRaw(msg, hashKey, mode, d, n, p.saltLen);
    const k = Math.ceil(bigintBitLen(n) / 8);
    const lines = [
      `RSASSA-${mode === "pss" ? "PSS" : "PKCS1-v1_5"} 签名 · ${HASHES[hashKey].label} · ${bigintBitLen(n)} 位模数`,
      `消息摘要 mHash (${HASHES[hashKey].label}) = ${toHex(r.mHash)}`,
      "",
      `签名 s (hex, ${r.sig.length} 字节) = ${toHex(r.sig)}`,
      `签名 s (十进制) = ${bytesToBigint(r.sig)}`,
      "",
      "---- 中间量 ----",
      `EM 长度 emLen = ${r.emLen} 字节，emBits = ${r.emBits}`,
    ];
    if (mode === "pkcs1v15") {
      const h = HASHES[hashKey];
      const tLen = h.digestInfo.length / 2 + h.hLen;
      lines.push(
        `PS 长度 = ${r.emLen - tLen - 3} 字节（全 0xFF）`,
        `EM (hex) = ${toHex(r.em)}`,
        "",
        `可把 s(hex) 与消息交给「RSA 验签」对拍；OpenSSL 对拍：openssl dgst -${hashKey === "sha256" ? "sha256" : hashKey} -sign key.pem msg.bin（v1.5 签名确定性，应逐字节相等）`,
      );
    } else {
      lines.push(
        `盐长 sLen = ${r.sLen} 字节`,
        `salt (hex) = ${toHex(r.salt)}`,
        `H = Hash(0x00×8 || mHash || salt) = ${toHex(r.em.subarray(r.emLen - 1 - HASHES[hashKey].hLen, r.emLen - 1))}`,
        `EM (hex) = ${toHex(r.em)}`,
        "",
        "PSS 签名带随机盐，同钥同文重复签名结果不同（RFC 8017 §8.1 属概率性方案，非缺陷）",
      );
    }
    // T364：签名出 .sig 二进制产物（字节与文本区 hex 一致；文件名含哈希名）
    const files = [{ name: `rsa_sig_${hashKey}.sig`, mime: "application/octet-stream", bytes: r.sig }];
    lines.push("", `产物：1 个文件可下载（${files[0].name}，字节与上方签名 hex 一致）`);
    return { text: lines.join("\n"), files };
  },
});

register({
  id: "rsaVerify", family: "rsa", familyLabel: "verify",
  cat: "asym",
  name: "RSA 验签",
  desc: "RSASSA PKCS#1 v1.5 与 PSS 验签（RFC 8017 §8.2.2/§8.1.2）：s^e mod n 恢复 EM 后逐项校验（v1.5 重算 EM 逐字节比较；PSS 查 0xbc 哨兵/左位零/DB 结构/H 重算），输出合法/不合法与失败位置。公钥支持十进制 n,e 或 PEM（PUBLIC KEY SPKI / RSA PUBLIC KEY）。签名 hex 或十进制。PSS 盐长可选自动反推",
  params: [
    { key: "mode", label: "签名模式", type: "select", default: "pkcs1v15", options: MODE_OPTIONS },
    { key: "hash", label: "哈希", type: "select", default: "sha256", options: HASH_OPTIONS },
    { key: "msgEnc", label: "消息输入", type: "select", default: "text", options: MSG_ENC_OPTIONS },
    { key: "sigEnc", label: "签名输入", type: "select", default: "hex", options: SIG_ENC_OPTIONS },
    { key: "sig", label: "签名 s", type: "text", default: "", placeholder: "按「签名输入」格式填 hex 或十进制" },
    { key: "keyEnc", label: "公钥形式", type: "select", default: "dec", options: KEY_ENC_OPTIONS },
    { key: "n", label: "模数 n（十进制）", type: "text", default: "", placeholder: "keyEnc=十进制参数时必填" },
    { key: "e", label: "公钥指数 e（十进制）", type: "text", default: "65537", placeholder: "常用 65537" },
    { key: "pubPem", label: "公钥 PEM", type: "text", default: "", placeholder: "keyEnc=PEM 时必填（-----BEGIN PUBLIC KEY----- 或 RSA PUBLIC KEY）" },
    { key: "saltLen", label: "盐长 sLen（仅 PSS）", type: "select", default: "hlen", options: SALT_OPTIONS_VERIFY },
  ],
  run: async (text, p = {}) => {
    const mode = p.mode || "pkcs1v15";
    const hashKey = p.hash || "sha256";
    if (!HASHES[hashKey]) throw new Error(`不支持的哈希 ${hashKey}`);
    let n, e;
    if ((p.keyEnc || "dec") === "pem") {
      ({ n, e } = parsePublicPem(p.pubPem));
    } else {
      n = decToBigint(p.n, "模数 n");
      e = decToBigint(p.e ?? "65537", "公钥指数 e");
    }
    if (n < 3n || e <= 0n || e >= n) throw new Error("n/e 参数不合法（需 n ≥ 3 且 0 < e < n）");
    const msg = messageBytes(text, p.msgEnc || "text");

    const sigBytes = (p.sigEnc || "hex") === "dec"
      ? bigintToBytes(decToBigint(p.sig, "签名 s"), Math.ceil(bigintBitLen(n) / 8), "签名 s")
      : hexToBytes(p.sig);

    const r = await rsaVerifyRaw(msg, sigBytes, hashKey, mode, e, n, p.saltLen);
    const lines = [
      `RSASSA-${mode === "pss" ? "PSS" : "PKCS1-v1_5"} 验签 · ${HASHES[hashKey].label} · ${bigintBitLen(n)} 位模数`,
      `消息摘要 mHash (${HASHES[hashKey].label}) = ${toHex(r.mHash)}`,
      "",
      r.ok ? "验签结果：合法 ✓" : `验签结果：不合法 ×`,
      `原因：${r.reason}`,
      "",
      "---- 中间量 ----",
      `恢复的 EM (hex) = ${r.em ? toHex(r.em) : "(未恢复)"}`,
    ];
    if (mode === "pkcs1v15") {
      if (r.expected) lines.push(`期望的 EM (hex) = ${toHex(r.expected)}`, `PS 长度 = ${r.psLen} 字节（全 0xFF）`);
      lines.push("判据：EM 与重算期望逐字节相等（RFC 8017 §8.2.2 步骤 3）");
    } else {
      lines.push(`emBits = ${r.emBits}，emLen = ${r.emLen} 字节`);
      if (r.H) lines.push(`签名携带的 H = ${toHex(r.H)}`);
      if (r.salt) lines.push(`恢复的 salt (hex) = ${toHex(r.salt)}`, `盐长 = ${r.salt.length} 字节`);
      lines.push("判据：末字节 0xbc + 最左位全零 + DB 结构(PS零/0x01/salt) + H 重算比对（RFC 8017 §9.1.2）");
    }
    return lines.join("\n");
  },
});
