/*
 * recipeStore.js — 配方命名保存 / 自动草稿 / 分享 URL。
 *
 * 存储全部在本地 localStorage；分享链接只把配方+输入压进 hash，不发网络请求。
 * 压缩走 core/compress 的 deflate-raw（原生 Streams 不可用时自动退 stored deflate）。
 */
import { streamCompress, streamDecompress } from "../core/compress.js";

const SAVED_KEY = "ebctf.recipe.saved.v1";
const DRAFT_KEY = "ebctf.recipe.draft.v1";
export const SHARE_MAX_CODE = 12000;
export const SHARE_INPUT_LIMIT = 1500;

function readJson(key, dflt) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return v == null ? dflt : v;
  } catch { return dflt; }
}
function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

// 参数深拷贝：配方节点参数可能含数组/嵌套对象（插件 op），导出与复制都不能共享引用。
function clonePlain(value, seen) {
  if (value === null || typeof value !== "object") return value;
  seen = seen || new Map();
  if (seen.has(value)) return seen.get(value);
  if (ArrayBuffer.isView(value)) return new value.constructor(value);
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (Array.isArray(value)) {
    const out = [];
    seen.set(value, out);
    for (const v of value) out.push(clonePlain(v, seen));
    return out;
  }
  const out = {};
  seen.set(value, out);
  for (const k of Object.keys(value)) out[k] = clonePlain(value[k], seen);
  return out;
}

/**
 * 配方状态 → 可持久化/分享的纯数据。
 *
 * v3 在 v2（inputKind / fileMeta / disabled / breakpoint / autoRunMode）基础上
 * 增加控制节点：{kind:"control", control, params}。控制节点不是注册表 op，
 * 旧读取端只会跳过它们（opId 缺失），旧 v1/v2 数据仍可被本端读取。
 * 文件字节永不写入本结构（localStorage / hash 都装不下），只留元数据 + fileOmitted 标记。
 * options.includeInput=false 时清空 input（草稿/命名保存默认仍含输入；分享默认不含）。
 */
export function serializeRecipe(state, options = {}) {
  const includeInput = options.includeInput !== false;
  const fileChannel = state.inputKind === "file" || !!state.file;
  const sourceInput = String(state.input || "");
  const nodes = (state.nodes || []).map((n) => {
    if (n && n.kind === "control") {
      const node = { kind: "control", control: String(n.control || ""), params: clonePlain(n.params || {}) };
      if (n.disabled) node.disabled = true;
      if (n.breakpoint) node.breakpoint = true;
      return node;
    }
    const node = { opId: n.opId, dir: n.dir, params: clonePlain(n.params || {}) };
    if (n.disabled) node.disabled = true;
    if (n.breakpoint) node.breakpoint = true;
    return node;
  });
  const data = {
    format: "EBCTFCodeBox-recipe",
    version: 3,
    // 文件链的 input 是占位提示，不是输入内容；只导出文本链的输入。
    input: includeInput && !fileChannel ? sourceInput : "",
    inputKind: fileChannel ? "file" : "text",
    fileMeta: fileChannel && state.fileMeta
      ? { name: String(state.fileMeta.name || ""), size: Number(state.fileMeta.size) || 0, mime: String(state.fileMeta.mime || "") }
      : null,
    fileOmitted: !!state.file,
    autoRunMode: state.autoRunMode === "manual" ? "manual" : "auto",
    nodes,
  };
  if (!includeInput && sourceInput && !fileChannel) data.inputOmitted = true;
  return data;
}

export function listSavedRecipes() {
  const list = readJson(SAVED_KEY, []);
  return Array.isArray(list) ? list.filter((x) => x && typeof x.name === "string" && x.data) : [];
}
export function saveNamedRecipe(name, data) {
  const n = String(name || "").trim().slice(0, 80);
  if (!n) return false;
  const list = listSavedRecipes().filter((x) => x.name !== n);
  list.unshift({ name: n, at: Date.now(), data });
  return writeJson(SAVED_KEY, list.slice(0, 50));
}
export function deleteNamedRecipe(name) {
  const list = listSavedRecipes().filter((x) => x.name !== name);
  return writeJson(SAVED_KEY, list);
}
export function saveDraft(data) { return writeJson(DRAFT_KEY, { at: Date.now(), data }); }
export function loadDraft() {
  const d = readJson(DRAFT_KEY, null);
  return d && d.data ? d.data : null;
}
export function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } }

function b64urlEncode(bytes) {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 编码分享码。返回 {code, degraded, fileOmitted, inputOmitted}；超长时先丢输入、再报错。
 * 默认只分享配方（includeInput=false）；调用方显式传 includeInput=true 才带输入。
 * 文件链头只分享「配方 + 文件元数据」，字节永远不进链接；fileOmitted=true 时调用方必须提示。
 */
export async function encodeShare(data, options = {}) {
  const includeInput = options.includeInput === true;
  const fileOmitted = data.inputKind === "file" || !!data.fileOmitted;
  const sourceInput = String(data.input || "");
  const inputOmitted = !includeInput && (!!sourceInput || data.inputOmitted === true);
  let payload = {
    ...data,
    input: includeInput ? sourceInput : "",
    inputKind: fileOmitted ? "file" : (data.inputKind || "text"),
  };
  if (inputOmitted) payload.inputOmitted = true;
  else delete payload.inputOmitted;
  let degraded = fileOmitted;
  if (includeInput && payload.input.length > SHARE_INPUT_LIMIT) { payload.input = ""; degraded = true; }
  const pack = async (obj) => b64urlEncode(await streamCompress("deflate-raw", new TextEncoder().encode(JSON.stringify(obj))));
  let code = await pack(payload);
  if (code.length > SHARE_MAX_CODE && payload.input) { payload.input = ""; degraded = true; code = await pack(payload); }
  if (code.length > SHARE_MAX_CODE) throw new Error("配方过大，无法生成分享链接");
  return { code, degraded, fileOmitted, inputOmitted };
}

export async function decodeShare(code) {
  const bytes = b64urlDecode(code);
  const json = new TextDecoder().decode(await streamDecompress("deflate-raw", bytes));
  const data = JSON.parse(json);
  if (!data || data.format !== "EBCTFCodeBox-recipe" || !Array.isArray(data.nodes)) throw new Error("分享链接格式非法");
  return data;
}

export function buildShareUrl(code) {
  return `${location.origin}${location.pathname}#/recipe?r=${code}`;
}

export function shareCodeFromHash(hash) {
  const q = String(hash || "").split("?")[1] || "";
  return new URLSearchParams(q).get("r") || "";
}
