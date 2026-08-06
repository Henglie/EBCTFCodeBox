/*
 * mcpBridge.js — MCP（Model Context Protocol）桥（可接入 mcp，数据给 AI 分析，软件给 AI 操作）。
 *
 * 定位：把工具箱能力（列 op / 查参数 / 识别 / 跑 op / 一键解码）按 MCP tools 规范暴露，
 * 让支持 MCP 的 AI 客户端（Claude Desktop、Cline、各类 MCP host）把本工具箱当工具服务器调用。
 *
 * 这里是能力面的唯一事实源：MCP_TOOLS + callMcpTool。
 * aiClient（浏览器内 AI 工具调用）、mcp/server.mjs（stdio server）、skills/（CLI）全部复用本文件，
 * 不重写任何解码逻辑，也不各自定义工具列表——加/改一个能力只动这里，三端同步。
 *
 * 纯前端能提供的 MCP 形态（两种，按部署环境择一）：
 * 1. 浏览器内 in-process：生成标准 MCP tools 描述 + 本地 dispatch，供页面内 AI 面板 / 插件直接调用
 *    （无需真起服务器，零外发，AI 操作全在本地执行）。这是默认能用的形态。
 * 2. 独立 stdio server：mcp/server.mjs 复用本文件的 callMcpTool，桌面客户端可 stdio 接入（需 Node）。
 *
 * 零外发红线：本桥不主动联网。它只是「描述 + 本地 dispatch」，网络出口只有 aiClient 用户自备通道。
 */
import { OPS, getOp, defaultParams, CATEGORIES, opsByCat } from "../core/registry.js";
import { magicDecode } from "../core/magic/magic.js";
import { APP_VERSION } from "../core/version.js";

// MCP server 版本与项目主版本统一（全局变量，避免割裂）。
const SERVER_VERSION = APP_VERSION;

// 虚拟/不宜对外单独暴露的 op（cryptoTryAll 是 UI 聚合入口，非独立算法）。统一口径，各处复用。
const HIDDEN_OP_IDS = new Set(["cryptoTryAll"]);

/** op 支持的方向数组（encode/decode/run）。 */
function opDirections(op) {
  return [op.encode && "encode", op.decode && "decode", op.run && "run"].filter(Boolean);
}

/** op 的对外精简视图（列表/schema 共用）。 */
function opBrief(op) {
  return {
    id: op.id,
    cat: op.cat,
    name: op.name,
    dir: opDirections(op),
    hasParams: (op.params || []).length > 0,
    requiresBridge: !!op.requiresBridge,
  };
}

/** op 的完整参数 schema（供 AI 知道该 op 有哪些参数、怎么填）。 */
function opSchema(op) {
  return {
    id: op.id,
    cat: op.cat,
    name: op.name,
    desc: op.desc || "",
    dir: opDirections(op),
    requiresBridge: !!op.requiresBridge,
    params: (op.params || []).map((p) => ({
      key: p.key,
      label: p.label,
      type: p.type,
      default: p.default,
      ...(p.options ? { options: p.options } : {}),
      ...(p.placeholder ? { placeholder: p.placeholder } : {}),
    })),
  };
}

/** 对外可见 op 集合（排除 cryptoTryAll 虚拟聚合 op）。列表/统计统一口径。 */
function visibleOps() {
  return OPS.filter((o) => !HIDDEN_OP_IDS.has(o.id));
}

/** 对外可见分类 + 每类 op 数（list_categories 工具与 categories 资源共用口径）。 */
function visibleCategories() {
  return CATEGORIES
    .filter((c) => c.id !== "home")
    .map((c) => ({ id: c.id, name: c.name, ops: opsByCat(c.id).filter((o) => !HIDDEN_OP_IDS.has(o.id)).length }));
}

// ---------------------------------------------------------------------------
// MCP tools 列表（JSON Schema inputSchema，符合 MCP 规范）。这是能力面的单一定义。
// ---------------------------------------------------------------------------
export const MCP_TOOLS = [
  {
    name: "ebctf_list_categories",
    description: "列出工具箱的功能分类（Base/文本/花式/古典/现代加密/哈希/进制/分析/隐写等），含每类 op 数量。用于先了解能力全景再下钻。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "ebctf_list_ops",
    description: "列出工具箱里所有编解码/加解密操作（op），可按关键词或分类过滤。每条含 id、分类、名称、支持方向(encode/decode/run)、是否带参。",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "名称/id/分类过滤词（可选）" },
        cat: { type: "string", description: "分类 id 精确过滤（可选，见 ebctf_list_categories）" },
      },
    },
  },
  {
    name: "ebctf_op_schema",
    description: "查询指定 op 的完整参数 schema（参数 key/类型/默认值/可选项）与支持的方向。跑带参 op 前先用它了解怎么填 params。",
    inputSchema: {
      type: "object",
      properties: { opId: { type: "string", description: "op 的 id" } },
      required: ["opId"],
    },
  },
  {
    name: "ebctf_detect",
    description: "智能识别：对一段文本跑全部带指纹的算法，返回按置信度(0~1)排序的可能编码/加密类型候选。用于判断「这是什么编码」，不做解码。",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string", description: "待识别的文本" },
        limit: { type: "number", description: "返回候选数上限（可选，默认 15）" },
      },
      required: ["input"],
    },
  },
  {
    name: "ebctf_run_op",
    description: "对输入执行指定 op 的编码/解码/运行，返回结果文本。支持传自定义参数（params，形状见 ebctf_op_schema）。",
    inputSchema: {
      type: "object",
      properties: {
        opId: { type: "string", description: "op 的 id（先用 ebctf_list_ops / ebctf_op_schema 查）" },
        input: { type: "string", description: "输入文本" },
        direction: { type: "string", enum: ["encode", "decode", "run"], description: "方向，缺省自动" },
        params: { type: "object", description: "自定义参数对象（可选，key 见 ebctf_op_schema；未给的用默认值）" },
      },
      required: ["opId", "input"],
    },
  },
  {
    name: "ebctf_magic_decode",
    description: "对疑似编码文本做一键智能解码，返回按可能性排序的候选明文与解码链路。可开多层链式解码与暴力模式。",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string", description: "疑似被编码的文本" },
        crib: { type: "string", description: "已知明文片段/正则用于命中加权（可选，如 flag\\{）" },
        maxDepth: { type: "number", description: "最大解码层数（可选，默认 1；多层链式解码传 3）" },
        intensive: { type: "boolean", description: "是否开 1-byte XOR + 位旋转暴力（可选，默认 false）" },
      },
      required: ["input"],
    },
  },
];

// ---------------------------------------------------------------------------
// 本地 dispatch：执行一个 MCP 工具调用，返回 MCP 规范的 content 结果。
// @returns {Promise<{content:{type:string,text:string}[], isError?:boolean}>}
// ---------------------------------------------------------------------------
export async function callMcpTool(name, args = {}) {
  const wrap = (text, isError = false) => ({ content: [{ type: "text", text: String(text) }], isError });
  const json = (obj) => wrap(JSON.stringify(obj, null, 2));
  try {
    if (name === "ebctf_list_categories") {
      return json(visibleCategories());
    }

    if (name === "ebctf_list_ops") {
      const kw = (args.keyword || "").toLowerCase();
      const cat = (args.cat || "").trim();
      const list = visibleOps()
        .filter((o) => !cat || o.cat === cat)
        .filter((o) => !kw
          || o.id.toLowerCase().includes(kw)
          || (o.name || "").toLowerCase().includes(kw)
          || o.cat.includes(kw))
        .map(opBrief);
      return json({ count: list.length, ops: list });
    }

    if (name === "ebctf_op_schema") {
      const op = getOp(args.opId);
      if (!op || HIDDEN_OP_IDS.has(op.id)) return wrap(`无此 op: ${args.opId}`, true);
      return json(opSchema(op));
    }

    if (name === "ebctf_detect") {
      const input = String(args.input ?? "");
      if (!input) return wrap("（空输入）", true);
      const limit = Number.isFinite(args.limit) && args.limit > 0 ? Math.min(args.limit, 50) : 15;
      const hits = [];
      for (const op of visibleOps()) {
        if (op.requiresBridge || typeof op.detect !== "function") continue;
        let score = 0;
        try { score = Number(op.detect(input)) || 0; } catch { score = 0; }
        if (score > 0) hits.push({ id: op.id, cat: op.cat, name: op.name, confidence: Math.round(score * 100) / 100 });
      }
      hits.sort((a, b) => b.confidence - a.confidence);
      return json({ count: Math.min(hits.length, limit), candidates: hits.slice(0, limit) });
    }

    if (name === "ebctf_run_op") {
      const op = getOp(args.opId);
      if (!op || HIDDEN_OP_IDS.has(op.id)) return wrap(`无此 op: ${args.opId}`, true);
      const dir = args.direction || (op.run ? "run" : op.decode ? "decode" : "encode");
      if (typeof op[dir] !== "function") return wrap(`op ${args.opId} 不支持方向 ${dir}`, true);
      // 默认参数打底，AI 传的 params 覆盖对应 key（未给的保持默认）。
      const p = { ...defaultParams(op), ...(args.params && typeof args.params === "object" ? args.params : {}) };
      const out = await op[dir](String(args.input ?? ""), p);
      return wrap(String(out));
    }

    if (name === "ebctf_magic_decode") {
      const opts = { crib: args.crib || null };
      if (Number.isFinite(args.maxDepth)) opts.maxDepth = Math.max(1, Math.min(args.maxDepth, 3));
      if (typeof args.intensive === "boolean") opts.intensive = args.intensive;
      const cands = await magicDecode(String(args.input ?? ""), opts);
      if (!cands.length) return wrap("（无候选）");
      const text = cands.slice(0, 10)
        .map((c, i) => `#${i + 1} [${c.chain.join(" > ") || "原文"}] conf=${(c.confidence * 100).toFixed(0)}% : ${c.result.slice(0, 300)}`)
        .join("\n");
      return wrap(text);
    }

    return wrap(`未知工具：${name}`, true);
  } catch (e) {
    return wrap(`执行出错：${e && e.message ? e.message : e}`, true);
  }
}

// ---------------------------------------------------------------------------
// MCP resources 列表（符合 MCP 规范的 resource 描述符）。这是资源面的单一事实源：
// resources/list、exportManifest 全都读它，改一处三端同步，绝不各处手写第二份。
// 每条附一个 build()：resources/read 时本地现算内容（纯只读快照，零外发）。
// ---------------------------------------------------------------------------
const MCP_RESOURCES = [
  {
    uri: "ebctf://ops",
    name: "全部 op 清单",
    description: "工具箱当前对外可见的全部编解码/加解密操作（id/分类/名/方向/是否带参），AI 可一次拿全景再下钻。",
    mimeType: "application/json",
    build: () => JSON.stringify({ count: visibleOps().length, ops: visibleOps().map(opBrief) }, null, 2),
  },
  {
    uri: "ebctf://categories",
    name: "分类清单",
    description: "功能分类（Base/文本/花式/古典/现代加密/哈希/进制/分析/隐写等），含每类 op 数量。",
    mimeType: "application/json",
    build: () => JSON.stringify(visibleCategories(), null, 2),
  },
  {
    uri: "ebctf://guide",
    name: "解题引导 · 怎么用这套工具解 CTF",
    description: "推荐流程与工具选型建议：先 detect 识别，再 magic_decode 一键解，不行才 list_ops/op_schema 找具体算法带参跑。",
    mimeType: "text/markdown",
    build: () => GUIDE_TEXT,
  },
];

// 解题引导正文（供 ebctf://guide 资源返回）。写成 AI 能直接照做的操作序列，不空谈。
const GUIDE_TEXT = `# 用恒烈CTF编码工具箱解题的推荐流程

面对一段看不懂的密文/编码，按下面顺序走，多数编码题一两步就能出结果。

## 1. 先识别（不确定是什么编码时）
调 \`ebctf_detect\`，传 input=密文。返回按置信度(0~1)排序的候选类型，看看它像什么。
这一步只判类型、不解码，用来缩小范围。

## 2. 一键智能解码（最省事，优先试）
调 \`ebctf_magic_decode\`，传 input=密文。它会自动尝试多种编码并按可能性排序返回候选明文与解码链路。
- 知道 flag 前缀时传 \`crib\`（如 \`flag\\{\`）加权命中，结果更准。
- 怀疑是多层套娃（base 套 base、编码套编码）时传 \`maxDepth: 3\` 开多层链式解码。
- 怀疑单字节 XOR / 位旋转时传 \`intensive: true\` 开暴力（较慢，非必要不开）。

## 3. 指定算法带参跑（前两步不出、或已知具体算法时）
- 先 \`ebctf_list_categories\` 看能力全景，或 \`ebctf_list_ops\`（可带 keyword/cat 过滤）找到目标 op 的 id。
- 带参数的 op（hasParams=true）先调 \`ebctf_op_schema\`（传 opId）看清参数 key/类型/默认值/可选项。
- 再调 \`ebctf_run_op\`（opId + input + 可选 direction/params）执行编码/解码。
  direction 缺省会自动选（有 run 用 run，否则 decode，再否则 encode）；params 只需传要改的 key，其余走默认。

## 经验
- 古典密码（凯撒/维吉尼亚/栅栏等）常需爆破或试参数，配合 analysis 分类里的爆破 op。
- 结果仍是乱码就回到第 1 步对新结果再 detect，往往是套了多层。
- 资源 \`ebctf://ops\` 给全量 op 清单、\`ebctf://categories\` 给分类概览，可先读它们建立全局认知。`;

/** 按 uri 读取一个资源内容，命中返回 MCP 规范的 contents 项，未命中返回 null。 */
function readMcpResource(uri) {
  const res = MCP_RESOURCES.find((r) => r.uri === uri);
  if (!res) return null;
  return { uri: res.uri, mimeType: res.mimeType, text: res.build() };
}

/** resources/list 用的纯描述符（去掉内部 build，只留对外字段）。exportManifest 也复用它。 */
function resourceDescriptors() {
  return MCP_RESOURCES.map(({ uri, name, description, mimeType }) => ({ uri, name, description, mimeType }));
}

// resources/list 与 resources/read 的可复用实现（in-process 与 stdio server 共用，逻辑不重写）。
export function listMcpResources() {
  return { resources: resourceDescriptors() };
}
export function readMcpResourceContents(uri) {
  const item = readMcpResource(uri);
  if (!item) return null;
  return { contents: [item] };
}

/**
 * 处理一条 MCP JSON-RPC 请求（in-process 形态）。
 * 支持 initialize / tools/list / tools/call / resources/list / resources/read。
 * 让页面内或插件内的 MCP host 能直接喂请求、拿响应，无需真的开网络端口。
 * @param {{id?:any, method:string, params?:object}} req
 */
export async function handleMcpRequest(req) {
  const { id, method, params } = req || {};
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

  if (method === "initialize") {
    return ok({
      protocolVersion: "2024-11-05",
      capabilities: { tools: {}, resources: {} },
      serverInfo: { name: "ebctf-codebox", version: SERVER_VERSION },
    });
  }
  if (method === "tools/list") {
    return ok({ tools: MCP_TOOLS });
  }
  if (method === "tools/call") {
    const { name, arguments: args } = params || {};
    const result = await callMcpTool(name, args || {});
    return ok(result);
  }
  if (method === "resources/list") {
    return ok(listMcpResources());
  }
  if (method === "resources/read") {
    const uri = params && params.uri;
    const contents = readMcpResourceContents(uri);
    if (!contents) return err(-32602, `无此资源：${uri}`);
    return ok(contents);
  }
  return err(-32601, `未实现的方法：${method}`);
}

/**
 * 生成一份可粘进桌面 MCP 客户端配置的片段（stdio server 用法引导）。
 * 纯前端不能直接开 stdio，这里给出用户自建本地 server 时的工具定义，属可选高级用法。
 */
export function configForStdioServer() {
  return {
    note: "纯前端浏览器环境用 handleMcpRequest(jsonrpc) 做 in-process 调用即可。若要让桌面 Claude 等通过 stdio 连接，运行 mcp/server.mjs（转发到本文件 callMcpTool）。",
    tools: MCP_TOOLS,
  };
}

/**
 * 导出一份自包含 MCP 接入清单（供插件面板「导出」按钮下载 JSON）。
 * 只读快照 + 接入引导，纯前端本地生成，不联网。tools 复用 MCP_TOOLS 单一事实源，
 * stats.ops 与 callMcpTool 同口径（排除 cryptoTryAll 虚拟 op）。
 */
export function exportManifest() {
  const opCount = visibleOps().length;
  return {
    schemaVersion: "2024-11-05",
    server: {
      name: "ebctf-codebox",
      version: SERVER_VERSION,
      description: "恒烈CTF编码工具箱 · 编解码/加解密/智能识别/一键智能解码能力面",
      vendor: "Henglie / EBCTFCodeBox",
      homepage: "https://github.com/Henglie/EBCTFCodeBox",
    },
    capabilities: { tools: {}, resources: {} },
    tools: MCP_TOOLS,
    resources: resourceDescriptors(),
    stats: { ops: opCount, categories: CATEGORIES.length },
    usage: {
      inProcess: "浏览器内调 handleMcpRequest(jsonrpc) 即可，零外发无端口。",
      stdio: "桌面 MCP 客户端（Claude Desktop 等）走 Node stdio server，见 mcp/README.md。",
      config: {
        mcpServers: {
          "ebctf-codebox": { command: "node", args: ["<项目路径>/mcp/server.mjs"] },
        },
      },
    },
  };
}
