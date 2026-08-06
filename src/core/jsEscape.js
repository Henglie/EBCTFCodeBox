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
  desc: "旧版 JavaScript escape()/unescape() 编码：ASCII 字母数字与 @*_+-./ 不编码，其他 ASCII → %XX，非 ASCII → %uXXXX（UTF-16 code unit）。与 encodeURI/encodeURIComponent 语义不同，CTF 偶考老式 escape 题",
  encode: jsEscapeEncode,
  decode: jsEscapeDecode,
});

export { jsEscapeEncode, jsEscapeDecode };
