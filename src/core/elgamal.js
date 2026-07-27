/*
 * elgamal.js — ElGamal 公钥加密（T277 P1，cat:'modern'）。
 *
 * 算法照 Menezes Handbook of Applied Cryptography §8.4（Algorithm 8.81/8.82）实现：
 * 密钥生成：选大素数 p + 原根 g，私钥 x ∈ [1,p-2]，公钥 y = g^x mod p
 * 加密（m < p）：
 * 选随机 k ∈ [1,p-2]
 * c1 = g^k mod p
 * c2 = m · y^k mod p
 * 密文 = (c1, c2)
 * 解密：
 * s = c1^x mod p（共享密钥）
 * s⁻¹ = s^(p-2) mod p（Fermat 小定理，p 素数时 s·s^(p-2) ≡ 1 mod p）
 * m = c2 · s⁻¹ mod p
 *
 * 红线：
 * - 算法照 HAC §8.4 实现，不编造。
 * - 随机 k 用 crypto.getRandomValues，不用 Math.random。
 * - 明文 m 必须 < p（与 RSA 同约束，CTF 场景短消息转 BigInt < p）。
 * - 零外发：纯本地计算。
 * - core 层零 UI 依赖（仅 registry）。
 *
 * 契约：register({id, cat:"modern", name, desc, params, encode, decode})。
 * 密文格式：c1,c2（十进制逗号分隔，或 hex:c1hex,c2hex）。
 * 复用 modern.js 的 bytesToBigInt/bigIntToBytes + decodeInput/encodeOutput。
 */
import { register } from "./registry.js";
import { bytesToBigInt, bigIntToBytes } from "./modern.js";

// ============================================================
// 编码工具（与 cryptoGap.js 范式一致，modern.js 未导出 decodeInput/encodeOutput 故自备）
// ============================================================
const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

function hexToBytes(s) {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("hex 长度必须为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
function b64ToBytes(s) {
  const bin = atob(s.replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(b) {
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin);
}
function decodeInput(text, enc) {
  switch (enc) {
    case "hex": return hexToBytes(text);
    case "base64": return b64ToBytes(text);
    case "utf8":
    default: return te(text);
  }
}
function encodeOutput(bytes, enc) {
  switch (enc) {
    case "hex": return bytesToHex(bytes);
    case "base64": return bytesToB64(bytes);
    case "utf8":
    default: return td(bytes);
  }
}

// ============================================================
// 模幂 (base^exp) mod m — BigInt 快速幂
// ============================================================
function modPow(base, exp, m) {
  if (m === 1n) return 0n;
  let result = 1n;
  base = base % m;
  if (base < 0n) base += m;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % m;
    exp >>= 1n;
    base = (base * base) % m;
  }
  return result;
}

// ============================================================
// ElGamal 加密
// ============================================================

/**
 * 生成随机 k ∈ [1, p-2]
 * k 不需要与 p-1 互质（ElGamal 安全性要求 k 对每条消息唯一即可）
 */
function randomK(p) {
  const pMinus2 = p - 2n;
 // 生成 [0, p-3] 范围随机数再 +1 → [1, p-2]
  const bits = pMinus2.toString(2).length;
  const bytes = Math.ceil(bits / 8);
  const buf = new Uint8Array(bytes);
  let k;
  do {
    crypto.getRandomValues(buf);
    k = 0n;
    for (const b of buf) k = (k << 8n) | BigInt(b);
    k = (k % (pMinus2)) + 1n; // [1, p-2]
  } while (k < 1n);
  return k;
}

/**
 * 文本 → BigInt（复用 rsa 范式）
 * dec: 直接十进制, hex: hex→BigInt, base64: base64→bytes→BigInt, utf8: UTF-8→bytes→BigInt
 */
function textToBigInt(text, enc) {
  if (enc === "dec") return BigInt(text.trim());
  if (enc === "hex") {
    const hex = text.trim().replace(/[^0-9a-fA-F]/g, "");
    return hex ? BigInt("0x" + hex) : 0n;
  }
 // base64 / utf8 → bytes → BigInt
  const bytes = decodeInput(text, enc);
  return bytesToBigInt(new Uint8Array(bytes));
}

/**
 * BigInt → 文本
 */
function bigIntToText(n, enc) {
  if (enc === "dec") return n.toString(10);
  if (enc === "hex") return n.toString(16);
 // base64 / utf8 → bytes → text
  const bytes = bigIntToBytes(n);
  return encodeOutput(bytes, enc);
}

/**
 * ElGamal 加密
 * @param {bigint} m 明文（m < p）
 * @param {bigint} p 素数
 * @param {bigint} g 原根
 * @param {bigint} y 公钥 y=g^x mod p
 * @returns {{c1: bigint, c2: bigint}} 密文对
 */
function elgamalEncrypt(m, p, g, y) {
  if (m < 0n || m >= p) throw new Error(`明文 m 必须 < p（m 位数 ${m.toString(2).length} ≥ p 位数 ${p.toString(2).length}）`);
  const k = randomK(p);
  const c1 = modPow(g, k, p);
  const yk = modPow(y, k, p);
  const c2 = (m * yk) % p;
  return { c1, c2 };
}

/**
 * ElGamal 解密
 * @param {bigint} c1
 * @param {bigint} c2
 * @param {bigint} p 素数
 * @param {bigint} x 私钥
 * @returns {bigint} 明文 m
 */
function elgamalDecrypt(c1, c2, p, x) {
 // s = c1^x mod p
  const s = modPow(c1, x, p);
 // s⁻¹ = s^(p-2) mod p（Fermat 小定理，p 素数）
  const sInv = modPow(s, p - 2n, p);
 // m = c2 · s⁻¹ mod p
  return (c2 * sInv) % p;
}

// ============================================================
// 密文格式：c1,c2（十进制逗号分隔）
// ============================================================
function parseCipher(text) {
  const s = text.trim().replace(/[\s\n\r]/g, "");
  const parts = s.split(",");
  if (parts.length !== 2) throw new Error('密文格式：c1,c2（逗号分隔）');
  return { c1: BigInt(parts[0].trim()), c2: BigInt(parts[1].trim()) };
}

function formatCipher(c1, c2) {
  return `${c1.toString(10)},${c2.toString(10)}`;
}

// ============================================================
// op 注册
// ============================================================
const ELGAMAL_DATA_ENC = [
  { value: "dec", label: "十进制" },
  { value: "hex", label: "Hex" },
  { value: "base64", label: "Base64" },
  { value: "utf8", label: "UTF-8" },
];

register({
  id: "elgamal", cat: "modern", name: "ElGamal",
  desc: "ElGamal 公钥加密：密文 (c1,c2)，c1=g^k c2=m·y^k，解密 m=c2·(c1^x)⁻¹。密文格式 c1,c2（逗号分隔）",
  params: [
    { key: "p", label: "素数 p", type: "text", default: "", placeholder: "十进制大素数" },
    { key: "g", label: "原根 g", type: "text", default: "", placeholder: "十进制" },
    { key: "y", label: "公钥 y", type: "text", default: "", placeholder: "y=g^x mod p（加密用）" },
    { key: "x", label: "私钥 x", type: "text", default: "", placeholder: "x ∈ [1,p-2]（解密用）" },
    { key: "dataEnc", label: "明文编码", type: "select", default: "dec", options: ELGAMAL_DATA_ENC },
    { key: "outEnc", label: "解密输出", type: "select", default: "dec", options: ELGAMAL_DATA_ENC },
  ],
  encode: (text, p) => {
    const pp = (p.p || "").trim();
    const gg = (p.g || "").trim();
    const yy = (p.y || "").trim();
    if (!pp || !gg || !yy) throw new Error("加密需填 p, g, y");
    const m = textToBigInt(text, p.dataEnc || "dec");
    const { c1, c2 } = elgamalEncrypt(m, BigInt(pp), BigInt(gg), BigInt(yy));
    return formatCipher(c1, c2);
  },
  decode: (text, p) => {
    const pp = (p.p || "").trim();
    const xx = (p.x || "").trim();
    if (!pp || !xx) throw new Error("解密需填 p, x");
    const { c1, c2 } = parseCipher(text);
    const m = elgamalDecrypt(c1, c2, BigInt(pp), BigInt(xx));
    return bigIntToText(m, p.outEnc || "dec");
  },
});

export { modPow, elgamalEncrypt, elgamalDecrypt, randomK };
