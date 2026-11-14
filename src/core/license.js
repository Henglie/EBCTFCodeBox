// ECDSA P-256 / SHA-256, IEEE-P1363. The shared engine has no DOM or Node dependency.
import "../../public/license-verifier/verifier.js";
const engine = globalThis.EBCryptoLicense;
export const { PUBLIC_KEY_B64, verifyLicense, fingerprint: licensePublicKeyFingerprint } = engine;

export const OPENSOURCE_LICENSE = Object.freeze({
  verified: false,
  source: "opensource",
  licensedTo: null,
  ext: null,
  appName: null,
  appIcon: null,
});

async function readLicenseText(response) {
  if (!response.body?.getReader) return response.text();
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      if ((size += value.length) > engine.LIMITS.binBytes) { await reader.cancel(); throw new Error("BIN_BUDGET"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * 读取并验签 license.bin。
 * Existing no-argument caller stays compatible. Public-key override is for explicit offline/test use.
 * Missing/invalid files return the immutable opensource fallback. ext remains the signed legacy object.
 */
export async function loadLicense({ url = "license.bin", fetchImpl = globalThis.fetch, publicKey = PUBLIC_KEY_B64 } = {}) {
  try {
    const res = await fetchImpl(url, { cache: "no-store" });
    if (!res.ok) return OPENSOURCE_LICENSE;
    const length = Number(res.headers?.get("content-length"));
    if (length > engine.LIMITS.binBytes) return OPENSOURCE_LICENSE;
    const { payload } = await verifyLicense(await readLicenseText(res), { publicKey });
    const ext = payload.ext && typeof payload.ext === "object" ? payload.ext : null;
    const appName = typeof payload.appName === "string" && payload.appName.trim() ? payload.appName.trim() : null;
    return {
      verified: true,
      source: payload.source || "authorized",
      licensedTo: payload.licensedTo || null,
      issuedAt: payload.issuedAt || null,
      note: payload.note || null,
      ext,
      appName,
      appIcon: typeof payload.appIcon === "string" ? payload.appIcon : null,
    };
  } catch {
    return OPENSOURCE_LICENSE;
  }
}
