// ebctf stdio MCP server -- 让桌面 MCP 客户端（Claude Desktop / Cline 等）接入工具箱。
// 讲 JSON-RPC over stdio，转发到 core 的 callMcpTool。本地进程，零外发、无网络出口。
// 零外部依赖：裸 stdio 手写 JSON-RPC。装了官方 @modelcontextprotocol/sdk 可换更稳的实现。
//
// 用法（桌面客户端配置）：
//   { "mcpServers": { "ebctf-codebox": { "command": "node", "args": ["<项目路径>/mcp/server.mjs"] } } }
// 自测：
//   echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp/server.mjs
//
// ⚠ MCP stdio 协议要求 stdout 只承载 JSON-RPC 消息。core 的 detectExt 等模块加载时
//   会往 stdout 打日志（console.log/debug 等，污染协议流）。故在加载 core 期间直接劫持
//   process.stdout.write 转 stderr（无论用哪种 console 方法都拦得住），加载完恢复。
//   用动态 import 保证「先劫持、后加载 core」的顺序（静态 import 会提升先执行）。
import { createInterface } from "node:readline";

const realStdoutWrite = process.stdout.write.bind(process.stdout);
// 加载 core 期间：stdout 全部改道 stderr，杜绝启动日志污染协议流。
process.stdout.write = (chunk, ...rest) => process.stderr.write(chunk, ...rest);

const { callMcpTool, MCP_TOOLS, listMcpResources, readMcpResourceContents } = await import("./ebctf-core-adapter.mjs");

// core 加载完毕，恢复真实 stdout，之后只走 send() 写 JSON-RPC。
process.stdout.write = realStdoutWrite;

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
      return ok({
        protocolVersion: "2024-11-05",
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: "ebctf-codebox", version: "0.1.1" },
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
