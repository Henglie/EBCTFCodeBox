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
import "./registerAll.js";
import { getOp } from "./registry.js";

self.postMessage({ type: "ready" });

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type !== "run") return;
  const { runId, opId, input, params, dir } = msg;
  const op = getOp(opId);
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
    const out = await fn.call(op, input, params || {});
    try {
      self.postMessage({ type: "final", runId, out });
    } catch {
      // 结构化克隆失败（返回含不可克隆对象）：归一成字符串产物再试一次
      self.postMessage({ type: "final", runId, out: String(out) });
    }
  } catch (err) {
    self.postMessage({ type: "error", runId, message: (err && err.message) || String(err) });
  }
};
