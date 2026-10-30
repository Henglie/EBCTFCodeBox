/*
 * resultActions.js — 结果类型动作按钮行（不依赖 main.js / app.css）
 *
 *   renderResultActions(container, text, { onCopy, onOpen, locale, confirmText })
 *
 * - 按钮类名 ra-*，样式按需注入一次（#ra-style），全部带 CSS 变量回退。
 * - 联网动作（open-url / open-map）两段式确认：第一次点击只显示
 *   「确认打开 <完整主机名>」，第二次点击才打开；8 秒未确认自动复位。
 * - open-url 打开前再次 sanitizeOpenUrl（https 升级 / 危险 scheme 拒绝），
 *   主机名完整展示，不截断；口令只存在 payload 中，不写 DOM 属性、不进 console。
 * - 点击复制动作：先写剪贴板，再回调 onCopy(payload, action, result)。
 *
 * 返回 { root, element, result, actions, dispose }。
 */

import { classifyResult, sanitizeOpenUrl } from "../core/resultTypes.js";
import { icon as iconSvg } from "./icons.js";

const STYLE_ID = "ra-style";
const PENDING_MS = 8000;
const FLASH_MS = 1400;

const KIND_ICONS = {
  url: "web",
  email: "attach_file",
  wifi: "vpn_key",
  tel: "dialpad",
  geo: "travel_explore",
  vcard: "badge",
  json: "data_object",
  jwt: "key",
  flag: "tag",
  base64: "code",
  ipv4: "dns",
  ipv6: "dns",
  magnet: "download",
  text: "text_fields",
};

const ACTION_ICONS = {
  "open-url": "web",
  "open-map": "travel_explore",
  "copy": "content_copy",
  "copy-email": "content_copy",
  "copy-wifi-ssid": "content_copy",
  "copy-wifi-pass": "key",
  "copy-tel": "dialpad",
  "copy-password": "key",
  "copy-decoded": "code",
};

const UI_TEXT = {
  zh: {
    group: (label) => `${label}操作`,
    confirmOpen: (host) => `确认打开 ${host}`,
    confirmMap: (host) => (host ? `确认打开地图（${host}）` : "确认打开地图"),
    openFailed: "无法打开",
    copied: "已复制",
    copyFailed: "复制失败",
    upgraded: "已升级 HTTPS",
  },
  en: {
    group: (label) => `${label} actions`,
    confirmOpen: (host) => `Open ${host}`,
    confirmMap: (host) => (host ? `Open map (${host})` : "Open map"),
    openFailed: "Cannot open",
    copied: "Copied",
    copyFailed: "Copy failed",
    upgraded: "upgraded to HTTPS",
  },
};

function normalizeLocale(locale) {
  if (typeof locale === "string") return /^en/i.test(locale) ? "en" : "zh";
  if (typeof document !== "undefined") {
    const lang = (document.documentElement && document.documentElement.lang) || "";
    if (/^en/i.test(lang)) return "en";
  }
  return "zh";
}

function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.ra-row { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:6px;
  font-size:13px; line-height:1.35; min-width:0; }
.ra-kind, .ra-host { display:inline-flex; align-items:center; gap:4px; min-width:0; max-width:100%;
  padding:2px 8px; border-radius:999px; border:1px solid var(--outline-var, rgba(128,128,128,.3));
  background:var(--surface-3, rgba(128,128,128,.1)); color:var(--on-surface-var, #555); }
.ra-kind { font-weight:600; }
.ra-host { color:var(--on-surface, #111); font-weight:600; overflow-wrap:anywhere; word-break:break-word; }
.ra-ico { display:inline-flex; width:1em; height:1em; flex:none; }
.ra-ico svg { width:1em; height:1em; display:block; }
.ra-btn { display:inline-flex; align-items:center; gap:4px; min-width:0; max-width:100%;
  padding:3px 9px; border-radius:999px; border:1px solid var(--outline, rgba(128,128,128,.5));
  background:var(--surface-2, #fff); color:var(--on-surface, #111);
  font:inherit; font-size:12.5px; line-height:1.3; cursor:pointer; }
.ra-btn:hover { background:var(--surface-hi, rgba(128,128,128,.15)); }
.ra-btn:focus-visible { outline:2px solid var(--primary, #2b6cb0); outline-offset:1px; }
.ra-btn.ra-pending { background:var(--primary, #2b6cb0); border-color:transparent; color:#fff; }
.ra-btn.ra-copied { border-color:var(--primary, #2b6cb0); color:var(--primary, #2b6cb0); }
.ra-btn.ra-error { border-color:#c62828; color:#c62828; }
.ra-btn .ra-label { overflow-wrap:anywhere; }
@media (max-width:600px) { .ra-row { font-size:12.5px; } }
`;
  (document.head || document.documentElement).appendChild(style);
}

function resolveContainer(container) {
  if (typeof container === "string") {
    const el = typeof document !== "undefined" ? document.querySelector(container) : null;
    if (!el) throw new Error("renderResultActions: 容器不存在: " + container);
    return el;
  }
  if (container && typeof container.appendChild === "function") return container;
  throw new TypeError("renderResultActions: 容器无效");
}

function isNetworkAction(a) {
  return Boolean(a && (a.kind === "open" || a.kind === "map" || (a.payload && a.payload.needsConfirm)));
}

function mapHint(result) {
  const f = result.fields || {};
  switch (result.kind) {
    case "url": return f.displayHost || f.host || "";
    case "email": return f.email || "";
    case "wifi": return f.ssid || "";
    case "tel": return f.tel || "";
    case "geo": return f.lat != null ? `${f.lat}, ${f.lon}` : (f.query || "");
    case "vcard": return f.name || "";
    case "json": return f.type === "array"
      ? `[${Array.isArray(f.value) ? f.value.length : 0}]`
      : "object";
    case "jwt": return `${f.alg || "JWT"}${f.expired ? " · expired" : ""}`;
    case "flag": return f.flag || "";
    case "base64": return f.mimeGuess || (f.urlSafe ? "base64url" : "base64");
    case "magnet": return f.btih ? `btih:${f.btih}` : "";
    default: return "";
  }
}

function hintTitle(result, hint) {
  const f = result.fields || {};
  if (result.kind === "url") {
    const info = sanitizeOpenUrl(f.displayUrl || f.openUrl || "", { upgradeHttps: true });
    return info.ok ? info.displayUrl : "";
  }
  if (result.kind === "geo") return f.mapUrl || "";
  return hint || "";
}

function makeIcon(name) {
  const span = document.createElement("span");
  span.className = "ra-ico";
  span.setAttribute("aria-hidden", "true");
  try { span.innerHTML = iconSvg(name); } catch { /* keep empty */ }
  return span;
}

function makeButton(action) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ra-btn";
  btn.dataset.raAction = String(action.id);
  btn.dataset.raPending = "0";
  btn.dataset.raOriginal = String(action.label);
  btn.append(makeIcon(ACTION_ICONS[action.id] || "content_copy"));
  const label = document.createElement("span");
  label.className = "ra-label";
  label.textContent = String(action.label);
  btn.append(label);
  btn.setAttribute("aria-label", String(action.label));
  if (action.payload && action.payload.sensitive) btn.classList.add("ra-sensitive");
  if (isNetworkAction(action)) btn.classList.add("ra-network");
  return btn;
}

async function writeClipboard(text) {
  const value = String(text == null ? "" : text);
  if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try { await navigator.clipboard.writeText(value); return true; } catch { /* fall through */ }
  }
  if (typeof document === "undefined") return false;
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = typeof document.execCommand === "function" && document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  if (!ok) throw new Error("clipboard-unavailable");
  return true;
}

function openExternal(url) {
  const info = sanitizeOpenUrl(url, { upgradeHttps: true });
  if (!info.ok) return false;
  if (typeof document === "undefined") return false;
  const a = document.createElement("a");
  a.href = info.url;
  a.target = "_blank";
  a.rel = "noopener noreferrer nofollow";
  a.style.cssText = "position:fixed;left:-9999px;top:0";
  document.body.appendChild(a);
  a.click();
  a.remove();
  return true;
}

/**
 * 在 container 内生成紧凑动作按钮行。
 * @param {Element|string} container
 * @param {string|object} text 结果文本；也可直接传 classifyResult() 的返回对象
 * @param {{onCopy?:Function,onOpen?:Function,locale?:string,upgradeHttps?:boolean,
 *   confirmText?:string|Function,copy?:boolean}} [options]
 */
export function renderResultActions(container, text, options = {}) {
  const host = resolveContainer(container);
  const locale = normalizeLocale(options.locale);
  const t = UI_TEXT[locale];
  const result = text && typeof text === "object" && Array.isArray(text.actions)
    ? text
    : classifyResult(text, { locale, upgradeHttps: options.upgradeHttps !== false });

  ensureStyles();

  const root = document.createElement("div");
  root.className = "ra-row";
  root.dataset.raKind = result.kind;
  root.setAttribute("role", "group");
  root.setAttribute("aria-label", t.group(result.label));

  const kindChip = document.createElement("span");
  kindChip.className = "ra-kind";
  kindChip.append(makeIcon(KIND_ICONS[result.kind] || "info"), document.createTextNode(String(result.label)));

  const hint = mapHint(result);
  const hostChip = document.createElement("span");
  hostChip.className = "ra-host";
  if (hint) hostChip.textContent = hint;
  else hostChip.remove();
  const title = hint ? hintTitle(result, hint) : "";
  if (title) hostChip.title = title;

  const buttons = [];
  const pendingTimers = new Map();
  const flashTimers = new Map();

  function resetPending(btn) {
    if (!btn) return;
    const timer = pendingTimers.get(btn);
    if (timer) { clearTimeout(timer); pendingTimers.delete(btn); }
    btn.dataset.raPending = "0";
    btn.classList.remove("ra-pending");
    const label = btn.querySelector(".ra-label");
    if (label && btn.dataset.raOriginal != null) label.textContent = btn.dataset.raOriginal;
  }

  function resetAllPending(except) {
    for (const btn of buttons) if (btn !== except) resetPending(btn);
  }

  function confirmLabel(action) {
    if (typeof options.confirmText === "function") {
      const custom = options.confirmText(action, result);
      if (custom != null) return String(custom);
    } else if (typeof options.confirmText === "string" && options.confirmText) {
      return options.confirmText;
    }
    const p = action.payload || {};
    const displayHost = p.displayHost || p.host || "";
    if (action.kind === "map") return t.confirmMap(displayHost);
    return t.confirmOpen(displayHost || p.displayUrl || "");
  }

  function setPending(btn, action) {
    resetAllPending(btn);
    const label = btn.querySelector(".ra-label");
    if (label) btn.dataset.raOriginal = label.textContent;
    if (label) label.textContent = confirmLabel(action);
    btn.dataset.raPending = "1";
    btn.classList.add("ra-pending");
    const timer = setTimeout(() => { pendingTimers.delete(btn); resetPending(btn); }, PENDING_MS);
    pendingTimers.set(btn, timer);
  }

  function flash(btn, message, cls) {
    const old = flashTimers.get(btn);
    if (old) { clearTimeout(old); flashTimers.delete(btn); }
    const label = btn.querySelector(".ra-label");
    if (label) label.textContent = message;
    btn.classList.add(cls);
    const timer = setTimeout(() => {
      flashTimers.delete(btn);
      btn.classList.remove(cls);
      if (btn.dataset.raPending !== "1" && label && btn.dataset.raOriginal != null) {
        label.textContent = btn.dataset.raOriginal;
      }
    }, FLASH_MS);
    flashTimers.set(btn, timer);
  }

  async function handleCopy(btn, action) {
    const payload = action.payload || {};
    const value = typeof payload.text === "string" ? payload.text : "";
    let copied = false;
    if (options.copy !== false) {
      try { copied = await writeClipboard(value); } catch { copied = false; }
    }
    if (typeof options.onCopy === "function") {
      try { await options.onCopy(payload, action, result); } catch { /* host callback errors stay silent */ }
    }
    if (copied) flash(btn, t.copied, "ra-copied");
    else if (options.copy !== false && typeof options.onCopy !== "function") flash(btn, t.copyFailed, "ra-error");
  }

  async function handleOpen(btn, action) {
    if (btn.dataset.raPending !== "1") { setPending(btn, action); return; }
    resetPending(btn);
    const payload = action.payload || {};
    const info = sanitizeOpenUrl(payload.url || "", { upgradeHttps: true });
    if (!info.ok) { flash(btn, t.openFailed, "ra-error"); return; }
    const safePayload = {
      url: info.url,
      originalUrl: info.originalUrl,
      host: info.host,
      hostname: info.hostname,
      port: info.port,
      displayHost: info.displayHost,
      displayUrl: info.displayUrl,
      scheme: info.scheme,
      finalScheme: info.finalScheme,
      upgraded: info.upgraded,
      needsConfirm: true,
      external: true,
      lat: payload.lat,
      lon: payload.lon,
      query: payload.query,
    };
    try {
      if (typeof options.onOpen === "function") {
        await options.onOpen(safePayload, action, result);
      } else if (!openExternal(info.url)) {
        flash(btn, t.openFailed, "ra-error");
      }
    } catch {
      flash(btn, t.openFailed, "ra-error");
    }
  }

  root.addEventListener("click", (ev) => {
    const target = ev.target;
    if (!target || typeof target.closest !== "function") return;
    const btn = target.closest(".ra-btn");
    if (!btn || !root.contains(btn)) return;
    ev.preventDefault();
    if (typeof ev.stopPropagation === "function") ev.stopPropagation();
    const action = result.actions.find((a) => String(a.id) === btn.dataset.raAction);
    if (!action) return;
    if (isNetworkAction(action)) void handleOpen(btn, action);
    else void handleCopy(btn, action);
  });

  root.append(kindChip);
  if (hint) root.append(hostChip);
  for (const action of result.actions) {
    const btn = makeButton(action);
    buttons.push(btn);
    root.append(btn);
  }
  host.appendChild(root);

  const dispose = () => {
    for (const timer of pendingTimers.values()) clearTimeout(timer);
    for (const timer of flashTimers.values()) clearTimeout(timer);
    pendingTimers.clear();
    flashTimers.clear();
    root.remove();
  };

  return { root, element: root, result, actions: result.actions, dispose };
}

export const render = renderResultActions;

export default { renderResultActions, render };
