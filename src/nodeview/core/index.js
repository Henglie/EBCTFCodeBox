/*
 * index.js — 节点图内核候选的对外入口（T951，无 DOM）。
 *
 * MT810 接线只需：
 *   import * as registry from "./core/registry.js";
 *   import { configureRegistry, emptyGraph, executeGraph, ... } from "./nodeview/core/index.js";
 *   configureRegistry(registry);              // 一次注入（主线程 stub+懒载 / Worker 全量都行）
 *   const r = await executeGraph(graph, { inputs, cache, signal });
 *
 * 本目录不 import 任何 src/core 算法文件，也不碰 DOM；算法只经注册表取得。
 */

export { ERROR_CODES, WARNING_CODES, NodeGraphError, issue, warning, formatIssue } from "./errors.js";
export {
  configureRegistry,
  getRegistry,
  isRegistryConfigured,
  resolveOp,
  defaultsOf,
  defaultDirectionOf,
  allowedDirectionsOf,
  usesMainInput,
} from "./runtime.js";
export {
  SPECIAL_OPS,
  SPECIAL_OP_LIST,
  DATA_TYPES,
  INPUT_KINDS,
  OUTPUT_FORMATS,
  derivePorts,
  derivePortsCached,
  clearPortCache,
  inputPortOf,
  outputPortOf,
  canConnect,
  dataTypeOfKind,
  isSpecialOp,
  isSensitiveParam,
  declaresFiles,
} from "./ports.js";
export {
  GRAPH_SCHEMA_VERSION,
  SHARE_PREFIX,
  emptyGraph,
  createNode,
  createEdge,
  createGraph,
  addNode,
  addEdge,
  removeNode,
  removeEdge,
  connect,
  cloneGraph,
  normalizeGraph,
  validateGraph,
  parseGraph,
  stableStringify,
  exportGraphJSON,
  importGraphJSON,
  findSensitiveValues,
  shareGraph,
  parseShare,
  crc32Hex,
  nextNodeId,
  nextEdgeId,
} from "./graph.js";
export {
  ENGINE_VERSION,
  NODE_STATUS,
  textValue,
  bytesValue,
  hexOf,
  bytesOfHex,
  bytesOfBase64,
  normalizeResult,
  topoOrder,
  hashBytes,
  hashText,
  createMemoryCache,
  resolveNodeParams,
  defaultRunNode,
  executeGraph,
} from "./exec.js";
export {
  recipeToNodeGraph,
  nodeGraphToRecipe,
  roundTripRecipe,
  deepEqual,
} from "./convert.js";
