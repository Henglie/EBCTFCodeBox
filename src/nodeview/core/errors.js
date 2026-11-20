/*
 * errors.js — 节点图内核错误码与错误对象（T951 候选，无 DOM）。
 *
 * 契约：任何拒绝都必须带「机器可读错误码 + 人话信息 + 定位路径」，
 * 不许只抛字符串，也不许吞掉（调用方永远能在 result.errors / thrown.code 里拿到）。
 *
 * 定位路径写法：nodes[2].params.key / edges[4].to.port / viewport.k
 */

export const ERROR_CODES = Object.freeze({
  // ---- 结构（图格式 v1）----
  E_GRAPH_TYPE: "E_GRAPH_TYPE",
  E_SCHEMA_VERSION: "E_SCHEMA_VERSION",
  E_UNKNOWN_FIELD: "E_UNKNOWN_FIELD",
  E_MISSING_FIELD: "E_MISSING_FIELD",
  E_INVALID_FIELD: "E_INVALID_FIELD",
  // ---- 标识 ----
  E_DUP_NODE_ID: "E_DUP_NODE_ID",
  E_DUP_EDGE_ID: "E_DUP_EDGE_ID",
  E_DUP_GROUP_ID: "E_DUP_GROUP_ID",
  // ---- 算法与端口 ----
  E_UNKNOWN_OP: "E_UNKNOWN_OP",
  E_UNKNOWN_PORT: "E_UNKNOWN_PORT",
  E_INVALID_DIRECTION: "E_INVALID_DIRECTION",
  E_SPECIAL_PARAM: "E_SPECIAL_PARAM",
  // ---- 连线 ----
  E_DANGLING_EDGE: "E_DANGLING_EDGE",
  E_DUP_EDGE: "E_DUP_EDGE",
  E_PORT_OCCUPIED: "E_PORT_OCCUPIED",
  E_TYPE_MISMATCH: "E_TYPE_MISMATCH",
  E_REQUIRED_PORT_UNCONNECTED: "E_REQUIRED_PORT_UNCONNECTED",
  E_SELF_LOOP: "E_SELF_LOOP",
  E_CYCLE: "E_CYCLE",
  // ---- 执行 ----
  E_INPUT_MISSING: "E_INPUT_MISSING",
  E_PARAM_PORT_CAST: "E_PARAM_PORT_CAST",
  E_NODE_TIMEOUT: "E_NODE_TIMEOUT",
  E_OP_RESULT: "E_OP_RESULT",
  E_OP_UNRESOLVED: "E_OP_UNRESOLVED",
  E_NOT_RUNNABLE: "E_NOT_RUNNABLE",
  // ---- 互转 ----
  E_NOT_CONVERTIBLE: "E_NOT_CONVERTIBLE",
  // ---- 分享串 ----
  E_SHARE_FORMAT: "E_SHARE_FORMAT",
  E_SHARE_CHECKSUM: "E_SHARE_CHECKSUM",
});

/** 警告码：不阻断，但必须回报（绝不静默）。 */
export const WARNING_CODES = Object.freeze({
  W_UNKNOWN_PARAM: "W_UNKNOWN_PARAM",
  W_EDGE_ID_GENERATED: "W_EDGE_ID_GENERATED",
  W_SENSITIVE_STRIPPED: "W_SENSITIVE_STRIPPED",
  W_BYPASS_MULTI_INPUT: "W_BYPASS_MULTI_INPUT",
  W_PARAM_PORT_OVER_DEFAULT: "W_PARAM_PORT_OVER_DEFAULT",
});

export class NodeGraphError extends Error {
  /**
   * @param {string} code ERROR_CODES 之一
   * @param {string} message 人话信息（中文，含具体节点/端口/值）
   * @param {{path?:string, detail?:object}} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "NodeGraphError";
    this.code = code;
    this.path = extra.path || "";
    this.detail = extra.detail || null;
  }
}

/** 造一个错误对象（不 throw，便于收集多条错误后统一返回）。 */
export function issue(code, message, path = "", detail = null) {
  return { code, message, path, detail: detail || null };
}

/** 造一个警告对象。 */
export function warning(code, message, path = "", detail = null) {
  return { code, message, path, detail: detail || null, severity: "warning" };
}

export function throwErr(code, message, path = "", detail = null) {
  throw new NodeGraphError(code, message, { path, detail });
}

/** 统一把任意异常转成 {code,message}——保留原始 code 与 message，不吞。 */
export function asIssue(err, fallbackCode = ERROR_CODES.E_INVALID_FIELD) {
  if (!err) return issue(fallbackCode, "未知错误");
  if (typeof err === "string") return issue(fallbackCode, err);
  return issue(err.code || fallbackCode, err.message || String(err), err.path || "");
}

export function formatIssue(it) {
  const p = it && it.path ? ` @${it.path}` : "";
  return `[${(it && it.code) || "?"}] ${(it && it.message) || ""}${p}`;
}
