/*
 * core/magic/magicClient.js — 一键解码主线程客户端（真多线程调度 + 优雅降级）
 *
 * 职责（产品裁决：真多线程看门狗 + 中断接管）：
 * - 复用**单个** magicWorker，在独立线程跑 magicDecode，主线程零阻塞（倒计时流畅/UI 不冻）。
 * - **中断接管**：新输入 → cancel() 硬杀旧 Worker + 重建 → 旧任务立即消失，历史不堆积不崩。
 * - **流式部分结果**：解码过程中约 150ms 节流回传 partial，onPartial 先渲染，final 到再补全。
 * - **进度 / 暂停**：onProgress 五阶段（detect/param/plain/keyed/bfs）；pauseMagic/resumeMagic
 *   在 Worker 走 pause/resume 消息、主线程降级走共享 control 对象，yield 点协作挂起。
 * - **优雅降级**：环境无 Worker / 模块 Worker（老浏览器、file:// 限制）→ 回落主线程
 *   magicDecode（已内建 yield + softDeadline + AbortSignal），功能不减只是不占独立线程。
 *
 * 单一实例：模块级单例 Worker，避免每次解码新建（Worker 启动 + 注册表加载有成本）。
 * terminate 后置空，下次 runMagic 惰性重建。
 */
import { magicDecode } from "./magic.js";
import { ensureAll } from "../lazyCore.js"; // 主线程降级跑 OPS 全量面前先补齐惰载

let _worker = null;
let _workerBroken = false;   // 一旦创建/加载失败，标记不可用，永久走主线程降级（不反复试错）
let _runSeq = 0;             // 全局运行序号 → runId，丢弃过期结果
let _activeReject = null;    // 当前在途运行的 reject（cancel 时兑现为「已取消」信号）
let _activeControl = null;   // 主线程降级路径的共享暂停控制对象 {paused:boolean}
let _pauseRequested = false; // 跨 Worker→主线程降级保持暂停意图，避免失败接管后偷偷继续跑

// 能否用模块 Worker：Worker 构造存在即尝试（type:"module" 兼容性由实际 new 时捕获）。
function workerSupported() {
  return typeof Worker !== "undefined" && !_workerBroken;
}

function spawnWorker() {
  if (_worker) return _worker;
  try {
 // import.meta.url 相对定位 magicWorker.js —— 打包器/原生 ESM 均可解析（本项目零构建，原生 ESM）。
    _worker = new Worker(new URL("./magicWorker.js", import.meta.url), { type: "module" });
  } catch {
    _workerBroken = true;
    _worker = null;
  }
  return _worker;
}

/**
 * 取消当前在途解码（新输入接管 / 用户中断）。硬杀 Worker + 重建，历史任务立即消失。
 * 主线程降级路径靠 AbortController（见 runMagic）。
 */
export function cancelMagic() {
  _runSeq++;                              // 作废当前 runId，漏网的旧结果被丢弃
  _pauseRequested = false;
  if (_worker) {
    try { _worker.terminate(); } catch { /* ignore */ }
    _worker = null;                       // 下次惰性重建（干净线程，无残留任务）
  }
  if (_activeControl) _activeControl.paused = false;
  _activeControl = null;
  if (_activeReject) {
    const rej = _activeReject; _activeReject = null;
    rej({ cancelled: true });             // 兑现在途 Promise 为「已取消」（调用方据此不渲染）
  }
}

/**
 * 暂停当前在途解码（协作式）。Worker 路径发 pause 消息，主线程降级路径置共享 control.paused。
 * 在 magicDecode 的下一个 yield 点生效：done 不再推进，已排队候选保留，恢复后从原处继续。
 */
export function pauseMagic() {
  _pauseRequested = true;
  if (_activeControl) _activeControl.paused = true;
  if (_worker) {
    try { _worker.postMessage({ type: "pause", runId: _runSeq }); } catch { /* Worker 已死，忽略 */ }
  }
}

/**
 * 继续当前被暂停的解码。与 pauseMagic 对称；未暂停时调用为无操作。
 */
export function resumeMagic() {
  _pauseRequested = false;
  if (_activeControl) _activeControl.paused = false;
  if (_worker) {
    try { _worker.postMessage({ type: "resume", runId: _runSeq }); } catch { /* Worker 已死，忽略 */ }
  }
}

/**
 * 跑一次智能解码（真多线程优先，降级主线程）。
 *
 * @param {string} input 输入
 * @param {object} opts   magicDecode 选项 + onPartial(cands) 流式部分结果回调 +
 *                        onProgress({phase,done,total,opId,label,percent}) 进度回调
 * @returns {Promise<Array>} 最终候选数组
 * @throws {{cancelled:true}} 被 cancelMagic 取消时 reject（调用方应识别并静默丢弃）
 */
export function runMagic(input, opts = {}) {
  cancelMagic();                          // 开跑前先接管：作废上一轮，保证同时只有一个在途
  const runId = ++_runSeq;
  const onPartial = typeof opts.onPartial === "function" ? opts.onPartial : null;
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;

 // ---- 主线程降级路径（无 Worker）----
  if (!workerSupported()) {
    const ac = new AbortController();
 // 共享 control：pauseMagic/resumeMagic 直接改这个对象，magicDecode 在 yield 点协作等待。
    const control = opts._control && typeof opts._control === "object" ? opts._control : { paused: false };
    control.paused = _pauseRequested;
    _activeControl = control;
    _activeReject = null;
    const p = magicDecode(input, { ...opts, signal: ac.signal, _control: control,
      onPartial: onPartial ? (parts) => { if (runId === _runSeq) onPartial(parts); } : null,
      onProgress: onProgress ? (prog) => { if (runId === _runSeq) onProgress(prog); } : null });
 // 降级下用 runId 变化 + AbortSignal 双保险取消
    const guarded = new Promise((resolve, reject) => {
      _activeReject = (reason) => { ac.abort(); reject(reason); };
      p.then((cands) => {
        if (runId === _runSeq) { _activeControl = null; _activeReject = null; resolve(cands); }
      }, (err) => {
        if (runId === _runSeq) { _activeControl = null; _activeReject = null; reject(err); }
      });
    });
    return guarded;
  }

 // ---- 真多线程路径 ----
  const worker = spawnWorker();
  if (!worker) {
 // 重建失败 → 递归走降级
    return runMagic(input, opts);
  }
  return new Promise((resolve, reject) => {
    _activeReject = reject;
    _activeControl = null;                 // Worker 路径的暂停走 postMessage，不用共享对象
 // 回调函数/AbortSignal/control 不可结构化克隆，postMessage 前剥离；Worker 侧自建 control。
    const strip = (o) => {
      const { onPartial: _p, onProgress: _g, signal: _s, _control: _c, ...rest } = o;
      return rest;
    };
    let settled = false;
    const cleanup = () => {
      worker.removeEventListener("message", handler);
      worker.removeEventListener("error", failover);
      worker.removeEventListener("messageerror", failover);
    };
    const fallback = async () => {
      if (settled) return;
      settled = true;
      cleanup();
      try { await ensureAll(); } catch { /* 尽力而为 */ } // 主线程 magic 需全量 op 面
      const ac = new AbortController();
      const control = opts._control && typeof opts._control === "object" ? opts._control : { paused: false };
      control.paused = _pauseRequested;
      _activeControl = control;
      _activeReject = (reason) => { ac.abort(); reject(reason); };
      magicDecode(input, {
        ...strip(opts),
        signal: ac.signal,
        _control: control,
        onPartial: onPartial ? (parts) => { if (runId === _runSeq) onPartial(parts); } : null,
        onProgress: onProgress ? (prog) => { if (runId === _runSeq) onProgress(prog); } : null,
      }).then(
        (cands) => {
          if (runId === _runSeq) {
            _activeControl = null;
            _activeReject = null;
            resolve(cands);
          }
        },
        (err) => {
          if (runId === _runSeq) {
            _activeControl = null;
            _activeReject = null;
            reject(err);
          }
        },
      );
    };
    const failover = () => {
      _workerBroken = true;
      if (_worker === worker) {
        try { worker.terminate(); } catch { /* ignore */ }
        _worker = null;
      }
      fallback().catch((e) => { if (!settled) return; settled = true; reject(e); });
    };
    const handler = (e) => {
      const m = e.data || {};
      if (m.runId !== runId) return;      // 过期结果（terminate 前漏网）丢弃
      if (m.type === "partial") {
        if (onPartial && runId === _runSeq) onPartial(m.cands);
        return;                            // partial 不结束 Promise，等 final
      }
      if (m.type === "progress") {
        if (onProgress && runId === _runSeq) {
          onProgress({ phase: m.phase, done: m.done, total: m.total,
            opId: m.opId, label: m.label, percent: m.percent });
        }
        return;                            // progress 不结束 Promise
      }
      if (m.type === "final") {
        settled = true;
        cleanup();
        _activeControl = null;
        _activeReject = null;
        resolve(m.cands);
      } else if (m.type === "error") {
        fallback().catch(() => { /* 降级再失败由 reject 链上报 */ });
      }
    };
    worker.addEventListener("message", handler);
    worker.addEventListener("error", failover, { once: true });
    worker.addEventListener("messageerror", failover, { once: true });
    try {
      worker.postMessage({ type: "run", runId, input, opts: strip(opts) });
    } catch {
      failover();
    }
  });
}

export default { runMagic, cancelMagic, pauseMagic, resumeMagic };
