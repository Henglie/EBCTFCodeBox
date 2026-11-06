import { CATEGORIES, FAMILY_NAMES, opsByCat } from "../core/registry.js";
import { t, getLocale } from "../i18n/index.js";
import { icon } from "./icons.js";
import { eduContentReady, eduAliasesSync } from "../core/eduContent.defer.js";
import { synonymsOf } from "./searchSynonyms.js";

const HIDDEN_OP_IDS = new Set(["cryptoTryAll"]);
const CARD_CHUNK = 160;

const _collapsed = new Set();
const _searchCollapsed = new Set();
let _query = "";
let _activeRefresh = null;

function isZh() {
  return String(getLocale() || "zh").toLowerCase().startsWith("zh");
}

function lt(key, zh, en) {
  const v = t(key);
  return v === key ? (isZh() ? zh : en) : v;
}

function fmt(template, ...args) {
  return String(template).replace(/\{(\d+)\}/g, (m, n) => {
    const v = args[Number(n)];
    return v === undefined ? m : v;
  });
}

function norm(value) {
  const s = String(value == null ? "" : value);
  try { return s.normalize("NFKC").toLowerCase(); } catch { return s.toLowerCase(); }
}

function nameOf(op) {
  const k = "op." + op.id + ".name";
  const v = t(k);
  return v === k ? (op.name || op.id) : v;
}

function descOf(op) {
  const k = "op." + op.id + ".desc";
  const v = t(k);
  if (v !== k) return v;
  return op.desc || "";
}

function catNameOf(cat) {
  const k = "cat." + cat.id;
  const v = t(k);
  return v === k ? (cat.name || cat.id) : v;
}

function familyNameOf(op) {
  if (!op.family) return "";
  return FAMILY_NAMES[op.family] || op.family;
}

function familyLabelOf(op) {
  if (!op.familyLabel) return "";
  const k = "fam.lbl." + op.familyLabel;
  const v = t(k);
  return v === k ? op.familyLabel : v;
}

function isVisibleOp(op) {
  if (!op || !op.id || op.cat === "home") return false;
  if (HIDDEN_OP_IDS.has(op.id) || op.__virtual || op.virtual) return false;
  return true;
}

function makeIcon(name, cls) {
  const span = document.createElement("span");
  span.className = "msym" + (cls ? " " + cls : "");
  span.setAttribute("aria-hidden", "true");
  span.innerHTML = icon(name);
  return span;
}

function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function buildGroups() {
  const aliases = eduAliasesSync() || {};
  const groups = [];
  for (const cat of CATEGORIES) {
    if (cat.id === "home") continue;
    const catName = catNameOf(cat);
    const rows = [];
    for (const op of opsByCat(cat.id)) {
      if (!isVisibleOp(op)) continue;
      const name = nameOf(op);
      const desc = descOf(op);
      const aka = Array.isArray(aliases[op.id]) ? aliases[op.id] : [];
      const famName = familyNameOf(op);
      const famLabel = familyLabelOf(op);
      const hay = norm([
        name,
        op.id,
        desc,
        op.cat,
        catName,
        famName,
        famLabel,
        ...aka,
      ].join("\u0001"));
      rows.push({ op, name, desc, catName, famName, famLabel, hay });
    }
    if (rows.length) groups.push({ id: cat.id, name: catName, rows });
  }
  return groups;
}

function filterGroups(groups, query) {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return groups;
  const alts = terms.map((term) => {
    const list = synonymsOf(term);
    return Array.isArray(list) && list.length ? list : [term];
  });
  const out = [];
  for (const group of groups) {
    const rows = group.rows.filter((row) => alts.every((list) => list.some((term) => row.hay.includes(term))));
    if (rows.length) out.push({ ...group, rows });
  }
  return out;
}

function countRows(groups) {
  let total = 0;
  for (const group of groups) total += group.rows.length;
  return total;
}

function makeCard(row) {
  const op = row.op;
  const card = el("a", {
    class: "allops-card",
    href: "#/op/" + op.id,
    title: row.desc || row.name,
    "data-opid": op.id,
  });
  card.setAttribute("aria-label", row.name + " · " + op.id);

  const head = el("div", { class: "allops-card-head" },
    el("span", { class: "allops-card-name", text: row.name }),
  );
  if (op.requiresBridge) {
    head.append(el("span", { class: "allops-badge allops-badge-exe", text: "EXE" }));
  }
  if (op.family) {
    const fam = el("span", {
      class: "allops-badge allops-badge-family",
      text: lt("ui.allops.family", "族", "Family") + " · " + row.famName,
      title: row.famLabel ? row.famName + " · " + row.famLabel : row.famName,
    });
    head.append(fam);
  }
  card.append(head);

  card.append(el("div", { class: "allops-card-id", text: op.id }));

  if (row.desc) {
    card.append(el("div", { class: "allops-card-desc", text: row.desc }));
  }

  card.append(el("div", { class: "allops-card-meta" },
    el("span", { class: "allops-card-cat", text: row.catName }),
    row.famLabel ? el("span", { class: "allops-card-famlbl", text: row.famLabel }) : null,
  ));

  return card;
}

export function renderAllOpsView(host, options = {}) {
  if (!host) return;
  host.scrollTop = 0;

  const title = lt("ui.allops.title", "全部算法", "All Operations");
  const subtitle = lt(
    "ui.allops.subtitle",
    "按原分类平铺全部算法；点击卡片进入算法页，可搜索名称、ID、描述、分类或别名。",
    "Every operation grouped by its original category. Open a card to use it; search by name, ID, description, category or alias.",
  );
  const placeholder = lt(
    "ui.allops.searchPlaceholder",
    "搜索名称 / ID / 描述 / 分类 / 别名",
    "Search name / ID / description / category / alias",
  );
  const clearText = lt("ui.allops.clear", "清空", "Clear");
  const emptyTitle = lt("ui.allops.empty", "没有匹配的算法", "No matching operations");
  const emptyHint = lt(
    "ui.allops.emptyHint",
    "试试算法名、opId、描述或分类关键词，或点「清空」查看全部。",
    "Try a name, opId, description or category keyword, or clear the search to see everything.",
  );
  const collapseLabel = lt("ui.allops.collapse", "折叠分类", "Collapse category");
  const expandLabel = lt("ui.allops.expand", "展开分类", "Expand category");
  const countTemplateRaw = lt("ui.allops.count", "显示 {0} / {1} 个算法", "{0} / {1} operations");
  // 旧 i18n 文案只有 {0}（匹配数），缺 {1}（总数）；补成 “匹配 / 总数” 形式，
  // 既保留各语言译文，又让计数能反映全量规模。
  const countTemplate = !countTemplateRaw.includes("{1}") && countTemplateRaw.includes("{0}")
    ? countTemplateRaw.replace("{0}", "{0} / {1}")
    : countTemplateRaw;
  const searchLabel = lt("ui.allops.search", "搜索全部算法", "Search all operations");

  let cachedGroups = null;
  const getGroups = () => {
    if (!cachedGroups) cachedGroups = buildGroups();
    return cachedGroups;
  };

  const page = el("div", { class: "allops-page" });
  const head = el("div", { class: "allops-head" });
  head.append(el("div", { class: "allops-heading" },
    el("h1", { class: "allops-title", text: title }),
    el("p", { class: "allops-subtitle", text: subtitle }),
  ));

  const searchWrap = el("div", { class: "allops-search-wrap" });
  const search = el("div", { class: "allops-search" },
    makeIcon("search", "allops-search-icon"),
  );
  const input = el("input", {
    class: "allops-search-input",
    type: "search",
    placeholder,
    spellcheck: "false",
    autocomplete: "off",
    "aria-label": searchLabel,
    enterkeyhint: "search",
  });
  input.value = _query;
  const clearButton = el("button", {
    class: "allops-clear",
    type: "button",
    "aria-label": clearText,
    title: clearText,
  }, clearText);
  search.append(input, clearButton);

  const count = el("div", { class: "allops-count", "aria-live": "polite" });
  searchWrap.append(search, count);
  head.append(searchWrap);
  page.append(head);

  const body = el("div", { class: "allops-body" });
  page.append(body);
  host.append(page);

  const refreshCount = (matched, total) => {
    count.textContent = fmt(countTemplate, matched, total);
  };

  const applyFilter = (rawQuery) => {
    _query = String(rawQuery || "");
    _searchCollapsed.clear();

    const allGroups = getGroups();
    const query = _query.trim();
    const groups = query ? filterGroups(allGroups, query) : allGroups;
    const total = countRows(allGroups);
    const matched = countRows(groups);

    refreshCount(matched, total);
    clearButton.disabled = !query;
    body.innerHTML = "";

    if (!groups.length) {
      body.append(el("div", { class: "allops-empty", role: "status" },
        makeIcon("search", "allops-empty-icon"),
        el("div", { class: "allops-empty-title", text: emptyTitle }),
        el("div", { class: "allops-empty-hint", text: emptyHint }),
      ));
      return;
    }

    const fragment = document.createDocumentFragment();
    const queue = [];
    let index = 0;

    for (const group of groups) {
      const section = el("section", { class: "allops-section", "data-cat": group.id });
      const grid = el("div", { class: "allops-grid", role: "list" });
      const gridId = "allops-grid-" + (index++);
      grid.id = gridId;

      const collapsed = query ? _searchCollapsed.has(group.id) : _collapsed.has(group.id);
      if (collapsed) section.classList.add("is-collapsed");
      grid.hidden = collapsed;

      const header = el("button", {
        class: "allops-section-head",
        type: "button",
        "aria-expanded": String(!collapsed),
        "aria-controls": gridId,
      },
        makeIcon(collapsed ? "chevron_right" : "expand_more", "allops-caret"),
        el("span", { class: "allops-section-name", text: group.name }),
        el("span", { class: "allops-section-count", text: String(group.rows.length) }),
      );

      header.addEventListener("click", () => {
        const next = !section.classList.contains("is-collapsed");
        section.classList.toggle("is-collapsed", next);
        grid.hidden = next;
        header.setAttribute("aria-expanded", String(!next));
        header.setAttribute("aria-label", (next ? expandLabel : collapseLabel) + " · " + group.name);
        const caret = header.querySelector(".allops-caret");
        if (caret) caret.innerHTML = icon(next ? "chevron_right" : "expand_more");
        if (query) _searchCollapsed.add(group.id);
        else if (next) _collapsed.add(group.id);
        else _collapsed.delete(group.id);
      });
      header.setAttribute("aria-label", (collapsed ? expandLabel : collapseLabel) + " · " + group.name);

      section.append(header, grid);
      fragment.append(section);
      queue.push({ grid, rows: group.rows });
    }
    body.append(fragment);

    let queueIndex = 0;
    let rowIndex = 0;
    let cancelled = false;
    const token = {};
    applyFilter._token = token;

    const step = () => {
      if (cancelled || applyFilter._token !== token || !host.isConnected) return;
      let budget = CARD_CHUNK;
      while (queueIndex < queue.length && budget > 0) {
        const item = queue[queueIndex];
        const chunk = document.createDocumentFragment();
        while (rowIndex < item.rows.length && budget > 0) {
          chunk.append(makeCard(item.rows[rowIndex++]));
          budget--;
        }
        item.grid.append(chunk);
        if (rowIndex >= item.rows.length) {
          queueIndex++;
          rowIndex = 0;
        }
      }
      if (queueIndex < queue.length) requestAnimationFrame(step);
    };

    if (typeof requestAnimationFrame === "function") requestAnimationFrame(step);
    else step();
    applyFilter._cancel = () => {
      const pending = queueIndex < queue.length;
      cancelled = true;
      return pending;
    };
  };

  const onSearch = () => applyFilter(input.value);
  input.addEventListener("input", onSearch);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (input.value) {
        event.preventDefault();
        input.value = "";
        applyFilter("");
      } else {
        input.blur();
      }
    }
  });
  clearButton.addEventListener("click", () => {
    input.value = "";
    applyFilter("");
    input.focus();
  });

  const refresh = () => {
    if (!host.isConnected) return;
    const pending = typeof applyFilter._cancel === "function" ? applyFilter._cancel() : false;
    cachedGroups = null;
    // 空搜索框不因科普数据到达而整页重建；但若上一轮分帧渲染尚未完成，
    // 取消后必须重启，否则卡片会停在半截（计数与 DOM 不一致）。
    if (input.value || pending) applyFilter(input.value);
  };
  _activeRefresh = refresh;
  eduContentReady().then(() => {
    if (_activeRefresh === refresh && host.isConnected) refresh();
  });

  applyFilter(_query);
}
