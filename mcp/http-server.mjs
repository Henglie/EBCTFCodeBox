// MCP Streamable HTTP, stateless application/json mode (no SSE or sessions).
import http from "node:http";
import path from "node:path";
import { readFile, realpath, stat } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { createMcpServer, createWorkerToolRunner, SUPPORTED_PROTOCOL_VERSIONS } from "./server.mjs";
import { validateEnvelope, validateToolCall, requestBudget, prepareHttpToolArgs, policyError, isObject, validId } from "./http-policy.mjs";

export const HTTP_PROTOCOL_VERSIONS = SUPPORTED_PROTOCOL_VERSIONS.filter((v) => v !== "2024-11-05");
export const MCP_HTTP_DEFAULTS = Object.freeze({ enabled: true, host: "127.0.0.1", port: 8182, token: "", timeoutMs: 30000, maxRequestBytes: 1024 * 1024, maxPending: 16 });

function integer(value, name, min, max) {
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer in ${min}..${max}`);
  return n;
}

function boolean(value) {
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new Error("enabled must be true or false");
}

export function normalizeMcpHttpConfig(input = {}, cwd = process.cwd()) {
  if (!isObject(input)) throw new Error("services.mcp must be an object");
  const c = { ...MCP_HTTP_DEFAULTS, workspace: cwd, ...input };
  c.enabled = boolean(c.enabled);
  if (!["127.0.0.1", "::1", "localhost"].includes(c.host)) throw new Error("HTTP MCP host must be a loopback literal or localhost");
  if (c.host === "localhost") c.host = "127.0.0.1";
  c.port = integer(c.port, "port", 0, 65535);
  c.timeoutMs = integer(c.timeoutMs, "timeoutMs", 1, 120000);
  c.maxRequestBytes = integer(c.maxRequestBytes, "maxRequestBytes", 256, 8 * 1024 * 1024);
  c.maxPending = integer(c.maxPending, "maxPending", 1, 64);
  if (typeof c.token !== "string" || /[^\x21-\x7e]/.test(c.token) || c.token.length > 4096) throw new Error("token must be empty or visible ASCII (up to 4096 bytes)");
  if (typeof c.workspace !== "string" || !c.workspace || c.workspace.includes("\0")) throw new Error("workspace must be a directory path");
  c.workspace = path.resolve(cwd, c.workspace);
  return c;
}

export async function loadMcpHttpConfig({ argv = [], env = process.env, cwd = process.cwd(), configPath, overrides = {} } = {}) {
  const flags = {};
  const names = { "--host": "host", "--port": "port", "--token": "token", "--workspace": "workspace", "--timeout": "timeoutMs", "--enabled": "enabled", "--max-request-bytes": "maxRequestBytes", "--max-pending": "maxPending" };
  let explicitConfig = configPath ?? env.EBCRYPTO_CONFIG;
  for (let i = 0; i < argv.length; i++) {
    const [key, ...rest] = argv[i].split("=");
    if (["--http", "--stdio"].includes(key)) continue;
    if (key !== "--config" && !names[key]) throw new Error(`Unknown HTTP option: ${key}`);
    const value = rest.length ? rest.join("=") : argv[++i];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value: ${key}`);
    if (key === "--config") explicitConfig = value;
    else flags[names[key]] = value;
  }
  const file = path.resolve(cwd, explicitConfig ?? "ebcrypto.config.json");
  let fromFile = {};
  try {
    const doc = JSON.parse(await readFile(file, "utf8"));
    if (!isObject(doc)) throw new Error("Configuration root must be an object");
    if (doc.services?.mcp !== undefined) {
      if (!isObject(doc.services.mcp)) throw new Error("services.mcp must be an object");
      fromFile = { ...doc.services.mcp };
      if (typeof fromFile.workspace === "string") fromFile.workspace = path.resolve(path.dirname(file), fromFile.workspace);
    }
  } catch (e) { if (e.code !== "ENOENT" || explicitConfig !== undefined) throw e; }
  const fromEnv = {};
  for (const [suffix, key] of Object.entries({ ENABLED: "enabled", HOST: "host", PORT: "port", TOKEN: "token", WORKSPACE: "workspace", TIMEOUT_MS: "timeoutMs", MAX_REQUEST_BYTES: "maxRequestBytes", MAX_PENDING: "maxPending" })) {
    if (env[`EBCRYPTO_MCP_${suffix}`] !== undefined) fromEnv[key] = env[`EBCRYPTO_MCP_${suffix}`];
  }
  return normalizeMcpHttpConfig({ ...fromFile, ...fromEnv, ...flags, ...overrides }, cwd);
}

function accepts(header, type) {
  if (typeof header !== "string") return false;
  return header.split(",").some((entry) => {
    const [media, ...params] = entry.trim().toLowerCase().split(";");
    const q = params.find((p) => p.trim().startsWith("q="));
    return media.trim() === type && (!q || (/^q=(0(?:\.\d+)?|1(?:\.0+)?)$/.test(q.trim()) && Number(q.trim().slice(2)) > 0));
  });
}

function send(res, status, msg, extra = {}) {
  if (res.destroyed || res.writableEnded) return;
  let body = msg === undefined ? "" : JSON.stringify(msg);
  if (Buffer.byteLength(body) > 2 * 1024 * 1024) {
    body = JSON.stringify({ jsonrpc: "2.0", id: msg.id ?? null, error: { code: -32603, message: "HTTP response budget exceeded; use outputDir or narrow the query" } });
  }
  res.writeHead(status, { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...(body ? { "Content-Type": "application/json; charset=utf-8" } : {}), "Content-Length": Buffer.byteLength(body), ...extra });
  res.end(body);
}

function fail(res, error, id = null) {
  send(res, error.status || 500, { jsonrpc: "2.0", id, error: { code: error.rpcCode ?? -32603, message: error.message } });
}

export function createMcpHttpService(options = {}) {
  const config = normalizeMcpHttpConfig(options);
  const sockets = new Set();
  const activeIds = new Map();
  let runner, mcp, root, url = null, startTask = null, closing = null, stopped = false;
  let activePosts = 0;
  const server = http.createServer({ maxHeaderSize: 16 * 1024, requestTimeout: 10000, headersTimeout: 5000 }, (req, res) => {
    handle(req, res).catch((e) => fail(res, e));
  });
  server.maxRequestsPerSocket = 100;
  server.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });
  // Reject Expect before Node can send 100 Continue, using the same admission policy.
  server.on("checkContinue", (req, res) => { handle(req, res, true).catch((e) => fail(res, e)); });
  server.on("checkExpectation", (req, res) => fail(res, policyError("Expect is not supported", 417)));

  function admission(req) {
    if (stopped || !mcp) throw policyError("Service is stopping", 503);
    const port = server.address().port;
    const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
    const singleton = new Set(["host", "origin", "authorization", "content-type", "mcp-protocol-version"]);
    const seen = new Set();
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const key = req.rawHeaders[i].toLowerCase();
      if (singleton.has(key) && seen.has(key)) throw policyError("Duplicate security header", 400);
      seen.add(key);
    }
    if (!hosts.has(req.headers.host)) throw policyError("Forbidden Host", 403);
    if (req.headers.origin !== undefined && !new Set([...hosts].map((h) => `http://${h}`)).has(req.headers.origin)) throw policyError("Forbidden Origin", 403);
    if (config.token) {
      const received = Buffer.from(typeof req.headers.authorization === "string" ? req.headers.authorization : "");
      const expected = Buffer.from(`Bearer ${config.token}`);
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw policyError("Bearer token required", 401);
    }
    if (req.url !== "/mcp") throw policyError("Not found", 404);
    const version = req.headers["mcp-protocol-version"] ?? "2025-03-26";
    if (!HTTP_PROTOCOL_VERSIONS.includes(version)) throw policyError("Unsupported MCP-Protocol-Version", 400);
    if (req.method !== "POST") return;
    if (!accepts(req.headers.accept, "application/json") || !accepts(req.headers.accept, "text/event-stream")) throw policyError("Accept must include application/json and text/event-stream", 406);
    if (typeof req.headers["content-type"] !== "string" || !/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(req.headers["content-type"])) throw policyError("Content-Type must be application/json (UTF-8)", 415);
    if (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity") throw policyError("Compressed request bodies are not supported", 415);
    if (req.headers["content-length"] !== undefined && (!/^\d+$/.test(req.headers["content-length"]) || Number(req.headers["content-length"]) > config.maxRequestBytes)) throw policyError("Request body too large", 413);
    if (activePosts >= config.maxPending + 4) throw policyError("HTTP admission budget exceeded", 429);
  }

  async function handle(req, res, expectContinue = false) {
    try { admission(req); }
    catch (e) { fail(res, e); req.resume(); return; }
    if (req.method !== "POST") {
      send(res, 405, { jsonrpc: "2.0", id: null, error: { code: -32000, message: "Only POST; SSE and sessions are not offered" } }, { Allow: "POST" });
      req.resume();
      return;
    }
    if (expectContinue) res.writeContinue();
    activePosts++;
    let id = null, key;
    const timer = setTimeout(() => { fail(res, policyError("Request body deadline exceeded", 408)); req.destroy(); }, 10000);
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > config.maxRequestBytes) { fail(res, policyError("Request body too large", 413)); req.resume(); return; }
        chunks.push(chunk);
      }
      clearTimeout(timer);
      let msg;
      try { msg = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
      catch { throw policyError("Invalid UTF-8 JSON", 400, -32700); }
      const kind = validateEnvelope(msg);
      id = msg.id ?? null;
      const budget = requestBudget(msg.params, config.timeoutMs);
      if (kind === "response") { send(res, 202); return; }
      if (kind === "notification") {
        if (msg.method === "notifications/cancelled" && validId(msg.params?.requestId)) {
          const job = activeIds.get(JSON.stringify(msg.params.requestId));
          if (job) job.cancelled = true;
        }
        if (msg.method !== "notifications/cancelled" || validId(msg.params?.requestId)) await mcp.handleRequest(msg);
        send(res, 202);
        return;
      }
      if (msg.method === "initialize") {
        const p = msg.params;
        if (!isObject(p) || typeof p.protocolVersion !== "string" || !isObject(p.capabilities) || !isObject(p.clientInfo) ||
            typeof p.clientInfo.name !== "string" || typeof p.clientInfo.version !== "string") throw policyError("Invalid initialize parameters");
        // Negotiate a supported HTTP version even for a newer client.
        msg.params = { ...p, protocolVersion: HTTP_PROTOCOL_VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : HTTP_PROTOCOL_VERSIONS[0] };
      }
      if (msg.method === "resources/read" && typeof msg.params?.uri !== "string") throw policyError("resources/read requires uri");
      if (msg.method === "tools/call") {
        const args = validateToolCall(msg.params);
        if (activeIds.size >= config.maxPending) throw policyError("Tool task budget exceeded", 429);
        key = JSON.stringify(id);
        if (activeIds.has(key)) { key = undefined; throw policyError("Duplicate active request id", 409); }
        const job = { cancelled: false };
        activeIds.set(key, job);
        const started = Date.now();
        const prepared = await prepareHttpToolArgs(msg.params.name, args, root);
        if (job.cancelled) { send(res, 202); return; }
        const remaining = budget - (Date.now() - started);
        if (remaining < 1) throw policyError("Task admission deadline exceeded", 408);
        msg.params = { ...msg.params, arguments: prepared };
        const out = await mcp.handleRequest(msg, { timeoutMs: remaining });
        send(res, out ? 200 : 202, out ?? undefined);
      } else {
        const out = await mcp.handleRequest(msg);
        if (msg.method === "initialize" && out?.result) out.result.instructions += " HTTP is stateless JSON (no SSE); files are restricted to the configured workspace; bridge/process/JS execution and outbound fetch are disabled. Use unique in-flight request ids; cancellation shares this local endpoint's trust boundary.";
        if (msg.method === "tools/list" && out?.result) out.result.tools = out.result.tools.map((tool) => ({ ...tool, description: tool.description + " HTTP: workspace paths only; bridge/process/JS execution unavailable." }));
        send(res, out ? 200 : 202, out ?? undefined);
      }
    } catch (e) { fail(res, e, id); }
    finally { clearTimeout(timer); activePosts--; if (key !== undefined) activeIds.delete(key); }
  }

  function start() {
    if (!config.enabled) return Promise.resolve(null);
    if (stopped || startTask || url) return Promise.reject(new Error("Service already started or closed"));
    startTask = (async () => {
      try {
      root = await realpath(config.workspace);
      if (!(await stat(root)).isDirectory()) throw new Error("workspace must be an existing directory");
      if (stopped) throw new Error("Service closed during startup");
      runner = createWorkerToolRunner({
        adapter: new URL("./http-tool-adapter.mjs", import.meta.url).href,
        env: { ...process.env, EBCTF_MCP_UNSAFE: "0", EBCTF_MCP_WORKSPACE: root, EBCTF_MCP_RESTRICT: "1", EBCTF_MCP_ALLOW_OUTSIDE: "0" },
      });
      mcp = createMcpServer({ toolRunner: runner, timeoutMs: config.timeoutMs, writeLine: () => {} });
      await new Promise((resolve, reject) => {
        const onError = (e) => { server.off("listening", onListen); reject(e); };
        const onListen = () => { server.off("error", onError); resolve(); };
        server.once("error", onError);
        server.once("listening", onListen);
        server.listen(config.port, config.host);
      });
      url = `http://${config.host === "::1" ? "[::1]" : config.host}:${server.address().port}/mcp`;
      return service;
      } catch (e) { await runner?.close(); throw e; }
    })();
    return startTask;
  }

  function close() {
    if (closing) return closing;
    stopped = true;
    closing = (async () => {
      await startTask?.catch(() => {});
      const workerClosed = mcp?.close();
      await new Promise((resolve) => {
        if (!server.listening) return resolve();
        server.close(resolve);
        for (const socket of sockets) socket.destroy();
      });
      await workerClosed;
      await runner?.close();
      url = null;
    })();
    return closing;
  }
  const service = { start, close, get url() { return url; }, get config() { return { ...config, workspace: root ?? config.workspace }; }, get pendingCount() { return runner?.pendingCount ?? 0; } };
  return service;
}

export async function startMcpHttpService(options = {}) {
  const config = await loadMcpHttpConfig(options);
  if (!config.enabled) return null;
  const service = createMcpHttpService(config);
  await service.start();
  return service;
}
