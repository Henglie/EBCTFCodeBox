import { getOpLayout } from './layoutPreferences.js';

const RATIO_KEY = 'ebctf.workbenchRatios';
const sessionRatios = new Map();
export function loadWorkbenchRatio(key) {
  if (!key) return .5;
  try {
    const value = JSON.parse(localStorage.getItem(RATIO_KEY) || '{}')[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1) return value;
  } catch { /* Session memory still works when storage is unavailable. */ }
  return sessionRatios.get(key) ?? .5;
}
function saveRatio(key, ratio) {
  if (!key) return;
  sessionRatios.set(key, ratio);
  try {
    let saved = JSON.parse(localStorage.getItem(RATIO_KEY) || '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
    localStorage.setItem(RATIO_KEY, JSON.stringify({ ...saved, [key]: ratio }));
  } catch { /* Keep this tool's session preference. */ }
}

export function attachOpWorkbench(workbench) {
  const key = workbench.dataset.workbenchKey;
  let preferredRatio = loadWorkbenchRatio(key);
  const splitter = workbench.querySelector('.op-splitter');
  const config = workbench.querySelector('.op-config');
  const landscape = matchMedia('(orientation: landscape)');
  let width = 0, available = 0, actual = 0, minimum = 0, maximum = 0, drag = null;
  const rtl = () => getComputedStyle(workbench).direction === 'rtl';
  const stop = () => {
    if (drag && splitter.hasPointerCapture(drag.id)) splitter.releasePointerCapture(drag.id);
    drag = null;
    workbench.classList.remove('is-resizing');
  };
  function layout() {
    width = workbench.getBoundingClientRect().width;
    const split = landscape.matches && getOpLayout() !== 'traditional';
    workbench.dataset.layout = split ? 'split' : 'stack';
    splitter.tabIndex = split ? 0 : -1;
    splitter.setAttribute('aria-hidden', String(!split));
    if (!split) { stop(); return; }
    available = Math.max(0, width - splitter.getBoundingClientRect().width);
    minimum = Math.min(240, available * .3);
    maximum = available - minimum;
    actual = Math.max(minimum, Math.min(maximum, available * preferredRatio));
    const ratio = available > 0 ? actual / available : .5;
    workbench.style.setProperty('--op-config-fr', `${ratio}fr`);
    workbench.style.setProperty('--op-data-fr', `${1 - ratio}fr`);
    splitter.setAttribute('aria-valuemin', String(Math.ceil(minimum)));
    splitter.setAttribute('aria-valuemax', String(Math.floor(maximum)));
    splitter.setAttribute('aria-valuenow', String(Math.round(actual)));
  }
  const resize = value => { preferredRatio = Math.max(minimum, Math.min(maximum, value)) / (available || 1); saveRatio(key, preferredRatio); layout(); };
  const reset = () => { preferredRatio = .5; saveRatio(key, preferredRatio); layout(); };
  splitter.addEventListener('pointerdown', event => {
    if (event.button !== 0 || workbench.dataset.layout !== 'split') return;
    layout();
    event.preventDefault();
    splitter.focus({ preventScroll: true });
    drag = { id: event.pointerId, x: event.clientX, width: actual };
    splitter.setPointerCapture(event.pointerId);
    workbench.classList.add('is-resizing');
  });
  splitter.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    resize(drag.width + (event.clientX - drag.x) * (rtl() ? -1 : 1));
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) splitter.addEventListener(name, stop);
  splitter.addEventListener('dblclick', reset);
  splitter.addEventListener('keydown', event => {
    if (workbench.dataset.layout !== 'split') return;
    layout();
    const step = event.shiftKey ? 48 : 16;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      resize(actual + (event.key === 'ArrowRight' ? step : -step) * (rtl() ? -1 : 1));
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault(); resize(event.key === 'Home' ? minimum : maximum);
    } else if (event.key === 'Enter') {
      event.preventDefault(); reset();
    } else if (event.key === 'Escape' && drag) {
      const start = drag.width; stop(); resize(start);
    }
  });
  const observer = new ResizeObserver(layout);
  observer.observe(workbench);
  landscape.addEventListener('change', layout);
  window.addEventListener('resize', layout);
  window.addEventListener('ebctf:op-layout', layout);
  layout();
  // IO keeps focus without scrolling the workspace past its operation title.
  const focusConfig = event => {
    if (workbench.dataset.layout !== 'split') return;
    const target = event.target.getBoundingClientRect(), box = config.getBoundingClientRect();
    if (target.top < box.top + 8) config.scrollTop += target.top - box.top - 8;
    else if (target.bottom > box.bottom - 8) config.scrollTop += target.bottom - box.bottom + 8;
  };
  config.addEventListener('focusin', focusConfig);
  return () => {
    stop(); observer.disconnect();
    landscape.removeEventListener('change', layout);
    window.removeEventListener('resize', layout);
    window.removeEventListener('ebctf:op-layout', layout);
    config.removeEventListener('focusin', focusConfig);
  };
}
