/*
 * resultTypes.js — 结果类型识别与动作计划（纯数据层）
 *
 * classifyResult(text) → { kind, label, fields, actions }
 *   kind: url | email | wifi | tel | geo | vcard | json | jwt | flag |
 *         base64 | ipv4 | ipv6 | magnet | text
 *   actions: [{ id, label, kind, payload }]
 *     kind = "open" | "copy" | "map"
 *     copy* 的 payload.text 恒为待复制文本；open-url 的 payload 见 urlResult()。
 *
 * 纯计算、零 DOM、零外发；不向 console 输出任何内容。
 * WiFi 口令与 URL userinfo 口令只进 actions.payload（用户主动复制），
 * open-url 会剥离 userinfo；危险 scheme 永不产生可打开链接。
 * open-url 默认 http → https；displayHost 为完整主机名（含非默认端口）。
 */

export const RESULT_KINDS = Object.freeze([
  "url", "email", "wifi", "tel", "geo", "vcard", "json", "jwt",
  "flag", "base64", "ipv4", "ipv6", "magnet", "text",
]);

export const ACTION_IDS = Object.freeze([
  "open-url", "open-map", "copy", "copy-email", "copy-wifi-ssid",
  "copy-wifi-pass", "copy-tel", "copy-password", "copy-decoded",
]);

const MAX_SCAN = 1_000_000;
const MAX_FLAGS = 8;

const LABELS = {
  zh: {
    url: "链接", email: "邮箱", wifi: "WiFi 配置", tel: "电话号码", geo: "地理位置",
    vcard: "vCard 名片", json: "JSON", jwt: "JWT", flag: "Flag", base64: "Base64",
    ipv4: "IPv4 地址", ipv6: "IPv6 地址", magnet: "磁力链接", text: "文本",
    openUrl: "打开链接", openMap: "打开地图", copy: "复制", copyEmail: "复制邮箱",
    copyWifiSsid: "复制 SSID", copyWifiPass: "复制 WiFi 密码", copyTel: "复制电话",
    copyPassword: "复制密码", copyDecoded: "复制解码文本",
  },
  en: {
    url: "Link", email: "Email", wifi: "WiFi config", tel: "Phone number", geo: "Location",
    vcard: "vCard", json: "JSON", jwt: "JWT", flag: "Flag", base64: "Base64",
    ipv4: "IPv4 address", ipv6: "IPv6 address", magnet: "Magnet link", text: "Text",
    openUrl: "Open link", openMap: "Open map", copy: "Copy", copyEmail: "Copy email",
    copyWifiSsid: "Copy SSID", copyWifiPass: "Copy WiFi password", copyTel: "Copy phone",
    copyPassword: "Copy password", copyDecoded: "Copy decoded text",
  },
};

function normalizeLocale(locale) {
  return typeof locale === "string" && /^en/i.test(locale) ? "en" : "zh";
}

function action(id, label, kind, payload) {
  return { id, label, kind, payload };
}

function copyAction(id, label, text, extra) {
  return action(id, label, "copy", { text: String(text == null ? "" : text), ...extra });
}

function stripWrappers(input) {
  let s = String(input == null ? "" : input).trim();
  const pairs = [["<", ">"], ['"', '"'], ["'", "'"], ["`", "`"], ["(", ")"], ["[", "]"]];
  for (const [a, b] of pairs) {
    if (s.length > 2 && s.startsWith(a) && s.endsWith(b)) { s = s.slice(1, -1).trim(); break; }
  }
  return s.replace(/[.,;:!?，。；：！？、]+$/u, "").trim();
}

function safeDecodePct(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

const DANGEROUS_SCHEMES = new Set([
  "javascript", "data", "vbscript", "file", "blob", "about",
  "chrome", "resource", "ms-msdt", "search-ms", "jar",
]);

const SCHEME_RE = /^([a-z][a-z0-9+.-]*):/i;

/**
 * 生成可安全打开的外链信息。默认把 http 升级为 https。
 * @returns {{ok:true,url:string,originalUrl:string,scheme:string,finalScheme:string,
 *   host:string,hostname:string,port:string,displayHost:string,displayUrl:string,
 *   upgraded:boolean,hasCredentials:boolean,username:string,password:string}
 *   |{ok:false,reason:string,original:string,scheme?:string}}
 */
export function sanitizeOpenUrl(input, { upgradeHttps = true } = {}) {
  const original = String(input == null ? "" : input).trim();
  if (!original) return { ok: false, reason: "empty", original };
  if (/[\u0000-\u001f\u007f]/.test(original)) return { ok: false, reason: "control-chars", original };

  let candidate = stripWrappers(original);
  if (/^www\./i.test(candidate)) candidate = "https://" + candidate;

  const m = SCHEME_RE.exec(candidate);
  if (!m) return { ok: false, reason: "no-scheme", original };
  const scheme = m[1].toLowerCase();
  if (DANGEROUS_SCHEMES.has(scheme)) return { ok: false, reason: "blocked-scheme", scheme, original };
  if (scheme !== "http" && scheme !== "https") return { ok: false, reason: "unsupported-scheme", scheme, original };

  let parsed, plain;
  try {
    parsed = new URL(candidate);
    plain = new URL(candidate);
  } catch {
    return { ok: false, reason: "invalid-url", original };
  }
  if (!parsed.hostname) return { ok: false, reason: "no-host", original };

  const username = safeDecodePct(parsed.username);
  const password = safeDecodePct(parsed.password);

  plain.username = "";
  plain.password = "";
  const originalUrl = plain.href;

  parsed.username = "";
  parsed.password = "";
  if (upgradeHttps && parsed.protocol === "http:") {
    parsed.protocol = "https:";
    if (parsed.port === "80") parsed.port = "";
  }

  const finalScheme = parsed.protocol.replace(/:$/, "");
  const host = parsed.host;
  return {
    ok: true,
    url: parsed.href,
    originalUrl,
    scheme,
    finalScheme,
    host,
    hostname: parsed.hostname,
    port: parsed.port,
    displayHost: host,
    displayUrl: parsed.href,
    upgraded: scheme === "http" && finalScheme === "https",
    hasCredentials: Boolean(username || password),
    username,
    password,
  };
}

function urlResult(raw, info, t) {
  const fields = {
    raw,
    url: info.originalUrl,
    openUrl: info.url,
    scheme: info.scheme,
    finalScheme: info.finalScheme,
    host: info.host,
    hostname: info.hostname,
    port: info.port,
    displayHost: info.displayHost,
    displayUrl: info.displayUrl,
    upgraded: info.upgraded,
    hasCredentials: info.hasCredentials,
    length: raw.length,
  };
  if (info.username) fields.username = info.username;
  if (info.password) fields.password = info.password;

  const actions = [action("open-url", t.openUrl, "open", {
    url: info.url,
    originalUrl: info.originalUrl,
    host: info.host,
    hostname: info.hostname,
    port: info.port,
    displayHost: info.displayHost,
    displayUrl: info.displayUrl,
    scheme: info.scheme,
    finalScheme: info.finalScheme,
    upgraded: info.upgraded,
    needsConfirm: true,
    external: true,
  })];
  if (info.password) {
    actions.push(copyAction("copy-password", t.copyPassword, info.password, {
      field: "password", path: "url.userinfo", sensitive: true,
    }));
  }
  actions.push(copyAction("copy", t.copy, raw, { field: "raw" }));
  return { kind: "url", label: t.url, fields, actions };
}

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function parseEmail(raw) {
  let s = String(raw).trim();
  if (/^mailto:/i.test(s)) {
    s = s.slice(7).split("?")[0];
    s = safeDecodePct(s);
  }
  s = stripWrappers(s);
  if (!s || s.length > 254 || !EMAIL_RE.test(s)) return null;
  const at = s.lastIndexOf("@");
  if (at <= 0 || at >= s.length - 1) return null;
  const local = s.slice(0, at);
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  return { email: s, local, domain: s.slice(at + 1).toLowerCase() };
}

function emailResult(raw, e, t) {
  return {
    kind: "email",
    label: t.email,
    fields: { raw, email: e.email, local: e.local, domain: e.domain, length: raw.length },
    actions: [
      copyAction("copy-email", t.copyEmail, e.email, { field: "email" }),
      copyAction("copy", t.copy, raw, { field: "raw" }),
    ],
  };
}

function findUnescapedColon(token) {
  for (let i = 0; i < token.length; i++) {
    if (token[i] === "\\") { i++; continue; }
    if (token[i] === ":") return i;
  }
  return -1;
}

function unescapeWifi(value) {
  return String(value).replace(/\\(.)/g, "$1");
}

function parseWifi(raw) {
  const body = raw.replace(/^\s*WIFI:/i, "");
  const tokens = [];
  let cur = "";
  let esc = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (esc) { cur += "\\" + ch; esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === ";") { tokens.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (esc) cur += "\\";
  if (cur.trim() !== "") tokens.push(cur);

  const out = { security: "", ssid: "", password: "", hidden: false, extra: {} };
  for (const token of tokens) {
    const idx = findUnescapedColon(token);
    if (idx < 0) continue;
    const key = unescapeWifi(token.slice(0, idx)).trim().toUpperCase();
    const value = unescapeWifi(token.slice(idx + 1));
    if (key === "T") out.security = value.trim();
    else if (key === "S") out.ssid = value;
    else if (key === "P") out.password = value;
    else if (key === "H") out.hidden = /^(?:true|yes|1)$/i.test(value.trim());
    else if (key === "I") out.identity = value;
    else if (key === "A") out.anonymous = value;
    else if (key === "E") out.eap = value;
    else if (key === "PH2") out.phase2 = value;
    else if (key) out.extra[key] = value;
  }
  return out;
}

function wifiResult(raw, w, t) {
  const fields = {
    raw,
    ssid: w.ssid,
    security: w.security,
    hidden: w.hidden,
    password: w.password,
    identity: w.identity,
    anonymous: w.anonymous,
    eap: w.eap,
    phase2: w.phase2,
    extra: w.extra,
    length: raw.length,
  };
  const actions = [];
  if (w.ssid) actions.push(copyAction("copy-wifi-ssid", t.copyWifiSsid, w.ssid, { field: "ssid" }));
  if (w.password) {
    actions.push(copyAction("copy-wifi-pass", t.copyWifiPass, w.password, {
      field: "password", path: "wifi.P", sensitive: true,
    }));
  }
  actions.push(copyAction("copy", t.copy, raw, { field: "raw" }));
  return { kind: "wifi", label: t.wifi, fields, actions };
}

function unescapeGeo(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function parseGeo(raw) {
  const s = String(raw).trim();
  if (!/^geo:/i.test(s)) return null;
  const rest = s.slice(4);
  const qIndex = rest.indexOf("?");
  const query = qIndex >= 0 ? new URLSearchParams(rest.slice(qIndex + 1)) : null;
  const pathPart = (qIndex >= 0 ? rest.slice(0, qIndex) : rest).split(";")[0];
  const [latS, lonS] = pathPart.split(",");
  const lat = Number(latS);
  const lon = Number(lonS);
  const coordOk = latS !== undefined && lonS !== undefined &&
    Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  const q = query ? (query.get("q") || "") : "";
  if (!coordOk && !q) return null;
  return {
    lat: coordOk ? lat : null,
    lon: coordOk ? lon : null,
    query: q ? unescapeGeo(q) : "",
  };
}

function geoResult(raw, g, t) {
  const lat = g.lat == null ? 0 : g.lat;
  const lon = g.lon == null ? 0 : g.lon;
  const mapUrl = `https://www.openstreetmap.org/?mlat=${encodeURIComponent(lat)}&mlon=${encodeURIComponent(lon)}#map=16/${lat}/${lon}`;
  const fields = {
    raw, lat: g.lat, lon: g.lon, query: g.query,
    mapUrl, host: "www.openstreetmap.org", service: "OpenStreetMap", length: raw.length,
  };
  return {
    kind: "geo",
    label: t.geo,
    fields,
    actions: [
      action("open-map", t.openMap, "map", {
        url: mapUrl,
        host: fields.host,
        displayHost: fields.host,
        displayUrl: mapUrl,
        lat: g.lat,
        lon: g.lon,
        query: g.query,
        needsConfirm: true,
        external: true,
      }),
      copyAction("copy", t.copy, raw, { field: "raw" }),
    ],
  };
}

function unescapeVCard(value) {
  return String(value).replace(/\\([\\,;:nN])/g, (_, c) => (c === "n" || c === "N" ? "\n" : c));
}

function parseVCard(raw) {
  const lines = raw.replace(/\r\n?/g, "\n").split("\n");
  const unfolded = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) unfolded[unfolded.length - 1] += line.slice(1);
    else unfolded.push(line);
  }
  const out = { fullName: "", name: "", org: "", title: "", note: "", tels: [], emails: [], urls: [], adr: [] };
  for (const line of unfolded) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const left = line.slice(0, idx);
    const value = unescapeVCard(line.slice(idx + 1)).trim();
    const prop = left.split(";")[0].split(".").pop().toUpperCase();
    if (prop === "FN") out.fullName = value;
    else if (prop === "N") out.name = value.replace(/;/g, " ").trim();
    else if (prop === "ORG") out.org = value.replace(/;/g, " ").trim();
    else if (prop === "TITLE") out.title = value;
    else if (prop === "NOTE") out.note = value;
    else if (prop === "TEL" && value) out.tels.push(value);
    else if (prop === "EMAIL" && value) out.emails.push(value);
    else if (prop === "URL" && value) out.urls.push(value);
    else if (prop === "ADR" && value) out.adr.push(value.replace(/;/g, " ").trim());
  }
  return out;
}

function vcardResult(raw, v, t) {
  const fields = {
    raw,
    name: v.fullName || v.name,
    fullName: v.fullName,
    org: v.org,
    title: v.title,
    note: v.note,
    tels: v.tels,
    emails: v.emails,
    urls: v.urls,
    adr: v.adr,
    length: raw.length,
  };
  const actions = [];
  if (v.tels.length) {
    const tel = parseTel(v.tels[0]);
    actions.push(copyAction("copy-tel", t.copyTel, tel ? tel.normalized : v.tels[0], {
      field: "tel", raw: v.tels[0],
    }));
  }
  if (v.emails.length) {
    actions.push(copyAction("copy-email", t.copyEmail, v.emails[0], { field: "email" }));
  }
  actions.push(copyAction("copy", t.copy, raw, { field: "raw" }));
  return { kind: "vcard", label: t.vcard, fields, actions };
}

function parseIPv4(raw) {
  const s = String(raw).trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(s)) return null;
  const parts = s.split(".");
  for (const part of parts) {
    if (part.length > 1 && part.startsWith("0")) return null;
    if (Number(part) > 255) return null;
  }
  return { address: s };
}

function parseIPv6(raw) {
  const s = String(raw).trim();
  if (!s.includes(":") || s.length > 64) return null;
  if (!/^[0-9A-Fa-f:.]+$/.test(s)) return null;
  try {
    const u = new URL(`http://[${s}]/`);
    if (!u.hostname.startsWith("[")) return null;
  } catch {
    return null;
  }
  return { address: s };
}

function parseMagnet(raw) {
  const s = String(raw).trim();
  if (!/^magnet:\?/i.test(s)) return null;
  let params;
  try { params = new URLSearchParams(s.slice(s.indexOf("?") + 1)); } catch { return null; }
  const xts = params.getAll("xt");
  const btih = xts.map((x) => /^urn:btih:([A-Za-z0-9]+)$/i.exec(x)).find(Boolean);
  return {
    xts,
    btih: btih ? btih[1] : "",
    dn: params.get("dn") || "",
    trackers: params.getAll("tr"),
  };
}

function magnetResult(raw, m, t) {
  return {
    kind: "magnet",
    label: t.magnet,
    fields: {
      raw, xt: m.xts[0] || "", xts: m.xts, btih: m.btih, dn: m.dn,
      trackers: m.trackers, length: raw.length,
    },
    actions: [copyAction("copy", t.copy, raw, { field: "raw" })],
  };
}

function parseTel(raw) {
  let s = String(raw).trim();
  const isScheme = /^tel:/i.test(s);
  if (isScheme) s = s.slice(4).split("?")[0];
  s = stripWrappers(s);
  if (!s || s.length > 40) return null;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(s)) return null;
  if (!/^[+()\d\s.\-/]+$/.test(s)) return null;
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(s)) return null;
  if (/^\d{1,2}[-/.]\d{1,2}[-/.](?:19|20)\d{2}$/.test(s)) return null;
  const hasPlus = s.startsWith("+");
  const hasSep = /[\s().\-/]/.test(s);
  const cnMobile = /^1[3-9]\d{9}$/.test(digits);
  const service = /^[48]00\d{7}$/.test(digits);
  if (!isScheme && !hasPlus && !hasSep && !cnMobile && !service) return null;
  const normalized = (hasPlus ? "+" : "") + digits;
  return { tel: s, normalized };
}

function telResult(raw, p, t) {
  return {
    kind: "tel",
    label: t.tel,
    fields: { raw, tel: p.tel, normalized: p.normalized, digits: p.normalized.replace(/\D/g, ""), length: raw.length },
    actions: [
      copyAction("copy-tel", t.copyTel, p.normalized, { field: "tel", raw: p.tel }),
      copyAction("copy", t.copy, raw, { field: "raw" }),
    ],
  };
}

function passwordInJson(value, path = "$", depth = 0) {
  if (!value || typeof value !== "object" || depth > 6) return null;
  if (Array.isArray(value)) {
    const n = Math.min(value.length, 50);
    for (let i = 0; i < n; i++) {
      const hit = passwordInJson(value[i], `${path}[${i}]`, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [key, val] of Object.entries(value)) {
    if (/^(?:password|passwd|pwd|pass|passphrase)$/i.test(key) && typeof val === "string" && val) {
      return { text: val, path: `${path}.${key}`, key };
    }
    if (val && typeof val === "object") {
      const hit = passwordInJson(val, `${path}.${key}`, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function jsonResult(raw, value, t) {
  const fields = {
    raw,
    value,
    pretty: JSON.stringify(value, null, 2),
    type: Array.isArray(value) ? "array" : "object",
    keys: Array.isArray(value) ? value.map((_, i) => String(i)) : Object.keys(value).slice(0, 200),
    length: raw.length,
  };
  const actions = [];
  const pw = passwordInJson(value);
  if (pw) {
    fields.password = pw.text;
    fields.passwordPath = pw.path;
    actions.push(copyAction("copy-password", t.copyPassword, pw.text, {
      field: "password", path: pw.path, sensitive: true,
    }));
  }
  actions.push(copyAction("copy", t.copy, raw, { field: "raw" }));
  return { kind: "json", label: t.json, fields, actions };
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP = (() => {
  const table = new Uint8Array(256).fill(255);
  for (let i = 0; i < B64_ALPHABET.length; i++) table[B64_ALPHABET.charCodeAt(i)] = i;
  return table;
})();

function decodeBase64Bytes(input) {
  let s = String(input).replace(/[\s\r\n]+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  let pad = 0;
  while (s.endsWith("=") && pad < 2) { s = s.slice(0, -1); pad++; }
  if (!s) return { ok: false, reason: "empty" };
  if (s.length % 4 === 1) return { ok: false, reason: "bad-length" };
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const v = code < 256 ? B64_LOOKUP[code] : 255;
    if (v === 255) return { ok: false, reason: "bad-char" };
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buf >> bits) & 255;
    }
  }
  return { ok: true, bytes: out.subarray(0, o) };
}

function decodeUtf8Text(bytes) {
  if (typeof TextDecoder !== "function") return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return null; }
}

function looksLikeText(s) {
  if (!s) return false;
  let bad = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp === 9 || cp === 10 || cp === 13) continue;
    if (cp < 32 || cp === 127 || cp === 0xfffd) bad++;
  }
  return bad / s.length < 0.02;
}

function sniffMagic(bytes) {
  const b = bytes;
  const has = (...seq) => seq.every((v, i) => b[i] === v);
  if (has(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (has(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (has(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (has(0x50, 0x4b, 0x03, 0x04) || has(0x50, 0x4b, 0x05, 0x06)) return "application/zip";
  if (has(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  if (has(0x1f, 0x8b)) return "application/gzip";
  if (has(0x7f, 0x45, 0x4c, 0x46)) return "application/x-elf";
  if (has(0x52, 0x61, 0x72, 0x21)) return "application/vnd.rar";
  if (has(0x37, 0x7a, 0xbc, 0xaf)) return "application/x-7z-compressed";
  return "";
}

function tryBase64(raw) {
  const compact = String(raw).replace(/\s+/g, "");
  if (compact.length < 16 || compact.length > 4_000_000) return null;
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) return null;
  const hasStd = /[+/]/.test(compact);
  const hasUrl = /[-_]/.test(compact);
  if (hasStd && hasUrl) return null;
  if (!hasStd && !hasUrl && !compact.includes("=")) {
    if (!/[0-9]/.test(compact) || !/[A-Z]/.test(compact) || !/[a-z]/.test(compact)) return null;
  }
  const decoded = decodeBase64Bytes(compact);
  if (!decoded.ok || decoded.bytes.length < 6) return null;
  const text = decodeUtf8Text(decoded.bytes);
  const textOk = text !== null && looksLikeText(text);
  const mime = sniffMagic(decoded.bytes);
  if (!textOk && !mime) return null;
  return { bytes: decoded.bytes, text, textOk, mime, urlSafe: hasUrl };
}

function base64Result(raw, b, t) {
  const displayText = b.textOk ? b.text : "";
  const flags = displayText ? collectFlags(displayText) : [];
  const fields = {
    raw,
    decodedBytes: b.bytes.length,
    mimeGuess: b.mime,
    urlSafe: b.urlSafe,
    decodedText: displayText.slice(0, 10_000),
    decodedTextTruncated: displayText.length > 10_000,
    decodedPreview: displayText.slice(0, 400),
    looksLikeFlag: flags.length > 0,
    length: raw.length,
  };
  const actions = [];
  if (displayText) {
    actions.push(copyAction("copy-decoded", t.copyDecoded, displayText, { field: "decoded" }));
  }
  actions.push(copyAction("copy", t.copy, raw, { field: "raw" }));
  return { kind: "base64", label: t.base64, fields, actions };
}

const FLAG_KEYWORD_RE = /[A-Za-z0-9_]*(?:flag|ctf|key|secret|answer|token)[A-Za-z0-9_-]*\{[^{}\r\n]{1,256}\}/gi;
const FLAG_UPPER_RE = /\b[A-Z][A-Za-z0-9_]{1,31}\{[^{}\r\n]{1,256}\}/g;

function collectFlags(text) {
  const out = [];
  for (const re of [FLAG_KEYWORD_RE, FLAG_UPPER_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null && out.length < MAX_FLAGS) {
      const flag = m[0];
      if (!out.includes(flag)) out.push(flag);
    }
  }
  return out;
}

function flagResult(raw, flags, t) {
  return {
    kind: "flag",
    label: t.flag,
    fields: { raw, flag: flags[0], flags, count: flags.length, length: raw.length },
    actions: [copyAction("copy", t.copy, raw, { field: "raw" })],
  };
}

function b64urlToJson(seg) {
  const decoded = decodeBase64Bytes(seg);
  if (!decoded.ok) return null;
  const text = decodeUtf8Text(decoded.bytes);
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function tryJwt(raw) {
  const s = String(raw).trim();
  if (s.length < 16 || s.length > 32_768) return null;
  const parts = s.split(".");
  if (parts.length !== 3 || parts.some((p) => !p)) return null;
  if (!parts.every((p) => /^[A-Za-z0-9_-]+={0,2}$/.test(p))) return null;
  const header = b64urlToJson(parts[0]);
  const payload = b64urlToJson(parts[1]);
  if (!header || typeof header.alg !== "string" || !header.alg) return null;
  if (!payload) return null;
  const exp = Number(payload.exp);
  const expiresAt = Number.isFinite(exp) ? exp : null;
  return {
    header,
    payload,
    signature: parts[2],
    alg: header.alg,
    typ: typeof header.typ === "string" ? header.typ : "",
    expiresAt,
    expired: expiresAt !== null && expiresAt * 1000 <= Date.now(),
  };
}

function jwtResult(raw, j, t) {
  return {
    kind: "jwt",
    label: t.jwt,
    fields: {
      raw,
      header: j.header,
      payload: j.payload,
      signature: j.signature,
      alg: j.alg,
      typ: j.typ,
      expiresAt: j.expiresAt,
      expired: j.expired,
      length: raw.length,
    },
    actions: [copyAction("copy", t.copy, raw, { field: "raw" })],
  };
}

function ipResult(raw, version, ip, t) {
  return {
    kind: version === 4 ? "ipv4" : "ipv6",
    label: version === 4 ? t.ipv4 : t.ipv6,
    fields: { raw, address: ip.address, version, length: raw.length },
    actions: [copyAction("copy", t.copy, raw, { field: "raw" })],
  };
}

function textResult(raw, t, note) {
  const fields = { raw, length: raw.length };
  if (note) fields.note = note;
  return { kind: "text", label: t.text, fields, actions: [copyAction("copy", t.copy, raw, { field: "raw" })] };
}

/**
 * 识别单条结果文本并给出动作计划。
 * @param {string} text
 * @param {{locale?:string, upgradeHttps?:boolean}} [options]
 */
export function classifyResult(text, options = {}) {
  const raw = String(text == null ? "" : text);
  const locale = normalizeLocale(options.locale);
  const t = LABELS[locale];
  const trimmed = raw.trim();

  if (!trimmed) {
    return { kind: "text", label: t.text, fields: { raw, length: 0 }, actions: [] };
  }
  if (trimmed.length > MAX_SCAN) {
    return textResult(raw, t, "too-large");
  }

  if (/^WIFI:/i.test(trimmed)) return wifiResult(raw, parseWifi(trimmed), t);

  if (/^BEGIN:VCARD/i.test(trimmed)) return vcardResult(raw, parseVCard(trimmed), t);

  if (/^geo:/i.test(trimmed)) {
    const g = parseGeo(trimmed);
    if (g) return geoResult(raw, g, t);
  }

  if (/^magnet:\?/i.test(trimmed)) {
    const m = parseMagnet(trimmed);
    if (m) return magnetResult(raw, m, t);
  }

  const email = parseEmail(trimmed);
  if (email) return emailResult(raw, email, t);

  const url = sanitizeOpenUrl(trimmed, { upgradeHttps: options.upgradeHttps !== false });
  if (url.ok) return urlResult(raw, url, t);

  const jwt = tryJwt(trimmed);
  if (jwt) return jwtResult(raw, jwt, t);

  if (/^[[{]/.test(trimmed)) {
    try {
      const value = JSON.parse(trimmed);
      if (value && typeof value === "object") return jsonResult(raw, value, t);
    } catch { /* not JSON */ }
  }

  const flags = collectFlags(trimmed);
  if (flags.length) return flagResult(raw, flags, t);

  const v4 = parseIPv4(trimmed);
  if (v4) return ipResult(raw, 4, v4, t);

  const v6 = parseIPv6(trimmed);
  if (v6) return ipResult(raw, 6, v6, t);

  const tel = parseTel(trimmed);
  if (tel) return telResult(raw, tel, t);

  const b64 = tryBase64(trimmed);
  if (b64) return base64Result(raw, b64, t);

  return textResult(raw, t);
}

function redactValue(value, depth = 0) {
  if (depth > 8) return "[depth]";
  if (Array.isArray(value)) return value.map((v) => redactValue(v, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = /^(?:password|passwd|pwd|pass|passphrase|secret|tokenValue)$/i.test(key)
        ? "***"
        : redactValue(val, depth + 1);
    }
    return out;
  }
  return value;
}

/** 供日志/诊断使用的脱敏副本：口令字段、原文中的口令、口令 copy 动作一律替换。 */
export function redactResult(result) {
  if (!result || typeof result !== "object") return result;
  const clone = {
    ...result,
    fields: { ...(result.fields || {}) },
    actions: Array.isArray(result.actions)
      ? result.actions.map((a) => ({ ...a, payload: { ...(a.payload || {}) } }))
      : [],
  };

  const secrets = [];
  for (const key of ["password", "secret", "tokenValue"]) {
    if (clone.fields[key] != null) secrets.push(String(clone.fields[key]));
  }
  for (const a of clone.actions) {
    if (a && a.payload && typeof a.payload.text === "string" && a.payload.sensitive) {
      secrets.push(a.payload.text);
    }
  }
  const unique = [...new Set(secrets.filter(Boolean))];
  const variants = [];
  for (const sec of unique) {
    variants.push(sec);
    try {
      const enc = encodeURIComponent(sec);
      if (enc !== sec) variants.push(enc);
    } catch { /* keep raw only */ }
  }
  const hasShortSecret = unique.some((sec) => sec.length < 3);
  const redactText = (value) => {
    const s = String(value == null ? "" : value);
    if (!unique.length) return value;
    if (hasShortSecret) return unique.some((sec) => s.includes(sec)) ? "***" : s;
    let out = s;
    for (const v of variants) out = out.split(v).join("***");
    return out;
  };

  for (const key of ["password", "secret", "tokenValue"]) {
    if (clone.fields[key] != null) clone.fields[key] = "***";
  }
  for (const key of ["raw", "pretty", "decodedText"]) {
    if (typeof clone.fields[key] === "string") clone.fields[key] = redactText(clone.fields[key]);
  }
  if (clone.fields.value && typeof clone.fields.value === "object") {
    clone.fields.value = redactValue(clone.fields.value);
  }
  for (const a of clone.actions) {
    if (!a || !a.payload) continue;
    if (typeof a.payload.text === "string") a.payload.text = redactText(a.payload.text);
  }
  return clone;
}

export default {
  RESULT_KINDS,
  ACTION_IDS,
  classifyResult,
  sanitizeOpenUrl,
  redactResult,
};
