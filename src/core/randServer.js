/*
 * randServer.js — server 档联网取数（「增强随机安全」联网 server 档）。
 *
 * 定位：
 *   - 真实联网取数唯一的实现落点。randSource.js 的 warmupServer 调用本模块取数并填池；
 *     core 的同步消费端（_serverBytes）语义不变（未就绪/不足一律抛错，禁静默回落）。
 *   - 零 DOM / 零 localStorage / 零 i18n / 原生 ESM，Node ≥18（globalThis.fetch）与浏览器均可直测。
 *   - 不做任何自动重试、不做任何回落：失败一律显式抛错（带底层原因）。
 *
 * 零外发口径（恒烈第四轮裁定）：
 *   - 本模块本身绝不主动发请求；只有 UI 层在「用户主动配置 endpoint 且在页面内确认条
 *     显式确认后」才经由 warmupServer 调用。默认关闭 = 全项目零网络请求。
 *   - 请求只发往用户自填的 endpoint，本项目不中转、不记录、不预置任何服务器。
 *
 * 响应格式适配（原始字节 / JSON 字段）：
 *   1) application/octet-stream → 响应体即原始随机字节；
 *   2) JSON → 自动识别 9 种常见字段名（KNOWN_FIELDS，见下）之外，支持用户「自定义字段名」
 *      （customField 非空时优先生效，字段不存在即显式报错）；
 *   3) 纯文本 → 先按 JSON 宽容解析，失败则按 hex / base64 字符串解码。
 *
 * 字段值解码支持三种形态（自动判别）：
 *   - 十六进制字符串（可带 0x 前缀）；
 *   - Base64 字符串（标准字母表，含 padding）；
 *   - 数组：元素为 0–255 整数（如 ANU QRNG / random.org），或元素为成对 hex 字符串。
 *   - 兼容一层嵌套 {"random":{"data":[…]}}（random.org 形态）。
 */

/** 取数量上限（字节）——恒烈 2026-10-09 裁决①。 */
export const RAND_SERVER_MAX_BYTES = 1024;
/** 取数量默认值（字节）。 */
export const RAND_SERVER_DEFAULT_BYTES = 32;

/**
 * 自动识别的 9 种常见 JSON 字段名（顺序即优先级；恒烈 2026-10-09 裁决③之外再加自定义字段名）：
 *   random  —— random.org 主字段（值为对象时递归取 .data 数组）；
 *   data    —— ANU QRNG 等常见字段（整数数组）；
 *   bytes   —— 通用字节数组 / hex 串；
 *   result  —— 各类自建随机服务的结果字段；
 *   value   —— 通用值字段；
 *   hex     —— 十六进制串；
 *   entropy —— 熵服务（如 entropy.oxs）常见字段；
 *   randomBytes —— Node 风格命名的自建服务；
 *   b64     —— base64 串。
 */
export const KNOWN_FIELDS = Object.freeze([
  "random", "data", "bytes", "result", "value", "hex", "entropy", "randomBytes", "b64",
]);

/** 取数量归一：非法（非有限正整数 / 超上限）一律显式抛错。 */
export function clampServerCount(v) {
  const n = Number(v == null ? RAND_SERVER_DEFAULT_BYTES : v);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > RAND_SERVER_MAX_BYTES) {
    throw new Error(`取数量非法：须为 1–${RAND_SERVER_MAX_BYTES} 的整数（默认 ${RAND_SERVER_DEFAULT_BYTES}），收到 ${v}`);
  }
  return n;
}

/** endpoint 归一：非空、须为合法 http/https URL（否则显式抛错）。 */
export function normalizeEndpoint(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) throw new Error("随机数服务器未配置 endpoint（server 档默认关闭）");
  let u;
  try { u = new URL(s); } catch { throw new Error(`服务器地址非法（不是合法 URL）：${s}`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`服务器地址非法（仅支持 http/https，收到 ${u.protocol}）：${s}`);
  }
  return u;
}

const _HEX_RE = /^(?:0x)?[0-9a-fA-F]+$/;
const _B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function _hexToBytes(s) {
  let t = s.trim(); if (t.startsWith("0x") || t.startsWith("0X")) t = t.slice(2);
  if (t.length % 2 !== 0) return null;
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function _b64ToBytes(s) {
  try { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); } catch { return null; }
}

/** 字段值 → 字节（hex 串 / base64 串 / 整数数组 / hex 对数组 / 一层 {data:[…]} 嵌套）。 */
export function decodeFieldValue(v) {
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) throw new Error("服务器返回非法数据（字段值为空字符串）");
    if (_HEX_RE.test(s) && s.replace(/^0x/i, "").length % 2 === 0 && s.replace(/^0x/i, "").length > 0) {
      const b = _hexToBytes(s); if (b) return b;
    }
    if (s.length % 4 === 0 && _B64_RE.test(s)) { const b = _b64ToBytes(s); if (b) return b; }
    throw new Error("服务器返回非法数据（字段值既不是合法 hex 也不是合法 base64 串）");
  }
  if (Array.isArray(v)) {
    if (v.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) return Uint8Array.from(v);
    if (v.every((x) => typeof x === "string" && _HEX_RE.test(x) && x.trim().length % 2 === 0 && x.trim().length > 0)) {
      const parts = v.map((x) => _hexToBytes(x.trim()));
      const total = parts.reduce((a, b) => a + b.length, 0);
      const out = new Uint8Array(total); let o = 0;
      for (const p of parts) { out.set(p, o); o += p.length; }
      return out;
    }
    throw new Error("服务器返回非法数据（数组元素既非 0–255 整数也非成对 hex 串）");
  }
  if (v && typeof v === "object" && Array.isArray(v.data)) return decodeFieldValue(v.data); // random.org 一层嵌套
  throw new Error("服务器返回非法数据（字段值类型无法识别：" + (v === null ? "null" : typeof v) + "）");
}

/**
 * 从已解析的 JSON 响应中提取随机字节。
 * customField 非空 → 只认该字段（不存在即显式报错，恒烈裁决③）；
 * 否则按 KNOWN_FIELDS 顺序自动识别，全不命中 → 显式报错。
 */
export function extractRandomFromJson(obj, customField) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("服务器返回非法数据（JSON 顶层不是对象）");
  }
  const cf = String(customField == null ? "" : customField).trim();
  if (cf) {
    if (!Object.prototype.hasOwnProperty.call(obj, cf)) {
      throw new Error(`服务器返回非法数据（自定义字段名「${cf}」不在响应中）`);
    }
    return decodeFieldValue(obj[cf]);
  }
  for (const f of KNOWN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(obj, f)) return decodeFieldValue(obj[f]);
  }
  throw new Error("服务器返回非法数据（未能识别响应字段：既不在 9 种已知字段内，也未填自定义字段名）");
}

/**
 * 联网取随机字节（唯一的网络出口；仅由 UI 层经 warmupServer 在用户显式确认后调用）。
 * @param {{endpoint:string, auth?:string, count?:number, customField?:string, signal?:AbortSignal}} opts
 * @returns {Promise<Uint8Array>} 长度 ≥ count 的随机字节（多余字节进入预取池备用）
 */
export async function fetchServerRandom(opts) {
  const o = opts || {};
  const url = normalizeEndpoint(o.endpoint);
  const count = clampServerCount(o.count);
  const headers = { "Accept": "application/json, application/octet-stream, text/plain" };
  const auth = String(o.auth == null ? "" : o.auth).trim();
  if (auth) headers["Authorization"] = auth; // 原样透传（如 "Bearer xxx"），拼接由用户负责

  let resp;
  try {
    resp = await fetch(url, { method: "GET", headers, signal: o.signal });
  } catch (e) {
    throw new Error(`随机数服务器不可达（${url.origin}）：${(e && e.message) || e}`);
  }
  if (!resp.ok) {
    throw new Error(`随机数服务器返回 HTTP ${resp.status}${resp.statusText ? " " + resp.statusText : ""}（≥400 一律视为失败，不回落）`);
  }

  const buf = new Uint8Array(await resp.arrayBuffer());
  const ctype = String(resp.headers.get("content-type") || "").toLowerCase();
  let bytes;
  if (ctype.includes("octet-stream")) {
    bytes = buf; // 原始字节形态
  } else {
    const text = new TextDecoder().decode(buf);
    let parsed = false;
    if (ctype.includes("json")) {
      let obj;
      try { obj = JSON.parse(text); } catch { throw new Error("服务器返回非法数据（声明为 JSON 但解析失败）"); }
      bytes = extractRandomFromJson(obj, o.customField);
      parsed = true;
    } else {
      try { bytes = extractRandomFromJson(JSON.parse(text), o.customField); parsed = true; }
      catch (e1) {
        if (e1 && /自定义字段名|已知字段/.test(String(e1.message))) throw e1; // 自定义字段缺失须如实上抛
        try { bytes = decodeFieldValue(text); parsed = true; } catch { parsed = false; }
      }
    }
    if (!parsed) throw new Error("服务器返回非法数据（既非 JSON / hex / base64，也非原始字节流）");
  }
  if (!bytes || bytes.length === 0) throw new Error("服务器返回非法数据（响应体为空）");
  if (bytes.length < count) {
    throw new Error(`熵耗尽：请求 ${count} 字节，服务器仅返回 ${bytes.length} 字节（禁静默回落）`);
  }
  return bytes;
}
