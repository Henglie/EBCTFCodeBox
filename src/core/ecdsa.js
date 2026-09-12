/*
 * ecdsa.js — 通用 ECDSA 全家 + ECC 点运算（T345，批A2+A6）。
 *
 * 五个 op（件内自注册）：
 *   ecdsaKeyGen     生成密钥对：d + 公钥（压缩/非压缩 hex）（crypto）
 *   ecdsaSign       签名：RFC 6979 确定 k / 随机 k，输出 r,s（十进制+hex）+ DER（crypto）
 *   ecdsaVerify     验签：公钥（压缩/非压缩/X‖Y 自动识别）+ 签名（r,s 或 DER）（crypto）
 *   ecdsaSigConvert 签名格式互转：raw(r;s) ↔ DER(ASN.1 X.690) ↔ JOSE(base64url)（crypto）
 *   eccCalc         ECC 点运算计算器：点加/点减/标量乘/倍点，四预设曲线 + 自定义（modern）
 *
 * 标准依据（北极星：实现可当权威源）：
 *   - ECDSA 签名/验签：ANSI X9.62 / FIPS 186-4 §6.3（点运算数学）
 *   - 确定 k：RFC 6979 §3.2（HMAC_DRBG），官方向量 A.2.5 逐字验证
 *   - 曲线域参数：
 *       secp256k1 — SEC 2 v2.0 §2.4.1（http://www.secg.org/sec2-v2.pdf）
 *       P-256/P-384/P-521 — FIPS 186-4 附录 D.1.2.3 / D.1.2.4 / D.1.2.5
 *       （P-384/P-521 常量另经本机 openssl 3.5.7 `ecparam -param_enc explicit -text`
 *        输出逐字节核对，2026-09-02）
 *   - DER 签名编码：ITU-T X.690（DER：INTEGER 最小二补码 + 定长）
 *   - JOSE 签名格式：RFC 7515 §3.4（base64url of r||s 定宽拼接）
 *   - 哈希/HMAC：FIPS 180-4 / RFC 2104，经 WebCrypto（globalThis.crypto.subtle）
 *
 * 复用（不复制）：
 *   - EC 点运算（雅可比坐标点加/倍点/标量乘、模逆、mod）自 ecdsaReuseK.js 导入
 *   - modPow / isProbablePrime 自 primeGen.js 导入（custom 曲线素性校验）
 *   - 字节级 SHA-256/384/512 与 HMAC：仓内无导出的字节级实现（hash.js 的 sha/hmac
 *     只收字符串，shaExt.js 只导出 sha256），故按 modern.js / jwtCrack.js 既有模式
 *     直调 WebCrypto 原语（浏览器与 Node>=18 同源实现，权威性等同）
 *
 * 随机数：globalThis.crypto.getRandomValues（浏览器/Worker/Node>=19 均原生，拒绝采样无偏）。
 *
 * 红线：core 层零 UI/DOM 依赖；纯本地零外发；无 emoji。
 */
import { register } from "./registry.js";
import { ecMul, ecPointAdd, ecToAffine, mod, modInverse } from "./ecdsaReuseK.js";
import { isProbablePrime, modPow } from "./primeGen.js";

// ============================================================
// 曲线域参数（BigInt 常量表）
// ============================================================
const CURVES = {
  secp256k1: {
    name: "secp256k1",
    std: "SEC 2 v2.0 §2.4.1",
    p: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2fn,
    a: 0n,
    b: 7n,
    n: 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n,
    Gx: 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n,
    Gy: 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n,
  },
  p256: { // NIST P-256 = secp256r1，a = p - 3
    name: "P-256 (secp256r1)",
    std: "FIPS 186-4 D.1.2.3",
    p: 0xffffffff00000001000000000000000000000000ffffffffffffffffffffffffn,
    a: 0xffffffff00000001000000000000000000000000fffffffffffffffffffffffcn,
    b: 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn,
    n: 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n,
    Gx: 0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296n,
    Gy: 0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5n,
  },
  p384: { // NIST P-384 = secp384r1，a = p - 3
    name: "P-384 (secp384r1)",
    std: "FIPS 186-4 D.1.2.4",
    p: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000ffffffffn,
    a: 0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffeffffffff0000000000000000fffffffcn,
    b: 0xb3312fa7e23ee7e4988e056be3f82d19181d9c6efe8141120314088f5013875ac656398d8a2ed19d2a85c8edd3ec2aefn,
    n: 0xffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973n,
    Gx: 0xaa87ca22be8b05378eb1c71ef320ad746e1d3b628ba79b9859f741e082542a385502f25dbf55296c3a545e3872760ab7n,
    Gy: 0x3617de4a96262c6f5d9e98bf9292dc29f8f41dbd289a147ce9da3113b5f0b8c00a60b1ce1d7e819d7a431d7c90ea0e5fn,
  },
  p521: { // NIST P-521 = secp521r1，a = p - 3
    name: "P-521 (secp521r1)",
    std: "FIPS 186-4 D.1.2.5",
    p: 0x1ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn,
    a: 0x1fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffcn,
    b: 0x51953eb9618e1c9a1f929a21a0b68540eea2da725b99b315f3b8b489918ef109e156193951ec7e937b1652c0bd3bb1bf073573df883d2c34f1ef451fd46b503f00n,
    n: 0x1fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e91386409n,
    Gx: 0xc6858e06b70404e9cd9e3ecb662395b4429c648139053fb521f828af606b4d3dbaa14b5e77efe75928fe1dc127a2ffa8de3348b3c1856a429bf97e7e31c2e5bd66n,
    Gy: 0x11839296a789a3bc0045c8a5fb42c7d1bd998f54449579b446817afbd17273e662c97ee72995ef42640c550b9013fad0761353c7086a272c24088be94769fd16650n,
  },
};

const CURVE_OPTIONS = [
  { value: "secp256k1", label: "secp256k1（比特币/以太坊，SEC 2 v2）" },
  { value: "p256", label: "P-256 / secp256r1（NIST）" },
  { value: "p384", label: "P-384 / secp384r1（NIST）" },
  { value: "p521", label: "P-521 / secp521r1（NIST）" },
];

const HASHES = {
  sha256: { norm: "SHA-256", len: 32, label: "SHA-256" },
  sha384: { norm: "SHA-384", len: 48, label: "SHA-384" },
  sha512: { norm: "SHA-512", len: 64, label: "SHA-512" },
};

// ============================================================
// 基础工具（hex/bytes/BigInt）
// ============================================================
const HEX_RE = /^[0-9a-fA-F]+$/;

function hexToBytes(h, label = "hex") {
  let s = String(h == null ? "" : h).trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (!s) throw new Error(`缺少 ${label} 输入`);
  if (!HEX_RE.test(s)) throw new Error(`${label} 含非 hex 字符`);
  if (s.length % 2) s = "0" + s;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
function bytesToBigInt(b) {
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v;
}
function bigIntToBytes(v, len, label = "整数") {
  if (v < 0n) throw new Error(`${label} 为负，无法定宽编码`);
  const out = new Uint8Array(len);
  let x = v;
  for (let i = len - 1; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  if (x !== 0n) throw new Error(`${label} 超出 ${len} 字节宽度`);
  return out;
}
function catBytes(...arrs) {
  const len = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function bitLen(v) { return v.toString(2).length; }
function byteLen(v) { return (bitLen(v) + 7) >> 3; }

/** 十进制 / 0x 前缀 hex / 纯 hex（含 a-f 字母时按 hex；纯数字按十进制——与 ecdsaReuseK.parseBig 同规则）；允许负号（eccCalc 标量 k 用） */
function parseBigAuto(t, label) {
  const s = String(t == null ? "" : t).trim();
  if (!s) throw new Error(`缺少参数 ${label}`);
  const neg = s.startsWith("-");
  const u = neg ? s.slice(1) : s;
  let v;
  if (/^0x/i.test(u)) {
    if (u.length === 2 || !/^[0-9a-f]+$/i.test(u.slice(2))) throw new Error(`参数 ${label} 不是合法整数：${s}`);
    v = BigInt(u);
  } else if (/^[0-9]+$/.test(u)) v = BigInt(u);
  else if (/^[0-9a-f]+$/i.test(u)) v = BigInt("0x" + u);
  else throw new Error(`参数 ${label} 不是合法整数（十进制或 0x hex）：${s}`);
  return neg ? -v : v;
}

// base64url（RFC 4648 §5，无填充；RFC 7515 JOSE 用）
function bytesToB64url(b) {
  let bin = "";
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(s, label = "base64url") {
  let t = String(s == null ? "" : s).trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!t) throw new Error(`缺少 ${label} 输入`);
  while (t.length % 4) t += "=";
  let bin;
  try { bin = atob(t); } catch { throw new Error(`${label} 解码失败（含非法字符）`); }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ============================================================
// WebCrypto 字节级 SHA / HMAC（FIPS 180-4 / RFC 2104）
// （仓内无字节级导出实现，按 modern.js / jwtCrack.js 既有模式直调原生原语）
// ============================================================
async function shaBytes(normName, data) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto（需 HTTPS 或 localhost）");
  return new Uint8Array(await crypto.subtle.digest(normName, data));
}
async function hmacShaBytes(normName, keyBytes, dataBytes) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto（需 HTTPS 或 localhost）");
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: normName }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, dataBytes));
}

// ============================================================
// 曲线管理：预设 / 自定义
// ============================================================
function getCurve(key) {
  const c = CURVES[key];
  if (!c) throw new Error(`未知曲线：${key}（可选 secp256k1 / p256 / p384 / p521 / custom）`);
  return c;
}

/** 自定义曲线（eccCalc custom）：p 必须为奇素数；n 可选（标量约简用）；Gx/Gy 可选（"G" 引用用） */
function buildCustomCurve(pRaw, aRaw, bRaw, gxRaw, gyRaw, nRaw) {
  const p = parseBigAuto(pRaw, "p（自定义素域）");
  if (p < 3n) throw new Error("自定义曲线 p 过小");
  if (!isProbablePrime(p)) throw new Error("自定义曲线 p 不是素数（Miller-Rabin 概率检验未通过）");
  const a = mod(parseBigAuto(aRaw == null || aRaw === "" ? "0" : aRaw, "a"), p);
  const b = mod(parseBigAuto(bRaw == null || bRaw === "" ? "0" : bRaw, "b"), p);
  // 判别式 4a³+27b² ≠ 0（奇异曲线不可用，X9.62 §4.2）
  if (mod(4n * a * a * a + 27n * b * b, p) === 0n) throw new Error("曲线奇异（4a³+27b² ≡ 0 mod p），不可用");
  const c = { name: "custom", std: "自定义（短 Weierstrass y²=x³+ax+b mod p）", p, a, b, n: null, Gx: null, Gy: null };
  if (gxRaw != null && String(gxRaw).trim() && gyRaw != null && String(gyRaw).trim()) {
    const Gx = mod(parseBigAuto(gxRaw, "Gx"), p);
    const Gy = mod(parseBigAuto(gyRaw, "Gy"), p);
    if (!onCurve(Gx, Gy, c)) throw new Error("生成元 G 不在自定义曲线上");
    c.Gx = Gx; c.Gy = Gy;
  }
  if (nRaw != null && String(nRaw).trim()) c.n = parseBigAuto(nRaw, "n（自定义阶）");
  return c;
}

function onCurve(x, y, c) {
  return mod(y * y - (x * x * x + c.a * x + c.b), c.p) === 0n;
}

// ============================================================
// 点解析 / 序列化
// ============================================================
/** 解析点 hex：02/03‖X（压缩，需解压）｜04‖X‖Y｜X‖Y 裸拼接；"G"=生成元；"O"/"inf"=无穷远点(返回 null) */
function parsePoint(raw, c, label) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) throw new Error(`缺少参数 ${label}（点 hex）`);
  if (/^(o|O|inf|infinity|无限远)$/i.test(s.replace(/^(0x)/i, ""))) return null;
  if (/^g$/i.test(s.replace(/^(0x)/i, ""))) {
    if (c.Gx == null) throw new Error(`曲线 ${c.name} 未提供生成元 G（自定义曲线需填 Gx/Gy）`);
    return [c.Gx, c.Gy];
  }
  const h = s.replace(/^0x/i, "").replace(/\s+/g, "");
  if (!HEX_RE.test(h)) throw new Error(`${label} 含非 hex 字符`);
  const bl = byteLen(c.p);
  if (h.length === 4 * bl + 2) {
    const pre = h.slice(0, 2).toLowerCase();
    if (pre !== "04") throw new Error(`${label} 前缀非法：${pre}（应为 04 非压缩）`);
    const x = BigInt("0x" + h.slice(2, 2 + 2 * bl));
    const y = BigInt("0x" + h.slice(2 + 2 * bl));
    if (x >= c.p || y >= c.p) throw new Error(`${label} 坐标超出域范围（≥p）`);
    if (!onCurve(x, y, c)) throw new Error(`${label} 不在曲线 ${c.name} 上`);
    return [x, y];
  }
  if (h.length === 2 + 2 * bl && /^(02|03)/i.test(h)) {
    return decompressPoint(BigInt("0x" + h.slice(2)), Number(h.slice(0, 2)) & 1, c, label);
  }
  if (h.length === 4 * bl) {
    const x = BigInt("0x" + h.slice(0, 2 * bl));
    const y = BigInt("0x" + h.slice(2 * bl));
    if (!onCurve(x, y, c)) throw new Error(`${label} 不在曲线 ${c.name} 上`);
    return [x, y];
  }
  throw new Error(
    `${label} 长度不符：需 04‖X‖Y（${4 * bl + 2} hex）/ 02|03‖X（${2 + 2 * bl} hex）/ X‖Y（${4 * bl} hex），收到 ${h.length} 字符`
  );
}

/** 压缩点解压：四条内置曲线均 p ≡ 3 (mod 4) → y = (x³+ax+b)^((p+1)/4)（SEC 1 v2 §2.3.4） */
function decompressPoint(x, odd, c, label) {
  if (x >= c.p) throw new Error(`${label} 坐标超出域范围（≥p）`);
  if (mod(c.p, 4n) !== 3n) throw new Error("压缩点解压需 p ≡ 3 (mod 4)（Tonelli-Shanks 未实现）");
  const y2 = mod(x * x * x + c.a * x + c.b, c.p);
  let y = modPow(y2, (c.p + 1n) / 4n, c.p);
  if (mod(y * y, c.p) !== y2) throw new Error(`${label} 不在曲线上（x 无平方根 y）`);
  if ((y & 1n) !== BigInt(odd)) y = mod(c.p - y, c.p);
  return [x, y];
}

function fmtCompressed(P, c) {
  if (!P) return "Infinity (无穷远点 O)";
  const bl = byteLen(c.p);
  return "0" + ((P[1] & 1n) ? "3" : "2") + bytesToHex(bigIntToBytes(P[0], bl, "x"));
}
function fmtUncompressed(P, c) {
  if (!P) return "Infinity (无穷远点 O)";
  const bl = byteLen(c.p);
  return "04" + bytesToHex(bigIntToBytes(P[0], bl, "x")) + bytesToHex(bigIntToBytes(P[1], bl, "y"));
}
function pubParseDescribe(raw) {
  const h = String(raw == null ? "" : raw).trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (/^04/i.test(h)) return "非压缩 04‖X‖Y";
  if (/^0[23]/i.test(h)) return "压缩 02/03‖X";
  if (/^g$/i.test(h)) return "生成元 G";
  return "裸 X‖Y 拼接";
}

// ============================================================
// RFC 6979 §3.2 — 确定 k（HMAC_DRBG）
// ============================================================
function bits2int(b, qlen) {
  // RFC 6979 §2.3.2：取 b 最左 qlen 位
  let v = bytesToBigInt(b);
  const blen = b.length * 8;
  if (blen > qlen) v >>= BigInt(blen - qlen);
  return v;
}

async function rfc6979K(d, h1, c, hashKey) {
  const H = HASHES[hashKey];
  const qlen = bitLen(c.n);
  const rlen = (qlen + 7) >> 3;
  const x2 = bigIntToBytes(d, rlen, "d");                 // int2octets(x)
  const h2 = bigIntToBytes(mod(bits2int(h1, qlen), c.n), rlen, "h1"); // bits2octets(h1)
  let V = new Uint8Array(H.len).fill(1);
  let K = new Uint8Array(H.len).fill(0);
  const hmac = (k, m) => hmacShaBytes(H.norm, k, m);
  K = await hmac(K, catBytes(V, new Uint8Array([0]), x2, h2));
  V = await hmac(K, V);
  K = await hmac(K, catBytes(V, new Uint8Array([1]), x2, h2));
  V = await hmac(K, V);
  for (;;) {
    let T = new Uint8Array(0);
    while (T.length < rlen) { V = await hmac(K, V); T = catBytes(T, V); }
    const k = bits2int(T, qlen);
    if (k >= 1n && k < c.n) return k;   // r/s 为 0 的概率≈2^-256，重入本函数重新生成
    K = await hmac(K, catBytes(V, new Uint8Array([0])));
    V = await hmac(K, V);
  }
}

// ============================================================
// ECDSA 核心：哈希截断 / 签名 / 验签（FIPS 186-4 §6.3 / X9.62）
// ============================================================
function hashToE(h1, c) {
  // e = h1 最左 min(bitLen(n), hLen) 位
  return bits2int(h1, bitLen(c.n));
}

async function ecdsaSignRaw(c, d, msgBytes, hashKey, kMode) {
  const H = HASHES[hashKey];
  if (d < 1n || d >= c.n) throw new Error(`私钥 d 需在 [1, n-1] 内（n = ${c.n}）`);
  const h1 = await shaBytes(H.norm, msgBytes);
  const e = hashToE(h1, c);
  let r = 0n, s = 0n, k = 0n, guard = 0;
  for (;;) {
    if (guard++ > 16) throw new Error("签名重试超限（概率≈0，输入异常）");
    k = kMode === "rfc6979" ? await rfc6979K(d, h1, c, hashKey) : randBelow(c.n);
    const R = ecToAffine(ecMul(k, c.Gx, c.Gy, c.a, c.p), c.p);
    if (!R) continue;
    r = mod(R[0], c.n);
    if (r === 0n) continue;
    s = mod(modInverse(k, c.n) * mod(e + r * d, c.n), c.n);
    if (s === 0n) continue;
    return { r, s, k, e, h1 };
  }
}

function ecdsaVerifyRaw(c, Q, r, s, e) {
  const { n, p, a } = c;
  if (r < 1n || r >= n) return { valid: false, reason: `r 超出 [1, n-1]` };
  if (s < 1n || s >= n) return { valid: false, reason: `s 超出 [1, n-1]` };
  if (!onCurve(Q[0], Q[1], c)) return { valid: false, reason: "公钥不在曲线上" };
  const w = modInverse(s, n);
  const u1 = mod(e * w, n);
  const u2 = mod(r * w, n);
  const R = ecToAffine(
    ecPointAdd(ecMul(u1, c.Gx, c.Gy, a, p), ecMul(u2, Q[0], Q[1], a, p), a, p),
    p
  );
  if (!R) return { valid: false, reason: "R = u1·G + u2·Q 为无穷远点", u1, u2 };
  const v = mod(R[0], n);
  return { valid: v === r, v, R, u1, u2, w };
}

/** 拒绝采样取 [1, n-1] 均匀随机（无偏） */
function randBelow(n) {
  if (!globalThis.crypto?.getRandomValues) throw new Error("当前环境不支持 crypto.getRandomValues");
  const len = byteLen(n);
  const b = new Uint8Array(len);
  for (;;) {
    globalThis.crypto.getRandomValues(b);
    const v = bytesToBigInt(b);
    if (v >= 1n && v < n) return v;
  }
}

// ============================================================
// DER / raw / JOSE 签名序列化
// ============================================================
function derLenBytes(n) {
  if (n < 128) return [n];
  const h = n.toString(16).padStart(2, "0");
  const body = [];
  for (let i = 0; i < h.length; i += 2) body.push(parseInt(h.slice(i, i + 2), 16));
  return [0x80 | body.length, ...body];
}

/** DER INTEGER：最小字节数二补码正整数（X.690 §8.3.1/8.3.2：高位为 1 时补 0x00） */
function derEncodeInt(v) {
  if (v < 0n) throw new Error("签名 r/s 恒非负，不支持负数 DER INTEGER");
  let h = v.toString(16);
  if (h.length % 2) h = "0" + h;
  const raw = hexToBytes(h);
  let i = 0;
  while (i < raw.length - 1 && raw[i] === 0 && (raw[i + 1] & 0x80) === 0) i++; // 去冗余前导 0x00
  let body = Array.from(raw.slice(i));
  if (body[0] & 0x80) body = [0x00, ...body];
  return [0x02, ...derLenBytes(body.length), ...body];
}

/** ECDSA 签名 DER：SEQUENCE { r INTEGER, s INTEGER }（X.690 / SEC 1 v2 §4.1.3） */
function sigToDer(r, s) {
  const body = [...derEncodeInt(r), ...derEncodeInt(s)];
  return new Uint8Array([0x30, ...derLenBytes(body.length), ...body]);
}

/** 解析 DER 签名 → { r, s, trailing }。严格校验 tag/长度/INTEGER 结构。 */
function derToSig(b) {
  let i = 0;
  const readLen = () => {
    const first = b[i++];
    if (first < 0x80) return first;
    const cnt = first & 0x7f;
    if (cnt === 0 || cnt > 4) throw new Error("DER 长度非法（不定长/超长）");
    let L = 0;
    for (let j = 0; j < cnt; j++) L = L * 256 + b[i++];
    return L;
  };
  if (b.length < 8) throw new Error("DER 数据过短");
  if (b[i++] !== 0x30) throw new Error("缺 SEQUENCE 头 0x30");
  const seqLen = readLen();
  const seqEnd = i + seqLen;
  if (seqEnd > b.length) throw new Error("SEQUENCE 长度超出数据实际长度");
  const readInt = () => {
    if (b[i++] !== 0x02) throw new Error("缺 INTEGER 标签 0x02");
    const len = readLen();
    if (len === 0) throw new Error("INTEGER 长度为 0");
    const seg = b.slice(i, i + len);
    if (seg.length < len) throw new Error("INTEGER 长度超出数据");
    i += len;
    if (seg[0] & 0x80) throw new Error("INTEGER 为负（签名 r/s 不应为负）");
    return bytesToBigInt(seg);
  };
  const r = readInt();
  const s = readInt();
  if (i !== seqEnd) throw new Error("SEQUENCE 内有多余数据");
  return { r, s, trailing: i !== b.length };
}

/** 解析签名输入：DER hex（0x30 开头）或 r,s / r;s（十进制或 0x hex 或裸 hex） */
function parseSigInput(raw) {
  const str = String(raw == null ? "" : raw).trim();
  if (!str) throw new Error("缺少签名输入");
  const compact = str.replace(/^0x/i, "").replace(/\s+/g, "");
  if (/^[0-9a-f]+$/i.test(compact) && /^30/i.test(compact) && compact.length % 2 === 0 && compact.length >= 8) {
    try {
      const { r, s, trailing } = derToSig(hexToBytes(compact));
      if (!trailing) return { r, s, src: "DER" };
    } catch { /* 结构坏且无分隔符 → 走 raw 分支报更准的错 */ }
  }
  const parts = str.replace(/^0x/i, "").split(/[,;\s]+/).filter(Boolean);
  if (parts.length === 2) {
    return { r: parseBigAuto(parts[0], "r"), s: parseBigAuto(parts[1], "s"), src: "raw(r;s)" };
  }
  if (/^30/i.test(compact) && compact.length % 2 === 0) {
    try { derToSig(hexToBytes(compact)); } catch (e) { throw new Error("DER 解析失败：" + e.message); }
  }
  throw new Error("无法解析签名：支持 DER hex（0x30 开头）或 r;s / r,s（十进制 / 0x hex / 裸 hex）");
}

function msgToBytes(text, enc) {
  if (enc === "hex") return hexToBytes(text, "消息");
  return new TextEncoder().encode(String(text == null ? "" : text));
}

// ============================================================
// op 1 · ecdsaKeyGen
// ============================================================
function ecdsaKeyGenRun(_text, p = {}) {
  const c = getCurve(p.curve || "secp256k1");
  const d = randBelow(c.n);
  const Q = ecToAffine(ecMul(d, c.Gx, c.Gy, c.a, c.p), c.p);
  const bl = byteLen(c.n);
  const dHex = bytesToHex(bigIntToBytes(d, bl, "d"));
  const mainFmt = p.pubFormat || "uncompressed";
  const L = [];
  L.push("=== ECDSA 密钥对生成 ===");
  L.push(`曲线: ${c.name}（${c.std}）`);
  L.push(`随机源: crypto.getRandomValues（拒绝采样，无偏）`);
  L.push("");
  L.push(`私钥 d (hex)      = ${dHex}`);
  L.push(`私钥 d (十进制)   = ${d}`);
  L.push("");
  L.push(`公钥 Q = d·G:`);
  L.push(`  x (hex)         = ${bytesToHex(bigIntToBytes(Q[0], byteLen(c.p), "x"))}`);
  L.push(`  y (hex)         = ${bytesToHex(bigIntToBytes(Q[1], byteLen(c.p), "y"))}`);
  L.push(`公钥（非压缩 04‖X‖Y） = ${fmtUncompressed(Q, c)}`);
  L.push(`公钥（压缩 02/03‖X）  = ${fmtCompressed(Q, c)}`);
  L.push("");
  L.push(`主格式（pubFormat=${mainFmt}）: ${mainFmt === "compressed" ? fmtCompressed(Q, c) : fmtUncompressed(Q, c)}`);
  L.push("");
  L.push("提示: 私钥切勿提交/外传；配套签名/验签见 ecdsaSign / ecdsaVerify。");
  // T362 产物协议（2026-09-02）：私钥 / 公钥分开交付下载按钮（恒烈指示）。
  // 私钥 = d 的 hex 文本；公钥 = 主格式（pubFormat）hex 文本，配套 pemkeys 可再转 PEM/JWK。
  const curveTag = (p.curve || "secp256k1").toLowerCase();
  return {
    text: L.join("\n"),
    files: [
      { name: `ecdsa_priv_${curveTag}.hex`, mime: "text/plain", bytes: new TextEncoder().encode(dHex + "\n") },
      { name: `ecdsa_pub_${curveTag}_${mainFmt === "compressed" ? "comp" : "uncomp"}.hex`, mime: "text/plain",
        bytes: new TextEncoder().encode((mainFmt === "compressed" ? fmtCompressed(Q, c) : fmtUncompressed(Q, c)) + "\n") },
    ],
  };
}

// ============================================================
// op 2 · ecdsaSign
// ============================================================
async function ecdsaSignRun(text, p = {}) {
  const c = getCurve(p.curve || "secp256k1");
  const hashKey = p.hash || "sha256";
  const H = HASHES[hashKey];
  if (!H) throw new Error(`未知哈希：${hashKey}`);
  const kMode = p.kMode || "rfc6979";
  const d = parseBigAuto(p.d, "私钥 d（十进制或 0x hex）");
  const msg = msgToBytes(text, p.msgEnc || "text");
  const { r, s, k, e, h1 } = await ecdsaSignRaw(c, d, msg, hashKey, kMode);
  const Q = ecToAffine(ecMul(d, c.Gx, c.Gy, c.a, c.p), c.p);
  const bl = byteLen(c.n);
  const rHex = bytesToHex(bigIntToBytes(r, bl, "r"));
  const sHex = bytesToHex(bigIntToBytes(s, bl, "s"));
  const der = sigToDer(r, s);
  const L = [];
  L.push("=== ECDSA 签名 ===");
  L.push(`曲线: ${c.name}（${c.std}）  哈希: ${H.label}  消息编码: ${p.msgEnc || "text"}`);
  L.push(`k 模式: ${kMode === "rfc6979" ? "RFC 6979 确定 k（同输入同签名，可复现）" : "随机 k（crypto.getRandomValues）"}`);
  L.push("");
  L.push(`消息 (${p.msgEnc || "text"}) = ${p.msgEnc === "hex" ? bytesToHex(msg) : JSON.stringify(String(text))}`);
  L.push(`h1 = ${H.label}(msg) = ${bytesToHex(h1)}`);
  L.push(`e  = 左取 ${bitLen(c.n)} 位 = ${e}`);
  L.push("");
  L.push(`k (hex)   = ${bytesToHex(bigIntToBytes(k, bl, "k"))}`);
  L.push(`r = ${r}`);
  L.push(`s = ${s}`);
  L.push(`r (hex)   = ${rHex}`);
  L.push(`s (hex)   = ${sHex}`);
  L.push("");
  L.push(`签名 DER (hex) = ${bytesToHex(der)}`);
  L.push(`签名 raw (r;s) = ${r};${s}`);
  if (s > c.n / 2n) L.push(`低-s 归一化候选（比特币/以太坊 BIP62/ETIP 约定）: s' = n - s = ${c.n - s}（本工具不自动替换）`);
  L.push("");
  L.push(`公钥 Q（由 d 推导）:`);
  L.push(`  非压缩 = ${fmtUncompressed(Q, c)}`);
  L.push(`  压缩   = ${fmtCompressed(Q, c)}`);
  // T364 产物协议：DER 签名出 .sig 二进制（字节与文本区「签名 DER (hex)」一致）
  const files = [{
    name: `ecdsa_sig_${(p.curve || "secp256k1").toLowerCase()}_${hashKey}.sig`,
    mime: "application/octet-stream", bytes: der,
  }];
  L.push("", `产物：1 个文件可下载（${files[0].name}，字节与上方 DER hex 一致）`);
  return { text: L.join("\n"), files };
}

// ============================================================
// op 3 · ecdsaVerify
// ============================================================
async function ecdsaVerifyRun(text, p = {}) {
  const c = getCurve(p.curve || "secp256k1");
  const hashKey = p.hash || "sha256";
  const H = HASHES[hashKey];
  if (!H) throw new Error(`未知哈希：${hashKey}`);
  const msg = msgToBytes(text, p.msgEnc || "text");
  const h1 = await shaBytes(H.norm, msg);
  const e = hashToE(h1, c);
  const Q = parsePoint(p.pub, c, "公钥");
  if (!Q) throw new Error("公钥不能为无穷远点 O");
  const sig = parseSigInput(p.sig);
  const v = ecdsaVerifyRaw(c, Q, sig.r, sig.s, e);
  const L = [];
  L.push("=== ECDSA 验签 ===");
  L.push(`曲线: ${c.name}（${c.std}）  哈希: ${H.label}  消息编码: ${p.msgEnc || "text"}`);
  L.push("");
  L.push(`消息 (${p.msgEnc || "text"}) = ${p.msgEnc === "hex" ? bytesToHex(msg) : JSON.stringify(String(text))}`);
  L.push(`h1 = ${bytesToHex(h1)}`);
  L.push(`e  = ${e}`);
  L.push("");
  L.push(`公钥（识别为${pubParseDescribe(p.pub)}）:`);
  L.push(`  x = ${bytesToHex(bigIntToBytes(Q[0], byteLen(c.p), "x"))}`);
  L.push(`  y = ${bytesToHex(bigIntToBytes(Q[1], byteLen(c.p), "y"))}`);
  L.push(`  在曲线上: ${onCurve(Q[0], Q[1], c) ? "✓" : "✗"}`);
  L.push("");
  L.push(`签名来源: ${sig.src}`);
  L.push(`r = ${sig.r}`);
  L.push(`s = ${sig.s}`);
  L.push("");
  if (v.valid === false && v.reason) {
    L.push(`✗ 签名不合法（${v.reason}）`);
  } else {
    L.push(`w = s⁻¹ mod n = ${v.w}`);
    L.push(`u1 = e·w mod n = ${v.u1}`);
    L.push(`u2 = r·w mod n = ${v.u2}`);
    L.push(`R = u1·G + u2·Q = (x=0x${v.R[0].toString(16)}, y=0x${v.R[1].toString(16)})`);
    L.push(`v = R.x mod n = ${v.v}`);
    L.push(v.valid ? "✓ 签名合法（v == r）" : "✗ 签名不合法（v ≠ r）");
  }
  return L.join("\n");
}

// ============================================================
// op 4 · ecdsaSigConvert
// ============================================================
function ecdsaSigConvertRun(text, p = {}) {
  const from = p.from || "der";
  const to = p.to || "raw";
  const c = getCurve(p.curve || "p256");
  const bl = byteLen(c.n);
  const raw = String(text == null ? "" : text).trim();
  if (!raw) throw new Error("缺少输入：主文本框粘贴签名");

  let r, s;
  if (from === "raw") {
    const parts = raw.replace(/^0x/i, "").split(/[,;\s]+/).filter(Boolean);
    if (parts.length !== 2) throw new Error("raw 输入须为 r;s / r,s 两组数（十进制或 0x hex）");
    r = parseBigAuto(parts[0], "r");
    s = parseBigAuto(parts[1], "s");
  } else if (from === "der") {
    const { r: rr, s: ss, trailing } = derToSig(hexToBytes(raw, "DER 签名"));
    if (trailing) throw new Error("DER SEQUENCE 后有多余数据");
    r = rr; s = ss;
  } else if (from === "jose") {
    const b = b64urlToBytes(raw, "JOSE 签名");
    if (b.length % 2 !== 0 || b.length < 8) throw new Error(`JOSE 签名字节长度须为偶数且 ≥8（${c.name} 应为 ${2 * bl} 字节）`);
    r = bytesToBigInt(b.slice(0, b.length / 2));
    s = bytesToBigInt(b.slice(b.length / 2));
  } else {
    throw new Error(`未知来源格式：${from}`);
  }
  if (r < 0n || s < 0n) throw new Error("r/s 不能为负");

  const rawPairs = `${r};${s}`;
  const rawHex = bytesToHex(bigIntToBytes(r, bl, "r")) + bytesToHex(bigIntToBytes(s, bl, "s"));
  if (r >= c.n || s >= c.n) {
    // JOSE/raw 定宽编码会失败或非规范：仅当真放不下时才拦
    const maxBits = bl * 8;
    if (bitLen(r) > maxBits || bitLen(s) > maxBits) throw new Error(`r 或 s 超出 ${c.name} 元素宽度（${bl} 字节），请检查曲线选择`);
  }
  const der = bytesToHex(sigToDer(r, s));
  const jose = bytesToB64url(catBytes(bigIntToBytes(r, bl, "r"), bigIntToBytes(s, bl, "s")));

  const NAMES = { raw: "raw (r;s 十进制)", der: "DER (ASN.1 hex)", jose: "JOSE (base64url)" };
  const VALS = {
    raw: rawPairs,
    der: der,
    jose: jose,
  };
  const L = [];
  L.push("=== ECDSA 签名格式转换 ===");
  L.push(`曲线（定宽基准）: ${c.name}  元素宽度 ${bl} 字节   ${NAMES[from]} → ${NAMES[to]}`);
  L.push("");
  L.push(`r (十进制) = ${r}`);
  L.push(`s (十进制) = ${s}`);
  L.push(`r (hex)    = ${bytesToHex(bigIntToBytes(r, bl, "r"))}`);
  L.push(`s (hex)    = ${bytesToHex(bigIntToBytes(s, bl, "s"))}`);
  L.push("");
  L.push(`[输出·${NAMES[to]}] ${VALS[to]}`);
  L.push("");
  L.push("全格式：");
  L.push(`  raw  (r;s)          = ${rawPairs}`);
  L.push(`  raw  (r||s 定宽hex) = ${rawHex}`);
  L.push(`  DER  (hex)          = ${der}`);
  L.push(`  JOSE (base64url)    = ${jose}`);
  return L.join("\n");
}

// ============================================================
// op 5 · eccCalc（cat: modern）
// ============================================================
function eccCalcRun(_text, p = {}) {
  const opName = p.op || "add";
  let c;
  if ((p.curve || "secp256k1") === "custom") {
    c = buildCustomCurve(p.p, p.a, p.b, p.Gx, p.Gy, p.n);
  } else {
    c = getCurve(p.curve || "secp256k1");
  }
  const P = parsePoint(p.P, c, "点 P");
  const bl = byteLen(c.p);
  const L = [];
  L.push("=== ECC 点运算 ===");
  L.push(`曲线: ${c.name}（${c.std}）   运算: ${{ add: "点加 P+Q", sub: "点减 P-Q", mul: "标量乘 k·P", double: "倍点 2·P" }[opName] || opName}`);
  L.push("");
  L.push(`P = ${fmtShort(P, c, bl)}`);
  if (opName === "add" || opName === "sub") {
    const Q = parsePoint(p.Q, c, "点 Q");
    L.push(`${opName === "sub" ? "Q (原) = " : "Q = "}${fmtShort(Q, c, bl)}`);
    if (!P || !Q) throw new Error("点加/点减的 P/Q 不能为无穷远点（结果平凡，直接推得）");
    let R;
    if (opName === "add") {
      R = ecToAffine(ecPointAdd(affineToJac(P), affineToJac(Q), c.a, c.p), c.p);
    } else {
      const negQ = [Q[0], mod(c.p - Q[1], c.p)];
      L.push(`-Q = ${fmtShort(negQ, c, bl)}`);
      R = ecToAffine(ecPointAdd(affineToJac(P), affineToJac(negQ), c.a, c.p), c.p);
    }
    L.push("");
    L.push(`结果 R = ${!R ? "Infinity (无穷远点 O)" : ""}`);
    if (R) {
      L.push(`  非压缩 = ${fmtUncompressed(R, c)}`);
      L.push(`  压缩   = ${fmtCompressed(R, c)}`);
      L.push(`  x = ${R[0]}`);
      L.push(`  y = ${R[1]}`);
      L.push(`  在曲线上: ${onCurve(R[0], R[1], c) ? "✓" : "✗"}`);
    }
  } else if (opName === "mul" || opName === "double") {
    let k;
    if (opName === "double") {
      k = 2n;
      if (!P) throw new Error("无穷远点的倍点仍是 O（2·O = O）");
    } else {
      k = parseBigAuto(p.k, "标量 k（十进制或 0x hex）");
      if (!P) throw new Error("无穷远点的标量乘仍为 O（k·O = O）");
    }
    if (k === 0n) {
      L.push("");
      L.push(`k = 0 → 结果 = Infinity (无穷远点 O)`);
      return L.join("\n");
    }
    let kEff = k, negated = false;
    if (k < 0n) { kEff = -k; negated = true; }
    if (c.n && kEff >= c.n) {
      L.push(`注: |k| ≥ n，先约简 k mod n = ${mod(kEff, c.n)}`);
      kEff = mod(kEff, c.n);
    }
    if (kEff === 0n) {
      L.push("");
      L.push(`k ≡ 0 (mod n) → 结果 = Infinity (无穷远点 O)`);
      return L.join("\n");
    }
    let Pt = negated ? [P[0], mod(c.p - P[1], c.p)] : P;
    if (negated) L.push(`k < 0 → k·P = (-k)·(-P)，-P = ${fmtShort(Pt, c, bl)}`);
    L.push(`k = ${k}${negated || (c.n && k >= c.n) ? `（有效 k = ${kEff}${negated ? "，作用于 -P" : ""}）` : ""}  k (hex) = ${k.toString(16)}`);
    const R = ecToAffine(ecMul(kEff, Pt[0], Pt[1], c.a, c.p), c.p);
    L.push("");
    L.push(`结果 R = ${!R ? "Infinity (无穷远点 O)" : ""}`);
    if (R) {
      L.push(`  非压缩 = ${fmtUncompressed(R, c)}`);
      L.push(`  压缩   = ${fmtCompressed(R, c)}`);
      L.push(`  x = ${R[0]}`);
      L.push(`  y = ${R[1]}`);
      L.push(`  在曲线上: ${onCurve(R[0], R[1], c) ? "✓" : "✗"}`);
    }
  } else {
    throw new Error(`未知运算：${opName}`);
  }
  return L.join("\n");
}

function affineToJac(P) { return [P[0], P[1], 1n]; }
function fmtShort(P, c, bl) {
  if (!P) return "Infinity (无穷远点 O)";
  return `(x=0x${bytesToHex(bigIntToBytes(P[0], bl, "x"))}, y=0x${bytesToHex(bigIntToBytes(P[1], bl, "y"))})`;
}

// ============================================================
// 注册（件内自注册，id 已 grep 查重无撞）
// ============================================================
register({
  id: "ecdsaKeyGen",
  family: "ecdsa", familyLabel: "keygen",
  cat: "asym",
  name: "ECDSA 密钥对生成",
  desc: "ECDSA 密钥对生成：secp256k1 / P-256 / P-384 / P-521 任选，输出私钥 d 与公钥（压缩 02/03‖X + 非压缩 04‖X‖Y 双格式）。随机源 crypto.getRandomValues 拒绝采样无偏。域参数：SEC 2 v2 / FIPS 186-4 D.1.2。",
  params: [
    { key: "curve", label: "曲线", type: "select", default: "secp256k1", options: CURVE_OPTIONS },
    { key: "pubFormat", label: "公钥主格式", type: "select", default: "uncompressed", options: [
      { value: "uncompressed", label: "非压缩 04‖X‖Y" },
      { value: "compressed", label: "压缩 02/03‖X" },
    ] },
  ],
  run: ecdsaKeyGenRun,
});

register({
  id: "ecdsaSign",
  family: "ecdsa", familyLabel: "sign",
  cat: "asym",
  name: "ECDSA 签名",
  desc: "ECDSA 签名：输入消息（text/hex）+ 私钥 d，曲线 secp256k1/P-256/P-384/P-521，哈希 SHA-256/384/512，k 可选 RFC 6979 确定 k（可复现）或随机 k。输出 r,s 十进制+hex、DER hex、所用 k。RFC 6979 A.2.5 官方向量逐字验证。",
  params: [
    { key: "curve", label: "曲线", type: "select", default: "secp256k1", options: CURVE_OPTIONS },
    { key: "hash", label: "哈希", type: "select", default: "sha256", options: [
      { value: "sha256", label: "SHA-256" },
      { value: "sha384", label: "SHA-384" },
      { value: "sha512", label: "SHA-512" },
    ] },
    { key: "kMode", label: "k 模式", type: "select", default: "rfc6979", options: [
      { value: "rfc6979", label: "RFC 6979 确定 k（推荐，可复现）" },
      { value: "random", label: "随机 k" },
    ] },
    { key: "msgEnc", label: "消息编码", type: "select", default: "text", options: [
      { value: "text", label: "文本" },
      { value: "hex", label: "hex 字节" },
    ] },
    { key: "d", label: "私钥 d", type: "text", default: "", placeholder: "十进制或 0x hex（1 ≤ d < n）" },
  ],
  run: ecdsaSignRun,
});

register({
  id: "ecdsaVerify",
  family: "ecdsa", familyLabel: "verify",
  cat: "asym",
  name: "ECDSA 验签",
  desc: "ECDSA 验签：输入消息 + 公钥（压缩/非压缩/X‖Y hex 自动识别，G=生成元）+ 签名（r;s 十进制/hex 或 DER hex 自动识别）。曲线四条任选，哈希 SHA-256/384/512。输出 w/u1/u2/R 全过程与合法性判定。",
  params: [
    { key: "curve", label: "曲线", type: "select", default: "secp256k1", options: CURVE_OPTIONS },
    { key: "hash", label: "哈希", type: "select", default: "sha256", options: [
      { value: "sha256", label: "SHA-256" },
      { value: "sha384", label: "SHA-384" },
      { value: "sha512", label: "SHA-512" },
    ] },
    { key: "msgEnc", label: "消息编码", type: "select", default: "text", options: [
      { value: "text", label: "文本" },
      { value: "hex", label: "hex 字节" },
    ] },
    { key: "pub", label: "公钥 Q", type: "text", default: "", placeholder: "04‖X‖Y / 02|03‖X / X‖Y / G" },
    { key: "sig", label: "签名", type: "text", default: "", placeholder: "DER hex（30 开头）或 r;s 十进制/0x hex" },
  ],
  run: ecdsaVerifyRun,
});

register({
  id: "ecdsaSigConvert",
  family: "ecdsa", familyLabel: "convert",
  cat: "asym",
  name: "ECDSA 签名格式转换",
  desc: "ECDSA 签名三格式互转：raw r;s（十进制/0x hex）↔ DER（ASN.1 SEQUENCE{r,s}，ITU-T X.690）↔ JOSE（r||s 定宽 base64url，RFC 7515）。曲线参数决定 JOSE/raw-hex 的元素定宽（P-256=32B 等）。",
  params: [
    { key: "from", label: "输入格式", type: "select", default: "der", options: [
      { value: "raw", label: "raw (r;s)" },
      { value: "der", label: "DER (hex)" },
      { value: "jose", label: "JOSE (base64url)" },
    ] },
    { key: "to", label: "输出格式", type: "select", default: "jose", options: [
      { value: "raw", label: "raw (r;s)" },
      { value: "der", label: "DER (hex)" },
      { value: "jose", label: "JOSE (base64url)" },
    ] },
    { key: "curve", label: "曲线（定宽）", type: "select", default: "p256", options: CURVE_OPTIONS },
  ],
  run: ecdsaSigConvertRun,
});

register({
  id: "eccCalc",
  cat: "asym",
  name: "ECC 点运算",
  desc: "椭圆曲线点运算计算器：点加/点减/标量乘/倍点。曲线四条预设（secp256k1/P-256/P-384/P-521）或自定义 p/a/b/Gx/Gy/n。点支持压缩 02/03‖X、非压缩 04‖X‖Y、裸 X‖Y、G（生成元）、O（无穷远点）；k 支持十进制/0x hex/负数。无穷远点输出 Infinity。",
  params: [
    { key: "op", label: "运算", type: "select", default: "add", options: [
      { value: "add", label: "点加 P+Q" },
      { value: "sub", label: "点减 P-Q" },
      { value: "mul", label: "标量乘 k·P" },
      { value: "double", label: "倍点 2·P" },
    ] },
    { key: "curve", label: "曲线", type: "select", default: "secp256k1", options: [...CURVE_OPTIONS, { value: "custom", label: "自定义 p/a/b/Gx/Gy/n" }] },
    { key: "P", label: "点 P", type: "text", default: "G", placeholder: "04‖X‖Y / 02|03‖X / X‖Y / G / O" },
    { key: "Q", label: "点 Q（点加/点减用）", type: "text", default: "G", placeholder: "同上格式" },
    { key: "k", label: "标量 k（标量乘用）", type: "text", default: "2", placeholder: "十进制或 0x hex，可负" },
    { key: "p", label: "p（custom 用）", type: "text", default: "", placeholder: "素域模数（素数）" },
    { key: "a", label: "a（custom 用）", type: "text", default: "", placeholder: "曲线 y²=x³+ax+b" },
    { key: "b", label: "b（custom 用）", type: "text", default: "", placeholder: "曲线 y²=x³+ax+b" },
    { key: "Gx", label: "Gx（custom 用）", type: "text", default: "", placeholder: "生成元 x（P/Q 填 G 时必需）" },
    { key: "Gy", label: "Gy（custom 用）", type: "text", default: "", placeholder: "生成元 y" },
    { key: "n", label: "n（custom 用）", type: "text", default: "", placeholder: "阶（标量约简用，可选）" },
  ],
  run: eccCalcRun,
});

export {
  CURVES, ecdsaSignRaw, ecdsaVerifyRaw, sigToDer, derToSig, rfc6979K,
  parsePoint, fmtCompressed, fmtUncompressed, hashToE,
};
