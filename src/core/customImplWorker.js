/*
 * customImplWorker.js — 自定义算法执行端（module Worker）。
 *
 * 这里是沙箱的**真防线**：Worker 是独立 realm，天然无 DOM；启动时再把网络/存储/派生线程
 * 这几类能力从本 realm 抹掉，用户代码即使绕过词法遮蔽（constructor 链）也拿不到它们。
 * 零外发红线在此落地——不是"约定不用"，是"这个 realm 里根本没有"。
 *
 * 死循环由主线程 terminate 硬杀（见 customImplClient.js 的看门狗）。
 */
import { runCustomImpl, buildHelpers } from "./customImpl.js";
import { setRandConfig, installServerPool, randomBytes as randSourceBytes } from "./randSource.js";

// 先抓住自己要用的引用，再动手抹能力（顺序不能反）。
// 非 Worker 环境（node 扫描脚本 import 本文件时）直接空转，别抛错污染全库扫描。
const inWorker = typeof self !== "undefined" && typeof self.postMessage === "function";
const post = inWorker ? self.postMessage.bind(self) : () => {};

/*
 * 抹除清单。两道遮蔽：① defineProperty 在实例上建自有属性，挡 `self.name` 直取；
 * ② 同名覆盖 WorkerGlobalScope.prototype 上的属性——否则 `Object.getPrototypeOf(self).fetch`
 * 可从原型对象绕过实例遮蔽直取原函数（WebIDL 属性都挂在原型上，这是真实的绕过面）。
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
  const proto = Object.getPrototypeOf(self);
  for (const name of BANNED) {
    if (!(name in self)) continue;
    try {
      Object.defineProperty(self, name, { value: undefined, writable: false, configurable: true, enumerable: false });
    } catch {
      kept.push(name); // configurable:false 的抹不掉，如实记账，不假装成功
      continue;
    }
    try {
      if (proto && name in proto) {
        Object.defineProperty(proto, name, { value: undefined, writable: false, configurable: true });
      }
    } catch { /* 原型覆盖失败：实例遮蔽仍在，校验时会如实进 kept */ }
    if (self[name] === undefined && (!proto || proto[name] === undefined)) stripped.push(name); else kept.push(name);
  }

  self.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === "ping") {
      // 环境自述：主线程据此在 UI 上如实标注沙箱强度（哪些能力没抹掉）
      post({ type: "pong", runId: m.runId, stripped, kept });
      return;
    }
    if (m.type !== "run") return;
    // 增强随机性：主线程把档位配置 + 服务器预取池快照一并送来 → 本 realm 复现同一随机源，
    // 于是 H.randBytes 跟随所选档位，而**沙箱隔离与超时硬杀都不受影响**。
    // randSpec 缺失（system 档）→ 用默认 helpers（本 realm 系统档，与 system 档等价）。
    let helpers = null;
    if (m.randSpec) {
      try {
        setRandConfig({
          mode: m.randSpec.mode,
          seed: m.randSpec.seed,
          mouse: m.randSpec.mouse,
          mouseOn: m.randSpec.mouseOn,
        });
        installServerPool(m.randSpec.serverPool || null);
        helpers = buildHelpers((n) => randSourceBytes(n));
      } catch (e) {
        // 配置失败绝不静默：显式回传错误（不回落系统档）。
        post({ type: "error", runId: m.runId, message: "随机源配置失败：" + ((e && e.message) || String(e)), line: null, phase: "config" });
        return;
      }
    }
    const res = runCustomImpl({
      code: m.code,
      dir: m.dir,
      input: m.input,
      params: m.params || {},
      rawBytes: m.rawBytes || null,
      helpers,
    });
    if (res.ok) {
      post({ type: "final", runId: m.runId, out: res.out });
    } else {
      post({ type: "error", runId: m.runId, message: res.error, line: res.line ?? null, phase: res.phase || null, reason: res.reason || null });
    }
  };
}

export { stripped as strippedGlobals, kept as keptGlobals };
