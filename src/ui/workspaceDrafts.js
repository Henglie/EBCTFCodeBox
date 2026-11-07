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
    }
    records.set(record.id, record);
  };
  const ready = openDatabase().then(async database => {
    db = database;
    if (db) db.onversionchange = () => { db.close(); db = null; };
    if (db) await new Promise(resolve => {
      try {
        const request = db.transaction('drafts').objectStore('drafts').getAll();
        request.onsuccess = () => { for (const record of request.result) merge(record); resolve(); };
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
    const journal = backup(record), epoch = generation;
    const write = () => {
      if (epoch !== generation) return;
      if (!db) { if (!journal && !reported) { reported = true; onStorageError?.(); } return; }
      try {
        const transaction = db.transaction('drafts', 'readwrite');
        transaction.objectStore('drafts').put(record);
        transaction.oncomplete = () => {
          // Remove only the exact journal that this transaction committed.
          // A newer keystroke may already have written its own reload protection.
          try { const saved = JSON.parse(localStorage.getItem(PREFIX + record.id)); if (saved?.updated === record.updated) localStorage.removeItem(PREFIX + record.id); } catch { /* No journal. */ }
        };
        transaction.onerror = () => { if (!journal && !reported) { reported = true; onStorageError?.(); } };
      } catch { if (!journal && !reported) { reported = true; onStorageError?.(); } }
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
        if (entry.error) node.style.color = 'var(--error)';
        node._rawBytes = entry.rawBytes ? new Uint8Array(entry.rawBytes) : null;
        if (node._rawBytes) byteVersions.set(node, { bytes: node._rawBytes, id: entry.rawId || newDraftIdentity() });
        node._rawFileName = entry.rawFileName;
        node._isFilePlaceholder = !!(entry.filePlaceholder && node._rawBytes);
        const controller = node.__ioCoding, coding = entry.coding;
        if (controller && coding) {
          controller.setCharset(coding.charset, { emit: false });
          controller.setView(coding.view, { emit: false });
          controller.setKeepBom(coding.keepBom, { emit: false });
          controller.setBitOrder(coding.bitOrder, { emit: false });
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
      onClear?.();
      for (const { node } of areas(root)) {
        if ('value' in node) node.value = ''; else node.textContent = '';
        node._rawBytes = null; node._rawFileName = null; node._isFilePlaceholder = false;
        byteVersions.delete(node);
        node._loadSeq = (node._loadSeq || 0) + 1;
        node.__ioCoding?.refresh(); node.classList.remove('error');
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
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });
  window.addEventListener('storage', event => { if (event.key === CLEAR_KEY && event.newValue) clearAll(false); });
  instance = { ready, get: id => records.get(id), bind, release, save, clearAll,
    get epoch() { return generation; },
    close() { clearTimeout(timer); binding = null; suspended = true; observer.disconnect(); db?.close(); db = null; },
  };
  return instance;
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
