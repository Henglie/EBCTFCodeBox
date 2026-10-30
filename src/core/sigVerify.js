/*
 * sigVerify.js — 统一验签入口（自动分诊 JWT/JWS、PGP、X.509、CMS、SSHSIG）。
 *
 * 设计原则：
 *   - 只做「识别 + 路由 + 统一报告」，不重复实现底层验签；
 *   - JWT/JWS → 现有 jwtVerify op；PGP → 现有 pgpVerify/pgpParseKey；
 *     X.509 → 已接线的 x509Verify op；CMS → cmsVerify 候选模块；
 *     SSHSIG → 可插拔 op（未接线时显式 BLOCKED，不伪造 PASS）；
 *   - 未知格式显式报错，不静默当成某一种协议；
 *   - 统一输出「协议 / 算法 / 签名者 / 有效期 / 结论 / 失败原因」，并附底层报告。
 *
 * 输入识别：
 *   - JWT/JWS：三段点分 base64url（header.payload.signature）；JWE 五段显式拒绝；
 *   - PGP：-----BEGIN PGP SIGNED MESSAGE / SIGNATURE / MESSAGE-----；
 *   - SSHSIG：-----BEGIN SSH SIGNATURE----- 或二进制 SSHSIG 魔数；
 *   - X.509：-----BEGIN CERTIFICATE----- 或 DER 证书；
 *   - CMS/PKCS#7：-----BEGIN CMS/PKCS7----- 或 DER ContentInfo signedData。
 *
 * 结论口径：
 *   PASS       底层验签通过且满足统一入口的信任/密钥条件；
 *   FAIL       底层验签失败或签名/内容被篡改；
 *   UNVERIFIED 已识别格式，但缺密钥、缺 detached 原文、缺信任锚或底层 op 不支持该档；
 *   BLOCKED    所需底层 op 尚未接线（当前仅 SSHSIG / 未接线的 X.509 链验签）。
 *
 * 纯本地、零外发；不取随机数。
 */
import { register, OPS } from "./registry.js";
import {
  loadCmsInput, parseCmsDer, verifyParsedCms, formatCmsReport,
  parseCertificateBundle, parseCertificateDer,
} from "./cmsVerify.js";
import { base64Decode, parseKeyText } from "./pemkeys.js";

const te = new TextEncoder();
const td = new TextDecoder("utf-8", { fatal: false });

// ============================================================
// 小工具
// ============================================================

function hexToBytes(text) {
  const t = String(text || "").replace(/^0x/i, "").replace(/[\s:]/g, "");
  if (!t) return new Uint8Array(0);
  if (!/^[0-9a-fA-F]+$/.test(t)) throw new Error("hex 输入含非十六进制字符");
  if (t.length % 2) throw new Error("hex 输入长度为奇数");
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.substr(i * 2, 2), 16);
  return out;
}

function decodeBinaryInput(text) {
  const s = String(text || "").trim();
  if (!s) throw new Error("输入为空");
  const compact = s.replace(/\s+/g, "");
  if (/^[0-9a-fA-F]+$/.test(compact) && compact.length % 2 === 0 && compact.length >= 16) {
    return hexToBytes(compact);
  }
  return base64Decode(s);
}

function decodeContentText(text, enc) {
  const raw = String(text == null ? "" : text);
  if (enc === "hex") return td.decode(hexToBytes(raw));
  if (enc === "base64") return td.decode(base64Decode(raw));
  return raw;
}

function decodeContentBytes(text, enc) {
  const raw = String(text == null ? "" : text);
  if (enc === "hex") return hexToBytes(raw);
  if (enc === "base64") return base64Decode(raw);
  return te.encode(raw);
}

function getOp(id) {
  const op = OPS.find((o) => o.id === id && !o.__stub);
  return op && typeof op.run === "function" ? op : null;
}

async function runOp(op, text, params) {
  const r = await op.run(text, params || {});
  if (r && typeof r === "object" && typeof r.text === "string") return r.text;
  return String(r == null ? "" : r);
}

function firstLineMatching(text, re) {
  for (const line of String(text || "").split(/\r?\n/)) {
    if (re.test(line)) return line.trim();
  }
  return "";
}

function certValidity(cert) {
  if (!cert) return "—";
  return `${cert.notBefore.text} ~ ${cert.notAfter.text}`;
}

function parseCertInput(input) {
  const s = String(input || "").trim();
  if (!s) return [];
  if (s.includes("-----BEGIN CERTIFICATE-----")) {
    const re = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g;
    const out = [];
    let m;
    while ((m = re.exec(s)) !== null) {
      const lines = m[1].split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const body = lines.filter((l) => !l.includes(":")).join("");
      out.push(parseCertificateDer(base64Decode(body)));
    }
    return out;
  }
  return [parseCertificateDer(decodeBinaryInput(s))];
}

// ============================================================
// 格式识别
// ============================================================

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;
const JWE_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export function detectSignatureFormat(text) {
  const s = String(text == null ? "" : text).trim();
  if (!s) throw new Error("输入为空：需要待验签的 JWT/JWS、PGP、SSHSIG、X.509 或 CMS");
  if (s.includes("-----BEGIN PGP PUBLIC KEY BLOCK-----") || s.includes("-----BEGIN PGP PRIVATE KEY BLOCK-----")) {
    throw new Error("这是 PGP 公钥/私钥块，不是待验签名；请把公钥放到 key 参数，签名文本放到输入");
  }
  if (s.includes("-----BEGIN PGP SIGNED MESSAGE-----") || s.includes("-----BEGIN PGP SIGNATURE-----") || s.includes("-----BEGIN PGP MESSAGE-----")) {
    return { protocol: "PGP", format: "OpenPGP armor" };
  }
  if (s.includes("-----BEGIN SSH SIGNATURE-----") || s.startsWith("SSHSIG")) {
    return { protocol: "SSHSIG", format: "OpenSSH SSHSIG" };
  }
  if (s.includes("-----BEGIN CMS-----") || s.includes("-----BEGIN PKCS7-----") || s.includes("-----BEGIN PKCS #7 SIGNED DATA-----")) {
    return { protocol: "CMS", format: "CMS/PKCS#7 SignedData" };
  }
  if (s.includes("-----BEGIN CERTIFICATE-----")) {
    return { protocol: "X.509", format: "X.509 证书（PEM）" };
  }
  if (JWT_RE.test(s)) {
    return { protocol: "JWT/JWS", format: "JOSE compact（三段点分）" };
  }
  if (JWE_RE.test(s)) {
    throw new Error("输入是 JWE（五段点分，加密令牌），本入口只做签名验证；请先解密");
  }

  let bytes = null;
  try {
    bytes = decodeBinaryInput(s);
  } catch {
    bytes = null;
  }
  if (bytes) {
    if (bytes.length >= 6 && td.decode(bytes.subarray(0, 6)) === "SSHSIG") {
      return { protocol: "SSHSIG", format: "OpenSSH SSHSIG（binary）" };
    }
    try {
      parseCmsDer(bytes);
      return { protocol: "CMS", format: "CMS/PKCS#7 SignedData（DER/BER）" };
    } catch { /* 继续尝试 X.509 */ }
    try {
      parseCertificateDer(bytes);
      return { protocol: "X.509", format: "X.509 证书（DER）" };
    } catch { /* 未知 */ }
  }
  throw new Error("无法识别签名格式：支持 JWT/JWS（三段点分）、PGP armor、SSHSIG armor、X.509 PEM/DER、CMS/pkcs7 DER");
}

// ============================================================
// JWT / JWS
// ============================================================

function decodeJwtJson(seg, what) {
  const bytes = base64Decode(seg);
  return JSON.parse(td.decode(bytes));
}

function bigintToFixedHex(v, bytes) {
  return v.toString(16).padStart(bytes * 2, "0");
}

function jwtAsymParams(alg, keyText) {
  if (!String(keyText || "").trim()) throw new Error("缺少 JWT 公钥参数 key（PEM 或 JWK）");
  const k = parseKeyText(keyText);
  if (alg === "RS256") {
    if (k.kty !== "RSA" || k.n == null || k.e == null) throw new Error(`RS256 需要 RSA 公钥（n/e），当前 kty=${k.kty}`);
    return { rsaN: k.n.toString(), rsaE: k.e.toString() };
  }
  if (alg === "ES256") {
    if (k.kty !== "EC" || k.curve.key !== "p256" || k.x == null || k.y == null) {
      throw new Error(`ES256 需要 P-256 EC 公钥（x/y），当前 kty=${k.kty}${k.curve ? " curve=" + k.curve.crv : ""}`);
    }
    return { ecPub: "04" + bigintToFixedHex(k.x, 32) + bigintToFixedHex(k.y, 32) };
  }
  throw new Error(`内部错误：jwtAsymParams 不处理 ${alg}`);
}

async function verifyJwt(text, p) {
  const token = String(text || "").trim();
  const parts = token.split(".");
  const out = {
    protocol: "JWT/JWS",
    format: "JOSE compact",
    algorithm: "未知",
    signer: "—",
    validity: "—",
    verdict: "FAIL",
    reason: "",
    warnings: [],
    detail: "",
    meta: null,
  };
  if (parts.length !== 3) {
    out.reason = `JWT/JWS 必须为三段点分，当前 ${parts.length} 段`;
    return out;
  }
  let header;
  try {
    header = decodeJwtJson(parts[0], "header");
  } catch (e) {
    out.reason = `JWT header 段解析失败：${e.message}`;
    return out;
  }
  let payload = null;
  let payloadJsonError = null;
  try {
    payload = decodeJwtJson(parts[1], "payload");
  } catch (e) {
    payloadJsonError = e.message;
  }
  const alg = String(header && header.alg || "");
  out.meta = { header, payload };
  out.algorithm = `${alg || "(缺 alg)"}（JWT/JWS）`;
  if (!alg) {
    out.reason = "JWT header 缺 alg";
    return out;
  }
  const signerParts = [];
  if (payload && payload.iss != null) signerParts.push(`iss=${payload.iss}`);
  if (payload && payload.sub != null) signerParts.push(`sub=${payload.sub}`);
  if (header.kid != null) signerParts.push(`kid=${header.kid}`);
  out.signer = signerParts.length ? signerParts.join("；") : "JWT（无 iss/sub/kid）";
  if (payload && payload.exp != null) {
    const expMs = Number(payload.exp) * 1000;
    out.validity = Number.isFinite(expMs) ? `exp=${new Date(expMs).toISOString()}` : `exp=${payload.exp}（非法）`;
  } else {
    out.validity = "无 exp 声明";
  }
  if (payload && (payload.exp != null || payload.nbf != null)) {
    out.warnings.push("现有 jwtVerify 只验签名，不校验 exp/nbf 时间声明");
  }
  if (alg === "none") {
    out.verdict = "FAIL";
    out.reason = "alg=none 无签名保护，统一入口拒绝（RFC 7519 §6 仅结构合法，不是验签通过）";
    return out;
  }
  const supported = new Set(["HS256", "HS384", "HS512", "RS256", "ES256"]);
  if (!supported.has(alg)) {
    out.verdict = "UNVERIFIED";
    out.reason = `现有 jwtVerify 不支持 alg=${alg}（支持 HS256/384/512、RS256、ES256）；未伪造 PASS`;
    return out;
  }
  if (payloadJsonError) {
    out.verdict = "UNVERIFIED";
    out.reason = `JWS 载荷不是 JSON（${payloadJsonError}）；现有 jwtVerify 只覆盖 JWT 声明集，通用 JWS 未接线`;
    return out;
  }
  const op = getOp("jwtVerify");
  if (!op) {
    out.verdict = "BLOCKED";
    out.reason = "jwtVerify op 未注册/未接线";
    return out;
  }
  const params = {};
  try {
    if (alg.startsWith("HS")) {
      const secret = String(p.secret == null ? "" : p.secret);
      if (!secret) {
        out.verdict = "UNVERIFIED";
        out.reason = `${alg} 需要 HMAC 密钥参数 secret`;
        return out;
      }
      params.secret = secret;
    } else {
      Object.assign(params, jwtAsymParams(alg, p.key));
    }
  } catch (e) {
    out.verdict = "UNVERIFIED";
    out.reason = `JWT 密钥不可用：${e.message}`;
    return out;
  }
  let sub;
  try {
    sub = await runOp(op, token, params);
  } catch (e) {
    out.verdict = "FAIL";
    out.reason = `jwtVerify 执行失败：${e.message}`;
    return out;
  }
  const ok = sub.includes("✓ 签名匹配") && !sub.includes("✗ 签名不匹配");
  out.verdict = ok ? "PASS" : "FAIL";
  out.reason = ok ? "JWT 三段结构与签名重算通过" : (firstLineMatching(sub, /✗/) || "JWT 签名校验失败");
  out.detail = sub;
  return out;
}

// ============================================================
// PGP
// ============================================================

async function pgpKeyInfo(pub) {
  const op = getOp("pgpParseKey");
  if (!op) return { algorithm: "OpenPGP", keyId: "", created: "" };
  try {
    const sub = await runOp(op, "", { armored: pub });
    const algLine = firstLineMatching(sub, /算法\s*:/);
    const keyIdLine = firstLineMatching(sub, /KeyID\s*:/);
    const createdLine = firstLineMatching(sub, /创建\s*:/);
    return {
      algorithm: algLine.replace(/^.*?算法\s*:\s*/, "").trim() || "OpenPGP",
      keyId: keyIdLine.replace(/^.*?KeyID\s*:\s*/, "").trim(),
      created: createdLine.replace(/^.*?创建\s*:\s*/, "").trim(),
      detail: sub,
    };
  } catch {
    return { algorithm: "OpenPGP", keyId: "", created: "" };
  }
}

async function verifyPgp(text, p) {
  const armor = String(text || "");
  const out = {
    protocol: "PGP",
    format: "OpenPGP armor",
    algorithm: "OpenPGP",
    signer: "—",
    validity: "—",
    verdict: "UNVERIFIED",
    reason: "",
    warnings: [],
    detail: "",
    meta: null,
  };
  const pub = String(p.pgpPubKey || (String(p.key || "").includes("-----BEGIN PGP PUBLIC KEY BLOCK-----") ? p.key : "")).trim();
  const isClear = armor.includes("-----BEGIN PGP SIGNED MESSAGE-----");
  const isDetached = !isClear && armor.includes("-----BEGIN PGP SIGNATURE-----");
  const isMessage = armor.includes("-----BEGIN PGP MESSAGE-----");
  if (!isClear && !isDetached && !isMessage) {
    out.reason = "未识别到 PGP cleartext / detached signature / message 块";
    return out;
  }
  if (!pub) {
    out.reason = "缺少 PGP 公钥（key 参数需为 -----BEGIN PGP PUBLIC KEY BLOCK-----）";
    return out;
  }
  const op = getOp("pgpVerify");
  if (!op) {
    out.verdict = "BLOCKED";
    out.reason = "pgpVerify op 未注册/未接线";
    return out;
  }
  let contentText = "";
  if (isDetached) {
    if (p.content == null || String(p.content) === "") {
      out.reason = "detached PGP 签名需要原文（content 参数）";
      return out;
    }
    contentText = decodeContentText(p.content, p.contentEnc || "text");
  }
  const info = await pgpKeyInfo(pub);
  out.algorithm = info.algorithm || "OpenPGP";
  out.signer = info.keyId ? `PGP KeyID ${info.keyId}` : "PGP 公钥";
  out.validity = info.created ? `密钥创建 ${info.created}` : "—";
  let sub;
  try {
    sub = await runOp(op, contentText, { signedOrSig: armor, pubKey: pub });
  } catch (e) {
    out.verdict = "FAIL";
    out.reason = `pgpVerify 执行失败：${e.message}`;
    out.detail = info.detail || "";
    return out;
  }
  const ok = sub.includes("✓ 签名有效") && !sub.includes("✗ 签名无效");
  out.verdict = ok ? "PASS" : "FAIL";
  out.reason = ok ? "OpenPGP 签名有效" : (firstLineMatching(sub, /✗/) || "OpenPGP 签名无效");
  const keyId = /KeyID\s+([0-9A-Fa-f]+)/.exec(sub);
  if (keyId) out.signer = `PGP KeyID ${keyId[1].toUpperCase()}`;
  out.detail = [sub, info.detail || ""].filter(Boolean).join("\n\n");
  return out;
}

// ============================================================
// X.509
// ============================================================

async function verifyX509Text(text, p) {
  const out = {
    protocol: "X.509",
    format: "X.509 证书链",
    algorithm: "—",
    signer: "—",
    validity: "—",
    verdict: "UNVERIFIED",
    reason: "",
    warnings: [],
    detail: "",
    meta: null,
  };
  let certs = [];
  try {
    certs = parseCertInput(text);
  } catch (e) {
    out.verdict = "FAIL";
    out.reason = `X.509 证书解析失败：${e.message}`;
    return out;
  }
  const leaf = certs[0];
  if (leaf) {
    out.algorithm = leaf.sigAlgLabel;
    out.signer = leaf.subject;
    out.validity = certValidity(leaf);
    out.meta = { certificates: certs.map((c) => ({ subject: c.subject, issuer: c.issuer, serial: c.serial.toString() })) };
  }
  const op = getOp("x509Verify");
  if (!op) {
    out.verdict = "BLOCKED";
    out.reason = "x509Verify op 未注册/未接线；已识别证书但无法做链验签，不伪造 PASS";
    return out;
  }
  let sub;
  try {
    sub = await runOp(op, text, { anchor: p.anchor, at: p.at, leaf: p.leaf || 0 });
  } catch (e) {
    out.verdict = "FAIL";
    out.reason = `x509Verify 执行失败：${e.message}`;
    return out;
  }
  const verdictMatch = /验签结论\s*[:：]\s*(PASS|FAIL)/.exec(sub);
  const trustMatch = /信任判定\s*[:：]\s*(ANCHORED|MISMATCH|UNTRUSTED)/.exec(sub);
  const chainVerdict = verdictMatch ? verdictMatch[1] : "FAIL";
  const trust = trustMatch ? trustMatch[1] : "UNTRUSTED";
  if (chainVerdict === "PASS" && trust === "ANCHORED") {
    out.verdict = "PASS";
    out.reason = "证书链逐级验签通过，且与自备信任锚匹配";
  } else if (chainVerdict === "PASS") {
    out.verdict = "UNVERIFIED";
    out.reason = "证书链内逐级验签通过，但未建立信任锚（UNTRUSTED）；请提供 anchor 证书或 SHA-256 指纹";
  } else {
    out.verdict = "FAIL";
    out.reason = firstLineMatching(sub, /\[[A-Z_]+\]/) || "X.509 证书链验签失败";
  }
  out.detail = sub;
  out.meta = { ...(out.meta || {}), trust, chainVerdict };
  return out;
}

// ============================================================
// CMS / PKCS#7
// ============================================================

async function verifyCmsText(text, p) {
  const out = {
    protocol: "CMS / PKCS#7 SignedData",
    format: "CMS SignedData",
    algorithm: "—",
    signer: "—",
    validity: "—",
    verdict: "FAIL",
    reason: "",
    warnings: [],
    detail: "",
    meta: null,
  };
  let loaded;
  let cms;
  try {
    loaded = loadCmsInput(text);
    cms = parseCmsDer(loaded.der);
  } catch (e) {
    out.reason = `CMS 解析失败：${e.message}`;
    return out;
  }
  const opts = { requireSignedAttrs: p.requireSignedAttrs !== false };
  if (!cms.attached) {
    if (p.content == null || String(p.content) === "") {
      out.verdict = "UNVERIFIED";
      out.reason = "detached CMS 需要原文（content 参数）";
      return out;
    }
    opts.detachedContent = decodeContentBytes(p.content, p.contentEnc || "text");
  }
  try {
    opts.extraCerts = parseCertificateBundle(p.certs);
  } catch (e) {
    out.verdict = "FAIL";
    out.reason = `补充证书解析失败：${e.message}`;
    return out;
  }
  let result;
  try {
    result = await verifyParsedCms(cms, opts);
  } catch (e) {
    out.reason = `CMS 验签执行失败：${e.message}`;
    return out;
  }
  const sigLabels = [...new Set(result.signers.map((s) => `${s.signatureAlgLabel} / ${s.digestLabel}`))];
  out.algorithm = sigLabels.join("；") || "—";
  out.signer = result.signers.map((s) => s.cert ? s.cert.subject : (s.sid.kind === "issuerSerial" ? `issuer=${s.sid.issuer}, serial=${s.sid.serial}` : `SKID=${s.sid.skidHex}`)).join("；");
  const firstCert = result.signers.find((s) => s.cert)?.cert;
  out.validity = certValidity(firstCert);
  out.verdict = result.ok ? "PASS" : "FAIL";
  out.reason = result.ok ? "CMS 签名、signedAttrs 绑定与证书公钥均通过" : result.signers.filter((s) => !s.ok).map((s) => `#${s.index} ${s.reason}`).join("；");
  out.warnings.push(...result.warnings);
  out.detail = formatCmsReport(result, loaded.srcKind);
  out.meta = {
    attached: cms.attached,
    contentLength: result.contentLength,
    signers: result.signers.length,
    passed: result.passed,
  };
  return out;
}

// ============================================================
// SSHSIG（可插拔）
// ============================================================

function sshSigOp() {
  for (const id of ["sshSigVerify", "sshsigVerify", "sshSignatureVerify"]) {
    const op = getOp(id);
    if (op) return op;
  }
  return null;
}

function sshKeyComment(keyText) {
  const line = String(keyText || "").split(/\r?\n/).map((l) => l.trim()).find((l) => /^(ssh-|ecdsa-|sk-)/.test(l));
  if (!line) return "";
  const parts = line.split(/\s+/);
  return parts.length >= 3 ? parts.slice(2).join(" ") : "";
}

async function verifySshSig(text, p) {
  const out = {
    protocol: "SSHSIG",
    format: "OpenSSH SSHSIG",
    algorithm: "OpenSSH SSHSIG",
    signer: sshKeyComment(p.key) || "SSHSIG 公钥",
    validity: "—",
    verdict: "BLOCKED",
    reason: "",
    warnings: [],
    detail: "",
    meta: null,
  };
  const op = sshSigOp();
  if (!op) {
    out.reason = "SSHSIG 验签 op 未接线（等待 OpenSSH SSHSIG 候选交付）；已识别格式但不伪造 PASS";
    out.detail = "可插拔接口：注册 op id 为 sshSigVerify / sshsigVerify / sshSignatureVerify，参数接受 key/pubKey 与 namespace。";
    return out;
  }
  let sub;
  try {
    sub = await runOp(op, text, { key: p.key, pubKey: p.key, namespace: p.namespace || "file", message: p.content, msgEnc: p.contentEnc || "text" });
  } catch (e) {
    out.verdict = "FAIL";
    out.reason = `SSHSIG 验签执行失败：${e.message}`;
    return out;
  }
  const ok = /(签名验证：通过|验签结论：PASS|(^|\n)\s*(PASS|有效|verified)\b)/i.test(sub)
    && !/(签名验证：失败|验签结论：FAIL|无效|invalid)/i.test(sub);
  out.verdict = ok ? "PASS" : "FAIL";
  out.reason = ok ? "SSHSIG 验签通过" : "SSHSIG 验签失败";
  out.detail = sub;
  return out;
}

// ============================================================
// 统一入口
// ============================================================

export async function sigVerify(text, p = {}) {
  const det = detectSignatureFormat(text);
  if (det.protocol === "JWT/JWS") return verifyJwt(text, p);
  if (det.protocol === "PGP") return verifyPgp(text, p);
  if (det.protocol === "X.509") return verifyX509Text(text, p);
  if (det.protocol === "CMS") return verifyCmsText(text, p);
  if (det.protocol === "SSHSIG") return verifySshSig(text, p);
  throw new Error(`内部错误：未处理协议 ${det.protocol}`);
}

export function formatUnifiedResult(r) {
  const L = [];
  L.push("=== 统一验签入口（自动分诊） ===");
  L.push(`协议        : ${r.protocol}（${r.format}）`);
  L.push(`算法        : ${r.algorithm}`);
  L.push(`签名者      : ${r.signer}`);
  L.push(`有效期      : ${r.validity}`);
  L.push(`结论        : ${r.verdict}`);
  L.push(`失败原因    : ${r.reason || "无"}`);
  if (r.warnings && r.warnings.length) {
    for (const w of r.warnings) L.push(`警告        : ${w}`);
  }
  L.push("");
  L.push("[底层验签报告]");
  L.push(r.detail || "（无）");
  L.push("");
  L.push("说明：本入口只做格式识别与路由，不重复实现底层验签；BLOCKED/UNVERIFIED 均不伪造 PASS。");
  return L.join("\n");
}

export async function sigVerifyRun(text, p = {}) {
  const r = await sigVerify(text, p);
  return formatUnifiedResult(r);
}

register({
  id: "sigVerify",
  family: "sig",
  familyLabel: "verify",
  cat: "asym",
  name: "统一验签入口",
  desc: "自动识别 JWT/JWS、PGP、SSHSIG、X.509、CMS/PKCS#7 并路由到现有/候选验签 op；统一输出协议、算法、签名者、有效期、结论与失败原因。只做分诊与报告，不重复实现底层验签；未知格式显式报错，缺密钥/缺原文/未接线分别标 UNVERIFIED/BLOCKED，不伪造 PASS",
  params: [
    { key: "key", label: "公钥 / 密钥材料", type: "textarea", default: "", placeholder: "JWT：RSA/EC PEM 或 JWK；PGP：公钥块；SSHSIG：authorized_keys 公钥行" },
    { key: "secret", label: "JWT HMAC 密钥 secret", type: "text", default: "", placeholder: "HS256/384/512 用" },
    { key: "content", label: "detached 原文（PGP/CMS 用）", type: "textarea", default: "", placeholder: "PGP 分离签名或 detached CMS 时提供" },
    { key: "contentEnc", label: "原文编码", type: "select", default: "text", options: [
      { value: "text", label: "文本（UTF-8）" },
      { value: "hex", label: "hex 字节" },
      { value: "base64", label: "base64" },
    ] },
    { key: "certs", label: "CMS 补充证书（PEM，可多张）", type: "textarea", default: "" },
    { key: "anchor", label: "X.509 信任锚（PEM 或 SHA-256 指纹）", type: "text", default: "" },
    { key: "at", label: "X.509 验证时刻（ISO 8601 / epoch 秒）", type: "text", default: "" },
    { key: "leaf", label: "X.509 叶子证书序号（0=自动）", type: "number", default: 0 },
    { key: "requireSignedAttrs", label: "CMS 要求 signedAttrs", type: "bool", default: true },
    { key: "namespace", label: "SSHSIG namespace", type: "text", default: "file" },
  ],
  run: async (text, p) => sigVerifyRun(text, p),
});
