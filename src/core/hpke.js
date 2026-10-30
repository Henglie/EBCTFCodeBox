/*
 * hpke.js — HPKE 混合公钥加密（RFC 9180）Base Mode。
 *
 * 固定套件（RFC 9180 §7.2/§7.3/§7.5 官方组合之一）：
 *   KEM  = DHKEM(X25519, HKDF-SHA256)   kem_id = 32（0x0020）
 *   KDF  = HKDF-SHA256                  kdf_id = 1
 *   AEAD = ChaCha20-Poly1305            aead_id = 3（Nk=32, Nn=12, Nt=16）
 *
 * 封装（Seal，§6.1）：临时密钥 (skE, pkE)，dh = X25519(skE, pkR)，
 *   shared_secret = ExtractAndExpand(dh, pkE‖pkR, "eae_prk")，
 *   key / base_nonce 由 KeySchedule<ROLE>(shared_secret, info) 派生，
 *   密文 ct = AEAD.Seal(key, base_nonce, aad, pt)，输出 enc=pkE 与 ct。
 * 本文件只做 base mode（无 PSK/签名认证层）。
 *
 * 复用：X25519（x25519.js，RFC 7748）、ChaCha20-Poly1305（poly1305.js，
 * RFC 8439）；HKDF-SHA256 按字节级自实现（WebCrypto HMAC，与 RFC 5869 §2 对拍）。
 * 向量：RFC 9180 附录 A.2（本套件 base mode 官方向量）逐字节验证。
 *
 * 红线：纯本地计算，零外发；加密侧临时私钥默认取统一随机源（randSource），
 *       可显式给定复现；解密不取随机。
 */

import { register } from "./registry.js";
import { x25519, scalarBase } from "./x25519.js";
import { chacha20Poly1305Encrypt, chacha20Poly1305Decrypt } from "./poly1305.js";
import { randomBytes as randBytes } from "./randSource.js"; // 统一随机源

const KEM_ID = 32, KDF_ID = 1, AEAD_ID = 3;
const NK = 32, NN = 12, NT = 16; // ChaCha20-Poly1305 参数（RFC 9180 §7.3）

// suite_id（RFC 9180 §4）
const KEM_SUITE = strBytes("KEM").concat(i2osp(KEM_ID, 2));
const HPKE_SUITE = strBytes("HPKE").concat(i2osp(KEM_ID, 2), i2osp(KDF_ID, 2), i2osp(AEAD_ID, 2));

function strBytes(s) { return Array.from(new TextEncoder().encode(s)); }
function i2osp(v, len) { const o = new Array(len).fill(0); let x = v; for (let i = len - 1; i >= 0; i--) { o[i] = x & 0xff; x >>>= 8; } return Array.from(o); }
function cat(...arrs) { const out = []; for (const a of arrs) for (const b of a) out.push(b); return Uint8Array.from(out); }
function hexToBytes(hex, label) {
  const s = String(hex == null ? "" : hex).trim().replace(/\s+/g, "");
  if (s.length % 2 || /[^0-9a-fA-F]/.test(s)) throw new Error(`${label} 非法：须为偶数个 hex 字符`);
  return Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.substr(i * 2, 2), 16));
}
function optHex(v, label) {
  const s = String(v == null ? "" : v).trim();
  return s ? hexToBytes(s, label) : new Uint8Array(0);
}
function bytesToHex(b) { return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join(""); }

// ---- 字节级 HKDF-SHA256（RFC 5869） ----
async function hmacSha256(key, data) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
async function hkdfExtract(salt, ikm) {
  return hmacSha256(salt.length ? salt : new Uint8Array(32), ikm); // 空盐 = 32 字节 0
}
async function hkdfExpand(prk, info, len) {
  const out = new Uint8Array(len);
  const infoB = info instanceof Uint8Array ? info : new Uint8Array(info);
  let t = new Uint8Array(0);
  let o = 0, counter = 1;
  while (o < len) {
    t = await hmacSha256(prk, cat(Array.from(t), Array.from(infoB), [counter]));
    const take = Math.min(t.length, len - o);
    out.set(t.subarray(0, take), o);
    o += take;
    counter++;
  }
  return out;
}

// ---- RFC 9180 §4 LabeledExtract / LabeledExpand ----
// suite_id 前缀按调用域区分：KEM 域用 "KEM"||kem_id，KeySchedule 域用 "HPKE"||三 id（§4/§5.1）
async function labeledExtractKem(salt, label, ikm) {
  return hkdfExtract(salt, cat(strBytes("HPKE-v1"), KEM_SUITE, strBytes(label), ikm));
}
async function labeledExpandKem(prk, label, info, len) {
  return hkdfExpand(prk, cat(i2osp(len, 2), strBytes("HPKE-v1"), KEM_SUITE, strBytes(label), info), len);
}
async function labeledExtractKdf(salt, label, ikm) {
  return hkdfExtract(salt, cat(strBytes("HPKE-v1"), HPKE_SUITE, strBytes(label), ikm));
}
async function labeledExpandKdf(prk, label, info, len) {
  return hkdfExpand(prk, cat(i2osp(len, 2), strBytes("HPKE-v1"), HPKE_SUITE, strBytes(label), info), len);
}

// ---- DHKEM(X25519, HKDF-SHA256) §4.1 ----
function need32(b, label) {
  if (b.length !== 32) throw new Error(`${label} 必须为 32 字节（64 hex 字符），当前 ${b.length} 字节`);
  return b;
}
// ExtractAndExpand(dh, kem_context)：
//   eae_prk       = LabeledExtract("", "eae_prk", dh)                    （KEM 域）
//   shared_secret = LabeledExpand(eae_prk, "shared_secret", kem_context, 32)
async function encapShared(dh, kemContext) {
  const eaePrk = await labeledExtractKem(new Uint8Array(0), "eae_prk", dh);
  return labeledExpandKem(eaePrk, "shared_secret", kemContext, 32);
}

/** Encap（§4.1，导出供验证/复用）：临时私钥 + 收方公钥 → { pkE, sharedSecret }。 */
export async function hpkeEncap(skE, pkR) {
  const pkE = scalarBase(skE);
  const sharedSecret = await encapShared(x25519(skE, pkR), cat(Array.from(pkE), Array.from(pkR)));
  return { pkE, sharedSecret };
}

/** Decap（§4.1）：收方私钥 + enc → sharedSecret。 */
export async function hpkeDecap(skR, enc) {
  return encapShared(x25519(skR, enc), cat(Array.from(enc), Array.from(scalarBase(skR))));
}

/** KeySchedule<ROLE> base mode（§5.1，mode=0，无 PSK）。 */
export async function hpkeKeySchedule(sharedSecret, info) {
  return keyScheduleBase(sharedSecret, info);
}

// ---- KeyScheduleBase §5.1（mode = 0） ----
async function keyScheduleBase(sharedSecret, info) {
  const pskIdHash = await labeledExtractKdf(new Uint8Array(0), "psk_id_hash", new Uint8Array(0));
  const infoHash = await labeledExtractKdf(new Uint8Array(0), "info_hash", info);
  const ksContext = cat([0], Array.from(pskIdHash), Array.from(infoHash));
  const secret = await labeledExtractKdf(sharedSecret, "secret", new Uint8Array(0)); // base：psk = 0 字节
  const key = await labeledExpandKdf(secret, "key", ksContext, NK);
  const baseNonce = await labeledExpandKdf(secret, "base_nonce", ksContext, NN);
  const exporterSecret = await labeledExpandKdf(secret, "exp", ksContext, 32);
  return { ksContext, secret, key, baseNonce, exporterSecret };
}

function tryUtf8(b) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(b); } catch { return null; }
}

const COMMON_PARAMS = [
  { key: "info", label: "info（hex，可选）", type: "text", default: "", placeholder: "共享上下文绑定，hex；留空为空串" },
  { key: "aad", label: "AAD（hex，可选）", type: "text", default: "", placeholder: "认证关联数据，hex；留空为空串" },
];

register({
  id: "hpkeSeal",
  cat: "asym",
  family: "hpke",
  familyLabel: "seal",
  name: "HPKE 加密（Base）",
  desc: "RFC 9180 HPKE Base Mode 加密，固定套件 DHKEM(X25519,HKDF-SHA256) + HKDF-SHA256 + ChaCha20-Poly1305（附录 A.2 向量套件）。输入明文 + 收方 X25519 公钥（32B hex），输出 enc(临时公钥) 与密文。临时私钥留空取随机（增强随机性开关生效）；显式给定则与 RFC 向量逐字节复现",
  params: [
    ...COMMON_PARAMS,
    { key: "pkR", label: "收方公钥 pkR（32B hex）", type: "text", default: "", placeholder: "64 hex 字符（X25519 密钥生成档产出）" },
    { key: "skE", label: "临时私钥 skE（可选 32B hex）", type: "text", default: "", placeholder: "留空随机；给定则密文可复现（对拍向量用）" },
  ],
  run: async (text, p) => {
    const pt = typeof text === "string" ? new TextEncoder().encode(text) : new Uint8Array(text || []);
    if (pt.length === 0) throw new Error("明文为空：请输入要加密的文本");
    const pkR = need32(hexToBytes((p && p.pkR) || "", "收方公钥 pkR"), "收方公钥 pkR");
    const skERaw = (p && p.skE && String(p.skE).trim());
    const skE = skERaw ? need32(hexToBytes(skERaw, "临时私钥 skE"), "临时私钥 skE") : randBytes(32);
    const info = optHex(p && p.info, "info");
    const aad = optHex(p && p.aad, "AAD");
    const pkE = scalarBase(skE);
    const { sharedSecret } = await hpkeEncap(skE, pkR);
    const { key, baseNonce } = await keyScheduleBase(sharedSecret, info);
    const sealed = chacha20Poly1305Encrypt(key, baseNonce, pt, aad); // { ciphertext, tag } per RFC 8439
    const ct = cat(Array.from(sealed.ciphertext), Array.from(sealed.tag));
    return [
      "=== HPKE 加密（Base Mode）===",
      "套件：DHKEM(X25519, HKDF-SHA256) / HKDF-SHA256 / ChaCha20-Poly1305（RFC 9180）",
      `收方公钥 pkR = ${bytesToHex(pkR)}`,
      `临时私钥 skE（${skERaw ? "给定" : "随机"}）= ${bytesToHex(skE)}`,
      `临时公钥 pkE = ${bytesToHex(pkE)}`,
      "",
      `enc（${pkE.length} 字节）= ${bytesToHex(pkE)}`,
      `密文 ct（${ct.length} 字节 = 明文 ${pt.length} + tag 16）= ${bytesToHex(ct)}`,
      "",
      "说明：把 enc 与 ct 交给收方（连同 info/aad），用「HPKE 解密」+ 收方私钥恢复明文。",
    ].join("\n");
  },
});

register({
  id: "hpkeOpen",
  cat: "asym",
  family: "hpke",
  familyLabel: "open",
  name: "HPKE 解密（Base）",
  desc: "RFC 9180 HPKE Base Mode 解密（同套件 DHKEM(X25519)+HKDF-SHA256+ChaCha20-Poly1305）。输入 enc + 密文 + 收方 X25519 私钥（info/aad 须与加密一致），恢复明文；tag 校验失败明确报错",
  params: [
    ...COMMON_PARAMS,
    { key: "enc", label: "enc（发送方临时公钥 32B hex）", type: "text", default: "", placeholder: "64 hex 字符" },
    { key: "ct", label: "密文 ct（hex，含尾 16 字节 tag）", type: "text", default: "", placeholder: "hex" },
    { key: "skR", label: "收方私钥 skR（32B hex）", type: "text", default: "", placeholder: "64 hex 字符" },
  ],
  run: async (_text, p) => {
    const enc = need32(hexToBytes((p && p.enc) || "", "enc"), "enc");
    const skR = need32(hexToBytes((p && p.skR) || "", "收方私钥 skR"), "收方私钥 skR");
    const ctAll = hexToBytes((p && p.ct) || "", "密文 ct");
    if (ctAll.length < NT) throw new Error(`密文过短：至少 ${NT} 字节（tag），当前 ${ctAll.length} 字节`);
    const info = optHex(p && p.info, "info");
    const aad = optHex(p && p.aad, "AAD");
    // Decap：dh = X25519(skR, enc)；kem_context = enc‖pkR（§4.1 同构）
    const sharedSecret = await hpkeDecap(skR, enc);
    const { key, baseNonce } = await keyScheduleBase(sharedSecret, info);
    const ct = ctAll.subarray(0, ctAll.length - NT);
    const tag = ctAll.subarray(ctAll.length - NT);
    const opened = chacha20Poly1305Decrypt(key, baseNonce, ct, tag, aad);
    if (!opened.ok) throw new Error("HPKE 解密失败：AEAD tag 校验不通过（skR/enc/info/aad 与加密侧不一致，或密文被篡改）");
    const pt = opened.plaintext;
    const utf8 = tryUtf8(pt);
    const lines = [
      "=== HPKE 解密（Base Mode）===",
      `明文（${pt.length} 字节 hex）= ${bytesToHex(pt)}`,
    ];
    if (utf8 != null) lines.push(`明文（UTF-8）= ${utf8}`);
    lines.push("", "说明：info/aad 与加密侧不一致时 AEAD tag 校验失败并报错（认证加密语义）。");
    return lines.join("\n");
  },
});
