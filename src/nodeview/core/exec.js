/*
 * exec.js — 图执行器（T951 候选，无 DOM）。
 *
 * 语义（与 MT809 执行条逐项对齐）：
 *  · 拓扑序执行（Kahn，同层按 nodes 声明序，结果稳定可复现）。
 *  · 一个节点失败只阻断它的下游；旁支继续跑。整体结果 ok=false + reason="partial-failure"，
 *    失败节点与原因逐条留在 result.errors 里（不吞错）。
 *  · 禁用节点走旁路：输入原样传给下游，不调用算法；多输入时的规则见 bypassValue()。
 *  · 每个节点记录 状态 / 耗时 / 输出预览；状态取值 idle|running|ok|error|blocked|disabled。
 *  · 缓存键 = 引擎版本 + opId + 方向 + 节点最终参数（含提升端口带来的值）+ 每个输入端口值的哈希。
 *    命中时**不调用算法**（stats.algorithmCalls 不增长），直接复用上次的端口输出。
 *  · 可取消（AbortSignal，节点间生效）；单节点超时（nodeTimeoutMs，同步算法无法中途打断，如实标注）。
 *  · 执行函数可注入（runNode）：默认 defaultRunNode 直接调用注册表里的 encode/decode/run。
 *
 * 数据类型只在端口上流动 text / bytes 两种；内核不做内容嗅探（不猜 hex 还是 UTF-8）。
 */

import { ERROR_CODES, WARNING_CODES, issue, warning } from "./errors.js";
import { derivePorts, outputPortOf } from "./ports.js";
import { defaultsOf, resolveOp } from "./runtime.js";
import { stableStringify, validateGraph } from "./graph.js";

export const ENGINE_VERSION = "t951.1";

export const NODE_STATUS = Object.freeze({
  IDLE: "idle",
  RUNNING: "running",
  OK: "ok",
  ERROR: "error",
  BLOCKED: "blocked",
  DISABLED: "disabled",
});

const now =
  typeof performance !== "undefined" && performance && typeof performance.now === "function"
    ? () => performance.now()
    : () => Date.now();

function round3(ms) {
  return Math.round(ms * 1000) / 1000;
}

// ---------------------------------------------------------------- 值

/** text 值。 */
export function textValue(text, extra = {}) {
  return { type: "text", text: text == null ? "" : String(text), ...extra };
}

/** bytes 值（可附带 files）。 */
export function bytesValue(bytes, extra = {}) {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes || []);
  return { type: "bytes", bytes: b, text: hexOf(b), ...extra };
}

export function hexOf(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

export function bytesOfHex(hex) {
  const clean = String(hex || "").replace(/[\s:,-]/g, "").replace(/^0x/i, "");
  if (clean.length % 2) throw new Error("hex 长度必须是偶数");
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error("hex 含非十六进制字符");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export function bytesOfBase64(b64) {
  const s = String(b64 || "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  let bytes;
  if (typeof atob === "function") {
    const bin = atob(s + pad);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else {
    bytes = new Uint8Array(Buffer.from(s + pad, "base64"));
  }
  return bytes;
}

/**
 * 把算法返回值归一化为端口值。
 * 与 recipe.js 的中转口径一致：字符串→text；{text,files}→text + files；其它对象→JSON 文本。
 * Uint8Array / ArrayBuffer 直接按 bytes（算法原生字节结果）。
 */
export function normalizeResult(out) {
  if (out == null) return { out: textValue(""), files: [] };
  if (typeof out === "string") return { out: textValue(out), files: [] };
  if (typeof out === "number" || typeof out === "boolean") return { out: textValue(String(out)), files: [] };
  if (out instanceof Uint8Array) {
    const v = bytesValue(out);
    return { out: v, files: [] };
  }
  if (out instanceof ArrayBuffer) {
    const v = bytesValue(new Uint8Array(out));
    return { out: v, files: [] };
  }
  if (ArrayBuffer.isView(out)) {
    return { out: bytesValue(new Uint8Array(out.buffer, out.byteOffset, out.byteLength)), files: [] };
  }
  if (typeof out === "object") {
    const hasShape = "text" in out || "files" in out;
    const files = fileEntriesOf(out.files);
    if (!hasShape) return { out: textValue(JSON.stringify(out)), files: [] };
    return { out: textValue(out.text == null ? "" : String(out.text)), files };
  }
  return { out: textValue(String(out)), files: [] };
}

/** 只认 bytes / dataUrl 两种文件载荷；其余形态显式报错（不静默丢文件）。 */
function fileEntriesOf(files) {
  if (!Array.isArray(files) || !files.length) return [];
  return files.map((f, i) => {
    if (!f || typeof f !== "object") {
      throw new Error(`算法返回的第 ${i + 1} 个文件不是对象`);
    }
    let bytes = null;
    if (f.bytes instanceof Uint8Array) bytes = f.bytes;
    else if (f.bytes instanceof ArrayBuffer) bytes = new Uint8Array(f.bytes);
    else if (Array.isArray(f.bytes)) bytes = Uint8Array.from(f.bytes);
    else if (typeof f.dataUrl === "string") {
      const comma = f.dataUrl.indexOf(",");
      bytes = bytesOfBase64(comma >= 0 ? f.dataUrl.slice(comma + 1) : f.dataUrl);
    }
    if (!bytes) throw new Error(`算法返回的第 ${i + 1} 个文件既没有 bytes 也没有 dataUrl`);
    return { name: String(f.name || `file${i + 1}`), mime: f.mime ? String(f.mime) : "", bytes };
  });
}

// ---------------------------------------------------------------- 拓扑序

/**
 * 拓扑排序（稳定）。端点不存在或成环则抛错（exec 前置校验已拦，这里是最后一道）。
 * @returns {string[]}
 */
export function topoOrder(graph) {
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const ids = nodes.map((n) => n.id);
  const idSet = new Set(ids);
  const indeg = new Map(ids.map((id) => [id, 0]));
  const adj = new Map(ids.map((id) => [id, []]));
  const edges = Array.isArray(graph.edges) ? graph.edges : [];
  for (const e of edges) {
    const a = e && e.from && e.from.node;
    const b = e && e.to && e.to.node;
    if (!idSet.has(a) || !idSet.has(b)) continue;
    indeg.set(b, indeg.get(b) + 1);
    adj.get(a).push(b);
  }
  const queue = ids.filter((id) => indeg.get(id) === 0);
  const order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const nxt of adj.get(id)) {
      const d = indeg.get(nxt) - 1;
      indeg.set(nxt, d);
      if (d === 0) queue.push(nxt);
    }
  }
  if (order.length !== ids.length) throw new Error("图中有环，无法拓扑排序");
  return order;
}

// ---------------------------------------------------------------- 哈希与缓存

function fnv1a64Hex(bytes) {
  let h1 = 0x811c9dc5;
  let h2 = 0xc9dc5118;
  for (let i = 0; i < bytes.length; i++) {
    h1 ^= bytes[i];
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = (h2 + bytes[i] + ((h1 << 7) | (h1 >>> 25))) >>> 0;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return "fnv:" + h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}

/** sha256（有 WebCrypto 时用它；没有则退回带前缀的 FNV-1a 128 位，绝不伪装成 sha256）。 */
export async function hashBytes(bytes) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (subtle && typeof subtle.digest === "function") {
    try {
      const d = await subtle.digest("SHA-256", bytes);
      return "sha256:" + hexOf(new Uint8Array(d));
    } catch {
      /* 落到 FNV */
    }
  }
  return fnv1a64Hex(bytes);
}

export async function hashText(text) {
  return hashBytes(new TextEncoder().encode(String(text == null ? "" : text)));
}

function valuePayload(value) {
  if (!value) return new Uint8Array(0);
  if (value.type === "bytes" && value.bytes) {
    if (value.files && value.files.length === 1) return value.files[0].bytes;
    return value.bytes;
  }
  return new TextEncoder().encode(String(value.text == null ? "" : value.text));
}

/** 输入端口值 → 缓存用的短指纹。 */
async function inputFingerprint(portName, value) {
  const h = await hashBytes(valuePayload(value));
  const files = value && value.files ? value.files.map((f) => `${f.name}:${f.bytes.length}`).join("|") : "";
  return `${portName}=${value ? value.type : "none"}@${h}${files ? "#" + files : ""}`;
}

/** 内存缓存（跨调用复用；只有显式传同一个 cache 才会命中历史结果）。 */
export function createMemoryCache(limit = 500) {
  const map = new Map();
  return {
    kind: "memory",
    limit,
    stats: { hits: 0, misses: 0, sets: 0 },
    get(key) {
      const v = map.get(key);
      if (v === undefined) {
        this.stats.misses++;
        return undefined;
      }
      this.stats.hits++;
      // LRU：命中后挪到队尾
      map.delete(key);
      map.set(key, v);
      return v;
    },
    set(key, value) {
      this.stats.sets++;
      map.set(key, value);
      while (map.size > this.limit) map.delete(map.keys().next().value);
      return value;
    },
    has(key) {
      return map.has(key);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
  };
}

async function cacheKeyOf({ opId, direction, params, inputs, hasFiles }) {
  const parts = [`engine=${ENGINE_VERSION}`, `op=${opId}`, `dir=${direction}`];
  const clean = {};
  for (const k of Object.keys(params || {}).sort()) {
    if (k === "rawBytes") continue;
    const v = params[k];
    if (typeof v === "function" || v === undefined) continue;
    clean[k] = v instanceof Uint8Array ? { $bytes: hexOf(v) } : v;
  }
  parts.push("params=" + stableStringify(clean));
  const fps = [];
  for (const name of Object.keys(inputs || {}).sort()) {
    fps.push(await inputFingerprint(name, inputs[name]));
  }
  parts.push("inputs=" + fps.join("&"));
  parts.push("files=" + (hasFiles ? "1" : "0"));
  return "nvc1:" + (await hashText(parts.join("|")));
}

// ---------------------------------------------------------------- 参数提升与类型转换

function castParamValue(text, def) {
  const raw = String(text == null ? "" : text);
  const type = def && def.type ? def.type : "text";
  if (type === "number") {
    if (raw.trim() === "") {
      throw Object.assign(new Error(`参数「${def.key}」是数字类型，参数端口收到空值`), { code: ERROR_CODES.E_PARAM_PORT_CAST });
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      throw Object.assign(new Error(`参数「${def.key}」需要数字，参数端口收到 ${JSON.stringify(raw)}`), {
        code: ERROR_CODES.E_PARAM_PORT_CAST,
      });
    }
    return n;
  }
  if (type === "bool") {
    const s = raw.trim().toLowerCase();
    if (["true", "1", "yes", "on", "是"].includes(s)) return true;
    if (["false", "0", "no", "off", "否", ""].includes(s)) return false;
    throw Object.assign(new Error(`参数「${def.key}」需要布尔值，参数端口收到 ${JSON.stringify(raw)}`), {
      code: ERROR_CODES.E_PARAM_PORT_CAST,
    });
  }
  if (type === "select") {
    const allowed = (def.options || []).map((o) => o.value);
    if (allowed.length && !allowed.includes(raw)) {
      throw Object.assign(
        new Error(`参数「${def.key}」只接受 ${allowed.join(" / ")}，参数端口收到 ${JSON.stringify(raw)}`),
        { code: ERROR_CODES.E_PARAM_PORT_CAST, allowed },
      );
    }
    return raw;
  }
  return raw;
}

/**
 * 计算节点最终参数：算法默认值 ← 节点 params ← 已接线的 param:<key> 端口值。
 * 提升端口的值是**按参数定义逐键转换**的，不存在「拼成字符串再解析」。
 */
/** MT810 接线适配：op 是否用 slots 字段模式（字段独立进 params.fields，不拼串）。 */
function opFieldsModeSlots(node, reg) {
  const op = resolveOp(node.opId, reg);
  return !!(op && op.fieldsMode === "slots");
}

export function resolveNodeParams(node, table, portInputs, reg) {
  const op = resolveOp(node.opId, reg);
  const params = { ...(op ? defaultsOf(op) : {}), ...(node.params || {}) };
  const promoted = {};
  const defs = new Map((op && op.params ? op.params : []).map((d) => [d.key, d]));
  // MT810 接线适配：fieldsMode:"slots" 的 op（如现用 diffTool）各字段独立进 params.fields[key]，
  // 不按 fieldsJoin 拼主输入——与 src/core/inputContract.js 的 slots 口径一致。
  if (op && op.fieldsMode === "slots" && Array.isArray(op.fields)) {
    const slots = {};
    for (const f of op.fields) {
      if (!f || typeof f.key !== "string") continue;
      const v = portInputs[`field:${f.key}`];
      if (v) slots[f.key] = { kind: v.type === "bytes" ? "bytes" : "text", value: v.type === "bytes" ? v.bytes : (v.text || "") };
      else if (node.params && node.params[f.key] != null) slots[f.key] = { kind: "text", value: String(node.params[f.key]) };
      // mirrorParam 旧通道：字段有值时清除 params 里的旧键，避免 inputContract 判「双来源冲突」
      if (f.mirrorParam && slots[f.key] != null) delete params[f.mirrorParam];
    }
    if (Object.keys(slots).length) params.fields = slots;
  }
  for (const port of table.inputs) {
    if (port.kind !== "param") continue;
    const v = portInputs[port.name];
    if (!v) continue; // 未接线 → 用节点自身参数/默认值
    if (v.type !== "text") {
      throw Object.assign(
        new Error(`参数端口 ${port.name} 只收 text，收到 ${v.type}；请在上游显式转成文本`),
        { code: ERROR_CODES.E_TYPE_MISMATCH },
      );
    }
    params[port.paramKey] = castParamValue(v.text, defs.get(port.paramKey) || { key: port.paramKey, type: port.paramType });
    promoted[port.paramKey] = v.text;
  }
  return { params, promoted };
}

// ---------------------------------------------------------------- 默认执行函数

/**
 * 默认执行函数：直接调用算法（与 recipe.js runNodeAsync 同口径）。
 * 字节输入通过 params.rawBytes 无损进入算法，text 只作为无损表示（hex）。
 */
export async function defaultRunNode(node, ctx) {
  const op = resolveOp(node.opId, ctx && ctx.registry);
  if (!op) {
    throw Object.assign(new Error(`未知算法 id：${node.opId}`), { code: ERROR_CODES.E_UNKNOWN_OP });
  }
  const params = { ...ctx.params };
  if (ctx.input && ctx.input.bytes) params.rawBytes = ctx.input.bytes;
  const text = ctx.input && ctx.input.text != null ? ctx.input.text : "";
  const dir = ctx.direction;
  if (dir === "decode") {
    if (typeof op.decode !== "function") throw new Error(`算法 ${node.opId} 没有 decode 入口`);
    return op.decode(text, params);
  }
  if (dir === "encode") {
    if (typeof op.encode !== "function") throw new Error(`算法 ${node.opId} 没有 encode 入口`);
    return op.encode(text, params);
  }
  if (dir === "run") {
    if (typeof op.run === "function") return op.run(text, params);
    if (typeof op.decode === "function") return op.decode(text, params); // 与 recipe.js 兼容口径一致
    throw new Error(`算法 ${node.opId} 没有 run 入口`);
  }
  if (typeof op.encode === "function") return op.encode(text, params);
  if (typeof op.run === "function") return op.run(text, params);
  throw new Error(`算法 ${node.opId} 没有可执行入口`);
}

// ---------------------------------------------------------------- 旁路

/**
 * 禁用节点的旁路取值规则（必须写死，否则多人实现会各走一套）：
 *  1) 按端口表顺序找**第一个有连线的输入端口**，把它的值原样传给 out；
 *  2) 其余已连线的输入端口不参与输出，但逐条记进 record.bypass.ignored（不静默丢弃信息）；
 *  3) 没有任何输入连线时：@input/@const 输出自身配置值；其它节点输出空文本值。
 *  4) 若被旁路的节点声明了 files 端口，files 端口输出空字节串（不伪造文件）。
 */
function bypassValue(table, portInputs) {
  const connected = table.inputs.filter((p) => portInputs[p.name]);
  const first = connected[0] || null;
  const ignored = connected.slice(1).map((p) => p.name);
  const value = first ? portInputs[first.name] : textValue("");
  return {
    value,
    info: {
      sourcePort: first ? first.name : null,
      ignored,
    },
  };
}

// ---------------------------------------------------------------- 执行

function previewOf(value, limit) {
  if (!value) return null;
  const head = (s) => (s.length > limit ? s.slice(0, limit) + "…" : s);
  if (value.type === "bytes") {
    const n = value.bytes ? value.bytes.length : 0;
    return {
      type: "bytes",
      bytesLength: n,
      text: head(hexOf((value.bytes || new Uint8Array(0)).slice(0, Math.ceil(limit / 2)))),
      files: (value.files || []).map((f) => ({ name: f.name, mime: f.mime, bytes: f.bytes.length })),
    };
  }
  return { type: "text", chars: (value.text || "").length, text: head(value.text || ""), files: [] };
}

function readSourceInput(node, table, opts, idx) {
  const provided = opts.inputs && Object.prototype.hasOwnProperty.call(opts.inputs, node.id) ? opts.inputs[node.id] : undefined;
  const kind = String((node.params && node.params.kind) || "text");
  const fmt = String((node.params && node.params.format) || "text");

  if (node.opId === "@output") return null; // 由输入端口提供
  if (node.opId === "@note") return null;

  const raw = provided !== undefined ? provided : node.params && node.params.value;
  if (provided === undefined && (raw === undefined || raw === null)) {
    throw Object.assign(
      new Error(`节点 ${node.id}（${node.opId}）没有输入值：请通过 inputs["${node.id}"] 提供，或在节点 params.value 里写死`),
      { code: ERROR_CODES.E_INPUT_MISSING, path: `nodes[${idx}]` },
    );
  }
  if (kind === "file") {
    if (raw instanceof Uint8Array) return bytesValue(raw);
    if (raw instanceof ArrayBuffer) return bytesValue(new Uint8Array(raw));
    if (raw && typeof raw === "object" && (raw.bytes || raw.dataUrl || raw.name)) {
      const files = fileEntriesOf([raw]);
      return bytesValue(files[0].bytes, { files });
    }
    throw Object.assign(
      new Error(`@input（file）需要字节或 {name,mime,bytes|dataUrl}，收到 ${typeof raw}；文本无法隐式当作文件`),
      { code: ERROR_CODES.E_INPUT_MISSING },
    );
  }
  if (kind === "text") {
    if (typeof raw === "string") return textValue(raw);
    if (raw && typeof raw === "object" && typeof raw.text === "string" && !raw.bytes) return textValue(raw.text);
    throw Object.assign(
      new Error(`@input（text）需要字符串，收到 ${raw && raw.type ? raw.type : typeof raw}；bytes 不会被隐式解码，请改用 hex/base64 源或插入转换节点`),
      { code: ERROR_CODES.E_TYPE_MISMATCH },
    );
  }
  // hex / base64 源：源头显式声明表示法，解析失败就是失败（不猜）
  const str = typeof raw === "string" ? raw : raw && typeof raw.text === "string" ? raw.text : null;
  if (str == null) {
    throw Object.assign(new Error(`@input（${kind}）需要字符串表示`), { code: ERROR_CODES.E_INPUT_MISSING });
  }
  try {
    return bytesValue(kind === "hex" ? bytesOfHex(str.trim()) : bytesOfBase64(str));
  } catch (e) {
    throw Object.assign(new Error(`@input（${kind}）内容不是合法 ${kind}：${e.message}`), {
      code: ERROR_CODES.E_INVALID_FIELD,
    });
  }
}

/**
 * 执行整张图。
 *
 * @param {object} graph 图格式 v1
 * @param {object} [opts]
 * @param {Record<string, any>} [opts.inputs] @input 节点的输入（按节点 id）
 * @param {object} [opts.registry] 注册表（缺省用 configureRegistry 注入的）
 * @param {Function} [opts.runNode] 注入执行函数 (node, ctx) => result|Promise
 * @param {object} [opts.cache] 缓存（createMemoryCache()）；不传则本次运行内私有（跨次不命中）
 * @param {AbortSignal} [opts.signal]
 * @param {number} [opts.nodeTimeoutMs] 单节点超时（毫秒，<=0 不限）
 * @param {number} [opts.previewLimit=120]
 * @param {boolean} [opts.skipValidate=false]
 * @param {boolean|Set|Function} [opts.hasFiles] 产物文件提示
 * @param {Function} [opts.onNode] 每节点完成回调 (record) => void|Promise
 * @returns {Promise<object>}
 */
export async function executeGraph(graph, opts = {}) {
  const t0 = now();
  const previewLimit = Number.isFinite(opts.previewLimit) ? Math.max(0, opts.previewLimit) : 120;
  const stats = { algorithmCalls: 0, cacheHits: 0, cacheMisses: 0, executed: 0, failed: 0, blocked: 0, disabled: 0, cached: 0 };
  const errors = [];
  const warnings = [];

  if (opts.skipValidate !== true) {
    const v = validateGraph(graph, { registry: opts.registry, hasFiles: opts.hasFiles });
    warnings.push(...v.warnings);
    if (!v.ok) {
      return {
        ok: false,
        reason: "invalid-graph",
        errors: v.errors,
        warnings,
        order: [],
        nodes: {},
        outputs: new Map(),
        terminal: null,
        elapsedMs: round3(now() - t0),
        stats,
        cancelled: false,
      };
    }
  }

  const order = topoOrder(graph);
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const inEdges = new Map(graph.nodes.map((n) => [n.id, []]));
  const outCount = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const e of graph.edges) {
    inEdges.get(e.to.node).push(e);
    outCount.set(e.from.node, (outCount.get(e.from.node) || 0) + 1);
  }
  const tables = new Map();
  for (const n of graph.nodes) {
    tables.set(n.id, derivePorts(n.opId, { registry: opts.registry, params: n.params, direction: n.direction, hasFiles: opts.hasFiles }));
  }

  const outputs = new Map(); // id -> { out: Value, files?: Value }
  // 先给每个节点建一条 idle 记录：取消/提前退出时，没跑到的节点也有状态可读（UI 不会拿到 undefined）
  const records = {};
  for (const n of graph.nodes) {
    records[n.id] = { id: n.id, opId: n.opId, status: NODE_STATUS.IDLE, ms: 0, cached: false, attempts: 0, preview: null, error: null };
  }
  const cache = opts.cache || createMemoryCache(200);
  const runNode = typeof opts.runNode === "function" ? opts.runNode : defaultRunNode;
  const signal = opts.signal || null;
  const timeoutMs = Number.isFinite(opts.nodeTimeoutMs) ? opts.nodeTimeoutMs : 0;

  const emit = async (rec) => {
    if (typeof opts.onNode === "function") {
      try {
        await opts.onNode(rec);
      } catch (e) {
        errors.push(issue(ERROR_CODES.E_INVALID_FIELD, `onNode 回调抛错：${e && e.message ? e.message : e}`, rec.id));
      }
    }
  };

  let cancelled = false;

  for (const id of order) {
    const node = nodeMap.get(id);
    const table = tables.get(id);
    const rec = {
      id,
      opId: node.opId,
      status: NODE_STATUS.IDLE,
      ms: 0,
      cached: false,
      attempts: 0,
      preview: null,
      error: null,
    };
    records[id] = rec;

    if (signal && signal.aborted) {
      cancelled = true;
      break;
    }

    const incoming = inEdges.get(id) || [];
    const portInputs = {};

    // ---- 上游阻断判定 ----
    let blockedBy = null;
    let blockedWhy = "";
    for (const e of incoming) {
      const srcRec = records[e.from.node];
      if (!srcRec || srcRec.status === NODE_STATUS.ERROR || srcRec.status === NODE_STATUS.BLOCKED) {
        blockedBy = e.from.node;
        blockedWhy = `上游节点「${e.from.node}」失败或被阻断`;
        break;
      }
      const srcOut = outputs.get(e.from.node);
      if (!srcOut) {
        blockedBy = e.from.node;
        blockedWhy = `上游节点「${e.from.node}」没有产出`;
        break;
      }
      const isFilesPort = outputPortOf(tables.get(e.from.node), e.from.port)?.name === "files";
      const val = isFilesPort ? srcOut.files : srcOut.out;
      if (!val) {
        blockedBy = e.from.node;
        blockedWhy = `端口「${e.from.node}.${e.from.port}」没有可用的${isFilesPort ? "产物文件" : "输出"}（该算法这次没有产出${isFilesPort ? "文件" : "值"}）`;
        break;
      }
      portInputs[e.to.port] = val;
    }

    // ---- @note：不执行 ----
    if (node.opId === "@note") {
      rec.status = NODE_STATUS.OK;
      rec.ms = 0;
      stats.executed++;
      await emit(rec);
      continue;
    }

    // ---- 禁用：旁路 ----
    if (node.disabled === true) {
      const started = now();
      let bypassed;
      if (node.opId === "@input" || node.opId === "@const") {
        try {
          bypassed = { value: readSourceInput(node, table, opts, indexOfNode(graph, id)), info: { sourcePort: null, ignored: [] } };
        } catch (e) {
          rec.status = NODE_STATUS.ERROR;
          rec.error = { code: e.code || ERROR_CODES.E_INPUT_MISSING, message: e.message };
          rec.ms = round3(now() - started);
          errors.push(issue(rec.error.code, rec.error.message, id));
          stats.failed++;
          await emit(rec);
          continue;
        }
      } else {
        bypassed = bypassValue(table, portInputs);
        if (bypassed.info.ignored.length) {
          warnings.push(
            warning(
              WARNING_CODES.W_BYPASS_MULTI_INPUT,
              `节点 ${id} 已禁用（旁路）：只透传端口 ${bypassed.info.sourcePort}，忽略 ${bypassed.info.ignored.join(" / ")}`,
              id,
              bypassed.info,
            ),
          );
        }
      }
      outputs.set(id, { out: bypassed.value, files: null });
      rec.status = NODE_STATUS.DISABLED;
      rec.ms = round3(now() - started);
      rec.output = { type: bypassed.value.type };
      rec.preview = previewOf(bypassed.value, previewLimit);
      rec.bypass = bypassed.info;
      stats.disabled++;
      await emit(rec);
      continue;
    }

    // ---- 阻断 ----
    if (blockedBy) {
      rec.status = NODE_STATUS.BLOCKED;
      rec.error = { code: ERROR_CODES.E_NOT_RUNNABLE, message: `${blockedWhy}，本节点不再执行` };
      stats.blocked++;
      await emit(rec);
      continue;
    }

    // ---- 特殊源节点 ----
    if (node.opId === "@input" || node.opId === "@const") {
      const started = now();
      try {
        const val = readSourceInput(node, table, opts, indexOfNode(graph, id));
        outputs.set(id, { out: val, files: val.files && val.files.length ? bytesValue(val.files[0].bytes, { files: val.files }) : null });
        rec.status = NODE_STATUS.OK;
        rec.ms = round3(now() - started);
        rec.preview = previewOf(val, previewLimit);
        rec.output = { type: val.type };
        stats.executed++;
      } catch (e) {
        rec.status = NODE_STATUS.ERROR;
        rec.error = { code: e.code || ERROR_CODES.E_INPUT_MISSING, message: e.message };
        rec.ms = round3(now() - started);
        errors.push(issue(rec.error.code, rec.error.message, `nodes[${indexOfNode(graph, id)}]`));
        stats.failed++;
      }
      await emit(rec);
      continue;
    }

    // ---- @output：透传 ----
    if (node.opId === "@output") {
      const val = portInputs["in"];
      if (!val) {
        // 已被 required 校验拦下；这里兜底不静默
        rec.status = NODE_STATUS.BLOCKED;
        rec.error = { code: ERROR_CODES.E_REQUIRED_PORT_UNCONNECTED, message: "@output 没有接到输入" };
        stats.blocked++;
        await emit(rec);
        continue;
      }
      outputs.set(id, { out: val, files: null });
      rec.status = NODE_STATUS.OK;
      rec.ms = 0;
      rec.preview = previewOf(val, previewLimit);
      rec.preview.outputFormat = String((node.params && node.params.format) || "text");
      stats.executed++;
      await emit(rec);
      continue;
    }

    // ---- 算法节点 ----
    const started = now();
    rec.status = NODE_STATUS.RUNNING;
    let resolved;
    try {
      resolved = resolveNodeParams(node, table, portInputs, opts.registry);
    } catch (e) {
      rec.status = NODE_STATUS.ERROR;
      rec.error = { code: e.code || ERROR_CODES.E_PARAM_PORT_CAST, message: e.message };
      rec.ms = round3(now() - started);
      errors.push(issue(rec.error.code, rec.error.message, id));
      stats.failed++;
      await emit(rec);
      continue;
    }

    // 数据输入：slots 模式字段不拼主输入（字段已进 params.fields）；其余 fields 节点按 fieldsJoin 拼；否则取 in 端口
    let inputValue;
    if (table.hasFields && opFieldsModeSlots(node, opts.registry)) {
      inputValue = textValue("");
    } else if (table.hasFields) {
      const parts = table.inputs
        .filter((p) => p.kind === "field")
        .map((p) => (portInputs[p.name] ? portInputs[p.name].text || "" : String((node.params && node.params[p.fieldKey]) ?? "")));
      inputValue = textValue(parts.join(table.fieldsJoin == null ? "\n" : table.fieldsJoin));
    } else if (portInputs["in"]) {
      inputValue = portInputs["in"];
    } else {
      inputValue = textValue("");
    }
    const input = inputValue.type === "bytes"
      ? { text: inputValue.text != null ? inputValue.text : hexOf(inputValue.bytes), bytes: inputValue.bytes }
      : { text: inputValue.text || "", bytes: null };

    const key = await cacheKeyOf({
      opId: node.opId,
      direction: node.direction,
      params: resolved.params,
      inputs: portInputs,
      hasFiles: table.outputs.some((p) => p.name === "files"),
    });

    const cached = cache.get(key);
    if (cached) {
      outputs.set(id, cached);
      rec.status = NODE_STATUS.OK;
      rec.cached = true;
      rec.ms = 0;
      rec.preview = previewOf(cached.out, previewLimit);
      rec.output = { type: cached.out.type };
      rec.cacheKey = key;
      stats.cacheHits++;
      stats.cached++;
      await emit(rec);
      continue;
    }
    stats.cacheMisses++;

    try {
      rec.attempts++;
      const ctx = {
        input,
        params: resolved.params,
        promoted: resolved.promoted,
        direction: node.direction,
        table,
        node,
        registry: opts.registry,
        engine: ENGINE_VERSION,
      };
      stats.algorithmCalls++;
      const call = Promise.resolve().then(() => runNode(node, ctx));
      const out = timeoutMs > 0 ? await withTimeout(call, timeoutMs, node.opId) : await call;
      const normalized = normalizeResult(out);
      const produced = {
        out: normalized.out,
        files: normalized.files.length ? bytesValue(normalized.files[0].bytes, { files: normalized.files }) : null,
      };
      outputs.set(id, produced);
      cache.set(key, produced);
      rec.status = NODE_STATUS.OK;
      rec.ms = round3(now() - started);
      rec.preview = previewOf(normalized.out, previewLimit);
      if (normalized.files.length) rec.preview.files = normalized.files.map((f) => ({ name: f.name, mime: f.mime, bytes: f.bytes.length }));
      rec.output = { type: normalized.out.type };
      rec.cacheKey = key;
      stats.executed++;
    } catch (e) {
      rec.status = NODE_STATUS.ERROR;
      rec.error = {
        code: e && e.code ? e.code : ERROR_CODES.E_OP_RESULT,
        message: e && e.message ? e.message : String(e),
      };
      rec.ms = round3(now() - started);
      errors.push(issue(rec.error.code, `${node.opId}：${rec.error.message}`, id, { nodeId: id }));
      stats.failed++;
    }
    await emit(rec);

    if (signal && signal.aborted) {
      cancelled = true;
      break;
    }
  } // end for

  // ---- 终值：@output 优先，否则出度为 0 的节点 ----
  // 声明了几个 @output 就按几个来：多个时返回 { 节点id: 值|null }，
  // 失败/被阻断的出口给 null（保留结构，不让 UI 以为这个出口不存在）。
  const outNodes = graph.nodes.filter((n) => n.opId === "@output");
  let terminal = null;
  if (outNodes.length === 1) terminal = outputs.has(outNodes[0].id) ? outputs.get(outNodes[0].id).out : null;
  else if (outNodes.length > 1) {
    terminal = {};
    for (const n of outNodes) terminal[n.id] = outputs.has(n.id) ? outputs.get(n.id).out : null;
  } else {
    const sinks = graph.nodes.filter((n) => (outCount.get(n.id) || 0) === 0 && n.opId !== "@note" && outputs.has(n.id));
    if (sinks.length === 1) terminal = outputs.get(sinks[0].id).out;
    else if (sinks.length > 1) {
      terminal = {};
      for (const n of sinks) terminal[n.id] = outputs.get(n.id).out;
    }
  }

  const ok = !cancelled && stats.failed === 0 && errors.length === 0;
  return {
    ok,
    reason: cancelled ? "cancelled" : stats.failed > 0 ? "partial-failure" : "ok",
    errors,
    warnings,
    order,
    nodes: records,
    outputs,
    terminal,
    cancelled,
    elapsedMs: round3(now() - t0),
    stats,
  };
}

function indexOfNode(graph, id) {
  for (let i = 0; i < graph.nodes.length; i++) if (graph.nodes[i].id === id) return i;
  return -1;
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`节点执行超时：${label} 超过 ${ms} ms（同步算法无法中途打断，已放弃等待）`);
      err.code = ERROR_CODES.E_NODE_TIMEOUT;
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
