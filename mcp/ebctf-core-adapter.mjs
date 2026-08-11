/*
 * ebctf-core-adapter.mjs — Node 侧统一入口。
 *
 * 加载全量注册表（registerAll.js，Worker/Node 共用的副作用注册 barrel）后，
 * 转发到浏览器同款 callMcpTool —— core 是纯函数、Node 可跑，绝不重写解码逻辑（单一事实源）。
 *
 * 零外发红线：本适配只在本地进程内 import + dispatch，无任何网络出口。
 */
import "../src/core/registerAll.js"; // 副作用注册：Worker/Node 共用注册表，当前 581 op
export { callMcpTool, MCP_TOOLS, exportManifest, listMcpResources, readMcpResourceContents } from "../src/plugin/mcpBridge.js";
