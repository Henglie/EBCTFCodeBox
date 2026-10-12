// pluginPanel.js — 插件 / MCP 管理页（独立路由 #/plugins，工作区内渲染，非弹窗）。
// 独立模块，自持轻量 el，经 window.__ebctfT 取 i18n，不反向 import main.js。
//
// 两块内容：
// 1. 插件：列已加载插件（op/解码贡献/AI 提供方计数）+ 停用/卸载；从 URL 加载新插件；
//   内置参考插件一键启用；配置导出 / 导入（已启用插件源清单 JSON）。
// 2. MCP：导出工具箱能力清单（tools/resources JSON），供外部 MCP 客户端 / AI 接入。
//
// 零外发红线：MCP 只在本地 stdio/回调内跑，不自建监听；配置 JSON 只在本地读写。

import {
  listPlugins, deactivate, uninstall, loadFromUrl, enableBuiltin, onPluginsChange,
  exportConfig, importConfig,
} from "../plugin/pluginHost.js";
import { exportManifest } from "../plugin/mcpBridge.js";

const T = (k, ...a) => (window.__ebctfT ? window.__ebctfT(k, ...a) : k);
const toast = (m) => { try { window.__ebctfToast?.(m); } catch { /* 无 UI 忽略 */ } };

// ---- 轻量 DOM 工具（与 envPanel.js 同形，自持零耦合）----
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

let _off = null; // onPluginsChange 取消订阅（页面卸载时解绑）
let _pageObserver = null;

/**
 * 在工作区渲染插件/MCP 独立页（main.js 的 renderWorkspace 调用）。
 * @param {HTMLElement} host 工作区容器
 */
export function renderPluginsPage(host) {
  if (_off) { _off(); _off = null; }
  if (_pageObserver) { _pageObserver.disconnect(); _pageObserver = null; }
  const page = el("div", { class: "plugin-page" });
  host.append(page);
  const rerender = () => {
    page.textContent = "";
    page.append(
      el("div", { class: "plugin-page-head" },
        el("div", { class: "plugin-page-title" }, T("ui.plugin.title")),
        el("p", { class: "plugin-page-note" }, T("ui.plugin.note")),
      ),
      sectionPlugins(rerender),
      sectionMcp(),
    );
  };
  rerender();
 // 插件集合变化（启用/停用/卸载）→ 重渲染当前页；页面被替换时解绑（下次进入重新绑定）。
  _off = onPluginsChange(rerender);
  _pageObserver = new MutationObserver(() => {
    if (page.isConnected && host.contains(page)) return;
    if (_off) { _off(); _off = null; }
    _pageObserver?.disconnect();
    _pageObserver = null;
  });
  _pageObserver.observe(document.body, { childList: true, subtree: true });
}

// ---- 1. 插件区 ----
function sectionPlugins(rerender) {
  const list = listPlugins();
  const box = el("div", { class: "plugin-sect" },
    el("h4", {}, T("ui.plugin.installed")),
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

 // 配置导出 / 导入（已启用插件的源清单 JSON，便于换机/备份迁移）
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

// ---- 2. MCP 区 ----
function sectionMcp() {
  const box = el("div", { class: "plugin-sect" }, el("h4", {}, T("ui.plugin.mcpTitle")));
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
