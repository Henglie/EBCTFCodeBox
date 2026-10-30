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
import { productFileEntries } from "../core/productResult.js";

// MCP server 版本与项目主版本统一（全局变量，避免割裂）。
const SERVER_VERSION = APP_VERSION;

// 虚拟/不宜对外单独暴露的 op（cryptoTryAll 是 UI 聚合入口，非独立算法）。统一口径，各处复用。
const HIDDEN_OP_IDS = new Set(["cryptoTryAll"]);
// jsfuck/jjencode 的 decode 会用 new Function 执行输入里的 JS：MCP 主进程无沙箱，
// AI 提示注入可借此执行任意 Node 代码。默认不暴露；调用方显式传 allowUnsafe:true
// （或设置 EBCTF_MCP_UNSAFE=1）才放开，并在结果里明确标注风险。
const UNSAFE_OP_IDS = new Set(["jsfuck", "jjencode"]);
function includeUnsafe(args) {
  return !!(args && (args.allowUnsafe === true || args.includeUnsafe === true)) || (typeof process !== "undefined" && process.env && process.env.EBCTF_MCP_UNSAFE === "1");
}
function opVisible(op, unsafe = false) {
  if (!op || HIDDEN_OP_IDS.has(op.id)) return false;
  return unsafe || !UNSAFE_OP_IDS.has(op.id);
}

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

/** 对外可见 op 集合（默认排除 cryptoTryAll 与 JS 执行类；unsafe 时放开 JS 执行类）。 */
function visibleOps(unsafe = false) {
  return OPS.filter((o) => opVisible(o, unsafe));
}

/** 对外可见分类 + 每类 op 数（list_categories 工具与 categories 资源共用口径）。 */
function visibleCategories(unsafe = false) {
  return CATEGORIES
    .filter((c) => c.id !== "home")
    .map((c) => ({ id: c.id, name: c.name, ops: opsByCat(c.id).filter((o) => opVisible(o, unsafe)).length }));
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
    description: "列出工具箱里所有编解码/加解密操作（op），可按关键词或分类过滤。每条含 id、分类、名称、支持方向(encode/decode/run)、是否带参。默认隐藏 JS 执行类；需要时传 includeUnsafe:true。",
    inputSchema: {
      type: "object",
      properties: {
        keyword: { type: "string", description: "名称/id/分类过滤词（可选）" },
        cat: { type: "string", description: "分类 id 精确过滤（可选，见 ebctf_list_categories）" },
        includeUnsafe: { type: "boolean", description: "是否列出 jsfuck/jjencode 等会执行输入代码的高风险 op（默认 false）" },
      },
    },
  },
  {
    name: "ebctf_op_schema",
    description: "查询指定 op 的完整参数 schema（参数 key/类型/默认值/可选项）与支持的方向。跑带参 op 前先用它了解怎么填 params。",
    inputSchema: {
      type: "object",
      properties: {
        opId: { type: "string", description: "op 的 id" },
        includeUnsafe: { type: "boolean", description: "允许查询 jsfuck/jjencode 等高风险 op（默认 false）" },
      },
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
    description:
      "对输入执行指定 op。统一文件通道：文本走 input，图片/pcap/zip/pyc/exe 等二进制走 fileBase64 或 filePath；" +
      "产物文件会以 base64 返回，也可用 outputDir 直接落盘并返回路径。支持传自定义参数（params，形状见 ebctf_op_schema）。",
    inputSchema: {
      type: "object",
      properties: {
        opId: { type: "string", description: "op 的 id（先用 ebctf_list_ops / ebctf_op_schema 查）" },
        input: { type: "string", description: "输入文本（文本类 op 用；与 fileBase64/filePath 二选一或同时给）" },
        fileBase64: { type: "string", description: "二进制输入：文件内容的 base64（图片/pcap/zip/pyc/exe 等）" },
        filePath: { type: "string", description: "二进制输入：本机文件路径（仅 stdio MCP server / Node 环境可读）" },
        inputEncoding: {
          type: "string", enum: ["auto", "utf8", "hex", "base64"],
          description: "文件转文本的编码（非 acceptsBytes op 使用；默认 auto：优先 UTF-8，失败则报错）",
        },
        fileName: { type: "string", description: "可选文件名（用于产物命名/报告）" },
        direction: { type: "string", enum: ["encode", "decode", "run"], description: "方向，缺省自动" },
        params: { type: "object", description: "自定义参数对象（可选，key 见 ebctf_op_schema；未给的用默认值）" },
        outputDir: { type: "string", description: "可选：把产物文件写入该本地目录，返回绝对路径（MCP 文件类 op 推荐）" },
        includeBase64: { type: "boolean", description: "产物是否同时返回 base64（默认：小文件 true，超过 256KB false）" },
        allowUnsafe: { type: "boolean", description: "允许执行 jsfuck/jjencode 等会 new Function 输入的高风险 op（默认 false）" },
      },
      required: ["opId"],
    },
  },
  {
    name: "ebctf_read_file",
    description: "读取本机文件供 AI 检查（图片/pcap/zip/pyc/exe 等）。返回大小、猜测 MIME、sha256 与内容；默认按 UTF-8/hex 自动选择，二进制给 base64。仅本地 stdio server / Node 环境可用。",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "本机文件绝对路径（或相对当前工作目录）" },
        maxBytes: { type: "number", description: "最多读取字节数（默认 1 MiB，上限 8 MiB）" },
        encoding: { type: "string", enum: ["auto", "utf8", "hex", "base64"], description: "内容编码（默认 auto）" },
      },
      required: ["path"],
    },
  },
  {
    name: "ebctf_magic_decode",
    description: "对疑似编码文本做一键智能解码，返回按可能性排序的候选明文与解码链路。可开多层链式解码与暴力模式。二进制文件先用 ebctf_read_file 或 ebctf_run_op 处理。",
    inputSchema: {
      type: "object",
      properties: {
        input: { type: "string", description: "疑似被编码的文本" },
        crib: { type: "string", description: "已知明文字面片段用于命中加权（可选，如 flag{；不执行正则）" },
        maxDepth: { type: "number", description: "最大解码层数（可选，默认 1；多层链式解码传 3）" },
        intensive: { type: "boolean", description: "是否开 1-byte XOR + 位旋转暴力（可选，默认 false）" },
      },
      required: ["input"],
    },
  },
];

// ---------------------------------------------------------------------------
// 统一文件通道：base64 / 本地路径 → 字节；产物 → base64 或落盘。
// 浏览器 in-process 形态没有 fs，filePath/outputDir 会返回明确错误，不静默。
// ---------------------------------------------------------------------------
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const INLINE_BASE64_LIMIT = 256 * 1024;

function b64ToBytes(b64) {
  const clean = String(b64 || "").replace(/\s+/g, "");
  if (!clean) return new Uint8Array(0);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error("fileBase64 不是合法 base64");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function isNodeEnv() {
  return typeof process !== "undefined" && !!(process.versions && process.versions.node);
}

async function nodeFs() {
  if (!isNodeEnv()) throw new Error("filePath/outputDir 只在本地 Node（stdio MCP server）可用；浏览器内请改用 fileBase64");
  return import("node:fs/promises");
}

async function readInputBytes(args) {
  if (args.fileBase64 != null && String(args.fileBase64).length) {
    const bytes = b64ToBytes(args.fileBase64);
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`fileBase64 超过 ${MAX_FILE_BYTES} 字节上限`);
    return bytes;
  }
  if (args.filePath) {
    const fs = await nodeFs();
    const st = await fs.stat(args.filePath);
    if (!st.isFile()) throw new Error(`不是文件：${args.filePath}`);
    if (st.size > MAX_FILE_BYTES) throw new Error(`文件超过 ${MAX_FILE_BYTES} 字节上限：${st.size}`);
    return new Uint8Array(await fs.readFile(args.filePath));
  }
  return null;
}

function bytesToText(bytes, encoding = "auto") {
  if (encoding === "hex") return bytesToHex(bytes);
  if (encoding === "base64") return bytesToB64(bytes);
  if (encoding === "utf8") {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { return new TextDecoder("utf-8", { fatal: false }).decode(bytes); }
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return null; }
}

function guessMime(bytes) {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return "application/zip";
  if (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  if (bytes.length > 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return "application/x-elf";
  if (bytes.length > 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return "application/x-msdownload";
  if (bytes.length > 4 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return "application/octet-stream";
  return "application/octet-stream";
}

async function sha256Hex(bytes) {
  try {
    if (globalThis.crypto && globalThis.crypto.subtle) {
      const d = await globalThis.crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch { /* ignore */ }
  return "";
}

async function saveProductFiles(files, outputDir) {
  const fs = await nodeFs();
  const path = await import("node:path");
  await fs.mkdir(outputDir, { recursive: true });
  const base = path.resolve(outputDir);
  const saved = [];
  for (const f of files) {
    const safe = path.basename(String(f.name || "download.bin")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "download.bin";
    const full = path.resolve(base, safe);
    if (!full.startsWith(base + path.sep) && full !== base) throw new Error(`产物文件名越界：${f.name}`);
    await fs.writeFile(full, f.bytes);
    saved.push({ ...f, name: safe, path: full });
  }
  return saved;
}

// ---------------------------------------------------------------------------
// 本地 dispatch：执行一个 MCP 工具调用，返回 MCP 规范的 content 结果。
// @returns {Promise<{content:{type:string,text:string}[], isError?:boolean}>}
// ---------------------------------------------------------------------------
export async function callMcpTool(name, args = {}) {
  const wrap = (text, isError = false) => ({ content: [{ type: "text", text: String(text) }], isError });
  const json = (obj) => wrap(JSON.stringify(obj, null, 2));
  try {
    if (name === "ebctf_list_categories") {
      return json(visibleCategories(includeUnsafe(args)));
    }

    if (name === "ebctf_list_ops") {
      const kw = (args.keyword || "").toLowerCase();
      const cat = (args.cat || "").trim();
      const list = visibleOps(includeUnsafe(args))
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
      if (!op || !opVisible(op, includeUnsafe(args))) return wrap(`无此 op: ${args.opId}`, true);
      return json(opSchema(op));
    }

    if (name === "ebctf_detect") {
      const input = String(args.input ?? "");
      if (!input) return wrap("（空输入）", true);
      const limit = Number.isFinite(args.limit) && args.limit > 0 ? Math.min(args.limit, 50) : 15;
      const hits = [];
      for (const op of visibleOps(false)) {
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
      if (!op || !opVisible(op, includeUnsafe(args))) return wrap(`无此 op: ${args.opId}`, true);
      const dir = args.direction || (op.run ? "run" : op.decode ? "decode" : "encode");
      if (typeof op[dir] !== "function") return wrap(`op ${args.opId} 不支持方向 ${dir}`, true);
      const bytes = await readInputBytes(args);
      let input = args.input == null ? "" : String(args.input);
      if (bytes) {
        if (op.acceptsBytes) {
          if (!input) input = bytesToText(bytes, "auto") || "";
        } else if (!input) {
          const enc = args.inputEncoding || "auto";
          const t = bytesToText(bytes, enc);
          if (t == null) {
            return wrap(
              `op ${args.opId} 不吃原始字节，且文件不是合法 UTF-8。请传 inputEncoding:"hex" 或 "base64"，` +
              `或改用 acceptsBytes 的文件类 op（先在 ebctf_op_schema 看该 op 是否有 acceptsBytes/file 通道）。`, true);
          }
          input = t;
        }
      }
      // 默认参数打底，AI 传的 params 覆盖对应 key（未给的保持默认）。
      const p = { ...defaultParams(op), ...(args.params && typeof args.params === "object" ? args.params : {}) };
      if (bytes && op.acceptsBytes) p.rawBytes = bytes;
      const out = await op[dir](input, p);
      if (out && typeof out === "object" && ("text" in out || "files" in out)) {
        const text = String(out.text ?? "");
        const files = productFileEntries(out);
        if (!files.length) return wrap(text);
        const total = files.reduce((n, f) => n + f.bytes.length, 0);
        let saved = files;
        if (args.outputDir) saved = await saveProductFiles(files, args.outputDir);
        const inline = args.includeBase64 === true || (args.includeBase64 !== false && total <= INLINE_BASE64_LIMIT && !args.outputDir);
        const payload = [];
        for (const f of saved) {
          const item = {
            name: f.name, mime: f.mime, size: f.bytes.length,
            sha256: await sha256Hex(f.bytes),
          };
          if (f.path) item.path = f.path;
          if (inline) item.base64 = bytesToB64(f.bytes);
          payload.push(item);
        }
        return json({ text, files: payload, ...(args.outputDir ? { outputDir: args.outputDir } : {}) });
      }
      return wrap(out == null ? "" : String(out));
    }

    if (name === "ebctf_read_file") {
      const fs = await nodeFs();
      const st = await fs.stat(args.path);
      if (!st.isFile()) return wrap(`不是文件：${args.path}`, true);
      const limit = Math.max(1, Math.min(Number(args.maxBytes) || 1024 * 1024, 8 * 1024 * 1024));
      const bytes = new Uint8Array(await fs.readFile(args.path));
      const slice = bytes.subarray(0, limit);
      const enc = args.encoding || "auto";
      let content = bytesToText(slice, enc);
      let used = enc;
      if (content == null) { content = bytesToB64(slice); used = "base64"; }
      return json({
        path: args.path, size: bytes.length, readBytes: slice.length, truncated: bytes.length > slice.length,
        mime: guessMime(bytes), encoding: used, sha256: await sha256Hex(bytes), content,
      });
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
- 知道 flag 前缀时传 \`crib\`（如 \`flag{\`）按字面加权，不执行正则。
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



