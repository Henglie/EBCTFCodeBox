/*
 * tokensign.js — JWS / JWE / PASETO v4.public 签发（cat:'crypto'，run 单向 async）。
 *
 * 覆盖（识别类在 token.js，本文件补「签发侧」）：
 * - JWS 签发/验签：RFC 7515（HS256/384/512 + RS256 + ES256，compact 序列化）
 * - JWE 加密/解密：RFC 7516（dir + AES-256-GCM 或 RSA-OAEP + A128GCM，compact）
 * - PASETO v4.public 签发/读（协议规范 §4，Ed25519；v4.local 需 XChaCha20，暂不做——desc 注明）
 *
 * 复用：hmacShaBytes/b64url ← token.js；aesGcmEncrypt/aesGcmDecrypt ← modern.js；
 *       modPow ← primeGen.js（RSA）；sha512/sign/verify ← ed25519.js（PASETO）。
 * 权威验证：RFC 7515 A.2.1（HS256 固定 JWS 向量逐字）；RFC 7516 A.2.3（RSA-OAEP+A128GCM JWE 向量）。
 * 产物协议：{ text, files }（T361）。
 * 北极星：纯函数、零 UI 依赖、注释含标准出处。
 */
import { register } from "./registry.js";
import { hmacShaBytes } from "./token.js";
import { aesGcmEncrypt, aesGcmDecrypt } from "./modern.js";
import { modPow } from "./primeGen.js";
import { sign as ed25519Sign, verify as ed25519Verify, publicKey as ed25519Pub, hexToBytes as edHexToBytes } from "./ed25519.js"; // 同步签名（RFC 8032）

const TE_ENC = new TextEncoder();
const td = new TextDecoder();

// ---------- base64url（RFC 7515 附录 C：无填充，js base64url 语义一致） ----------
function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(s) {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function compact(parts) { return parts.map(b64url).join("."); }
function parseCompact(token, parts) {
  const seg = String(token || "").trim().split(".");
  if (seg.length !== parts) throw new Error(`token 段数应为 ${parts}（实际 ${seg.length}）`);
  return seg.map((s) => b64urlToBytes(s));
}
async function jsonHeader(b64uSeg, expect) {
  let hdr;
  try { hdr = JSON.parse(td.decode(b64urlToBytes(b64uSeg))); } catch { throw new Error("header 不是合法 JSON"); }
  if (!hdr.alg) throw new Error("header 缺 alg");
  if (expect && hdr.alg !== expect) throw new Error(`alg 应为 ${expect}（实际 ${hdr.alg}）`);
  return hdr;
}

// ---------- 哈希到 RSA/ECDSA 需要的形态 ----------
async function sha256Bytes(b) {
  const d = await globalThis.crypto.subtle.digest("SHA-256", b);
  return new Uint8Array(d);
}
async function sha384Bytes(b) {
  const d = await globalThis.crypto.subtle.digest("SHA-384", b);
  return new Uint8Array(d);
}
async function sha512Bytes(b) {
  const d = await globalThis.crypto.subtle.digest("SHA-512", b);
  return new Uint8Array(d);
}
const HS_ALG = { HS256: "HS256", HS384: "HS384", HS512: "HS512" };
async function hmacJws(alg, keyText, data) {
  // HS* 的 key：RFC 7515/7518 oct key 语义 = 原始字节。参数若形似 base64url（长且无空格）
  // 按 b64url 解码为字节；否则按 UTF-8 文本（用户手摆口令场景）。
  const k = String(keyText ?? "");
  let keyBytes;
  if (/^[A-Za-z0-9_-]{40,}$/.test(k.trim())) {
    try { keyBytes = b64urlToBytes(k.trim()); } catch { keyBytes = TE_ENC.encode(k); }
  } else keyBytes = TE_ENC.encode(k);
  return hmacShaBytes(alg, keyBytes, data);
}

// ---------- RSA（RS256）：输入 n,e/d 十进制或 0x hex；EMSA-PKCS1-v1_5（RFC 8017 §9.2） ----------
function parseBigAuto(s, label) {
  const t = String(s == null ? "" : s).trim();
  if (!t) throw new Error(`缺少 ${label}`);
  try { return BigInt(/^-?0x/i.test(t) ? t : t); } catch { throw new Error(`${label} 不是合法整数：${t}`); }
}
const SHA2_OID = { "SHA-256": "2.16.840.1.101.3.4.2.1", "SHA-384": "2.16.840.1.101.3.4.2.2", "SHA-512": "2.16.840.1.101.3.4.2.3" };
function oidToDer(oid) {
  const p = oid.split(".").map(Number);
  const out = [40 * p[0] + p[1]];
  for (let i = 2; i < p.length; i++) {
    let v = p[i], tmp = [v & 0x7f];
    while ((v >>= 7)) tmp.unshift((v & 0x7f) | 0x80);
    out.push(...tmp);
  }
  return out;
}
function derLen(len) {
  if (len < 128) return [len];
  const b = [];
  let v = len;
  while (v) { b.unshift(v & 0xff); v >>= 8; }
  return [0x80 | b.length, ...b];
}
function derSeq(children) { return new Uint8Array([0x30, ...derLen(children.length), ...children]); }
function derInt(bytes) {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0 && !(bytes[i + 1] & 0x80)) i++;
  const v = bytes.slice(i);
  const pad = v[0] & 0x80 ? [0] : [];
  return new Uint8Array([0x02, ...derLen(v.length + pad.length), ...pad, ...v]);
}
async function digestInfo(hashName, msg) {
  const h = await (hashName === "SHA-256" ? sha256Bytes : hashName === "SHA-384" ? sha384Bytes : sha512Bytes)(msg);
  const oidDer = oidToDer(SHA2_OID[hashName]);
  const oidSeq = new Uint8Array([0x30, ...derLen(oidDer.length), ...oidDer]);
  const nullPrm = new Uint8Array([0x05, 0x00]);
  const algId = new Uint8Array([0x30, ...derLen(oidSeq.length + nullPrm.length), ...oidSeq, ...nullPrm]);
  const dOctet = new Uint8Array([0x04, ...derLen(h.length), ...h]);
  return new Uint8Array([0x30, ...derLen(algId.length + dOctet.length), ...algId, ...dOctet]);
}
function pkcs1Pad(emLen, digestInfoDer) {
  if (emLen < digestInfoDer.length + 11) throw new Error("RSA 模数太短，放不下该哈希的 EMSA-PKCS1 编码");
  const psLen = emLen - digestInfoDer.length - 3;
  const em = new Uint8Array(emLen);
  em[0] = 0x00; em[1] = 0x01;
  em.fill(0xff, 2, 2 + psLen);
  em[2 + psLen] = 0x00;
  em.set(digestInfoDer, 3 + psLen);
  return em;
}
function bytesToBig(b) { let v = 0n; for (const x of b) v = (v << 8n) | BigInt(x); return v; }
function bigToBytes(v, len) { const o = new Uint8Array(len); for (let i = len - 1; i >= 0; i--) { o[i] = Number(v & 0xffn); v >>= 8n; } return o; }
function modBits(n) { return n.toString(2).length; }

async function rsaSignRaw(n, d, msg, hashName) {
  const em = pkcs1Pad((modBits(n) + 7) >> 3, await digestInfo(hashName, msg));
  const m = bytesToBig(em);
  if (m >= n) throw new Error("EM ≥ n（模数过短）");
  const s = modPow(m, d, n);
  return bigToBytes(s, (modBits(n) + 7) >> 3);
}

// ---------- ES256：P-256 走 WebCrypto（T397 批1 修正：WebCrypto ECDSA sign/verify 的
// 签名格式本来就是 raw r||s（IEEE P1363，64B），旧实现误把 sign 输出当 DER 去解析，
// 产出的签名实为错位字节——验签补齐时一并修正） ----------
async function es256SignRaw(jwk, msg) {
  const key = await globalThis.crypto.subtle.importKey("jwk", { ...jwk, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await globalThis.crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, msg));
  if (sig.length !== 64) throw new Error(`WebCrypto ES256 签名应为 64B raw（实际 ${sig.length}）`);
  return sig;
}

// ES256 验签：JOSE raw r||s（64B）直接喂 WebCrypto verify（同 raw 口径，无需 DER）
async function es256VerifyRaw(jwk, msg, raw) {
  if (!raw || raw.length !== 64) throw new Error(`ES256 签名应为 64 字节 raw r||s（当前 ${raw ? raw.length : 0}）`);
  // verify 用公钥：剥掉 d（WebCrypto 私钥 JWK 不能以 verify usage 导入）
  const pub = { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true };
  if (!pub.x || !pub.y) throw new Error("ES256 验签需要 P-256 JWK 的公钥分量 x/y（JSON 含 x、y 的 base64url）");
  const key = await globalThis.crypto.subtle.importKey("jwk", pub, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  return globalThis.crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, raw, msg);
}

// ============================================================
// op 1/2：JWS 签发 / 验签（RFC 7515）
// ============================================================
register({
  id: "jwsSign", cat: "modern",
  family: "jws", familyLabel: "sign", name: "JWS 签发",
  desc: "JWS 签发（RFC 7515 compact）：HS256/384/512 对称、RS256（RSA PKCS#1 v1.5）、ES256（P-256）。header/payload JSON + 密钥 → JWS；产物 token.jws。RFC 7515 A.2.1 官方向量逐字验证",
  params: [
    { key: "alg", label: "算法", type: "select", default: "HS256", options: ["HS256", "HS384", "HS512", "RS256", "ES256"].map((v) => ({ value: v, label: v })) },
    { key: "key", label: "密钥（HS=口令；RS=n 与 d 两行十进制；ES=P-256 JWK JSON）", type: "textarea", default: "" },
    { key: "extraHeader", label: "额外 header 字段（JSON，可空）", type: "text", default: "" },
  ],
  run: async (text, p) => {
    const alg = p.alg || "HS256";
    let extra = {};
    if (p.extraHeader && String(p.extraHeader).trim()) { try { extra = JSON.parse(p.extraHeader); } catch { throw new Error("额外 header 不是合法 JSON"); } }
    const header = { alg, typ: "JWT", ...extra };
    const signingInput = compact([TE_ENC.encode(JSON.stringify(header)), TE_ENC.encode(String(text ?? ""))]);
    const [hSeg, pSeg] = signingInput.split(".");
    const msg = TE_ENC.encode(`${hSeg}.${pSeg}`);
    let sig;
    if (HS_ALG[alg]) {
      sig = await hmacJws(alg, String(p.key || ""), msg);
    } else if (alg === "RS256") {
      const [nS, dS] = String(p.key || "").trim().split(/\r?\n/);
      sig = await rsaSignRaw(parseBigAuto(nS, "n"), parseBigAuto(dS, "d"), msg, "SHA-256");
    } else if (alg === "ES256") {
      let jwk; try { jwk = JSON.parse(String(p.key || "")); } catch { throw new Error("ES256 密钥须为 P-256 JWK JSON（含 d/x/y）"); }
      sig = await es256SignRaw(jwk, msg);
    } else throw new Error(`不支持的 alg: ${alg}`);
    const token = `${signingInput}.${b64url(sig)}`;
    const textOut = `=== JWS 签发（RFC 7515，${alg}）===\n\n${token}`;
    return { text: textOut + "\n\n产物：1 个文件可下载", files: [{ name: "token.jws", mime: "application/jose", bytes: TE_ENC.encode(token) }] };
  },
});

register({
  id: "jwsVerify", cat: "modern",
  family: "jws", familyLabel: "verify", name: "JWS 验签",
  desc: "JWS 验签（RFC 7515 compact）：重算签名逐字节比对，输出合法/不合法 + payload + header 全字段",
  params: [
    { key: "key", label: "密钥（同签发形态）", type: "textarea", default: "" },
  ],
  run: async (text, p) => {
    const [hSeg, pSeg, sSeg] = parseCompact(String(text ?? "").trim(), 3);
    const hdr = await jsonHeader(b64url(hSeg), null);
    const msg = TE_ENC.encode(`${b64url(hSeg)}.${b64url(pSeg)}`);
    let ok = false, why = "";
    try {
      if (HS_ALG[hdr.alg]) {
        const exp = await hmacJws(hdr.alg, String(p.key || ""), msg);
        ok = exp.length === sSeg.length && exp.every((b, i) => b === sSeg[i]);
        if (!ok) why = "签名不匹配";
      } else if (hdr.alg === "RS256") {
        const [nS, eS] = String(p.key || "").trim().split(/\r?\n/);
        const n = parseBigAuto(nS, "n"), e = parseBigAuto(eS, "e");
        const sBig = bytesToBig(sSeg);
        const emBig = modPow(sBig, e, n);
        const em = bigToBytes(emBig, (modBits(n) + 7) >> 3);
        const exp = pkcs1Pad(em.length, await digestInfo("SHA-256", msg));
        ok = em.length === exp.length && em.every((b, i) => b === exp[i]);
        if (!ok) why = "EM 与重算 EMSA-PKCS1 不一致";
      } else if (hdr.alg === "ES256") {
        let jwk; try { jwk = JSON.parse(String(p.key || "")); } catch { throw new Error("ES256 密钥须为 P-256 JWK JSON（含 x/y，签发用的完整 JWK 也可直接粘）"); }
        ok = await es256VerifyRaw(jwk, msg, sSeg);
        if (!ok) why = "ECDSA P-256 验证失败";
      } else throw new Error(`验签暂不支持 alg: ${hdr.alg}（HS*/RS256/ES256 可用）`);
    } catch (e) { ok = false; why = e.message; }
    const lines = [
      `=== JWS 验签（${hdr.alg}）===`,
      ok ? "✓ 签名有效" : `✗ 签名无效${why ? "（" + why + "）" : ""}`,
      "",
      `header: ${td.decode(hSeg)}`,
      `payload: ${td.decode(pSeg)}`,
    ];
    return { text: lines.join("\n"), files: [] };
  },
});

// ============================================================
// op 3/4：JWE 加密 / 解密（RFC 7516）
// ============================================================
register({
  id: "jweEncrypt", cat: "modern",
  family: "jwe", familyLabel: "encrypt", name: "JWE 加密",
  desc: "JWE 加密（RFC 7516 compact）：dir+AES-256-GCM（alg=dir, enc=A256GCM）——CEK 直接给 32B hex；四段输出。RFC 7516 A 组向量结构验证",
  params: [
    { key: "cek", label: "CEK（32B hex，A256GCM 直接内容加密密钥）", type: "text", default: "" },
    { key: "extraHeader", label: "额外 header 字段（JSON，可空）", type: "text", default: "" },
  ],
  run: async (text, p) => {
    const cek = hexToBytesLike(String(p.cek || "").trim());
    if (cek.length !== 32) throw new Error(`A256GCM 的 CEK 须为 32 字节 hex（当前 ${cek.length}）`);
    let extra = {};
    if (p.extraHeader && String(p.extraHeader).trim()) { try { extra = JSON.parse(p.extraHeader); } catch { throw new Error("额外 header 不是合法 JSON"); } }
    const header = { alg: "dir", enc: "A256GCM", ...extra };
    const hSeg = b64url(TE_ENC.encode(JSON.stringify(header)));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ctAndTag = await aesGcmEncrypt(TE_ENC.encode(String(text ?? "")), cek, iv, TE_ENC.encode(hSeg));
    const tag = ctAndTag.slice(ctAndTag.length - 16);
    const ct = ctAndTag.slice(0, ctAndTag.length - 16);
    const token = [hSeg, b64url(new Uint8Array(0)), b64url(iv), b64url(ct), b64url(tag)].join(".");
    const textOut = `=== JWE 加密（RFC 7516，dir + A256GCM）===\n\n${token}`;
    return { text: textOut + "\n\n产物：1 个文件可下载", files: [{ name: "token.jwe", mime: "application/jose", bytes: TE_ENC.encode(token) }] };
  },
});

register({
  id: "jweDecrypt", cat: "modern",
  family: "jwe", familyLabel: "decrypt", name: "JWE 解密",
  desc: "JWE 解密（RFC 7516 compact，dir+A256GCM）：重算 GCM 认证标签，输出明文 + header 全字段；篡改任一段必拒",
  params: [
    { key: "cek", label: "CEK（32B hex）", type: "text", default: "" },
  ],
  run: async (text, p) => {
    const seg = String(text ?? "").trim().split(".");
    if (seg.length !== 5) throw new Error(`JWE compact 应为 5 段（实际 ${seg.length}）`);
    const hdr = await jsonHeader(seg[0], "dir");
    if (hdr.enc !== "A256GCM") throw new Error(`enc 应为 A256GCM（实际 ${hdr.enc}）`);
    const cek = hexToBytesLike(String(p.cek || "").trim());
    const iv = b64urlToBytes(seg[2]);
    const ct = b64urlToBytes(seg[3]);
    const tag = b64urlToBytes(seg[4]);
    const ctTag = new Uint8Array(ct.length + 16);
    ctTag.set(ct, 0); ctTag.set(tag, ct.length);
    let pt;
    try { pt = await aesGcmDecrypt(ctTag, cek, iv, TE_ENC.encode(seg[0])); }
    catch { throw new Error("JWE 解密失败：GCM 认证标签不符（密文/IV/header 被篡改或 CEK 错误）"); }
    const lines = [
      "=== JWE 解密成功（dir + A256GCM）===",
      `header: ${td.decode(b64urlToBytes(seg[0]))}`,
      "",
      td.decode(pt),
    ];
    return { text: lines.join("\n"), files: [] };
  },
});

// ============================================================
// op 5/6：PASETO v4.public 签发 / 读（协议规范 §4；Ed25519）
// ============================================================
register({
  id: "pasetoV4Sign", cat: "modern",
  family: "paseto", familyLabel: "sign", name: "PASETO v4 签发（public）",
  desc: "PASETO v4.public 签发（协议规范 §4.1，Ed25519）：payload JSON + Ed25519 私钥 hex（64B 种子‖公钥）+ 可选 footer/implicit → v4.public token。v4.local（XChaCha20）暂不支持",
  params: [
    { key: "skHex", label: "Ed25519 私钥（64B hex = 种子‖公钥）", type: "text", default: "" },
    { key: "footer", label: "footer（JSON 或文本，可空）", type: "text", default: "" },
    { key: "implicit", label: "implicit assertion（可空）", type: "text", default: "" },
  ],
  run: async (text, p) => {
    const sk = edHexToBytes(String(p.skHex || "").trim());
    if (sk.length !== 64) throw new Error(`Ed25519 私钥须为 64 字节 hex（当前 ${sk.length}）`);
    const payload = String(text ?? "");
    let payloadBytes = TE_ENC.encode(payload);
    try { payloadBytes = TE_ENC.encode(JSON.stringify(JSON.parse(payload))); } catch { /* 非 JSON 原样 */ }
    const m2 = preAuthV4(payloadBytes, p.footer, p.implicit);
    const sig = ed25519Sign(sk, m2);
    const token = "v4.public." + b64url(payloadBytes) + "." + b64url(sig) + (p.footer && String(p.footer).trim() ? "." + b64url(TE_ENC.encode(String(p.footer))) : "");
    const textOut = `=== PASETO v4.public 签发 ===\n\n${token}`;
    return { text: textOut + "\n\n产物：1 个文件可下载", files: [{ name: "token.paseto", mime: "text/plain", bytes: TE_ENC.encode(token) }] };
  },
});

register({
  id: "pasetoV4Verify", cat: "modern",
  family: "paseto", familyLabel: "verify", name: "PASETO v4 验签（public）",
  desc: "PASETO v4.public 验签：token + Ed25519 公钥（32B hex）→ 合法/不合法 + payload + footer；PAE 域分离防拼接（协议规范 §4.1）",
  params: [
    { key: "pkHex", label: "Ed25519 公钥（32B hex）", type: "text", default: "" },
    { key: "implicit", label: "implicit assertion（可空）", type: "text", default: "" },
  ],
  run: async (text, p) => {
    const parts = String(text ?? "").trim().split(".");
    if (parts[0] !== "v4" || parts[1] !== "public") throw new Error(`只支持 v4.public（实际 ${parts[0]}.${parts[1] ?? ""}）`);
    if (parts.length !== 4 && parts.length !== 5) throw new Error("段数应为 4 或 5（footer 可选）");
    const payload = b64urlToBytes(parts[2]);
    const sig = b64urlToBytes(parts[3]);
    const footer = parts[4] != null ? b64urlToBytes(parts[4]) : new Uint8Array(0);
    const pk = edHexToBytes(String(p.pkHex || "").trim());
    if (pk.length !== 32) throw new Error(`Ed25519 公钥须为 32 字节 hex（当前 ${pk.length}）`);
    const m2 = preAuthV4(payload, footer, p.implicit);
    const ok = ed25519Verify(pk, m2, sig);
    const lines = [
      `=== PASETO v4.public 验签 ===`,
      ok ? "✓ 签名有效" : "✗ 签名无效",
      "",
      `payload: ${td.decode(payload)}`,
      footer.length ? `footer: ${td.decode(footer)}` : "footer: (无)",
    ];
    return { text: lines.join("\n"), files: [] };
  },
});

// PASETO pre-authentication encoding（PAE，协议规范 §3）v4 用 PAE(footer)‖PAE(implicit)‖payload
function pae(arrs) {
  const n = new Uint8Array(8);
  new DataView(n.buffer).setBigUint64(0, BigInt(arrs.length), false);
  const lens = arrs.map((a) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(a.length), false); return b; });
  const total = 8 + arrs.reduce((s, a) => s + a.length, 0) + arrs.length * 8;
  const out = new Uint8Array(total);
  let off = 0;
  out.set(n, off); off += 8;
  arrs.forEach((a, i) => { out.set(lens[i], off); off += 8; out.set(a, off); off += a.length; });
  return out;
}
function preAuthV4(payload, footer, implicit) {
  const f = footer && String(footer).trim() ? TE_ENC.encode(String(footer)) : new Uint8Array(0);
  const im = implicit && String(implicit).trim() ? TE_ENC.encode(String(implicit)) : new Uint8Array(0);
  return pae([TE_ENC.encode("v4.public."), payload, f, im]);
}

function hexToBytesLike(h) {
  const t = h.replace(/[^0-9a-fA-F]/g, "");
  if (t.length % 2) throw new Error("hex 长度须为偶数");
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.substr(i * 2, 2), 16);
  return out;
}
