// recipeView.js — 配方链 UI（CyberChef 式多 op 串联）
// 复用 core 算法层：executeRecipeAsync（支持异步 op）+ validateRecipe + PRESETS。
// 线性链模型：nodes 顺序即执行序，第 i 个输出喂第 i+1 个输入。
// 独立模块，自带轻量 el/msym，不反向依赖 main.js（低耦合）。
import { OPS, getOp, opsByCat, defaultParams, CATEGORIES } from "../core/registry.js";
import { executeRecipeAsync, validateRecipe, PRESETS } from "../core/recipes.js";
import { icon as iconSvg } from "./icons.js";
import { attachEditorToolbar } from "./editorToolbar.js";
import { ioArea } from "./ioArea.js"; // 天珩连字：输入/输出改 contenteditable div（textarea 吞 OpenType 特性）

// ---- 轻量 DOM 工具（与 main.js 同形，但本模块自持，零耦合）----
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
  s.innerHTML = iconSvg(name);   // 注入内联 SVG（.msym 无字体 ligature，须 icon() 注水）
  return s;
}

// i18n 取值：优先 main.js 暴露的 __ebctfT，取不到回退内置中文（避免界面空白）
function tt(key, ...args) {
  try { if (typeof window !== "undefined" && window.__ebctfT) { const s = window.__ebctfT(key, ...args); if (s && s !== key) return s; } } catch { /* 回退 */ }
  return RECIPE_FALLBACK[key] || key;
}
// i18n 未接线时的中文兜底
const RECIPE_FALLBACK = {
  "ui.recipe.dir.encode": "编码",
  "ui.recipe.dir.decode": "解码",
  "ui.recipe.dir.run": "运行",
  "ui.recipe.addOp": "＋ 搜索添加操作…",
  "ui.recipe.addEmpty": "无匹配操作",
  "ui.recipe.unknownOp": "未知 op: ",
  "ui.recipe.moveUp": "上移",
  "ui.recipe.moveDown": "下移",
  "ui.recipe.remove": "删除",
  "ui.recipe.validateFail": "配方校验失败：",
  "ui.recipe.execFail": "执行失败",
  "ui.recipe.title": "配方链 · Recipe",
  "ui.recipe.desc": "多个操作串联，上一步输出喂下一步输入。改任意参数即时重跑。",
  "ui.recipe.loadPreset": "载入预设配方…",
  "ui.recipe.showSteps": "显示每步结果",
  "ui.recipe.clear": "清空",
  "ui.recipe.inputLabel": "输入",
  "ui.recipe.inputPh": "链的初始输入…",
  "ui.recipe.empty": "链为空。从上方「添加操作」选一个，或载入预设配方。",
  "ui.recipe.outputLabel": "输出",
  "ui.recipe.outputPh": "链的最终输出…",
  "ui.recipe.dragHint": "桌面可从左侧菜单/顶部搜索结果拖入；触摸设备长按后拖入；也可上方搜索添加",
  "ui.recipe.dragSearchHint": "拖到配方链添加（触摸设备长按后拖动）",
  "ui.recipe.bake": "执行！（Bake！）",
  "ui.recipe.bakeHint": "输入较大，已暂停自动转换。改完点「执行！（Bake！）」跑全链。",
  "ui.recipe.exportRecipe": "导出配方",
  "ui.recipe.importRecipe": "导入配方",
  "ui.recipe.importOk": "已导入配方（{0} 个节点）",
  "ui.recipe.importBadJson": "导入失败：不是合法 JSON",
  "ui.recipe.importBadFormat": "导入失败：非本工具配方格式",
  "ui.recipe.importEmpty": "导入失败：无可用节点",
};

// ---- 状态：配方链节点 [{opId, dir, params}] ----
const rState = {
  nodes: [],       // 链上节点，顺序即执行序
  input: "",       // 链输入
  showSteps: false, // 显示每步中间结果
};

// 输入超此阈值改手动转换（点「执行！/Bake！」），避免每次 keystroke 全链即时重跑卡死大文件。
const AUTO_RUN_THRESHOLD = 1000;
// 是否有「待执行」的挂起转换（大输入下改了输入/参数但未 Bake）
let _pending = false;

// 自动重跑闸门：小输入即时重跑；大输入只标记挂起，等手动 Bake。
// 所有内部 mutation（加/删/移节点、改参数/方向、载入预设、输入变化）走这里，Bake 按钮直呼 runChain(true) 强制跑。
function maybeRunChain() {
  if (rState.input.length > AUTO_RUN_THRESHOLD) {
    _pending = true;
    reflectPending();
    return;
  }
  _pending = false;
  runChain();
}
// 把挂起态反映到 UI（Bake 按钮高亮 + 输出区提示），不重建整个视图
function reflectPending() {
  const bake = document.getElementById("recipeBake");
  if (bake) bake.classList.toggle("pending", _pending);
  const hint = document.getElementById("recipeBakeHint");
  if (hint) hint.style.display = _pending ? "" : "none";
}

// 拖拽重排：记住被拖节点的下标（null 表示无进行中的拖拽）
let _dragFrom = null;
// 左侧菜单拖 op 进画布用的自定义 MIME（避免与文本拖拽混淆）
const OP_MIME = "application/x-ebctf-op";

// i18n 名回退：优先 window 上主表（若 main.js 暴露），否则用 registry 硬编码
function opDisplayName(op) {
  try {
    if (typeof window !== "undefined" && window.__ebctfOpName) {
      const n = window.__ebctfOpName(op);
      if (n) return n;
    }
  } catch { /* 回退 */ }
  return op.name || op.id;
}

// op 支持的方向列表
function opDirs(op) {
  const dirs = [];
  if (op.encode) dirs.push("encode");
  if (op.decode) dirs.push("decode");
  if (op.run) dirs.push("run");
  return dirs;
}
function dirLabel(d) {
  return d === "encode" ? tt("ui.recipe.dir.encode") : d === "decode" ? tt("ui.recipe.dir.decode") : tt("ui.recipe.dir.run");
}

// 把线性 nodes 转成 recipe 图模型（顺序连边）
function toGraph() {
 // 最后防线：即使旧数据/预设里混入 exe 类 op（requiresBridge），执行图也剔除——
 // 否则链式即时重跑会反复启动外部程序。选择器过滤 + addNode 兜底 + 此处三重保险。
  const chain = rState.nodes.filter((n) => { const op = getOp(n.opId); return !(op && op.requiresBridge); });
  const nodes = chain.map((n, i) => ({
    id: "n" + i,
    opId: n.opId,
    params: { ...n.params, mode: n.dir },
  }));
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ from: "n" + i, to: "n" + (i + 1) });
  }
  return { nodes, edges };
}

// ---- 节点操作 ----
// index 省略/越界 → 追加末尾；否则插到该下标前（左侧拖入按落点定位复用）
function addNode(opId, index) {
  const op = getOp(opId);
  if (!op) return;
 // 兜底：exe 类 op（requiresBridge）不进配方链——选择器已过滤，此处再堵左侧拖入等其他入口
 // 防止链式即时重跑反复启动外部程序。
  if (op.requiresBridge) return;
  const dirs = opDirs(op);
  const node = {
    opId,
    dir: dirs.includes("decode") ? "decode" : dirs[0],
    params: defaultParams(op),
  };
  if (index == null || index < 0 || index >= rState.nodes.length) rState.nodes.push(node);
  else rState.nodes.splice(index, 0, node);
  renderRecipe();
  maybeRunChain();
}
function removeNode(i) { rState.nodes.splice(i, 1); renderRecipe(); maybeRunChain(); }
function moveNode(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= rState.nodes.length) return;
  const t = rState.nodes[i]; rState.nodes[i] = rState.nodes[j]; rState.nodes[j] = t;
  renderRecipe(); maybeRunChain();
}
// 任意位置移动（拖拽重排复用）：把 from 处节点抽出插到 to
function moveNodeTo(from, to) {
  const n = rState.nodes.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
  const [node] = rState.nodes.splice(from, 1);
  rState.nodes.splice(to, 0, node);
  renderRecipe(); maybeRunChain();
}
function clearChain() { rState.nodes = []; renderRecipe(); maybeRunChain(); }

// 配方导出/导入。CyberChef 配方是 [{op:"From Base64",args:[...]}]（英文全名+位置参数）
// 本项目是 {opId,dir,params}（短 id+命名参数），两套 op 命名体系不同、400+ op 名映射维护成本极高
// 无法直接互通 → 走本项目自有 JSON（tool 标记 EBCTFCodeBox，版本化）。
const RECIPE_FORMAT = "EBCTFCodeBox-recipe";
const RECIPE_FORMAT_VER = 1;
// 导出当前链为 JSON 文本（含输入内容，便于完整复现）。
function exportRecipe() {
  const data = {
    format: RECIPE_FORMAT,
    version: RECIPE_FORMAT_VER,
    input: rState.input || "",
    nodes: rState.nodes.map((n) => ({ opId: n.opId, dir: n.dir, params: n.params || {} })),
  };
  const json = JSON.stringify(data, null, 2);
  try {
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "recipe-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + ".json";
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { /* 忽略 */ }
}
// 从 JSON 文本恢复链。校验 format/nodes；只保留 registry 里存在且非 bridge 的 op（安全 + 防脏数据）。
// 返回 {ok, error}。
function importRecipeFromText(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, error: tt("ui.recipe.importBadJson") }; }
  if (!data || data.format !== RECIPE_FORMAT || !Array.isArray(data.nodes)) {
    return { ok: false, error: tt("ui.recipe.importBadFormat") };
  }
  const nodes = [];
  for (const n of data.nodes) {
    if (!n || typeof n.opId !== "string") continue;
    const op = getOp(n.opId);
    if (!op || op.requiresBridge) continue;   // 未知 op / exe 桥 op 跳过（同 addNode 兜底）
    const dirs = opDirs(op);
    const dir = dirs.includes(n.dir) ? n.dir : (dirs.includes("decode") ? "decode" : dirs[0]);
    nodes.push({ opId: n.opId, dir, params: (n.params && typeof n.params === "object") ? { ...n.params } : defaultParams(op) });
  }
  if (!nodes.length) return { ok: false, error: tt("ui.recipe.importEmpty") };
  rState.nodes = nodes;
  if (typeof data.input === "string") rState.input = data.input;
  renderRecipe();
  maybeRunChain();
  return { ok: true, count: nodes.length };
}
// 触发文件选择导入。
function importRecipe() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = ".json,application/json";
  inp.addEventListener("change", () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const r = importRecipeFromText(String(reader.result || ""));
      try { if (window.__ebctfToast) window.__ebctfToast(r.ok ? tt("ui.recipe.importOk", r.count) : r.error); } catch { /* 忽略 */ }
    };
    reader.readAsText(f);
  });
  inp.click();
}

// dataTransfer 是否携带左侧 op 拖拽的自定义 MIME（dragover 阶段 getData 取不到值，只能查 types）
function dtHasOpMime(dt) {
  try { return Array.prototype.indexOf.call(dt.types || [], OP_MIME) !== -1; } catch { return false; }
}
// 依据 drop 时鼠标 Y 坐标算插入下标：落在哪张节点卡的上半区就插到它前面，否则追加末尾
function dropIndexFromY(chain, clientY) {
  const cards = chain.querySelectorAll(".recipe-node");
  for (let k = 0; k < cards.length; k++) {
    const r = cards[k].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return Number(cards[k].dataset.idx);
  }
  return null; // 追加末尾
}

function loadPreset(id) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p || !p.graph) return;
 // 预设 graph 是线性链（本项目预设均线性），按 edges 顺序还原 nodes 序
  const g = p.graph;
  const order = topoOrder(g);
  rState.nodes = order.map((nid) => {
    const gn = g.nodes.find((n) => n.id === nid);
    const { mode, ...rest } = gn.params || {};
    return { opId: gn.opId, dir: mode || "decode", params: rest };
  });
  renderRecipe();
  maybeRunChain();
}
// 简易拓扑序（预设为线性链，够用；有环则退回声明序）
function topoOrder(g) {
  const indeg = new Map(g.nodes.map((n) => [n.id, 0]));
  for (const e of g.edges) if (indeg.has(e.to)) indeg.set(e.to, indeg.get(e.to) + 1);
  const q = g.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const order = [];
  while (q.length) {
    const id = q.shift(); order.push(id);
    for (const e of g.edges) if (e.from === id) {
      indeg.set(e.to, indeg.get(e.to) - 1);
      if (indeg.get(e.to) === 0) q.push(e.to);
    }
  }
  return order.length === g.nodes.length ? order : g.nodes.map((n) => n.id);
}

// ---- op 选择器（可搜索 combobox，替代原分类下拉）----
// 非拖动添加入口：输入即过滤，上下键/Enter/点击直接添加。桌面/触摸通用。
function buildOpSearchPicker(onPick) {
  const wrap = el("div", { class: "recipe-op-search" });
  const input = el("input", { type: "text", class: "recipe-op-search-input", placeholder: tt("ui.recipe.addOp"), autocomplete: "off", spellcheck: "false" });
  const list = el("div", { class: "recipe-op-search-list" });

  // 数据源：chainable op（同旧下拉的过滤：exe 桥 op 不进链）+ 名称排序
  const chainable = [];
  for (const cat of CATEGORIES) {
    if (cat.id === "home") continue;
    for (const op of opsByCat(cat.id)) {
      if (op.requiresBridge) continue;
      chainable.push(op);
    }
  }
  chainable.sort((a, b) => opDisplayName(a).localeCompare(opDisplayName(b), "zh"));

  // 轻量过滤 + 评分（名称开头 > 名称包含 > id 包含），不依赖 main.js（低耦合）
  const filter = (q) => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return chainable.slice(0, 12);
    const out = [];
    for (const op of chainable) {
      const nm = opDisplayName(op).toLowerCase();
      let ok = true, score = 0;
      for (const t of terms) {
        const pos = nm.indexOf(t);
        if (pos < 0 && !op.id.includes(t)) { ok = false; break; }
        if (pos === 0) score += 100;
        else if (pos > 0) score += 40;
        else score += 10; // 命中 id
      }
      if (ok) out.push({ op, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 12).map((x) => x.op);
  };

  const renderList = (ops) => {
    list.innerHTML = "";
    if (!ops.length) {
      list.append(el("div", { class: "recipe-op-search-empty" }, tt("ui.recipe.addEmpty")));
      list.classList.add("open");
      return;
    }
    ops.forEach((op, i) => {
      const item = el("div", { class: "recipe-op-search-item", "data-idx": String(i), "data-op-id": op.id },
        el("span", { class: "recipe-op-search-item-name" }, opDisplayName(op)),
      );
      item.addEventListener("mousedown", (e) => { e.preventDefault(); pick(op.id); });
      item.addEventListener("touchstart", (e) => { e.preventDefault(); pick(op.id); }, { passive: false });
      list.append(item);
    });
    list.classList.add("open");
  };
  const closeList = () => { list.classList.remove("open"); list.innerHTML = ""; };
  const pick = (opId) => {
    input.value = "";
    closeList();
    onPick(opId);
    input.focus();
  };

  input.addEventListener("input", () => renderList(filter(input.value)));
  input.addEventListener("focus", () => { if (input.value.trim()) renderList(filter(input.value)); });
  input.addEventListener("keydown", (e) => {
    const items = Array.from(list.querySelectorAll(".recipe-op-search-item"));
    const active = list.querySelector(".recipe-op-search-item.active");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const i = active ? Number(active.dataset.idx) + 1 : 0;
      items.forEach((n) => n.classList.remove("active"));
      if (items[i % items.length]) items[i % items.length].classList.add("active");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const i = active ? Number(active.dataset.idx) - 1 : items.length - 1;
      items.forEach((n) => n.classList.remove("active"));
      if (items[((i % items.length) + items.length) % items.length]) items[((i % items.length) + items.length) % items.length].classList.add("active");
    } else if (e.key === "Enter") {
      const it = list.querySelector(".recipe-op-search-item.active");
      if (it) pick(it.dataset.opId);
      else if (items.length === 1) pick(items[0].dataset.opId);
      else if (items.length) pick(items[0].dataset.opId);
    } else if (e.key === "Escape") {
      closeList();
    }
  });
  // 焦点离开整个搜索添加器时关闭；不挂 document 全局监听，避免每次 renderRecipe 重建累积监听。
  wrap.addEventListener("focusout", () => {
    setTimeout(() => { if (!wrap.contains(document.activeElement)) closeList(); }, 0);
  });

  wrap.append(input, list);
  return wrap;
}

// ---- 单节点卡 ----
function renderNodeCard(node, i) {
  const op = getOp(node.opId);
  if (!op) return el("div", { class: "recipe-node error" }, tt("ui.recipe.unknownOp") + node.opId);
  const dirs = opDirs(op);
  const card = el("div", { class: "recipe-node", draggable: "true" });
  card.dataset.idx = String(i);

 // 拖拽重排（CyberChef 式手感）：记住被拖下标，drop 时算目标下标 → moveNodeTo。上下箭头保留。
  card.addEventListener("dragstart", (e) => {
 // 交互控件（参数输入框/下拉/按钮/M3 开关/参数区）发起时放弃卡片拖拽。
 // 否则整卡 draggable=true 会在 input/select 内 mousedown+移动时抢先触发 dragstart
 // 吞掉文本选择/光标定位（Chromium draggable 祖先经典坑）→ 用户以为参数填不进=配方链不能用。
    const tgt = e.target;
    if (tgt && tgt.closest && tgt.closest("input, select, textarea, button, label, .recipe-node-params")) {
      e.preventDefault();
      return;
    }
    _dragFrom = i;
    card.classList.add("dragging");
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(i)); } catch { /* 某些环境禁用 */ } }
  });
  card.addEventListener("dragend", () => {
    _dragFrom = null;
    card.classList.remove("dragging");
 // 清残留指示线（重绘前的兜底）
    for (const n of card.parentElement ? card.parentElement.querySelectorAll(".recipe-node.drag-over") : []) n.classList.remove("drag-over");
  });
  card.addEventListener("dragover", (e) => {
    if (_dragFrom == null || _dragFrom === i) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    card.classList.add("drag-over");
  });
  card.addEventListener("dragleave", () => { card.classList.remove("drag-over"); });
  card.addEventListener("drop", (e) => {
    e.preventDefault();
    card.classList.remove("drag-over");
    if (_dragFrom == null || _dragFrom === i) return;
    moveNodeTo(_dragFrom, i);
    _dragFrom = null;
  });

 // 头：序号 + 名 + 方向 + 上下移/删
  const head = el("div", { class: "recipe-node-head" },
    el("span", { class: "recipe-node-idx" }, String(i + 1)),
    el("span", { class: "recipe-node-name" }, opDisplayName(op)),
  );
 // 方向切换（多向才显示）
  if (dirs.length > 1) {
    const dsel = el("select", { class: "recipe-node-dir" });
    for (const d of dirs) {
      const o = el("option", { value: d }, dirLabel(d));
      if (d === node.dir) o.setAttribute("selected", "");
      dsel.append(o);
    }
    dsel.value = node.dir;
    dsel.addEventListener("change", () => { node.dir = dsel.value; maybeRunChain(); });
    head.append(dsel);
  } else {
    head.append(el("span", { class: "recipe-node-dir-fixed" }, dirLabel(dirs[0])));
  }
 // 节点增减控件改 M3 圆形图标按钮（复用 app.css 的 .icon-btn 范式）。
 // recipe-mini-btn 作附加钩子保留（供尺寸微调）；删除键内联 --error 令牌保留危险色，不硬编。
  const ctrl = el("div", { class: "recipe-node-ctrl" },
    el("button", { class: "icon-btn recipe-mini-btn", title: tt("ui.recipe.moveUp"), onclick: () => moveNode(i, -1) }, msym("arrow_upward")),
    el("button", { class: "icon-btn recipe-mini-btn", title: tt("ui.recipe.moveDown"), onclick: () => moveNode(i, 1) }, msym("arrow_downward")),
    el("button", { class: "icon-btn recipe-mini-btn", title: tt("ui.recipe.remove"), style: "color:var(--error)", onclick: () => removeNode(i) }, msym("close")),
  );
  head.append(ctrl);
  card.append(head);

 // 参数区
  const params = op.params || [];
  if (params.length) {
    const pwrap = el("div", { class: "recipe-node-params" });
    for (const d of params) pwrap.append(renderRecipeParam(node, d, i));
    card.append(pwrap);
  }
  return card;
}

// 节点参数框（本地渲染，改值即重跑链）
function renderRecipeParam(node, d, i) {
  const wrap = el("div", { class: "recipe-param" });
  if (d.type === "bool") {
 // M3 switch，替代原生 checkbox
 // sid 用节点下标 i（节点对象无 id 字段），避免同 op 多节点撞 id → label-for 劫持/switch 串台
    const sid = "rp_" + i + "_" + d.key;
    const cb = el("input", { type: "checkbox", id: sid });
    cb.checked = !!node.params[d.key];
    cb.addEventListener("change", () => { node.params[d.key] = cb.checked; maybeRunChain(); });
    wrap.append(
      el("label", { class: "switch", for: sid }, cb, el("span", { class: "track" }), el("span", { class: "knob" })),
      el("label", { for: sid }, d.label),
    );
  } else if (d.type === "select") {
    const sel = el("select", {});
    for (const o of d.options || []) sel.append(el("option", { value: o.value ?? o }, o.label ?? o));
    sel.value = node.params[d.key];
    sel.addEventListener("change", () => { node.params[d.key] = sel.value; maybeRunChain(); });
    wrap.append(el("label", {}, d.label), sel);
  } else if (d.type === "number") {
 // M3 stepper 自实现，替浏览器原生 spinner（与 main.js renderParam 同形）。[−][input][＋]
    const min = d.min ?? null, max = d.max ?? null, step = d.step ?? 1;
    const inp = el("input", { type: "text", inputmode: "numeric", class: "stepper-inp", placeholder: d.placeholder || "" });
    inp.value = node.params[d.key] ?? "";
    const clamp = (n) => {
      if (Number.isNaN(n)) return n;
      if (min !== null && n < min) n = min;
      if (max !== null && n > max) n = max;
      return n;
    };
    const commit = (n) => {
      const v = clamp(n);
      node.params[d.key] = v;
      inp.value = Number.isNaN(v) ? "" : String(v);
      maybeRunChain();
    };
    const bump = (dir) => {
      const cur = Number(inp.value);
      const base = Number.isNaN(cur) ? (min ?? 0) : cur;
      commit(base + dir * step);
    };
    inp.addEventListener("input", () => { node.params[d.key] = Number(inp.value); maybeRunChain(); });
    inp.addEventListener("blur", () => { if (inp.value !== "") commit(Number(inp.value)); });
    const btn = (iconName, dir, label) => {
      const b = el("button", { type: "button", class: "stepper-btn", "aria-label": label, tabindex: "-1" }, msym(iconName));
      b.addEventListener("click", () => bump(dir));
      return b;
    };
    const box = el("div", { class: "stepper" }, btn("remove", -1, "减"), inp, btn("add", 1, "加"));
    wrap.append(el("label", {}, d.label), box);
  } else {
    const inp = el("input", { type: "text", placeholder: d.placeholder || "" });
    inp.value = node.params[d.key] ?? "";
    inp.addEventListener("input", () => {
      node.params[d.key] = inp.value;
      maybeRunChain();
    });
    wrap.append(el("label", {}, d.label), inp);
  }
  return wrap;
}

// ---- 执行链：顺序跑，防竞态 ----
let _seq = 0;
async function runChain() {
  const out = document.getElementById("recipeOut");
  const stepsBox = document.getElementById("recipeSteps");
  if (!out) return;
  if (!rState.nodes.length) { out.value = ""; if (stepsBox) stepsBox.innerHTML = ""; return; }
  if (rState.input === "") { out.value = ""; if (stepsBox) stepsBox.innerHTML = ""; return; }

  const graph = toGraph();
  const v = validateRecipe(graph);
  const seq = ++_seq;
  if (!v.ok) {
 // 错误显示移到 stepsBox（div）用 msym 渲染图标，textarea.value 不支持 DOM 元素
    out.value = "";
    out.classList.remove("error");
    if (stepsBox) {
      stepsBox.innerHTML = "";
      stepsBox.append(el("div", { class: "recipe-err", style: "color:var(--error);display:flex;align-items:center;gap:6px;padding:8px" }, msym("cancel"), el("span", {}, tt("ui.recipe.validateFail") + v.errors.join("; "))));
    }
    return;
  }
  try {
 // 显示每步中间结果：逐节点单独跑（复用 executeRecipeAsync 的单链能力，切前缀链）
    if (rState.showSteps && stepsBox) {
      stepsBox.innerHTML = "";
      let acc = rState.input;
      for (let i = 0; i < rState.nodes.length; i++) {
        const sub = { nodes: graph.nodes.slice(0, i + 1), edges: graph.edges.slice(0, i) };
        acc = await executeRecipeAsync(sub, rState.input);
        if (seq !== _seq) return;
        const op = getOp(rState.nodes[i].opId);
        stepsBox.append(el("div", { class: "recipe-step" },
          el("span", { class: "recipe-step-idx" }, (i + 1) + ". " + opDisplayName(op)),
          el("code", { class: "recipe-step-out" }, typeof acc === "string" ? acc : JSON.stringify(acc)),
        ));
      }
      out.value = typeof acc === "string" ? acc : JSON.stringify(acc, null, 2);
    } else {
      const result = await executeRecipeAsync(graph, rState.input);
      if (seq !== _seq) return;
      out.value = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      if (stepsBox) stepsBox.innerHTML = "";
    }
    out.classList.remove("error");
  } catch (e) {
    if (seq !== _seq) return;
 // 错误显示移到 stepsBox（div）用 msym 渲染图标，textarea.value 不支持 DOM 元素
    out.value = "";
    out.classList.remove("error");
    if (stepsBox) {
      stepsBox.innerHTML = "";
      stepsBox.append(el("div", { class: "recipe-err", style: "color:var(--error);display:flex;align-items:center;gap:6px;padding:8px" }, msym("cancel"), el("span", {}, (e.message || tt("ui.recipe.execFail")))));
    }
  }
}

// ---- 主渲染：挂到传入的容器 ----
// 模块级缓存首屏拿到的 host。index.html 无 #recipeHost
// 内部 mutation 函数均无参调用 renderRecipe，此前 host 为 null 直接 return → DOM 不重建。
let _recipeHost = null;
export function renderRecipe(container) {
  const host = container || _recipeHost || document.getElementById("recipeHost");
  if (!host) return;
  _recipeHost = host;   // 记住首次拿到的 host，供后续无参调用复用
  host.innerHTML = "";

  const wrap = el("div", { class: "recipe-view" });

 // 标题
  wrap.append(el("div", { class: "op-head" },
    el("div", { class: "op-title" }, msym("account_tree"), tt("ui.recipe.title")),
    el("div", { class: "op-desc" }, tt("ui.recipe.desc")),
  ));

 // 工具条：预设加载 + op 选择器 + 清空 + 步骤开关
  const bar = el("div", { class: "recipe-bar" });
  const presetSel = el("select", { class: "recipe-preset-picker" });
  presetSel.append(el("option", { value: "" }, tt("ui.recipe.loadPreset")));
  for (const p of PRESETS) presetSel.append(el("option", { value: p.id, title: p.desc || "" }, p.name));
  presetSel.addEventListener("change", () => { if (presetSel.value) { loadPreset(presetSel.value); presetSel.value = ""; } });
  bar.append(presetSel);
  bar.append(buildOpSearchPicker(addNode));
  const stepChk = el("input", { type: "checkbox", id: "recipeStepToggle" });
  stepChk.checked = rState.showSteps;
  stepChk.addEventListener("change", () => { rState.showSteps = stepChk.checked; maybeRunChain(); });
 // M3 修正：原 label 嵌套 label（HTML 违规，label 不能嵌套 label，会导致点击穿透/switch 失灵）
 // 改为 div 容器 + label.switch + span 文案，点击行为正确
  bar.append(el("div", { class: "recipe-step-toggle" },
    el("label", { class: "switch", for: "recipeStepToggle" }, stepChk, el("span", { class: "track" }), el("span", { class: "knob" })),
    el("span", {}, tt("ui.recipe.showSteps")),
  ));
  bar.append(el("button", { class: "recipe-clear-btn", onclick: clearChain }, msym("delete_sweep"), " " + tt("ui.recipe.clear")));
 // 配方导出/导入（自有 JSON 格式，非 CyberChef——op 命名体系不同无法互通）。
  bar.append(el("button", { class: "recipe-clear-btn", title: tt("ui.recipe.exportRecipe"), onclick: exportRecipe }, msym("download"), " " + tt("ui.recipe.exportRecipe")));
  bar.append(el("button", { class: "recipe-clear-btn", title: tt("ui.recipe.importRecipe"), onclick: importRecipe }, msym("content_paste"), " " + tt("ui.recipe.importRecipe")));
 // 手动执行按钮「执行！（Bake！）」——致敬 CyberChef。大输入下自动重跑闸门关闭，靠它强制跑全链。
 // .pending 类由 reflectPending 切换（大输入有挂起改动时高亮提示「该点我了」）。
  const bakeBtn = el("button", { class: "recipe-bake-btn", id: "recipeBake", onclick: () => { _pending = false; reflectPending(); runChain(); } },
    msym("play_arrow"), " " + tt("ui.recipe.bake"));
  bar.append(bakeBtn);
  wrap.append(bar);

 // 输入
  wrap.append(el("label", { class: "recipe-io-label" }, tt("ui.recipe.inputLabel")));
  const inArea = ioArea({ class: "io-area recipe-io", id: "recipeIn", placeholder: tt("ui.recipe.inputPh") });
  inArea.value = rState.input;
  inArea.addEventListener("input", () => { rState.input = inArea.value; maybeRunChain(); });
 // 编辑框记事本化——输入框挂工具条（粘贴/清空/字号/全选/导出 + Ctrl+A/S）+ 快捷键。
  wrap.append(attachEditorToolbar(inArea, { onChange: () => { rState.input = inArea.value; maybeRunChain(); }, exportName: "recipe-input.txt" }));
  wrap.append(inArea);

 // 大输入挂起提示——超阈值时改动只标记待执行（不即时重跑），提示用户点工具条的 Bake 按钮。
 // 默认隐藏，reflectPending 控制显隐。Bake 按钮本体在工具条（id=recipeBake）。
  wrap.append(el("div", { class: "recipe-bake-hint", id: "recipeBakeHint", style: "display:none" },
    msym("info"), el("span", {}, tt("ui.recipe.bakeHint"))));

 // 拖拽提示（常驻画布顶部，指引「左侧拖 op / 拖节点重排」）
  wrap.append(el("div", { class: "recipe-drag-hint" }, msym("drag_indicator"), el("span", {}, tt("ui.recipe.dragHint"))));

 // 链节点区
  const chain = el("div", { class: "recipe-chain", id: "recipeChain" });
  if (!rState.nodes.length) {
    chain.append(el("div", { class: "recipe-empty" }, tt("ui.recipe.empty")));
  } else {
    rState.nodes.forEach((node, i) => {
      chain.append(renderNodeCard(node, i));
      if (i < rState.nodes.length - 1) chain.append(el("div", { class: "recipe-arrow" }, msym("arrow_downward")));
    });
  }
 // 左侧菜单拖 op 进画布：dragover 高亮 + drop 追加/插入节点。
 // 仅响应带 OP_MIME 的拖拽（节点内部重排走 _dragFrom，不含该 MIME，此处不干预）。
  chain.addEventListener("dragover", (e) => {
    if (_dragFrom != null) return;                       // 内部重排进行中，交给节点卡处理
    if (!e.dataTransfer || !dtHasOpMime(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    chain.classList.add("recipe-drop-active");
  });
  chain.addEventListener("dragleave", (e) => {
 // 只在真正离开 chain（而非移入子元素）时移除高亮
    if (e.relatedTarget && chain.contains(e.relatedTarget)) return;
    chain.classList.remove("recipe-drop-active");
  });
  chain.addEventListener("drop", (e) => {
    if (_dragFrom != null) return;
    if (!e.dataTransfer || !dtHasOpMime(e.dataTransfer)) return;
    e.preventDefault();
    chain.classList.remove("recipe-drop-active");
    const opId = e.dataTransfer.getData(OP_MIME);
    if (!opId) return;
    addNode(opId, dropIndexFromY(chain, e.clientY));
  });
  wrap.append(chain);

 // 每步结果（可选）
  wrap.append(el("div", { class: "recipe-steps", id: "recipeSteps" }));

 // 输出
  wrap.append(el("label", { class: "recipe-io-label" }, tt("ui.recipe.outputLabel")));
  const outArea = ioArea({ class: "io-area recipe-io", id: "recipeOut", readonly: true, placeholder: tt("ui.recipe.outputPh") });
 // 输出框接编辑器工具条（只读：复制/全选/导出/字号）
  wrap.append(attachEditorToolbar(outArea, { readonly: true, exportName: "recipe-output.txt" }));
  wrap.append(outArea);

  host.append(wrap);
  reflectPending();   // 重建后同步 Bake 高亮/挂起提示（大输入下切视图回来仍显挂起）
  maybeRunChain();    // 小输入即时跑；大输入只标记挂起等 Bake，避免重建即卡
}

// 供 main.js 触摸拖拽落点：命中配方链画布即添加（按 Y 定位插入，dropIndexFromY 返回 null 则追加末尾）
export function addRecipeOpAt(opId, clientX, clientY) {
  const chain = document.getElementById("recipeChain");
  if (!chain) return false;
  const idx = dropIndexFromY(chain, clientY);
  addNode(opId, idx);
  return true;
}

export { rState };
