/*
 * expandableInput.js — MT5 通用「可展开输入框」组件（密钥/IV/crib 等短输入通用）。
 *
 * 默认：加宽单行 input + 右侧「展开」图标按钮。
 * 展开：弹出 M3 风格 modal（textarea + 取消/保存双按钮）。
 * 保存写回原 input 并触发 input/change 事件；取消/Esc/点遮罩关闭不写回。
 *
 * 低耦合：独立文件，样式由本文件 JS 注入 <style>（不碰 app.css / theme.css）。
 * 复用 theme.css 令牌（--surface-* / --primary / --r-* / --sp-* / --el-* / --dur-* 等）。
 * 图标复用 icons.js（save/close/open_in_full/cancel）。零外发、无 emoji。
 *
 * 用法：
 * import { expandableInput, openExpandModal } from "./ui/expandableInput.js";
 * const wrap = expandableInput({
 * id: "p_key", type: "text", value: "...", placeholder: "密钥"
 * title: "展开编辑", modalTitle: "编辑密钥"
 * cancelLabel: "取消", saveLabel: "保存"
 * onInput: (v) => { ... }, // input 事件回调（可选）
 * });
 * // wrap 内含 .exp-input（原 input，id 落在它上）+ .exp-btn（展开按钮）。
 */

import { icon as iconSvg } from "./icons.js";

// ---- 样式一次性注入（幂等） ----
// export：main.js 的 openSectionView 也复用 .exp-* 遮罩/卡片样式，需在无输入框实例化的
// 页面（如文件分析报告）里主动注入，否则弹窗裸奔成白底纯文本（无 fixed 遮罩、无居中卡片）。
const STYLE_ID = "exp-input-styles";
export function ensureExpStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

// ---- 图标兜底：open_in_full 未必在 icons.js，缺则退回 font_download 之外的展开语义图标 ----
// icons.js 缺图标返回占位方框（不抛错），此处直接用名字，交由 M 决定是否补 open_in_full。
function expandIconName() {
  return "open_in_full";
}

/**
 * 构造可展开输入框。
 * @param {object} opts
 * @param {string} [opts.id] 原 input 的 id（renderParam 需要，用于 label for）
 * @param {"text"|"number"} [opts.type="text"] input 类型（number 展开 modal 仍用 textarea，保存时按原样写回）
 * @param {string} [opts.value=""] 初始值
 * @param {string} [opts.placeholder=""]
 * @param {string} [opts.title="展开"] 展开按钮 title（悬浮提示）
 * @param {string} [opts.modalTitle="编辑"] modal 标题
 * @param {string} [opts.cancelLabel="取消"]
 * @param {string} [opts.saveLabel="保存"]
 * @param {(value:string)=>void} [opts.onInput] input 事件回调（含展开保存回写触发的那次）
 * @returns {HTMLDivElement} 包裹元素（class="exp-wrap"），内含 .exp-input 与 .exp-btn
 */
export function expandableInput(opts = {}) {
  ensureExpStyles();
  const {
    id,
    type = "text",
    value = "",
    placeholder = "",
    title = "展开",
    modalTitle = "编辑",
    cancelLabel = "取消",
    saveLabel = "保存",
    onInput,
  } = opts;

  const wrap = document.createElement("div");
  wrap.className = "exp-wrap";

  const input = document.createElement("input");
  input.className = "exp-input";
  input.type = type === "number" ? "number" : "text";
  if (id) input.id = id;
  input.placeholder = placeholder;
  input.value = value == null ? "" : String(value);
  if (typeof onInput === "function") {
    input.addEventListener("input", () => onInput(input.value));
  }

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "exp-btn";
  btn.title = title;
  btn.setAttribute("aria-label", title);
  btn.innerHTML = iconSvg(expandIconName());
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    openExpandModal(input.value, (val) => {
      input.value = val;
 // 触发 input + change，让宿主（renderParam 的 addEventListener("input")）拿到新值。
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, { modalTitle, cancelLabel, saveLabel });
  });

  wrap.append(input, btn);
  return wrap;
}

/**
 * 弹出展开编辑 modal。独立可用，不依赖 expandableInput。
 * @param {string} initialValue 初始文本
 * @param {(value:string)=>void} onSave 保存回调（点保存/Ctrl+Enter 时触发，传当前 textarea 值）
 * @param {object} [labels]
 * @param {string} [labels.modalTitle="编辑"]
 * @param {string} [labels.cancelLabel="取消"]
 * @param {string} [labels.saveLabel="保存"]
 * @returns { => void} close 关闭函数（外部可主动关）
 */
export function openExpandModal(initialValue = "", onSave, labels = {}) {
  ensureExpStyles();
  const {
    modalTitle = "编辑",
    cancelLabel = "取消",
    saveLabel = "保存",
  } = labels;

  const overlay = document.createElement("div");
  overlay.className = "exp-overlay";

  const dialog = document.createElement("div");
  dialog.className = "exp-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

 // 头部：标题 + 关闭
  const head = document.createElement("div");
  head.className = "exp-head";
  const titleEl = document.createElement("div");
  titleEl.className = "exp-title";
  titleEl.textContent = modalTitle;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "exp-close";
  closeBtn.title = cancelLabel;
  closeBtn.setAttribute("aria-label", cancelLabel);
  closeBtn.innerHTML = iconSvg("close");
  head.append(titleEl, closeBtn);

 // 正文：textarea
  const ta = document.createElement("textarea");
  ta.className = "exp-textarea";
  ta.value = initialValue == null ? "" : String(initialValue);
  ta.spellcheck = false;
  ta.setAttribute("autocomplete", "off");

 // 底部：取消 / 保存
  const foot = document.createElement("div");
  foot.className = "exp-foot";
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "exp-action exp-cancel";
  cancel.innerHTML = iconSvg("cancel") + "<span>" + escapeText(cancelLabel) + "</span>";
  const save = document.createElement("button");
  save.type = "button";
  save.className = "exp-action exp-save";
  save.innerHTML = iconSvg("save") + "<span>" + escapeText(saveLabel) + "</span>";
  foot.append(cancel, save);

  dialog.append(head, ta, foot);
  overlay.append(dialog);
  document.body.append(overlay);

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    overlay.classList.add("exp-closing");
 // 出场动画后移除
    setTimeout(() => overlay.remove(), 175);
  }
  function commit() {
    if (typeof onSave === "function") onSave(ta.value);
    close();
  }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commit(); }
  }

  closeBtn.addEventListener("click", close);
  cancel.addEventListener("click", close);
  save.addEventListener("click", commit);
 // 点遮罩关闭（仅点在 overlay 本身，非冒泡自 dialog）
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);

 // 聚焦 + 光标置末尾
  requestAnimationFrame(() => {
    ta.focus();
    const len = ta.value.length;
    try { ta.setSelectionRange(len, len); } catch { /* number 型不支持忽略 */ }
  });

  return close;
}

function escapeText(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]
  ));
}

// ---- 组件样式（复用 theme.css 令牌，与 app.css .about-* modal 视觉对齐） ----
const CSS = `
.exp-wrap {
  display: flex;
  align-items: stretch;
  gap: var(--sp-1);
  width: 100%;
}
.exp-input {
  flex: 1;
  min-width: 0;
  font-family: var(--mono);
  font-size: var(--fs-base);
}
.exp-btn {
  flex: none;
  width: 34px;
  align-self: stretch;
  min-height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--outline-var);
  border-radius: var(--r-sm);
  background: var(--surface-2);
  color: var(--on-surface-var);
  cursor: pointer;
  transition: background var(--dur-short) var(--ease), color var(--dur-short) var(--ease), border-color var(--dur-short) var(--ease);
}
.exp-btn:hover { background: var(--surface-hi); color: var(--on-surface); border-color: var(--outline); }
.exp-btn:active { background: var(--surface-3); }
.exp-btn .ico { width: 18px; height: 18px; }

.exp-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, .5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 120;
  padding: var(--sp-4);
  animation: exp-fade var(--dur-medium) var(--ease-out);
}
.exp-overlay.exp-closing { animation: exp-fade var(--dur-4) var(--ease-in) reverse; }
@keyframes exp-fade { from { opacity: 0; } to { opacity: 1; } }

.exp-dialog {
  width: 100%;
  max-width: 560px;
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  background: var(--surface-2);
  border: 1px solid var(--outline-var);
  border-radius: var(--r-xl);
  box-shadow: var(--el-3);
  padding: var(--sp-5);
  animation: exp-pop var(--dur-medium) var(--ease-out);
}
.exp-overlay.exp-closing .exp-dialog { animation: exp-pop var(--dur-4) var(--ease-in) reverse; }
@keyframes exp-pop {
  from { opacity: 0; transform: scale(.96) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

.exp-head {
  display: flex;
  align-items: center;
  gap: var(--sp-3);
  margin-bottom: var(--sp-4);
}
.exp-title {
  flex: 1;
  font-size: var(--fs-lg);
  font-weight: 700;
  color: var(--on-surface);
}
.exp-close {
  flex: none;
  width: 36px; height: 36px;
  border-radius: var(--r-full);
  display: inline-flex; align-items: center; justify-content: center;
  color: var(--on-surface-var);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background var(--dur-short) var(--ease), color var(--dur-short) var(--ease);
}
.exp-close:hover { background: var(--surface-hi); color: var(--on-surface); }
.exp-close .ico { width: 20px; height: 20px; }

.exp-textarea {
  width: 100%;
  min-height: 180px;
  max-height: 52vh;
  resize: vertical;
  box-sizing: border-box;
  font-family: var(--mono);
  font-size: var(--fs-base);
  line-height: 1.5;
  color: var(--on-surface);
  background: var(--surface);
  border: 1px solid var(--outline-var);
  border-radius: var(--r-md);
  padding: var(--sp-3);
  outline: none;
  transition: border-color var(--dur-short) var(--ease);
}
.exp-textarea:focus { border-color: var(--primary); }

.exp-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--sp-2);
  margin-top: var(--sp-4);
}
.exp-action {
  display: inline-flex;
  align-items: center;
  gap: var(--sp-2);
  height: 40px;
  padding: 0 var(--sp-4);
  border-radius: var(--r-full);
  font-size: var(--fs-base);
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  transition: background var(--dur-short) var(--ease), color var(--dur-short) var(--ease), border-color var(--dur-short) var(--ease);
}
.exp-action .ico { width: 18px; height: 18px; }
.exp-cancel {
  background: transparent;
  color: var(--on-surface-var);
  border-color: var(--outline);
}
.exp-cancel:hover { background: var(--surface-hi); color: var(--on-surface); }
.exp-save {
  background: var(--primary);
  color: var(--on-primary, var(--surface));
}
.exp-save:hover { filter: brightness(1.08); }
.exp-save:active { filter: brightness(.94); }

@media (prefers-reduced-motion: reduce) {
  .exp-overlay, .exp-dialog, .exp-overlay.exp-closing, .exp-overlay.exp-closing .exp-dialog { animation: none; }
}
`;
