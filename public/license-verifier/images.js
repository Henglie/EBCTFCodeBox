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
  async function uploadRaster(file, kind) {
    if (file.size > api.LIMITS[kind].bytes) throw new Error("IMAGE_BYTES");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const info = api.inspectRaster(bytes, kind, file.type);
    const { image } = await decodeRaster(`data:${info.mime};base64,${api.encode64(bytes)}`, kind);
    const canvas = document.createElement("canvas");
    canvas.width = info.width; canvas.height = info.height;
    canvas.getContext("2d").drawImage(image, 0, 0);
    const dataUrl = canvas.toDataURL(info.mime, 0.92);
    return api.validateRasterDataUrl(dataUrl, kind);
  }
  globalThis.EBCryptoLicenseImages = Object.freeze({ decodeRaster, uploadRaster });
})();
