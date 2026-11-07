const KEY = 'ebctf.opLayout';
let current = 'adaptive';

export function getOpLayout() { return current; }

export function setOpLayout(value, persist = true) {
  current = value === 'traditional' ? 'traditional' : 'adaptive';
  document.documentElement.dataset.opLayout = current;
  if (persist) {
    try { localStorage.setItem(KEY, current); } catch { /* Session preference. */ }
  }
  window.dispatchEvent(new CustomEvent('ebctf:op-layout', { detail: current }));
}

export function initOpLayout() {
  let saved;
  try { saved = localStorage.getItem(KEY); } catch { /* Default to adaptive. */ }
  setOpLayout(saved, false);
}
