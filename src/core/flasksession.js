/*
 * flasksession.js — Flask session cookie 三件：decode / sign / verify（T355，批B4）。
 *
 * 权威依据（逐行对照源码实现，注释中文件/函数均指 pallets 官方库）：
 *   - itsdangerous src/itsdangerous/signer.py
 *       · HMACAlgorithm.get_signature = hmac.new(key, msg, digestmod).digest()，
 *         default_digest_method = hashlib.sha1（FIPS 惰性导入版 _lazy_sha1）。
 *       · derive_key() 四种 key_derivation：
 *           "hmac"          → HMAC-SHA1(secret_key, salt).digest()          [Flask 默认]
 *           "django-concat" → SHA1(salt + b"signer" + secret_key).digest()   [itsdangerous Signer 默认]
 *                              ⚠ 是 salt+"signer"+secret，不是 derivation 名拼前缀。
 *           "concat"        → SHA1(salt + secret_key).digest()
 *           "none"          → secret_key 原样
 *       · NoneAlgorithm.get_signature 返回 b""（算法选 none 时空签名）。
 *   - itsdangerous src/itsdangerous/timed.py TimestampSigner：
 *       · get_timestamp() = int(time.time())（epoch 秒）；
 *       · sign()：timestamp = base64_encode(int_to_bytes(ts))，
 *         value = payload + "." + ts_b64，签名对 value 整体做，
 *         cookie = value + "." + sig_b64。
 *   - itsdangerous src/itsdangerous/encoding.py：
 *       · base64_encode = urlsafe_b64encode().rstrip(b"=")（无 padding）；
 *       · int_to_bytes = struct(">Q").pack(ts).lstrip(b"\\x00")（8 字节大端去前导零，
 *         至少留 1 字节；1.x 与 2.x 同款，已核 1.1.0）；
 *       · bytes_to_int = rjust(8, b"\\x00") 后大端 uint64。
 *   - itsdangerous src/itsdangerous/url_safe.py URLSafeSerializerMixin：
 *       · dump_payload()：json 序列化后 zlib.compress，若 len(compressed) < len(json)-1
 *         则用压缩并给 base64 结果加前缀 b"."（负载以 . 开头 = 压缩标记）；
 *       · load_payload()：负载以 b"." 开头则剥掉再 base64 解码 + zlib.decompress。
 *   - itsdangerous src/itsdangerous/_json.py _CompactJSON：
 *       dumps 默认 ensure_ascii=False + separators=(",", ":")（紧凑 JSON、非 ASCII 原样）。
 *   - flask src/flask/sessions.py SecureCookieSessionInterface：
 *       salt = "cookie-session"，digest_method = sha1，key_derivation = "hmac"，
 *       serializer = TaggedJSONSerializer，经 URLSafeTimedSerializer 签发。
 *       ⚠ Flask 显式覆盖 itsdangerous Signer 的 django-concat 默认为 hmac——
 *       网上流传的 django-concat 说法对 Flask session 不成立，以源码为准。
 *   - flask src/flask/json/tag.py TaggedJSONSerializer.dumps：
 *       dumps(separators=(",", ":"))，底层 flask.json.dumps 默认 sort_keys=True
 *       （flask 2.3+ DefaultJSONProvider.sort_keys=True，老版 jsonify 同）——
 *       即 Flask session 产物 key 按字母序；而 itsdangerous _CompactJSON（裸
 *       URLSafeSerializer）从不排序。故 sign 的 v1 选项序列化前按 key 排序对齐
 *       Flask 真实形态，v2 保持输入原序。Python 端 loads 均不受 key 序影响。
 *   - 常数时间比较：对齐 python hmac.compare_digest（同长逐字节 OR 累加，长度不等即 False）。
 *
 * v1/v2 说明：itsdangerous 1.x 与 2.x 的 cookie 语法、时间戳编码（>Q 去零）、
 * 压缩规则（"." 前缀 + RFC1950 zlib）完全一致，本实现两代通用。
 *
 * zlib 解压复用 compress.js 的 streamDecompress（DecompressionStream + 纯 JS
 * inflateRaw 兜底，v0.1.5 Chromium 挂死修复先例）；压缩复用 streamCompress。
 * HMAC/SHA 字节级运算用 WebCrypto（浏览器 worker 与 node 18+ 均有），与
 * ecdsa.js 的 shaBytes/hmacShaBytes 同构但独立维护（该文件未 export，红线只建独立文件）。
 *
 * 红线：core 层零 UI 依赖；纯本地零外发；无 emoji。
 * 契约：register({ id, cat, name, desc, params, run })，件内自注册。
 */
import { register } from "./registry.js";
import { streamDecompress, streamCompress } from "./compress.js";

// ============ 基础工具 ============

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: true }).decode(b);

/** base64url 无 padding 编码（itsdangerous encoding.base64_encode）。 */
function b64urlEncode(bytes) {
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url 无 padding 解码（itsdangerous encoding.base64_decode，容忍缺失 padding）。 */
function b64urlDecode(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  s += "=".repeat((4 - (s.length % 4)) % 4); // JS 负数取模无 python 语义，须 (4-n%4)%4
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** WebCrypto SHA（字节级）。normName ∈ "SHA-1" | "SHA-256"。 */
async function shaBytes(normName, data) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto（需 HTTPS 或 localhost）");
  return new Uint8Array(await crypto.subtle.digest(normName, data));
}

/** WebCrypto HMAC（字节级，key 可为任意字节串——itsdangerous 的派生密钥是 raw 20 字节）。 */
async function hmacShaBytes(normName, keyBytes, dataBytes) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto（需 HTTPS 或 localhost）");
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: normName }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, dataBytes));
}

/** 常数时间字节比较（对齐 python hmac.compare_digest）。 */
function ctEqualBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

// ============ itsdangerous 核心算法 ============

/** 算法名 → { norm, none }。itsdangerous 只换 digestmod（SHA1/SHA256…），无 JWT 式别名。 */
function digestInfo(digest) {
  if (digest === "SHA1") return { norm: "SHA-1", none: false };
  if (digest === "SHA256") return { norm: "SHA-256", none: false };
  if (digest === "none") return { norm: null, none: true };
  throw new Error("未知算法: " + digest + "（可选 SHA1 / SHA256 / none）");
}

/**
 * 派生签名密钥（signer.py Signer.derive_key）。
 * derivation ∈ "hmac"(Flask 默认) | "django-concat"(itsdangerous Signer 默认)
 *            | "concat" | "none"。
 */
async function deriveKey(secretBytes, saltBytes, derivation, info) {
  if (info.none) return secretBytes; // none 算法不派生，密钥也用不上
  switch (derivation) {
    case "hmac":
      return hmacShaBytes(info.norm, secretBytes, saltBytes);
    case "django-concat": {
      const m = new Uint8Array(saltBytes.length + 7 + secretBytes.length);
      m.set(saltBytes, 0);
      m.set(te("signer"), saltBytes.length);
      m.set(secretBytes, saltBytes.length + 7);
      return shaBytes(info.norm, m);
    }
    case "concat": {
      const m = new Uint8Array(saltBytes.length + secretBytes.length);
      m.set(saltBytes, 0);
      m.set(secretBytes, saltBytes.length);
      return shaBytes(info.norm, m);
    }
    case "none":
      return secretBytes;
    default:
      throw new Error("未知 key_derivation: " + derivation);
  }
}

/** 递归按 key 字母序排（flask.json.dumps 默认 sort_keys=True）。 */
function sortObjKeys(v) {
  if (Array.isArray(v)) return v.map(sortObjKeys);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortObjKeys(v[k]);
    return o;
  }
  return v;
}

/** 时间戳 → base64url（encoding.py int_to_bytes：8 字节大端去前导零）。 */
function tsToB64(ts) {
  let b = new Uint8Array(8);
  let v = BigInt(ts);
  if (v < 0n || v >= 1n << 64n) throw new Error("时间戳超出 uint64 范围");
  for (let i = 7; i >= 0; i--) { b[i] = Number(v & 0xffn); v >>= 8n; }
  let first = 0;
  while (first < 7 && b[first] === 0) first++;
  return b64urlEncode(b.subarray(first));
}

/** base64url → 时间戳秒（encoding.py bytes_to_int：rjust 8 后大端）。 */
function tsFromB64(s) {
  let b = b64urlDecode(s);
  if (b.length > 8) throw new Error("时间戳字节数 > 8");
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v;
}

/** 签名（signer.py HMACAlgorithm/NoneAlgorithm.get_signature + base64_encode）。 */
async function makeSig(keyBytes, valueBytes, info) {
  if (info.none) return ""; // NoneAlgorithm → b"" → 空 base64
  return b64urlEncode(await hmacShaBytes(info.norm, keyBytes, valueBytes));
}

/**
 * 拆 cookie：payload_b64(. 可带压缩前缀) / ts_b64 / sig_b64。
 * 思路与 timed.py unsign 的 rsplit 一致：最后两段是时间戳与签名。
 * 压缩 cookie（payload 以 "." 开头）整体是 ".xxx.ts.sig"，split 会得 4 段，
 * 所以绝不能按 split(".").length===3 硬判（CyberChef 正因此不支持压缩 cookie）。
 */
function splitCookie(cookie) {
  const s = cookie.trim();
  const i2 = s.lastIndexOf(".");
  if (i2 < 0) throw new Error("格式无效：缺签名段（应为 payload.timestamp.signature）");
  const i1 = s.lastIndexOf(".", i2 - 1);
  if (i1 < 0) throw new Error("格式无效：缺时间戳段（应为 payload.timestamp.signature）");
  let payloadB64 = s.slice(0, i1);
  const tsB64 = s.slice(i1 + 1, i2);
  const sigB64 = s.slice(i2 + 1);
  let compressed = false;
  if (payloadB64.startsWith(".")) { payloadB64 = payloadB64.slice(1); compressed = true; }
  return { payloadB64, tsB64, sigB64, compressed };
}

/**
 * 解出 payload JSON 字节（url_safe.py URLSafeSerializerMixin.load_payload）：
 * base64url 解码，压缩则再 zlib(RFC1950) 解压。
 */
async function loadPayloadBytes(payloadB64, compressed) {
  let b = b64urlDecode(payloadB64);
  if (compressed) b = await streamDecompress("deflate", b);
  return b;
}

/**
 * payload JSON 字节 → base64url 负载段（url_safe.py dump_payload）。
 * compress ∈ "auto"(itsdangerous 规则) | "never" | "always"（always 是本工具的
 * 构造便利项，itsdangerous 无此分支；auto 与 python 逐字节同规则）。
 */
async function dumpPayloadBytes(jsonBytes, compress) {
  if (compress === "never") return b64urlEncode(jsonBytes);
  const z = await streamCompress("deflate", jsonBytes);
  if (compress === "always") return "." + b64urlEncode(z);
  // auto：len(compressed) < len(json) - 1 才用压缩（itsdangerous 严格小于）
  if (z.length < jsonBytes.length - 1) return "." + b64urlEncode(z);
  return b64urlEncode(jsonBytes);
}

/** 时间戳秒 → 展示行（epoch / ISO UTC / 本地）。 */
function fmtTimestamp(tsSec) {
  const ms = Number(tsSec) * 1000;
  const d = new Date(ms);
  const iso = d.toISOString();
  const loc = d.toLocaleString("zh-CN", { hour12: false });
  const age = Math.floor(Date.now() / 1000) - Number(tsSec);
  return `时间戳: ${tsSec}\nUTC:   ${iso}\n本地:  ${loc}\n距今:  ${age >= 0 ? age + " 秒前" : -age + " 秒后"}`;
}

/** 组参数 → { secretBytes, saltBytes, info, derivation }。 */
function parseCryptoParams(p) {
  const secret = p.secret ?? "";
  if (!secret) throw new Error("缺少 secret key");
  const info = digestInfo(p.digest || "SHA1");
  return {
    secretBytes: te(secret),
    saltBytes: te(p.salt === undefined || p.salt === "" ? "" : p.salt),
    info,
    derivation: p.derivation || "hmac",
  };
}

/** 验签核心：重算签名并常数时间比对。返回 sigOk + 各段。 */
async function verifyCookie(cookie, p) {
  const { payloadB64, tsB64, sigB64, compressed } = splitCookie(cookie);
  const cp = parseCryptoParams(p);
  const key = await deriveKey(cp.secretBytes, cp.saltBytes, cp.derivation, cp.info);
  // itsdangerous unsign 对含压缩点前缀的整段验签（signer.unsign rsplit 出 value），故压缩时补回 "."
  const value = te((compressed ? "." + payloadB64 : payloadB64) + "." + tsB64);
  const sigCalc = await makeSig(key, value, cp.info);
  const sigOk = ctEqualBytes(te(sigCalc), te(sigB64));
  return { payloadB64, tsB64, sigB64, compressed, sigCalc, sigOk, cp };
}

// ============ op1：flaskSessionDecode ============

async function flaskSessionDecodeRun(text, p) {
  if (!text || !text.trim()) throw new Error("输入为空");
  const { payloadB64, tsB64, sigB64, compressed } = splitCookie(text);
  let tsInt;
  try { tsInt = tsFromB64(tsB64); }
  catch { throw new Error("时间戳段不是有效 base64url（" + tsB64 + "）"); }

  const lines = [];
  lines.push("=== Flask Session Cookie 解码（itsdangerous） ===");

  // payload 解压 + JSON
  let jsonText;
  try {
    const bytes = await loadPayloadBytes(payloadB64, compressed);
    jsonText = td(bytes);
  } catch (e) {
    throw new Error("payload 解码失败: " + (e && e.message ? e.message : String(e)));
  }
  lines.push("payload 压缩: " + (compressed ? "是（zlib，'.' 前缀标记）" : "否"));
  let obj;
  try {
    obj = JSON.parse(jsonText);
    lines.push("payload JSON:\n" + JSON.stringify(obj, null, 2));
  } catch {
    lines.push("payload 原文（非 JSON，可能为 TaggedJSON 特殊类型或损坏）:\n" + jsonText);
  }

  lines.push("");
  lines.push(fmtTimestamp(tsInt));

  // secret 可选：给了就顺带验签（否则只解不验，对齐 CyberChef 解码定位）
  if (p.secret) {
    const r = await verifyCookie(text, p);
    lines.push("");
    lines.push("签名校验（secret 已提供）: " + (r.sigOk ? "✓ 合法" : "× 不合法（密钥/盐/派生/算法不匹配，或已被篡改）"));
    lines.push("  期望签名: " + r.sigCalc);
    lines.push("  实际签名: " + sigB64);
  } else {
    lines.push("");
    lines.push("（未填 secret：只解不验。填入即可同时校验签名真伪）");
  }
  return lines.join("\n");
}

// ============ op2：flaskSessionSign ============

async function flaskSessionSignRun(text, p) {
  if (!text || !text.trim()) throw new Error("输入为空（JSON payload）");
  let obj;
  try { obj = JSON.parse(text); }
  catch (e) { throw new Error("payload 不是合法 JSON: " + e.message); }

  // 紧凑序列化。v2 ≈ itsdangerous _CompactJSON.dumps（ensure_ascii=False +
  // separators=(",",":")，不排序）；v1 ≈ flask TaggedJSONSerializer.dumps
  // （flask.json.dumps 默认 sort_keys=True，key 按字母序）。JS 原生字符串即
  // UTF-8 非 ASCII 原样，等价 ensure_ascii=False。
  const jsonText = JSON.stringify(p.fmt === "v1" ? sortObjKeys(obj) : obj);
  const jsonBytes = te(jsonText);

  const cp = parseCryptoParams(p);

  // 时间戳：留空 = 当前时间（timed.py get_timestamp = int(time.time())）
  let ts;
  if (p.ts === undefined || p.ts === null || p.ts === "") ts = Math.floor(Date.now() / 1000);
  else {
    ts = Number(p.ts);
    if (!Number.isFinite(ts) || !Number.isInteger(ts)) throw new Error("时间戳须为整数 epoch 秒");
    if (ts < 0 || ts > 0xffffffffffff) throw new Error("时间戳超出合理范围（0 .. 2^48-1 秒）");
  }

  const payloadB64 = await dumpPayloadBytes(jsonBytes, p.compress || "auto");
  const tsB64 = tsToB64(ts);
  const value = te(payloadB64 + "." + tsB64);
  const key = await deriveKey(cp.secretBytes, cp.saltBytes, cp.derivation, cp.info);
  const sigB64 = await makeSig(key, value, cp.info);
  const cookie = payloadB64 + "." + tsB64 + "." + sigB64;

  const lines = [];
  lines.push("=== Flask Session Cookie 签发 ===");
  lines.push("cookie:\n" + cookie);
  lines.push("");
  lines.push("payload(JSON): " + jsonText);
  lines.push("时间戳段: " + tsB64 + "  (" + ts + ")");
  lines.push("签名段: " + (sigB64 === "" ? "(空，none 算法)" : sigB64));
  lines.push("压缩: " + (payloadB64.startsWith(".") ? "是（zlib auto/always）" : "否"));
  lines.push("参数: salt=" + (cp.saltBytes.length ? td(cp.saltBytes) : "(空)") +
    "  key_derivation=" + cp.derivation +
    "  digest=" + (cp.info.none ? "none" : cp.info.norm) +
    "  格式=" + (p.fmt === "v1" ? "v1 Flask TaggedJSON（sort_keys）" : "v2 URLSafeSerializer（原序）"));
  return lines.join("\n");
}

// ============ op3：flaskSessionVerify ============

async function flaskSessionVerifyRun(text, p) {
  if (!text || !text.trim()) throw new Error("输入为空");
  const { payloadB64, tsB64, sigB64, compressed, sigCalc, sigOk } = await verifyCookie(text, p);

  let tsInt;
  try { tsInt = tsFromB64(tsB64); }
  catch { throw new Error("时间戳段不是有效 base64url"); }

  const lines = [];
  lines.push("=== Flask Session Cookie 验签 ===");
  lines.push("签名: " + (sigOk ? "✓ 合法（常数时间比较通过）" : "× 不合法"));
  lines.push("  期望签名: " + sigCalc);
  lines.push("  实际签名: " + sigB64);
  lines.push("");
  lines.push(fmtTimestamp(tsInt));

  // maxAge 过期检查（timed.py unsign 的 max_age 分支：now > ts + max_age → SignatureExpired）
  if (p.maxAge !== undefined && p.maxAge !== null && p.maxAge !== "") {
    const maxAge = Number(p.maxAge);
    if (!Number.isFinite(maxAge) || maxAge <= 0) throw new Error("maxAge 须为正整数秒");
    const now = Math.floor(Date.now() / 1000);
    const expired = Number(tsInt) + maxAge < now;
    lines.push("");
    lines.push("过期检查(maxAge=" + maxAge + "s): " +
      (expired ? "× 已过期（签发于 " + (now - Number(tsInt)) + " 秒前，超过 maxAge）" : "✓ 未过期"));
  } else {
    lines.push("");
    lines.push("（未填 maxAge：不做过期检查）");
  }

  // 附带 payload 概览（合法才有意义，但都展示供人工核对）
  try {
    const bytes = await loadPayloadBytes(payloadB64, compressed);
    const jt = td(bytes);
    const o = JSON.parse(jt);
    lines.push("");
    lines.push("payload 概览:\n" + JSON.stringify(o, null, 2));
  } catch { /* 概览失败不阻塞验签结论 */ }
  return lines.join("\n");
}

// ============ 注册 ============

const CRYPTO_PARAMS = [
  { key: "secret", label: "Secret Key", type: "text", default: "", placeholder: "Flask SECRET_KEY（UTF-8）" },
  { key: "salt", label: "Salt", type: "text", default: "cookie-session", placeholder: "Flask 默认 cookie-session" },
  {
    key: "derivation", label: "key_derivation", type: "select", default: "hmac",
    options: [
      { value: "hmac", label: "hmac（Flask 默认：HMAC(secret, salt)）" },
      { value: "django-concat", label: "django-concat（itsdangerous 默认：SHA1(salt+'signer'+secret)）" },
      { value: "concat", label: "concat（SHA1(salt+secret)）" },
      { value: "none", label: "none（密钥不派生）" },
    ],
  },
  {
    key: "digest", label: "签名算法", type: "select", default: "SHA1",
    options: [
      { value: "SHA1", label: "SHA1（itsdangerous/Flask 默认）" },
      { value: "SHA256", label: "SHA256" },
      { value: "none", label: "none（不签名，itsdangerous NoneAlgorithm）" },
    ],
  },
];

register({
  id: "flaskSessionDecode", family: "flask", familyLabel: "decode", cat: "modern", name: "Flask Session 解码",
  desc: "解 Flask session cookie（itsdangerous v1/v2 通用：payload.timestamp.signature，payload=base64url 可选 zlib 压缩 JSON）→ JSON + 时间戳；填 secret 可顺带验签",
  params: [...CRYPTO_PARAMS],
  run: flaskSessionDecodeRun,
});

register({
  id: "flaskSessionSign", family: "flask", familyLabel: "sign", cat: "modern", name: "Flask Session 签发",
  desc: "JSON payload + secret → 完整 Flask session cookie（itsdangerous HMAC-SHA1 默认；zlib 自动压缩按其dangerous 规则）",
  params: [
    ...CRYPTO_PARAMS,
    {
      key: "fmt", label: "序列化格式", type: "select", default: "v2",
      options: [
        { value: "v2", label: "v2 URLSafeSerializer（紧凑 JSON，ensure_ascii=False）" },
        { value: "v1", label: "v1 Flask TaggedJSON（key 排序，Flask session 真实形态）" },
      ],
    },
    {
      key: "compress", label: "zlib 压缩", type: "select", default: "auto",
      options: [
        { value: "auto", label: "auto（itsdangerous 规则：压得更短才用）" },
        { value: "never", label: "never（不压缩）" },
        { value: "always", label: "always（强制压缩，构造用）" },
      ],
    },
    { key: "ts", label: "时间戳（epoch 秒，留空=当前）", type: "text", default: "", placeholder: "如 1700000000" },
  ],
  run: flaskSessionSignRun,
});

register({
  id: "flaskSessionVerify", family: "flask", familyLabel: "verify", cat: "modern", name: "Flask Session 验签",
  desc: "重算 HMAC 签名常数时间比对 → 合法/不合法 + 时间戳 + maxAge 过期检查",
  params: [
    ...CRYPTO_PARAMS,
    { key: "maxAge", label: "maxAge（秒，留空不检过期）", type: "text", default: "", placeholder: "如 3600" },
  ],
  run: flaskSessionVerifyRun,
});
