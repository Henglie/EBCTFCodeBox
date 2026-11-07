const KEY = "ebctf.motionSpeed";
const SPEEDS = new Set([0.75, 1, 1.25]);
let current = 1;

export function setMotionSpeed(value, persist = true) {
  const speed = Number(value);
  current = SPEEDS.has(speed) ? speed : 1;
  document.documentElement.style.setProperty("--motion-scale", String(current));
  document.documentElement.dataset.motionSpeed = String(current);
  if (persist) {
    try { localStorage.setItem(KEY, String(current)); } catch { /* Session preference. */ }
  }
}

export function getMotionSpeed() { return current; }

export function initMotionPreferences() {
  let saved = 1;
  try { saved = localStorage.getItem(KEY) || 1; } catch { /* Default cadence. */ }
  setMotionSpeed(saved, false);
}
