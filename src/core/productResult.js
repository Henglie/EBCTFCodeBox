// Shared decoding for the registry's {text, files:[{name,mime,bytes|dataUrl}]} contract.
export function parseProductDataUrl(url) {
  if (typeof url !== "string" || !url.startsWith("data:")) throw new Error("Invalid data URL");
  const comma = url.indexOf(",");
  if (comma < 0) throw new Error("Missing data URL separator");
  const [type, ...params] = url.slice(5, comma).split(";");
  if (type && !/^[\w.+-]+\/[\w.+-]+$/.test(type)) throw new Error("Invalid data URL MIME type");
  const data = url.slice(comma + 1);
  const decoded = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] === "%") {
      const hex = data.slice(i + 1, i + 3);
      if (!/^[\da-f]{2}$/i.test(hex)) throw new Error("Invalid data URL percent escape");
      decoded.push(parseInt(hex, 16));
      i += 2;
    } else {
      const code = data.charCodeAt(i);
      if (code > 126 || (code < 32 && !/[\t\n\f\r]/.test(data[i]))) throw new Error("Invalid data URL character");
      decoded.push(code);
    }
  }
  let bytes = Uint8Array.from(decoded);
  if (params.includes("base64")) {
    const clean = new TextDecoder().decode(bytes).replace(/[\t\n\f\r ]/g, "");
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(clean)) throw new Error("Invalid data URL base64");
    bytes = Uint8Array.from(atob(clean), c => c.charCodeAt(0));
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
        const parsed = parseProductDataUrl(f.dataUrl);
        bytes = parsed.bytes;
        mime ||= parsed.mime;
      } else continue;
    } catch (e) { throw new Error(`File ${f.name || "download.bin"}: ${e.message}`); }
    files.push({ name: String(f.name || "download.bin"), mime: mime || "application/octet-stream", bytes });
  }
  return files;
}

export function productBytesBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

export function transitTextOf(out) {
  if (out == null) return "";
  if (typeof out !== "object") return String(out);
  if (!("text" in out) && !("files" in out)) return JSON.stringify(out);
  const text = String(out.text ?? "");
  const files = productFileEntries(out);
  if (!files.length && !(out.files?.length)) return text;
  // Validate every file before accepting any encoded payload; malformed siblings must not disappear.
  if (files.some(f => text === productBytesBase64(f.bytes) || text.toLowerCase() === Array.from(f.bytes, b => b.toString(16).padStart(2, "0")).join(""))) return text;
  throw new Error("配方链中转受限：文件产物的 text 不是原字节的 Base64/Hex。请在链末端下载文件后另起配方，不能把报告当作文件内容。");
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
