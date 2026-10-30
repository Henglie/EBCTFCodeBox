/*
 * pkcs12.js — PKCS#12 / PFX 容器解析（含口令解密与 MAC 校验）。
 *
 * 标准依据（照标准实现，不编造）：
 * - PFX 结构 = RFC 7292（PKCS#12 v1.1）§4：SEQ{ version=3, authSafe ContentInfo,
 *   [0] macData 可选 }；authSafe(data) 内嵌 DER AuthenticatedSafe = SEQ OF ContentInfo，
 *   每项为 data（明文 SafeContents）或 encryptedData（SEQ{version, EncryptedContentInfo}，
 *   其 [0] 为 IMPLICIT OCTET STRING）。
 * - SafeBag = SEQ{ bagId OID, [0] bagValue, 属性 SET 可选 }；keyBag / pkcs8ShroudedKeyBag /
 *   certBag（CertBag 内 x509Certificate）等 bagId 见 §4.2-4.3。
 * - 口令 KDF = RFC 7292 附录 B：口令为 UTF-16BE（无 BOM）+ 2 字节 0x00 终止（空口令 =
 *   空字节串，与 OpenSSL 行为一致）；D/S/P/I 拼装，A=H^r(D‖I)，B=AI 重复到 v 字节，
 *   I_j=(I_j+B+1) mod 2^v；ID=1 密钥 / 2 IV / 3 MAC 密钥；SHA-1 u=20 v=64，SHA-256 u=32 v=64。
 * - 传统 PBE OID：pbeWithSHAAnd{3-Key,2-Key}TripleDES-CBC = 1.2.840.113549.1.12.1.{3,4}，
 *   pbeWithSHAAnd{128,40}BitRC2-CBC = 1.2.840.113549.1.12.1.{5,6}；参数 pkcs-12PbeParams
 *   SEQ{ salt, iterations }。
 * - PBES2 = RFC 8018：PBKDF2（PRF hmacWithSHA1/224/256/384/512）+ AES-128/192/256-CBC 或
 *   des-ede3-cbc；填充为 PKCS#7。
 * - RC2 = RFC 2268：PITABLE、64 字展开、5+1+6+1+5 轮 mix/mash；解密为其逆。
 * - MAC = RFC 7292 §4/附录 A：DigestInfo{ OID, digest } + iterationCount + macSalt，
 *   MAC 密钥由 ID=3 KDF 派生，HMAC 作用于 authSafe 内容字节。
 * - 只解析展示，不做证书链验证；私钥/证书只输出 PEM，口令本地处理零外发。
 *
 * 复用：DER 解码 ← rsagen.js；AES-CBC ← modern.js；3DES-CBC ← modern.js。
 */

import { register } from "./registry.js";
import { derDecode, derEncode, derToPem } from "./rsagen.js";
import { aesDecrypt, des3Decrypt } from "./modern.js";

// ============================================================
// 基础工具
// ============================================================

function bytesToHex(b) { let s = ""; for (const x of b) s += x.toString(16).padStart(2, "0"); return s; }
function te(s) { return new TextEncoder().encode(String(s)); }

function b64ToBytes(s) {
  const t = String(s || "").replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
  if (!t) throw new Error("base64 输入为空");
  const pad = (4 - (t.length % 4)) % 4;
  let out = "";
  try { out = atob(t + "=".repeat(pad)); } catch { throw new Error("base64 解码失败（字符集非法）"); }
  const u8 = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) u8[i] = out.charCodeAt(i);
  return u8;
}

function hexToBytes(hex) {
  const t = String(hex || "").trim().replace(/^(0x|0X)/, "").replace(/\s+/g, "");
  if (!t) throw new Error("hex 输入为空");
  if (!/^[0-9a-fA-F]+$/.test(t) || t.length % 2) throw new Error("hex 输入非法（含非 hex 字符或奇数长度）");
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.substr(i * 2, 2), 16);
  return out;
}

/** OID 内容字节 → 弧数组（X.690 §8.19） */
export function oidFromBytes(content) {
  if (content.length === 0) throw new Error("OID 内容为空");
  const arcs = [];
  let v = 0n;
  for (const b of content) {
    v = (v << 7n) | BigInt(b & 0x7f);
    if (!(b & 0x80)) { arcs.push(v); v = 0n; }
  }
  if (content[content.length - 1] & 0x80) throw new Error("OID 以续位字节结尾");
  const first = arcs[0];
  const a0 = first >= 80n ? 2n : first / 40n;
  return [Number(a0), Number(first - 40n * a0), ...arcs.slice(1).map(Number)];
}

const oidKey = (arcs) => arcs.join(".");
const OID = {
  data: "1.2.840.113549.1.7.1",
  encryptedData: "1.2.840.113549.1.7.6",
  pbes2: "1.2.840.113549.1.5.13",
  pbkdf2: "1.2.840.113549.1.5.12",
  hmacSha1: "1.2.840.113549.2.7",
  hmacSha224: "1.2.840.113549.2.8",
  hmacSha256: "1.2.840.113549.2.9",
  hmacSha384: "1.2.840.113549.2.10",
  hmacSha512: "1.2.840.113549.2.11",
  pbeSha1Tdes3: "1.2.840.113549.1.12.1.3",
  pbeSha1Tdes2: "1.2.840.113549.1.12.1.4",
  pbeSha1Rc2_128: "1.2.840.113549.1.12.1.5",
  pbeSha1Rc2_40: "1.2.840.113549.1.12.1.6",
  keyBag: "1.2.840.113549.1.12.10.1.1",
  pkcs8ShroudedKeyBag: "1.2.840.113549.1.12.10.1.2",
  certBag: "1.2.840.113549.1.12.10.1.3",
  crlBag: "1.2.840.113549.1.12.10.1.4",
  secretBag: "1.2.840.113549.1.12.10.1.5",
  safeContentsBag: "1.2.840.113549.1.12.10.1.6",
  x509Certificate: "1.2.840.113549.1.9.22.1",
  sdsiCertificate: "1.2.840.113549.1.9.22.2",
  friendlyName: "1.2.840.113549.1.9.20",
  localKeyID: "1.2.840.113549.1.9.21",
  sha1: "1.3.14.3.2.26",
  sha224: "2.16.840.1.101.3.4.2.4",
  sha256: "2.16.840.1.101.3.4.2.1",
  sha384: "2.16.840.1.101.3.4.2.2",
  sha512: "2.16.840.1.101.3.4.2.3",
  desEde3Cbc: "1.2.840.113549.3.7",
  rc2Cbc: "1.2.840.113549.3.2",
  aes128Cbc: "2.16.840.1.101.3.4.1.2",
  aes192Cbc: "2.16.840.1.101.3.4.1.22",
  aes256Cbc: "2.16.840.1.101.3.4.1.42",
  rsaEncryption: "1.2.840.113549.1.1.1",
  ecPublicKey: "1.2.840.10045.2.1",
  ed25519: "1.3.101.112",
  x25519: "1.3.101.110",
};
const OID_NAME = {
  [OID.data]: "data", [OID.encryptedData]: "encryptedData",
  [OID.pbes2]: "PBES2", [OID.pbkdf2]: "PBKDF2",
  [OID.pbeSha1Tdes3]: "pbeWithSHAAnd3-KeyTripleDES-CBC", [OID.pbeSha1Tdes2]: "pbeWithSHAAnd2-KeyTripleDES-CBC",
  [OID.pbeSha1Rc2_128]: "pbeWithSHAAnd128BitRC2-CBC", [OID.pbeSha1Rc2_40]: "pbeWithSHAAnd40BitRC2-CBC",
  [OID.keyBag]: "keyBag", [OID.pkcs8ShroudedKeyBag]: "pkcs8ShroudedKeyBag", [OID.certBag]: "certBag",
  [OID.crlBag]: "crlBag", [OID.secretBag]: "secretBag", [OID.safeContentsBag]: "safeContentsBag",
  [OID.x509Certificate]: "x509Certificate", [OID.sdsiCertificate]: "sdsiCertificate",
  [OID.friendlyName]: "friendlyName", [OID.localKeyID]: "localKeyID",
  [OID.sha1]: "sha1", [OID.sha224]: "sha224", [OID.sha256]: "sha256", [OID.sha384]: "sha384", [OID.sha512]: "sha512",
  [OID.desEde3Cbc]: "des-ede3-cbc", [OID.rc2Cbc]: "rc2-cbc",
  [OID.aes128Cbc]: "aes-128-cbc", [OID.aes192Cbc]: "aes-192-cbc", [OID.aes256Cbc]: "aes-256-cbc",
  [OID.rsaEncryption]: "rsaEncryption", [OID.ecPublicKey]: "ecPublicKey",
  [OID.ed25519]: "Ed25519", [OID.x25519]: "X25519",
  "2.5.4.3": "CN", "2.5.4.6": "C", "2.5.4.7": "L", "2.5.4.8": "ST", "2.5.4.10": "O",
  "2.5.4.11": "OU", "2.5.4.5": "serialNumber", "1.2.840.113549.1.9.1": "emailAddress",
  "2.5.4.9": "street", "2.5.4.4": "SN", "2.5.4.42": "GN", "0.9.2342.19200300.100.1.25": "DC",
};
const oidLabel = (arcs) => OID_NAME[oidKey(arcs)] || oidKey(arcs);

async function digestBytes(name, bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto（需 HTTPS 或 localhost）");
  return new Uint8Array(await crypto.subtle.digest(name, bytes));
}

// ============================================================
// RC2（RFC 2268，CBC 只需解密，两个方向都给以便对拍）
// ============================================================

// PITABLE = π 十六进制小数位的随机排列（RFC 2268 §1.1 逐项）
const PITABLE = new Uint8Array([
  0xd9, 0x78, 0xf9, 0xc4, 0x19, 0xdd, 0xb5, 0xed, 0x28, 0xe9, 0xfd, 0x79, 0x4a, 0xa0, 0xd8, 0x9d,
  0xc6, 0x7e, 0x37, 0x83, 0x2b, 0x76, 0x53, 0x8e, 0x62, 0x4c, 0x64, 0x88, 0x44, 0x8b, 0xfb, 0xa2,
  0x17, 0x9a, 0x59, 0xf5, 0x87, 0xb3, 0x4f, 0x13, 0x61, 0x45, 0x6d, 0x8d, 0x09, 0x81, 0x7d, 0x32,
  0xbd, 0x8f, 0x40, 0xeb, 0x86, 0xb7, 0x7b, 0x0b, 0xf0, 0x95, 0x21, 0x22, 0x5c, 0x6b, 0x4e, 0x82,
  0x54, 0xd6, 0x65, 0x93, 0xce, 0x60, 0xb2, 0x1c, 0x73, 0x56, 0xc0, 0x14, 0xa7, 0x8c, 0xf1, 0xdc,
  0x12, 0x75, 0xca, 0x1f, 0x3b, 0xbe, 0xe4, 0xd1, 0x42, 0x3d, 0xd4, 0x30, 0xa3, 0x3c, 0xb6, 0x26,
  0x6f, 0xbf, 0x0e, 0xda, 0x46, 0x69, 0x07, 0x57, 0x27, 0xf2, 0x1d, 0x9b, 0xbc, 0x94, 0x43, 0x03,
  0xf8, 0x11, 0xc7, 0xf6, 0x90, 0xef, 0x3e, 0xe7, 0x06, 0xc3, 0xd5, 0x2f, 0xc8, 0x66, 0x1e, 0xd7,
  0x08, 0xe8, 0xea, 0xde, 0x80, 0x52, 0xee, 0xf7, 0x84, 0xaa, 0x72, 0xac, 0x35, 0x4d, 0x6a, 0x2a,
  0x96, 0x1a, 0xd2, 0x71, 0x5a, 0x15, 0x49, 0x74, 0x4b, 0x9f, 0xd0, 0x5e, 0x04, 0x18, 0xa4, 0xec,
  0xc2, 0xe0, 0x41, 0x6e, 0x0f, 0x51, 0xcb, 0xcc, 0x24, 0x91, 0xaf, 0x50, 0xa1, 0xf4, 0x70, 0x39,
  0x99, 0x7c, 0x3a, 0x85, 0x23, 0xb8, 0xb4, 0x7a, 0xfc, 0x02, 0x36, 0x5b, 0x25, 0x55, 0x97, 0x31,
  0x2d, 0x5d, 0xfa, 0x98, 0xe3, 0x8a, 0x92, 0xae, 0x05, 0xdf, 0x29, 0x10, 0x67, 0x6c, 0xba, 0xc9,
  0xd3, 0x00, 0xe6, 0xcf, 0xe1, 0x9e, 0xa8, 0x2c, 0x63, 0x16, 0x01, 0x3f, 0x58, 0xe2, 0x89, 0xa9,
  0x0d, 0x38, 0x34, 0x1b, 0xab, 0x33, 0xff, 0xb0, 0xbb, 0x48, 0x0c, 0x5f, 0xb9, 0xb1, 0xcd, 0x2e,
  0xc5, 0xf3, 0xdb, 0x47, 0xe5, 0xa5, 0x9c, 0x77, 0x0a, 0xa6, 0x20, 0x68, 0xfe, 0x7f, 0xc1, 0xad,
]);

/** RC2 密钥展开（RFC 2268 §2）：key 任意长度 1..128，effBits 有效位 */
export function rc2ExpandKey(key, effBits) {
  const T = key.length;
  if (T < 1 || T > 128) throw new Error("RC2：密钥须为 1..128 字节");
  const T1 = Math.max(1, Math.min(1024, effBits | 0));
  const T8 = Math.ceil(T1 / 8);
  const TM = (255 % (2 ** (8 + T1 - 8 * T8))) & 0xff;
  const L = new Uint8Array(128);
  L.set(key.subarray(0, T));
  for (let i = T; i < 128; i++) L[i] = PITABLE[(L[i - 1] + L[i - T]) & 0xff];
  L[128 - T8] = PITABLE[L[128 - T8] & TM];
  for (let i = 127 - T8; i >= 0; i--) L[i] = PITABLE[L[i + 1] ^ L[i + T8]];
  // K[i] = L[2i] + 256*L[2i+1]（低字节在前）
  const K = new Uint16Array(64);
  for (let i = 0; i < 64; i++) K[i] = L[2 * i] | (L[2 * i + 1] << 8);
  return K;
}

const rol16 = (x, k) => ((x << k) | (x >>> (16 - k))) & 0xffff;
const ror16 = (x, k) => ((x >>> k) | (x << (16 - k))) & 0xffff;

/** RC2 单块（64-bit = 4×16bit LE 字序）加密，RFC 2268 §3 */
export function rc2EncBlock(K, block) {
  const R = new Uint16Array(4);
  for (let i = 0; i < 4; i++) R[i] = block[2 * i] | (block[2 * i + 1] << 8);
  let j = 0;
  const s = [1, 2, 3, 5];
  const mix = (i) => {
    R[i] = (R[i] + K[j++] + (R[(i + 3) % 4] & R[(i + 2) % 4]) + ((~R[(i + 3) % 4] & 0xffff) & R[(i + 1) % 4])) & 0xffff;
    R[i] = rol16(R[i], s[i]);
  };
  const mash = (i) => { R[i] = (R[i] + K[R[(i + 3) % 4] & 63]) & 0xffff; };
  for (let r = 0; r < 5; r++) { mix(0); mix(1); mix(2); mix(3); }
  mash(0); mash(1); mash(2); mash(3);
  for (let r = 0; r < 6; r++) { mix(0); mix(1); mix(2); mix(3); }
  mash(0); mash(1); mash(2); mash(3);
  for (let r = 0; r < 5; r++) { mix(0); mix(1); mix(2); mix(3); }
  const out = new Uint8Array(8);
  for (let i = 0; i < 4; i++) { out[2 * i] = R[i] & 0xff; out[2 * i + 1] = (R[i] >>> 8) & 0xff; }
  return out;
}

/** RC2 单块解密，RFC 2268 §4 */
export function rc2DecBlock(K, block) {
  const R = new Uint16Array(4);
  for (let i = 0; i < 4; i++) R[i] = block[2 * i] | (block[2 * i + 1] << 8);
  const s = [1, 2, 3, 5];
  const rmix = (i) => {
    R[i] = ror16(R[i], s[i]);
    R[i] = (R[i] - K[j] - (R[(i + 3) % 4] & R[(i + 2) % 4]) - ((~R[(i + 3) % 4] & 0xffff) & R[(i + 1) % 4])) & 0xffff;
    j--;
  };
  const rmash = (i) => { R[i] = (R[i] - K[R[(i + 3) % 4] & 63]) & 0xffff; };
  let j = 63;
  for (let r = 0; r < 5; r++) { rmix(3); rmix(2); rmix(1); rmix(0); }
  rmash(3); rmash(2); rmash(1); rmash(0);
  for (let r = 0; r < 6; r++) { rmix(3); rmix(2); rmix(1); rmix(0); }
  rmash(3); rmash(2); rmash(1); rmash(0);
  for (let r = 0; r < 5; r++) { rmix(3); rmix(2); rmix(1); rmix(0); }
  const out = new Uint8Array(8);
  for (let i = 0; i < 4; i++) { out[2 * i] = R[i] & 0xff; out[2 * i + 1] = (R[i] >>> 8) & 0xff; }
  return out;
}

/** RC2-CBC 解密（无填充移除，调用方自理） */
export function rc2CbcDecrypt(ct, key, effBits, iv) {
  if (ct.length % 8 !== 0) throw new Error(`RC2-CBC：密文 ${ct.length} 字节须为 8 的倍数`);
  if (iv.length !== 8) throw new Error("RC2-CBC：IV 须为 8 字节");
  const K = rc2ExpandKey(key, effBits);
  const out = new Uint8Array(ct.length);
  let prev = iv.slice();
  for (let o = 0; o < ct.length; o += 8) {
    const blk = rc2DecBlock(K, ct.subarray(o, o + 8));
    for (let i = 0; i < 8; i++) out[o + i] = blk[i] ^ prev[i];
    prev = ct.slice(o, o + 8);
  }
  return out;
}

// ============================================================
// 口令编码 + PKCS#12 KDF（RFC 7292 附录 B）
// ============================================================

/** 口令 → BMPString 字节（UTF-16BE + 0x0000 终止；空口令 = 仅 2 字节终止符，与 OpenSSL 互操作实测一致） */
export function pkcs12PasswordBytes(pass) {
  const s = String(pass ?? "");
  if (s === "") return new Uint8Array([0x00, 0x00]);
  const out = new Uint8Array(s.length * 2 + 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 * i] = (c >>> 8) & 0xff;
    out[2 * i + 1] = c & 0xff;
  }
  return out; // 末 2 字节已是 0x00 0x00
}

const HASH_PARAMS = {
  // 摘要算法 OID（macData 用）
  [OID.sha1]: { subtle: "SHA-1", u: 20, v: 64 },
  [OID.sha224]: { subtle: "SHA-224", u: 28, v: 64 },
  [OID.sha256]: { subtle: "SHA-256", u: 32, v: 64 },
  [OID.sha384]: { subtle: "SHA-384", u: 48, v: 128 },
  [OID.sha512]: { subtle: "SHA-512", u: 64, v: 128 },
  // PRF OID（PBES2/PBKDF2 用，RFC 8018 附录 B.1.2 口径与同摘要一致）
  [OID.hmacSha1]: { subtle: "SHA-1", u: 20, v: 64 },
  [OID.hmacSha224]: { subtle: "SHA-224", u: 28, v: 64 },
  [OID.hmacSha256]: { subtle: "SHA-256", u: 32, v: 64 },
  [OID.hmacSha384]: { subtle: "SHA-384", u: 48, v: 128 },
  [OID.hmacSha512]: { subtle: "SHA-512", u: 64, v: 128 },
};

/**
 * PKCS#12 KDF（RFC 7292 B.2）：id=1 密钥 / 2 IV / 3 MAC。
 * @returns {Promise<Uint8Array>} n 字节伪随机输出
 */
export async function pkcs12Kdf(id, passBmp, salt, iterations, n, hashOid) {
  const hp = HASH_PARAMS[hashOid];
  if (!hp) throw new Error(`KDF 不支持的哈希：${hashOid}`);
  if (!(iterations >= 1)) throw new Error("KDF：迭代数必须 ≥ 1");
  if (iterations > 10_000_000) throw new Error(`KDF：迭代数 ${iterations} 过大（>1000 万），拒绝执行`);
  const v = hp.v, u = hp.u;
  const D = new Uint8Array(v).fill(id & 0xff);
  const cs = Math.ceil(salt.length / v) * v;
  const S = new Uint8Array(cs);
  if (salt.length) for (let i = 0; i < cs; i++) S[i] = salt[i % salt.length];
  const p = passBmp;
  const cp = Math.ceil(p.length / v) * v;
  const P = new Uint8Array(cp);
  if (p.length) for (let i = 0; i < cp; i++) P[i] = p[i % p.length];
  const I = new Uint8Array(cs + cp);
  I.set(S); I.set(P, cs);
  const c = Math.ceil(n / u);
  const out = new Uint8Array(n);
  let o = 0;
  for (let i = 1; i <= c; i++) {
    // A = H^iter(D || I)
    const block = new Uint8Array(D.length + I.length);
    block.set(D); block.set(I, D.length);
    let A = await digestBytes(hp.subtle, block);
    for (let r = 1; r < iterations; r++) A = await digestBytes(hp.subtle, A);
    // B = A 重复到 v 字节；I_j = (I_j + B + 1) mod 2^v
    const B = new Uint8Array(v);
    for (let j = 0; j < v; j++) B[j] = A[j % A.length];
    for (let j = 0; j < I.length; j += v) {
      let carry = 1;
      for (let t = v - 1; t >= 0; t--) {
        const sum = I[j + t] + B[t] + carry;
        I[j + t] = sum & 0xff;
        carry = sum >> 8;
      }
    }
    const take = Math.min(u, n - o);
    out.set(A.subarray(0, take), o);
    o += take;
  }
  return out;
}

// ============================================================
// PBE 解密入口（返回明文字节）
// ============================================================

/** AlgorithmIdentifier 节点 → { oid, params(节点或 null) } */
function algId(node) {
  if (!node.children || node.children.length < 1) throw new Error("AlgorithmIdentifier 结构不符");
  const oid = oidFromBytes(node.children[0].value);
  return { oid, params: node.children[1] || null };
}

/** pkcs-12PbeParams：SEQ{ salt OCTET STRING, iterations INTEGER } */
function p12PbeParams(node) {
  if (!node || !node.children || node.children.length < 2) throw new Error("pkcs-12PbeParams 结构不符");
  const salt = node.children[0].value;
  const it = node.children[1].value;
  let iterations = 0n;
  for (const b of it) iterations = (iterations << 8n) | BigInt(b);
  return { salt, iterations: Number(iterations) };
}

/** 手工 PKCS#7 去填充（严格校验） */
function unpadPkcs7(b, bs) {
  if (b.length === 0 || b.length % bs !== 0) throw new Error("解密结果长度不是分组整数倍（口令错误或数据损坏）");
  const n = b[b.length - 1];
  if (n < 1 || n > bs) throw new Error("填充字节非法（口令错误或数据损坏）");
  for (let i = 0; i < n; i++) if (b[b.length - 1 - i] !== n) throw new Error("填充字节不一致（口令错误或数据损坏）");
  return b.slice(0, b.length - n);
}

/**
 * 按算法 OID + 参数节点解密（legacy PKCS#12 PBE 与 PBES2）。
 * 口令语义：legacy PKCS#12 PBE 用 BMPString（RFC 7292 B.1）；
 * PBES2（RFC 8018）口令为原始 UTF-8 字节（与 OpenSSL/浏览器互操作实测一致，
 * PKCS#12 内嵌 PBES2 时不做 BMP 转换）。
 * @returns {Promise<Uint8Array>} 去填充后的明文
 */
export async function pbeDecrypt(algNode, ct, password) {
  const { oid: oidArcs, params } = algId(algNode);
  const oid = oidKey(oidArcs);
  if (oid === OID.pbeSha1Tdes3 || oid === OID.pbeSha1Tdes2) {
    const passBmp = pkcs12PasswordBytes(password);
    const { salt, iterations } = p12PbeParams(params);
    const keyLen = oid === OID.pbeSha1Tdes3 ? 24 : 16;
    const key = await pkcs12Kdf(1, passBmp, salt, iterations, keyLen, OID.sha1);
    const iv = await pkcs12Kdf(2, passBmp, salt, iterations, 8, OID.sha1);
    return unpadPkcs7(des3Decrypt(ct, key, { mode: "CBC", iv, pad: false }), 8);
  }
  if (oid === OID.pbeSha1Rc2_128 || oid === OID.pbeSha1Rc2_40) {
    const passBmp = pkcs12PasswordBytes(password);
    const { salt, iterations } = p12PbeParams(params);
    const keyLen = oid === OID.pbeSha1Rc2_128 ? 16 : 5;
    const effBits = oid === OID.pbeSha1Rc2_128 ? 128 : 40;
    const key = await pkcs12Kdf(1, passBmp, salt, iterations, keyLen, OID.sha1);
    const iv = await pkcs12Kdf(2, passBmp, salt, iterations, 8, OID.sha1);
    return unpadPkcs7(rc2CbcDecrypt(ct, key, effBits, iv), 8);
  }
  if (oid === OID.pbes2) {
    if (!params || !params.children || params.children.length < 2) throw new Error("PBES2 参数结构不符");
    const kdf = algId(params.children[0]);
    const enc = algId(params.children[1]);
    if (oidKey(kdf.oid) !== OID.pbkdf2) throw new Error(`PBES2：不支持的 KDF ${oidLabel(kdf.oid)}`);
    const kp = kdf.params;
    if (!kp || !kp.children || kp.children.length < 2) throw new Error("PBKDF2 参数结构不符");
    const salt = kp.children[0].value;
    let iterations = 0n;
    for (const b of kp.children[1].value) iterations = (iterations << 8n) | BigInt(b);
    let keyLen = 0;
    let prf = OID.hmacSha1;
    // RFC 8018 PBKDF2-params：salt, iter, keyLen 可选(INTEGER), prf 可选(SEQ)——按 tag 识别
    for (const c of (kp.children || []).slice(2)) {
      if (c.tag === 0x02) keyLen = Number(derToInt(c.value));
      else if (c.tag === 0x30) prf = oidKey(algId(c).oid);
    }
    // RFC 8018：keyLen 省略时由加密方案定长（OpenSSL 的 PKCS#12 即如此）
    const encOid0 = oidKey(algId(params.children[1]).oid);
    const schemeKeyLen = { [OID.aes128Cbc]: 16, [OID.aes192Cbc]: 24, [OID.aes256Cbc]: 32, [OID.desEde3Cbc]: 24 }[encOid0] || 0;
    const hp = HASH_PARAMS[prf];
    if (!hp) throw new Error(`PBKDF2：不支持的 PRF ${oidLabel(prf.split(".").map(Number))}`);
    if (!keyLen) keyLen = schemeKeyLen;
    if (!keyLen) throw new Error("PBKDF2：缺少 keyLen 且加密方案无法推导密钥长度");
    const dk = new Uint8Array(await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: Number(iterations), hash: hp.subtle },
      await crypto.subtle.importKey("raw", te(password), "PBKDF2", false, ["deriveBits"]),
      keyLen * 8,
    ));
    let iv, dec, bs;
    if (oidKey(enc.oid) === OID.desEde3Cbc) {
      if (keyLen !== 24) throw new Error("PBES2/3DES：keyLen 须为 24");
      iv = enc.params ? enc.params.value : null; bs = 8;
      if (!iv || iv.length !== 8) throw new Error("PBES2/3DES：IV 须为 8 字节");
      dec = des3Decrypt(ct, dk, { mode: "CBC", iv, pad: false });
    } else if ([OID.aes128Cbc, OID.aes192Cbc, OID.aes256Cbc].includes(oidKey(enc.oid))) {
      bs = 16;
      iv = enc.params ? enc.params.value : null;
      if (!iv || iv.length !== 16) throw new Error("PBES2/AES：IV 须为 16 字节");
      dec = aesDecrypt(ct, dk, { mode: "CBC", iv, pad: false });
    } else {
      throw new Error(`PBES2：不支持的加密方案 ${oidLabel(enc.oid)}`);
    }
    return unpadPkcs7(dec, bs);
  }
  throw new Error(`不支持的 PBE 算法：${oidLabel(oid)}`);
}

// ============================================================
// X.509 最小解析（只展示，不验证证书链）
// ============================================================

/** Name（SEQ OF SET OF SEQ{OID, value}）→ "CN=x, O=y" */
function nameToString(node) {
  if (!node.children) return "";
  const rdns = [];
  for (const set of node.children) {
    for (const atv of set.children || []) {
      if (!atv.children || atv.children.length < 2) continue;
      const arcs = oidFromBytes(atv.children[0].value);
      const raw = atv.children[1];
      let val = "";
      if (raw.tag === 0x1e || raw.tag === 0x0c) { // BMPString / UTF8String
        val = raw.tag === 0x1e
          ? new TextDecoder("utf-16be").decode(raw.value)
          : new TextDecoder().decode(raw.value);
      } else {
        val = new TextDecoder().decode(raw.value);
      }
      rdns.push(`${oidLabel(arcs)}=${val}`);
    }
  }
  return rdns.join(", ");
}

/** 证书 DER → { subject, issuer, serial, notBefore, notAfter }（最小解析） */
export function parseCertificate(der) {
  const cert = derDecode(der);
  if (cert.tag !== 0x30 || !cert.children || cert.children.length < 3) throw new Error("证书 DER 结构不符");
  const tbs = cert.children[0];
  if (tbs.tag !== 0x30) throw new Error("TBSCertificate 结构不符");
  let i = 0;
  let version = 1;
  if (tbs.children[0].tag === 0xA0) { version = Number(derToInt(tbs.children[0].children[0].value)) + 1; i = 1; }
  const serial = derToInt(tbs.children[i].value);
  i++;
  const sigAlg = algId(tbs.children[i]); i++;
  const issuer = nameToString(tbs.children[i]); i++;
  const validity = tbs.children[i]; i++;
  const timeStr = (n) => new TextDecoder().decode(n.value);
  const notBefore = validity.children?.[0] ? timeStr(validity.children[0]) : "";
  const notAfter = validity.children?.[1] ? timeStr(validity.children[1]) : "";
  const subject = nameToString(tbs.children[i]); i++;
  return { version, serial, sigAlg: oidLabel(sigAlg.oid), issuer, notBefore, notAfter, subject };
}

function derToInt(bytes) {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

/** PKCS#8 PrivateKeyInfo → { alg 标签, pem } */
export function parsePkcs8(der) {
  const node = derDecode(der);
  return pkcs8FromNode(node, der);
}

/** PrivateKeyInfo 节点 → { version, alg, algOid, pem }（der 可选，用于 PEM 复原） */
export function pkcs8FromNode(node, der) {
  if (node.tag !== 0x30 || !node.children || node.children.length < 2) throw new Error("PrivateKeyInfo 结构不符");
  const ver = derToInt(node.children[0].value);
  const alg = algId(node.children[1]);
  const pem = derToPem("PRIVATE KEY", der ?? derEncode(node));
  return { version: Number(ver), alg: oidLabel(alg.oid), algOid: oidKey(alg.oid), pem };
}

/** [0] 上下文标签 → 内部节点（0xA0 显式；隐式 0x80/0x82/0x84 无内部节点） */
function ctx0Node(node) {
  if (node.tag === 0xA0) {
    if (!node.children || node.children.length !== 1) throw new Error("[0] 上下文应恰好含 1 个内部节点");
    return node.children[0];
  }
  throw new Error(`上下文标签 0x${node.tag.toString(16)} 结构不符`);
}

/** [0] 上下文 → 内容字节（OCTET STRING 语义：0x80/0x82/0x84 隐式直取 value；0xA0 显式取子 TLV 的 value） */
function ctx0Value(node) {
  if (node.tag === 0x80 || node.tag === 0x82 || node.tag === 0x84) return node.value;
  const n = ctx0Node(node);
  if (n.tag === 0x04 || n.tag === 0x03) return n.value;
  throw new Error(`[0] 上下文内部应为 OCTET/BIT STRING，实际 tag 0x${n.tag.toString(16)}`);
}

// ============================================================
// PFX 容器解析
// ============================================================

/** SafeBag 属性 → { friendlyName, localKeyID } */
function bagAttributes(setNode) {
  const attrs = { friendlyName: "", localKeyID: "" };
  for (const attr of setNode.children || []) {
    if (!attr.children || attr.children.length < 2) continue;
    const arcs = oidFromBytes(attr.children[0].value);
    const k = oidKey(arcs);
    const v0 = attr.children[1]?.children?.[0];
    if (!v0) continue;
    if (k === OID.friendlyName && v0.tag === 0x1e) attrs.friendlyName = new TextDecoder("utf-16be").decode(v0.value);
    if (k === OID.localKeyID) attrs.localKeyID = bytesToHex(v0.value);
  }
  return attrs;
}

/** SafeContents（SEQ OF SafeBag）→ 报告行 + 产物 */
async function walkSafeContents(der, password, lines, files, counters, prefix) {
  const seq = derDecode(der);
  if (seq.tag !== 0x30) throw new Error("SafeContents 结构不符");
  for (const bag of seq.children) {
    if (bag.tag !== 0x30 || !bag.children || bag.children.length < 2) { lines.push(`${prefix}· 非常规 bag 节点（tag 0x${bag.tag.toString(16)}），跳过`); continue; }
    const bagId = oidKey(oidFromBytes(bag.children[0].value));
    const bagValue = bag.children[1];
    const attrs = bag.children[2] ? bagAttributes(bag.children[2]) : { friendlyName: "", localKeyID: "" };
    const attrStr = [attrs.friendlyName ? `名称=${attrs.friendlyName}` : "", attrs.localKeyID ? `localKeyID=${attrs.localKeyID}` : ""].filter(Boolean).join("，");
    if (bagId === OID.keyBag) {
      const info = pkcs8FromNode(ctx0Node(bagValue));
      lines.push(`${prefix}· keyBag（明文私钥）：${info.alg}${attrStr ? "，" + attrStr : ""} → 已输出 PEM`);
      files.push({ name: `key_${++counters.keys}.pem`, mime: "text/plain", bytes: te(info.pem + "\n") });
    } else if (bagId === OID.pkcs8ShroudedKeyBag) {
      const epki = ctx0Node(bagValue);
      if (epki.tag !== 0x30 || !epki.children || epki.children.length < 2) throw new Error("EncryptedPrivateKeyInfo 结构不符");
      try {
        const info = await pbeDecrypt(epki.children[0], epki.children[1].value, password);
        const pk8 = parsePkcs8(info);
        lines.push(`${prefix}· pkcs8ShroudedKeyBag（加密私钥）：${epkiAlg(epki.children[0])}${attrStr ? "，" + attrStr : ""} → 口令解密成功，${pk8.alg}，已输出 PEM`);
        files.push({ name: `key_${++counters.keys}.pem`, mime: "text/plain", bytes: te(pk8.pem + "\n") });
      } catch (e) {
        lines.push(`${prefix}· pkcs8ShroudedKeyBag（加密私钥）：${epkiAlg(epki.children[0])}${attrStr ? "，" + attrStr : ""} → 口令解密失败：${e.message}`);
      }
    } else if (bagId === OID.certBag) {
      const certBag = ctx0Node(bagValue);
      if (certBag.tag !== 0x30 || !certBag.children || certBag.children.length < 2) throw new Error("CertBag 结构不符");
      const certId = oidKey(oidFromBytes(certBag.children[0].value));
      if (certId !== OID.x509Certificate) { lines.push(`${prefix}· certBag：${oidLabel(certId.split(".").map(Number))}（非 X.509，跳过）`); continue; }
      const certDer = ctx0Value(certBag.children[1]);
      const cert = parseCertificate(certDer);
      lines.push(`${prefix}· certBag：X.509 v${cert.version}，序列号 ${cert.serial.toString(16)}` +
        `${attrStr ? "，" + attrStr : ""}；主题 ${cert.subject || "(空)"}；签发者 ${cert.issuer || "(空)"}；` +
        `有效期 ${cert.notBefore} ~ ${cert.notAfter} → 已输出 PEM（不验证证书链）`);
      files.push({ name: `cert_${++counters.certs}.pem`, mime: "text/plain", bytes: te(derToPem("CERTIFICATE", certDer) + "\n") });
    } else {
      const v = (() => { try { return ctx0Value(bagValue); } catch { return bagValue.value; } })();
      lines.push(`${prefix}· ${oidLabel(bagId.split(".").map(Number))}（${v.length} 字节，仅列出）${attrStr ? "，" + attrStr : ""}`);
    }
  }
}

function epkiAlg(algNode) {
  try { return describeAlg(algNode); } catch { return "未知算法"; }
}

/** 算法节点 → 可读描述（PBES2 展开 KDF/PRF/迭代/加密方案；legacy 展开迭代数） */
function describeAlg(algNode) {
  const { oid: arcs, params } = algId(algNode);
  const oid = oidKey(arcs);
  if (oid === OID.pbes2 && params?.children?.length >= 2) {
    try {
      const kdf = algId(params.children[0]);
      const kp = kdf.params;
      const it = kp?.children?.[1]?.value ? Number(derToInt(kp.children[1].value)) : 0;
      let prf = "HMAC-SHA1";
      for (const c of (kp?.children || []).slice(2)) if (c.tag === 0x30) {
        const p = oidKey(algId(c).oid);
        prf = "HMAC-" + (OID_NAME[p] || p).toUpperCase().replace("HMACWITH", "");
      }
      const enc = algId(params.children[1]);
      return `PBES2（PBKDF2-${prf} ×${it} + ${oidLabel(enc.oid)}）`;
    } catch { return "PBES2"; }
  }
  if ([OID.pbeSha1Tdes3, OID.pbeSha1Tdes2, OID.pbeSha1Rc2_128, OID.pbeSha1Rc2_40].includes(oid) && params?.children?.length >= 2) {
    try { return `${oidLabel(arcs)}（×${Number(derToInt(params.children[1].value))}）`; } catch { return oidLabel(arcs); }
  }
  return oidLabel(arcs);
}

/** PFX 全解析（口令解密 + MAC 校验） */
export async function parsePfx(der, password) {
  const passBmp = pkcs12PasswordBytes(password);
  const root = derDecode(der);
  if (root.tag !== 0x30 || !root.children || root.children.length < 2) throw new Error("PFX 结构不符（根 SEQUENCE）");
  const version = Number(derToInt(root.children[0].value));
  if (version !== 3) throw new Error(`PFX version=${version}，应为 3`);
  const lines = [`PFX version = ${version}`];
  const files = [];
  const counters = { certs: 0, keys: 0 };
  // authSafe ContentInfo
  const authSafe = root.children[1];
  if (authSafe.tag !== 0x30 || !authSafe.children || authSafe.children.length < 2) throw new Error("authSafe ContentInfo 结构不符");
  const authOid = oidKey(oidFromBytes(authSafe.children[0].value));
  if (authOid !== OID.data) throw new Error(`authSafe 内容类型应为 data，实际 ${oidLabel(authOid.split(".").map(Number))}`);
  const authContent = ctx0Value(authSafe.children[1]);
  // macData（RFC 7292 §4：PFX 第三个直接子字段，非 [0] 包装）
  if (root.children[2] && (root.children[2].tag === 0x30 || root.children[2].tag === 0xA0)) {
    const macData = root.children[2].tag === 0x30 ? root.children[2] : root.children[2].children?.[0];
    if (macData && macData.children && macData.children.length >= 2) {
      // MacData ::= SEQ{ mac DigestInfo, macSalt OCTET STRING, iterations INTEGER DEFAULT 1 }
      const di = macData.children[0];
      const macSalt = macData.children[1] ? macData.children[1].value : new Uint8Array(0);
      const iter = macData.children[2] ? Number(derToInt(macData.children[2].value)) : 1;
      const macAlg = algId(di.children[0]);
      const expected = di.children[1].value;
      const hp = HASH_PARAMS[oidKey(macAlg.oid)];
      if (!hp) {
        lines.push(`macData：${oidLabel(macAlg.oid)}（不支持的哈希，跳过校验），迭代 ${iter}`);
      } else {
        const macKey = await pkcs12Kdf(3, passBmp, macSalt, iter, hp.u, oidKey(macAlg.oid));
        const mac = await hmacHash(hp.subtle, macKey, authContent);
        const okMac = mac.length === expected.length && mac.every((b, i) => b === expected[i]);
        lines.push(`macData：${hp.subtle.replace("-", "")}，迭代 ${iter}，salt ${bytesToHex(macSalt).slice(0, 32)}${macSalt.length > 16 ? "…" : ""}`,
          `MAC 校验：${okMac ? "✓ 通过" : "✗ 不一致（口令可能错误或数据被改）"}`);
      }
    }
  } else {
    lines.push("macData：无（未启用口令完整性校验）");
  }
  lines.push("");
  // AuthenticatedSafe
  const authSafeSeq = derDecode(authContent);
  if (authSafeSeq.tag !== 0x30) throw new Error("AuthenticatedSafe 结构不符");
  let idx = 0;
  for (const ci of authSafeSeq.children) {
    if (ci.tag !== 0x30 || !ci.children || ci.children.length < 2) continue;
    const cOid = oidKey(oidFromBytes(ci.children[0].value));
    idx++;
    if (cOid === OID.data) {
      const sc = ctx0Value(ci.children[1]);
      lines.push(`—— 安全内容 ${idx}（data，明文）——`);
      await walkSafeContents(sc, password, lines, files, counters, "");
    } else if (cOid === OID.encryptedData) {
      const edSeq = ctx0Node(ci.children[1]);
      if (edSeq.tag !== 0x30 || !edSeq.children || edSeq.children.length < 2) throw new Error("encryptedData 结构不符");
      const eci = edSeq.children[1];
      if (!eci.children || eci.children.length < 2) throw new Error("EncryptedContentInfo 结构不符");
      const contentType = oidKey(oidFromBytes(eci.children[0].value));
      if (contentType !== OID.data) throw new Error(`EncryptedContentInfo 内容类型应为 data，实际 ${oidLabel(contentType.split(".").map(Number))}`);
      const algNode = eci.children[1];
      let ctNode = null;
      for (const c of eci.children.slice(2)) if (c.tag === 0x80 || c.tag === 0xA0 || c.tag === 0x04) { ctNode = c; break; }
      if (!ctNode) throw new Error("EncryptedContentInfo 缺少密文 [0]");
      const ct = ctx0Value(ctNode);
      const algName = describeAlg(algNode);
      try {
        const plain = await pbeDecrypt(algNode, ct, password);
        lines.push(`—— 安全内容 ${idx}（encryptedData，${algName}）—— 口令解密成功：`);
        await walkSafeContents(plain, password, lines, files, counters, "  ");
      } catch (e) {
        lines.push(`—— 安全内容 ${idx}（encryptedData，${algName}）—— 口令解密失败：${e.message}`);
      }
    } else {
      lines.push(`—— 安全内容 ${idx}：${oidLabel(cOid.split(".").map(Number))}（未知类型，跳过）`);
    }
  }
  return { lines, files };
}

/** 手工 HMAC（RFC 2104/6234 口径，哈希走 WebCrypto） */
async function hmacHash(subtleName, key, msg) {
  const bs = subtleName === "SHA-384" || subtleName === "SHA-512" ? 128 : 64;
  let k = key;
  if (k.length > bs) k = await digestBytes(subtleName, k);
  const k0 = new Uint8Array(bs);
  k0.set(k);
  const ipad = new Uint8Array(bs + msg.length);
  for (let i = 0; i < bs; i++) ipad[i] = k0[i] ^ 0x36;
  ipad.set(msg, bs);
  const inner = await digestBytes(subtleName, ipad);
  const opad2 = new Uint8Array(bs + inner.length);
  for (let i = 0; i < bs; i++) opad2[i] = k0[i] ^ 0x5c;
  opad2.set(inner, bs);
  return digestBytes(subtleName, opad2);
}

// ============================================================
// op 注册
// ============================================================

register({
  id: "pkcs12Parse",
  cat: "filefmt",
  name: "PKCS#12/PFX 解析",
  desc: "PKCS#12/PFX 容器解析（RFC 7292）：版本/结构树、macData 口令完整性校验、口令解密 encryptedData 与 pkcs8ShroudedKeyBag（传统 pbeWithSHAAnd3-Key/2-KeyTripleDES、SHA/RC2-128/40 及 PBES2+PBKDF2+AES/3DES），证书列序列号/主题/有效期并输出 PEM，私钥输出 PKCS#8 PEM；不做证书链验证，口令只在本地处理零外发",
  params: [
    { key: "pass", label: "口令（加密内容才填）", type: "text", default: "", placeholder: "PFX 口令，留空按空口令尝试" },
  ],
  run: async (_text, p) => {
    const raw = String(_text || "");
    const stripped = raw.replace(/-----[A-Z ]+-----/g, "").trim();
    if (!stripped) throw new Error("输入为空（粘贴 PFX 的 base64 或 hex）");
    // base64 优先（PFX 常见形态）；首字节非 0x30 再试 hex
    let der;
    try { der = b64ToBytes(stripped); } catch { der = new Uint8Array(0); }
    if (der.length === 0 || der[0] !== 0x30) {
      try {
        const h = hexToBytes(stripped);
        if (h.length > 0 && h[0] === 0x30) der = h;
      } catch { /* 保持 base64 结果 */ }
    }
    if (der.length === 0 || der[0] !== 0x30) throw new Error("输入不是 DER（首字节应为 0x30 SEQUENCE）");
    const pass = String((p && p.pass) ?? "");
    const { lines, files } = await parsePfx(der, pass);
    lines.push("", "说明：证书/私钥已输出为 PEM 可下载；本工具不做证书链验证；口令与私钥只在本地内存处理。");
    return { text: lines.join("\n"), files };
  },
});
