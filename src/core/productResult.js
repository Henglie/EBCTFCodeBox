// Shared decoding for the registry's {text, files:[{name,mime,bytes|dataUrl}]} contract.
import { bytesToEscapedText, bytesToHex, bytesToB64, b64ToBytes } from "./bytesIo.js";

/**
 * UI 输出内联阈值（P0-6）：解码后 ≤128KB 的图片/base64 可内联预览，
 * 更大的只给文件名/大小/下载按钮，避免把整档 base64 铺进输出框或 `<img>`。
 */
export const PRODUCT_INLINE_MAX_BYTES = 128 * 1024;

const DATA_URL_BASE64_RE = /data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/]+={0,2})/g;

/** 按 base64 文本长度估算解码后字节数（不实际解码，容忍空白/padding）。 */
export function base64DecodedSize(input) {
  const s = String(input == null ? "" : input);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 61) continue;
    if (c === 9 || c === 10 || c === 12 || c === 13 || c === 32) continue;
    n++;
  }
  return Math.floor((n * 3) / 4);
}

/** data URL 解码后字节数估算；非 base64 data URL 返回 null。 */
export function dataUrlDecodedSize(url) {
  const s = String(url == null ? "" : url);
  if (!/^data:/i.test(s)) return null;
  const comma = s.indexOf(",");
  if (comma < 0) return null;
  if (!/(?:^|;)base64(?:;|$)/i.test(s.slice(5, comma))) return null;
  return base64DecodedSize(s.slice(comma + 1));
}

/**
 * UI 渲染分支：`inline-image` 内联 `<img>`；`download` 只给文件名/大小/下载；
 * `skip` 表示小体积非图片 data URL，保持原文本不额外渲染。
 */
export function mediaRenderPlan(mime, decodedBytes) {
  const isImage = /^image\//i.test(String(mime || ""));
  if (decodedBytes != null && decodedBytes <= PRODUCT_INLINE_MAX_BYTES) {
    return isImage ? "inline-image" : "skip";
  }
  return "download";
}

/** 扫描文本中的 base64 data URL，返回统一的渲染计划（不含 DOM）。 */
export function planDataUrlMedia(text) {
  const src = String(text == null ? "" : text);
  const plan = [];
  if (src.indexOf("data:") < 0) return plan;
  for (const m of src.matchAll(DATA_URL_BASE64_RE)) {
    const url = m[0];
    const mime = m[1] || "application/octet-stream";
    const size = dataUrlDecodedSize(url);
    const kind = mediaRenderPlan(mime, size);
    if (kind === "skip") continue;
    plan.push({ url, mime, size, kind });
  }
  return plan;
}

const _fpCache = new WeakMap();
const _fileCache = new WeakMap();

function hexVal(c) {
  if (c >= 48 && c <= 57) return c - 48;
  if (c >= 97 && c <= 102) return c - 87;
  if (c >= 65 && c <= 70) return c - 55;
  return -1;
}

function dataUrlCharOk(code) {
  return code <= 126 && (code >= 32 || code === 9 || code === 10 || code === 12 || code === 13);
}

function decodeDataUrlBase64(clean) {
  let bodyLen = clean.length;
  let pad = 0;
  while (bodyLen > 0 && clean.charCodeAt(bodyLen - 1) === 61) { pad++; bodyLen--; }
  const rem = bodyLen & 3;
  if (pad > 2 || rem === 1 || pad !== ((4 - rem) & 3)) throw new Error("Invalid data URL base64");
  for (let i = 0; i < bodyLen; i++) {
    const c = clean.charCodeAt(i);
    const ok = (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 43 || c === 47;
    if (!ok) throw new Error("Invalid data URL base64");
  }
  return b64ToBytes(clean);
}

export function parseProductDataUrl(url) {
  if (typeof url !== "string" || !url.startsWith("data:")) throw new Error("Invalid data URL");
  const comma = url.indexOf(",");
  if (comma < 0) throw new Error("Missing data URL separator");
  const meta = url.slice(5, comma);
  const semi = meta.indexOf(";");
  const type = semi < 0 ? meta : meta.slice(0, semi);
  const params = semi < 0 ? [] : meta.slice(semi + 1).split(";");
  if (type && !/^[\w.+-]+\/[\w.+-]+$/.test(type)) throw new Error("Invalid data URL MIME type");
  const data = url.slice(comma + 1);
  const isB64 = params.includes("base64");

  let text = data;
  let bytes = null;
  if (data.indexOf("%") < 0) {
    for (let i = 0; i < data.length; i++) {
      if (!dataUrlCharOk(data.charCodeAt(i))) throw new Error("Invalid data URL character");
    }
    if (!isB64) {
      bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i);
    }
  } else {
    const out = new Uint8Array(data.length);
    let oi = 0;
    for (let i = 0; i < data.length; i++) {
      const code = data.charCodeAt(i);
      if (code === 37) {
        if (i + 2 >= data.length) throw new Error("Invalid data URL percent escape");
        const hi = hexVal(data.charCodeAt(i + 1));
        const lo = hexVal(data.charCodeAt(i + 2));
        if (hi < 0 || lo < 0) throw new Error("Invalid data URL percent escape");
        out[oi++] = (hi << 4) | lo;
        i += 2;
      } else {
        if (!dataUrlCharOk(code)) throw new Error("Invalid data URL character");
        out[oi++] = code;
      }
    }
    const decoded = out.subarray(0, oi);
    if (isB64) text = new TextDecoder().decode(decoded);
    else bytes = decoded;
  }

  if (isB64) {
    const clean = text.replace(/[\t\n\f\r ]/g, "");
    bytes = decodeDataUrlBase64(clean);
  }
  return { bytes, mime: type || "application/octet-stream" };
}

export function productFileEntries(out) {
  if (!out || typeof out !== "object" || !("files" in out)) return [];
  if (!Array.isArray(out.files)) throw new Error("Product files must be an array");
  const files = [];
  for (const f of out.files) {
    if (!f || typeof f !== "object") continue;
    let bytes, mime = f.mime;
    try {
      if (f.bytes !== undefined) {
        if (f.bytes instanceof Uint8Array) bytes = f.bytes;
        else if (Array.isArray(f.bytes)) {
          for (const b of f.bytes) if (!Number.isInteger(b) || b < 0 || b > 255) throw new Error("bytes must contain integers in 0..255");
          bytes = Uint8Array.from(f.bytes);
        }
        else throw new Error("bytes must contain integers in 0..255");
      } else if (f.dataUrl !== undefined) {
        const cached = _fileCache.get(f);
        if (cached && cached.url === f.dataUrl) {
          bytes = cached.bytes;
          mime ||= cached.mime;
        } else {
          const parsed = parseProductDataUrl(f.dataUrl);
          bytes = parsed.bytes;
          mime ||= parsed.mime;
          _fileCache.set(f, { url: f.dataUrl, bytes, mime: parsed.mime });
        }
      } else continue;
    } catch (e) { throw new Error(`File ${f.name || "download.bin"}: ${e.message}`); }
    files.push({ name: String(f.name || "download.bin"), mime: mime || "application/octet-stream", bytes });
  }
  return files;
}

function fingerprint(bytes) {
  let fp = _fpCache.get(bytes);
  if (fp) return fp;
  const n = bytes.length;
  const hn = Math.min(16, n);
  const bn = Math.min(12, n);
  fp = {
    n,
    b64Len: Math.ceil(n / 3) * 4,
    b64Prefix: bn ? bytesToB64(bytes.subarray(0, bn)) : "",
    hexPrefix: hn ? bytesToHex(bytes.subarray(0, hn)) : "",
    escPrefix: hn ? bytesToEscapedText(bytes.subarray(0, hn)) : "",
    escLen: -1,
  };
  _fpCache.set(bytes, fp);
  return fp;
}

function escapedLenOf(bytes, fp) {
  if (fp.escLen >= 0) return fp.escLen;
  let len = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    len += (b >= 0x20 && b <= 0x7e && b !== 0x5c) ? 1 : 4;
  }
  fp.escLen = len;
  return len;
}

// 护栏：text 必须是该批字节的**无损表示**（Base64 / Hex / \xNN 转义）。
// 先比长度与前缀，只有形态吻合才做一次完整编码 —— 报告文本不会触发大编码。
function matchesLossless(text, bytes) {
  const fp = fingerprint(bytes);
  if (text.length === fp.b64Len && text.startsWith(fp.b64Prefix)) {
    if (text === bytesToB64(bytes)) return true;
  }
  if (text.length === fp.n * 2) {
    if (text.slice(0, fp.hexPrefix.length).toLowerCase() === fp.hexPrefix) {
      if (text.toLowerCase() === bytesToHex(bytes)) return true;
    }
  }
  if (text.length >= fp.n && text.length <= fp.n * 4) {
    if (text.length === escapedLenOf(bytes, fp) && text.startsWith(fp.escPrefix)) {
      if (text === bytesToEscapedText(bytes)) return true;
    }
  }
  return false;
}

export function productBytesBase64(bytes) {
  return bytesToB64(bytes);
}

export function transitTextOf(out) {
  if (out == null) return "";
  if (typeof out !== "object") return String(out);
  if (!("text" in out) && !("files" in out)) return JSON.stringify(out);
  const text = String(out.text ?? "");
  const files = productFileEntries(out);
  if (!files.length && !(out.files?.length)) return text;
  // 护栏本意：**不许把「报告」当作文件内容**传给下一步（报告是描述，不是内容）。
  // 因此只接受三种**无损**形态之一：base64 / hex / \xNN 转义（三者都能精确还原同一批字节）。
  // 校验在全部文件上做，任一文件的形态都不匹配才拒绝 —— 残缺的同批产物不得被放行。
  if (files.some(f => matchesLossless(text, f.bytes))) return text;
  throw new Error("配方链中转受限：文件产物的 text 不是原字节的无损表示（Base64 / Hex / \\xNN 转义）。请在链末端下载文件后另起配方，不能把报告当作文件内容。");
}

/**
 * 配方链中转载荷（F02 契约）：与 `transitTextOf` 同源，但**额外交回原始字节**。
 *
 * 返回 `{ text, bytes }`：
 *   · `bytes !== null` ⇒ 上游产物带 `files`（真字节），`text` 是它的**无损表示**
 *     （Base64 / Hex / `\xNN` 转义，护栏与 `transitTextOf` 一致）；
 *   · `bytes === null` ⇒ 上游是纯文本 / JSON，`text` 即内容本身。
 *
 * 调用方（配方执行器）据此决定：
 *   · 下游 `acceptsBytes` ⇒ 注入 `params.rawBytes`，字节**无损**进 op；
 *   · 否则 ⇒ 对 `bytes` 做**严格 UTF-8 解码**：解得出来就照常走文本，
 *     解不出来**显式拒绝** —— 绝不再把 `\xNN` 转义串当内容喂给下游（F02 根因）。
 */
export function transitPayloadOf(out) {
  if (out == null) return { text: "", bytes: null };
  if (typeof out !== "object") return { text: String(out), bytes: null };
  if (!("text" in out) && !("files" in out)) return { text: JSON.stringify(out), bytes: null };
  const text = String(out.text ?? "");
  const files = productFileEntries(out);
  // 无文件产物：维持原文本行为。多文件产物：显式拒绝——字节通道只能承载「唯一一段内容」，
  // 多文件既不能无损合并（拼接等于静默篡改数据），也不该悄悄只取其一（其余内容被静默丢弃）。
  if (files.length !== 1) {
    if (!files.length && !(out.files?.length)) return { text, bytes: null };
    if (files.length > 1) {
      throw new Error(`配方链中转：上游产物包含 ${files.length} 个文件，无法当作单一输入继续串链。请先在链末端下载所需文件后另起配方，或改用只产出一个文件的上游节点。`);
    }
    return { text: transitTextOf(out), bytes: null };
  }
  const bytes = files[0].bytes;
  // 护栏原样保留：text 必须是该批字节的无损表示，否则它是「报告」，不能当内容
  if (matchesLossless(text, bytes)) return { text, bytes };
  throw new Error("配方链中转受限：文件产物的 text 不是原字节的无损表示（Base64 / Hex / \\xNN 转义）。请在链末端下载文件后另起配方，不能把报告当作文件内容。");
}

export function recipeDisplayText(out) {
  if (out == null) return "";
  if (typeof out !== "object") return String(out);
  if (!("text" in out) && !("files" in out)) return JSON.stringify(out, null, 2);
  const files = productFileEntries(out);
  const text = String(out.text ?? "");
  return text + (files.length ? "\n[Files: " + files.map(f => `${f.name} (${f.bytes.length} B)`).join(", ") + "]" : "");
}

export function recipeTerminalText(out) {
  if (out && typeof out === "object" && !("text" in out) && !("files" in out)) {
    return JSON.stringify(Object.fromEntries(Object.entries(out).map(([key, value]) => [key, recipeDisplayText(value)])), null, 2);
  }
  return recipeDisplayText(out);
}
