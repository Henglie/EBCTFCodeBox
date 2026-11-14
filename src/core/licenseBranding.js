// Display projection only: callers must supply the successfully verified loadLicense result.
import "../../public/license-verifier/verifier.js";
const engine = globalThis.EBCryptoLicense;
export const { LIMITS: LICENSE_LIMITS, inspectRaster, validateRasterDataUrl, validateRasterContent,
  resolveBranding: resolveLicenseBranding, prepareBranding: prepareLicenseBranding } = engine;

/** Structural projection only; use await prepareLicenseBranding for PNG content validation and img.onerror for native decoder errors. */
export function licenseIconSource(license, fallback = "public/logo.webp") {
  return engine.resolveBranding(license).appIcon?.dataUrl || fallback;
}
