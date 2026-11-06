// pluginPanel.js — 扩展 / MCP 管理页（独立路由 #/plugins，工作区内渲染，非弹窗）。
// 独立模块，自持轻量 el，经 window.__ebctfT 取 i18n，不反向 import main.js。
//
// 四大分区（一级标题 + 卡片）：
// 1. 扩展：列已加载扩展（op/解码贡献/AI 提供方计数）+ 停用/卸载；从 URL 加载新扩展；
//   内置参考扩展一键启用；配置导出 / 导入（已启用扩展源清单 JSON）。
// 2. 离线增强包（T709）：同一视觉分组内——批量操作（一键缓存全部 / 一键移除全部 + 批量状态）
//   与逐包明细（大小、已缓存、未缓存、失败、单项安装/移除）。
// 3. 天珩字库：首屏子集 + 全量四平面按需加载/状态。
// 4. MCP：导出工具箱能力清单（tools/resources JSON），供外部 MCP 客户端 / AI 接入。
//
// 零外发红线：MCP 只在本地 stdio/回调内跑，不自建监听；配置 JSON 只在本地读写。
// 离线包只在用户点击时从本站下载；本面板不属核心模块，SW 协议经离线包面板接线。

import {
  listPlugins, deactivate, uninstall, loadFromUrl, enableBuiltin, onPluginsChange,
  exportConfig, importConfig,
} from "../plugin/pluginHost.js";
import { exportManifest } from "../plugin/mcpBridge.js";
// 离线增强包：数据/状态迁移在内核，本面板负责持久化与 SW 消息接线（T709 迁移入口）。
import { PACKS, packPlan, markInstalled, markFailed } from "../core/offlinePacks.js";
import { offlinePackPanel } from "./offlinePackPanel.js";
// 天珩字库：复用 fontLoader.js 的平面加载/状态订阅，不复制逻辑。
import {
  allFontStatus, loadFontPlane, onFontStatusChange, humanSize,
} from "./fontLoader.js";

// ---- i18n：优先 window 主表（main.js 暴露 __ebctfT），回退本模块内置中文字典 ----
const _ZH = {
  // 离线增强包（原 envPanel 文案，迁移入口）
  "ui.env.packs": "离线增强包",
  "ui.env.packsNote": "可选能力包：WASM 引擎、天珩全量字库、界面语言包、英文科普。仅在你点击安装时从本站下载，不改变首屏预缓存，不上传任何数据。",
  "ui.env.packsUnsupported": "当前浏览器不支持 Service Worker，离线包不可用。",
  "ui.env.packsNoController": "离线服务尚未接管，请刷新页面后重试。",
  "ui.env.packsOffline": "当前处于离线状态，无法下载离线包；已安装的包仍可使用。",
  "ui.env.packsQuota": "配额不足：需要 {0}，当前可用 {1}。可先移除占空间较大的包或清理站点数据。",
  "ui.env.packsTimeout": "离线服务未响应（可能已休眠），请重试。",
  "ui.env.packsNoCrypto": "当前环境不支持版本校验（crypto.subtle 不可用），无法安装离线包。",
  "ui.env.packsPartial": "部分安装：{0}/{1} 项失败，首个失败 {2} ({3})。已下载的条目已保留，可继续安装。",
  "ui.env.packsCachedMissing": "缓存中未找到该包，可能已被浏览器清理，请重新安装。",
  "ui.env.packsStatusFailed": "无法读取缓存状态：{0}",
  "ui.env.packsRemoved": "已移除 {0} 离线包。",
  "ui.env.packsPreparing": "准备中…",
  // 离线包面板内的键（offlinePackPanel 经 ctx.t 取）
  "ui.offlinePack.title": "离线包明细",
  "ui.offlinePack.install": "安装",
  "ui.offlinePack.continue": "继续安装",
  "ui.offlinePack.installing": "安装中…",
  "ui.offlinePack.remove": "移除",
  "ui.offlinePack.failed": "安装失败",
  "ui.offlinePack.offlineNow": "当前处于离线状态，以下能力取决于已安装的离线包。",
  "ui.offlinePack.allReady": "离线包齐全：断网后上述功能均可用。",
  "ui.offlinePack.installedVolume": "已装",
  "ui.offlinePack.totalVolume": "总计",
  "ui.offlinePack.state.installed": "已安装",
  "ui.offlinePack.state.partial": "部分安装",
  "ui.offlinePack.state.missing": "未安装",
  "ui.offlinePack.pack.wasm.name": "WASM 引擎",
  "ui.offlinePack.pack.fonts.name": "天珩全量字库",
  "ui.offlinePack.pack.locales.name": "界面语言包",
  "ui.offlinePack.pack.edu-en.name": "英文科普",
  "ui.offlinePack.pack.ocr.name": "OCR 中英文识别",
  "ui.offlinePack.degrade.ocr.fallback": "未安装时首次 OCR 会尝试在线取本地资产失败则明确报错，不静默降级；安装后可离线识别中英文。",
  "ui.offlinePack.degrade.wasm.fallback": "打开对应功能时提示「该功能依赖的离线包未安装」，并给出包体积与安装入口；纯 JS 操作与首屏功能不受影响。",
  "ui.offlinePack.degrade.fonts.fallback": "仅使用首屏子集字体，生僻字/扩展平面字符显示为缺字方框（tofu），文本内容本身不丢失。",
  "ui.offlinePack.degrade.locales.fallback": "界面回退到中文，语言菜单中该语言标注「未安装离线包」，不静默切成别的语言。",
  "ui.offlinePack.degrade.edu-en.fallback": "操作仍可执行，说明区回退中文科普；若中文条目也不存在则显示「英文科普未安装」。",
  // 新增：批量缓存 / 批量移除 / 字库管理
  "ui.ext.batchCacheTitle": "一键缓存所有离线包",
  "ui.ext.batchCacheNote": "串行下载并安装全部可选离线包，断网后完整可用。可随时取消；失败项会逐条列出，不会静默跳过。",
  "ui.ext.batchCacheBtn": "一键缓存所有离线包",
  "ui.ext.batchRemoveTitle": "一键移除离线包（只保留基础）",
  "ui.ext.batchRemoveNote": "移除全部可选离线包，只保留基础程序与首屏预缓存。可释放空间如下，操作不可撤销。",
  "ui.ext.batchRemoveBtn": "一键移除离线包",
  "ui.ext.batchRemoveConfirm": "确定移除全部离线包（只保留基础）？将释放约 {0}。此操作不可撤销。",
  // 结构分组标题（仅本地回退，不新增 i18n 键）
  "ui.ext.batchGroup": "批量操作",
  "ui.ext.batchWillFree": "将释放约 {0}",
  "ui.ext.batchNothingToCache": "全部离线包已缓存，无需操作。",
  "ui.ext.batchNothingToRemove": "当前没有可移除的离线包。",
  "ui.ext.batchRunning": "正在处理 {0}/{1}：{2}",
  "ui.ext.batchCurrent": "当前：{0} {1}",
  "ui.ext.batchCacheDone": "批量缓存完成：{0} 个成功，{1} 个失败。",
  "ui.ext.batchRemoveDone": "批量移除完成：已释放约 {0}。",
  "ui.ext.batchPartial": "以下离线包处理失败：",
  "ui.ext.batchCancel": "取消",
  "ui.ext.batchCancelled": "已取消（当前包完成后停止）。",
  "ui.ext.batchClose": "关闭",
  "ui.ext.fontsNote": "首屏子集默认已加载；全量四平面按需拉取，点击「加载」即刻补齐子集外生僻字。全部本地文件，零外发。",
  "ui.env.fonts": "天珩字库",
  "ui.env.fontSubset": "首屏子集",
  "ui.env.fontSubsetNote": "已加载（秒开，覆盖 CTF 常用字 + GB2312）",
  "ui.env.fontLoaded": "已加载",
  "ui.env.fontLoading": "加载中…",
  "ui.env.fontIdle": "未加载",
  "ui.env.fontError": "加载失败",
  "ui.env.fontRetry": "重试",
  "ui.env.fontLoad": "加载",
  "ui.ext.fontsLoadAll": "加载全部平面",
};

function applyArgs(s, a) {
  for (let i = 0; i < a.length; i++) s = s.replace("{" + i + "}", String(a[i]));
  return s;
}
const T = (k, ...a) => {
  try {
    if (typeof window !== "undefined" && window.__ebctfT) {
      const v = window.__ebctfT(k, ...a);
      if (v && v !== k) return v;
    }
  } catch { /* 回退 */ }
  return applyArgs(_ZH[k] || k, a);
};
const toast = (m) => { try { window.__ebctfToast?.(m); } catch { /* 无 UI 忽略 */ } };

function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1048576).toFixed(2)} MiB`;
}

// ---- 轻量 DOM 工具（与 envPanel.js 同形，自持零耦合）----
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    // 布尔属性：false 必须「不设属性」，true 设空串（与 main.js el() 一致）。
    else if (v === false) continue;
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

let _off = null;            // onPluginsChange 取消订阅
let _pageObserver = null;   // 页面卸载解绑
let _offFont = null;        // fontLoader 状态订阅
let _extPacksPanel = null;  // 嵌入的离线包面板
let _packsReconciled = false;

/**
 * 在工作区渲染扩展/MCP 独立页（main.js 的 renderWorkspace 调用）。
 * @param {HTMLElement} host 工作区容器
 */
export function renderPluginsPage(host) {
  teardown();
  const page = el("div", { class: "plugin-page", "data-role": "plugin-page" });
  host.append(page);

  // 头：标题 + 说明
  const head = el("div", { class: "plugin-page-head" },
    el("div", { class: "plugin-page-title" }, T("ui.plugin.title")),
    el("p", { class: "plugin-page-note" }, T("ui.plugin.note")),
  );

  // 一级分区：扩展 / 离线能力 / 字库 / MCP 接入。每组 = 一级标题 + 卡片内容。
  const makeGroup = (dataRole, titleId, title, ...body) => el("section", {
    class: "plugin-group", "data-role": dataRole, "aria-labelledby": titleId,
  }, el("h2", { class: "plugin-group-title", id: titleId }, title), ...body);

  const pluginsHost = el("div", { class: "plugin-sect-host", "data-role": "ext-plugins" });
  const offlineHost = el("div", { class: "plugin-sect-host", "data-role": "ext-offline" });
  const fontsHost = el("div", { class: "plugin-sect-host", "data-role": "ext-fonts" });
  const mcpHost = el("div", { class: "plugin-sect-host", "data-role": "ext-mcp" });

  page.append(
    head,
    makeGroup("ext-group-plugins", "plugin-grp-ext", T("ui.plugin.btn"), pluginsHost),
    makeGroup("ext-group-offline", "plugin-grp-offline", T("ui.env.packs"),
      el("p", { class: "plugin-group-note" }, T("ui.env.packsNote")), offlineHost),
    makeGroup("ext-group-fonts", "plugin-grp-fonts", T("ui.env.fonts"), fontsHost),
    makeGroup("ext-group-mcp", "plugin-grp-mcp", T("ui.plugin.mcpTitle"), mcpHost),
  );

  // 插件集合变化（启用/停用/卸载）→ 只重建插件区，不重建离线包/字库，避免重复对账。
  const refreshPlugins = () => { pluginsHost.replaceChildren(sectionPlugins(refreshPlugins)); };
  refreshPlugins();

  offlineHost.replaceChildren(sectionOfflinePacks());
  reconcileOnce();

  fontsHost.replaceChildren(sectionFonts());

  mcpHost.replaceChildren(sectionMcp());

  _off = onPluginsChange(refreshPlugins);
  _pageObserver = new MutationObserver(() => {
    if (page.isConnected && host.contains(page)) return;
    teardown();
  });
  _pageObserver.observe(document.body, { childList: true, subtree: true });
}

function teardown() {
  if (_off) { _off(); _off = null; }
  if (_offFont) { _offFont(); _offFont = null; }
  if (_pageObserver) { _pageObserver.disconnect(); _pageObserver = null; }
  _extPacksPanel = null;
  _packsReconciled = false;
  _batch = null;
}

/* ========================================================================
 * 1. 扩展区（已装扩展 / 官方扩展 / URL 加载 / 配置）
 * ===================================================================== */

const OFFICIAL_FALLBACK = [{
  id: "dcode-extras-2026-10",
  name: "dCode 扩展包 Beta · 2026-11 · 409 op",
  version: "2026.11.0-beta.1",
  description: "dCode.fr 风格纯 JS 算法扩展包 Beta：988 个工具逐条入账，409 op；2026-11 批次取消参数边输边算，数学/数论移除人为小上限，阶乘改分治大数并按内存预算展开。覆盖缺口见 COVERAGE.md。",
  url: "./addons/dcode-extras-2026-10/index.js",
  official: true,
}];

async function discoverAddonManifests() {
  let roots;
  try {
    const r = await fetch(new URL("addons/", document.baseURI), { cache: "no-store" });
    if (!r.ok) return [];
    const doc = new DOMParser().parseFromString(await r.text(), "text/html");
    roots = [...doc.querySelectorAll("a[href]")]
      .map((a) => (a.getAttribute("href") || "").split("?")[0].split("#")[0])
      .filter((h) => h.endsWith("/") && !h.startsWith("..") && !h.startsWith("/"))
      .map((h) => decodeURIComponent(h.replace(/\/+$/, "").split("/").filter(Boolean).pop()))
      .filter((id) => /^[A-Za-z0-9._-]+$/.test(id));
  } catch {
    return [];
  }
  const out = [];
  for (const id of [...new Set(roots)]) {
    try {
      const url = new URL("addons/" + id + "/index.js", document.baseURI);
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) continue;
      const src = await r.text();
      const body = src.match(/export\s+const\s+manifest\s*=\s*\{([\s\S]*?)\n\};/);
      if (!body) continue;
      const field = (key) => {
        const m = body[1].match(new RegExp(key + "\\s*:\\s*['\"]([^'\"]*)['\"]"));
        return m ? m[1] : "";
      };
      const mid = field("id");
      if (mid !== id) continue;
      out.push({
        id: mid,
        name: field("name") || mid,
        version: field("version") || "?",
        description: field("description") || "",
        url: "./addons/" + id + "/index.js",
        official: true,
      });
    } catch {
    }
  }
  return out;
}
let _officialPromise = null;
function officialPlugins() {
  if (_officialPromise) return _officialPromise;
  _officialPromise = fetch(new URL("addons/official.json", document.baseURI))
    .then((r) => r.ok ? r.json() : null)
    .catch(() => null)
    .then(async (j) => {
      const declared = j && Array.isArray(j.plugins) && j.plugins.length ? j.plugins : OFFICIAL_FALLBACK;
      const extra = await discoverAddonManifests();
      const seen = new Set(declared.map((p) => p && p.id).filter(Boolean));
      return [...declared, ...extra.filter((p) => !seen.has(p.id))];
    });
  return _officialPromise;
}

function renderOfficial(host, installed, rerender) {
  host.textContent = "";
  host.append(el("h4", { class: "ext-sub-title" }, T("ui.plugin.official")),
    el("p", { class: "plugin-page-note" }, T("ui.plugin.officialNote")));
  officialPlugins().then((all) => {
    if (!host.isConnected) return;
    const active = new Set(installed.map((p) => p.id));
    const off = all.filter((p) => p && p.id && !active.has(p.id));
    if (!off.length) {
      host.append(el("p", { class: "plugin-empty" }, T("ui.plugin.officialEmpty")));
      return;
    }
    for (const p of off) {
      const btn = el("button", { class: "chip-btn primary" }, T("ui.plugin.enable"));
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        try {
          await loadFromUrl(p.url || `./addons/${p.id}/index.js`);
          toast(T("ui.plugin.loaded"));
          rerender();
        } catch (e) {
          btn.disabled = false;
          toast(T("ui.plugin.loadErr", e && e.message ? e.message : e));
        }
      });
      host.append(el("div", { class: "plugin-item" },
        el("div", { class: "plugin-item-main" },
          el("span", { class: "plugin-item-name" }, `${p.name || p.id} `),
          el("span", { class: "plugin-item-ver" }, `v${p.version || "?"}`),
          el("div", { class: "plugin-item-meta" }, p.description || p.id),
        ),
        el("div", { class: "plugin-item-actions" }, btn),
      ));
    }
  });
}

function sectionPlugins(rerender) {
  const list = listPlugins();
  const box = el("div", { class: "plugin-sect" },
    el("h3", { class: "ext-sub-title" }, T("ui.plugin.installed")),
  );

  if (!list.length) {
    box.append(el("p", { class: "plugin-empty" }, T("ui.plugin.none")));
  } else {
    for (const p of list) {
      box.append(el("div", { class: "plugin-item" },
        el("div", { class: "plugin-item-main" },
          el("span", { class: "plugin-item-name" }, `${p.name} `),
          el("span", { class: "plugin-item-ver" }, `v${p.version}`),
          el("div", { class: "plugin-item-meta" },
            `${p.ops.length} op · ${p.decoders.length} 解码贡献 · ${p.aiProviders.length} AI 源`),
        ),
        el("div", { class: "plugin-item-actions" },
          el("button", { class: "chip-btn", onclick: () => { deactivate(p.id); toast(T("ui.plugin.disabled", p.name)); } }, T("ui.plugin.disable")),
          el("button", { class: "chip-btn danger", onclick: () => { uninstall(p.id); toast(T("ui.plugin.uninstalled", p.name)); } }, T("ui.plugin.uninstall")),
        ),
      ));
    }
  }

  // 官方扩展（默认不启用，一键启用）
  const officialBox = el("div", { class: "plugin-official" });
  box.append(officialBox);
  renderOfficial(officialBox, list, rerender);

  // 从 URL 加载
  const urlInput = el("input", { class: "plugin-input", type: "text", placeholder: T("ui.plugin.urlPh"), spellcheck: "false" });
  box.append(
    el("div", { class: "plugin-load-row" },
      urlInput,
      el("button", { class: "chip-btn primary", onclick: async () => {
        const url = urlInput.value.trim();
        if (!url) return;
 // 外源加载确认（跨源代码执行，需用户显式同意）
        if (!/^(\.|\/)/.test(url) && !confirm(T("ui.plugin.urlConfirm", url))) return;
        try { await loadFromUrl(url); toast(T("ui.plugin.loaded")); }
        catch (e) { toast(T("ui.plugin.loadErr", e && e.message ? e.message : e)); }
      } }, T("ui.plugin.load")),
    ),
    el("button", { class: "chip-btn", onclick: async () => {
      try {
        const mod = await import("../plugin/examples/hello-cipher/index.js");
        await enableBuiltin(mod);
        toast(T("ui.plugin.exampleOn"));
      } catch (e) { toast(T("ui.plugin.loadErr", e && e.message ? e.message : e)); }
    } }, T("ui.plugin.example")),
  );

  // 配置导出 / 导入（已启用扩展的源清单 JSON，便于换机/备份迁移）
  const fileInput = el("input", { type: "file", accept: "application/json,.json", style: "display:none",
    onchange: async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        const cfg = JSON.parse(await f.text());
        const n = await importConfig(cfg);
        toast(T("ui.plugin.configImported", n));
        rerender();
      } catch (err) { toast(T("ui.plugin.configImportErr", err && err.message ? err.message : err)); }
      finally { e.target.value = ""; }
    } });
  box.append(
    el("p", { class: "plugin-empty" }, T("ui.plugin.configNote")),
    el("div", { class: "plugin-load-row" },
      el("button", { class: "chip-btn", onclick: () => {
        const cfg = exportConfig();
        const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
        const a = el("a", { href: URL.createObjectURL(blob), download: "ebctf-plugins-config.json" });
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        toast(T("ui.plugin.configExported"));
      } }, T("ui.plugin.configExport")),
      el("button", { class: "chip-btn", onclick: () => fileInput.click() }, T("ui.plugin.configImport")),
      fileInput,
    ),
  );
  return box;
}

/* ========================================================================
 * 2. 离线增强包 + 天珩字库（从 envPanel 迁入）
 * ===================================================================== */

const PACK_STATE_KEY = "ebctf.offlinePacks.v1";
const PACK_COMMAND_IDLE_MS = 30000;
const _packRevCache = new Map();

function readOfflinePackState() {
  try {
    const raw = localStorage.getItem(PACK_STATE_KEY);
    if (!raw) return { installed: {}, errors: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("状态不是对象");
    const known = new Set(PACKS.map((p) => p.id));
    const rawInstalled = parsed.installed && typeof parsed.installed === "object" && !Array.isArray(parsed.installed)
      ? parsed.installed : {};
    const rawErrors = parsed.errors && typeof parsed.errors === "object" && !Array.isArray(parsed.errors)
      ? parsed.errors : {};
    let repaired = false;
    const installed = {};
    for (const [id, value] of Object.entries(rawInstalled)) {
      if (!known.has(id)) { repaired = true; continue; }
      if (value === true || (value && typeof value === "object" && Array.isArray(value.entries))) installed[id] = value;
      else repaired = true;
    }
    const errors = {};
    for (const [id, value] of Object.entries(rawErrors)) {
      if ((!known.has(id) && id !== "_state") || !value || typeof value !== "object" || typeof value.reason !== "string") {
        repaired = true;
        continue;
      }
      errors[id] = value;
    }
    if (repaired) {
      errors._state = { packId: "_state", reason: "本地离线包状态含无效条目，已忽略；如需彻底重置可点环境面板的「一键重置程序」。" };
    }
    return { ...parsed, installed, errors };
  } catch (e) {
    try { localStorage.removeItem(PACK_STATE_KEY); } catch { /* 隐私模式忽略 */ }
    return {
      installed: {},
      errors: { _state: { packId: "_state", reason: "本地状态损坏已重置：" + (e && e.message || e) } },
    };
  }
}

function writeOfflinePackState(next) {
  try { localStorage.setItem(PACK_STATE_KEY, JSON.stringify(next)); }
  catch (e) { console.error("[offline-packs] 状态写入失败：", e); }
}

function persistPackFailure(id, reason) {
  const next = markFailed(readOfflinePackState(), id, reason).state;
  writeOfflinePackState(next);
  if (_extPacksPanel) _extPacksPanel.refresh(next);
  return next;
}

async function packRevision(pack) {
  const cached = _packRevCache.get(pack.id);
  if (cached) return cached;
  const subtle = typeof crypto !== "undefined" && crypto.subtle;
  if (!subtle) throw new Error(T("ui.env.packsNoCrypto"));
  const text = pack.entries.map((e) => `${e.name}\u0000${e.bytes}`).join("");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  const rev = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 8);
  _packRevCache.set(pack.id, rev);
  return rev;
}

// 向当前 SW 发一条带 MessageChannel 的命令；进度消息走 onMessage，终态由 Promise 返回。
function sendPackCommand(payload, onMessage) {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || !navigator.serviceWorker) {
      reject(new Error(T("ui.env.packsUnsupported")));
      return;
    }
    const controller = navigator.serviceWorker.controller;
    if (!controller) {
      reject(new Error(T("ui.env.packsNoController")));
      return;
    }
    const channel = new MessageChannel();
    let settled = false;
    let timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try { channel.port1.close(); } catch { /* 已关闭 */ }
      fn(value);
    };
    const touch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => finish(reject, new Error(T("ui.env.packsTimeout"))), PACK_COMMAND_IDLE_MS);
    };
    channel.port1.onmessage = (event) => {
      const data = event.data || {};
      touch();
      try { if (onMessage) onMessage(data); } catch (e) { console.error("[offline-packs] 进度处理失败：", e); }
      if (data.type === "cache-pack-done" || data.type === "cache-pack-error"
        || data.type === "uncache-pack-done" || data.type === "pack-status") {
        finish(resolve, data);
      }
    };
    touch();
    try { controller.postMessage(payload, [channel.port2]); }
    catch (e) { finish(reject, e instanceof Error ? e : new Error(String(e))); }
  });
}

async function installOfflinePack(id, panel, onProgress) {
  const pack = PACKS.find((p) => p.id === id);
  if (!pack) throw new Error("未知离线包: " + id);
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const reason = T("ui.env.packsOffline");
    persistPackFailure(id, reason);
    throw new Error(reason);
  }

  // 配额预检：估算失败不阻塞安装，但配额读数明确不足时不发起下载。
  let estimate = null;
  try {
    if (navigator.storage && typeof navigator.storage.estimate === "function") {
      estimate = await navigator.storage.estimate();
    }
  } catch (e) {
    console.warn("[offline-packs] 配额预检失败（继续尝试安装）：", e);
  }
  if (estimate) {
    const quota = Number(estimate.quota);
    const usage = Number(estimate.usage) || 0;
    if (Number.isFinite(quota) && quota > 0) {
      const available = Math.max(0, quota - usage);
      const need = pack.bytes * 1.1;
      if (available < need) {
        const reason = T("ui.env.packsQuota", fmtBytes(need), fmtBytes(available));
        persistPackFailure(id, reason);
        throw new Error(reason);
      }
    }
  }
  // 尽力申请持久化；Safari 会返回 false，不阻塞安装。
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* 忽略 */ }

  const rev = await packRevision(pack);
  if (panel && panel.setProgress) panel.setProgress(id, T("ui.env.packsPreparing"), 0);

  let result;
  try {
    result = await sendPackCommand({ type: "cache-pack", id, rev }, (data) => {
      if (data.type === "cache-pack-progress") {
        const ratio = data.total ? data.done / data.total : 0;
        const text = `${data.done}/${data.total}（${fmtBytes(data.bytesDone || 0)}）`;
        if (panel && panel.setProgress) panel.setProgress(id, text, ratio);
        if (onProgress) onProgress({ text, ratio });
      }
    });
  } catch (e) {
    const reason = (e && e.message) || String(e);
    persistPackFailure(id, reason);
    if (panel && panel.setProgress) panel.setProgress(id, null);
    throw new Error(reason);
  }

  if (result.type === "cache-pack-done" && result.ok === true) {
    const next = markInstalled(readOfflinePackState(), id);
    writeOfflinePackState(next);
    if (panel) {
      if (panel.setProgress) panel.setProgress(id, null);
      panel.refresh(next);
    }
    return;
  }
  if (result.type === "cache-pack-done") {
    const failed = result.failed || [];
    const first = failed[0] || {};
    const reason = T("ui.env.packsPartial", failed.length, result.total, first.url || "?", first.status || first.reason || "?");
    persistPackFailure(id, reason);
    if (panel && panel.setProgress) panel.setProgress(id, null);
    throw new Error(reason);
  }
  const reason = result.reason || ("离线包安装返回未知消息：" + result.type);
  persistPackFailure(id, reason);
  if (panel && panel.setProgress) panel.setProgress(id, null);
  throw new Error(reason);
}

async function removeOfflinePack(id, panel) {
  let result;
  try {
    result = await sendPackCommand({ type: "uncache-pack", id });
  } catch (e) {
    const reason = (e && e.message) || String(e);
    persistPackFailure(id, reason);
    throw new Error(reason);
  }
  if (!result.ok) {
    const reason = result.reason || "移除离线包失败";
    persistPackFailure(id, reason);
    throw new Error(reason);
  }
  const current = readOfflinePackState();
  const installed = { ...current.installed };
  const errors = { ...current.errors };
  delete installed[id];
  delete errors[id];
  const next = { ...current, installed, errors };
  writeOfflinePackState(next);
  if (panel) panel.refresh(next);
  try {
    const pack = PACKS.find((p) => p.id === id);
    if (window.__ebctfToast) window.__ebctfToast(T("ui.env.packsRemoved", pack ? (T(`ui.offlinePack.pack.${pack.id}.name`) || pack.id) : id));
  } catch { /* toast 不可用不影响移除结果 */ }
}

// 以 Cache API 为准对账：localStorage 只记用户意图，不能当作已装判据。
async function reconcileOfflinePackStatuses(panel) {
  for (const pack of PACKS) {
    let status;
    try {
      status = await sendPackCommand({ type: "pack-status", id: pack.id });
    } catch (e) {
      if (panel) panel.refresh(markFailed(readOfflinePackState(), pack.id, T("ui.env.packsStatusFailed", (e && e.message) || e)).state);
      continue;
    }
    if (!status || status.ok === false) {
      const reason = status && status.reason ? status.reason : "未知错误";
      if (panel) panel.refresh(markFailed(readOfflinePackState(), pack.id, T("ui.env.packsStatusFailed", reason)).state);
      continue;
    }
    const names = new Set(status.cached || []);
    const entries = pack.entries.filter((e) => names.has(e.name));
    const current = readOfflinePackState();
    const claimed = current.installed && current.installed[pack.id];
    if (entries.length === 0) {
      if (claimed) {
        const next = markFailed(current, pack.id, T("ui.env.packsCachedMissing")).state;
        writeOfflinePackState(next);
        if (panel) panel.refresh(next);
      }
      continue;
    }
    const bytes = entries.reduce((n, e) => n + e.bytes, 0);
    const errors = { ...current.errors };
    delete errors[pack.id];
    const next = {
      ...current,
      installed: { ...current.installed, [pack.id]: { entries: entries.map((e) => e.name), bytes } },
      errors,
    };
    writeOfflinePackState(next);
    if (panel) panel.refresh(next);
  }
}

function reconcileOnce() {
  if (_packsReconciled || !_extPacksPanel) return;
  _packsReconciled = true;
  reconcileOfflinePackStatuses(_extPacksPanel).catch(() => { /* 对账失败不阻塞页面 */ });
}

// ---- 批量缓存 / 批量移除状态 ----
let _batch = null; // { kind, total, index, currentId, cancelled, done, failures:[{id,reason}], packText, packRatio, freed }

function currentInstalledBytes() {
  const plan = packPlan(readOfflinePackState());
  return plan.packs.reduce((n, p) => (p.state === "missing" ? n : n + p.installedBytes), 0);
}

function batchStatusNode() {
  if (!_batch) return null;
  const wrap = el("div", { class: "ext-batch-status", "data-role": "batch-status", "data-kind": _batch.kind });
  const label = _batch.kind === "cache" ? T("ui.ext.batchCacheTitle") : T("ui.ext.batchRemoveTitle");
  if (!_batch.done) {
    const cur = _batch.currentId ? (T(`ui.offlinePack.pack.${_batch.currentId}.name`) || _batch.currentId) : "";
    wrap.append(el("div", { class: "ext-batch-text" },
      T("ui.ext.batchRunning", Math.min(_batch.index + 1, _batch.total), _batch.total, label)));
    if (cur) {
      wrap.append(el("div", { class: "ext-batch-sub" },
        T("ui.ext.batchCurrent", cur, _batch.packText || "")));
    }
    const ratio = _batch.packRatio || 0;
    wrap.append(progressBar(ratio));
    if (!_batch.cancelled) {
      wrap.append(el("button", { class: "ext-btn ghost", type: "button", "data-action": "batch-cancel",
        onclick: () => { if (_batch) { _batch.cancelled = true; renderBatch(); } } }, T("ui.ext.batchCancel")));
    } else {
      wrap.append(el("p", { class: "ext-batch-hint" }, T("ui.ext.batchCancelled")));
    }
  } else {
    if (_batch.kind === "cache") {
      const okCount = Math.max(0, _batch.index - _batch.failures.length);
      wrap.append(el("p", { class: "ext-batch-result" },
        T("ui.ext.batchCacheDone", okCount, _batch.failures.length)));
    } else {
      wrap.append(el("p", { class: "ext-batch-result" }, T("ui.ext.batchRemoveDone", fmtBytes(_batch.freed || 0))));
    }
    if (_batch.failures.length) {
      wrap.append(el("p", { class: "ext-batch-fail-title" }, T("ui.ext.batchPartial")));
      const ul = el("ul", { class: "ext-fail-list" });
      for (const f of _batch.failures) {
        const name = T(`ui.offlinePack.pack.${f.id}.name`) || f.id;
        ul.append(el("li", { class: "ext-fail-item", "data-pack-id": f.id },
          el("strong", {}, name), el("span", {}, "：" + f.reason)));
      }
      wrap.append(ul);
    }
    wrap.append(el("button", { class: "ext-btn ghost", type: "button", "data-action": "batch-close",
      onclick: () => { _batch = null; renderBatch(); } }, T("ui.ext.batchClose")));
  }
  return wrap;
}

function progressBar(ratio) {
  const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
  const track = el("div", { class: "ext-progress", role: "progressbar",
    "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(pct) });
  const fill = el("div", { class: "ext-progress-fill" });
  fill.style.width = pct + "%";
  track.append(fill);
  return track;
}

let _batchHost = null;
function renderBatch() {
  if (!_batchHost) return;
  const node = batchStatusNode();
  _batchHost.replaceChildren(node || el("p", { class: "ext-batch-idle", hidden: true }));
  const scope = _batchHost.closest(".ext-offline");
  // 批量期间禁用两枚触发按钮，避免并发。
  const busy = !!_batch && !_batch.done;
  for (const b of scope?.querySelectorAll("[data-action='batch-cache'],[data-action='batch-remove']") || []) {
    b.disabled = busy;
  }
  // 释放空间读数随缓存/移除实时刷新。
  const freeNode = scope?.querySelector("[data-role='ext-will-free']");
  if (freeNode) freeNode.textContent = T("ui.ext.batchWillFree", fmtBytes(currentInstalledBytes()));
}

async function runBatchCache(panel) {
  if (_batch && !_batch.done) return;
  const plan = packPlan(readOfflinePackState());
  const targets = plan.packs.filter((p) => p.state !== "installed").map((p) => p.id);
  if (!targets.length) { toast(T("ui.ext.batchNothingToCache")); return; }
  const batch = { kind: "cache", total: targets.length, index: 0, currentId: null, cancelled: false, done: false, failures: [], packText: "", packRatio: 0 };
  _batch = batch;
  renderBatch();
  for (const id of targets) {
    if (batch.cancelled || _batch !== batch) break;
    batch.currentId = id;
    batch.packText = "";
    batch.packRatio = 0;
    renderBatch();
    try {
      await installOfflinePack(id, panel, ({ text, ratio }) => {
        batch.packText = text;
        batch.packRatio = ratio;
        if (_batch === batch) renderBatch();
      });
    } catch (e) {
      batch.failures.push({ id, reason: (e && e.message) ? e.message : String(e) });
    }
    batch.index++;
    if (_batch === batch) renderBatch();
  }
  batch.done = true;
  batch.currentId = null;
  if (_batch === batch) renderBatch();
}

async function runBatchRemove(panel) {
  if (_batch && !_batch.done) return;
  const plan = packPlan(readOfflinePackState());
  const targets = plan.packs.filter((p) => p.state !== "missing");
  const freed = targets.reduce((n, p) => n + p.installedBytes, 0);
  if (!targets.length) { toast(T("ui.ext.batchNothingToRemove")); return; }
  if (!confirm(T("ui.ext.batchRemoveConfirm", fmtBytes(freed)))) return;
  const batch = { kind: "remove", total: targets.length, index: 0, currentId: null, cancelled: false, done: false, failures: [], freed: 0, packText: "", packRatio: 0 };
  _batch = batch;
  renderBatch();
  for (const p of targets) {
    if (batch.cancelled || _batch !== batch) break;
    batch.currentId = p.id;
    renderBatch();
    try {
      await removeOfflinePack(p.id, panel);
      batch.freed += p.installedBytes;
    } catch (e) {
      batch.failures.push({ id: p.id, reason: (e && e.message) ? e.message : String(e) });
    }
    batch.index++;
    if (_batch === batch) renderBatch();
  }
  batch.done = true;
  batch.currentId = null;
  if (_batch === batch) renderBatch();
}

function sectionOfflinePacks() {
  // 离线能力：批量操作与逐包明细同一视觉分组（外层 plugin-group 已给标题 + 说明）。
  const box = el("div", { class: "plugin-sect ext-offline", "data-role": "ext-offline-sect" });

  // ① 批量操作子组：一键缓存 + 一键移除 + 批量状态
  const batchGroup = el("div", { class: "plugin-subgroup", "data-role": "ext-batch-group" },
    el("h3", { class: "ext-sub-title" }, T("ui.ext.batchGroup")),
  );

  // 一键缓存所有离线包
  const cacheCard = el("div", { class: "ext-card", "data-role": "ext-batch-cache" },
    el("div", { class: "ext-card-body" },
      el("div", { class: "ext-card-title" }, T("ui.ext.batchCacheTitle")),
      el("p", { class: "ext-card-note" }, T("ui.ext.batchCacheNote")),
    ),
    el("button", { class: "ext-btn primary", type: "button", "data-action": "batch-cache",
      onclick: () => runBatchCache(_extPacksPanel) }, T("ui.ext.batchCacheBtn")),
  );

  // 一键移除离线包（只保留基础）
  const removeCard = el("div", { class: "ext-card", "data-role": "ext-batch-remove" },
    el("div", { class: "ext-card-body" },
      el("div", { class: "ext-card-title" }, T("ui.ext.batchRemoveTitle")),
      el("p", { class: "ext-card-note" }, T("ui.ext.batchRemoveNote")),
      el("p", { class: "ext-card-freed", "data-role": "ext-will-free" }, T("ui.ext.batchWillFree", fmtBytes(currentInstalledBytes()))),
    ),
    el("button", { class: "ext-btn danger", type: "button", "data-action": "batch-remove",
      onclick: () => runBatchRemove(_extPacksPanel) }, T("ui.ext.batchRemoveBtn")),
  );

  // 批量状态区（进度 / 结果 / 失败原因）
  _batchHost = el("div", { class: "ext-batch-host", "data-role": "ext-batch-host" });
  _batchHost.append(el("p", { class: "ext-batch-idle", hidden: true }));
  batchGroup.append(cacheCard, removeCard, _batchHost);

  // ② 逐包明细子组（标题「离线包明细」由 offlinePackPanel 承担，避免与批量卡重复）
  const detailGroup = el("div", { class: "plugin-subgroup", "data-role": "ext-detail-group" });
  let panel = null;
  try {
    panel = offlinePackPanel({
      state: readOfflinePackState(),
      offline: typeof navigator !== "undefined" && navigator.onLine === false,
      t: T,
      onInstall: (id) => installOfflinePack(id, panel),
      onRemove: (id) => removeOfflinePack(id, panel),
    });
    _extPacksPanel = panel;
    detailGroup.append(panel);
  } catch (e) {
    _extPacksPanel = null;
    detailGroup.append(el("div", { class: "env-error", role: "alert" },
      "离线包面板加载失败：" + ((e && e.message) || e)));
  }

  box.append(batchGroup, detailGroup);
  return box;
}

function sectionFonts() {
  // 字库：一级标题由 ext-group-fonts 提供，这里只保留说明 + 平面行。
  const sec = el("div", { class: "ext-sect ext-fonts", "data-role": "ext-fonts-sect" },
    el("p", { class: "plugin-group-note" }, T("ui.ext.fontsNote")),
  );
  const list = el("div", { class: "ext-font-list" });
  sec.append(list);
  const isEn = String(document.documentElement && document.documentElement.getAttribute("lang") || "").startsWith("en");
  const paint = () => {
    const rows = [];
    rows.push(el("div", { class: "ext-font-row subset" },
      el("div", { class: "ext-font-main" },
        el("div", { class: "ext-font-name" }, T("ui.env.fontSubset"),
          el("span", { class: "ext-font-size" }, "1.5 MB")),
        el("div", { class: "ext-font-desc" }, T("ui.env.fontSubsetNote")),
      ),
      el("span", { class: "ext-font-badge loaded" }, T("ui.env.fontLoaded")),
    ));
    for (const p of allFontStatus()) {
      const st = p.status;
      const label = isEn ? p.labelEn : p.label;
      const desc = isEn ? p.descEn : p.desc;
      const btn = el("button", {
        class: "ext-font-btn" + (st === "loaded" ? " loaded" : "") + (st === "error" ? " error" : ""),
        type: "button", "data-action": "font-load", "data-plane": p.id,
        disabled: st === "loaded" || st === "loading",
      }, st === "loaded" ? T("ui.env.fontLoaded")
        : st === "loading" ? T("ui.env.fontLoading")
        : st === "error" ? T("ui.env.fontRetry")
        : T("ui.env.fontLoad"));
      btn.addEventListener("click", () => { loadFontPlane(p.id); });
      rows.push(el("div", { class: "ext-font-row", "data-plane": p.id, "data-state": st },
        el("div", { class: "ext-font-main" },
          el("div", { class: "ext-font-name" }, label,
            el("span", { class: "ext-font-size" }, humanSize(p.bytes))),
          el("div", { class: "ext-font-desc" }, desc),
        ),
        btn,
      ));
    }
    list.replaceChildren(...rows);
  };
  if (_offFont) { _offFont(); _offFont = null; }
  _offFont = onFontStatusChange(paint);
  paint();
  return sec;
}

/* ========================================================================
 * 3. MCP 区
 * ===================================================================== */
function sectionMcp() {
  // MCP：一级标题由 ext-group-mcp 提供，这里只保留说明 + 操作 + 用法。
  const box = el("div", { class: "plugin-sect" });
  box.append(
    el("p", { class: "plugin-empty" }, T("ui.plugin.mcpNote")),
    el("button", { class: "chip-btn", onclick: () => {
      const manifest = exportManifest();
      const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" });
      const a = el("a", { href: URL.createObjectURL(blob), download: "ebctf-mcp-manifest.json" });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast(T("ui.plugin.mcpExported"));
    } }, T("ui.plugin.mcpExport")),
  );

  // 使用方法：本地 stdio 型（无网址=正常、离线可用、零外发）+ 三步接入 + 各客户端配置文件位置。
  box.append(
    el("div", { class: "plugin-how" },
      el("h5", {}, T("ui.plugin.mcpHowTitle")),
      el("p", { class: "plugin-how-intro" }, T("ui.plugin.mcpHowIntro")),
      el("ol", { class: "plugin-how-steps" },
        el("li", {}, T("ui.plugin.mcpHowStep1")),
        el("li", {}, T("ui.plugin.mcpHowStep2")),
        el("li", {}, T("ui.plugin.mcpHowStep3")),
      ),
      el("p", { class: "plugin-how-clients" }, T("ui.plugin.mcpHowClients")),
    ),
  );

  // 最简提示词：一键复制给任何 AI，照做即完成接入。
  // 安装目录运行时取（用户填一次存 localStorage），文案不写死任何本机路径。
  const DIR_KEY = "ebctf:mcpInstallDir";
  const dirInput = el("input", { class: "plugin-input", type: "text",
    placeholder: T("ui.plugin.mcpPromptPathPh"), spellcheck: "false" });
  try { dirInput.value = localStorage.getItem(DIR_KEY) || ""; } catch { /* 隐私模式忽略 */ }
  const promptTa = el("textarea", { class: "plugin-prompt", rows: "10",
    readonly: "readonly", spellcheck: "false", "aria-label": T("ui.plugin.mcpPromptTitle") });
  const buildPrompt = () => {
    const dir = dirInput.value.trim();
    promptTa.value = T("ui.plugin.mcpPromptHead") + "\n"
      + (dir ? T("ui.plugin.mcpPromptDirFilled", dir) : T("ui.plugin.mcpPromptDirAuto")) + "\n"
      + T("ui.plugin.mcpPromptRest");
  };
  dirInput.addEventListener("input", () => {
    const v = dirInput.value.trim();
    try {
      if (v) localStorage.setItem(DIR_KEY, v);
      else localStorage.removeItem(DIR_KEY);
    } catch { /* 隐私模式忽略 */ }
    buildPrompt();
  });
  buildPrompt();
  box.append(
    el("div", { class: "plugin-how" },
      el("h5", {}, T("ui.plugin.mcpPromptTitle")),
      el("div", { class: "plugin-load-row" },
        dirInput,
        el("button", { class: "chip-btn primary", onclick: async () => {
          const txt = promptTa.value;
          try { await navigator.clipboard.writeText(txt); }
          catch { promptTa.select(); document.execCommand("copy"); }
          toast(T("ui.plugin.mcpPromptCopied"));
        } }, T("ui.plugin.mcpPromptCopy")),
      ),
      promptTa,
    ),
  );
  return box;
}
