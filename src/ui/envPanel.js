// envPanel.js — 环境管理面板（顶栏下拉，懒检测本机环境 + 字库状态）。
// 独立模块，自带轻量 el/msym，经 window.__ebctfT 取 i18n，不反向 import main.js。
// 范式仿 recipeView.js / 现有 toggleFontPanel（main.js 第 1105-1157 行）。
//
// 功能：
// - 点开才检测（懒检测，非启动时）：先判运行形态（纯静态→服务端模式；本地有 bridge→探本机工具）
// - 本地模式：fetch bridge /api/env 拿 Python/Node/Java/7z 版本 + 系统信息
// - 服务端模式：仅显示浏览器信息 + 提示运行 bridge.py 可启用本机检测
// - 面板顶部明确声明「以下信息仅本地显示、绝不外发」
// - 字库项：显示天珩子集/全量加载状态（复用 fontLoader.js），把预载入口并进面板
//
// 零外发红线：bridge 只在 localhost 起、只跑白名单版本参数、不联网、不上传任何信息。
// 系统信息仅本地显示，前端不存储不外发。

import {
  FONT_PLANES,
  allFontStatus,
  loadFontPlane,
  onFontStatusChange,
  humanSize,
} from "./fontLoader.js";
// 动态取色：预设 + 默认 + 回退函数。ui 层平级 import；选色/清除走 window.__ebctfSetAccent / __ebctfClearAccent（main.js 暴露），不反向 import main.js。
import { ACCENT_PRESETS, DEFAULT_ACCENT, resetAccent } from "./dynamicColor.js";
import { icon as iconSvg } from "./icons.js";  // .msym 无字体 ligature，须 icon() 注入内联 SVG

const ACCENT_KEY = "ebctf.accent";  // 与 main.js 一致，仅读取判当前选中态

// ---- 轻量 DOM 工具（与 recipeView.js 同形，本模块自持，零耦合）----
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
function msym(name, cls = "") {
  const s = el("span", { class: "msym" + (cls ? " " + cls : "") });
  s.innerHTML = iconSvg(name);   // 注入内联 SVG（.msym 无字体 ligature，须 icon() 注水）
  return s;
}

// ---- i18n：优先 window 主表（main.js 暴露 __ebctfT），回退内置中文字典 ----
const _ZH = {
  "ui.env.title": "环境管理",
  "ui.env.privacyNote": "以下信息仅本地显示、绝不外发",
  "ui.env.refresh": "重新检测",
  "ui.env.modeLocal": "本地模式（bridge 已连接）",
  "ui.env.modeServer": "服务端模式（bridge 不可用）",
  "ui.env.modeServerNote": "本机环境检测不可用，仅显示浏览器信息。如需检测本机 Python / Node / Java / 7-Zip，请运行 bridge.py。",
  "ui.env.system": "系统",
  "ui.env.browser": "浏览器",
  "ui.env.tools": "本机工具",
  "ui.env.toolName.python": "Python",
  "ui.env.toolName.node": "Node.js",
  "ui.env.toolName.java": "Java",
  "ui.env.toolName.7z": "7-Zip",
  "ui.env.installed": "已安装",
  "ui.env.notInstalled": "未安装",
  "ui.env.fonts": "天珩字库",
  "ui.env.fontSubset": "首屏子集",
  "ui.env.fontSubsetNote": "已加载（秒开，覆盖 CTF 常用字 + GB2312）",
  "ui.env.fontAll": "全量平面",
  "ui.env.fontLoaded": "已加载",
  "ui.env.fontLoading": "加载中…",
  "ui.env.fontIdle": "未加载",
  "ui.env.fontError": "加载失败",
  "ui.env.fontRetry": "重试",
  "ui.env.fontLoad": "加载",
  "ui.env.detecting": "检测中…",
  "ui.env.detectFailed": "检测失败（bridge 未响应）",
  "ui.env.platform": "平台",
  "ui.env.detectBtn": "检测环境",
  "ui.env.close": "关闭",
  "ui.env.accent": "强调色",
  "ui.env.accentNote": "运行时从种子色生成整套配色，纯本地计算不外发",
  "ui.env.accentCustom": "自定义",
  "ui.env.accentReset": "恢复默认",
  "ui.env.syncAccent": "同步系统色",
  "ui.env.syncAccentTip": "读取 Windows 系统强调色并应用（仅本地版）",
  "ui.env.syncAccentOk": "已同步系统强调色",
  "ui.env.syncAccentFail": "系统强调色不可用",
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

// ---- bridge 探测 ----
// bridge.py 默认端口 8181，CORS 放行 localhost:8180（前端端口）。
// 仅试默认端口；被占用递增的场景后续可扩展多端口探测。
const BRIDGE_BASE = "http://localhost:8181";
const HEALTH_TIMEOUT = 1500;  // health 探测超时（短，防阻塞面板）

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    return r;
  } finally {
    clearTimeout(id);
  }
}

/** 探测 bridge 连通性 + 本机环境。返回 {mode:"local", env} 或 {mode:"server", error}。 */
async function detectEnvironment() {
  try {
    const h = await fetchWithTimeout(BRIDGE_BASE + "/api/health", HEALTH_TIMEOUT);
    if (!h.ok) return { mode: "server", error: "health " + h.status };
    const hj = await h.json();
    if (!hj.ok) return { mode: "server", error: "health not ok" };
 // bridge 在线 → 拉 /api/env（含本机工具版本）
    const e = await fetchWithTimeout(BRIDGE_BASE + "/api/env", 8000);
    if (!e.ok) return { mode: "local", env: { platform: hj.platform, win: hj.win, tools: {} }, envError: "env " + e.status };
    const ej = await e.json();
    return { mode: "local", env: ej };
  } catch {
    return { mode: "server" };
  }
}

// ---- 面板状态 ----
let _panel = null;
let _offFont = null;       // fontLoader 订阅取消函数
let _detecting = false;

/** 顶栏按钮触发：打开/切换下拉面板。anchor = 触发按钮元素（用于定位）。 */
export function openEnvPanel(anchor) {
  if (_panel) { closeEnvPanel(); return; }
  _panel = el("div", { class: "env-panel" });
  document.body.append(_panel);
  positionPanel(anchor);
 // 首次渲染：检测中态 + 字库区
  _panel.append(renderPanelContent({ mode: "detecting" }));
 // 字库状态订阅（加载平面后实时刷新）
  _offFont = onFontStatusChange(() => {
    if (_panel) rerenderFonts();
  });
 // 触发懒检测
  runDetect();
 // 点面板外关闭
  setTimeout(() => {
    const onDoc = (ev) => {
      if (_panel && !_panel.contains(ev.target) && ev.target !== anchor && !anchor.contains(ev.target)) {
        closeEnvPanel();
        document.removeEventListener("click", onDoc);
      }
    };
    document.addEventListener("click", onDoc);
  }, 0);
}

/** 关闭面板。 */
export function closeEnvPanel() {
  if (_offFont) { _offFont(); _offFont = null; }
  if (_panel) { _panel.remove(); _panel = null; }
  _detecting = false;
}

/** 渲染到任意容器（通用契约，供独立视图接入用）。返回面板根节点。 */
export function renderEnvPanel(container) {
  const host = container || document.getElementById("envHost");
  if (!host) return null;
  host.innerHTML = "";
  const root = el("div", { class: "env-panel env-panel-inline" });
  root.append(renderPanelContent({ mode: "detecting" }));
  host.append(root);
  _offFont = onFontStatusChange(() => {
    const fontsBox = root.querySelector(".env-fonts-box");
    if (fontsBox) rerenderFonts(fontsBox);
  });
  runDetect(root);
  return root;
}

// 定位下拉面板到按钮下方右对齐
function positionPanel(anchor) {
  if (!_panel || !anchor) return;
  const r = anchor.getBoundingClientRect();
  _panel.style.top = (r.bottom + 6) + "px";
  _panel.style.right = (window.innerWidth - r.right) + "px";
}

// 触发懒检测（面板已打开）
async function runDetect(root) {
  if (_detecting) return;
  _detecting = true;
  const target = root || _panel;
  if (!target) { _detecting = false; return; }
  const result = await detectEnvironment();
  _detecting = false;
  if (!target || !target.isConnected) return;  // 面板已关
 // 替换检测区（保留字库区不重渲染）
  const detectBox = target.querySelector(".env-detect-box");
  if (detectBox) {
    detectBox.innerHTML = "";
    detectBox.append(renderDetectContent(result));
  }
}

// ---- 面板内容拼装 ----
function renderPanelContent(state) {
  const wrap = el("div", { class: "env-panel-inner" });
 // 头：标题 + 隐私声明 + 刷新按钮
  wrap.append(
    el("div", { class: "env-panel-head" },
      el("div", { class: "env-panel-title" }, msym("computer"), t("ui.env.title")),
      el("button", { class: "env-refresh-btn", title: t("ui.env.refresh"), onclick: () => runDetect() }, msym("refresh")),
    ),
    el("div", { class: "env-privacy-note" }, msym("lock"), t("ui.env.privacyNote")),
  );
 // 检测区
  const detectBox = el("div", { class: "env-detect-box" });
  detectBox.append(renderDetectContent(state));
  wrap.append(detectBox);
 // 字库区
  wrap.append(renderFontsSection());
 // 昼夜切换区（与强调色同属「外观」，放一起）
  wrap.append(renderThemeSection());
 // 强调色区（动态取色）
  wrap.append(renderAccentSection());
  return wrap;
}

// 检测区内容（系统/浏览器/本机工具）
function renderDetectContent(state) {
  const box = el("div", { class: "env-detect-content" });
  if (state.mode === "detecting") {
    box.append(el("div", { class: "env-detecting" }, msym("sync", "spin"), t("ui.env.detecting")));
    return box;
  }
  if (state.mode === "server") {
    box.append(
      el("div", { class: "env-mode-tag server" }, msym("cloud_off"), t("ui.env.modeServer")),
      el("div", { class: "env-mode-note" }, t("ui.env.modeServerNote")),
    );
  } else if (state.mode === "local") {
    box.append(el("div", { class: "env-mode-tag local" }, msym("dns"), t("ui.env.modeLocal")));
  }
 // 浏览器信息（任何模式都显示）
  box.append(renderBrowserSection());
 // 本机工具（仅本地模式）
  if (state.mode === "local" && state.env) {
    box.append(renderSystemSection(state.env));
    box.append(renderToolsSection(state.env.tools || {}));
    if (state.envError) {
      box.append(el("div", { class: "env-error" }, msym("warning"), state.envError));
    }
  }
  return box;
}

// 浏览器信息（navigator，任何模式都有）
function renderBrowserSection() {
  const ua = (typeof navigator !== "undefined" && navigator.userAgent) ? navigator.userAgent : "unknown";
  const lang = (typeof navigator !== "undefined" && navigator.language) ? navigator.language : "unknown";
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : "?";
  const sec = el("div", { class: "env-section" });
  sec.append(el("div", { class: "env-section-title" }, msym("web"), t("ui.env.browser")));
  sec.append(envRow("UA", ua));
  sec.append(envRow(t("ui.env.platform") + " / Lang", lang + " · " + cores + " cores"));
  return sec;
}

// 系统信息（本地模式，来自 bridge /api/env）
function renderSystemSection(env) {
  const sec = el("div", { class: "env-section" });
  sec.append(el("div", { class: "env-section-title" }, msym("devices"), t("ui.env.system")));
  const plat = env.platform || "?" ;
  const rel = env.release || "?";
  const mach = env.machine || "?";
  sec.append(envRow(t("ui.env.platform"), plat + " " + rel + " (" + mach + ")"));
  if (env.win) sec.append(envRow("bridge", "127.0.0.1:8181 ", msym("check_circle", "--success")));
  return sec;
}

// 本机工具版本（本地模式，来自 bridge /api/env tools）
function renderToolsSection(tools) {
  const sec = el("div", { class: "env-section" });
  sec.append(el("div", { class: "env-section-title" }, msym("build"), t("ui.env.tools")));
  const order = ["python", "node", "java", "7z"];
  for (const key of order) {
    const info = tools[key];
    if (!info) {
      sec.append(toolRow(key, { ok: false, error: "未检测" }));
      continue;
    }
    sec.append(toolRow(key, info));
  }
  return sec;
}

function toolRow(key, info) {
  const name = t("ui.env.toolName." + key);
  const row = el("div", { class: "env-tool-row" + (info.ok ? " ok" : " miss") });
  row.append(el("span", { class: "env-tool-name" }, name));
  if (info.ok) {
    row.append(
      el("span", { class: "env-tool-version" }, info.version || ""),
      el("span", { class: "env-tool-tag ok" }, t("ui.env.installed")),
    );
  } else {
    row.append(
      el("span", { class: "env-tool-version err" }, info.error || ""),
      el("span", { class: "env-tool-tag miss" }, t("ui.env.notInstalled")),
    );
  }
  return row;
}

// 字库区（复用 fontLoader，首屏子集 + 全量 4 平面）
function renderFontsSection() {
  const sec = el("div", { class: "env-section env-fonts-box" });
  sec.append(el("div", { class: "env-section-title" }, msym("font_download"), t("ui.env.fonts")));
 // 首屏子集（fonts.css 挂载，默认已加载）
  sec.append(el("div", { class: "env-font-row subset" },
    el("div", { class: "env-font-info" },
      el("div", { class: "env-font-label" }, t("ui.env.fontSubset"),
        el("span", { class: "env-font-size" }, "1.5 MB")),
      el("div", { class: "env-font-desc" }, t("ui.env.fontSubsetNote")),
    ),
    el("span", { class: "env-font-tag loaded" }, t("ui.env.fontLoaded")),
  ));
 // 全量 4 平面
  for (const p of allFontStatus()) {
    sec.append(renderFontPlaneRow(p));
  }
  return sec;
}

function renderFontPlaneRow(p) {
  const row = el("div", { class: "env-font-row" });
  const isZh = !(typeof window !== "undefined" && window.__ebctfT && window.__ebctfT("ui.env.title") !== "ui.env.title" && window.__ebctfT("ui.env.title") === "Environment");
  const label = isZh ? p.label : p.labelEn;
  const desc = isZh ? p.desc : p.descEn;
  const st = p.status;
  const btn = el("button",
    { class: "env-font-btn" + (st === "loaded" ? " loaded" : "") + (st === "error" ? " error" : ""),
      disabled: st === "loaded" || st === "loading" },
    st === "loaded" ? t("ui.env.fontLoaded")
      : st === "loading" ? t("ui.env.fontLoading")
      : st === "error" ? t("ui.env.fontRetry")
      : t("ui.env.fontLoad"));
  btn.addEventListener("click", () => { loadFontPlane(p.id); });
  row.append(
    el("div", { class: "env-font-info" },
      el("div", { class: "env-font-label" }, label,
        el("span", { class: "env-font-size" }, humanSize(p.bytes))),
      el("div", { class: "env-font-desc" }, desc),
    ),
    btn,
  );
  return row;
}

// 字库区局部重渲染（fontLoader 状态变化时）
function rerenderFonts(fontsBox) {
  const box = fontsBox || (_panel && _panel.querySelector(".env-fonts-box"));
  if (!box) return;
  const title = box.querySelector(".env-section-title");
  box.innerHTML = "";
  if (title) box.append(title);
  box.append(el("div", { class: "env-font-row subset" },
    el("div", { class: "env-font-info" },
      el("div", { class: "env-font-label" }, t("ui.env.fontSubset"),
        el("span", { class: "env-font-size" }, "1.5 MB")),
      el("div", { class: "env-font-desc" }, t("ui.env.fontSubsetNote")),
    ),
    el("span", { class: "env-font-tag loaded" }, t("ui.env.fontLoaded")),
  ));
  for (const p of allFontStatus()) box.append(renderFontPlaneRow(p));
}

// ---- 强调色区（动态取色）----
// 预设色板 + 自定义选色器 + 恢复默认。桥走 window.__ebctfSetAccent / __ebctfClearAccent
// 回退清覆盖走本模块平级 import 的 resetAccent。选中态读 localStorage(ACCENT_KEY)。
function currentAccentSeed() {
  try { return localStorage.getItem(ACCENT_KEY); } catch { return null; }  // 隐私模式忽略
}
// 归一化 hex 供选中态比对（小写，#rgb → #rrggbb）
function normHex(v) {
  if (!v) return null;
  let h = String(v).trim().toLowerCase().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6 || /[^0-9a-f]/.test(h)) return null;
  return "#" + h;
}

// 昼夜切换区（放强调色区前，同属「外观」调整）。复用 main.js 暴露的 window 钩子，
// 不反向 import。三态按钮（跟随系统/浅色/深色），当前偏好高亮；点击即切 + 持久化（main.js 内处理）。
// 默认「跟随系统」（恒烈需求4）。
function renderThemeSection() {
  const sec = el("div", { class: "env-section env-theme-box" });
  sec.append(el("div", { class: "env-section-title" }, msym("dark_mode"), t("ui.env.theme")));
  const cur = (typeof window.__ebctfGetThemePref === "function") ? window.__ebctfGetThemePref() : "system";
  const group = el("div", { class: "env-theme-toggle" });
  const mk = (pref, iconName, labelKey) => {
    const btn = el("button", {
      class: "env-theme-btn" + (cur === pref ? " selected" : ""),
      title: t(labelKey),
      "aria-label": t(labelKey),
    }, msym(iconName), el("span", {}, t(labelKey)));
    btn.addEventListener("click", () => {
      try { window.__ebctfSetThemePref(pref); } catch { /* 钩子缺失忽略 */ }
      group.querySelectorAll(".env-theme-btn").forEach((b) => b.classList.remove("selected"));
      btn.classList.add("selected");
    });
    return btn;
  };
  group.append(mk("system", "computer", "ui.env.themeSystem"));
  group.append(mk("light", "light_mode", "ui.env.themeLight"));
  group.append(mk("dark", "dark_mode", "ui.env.themeDark"));
  sec.append(group);
  return sec;
}

function renderAccentSection() {
  const sec = el("div", { class: "env-section env-accent-box" });
  sec.append(el("div", { class: "env-section-title" }, msym("palette"), t("ui.env.accent")));
  sec.append(el("div", { class: "env-accent-note" }, t("ui.env.accentNote")));

  const saved = normHex(currentAccentSeed());
  const presetSeeds = ACCENT_PRESETS.map((p) => normHex(p.seed));
 // 存了色但不匹配任何预设 → 视为自定义选中
  const isCustom = !!saved && !presetSeeds.includes(saved);

 // ① 预设色板按钮组
  const swatches = el("div", { class: "env-accent-swatches" });
  for (const p of ACCENT_PRESETS) {
    const seedNorm = normHex(p.seed);
 // 未设过时高亮默认项（DEFAULT_ACCENT），设过则按 saved 匹配
    const selected = saved ? seedNorm === saved : p.seed === DEFAULT_ACCENT.seed;
    const btn = el("button", {
      class: "env-accent-swatch" + (selected ? " selected" : ""),
      style: "background:" + p.seed,
      title: p.label,
      "aria-label": p.label,
    });
    btn.addEventListener("click", () => {
      try { window.__ebctfSetAccent(p.seed); } catch { /* 桥缺失忽略 */ }
      markSelected(swatches, btn, colorInput, false);
    });
    swatches.append(btn);
  }
  sec.append(swatches);

 // ② 自定义选色器
  const colorInput = el("input", {
    type: "color",
    class: "env-accent-custom" + (isCustom ? " selected" : ""),
    value: isCustom ? saved : DEFAULT_ACCENT.seed,
    title: t("ui.env.accentCustom"),
    "aria-label": t("ui.env.accentCustom"),
  });
  colorInput.addEventListener("input", (e) => {
    try { window.__ebctfSetAccent(e.target.value); } catch { /* 忽略 */ }
    markSelected(swatches, null, colorInput, true);
  });
  const customWrap = el("label", { class: "env-accent-custom-wrap" },
    msym("colorize"), t("ui.env.accentCustom"), colorInput);
  sec.append(customWrap);

 // ③ 恢复默认
  const resetBtn = el("button", { class: "env-accent-reset" }, msym("restart_alt"), t("ui.env.accentReset"));
  resetBtn.addEventListener("click", () => {
    try { resetAccent(); } catch { /* 忽略 */ }              // 即时清内联覆盖回退 theme.css
    try { window.__ebctfClearAccent(); } catch { /* 忽略 */ } // 清持久化
 // 选中态回到默认预设
    const btns = swatches.querySelectorAll(".env-accent-swatch");
    btns.forEach((b) => b.classList.remove("selected"));
    const defBtn = btns[0];
    if (defBtn) defBtn.classList.add("selected");
    colorInput.classList.remove("selected");
    colorInput.value = DEFAULT_ACCENT.seed;
  });
  sec.append(resetBtn);

 // ④ 同步系统色（仅本地版）。读 Windows 注册表 AccentColor 并应用为选择。
 // 桥走 window.__ebctfSyncAccent（main.js 暴露，返 {ok, accent}）。
 // 形态探测复用 window.__ebctfRuntime（"local" | "server" | null）：非本地版禁用按钮。
  const isLocal = (typeof window !== "undefined" && window.__ebctfRuntime === "local");
  const syncBtn = el("button", {
    class: "env-accent-sync",
    title: t("ui.env.syncAccentTip"),
    disabled: !isLocal ? "" : null,
  }, msym("sync"), t("ui.env.syncAccent"));
  syncBtn.addEventListener("click", async () => {
    if (syncBtn.disabled) return;
    let r = { ok: false };
    try { r = await window.__ebctfSyncAccent(); } catch { r = { ok: false }; }
    if (r && r.ok && r.accent) {
 // 同步成功：更新选中态（系统色多为自定义，按预设匹配落点）
      const seedNorm = normHex(r.accent);
      const btns = swatches.querySelectorAll(".env-accent-swatch");
      let matched = null;
      btns.forEach((b, i) => {
        const on = normHex(ACCENT_PRESETS[i] && ACCENT_PRESETS[i].seed) === seedNorm;
        b.classList.toggle("selected", on);
        if (on) matched = b;
      });
      colorInput.classList.toggle("selected", !matched);
      if (!matched && seedNorm) colorInput.value = seedNorm;
      try { window.__ebctfToast && window.__ebctfToast(t("ui.env.syncAccentOk")); } catch { /* 忽略 */ }
    } else {
      try { window.__ebctfToast && window.__ebctfToast(t("ui.env.syncAccentFail")); } catch { /* 忽略 */ }
    }
  });
  sec.append(syncBtn);

  return sec;
}

// 更新选中高亮：selBtn 为选中的色板按钮（自定义则 null 并 customOn=true）
function markSelected(swatches, selBtn, colorInput, customOn) {
  swatches.querySelectorAll(".env-accent-swatch").forEach((b) => {
    b.classList.toggle("selected", b === selBtn);
  });
  if (colorInput) colorInput.classList.toggle("selected", !!customOn);
}

// ---- 通用行 ----
// 签名放宽为 ...vals，支持 val 位混排字符串与 msym DOM 元素（el 的 children.flat 已兼容）。
function envRow(label, ...vals) {
  return el("div", { class: "env-row" },
    el("span", { class: "env-row-label" }, label),
    el("span", { class: "env-row-val" }, ...vals),
  );
}
