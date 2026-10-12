// recipe.js — 配方链图模型（纯算法编排层）
// 图模型: { nodes: [{id, opId, params}], edges: [{from, to}] }
// 本模块只做编排，不注册新 op，不产生任何加载副作用。
import { getOp, OPS } from "./registry.js";
import { transitTextOf, transitPayloadOf } from "./productResult.js";
import { bytesToHex, bytesToEscapedText, decodeUtf8Lossless } from "./bytesIo.js";

// ---- 链头输入归一化：配方链的「文件通道」----
// 背景：音频/图像/二进制类 op 走 acceptsBytes 约定，要用 p.rawBytes 吃真字节，
// 而配方链此前只吃 inputText ⇒ 链头一断，后面全接不上台账第 3 节）。
//
// input 允许四种形态（前一种即原行为，零变化）：
//  1) string                 —— 纯文本
//  2) Uint8Array / number[]  —— 真字节
//  3) {text?, bytes?}        —— 文本 + 文件字节（UI 拖入文件时用这种）
//  4) null / 其它标量        —— 转 String
// 返回 { text, params }：
//  · 链头 op 声明 acceptsBytes → params 注入 rawBytes（真字节无损进 op），text 取
//    显式 text，缺省则给同一批字节的 hex（op 若只认文本也不至于拿到空串）；
//  · 否则 text 取显式 text，缺省给 hex —— 与 UI「二进制文件拖入转 hex 进框」一致。
// 只对链头生效：链中段产物由 transitTextOf 保证无损中转，不经此处。
export function resolveRecipeHead(node, input) {
  const params = node.params || {};
  const asIs = (v) => ({ text: v == null ? "" : String(v), params });
  if (input == null || typeof input === "string" || typeof input === "number" || typeof input === "boolean") {
    return asIs(input);
  }
  let bytes = null;
  let text = null;
  if (input instanceof Uint8Array || input instanceof ArrayBuffer || Array.isArray(input)) {
    bytes = input instanceof Uint8Array ? input
      : input instanceof ArrayBuffer ? new Uint8Array(input)
      : Uint8Array.from(input);
  } else if (typeof input === "object") {
    const b = input.bytes != null ? input.bytes : input.rawBytes;
    if (b != null) {
      bytes = b instanceof Uint8Array ? b
        : b instanceof ArrayBuffer ? new Uint8Array(b)
        : Array.isArray(b) ? Uint8Array.from(b) : null;
    }
    if (input.text != null) text = String(input.text);
  } else {
    return asIs(input);
  }
  if (!bytes || !bytes.length) return { text: text == null ? "" : text, params };
  const op = getOp(node.opId);
  const hex = bytesToHex(bytes);
  if (op && op.acceptsBytes) {
    return { text: text == null ? hex : text, params: { ...params, rawBytes: bytes } };
  }
  return { text: text == null ? hex : text, params };
}

// ---- 链中段中转（F02 契约）----
// 上游产物 → 下游节点的 { text, params }。规则：
//  · 上游无真字节 ⇒ 照旧按 join 拼文本（零变化）。
//  · 上游有真字节 ⇒ 只允许「全是字节」或「全是文本」；混拼显式拒绝。
//      - 下游声明 acceptsBytes ⇒ 注入 params.rawBytes，text 给 hex（口径与链头一致）。
//      - 下游不吃字节 ⇒ 只有「显示转义（\xNN）」形态才需要判严格 UTF-8：
//          解得出来按内容走文本；解不出来**显式拒绝**（F02 根因：不许把转义串当内容算）。
//          hex / base64 形态是用户显式选择的表示，照旧当文本传。
export function resolveTransitInput(node, upstreamOutputs, edges) {
  const params0 = node.params || {};
  const join = params0.join || "";
  const parts = edges.map((e) => (upstreamOutputs.has(e.from)
    ? transitPayloadOf(upstreamOutputs.get(e.from))
    : { text: "", bytes: null }));
  const byteParts = parts.filter((p) => p.bytes);
  if (!byteParts.length) {
    return { text: parts.map((p) => p.text).join(join), params: undefined };
  }
  if (byteParts.length !== parts.length) {
    throw new Error("配方链中转：上游产物混有「二进制文件」与「纯文本」，无法拼接。请让该节点只接同一类上游。");
  }
  if (parts.length > 1 && join !== "") {
    throw new Error("配方链中转：多个二进制上游产物不能用分隔符拼接。");
  }
  let bytes = byteParts[0].bytes;
  if (byteParts.length > 1) {
    const total = byteParts.reduce((n, p) => n + p.bytes.length, 0);
    const merged = new Uint8Array(total);
    let off = 0;
    for (const p of byteParts) { merged.set(p.bytes, off); off += p.bytes.length; }
    bytes = merged;
  }
  const op = getOp(node.opId);
  const opName = (op && (op.name || op.id)) || node.opId;
  if (op && op.acceptsBytes) {
    return { text: bytesToHex(bytes), params: { ...params0, rawBytes: bytes } };
  }
  if (parts.length > 1) {
    throw new Error(`配方链中转：多个二进制上游产物只能交给接受字节的节点；「${opName}」不接受字节。`);
  }
  if (parts[0].text !== bytesToEscapedText(bytes)) {
    return { text: parts[0].text, params: undefined };
  }
  const loss = decodeUtf8Lossless(bytes);
  if (!loss.ok) {
    throw new Error(`配方链中转：上游产物是二进制（非 UTF-8 文本），而下游节点「${opName}」不接受字节。请改用能接字节的节点（哈希 / 编码 / 压缩类），或先在上游切换输出形态（hex）。`);
  }
  return { text: loss.text, params: undefined };
}

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

// 依据 node.params.mode 与 op 能力选择执行函数。
// params 可覆盖 node.params（链头文件通道会注入 rawBytes，见 resolveRecipeHead）。
function runNode(node, inputText, params) {
  const op = getOp(node.opId);
  if (!op) throw new Error(`unknown opId: ${node.opId}`);
  params = params || node.params || {};
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
    if (typeof op.run === "function") return op.run(inputText, params);
    if (typeof op.decode === "function") return op.decode(inputText, params); // 兼容：原 run 型 op 改双向后，旧配方 run 节点回落 decode（语义同提取）
    throw new Error(`op ${node.opId} has no run`);
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
 * @param {string|Uint8Array|Array|{text?:string,bytes?:Uint8Array}} input
 *        链头输入：文本、真字节，或 {text, bytes}（文件通道，见 resolveRecipeHead）
 */
export function executeRecipe(graph, input) {
  const order = topoSort(graph);
  const nodeMap = buildIndex(graph);
  const { inEdges, outCount } = buildAdjacency(graph);
  const outputs = new Map(); // id -> string

  for (const id of order) {
    const node = nodeMap.get(id);
    const incoming = inEdges.get(id) || [];
    let inputText, params;
    if (incoming.length === 0) {
      const head = resolveRecipeHead(node, input);
      inputText = head.text;
      params = head.params;
    } else {
      const t = resolveTransitInput(node, outputs, incoming);
      inputText = t.text;
      if (t.params) params = t.params;
    }
    outputs.set(id, runNode(node, inputText, params));
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
