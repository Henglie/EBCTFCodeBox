/*
 * memeCodecs.js — 中文互联网迷因编码三件套（均双向）。
 *
 * 1. 哦齁编码（仙子曰）：可逆 Base7，前缀「仙子曰：」；短文本明文 + 协议头，
 *    ≥200 字节自动 gzip/deflate。协议来自 yikakia/xianzi 的 design.md 与实现。
 * 2. 哈基米加密：UTF-16 码元 → 三进制（哈/基/米），每字符带 0..8 随机偏移 +
 *    可选私钥位移；纯混淆，不是密码学加密。规格来自 01Petard/hajimi-encoder。
 * 3. 杂鱼密语（Base8 开源版）：可/是/杂/鱼/哦/🥵/♥/~ 八进制大整数编码。
 *    注意：这是 youzijiang233/zakocode 的开源版本，**不是** zako.yhgf.top 那个
 *    AES-256-GCM + 不可见 Unicode 的闭源「杂鱼密语」（后者无公开规格）。
 *
 * 纯逻辑、零 DOM；压缩走 compress.js 的 CompressionStream + 纯 JS 兜底。
 */
import { register } from "./registry.js";
import { streamCompress, streamDecompress } from "./compress.js";
import { decodeUtf8Lossless, finishBytesDecode } from "./bytesIo.js";
import { randomBytes as randBytes } from "./randSource.js";

function bytesToText(bytes, name) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const loss = decodeUtf8Lossless(b);
  if (loss.ok) return loss.text;
  return finishBytesDecode(b, { textMode: "escape", name });
}

// ============================================================
// 1. 哦齁编码（仙子曰）— Base7 + 协议头
// ============================================================
const XZ_CHARSET = ["哦", "齁", "♥", "啊", "呜", "嗯", "唔"];
const XZ_PREFIX = "仙子曰：";

function xzBytesToBase7(bytes) {
  let out = "";
  for (const byte of bytes) {
    let b = byte;
    const d = new Array(3);
    for (let i = 2; i >= 0; i--) { d[i] = b % 7; b = Math.floor(b / 7); }
    out += XZ_CHARSET[d[0]] + XZ_CHARSET[d[1]] + XZ_CHARSET[d[2]];
  }
  return out;
}

function xzBase7ToBytes(text) {
  // ❤️ = U+2764 + VS16；直接粘贴时常丢失 VS16，两种都归一到 ♥。
  const s = String(text).replace(/❤️/g, "♥").replace(/❤/g, "♥").replace(/\s+/g, "");
  const digits = [];
  for (const ch of s) {
    const idx = XZ_CHARSET.indexOf(ch);
    if (idx < 0) throw new Error("仙子曰：非法字符 " + JSON.stringify(ch));
    digits.push(idx);
  }
  if (digits.length % 3 !== 0) throw new Error("仙子曰：编码长度非法（应为 3 的倍数）");
  const out = new Uint8Array(digits.length / 3);
  for (let i = 0; i < digits.length; i += 3) {
    const v = digits[i] * 49 + digits[i + 1] * 7 + digits[i + 2];
    // 三位 Base7 最大 342：>255 是非法/损坏数据，不能靠 Uint8Array 静默取模（342 会变 86）
    if (v > 255) throw new Error("仙子曰：字节值越界（三位 Base7 = " + v + " > 255），数据已损坏");
    out[i / 3] = v;
  }
  return out;
}

function xzEncodeVarint(num) {
  const parts = [];
  let n = num >>> 0;
  while (n >= 0x80) { parts.push((n & 0x7f) | 0x80); n >>>= 7; }
  parts.push(n);
  return new Uint8Array(parts);
}

function xzDecodeVarint(bytes) {
  let value = 0, shift = 0, i = 0;
  for (;;) {
    if (i >= bytes.length) throw new Error("仙子曰：Varint 不完整");
    const b = bytes[i];
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value, bytesRead: i + 1 };
    shift += 7;
    i++;
    if (shift > 31) throw new Error("仙子曰：Varint 过大");
  }
}

async function xianziEncode(text, p = {}) {
  const str = String(text == null ? "" : text);
  const payload0 = new TextEncoder().encode(str);
  const mode = String(p.compress || "auto");
  if (!["auto", "gzip", "deflate", "none"].includes(mode)) {
    throw new Error("仙子曰：压缩方式需为 auto/gzip/deflate/none");
  }
  let payload = payload0;
  let meta = new Uint8Array(0);
  let compressed = false;
  // 与参考实现一致：<200 字节不压缩（design.md 写 100，代码实际是 200）。
  if (mode !== "none" && payload0.length >= 200) {
    const fmt = mode === "auto" ? "gzip" : mode;
    payload = await streamCompress(fmt, payload0);
    meta = new Uint8Array([fmt === "gzip" ? 0x02 : 0x01]);
    compressed = true;
  }
  const control = 0x80 | (compressed ? 0x40 : 0);
  const varint = xzEncodeVarint(meta.length);
  const final = new Uint8Array(1 + varint.length + meta.length + payload.length);
  let off = 0;
  final[off++] = control;
  final.set(varint, off); off += varint.length;
  final.set(meta, off); off += meta.length;
  final.set(payload, off);
  return XZ_PREFIX + xzBytesToBase7(final).replace(/♥/g, "❤️");
}

async function xianziDecode(text) {
  let s = String(text == null ? "" : text).trim();
  const m = /^仙子曰[:：]/.exec(s);
  if (!m) throw new Error("仙子曰：输入缺少前缀「仙子曰：」");
  s = s.slice(m[0].length);
  const bytes = xzBase7ToBytes(s);
  if (!bytes.length) return "";
  const control = bytes[0];
  if ((control & 0x80) === 0) return bytesToText(bytes, "xianzi");
  let ptr = 1;
  const v = xzDecodeVarint(bytes.subarray(ptr));
  ptr += v.bytesRead;
  const metaLen = v.value;
  if (ptr + metaLen > bytes.length) throw new Error("仙子曰：元信息长度越界，数据已损坏");
  const meta = bytes.subarray(ptr, ptr + metaLen);
  ptr += metaLen;
  let payload = bytes.subarray(ptr);
  if (control & 0x40) {
    if (!meta.length) throw new Error("仙子曰：标记为已压缩，但缺少压缩算法 ID");
    const id = meta[0];
    const fmt = id === 0x01 ? "deflate" : id === 0x02 ? "gzip" : null;
    if (!fmt) throw new Error("仙子曰：不支持的压缩算法 ID " + id);
    payload = await streamDecompress(fmt, payload);
  }
  return bytesToText(payload, "xianzi");
}

register({
  id: "xianziCode", cat: "cn", name: "哦齁编码（仙子曰）",
  desc: "可逆 Base7：码表 哦/齁/♥/啊/呜/嗯/唔，前缀「仙子曰：」；每字节 3 字符。≥200 字节自动 gzip（可切 deflate），协议头带压缩标记；❤️ 与 ♥ 等价。来自 yikakia/xianzi 公开协议",
  params: [
    { key: "compress", label: "压缩方式（≥200 字节生效）", type: "select", default: "auto", options: [
      { value: "auto", label: "auto（≥200 字节用 gzip）" },
      { value: "gzip", label: "gzip" },
      { value: "deflate", label: "deflate（zlib）" },
      { value: "none", label: "不压缩" },
    ] },
  ],
  encode: xianziEncode,
  decode: xianziDecode,
  detect: (t) => (/^仙子曰[:：]/.test(String(t).trim()) ? 0.9 : 0),
});

// ============================================================
// 2. 哈基米加密 — UTF-16 码元 → 三进制（哈/基/米）
// ============================================================
const HJM_DEFAULT_MAP = ["哈", "基", "米"];

function hjmRandomShift() {
  return randBytes(1)[0] % 9;
}

function hjmParseKey(key) {
  const s = String(key || "");
  if (!s) return [];
  const digits = [];
  for (let i = 0; i < s.length; i++) {
    for (const ch of String(s.charCodeAt(i))) digits.push(Number(ch));
  }
  return digits;
}

function hjmMapping(raw) {
  const chars = Array.from(String(raw || "").trim() || HJM_DEFAULT_MAP.join(""));
  if (chars.length !== 3) throw new Error("哈基米：码表必须是 3 个不同字符");
  if (new Set(chars).size !== 3) throw new Error("哈基米：码表 3 个字符必须互不相同");
  return chars;
}

function hjmToTernary(n) {
  let x = Number(n);
  if (!x) return "0";
  let s = "";
  while (x > 0) { s = (x % 3) + s; x = Math.floor(x / 3); }
  return s;
}

// 与参考实现逐字一致：n >= len 时 JS slice 语义等价于「不移位」。
function hjmRightShift(s, n) { return s.slice(-n) + s.slice(0, -n); }
function hjmLeftShift(s, n) { return s.slice(n) + s.slice(0, n); }

function hajimiEncode(text, p = {}) {
  const input = String(text == null ? "" : text);
  const map = hjmMapping(p.mapping);
  const key = hjmParseKey(p.key);
  let out = "";
  for (let i = 0; i < input.length; i++) {
    const shift = hjmRandomShift();
    const keyShift = key.length ? key[i % key.length] : 0;
    const total = 3 + shift + keyShift;
    // String.fromCharCode 会按 16 位截断，参考实现就是这个语义。
    const code = (input.charCodeAt(i) + total) & 0xffff;
    const tri = hjmToTernary(code);
    let padded, li;
    if (tri.length <= 6) { padded = tri.padStart(6, "0"); li = 0; }
    else if (tri.length <= 9) { padded = tri.padStart(9, "0"); li = 1; }
    else if (tri.length <= 12) { padded = tri.padStart(12, "0"); li = 2; }
    else throw new Error("哈基米：字符码位过大（三进制超过 12 位）");
    const shifted = hjmRightShift(padded, shift);
    li = (li + shift) % 3;
    out += map[Math.floor(shift / 3)] + map[shift % 3] + map[li];
    for (const d of shifted) out += map[Number(d)];
  }
  return out;
}

function hajimiDecode(text, p = {}) {
  const map = hjmMapping(p.mapping);
  const rev = new Map(map.map((ch, i) => [ch, i]));
  const chars = Array.from(String(text == null ? "" : text));
  const key = hjmParseKey(p.key);
  let out = "";
  let i = 0, block = 0;
  while (i < chars.length) {
    if (i + 3 > chars.length) throw new Error("哈基米：密文在块头处截断（长度不符）");
    const rHi = rev.get(chars[i]), rLo = rev.get(chars[i + 1]);
    if (rHi == null || rLo == null) throw new Error("哈基米：块头含非码表字符");
    const shift = rHi * 3 + rLo;
    let li = rev.get(chars[i + 2]);
    if (li == null) throw new Error("哈基米：长度标识含非码表字符");
    li = (li - shift + 9) % 3;
    const len = li === 0 ? 6 : li === 1 ? 9 : 12;
    i += 3;
    if (i + len > chars.length) throw new Error("哈基米：密文在数据段处截断（长度不符）");
    let tri = "";
    for (let k = 0; k < len; k++) {
      const d = rev.get(chars[i + k]);
      if (d == null) throw new Error("哈基米：数据段含非码表字符");
      tri += d;
    }
    i += len;
    const v = parseInt(hjmLeftShift(tri, shift), 3);
    const keyShift = key.length ? key[block % key.length] : 0;
    const code = (v - 3 - shift - keyShift) & 0xffff;
    out += String.fromCharCode(code);
    block++;
  }
  return out;
}

register({
  id: "hajimiCode", cat: "cn", name: "哈基米加密（三进制）",
  desc: "哈/基/米三进制混淆：每个 UTF-16 码元 → 6/9/12 位三进制，块头带 0..8 随机偏移与长度标识；可选私钥（字符码十进制数字循环）参与位移。同一明文每次输出不同。仅混淆、不是密码学加密",
  params: [
    { key: "key", label: "私钥（可空）", type: "text", default: "", placeholder: "留空即无密钥；注意错误密钥解出乱码" },
    { key: "mapping", label: "三进制码表（3 个不同字符）", type: "text", default: "哈基米" },
  ],
  encode: hajimiEncode,
  decode: hajimiDecode,
  detect: (t) => {
    const s = String(t).trim();
    return /^[哈基米]{9,}$/.test(s) && s.length % 3 === 0 ? 0.65 : 0;
  },
});

// ============================================================
// 3. 杂鱼密语（Base8 开源版 · youzijiang233/zakocode）
// ============================================================
const ZAKO_ALPHABET = ["可", "是", "杂", "鱼", "哦", "🥵", "♥", "~"];
const ZAKO_REV = new Map(ZAKO_ALPHABET.map((ch, i) => [ch, i]));

function zakoEncode(text) {
  const bytes = new TextEncoder().encode(String(text == null ? "" : text));
  if (!bytes.length) return "";
  // 大整数语义：前导零字节在整数里不可表示（格式限制，与旧实现一致）。
  let i = 0;
  while (i < bytes.length && bytes[i] === 0) i++;
  if (i === bytes.length) return ZAKO_ALPHABET[0];
  // 逐字节 num*256n+b 是 O(n²)（100KB 要 34s）；改走 hex 字符串一次成型，O(n)。
  let hex = "";
  for (let k = i; k < bytes.length; k++) hex += bytes[k].toString(16).padStart(2, "0");
  const oct = BigInt("0x" + hex).toString(8);
  let out = "";
  for (let k = 0; k < oct.length; k++) out += ZAKO_ALPHABET[oct.charCodeAt(k) - 48];
  return out;
}

function zakoDecode(text) {
  const s = String(text == null ? "" : text).trim();
  if (!s) return "";
  let digits = "";
  for (const ch of s) {
    const v = ZAKO_REV.get(ch);
    if (v == null) throw new Error("杂鱼密语：非法字符 " + JSON.stringify(ch) + "（码表 可/是/杂/鱼/哦/🥵/♥/~）");
    digits += String(v);
  }
  // 同编码侧：按 0o 字面量一次解析，避免逐位 num*8n 的 O(n²)。
  let hex = BigInt("0o" + digits).toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytesToText(bytes, "zakocode");
}

register({
  id: "zakoCode", cat: "cn", name: "杂鱼编码（Base8 开源版）",
  desc: "开源的杂鱼 Base8 编码（youzijiang233/zakocode）：UTF-8 字节当作大整数反复除 8，码表 可/是/杂/鱼/哦/🥵/♥/~。闭源官网的「杂鱼密语」是另一套 AES-256-GCM + 不可见 Unicode 方案，见「杂鱼密语（官方版）」；本 op 只作 Base8 变体/对照",
  params: [],
  encode: zakoEncode,
  decode: zakoDecode,
  detect: (t) => {
    const s = String(t).trim();
    if (s.length < 2) return 0;
    for (const ch of s) if (!ZAKO_REV.has(ch)) return 0;
    return /[杂鱼可哦🥵♥]/.test(s) ? 0.6 : 0;
  },
});

export {
  xianziEncode, xianziDecode, XZ_CHARSET, XZ_PREFIX,
  hajimiEncode, hajimiDecode,
  zakoEncode, zakoDecode, ZAKO_ALPHABET,
};
