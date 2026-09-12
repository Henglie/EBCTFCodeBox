import { t } from "../i18n/index.js";
import { icon } from "./icons.js";

const STORAGE_KEY = "ebctf_favorites";
const MAX_FAVORITES = 200;
let sessionIds = null;

export function loadFavorites() {
  if (sessionIds !== null) return sessionIds.slice();
  let raw;
  try { raw = localStorage.getItem(STORAGE_KEY); }
  catch { sessionIds = []; return []; }
  try {
    const values = JSON.parse(raw || "[]");
    if (!Array.isArray(values)) return [];
    return [...new Set(values.filter(id => typeof id === "string" && id.length > 0 && id.length <= 128))].slice(0, MAX_FAVORITES);
  } catch { return []; }
}

function saveFavorites(ids) {
  if (sessionIds !== null) { sessionIds = ids; return false; }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ids)); return true; }
  catch { sessionIds = ids; return false; }
}

export function isFavorite(id) { return loadFavorites().includes(id); }
export function toggleFavorite(id) {
  const current = loadFavorites();
  const added = !current.includes(id);
  if (added && current.length >= MAX_FAVORITES) return { full: true };
  const ids = added ? [...current, id] : current.filter(value => value !== id);
  return { added, persisted: saveFavorites(ids) };
}
export function clearFavorites() { return { cleared: true, persisted: saveFavorites([]) }; }

let closeMenu = () => {};
export function openFavMenu(x, y, { opId, entries, onChange } = {}) {
  closeMenu();
  const previousFocus = document.activeElement;
  const menu = document.createElement("div");
  menu.className = "fav-menu";
  menu.setAttribute("role", "menu");
  const buttons = (entries?.length ? entries : [{ opId }]).map(entry => {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    const label = entry.opId ? (isFavorite(entry.opId) ? "ui.fav.remove" : "ui.fav.add") : "ui.fav.clear";
    button.innerHTML = icon(entry.opId ? "star" : "delete");
    button.append(document.createTextNode(t(label) + (entry.label ? " · " + entry.label : "")));
    button.addEventListener("click", () => {
      const result = entry.opId ? toggleFavorite(entry.opId) : clearFavorites();
      closeMenu();
      onChange?.(result);
    });
    menu.append(button);
    return button;
  });
  document.body.append(menu);
  // Layout dimensions are unaffected by the menu's opening transform.
  menu.style.left = Math.max(4, Math.min(x, innerWidth - menu.offsetWidth - 4)) + "px";
  menu.style.top = Math.max(4, Math.min(y, innerHeight - menu.offsetHeight - 4)) + "px";
  const events = new AbortController();
  let timer;
  closeMenu = () => {
    clearTimeout(timer);
    events.abort();
    menu.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
  };
  menu.addEventListener("keydown", event => {
    if (event.key === "Escape" || event.key === "Tab") {
      if (event.key === "Escape") event.preventDefault();
      event.stopPropagation();
      closeMenu();
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next].focus();
    }
  });
  buttons[0].focus();
  timer = setTimeout(() => {
    document.addEventListener("pointerdown", event => {
      if (!menu.contains(event.target)) closeMenu();
    }, { signal: events.signal });
    window.addEventListener("blur", closeMenu, { signal: events.signal });
  }, 0);
}
