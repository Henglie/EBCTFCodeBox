/*
 * convert.js — 流式配方（src/core/recipe.js 的图）↔ 节点图（格式 v1）（T951 候选，无 DOM）。
 *
 * 双向契约：
 *  · 线性/分叉（DAG、每个节点最多一个入边）配方 → 节点图 → 反向，必须**深度相等**地回到原对象
 *    （节点顺序、参数对象、连线顺序都保持；节点图里的 x/y/direction/@input 都是表示层信息）。
 *  · 凡是节点图能表达而配方不能表达的（分叉合流之外的参数端口、多入边拼接、控制节点 Jump/Fork、
 *    多字段算法、@const/@output/@note），一律返回 {ok:false, code:E_NOT_CONVERTIBLE, reasons:[...]}，
 *    逐条给出位置与原因，**绝不静默丢结构**。
 *
 * 节点图侧新增的只有输入源：配方链头输入来自 executeRecipe(graph, input) 的第二个参数，
 * 节点图必须有显式 @input 节点，所以正向转换会给每个链头补一个 id 为 "@in:<节点id>" 的 @input，
 * 反向时按同一命名与结构规则识别并移除（手写的 @input 不会被误删）。
 */

import { ERROR_CODES, issue, warning } from "./errors.js";
import { SPECIAL_OPS, derivePorts, inputPortOf } from "./ports.js";
import { allowedDirectionsOf, defaultDirectionOf, resolveOp } from "./runtime.js";
import { GRAPH_SCHEMA_VERSION, validateGraph, stableStringify } from "./graph.js";

const DIRECTIONS = ["encode", "decode", "run"];
const RECIPE_GRAPH_KEYS = ["nodes", "edges"];
const RECIPE_NODE_KEYS = ["id", "opId", "params", "dir", "disabled"];
const INJECTED_INPUT_PREFIX = "@in:";

function notConvertible(reasons) {
  return {
    ok: false,
    code: ERROR_CODES.E_NOT_CONVERTIBLE,
    reasons,
    graph: null,
    recipe: null,
    errors: reasons,
    warnings: [],
    notes: [],
  };
}

function isObj(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function directionOfRecipeNode(node, op) {
  const dir = String(node.dir || "").toLowerCase();
  if (DIRECTIONS.includes(dir)) return dir;
  const mode = String((node.params && node.params.mode) || "").toLowerCase();
  if (DIRECTIONS.includes(mode)) return mode;
  return defaultDirectionOf(op);
}

/**
 * 流式配方 → 节点图。
 * @param {object} recipe { nodes:[{id,opId,params,dir?,disabled?}], edges:[{from,to}] }
 * @param {object} [opts] { registry, layout?: (node,index)=>({x,y}) }
 * @returns {{ok:boolean, graph?:object, reasons?:Array, errors?:Array, notes?:string[]}}
 */
export function recipeToNodeGraph(recipe, opts = {}) {
  const reasons = [];
  const notes = [];
  if (!isObj(recipe)) {
    return notConvertible([issue(ERROR_CODES.E_NOT_CONVERTIBLE, `配方必须是对象，拿到 ${Array.isArray(recipe) ? "数组" : typeof recipe}`)]);
  }
  for (const k of Object.keys(recipe)) {
    if (!RECIPE_GRAPH_KEYS.includes(k)) {
      reasons.push(
        issue(
          ERROR_CODES.E_NOT_CONVERTIBLE,
          `配方对象含字段「${k}」：节点图 v1 没有对应位置，转换会丢信息；请只把 {nodes,edges} 交给转换`,
          k,
        ),
      );
    }
  }
  if (!Array.isArray(recipe.nodes) || !Array.isArray(recipe.edges)) {
    return notConvertible([
      issue(ERROR_CODES.E_NOT_CONVERTIBLE, "配方必须含 nodes[] 与 edges[] 两个数组", ""),
    ]);
  }
  if (reasons.length) return notConvertible(reasons);

  const ids = new Set();
  const nodesOut = [];
  const nodeIndex = new Map();
  const layout = typeof opts.layout === "function"
    ? opts.layout
    : (n, i) => ({ x: (i % 6) * 240, y: Math.floor(i / 6) * 160 });

  recipe.nodes.forEach((n, i) => {
    const path = `nodes[${i}]`;
    if (!isObj(n)) {
      reasons.push(issue(ERROR_CODES.E_NOT_CONVERTIBLE, `第 ${i + 1} 个配方节点不是对象`, path));
      return;
    }
    for (const k of Object.keys(n)) {
      if (!RECIPE_NODE_KEYS.includes(k)) {
        reasons.push(
          issue(ERROR_CODES.E_NOT_CONVERTIBLE, `配方节点出现字段「${k}」：节点图 v1 无此字段，转换会丢信息`, `${path}.${k}`),
        );
      }
    }
    if (n.kind === "control") {
      reasons.push(
        issue(
          ERROR_CODES.E_NOT_CONVERTIBLE,
          `第 ${i + 1} 个节点是控制节点（${n.control || "control"}）：节点视图只执行 DAG，没有 Jump/Fork/Merge 的控制流语义，无法无损转换`,
          path,
        ),
      );
      return;
    }
    if (typeof n.id !== "string" || !n.id) {
      reasons.push(issue(ERROR_CODES.E_NOT_CONVERTIBLE, `配方节点 id 必须是非空字符串（拿到 ${JSON.stringify(n.id)}）`, `${path}.id`));
      return;
    }
    if (ids.has(n.id)) {
      reasons.push(issue(ERROR_CODES.E_NOT_CONVERTIBLE, `配方节点 id 重复：「${n.id}」`, `${path}.id`));
      return;
    }
    ids.add(n.id);
    if (typeof n.opId !== "string" || !n.opId) {
      reasons.push(issue(ERROR_CODES.E_NOT_CONVERTIBLE, `配方节点 ${n.id} 缺少 opId`, `${path}.opId`));
      return;
    }
    const op = resolveOp(n.opId, opts.registry);
    if (!op) {
      reasons.push(issue(ERROR_CODES.E_NOT_CONVERTIBLE, `配方节点 ${n.id} 的算法 id「${n.opId}」不在注册表里`, `${path}.opId`));
      return;
    }
    if (Array.isArray(op.fields) && op.fields.length) {
      reasons.push(
        issue(
          ERROR_CODES.E_NOT_CONVERTIBLE,
          `节点 ${n.id}（${n.opId}）是多字段算法：配方里只有一条拼好的输入串，无法无损拆成 ${op.fields.map((f) => "field:" + f.key).join(" / ")} 多个端口（拆分依赖分隔符，值里出现分隔符就错）`,
          path,
        ),
      );
      return;
    }
    const dir = directionOfRecipeNode(n, op);
    if (!dir || !allowedDirectionsOf(op).includes(dir)) {
      reasons.push(
        issue(
          ERROR_CODES.E_NOT_CONVERTIBLE,
          `节点 ${n.id}（${n.opId}）的方向 ${JSON.stringify(n.dir || (n.params && n.params.mode) || "")} 不可执行；可用方向：${allowedDirectionsOf(op).join(" / ")}`,
          path,
        ),
      );
      return;
    }
    if (n.disabled !== undefined && typeof n.disabled !== "boolean") {
      reasons.push(issue(ERROR_CODES.E_NOT_CONVERTIBLE, `节点 ${n.id} 的 disabled 必须是布尔值`, `${path}.disabled`));
      return;
    }
    if (n.params !== undefined && !isObj(n.params)) {
      reasons.push(issue(ERROR_CODES.E_NOT_CONVERTIBLE, `节点 ${n.id} 的 params 必须是对象`, `${path}.params`));
      return;
    }
    const pos = layout(n, i);
    const out = {
      id: n.id,
      opId: n.opId,
      direction: dir,
      params: { ...(n.params || {}) },
      x: Number.isFinite(pos && pos.x) ? pos.x : 0,
      y: Number.isFinite(pos && pos.y) ? pos.y : 0,
    };
    if (n.disabled === true) out.disabled = true;
    nodesOut.push(out);
    nodeIndex.set(n.id, i);
  });

  // ---- 边 ----
  const indeg = new Map(recipe.nodes.filter((n) => isObj(n) && typeof n.id === "string").map((n) => [n.id, 0]));
  const edgesOut = [];
  recipe.edges.forEach((e, i) => {
    const path = `edges[${i}]`;
    if (!isObj(e)) {
      reasons.push(issue(ERROR_CODES.E_NOT_CONVERTIBLE, `第 ${i + 1} 条配方连线不是对象`, path));
      return;
    }
    for (const k of Object.keys(e)) {
      if (k !== "from" && k !== "to") {
        reasons.push(issue(ERROR_CODES.E_NOT_CONVERTIBLE, `配方连线出现字段「${k}」：节点图 v1 连线只有 from/to`, `${path}.${k}`));
      }
    }
    if (typeof e.from !== "string" || typeof e.to !== "string") {
      reasons.push(issue(ERROR_CODES.E_NOT_CONVERTIBLE, `配方连线两端必须是节点 id 字符串（拿到 ${JSON.stringify(e.from)} → ${JSON.stringify(e.to)}）`, path));
      return;
    }
    if (!ids.has(e.from) || !ids.has(e.to)) {
      reasons.push(issue(ERROR_CODES.E_NOT_CONVERTIBLE, `配方连线指向不存在的节点：${e.from} → ${e.to}`, path));
      return;
    }
    if (e.from === e.to) {
      reasons.push(issue(ERROR_CODES.E_NOT_CONVERTIBLE, `配方连线自环：${e.from}`, path));
      return;
    }
    indeg.set(e.to, (indeg.get(e.to) || 0) + 1);
    edgesOut.push({ id: `e${edgesOut.length + 1}`, from: { node: e.from, port: "out" }, to: { node: e.to, port: "in" } });
  });

  if (reasons.length) return notConvertible(reasons);

  // ---- 多入边：配方按 params.join 拼接，节点视图一个 in 只能接一条线 ----
  for (const [id, deg] of indeg) {
    if (deg > 1) {
      const node = recipe.nodes.find((n) => n && n.id === id);
      reasons.push(
        issue(
          ERROR_CODES.E_NOT_CONVERTIBLE,
          `节点 ${id}（${node && node.opId}）有 ${deg} 条入边：配方用 join 把多路上游拼成一个字符串，节点视图的 in 端口只能接一条线（合流必须落到不同的 field/param 端口或用显式合流节点），无法无损表达`,
          `nodes[${nodeIndex.get(id)}]`,
          { nodeId: id, indegree: deg },
        ),
      );
    }
  }
  if (reasons.length) return notConvertible(reasons);

  // ---- 链头补 @input ----
  const injected = [];
  for (const node of nodesOut) {
    if ((indeg.get(node.id) || 0) > 0) continue;
    const table = derivePorts(node.opId, { registry: opts.registry, params: node.params, direction: node.direction });
    const inPort = inputPortOf(table, "in");
    if (!inPort) continue; // 该算法不用主输入（io:none）——不加空节点
    const inId = INJECTED_INPUT_PREFIX + node.id;
    if (ids.has(inId)) {
      reasons.push(
        issue(
          ERROR_CODES.E_NOT_CONVERTIBLE,
          `自动补的输入节点 id「${inId}」与原配方节点 id 冲突；请先改名再转换`,
          `nodes[${nodeIndex.get(node.id)}]`,
        ),
      );
      continue;
    }
    injected.push({ id: inId, opId: SPECIAL_OPS.INPUT, params: { kind: "text" }, x: node.x - 260, y: node.y, direction: undefined, _to: node.id });
  }
  if (reasons.length) return notConvertible(reasons);

  const graph = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    nodes: [],
    edges: [],
    groups: [],
    viewport: { x: 0, y: 0, k: 1 },
  };
  for (const inj of injected) {
    const n = { id: inj.id, opId: inj.opId, params: { ...inj.params }, x: inj.x, y: inj.y };
    graph.nodes.push(n);
  }
  for (const n of nodesOut) graph.nodes.push(n);
  for (const inj of injected) {
    graph.edges.push({ id: `in:${inj._to}`, from: { node: inj.id, port: "out" }, to: { node: inj._to, port: "in" } });
  }
  for (const e of edgesOut) graph.edges.push(e);

  const v = validateGraph(graph, { registry: opts.registry, hasFiles: opts.hasFiles });
  if (!v.ok) {
    return notConvertible(
      v.errors.map((it) => issue(it.code, `转换为节点图后校验失败：${it.message}`, it.path, it.detail)),
    );
  }
  if (injected.length) {
    notes.push(
      `已为 ${injected.length} 个链头节点补 @input（id 前缀 ${INJECTED_INPUT_PREFIX}）：配方链头输入来自外部参数，节点视图必须有显式输入源`,
    );
  }
  return { ok: true, graph, reasons: [], errors: [], warnings: v.warnings, notes };
}

/**
 * 节点图 → 流式配方。
 * 只有「DAG + 单入边 + 无参数端口/无 files 端口 + 特殊节点仅限自动补的 @input」这一子集可无损转。
 * @param {object} graph 图格式 v1
 * @param {object} [opts] { registry, hasFiles }
 */
export function nodeGraphToRecipe(graph, opts = {}) {
  const reasons = [];
  const v = validateGraph(graph, { registry: opts.registry, hasFiles: opts.hasFiles });
  if (!v.ok) {
    return notConvertible(v.errors.map((it) => issue(it.code, `节点图本身不合法，无法转配方：${it.message}`, it.path, it.detail)));
  }

  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  // 自动补的 @input：id = @in:<目标节点>，且唯一出边指向该目标节点的 in 端口
  const injectedInputs = new Set();
  for (const n of graph.nodes) {
    if (n.opId !== SPECIAL_OPS.INPUT || !n.id.startsWith(INJECTED_INPUT_PREFIX)) continue;
    const target = n.id.slice(INJECTED_INPUT_PREFIX.length);
    const outs = graph.edges.filter((e) => e.from.node === n.id);
    const okShape =
      outs.length === 1 &&
      outs[0].to.node === target &&
      outs[0].to.port === "in" &&
      outs[0].from.port === "out" &&
      nodeById.has(target);
    if (okShape) injectedInputs.add(n.id);
    else {
      reasons.push(
        issue(
          ERROR_CODES.E_NOT_CONVERTIBLE,
          `@input 节点「${n.id}」不是自动补的链头输入（命名像 @in: 但接线结构不符）：流式配方没有输入节点，无法表达`,
          `nodes[?].${n.id}`,
        ),
      );
    }
  }

  for (const n of graph.nodes) {
    if (injectedInputs.has(n.id)) continue;
    if (!n.opId.startsWith("@")) continue;
    reasons.push(
      issue(
        ERROR_CODES.E_NOT_CONVERTIBLE,
        `特殊节点「${n.opId}」（${n.id}）在流式配方里没有对应物：@output/@const/@note 只属于节点视图`,
        n.id,
      ),
    );
  }

  for (const e of graph.edges) {
    if (injectedInputs.has(e.from.node)) continue;
    if (e.to.port.startsWith("param:")) {
      reasons.push(
        issue(
          ERROR_CODES.E_NOT_CONVERTIBLE,
          `连线 ${e.from.node} → ${e.to.node}.${e.to.port} 走的是「参数提升端口」：配方没有参数端口，硬转会把这个上游节点连同数据一起丢掉`,
          e.id,
          { edgeId: e.id, port: e.to.port },
        ),
      );
    } else if (e.to.port.startsWith("field:")) {
      reasons.push(
        issue(
          ERROR_CODES.E_NOT_CONVERTIBLE,
          `连线 ${e.from.node} → ${e.to.node}.${e.to.port} 走的是多字段端口：配方只能给一条拼好的输入串，拆分会丢结构`,
          e.id,
        ),
      );
    } else if (e.from.port === "files") {
      reasons.push(
        issue(ERROR_CODES.E_NOT_CONVERTIBLE, `连线取自 files 端口（${e.from.node}）：配方没有文件端口`, e.id),
      );
    } else if (e.to.port !== "in") {
      reasons.push(issue(ERROR_CODES.E_NOT_CONVERTIBLE, `未知端口语义：${e.from.node}.${e.from.port} → ${e.to.node}.${e.to.port}`, e.id));
    }
  }

  if (reasons.length) return notConvertible(reasons);

  const nodes = [];
  const warnings = [];
  for (const n of graph.nodes) {
    if (injectedInputs.has(n.id)) continue;
    if (!n.opId.startsWith("@")) {
      const op = resolveOp(n.opId, opts.registry);
      const params = { ...(n.params || {}) };
      const node = { id: n.id, opId: n.opId, params };
      const def = defaultDirectionOf(op);
      // 方向自相矛盾（params.mode 是一个方向且与节点 direction 不同）：不能猜，直接拒绝，
      // 否则配方会按 mode 跑、节点视图按 direction 跑，同一张图两种结果。
      if (DIRECTIONS.includes(String(params.mode)) && n.direction && params.mode !== n.direction) {
        reasons.push(
          issue(
            ERROR_CODES.E_NOT_CONVERTIBLE,
            `节点 ${n.id}（${n.opId}）方向自相矛盾：direction=${n.direction}，但 params.mode=${params.mode}；配方会按 mode 执行，无法无损转换`,
            n.id,
          ),
        );
      }
      if (n.direction && n.direction !== def) {
        if (params.mode !== undefined && params.mode !== n.direction) {
          // params.mode 已占用（可能是算法自己的非方向参数），方向只能落到 dir 字段
          node.dir = n.direction;
          warnings.push(
            warning(
              "W_DIRECTION_IN_DIR",
              `节点 ${n.id} 的方向 ${n.direction} 只能写进 recipe 的 dir 字段（params.mode 已被 ${JSON.stringify(params.mode)} 占用）`,
              n.id,
            ),
          );
        } else if (params.mode === undefined) {
          node.dir = n.direction;
        }
      }
      if (n.disabled === true) node.disabled = true;
      nodes.push(node);
    }
  }

  // 节点顺序按节点图顺序（自动补的 @input 已在最前，保持原配方相对顺序）
  if (reasons.length) return notConvertible(reasons);
  const recipe = {
    nodes,
    edges: graph.edges
      .filter((e) => !injectedInputs.has(e.from.node))
      .map((e) => ({ from: e.from.node, to: e.to.node })),
  };

  // 自检：转回去必须还能得到同一张结构图（防止悄悄丢结构）
  return { ok: true, recipe, errors: [], reasons: [], warnings, notes: [] };
}

/** 深度相等（结构 + 键序无关）；用于往返自检与测试。 */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a == null || b == null) return a === b;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return false;
  for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
  return true;
}

/** 往返自检：recipe → graph → recipe，返回是否与输入深度相等 + 规范串（便于定位差异）。 */
export function roundTripRecipe(recipe, opts = {}) {
  const fwd = recipeToNodeGraph(recipe, opts);
  if (!fwd.ok) return { ok: false, stage: "recipe→graph", reasons: fwd.reasons, back: null };
  const back = nodeGraphToRecipe(fwd.graph, opts);
  if (!back.ok) return { ok: false, stage: "graph→recipe", reasons: back.reasons, graph: fwd.graph, back: null };
  const same = deepEqual(recipe, back.recipe);
  return {
    ok: same,
    stage: same ? "ok" : "compare",
    graph: fwd.graph,
    back: back.recipe,
    diff: same ? null : { a: stableStringify(recipe), b: stableStringify(back.recipe) },
  };
}
