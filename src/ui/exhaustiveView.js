// exhaustiveView.js — 穷举全解视图（一键穷举）
// 与「一把梭智能识别(magic)」并列的第二范式：每个解码器全跑全列，flag 高亮让人眼扫。
// 复用 core/exhaustiveDecode.js。独立模块，自带轻量 el/msym，不反向依赖 main.js（低耦合）。
import { getOp } from "../core/registry.js";
import { exhaustiveDecode } from "../core/exhaustiveDecode.js";
import { icon as iconSvg } from "./icons.js";
import { ioArea } from "./ioArea.js"; // 天珩连字：输入改 contenteditable div（textarea 吞 OpenType 特性）

// ---- 轻量 DOM 工具（本模块自持，零耦合）----
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
  s.innerHTML = iconSvg(name);   // 注入内联 SVG（原先只写文字，图标显示成英文单词）
  return s;
}
// i18n 取值：优先 main.js 暴露的 t/opName，否则回退
function tt(key, ...args) {
  try { if (typeof window !== "undefined" && window.__ebctfT) { const s = window.__ebctfT(key, ...args); if (s && s !== key) return s; } } catch { /* 回退 */ }
  return EXHAUST_FALLBACK[key] || key;
}
function opDisplayName(opId) {
  const op = getOp(opId);
 // 双语优先（结果区对照）：__ebctfOpNameBi 返回「中文 (English)」；回退单语 opName。
  try { if (op && typeof window !== "undefined" && window.__ebctfOpNameBi) { const n = window.__ebctfOpNameBi(op); if (n) return n; } } catch { /* 回退 */ }
  try { if (op && typeof window !== "undefined" && window.__ebctfOpName) { const n = window.__ebctfOpName(op); if (n) return n; } } catch { /* 回退 */ }
  return (op && op.name) || opId;
}
function catDisplayName(catId, fallback) {
  try { if (typeof window !== "undefined" && window.__ebctfCatName) { const n = window.__ebctfCatName(catId); if (n) return n; } } catch { /* 回退 */ }
  return fallback || catId;
}
// i18n 未接线时的中文兜底
const EXHAUST_FALLBACK = {
  "ui.exhaust.title": "穷举全解",
  "ui.exhaust.desc": "每个解码器都跑一遍、结果全部列出（含乱码），flag 特征高亮，你自己扫。与「一把梭」智能优选互补。",
  "ui.exhaust.placeholder": "在此粘贴或拖入待解码内容（纯前端，零外发）…",
  "ui.exhaust.runBtn": "穷举全解",
  "ui.exhaust.onlyHit": "只看高亮命中",
  "ui.exhaust.showAll": "显示全部",
  "ui.exhaust.hideGarbage": "隐藏乱码",
  "ui.exhaust.tooLong": "输入过长（上限 {0} 字符），请缩短或用左侧单项解码。",
  "ui.exhaust.empty": "无解码结果。",
  "ui.exhaust.stat": "共 {0} 项结果，{1} 项命中 flag 特征",
  "ui.exhaust.copied": "已复制结果",
  "ui.exhaust.copyHint": "点击复制",
  "ui.exhaust.running": "穷举中…",
  "ui.exhaust.branchCount": "{0} 个分支",
  "ui.exhaust.hitCount": "{0} 条疑似命中",
  "ui.exhaust.defaultParam": "默认",
};

// ---- 状态 ----
const eState = {
  input: "",
  onlyHit: false,     // 只看命中
  hideGarbage: false, // 隐藏低可打印率乱码
};

let _seq = 0; // 防竞态：慢结果回来若非最新则丢弃

export function renderExhaustive(container) {
  container.innerHTML = "";
  const wrap = el("div", { class: "exhaust-view" });

 // 标题
  wrap.append(el("div", { class: "op-head" },
    el("div", { class: "op-title" }, msym("apps"), tt("ui.exhaust.title")),
    el("div", { class: "op-desc" }, tt("ui.exhaust.desc")),
  ));

 // 输入框（拖放：文本读入 / 二进制转 hex）
  const input = ioArea({
    class: "io-area exhaust-input", placeholder: tt("ui.exhaust.placeholder"),
    style: "min-height:140px",
  });
  input.value = eState.input || "";

 // 工具栏：穷举按钮 + 过滤开关
  const runBtn = el("button", { class: "act-btn primary exhaust-run" }, msym("apps"), el("span", {}, tt("ui.exhaust.runBtn")));
  const onlyHitCb = el("input", { type: "checkbox", id: "exhaustOnlyHit" });
  onlyHitCb.checked = eState.onlyHit;
  const hideGarbageCb = el("input", { type: "checkbox", id: "exhaustHideGarbage" });
  hideGarbageCb.checked = eState.hideGarbage;
  const toolbar = el("div", { class: "exhaust-toolbar" },
    runBtn,
    el("label", { class: "exhaust-switch-label", for: "exhaustOnlyHit" },
      el("span", { class: "switch" }, onlyHitCb, el("span", { class: "track" }), el("span", { class: "knob" })),
      el("span", {}, tt("ui.exhaust.onlyHit")),
    ),
    el("label", { class: "exhaust-switch-label", for: "exhaustHideGarbage" },
      el("span", { class: "switch" }, hideGarbageCb, el("span", { class: "track" }), el("span", { class: "knob" })),
      el("span", {}, tt("ui.exhaust.hideGarbage")),
    ),
  );

  const statBar = el("div", { class: "exhaust-stat" });
  const out = el("div", { class: "exhaust-out" });

  const run = async () => {
    eState.input = input.value;
    eState.onlyHit = onlyHitCb.checked;
    eState.hideGarbage = hideGarbageCb.checked;
    const q = input.value.trim();
    out.innerHTML = "";
    statBar.textContent = "";
    if (!q) return;
    const seq = ++_seq;
    statBar.textContent = tt("ui.exhaust.running");
    const r = await exhaustiveDecode(q, {
      onlyChanged: true,
      onlyPrintable: eState.hideGarbage,
    });
    if (seq !== _seq) return; // 过期
    if (r.tooLong) { statBar.textContent = ""; out.append(el("div", { class: "exhaust-empty" }, tt("ui.exhaust.tooLong", r.maxInput))); return; }
    renderResults(out, statBar, r);
  };

  runBtn.addEventListener("click", run);
  onlyHitCb.addEventListener("change", run);
  hideGarbageCb.addEventListener("change", run);
 // 输入变化实时跑（防抖）
  let _t = null;
  input.addEventListener("input", () => { eState.input = input.value; clearTimeout(_t); _t = setTimeout(run, 250); });

 // 拖放：文本读入 / 二进制转 hex
  input.addEventListener("dragover", (e) => { e.preventDefault(); input.classList.add("dragover"); });
  input.addEventListener("dragleave", () => input.classList.remove("dragover"));
  input.addEventListener("drop", async (e) => {
    e.preventDefault(); input.classList.remove("dragover");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    let nul = 0, high = 0; const n = Math.min(bytes.length, 4096);
    for (let i = 0; i < n; i++) { if (bytes[i] === 0) nul++; if (bytes[i] >= 0x80) high++; }
    if (nul === 0 && (n === 0 || high / n < 0.30)) input.value = new TextDecoder("utf-8").decode(bytes);
    else { let hex = ""; for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0"); input.value = hex; }
    run();
  });

  wrap.append(input, toolbar, statBar, out);
  container.append(wrap);
  input.focus();
  if ((eState.input || "").trim()) setTimeout(run, 0);
}

// 渲染两级分组结果（外层分类 / 内层算法折叠卡片）+ flag 三档高亮。
// 同一算法的多条穷举分支归到一个可折叠 <details> 卡片，命中组默认展开、其余折叠。
function renderResults(out, statBar, r) {
  out.innerHTML = "";
  statBar.textContent = tt("ui.exhaust.stat", r.total, r.hits);
  if (!r.total) { out.append(el("div", { class: "exhaust-empty" }, tt("ui.exhaust.empty"))); return; }

  const wantOnlyHit = eState.onlyHit;
  for (const g of r.groups) {
 // 先过滤 onlyHit，再看该分类是否还有算法组
    const algos = (g.algos || []).map((a) => {
      const items = wantOnlyHit ? a.items.filter(isHit) : a.items;
      return { ...a, items };
    }).filter((a) => a.items.length);
    if (!algos.length) continue;

    const catBox = el("div", { class: "exhaust-cat" });
    catBox.append(el("div", { class: "exhaust-cat-head" },
      el("span", { class: "exhaust-cat-name" }, catDisplayName(g.cat, g.catName)),
      el("span", { class: "exhaust-cat-count" }, String(algos.reduce((n, a) => n + a.items.length, 0))),
    ));
    for (const a of algos) catBox.append(renderAlgo(a, wantOnlyHit));
    out.append(catBox);
  }
 // onlyHit 下若全空
  if (wantOnlyHit && !out.querySelector(".exhaust-row")) {
    out.append(el("div", { class: "exhaust-empty" }, tt("ui.exhaust.empty")));
  }
}

function isHit(it) { return it.isFlagFormat || it.flagHit || it.matchesCrib; }

// 算法折叠卡片：<details> 头显示算法名 + 分支数 + 命中数；命中组或 onlyHit 时默认展开。
function renderAlgo(a, wantOnlyHit) {
  const open = a.hasStrongHit || wantOnlyHit;
  const box = el("details", { class: "exhaust-algo" + (a.hasStrongHit ? " has-hit" : "") });
  if (open) box.setAttribute("open", "");

  const parts = [tt("ui.exhaust.branchCount", a.items.length)];
  if (a.hitCount > 0) parts.push(tt("ui.exhaust.hitCount", a.hitCount));
  const summary = el("summary", { class: "exhaust-algo-head" },
    el("span", { class: "exhaust-algo-name" }, opDisplayName(a.baseOpId)),
    el("span", { class: "exhaust-algo-meta" + (a.hitCount > 0 ? " hit" : "") }, parts.join(" · ")),
  );
  box.append(summary);
  const body = el("div", { class: "exhaust-algo-body" });
  for (const it of a.items) body.append(renderRow(it));
  box.append(body);
  return box;
}

// 单行：参数标签（如 shift=3）+ 结果（flag 高亮）。点击复制。
function renderRow(it) {
  const row = el("div", { class: "exhaust-row" + (it.ok ? "" : " err") + (it.isFlagFormat ? " flag-format" : (it.flagHit || it.matchesCrib ? " flag-hit" : "")) });
  const label = it.paramTag || tt("ui.exhaust.defaultParam");
  const name = el("span", { class: "exhaust-op exhaust-param" }, label);
  let valEl;
  if (!it.ok) {
    valEl = el("span", { class: "exhaust-val exhaust-err-val" }, msym("cancel"), " " + (it.error || ""));
  } else {
    const full = it.result || "";
    const shown = full.length > 300 ? full.slice(0, 300) + " …" : full;
    valEl = el("span", { class: "exhaust-val" + (it.printable < 0.5 ? " garbage" : "") }, shown);
    row.setAttribute("title", tt("ui.exhaust.copyHint"));
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      navigator.clipboard?.writeText(full);
      if (typeof window !== "undefined" && window.__ebctfToast) window.__ebctfToast(tt("ui.exhaust.copied"));
    });
  }
  row.append(name, el("span", { class: "exhaust-sep" }, ":"), valEl);
  return row;
}

export { eState };
