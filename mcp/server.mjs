// ebctf stdio MCP server -- 让桌面 MCP 客户端（Claude Desktop / Cline 等）接入工具箱。
// 讲 JSON-RPC over stdio，转发到 core 的 callMcpTool。本地进程，零外发、无网络出口。
// 零外部依赖：裸 stdio 手写 JSON-RPC。装了官方 @modelcontextprotocol/sdk 可换更稳的实现。
//
// 用法（桌面客户端配置）：
//   { "mcpServers": { "ebctf-codebox": { "command": "node", "args": ["<项目路径>/mcp/server.mjs"] } } }
// 自测：
//   echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp/server.mjs
//
// ⚠ MCP stdio 协议要求 stdout 只承载 JSON-RPC 消息。core 加载期的诊断输出已统一走
//   src/core/debugLog.js（默认静默；设 EBCTF_DEBUG=1 输出到 stderr），stdout 全程干净，
//   这里不再需要劫持 process.stdout.write。
import { createInterface } from "node:readline";

const { callMcpTool, MCP_TOOLS, listMcpResources, readMcpResourceContents } = await import("./ebctf-core-adapter.mjs");
const { APP_VERSION } = await import("../src/core/version.js");
const realStdoutWrite = process.stdout.write.bind(process.stdout);

// 支持的 MCP 协议版本（本实现只用基础 tools/resources 面，这三版兼容；协商见 initialize）。
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const send = (msg) => realStdoutWrite(JSON.stringify(msg) + "\n");
const rl = createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  const text = line.trim();
  if (!text) return;
  let req;
  try { req = JSON.parse(text); } catch { return; }
  const { id, method, params } = req;
  const ok = (result) => send({ jsonrpc: "2.0", id, result });
  const err = (code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

  try {
    if (method === "initialize") {
      // 协议版本协商（MCP 规范）：客户端请求的版本在支持列表内 → 回同一版本；否则回基准版本。
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
    if (method === "notifications/initialized") return; // 通知无需回应
    if (method === "tools/list") return ok({ tools: MCP_TOOLS });
    if (method === "tools/call") {
      const { name, arguments: args } = params || {};
      return ok(await callMcpTool(name, args || {}));
    }
    if (method === "resources/list") return ok(listMcpResources());
    if (method === "resources/read") {
      const uri = params && params.uri;
      const contents = readMcpResourceContents(uri);
      if (!contents) return err(-32602, `无此资源：${uri}`);
      return ok(contents);
    }
    return err(-32601, `未实现方法：${method}`);
  } catch (e) {
    return err(-32603, e && e.message ? e.message : String(e));
  }
});
