/*
 * src/nodeview/index.js — 节点视图集成模块（MT810 接线，配方链内滑块切换）。
 *
 * 组合三套已亲验候选：
 *   - core/     T951 图格式 v1 / 端口推导 / 执行引擎（无 DOM）
 *   - ui/canvas T952 画布（DOM 节点 + SVG 连线，端口由 portProvider 注入）
 *   - core.js + ui/{library,nodeCard,inspector} + i18n  T953 节点库/卡片/检查器
 *
 * 对外 mountNodeView(host, { lang, graph, signal }) -> { root, destroy, getGraph, setGraph, run, api }。
 * 本模块不含路由、不自建页面外壳：由 recipeView 在「节点视图」滑块页内挂载。
 * 工具按钮用 Material 图标（src/ui/icons.js）+ 短中文，不出现 emoji，视觉随主题变量。
 */
import * as registry from "../core/registry.js";
import { icon } from "../ui/icons.js";

import {
  configureRegistry,
  derivePorts,
  emptyGraph,
  normalizeGraph,
  validateGraph,
  executeGraph,
  createNode,
} from "./core/index.js";

import { createCanvas } from "./ui/canvas.js";
import {
  initNodeView, setNodeLang, getNodeLang, tNv, getOp, OPS, CATEGORIES,
  categoriesWithOps, searchOps,
} from "./core.js";
import { createLibrary } from "./ui/library.js";
import { createNodeCard, createSpecialNode } from "./ui/nodeCard.js";
import { createInspector } from "./ui/inspector.js";

configureRegistry(registry);

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
}
function msym(name) { const s = el("span", { class: "msym" }); s.innerHTML = icon(name); return s; }

/* ---------- T951 端口表 -> canvas 端口表 ---------- */
function toCanvasPortTable(opId, params = {}, direction) {
  const t = derivePorts(opId, { params, direction });
  if (!t) return { title: opId, ports: [] };
  const typeOf = (p) => (Array.isArray(p.accepts) && p.accepts.includes("bytes")) ? "bytes" : "text";
  const ports = [];
  for (const p of t.inputs || []) ports.push({ id: p.name, dir: "in", type: typeOf(p), label: p.label || p.name, required: !!p.required });
  for (const p of t.outputs || []) { if (p.dynamic) continue; ports.push({ id: p.name, dir: "out", type: typeOf(p), label: p.label || p.name, required: false }); }
  return { title: t.name || opId, ports };
}

/**
 * 挂载节点视图。返回 root（供 recipeView 放入滑块页）、destroy、run 等。
 */
export async function mountNodeView(host, { lang, graph, signal } = {}) {
  if (!host || !host.appendChild) throw new Error("mountNodeView: host required");
  if (signal?.aborted) return null;
  const useLang = lang || getNodeLang() || "zh";
  await initNodeView(useLang);
  if (signal?.aborted) return null;
  await setNodeLang(useLang);
  if (signal?.aborted) return null;

  // 工具条：Material 图标 + 短中文，不用 emoji
  const bar = el("div", { class: "nv-toolbar" },
    el("button", { type: "button", class: "nv-tool-btn", "data-nv-act": "run", title: tNv("nv.run") || "运行" }, msym("play_arrow"), el("span", {}, "运行")),
    el("button", { type: "button", class: "nv-tool-btn", "data-nv-act": "add-input", title: "添加输入" }, msym("input"), el("span", {}, "输入")),
    el("button", { type: "button", class: "nv-tool-btn", "data-nv-act": "add-output", title: "添加输出" }, msym("output"), el("span", {}, "输出")),
    el("span", { class: "nv-status", "data-nv": "status" }),
  );

  const libHost = el("div", { class: "nv-lib-host" });
  const canvasHost = el("div", { class: "nv-canvas-host" });
  const inspHost = el("div", { class: "nv-insp-host" });
  const outHost = el("div", { class: "nv-out-host" });
  const side = el("div", { class: "nv-side" }, inspHost, outHost);
  const cols = el("div", { class: "nv-cols" }, libHost, canvasHost, side);
  const root = el("div", { class: "nv-app" }, bar, cols);
  host.appendChild(root);

  let inspector = null, selectedId = null, lastResult = null, activeRun = null, destroyed = false;

  const canvas = createCanvas(canvasHost, {
    graph: graph ?? emptyGraph(),
    portProvider: (node) => toCanvasPortTable(node.opId, node.params || {}, node.direction),
    locale: useLang === "en" ? "en" : "zh",
    rtl: document.documentElement.dir === "rtl",
    onEvent(type) {
      if (type === "selection-change") {
        const ids = Array.from(canvas.getSelection ? canvas.getSelection() : []);
        selectedId = ids.length === 1 ? ids[0] : null;
        renderInspector();
      } else if (type === "graph-change") {
        activeRun?.abort();
        lastResult = null; renderOutput();
      }
    },
  });

  const library = createLibrary({
    onAdd(opId) {
      const g = canvas.getGraph();
      g.nodes.push(createNode({ opId }));
      canvas.setGraph(g);
    },
  });
  libHost.appendChild(library.el);

  function renderInspector() {
    inspHost.replaceChildren();
    inspector = null;
    if (!selectedId) return;
    const node = (canvas.getGraph().nodes || []).find((n) => n.id === selectedId);
    if (!node) return;
    const op = getOp(node.opId);
    if (!op) { inspHost.appendChild(el("div", { class: "nv-insp-empty", text: tNv("nv.insp.empty") || "无参数" })); return; }
    inspector = createInspector(op, { values: node.params || {} });
    inspHost.appendChild(inspector.el);
  }

  function renderOutput() {
    outHost.replaceChildren();
    if (!lastResult) return;
    const pre = el("pre", { class: "nv-run-output" });
    const parts = [];
    for (const [nodeId, st] of Object.entries(lastResult.nodes || {})) {
      if (st.status === "ok" && st.preview != null) parts.push(`${nodeId}: ${String(st.preview).slice(0, 120)}`);
      else if (st.status === "error") parts.push(`${nodeId}: ERROR ${st.error || ""}`);
    }
    pre.textContent = parts.join("\n") || "(无输出节点)";
    outHost.appendChild(pre);
  }

  async function run() {
    if (destroyed) return null;
    activeRun?.abort();
    const attempt = new AbortController();
    activeRun = attempt;
    const g = normalizeGraph(canvas.getGraph());
    const v = validateGraph(g, { registry });
    if (!v.ok) {
      lastResult = { nodes: { graph: { status: "error", error: (v.errors || []).map((e) => e.code || e).join(", ") } } };
      activeRun = null;
      renderOutput(); return lastResult;
    }
    try {
      const result = await executeGraph(g, { registry, signal: attempt.signal });
      if (attempt.signal.aborted) return null;
      lastResult = result;
      renderOutput(); return lastResult;
    } finally { if (activeRun === attempt) activeRun = null; }
  }

  function onAct(ev) {
    const b = ev.target.closest && ev.target.closest("[data-nv-act]");
    if (!b) return;
    const act = b.getAttribute("data-nv-act");
    if (act === "run") void run();
    else if (act === "add-input" || act === "add-output") {
      const g = canvas.getGraph();
      g.nodes.push(createNode({ opId: act === "add-input" ? "@input" : "@output" }));
      canvas.setGraph(g);
    }
  }
  bar.addEventListener("click", onAct);

  const api = { canvas, library, getInspector: () => inspector, derivePorts: toCanvasPortTable, tNv, OPS, CATEGORIES, categoriesWithOps, searchOps };
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    activeRun?.abort();
    bar.removeEventListener("click", onAct);
    canvas.destroy();
    root.remove();
  }

  return { root, destroy, getGraph: () => canvas.getGraph(), setGraph: (g) => canvas.setGraph(g), run, api };
}

export default mountNodeView;
