/*
 * inputEnhance.js — MT4 输入/输出框显示增强（独立可复用组件）。
 *
 * 两大能力（只做「显示增强」，绝不改用户实际输入值）：
 * ① flag 高亮：把 flag{}/ctf{}/key=/疑似 hash/base64 等关键片段在文本里 <mark> 高亮。
 * 复用 core/flagpatterns.js（findFlags 加权去重），再叠加 base64-flag 指示串
 * （U2FsdGVkX1 / Zmxh / Y3Rm / a2V5 / cGFzc 等，参考首页 keywords3）。
 * ② 不可见 / 零宽字符切换显形 + 检测计数：复用 core/invisibles.js（scan/visualize/countByType）。
 * 一键把不可见字符显形为可见占位符（␣ → · ⟶ 等），并提示检测到几个、什么类型。
 *
 * 组件范式（仿 envPanel.js / expandableInput.js，低耦合零反向依赖）：
 * - 独立文件，样式由本文件 JS 注入 <style>（幂等），不碰 app.css / theme.css / index.html。
 * - 复用 theme.css 令牌（--surface-* / --primary / --r-* / --sp-* / --error / --success 等）。
 * - i18n 走 window.__ebctfT，自带中文回退字典 _ZH；提示走 window.__ebctfToast（可选）。
 * - 图标复用 icons.js（visibility_off / warning / check_circle / tag）。
 * - 绝不 import main.js。
 *
 * 纯逻辑函数（无 DOM，可 node 直测）：
 * highlightFlags(text, opts) → 高亮后的安全 HTML 字符串
 * buildSegments(text, opts) → [{ text, mark, kind, name }] 分段（测 flag 定位）
 * visualizeInvisiblesHTML(text, opts) → { html, count, byType } 显形 HTML + 计数
 * invisibleReport(text) → { count, byType, dangerous } 检测报告
 *
 * DOM 组件（供 M 挂到任意输出区/textarea 旁）：
 * invisibleToggle(container, text, opts) → 切换按钮 + 显示区，返回 { setText, destroy }
 * renderEnhancedView(container, text, opts)→ flag 高亮只读视图 + 不可见字符切换（组合件）
 *
 * 无障碍：高亮不只靠颜色——flag mark 加 ▸ 前缀符号 + 下划线；不可见字符 mark 带 title
 * （Unicode 名称）+ 虚线框，可被读屏 / 悬浮识别。占位符走 CSS ::before，不污染复制文本。
 */

import { findFlags } from "../core/flagpatterns.js";
import { INVISIBLES, TYPE_LABEL, countByType } from "../core/invisibles.js";
import { icon as iconSvg } from "./icons.js";

// ============================================================
// i18n：优先 window.__ebctfT，回退内置中文字典
// ============================================================
const _ZH = {
  "ui.enh.flagHighlight": "flag 高亮",
  "ui.enh.flagFound": "高亮 {0} 处疑似 flag / 关键片段",
  "ui.enh.flagNone": "未发现 flag 候选",
  "ui.enh.showInvisible": "显示不可见字符",
  "ui.enh.hideInvisible": "隐藏不可见字符",
  "ui.enh.invisibleFound": "检测到 {0} 个不可见字符",
  "ui.enh.invisibleNone": "未检测到不可见字符",
  "ui.enh.invisibleDanger": "含 {0} 个可疑不可见字符（零宽 / 双向 / 格式 / BOM）",
  "ui.enh.legendFlag": "疑似 flag",
  "ui.enh.legendInvisible": "不可见字符",
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
function toast(msg) {
  try {
    if (typeof window !== "undefined" && window.__ebctfToast) window.__ebctfToast(msg);
  } catch { /* 静默 */ }
}

// ============================================================
// base64-flag 指示串（参考首页 keywords3 的 base64 段）
// 这些是 flag/ctf/key/pass 等经 base64 编码后的可见前缀，命中即疑似藏 flag。
// kind='b64hint'，置信度低于 flagpatterns，重叠时让位给真 flag 区间。
// ============================================================
const B64_HINTS = [
  { s: "U2FsdGVkX1", name: 'OpenSSL "Salted__" base64 头' },
  { s: "Zmxh",       name: '"fla" base64 前缀' },
  { s: "ZmxhZw",     name: '"flag" base64 前缀' },
  { s: "Y3Rm",       name: '"ctf" base64 前缀' },
  { s: "a2V5",       name: '"key" base64 前缀' },
  { s: "cGFzc",      name: '"pass" base64 前缀' },
];

// patternId → 高亮 kind（决定颜色深浅 / 前缀符号）
const KIND_BY_PATTERN = {
  flag_brace: "flag",
  ctf_brace: "flag",
  prefixed_brace: "flag",
  key_assign: "key",
  md5: "hash",
  sha1: "hash",
  hex_long: "hash",
  base64: "b64",
};

// ---- HTML 转义（防注入，flag/不可见 mark 文本与属性都过一遍） ----
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// ============================================================
// buildSegments — 把文本切成 [{ text, mark, kind, name }] 分段（纯逻辑，可测）
// mark=true 的段是高亮命中；kind 决定样式；name 是悬浮说明。
// flag 区间（findFlags 已加权去重）优先，base64 指示串让位。
// ============================================================
export function buildSegments(text, opts = {}) {
  if (typeof text !== "string" || text.length === 0) return [];
  const minConfidence = opts.minConfidence ?? 0;

 // 1) flag 区间（code-unit 下标，与 String.slice 一致）
  const flagHits = findFlags(text, { minConfidence, dedupe: true }).map((h) => ({
    start: h.start, end: h.end,
    kind: KIND_BY_PATTERN[h.patternId] || "flag",
    name: h.name + "（" + h.desc + "，置信度 " + h.confidence.toFixed(2) + "）",
    prio: h.confidence,
  }));

 // 2) base64 指示串区间（低优先，与 flag 重叠则丢弃）
  const hintHits = [];
  if (opts.b64Hints !== false) {
    for (const h of B64_HINTS) {
      let from = 0, idx;
      while ((idx = text.indexOf(h.s, from)) !== -1) {
        hintHits.push({ start: idx, end: idx + h.s.length, kind: "b64hint", name: h.name, prio: 0.2 });
        from = idx + h.s.length;
      }
    }
  }

 // 3) 贪心去重：按优先级降序，选不重叠区间（等价保留高置信度）
  const all = [...flagHits, ...hintHits].sort(
    (a, b) => b.prio - a.prio || a.start - b.start || a.end - b.end
  );
  const chosen = [];
  const overlap = (a, b) => a.start < b.end && b.start < a.end;
  for (const r of all) {
    if (!chosen.some((c) => overlap(c, r))) chosen.push(r);
  }
  chosen.sort((a, b) => a.start - b.start || a.end - b.end);

 // 4) 按区间切段
  const segs = [];
  let cur = 0;
  for (const r of chosen) {
    if (r.start > cur) segs.push({ text: text.slice(cur, r.start), mark: false });
    segs.push({ text: text.slice(r.start, r.end), mark: true, kind: r.kind, name: r.name });
    cur = r.end;
  }
  if (cur < text.length) segs.push({ text: text.slice(cur), mark: false });
  return segs;
}

// ============================================================
// highlightFlags — 返回 flag 高亮后的安全 HTML 字符串（纯逻辑，可测）
// 命中片段包 <mark class="ienh-flag" data-kind=... title=...>；无障碍靠 CSS ::before 符号。
// ============================================================
export function highlightFlags(text, opts = {}) {
  const segs = buildSegments(text, opts);
  if (segs.length === 0) return "";
  let out = "";
  for (const s of segs) {
    if (s.mark) {
      out += `<mark class="ienh-flag" data-kind="${esc(s.kind)}" title="${esc(s.name)}">${esc(s.text)}</mark>`;
    } else {
      out += esc(s.text);
    }
  }
  return out;
}

// ============================================================
// visualizeInvisiblesHTML — 不可见字符显形 HTML + 计数（纯逻辑，可测）
// showSpace=false 时普通空格/Tab/换行不显形（避免满屏占位符），仅显形可疑不可见。
// 命中处包 <mark class="ienh-inv" title="U+XXXX 名称">占位符</mark>。
// 返回 { html, count, byType }。count = 显形出来的命中数。
// ============================================================
const NORMAL_WS = new Set([0x20, 0x09, 0x0a, 0x0d]);
export function visualizeInvisiblesHTML(text, opts = {}) {
  const showSpace = opts.showSpace ?? false;
  if (typeof text !== "string") return { html: "", count: 0, byType: {} };
  let html = "";
  let count = 0;
  const byType = {};
  for (const ch of text) {                       // 逐 code point 遍历
    const cp = ch.codePointAt(0);
    const info = INVISIBLES[cp];
    if (info && !(!showSpace && NORMAL_WS.has(cp))) {
      const label = "U+" + cp.toString(16).toUpperCase().padStart(4, "0") + " " + info.name
        + "（" + (TYPE_LABEL[info.type] || info.type) + "）";
      html += `<mark class="ienh-inv" data-type="${esc(info.type)}" title="${esc(label)}">${esc(info.glyph)}</mark>`;
      count++;
      byType[info.type] = (byType[info.type] || 0) + 1;
    } else {
      html += esc(ch);
    }
  }
  return { html, count, byType };
}

// ============================================================
// invisibleReport — 检测报告（纯逻辑，可测）
// 返回 { count, byType, dangerous }。dangerous = 零宽/双向/格式/BOM 合计（可疑）。
// ============================================================
const DANGER_TYPES = new Set(["zero-width", "bidi", "format", "bom"]);
export function invisibleReport(text) {
  const byType = countByType(typeof text === "string" ? text : "");
  let count = 0, dangerous = 0;
  for (const [type, n] of Object.entries(byType)) {
    count += n;
    if (DANGER_TYPES.has(type)) dangerous += n;
  }
  return { count, byType, dangerous };
}

// ============================================================
// 样式注入（幂等，复用 theme.css 令牌）
// ============================================================
const STYLE_ID = "ienh-styles";
function ensureStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

// ---- 轻量 DOM 工具（本模块自持，零耦合） ----
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

// ============================================================
// invisibleToggle — 不可见字符显形切换（DOM 组件）
// 在 container 里渲染：切换按钮 + 计数提醒 + 显示区（只读镜像）。
// 返回 { setText(newText), destroy }。opts.showSpace 控制是否连普通空白一起显形。
// ============================================================
export function invisibleToggle(container, text = "", opts = {}) {
  ensureStyles();
  let cur = String(text);
  let shown = false;

  const box = el("div", { class: "ienh-inv-box" });
  const bar = el("div", { class: "ienh-bar" });
  const btn = el("button", {
    type: "button",
    class: "ienh-btn",
    "aria-pressed": "false",
  });
  const status = el("span", { class: "ienh-status" });
  const view = el("div", { class: "ienh-view", "aria-live": "polite" });

  bar.append(btn, status);
  box.append(bar, view);
  container.append(box);

  function refresh() {
    const rep = invisibleReport(cur);
 // 计数提醒
    if (rep.count === 0) {
      status.className = "ienh-status ok";
      status.innerHTML = iconSvg("check_circle") + "<span>" + esc(t("ui.enh.invisibleNone")) + "</span>";
    } else if (rep.dangerous > 0) {
      status.className = "ienh-status danger";
      status.innerHTML = iconSvg("warning") + "<span>" + esc(t("ui.enh.invisibleDanger", rep.dangerous)) + "</span>";
    } else {
      status.className = "ienh-status found";
      status.innerHTML = iconSvg("warning") + "<span>" + esc(t("ui.enh.invisibleFound", rep.count)) + "</span>";
    }
 // 按钮文案 / 图标
    btn.setAttribute("aria-pressed", shown ? "true" : "false");
    btn.classList.toggle("active", shown);
    btn.innerHTML = iconSvg("visibility_off")
      + "<span>" + esc(shown ? t("ui.enh.hideInvisible") : t("ui.enh.showInvisible")) + "</span>";
 // 显示区
    if (shown) {
      const { html } = visualizeInvisiblesHTML(cur, { showSpace: opts.showSpace });
      view.innerHTML = html;
      view.hidden = false;
    } else {
      view.hidden = true;
      view.innerHTML = "";
    }
  }

  btn.addEventListener("click", () => {
    shown = !shown;
    refresh();
    if (shown) {
      const rep = invisibleReport(cur);
      toast(rep.count === 0 ? t("ui.enh.invisibleNone") : t("ui.enh.invisibleFound", rep.count));
    }
  });

  refresh();

  return {
    setText(newText) { cur = String(newText); refresh(); },
    destroy() { box.remove(); },
    get shown() { return shown; },
  };
}

// ============================================================
// renderEnhancedView — 组合件：flag 高亮只读视图 + 不可见字符切换（DOM 组件）
// 供 M 接首页 renderHome / op 输出区。opts.showSpace 透传给不可见切换。
// 返回 { setText(newText), destroy }。
// ============================================================
export function renderEnhancedView(container, text = "", opts = {}) {
  ensureStyles();
  let cur = String(text);

  const root = el("div", { class: "ienh-root" });
  const flagBar = el("div", { class: "ienh-bar ienh-flagbar" });
  const flagStatus = el("span", { class: "ienh-status" });
  flagBar.append(flagStatus);
  const flagView = el("pre", { class: "ienh-view ienh-flagview" });

  root.append(flagBar, flagView);
  container.append(root);

 // 不可见字符切换挂在同一 root 下
  const invCtl = invisibleToggle(root, cur, opts);

  function refreshFlags() {
    const segs = buildSegments(cur, opts);
    const n = segs.filter((s) => s.mark).length;
    if (n === 0) {
      flagStatus.className = "ienh-status ok";
      flagStatus.innerHTML = iconSvg("tag") + "<span>" + esc(t("ui.enh.flagNone")) + "</span>";
      flagView.hidden = true;
      flagView.innerHTML = "";
    } else {
      flagStatus.className = "ienh-status found";
      flagStatus.innerHTML = iconSvg("tag") + "<span>" + esc(t("ui.enh.flagFound", n)) + "</span>";
      flagView.hidden = false;
      flagView.innerHTML = highlightFlags(cur, opts);
    }
  }

  refreshFlags();

  return {
    setText(newText) { cur = String(newText); refreshFlags(); invCtl.setText(cur); },
    destroy() { invCtl.destroy(); root.remove(); },
  };
}

// ============================================================
// 组件样式（复用 theme.css 令牌，M3 温和红）
// ============================================================
const CSS = `
.ienh-root { display: flex; flex-direction: column; gap: var(--sp-2); }
.ienh-bar {
  display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-2);
}
.ienh-btn {
  display: inline-flex; align-items: center; gap: var(--sp-1);
  height: 32px; padding: 0 var(--sp-3);
  border: 1px solid var(--outline-var); border-radius: var(--r-full);
  background: var(--surface-2); color: var(--on-surface-var);
  font-size: var(--fs-sm); font-family: var(--font); cursor: pointer;
  transition: background var(--dur-short) var(--ease), color var(--dur-short) var(--ease), border-color var(--dur-short) var(--ease);
}
.ienh-btn:hover { background: var(--surface-hi); color: var(--on-surface); border-color: var(--outline); }
.ienh-btn.active { background: var(--primary-container); color: var(--on-primary-container); border-color: transparent; }
.ienh-btn .ico { width: 16px; height: 16px; }

.ienh-status {
  display: inline-flex; align-items: center; gap: var(--sp-1);
  font-size: var(--fs-sm); color: var(--on-surface-var);
}
.ienh-status .ico { width: 16px; height: 16px; flex: none; }
.ienh-status.ok { color: var(--success); }
.ienh-status.found { color: var(--primary); }
.ienh-status.danger { color: var(--error); font-weight: 600; }

.ienh-view {
  margin: 0; padding: var(--sp-3);
  font-family: var(--mono); font-size: var(--fs-base); line-height: 1.6;
  color: var(--on-surface); background: var(--surface);
  border: 1px solid var(--outline-var); border-radius: var(--r-md);
  white-space: pre-wrap; word-break: break-word; overflow-wrap: anywhere;
  max-height: 40vh; overflow: auto;
}
.ienh-view[hidden] { display: none; }

/* ---- flag 高亮 mark（无障碍：颜色 + ▸ 前缀符号 + 下划线，不只靠色） ---- */
.ienh-flag {
  border-radius: var(--r-xs); padding: 0 2px;
  background: var(--primary-container); color: var(--on-primary-container);
  text-decoration: underline; text-decoration-style: dotted;
  text-underline-offset: 2px;
}
.ienh-flag::before { content: "▸"; opacity: .7; margin-right: 1px; font-size: .85em; }
.ienh-flag[data-kind="flag"] { background: var(--primary); color: var(--on-primary); font-weight: 600; }
.ienh-flag[data-kind="key"]  { background: var(--primary-container); }
.ienh-flag[data-kind="hash"] { background: var(--surface-hi); color: var(--on-surface); }
.ienh-flag[data-kind="b64"]  { background: var(--surface-4); color: var(--on-surface); }
.ienh-flag[data-kind="b64hint"] {
  background: transparent; color: var(--primary);
  text-decoration-style: dashed;
}
.ienh-flag[data-kind="b64hint"]::before { content: "◂"; }

/* ---- 不可见字符 mark（无障碍：虚线框 + title Unicode 名） ---- */
.ienh-inv {
  background: var(--surface-hi); color: var(--error);
  border: 1px dashed var(--error); border-radius: var(--r-xs);
  padding: 0 1px; margin: 0 .5px; font-weight: 600; cursor: help;
}
.ienh-inv[data-type="whitespace"] { color: var(--on-surface-var); border-color: var(--outline); }
.ienh-inv[data-type="control"]    { color: var(--primary); border-color: var(--primary); }
`;
