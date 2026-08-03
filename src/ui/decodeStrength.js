/*
 * decodeStrength.js — 「解码强度」弹窗（首页一键解码的强度滑块 + 参与算法多选）。
 *
 * 替代原先首页工具栏的两个裸开关（深度爆破 / 多层链式）：
 * - 顶部滑块：5 档预设（快速→最强），按 CTF 考点从热门到冷门逐层放开，标注耗时承诺。
 * - 下方多选：全部可自动解码的 op 按分类折叠列出，可搜索、可整类勾选。
 * - 文本 / 文件双页签：两套配置各存各的（同一弹窗内切换）。
 * - 命名方案：可存多套、可删、可导入导出 JSON。
 *
 * 防卡死（538 op 的列表）：
 * - 分类默认折叠，只渲染标题行；展开某类才建该类的 checkbox（按需渲染）。
 * - 列表容器固定高度 + overflow:auto（滑动条），不撑爆弹窗。
 * - 搜索走 200ms 防抖，且只在已展开的类里重建 DOM。
 * - 勾选状态存 Set，不重渲染整表（只改单个 checkbox 的 checked）。
 *
 * 分层与持久化逻辑全在 core/decodeProfile.js（纯逻辑，本模块只管渲染 + 事件）。
 *
 * 红线：ui 层平级 import（core/decodeProfile + ui/icons），不反向 import main.js；
 * i18n 经 window.__ebctfT 取（与 envPanel.js 同一范式），缺失回退内置中文。
 */
import {
  STRENGTH_LEVELS,
  STRENGTH_PRESETS,
  opPoolByCat,
  opsForLevel,
  listProfiles,
  loadProfile,
  saveProfile,
  deleteProfile,
  exportProfiles,
  importProfiles,
  listBruteOps,
  isBruteOp,
} from "../core/decodeProfile.js";
import { icon as iconSvg } from "./icons.js";

// ---- 轻量 DOM 工具（与 envPanel.js 同形；注意 false 不当属性写，防 disabled="false" 坑）----
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}
function msym(name, cls = "") {
  const s = el("span", { class: "msym" + (cls ? " " + cls : "") });
  s.innerHTML = iconSvg(name);
  return s;
}

// ---- i18n：优先主表，回退内置中文 ----
const _ZH = {
  "ui.ds.title": "解码强度",
  "ui.ds.note": "强度越高，参与的算法越多、耗时越长。按 CTF 考点热度从高到低逐层放开。",
  "ui.ds.tabText": "文本",
  "ui.ds.tabFile": "文件",
  "ui.ds.level.fast": "快速",
  "ui.ds.level.normal": "默认",
  "ui.ds.level.enhanced": "增强",
  "ui.ds.level.extreme": "极强",
  "ui.ds.level.max": "最强",
  "ui.ds.level.custom": "自定义",
  "ui.ds.hint.fast": "秒解 · 只试最高频考点",
  "ui.ds.hint.normal": "5 秒内 · 常见考点 + 参数扫描",
  "ui.ds.hint.enhanced": "约 12 秒 · 加花式编码，2 层链式",
  "ui.ds.hint.extreme": "约 25 秒 · 加冷门/需密钥算法，3 层 + 暴力",
  "ui.ds.hint.max": "不限时 · 全部算法 + 穷举全解",
  "ui.ds.hint.custom": "由你勾选参与的算法",
  "ui.ds.opsCount": "参与算法 {0} / {1}",
  "ui.ds.search": "搜索算法名 / id…",
  "ui.ds.selectAll": "全选",
  "ui.ds.selectNone": "全不选",
  "ui.ds.resetLevel": "按当前档重置勾选",
  "ui.ds.profiles": "我的方案",
  "ui.ds.profileName": "方案名",
  "ui.ds.save": "保存",
  "ui.ds.del": "删除",
  "ui.ds.load": "载入",
  "ui.ds.export": "导出",
  "ui.ds.import": "导入",
  "ui.ds.importPrompt": "粘贴方案 JSON：",
  "ui.ds.imported": "已导入 {0} 个方案",
  "ui.ds.importFail": "导入失败：JSON 格式不对",
  "ui.ds.exported": "已复制方案 JSON 到剪贴板",
  "ui.ds.noProfile": "还没存过方案",
  "ui.ds.apply": "应用",
  "ui.ds.cancel": "取消",
  "ui.ds.close": "关闭",
  "ui.ds.catAll": "整类",
  "ui.ds.tier": "热度档",
  "ui.ds.customBadge": "已改动（自定义）",
};
function t(key, ...args) {
  let s = key;
  const fn = typeof window !== "undefined" && window.__ebctfT;
  if (typeof fn === "function") {
    const v = fn(key);
    if (v && v !== key) s = v;
  }
  if (s === key && _ZH[key]) s = _ZH[key];
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[i] != null ? args[i] : m)) : s;
}

// 分类显示名（走 i18n cat.*，回退 core 里的中文名）
function catLabel(catId, fallback) {
  const v = t("cat." + catId);
  return v && v !== "cat." + catId ? v : fallback;
}

// ============================================================
// 弹窗状态
// ============================================================
let _overlay = null;
let _keyHandler = null;
let _debounce = null;

/**
 * 打开解码强度弹窗。
 * @param {object} opt
 *   cfg      当前配置 { text:{level,customIds}, file:{level,customIds} }
 *   onApply  (cfg) => void  点「应用」回调，传回两套作用域的完整配置
 */
export function openDecodeStrength(opt = {}) {
  closeDecodeStrength();

  // 工作副本：合并文本+文件为统一配置。改动只在此弹窗内，点「应用」才回传。
  const src = (opt.cfg && opt.cfg.text) || {};
  const level = src.level || "normal";
  const ids = Array.isArray(src.customIds) && src.customIds.length
    ? new Set(src.customIds)
    : opsForLevel(level === "custom" ? "enhanced" : level, "text");
  const work = {
    level,
    ids,
    depth: Math.max(1, Math.min(3, Number(src.depth) || (STRENGTH_PRESETS[level] ? STRENGTH_PRESETS[level].magic.maxDepth : 1))),
    bruteIds: new Set(Array.isArray(src.bruteIds) ? src.bruteIds.filter((id) => isBruteOp(id)) : []),
  };

  const dialog = el("div", { class: "ds-dialog", role: "dialog", "aria-modal": "true", "aria-label": t("ui.ds.title") });
  const body = el("div", { class: "ds-body" });

  // ---- 头部 ----
  const closeBtn = el("button", { class: "ds-close", type: "button", "aria-label": t("ui.ds.close") }, msym("close"));
  closeBtn.addEventListener("click", () => closeDecodeStrength());
  dialog.append(el("div", { class: "ds-head" },
    el("div", { class: "ds-titles" },
      el("div", { class: "ds-title" }, msym("bolt"), t("ui.ds.title")),
      el("div", { class: "ds-note" }, t("ui.ds.note")),
    ),
    closeBtn,
  ));
  dialog.append(body);

  // ---- 底部操作 ----
  const applyBtn = el("button", { class: "act-btn primary", type: "button" }, msym("check_circle"), el("span", {}, t("ui.ds.apply")));
  const cancelBtn = el("button", { class: "act-btn", type: "button" }, el("span", {}, t("ui.ds.cancel")));
  applyBtn.addEventListener("click", () => {
    const out = { level: work.level, customIds: [...work.ids], depth: work.depth, bruteIds: [...work.bruteIds] };
    closeDecodeStrength();
    if (typeof opt.onApply === "function") opt.onApply(out);
  });
  cancelBtn.addEventListener("click", () => closeDecodeStrength());
  dialog.append(el("div", { class: "ds-foot" }, cancelBtn, applyBtn));

  // ============================================================
  // 主体渲染
  // ============================================================
  function renderBody() {
    body.innerHTML = "";
    const pool = opPoolByCat("text");
    const total = pool.reduce((n, g) => n + g.ops.length, 0);

    // ---- 强度滑块 ----
    const levelIdx = work.level === "custom" ? STRENGTH_LEVELS.length : STRENGTH_LEVELS.indexOf(work.level);
    const slider = el("input", {
      type: "range", class: "ds-slider",
      min: "0", max: String(STRENGTH_LEVELS.length),   // 末档 = custom
      step: "1", value: String(levelIdx < 0 ? 1 : levelIdx),
      "aria-label": t("ui.ds.title"),
    });
    const levelName = el("div", { class: "ds-level-name" });
    const levelHint = el("div", { class: "ds-level-hint" });
    const countLine = el("div", { class: "ds-count" });

    const ticks = el("div", { class: "ds-ticks" });
    for (const lv of [...STRENGTH_LEVELS, "custom"]) {
      ticks.append(el("span", { class: "ds-tick" }, t("ui.ds.level." + lv)));
    }

    const syncLevelText = () => {
      const lv = work.level;
      levelName.textContent = t("ui.ds.level." + lv);
      levelHint.textContent = t("ui.ds.hint." + lv);
      countLine.textContent = t("ui.ds.opsCount", work.ids.size, total);
    };

    slider.addEventListener("input", () => {
      const i = parseInt(slider.value, 10);
      work.level = i >= STRENGTH_LEVELS.length ? "custom" : STRENGTH_LEVELS[i];
      // 切到具体档 → 勾选同步为该档默认集合；切到 custom → 保留当前勾选
      if (work.level !== "custom") {
        work.ids = opsForLevel(work.level, "text");
        refreshAllChecks();
      }
      syncLevelText();
    });

    body.append(el("div", { class: "ds-sec ds-sec-level" },
      el("div", { class: "ds-slider-row" }, slider),
      ticks,
      el("div", { class: "ds-level-meta" }, levelName, levelHint),
      countLine,
    ));

    // ---- 解析层数（1~3 层链式）----
    const depthRow = el("div", { class: "ds-depth-row" });
    const depthBtns = [];
    for (const d of [1, 2, 3]) {
      const b = el("button", { class: "ds-depth-btn" + (work.depth === d ? " on" : ""), type: "button", "data-depth": String(d) },
        t("ui.ds.depth.n", d));
      b.addEventListener("click", () => {
        work.depth = d;
        for (const x of depthBtns) x.classList.toggle("on", Number(x.dataset.depth) === work.depth);
      });
      depthBtns.push(b);
      depthRow.append(b);
    }
    body.append(el("div", { class: "ds-sec ds-sec-depth" },
      el("div", { class: "ds-sec-title" }, msym("layers"), t("ui.ds.depth.title")),
      el("div", { class: "ds-sec-note" }, t("ui.ds.depth.note")),
      depthRow,
    ));

    // ---- 暴力爆破算法（独立池，勾选后单独归组跑，不进主排序）----
    const bruteList = listBruteOps();
    if (bruteList.length) {
      const bruteGrid = el("div", { class: "ds-brute-grid" });
      const bruteCount = el("span", { class: "ds-brute-count" });
      const syncBruteCount = () => {
        bruteCount.textContent = t("ui.ds.bruteCount", work.bruteIds.size, bruteList.length);
      };
      for (const b of bruteList) {
        const cb = el("input", { type: "checkbox", class: "ds-cb", "data-brute-id": b.id });
        cb.checked = work.bruteIds.has(b.id);
        cb.addEventListener("change", () => {
          if (cb.checked) work.bruteIds.add(b.id); else work.bruteIds.delete(b.id);
          syncBruteCount();
        });
        bruteGrid.append(el("label", { class: "ds-op-row ds-brute-row" },
          cb,
          el("span", { class: "ds-op-name" }, b.name),
          el("span", { class: "ds-op-id" }, b.id),
        ));
      }
      const bruteAll = el("button", { class: "ds-mini", type: "button" }, t("ui.ds.selectAll"));
      const bruteNone = el("button", { class: "ds-mini", type: "button" }, t("ui.ds.selectNone"));
      bruteAll.addEventListener("click", () => {
        for (const b of bruteList) work.bruteIds.add(b.id);
        for (const cb of bruteGrid.querySelectorAll(".ds-cb")) cb.checked = true;
        syncBruteCount();
      });
      bruteNone.addEventListener("click", () => {
        work.bruteIds.clear();
        for (const cb of bruteGrid.querySelectorAll(".ds-cb")) cb.checked = false;
        syncBruteCount();
      });
      syncBruteCount();
      body.append(el("div", { class: "ds-sec ds-sec-brute" },
        el("div", { class: "ds-sec-head" },
          el("div", { class: "ds-sec-title" }, msym("bolt"), t("ui.ds.brute.title")),
          bruteCount,
        ),
        el("div", { class: "ds-sec-note" }, t("ui.ds.brute.note")),
        el("div", { class: "ds-mini-row" }, bruteAll, bruteNone),
        bruteGrid,
      ));
    }

    // ---- 搜索 + 批量 ----
    const search = el("input", { type: "text", class: "ds-search", placeholder: t("ui.ds.search"), spellcheck: "false" });
    const allBtn = el("button", { class: "ds-mini", type: "button" }, t("ui.ds.selectAll"));
    const noneBtn = el("button", { class: "ds-mini", type: "button" }, t("ui.ds.selectNone"));
    const resetBtn = el("button", { class: "ds-mini", type: "button" }, t("ui.ds.resetLevel"));
    body.append(el("div", { class: "ds-sec ds-sec-tools" },
      el("label", { class: "ds-search-wrap" }, msym("search"), search),
      el("div", { class: "ds-mini-row" }, allBtn, noneBtn, resetBtn),
    ));

    // ---- op 列表（分类折叠 + 按需渲染 + 独立滚动条）----
    const list = el("div", { class: "ds-list" });
    body.append(list);

    // catId → { rowsHost, built, opsShown }
    const groups = new Map();

    const markCustom = () => {
      if (work.level !== "custom") {
        work.level = "custom";
        slider.value = String(STRENGTH_LEVELS.length);
        syncLevelText();
      }
      countLine.textContent = t("ui.ds.opsCount", work.ids.size, total);
    };

    function buildRows(g, host, filter) {
      host.innerHTML = "";
      const q = (filter || "").trim().toLowerCase();
      const ops = q
        ? g.ops.filter((o) => o.id.toLowerCase().includes(q) || String(o.name || "").toLowerCase().includes(q))
        : g.ops;
      for (const o of ops) {
        const cb = el("input", { type: "checkbox", class: "ds-cb" });
        cb.checked = work.ids.has(o.id);
        cb.dataset.opId = o.id;
        cb.addEventListener("change", () => {
          if (cb.checked) work.ids.add(o.id); else work.ids.delete(o.id);
          markCustom();
        });
        host.append(el("label", { class: "ds-op-row" },
          cb,
          el("span", { class: "ds-op-name" }, o.name || o.id),
          el("span", { class: "ds-op-id" }, o.id),
          el("span", { class: "ds-op-tier", title: t("ui.ds.tier") }, "T" + o.tier),
        ));
      }
      if (!ops.length) host.append(el("div", { class: "ds-empty" }, "—"));
    }

    for (const g of pool) {
      const rowsHost = el("div", { class: "ds-cat-rows" });
      const countBadge = el("span", { class: "ds-cat-count" });
      const syncBadge = () => {
        const on = g.ops.filter((o) => work.ids.has(o.id)).length;
        countBadge.textContent = on + "/" + g.ops.length;
        countBadge.classList.toggle("partial", on > 0 && on < g.ops.length);
        countBadge.classList.toggle("full", on === g.ops.length && on > 0);
      };
      syncBadge();

      const catCb = el("input", { type: "checkbox", class: "ds-cb ds-cat-cb" });
      catCb.checked = g.ops.every((o) => work.ids.has(o.id));
      catCb.addEventListener("click", (e) => e.stopPropagation());
      catCb.addEventListener("change", () => {
        for (const o of g.ops) { if (catCb.checked) work.ids.add(o.id); else work.ids.delete(o.id); }
        // 已展开的行同步 checked
        for (const cb of rowsHost.querySelectorAll(".ds-cb")) cb.checked = catCb.checked;
        syncBadge();
        markCustom();
      });

      const caret = msym("chevron_right", "ds-caret");
      const head = el("button", { class: "ds-cat-head", type: "button", "aria-expanded": "false" },
        caret,
        el("span", { class: "ds-cat-name" }, catLabel(g.cat, g.catName)),
        countBadge,
      );
      const wrap = el("div", { class: "ds-cat" }, el("div", { class: "ds-cat-headrow" }, catCb, head), rowsHost);
      const state = { built: false, open: false, rowsHost, syncBadge, catCb, g, head, wrap };
      head.addEventListener("click", () => {
        state.open = !state.open;
        wrap.classList.toggle("open", state.open);
        head.setAttribute("aria-expanded", state.open ? "true" : "false");
        if (state.open && !state.built) { buildRows(g, rowsHost, search.value); state.built = true; }
      });
      groups.set(g.cat, state);
      list.append(wrap);
    }

    function refreshAllChecks() {
      for (const st2 of groups.values()) {
        st2.catCb.checked = st2.g.ops.every((o) => work.ids.has(o.id));
        st2.syncBadge();
        if (st2.built) {
          for (const cb of st2.rowsHost.querySelectorAll(".ds-cb")) {
            cb.checked = work.ids.has(cb.dataset.opId);
          }
        }
      }
      countLine.textContent = t("ui.ds.opsCount", work.ids.size, total);
    }

    allBtn.addEventListener("click", () => {
      for (const g of pool) for (const o of g.ops) work.ids.add(o.id);
      refreshAllChecks(); markCustom();
    });
    noneBtn.addEventListener("click", () => {
      work.ids.clear(); refreshAllChecks(); markCustom();
    });
    resetBtn.addEventListener("click", () => {
      const lv = work.level === "custom" ? "normal" : work.level;
      work.ids = opsForLevel(lv, "text");
      work.level = lv;
      slider.value = String(STRENGTH_LEVELS.indexOf(lv));
      refreshAllChecks(); syncLevelText();
    });

    // 搜索：200ms 防抖，只重建已展开的类；有关键词时自动展开命中的类
    search.addEventListener("input", () => {
      clearTimeout(_debounce);
      _debounce = setTimeout(() => {
        const q = search.value.trim().toLowerCase();
        for (const st2 of groups.values()) {
          const hit = !q || st2.g.ops.some((o) =>
            o.id.toLowerCase().includes(q) || String(o.name || "").toLowerCase().includes(q));
          st2.wrap.classList.toggle("hidden", !hit);
          if (q && hit) {
            st2.open = true;
            st2.wrap.classList.add("open");
            st2.head.setAttribute("aria-expanded", "true");
            buildRows(st2.g, st2.rowsHost, q);
            st2.built = true;
          } else if (st2.built) {
            buildRows(st2.g, st2.rowsHost, q);
          }
        }
      }, 200);
    });

    // ---- 我的方案（命名保存 / 载入 / 删除 / 导入导出）----
    const nameInput = el("input", { type: "text", class: "ds-prof-name", placeholder: t("ui.ds.profileName"), spellcheck: "false" });
    const sel = el("select", { class: "ds-prof-sel" });
    const rebuildSel = () => {
      sel.innerHTML = "";
      const names = listProfiles("text");
      if (!names.length) {
        sel.append(el("option", { value: "" }, t("ui.ds.noProfile")));
        sel.disabled = true;
        return;
      }
      sel.disabled = false;
      for (const n of names) sel.append(el("option", { value: n }, n));
    };
    rebuildSel();

    const saveBtn = el("button", { class: "ds-mini", type: "button" }, msym("save"), t("ui.ds.save"));
    const loadBtn = el("button", { class: "ds-mini", type: "button" }, t("ui.ds.load"));
    const delBtn = el("button", { class: "ds-mini danger", type: "button" }, t("ui.ds.del"));
    const expBtn = el("button", { class: "ds-mini", type: "button" }, t("ui.ds.export"));
    const impBtn = el("button", { class: "ds-mini", type: "button" }, t("ui.ds.import"));
    const profMsg = el("div", { class: "ds-prof-msg" });

    saveBtn.addEventListener("click", () => {
      const n = nameInput.value.trim();
      if (!n) { nameInput.focus(); return; }
      saveProfile(n, { level: work.level, customIds: [...work.ids] }, "text");
      nameInput.value = "";
      rebuildSel();
      profMsg.textContent = "✓ " + n;
    });
    loadBtn.addEventListener("click", () => {
      const n = sel.value;
      if (!n) return;
      const p = loadProfile(n, "text");
      if (!p) return;
      work.level = p.level;
      work.ids = new Set(p.customIds);
      renderBody();          // 载入后整体重建（档位/勾选全变）
    });
    delBtn.addEventListener("click", () => {
      const n = sel.value;
      if (!n) return;
      deleteProfile(n, "text");
      rebuildSel();
      profMsg.textContent = "";
    });
    expBtn.addEventListener("click", async () => {
      const json = exportProfiles();
      try {
        await navigator.clipboard.writeText(json);
        profMsg.textContent = t("ui.ds.exported");
      } catch {
        // 剪贴板不可用（file:// 或未授权）：退化为可选中的文本框，用户自行复制
        const ta = el("textarea", { class: "ds-prof-dump", readonly: true, rows: "4" });
        ta.value = json;
        profMsg.textContent = "";
        profMsg.append(ta);
        ta.select();
      }
    });
    impBtn.addEventListener("click", () => {
      const json = window.prompt(t("ui.ds.importPrompt"));
      if (!json) return;
      try {
        const n = importProfiles(json);
        rebuildSel();
        profMsg.textContent = t("ui.ds.imported", n);
      } catch {
        profMsg.textContent = t("ui.ds.importFail");
      }
    });

    body.append(el("div", { class: "ds-sec ds-sec-prof" },
      el("div", { class: "ds-sec-title" }, msym("star"), t("ui.ds.profiles")),
      el("div", { class: "ds-prof-row" }, nameInput, saveBtn),
      el("div", { class: "ds-prof-row" }, sel, loadBtn, delBtn),
      el("div", { class: "ds-prof-row" }, expBtn, impBtn),
      profMsg,
    ));

    syncLevelText();
  }

  renderBody();

  _overlay = el("div", { class: "ds-overlay" }, dialog);
  // 点遮罩空白处关闭（点弹窗内部不关）
  _overlay.addEventListener("click", (e) => { if (e.target === _overlay) closeDecodeStrength(); });
  document.body.append(_overlay);

  _keyHandler = (e) => { if (e.key === "Escape") closeDecodeStrength(); };
  document.addEventListener("keydown", _keyHandler);

  // 焦点进弹窗（键盘/读屏可达）
  setTimeout(() => { try { dialog.querySelector(".ds-slider").focus(); } catch { /* 忽略 */ } }, 0);
}

/** 关闭弹窗。 */
export function closeDecodeStrength() {
  if (_keyHandler) { document.removeEventListener("keydown", _keyHandler); _keyHandler = null; }
  clearTimeout(_debounce);
  if (_overlay) { _overlay.remove(); _overlay = null; }
}

/** 档位显示名（首页按钮上显示当前档用）。 */
export function levelLabel(level) {
  return t("ui.ds.level." + (level || "normal"));
}
