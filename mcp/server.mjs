// ebctf stdio MCP server -- 让桌面 MCP 客户端（Claude Desktop / Cline 等）接入工具箱。
// 讲 JSON-RPC over stdio，转发到 core 的 callMcpTool。本地进程，零外发、无网络出口。
// 零外部依赖：裸 stdio 手写 JSON-RPC。装了官方 @modelcontextprotocol/sdk 可换更稳的实现。
//
// 用法（桌面客户端配置）：
//   { "mcpServers": { "ebctf-codebox": { "command": "node", "args": ["<项目路径>/mcp/server.mjs"] } } }
// 需要 JS 执行类 op（jsfuck/jjencode）时在 args 里追加 "--unsafe"（仅本进程生效）。
// 调用总超时默认 30s，可加 "--timeout 60000" 或设 EBCTF_MCP_CALL_TIMEOUT_MS。
// 自测：
//   echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp/server.mjs
//
// ⚠ MCP stdio 协议要求 stdout 只承载 JSON-RPC 消息。core 加载期的诊断输出已统一走
//   src/core/debugLog.js（默认静默；设 EBCTF_DEBUG=1 输出到 stderr），stdout 全程干净，
//   这里不再需要劫持 process.stdout.write。
import { createInterface } from "node:readline";
import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  resolveCallTimeoutMs,
  makeTimeoutError,
  makeCancelledError,
  withCallDeadline,
  timeoutToolResult,
} from "../src/plugin/mcpBridge.js";
import { getOp } from "../src/core/registry.js";
import { isExplicitRunOp } from "../src/core/explicitRun.js";

const ARGV = process.argv.slice(2);

// 命令行 --unsafe：仅本进程恢复 JS 执行类 op（等价宿主 EBCTF_MCP_UNSAFE=1）。
// 桌面客户端可在 mcpServers args 里追加 "--unsafe"；请求参数 allowUnsafe 仍一律忽略。
if (ARGV.includes("--unsafe")) process.env.EBCTF_MCP_UNSAFE = "1";

function argValue(argv, name) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === name) return argv[i + 1];
    if (a.startsWith(name + "=")) return a.slice(name.length + 1);
  }
  return undefined;
}

const ARG_TIMEOUT = argValue(ARGV, "--timeout");
const CALL_TIMEOUT_MS = resolveCallTimeoutMs(ARG_TIMEOUT);
const WORKER_DISABLED = process.env.EBCTF_MCP_WORKER === "0";

const adapterUrl = new URL("./ebctf-core-adapter.mjs", import.meta.url);
const { callMcpTool, MCP_TOOLS, listMcpResources, readMcpResourceContents } = await import(adapterUrl.href);
const { APP_VERSION } = await import("../src/core/version.js");
const realStdoutWrite = process.stdout.write.bind(process.stdout);

// Node 运行时安全提示（stdout 只能走 JSON-RPC，提示一律 stderr）。
// 2026-07 安全版：26.5.1 / 24.18.1 / 22.23.2 起修复权限模型越权、HTTP/2 UAF 等。
function nodeSecurityNotice() {
  const [maj, min, pat] = process.versions.node.split(".").map(Number);
  const vulnerable =
    (maj === 26 && (min < 5 || (min === 5 && pat < 1))) ||
    (maj === 24 && (min < 18 || (min === 18 && pat < 1))) ||
    (maj === 22 && (min < 23 || (min === 23 && pat < 2)));
  if (!vulnerable) return;
  console.error(
    `[ebctf] 安全提示：当前 Node.js ${process.versions.node} 命中 2026-07 安全公告` +
    "（CVE-2026-58043 / CVE-2026-58044 / CVE-2026-56848）。MCP 只走 stdio，不触发 HTTP/2 漏洞，但仍建议升级到 " +
    "Node ≥ 26.5.1（或 24.18.1 / 22.23.2）。"
  );
}

// 支持的 MCP 协议版本（本实现只用基础 tools/resources 面，这三版兼容；协商见 initialize）。
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

// 输出单行上限（JSON-RPC 消息序列化后）。mcpBridge 已把单个工具结果压到
// 256KB 以内；这里再兜底一次，避免任何路径产生 40 万字符单行。
const MAX_OUTPUT_LINE_CHARS = 512 * 1024;

// 工具级固定隔离：detect 扫全表、magic_decode 多轮链式尝试，无法按单一 op 判定。
const WORKER_TOOL_NAMES = new Set(["ebctf_detect", "ebctf_magic_decode"]);

// op 级自动判定 + 显式补充：
// - 核心已声明的 EXPLICIT_RUN_OPS（重运算白名单）与 noAuto / heavy / worker / cost 标记自动继承；
// - 文件向、分析/爆破类等能力按 op 分类与输入体量自动判定，新增重 op 不必改这里；
// - WORKER_OP_EXPLICIT 只补核心尚未标注、但 MCP 侧必须隔离的 op。
const WORKER_OP_EXPLICIT = new Set([
  "extractAll",     // 全量提取会遍历多种容器
  "foremostCarve",  // 文件雕刻
]);
const WORKER_HEAVY_CATS = new Set([
  "analysis", "crypto", "crack", "archive", "forensic", "filefmt",
  "image", "audio", "stego", "stegoFile", "data",
]);
// 输入体量达到该阈值即隔离：即使轻量 op 处理大文件也可能长时间占住主线程。
const WORKER_INPUT_WEIGHT = 64 * 1024;

function inputWeight(args) {
  let weight = 0;
  if (args && typeof args.input === "string") weight += args.input.length;
  if (args && typeof args.fileBase64 === "string") weight += Math.floor(args.fileBase64.length * 0.75);
  return weight;
}

function shouldUseWorker(name, args) {
  if (WORKER_TOOL_NAMES.has(name)) return true;
  if (name !== "ebctf_run_op") return false;
  const op = getOp(args && args.opId);
  if (!op) return false; // 参数错误在主线程快速返回，不付 worker 启动成本
  if (WORKER_OP_EXPLICIT.has(op.id)) return true;
  if (isExplicitRunOp(op.id)) return true;
  if (op.noAuto === true || op.heavy === true || op.worker === true ||
      op.cost === "heavy" || op.cost === "high") return true;
  // 外部 exe/本地桥也隔离到 worker（worker 内仍可用 fetch/process），与旧行为一致。
  if (op.requiresBridge) return true;
  if (inputWeight(args) >= WORKER_INPUT_WEIGHT) return true;
  return WORKER_HEAVY_CATS.has(op.cat) && (op.acceptsBytes || typeof op.run === "function");
}

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
function post(msg) {
  try {
    parentPort.postMessage(msg);
  } catch (e) {
    try {
      parentPort.postMessage({
        type: "error", jobId: msg && msg.jobId,
        message: "worker 结果无法序列化：" + (e && e.message ? e.message : String(e)),
        code: "EBCTF_MCP_SERIALIZE",
      });
    } catch { /* ignore */ }
  }
}
(async () => {
  let mod;
  try {
    mod = await import(workerData.adapterUrl);
  } catch (e) {
    post({ type: "fatal", message: e && e.message ? e.message : String(e) });
    return;
  }
  parentPort.on("message", (msg) => {
    if (!msg || msg.type !== "call") return;
    let out;
    try {
      // 外层 job timer 负责 deadline，worker 内不再重复计时；超时由主线程 terminate。
      out = mod.callMcpTool(msg.name, msg.args, { deadline: false });
    } catch (e) {
      post({
        type: "error", jobId: msg.jobId,
        message: e && e.message ? e.message : String(e),
        code: e && typeof e.code === "string" ? e.code : undefined,
        meta: e && e.meta !== undefined ? e.meta : undefined,
        cancelled: !!(e && e.cancelled),
      });
      return;
    }
    Promise.resolve(out).then(
      (result) => post({ type: "result", jobId: msg.jobId, result }),
      (e) => post({
        type: "error", jobId: msg.jobId,
        message: e && e.message ? e.message : String(e),
        code: e && typeof e.code === "string" ? e.code : undefined,
        meta: e && e.meta !== undefined ? e.meta : undefined,
        cancelled: !!(e && e.cancelled),
      })
    );
  });
  post({ type: "ready" });
})();
`;

function workerError(message, code = "EBCTF_MCP_WORKER_ERROR") {
  const err = new Error(message);
  err.code = code;
  err.retryable = true;
  return err;
}

/**
 * 单 worker 串行执行器。超时/取消直接 terminate（同步 CPU op 唯一可靠的硬中断），
 * 下一个排队任务会惰性重建 worker；排队中的任务超时只出队，不影响当前执行。
 */
export function createWorkerToolRunner({
  adapter = adapterUrl.href,
  warn = (message) => process.stderr.write(message + "\n"),
} = {}) {
  let worker = null;
  let ready = false;
  let broken = false;
  let closed = false;
  let current = null;
  let seq = 0;
  const queue = [];

  function cleanupJob(job) {
    if (job.timer !== null) {
      clearTimeout(job.timer);
      job.timer = null;
    }
    if (job.signal && job.onAbort) {
      job.signal.removeEventListener("abort", job.onAbort);
      job.onAbort = null;
    }
  }

  function settle(job, fn, value) {
    if (job.settled) return;
    job.settled = true;
    cleanupJob(job);
    fn(value);
  }

  function killWorker() {
    const w = worker;
    worker = null;
    ready = false;
    if (!w) return;
    try { if (w.stdout) { w.stdout.removeAllListeners(); w.stdout.destroy(); } } catch { /* ignore */ }
    try { if (w.stderr) { w.stderr.removeAllListeners(); w.stderr.destroy(); } } catch { /* ignore */ }
    try { w.removeAllListeners(); } catch { /* ignore */ }
    try { w.terminate(); } catch { /* ignore */ }
  }

  function failAll(err) {
    for (const job of queue.splice(0)) settle(job, job.reject, err);
    if (current) {
      const job = current;
      current = null;
      settle(job, job.reject, err);
    }
  }

  function ensureWorker() {
    if (worker) return worker;
    if (broken || closed) return null;
    let w;
    try {
      w = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: { adapterUrl: adapter },
        stdout: true,
        stderr: true,
      });
    } catch (e) {
      broken = true;
      warn(`[ebctf] MCP worker 启动失败：${e && e.message ? e.message : e}`);
      return null;
    }
    worker = w;
    ready = false;
    try { if (w.stdout) w.stdout.resume(); } catch { /* ignore */ }
    if (w.stderr) w.stderr.on("data", (chunk) => {
      try { process.stderr.write(chunk); } catch { /* ignore */ }
    });
    w.on("message", (msg) => onWorkerMessage(w, msg));
    w.on("error", (e) => onWorkerFailure(w, e));
    w.on("exit", (code) => onWorkerExit(w, code));
    return w;
  }

  function dispatch(job) {
    try {
      worker.postMessage({ type: "call", jobId: job.id, name: job.name, args: job.args });
    } catch (e) {
      current = null;
      settle(job, job.reject, workerError(`MCP worker 投递失败：${e && e.message ? e.message : e}`));
      pump();
    }
  }

  function pump() {
    if (closed || broken || current) return;
    while (queue.length && queue[0].settled) queue.shift();
    if (!queue.length) return;
    if (!ensureWorker()) {
      const err = workerError("MCP worker 不可用（无法启动隔离线程）", "EBCTF_MCP_WORKER_UNAVAILABLE");
      broken = true;
      failAll(err);
      return;
    }
    current = queue.shift();
    if (ready) dispatch(current);
  }

  function onWorkerMessage(w, msg) {
    if (w !== worker || !msg || typeof msg !== "object") return;
    if (msg.type === "ready") {
      ready = true;
      if (current) dispatch(current);
      return;
    }
    if (msg.type === "result" || msg.type === "error") {
      const job = current;
      if (!job || job.id !== msg.jobId) return;
      current = null;
      if (msg.type === "result") {
        settle(job, job.resolve, msg.result);
      } else {
        const err = new Error(msg.message || "MCP worker 调用失败");
        if (msg.code) err.code = msg.code;
        if (msg.meta !== undefined) err.meta = msg.meta;
        if (msg.cancelled) err.cancelled = true;
        settle(job, job.reject, err);
      }
      pump();
      return;
    }
    if (msg.type === "fatal") {
      broken = true;
      killWorker();
      failAll(workerError(`MCP worker 初始化失败：${msg.message || "unknown"}`));
    }
  }

  function onWorkerFailure(w, e) {
    if (w !== worker) return;
    const job = current;
    current = null;
    killWorker();
    if (job) settle(job, job.reject, workerError(`MCP worker 异常：${e && e.message ? e.message : e}`));
    pump();
  }

  function onWorkerExit(w, code) {
    if (w !== worker) return;
    const job = current;
    current = null;
    killWorker();
    if (job) settle(job, job.reject, workerError(`MCP worker 提前退出（code=${code}）`));
    pump();
  }

  function onJobTimeout(job, timeoutMs) {
    if (job.settled) return;
    if (current === job) {
      current = null;
      settle(job, job.reject, makeTimeoutError(timeoutMs, job.name));
      killWorker();
      pump();
      return;
    }
    const idx = queue.indexOf(job);
    if (idx >= 0) queue.splice(idx, 1);
    settle(job, job.reject, makeTimeoutError(timeoutMs, job.name));
  }

  function onJobAbort(job) {
    if (job.settled) return;
    if (current === job) {
      current = null;
      settle(job, job.reject, makeCancelledError(job.name));
      killWorker();
      pump();
      return;
    }
    const idx = queue.indexOf(job);
    if (idx >= 0) queue.splice(idx, 1);
    settle(job, job.reject, makeCancelledError(job.name));
  }

  function run(name, args, opts = {}) {
    const timeoutMs = resolveCallTimeoutMs(opts.timeoutMs);
    const signal = opts.signal;
    return new Promise((resolve, reject) => {
      if (closed) return reject(makeCancelledError(name, "MCP server 已关闭"));
      if (signal && signal.aborted) return reject(makeCancelledError(name));
      const job = {
        id: ++seq, name, args, resolve, reject, timeoutMs,
        timer: null, signal, onAbort: null, settled: false,
      };
      if (timeoutMs > 0) {
        job.timer = setTimeout(() => onJobTimeout(job, timeoutMs), timeoutMs);
      }
      if (signal) {
        job.onAbort = () => onJobAbort(job);
        signal.addEventListener("abort", job.onAbort, { once: true });
      }
      queue.push(job);
      pump();
    });
  }

  function close() {
    if (closed) return;
    closed = true;
    failAll(makeCancelledError(null, "MCP server 已关闭"));
    killWorker();
  }

  return { run, close };
}

function tooLargePayload(actualChars) {
  return JSON.stringify({
    code: "EBCTF_MCP_RESULT_TOO_LARGE",
    message:
      `MCP 响应序列化后 ${actualChars} 字符，超过单行上限 ${MAX_OUTPUT_LINE_CHARS}。` +
      "结果未内联；请使用 outputDir 落盘后读取路径，或缩小输入。",
    retryable: true,
    meta: { limitChars: MAX_OUTPUT_LINE_CHARS, actualChars, outputDirRequired: true },
  });
}

function structuredRpcError(e) {
  const code = e && typeof e.code === "string" && e.code ? e.code : "EBCTF_MCP_ERROR";
  const cancelled = !!(e && (e.cancelled === true || code === "EBCTF_LIMIT_CANCEL"));
  const retryable = !!(e && e.retryable === true) ||
    code === "EBCTF_LIMIT_CONFIRM" || code === "EBCTF_TIMEOUT" ||
    code === "ETIMEDOUT" || code === "EAGAIN" || code === "EBUSY";
  return {
    code,
    meta: e && e.meta !== undefined ? e.meta : null,
    retryable,
    ...(cancelled ? { cancelled: true } : {}),
  };
}

export function createMcpServer({
  callTool = null,
  toolRunner = null,
  timeoutMs = CALL_TIMEOUT_MS,
  writeLine = (line) => realStdoutWrite(line + "\n"),
  logger = (message) => process.stderr.write(message + "\n"),
} = {}) {
  const inlineRunner = {
    run: (name, args, opts = {}) => withCallDeadline(
      () => (callTool ? callTool(name, args) : callMcpTool(name, args, { deadline: false })),
      {
        timeoutMs: opts.timeoutMs !== undefined ? opts.timeoutMs : timeoutMs,
        signal: opts.signal,
        toolName: name,
      }
    ),
    close() {},
  };
  const workerRunner = toolRunner ||
    (!callTool && !WORKER_DISABLED ? createWorkerToolRunner({ warn: logger }) : null);
  const pending = new Map();
  let closed = false;
  let inputClosed = false;
  let inflight = 0;

  const runnerFor = (name, args) =>
    toolRunner || (workerRunner && shouldUseWorker(name, args) ? workerRunner : inlineRunner);

  const send = (msg) => {
    let line;
    try {
      line = JSON.stringify(msg);
    } catch (e) {
      line = JSON.stringify({
        jsonrpc: "2.0",
        id: msg && msg.id !== undefined ? msg.id : null,
        error: { code: -32603, message: `响应序列化失败：${e && e.message ? e.message : e}` },
      });
    }
    if (line.length > MAX_OUTPUT_LINE_CHARS) {
      if (msg && msg.result && Array.isArray(msg.result.content)) {
        msg = {
          ...msg,
          result: {
            ...msg.result,
            isError: true,
            content: [{ type: "text", text: tooLargePayload(line.length) }],
          },
        };
        line = JSON.stringify(msg);
      }
      if (line.length > MAX_OUTPUT_LINE_CHARS) {
        line = JSON.stringify({
          jsonrpc: "2.0",
          id: msg && msg.id !== undefined ? msg.id : null,
          error: { code: -32603, message: tooLargePayload(line.length) },
        });
      }
    }
    writeLine(line);
  };

  async function handleRequest(req) {
    if (closed) return null;
    const { id, method, params } = req || {};
    const ok = (result) => ({ jsonrpc: "2.0", id, result });
    const err = (code, message, data) =>
      ({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });

    if (method === "initialize") {
      const reqVersion = params && params.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(reqVersion) ? reqVersion : "2024-11-05";
      return ok({
        protocolVersion,
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "ebctf-codebox", title: "恒烈 CTF 编码工具箱", version: APP_VERSION },
        instructions:
          "恒烈 CTF 编码工具箱：本地编解码 / 密码学算法集（全在本地运行、零外发）。推荐路径：ebctf_detect 先识别编码类型 → ebctf_magic_decode 一键解码（多层链式用 maxDepth:3）→ 不够再用 ebctf_list_ops / ebctf_op_schema 下钻、ebctf_run_op 精确执行。资源 ebctf://guide 是同一引导的常驻版本，适合直接挂进对话。",
      });
    }
    if (method === "notifications/cancelled") {
      const requestId = params && params.requestId;
      const controller = pending.get(String(requestId));
      if (controller) controller.abort();
      return null;
    }
    // JSON-RPC 通知没有 id，服务端不得回响应。
    if (method && method.startsWith("notifications/")) return null;
    if (method === "tools/list") return ok({ tools: MCP_TOOLS });
    if (method === "tools/call") {
      const { name, arguments: args } = params || {};
      const controller = new AbortController();
      if (id !== undefined) pending.set(String(id), controller);
      try {
        const toolArgs = args || {};
        const result = await runnerFor(name, toolArgs).run(name, toolArgs, { timeoutMs, signal: controller.signal });
        return ok(result);
      } catch (e) {
        if (e && (e.cancelled === true || e.code === "EBCTF_CANCELLED")) return null;
        if (e && e.code === "EBCTF_TIMEOUT") return ok(timeoutToolResult(e));
        throw e;
      } finally {
        if (id !== undefined) pending.delete(String(id));
      }
    }
    if (method === "resources/list") return ok(listMcpResources());
    if (method === "resources/read") {
      const uri = params && params.uri;
      const contents = readMcpResourceContents(uri);
      if (!contents) return err(-32602, `无此资源：${uri}`);
      return ok(contents);
    }
    return err(-32601, `未实现方法：${method}`);
  }

  async function handleLine(line) {
    const text = String(line == null ? "" : line).trim();
    if (!text) return;
    let req;
    try { req = JSON.parse(text); } catch { return; }
    inflight++;
    try {
      let response = null;
      try {
        response = await handleRequest(req);
      } catch (e) {
        response = {
          jsonrpc: "2.0",
          id: req && req.id,
          error: {
            code: -32603,
            message: e && e.message ? e.message : String(e),
            data: structuredRpcError(e),
          },
        };
      }
      if (response && !closed) send(response);
    } finally {
      inflight--;
      maybeClose();
    }
  }

  function maybeClose() {
    if (inputClosed && inflight === 0 && pending.size === 0 && !closed) close();
  }

  function noteInputClosed() {
    inputClosed = true;
    maybeClose();
  }

  function close() {
    if (closed) return;
    closed = true;
    for (const controller of pending.values()) {
      try { controller.abort(); } catch { /* ignore */ }
    }
    pending.clear();
    try { inlineRunner.close(); } catch { /* ignore */ }
    try { if (workerRunner) workerRunner.close(); } catch { /* ignore */ }
  }

  return { handleRequest, handleLine, close, noteInputClosed };
}

function isMainModule() {
  try {
    if (!process.argv[1]) return false;
    const entry = pathToFileURL(path.resolve(process.argv[1])).href;
    return entry.toLowerCase() === import.meta.url.toLowerCase();
  } catch {
    return false;
  }
}

if (isMainModule()) {
  nodeSecurityNotice();
  const server = createMcpServer();
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (line) => { server.handleLine(line).catch(() => {}); });
  const shutdown = () => server.close();
  rl.on("close", () => server.noteInputClosed());
  process.on("exit", shutdown);
  process.on("SIGINT", () => { shutdown(); process.exit(0); });
  process.on("SIGTERM", () => { shutdown(); process.exit(0); });
}
