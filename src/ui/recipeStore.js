/*
 * recipeStore.js — 配方命名保存 / 自动草稿 / 分享 URL（T698/T699）。
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

export function serializeRecipe(state) {
  return {
    format: "EBCTFCodeBox-recipe",
    version: 1,
    input: String(state.input || ""),
    nodes: (state.nodes || []).map((n) => ({ opId: n.opId, dir: n.dir, params: n.params || {} })),
  };
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

/** 编码分享码。返回 {code, degraded}；超长时先丢输入、再报错。 */
export async function encodeShare(data) {
  let payload = { ...data, input: String(data.input || "") };
  let degraded = false;
  if (payload.input.length > SHARE_INPUT_LIMIT) { payload.input = ""; degraded = true; }
  const pack = async (obj) => b64urlEncode(await streamCompress("deflate-raw", new TextEncoder().encode(JSON.stringify(obj))));
  let code = await pack(payload);
  if (code.length > SHARE_MAX_CODE && payload.input) { payload.input = ""; degraded = true; code = await pack(payload); }
  if (code.length > SHARE_MAX_CODE) throw new Error("配方过大，无法生成分享链接");
  return { code, degraded };
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
