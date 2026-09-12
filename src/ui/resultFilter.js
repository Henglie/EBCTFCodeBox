/*
 * resultFilter.js — 一键解码结果查找/筛选工具条（独立 UI，零算法侵入）。
 *
 * - 只筛选已保留结果，不重解码、不改排序/分组/原始内容；空查询=全部。
 * - 普通文字子串匹配，默认不区分大小写，可切「Aa」区分；不把查询当正则或 HTML。
 * - 匹配对象 = 结果文本 + 链路 id/中英文显示名；独立爆破结果 = 输出 + op id/名称。
 * - 查询只存 WeakMap 内存，不外发、不持久化；新一轮解码清空。
 * - 工具条挂在结果容器外侧，结果重渲染不会移除输入节点，焦点/光标/IME 状态不丢。
 */
import { t, getLocale } from "../i18n/index.js";
import { getOp } from "../core/registry.js";

const stateByWrap = new WeakMap();
const MAX_QUERY = 512;
const FALLBACK = {
  zh: {
    ph: "筛选结果（关键词）", count: "匹配 {0} / {1}", clear: "清空",
    none: "无匹配结果", collapse: "收起筛选", expand: "展开筛选", case: "区分大小写",
  },
  en: {
    ph: "Filter results (keyword)", count: "{0} / {1} matched", clear: "Clear",
    none: "No matching results", collapse: "Collapse filter", expand: "Expand filter", case: "Case sensitive",
  },
};

function tt(key, ...args) {
  try {
    const value = t(key, ...args);
    if (value && value !== key) return value;
  } catch { /* 主表未接线时回退 */ }
  let en = false;
  try { en = getLocale() === "en"; } catch { /* 默认中文 */ }
  const localKey = key.split(".").pop();
  let value = (en ? FALLBACK.en : FALLBACK.zh)[localKey] ?? key;
  args.forEach((arg, i) => { value = value.split(`{${i}}`).join(String(arg)); });
  return value;
}

function opSearchText(id) {
  const opId = String(id).split("(")[0];
  const op = getOp(opId);
  let localized = "";
  try {
    const value = t(`op.${opId}.name`);
    if (value && value !== `op.${opId}.name`) localized = value;
  } catch { /* 仅用注册名与 id */ }
  return [id, op && op.name, localized].filter(Boolean).join(" ");
}

function magicText(candidate) {
  const chain = Array.isArray(candidate && candidate.chain) ? candidate.chain : [];
  return `${candidate && candidate.result != null ? String(candidate.result) : ""}\n${chain.map(opSearchText).join(" › ")}`;
}

function bruteText(result) {
  return [result && result.output, result && result.id, result && result.name].filter((v) => v != null).join("\n");
}

function matchText(text, query, caseSensitive) {
  if (!query) return true;
  return caseSensitive
    ? String(text).includes(query)
    : String(text).toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

/** 纯函数入口：按正文和链路元数据筛选 magic 候选，保序且不改对象。 */
export function filterMagicCandidates(candidates, query = "", caseSensitive = false) {
  if (!Array.isArray(candidates) || !query) return candidates;
  return candidates.filter((candidate) => matchText(magicText(candidate), query, caseSensitive));
}

/** 纯函数入口：筛选独立爆破结果，保序且不改输出。 */
export function filterBruteResults(results, query = "", caseSensitive = false) {
  if (!Array.isArray(results) || !query) return results;
  return results.filter((result) => matchText(bruteText(result), query, caseSensitive));
}

/** 读取容器状态并筛选 magic 候选。 */
export function filterMagicCands(wrap, candidates) {
  const state = stateByWrap.get(wrap);
  return filterMagicCandidates(candidates, state && state.query, !!(state && state.caseSensitive));
}

/** 读取容器状态并筛选独立爆破结果。 */
export function filterBruteCands(wrap, results) {
  const state = stateByWrap.get(wrap);
  return filterBruteResults(results, state && state.query, !!(state && state.caseSensitive));
}

/** 新一轮解码：清空查询/大小写状态并暂时移走工具条，等首批结果再挂回。 */
export function magicFilterReset(wrap) {
  const state = stateByWrap.get(wrap);
  if (!state) return;
  state.query = "";
  state.caseSensitive = false;
  if (state.input) state.input.value = "";
  if (state.caseBox) state.caseBox.checked = false;
  if (state.none && state.none.isConnected) state.none.remove();
  if (state.bar && state.bar.isConnected) state.bar.remove();
}

let styleInjected = false;
function ensureStyles() {
  if (styleInjected || typeof document === "undefined") return;
  const style = document.createElement("style");
  style.textContent = `
.rf-bar { display:flex; align-items:center; gap:var(--sp-2); flex-wrap:wrap; margin:0 0 var(--sp-1) 0;
  padding:var(--sp-2) var(--sp-3); background:var(--surface-1); border:1px solid var(--outline-var); border-radius:var(--r-sm); }
.rf-input { flex:1 1 160px; min-width:0; max-width:320px; padding:var(--sp-1) var(--sp-2); font-size:var(--fs-sm);
  border:1px solid var(--outline-var); border-radius:var(--r-sm); background:transparent; color:inherit; outline:none; }
.rf-input:focus { border-color:var(--primary); }
.rf-case { display:inline-flex; align-items:center; gap:4px; font-size:var(--fs-xs); color:var(--on-surface-var);
  cursor:pointer; user-select:none; border:1px solid var(--outline-var); border-radius:var(--r-sm); padding:2px var(--sp-2); }
.rf-case input { margin:0; accent-color:var(--primary); }
.rf-count { font-size:var(--fs-xs); color:var(--on-surface-var); white-space:nowrap; }
.rf-count.rf-zero { color:var(--error, #b3261e); }
.rf-clear, .rf-collapse { border:none; background:transparent; color:var(--primary); font-size:var(--fs-xs);
  cursor:pointer; padding:2px var(--sp-1); border-radius:var(--r-sm); }
.rf-collapse { color:var(--on-surface-var); }
.rf-clear:hover, .rf-collapse:hover { background:var(--surface-2, transparent); }
.rf-none { color:var(--on-surface-var); text-align:center; padding:var(--sp-4); }
.rf-bar.rf-collapsed .rf-input, .rf-bar.rf-collapsed .rf-case, .rf-bar.rf-collapsed .rf-clear { display:none; }
@media (pointer: coarse), (max-width: 600px) { .rf-input, .rf-case, .rf-clear, .rf-collapse { min-height:44px; } }
@media (max-width: 600px) { .rf-input { flex-basis:100%; max-width:none; } .rf-bar { align-items:stretch; } }`;
  document.head.append(style);
  styleInjected = true;
}

/**
 * 创建或刷新工具条。工具条是 wrap 的前置兄弟，不受 wrap.innerHTML 清空影响。
 * matched/total 按候选级计数，不按合并后的 DOM 卡片数计数。
 */
export function magicFilterBar(wrap, matched, total) {
  ensureStyles();
  let state = stateByWrap.get(wrap);
  if (!state) {
    state = {
      query: "", caseSensitive: false, collapsed: false,
      bar: null, input: null, caseBox: null, count: null, collapse: null, none: null,
    };
    stateByWrap.set(wrap, state);
  }

  if (!state.bar) {
    const bar = document.createElement("div");
    bar.className = "rf-bar";
    bar.setAttribute("role", "search");

    const input = document.createElement("input");
    input.className = "rf-input";
    input.type = "search";
    input.maxLength = MAX_QUERY;
    input.placeholder = tt("ui.rf.ph");
    input.setAttribute("aria-label", tt("ui.rf.ph"));

    const caseLabel = document.createElement("label");
    caseLabel.className = "rf-case";
    caseLabel.title = tt("ui.rf.case");
    const caseBox = document.createElement("input");
    caseBox.type = "checkbox";
    caseBox.setAttribute("aria-label", tt("ui.rf.case"));
    const caseText = document.createElement("span");
    caseText.textContent = "Aa";
    caseLabel.append(caseBox, caseText);

    const count = document.createElement("span");
    count.className = "rf-count";
    count.setAttribute("aria-live", "polite");

    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "rf-clear";
    clear.textContent = tt("ui.rf.clear");

    const collapse = document.createElement("button");
    collapse.type = "button";
    collapse.className = "rf-collapse";

    let composing = false;
    const rerender = () => {
      if (typeof wrap.__rf_rerender === "function") wrap.__rf_rerender();
    };
    input.addEventListener("compositionstart", () => { composing = true; });
    input.addEventListener("input", () => {
      state.query = input.value.slice(0, MAX_QUERY);
      if (input.value !== state.query) input.value = state.query;
      if (!composing) rerender();
    });
    input.addEventListener("compositionend", () => {
      composing = false;
      state.query = input.value.slice(0, MAX_QUERY);
      rerender();
    });
    caseBox.addEventListener("change", () => {
      state.caseSensitive = caseBox.checked;
      rerender();
    });
    clear.addEventListener("click", () => {
      state.query = "";
      state.caseSensitive = false;
      input.value = "";
      caseBox.checked = false;
      rerender();
      input.focus();
    });
    collapse.addEventListener("click", () => {
      state.collapsed = !state.collapsed;
      refreshState();
    });

    bar.append(input, caseLabel, count, clear, collapse);
    Object.assign(state, { bar, input, caseBox, count, collapse });
  }

  function refreshState() {
    state.input.value = state.query;
    state.caseBox.checked = state.caseSensitive;
    state.count.textContent = tt("ui.rf.count", matched, total);
    state.count.classList.toggle("rf-zero", !!state.query && matched === 0);
    state.bar.classList.toggle("rf-collapsed", state.collapsed);
    state.collapse.textContent = state.collapsed ? "▸" : "▾";
    const title = state.collapsed ? tt("ui.rf.expand") : tt("ui.rf.collapse");
    state.collapse.title = title;
    state.collapse.setAttribute("aria-label", title);
    state.collapse.setAttribute("aria-expanded", String(!state.collapsed));
  }
  refreshState();

  // 已在正确位置时绝不重复 insertBefore；重复移动当前聚焦节点会把焦点打回 body。
  if (wrap.parentElement && (state.bar.parentNode !== wrap.parentElement || state.bar.nextSibling !== wrap)) {
    wrap.parentElement.insertBefore(state.bar, wrap);
  }

  if (state.query && matched === 0) {
    if (!state.none) {
      state.none = document.createElement("div");
      state.none.className = "rf-none";
      state.none.textContent = tt("ui.rf.none");
    }
    wrap.append(state.none);
  } else if (state.none && state.none.isConnected) {
    state.none.remove();
  }
  return state.bar;
}
