/*
 * ports.js — 端口推导（T951 候选，无 DOM）。
 *
 * 规则（与 MT809 冻结设计逐条对应；接线的 UI 只读这张表，不许另推一套）：
 *
 * 1) 特殊节点
 *    @input  : 无输入；输出 out。out 的类型由 params.kind 决定——
 *              text → text；hex / base64 / file → bytes（用户在源头显式选定表示法，
 *              不在下游靠内容猜是 hex 还是 UTF-8）。
 *    @const  : 无输入；输出 out，类型规则同上（kind 缺省 text）。
 *    @output : 输入 in（收 text 或 bytes）；无输出。
 *    @note   : 无端口，不参与连线。
 *
 * 2) 算法节点
 *    · in：只有算法真的用主输入时才存在（io:"none" / inferIoMode 推导为 none 时不出现）。
 *          收哪些类型由算法定义决定：acceptsBytes:true → 收 text 与 bytes；
 *          否则只收 text。bytes 交给只收文本的节点 = 连线阶段就报 E_TYPE_MISMATCH，
 *          提示插入显式转换节点（hex/base64→文本 等），不做内容嗅探。
 *    · field:<key>：算法定义里 fields 数组每个字段一个输入端口；有 fields 时不再有 in
 *          （值由各字段按 fieldsJoin 拼成主输入，与算法页同一口径）。
 *    · param:<key>：**任何参数**都可提升为端口（可提升 = promotable，非必接）。
 *          未接线时用节点自身 params[key]，接线后值来自上游；端口只收 text
 *          （参数是标量，hex 密钥/IV 由 keyEnc/ivEnc 这类参数声明解释，不在这里猜）。
 *          定义里 sensitive:true 的参数端口标记 sensitive，UI 据此遮蔽显示。
 *    · files：产物文件端口，仅在算法声明会产生文件（producesFiles / fileOutput）
 *          或接线方传入 hasFiles 提示时出现，类型 bytes。
 *    · out：所有算法输出统一为 text（算法返回字符串或 {text, files}）；
 *          真字节走 files 端口，不把字节塞进 out 再让下游解析。
 *
 * 3) 必填性：in / field:* 默认必填（未接 = E_REQUIRED_PORT_UNCONNECTED）；
 *    param:* 与 files 永远非必填。disabled 节点免检（旁路不读取输入）。
 */

import { ERROR_CODES, throwErr } from "./errors.js";
import { allowedDirectionsOf, defaultDirectionOf, resolveOp, usesMainInput } from "./runtime.js";

export const SPECIAL_OPS = Object.freeze({
  INPUT: "@input",
  OUTPUT: "@output",
  NOTE: "@note",
  CONST: "@const",
});

export const SPECIAL_OP_LIST = Object.freeze([
  SPECIAL_OPS.INPUT,
  SPECIAL_OPS.OUTPUT,
  SPECIAL_OPS.NOTE,
  SPECIAL_OPS.CONST,
]);

const SPECIAL_SET = new Set(SPECIAL_OP_LIST);

export const DATA_TYPES = Object.freeze(["text", "bytes"]);

export const INPUT_KINDS = Object.freeze(["text", "hex", "base64", "file"]);
export const OUTPUT_FORMATS = Object.freeze(["text", "hex", "download"]);

/** kind → 输出数据类型。hex/base64/file 在源头就是字节，text 就是文本。 */
export function dataTypeOfKind(kind) {
  const k = String(kind || "text");
  return k === "text" ? "text" : "bytes";
}

export function isSpecialOp(opId) {
  return SPECIAL_SET.has(String(opId));
}

function port(name, kind, accepts, extra = {}) {
  return {
    name,
    kind,
    accepts: accepts.slice(),
    required: extra.required !== false && (kind === "data" || kind === "field"),
    ...extra,
  };
}

/** 特殊节点端口表。 */
function specialPortTable(opId, params = {}) {
  if (opId === SPECIAL_OPS.INPUT) {
    const kind = String(params.kind || "text");
    return {
      opId,
      special: true,
      name: "@input",
      direction: null,
      directions: [],
      inputs: [],
      outputs: [port("out", "special-out", [dataTypeOfKind(kind)], { required: false, output: true })],
      params: [],
    };
  }
  if (opId === SPECIAL_OPS.CONST) {
    const kind = String(params.kind || "text");
    return {
      opId,
      special: true,
      name: "@const",
      direction: null,
      directions: [],
      inputs: [],
      outputs: [port("out", "special-out", [dataTypeOfKind(kind)], { required: false, output: true })],
      params: [],
    };
  }
  if (opId === SPECIAL_OPS.OUTPUT) {
    return {
      opId,
      special: true,
      name: "@output",
      direction: null,
      directions: [],
      inputs: [port("in", "data", DATA_TYPES, { required: true })],
      outputs: [],
      params: [],
    };
  }
  if (opId === SPECIAL_OPS.NOTE) {
    return {
      opId,
      special: true,
      name: "@note",
      direction: null,
      directions: [],
      inputs: [],
      outputs: [],
      params: [],
    };
  }
  return null;
}

/** 该参数是否被标记为敏感（定义里 sensitive:true）。 */
export function isSensitiveParam(def) {
  return !!(def && def.sensitive === true);
}

/**
 * 本算法是否「会产生文件」。
 * 事实来源只有三处，按优先级：
 *  1) 算法定义自带的声明（producesFiles / fileOutput / outputs 含 files）；
 *  2) 接线方传入的 hasFiles 提示（bool / Set / 判定函数）——用于注册表尚无声明时；
 *  3) 都没有 → 不出现 files 端口（宁可少画，也不凭空长出一个永远接不到的端口）。
 */
export function declaresFiles(op, hasFiles, opId) {
  if (op && (op.producesFiles === true || op.fileOutput === true)) return true;
  if (op && Array.isArray(op.outputs) && op.outputs.includes("files")) return true;
  if (typeof hasFiles === "function") return !!hasFiles(opId || (op && op.id));
  if (hasFiles instanceof Set) return hasFiles.has(opId || (op && op.id));
  if (typeof hasFiles === "boolean") return hasFiles;
  return false;
}

/**
 * 推导端口表。
 * @param {string} opId
 * @param {object} [opts]
 * @param {object} [opts.registry] 注册表（缺省用 runtime.configureRegistry 注入的）
 * @param {object} [opts.params]   节点参数（只影响 @input/@const 的输出类型）
 * @param {string} [opts.direction] 方向（用于 directions 校验；不影响端口集合）
 * @param {boolean|Set|Function} [opts.hasFiles] 产物文件提示
 * @returns {object|null} 端口表；未知 opId 返回 null
 */
export function derivePorts(opId, opts = {}) {
  const id = String(opId || "");
  if (!id) return null;
  if (isSpecialOp(id)) {
    const t = specialPortTable(id, opts.params || {});
    return t ? freezeTable(t) : null;
  }
  const op = resolveOp(id, opts.registry);
  if (!op) return null;
  const directions = allowedDirectionsOf(op);
  const reg = opts.registry;
  const hasFields = Array.isArray(op.fields) && op.fields.length > 0;

  const inputs = [];
  if (!hasFields && usesMainInput(op, reg)) {
    inputs.push(port("in", "data", op.acceptsBytes ? DATA_TYPES : ["text"], { required: true }));
  }
  if (hasFields) {
    for (const f of op.fields) {
      if (!f || typeof f.key !== "string" || !f.key) continue;
      inputs.push(
        port(`field:${f.key}`, "field", ["text"], {
          required: f.required !== false,
          fieldKey: f.key,
          label: f.label || f.key,
        }),
      );
    }
  }
  for (const def of op.params || []) {
    if (!def || typeof def.key !== "string" || !def.key) continue;
    inputs.push(
      port(`param:${def.key}`, "param", ["text"], {
        required: false,
        paramKey: def.key,
        paramType: def.type || "text",
        label: def.label || def.key,
        sensitive: isSensitiveParam(def),
        promotable: true,
        defaultValue: def.default,
        options: def.options ? def.options.map((o) => o.value) : null,
      }),
    );
  }

  const outputs = [
    port("out", "data", ["text"], { required: false, output: true, primary: true }),
  ];
  if (declaresFiles(op, opts.hasFiles, id)) {
    outputs.push(port("files", "files", ["bytes"], { required: false, output: true, dynamic: true }));
  }

  return freezeTable({
    opId: id,
    special: false,
    name: op.name || id,
    acceptsBytes: !!op.acceptsBytes,
    direction: opts.direction || defaultDirectionOf(op),
    directions,
    hasFields,
    fieldsJoin: hasFields ? (op.fieldsJoin == null ? "\n" : String(op.fieldsJoin)) : null,
    inputs,
    outputs,
    params: (op.params || []).map((d) => ({
      key: d.key,
      type: d.type || "text",
      sensitive: isSensitiveParam(d),
      default: d.default,
    })),
    fieldKeys: hasFields ? op.fields.map((f) => f.key) : [],
  });
}

function freezeTable(t) {
  Object.freeze(t.inputs);
  Object.freeze(t.outputs);
  Object.freeze(t.params);
  for (const p of t.inputs) Object.freeze(p.accepts), Object.freeze(p);
  for (const p of t.outputs) Object.freeze(p.accepts), Object.freeze(p);
  return Object.freeze(t);
}

/** 按名字取输入端口。 */
export function inputPortOf(table, name) {
  if (!table) return null;
  for (const p of table.inputs) if (p.name === name) return p;
  return null;
}

/** 按名字取输出端口。 */
export function outputPortOf(table, name) {
  if (!table) return null;
  for (const p of table.outputs) if (p.name === name) return p;
  return null;
}

/** 输出类型是否能接进该输入端口（accepts 是「可接受的类型集合」）。 */
export function canConnect(outType, inPort) {
  if (!inPort) return false;
  return inPort.accepts.includes(outType);
}

/** 端口表缓存（opId + params.kind + hasFiles 维度；只为省重复推导，不影响语义）。 */
const _cache = new Map();

export function derivePortsCached(opId, opts = {}) {
  const id = String(opId || "");
  const kind = isSpecialOp(id) ? String((opts.params && opts.params.kind) || "text") : "";
  const hf = typeof opts.hasFiles === "function" || opts.hasFiles instanceof Set
    ? "fn"
    : String(opts.hasFiles === true);
  const dir = String(opts.direction || "");
  const key = `${id}\u0000${kind}\u0000${hf}\u0000${dir}`;
  if (_cache.has(key)) return _cache.get(key);
  const t = derivePorts(id, opts);
  if (t) _cache.set(key, t);
  return t;
}

/** 清缓存（接线方在注入新注册表/插件增删算法后调用）。 */
export function clearPortCache() {
  _cache.clear();
}

/** 供校验层使用：确保 opId 可解析，否则带人话报错。 */
export function requirePortTable(opId, opts = {}) {
  const t = derivePorts(opId, opts);
  if (!t) {
    throwErr(ERROR_CODES.E_UNKNOWN_OP, `未知算法 id「${opId}」：注册表里没有，也不在特殊节点（@input/@output/@note/@const）之列`);
  }
  return t;
}
