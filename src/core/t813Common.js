/*
 * t813Common.js — T813 批（CyberChef 小 op 移植）共用工具。
 *
 * 只被 t813*.js 引用，不进 registerAll；纯函数、零依赖、零外发。
 * 字节输入口径与 src/core/checksumExt.js 一致：优先 params.rawBytes（字节视图），
 * 无真字节时按 UTF-8 文本编码；rawBytes 与文本编码逐字节相同时让位文本层。
 */

/** 取 acceptsBytes 真字节通道（params.rawBytes）；无则 null。 */
export function rawBytesOrNull(p, text) {
  const b = p && p.rawBytes;
  if (b == null) return null;
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  const t = new TextEncoder().encode(String(text == null ? "" : text));
  if (u.length === t.length) {
    let same = true;
    for (let i = 0; i < u.length; i++) if (u[i] !== t[i]) { same = false; break; }
    if (same) return null;
  }
  return u;
}

/** 输入字节：真字节优先，否则 UTF-8 文本。 */
export function bytesOf(text, p) {
  const raw = rawBytesOrNull(p, text);
  return raw != null ? raw : new TextEncoder().encode(String(text == null ? "" : text));
}

/** 字节数组 → Latin-1 文本（保留 0x00..0xFF 原值，与 CyberChef byteArray 输出同口径）。 */
export function bytesToLatin1(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}

/** 字节数组 → 小写十六进制；delim 默认空（连续输出）。 */
export function bytesToHexLower(bytes, delim = "") {
  const out = [];
  for (const b of bytes) out.push((b >>> 4).toString(16) + (b & 0x0f).toString(16));
  return out.join(delim);
}

/** 十六进制字符串 → 字节数组（忽略空白、冒号、逗号、短横）；非法即抛错，不静默剥离。 */
export function parseHexBytes(text) {
  let t = String(text == null ? "" : text).trim();
  if (/^0[xX]/.test(t)) t = t.slice(2);
  t = t.replace(/[\s:,.-]/g, "");
  if (t.length === 0) throw new Error("十六进制输入为空");
  if (/[^0-9a-fA-F]/.test(t)) throw new Error("十六进制输入含非法字符：" + t);
  if (t.length % 2 !== 0) throw new Error("十六进制输入长度须为偶数：" + t);
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < t.length; i += 2) out[i / 2] = parseInt(t.slice(i, i + 2), 16);
  return out;
}

/** 非负整数 → base-128 varint 字节（ITU-T X.690 §8.19）。 */
export function encodeBase128(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error("varint 只接受非负整数：" + n);
  const out = [n & 0x7f];
  let v = Math.floor(n / 128);
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v = Math.floor(v / 128);
  }
  return out;
}

/** 从 bytes[i] 读一个 base-128 varint，返回 [值, 下一位置]。 */
export function decodeBase128(bytes, i) {
  let v = 0;
  while (true) {
    if (i >= bytes.length) throw new Error("OID 截断：varint 未闭合");
    const b = bytes[i++];
    v = v * 128 + (b & 0x7f);
    if ((b & 0x80) === 0) break;
  }
  return [v, i];
}
