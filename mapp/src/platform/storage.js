const PREFIX = "mapp.v1.";
const K = {
  prefs: PREFIX + "prefs",
  fav: PREFIX + "fav",
  params: PREFIX + "params",
  recipe: PREFIX + "recipe",
  drafts: PREFIX + "drafts",
  schema: PREFIX + "schema",
};
const DRAFT_PREFIX = PREFIX + "draft.";
const LIMIT = 4096;

let sdk = null;
let available = true;
const mem = new Map();
const dirty = new Set();
let timer = null;
let errorHandler = null;

export function onStorageError(fn) { errorHandler = fn; }

function byteLength(s) {
  try { return new TextEncoder().encode(s).byteLength; } catch { return s.length; }
}

export function truncateUtf8(text, max = LIMIT - 64) {
  const s = String(text ?? "");
  if (byteLength(s) <= max) return { text: s, truncated: false };
  let lo = 0, hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (byteLength(s.slice(0, mid)) <= max) lo = mid; else hi = mid - 1;
  }
  return { text: s.slice(0, lo), truncated: true };
}

async function readBatched(keys, size = 4) {
  for (let i = 0; i < keys.length; i += size) {
    await Promise.all(keys.slice(i, i + size).map(async (k) => {
      try {
        const v = await sdk.localStorage.getItem(k);
        if (v != null) mem.set(k, v);
      } catch { available = false; }
    }));
  }
}

export async function initStorage(s) {
  sdk = s;
  await readBatched([K.prefs, K.fav, K.params, K.recipe, K.drafts, K.schema]);
  let index = getJson(K.drafts, {});
  if (!index || typeof index !== "object") index = {};
  const draftKeys = Object.keys(index).slice(0, 12).map((id) => DRAFT_PREFIX + id);
  await readBatched(draftKeys);
}

export function isStorageAvailable() { return available; }

export function getRaw(key) { return mem.has(key) ? mem.get(key) : null; }

export function getJson(key, fallback) {
  const raw = getRaw(key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export function setRaw(key, value, immediate = false) {
  const v = String(value ?? "");
  if (byteLength(v) > LIMIT) return false;
  mem.set(key, v);
  dirty.add(key);
  schedule(immediate);
  return true;
}

export function setJson(key, value, immediate = false) {
  return setRaw(key, JSON.stringify(value), immediate);
}

export function removeRaw(key) {
  mem.delete(key);
  dirty.add(key);
  schedule();
}

function schedule(immediate = false) {
  if (timer) clearTimeout(timer);
  if (immediate) { void flush(); return; }
  timer = setTimeout(() => { void flush(); }, 420);
}

export async function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!sdk || !dirty.size) return;
  const keys = [...dirty];
  dirty.clear();
  for (const key of keys) {
    try {
      if (mem.has(key)) await sdk.localStorage.setItem(key, mem.get(key));
      else await sdk.localStorage.removeItem(key);
    } catch (e) {
      available = false;
      if (errorHandler) errorHandler(e);
      break;
    }
  }
}

export function prefs() {
  const p = getJson(K.prefs, {});
  return p && typeof p === "object" ? p : {};
}

export function setPrefs(patch) {
  setJson(K.prefs, { ...prefs(), ...patch });
}

export function favorites() {
  const f = getJson(K.fav, []);
  return Array.isArray(f) ? f.filter((x) => typeof x === "string") : [];
}

export function setFavorites(list) {
  setJson(K.fav, list.slice(0, 80));
}

export function allParams() {
  const p = getJson(K.params, {});
  return p && typeof p === "object" ? p : {};
}

export function opParams(id) {
  const p = allParams()[id];
  return p && typeof p === "object" ? p : {};
}

export function saveOpParams(id, params) {
  const all = allParams();
  all[id] = params;
  const ids = Object.keys(all);
  if (ids.length > 30) {
    for (const old of ids.slice(0, ids.length - 30)) delete all[old];
  }
  let json = JSON.stringify(all);
  while (byteLength(json) > LIMIT && Object.keys(all).length > 1) {
    const oldest = Object.keys(all)[0];
    delete all[oldest];
    json = JSON.stringify(all);
  }
  setRaw(K.params, json);
}

export function draftIndex() {
  const idx = getJson(K.drafts, {});
  return idx && typeof idx === "object" ? idx : {};
}

export function draftKey(id) { return DRAFT_PREFIX + id; }

export function getDraft(id) {
  const v = getRaw(draftKey(id));
  return typeof v === "string" ? v : "";
}

export function setDraft(id, text) {
  const { text: safe, truncated } = truncateUtf8(text, LIMIT - 64);
  if (!safe) {
    removeRaw(draftKey(id));
    const idx = draftIndex();
    delete idx[id];
    setJson(K.drafts, idx);
    return { truncated: false, empty: true };
  }
  setRaw(draftKey(id), safe);
  const idx = draftIndex();
  idx[id] = { at: Date.now(), n: safe.length };
  const ids = Object.keys(idx).sort((a, b) => (idx[b].at || 0) - (idx[a].at || 0));
  for (const old of ids.slice(12)) delete idx[old];
  setJson(K.drafts, idx);
  return { truncated };
}

export function removeDraft(id) {
  removeRaw(draftKey(id));
  const idx = draftIndex();
  delete idx[id];
  setJson(K.drafts, idx);
}

export function recipeData() {
  return getJson(K.recipe, null);
}

export function setRecipeData(data) {
  const { text, truncated } = truncateUtf8(JSON.stringify(data), LIMIT - 64);
  if (truncated) return false;
  setRaw(K.recipe, text);
  return true;
}

export async function clearAll() {
  for (const key of [...mem.keys()]) mem.delete(key);
  dirty.clear();
  try { await sdk.localStorage.clear(); } catch { available = false; }
}

export const KEYS = K;
