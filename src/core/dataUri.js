/*
 * dataUri.js — RFC 2397 data: URI 的字节级编解码（单一源）。
 *
 * 为什么单独一层：data URI 的 data 段是**字节**，不是字符串。用 decodeURIComponent /
 * b64decodeStr 会把图片等二进制载荷当文本处理，轻则乱码、重则静默丢字节。这里只做
 * 「URI 文本 ↔ 原始字节」的无损转换，报告/文件命名留给调用方。
 *
 * 契约：
 *   - decodeDataUri 返回 { mime, base64, attrs, bytes }，bytes 永远是原始字节。
 *   - 非 base64 段按 percent-encoding 逐字节还原；未转义的 Unicode 字符按 UTF-8 取字节。
 *   - base64 段允许空白与 URL-safe 字母表（-/_）；非法字符显式抛错，不静默跳过。
 *   - 纯函数、零 DOM、零第三方依赖，Node 与浏览器共用。
 */
import { b64ToBytes, bytesToB64 } from "./bytesIo.js";

/** percent-encoding 文本 → 原始字节（'%XX' 还原；其余字符按 UTF-8 编码）。 */
export function percentDecodeToBytes(text) {
  const s = String(text == null ? "" : text);
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "%" && i + 2 < s.length + 1 && /^[0-9a-f]{2}$/i.test(s.slice(i + 1, i + 3))) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    const cp = s.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    if (cp > 0xffff) i++;
    for (const b of new TextEncoder().encode(ch)) out.push(b);
  }
  return new Uint8Array(out);
}

/**
 * 解析 data: URI。
 * @returns {{mime:string, base64:boolean, attrs:string[], bytes:Uint8Array}}
 */
export function decodeDataUri(uri) {
  const s = String(uri == null ? "" : uri).trim();
  const m = /^data:([^,]*),([\s\S]*)$/i.exec(s);
  if (!m) throw new Error("非法 data URI（需 data:[<mime>][;base64],<data>）");
  const meta = m[1];
  let payload = m[2];
  let mime = "";
  let base64 = false;
  const attrs = [];
  for (const raw of meta.split(";")) {
    const part = raw.trim();
    if (!part) continue;
    if (/^base64$/i.test(part)) { base64 = true; continue; }
    if (part.includes("=")) { attrs.push(part); continue; }
    if (!mime) mime = part;
    else attrs.push(part);
  }
  if (!mime) mime = "text/plain";
  if (base64 && /%[0-9a-f]{2}/i.test(payload)) {
    payload = new TextDecoder("utf-8", { fatal: false }).decode(percentDecodeToBytes(payload));
  }
  const bytes = base64 ? b64ToBytes(payload) : percentDecodeToBytes(payload);
  return { mime, base64, attrs, bytes };
}

/** 文本 → data URI。useBase64=false 时用 percent-encoding（RFC 2397 默认形态）。 */
export function encodeDataUriText(text, mime = "text/plain", useBase64 = false) {
  const str = String(text == null ? "" : text);
  const type = mime || "text/plain";
  if (useBase64) {
    return "data:" + type + ";base64," + bytesToB64(new TextEncoder().encode(str));
  }
  return "data:" + type + "," + encodeURIComponent(str);
}

/** 原始字节 → data URI。 */
export function encodeDataUriBytes(bytes, mime = "application/octet-stream", useBase64 = true) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const type = mime || "application/octet-stream";
  if (useBase64) return "data:" + type + ";base64," + bytesToB64(b);
  return "data:" + type + "," + Array.from(b, (x) => "%" + x.toString(16).toUpperCase().padStart(2, "0")).join("");
}

export default { percentDecodeToBytes, decodeDataUri, encodeDataUriText, encodeDataUriBytes };
