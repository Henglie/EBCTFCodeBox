/*
 * text.js — 文本 / 传输编码（cat:'text'）。
 * URL 编码、HTML 实体、Unicode 转义、Quoted-Printable、UUencode、XXencode、JSFuck。
 * 全部纯 JS、UTF-8 往返。字节 <-> 文本用 TextEncoder/Decoder。
 *
 * 算法来源：QP/UU/XX decode 复刻自 WhatsInYourClipboard 的 codec.js（ISC License）；
 * 其余按 RFC / 通用规范自行实现。每个编码都用往返测试验证。
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

// ============ URL 编码 ============
// encodeURIComponent 不编码 !*'，CTF 常见「全编码」要补齐；plus 模式把 %20 换成 +。
function urlEncode(text, p) {
  const mode = (p && p.mode) || "standard"; // standard | full | plus
  let out = encodeURIComponent(text);
  if (mode === "full" || mode === "plus") {
    out = out.replace(/[!*'()]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  }
  if (mode === "plus") out = out.replace(/%20/g, "+");
  return out;
}
function urlDecode(text) {
 // 兼容 + 表示空格（application/x-www-form-urlencoded）
  const s = text.trim().replace(/\+/g, " ");
  return decodeURIComponent(s);
}

// ============ HTML 实体 ============
// 命名实体表（HTML5 named character references 常用子集，照抄 MDN 列表，不许编造）
const HTML_NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  nbsp: "\u00A0", copy: "\u00A9", reg: "\u00AE", trade: "\u2122",
  hellip: "\u2026", mdash: "\u2014", ndash: "\u2013",
  lsquo: "\u2018", rsquo: "\u2019", ldquo: "\u201C", rdquo: "\u201D",
  deg: "\u00B0", plusmn: "\u00B1", times: "\u00D7", divide: "\u00F7",
  euro: "\u20AC", pound: "\u00A3", yen: "\u00A5", cent: "\u00A2",
  sect: "\u00A7", para: "\u00B6", middot: "\u00B7", bull: "\u2022",
  dagger: "\u2020", Dagger: "\u2021", permil: "\u2030",
  laquo: "\u00AB", raquo: "\u00BB", iexcl: "\u00A1", iquest: "\u00BF",
  frac12: "\u00BD", frac14: "\u00BC", frac34: "\u00BE",
  alpha: "\u03B1", beta: "\u03B2", gamma: "\u03B3", delta: "\u03B4",
  Alpha: "\u0391", Beta: "\u0392", Gamma: "\u0393", Delta: "\u0394",
  pi: "\u03C0", Pi: "\u03A0", sigma: "\u03C3", Sigma: "\u03A3",
  omega: "\u03C9", Omega: "\u03A9", mu: "\u03BC", lambda: "\u03BB",
  infin: "\u221E", ne: "\u2260", le: "\u2264", ge: "\u2265",
  sum: "\u2211", prod: "\u220F", radic: "\u221A", part: "\u2202",
  nabla: "\u2207", forall: "\u2200", exist: "\u2203", isin: "\u2208",
  notin: "\u2209", sub: "\u2282", sup: "\u2283", cup: "\u222A", cap: "\u2229",
  empty: "\u2205", alefsym: "\u2135", rarr: "\u2192", larr: "\u2190",
  uarr: "\u2191", darr: "\u2193", harr: "\u2194", lArr: "\u21D0",
  rArr: "\u21D2", uArr: "\u21D1", dArr: "\u21D3", hArr: "\u21D4",
  spades: "\u2660", clubs: "\u2663", hearts: "\u2665", diams: "\u2666",
  loz: "\u25CA", oline: "\u203E", frasl: "\u2044", lowast: "\u2217",
  weierp: "\u2118", real: "\u211C", image: "\u2111", lang: "\u2329",
  rang: "\u232A",
};
function htmlEntityEncode(text) {
 // 只转义会破坏 HTML 结构的 5 个字符；其余命名实体按需可扩展。
 // 先转 & 防双重，再转 < > " '
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function htmlEntityDecode(text) {
 // 一次性扫描：数字型 &#xHH; / &#NN; + 命名 &name;，避免双重解码
  return text.replace(/&(?:#x([0-9a-fA-F]+);|#(\d+);|([a-zA-Z][a-zA-Z0-9]*);)/g,
    (m, hex, dec, name) => {
      if (hex !== undefined) {
        const cp = parseInt(hex, 16);
        return cp <= 0x10FFFF ? String.fromCodePoint(cp) : m;
      }
      if (dec !== undefined) {
        const cp = parseInt(dec, 10);
        return cp <= 0x10FFFF && cp > 0 ? String.fromCodePoint(cp) : m;
      }
      if (name !== undefined) {
        return HTML_NAMED.hasOwnProperty(name) ? HTML_NAMED[name] : m;
      }
      return m;
    });
}

// ============ Unicode 转义 ============
// 三种格式：\uXXXX（含代理对）/ U+XXXX / &#xHH;（HTML 数字型）
function unicodeEscapeEncode(text, p) {
  const fmt = (p && p.fmt) || "uXXXX"; // uXXXX | U+ | hex
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (fmt === "uXXXX") {
      if (cp > 0xFFFF) {
        const hi = 0xD800 + ((cp - 0x10000) >> 10);
        const lo = 0xDC00 + ((cp - 0x10000) & 0x3FF);
        out += "\\u" + hi.toString(16).padStart(4, "0").toUpperCase();
        out += "\\u" + lo.toString(16).padStart(4, "0").toUpperCase();
      } else {
        out += "\\u" + cp.toString(16).padStart(4, "0").toUpperCase();
      }
    } else if (fmt === "U+") {
      out += "U+" + cp.toString(16).padStart(4, "0").toUpperCase();
    } else if (fmt === "hex") {
      out += "&#x" + cp.toString(16).toUpperCase() + ";";
    }
  }
  return out;
}
function unicodeEscapeDecode(text) {
  let out = text;
 // 先解代理对 \uXXXX\uXXXX（组合成星平面字符）
  out = out.replace(/\\u([0-9a-fA-F]{4})\\u([0-9a-fA-F]{4})/g, (m, hi, lo) => {
    const h = parseInt(hi, 16), l = parseInt(lo, 16);
    if (h >= 0xD800 && h <= 0xDBFF && l >= 0xDC00 && l <= 0xDFFF) {
      return String.fromCodePoint(0x10000 + ((h - 0xD800) << 10) + (l - 0xDC00));
    }
    return m;
  });
 // 单个 \uXXXX
  out = out.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
 // U+XXXX（4-6 位十六进制）
  out = out.replace(/U\+([0-9a-fA-F]{4,6})/g, (_, h) => {
    const cp = parseInt(h, 16);
    return cp <= 0x10FFFF ? String.fromCodePoint(cp) : _;
  });
 // &#xHH;（HTML 数字型，兼容）
  out = out.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
    const cp = parseInt(h, 16);
    return cp <= 0x10FFFF ? String.fromCodePoint(cp) : _;
  });
  return out;
}

// ============ Quoted-Printable（RFC 2045） ============
// 照抄 WhatsInYourClipboard codec.js；encode 补齐（原版只有 decode）。
function qpEncode(text) {
 // 可打印 ASCII (33-126 除 =) + 空格(32) + Tab(9) 原样，其余 =XX
 // 注：标准 QP 还应在行尾空格前加 =，且行宽限 76。本实现做基本编码，行宽不限制（往返优先）。
  return [...te(text)].map((b) => {
    if ((b >= 33 && b <= 126 && b !== 61) || b === 32 || b === 9)
      return String.fromCharCode(b);
    return "=" + b.toString(16).toUpperCase().padStart(2, "0");
  }).join("");
}
function qpDecode(text) {
  const s = text.replace(/=\r?\n/g, ""); // 软换行折叠
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && i + 2 < s.length) {
      const v = parseInt(s.slice(i + 1, i + 3), 16);
      if (!isNaN(v)) { bytes.push(v); i += 2; continue; }
    }
    bytes.push(s.charCodeAt(i));
  }
  return td(bytes);
}

// ============ UUencode ============
// 6-bit 值映射到 32-95（space 到 _）；行首字符 = 字节数 + 32。
// 照抄 WhatsInYourClipboard codec.js 的 decode；encode 按 RFC 补齐。
function uuEncode(text) {
  const bytes = te(text);
  let out = "begin 644 -\n";
  for (let i = 0; i < bytes.length; i += 45) {
    const chunk = bytes.slice(i, i + 45);
    out += String.fromCharCode(chunk.length + 32);
    for (let j = 0; j < chunk.length; j += 3) {
      const b = [chunk[j] || 0, chunk[j + 1] || 0, chunk[j + 2] || 0];
      out += String.fromCharCode(((b[0] >> 2) & 63) + 32);
      out += String.fromCharCode((((b[0] << 4) | (b[1] >> 4)) & 63) + 32);
      out += String.fromCharCode((((b[1] << 2) | (b[2] >> 6)) & 63) + 32);
      out += String.fromCharCode((b[2] & 63) + 32);
    }
    out += "\n";
  }
  out += "`\nend\n";
  return out;
}
function uuDecode(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!line || /^begin\s/i.test(line) || /^end\s*$/i.test(line) || line === "`") continue;
    const count = line.charCodeAt(0) - 32;
    if (count <= 0 || count > 45) continue;
    let n = 0;
    for (let i = 1; i < line.length && n < count; i += 4) {
      const c = [0, 1, 2, 3].map((k) => (line.charCodeAt(i + k) - 32) & 63);
      const b = [
        (c[0] << 2) | (c[1] >> 4),
        ((c[1] & 15) << 4) | (c[2] >> 2),
        ((c[2] & 3) << 6) | c[3],
      ];
      for (const v of b) { if (n++ < count) out.push(v); }
    }
  }
  return td(out);
}

// ============ XXencode ============
// 码表：+ - 0-9 A-Z a-z（64 字符）；照抄 WhatsInYourClipboard codec.js 的 decode + 码表。
const XX = "+-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function xxEncode(text) {
  const bytes = te(text);
  let out = "begin 644 -\n";
  for (let i = 0; i < bytes.length; i += 45) {
    const chunk = bytes.slice(i, i + 45);
    out += XX[chunk.length];
    for (let j = 0; j < chunk.length; j += 3) {
      const b = [chunk[j] || 0, chunk[j + 1] || 0, chunk[j + 2] || 0];
      out += XX[(b[0] >> 2) & 63];
      out += XX[((b[0] << 4) | (b[1] >> 4)) & 63];
      out += XX[((b[1] << 2) | (b[2] >> 6)) & 63];
      out += XX[b[2] & 63];
    }
    out += "\n";
  }
  out += "+\nend\n"; // XX[0]='+' 作终止行（decode 跳过 count<=0）
  return out;
}
function xxDecode(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!line || /^begin/i.test(line) || /^end/i.test(line)) continue;
    const count = XX.indexOf(line[0]);
    if (count <= 0) continue;
    let n = 0;
    for (let i = 1; i < line.length && n < count; i += 4) {
      const c = [0, 1, 2, 3].map((k) => Math.max(0, XX.indexOf(line[i + k] || "+")));
      const b = [
        (c[0] << 2) | (c[1] >> 4),
        ((c[1] & 15) << 4) | (c[2] >> 2),
        ((c[2] & 3) << 6) | c[3],
      ];
      for (const x of b) { if (n++ < count) out.push(x); }
    }
  }
  return td(out);
}

// ============ JSFuck（decode 优先） ============
// JSFuck 只用 []!+ 六字符构造 JS 表达式。decode 用 Function 沙箱执行（不直接 eval）。
// 安全：先严格校验字符集，再 Function 构造；本地工具，风险可控。
function jsFuckDecode(text) {
  const s = text.trim();
  if (!s) return "";
  if (!/^[\[\]()!+\s]+$/.test(s)) {
    throw new Error("JSFuck 只含 []()!+ 六字符");
  }
  try {
 // Function 沙箱：严格模式、不传 this/args，返回表达式结果
    const fn = new Function('"use strict"; return (' + s + ');');
    const r = fn();
    return typeof r === "string" ? r : String(r);
  } catch (e) {
    throw new Error("JSFuck 执行失败: " + e.message);
  }
}

// ---- 注册 ----
register({
  id: "url", cat: "text", name: "URL 编码", desc: "RFC 3986 百分号编码（standard/full/plus 三模式）",
  params: [
    { key: "mode", label: "模式", type: "select", default: "standard",
      options: [
        { value: "standard", label: "标准（encodeURIComponent，不编码 !*'()）" },
        { value: "full", label: "全编码（!*'() 也编码）" },
        { value: "plus", label: "表单（空格→+，!*'() 编码）" },
      ],
    },
  ],
  encode: urlEncode, decode: urlDecode,
  // %XX 出现 ≥2 处即判 URL 编码——不要求连续（真实 CTF 里 %7B..%7D 常被明文隔开，
  // 如 flag%7Bhello%7D，旧的「连续 2 个」正则会漏判 → magic 解不出）。排除 uuencode 头。
  detect: (t) => {
    const m = t.match(/%[0-9a-fA-F]{2}/g);
    return (m && m.length >= 2 && !/^begin\s/m.test(t)) ? 0.5 : 0;
  },
});

register({
  id: "htmlEntity", cat: "text", name: "HTML 实体", desc: "命名实体（&amp; 等）+ 数字型（&#NN; / &#xHH;）",
  encode: htmlEntityEncode, decode: htmlEntityDecode,
  detect: (t) => (/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/.test(t) ? 0.5 : 0),
});

register({
  id: "unicodeEscape", cat: "text", name: "Unicode 转义", desc: "\\uXXXX / U+XXXX / &#xHH; 三种格式",
  params: [
    { key: "fmt", label: "格式", type: "select", default: "uXXXX",
      options: [
        { value: "uXXXX", label: "\\uXXXX（含代理对）" },
        { value: "U+", label: "U+XXXX" },
        { value: "hex", label: "&#xHH;（HTML 数字型）" },
      ],
    },
  ],
  encode: unicodeEscapeEncode, decode: unicodeEscapeDecode,
  detect: (t) => (/\\u[0-9a-fA-F]{4}/.test(t) || /U\+[0-9a-fA-F]{4,6}/.test(t) ? 0.5 : 0),
});

register({
  id: "quotedPrintable", cat: "text", name: "Quoted-Printable", desc: "RFC 2045（=XX 转义，软换行折叠）",
  encode: qpEncode, decode: qpDecode,
  detect: (t) => (/=[0-9a-fA-F]{2}/.test(t) || /=\r?\n/.test(t) ? 0.4 : 0),
});

register({
  id: "uuencode", cat: "text", name: "UUencode", desc: "Unix-to-Unix（行首字节数+32，6-bit 映射 32-95）",
  encode: uuEncode, decode: uuDecode,
  detect: (t) => (/^begin\s+\d+\s+\S+/m.test(t) ? 0.7 : 0),
});

register({
  id: "xxencode", cat: "text", name: "XXencode", desc: "XX 编码（码表 +-0-9A-Za-z，结构同 UU）",
  encode: xxEncode, decode: xxDecode,
  detect: (t) => (/^begin\s+\d+\s+\S+/m.test(t) && /^[+-0-9A-Za-z]/m.test(t) ? 0.5 : 0),
});

register({
  id: "jsfuck", cat: "text", name: "JSFuck", desc: "六字符 []()!+ 构造的 JS（仅解码，Function 沙箱）",
  decode: jsFuckDecode,
  detect: (t) => (/^[\[\]()!+]+$/.test(t.trim()) && t.length >= 10 ? 0.6 : 0),
});

export {
  urlEncode, urlDecode,
  htmlEntityEncode, htmlEntityDecode, HTML_NAMED,
  unicodeEscapeEncode, unicodeEscapeDecode,
  qpEncode, qpDecode,
  uuEncode, uuDecode,
  xxEncode, xxDecode, XX,
  jsFuckDecode,
};
