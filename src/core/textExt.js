/*
 * textExt.js — 文本 / 传输编码扩展（cat:'text'）。
 *
 * 来源（算法逻辑参考权威实现，按规范重写）：
 * - utf7：RFC 2152，参考 WhatsInYourClipboard baseExtra.js utf7Encode/utf7Decode
 * - punycode：RFC 3492 IDN，手写算法（注意 xn-- 前缀与大小写不敏感）
 * - jsHex：\xXX 转义（与 unicodeEscape 的 \uXXXX 不同）
 * - mixHexOctBin：0x/0b/0o 混排解码
 * - hexReverse：字节内两位 hex 互换（自反）
 * - leetSpeak：1337 互转（参考 CyberChef 经典映射）
 * - netbios：半字节 + A 偏移（每字节拆高低 4 位 + 'A'）
 * - caretMdecode：^X/M- 控制字符（Ctrl+X = X & 0x1F，M-X = X | 0x80）
 * - natoAlphabet：北约音标字母表
 * - asciiControl：控制字符解码（control_map 0-32 + 127 → (名称, Unicode 符号)）
 *
 * 契约：能双向的 encode/decode，单向工具 run 返报告文本。
 * 与 text.js 7 项不重复（url/htmlEntity/unicodeEscape/quotedPrintable/uuencode/xxencode/jsfuck 已有）。
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

// ============ utf7（RFC 2152，参考 WhatsInYourClipboard baseExtra.js）============
const UTF7_B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function utf16beBytes(str) {
  const out = [];
 // 用 codePointAt 处理补充平面字符（拆代理对）
  for (const ch of [...str]) {
    const code = ch.codePointAt(0);
    if (code > 0xffff) {
 // 拆代理对
      const hi = 0xd800 + ((code - 0x10000) >> 10);
      const lo = 0xdc00 + ((code - 0x10000) & 0x3ff);
      out.push((hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff);
    } else {
      out.push((code >> 8) & 0xff, code & 0xff);
    }
  }
  return out;
}
function bytesToUtf16be(bytes) {
  let s = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = (bytes[i] << 8) | bytes[i + 1];
 // 检测代理对
    if (code >= 0xd800 && code <= 0xdbff && i + 3 < bytes.length) {
      const lo = (bytes[i + 2] << 8) | bytes[i + 3];
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        const cp = 0x10000 + ((code - 0xd800) << 10) + (lo - 0xdc00);
        s += String.fromCodePoint(cp);
        i += 2;
        continue;
      }
    }
    s += String.fromCharCode(code);
  }
  return s;
}
function mb64Encode(bytes, dict) {
  let bits = 0, val = 0, out = "";
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 6) { bits -= 6; out += dict[(val >> bits) & 63]; }
  }
  if (bits > 0) out += dict[(val << (6 - bits)) & 63];
  return out;
}
function mb64Decode(str, dict) {
  let bits = 0, val = 0;
  const out = [];
  for (const ch of str) {
    const idx = dict.indexOf(ch);
    if (idx === -1) continue;
    val = (val << 6) | idx; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((val >> bits) & 0xff); }
  }
  return out;
}
// 直接字符集 = RFC 2152 SET_D ∪ SET_O ∪ SET_W
const UTF7_DIRECT_RE = /[A-Za-z0-9'(),\-.\/:?!"#$%&*;<=>@_^{|}\\ \r\n\t]/;
function utf7Encode(text) {
  let out = "";
  let buf = "";
  const flush = () => {
    if (buf) { out += "+" + mb64Encode(utf16beBytes(buf), UTF7_B64) + "-"; buf = ""; }
  };
  for (const ch of text) {
    if (ch === "+") { flush(); out += "+-"; }
    else if (UTF7_DIRECT_RE.test(ch)) { flush(); out += ch; }
    else buf += ch;
  }
  flush();
  return out;
}
function utf7Decode(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "+") {
      const end = text.indexOf("-", i + 1);
      const seg = end === -1 ? text.slice(i + 1) : text.slice(i + 1, end);
      if (seg === "") out += "+";
      else out += bytesToUtf16be(mb64Decode(seg, UTF7_B64));
      i = end === -1 ? text.length : end + 1;
    } else { out += text[i]; i++; }
  }
  return out;
}

// ============ punycode（RFC 3492 IDN，手写算法）============
const PUNY_BASE = 36;
const PUNY_TMIN = 1;
const PUNY_TMAX = 26;
const PUNY_SKEW = 38;
const PUNY_DAMP = 700;
const PUNY_INIT_BIAS = 72;
const PUNY_INIT_N = 128;

function punyDigitToChar(d) {
 // 0-25 → a-z, 26-35 → 0-9
  if (d < 26) return String.fromCharCode(97 + d);
  return String.fromCharCode(22 + d);
}
function punyCharToDigit(c) {
  const code = c.charCodeAt(0);
  if (code >= 97 && code <= 122) return code - 97;       // a-z
  if (code >= 65 && code <= 90) return code - 65;        // A-Z（按小写处理）
  if (code >= 48 && code <= 57) return code - 22;        // 0-9
  throw new Error("punycode: 非法字符 " + c);
}
function punyAdapt(delta, numpoints, firsttime) {
  delta = firsttime ? Math.floor(delta / PUNY_DAMP) : Math.floor(delta / 2);
  delta += Math.floor(delta / numpoints);
  let k = 0;
  while (delta > Math.floor((PUNY_BASE - PUNY_TMIN) * PUNY_TMAX / 2)) {
    delta = Math.floor(delta / (PUNY_BASE - PUNY_TMIN));
    k += PUNY_BASE;
  }
  return k + Math.floor((PUNY_BASE - PUNY_TMIN + 1) * delta / (delta + PUNY_SKEW));
}
function punycodeEncodeLabel(input) {
 // input: 码点数组
  const output = [];
  const basic = [];
  for (const cp of input) {
    if (cp < 128) basic.push(String.fromCharCode(cp));
  }
  output.push(...basic);
  let h = basic.length;
  const b = h;
  if (b > 0) output.push('-');
  let n = PUNY_INIT_N;
  let delta = 0;
  let bias = PUNY_INIT_BIAS;
  while (h < input.length) {
    let m = Infinity;
    for (const cp of input) if (cp >= n && cp < m) m = cp;
    delta += (m - n) * (h + 1);
    n = m;
    for (const cp of input) {
      if (cp < n) delta++;
      else if (cp === n) {
        let q = delta;
        for (let k = PUNY_BASE; ; k += PUNY_BASE) {
          const t = Math.max(PUNY_TMIN, Math.min(PUNY_TMAX, k - bias));
          if (q < t) break;
          output.push(punyDigitToChar(t + (q - t) % (PUNY_BASE - t)));
          q = Math.floor((q - t) / (PUNY_BASE - t));
        }
        output.push(punyDigitToChar(q));
        bias = punyAdapt(delta, h + 1, h === b);
        delta = 0;
        h++;
      }
    }
    delta++;
    n++;
  }
  return output.join('');
}
function punycodeDecodeLabel(s) {
  const lastDash = s.lastIndexOf('-');
  let basic = lastDash >= 0 ? s.slice(0, lastDash) : "";
  let extended = lastDash >= 0 ? s.slice(lastDash + 1) : s;
  const output = [...basic].map(c => c.charCodeAt(0));
  let n = PUNY_INIT_N;
  let bias = PUNY_INIT_BIAS;
  let i = 0;
  let pos = 0;
  while (pos < extended.length) {
    const oldi = i;
    let w = 1;
    for (let k = PUNY_BASE; ; k += PUNY_BASE) {
      if (pos >= extended.length) throw new Error("punycode: 输入截断");
      const digit = punyCharToDigit(extended[pos++]);
      i += digit * w;
      const t = Math.max(PUNY_TMIN, Math.min(PUNY_TMAX, k - bias));
      if (digit < t) break;
      w *= (PUNY_BASE - t);
    }
    bias = punyAdapt(i - oldi, output.length + 1, oldi === 0);
    n += Math.floor(i / (output.length + 1));
    i %= (output.length + 1);
    output.splice(i, 0, n);
    i++;
  }
  return output;
}
function punycodeEncode(text) {
 // 按 '.' 分段，每段单独编码（IDN 多 label）
  const labels = text.split('.');
  return labels.map(label => {
    if (!label) return "";
    const cps = [...label].map(c => c.codePointAt(0));
    const hasNonAscii = cps.some(cp => cp >= 128);
    if (!hasNonAscii) return label;  // 纯 ASCII 不编码
    return "xn--" + punycodeEncodeLabel(cps);
  }).join('.');
}
function punycodeDecode(text) {
  const labels = text.split('.');
  return labels.map(label => {
    if (label.toLowerCase().startsWith("xn--")) {
      const decoded = punycodeDecodeLabel(label.slice(4));
      return decoded.map(cp => String.fromCodePoint(cp)).join('');
    }
    return label;
  }).join('.');
}

// ============ jsHex（\xXX 转义，与 unicodeEscape \uXXXX 不同）============
function jsHexEncode(text, p) {
  const mode = (p && p.mode) || "nonascii";
  const bytes = te(text);
  if (mode === "all") {
    return [...bytes].map(b => "\\x" + b.toString(16).padStart(2, "0")).join("");
  }
 // nonascii：仅非可打印 ASCII 和非 ASCII 字节转义
  return [...bytes].map(b => {
    if (b >= 0x20 && b <= 0x7e) return String.fromCharCode(b);
    return "\\x" + b.toString(16).padStart(2, "0");
  }).join("");
}
function jsHexDecode(text) {
 // 解析 \xXX 转义，其余字符原样保留
  const bytes = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\\" && text[i + 1] === "x" && /[0-9a-fA-F]/.test(text[i + 2]) && /[0-9a-fA-F]/.test(text[i + 3])) {
      bytes.push(parseInt(text.slice(i + 2, i + 4), 16));
      i += 4;
    } else {
      bytes.push(text.charCodeAt(i) & 0xff);
      i++;
    }
  }
  return td(bytes);
}

// ============ mixHexOctBin（0x/0b/0o 混排解码）============
// 连写串拆分：0x68 0o145 直接相接时，末位 0 归属有歧义（0b11011000x6c 既可读成
// 0b1101100+0x6c 也可读成 0b110110+00x6c）。用惰性量词 + 前瞻「下一段必须是新前缀
// 或串尾」把归属钉死，得到唯一正确切分。
const MIX_PACKED_RE = /0x[0-9a-f]+?(?=0[xbod]|$)|0b[01]+?(?=0[xbod]|$)|0o[0-7]+?(?=0[xbod]|$)|0d[0-9]+?(?=0[xbod]|$)/gi;

function mixSplitPacked(tok) {
 // 仅当 token 内嵌了多个前缀才尝试拆分，单个 token 保持原样交由后续报错
  if (!/^0[xbod]/i.test(tok)) return [tok];
  if ((tok.match(/0[xbod]/gi) || []).length < 2) return [tok];
  const parts = tok.match(MIX_PACKED_RE);
 // 拆分必须无损覆盖原串，否则视为拆不动，原样返回
  return parts && parts.join("").length === tok.length ? parts : [tok];
}

function mixHexOctBinRun(text) {
  const s = text.trim();
 // 按空白 / 逗号 / 分号分割，再对连写 token 二次拆分
  const tokens = s.split(/[\s,;]+/).filter(Boolean).flatMap(mixSplitPacked);
  if (tokens.length === 0) return "（空输入）";
  const out = [];
  const errors = [];
  for (const t of tokens) {
    let base = 0, val = null;
    const tl = t.toLowerCase();
    if (tl.startsWith("0x")) { base = 16; val = parseInt(t.slice(2), 16); }
    else if (tl.startsWith("0b")) { base = 2; val = parseInt(t.slice(2), 2); }
    else if (tl.startsWith("0o")) { base = 8; val = parseInt(t.slice(2), 8); }
    else if (tl.startsWith("0d")) { base = 10; val = parseInt(t.slice(2), 10); }
    else if (/^\d+$/.test(t)) { base = 10; val = parseInt(t, 10); }
    else { errors.push(t); continue; }
    if (isNaN(val)) { errors.push(t); continue; }
    const ch = (val >= 0 && val <= 0x10ffff) ? String.fromCodePoint(val) : "?";
    out.push(`${t}\t(${base} 进制 = ${val})\t→ ${ch}`);
  }
  const lines = [];
  if (out.length) {
    lines.push("逐字符解码:");
    lines.push(...out);
    lines.push("");
    lines.push("拼接结果: " + out.map(l => l.split("\t").pop().slice(2)).join(""));
  }
  if (errors.length) lines.push("无法识别 token: " + errors.join(" "));
  return lines.join("\n");
}

// ============ hexReverse（字节内两位 hex 互换，自反）============
function hexReverse(text) {
  let s = text.trim().replace(/\s+/g, "");
  if (s.startsWith("0x") || s.startsWith("0X")) s = s.slice(2);
  if (s.length % 2 !== 0) throw new Error("hexReverse: 长度须为偶数（每字节 2 位 hex）");
  if (!/^[0-9a-fA-F]+$/.test(s)) throw new Error("hexReverse: 含非 hex 字符");
  let out = "";
  for (let i = 0; i < s.length; i += 2) {
    out += s[i + 1] + s[i];
  }
  return out;
}

// ============ leetSpeak（1337 互转，参考 CyberChef 经典表）============
const LEET_MAP = {
  "a": "4", "A": "4",
  "b": "8", "B": "8",
  "c": "(", "C": "(",
  "d": "|)", "D": "|)",
  "e": "3", "E": "3",
  "g": "6", "G": "6",
  "h": "#", "H": "#",
  "i": "1", "I": "1",
  "j": "_|", "J": "_|",
  "k": "|<", "K": "|<",
  "l": "1", "L": "1",
  "m": "/\\/\\", "M": "/\\/\\",
  "n": "|\\|", "N": "|\\|",
  "o": "0", "O": "0",
  "p": "|D", "P": "|D",
  "q": "9", "Q": "9",
  "r": "|2", "R": "|2",
  "s": "5", "S": "5",
  "t": "7", "T": "7",
  "u": "|_|", "U": "|_|",
  "v": "\\/", "V": "\\/",
  "w": "\\/\\/", "W": "\\/\\/",
  "x": "><", "X": "><",
  "y": "`/", "Y": "`/",
  "z": "2", "Z": "2",
};
// 反向映射：多对一时取首次出现；多字符 token 按长度降序匹配
const LEET_REVERSE = (() => {
  const m = {};
 // 按价值长度倒序，长 token 优先（避免短 token 截断长 token）
  const entries = Object.entries(LEET_MAP).sort((a, b) => b[1].length - a[1].length);
  for (const [k, v] of entries) {
    if (!(v in m)) m[v] = k;  // 首次出现优先
  }
  return m;
})();
const LEET_TOKENS = Object.keys(LEET_REVERSE).sort((a, b) => b.length - a.length);
function leetEncode(text) {
  let out = "";
  for (const ch of text) {
    if (ch in LEET_MAP) out += LEET_MAP[ch];
    else out += ch;
  }
  return out;
}
function leetDecode(text) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    let matched = false;
    for (const tok of LEET_TOKENS) {
      if (text.startsWith(tok, i)) {
        out += LEET_REVERSE[tok];
        i += tok.length;
        matched = true;
        break;
      }
    }
    if (!matched) { out += text[i]; i++; }
  }
  return out;
}

// ============ netbios（半字节 + A 偏移）============
// 每字节拆高低 4 位，每个 4 位值 + 'A' (65) → 字符
// 例：'A'(0x41) → 高4=4→'E', 低4=1→'B' → "EB"
function netbiosEncode(text) {
  const bytes = te(text);
  let out = "";
  for (const b of bytes) {
    const hi = (b >> 4) & 0xf;
    const lo = b & 0xf;
    out += String.fromCharCode(65 + hi) + String.fromCharCode(65 + lo);
  }
  return out;
}
function netbiosDecode(text) {
  const s = text.trim().replace(/\s+/g, "");
  if (s.length % 2 !== 0) throw new Error("netbios: 长度须为偶数");
  if (!/^[A-Pa-p]+$/.test(s)) throw new Error("netbios: 字符须在 A-P 范围内");
  const bytes = [];
  for (let i = 0; i < s.length; i += 2) {
    const hi = (s[i].toUpperCase().charCodeAt(0) - 65) & 0xf;
    const lo = (s[i + 1].toUpperCase().charCodeAt(0) - 65) & 0xf;
    bytes.push((hi << 4) | lo);
  }
  return td(bytes);
}

// ============ caretMdecode（^X / M-X 控制字符表示法）============
// ^X：Ctrl+X，字母 → X & 0x1F（控制字符 0-31）
// M-X：Meta-X，字母 → (X & 0x7F) | 0x80（高位字符 128-255）
// 双向：encode 输入字节流 → ^X / M-X 表示；decode 反之
// 注：处理单字节流（latin1），每字符 charCode & 0xff 当一个字节
// 这样含高位字节的字节流能正确往返（与 UTF-8 解码语义不同）。
function caretMEncode(text) {
  const bytes = [...text].map(c => c.charCodeAt(0) & 0xff);
  let out = "";
  for (const b of bytes) {
    if (b === 0) {
      out += "^@";
    } else if (b < 32) {
 // 控制字符 → ^X（X = b + 64，如 1 → ^A，27 → ^[，13 → ^M）
      out += "^" + String.fromCharCode(b + 64);
    } else if (b === 127) {
      out += "^?";
    } else if (b < 128) {
      out += String.fromCharCode(b);
    } else {
 // 高位字符 → M-X（X = b & 0x7F）
      const lo = b & 0x7f;
      if (lo < 32) out += "M-^" + String.fromCharCode(lo + 64);
      else if (lo === 127) out += "M-^?";
      else out += "M-" + String.fromCharCode(lo);
    }
  }
  return out;
}
function caretMDecode(text) {
  const bytes = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "^") {
 // ^X → X & 0x1F
      const next = text[i + 1];
      if (!next) throw new Error("caretMdecode: ^ 后缺字符");
      if (next === "?") { bytes.push(127); i += 2; }
      else if (next === "@") { bytes.push(0); i += 2; }
      else if (next >= "A" && next <= "Z") { bytes.push(next.charCodeAt(0) & 0x1f); i += 2; }
      else if (next >= "a" && next <= "z") { bytes.push(next.charCodeAt(0) & 0x1f); i += 2; }
      else { bytes.push(94); i++; }  // ^ 不是转义
    } else if (ch === "M" && text[i + 1] === "-") {
 // M-X 或 M-^X
      if (text[i + 2] === "^") {
        const next = text[i + 3];
        if (!next) throw new Error("caretMdecode: M-^ 后缺字符");
        let lo;
        if (next === "?") lo = 127;
        else if (next === "@") lo = 0;
        else lo = next.charCodeAt(0) & 0x1f;
        bytes.push(lo | 0x80);
        i += 4;
      } else {
        const next = text[i + 2];
        if (!next) throw new Error("caretMdecode: M- 后缺字符");
        bytes.push((next.charCodeAt(0) & 0x7f) | 0x80);
        i += 3;
      }
    } else {
      bytes.push(ch.charCodeAt(0) & 0xff);
      i++;
    }
  }
 // 用 latin1 还原（每字节 → 一个字符），与 encode 的字节流对称
  return bytes.map(b => String.fromCharCode(b)).join("");
}

// ============ natoAlphabet（北约音标字母表）============
const NATO_MAP = {
  "A": "Alpha", "B": "Bravo", "C": "Charlie", "D": "Delta", "E": "Echo",
  "F": "Foxtrot", "G": "Golf", "H": "Hotel", "I": "India", "J": "Juliet",
  "K": "Kilo", "L": "Lima", "M": "Mike", "N": "November", "O": "Oscar",
  "P": "Papa", "Q": "Quebec", "R": "Romeo", "S": "Sierra", "T": "Tango",
  "U": "Uniform", "V": "Victor", "W": "Whiskey", "X": "X-ray", "Y": "Yankee",
  "Z": "Zulu",
  "0": "Zero", "1": "One", "2": "Two", "3": "Three", "4": "Four",
  "5": "Five", "6": "Six", "7": "Seven", "8": "Eight", "9": "Niner",
  " ": "(space)",
};
const NATO_REVERSE = (() => {
  const m = {};
  for (const [k, v] of Object.entries(NATO_MAP)) m[v.toLowerCase()] = k;
  return m;
})();
function natoEncode(text) {
  let out = [];
  for (const ch of text) {
    const up = ch.toUpperCase();
    if (up in NATO_MAP) out.push(NATO_MAP[up]);
    else out.push(ch);
  }
  return out.join(" ");
}
function natoDecode(text) {
  const tokens = text.trim().split(/[\s,;]+/).filter(Boolean);
  let out = "";
  for (const t of tokens) {
    const key = t.toLowerCase();
    if (key in NATO_REVERSE) out += NATO_REVERSE[key];
    else out += t;
  }
  return out;
}

// ============ asciiControl（控制字符解码）============
// control_map 表（0-32 + 127 → (名称, Unicode 符号)）
const ASCII_CONTROL_MAP = {
  0: ["NUL", "\u2400"], 1: ["SOH", "\u2401"], 2: ["STX", "\u2402"], 3: ["ETX", "\u2403"],
  4: ["EOT", "\u2404"], 5: ["ENQ", "\u2405"], 6: ["ACK", "\u2406"], 7: ["BEL", "\u2407"],
  8: ["BS", "\u2408"], 9: ["HT", "\u2409"], 10: ["LF", "\u240A"], 11: ["VT", "\u240B"],
  12: ["FF", "\u240C"], 13: ["CR", "\u240D"], 14: ["SO", "\u240E"], 15: ["SI", "\u240F"],
  16: ["DLE", "\u2410"], 17: ["DC1", "\u2411"], 18: ["DC2", "\u2412"], 19: ["DC3", "\u2413"],
  20: ["DC4", "\u2414"], 21: ["NAK", "\u2415"], 22: ["SYN", "\u2416"], 23: ["ETB", "\u2417"],
  24: ["CAN", "\u2418"], 25: ["EM", "\u2419"], 26: ["SUB", "\u241A"], 27: ["ESC", "\u241B"],
  28: ["FS", "\u241C"], 29: ["GS", "\u241D"], 30: ["RS", "\u241E"], 31: ["US", "\u241F"],
  32: ["SP", "\u2420"], 127: ["DEL", "\u2421"],
};
const ASCII_CONTROL_BY_NAME = (() => {
  const m = {};
  for (const [k, v] of Object.entries(ASCII_CONTROL_MAP)) m[v[0].toUpperCase()] = Number(k);
  return m;
})();
function asciiControlRun(text, p) {
  const mode = (p && p.mode) || "name";
  const s = text.trim();
  if (!s) return "（空输入）";
  if (mode === "name") {
 // 输入控制字符名称（如 NUL SOH LF），输出名称+符号+ASCII 值
    const tokens = s.split(/[\s,]+/).filter(Boolean);
    const lines = [];
    for (const t of tokens) {
      const up = t.toUpperCase();
      if (up in ASCII_CONTROL_BY_NAME) {
        const code = ASCII_CONTROL_BY_NAME[up];
        const [name, sym] = ASCII_CONTROL_MAP[code];
        lines.push(`ASCII 值: ${code}, 名称: ${name}, 符号: ${sym}`);
      } else {
 // fallback：字符的 ASCII 码
        const codes = [...t].map(c => c.charCodeAt(0)).join(" ");
        lines.push(`ASCII 值: ${codes}, 名称: ${t}, 符号: ${t}`);
      }
    }
    return lines.join("\n");
  } else {
 // char 模式：输入字符流，把控制字符替换为名称
    const out = [];
    for (const ch of [...s]) {
      const cp = ch.codePointAt(0);
      if (cp in ASCII_CONTROL_MAP) {
        const [name, sym] = ASCII_CONTROL_MAP[cp];
        out.push(`[${name}]`);
      } else {
        out.push(ch);
      }
    }
    return out.join("");
  }
}

// ============ 注册 ============
register({
  id: "utf7", cat: "text", name: "UTF-7 编码",
  desc: "RFC 2152（+...- 修改 base64，UTF-16BE）",
  encode: utf7Encode, decode: utf7Decode,
  detect: (t) => (/\+[A-Za-z0-9+\/]+-/.test(t) ? 0.4 : 0),
});

register({
  id: "punycode", cat: "text", name: "Punycode (IDN)",
  desc: "RFC 3492 国际化域名（xn-- 前缀，按 . 分段）",
  encode: punycodeEncode, decode: punycodeDecode,
  detect: (t) => (/xn--[A-Za-z0-9-]+/i.test(t) ? 0.5 : 0),
});

register({
  id: "jsHex", cat: "text", name: "JS Hex 转义",
  desc: "\\xXX 字节转义（与 \\uXXXX 不同，按字节非字符）",
  params: [
    { key: "mode", label: "encode 模式", type: "select", default: "nonascii",
      options: [
        { value: "nonascii", label: "仅非可打印 / 非 ASCII" },
        { value: "all", label: "全部字节转义" },
      ],
    },
  ],
  encode: jsHexEncode, decode: jsHexDecode,
  detect: (t) => (/\\x[0-9a-fA-F]{2}/.test(t) ? 0.5 : 0),
});

register({
  id: "mixHexOctBin", cat: "text", name: "混排进制解码",
  desc: "0x/0b/0o/0d 前缀混排数字串解码为字符",
  run: mixHexOctBinRun,
});

register({
  id: "hexReverse", cat: "text", name: "Hex 字节内反转",
  desc: "每两位 hex 组内互换（1a2b → a1b2，自反）",
  encode: hexReverse, decode: hexReverse,
  detect: (t) => (/^[0-9a-fA-F\s]+$/.test(t) && t.replace(/\s/g, "").length % 2 === 0 ? 0.2 : 0),
});

register({
  id: "leetSpeak", cat: "text", name: "Leet Speak (1337)",
  desc: "经典 1337 字母替换（A→4, E→3, O→0 等）",
  encode: leetEncode, decode: leetDecode,
});

register({
  id: "netbios", cat: "text", name: "NetBIOS 编码",
  desc: "半字节 + A 偏移（每字节拆 4 位 + 'A'）",
  encode: netbiosEncode, decode: netbiosDecode,
  detect: (t) => (/^[A-Pa-p]+$/.test(t.replace(/\s/g, "")) && t.replace(/\s/g, "").length % 2 === 0 && t.length >= 4 ? 0.3 : 0),
});

register({
  id: "caretMdecode", cat: "text", name: "Caret/M 控制字符",
  desc: "^X = Ctrl+X（& 0x1F），M-X = Meta-X（| 0x80）",
  encode: caretMEncode, decode: caretMDecode,
  detect: (t) => (/\^[\x41-\x5a\x5f?@]/.test(t) || /M-[\x20-\x7e]/.test(t) ? 0.4 : 0),
});

register({
  id: "natoAlphabet", cat: "text", name: "NATO 音标字母",
  desc: "北约音标字母表（A→Alpha, B→Bravo, ...）",
  encode: natoEncode, decode: natoDecode,
});

register({
  id: "asciiControl", cat: "text", name: "ASCII 控制字符",
  desc: "控制字符名称 ↔ ASCII 值 + Unicode 符号",
  params: [
    { key: "mode", label: "模式", type: "select", default: "name",
      options: [
        { value: "name", label: "名称 → ASCII 值/符号" },
        { value: "char", label: "字符流 → 名称标注" },
      ],
    },
  ],
  run: asciiControlRun,
});

export {
  utf7Encode, utf7Decode,
  punycodeEncode, punycodeDecode,
  jsHexEncode, jsHexDecode,
  mixHexOctBinRun,
  hexReverse,
  leetEncode, leetDecode,
  netbiosEncode, netbiosDecode,
  caretMEncode, caretMDecode,
  natoEncode, natoDecode,
  asciiControlRun, ASCII_CONTROL_MAP,
};
