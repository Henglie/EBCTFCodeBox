import { getMotionSpeed } from './motionPreferences.js';

// Existing product preference is authoritative; OS motion does not override it.
export const motionAllowed = () => !document.documentElement.classList.contains('reduce-motion')
  && document.documentElement.classList.contains('spring-motion');
const disclosures = new WeakMap();
const running = new Set();
const surfaces = new WeakMap();
const controls = 'button, .act-btn, .nav-item, .nav-subitem, summary, a.home-tool-card';
export function finishExpressiveMotion() { for (const entry of [...running]) entry.stop(); }

/** Height belongs only to the small disclosure being changed, never the page.
 * A new intent samples the current frame before cancelling the previous one. */
export function setDisclosure(node, expanded) {
  const old = disclosures.get(node);
  const currentHeight = node.hidden ? 0 : node.getBoundingClientRect().height;
  const currentOpacity = node.hidden ? 0 : Number(getComputedStyle(node).opacity);
  old?.cancel();
  node.hidden = false;
  node.removeAttribute('inert');
  const targetHeight = expanded ? node.scrollHeight : 0;
  const finish = () => {
    node.hidden = !expanded;
    node.style.removeProperty('overflow');
    disclosures.delete(node); running.delete(entry);
    node.removeAttribute('inert');
  };
  let animation = null;
  const entry = { stop() { animation?.cancel(); finish(); } };
  if (!motionAllowed() || !node.animate || !node.isConnected) { finish(); return; }
  if (!expanded) node.setAttribute('inert', '');
  // Large algorithm grids fade; do not repeatedly lay out thousands of pixels.
  const frames = Math.max(currentHeight, targetHeight) <= 900
    ? [{ height: `${currentHeight}px`, opacity: currentOpacity }, { height: `${targetHeight}px`, opacity: expanded ? 1 : 0 }]
    : [{ opacity: currentOpacity }, { opacity: expanded ? 1 : 0 }];
  node.style.overflow = 'hidden';
  animation = node.animate(frames, { duration: 200 * getMotionSpeed(), easing: 'cubic-bezier(.2,0,0,1)' });
  disclosures.set(node, animation); running.add(entry);
  animation.onfinish = finish;
  animation.oncancel = () => { running.delete(entry); };
}

/** Anchored surfaces move a few pixels, never scale their text or curve. */
export function enterSurface(node, distance = 8) {
  node.setAttribute('data-m3-surface', '');
  if (!motionAllowed() || !node.animate) return;
  surfaces.get(node)?.animation.cancel();
  const animation = node.animate([{ opacity: 0, transform: `translateY(${distance}px)` }, { opacity: 1, transform: 'none' }],
    { duration: 200 * getMotionSpeed(), easing: 'cubic-bezier(.05,.7,.1,1)' });
  const entry = { animation, stop() { animation.cancel(); surfaces.delete(node); running.delete(entry); } };
  surfaces.set(node, entry); running.add(entry);
  animation.onfinish = () => { surfaces.delete(node); running.delete(entry); };
  animation.oncancel = () => running.delete(entry);
}

export function exitSurface(node, complete) {
  const old = surfaces.get(node), style = getComputedStyle(node);
  const from = { opacity: style.opacity, transform: style.transform };
  old?.animation.cancel();
  if (!motionAllowed() || !node.animate || !node.isConnected) { complete(); return; }
  let done = false;
  const animation = node.animate([from, { opacity: 0, transform: 'translateY(4px)' }],
    { duration: 150 * getMotionSpeed(), easing: 'cubic-bezier(.3,0,.8,.15)', fill: 'forwards' });
  const finish = () => { if (done) return; done = true; surfaces.delete(node); running.delete(entry); complete(); animation.cancel(); };
  const entry = { animation, stop: finish };
  surfaces.set(node, entry); running.add(entry); animation.onfinish = finish;
  animation.oncancel = () => running.delete(entry);
}

let installed = false;
export function initExpressiveMotion() {
  if (installed) return;
  installed = true;
  const pressed = new Map();
  const eligible = target => {
    const node = target?.closest?.(controls);
    return node && !node.disabled && node.getAttribute('aria-disabled') !== 'true' ? node : null;
  };
  const clear = key => { const node = pressed.get(key); if (node) { pressed.delete(key); if (![...pressed.values()].includes(node)) node.removeAttribute('data-m3-pressed'); } };
  const clearAll = () => { for (const key of [...pressed.keys()]) clear(key); };
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const node = eligible(event.target); if (!node) return;
    clear(event.pointerId); pressed.set(event.pointerId, node); node.setAttribute('data-m3-pressed', 'true');
  }, true);
  for (const name of ['pointerup', 'pointercancel']) document.addEventListener(name, event => clear(event.pointerId), true);
  document.addEventListener('pointerout', event => {
    const node = pressed.get(event.pointerId);
    if (node && !node.contains(event.relatedTarget)) clear(event.pointerId);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.repeat || event.isComposing || ![' ', 'Enter'].includes(event.key) || !event.target.matches?.('button, summary, [role="button"]')) return;
    const node = eligible(event.target); if (node) { pressed.set('keyboard', node); node.setAttribute('data-m3-pressed', 'true'); }
  }, true);
  document.addEventListener('keyup', () => clear('keyboard'), true);
  document.addEventListener('focusout', () => clear('keyboard'), true);
  window.addEventListener('blur', clearAll);
  window.addEventListener('pagehide', clearAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearAll(); });
  new MutationObserver(() => {
    if (!motionAllowed()) finishExpressiveMotion();
    for (const [key, node] of pressed) if (!node.isConnected || node.disabled) clear(key);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}
