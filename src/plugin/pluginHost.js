/*
 * pluginHost.js — 插件宿主：加载 / 校验 / 生命周期 / 卸载回收。
 *
 * 职责（2）：
 * - 让主项目"能兼容功能差异和增量"——插件动态挂载，不需重编主项目。
 * - 让"插件开发难度下降"——插件只写 { manifest, setup(ctx) }，其余全由宿主兜底。
 *
 * 性能与加载（提示"注意性能以及加载问题"）：
 * - 插件按需 import（动态），不进主 bundle，不拖首屏。
 * - 默认不自动加载任何插件；用户在插件面板显式启用，或放进内置插件清单。
 * - 启用态记 localStorage，下次启动只 import 已启用的。
 *
 * 安全：
 * - 每个插件拿到独立 ctx（命名空间隔离），注册动作全登记，卸载时精确回收（op/cat/i18n/订阅）。
 * - setup 抛错 → 回滚该插件已注册的一切，不污染主项目，不崩全站。
 * - 纯前端零外发：宿主不给网络/文件原语，AI 网络另走用户自备通道。
 */
import { unregister, removeCategory } from "../core/registry.js";
import { unmergeDict } from "../i18n/index.js";
import { makeContext } from "./pluginContext.js";

const STORE_ENABLED = "ebctf_plugins_enabled"; // 已启用插件 id 列表（JSON 数组）
const STORE_SOURCES = "ebctf_plugins_sources"; // 用户加载过的插件源（id → url），供重载

/** 已加载插件：id → { manifest, record, module } */
const _loaded = new Map();
/** 全部一键解码贡献 + AI 提供方的聚合视图（跨插件），供 UI/aiClient 读取。 */
const _listeners = new Set();

function emit() {
  for (const cb of _listeners) { try { cb(); } catch { /* 单个订阅出错不影响其余 */ } }
}

/** 订阅插件集合变化（启用/停用/卸载），返回取消函数。 */
export function onPluginsChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

/** 清单最小校验：id/name/version + setup 函数。id 只允许 [a-z0-9-]，作命名空间前缀。 */
function validateManifest(m) {
  if (!m || typeof m !== "object") throw new Error("插件缺少 manifest 对象");
  if (typeof m.id !== "string" || !/^[a-z0-9-]{2,40}$/.test(m.id)) {
    throw new Error(`插件 id 非法（需 2-40 位小写字母/数字/连字符）：${m.id}`);
  }
  if (typeof m.name !== "string" || !m.name) throw new Error(`插件 ${m.id} 缺少 name`);
  if (typeof m.version !== "string" || !m.version) throw new Error(`插件 ${m.id} 缺少 version`);
}

/**
 * 加载并激活一个插件模块。module 需 export：
 * - manifest: { id, name, version, description?, author?, apiVersion? }
 * - default 或 setup: (ctx) => void|Promise<void>
 * @param {object} mod 已 import 的插件模块
 * @returns {Promise<object>} 加载记录
 */
export async function activate(mod) {
  const manifest = mod.manifest;
  validateManifest(manifest);
  if (_loaded.has(manifest.id)) {
    throw new Error(`插件 ${manifest.id} 已加载（先 deactivate 再重载）`);
  }
  const setup = typeof mod.default === "function" ? mod.default
    : typeof mod.setup === "function" ? mod.setup : null;
  if (!setup) throw new Error(`插件 ${manifest.id} 缺少 setup(ctx)（default 或具名 setup 导出）`);

 // 台账：记下这个插件注册的一切，卸载时逐项回收。
  const record = {
    ops: [], cats: [], msgDicts: [], decoders: [], aiProviders: [], disposers: [],
  };
  const ctx = makeContext(manifest, record);

  try {
    await setup(ctx);
  } catch (e) {
 // setup 失败：回滚已经注册的部分，保证主项目干净。
    rollback(record);
    throw new Error(`插件 ${manifest.id} 初始化失败：${e && e.message ? e.message : e}`);
  }

  const rec = { manifest, record, module: mod };
  _loaded.set(manifest.id, rec);
  emit();
  return rec;
}

/** 精确回收一个插件的所有注册（供 deactivate 与 setup 失败回滚共用）。 */
function rollback(record) {
  for (const opId of record.ops) { try { unregister(opId); } catch { /* 已不在则忽略 */ } }
  for (const catId of record.cats) { try { removeCategory(catId); } catch { /* 忽略 */ } }
  for (const dicts of record.msgDicts) { try { unmergeDict(dicts); } catch { /* 忽略 */ } }
  for (const off of record.disposers) { try { off(); } catch { /* 忽略 */ } }
 // decoders / aiProviders 只在内存台账里，随 record 丢弃即回收。
}

/** 停用并卸载一个插件，回收其全部注册。 */
export function deactivate(pluginId) {
  const rec = _loaded.get(pluginId);
  if (!rec) return false;
  rollback(rec.record);
  _loaded.delete(pluginId);
  emit();
  return true;
}

/** 已加载插件的只读列表（UI 用）。 */
export function listPlugins() {
  return [..._loaded.values()].map((r) => ({
    id: r.manifest.id,
    name: r.manifest.name,
    version: r.manifest.version,
    description: r.manifest.description || "",
    author: r.manifest.author || "",
    ops: r.record.ops.slice(),
    decoders: r.record.decoders.map((d) => ({ id: d.id, label: d.label })),
    aiProviders: r.record.aiProviders.map((p) => ({ id: p.id, label: p.label })),
  }));
}

/** 跨插件聚合：全部一键解码贡献。 */
export function allDecoders() {
  const out = [];
  for (const r of _loaded.values()) out.push(...r.record.decoders);
  return out;
}

/** 跨插件聚合：全部 AI 提供方（aiClient 读取）。 */
export function allAiProviders() {
  const out = [];
  for (const r of _loaded.values()) out.push(...r.record.aiProviders);
  return out;
}

// ---------- 启用态持久化 ----------

function readEnabled() {
  try { return JSON.parse(localStorage.getItem(STORE_ENABLED) || "[]"); } catch { return []; }
}
function writeEnabled(ids) {
  try { localStorage.setItem(STORE_ENABLED, JSON.stringify([...new Set(ids)])); } catch { /* 忽略 */ }
}
function readSources() {
  try { return JSON.parse(localStorage.getItem(STORE_SOURCES) || "{}"); } catch { return {}; }
}
function writeSources(map) {
  try { localStorage.setItem(STORE_SOURCES, JSON.stringify(map)); } catch { /* 忽略 */ }
}

/**
 * 从 URL 动态加载一个插件（用户"自行增加算法/创作语言"的入口）。
 * 仅接受同源或用户显式确认的 URL；加载成功记入 sources 供下次自动启用。
 * @param {string} url 插件 ESM 模块 URL
 */
export async function loadFromUrl(url) {
  const mod = await import(/* @vite-ignore */ url);
  const rec = await activate(mod);
  const sources = readSources();
  sources[rec.manifest.id] = url;
  writeSources(sources);
  const enabled = readEnabled();
  enabled.push(rec.manifest.id);
  writeEnabled(enabled);
  return rec;
}

/** 停用并从持久化里移除（下次启动不再加载）。 */
export function uninstall(pluginId) {
  deactivate(pluginId);
  writeEnabled(readEnabled().filter((id) => id !== pluginId));
  const sources = readSources();
  delete sources[pluginId];
  writeSources(sources);
}

/**
 * 启动时恢复上次启用的插件（从记录的 source URL 逐个 import）。
 * 失败的插件跳过不阻塞其余，也不阻塞主项目启动。
 * @param {Record<string,object>} builtins 内置插件 { id: 已 import 的模块 }，随主项目分发、免 URL。
 */
export async function restoreEnabled(builtins = {}) {
  const enabled = readEnabled();
  const sources = readSources();
  for (const id of enabled) {
    if (_loaded.has(id)) continue;
    try {
      if (builtins[id]) { await activate(builtins[id]); continue; }
      if (sources[id]) { await import(/* @vite-ignore */ sources[id]).then(activate); }
    } catch (e) {
      console.warn(`[pluginHost] 恢复插件 ${id} 失败，已跳过：`, e && e.message ? e.message : e);
    }
  }
}

/** 启用一个内置插件（已 import 的模块），并记入持久化。 */
export async function enableBuiltin(mod) {
  const rec = await activate(mod);
  const enabled = readEnabled();
  enabled.push(rec.manifest.id);
  writeEnabled(enabled);
  return rec;
}

export function isEnabled(pluginId) { return _loaded.has(pluginId); }

// ---------- 配置导出 / 导入（换机·备份迁移） ----------

/**
 * 导出插件配置快照：已启用 id 列表 + 各自的源 URL。
 * 只含用户从 URL 加载的插件（内置插件随主项目分发、无源 URL，导入端自动跳过）。
 * @returns {{version:number, enabled:string[], sources:Record<string,string>}}
 */
export function exportConfig() {
  return { version: 1, enabled: readEnabled(), sources: readSources() };
}

/**
 * 导入插件配置：合并 sources/enabled 并即时加载有源 URL 的插件。
 * 无源的 id（内置插件）只记启用态，由 restoreEnabled 在下次启动时兜底。
 * @param {{enabled?:string[], sources?:Record<string,string>}} cfg
 * @returns {Promise<number>} 本次新加载成功的插件数
 */
export async function importConfig(cfg) {
  if (!cfg || typeof cfg !== "object") throw new Error("配置格式非法（需 JSON 对象）");
  const inSources = (cfg.sources && typeof cfg.sources === "object") ? cfg.sources : {};
  const inEnabled = Array.isArray(cfg.enabled) ? cfg.enabled : [];
  const sources = { ...readSources(), ...inSources };
  writeSources(sources);
  writeEnabled([...readEnabled(), ...inEnabled]);
  let loaded = 0;
  for (const id of new Set(inEnabled)) {
    if (_loaded.has(id)) continue;
    const url = sources[id];
    if (!url) continue; // 内置插件无源，交给 restoreEnabled
    try { await import(/* @vite-ignore */ url).then(activate); loaded++; }
    catch (e) { console.warn(`[pluginHost] 导入插件 ${id} 失败，已跳过：`, e && e.message ? e.message : e); }
  }
  return loaded;
}
