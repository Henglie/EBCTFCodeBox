/*
 * customImplEditor.js — MT72 自定义算法编辑器 UI。
 *
 * 编辑器核心 = CodeMirror 6（CM6）：行号 / 等宽 / Tab 缩进 / 括号自动配对 / 语法高亮
 *   / 撤销重做 / 查找替换 / 自动换行 / 行操作全部由 CM6 原生提供。
 *  UI 外壳保留：错误行标记 / 变量与工具签名面板（点击插入）/ CTF 预设一键套用 / 导入导出 .js
 *   命名方案库（存·载入·删·导入导出 JSON，交互对齐 decodeStrength 的「我的方案」）。
 *
 * 布局：头部按钮行（预设/字号/查找/换行/源码/全屏）→ .ci-body 左右分栏：
 *   左 .ci-left（内嵌二级左右分栏：CM6 编辑区 | 只读权威源码 pre）→ 状态条 / 沙箱条
 *   右 .ci-panel（变量 / 工具签名面板）→ 方案库行 → 底部按钮行。
 * 查找只保留一个：CM6 搜索面板（Ctrl+F / F3 / Ctrl+D，searchKeymap 原生），焦点在编辑区
 * 搜编辑区；源码只读区用其自带搜索框。头部「查找」按钮统一打开 CM6 搜索面板。
 *
 * 分层：本文件只管渲染与事件。执行走 core/customImplClient.js（Worker 沙箱 + 超时硬杀），
 * 持久化走 core/customImplStore.js（纯数据）。UI 层零算法实现。
 */
import { presetsFor, CUSTOM_TEMPLATE, CUSTOM_VAR_SIGNATURES, CUSTOM_HELPER_SIGNATURES } from "../core/customImpl.js";
import {
  getCustomImpl, saveCustomImpl, setEnabled, clearCustomImpl,
} from "../core/customImplStore.js";
import { probeSandbox } from "../core/customImplClient.js";
import { icon as iconSvg } from "./icons.js";

// ---- CM6 bundle（单文件 ESM，已真浏览器验证，见 工具/rt_cm_smoke.mjs） ----
// ⚠ 性能审计 H2：821KB bundle 曾是顶层静态 import，随 main.js 进首屏关键路径——
//   而「编辑代码」入口多数会话根本不打开。改为首次打开编辑器时动态 import + 模块级缓存；
//   SW 已预缓存该文件，离线可用性不变。
let _CM = null;
async function loadCM() {
  if (!_CM) _CM = await import("../vendor/codemirror.bundle.js");
  return _CM;
}

// 持久化 API 从 core 转出，main.js 等调用方可继续从本模块拿（保持既有 import 不破）
export { getCustomImpl, saveCustomImpl, clearCustomImpl };

// ---- 轻量 DOM / i18n 工具（自持，零耦合；照 decodeStrength.js 模式） ----
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
function msym(name, cls = "") {
  const s = el("span", { class: "msym" + (cls ? " " + cls : "") });
  s.innerHTML = iconSvg(name);
  return s;
}

// i18n 缺 key 时的中文兜底（新 key 补翻前 UI 也不露裸键名）
const _ZH = {
  "ui.custom.title": "高级 · 自定义实现",
  "ui.custom.editBtn": "编辑代码",
  "ui.custom.editorTitle": "自定义实现编辑器",
  "ui.custom.preset": "预设",
  "ui.custom.vars": "可用变量",
  "ui.custom.helpers": "工具函数",
  "ui.custom.run": "测试运行",
  "ui.custom.save": "保存",
  "ui.custom.importBtn": "导入 .js",
  "ui.custom.exportBtn": "导出 .js",
  "ui.custom.close": "关闭",
  "ui.custom.saved": "已保存",
  "ui.custom.importWarn": "这是可执行代码，只导入你信任的来源。确定导入？",
  "ui.custom.runOk": "运行成功（{0} 字符）",
  "ui.custom.runErr": "运行出错",
  "ui.custom.timeout": "执行超时（疑似死循环）",
  "ui.custom.noCode": "请输入代码",
  "ui.custom.schemes": "我的方案",
  "ui.custom.schemeName": "方案名",
  "ui.custom.saveScheme": "存为方案",
  "ui.custom.loadScheme": "载入",
  "ui.custom.delScheme": "删除",
  "ui.custom.noScheme": "还没存过方案",
  "ui.custom.importJson": "导入 JSON",
  "ui.custom.exportJson": "导出 JSON",
  "ui.custom.importPrompt": "粘贴方案 JSON（含可执行代码，只导入你信任的来源）：",
  "ui.custom.imported": "已导入 {0} 个方案",
  "ui.custom.importFail": "导入失败：{0}",
  "ui.custom.exported": "已复制方案 JSON 到剪贴板",
  "ui.custom.schemeSaved": "方案「{0}」已保存",
  "ui.custom.confirmDel": "删除方案「{0}」？",
  "ui.custom.sandboxWorker": "沙箱：独立线程（已移除网络与存储能力，超时可强制终止）",
  "ui.custom.sandboxMain": "降级：主线程执行（无线程隔离，死循环无法中断）",
  "ui.custom.reset": "重置为模板",
  "ui.custom.clear": "清除本 op 的自定义实现",
  "ui.custom.errLine": "第 {0} 行",
  "ui.custom.lineCol": "行 {0}，列 {1}",
  // ---- MT86 新增 ----
  "ui.custom.fullscreen": "全屏",
  "ui.custom.exitFull": "退出全屏",
  "ui.custom.zoomIn": "放大字号",
  "ui.custom.zoomOut": "缩小字号",
  "ui.custom.builtin": "当前算法实现",
  "ui.custom.loadBuiltin": "恢复内置实现",
  "ui.custom.builtinNote": "本算法内置实现已默认载入编辑区，可直接在上面改。若它调用了模块内部的辅助函数，运行会报「未定义」——把那些函数一并内联，或改用右侧 H.* 工具。按钮可随时恢复内置原版。",
  "ui.custom.noBuiltin": "本算法无可读源码（原生实现或桥接算法）",
  "ui.custom.builtinLoaded": "已载入内置实现（{0}）",
  "ui.custom.find": "查找",
  "ui.custom.findPh": "查找…",
  // ---- MT86（T359）新增 ----
  "ui.custom.resizeHint": "拖拽调整面板尺寸（窄屏时改高度）",
  // ---- MT88 编辑智能（自动换行，查找替换已交 CM6 原生面板）新增 ----
  "ui.custom.wrap": "自动换行",
  "ui.custom.wrapOn": "自动换行：开",
  "ui.custom.wrapOff": "自动换行：关",
  // ---- 权威实现源码查看（MT89）----
  "ui.custom.sourceView": "权威源码",
  "ui.custom.sourceCopy": "复制全文",
  "ui.custom.sourceDownload": "下载源码",
  "ui.custom.sourceCopied": "已复制源码",
  "ui.custom.sourceNoFile": "无法定位源码文件（原生或插件 op）",
  "ui.custom.sourceFetchErr": "源码加载失败：{0}",
  "ui.custom.retry": "重试",
  "ui.custom.srcToggle": "权威源码",
  "ui.custom.srcClose": "收起源码",
};
function t(key, ...args) {
  let s = key;
  const fn = typeof window !== "undefined" && window.__ebctfT;
  if (typeof fn === "function") {
    try { const v = fn(key); if (v && v !== key) s = v; } catch { /* 回退 */ }
  }
  if (s === key && _ZH[key]) s = _ZH[key];
  return args.length ? s.replace(/\{(\d+)\}/g, (m, i) => (args[i] != null ? args[i] : m)) : s;
}
function toast(msg) {
  try { if (window.__ebctfToast) window.__ebctfToast(msg); } catch { /* 无 UI 环境忽略 */ }
}

// CM6 原生搜索/跳转面板中文化（EditorState.phrases，左右实例共用）。
// 恒烈两轮拍板：全英文不行；全中文长词又把小面板塞爆 → 导航/开关改紧凑符号（VSCode 风格），
// 语义靠输入框 aria「查找」+ 按钮位置；找不到的 key 自动回退英文，多给无副作用。
const CM_PHRASES = {
  "Find": "查找",
  "Replace": "替换",
  "next": "↓",
  "previous": "↑",
  "all": "全部",
  "match case": "Aa",
  "regexp": ".*",
  "by word": "ab",
  "replace": "替换",
  "replace all": "全部替换",
  "close": "×",
  "Go to line": "跳转到行",
  "go": "跳转",
  "Selection deleted": "已删除所选内容",
  "current match": "当前匹配",
};

// ============ 动态样式（index.html 冻结中，不能加 <link>，照 ensureIdsCss 模式注入） ============
let _ciCssInjected = false;
function ensureCiCss() {
  if (_ciCssInjected) return;
  _ciCssInjected = true;
  const style = el("style", { "data-ci": "" });
  style.textContent = CI_CSS;
  (document.head || document.documentElement).append(style);
}

/*
 * CM6 替换 textarea+pre 后：行号 / 高亮 / 查找 / 换行 / 括号配对 / 行操作全由 CM6 接管。
 * 手写层删除清单：.ci-gutter / .ci-code-pre / .ci-textarea / .ci-curline / .ci-brk
 *   / tokenizer 高亮（编辑区）/ 手写查找替换 / 手写行操作 / 手写括号覆盖层。
 * 字号 / 换行 / 深浅主题走 CM6 Compartment 动态配置（EditorView.theme + lineWrapping）。
 * ⚠ 本 CSS 不含 # 十六进制硬编码（除 --ci-hl-* token 色定义行，T359 豁免）。
 */
const CI_CSS = `
/* ============ 开关行编组（恒烈：开关与「编辑代码」是同一件事的两个入口，整组激活态） ============ */
.ci-group{display:inline-flex;align-items:stretch;border:1px solid var(--outline);border-radius:var(--r-full);overflow:hidden;background:var(--surface-1);min-height:44px;transition:border-color var(--dur-short) var(--ease),background var(--dur-short) var(--ease);}
.ci-group.on{border-color:var(--primary);background:color-mix(in srgb,var(--primary) 10%,var(--surface-1));}
.ci-group .ci-seg{display:flex;align-items:center;gap:var(--sp-2);padding:0 var(--sp-3);}
.ci-group .ci-seg+.ci-seg{border-inline-start:1px solid var(--outline-var);}
.ci-toggle-row{display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-2) 0;flex-wrap:wrap;}
.ci-toggle-label{font-size:var(--fs-sm);color:var(--on-surface-var);cursor:pointer;user-select:none;white-space:nowrap;}
/* ⚠ .ci-badge 与 codeImageViewer.css 同名冲突（其规则 position:absolute + padding:1px 6px 会让徽标脱流/变椭圆），此处显式覆盖 */
.ci-toggle-row .ci-badge{display:inline-block;width:10px;height:10px;padding:0;box-sizing:border-box;border-radius:50%;background:var(--surface-4);border:1px solid var(--outline);margin-inline-start:6px;flex:none;position:static;vertical-align:middle;}
.ci-toggle-row .ci-badge.on{background:var(--primary);border-color:var(--primary);}
.ci-edit-btn{display:inline-flex;align-items:center;gap:var(--sp-1);border:0;background:none;color:var(--on-surface);font-size:var(--fs-sm);cursor:pointer;padding:0 var(--sp-1);white-space:nowrap;border-radius:var(--r-full);}
.ci-edit-btn:hover{color:var(--primary);}
.ci-edit-btn .msym svg{width:18px;height:18px;}

/* ============ 遮罩 + 弹窗（对齐 .ds-overlay/.ds-dialog 范本） ============ */
.ci-mask{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:900;display:flex;align-items:center;justify-content:center;padding:var(--sp-4);animation:ci-fade var(--dur-medium) var(--ease-out);}
@keyframes ci-fade{from{opacity:0}to{opacity:1}}
.ci-mask.full{padding:0;}
.ci-dialog{--ci-fs:13.5px;--ci-lh:20px;background:var(--surface-2);border:1px solid var(--outline-var);border-radius:var(--r-xl);max-width:1280px;width:100%;height:min(88vh,860px);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.18),0 1px 4px rgba(0,0,0,.08);animation:ci-pop var(--dur-medium) var(--ease-out);touch-action:manipulation;}
@keyframes ci-pop{from{opacity:0;transform:scale(.96) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}
.ci-mask.full .ci-dialog{max-width:none;width:100%;height:100%;border-radius:0;border:0;animation:none;}

/* ---- 头部（对齐 .ds-head：标题图标染 primary，右侧操作区靠右；全部 .ci-dialog 作用域，防泄漏污染编码图查询器同名类） ---- */
.ci-dialog .ci-head{display:flex;align-items:center;gap:var(--sp-3);padding:var(--sp-2) var(--sp-4);border-bottom:1px solid var(--outline-var);flex-wrap:wrap;flex:none;}
.ci-dialog .ci-head .msym{color:var(--primary);font-size:20px;flex:none;}
.ci-dialog .ci-head h3{margin:0;font-size:var(--fs-md);font-weight:600;flex:1;min-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ci-dialog .ci-head select{max-width:220px;}
.ci-dialog .ci-ops{margin-inline-start:auto;display:flex;align-items:center;gap:var(--sp-2);}
/* 激活态视觉反馈（审计 P3-17）：字号/换行/查找等 toggle 按钮按 .on 染主色，不再只变 title */
.ci-dialog .ci-ops .btn-icon.on,.ci-dialog .ci-editor-toolbar .btn-icon.on,.ci-dialog .ci-spanel-toolbar .btn-icon.on{color:var(--primary);background:color-mix(in srgb,var(--primary) 14%,transparent);}

/* ---- 主体：左右分栏（左编辑+源码 ｜ 右签名面板） ----
 * ⚠ 全部 .ci-dialog 作用域：codeImageViewer.css 同样使用 .ci-body/.ci-main（左树右栏），
 *   本样式后注入时全局规则会把它打成弹性条（编码图查询器变竖排的根因），必须隔离。 */
.ci-dialog .ci-body{display:flex;flex:1;min-height:0;gap:0;align-items:stretch;}
.ci-dialog .ci-left{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;}

/* 二级左右分栏：CM6 编辑区 ｜ 权威源码 pre（恒烈左右对照；头部共用一行，查找面板只有一个） */
.ci-dialog .ci-main{display:flex;flex:1 1 0%;min-height:0;gap:var(--sp-1);align-items:stretch;flex-direction:row;}
.ci-dialog .ci-main-left{flex:1;display:flex;flex-direction:column;min-width:0;min-height:0;gap:var(--sp-1);}
.ci-editor-toolbar{display:flex;align-items:center;gap:var(--sp-1);padding:4px 8px;border:1px solid var(--outline-var);border-radius:var(--r-lg);background:var(--surface-2);flex-wrap:wrap;flex:none;margin:var(--sp-1) var(--sp-1) 0;}
.ci-editor-toolbar .ci-editor-title{flex:1;font-size:12px;color:var(--on-surface-var);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:60px;}
.ci-editor-wrap{position:relative;flex:1;min-height:300px;overflow:hidden;background:var(--surface-2);border:1px solid var(--outline-var);border-radius:var(--r-lg);margin:var(--sp-1);box-shadow:0 1px 3px rgba(0,0,0,.08);}
.ci-editor-wrap .cm-editor{height:100%;}
.ci-editor-wrap .cm-scroller{font-family:var(--mono,monospace);}
.ci-editor-wrap .cm-content{min-height:100%;padding:8px 0;}
.ci-editor-wrap .cm-line{padding:0 10px;direction:ltr;text-align:left;}
.ci-editor-wrap .cm-gutters{background:var(--surface-1);border-inline-end:1px solid var(--outline-var);color:var(--on-surface-var);}
.ci-editor-wrap .cm-gutterElement{padding:0 6px 0 10px;min-width:38px;box-sizing:border-box;}
.ci-editor-wrap .cm-activeLine{background:color-mix(in srgb,var(--on-surface) 5%,transparent);}
.ci-editor-wrap .cm-activeLineGutter{background:color-mix(in srgb,var(--on-surface) 6%,transparent);color:var(--on-surface);}
.ci-editor-wrap .cm-selectionBackground{background:color-mix(in srgb,var(--primary) 40%,transparent)!important;}
.ci-editor-wrap .cm-cursor{border-inline-start:1.5px solid var(--on-surface);}
/* 查找面板（浮于编辑区/源码区内，主题化；M3 圆角 + 中文 + 紧凑简洁）。左右实例共用 :is() */
:is(.ci-editor-wrap,.ci-spanel-pre) .cm-panels{background:var(--surface-2);color:var(--on-surface);border-color:transparent;border-radius:var(--r-md);box-shadow:0 2px 8px rgba(0,0,0,.12);}
:is(.ci-editor-wrap,.ci-spanel-pre) .cm-panels.cm-panels-top{border-bottom:none;margin:var(--sp-2);}
:is(.ci-editor-wrap,.ci-spanel-pre) .cm-panels input,:is(.ci-editor-wrap,.ci-spanel-pre) .cm-panels button{background:var(--surface-3);color:var(--on-surface);border:1px solid var(--outline-var);border-radius:var(--r-sm);font-size:13px;height:34px;box-sizing:border-box;}
:is(.ci-editor-wrap,.ci-spanel-pre) .cm-panels input{padding:0 8px;}
:is(.ci-editor-wrap,.ci-spanel-pre) .cm-panels button{cursor:pointer;padding:0 10px;}
:is(.ci-editor-wrap,.ci-spanel-pre) .cm-panels button:hover{background:var(--surface-hi);}
:is(.ci-editor-wrap,.ci-spanel-pre) .cm-panels .cm-textfield{padding:0;}
/* 搜索面板（恒烈两轮定稿）：箭头/关闭钮 30×30 方形；带文字的按钮（替换/全部替换/全部）自适应变长，不硬塞 */
:is(.ci-editor-wrap,.ci-spanel-pre) .cm-search{padding:5px 6px;gap:4px;flex-wrap:wrap;align-items:center;}
:is(.ci-editor-wrap,.ci-spanel-pre) .cm-search .cm-textfield{width:180px;}
:is(.ci-editor-wrap,.ci-spanel-pre) .cm-search .cm-button{width:30px;height:30px;padding:0;justify-content:center;align-items:center;flex:none;font-size:12px;font-variant-numeric:tabular-nums;line-height:1;box-sizing:border-box;}
/* 文字按钮放宽：宽度自适应 + 横向留白，四个字也放得下 */
:is(.ci-editor-wrap,.ci-spanel-pre) .cm-search .cm-button[name="replace"],
:is(.ci-editor-wrap,.ci-spanel-pre) .cm-search .cm-button[name="replaceAll"],
:is(.ci-editor-wrap,.ci-spanel-pre) .cm-search .cm-button[name="select"],
:is(.ci-editor-wrap,.ci-spanel-pre) .cm-search .cm-button[name="close"]{width:auto;min-width:30px;padding:0 10px;}
/* 开关（Aa / .* / ab）是裸 label（非 cm-button），补上紧凑样式 */
:is(.ci-editor-wrap,.ci-spanel-pre) .cm-search label{display:inline-flex;align-items:center;gap:4px;height:30px;padding:0 6px;font-size:12px;color:var(--on-surface-var);cursor:pointer;user-select:none;}
:is(.ci-editor-wrap,.ci-spanel-pre) .cm-search label input[type="checkbox"]{accent-color:var(--primary);width:14px;height:14px;margin:0;}
/* 只读源码面板：查找不需要替换 → 隐藏替换输入框/替换按钮/全部替换/分隔 br，只留查找一行 */
.ci-spanel-pre .cm-search [name="replace"],
.ci-spanel-pre .cm-search [name="replaceAll"],
.ci-spanel-pre .cm-search > br{display:none;}
.ci-editor-wrap .cm-searchMatch{background:color-mix(in srgb,var(--primary) 35%,transparent);outline:1px solid color-mix(in srgb,var(--primary) 70%,transparent);}
.ci-editor-wrap .cm-searchMatch-selected{background:color-mix(in srgb,var(--primary) 60%,transparent);}
/* 错误行标记（绝对定位覆盖层 + 行号列 exclamation） */
.ci-err-mark{position:absolute;left:0;right:0;background:color-mix(in srgb,var(--error) 20%,transparent);border-inline-start:3px solid var(--error);pointer-events:none;display:none;z-index:2;box-sizing:border-box;}
.ci-editor-wrap .cm-gutterElement.ci-gutter-err{color:var(--error);font-weight:700;}

/* ---- 源码面板（右半，只读）：结构与左栏完全一致——独立工具栏卡片 + 独立内容卡片（M3 统一） ---- */
.ci-dialog .ci-spanel{flex:none;width:44%;max-width:520px;min-width:220px;display:flex;flex-direction:column;gap:var(--sp-1);}
.ci-dialog .ci-spanel.hidden{display:none;}
/* 编辑区 | 源码面板 之间的竖向分隔条（可拖拽调源码面板宽度） */
.ci-dialog .ci-src-resize{flex:none;width:6px;cursor:col-resize;touch-action:none;background:transparent;border-radius:var(--r-full);transition:background var(--dur-short) var(--ease);margin:0 1px;}
.ci-dialog .ci-src-resize:hover,.ci-dialog .ci-src-resize:active{background:color-mix(in srgb,var(--primary) 35%,transparent);}
/* 右侧源码工具栏 = 左侧编辑区工具栏同款浮动卡片（同边距/同圆角/同底色，恒烈要求两边一模一样） */
.ci-dialog .ci-spanel-toolbar{display:flex;align-items:center;gap:var(--sp-1);padding:4px 8px;border:1px solid var(--outline-var);border-radius:var(--r-lg);background:var(--surface-2);flex-wrap:wrap;flex:none;margin:var(--sp-1) var(--sp-1) 0;}
.ci-dialog .ci-spanel-toolbar .ci-src-title{flex:1;font-size:12.5px;font-weight:600;color:var(--on-surface-var);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:60px;}
/* 右侧源码内容卡片 = 左侧编辑区卡片同款 */
.ci-dialog .ci-spanel-pre{flex:1;min-height:0;overflow:hidden;position:relative;margin:var(--sp-1);background:var(--surface-2);border:1px solid var(--outline-var);border-radius:var(--r-lg);box-shadow:0 1px 3px rgba(0,0,0,.08);}
/* 右侧权威源码 CM6 只读实例（与左侧同风格：等宽/行号/高亮，字号独立） */
.ci-spanel-pre .cm-editor{height:100%;}
.ci-spanel-pre .cm-scroller{font-family:var(--mono,monospace);}
.ci-spanel-pre .cm-content{min-height:100%;padding:8px 0;}
.ci-spanel-pre .cm-line{padding:0 10px;direction:ltr;text-align:left;}
.ci-spanel-pre .cm-gutters{background:var(--surface-1);border-inline-end:1px solid var(--outline-var);color:var(--on-surface-var);}
.ci-spanel-pre .cm-gutterElement{padding:0 6px 0 10px;min-width:38px;box-sizing:border-box;}
.ci-spanel-pre .ci-src-curline{position:absolute;left:0;right:0;background:color-mix(in srgb,var(--warning) 25%,transparent);pointer-events:none;z-index:1;}
.ci-spanel-pre .ci-src-hl{background:color-mix(in srgb,var(--primary) 45%,transparent);color:var(--on-surface);border-radius:2px;}
.ci-spanel-pre .ci-hl-kw{color:var(--ci-hl-kw);}
/* 源码加载失败占位（审计 P1-2）：错误说明 + 重试按钮，居中卡片 */
.ci-spanel-pre .ci-src-err{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--sp-2);height:100%;padding:var(--sp-3);text-align:center;}
.ci-spanel-pre .ci-src-err .msym{color:var(--on-surface-var);font-size:28px;}
.ci-spanel-pre .ci-src-err-text{font-size:12px;color:var(--on-surface-var);word-break:break-all;}
.ci-spanel-pre .ci-hl-str{color:var(--ci-hl-str);}
.ci-spanel-pre .ci-hl-com{color:var(--ci-hl-com);font-style:italic;}
.ci-spanel-pre .ci-hl-num{color:var(--ci-hl-num);}
.ci-spanel-pre .ci-hl-fn{color:var(--ci-hl-fn);}

/* ---- 状态条 / 沙箱条 ---- */
.ci-status{display:flex;align-items:center;gap:var(--sp-2);padding:6px 12px;font-size:12px;border-top:1px solid var(--outline-var);color:var(--on-surface-var);min-height:30px;}
.ci-status.err{color:var(--error);}
.ci-status.ok{color:var(--success);}
.ci-sandbox{display:flex;align-items:center;gap:6px;padding:5px 12px;font-size:11.5px;color:var(--on-surface-var);border-top:1px solid var(--outline-var);}
.ci-sandbox.warn{color:var(--warning);}
.ci-sandbox .msym svg{width:14px;height:14px;}

/* ---- 右侧签名面板（宽可拖拽，走 --ci-panel-w；窄屏转下方高度 --ci-panel-h） ---- */
.ci-panel{width:var(--ci-panel-w,236px);flex:none;display:flex;flex-direction:column;background:var(--surface-1);border-inline-start:1px solid var(--outline-var);font-size:12px;min-height:0;}
.ci-resize-v{flex:none;width:7px;cursor:col-resize;touch-action:none;position:relative;background:transparent;transition:background var(--dur-short) var(--ease);}
.ci-resize-v:hover,.ci-resize-v:active{background:color-mix(in srgb,var(--primary) 35%,transparent);}
.ci-panel h4{margin:0;padding:7px 10px;font-size:11.5px;font-weight:600;color:var(--on-surface-var);border-bottom:1px solid var(--outline-var);background:linear-gradient(rgba(0,0,0,.12),rgba(0,0,0,.12)) var(--surface-1);display:flex;align-items:center;gap:5px;position:sticky;top:0;z-index:1;}
.ci-panel h4 .msym svg{width:14px;height:14px;}
.ci-panel .ci-psec{overflow:auto;border-bottom:1px solid var(--outline-var);}
.ci-panel .ci-psec.grow{flex:1;min-height:100px;}
.ci-panel-filter{position:sticky;top:0;z-index:1;padding:4px 8px;border-bottom:1px solid var(--outline-var);background:var(--surface-1);}
.ci-panel-filter input{width:100%;box-sizing:border-box;height:32px;background:var(--surface-2);border:1px solid var(--outline-var);border-radius:var(--r-sm);color:var(--on-surface);padding:0 8px;font-size:11.5px;}
.ci-chip{display:block;width:100%;text-align:start;background:none;border:0;color:var(--on-surface-var);padding:6px 10px;cursor:pointer;font-family:var(--mono,monospace);font-size:11.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;direction:ltr;}
.ci-chip:hover{background:color-mix(in srgb,var(--primary) 18%,transparent);color:var(--on-primary-container);}
.ci-builtin{padding:6px 10px;border-bottom:1px solid var(--outline-var);}
/* 「当前算法实现」灰色标题条圆角（恒烈点名）：沿用 .ci-panel h4 灰底，四角圆角成胶囊标题 */
.ci-builtin h4{border-radius:var(--r-md);}
.ci-builtin .ci-bi-note{font-size:11px;color:var(--on-surface-var);line-height:1.5;margin-bottom:6px;}
.ci-builtin .btn{width:100%;justify-content:center;}

/* ---- 底部按钮区 ---- */
.ci-foot{display:flex;align-items:center;gap:var(--sp-2);padding:var(--sp-2) var(--sp-4);border-top:1px solid var(--outline-var);flex-wrap:wrap;}
.ci-foot .spacer{flex:1;}
.ci-dialog select{background:var(--surface-1);border:1px solid var(--outline-var);border-radius:var(--r-sm);color:var(--on-surface);height:40px;box-sizing:border-box;padding:0 8px;font-size:12.5px;}

/* ---- 危险语义色（app.css 按钮体系无 danger 变体，此处只着色不重写按钮本体） ---- */
.ci-btn-danger{color:var(--error);}
.ci-btn-danger:hover{color:var(--error);filter:brightness(1.2);}

/* ---- 语法高亮 token 色（唯一允许自定义色的地方；深浅主题各一组，随 html[data-theme] 切换） ---- */
.ci-dialog{--ci-hl-kw:#ff8a65;--ci-hl-str:#a5d6a7;--ci-hl-com:#6f5f57;--ci-hl-num:#81d4fa;--ci-hl-fn:#ce93d8;--ci-hl-re:#ffcc80;}
html[data-theme="light"] .ci-dialog{--ci-hl-kw:#b4501a;--ci-hl-str:#256d47;--ci-hl-com:#7d7a77;--ci-hl-num:#0061a4;--ci-hl-fn:#6750a4;--ci-hl-re:#8a5100;}

/* ---- 触屏（恒烈「一定一定要适配触屏」：热区 ≥44×44；编辑区工具栏同为按钮组，一并覆盖） ---- */
@media (hover:none){
  .ci-head .btn-icon{width:44px;height:44px;}
  .ci-editor-toolbar .btn-icon{width:44px;height:44px;}
  .ci-spanel-toolbar .btn-icon{width:44px;height:44px;}
  .ci-chip{padding:10px 12px;}
  .ci-group{min-height:48px;}
  .ci-group .ci-seg{padding:0 var(--sp-4);}
}

/* ---- 窄屏（≤860px）：签名面板下置 + 源码面板叠下（纵向），强制全屏 ----
 * ⚠ 同样全部 .ci-dialog 作用域：编码图查询器 .ci-body/.ci-main 断点是 720px，
 *   本块若不隔离会在 720–860px 区间把它强转竖排（泄漏路径之二）。 */
@media (max-width:860px){
  .ci-mask{padding:0;}
  .ci-dialog{height:100%;max-width:none;border-radius:0;}
  .ci-dialog .ci-body{flex-direction:column;}
  .ci-dialog .ci-resize-v{width:auto;height:7px;cursor:row-resize;align-self:stretch;}
  .ci-dialog .ci-panel{width:auto;height:var(--ci-panel-h,168px);border-inline-start:0;border-top:1px solid var(--outline-var);flex-direction:row;overflow-x:auto;}
  .ci-dialog .ci-panel .ci-psec{max-height:none;min-width:150px;border-bottom:0;border-inline-end:1px solid var(--outline-var);}
  .ci-dialog .ci-panel .ci-psec:last-child{border-inline-end:0;}
  .ci-dialog .ci-panel .ci-builtin{min-width:180px;border-bottom:0;border-inline-end:1px solid var(--outline-var);}
  .ci-dialog .ci-main{flex-direction:column;gap:var(--sp-1);}
  .ci-dialog .ci-main-left{gap:var(--sp-1);}
  .ci-dialog .ci-spanel{width:auto;max-width:none;min-height:120px;height:40%;}
  .ci-dialog .ci-src-resize{width:auto;height:6px;cursor:row-resize;margin:0 var(--sp-3);}
  .ci-dialog .ci-editor-wrap{margin:0 var(--sp-1) var(--sp-1);}
  .ci-dialog .ci-editor-toolbar{margin:var(--sp-1) var(--sp-1) 0;}
}

/* ---- 低高度（≤640px）：编辑器 min-height 归零，内部滚动接管（T366） ---- */
@media (max-height:640px){
  .ci-dialog .ci-editor-wrap{min-height:0;}
  .ci-dialog .ci-left{min-height:0;}
  .ci-dialog .ci-panel .ci-psec.grow{min-height:0;}
}
/* 真正矮窗（≤560px）：弹窗铺满，不再留边距 —— 弹窗缩高度 + 内部滚动 */
@media (max-height:560px){
  .ci-mask{padding:0;}
  .ci-dialog{height:100%;max-width:none;border-radius:0;border:0;}
  .ci-head,.ci-foot{padding-block:var(--sp-1);}
}
/* 窄 + 低：右侧签名面板让出高度（此时面板横向排布，单列不成立） */
@media (max-width:860px) and (max-height:640px){
  .ci-panel{height:min(var(--ci-panel-h,168px),30vh);}
}
`;

// ============ 开关行（挂在 op 参数栏后） ============

const _editors = new Map();

/** 关掉所有已打开的编辑器（切 op / 切页面时调用，防旧 op 的弹窗滞留）。 */
export function closeAllCustomEditors() {
  for (const [, e] of _editors) { try { e.close(); } catch { /* ignore */ } }
  _editors.clear();
}

/**
 * 渲染「高级 · 自定义实现」开关行。
 *
 * 开关与「编辑代码」编在同一个 .ci-group 分段容器里（一个圆角边框，中间竖线分隔），
 * 二者是同一件事的两个入口，散着放会让人以为是两个不相干的控件。
 *
 * @param {HTMLElement} container 挂载容器
 * @param {string} opId 当前 op id
 * @param {{onToggle?:Function, onTest?:Function, op?:object}} ctx
 *        onToggle(enabled) 通知主线程重跑；onTest(code, cb) 代跑一次；op 用于「载入内置实现」
 */
export function renderCustomToggle(container, opId, ctx = {}) {
  ensureCiCss();
  closeAllCustomEditors(); // 切到别的 op 时，旧 op 的编辑器不该继续挂着

  const saved = getCustomImpl(opId);
  const cb = el("input", { type: "checkbox", id: "ci_enable_" + opId });
  cb.checked = !!(saved && saved.enabled);

  const badge = el("span", { class: "ci-badge" });
  const toggleSeg = el("div", { class: "ci-seg" },
    el("label", { class: "switch", for: cb.id }, cb, el("span", { class: "track" }), el("span", { class: "knob" })),
    el("label", { class: "ci-toggle-label", for: cb.id }, t("ui.custom.title")),
    badge,
  );
  const syncBadge = () => {
    const cur = getCustomImpl(opId);
    const has = !!(cur && cur.code && cur.code.trim());
    badge.textContent = "";
    badge.className = "ci-badge" + (has && cur.enabled ? " on" : "");
    badge.title = has ? (cur.enabled ? t("ui.custom.title") : t("ui.custom.save")) : "";
    badge.style.display = has ? "" : "none";
    group.classList.toggle("on", !!(cur && cur.enabled));
  };

  const editBtn = el("button", {
    type: "button", class: "ci-edit-btn", title: t("ui.custom.editorTitle"),
    onclick: () => openCustomImplEditor(opId, { ...ctx, onStateChange: syncBadge, syncToggle: (v) => { cb.checked = !!v; syncBadge(); } }),
  }, msym("code"), t("ui.custom.editBtn"));

  const group = el("div", { class: "ci-group" }, toggleSeg, el("div", { class: "ci-seg" }, editBtn));
  const row = el("div", { class: "ci-toggle-row" }, group);
  cb.addEventListener("change", () => {
    setEnabled(opId, cb.checked);
    syncBadge();
    if (typeof ctx.onToggle === "function") ctx.onToggle(cb.checked);
  });
  syncBadge();
  container.append(row);
}

// ============ 内置实现源码提取 ============

/*
 * 把 op 的内置 encode/decode 源码抽出来当编辑起点（恒烈原话：「打开编辑代码的时候就能看到
 * 当前算法的实现，我可以直接在当前算法改」）。
 *
 * ⚠ 诚实边界：Function.prototype.toString() 只给函数体，**不给**它引用的模块作用域变量与
 *   辅助函数。所以抽出来的源码不保证开箱即跑——引用了内部 helper 的会报 "xxx is not defined"。
 *   这一点写在生成代码的头注释里明说，不假装它一定能跑。
 */
function builtinSource(op, dir) {
  if (!op) return null;
  const pick = dir === "encode"
    ? (op.encode || op.run || op.decode)
    : (op.decode || op.run || op.encode);
  if (typeof pick !== "function") return null;
  let src = "";
  try { src = Function.prototype.toString.call(pick); } catch { return null; }
  // 原生实现（bind / 内建）toString 给的是 "function () { [native code] }"，没有可读正文
  if (!src || /\{\s*\[native code\]\s*\}/.test(src)) return null;
  return src;
}

/** 生成「以内置实现为起点」的可编辑代码文本。 */
function builtinTemplate(op, dir) {
  const src = builtinSource(op, dir);
  if (!src) return null;
  const which = op.encode && op.decode ? dir : (op.run ? "run" : (op.encode ? "encode" : "decode"));
  return [
    "// 内置实现 · " + op.id + " · " + which,
    "// 改这里就是改本算法的行为。参数从 params 取（与上方参数栏同名）。",
    "// ⚠ 下面这段是主项目源码原样抄出。它若调用了模块内部的辅助函数，",
    "//   直接运行会报「xxx is not defined」——把那些函数一并粘进来，或换成右侧 H.* 工具。",
    "const impl = " + src + ";",
    "return impl(input, params, rawBytes);",
    "",
  ].join("\n");
}

// ============ 编辑器弹窗 ============

/** 打开（或聚焦）某 op 的自定义实现编辑器。（async：首次会动态加载 CM6 bundle） */
export async function openCustomImplEditor(opId, ctx = {}) {
  ensureCiCss();
  const CM = await loadCM();
  const {
    EditorView, EditorState, Compartment, keymap, lineNumbers,
    highlightActiveLine, highlightActiveLineGutter, drawSelection,
    defaultKeymap, history, historyKeymap, indentWithTab,
    openSearchPanel, closeSearchPanel, searchKeymap,
    syntaxHighlighting, HighlightStyle, tags, javascript, rectangularSelection,
    closeBrackets, closeBracketsKeymap, bracketMatching,
  } = CM;
  const old = _editors.get(opId);
  if (old && old.mask && document.body.contains(old.mask)) {
    old.mask.style.display = "flex";
    return;
  }

  const op = ctx.op;
  const dir = ctx.dir || "encode";
  const saved = getCustomImpl(opId) || { enabled: false, code: "" };
  const presets = presetsFor(opId);
  // 默认载入当前算法实现（内置源码），用户直接在当前算法上改；拿不到可读源码才回退通用模板。
  const btpl = builtinTemplate(op, dir);
  const initialCode = saved.code || btpl || CUSTOM_TEMPLATE;

  const mask = el("div", { class: "ci-mask", onclick: (e) => { if (e.target === mask) close(); } });
  const dialog = el("div", { class: "ci-dialog" });

  // ---- 头部：标题 + 预设下拉 + 字号 + 查找 + 换行 + 源码 + 全屏（按钮行完全对齐） ----
  const presetSel = el("select", { title: t("ui.custom.preset") });
  presetSel.append(el("option", { value: "" }, t("ui.custom.preset") + "…"));
  for (const p of presets) presetSel.append(el("option", { value: p.id }, p.name));
  presetSel.addEventListener("change", () => {
    const p = presets.find((x) => x.id === presetSel.value);
    if (p) setCode(p.code);
    presetSel.value = "";
  });

  // 字号档位：与行高同档联动（行高仅作状态展示用，CM6 布局按 1.5em 折行）
  const FONT_STEPS = [[11.5, 17], [12.5, 19], [13.5, 20], [15, 23], [16.5, 25], [18.5, 28]];
  let fontIdx = 2;
  // 自动换行：触屏/窄屏默认开，桌面默认关；记住用户选择（localStorage 键 ebctf.customImpl.wrap）。
  let wrapOn;
  try {
    const w = localStorage.getItem("ebctf.customImpl.wrap");
    wrapOn = w === "1" ? true : (w === "0" ? false : window.matchMedia("(max-width:860px)").matches);
  } catch { wrapOn = window.matchMedia("(max-width:860px)").matches; }

  const iconBtn = (name, title, onclick) =>
    el("button", { type: "button", class: "btn btn-icon", title, onclick }, msym(name));

  const fullBtn = iconBtn("open_in_full", t("ui.custom.fullscreen"), () => {
    const on = mask.classList.toggle("full");
    fullBtn.innerHTML = "";
    fullBtn.append(msym(on ? "close_fullscreen" : "open_in_full"));
    fullBtn.title = on ? t("ui.custom.exitFull") : t("ui.custom.fullscreen");
    try { localStorage.setItem("ebctf.customImpl.full", on ? "1" : "0"); } catch { /* 忽略 */ }
    requestAnimationFrame(() => { if (view) view.requestMeasure(); });
  });
  try { if (localStorage.getItem("ebctf.customImpl.full") === "1") mask.classList.add("full"); } catch { /* 忽略 */ }
  if (mask.classList.contains("full")) {
    fullBtn.innerHTML = ""; fullBtn.append(msym("close_fullscreen")); fullBtn.title = t("ui.custom.exitFull");
  }

  const wrapBtn = el("button", {
    type: "button", class: "btn btn-icon", "aria-pressed": "false",
    title: t("ui.custom.wrap"),
    onclick: () => { wrapOn = !wrapOn; applyWrap(true); },
  }, msym("text_fields"));

  // 权威源码左右对照开关（头部常驻：收起后也能重新打开）
  const srcToggleBtn = iconBtn("code", t("ui.custom.srcToggle"), () => toggleSource());
  srcToggleBtn.classList.add("on", "ci-src-head-toggle");
  srcToggleBtn.setAttribute("aria-pressed", "true");
  dialog.append(el("div", { class: "ci-head" },
    msym("data_object"),
    el("h3", {}, t("ui.custom.editorTitle") + " · " + opId),
    el("div", { class: "ci-ops" },
      presetSel,
      srcToggleBtn,
      fullBtn,
    ),
  ));

  // ---- 主体：左右分栏 ----
  const body = el("div", { class: "ci-body" });
  const left = el("div", { class: "ci-left" });

  // 二级左右分栏：左 = CM6 编辑区，右 = 独立 CM6 只读权威源码（左右对照，各自独立工具栏）
  const main = el("div", { class: "ci-main" });
  const mainLeft = el("div", { class: "ci-main-left" });
  // 左侧编辑区自己的工具栏（字号± / 自动换行 / 查找）——两侧各自独立
  const editorToolbar = el("div", { class: "ci-editor-toolbar" },
    iconBtn("text_decrease", t("ui.custom.zoomOut"), () => { if (fontIdx > 0) { fontIdx--; applyFont(); } }),
    iconBtn("text_increase", t("ui.custom.zoomIn"), () => { if (fontIdx < FONT_STEPS.length - 1) { fontIdx++; applyFont(); } }),
    wrapBtn,
    iconBtn("search", t("ui.custom.find") + "（Ctrl+F）", () => { if (view) openSearchPanel(view); }),
  );
  const editorWrap = el("div", { class: "ci-editor-wrap" });
  mainLeft.append(editorToolbar, editorWrap);
  main.append(mainLeft);

  // ---- 权威源码面板（右半，独立 CM6 只读实例）----
  let fileText = "";
  let _sourceLoaded = false;
  // 右侧独立的字号档位与 Compartment（与左侧互不干扰）
  const SRC_FONT_STEPS = [[10, 15], [11.5, 17], [13.5, 20], [15, 23], [17, 26], [19, 29]];
  let srcFontIdx = 1;
  const srcFontComp = new Compartment();
  const srcThemeComp = new Compartment();
  // 源码面板自己的自动换行（默认开：只读对照，长行换行不断行号语义；记住选择）
  const srcWrapComp = new Compartment();
  let srcWrapOn;
  try { srcWrapOn = localStorage.getItem("ebctf.customImpl.srcWrap") !== "0"; } catch { srcWrapOn = true; }
  function srcFontTheme() {
    return EditorView.theme({ "&": { fontSize: SRC_FONT_STEPS[srcFontIdx][0] + "px" } });
  }
  function applySrcFont() {
    if (srcView) srcView.dispatch({ effects: srcFontComp.reconfigure(srcFontTheme()) });
  }
  // persist：仅用户点击时写 localStorage（初始化同步态不写，审计 P3-15）。
  // srcView 未就绪时只同步按钮态（fetch 失败下按钮初始态也不与 localStorage 脱节，审计 P2-5）。
  function applySrcWrap(persist) {
    if (srcView) srcView.dispatch({ effects: srcWrapComp.reconfigure(srcWrapOn ? [EditorView.lineWrapping] : []) });
    srcWrapBtn.classList.toggle("on", srcWrapOn);
    srcWrapBtn.setAttribute("aria-pressed", String(srcWrapOn));
    srcWrapBtn.title = t(srcWrapOn ? "ui.custom.wrapOn" : "ui.custom.wrapOff");
    if (persist) try { localStorage.setItem("ebctf.customImpl.srcWrap", srcWrapOn ? "1" : "0"); } catch { /* 隐私模式 */ }
  }
  const srcWrapBtn = el("button", {
    type: "button", class: "btn btn-icon",
    title: t("ui.custom.wrap"),
    onclick: () => { srcWrapOn = !srcWrapOn; applySrcWrap(true); },
  }, msym("text_fields"));
  const sPanel = el("div", { class: "ci-spanel" });
  const sToolbar = el("div", { class: "ci-spanel-toolbar" },
    el("span", { class: "ci-src-title" }, t("ui.custom.srcToggle") + " · " + opId),
    el("button", { type: "button", class: "btn btn-icon", onclick: () => { if (srcFontIdx > 0) { srcFontIdx--; applySrcFont(); } }, title: t("ui.custom.zoomOut") }, msym("text_decrease")),
    el("button", { type: "button", class: "btn btn-icon", onclick: () => { if (srcFontIdx < SRC_FONT_STEPS.length - 1) { srcFontIdx++; applySrcFont(); } }, title: t("ui.custom.zoomIn") }, msym("text_increase")),
    srcWrapBtn,
    el("button", { type: "button", class: "btn btn-icon", onclick: () => { if (srcView) openSearchPanel(srcView); }, title: t("ui.custom.find") }, msym("search")),
    el("button", { type: "button", class: "btn btn-icon", onclick: copyWhole, title: t("ui.custom.sourceCopy") }, msym("select_all")),
    el("button", { type: "button", class: "btn btn-icon", onclick: () => downloadText(fileText || "", opId + "-src.js", "text/javascript"), title: t("ui.custom.sourceDownload") }, msym("download")),
    el("button", { type: "button", class: "btn btn-icon", onclick: toggleSource, title: t("ui.custom.srcClose") }, msym("close")),
  );
  const sPre = el("div", { class: "ci-spanel-pre" });
  sPanel.append(sToolbar, sPre);
  // 右侧权威源码 = 独立 CM6 只读实例：自己的字号，与左侧完全独立，唯一区别是只读
  let srcView = null;
  applySrcWrap(false); // 换行按钮态立即对齐 localStorage（不依赖源码加载；须在 srcView 声明后调用，防 TDZ）
  function srcEditorExts() {
    return [
      lineNumbers(),
      syntaxHighlighting(jsHighlight),
      javascript(),
      srcFontComp.of(srcFontTheme()),
      srcWrapComp.of(srcWrapOn ? [EditorView.lineWrapping] : []),
      srcThemeComp.of(themeExt()),
      EditorState.phrases.of(CM_PHRASES),
      EditorView.theme({
        "&": { backgroundColor: "var(--surface)", color: "var(--on-surface)" },
        ".cm-content": { caretColor: "transparent" },
      }, { dark: isDark() }),
    ];
  }
  // 编辑区 | 源码面板 之间的分隔条：拖拽调右侧源码面板宽度（恒烈要求两侧宽度可调）
  const srcResize = el("div", { class: "ci-src-resize", title: t("ui.custom.resizeHint") });
  main.append(srcResize);
  main.append(sPanel);
  left.append(main);

  // 源码面板宽度拖拽（编辑区|源码 之间；存 localStorage，窄屏不生效）
  const SRC_MIN = 200, SRC_EDIT_MIN = 200;
  srcResize.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try { srcResize.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const startX = e.clientX;
    const startW = sPanel.getBoundingClientRect().width;
    const maxW = main.clientWidth - SRC_EDIT_MIN - srcResize.offsetWidth;
    // RTL 下 .ci-main flex 镜像：源码面板在左，拖右应变宽（审计 P2-3，照隔壁 .ci-resize-v 的 dirFactor）
    const rtl = (document.documentElement.getAttribute("dir") || "ltr") === "rtl";
    const dirFactor = rtl ? -1 : 1;
    const move = (ev) => {
      // 分隔条在 sPanel 左边界（LTR）：拖右 = 左边界右移 = sPanel 变窄（边界跟手）
      const w = Math.min(Math.max(startW - dirFactor * (ev.clientX - startX), SRC_MIN), Math.max(SRC_MIN, maxW));
      sPanel.style.width = w + "px";
      try { localStorage.setItem("ebctf.customImpl.srcW", String(w)); } catch { /* 隐私模式 */ }
      if (srcView) srcView.requestMeasure();
    };
    const up = () => {
      srcResize.removeEventListener("pointermove", move);
      srcResize.removeEventListener("pointerup", up);
      srcResize.removeEventListener("pointercancel", up);
      try { srcResize.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    srcResize.addEventListener("pointermove", move);
    srcResize.addEventListener("pointerup", up);
    srcResize.addEventListener("pointercancel", up);
  });
  // 还原上次拖拽宽度
  try {
    const sw = Number(localStorage.getItem("ebctf.customImpl.srcW"));
    if (Number.isFinite(sw) && sw >= SRC_MIN) sPanel.style.width = sw + "px";
  } catch { /* 忽略 */ }

  // 状态条 + 沙箱条（编辑区下方，全宽）
  const status = el("div", { class: "ci-status" });
  const sandboxBar = el("div", { class: "ci-sandbox" }, msym("terminal"), el("span", {}, "…"));
  left.append(status, sandboxBar);
  body.append(left);

  // 可拖拽分隔条（宽屏竖向改面板宽，窄屏横向改面板高）
  const resize = el("div", { class: "ci-resize-v", title: t("ui.custom.resizeHint") });
  body.append(resize);

  const panel = el("div", { class: "ci-panel" });

  // 内置实现区：让用户能直接在当前算法上改，而不是对着空模板从零写
  const builtinBox = el("div", { class: "ci-builtin" });
  builtinBox.append(el("h4", {}, msym("code_blocks"), t("ui.custom.builtin")));
  if (btpl) {
    builtinBox.append(el("div", { class: "ci-bi-note" }, t("ui.custom.builtinNote")));
    builtinBox.append(el("button", {
      type: "button", class: "btn", onclick: () => {
        setCode(btpl);
        setStatus(t("ui.custom.builtinLoaded", String(btpl.split("\n").length) + " 行"), "ok");
      },
    }, msym("download"), t("ui.custom.loadBuiltin")));
  } else {
    builtinBox.append(el("div", { class: "ci-bi-note" }, t("ui.custom.noBuiltin")));
  }
  panel.append(builtinBox);

  const secVars = el("div", { class: "ci-psec" });
  const secHelpers = el("div", { class: "ci-psec grow" });
  // 签名面板统一搜索过滤框：输入即过滤变量/工具列表（右侧窄栏不用手翻）
  const sigFilter = el("input", { type: "text", class: "ci-sig-filter", placeholder: t("ui.custom.findPh"), spellcheck: "false", oninput: (e) => applySigFilter(e.target.value) });
  const VAR_CHIPS = CUSTOM_VAR_SIGNATURES.map((v) => el("button", {
    type: "button", class: "ci-chip", title: v.sig + "\n" + v.note,
    onclick: () => insertAtCursor(v.name),
  }, v.name));
  const HELPER_CHIPS = CUSTOM_HELPER_SIGNATURES.map((h) => el("button", {
    type: "button", class: "ci-chip", title: h.sig,
    onclick: () => insertAtCursor("H." + h.name + "("),
  }, h.name));
  function applySigFilter(q) {
    const s = String(q || "").toLowerCase();
    const m = (chips, names) => chips.forEach((c, i) => { c.style.display = !s || names[i].toLowerCase().includes(s) ? "" : "none"; });
    m(VAR_CHIPS, CUSTOM_VAR_SIGNATURES.map((v) => v.name));
    m(HELPER_CHIPS, CUSTOM_HELPER_SIGNATURES.map((h) => h.name));
  }
  secVars.append(el("h4", {}, t("ui.custom.vars")), ...VAR_CHIPS);
  secHelpers.append(el("h4", {}, t("ui.custom.helpers")), ...HELPER_CHIPS);
  panel.append(el("div", { class: "ci-panel-filter" }, sigFilter), secVars, secHelpers);

  // ---- 分隔条拖拽（Pointer Events + setPointerCapture，一套代码管鼠标/触屏/笔；宽屏改面板宽，窄屏改面板高） ----
  const PANEL_MIN = 140, EDIT_MIN = 160;
  const clampPanel = (v, max) => Math.min(Math.max(v, PANEL_MIN), Math.max(PANEL_MIN, max));
  const isNarrow = () => window.matchMedia("(max-width:860px)").matches;
  resize.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try { resize.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const startX = e.clientX, startY = e.clientY;
    const narrow = isNarrow();
    // RTL 下 flex 主轴镜像：面板在左、编辑器在右，拖拽方向取反
    const rtl = (document.documentElement.getAttribute("dir") || "ltr") === "rtl";
    // 分隔条必须跟手：LTR 面板在右、拖右→面板变窄；RTL 面板在左、拖右→面板变宽。取反即跟手。
    const dirFactor = rtl ? 1 : -1;
    const startW = panel.getBoundingClientRect().width;
    const startH = panel.getBoundingClientRect().height;
    const maxW = body.clientWidth - EDIT_MIN - resize.offsetWidth;
    const maxH = Math.max(PANEL_MIN, body.clientHeight - EDIT_MIN - resize.offsetHeight);
    const move = (ev) => {
      if (narrow) {
        const h = clampPanel(startH + (ev.clientY - startY), maxH);
        panel.style.setProperty("--ci-panel-h", h + "px");
        try { localStorage.setItem("ebctf.customImpl.panelH", String(h)); } catch { /* 隐私模式 */ }
      } else {
        const w = clampPanel(startW + dirFactor * (ev.clientX - startX), maxW);
        panel.style.setProperty("--ci-panel-w", w + "px");
        try { localStorage.setItem("ebctf.customImpl.panelW", String(w)); } catch { /* 隐私模式 */ }
      }
    };
    const up = () => {
      resize.removeEventListener("pointermove", move);
      resize.removeEventListener("pointerup", up);
      resize.removeEventListener("pointercancel", up);
      try { resize.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    resize.addEventListener("pointermove", move);
    resize.addEventListener("pointerup", up);
    resize.addEventListener("pointercancel", up);
  });

  // 还原上次拖拽结果（宽度/高度存 localStorage，键前缀 ebctf.customImpl.）
  try {
    const pw = Number(localStorage.getItem("ebctf.customImpl.panelW"));
    if (Number.isFinite(pw) && pw >= PANEL_MIN) panel.style.setProperty("--ci-panel-w", pw + "px");
    const ph = Number(localStorage.getItem("ebctf.customImpl.panelH"));
    if (Number.isFinite(ph) && ph >= PANEL_MIN) panel.style.setProperty("--ci-panel-h", ph + "px");
  } catch { /* 忽略 */ }

  // ---- Ctrl/⌘ + 滚轮调字号（⚠ 必须 passive:false，否则 preventDefault 无效，Chrome 对 wheel 默认 passive） ----
  editorWrap.addEventListener("wheel", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const n = Math.min(FONT_STEPS.length - 1, Math.max(0, fontIdx + (e.deltaY < 0 ? 1 : -1)));
    if (n !== fontIdx) { fontIdx = n; applyFont(); }
  }, { passive: false });

  body.append(panel);
  dialog.append(body);

  // ---- 底部按钮 ----
  const importInp = el("input", { type: "file", accept: ".js,.txt", style: "display:none" });
  const foot = el("div", { class: "ci-foot" },
    el("button", { type: "button", class: "btn btn-filled", onclick: () => doRun() }, t("ui.custom.run")),
    el("button", { type: "button", class: "btn btn-tonal", onclick: () => doSave(false) }, t("ui.custom.save")),
    el("button", { type: "button", class: "btn", onclick: () => importInp.click() }, t("ui.custom.importBtn")),
    el("button", { type: "button", class: "btn", onclick: () => downloadText(getCode(), "custom-" + opId + ".js", "text/javascript") }, t("ui.custom.exportBtn")),
    el("button", { type: "button", class: "btn", onclick: () => setCode(CUSTOM_TEMPLATE) }, t("ui.custom.reset")),
    el("span", { class: "spacer" }),
    el("button", { type: "button", class: "btn", onclick: () => close() }, t("ui.custom.close")),
    importInp,
  );
  dialog.append(foot);
  mask.append(dialog);
  document.body.append(mask);

  // ============ CM6 编辑器核心 ============

  // 语法高亮：HighlightStyle.define 直接产出带主题 token 色的规则（深浅主题随 CSS 变量切换）
  const jsHighlight = HighlightStyle.define([
    { tag: tags.keyword, color: "var(--ci-hl-kw)" },
    { tag: [tags.string, tags.special(tags.string)], color: "var(--ci-hl-str)" },
    { tag: tags.comment, color: "var(--ci-hl-com)", fontStyle: "italic" },
    { tag: tags.number, color: "var(--ci-hl-num)" },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "var(--ci-hl-fn)" },
    { tag: tags.regexp, color: "var(--ci-hl-re)" },
    { tag: [tags.bool, tags.null], color: "var(--ci-hl-kw)" },
    { tag: [tags.operator, tags.punctuation], color: "var(--on-surface-var)" },
    { tag: [tags.variableName, tags.propertyName, tags.definition(tags.variableName)], color: "var(--on-surface)" },
    { tag: tags.typeName, color: "var(--ci-hl-fn)" },
  ]);

  // 动态配置：字号 / 换行 / 深浅主题（Compartment 分别 reconfigure）
  const fontComp = new Compartment();
  const wrapComp = new Compartment();
  const themeComp = new Compartment();
  const isDark = () => (document.documentElement.getAttribute("data-theme") || "dark") === "dark";
  function themeExt() {
    return EditorView.theme({
      "&": { backgroundColor: "var(--surface)", color: "var(--on-surface)" },
      ".cm-content": { caretColor: "var(--on-surface)" },
    }, { dark: isDark() });
  }

  let view = null;
  let _errLn = -1;

  // 错误行覆盖层（CM6 无 Decoration 导出，用绝对定位覆盖层；滚动/更新时重定位）
  const errMark = el("div", { class: "ci-err-mark" });
  editorWrap.append(errMark);
  function placeErrMark() {
    if (!view || _errLn <= 0) { errMark.style.display = "none"; return; }
    try {
      if (_errLn > view.state.doc.lines) { errMark.style.display = "none"; return; }
      const line = view.state.doc.line(_errLn);
      const a = view.coordsAtPos(line.from);
      const b = view.coordsAtPos(Math.max(line.from, line.to - 1));
      if (!a || !b) { errMark.style.display = "none"; return; }
      const wrapRect = editorWrap.getBoundingClientRect();
      const top = Math.min(a.top, b.top);
      const bottom = Math.max(a.bottom, b.bottom);
      errMark.style.top = (top - wrapRect.top) + "px";
      errMark.style.height = (bottom - top) + "px";
      errMark.style.display = "block";
    } catch { errMark.style.display = "none"; }
  }
  function applyErrGutterClass() {
    if (!view) return;
    const gutEls = view.dom.querySelectorAll(".cm-gutterElement");
    for (const g of gutEls) {
      const n = parseInt(g.textContent, 10);
      g.classList.toggle("ci-gutter-err", n === _errLn);
    }
  }
  function markErrLine(ln) {
    _errLn = ln;
    if (ln > 0 && view) {
      try {
        const line = view.state.doc.line(ln);
        view.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: "center" }) });
      } catch { /* 行号越界忽略 */ }
    }
    requestAnimationFrame(() => { placeErrMark(); applyErrGutterClass(); });
  }
  function clearErr() {
    _errLn = -1;
    requestAnimationFrame(() => { placeErrMark(); applyErrGutterClass(); });
  }

  // 状态条 行:列
  function updateLineCol() {
    if (!view) return;
    const head = view.state.selection.main.head;
    const upTo = view.state.doc.sliceString(0, head);
    const nl = upTo.split("\n");
    if (!status.classList.contains("err")) {
      setStatus(t("ui.custom.lineCol", String(nl.length), String(nl[nl.length - 1].length + 1)));
    }
  }
  function setStatus(msg, cls = "") {
    status.textContent = msg;
    status.className = "ci-status" + (cls ? " " + cls : "");
  }

  view = new EditorView({
    parent: editorWrap,
    state: EditorState.create({
      doc: initialCode,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        rectangularSelection(),
        history(),
        syntaxHighlighting(jsHighlight),
        javascript(),
        EditorState.phrases.of(CM_PHRASES),
        // 智能编辑：括号自动配对（输入 ( 补 ），选中文本按引号/括号整体包裹）、括号匹配高亮
        closeBrackets(),
        bracketMatching(),
        keymap.of([
          // 关闭面板优先；面板未开则关编辑器（对齐旧行为）
          { key: "Escape", run: (v) => { if (closeSearchPanel(v)) return true; close(); return true; } },
          { key: "Mod-h", run: (v) => { openSearchPanel(v); return true; } },
          indentWithTab, // Tab 缩进 / Shift+Tab 反缩进
          ...closeBracketsKeymap, // 括号自动配对快捷键
          ...defaultKeymap,   // 行操作：Alt+↑↓ 移行 / Mod+/ 注释 / Shift-Mod-k 删行 / Mod-[ ] 缩进
          ...searchKeymap,    // 查找：Mod-f / F3 / Mod-g / Mod-d 选词
          ...historyKeymap,   // 撤销重做：Mod-z / Mod-y
        ]),
        fontComp.of(EditorView.theme({ "&": { fontSize: FONT_STEPS[fontIdx][0] + "px" } })),
        wrapComp.of([]),
        themeComp.of(themeExt()),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            if (_errLn > 0) { _errLn = -1; requestAnimationFrame(() => { placeErrMark(); applyErrGutterClass(); }); }
          }
          if (u.docChanged || u.selectionSet) updateLineCol();
        }),
      ],
    }),
  });

  // 编辑器尺寸变化（全屏 / 拖拽 / 窄屏翻转）时重测量
  const ro = new ResizeObserver(() => { try { view.requestMeasure(); } catch { /* ignore */ } });
  ro.observe(editorWrap);
  // 深浅主题切换跟随 html[data-theme]（左右两个独立 CM6 实例各自 reconfigure）
  const themeMo = new MutationObserver(() => {
    try { view.dispatch({ effects: themeComp.reconfigure(themeExt()) }); } catch { /* ignore */ }
    if (srcView) { try { srcView.dispatch({ effects: srcThemeComp.reconfigure(themeExt()) }); } catch { /* ignore */ } }
  });
  themeMo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  // 错误行覆盖层随滚动重定位
  view.scrollDOM.addEventListener("scroll", () => {
    if (_errLn > 0) requestAnimationFrame(placeErrMark);
  });

  // ---- 读写代码（CM6 dispatch 整篇替换，保 undo） ----
  // ⚠ 行尾规范化：CM6 会把 \r\n / \r 规范化成 \n（doc 与 insert 均如此）。
  //   内置实现来自 Function.prototype.toString()，CRLF 源文件的 btpl 带 \r——
  //   若 anchor 按原始串长度算（偏大），规范化后文档更短 → dispatch 抛
  //   "Selection points outside of document" → 「重置为模板后再恢复内置实现」失效（rot13 实锤）。
  //   故所有落进编辑器的文本先统一规范化，anchor 与文档长度才严格一致。
  function normCode(c) {
    return String(c).replace(/\r\n?/g, "\n");
  }
  function getCode() {
    return view ? view.state.doc.toString() : "";
  }
  function setCode(c) {
    if (!view) return;
    const text = normCode(c);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: text.length },
      userEvent: "setCode", // 独立撤销组：套预设/载入方案后 Ctrl+Z 精确回退该步
    });
    view.focus();
    clearErr();
    setStatus("");
    updateLineCol();
  }
  function insertAtCursor(snippet) {
    if (!view) return;
    const sel = view.state.selection.main;
    const text = normCode(snippet);
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: text },
      selection: { anchor: sel.from + text.length },
      userEvent: "insert", // 独立撤销组
      scrollIntoView: true,
    });
    view.focus();
    updateLineCol();
  }

  // ---- 字号（CM6 theme 动态切，Ctrl+滚轮 / 按钮同路） ----
  function applyFont() {
    if (!view) return;
    const [fs, lh] = FONT_STEPS[fontIdx];
    view.dispatch({ effects: fontComp.reconfigure(EditorView.theme({ "&": { fontSize: fs + "px" } })) });
    dialog.style.setProperty("--ci-fs", fs + "px");
    dialog.style.setProperty("--ci-lh", lh + "px");
    try { localStorage.setItem("ebctf.customImpl.fontIdx", String(fontIdx)); } catch { /* 隐私模式忽略 */ }
  }
  try {
    const v = Number(localStorage.getItem("ebctf.customImpl.fontIdx"));
    if (Number.isInteger(v) && v >= 0 && v < FONT_STEPS.length) fontIdx = v;
  } catch { /* 忽略 */ }

  // ---- 自动换行（CM6 lineWrapping，Compartment 动态切；persist 仅用户点击时写，审计 P3-15） ----
  function applyWrap(persist) {
    if (!view) return;
    view.dispatch({ effects: wrapComp.reconfigure(wrapOn ? [EditorView.lineWrapping] : []) });
    wrapBtn.classList.toggle("on", wrapOn);
    wrapBtn.setAttribute("aria-pressed", String(wrapOn));
    wrapBtn.title = t(wrapOn ? "ui.custom.wrapOn" : "ui.custom.wrapOff");
    if (persist) try { localStorage.setItem("ebctf.customImpl.wrap", wrapOn ? "1" : "0"); } catch { /* 隐私模式 */ }
    requestAnimationFrame(() => view.requestMeasure());
  }

  function close() {
    try { ro.disconnect(); } catch { /* ignore */ }
    try { themeMo.disconnect(); } catch { /* ignore */ }
    if (view) { try { view.destroy(); } catch { /* ignore */ } }
    // 右侧只读源码实例同样必须销毁（CM6 view 持有 DOM 监听；不销毁则反复开关编辑器累积泄漏）
    if (srcView) { try { srcView.destroy(); } catch { /* ignore */ } srcView = null; fileText = ""; _sourceLoaded = false; }
    mask.remove();
    _editors.delete(opId);
  }

  // ---- 测试运行 ----
  function doSave(silent) {
    const code = getCode();
    if (!code.trim()) { setStatus(t("ui.custom.noCode"), "err"); return false; }
    const cur = getCustomImpl(opId) || { enabled: false };
    saveCustomImpl(opId, { enabled: cur.enabled, code });
    if (!silent) setStatus(t("ui.custom.saved"), "ok");
    if (typeof ctx.onStateChange === "function") ctx.onStateChange();
    if (cur.enabled && typeof ctx.onToggle === "function") ctx.onToggle(true);
    return true;
  }
  function doRun() {
    if (!doSave(true)) return;
    setStatus(t("ui.custom.run") + "…");
    clearErr();
    if (typeof ctx.onTest !== "function") { setStatus(t("ui.custom.runErr"), "err"); return; }
    ctx.onTest(getCode(), (res) => {
      if (res && res.ok) {
        setStatus(t("ui.custom.runOk", String((res.out || "").length)) + "  " + firstLine(res.out), "ok");
        return;
      }
      const head = res && res.timedOut ? t("ui.custom.timeout") : t("ui.custom.runErr");
      const line = res && res.line ? "  " + t("ui.custom.errLine", String(res.line)) : "";
      setStatus(head + line + "：" + ((res && res.error) || ""), "err");
      if (res && res.line) markErrLine(res.line);
    });
  }
  function firstLine(s) {
    const one = String(s || "").split("\n")[0];
    return one.length > 60 ? one.slice(0, 60) + "…" : one;
  }

  importInp.addEventListener("change", () => {
    const f = importInp.files && importInp.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { if (confirm(t("ui.custom.importWarn"))) setCode(String(rd.result || "")); };
    rd.readAsText(f, "utf-8");
    importInp.value = "";
  });

  // ---- 权威源码面板：展开/收起（右半） ----
  function toggleSource() {
    const hidden = sPanel.classList.contains("hidden");
    sPanel.classList.toggle("hidden", !hidden);
    srcToggleBtn.classList.toggle("on", hidden);
    srcToggleBtn.setAttribute("aria-pressed", String(hidden));
    srcToggleBtn.title = hidden ? t("ui.custom.srcToggle") : t("ui.custom.srcClose");
    if (!hidden && !_sourceLoaded) { _sourceLoaded = true; loadSource(); }
    requestAnimationFrame(() => { if (view) view.requestMeasure(); });
  }

  // ---- 初始化 ----
  applyFont();
  applyWrap(false); // 同步初始态（含按钮 on 视觉），不写 localStorage
  updateLineCol();
  view.focus();
  // 默认展开权威源码（左右对照）；无 sourceFile 也走防御提示
  if (!_sourceLoaded) { _sourceLoaded = true; loadSource(); }

  // 沙箱形态如实展示（降级到主线程时必须让用户知道）
  probeSandbox().then((info) => {
    const worker = info && info.mode === "worker";
    sandboxBar.className = "ci-sandbox" + (worker ? "" : " warn");
    sandboxBar.innerHTML = "";
    sandboxBar.append(msym(worker ? "terminal" : "warning"), el("span", {}, t(worker ? "ui.custom.sandboxWorker" : "ui.custom.sandboxMain")));
    if (worker && info.kept && info.kept.length) {
      sandboxBar.append(el("span", { title: info.kept.join(", ") }, "（" + info.kept.length + "）"));
    }
  }).catch(() => { /* 探测失败不影响使用 */ });

  // ============ 权威源码面板（MT89 改造：编辑区右半，左右对照） ============
  /*
   * 展示当前 op 的「权威实现源码」（registry 注入的 op.sourceFile 指向其源模块文件）。
   * 纯只读：可搜索 / 复制全文 / 下载。
   * ⚠ 防御：op.sourceFile 尚不存在（原生或插件 op、registry 尚未注入该字段）→ 不崩、不 console.error。
   * 懒加载：首次展开时才 fetch（_sourceLoaded 防重复拉取）。
   * ⚠ 加载失败不再静默空白（审计 P1-2）：面板内显示错误 + 「重试」按钮，
   *   并回滚 _sourceLoaded，收起再展开（或点重试）会重新拉取。
   */
  function loadSource() {
    const url = op && op.sourceFile;
    if (!url) return;
    fetch(url).then((r) => {
      if (!r.ok) throw new Error(r.status + " " + r.statusText);
      return r.text();
    }).then((text) => {
      if (!sPre.isConnected) return; // 编辑器已关闭（fetch 在途时 close）——别在孤儿节点上建实例（性能审计 M2）
      fileText = text;
      // 首次加载：创建 CM6 只读 view（复用左侧高亮/主题/字号配置）
      if (!srcView) {
        sPre.innerHTML = ""; // 清掉可能的失败提示占位
        srcView = new EditorView({
          parent: sPre,
          state: EditorState.create({
            doc: text,
            extensions: [
              ...srcEditorExts(),
              EditorState.readOnly.of(true),
              EditorView.editable.of(false),
              // 只读：只绑 Escape（关搜索面板），不绑任何编辑快捷键（审计 P3-18）
              keymap.of([{ key: "Escape", run: (v) => !!closeSearchPanel(v) }]),
            ],
          }),
        });
        applySrcWrap(false); // 同步换行初始态到实例（localStorage 可能存的是关）
      } else {
        srcView.dispatch({ changes: { from: 0, to: srcView.state.doc.length, insert: text } });
      }
    }).catch((err) => {
      _sourceLoaded = false; // 回滚：重新展开 / 点重试会再拉
      sPre.innerHTML = "";
      sPre.append(el("div", { class: "ci-src-err" },
        msym("cloud_off"),
        el("div", { class: "ci-src-err-text" }, t("ui.custom.sourceFetchErr", (err && err.message) || String(err))),
        el("button", {
          type: "button", class: "btn",
          onclick: () => { sPre.innerHTML = ""; _sourceLoaded = true; loadSource(); },
        }, msym("refresh"), t("ui.custom.retry")),
      ));
    });
  }
  function copyWhole() {
    if (!fileText) { toast(t("ui.custom.sourceNoFile")); return; }
    navigator.clipboard.writeText(fileText).then(() => toast(t("ui.custom.sourceCopied"))).catch(() => downloadText(fileText, opId + "-src.js", "text/javascript"));
  }

  _editors.set(opId, { mask, close });
}

function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
