/*
 * recipeStep.js — 配方链的单步执行 / 运行到指定节点（纯模块，无 DOM、无存储、无随机）。
 *
 * 只负责「按顺序驱动」与「错误停步」，不跑任何 op：exec(node, text) 由调用方注入。
 * 因此本模块对注册表零依赖，可单独测试。
 *
 * 执行序 = recipe.nodes 的数组顺序（与配方链 UI 的线性链模型一致）；
 * recipe.edges 只用于结构校验（环 / 悬空边 / 重复 id），不改变执行顺序。
 *
 * 两个函数都是 async：项目里存在异步 op（gzip/zlib 等），exec 返回 Promise 时
 * 必须能 await。exec 返回同步值时行为不变，调用方一律 await 即可。
 */

function typeTag(value) {
  return Object.prototype.toString.call(value).slice(8, -1);
}

const nowMs =
  typeof performance !== "undefined" && performance && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();

function round3(ms) {
  return Math.round(ms * 1000) / 1000;
}

function nodeIdOf(node, index) {
  if (node && node.id !== undefined && node.id !== null) return String(node.id);
  return "#" + index;
}

function assertRecipe(recipe) {
  if (!recipe || typeof recipe !== "object") {
    throw new TypeError("recipeStep: recipe 必须是对象，收到 " + (recipe === null ? "null" : typeof recipe));
  }
  if (!Array.isArray(recipe.nodes)) {
    throw new TypeError("recipeStep: recipe.nodes 必须是数组，收到 " + typeTag(recipe.nodes));
  }
  if (recipe.edges !== undefined && recipe.edges !== null && !Array.isArray(recipe.edges)) {
    throw new TypeError("recipeStep: recipe.edges 若存在必须是数组，收到 " + typeTag(recipe.edges));
  }
}

function assertExec(exec) {
  if (typeof exec !== "function") {
    throw new TypeError("recipeStep: exec 必须是函数 (node, text) => string | { text }，收到 " + typeTag(exec));
  }
}

function assertIndex(recipe, nodeIndex) {
  if (!Number.isInteger(nodeIndex)) {
    throw new RangeError("recipeStep: nodeIndex 必须是整数，收到 " + String(nodeIndex));
  }
  if (nodeIndex < 0 || nodeIndex >= recipe.nodes.length) {
    throw new RangeError(
      "recipeStep: nodeIndex " + nodeIndex + " 越界（合法范围 0.." + (recipe.nodes.length - 1) + "，共 " + recipe.nodes.length + " 个节点）"
    );
  }
}

// 环 / 悬空边 / 重复 id 检查。配方非法时显式抛错，绝不「按声明序硬跑」。
function assertAcyclic(recipe) {
  const nodes = recipe.nodes;
  const ids = new Set();
  for (let i = 0; i < nodes.length; i++) {
    const id = nodeIdOf(nodes[i], i);
    if (ids.has(id)) throw new Error("recipeStep: 节点 id 重复：" + id);
    ids.add(id);
  }

  const edges = Array.isArray(recipe.edges) ? recipe.edges : [];
  if (edges.length === 0) return;

  const indeg = new Map();
  const out = new Map();
  for (const id of ids) {
    indeg.set(id, 0);
    out.set(id, []);
  }
  for (const e of edges) {
    if (!e || typeof e !== "object") {
      throw new TypeError("recipeStep: 非法边 " + typeTag(e) + "，需要 { from, to }");
    }
    const from = String(e.from);
    const to = String(e.to);
    if (!ids.has(from) || !ids.has(to)) {
      throw new Error("recipeStep: 边 " + from + " -> " + to + " 引用了不存在的节点");
    }
    out.get(from).push(to);
    indeg.set(to, indeg.get(to) + 1);
  }

  const queue = [];
  for (const [id, d] of indeg) if (d === 0) queue.push(id);
  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    visited++;
    for (const to of out.get(id)) {
      indeg.set(to, indeg.get(to) - 1);
      if (indeg.get(to) === 0) queue.push(to);
    }
  }
  if (visited !== ids.size) {
    throw new Error("recipeStep: 配方存在环，" + (ids.size - visited) + " 个节点无法确定执行顺序");
  }
}

// exec 的返回值归一化为文本。类型不对就抛错，不猜、不静默转十六进制。
function textOf(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value instanceof Uint8Array) {
    throw new TypeError("recipeStep: exec 返回了 Uint8Array，请在 exec 内自行转文本（本模块不做隐式编码）");
  }
  if (typeof value === "object" && typeof value.text === "string") return value.text;
  throw new TypeError("recipeStep: exec 返回值不支持（" + typeTag(value) + "），需要 string 或 { text: string }");
}

function normalizeInput(input) {
  if (input === undefined || input === null) return "";
  if (typeof input === "string") return input;
  if (typeof input === "object" && typeof input.text === "string") return input.text;
  throw new TypeError("recipeStep: input 必须是 string 或 { text: string }，收到 " + typeTag(input));
}

function errText(err) {
  return err && err.message ? err.message : String(err);
}

const EMPTY = { ok: false, reason: "empty-recipe", outputs: [], stoppedAt: -1, elapsedMs: 0 };

/**
 * 顺序执行 nodes[0..nodeIndex]（含 nodeIndex）。
 * 任一步抛错则停在该步：已完成的输出全部保留，出错步以 { error } 记入 outputs。
 *
 * @returns {Promise<{ok:boolean, reason:string, outputs:Array<{nodeId:string,text:string,error?:string,ms:number}>, stoppedAt:number, error?:string, elapsedMs:number}>}
 */
export async function runToNode(recipe, nodeIndex, input, exec) {
  assertRecipe(recipe);
  assertExec(exec);
  if (recipe.nodes.length === 0) return { ...EMPTY, outputs: [] };

  assertIndex(recipe, nodeIndex);
  assertAcyclic(recipe);

  const outputs = [];
  let text = normalizeInput(input);
  const t0 = nowMs();

  for (let i = 0; i <= nodeIndex; i++) {
    const node = recipe.nodes[i];
    const started = nowMs();
    try {
      const out = textOf(await exec(node, text));
      outputs.push({ nodeId: nodeIdOf(node, i), text: out, ms: round3(nowMs() - started) });
      text = out;
    } catch (err) {
      const msg = errText(err);
      outputs.push({ nodeId: nodeIdOf(node, i), text: "", error: msg, ms: round3(nowMs() - started) });
      return {
        ok: false,
        reason: "exec-error",
        outputs,
        stoppedAt: i,
        error: msg,
        elapsedMs: round3(nowMs() - t0),
      };
    }
  }

  return { ok: true, reason: "ok", outputs, stoppedAt: nodeIndex, elapsedMs: round3(nowMs() - t0) };
}

/**
 * 只执行 nodes[nodeIndex] 这一个节点。
 * input 即该节点的输入文本（通常来自上一步 outputs[last].text，由调用方保存）。
 *
 * @returns {Promise<{ok:boolean, reason:string, outputs:Array, stoppedAt:number, error?:string, elapsedMs:number}>}
 */
export async function stepOnce(recipe, nodeIndex, input, exec) {
  assertRecipe(recipe);
  assertExec(exec);
  if (recipe.nodes.length === 0) return { ...EMPTY, outputs: [] };

  assertIndex(recipe, nodeIndex);
  assertAcyclic(recipe);

  const node = recipe.nodes[nodeIndex];
  const text = normalizeInput(input);
  const started = nowMs();
  try {
    const out = textOf(await exec(node, text));
    return {
      ok: true,
      reason: "ok",
      outputs: [{ nodeId: nodeIdOf(node, nodeIndex), text: out, ms: round3(nowMs() - started) }],
      stoppedAt: nodeIndex,
      elapsedMs: round3(nowMs() - started),
    };
  } catch (err) {
    const msg = errText(err);
    return {
      ok: false,
      reason: "exec-error",
      outputs: [{ nodeId: nodeIdOf(node, nodeIndex), text: "", error: msg, ms: round3(nowMs() - started) }],
      stoppedAt: nodeIndex,
      error: msg,
      elapsedMs: round3(nowMs() - started),
    };
  }
}
