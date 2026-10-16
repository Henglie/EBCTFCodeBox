import { literalMatcher, groupSingleCandidates } from "./core/magic/smartCandidates.js";
import { createTargetEditor, renderCandidateRow, highlightResult } from "./ui/smartResultView.js";
import { resultSearchState } from "./ui/resultFilter.js";
import { loadTargetConfig } from "./core/magic/signals.js";
/*
 * main.js — 入口 + UI 驱动（全部由 registry 声明式渲染）。
 *
 * 职责：
 * 1. import 各算法模块（副作用注册进 OPS）。
 * 2. 按 CATEGORIES 渲染左侧导航，按 OPS 渲染分类下的功能。
 * 3. 选中一个 op → 渲染操作面板（参数表单 + 双栏 IO + 中间操作条）。
 * 4. 首页「一把梭」：对输入跑 Magic 智能识别（综合分排序 + crib 过滤 + intensive 暴力）。
 * 5. 顶栏：主题切换、检查更新（占位）、GitHub（占位）。
 *
 * 无框架、无构建，原生 ES module。状态极简：当前视图 view + 当前 op + 方向 dir。
 */
import { CATEGORIES, OPS, opsByCat, getOp, defaultParams, register, familyGroup, FAMILY_NAMES, inferIoMode } from "./core/registry.js";
import { ensureOp, ensureCat, ensureAll, preloadIdle } from "./core/lazyCore.js";
import { OP_FILE_MAP } from "./core/lazyTables.generated.js";
import { t, tBilingual, getLocale, setLocale, locales, onLocaleChange, initLocale, warmEnglish, getDir, LOCALE_META, localeCoverage } from "./i18n/index.js";
import { downloadBytes, cloudWarnGate, fmtByteSize, isCloudDeploy } from "./ui/download.js";
import { productFileEntries } from "./core/productResult.js";
import { magicFilterReset, filterMagicCands, filterBruteCands, magicFilterBar } from "./ui/resultFilter.js";
import { magicDecode } from "./core/magic/magic.js";
import { runMagic, cancelMagic } from "./core/magic/magicClient.js"; // 真多线程调度（Worker 优先，降级主线程）+ 中断接管
// fileAnalysis / imageAnalysis / audioAnalysis（智能分析三链，含 QR·pcap·inflate·音频子树）已改懒载，见 ensureAnalysisChains()
import { loadLicense, OPENSOURCE_LICENSE } from "./core/license.js";
import { analyze7zFile } from "./core/sevenzip.js"; // 7z 拖入文件真列表/解压（wasm 缺失降级）
import { cryptoTryAll } from "./core/cryptoTryAll.js";
import { bridgeHealth } from "./core/localBridge.js";
import { icon as iconSvg } from "./ui/icons.js";
import { HLSpring } from "./ui/spring.js"; // 弹簧动效内核（总开关 ebctf.springMotion）
// pinyinSearch（拼音全拼/首字母搜索兼容层，含 58KB 数据表）已改懒载，见 ensurePinyinSearch()，首屏闭包 -29KB gz
import { FONT_PLANES, loadFontPlane, fontStatus, onFontStatusChange, humanSize, preloadAllPlanes } from "./ui/fontLoader.js";
import { CTF_HOT, CTF_HOT_META } from "./core/ctfPresets.js";
import { eduContentReady, getEduSync, eduAliasesSync } from "./core/eduContent.defer.js"; // 科普数据懒加载门面（zh 分片 1.4MB 退出首屏关键路径）
let eduContentSettled = false; // true = 懒加载已落定（成功或失败），renderEduCard 不再等待补渲
eduContentReady().then(() => { eduContentSettled = true; });
import EDU_IMAGES from "./core/edu/eduImages.js";
import { renderMathIn } from "./ui/katexLoader.js";
import { showLoadingScreen, setLoadingProgress, hideLoadingScreen } from "./ui/loadingScreen.js";
import { APP_VERSION } from "./core/version.js";
import { renderEnhancedView, invisibleReport, invisibleToggle } from "./ui/inputEnhance.js";
import { openEnvPanel } from "./ui/envPanel.js";
// 「增强随机安全」每 op 内嵌勾选框 + 档位标识；启动接线（读存储→注入随机源单例）。
import { renderRandSecureToggle, installRandConfig, currentRandMode, serverArmed, loadRandConfig } from "./ui/randSecurePanel.js";
import { opUsesRandom, opExternalRand, externalRandLib } from "./core/randOps.js"; // 随机性 op 白名单 + 「随机来自内置库」清单
import { RAND_MODES, warmupServer } from "./core/randSource.js";
import { resolveDecodeConfig, loadLastConfig, saveLastConfig } from "./core/decodeProfile.js"; // 解码强度档 → op 白名单 + 预算
import { isExplicitRunOp, explicitRunHint, isLazyRunOp, lazyRunHint } from "./core/explicitRun.js"; // 重运算 op 显式触发白名单 + 图像惰执行清单
import { runOpOffThread, cancelOpRun, opRunBusy } from "./core/opRunClient.js"; // 重 op 独立线程执行（可取消/超时）
import { openDecodeStrength } from "./ui/decodeStrength.js"; // 「解码强度」弹窗（5 档滑块 + 参与算法多选 + 命名方案）
import { applyAccent, enableHctEngine, DEFAULT_ACCENT, resetAccent } from "./ui/dynamicColor.js"; // M3 动态取色（HSL 近似 + HCT 精确引擎）
import { themeVariant } from "./ui/themePicker.js";
import { attachEditorToolbar } from "./ui/editorToolbar.js"; // 通用编辑框工具条（记事本化，全站复用）
import { attachTextContextMenu } from "./ui/textContextMenu.js"; // 编辑框右键文本处理菜单
import { loadFavorites, isFavorite, toggleFavorite, openFavMenu } from "./ui/favorites.js";
// 自定义算法（魔改）——UI 开关/编辑器 + Worker 沙箱执行（magic/穷举侧排除）
import { renderCustomToggle } from "./ui/customImplEditor.js";
import { getCustomImpl, listEnabledOpIds } from "./core/customImplStore.js";
import { runCustomWithTimeout } from "./core/customImplClient.js";

// ---------- i18n 包装 ----------
// t 缺 key 时回退到 key 本身；这里再包一层：查不到就回退 registry 里的中文字面量
// 这样未翻译的 op（i18n key 表未补全的）显示原中文而非裸 key。
function catName(cat) {
  const k = "cat." + cat.id;
  const s = t(k);
  return s === k ? cat.name : s;
}
function opName(op) {
  const k = "op." + op.id + ".name";
  const s = t(k);
  return s === k ? op.name : s;
}
// 一键解码/穷举结果卡区显示 op 名用「中文 (English)」双语（便于对照）
// 但左侧菜单/op 面板标题仍走 opName 单语。双语只在结果卡渲染层用 opNameBi。
function opNameBi(op) {
  return tBilingual("op." + op.id + ".name", op.name);
}
// 暴露给独立视图模块（recipeView / exhaustiveView）复用，避免它们反向 import main.js
if (typeof window !== "undefined") {
  window.__ebctfOpName = opName;
  window.__ebctfOpNameBi = opNameBi;
  window.__ebctfT = (k, ...a) => t(k, ...a);
  window.__ebctfCatName = (id) => catNameById(id);
  window.__ebctfToast = (m) => toast(m);
}
function opDesc(op) {
  if (!op.desc) return "";
  const k = "op." + op.id + ".desc";
  const s = t(k);
  return s === k ? op.desc : s;
}

// 副作用导入：各算法模块在加载时 register 自己。新增算法模块时在此加一行。
// 古典补全组（古典二：VIC/Phillips/Bellaso/Slidefair/Collon/DancingMen/Zodiac/Three-square/Monome-Binome，classic 双向，多源向量对拍）
// 编码补全组（编码一：Kuznyechik/IBAN/镜像字母/玛雅·巴比伦·埃及数字/圣书体/SGA/神秘学字母/信号旗，radix+fancy+block，多源向量对拍）
// 取证补全组（取证一：SSDEEP 模糊哈希/LZNT1 解压/注释域提取，hash+forensic，多源对拍）
import "./core/opStubs.js"; // 惰载 stub 播种（须先于 detect 四件套求值）
import "./core/detectExt.js"; // detect 补全扩展层
import "./core/detectExt2.js"; // detect 大表补强（82 op 补 detect，提升一把梭命中率）

import { renderRecipe, rState as recipeState, addRecipeOpAt, addRecipeFamilyAt, appendRecipeOpToTail, openRecipeFamilyAtTail } from "./ui/recipeView.js"; // 配方链 UI
import { renderExhaustive } from "./ui/exhaustiveView.js"; // 穷举全解视图（一键全解码器穷举）
// —— inspect / quickconv 两视图懒载（MT717 2026-10-12：两子树 12 文件退出首屏闭包，约 -108KB gz）——
// 首次切入对应视图才动态 import（视图切换=用户手势）；文件仍在 SW 预缓存（不匹配 EXCLUDE_RULES），离线可用。
// dispose 未加载时为 no-op（切走时 _inspectMod 尚未 resolve → 模块无 DOM 实例，无需清理）。
let _inspectMod = null, _quickConvMod = null;
function loadInspectView() {
  return _inspectMod || (_inspectMod = import("./ui/universalViewer.js").catch((e) => { _inspectMod = null; throw e; }));
}
function loadQuickConvView() {
  return _quickConvMod || (_quickConvMod = import("./ui/quickConv.js").catch((e) => { _quickConvMod = null; throw e; }));
}
function disposeInspectView() {
  if (_inspectMod) _inspectMod.then((m) => m.disposeUniversalViewer()).catch(() => {});
}
import { renderCodeImageViewer } from "./ui/codeImageViewer.js"; // 编码图鉴查询器（图形编码对照图）
import { exhaustiveDecode } from "./core/exhaustiveDecode.js"; // 穷举全解并入首页智能解码（末尾追加可折叠区）
import { expandableInput, ensureExpStyles, openExpandModal } from "./ui/expandableInput.js";
import { attachModalLifecycle } from "./ui/modalLifecycle.js"; // 密钥/IV/crib 可展开输入框 + 弹层样式注入
import { decompileBytes, formatResult as formatDecompileResult } from "./core/exebridge.js"; // 拖入分派用
// 以下模块已注册 op 且有 detect 的须排在下方 detectExt3/detectSupplement 之前，避免 detect 覆盖顺序错乱。
import "./core/detectExt3.js"; // EASY 30 op detect 补齐（须在所有 op 注册后）
import "./core/detectSupplement.js"; // 编码类 detect 覆盖补齐（须在所有 op 注册后）
import { decodeUtf8Lossless } from "./core/bytesIo.js";

// BOM 保真的严格 UTF-8 解码（bytesIo 单一源）：非法序列抛 TypeError（同旧 fatal TextDecoder 语义），
// 唯一行为差异是合法 BOM（U+FEFF 开头）不再被静默吞掉。
function _decodeUtf8Fatal(bytes) {
  const r = decodeUtf8Lossless(bytes);
  if (!r.ok) throw new TypeError(r.reason);
  return r.text;
}

// ---------- 启动加载屏（避免白屏，最早显示，纯文字+CSS 不依赖字库/图标）----
// 模块 import 已同步完成到此，立即盖屏 → 启动尾部渐隐。
showLoadingScreen();
setLoadingProgress(30, "ui.loading.core");

// ---------- DOM 句柄 ----------
const $nav = document.getElementById("sidenav");
const $ws = document.getElementById("workspace");

// ---------- 应用状态 ----------
const state = {
  view: "home",         // "home" | "op"
  opId: null,           // 当前 op id
  dir: "decode",        // "encode" | "decode"
  params: {},           // 当前 op 的参数值
  navCollapsed: false,  // 侧栏 rail 折叠态（仿 Win11 任务管理器：只留图标）
  expandedCats: [],     // 展开二级菜单的分类 id 集合（支持多个同时展开，非手风琴）
 // 首页一把梭输入缓存（切到别的菜单再回首页，输入/工具栏不丢）
  home: { input: "", crib: "", intensive: false },
  _routing: false,      // 路由驱动渲染时置位，避免 selectOp 回写 hash 造成回环
  _animatedCats: [],    // 已放过展开动画的分类集合，防 selectOp 重渲染时二级菜单动画重放
  ioFont: 17,           // IO 框字号（会话态，不持久化），A-/A+ 调节，范围 11-28（默认 17）
  navW: 0,              // 侧栏拖拽宽度（会话态，不持久化，0=用 CSS 默认）
};
// 折叠态从 localStorage 恢复（记住用户偏好）
try { state.navCollapsed = localStorage.getItem("ebctf_nav_collapsed") === "1"; } catch { /* 隐私模式忽略 */ }

// 启动接线「增强随机安全」——读 ebctf_rand_config 注入 randSource 内存单例，
// 并订阅后续变更（含 randomSecure op 内切换档位）持久化。默认缺省 = system（行为不变）。
try { installRandConfig(); } catch { /* 存储异常按默认 system 兜底 */ }

// ============ 工具函数 ============
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) {
    if (c == null) continue;
    n.append(c.nodeType ? c : document.createTextNode(c));
  }
  return n;
}
function msym(name, cls = "") {
  const span = el("span", { class: "msym " + cls });
  span.innerHTML = iconSvg(name);
  return span;
}

// 给非原生可聚焦元素（div 当按钮用）补键盘可达性：role=button + tabindex + Enter/Space 触发。
// 侧栏一级导航项、折叠开关、置顶项都是 div onclick，键盘用户 Tab 不到——用本 helper 补齐。
// 返回可摊进 el attrs 的对象（含 role/tabindex/onkeydown），fn 是激活回调（与 onclick 同）。
function keyBtn(fn) {
  return {
    role: "button",
    tabindex: "0",
    onkeydown: (e) => {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        fn(e);
      }
    },
  };
}

// 主 IO 编辑区工厂：contenteditable <div> 取代 <textarea>，让天珩全字库的
// OpenType 特性（calt/liga/ccmp 连字·上下文替换·组合）走正常文本渲染管线真正生效
// （textarea 渲染限制会吞掉这些特性）。
// 关键设计：在 div 上把 .value 代理到 textContent（纯文本，杜绝 HTML 注入 + 保留换行语义）
// 这样原有大量 `el.value` 读写代码几乎无需改动即可透明工作。
// - readonly:true → contenteditable="false"（仍可选中复制），加 .io-readonly 类
// - placeholder → data-placeholder + CSS :empty::before 模拟（div 无原生 placeholder）
// - 粘贴强制纯文本（execCommand insertText / clipboardData text/plain）
// - Enter 插入纯 "\n"（避免浏览器塞 <div>/<br> 导致 textContent 丢换行）
function ioArea(attrs = {}) {
  const a = { ...attrs };
  const ph = a.placeholder; delete a.placeholder;
  const ro = a.readonly === true || a.readonly === ""; delete a.readonly;
  delete a.spellcheck; delete a.rows; // div 上无意义，统一处理
  const div = el("div", a);
  div.setAttribute("contenteditable", ro ? "false" : "true");
  div.setAttribute("spellcheck", "false");
  if (ph) div.setAttribute("data-placeholder", ph);
  if (ro) div.classList.add("io-readonly");
 // .value 代理 textContent：读写纯文本，保留换行（配合 CSS white-space:pre-wrap）
  Object.defineProperty(div, "value", {
    get() { return this.textContent; },
    set(v) { this.textContent = v == null ? "" : String(v); },
    configurable: true,
  });
  if (!ro) {
 // 粘贴净化：只取纯文本，杜绝富文本/HTML 注入。
 // 不用 execCommand("insertText")：Chromium 会吞 \n（多行矩阵被拍平成单行）且返回 true，
 // 兜底分支永不触发。改为 Range 直插文本节点（.io-area 为 pre-wrap，\n 语义正确），
 // 并手动补发 input 事件（程序化 DOM 变更不触发原生 input，上层状态同步依赖它）。
    div.addEventListener("paste", (e) => {
      e.preventDefault();
      const cd = e.clipboardData || window.clipboardData;
      const text = cd ? cd.getData("text/plain") : "";
      if (!text) return;
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node); range.collapse(true);
        sel.removeAllRanges(); sel.addRange(range);
      } else {
        div.textContent = div.textContent + text;
      }
      div.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
 // Enter → 纯 "\n"（不让浏览器插入 <div>/<br>，保证 textContent 换行语义正确）。
 // Ctrl/Meta+Enter 放行给上层的 convert 快捷键；Shift+Enter 也走纯换行。
 // 同粘贴：execCommand("insertText", "\n") 在 Chromium 吞换行 → Range 直插 + 补发 input。
    div.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const sel = window.getSelection();
        if (sel && sel.rangeCount) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const node = document.createTextNode("\n");
          range.insertNode(node);
          range.setStartAfter(node); range.collapse(true);
          sel.removeAllRanges(); sel.addRange(range);
          div.dispatchEvent(new InputEvent("input", { bubbles: true }));
        }
      }
    });
 // 保险：内容删空后清掉浏览器残留的 <br>，让 :empty placeholder 重新生效
    div.addEventListener("input", () => {
      if (div.textContent === "") div.innerHTML = "";
    });
  }
  return div;
}

// 编辑框记事本化——全选 / 导出 / 快捷键。
// 全选 io-area（textarea 与 contenteditable div 两种形态都要处理）。
function selectAllIO(area) {
  try {
    if (typeof area.select === "function") { area.select(); return; }
 // contenteditable div：用 Range 选中全部子节点
    const sel = window.getSelection();
    if (!sel) return;
    const range = document.createRange();
    range.selectNodeContents(area);
    sel.removeAllRanges();
    sel.addRange(range);
    area.focus();
  } catch { /* 忽略 */ }
}
// 导出文本为 .txt 文件（纯前端 Blob，零外发）。fname 缺省带时间戳。
function exportTextAsFile(text, fname) {
  try {
    const name = fname || ("ebctf-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + ".txt");
    const blob = new Blob([text == null ? "" : String(text)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { /* 忽略 */ }
}
// 给 io-area 挂记事本快捷键：Ctrl+A 全选（div 形态浏览器默认可能越界选到全页，显式接管）
// Ctrl+S 导出为 txt（拦截浏览器保存网页）。Ctrl+Z 撤销走浏览器/contenteditable 原生，不干预。
function attachEditorShortcuts(area, opts = {}) {
  area.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "a") { e.preventDefault(); selectAllIO(area); }
      else if (k === "s") { e.preventDefault(); exportTextAsFile(area.value, opts.exportName); }
    }
  });
}

let _toastTimer = null;
function toast(msg) {
  document.querySelector(".toast")?.remove();
  const t = el("div", { class: "toast" }, msg);
  document.body.append(t);
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.remove(), 2000);
}

// Bounded click arbitration, not the OS double-click setting (unavailable on the Web).
const RECIPE_CLICK_WAIT_MS = 600;
const recipeClickTimers = new WeakMap();
function isRecipeRoute() {
  return location.hash === "#/recipe" || location.hash.startsWith("#/recipe?");
}
function recipeAwareClick(event, navigate) {
  if (event.ctrlKey || event.metaKey || event.button === 1) return;
  event.preventDefault();
  event.stopPropagation();
  if (!isRecipeRoute()) { navigate(); return; }
  const target = event.currentTarget;
  cancelRecipeSingleClick(event);
  // Keyboard / assistive activation has no pointer double-click to arbitrate.
  if (event.detail === 0) { navigate(); return; }
  const route = location.hash;
  recipeClickTimers.set(target, setTimeout(() => {
    recipeClickTimers.delete(target);
    // A closed search result or a departed recipe must not navigate later.
    if (target.isConnected && location.hash === route && isRecipeRoute()) navigate();
  }, RECIPE_CLICK_WAIT_MS));
}
function cancelRecipeSingleClick(event) {
  const target = event.currentTarget;
  clearTimeout(recipeClickTimers.get(target));
  recipeClickTimers.delete(target);
}
function recipeOpDoubleClick(event, opId) {
  if (!isRecipeRoute() || event.ctrlKey || event.metaKey || event.button === 1) return;
  event.preventDefault();
  event.stopPropagation();
  cancelRecipeSingleClick(event);
  const result = appendRecipeOpToTail(opId);
  if (!result.ok) {
    const zh = String(getLocale()).toLowerCase().startsWith("zh");
    toast(result.reason === "requiresBridge"
      ? (zh ? "外部程序不能加入配方链" : "External tools cannot be added to a recipe")
      : (zh ? "无法加入配方链" : "Could not add operation to recipe"));
  }
}
function recipeFamilyDoubleClick(event, familyId) {
  if (!isRecipeRoute() || event.ctrlKey || event.metaKey || event.button === 1) return;
  event.preventDefault();
  event.stopPropagation();
  cancelRecipeSingleClick(event);
  const rect = event.currentTarget.getBoundingClientRect();
  openRecipeFamilyAtTail(familyId, rect.right, rect.top);
}

// ============ 左侧导航渲染 ============
// 结构：顶部折叠开关（rail toggle）+ 分类列表。
// 每个分类是可展开的手风琴：点分类头 → 展开二级菜单（该分类全部 op），再点某 op → selectOp。
// 折叠态（rail）：只留图标，hover 出 tooltip；点分类图标直接跳该分类首个 op（无处摆二级）。
// 窄屏（≤860px）CSS 强制 rail（topbar-responsive.css），JS 侧必须同步此态，否则二级菜单在 60px 宽的
// rail 里渲染成横向溢出（穿模）。navRail() = 用户手动折叠 或 视口窄到断点。断点值与 topbar-responsive.css
// / customImplEditor 一致（860px）。
const NAV_RAIL_BP = 860;
function navRail() {
  return state.navCollapsed || window.innerWidth <= NAV_RAIL_BP;
}
function renderNav() {
  $nav.innerHTML = "";
  $nav.classList.toggle("collapsed", navRail());
 // 收起态清空动画追踪：下次展开任意分类都重新播入场动画
  if (!state.expandedCats.length) state._animatedCats = [];

 // 折叠/展开开关（顶部）
  const toggle = el("div",
    { class: "nav-toggle", title: navRail() ? t("ui.nav.expand") : t("ui.nav.collapse"),
      "aria-label": navRail() ? t("ui.nav.expand") : t("ui.nav.collapse"),
      onclick: toggleNav, ...keyBtn(toggleNav) },
    msym(navRail() ? "chevron_right" : "chevron_left"),
  );
  $nav.append(toggle);

  for (const cat of CATEGORIES) {
    if (cat.id === "base") $nav.append(renderFavNav());
    const isHome = cat.id === "home";
    const count = isHome ? 0 : opsByCat(cat.id).length;
    const curCat = state.view === "op" ? getOp(state.opId)?.cat : (state.view === "home" ? "home" : null);
    const active = curCat === cat.id;
    const expanded = state.expandedCats.includes(cat.id) && !navRail() && !isHome;

    const item = el("div",
      { class: "nav-item" + (active ? " on" : "") + (cat.pinned ? " pinned" : "") + (expanded ? " expanded" : "") + (cat.id.startsWith("bridge") ? " bridge" : ""),
        title: navRail() ? catName(cat) : "",
        onclick: (e) => onNavClick(cat, e.currentTarget), ...keyBtn(() => onNavClick(cat)) },
      msym(cat.icon),
      el("span", { class: "nav-label" }, catName(cat)),
      count ? el("span", { class: "nav-count" }, String(count)) : null,
      isHome || navRail() ? null : msym(expanded ? "expand_more" : "chevron_right", "nav-caret"),
    );
    $nav.append(item);

 // 配方链导航置顶项——紧贴「首页·一把梭」下方，与首页并列为顶级入口。
 // 配方链是多操作串联工作台（顶栏也有入口），这里给导航一个显眼置顶项，减少一次找。
    if (isHome) {
      const recipeActive = state.view === "recipe";
      const recipeItem = el("div",
        { class: "nav-item nav-recipe" + (recipeActive ? " on" : ""),
          title: navRail() ? t("ui.nav.recipe") : "",
          onclick: () => goRecipe(), ...keyBtn(() => goRecipe()) },
        msym("account_tree"),
        el("span", { class: "nav-label" }, t("ui.nav.recipe")),
      );
      $nav.append(recipeItem);

 // 万能查看器导航置顶项（与智能解码并列置顶）。
      const inspectActive = state.view === "inspect";
      const inspectItem = el("div",
        { class: "nav-item nav-inspect" + (inspectActive ? " on" : ""),
          title: navRail() ? t("ui.nav.inspect") : "",
          onclick: () => goInspect(), ...keyBtn(() => goInspect()) },
        msym("visibility"),
        el("span", { class: "nav-label" }, t("ui.nav.inspect")),
      );
      $nav.append(inspectItem);

 // 编码图查询器导航置顶项（图形编码对照图鉴）。
      const codeimgActive = state.view === "codeimg";
      const codeimgItem = el("div",
        { class: "nav-item nav-codeimg" + (codeimgActive ? " on" : ""),
          title: navRail() ? t("ui.nav.codeimg") : "",
          onclick: () => goCodeImg(), ...keyBtn(() => goCodeImg()) },
        msym("menu_book"),
        el("span", { class: "nav-label" }, t("ui.nav.codeimg")),
      );
      $nav.append(codeimgItem);

 // 快速换算导航置顶项（程序员进制联动 + 分类单位换算）。
      const quickconvActive = state.view === "quickconv";
      const quickconvItem = el("div",
        { class: "nav-item nav-quickconv" + (quickconvActive ? " on" : ""),
          title: navRail() ? t("ui.nav.quickconv") : "",
          onclick: () => goQuickConv(), ...keyBtn(() => goQuickConv()) },
        msym("calculate"),
        el("span", { class: "nav-label" }, t("ui.nav.quickconv")),
      );
      $nav.append(quickconvItem);
    }

 // 二级菜单：展开态且非折叠时，列出该分类全部 op
    if (expanded) {
 // 仅「分类刚展开」那一刻放入场动画；已展开态下切 op（selectOp 重渲染）不重放，消除闪烁
      const justOpened = !state._animatedCats.includes(cat.id);
      const sub = el("div", { class: "nav-sub" + (justOpened ? " animate-in" : "") });
     // 算法族聚合（）：带 family 的 op 不逐条渲染，聚合为「族显示名 ×N」一条，
     // 点击进族内第一个 op（档位切换在工作区族滑块里做）。family 字段缺失时 famMap 为空，
     // 走原逐条渲染，零回归。无 family 的 op 渲染路径一字不动。
      const famMap = new Map(familyGroup(cat.id).map((g) => [g.family, g]));
      const _famDone = new Set(); // 已渲染聚合条的族（族内后续成员跳过）
      for (const op of opsByCat(cat.id)) {
        if (op.family && famMap.has(op.family)) {
          if (_famDone.has(op.family)) continue;
          _famDone.add(op.family);
          const grp = famMap.get(op.family);
          const first = grp.ops[0]; // 点族名进族内第一档 op
         // 族条目 CTF_HOT 高亮：取族内成员的最高 rank（rank 数字越小越热）
          let bestRank = 0, bestNote = "";
          for (const m of grp.ops) {
            const md = CTF_HOT.has(m.id) ? CTF_HOT_META[m.id] : null;
            if (!md) continue;
            const r = md.rank || 2;
            if (!bestRank || r < bestRank) { bestRank = r; bestNote = md.note || ""; }
          }
          const famOn = grp.ops.some((m) => m.id === state.opId); // 当前 op 在族内 → 族条目高亮 on
          const fa = el("a",
            { class: "nav-subitem nav-family"
              + (famOn ? " on" : "")
              + (bestRank ? " ctf-hot" : "")
              + (bestRank === 1 ? " ctf-hot-top" : ""),
              href: "#/op/" + first.id,
              draggable: "true",
               title: bestNote,
               oncontextmenu: e => showFavoriteMenu(e, { entries: grp.ops.map(m => ({ opId: m.id, label: opName(m) })) }),
              onclick: (e) => recipeAwareClick(e, () => selectOp(first.id)),
              ondblclick: (e) => recipeFamilyDoubleClick(e, grp.family),
              ondragstart: (e) => {
                if (!e.dataTransfer) return;
                e.dataTransfer.effectAllowed = "copy";
                // ：族条目额外携带 family MIME → 配方链 drop 时弹选档菜单（旧口径只能拖进第一档）
                try { e.dataTransfer.setData("application/x-ebctf-family", grp.family); } catch { /* 某些环境禁用 */ }
                try { e.dataTransfer.setData("application/x-ebctf-op", first.id); } catch { /* 某些环境禁用 */ }
                try { e.dataTransfer.setData("text/plain", grp.name); } catch { /* 忽略 */ }
              } },
            el("span", { class: "nav-subitem-label" }, grp.name),
            // ×N 乘数用高亮标签（）：防误读成「两倍 xxx 算法」
            el("span", { class: "fam-count" }, "×" + grp.ops.length),
          );
          sub.append(fa);
          attachTouchDragToRecipe(fa, () => first.id, () => grp.family);
          continue;
        }
        const hot = CTF_HOT.has(op.id);            // CTF 常考项高亮
        const meta = hot ? CTF_HOT_META[op.id] : null;
        const cls = "nav-subitem"
          + (state.opId === op.id ? " on" : "")
          + (op.requiresBridge ? " bridge" : "")
          + (hot ? " ctf-hot" : "")
          + (meta && meta.rank === 1 ? " ctf-hot-top" : "");
 // 渲成 <a href="#/op/id">，中键/Ctrl 点可在新标签打开；左键仍走 SPA 选中
        const a = el("a",
          { class: cls, href: "#/op/" + op.id,
            draggable: "true",   // 可拖到配方链画布追加/插入节点（不在画布 drop 则无副作用）
             title: meta ? meta.note : "",
             oncontextmenu: e => showFavoriteMenu(e, { opId: op.id }),
            onclick: (e) => recipeAwareClick(e, () => selectOp(op.id)),
            ondblclick: (e) => recipeOpDoubleClick(e, op.id),
            ondragstart: (e) => {
 // 自定义 MIME 承载 opId，供 recipeView 画布识别；同带 text/plain 兜底不破坏原生行为
              if (!e.dataTransfer) return;
              e.dataTransfer.effectAllowed = "copy";
              try { e.dataTransfer.setData("application/x-ebctf-op", op.id); } catch { /* 某些环境禁用 */ }
              try { e.dataTransfer.setData("text/plain", opName(op)); } catch { /* 忽略 */ }
            } },
          op.requiresBridge ? el("span", { class: "exe-badge" }, "EXE") : null,
          el("span", { class: "nav-subitem-label" }, opName(op)),
        );
        sub.append(a);
        attachTouchDragToRecipe(a, () => op.id);
      }
      $nav.append(sub);
      if (!state._animatedCats.includes(cat.id)) state._animatedCats.push(cat.id); // 记录已放过动画的分类
    }

    if (cat.pinned) $nav.append(el("div", { class: "nav-sep" }));
  }
}

let warnedFavoriteStorage = false;
function showFavoriteMenu(event, options) {
  event.preventDefault();
  event.stopPropagation();
  const rect = event.currentTarget.getBoundingClientRect();
  openFavMenu(event.clientX || rect.left, event.clientY || rect.bottom, { ...options, onChange: favoritesChanged });
}
function favoritesChanged(result) {
  if (result?.full) toast(t("ui.fav.full"));
  else if (result?.persisted === false && !warnedFavoriteStorage) {
    warnedFavoriteStorage = true;
    toast(t("ui.fav.storageFail"));
  }
  renderNav();
  const button = document.querySelector(".fav-btn");
  if (button) {
    const active = isFavorite(state.opId);
    button.classList.toggle("on", active);
    button.setAttribute("aria-pressed", String(active));
    button.title = t(active ? "ui.fav.remove" : "ui.fav.add");
    button.setAttribute("aria-label", button.title);
  }
  document.querySelectorAll(".op-search-item[data-opid]").forEach(item => {
    item.querySelector(".op-search-item-fav")?.remove();
    if (isFavorite(item.dataset.opid)) item.querySelector(".op-search-item-main")?.append(el("span", { class: "op-search-item-fav", "aria-hidden": "true" }, msym("star")));
  });
}

function renderFavNav() {
  const fragment = document.createDocumentFragment();
  const ops = loadFavorites().map(getOp).filter(Boolean);
  const expanded = state.expandedCats.includes("fav") && !navRail();
  const toggle = () => {
    if (navRail()) { if (ops.length) selectOp(ops[0].id); return; }
    if (expanded) state.expandedCats = state.expandedCats.filter(id => id !== "fav");
    else state.expandedCats.push("fav");
    renderNav();
  };
  fragment.append(el("div", {
    class: "nav-item nav-fav" + (expanded ? " expanded" : ""),
    title: t("ui.fav.cat"), "aria-expanded": String(expanded), ...keyBtn(toggle),
    onclick: toggle,
    oncontextmenu: event => {
      event.preventDefault(); event.stopPropagation();
      openFavMenu(event.clientX, event.clientY, { onChange: favoritesChanged });
    },
  }, msym("star"), el("span", { class: "nav-label" }, t("ui.fav.cat")),
  el("span", { class: "nav-count" }, String(ops.length))));
  if (expanded) {
    const sub = el("div", { class: "nav-sub" });
    if (!ops.length) sub.append(el("div", { class: "fav-empty" },
      el("div", {}, t("ui.fav.emptyNone")),
      el("div", { class: "fav-empty-hint" }, t("ui.fav.emptyHint"))));
    for (const op of ops) {
      sub.append(el("a", {
        class: "nav-subitem" + (state.opId === op.id ? " on" : ""), href: "#/op/" + op.id,
        onclick: event => recipeAwareClick(event, () => selectOp(op.id)),
        ondblclick: event => recipeOpDoubleClick(event, op.id),
        oncontextmenu: event => {
          event.preventDefault(); event.stopPropagation();
          openFavMenu(event.clientX, event.clientY, { opId: op.id, onChange: favoritesChanged });
        },
      }, msym("star"), el("span", { class: "nav-subitem-label" }, opName(op))));
    }
    fragment.append(sub);
  }
  return fragment;
}

function toggleNav() {
  state.navCollapsed = !state.navCollapsed;
  if (state.navCollapsed) state.expandedCats = []; // 折叠时收起所有二级
  try { localStorage.setItem("ebctf_nav_collapsed", state.navCollapsed ? "1" : "0"); } catch { /* 忽略 */ }
  renderNav();
}

function onNavClick(cat, itemEl) {
  if (cat.id === "home") {
    goHome();
    return;
  }
  const ops = opsByCat(cat.id);
  if (!ops.length) { toast(t("ui.op.emptyCat", catName(cat))); return; }

 // 折叠态（含窄屏 rail）：没地方摆二级菜单，直接跳该分类首个 op
  if (navRail()) { selectOp(ops[0].id); return; }

 // 展开态：点已展开的分类头 → 收起；否则展开。支持多个分类同时展开（非手风琴）。
  const collapsing = state.expandedCats.includes(cat.id);
  // 减动效改由应用内开关（html.reduce-motion 类）驱动，不再读 OS 偏好——
  // 部分 Windows 关闭「动画效果」会导致用户永远看不到动画（实机确诊，2026-09-09 产品裁决）
  const noMotion = document.documentElement.classList.contains("reduce-motion");
  const springOn = !noMotion && document.documentElement.classList.contains("spring-motion");
  const sub = itemEl && itemEl.nextElementSibling;

  if (collapsing) {
    state.expandedCats = state.expandedCats.filter((c) => c !== cat.id);
    // M3 高度收起动画（emphasized-accelerate）后再重渲染；无元素/减动效则立即重渲染
    if (!noMotion && sub && sub.classList && sub.classList.contains("nav-sub")) {
      if (springOn) {
        // 弹簧收拉：高度仍走 CSS（弹簧内核无 height 属性），位移/透明度走弹簧
        // （velocity carry——收拉途中反向点不跳变，安卓14 手感）；onRest+兜底双守卫防双渲染
        sub.style.height = sub.scrollHeight + "px";
        sub.style.transition = "height 250ms cubic-bezier(.3, 0, .8, .15)";
        requestAnimationFrame(() => { sub.style.height = "0px"; });
        let done = false;
        const fin = () => { if (done) return; done = true; renderNav(); };
        HLSpring.to(sub, { y: -8, opacity: 0 }, { preset: "dur250", onRest: () => fin() });
        setTimeout(fin, 400);
      } else {
        sub.style.height = sub.scrollHeight + "px";
        sub.style.transition = "height 250ms cubic-bezier(.3, 0, .8, .15), opacity 150ms linear";
        requestAnimationFrame(() => { sub.style.height = "0px"; sub.style.opacity = "0"; });
        setTimeout(renderNav, 250);
      }
    } else {
      renderNav();
    }
    return;
  }

  state.expandedCats = [...state.expandedCats, cat.id];
  // ：renderNav 会重建整个导航 DOM，itemEl 随即脱离文档；先记序号，渲染后按序号取新元素
  const navIdx = itemEl ? [...$nav.querySelectorAll(".nav-item")].indexOf(itemEl) : -1;
  renderNav();
  // M3 高度展开动画（emphasized-decelerate 400ms=M3 ¾ 档恰合 M3 long1 标准档；与原 fade/translate 入场叠加）
  const newItem = navIdx >= 0 ? [...$nav.querySelectorAll(".nav-item")][navIdx] : null;
  const sub2 = newItem && newItem.nextElementSibling;
  if (!noMotion && sub2 && sub2.classList && sub2.classList.contains("nav-sub")) {
    const h = sub2.scrollHeight;
    sub2.style.transition = "none";
    sub2.style.height = "0px";
    if (springOn) HLSpring.set(sub2, { y: -8, opacity: 0 }); // 入场改弹簧（替换 .animate-in CSS 动画，CSS 侧已门控）
    requestAnimationFrame(() => {
      sub2.style.transition = "height 400ms cubic-bezier(.05, .7, .1, 1)";
      sub2.style.height = h + "px";
      if (springOn) HLSpring.to(sub2, { y: 0, opacity: 1 }, "dur250");
      const done = () => { sub2.style.height = ""; sub2.style.transition = ""; };
      sub2.addEventListener("transitionend", done, { once: true });
      setTimeout(done, 500); // 兜底，防 transitionend 丢失导致高度卡死
    });
  }
}

// 回首页（首页输入已存 state.homeInput，renderHome 会自动恢复，进度不丢）
function goHome() {
  state.view = "home";
  state.opId = null;
  state.expandedCats = [];
  writeHash("#/home");
  renderNav();
  renderWorkspace();
}

function selectOp(id) {
  const op = getOp(id);
  if (!op) return;
 // 惰载：stub 未落地时先按需加载算法文件，就绪后重入（列表/搜索等元数据面不受影响）
  if (op.__stub) { ensureOp(id).then(() => selectOp(id)).catch((e) => toast(String((e && e.message) || e))); return; }
  state.view = "op";
  state.opId = id;
  state.params = defaultParams(op);
  if (!state.expandedCats.includes(op.cat)) state.expandedCats.push(op.cat); // 保持该 op 所在分类展开，二级菜单高亮当前 op
 // 单向 run 工具无方向；双向的默认 decode（CTF 场景解码为主）
  state.dir = op.decode ? "decode" : (op.encode ? "encode" : "run");
  writeHash("#/op/" + id);   // 地址栏反映当前 op，可中键多开 / 刷新保持
  renderNav();
  renderWorkspace();
}

// ============ hash 路由（可中键新标签多开、刷新/分享定位到具体 op）============
// 路由形态：#/home（首页一把梭）、#/op/<opId>（某个功能）。
// writeHash 带 _routing 标志，避免自己写 hash 又触发 hashchange 造成二次渲染。
let _routing = false;
// 授权信息（启动异步 loadLicense 填入；未读到前按开源自编译默认显示）。
let _license = OPENSOURCE_LICENSE;
// 授权自定义软件名（2026-09-13 产品负责人新需求）：license payload.appName（签名保护）优先，
// 未声明回退 i18n 内置名。消费者：顶栏品牌/页面标题/关于页应用名。
function appDisplayName() {
  return (_license && _license.verified && _license.appName) || null;
}
function writeHash(h) {
  if (location.hash === h) return;
  _routing = true;
  location.hash = h;
 // hashchange 是异步派发，下一拍复位标志
  setTimeout(() => { _routing = false; }, 0);
}
function applyRoute() {
  const h = location.hash || "";
  const m = h.match(/^#\/op\/(.+)$/);
  if (h === "#/recipe") {
    state.view = "recipe";
    state.opId = null;
    state.expandedCats = [];
    renderNav();
    renderWorkspace();
  } else if (h === "#/exhaust") {
    state.view = "exhaust";
    state.opId = null;
    state.expandedCats = [];
    renderNav();
    renderWorkspace();
  } else if (h === "#/inspect") {
    state.view = "inspect";
    state.opId = null;
    state.expandedCats = [];
    renderNav();
    renderWorkspace();
  } else if (h === "#/codeimg") {
    state.view = "codeimg";
    state.opId = null;
    state.expandedCats = [];
    renderNav();
    renderWorkspace();
  } else if (h === "#/quickconv") {
    state.view = "quickconv";
    state.opId = null;
    state.expandedCats = [];
    renderNav();
    renderWorkspace();
  } else if (h === "#/about") {
    state.view = "about";
    state.opId = null;
    state.expandedCats = [];
    renderNav();
    renderWorkspace();
  } else if (h === "#/plugins") {
    state.view = "plugins";
    state.opId = null;
    state.expandedCats = [];
    renderNav();
    renderWorkspace();
  } else if (m && getOp(decodeURIComponent(m[1]))) {
    selectOpFromRoute(decodeURIComponent(m[1]));
  } else if (m && decodeURIComponent(m[1]) === "hexView") {
    // ：hexView op 已移除，旧深链迁移到字符显示器（默认 Hex+ASCII 视图，可拖入文件）。
    // 不伪造同 id op 把计数加回来；URL 同步改写为 #/inspect，避免刷新重复走迁移分支。
    state.view = "inspect";
    state.opId = null;
    state.expandedCats = [];
    renderNav();
    renderWorkspace();
    writeHash("#/inspect");
    toast("「十六进制查看器」op 已移除：请改用字符显示器的 Hex+ASCII 视图（支持拖入文件）。");
  } else {
 // 无匹配 / #/home → 首页
    state.view = "home";
    state.opId = null;
    state.expandedCats = [];
    renderNav();
    renderWorkspace();
  }
}
// 与 selectOp 相同，但不再回写 hash（本身就是被 hash 驱动进来的），防循环
function selectOpFromRoute(id) {
  const op = getOp(id);
  if (!op) return;
 // 惰载：深链直达未加载 op 时先按需加载，就绪后重入
  if (op.__stub) { ensureOp(id).then(() => selectOpFromRoute(id)).catch((e) => toast(String((e && e.message) || e))); return; }
  state.view = "op";
  state.opId = id;
  state.params = defaultParams(op);
  if (!state.expandedCats.includes(op.cat)) state.expandedCats.push(op.cat);
  state.dir = op.decode ? "decode" : (op.encode ? "encode" : "run");
  renderNav();
  renderWorkspace();
}
window.addEventListener("hashchange", () => {
  if (_routing) return; // 自己 writeHash 触发的，状态已同步，跳过
  applyRoute();
});

// ============ 工作区渲染 ============
// 上次渲染的 view/opId——用于「真实视图切换才取消」的判定（见 renderWorkspaceInner 内）。
let _wsView = null, _wsOpId = null;
function renderWorkspaceInner() {
  // 离开字符显示器视图：释放 _rerender 闭包对旧视图 DOM 的引用（性能审计 H3，
  // hex 满载可达 13.9 万节点，不释放则逛其他视图的整段时间不可回收）
  if (state.view !== "inspect") disposeInspectView();
 // 真实视图切换（含 op→op）即取消在途重运算——此前取消仅运行卡按钮一处调用点，
 // 切页后结果无处落地但 Worker 继续满载至自然结束（Worker 池常驻复用，terminate 后惰性
 // 重建，无破坏性）。仅在 view/opId 变化时取消：视图内重渲染（edu 懒加载/语言切换等
 // 同 view 重渲）不触发，避免误杀。
  if (state.view !== _wsView || state.opId !== _wsOpId) {
    if (opRunBusy()) cancelOpRun();
    _wsView = state.view;
    _wsOpId = state.opId;
  }
  $ws.innerHTML = "";
  if (state.view === "home") return renderHome();
  if (state.view === "recipe") return renderRecipe($ws);
  if (state.view === "exhaust") return renderExhaustive($ws);
  if (state.view === "inspect") {
 // 懒载（MT717）：首次切入才 import；import 完成时已切走则不渲染（竞态保护）
    return loadInspectView()
      .then((m) => { if (state.view === "inspect") m.renderUniversalViewer($ws); })
      .catch((e) => { console.error("[inspect] 视图懒载失败：", e); });
  }
  if (state.view === "codeimg") return renderCodeImageViewer($ws);
  if (state.view === "quickconv") {
    return loadQuickConvView()
      .then((m) => { if (state.view === "quickconv") m.renderQuickConv($ws); })
      .catch((e) => { console.error("[quickconv] 视图懒载失败：", e); });
  }
  if (state.view === "about") return renderAbout($ws);
  if (state.view === "plugins") return renderPluginsView($ws);
  return renderOp();
}

// 切页过渡（产品负责人 2026-09-13 二批反馈定稿：「不要弹动感，要从无到有的平滑过渡，动画要快，
// 页面类的不要弹动」）：新内容渲染完成后容器纯淡入 150ms 无弹档——不加任何位移，杜绝弹跳感。
// 同帧 set+to，初隐被重建内容遮住。仅 spring-motion 开时播；首屏不播；reduce-motion 下直切。
let _wsMotionSeen = false;
function renderWorkspace() {
  const first = !_wsMotionSeen;
  renderWorkspaceInner();
  _wsMotionSeen = true;
  if (first || !document.documentElement.classList.contains("spring-motion")) return;
  HLSpring.set($ws, { opacity: 0 });
  HLSpring.to($ws, { opacity: 1 }, "dur150");
}

// 进入配方链视图
function goRecipe() {
  state.view = "recipe";
  state.opId = null;
  state.expandedCats = [];
  writeHash("#/recipe");
  renderNav();
  renderWorkspace();
}

// 进入万能查看器视图
function goInspect() {
  state.view = "inspect";
  state.opId = null;
  state.expandedCats = [];
  writeHash("#/inspect");
  renderNav();
  renderWorkspace();
}

// 进入编码图鉴视图（编码图鉴查询器）
function goCodeImg() {
  state.view = "codeimg";
  state.opId = null;
  state.expandedCats = [];
  writeHash("#/codeimg");
  renderNav();
  renderWorkspace();
}

// 进入快速换算视图（程序员进制联动 + 分类单位换算）
function goQuickConv() {
  state.view = "quickconv";
  state.opId = null;
  state.expandedCats = [];
  writeHash("#/quickconv");
  renderNav();
  renderWorkspace();
}

// 进入关于页（独立路由 #/about，非弹窗，工作区内渲染，与 op 页同形）
function goAbout() {
  state.view = "about";
  state.opId = null;
  state.expandedCats = [];
  writeHash("#/about");
  renderNav();
  renderWorkspace();
}

// 进入插件/MCP 页（独立路由 #/plugins，工作区内渲染，非弹窗）。
function goPlugins() {
  state.view = "plugins";
  state.opId = null;
  state.expandedCats = [];
  writeHash("#/plugins");
  renderNav();
  renderWorkspace();
}

// 插件页渲染：懒加载面板 UI（不拖首屏），渲染进工作区容器。
function renderPluginsView(host) {
  import("./ui/pluginPanel.js")
    .then(({ renderPluginsPage }) => renderPluginsPage(host))
    .catch((e) => {
      host.append(el("p", { class: "plugin-empty" },
        t("ui.plugin.loadErr", e && e.message ? e.message : e)));
    });
}

// ---- 一把梭首页（Magic 智能识别）----
function renderHome() {
  const wrap = el("div", { class: "home-hero" });
  wrap.append(
    el("div", { class: "op-head" },
      el("div", { class: "op-title" }, msym("bolt_filled"), t("ui.home.title")),
      el("div", { class: "op-desc" }, t("ui.home.desc")),
    ),
  );

 // Magic 工具栏：crib 目标特征 + intensive 深度爆破开关
  const targetEditor = createTargetEditor();
 // 密钥框（需求3）：填了 key → 一键解码把 AES/DES/RC4/XOR/vigenere 等带密钥加解密 op
 // 也纳入尝试，用 CTF 常考默认参数（IV=0、常见模式/编码组合）一起跑。空则不试 keyed。
  const keyInput = el("input", {
    type: "text", class: "magic-crib magic-key",
    placeholder: t("ui.home.keyPlaceholder"),
    spellcheck: "false",
  });
  keyInput.value = state.homeKey || "";
 // 解码强度（替代原「深度爆破 / 多层链式」两个裸开关）：按钮开弹窗，
 // 内含 5 档预设滑块（快速→最强，按 CTF 考点热→冷逐层放开）+ 参与算法多选 + 命名方案。
 // 文本/文件两套配置各存各的（弹窗内切页签）。配置存 localStorage，回首页沿用上次。
 // 强度档决定：参与哪些 op（allowOps 白名单）+ 层数/暴力/参数网格/时间预算，见 core/decodeProfile.js。
 // 配置形状 = 双作用域 { text:{level,customIds}, file:{level,customIds} }（与弹窗契约一致）。
 // 首页文本解码用 .text；拖入文件走 .file。两套各自持久化（localStorage，见 decodeProfile）。
  if (state.homeStrength === undefined) {
    state.homeStrength = loadLastConfig("text") || { level: "normal", customIds: [] };
  }
  const strengthBtn = el("button", { class: "act-btn magic-strength-btn", type: "button" },
    msym("tune"), el("span", { class: "magic-strength-text" }, ""));
  const syncStrengthBtn = () => {
    const cfg = state.homeStrength || { level: "normal", customIds: [] };
    const lvName = t("ui.ds.level." + (cfg.level || "normal"));
    const n = (cfg.customIds || []).length;
    strengthBtn.querySelector(".magic-strength-text").textContent =
      t("ui.home.strengthBtn") + "：" + lvName + (cfg.level === "custom" ? `(${n})` : "");
  };
  syncStrengthBtn();
  strengthBtn.addEventListener("click", () => {
    openDecodeStrength({
      cfg: { text: state.homeStrength },    // 弹窗仍接受 text 键名（兼容旧形状的 src = cfg.text）
      onApply: (cfg) => {
        state.homeStrength = cfg;            // cfg 现在是 {level, customIds} 单层
        saveLastConfig(cfg, "text");
        syncStrengthBtn();
      },
    });
  });
  const runBtn = el("button", { class: "act-btn primary magic-run" },
    msym("bolt"), el("span", {}, t("ui.home.runBtn")));
  const toolbar = el("div", { class: "magic-toolbar" },
 // 第一行：目标特征
    el("div", { class: "magic-row" },
      targetEditor.element,
    ),
 // 第二行：密钥
    el("div", { class: "magic-row" },
      el("label", { class: "magic-crib-label" }, t("ui.home.keyLabel"), keyInput),
    ),
 // 第三行：解码强度 + 一键解码按钮
    el("div", { class: "magic-row magic-row-actions" },
      strengthBtn,
      runBtn,
    ),
  );

 // 单一输入框：输入 = 拖放。粘贴文本 → Magic 解码；拖入文件 → 文本读内容解码，二进制跑 analyzeFile。
  const input = ioArea({
    class: "io-area home-input", placeholder: t("ui.home.placeholder"),
  });
  input.value = state.homeInput || "";              // 恢复上次输入，切菜单再回来进度不丢
  const fileReport = el("div", { class: "file-report" });
  const outWrap = el("div", { class: "onekey-out" });
 // 超长横幅放在输入框「上面」（原在 outWrap 里=输入框下方，看不见）。独立容器，插在 input 前。
  const topBanner = el("div", { class: "onekey-topbanner" });

 // 解码只由「点按钮」触发（force=true，绕过长度上限）。
 // 逐字输入不再自动解码——magicDecode + exhaustiveDecode 每次击键同步跑会逐字卡顿（产品裁决）。
 // 打字/改 crib/切开关只存 state，不解码；要出结果点「一键解码」按钮。
 // 文本解码取 .text 档（拖入文件的路径另取 .file 档，见 drop 处理）。
  const forceTrigger = () => runOneKey(input.value, outWrap, "", state.homeStrength, true, topBanner, keyInput.value.trim(), runBtn, targetEditor.getTargets());
  input.addEventListener("input", () => {
    state.homeInput = input.value;
   // 拖入文件的分析报告（fileReport）只属于那次拖入：一旦手写/编辑文本（新意图），
   // 文件结果立即清除——否则后续文本解码时文件卡片仍挂在 outWrap 上方，
   // 且清空工具条只清输入框，文件结果没有任何入口可清（产品负责人 09-25 报告的残留 bug）。
   // 横幅同理（上一轮的超长提示与本次输入无关）。
    fileReport.innerHTML = "";
    if (topBanner) topBanner.innerHTML = "";
  });
  keyInput.addEventListener("input", () => { state.homeKey = keyInput.value; });
 // 一键解码按钮 = 唯一解码入口。有输入才跑，空则聚焦回输入框。
  runBtn.addEventListener("click", () => { if (input.value.trim()) forceTrigger(); else input.focus(); });
 // 回车（非 Shift）也触发解码，键盘流用户方便。
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (input.value.trim()) forceTrigger(); }
  });

 // 回到首页时若有上次解码结果的输入，恢复渲染一次（不丢上次分析；一次性非逐字，不卡）。
  if ((state.homeInput || "").trim()) setTimeout(forceTrigger, 0);

 // 同一框接收拖放：文本文件读进框跑解码，二进制文件跑文件分析
  input.addEventListener("dragover", (e) => { e.preventDefault(); input.classList.add("dragover"); });
  input.addEventListener("dragleave", () => input.classList.remove("dragover"));
  input.addEventListener("drop", async (e) => {
    e.preventDefault();
    input.classList.remove("dragover");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
 // 读文件前先清空输入框 + 缓存 + 旧文件报告 + 旧解码卡片 + 旧横幅。
 // 否则框里已有文本时再拖文件，会「旧文本 + 新文件内容」各跑一遍 → 解码两次；
 // 且上一轮 outWrap 里的解码卡片不清会残留在本轮文件卡片下方（fileReport 在 outWrap 上方）。
    input.value = "";
    state.homeInput = "";
    fileReport.innerHTML = "";
    outWrap.innerHTML = "";
    if (topBanner) topBanner.innerHTML = "";
 // 令牌 +1：作废上一轮 runOneKey 的过期异步（穷举/magic 回来的迟到结果不再往 outWrap 写）。
    runOneKey._token = (runOneKey._token || 0) + 1;
    const buf = await f.arrayBuffer();
    const bytes = new Uint8Array(buf);
 // 判定文本 vs 二进制：改用「UTF-8 能否无损解码」而非高位字节占比。
 // 旧法 high/n<0.30 会把中文 UTF-8 文本（高位占比远超 30%）误判成二进制转 hex。
    if (isTextFile(bytes, f.name)) {
      input.value = new TextDecoder("utf-8").decode(bytes);
      state.homeInput = input.value;
      forceTrigger();   // 拖入文本文件 = 明确意图，直接解码一次（非逐字，不卡）
    } else {
      await handleFile(f, fileReport);
    }
  });

 // 首页一把梭输入框接通用编辑框工具条（粘贴/清空/复制/全选/导出/字号 + Ctrl+A/S）。
 // onChange 只存 state 不自动解码——解码统一由「一键解码」按钮触发（与逐字输入一致，不卡）。
  const homeToolbar = attachEditorToolbar(input, {
    onChange: () => {
      state.homeInput = input.value;
     // 工具条「清空」= 完整清场：输入 + 文件分析报告 + 解码卡片 + 横幅全部归零，
     // 不再只清输入框（文件结果/解码卡片残留且无法清理的另一半根因）。
      if (!input.value.trim()) {
        fileReport.innerHTML = "";
        outWrap.innerHTML = "";
        if (topBanner) topBanner.innerHTML = "";
      }
    },
    exportName: "onekey-input.txt",
  });

  wrap.append(toolbar, topBanner, homeToolbar, input, fileReport, outWrap);
  $ws.append(wrap);
  input.focus();
}

// 看门狗软死线（毫秒）：到点先渲染已得结果 + 倒计时读到此值，之后 Worker 后台继续。
const SOFT_DEADLINE_MS = 5000;

// 收集「启用了自定义实现」的 opId 集合（magic / 穷举排除用）。
// 直接问 store 要（一次读取），不逐个 op 查 localStorage——608 个 op 那样查会拖慢每次一键解码。
function activeCustomImplIds() {
  return listEnabledOpIds();
}

// strengthCfg = { level, customIds }（来自「解码强度」弹窗）。resolveDecodeConfig 解析成
// allowOps 白名单 + 层数/暴力/参数网格/时间预算，替代原先的 intensive/multiLayer 两个布尔。
async function runOneKey(text, outWrap, crib, strengthCfg, force = false, topBanner = null, key = "", runBtn = null, targets = loadTargetConfig().targets) {
  magicFilterReset(outWrap);
  outWrap.__rf_magic = null;
  outWrap.__rf_brute = null;
  outWrap.__rf_rerender = null;
  outWrap.innerHTML = "";
  if (topBanner) topBanner.innerHTML = "";   // 横幅容器每次运行先清空
  const q = text.trim();          // 注意：不要用 t，会遮蔽 i18n 的 t()
  if (!q) return;
 // 超 200 字符不自动解码（防爆），显示提示 + 手动触发按钮，避免用户以为坏了
  const ONEKEY_MAX_AUTO = 200;
  if (!force && q.length > ONEKEY_MAX_AUTO) {
 // 超长不自动解码，只显示一条横幅提示（一键解码按钮已在工具栏，点它 force=true 手动跑）。
 // 横幅放输入框「上面」——写入 topBanner（在 input 前）而非 outWrap（在 input 下方）。
    (topBanner || outWrap).append(el("div", { class: "onekey-banner" },
      msym("info"),
      el("div", { class: "onekey-banner-text" },
        el("span", {}, t("ui.home.tooLong", q.length, ONEKEY_MAX_AUTO)),
        el("span", { class: "onekey-banner-hint" }, t("ui.home.tooLongHint")),
      ),
    ));
    return;
  }
 // 本次运行令牌：输入变化快时丢弃过期结果，避免异步竞态覆盖
  const token = (runOneKey._token = (runOneKey._token || 0) + 1);

 // 强度档（decodeProfile.resolveDecodeConfig）产出层数/暴力/参数网格/时间预算 + op 白名单。
 // 提前解析：倒计时读秒要用档内软死线（fast 0.8s…max 8s），不能再写死 5s 否则读秒与实际不符。
  const resolved = resolveDecodeConfig(
    strengthCfg && strengthCfg.level ? strengthCfg : { level: "normal", scope: "text", customIds: [] }
  );
  const softMs = resolved.magic.softDeadlineMs || SOFT_DEADLINE_MS;

 // 看门狗倒计时（产品裁决）：一键解码按钮左边显示读秒，软死线到点先渲染已得结果、
 // 后台继续；出最终结果 / 被新输入接管则清除。runBtn 由 renderHome 传入（可空，如拖文件路径）。
  let countdownTimer = null;
  const clearCountdown = () => {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (runBtn && runBtn._cd) { runBtn._cd.remove(); runBtn._cd = null; }
  };
  const startCountdown = () => {
    if (!runBtn) return;
    clearCountdown();
    const secs = Math.max(1, Math.ceil(softMs / 1000));
    let left = secs;
    const cd = el("span", { class: "magic-countdown" }, t("ui.home.countdown", left));
    runBtn._cd = cd;
    runBtn.parentNode && runBtn.parentNode.insertBefore(cd, runBtn);
    countdownTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
 // 软死线到 → 文案转「后台继续」，不再读秒（部分结果已由 onPartial 渲染）。
        cd.textContent = t("ui.home.countdownBg");
        clearInterval(countdownTimer); countdownTimer = null;
      } else {
        cd.textContent = t("ui.home.countdown", left);
      }
    }, 1000);
  };

 // Magic 智能识别（真多线程 magicClient）：Worker 跑，主线程零阻塞（倒计时流畅）。
 // 单层默认覆盖全部编解码 op（含花式/古典）+ 综合分排序；multiLayer→maxDepth 3 多层链式（≤3）。
 // key（工具栏密钥框）→ 带密钥加解密 op（AES/DES/RC4/XOR/vigenere… + CTF 默认参数）参与。
 // onPartial：软死线（5s）到点先渲染已得结果，Worker 后台继续，最终结果到再整体重渲染。
 // allowOps=null（最强档）表示不限制，等同旧行为。resolved 已在上方（倒计时要用软死线）解析。
  const opts = { ...resolved.magic, targets };
  if (resolved.allowOps) opts.allowOps = Array.from(resolved.allowOps);  // Worker 需可结构化克隆
  opts.softDeadlineMs = softMs;
  if (crib) opts.crib = crib;
  if (key) opts.key = key;
 // 用户启用了自定义实现的 op 不进一键解码（原版结果误导 + 不跑用户代码）
  const _ciIds = activeCustomImplIds();
  if (_ciIds.length) opts.excludeOps = _ciIds;
  opts.onPartial = (parts) => {
    if (token !== runOneKey._token) return;  // 已被新输入接管，弃
    renderMagicCands(outWrap, q, parts, crib);
  };

 // 立即画原始输入卡占位（不等解码/软死线）——否则慢输入下 outWrap 已清空、5s 内画面全空，
 // 用户以为坏了。解码有结果后 renderMagicCands 整体重渲染覆盖此占位（幂等）。
  appendRawCard(outWrap, q);

  startCountdown();
  let cands;
  try {
    cands = await runMagic(q, opts);
  } catch (e) {
 // { cancelled:true } = 被新输入 / 中断接管 → 静默退出，不渲染（新任务会自己渲染）。
    if (e && e.cancelled) { clearCountdown(); return; }
    cands = [];  // 真异常降级为空结果，走「无候选」提示
  }
  clearCountdown();
  if (token !== runOneKey._token) return;  // 已有更新的输入，弃

  renderMagicCands(outWrap, q, cands, crib);

 // 暴力爆破独立通道（decodeProfile 独立池勾选的 op）：主排序之外单独归组跑，
 // 结果追加在候选区末尾、不参与 magic 综合分排序。每个 op 30s 兜底超时。
  const bruteOps = (resolved && resolved.bruteOps) || [];
  if (bruteOps.length) {
    const results = [];
    for (const opId of bruteOps) {
      const bop = getOp(opId);
      if (!bop || typeof bop.run !== "function") continue;
      if (token !== runOneKey._token) return;  // 被新输入接管，弃未跑完的爆破
      try {
        // 重爆破走独立线程：主线程零阻塞；超时到点真 terminate，不再「弃结果但跑到底」。
        const r = await runOpOffThread(bop.id, q, {}, { timeoutMs: 30000 });
        results.push({ id: bop.id, name: bop.name || bop.id, output: String(r), timedOut: false });
      } catch (e) {
        results.push({ id: bop.id, name: bop.name || bop.id, output: String((e && e.message) || e), timedOut: String(e) === "Error: timeout" });
      }
    }
    if (token === runOneKey._token && results.length) renderBruteResults(outWrap, q, results);
  }
}

// 渲染暴力爆破结果（独立通道）：追加在魔法候选区末尾，单独一个折叠区。
// run 型 op 输出是报告文本（可能很长），每项截断到 1200 字符，完整内容可点开。
function renderBruteResults(outWrap, q, results) {
  outWrap.__rf_brute = { q, results: Array.isArray(results) ? results : [] };
  renderOneKeySnapshot(outWrap);
}

function appendBruteResults(outWrap, results) {
  if (!results.length) return;
  const sec = el("details", { class: "onekey-brute" });
  sec.open = true;
  sec.append(el("summary", { class: "onekey-brute-sum" },
    msym("bolt"),
    el("span", {}, t("ui.home.bruteTitle", results.length)),
  ));
  const list = el("div", { class: "onekey-brute-list" });
  for (const r of results) {
    const body = r.timedOut ? t("ui.home.bruteTimeout") : (r.output.length > 1200 ? r.output.slice(0, 1200) + "…" : r.output);
    const item = el("details", { class: "onekey-brute-item" });
    item.append(el("summary", { class: "onekey-brute-item-sum" },
      el("span", { class: "onekey-brute-name" }, r.name),
      el("span", { class: "onekey-brute-id" }, r.id),
    ));
    item.append(el("pre", { class: "onekey-brute-out" }, body));
    list.append(item);
  }
  sec.append(list);
  outWrap.append(sec);
}

// 渲染 magic 候选（供 onPartial 部分结果 + 最终结果两处复用；每次全量重渲染 outWrap）。
// 幂等：先清空 outWrap 再画原始卡 + 摘要 + 分组卡，多次调用只是用更全的候选覆盖。
function renderMagicCands(outWrap, q, cands, crib) {
  outWrap.__rf_magic = { q, cands: Array.isArray(cands) ? cands : [], crib };
  outWrap.__rf_rerender = () => renderOneKeySnapshot(outWrap);
  renderOneKeySnapshot(outWrap);
}

function renderOneKeySnapshot(outWrap) {
  const snap = outWrap.__rf_magic;
  if (!snap) return;
  const { q, crib } = snap;
  let cands = snap.cands.slice();
  const brute = outWrap.__rf_brute ? outWrap.__rf_brute.results : [];

  outWrap.innerHTML = "";
  appendRawCard(outWrap, q);

  // Leet 假命中标记与原排序规则保持不变；筛选只取保序子集。
  const cribRe = literalMatcher(crib);
  const rawMatchesCrib = cribRe ? cribRe.test(q) : false;
  for (const c of cands) {
    c._leetFalseHit = !!(cribRe && c.matchesCrib && rawMatchesCrib && c.chain.includes("leetSpeak"));
    c._cribHit = c.matchesCrib && !c._leetFalseHit;
  }
  cands = [...cands.filter((c) => !c._leetFalseHit), ...cands.filter((c) => c._leetFalseHit)];

  const shown = filterMagicCands(outWrap, cands);
  const shownBrute = filterBruteCands(outWrap, brute);
  const total = cands.length + brute.length;
  const matched = shown.length + shownBrute.length;

  if (total) magicFilterBar(outWrap, matched, total);
  else {
    outWrap.append(el("div", { class: "onekey-empty" },
      t("ui.home.empty"),
      el("div", { class: "onekey-hint" }, t("ui.home.emptyHint")),
    ));
    return;
  }

  // 摘要也来自筛选后的保序子集；不匹配时不展示全量候选的摘要。
  if (shown.length && shown[0].chain.length > 0) {
    outWrap.append(renderSummaryCard(shown[0], resultSearchState(outWrap)));
  }

  const groups = groupSweepCands(shown);
  for (const g of groups) {
    if (g.items.length >= 2) outWrap.append(renderBruteGroupCard(g, resultSearchState(outWrap)));
    else outWrap.append(renderCandCard(g.items[0], resultSearchState(outWrap)));
  }
  appendBruteResults(outWrap, shownBrute);
}

// 把 magic 候选按「爆破基算法」分组。参数扫描候选 chain 是单元素、形如
// `caesar(shift=3)`（见 exhaustiveDecode.formatParamTag）——同一 baseOpId 的多条分支归一组。
// 普通候选（op id 无括号 / 多层链 / 合成 xor:K,rot:R）各自独立成组（items 长度 1），保持原样。
// 分组保序：以每个 base 首次出现位置为组序，组内保 magic 综合分原顺序（最优在前）。
function groupSweepCands(cands) { return groupSingleCandidates(cands); }

// 三元组摘要行——置顶展示 magic 最优候选。
// 格式：[解码N次] 明文（截断） + 混合解码结果: op1 › op2 › op3。
// 复用 onekey-card 样式，点击复制明文。crib 命中则高亮。
function renderSummaryCard(c, search = {}) {
  const chainLabel = c.chain
    .map((id) => { const o = getOp(id); return o ? opNameBi(o) : id; })
    .join(" › ");
  const isLong = c.result.length > 500;
  const valEl = el("div", { class: "ok-val" }, isLong ? c.result.slice(0, 500) + " …" : c.result);
  highlightResult(valEl, c.result, c.signals, typeof search === "undefined" ? {} : search);
  const card = el("div",
    { class: "onekey-card onekey-summary" + (c._cribHit ? " crib-hit" : ""),
      title: t("ui.common.clickCopy"),
      onclick: () => { navigator.clipboard?.writeText(c.result); toast(t("ui.toast.copiedResult")); } },
    el("div", { class: "ok-name" },
      el("span", { class: "onekey-summary-tag" }, t("ui.home.summaryDecoded", c.chain.length)),
      el("span", { class: "onekey-summary-title" }, t("ui.home.summaryTitle"))),
    valEl,
    el("div", { class: "onekey-summary-chain" },
      el("span", { class: "onekey-summary-chain-label" }, t("ui.home.summaryChain") + ":"),
      el("span", { class: "onekey-summary-chain-vals" }, chainLabel)),
  );
  if (isLong) {
    const expandBtn = el("span", { class: "ok-expand" }, t("ui.common.expand", c.result.length));
    let expanded = false;
    expandBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      expanded = !expanded;
      if (expanded) { valEl.textContent = c.result; expandBtn.textContent = t("ui.common.collapse"); }
      else { valEl.textContent = c.result.slice(0, 500) + " …"; expandBtn.textContent = t("ui.common.expand", c.result.length); }
    });
    card.append(expandBtn);
  }
  return card;
}

// 单条候选卡（原 for 循环体抽出，行为不变）。
function renderCandCard(c, search = {}) {
  const chainLabel = c.chain
    .map((id) => { const o = getOp(id); return o ? opNameBi(o) : id; })
    .join(" › ");
  const cribTag = c._cribHit ? " ●" : "";
  const isLong = c.result.length > 500;
  const valEl = el("div", { class: "ok-val" }, isLong ? c.result.slice(0, 500) + " …" : c.result);
  highlightResult(valEl, c.result, c.signals, typeof search === "undefined" ? {} : search);
  const card = el("div",
    { class: "onekey-card" + (c._cribHit ? " crib-hit" : ""),
      title: t("ui.common.clickCopy"),
      onclick: () => { navigator.clipboard?.writeText(c.result); toast(t("ui.toast.copiedResult")); } },
    el("div", { class: "ok-name" }, `${chainLabel}　·　${t("ui.home.confidence")} ${(c.confidence * 100).toFixed(0)}%${cribTag}`),
    valEl,
  );
  if (isLong) {
    const expandBtn = el("span", { class: "ok-expand" }, t("ui.common.expand", c.result.length));
    let expanded = false;
    expandBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      expanded = !expanded;
      if (expanded) { valEl.textContent = c.result; expandBtn.textContent = t("ui.common.collapse"); }
      else { valEl.textContent = c.result.slice(0, 500) + " …"; expandBtn.textContent = t("ui.common.expand", c.result.length); }
    });
    card.append(expandBtn);
  }
  return card;
}

// 爆破分组卡——同算法多参数分支收进一张 <details>。头显示算法名 + 分支数 + 最优分支
// 展开见其余分支。任一分支 crib 命中则整卡高亮。每条分支点击复制自己的结果。
function renderBruteGroupCard(g, search = {}) {
  const op = getOp(g.base);
  const box = el("details", { class: "onekey-card onekey-brute", open: "" });
  box.append(el("summary", { class: "ok-name" }, t("ui.home.bruteGroup", op ? opNameBi(op) : g.base, g.items.length)));
  for (const c of g.items) box.append(renderCandidateRow(c, { search, copied: () => toast(t("ui.toast.copiedResult")) }));
  return box;
}

// 原始输入卡——置顶展示用户原文，明确标注「原始输入」。不做 crib 绿色高亮
// 即便原文含 flag 字样也不标 crib-hit，避免用户把原文自带的 flag 误当成解码结果。
function appendRawCard(outWrap, raw) {
  const isLong = raw.length > 500;
  const valEl = el("div", { class: "ok-val" }, isLong ? raw.slice(0, 500) + " …" : raw);
  const card = el("div",
    { class: "onekey-card onekey-raw",
      title: t("ui.common.clickCopy"),
      onclick: () => { navigator.clipboard?.writeText(raw); toast(t("ui.toast.copiedResult")); } },
    el("div", { class: "ok-name" }, t("ui.home.rawCard")),
    valEl,
  );
  if (isLong) {
    const expandBtn = el("span", { class: "ok-expand" }, t("ui.common.expand", raw.length));
    let expanded = false;
    expandBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      expanded = !expanded;
      if (expanded) { valEl.textContent = raw; expandBtn.textContent = t("ui.common.collapse"); }
      else { valEl.textContent = raw.slice(0, 500) + " …"; expandBtn.textContent = t("ui.common.expand", raw.length); }
    });
    card.append(expandBtn);
  }
 // 编辑框智能——原文卡检测不可见/零宽字符（CTF 零宽隐写常见考点）。
 // 仅在真检测到时才挂显形切换组件，避免干扰正常输入。
  try {
    const rep = invisibleReport(raw);
    if (rep.count > 0) {
 // host 拦截冒泡：组件内按钮点击不触发原文卡的复制 onclick。
      const invHost = el("div", { class: "onekey-raw-inv", onclick: (ev) => ev.stopPropagation() });
      card.append(invHost);
      invisibleToggle(invHost, raw);
    }
  } catch { /* 检测失败不影响原文卡 */ }
  outWrap.append(card);
}

// 穷举追加区——首页「一把梭」结果后追加全解（所有解码器全跑全列）。
// 复用 core/exhaustiveDecode.js。默认只列有变化项（onlyChanged），按分类分组、flag 三档高亮。
// 整块折叠进 <details>，默认展开；异步结果回来校验 token（与 runOneKey 同令牌）弃过期。
async function appendExhaustSection(outWrap, q, crib, token) {
 // 穷举全解跑前先挂进度条（分批执行 + onProgress 驱动）。大输入时穷举 op 多
 // 耗时长，进度条给「在跑、跑到哪」的反馈。
 // 进度条不直接 append 到 outWrap 末尾（会被上方原始卡+magic候选卡挤到整个输出流最底）
 // 改为先建穷举区容器 box、把进度条放在区头部（summary 之后），使进度条出现在穷举结果区顶部。
 // 结果落在同一 box 内；异常/过期/空结果则移除 box。
  const box = el("details", { class: "onekey-exhaust", open: "" });
  const summary = el("summary", { class: "onekey-exhaust-head" }, t("ui.home.exhaustTitle"));
  box.append(summary);
  const prog = el("div", { class: "onekey-progress" },
    el("div", { class: "onekey-progress-label" }, msym("bolt"), el("span", { class: "onekey-progress-text" }, t("ui.home.exhaustRunning", 0))),
    el("div", { class: "onekey-progress-bar" }, el("div", { class: "onekey-progress-fill" })),
  );
  const fill = prog.querySelector(".onekey-progress-fill");
  const ptext = prog.querySelector(".onekey-progress-text");
  box.append(prog);                            // 进度条落在穷举区头部（summary 之后）
  outWrap.append(box);                          // 穷举区整体追加到输出流（magic 候选之后）

  const onProgress = (done, total) => {
    if (token !== runOneKey._token) return;    // 过期运行不再更新 UI
    const pct = total ? Math.round((done / total) * 100) : 0;
    if (fill) fill.style.width = pct + "%";
    if (ptext) ptext.textContent = t("ui.home.exhaustRunning", pct);
  };

  await ensureAll(); // 穷举跑全量 op 面（惰载态先补齐，stub 无 encode/decode）
  let r;
  const _exIds = activeCustomImplIds();
  try { r = await exhaustiveDecode(q, { targets: loadTargetConfig().targets, crib: crib || undefined, onlyChanged: true, onProgress, ...(_exIds.length ? { excludeOps: _exIds } : {}) }); }
  catch { box.remove(); return; }
  prog.remove();                               // 跑完移除进度条，让位结果区
  if (token !== runOneKey._token) { box.remove(); return; }  // 输入已变，弃过期穷举区
  if (r.tooLong) {
    box.append(el("div", { class: "onekey-hint" }, t("ui.exhaust.tooLong", r.maxInput)));
    return;
  }
  if (!r.total) { box.remove(); return; }       // 无变化项，撤掉空区

  summary.append(el("span", { class: "onekey-exhaust-stat" }, t("ui.exhaust.stat", r.total, r.hits)));
  for (const g of r.groups) {
    const catBox = el("div", { class: "exhaust-cat" });
    catBox.append(el("div", { class: "exhaust-cat-head" },
      el("span", { class: "exhaust-cat-name" }, catNameById(g.cat)),
      el("span", { class: "exhaust-cat-count" }, String(g.items.length)),
    ));
    for (const a of g.algos || []) {
      const group = el("details", { class: "exhaust-algo", open: a.hasStrongHit ? "" : null });
      group.append(el("summary", {}, opNameBi(getOp(a.baseOpId) || { id:a.baseOpId, name:a.baseOpId })));
      for (const it of a.items) group.append(renderCandidateRow(it));
      catBox.append(group);
    }
    box.append(catBox);
  }
}

// 判定字节流是文本还是二进制。
// 旧法「高位字节占比 < 30%」会把中文 UTF-8 文本误判成二进制（中文每字 3 字节全高位）。
// 新法：① 已知二进制 magic（图像/压缩/可执行等）直接判二进制；② 含 NUL 判二进制；
// ③ 用 fatal TextDecoder 试解 UTF-8，能无损解码即文本（涵盖全部中文/日文/emoji）。
function isTextFile(bytes, name = "") {
  if (!bytes || bytes.length === 0) return true;
  const n = Math.min(bytes.length, 8192);
 // ① 已知二进制文件头（magic）——图像/音频/压缩/PDF/可执行，拖入应走文件分析而非塞进框。
  const b = bytes;
  const magic4 = (a, c, d, e) => b[0] === a && b[1] === c && b[2] === d && b[3] === e;
  if (
    magic4(0x89, 0x50, 0x4e, 0x47) ||          // PNG
    (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || // JPG
    magic4(0x47, 0x49, 0x46, 0x38) ||          // GIF8
    (b[0] === 0x42 && b[1] === 0x4d) ||        // BMP
    magic4(0x52, 0x49, 0x46, 0x46) ||          // RIFF (wav/webp/avi)
    magic4(0x50, 0x4b, 0x03, 0x04) || magic4(0x50, 0x4b, 0x05, 0x06) || // ZIP/docx/…
    magic4(0x52, 0x61, 0x72, 0x21) ||          // RAR
    magic4(0x7f, 0x45, 0x4c, 0x46) ||          // ELF
    (b[0] === 0x4d && b[1] === 0x5a) ||        // PE (MZ)
    (b[0] === 0x1f && b[1] === 0x8b) ||        // GZIP
    magic4(0x25, 0x50, 0x44, 0x46) ||          // PDF
    magic4(0x37, 0x7a, 0xbc, 0xaf) ||          // 7z
    magic4(0x49, 0x44, 0x33, 0x00) || (b[0] === 0xff && b[1] === 0xfb) // MP3
  ) return false;
 // ② NUL 字节 → 二进制。
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return false;
 // ③ UTF-8 无损解码检验（fatal 模式，非法字节抛错 → 二进制）。
  try {
    _decodeUtf8Fatal(bytes.subarray(0, n));
    return true;
  } catch {
 // 非 UTF-8：可能是 latin1/GBK 等单字节文本。回退到「可打印占比」判定。
    let printable = 0;
    for (let i = 0; i < n; i++) {
      const c = bytes[i];
      if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127)) printable++;
    }
    return printable / n > 0.85;
  }
}

// ---- 智能分析三链懒载（fileAnalysis/imageAnalysis/audioAnalysis，含 QR·pcap·inflate·音频子树，退出首屏闭包）----
// 触发：首次拖入文件分析时（handleFile 内 await）+ 启动后空闲预热；失败允许下次重试。
let _analysisChains = null;
let _analysisChainsLoading = null;
function ensureAnalysisChains() {
  if (_analysisChains) return Promise.resolve(_analysisChains);
  if (!_analysisChainsLoading) {
    _analysisChainsLoading = Promise.all([
      import("./core/fileAnalysis.js"),
      import("./core/imageAnalysis.js"),
      import("./core/audioAnalysis.js"),
    ]).then(([fa, ia, aa]) => {
      _analysisChains = { analyzeFile: fa.analyzeFile, analyzeImageAsync: ia.analyzeImageAsync, analyzeAudio: aa.analyzeAudio };
      return _analysisChains;
    }).catch((e) => { _analysisChainsLoading = null; throw e; });
  }
  return _analysisChainsLoading;
}

// ---- 文件分析报告渲染 ----
async function handleFile(file, outWrap) {
  try { await ensureAll(); } catch { /* 加载尽力而为，缺 op 由各分析器自行降级 */ } // 文件分析走全量 op 面（惰载）
  outWrap.innerHTML = "";
  outWrap.append(el("div", { class: "file-report-loading" }, t("ui.file.loading", file.name)));
  try {
    const chains = await ensureAnalysisChains(); // 三链懒载（首次拖入触发；失败进 catch 显示错误）
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const report = await chains.analyzeFile(bytes, file.name);
 // 补充分析器（独立模块，按类型分派）：图片(PNG/BMP)像素级 / 音频(WAV)频谱级。
 // 各返回 { sections }，追加到主报告末尾（补充信息，排主报告 alert>warn>info 之后合理）。
    try {
      const ext = (report.ext || "").toLowerCase();
      const mime = report.detected || "";
      let extra = null;
      if (ext === "png" || ext === "bmp" || ext === "jpg" || ext === "jpeg" || ext === "gif" || /png|bmp|jpe?g|gif/i.test(mime)) {
        extra = await chains.analyzeImageAsync(bytes, file.name, report.detected);
      } else if (ext === "wav" || /wav|audio/i.test(mime)) {
        extra = chains.analyzeAudio(bytes, file.name, report.detected);
      } else if (ext === "7z" || bytes.length >= 6 && bytes[0] === 0x37 && bytes[1] === 0x7a && bytes[2] === 0xbc && bytes[3] === 0xaf && bytes[4] === 0x27 && bytes[5] === 0x1c) {
        extra = await analyze7zFile(bytes);
      } else if (ext === "pyc" || ext === "exe" || (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a)) {
 // pyc/exe 自动反编（本地桥，仅 Windows + 需起 bridge.py）。
 // 桥不可用 / 非 Windows / 非 PyInstaller exe → 如实展示提示，不阻断主报告。
 // body 放完整反编源码（formatResult 已含多 pyc 汇总 + 元信息头），无需额外 view action。
        const kind = (ext === "pyc") ? "pyc" : (ext === "exe" ? "exe" : "auto");
        const res = await decompileBytes(bytes, file.name, kind);
        const text = formatDecompileResult(res, file.name);
        extra = { sections: [{
          id: "decompile", title: "pyc/exe 反编（本地桥）",
          level: res && res.ok ? "info" : "warn",
          icon: "code",
          body: text,
        }] };
      }
      if (extra && Array.isArray(extra.sections) && extra.sections.length) {
        report.sections.push(...extra.sections);
      }
    } catch { /* 补充分析失败不阻断主报告 */ }
    renderFileReport(outWrap, report);
  } catch (e) {
    outWrap.innerHTML = "";
    outWrap.append(el("div", { class: "file-report-error" }, t("ui.file.fail", e && e.message ? e.message : String(e))));
  }
}

function renderFileReport(outWrap, r) {
  outWrap.innerHTML = "";
  const sizeStr = r.size > 1024 ? (r.size / 1024).toFixed(1) + " KB" : r.size + " B";
 // 报告头重排——文件名放大置顶为主标题，类型/大小作副信息行。
  outWrap.append(el("div", { class: "file-report-header" },
    msym("attach_file", "file-report-glyph"),
    el("div", { class: "file-report-headmain" },
      el("div", { class: "file-name" }, r.name || t("ui.file.unnamed")),
      el("div", { class: "file-report-meta" },
        r.detected ? el("span", { class: "file-type" }, r.detected) : null,
        el("span", { class: "file-size" }, sizeStr),
        r.ext ? el("span", { class: "file-ext" }, "." + r.ext) : null,
      ),
    ),
  ));
 // sections 已由 fileAnalysis 按 alert>warn>info 排好序，最重要的在最上。
 // 每张卡带 section.icon（风格统一的 Material 小图标），标题前注入，颜色随 level 区分。
  for (const s of r.sections) {
    const hasActions = Array.isArray(s.actions) && s.actions.length > 0;
 // view 动作：整卡可双击查看（取第一个 view 动作的内容）；卡片加提示条与手型光标。
    const viewAct = hasActions ? s.actions.find((a) => a.type === "view") : null;
    const card = el("div", Object.assign(
      { class: "file-section " + s.level + (viewAct ? " file-section-viewable" : "") },
      viewAct ? keyBtn(() => openSectionView(s.title, viewAct)) : {},
    ),
      el("div", { class: "file-section-title" },
        s.icon ? msym(s.icon, "file-section-glyph") : null,
        el("span", {}, s.title),
      ),
      el("div", { class: "file-section-body" }, s.body),
    );
    if (hasActions) {
 // 下载动作按钮行（view 动作不出按钮，走双击）。
      const dlActs = s.actions.filter((a) => a.type === "download");
      if (dlActs.length) {
        const bar = el("div", { class: "file-section-actions" });
        for (const a of dlActs) {
          bar.append(el("button", {
            class: "file-section-act",
            onclick: (e) => { e.stopPropagation(); downloadBytes(a.bytes, a.filename, a.mime); },
          }, msym("download", "file-act-glyph"), el("span", {}, a.label)));
        }
        card.append(bar);
      }
      if (viewAct) {
        card.append(el("div", { class: "file-section-viewhint" },
          msym("open_in_full", "file-view-glyph"),
          el("span", {}, t("ui.file.dblToView")),
        ));
        card.addEventListener("dblclick", () => openSectionView(s.title, viewAct));
      }
    }
    outWrap.append(card);
  }
}

// section view 动作：只读查看窗（文本 pre / 图片 img），复用 expandableInput 注入的 .exp-* modal 样式。
function openSectionView(title, act) {
  ensureExpStyles(); // 文件报告页可能从未实例化过可展开输入框，样式表未注入 → 弹窗裸奔白底。此处兜底注入。
  const previousFocus = document.activeElement;
  const overlay = el("div", { class: "exp-overlay" });
  const dialog = el("div", { class: "exp-dialog", role: "dialog", "aria-modal": "true", "aria-label": title || t("ui.file.viewTitle") });
  const head = el("div", { class: "exp-head" },
    el("div", { class: "exp-title" }, title || t("ui.file.viewTitle")),
    el("button", { type: "button", class: "exp-close", title: t("ui.expand.cancel"), onclick: close }, msym("close")),
  );
  let bodyEl;
  if (act.mime && /^image\//.test(act.mime) && act.bytes) {
    const u8a = act.bytes instanceof Uint8Array ? act.bytes : new Uint8Array(act.bytes);
    const url = URL.createObjectURL(new Blob([u8a], { type: act.mime }));
    bodyEl = el("div", { class: "exp-view exp-view-img" }, el("img", { src: url, alt: title || "" }));
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } else {
    const text = act.text != null ? act.text
      : (act.bytes ? new TextDecoder("utf-8").decode(act.bytes instanceof Uint8Array ? act.bytes : new Uint8Array(act.bytes)) : "");
    bodyEl = el("pre", { class: "exp-view exp-view-text" }, text);
  }
  dialog.append(head, bodyEl);
  overlay.append(dialog);
  document.body.append(overlay);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    if (lifecycle) { lifecycle.release(); lifecycle = null; }
    overlay.classList.add("exp-closing");
    setTimeout(() => overlay.remove(), 250);
  }
  let lifecycle = attachModalLifecycle(overlay, { dialog, onClose: close, restoreFocusTo: previousFocus });
}

// dataURL → 字节 / MIME（出图类 op 下载复用）。
function dataUrlToBytes(url) {
  const comma = url.indexOf(",");
  const b64 = comma >= 0 ? url.slice(comma + 1) : url;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function mimeOfDataUrl(url) {
  const m = /^data:([^;,]+)/.exec(url);
  return m ? m[1] : "image/png";
}

// ---- op 产物协议（产品负责人 2026-09-02 下单：全能密码学工具箱，该给文件的输出给下载按钮）----
// run/encode/decode 允许返回新形态对象：{ text: string, files: [{ name, mime, bytes|dataUrl }] }。
// 返回字符串的 op 全部走旧路径，647 op 零破坏。⚠ 一键解码（magic Worker）路径不认产物对象，
// 参与 magic 的 op 勿返回对象。bytes 支持 Uint8Array / number[]；dataUrl 自动解字节并推 MIME。
// 产物下载按钮列表：files 非空时追加到输出媒体区（renderOutMedia 清容器后调用，勿颠倒顺序）；
// files 为 null/空时只移除旧列表（早退/清空路径由 renderOutMedia 的 innerHTML 清空兜底）。
// 图片类产物（如流量可读结论的键鼠轨迹/节奏 PNG）同时渲染内联预览图，直接「画出来」而非只给下载。
let _filePreviewUrls = [];
function renderOutFiles(container, files) {
  if (!container) return;
  const old = container.querySelector(".io-out-files");
  if (old) old.remove();
  for (const u of _filePreviewUrls) { try { URL.revokeObjectURL(u); } catch { /* 已释放忽略 */ } }
  _filePreviewUrls = [];
  if (!Array.isArray(files) || !files.length) return;
  const box = el("div", { class: "io-out-files", style: "display:flex;flex-direction:column;gap:6px;margin-top:10px;align-items:flex-start" });
  for (const { bytes, mime, name } of productFileEntries({ files })) {
    if (mime && mime.startsWith("image/")) {
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      _filePreviewUrls.push(url);
      box.append(el("img", {
        class: "io-out-file-preview", src: url, alt: name,
        style: "max-width:320px;max-height:240px;border-radius:6px;cursor:zoom-in;background:#fff;border:1px solid var(--outline)",
      }));
    }
    box.append(el("button", {
      type: "button", class: "file-section-act",
      onclick: () => cloudWarnGate(() => downloadBytes(bytes, name, mime)),
    }, msym("download", "file-act-glyph"),
       el("span", {}, `${t("ui.outFiles.download")} ${name} (${fmtByteSize(bytes.length)})`)));
  }
  if (box.children.length) container.append(box);
}

// 输出区图片渲染：扫描 op 输出文本里的 data:image/*;base64,...（出图类 op 约定：
// qrGen 二维码 / gifFrames 逐帧 / mcMap / bin2img / imgFft / spectrogram 等），
// 逐个渲染成可见缩略图 + 下载按钮，点缩略图走灯箱放大。无匹配则清空媒体区。
const OUT_IMG_RE = /data:image\/(?:png|jpe?g|gif|webp|bmp);base64,[A-Za-z0-9+/]+=*/g;
function renderOutMedia(container, text) {
  if (!container) return;
  container.innerHTML = "";
  if (!text) return;
  const urls = String(text).match(OUT_IMG_RE);
  if (!urls || !urls.length) return;
  const grid = el("div", { class: "io-out-media-grid", style: "display:flex;flex-wrap:wrap;gap:12px;margin-top:8px" });
  const multi = urls.length > 1;
  urls.forEach((url, i) => {
    const img = el("img", Object.assign({
      class: "io-out-media-img", src: url, alt: "", loading: "lazy",
      "aria-label": t("ui.file.viewTitle"),
      style: "max-width:180px;max-height:180px;cursor:zoom-in;border-radius:6px;image-rendering:pixelated;background:#fff",
    }, keyBtn(() => openImageLightbox(url, ""))));
    img.addEventListener("click", () => openImageLightbox(url, ""));
    const dl = el("button", {
      type: "button", class: "file-section-act",
      onclick: (e) => { e.stopPropagation(); cloudWarnGate(() => downloadBytes(dataUrlToBytes(url), (state.opId || "image") + (multi ? "_" + (i + 1) : "") + ".png", mimeOfDataUrl(url))); },
    }, msym("download", "file-act-glyph"), el("span", {}, t("ui.op.export")));
    grid.append(el("figure", { class: "io-out-media-cell", style: "display:flex;flex-direction:column;gap:4px;align-items:center;margin:0" }, img, dl));
  });
  container.append(grid);
}

// 图片灯箱：全屏遮罩内居中大图，点击遮罩/图片或 Esc 关闭。
// 与 openSectionView 的小编辑弹窗分开——灯箱要尽量大 + 高保真渲染（不套 stego 的 pixelated）。
function openImageLightbox(url, alt) {
  const previousFocus = document.activeElement;
  const overlay = el("div", { class: "img-lightbox", role: "dialog", "aria-modal": "true", "aria-label": alt || t("ui.file.viewTitle") });
  const img = el("img", { class: "img-lightbox-img", src: url, alt: alt || "" });
  const closeBtn = el("button", { type: "button", class: "img-lightbox-close", title: t("ui.expand.cancel"), onclick: close }, msym("close"));
  overlay.append(img, closeBtn);
  document.body.append(overlay);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    if (lifecycle) { lifecycle.release(); lifecycle = null; }
    overlay.classList.add("img-lightbox-closing");
    setTimeout(() => overlay.remove(), 250);
  }
  let lifecycle = attachModalLifecycle(overlay, { dialog: overlay, onClose: close, closeOnBackdrop: "always", initialFocus: closeBtn, restoreFocusTo: previousFocus });
}

// 给任意 textarea 挂「拖入文件」能力（op 输入框继承首页智能框）：
// 文本文件 → 读内容进框（TextDecoder，对齐首页 isTextFile 判定，不再无脑转 hex）；
// 二进制文件 → 转 hex 进框作可见回退（op 场景多是对 hex 做转换）。
// 原始字节透传：无论文本/二进制都把真字节缓存到 ta._rawBytes（+ ta._rawFileName）
// 供需要原始字节的 op（如 PNG 解析）读取，避免只能拿到 hex 文本或被 UTF-8 解码破坏的字节。
// 载入后回调 onLoaded(bytes)（通常触发 convert，并把 bytes 一并透传）。
// 目前执行层（convert）尚无 bytes 契约（无 op 声明 acceptsBytes），此通道为预留；
// 用户手动编辑框内容即视为字节失效，清空缓存防止 op 读到过期字节。
// File → 字节进框（拖放 + 「选择文件」按钮共用）。acceptsBytes op 走 rawBytes 占位；
// 文本 TextDecoder 进框；二进制转 hex。载入后 onLoaded(bytes) 触发 convert。
async function loadFileIntoArea(ta, f, onLoaded) {
  if (!f) return;
  const bytes = new Uint8Array(await f.arrayBuffer());
 // 原始字节透传通道：文本/二进制都缓存，供吃 bytes 的 op 读取。
  ta._rawBytes = bytes;
  ta._rawFileName = f.name;
 // 分派：当前 op 声明 acceptsBytes（吃原始字节）→ 不转 hex，编辑框只显示占位提示
 // 真字节走 rawBytes 通道（修复「拖图片进框变一坨 hex」的痛点）。
 // 否则沿用文本/二进制判定：文本文件 TextDecoder 进框，二进制转 hex（hex-string op 需要）。
  const curOp = getOp(state.opId);
  if (curOp && curOp.acceptsBytes) {
    ta.value = t("ui.op.fileLoaded", f.name, humanSize(bytes.length));
    ta._isFilePlaceholder = true;
    toast(t("ui.op.droppedBytes", f.name));
  } else if (isTextFile(bytes, f.name)) {
 // 用 isTextFile（UTF-8 无损解码判定）替代高位字节占比法，避免中文 UTF-8 文本被误判成二进制转 hex。
    ta.value = new TextDecoder("utf-8").decode(bytes);
    ta._isFilePlaceholder = false;
    toast(t("ui.op.droppedText", f.name));
  } else {
    let hex = "";
    for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, "0");
    ta.value = hex;
    ta._isFilePlaceholder = false;
    toast(t("ui.op.droppedHex", f.name));
  }
 // input 监听会在 ta.value 赋值时把缓存清掉（contenteditable 赋值可能触发）
 // 故在回调前重新坐实缓存，确保 onLoaded 与后续 op 能拿到本次载入的真字节。
  ta._rawBytes = bytes;
  ta._rawFileName = f.name;
  if (onLoaded) onLoaded(bytes);
}

// 弹系统文件选取器，选中后走 loadFileIntoArea（不依赖拖放，覆盖「拖不进/远程桌面」场景）。
function pickFileIntoArea(ta, onLoaded) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.style.display = "none";
  inp.addEventListener("change", async () => {
    const f = inp.files && inp.files[0];
    if (f) await loadFileIntoArea(ta, f, onLoaded);
    inp.remove();
  });
  document.body.append(inp);
  inp.click();
}

function attachDropDecode(ta, onLoaded) {
  ta.addEventListener("dragover", (e) => { e.preventDefault(); ta.classList.add("dragover"); });
  ta.addEventListener("dragleave", () => ta.classList.remove("dragover"));
 // 手动编辑 → 原始字节缓存失效（拖入的文件字节已与框内文本脱钩），占位态也一并解除
  ta.addEventListener("input", () => { ta._rawBytes = null; ta._rawFileName = null; ta._isFilePlaceholder = false; });
  ta.addEventListener("drop", async (e) => {
    e.preventDefault();
    ta.classList.remove("dragover");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) await loadFileIntoArea(ta, f, onLoaded);
  });
}

// ---- 单 op 操作面板 ----
// Shared by workspace family tabs and the search index.
const FAM_LBL_ZH = { "fam.lbl.attack": "重用 k 攻击", "fam.lbl.sharedPub": "由公钥推导", "fam.lbl.homAdd": "同态加", "fam.lbl.scan": "扫描", "fam.lbl.formatBrute": "爆破", "fam.lbl.smartReport": "智能报告" };
// 弹簧动效总开关：默认开（产品负责人 2026-09-12 真机验演示后批准第一批灰度）；'0'=整体回退 CSS 动画
document.documentElement.classList.toggle("spring-motion", localStorage.getItem("ebctf.springMotion") !== "0");
const _segThumbPos = new Map(); // 族滑块指示器跨渲染位置记忆
const _famSegScroll = new Map(); // 族滑块横向滚动位置跨重渲染保持（点档位后滚动条不跟手的反馈）
function famLblText(lk) {
  const v = t(lk);
  return v === lk && FAM_LBL_ZH[lk] ? FAM_LBL_ZH[lk] : v;
}

// op 页简介与科普卡共用的行内富文本渲染（**加粗** / `码段` / $公式$ 占位）。
function opDescEl(op) {
  const txt = opDesc(op);
  if (!txt) return null;
  const div = el("div", { class: "op-desc" }, parseInline(txt, true));
  renderMathIn(div); // 懒加载渲染公式（KaTeX 缺失时降级为原始 TeX，不报错）
  return div;
}

function parseInline(text, plainMath) {
  const frag = document.createDocumentFragment();
  const pushPlain = (s) => {
    if (!s) return;
    // **加粗** → <strong>：放在码段/公式切分之后执行，反引号码段与 $...$ 内的 ** 不受影响
    // （码段/公式的既有保护不回归）；成对才转换，单个 **（幂运算符、运算符清单）原样保留。
    // 科普数据是本地可信源，允许富文本标签（<b>/<i>/<sub>/<sup>/<table>/<ul> 等）
    const bolded = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    if (/<[a-z][\s\S]*?>/i.test(bolded)) {
      const span = el("span", { class: "edu-rich" });
      span.innerHTML = bolded;
      frag.append(span);
    } else frag.append(document.createTextNode(bolded));
  };
  // 非码段内再按 $...$ 切公式
  const pushSegment = (s) => {
    const parts = String(s).split(/(\$[^$]+\$)/g);
    for (const p of parts) {
      if (!p) continue;
      if (p.startsWith("$") && p.endsWith("$") && p.length > 2) {
        if (plainMath) { pushPlain(p); continue; } // op 简介里 $...$ 多为哈希签名（$2a$/$7z$），原样保留
        const span = el("span", { class: "edu-math" });
        span.setAttribute("data-tex", p.slice(1, -1));
        frag.append(span);
      } else pushPlain(p);
    }
  };
  const segs = String(text).split(/(`[^`]+`)/g);
  for (const s of segs) {
    if (!s) continue;
    if (s.startsWith("`") && s.endsWith("`") && s.length > 2)
      frag.append(el("code", { class: "edu-code" }, s.slice(1, -1)));
    else pushSegment(s);
  }
  return frag;
}

function renderOp() {
  const op = getOp(state.opId);
  if (!op) return renderHome();
  if (op.id === "cryptoTryAll") return renderCryptoTryAll(op);

  const head = el("div", { class: "op-head" },
    el("div", { class: "op-title" }, msym(CATEGORIES.find((c) => c.id === op.cat)?.icon || "tag"),
      op.requiresBridge ? el("span", { class: "exe-badge" }, "EXE") : null, opName(op)),
    opDescEl(op),
  );
  $ws.append(head);

  const favorite = isFavorite(op.id);
  const favoriteTitle = t(favorite ? "ui.fav.remove" : "ui.fav.add");
  const favBtn = el("button", {
    class: "act-btn fav-btn" + (favorite ? " on" : ""), type: "button",
    title: favoriteTitle, "aria-label": favoriteTitle, "aria-pressed": String(favorite),
    onclick: () => favoritesChanged(toggleFavorite(op.id)),
  }, msym("star"));
  head.querySelector(".op-title")?.append(favBtn);
  head.addEventListener("contextmenu", event => {
    if (event.target.closest("input, textarea, [contenteditable], .fav-btn")) return;
    event.preventDefault();
    openFavMenu(event.clientX, event.clientY, { opId: op.id, onChange: favoritesChanged });
  });

 // 族滑块（）：当前 op 属于某算法族 → 标题下方、方向切换上方渲染族内档位条。
 // 每档 = 一个独立 op，点档位 = selectOp(该 op.id)，工作区（参数表/IO/产物/自定义开关）随
 // selectOp 全量重渲染——不引入任何新状态机。样式复用 dir-seg 的 on 态。
 // 族字段缺失（并行添加期间）或族内不足 2 档时不渲染，其余分支零改动。滑块在页面内，
 // 与侧栏/navRail 折叠态无关，窄屏照常渲染（dir-seg CSS 自带 flex-wrap）。
  if (op.family) {
    const famGrp = familyGroup(op.cat).find((g) => g.family === op.family);
    if (famGrp && famGrp.ops.length > 1) {
      const famSeg = el("div", { class: "dir-seg fam-seg", role: "group", "aria-label": famGrp.name,
        oncontextmenu: e => showFavoriteMenu(e, { entries: famGrp.ops.map(m => ({ opId: m.id, label: opName(m) })) }) });
     // 滚动位置记忆：任何来源的滚动（拖条/滚轮/点档）都实时入 Map，重渲染后恢复
      famSeg.addEventListener("scroll", () => _famSegScroll.set(op.family, famSeg.scrollLeft), { passive: true });
      for (const m of famGrp.ops) {
        const lk = "fam.lbl." + (m.familyLabel || m.id);
        const lv = famLblText(lk); // 缺 key 回退 key 本身 → 再回退本地兜底表 → familyLabel 原值
        famSeg.append(el("button",
          { class: m.id === op.id ? "on" : "", type: "button", "aria-pressed": String(m.id === op.id),
            onclick: () => { if (m.id !== op.id) selectOp(m.id); } },
          lv === lk ? (m.familyLabel || m.id) : lv));
      }
      $ws.append(famSeg);
     // 恢复横向滚动位置 + 选中档滚入可视缘（不 scrollIntoView——那会连页面一起滚）
      const savedScroll = _famSegScroll.get(op.family);
      if (savedScroll != null) {
        famSeg.scrollLeft = savedScroll;
        const ob = famSeg.querySelector("button.on");
        if (ob) {
          const x0 = ob.offsetLeft, x1 = x0 + ob.offsetWidth;
          if (x0 < famSeg.scrollLeft + 4) famSeg.scrollLeft = x0 - 4;
          else if (x1 > famSeg.scrollLeft + famSeg.clientWidth - 4) famSeg.scrollLeft = x1 - famSeg.clientWidth + 4;
        }
      }
 // 弹簧滑动指示器（spring-motion 关闭时不渲染，回退 .on 背景样式）
      if (document.documentElement.classList.contains("spring-motion")) {
        const onBtn = famSeg.querySelector("button.on");
        if (onBtn) {
          const thumb = el("span", { class: "seg-thumb", "aria-hidden": "true" });
          const tx = onBtn.offsetLeft;
          thumb.style.width = onBtn.offsetWidth + "px";
          const prev = _segThumbPos.get(op.family);
          famSeg.append(thumb);
          HLSpring.set(thumb, { x: prev == null ? tx : prev });
          // 弹动缩减（产品裁决①）：bouncy150(ζ≈0.56,过冲13px) → 1422/57(名义ζ≈0.75,150ms档,过冲约减半)
          if (prev != null && prev !== tx) HLSpring.to(thumb, { x: tx }, { stiffness: 1422, damping: 57 });
          _segThumbPos.set(op.family, tx);
        }
      }
    }
  }

 // exe 型 op（requiresBridge）：无编解码语义，点即启动本机 exe / 跑 CLI。
 // 不渲染输入/输出/转换，改为「启动」按钮 + 结果显示区。若有 params（CLI 型）仍渲染参数栏。
  if (op.requiresBridge) {
    renderExeOp(op);
    return;
  }

 // 方向切换（仅双向 op 显示）
  const isDual = op.encode && op.decode;
  if (isDual) {
    const seg = el("div", { class: "dir-seg" },
      el("button", { class: state.dir === "encode" ? "on" : "", onclick: () => { state.dir = "encode"; convert(); updateDirSeg(); } }, t("ui.op.encode")),
      el("button", { class: state.dir === "decode" ? "on" : "", onclick: () => { state.dir = "decode"; convert(); updateDirSeg(); } }, t("ui.op.decode")),
    );
    seg.id = "dirSeg";
    $ws.append(seg);
   // 方向滑块指示器：与族滑块同款滑轨+滑块（spring-motion 关闭时不渲染，回退 .on 背景样式）
    if (document.documentElement.classList.contains("spring-motion")) {
      const onBtn = seg.querySelector("button.on");
      if (onBtn) {
        const thumb = el("span", { class: "seg-thumb", "aria-hidden": "true" });
        thumb.style.width = onBtn.offsetWidth + "px";
        seg.append(thumb);
        HLSpring.set(thumb, { x: onBtn.offsetLeft });
      }
    }
  }

 // 参数栏
  if (op.params.length) {
    const bar = el("div", { class: "op-params" });
    for (const d of op.params) bar.append(renderParam(op, d));
    $ws.append(bar);
  }

 // 增强随机安全（每 op 内嵌勾选框，默认不勾）。
 // 只对「会取随机字节」的 op 显示（白名单见 core/randOps.js）——Base64/摩斯/哈希等
 // 不消耗随机性的 op 挂开关是纯噪音，也破坏「开关=随机源控制」的语义。
 // 不勾 ⇒ 不展开任何额外控件，随机源走 system 档（界面/行为与改动前一致）；
 // 勾上 ⇒ 就地展开档位选择与配置，非 system 档时行内常驻显示当前档位标识。
  if (opUsesRandom(op.id)) {
    const randHost = el("div", { class: "rand-sec-host" });
    renderRandSecureToggle(randHost);
    $ws.append(randHost);
  } else if (opExternalRand(op.id)) {
    // 随机在**内置第三方库**内部生成（不受本工具控制）→ 不挂开关，只如实说明「为什么没有」。
    const host = el("div", { class: "rand-sec-host" });
    host.append(el("div", { class: "rand-external-note" },
      msym("info"), el("span", {}, t("ui.rand.externalNote", externalRandLib(op.id)))));
    $ws.append(host);
  }

 // 高级 · 自定义实现（默认关；勾上 = 用用户 JS 替换本 op 的 encode/decode）。
 // 自定义实现不参与 magic / 穷举（见 runOneKey 的 excludeOps），Worker 沙箱 + 超时执行。
 // op / dir 一并传进去：编辑器要拿它抽内置实现源码当编辑起点。
  if (!op.requiresBridge && op.id !== "cryptoTryAll") {
    const ciRow = el("div", { class: "ci-anchor" });
    renderCustomToggle(ciRow, op.id, {
      op,
      dir: state.dir,
      onToggle: () => convert(),
      onTest: (code, cb) => {
        const inEl = document.getElementById("ioIn");
        const text = inEl ? inEl.value : "";
        const rb = inEl && inEl._rawBytes ? inEl._rawBytes : null;
        runCustomWithTimeout({ code, dir: state.dir, input: text, params: state.params, rawBytes: rb }).then(cb);
      },
    });
    $ws.append(ciRow);
  }

 // 纵向 IO：输入/输出上下堆叠，等宽撑满内容区。
 // IO 框可 resize:vertical（CSS）+ A-/A+ 调字号（会话态 state.ioFont）。
 // op 若声明 fields[] → 渲染多个带标签输入框，收集后按约定拼给 run/encode/decode。
  const hasFields = Array.isArray(op.fields) && op.fields.length > 0;
  // 主输入框三态（产品裁决）：无需主输入的 op 不再显示巨型输入框。
  //  推导见 registry.inferIoMode（run-only 且首参未引用 → none）；显式 op.io 可覆盖；
  //  自定义实现启用时强制显示（魔改代码可能要吃 text）。inArea 仍会创建（闭包/复制链
  //  引用它），只是不 append 进 DOM——convert() 对 ioIn 缺失按空输入直跑 run-only。
  const ciSelf = getCustomImpl(op.id);
  const ciSelfOn = !!(ciSelf && ciSelf.enabled && ciSelf.code && ciSelf.code.trim());
  const ioMode = inferIoMode(op);
  const showInput = ioMode !== "none" || ciSelfOn || hasFields;
  // Whitespace programs require literal spaces, tabs and line feeds, not rich-text DOM.
  const inArea = op.verbatimInput
    ? el("textarea", { class: "io-area", placeholder: t("ui.op.inPlaceholder"), spellcheck: "false" })
    : ioArea({ class: "io-area", placeholder: t("ui.op.inPlaceholder") });
  const outArea = ioArea({ class: "io-area", placeholder: t("ui.op.outPlaceholder"), readonly: true });
  inArea.id = "ioIn"; outArea.id = "ioOut";
 // 会话态字号（不持久化）
  inArea.style.fontSize = state.ioFont + "px";
  outArea.style.fontSize = state.ioFont + "px";
 // 多输入框容器：每个 field 一个带标签 textarea，id = fld_<key>
  const fieldAreas = [];
  if (hasFields) {
    for (const f of op.fields) {
      const ta = ioArea({
        class: "io-area io-field-area",
        placeholder: f.placeholder || "",
      });
      ta.id = "fld_" + f.key;
      ta.style.fontSize = state.ioFont + "px";
      ta.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); triggerConvert(); }
      });
      fieldAreas.push(el("div", { class: "io-field" },
        el("label", { class: "io-field-label" }, f.label),
        ta,
      ));
    }
  }

 // 字号调节按钮（A- / A+），改所有 IO textarea 内联 font-size。
  const applyFont = () => {
    const px = state.ioFont + "px";
    document.querySelectorAll(".io-area").forEach((n) => { n.style.fontSize = px; });
  };
  const fontDec = toolBtn("text_decrease", t("ui.op.fontDec"), () => {
    state.ioFont = Math.max(11, state.ioFont - 1); applyFont();
  });
  const fontInc = toolBtn("text_increase", t("ui.op.fontInc"), () => {
    state.ioFont = Math.min(28, state.ioFont + 1); applyFont();
  });

 // 转换动作条：显式「转换/一键解码」按钮，不监听 input 实时跑。
  const actLabel = op.run ? t("ui.op.convert") : (isDual ? t("ui.op.convert") : t("ui.op.decode"));
  const runAct = el("button", { class: "act-btn primary" }, msym(isDual ? "sync_alt" : "bolt"), " " + actLabel);
  runAct.addEventListener("click", async () => {
    runAct.classList.remove("pending-run"); // 惰执行 pending 高亮：用户已显式执行，撤掉呼吸提示
   // 重运算 op（explicitRun 白名单）：独立线程跑，主线程零阻塞；运行卡 = 读秒 + 取消。
   // 随机源非 system 档时**强制走主线程**（Worker 拿不到用户熵，否则会静默退回
   // system 档 —— 违反「禁静默降级」）。此处是唯一的 Worker 入口，加档位守卫即可全覆盖。
    if (isExplicitRunOp(op.id) && op.run && !op.requiresBridge && currentRandMode() === RAND_MODES.SYSTEM) {
      const outArea = document.getElementById("ioOut");
      const mediaBox = document.getElementById("ioOutMedia");
      if (!outArea) { convert(); return; }
      const t0 = Date.now();
      const sec = el("span", {}, "0");
      const cancelBtn = el("button", { type: "button", class: "act-btn" }, " 取消");
      const busy = el("div", { class: "op-run-busy" }, "运行中（已 ", sec, " 秒）", cancelBtn);
      cancelBtn.addEventListener("click", () => cancelOpRun());
      outArea.parentNode && outArea.parentNode.insertBefore(busy, outArea);
      const tick = setInterval(() => { sec.textContent = String(Math.round((Date.now() - t0) / 1000)); }, 1000);
      try {
        // 与 convert() 同口径：acceptsBytes op 的拖入真字节经 params.rawBytes 透传。
        // 否则 Worker 按钮只拿到占位文案 → 空输入（流量轨迹图等产物通道失败）。
        const runParams = (op.acceptsBytes && !hasFields && inArea && inArea._rawBytes)
          ? { ...state.params, rawBytes: inArea._rawBytes, rawFileName: inArea._rawFileName }
          : { ...state.params };
        const out = await runOpOffThread(op.id, inArea.value, runParams, { dir: state.dir });
        clearInterval(tick); busy.remove();
       // 对象产物协议与 convert() 同口径：text 进输出框，files 渲染下载按钮。
        let outText = out, outFiles = null;
        if (out && typeof out === "object") { outText = out.text != null ? out.text : ""; outFiles = "files" in out ? productFileEntries(out) : null; }
        outArea.value = outText;
        outArea.classList.remove("error");
        renderOutMedia(mediaBox, outText);
        renderOutFiles(mediaBox, outFiles);
      } catch (e) {
        clearInterval(tick); busy.remove();
        const msg = e.message === "timeout" ? "已超时中止" : (e.message === "cancelled" ? "已取消" : "✗ " + e.message);
        outArea.value = msg;
        outArea.classList.toggle("error", e.message !== "cancelled");
        renderOutMedia(mediaBox, "");
      }
      return;
    }
    convert();
  });
 // Ctrl+Enter / 拖入文件 / 选择文件与运行按钮同口径——显式重 op 一律复用
 // runAct 监听器走 Worker 通道（busy 卡/取消/超时文案/对象产物渲染均由其处理），不再经
 // convert() 在主线程同步直跑（旧旁路实测 883ms 级长任务）。轻 op 行为不变（仍 convert()）。
 // 函数声明提升：上方 fieldAreas 的 keydown 闭包可先引用（触发时本函数体早已可用）。
  function triggerConvert() {
   // 图像惰执行 op（canvas 重算系）：拖入/选文件/快捷键等自动路径不跑——填好输入后
   // 输出区放「待执行」提示 + 转换按钮呼吸高亮，点按钮才执行（恒烈 2026-10-12）。
    if (isLazyRunOp(op.id)) { markPendingRun(); return; }
    if (isExplicitRunOp(op.id) && op.run && !op.requiresBridge && currentRandMode() === RAND_MODES.SYSTEM) runAct.click();
    else convert();
  }
 // 惰执行 pending 态：输出区占位 + 转换按钮高亮；点击按钮（runAct click）时清除。
  function markPendingRun() {
    const outArea = document.getElementById("ioOut");
    if (outArea) {
      outArea.value = lazyRunHint(opName(op));
      outArea.style.color = "";
      outArea.classList.remove("error");
      renderOutMedia(document.getElementById("ioOutMedia"), "");
    }
    runAct.classList.add("pending-run");
  }
  const chainAct = el("button", { class: "act-btn", title: t("ui.op.chainToInput") },
    msym("swap_vert"), " " + t("ui.op.chainToInput"));
  chainAct.addEventListener("click", () => { inArea.value = outArea.value; invalidateFileBytes(inArea); convert(); });

 // 输入区主体：多字段模式渲染 fieldAreas；io=none 且无自定义实现 → 细提示条替代巨型输入框。
  const inputBody = hasFields
    ? el("div", { class: "io-fields" }, ...fieldAreas)
    : (showInput ? inArea : el("div", { class: "io-none-hint" },
        msym("info"), " 本操作无需主输入：填好参数后直接运行（自定义实现启用时会恢复输入框）"));
  // 统一清空：程序化 .value="" 不触发 input 监听，必须显式撤销文件字节通道与占位标记，
  // 否则清空后再运行会用旧文件字节复活旧结果（结果归属错乱）。
  const invalidateFileBytes = (ta) => {
    if (!ta) return;
    ta._rawBytes = null;
    ta._rawFileName = null;
    ta._isFilePlaceholder = false;
  };
  const clearInputArea = (ta) => { if (!ta) return; ta.value = ""; invalidateFileBytes(ta); };
  const clearAll = () => {
    clearInputArea(inArea);
    outArea.value = "";
    renderOutMedia(document.getElementById("ioOutMedia"), "");
    if (hasFields) fieldAreas.forEach((w) => clearInputArea(w.querySelector(".io-field-area")));
    // 在途结果归属：清空即作废未完成的转换，避免其迟到结果落回已清空的框。
    _convSeq++;
  };

  const io = el("div", { class: "io io-vert" },
 // 输入
    el("div", { class: "io-pane" },
      el("div", { class: "io-pane-head" },
        el("span", { class: "io-pane-title" }, t("ui.op.inTitle")),
        el("div", { class: "io-pane-tools" },
          fontDec, fontInc,
          hasFields ? null : toolBtn("content_paste", t("ui.op.paste"), async () => { try { inArea.value = await navigator.clipboard.readText(); invalidateFileBytes(inArea); } catch { toast(t("ui.toast.clipFail")); } }),
          hasFields ? null : toolBtn("cloud_upload", t("ui.op.pickFile"), () => pickFileIntoArea(inArea, triggerConvert)),
          hasFields ? null : toolBtn("select_all", t("ui.op.selectAll"), () => selectAllIO(inArea)),
          hasFields ? null : toolBtn("download", t("ui.op.export"), () => exportTextAsFile(inArea.value)),
          toolBtn("delete", t("ui.op.clear"), clearAll),
        ),
      ),
      inputBody,
    ),
 // 动作条（居中）
    el("div", { class: "io-actions" }, runAct, chainAct),
 // 输出
    el("div", { class: "io-pane" },
      el("div", { class: "io-pane-head" },
        el("span", { class: "io-pane-title" }, t("ui.op.outTitle")),
        el("div", { class: "io-pane-tools" },
          toolBtn("content_copy", t("ui.op.copy"), () => { navigator.clipboard?.writeText(outArea.value); toast(t("ui.toast.copied")); }),
          toolBtn("select_all", t("ui.op.selectAll"), () => selectAllIO(outArea)),
          toolBtn("download", t("ui.op.export"), () => exportTextAsFile(outArea.value)),
        ),
      ),
      outArea,
 // 出图类 op 的图片预览区（convert 检测输出中的 data:image URL 后填充，可预览+下载）。
      el("div", { class: "io-out-media", id: "ioOutMedia" }),
    ),
  );
  $ws.append(io);

 // 不做 input 实时转换（增删过程性能浪费）。Ctrl+Enter 快捷触发。
  inArea.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); triggerConvert(); }
  });
 // 编辑框记事本化——Ctrl+S 导出输入内容为 .txt（Ctrl+Z 撤销走 contenteditable 原生）。
  attachEditorShortcuts(inArea);
  attachEditorShortcuts(outArea);

 // 所有 op 输入框都继承首页智能框——无条件支持拖入文件（isTextFile 判定：文本读进框
 // 二进制才转 hex）。原先只在 !hasFields 时挂，导致带参 op（加密/编码带 key 的）拖文件无智能识别。
  attachDropDecode(inArea, triggerConvert);

 // 编辑框右键文本处理菜单（智能分段/删空格换行/大小写/反转/金额转中文…）。
 // op 框不走 editorToolbar，故在此直接挂 attachTextContextMenu。输入框可写（onChange 触发转换）
  // 输出框只读（菜单自动降级为复制/全选无损项），多字段模式每个 field 也挂。
  // onChange 走 triggerConvert（带 lazyRun 拦截）——右键粘贴 dataURL 对图像惰执行 op 不自动跑。
  attachTextContextMenu(inArea, { onChange: () => triggerConvert() });
  attachTextContextMenu(outArea, { readonly: true });
  if (hasFields) {
    for (const w of fieldAreas) {
      const ta = w.querySelector(".io-field-area");
      if (ta) attachTextContextMenu(ta);
    }
  }

 // 科普卡（输出框下方）：这是什么 / 原理 / 用法 / 示例 / 公式 / 贴士
  renderEduCard(op.id);

  inArea.focus();
}

// ---- exe 型 op 渲染（requiresBridge）----
// GUI 型：无 params，点「启动」调 op.run 拉起本机 exe。
// CLI 型：有 params（含 stdin/文件 base64 等），点「启动」用当前参数跑一次，结果填结果区。
function renderExeOp(op) {
 // 参数栏（CLI 型可能有；GUI 型 params:[] 则不渲染）
  if (op.params && op.params.length) {
    const bar = el("div", { class: "op-params" });
    for (const d of op.params) bar.append(renderParam(op, d));
    $ws.append(bar);
  }

 // 结果显示区（只读，复用 io-area 样式）
  const resultArea = ioArea({ class: "io-area", placeholder: t("ui.op.launchResult"), readonly: true });
  resultArea.id = "ioOut"; // 复用 id，令 renderParam 里 convert() 调用不报错（exe 不实时转换，但参数改动会触发）
  resultArea.style.fontSize = state.ioFont + "px";

 // 启动按钮
  const launchBtn = el("button", { class: "act-btn primary" }, msym("terminal"), " " + t("ui.op.launch"));
  let running = false;
  launchBtn.addEventListener("click", async () => {
    if (running) return;
    running = true;
    launchBtn.disabled = true;
    const oldHtml = launchBtn.innerHTML;
    launchBtn.textContent = t("ui.op.launching");
    resultArea.classList.remove("error");
    resultArea.style.color = "";
    try {
      const out = await op.run("", state.params);
      resultArea.value = out;
    } catch (e) {
      resultArea.value = "✗ " + (e.message || t("ui.toast.convertFail"));
      resultArea.style.color = "var(--error)";
      resultArea.classList.add("error");
    } finally {
      running = false;
      launchBtn.disabled = false;
      launchBtn.innerHTML = oldHtml;
    }
  });

  const io = el("div", { class: "io io-vert" },
    el("div", { class: "io-actions" }, launchBtn),
    el("div", { class: "io-pane" },
      el("div", { class: "io-pane-head" },
        el("span", { class: "io-pane-title" }, t("ui.op.launchResult")),
        el("div", { class: "io-pane-tools" },
          toolBtn("content_copy", t("ui.op.copy"), () => { navigator.clipboard?.writeText(resultArea.value); toast(t("ui.toast.copied")); }),
        ),
      ),
      resultArea,
    ),
  );
  $ws.append(io);

 // 科普卡（若有）
  renderEduCard(op.id);
}

// ---- 科普卡渲染（输出框下方）----
// 数据来自 eduContent.js（经 defer 门面懒加载）；公式用 KaTeX 懒加载（缺失自动降级为原始 TeX）。
function renderEduCard(opId) {
  const edu = getEduSync(opId, getLocale());
  if (!edu) {
    // 科普数据未就绪（懒加载中）→ 就绪后若仍停留在同一 op 页则补渲一次
    if (!eduContentSettled) {
      eduContentReady().then((m) => {
        if (m && location.hash === "#/op/" + opId && !document.querySelector(".edu-card")) renderEduCard(opId);
      });
    }
    return;
  }

  const card = el("div", { class: "edu-card" });
  card.append(el("div", { class: "edu-card-head" },
    msym("menu_book", "edu-glyph"),
    el("span", { class: "edu-card-title" }, t("ui.edu.title")),
  ));

 // 行内标记解析：$...$ → KaTeX 行内公式占位；`...` → 等宽小块。
 // 返回 DocumentFragment，供多段文本拼接。
 // 顺序（遗留修正）：先提取 `...` 码段，段内字面量不做 $ 公式切分——
 // 否则 `$7z$type$...$` 这类哈希串模板（forensic 五卡）会被误切成伪公式。

 // 多段文本（"\n\n" 分段）→ 若干 <p>
  const paras = (text) => {
    const wrap = el("div", { class: "edu-paras" });
    for (const seg of String(text).split(/\n\n+/)) {
 // 段落以块级 HTML 标签开头（table/ul/ol/pre/div/figure）→ 整段 innerHTML，不拆 <br>
      if (/^\s*<(table|ul|ol|pre|div|figure|blockquote)\b/i.test(seg)) {
        const block = el("div", { class: "edu-rich-block" });
        block.innerHTML = seg;
        wrap.append(block);
        continue;
      }
      const p = el("p", { class: "edu-para" });
 // 段内单换行保留为 <br>
      const lines = seg.split(/\n/);
      lines.forEach((ln, i) => {
        p.append(parseInline(ln));
        if (i < lines.length - 1) p.append(el("br"));
      });
      wrap.append(p);
    }
    return wrap;
  };

  const section = (labelKey, node) => {
    card.append(el("div", { class: "edu-sec" },
      el("div", { class: "edu-sec-label" }, t(labelKey)),
      node,
    ));
  };

  if (edu.what) section("ui.edu.what", paras(edu.what));
  if (edu.principle) section("ui.edu.principle", paras(edu.principle));

 // 对照图（图鉴里能被本 op 解析的编码，挂对照表图；纯装饰，缺图静默跳过）
  const eduImg = EDU_IMAGES[opId];
  if (eduImg) {
    const imgs = Array.isArray(eduImg) ? eduImg : [eduImg];
    const gal = el("div", { class: "edu-imgs" });
    for (const im of imgs) {
      const fig = el("figure", { class: "edu-img-fig" });
      const img = el("img", {
        class: "edu-img", src: im.src, alt: im.cap || "", loading: "lazy",
      });
      img.addEventListener("error", () => fig.remove());
      fig.append(img);
      if (im.cap) fig.append(el("figcaption", { class: "edu-img-cap" }, im.cap));
      gal.append(fig);
    }
    section("ui.edu.chart", gal);
  }

 // 独立公式（display）
  if (Array.isArray(edu.formulas) && edu.formulas.length) {
    const fwrap = el("div", { class: "edu-formulas" });
    for (const f of edu.formulas) {
      const row = el("div", { class: "edu-formula-row" });
      const m = el("div", { class: "edu-math edu-math-block" });
      m.setAttribute("data-tex", f.tex);
      m.setAttribute("data-display", "1");
      row.append(m);
      if (f.caption) row.append(el("div", { class: "edu-formula-cap" }, f.caption));
      fwrap.append(row);
    }
    section("ui.edu.formula", fwrap);
  }

  if (edu.usage) section("ui.edu.usage", paras(edu.usage));

 // 示例表
  if (Array.isArray(edu.examples) && edu.examples.length) {
    const exWrap = el("div", { class: "edu-examples" });
    for (const ex of edu.examples) {
      const row = el("div", { class: "edu-example" });
      row.append(
        el("div", { class: "edu-ex-io" },
          el("span", { class: "edu-ex-tag" }, t("ui.edu.exIn")),
          el("code", { class: "edu-ex-val" }, ex.in),
        ),
      );
      if (ex.param) {
        row.append(el("div", { class: "edu-ex-io" },
          el("span", { class: "edu-ex-tag" }, t("ui.edu.exParam")),
          el("code", { class: "edu-ex-val" }, ex.param),
        ));
      }
      row.append(
        el("div", { class: "edu-ex-io" },
          el("span", { class: "edu-ex-tag edu-ex-tag-out" }, t("ui.edu.exOut")),
          el("code", { class: "edu-ex-val edu-ex-val-out" }, ex.out),
        ),
      );
      if (ex.desc) { const exd = el("div", { class: "edu-ex-desc" }); exd.append(parseInline(ex.desc)); row.append(exd); }
      exWrap.append(row);
    }
    section("ui.edu.example", exWrap);
  }

 // 贴士
  if (Array.isArray(edu.tips) && edu.tips.length) {
    const ul = el("ul", { class: "edu-tips" });
    for (const tip of edu.tips) {
      const li = el("li", { class: "edu-tip" });
      li.append(parseInline(tip));
      ul.append(li);
    }
    section("ui.edu.tips", ul);
  }

 // 别名（产品裁决 2026-09-12）：全部可检索别名以标签形式列在科普卡末尾
  if (Array.isArray(edu.aka) && edu.aka.length) {
    const chips = el("div", { class: "edu-aka-chips" });
    for (const a of edu.aka) chips.append(el("span", { class: "edu-aka-chip" }, a));
    section("ui.edu.aka", chips);
  }

  $ws.append(card);
 // 懒加载渲染公式（异步；KaTeX 缺失时降级为原始 TeX，不报错）
  renderMathIn(card);
}

// ---- 密码学密钥+密文一键尝试面板 ----
function renderCryptoTryAll(op) {
  const head = el("div", { class: "op-head" },
    el("div", { class: "op-title" }, msym("vpn_key"), opName(op)),
    opDescEl(op),
  );
  $ws.append(head);

  const cipherInput = ioArea({
    class: "io-area", placeholder: t("ui.crypto.cipherPlaceholder"),
    style: "min-height:100px",
  });
  const keyInput = el("input", {
    type: "text", class: "crypto-input",
    placeholder: t("ui.crypto.keyPlaceholder"), spellcheck: "false",
  });
  const ivInput = el("input", {
    type: "text", class: "crypto-input",
    placeholder: t("ui.crypto.ivPlaceholder"), spellcheck: "false",
  });
  const cribInput = el("input", {
    type: "text", class: "crypto-input",
    placeholder: t("ui.crypto.cribPlaceholder"), spellcheck: "false",
  });

  const form = el("div", { class: "crypto-form" },
    el("div", { class: "crypto-field" }, el("label", {}, t("ui.crypto.cipher")), cipherInput),
    el("div", { class: "crypto-field" }, el("label", {}, t("ui.crypto.key")), keyInput),
    el("div", { class: "crypto-field" }, el("label", {}, t("ui.crypto.iv")), ivInput),
    el("div", { class: "crypto-field" }, el("label", {}, t("ui.crypto.crib")), cribInput),
  );

  const runBtn = el("button", { class: "mid-btn primary crypto-run" }, msym("bolt"), " " + t("ui.crypto.run"));
  const outWrap = el("div", { class: "crypto-out" });

  runBtn.addEventListener("click", async () => {
    outWrap.innerHTML = "";
    const cipherText = cipherInput.value.trim();
    const keyText = keyInput.value.trim();
    const ivText = ivInput.value.trim();
    const crib = cribInput.value.trim();
    if (!cipherText || !keyText) {
      outWrap.append(el("div", { class: "onekey-empty" }, t("ui.crypto.needInput")));
      return;
    }
    outWrap.append(el("div", { class: "crypto-loading" }, t("ui.crypto.loading")));
    try {
      const cands = await cryptoTryAll({ cipherText, keyText, ivText, crib }, { targets: loadTargetConfig().targets });
      outWrap.innerHTML = "";
      if (!cands.length) {
        outWrap.append(el("div", { class: "onekey-empty" },
          t("ui.crypto.noMatch"),
          el("div", { class: "onekey-hint" }, t("ui.crypto.noMatchHint")),
        ));
        return;
      }
      for (const c of cands) {
        const algoLabel = c.algo + (c.mode ? "-" + c.mode : "") +
          (c.pad === true ? " PKCS7" : (c.pad === false ? " NoPadding" : "")) +
          "  ·  key:" + c.keyEnc + " cipher:" + c.cipherEnc +
          (c.ivEnc ? " iv:" + c.ivEnc : "");
        const cribTag = c.matchesCrib ? " ●" : "";
        const isLong = c.plaintext.length > 500;
        const valEl = el("div", { class: "ok-val" });
        highlightResult(valEl, c.plaintext, c.signals);
        const card = el("div",
          { class: "onekey-card" + (c.matchesCrib ? " crib-hit" : ""),
            title: t("ui.op.copy"),
            onclick: () => { navigator.clipboard?.writeText(c.plaintext); toast(t("ui.toast.copiedResult")); } },
          el("div", { class: "ok-name" }, algoLabel + "　·　" + t("ui.home.confidence") + " " + (c.confidence * 100).toFixed(0) + "%" + cribTag),
          valEl,
        );
        if (isLong) {
          const expandBtn = el("span", { class: "ok-expand" }, t("ui.crypto.expand", c.plaintext.length));
          let expanded = false;
          expandBtn.addEventListener("click", (ev) => {
            ev.stopPropagation();
            expanded = !expanded;
            if (expanded) { valEl.textContent = c.plaintext; expandBtn.textContent = t("ui.crypto.collapse"); }
            else { valEl.textContent = c.plaintext.slice(0, 500) + " …"; expandBtn.textContent = t("ui.crypto.expand", c.plaintext.length); }
          });
          card.append(expandBtn);
        }
        outWrap.append(card);
      }
    } catch (e) {
      outWrap.innerHTML = "";
      outWrap.append(el("div", { class: "file-report-error" }, t("ui.crypto.runFail", (e && e.message ? e.message : String(e)))));
    }
  });

  const toolbar = el("div", { class: "crypto-toolbar" }, runBtn);
  $ws.append(form, toolbar, outWrap);
  renderEduCard(op.id);
  cipherInput.focus();
}

function toolBtn(icon, title, onclick) {
  return el("button", { class: "tool-btn", title, onclick }, msym(icon));
}
function midBtn(icon, title, onclick, primary) {
  return el("button", { class: "mid-btn" + (primary ? " primary" : ""), title, onclick }, msym(icon));
}

function updateDirSeg() {
  const seg = document.getElementById("dirSeg");
  if (!seg) return;
  const [enc, dec] = seg.querySelectorAll("button");
  enc.className = state.dir === "encode" ? "on" : "";
  dec.className = state.dir === "decode" ? "on" : "";
 // 滑块位移：族滑块同款弹簧（1422/57，150ms 档，名义 ζ≈0.75）；应用内「减少动效」
 // 开时由弹簧内核直切终值（spring.js to() 对 html.reduce-motion 直设，无新增状态）。
  const thumb = seg.querySelector(".seg-thumb");
  const onBtn = seg.querySelector("button.on");
  if (!thumb || !onBtn) return;
  thumb.style.width = onBtn.offsetWidth + "px";
  HLSpring.to(thumb, { x: onBtn.offsetLeft }, { stiffness: 1422, damping: 57 });
}

function renderParam(op, d) {
  const wrap = el("div", { class: "param" });
  const id = "p_" + d.key;
  if (d.type === "bool") {
    const cb = el("input", { type: "checkbox", id });
    cb.checked = !!state.params[d.key];
    cb.addEventListener("change", () => { state.params[d.key] = cb.checked; convert("param"); });
    wrap.append(
      el("label", { class: "switch", for: id }, cb, el("span", { class: "track" }), el("span", { class: "knob" })),
      el("label", { for: id }, d.label),
    );
  } else if (d.type === "select") {
    const sel = el("select", { id });
    for (const o of d.options || []) sel.append(el("option", { value: o.value ?? o }, o.label ?? o));
    sel.value = state.params[d.key];
    sel.addEventListener("change", () => { state.params[d.key] = sel.value; convert("param"); });
    wrap.append(el("label", { for: id }, d.label), sel);
  } else if (d.type === "number") {
 // M3 stepper 自实现，替代浏览器原生 spinner。[−][input][＋] flex 容器。
    const min = d.min ?? null, max = d.max ?? null, step = d.step ?? 1;
    const inp = el("input", { type: "text", inputmode: "numeric", id, class: "stepper-inp", placeholder: d.placeholder || "" });
    inp.value = state.params[d.key] ?? "";
    const clamp = (n) => {
      if (Number.isNaN(n)) return n;
      if (min !== null && n < min) n = min;
      if (max !== null && n > max) n = max;
      return n;
    };
    const commit = (n) => {
      const v = clamp(n);
      state.params[d.key] = v;
      inp.value = Number.isNaN(v) ? "" : String(v);
      convert("param");
    };
    const bump = (dir) => {
      const cur = Number(inp.value);
      const base = Number.isNaN(cur) ? (min ?? 0) : cur;
      commit(base + dir * step);
    };
    inp.addEventListener("input", () => { state.params[d.key] = Number(inp.value); convert("param"); });
    inp.addEventListener("blur", () => { if (inp.value !== "") commit(Number(inp.value)); });
    const btn = (iconName, dir, label) => {
      const b = el("button", { type: "button", class: "stepper-btn", "aria-label": label, tabindex: "-1" }, msym(iconName));
      b.addEventListener("click", () => bump(dir));
      return b;
    };
    const box = el("div", { class: "stepper" }, btn("remove", -1, "减"), inp, btn("add", 1, "加"));
    wrap.append(el("label", { for: id }, d.label), box);
  } else if (d.ui === "bigText" || d.type === "textarea") {
    wrap.classList.add("param-big");
    const ta = el("textarea", { id, class: "param-bigta", rows: String(Math.min(10, Math.max(3, d.rows ?? 5))),
      placeholder: d.placeholder || "", spellcheck: "false", autocomplete: "off" });
    ta.value = state.params[d.key] ?? "";
    ta.addEventListener("input", () => { state.params[d.key] = ta.value; convert("param"); });
    const btn = el("button", { type: "button", class: "exp-btn param-bigta-btn",
      title: t("ui.expand.title"), "aria-label": t("ui.expand.title") }, msym("open_in_full"));
    btn.addEventListener("click", () => {
      openExpandModal(ta.value, value => {
        ta.value = value;
        state.params[d.key] = value;
        convert("param");
      }, { modalTitle: d.label, cancelLabel: t("ui.expand.cancel"), saveLabel: t("ui.expand.save") });
    });
    wrap.append(el("label", { for: id }, d.label), el("div", { class: "param-bigbox" }, ta, btn));
  } else if (d.type === "image") {
 // 图片参数：可点按钮选文件、可直接拖图进框，也可粘贴 base64/dataURL（值仍是字符串）
    const inp = el("input", { type: "text", id, placeholder: d.placeholder || "", spellcheck: "false", autocomplete: "off" });
    inp.value = state.params[d.key] ?? "";
    inp.addEventListener("input", () => { state.params[d.key] = inp.value; convert("param"); });
    const setFrom = (file) => {
      if (!file) return;
      const rd = new FileReader();
      rd.onload = () => { inp.value = String(rd.result || ""); state.params[d.key] = inp.value; convert("param"); };
      rd.readAsDataURL(file);
    };
    const fi = el("input", { type: "file", accept: "image/*" });
    fi.style.display = "none";
    fi.addEventListener("change", () => setFrom(fi.files && fi.files[0]));
    const pick = t("ui.op.pickImage");
    const btn = el("button", { type: "button", class: "exp-btn param-bigta-btn", title: pick, "aria-label": pick }, msym("upload"));
    btn.addEventListener("click", () => fi.click());
    inp.addEventListener("dragover", (e) => { e.preventDefault(); inp.classList.add("dragover"); });
    inp.addEventListener("dragleave", () => inp.classList.remove("dragover"));
    inp.addEventListener("drop", (e) => {
      e.preventDefault(); inp.classList.remove("dragover");
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) setFrom(f);
    });
    wrap.append(el("label", { for: id }, d.label), el("div", { class: "param-bigbox" }, inp, btn), fi);
  } else if (EXPANDABLE_KEYS.has(d.key)) {
 // 密钥/IV/字典/替换表/crib 等长文本，用可展开输入框（加宽 + 展开 modal）
    const box = expandableInput({
      id, type: "text", value: state.params[d.key] ?? "", placeholder: d.placeholder || "",
      title: t("ui.expand.title"), modalTitle: d.label,
      cancelLabel: t("ui.expand.cancel"), saveLabel: t("ui.expand.save"),
      onInput: (v) => { state.params[d.key] = v; convert("param"); },
    });
    wrap.append(el("label", { for: id }, d.label), box);
  } else {
    const inp = el("input", { type: d.type === "number" ? "number" : "text", id, placeholder: d.placeholder || "" });
    inp.value = state.params[d.key] ?? "";
    inp.addEventListener("input", () => { state.params[d.key] = d.type === "number" ? Number(inp.value) : inp.value; convert("param"); });
    let dl = null;
    if (Array.isArray(d.datalist) && d.datalist.length) {
 // 候选清单（如常见系统字体）：datalist 供输入时下拉，不强制枚举
      dl = el("datalist", { id: id + "_dl" });
      for (const v of d.datalist) dl.append(el("option", { value: v }));
      inp.setAttribute("list", id + "_dl");
      if (d.localFonts && typeof window.queryLocalFonts === "function") {
 // 本机字体枚举需用户手势授权；不支持该 API 的浏览器不显示按钮
        const lfTitle = t("ui.op.localFonts");
        const fb = el("button", { type: "button", class: "exp-btn", title: lfTitle, "aria-label": lfTitle }, msym("text_fields"));
        fb.addEventListener("click", async () => {
          try {
            const fonts = await window.queryLocalFonts();
            const seen = new Set();
            dl.innerHTML = "";
            for (const f of fonts) if (!seen.has(f.family)) { seen.add(f.family); dl.append(el("option", { value: f.family })); }
            toast(t("ui.op.localFontsDone").replace("{0}", seen.size));
          } catch (e) { toast(t("ui.op.localFontsFail").replace("{0}", String(e && e.message || e))); }
        });
        wrap.append(el("label", { for: id }, d.label), el("div", { class: "param-bigbox" }, inp, fb, dl));
        return wrap;
      }
    }
    wrap.append(el("label", { for: id }, d.label), inp);
    if (dl) wrap.append(dl);
  }
  return wrap;
}
// 首页目标特征默认值：常见 CTF flag 格式（正则）。软加权命中置顶高亮，不硬过滤
// 故默认填 flag 也不会误伤纯文本解码（纯文本仍正常出候选，只是不置顶）。
const DEFAULT_CRIB = "flag\\{|ctf\\{|key\\{|flag=|flag:";

// 判定为「密钥类」长文本参数的 key 名（用可展开输入框）
const EXPANDABLE_KEYS = new Set([
  "key", "iv", "dict", "table", "cover", "salt", "crib", "pairs",
  "alphabet", "keyword", "plaintext", "keystream", "password", "map",
]);

// ---- 执行转换 ----
// op 的 encode/decode/run 可返回值或 Promise（WebCrypto 类算法异步）。
// 用 _convSeq 防竞态：慢的异步结果回来时若已不是最新一次调用，丢弃。
let _convSeq = 0;
async function convert(src) {
  const seq = ++_convSeq;
  const operationDir = state.dir;
  const op = getOp(state.opId);
  if (!op) return;
  // 重运算 op 显式触发：src="param"（参数框逐键等自动路径）命中白名单不跑，
  // 输出区给「点击运行」占位；显式路径（转换按钮 / Ctrl+Enter，src 省略）照旧执行。
  // 仅 system 档走 Worker 通道（非 system 档在 runAct 里已改走主线程 convert）。
  if (src === "param" && isExplicitRunOp(op.id) && currentRandMode() === RAND_MODES.SYSTEM) {
    const outAreaHint = document.getElementById("ioOut");
    if (outAreaHint) {
      outAreaHint.value = explicitRunHint(opName(op));
      outAreaHint.style.color = "";
      outAreaHint.classList.remove("error");
      renderOutMedia(document.getElementById("ioOutMedia"), "");
    }
    return;
  }
 // 图像惰执行 op：参数框逐键改动也不自动跑（输出区放「待执行」占位），点转换才执行。
  if (src === "param" && isLazyRunOp(op.id)) {
    const outAreaHint = document.getElementById("ioOut");
    if (outAreaHint) {
      outAreaHint.value = lazyRunHint(opName(op));
      outAreaHint.style.color = "";
      outAreaHint.classList.remove("error");
      renderOutMedia(document.getElementById("ioOutMedia"), "");
    }
    return;
  }
  const inArea = document.getElementById("ioIn");
  const outArea = document.getElementById("ioOut");
  if (!outArea) return;
 // 多字段模式下，从各字段框收集值，按 op.fieldsJoin（默认换行）拼成单一输入串。
  const hasFields = Array.isArray(op.fields) && op.fields.length > 0;
  let text;
  if (hasFields) {
    const vals = op.fields.map((f) => (document.getElementById("fld_" + f.key)?.value ?? ""));
 // 全空则清空输出（等价单框空输入）
    if (vals.every((v) => v === "") && (op.encode || op.decode)) { outArea.value = ""; renderOutMedia(document.getElementById("ioOutMedia"), ""); return; }
 // 修复：run 单向 op（keygen 类无输入）空输入是合法调用，不放行会被上面的清空分支吞掉。
    text = vals.join(op.fieldsJoin ?? "\n");
  } else if (inArea) {
    text = inArea.value;
    if (text === "" && (op.encode || op.decode)) { outArea.value = ""; renderOutMedia(document.getElementById("ioOutMedia"), ""); return; }
  } else {
 // ：主输入框隐藏（io=none 且未启用自定义实现）→ 空输入直跑 run-only（keygen 类合法调用）。
    text = "";
  }
 // 用户勾选了「高级 · 自定义实现」且有代码 → 用用户代码替换本 op 实现。
 // 执行走 Worker 沙箱 + 超时硬杀；结果形态 {ok,out|error} 在此归一为字符串或抛错。
  const ci = getCustomImpl(state.opId);
  const useCi = ci && ci.enabled && ci.code && ci.code.trim();
  const fn = useCi
    ? (text, p) => runCustomWithTimeout({
        code: ci.code, dir: operationDir, input: text, params: p, rawBytes: p.rawBytes || null,
      }).then((r) => {
        if (!r.ok) throw new Error(r.error + (r.line ? `（第 ${r.line} 行）` : ""));
        return r.out;
      })
    : (op.run || (operationDir === "encode" ? op.encode : op.decode));
 // 原始字节透传：op 声明 acceptsBytes 且输入框有拖入的真字节时
 // 通过 params.rawBytes 传给执行层（如 PNG 等需要真字节而非 hex 文本的 op）。
 // 未声明的 op 完全不受影响，params 里不注入 rawBytes。
  let callParams = { ...state.params };
  if (op.acceptsBytes && !hasFields && inArea && inArea._rawBytes) {
    callParams = { ...state.params, rawBytes: inArea._rawBytes, rawFileName: inArea._rawFileName };
  }
  try {
    // server 档每次运行前异步取一次 → 填预取池 → core 同步消费。
    // 门禁：仅当档位 = server 且用户已在页面内确认条确认启用（serverArmed）才发请求；
    // 默认关闭 ⇒ 零网络请求。失败显式报错并中止本次运行，绝不回落。
    if (currentRandMode() === RAND_MODES.SERVER && serverArmed()) {
      // 取数量（默认 32，上限 1024）与自定义字段名随本地配置一并传入（core 不读存储）。
      const rc = loadRandConfig();
      await warmupServer({ count: rc.count, customField: rc.customField, auth: rc.auth }).catch((e) => {
        throw new Error(t("ui.rand.errFetch") + "：" + ((e && e.message) || String(e)));
      });
    }
    // 异步操作前设占位，防用户误判卡死（v0.1.5：压缩/解压可能走 2s 超时 → 纯 JS 兜底）
    outArea.value = t("ui.crypto.loading");
    outArea.style.color = "";
    outArea.classList.remove("error");
    renderOutMedia(document.getElementById("ioOutMedia"), "");
    const out = await fn(text, callParams);
    if (seq !== _convSeq || !outArea.isConnected) return; // 有更新的一次转换，丢弃本次
    // 产物协议：返回 {text, files:[...]} 对象 → text 进 outArea，files 渲染下载按钮；
    // 字符串返回走旧路径完全不变。
    let outText = out, outFiles = null;
    if (out && typeof out === "object") {
      outText = out.text != null ? out.text : "";
      outFiles = "files" in out ? productFileEntries(out) : null;
    }
    outArea.value = outText;
    outArea.style.color = "";
    outArea.classList.remove("error");
    const mediaBox = document.getElementById("ioOutMedia");
    renderOutMedia(mediaBox, outText);
    renderOutFiles(mediaBox, outFiles); // 在 renderOutMedia 之后追加（其会清容器）
  } catch (e) {
    if (seq !== _convSeq || !outArea.isConnected) return;
    outArea.value = "✗ " + (e.message || t("ui.toast.convertFail"));
    outArea.style.color = "var(--error)";
    outArea.classList.add("error");
    renderOutMedia(document.getElementById("ioOutMedia"), "");
  }
}

// 语言下拉菜单：列全 20 语言（各显自称名），当前语言高亮。选中即 setLocale
// （懒加载语言 await 拉字典 → onLocaleChange 全量重渲染）。点菜单外/再点按钮关闭。
let _langMenu = null;
function closeLangMenu() {
  if (_langMenu) { _langMenu.remove(); _langMenu = null; }
  document.removeEventListener("click", onLangOutside, true);
}
function onLangOutside(e) {
  if (_langMenu && !_langMenu.contains(e.target) && !e.target.closest("#btnLang")) closeLangMenu();
}
function toggleLangMenu(anchor) {
  if (_langMenu) { closeLangMenu(); return; }
  const cur = getLocale();
  const menu = el("div", { class: "lang-menu", role: "menu" });
  for (const code of locales()) {
    const meta = LOCALE_META[code] || { name: code };
    const item = el("div", {
      class: "lang-menu-item" + (code === cur ? " active" : ""),
      role: "menuitem",
      tabindex: "0",
      onclick: () => { closeLangMenu(); setLocale(code); },
      ...keyBtn(() => { closeLangMenu(); setLocale(code); }),
    },
      el("span", { class: "lang-menu-name" }, meta.name),
      meta.dir === "rtl" ? el("span", { class: "lang-menu-tag" }, "RTL") : null,
    );
    menu.appendChild(item);
  }
  const r = anchor.getBoundingClientRect();
  menu.style.position = "fixed";
  menu.style.top = r.bottom + 4 + "px";
  // 纯物理 left 定位 + 溢出保护。不用 insetInlineEnd：菜单 append 到 body，
  // RTL 语言下 body dir=rtl 会把 inline-end 映射成物理 left，值却是「右缘距视口右」
  // 语义 → 菜单飞到对侧 = 偏移 bug。物理坐标不受 dir 影响。
  menu.style.visibility = "hidden";
  document.body.appendChild(menu);
  const mw = menu.offsetWidth;
  // 默认菜单右缘对齐 anchor 右缘（语言按钮在顶栏，右对齐更贴合）
  let left = r.right - mw;
  if (left < 4) left = r.left;                                   // 溢出左边 → 改左缘对齐
  if (left + mw > window.innerWidth - 4) left = window.innerWidth - 4 - mw; // 溢出右边 → 钳制
  menu.style.left = Math.max(4, left) + "px";
  menu.style.visibility = "";
  _langMenu = menu;
  setTimeout(() => document.addEventListener("click", onLangOutside, true), 0);
}

// ============ 昼夜切换（三态：system / light / dark，默认 system 跟随系统）============
// THEME_KEY 持久化用户偏好；无存储时默认 "system"（跟随系统明暗，产品裁决4）。
const THEME_KEY = "ebctf-theme";
// 系统明暗判定（prefers-color-scheme）。matchMedia 不可用时兜底 dark。
function systemPrefersDark() {
  try { return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches; }
  catch { return true; }
}
// 偏好 → 实际明暗："system" 查系统；否则用偏好本身。
function resolveTheme(pref) {
  if (pref === "light" || pref === "dark") return pref;
  const variant = themeVariant(pref);
  if (variant) return variant.dark ? "dark" : "light";
  return systemPrefersDark() ? "dark" : "light"; // system
}
// 读当前偏好（system/light/dark），无存储 → "system"。
let activeThemePref = null;
function themePref() {
  if (activeThemePref !== null) return activeThemePref;
  try { const v = localStorage.getItem(THEME_KEY); return (v === "light" || v === "dark" || v === "system" || themeVariant(v)) ? v : "system"; }
  catch { return "system"; }
}
// 应用偏好：算实际明暗写 data-theme + 同步图标 + 重算动态取色。persist=true 时持久化偏好。
function applyThemePref(pref, persist, skipAccent) {
  activeThemePref = pref;
  const actual = resolveTheme(pref);
  document.documentElement.setAttribute("data-theme", actual);
  if (themeVariant(pref)) document.documentElement.setAttribute("data-palette", pref);
  else document.documentElement.removeAttribute("data-palette");
  const iconNode = document.querySelector("#btnTheme .msym");
  if (iconNode) iconNode.innerHTML = iconSvg(actual === "dark" ? "dark_mode" : "light_mode");
  if (persist) { try { localStorage.setItem(THEME_KEY, pref); } catch { /* 忽略 */ } }
  document.querySelectorAll("[data-theme-pref]").forEach(button => {
    const selected = button.dataset.themePref === pref;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  // skipAccent：模块顶层启动调用时跳过——此刻 reapplyAccent 依赖的 _systemAccentSeed(const)
  // 尚在 TDZ（暂时性死区），调它会 ReferenceError 中断整个模块。启动的动态取色由后面
  // restoreAccent/enableHctEngine 链负责，无需在此重算。
  if (!skipAccent) reapplyAccent();
  return actual;
}
// setTheme(next?)：next 传 "system"/"light"/"dark" 直接设该偏好；省略=在 light/dark 间切换
// （顶栏按钮点击用，跳过 system——顶栏是快捷明暗切换，环境面板才有跟随系统三选一）。
function setTheme(next) {
  if (next === "system" || next === "light" || next === "dark") return applyThemePref(next, true);
  const curActual = document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
  return applyThemePref(curActual === "dark" ? "light" : "dark", true);
}
// 顶栏按钮循环切换：system → light → dark → system（快捷三态轮转）。
function cycleTheme() {
  const order = ["system", "light", "dark"];
  const cur = themePref();
  const next = order[(order.indexOf(cur) + 1) % 3];
  return applyThemePref(next, true);
}
// 供 envPanel 调用：切换偏好（含 system）+ 读当前偏好（高亮对应按钮）。
// ⚠ 钩子名必须与 envPanel.js 一致：envPanel 用 __ebctfSetThemePref / __ebctfGetThemePref。
window.__ebctfSetThemePref = (pref) => applyThemePref(pref, true);
window.__ebctfGetThemePref = () => themePref();   // 返回偏好（system/light/dark），供 envPanel 高亮
// 旧名保留兼容（顶栏等其它调用方）。
window.__ebctfToggleTheme = (next) => setTheme(next);
window.__ebctfGetTheme = () => themePref();
// 启动时按偏好应用（默认 system 跟随系统）。不持久化（未改变用户选择）。
// skipAccent=true：此刻 _systemAccentSeed(const) 尚在 TDZ，reapplyAccent 会崩，跳过。
applyThemePref(themePref(), false, true);
// system 模式下实时跟随系统明暗变化（用户未显式选 light/dark 时）。
try {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onSysChange = () => { if (themePref() === "system") applyThemePref("system", false); };
  if (mq.addEventListener) mq.addEventListener("change", onSysChange);
  else if (mq.addListener) mq.addListener(onSysChange); // 老内核兜底
} catch { /* matchMedia 不可用忽略 */ }

let _pwaRefreshPending = false;
let _pwaBarNotified = false;

// 温和版更新提示：检测到新版本 SW 已安装待命时，给可点击的更新提示条；
// 用户点「刷新」才走 SKIP_WAITING → controllerchange → reload，绝不自动刷新。
function notifyNewVersion(reg, attempt) {
  if (_pwaBarNotified) return;
  const waiting = reg.waiting;
  if (!waiting) {
    // installed 的 statechange 可能早于 registration.waiting 赋值：短轮询兜底（≤8s），不丢提示
    if ((attempt || 0) < 20) setTimeout(() => notifyNewVersion(reg, (attempt || 0) + 1), 400);
    return;
  }
  _pwaBarNotified = true;
  const bar = el("div", { class: "pwa-update-bar" },
    el("span", { class: "pwa-update-text" }, t("ui.pwa.updateBar")),
    el("button", {
      class: "pwa-update-btn", type: "button",
      onclick: () => {
        _pwaRefreshPending = true;
        try { waiting.postMessage("SKIP_WAITING"); } catch { /* waiting 已被替换则忽略 */ }
        bar.remove();
      },
    }, t("ui.pwa.updateRefresh")),
    el("button", {
      class: "pwa-update-close", type: "button", "aria-label": "×",
      onclick: () => bar.remove(),
    }, "×"),
  );
  document.body.append(bar);
}

function initPwa() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!_pwaRefreshPending) return;
    _pwaRefreshPending = false;
    location.reload();
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { scope: "./", updateViaCache: "none" })
      .then((reg) => {
        // 已有 waiting（此前错过提示的）直接补提示；本次安装完成的新 worker 也提示。
        if (reg.waiting && navigator.serviceWorker.controller) notifyNewVersion(reg);
        reg.addEventListener("updatefound", () => {
          const w = reg.installing;
          if (!w) return;
          w.addEventListener("statechange", () => {
            if (w.state === "installed" && navigator.serviceWorker.controller) notifyNewVersion(reg);
          });
        });
      })
      .catch((e) => console.warn("[sw] Service Worker 注册失败（PWA 离线不可用）：", e));
  }, { once: true });
}

function waitForWorkerInstall(worker) {
  if (!worker) return Promise.resolve(null);
  if (worker.state === "installed" || worker.state === "redundant") return Promise.resolve(worker.state);
  return new Promise((resolve) => worker.addEventListener("statechange", () => {
    if (worker.state === "installed" || worker.state === "redundant") resolve(worker.state);
  }));
}

async function checkForUpdate() {
  if (!("serviceWorker" in navigator)) {
    toast(t("ui.topbar.updateUnsupported"));
    return;
  }
  try {
    const registration = await navigator.serviceWorker.getRegistration("./") ||
      await navigator.serviceWorker.register("sw.js", { scope: "./", updateViaCache: "none" });
    await registration.update();
    const installState = await waitForWorkerInstall(registration.installing);
    if (installState === "redundant") throw new Error("Service Worker install failed");
    const waiting = registration.waiting;
    if (waiting && confirm(t("ui.topbar.updateReady"))) {
      _pwaRefreshPending = true;
      waiting.postMessage("SKIP_WAITING");
    } else {
      toast(t("ui.topbar.updateToast"));
    }
  } catch {
    toast(t("ui.topbar.updateFailed"));
  }
}

// ============ 顶栏交互 ============
// M3 触点涟漪（2026-09-09，产品裁决直改动画层）。
// 文档级 pointerdown 委托；载体 prepend 保证文字层在上；宿主裁剪由载体自身 overflow:hidden 承担，
// 不改宿主 overflow（避免裁掉 focus outline）；pressed 不透明度走 --ripple-op（M3 规范 12%）；
// 减动效偏好直接不生成涟漪。宿主重渲染销毁载体时由定时器兜底清理。
(function initM3Ripple() {
  return; // 产品裁决「涟漪效果太糟糕了，取消吧」——涟漪全线停用；CSS 与结构保留备将来重做
  const HOST_SEL = ".act-btn, .nav-item, .nav-subitem, .stepper-btn, .dir-seg button, .io-mini-btn, .nav-toggle, .fav-btn";
  const reduced = () => document.documentElement.classList.contains("reduce-motion"); // 应用内开关
  document.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;                 // 仅主键
    if (reduced()) return;
    const host = e.target && e.target.closest ? e.target.closest(HOST_SEL) : null;
    if (!host || host.disabled) return;
    const rect = host.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return;
    const olds = host.querySelectorAll(":scope > .m3-ripple");
    if (olds.length >= 3) olds[0].remove();     // 并发上限 3 层，防快速连点堆叠
    const span = document.createElement("span");
    span.className = "m3-ripple";
    const dot = document.createElement("span");
    dot.className = "m3-ripple-dot";
    const d = Math.max(rect.width, rect.height) * 2.2;
    dot.style.width = dot.style.height = d + "px";
    dot.style.left = (e.clientX - rect.left) + "px";
    dot.style.top = (e.clientY - rect.top) + "px";
    span.append(dot);
    host.prepend(span);
    requestAnimationFrame(() => requestAnimationFrame(() => dot.classList.add("run"))); // 两帧后启动，确保 scale(0) 初态先落
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      dot.classList.add("out");
      setTimeout(() => span.remove(), 300);
    };
    setTimeout(release, 470);                    // 长按也自动淡出（环扩散 450ms 播完再淡）
    host.addEventListener("pointerup", release, { once: true });
    host.addEventListener("pointercancel", release, { once: true });
    host.addEventListener("pointerleave", release, { once: true });
  }, true);
})();

function initTopbar() {
 // 顶栏版本号由全局 APP_VERSION 注入（index.html 的占位会被覆盖，避免版本号割裂）。
  const appVerEl = document.getElementById("appVer");
  if (appVerEl) appVerEl.textContent = "v" + APP_VERSION;

  document.getElementById("btnTheme").addEventListener("click", () => { cycleTheme(); });
  document.getElementById("btnUpdate").addEventListener("click", checkForUpdate);

 // 语言切换：点开下拉菜单选 20 语言（各显自称名）。选中 setLocale 按需加载 + 全量重渲染。
  const btnLang = document.getElementById("btnLang");
  if (btnLang) {
    btnLang.addEventListener("click", (e) => { e.stopPropagation(); toggleLangMenu(btnLang); });
  }

 // 字库：点开面板，列 4 个 Unicode 平面，可主动预载（要求：全 Unicode 显示 + 标题栏可加载项）。
  const btnFont = document.getElementById("btnFont");
  if (btnFont) {
    btnFont.addEventListener("click", (e) => { e.stopPropagation(); openEnvPanel(btnFont); });
  }

 // 插件：跳独立插件/MCP 页（#/plugins，工作区内渲染，非弹窗）。
  const btnPlugins = document.getElementById("btnPlugins");
  if (btnPlugins) {
    btnPlugins.addEventListener("click", (e) => { e.stopPropagation(); goPlugins(); });
  }

 // 关于：跳独立关于页（#/about，工作区内渲染，非弹窗）。
  const btnAbout = document.getElementById("btnAbout");
  if (btnAbout) {
    btnAbout.addEventListener("click", (e) => { e.stopPropagation(); goAbout(); });
  }

 // 顶栏搜索框：输入实时过滤 op（名称/别名/描述/id），面板列结果，点选跳转。
  initOpSearch();
}

// ---- 字库面板（顶栏「字库」下拉）----
let _fontPanel = null;
function toggleFontPanel(anchor) {
  if (_fontPanel) { _fontPanel.remove(); _fontPanel = null; return; }
  const panel = el("div", { class: "font-panel" });
  const rerender = () => {
    panel.innerHTML = "";
    panel.append(
      el("div", { class: "font-panel-head" }, t("ui.font.title")),
      el("div", { class: "font-panel-note" }, t("ui.font.note")),
    );
    for (const p of FONT_PLANES) {
      const st = fontStatus(p.id);
      const loc = getLocale();
      const btn = el("button",
        { class: "font-load-btn" + (st === "loaded" ? " loaded" : ""),
          disabled: st === "loaded" || st === "loading" },
        st === "loaded" ? t("ui.font.loaded")
          : st === "loading" ? t("ui.font.loading")
          : st === "error" ? t("ui.font.retry")
          : t("ui.font.load"));
      btn.addEventListener("click", () => { loadFontPlane(p.id); });
      panel.append(el("div", { class: "font-plane" },
        el("div", { class: "font-plane-info" },
          el("div", { class: "font-plane-label" }, loc === "en" ? p.labelEn : p.label,
            el("span", { class: "font-plane-size" }, humanSize(p.bytes))),
          el("div", { class: "font-plane-desc" }, loc === "en" ? p.descEn : p.desc),
        ),
        btn,
      ));
    }
  };
  rerender();
  const off = onFontStatusChange(rerender);
  panel._off = off;
  document.body.append(panel);
  _fontPanel = panel;
 // 定位到按钮下方
  const r = anchor.getBoundingClientRect();
  panel.style.top = (r.bottom + 6) + "px";
  panel.style.right = (window.innerWidth - r.right) + "px";
 // 点面板外关闭
  setTimeout(() => {
    const onDoc = (ev) => {
      if (_fontPanel && !_fontPanel.contains(ev.target)) {
        _fontPanel._off && _fontPanel._off();
        _fontPanel.remove(); _fontPanel = null;
        document.removeEventListener("click", onDoc);
      }
    };
    document.addEventListener("click", onDoc);
  }, 0);
}

// ---- 触摸拖拽 → 配方链（HTML5 DnD 在触摸设备不触发，touch 模拟）----
// 长按 320ms 进入拖拽；长按前移动视为正常滚动，避免左侧抽屉无法上下滑。
function attachTouchDragToRecipe(node, getOpId, getFamilyId) {
  let timer = null, active = false, tracking = false;
  let sx = 0, sy = 0, ghost = null;

  const chainAt = (x, y) => {
    const chain = document.getElementById("recipeChain");
    if (!chain) return null;
    const r = chain.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? chain : null;
  };
  const cleanup = () => {
    clearTimeout(timer); timer = null;
    tracking = false; active = false;
    node.classList.remove("touch-dragging");
    document.getElementById("recipeChain")?.classList.remove("recipe-drop-active");
    if (ghost) ghost.remove();
    ghost = null;
  };
  const moveGhost = (t) => {
    if (!ghost) return;
    ghost.style.transform = `translate3d(${t.clientX + 14}px,${t.clientY + 14}px,0)`;
  };

  node.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY; tracking = true; active = false;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!tracking) return;
      active = true;
      node.classList.add("touch-dragging");
      ghost = document.createElement("div");
      ghost.className = "recipe-touch-ghost";
      ghost.textContent = node.querySelector(".nav-subitem-label, .op-search-item-name")?.textContent || node.textContent.trim();
      document.body.append(ghost);
      moveGhost(t);
    }, 320);
  }, { passive: true });

  node.addEventListener("touchmove", (e) => {
    if (!tracking) return;
    const t = e.touches[0];
    if (!active) {
      if (Math.hypot(t.clientX - sx, t.clientY - sy) > 10) {
        clearTimeout(timer); timer = null; // 普通滑动：不抢滚动
        tracking = false;
      }
      return;
    }
    e.preventDefault();
    moveGhost(t);
    const chain = chainAt(t.clientX, t.clientY);
    document.getElementById("recipeChain")?.classList.toggle("recipe-drop-active", !!chain);
  }, { passive: false });

  node.addEventListener("touchend", (e) => {
    clearTimeout(timer); timer = null;
    if (!tracking || !active) { cleanup(); return; }
    const t = e.changedTouches[0];
    e.preventDefault();
    const opId = getOpId();
    // ：族条目触摸拖入 → 选档菜单；普通条目 → 直接入链
    const famId = typeof getFamilyId === "function" ? (getFamilyId() || "") : "";
    if (famId && chainAt(t.clientX, t.clientY)) addRecipeFamilyAt(famId, t.clientX, t.clientY);
    else if (opId && chainAt(t.clientX, t.clientY)) addRecipeOpAt(opId, t.clientX, t.clientY);
    cleanup();
  }, { passive: false });
  node.addEventListener("touchcancel", cleanup, { passive: true });
  node.addEventListener("contextmenu", (e) => { if (active) e.preventDefault(); });
}

// ---- 顶栏搜索：名称/别名/描述/id 实时过滤，下拉候选，点选跳转；候选可拖入配方链 ----
// 索引在首次用时构建；语言切换后清空重建（opName/opDesc 随语言变）。
let _searchIndex = null;
// pinyinSearch 懒载（拼音数据表 58KB 退出首屏闭包）：首次搜索键入触发 + 空闲预热；
// 未就绪期间索引退化为纯名称/别名匹配，就绪后清缓存并按需重算当前查询。
let _pinyinKeysFn = null;
let _pinyinLoading = null;
let _pinyinRerender = null;
function ensurePinyinSearch() {
  if (_pinyinKeysFn || _pinyinLoading) return;
  _pinyinLoading = import("./ui/pinyinSearch.js").then((m) => {
    _pinyinKeysFn = m.pinyinKeys;
    _searchIndex = null;
    if (_pinyinRerender) _pinyinRerender();
  }).catch(() => { _pinyinLoading = null; });
}
eduContentReady().then(() => { _searchIndex = null; }); // 科普别名就绪后清缓存，下次搜索重建含 aka 的索引
function buildSearchIndex() {
  const aliases = eduAliasesSync() || {}; // 科普懒加载未就绪时无别名，索引照建（就绪后清缓存重建）
  const idx = [];
  for (const op of OPS) {
    if (op.id === "cryptoTryAll") continue; // 虚拟 op 不进搜索
    const nm = opName(op);
    const ds = opDesc(op);
    const aka = aliases[op.id] || [];
 // 算法族（）：族显示名 + 档位短名并入可检索文本，让「pgp 加密」「ML-KEM 密钥」
 // 这类「族名+档名」组合词能命中族内 op。family 字段缺失时 famName 为空串，行为同旧。
    const famName = op.family ? (FAMILY_NAMES[op.family] || "") : "";
    let famLbl = "";
    if (op.family && op.familyLabel) {
      const lk = "fam.lbl." + op.familyLabel;
      const lv = famLblText(lk);
      famLbl = lv === lk ? "" : lv; // 缺 key 回退空串，不把裸 key 混进检索文本
    }
 // 拼一条可小写匹配的检索串：名称 + 别名 + 描述 + id + 分类 + 族名 + 档名
 // ：中文名/中文别名的拼音全拼+首字母序列并入（ksmm/kaisamima 命中凯撒密码）；
 // 派生序列不回写 aka（双轨），非中文串返回空集零开销。
    const pyKeys = _pinyinKeysFn ? _pinyinKeysFn(nm, aka) : [];
    const hay = [nm, ...aka, ds, op.id, op.cat, famName, famLbl, ...pyKeys].join("").toLowerCase();
 // name 保持 op 原名：评分（名称前缀命中）与短名优先 tie-break 不受族名影响，保守零回归；
 // 族显示名只用于结果渲染（r.famName → 「族名 - op名」）与所属族标注。
    idx.push({ id: op.id, name: nm, desc: ds, cat: op.cat, aka, famName, hay, py: pyKeys });
  }
  return idx;
}
function searchOps(q) {
  if (!_searchIndex) _searchIndex = buildSearchIndex();
  const query = q.trim().toLowerCase();
  if (!query) return [];
 // 支持空格分词：全部词都命中才算（AND）
 // P0：剥离查询中的动作词（「3DES 解密」「JWT 伪造」「base58解码」→ 算法本体）。
 // 动作词不承载算法身份，全库 aka 也不含（BASE_NOTES 历史防泛词滤除），不剥则系统性 0 命中。
  const ACTION_WORDS = /^(加密|解密|编码|解码|解析|解压|转换|生成|识别|提取|破解|计算|伪造|encrypt|decrypt|encode|decode|parse|convert|generate|identify|extract|crack|calculate|forge|decompress)$/i;
  const ACTION_SUFFIX = /(加密|解密|编码|解码|解析|解压|转换|生成|识别|提取|破解|计算|伪造|encrypt|decrypt|encode|decode|parse|convert|generate|identify|extract|crack|calculate|forge|decompress)$/i;
  let terms = query.split(/\s+/).filter(Boolean);
  const stripped = terms
    .filter((term) => !ACTION_WORDS.test(term))
    .map((term) => { const core = term.replace(ACTION_SUFFIX, ""); return core.length >= 2 ? core : term; });
  if (stripped.length) terms = stripped;
  const scored = [];
  for (const e of _searchIndex) {
    let ok = true;
    let score = 0;
    for (const term of terms) {
      const pos = e.hay.indexOf(term);
      if (pos < 0) { ok = false; break; }
 // 名称开头命中给高分，别名/描述命中给低分
 // ：拼音键前缀命中（ksmm/ksm m 这类首字母查询的本体命中）介于别名与兜底之间，
 // 让「想曰 xy」强于恰好在中段含 xy 的无关 op；键中段命中仍走 hay 兜底 +10。
      const nmPos = e.name.toLowerCase().indexOf(term);
      if (nmPos === 0) score += 100;
      else if (nmPos > 0) score += 40;
      else if (e.aka.some((a) => a.toLowerCase().includes(term))) score += 30;
      else if (e.py && e.py.some((k) => k.startsWith(term))) score += 20;
      else score += 10;
    }
    if (ok) {
 // 产品负责人 2026-09-02：常用 op（CTF_HOT）搜索加权——修「RSA 密钥对生成」被注册序靠前的
 // 攻击类变体（同 100 分）挤出候选位的 bug；同分再按短名优先（入口级 op 排变体长尾前）。
      score += CTF_HOT.has(e.id) ? 25 : 0;
      scored.push({ e, score, nl: e.name.length });
    }
  }
  scored.sort((a, b) => (b.score - a.score) || (a.nl - b.nl));
  return scored; // 全量返回，分页由渲染层负责（默认 20 条 + 加载更多）
}

let _searchActiveIdx = -1;
// 搜索面板「代」令牌：closePanel/renderResults 各推进一代；在途关闭的 onRest 只认自己那一代，
// 避免它把期间新渲染的结果清掉（spring-motion 下关闭动画约 150ms，期间快速连打可复现）。
let _searchPanelGen = 0;
let _searchPanelClosing = false;
function initOpSearch() {
  const input = document.getElementById("opSearchInput");
  const panel = document.getElementById("opSearchPanel");
  if (!input || !panel) return;

  const closePanel = () => {
    const gen = ++_searchPanelGen;
    if (document.documentElement.classList.contains("spring-motion")) {
      _searchPanelClosing = true;
      panel.style.pointerEvents = "none";
      HLSpring.to(panel, { scale: 0.95, opacity: 0 }, { preset: "dur150", onRest: () => {
        if (gen !== _searchPanelGen) return;   // 期间已重新渲染/再次关闭 → 本次清理作废，绝不碰新内容
        _searchPanelClosing = false;
        panel.classList.remove("open"); panel.innerHTML = ""; panel.style.pointerEvents = "";
        HLSpring.set(panel, { scale: 1, opacity: 1 });
      } });
    } else { panel.classList.remove("open"); panel.innerHTML = ""; _searchPanelClosing = false; }
    _searchActiveIdx = -1;
  };

  const pick = (id) => {
    input.value = "";
    closePanel();
    input.blur();
    selectOp(id);
  };

  const renderResults = (results, keepShown) => {
    // 产品负责人 2026-09-02：搜索结果不再砍到 12 条——默认 20 条 + 「加载更多」分页，全量可达。
    const PAGE = 20;
    if (!keepShown) _searchShown = PAGE;
    _searchPanelGen++;                       // 作废在途关闭：其 onRest 不得清掉本次结果
    if (_searchPanelClosing) {               // 在途关闭会把面板压成半透明并屏蔽点击，这里复位
      _searchPanelClosing = false;
      if (document.documentElement.classList.contains("spring-motion")) {
        panel.style.pointerEvents = "";
        HLSpring.set(panel, { scale: 1, opacity: 1 });   // 取消在途补间（set 会 running.delete）
      }
    }
    panel.innerHTML = "";
    _searchActiveIdx = -1;
    if (!results.length) {
      panel.append(el("div", { class: "op-search-empty" }, t("ui.search.empty")));
      panel.classList.add("open");
      return;
    }
    results.slice(0, _searchShown).forEach((s, i) => {
      const r = s.e;
      // ：族内 op 结果显示名 =「族显示名 - op名」（命中项据此标注所属族）；非族 op 原名不变
      const dispName = r.famName ? (r.famName + " - " + r.name) : r.name;
      const item = el("div", { class: "op-search-item", tabindex: "0", "data-idx": String(i), "data-opid": r.id, draggable: "true", title: t("ui.recipe.dragSearchHint"),
        oncontextmenu: e => showFavoriteMenu(e, { opId: r.id }) },
        el("div", { class: "op-search-item-main" },
          el("span", { class: "op-search-item-name" }, dispName),
          el("span", { class: "op-search-item-cat" }, catNameById(r.cat)),
          isFavorite(r.id) ? el("span", { class: "op-search-item-fav", "aria-hidden": "true" }, msym("star")) : null,
        ),
        r.desc ? el("div", { class: "op-search-item-desc" }, r.desc) : null,
      );
      // 桌面：HTML5 DnD → 配方链；mousedown 仍点选跳转。
      item.addEventListener("dragstart", (e) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.effectAllowed = "copy";
        try { e.dataTransfer.setData("application/x-ebctf-op", r.id); } catch { /* ignore */ }
        try { e.dataTransfer.setData("text/plain", r.name); } catch { /* ignore */ }
      });
      item.addEventListener("click", (e) => {
        // 搜索结果不是链接；改造前 Ctrl/Meta/中键也会直接选中，保持该行为。
        if (e.ctrlKey || e.metaKey || e.button === 1) { e.preventDefault(); pick(r.id); return; }
        recipeAwareClick(e, () => pick(r.id));
      });
      item.addEventListener("dblclick", (e) => recipeOpDoubleClick(e, r.id));
      item.addEventListener("mouseenter", () => { setActive(i); });
      // 触摸：长按 320ms 后拖到配方链；轻触仍选中跳转。
      attachTouchDragToRecipe(item, () => r.id);
      panel.append(item);
    });
    if (results.length > _searchShown) {
      panel.append(el("button", {
        type: "button", class: "op-search-more",
        onclick: (e) => { e.stopPropagation(); _searchShown += PAGE; renderResults(results, true); },
      }, `${t("ui.search.more")}（${results.length - _searchShown}）`));
    }
    const wasOpen = panel.classList.contains("open");
    panel.classList.add("open");
    if (!wasOpen && document.documentElement.classList.contains("spring-motion")) {
      HLSpring.set(panel, { scale: 0.95, opacity: 0 });
      HLSpring.to(panel, { scale: 1, opacity: 1 }, "dur150");
    }
  };
  let _searchShown = 20;

  const items = () => Array.from(panel.querySelectorAll(".op-search-item"));
  const setActive = (i) => {
    const all = items();
    all.forEach((n) => n.classList.remove("active"));
    _searchActiveIdx = i;
    if (i >= 0 && all[i]) all[i].classList.add("active");
  };

  input.addEventListener("input", () => {
    ensurePinyinSearch(); // 首次键入触发拼音表懒载（就绪后经 _pinyinRerender 重算当前输入）
    const results = searchOps(input.value);
    if (!input.value.trim()) { closePanel(); return; }
    renderResults(results);
  });
  input.addEventListener("focus", () => {
    if (input.value.trim()) renderResults(searchOps(input.value));
  });
  input.addEventListener("keydown", (e) => {
    const all = items();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (all.length) setActive((_searchActiveIdx + 1) % all.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (all.length) setActive((_searchActiveIdx - 1 + all.length) % all.length);
    } else if (e.key === "Enter") {
      const all2 = items();
      if (_searchActiveIdx >= 0 && all2[_searchActiveIdx]) {
        all2[_searchActiveIdx].click();
      } else if (all2.length === 1) {
        all2[0].click();
      }
    } else if (e.key === "Escape") {
      input.value = "";
      closePanel();
      input.blur();
    }
  });
 // 点面板外关闭
  document.addEventListener("click", (ev) => {
    if (!document.getElementById("topbarSearch")?.contains(ev.target)) closePanel();
  });
 // 语言切换后索引失效
  onLocaleChange(() => { _searchIndex = null; });
 // 拼音就绪后重算当前查询（懒载完成回调）；空闲预热让键入前通常已就绪（同 edu defer 门控手法）
  _pinyinRerender = () => { if (input.value.trim()) renderResults(searchOps(input.value)); };
  if (typeof requestIdleCallback === "function") requestIdleCallback(ensurePinyinSearch, { timeout: 3000 });
  else setTimeout(ensurePinyinSearch, 1500);
}
// 按分类 id 取本地化分类名（搜索候选右侧标签用）
function catNameById(catId) {
  const cat = CATEGORIES.find((c) => c.id === catId);
  return cat ? catName(cat) : catId;
}

// ---- 关于页：顶栏「关于」→ 居中 modal ----
// 内容：项目名 / 作者(EternalBlaze) / 版本 / op 统计 / 技术栈 / 零外发声明 /
// GitHub 仓库入口 / 依赖致谢 / 参考项目 / 许可。
const REPO_URL = "https://github.com/Henglie/EBCTFCodeBox";
// 参考项目：写明引用/借鉴内容与地址。
const REFERENCE_PROJECTS = [
  {
    name: "CyberChef（赛博厨师）",
    url: "https://github.com/gchq/CyberChef",
    borrow: "「配方链」线性管道式操作串联的交互范式借鉴自它。",
  },
  {
    name: "dCode",
    url: "https://www.dcode.fr/",
    borrow: "1300+ 编码/密码工具清单交叉对照与收录判定源；多算法口径与官方示例对拍基准。",
  },
  {
    name: "ToolsFx（密码学工具箱）",
    url: "https://github.com/Leon406/ToolsFx",
    borrow: "部分古典/现代密码与哈希算法的纯 JS 实现思路参考自其公开实现。",
  },
  {
    name: "flowforge-crypto",
    url: "https://github.com/marlkiller/flowforge-crypto",
    borrow: "早期评估过节点式数据流编排，最终选择更轻的线性配方链，此处记录来源。",
  },
  {
    name: "剪贴板里有什么？ (WhatsInYourClipboard)",
    url: "https://github.com/Henglie/WhatsInYourClipboard",
    borrow: "同作者的前置工程：剪贴板内容智能分类识别（格式嗅探 + 隐写透视）的思路与本工具的「一键解码」相承。",
  },
];
// 关于页：独立路由 #/about，像 op 页一样在工作区渲染（非弹窗）。
// 结构：logo 占位 → 标题 → 简介 → GitHub → 引用项目 → 依赖 → 技术栈 →
//      作者 + 鸣谢 → 注册信息（来源/授权两行）→ 版权（2026–今年，自动取）→ 字库声明。
function renderAbout(host) {
  const page = el("div", { class: "about-page" });

 // ① 顶部 logo（软件图标）
  const logo = el("div", { class: "about-logo", "aria-hidden": "true" },
    el("img", { class: "about-logo-img", src: "public/logo.webp", alt: "", width: "96", height: "96", loading: "lazy" }));

 // ② 标题（去掉 badges，只留名 + 版本号小字）
  const title = el("div", { class: "about-title" }, appDisplayName() || t("ui.about.appName"));
  const ver = el("div", { class: "about-ver" }, "v" + APP_VERSION);

 // ③ 简介
  const intro = el("p", { class: "about-intro" }, t("ui.about.intro"));

 // ④ GitHub 入口（零外发：仅外跳链接，不嵌徽章图、不拉 star 数）
  const repoBtn = el("a", {
    class: "about-repo-btn", href: REPO_URL, target: "_blank", rel: "noopener noreferrer",
  }, msym("code"), el("span", null, t("ui.about.repoBtn")));

  page.append(el("div", { class: "about-hero" }, logo, title, ver, intro, repoBtn));

 // 通用小节工厂
  const section = (labelKey, ...nodes) => {
    const sec = el("div", { class: "about-section" });
    sec.append(el("div", { class: "about-sec-label" }, t(labelKey)));
    for (const n of nodes) if (n) sec.append(n);
    return sec;
  };

 // op 统计（从 registry 动态取，含 10 大类 + 本地桥细分类）
  const opCount = OPS.length;
  const catCount = CATEGORIES.filter((c) => c.id !== "home").length;

 // ⑤ 技术栈 + 功能规模 + 隐私（键值行）
  const kv = (label, valNode) => el("div", { class: "about-row" },
    el("div", { class: "about-row-label" }, label),
    el("div", { class: "about-row-val" }, valNode),
  );
  page.append(section("ui.about.stack",
    kv(t("ui.about.opCount"), el("span", null, t("ui.about.opCountVal", opCount, catCount))),
    kv(t("ui.about.stack"), el("span", null, t("ui.about.stackVal"))),
    kv(t("ui.about.privacy"), el("span", { class: "about-privacy" }, t("ui.about.privacyVal"))),
  ));

 // ⑥ 参考项目：写明借鉴内容 + 地址
  const refWrap = el("div", { class: "about-refs" });
  for (const r of REFERENCE_PROJECTS) {
    const nameNode = r.url && r.url !== "TODO"
      ? el("a", { class: "about-ref-name", href: r.url, target: "_blank", rel: "noopener noreferrer" }, r.name)
      : el("span", { class: "about-ref-name" }, r.name);
    refWrap.append(el("div", { class: "about-ref" }, nameNode, el("span", { class: "about-ref-note" }, r.borrow)));
  }
  page.append(section("ui.about.refs", refWrap));

 // 依赖与致谢
 // 新增条目的 note 走本地中文兜底（i18n 冻结期不进主表，解冻后回收为正式 key）。
 // ⚠ 许可红线（产品负责人）：只列 MIT/BSD/Apache 等宽松许可；GPL/LGPL 等传染性协议不在此列
 //  （如快速换算的 WASM 汇编引擎 Keystone 为 GPL-2.0，按规不展示，许可信息仅存 PROGRESS.md）。
  const _DEP_ZH = {
    "ui.about.depCm": "自定义实现编辑器内核（行号 / 语法高亮 / 查找 / 撤销 / 括号配对），以 MIT 许可内嵌打包，零运行时外发。",
    "ui.about.depCapstone": "机器码反汇编引擎（WASM 编译版），多架构指令级解析，BSD-3-Clause 许可。",
    "ui.about.depNoble": "椭圆曲线与哈希最小闭包（noble-curves/noble-hashes），MIT 许可内嵌打包（含 LICENSE.txt）。",
    "ui.about.depBwip": "条形码生成引擎 bwip-js + BWIPP，双 MIT 许可，零运行时外发。",
    "ui.about.depMtcolor": "Material Design 3 动态取色算法，Apache-2.0 许可随包（public/vendor/material-color/）。",
    "ui.about.depZxing": "二维码/条码解码内核 zxing-wasm（上游 ZXing-C++），MIT 许可随包（public/wasm/zxing/LICENSE）。",
  };
  const depT = (k) => { const v = t(k); return v === k && _DEP_ZH[k] ? _DEP_ZH[k] : v; };
  const deps = [
    { name: "CodeMirror 6", note: depT("ui.about.depCm"), lic: "MIT" },
    { name: "Capstone", note: depT("ui.about.depCapstone"), lic: "BSD-3-Clause" },
    { name: "KaTeX", note: t("ui.about.depKatex"), lic: "MIT" },
    { name: t("ui.about.depTianheng"), note: t("ui.about.depTianhengNote"), lic: t("ui.about.depTianhengLic") },
    { name: "Material Symbols", note: t("ui.about.depMsym"), lic: "Apache-2.0" },
    { name: "noble curves/hashes", note: depT("ui.about.depNoble"), lic: "MIT" },
    { name: "bwip-js + BWIPP", note: depT("ui.about.depBwip"), lic: "MIT" },
    { name: "material-color-utilities", note: depT("ui.about.depMtcolor"), lic: "Apache-2.0" },
    { name: "zxing-wasm", note: depT("ui.about.depZxing"), lic: "MIT" },
  ];
  const depWrap = el("div", { class: "about-deps" });
  for (const d of deps) {
    depWrap.append(el("div", { class: "about-dep" },
      el("span", { class: "about-dep-name" }, d.name),
      el("span", { class: "about-dep-note" }, d.note),
      el("span", { class: "about-dep-lic" }, d.lic),
    ));
  }
  page.append(section("ui.about.credits", depWrap));

 // ⑥.5 语言支持：各语言界面文案翻译完成度（相对中文权威表，运行时统计）。
 //  恒烈 2026-10-12 要求：关于页备注各语言翻译百分比，每个版本都要做 —— 故改为
 //  打开本页时实时计算，新增文案键后百分比自动跟随，不需要任何手工维护。
 const langsWrap = el("div", { class: "about-langs" });
 page.append(section("ui.about.langs",
   el("p", { class: "about-langs-note" }, t("ui.about.langsNote")),
   langsWrap,
 ));
 localeCoverage().then((rows) => {
   for (const r of rows) {
     const bar = el("span", { class: "about-lang-bar" });
     const fill = el("i", { class: "about-lang-fill" });
     fill.style.width = Math.max(3, Math.min(100, r.pct)) + "%";
     bar.append(fill);
     langsWrap.append(el("div", { class: "about-lang", dir: r.dir },
       el("span", { class: "about-lang-name" }, r.name),
       bar,
       el("span", { class: "about-lang-pct" }, r.pct.toFixed(1) + "%"),
     ));
   }
 }).catch(() => {});

 // ⑦ 作者 + 贡献者（胶囊）+ 鸣谢
 //  创始人：头像 + 加粗名 + 角色徽标；其他开源贡献者：纯胶囊无头像。
  const contribWrap = el("div", { class: "about-contribs" });
  contribWrap.append(
    el("span", { class: "about-capsule about-capsule-founder" },
      el("img", { class: "about-capsule-avatar", src: "public/contributors/fang.jpg", alt: "", loading: "lazy" }),
      el("span", { class: "about-capsule-name" }, "恒烈 · EternalBlaze"),
      el("span", { class: "about-capsule-role" }, t("ui.about.founderBadge")),
    ),
  );
 // 后续贡献者追加到此数组：{ name, tierKey, avatar?, noteKey? }。
 //  tierKey 阶梯：tierAuthor（作者）/ tierDeveloper（开发者）/ tierContributor（贡献者）/ tierFeeder（投喂者）；
 //  founderBadge（创始人·作者）为创始人专属，见上方头像胶囊。
 //  avatar 可选：给了头像即用高亮胶囊（同创始人样式，带圆头像）；noteKey 可选，附贡献说明。
  const OTHER_CONTRIBUTORS = [
    { name: "小布丁", tierKey: "ui.about.tierAuthor", avatar: "public/contributors/xiaobuding.jpg" },
    { name: "Enze", tierKey: "ui.about.tierContributor", note: String(getLocale()).toLowerCase().startsWith("zh") ? "提出配方链交互优化方案" : "Proposed the recipe-chain interaction improvements" },
    { name: "yy2m1a0", tierKey: "ui.about.tierContributor", noteKey: "ui.about.contribY2m1a0" },
    { name: "霍雅", tierKey: "ui.about.tierContributor", noteKey: "ui.about.contribHuoya" },
    { name: "0x0off", tierKey: "ui.about.tierContributor", noteKey: "ui.about.contrib0x0off" },
    { name: "懒羊羊大王", tierKey: "ui.about.tierContributor", noteKey: "ui.about.contribLyy" },
    { name: "风之暇想", tierKey: "ui.about.tierContributor", noteKey: "ui.about.contribFzxx" },
    { name: "jluvb", tierKey: "ui.about.tierContributor", noteKey: "ui.about.contribJluvb" },
    { name: "smile1110", tierKey: "ui.about.tierContributor", noteKey: "ui.about.contribSmile1110" },
    { name: "拉面", tierKey: "ui.about.tierContributor", noteKey: "ui.about.contribLamian" },
    { name: "qinling072", tierKey: "ui.about.tierContributor", note: String(getLocale()).toLowerCase().startsWith("zh") ? "提出补充 OutGuess 等图像隐写算法" : "Proposed adding OutGuess and other image-steganography algorithms" },
    { name: "cnui6", tierKey: "ui.about.tierContributor", note: String(getLocale()).toLowerCase().startsWith("zh") ? "提出 Rabbit 兼容性修复（Legacy 变体与口令支持）" : "Proposed the Rabbit compatibility fix (Legacy variant + passphrase support)" },
  ];
  for (const c of OTHER_CONTRIBUTORS) {
    const cap = el("span", { class: c.avatar ? "about-capsule about-capsule-founder" : "about-capsule" });
    if (c.avatar) cap.append(el("img", { class: "about-capsule-avatar", src: c.avatar, alt: "", loading: "lazy" }));
    cap.append(el("span", { class: "about-capsule-name" }, c.name));
    cap.append(el("span", { class: "about-capsule-role" }, t(c.tierKey)));
    if (c.noteKey || c.note) cap.append(el("span", { class: "about-capsule-note" }, c.note || t(c.noteKey)));
    contribWrap.append(cap);
  }
  page.append(section("ui.about.contributors",
    contribWrap,
    el("p", { class: "about-thanks" }, t("ui.about.thanksVal")),
  ));

 // ⑦.5 授权附加展示项（_license.ext）：全部文本与数据均来自 license.bin，源码不含任何字面量。
 //  无 bin 时 ext 为 null，整体跳过。结构：{ title, img, imgCap, rows:[{icon,label,value,href}] }。
  const ext = _license.ext || null;
  if (ext && typeof ext === "object") {
    const extNodes = [];
    if (ext.img) {
      // 尺寸可选：imgW 数字（px，钳 80~480）→ 覆盖 CSS 默认最大宽；未给则用样式默认值。
      const w = Number(ext.imgW);
      const openImg = () => openImageLightbox(ext.img, ext.imgCap || ext.title || "");
      const imgAttrs = {
        class: "about-ext-media", src: ext.img, alt: ext.imgCap || "", loading: "lazy",
        title: t("ui.ci.zoom"), onclick: openImg, ...keyBtn(openImg),
      };
      // 图 + 图注包进 figure（figure 定宽、图与注都 width:100% 填满）→ 图注收到图片显示宽、居中在图正下方。
      // imgW（bin 可选）覆盖 figure 宽度（非 img max-width）：figure 是定宽基准，图注跟着它收缩。
      const figAttrs = { class: "about-ext-fig" };
      if (Number.isFinite(w) && w > 0) figAttrs.style = `width:${Math.min(Math.max(w, 80), 480)}px`;
      const fig = el("figure", figAttrs, el("img", imgAttrs));
      if (ext.imgCap) fig.append(el("figcaption", { class: "about-ext-cap" }, ext.imgCap));
      extNodes.push(fig);
    }
    if (Array.isArray(ext.rows)) {
      for (const r of ext.rows) {
        if (!r || !r.value) continue;
        const valNode = r.href
          ? el("a", { class: "about-ext-link", href: r.href, target: "_blank", rel: "noopener noreferrer" }, r.value)
          : el("span", { class: "about-ext-val" }, r.value);
        extNodes.push(el("div", { class: "about-ext-row" },
          ...(r.icon ? [msym(r.icon, "about-ext-ico")] : []),
          ...(r.label ? [el("span", { class: "about-ext-label" }, r.label)] : []),
          valNode,
        ));
      }
    }
    if (extNodes.length) {
      const box = el("div", { class: "about-section" });
      if (ext.title) box.append(el("div", { class: "about-sec-label" }, ext.title));
      box.append(...extNodes);
      page.append(box);
    }
  }

 // ⑧ 授权信息（胶囊）：由 license.bin 验签结果驱动。
 //  验签通过 → 绿色「已验证授权」胶囊 + 授权对象 + 签发时间；无 bin / 失败 → 中性「开源自编译」胶囊。
  const licVerified = !!_license.verified;
  // 验签通过 → 三个不同色胶囊各占一行：①授权（绿）②来源（蓝）③签发时间（琥珀）+ 第四行 note 纯文本。
  //  无 bin / 失败 → 单个中性「开源自编译」胶囊。
  const pill = (variant, label, val) =>
    el("div", { class: "about-license-pill about-license-line is-" + variant },
      el("span", { class: "about-license-dot" }),
      el("span", { class: "about-license-status" }, label),
      ...(val ? [
        el("span", { class: "about-license-sep" }, "·"),
        el("span", { class: "about-license-to" }, val),
      ] : []),
    );
  const licNodes = [];
  if (licVerified) {
    licNodes.push(pill("verified", t("ui.about.regVerified"), _license.licensedTo || null));
    if (_license.source) licNodes.push(pill("source", t("ui.about.regFromLabel"), _license.source));
    if (_license.issuedAt) {
      const d = new Date(_license.issuedAt);
      if (!isNaN(d)) licNodes.push(pill("time", t("ui.about.regIssuedAt"), d.toLocaleString()));
    }
    // 第四行：备注（无胶囊，纯文本小字）。
    if (_license.note) licNodes.push(el("div", { class: "about-license-note" }, _license.note));
  } else {
    licNodes.push(pill("oss", t("ui.about.regSourceGithub"), null));
  }
  page.append(section("ui.about.regTitle", ...licNodes));

 // 天珩字库版权与修改声明（作者沈天珩本人要求，法律硬约束）
  page.append(section("ui.about.fontNoticeTitle",
    el("div", { class: "about-font-notice-body" },
      el("p", null, t("ui.about.fontOrigAuthor")),
      el("p", null, t("ui.about.fontModified")),
      el("p", { class: "about-font-warn" }, t("ui.about.fontNonCommercial")),
    ),
  ));

 // ⑨ 版权年份：2026 起，结束年自动取今年（{0} 占位）。
  const thisYear = new Date().getFullYear();
  const yearRange = thisYear > 2026 ? `2026–${thisYear}` : "2026";
  page.append(el("div", { class: "about-copyright" }, t("ui.about.copyright", yearRange)));

  host.append(page);
}

// 应用静态顶栏文案（HTML 里写死的中文 → 按当前语言刷新）。
function applyStaticI18n() {
 // 首屏静态图标：HTML 里写死字面文本（terminal/translate…），启动时注入 SVG，消除闪字。
  const setIcon = (sel, name) => { const n = document.querySelector(sel); if (n) n.innerHTML = iconSvg(name); };
  setIcon("#btnLang .msym", "translate");
  setIcon("#btnFont .msym", "tune");
  setIcon("#btnPlugins .msym", "extension");
  setIcon("#btnAbout .msym", "info");
  setIcon("#topbarSearch .topbar-search-icon", "search");
  setIcon("#btnUpdate .msym", "update");
  setIcon("#btnTheme .msym", document.documentElement.getAttribute("data-theme") === "dark" ? "dark_mode" : "light_mode");

  const set = (sel, txt) => { const n = document.querySelector(sel); if (n) n.textContent = txt; };
  const brandName = appDisplayName() || t("ui.brand.title"); // 授权 appName 覆盖（未声明用内置名）
  set(".brand-title", brandName);
  document.title = brandName;
  set("#btnUpdate .icon-btn-label", t("ui.topbar.update"));
  set("#btnLang .icon-btn-label", t("ui.topbar.lang"));
  set("#btnFont .icon-btn-label", t("ui.env.btn"));
  set("#btnPlugins .icon-btn-label", t("ui.plugin.btn"));
  set("#btnAbout .icon-btn-label", t("ui.about.btn"));
  const searchInput = document.getElementById("opSearchInput");
  if (searchInput) searchInput.setAttribute("placeholder", t("ui.search.placeholder"));
  const setAttr = (sel, attr, v) => { const n = document.querySelector(sel); if (n) n.setAttribute(attr, v); };
  setAttr("#btnUpdate", "title", t("ui.topbar.update"));
  setAttr("#btnRepo", "title", t("ui.topbar.repo"));
  setAttr("#btnTheme", "title", t("ui.topbar.theme"));
  setAttr("#btnLang", "title", t("ui.topbar.lang"));
  setAttr("#btnFont", "title", t("ui.env.btn"));
}

// 语言切换 → 全量重渲染（顶栏静态文案 + 导航 + 当前工作区）。
// 切到英文时懒加载英文科普层（首次 import，后续缓存）。
onLocaleChange((loc) => {
  if (loc === "en") {
 // 英文科普层懒加载完成后再补一次渲染——否则本次切换的当前页 edu 因先渲染后注册而临时回落中文（P1 修复时实证的既有竞态）
    import("./core/eduContent.en.js").then(() => renderWorkspace()).catch((e) => console.warn("[edu-en] 英文科普层加载失败，回落中文科普：", e)); // ：此静默曾掩盖 P1（分片语法错全包回落），保留回落行为只加可见性
  }
  applyStaticI18n();
  renderNav();
  renderWorkspace();
});

// ============ 注册密钥+密文一键尝试（virtual op，renderOp 特殊渲染）============
register({
  id: "cryptoTryAll",
  cat: "crypto",
  name: "密钥+密文一键尝试",
  desc: "给定密文+密钥(+IV)，自动枚举 AES/DES/3DES/RC4/XOR/Fernet × ECB/CBC/CFB/OFB/CTR × 4 编码组合，用 crib 或可打印率+熵打分",
  params: [],
  run: async () => "",
});

// ---- 侧栏拖拽调宽：拖 .nav-resizer 改 --nav-w（会话态，不持久化）。
// 折叠态不响应拖拽；展开后恢复上次拖出的宽度。范围 180-480px。
function initNavResizer() {
  const rez = document.getElementById("navResizer");
  const nav = $nav;
  if (!rez || !nav) return;
  let dragging = false;
  const onMove = (e) => {
    if (!dragging) return;
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    const w = Math.max(180, Math.min(480, x - nav.getBoundingClientRect().left));
    state.navW = w;
    document.documentElement.style.setProperty("--nav-w", w + "px");
  };
  const stop = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("nav-resizing");
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", stop);
  };
  const start = (e) => {
    if (navRail()) return; // 折叠态 / 窄屏 rail 不拖
    dragging = true;
    document.body.classList.add("nav-resizing");
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", stop);
    e.preventDefault();
  };
  rez.addEventListener("mousedown", start);
 // 双击把手 → 复位默认宽度
  rez.addEventListener("dblclick", () => {
    state.navW = 0;
    document.documentElement.style.removeProperty("--nav-w");
  });
}

// ============ 启动 ============
// 应用内减动效开关（默认关＝动画照常；localStorage 'ebctf.reduceMotion'='1' 开启）。
// 必须在任何渲染前落类，保证首屏动画策略一致。OS 偏好不再自动接管（产品负责人 2026-09-09 指示）。
if (localStorage.getItem("ebctf.reduceMotion") === "1") {
  document.documentElement.classList.add("reduce-motion");
}
initPwa();
// 加载屏遮白屏。模块顶层 import 已完成才执行到这，故进度从「初始化界面」起步。
setLoadingProgress(60, "ui.loading.ui");
applyStaticI18n();
initTopbar();
initNavResizer();
// 窄屏边界交叉时重渲导航：rail 态随视口宽度切换（navRail()），否则已展开的二级菜单
// 在 resize 后仍残留 260px 宽渲染、rail 60px 里横向溢出（穿模）。
let _lastNavRail = null;
function trackNavRail() {
  const r = navRail();
  if (_lastNavRail !== null && r !== _lastNavRail) renderNav();
  _lastNavRail = r;
}
window.addEventListener("resize", trackNavRail);
trackNavRail();
// 启动时恢复用户上次选的强调色（localStorage），随当前 data-theme 明暗重算 tonal。
applySavedAccent();
// 后台启用 B 路线 HCT 精确引擎（Google material-color-utilities，本地 vendor 懒加载）。
// 加载完用精确 tonal 重算一次（渐进增强：A 路线已先出色，HCT 到位后无缝替换）。失败静默留 A 路线。
enableHctEngine().then((ok) => { if (ok) reapplyAccent(); }).catch(() => { /* 降级留 A 路线 */ });
// 按当前 hash 定位（#/op/xxx 直达该功能，刷新/中键多开保持）；无 hash → 首页
applyRoute();
// 授权：异步读 license.bin 验签，写回 _license；若当前在关于页则重渲染以显示授权信息。
// fire-and-forget，不阻塞启动。未读到 / 验签失败时 _license 保持开源自编译默认。
loadLicense().then((lic) => {
  if (lic) _license = lic;
  if (state.view === "about") renderWorkspace();
 // 授权自带自定义软件名时刷新顶栏品牌与页面标题（启动时 license 已按内置名渲染过一遍）
  if (appDisplayName()) applyStaticI18n();
}).catch(() => { /* 读取失败静默留开源默认 */ });
setLoadingProgress(100, "ui.loading.ready");
hideLoadingScreen();
// 首屏就绪后闲时预载热点批（CTF_HOT 命中源文件，不占首屏带宽）
preloadIdle([...CTF_HOT].map(HOT_FILE_OF).filter(Boolean));
// 空闲预热英文表（en 已改按需加载，不进主 bundle）：双语对照注解数秒内就绪。
warmEnglish();
// 持久化语言若是懒加载语言（非 zh）：首屏先用 zh 回退渲染，字典异步拉到后重渲染。
// fire-and-forget，绝不阻塞启动（顶层 await 会中断后续按钮绑定，故不用）。
// ⚠ 英文科普层必须在这里补载：它原先只在 onLocaleChange 里 import，而初始加载不触发该回调
//   → 英文用户每次刷新都会看到中文科普（2026-10-11 实测：`ebctf_locale=en` 刷新后 rsaSign 科普仍为中文）。
//   补上后与「切到英文」路径同口径：先等科普层注册完，再重渲染，避免先渲染后注册的竞态。
initLocale().then(async (loc) => {
  if (loc === "en") {
    try { await import("./core/eduContent.en.js"); } catch (e) { console.warn("[edu-en] 英文科普层加载失败，回落中文科普：", e); }
  }
  if (loc && loc !== "zh") { applyStaticI18n(); renderNav(); renderWorkspace(); }
}).catch(() => { /* 语言包加载失败静默留 zh 回退 */ });
function HOT_FILE_OF(id) { return OP_FILE_MAP[id]; } // 热点 op → 源文件
// 区分本地版 vs 服务器版。判据 = bridge 是否在线（通用点我启动.py 本地部署会同进程自启桥）。
// 本地版：桥在 → 页面加载完后后台渐进拉全量天珩 4 平面（补冷僻字，不阻塞首屏）。
// 服务器版：桥不在 → 只留首屏子集，全量 31MB 不自动拉（省带宽/加速首屏），留环境面板手动加载。
// ---------- M3 动态取色（种子色 → tonal 语义变量，本地纯计算零外发）----------
// 用户在环境面板选强调色 → 存 localStorage("ebctf.accent") → applyAccent 覆盖 primary 族。
// 默认不设（留空）→ 用 theme.css 出厂砖红，不动。设过才生效。
const ACCENT_KEY = "ebctf.accent";
function currentThemeDark() {
  return document.documentElement.getAttribute("data-theme") !== "light";
}
function applySavedAccent() {
  if (document.documentElement.hasAttribute("data-palette")) { resetAccent(); return; }
  let seed = null;
  try { seed = localStorage.getItem(ACCENT_KEY); } catch { /* 隐私模式忽略 */ }
 // 无保存色 → 回落默认砖红种子，走动态取色管线生成整套 M3 主题（含淡暖灰中性 surface）
 // 而非停在 theme.css 静态重酒红中性。这样默认整站是 M3 生成的暖主题，换色时无缝切色系。
  if (!seed) seed = DEFAULT_ACCENT.seed;
  try { applyAccent(seed, { dark: currentThemeDark() }); } catch { /* 非法值忽略 */ }
}
// 主题切换后调：设过自定义色才以新明暗重算，否则不动（出厂色随 theme.css 自动切）。
// 无用户保存色但启动已应用系统强调色时，回退用系统色重算（明暗切换跟随系统色）。
function reapplyAccent() {
  if (document.documentElement.hasAttribute("data-palette")) { resetAccent(); return; }
  let seed = null;
  try { seed = localStorage.getItem(ACCENT_KEY); } catch { /* 忽略 */ }
  if (!seed) seed = _systemAccentSeed;
 // 无用户色/系统色 → 回落默认砖红种子，仍走动态管线（生成 M3 淡暖灰中性，非 theme.css 静态重酒红）
  if (!seed) seed = DEFAULT_ACCENT.seed;
  try { applyAccent(seed, { dark: currentThemeDark() }); } catch { /* 忽略 */ }
}

// ---------- 系统强调色（本地桥读 Windows 注册表 AccentColor，零外发）----------
// 仅 fetch 本机 bridge（127.0.0.1:8181/api/accent）。成功返 {accent:"#RRGGBB",…}；
// 非 Windows / 读失败 → 501；桥不在 → fetch 抛错。任一失败均静默降级 theme.css 砖红。
// 系统色不写 localStorage（属「跟随系统」而非用户显式选色），单记 _systemAccentSeed
// 供主题明暗切换时 reapplyAccent 复算。用户在环境面板手动「同步系统色」才持久化为选择。
let _systemAccentSeed = null;
// 归一化 #RRGGBB（大写转小写 + 合法校验）；非法返 null
function normAccentHex(v) {
  if (!v) return null;
  let h = String(v).trim().toLowerCase().replace(/^#/, "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length !== 6 || /[^0-9a-f]/.test(h)) return null;
  return "#" + h;
}
// fetch 系统强调色 → 合法 #RRGGBB 或 null（不抛错，供降级）。
async function fetchSystemAccent() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch("http://127.0.0.1:8181/api/accent", { signal: ctrl.signal, cache: "no-store" });
    clearTimeout(timer);
    if (!r.ok) return null;                 // 501（非 Win/读失败）→ 降级
    const j = await r.json();
    return j && j.accent ? normAccentHex(j.accent) : null;
  } catch {
    return null;                            // 桥不在 / 超时 / 解析失败 → 降级
  }
}
// 启动时（仅本地版）：用户未手动选过色 → 用系统色做默认动态取色。尊重已保存的用户选择。
async function initSystemAccent() {
  let saved = null;
  try { saved = localStorage.getItem(ACCENT_KEY); } catch { /* 忽略 */ }
  if (saved) return;                        // 用户已显式选色，不覆盖
  const hex = await fetchSystemAccent();
  if (!hex) return;                         // 降级：静默留 theme.css 砖红
  _systemAccentSeed = hex;
  if (document.documentElement.hasAttribute("data-palette")) return;
  try { applyAccent(hex, { dark: currentThemeDark() }); } catch { return; }
  console.info("[accent] 已应用系统强调色 " + hex);   // 降级链上最多一条 info
}
// 供 envPanel「同步系统色」按钮调用：手动读系统色并应用。用户主动点 → 持久化为选择。
// 返回 { ok, accent } 供 UI toast 反馈。
function exitPaletteKeepLightness() {
  if (document.documentElement.hasAttribute("data-palette")) applyThemePref(currentThemeDark() ? "dark" : "light", true);
}
window.__ebctfSyncAccent = async () => {
  const hex = await fetchSystemAccent();
  if (!hex) return { ok: false };
  exitPaletteKeepLightness();
  try { applyAccent(hex, { dark: currentThemeDark() }); } catch { return { ok: false }; }
  try { localStorage.setItem(ACCENT_KEY, hex); } catch { /* 忽略 */ }
  _systemAccentSeed = null;                 // 已持久化为用户选择，清系统色临时态
  return { ok: true, accent: hex };
};
// 供 envPanel 色板 UI 调用：选色即时应用 + 持久化；resetAccent 由 envPanel 直接 import。
window.__ebctfSetAccent = (seed) => {
  seed = normAccentHex(seed);
  if (!seed) return;
  exitPaletteKeepLightness();
  try { applyAccent(seed, { dark: currentThemeDark() }); } catch { /* 忽略 */ }
  try { localStorage.setItem(ACCENT_KEY, seed); } catch { /* 忽略 */ }
};
window.__ebctfClearAccent = () => {
  try { localStorage.removeItem(ACCENT_KEY); } catch { /* 忽略 */ }
};
window.__ebctfResetAccentToOriginal = () => {
  exitPaletteKeepLightness();
  _systemAccentSeed = null;
  window.__ebctfClearAccent();
  applyAccent(DEFAULT_ACCENT.seed, { dark: currentThemeDark() });
};

// window.__ebctfRuntime 供 envPanel 等读取当前形态（"local" | "server"，探测前 null）。
window.__ebctfRuntime = null;
async function detectRuntimeAndPreload() {
  let isLocal = false;
  try {
    const h = await bridgeHealth();
    isLocal = !!(h && h.ok);
  } catch { isLocal = false; }
  window.__ebctfRuntime = isLocal ? "local" : "server";
  if (isLocal) {
    preloadAllPlanes();   // 仅本地版后台补全量字库；服务器版留子集 + 手动加载
    initSystemAccent();   // 仅本地版且用户未选色时，用系统强调色做默认动态取色（失败静默降级）
  }
  restorePlugins();       // 后台恢复上次启用的插件（动态 import，不进主 bundle、不拖首屏）
 // 智能分析三链空闲预热（同 edu 门控手法：不与首屏抢带宽；失败静默，首次拖入时还会再试）
  const idleChain = typeof requestIdleCallback === "function" ? (cb) => requestIdleCallback(cb, { timeout: 5000 }) : (cb) => setTimeout(cb, 2500);
  idleChain(() => { ensureAnalysisChains().catch(() => {}); });
}

// 插件系统：动态 import 宿主，恢复用户上次启用的插件。宿主/插件全按需加载
// 主项目不静态依赖任何插件，失败静默降级不阻塞启动。内置示例插件随主项目分发免 URL。
async function restorePlugins() {
  try {
    const host = await import("./plugin/pluginHost.js");
    const builtins = {};
 // 内置参考插件（默认不启用，用户在插件面板可一键启用；此处只登记免 URL 供恢复）
    builtins["hello-cipher"] = await import("./plugin/examples/hello-cipher/index.js");
    await host.restoreEnabled(builtins);
    host.onPluginsChange(() => { try { renderNav(); } catch { /* 忽略 */ } });
  } catch (e) {
    console.warn("[plugin] 宿主加载失败，已跳过（不影响主功能）：", e && e.message ? e.message : e);
  }
}
if (document.readyState === "complete") detectRuntimeAndPreload();
else window.addEventListener("load", detectRuntimeAndPreload, { once: true });
