/*
 * graph.js — 图格式 v1 的创建 / 校验 / 规范化 / 稳定序列化 / 分享串（T951 候选，无 DOM）。
 *
 * 图格式 v1（MT809 冻结）：
 * {
 *   schemaVersion: 1,
 *   nodes: [{ id, opId, direction, params, x, y, w?, collapsed?, disabled?, note? }],
 *   edges: [{ id, from: { node, port }, to: { node, port } }],
 *   groups: [{ id, title, x, y, w, h }],
 *   viewport: { x, y, k }
 * }
 *
 * 设计取舍（写进回执，接线方照此实现）：
 *  · 结构字段严格：顶层 / 节点 / 边 / 端点 / 分组 / 视口 出现未知字段一律报错（E_UNKNOWN_FIELD），
 *    不静默丢弃——导入别人给的 JSON 时，丢字段等于悄悄改图。
 *  · 算法参数键不在结构白名单里（它们是开放集合，且 mode/join/rawBytes 等会被通用机制读取），
 *    未知参数键给 W_UNKNOWN_PARAM 警告，不阻断；错误与警告都回报，不吞。
 *  · 规范化不把算法默认参数写进图：默认值属于算法定义，写死进图会让算法升级后旧图行为被冻结。
 *  · 序列化键序稳定（对象键递归按字典序），同一张图永远得到同一串字符；
 *    分享串 = "EBG1." + base64url(UTF-8 JSON) + "." + CRC32 校验，任何一段坏了都能明确报错。
 */

import {
  ERROR_CODES,
  WARNING_CODES,
  issue,
  warning,
  throwErr,
} from "./errors.js";
import {
  SPECIAL_OPS,
  derivePorts,
  inputPortOf,
  outputPortOf,
  canConnect,
} from "./ports.js";
import { allowedDirectionsOf, defaultDirectionOf, resolveOp } from "./runtime.js";

export const GRAPH_SCHEMA_VERSION = 1;
export const SHARE_PREFIX = "EBG1";

const GRAPH_KEYS = ["schemaVersion", "nodes", "edges", "groups", "viewport"];
const NODE_KEYS = ["id", "opId", "direction", "params", "x", "y", "w", "collapsed", "disabled", "note"];
const EDGE_KEYS = ["id", "from", "to"];
const ENDPOINT_KEYS = ["node", "port"];
const GROUP_KEYS = ["id", "title", "x", "y", "w", "h"];
const VIEWPORT_KEYS = ["x", "y", "k"];

const GRAPH_KEY_SET = new Set(GRAPH_KEYS);
const NODE_KEY_SET = new Set(NODE_KEYS);
const EDGE_KEY_SET = new Set(EDGE_KEYS);
const ENDPOINT_KEY_SET = new Set(ENDPOINT_KEYS);
const GROUP_KEY_SET = new Set(GROUP_KEYS);
const VIEWPORT_KEY_SET = new Set(VIEWPORT_KEYS);

export function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function unknownKeys(obj, allowedSet) {
  const out = [];
  for (const k of Object.keys(obj)) if (!allowedSet.has(k)) out.push(k);
  return out;
}

function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

// ---------------------------------------------------------------- 创建

let _seq = 0;

/** 生成一个未被占用的节点 id（n1、n2……）。 */
export function nextNodeId(graph, prefix = "n") {
  const used = new Set((graph && graph.nodes ? graph.nodes : []).map((n) => n && n.id));
  let i = 1;
  while (used.has(prefix + i)) i++;
  return prefix + i;
}

/** 生成一个未被占用的边 id（e1、e2……）。 */
export function nextEdgeId(graph, prefix = "e") {
  const used = new Set((graph && graph.edges ? graph.edges : []).map((e) => e && e.id));
  let i = 1;
  while (used.has(prefix + i)) i++;
  return prefix + i;
}

/** 空图。 */
export function emptyGraph() {
  return {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [],
    edges: [],
    groups: [],
    viewport: { x: 0, y: 0, k: 1 },
  };
}

/**
 * 造一个节点（只补齐可选字段，不改算法参数）。
 * direction 缺省取算法默认方向；特殊节点不带 direction。
 */
export function createNode(spec = {}) {
  if (!isPlainObject(spec)) throwErr(ERROR_CODES.E_INVALID_FIELD, "createNode 需要对象参数");
  const opId = String(spec.opId || "");
  if (!opId) throwErr(ERROR_CODES.E_MISSING_FIELD, "节点缺少 opId", "node.opId");
  const node = {
    id: spec.id != null ? String(spec.id) : `n${++_seq}`,
    opId,
    params: isPlainObject(spec.params) ? { ...spec.params } : {},
    x: isFiniteNumber(spec.x) ? spec.x : 0,
    y: isFiniteNumber(spec.y) ? spec.y : 0,
  };
  if (!opId.startsWith("@")) {
    const op = resolveOp(opId);
    node.direction = spec.direction || defaultDirectionOf(op) || "encode";
  } else if (spec.direction) {
    node.direction = spec.direction;
  }
  if (isFiniteNumber(spec.w)) node.w = spec.w;
  if (spec.collapsed === true) node.collapsed = true;
  if (spec.disabled === true) node.disabled = true;
  if (typeof spec.note === "string" && spec.note) node.note = spec.note;
  return node;
}

/** 造一条边。 */
export function createEdge(spec = {}) {
  const from = spec.from || {};
  const to = spec.to || {};
  const edge = {
    id: spec.id != null ? String(spec.id) : `e${++_seq}`,
    from: { node: String(from.node == null ? "" : from.node), port: String(from.port == null ? "" : from.port) },
    to: { node: String(to.node == null ? "" : to.node), port: String(to.port == null ? "" : to.port) },
  };
  return edge;
}

/** 造图（不校验；需要保证合法请用 connect/validateGraph 或 checkGraph）。 */
export function createGraph(spec = {}) {
  const g = emptyGraph();
  for (const n of Array.isArray(spec.nodes) ? spec.nodes : []) g.nodes.push(createNode(n));
  for (const e of Array.isArray(spec.edges) ? spec.edges : []) g.edges.push(createEdge(e));
  for (const gr of Array.isArray(spec.groups) ? spec.groups : []) {
    g.groups.push({
      id: String(gr.id),
      title: String(gr.title == null ? "" : gr.title),
      x: isFiniteNumber(gr.x) ? gr.x : 0,
      y: isFiniteNumber(gr.y) ? gr.y : 0,
      w: isFiniteNumber(gr.w) ? gr.w : 200,
      h: isFiniteNumber(gr.h) ? gr.h : 120,
    });
  }
  if (isPlainObject(spec.viewport)) {
    g.viewport = {
      x: isFiniteNumber(spec.viewport.x) ? spec.viewport.x : 0,
      y: isFiniteNumber(spec.viewport.y) ? spec.viewport.y : 0,
      k: isFiniteNumber(spec.viewport.k) && spec.viewport.k > 0 ? spec.viewport.k : 1,
    };
  }
  return g;
}

/** 追加节点（返回新图，不改入参）。 */
export function addNode(graph, nodeSpec) {
  const g = cloneGraph(graph);
  const node = createNode({ ...nodeSpec, id: nodeSpec && nodeSpec.id != null ? nodeSpec.id : nextNodeId(g) });
  g.nodes.push(node);
  return g;
}

/** 追加边（不校验；需要连线期拒绝请用 connect）。 */
export function addEdge(graph, edgeSpec) {
  const g = cloneGraph(graph);
  const edge = createEdge({ ...edgeSpec, id: edgeSpec && edgeSpec.id != null ? edgeSpec.id : nextEdgeId(g) });
  g.edges.push(edge);
  return g;
}

export function removeNode(graph, nodeId) {
  const g = cloneGraph(graph);
  g.nodes = g.nodes.filter((n) => n.id !== nodeId);
  g.edges = g.edges.filter((e) => e.from.node !== nodeId && e.to.node !== nodeId);
  return g;
}

export function removeEdge(graph, edgeId) {
  const g = cloneGraph(graph);
  g.edges = g.edges.filter((e) => e.id !== edgeId);
  return g;
}

export function cloneGraph(graph) {
  return JSON.parse(JSON.stringify(graph));
}

/**
 * 连线：先加边再整体校验；只要出现「新增边引起的错误」就回滚。
 * 这样 UI 拖线时能拿到人话原因（类型不匹配 / 端口已占用 / 成环……）。
 * @returns {{ok:boolean, graph:object, errors:Array}}
 */
export function connect(graph, from, to) {
  const before = validateGraph(graph);
  const g = addEdge(graph, { from, to });
  const after = validateGraph(g);
  if (after.ok) return { ok: true, graph: g, errors: [], warnings: after.warnings };
  // 只回滚「这条线新引入」的错误：图里原本就有的问题不该算到这次拖线上
  const seen = new Set(before.errors.map((it) => `${it.code}\u0000${it.path}\u0000${it.message}`));
  const fresh = after.errors.filter((it) => !seen.has(`${it.code}\u0000${it.path}\u0000${it.message}`));
  if (!fresh.length) return { ok: true, graph: g, errors: [], warnings: after.warnings, preexisting: after.errors };
  return { ok: false, graph: cloneGraph(graph), errors: fresh };
}

// ---------------------------------------------------------------- 规范化

/**
 * 规范化：
 *  · 补 schemaVersion / groups / viewport；
 *  · 节点的 x/y 缺失补 0，params 缺失补 {}；
 *  · 边缺 id 时按顺序补 e1..（并给警告，不静默）；
 *  · 不填算法默认参数（见文件头）。
 * 返回新对象，不改入参。
 */
export function normalizeGraph(input, opts = {}) {
  const warnings = [];
  if (!isPlainObject(input)) {
    return { graph: emptyGraph(), warnings, error: issue(ERROR_CODES.E_GRAPH_TYPE, "图必须是 JSON 对象") };
  }
  const out = {
    schemaVersion: input.schemaVersion === undefined ? GRAPH_SCHEMA_VERSION : input.schemaVersion,
    nodes: [],
    edges: [],
    groups: [],
    viewport: { x: 0, y: 0, k: 1 },
  };
  const nodes = Array.isArray(input.nodes) ? input.nodes : [];
  nodes.forEach((n, i) => {
    if (!isPlainObject(n)) {
      out.nodes.push(n);
      return;
    }
    const node = { ...n };
    node.id = n.id == null ? `n${i + 1}` : n.id;
    node.opId = n.opId == null ? "" : n.opId;
    node.params = isPlainObject(n.params) ? { ...n.params } : {};
    node.x = isFiniteNumber(n.x) ? n.x : 0;
    node.y = isFiniteNumber(n.y) ? n.y : 0;
    if (node.direction === undefined && typeof node.opId === "string" && !node.opId.startsWith("@")) {
      const op = resolveOp(node.opId, opts.registry);
      const d = defaultDirectionOf(op);
      if (d) node.direction = d;
    }
    if (node.w !== undefined && !isFiniteNumber(node.w)) delete node.w;
    if (node.collapsed !== true) delete node.collapsed;
    if (node.disabled !== true) delete node.disabled;
    if (typeof node.note !== "string" || !node.note) delete node.note;
    out.nodes.push(node);
  });
  const edges = Array.isArray(input.edges) ? input.edges : [];
  const usedEdgeIds = new Set(edges.filter((e) => isPlainObject(e) && e.id != null).map((e) => String(e.id)));
  let edgeSeq = 0;
  edges.forEach((e, i) => {
    if (!isPlainObject(e)) {
      out.edges.push(e);
      return;
    }
    const edge = { id: e.id, from: { ...(isPlainObject(e.from) ? e.from : {}) }, to: { ...(isPlainObject(e.to) ? e.to : {}) } };
    if (edge.id == null || edge.id === "") {
      edgeSeq++;
      while (usedEdgeIds.has("e" + edgeSeq)) edgeSeq++;
      edge.id = "e" + edgeSeq;
      usedEdgeIds.add(edge.id);
      warnings.push(warning(WARNING_CODES.W_EDGE_ID_GENERATED, `第 ${i + 1} 条连线缺少 id，已补为 ${edge.id}`, `edges[${i}].id`));
    }
    out.edges.push(edge);
  });
  if (Array.isArray(input.groups)) {
    for (const gr of input.groups) {
      if (!isPlainObject(gr)) {
        out.groups.push(gr);
        continue;
      }
      out.groups.push({
        id: gr.id,
        title: gr.title == null ? "" : gr.title,
        x: gr.x,
        y: gr.y,
        w: gr.w,
        h: gr.h,
      });
    }
  }
  if (isPlainObject(input.viewport)) {
    out.viewport = {
      x: isFiniteNumber(input.viewport.x) ? input.viewport.x : 0,
      y: isFiniteNumber(input.viewport.y) ? input.viewport.y : 0,
      k: isFiniteNumber(input.viewport.k) && input.viewport.k > 0 ? input.viewport.k : 1,
    };
  }
  return { graph: out, warnings };
}

// ---------------------------------------------------------------- 校验

/** 找一条环（用于 E_CYCLE 的人话信息），只返回节点 id 序列。 */
function findCycle(graph) {
  const ids = graph.nodes.filter(isPlainObject).map((n) => n.id).filter((x) => typeof x === "string");
  const idSet = new Set(ids);
  const adj = new Map(ids.map((id) => [id, []]));
  for (const e of graph.edges) {
    if (!isPlainObject(e) || !isPlainObject(e.from) || !isPlainObject(e.to)) continue;
    const a = e.from.node;
    const b = e.to.node;
    if (idSet.has(a) && idSet.has(b)) adj.get(a).push(b);
  }
  const state = new Map(); // 0 未访问 / 1 栈内 / 2 完成
  const stack = [];
  let found = null;
  const dfs = (id) => {
    if (found) return;
    state.set(id, 1);
    stack.push(id);
    for (const nxt of adj.get(id) || []) {
      if (found) return;
      const s = state.get(nxt) || 0;
      if (s === 1) {
        const at = stack.indexOf(nxt);
        found = stack.slice(at).concat(nxt);
        return;
      }
      if (s === 0) dfs(nxt);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of ids) {
    if (!state.get(id)) dfs(id);
    if (found) break;
  }
  return found;
}

/**
 * 校验图。
 * @param {object} input 待校验的图（未规范化）。
 * @param {object} [opts]
 * @param {object} [opts.registry] 注册表（缺省用 configureRegistry 注入的）
 * @param {boolean|Set|Function} [opts.hasFiles] 产物文件提示（与 ports.derivePorts 同源）
 * @param {boolean} [opts.checkRequired=true] 是否校验必填端口（导入草稿时可关）
 * @param {boolean} [opts.checkTypes=true]
 * @returns {{ok:boolean, errors:Array, warnings:Array, schemaVersion:number|null}}
 */
export function validateGraph(input, opts = {}) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(input)) {
    return {
      ok: false,
      errors: [issue(ERROR_CODES.E_GRAPH_TYPE, "图必须是 JSON 对象（拿到 " + (Array.isArray(input) ? "数组" : typeof input) + "）", "")],
      warnings,
      schemaVersion: null,
    };
  }
  for (const k of unknownKeys(input, GRAPH_KEY_SET)) {
    errors.push(issue(ERROR_CODES.E_UNKNOWN_FIELD, `图对象出现未知字段「${k}」；v1 只允许 ${GRAPH_KEYS.join(" / ")}`, k));
  }
  if (input.schemaVersion === undefined) {
    errors.push(issue(ERROR_CODES.E_MISSING_FIELD, "缺少 schemaVersion；图格式 v1 必须写 schemaVersion: 1", "schemaVersion"));
  } else if (input.schemaVersion !== GRAPH_SCHEMA_VERSION) {
    errors.push(
      issue(
        ERROR_CODES.E_SCHEMA_VERSION,
        `不支持的图格式版本 ${JSON.stringify(input.schemaVersion)}；本内核只认 v1`,
        "schemaVersion",
        { got: input.schemaVersion, expected: GRAPH_SCHEMA_VERSION },
      ),
    );
  }
  if (!Array.isArray(input.nodes)) {
    errors.push(issue(ERROR_CODES.E_INVALID_FIELD, "nodes 必须是数组", "nodes"));
  }
  if (!Array.isArray(input.edges)) {
    errors.push(issue(ERROR_CODES.E_INVALID_FIELD, "edges 必须是数组", "edges"));
  }
  if (input.groups !== undefined && !Array.isArray(input.groups)) {
    errors.push(issue(ERROR_CODES.E_INVALID_FIELD, "groups 必须是数组", "groups"));
  }
  if (input.viewport !== undefined && !isPlainObject(input.viewport)) {
    errors.push(issue(ERROR_CODES.E_INVALID_FIELD, "viewport 必须是对象", "viewport"));
  }
  if (errors.length) return { ok: false, errors, warnings, schemaVersion: input.schemaVersion == null ? null : input.schemaVersion };

  const nodes = input.nodes;
  const edges = input.edges;
  const nodeIds = new Set();
  const tables = new Map();
  const nodeOf = new Map();

  nodes.forEach((n, i) => {
    const path = `nodes[${i}]`;
    if (!isPlainObject(n)) {
      errors.push(issue(ERROR_CODES.E_INVALID_FIELD, `第 ${i + 1} 个节点不是对象`, path));
      return;
    }
    for (const k of unknownKeys(n, NODE_KEY_SET)) {
      errors.push(issue(ERROR_CODES.E_UNKNOWN_FIELD, `节点出现未知字段「${k}」；v1 节点只允许 ${NODE_KEYS.join(" / ")}`, `${path}.${k}`));
    }
    if (n.id === undefined) {
      errors.push(issue(ERROR_CODES.E_MISSING_FIELD, `第 ${i + 1} 个节点缺少 id`, `${path}.id`));
    } else if (typeof n.id !== "string" || !n.id) {
      errors.push(issue(ERROR_CODES.E_INVALID_FIELD, `节点 id 必须是非空字符串（拿到 ${JSON.stringify(n.id)}）`, `${path}.id`));
    } else if (nodeIds.has(n.id)) {
      errors.push(issue(ERROR_CODES.E_DUP_NODE_ID, `节点 id 重复：「${n.id}」出现了不止一次`, `${path}.id`, { id: n.id }));
    } else {
      nodeIds.add(n.id);
      nodeOf.set(n.id, n);
    }
    if (n.opId === undefined) {
      errors.push(issue(ERROR_CODES.E_MISSING_FIELD, `节点 ${JSON.stringify(n.id)} 缺少 opId`, `${path}.opId`));
    } else if (typeof n.opId !== "string" || !n.opId) {
      errors.push(issue(ERROR_CODES.E_INVALID_FIELD, `节点 opId 必须是非空字符串（拿到 ${JSON.stringify(n.opId)}）`, `${path}.opId`));
    }
    if (n.params !== undefined && !isPlainObject(n.params)) {
      errors.push(issue(ERROR_CODES.E_INVALID_FIELD, "params 必须是对象", `${path}.params`));
    }
    for (const key of ["x", "y"]) {
      if (n[key] !== undefined && !isFiniteNumber(n[key])) {
        errors.push(issue(ERROR_CODES.E_INVALID_FIELD, `节点 ${key} 必须是有限数字（拿到 ${JSON.stringify(n[key])}）`, `${path}.${key}`));
      }
    }
    if (n.w !== undefined && !isFiniteNumber(n.w)) {
      errors.push(issue(ERROR_CODES.E_INVALID_FIELD, "节点 w 必须是有限数字", `${path}.w`));
    }
    for (const key of ["collapsed", "disabled"]) {
      if (n[key] !== undefined && typeof n[key] !== "boolean") {
        errors.push(issue(ERROR_CODES.E_INVALID_FIELD, `节点 ${key} 必须是布尔值`, `${path}.${key}`));
      }
    }
    if (n.note !== undefined && typeof n.note !== "string") {
      errors.push(issue(ERROR_CODES.E_INVALID_FIELD, "节点 note 必须是字符串", `${path}.note`));
    }
    if (typeof n.opId !== "string" || !n.opId) return;

    const table = derivePorts(n.opId, {
      registry: opts.registry,
      params: isPlainObject(n.params) ? n.params : {},
      direction: n.direction,
      hasFiles: opts.hasFiles,
    });
    if (!table) {
      errors.push(
        issue(
          ERROR_CODES.E_UNKNOWN_OP,
          `未知算法 id「${n.opId}」：注册表里没有这个 op，也不是特殊节点（@input/@output/@note/@const）`,
          `${path}.opId`,
          { opId: n.opId },
        ),
      );
      return;
    }
    tables.set(n.id, table);
    if (table.special) {
      if (n.direction !== undefined && n.direction !== "run") {
        errors.push(issue(ERROR_CODES.E_INVALID_DIRECTION, `特殊节点 ${n.opId} 不接受 direction=${JSON.stringify(n.direction)}`, `${path}.direction`));
      }
      if (n.opId === SPECIAL_OPS.INPUT) {
        const kind = String((n.params && n.params.kind) || "text");
        if (!["text", "hex", "base64", "file"].includes(kind)) {
          errors.push(issue(ERROR_CODES.E_SPECIAL_PARAM, `@input 的 kind 只能是 text/hex/base64/file（拿到 ${JSON.stringify(kind)}）`, `${path}.params.kind`));
        }
      }
      if (n.opId === SPECIAL_OPS.CONST) {
        const kind = String((n.params && n.params.kind) || "text");
        if (!["text", "hex", "base64"].includes(kind)) {
          errors.push(issue(ERROR_CODES.E_SPECIAL_PARAM, `@const 的 kind 只能是 text/hex/base64（拿到 ${JSON.stringify(kind)}）`, `${path}.params.kind`));
        }
      }
      if (n.opId === SPECIAL_OPS.OUTPUT) {
        const fmt = String((n.params && n.params.format) || "text");
        if (!["text", "hex", "download"].includes(fmt)) {
          errors.push(issue(ERROR_CODES.E_SPECIAL_PARAM, `@output 的 format 只能是 text/hex/download（拿到 ${JSON.stringify(fmt)}）`, `${path}.params.format`));
        }
      }
      return;
    }
    const dirs = allowedDirectionsOf(resolveOp(n.opId, opts.registry));
    if (n.direction === undefined) {
      errors.push(issue(ERROR_CODES.E_MISSING_FIELD, `算法节点 ${n.opId} 缺少 direction（可选值：${dirs.join(" / ")}）`, `${path}.direction`));
    } else if (!dirs.includes(n.direction)) {
      errors.push(
        issue(
          ERROR_CODES.E_INVALID_DIRECTION,
          `算法节点 ${n.opId} 不支持 direction=${JSON.stringify(n.direction)}；该算法可用方向：${dirs.join(" / ") || "（无）"}`,
          `${path}.direction`,
          { opId: n.opId, got: n.direction, allowed: dirs },
        ),
      );
    }
    // 参数键白名单 → 只告警：mode/join/rawBytes 等键会被通用机制读取，硬性拒绝会误伤合规配方
    const op = resolveOp(n.opId, opts.registry);
    if (op && isPlainObject(n.params)) {
      const declared = new Set((op.params || []).map((d) => d.key));
      const fieldKeys = new Set((op.fields || []).map((f) => f.key));
      const generic = new Set(["mode", "join", "rawBytes", "dir"]);
      for (const k of Object.keys(n.params)) {
        if (declared.has(k) || fieldKeys.has(k) || generic.has(k)) continue;
        warnings.push(
          warning(
            WARNING_CODES.W_UNKNOWN_PARAM,
            `节点 ${n.id}（${n.opId}）的参数「${k}」不在算法定义里，执行时会被算法忽略`,
            `${path}.params.${k}`,
          ),
        );
      }
    }
  });

  // ---- 边 ----
  const edgeIds = new Set();
  const occupancy = new Map(); // `${node}\u0000${port}` -> [edgeIndex...]
  const edgePairs = new Map();
  edges.forEach((e, i) => {
    const path = `edges[${i}]`;
    if (!isPlainObject(e)) {
      errors.push(issue(ERROR_CODES.E_INVALID_FIELD, `第 ${i + 1} 条连线不是对象`, path));
      return;
    }
    for (const k of unknownKeys(e, EDGE_KEY_SET)) {
      errors.push(issue(ERROR_CODES.E_UNKNOWN_FIELD, `连线出现未知字段「${k}」；v1 连线只允许 ${EDGE_KEYS.join(" / ")}`, `${path}.${k}`));
    }
    if (e.id === undefined) {
      errors.push(issue(ERROR_CODES.E_MISSING_FIELD, `第 ${i + 1} 条连线缺少 id`, `${path}.id`));
    } else if (typeof e.id !== "string" || !e.id) {
      errors.push(issue(ERROR_CODES.E_INVALID_FIELD, "连线 id 必须是非空字符串", `${path}.id`));
    } else if (edgeIds.has(e.id)) {
      errors.push(issue(ERROR_CODES.E_DUP_EDGE_ID, `连线 id 重复：「${e.id}」`, `${path}.id`, { id: e.id }));
    } else {
      edgeIds.add(e.id);
    }
    for (const end of ["from", "to"]) {
      const ep = e[end];
      if (!isPlainObject(ep)) {
        errors.push(issue(ERROR_CODES.E_INVALID_FIELD, `连线 ${end} 必须是 { node, port } 对象`, `${path}.${end}`));
        return;
      }
      for (const k of unknownKeys(ep, ENDPOINT_KEY_SET)) {
        errors.push(issue(ERROR_CODES.E_UNKNOWN_FIELD, `连线端点出现未知字段「${k}」；只允许 node / port`, `${path}.${end}.${k}`));
      }
      if (typeof ep.node !== "string" || !ep.node) {
        errors.push(issue(ERROR_CODES.E_INVALID_FIELD, `连线 ${end}.node 必须是非空字符串`, `${path}.${end}.node`));
      }
      if (typeof ep.port !== "string" || !ep.port) {
        errors.push(issue(ERROR_CODES.E_INVALID_FIELD, `连线 ${end}.port 必须是非空字符串`, `${path}.${end}.port`));
      }
    }
    if (typeof e.from?.node !== "string" || typeof e.to?.node !== "string") return;
    const srcNode = nodeOf.get(e.from.node);
    const dstNode = nodeOf.get(e.to.node);
    if (!srcNode) {
      errors.push(issue(ERROR_CODES.E_DANGLING_EDGE, `连线起点指向不存在的节点「${e.from.node}」`, `${path}.from.node`, { node: e.from.node }));
    }
    if (!dstNode) {
      errors.push(issue(ERROR_CODES.E_DANGLING_EDGE, `连线终点指向不存在的节点「${e.to.node}」`, `${path}.to.node`, { node: e.to.node }));
    }
    if (!srcNode || !dstNode) return;
    if (e.from.node === e.to.node) {
      errors.push(issue(ERROR_CODES.E_SELF_LOOP, `节点「${e.from.node}」不能连到自己（自环必然成环）`, path));
      return;
    }
    const pairKey = `${e.from.node}\u0000${e.from.port}\u0000${e.to.node}\u0000${e.to.port}`;
    if (edgePairs.has(pairKey)) {
      errors.push(
        issue(
          ERROR_CODES.E_DUP_EDGE,
          `重复连线：${e.from.node}.${e.from.port} → ${e.to.node}.${e.to.port} 已经有一条（${edgePairs.get(pairKey)}）`,
          path,
        ),
      );
    } else {
      edgePairs.set(pairKey, e.id == null ? `edges[${i}]` : e.id);
    }
    const occKey = `${e.to.node}\u0000${e.to.port}`;
    if (occupancy.has(occKey)) {
      const first = occupancy.get(occKey)[0];
      errors.push(
        issue(
          ERROR_CODES.E_PORT_OCCUPIED,
          `输入端口「${e.to.node}.${e.to.port}」只能接一条线，已被 edges[${first}] 占用；多路输入请用不同端口（in / field:* / param:*）或插入合流节点`,
          `${path}.to.port`,
          { node: e.to.node, port: e.to.port, firstEdgeIndex: first },
        ),
      );
    } else {
      occupancy.set(occKey, [i]);
    }
    const srcTable = tables.get(e.from.node);
    const dstTable = tables.get(e.to.node);
    if (!srcTable || !dstTable) return;
    const outPort = outputPortOf(srcTable, e.from.port);
    if (!outPort) {
      errors.push(
        issue(
          ERROR_CODES.E_UNKNOWN_PORT,
          `节点「${e.from.node}」没有输出端口「${e.from.port}」；可用输出端口：${srcTable.outputs.map((p) => p.name).join(" / ") || "（无）"}`,
          `${path}.from.port`,
          { node: e.from.node, port: e.from.port, available: srcTable.outputs.map((p) => p.name) },
        ),
      );
      return;
    }
    const inPort = inputPortOf(dstTable, e.to.port);
    if (!inPort) {
      errors.push(
        issue(
          ERROR_CODES.E_UNKNOWN_PORT,
          `节点「${e.to.node}」没有输入端口「${e.to.port}」；可用输入端口：${dstTable.inputs.map((p) => p.name).join(" / ") || "（无）"}`,
          `${path}.to.port`,
          { node: e.to.node, port: e.to.port, available: dstTable.inputs.map((p) => p.name) },
        ),
      );
      return;
    }
    if (opts.checkTypes !== false) {
      const outType = outPort.accepts[0];
      if (!canConnect(outType, inPort)) {
        errors.push(
          issue(
            ERROR_CODES.E_TYPE_MISMATCH,
            `类型不匹配：${e.from.node}.${e.from.port} 输出 ${outType}，而 ${e.to.node}.${e.to.port} 只收 ${inPort.accepts.join("/")}；` +
              `请插入显式转换节点（如 hex/base64 ↔ 文本），内核不会自行猜编码`,
            path,
            { fromType: outType, accepts: inPort.accepts.slice() },
          ),
        );
      }
    }
  });

  // ---- 必填端口 ----
  if (opts.checkRequired !== false) {
    nodes.forEach((n, i) => {
      if (!isPlainObject(n) || typeof n.id !== "string") return;
      const table = tables.get(n.id);
      if (!table || table.special && n.opId === SPECIAL_OPS.NOTE) return;
      if (n.disabled === true) return; // 禁用节点走旁路，不读输入
      for (const p of table.inputs) {
        if (!p.required) continue;
        if (!occupancy.has(`${n.id}\u0000${p.name}`)) {
          errors.push(
            issue(
              ERROR_CODES.E_REQUIRED_PORT_UNCONNECTED,
              `节点 ${n.id}（${n.opId}）的必填端口「${p.name}」没有接线；请从上游拉一条线，或把该节点设为禁用（旁路）`,
              `nodes[${i}]`,
              { node: n.id, port: p.name },
            ),
          );
        }
      }
    });
  }

  // ---- 分组 / 视口 ----
  const groupIds = new Set();
  (Array.isArray(input.groups) ? input.groups : []).forEach((g, i) => {
    const path = `groups[${i}]`;
    if (!isPlainObject(g)) {
      errors.push(issue(ERROR_CODES.E_INVALID_FIELD, `第 ${i + 1} 个分组不是对象`, path));
      return;
    }
    for (const k of unknownKeys(g, GROUP_KEY_SET)) {
      errors.push(issue(ERROR_CODES.E_UNKNOWN_FIELD, `分组出现未知字段「${k}」；只允许 ${GROUP_KEYS.join(" / ")}`, `${path}.${k}`));
    }
    if (typeof g.id !== "string" || !g.id) {
      errors.push(issue(ERROR_CODES.E_INVALID_FIELD, "分组 id 必须是非空字符串", `${path}.id`));
    } else if (groupIds.has(g.id)) {
      errors.push(issue(ERROR_CODES.E_DUP_GROUP_ID, `分组 id 重复：「${g.id}」`, `${path}.id`));
    } else {
      groupIds.add(g.id);
    }
    if (typeof g.title !== "string") errors.push(issue(ERROR_CODES.E_INVALID_FIELD, "分组 title 必须是字符串", `${path}.title`));
    for (const k of ["x", "y", "w", "h"]) {
      if (!isFiniteNumber(g[k])) errors.push(issue(ERROR_CODES.E_INVALID_FIELD, `分组 ${k} 必须是有限数字`, `${path}.${k}`));
    }
  });

  if (isPlainObject(input.viewport)) {
    const seen = unknownKeys(input.viewport, VIEWPORT_KEY_SET);
    for (const k of seen) {
      errors.push(issue(ERROR_CODES.E_UNKNOWN_FIELD, `view 出现未知字段「${k}」；只允许 x / y / k`, `viewport.${k}`));
    }
    for (const k of ["x", "y"]) {
      if (!isFiniteNumber(input.viewport[k])) errors.push(issue(ERROR_CODES.E_INVALID_FIELD, `viewport.${k} 必须是有限数字`, `viewport.${k}`));
    }
    if (!isFiniteNumber(input.viewport.k) || input.viewport.k <= 0) {
      errors.push(issue(ERROR_CODES.E_INVALID_FIELD, "viewport.k 必须是大于 0 的有限数字", "viewport.k"));
    }
  }

  // ---- 成环 ----
  const cycle = findCycle(input);
  if (cycle) {
    errors.push(
      issue(
        ERROR_CODES.E_CYCLE,
        `图中有环：${cycle.join(" → ")}；节点视图只执行有向无环图，请删掉回边`,
        "",
        { cycle },
      ),
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    schemaVersion: input.schemaVersion == null ? null : input.schemaVersion,
  };
}

/** 校验并在通过时返回规范化图（导入入口统一走这里）。 */
export function parseGraph(input, opts = {}) {
  const norm = normalizeGraph(input, opts);
  const v = validateGraph(norm.graph, opts);
  const errors = [];
  if (norm.error) errors.push(norm.error);
  if (!norm.error) errors.push(...v.errors);
  return {
    ok: v.ok && !norm.error,
    graph: norm.graph,
    errors,
    warnings: [...norm.warnings, ...v.warnings],
  };
}

// ---------------------------------------------------------------- 稳定序列化

/**
 * 稳定 JSON：对象键递归按字典序，数组保持顺序。
 * 同一张图 → 同一串字符（分享链接、去重、缓存键都依赖它）。
 */
export function stableStringify(value) {
  const walk = (v) => {
    if (v === null) return "null";
    const t = typeof v;
    if (t === "number") return Number.isFinite(v) ? JSON.stringify(v) : "null";
    if (t === "boolean") return v ? "true" : "false";
    if (t === "string") return JSON.stringify(v);
    if (t === "bigint") return JSON.stringify(v.toString());
    if (t === "undefined" || t === "function" || t === "symbol") return "null";
    if (Array.isArray(v)) return "[" + v.map((x) => (x === undefined ? "null" : walk(x))).join(",") + "]";
    if (v instanceof Uint8Array) return JSON.stringify({ $bytes: bytesToHex(v) });
    if (v instanceof Map) {
      const obj = {};
      for (const [k, val] of v) obj[String(k)] = val;
      return walk(obj);
    }
    const keys = Object.keys(v).filter((k) => v[k] !== undefined && typeof v[k] !== "function").sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + walk(v[k])).join(",") + "}";
  };
  return walk(value);
}

export function bytesToHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

/**
 * 扫描敏感参数（定义里 sensitive:true 且有值）。
 * @returns {Array<{nodeId:string, opId:string, paramKey:string, path:string, promoted:boolean}>}
 */
export function findSensitiveValues(graph, opts = {}) {
  const hits = [];
  const nodes = Array.isArray(graph && graph.nodes) ? graph.nodes : [];
  const promoted = new Set();
  for (const e of (graph && graph.edges) || []) {
    if (e && e.to && typeof e.to.port === "string" && e.to.port.startsWith("param:")) {
      promoted.add(`${e.to.node}\u0000${e.to.port.slice(6)}`);
    }
  }
  nodes.forEach((n, i) => {
    const op = resolveOp(n.opId, opts.registry);
    if (!op) return;
    for (const d of op.params || []) {
      if (!d || d.sensitive !== true) continue;
      const has = isPlainObject(n.params) && Object.prototype.hasOwnProperty.call(n.params, d.key);
      const val = has ? n.params[d.key] : undefined;
      const hasValue = has && val !== "" && val != null;
      const isPromoted = promoted.has(`${n.id}\u0000${d.key}`);
      if (!hasValue && !isPromoted) continue;
      hits.push({
        nodeId: n.id,
        opId: n.opId,
        paramKey: d.key,
        path: `nodes[${i}].params.${d.key}`,
        promoted: isPromoted,
        hasValue,
      });
    }
  });
  return hits;
}

/**
 * 导出图 JSON。
 * 默认剔除 sensitive:true 参数的值（置空串），并在 stripped 里逐条列出被剔除的位置。
 * @param {object} graph
 * @param {object} [opts]
 * @param {boolean} [opts.stripSensitive=true]
 * @param {boolean} [opts.pretty=false]
 * @param {boolean} [opts.validate=true] 导出前校验（不合法则 ok:false）
 * @returns {{ok:boolean, graph:object|null, json:string|null, stripped:Array, errors:Array, warnings:Array}}
 */
export function exportGraphJSON(graph, opts = {}) {
  const stripSensitive = opts.stripSensitive !== false;
  const norm = normalizeGraph(graph, opts);
  const v = validateGraph(norm.graph, opts);
  if (opts.validate !== false && !v.ok) {
    return { ok: false, graph: null, json: null, stripped: [], errors: v.errors, warnings: [...norm.warnings, ...v.warnings] };
  }
  const out = cloneGraph(norm.graph);
  const stripped = [];
  if (stripSensitive) {
    const hits = findSensitiveValues(out, opts);
    for (const h of hits) {
      if (!h.hasValue) {
        stripped.push({ ...h, action: "promoted-port" });
        continue;
      }
      out.nodes.find((n) => n.id === h.nodeId).params[h.paramKey] = "";
      stripped.push({ ...h, action: "blanked" });
    }
  }
  const json = opts.pretty ? JSON.stringify(out, null, 2) : stableStringify(out);
  return { ok: true, graph: out, json, stripped, errors: [], warnings: [...norm.warnings, ...v.warnings] };
}

/** 导入图 JSON（文本或对象）。 */
export function importGraphJSON(input, opts = {}) {
  if (typeof input === "string") {
    let obj;
    try {
      obj = JSON.parse(input);
    } catch (e) {
      return {
        ok: false,
        graph: null,
        errors: [issue(ERROR_CODES.E_GRAPH_TYPE, `JSON 解析失败：${e && e.message ? e.message : e}`)],
        warnings: [],
      };
    }
    return parseGraph(obj, opts);
  }
  return parseGraph(input, opts);
}

// ---------------------------------------------------------------- CRC32 / base64url

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32Hex(str) {
  const bytes = new TextEncoder().encode(str);
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

function b64urlEncodeBytes(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecodeBytes(s) {
  const b64 = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  let bytes;
  if (typeof atob === "function") {
    const bin = atob(b64 + pad);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else {
    bytes = new Uint8Array(Buffer.from(b64 + pad, "base64"));
  }
  return bytes;
}

/**
 * 分享串：EBG1.<base64url(稳定 JSON)>.<CRC32 8 位 hex>
 *  · 口令类参数默认剔除（同 exportGraphJSON）；
 *  · 只是编码 + 校验，**不是加密**：链接泄露即等于图泄露（回执写明）。
 * @returns {{ok:boolean, share:string|null, stripped:Array, errors:Array, warnings:Array}}
 */
export function shareGraph(graph, opts = {}) {
  const exp = exportGraphJSON(graph, { ...opts, pretty: false });
  if (!exp.ok) return { ok: false, share: null, stripped: [], errors: exp.errors, warnings: exp.warnings };
  const payload = b64urlEncodeBytes(new TextEncoder().encode(exp.json));
  const share = `${SHARE_PREFIX}.${payload}.${crc32Hex(exp.json)}`;
  return { ok: true, share, stripped: exp.stripped, errors: [], warnings: exp.warnings };
}

/** 解析分享串（校验前缀、CRC、JSON、图格式）。 */
export function parseShare(share, opts = {}) {
  const s = String(share || "").trim();
  const parts = s.split(".");
  if (parts.length !== 3 || parts[0] !== SHARE_PREFIX) {
    return {
      ok: false,
      graph: null,
      errors: [
        issue(
          ERROR_CODES.E_SHARE_FORMAT,
          `分享串格式应为 ${SHARE_PREFIX}.<数据>.<校验>（拿到 ${parts.length} 段，前缀 ${JSON.stringify(parts[0])}）`,
        ),
      ],
      warnings: [],
    };
  }
  let json;
  try {
    json = new TextDecoder().decode(b64urlDecodeBytes(parts[1]));
  } catch (e) {
    return { ok: false, graph: null, errors: [issue(ERROR_CODES.E_SHARE_FORMAT, `分享串数据段解码失败：${e && e.message}`)], warnings: [] };
  }
  const crc = crc32Hex(json);
  if (crc !== parts[2]) {
    return {
      ok: false,
      graph: null,
      errors: [
        issue(ERROR_CODES.E_SHARE_CHECKSUM, `分享串校验失败（期望 ${crc}，实际 ${parts[2]}）：链接被截断或改写过`, "", {
          expected: crc,
          got: parts[2],
        }),
      ],
      warnings: [],
    };
  }
  return importGraphJSON(json, opts);
}
