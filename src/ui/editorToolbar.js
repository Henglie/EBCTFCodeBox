// editorToolbar.js — 通用编辑框工具条（记事本化，扩展到全站编辑框）
// 一处实现，多处复用：op 框（main.js 已自带同款）、首页一把梭、配方链、字符显示器。
// 零耦合：自持 el/msym/tt/toast，复用 icons.js 内联 SVG，通过 window.__ebctfT/__ebctfToast 取值。
//
// 设计：attachEditorToolbar(textareaLike, opts) 在编辑框前插一行按钮，并挂 Ctrl+A/Ctrl+S 快捷键。
// - textareaLike 需支持 .value 读写（原生 textarea 或 main.js ioArea 的 contenteditable 代理均可）
// - opts.readonly=true → 只读框（输出框）：只给 复制/全选/导出/字号，不给 粘贴/清空
// - opts.onChange → 粘贴/清空后回调（如配方链需重跑）
// - opts.exportName → 导出文件名
// Ctrl+Z 撤销走浏览器/textarea 原生，不干预。
import { icon as iconSvg } from "./icons.js";
import { attachTextContextMenu } from "./textContextMenu.js";

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
function msym(name) {
  const s = el("span", { class: "msym" });
  s.innerHTML = iconSvg(name);
  return s;
}
const ET_FALLBACK = {
  "ui.op.paste": "粘贴",
  "ui.op.clear": "清空",
  "ui.op.copy": "复制",
  "ui.op.selectAll": "全选",
  "ui.op.export": "导出为文件",
  "ui.op.fontDec": "缩小字号",
  "ui.op.fontInc": "放大字号",
  "ui.toast.copied": "已复制",
  "ui.toast.clipFail": "剪贴板读取失败",
};
function tt(key) {
  try { if (typeof window !== "undefined" && window.__ebctfT) { const s = window.__ebctfT(key); if (s && s !== key) return s; } } catch { /* 回退 */ }
  return ET_FALLBACK[key] || key;
}
function toast(msg) {
  try { if (typeof window !== "undefined" && window.__ebctfToast) { window.__ebctfToast(msg); } } catch { /* 忽略 */ }
}

// 全选编辑框内容：textarea 用 select，contenteditable 用 Range 选中。
function selectAllIn(area) {
  try {
    if (typeof area.select === "function" && "selectionStart" in area) { area.focus(); area.select(); return; }
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(area);
    sel.removeAllRanges();
    sel.addRange(range);
    area.focus();
  } catch { /* 忽略 */ }
}
// 导出文本为 .txt（纯前端 Blob，零外发）。
function exportText(text, fname) {
  try {
    const name = fname || ("ebctf-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + ".txt");
    const blob = new Blob([text == null ? "" : String(text)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { /* 忽略 */ }
}

// 字号：改本编辑框内联 font-size（11..28px），本框独立不影响他框。
function makeFontCtl(area) {
  let px = 14;
  const cur = parseInt(area.style.fontSize, 10);
  if (!Number.isNaN(cur)) px = cur;
  const apply = () => { area.style.fontSize = px + "px"; };
  return {
    dec: () => { px = Math.max(11, px - 1); apply(); },
    inc: () => { px = Math.min(28, px + 1); apply(); },
  };
}

function tbtn(iconName, label, onClick) {
  return el("button", { class: "et-btn", type: "button", title: label, "aria-label": label, onclick: onClick }, msym(iconName));
}

// attachEditorToolbar(area, opts) → 返回工具条 DOM（调用方自行插到 area 前）。同时挂快捷键。
export function attachEditorToolbar(area, opts = {}) {
  const ro = opts.readonly === true;
  const onChange = typeof opts.onChange === "function" ? opts.onChange : null;
  const font = makeFontCtl(area);

  const bar = el("div", { class: "et-toolbar" });

  if (!ro) {
    bar.append(tbtn("content_paste", tt("ui.op.paste"), async () => {
      try { area.value = await navigator.clipboard.readText(); if (onChange) onChange(); }
      catch { toast(tt("ui.toast.clipFail")); }
    }));
    bar.append(tbtn("delete_sweep", tt("ui.op.clear"), () => { area.value = ""; if (onChange) onChange(); }));
  }
  bar.append(tbtn("content_copy", tt("ui.op.copy"), () => {
    try { navigator.clipboard?.writeText(area.value); toast(tt("ui.toast.copied")); } catch { /* 忽略 */ }
  }));
  bar.append(tbtn("select_all", tt("ui.op.selectAll"), () => selectAllIn(area)));
  bar.append(tbtn("download", tt("ui.op.export"), () => exportText(area.value, opts.exportName)));
  bar.append(tbtn("text_decrease", tt("ui.op.fontDec"), font.dec));
  bar.append(tbtn("text_increase", tt("ui.op.fontInc"), font.inc));

 // 右键文本处理菜单：只读框不挂编辑菜单，可写框挂。写回后触发 onChange。
  attachTextContextMenu(area, { readonly: ro, onChange });

 // 快捷键：Ctrl+A 全选（显式接管防越界选全页）、Ctrl+S 导出。Ctrl+Z 走原生。
  area.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "a") { e.preventDefault(); selectAllIn(area); }
      else if (k === "s") { e.preventDefault(); exportText(area.value, opts.exportName); }
    }
  });

  return bar;
}

export { selectAllIn, exportText };
