/*
 * recipes.js — recipe 预设配方库（T84）
 *
 * 依赖 recipe.js（topoSort）+ registry.js（getOp）。
 * 件内自注册：无（纯数据 + 工具函数，无加载副作用）。
 *
 * 导出：
 * PRESETS — 预设配方数组，每项 {id, name, desc, graph}
 * executeRecipeAsync — 异步版执行器（支持 gzipCodec 等异步 op）
 * executeRecipe — 同步版执行器（re-export 自 recipe.js，仅同步 op）
 * validateRecipe — 校验（re-export 自 recipe.js）
 * topoSort — 拓扑排序（re-export 自 recipe.js）
 */
import { topoSort, executeRecipe, validateRecipe } from "./recipe.js";
import { getOp } from "./registry.js";

// ---- 异步执行器（支持 async op）----

async function runNodeAsync(node, inputText) {
  const op = getOp(node.opId);
  if (!op) throw new Error(`unknown opId: ${node.opId}`);
  const params = node.params || {};
  const mode = params.mode;
  let result;
  if (mode === "decode") {
    if (typeof op.decode !== "function")
      throw new Error(`op ${node.opId} has no decode`);
    result = op.decode(inputText, params);
  } else if (mode === "encode") {
    if (typeof op.encode !== "function")
      throw new Error(`op ${node.opId} has no encode`);
    result = op.encode(inputText, params);
  } else if (mode === "run") {
    if (typeof op.run !== "function")
      throw new Error(`op ${node.opId} has no run`);
    result = op.run(inputText, params);
  } else {
    if (typeof op.encode === "function") result = op.encode(inputText, params);
    else if (typeof op.run === "function") result = op.run(inputText, params);
    else throw new Error(`op ${node.opId} has no encode/run to default to`);
  }
  return await result;
}

/**
 * 异步版 executeRecipe。与 recipe.js 的 executeRecipe 逻辑一致
 * 但用 await 调用节点执行函数，支持 async op（gzipCodec/zlibCodec 等）。
 * @param {{nodes:Array,edges:Array}} graph
 * @param {string} input
 */
export async function executeRecipeAsync(graph, input) {
  const order = topoSort(graph);
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const inEdges = new Map();
  const outCount = new Map();
  for (const n of graph.nodes) {
    inEdges.set(n.id, []);
    outCount.set(n.id, 0);
  }
  for (const e of graph.edges) {
    if (inEdges.has(e.to)) inEdges.get(e.to).push(e);
    if (outCount.has(e.from)) outCount.set(e.from, outCount.get(e.from) + 1);
  }

  const outputs = new Map();
  for (const id of order) {
    const node = nodeMap.get(id);
    const incoming = inEdges.get(id) || [];
    let inputText;
    if (incoming.length === 0) {
      inputText = input == null ? "" : String(input);
    } else {
      const join = (node.params && node.params.join) || "";
      inputText = incoming
        .map((e) => (outputs.has(e.from) ? outputs.get(e.from) : ""))
        .join(join);
    }
    outputs.set(id, await runNodeAsync(node, inputText));
  }

  const finals = graph.nodes
    .map((n) => n.id)
    .filter((id) => (outCount.get(id) || 0) === 0);
  if (finals.length === 0) return outputs.get(order[order.length - 1]);
  if (finals.length === 1) return outputs.get(finals[0]);
  const result = {};
  for (const id of finals) result[id] = outputs.get(id);
  return result;
}

// ---- 预设配方 ----
// opId 均已核对存在于 registry（扫描 362 op 确认）。
// 每个配方标注 [sync]/[async]，供调用方选择 executeRecipe / executeRecipeAsync。

export const PRESETS = [
  {
    id: "double-base64",
    name: "双重 Base64 解码",
    desc: "两次 Base64 解码（CTF 常见嵌套编码）",
    async: false,
    graph: {
      nodes: [
        { id: "n1", opId: "base64", params: { mode: "decode" } },
        { id: "n2", opId: "base64", params: { mode: "decode" } },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
  },
  {
    id: "url-then-base64",
    name: "URL 解码 → Base64 解码",
    desc: "先 URL 解码，再 Base64 解码出原文",
    async: false,
    graph: {
      nodes: [
        { id: "n1", opId: "url", params: { mode: "decode" } },
        { id: "n2", opId: "base64", params: { mode: "decode" } },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
  },
  {
    id: "base32-to-base64",
    name: "Base32 解码 → Base64 编码",
    desc: "Base32 解码后重新编码为 Base64",
    async: false,
    graph: {
      nodes: [
        { id: "n1", opId: "base32", params: { mode: "decode" } },
        { id: "n2", opId: "base64", params: { mode: "encode" } },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
  },
  {
    id: "hex-to-md5",
    name: "Hex 解码 → MD5",
    desc: "Hex 解码出文本后求 MD5",
    async: false,
    graph: {
      nodes: [
        { id: "n1", opId: "base16", params: { mode: "decode" } },
        { id: "n2", opId: "md5", params: { mode: "run" } },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
  },
  {
    id: "atbash-caesar3",
    name: "Atbash → Caesar(-3) 双重解密",
    desc: "Atbash 反转后凯撒位移 -3 解密",
    async: false,
    graph: {
      nodes: [
        { id: "n1", opId: "atbash", params: { mode: "decode" } },
        { id: "n2", opId: "caesar", params: { mode: "decode", shift: 3 } },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
  },
  {
    id: "html-then-url",
    name: "HTML 实体 → URL 解码",
    desc: "HTML 实体解码后 URL 解码",
    async: false,
    graph: {
      nodes: [
        { id: "n1", opId: "htmlEntity", params: { mode: "decode" } },
        { id: "n2", opId: "url", params: { mode: "decode" } },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
  },
  {
    id: "base64-to-md5",
    name: "Base64 解码 → MD5",
    desc: "Base64 解码后求 MD5",
    async: false,
    graph: {
      nodes: [
        { id: "n1", opId: "base64", params: { mode: "decode" } },
        { id: "n2", opId: "md5", params: { mode: "run" } },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
  },
  {
    id: "base64-rot13",
    name: "Base64 解码 → ROT13",
    desc: "Base64 解码后 ROT13 解码",
    async: false,
    graph: {
      nodes: [
        { id: "n1", opId: "base64", params: { mode: "decode" } },
        { id: "n2", opId: "rot13", params: { mode: "decode" } },
      ],
      edges: [{ from: "n1", to: "n2" }],
    },
  },
 // 注：base64→gunzip 理论上是两节点链，但 recipe.js 的字符串传递模型
 // 不能正确传递二进制 gzip 流（base64Decode 返回 UTF-8 文本会损坏非 ASCII 字节）。
 // 正确做法：gzipCodec.decode 自身支持 inputEnc=base64 直接识别 base64 输入
 // 故本预设为单节点（单节点也是合法预设，且是实际可用的 CTF 解码方式）。
  {
    id: "base64-to-gunzip",
    name: "Base64 → Gzip 解压",
    desc: "输入 base64 编码的 gzip 流，直接解压（异步，需 executeRecipeAsync）",
    async: true,
    graph: {
      nodes: [
        { id: "n1", opId: "gzipCodec", params: { mode: "decode", inputEnc: "base64" } },
      ],
      edges: [],
    },
  },
  {
    id: "base64-to-zlib",
    name: "Base64 → Zlib 解压",
    desc: "输入 base64 编码的 zlib 流，直接解压（异步，需 executeRecipeAsync）",
    async: true,
    graph: {
      nodes: [
        { id: "n1", opId: "zlibCodec", params: { mode: "decode", inputEnc: "base64" } },
      ],
      edges: [],
    },
  },
];

// ---- 工具：按 id 查找预设 ----

export function getPreset(id) {
  return PRESETS.find((p) => p.id === id) || null;
}

// re-export recipe.js 的同步 API
export { executeRecipe, validateRecipe, topoSort };
