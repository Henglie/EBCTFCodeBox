const LIMIT = 4096;

let sdk = null;

export function initClipboard(s) { sdk = s; }

function bytes(text) {
  try { return new TextEncoder().encode(text).byteLength; } catch { return String(text).length; }
}

export async function copyText(text) {
  const s = String(text ?? "");
  const n = bytes(s);
  if (n > LIMIT) {
    const cut = cutUtf8(s, LIMIT);
    await sdk.clipboard.writeText(cut);
    return { ok: true, truncated: true, bytes: n, copiedBytes: bytes(cut) };
  }
  await sdk.clipboard.writeText(s);
  return { ok: true, truncated: false, bytes: n, copiedBytes: n };
}

export async function readText() {
  return await sdk.clipboard.readText();
}

function cutUtf8(text, max) {
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bytes(text.slice(0, mid)) <= max) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo);
}
