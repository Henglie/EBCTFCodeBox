/*
 * customImplClient.js — MT72 自定义算法主线程调度端（照 magicClient 的三层防护模式）。
 *
 * 执行策略（红线：沙箱 + 超时，防死循环冻页面）：
 *  1. Worker 优先：module Worker 独立 realm 跑用户代码（realm 内已抹掉网络/存储能力），主线程零阻塞；
 *  2. 超时硬杀：CUSTOM_TIMEOUT_MS 到点 terminate 该 Worker，页面不冻（下次调用惰性重建干净实例）；
 *  3. 降级主线程：环境无 Worker / 模块 Worker 不可用（老浏览器、file:// 限制、CSP）→ 主线程同步执行。
 *     ⚠ 降级路径只有词法遮蔽，没有 realm 隔离，也无法硬杀死循环。返回值里带 sandbox:"main"，
 *       调用方（编辑器状态条）必须如实告诉用户，别让人以为一直在沙箱里。
 */
import { runCustomImpl } from "./customImpl.js";

let _worker = null;
let _workerBroken = false;   // 创建/加载失败后永久走主线程降级，不反复试错
let _seq = 0;
const _pending = new Map();  // runId → settle 回调（Worker 被杀时统一收尾，不留悬挂 Promise）

/** 死循环看门狗时长。2s（与 compress.js TIMEOUT_MS 同量级；MT72 需求写「700ms 级」是下限参考）。 */
export const CUSTOM_TIMEOUT_MS = 2000;

function spawnWorker() {
  if (_worker || _workerBroken) return _worker;
  if (typeof Worker === "undefined") { _workerBroken = true; return null; }
  try {
    _worker = new Worker(new URL("./customImplWorker.js", import.meta.url), { type: "module" });
    _worker.addEventListener("message", (e) => {
      const m = e.data || {};
      const p = _pending.get(m.runId);
      if (!p) return;
      if (m.type === "final") { _pending.delete(m.runId); p({ ok: true, out: m.out, sandbox: "worker" }); }
      else if (m.type === "error") {
        _pending.delete(m.runId);
        p({ ok: false, error: m.message, line: m.line ?? null, phase: m.phase || null, reason: m.reason || null, sandbox: "worker" });
      }
    });
    _worker.addEventListener("error", () => {
      // Worker 自身加载/运行异常（非用户代码抛错——那走 message）：标记不可用并把 pending 全部降级重跑
      _workerBroken = true;
      const waiting = [..._pending.values()];
      _pending.clear();
      killWorker();
      for (const p of waiting) p(null); // null = 请调用方走主线程重试
    });
  } catch {
    _workerBroken = true;
    _worker = null;
  }
  return _worker;
}

function killWorker() {
  if (_worker) {
    try { _worker.terminate(); } catch { /* ignore */ }
    _worker = null;
  }
}

/** 主线程直跑（降级路径 / Worker 不可用时）。 */
function runOnMainThread(req) {
  const res = runCustomImpl(req);
  return res.ok
    ? { ok: true, out: res.out, sandbox: "main" }
    : { ok: false, error: res.error, line: res.line ?? null, phase: res.phase || null, reason: res.reason || null, sandbox: "main" };
}

/**
 * 执行用户自定义实现，带超时看门狗。
 * @param {{code:string, dir:string, input:string, params:object, rawBytes:?Uint8Array, timeoutMs:?number}} req
 * @returns {Promise<{ok:true,out:string,sandbox:string}|{ok:false,error:string,line:?number,timedOut?:boolean,sandbox:string}>}
 */
export function runCustomWithTimeout(req) {
  const { code, dir, input, params, rawBytes } = req;
  const timeoutMs = Number(req.timeoutMs) > 0 ? Number(req.timeoutMs) : CUSTOM_TIMEOUT_MS;
  const plain = { code, dir, input, params: params || {}, rawBytes: rawBytes || null };

  const worker = spawnWorker();
  if (!worker) return Promise.resolve(runOnMainThread(plain));

  return new Promise((resolve) => {
    const runId = ++_seq;
    let settled = false;
    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      _pending.delete(runId);
      // res === null 表示 Worker 挂了，请求还没跑完 → 主线程补跑一次（真降级，不是只报错）
      resolve(res === null ? runOnMainThread(plain) : res);
    };
    const timer = setTimeout(() => {
      killWorker();                        // 硬杀：连同死循环一起清掉
      for (const [id, p] of _pending) { if (id !== runId) p(null); }
      _pending.clear();
      finish({
        ok: false,
        error: `执行超时（>${timeoutMs}ms，疑似死循环），已强制终止`,
        timedOut: true,
        sandbox: "worker",
      });
    }, timeoutMs);
    _pending.set(runId, finish);
    try {
      // Uint8Array 走结构化克隆，Worker 端拿到仍是 Uint8Array
      worker.postMessage({ type: "run", runId, ...plain });
    } catch {
      finish(runOnMainThread(plain));      // 消息发不出去（不可克隆的 params 等）→ 主线程兜底
    }
  });
}

/**
 * 探测当前沙箱形态，供 UI 如实展示。
 * @returns {Promise<{mode:"worker"|"main", stripped:string[], kept:string[]}>}
 */
export function probeSandbox(timeoutMs = 1500) {
  const worker = spawnWorker();
  if (!worker) return Promise.resolve({ mode: "main", stripped: [], kept: [] });
  return new Promise((resolve) => {
    const runId = ++_seq;
    const done = (v) => { clearTimeout(timer); _pending.delete(runId); resolve(v); };
    const timer = setTimeout(() => done({ mode: "main", stripped: [], kept: [] }), timeoutMs);
    _pending.set(runId, (res) => done(res === null ? { mode: "main", stripped: [], kept: [] } : res));
    const onMsg = (e) => {
      const m = e.data || {};
      if (m.type !== "pong" || m.runId !== runId) return;
      worker.removeEventListener("message", onMsg);
      done({ mode: "worker", stripped: m.stripped || [], kept: m.kept || [] });
    };
    worker.addEventListener("message", onMsg);
    try { worker.postMessage({ type: "ping", runId }); } catch { done({ mode: "main", stripped: [], kept: [] }); }
  });
}

export default { runCustomWithTimeout, probeSandbox, CUSTOM_TIMEOUT_MS };
