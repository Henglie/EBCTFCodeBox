/*
 * base.js — Base 系列编码（base16/32/36/45/58/62/64/85/91/92/100 + 自定义码表 + 任意进制）。
 * 全部纯 JS、UTF-8 往返。字节 <-> 文本用 TextEncoder/Decoder。
 * 注册进 registry，供 UI 与一键解码调用。
 *
 * 算法来源：复刻自 WhatsInYourClipboard 的 codec.js（ISC License，鸣谢 Leon406/ToolsFx 编码清单参考）。
 * 每个编码都用往返测试验证。
 */
import { register } from "./registry.js";
import { finishBytesDecode } from "./bytesIo.js";

// 文本 → UTF-8 字节；已是 Uint8Array 则原样直通（F02：编码族要吃真字节）
const te = (s) => (s instanceof Uint8Array ? s : new TextEncoder().encode(s));
// 注意：解码出口**不再**直接用 td()。td 的 fatal:false 会把非法 UTF-8 静默替换成 U+FFFD
// （例如 PNG 魔数 8950 被毁）。所有 base 家族的 decode 出口统一走 bytesIo.finishBytesDecode：
// 合法 UTF-8 → 原样返回字符串（行为不变）；否则 → 报告「这是二进制」并交回原始字节供下载。
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

// ============ 通用大整数 radixN（用于 base36/58/62 + 任意进制） ============
// 把整段字节视为大整数，按 dict 的基数转换。前导零字节 → 前导首字符。
function radixNEncode(text, dict) {
  const bytes = te(text);
  const radix = BigInt(dict.length);
 // 标准规则：每个前导零字节 → 一个前导 dict[0]，其余字节视为大整数转基
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  const parts = [];
  while (num > 0n) { parts.push(dict[Number(num % radix)]); num /= radix; }
  parts.reverse();
  return dict[0].repeat(zeros) + parts.join("");
}
function radixNDecode(text, dict) {
  const s = text.trim();
  // 分块累积：每 K 位用 Number 攒成小块再一次并入 BigInt（K 取 radix^K ≤ 2^53 的最大值）
  const radixNum = dict.length;
  let K = 1, safe = radixNum;
  while (safe * radixNum <= Number.MAX_SAFE_INTEGER) { safe *= radixNum; K++; }
 // 前导 dict[0] → 前导零字节（一一对应）
  let zeros = 0;
  while (zeros < s.length && s[zeros] === dict[0]) zeros++;
  let num = 0n;
  let acc = 0, cnt = 0;
  for (const ch of s) {
    const idx = dict.indexOf(ch);
    if (idx === -1) throw new Error("非法字符: " + ch);
    acc = acc * radixNum + idx;
    if (++cnt === K) { num = num * BigInt(safe) + BigInt(acc); acc = 0; cnt = 0; }
  }
  if (cnt > 0) { let pw = 1; for (let t = 0; t < cnt; t++) pw *= radixNum; num = num * BigInt(pw) + BigInt(acc); }
  const bytes = [];
  if (num > 0n) {
    // 大端字节直出：toString(16) 对 2 的幂基数为近线性，替代逐字节 &/>> 的 O(n²)
    const hex = num.toString(16);
    bytes.length = (hex.length + 1) >> 1;
    let j = bytes.length - 1;
    for (let off = hex.length - 2; off >= 0; off -= 2, j--) bytes[j] = parseInt(hex.slice(off, off + 2), 16);
    if (hex.length & 1) bytes[0] = parseInt(hex[0], 16);
  }
  return finishBytesDecode([...new Array(zeros).fill(0), ...bytes], { name: "radixN" });
}

// ============ Base16 / Hex ============
const B16 = "0123456789ABCDEF";
const TO_HEX_DELIMS = {
  Space: " ", Percent: "%", Comma: ",", "Semi-colon": ";", Colon: ":",
  LF: "\n", CRLF: "\r\n",
};
function hexEncode(text, p) {
  const D = (p && p.dict) || B16;
  const bytes = te(text);
  const lower = p && p.upper === false;
  // 预分配数组 + join 替代逐字节拼串；小写仅预建一次字典，免逐字符 toLowerCase
  const L = lower ? D.toLowerCase() : D;
  const n = bytes.length;
  const out = new Array(n * 2);
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    out[i * 2] = L[(b >> 4) & 0xf];
    out[i * 2 + 1] = L[b & 0xf];
  }
  let s = out.join("");
  // CyberChef To Hex 同口径：分隔符/每行字节数（默认不启用，保持旧输出）
  const toHexDelim = p && p.encodeDelimiter;
  if (toHexDelim) {
    const lineSize = Math.max(0, Math.floor(Number(p.bytesPerLine) || 0));
    let delim;
    let comma = "";
    if (toHexDelim === "0x with comma") { delim = "0x"; comma = ","; }
    else if (toHexDelim === "None") delim = "";
    else if (toHexDelim === "Line feed") delim = "\n";
    else if (toHexDelim === "CRLF") delim = "\r\n";
    else delim = TO_HEX_DELIMS[toHexDelim];
    if (delim === undefined) throw new Error("未知 To Hex 分隔符: " + toHexDelim);
    const prepend = delim === "0x" || delim === "\\x" || delim === "%";
    const parts = [];
    for (let i = 0; i < bytes.length; i++) {
      const h = (lower ? s.slice(i * 2, i * 2 + 2).toLowerCase() : s.slice(i * 2, i * 2 + 2));
      parts.push((prepend ? delim : "") + h + (prepend ? "" : delim) + comma);
      if (lineSize > 0 && i !== bytes.length - 1 && (i + 1) % lineSize === 0) parts.push("\n");
    }
    let joined = parts.join("");
    if (!prepend && delim.length > 0) joined = joined.slice(0, -delim.length);
    if (comma) joined = joined.slice(0, -comma.length);
    return joined;
  }
  return p && p.space && s ? s.match(/.{1,2}/g).join(" ") : s;
}
const HEX_DELIMS = {
  Space: " ", Percent: "%", Comma: ",", "Semi-colon": ";", Colon: ":",
  LF: "\n", CRLF: "\r\n",
};
function hexCleanByDelimiter(text, p) {
  const delim = (p && p.delimiter) || "Auto";
  const raw = String(text);
  if (delim === "Auto") return raw.replace(/0x/gi, "").replace(/[^0-9a-fA-F]/g, "");
  if (delim === "None") return raw.trim();
  if (delim === "0x") return raw.replace(/0x/gi, "").replace(/\s/g, "");
  if (delim === "0x with comma") return raw.replace(/0x/gi, "").split(",").join("").replace(/\s/g, "");
  if (delim === "\\x") return raw.replace(/\\x/gi, "").replace(/\s/g, "");
  if (!Object.prototype.hasOwnProperty.call(HEX_DELIMS, delim)) {
    throw new Error("base16 delimiter 须为 Auto/Space/Percent/Comma/Semi-colon/Colon/LF/CRLF/0x/0x with comma/\\x/None（实为 " + delim + "）");
  }
  return raw.split(HEX_DELIMS[delim]).join("").replace(/\s/g, "");
}
function hexDecode(text, p) {
  const D = (p && p.dict) || B16;
 // 自定义码表可能含非 hex 字符（G-Z/符号）——此时不能用固定 hex 正则清洗
 // 只去 0x 前缀与空白，按 dict 自身字符集查表。标准码表走原 hex 清洗（容忍夹杂噪声）。
  const isStdHex = D === B16 || /^[0-9a-fA-F]{16}$/.test(D);
  const s = isStdHex
    ? hexCleanByDelimiter(text, p)
    : String(text).replace(/0x/gi, "").replace(/\s/g, "");
  if (s.length % 2) throw new Error("十六进制长度必须为偶数");
  const bytes = [];
  const lookup = isStdHex ? D.toLowerCase() : D;
  for (let i = 0; i < s.length; i += 2) {
    const hi = isStdHex ? lookup.indexOf(s[i].toLowerCase()) : lookup.indexOf(s[i]);
    const lo = isStdHex ? lookup.indexOf(s[i + 1].toLowerCase()) : lookup.indexOf(s[i + 1]);
    if (hi < 0 || lo < 0) throw new Error("非法十六进制字符");
    bytes.push((hi << 4) | lo);
  }
  return finishBytesDecode(bytes, { name: "hex" });
}

// ============ Base32（RFC 4648 / base32hex / Crockford / z-base-32 参数化） ============
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
// 变体表：字母表 + 自然 padding + 解码前大小写/容错归一。
// rfc4648/hex：大写、带 pad；crockford：去 ILOU、容错 O→0 I/L→1、无 pad；
// zbase32：小写、无 pad。字母表照抄规范不编造。
const B32_VARIANTS = {
  rfc4648:   { alphabet: B32, pad: true,  norm: (s) => s.toUpperCase() },
  hex:       { alphabet: "0123456789ABCDEFGHIJKLMNOPQRSTUV", pad: true, norm: (s) => s.toUpperCase() },
  crockford: { alphabet: "0123456789ABCDEFGHJKMNPQRSTVWXYZ", pad: false, norm: (s) => s.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1") },
  zbase32:   { alphabet: "ybndrfg8ejkmcpqxot1uwisza345h769", pad: false, norm: (s) => s.toLowerCase() },
};
function b32Variant(p) {
  return B32_VARIANTS[(p && p.variant) || "rfc4648"] || B32_VARIANTS.rfc4648;
}
function base32Encode(text, p) {
  const v = b32Variant(p);
  const D = (p && p.dict) || v.alphabet;
  const bytes = te(text);
  let bits = 0, val = 0, out = "";
  for (const b of bytes) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) { bits -= 5; out += D[(val >> bits) & 31]; }
  }
  if (bits > 0) out += D[(val << (5 - bits)) & 31];
 // crockford/zbase32 无 padding 概念（v.pad=false，忽略 padding 参数）；
 // rfc4648/hex 受 padding 参数控制（默认 true）。
  const wantPad = (p && p.padding !== undefined) ? p.padding : true;
  if (v.pad && wantPad) { while (out.length % 8 !== 0) out += "="; }
  return out;
}
function base32Decode(text, p) {
  const v = b32Variant(p);
  const hasCustom = !!(p && p.dict);
  const D = hasCustom ? p.dict : v.alphabet;
 // 大小写/容错归一随 variant 分支（不再无条件 toUpperCase）。
 // 自定义码表按原样查（不套变体 norm，否则大小写会被强改致查不到）。
  const stripped = text.replace(/=+$/, "").replace(/\s/g, "");
  const normalized = hasCustom ? stripped : v.norm(stripped);
  const clean = (p && p.removeNonAlphabet)
    ? [...normalized].filter((ch) => D.indexOf(ch) >= 0).join("")
    : normalized;
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = D.indexOf(ch);
    if (idx === -1) throw new Error("非法 Base32 字符: " + ch);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { bits -= 8; out.push((value >> bits) & 0xff); }
  }
  return finishBytesDecode(out, { name: "base32" });
}

// ============ Base36（大整数） ============
const B36 = "0123456789abcdefghijklmnopqrstuvwxyz";
const base36Encode = (t, p) => radixNEncode(t, (p && p.dict) || B36);
const base36Decode = (t, p) => radixNDecode(t, (p && p.dict) || B36);

// ============ Base45（RFC 9285，2 字节 → 3 字符小端） ============
const B45 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
function base45Encode(text, p) {
  const D = (p && p.dict) || B45;
  const bytes = te(text);
  let out = "";
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      let n = bytes[i] * 256 + bytes[i + 1];
      out += D[n % 45]; n = Math.floor(n / 45);
      out += D[n % 45]; out += D[Math.floor(n / 45)];
    } else {
      let n = bytes[i];
      out += D[n % 45]; out += D[Math.floor(n / 45)];
    }
  }
  return out;
}
function base45Decode(text, p) {
  const D = (p && p.dict) || B45;
 // 空格在 Base45 码表中是合法符号（索引 36），不能 trim，仅去换行
  let s = text.replace(/[\r\n]/g, "");
  if (p && p.removeNonAlphabet) {
    s = [...s].filter((ch) => D.indexOf(ch) >= 0).join("");
  }
  const out = [];
  for (let i = 0; i < s.length; i += 3) {
    const chunk = s.slice(i, i + 3);
    let val = 0;
    for (let k = 0; k < chunk.length; k++) {
      const idx = D.indexOf(chunk[k]);
      if (idx === -1) throw new Error("非法 Base45 字符: " + chunk[k]);
      val += idx * Math.pow(45, k);
    }
    if (chunk.length === 3) {
 // RFC 9285 §6：三字符组解码值 > 65535（FFFF）不是合法编码，MUST 拒绝。
      // 正例 "FGW" = 65535 合法；反例 "GGW" = 65536 非法。
      if (val > 65535) throw new Error("Base45 三字符组超出 16 位上限（>65535）: " + chunk);
      out.push((val >> 8) & 0xff, val & 0xff);
    } else if (chunk.length === 2) {
 // 附带（与上处同类，可单独回退）：RFC 9285 §4 规定单字节 → 双字符组，
      // 故双字符组解码值 > 255 亦非合法编码，§6「MUST reject any input that is not a valid encoding」覆盖之。
      if (val > 255) throw new Error("Base45 双字符组超出 8 位上限（>255）: " + chunk);
      out.push(val & 0xff);
    } else throw new Error("Base45 长度非法（每组末尾不能只剩 1 字符）");
  }
  return finishBytesDecode(out, { name: "base45" });
}

// ============ Base58（Bitcoin / Flickr / Ripple / 自定义字母表） ============
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
// 变体字母表照抄规范不编造。custom 时改用 dict 参数。
const B58_ALPHABETS = {
  bitcoin: B58,
  flickr:  "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ",
  ripple:  "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz",
};
function b58Dict(p) {
  const a = (p && p.alphabet) || "bitcoin";
  if (a === "custom") return (p && p.dict) || B58;
  return B58_ALPHABETS[a] || B58;
}
const base58Encode = (t, p) => radixNEncode(t, b58Dict(p));
function base58Decode(text, p) {
  const D = b58Dict(p);
  let s = String(text);
  if (p && p.removeNonAlphabet) s = [...s].filter((ch) => D.indexOf(ch) >= 0).join("");
  return radixNDecode(s, D);
}

// ============ Base62 ============
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const base62Encode = (t, p) => radixNEncode(t, (p && p.dict) || B62);
const base62Decode = (t, p) => radixNDecode(t, (p && p.dict) || B62);

// ============ Base64（标准 + URL-safe + 自定义码表） ============
const B64_STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** 用指定 64 字符串（可含第 65 个 padding 字符）编码字节。用于 Show Base64 offsets。 */
function base64WithAlphabet(bytes, alphabet) {
  const D = String(alphabet || B64_STD);
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    const n = (b0 << 16) | ((b1 || 0) << 8) | (b2 || 0);
    out += D[(n >> 18) & 63] + D[(n >> 12) & 63];
    out += b1 !== undefined ? D[(n >> 6) & 63] : "=";
    out += b2 !== undefined ? D[n & 63] : "=";
  }
  return out;
}

function bytesFromBase64Text(raw) {
  let s = String(raw || "").replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** CyberChef Show Base64 offsets：返回三个偏移的静态段（或带可变段标注）。 */
function showBase64Offsets(text, p) {
  const alphabet = String((p && p.offsetAlphabet) || "A-Za-z0-9+/=");
  const expanded = alphabet === "A-Za-z0-9+/=" ? B64_STD : alphabet;
  const showVariable = p && p.offsetShowVariable === true;
  let input = (p && p.offsetInputFormat) === "Base64" ? bytesFromBase64Text(text) : te(String(text || ""));
  if (input.length < 1) throw new Error("Please enter a string.");
  const enc = (bytes) => base64WithAlphabet(bytes, expanded);
  const full = [
    enc(input),
    enc(Uint8Array.from([0].concat(Array.from(input)))).slice(2),
    enc(Uint8Array.from([0, 0].concat(Array.from(input)))).slice(3),
  ];
  const pads = [
    enc(input).indexOf("="),
    enc(Uint8Array.from([0].concat(Array.from(input)))).indexOf("="),
    enc(Uint8Array.from([0, 0].concat(Array.from(input)))).indexOf("="),
  ];
  const cut = (s, len) => (len === -1 ? s : len % 4 === 2 ? s.slice(0, -3) : len % 4 === 3 ? s.slice(0, -2) : s);
  if (!showVariable) return full.map((s, i) => cut(s, pads[i])).join("\n");
  // 可变/填充段用 [] 标注（纯文本等价展示，CC 用 HTML span 高亮）
  return full.map((s, i) => {
    const len = pads[i];
    if (len === -1) return s;
    if (len % 4 === 2) return s.slice(0, -3) + "[" + s.slice(-3) + "]";
    if (len % 4 === 3) return s.slice(0, -2) + "[" + s.slice(-2) + "]";
    return s;
  }).join("\n");
}

function base64Encode(text, p) {
  if (p && p.showOffsets === true) return showBase64Offsets(text, p);
  const D = (p && p.dict) || B64_STD;
  const bytes = te(text);
  const wantPad = (p && p.padding !== undefined) ? p.padding : true;
  // 标准码表快路径：btoa 原生（urlsafe 仅 +/→-_ 字符替换，同样可走；大输入分块防 apply 参数上限）
  // 块大小取 3 的倍数（32766=0x7FFE），否则每块 btoa 自补 "=" 会拼进输出中间
  if (D === B64_STD) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 0x7ffe) {
      out += btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + 0x7ffe)));
    }
    if (p && p.urlsafe) out = out.replace(/\+/g, "-").replace(/\//g, "_");
    if (!wantPad) out = out.replace(/=+$/, "");
    return out;
  }
  // 自定义码表：手工编码（直接索引读字节，避免逐 3 字节 slice 数组分配）
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    const n = (b0 << 16) | ((b1 || 0) << 8) | (b2 || 0);
    out += D[(n >> 18) & 63] + D[(n >> 12) & 63];
    out += b1 !== undefined ? D[(n >> 6) & 63] : "=";
    out += b2 !== undefined ? D[n & 63] : "=";
  }
  if (p && p.urlsafe) out = out.replace(/\+/g, "-").replace(/\//g, "_");
  if (!wantPad) out = out.replace(/=+$/, "");
  return out;
}
function base64Decode(text, p) {
  const D = (p && p.dict) || B64_STD;
  let s = text.replace(/\s/g, "");
  if (p && p.urlsafe || /[-_]/.test(s)) s = s.replace(/-/g, "+").replace(/_/g, "/");
  if (p && p.removeNonAlphabet) {
    s = [...s].filter((ch) => ch === "=" || D.indexOf(ch) >= 0).join("");
  }
  if (p && p.strictMode) {
    const body = s.replace(/=+$/, "");
    for (const ch of body) {
      if (D.indexOf(ch) < 0) throw new Error("Base64 strictMode 遇到非字母表字符: " + ch);
    }
  }
 // 标准码表用 atob 快路径
  if (D === B64_STD) {
    while (s.length % 4) s += "=";
    const bin = atob(s);
    return finishBytesDecode([...bin].map((c) => c.charCodeAt(0)), { name: "base64" });
  }
 // 自定义码表：手工解码
  const clean = s.replace(/=+$/, "");
  let bits = 0, val = 0;
  const out = [];
  for (const ch of clean) {
    const idx = D.indexOf(ch);
    if (idx === -1) throw new Error("非法 Base64 字符: " + ch);
    val = (val << 6) | idx;
    bits += 6;
    if (bits >= 8) { bits -= 8; out.push((val >> bits) & 0xff); }
  }
  return finishBytesDecode(out, { name: "base64" });
}

// ============ Base85 / Ascii85（Adobe <~ ~>，z 压缩零组） ============
// alphabet：Standard（Ascii85）/ Z85（ZeroMQ）/ IPv6（RFC 1924）。
// compat=true 或 includeDelimiter=false 时省略 <~ ~> 包裹；decode 一直容忍有无包裹。
const B85_Z85 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";
const B85_IPV6 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~";
function b85Alphabet(p) {
  const custom = String((p && p.customAlphabet) || "");
  if (custom !== "") {
    if (custom.length !== 85 || new Set(custom).size !== 85) throw new Error("Base85 自定义 Alphabet 须为 85 个互不相同的字符");
    return custom;
  }
  const a = (p && p.alphabet) || "Standard";
  if (a === "Standard") return null; // Ascii85 用字符码 33..117
  if (a === "Z85") return B85_Z85;
  if (a === "IPv6") return B85_IPV6;
  throw new Error("base85 alphabet 须为 Standard/Z85/IPv6（实为 " + a + "）");
}
function base85GenericEncode(text, p, D) {
  const bytes = te(text);
  if (bytes.length % 4 !== 0) throw new Error("Base85 " + ((p && p.alphabet) || "") + " 输入字节数须为 4 的倍数（实为 " + bytes.length + "）");
  let out = "";
  for (let i = 0; i < bytes.length; i += 4) {
    let num = ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    const enc = [];
    for (let k = 0; k < 5; k++) { enc.unshift(D[num % 85]); num = Math.floor(num / 85); }
    out += enc.join("");
  }
  return out;
}
function base85GenericDecode(text, p, D) {
  let s = String(text).replace(/^<~/, "").replace(/~>$/, "").replace(/\s/g, "");
  if (p && p.removeNonAlphabet) s = [...s].filter((ch) => D.indexOf(ch) >= 0).join("");
  if (s.length % 5 !== 0) throw new Error("Base85 " + ((p && p.alphabet) || "") + " 输入字符数须为 5 的倍数（实为 " + s.length + "）");
  const bytes = [];
  for (let i = 0; i < s.length; i += 5) {
    let num = 0;
    for (const ch of s.slice(i, i + 5)) {
      const v = D.indexOf(ch);
      if (v < 0) throw new Error("非法 Base85 字符: " + ch);
      num = num * 85 + v;
    }
    if (num > 0xffffffff) throw new Error("Base85 组值超出 32 位");
    bytes.push((num >>> 24) & 255, (num >>> 16) & 255, (num >>> 8) & 255, num & 255);
  }
  return finishBytesDecode(bytes, { name: "base85" });
}
function ascii85Encode(text, p) {
  const D = b85Alphabet(p);
  if (D) return base85GenericEncode(text, p, D);
  const bytes = te(text);
  const zero = (p && p.allZeroGroupChar) || "z";
  let out = "";
  for (let i = 0; i < bytes.length; i += 4) {
    const chunk = bytes.slice(i, i + 4);
    const size = chunk.length;
    let num = 0;
    for (let k = 0; k < 4; k++) num = (num * 256 + (k < size ? chunk[k] : 0)) >>> 0;
    if (size === 4 && num === 0) { out += zero; continue; }
    const enc = [];
    let n = num;
    for (let k = 0; k < 5; k++) { enc.unshift(String.fromCharCode((n % 85) + 33)); n = Math.floor(n / 85); }
    out += enc.slice(0, size + 1).join("");
  }
  const noWrap = (p && p.compat) || (p && p.includeDelimiter === false);
  return noWrap ? out : "<~" + out + "~>";
}
function ascii85Decode(text, p) {
  const D = b85Alphabet(p);
  if (D) return base85GenericDecode(text, p, D);
  const zero = (p && p.allZeroGroupChar) || "z";
  let s = text.replace(/^<~/, "").replace(/~>$/, "").replace(/\s/g, "");
  if (p && p.removeNonAlphabet) {
    s = [...s].filter((ch) => ch === zero || (ch.charCodeAt(0) >= 33 && ch.charCodeAt(0) <= 117)).join("");
  }
  const bytes = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === zero) { bytes.push(0, 0, 0, 0); i++; continue; }
    const chunk = s.slice(i, i + 5);
    const pad = 5 - chunk.length;
    const padded = chunk + "u".repeat(pad);
    let num = 0;
    for (const ch of padded) {
      const v = ch.charCodeAt(0) - 33;
      if (v < 0 || v > 84) throw new Error("非法 Ascii85 字符");
      num = num * 85 + v;
    }
    const b = [(num >>> 24) & 255, (num >>> 16) & 255, (num >>> 8) & 255, num & 255];
    for (let k = 0; k < 4 - pad; k++) bytes.push(b[k]);
    i += 5;
  }
  return finishBytesDecode(bytes, { name: "ascii85" });
}

// ============ Base91（basE91） ============
const B91 =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~\"";
function base91Encode(text, p) {
  const D = (p && p.dict) || B91;
  const bytes = te(text);
  let b = 0, n = 0, out = "";
  for (const byte of bytes) {
    b += byte * (2 ** n);
    n += 8;
    if (n > 13) {
      let v = b % 8192;
      if (v > 88) { b = Math.floor(b / 8192); n -= 13; }
      else { v = b % 16384; b = Math.floor(b / 16384); n -= 14; }
      out += D[v % 91] + D[Math.floor(v / 91)];
    }
  }
  if (n) {
    out += D[b % 91];
    if (n > 7 || b > 90) out += D[Math.floor(b / 91)];
  }
  return out;
}
function base91Decode(text, p) {
  const D = (p && p.dict) || B91;
  let v = -1, b = 0, n = 0;
  const out = [];
 // 注：b 用加法/除法代替 `b|=v<<n`、`b>>=8`。JS 位运算是 32 位有符号
 // decode 端 v<<n 的 n 可累积到 ~21，会溢出破坏高位（encode 端 b 及时右移不触发
 // 故短 ASCII 往返侥幸通过，含高位字节的输入 100% 失败）。b 实际 <2^22，浮点安全。
  for (const ch of text) {
    const c = D.indexOf(ch);
    if (c === -1) continue;
    if (v < 0) { v = c; }
    else {
      v += c * 91;
      b += v * (2 ** n);
      n += (v & 8191) > 88 ? 13 : 14;
      do { out.push(b & 0xff); b = Math.floor(b / 256); n -= 8; } while (n > 7);
      v = -1;
    }
  }
  if (v >= 0) out.push((b + v * (2 ** n)) & 0xff);
  return finishBytesDecode(out, { name: "base91" });
}

// ============ Base92 ============
const B92 =
  "!#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_abcdefghijklmnopqrstuvwxyz{|}";
function base92Encode(text, p) {
  const D = (p && p.dict) || B92;
  if (text === "") return "~";
  const bin = [...te(text)].map((b) => b.toString(2).padStart(8, "0")).join("");
  let out = "";
  for (let i = 0; i < bin.length; i += 13) {
    const seg = bin.slice(i, i + 13);
    if (seg.length < 7) {
      out += D[parseInt(seg.padEnd(6, "0"), 2)];
    } else {
      const v = parseInt(seg.padEnd(13, "0"), 2);
      out += D[Math.floor(v / 91)] + D[v % 91];
    }
  }
  return out;
}
function base92Decode(text, p) {
  const D = (p && p.dict) || B92;
  const s = text.trim();
  if (s === "~") return "";
  let bin = "";
  for (let i = 0; i < s.length; i += 2) {
    const pair = s.slice(i, i + 2);
    if (pair.length > 1) {
      bin += (D.indexOf(pair[0]) * 91 + D.indexOf(pair[1])).toString(2).padStart(13, "0");
    } else {
 // 单字符尾块代表 6 bit（含尾部补零），须补足前导零方能正确还原
      bin += D.indexOf(pair[0]).toString(2).padStart(6, "0");
    }
  }
  const out = [];
  for (let i = 0; i + 8 <= bin.length; i += 8) out.push(parseInt(bin.slice(i, i + 8), 2));
  return finishBytesDecode(out, { name: "base92" });
}

// ============ Base100（emoji 编码，每字节 → U+1F3F7 + b） ============
// 算法源：ToolsFx，每字节映射为 4 字节 UTF-8（0xF0 0x9F XX YY）
function base100Encode(text) {
  return [...te(text)].map((b) => String.fromCodePoint(0x1F3F7 + b)).join("");
}
function base100Decode(text) {
  const u8 = te(text);
  const out = [];
  for (let i = 0; i + 4 <= u8.length; i += 4) {
    if (u8[i] === 0xf0 && u8[i + 1] === 0x9f) {
      out.push(((u8[i + 2] - 143) * 64 + u8[i + 3] - 128 - 55) & 0xff);
    }
  }
  return finishBytesDecode(out, { name: "base100" });
}

// ============ 任意进制（文本 ↔ N 进制大整数，N = 2..95） ============
// 默认码表按 ASCII 33..127 顺序取前 N 个可打印字符；用户可自定义。
function defaultRadixDict(n) {
 // ASCII 33..126 恰 94 个互不重复的可见字符。默认码表最多到 94 进制。
 // 95 进制须由用户提供无重复码表（旧版在此补 'a' 会与已有 'a' 重复 → 解码歧义，已移除）。
  let s = "";
  for (let c = 33; c < 127 && s.length < n; c++) s += String.fromCharCode(c);
  return s;
}
function radixNEncodeParam(text, p) {
  const radix = Math.max(2, Math.min(95, Number((p && p.radix) || 36)));
  const dict = (p && p.dict) || defaultRadixDict(radix);
  if (dict.length < radix) throw new Error(`码表长度 ${dict.length} 不足以表示 ${radix} 进制`);
  return radixNEncode(text, dict.slice(0, radix));
}
function radixNDecodeParam(text, p) {
  const radix = Math.max(2, Math.min(95, Number((p && p.radix) || 36)));
  const dict = (p && p.dict) || defaultRadixDict(radix);
  if (dict.length < radix) throw new Error(`码表长度 ${dict.length} 不足以表示 ${radix} 进制`);
  return radixNDecode(text, dict.slice(0, radix));
}

// ---- 注册 ----
// 自定义码表参数（base16/32/45/58/62/64/91/92 通用）
const DICT_PARAM = (def, label = "自定义码表") => [
  { key: "dict", label, type: "text", default: def, placeholder: def },
];

register({
  id: "base16", cat: "base", name: "Base16 / Hex", desc: "十六进制编码（支持自定义码表）",
  params: [
    { key: "upper", label: "大写", type: "bool", default: true },
    { key: "space", label: "空格分隔（encode）", type: "bool", default: false },
    { key: "delimiter", label: "输入分隔符（decode）", type: "select", default: "Auto",
      options: [
        { value: "Auto", label: "Auto（自动剥离非 hex 字符）" },
        { value: "Space", label: "Space" },
        { value: "Percent", label: "Percent（%）" },
        { value: "Comma", label: "Comma" },
        { value: "Semi-colon", label: "Semi-colon" },
        { value: "Colon", label: "Colon" },
        { value: "LF", label: "Line feed" },
        { value: "CRLF", label: "CRLF" },
        { value: "0x", label: "0x" },
        { value: "0x with comma", label: "0x with comma" },
        { value: "\\x", label: "\\x" },
        { value: "None", label: "None（不剥离）" },
      ] },
    { key: "dict", label: "自定义码表", type: "text", default: B16, placeholder: B16 },
    { key: "encodeDelimiter", label: "To Hex 分隔符（留空=旧行为）", type: "select", default: "",
      options: [
        { value: "", label: "不启用（沿用上方大写/空格参数）" },
        { value: "Space", label: "Space" },
        { value: "Percent", label: "Percent（%）" },
        { value: "Comma", label: "Comma" },
        { value: "Semi-colon", label: "Semi-colon" },
        { value: "Colon", label: "Colon" },
        { value: "Line feed", label: "Line feed" },
        { value: "CRLF", label: "CRLF" },
        { value: "0x", label: "0x" },
        { value: "0x with comma", label: "0x with comma" },
        { value: "\\x", label: "\\x" },
        { value: "None", label: "None" },
      ] },
    { key: "bytesPerLine", label: "To Hex：每行字节数（0=不换行）", type: "number", default: 0 },
  ],
  acceptsBytes: true, textTransit: true,
  encode: (t, p) => hexEncode(p?.rawBytes ?? t, p), decode: hexDecode,
  detect: (t) => (/^[\s]*(0x)?[0-9a-fA-F\s]+$/.test(t) && t.replace(/[^0-9a-fA-F]/g, "").length % 2 === 0 ? 0.5 : 0),
});
register({
  id: "base32", cat: "base", name: "Base32", desc: "RFC 4648 / base32hex / Crockford / z-base-32（支持自定义码表）",
  params: [
    { key: "variant", label: "变体", type: "select", default: "rfc4648",
      options: [
        { value: "rfc4648", label: "RFC 4648（A-Z2-7，带 pad）" },
        { value: "hex", label: "base32hex（0-9A-V，带 pad）" },
        { value: "crockford", label: "Crockford（去 ILOU，容错，无 pad）" },
        { value: "zbase32", label: "z-base-32（小写，无 pad）" },
      ],
    },
    { key: "padding", label: "补 =（仅 rfc4648/hex）", type: "bool", default: true },
    { key: "removeNonAlphabet", label: "解码时移除非字母表字符", type: "bool", default: false },
    { key: "dict", label: "自定义码表（覆盖变体字母表）", type: "text", default: "", placeholder: B32 },
  ],
  acceptsBytes: true, textTransit: true,
  encode: (t, p) => base32Encode(p?.rawBytes ?? t, p), decode: base32Decode,
  detect: (t) => {
    const s = t.trim();
 // 标准 base32（A-Z2-7）最强；hex(A-V)/Crockford(去 ILOU) 有区分度。
    if (/^[A-Z2-7=\s]+$/.test(s) && s.length >= 8) return 0.6;
    const u = s.toUpperCase();
    if (/^[0-9A-V]+$/.test(u) && u.length >= 8) return 0.25;          // base32hex
    if (/^[0-9A-HJ-NP-TV-Z]+$/.test(u) && u.length >= 8) return 0.2;  // Crockford（无 ILOU）
    return 0;
  },
});
register({
  id: "base36", cat: "base", name: "Base36", desc: "大整数 0-9a-z",
  params: DICT_PARAM(B36),
  acceptsBytes: true, textTransit: true,
  encode: (t, p) => base36Encode(p?.rawBytes ?? t, p), decode: base36Decode,
  detect: (t) => (/^[0-9a-zA-Z]+$/.test(t.trim()) && t.trim().length >= 6 ? 0.3 : 0),
});
register({
  id: "base45", cat: "base", name: "Base45", desc: "RFC 9285（QR 码常用）",
  params: [
    ...DICT_PARAM(B45),
    { key: "removeNonAlphabet", label: "解码时移除非字母表字符", type: "bool", default: false },
  ],
  acceptsBytes: true, textTransit: true,
  encode: (t, p) => base45Encode(p?.rawBytes ?? t, p), decode: base45Decode,
  // 空格是 Base45 合法数据字符（码表索引 36），非分隔符 → 长度校验只剥 \r\n（与 decode 一致），
  // 否则 flag{hello}→"U.C5EC2RF: C*VDZ2"（含数据空格，17 字符）会被误剥成 16 → %3===1 漏认。
  detect: (t) => (/^[0-9A-Z $%*+./:=\s]+$/.test(t) && t.replace(/[\r\n]/g, "").length % 3 !== 1 ? 0.4 : 0),
});
register({
  id: "base58", cat: "base", name: "Base58", desc: "Bitcoin / Flickr / Ripple / 自定义字母表",
  family: "base58", familyLabel: "base58",
  params: [
    { key: "alphabet", label: "字母表", type: "select", default: "bitcoin",
      options: [
        { value: "bitcoin", label: "Bitcoin（标准）" },
        { value: "flickr", label: "Flickr（小写在前）" },
        { value: "ripple", label: "Ripple（XRP 乱序）" },
        { value: "custom", label: "自定义（用下方码表）" },
      ],
    },
    { key: "removeNonAlphabet", label: "解码时移除非字母表字符", type: "bool", default: false },
    { key: "dict", label: "自定义码表（alphabet=custom 时生效）", type: "text", default: B58, placeholder: B58 },
  ],
  acceptsBytes: true, textTransit: true,
  encode: (t, p) => base58Encode(p?.rawBytes ?? t, p), decode: base58Decode,
  detect: (t) => (/^[1-9A-HJ-NP-Za-km-z]+$/.test(t.trim()) && t.trim().length >= 4 ? 0.4 : 0),
});
register({
  id: "base62", cat: "base", name: "Base62", desc: "0-9A-Za-z（支持自定义码表）",
  params: DICT_PARAM(B62),
  acceptsBytes: true, textTransit: true,
  encode: (t, p) => base62Encode(p?.rawBytes ?? t, p), decode: base62Decode,
  detect: (t) => (/^[0-9A-Za-z]+$/.test(t.trim()) && t.trim().length >= 6 ? 0.35 : 0),
});
register({
  id: "base64", cat: "base", name: "Base64", desc: "通用字节/文本 Base64：标准 / URL-safe（含 base64url，可选 padding）/ 自定义码表。图片转 dataURI 请用「图片转 Base64/dataURI」（自动嗅探 MIME）；data URI 协议解析用「Data URI 解析」",
  family: "base64", familyLabel: "base64",
  params: [
    { key: "urlsafe", label: "URL-safe（+/ → -_）", type: "bool", default: false },
    { key: "padding", label: "补齐 =（关闭即无 padding，如 JWT）", type: "bool", default: true },
    { key: "removeNonAlphabet", label: "解码时移除非字母表字符", type: "bool", default: false },
    { key: "strictMode", label: "严格模式（解码遇非字母表字符即报错）", type: "bool", default: false },
    { key: "dict", label: "自定义码表", type: "text", default: B64_STD, placeholder: B64_STD },
    { key: "showOffsets", label: "显示所有 Base64 偏移（同 CyberChef Show Base64 offsets）", type: "bool", default: false },
    { key: "offsetAlphabet", label: "偏移展示：字母表", type: "text", default: "A-Za-z0-9+/=" },
    { key: "offsetShowVariable", label: "偏移展示：标注可变/填充字符", type: "bool", default: false },
    { key: "offsetInputFormat", label: "偏移展示：输入格式", type: "select", default: "Raw", options: [
      { value: "Raw", label: "Raw" },
      { value: "Base64", label: "Base64" },
    ] },
  ],
  acceptsBytes: true, textTransit: true,
  encode: (t, p) => base64Encode(p?.rawBytes ?? t, p), decode: base64Decode,
  detect: (t) => {
    const s = t.trim();
 // 含 -_ 是 base64url 强信号（标准 base64 无），从 detectExt2 base64url 判据并入。
    if (/[-_]/.test(s) && /^[A-Za-z0-9\-_]+={0,2}$/.test(s) && s.length >= 8) return 0.4;
    return /^[A-Za-z0-9+/=\s]+$/.test(s) && s.length % 4 === 0 && s.length >= 4 ? 0.55 : 0;
  },
});
register({
  id: "base85", cat: "base", name: "Base85 / Ascii85", desc: "Ascii85（<~ ~> 包裹，z 压缩零组）/ Z85 / IPv6 Base85",
  params: [
    { key: "alphabet", label: "字母表", type: "select", default: "Standard",
      options: [
        { value: "Standard", label: "Standard（Adobe Ascii85）" },
        { value: "Z85", label: "Z85（ZeroMQ）" },
        { value: "IPv6", label: "IPv6（RFC 1924）" },
      ] },
    { key: "customAlphabet", label: "Custom Alphabet（85 字符，留空=用上方 preset）", type: "text", default: "", placeholder: "85 个互不相同字符" },
    { key: "compat", label: "兼容模式（输出不带 <~ ~> 包裹）", type: "bool", default: false },
    { key: "includeDelimiter", label: "输出 <~ ~> 包裹（Standard 生效）", type: "bool", default: true },
    { key: "allZeroGroupChar", label: "全零组字符（Standard）", type: "text", default: "z", placeholder: "z" },
    { key: "removeNonAlphabet", label: "解码时移除非字母表字符", type: "bool", default: false },
  ],
  acceptsBytes: true, textTransit: true,
  encode: (t, p) => ascii85Encode(p?.rawBytes ?? t, p), decode: ascii85Decode,
  detect: (t) => (/^<~.*~>$/s.test(t.trim()) ? 0.8 : 0),
});
register({
  id: "base91", cat: "base", name: "Base91", desc: "basE91（支持自定义码表）",
  params: DICT_PARAM(B91),
  acceptsBytes: true, textTransit: true,
  encode: (t, p) => base91Encode(p?.rawBytes ?? t, p), decode: base91Decode,
  detect: (t) => {
    const s = t.trim();
    if (!s) return 0;
 // Base91 字符集较宽，仅当全部命中且长度够长时给低置信度
    const allowed = B91;
    return [...s].every((c) => allowed.includes(c)) && s.length >= 8 ? 0.25 : 0;
  },
});
register({
  id: "base92", cat: "base", name: "Base92", desc: "13 bit 分块（支持自定义码表）",
  params: DICT_PARAM(B92),
  acceptsBytes: true, textTransit: true,
  encode: (t, p) => base92Encode(p?.rawBytes ?? t, p), decode: base92Decode,
  detect: (t) => {
    const s = t.trim();
    if (!s || s === "~") return 0;
    return [...s].every((c) => B92.includes(c)) && s.length >= 4 ? 0.25 : 0;
  },
});
register({
  id: "base100", cat: "base", name: "Base100", desc: "emoji 编码（每字节 → U+1F3F7 + b）",
  family: "unicodebase", familyLabel: "base100",
  acceptsBytes: true, textTransit: true,
  encode: (t, p) => base100Encode(p?.rawBytes ?? t, p), decode: base100Decode,
  detect: (t) => {
    const s = t.trim();
    if (!s) return 0;
 // 全部是 U+1F3F7..U+1F4F6 区间的 emoji
    return [...s].every((c) => {
      const cp = c.codePointAt(0);
      return cp >= 0x1F3F7 && cp <= 0x1F4F6;
    }) && s.length >= 2 ? 0.7 : 0;
  },
});
register({
  id: "radixN", cat: "base", name: "任意进制", desc: "文本 ↔ N 进制大整数（N = 2..95，可自定义码表）",
  params: [
    { key: "radix", label: "进制", type: "number", default: 36, placeholder: "2-95" },
    { key: "dict", label: "自定义码表（可选）", type: "text", default: "", placeholder: "留空用默认可打印 ASCII" },
  ],
  acceptsBytes: true, textTransit: true,
  encode: (t, p) => radixNEncodeParam(p?.rawBytes ?? t, p), decode: radixNDecodeParam,
  detect: () => 0,  // 任意进制无法可靠识别
});

function baseCustomEncode(text, p) {
  const dict = (p && p.dict) || "";
  if (dict.length < 2) throw new Error("自定义字母表至少 2 个字符");
  if (new Set(dict).size !== dict.length) throw new Error("自定义字母表含重复字符");
  return radixNEncode(text, dict);
}
function baseCustomDecode(text, p) {
  const dict = (p && p.dict) || "";
  if (dict.length < 2) throw new Error("自定义字母表至少 2 个字符");
  if (new Set(dict).size !== dict.length) throw new Error("自定义字母表含重复字符");
  return radixNDecode(text, dict);
}
register({
  id: "baseCustom", cat: "base", name: "自定义字母表 Base", desc: "用户填字母表，进制 = 字母表长度",
  params: [{ key: "dict", label: "自定义字母表", type: "text", default: "0123456789ABCDEF", placeholder: "如 0123456789ABCDEF" }],
  acceptsBytes: true, textTransit: true,
  encode: (t, p) => baseCustomEncode(p?.rawBytes ?? t, p), decode: baseCustomDecode,
  detect: () => 0,
});
export {
  hexEncode, hexDecode,
  base32Encode, base32Decode,
  base36Encode, base36Decode,
  base45Encode, base45Decode,
  base58Encode, base58Decode,
  base62Encode, base62Decode,
  base64Encode, base64Decode,
  ascii85Encode, ascii85Decode,
  base91Encode, base91Decode,
  base92Encode, base92Decode,
  base100Encode, base100Decode,
  radixNEncodeParam, radixNDecodeParam,
  baseCustomEncode, baseCustomDecode,
  B16, B32, B36, B45, B58, B62, B64_STD, B91, B92,
};
