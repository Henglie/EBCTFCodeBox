/*
 * bytesIo.js — 字节保真 IO 层（单一源）
 *
 * ── 为什么需要这一层 ─────────────────────────────────────
 * JS 字符串是 UTF-16；`new TextDecoder("utf-8")` 默认 `fatal: false`，会把任何非法
 * UTF-8 字节序列**静默替换**成 U+FFFD（替换字符）。于是「hex → 原文」这类操作对
 * ≥0x80 的字节是**不可逆的静默损坏**：
 *
 *     base16.decode("8950ff80")  →  "\uFFFD P \uFFFD \uFFFD"
 *     （89 50 是 PNG 魔数前两字节；ff 80 也是合法字节 —— 三个字节全丢）
 *
 * 全仓有 81 个 core 文件使用 `fatal: false`，且 133 个文件各自实现了一份
 * hexToBytes / b64ToBytes —— 同一个缺陷被复制了上百遍。本层是这些转换的**唯一来源**。
 *
 * ── 契约 ────────────────────────────────────────────────
 *   1. 一切「hex / base64 ↔ 字节」的转换只在本层实现；其余模块 import 本层，不再各写一份。
 *   2. 「字节 → 文本」必须显式区分**无损**与**含非法序列**；调用方不得假设总能得到文本。
 *   3. 非 UTF-8 载荷一律交回**无损且人类可判断**的表示 + 原始字节，绝不静默替换。
 *      **默认表示是 `\xNN` 转义**（`\x89PNG\r\n\x1a\n`）—— 人类一眼判断，且可直接复制去解第二轮。
 *   4. 本层纯函数、零第三方依赖、零 DOM；可 Node 直测、可 Worker 调用。
 *
 * ── 边界（刻意如此，不是遗漏）────────────────────────────
 *   `finishBytesDecode` 的判据是「能否**无损 UTF-8 解码**」。含 NUL（U+0000）或其它控制字符、
 *   但字节序列本身合法的载荷，**仍然返回字符串** —— 这与旧行为一致（旧行为也只在这些字节非法时
 *   才产出 U+FFFD），所以是零回归。本层要修的是**不可逆的静默替换**，不是「文本 vs 二进制」的口味判断。
 *   需要更严判据（排除 NUL 等）的调用方请显式用 `looksLikeText()`。
 *
 * ── 权威依据 ────────────────────────────────────────────
 *   UTF-8：RFC 3629（非法序列必须被识别，而不是替换后继续）
 *   魔数识别：PNG ISO/IEC 15948 · JPEG ITU-T T.81 · GIF87a/89a · BMP（Microsoft 位图格式）
 *            · ZIP APPNOTE.TXT · GZIP RFC 1952 · PDF ISO 32000 · 7z · RAR · ELF · PE · RIFF/WAVE
 */

const HEX_ALPHA = "0123456789abcdef";

/** hex 串 → 字节。**无损**：长度必须为偶数、字符必须是 hex，否则抛错（不静默丢字符）。 */
export function hexToBytes(hex) {
  const s = String(hex == null ? "" : hex).trim();
  if (s.length % 2 !== 0) throw new Error("hex 长度必须为偶数（当前 " + s.length + "）");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) {
    const hi = HEX_ALPHA.indexOf(s[i].toLowerCase());
    const lo = HEX_ALPHA.indexOf(s[i + 1].toLowerCase());
    if (hi < 0 || lo < 0) throw new Error("非法 hex 字符：" + JSON.stringify(s.slice(i, i + 2)));
    out[i / 2] = (hi << 4) | lo;
  }
  return out;
}

/** 字节 → hex。upper 默认小写（与 varint/ieee754 等既有输出习惯对齐由调用方显式指定）。 */
export function bytesToHex(bytes, opts) {
  const o = opts || {};
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const sep = o.space ? " " : "";
  const parts = new Array(b.length);
  for (let i = 0; i < b.length; i++) {
    const h = b[i].toString(16).padStart(2, "0");
    parts[i] = o.upper ? h.toUpperCase() : h;
  }
  return parts.join(sep);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** base64 串 → 字节。**无损**：非法字符抛错，不跳过。 */
export function b64ToBytes(s) {
  const t = String(s == null ? "" : s).replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const out = [];
  let buf = 0, bits = 0;
  for (const c of t) {
    const v = B64.indexOf(c);
    if (v < 0) throw new Error("非法 base64 字符：" + JSON.stringify(c));
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xff); }
  }
  return new Uint8Array(out);
}

/** 字节 → base64。 */
export function bytesToB64(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let out = "";
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] +
      (i + 1 < b.length ? B64[(n >> 6) & 63] : "=") +
      (i + 2 < b.length ? B64[n & 63] : "=");
  }
  return out;
}

/**
 * 无损 UTF-8 解码。
 * @returns {{ok:true,text:string}} 或 {{ok:false,reason:string,badAt:number}}
 * 用 `fatal: true` —— 非法序列**报错而不是替换**，这是本层存在的全部理由。
 * 另加 `ignoreBOM: true` —— 默认解码器会**吞掉起始 BOM**（EF BB BF），使
 * `efbbbf41` 解成 "A"、重编码只剩 41，BOM 静默丢失；置真后 U+FEFF 原样保留，
 * 文本重编码可精确还原 EF BB BF 41。无 BOM 的普通文本行为不变。
 */
export function decodeUtf8Lossless(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(b) };
  } catch (e) {
    return { ok: false, reason: (e && e.message) ? e.message : "非法 UTF-8 序列" };
  }
}

/**
 * 有损 UTF-8 解码（best-effort）。
 *
 * **这是全仓唯一允许出现 `fatal: false` 的地方。** 其余模块一律 import 本函数，
 * 不再各自写 `new TextDecoder("utf-8", { fatal: false })`（原先 80+ 份副本）。
 *
 * 何时该用：调用方**已经决定**「我要一段可读文本」，且无法携带字节
 * （例如把任意字节拼进一段诊断信息里）。
 * 何时不该用：**解码出口**。那里用 `finishBytesDecode` —— 否则会用 U+FFFD 静默损坏数据。
 */
export function decodeUtf8Lossy(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  return new TextDecoder("utf-8", { fatal: false }).decode(b);
}

/** 任意字符集的有损解码器（GBK / Big5 / Shift_JIS / EBCDIC …）。同样只在「确实要文本」时用。 */
export function lossyDecoder(label) {
  return new TextDecoder(label || "utf-8", { fatal: false });
}

/** 可当 `decoder.decode(x)` 直接替换 `new TextDecoder("utf-8", { fatal: false })` 的对象形态。 */
export const LOSSY_UTF8 = { decode: decodeUtf8Lossy };

// 魔数表：按「权威规范」列，不猜。长前缀优先匹配。
const MAGIC = [
  { name: "PNG 图像", mime: "image/png", ext: "png", sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], src: "ISO/IEC 15948" },
  { name: "JPEG 图像", mime: "image/jpeg", ext: "jpg", sig: [0xff, 0xd8, 0xff], src: "ITU-T T.81" },
  { name: "GIF 图像", mime: "image/gif", ext: "gif", sig: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], src: "GIF89a" },
  { name: "GIF 图像", mime: "image/gif", ext: "gif", sig: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], src: "GIF87a" },
  { name: "BMP 图像", mime: "image/bmp", ext: "bmp", sig: [0x42, 0x4d], src: "Microsoft 位图格式" },
  { name: "ICO 图标", mime: "image/x-icon", ext: "ico", sig: [0x00, 0x00, 0x01, 0x00], src: "Microsoft ICO 格式" },
  { name: "ZIP 归档", mime: "application/zip", ext: "zip", sig: [0x50, 0x4b, 0x03, 0x04], src: "APPNOTE.TXT" },
  { name: "ZIP 归档（空）", mime: "application/zip", ext: "zip", sig: [0x50, 0x4b, 0x05, 0x06], src: "APPNOTE.TXT" },
  { name: "GZIP 流", mime: "application/gzip", ext: "gz", sig: [0x1f, 0x8b], src: "RFC 1952" },
  { name: "PDF 文档", mime: "application/pdf", ext: "pdf", sig: [0x25, 0x50, 0x44, 0x46, 0x2d], src: "ISO 32000" },
  { name: "7z 归档", mime: "application/x-7z-compressed", ext: "7z", sig: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], src: "7-Zip 格式" },
  { name: "RAR 归档（v4）", mime: "application/vnd.rar", ext: "rar", sig: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00], src: "RAR 格式" },
  { name: "RAR 归档（v5）", mime: "application/vnd.rar", ext: "rar", sig: [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00], src: "RAR5 格式" },
  { name: "ELF 可执行/目标文件", mime: "application/x-elf", ext: "elf", sig: [0x7f, 0x45, 0x4c, 0x46], src: "ELF 规范" },
  { name: "PE 可执行文件", mime: "application/vnd.microsoft.portable-executable", ext: "exe", sig: [0x4d, 0x5a], src: "PE 格式" },
  { name: "Java class", mime: "application/java-vm", ext: "class", sig: [0xca, 0xfe, 0xba, 0xbe], src: "JVM 规范" },
  { name: "OGG 容器", mime: "application/ogg", ext: "ogg", sig: [0x4f, 0x67, 0x67, 0x53], src: "Ogg 规范" },
  { name: "RIFF 容器（WAV/AVI/WebP）", mime: "application/riff", ext: "riff", sig: [0x52, 0x49, 0x46, 0x46], src: "RIFF 规范" },
  { name: "SQLite 数据库", mime: "application/vnd.sqlite3", ext: "sqlite", sig: [0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00], src: "SQLite 文件格式" },
  { name: "MP3 音频（含 ID3 标签）", mime: "audio/mpeg", ext: "mp3", sig: [0x49, 0x44, 0x33], src: "ID3v2 规范" },
];

/** 按魔数识别字节流类型。返回 null 表示未命中已知格式（不猜）。 */
export function sniffMagic(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  // WebP 是 RIFF 容器的一种，签名在偏移 8（RIFF....WEBP），不能靠前缀表匹配。
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return { name: "WebP 图像", mime: "image/webp", ext: "webp", src: "RIFF/WEBP" };
  }
  for (const m of MAGIC) {
    if (b.length < m.sig.length) continue;
    let hit = true;
    for (let i = 0; i < m.sig.length; i++) if (b[i] !== m.sig[i]) { hit = false; break; }
    if (hit) return { name: m.name, mime: m.mime, ext: m.ext, src: m.src };
  }
  return null;
}

/** 判断字节流是否「像文本」：无 NUL 且无损 UTF-8 可解。 */
export function looksLikeText(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!b.length) return true;
  for (let i = 0; i < b.length; i++) if (b[i] === 0) return false;
  return decodeUtf8Lossless(b).ok;
}

/**
 * 字节 → 可读转义文本（**无损**、人类可直接判断、可复制继续解码）。
 *
 * 规则：可打印 ASCII（0x20–0x7E，**含反斜杠本身**）以外的字节一律写成 `\xNN`。
 * 反斜杠（0x5C）**必须转义** —— 否则数据里本来就有的 `\x41` 会被下一个解码器误读成 `A`，
 * 往返就不再无损（`jsHex` 的编码器原先正缺这一条，见 textExt.js）。
 *
 * 为什么这是默认表示（而不是 hex 或报告）：
 *   `\x89PNG\r\n\x1a\n` 人类一眼看出是 PNG；`Hello\xffWorld` 一眼看出是「文本 + 一个杂散字节」。
 *   纯 hex（`89504e47…`）要靠心算，报告则**把内容换成了描述**，用户没法复制去解第二轮。
 *   本函数的输出可被现用的 `jsHex` op 无损解回（它已有 `detect`，一把梭能自动识别）。
 */
export function bytesToEscapedText(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let out = "";
  for (let i = 0; i < b.length; i++) {
    const c = b[i];
    if (c >= 0x20 && c <= 0x7e && c !== 0x5c) out += String.fromCharCode(c);
    else out += "\\x" + c.toString(16).padStart(2, "0");
  }
  return out;
}

/** 按魔数给下载产物起名：`<name>.png` / `<name>.bin`。 */
function payloadFile(b, name) {
  const magic = sniffMagic(b);
  const base = name ? String(name).replace(/\.[^.]+$/, "") : "decoded";
  return {
    name: base + "." + (magic ? magic.ext : "bin"),
    mime: magic ? magic.mime : "application/octet-stream",
    bytes: b,
  };
}

/**
 * 二进制载荷的统一交付形态（人话报告版）。
 * 返回 `{ text, files }`：text 是人话报告（说明这是二进制、是什么格式、给了多少字节），
 * files 交回**原始字节**供下载 —— 用户不必再手拷 hex。
 *
 * 注意：报告文本**不是**内容本身（是描述），所以**不能进配方链**
 * （`transitTextOf` 会拒绝，这是刻意的护栏）。需要能继续串链的场合请用默认的 `"escape"`
 * 或 `"hex"` —— 两者都是无损形态，护栏都接受。
 */
export function binaryPayloadResult(bytes, opts) {
  const o = opts || {};
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const magic = sniffMagic(b);
  const head = bytesToHex(b.subarray(0, Math.min(16, b.length)), { space: true });
  const lines = [];
  lines.push("解出的不是文本，而是**二进制数据** —— 已按原字节交回，未做任何替换。");
  lines.push("");
  lines.push("字节数: " + b.length);
  if (magic) lines.push("格式识别: " + magic.name + "（依据 " + magic.src + "）");
  else lines.push("格式识别: 未命中已知魔数（不做猜测）");
  lines.push("起始字节: " + head + (b.length > 16 ? " …" : ""));
  lines.push("");
  lines.push("（旧行为会把 ≥0x80 的字节静默替换成 U+FFFD 而损坏数据；现在改为交回原始字节。"
    + "若你本来就想看文本，请确认输入确实是文本的编码。）");
  return { text: lines.join("\n"), files: [payloadFile(b, o.name)] };
}

/**
 * 所有「解码成字节」的 op 的统一收口。
 *
 * - 字节是合法 UTF-8 → 返回字符串（**与旧行为完全一致**，零破坏）
 * - 否则 → 返回 `{ text, files }`，text 是**无损且人类可判断**的表示，绝不静默替换
 *
 * @param opts.textMode
 *   - `"escape"`（**默认**）：`\xNN` 转义（见 `bytesToEscapedText`）。
 *     `\x89PNG\r\n\x1a\n` / `Hello\xffWorld` —— 人类一眼判断，且**可直接复制**去解第二轮
 *     （现用 `jsHex` op 有 `detect`，一把梭能自动识别）。
 *   - `"hex"`：字节的小写 hex。需要「严格 hex 形态」的场合（如 op 自身就是 hex 视图）。
 *   - `"report"`：人话报告。**只适合「产物即终点」的 op**（修图 / 修文件）——
 *     报告文本不是内容本身，用户没法复制去解第二轮，所以**不能当默认**。
 *
 * 三种模式都无损（前两种可由 hex/jsHex 精确解回；报告则随附原始字节）。
 * 配方链护栏 `productResult.transitTextOf` 只接受前两种形态。
 */
export function finishBytesDecode(bytes, opts) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const loss = decodeUtf8Lossless(b);
  if (loss.ok) return loss.text;
  const o = opts || {};
  const mode = o.textMode || "escape";
  if (mode === "hex") {
    return { text: bytesToHex(b), files: [payloadFile(b, o.name)] };
  }
  if (mode === "report") {
    return binaryPayloadResult(b, o);
  }
  return { text: bytesToEscapedText(b), files: [payloadFile(b, o.name)] };
}

export default {
  hexToBytes, bytesToHex, b64ToBytes, bytesToB64,
  decodeUtf8Lossless, decodeUtf8Lossy, lossyDecoder, LOSSY_UTF8,
  sniffMagic, looksLikeText, bytesToEscapedText,
  binaryPayloadResult, finishBytesDecode,
};
