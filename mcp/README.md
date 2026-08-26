# EBCTF MCP 接入

把恒烈CTF编码工具箱的能力（列分类 / 列 op / 查参数 / 智能识别 / 跑 op / 一键智能解码）暴露成 MCP 工具，供支持 MCP 的 AI 客户端（Claude Desktop、Cline 等）调用。全程本地进程，零外发。

server 版本 `0.1.5`，对外可见 op 608 个。`ebctf_list_categories` 列出 16 个功能分类（注册表 `CATEGORIES` 共 17 项，含 `home` 首页；首页不计入功能分类）。

## 文件

- `server.mjs` — Node stdio MCP server，讲 JSON-RPC over stdio，转发到 core 的 `callMcpTool`。支持 `initialize` / `tools/list` / `tools/call`。
- `ebctf-core-adapter.mjs` — 薄适配层，加载全量注册表后转出浏览器同款 `callMcpTool` / `MCP_TOOLS` / `exportManifest`。

单一事实源是 `src/plugin/mcpBridge.js` 的 `MCP_TOOLS` + `callMcpTool`。Node 侧不重写任何解码逻辑，只复用 core 纯函数；浏览器内 AI、mcp server、skills 三端共用同一份能力定义，加/改一个能力只动 `mcpBridge.js`。

## 六个工具

| 工具 | 参数 | 用途 |
|------|------|------|
| `ebctf_list_categories` | 无 | 列出功能分类，每类含 op 数量。先了解能力全景再下钻。 |
| `ebctf_list_ops` | `keyword?`、`cat?` | 列 op，可按关键词或分类过滤。每条含 id、分类、名称、支持方向(encode/decode/run)、是否带参。 |
| `ebctf_op_schema` | `opId` | 查指定 op 的完整参数 schema（key/类型/默认值/可选项）与支持方向。跑带参 op 前先用它。 |
| `ebctf_detect` | `input`、`limit?`（默认 15） | 智能识别：对文本跑全部带指纹的算法，返回按置信度(0~1)排序的候选编码/加密类型，不做解码。 |
| `ebctf_run_op` | `opId`、`input`、`direction?`、`params?` | 对输入执行指定 op 的 encode/decode/run，支持传自定义参数（形状见 `ebctf_op_schema`，未给的用默认值）。 |
| `ebctf_magic_decode` | `input`、`crib?`、`maxDepth?`（默认 1，多层传 3）、`intensive?`（默认 false） | 一键智能解码，返回按可能性排序的候选明文与解码链路。可开多层链式解码与 1-byte XOR / 位旋转暴力。 |

## 一键接入（推荐）

项目根 `点我启动.py` 已内置 MCP 两个模式，无需手抄路径：

```
py 点我启动.py --mcp-config   # 打印各客户端接入配置（已填好本机绝对路径），照抄即可
py 点我启动.py --mcp          # 直接跑 MCP stdio server（供手动调试 / 客户端 command 指本脚本）
```

`--mcp-config` 会输出 Claude Code / Cursor / Trae / Codex / Cline / Claude Desktop 通用的
`mcpServers` JSON 块，并列出各客户端配置文件位置。stdio MCP 由客户端自行拉起子进程，
用户不需要常驻服务——把打印出来的 JSON 填进对应客户端配置即可。

`--mcp` 会自动定位 node（PATH 优先，落空则扫 `C:\Program Files\nodejs` 等常见安装位置），
经 subprocess 直通 stdin/stdout 跑 `server.mjs`，退出码透传。正常接入建议客户端 `command`
直接指 node + `server.mjs`（见下），`--mcp` 主要用于本地自测。

## 接入 Claude Desktop

在 Claude Desktop 的 MCP 配置里加：

```json
{
  "mcpServers": {
    "ebctf-codebox": {
      "command": "node",
      "args": ["<项目路径>/mcp/server.mjs"]
    }
  }
}
```

`<项目路径>` 换成本项目根目录的绝对路径。重启客户端后即可让 AI 调用工具箱。

## 自测

列工具：

```
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node mcp/server.mjs
```

应返回 6 个 tool。再测一次解码：

```
echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ebctf_run_op","arguments":{"opId":"base64","input":"SGVsbG8=","direction":"decode"}}}' | node mcp/server.mjs
```

## 零外发红线

stdio server 是本地进程，AI 客户端 ↔ 本地 server 走 stdio，无网络出口。复用的 core 全是纯函数，不联网、不上传任何数据。
