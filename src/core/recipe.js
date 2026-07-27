// recipe.js — 配方链图模型（纯算法编排层）
// 图模型: { nodes: [{id, opId, params}], edges: [{from, to}] }
// 本模块只做编排，不注册新 op，不产生任何加载副作用。
import { getOp, OPS } from "./registry.js";

// ---- 内部工具 ----

function buildIndex(graph) {
  const nodeMap = new Map();
  for (const n of graph.nodes) nodeMap.set(n.id, n);
  return nodeMap;
}

// 计算每个节点的入边（保序）、出度、入度
function buildAdjacency(graph) {
  const inEdges = new Map();   // id -> [edge...]  按 edges 数组顺序
  const outCount = new Map();  // id -> 出度
  const inCount = new Map();   // id -> 入度
  for (const n of graph.nodes) {
    inEdges.set(n.id, []);
    outCount.set(n.id, 0);
    inCount.set(n.id, 0);
  }
  for (const e of graph.edges) {
    if (inEdges.has(e.to)) inEdges.get(e.to).push(e);
    if (outCount.has(e.from)) outCount.set(e.from, outCount.get(e.from) + 1);
    if (inCount.has(e.to)) inCount.set(e.to, inCount.get(e.to) + 1);
  }
  return { inEdges, outCount, inCount };
}

// ---- topoSort：Kahn 算法 ----

/**
 * 拓扑排序，返回 node id 的执行序数组。检测到环抛错。
 * @param {{nodes:Array,edges:Array}} graph
 * @returns {string[]}
 */
export function topoSort(graph) {
  const nodeIds = graph.nodes.map((n) => n.id);
  const indeg = new Map();
  for (const id of nodeIds) indeg.set(id, 0);
 // 只统计端点都在图中的边
  const validEdges = graph.edges.filter(
    (e) => indeg.has(e.from) && indeg.has(e.to)
  );
  for (const e of validEdges) indeg.set(e.to, indeg.get(e.to) + 1);

 // 保持 nodes 声明顺序的稳定队列
  const queue = nodeIds.filter((id) => indeg.get(id) === 0);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const e of validEdges) {
      if (e.from !== id) continue;
      const d = indeg.get(e.to) - 1;
      indeg.set(e.to, d);
      if (d === 0) queue.push(e.to);
    }
  }
  if (order.length !== nodeIds.length) {
    throw new Error("recipe graph has a cycle");
  }
  return order;
}

// ---- 单节点执行 ----

// 依据 node.params.mode 与 op 能力选择执行函数
function runNode(node, inputText) {
  const op = getOp(node.opId);
  if (!op) throw new Error(`unknown opId: ${node.opId}`);
  const params = node.params || {};
  const mode = params.mode;

  if (mode === "decode") {
    if (typeof op.decode !== "function")
      throw new Error(`op ${node.opId} has no decode`);
    return op.decode(inputText, params);
  }
  if (mode === "encode") {
    if (typeof op.encode !== "function")
      throw new Error(`op ${node.opId} has no encode`);
    return op.encode(inputText, params);
  }
  if (mode === "run") {
    if (typeof op.run !== "function")
      throw new Error(`op ${node.opId} has no run`);
    return op.run(inputText, params);
  }
 // 无显式 mode：优先 encode，其次 run
  if (typeof op.encode === "function") return op.encode(inputText, params);
  if (typeof op.run === "function") return op.run(inputText, params);
  throw new Error(`op ${node.opId} has no encode/run to default to`);
}

// ---- executeRecipe ----

/**
 * 按拓扑序逐节点执行配方。
 * 无入度节点使用 input 作为输入；多入度节点按 edge 顺序拼接上游输出
 * （分隔符取本节点 params.join，默认空串）。
 * 返回出度为 0 的节点输出：单个出口直接返回其字符串，多个出口返回 {id: output}。
 * @param {{nodes:Array,edges:Array}} graph
 * @param {string} input
 */
export function executeRecipe(graph, input) {
  const order = topoSort(graph);
  const nodeMap = buildIndex(graph);
  const { inEdges, outCount } = buildAdjacency(graph);
  const outputs = new Map(); // id -> string

  for (const id of order) {
    const node = nodeMap.get(id);
    const incoming = inEdges.get(id) || [];
    let inputText;
    if (incoming.length === 0) {
      inputText = input == null ? "" : String(input);
    } else {
      const join = (node.params && node.params.join) || "";
      inputText = incoming
        .map((e) => (outputs.has(e.from) ? outputs.get(e.from) : ""))
        .join(join);
    }
    outputs.set(id, runNode(node, inputText));
  }

  const finals = graph.nodes
    .map((n) => n.id)
    .filter((id) => (outCount.get(id) || 0) === 0);

  if (finals.length === 0) {
 // 全部节点都有出边（理论上不该发生于无环图，但兜底）：返回拓扑末节点
    return outputs.get(order[order.length - 1]);
  }
  if (finals.length === 1) return outputs.get(finals[0]);
  const result = {};
  for (const id of finals) result[id] = outputs.get(id);
  return result;
}

// ---- validateRecipe ----

/**
 * 校验：所有 opId 存在、无悬空 edge、无环。
 * @param {{nodes:Array,edges:Array}} graph
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateRecipe(graph) {
  const errors = [];
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return { ok: false, errors: ["graph must have nodes[] and edges[]"] };
  }

  const ids = new Set();
  for (const n of graph.nodes) {
    if (n.id == null) {
      errors.push("node missing id");
      continue;
    }
    if (ids.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    ids.add(n.id);
    if (!getOp(n.opId)) errors.push(`unknown opId: ${n.opId} (node ${n.id})`);
  }

  for (const e of graph.edges) {
    if (!ids.has(e.from)) errors.push(`edge from unknown node: ${e.from}`);
    if (!ids.has(e.to)) errors.push(`edge to unknown node: ${e.to}`);
  }

 // 环检测
  try {
    topoSort(graph);
  } catch (err) {
    errors.push(err.message);
  }

  return { ok: errors.length === 0, errors };
}

// ---- 预置示例配方 ----
// opId 均已核对存在于 registry：base16, base64, caesar, rot13, url, md5

export const SAMPLE_RECIPES = [
  {
    id: "hex-to-base64",
    name: "Hex → Base64",
    graph: {
      nodes: [
        { id: "n1", opId: "base16", params: { mode: "decode" } },
        { id: "n2", opId: "base64", params: { mode: "encode" } },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
  },
  {
    id: "caesar13-rot13",
    name: "Caesar(13) → ROT13",
    graph: {
      nodes: [
        { id: "n1", opId: "caesar", params: { mode: "encode", shift: 13 } },
        { id: "n2", opId: "rot13", params: { mode: "encode" } },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
  },
  {
    id: "url-base64-md5",
    name: "URL decode → Base64 decode → MD5",
    graph: {
      nodes: [
        { id: "n1", opId: "url", params: { mode: "decode" } },
        { id: "n2", opId: "base64", params: { mode: "decode" } },
        { id: "n3", opId: "md5", params: { mode: "run" } },
      ],
      edges: [
        { from: "n1", to: "n2" },
        { from: "n2", to: "n3" },
      ],
    },
  },
];

export { OPS };
