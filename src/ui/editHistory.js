/*
 * editHistory.js — 通用文本编辑框撤销/重做适配器。
 *
 * 目的：op 输入框、首页一把梭、字符显示器、配方输入等可写编辑框统一支持
 * Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y，不改变只读输出框的语义。
 *
 * 复用 core/historyStack.js 的纯内存历史内核；本文件只做 DOM/选区适配：
 * - contenteditable（.io-area）与 textarea/input 都支持；
 * - 打字按 500ms 合并成一次撤销；粘贴/清空/外部 .value 写入是独立条目；
 * - 撤销后派发 input 事件，让页面状态/一键解码/配方重跑照常同步；
 * - 中文 IME 组合输入期间不记历史，compositionend 后再记。
 */

import { createHistory } from "../core/historyStack.js";

const SKIP_SELECTOR = ".cm-editor, .cm-content, [data-no-history]";
const DEFAULT_CAPACITY = 100;
const DEFAULT_COALESCE_MS = 500;

function textOf(area) {
  if ("value" in area) return String(area.value == null ? "" : area.value);
  return String(area.textContent == null ? "" : area.textContent);
}

function isReadonly(area) {
  return area.getAttribute("contenteditable") === "false" || area.readOnly === true;
}

function getSel(area) {
  // Newly constructed fields have no live selection. Asking window.getSelection
  // while rebuilding a page can force layout of the entire outgoing workspace.
  if (!area.isConnected) return { start: 0, end: 0 };
  if (typeof area.selectionStart === "number" && typeof area.selectionEnd === "number") {
    return { start: area.selectionStart, end: area.selectionEnd };
  }
  try {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return { start: 0, end: 0 };
    const range = sel.getRangeAt(0);
    if (!area.contains(range.startContainer) || !area.contains(range.endContainer)) return { start: 0, end: 0 };
    const pre = range.cloneRange();
    pre.selectNodeContents(area);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    const pre2 = range.cloneRange();
    pre2.selectNodeContents(area);
    pre2.setEnd(range.endContainer, range.endOffset);
    return { start, end: pre2.toString().length };
  } catch {
    return { start: 0, end: 0 };
  }
}

function setSel(area, start, end) {
  const text = textOf(area);
  const s = Math.max(0, Math.min(Number(start) || 0, text.length));
  const e = Math.max(s, Math.min(Number(end) || s, text.length));
  if (typeof area.setSelectionRange === "function") {
    try { area.setSelectionRange(s, e); area.focus(); return; } catch { /* 继续走 Range */ }
  }
  try {
    const sel = window.getSelection();
    if (!sel) return;
    const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
    let pos = 0, startNode = null, startOffset = 0, endNode = null, endOffset = 0;
    let node;
    while ((node = walker.nextNode())) {
      const len = node.nodeValue ? node.nodeValue.length : 0;
      if (startNode === null && pos + len >= s) { startNode = node; startOffset = Math.max(0, s - pos); }
      if (endNode === null && pos + len >= e) { endNode = node; endOffset = Math.max(0, e - pos); }
      pos += len;
      if (startNode && endNode) break;
    }
    const range = document.createRange();
    if (startNode) range.setStart(startNode, startOffset);
    else { range.selectNodeContents(area); range.collapse(false); }
    if (endNode) range.setEnd(endNode, endOffset);
    else range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    area.focus();
  } catch { /* 选区恢复失败不影响撤销本身 */ }
}

/**
 * 给一个已创建的可写编辑框挂上撤销/重做。
 * @param {HTMLElement} area contenteditable / textarea / input
 * @param {{capacity?:number, coalesceMs?:number}} [opts]
 * @returns {{undo:Function, redo:Function, canUndo:Function, canRedo:Function, destroy:Function}|null}
 */
export function attachEditHistory(area, opts = {}) {
  if (!area || area.__editHistory) return area && area.__editHistory ? area.__editHistory : null;
  if (isReadonly(area)) return null;
  try { if (area.closest && area.closest(SKIP_SELECTOR)) return null; } catch { /* 非 DOM 环境 */ }

  const history = createHistory({
    capacity: opts.capacity || DEFAULT_CAPACITY,
    coalesceMs: opts.coalesceMs == null ? DEFAULT_COALESCE_MS : opts.coalesceMs,
    equals: (a, b) => a && b && a.text === b.text,
  });
  let applying = false;
  let composing = false;

  const snapshot = () => ({ text: textOf(area), ...getSel(area) });

  function record(label) {
    if (applying || composing) return;
    history.push(snapshot(), label || "typing");
    emit();
  }

  function emit() {
    try {
      area.dispatchEvent(new CustomEvent("edit-history-change", {
        bubbles: false,
        detail: { canUndo: history.canUndo(), canRedo: history.canRedo() },
      }));
    } catch { /* 忽略事件发射失败 */ }
  }

  function apply(snap) {
    if (!snap) return false;
    applying = true;
    try {
      area.value = snap.text;
      setSel(area, snap.start, snap.end);
      // 让上层状态（home input / convert / recipe）跟撤销后的文本同步。
      try {
        area.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "historyUndo" }));
      } catch {
        area.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return true;
    } finally {
      applying = false;
    }
  }

  function undo() {
    const r = history.undo();
    if (r.ok) apply(r.state);
    emit();
    return r.ok;
  }

  function redo() {
    const r = history.redo();
    if (r.ok) apply(r.state);
    emit();
    return r.ok;
  }

  // 外部 `.value = ...`（工具栏粘贴/清空、文件载入、右键变换等）也记一条，
  // 否则用户最常见的“粘贴后 Ctrl+Z”仍然无效。
  try {
    const own = Object.getOwnPropertyDescriptor(area, "value");
    const proto = Object.getPrototypeOf(area);
    const base = own || (proto && Object.getOwnPropertyDescriptor(proto, "value"));
    if (base && base.get && base.set && !own) {
      Object.defineProperty(area, "value", {
        configurable: true,
        get() { return base.get.call(this); },
        set(v) {
          const before = textOf(area);
          base.set.call(this, v);
          if (!applying && !composing && textOf(area) !== before) record("external");
        },
      });
    } else if (own && own.get && own.set) {
      // ioArea 的 .value 代理：包装 setter，不破坏原 getter/setter。
      Object.defineProperty(area, "value", {
        configurable: true,
        get() { return own.get.call(this); },
        set(v) {
          const before = textOf(area);
          own.set.call(this, v);
          if (!applying && !composing && textOf(area) !== before) record("external");
        },
      });
    }
  } catch { /* 某些浏览器不允许覆盖 value，则只靠 input 事件 */ }

  history.push(snapshot(), "init");

  area.addEventListener("input", () => record("typing"));
  area.addEventListener("compositionstart", () => { composing = true; });
  area.addEventListener("compositionend", () => { composing = false; record("typing"); });
  area.addEventListener("keydown", (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const k = String(e.key || "").toLowerCase();
    if (k === "z" && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if ((k === "z" && e.shiftKey) || k === "y") {
      e.preventDefault();
      redo();
    }
  }, true);

  const api = {
    undo, redo,
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    destroy() {
      history.clear();
      area.__editHistory = null;
    },
  };
  area.__editHistory = api;
  emit();
  return api;
}

export default { attachEditHistory };
