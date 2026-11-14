// HTTP transport policy. Algorithms and MCP schemas remain in the shared adapter.
import path from "node:path";
import { lstat, realpath, readdir } from "node:fs/promises";
import { MCP_TOOLS } from "./ebctf-core-adapter.mjs";
import { getOp } from "../src/core/registry.js";

export function policyError(message, status = 400, code = -32602) {
  return Object.assign(new Error(message), { status, rpcCode: code });
}

export const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
export const validId = (id) => (typeof id === "string" && id.length <= 128) || Number.isSafeInteger(id);

export function validateTree(value, depth = 0, count = { n: 0 }) {
  if (++count.n > 20000 || depth > 32) throw policyError("JSON nesting/item budget exceeded");
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key) || key.startsWith("_allow")) {
      throw policyError("Reserved object key");
    }
    validateTree(child, depth + 1, count);
  }
}

export function validateEnvelope(msg) {
  if (!isObject(msg) || msg.jsonrpc !== "2.0") throw policyError("Expected a single JSON-RPC 2.0 message", 400, -32600);
  validateTree(msg);
  if (Object.hasOwn(msg, "id") && !validId(msg.id)) throw policyError("Invalid request id", 400, -32600);
  if (!Object.hasOwn(msg, "method")) {
    if (!Object.hasOwn(msg, "id") || (Object.hasOwn(msg, "result") === Object.hasOwn(msg, "error")) ||
        (Object.hasOwn(msg, "error") && (!isObject(msg.error) || !Number.isInteger(msg.error.code) || typeof msg.error.message !== "string"))) {
      throw policyError("Invalid JSON-RPC response", 400, -32600);
    }
    return "response";
  }
  if (typeof msg.method !== "string" || !msg.method || msg.method.length > 128 ||
      Object.hasOwn(msg, "result") || Object.hasOwn(msg, "error") ||
      (msg.params !== undefined && !isObject(msg.params))) throw policyError("Invalid JSON-RPC request", 400, -32600);
  if (!Object.hasOwn(msg, "id")) {
    if (!msg.method.startsWith("notifications/")) throw policyError("This method requires a request id", 400, -32600);
    return "notification";
  }
  if (msg.method.startsWith("notifications/")) throw policyError("Notifications must not have an id", 400, -32600);
  return "request";
}

export function requestBudget(params, maximum) {
  if (params?._meta !== undefined && !isObject(params._meta)) throw policyError("_meta must be an object");
  const values = [params?.timeoutMs, params?._meta?.timeoutMs].filter((v) => v !== undefined);
  if (values.some((v) => !Number.isSafeInteger(v) || v < 1 || v > maximum)) {
    throw policyError(`timeoutMs must be an integer in 1..${maximum}`);
  }
  return values.length ? Math.min(...values) : maximum;
}

export function validateToolCall(params) {
  if (!isObject(params) || typeof params.name !== "string") throw policyError("tools/call requires name");
  if (params.task !== undefined) throw policyError("Task augmentation is not supported");
  const tool = MCP_TOOLS.find((t) => t.name === params.name);
  if (!tool) throw policyError("Unknown tool");
  const args = params.arguments === undefined ? {} : params.arguments;
  if (!isObject(args)) throw policyError("Tool arguments must be an object");
  const schema = tool.inputSchema;
  for (const key of schema.required || []) if (!Object.hasOwn(args, key)) throw policyError(`Missing argument: ${key}`);
  for (const [key, value] of Object.entries(args)) {
    const rule = schema.properties[key];
    if (!rule) throw policyError(`Unknown argument: ${key}`);
    if (rule.type === "object" ? !isObject(value) : typeof value !== rule.type) throw policyError(`Invalid type: ${key}`);
    if (rule.enum && !rule.enum.includes(value)) throw policyError(`Invalid value: ${key}`);
    if (typeof value === "number" && !Number.isFinite(value)) throw policyError(`Invalid number: ${key}`);
  }
  for (const [key, max] of [["maxDepth", 3], ["limit", 50], ["maxBytes", 8 * 1024 * 1024]]) {
    if (args[key] !== undefined && (!Number.isSafeInteger(args[key]) || args[key] < 1 || args[key] > max)) {
      throw policyError(`Invalid budget: ${key} (1..${max})`);
    }
  }
  if (params.name === "ebctf_run_op") {
    const op = getOp(args.opId);
    if (op?.requiresBridge || ["jsfuck", "jjencode"].includes(args.opId)) {
      throw policyError("HTTP forbids process/bridge and JavaScript execution operations", 403);
    }
    if (args.params && Object.keys(args.params).some((k) => k.startsWith("_") || k === "rawBytes")) {
      throw policyError("Internal operation context is not a public argument");
    }
    for (const field of op?.params || []) {
      const value = args.params?.[field.key];
      if (value === undefined) continue;
      if ((field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) ||
          (field.type === "bool" && typeof value !== "boolean")) throw policyError(`Invalid operation parameter type: ${field.key}`);
    }
  }
  return args;
}

const inside = (root, target) => {
  const rel = path.relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep) && !path.isAbsolute(rel));
};

export async function checkedWorkspacePath(root, input, { output = false } = {}) {
  if (typeof input !== "string" || !input || /[\x00-\x1f]/.test(input)) throw policyError("Invalid file path");
  const target = path.resolve(root, input);
  if (!inside(root, target)) throw policyError("Path escapes HTTP workspace", 403);
  const parts = path.relative(root, target).split(path.sep).filter(Boolean);
  if (parts.some((p) => /[:]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p))) {
    throw policyError("Unsupported special file path", 403);
  }
  let cur = root;
  let st;
  for (const part of parts) {
    cur = path.join(cur, part);
    try { st = await lstat(cur); }
    catch (e) { if (output && e.code === "ENOENT") return target; throw policyError("File path does not exist"); }
    if (st.isSymbolicLink() || (!st.isDirectory() && (!st.isFile() || st.nlink > 1))) {
      throw policyError("Links and special files are not allowed", 403);
    }
    if (!inside(root, await realpath(cur))) throw policyError("Real path escapes HTTP workspace", 403);
  }
  st ??= await lstat(target);
  if (output) {
    if (!st.isDirectory()) throw policyError("outputDir must be a directory");
    // The shared writer sanitizes product names. Reject pre-existing link targets too.
    const entries = await readdir(target, { withFileTypes: true });
    if (entries.length > 4096) throw policyError("Output directory entry budget exceeded");
    for (const entry of entries) {
      const item = await lstat(path.join(target, entry.name));
      if (item.isSymbolicLink() || (item.isFile() && item.nlink > 1)) throw policyError("Output directory contains links", 403);
    }
  } else {
    if (!st.isFile()) throw policyError("Input must be a regular file");
    // read_file reads the complete file to hash it, so cap before dispatch as well.
    if (st.size > 64 * 1024 * 1024) throw policyError("File exceeds 64 MiB input budget", 413);
  }
  return target;
}

export async function prepareHttpToolArgs(name, args, root) {
  const safe = { ...args };
  if (name === "ebctf_read_file") safe.path = await checkedWorkspacePath(root, args.path);
  if (name === "ebctf_run_op") {
    if (Object.hasOwn(args, "filePath")) safe.filePath = await checkedWorkspacePath(root, args.filePath);
    if (Object.hasOwn(args, "outputDir")) safe.outputDir = await checkedWorkspacePath(root, args.outputDir, { output: true });
  }
  return safe;
}
