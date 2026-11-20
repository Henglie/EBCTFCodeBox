/**
 * canvasModel.js — 节点画布纯函数层（无 DOM、无事件、无算法）。
 *
 * 只做四件事：
 *   1. 图格式 v1 的克隆 / 规范化 / 结构校验（未知字段保留，保证往返不丢数据）；
 *   2. 端口几何：端口表 → 端口行号 → 节点尺寸 → 锚点坐标；
 *   3. SVG 贝塞尔走线；
 *   4. 连线合法性判定（方向、类型、自连、重复、成环）与对齐吸附计算。
 *
 * 图格式 v1（MT809 冻结）：
 *   { schemaVersion:1,
 *     nodes:[{ id, opId, direction, params, x, y, w?, collapsed?, disabled?, note? }],
 *     edges:[{ id, from:{node,port}, to:{node,port} }],
 *     groups:[{ id, title, x, y, w, h }],
 *     viewport:{ x, y, k } }
 *
 * 画布不认识任何算法的语义：端口表由宿主通过 portProvider 注入。
 */

export const SCHEMA_VERSION = 1;

/** 几何常量：必须与 nodeview.css 中的 --nv-head-h / --nv-row-h 一致。 */
export const GEO = Object.freeze({
  head: 30,
  row: 22,
  padTop: 6,
  padBottom: 6,
  width: 208,
  minWidth: 140,
  maxWidth: 360,
  collapsedHeight: 30,
  noteWidth: 200,
  noteHeight: 120,
  grid: 8,
  minZoom: 0.15,
  maxZoom: 4,
});

const SPECIAL_NOTE = '@note';
const DEFAULT_PORTS = Object.freeze([
  Object.freeze({ id: 'in', dir: 'in', type: 'text', label: 'in' }),
  Object.freeze({ id: 'out', dir: 'out', type: 'bytes', label: 'out' }),
]);

export function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function num(v, fallback = 0) {
  return Number.isFinite(v) ? v : fallback;
}

function str(v, fallback = '') {
  return typeof v === 'string' ? v : fallback;
}

/** 结构化错误：code 供宿主与测试断言，message 给人看。 */
export class NvGraphError extends Error {
  constructor(code, message, detail) {
    super(message || code);
    this.name = 'NvGraphError';
    this.code = code;
    this.detail = detail || null;
  }
}

export function isNoteNode(node) {
  return !!node && node.opId === SPECIAL_NOTE;
}

/** 图格式 v1 规范化：补齐缺省、去重校验、悬空连线直接报错（交还宿主修）。 */
export function normalizeGraph(raw, { strict = true } = {}) {
  if (!raw || typeof raw !== 'object') throw new NvGraphError('graph/not-object', 'graph must be an object');
  const schemaVersion = raw.schemaVersion === undefined ? SCHEMA_VERSION : raw.schemaVersion;
  if (schemaVersion !== SCHEMA_VERSION) {
    throw new NvGraphError('graph/schema-version', `unsupported schemaVersion: ${schemaVersion}`);
  }
  const g = {
    schemaVersion: SCHEMA_VERSION,
    nodes: [],
    edges: [],
    groups: [],
    viewport: { x: 0, y: 0, k: 1 },
  };
  const seenNode = new Set();
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  for (const n of nodes) {
    if (!n || typeof n !== 'object') throw new NvGraphError('node/not-object', 'node must be an object');
    const id = str(n.id);
    if (!id) throw new NvGraphError('node/empty-id', 'node.id is required');
    if (seenNode.has(id)) throw new NvGraphError('node/duplicate-id', `duplicate node id: ${id}`, { id });
    seenNode.add(id);
    const opId = str(n.opId, '@unknown');
    const w = clamp(num(n.w, GEO.width), GEO.minWidth, GEO.maxWidth);
    const node = {
      ...clone(n),
      id,
      opId,
      direction: n.direction === 'decode' ? 'decode' : (n.direction === 'encode' ? 'encode' : str(n.direction, 'encode')),
      params: n.params && typeof n.params === 'object' ? clone(n.params) : {},
      x: num(n.x, 0),
      y: num(n.y, 0),
      w,
    };
    if (n.collapsed === true) node.collapsed = true; else delete node.collapsed;
    if (n.disabled === true) node.disabled = true; else delete node.disabled;
    if (typeof n.note === 'string') node.note = n.note;
    g.nodes.push(node);
  }
  const nodeById = new Map(g.nodes.map((n) => [n.id, n]));
  const seenEdge = new Set();
  const edges = Array.isArray(raw.edges) ? raw.edges : [];
  for (const e of edges) {
    if (!e || typeof e !== 'object') throw new NvGraphError('edge/not-object', 'edge must be an object');
    const id = str(e.id);
    if (!id) throw new NvGraphError('edge/empty-id', 'edge.id is required');
    if (seenEdge.has(id)) throw new NvGraphError('edge/duplicate-id', `duplicate edge id: ${id}`, { id });
    seenEdge.add(id);
    const from = e.from || {};
    const to = e.to || {};
    const fromNode = str(from.node);
    const toNode = str(to.node);
    const fromPort = str(from.port);
    const toPort = str(to.port);
    if (!fromNode || !toNode || !fromPort || !toPort) {
      throw new NvGraphError('edge/incomplete', `edge ${id} is incomplete`, { id });
    }
    if (!nodeById.has(fromNode)) throw new NvGraphError('edge/dangling', `edge ${id} from unknown node ${fromNode}`, { id, node: fromNode });
    if (!nodeById.has(toNode)) throw new NvGraphError('edge/dangling', `edge ${id} to unknown node ${toNode}`, { id, node: toNode });
    g.edges.push({ ...clone(e), id, from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } });
  }
  const seenGroup = new Set();
  const groups = Array.isArray(raw.groups) ? raw.groups : [];
  for (const gr of groups) {
    if (!gr || typeof gr !== 'object') continue;
    const id = str(gr.id);
    if (!id) throw new NvGraphError('group/empty-id', 'group.id is required');
    if (seenGroup.has(id)) throw new NvGraphError('group/duplicate-id', `duplicate group id: ${id}`, { id });
    seenGroup.add(id);
    g.groups.push({
      ...clone(gr),
      id,
      title: str(gr.title, ''),
      x: num(gr.x, 0),
      y: num(gr.y, 0),
      w: Math.max(80, num(gr.w, 240)),
      h: Math.max(60, num(gr.h, 160)),
    });
  }
  const vp = raw.viewport || {};
  g.viewport = {
    x: num(vp.x, 0),
    y: num(vp.y, 0),
    k: clamp(num(vp.k, 1), GEO.minZoom, GEO.maxZoom),
  };
  if (strict) {
    for (const key of ['nodes', 'edges', 'groups', 'viewport']) {
      void key;
    }
  }
  return g;
}

/** 端口表：宿主回调可能返回 null / 数组；统一成 {title, ports[]}。 */
export function normalizePortTable(table, opId) {
  if (Array.isArray(table)) return { title: opId, ports: table.map(portEntry) };
  if (table && Array.isArray(table.ports)) {
    return { title: str(table.title, opId), ports: table.ports.map(portEntry) };
  }
  return { title: opId, ports: DEFAULT_PORTS.map((p) => ({ ...p })) };
}

function portEntry(p) {
  const id = str(p && p.id, '');
  const dir = p && p.dir === 'in' ? 'in' : (p && p.dir === 'out' ? 'out' : (id.startsWith('out') || id === 'files' ? 'out' : 'in'));
  return {
    id,
    dir,
    type: str(p && p.type, 'text'),
    label: str(p && p.label, id),
    required: !!(p && p.required),
  };
}

/** 把端口分成左右两列并记录行号，供锚点计算使用。 */
export function portLayout(ports) {
  const ins = [];
  const outs = [];
  for (const p of ports) (p.dir === 'out' ? outs : ins).push(p);
  const index = new Map();
  ins.forEach((p, i) => index.set(p.id, { col: 'in', row: i }));
  outs.forEach((p, i) => index.set(p.id, { col: 'out', row: i }));
  return { ins, outs, index };
}

export function nodeSize(node, ports, geo = GEO) {
  if (isNoteNode(node)) {
    return { w: clamp(num(node.w, geo.noteWidth), geo.minWidth, geo.maxWidth), h: num(node.h, geo.noteHeight), rows: { in: 0, out: 0 } };
  }
  const { ins, outs } = portLayout(ports);
  const w = clamp(num(node.w, geo.width), geo.minWidth, geo.maxWidth);
  if (node.collapsed === true) return { w, h: geo.collapsedHeight, rows: { in: ins.length, out: outs.length } };
  const rows = Math.max(ins.length, outs.length, 1);
  const h = geo.head + geo.padTop + rows * geo.row + geo.padBottom;
  return { w, h, rows: { in: ins.length, out: outs.length } };
}

/** 端口锚点（世界坐标）。rtl 时输入口在右、输出口在左。 */
export function portAnchor(node, portId, ports, geo = GEO, rtl = false) {
  const size = nodeSize(node, ports, geo);
  if (isNoteNode(node)) return null;
  const layout = portLayout(ports);
  const slot = layout.index.get(portId);
  if (!slot) return null;
  const outSide = rtl ? -1 : 1;
  const x = slot.col === 'out'
    ? (outSide > 0 ? node.x + size.w : node.x)
    : (outSide > 0 ? node.x : node.x + size.w);
  let y;
  if (node.collapsed === true) {
    y = node.y + geo.head / 2;
  } else {
    y = node.y + geo.head + geo.padTop + slot.row * geo.row + geo.row / 2;
  }
  return { x, y };
}

/** 三次贝塞尔：输出口水平切出，输入口水平切入。 */
export function edgePath(p1, p2, rtl = false) {
  if (!p1 || !p2) return '';
  const sign = rtl ? -1 : 1;
  const dx = Math.abs(p2.x - p1.x);
  const c = clamp(dx * 0.5, 40, 220) * sign;
  return `M ${round(p1.x)} ${round(p1.y)} C ${round(p1.x + c)} ${round(p1.y)}, ${round(p2.x - c)} ${round(p2.y)}, ${round(p2.x)} ${round(p2.y)}`;
}

function round(n) {
  return Math.round(n * 10) / 10;
}

export function nodeBox(node, ports, geo = GEO) {
  const size = nodeSize(node, ports, geo);
  return { x: node.x, y: node.y, w: size.w, h: size.h };
}

export function graphBBox(nodes, groups = []) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const push = (x, y, w, h) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  };
  for (const n of nodes) if (n.box) push(n.box.x, n.box.y, n.box.w, n.box.h);
  for (const g of groups) push(g.x, g.y, g.w, g.h);
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * 连线合法性。返回 {ok:true} 或 {ok:false, code, vars}。
 * code ∈ node-missing / port-missing / direction / self / duplicate / type / cycle
 */
export function validateConnection({ graph, from, to, getPorts, rtl = false }) {
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const a = nodes.get(from.node);
  const b = nodes.get(to.node);
  if (!a || !b) return { ok: false, code: 'node-missing', vars: { node: !a ? from.node : to.node } };
  const pa = normalizePortTable(getPorts(a), a.opId).ports.find((p) => p.id === from.port);
  const pb = normalizePortTable(getPorts(b), b.opId).ports.find((p) => p.id === to.port);
  if (!pa) return { ok: false, code: 'port-missing', vars: { port: from.port } };
  if (!pb) return { ok: false, code: 'port-missing', vars: { port: to.port } };
  if (pa.dir !== 'out' || pb.dir !== 'in') return { ok: false, code: 'direction', vars: { from: pa.dir, to: pb.dir } };
  if (from.node === to.node) return { ok: false, code: 'self', vars: {} };
  const dup = graph.edges.some((e) => e.from.node === from.node && e.from.port === from.port && e.to.node === to.node && e.to.port === to.port);
  if (dup) return { ok: false, code: 'duplicate', vars: {} };
  const compat = pa.type === pb.type || pa.type === 'any' || pb.type === 'any';
  if (!compat) return { ok: false, code: 'type', vars: { from: pa.type, to: pb.type } };
  if (createsCycle(graph, from.node, to.node)) return { ok: false, code: 'cycle', vars: {} };
  void rtl;
  return { ok: true };
}

/** 从 to 顺着出边能否走回 from（连 from→to 会成环）。 */
export function createsCycle(graph, fromNode, toNode) {
  if (fromNode === toNode) return true;
  const adj = new Map();
  for (const e of graph.edges) {
    if (!adj.has(e.from.node)) adj.set(e.from.node, []);
    adj.get(e.from.node).push(e.to.node);
  }
  const stack = [toNode];
  const seen = new Set([toNode]);
  while (stack.length) {
    const cur = stack.pop();
    if (cur === fromNode) return true;
    for (const nxt of adj.get(cur) || []) {
      if (!seen.has(nxt)) {
        seen.add(nxt);
        stack.push(nxt);
      }
    }
  }
  return false;
}

/** 选中集合的外接框（世界坐标）。 */
export function selectionBBox(boxes) {
  if (!boxes.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of boxes) {
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * 拖拽吸附：先找与其它节点的边/中线对齐（阈值内取最近），否则落到网格。
 * 返回相对当前外接框的位移与参考线（世界坐标）。
 */
export function computeSnap({ moving, others, threshold = 6, grid = GEO.grid, snapAlign = true, snapGrid = true }) {
  const result = { dx: 0, dy: 0, guides: [], snappedX: false, snappedY: false };
  if (!moving) return result;
  const movingX = [moving.x, moving.x + moving.w / 2, moving.x + moving.w];
  const movingY = [moving.y, moving.y + moving.h / 2, moving.y + moving.h];
  let bestX = null;
  let bestY = null;
  if (snapAlign) {
    for (const o of others) {
      for (const cand of [o.x, o.x + o.w / 2, o.x + o.w]) {
        for (const m of movingX) {
          const d = cand - m;
          if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, pos: cand };
        }
      }
      for (const cand of [o.y, o.y + o.h / 2, o.y + o.h]) {
        for (const m of movingY) {
          const d = cand - m;
          if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, pos: cand };
        }
      }
    }
  }
  if (bestX) {
    result.dx = bestX.d;
    result.snappedX = true;
    result.guides.push({ axis: 'x', pos: bestX.pos });
  } else if (snapGrid) {
    const target = Math.round(moving.x / grid) * grid;
    result.dx = target - moving.x;
    result.snappedX = Math.abs(result.dx) < 0.001 ? false : true;
  }
  if (bestY) {
    result.dy = bestY.d;
    result.snappedY = true;
    result.guides.push({ axis: 'y', pos: bestY.pos });
  } else if (snapGrid) {
    const target = Math.round(moving.y / grid) * grid;
    result.dy = target - moving.y;
    result.snappedY = Math.abs(result.dy) < 0.001 ? false : true;
  }
  return result;
}

/** 生成不冲突的 id。 */
export function createId(prefix, existing) {
  let i = 1;
  let id = `${prefix}-${i}`;
  while (existing.has(id)) {
    i += 1;
    id = `${prefix}-${i}`;
  }
  existing.add(id);
  return id;
}

/** 深比较图（字段顺序无关），用于判断一次交互是否真的改了图。 */
export function graphEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return stableStringify(a) === stableStringify(b);
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

/** 把图缩放到指定视口尺寸内（fit）。 */
export function fitViewport(bbox, width, height, { padding = 48, minK = GEO.minZoom, maxK = GEO.maxZoom } = {}) {
  if (!bbox || bbox.w <= 0 || bbox.h <= 0) return { x: width / 2, y: height / 2, k: 1 };
  const k = clamp(Math.min((width - padding * 2) / bbox.w, (height - padding * 2) / bbox.h), minK, Math.min(maxK, 1.5));
  return {
    x: (width - bbox.w * k) / 2 - bbox.x * k,
    y: (height - bbox.h * k) / 2 - bbox.y * k,
    k,
  };
}
