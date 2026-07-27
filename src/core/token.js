/*
 * token.js — JWT / 令牌解析组（cat:'modern'，T48）。
 *
 * 覆盖：
 * - jwt JWT 签发（HS256/384/512）/ 解析（三段拆解 + 声明美化 + 可选验签）
 * - jwtNone JWT None 算法攻击构造 / 检测
 * - jweIdentify JWE 紧凑序列化结构识别（5 段，RFC 7516）
 * - pasetoIdentify PASETO 令牌识别（v1-v4 / local / public）
 * - b64urlJson Base64url ↔ JSON 美化
 *
 * 红线：
 * - 只新建 token.js，不碰其他 core/*.js。
 * - 签名校验复用 WebCrypto（crypto.subtle HMAC），不自造 crypto。
 * - 零外发：全部本地计算。
 *
 * 参考：RFC 7519 (JWT)、RFC 7516 (JWE)、PASETO 规范。
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

// ============================================================
// base64url 工具（RFC 4648 §5，无 padding，- 与 _ 替换 + /）
// ============================================================
function b64urlEncodeBytes(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecodeToBytes(s) {
  const pad = s.length % 4;
  const std = s.replace(/-/g, "+").replace(/_/g, "/") + (pad ? "=".repeat(4 - pad) : "");
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlEncodeText(text) {
  return b64urlEncodeBytes(te(text));
}
function b64urlDecodeText(s) {
  return td(b64urlDecodeToBytes(s));
}

// ============================================================
// JSON 美化
// ============================================================
function prettyJson(obj) {
  return JSON.stringify(obj, null, 2);
}
function parseJsonSafe(text) {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch { return { ok: false, value: text }; }
}

// ============================================================
// HMAC-SHA（WebCrypto，返回字节；红线：复用 WebCrypto 不自造）
// ============================================================
const ALG_TO_HASH = { HS256: "SHA-256", HS384: "SHA-384", HS512: "SHA-512" };
async function hmacShaBytes(alg, keyBytes, dataBytes) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto");
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: ALG_TO_HASH[alg] }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, dataBytes);
  return new Uint8Array(sig);
}

// 常量时间比较（防时序侧信道）
function ctEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

// ============================================================
// JWT 签发（encode）/ 解析 + 验签（decode）
// ============================================================
async function jwtEncode(payloadText, p) {
  const alg = (p && p.alg) || "HS256";
  if (!ALG_TO_HASH[alg]) throw new Error("不支持的 alg: " + alg + "（仅 HS256/HS384/HS512）");
  const secret = (p && p.secret != null) ? String(p.secret) : "";
  if (!secret) throw new Error("签发 JWT 需要密钥（secret）");
  let payload;
  try { payload = JSON.parse(payloadText); }
  catch (e) { throw new Error("payload 不是合法 JSON: " + e.message); }
  const header = { alg, typ: "JWT" };
  const headerB64 = b64urlEncodeText(JSON.stringify(header));
  const payloadB64 = b64urlEncodeText(JSON.stringify(payload));
  const signingInput = headerB64 + "." + payloadB64;
  const sig = await hmacShaBytes(alg, te(secret), te(signingInput));
  return signingInput + "." + b64urlEncodeBytes(sig);
}

async function jwtDecode(token, p) {
  const parts = String(token).trim().split(".");
  if (parts.length < 2 || parts.length > 3) {
    throw new Error("JWT 格式错误：须为 header.payload[.signature]");
  }
  const [headerB64, payloadB64, sigB64] = parts;
  let header, payload;
  try { header = JSON.parse(b64urlDecodeText(headerB64)); }
  catch { throw new Error("JWT header 解析失败（非合法 base64url JSON）"); }
  try { payload = JSON.parse(b64urlDecodeText(payloadB64)); }
  catch { throw new Error("JWT payload 解析失败（非合法 base64url JSON）"); }

  const lines = [];
  lines.push("=== Header ===");
  lines.push(prettyJson(header));
  lines.push("");
  lines.push("=== Payload ===");
  lines.push(prettyJson(payload));
  lines.push("");
  lines.push("=== Signature ===");
  lines.push(parts.length === 3 && sigB64 ? sigB64 : "(无)");

 // 验签（先判 None 算法攻击，再判签名段缺失——none JWT 签名段常为空）
  const alg = header.alg;
  const secret = p && p.secret != null ? String(p.secret) : "";
  if (alg === "none" || alg === undefined || alg === null) {
    lines.push("");
    lines.push("=== 验签 === 警告：alg=" + JSON.stringify(alg) + "（None 算法攻击，无完整性保护）");
  } else if (parts.length < 3 || !sigB64) {
    lines.push("");
    lines.push("=== 验签 === 无签名段（alg:" + (alg || "?") + "），无法验签");
  } else if (ALG_TO_HASH[alg]) {
    if (!secret) {
      lines.push("");
      lines.push("=== 验签 === 未提供 secret，跳过验签");
    } else {
      const signingInput = headerB64 + "." + payloadB64;
      const expected = await hmacShaBytes(alg, te(secret), te(signingInput));
      const actual = b64urlDecodeToBytes(sigB64);
      lines.push("");
      lines.push("=== 验签 === " +
        (ctEqual(expected, actual) ? "PASS（签名匹配）" : "FAIL（签名不匹配，密钥错误或被篡改）"));
    }
  } else {
    lines.push("");
    lines.push("=== 验签 === alg=" + alg + " 非 HS* 系列，本工具不支持验签（仅 HS256/384/512）");
  }
  return lines.join("\n");
}

// ============================================================
// JWT None 攻击构造 / 检测
// ============================================================
function jwtNoneEncode(payloadText) {
  let payload;
  try { payload = JSON.parse(payloadText); }
  catch (e) { throw new Error("payload 不是合法 JSON: " + e.message); }
  const header = { alg: "none", typ: "JWT" };
  const headerB64 = b64urlEncodeText(JSON.stringify(header));
  const payloadB64 = b64urlEncodeText(JSON.stringify(payload));
  return headerB64 + "." + payloadB64 + ".";
}
function jwtNoneDecode(token) {
  const parts = String(token).trim().split(".");
  if (parts.length < 2 || parts.length > 3) {
    throw new Error("JWT 格式错误：须为 header.payload[.signature]");
  }
  let header;
  try { header = JSON.parse(b64urlDecodeText(parts[0])); }
  catch { throw new Error("JWT header 解析失败"); }
  const alg = header.alg;
  const lines = [];
  lines.push("=== Header ===");
  lines.push(prettyJson(header));
  lines.push("");
  const isNone = alg === "none" || alg === "None" || alg === "NONE";
  if (isNone) {
    lines.push("=== 检测结果 === 命中 None 算法攻击：alg=" + JSON.stringify(alg));
    lines.push("说明：alg:none 表示无签名，服务端若仅按 header.alg 派发验签逻辑即可被绕过。");
    lines.push("签名段：" + (parts[2] === undefined ? "(空)" : JSON.stringify(parts[2])));
  } else {
    lines.push("=== 检测结果 === 未命中 None 攻击（alg=" + JSON.stringify(alg) + "）");
  }
  return lines.join("\n");
}

// ============================================================
// JWE 结构识别（RFC 7516 紧凑序列化：5 段）
// HEADER.ENCRYPTED_KEY.IV.CIPHERTEXT.TAG
// ============================================================
function jweIdentify(token) {
  const parts = String(token).trim().split(".");
  if (parts.length !== 5) {
    throw new Error("非 JWE 紧凑序列化：JWE 须为 5 段（HEADER.ENCRYPTED_KEY.IV.CIPHERTEXT.TAG），当前 " + parts.length + " 段");
  }
  const [headerB64, ekB64, ivB64, ctB64, tagB64] = parts;
  const lines = [];
  lines.push("=== JWE 结构识别（5 段紧凑序列化）===");
  let header = null;
  try {
    header = JSON.parse(b64urlDecodeText(headerB64));
    lines.push("受保护头部: " + prettyJson(header));
  } catch {
    lines.push("受保护头部(base64url): " + headerB64 + "（非合法 JSON）");
  }
  lines.push("CEK 加密密钥(base64url, " + ekB64.length + " 字符): " + (ekB64 || "(空)"));
  lines.push("IV 初始向量(base64url, " + ivB64.length + " 字符): " + (ivB64 || "(空)"));
  lines.push("密文(base64url, " + ctB64.length + " 字符): " +
    (ctB64 ? ctB64.slice(0, 40) + (ctB64.length > 40 ? "…" : "") : "(空)"));
  lines.push("认证标签(base64url, " + tagB64.length + " 字符): " + (tagB64 || "(空)"));
  if (header) {
    lines.push("");
    lines.push("算法提示: alg=" + (header.alg || "?") + ", enc=" + (header.enc || "?"));
  }
  return lines.join("\n");
}

// ============================================================
// PASETO 识别（version.purpose.payload[.footer]）
// ============================================================
function pasetoIdentify(token) {
  const t = String(token).trim();
  const parts = t.split(".");
  if (parts.length < 3 || parts.length > 4) {
    throw new Error("非 PASETO 结构：须为 version.purpose.payload[.footer]（3-4 段），当前 " + parts.length + " 段");
  }
  const [version, purpose, payloadB64, footerB64] = parts;
  const validVersions = ["v1", "v2", "v3", "v4"];
  const validPurposes = ["local", "public"];
  const lines = [];
  lines.push("=== PASETO 结构识别 ===");
  lines.push("版本: " + version + (validVersions.includes(version) ? "" : "（非标准版本）"));
  lines.push("用途: " + purpose +
    (validPurposes.includes(purpose)
      ? "（" + (purpose === "local" ? "对称加密" : "非对称签名") + "）"
      : "（非标准用途）"));
  let payloadRaw = null;
  try { payloadRaw = b64urlDecodeText(payloadB64); } catch { payloadRaw = null; }
  lines.push("Payload(base64url, " + payloadB64.length + " 字符): " +
    (payloadB64 ? payloadB64.slice(0, 40) + (payloadB64.length > 40 ? "…" : "") : "(空)"));
  if (payloadRaw) {
    const pj = parseJsonSafe(payloadRaw);
    if (pj.ok) lines.push("Payload 解码(JSON): " + prettyJson(pj.value));
    else lines.push("Payload 解码(文本): " + payloadRaw.slice(0, 60) + (payloadRaw.length > 60 ? "…" : ""));
  }
  if (footerB64 !== undefined) {
    lines.push("Footer(base64url, " + footerB64.length + " 字符): " +
      (footerB64 ? footerB64.slice(0, 40) + (footerB64.length > 40 ? "…" : "") : "(空)"));
    let footerRaw = null;
    try { footerRaw = b64urlDecodeText(footerB64); } catch { footerRaw = null; }
    if (footerRaw) {
      const fj = parseJsonSafe(footerRaw);
      lines.push("Footer 解码: " + (fj.ok ? prettyJson(fj.value) : footerRaw.slice(0, 60)));
    }
  } else {
    lines.push("Footer: (无)");
  }
  lines.push("");
  lines.push("合规: " + (validVersions.includes(version) && validPurposes.includes(purpose) ? "标准 PASETO" : "非标准"));
  return lines.join("\n");
}

// ============================================================
// Base64url ↔ JSON 美化
// ============================================================
function b64urlJsonEncode(text) {
 // 输入 JSON → 规范化（紧凑）→ base64url；非 JSON 原样 base64url
  const pj = parseJsonSafe(String(text));
  const normalized = pj.ok ? JSON.stringify(pj.value) : String(text);
  return b64urlEncodeText(normalized);
}
function b64urlJsonDecode(b64) {
  const raw = b64urlDecodeText(String(b64));
  const pj = parseJsonSafe(raw);
  return pj.ok ? prettyJson(pj.value) : raw;
}

// ============================================================
// detect 指纹（供一键解码）
// ============================================================
function jwtDetect(t) {
  const s = String(t).trim();
  const parts = s.split(".");
  if (parts.length < 2 || parts.length > 3) return 0;
  try {
    const h = JSON.parse(b64urlDecodeText(parts[0]));
    if (h && (h.typ === "JWT" || h.alg)) return 0.7;
  } catch { /* ignore */ }
  return 0;
}

// ============================================================
// 注册
// ============================================================
register({
  id: "jwt", cat: "modern", name: "JWT", desc: "JSON Web Token 签发(HS256/384/512)/解析+验签",
  params: [
    { key: "secret", label: "密钥", type: "text", default: "", placeholder: "HS* 验签/签发密钥" },
    { key: "alg", label: "算法", type: "select", default: "HS256", options: ["HS256", "HS384", "HS512"] },
  ],
  encode: jwtEncode, decode: jwtDecode,
  detect: jwtDetect,
});

register({
  id: "jwtNone", cat: "modern", name: "JWT None 攻击", desc: "alg:none 无签名 JWT 构造 / 攻击检测",
  encode: jwtNoneEncode, decode: jwtNoneDecode,
  detect: (t) => {
    const parts = String(t).trim().split(".");
    if (parts.length < 2 || parts.length > 3) return 0;
    try {
      const h = JSON.parse(b64urlDecodeText(parts[0]));
      if (h && (h.alg === "none" || h.alg === "None" || h.alg === "NONE")) return 0.8;
    } catch { /* ignore */ }
    return 0;
  },
});

register({
  id: "jweIdentify", cat: "modern", name: "JWE 结构识别", desc: "JWE 紧凑序列化 5 段拆解（RFC 7516）",
  run: jweIdentify,
});

register({
  id: "pasetoIdentify", cat: "modern", name: "PASETO 识别", desc: "PASETO 令牌结构识别（v1-v4 / local / public）",
  run: pasetoIdentify,
});

register({
  id: "b64urlJson", cat: "modern", name: "Base64url ↔ JSON", desc: "Base64url 与 JSON 互转 + 美化",
  encode: b64urlJsonEncode, decode: b64urlJsonDecode,
});

export {
  jwtEncode, jwtDecode, jwtNoneEncode, jwtNoneDecode,
  jweIdentify, pasetoIdentify, b64urlJsonEncode, b64urlJsonDecode,
  b64urlEncodeText, b64urlDecodeText, b64urlEncodeBytes, b64urlDecodeToBytes,
  hmacShaBytes, ALG_TO_HASH,
};
