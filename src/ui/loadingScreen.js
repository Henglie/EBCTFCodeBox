// loadingScreen.js — 启动加载屏（盖白屏 + 进度 + 当前加载项）。
// 独立模块，自带轻量 el/msym，经 window.__ebctfT 取 i18n，不反向 import main.js。
// 范式仿 envPanel.js / recipeView.js：样式走 JS 注入幂等 <style>，复用 theme.css 令牌。
//
// 关键约束：本组件在 DOMContentLoaded 尽早调用，此刻字库子集 / Material Symbols 图标字体
// 尚未加载，故加载屏「不依赖图标字体」——品牌与文案用纯文字，进度条纯 CSS。
// theme.css 是同步 <link>，body 首绘时令牌已就绪；仍对关键色给 var(..., 兜底) 防万一。
//
// 零外发红线：本组件不发任何网络请求。

// ---- 轻量 DOM 工具（与 envPanel.js / recipeView.js 同形，本模块自持，零耦合）----
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}
// msym 保留以对齐范式（加载屏本身不用图标字体，避免字库未就绪时显示乱码）。
function msym(name, cls = "") {
  return el("span", { class: "msym" + (cls ? " " + cls : "") }, name);
}

// ---- i18n：优先 window 主表（main.js 暴露 __ebctfT），回退内置中文字典 ----
const _ZH = {
  "ui.loading.title": "恒烈CTF编码工具箱",
  "ui.loading.core": "加载核心模块",
  "ui.loading.fonts": "加载字库",
  "ui.loading.ui": "初始化界面",
  "ui.loading.ready": "就绪",
};
function t(key, ...a) {
  try {
    if (typeof window !== "undefined" && window.__ebctfT) {
      const v = window.__ebctfT(key, ...a);
      if (v && v !== key) return v;
    }
  } catch { /* 回退 */ }
  let s = _ZH[key] || key;
  for (let i = 0; i < a.length; i++) s = s.replace("{" + i + "}", String(a[i]));
  return s;
}

// ---- 幂等样式注入 ----
const STYLE_ID = "loading-screen-style";
function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const css = `
.load-screen {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--sp-5, 24px);
  background: var(--bg, #1b1614);
  color: var(--on-surface, #f1e0d9);
  font-family: var(--font, "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif);
  opacity: 1;
  transition: opacity var(--dur-medium, 175ms) var(--ease-in, cubic-bezier(.3,0,1,1));
}
.load-screen.load-closing { opacity: 0; }

.load-brand {
  font-size: var(--fs-2xl, 32px);
  font-weight: 600;
  letter-spacing: .5px;
  color: var(--primary, #f0b3a7);
  text-align: center;
  padding: 0 var(--sp-4, 16px);
}

.load-bar-wrap {
  width: min(320px, 70vw);
  display: flex;
  flex-direction: column;
  gap: var(--sp-2, 8px);
}
.load-bar-track {
  width: 100%;
  height: 6px;
  border-radius: var(--r-full, 999px);
  background: var(--surface-3, #362e2b);
  overflow: hidden;
}
.load-bar-fill {
  height: 100%;
  width: 0%;
  border-radius: var(--r-full, 999px);
  background: var(--primary, #f0b3a7);
  transition: width var(--dur-medium, 175ms) var(--ease-out, cubic-bezier(0,0,0,1));
}
.load-meta {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: var(--fs-sm, 14px);
  color: var(--on-surface-var, #bfb0aa);
}
.load-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.load-pct { font-variant-numeric: tabular-nums; margin-left: var(--sp-3, 12px); flex: 0 0 auto; }

@media (prefers-reduced-motion: reduce) {
  .load-screen, .load-bar-fill { transition: none; }
}
`;
  document.head.append(el("style", { id: STYLE_ID }, css));
}

// ---- 遮罩状态 ----
let _screen = null;   // 遮罩根节点
let _fill = null;     // 进度条填充
let _label = null;    // 当前加载项文字
let _pct = null;      // 百分比文字
let _removeTimer = 0;

/** 立即在 body 铺全屏加载遮罩（盖白屏）。DOMContentLoaded 尽早调用。 */
export function showLoadingScreen() {
  if (_screen) return _screen;
  injectStyle();
  _fill = el("div", { class: "load-bar-fill" });
  _label = el("span", { class: "load-label" }, t("ui.loading.core"));
  _pct = el("span", { class: "load-pct" }, "0%");
  _screen = el("div", { class: "load-screen", role: "status", "aria-live": "polite" },
    el("div", { class: "load-brand" }, t("ui.loading.title")),
    el("div", { class: "load-bar-wrap" },
      el("div", { class: "load-bar-track" }, _fill),
      el("div", { class: "load-meta" }, _label, _pct),
    ),
  );
  document.body.append(_screen);
  return _screen;
}

/** 更新进度 pct(0-100) + 当前加载项文案（可传 i18n key 或已译文案）。 */
export function setLoadingProgress(pct, label) {
  if (!_screen) return;
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  if (_fill) _fill.style.width = p + "%";
  if (_pct) _pct.textContent = Math.round(p) + "%";
  if (label != null && _label) {
 // 传入形如 "ui.loading.xxx" 的 key 则走 i18n，否则原样显示
    const txt = /^ui\.loading\./.test(label) ? t(label) : String(label);
    _label.textContent = txt;
  }
}

/** 淡出并移除遮罩（opacity 过渡 + 定时移除，仿 envPanel exp-closing 175ms）。 */
export function hideLoadingScreen() {
  if (!_screen) return;
  const scr = _screen;
  scr.classList.add("load-closing");
  if (_removeTimer) clearTimeout(_removeTimer);
  _removeTimer = setTimeout(() => {
    if (scr && scr.parentNode) scr.remove();
    if (scr === _screen) { _screen = null; _fill = null; _label = null; _pct = null; }
    _removeTimer = 0;
  }, 200);  // 略高于 --dur-medium(175ms)，等过渡跑完再摘
}
