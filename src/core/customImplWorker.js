/*
 * customImplWorker.js — MT72 自定义算法执行端（module Worker）。
 *
 * 这里是沙箱的**真防线**：Worker 是独立 realm，天然无 DOM；启动时再把网络/存储/派生线程
 * 这几类能力从本 realm 抹掉，用户代码即使绕过词法遮蔽（constructor 链）也拿不到它们。
 * 零外发红线在此落地——不是"约定不用"，是"这个 realm 里根本没有"。
 *
 * 死循环由主线程 terminate 硬杀（见 customImplClient.js 的看门狗）。
 */
import { runCustomImpl } from "./customImpl.js";

// 先抓住自己要用的引用，再动手抹能力（顺序不能反）。
// 非 Worker 环境（node 扫描脚本 import 本文件时）直接空转，别抛错污染全库扫描。
const inWorker = typeof self !== "undefined" && typeof self.postMessage === "function";
const post = inWorker ? self.postMessage.bind(self) : () => {};

/*
 * 抹除清单。用 defineProperty 在实例上遮蔽原型属性——直接 delete 只删 own property，
 * WorkerGlobalScope.prototype 上的 fetch 之流会照常从原型链取到（这是常见的误判）。
 * postMessage / onmessage 不动（Worker 自身通信要用），它们在用户代码里由词法遮蔽挡住。
 */
const BANNED = [
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts",
  "Request", "Response", "Headers", "FormData", "navigator", "sendBeacon",
  "caches", "indexedDB", "localStorage", "sessionStorage", "cookieStore",
  "Worker", "SharedWorker", "BroadcastChannel", "MessageChannel", "MessagePort",
  "eval", "location",
];

const stripped = [];
const kept = [];
if (inWorker) {
  for (const name of BANNED) {
    try {
      if (!(name in self)) continue;
      Object.defineProperty(self, name, { value: undefined, writable: false, configurable: true, enumerable: false });
      if (self[name] === undefined) stripped.push(name); else kept.push(name);
    } catch {
      kept.push(name); // configurable:false 的抹不掉，如实记账，不假装成功
    }
  }

  self.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === "ping") {
      // 环境自述：主线程据此在 UI 上如实标注沙箱强度（哪些能力没抹掉）
      post({ type: "pong", runId: m.runId, stripped, kept });
      return;
    }
    if (m.type !== "run") return;
    const res = runCustomImpl({
      code: m.code,
      dir: m.dir,
      input: m.input,
      params: m.params || {},
      rawBytes: m.rawBytes || null,
    });
    if (res.ok) {
      post({ type: "final", runId: m.runId, out: res.out });
    } else {
      post({ type: "error", runId: m.runId, message: res.error, line: res.line ?? null, phase: res.phase || null, reason: res.reason || null });
    }
  };
}

export { stripped as strippedGlobals, kept as keptGlobals };
