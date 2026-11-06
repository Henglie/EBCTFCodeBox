/*
 * mobileDrawer.js — ≤860px 左侧导航抽屉（汉堡开合 + 遮罩 + 焦点管理）。
 *
 * 设计：
 * 1. 桌面 >860px 完全不介入：汉堡/遮罩仅由 CSS 在窄屏显示，导航保持原 rail/折叠行为。
 * 2. 窄屏侧栏不再自动收成 60px rail。main.js 的 navRail() 需在窄屏返回 false（接线补丁见
 *    资料/工程留存/UI-移动抽屉/），由 renderNav 正常渲染分类名/计数/二级算法名。
 * 3. 本模块自行注入汉堡按钮与遮罩，避免改 index.html；开合状态只加/删 class，不重建导航。
 * 4. 关闭时机：汉堡、遮罩、Esc、点击二级算法/置顶入口、hashchange、切回桌面宽度、main.js 调 close。
 * 5. 可访问性：role=dialog + aria-modal + aria-expanded + 焦点移入/循环/归还。
 * 6. 动效走 topbar-responsive.css 第 4 节（200ms 直滑，不弹跳；reduce-motion 直切）。
 *    无第三方依赖、零外发、无 emoji。
 */

import { icon } from "./icons.js";
import { t, onLocaleChange } from "../i18n/index.js";

export const MOBILE_NAV_BP = 860;

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

let nav = null;
let topbar = null;
let toggle = null;
let mask = null;
let mql = null;
let observer = null;
let initialized = false;
let open = false;
let lastFocus = null;

function isMobileWidth() {
  return window.innerWidth <= MOBILE_NAV_BP;
}

export function isMobileDrawerMode() {
  return isMobileWidth();
}

export function isMobileDrawerOpen() {
  return open;
}

function toggleLabel() {
  return t("ui.nav.expand");
}

function syncToggleLabel() {
  if (!toggle) return;
  const label = toggleLabel();
  toggle.title = label;
  toggle.setAttribute("aria-label", label);
}

// main.js 的 applyStaticI18n() 在启动语言包懒加载完成 / 手动切换语言后调用，
// 补上首屏非 zh 时汉堡 title/aria 的同步（模块自身 onLocaleChange 只能覆盖手动切换）。
export function refreshMobileDrawerLabels() {
  if (!initialized) return;
  syncToggleLabel();
  if (open && nav) nav.setAttribute("aria-label", dialogLabel());
}

function dialogLabel() {
  const brand = document.getElementById("brandTitle");
  const text = brand && brand.textContent ? brand.textContent.trim() : "";
  return text || toggleLabel();
}

function focusableNodes() {
  if (!nav) return [];
  return Array.from(nav.querySelectorAll(FOCUSABLE)).filter((node) => {
    if (node.hidden || node.getAttribute("aria-hidden") === "true") return false;
    return node.getClientRects().length > 0;
  });
}

function focusInitial() {
  if (!nav) return;
  const target = nav.querySelector(".nav-item.on")
    || nav.querySelector(".nav-item")
    || nav;
  target.focus({ preventScroll: true });
}

export function openMobileDrawer(options = {}) {
  if (!initialized || open || !isMobileWidth()) return;
  open = true;
  const trigger = options.trigger;
  lastFocus = trigger && trigger.focus ? trigger : (document.activeElement || toggle);
  nav.inert = false;
  document.body.classList.add("nav-drawer-open");
  nav.classList.add("drawer-open");
  mask.classList.add("show");
  toggle.setAttribute("aria-expanded", "true");
  nav.setAttribute("role", "dialog");
  nav.setAttribute("aria-modal", "true");
  nav.setAttribute("aria-label", dialogLabel());
  requestAnimationFrame(focusInitial);
}

export function closeMobileDrawer(options = {}) {
  if (!initialized || !open) return;
  open = false;
  nav.classList.remove("drawer-open");
  mask.classList.remove("show");
  if (isMobileWidth()) nav.inert = true;
  document.body.classList.remove("nav-drawer-open");
  toggle.setAttribute("aria-expanded", "false");
  nav.removeAttribute("role");
  nav.removeAttribute("aria-modal");
  nav.removeAttribute("aria-label");
  if (options.restoreFocus !== false) {
    const target = lastFocus && lastFocus.isConnected && lastFocus !== document.body
      ? lastFocus
      : toggle;
    target.focus({ preventScroll: true });
  }
  lastFocus = null;
}

export function toggleMobileDrawer() {
  if (open) closeMobileDrawer();
  else openMobileDrawer({ trigger: toggle });
}

function onToggleClick() {
  toggleMobileDrawer();
}

function onMaskClick() {
  closeMobileDrawer();
}

function onKeydown(event) {
  if (!open) return;
  if (event.key === "Escape" || event.key === "Esc") {
    event.preventDefault();
    event.stopPropagation();
    closeMobileDrawer();
    return;
  }
  if (event.key !== "Tab") return;
  const nodes = focusableNodes();
  if (!nodes.length) {
    event.preventDefault();
    nav.focus({ preventScroll: true });
    return;
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  const active = document.activeElement;
  if (!nav.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

// 点二级算法/置顶入口后关抽屉；分类与收藏组是展开开关，保持抽屉打开由 main.js 渲染二级。
function onNavClick(event) {
  if (!open) return;
  const item = event.target.closest(".nav-item, .nav-subitem");
  if (!item || !nav.contains(item)) return;
  if (item.classList.contains("nav-item")) {
    if (item.classList.contains("nav-fav")) return;
    if (item.querySelector(".nav-caret")) return;
  }
  closeMobileDrawer();
}

function onHashChange() {
  if (!open) return;
  closeMobileDrawer({ restoreFocus: false });
}

function onViewportChange() {
  if (mql && !mql.matches && open) closeMobileDrawer({ restoreFocus: false });
  if (mql && !mql.matches) nav.inert = false;
}

// main.js 的 renderNav 会重建整个导航：抽屉仍开且焦点掉到 body 时，把焦点送回抽屉。
function onNavMutated() {
  if (!open) return;
  if (nav.contains(document.activeElement)) return;
  const target = nav.querySelector(".nav-item.on")
    || nav.querySelector(".nav-item.expanded")
    || nav.querySelector(".nav-item")
    || nav;
  target.focus({ preventScroll: true });
}

export function initMobileDrawer(options = {}) {
  if (initialized) return;
  const navEl = options.nav || document.getElementById("sidenav");
  const topbarEl = options.topbar || document.querySelector(".topbar");
  if (!navEl || !topbarEl || !document.body) return;

  nav = navEl;
  topbar = topbarEl;

  toggle = document.createElement("button");
  toggle.type = "button";
  toggle.id = "btnNavDrawer";
  toggle.className = "icon-btn nav-drawer-toggle";
  toggle.setAttribute("aria-controls", "sidenav");
  toggle.setAttribute("aria-expanded", "false");
  const glyph = document.createElement("span");
  glyph.className = "msym";
  glyph.setAttribute("aria-hidden", "true");
  glyph.innerHTML = icon("density_medium");
  toggle.append(glyph);
  topbar.insertBefore(toggle, topbar.firstChild);
  syncToggleLabel();

  mask = document.createElement("div");
  mask.id = "navDrawerMask";
  mask.className = "nav-drawer-mask";
  mask.setAttribute("aria-hidden", "true");
  document.body.append(mask);

  if (!nav.hasAttribute("tabindex")) nav.setAttribute("tabindex", "-1");

  toggle.addEventListener("click", onToggleClick);
  mask.addEventListener("click", onMaskClick);
  document.addEventListener("keydown", onKeydown, true);
  nav.addEventListener("click", onNavClick, true);
  window.addEventListener("hashchange", onHashChange);
  onLocaleChange(refreshMobileDrawerLabels);

  mql = window.matchMedia(`(max-width: ${MOBILE_NAV_BP}px)`);
  if (mql.addEventListener) mql.addEventListener("change", onViewportChange);
  else if (mql.addListener) mql.addListener(onViewportChange);

  observer = new MutationObserver(onNavMutated);
  observer.observe(nav, { childList: true });
  if (isMobileWidth()) nav.inert = true;

  initialized = true;
}

// 显式 init 由 main.js 调用；模块被单独导入时也自动接一次，保证汉堡不会因漏接线而缺失。
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => initMobileDrawer(), { once: true });
  } else {
    initMobileDrawer();
  }
}
