/*
 * ioArea.js — 主 IO 编辑区工厂（可跨模块复用）。
 *
 * contenteditable <div> 取代 <textarea>，让天珩全字库的 OpenType 特性
 * （calt/liga/ccmp 连字·上下文替换·组合）走正常文本渲染管线真正生效
 * （textarea 渲染限制会吞掉这些特性）。
 *
 * 关键设计：在 div 上把 .value 代理到 textContent（纯文本，杜绝 HTML 注入 + 保留换行语义）
 * 这样原有大量 `el.value` 读写代码几乎无需改动即可透明工作。
 * - readonly:true → contenteditable="false"（仍可选中复制），加 .io-readonly 类
 * - placeholder → data-placeholder + CSS :empty::before 模拟（div 无原生 placeholder）
 * - 粘贴强制纯文本（clipboardData text/plain + Range）
 *
 * 零依赖（自带极简 el），供 main.js / recipeView / exhaustiveView 共用。
 */

import { attachEditHistory } from "./editHistory.js";

/* 极简元素工厂（与 main.js el 语义一致的子集，够 ioArea 用）。 */
function el(tag, attrs = {}) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  return n;
}

export function ioArea(attrs = {}) {
  const a = { ...attrs };
  const ph = a.placeholder; delete a.placeholder;
  const ro = a.readonly === true || a.readonly === ""; delete a.readonly;
  delete a.spellcheck; delete a.rows; // div 上无意义，统一处理
  const div = el("div", a);
  div.setAttribute("contenteditable", ro ? "false" : "true");
  div.setAttribute("spellcheck", "false");
  if (ph) div.setAttribute("data-placeholder", ph);
  if (ro) div.classList.add("io-readonly");
  // A terminal LF needs a final line box in contenteditable. BR contributes no
  // textContent; unlike a zero-width character, it cannot leak into input data.
  const syncCaretLine = () => {
    const needed = !ro && div.textContent.endsWith("\n");
    const markers = [...div.querySelectorAll("br[data-io-caret]")];
    const marker = needed ? markers.pop() : null;
    for (const node of markers) node.remove();
    if (needed) {
      const br = marker || document.createElement("br");
      br.dataset.ioCaret = "";
      if (div.lastChild !== br) div.append(br);
    }
  };
 // .value 代理 textContent：读写纯文本，保留换行（配合 CSS white-space:pre-wrap）
  Object.defineProperty(div, "value", {
    get() { return this.textContent; },
    set(v) { this.textContent = v == null ? "" : String(v); syncCaretLine(); },
    configurable: true,
  });
  if (!ro) {
    let composing = false;
    const insertPlainText = (text, inputType) => {
      const sel = window.getSelection();
      let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
      // A paste with a stale/outside selection must not modify another editor.
      if (!range || !div.contains(range.startContainer) || !div.contains(range.endContainer)) {
        range = document.createRange();
        range.selectNodeContents(div); range.collapse(false);
      }
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      syncCaretLine();
      // Keep the caret IN the inserted text, not at the parent boundary before
      // Range.insertNode's empty split sibling. Browsers otherwise canonicalize
      // that boundary to the preceding visual line when the next character arrives.
      range.setStart(node, node.length); range.collapse(true);
      if (sel) { sel.removeAllRanges(); sel.addRange(range); }
      div.dispatchEvent(new InputEvent("input", { bubbles: true, inputType, data: text }));
    };
 // 粘贴净化：只取纯文本，杜绝富文本/HTML 注入。
 // 不用 execCommand("insertText")：Chromium 会吞 \n（多行矩阵被拍平成单行）且返回 true，
 // 兜底分支永不触发。改为 Range 直插文本节点（.io-area 为 pre-wrap，\n 语义正确），
 // 并手动补发 input 事件（程序化 DOM 变更不触发原生 input，上层状态同步依赖它）。
    div.addEventListener("paste", (e) => {
      e.preventDefault();
      const cd = e.clipboardData || window.clipboardData;
      const text = cd ? cd.getData("text/plain") : "";
      if (!text) return;
      insertPlainText(text, "insertFromPaste");
    });
 // Enter → 纯 "\n"（不让浏览器插入 <div>/<br>，保证 textContent 换行语义正确）。
 // Ctrl/Meta+Enter 放行给上层的 convert 快捷键；Shift+Enter 也走纯换行。
 // 同粘贴：execCommand("insertText", "\n") 在 Chromium 吞换行 → Range 直插 + 补发 input。
    div.addEventListener("keydown", (e) => {
      if (composing || e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        insertPlainText("\n", e.shiftKey ? "insertLineBreak" : "insertParagraph");
      }
    });
    // Virtual keyboards can request a line break without a desktop keydown.
    // A prevented keydown does not produce a native beforeinput, so Enter is not doubled.
    div.addEventListener("beforeinput", (e) => {
      if (composing || e.isComposing || !e.cancelable) return;
      if (e.inputType === "insertParagraph" || e.inputType === "insertLineBreak") {
        e.preventDefault(); insertPlainText("\n", e.inputType);
      }
    });
    div.addEventListener("compositionstart", () => { composing = true; });
    div.addEventListener("compositionend", () => { composing = false; syncCaretLine(); });
 // 保险：内容删空后清掉浏览器残留的 <br>，让 :empty placeholder 重新生效
    div.addEventListener("input", (e) => {
      if (composing || e.isComposing) return;
      if (div.textContent === "") div.innerHTML = "";
      else syncCaretLine();
    });
  }
  if (!ro) attachEditHistory(div);
  return div;
}
