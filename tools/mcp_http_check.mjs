import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFile, writeFile, mkdir, mkdtemp, access, symlink, link, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { createMcpHttpService, loadMcpHttpConfig, normalizeMcpHttpConfig } from "../mcp/http-server.mjs";
import { createWorkerToolRunner } from "../mcp/server.mjs";
import { MCP_TOOLS, listMcpResources } from "../mcp/ebctf-core-adapter.mjs";
import { OPS } from "../src/core/registry.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const EVIDENCE = path.join(ROOT, "资料", "工程留存", "MT749");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const exists = async (p) => { try { await access(p); return true; } catch { return false; } };
const request = (id, method, params) => ({ jsonrpc: "2.0", ...(id !== undefined ? { id } : {}), method, ...(params !== undefined ? { params } : {}) });
const init = request(1, "initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "local-check", version: "1" } });
const call = (id, name, args = {}, extra = {}) => request(id, "tools/call", { name, arguments: args, ...extra });

function exchange(url, message, headers = {}, method = "POST", raw) {
  return new Promise((resolve, reject) => {
    const body = raw ?? (message === undefined ? "" : JSON.stringify(message));
    const req = http.request(url, { method, headers: Object.fromEntries(Object.entries({
      Accept: "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": "2025-11-25", ...headers,
    }).filter(([, value]) => value !== undefined)) }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json; try { json = text ? JSON.parse(text) : undefined; } catch { /* assertion reports raw response */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
      res.on("error", reject);
    });
    req.setTimeout(8000, () => req.destroy(new Error("HTTP test deadline")));
    req.on("error", reject);
    req.end(body);
  });
}

async function portClosed(url) {
  const parsed = new URL(url);
  return new Promise((resolve) => {
    const socket = net.connect(Number(parsed.port), parsed.hostname.replace(/^\[|\]$/g, ""));
    socket.once("connect", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => { socket.destroy(); resolve(true); });
  });
}

function childRun(args, { input = "", command = process.execPath, cwd = ROOT, verbatim = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, windowsVerbatimArguments: verbatim, env: { ...process.env, EBCTF_MCP_UNSAFE: "0", EBCTF_MCP_CALL_TIMEOUT_MS: "5000" } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    const timer = setTimeout(() => { child.kill(); reject(new Error("Child test deadline")); }, 12000);
    child.once("error", (e) => { clearTimeout(timer); reject(e); });
    child.once("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

export async function runChecks() {
  const results = [];
  const services = [];
  const check = async (name, fn) => {
    try { await fn(); results.push({ name, status: "PASS" }); }
    catch (e) { results.push({ name, status: "FAIL", error: String(e.message).split(ROOT).join("<ROOT>") }); }
  };
  await mkdir(EVIDENCE, { recursive: true });
  const run = await mkdtemp(path.join(EVIDENCE, "run-"));
  const workspace = path.join(run, "workspace");
  await mkdir(workspace);
  await writeFile(path.join(workspace, "input.txt"), "Hello");
  const outside = path.join(run, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "sentinel.txt"), "outside-unchanged");
  const service = createMcpHttpService({ port: 0, workspace, timeoutMs: 5000 });
  services.push(service);
  await service.start();
  const url = service.url;
  let serial = 10;
  const invoke = (name, args, extra) => exchange(url, call(serial++, name, args, extra));
  const content = (response) => response.json.result.content[0].text;
  const base64 = { opId: "base64", input: "SGVsbG8=", direction: "decode" };
  const costly = { opId: "bcrypt", input: "bounded-probe", params: { cost: 13, salt: "00000000000000000000000000000000", saltEnc: "hex" } };
  try {
    await check("HTTP initialize/version/capabilities/no-session/no-CORS", async () => {
      const r = await exchange(url, init);
      assert.equal(r.status, 200); assert.equal(r.json.result.protocolVersion, "2025-11-25");
      assert(r.json.result.capabilities.tools); assert(r.json.result.capabilities.resources);
      assert.equal(r.headers["mcp-session-id"], undefined); assert.equal(r.headers["access-control-allow-origin"], undefined);
      assert.match(r.headers["content-type"], /^application\/json/);
    });
    await check("HTTP protocol negotiation/fallback/header rejection", async () => {
      assert.equal((await exchange(url, { ...init, params: { ...init.params, protocolVersion: "future" } })).json.result.protocolVersion, "2025-11-25");
      assert.equal((await exchange(url, request(2, "ping"), { "MCP-Protocol-Version": undefined })).status, 200);
      assert.equal((await exchange(url, init, { "MCP-Protocol-Version": "bad" })).status, 400);
    });
    await check("HTTP notifications and client responses return empty 202", async () => {
      for (const msg of [request(undefined, "notifications/initialized"), request(undefined, "notifications/cancelled", { requestId: "missing" }), { jsonrpc: "2.0", id: 99, result: {} }]) {
        const r = await exchange(url, msg); assert.equal(r.status, 202); assert.equal(r.text, "");
      }
    });
    await check("HTTP tools/list reuses all seven tool names/schemas", async () => {
      const r = await exchange(url, request(3, "tools/list"));
      assert.deepEqual(r.json.result.tools.map((t) => [t.name, t.inputSchema]), MCP_TOOLS.map((t) => [t.name, t.inputSchema]));
    });
    await check("HTTP resources/list and every resource/read", async () => {
      const listed = await exchange(url, request(4, "resources/list"));
      assert.deepEqual(listed.json.result, listMcpResources());
      for (const resource of listed.json.result.resources) {
        const r = await exchange(url, request(serial++, "resources/read", { uri: resource.uri }));
        assert.equal(r.status, 200); assert(r.json.result.contents[0].text.length > 0);
      }
      assert.equal((await exchange(url, request(serial++, "resources/read", { uri: "ebctf://missing" }))).json.error.code, -32602);
    });
    await check("HTTP real base64 op, list, schema, detect, magic", async () => {
      assert.equal(content(await invoke("ebctf_run_op", base64)), "Hello");
      assert(JSON.parse(content(await invoke("ebctf_list_ops", { keyword: "base64" }))).ops.some((o) => o.id === "base64"));
      assert.equal(JSON.parse(content(await invoke("ebctf_op_schema", { opId: "base64" }))).id, "base64");
      assert(JSON.parse(content(await invoke("ebctf_detect", { input: "SGVsbG8=" }))).candidates.length > 0);
      assert.equal((await invoke("ebctf_magic_decode", { input: "SGVsbG8=" })).json.result.isError, false);
    });
    await check("HTTP workspace file input/read with exact bytes and sha256", async () => {
      const r = await invoke("ebctf_read_file", { path: "input.txt", encoding: "utf8" });
      const data = JSON.parse(content(r)); assert.equal(data.content, "Hello"); assert.equal(data.sha256, hash("Hello"));
      assert.equal(content(await invoke("ebctf_run_op", { opId: "base64", direction: "encode", filePath: "input.txt" })), "SGVsbG8=");
    });
    for (const [name, headers, expected] of [
      ["malicious Host", { Host: "attacker.invalid" }, 403], ["Host suffix", { Host: `127.0.0.1.attacker.invalid:${new URL(url).port}` }, 403],
      ["malicious Origin", { Origin: "https://attacker.invalid" }, 403], ["null Origin", { Origin: "null" }, 403],
      ["wrong Content-Type", { "Content-Type": "text/plain" }, 415], ["wrong charset", { "Content-Type": "application/json; charset=latin1" }, 415],
      ["compressed body", { "Content-Encoding": "gzip" }, 415], ["incomplete Accept", { Accept: "application/json" }, 406],
      ["zero-q Accept", { Accept: "application/json;q=0, text/event-stream" }, 406],
    ]) await check(`HTTP rejects ${name} before side effects`, async () => {
      const target = `${name.replace(/\W/g, "-")}-not-created`;
      assert.equal((await exchange(url, call(serial++, "ebctf_run_op", { opId: "gzipCodec", input: "hello", direction: "encode", params: { toFile: true }, outputDir: target }), headers)).status, expected);
      assert.equal(await exists(path.join(workspace, target)), false);
    });
    await check("HTTP no-Origin local client and exact same-Origin client", async () => {
      assert.equal((await exchange(url, request(serial++, "ping"))).status, 200);
      const r = await exchange(url, request(serial++, "ping"), { Origin: new URL(url).origin });
      assert.equal(r.status, 200); assert.equal(r.headers["access-control-allow-origin"], undefined);
    });
    await check("HTTP GET/DELETE/OPTIONS explicitly 405 (no SSE)", async () => {
      for (const method of ["GET", "DELETE", "OPTIONS"]) assert.equal((await exchange(url, undefined, {}, method)).status, 405);
    });
    await check("HTTP malformed JSON/batch/envelope/UTF-8 rejection", async () => {
      for (const raw of ["{", "[]", '{"jsonrpc":"1.0","id":1,"method":"ping"}', '{"jsonrpc":"2.0","id":null,"method":"ping"}', Buffer.from([0xff])]) {
        assert.equal((await exchange(url, undefined, {}, "POST", raw)).status, 400);
      }
      assert.equal((await exchange(url, call(undefined, "ebctf_run_op", base64))).status, 400);
    });
    await check("HTTP invalid tool types/budgets/internal context rejected before output", async () => {
      const cases = [
        call(100, "ebctf_run_op", { ...base64, input: [] }), call(100, "ebctf_run_op", { ...base64, params: [] }),
        call(100, "ebctf_read_file", { path: "input.txt", maxBytes: -1 }), call(100, "ebctf_magic_decode", { input: "test", maxDepth: 4 }),
        call(100, "ebctf_detect", { input: "test", limit: 1.5 }), call(100, "ebctf_list_ops", null),
        ...[0, -1, "20", 5001, 1.5, null].map((timeoutMs) => call(100, "ebctf_run_op", { ...base64, outputDir: "invalid-budget" }, { timeoutMs })),
        call(100, "ebctf_run_op", base64, { _meta: { timeoutMs: -1 } }), call(100, "ebctf_run_op", base64, { task: {} }),
        call(100, "ebctf_run_op", { ...base64, params: { _deadline: 0 } }),
        call(100, "ebctf_run_op", { opId: "bcrypt", input: "test", params: { cost: "13" } }),
      ];
      for (const msg of cases) assert.equal((await exchange(url, msg)).status, 400);
      assert.equal(await exists(path.join(workspace, "invalid-budget")), false);
    });
    await check("HTTP request size: declared length and chunked cumulative cap", async () => {
      const raw = "x".repeat(1024 * 1024 + 1);
      assert.equal((await exchange(url, undefined, { "Content-Length": String(raw.length) }, "POST", raw)).status, 413);
      assert.equal((await exchange(url, undefined, {}, "POST", raw)).status, 413);
    });
    await check("HTTP rejects traversal, absolute escape, links and special files", async () => {
      for (const p of ["../outside/sentinel.txt", path.join(outside, "sentinel.txt"), "input.txt:stream", "NUL"]) {
        assert.equal((await invoke("ebctf_read_file", { path: p })).status, 403);
      }
      await symlink(outside, path.join(workspace, "linked"), process.platform === "win32" ? "junction" : "dir");
      assert.equal((await invoke("ebctf_read_file", { path: "linked/sentinel.txt" })).status, 403);
      assert.equal((await invoke("ebctf_run_op", { ...base64, outputDir: "linked/output" })).status, 403);
      await link(path.join(outside, "sentinel.txt"), path.join(workspace, "hardlink.txt"));
      assert.equal((await invoke("ebctf_read_file", { path: "hardlink.txt" })).status, 403);
      await mkdir(path.join(workspace, "linked-products"));
      await link(path.join(outside, "sentinel.txt"), path.join(workspace, "linked-products", "compressed.gz"));
      assert.equal((await invoke("ebctf_run_op", { ...base64, outputDir: "linked-products" })).status, 403);
      assert.equal(await readFile(path.join(outside, "sentinel.txt"), "utf8"), "outside-unchanged");
    });
    await check("HTTP refuses JS execution and all registered bridge operations", async () => {
      for (const id of ["jsfuck", "jjencode", ...OPS.filter((op) => op.requiresBridge).map((op) => op.id)]) {
        assert.equal((await invoke("ebctf_run_op", { opId: id, input: "" })).status, 403);
      }
    });
    const bigBytes = Buffer.alloc(140000, 0x80);
    const compressed = gzipSync(bigBytes).toString("base64");
    const productArgs = { opId: "gzipCodec", direction: "decode", fileBase64: compressed, params: { toFile: true } };
    await check("HTTP large product explicit error then workspace disk-only output", async () => {
      const denied = await invoke("ebctf_run_op", { ...productArgs, includeBase64: true });
      assert.equal(denied.json.result.isError, true);
      assert.equal(JSON.parse(content(denied)).code, "EBCTF_MCP_OUTPUT_TOO_LARGE");
      const accepted = await invoke("ebctf_run_op", { ...productArgs, outputDir: "products", includeBase64: true });
      const data = JSON.parse(content(accepted)); assert.equal(accepted.json.result.isError, false);
      assert.equal(data.inline, false); assert.equal(data.files[0].base64, undefined);
      assert.deepEqual(await readFile(data.files[0].path), bigBytes);
    });
    await check("HTTP timeout on a warm worker and post-timeout recovery", async () => {
      const started = Date.now();
      const r = await invoke("ebctf_run_op", costly, { timeoutMs: 25 });
      assert.equal(JSON.parse(content(r)).code, "EBCTF_TIMEOUT"); assert(Date.now() - started < 1500);
      assert.equal(content(await invoke("ebctf_run_op", base64)), "Hello");
    });
    await check("HTTP active-id collision, explicit cancellation, empty original response and recovery", async () => {
      const running = exchange(url, call("cancel-me", "ebctf_run_op", costly));
      await sleep(25);
      assert.equal((await exchange(url, call("cancel-me", "ebctf_run_op", base64))).status, 409);
      assert.equal((await exchange(url, request(undefined, "notifications/cancelled", { requestId: "cancel-me" }))).status, 202);
      const cancelled = await running; assert.equal(cancelled.status, 202); assert.equal(cancelled.text, "");
      assert.equal(content(await invoke("ebctf_run_op", base64)), "Hello"); assert.equal(service.pendingCount, 0);
    });
    await check("HTTP bounded concurrent admission and queued-task deadline without output side effects", async () => {
      const limited = createMcpHttpService({ port: 0, workspace, maxPending: 2, timeoutMs: 5000 });
      services.push(limited); await limited.start();
      await exchange(limited.url, call("warm", "ebctf_run_op", base64));
      const running = exchange(limited.url, call("busy", "ebctf_run_op", costly));
      await sleep(20);
      const queued = exchange(limited.url, call("queued", "ebctf_run_op", { ...productArgs, outputDir: "queued-output" }, { timeoutMs: 100 }));
      await sleep(10);
      assert.equal((await exchange(limited.url, call("over-budget", "ebctf_run_op", { ...productArgs, outputDir: "over-budget-output" }))).status, 429);
      const expired = await queued; assert.equal(JSON.parse(content(expired)).code, "EBCTF_TIMEOUT");
      assert.equal(await exists(path.join(workspace, "queued-output")), false);
      assert.equal(await exists(path.join(workspace, "over-budget-output")), false);
      await exchange(limited.url, request(undefined, "notifications/cancelled", { requestId: "busy" }));
      assert.equal((await running).status, 202);
      await limited.close();
    });
    await check("HTTP token enabled: absent/wrong rejected before writes; correct accepted", async () => {
      const secured = createMcpHttpService({ port: 0, workspace, token: "local-test-token" });
      services.push(secured); await secured.start();
      for (const Authorization of [undefined, "Bearer wrong"]) {
        assert.equal((await exchange(secured.url, call(1, "ebctf_run_op", { ...productArgs, outputDir: "token-denied" }), Authorization ? { Authorization } : {})).status, 401);
      }
      assert.equal(await exists(path.join(workspace, "token-denied")), false);
      assert.equal((await exchange(secured.url, init, { Authorization: "Bearer local-test-token" })).status, 200);
      assert.equal((await exchange(secured.url, request(2, "tools/list"), { Authorization: "Bearer local-test-token" })).status, 200);
      const saved = secured.url; await secured.close(); assert(await portClosed(saved));
    });
    await check("Config file/env/args/launcher override precedence and disabled service", async () => {
      const configPath = path.join(run, "ebcrypto.config.json");
      await writeFile(configPath, JSON.stringify({ services: { mcp: { enabled: false, port: 8183, workspace: "workspace", token: "file" } } }));
      const c = await loadMcpHttpConfig({ configPath, env: { EBCRYPTO_MCP_PORT: "8184", EBCRYPTO_MCP_TOKEN: "env" }, argv: ["--http", "--port=8185", "--token", ""], overrides: { port: 8186 } });
      assert.equal(c.port, 8186); assert.equal(c.token, ""); assert.equal(c.workspace, workspace); assert.equal(c.enabled, false);
      assert.equal(await createMcpHttpService(c).start(), null);
      for (const bad of [{ host: "0.0.0.0" }, { host: "192.168.1.2" }, { port: -1 }, { timeoutMs: 0 }, { token: "bad\n" }, { enabled: "yes" }]) assert.throws(() => normalizeMcpHttpConfig(bad));
    });
    await check("HTTP port conflict reports EADDRINUSE and leaves existing server usable", async () => {
      const conflict = createMcpHttpService({ port: Number(new URL(url).port), workspace }); services.push(conflict);
      await assert.rejects(conflict.start(), (e) => e.code === "EADDRINUSE");
      await conflict.close(); assert.equal((await exchange(url, request(1, "ping"))).status, 200);
    });
    await check("Factory close during asynchronous startup cannot leave a listener", async () => {
      const racing = createMcpHttpService({ port: 0, workspace }); services.push(racing);
      const rejected = assert.rejects(racing.start(), /closed during startup/);
      await racing.close(); await rejected;
      assert.equal(racing.url, null); assert.equal(racing.pendingCount, 0);
    });
    await check("Worker hard termination: bounded synchronous probe never completes after timeout/cancel", async () => {
      const runner = createWorkerToolRunner({ adapter: new URL("../资料/工程留存/MT749/worker-probe.mjs", import.meta.url).href });
      try {
        for (const mode of ["timeout", "cancel"]) {
          await runner.run("ready", {}, { timeoutMs: 2000 });
          const started = path.join(run, `${mode}-started.txt`), finished = path.join(run, `${mode}-finished.txt`);
          const controller = new AbortController();
          const pending = runner.run("probe", { started, finished }, { timeoutMs: mode === "timeout" ? 100 : 2000, signal: controller.signal });
          const rejected = assert.rejects(pending, (e) => e.code === (mode === "timeout" ? "EBCTF_TIMEOUT" : "EBCTF_CANCELLED"));
          for (let i = 0; i < 40 && !(await exists(started)); i++) await sleep(2);
          assert(await exists(started)); if (mode === "cancel") controller.abort();
          await rejected; await sleep(650); assert.equal(await exists(finished), false);
        }
      } finally { await runner.close(); }
    });
    await check("stdio real initialize/tools/resources/op; clean JSON stdout and EOF exit", async () => {
      const messages = [init, request(undefined, "notifications/initialized"), request(2, "tools/list"), request(3, "resources/list"), request(4, "resources/read", { uri: "ebctf://guide" }), call(5, "ebctf_run_op", base64)];
      const r = await childRun(["mcp/server.mjs", "--stdio"], { input: messages.map((m) => JSON.stringify(m)).join("\n") + "\n" });
      assert.equal(r.code, 0); const out = r.stdout.trim().split(/\r?\n/).map((l) => JSON.parse(l)); assert.equal(out.length, 5);
      assert.equal(out.find((m) => m.id === 5).result.content[0].text, "Hello");
    });
    await check("CLI six real commands plus UTF-8 text stdin and binary stdin", async () => {
      const cases = [
        ["list", "--keyword", "base64"], ["schema", "--op", "base64"], ["detect", "--file", path.join(workspace, "input.txt")],
        ["magic", "--input", "SGVsbG8="], ["run", "--op", "base64", "--input", "SGVsbG8=", "--direction", "decode"],
        ["read", "--file", path.join(workspace, "input.txt")],
      ];
      for (const args of cases) { const r = await childRun(["mcp/cli.mjs", ...args, "--json"]); assert.equal(r.code, 0, r.stderr); assert(JSON.parse(r.stdout).content); }
      const binary = await childRun(["mcp/cli.mjs", "run", "--op", "base64", "--direction", "encode", "--stdin"], { input: Buffer.from("Hello") });
      assert.equal(binary.stdout.trim(), "SGVsbG8=");
      const text = await childRun(["mcp/cli.mjs", "detect", "--stdin", "--json"], { input: "SGVsbG8=" });
      assert(JSON.parse(JSON.parse(text.stdout).content[0].text).candidates.some((c) => c.id === "base64"));
    });
    await check("CLI output file bytes, structured timeout and exit codes 1/2", async () => {
      const r = await childRun(["mcp/cli.mjs", "run", "--op", "gzipCodec", "--direction", "decode", "--stdin", "--param", "toFile=true", "--out", path.join(workspace, "cli-products"), "--json"], { input: gzipSync(bigBytes) });
      assert.equal(r.code, 0, r.stderr); const data = JSON.parse(JSON.parse(r.stdout).content[0].text); assert.deepEqual(await readFile(data.files[0].path), bigBytes);
      assert.equal((await childRun(["mcp/cli.mjs", "run", "--op", "missing"])).code, 1);
      assert.equal((await childRun(["mcp/cli.mjs", "unknown"])).code, 2);
      assert.equal((await childRun(["mcp/cli.mjs", "run", "--op", "base64", "--timeout", "bad"])).code, 2);
      const timed = await childRun(["mcp/cli.mjs", "run", "--op", "bcrypt", "--input", "test", "--timeout", "10", "--json"]);
      assert.equal(timed.code, 1); assert.equal(JSON.parse(JSON.parse(timed.stdout).content[0].text).code, "EBCTF_TIMEOUT");
    });
    await check("Unified platform wrapper: path-independent invocation and help", async () => {
      if (process.platform === "win32") {
        const wrapper = path.join(ROOT, "bin", "ebcrypto.cmd");
        const r = await childRun(["/d", "/s", "/c", `""${wrapper}" run --op base64 --input SGVsbG8= --direction decode"`], { command: process.env.ComSpec || "cmd.exe", cwd: workspace, verbatim: true });
        assert.equal(r.code, 0, r.stderr); assert.equal(r.stdout.trim(), "Hello");
      }
      const sh = process.platform === "win32" ? path.join(process.env.ProgramFiles || "", "Git", "bin", "sh.exe") : "sh";
      if (process.platform === "win32" && !(await exists(sh))) { results.push({ name: "POSIX wrapper runtime", status: "UNTESTED", reason: "No POSIX shell" }); return; }
      const r = await childRun([path.join(ROOT, "bin", "ebcrypto.sh"), "run", "--op", "base64", "--input", "SGVsbG8=", "--direction", "decode"], { command: sh, cwd: workspace });
      assert.equal(r.code, 0, r.stderr); assert.equal(r.stdout.trim(), "Hello");
      const help = await childRun(["mcp/cli.mjs", "--help"]); assert.match(help.stderr, /Node/);
    });
    await check("HTTP executable entry starts and SIGTERM closes port/process", async () => {
      const child = spawn(process.execPath, ["mcp/server.mjs", "--http", "--port", "0", "--workspace", workspace], { cwd: ROOT, windowsHide: true });
      let stderr = "", stdout = "", saved;
      child.stderr.on("data", (c) => { stderr += c; }); child.stdout.on("data", (c) => { stdout += c; });
      const exited = new Promise((resolve) => child.once("close", (code) => resolve(code)));
      try {
        for (let i = 0; i < 200 && !saved; i++) { saved = stderr.match(/http:\/\/127\.0\.0\.1:\d+\/mcp/)?.[0]; if (!saved) await sleep(20); }
        assert(saved, stderr); assert.equal((await exchange(saved, init)).status, 200); assert.equal(stdout, "");
        child.kill("SIGTERM"); await Promise.race([exited, sleep(3000).then(() => { throw new Error("Service child failed to exit"); })]);
        assert(await portClosed(saved));
      } finally { child.kill(); await exited; }
    });
    await check("Service close aborts in-flight worker, releases sockets and is idempotent", async () => {
      const pending = exchange(url, call("shutdown", "ebctf_run_op", costly)).catch(() => null);
      await sleep(25); await service.close(); await pending; await service.close();
      assert.equal(service.pendingCount, 0); assert(await portClosed(url));
    });
  } finally {
    for (const service of services) await service.close();
  }
  const report = { node: process.versions.node, platform: process.platform, run: path.relative(ROOT, run).replaceAll("\\", "/"), pass: results.filter((r) => r.status === "PASS").length, fail: results.filter((r) => r.status === "FAIL").length, untested: ["macOS/Linux native execution", "desktop MCP client applications", "native single-file/runtime-bundled distribution"], results };
  await writeFile(path.join(run, "report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (report.fail) process.exitCode = 1;
  return report;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await runChecks();
