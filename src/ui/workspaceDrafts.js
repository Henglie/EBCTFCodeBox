import { encodeDraftFiles, decodeDraftFiles } from './draftBinary.js';

const DB_NAME = 'ebctf-workspace-drafts';
const PREFIX = 'ebctf.workspaceDraft.';
const CLEAR_KEY = 'ebctf.workspaceDraftClear';
const EDITORS = '.io-area, .qc-input, .qc-asm-in, .qc-asm-out';
let instance = null;
export const newDraftIdentity = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

function openDatabase() {
  return new Promise(resolve => {
    if (!globalThis.indexedDB) { resolve(null); return; }
    let settled = false;
    const finish = value => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } else value?.close(); };
    const timer = setTimeout(() => finish(null), 2000);
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
      request.onsuccess = () => finish(request.result);
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch { finish(null); }
  });
}

const clone = value => { try { return structuredClone(value); } catch { return null; } };
const isBinary = value => ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Blob;
function hasBinary(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return false;
  if (isBinary(value)) return true;
  if (seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some(child => hasBinary(child, seen));
}
function mergeBinary(previous, next, seen = new WeakSet()) {
  if (!previous || !next || typeof next !== 'object' || isBinary(next)) return;
  if (seen.has(next)) return; seen.add(next);
  for (const [key, value] of Object.entries(previous)) {
    if (isBinary(value) && next[key] === undefined) next[key] = value;
    else if (next[key] && typeof next[key] === 'object') mergeBinary(value, next[key], seen);
  }
}
function retainFiles(original, snapshot, seen = new WeakSet()) {
  if (!original || !snapshot || typeof snapshot !== 'object' || isBinary(snapshot) || seen.has(snapshot)) return;
  seen.add(snapshot);
  for (const [key, value] of Object.entries(original)) {
    if (value instanceof Blob) snapshot[key] = value; // File/Blob data is immutable; reuse its byte checkpoint.
    else if (snapshot[key] && typeof snapshot[key] === 'object') retainFiles(value, snapshot[key], seen);
  }
}
const textOf = node => 'value' in node ? String(node.value ?? '') : node.textContent || '';
function areas(root) {
  const counts = new Map();
  return [...root.querySelectorAll(EDITORS)].map(node => {
    const base = node.id || [...node.classList].filter(name => !['error', 'dragover'].includes(name)).join('.');
    const ordinal = counts.get(base) || 0; counts.set(base, ordinal + 1);
    return { key: `${base}:${ordinal}`, node };
  });
}

export function createWorkspaceDrafts(root, { onClear, onRestore, onStorageError } = {}) {
  const records = new Map();
  const byteVersions = new WeakMap();
  const sources = new Set();
  let db = null, binding = null, timer = 0, generation = 0, suspended = false, reported = false, loaded = false;
  const observer = new MutationObserver(changes => {
    if (changes.some(change => {
      const element = change.target.nodeType === 1 ? change.target : change.target.parentElement;
      return !!element?.closest(EDITORS);
    })) schedule();
  });
  const merge = record => {
    if (!record?.id || !Array.isArray(record.areas)) return;
    const previous = records.get(record.id);
    if (previous && previous.updated >= record.updated) return;
    // A text journal may be newer than the last committed binary checkpoint.
    // Reuse bytes only when the exact file/result identity still matches.
    if (previous) {
      const old = new Map(previous.areas.map(area => [area.key, area]));
      for (const entry of record.areas) if (entry.rawBytes === undefined && entry.rawId && old.get(entry.key)?.rawId === entry.rawId) entry.rawBytes = old.get(entry.key).rawBytes;
      if (record.meta?.lastMemo?.runId && record.meta.lastMemo.runId === previous.meta?.lastMemo?.runId) record.meta.lastMemo = previous.meta.lastMemo;
      if (record.meta?.special?.binaryKey && record.meta.special.binaryKey === previous.meta?.special?.binaryKey) mergeBinary(previous.meta.special, record.meta.special);
    }
    records.set(record.id, record);
  };
  const ready = openDatabase().then(async database => {
    db = database;
    if (db) db.onversionchange = () => { db.close(); db = null; };
    if (db) await new Promise(resolve => {
      try {
        const request = db.transaction('drafts').objectStore('drafts').getAll();
        request.onsuccess = () => { for (const record of request.result) merge(decodeDraftFiles(record)); resolve(); };
        request.onerror = () => resolve();
      } catch { resolve(); }
    });
    try {
      for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) {
        try { merge(JSON.parse(localStorage.getItem(key))); } catch { /* Ignore damaged drafts. */ }
      }
    } catch { /* IndexedDB still works when localStorage is unavailable. */ }
    loaded = true;
  });
  const backup = record => {
    try {
      // IndexedDB owns binary/file results; this synchronous journal protects
      // freshly typed text on immediate reload/pagehide, without JSON byte expansion.
      localStorage.setItem(PREFIX + record.id, JSON.stringify(record, (key, value) =>
        ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Blob ? undefined : value));
      return true;
    } catch { return false; }
  };
  const persist = record => {
    const journal = backup(record), epoch = generation, binary = hasBinary(record);
    const failed = () => { if ((!journal || binary) && !reported) { reported = true; onStorageError?.(); } };
    const write = async () => {
      if (epoch !== generation) return;
      if (!db) { failed(); return; }
      try {
        const stored = record.meta?.special ? await encodeDraftFiles(record) : record;
        if (epoch !== generation || records.get(record.id)?.updated !== record.updated || !db) return;
        const transaction = db.transaction('drafts', 'readwrite');
        transaction.objectStore('drafts').put(stored);
        transaction.oncomplete = () => {
          // Remove only the exact journal that this transaction committed.
          // A newer keystroke may already have written its own reload protection.
          try { const saved = JSON.parse(localStorage.getItem(PREFIX + record.id)); if (saved?.updated === record.updated) localStorage.removeItem(PREFIX + record.id); } catch { /* No journal. */ }
        };
        transaction.onerror = failed;
        transaction.onabort = failed;
      } catch { failed(); }
    };
    if (loaded) write(); else ready.then(write);
  };
  function save() {
    clearTimeout(timer); timer = 0;
    if (!binding || suspended) return;
    const previous = records.get(binding.id);
    const entries = new Map((previous?.areas || []).map(area => [area.key, area]));
    for (const { key, node } of areas(root)) {
      let version = byteVersions.get(node);
      if (node._rawBytes && version?.bytes !== node._rawBytes) {
        version = { bytes: node._rawBytes, id: newDraftIdentity() }; byteVersions.set(node, version);
      }
      entries.set(key, {
        key, text: textOf(node), rawBytes: node._rawBytes ? new Uint8Array(node._rawBytes) : null,
        rawId: node._rawBytes ? version.id : null,
        rawFileName: node._rawFileName || null, filePlaceholder: !!node._isFilePlaceholder,
        coding: node.__ioCoding?.getState(), error: node.classList.contains('error'),
        stale: node.hasAttribute('data-result-stale'),
      });
    }
    const record = { id: binding.id, updated: Math.max(Date.now(), (previous?.updated || 0) + 1),
      meta: clone(binding.getMeta?.() || {}), areas: [...entries.values()] };
    records.set(record.id, record); persist(record);
  }
  function schedule() {
    if (binding && !suspended) {
      binding.getMeta?.(); // Capture route-local direction before navigation changes global state.
      clearTimeout(timer); timer = setTimeout(save, 160);
    }
  }
  const release = () => { save(); binding = null; observer.disconnect(); };
  function bind(id, getMeta) {
    binding = { id, getMeta };
    const record = records.get(id);
    suspended = true;
    try {
      const saved = new Map((record?.areas || []).map(area => [area.key, area]));
      for (const { key, node } of areas(root)) {
        const entry = saved.get(key); if (!entry) continue;
        if ('value' in node) node.value = entry.text; else node.textContent = entry.text;
        node.classList.toggle('error', !!entry.error);
        if (entry.stale) node.setAttribute('data-result-stale', 'true'); else node.removeAttribute('data-result-stale');
        if (entry.error) node.style.color = 'var(--error)';
        node._rawBytes = entry.rawBytes ? new Uint8Array(entry.rawBytes) : null;
        if (node._rawBytes) byteVersions.set(node, { bytes: node._rawBytes, id: entry.rawId || newDraftIdentity() });
        node._rawFileName = entry.rawFileName;
        node._isFilePlaceholder = !!(entry.filePlaceholder && node._rawBytes);
        const controller = node.__ioCoding, coding = entry.coding;
        if (controller && coding) {
          controller.setCharset(coding.charset, { emit: false });
          controller.setBitOrder(coding.bitOrder, { emit: false });
          controller.setView(coding.view, { emit: false });
          controller.setKeepBom(coding.keepBom, { emit: false });
          controller.refresh();
        }
      }
      onRestore?.(id, record);
    } finally { suspended = false; }
    observer.observe(root, { subtree: true, childList: true, characterData: true });
  }
  async function clearAll(broadcast = true) {
    clearTimeout(timer); timer = 0; generation++; suspended = true;
    try {
      window.dispatchEvent(new Event('ebctf:workspace-clear'));
      for (const source of [...sources]) source.clear();
      onClear?.();
      for (const { node } of areas(root)) {
        if ('value' in node) node.value = ''; else node.textContent = '';
        node._rawBytes = null; node._rawFileName = null; node._isFilePlaceholder = false;
        byteVersions.delete(node);
        node._loadSeq = (node._loadSeq || 0) + 1;
        node.__ioCoding?.refresh(); node.classList.remove('error');
        node.removeAttribute('data-result-stale');
      }
      for (const [id, record] of records) records.set(id, { id, updated: Date.now(), areas: [], meta: {
        params: record.meta?.params, dir: record.meta?.dir,
      } });
      try { for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key); } catch { /* No journal. */ }
      await ready;
      if (db) await new Promise(resolve => {
        try {
          const transaction = db.transaction('drafts', 'readwrite'), store = transaction.objectStore('drafts');
          store.clear(); for (const record of records.values()) store.put(record);
          transaction.oncomplete = transaction.onerror = transaction.onabort = resolve;
        } catch { resolve(); }
      });
      if (broadcast) { try { localStorage.setItem(CLEAR_KEY, `${Date.now()}:${Math.random()}`); } catch { /* This tab was cleared. */ } }
    } finally { suspended = false; }
  }
  root.addEventListener('input', () => {
    schedule();
    // Keep the final keystroke in the synchronous journal before the browser
    // can navigate away; target handlers update parameter/file state first.
    queueMicrotask(save);
  }, true);
  root.addEventListener('change', schedule, true);
  root.addEventListener('click', schedule);
  const saveAll = () => { save(); for (const source of sources) source.save(); };
  window.addEventListener('pagehide', saveAll);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveAll(); });
  window.addEventListener('storage', event => { if (event.key === CLEAR_KEY && event.newValue) clearAll(false); });
  instance = { ready, get: id => records.get(id), bind, release, save, clearAll,
    connect(id, root, hooks) {
      let revision = 0, disposed = false, restoring = true;
      const source = {
        save() {
          if (disposed || suspended || restoring) return;
          revision++;
          const previous = records.get(id);
          const original = hooks.capture(), special = clone(original);
          retainFiles(original, special);
          const record = { id, updated: Math.max(Date.now(), (previous?.updated || 0) + 1), areas: [], meta: { special } };
          records.set(id, record); persist(record);
        },
        clear() { revision++; restoring = false; hooks.clear?.(); },
        changed() { revision++; restoring = false; source.save(); },
        dispose() {
          source.save(); disposed = true; revision++; sources.delete(source);
          for (const name of ['input', 'change', 'click']) root?.removeEventListener(name, change);
        },
      };
      const change = () => { revision++; restoring = false; queueMicrotask(source.save); };
      for (const name of ['input', 'change', 'click']) root?.addEventListener(name, change);
      sources.add(source);
      const epoch = generation, startRevision = revision;
      const current = () => !disposed && epoch === generation && revision === startRevision;
      source.ready = ready.then(async () => {
        if (!current()) return;
        try { await hooks.restore?.(records.get(id)?.meta?.special, current); }
        finally { if (current()) restoring = false; }
      });
      return source;
    },
    get epoch() { return generation; },
    close() { clearTimeout(timer); binding = null; suspended = true; for (const source of [...sources]) source.dispose(); observer.disconnect(); db?.close(); db = null; },
  };
  return instance;
}

export function connectSpecialDraft(key, root, hooks) {
  return instance?.connect(`special:${key}`, root, hooks) || { save() {}, changed() {}, dispose() {}, ready: Promise.resolve() };
}

export async function clearWorkspaceDrafts() { await instance?.clearAll(); }

export async function resetWorkspaceDrafts() {
  await instance?.clearAll();
  instance?.close();
  // Reset also removes the draft metadata, unlike the input/output-only action.
  await new Promise(resolve => {
    try { const request = indexedDB.deleteDatabase(DB_NAME); request.onsuccess = request.onerror = request.onblocked = resolve; }
    catch { resolve(); }
  });
}
