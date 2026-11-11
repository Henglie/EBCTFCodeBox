/*
 * opRunClient.js — 主线程客户端：把重运算 op 丢进独立线程跑（单例 Worker + 优雅降级）。
 *
 * 职责（与 magicClient 同一调度范式）：
 * - 复用单个 opRunWorker（module Worker，载入完整注册表），主线程零阻塞。
 * - 取消 = terminate 硬杀 + 重建，毫秒级，历史任务立即消失不堆积。
 * - 优雅降级：无 Worker 环境（老浏览器 / file:// 限制）回落主线程同步跑——功能不减，
 *   只是占线程；这是「如实降级」，不是把同步计算包装成假异步。
 * - 超时（可选）：到点只 reject 当前 job("timeout")；是否强制终止 Worker 由用户确认，
 *   确认后调用 forceCancelOpRun() 终止并 fail 所有 pending。
 *
 * 使用方：
 * - 工具页「转换 / 解码」按钮对显式触发白名单 op（explicitRun）改走本通道（带运行卡 + 取消）。
 * - 一键解码爆破独立通道（BRUTE_OPS 逐个 run）：替换原先主线程 bop.run + Promise.race 假超时。
 */
import { getOp } from "./registry.js";
import { LIMIT_CONFIRM_CODE, LIMIT_CANCEL_CODE, withLimitContext } from "./limitGuard.js";

let _worker = null;
let _workerBroken = false;   // 创建/加载失败即永久降级，不反复试错
let _runSeq = 0;             // runId 自增：丢弃 terminate 前漏网的迟到消息
const _pending = new Map();  // runId → { resolve, reject, timer }

function workerSupported() {
  return typeof Worker !== "undefined" && !_workerBroken;
}

function tr(key, fallback, ...args) {
  try {
    const f = globalThis.__ebctfT;
    if (typeof f === "function") {
      const s = f(key, ...args);
      if (typeof s === "string" && s && s !== key) return s;
    }
  } catch { /* i18n 未接线时回退中文 */ }
  return fallback;
}

function limitConfirmText(meta) {
  const fallback = (meta && (meta.message || meta.label)) ||
    "资源用量超过软阈值，继续可能占用大量内存/时间。是否继续？";
  if (!meta || meta.actual === undefined) return fallback;
  return tr("ui.limit.softConfirm", fallback,
    meta.label || meta.scope || "资源", meta.actual, meta.unit || "", meta.soft, meta.hard);
}

function armJobTimer(runId, timeoutMs) {
  if (!(timeoutMs > 0)) return null;
  return setTimeout(() => {
    const job = _pending.get(runId);
    if (!job) return;
    _pending.delete(runId);
    if (job.timer) clearTimeout(job.timer);
    const timeoutErr = new Error("timeout");
    timeoutErr.code = "EBCTF_TIMEOUT";
    job.reject(timeoutErr);
    // 没有其他在途任务时直接回收僵尸 Worker，避免下一任务排在它后面超时。
    if (_pending.size === 0) {
      const w = _worker;
      _worker = null;
      if (w) { try { w.terminate(); } catch { /* ignore */ } }
      return;
    }
    // 还有别的任务：是否连坐终止必须由用户明确确认。
    if (typeof globalThis.confirm === "function") {
      let force = false;
      try { force = !!globalThis.confirm(tr("ui.oprun.timeoutConfirm", "任务超时，是否强制终止 Worker？")); } catch { /* 确认框异常按取消处理 */ }
      if (force) forceCancelOpRun();
    }
  }, timeoutMs);
}

function spawnWorker() {
  if (_worker) return _worker;
  let worker;
  try {
    worker = new Worker(new URL("./opRunWorker.js", import.meta.url), { type: "module" });
    _worker = worker;
  } catch {
    _workerBroken = true;
    _worker = null;
    return null;
  }
  worker.addEventListener("message", (e) => {
    if (_worker !== worker) return;
    const m = e.data || {};
    const job = _pending.get(m.runId);
    if (!job) return;                       // 迟到的旧消息（已被取消/接管），弃
    if (m.type === "final") {
      _pending.delete(m.runId);
      if (job.timer) clearTimeout(job.timer);
      job.resolve(m.out);
    } else if (m.type === "error") {
      const err = new Error(m.message || "op 执行失败");
      if (m.code) err.code = m.code;
      if (m.meta) err.meta = m.meta;
      const canConfirm = m.code === LIMIT_CONFIRM_CODE &&
        !(job.params && job.params._allowLimitOverride);
      if (canConfirm && typeof globalThis.confirm === "function") {
        if (globalThis.confirm(limitConfirmText(m.meta))) {
          job.params = { ...(job.params || {}), _allowLimitOverride: true };
          if (job.timer) clearTimeout(job.timer);
          job.timer = armJobTimer(m.runId, job.timeoutMs);
          try {
            worker.postMessage({ type: "run", runId: m.runId, opId: job.opId, input: job.input, params: job.params, dir: job.dir });
          } catch (postErr) {
            _pending.delete(m.runId);
            if (job.timer) clearTimeout(job.timer);
            job.reject(postErr);
          }
          return;
        }
        _pending.delete(m.runId);
        if (job.timer) clearTimeout(job.timer);
        const cancelErr = new Error("用户取消：资源用量超过软阈值");
        cancelErr.code = LIMIT_CANCEL_CODE;
        cancelErr.cancelled = true;
        job.reject(cancelErr);
        return;
      }
      _pending.delete(m.runId);
      if (job.timer) clearTimeout(job.timer);
      if (m.code === LIMIT_CONFIRM_CODE && job.params && job.params._allowLimitOverride) {
        err.message = "已确认放宽资源阈值，但内部解码器未收到确认参数：" + (m.message || "");
      }
      job.reject(err);
    }
  });
  worker.addEventListener("error", event => {
    // The caller receives an explicit rejected job. Do not also dispatch an
    // uncaught window error, especially for an obsolete worker during reload.
    event.preventDefault();
    if (_worker !== worker) return;
    // Worker 崩了：全部在途任务按失败收场，下次惰性重建
    for (const [, job] of _pending) {
      if (job.timer) clearTimeout(job.timer);
      job.reject(new Error("运行线程异常中止"));
    }
    _pending.clear();
    _workerBroken = true;
    try { worker.terminate(); } catch { /* Already stopped. */ }
    _worker = null;
  });
  return worker;
}

function failAll(message) {
  for (const [, job] of _pending) {
    if (job.timer) clearTimeout(job.timer);
    const err = new Error(message);
    err.code = "EBCTF_CANCELLED";
    err.cancelled = true;
    job.reject(err);
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
    // 降级：无 Worker 环境，主线程同步跑（承诺不变：结果形态与 Worker 一致）。
    // 软阈值错误同样确认后带 _allowLimitOverride 重试一次。
    const op = getOp(opId);
    const fn = op && ((dir === "encode" ? op.encode : dir === "decode" ? op.decode : null) || op.run);
    if (typeof fn !== "function") return Promise.reject(new Error("op 不可执行: " + opId));
    const invoke = (p) => withLimitContext(p, () => fn.call(op, input, p));
    return invoke(params).catch((err) => {
      if (err && err.code === LIMIT_CONFIRM_CODE &&
          !(params && params._allowLimitOverride) &&
          typeof globalThis.confirm === "function") {
        if (globalThis.confirm(limitConfirmText(err.meta))) {
          return invoke({ ...(params || {}), _allowLimitOverride: true });
        }
        const cancelErr = new Error("用户取消：资源用量超过软阈值");
        cancelErr.code = LIMIT_CANCEL_CODE;
        cancelErr.cancelled = true;
        throw cancelErr;
      }
      throw err;
    });
  }
  return new Promise((resolve, reject) => {
    const runId = ++_runSeq;
    const job = { resolve, reject, timer: null, opId, input, params, dir, timeoutMs: opts.timeoutMs };
    job.timer = armJobTimer(runId, opts.timeoutMs);
    _pending.set(runId, job);
    try {
      w.postMessage({ type: "run", runId, opId, input, params, dir });
    } catch (err) {
      _pending.delete(runId);
      if (job.timer) clearTimeout(job.timer);
      reject(err);
    }
  });
}

/**
 * 强制终止：硬杀 Worker + 置空（下次惰性重建干净线程）。所有在途任务 reject("cancelled")。
 * 超时确认框选「确定」时由内部调用；UI 也可直接调用。
 * @returns {boolean} 是否确有在途任务被取消
 */
export function forceCancelOpRun() {
  const had = _pending.size > 0;
  failAll("cancelled");
  if (_worker) {
    try { _worker.terminate(); } catch { /* ignore */ }
    _worker = null;
  }
  return had;
}

/**
 * 取消：硬杀 Worker + 置空（下次惰性重建干净线程）。所有在途任务 reject("cancelled")。
 * 重 op 内部是整块同步循环，无法协作式中断——terminate 是唯一可靠取消手段。
 * @returns {boolean} 是否确有在途任务被取消
 */
export function cancelOpRun() {
  return forceCancelOpRun();
}

/** 是否有在途任务（UI 显示「运行中 / 取消」状态用）。 */
export function opRunBusy() {
  return _pending.size > 0;
}
