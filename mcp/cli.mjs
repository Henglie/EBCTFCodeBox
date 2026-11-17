#!/usr/bin/env node
/*
 * mcp/cli.mjs — 文件友好的本地 CLI（与 MCP 同一能力面）。
 *
 * MCP 是字符串协议；图片/pcap/zip/pyc/exe 这类二进制通过 --file / stdin 进入，
 * 产物用 --out 落盘。内部全部复用 callMcpTool，不复制任何算法。
 *
 * 用法：
 *   node mcp/cli.mjs list [--cat base] [--keyword base64] [--unsafe]
 *   node mcp/cli.mjs schema --op base64
 *   node mcp/cli.mjs detect --input SGVsbG8=
 *   node mcp/cli.mjs magic --input SGVsbG8= [--crib flag] [--depth 3]
 *   node mcp/cli.mjs run --op pngSizeRecover --file out.png --out ./out
 *   node mcp/cli.mjs run --op base64 --input SGVsbG8= --direction decode
 *   node mcp/cli.mjs run --op someOp --input ... --allow-over-limit
 *   node mcp/cli.mjs read --file pcap.pcap [--max-bytes 65536] [--encoding auto]
 *
 * 参数：--param key=value（可重复）；--json 输出原始 MCP JSON。
 *      --timeout <ms> 单次调用总超时（默认 30s；0=不限时；也可设 EBCTF_MCP_CALL_TIMEOUT_MS）。
 * 退出码：0 成功；1 工具返回 isError；2 用法错误。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const BRIDGE = new URL("../src/plugin/mcpBridge.js", import.meta.url);
const { createWorkerToolRunner } = await import("./server.mjs");
const { resolveCallTimeoutMs, timeoutToolResult } = await import(BRIDGE.href);

function usage() {
  const text = `EBCrypto / 码小妹 CLI（与 MCP 同一能力面；需要 Node.js）

命令：
  list     列 op          [--cat <分类>] [--keyword <词>] [--unsafe]
  schema   查 op 参数      --op <opId>
  detect   编码识别        --input <文本> | --file <路径>
  magic    一键解码        --input <文本> | --file <路径> [--crib <片段>] [--depth 3] [--intensive]
  run      跑 op           --op <opId> [--input <文本> | --file <路径> | --stdin]
                          [--direction encode|decode|run] [--param k=v ...]
                          [--out <目录>] [--base64] [--allow-over-limit]
                          产物 >128KB 时必须给 --out，否则显式报错（不静默丢内容）
                          带 --out 时文本结果同时写入 <目录>/result.txt
  read     读本地文件      --file <路径> [--max-bytes N] [--encoding auto|utf8|hex|base64]

全局：--json（原始 MCP JSON 输出）
      --timeout <ms>（单次调用总超时，默认 30s；0=不限时）
入口：bin/ebcrypto.cmd（Windows）；sh bin/ebcrypto.sh（POSIX）。二者是包装脚本，仍需 Node。
服务：node mcp/server.mjs --http [--config ebcrypto.config.json]；默认 stdio 入口保留。
`;
  process.stderr.write(text);
}

function parseArgs(argv) {
  const out = { _: [], params: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const key = a.slice(2);
    if (key === "json" || key === "unsafe" || key === "intensive" || key === "base64" || key === "stdin" || key === "allow-over-limit") {
      out[key] = true;
      continue;
    }
    const val = argv[++i];
    if (val == null) throw new Error(`参数 --${key} 缺少值`);
    if (key === "param") {
      const eq = val.indexOf("=");
      if (eq < 0) throw new Error(`--param 需要 key=value：${val}`);
      const k = val.slice(0, eq);
      let v = val.slice(eq + 1);
      // --param 是字符串协议，类型由 op schema 决定（避免 key=123 被强转成数字后
      // 让文本参数 op 崩溃，也保证与 stdio/HTTP 入口行为一致）。
      out.params[k] = v;
    } else {
      out[key] = val;
    }
  }
  return out;
}

async function sourceInput(args, text = false) {
  if (args.stdin) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString(text ? "utf8" : "base64");
  }
  if (args.file) return (await readFile(resolve(args.file))).toString(text ? "utf8" : "base64");
  if (args.input != null) return args.input;
  return "";
}

function printResult(r) {
  if (r && Array.isArray(r.content)) {
    for (const c of r.content) if (c && c.type === "text") process.stdout.write(c.text + "\n");
  } else {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  }
  if (r && r.isError) process.exitCode = 1;
}

/*
 * --out 时把同一条文本结果落到 <out>/result.txt。
 * - 内容 = 与标准输出完全一致的 text 片段（多段用 "\n" 连接），UTF-8 无 BOM，末尾不额外补换行。
 * - 不带 --out 的行为不变；--json 保持纯 JSON 输出，不落盘（避免破坏机器可读契约）。
 * - 执行失败（含文本超限报错）不落盘，避免留下一份被截断却看似完整的结果文件。
 */
async function persistTextResult(r, outDir) {
  const parts = (r && Array.isArray(r.content) ? r.content : [])
    .filter((c) => c && c.type === "text")
    .map((c) => String(c.text ?? ""));
  if (!parts.length || (r && r.isError)) return;
  const dir = resolve(outDir);
  await mkdir(dir, { recursive: true });
  const file = join(dir, "result.txt");
  await writeFile(file, parts.join("\n"), "utf8");
  process.stdout.write(`[--out] 文本结果已写入 ${file}\n`);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv.shift();
  // 空调用属用法错误，按惯例 exit 2；显式 -h/--help 是主动求助，保持 exit 0。
  if (!cmd) { usage(); process.exitCode = 2; return; }
  if (cmd === "-h" || cmd === "--help") { usage(); return; }
  let args;
  try { args = parseArgs(argv); } catch (e) { process.stderr.write(String(e.message) + "\n"); usage(); process.exitCode = 2; return; }

  // --unsafe 恢复旧能力：只在当前 CLI 进程内设置宿主 env，mcpBridge 仍不认请求参数 allowUnsafe。
  if (args.unsafe) process.env.EBCTF_MCP_UNSAFE = "1";
  if (args.timeout !== undefined && (!/^\d+$/.test(args.timeout) || !Number.isSafeInteger(Number(args.timeout)) || Number(args.timeout) > 2147483647)) {
    process.stderr.write("--timeout must be an integer in 0..2147483647\n");
    process.exitCode = 2;
    return;
  }

  let tool, payload;
  if (cmd === "list") {
    tool = "ebctf_list_ops";
    payload = { cat: args.cat, keyword: args.keyword, includeUnsafe: !!args.unsafe };
  } else if (cmd === "schema") {
    if (!args.op) { usage(); process.exitCode = 2; return; }
    tool = "ebctf_op_schema";
    payload = { opId: args.op, includeUnsafe: !!args.unsafe };
  } else if (cmd === "detect") {
    tool = "ebctf_detect";
    payload = { input: await sourceInput(args, true) };
  } else if (cmd === "magic") {
    tool = "ebctf_magic_decode";
    payload = { input: await sourceInput(args, true), crib: args.crib };
    if (args.intensive) payload.intensive = true;
    if (args.depth) payload.maxDepth = Number(args.depth);
  } else if (cmd === "run") {
    if (!args.op) { usage(); process.exitCode = 2; return; }
    tool = "ebctf_run_op";
    payload = {
      opId: args.op,
      direction: args.direction,
      params: args.params,
      allowUnsafe: !!args.unsafe,
      allowOverLimit: !!args["allow-over-limit"],
      // undefined = 走 MCP 默认：≤128KB 且无 --out 时内联；>128KB 必须 --out。
      includeBase64: args.base64 ? true : (args.out ? false : undefined),
    };
    if (args.file) payload.filePath = resolve(args.file);
    else if (args.stdin) payload.fileBase64 = await sourceInput(args);
    else payload.input = args.input == null ? "" : String(args.input);
    if (args.out) payload.outputDir = resolve(args.out);
  } else if (cmd === "read") {
    if (!args.file) { usage(); process.exitCode = 2; return; }
    tool = "ebctf_read_file";
    payload = { path: resolve(args.file), maxBytes: args["max-bytes"] ? Number(args["max-bytes"]) : undefined, encoding: args.encoding };
  } else {
    process.stderr.write(`未知命令：${cmd}\n`);
    usage();
    process.exitCode = 2;
    return;
  }

  let r;
  const runner = createWorkerToolRunner();
  const controller = new AbortController();
  const interrupt = () => { process.exitCode = 130; controller.abort(); };
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    // 真正执行前按 ebctf_op_schema 的 param.type 一次性转型（复用同一 worker，不新起进程），
    // 与 GUI 表单和 MCP 客户端保持同一套类型语义。
    if (cmd === "run" && payload && payload.params && Object.keys(payload.params).length) {
      try {
        const sres = await runner.run("ebctf_op_schema", { opId: payload.opId }, { timeoutMs: resolveCallTimeoutMs(args.timeout) });
        const schema = JSON.parse(sres.content?.[0]?.text ?? "{}");
        const types = new Map((schema.params || []).map((p) => [p.key, p.type]));
        for (const [k, v] of Object.entries(payload.params)) {
          const t = types.get(k);
          if (t === "number") payload.params[k] = Number(v);
          else if (t === "bool" || t === "boolean") payload.params[k] = (v === true || v === "true");
          else payload.params[k] = typeof v === "string" ? v : String(v);
        }
      } catch {
        // schema 取不到时保持字符串：宁可让 op 自己兜底，也不要猜类型。
      }
    }
    r = await runner.run(tool, payload, { timeoutMs: resolveCallTimeoutMs(args.timeout), signal: controller.signal });
  } catch (e) {
    if (e && e.code === "EBCTF_TIMEOUT") r = timeoutToolResult(e);
    else if (e && e.code === "EBCTF_CANCELLED") return;
    else throw e;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
    await runner.close();
  }
  if (args.json) process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  else {
    printResult(r);
    if (cmd === "run" && args.out) await persistTextResult(r, args.out);
  }
  if (r && r.isError) process.exitCode = 1;
}

try {
  await main();
} catch (e) {
  process.stderr.write(`cli: ${e && e.message ? e.message : e}\n`);
  process.exitCode = 1;
}

