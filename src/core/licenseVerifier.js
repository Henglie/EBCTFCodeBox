/* Shared, DOM-free license engine. Classic script for file://; ESM side-effect import for the app. */
(() => {
  "use strict";
  const PUBLIC_KEY_B64 = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEkOkYdb4i7EAZ1KukarDW12eqfLQf1S18MlgIqVp7H7jqOJdZotjIigSMYPDtvSJdYdydRwfpFXXJ273987Ke3w==";
  const LIMITS = Object.freeze({ binBytes: 8 * 1024 * 1024, payloadBytes: 6 * 1024 * 1024,
    icon: Object.freeze({ bytes: 256 * 1024, side: 1024, pixels: 1024 * 1024 }),
    feed: Object.freeze({ bytes: 1024 * 1024, side: 2048, pixels: 2048 * 2048 }) });
  const fail = code => { throw new Error(code); };
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const text = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
  function encode64(input, url = false) {
    const bytes = new Uint8Array(input);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const b64 = btoa(bin);
    return url ? b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : b64;
  }
  function decode64(value, url = false) {
    if (typeof value !== "string" || !value.length) fail("BASE64");
    const raw = url ? value.replace(/-/g, "+").replace(/_/g, "/") : value;
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(raw) || raw.replace(/=+$/, "").length % 4 === 1) fail("BASE64");
    try { return Uint8Array.from(atob(raw), c => c.charCodeAt(0)); } catch { fail("BASE64"); }
  }
  function publicKeyBytes(value = PUBLIC_KEY_B64) {
    if (typeof value !== "string" || value.length > 4096) fail("PUBLIC_KEY");
    return decode64(value.replace(/-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g, ""));
  }
  async function importPublicKey(value = PUBLIC_KEY_B64) {
    return crypto.subtle.importKey("spki", publicKeyBytes(value), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  }
  async function sha256(bytes) {
    return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("");
  }
  async function fingerprint(value = PUBLIC_KEY_B64) { return sha256(publicKeyBytes(value)); }
  function parseEnvelope(input) {
    if (typeof input !== "string" || input.length > LIMITS.binBytes) fail("BIN_BUDGET");
    const parts = input.trim().split(".");
    if (parts.length !== 2) fail("BIN_FORMAT");
    const payloadBytes = decode64(parts[0], true), signature = decode64(parts[1], true);
    if (payloadBytes.length > LIMITS.payloadBytes) fail("PAYLOAD_BUDGET");
    if (signature.length !== 64) fail("SIGNATURE_FORMAT");
    return { payloadBytes, signature };
  }
  // Verify the original decoded bytes, NEVER a reserialized JSON object.
  async function verifyLicense(input, { publicKey = PUBLIC_KEY_B64 } = {}) {
    const { payloadBytes, signature } = parseEnvelope(input);
    const key = await importPublicKey(publicKey);
    if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, payloadBytes)) fail("SIGNATURE_INVALID");
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payloadBytes));
    if (!record(payload)) fail("PAYLOAD_TYPE");
    return { payload, payloadBytes, signature, fingerprint: await fingerprint(publicKey), payloadSha256: await sha256(payloadBytes) };
  }
  const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
    for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n >>> 0;
  });
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }
  function inspectRaster(input, kind = "icon", declaredMime = "") {
    const budget = LIMITS[kind];
    if (!budget || !["icon", "feed"].includes(kind)) fail("IMAGE_KIND");
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (!b.length || b.length > budget.bytes) fail("IMAGE_BYTES");
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let mime, width, height;
    if (b.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => b[i] === n)) {
      mime = "image/png";
      let pos = 8, chunks = 0, hasData = false, ended = false;
      while (pos + 12 <= b.length) {
        const len = view.getUint32(pos), end = pos + 12 + len;
        if (++chunks > 4096 || end > b.length) fail("IMAGE_CORRUPT");
        const type = String.fromCharCode(...b.subarray(pos + 4, pos + 8));
        if (!/^[A-Za-z]{4}$/.test(type) || crc32(b.subarray(pos + 4, end - 4)) !== view.getUint32(end - 4)) fail("IMAGE_CORRUPT");
        if (chunks === 1) {
          if (type !== "IHDR" || len !== 13) fail("IMAGE_CORRUPT");
          width = view.getUint32(pos + 8); height = view.getUint32(pos + 12);
          const depth = b[pos + 16], color = b[pos + 17];
          const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
          if (!depths[color]?.includes(depth) || b[pos + 18] || b[pos + 19] || b[pos + 20] > 1) fail("IMAGE_CORRUPT");
        } else if (type === "IHDR") fail("IMAGE_CORRUPT");
        if (type === "acTL") fail("IMAGE_ANIMATED");
        if (type === "IDAT") hasData = true;
        if (type === "IEND") { if (len || !hasData || end !== b.length) fail("IMAGE_CORRUPT"); ended = true; break; }
        pos = end;
      }
      if (!ended) fail("IMAGE_CORRUPT");
    } else if (b.length >= 4 && b[0] === 255 && b[1] === 216) {
      mime = "image/jpeg";
      let pos = 2, scan = false, ended = false, markers = 0;
      while (pos < b.length) {
        if (++markers > 65536 || b[pos++] !== 255) fail("IMAGE_CORRUPT");
        while (b[pos] === 255) pos++;
        const marker = b[pos++];
        if (marker === 217) { ended = true; break; }
        if (!marker || marker === 216 || (marker >= 208 && marker <= 215)) fail("IMAGE_CORRUPT");
        if (pos + 2 > b.length) fail("IMAGE_CORRUPT");
        const len = view.getUint16(pos);
        if (len < 2 || pos + len > b.length) fail("IMAGE_CORRUPT");
        if ([192, 193, 194].includes(marker)) {
          if (len < 8 || width !== undefined) fail("IMAGE_CORRUPT");
          height = view.getUint16(pos + 3); width = view.getUint16(pos + 5);
        }
        pos += len;
        if (marker === 218) {
          scan = true;
          while (pos < b.length) {
            if (b[pos++] !== 255) continue;
            const start = pos - 1;
            while (b[pos] === 255) pos++;
            if (b[pos] === 0 || (b[pos] >= 208 && b[pos] <= 215)) { pos++; continue; }
            pos = start; break;
          }
        }
      }
      if (!scan || !ended || pos !== b.length) fail("IMAGE_CORRUPT");
    } else fail("IMAGE_TYPE");
    if (declaredMime && declaredMime !== mime) fail("IMAGE_MIME");
    if (!width || !height || width > budget.side || height > budget.side || width * height > budget.pixels) fail("IMAGE_DIMENSIONS");
    return { mime, width, height, bytes: b.length };
  }
  function validateRasterDataUrl(value, kind = "icon") {
    if (typeof value !== "string" || value.length > Math.ceil(LIMITS[kind]?.bytes * 4 / 3) + 128) fail("IMAGE_BYTES");
    const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value);
    if (!match) fail("IMAGE_TYPE");
    const bytes = decode64(match[2].replace(/[\r\n]/g, ""));
    return { ...inspectRaster(bytes, kind, match[1]), dataUrl: `data:${match[1]};base64,${encode64(bytes)}` };
  }
  // Some browser image decoders report onload even for invalid PNG IDAT. Validate zlib and scanlines too.
  async function validateRasterContent(value, kind = "icon") {
    const info = validateRasterDataUrl(value, kind);
    if (info.mime !== "image/png") return info;
    if (typeof DecompressionStream !== "function") fail("IMAGE_DECODER_UNAVAILABLE");
    const bytes = decode64(info.dataUrl.split(",")[1]), view = new DataView(bytes.buffer);
    const depth = bytes[24], color = bytes[25], channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
    const rowSizes = [];
    const passes = bytes[28] ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
    for (const [x, y, dx, dy] of passes) {
      const w = Math.max(0, Math.ceil((info.width - x) / dx)), h = Math.max(0, Math.ceil((info.height - y) / dy));
      if (w) for (let row = 0; row < h; row++) rowSizes.push(1 + Math.ceil(w * channels * depth / 8));
    }
    const parts = [];
    for (let pos = 8; pos + 12 <= bytes.length;) {
      const len = view.getUint32(pos);
      if (String.fromCharCode(...bytes.subarray(pos + 4, pos + 8)) === "IDAT") parts.push(bytes.subarray(pos + 8, pos + 8 + len));
      pos += len + 12;
    }
    const expected = rowSizes.reduce((sum, n) => sum + n, 0);
    const reader = new Blob(parts).stream().pipeThrough(new DecompressionStream("deflate")).getReader();
    let read = 0, row = 0, left = 0;
    try {
      while (true) {
        const { value: output, done } = await reader.read(); if (done) break;
        if ((read += output.length) > expected) fail("IMAGE_DECODE");
        for (const byte of output) {
          if (!left) { if (byte > 4 || row >= rowSizes.length) fail("IMAGE_DECODE"); left = rowSizes[row++]; }
          left--;
        }
      }
      if (read !== expected || left || row !== rowSizes.length) fail("IMAGE_DECODE");
    } catch { await reader.cancel().catch(() => {}); fail("IMAGE_DECODE"); }
    finally { reader.releaseLock(); }
    return info;
  }
  async function prepareBranding(license) {
    const brand = resolveBranding(license);
    if (brand.appIcon) {
      try { brand.appIcon = await validateRasterContent(brand.appIcon.dataUrl, "icon"); }
      catch (error) { brand.appIcon = null; brand.warnings.push(`appIcon:${error.message}`); }
    }
    if (brand.ext?.img) {
      try { await validateRasterContent(brand.ext.img, "feed"); }
      catch (error) { brand.ext.img = null; brand.warnings.push(`ext.img:${error.message}`); }
    }
    return brand;
  }
  function safeHref(value) {
    const href = text(value, 2048);
    if (!href || /[\u0000-\u0020\u007f]/.test(href)) return null;
    try { return ["https:", "http:", "mailto:"].includes(new URL(href).protocol) ? href : null; } catch { return null; }
  }
  // Keep legacy ext untouched on the license object; rendering uses this bounded safe projection.
  function resolveBranding(license) {
    const result = { appName: null, appIcon: null, ext: null, warnings: [] };
    if (!license?.verified) return result;
    result.appName = text(license.appName, 120) || null;
    if (license.appIcon != null) {
      try { result.appIcon = validateRasterDataUrl(license.appIcon, "icon"); }
      catch (e) { result.warnings.push(`appIcon:${e.message}`); }
    }
    if (record(license.ext)) {
      const ext = license.ext;
      result.ext = { title: text(ext.title, 120), imgCap: text(ext.imgCap, 240), img: null,
        imgW: Math.min(480, Math.max(80, Number(ext.imgW) || 240)), rows: [] };
      if (ext.img) {
        try { result.ext.img = validateRasterDataUrl(ext.img, "feed").dataUrl; }
        catch (e) { result.warnings.push(`ext.img:${e.message}`); }
      }
      if (Array.isArray(ext.rows)) result.ext.rows = ext.rows.slice(0, 20).filter(record).map(row => ({
        icon: /^[a-z_]{1,48}$/.test(row.icon) ? row.icon : "", label: text(row.label, 120),
        value: text(row.value, 1024), href: safeHref(row.href) }));
    }
    return result;
  }
  globalThis.EBCryptoLicense = Object.freeze({ PUBLIC_KEY_B64, LIMITS, encode64, decode64, publicKeyBytes,
    importPublicKey, sha256, fingerprint, parseEnvelope, verifyLicense, inspectRaster, validateRasterDataUrl,
    validateRasterContent, resolveBranding, prepareBranding, safeHref });
})();
