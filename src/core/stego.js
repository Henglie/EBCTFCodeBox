/*
 * stego.js — 隐写 / 图像（cat: 'stego'）。
 *
 * 散装隐写页重写为 registry op。重写时剥离全部 CDN 外链
 * （百度统计 hm.baidu.com、Google Analytics googletagmanager、crypto-js CDN
 * bootstrap 等），只保留纯算法，符合本项目「零外发」原则。
 *
 * 收录：
 * zeroWidth 零宽字符隐写（Kei Misawa 2015-2016, MIT）：载体文本夹带隐藏消息
 * radix-4 零宽字符 U+200C/200D/202C/FEFF 编码，每字符 8 位。
 * zeroChar 零宽字符密码：明文 → 摩斯电码 → U+200B(/)U+200C(.)U+200D(-)
 * CJK 先转 \uXXXX 转义再编码。
 * zwTags Unicode Tag 走私（U+E0000 平面）：LLM prompt 注入常用载体。
 * zwVarSel 变体选择器隐写（Paul Butler 2024）：U+FE00-FE0F / U+E0100-E01EF。
 * emojiSubst emoji 替换隐写（emoji-aes 的替换层，Aaron Horler 2017）：
 * base64 字母表 ↔ 65 emoji 表 + rotation 旋转（不含 AES，那属现代加密）。
 *
 * 零宽/Tag/变体类契约：encode(隐藏明文, {cover:载体文本}) → 夹带不可见字符的文本；
 * decode(该文本) → 提取出的隐藏明文。cover 可空。
 * 源码内不可见字符一律 \u 转义书写，避免污染本文件。
 */
import { register } from "./registry.js";

const te = new TextEncoder();
const tdUtf8 = (bytes) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));

// 通用 UTF-8 ↔ base64（循环构造，避免 spread 栈溢出）
function b64Enc(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64Dec(str) {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ============================================================
// 1) zeroWidth — Kei Misawa 零宽字符隐写（MIT）
// ============================================================
// 默认码表 4 个零宽字符构成 radix-4；文本每 charCode 用 8 位 base-4 编码。
const ZW_CHARS = ["\u200c", "\u200d", "\u202c", "\ufeff"];
const ZW_RADIX = ZW_CHARS.length;
const ZW_CODELEN = Math.ceil(Math.log(65536) / Math.log(ZW_RADIX)); // = 8
const ZW_SET = new Set(ZW_CHARS);

// 自选字符集——默认兼容原码表，扩展集用更多零宽字符提高 radix 缩短编码
const ZW_CHARSETS = {
  default: ZW_CHARS, // radix-4，原码表（U+200C/200D/202C/FEFF），8 字符/charCode
  extended8: ["\u200b", "\u200c", "\u200d", "\u200e", "\u200f", "\u202c", "\u2060", "\ufeff"], // radix-8，6 字符/charCode
  full12: ["\u200b", "\u200c", "\u200d", "\u200e", "\u200f", "\u202a", "\u202c", "\u2060", "\u2061", "\u2062", "\u2063", "\ufeff"], // radix-12，5 字符/charCode
};
// detect 用全量并集（检测任何已知零宽字符，不限字符集）
const ZW_ALL_SET = new Set([...ZW_CHARSETS.default, ...ZW_CHARSETS.extended8, ...ZW_CHARSETS.full12]);

function zwGetCharset(key) {
  return ZW_CHARSETS[key] || ZW_CHARSETS.default;
}
function zwCodelen(chars) {
  return Math.ceil(Math.log(65536) / Math.log(chars.length));
}

// 隐藏文本 → 零宽字符串（每 charCode 定长 base-N，再把数字位映射成零宽字符）
// chars 可选，默认 ZW_CHARS（向后兼容原 radix-4 行为）
// 注意：radix>10 时数字 10/11 用 "a"/"b" 表示，需用 parseInt(idx, radix) / idx.toString(radix) 对称转换
function zwEncodePayload(hidden, chars = ZW_CHARS) {
  const radix = chars.length;
  const codelen = zwCodelen(chars);
  let out = "";
  for (let i = 0; i < hidden.length; i++) {
    let d = hidden.charCodeAt(i).toString(radix);
    while (d.length < codelen) d = "0" + d; // 左补零到定长
    for (const digit of d) out += chars[parseInt(digit, radix)];
  }
  return out;
}

// 零宽字符串 → 隐藏文本
function zwDecodePayload(zwStr, chars = ZW_CHARS) {
  const radix = chars.length;
  const codelen = zwCodelen(chars);
  let digits = "";
  for (const ch of zwStr) {
    const idx = chars.indexOf(ch);
    if (idx !== -1) digits += idx.toString(radix);
  }
  let out = "";
  for (let i = 0; i + codelen <= digits.length; i += codelen) {
    out += String.fromCharCode(parseInt(digits.slice(i, i + codelen), radix));
  }
  return out;
}

function zeroWidthEncode(text, p = {}) {
  const cover = p.cover || "";
  const chars = zwGetCharset(p.charset);
  const codelen = zwCodelen(chars);
  const payload = zwEncodePayload(text, chars);
  if (!cover) return payload;
 // 把 payload 按「每字符 = 一组 codelen 个零宽字符」切组，均匀插到载体各字符之后
 // 使隐写文本外观自然（等价于 Kei Misawa 的 combine，但确定性、无随机 shuffle）。
  const groups = [];
  for (let i = 0; i < payload.length; i += codelen) groups.push(payload.slice(i, i + codelen));
  const coverChars = [...cover];
  let out = "";
  let gi = 0;
  for (const ch of coverChars) {
    out += ch;
    if (gi < groups.length) out += groups[gi++];
  }
  while (gi < groups.length) out += groups[gi++]; // 剩余组追加到末尾
  return out;
}

function zeroWidthDecode(text, p = {}) {
  const chars = zwGetCharset(p.charset);
  const charSet = new Set(chars);
  let zw = "";
  for (const ch of text) if (charSet.has(ch)) zw += ch;
  if (!zw) throw new Error("未检测到零宽字符（字符集：" + (p.charset || "default") + "）");
  return zwDecodePayload(zw, chars);
}

// ============================================================
// 2) zeroChar — 零宽字符密码（摩斯 + 零宽）
// ============================================================
const MORSE_TO_CHAR = {
  ".-": "a", "-...": "b", "-.-.": "c", "-..": "d", ".": "e", "..-.": "f", "--.": "g", "....": "h",
  "..": "i", ".---": "j", "-.-": "k", ".-..": "l", "--": "m", "-.": "n", "---": "o", ".--.": "p",
  "--.-": "q", ".-.": "r", "...": "s", "-": "t", "..-": "u", "...-": "v", ".--": "w", "-..-": "x",
  "-.--": "y", "--..": "z",
  ".----": "1", "..---": "2", "...--": "3", "....-": "4", ".....": "5", "-....": "6", "--...": "7",
  "---..": "8", "----.": "9", "-----": "0",
  "--..--": ",", ".-.-.-": ".", "..--..": "?", "-..-.": "/", "-....-": "-", "-.--.": "(",
  "-.--.-": ")", ".----.": "'", "-.-.--": "!", ".-..-.": '"', "---...": ":", "-.-.-.": ";",
  "-...-": "=", ".-.-.": "+", "..--.-": "_", ".-...": "&", "...-..-": "$", ".--.-.": "@",
  ".--.-": "\\", "----.--": "{", "-----.-": "}",
};
const CHAR_TO_MORSE = {};
for (const [m, c] of Object.entries(MORSE_TO_CHAR)) CHAR_TO_MORSE[c] = m;
const MORSE_VALUES = new Set(Object.values(MORSE_TO_CHAR));

// 零宽映射：分隔符 / = U+200B ；点 . = U+200C ；划 - = U+200D
const ZC_SLASH = "\u200b";
const ZC_DOT = "\u200c";
const ZC_DASH = "\u200d";

function zeroCharEncode(text) {
 // 明文 → 可摩斯化字符序列：摩斯值直接保留；CJK 转 \uXXXX 转义后逐字符编码；其余丢弃。
  let plain = "";
  for (const ch of text) {
    if (MORSE_VALUES.has(ch)) {
      plain += ch;
    } else if (ch >= "一" && ch <= "龥") {
      plain += "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
    }
 // 其余字符（大写字母/空格等）直接丢弃
  }
  const morse = [];
  for (const c of plain) morse.push(CHAR_TO_MORSE[c]);
  let s = morse.join("/");
  s = s.replace(/\//g, ZC_SLASH).replace(/\./g, ZC_DOT).replace(/-/g, ZC_DASH);
  return s;
}

function zeroCharDecode(text) {
  let s = text;
  s = s.replace(/&#8203;/g, "/").replace(new RegExp(ZC_SLASH, "g"), "/");
  s = s.replace(/&#8204;/g, ".").replace(new RegExp(ZC_DOT, "g"), ".").replace(/&zwnj;?/g, ".");
  s = s.replace(/&#8205;/g, "-").replace(new RegExp(ZC_DASH, "g"), "-").replace(/&zwj;?/g, "-");
  s = s.replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
  if (!s) throw new Error("未检测到零宽摩斯字符（U+200B(/)U+200C(.)U+200D(-)）");
  let out = "";
  for (const tok of s.split("/")) {
    if (!tok) continue;
    const c = MORSE_TO_CHAR[tok];
    if (c === undefined) throw new Error("非法摩斯码片段: " + tok);
    out += c;
  }
 // 还原 \uXXXX 转义为 CJK
  return out.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// ============================================================
// 3) zwTags — Unicode Tag 走私（U+E0000 平面）
// ============================================================
function zwTagsEncode(text, p = {}) {
  const cover = p.cover || "";
  let payload = "";
  for (const b of te.encode(text)) payload += String.fromCodePoint(0xe0000 + b);
  return cover + payload;
}

function zwTagsDecode(text) {
  const bytes = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0xe0000 && cp <= 0xe00ff) bytes.push(cp - 0xe0000);
  }
  if (!bytes.length) throw new Error("未检测到 Unicode Tag 字符（U+E0000 平面）");
  return tdUtf8(bytes);
}

// ============================================================
// 4) zwVarSel — 变体选择器隐写（Paul Butler 2024）
// ============================================================
// 字节 0..15 → U+FE00+b ；字节 16..255 → U+E0100+(b-16)。
function zwVarSelEncode(text, p = {}) {
  const cover = p.cover || "";
  let payload = "";
  for (const b of te.encode(text)) {
    if (b < 16) payload += String.fromCodePoint(0xfe00 + b);
    else payload += String.fromCodePoint(0xe0100 + (b - 16));
  }
  return cover + payload;
}

function zwVarSelDecode(text) {
  const bytes = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0xfe00 && cp <= 0xfe0f) bytes.push(cp - 0xfe00);
    else if (cp >= 0xe0100 && cp <= 0xe01ef) bytes.push(cp - 0xe0100 + 16);
  }
  if (!bytes.length) throw new Error("未检测到变体选择器（U+FE00-FE0F / U+E0100-E01EF）");
  return tdUtf8(bytes);
}

// ============================================================
// 5) emojiSubst — emoji-aes 替换层（Aaron Horler 2017）
// ============================================================
// base64(utf8(text)) 后，把 base64 字母表逐字符替换成 emoji，支持 rotation 旋转。
const EMOJI_INIT = ["\u{1F34E}", "\u{1F34C}", "\u{1F3CE}", "\u{1F6AA}", "\u{1F441}", "\u{1F463}", "\u{1F600}", "\u{1F590}", "ℹ", "\u{1F602}", "\u{1F94B}", "✉", "\u{1F6B9}", "\u{1F309}", "\u{1F44C}", "\u{1F34D}", "\u{1F451}", "\u{1F449}", "\u{1F3A4}", "\u{1F6B0}", "☂", "\u{1F40D}", "\u{1F4A7}", "✖", "☀", "\u{1F993}", "\u{1F3F9}", "\u{1F388}", "\u{1F60E}", "\u{1F385}", "\u{1F418}", "\u{1F33F}", "\u{1F30F}", "\u{1F32A}", "☃", "\u{1F375}", "\u{1F374}", "\u{1F6A8}", "\u{1F4EE}", "\u{1F579}", "\u{1F4C2}", "\u{1F6E9}", "⌨", "\u{1F504}", "\u{1F52C}", "\u{1F405}", "\u{1F643}", "\u{1F40E}", "\u{1F30A}", "\u{1F6AB}", "❓", "⏩", "\u{1F601}", "\u{1F606}", "\u{1F4B5}", "\u{1F923}", "☺", "\u{1F60A}", "\u{1F607}", "\u{1F621}", "\u{1F383}", "\u{1F60D}", "✅", "\u{1F52A}", "\u{1F5D2}"];

// emoji-aes 的 base64 → 索引映射：a-z=0..25, A-Z=26..51, 0-9=52..61, +=62, /=63, ==64
function b64CharToIndex(c) {
  const code = c.charCodeAt(0);
  if (c >= "a" && c <= "z") return code - 97;
  if (c >= "A" && c <= "Z") return 26 + code - 65;
  if (c >= "0" && c <= "9") return 52 + code - 48;
  if (c === "+") return 62;
  if (c === "/") return 63;
  if (c === "=") return 64;
  return -1;
}
const B64_ALPHABET_BY_INDEX = (() => {
  const arr = new Array(65);
  for (let i = 0; i < 26; i++) arr[i] = String.fromCharCode(97 + i);
  for (let i = 0; i < 26; i++) arr[26 + i] = String.fromCharCode(65 + i);
  for (let i = 0; i < 10; i++) arr[52 + i] = String.fromCharCode(48 + i);
  arr[62] = "+"; arr[63] = "/"; arr[64] = "=";
  return arr;
})();

function emojiTable(rotation) {
  const rot = ((Number(rotation) || 0) % EMOJI_INIT.length + EMOJI_INIT.length) % EMOJI_INIT.length;
  if (rot === 0) return EMOJI_INIT.slice();
  const out = new Array(EMOJI_INIT.length);
  for (let i = 0; i < EMOJI_INIT.length; i++) out[i] = EMOJI_INIT[(i + rot) % EMOJI_INIT.length];
  return out;
}

function emojiSubstEncode(text, p = {}) {
  const emojis = emojiTable(p.rotation);
  const b64 = b64Enc(te.encode(text));
  let out = "";
  for (const c of b64) {
    const idx = b64CharToIndex(c);
    out += idx === -1 ? c : emojis[idx];
  }
  return out;
}

function emojiSubstDecode(text, p = {}) {
  const emojis = emojiTable(p.rotation);
 // emoji → base64 字符；按 emoji 字符串长度降序贪婪匹配，避免前缀歧义。
  const pairs = emojis.map((e, i) => [e, B64_ALPHABET_BY_INDEX[i]]).sort((a, b) => b[0].length - a[0].length);
  let b64 = "";
  let i = 0;
  outer: while (i < text.length) {
    for (const [emo, ch] of pairs) {
      if (text.startsWith(emo, i)) { b64 += ch; i += emo.length; continue outer; }
    }
    b64 += text[i++]; // 非 emoji 原样保留
  }
  return tdUtf8(b64Dec(b64));
}

// ============================================================
// 7) tadpole — 蝌蚪文加解密（res/html/Tadpole.html，剥离 AdSense）
// ============================================================
// 蝌蚪文字符表：randA 16 项（U+06D6-U+06EC 阿拉伯文装饰符），照抄 Tadpole.html L23
const TADPOLE_RANDA = [1750, 1751, 1752, 1753, 1754, 1755, 1756, 1759, 1760, 1761, 1762, 1764, 1767, 1768, 1771, 1772];
const TADPOLE_RANDS = TADPOLE_RANDA.map((cp) => String.fromCharCode(cp));
const TADPOLE_RANDO = {};
for (let i = 0; i < TADPOLE_RANDS.length; i++) TADPOLE_RANDO[TADPOLE_RANDS[i]] = i;

// 标准 base64 字母表
const TADPOLE_B64S = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const TADPOLE_B64O = {};
for (let i = 0; i < TADPOLE_B64S.length; i++) TADPOLE_B64O[TADPOLE_B64S[i]] = i;

// 蝌蚪文字符范围（U+06D6-U+06EC），用于 detect + decode regex
const TADPOLE_CHAR_RANGE = /[\u06d6-\u06ec]/;

// ============ u16 ↔ byte（UTF-8 编解码，照抄 Tadpole.html u162byte/byte2u16） ============
// header=true 时前 2 字节存长度（big-endian），decode 时跳过
function tadpoleU16ToBytes(s, header) {
  const b = [];
  if (header) b.push(0, 0);
  for (let i = 0; i < s.length; i++) {
    let j = s.charCodeAt(i);
    if (j >= 0xd800 && j < 0xe000) {
 // 代理对 → 补充平面字符
 // 原源 L232 `s.charCodeAt(i + i)` 疑似 bug（i*2 显然越界），修正为 i+1
      j = (((j & 0x3ff) << 10) | (s.charCodeAt(i + 1) & 0x3ff)) + 0x10000;
      i++;
    }
    if (j < 128) {
      b.push(j);
    } else if (j < 2048) {
      b.push(0xc0 | (j >> 6));
      b.push(0x80 | (j & 0x3f));
    } else if (j < 65536) {
      b.push(0xe0 | (j >> 12));
      b.push(0x80 | ((j >> 6) & 0x3f));
      b.push(0x80 | (j & 0x3f));
    } else {
      b.push(0xf0 | (j >> 18));
      b.push(0x80 | ((j >> 12) & 0x3f));
      b.push(0x80 | ((j >> 6) & 0x3f));
      b.push(0x80 | (j & 0x3f));
    }
  }
  if (header) {
    const len = b.length - 2;
    b[0] = (len >> 8) & 0xff;
    b[1] = len & 0xff;
  }
  return b;
}

function tadpoleBytesToU16(b, header) {
  let s = "";
  let i = header ? 2 : 0;
  while (i < b.length) {
    const byte = b[i];
    if (byte === 9) {
      s += "    "; // Tab → 4 空格（原源如此）
    } else if (byte < 32) {
      s += "\n";
    } else if (byte === 32) {
      s += " ";
    } else if (byte < 128) {
      s += String.fromCharCode(byte);
    } else if (byte < 224) {
      s += String.fromCharCode(((byte & 31) << 6) | (b[i + 1] & 63));
      i += 1;
    } else if (byte < 240) {
      s += String.fromCharCode(((byte & 15) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63));
      i += 2;
    } else {
      const j = (((byte & 7) << 18) | ((b[i + 1] & 63) << 12) | ((b[i + 2] & 63) << 6) | (b[i + 3] & 63)) - 0x10000;
      s += String.fromCharCode(0xd800 | (j >> 10), 0xdc00 | (j & 1023));
      i += 3;
    }
    i++;
  }
  return s;
}

// ============ checksum（照抄 Tadpole.html checksum） ============
function tadpoleChecksum(b) {
  let a0 = 0, a1 = 0;
  for (let i = 0; i < b.length; i++) {
    a0 = (a0 + b[i]) * 3001 % 5021;
    a1 = (a1 + a0 + b[i]) * 3011 % 5011;
  }
  return ((a0 & 0xff) | ((a1 & 0xff) << 8)) ^ 22155;
}

// ============ byte ↔ tadpole（蝌蚪文字符编解码） ============
function tadpoleBytesToTadpole(b) {
  let s = " /";
  for (let i = 0; i < b.length; i++) {
    s += TADPOLE_RANDS[b[i] >> 4] + TADPOLE_RANDS[b[i] & 15];
  }
  return s + " ";
}

function tadpoleTadpoleToBytes(s) {
  const b = [];
  let ah = -1;
  for (let i = 0; i < s.length; i++) {
    if (ah >= 0) {
      b.push(TADPOLE_RANDO[s[i]] + ah);
      ah = -1;
    } else {
      ah = TADPOLE_RANDO[s[i]] << 4;
    }
  }
  return b;
}

// ============ byte ↔ base64（照抄 Tadpole.html byte2b64/b642byte） ============
function tadpoleBytesToB64(b) {
  let s = "";
  let stat;
  let k = 0;
  for (let i = 0; i < b.length; i++) {
    stat = i % 3;
    const j = b[i];
    if (stat === 0) {
      k = j >> 2;
      s += TADPOLE_B64S[k];
      k = (j & 3) << 4;
    } else if (stat === 1) {
      k |= j >> 4;
      s += TADPOLE_B64S[k];
      k = (j & 15) << 2;
    } else {
      k |= j >> 6;
      s += TADPOLE_B64S[k];
      k = j & 63;
      s += TADPOLE_B64S[k];
    }
  }
  if (stat === 0) {
    s += TADPOLE_B64S[k] + "==";
  } else if (stat === 1) {
    s += TADPOLE_B64S[k] + "=";
  }
  return s;
}

function tadpoleB64ToBytes(s) {
  const b = [];
  let k = 0;
  for (let i = 0; i < s.length; i++) {
    const stat = i % 4;
    const j = TADPOLE_B64O[s[i]];
    if (j === undefined) continue; // 跳过 = 等
    if (stat === 0) {
      k = j << 2;
    } else if (stat === 1) {
      k |= j >> 4;
      b.push(k);
      k = (j & 15) << 4;
    } else if (stat === 2) {
      k |= j >> 2;
      b.push(k);
      k = (j & 3) << 6;
    } else {
      k |= j;
      b.push(k);
    }
  }
  return b;
}

// ============ encode / decode（对外） ============
// encode：默认 tadpole 格式；参数 format="b64" 切到 base64 包装格式 [:...:]
function tadpoleEncode(text, p = {}) {
  const format = (p && p.format) || "tadpole";
  if (format === "b64") {
 // b64 格式不带 header（原源 encodeB64 用 header=false）
    const b0 = tadpoleU16ToBytes(text, false);
    return "[:" + tadpoleBytesToB64(b0) + ":]";
  }
 // tadpole 格式带 header（前 2 字节 = 长度，参与 checksum）
  const b0 = tadpoleU16ToBytes(text, true);
  const sum = tadpoleChecksum(b0);
  const m = sum & 0xff;
  let n = (sum >> 8) & 0xff;
  const b1 = [n, m];
  for (let i = 0; i < b0.length; i++) {
    n = ((n + m + b0[i]) * 47) & 0xff;
    b1.push(n);
  }
  return tadpoleBytesToTadpole(b1);
}

// decode：自动识别 tadpole（/ 蝌蚪文 /）和 b64（[:base64:]）两种格式
function tadpoleDecode(text) {
 // 优先匹配 b64 格式 [:...:]
  const b64Match = text.match(/\[:([A-Za-z0-9+/]+={0,2}):\]/);
  if (b64Match) {
    const b0 = tadpoleB64ToBytes(b64Match[1]);
    return tadpoleBytesToU16(b0, false);
  }
 // 匹配蝌蚪文格式 / 蝌蚪文字符串 /（至少 5 对 = 10 字符）
  const tadpoleMatch = text.match(/\/([\u06d6-\u06ec]{10,})\//);
  if (!tadpoleMatch) {
 // 兼容无斜杠的纯蝌蚪文（至少 10 字符）
    const pure = text.match(/[\u06d6-\u06ec]{10,}/);
    if (!pure) throw new Error("未检测到蝌蚪文字符（U+06D6-U+06EC）或 [:base64:] 格式");
    return tadpoleDecodeTadpole(pure[0]);
  }
  return tadpoleDecodeTadpole(tadpoleMatch[1]);
}

function tadpoleDecodeTadpole(s) {
  const b1 = tadpoleTadpoleToBytes(s);
  if (b1.length < 2) throw new Error("蝌蚪文数据过短");
  const n0 = b1[0];
  const m = b1[1];
  let n = n0;
  const b0 = [];
  for (let i = 2; i < b1.length; i++) {
    b0.push((b1[i] * 207 + 512 - n - m) & 0xff);
    n = b1[i];
  }
  if (tadpoleChecksum(b0) !== (n0 << 8) + m) {
    throw new Error("蝌蚪文校验和失败（数据可能损坏）");
  }
  return tadpoleBytesToU16(b0, true);
}

// ============================================================
// 注册
// ============================================================
register({
  id: "zeroWidth", cat: "stego", name: "零宽字符隐写",
  desc: "Kei Misawa MIT：载体文本夹带隐藏消息，radix-N 零宽字符。默认 U+200C/200D/202C/FEFF（radix-4），可切换扩展字符集缩短编码",
  params: [
    { key: "cover", label: "载体文本", type: "text", default: "", placeholder: "编码时的可见外壳文本，可空" },
    { key: "charset", label: "字符集", type: "select", default: "default", options: [
      { value: "default", label: "默认（U+200C/200D/202C/FEFF，radix-4，8 字符/字）" },
      { value: "extended8", label: "扩展 8（+U+200B/200E/200F/2060，radix-8，6 字符/字）" },
      { value: "full12", label: "全量 12（+U+202A/2061/2062/2063，radix-12，5 字符/字）" },
    ] },
  ],
  encode: zeroWidthEncode, decode: zeroWidthDecode,
  detect: (t) => ([...t].some((c) => ZW_ALL_SET.has(c)) ? 0.4 : 0),
});

register({
  id: "zeroChar", cat: "stego", name: "零宽摩斯密码",
  desc: "明文→摩斯→零宽 U+200B(/)U+200C(.)U+200D(-)，CJK 走 \\uXXXX",
  encode: zeroCharEncode, decode: zeroCharDecode,
  detect: (t) => ([...t].some((c) => c === ZC_SLASH || c === ZC_DOT || c === ZC_DASH) ? 0.3 : 0),
});

register({
  id: "zwTags", cat: "stego", name: "Unicode Tag 走私",
  desc: "U+E0000 平面隐藏 ASCII/UTF-8 字节，LLM prompt 注入常用载体",
  params: [{ key: "cover", label: "载体文本", type: "text", default: "", placeholder: "可见外壳文本，可空" }],
  encode: zwTagsEncode, decode: zwTagsDecode,
  detect: (t) => ([...t].some((c) => { const cp = c.codePointAt(0); return cp >= 0xe0000 && cp <= 0xe007f; }) ? 0.6 : 0),
});

register({
  id: "zwVarSel", cat: "stego", name: "变体选择器隐写",
  desc: "Paul Butler 2024：U+FE00-FE0F / U+E0100-E01EF 附加任意字节流",
  params: [{ key: "cover", label: "载体文本", type: "text", default: "", placeholder: "可见外壳文本，可空" }],
  encode: zwVarSelEncode, decode: zwVarSelDecode,
  detect: (t) => ([...t].some((c) => { const cp = c.codePointAt(0); return (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef); }) ? 0.4 : 0),
});

register({
  id: "emojiSubst", cat: "stego", name: "emoji 替换隐写",
  desc: "emoji-aes 替换层：base64 字母表 ↔ 65 emoji 表 + rotation（不含 AES）",
  params: [{ key: "rotation", label: "旋转", type: "number", default: 0, placeholder: "0-64" }],
  encode: emojiSubstEncode, decode: emojiSubstDecode,
  detect: (t) => (EMOJI_INIT.some((e) => t.includes(e)) ? 0.3 : 0),
});

register({
  id: "tadpole", cat: "stego", name: "蝌蚪文",
  desc: "蝌蚪文加解密（U+06D6-U+06EC 装饰符 + checksum + b64 双格式）",
  params: [
    { key: "format", label: "格式", type: "select", default: "tadpole",
      options: [
        { value: "tadpole", label: "蝌蚪文（默认，/ ... /）" },
        { value: "b64", label: "Base64 包装（[:...:]）" },
      ],
    },
  ],
  encode: tadpoleEncode, decode: tadpoleDecode,
  detect: (t) => (TADPOLE_CHAR_RANGE.test(t) || /\[:[A-Za-z0-9+/]+={0,2}:\]/.test(t) ? 0.5 : 0),
});

export {
  zeroWidthEncode, zeroWidthDecode,
  zeroCharEncode, zeroCharDecode,
  zwTagsEncode, zwTagsDecode,
  zwVarSelEncode, zwVarSelDecode,
  emojiSubstEncode, emojiSubstDecode,
  ZW_CHARS, EMOJI_INIT,
  tadpoleEncode, tadpoleDecode,
  TADPOLE_RANDS, TADPOLE_CHAR_RANGE,
};
