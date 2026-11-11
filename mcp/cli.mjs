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
 * 退出码：0 成功；1 工具返回 isError；2 用法错误。
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ADAPTER = new URL("./ebctf-core-adapter.mjs", import.meta.url);
const { callMcpTool, MCP_TOOLS } = await import(ADAPTER.href);

function usage() {
  const text = `恒烈 CTF 工具箱 CLI（与 MCP 同一能力面）

命令：
  list     列 op          [--cat <分类>] [--keyword <词>] [--unsafe]
  schema   查 op 参数      --op <opId>
  detect   编码识别        --input <文本> | --file <路径>
  magic    一键解码        --input <文本> | --file <路径> [--crib <片段>] [--depth 3] [--intensive]
  run      跑 op           --op <opId> [--input <文本> | --file <路径> | --stdin]
                          [--direction encode|decode|run] [--param k=v ...]
                          [--out <目录>] [--base64] [--allow-over-limit]
                          产物 >128KB 时必须给 --out，否则显式报错（不静默丢内容）
  read     读本地文件      --file <路径> [--max-bytes N] [--encoding auto|utf8|hex|base64]

全局：--json（原始 MCP JSON 输出）
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
      if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
      else if (v === "true" || v === "false") v = v === "true";
      out.params[k] = v;
    } else {
      out[key] = val;
    }
  }
  return out;
}

async function sourceInput(args) {
  if (args.stdin) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString("base64");
  }
  if (args.file) return (await readFile(resolve(args.file))).toString("base64");
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

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv.shift();
  if (!cmd || cmd === "-h" || cmd === "--help") { usage(); return; }
  let args;
  try { args = parseArgs(argv); } catch (e) { process.stderr.write(String(e.message) + "\n"); usage(); process.exitCode = 2; return; }

  // --unsafe 恢复旧能力：只在当前 CLI 进程内设置宿主 env，mcpBridge 仍不认请求参数 allowUnsafe。
  if (args.unsafe) process.env.EBCTF_MCP_UNSAFE = "1";

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
    payload = { input: await sourceInput(args) };
    if (args.file) payload.input = (await readFile(resolve(args.file))).toString("utf8");
  } else if (cmd === "magic") {
    tool = "ebctf_magic_decode";
    payload = { input: args.file ? (await readFile(resolve(args.file))).toString("utf8") : await sourceInput(args), crib: args.crib };
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

  const r = await callMcpTool(tool, payload);
  if (args.json) process.stdout.write(JSON.stringify(r, null, 2) + "\n");
  else printResult(r);
}

try {
  await main();
} catch (e) {
  process.stderr.write(`cli: ${e && e.message ? e.message : e}\n`);
  process.exitCode = 1;
}

