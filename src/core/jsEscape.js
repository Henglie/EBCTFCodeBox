/*
 * jsEscape.js — JavaScript escape()/unescape() 编码（cat:'text'）。
 *
 * 对齐旧版 JS 全局函数 escape()/unescape()（RFC 2396 之前的老式 URL 编码）：
 * - ASCII 字母数字与 @ * _ + - . / 不编码
 * - 其他 ASCII → %XX（大写 hex）
 * - 非 ASCII（中文/emoji）→ %uXXXX（按 UTF-16 code unit）
 *
 * 与 encodeURI / encodeURIComponent 语义不同（那些用 UTF-8 字节）。CTF 偶考老式 escape 编码。
 * 注：escape/unescape 在浏览器与 Worker 均为全局函数（ES 规范已废弃但仍受支持）；
 * 本 op 不用它们而是自实现，保证行为一致且无环境依赖。
 *
 * 红线：算法层零 UI 依赖（仅 registry）；零外发纯本地；件内自注册。
 * 契约：register({ id:"jsEscape", cat:"text", name, desc, encode, decode })。
 */
import { register } from "./registry.js";

function jsStringEscape(text, p = {}) {
  const level = p.level || "Special chars";
  const quote = p.quote || "Single";
  const json = !!p.jsonCompatible;
  const es6 = p.es6Compatible !== false;
  const qch = quote === "Double" ? '"' : quote === "Backtick" ? "`" : "'";
  let out = "";
  for (const ch of String(text == null ? "" : text)) {
    const cp = ch.codePointAt(0);
    if (ch === "\\") { out += "\\\\"; continue; }
    if (ch === qch) { out += "\\" + qch; continue; }
    if (ch === "\n") { out += "\\n"; continue; }
    if (ch === "\r") { out += "\\r"; continue; }
    if (ch === "\t") { out += "\\t"; continue; }
    if (ch === "\b") { out += "\\b"; continue; }
    if (ch === "\f") { out += "\\f"; continue; }
    if (ch === "\v") { out += "\\v"; continue; }
    if (level === "Minimal") { out += ch; continue; }
    if (level === "Everything" || (json && cp > 0x7e)) {
      if (cp < 0x100) out += "\\x" + cp.toString(16).toUpperCase().padStart(2, "0");
      else if (cp <= 0xffff || !es6) out += "\\u" + cp.toString(16).toUpperCase().padStart(4, "0");
      else out += "\\u{" + cp.toString(16).toUpperCase() + "}";
      continue;
    }
    out += ch;
  }
  return out;
}

function parseEscapedCharsJs(str) {
  return String(str).replace(/\\([abfnrtv'"]|[0-3][0-7]{2}|[0-7]{1,2}|x[\da-fA-F]{2}|u[\da-fA-F]{4}|u\{[\da-fA-F]{1,6}\}|\\)/g, (m, a) => {
    switch (a[0]) {
      case "\\": return "\\";
      case "0": case "1": case "2": case "3":
      case "4": case "5": case "6": case "7": return String.fromCharCode(parseInt(a, 8));
      case "a": return String.fromCharCode(7);
      case "b": return "\b"; case "t": return "\t"; case "n": return "\n";
      case "v": return "\v"; case "f": return "\f"; case "r": return "\r";
      case '"': return '"'; case "'": return "'";
      case "x": return String.fromCharCode(parseInt(a.substr(1), 16));
      case "u": return a[1] === "{" ? String.fromCodePoint(parseInt(a.slice(2, -1), 16)) : String.fromCharCode(parseInt(a.substr(1), 16));
      default: return m;
    }
  });
}
function jsStringUnescape(text) { return parseEscapedCharsJs(String(text == null ? "" : text)); }

// 不编码的 ASCII 集合：字母数字 + @ * _ + - . /
function isSafe(ch) {
  return /[A-Za-z0-9@*_+\-./]/.test(ch);
}

function jsEscapeEncode(text) {
  const s = String(text || "");
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code < 128) {
      out += isSafe(ch) ? ch : "%" + code.toString(16).toUpperCase().padStart(2, "0");
    } else {
      // 非 ASCII → %uXXXX（UTF-16 code unit；代理对拆两个）
      for (const u of ch.split("")) {
        const c = u.charCodeAt(0);
        out += "%u" + c.toString(16).toUpperCase().padStart(4, "0");
      }
    }
  }
  return out;
}

function jsEscapeDecode(text) {
  const s = String(text || "");
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "%") {
      const next = s.slice(i + 1, i + 6);
      if (next.startsWith("u") && /^u[0-9a-fA-F]{4}$/.test(next)) {
        out += String.fromCharCode(parseInt(next.slice(1), 16));
        i += 6;
        continue;
      }
      if (/^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) {
        out += String.fromCharCode(parseInt(s.slice(i + 1, i + 3), 16));
        i += 3;
        continue;
      }
      out += "%"; i++;
    } else {
      out += s[i]; i++;
    }
  }
  return out;
}

register({
  id: "jsEscape",
  cat: "text",
  name: "JS escape 编码",
  desc: "旧版 JavaScript escape()/unescape() 编码；mode=string 时切换为 CyberChef Escape/Unescape string（level/quote/json/es6）",
  params: [
    { key: "mode", label: "模式", type: "select", default: "legacy", options: [
      { value: "legacy", label: "旧版 escape()/unescape()（原有模式）" },
      { value: "string", label: "CyberChef Escape/Unescape string" },
    ] },
    { key: "level", label: "Escape level", type: "select", default: "Special chars", options: [
      { value: "Special chars", label: "Special chars" },
      { value: "Everything", label: "Everything" },
      { value: "Minimal", label: "Minimal" },
    ] },
    { key: "quote", label: "Escape quote", type: "select", default: "Single", options: ["Single", "Double", "Backtick"] },
    { key: "jsonCompatible", label: "JSON compatible", type: "bool", default: false },
    { key: "es6Compatible", label: "ES6 compatible", type: "bool", default: true },
  ],
  encode: (t, p) => (p && p.mode === "string" ? jsStringEscape(t, p) : jsEscapeEncode(t)),
  decode: (t, p) => (p && p.mode === "string" ? jsStringUnescape(t) : jsEscapeDecode(t)),
});

export { jsEscapeEncode, jsEscapeDecode, jsStringEscape, jsStringUnescape };
