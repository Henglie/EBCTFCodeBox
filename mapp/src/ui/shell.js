import { initSdk, getSdk, getTheme, onThemeChange, lifecycleReady, isRealSdk, loadAssetUrl } from "../platform/sdk.js";
import { initStorage, flush, onStorageError, favorites, setFavorites, setPrefs } from "../platform/storage.js";
import { initClipboard, copyText } from "../platform/clipboard.js";
import { CATALOG, CATS } from "../generated/catalog.js";
import { h, icon, clear } from "./dom.js";
import { renderHome } from "./views/home.js";
import { renderBrowse } from "./views/browse.js";
import { renderOp } from "./views/op.js";
import { renderRecipe } from "./views/recipe.js";
import { renderMine } from "./views/mine.js";

const BY_ID = new Map(CATALOG.map((o) => [o.id, o]));
const ROUTES = ["home", "ops", "op", "recipe", "mine"];

let ctx = null;
let disposeView = null;
let toastTimer = null;
let themeOff = null;
let brandBlobUrl = null;

function parseHash() {
  const raw = (location.hash || "#/home").replace(/^#\/?/, "");
  const parts = raw.split("/").filter(Boolean);
  if (!parts.length) return { name: "home" };
  if (parts[0] === "op" && parts[1]) return { name: "op", id: decodeURIComponent(parts[1]) };
  if (ROUTES.includes(parts[0])) return { name: parts[0] };
  return { name: "home" };
}

function applyTheme(theme) {
  const root = document.documentElement;
  const mode = theme.mode === "light" ? "light" : "dark";
  root.dataset.theme = mode;
  root.style.setProperty("--accent", theme.accent || "#8f3d33");
  root.style.setProperty("--bg", theme.background || (mode === "dark" ? "#141110" : "#fff8f5"));
  root.style.setProperty("--text", theme.text || (mode === "dark" ? "#f2e6e2" : "#241a17"));
  root.style.setProperty("--border", theme.border || (mode === "dark" ? "#59443f" : "#e0c9c2"));
  const accent = theme.accent || "#8f3d33";
  const m = /^#?([0-9a-f]{6})$/i.exec(accent);
  let light = false;
  if (m) {
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    light = (0.2126 * r + 0.7152 * g + 0.0722 * b) > 150;
  }
  root.style.setProperty("--on-accent", light ? "#1b1210" : "#ffffff");
  root.dataset.reduceMotion = theme.reducedMotion ? "true" : "false";
  const vp = theme.viewport || {};
  if (vp.width) root.style.setProperty("--app-w", vp.width + "px");
  if (vp.height) root.style.setProperty("--app-h", vp.height + "px");
  updateSize();
}

function updateSize() {
  const app = document.getElementById("mapp");
  if (!app) return;
  const w = app.clientWidth || window.innerWidth;
  const h = app.clientHeight || window.innerHeight;
  document.documentElement.style.setProperty("--app-w", w + "px");
  document.documentElement.style.setProperty("--app-h", h + "px");
  app.dataset.size = w < 600 ? "compact" : w < 920 ? "medium" : "wide";
}

export function toast(message, kind = "info") {
  const root = document.getElementById("toast-root");
  if (!root) return;
  if (toastTimer) clearTimeout(toastTimer);
  clear(root);
  const el = h("div", { class: "toast toast-" + kind }, kind === "error" ? icon("info", 18) : icon("check", 18), h("span", { text: String(message) }));
  root.append(el);
  requestAnimationFrame(() => el.classList.add("show"));
  toastTimer = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => { if (el.isConnected) el.remove(); }, 220);
  }, 2600);
}

export function confirmDialog(title, message, okLabel = "确认") {
  return new Promise((resolve) => {
    const overlay = h("div", { class: "overlay" });
    const close = (v) => { overlay.remove(); resolve(v); };
    const box = h("div", { class: "modal small", role: "dialog", "aria-modal": "true" },
      h("div", { class: "modal-head" }, h("h2", { text: title })),
      h("p", { class: "modal-text", text: message }),
      h("div", { class: "modal-actions" },
        h("button", { class: "btn ghost", type: "button", onclick: () => close(false) }, "取消"),
        h("button", { class: "btn danger", type: "button", onclick: () => close(true) }, okLabel)
      )
    );
    overlay.append(box);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
    document.getElementById("overlay-root").append(overlay);
    box.querySelector(".btn.danger").focus();
  });
}

function makeCtx(sdk) {
  const favSet = new Set(favorites());
  const api = {
    sdk,
    catalog: CATALOG,
    cats: CATS,
    byId: BY_ID,
    isReal: isRealSdk(),
    isFav: (id) => favSet.has(id),
    toggleFav(id) {
      if (favSet.has(id)) favSet.delete(id); else favSet.add(id);
      setFavorites([...favSet]);
      return favSet.has(id);
    },
    openOp(id) { navigate("#/op/" + encodeURIComponent(id)); },
    navigate,
    toast,
    confirm: confirmDialog,
    copy: async (text) => {
      try {
        const r = await copyText(text);
        toast(r.truncated ? "已复制前 4 KiB（平台上限）" : "已复制", "ok");
        return true;
      } catch (e) {
        toast("复制失败：" + (e && e.message ? e.message : "未知错误"), "error");
        return false;
      }
    },
    rerender() { renderRoute(); },
  };
  return api;
}

export function navigate(hash) {
  if (location.hash === hash) renderRoute();
  else location.hash = hash;
}

function renderRoute() {
  const route = parseHash();
  const view = document.getElementById("view");
  if (!view) return;
  setPrefs({ lastRoute: route.name });
  if (disposeView) { try { disposeView(); } catch {} disposeView = null; }
  clear(view);
  view.scrollTop = 0;
  document.querySelectorAll(".tabbar button[data-route]").forEach((b) => {
    b.classList.toggle("active", b.dataset.route === route.name || (route.name === "op" && b.dataset.route === "ops"));
  });
  try {
    if (route.name === "home") disposeView = renderHome(view, ctx);
    else if (route.name === "ops") disposeView = renderBrowse(view, ctx);
    else if (route.name === "op") disposeView = renderOp(view, ctx, route.id);
    else if (route.name === "recipe") disposeView = renderRecipe(view, ctx);
    else if (route.name === "mine") disposeView = renderMine(view, ctx);
  } catch (e) {
    view.append(h("div", { class: "empty-card" },
      h("h2", { text: "页面加载失败" }),
      h("p", { text: e && e.message ? e.message : String(e) })
    ));
  }
}

function errorScreen(message) {
  const view = document.getElementById("view");
  if (!view) return;
  clear(view);
  view.append(h("div", { class: "empty-card" },
    icon("info", 32),
    h("h2", { text: "无法启动" }),
    h("p", { text: message }),
    h("p", { class: "muted", text: "请从 Linux.do 社区的应用入口打开本工具。" })
  ));
}

export async function boot() {
  const view = document.getElementById("view");
  view.append(h("div", { class: "loading" }, h("div", { class: "spinner" }), h("p", { text: "正在加载本地算法…" })));

  let sdk;
  try {
    sdk = await initSdk();
  } catch (e) {
    errorScreen(e && e.message ? e.message : String(e));
    await lifecycleReady();
    return;
  }

  const theme = await getTheme();
  applyTheme(theme);
  themeOff = onThemeChange((t) => applyTheme(t));
  initClipboard(sdk);
  await initStorage(sdk);
  onStorageError(() => toast("平台存储不可用，本次修改仅在当前会话保留", "error"));

  ctx = makeCtx(sdk);

  const applyBrandIcon = async () => {
    const mark = document.getElementById("brandMark");
    if (!mark) return;
    const src = isRealSdk() ? await loadAssetUrl("icons/app-icon-192.png") : "icons/app-icon-192.png";
    if (!src) return;
    if (src.startsWith("blob:")) brandBlobUrl = src;
    mark.replaceChildren(h("img", { src, alt: "", width: 36, height: 36 }));
  };

  const tabIcons = { home: "bolt", ops: "grid", recipe: "layers", mine: "person" };
  document.querySelectorAll(".tabbar button[data-route]").forEach((b) => {
    if (!b.querySelector("svg")) b.prepend(icon(tabIcons[b.dataset.route] || "grid", 20));
    b.addEventListener("click", () => navigate("#/" + b.dataset.route));
  });
  window.addEventListener("hashchange", renderRoute);
  window.addEventListener("pagehide", () => {
    void flush();
    if (themeOff) themeOff();
    if (brandBlobUrl) { try { URL.revokeObjectURL(brandBlobUrl); } catch {} brandBlobUrl = null; }
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") void flush(); });

  const ro = new ResizeObserver(() => updateSize());
  ro.observe(document.getElementById("mapp"));

  renderRoute();
  updateSize();
  void applyBrandIcon();
  await lifecycleReady();
  if (!isRealSdk()) toast("本地预览模式：平台能力由浏览器模拟", "info");
}
