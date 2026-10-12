/*
 * opRunClient.js — 主线程客户端：把重运算 op 丢进独立线程跑（单例 Worker + 优雅降级）。
 *
 * 职责（与 magicClient 同一调度范式）：
 * - 复用单个 opRunWorker（module Worker，载入完整注册表），主线程零阻塞。
 * - 取消 = terminate 硬杀 + 重建，毫秒级，历史任务立即消失不堆积。
 * - 优雅降级：无 Worker 环境（老浏览器 / file:// 限制）回落主线程同步跑——功能不减，
 *   只是占线程；这是「如实降级」，不是把同步计算包装成假异步。
 * - 超时（可选）：到点 terminate 并 reject("timeout")，调用方可渲染「已超时中止」。
 *
 * 使用方：
 * - 工具页「转换 / 解码」按钮对显式触发白名单 op（explicitRun）改走本通道（带运行卡 + 取消）。
 * - 一键解码爆破独立通道（BRUTE_OPS 逐个 run）：替换原先主线程 bop.run + Promise.race 假超时。
 */
import { getOp } from "./registry.js";

let _worker = null;
let _workerBroken = false;   // 创建/加载失败即永久降级，不反复试错
let _runSeq = 0;             // runId 自增：丢弃 terminate 前漏网的迟到消息
const _pending = new Map();  // runId → { resolve, reject, timer }

function workerSupported() {
  return typeof Worker !== "undefined" && !_workerBroken;
}

function spawnWorker() {
  if (_worker) return _worker;
  try {
    _worker = new Worker(new URL("./opRunWorker.js", import.meta.url), { type: "module" });
  } catch {
    _workerBroken = true;
    _worker = null;
    return null;
  }
  _worker.addEventListener("message", (e) => {
    const m = e.data || {};
    const job = _pending.get(m.runId);
    if (!job) return;                       // 迟到的旧消息（已被取消/接管），弃
    if (m.type === "final") {
      _pending.delete(m.runId);
      if (job.timer) clearTimeout(job.timer);
      job.resolve(m.out);
    } else if (m.type === "error") {
      _pending.delete(m.runId);
      if (job.timer) clearTimeout(job.timer);
      job.reject(new Error(m.message || "op 执行失败"));
    }
  });
  _worker.addEventListener("error", () => {
    // Worker 崩了：全部在途任务按失败收场，下次惰性重建
    for (const [, job] of _pending) {
      if (job.timer) clearTimeout(job.timer);
      job.reject(new Error("运行线程异常中止"));
    }
    _pending.clear();
    _workerBroken = true;
    _worker = null;
  });
  return _worker;
}

function failAll(message) {
  for (const [, job] of _pending) {
    if (job.timer) clearTimeout(job.timer);
    job.reject(new Error(message));
  }
  _pending.clear();
}

/**
 * 在独立线程跑一个 op。
 * @param {string} opId 注册表 op id
 * @param {string} input 主输入文本（run-only op 传 ""）
 * @param {object} [params] op 参数（须可结构化克隆；rawBytes 走 Uint8Array 可克隆）
 * @param {object} [opts] { dir:"run"|"encode"|"decode"（默认按 op.run 优先），
 *                          timeoutMs:number 0=不限时 }
 * @returns {Promise<string|object>} op 返回值（对象产物协议原样透传）；异常 reject
 */
export function runOpOffThread(opId, input, params = {}, opts = {}) {
  const dir = opts.dir || "run";
  const w = workerSupported() ? spawnWorker() : null;
  if (!w) {
    // 降级：无 Worker 环境，主线程同步跑（承诺不变：结果形态与 Worker 一致）
    const op = getOp(opId);
    const fn = op && (op.run || (dir === "encode" ? op.encode : op.decode));
    if (typeof fn !== "function") return Promise.reject(new Error("op 不可执行: " + opId));
    return Promise.resolve().then(() => fn.call(op, input, params));
  }
  return new Promise((resolve, reject) => {
    const runId = ++_runSeq;
    const timer = opts.timeoutMs > 0
      ? setTimeout(() => {
          _pending.delete(runId);
          cancelOpRun();
          reject(new Error("timeout"));
        }, opts.timeoutMs)
      : null;
    _pending.set(runId, { resolve, reject, timer });
    w.postMessage({ type: "run", runId, opId, input, params, dir });
  });
}

/**
 * 取消：硬杀 Worker + 置空（下次惰性重建干净线程）。所有在途任务 reject("cancelled")。
 * 重 op 内部是整块同步循环，无法协作式中断——terminate 是唯一可靠取消手段。
 * @returns {boolean} 是否确有在途任务被取消
 */
export function cancelOpRun() {
  const had = _pending.size > 0;
  failAll("cancelled");
  if (_worker) {
    try { _worker.terminate(); } catch { /* ignore */ }
    _worker = null;
  }
  return had;
}

/** 是否有在途任务（UI 显示「运行中 / 取消」状态用）。 */
export function opRunBusy() {
  return _pending.size > 0;
}
