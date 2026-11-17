/* DOM adapter: actual decoding, timeout, bounded dimensions and metadata-stripping upload. */
(() => {
  "use strict";
  const api = globalThis.EBCryptoLicense;
  async function decodeRaster(dataUrl, kind) {
    const info = await api.validateRasterContent(dataUrl, kind);
    const image = new Image();
    await new Promise((resolve, reject) => {
      const finish = error => { clearTimeout(timer); image.onload = image.onerror = null; error ? reject(error) : resolve(); };
      const timer = setTimeout(() => { image.src = ""; finish(new Error("IMAGE_TIMEOUT")); }, 5000);
      image.onload = () => image.naturalWidth === info.width && image.naturalHeight === info.height
        ? finish() : finish(new Error("IMAGE_DIMENSIONS"));
      image.onerror = () => finish(new Error("IMAGE_DECODE"));
      image.src = info.dataUrl;
    });
    if (typeof image.decode === "function") {
      try { await image.decode(); } catch { throw new Error("IMAGE_DECODE"); }
    }
    return { image, info };
  }
  /** 只解析 PNG/JPEG 头部拿真实尺寸；不套 LIMITS 上限（上传端要能先缩再验）。 */
  function peekRaster(bytes) {
    if (bytes.length < 24) return null;
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (v.getUint32(0) === 0x89504e47 && v.getUint32(12) === 0x49484452) {
      return { mime: "image/png", width: v.getUint32(16), height: v.getUint32(20) };
    }
    if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) { i++; continue; }
        const marker = bytes[i + 1]; i += 2;
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (marker === 0xd9) break;
        const len = v.getUint16(i);
        if (len < 2) break;
        if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
            (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
          return { mime: "image/jpeg", width: v.getUint16(i + 5), height: v.getUint16(i + 3) };
        }
        i += len;
      }
    }
    return null;
  }
  function loadRawImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const finish = (err) => { clearTimeout(timer); img.onload = img.onerror = null; err ? reject(err) : resolve(img); };
      const timer = setTimeout(() => { img.src = ""; finish(new Error("IMAGE_TIMEOUT")); }, 8000);
      img.onload = () => finish();
      img.onerror = () => finish(new Error("IMAGE_DECODE"));
      img.src = url;
    });
  }

  /**
   * 上传即压缩：签发端只把「够用」的像素写进授权，避免几 MB 的 base64 撑大 payload。
   * 不改验证端契约（仍是 PNG/JPEG + 原 LIMITS），只在写入前缩尺寸/去元数据/选合适编码。
   * - 超出上限的原图自动缩放，不再直接报错；硬上限 4096px 防止病态输入占内存。
   * - 图标按 2× 展示尺寸（64px → 256px）；投喂码按 2× 最大展示宽度（480px → 960px）。
   * - 无透明像素转 JPEG 并逐步降质；有透明则保 PNG 并继续缩边。
   * - 目标 base64 长度：图标 ≤96 KiB、投喂码 ≤320 KiB。
   */
  async function uploadRaster(file, kind) {
    const limit = api.LIMITS[kind];
    if (file.size > limit.bytes) throw new Error("IMAGE_BYTES");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const peek = peekRaster(bytes);
    if (!peek || !peek.width || !peek.height || Math.max(peek.width, peek.height) > 4096) throw new Error("IMAGE_DIMENSIONS");
    const image = await loadRawImage(`data:${peek.mime};base64,${api.encode64(bytes)}`);
    const maxSide = Math.min(kind === "icon" ? 256 : 960, limit.side);
    const targetBytes = kind === "icon" ? 96 * 1024 : 320 * 1024;
    const scale = Math.min(1, maxSide / Math.max(peek.width, peek.height));
    const baseW = Math.max(1, Math.round(peek.width * scale));
    const baseH = Math.max(1, Math.round(peek.height * scale));

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const draw = (w, h) => {
      canvas.width = w; canvas.height = h;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(image, 0, 0, w, h);
    };
    draw(baseW, baseH);
    // 全量检测透明：只要有一个非不透明像素就保留 PNG（256×256 量级，开销可忽略）。
    let transparent = false;
    try {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 3; i < data.length; i += 4) { if (data[i] < 250) { transparent = true; break; } }
    } catch { transparent = peek.mime === "image/png"; }

    const encode = (w, h) => {
      draw(w, h);
      return transparent
        ? canvas.toDataURL("image/png")
        : canvas.toDataURL("image/jpeg", 0.82);
    };
    let out = encode(baseW, baseH);
    if (out.length > targetBytes && !transparent) {
      for (const q of [0.72, 0.62, 0.52]) {
        draw(baseW, baseH);
        const candidate = canvas.toDataURL("image/jpeg", q);
        if (candidate.length < out.length) out = candidate;
        if (out.length <= targetBytes) break;
      }
    }
    let w = baseW, h = baseH;
    while (out.length > targetBytes && w > 64) {
      w = Math.max(64, Math.round(w * 0.75));
      h = Math.max(1, Math.round(h * 0.75));
      const candidate = encode(w, h);
      if (candidate.length < out.length) out = candidate;
      else break;
    }
    const validated = api.validateRasterDataUrl(out, kind);
    return { ...validated, originalBytes: bytes.length, base64Chars: out.length };
  }
  globalThis.EBCryptoLicenseImages = Object.freeze({ decodeRaster, uploadRaster });
})();
