import { localizedManifest } from '../core/branding.js';
let baseManifest = null, manifestUrl = null, generation = 0;
export function refreshManifestBranding(locale, license) {
  const current = ++generation;
  if (!baseManifest) baseManifest = fetch(new URL('../../manifest.json', import.meta.url))
    .then(response => { if (!response.ok) throw new Error('manifest unavailable'); return response.json(); })
    .catch(error => { baseManifest = null; throw error; });
  baseManifest.then(manifest => {
    if (generation !== current) return;
    const link = document.querySelector('link[rel=manifest]'); if (!link) return;
    const data = localizedManifest(manifest, locale, license, new URL('../../', import.meta.url));
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/manifest+json' }));
    const previous = manifestUrl; manifestUrl = url; link.href = url;
    if (previous) setTimeout(() => URL.revokeObjectURL(previous), 2000);
  }).catch(() => { /* The static English manifest remains a valid fallback. */ });
}
