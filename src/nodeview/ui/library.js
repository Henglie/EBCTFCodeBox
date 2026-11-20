/*
 * library.js — T953 节点库候选（分类树 + 同源搜索 + 键盘操作 + 端口类型过滤）。
 *
 * 合同（MT809）：
 *   - 按现用分类树列出全部已注册算法（CATEGORIES 顺序，空分类不出现）；
 *   - 搜索与全站搜索同源：直接调用 core.js 的 searchOps（索引字段/打分与 main.js 一致，
 *     拼音表与别名表都来自产品模块），中文、拼音首字母、英文、别名四路命中；
 *   - ↑↓ 移动、Enter 添加节点、Esc 关闭；
 *   - 拖线到空白处调用 setPortFilter('text'|'bytes')：只列出能接该端口类型的算法。
 *
 * DOM 契约（check.mjs 依赖）：
 *   [data-nv="library"] / lib-search / lib-count / lib-compat / lib-compat-note /
 *   lib-compat-clear / lib-cat[data-cat] / lib-cat-toggle / lib-item[data-op-id] / lib-empty
 */

import {
  tNv, categoriesWithOps, opNameOf, opDescOf, searchOps, acceptsWire, portTypeLabel, PORT_TYPE,
} from "../core.js";

const FILTERABLE = new Set([PORT_TYPE.TEXT, PORT_TYPE.BYTES]);

export function createLibrary({ onAdd, portFilter = null, query = "" } = {}) {
  const state = {
    query: String(query || ""),
    filter: FILTERABLE.has(portFilter) ? portFilter : null,
    active: -1,
    collapsed: new Set(),
    items: [], // 当前可见 op 列表（DOM 顺序）
  };

  const root = document.createElement("section");
  root.className = "nv-library";
  root.dataset.nv = "library";

  const head = document.createElement("header");
  head.className = "nv-lib-head";
  const title = document.createElement("h3");
  title.dataset.nv = "lib-title";
  title.textContent = tNv("nv.lib.title");
  const count = document.createElement("span");
  count.className = "nv-count";
  count.dataset.nv = "lib-count";
  head.append(title, count);

  const search = document.createElement("input");
  search.type = "search";
  search.className = "nv-lib-search";
  search.dataset.nv = "lib-search";
  search.placeholder = tNv("nv.lib.searchPlaceholder");
  search.setAttribute("aria-label", tNv("nv.lib.searchPlaceholder"));
  search.setAttribute("role", "combobox");
  search.setAttribute("aria-expanded", "true");
  search.autocomplete = "off";
  search.spellcheck = false;

  const compat = document.createElement("div");
  compat.className = "nv-lib-compat";
  compat.dataset.nv = "lib-compat";
  compat.hidden = true;
  const compatNote = document.createElement("span");
  compatNote.dataset.nv = "lib-compat-note";
  const compatClear = document.createElement("button");
  compatClear.type = "button";
  compatClear.className = "nv-link-btn";
  compatClear.dataset.nv = "lib-compat-clear";
  compatClear.textContent = tNv("nv.lib.compatClear");
  compat.append(compatNote, compatClear);

  const body = document.createElement("div");
  body.className = "nv-lib-body";
  body.dataset.nv = "lib-body";
  body.setAttribute("role", "listbox");

  const foot = document.createElement("footer");
  foot.className = "nv-lib-hint";
  foot.dataset.nv = "lib-hint";
  foot.textContent = tNv("nv.lib.hint");

  root.append(head, search, compat, body, foot);

  /* ---------------- 渲染 ---------------- */

  function visibleOps() {
    return categoriesWithOps().flatMap((c) => c.ops).filter((op) => !state.filter || acceptsWire(op, state.filter));
  }

  function itemButton(op) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "nv-lib-item";
    b.dataset.nv = "lib-item";
    b.dataset.opId = op.id;
    b.dataset.cat = op.cat;
    b.setAttribute("role", "option");
    b.setAttribute("aria-selected", "false");
    b.tabIndex = -1;
    const nm = document.createElement("span");
    nm.className = "nv-lib-item-name";
    nm.dataset.nv = "lib-item-name";
    nm.textContent = opNameOf(op);
    const id = document.createElement("code");
    id.textContent = op.id;
    b.append(nm, id);
    const d = opDescOf(op);
    if (d) b.title = d;
    b.addEventListener("click", () => add(op, "click"));
    return b;
  }

  function render() {
    // 静态文案每次重绘都重取，语言切换后无需重建组件
    title.textContent = tNv("nv.lib.title");
    search.placeholder = tNv("nv.lib.searchPlaceholder");
    search.setAttribute("aria-label", tNv("nv.lib.searchPlaceholder"));
    compatClear.textContent = tNv("nv.lib.compatClear");
    foot.textContent = tNv("nv.lib.hint");
    const all = visibleOps();
    state.items = all;
    state.active = -1;
    body.textContent = "";
    count.textContent = tNv("nv.lib.count", all.length);

    // 端口过滤条
    if (state.filter) {
      compat.hidden = false;
      compatNote.textContent =
        tNv("nv.lib.compatOnly", portTypeLabel(state.filter)) + " · " + tNv("nv.lib.compatCount", all.length);
    } else {
      compat.hidden = true;
      compatNote.textContent = "";
    }

    // 搜索态：扁平结果（高分在前）；浏览态：分类树
    let shown;
    if (state.query.trim()) {
      const hits = searchOps(state.query);
      shown = hits.map((h) => all.find((op) => op.id === h.id)).filter(Boolean);
      const wrap = document.createElement("div");
      wrap.className = "nv-lib-results";
      wrap.dataset.nv = "lib-results";
      const head2 = document.createElement("div");
      head2.className = "nv-lib-results-head";
      head2.textContent = tNv("nv.lib.resultCount", shown.length);
      wrap.append(head2);
      for (const op of shown) wrap.append(itemButton(op));
      body.append(wrap);
    } else {
      shown = all;
      for (const cat of categoriesWithOps()) {
        const ops = cat.ops.filter((op) => !state.filter || acceptsWire(op, state.filter));
        if (!ops.length) continue;
        const sec = document.createElement("section");
        sec.className = "nv-lib-cat";
        sec.dataset.nv = "lib-cat";
        sec.dataset.cat = cat.id;
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "nv-lib-cat-toggle";
        toggle.dataset.nv = "lib-cat-toggle";
        const open = !state.collapsed.has(cat.id);
        toggle.setAttribute("aria-expanded", String(open));
        toggle.title = open ? tNv("nv.lib.collapse") : tNv("nv.lib.expand");
        const cn = document.createElement("span");
        cn.textContent = cat.name;
        const cc = document.createElement("span");
        cc.className = "nv-lib-cat-count";
        cc.dataset.nv = "lib-cat-count";
        cc.textContent = tNv("nv.lib.catCount", ops.length);
        toggle.append(cn, cc);
        const list = document.createElement("div");
        list.className = "nv-lib-cat-items";
        list.hidden = !open;
        toggle.addEventListener("click", () => {
          if (state.collapsed.has(cat.id)) state.collapsed.delete(cat.id);
          else state.collapsed.add(cat.id);
          render();
        });
        for (const op of ops) list.append(itemButton(op));
        sec.append(toggle, list);
        body.append(sec);
      }
    }

    if (!state.items.length || !shown.length) {
      const empty = document.createElement("div");
      empty.className = "nv-lib-empty";
      empty.dataset.nv = "lib-empty";
      empty.textContent = tNv("nv.lib.empty") + " · " + tNv("nv.lib.emptyHint");
      body.append(empty);
    }
    refreshActive();
  }

  function domButtons() {
    return Array.from(body.querySelectorAll('[data-nv="lib-item"]'));
  }

  function refreshActive() {
    const btns = domButtons();
    btns.forEach((b, i) => {
      const on = i === state.active;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", String(on));
    });
    const cur = btns[state.active];
    if (cur) {
      search.setAttribute("aria-activedescendant", idOf(cur));
      cur.scrollIntoView({ block: "nearest" });
    } else {
      search.removeAttribute("aria-activedescendant");
    }
  }

  let seq = 0;
  const ids = new WeakMap();
  function idOf(el) {
    if (!ids.has(el)) { ids.set(el, "nv-lib-opt-" + (++seq)); el.id = ids.get(el); }
    return ids.get(el);
  }

  function add(op, via) {
    if (!op) return;
    const act = onAdd && onAdd(op, { via, portFilter: state.filter });
    root.dispatchEvent(new CustomEvent("nv-add", { bubbles: true, detail: { opId: op.id, via, portFilter: state.filter } }));
    return act;
  }

  /* ---------------- 键盘 ---------------- */

  search.addEventListener("keydown", (e) => {
    const btns = domButtons();
    if (!btns.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      state.active = state.active < 0 ? 0 : Math.min(btns.length - 1, state.active + 1);
      refreshActive();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      state.active = state.active <= 0 ? 0 : state.active - 1;
      refreshActive();
    } else if (e.key === "Home") {
      e.preventDefault(); state.active = 0; refreshActive();
    } else if (e.key === "End") {
      e.preventDefault(); state.active = btns.length - 1; refreshActive();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const btn = btns[state.active];
      if (btn) add(state.items.find((o) => o.id === btn.dataset.opId), "keyboard");
    } else if (e.key === "Escape") {
      e.preventDefault();
      root.dispatchEvent(new CustomEvent("nv-close", { bubbles: true }));
    }
  });

  let timer = null;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.query = search.value;
      render();
    }, 60);
  });

  compatClear.addEventListener("click", () => {
    state.filter = null;
    render();
    root.dispatchEvent(new CustomEvent("nv-filter-clear", { bubbles: true }));
  });

  const api = {
    el: root,
    /** 设置查询串（同步渲染，测试与外部命令用）。 */
    setQuery(q) {
      state.query = String(q == null ? "" : q);
      search.value = state.query;
      render();
      return api;
    },
    getQuery() { return state.query; },
    /** 端口类型过滤：null 清除；'text'/'bytes' 仅留可接该类型的算法。 */
    setPortFilter(type) {
      state.filter = FILTERABLE.has(type) ? type : null;
      render();
      return api;
    },
    getPortFilter() { return state.filter; },
    /** 当前可见算法 id（DOM 顺序）。 */
    visibleIds() {
      return domButtons().map((b) => b.dataset.opId);
    },
    /** 当前高亮的算法 id（无则 null）。 */
    activeId() {
      const b = domButtons()[state.active];
      return b ? b.dataset.opId : null;
    },
    /** 键盘导航（供测试/宿主快捷键调用）。 */
    move(delta) {
      const btns = domButtons();
      if (!btns.length) return null;
      state.active = state.active < 0
        ? (delta > 0 ? 0 : btns.length - 1)
        : Math.max(0, Math.min(btns.length - 1, state.active + delta));
      refreshActive();
      return api.activeId();
    },
    /** 回车动作（等同键盘 Enter）。 */
    activate() {
      const b = domButtons()[state.active];
      if (!b) return null;
      const op = state.items.find((o) => o.id === b.dataset.opId);
      add(op, "api");
      return op ? op.id : null;
    },
    focus() { search.focus(); },
    searchInput: search,
    rerender: render,
  };

  render();
  return api;
}
