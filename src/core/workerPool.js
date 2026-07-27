// workerPool.src.js — Worker 池 + 爆破并行化（T37）
//
// 设计：
// - 主线程 API：bruteParallel(taskGen, options) → Promise<results[]>
// taskGen(i) 返回 { input, key } 或 null（任务耗尽）
// 每个 worker 跑 taskFn(input, key)，返回 result
// - Worker 数 = navigator.hardwareConcurrency（浏览器）或 4（node 降级）
// - Worker 用 inline Blob 创建（纯前端项目无需独立 .js 文件），通过 importScripts
// 加载算法模块（但 node 环境无 importScripts，此处仅做浏览器方案）
//
// 使用场景：
// - XOR 256 key 爆破：分 4 段（0-63/64-127/128-191/192-255），每段一个 worker
// - 凯撒 25 位移：分 4 段
// - 维吉尼亚 key 穷举：按 key 长度分段
// - CRC32 反推：按候选范围分段
// - Magic intensive 模式：按 op 列表分段
//
// 注意：Worker 内无法直接 import ES module（部分浏览器支持 type:module 的 worker
// 但兼容性不佳），本实现用 Blob + importScripts 兜底，算法函数序列化后传入。
//
// 红线：纯前端零外发，Worker 是浏览器内置 API，不引外部库。

const WORKER_SCRIPT = `
self.onmessage = function(e) {
  const { taskId, fnSrc, input, key } = e.data;
  try {
 // 反序列化函数（fnSrc 是函数字符串）
    const fn = new Function('return ' + fnSrc)();
    const result = fn(input, key);
    self.postMessage({ taskId, ok: true, result });
  } catch (err) {
    self.postMessage({ taskId, ok: false, error: err.message });
  }
};
`;

let _workerPool = null;
let _workerUrl = null;

function getWorkerUrl() {
  if (_workerUrl) return _workerUrl;
  const blob = new Blob([WORKER_SCRIPT], { type: "application/javascript" });
  _workerUrl = URL.createObjectURL(blob);
  return _workerUrl;
}

function getPoolSize() {
  if (typeof navigator !== "undefined" && navigator.hardwareConcurrency) {
    return Math.max(1, Math.min(8, navigator.hardwareConcurrency));
  }
  return 4; // 降级
}

// 创建 Worker 池
function createPool(size) {
  const url = getWorkerUrl();
  const workers = [];
  for (let i = 0; i < size; i++) {
    const w = new Worker(url);
    workers.push({ worker: w, busy: false, queue: [] });
  }
  return workers;
}

function getPool() {
  if (!_workerPool) {
    _workerPool = createPool(getPoolSize());
  }
  return _workerPool;
}

// 提交单个任务到池中
function submitTask(fnSrc, input, key) {
  return new Promise((resolve, reject) => {
    const pool = getPool();
 // 找空闲 worker
    const idle = pool.find((w) => !w.busy);
    if (idle) {
      idle.busy = true;
      const taskId = Math.random();
      const handler = (e) => {
        if (e.data.taskId !== taskId) return;
        idle.worker.removeEventListener("message", handler);
        idle.busy = false;
        if (e.data.ok) resolve(e.data.result);
        else reject(new Error(e.data.error));
 // 处理排队任务
        if (idle.queue.length > 0) {
          const next = idle.queue.shift();
          next();
        }
      };
      idle.worker.addEventListener("message", handler);
      idle.worker.postMessage({ taskId, fnSrc, input, key });
    } else {
 // 全忙，排队到第一个 worker
      const target = pool[0];
      target.queue.push(() => {
        target.busy = true;
        const taskId = Math.random();
        const handler = (e) => {
          if (e.data.taskId !== taskId) return;
          target.worker.removeEventListener("message", handler);
          target.busy = false;
          if (e.data.ok) resolve(e.data.result);
          else reject(new Error(e.data.error));
          if (target.queue.length > 0) {
            const next = target.queue.shift();
            next();
          }
        };
        target.worker.addEventListener("message", handler);
        target.worker.postMessage({ taskId, fnSrc, input, key });
      });
    }
  });
}

// ============ bruteParallel：并行爆破 ============
// taskGen(i) → { input, key } | null（i 是任务序号）
// taskFn(input, key) → result（会被序列化传到 worker）
// 返回所有结果数组（顺序不保证，按完成顺序）
async function bruteParallel(taskGen, taskFn, options = {}) {
  const poolSize = options.poolSize || getPoolSize();
  const maxTasks = options.maxTasks || 1000;
  const fnSrc = taskFn.toString();

  const results = [];
  const promises = [];
  let taskIdx = 0;
  let exhausted = false;

 // 提交初始一批任务（每 worker 一个）
  for (let w = 0; w < poolSize; w++) {
    const task = taskGen(taskIdx++);
    if (!task) { exhausted = true; break; }
    promises.push(
      submitTask(fnSrc, task.input, task.key).then((r) => {
        results.push({ key: task.key, result: r });
 // 提交下一个任务
        if (!exhausted) {
          const next = taskGen(taskIdx++);
          if (!next) { exhausted = true; return; }
          return submitTask(fnSrc, next.input, next.key).then((r2) => {
            results.push({ key: next.key, result: r2 });
          });
        }
      })
    );
  }

 // 等所有完成
  await Promise.all(promises);

 // 如果还有任务（动态提交逻辑简化：再跑一轮）
  while (!exhausted && taskIdx < maxTasks) {
    const task = taskGen(taskIdx++);
    if (!task) break;
    const r = await submitTask(fnSrc, task.input, task.key);
    results.push({ key: task.key, result: r });
  }

  return results;
}

// ============ xorBruteParallel：XOR 256 key 并行爆破 ============
// 分段：每 worker 跑一段 key 范围
async function xorBruteParallel(text, options = {}) {
  const te = new TextEncoder();
  const bytes = te.encode(text);
  const printableOnly = options.printableOnly;
  const poolSize = getPoolSize();
  const segmentSize = Math.ceil(256 / poolSize);

  const taskGen = (i) => {
    if (i >= poolSize) return null;
    const start = i * segmentSize;
    const end = Math.min(256, start + segmentSize);
    return { input: bytes, key: { start, end, printableOnly } };
  };

 // 注意：bytes 会被结构化克隆传到 worker
  const taskFn = (bytes, range) => {
    const lines = [];
    for (let k = range.start; k < range.end; k++) {
      const out = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ k;
      let s;
      try { s = new TextDecoder("utf-8", { fatal: false }).decode(out); } catch { s = ""; }
      const printable = s.replace(/[^\x20-\x7e]/g, "");
      if (range.printableOnly && printable.length < s.length * 0.8) continue;
      lines.push(`0x${k.toString(16).padStart(2, "0")} (${k}): ${s}`);
    }
    return lines.join("\n");
  };

  const results = await bruteParallel(taskGen, taskFn, { poolSize });
 // 按 key 排序
  results.sort((a, b) => a.key.start - b.key.start);
  return results.map((r) => r.result).filter(Boolean).join("\n");
}

// ============ caesarBruteParallel：凯撒 25 位移并行爆破 ============
async function caesarBruteParallel(text, options = {}) {
  const poolSize = getPoolSize();
  const segmentSize = Math.ceil(25 / poolSize);

  const taskGen = (i) => {
    if (i >= poolSize) return null;
    const start = i * segmentSize + 1; // 1-25
    const end = Math.min(26, start + segmentSize);
    return { input: text, key: { start, end } };
  };

  const taskFn = (text, range) => {
    const lines = [];
    for (let shift = range.start; shift < range.end; shift++) {
      const out = text.replace(/[a-z]/gi, (c) => {
        const base = c <= "Z" ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base + shift) % 26) + base);
      });
      lines.push(`shift ${shift}: ${out}`);
    }
    return lines.join("\n");
  };

  const results = await bruteParallel(taskGen, taskFn, { poolSize });
  results.sort((a, b) => a.key.start - b.key.start);
  return results.map((r) => r.result).filter(Boolean).join("\n");
}

// ============ 终止 Worker 池（清理资源） ============
function terminatePool() {
  if (_workerPool) {
    for (const { worker } of _workerPool) worker.terminate();
    _workerPool = null;
  }
  if (_workerUrl) {
    URL.revokeObjectURL(_workerUrl);
    _workerUrl = null;
  }
}

export {
  bruteParallel,
  xorBruteParallel,
  caesarBruteParallel,
  submitTask,
  terminatePool,
  getPoolSize,
};
