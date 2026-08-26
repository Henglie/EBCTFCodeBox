/*
 * jwtCrack.js — JWT 弱密钥字典爆破（T348，cat:'modern'，单向 async run）。
 *
 * 场景：JWT 用 HS256/384/512（HMAC 对称签名）且密钥是弱口令时，可离线爆破——
 * 逐个候选用 HMAC(alg, key, "header.payload") 重算签名与签名段比对，命中即得密钥。
 * 非对称系列（RS/ES/PS）无对称密钥可爆，明确拒绝。
 *
 * 算法依据：RFC 7519（JWT 结构 header.payload.signature，base64url 无填充）、
 * RFC 7515 §JWS（签名输入 = ASCII(header) + "." + ASCII(payload)）、
 * RFC 2104 / FIPS 198-1（HMAC 构造，经 WebCrypto HMAC 原语实现）。
 *
 * 字典四模式：内置弱密钥（通用弱口令 + JWT 常见默认 secret）/ 自定义逐行 /
 * 纯数字 0-10^N / 全部合并。防爆：尝试上限 200 万次（同本项目 HMAC 密钥爆破口径）。
 *
 * 签名比对按解码后的原始字节（常量时间比较），兼容 base64url 带不带填充的写法。
 * 算法识别：参数优先，auto 时读 header 的 alg 字段（解析失败默认 HS256）。
 *
 * 回归断言：加载期自检（async，导出 Promise 供回归脚本 await）——
 * RFC 4231 官方测试向量（TC1 三算法 + TC2）校 HMAC 核心；参考实现单测
 * 「secret 命中 / correct-horse 未命中」转写为主路径断言；另覆盖算法自动识别、
 * 强制覆盖、RS256/none 拒绝、非法结构、数字字典、HS384/512 闭环。
 */
import { register } from "./registry.js";

// ============ base64url（无填充）工具 ============

function b64urlEncodeBytes(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  let b64;
  if (typeof btoa === "function") b64 = btoa(bin);
  else if (typeof Buffer !== "undefined") b64 = Buffer.from(bytes).toString("base64");
  else throw new Error("无 btoa/Buffer，无法编码 base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecodeToBytes(s) {
  const pad = s.length % 4;
  const std = s.replace(/-/g, "+").replace(/_/g, "/") + (pad ? "=".repeat(4 - pad) : "");
  let bin;
  if (typeof atob === "function") bin = atob(std);
  else if (typeof Buffer !== "undefined") bin = Buffer.from(std, "base64").toString("binary");
  else throw new Error("无 atob/Buffer，无法解码 base64");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder().decode(b);
const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

// ============ HMAC-SHA（WebCrypto 原语，返回字节） ============

const ALG_TO_HASH = { HS256: "SHA-256", HS384: "SHA-384", HS512: "SHA-512" };

async function hmacShaBytes(alg, keyBytes, dataBytes) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto");
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: ALG_TO_HASH[alg] }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, dataBytes);
  return new Uint8Array(sig);
}

/** 常量时间比较（防时序侧信道）。 */
function ctEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

// ============ 内置弱密钥字典（通用弱口令 + JWT 常见默认 secret，去重） ============

const BUILTIN_DICT = [...new Set([
  // JWT / Web 开发常见默认密钥
  "secret", "secretkey", "secret_key", "secretKey", "my-secret", "my_secret", "mysecret",
  "supersecret", "super-secret", "super_secret", "topsecret", "top-secret", "yoursecret",
  "oursecret", "jwt", "jwt-secret", "jwt_secret", "jwtsecret", "token", "token-secret",
  "your-256-bit-secret", "your_jwt_secret", "this-is-a-secret", "thisisasecret",
  "signing-key", "signingkey", "sign-key", "privatekey", "private-key", "apikey", "api-key",
  "api_secret", "apisecret", "dev", "dev-secret", "development", "production", "prod",
  "staging", "localhost", "server", "test", "test-secret", "default", "changeme",
  // 通用弱口令
  "password", "password1", "password123", "p@ssw0rd", "pass", "passwd", "123456", "1234567",
  "12345678", "123456789", "1234567890", "1234", "12345", "123123", "121212", "111111",
  "000000", "666666", "888888", "654321", "112233", "123qwe", "qwe123", "1q2w3e", "1q2w3e4r",
  "1qaz2wsx", "qazwsx", "qwerty", "qwerty123", "qwertyuiop", "asdfgh", "zxcvbn", "abc123",
  "abcd1234", "abcdef", "aaaaaa", "admin", "admin123", "administrator", "root", "toor",
  "guest", "user", "login", "master", "letmein", "welcome", "changemenow", "monkey",
  "dragon", "sunshine", "princess", "football", "baseball", "michael", "shadow", "batman",
  "superman", "trustno1", "iloveyou", "whatever", "hello", "hello123", "free", "starwars",
  "computer", "internet", "google", "facebook", "github", "linux", "windows", "android",
  // CTF 常见
  "flag", "ctf", "ctf2024", "ctf2025", "s3cr3t", "secr3t", "s3cret",
  "key", "keys", "mykey", "my-key", "the-key", "thekey", "llave", "clave", "hmac-secret",
])];

// ============ JWT 爆破核心 ============

const TRY_LIMIT = 2_000_000; // 与本项目 HMAC 密钥爆破同口径的上限

/** 解析 JWT 三段；非法返回 null。 */
function splitJwt(token) {
  const parts = String(token || "").trim().split(".");
  return parts.length === 3 && parts.every((s) => s.length > 0) ? parts : null;
}

/** 从 header 段读 alg（base64url → JSON → .alg），失败返回 null。 */
function readAlg(headerB64) {
  try {
    const obj = JSON.parse(td(b64urlDecodeToBytes(headerB64)));
    return typeof obj.alg === "string" ? obj.alg : null;
  } catch { return null; }
}

/**
 * JWT 弱密钥爆破（纯函数，供测试直接调）。
 * @param {string} token JWT 全串
 * @param {object} opts { algorithm:"auto"|HS*, dict:"builtin"|"custom"|"numeric"|"all",
 *   customDict:string, maxDigits:number }
 * @returns {Promise<{found:boolean, key?:string, alg:string, tried:number, total:number,
 *   headerText:string, payloadText:string}>}
 */
export async function crackJwt(token, opts = {}) {
  const parts = splitJwt(token);
  if (!parts) throw new Error("不是有效的 JWT（应为 header.payload.signature 三段）。");

  let alg = opts.algorithm || "auto";
  const headerAlg = readAlg(parts[0]);
  if (alg === "auto") alg = headerAlg || "HS256";
  if (!ALG_TO_HASH[alg]) {
    throw new Error(`只支持 HMAC 系列（HS256/HS384/HS512）爆破，该 JWT 的 alg = ${headerAlg || alg}。非对称签名没有对称密钥可爆。`);
  }

  const headerText = (() => { try { return td(b64urlDecodeToBytes(parts[0])); } catch { return "(header 解码失败)"; } })();
  const payloadText = (() => { try { return td(b64urlDecodeToBytes(parts[1])); } catch { return "(payload 解码失败)"; } })();

  let targetSig;
  try { targetSig = b64urlDecodeToBytes(parts[2]); }
  catch { throw new Error("签名段不是合法 base64url。"); }

  // 组候选（保序去重）
  const seen = new Set();
  const words = [];
  const add = (w) => { if (w && !seen.has(w)) { seen.add(w); words.push(w); } };
  const dict = opts.dict || "builtin";
  if (dict === "builtin" || dict === "all") for (const w of BUILTIN_DICT) add(w);
  if (dict === "custom" || dict === "all") {
    for (const w of String(opts.customDict || "").split(/\r?\n/)) add(w.trim());
  }
  if (dict === "numeric" || dict === "all") {
    let maxDigits = parseInt(opts.maxDigits, 10);
    if (!Number.isFinite(maxDigits) || maxDigits < 1) maxDigits = 6;
    if (maxDigits > 8) maxDigits = 8;
    for (let len = 1; len <= maxDigits; len++) {
      const limit = Math.pow(10, len);
      for (let n = 0; n < limit; n++) add(String(n));
      if (words.length > TRY_LIMIT) break;
    }
  }
  if (words.length === 0) throw new Error("候选字典为空（选自定义请逐行填入候选，或换字典模式）。");

  const signingInput = te(parts[0] + "." + parts[1]);
  let tried = 0;
  for (const w of words) {
    tried++;
    const sig = await hmacShaBytes(alg, te(w), signingInput);
    if (ctEqual(sig, targetSig)) {
      return { found: true, key: w, alg, tried, total: words.length, headerText, payloadText };
    }
    if (tried >= TRY_LIMIT) break;
  }
  return { found: false, alg, tried, total: words.length, headerText, payloadText };
}

// ============ run ============

async function jwtCrackRun(text, p) {
  const token = String(text || "").trim();
  if (!token) return "（空输入）请粘贴完整 JWT（header.payload.signature 三段）。";
  const pp = p || {};

  let r;
  try {
    r = await crackJwt(token, {
      algorithm: pp.algorithm || "auto",
      dict: pp.dict || "builtin",
      customDict: pp.customDict,
      maxDigits: pp.maxDigits,
    });
  } catch (e) {
    return "（无法爆破）" + (e && e.message ? e.message : String(e));
  }

  const auto = (pp.algorithm || "auto") === "auto";
  const lines = [];
  lines.push(`JWT 密钥爆破（${r.alg}${auto ? " · 自动识别自 header" : " · 手动指定"}，候选 ${r.total} 条）`);
  lines.push(`Header: ${r.headerText}`);
  lines.push(`Payload: ${r.payloadText}`);
  lines.push("");
  if (r.found) {
    lines.push(`命中 ✓  密钥 = "${r.key}"（第 ${r.tried} 个候选）`);
    lines.push("下一步：用此密钥可自行签发 / 改 payload（JWT 工具），服务端应更换为高熵随机密钥。");
  } else {
    lines.push(`未命中 ✗（${r.tried} 条候选均未命中，${r.alg}）`);
    lines.push("建议：换「算法」强制 HS384/512 再试；扩充自定义字典；密钥若是非字典随机串则需离线 hashcat。");
  }
  return lines.join("\n");
}

// ============ 测试 JWT 构造器（供回归脚本） ============

/** 用给定算法与密钥签一个最小 JWT（payload 可传对象）。 */
export async function makeJwt(alg, secret, payload) {
  const header = { alg, typ: "JWT" };
  const headerB64 = b64urlEncodeBytes(te(JSON.stringify(header)));
  const payloadB64 = b64urlEncodeBytes(te(JSON.stringify(payload ?? { user: "admin" })));
  const sig = await hmacShaBytes(alg, te(secret), te(headerB64 + "." + payloadB64));
  return `${headerB64}.${payloadB64}.${b64urlEncodeBytes(sig)}`;
}

// ============ 加载期自检（async，导出 Promise 供回归 await） ============

export const jwtCrackSelfTest = (async () => {
  // ① HMAC 核心：RFC 4231 TC1（key=0x0b×20，data="Hi There"）三算法官方向量
  const key0b = new Uint8Array(20).fill(0x0b);
  const msg = te("Hi There");
  const v256 = bytesToHex(await hmacShaBytes("HS256", key0b, msg));
  const v384 = bytesToHex(await hmacShaBytes("HS384", key0b, msg));
  const v512 = bytesToHex(await hmacShaBytes("HS512", key0b, msg));
  if (v256 !== "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7") {
    throw new Error(`jwtCrack 自检①失败 HMAC-SHA-256: ${v256}`);
  }
  if (v384 !== "afd03944d84895626b0825f4ab46907f15f9dadbe4101ec682aa034c7cebc59cfaea9ea9076ede7f4af152e8b2fa9cb6") {
    throw new Error(`jwtCrack 自检①失败 HMAC-SHA-384: ${v384}`);
  }
  if (v512 !== "87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854") {
    throw new Error(`jwtCrack 自检①失败 HMAC-SHA-512: ${v512}`);
  }

  // ② HMAC-SHA-256：RFC 4231 TC2（key="Jefe"，data="what do ya want for nothing?"）
  const v2 = bytesToHex(await hmacShaBytes("HS256", te("Jefe"), te("what do ya want for nothing?")));
  if (v2 !== "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843") {
    throw new Error(`jwtCrack 自检②失败 RFC4231-TC2: ${v2}`);
  }

  // ③ 主路径命中（参考单测：secret 在 4 词字典第 3 个）
  const jwt = await makeJwt("HS256", "secret", { user: "admin" });
  const hit = await crackJwt(jwt, { algorithm: "auto", dict: "custom", customDict: "admin\npassword\nsecret\n123456" });
  if (!hit.found || hit.key !== "secret" || hit.tried !== 3) {
    throw new Error(`jwtCrack 自检③失败: ${JSON.stringify(hit)}`);
  }

  // ④ 未命中路径（参考单测：correct-horse 不在字典）
  const miss = await crackJwt(await makeJwt("HS256", "correct-horse"), { dict: "custom", customDict: "a\nb" });
  if (miss.found) throw new Error("jwtCrack 自检④失败：应未命中");

  // ⑤ 算法自动识别 + header/payload 展示 + run 报告
  const out5 = await jwtCrackRun(await makeJwt("HS256", "secret", { user: "admin" }), { dict: "custom", customDict: "secret" });
  if (!out5.includes("自动识别") || !out5.includes('"alg":"HS256"') || !out5.includes('"user":"admin"') || !out5.includes('密钥 = "secret"')) {
    throw new Error(`jwtCrack 自检⑤失败：\n${out5}`);
  }

  // ⑥ 算法强制覆盖：HS256 签的令牌强制 HS384 必不中
  const wrong = await crackJwt(jwt, { algorithm: "HS384", dict: "custom", customDict: "secret" });
  if (wrong.found) throw new Error("jwtCrack 自检⑥失败：跨算法不应命中");

  // ⑦ 非法结构 + 参数显式非 HMAC 算法拒绝
  let msg7 = "";
  try { await crackJwt("only.two", {}); }
  catch (e) { msg7 = e.message; }
  if (!msg7.includes("不是有效的 JWT")) throw new Error(`jwtCrack 自检⑦失败：${msg7}`);
  let msg7b = "";
  try { await crackJwt("a.b.c", { algorithm: "RS256" }); }
  catch (e) { msg7b = e.message; }
  if (!msg7b.includes("只支持 HMAC 系列")) throw new Error(`jwtCrack 自检⑦失败：${msg7b}`);

  // ⑧ HS384 / HS512 闭环（内置字典命中 jwt-secret）
  for (const alg of ["HS384", "HS512"]) {
    const r = await crackJwt(await makeJwt(alg, "jwt-secret"), { dict: "builtin" });
    if (!r.found || r.key !== "jwt-secret" || r.alg !== alg) {
      throw new Error(`jwtCrack 自检⑧失败 ${alg}: ${JSON.stringify(r)}`);
    }
  }

  // ⑨ 数字字典：4 位数字密钥
  const r9 = await crackJwt(await makeJwt("HS256", "9527"), { dict: "numeric", maxDigits: 4 });
  if (!r9.found || r9.key !== "9527") throw new Error(`jwtCrack 自检⑨失败: ${JSON.stringify(r9)}`);

  // ⑩ header alg=none 自动识别 → 拒绝（非 HMAC）
  const noneHeader = b64urlEncodeBytes(te(JSON.stringify({ alg: "none", typ: "JWT" })));
  let msg10 = "";
  try { await crackJwt(`${noneHeader}.e30.AQ`, { algorithm: "auto" }); }
  catch (e) { msg10 = e.message; }
  if (!msg10.includes("只支持 HMAC 系列") || !msg10.includes("none")) throw new Error(`jwtCrack 自检⑩失败：${msg10}`);
})();

// ============ register ============

register({
  id: "jwtCrack", cat: "modern", name: "JWT 密钥爆破",
  desc: "HS256/384/512 签名 JWT 的弱密钥字典爆破：内置弱密钥 + 自定义 + 纯数字，重算 HMAC 签名逐个比对。算法自动识别自 header（可强制指定）；RS/ES 等非对称签名拒绝",
  params: [
    {
      key: "algorithm", label: "算法", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（读 header 的 alg）" },
        { value: "HS256", label: "HS256" },
        { value: "HS384", label: "HS384" },
        { value: "HS512", label: "HS512" },
      ],
    },
    {
      key: "dict", label: "密钥字典", type: "select", default: "builtin",
      options: [
        { value: "builtin", label: "内置弱密钥（约 130 条）" },
        { value: "custom", label: "自定义（下方逐行）" },
        { value: "numeric", label: "纯数字（0-10^N）" },
        { value: "all", label: "全部（内置+自定义+数字）" },
      ],
    },
    { key: "customDict", label: "自定义字典（每行一个）", type: "text", default: "", placeholder: "secret\njwt-secret\n..." },
    { key: "maxDigits", label: "数字最大位数", type: "number", default: 6, placeholder: "1-8（越大越慢）" },
  ],
  run: jwtCrackRun,
});

export { jwtCrackRun };
