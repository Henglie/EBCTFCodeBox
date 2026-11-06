// recipe.js — 配方链图模型（纯算法编排层）
// 图模型: { nodes: [{id, opId, params}], edges: [{from, to}] }
// 本模块只做编排，不注册新 op，不产生任何加载副作用。
import { getOp, OPS } from "./registry.js";
import { transitTextOf, transitPayloadOf, recipeDisplayText } from "./productResult.js";
import { bytesToHex, bytesToEscapedText, decodeUtf8Lossless } from "./bytesIo.js";

// ---- 统一「有效输入大小」 ----
// 文件链头的展示文本只是占位提示，自动执行闸门必须看真字节长度；
// 文本链仍按字符数。UI 与测试共用这一口径，避免两边各算一套。
export function inputSizeOf(input) {
  if (input == null) return 0;
  if (typeof input === "string") return input.length;
  if (input instanceof Uint8Array || input instanceof ArrayBuffer) return input.byteLength;
  if (ArrayBuffer.isView(input)) return input.byteLength;
  if (Array.isArray(input)) return input.length;
  if (typeof input === "object") {
    const b = input.bytes != null ? input.bytes : input.rawBytes;
    if (b != null) return inputSizeOf(b);
    if (input.text != null) return String(input.text).length;
  }
  return String(input).length;
}

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
  const opName = (op && (op.name || op.id)) || (isControlNode(node) ? controlNameOf(node) : node.opId);
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

// ---- Magic 候选 → 配方节点（纯映射，不做 UI） ----
// Magic 的候选 step 只保证 opId/params/paramLabel；方向由 op 能力与 step.dir（若提供）决定。
// 这里显式拒绝未知 op / 桥接 op / 无执行入口的 op，并把参数限制在该 op 声明的键上，
// 避免旧逻辑把一切强制 decode 或把 `mode:"decode"` 写进不认识的参数。
export function mapMagicStepToRecipe(step) {
  if (!step || typeof step !== "object") return { ok: false, error: "候选步骤为空" };
  const opId = String(step.opId || "").trim();
  if (!opId) return { ok: false, error: "候选步骤缺少 opId" };
  const op = getOp(opId);
  if (!op) return { ok: false, error: `未知 op: ${opId}` };
  if (op.requiresBridge) return { ok: false, error: `外部桥接 op 不能进配方: ${opId}` };
  const dirs = [];
  if (typeof op.encode === "function") dirs.push("encode");
  if (typeof op.decode === "function") dirs.push("decode");
  if (typeof op.run === "function") dirs.push("run");
  if (!dirs.length) return { ok: false, error: `op 没有可执行入口: ${opId}` };

  const requested = String(step.dir || step.mode || "").toLowerCase();
  let dir = dirs.includes(requested) ? requested : "";
  if (!dir) {
    if (step.source === "encode" && dirs.includes("encode")) dir = "encode";
    else if (dirs.includes("decode")) dir = "decode";
    else if (dirs.includes("encode")) dir = "encode";
    else dir = dirs[0];
  }

  const params = {};
  for (const d of op.params || []) params[d.key] = d.default;
  const raw = step.params && typeof step.params === "object" ? step.params : null;
  if (raw) {
    for (const [k, v] of Object.entries(raw)) {
      if (Object.prototype.hasOwnProperty.call(params, k)) params[k] = v;
    }
  }
  return { ok: true, opId, dir, params };
}

export function mapMagicCandidateToRecipe(steps) {
  const list = Array.isArray(steps) ? steps : [];
  if (!list.length) return { ok: false, error: "候选没有步骤", nodes: [] };
  const nodes = [];
  for (let i = 0; i < list.length; i++) {
    const r = mapMagicStepToRecipe(list[i]);
    if (!r.ok) return { ok: false, error: `第 ${i + 1} 步不可执行：${r.error}`, nodes: [] };
    nodes.push({ opId: r.opId, dir: r.dir, params: r.params });
  }
  return { ok: true, nodes };
}

// ---- 控制节点（kind:"control"）----
// CC-A5：不注册主 op、不进 878 计数。控制节点只存在于配方图里，由本模块解释执行。
// 语义对照 CyberChef flowControl：
//   register（正则捕获 $R0..$Rn）/ conditionalJump / label / jump / return
//   / fork（按行/正则/字面拆分 → 分支各跑一遍 → merge 合并）/ merge / subsection（不改变执行序）
// 旧配方（无 kind 字段）不受影响；控制节点在导出/导入里用 kind+control 标记。
export const CONTROL_TYPES = Object.freeze([
  "register", "conditionalJump", "label", "jump", "return", "fork", "merge", "subsection",
]);
const CONTROL_TYPE_SET = new Set(CONTROL_TYPES);
export const CONTROL_LABELS = Object.freeze({
  register: "Register",
  conditionalJump: "Conditional Jump",
  label: "Label",
  jump: "Jump",
  return: "Return",
  fork: "Fork",
  merge: "Merge",
  subsection: "Subsection",
});
// 防死循环 / 防失控预算。超限一律显式报错（reason="budget"），绝不静默截断。
const DEFAULT_MAX_STEPS = 5000;
const DEFAULT_MAX_JUMPS = 500;
const DEFAULT_MAX_BRANCHES = 200;
const DEFAULT_MAX_NESTING = 32;   // Fork 嵌套层级上限；防止递归过深打爆调用栈

export function isControlNode(node) {
  return !!(node && node.kind === "control");
}
export function controlTypeOf(node) {
  if (!isControlNode(node)) return "";
  return String(node.control || (node.params && node.params.control) || "");
}
function controlNameOf(node) {
  const t = controlTypeOf(node);
  return CONTROL_LABELS[t] || t || "control";
}
function errText(err) {
  return err && err.message ? err.message : String(err);
}
function posInt(value, dflt, min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min == null ? 0 : min, Math.floor(n));
}
// 分隔符里的 \n \r \t \0 \\ —— 输入框是单行文本，用户只能打转义序列。
function unescapeSeparator(value) {
  return String(value == null ? "" : value).replace(/\\(n|r|t|0|\\)/g,
    (m, c) => (c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c === "0" ? "\0" : "\\"));
}
// 参数中的 $R0..$Rn 替换。未定义的寄存器显式报错，不把字面量悄悄传下去。
function substituteValue(value, registers) {
  if (typeof value === "string") {
    return value.replace(/\$R(\d+)/g, (m, d) => {
      const idx = Number(d);
      if (!registers || idx >= registers.length || registers[idx] == null) {
        throw new Error(`参数引用了未定义的寄存器 $R${idx}（请先在链中放 Register 节点捕获）`);
      }
      return String(registers[idx]);
    });
  }
  if (Array.isArray(value)) return value.map((v) => substituteValue(v, registers));
  if (value && typeof value === "object"
    && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer)) {
    const out = {};
    for (const k of Object.keys(value)) out[k] = substituteValue(value[k], registers);
    return out;
  }
  return value;
}
// active=false（链上从未出现过 Register）时完全不动参数：
// 旧配方里刚好写了字面量 $R0 的，行为保持不变；一旦出现过 Register，未定义寄存器就显式报错。
function substituteParams(params, registers, active) {
  if (!active) return params || {};
  return substituteValue(params || {}, registers);
}
function splitForkInput(text, params) {
  const mode = String(params.splitMode || "line");
  const src = text == null ? "" : String(text);
  let parts;
  if (mode === "line") {
    parts = src.split(/\r?\n/);
  } else if (mode === "literal") {
    const sep = unescapeSeparator(params.splitter == null ? "\n" : params.splitter);
    if (sep === "") throw new Error("Fork：字面拆分符不能为空");
    parts = src.split(sep);
  } else if (mode === "regex") {
    const pattern = String(params.splitter == null ? "\n" : params.splitter);
    let re;
    try { re = new RegExp(pattern); } catch (e) { throw new Error("Fork 拆分正则无效：" + errText(e)); }
    parts = src.split(re);
  } else {
    throw new Error(`Fork：未知拆分方式 ${mode}`);
  }
  if (params.removeEmpty) parts = parts.filter((p) => p !== "");
  return parts;
}
function applyRegisterCapture(ctx, params, text) {
  const src = String(params.regex == null ? "" : params.regex);
  if (!src) {
    if (params.strict) throw new Error("Register：strict 模式需要填写正则表达式");
    return { matched: false, count: 0 };
  }
  let flags = String(params.flags || "");
  if (params.caseInsensitive && !flags.includes("i")) flags += "i";
  if (params.multiline && !flags.includes("m")) flags += "m";
  if (params.dotAll && !flags.includes("s")) flags += "s";
  let re;
  try { re = new RegExp(src, flags); } catch (e) { throw new Error("Register 正则无效：" + errText(e)); }
  const m = re.exec(text == null ? "" : String(text));
  if (!m) {
    if (params.strict) throw new Error(`Register：输入未匹配正则 ${src}`);
    return { matched: false, count: 0 };
  }
  ctx.registers = Array.from(m, (v) => (v == null ? "" : String(v)));
  return { matched: true, count: ctx.registers.length };
}
function evalJumpCondition(params, text) {
  const type = String(params.matchType || "contains");
  const pattern = String(params.pattern == null ? "" : params.pattern);
  const src = text == null ? "" : String(text);
  let hit;
  if (type === "always") hit = true;
  else if (type === "regex") {
    let re;
    try { re = new RegExp(pattern); } catch (e) { throw new Error("条件跳转正则无效：" + errText(e)); }
    hit = re.test(src);
  } else if (type === "equals") hit = src === pattern;
  else if (type === "notEquals") hit = src !== pattern;
  else if (type === "startsWith") hit = src.startsWith(pattern);
  else if (type === "endsWith") hit = src.endsWith(pattern);
  else if (type === "contains") hit = src.includes(pattern);
  else throw new Error(`条件跳转：未知条件类型 ${type}`);
  if (params.invert) hit = !hit;
  return hit;
}
function buildLabelIndex(order, nodeMap) {
  const labels = new Map();
  order.forEach((id, pos) => {
    const node = nodeMap.get(id);
    if (controlTypeOf(node) !== "label") return;
    const name = String((node.params && node.params.name) || "");
    if (!name || labels.has(name)) return;
    labels.set(name, pos);
  });
  return labels;
}
function findMatchingMerge(order, nodeMap, forkPos, scopeEnd) {
  let depth = 0;
  for (let p = forkPos + 1; p <= scopeEnd; p++) {
    const t = controlTypeOf(nodeMap.get(order[p]));
    if (t === "fork") depth++;
    else if (t === "merge") {
      if (depth === 0) return p;
      depth--;
    }
  }
  return -1;
}
function findLabelPos(labels, name, lo, hi) {
  if (!name || !labels.has(name)) return -1;
  const pos = labels.get(name);
  return pos >= lo && pos <= hi ? pos : -1;
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
export function nodeDirection(node, params) {
  const explicit = String((node && node.dir) || "").toLowerCase();
  if (explicit === "encode" || explicit === "decode" || explicit === "run") return explicit;
  return String((params || (node && node.params) || {}).mode || "").toLowerCase();
}

function runNode(node, inputText, params) {
  const op = getOp(node.opId);
  if (!op) throw new Error(`unknown opId: ${node.opId}`);
  params = params || node.params || {};
  const mode = nodeDirection(node, params);

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
    if (isControlNode(node)) {
      throw new Error(`executeRecipe 不支持控制节点（${controlNameOf(node)}）；请使用 executeRecipeSteps。`);
    }
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

// ---- 异步执行器（带步级钩子；断点 / 取消 / 预算 / 从某步）----
//
// 配方页需要「错误定位到步、保留已完成前缀、断点、单步、从某步、取消、超时」。
// 旧的 executeRecipeAsync 只返回终值，出错时中间结果全部丢弃；本函数把每一步的结果
// 与耗时都交回调用方，并在出错/取消/超时/断点处停下而不清空已完成前缀。
//
// 语义：
//  · startAt/endAt 是「按拓扑序的下标」（配方页线性链与节点顺序一致）。
//  · 从 startAt 开始且该节点没有已 seed 的上游输出时，按链头输入处理（CyberChef 的从第 N 步）。
//  · seedOutputs 用于「继续断点 / 单步」：把前一阶段已算出的产物接回去，不重跑前缀。
//  · disabled 节点默认跳过并把输入原样传给下游（CyberChef `if (op.disabled) continue`）。
//  · 同步 op 无法在计算中途打断；取消/预算只在步间生效，返回 reason 如实标注。

const _nowMs =
  typeof performance !== "undefined" && performance && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();

function _round3(ms) {
  return Math.round(ms * 1000) / 1000;
}

function _clampIndex(n, lo, hi, dflt) {
  if (!Number.isInteger(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

function _seedMap(seedOutputs) {
  if (seedOutputs instanceof Map) return new Map(seedOutputs);
  if (Array.isArray(seedOutputs)) return new Map(seedOutputs);
  return new Map();
}

function _terminalOf(outputs, graph, order) {
  const { outCount } = buildAdjacency(graph);
  const finals = graph.nodes
    .map((n) => n.id)
    .filter((id) => outputs.has(id) && (outCount.get(id) || 0) === 0);
  if (!finals.length) {
    for (let i = order.length - 1; i >= 0; i--) {
      if (outputs.has(order[i])) return outputs.get(order[i]);
    }
    return null;
  }
  if (finals.length === 1) return outputs.get(finals[0]);
  const result = {};
  for (const id of finals) result[id] = outputs.get(id);
  return result;
}

function _withTimeout(promise, ms, message) {
  if (!(ms > 0) || !Number.isFinite(ms)) return promise;
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(message);
      err.code = "recipe-step-timeout";
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => { if (timer) clearTimeout(timer); });
}

// 与 recipes.js 的 runNodeAsync 同口径（该文件由其他任务维护，此处保留一份避免循环依赖）。
async function runNodeAsync(node, inputText, params) {
  const op = getOp(node.opId);
  if (!op) throw new Error(`unknown opId: ${node.opId}`);
  params = params || node.params || {};
  const mode = nodeDirection(node, params);
  let result;
  if (mode === "decode") {
    if (typeof op.decode !== "function") throw new Error(`op ${node.opId} has no decode`);
    result = op.decode(inputText, params);
  } else if (mode === "encode") {
    if (typeof op.encode !== "function") throw new Error(`op ${node.opId} has no encode`);
    result = op.encode(inputText, params);
  } else if (mode === "run") {
    if (typeof op.run === "function") result = op.run(inputText, params);
    else if (typeof op.decode === "function") result = op.decode(inputText, params);
    else throw new Error(`op ${node.opId} has no run`);
  } else {
    if (typeof op.encode === "function") result = op.encode(inputText, params);
    else if (typeof op.run === "function") result = op.run(inputText, params);
    else throw new Error(`op ${node.opId} has no encode/run to default to`);
  }
  return await result;
}

// 线性执行器（支持控制节点跳转/分支）。
// · stopPos：本次运行的执行上限（单步时 == 起始下标）。
// · scopeLo/scopeEnd：结构范围，Fork 找配对 Merge、Jump 找 Label 都不越出此范围。
// · entryRaw：链头原始输入；nested 模式用 flowText 直接喂分支数据。
// · workOutputs：本层产物表（顶层就是最终 outputs；分支层是隔离的临时表）。
// 返回 {ok, nextPos, text, returned}；失败时 ctx.reason/errorIndex/errorNodeId 已写好。
async function runFlowRange(ctx, startPos, stopPos, scopeLo, scopeEnd, entryRaw, workOutputs, mode) {
  const { order, nodeMap, inEdges } = ctx;
  const nested = !!(mode && mode.nested);
  let pos = startPos;
  // seedFlow：单步/断点续跑跨过 Jump 后，下一步要接着跳转时的数据流，而不是回落到链头输入。
  let flowText = nested
    ? String(entryRaw == null ? "" : entryRaw)
    : (ctx.seedFlow == null ? null : String(ctx.seedFlow));
  let lastText = flowText;

  if (pos > stopPos) return { ok: true, nextPos: pos, text: flowText == null ? "" : flowText, flow: flowText };

  const raise = async (reason, atPos, node, msg, started) => {
    ctx.reason = reason;
    ctx.stoppedAt = atPos;
    ctx.errorIndex = atPos;
    ctx.errorNodeId = node && node.id != null ? String(node.id) : null;
    ctx.errorMessage = msg;
    const step = {
      index: atPos,
      nodeId: node && node.id != null ? String(node.id) : "",
      opId: node ? node.opId : undefined,
      skipped: false, text: "", error: msg,
      ms: started == null ? 0 : _round3(_nowMs() - started),
    };
    if (isControlNode(node)) step.control = controlTypeOf(node) || undefined;
    ctx.steps.push(step);
    if (typeof ctx.onStep === "function") await ctx.onStep(step);
    return { ok: false, nextPos: atPos, text: lastText == null ? "" : lastText, flow: flowText };
  };

  while (pos <= stopPos) {
    if (ctx.signal && ctx.signal.aborted) {
      ctx.reason = "cancelled"; ctx.stoppedAt = pos;
      return { ok: false, nextPos: pos, text: lastText == null ? "" : lastText, flow: flowText };
    }
    if (typeof ctx.shouldStop === "function" && ctx.shouldStop()) {
      ctx.reason = "cancelled"; ctx.stoppedAt = pos;
      return { ok: false, nextPos: pos, text: lastText == null ? "" : lastText, flow: flowText };
    }
    if (_nowMs() >= ctx.deadline) {
      ctx.reason = "timeout";
      ctx.stoppedAt = pos;
      ctx.errorMessage = "配方执行超时：总预算 " + ctx.budgetMs + " ms 已用尽（同步 op 无法中途打断，已在步骤间停止）。";
      return { ok: false, nextPos: pos, text: lastText == null ? "" : lastText, flow: flowText };
    }

    const id = order[pos];
    const node = nodeMap.get(id);
    if (!node) {
      ctx.reason = "exec-error"; ctx.stoppedAt = pos;
      ctx.errorIndex = pos; ctx.errorNodeId = String(id);
      ctx.errorMessage = "配方执行序引用了不存在的节点：" + id;
      return { ok: false, nextPos: pos, text: lastText == null ? "" : lastText, flow: flowText };
    }
    if (typeof ctx.shouldBreakBefore === "function" && ctx.shouldBreakBefore(pos, node)) {
      ctx.reason = "breakpoint";
      ctx.stoppedAt = pos;
      // 分支内断点没有「半条分支」的续跑上下文：续跑点退回最外层 Fork，整段分支重算。
      // stoppedAt 仍是真实断点步（用于定位），resumeAt 才是 UI「继续」的起点。
      ctx.resumeAt = nested ? (mode && mode.forkRoot != null ? mode.forkRoot : pos) : pos;
      return { ok: false, nextPos: pos, text: lastText == null ? "" : lastText, flow: flowText };
    }
    ctx.executed++;
    if (ctx.executed > ctx.maxSteps) {
      return await raise("budget", pos, node,
        `执行步数超过上限（${ctx.maxSteps}）：可能存在死循环。请检查 Jump / Conditional Jump 的标签与条件。`);
    }

    const incoming = inEdges.get(id) || [];
    const hasSeededUpstream = incoming.some((e) => workOutputs.has(e.from));
    let inputText, params;
    try {
      if (hasSeededUpstream) {
        const t = resolveTransitInput(node, workOutputs, incoming);
        inputText = t.text;
        if (t.params) params = t.params;
      } else if (flowText != null) {
        inputText = flowText;
      } else {
        const head = resolveRecipeHead(node, entryRaw);
        inputText = head.text;
        params = head.params;
      }
    } catch (err) {
      return await raise("exec-error", pos, node, errText(err));
    }

    let runParams;
    try {
      runParams = substituteParams(params || node.params || {}, ctx.registers, ctx.registerSeen);
    } catch (err) {
      return await raise("exec-error", pos, node, errText(err));
    }

    if (node.disabled && ctx.skipDisabled) {
      workOutputs.set(id, inputText);
      lastText = inputText;
      const step = {
        index: pos, nodeId: String(id), opId: node.opId,
        skipped: true, text: recipeDisplayText(inputText), ms: 0,
      };
      if (isControlNode(node)) step.control = controlTypeOf(node) || undefined;
      ctx.steps.push(step);
      if (typeof ctx.onStep === "function") await ctx.onStep(step);
      pos++;
      continue;
    }

    if (isControlNode(node)) {
      const ctl = controlTypeOf(node);
      if (!CONTROL_TYPE_SET.has(ctl)) {
        return await raise("exec-error", pos, node, `未知控制节点类型：${ctl || "(空)"}`);
      }
      const started = _nowMs();
      const emit = async (data) => {
        const step = {
          index: pos, nodeId: String(id), control: ctl, skipped: false,
          ms: _round3(_nowMs() - started), ...data,
        };
        ctx.steps.push(step);
        if (typeof ctx.onStep === "function") await ctx.onStep(step);
      };

      if (ctl === "register") {
        let info;
        ctx.registerSeen = true;
        try {
          info = applyRegisterCapture(ctx, runParams, inputText);
        } catch (err) {
          return await raise("exec-error", pos, node, errText(err), started);
        }
        workOutputs.set(id, inputText);
        lastText = inputText;
        await emit({
          text: recipeDisplayText(inputText),
          matched: !!info.matched,
          registerCount: info.count,
        });
        pos++;
        continue;
      }

      if (ctl === "label" || ctl === "subsection" || ctl === "merge") {
        // Label：跳转落点；Subsection：纯分组标记；Merge 未配对 Fork 时按透传处理（CyberChef Merge 本身不加工数据）。
        workOutputs.set(id, inputText);
        lastText = inputText;
        await emit({ text: recipeDisplayText(inputText) });
        pos++;
        continue;
      }

      if (ctl === "return") {
        workOutputs.set(id, inputText);
        lastText = inputText;
        await emit({ text: recipeDisplayText(inputText), returned: true });
        if (!nested) {
          ctx.terminalOverride = inputText;
          ctx.returned = true;
          ctx.stoppedAt = pos;
        }
        return { ok: true, nextPos: pos + 1, text: inputText, returned: true, flow: inputText };
      }

      if (ctl === "jump" || ctl === "conditionalJump") {
        let hit = true;
        if (ctl === "conditionalJump") {
          try { hit = evalJumpCondition(runParams, inputText); }
          catch (err) { return await raise("exec-error", pos, node, errText(err), started); }
        }
        const labelName = String(runParams.label == null ? "" : runParams.label);
        if (!hit) {
          workOutputs.set(id, inputText);
          lastText = inputText;
          await emit({ text: recipeDisplayText(inputText), jumped: false, label: labelName });
          pos++;
          continue;
        }
        ctx.jumps++;
        if (ctx.jumps > ctx.maxJumps) {
          return await raise("budget", pos, node,
            `跳转次数超过上限（${ctx.maxJumps}）：可能存在死循环（目标标签：${labelName || "(空)"}）。`,
            started);
        }
        const target = findLabelPos(ctx.labels, labelName, scopeLo, scopeEnd);
        if (target < 0) {
          return await raise("exec-error", pos, node,
            `跳转目标标签不存在或不在当前执行范围内：${labelName || "(空)"}`, started);
        }
        workOutputs.set(id, inputText);
        lastText = inputText;
        await emit({ text: recipeDisplayText(inputText), jumped: true, label: labelName, target });
        flowText = inputText;
        pos = target;
        continue;
      }

      if (ctl === "fork") {
        const mergePos = findMatchingMerge(order, nodeMap, pos, scopeEnd);
        if (mergePos < 0) {
          return await raise("exec-error", pos, node,
            `Fork 缺少匹配的 Merge（同一层内没有后续 Merge 节点）`, started);
        }
        let parts;
        try { parts = splitForkInput(inputText, runParams); }
        catch (err) { return await raise("exec-error", pos, node, errText(err), started); }
        if (parts.length > ctx.maxBranches) {
          return await raise("exec-error", pos, node,
            `Fork 分支数 ${parts.length} 超过上限 ${ctx.maxBranches}，请改用更粗的拆分方式。`, started);
        }
        if (ctx.nesting >= ctx.maxNesting) {
          return await raise("budget", pos, node,
            `Fork 嵌套层级超过上限（${ctx.maxNesting}）：请减少分支内的 Fork 嵌套。`, started);
        }
        const mergeId = order[mergePos];
        const mergeNode = nodeMap.get(mergeId);
        if (mergeNode && mergeNode.disabled && ctx.skipDisabled) {
          return await raise("exec-error", pos, node,
            `Fork 的配对 Merge（第 ${mergePos + 1} 步）被禁用：请启用该 Merge 或删除配对后再执行。`, started);
        }
        let mergeParams;
        try { mergeParams = substituteParams(mergeNode.params || {}, ctx.registers, ctx.registerSeen); }
        catch (err) { return await raise("exec-error", pos, node, errText(err), started); }
        const joinStr = unescapeSeparator(
          runParams.mergeDelimiter != null && runParams.mergeDelimiter !== ""
            ? runParams.mergeDelimiter
            : (mergeParams.join == null ? "\n" : mergeParams.join)
        );
        await emit({ text: recipeDisplayText(inputText), branchCount: parts.length });

        const savedRegs = ctx.registers.slice();
        const branchOuts = [];
        ctx.nesting++;
        try {
          for (let b = 0; b < parts.length; b++) {
            // 分支寄存器隔离（与 CyberChef 子配方同口径）：分支内 Register 不外泄。
            ctx.registers = savedRegs.slice();
            const nestedOutputs = new Map();
            nestedOutputs.set(id, parts[b]);
            const r = await runFlowRange(ctx, pos + 1, mergePos - 1, pos + 1, mergePos - 1,
              parts[b], nestedOutputs, {
                nested: true,
                branch: b,
                forkRoot: mode && mode.forkRoot != null ? mode.forkRoot : pos,
              });
            // 把分支内已完成的产物并回主表：分支中途失败时，输出区仍能显示最后一段已完成结果
            // （A2 的「错误保留前缀」在 Fork 里同样成立）。
            for (const [k, v] of nestedOutputs) workOutputs.set(k, v);
            if (!r.ok) {
              if (runParams.ignoreErrors) {
                branchOuts.push("");
                ctx.reason = "ok";
                ctx.errorIndex = null;
                ctx.errorNodeId = null;
                ctx.errorMessage = null;
                ctx.resumeAt = -1;
                continue;
              }
              return r;
            }
            branchOuts.push(r.text == null ? "" : String(r.text));
          }
        } finally {
          ctx.nesting--;
          ctx.registers = savedRegs;
        }
        const merged = branchOuts.join(joinStr);
        workOutputs.set(mergeId, merged);
        lastText = merged;
        flowText = merged;
        const mergeStep = {
          index: mergePos, nodeId: String(mergeId), control: "merge", skipped: false,
          text: recipeDisplayText(merged), branchCount: parts.length, merged: true, ms: 0,
        };
        ctx.steps.push(mergeStep);
        if (typeof ctx.onStep === "function") await ctx.onStep(mergeStep);
        pos = mergePos + 1;
        continue;
      }

      return await raise("exec-error", pos, node, `未实现的控制节点类型：${ctl}`, started);
    }

    const started = _nowMs();
    try {
      let out;
      const run = Promise.resolve().then(() => runNodeAsync(node, inputText, runParams));
      if (ctx.stepTimeoutMs > 0 && Number.isFinite(ctx.stepTimeoutMs)) {
        const remaining = ctx.deadline === Infinity ? Infinity : ctx.deadline - _nowMs();
        const limit = Math.max(1, Math.min(ctx.stepTimeoutMs, remaining === Infinity ? ctx.stepTimeoutMs : remaining));
        out = await _withTimeout(run, limit, "配方步骤等待超时：超过 " + Math.round(limit) + " ms");
      } else {
        out = await run;
      }
      workOutputs.set(id, out);
      lastText = out;
      const step = {
        index: pos, nodeId: String(id), opId: node.opId,
        skipped: false, text: recipeDisplayText(out), ms: _round3(_nowMs() - started),
      };
      ctx.steps.push(step);
      if (typeof ctx.onStep === "function") await ctx.onStep(step);
      pos++;
    } catch (err) {
      const msg = errText(err);
      const reason = err && err.code === "recipe-step-timeout" ? "timeout" : "exec-error";
      return await raise(reason, pos, node, msg, started);
    }
  }

  return { ok: true, nextPos: pos, text: lastText == null ? "" : lastText, flow: flowText };
}

/**
 * 异步按拓扑序执行配方，逐步回报结果。
 *
 * 每步完成即回报；出错/取消/超时/预算/断点均在停下的位置保留已完成前缀。
 * 控制节点（kind:"control"）在同一线性执行序里解释：jump 会改变下一条执行下标，
 * fork 会把两条控制标记之间的步骤在每条分支上各跑一次，再由匹配的 merge 合并。
 *
 * @param {{nodes:Array,edges:Array}} graph
 * @param {string|Uint8Array|Array|{text?:string,bytes?:Uint8Array}} input
 * @param {object} [opts]
 * @param {number} [opts.startAt=0] 起始执行下标（拓扑序）
 * @param {number} [opts.endAt] 结束执行下标（含）
 * @param {Map|Array} [opts.seedOutputs] 已算出的上游产物，用于继续断点 / 单步
 * @param {string[]} [opts.registers] 继续断点时带回的 $R0..$Rn
 * @param {string} [opts.seedFlow] 单步/续跑跨过 Jump/Fork 后要接着用的数据流（链头回退的替代）
 * @param {boolean} [opts.skipDisabled=true] 跳过 disabled 节点并原样传递输入
 * @param {()=>boolean} [opts.shouldStop] 步间取消判定
 * @param {(pos:number,node:object)=>boolean} [opts.shouldBreakBefore] 在第 pos 步执行前中断（断点）
 * @param {number} [opts.budgetMs] 总预算；步间检查
 * @param {number} [opts.stepTimeoutMs] 单步等待上限；仅对让出事件循环的异步 op 生效
 * @param {number} [opts.maxSteps=5000] 总执行步数上限（含跳转/分支重复执行），超限显式报错
 * @param {number} [opts.maxJumps=500] 跳转次数上限，防死循环
 * @param {number} [opts.maxBranches=200] Fork 单次最大分支数
 * @param {number} [opts.maxNesting=32] Fork 嵌套层级上限
 * @param {(step:object)=>void|Promise} [opts.onStep] 每步完成（含跳过/失败）回调
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ok:boolean,reason:string,steps:Array,outputs:Map,terminal:any,startedAt:number,stoppedAt:number,nextCursor:number,resumeAt:number|null,flow:string|null,errorIndex:number,errorNodeId:string|null,error:string|null,elapsedMs:number,registers:string[],returned:boolean}>}
 */
export async function executeRecipeSteps(graph, input, opts = {}) {
  const order = topoSort(graph);
  const nodeMap = buildIndex(graph);
  const { inEdges } = buildAdjacency(graph);
  const total = order.length;
  const startAt = _clampIndex(opts.startAt, 0, total, 0);
  const endAt = _clampIndex(opts.endAt, -1, total - 1, total - 1);
  const outputs = _seedMap(opts.seedOutputs);
  const steps = [];
  const t0 = _nowMs();
  const deadline = opts.budgetMs > 0 && Number.isFinite(opts.budgetMs) ? t0 + opts.budgetMs : Infinity;

  if (!total) {
    return {
      ok: true, reason: "ok", steps, outputs, terminal: null,
      startedAt: 0, stoppedAt: -1, nextCursor: 0, flow: null, resumeAt: null,
      errorIndex: -1, errorNodeId: null, error: null, elapsedMs: 0,
      registers: [], returned: false,
    };
  }

  const ctx = {
    order, nodeMap, inEdges,
    steps,
    skipDisabled: opts.skipDisabled !== false,
    shouldStop: typeof opts.shouldStop === "function" ? opts.shouldStop : null,
    shouldBreakBefore: typeof opts.shouldBreakBefore === "function" ? opts.shouldBreakBefore : null,
    onStep: typeof opts.onStep === "function" ? opts.onStep : null,
    signal: opts.signal || null,
    budgetMs: opts.budgetMs,
    stepTimeoutMs: opts.stepTimeoutMs,
    deadline,
    labels: buildLabelIndex(order, nodeMap),
    registers: Array.isArray(opts.registers) ? opts.registers.map((v) => String(v)) : [],
    seedFlow: opts.seedFlow == null ? null : String(opts.seedFlow),
    maxSteps: posInt(opts.maxSteps, DEFAULT_MAX_STEPS, 1),
    maxJumps: posInt(opts.maxJumps, DEFAULT_MAX_JUMPS, 1),
    maxBranches: posInt(opts.maxBranches, DEFAULT_MAX_BRANCHES, 1),
    maxNesting: posInt(opts.maxNesting, DEFAULT_MAX_NESTING, 1),
    executed: 0,
    jumps: 0,
    nesting: 0,
    // 续跑时外部带回寄存器 → 视为链上已有 Register；否则旧配方里的字面量 $R0 保持原样。
    registerSeen: Array.isArray(opts.registers) && opts.registers.length > 0,
    reason: "ok",
    stoppedAt: endAt,
    nextCursor: endAt + 1,
    resumeAt: -1,
    errorIndex: -1,
    errorNodeId: null,
    errorMessage: null,
    terminalOverride: null,
    returned: false,
  };

  const r = await runFlowRange(ctx, startAt, endAt, 0, total - 1, input, outputs, { nested: false });
  // 单步推进要用实际执行到的位置（Fork 一次吃掉整段分支；Jump 落在目标标签）。
  ctx.nextCursor = r.nextPos;

  const terminal = ctx.terminalOverride != null
    ? ctx.terminalOverride
    : _terminalOf(outputs, graph, order);

  return {
    ok: ctx.reason === "ok",
    reason: ctx.reason,
    steps,
    outputs,
    terminal,
    startedAt: startAt,
    stoppedAt: ctx.stoppedAt,
    nextCursor: ctx.nextCursor,
    resumeAt: ctx.resumeAt >= 0 ? ctx.resumeAt : null,
    flow: r.flow == null ? null : r.flow,
    errorIndex: ctx.errorIndex,
    errorNodeId: ctx.errorNodeId,
    error: ctx.errorMessage,
    elapsedMs: _round3(_nowMs() - t0),
    registers: ctx.registers.slice(),
    returned: ctx.returned,
  };
}

/** 单节点异步执行（步进器用；与 executeRecipeSteps 的节点执行口径一致）。 */
export function runRecipeNodeAsync(node, inputText, params) {
  return runNodeAsync(node, inputText, params);
}

// ---- validateRecipe ----

// 控制节点参数的前置校验：正则先编译一遍，避免执行到一半才炸。
function validateControlParams(node, ctl) {
  const p = node.params || {};
  if (ctl === "register") {
    const src = String(p.regex == null ? "" : p.regex);
    if (!src) {
      if (p.strict) throw new Error("Register 的 strict 模式需要填写正则表达式");
      return;
    }
    try { new RegExp(src, String(p.flags || "")); }
    catch (e) { throw new Error("Register 正则无效：" + errText(e)); }
    return;
  }
  if (ctl === "conditionalJump" && String(p.matchType || "contains") === "regex") {
    try { new RegExp(String(p.pattern == null ? "" : p.pattern)); }
    catch (e) { throw new Error("条件跳转正则无效：" + errText(e)); }
    return;
  }
  if (ctl === "fork") {
    const mode = String(p.splitMode || "line");
    if (!["line", "regex", "literal"].includes(mode)) throw new Error(`Fork 未知拆分方式 ${mode}`);
    if (mode === "regex") {
      try { new RegExp(String(p.splitter == null ? "\n" : p.splitter)); }
      catch (e) { throw new Error("Fork 拆分正则无效：" + errText(e)); }
    } else if (mode === "literal") {
      const sep = unescapeSeparator(p.splitter == null ? "\n" : p.splitter);
      if (sep === "") throw new Error("Fork 字面拆分符不能为空");
    }
  }
}

/**
 * 校验：所有 opId / 控制节点类型存在、无悬空 edge、无环；
 * 有控制节点时额外校验 Label 重名、Jump 目标、Fork/Merge 配对。
 * @param {{nodes:Array,edges:Array}} graph
 * @returns {{ok:boolean, errors:string[]}}
 */
export function validateRecipe(graph) {
  const errors = [];
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return { ok: false, errors: ["graph must have nodes[] and edges[]"] };
  }

  const ids = new Set();
  let hasControl = false;
  for (const n of graph.nodes) {
    if (n.id == null) {
      errors.push("node missing id");
      continue;
    }
    if (ids.has(n.id)) errors.push(`duplicate node id: ${n.id}`);
    ids.add(n.id);
    if (isControlNode(n)) {
      hasControl = true;
      const ctl = controlTypeOf(n);
      if (!CONTROL_TYPE_SET.has(ctl)) {
        errors.push(`未知控制节点类型: ${ctl || "(空)"} (node ${n.id})`);
        continue;
      }
      try { validateControlParams(n, ctl); }
      catch (err) { errors.push(`${CONTROL_LABELS[ctl]} (node ${n.id}): ${errText(err)}`); }
    } else if (!getOp(n.opId)) {
      errors.push(`unknown opId: ${n.opId} (node ${n.id})`);
    }
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

  if (hasControl) {
    const labels = new Map();
    graph.nodes.forEach((n, i) => {
      if (controlTypeOf(n) !== "label") return;
      const name = String((n.params && n.params.name) || "");
      if (!name) { errors.push(`第 ${i + 1} 个节点 Label 未填写标签名`); return; }
      if (labels.has(name)) { errors.push(`Label 标签重名: ${name}（第 ${labels.get(name) + 1} 与第 ${i + 1} 个节点）`); return; }
      labels.set(name, i);
    });
    graph.nodes.forEach((n, i) => {
      const ctl = controlTypeOf(n);
      if (ctl !== "jump" && ctl !== "conditionalJump") return;
      const name = String((n.params && n.params.label) || "");
      if (!name) errors.push(`第 ${i + 1} 个节点 ${CONTROL_LABELS[ctl]} 未选择目标标签`);
      else if (!labels.has(name)) errors.push(`第 ${i + 1} 个节点 ${CONTROL_LABELS[ctl]} 的目标标签不存在: ${name}`);
    });
    const stack = [];
    graph.nodes.forEach((n, i) => {
      const ctl = controlTypeOf(n);
      if (ctl === "fork") stack.push(i);
      else if (ctl === "merge") {
        if (!stack.length) errors.push(`第 ${i + 1} 个节点 Merge 没有匹配的 Fork`);
        else stack.pop();
      }
    });
    for (const p of stack) errors.push(`第 ${p + 1} 个节点 Fork 缺少匹配的 Merge`);
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
