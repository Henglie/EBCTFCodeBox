/*
 * runtime.js — 算法注册表适配层（T951 候选，无 DOM）。
 *
 * 为什么不直接 import ../../../core/registry.js：
 *  · 候选目录与最终 src/nodeview/ 的层级不同，写死相对路径在两边只能对一边；
 *  · MT810 接线时才决定用 getOp（主线程 stub + 懒载）还是 registerAll（Worker）。
 * 因此由接线方启动时 configureRegistry(registryModule) 一次注入；本模块只依赖
 * 「getOp / defaultParams / inferIoMode」这三个已存在的导出，不复制任何算法。
 *
 * 算法只通过注册表取得：本内核不 import 任何 src/core 算法文件，也不缓存算法实现。
 */

import { ERROR_CODES, throwErr } from "./errors.js";

let _registry = null;

/**
 * 注入算法注册表。可传整个 src/core/registry.js 模块命名空间，
 * 或只传 { getOp, defaultParams, inferIoMode } 的等价对象。
 */
export function configureRegistry(reg) {
  if (!reg || typeof reg.getOp !== "function") {
    throwErr(ERROR_CODES.E_OP_UNRESOLVED, "configureRegistry 需要至少提供 getOp(id) 方法");
  }
  _registry = reg;
  return _registry;
}

export function isRegistryConfigured() {
  return !!_registry;
}

export function getRegistry() {
  if (!_registry) {
    throwErr(
      ERROR_CODES.E_OP_UNRESOLVED,
      "节点图内核尚未注入算法注册表：请先 configureRegistry(await import('.../core/registry.js'))",
    );
  }
  return _registry;
}

/** 取算法定义；未知 id 返回 undefined（由调用方决定报错还是跳过）。 */
export function resolveOp(opId, reg) {
  const r = reg || _registry;
  if (!r || typeof r.getOp !== "function") return undefined;
  return r.getOp(opId);
}

/** 取某算法的默认参数对象（注册表口径；未知参数键不会被伪造）。 */
export function defaultsOf(op, reg) {
  const r = reg || _registry;
  if (!op) return {};
  if (r && typeof r.defaultParams === "function") return r.defaultParams(op);
  const out = {};
  for (const d of op.params || []) out[d.key] = d.default;
  return out;
}

/**
 * 算法的「默认方向」——与 recipe.js 的 nodeDirection / runNode 口径一致：
 * 有 encode 默认走 encode；只有 decode 走 decode；只有 run 走 run。
 * 返回 null 表示该 op 没有可执行入口（不可进图）。
 */
export function defaultDirectionOf(op) {
  if (!op) return null;
  if (typeof op.encode === "function") return "encode";
  if (typeof op.decode === "function") return "decode";
  if (typeof op.run === "function") return "run";
  return null;
}

/** 该算法可用的方向列表（节点 direction 只能取其中之一）。 */
export function allowedDirectionsOf(op) {
  const out = [];
  if (!op) return out;
  if (typeof op.encode === "function") out.push("encode");
  if (typeof op.decode === "function") out.push("decode");
  if (typeof op.run === "function") out.push("run");
  return out;
}

/** 主输入框是否被算法使用（io:none / inferIoMode 推导）。 */
export function usesMainInput(op, reg) {
  if (!op) return false;
  if (op.io === "none") return false;
  if (op.io === "text") return true;
  if (op.acceptsBytes) return true;
  const r = reg || _registry;
  if (r && typeof r.inferIoMode === "function") {
    try {
      return r.inferIoMode(op) !== "none";
    } catch {
      return true; // 推导失败宁可多显示输入端口，绝不静默判无输入
    }
  }
  return true;
}
