/*
 * opRunWorker.js — 重运算 op 的独立线程执行端（module Worker）。
 *
 * 与 magicWorker 同一范式：导入完整算法注册表 registerAll，在独立线程跑 op 的
 * run/encode/decode，主线程零阻塞。供 opRunClient 调度，也可单独 new Worker 使用。
 *
 * 协议（主线程 ↔ 本 Worker）：
 *   主 → Worker： { type:"run", runId, opId, input, params, dir }   dir: "run"|"encode"|"decode"
 *   Worker → 主： { type:"final", runId, out }                       op 正常返回（含对象产物协议）
 *                 { type:"error", runId, message }                   op 抛错 / op 不可执行
 *                 { type:"ready" }                                   注册表加载完成握手
 *
 * 取消：主线程 worker.terminate() 硬杀 + 重建（见 opRunClient）。run 型重 op 内部是
 * 整块同步循环，无法协作式中断，terminate 是唯一可靠的取消手段——与 magicWorker 同理。
 *
 * ⚠ Worker 内无 DOM：图像/音频类 op 被调到时会因缺 document/Image 抛错——错误照常
 * 回传主线程展示，不崩线程。本通道只调度显式触发白名单（explicitRun）与爆破池成员，
 * 均为纯计算 op，DOM 类 op 正常走主线程 convert() 旧路径。
 */
import { getOp } from "./registry.js";
import { withLimitContext } from "./limitGuard.js";
import { OP_FILE_MAP } from "./lazyTables.generated.js";

// 惰载：按 opId 只 import 其源文件；映射缺失或加载失败再回退全量 registerAll。
let _fallbackAll = null;
async function loadOp(opId) {
  const op = getOp(opId);
  if (op) return op;
  const file = OP_FILE_MAP[opId];
  if (file) {
    try {
      await import(file);
      const loaded = getOp(opId);
      if (loaded) return loaded;
    } catch { /* 回退全量注册 */ }
  }
  if (!_fallbackAll) {
    _fallbackAll = import("./registerAll.js").catch((err) => { _fallbackAll = null; throw err; });
  }
  await _fallbackAll;
  return getOp(opId);
}

self.postMessage({ type: "ready" });

async function runOne(msg) {
  const { runId, opId, input, params, dir } = msg;
  let op;
  try {
    op = await loadOp(opId);
  } catch (err) {
    self.postMessage({ type: "error", runId, message: (err && err.message) || String(err) });
    return;
  }
  if (!op) {
    self.postMessage({ type: "error", runId, message: "op 未注册: " + opId });
    return;
  }
  const fn = (dir === "encode" ? op.encode : dir === "decode" ? op.decode : null) || op.run;
  if (typeof fn !== "function") {
    self.postMessage({ type: "error", runId, message: "op 不可执行: " + opId });
    return;
  }
  try {
    // 串行执行：单 Worker 上多个异步 op 交错会互相覆盖 __ebctfLimitParams。
    const out = await withLimitContext(params || {}, () => fn.call(op, input, params || {}));
    try {
      self.postMessage({ type: "final", runId, out });
    } catch {
      // 结构化克隆失败（返回含不可克隆对象）：归一成字符串产物再试一次
      self.postMessage({ type: "final", runId, out: String(out) });
    }
  } catch (err) {
    self.postMessage({
      type: "error",
      runId,
      message: (err && err.message) || String(err),
      code: err && err.code ? err.code : undefined,
      meta: err && err.meta ? err.meta : undefined,
    });
  }
}

let _queue = Promise.resolve();
self.onmessage = (e) => {
  const msg = e.data || {};
  if (msg.type !== "run") return;
  // 单飞队列：保证同一时刻只有一个 op 读写资源确认上下文。
  _queue = _queue.then(() => runOne(msg)).catch(() => {});
};
