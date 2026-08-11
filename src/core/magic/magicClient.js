/*
 * core/magic/magicClient.js — 一键解码主线程客户端（真多线程调度 + 优雅降级）
 *
 * 职责（恒烈需求：真多线程看门狗 + 中断接管）：
 * - 复用**单个** magicWorker，在独立线程跑 magicDecode，主线程零阻塞（倒计时流畅/UI 不冻）。
 * - **中断接管**：新输入 → cancel() 硬杀旧 Worker + 重建 → 旧任务立即消失，历史不堆积不崩。
 * - **软死线部分结果**：Worker 到软死线回传 partial，onPartial 先渲染，final 到再补全。
 * - **优雅降级**：环境无 Worker / 模块 Worker（老浏览器、file:// 限制）→ 回落主线程
 *   magicDecode（已内建 yield + softDeadline + AbortSignal），功能不减只是不占独立线程。
 *
 * 单一实例：模块级单例 Worker，避免每次解码新建（Worker 启动 + 注册表加载有成本）。
 * terminate 后置空，下次 runMagic 惰性重建。
 */
import { magicDecode } from "./magic.js";

let _worker = null;
let _workerBroken = false;   // 一旦创建/加载失败，标记不可用，永久走主线程降级（不反复试错）
let _runSeq = 0;             // 全局运行序号 → runId，丢弃过期结果
let _activeReject = null;    // 当前在途运行的 reject（cancel 时兑现为「已取消」信号）

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
  if (_worker) {
    try { _worker.terminate(); } catch { /* ignore */ }
    _worker = null;                       // 下次惰性重建（干净线程，无残留任务）
  }
  if (_activeReject) {
    const rej = _activeReject; _activeReject = null;
    rej({ cancelled: true });             // 兑现在途 Promise 为「已取消」（调用方据此不渲染）
  }
}

/**
 * 跑一次智能解码（真多线程优先，降级主线程）。
 *
 * @param {string} input 输入
 * @param {object} opts   magicDecode 选项 + onPartial(cands) 软死线部分结果回调
 * @returns {Promise<Array>} 最终候选数组
 * @throws {{cancelled:true}} 被 cancelMagic 取消时 reject（调用方应识别并静默丢弃）
 */
export function runMagic(input, opts = {}) {
  cancelMagic();                          // 开跑前先接管：作废上一轮，保证同时只有一个在途
  const runId = ++_runSeq;
  const onPartial = typeof opts.onPartial === "function" ? opts.onPartial : null;

 // ---- 主线程降级路径（无 Worker）----
  if (!workerSupported()) {
    const ac = new AbortController();
    _activeReject = null;
    const p = magicDecode(input, { ...opts, signal: ac.signal,
      onPartial: onPartial ? (parts) => { if (runId === _runSeq) onPartial(parts); } : null });
 // 降级下用 runId 变化 + AbortSignal 双保险取消
    const guarded = new Promise((resolve, reject) => {
      _activeReject = (reason) => { ac.abort(); reject(reason); };
      p.then((cands) => { if (runId === _runSeq) resolve(cands); },
             (err) => { if (runId === _runSeq) reject(err); });
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
    const strip = (o) => { const { onPartial: _op, ...rest } = o; return rest; };  // onPartial 是函数，不可结构化克隆，剥离
    let settled = false;
    const cleanup = () => {
      worker.removeEventListener("message", handler);
      worker.removeEventListener("error", failover);
      worker.removeEventListener("messageerror", failover);
    };
    const fallback = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const ac = new AbortController();
      _activeReject = (reason) => { ac.abort(); reject(reason); };
      magicDecode(input, {
        ...strip(opts),
        signal: ac.signal,
        onPartial: onPartial ? (parts) => { if (runId === _runSeq) onPartial(parts); } : null,
      }).then(
        (cands) => {
          if (runId === _runSeq) {
            _activeReject = null;
            resolve(cands);
          }
        },
        (err) => {
          if (runId === _runSeq) {
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
      fallback();
    };
    const handler = (e) => {
      const m = e.data || {};
      if (m.runId !== runId) return;      // 过期结果（terminate 前漏网）丢弃
      if (m.type === "partial") {
        if (onPartial && runId === _runSeq) onPartial(m.cands);
        return;                            // partial 不结束 Promise，等 final
      }
      if (m.type === "final") {
        settled = true;
        cleanup();
        _activeReject = null;
        resolve(m.cands);
      } else if (m.type === "error") {
        fallback();
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

export default { runMagic, cancelMagic };
