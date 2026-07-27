/*
 * netcodecExt.js — 网络编码扩展组（T95，cat:'text' / 'analysis'）。
 *
 * 覆盖：
 * - urlQueryParse URL query 解析（? 后的 k=v&k=v，percent-decode，支持数组同名键）。run 单向。
 * - cookieParse Cookie 解析（Cookie: 请求头 或 Set-Cookie: 响应头，拆键值 + 属性）。run 单向。
 * - httpBasicAuth HTTP Basic 认证：user:pass ↔ base64（encode 正向，decode 反向）。
 * - dataUriParse data URI 解析/构造：data:[<mime>][;base64],<data> ↔ 内容。双向。
 * - magnetParse magnet 链接解析（xt/dn/tr/xl 等参数拆解，btih 提取）。run 单向。
 *
 * 与已有区分：
 * - netcodec.js（T49）已有 ipv4Int/ipv6Format/macFormat/cidrCalc/userAgentParse（IP/MAC/UA 类）。
 * - 本组是应用层 HTTP/URI 文本解析，无 id 冲突。
 *
 * 红线：纯算法无外部依赖；percent-decode 用 decodeURIComponent 容错；base64 用 atob/btoa（浏览器）
 * 或 Buffer（node 测试）双兼容。
 */
import { register } from "./registry.js";

// ============ base64 双环境兼容（浏览器 atob/btoa + node Buffer） ============
function b64encodeBytes(bytes) {
 // bytes: Uint8Array → base64 字符串
  if (typeof btoa === "function") {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }
 // node 回退
  return Buffer.from(bytes).toString("base64");
}
function b64decodeToBytes(str) {
  const s = String(str).replace(/\s+/g, "");
  if (typeof atob === "function") {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(s, "base64"));
}
function strToUtf8Bytes(s) {
  return new TextEncoder().encode(String(s));
}
function utf8BytesToStr(b) {
  return new TextDecoder("utf-8", { fatal: false }).decode(b);
}
function b64encodeStr(s) {
  return b64encodeBytes(strToUtf8Bytes(s));
}
function b64decodeStr(s) {
  return utf8BytesToStr(b64decodeToBytes(s));
}

// ============ 1. URL query 解析 ============
function parseUrlQuery(text) {
  let s = String(text).trim();
  if (!s) throw new Error("空输入");
 // 若是完整 URL，取 ? 之后 # 之前的部分
  const qi = s.indexOf("?");
  if (qi >= 0) s = s.slice(qi + 1);
  const hi = s.indexOf("#");
  if (hi >= 0) s = s.slice(0, hi);
  if (!s) return "(无 query 参数)";
  const pairs = s.split("&");
  const lines = [];
  for (const pair of pairs) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    let k, v;
    if (eq < 0) { k = pair; v = ""; }
    else { k = pair.slice(0, eq); v = pair.slice(eq + 1); }
    let dk, dv;
    try { dk = decodeURIComponent(k.replace(/\+/g, " ")); } catch { dk = k; }
    try { dv = decodeURIComponent(v.replace(/\+/g, " ")); } catch { dv = v; }
    lines.push(dk + " = " + dv);
  }
  return lines.join("\n");
}

// ============ 2. Cookie 解析 ============
function parseCookie(text) {
  let s = String(text).trim();
  if (!s) throw new Error("空输入");
 // 去掉可能的 "Cookie:" / "Set-Cookie:" 头前缀
  s = s.replace(/^set-cookie:\s*/i, "").replace(/^cookie:\s*/i, "");
 // Set-Cookie 用 "; " 分隔，第一个是键值，其余是属性
  const parts = s.split(";").map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return "(无 Cookie)";
  const lines = [];
 // 判定：若首段含 = 且后续段多为属性关键字，按 Set-Cookie 处理；否则按 Cookie 头多键值处理
  const attrKeys = ["expires", "max-age", "domain", "path", "secure", "httponly", "samesite", "priority", "partitioned"];
  const isSetCookie = parts.slice(1).some((p) => {
    const key = p.split("=")[0].trim().toLowerCase();
    return attrKeys.includes(key);
  });
  if (isSetCookie) {
    const first = parts[0];
    const eq = first.indexOf("=");
    const name = eq < 0 ? first : first.slice(0, eq);
    const val = eq < 0 ? "" : first.slice(eq + 1);
    lines.push("Cookie 名:   " + name);
    lines.push("Cookie 值:   " + val);
    if (parts.length > 1) {
      lines.push("--- 属性 ---");
      for (const p of parts.slice(1)) {
        const e = p.indexOf("=");
        if (e < 0) lines.push(p + ": (标志)");
        else lines.push(p.slice(0, e).trim() + ": " + p.slice(e + 1).trim());
      }
    }
  } else {
 // Cookie 请求头：多个 name=value
    for (const p of parts) {
      const e = p.indexOf("=");
      if (e < 0) lines.push(p + " = ");
      else lines.push(p.slice(0, e).trim() + " = " + p.slice(e + 1).trim());
    }
  }
  return lines.join("\n");
}

// ============ 3. HTTP Basic 认证 ============
function basicAuthEncode(text) {
 // 输入 user:pass（或含 "Basic " 前缀的会被处理为原样编码）→ base64
  const s = String(text);
  return "Basic " + b64encodeStr(s);
}
function basicAuthDecode(text) {
 // 输入 "Basic xxxx" 或裸 base64 → user:pass
  let s = String(text).trim();
  s = s.replace(/^basic\s+/i, "");
  return b64decodeStr(s);
}

// ============ 4. data URI 解析/构造 ============
function parseDataUri(text) {
  const s = String(text).trim();
  const m = s.match(/^data:([^,]*),([\s\S]*)$/i);
  if (!m) throw new Error("非法 data URI（需 data:[<mime>][;base64],<data>）");
  const meta = m[1];
  const data = m[2];
  const metaParts = meta.split(";").filter(Boolean);
  let mime = "";
  let isBase64 = false;
  const attrs = [];
  for (const p of metaParts) {
    if (p.toLowerCase() === "base64") isBase64 = true;
    else if (p.includes("=")) attrs.push(p);
    else if (!mime) mime = p;
    else attrs.push(p);
  }
  if (!mime) mime = "text/plain";
  let decoded;
  if (isBase64) {
    try { decoded = b64decodeStr(data); } catch (e) { decoded = "(base64 解码失败: " + (e && e.message) + ")"; }
  } else {
    try { decoded = decodeURIComponent(data); } catch { decoded = data; }
  }
  const lines = [
    "MIME 类型:   " + mime,
    "编码方式:   " + (isBase64 ? "base64" : "URL 编码/明文"),
  ];
  if (attrs.length) lines.push("附加参数:   " + attrs.join("; "));
  lines.push("--- 内容 ---");
  lines.push(decoded);
  return lines.join("\n");
}
function buildDataUri(text, mime, useBase64) {
  mime = mime || "text/plain";
  if (useBase64) {
    return "data:" + mime + ";base64," + b64encodeStr(text);
  }
  return "data:" + mime + "," + encodeURIComponent(text);
}

// ============ 5. magnet 链接解析 ============
function parseMagnet(text) {
  const s = String(text).trim();
  const m = s.match(/^magnet:\?(.*)$/i);
  if (!m) throw new Error("非法 magnet 链接（需 magnet:?...）");
  const query = m[1];
  const pairs = query.split("&").filter(Boolean);
  const labels = {
    xt: "精确主题 (xt)",
    dn: "显示名 (dn)",
    tr: "Tracker (tr)",
    xl: "文件大小 (xl)",
    ws: "Web Seed (ws)",
    as: "备用源 (as)",
    xs: "精确源 (xs)",
    kt: "关键词 (kt)",
    mt: "清单主题 (mt)",
  };
  const lines = [];
  const trackers = [];
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    let k = eq < 0 ? pair : pair.slice(0, eq);
    let v = eq < 0 ? "" : pair.slice(eq + 1);
 // 去掉 tr.1 这类带序号后缀
    const baseKey = k.replace(/\.\d+$/, "");
    let dv;
    try { dv = decodeURIComponent(v.replace(/\+/g, " ")); } catch { dv = v; }
    if (baseKey === "tr") { trackers.push(dv); continue; }
    const label = labels[baseKey] || (baseKey + " 参数");
    lines.push(label + ": " + dv);
 // 从 xt 中提取 btih 哈希
    if (baseKey === "xt") {
      const btih = dv.match(/urn:btih:([0-9a-zA-Z]+)/i);
      if (btih) lines.push("  ↳ BTIH 哈希: " + btih[1]);
    }
  }
  if (trackers.length) {
    lines.push("--- Tracker 列表 (" + trackers.length + ") ---");
    for (const tr of trackers) lines.push("  " + tr);
  }
  if (!lines.length) return "(magnet 无参数)";
  return lines.join("\n");
}

// ============ 注册 op ============

// 1. URL query 解析（run 单向）
register({
  id: "urlQueryParse", cat: "text", name: "URL Query 解析",
  desc: "解析 URL 查询串（? 后的 k=v&k=v），percent-decode + '+' 转空格，逐行列出键值。支持传入完整 URL。",
  params: [],
  run: (t) => parseUrlQuery(t),
  detect: (t) => (/[?&][^=&\s]+=[^&\s]*/.test(String(t)) ? 0.3 : 0),
});

// 2. Cookie 解析（run 单向）
register({
  id: "cookieParse", cat: "text", name: "Cookie 解析",
  desc: "解析 Cookie 请求头（多 name=value）或 Set-Cookie 响应头（键值 + 属性）。自动去 Cookie:/Set-Cookie: 前缀。",
  params: [],
  run: (t) => parseCookie(t),
});

// 3. HTTP Basic 认证（双向）
register({
  id: "httpBasicAuth", cat: "text", name: "HTTP Basic 认证",
  desc: "HTTP Basic 认证：encode 把 user:pass 编码为 'Basic <base64>'；decode 把 'Basic xxx' 或裸 base64 还原为 user:pass。",
  params: [],
  encode: (t) => basicAuthEncode(t),
  decode: (t) => basicAuthDecode(t),
  detect: (t) => (/^basic\s+[A-Za-z0-9+/=]+$/i.test(String(t).trim()) ? 0.4 : 0),
});

// 4. data URI 解析/构造（双向）
register({
  id: "dataUriParse", cat: "text", name: "Data URI 解析",
  desc: "data URI 双向：encode 把文本按所选 MIME + 编码方式构造成 data: URI；decode 解析 data: URI 输出 MIME + 内容。",
  params: [
    { key: "mime", label: "MIME 类型（encode 用）", type: "text", default: "text/plain", placeholder: "text/plain" },
    { key: "base64", label: "用 base64 编码（encode 用）", type: "bool", default: false },
  ],
  encode: (t, p) => buildDataUri(t, (p && p.mime) || "text/plain", !!(p && p.base64)),
  decode: (t) => parseDataUri(t),
  detect: (t) => (/^data:[^,]*,/i.test(String(t).trim()) ? 0.5 : 0),
});

// 5. magnet 链接解析（run 单向）
register({
  id: "magnetParse", cat: "text", name: "Magnet 链接解析",
  desc: "解析 magnet:? 链接：xt 精确主题（提取 BTIH 哈希）、dn 显示名、tr Tracker 列表、xl 文件大小等。",
  params: [],
  run: (t) => parseMagnet(t),
  detect: (t) => (/^magnet:\?/i.test(String(t).trim()) ? 0.6 : 0),
});

export {
  b64encodeStr, b64decodeStr, b64encodeBytes, b64decodeToBytes,
  parseUrlQuery, parseCookie,
  basicAuthEncode, basicAuthDecode,
  parseDataUri, buildDataUri,
  parseMagnet,
};
