/*
 * jwtsign.js — JWT 签发 / 验签（T348 批B2，cat:'crypto'）。
 *
 * op：
 *   - jwtSign   HS256/HS384/HS512（HMAC）+ RS256（RSA PKCS#1 v1.5）+ ES256（ECDSA P-256）
 *   - jwtVerify 重算签名逐段比对，输出合法/不合法 + 哪段不匹配
 *
 * 复用（不复制）：
 *   - token.js   b64urlEncodeBytes/b64urlDecodeToBytes/hmacShaBytes（WebCrypto HMAC，RFC 2104）
 *   - modern.js  rsaPow/bytesToBigInt（RSA 模幂）
 *   - ecdsa.js   CURVES.p256/ecdsaSignRaw/ecdsaVerifyRaw/hashToE/parsePoint（FIPS 186-4，RFC 6979 确定 k）
 *   - rsagen.js  derSeq/derInt/derNull/derOid/derOctetString/derEncode（X.690 DER 原语）
 *
 * 参考：RFC 7519 (JWT)、RFC 7515 (JWS，base64url 无填充三段式)、RFC 7518 §3
 * （HS256/384/512、RS256、ES256 参数与签名格式）、RFC 8017 §9.2（EMSA-PKCS1-v1_5 编码，
 * SHA-256 DigestInfo 前缀 = 30 31 30 0d 06 09 60864801650304020105000420）。
 */

import { register } from "./registry.js";
import { b64urlEncodeBytes, b64urlDecodeToBytes, hmacShaBytes } from "./token.js";
import { rsaPow, bytesToBigInt } from "./modern.js";
import { CURVES, ecdsaSignRaw, ecdsaVerifyRaw, hashToE, parsePoint } from "./ecdsa.js";
import { derEncode, derSeq, derNull, derOid, derOctetString } from "./rsagen.js";

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

// HS* → WebCrypto 哈希名（RFC 7518 §3.1）
const HS_HASH = { HS256: "SHA-256", HS384: "SHA-384", HS512: "SHA-512" };

// ============================================================
// 工具
// ============================================================
function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** BigInt → 定长大端字节（len 不足补前导 0，超长抛错）。 */
function bigIntToBytesN(v, len, label) {
  let hex = v.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  if (hex.length / 2 > len) throw new Error(`${label} 超过 ${len} 字节`);
  hex = hex.padStart(len * 2, "0");
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** 大整数输入解析：0x 前缀或含 a-f → hex；纯数字 → 十进制（rsagen 输出十进制 n/e/d）。 */
function parseBigIntAuto(raw, label) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) throw new Error(`缺少参数 ${label}`);
  if (/^0x/i.test(s)) return BigInt(s);
  if (/^[0-9a-f]+$/i.test(s) && /[a-f]/i.test(s)) return BigInt("0x" + s);
  if (/^[0-9]+$/.test(s)) return BigInt(s);
  throw new Error(`${label} 含非法字符（支持 hex（含 0x 前缀或带 a-f 字母）或十进制）: ${s.slice(0, 32)}…`);
}

async function shaBytes(normName, data) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto");
  return new Uint8Array(await crypto.subtle.digest(normName, data));
}

/** 常量时间比较（防时序侧信道，RFC 7515 §10.6 精神）。 */
function ctEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

const byteLenOf = (n) => (BigInt(n).toString(16).length + 1) >> 1;

// ============================================================
// RS256：EMSA-PKCS1-v1_5（RFC 8017 §9.2）
// ============================================================
// DigestInfo 嵌**哈希算法** OID（RFC 8017 §9.2 注 1；非外层 sha256WithRSAEncryption）：
// SHA-256 = 2.16.840.1.101.3.4.2.1（608648016503040201）等
const RS_DIGEST_INFO = {
  "MD5": { oid: [1, 2, 840, 113549, 2, 5] },
  "SHA-1": { oid: [1, 3, 14, 3, 2, 26] },
  "SHA-256": { oid: [2, 16, 840, 1, 101, 3, 4, 2, 1] },
  "SHA-384": { oid: [2, 16, 840, 1, 101, 3, 4, 2, 2] },
  "SHA-512": { oid: [2, 16, 840, 1, 101, 3, 4, 2, 3] },
};

/** DigestInfo DER = SEQ(SEQ(OID, NULL), OCTETSTRING(digest))，用 rsagen 的 DER 原语构造。 */
function digestInfoDer(hashNorm, digest) {
  const spec = RS_DIGEST_INFO[hashNorm];
  if (!spec) throw new Error(`不支持的哈希: ${hashNorm}`);
  return derEncode(derSeq(
    derSeq(derOid(spec.oid), derNull()),
    derOctetString(digest),
  ));
}

/** EMSA-PKCS1-v1_5 编码：EM = 0x00 01 FF..FF 00 T（RFC 8017 §9.2 步骤 5-8，PS≥8）。 */
function emsaPkcs1v15(hashNorm, digest, k) {
  const T = digestInfoDer(hashNorm, digest);
  const psLen = k - T.length - 3;
  if (psLen < 8) throw new Error(`模长过短：k=${k} 字节无法容纳 DigestInfo（RFC 8017 §9.2 要求 PS≥8）`);
  const em = new Uint8Array(k);
  em[0] = 0x00;
  em[1] = 0x01;
  em.fill(0xff, 2, 2 + psLen);
  em[2 + psLen] = 0x00;
  em.set(T, 3 + psLen);
  return em;
}

/** RS256 签名（RFC 8017 §8.2.1）：s = EM^d mod n → 定长 k 字节。 */
function rs256Sign(n, d, signingInputBytes) {
  const k = byteLenOf(n);
  const digest = shaBytes("SHA-256", signingInputBytes); // async 由调用方 await
  return digest.then((h) => {
    const em = emsaPkcs1v15("SHA-256", h, k);
    const sig = rsaPow(bytesToBigInt(em), d, n);
    return bigIntToBytesN(sig, k, "RSA 签名");
  });
}

/** RS256 验签（RFC 8017 §8.2.2）：m = s^e mod n，与期望 EM 全字节比对。 */
async function rs256Verify(n, e, signingInputBytes, sigBytes) {
  const k = byteLenOf(n);
  if (sigBytes.length !== k) return { valid: false, reason: `签名长度 ${sigBytes.length} ≠ 模长 k=${k}` };
  const h = await shaBytes("SHA-256", signingInputBytes);
  const emExpected = emsaPkcs1v15("SHA-256", h, k);
  const m = rsaPow(bytesToBigInt(sigBytes), e, n);
  const emActual = bigIntToBytesN(m, k, "EM");
  return { valid: ctEqual(emExpected, emActual), reason: "EMSA-PKCS1-v1_5 编码比对" };
}

// ============================================================
// op 1 · jwtSign
// ============================================================
async function jwtSignRun(text, p = {}) {
  const alg = p.alg || "HS256";

  // payload 必须为合法 JSON（RFC 7519 §4），紧凑序列化入 token
  let payloadObj;
  try {
    payloadObj = JSON.parse(String(text == null ? "" : text));
  } catch {
    throw new Error("payload 须为合法 JSON（RFC 7519 §4 claims 对象）");
  }
  const header = { alg, typ: "JWT" };
  if (p.kid != null && String(p.kid).trim() !== "") header.kid = String(p.kid).trim();

  const headerB64 = b64urlEncodeBytes(te(JSON.stringify(header)));
  const payloadB64 = b64urlEncodeBytes(te(JSON.stringify(payloadObj)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const inputBytes = te(signingInput);

  let sigBytes;
  const L = [];
  if (HS_HASH[alg]) {
    const secret = String(p.secret == null ? "" : p.secret);
    if (!secret) throw new Error(`HS* 签发需要密钥参数 secret（${alg}）`);
    sigBytes = await hmacShaBytes(alg, te(secret), inputBytes);
  } else if (alg === "RS256") {
    const n = parseBigIntAuto(p.rsaN, "rsaN（RSA 模数 n，hex 或十进制）");
    const d = parseBigIntAuto(p.rsaD, "rsaD（RSA 私钥指数 d）");
    if (n <= 0xffn) throw new Error("rsaN 非法（过小）");
    sigBytes = await rs256Sign(n, d, inputBytes);
  } else if (alg === "ES256") {
    const c = CURVES.p256;
    const d = parseBigIntAuto(p.ecPriv, "ecPriv（P-256 私钥标量 d，hex 或十进制）");
    const { r, s } = await ecdsaSignRaw(c, d, inputBytes, "sha256", "rfc6979");
    // JOSE 签名格式：raw r||s 各 32 字节大端（RFC 7515/7518 §3.4）
    const bl = 32;
    const out = new Uint8Array(bl * 2);
    out.set(bigIntToBytesN(r, bl, "r"), 0);
    out.set(bigIntToBytesN(s, bl, "s"), bl);
    sigBytes = out;
  } else {
    throw new Error(`不支持的 alg: ${alg}（本工具支持 HS256/HS384/HS512/RS256/ES256）`);
  }

  const jwt = `${signingInput}.${b64urlEncodeBytes(sigBytes)}`;
  L.push("=== JWT 签发 ===");
  L.push(`算法: ${alg}`);
  L.push(`header  = ${JSON.stringify(header)}`);
  L.push(`  b64url = ${headerB64}`);
  L.push(`payload = ${JSON.stringify(payloadObj)}`);
  L.push(`  b64url = ${payloadB64}`);
  if (alg === "ES256") L.push(`k 模式: RFC 6979 确定 k（签名可复现）`);
  L.push("");
  L.push(`签名 (hex, ${sigBytes.length} B) = ${bytesToHex(sigBytes)}`);
  L.push("");
  L.push(`JWT = ${jwt}`);
  // T364 产物协议：完整 JWT 三段串出 token.jwt 文本产物
  const files = [{ name: "token.jwt", mime: "text/plain", bytes: te(jwt) }];
  L.push("", `产物：1 个文件可下载（${files[0].name}，内容与上方 JWT 一致）`);
  return { text: L.join("\n"), files };
}

// ============================================================
// op 2 · jwtVerify
// ============================================================
async function jwtVerifyRun(text, p = {}) {
  const token = String(text == null ? "" : text).trim();
  const parts = token.split(".");
  const L = [];
  L.push("=== JWT 验签 ===");

  if (parts.length !== 3) {
    L.push(`✗ 结构错误：须为 header.payload.signature 三段（RFC 7515），当前 ${parts.length} 段`);
    L.push("");
    L.push("结论: 不合法（格式错误）");
    return L.join("\n");
  }
  const [hB64, pB64, sB64] = parts;

  // 逐段 base64url 解码
  let headerBytes, payloadBytes, sigBytes;
  try {
    headerBytes = b64urlDecodeToBytes(hB64);
  } catch {
    L.push("✗ header 段不是合法 base64url");
    L.push("结论: 不合法（header 段格式错误）");
    return L.join("\n");
  }
  try {
    payloadBytes = b64urlDecodeToBytes(pB64);
  } catch {
    L.push("✗ payload 段不是合法 base64url");
    L.push("结论: 不合法（payload 段格式错误）");
    return L.join("\n");
  }
  try {
    sigBytes = b64urlDecodeToBytes(sB64);
  } catch {
    L.push("✗ signature 段不是合法 base64url");
    L.push("结论: 不合法（signature 段格式错误）");
    return L.join("\n");
  }

  let header, payload;
  try {
    header = JSON.parse(td(headerBytes));
  } catch {
    L.push("✗ header 段解码后不是合法 JSON");
    L.push("结论: 不合法（header 段格式错误）");
    return L.join("\n");
  }
  try {
    payload = JSON.parse(td(payloadBytes));
  } catch {
    L.push("✗ payload 段解码后不是合法 JSON（JWT 声明集须为 JSON 对象）");
    L.push("结论: 不合法（payload 段格式错误）");
    return L.join("\n");
  }

  const alg = String(header.alg || "");
  L.push(`header  = ${JSON.stringify(header)}`);
  L.push(`payload = ${JSON.stringify(payload)}`);
  L.push(`alg = ${alg}   签名段长度 = ${sigBytes.length} B`);
  L.push("");

  if (alg === "none") {
    L.push(sigBytes.length === 0 ? "✓ alg=none 且签名段为空（RFC 7519 §6，无完整性保护）" : "✗ alg=none 但签名段非空");
    L.push(`结论: ${sigBytes.length === 0 ? "结构合法（alg=none，无签名保护，警惕降级攻击）" : "不合法（alg=none 签名段应空）"}`);
    return L.join("\n");
  }

  const signingInputBytes = te(`${hB64}.${pB64}`);
  let ok = false, detail = "";

  try {
    if (HS_HASH[alg]) {
      const secret = String(p.secret == null ? "" : p.secret);
      if (!secret) throw new Error(`缺少参数 secret（${alg} 验签需要 HMAC 密钥）`);
      const expect = await hmacShaBytes(alg, te(secret), signingInputBytes);
      ok = ctEqual(expect, sigBytes);
      detail = `重算 HMAC = ${bytesToHex(expect)} / 签名段 = ${bytesToHex(sigBytes)}`;
    } else if (alg === "RS256") {
      const n = parseBigIntAuto(p.rsaN, "rsaN（RSA 模数 n）");
      const e = parseBigIntAuto(p.rsaE == null || p.rsaE === "" ? "65537" : p.rsaE, "rsaE");
      const v = await rs256Verify(n, e, signingInputBytes, sigBytes);
      ok = v.valid;
      detail = v.valid === false && v.reason ? v.reason : "EMSA-PKCS1-v1_5 全字节比对（RFC 8017 §8.2.2）";
    } else if (alg === "ES256") {
      const c = CURVES.p256;
      if (sigBytes.length !== 64) throw new Error(`ES256 签名须为 64 字节（r||s 各 32，RFC 7518 §3.4），当前 ${sigBytes.length}`);
      const Q = parsePoint(p.ecPub, c, "ecPub（P-256 公钥点，04||X||Y hex 或压缩 hex）");
      if (!Q) throw new Error("公钥不能为无穷远点");
      const r = bytesToBigInt(sigBytes.subarray(0, 32));
      const s = bytesToBigInt(sigBytes.subarray(32, 64));
      const h1 = await shaBytes("SHA-256", signingInputBytes);
      const e = hashToE(h1, c);
      const v = ecdsaVerifyRaw(c, Q, r, s, e);
      ok = v.valid;
      detail = v.valid === false && v.reason ? v.reason : "ECDSA P-256 验签（FIPS 186-4）通过";
    } else {
      L.push(`✗ 不支持的 alg: ${alg || "(header 缺 alg)"}`);
      L.push("结论: 不合法（算法不支持）");
      return L.join("\n");
    }
  } catch (err) {
    L.push(`✗ 验签失败: ${err.message}`);
    L.push("");
    L.push("结论: 不合法（密钥参数错误或缺失）");
    return L.join("\n");
  }

  L.push(ok ? "✓ 签名匹配（signature 段校验通过）" : "✗ 签名不匹配（signature 段校验失败）");
  if (!ok && detail && !detail.startsWith("重算")) L.push(`  原因: ${detail}`);
  if (!ok && detail.startsWith("重算")) L.push(`  ${detail}`);
  L.push("");
  L.push(`结论: ${ok ? "合法（三段结构与签名均通过）" : "不合法（signature 段与密钥重算结果不一致）"}`);
  return L.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "jwtSign", family: "jwt", familyLabel: "sign",
  cat: "modern",
  name: "JWT 签发",
  desc: "JWT 签发（HS256/384/512 + RS256 + ES256，RFC 7519/7518）",
  params: [
    { key: "alg", label: "算法 alg", type: "select", default: "HS256", options: ["HS256", "HS384", "HS512", "RS256", "ES256"] },
    { key: "secret", label: "HMAC 密钥 secret（HS* 用，text）", type: "text", default: "", placeholder: "HS256/384/512 必填" },
    { key: "rsaN", label: "RSA 模数 n（RS256 用，hex 或十进制）", type: "text", default: "", placeholder: "RS256 必填" },
    { key: "rsaD", label: "RSA 私钥指数 d（RS256 用）", type: "text", default: "", placeholder: "RS256 必填" },
    { key: "ecPriv", label: "P-256 私钥 d（ES256 用，hex 或十进制）", type: "text", default: "", placeholder: "ES256 必填" },
    { key: "kid", label: "key id（可选，写入 header）", type: "text", default: "" },
  ],
  run: jwtSignRun,
});

register({
  id: "jwtVerify", family: "jwt", familyLabel: "verify",
  cat: "modern",
  name: "JWT 验签",
  desc: "JWT 三段解析 + 重算签名比对（HS*/RS256/ES256），指出不匹配段",
  params: [
    { key: "secret", label: "HMAC 密钥 secret（HS* 用）", type: "text", default: "" },
    { key: "rsaN", label: "RSA 模数 n（RS256 用）", type: "text", default: "" },
    { key: "rsaE", label: "RSA 公钥指数 e（RS256 用，默认 65537）", type: "text", default: "65537" },
    { key: "ecPub", label: "P-256 公钥（ES256 用，04||X||Y hex）", type: "text", default: "" },
  ],
  run: jwtVerifyRun,
});
