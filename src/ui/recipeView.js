// recipeView.js — 配方链 UI（CyberChef 式多 op 串联）
// 复用 core 算法层：executeRecipeSteps（异步 op + 步级钩子/断点/取消）+ validateRecipe + PRESETS。
// 线性链模型：nodes 顺序即执行序，第 i 个输出喂第 i+1 个输入。
// 独立模块，自带轻量 el/msym，不反向依赖 main.js（低耦合）。
import { OPS, getOp, opsByCat, defaultParams, CATEGORIES } from "../core/registry.js";
import { validateRecipe, PRESETS, recipeTerminalText, recipeFileEntries } from "../core/recipes.js";
import {
  executeRecipeSteps, CONTROL_LABELS, inputSizeOf, mapMagicCandidateToRecipe,
} from "../core/recipe.js";
import { createHistory } from "../core/historyStack.js";
import { ensureOp } from "../core/lazyCore.js";
import { isExplicitRunOp, isLazyRunOp } from "../core/explicitRun.js";
import { downloadBytes, cloudWarnGate, fmtByteSize } from "./download.js";
import { icon as iconSvg } from "./icons.js";
import { attachEditorToolbar } from "./editorToolbar.js";
import { ioArea } from "./ioArea.js"; // 天珩连字：输入/输出改 contenteditable div（textarea 吞 OpenType 特性）
import { expandableInput, openExpandModal } from "./expandableInput.js";
import { decodeUtf8Lossless } from "../core/bytesIo.js";
import {
  listSavedRecipes, saveNamedRecipe, saveDraft, loadDraft, serializeRecipe,
  encodeShare, decodeShare, buildShareUrl, shareCodeFromHash,
} from "./recipeStore.js";

// BOM 保真的严格 UTF-8 解码（bytesIo 单一源）：非法序列抛 TypeError（同旧 fatal TextDecoder 语义），
// 唯一行为差异是合法 BOM（U+FEFF 开头）不再被静默吞掉。
function _decodeUtf8Fatal(bytes) {
  const r = decodeUtf8Lossless(bytes);
  if (!r.ok) throw new TypeError(r.reason);
  return r.text;
}

// ---- 轻量 DOM 工具（与 main.js 同形，但本模块自持，零耦合）----
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
  s.innerHTML = iconSvg(name);   // 注入内联 SVG（.msym 无字体 ligature，须 icon() 注水）
  return s;
}

// i18n 取值：优先 main.js 暴露的 __ebctfT，取不到回退内置中文（避免界面空白）
function tt(key, ...args) {
  try { if (typeof window !== "undefined" && window.__ebctfT) { const s = window.__ebctfT(key, ...args); if (s && s !== key) return s; } } catch { /* 回退 */ }
  return RECIPE_FALLBACK[key] || key;
}
// 本轮新增文案先走中文内联兜底；tf 负责把 {0}{1} 在未接 i18n 时也能插值。
function tf(key, ...args) {
  return tt(key).replace(/\{(\d+)\}/g, (m, i) => (args[Number(i)] == null ? m : String(args[Number(i)])));
}
// i18n 未接线时的中文兜底
const RECIPE_FALLBACK = {
  "ui.recipe.dir.encode": "编码",
  "ui.recipe.dir.decode": "解码",
  "ui.recipe.dir.run": "运行",
  "ui.recipe.addOp": "＋ 搜索添加操作…",
  "ui.recipe.addEmpty": "无匹配操作",
  "ui.recipe.chooseFamilyOp": "选择要加入配方链的操作",
  "ui.recipe.unknownOp": "未知 op: ",
  "ui.recipe.moveUp": "上移",
  "ui.recipe.moveDown": "下移",
  "ui.recipe.remove": "删除",
  "ui.recipe.validateFail": "配方校验失败：",
  "ui.recipe.execFail": "执行失败",
  "ui.recipe.title": "配方链 · Recipe",
  "ui.recipe.desc": "多个操作串联，上一步输出喂下一步输入。改任意参数即时重跑。",
  "ui.recipe.loadPreset": "载入预设配方…",
  "ui.recipe.groupBuild": "构建",
  "ui.recipe.groupRun": "执行",
  "ui.recipe.groupEdit": "编辑",
  "ui.recipe.groupStore": "管理",
  "ui.recipe.showSteps": "显示每步结果",
  "ui.recipe.clear": "清空",
  "ui.recipe.inputLabel": "输入",
  "ui.recipe.inputPh": "链的初始输入…",
  "ui.recipe.empty": "链为空。从上方「添加操作」或「控制节点」开始，或载入预设配方。",
  "ui.recipe.outputLabel": "输出",
  "ui.recipe.outputPh": "链的最终输出…",
  "ui.recipe.dragHint": "桌面可从左侧菜单/顶部搜索结果拖入；触摸设备长按后拖入；也可上方搜索添加",
  "ui.recipe.dragSearchHint": "拖到配方链添加（触摸设备长按后拖动）",
  "ui.recipe.bake": "执行！（Bake！）",
  "ui.recipe.bakeHint": "输入较大，已暂停自动转换。改完点「执行！（Bake！）」跑全链。",
  "ui.recipe.exportRecipe": "导出配方",
  "ui.recipe.importRecipe": "导入配方",
  "ui.recipe.importOk": "已导入配方（{0} 个节点）",
  "ui.recipe.importBadJson": "导入失败：不是合法 JSON",
  "ui.recipe.importBadFormat": "导入失败：非本工具配方格式",
  "ui.recipe.importEmpty": "导入失败：无可用节点",
  "ui.recipe.pickFile": "载入文件到链头",
  "ui.op.pickFile": "选择文件",
  "ui.io.showSecret": "显示敏感内容",
  "ui.io.hideSecret": "隐藏敏感内容",
  "ui.op.fileLoaded": "📎 已载入 {0}（{1}）· 该操作读取原始文件字节，无需手动转码",
  "ui.op.droppedText": "已载入文本文件 {0}",
  "ui.op.droppedHex": "二进制文件 {0} 已转 hex 载入",
  // T750：执行智能 / 节点控制 / 快捷键
  "ui.recipe.autoRun": "自动执行",
  "ui.recipe.autoRunOff": "自动执行已关闭：改动后点 Bake 或 Ctrl+Enter 运行",
  "ui.recipe.staleLarge": "输入较大，已暂停自动执行。改完点「执行！（Bake！）」或 Ctrl+Enter。",
  "ui.recipe.staleHeavy": "链中含重运算节点，已暂停自动执行。点「执行！（Bake！）」或 Ctrl+Enter 手动运行。",
  "ui.recipe.staleRunning": "正在执行；本次改动已排队，当前步骤结束后再运行。",
  "ui.recipe.cancel": "取消",
  "ui.recipe.cancelRequested": "已请求取消：同步运算无法中途打断，将在当前步骤结束后停止。",
  "ui.recipe.cancelled": "已取消（已完成步骤的结果保留）",
  "ui.recipe.timeout": "执行超时",
  "ui.recipe.running": "执行中…",
  "ui.recipe.done": "完成 · {0} ms",
  "ui.recipe.pausedAt": "已在第 {0} 步前暂停（断点）",
  "ui.recipe.resume": "继续",
  "ui.recipe.errorAt": "第 {0} 步「{1}」失败：{2}",
  "ui.recipe.errorNode": "出错的步骤已标红；上方步骤结果保留。",
  "ui.recipe.stepResult": "第 {0} 步 · {1}",
  "ui.recipe.stepSkipped": "（已禁用，跳过）",
  "ui.recipe.disabled": "禁用节点",
  "ui.recipe.enabled": "启用节点",
  "ui.recipe.breakpoint": "断点（执行到此前暂停）",
  "ui.recipe.breakpointOn": "取消断点",
  "ui.recipe.duplicate": "复制节点",
  "ui.recipe.runToHere": "运行到此步",
  "ui.recipe.runFromHere": "从此步运行",
  "ui.recipe.step": "单步",
  "ui.recipe.stepDone": "单步完成；再点一次继续",
  "ui.recipe.stepEnd": "已到链尾，单步会话结束",
  "ui.recipe.undo": "撤销配方结构",
  "ui.recipe.redo": "重做配方结构",
  "ui.recipe.help": "快捷键帮助（F1）",
  "ui.recipe.helpShort": "F1 快捷键",
  "ui.recipe.helpTitle": "配方链快捷键",
  "ui.recipe.close": "关闭",
  "ui.recipe.helpBody": "Ctrl+Enter / Ctrl+Alt+Space：执行\nCtrl+Z / Ctrl+Shift+Z / Ctrl+Y：撤销/重做配方结构（焦点在输入框时仍撤销文本）\nDelete：删除当前节点\nAlt+↑ / Alt+↓：上移/下移当前节点\nCtrl+Alt+B / F9：断点\nCtrl+Alt+D：禁用/启用\nF1：本帮助；Esc：关闭\n\n控制节点：工具条「控制节点」插入。Register 捕获 $R0..$Rn；Conditional Jump / Jump 的落点是 Label；Fork 与 Merge 之间是分支体；Subsection 只分组折叠，不改变执行顺序。跳转/总步数超预算会显式报错。",
  "ui.recipe.exportFileOmitted": "导出成功；文件字节未包含在 JSON 中，导入后需重新载入文件。",
  "ui.recipe.shareFileOmitted": "分享链接已复制（{0} 字符）；文件字节未包含，接收方需重新载入文件。",
  "ui.recipe.exportNoInput": "导出成功；未包含输入内容（仅配方）。",
  "ui.recipe.shareRecipeOnly": "链接已复制（{0} 字符）；仅含配方，不含输入。",
  "ui.recipe.includeInput": "包含输入",
  "ui.recipe.includeInputHint": "分享/导出时是否附带当前输入内容；默认只带配方（输入可能含 flag/密钥）。",
  "ui.recipe.staleLargeFile": "文件较大（{0}），已暂停自动执行。点「执行！（Bake！）」或 Ctrl+Enter 手动运行。",
  "ui.recipe.magicNeedText": "Magic 需要文本输入：当前文件链没有可解码的 UTF-8 文本。请先运行到文本输出，或改用文本链头。",
  "ui.recipe.magicCandidates": "Magic 候选（{0}）",
  "ui.recipe.magicBest": "最优候选（推荐）",
  "ui.recipe.magicInvalid": "不可执行",
  "ui.recipe.magicNoCandidates": "Magic 未找到可执行候选",
  "ui.recipe.magicApplied": "已应用 Magic 候选（{0} 步）；可用 Ctrl+Z 撤销替换。",
  "ui.recipe.magicFileApplied": "已应用 Magic 候选并切换为文本链头；文件字节已清除。",
  "ui.recipe.fileMissing": "该配方链头使用文件通道，但文件字节未被保存（草稿/导入/分享不含字节）。请重新拖入或选择文件后再执行。",
  "ui.recipe.fileHeadChanged": "当前链头不接受文件字节；已保留文件但不会静默把占位提示当输入执行。请换回文件类链头或清空文件。",
  "ui.recipe.clearFile": "清除链头文件",
  "ui.recipe.fileMeta": "链头文件：{0}（{1}）",
  // CC-A5：控制节点
  "ui.recipe.controlMenu": "控制节点",
  "ui.recipe.controlMenuTitle": "插入控制节点（不注册主 op，不改变 op 计数）",
  "ui.recipe.controlUnknown": "未知控制节点：",
  "ui.recipe.controlBudget": "执行预算超限",
  "ui.recipe.controlReturned": "已执行 Return：配方在此提前结束",
  "ui.recipe.controlForkPair": "已配对第 {0} 步 Merge",
  "ui.recipe.controlForkNoPair": "⚠ 缺少匹配的 Merge（同一层）",
  "ui.recipe.controlFold": "已折叠 {0} 个节点（点击展开）",
  "ui.recipe.controlCollapse": "折叠分组",
  "ui.recipe.controlExpand": "展开分组",
};

// ---- 状态：配方链节点 [{uid, opId, dir, params, disabled?, breakpoint?}] ----
const rState = {
  nodes: [],        // 链上节点，顺序即执行序
  input: "",        // 链输入
  showSteps: false, // 显示每步中间结果
  file: null,       // 链头文件字节 {bytes, name}；手动编辑输入即失效（见 core/recipe.js 的 resolveRecipeHead）
  inputKind: "text",      // text | file —— 文件字节不落 localStorage/hash，恢复时用于提示
  fileMeta: null,         // {name,size,mime} 仅元数据
  fileMissing: false,     // 配方声明了文件链头但当前没有字节（草稿/导入/分享恢复）
  autoRunMode: "auto",    // auto | manual
  runState: "idle",       // idle | running | paused
  stale: false,           // 输出可能过期
};

// 输入超此阈值改手动转换（点「执行！/Bake！」），避免每次 keystroke 全链即时重跑卡死大文件。
const AUTO_RUN_THRESHOLD = 1000;
const AUTO_RUN_DEBOUNCE_MS = 180;
const RUN_BUDGET_MS = 60000;     // 总预算：步间检查；同步 op 无法中途打断
const STEP_TIMEOUT_MS = 30000;   // 单步等待上限：仅能拦住让出事件循环的异步 op

// 是否有「待执行」的挂起转换（大输入/手动模式/重 op/运行中）
let _pending = false;
let _pendingReason = "";
let _draftTimer = null;
let _runTimer = null;
// 分享/导出是否附带输入。默认 false：CTF 输入里可能直接是 flag/密钥。
let _includeInput = false;

// 运行态
let _running = false;
let _loadingOps = false;
let _cancelRequested = false;
let _lastRun = null;          // 最近一次执行结果（断点继续 / 单步 seed）
let _stepSession = null;      // 单步会话 {cursor, outputs:Map, steps:[]}
let _focusedNodeIndex = -1;
let _focusedNodeUid = "";

// 节点身份：历史/断点/错误定位都用稳定 uid，不用数组下标（下标会随增删移位）。
let _uidSeq = 0;
function cloneParamValue(value, seen) {
  if (value === null || typeof value !== "object") return value;
  seen = seen || new Map();
  if (seen.has(value)) return seen.get(value);
  if (ArrayBuffer.isView(value)) return new value.constructor(value);
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (Array.isArray(value)) {
    const out = [];
    seen.set(value, out);
    for (const v of value) out.push(cloneParamValue(v, seen));
    return out;
  }
  const out = {};
  seen.set(value, out);
  for (const k of Object.keys(value)) out[k] = cloneParamValue(value[k], seen);
  return out;
}
function ensureNodeUids() {
  const seen = new Set();
  for (const n of rState.nodes) {
    if (n.uid && !seen.has(n.uid)) { seen.add(n.uid); continue; }
    let uid;
    do { uid = "r" + (++_uidSeq); } while (seen.has(uid));
    n.uid = uid;
    seen.add(uid);
  }
}
function snapshotStructure() {
  ensureNodeUids();
  return {
    nodes: rState.nodes.map((n) => {
      if (isControlNode(n)) {
        return {
          uid: n.uid,
          kind: "control",
          control: n.control,
          params: cloneParamValue(n.params || {}),
          disabled: !!n.disabled,
          breakpoint: !!n.breakpoint,
        };
      }
      return {
        uid: n.uid,
        opId: n.opId,
        dir: n.dir,
        params: cloneParamValue(n.params || {}),
        disabled: !!n.disabled,
        breakpoint: !!n.breakpoint,
      };
    }),
  };
}
// 配方结构历史：只记 nodes（输入文本有自己的 editHistory，绝不抢它的 Ctrl+Z）。
const structureHistory = createHistory({ capacity: 100, coalesceMs: 350 });
let _historyApplying = false;
function recordStructure(label) {
  if (_historyApplying) return;
  _lastRun = null;   // 结构/参数变化后旧的断点续跑种子不再可信
  structureHistory.push(snapshotStructure(), label || "");
  updateHistoryButtons();
}
function resetStructureHistory(label) {
  _historyApplying = true;
  try {
    structureHistory.clear();
    structureHistory.push(snapshotStructure(), label || "init");
  } finally {
    _historyApplying = false;
  }
  updateHistoryButtons();
}
// 预设/导入/保存载入/Magic 会整体替换 nodes：替换前把当前结构压入历史，
// 这样 Ctrl+Z 能回到替换前，而不是被 resetStructureHistory 抹掉。
function pushReplaceSnapshot(label) {
  if (!rState.nodes.length) return;
  recordStructure(label || "replace");
}
function resetStepSession() {
  _stepSession = null;
}
function applyStructureSnapshot(state) {
  if (!state || !Array.isArray(state.nodes)) return;
  _historyApplying = true;
  try {
    rState.nodes = state.nodes.map((n) => {
      if (isControlNode(n)) {
        return {
          uid: n.uid,
          kind: "control",
          control: n.control,
          params: cloneParamValue(n.params || {}),
          disabled: !!n.disabled,
          breakpoint: !!n.breakpoint,
        };
      }
      return {
        uid: n.uid,
        opId: n.opId,
        dir: n.dir,
        params: cloneParamValue(n.params || {}),
        disabled: !!n.disabled,
        breakpoint: !!n.breakpoint,
      };
    });
    ensureNodeUids();
  } finally {
    _historyApplying = false;
  }
  _lastRun = null;
  rState.runState = "idle";
  resetStepSession();
  renderRecipe();
  maybeRunChain();
}
function undoStructure() {
  const r = structureHistory.undo();
  if (!r.ok) { updateHistoryButtons(); return false; }
  applyStructureSnapshot(r.state);
  return true;
}
function redoStructure() {
  const r = structureHistory.redo();
  if (!r.ok) { updateHistoryButtons(); return false; }
  applyStructureSnapshot(r.state);
  return true;
}

function serializeState(options = {}) {
  ensureNodeUids();
  return serializeRecipe(rState, options);
}
// 自动执行闸门真正看的输入大小：文件链用真字节长度，文本链用字符数。
// 文件载入后 rState.input 只是「📎 已载入…」占位文案，绝不能拿它判断。
function effectiveInputSize() {
  if (rState.file && rState.file.bytes) return inputSizeOf(rState.file.bytes);
  if (rState.inputKind === "file") return rState.fileMissing ? 0 : inputSizeOf(rState.input);
  return inputSizeOf(rState.input);
}
function scheduleDraft() {
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(() => saveDraft(serializeState()), 250);
}
// 自动重跑闸门（T750）：手动模式 / 重 op / 大输入 / 运行中一律只标 stale，等 Bake 或 Ctrl+Enter。
function maybeRunChain() {
  scheduleDraft();
  resetStepSession();
  if (rState.fileMissing && rState.inputKind === "file" && !rState.file) {
    setStale("fileMissing");
    return;
  }
  if (rState.autoRunMode === "manual") {
    setStale("manual");
    return;
  }
  if (hasHeavyNodes()) {
    setStale("heavy");
    return;
  }
  if (effectiveInputSize() > AUTO_RUN_THRESHOLD) {
    setStale(rState.file ? "fileLarge" : "large");
    return;
  }
  if (_running || _loadingOps) {
    setStale("running");
    return;
  }
  clearTimeout(_runTimer);
  _runTimer = setTimeout(() => {
    _runTimer = null;
    runChain({ auto: true });
  }, AUTO_RUN_DEBOUNCE_MS);
}
function setStale(reason) {
  _pending = true;
  _pendingReason = reason || "manual";
  rState.stale = true;
  reflectPending();
}
function clearStale() {
  _pending = false;
  _pendingReason = "";
  rState.stale = false;
  reflectPending();
}
// 把挂起态反映到 UI（Bake 按钮高亮 + 提示条），不重建整个视图
function reflectPending() {
  const bake = document.getElementById("recipeBake");
  if (bake && !_running) bake.classList.toggle("pending", _pending);
  const hint = document.getElementById("recipeBakeHint");
  if (!hint) return;
  hint.style.display = _pending || _running ? "" : "none";
  const text = document.getElementById("recipeBakeHintText");
  if (!text) return;
  if (_running) text.textContent = tt("ui.recipe.running");
  else if (_pendingReason === "heavy") text.textContent = tt("ui.recipe.staleHeavy");
  else if (_pendingReason === "fileLarge") text.textContent = tf("ui.recipe.staleLargeFile", fmtByteSize(effectiveInputSize()));
  else if (_pendingReason === "large") text.textContent = tt("ui.recipe.staleLarge");
  else if (_pendingReason === "running") text.textContent = tt("ui.recipe.staleRunning");
  else if (_pendingReason === "fileMissing") text.textContent = tt("ui.recipe.fileMissing");
  else text.textContent = tt("ui.recipe.autoRunOff");
}
// 重运算 op：作者标注 noAuto / 显式触发白名单 / 惰执行图像类。命中后自动路径不跑。
function nodeIsHeavy(node) {
  if (!node) return false;
  const op = getOp(node.opId);
  if (!op) return false;
  return !!(op.noAuto || isExplicitRunOp(node.opId) || isLazyRunOp(node.opId));
}
function hasHeavyNodes() {
  return rState.nodes.some((n) => !n.disabled && nodeIsHeavy(n));
}
// 惰载 op 兜底：执行前确保链上真实模块已注册，否则 stub 没有 encode/decode 会误报「no encode」。
async function ensureChainOpsLoaded() {
  const ids = [...new Set(rState.nodes.map((n) => n.opId))];
  const stubs = ids.filter((id) => { const op = getOp(id); return op && op.__stub; });
  if (!stubs.length) return;
  await Promise.all(stubs.map((id) => ensureOp(id).catch(() => { /* 留给执行时显式报错 */ })));
}
// stub 升级后方向/默认参数可能变化；静默修正到真实 op 的合法值。
function normalizeNodeDirs() {
  for (const n of rState.nodes) {
    const op = getOp(n.opId);
    if (!op) continue;
    const dirs = opDirs(op);
    if (!dirs.includes(n.dir)) n.dir = dirs.includes("decode") ? "decode" : (dirs[0] || n.dir);
    for (const d of op.params || []) {
      if (!(d.key in (n.params || {}))) {
        if (!n.params) n.params = {};
        n.params[d.key] = d.default;
      }
    }
  }
}

// ---- 链头文件通道（UI 侧，口径与 core/recipe.js 的 resolveRecipeHead 一致）----
// 链头 op 声明 acceptsBytes（音频/图像/二进制类）→ 真字节存 rState.file，编辑框只放占位提示，
// 执行时以 {text, bytes} 交给 executeRecipeSteps，字节走 params.rawBytes；
// 其余链头 → 按「UTF-8 可无损解码则文本、否则 hex」载入（与单 op 输入框拖入行为一致）。
function chainHeadAcceptsBytes() {
  const first = rState.nodes[0];
  const op = first ? getOp(first.opId) : null;
  return !!(op && op.acceptsBytes);
}
function bytesToHexLocal(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}
function loadChainFile(f, inArea) {
  if (!f || !f.arrayBuffer) return;
  f.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    rState.fileMeta = { name: f.name || "", size: bytes.length, mime: f.type || "" };
    rState.fileMissing = false;
    if (chainHeadAcceptsBytes()) {
      rState.file = { bytes, name: f.name };
      rState.inputKind = "file";
      rState.input = tt("ui.op.fileLoaded", f.name, fmtByteSize(bytes.length));
    } else {
      rState.file = null;
      rState.inputKind = "text";
      let text = null;
      try { text = _decodeUtf8Fatal(bytes); } catch { text = null; }
      rState.input = text != null ? text : bytesToHexLocal(bytes);
    }
    if (inArea) inArea.value = rState.input;
    resetStepSession();
    renderRecipe();
    maybeRunChain();
  });
}
function clearChainFile() {
  const wasFileChannel = rState.inputKind === "file";
  rState.file = null;
  rState.fileMeta = null;
  rState.fileMissing = false;
  rState.inputKind = "text";
  // 文件占位文案不是输入内容；清文件时一并清掉，绝不能让它当文本跑。
  if (wasFileChannel) rState.input = "";
  resetStepSession();
}
function pickChainFile(inArea) {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.style.display = "none";
  inp.addEventListener("change", () => {
    const f = inp.files && inp.files[0];
    inp.remove();
    if (f) loadChainFile(f, inArea);
  });
  document.body.append(inp);
  inp.click();
}
function attachChainDrop(inArea) {
  inArea.addEventListener("dragover", (e) => { e.preventDefault(); inArea.classList.add("dragover"); });
  inArea.addEventListener("dragleave", () => inArea.classList.remove("dragover"));
  inArea.addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;   // 无文件（拖 op/文本）交给既有逻辑
    e.preventDefault();
    inArea.classList.remove("dragover");
    loadChainFile(f, inArea);
  });
}

// 拖拽重排：记住被拖节点的下标（null 表示无进行中的拖拽）
let _dragFrom = null;
// 左侧菜单拖 op 进画布用的自定义 MIME（避免与文本拖拽混淆）
const OP_MIME = "application/x-ebctf-op";
// 族条目（）拖入：携带 family id，drop 时弹出选档菜单（旧口径只能拖进族内第一档）
const FAM_MIME = "application/x-ebctf-family";

// i18n 名回退：优先 window 上主表（若 main.js 暴露），否则用 registry 硬编码
function opDisplayName(op) {
  try {
    if (typeof window !== "undefined" && window.__ebctfOpName) {
      const n = window.__ebctfOpName(op);
      if (n) return n;
    }
  } catch { /* 回退 */ }
  return op.name || op.id;
}

// op 支持的方向列表
function opDirs(op) {
  const dirs = [];
  if (op.encode) dirs.push("encode");
  if (op.decode) dirs.push("decode");
  if (op.run) dirs.push("run");
  return dirs;
}
function dirLabel(d) {
  return d === "encode" ? tt("ui.recipe.dir.encode") : d === "decode" ? tt("ui.recipe.dir.decode") : tt("ui.recipe.dir.run");
}

// ---- 控制节点（CC-A5）----
// kind:"control" + control:<id>，不注册主 op、不进 878 计数；执行语义在 core/recipe.js。
// 这里只描述「怎么编辑参数 / 怎么展示」。未实现的语义绝不放进菜单。
const CONTROL_DEFS = [
  {
    id: "register", short: "Register", name: "Register（正则捕获）", icon: "data_object",
    hint: "正则捕获 $R0..$Rn，后续参数可引用",
    note: "$R0 = 整个匹配，$R1..$Rn = 捕获组。后续节点参数里写 $R1 即可替换；未定义的寄存器会显式报错。",
    defaults: { regex: "", flags: "", strict: false },
    fields: [
      { key: "regex", label: "正则表达式", type: "text", placeholder: "(\\w+)@(\\w+)" },
      { key: "flags", label: "flags", type: "text", placeholder: "i / m / s" },
      { key: "strict", label: "无匹配时报错", type: "bool" },
    ],
  },
  {
    id: "conditionalJump", short: "Conditional Jump", name: "Conditional Jump（条件跳转）", icon: "call_split",
    hint: "满足条件时跳到 Label",
    note: "条件成立跳到目标标签；不成立继续下一步。\"反转条件\" 可做「不包含才跳」。",
    defaults: { matchType: "contains", pattern: "", invert: false, label: "" },
    fields: [
      { key: "matchType", label: "条件", type: "select", options: [
        ["contains", "包含"], ["regex", "匹配正则"], ["equals", "完全等于"],
        ["notEquals", "不等于"], ["startsWith", "开头是"], ["endsWith", "结尾是"], ["always", "总是"],
      ] },
      { key: "pattern", label: "模式 / 文本", type: "text", placeholder: "flag{" },
      { key: "invert", label: "反转条件", type: "bool" },
      { key: "label", label: "目标标签", type: "label", placeholder: "loop" },
    ],
  },
  {
    id: "label", short: "Label", name: "Label（标签）", icon: "label",
    hint: "Jump 的落点，本身不改数据",
    note: "同名标签必须唯一；Label 只是落点，数据原样通过。",
    defaults: { name: "" },
    fields: [{ key: "name", label: "标签名", type: "text", placeholder: "loop" }],
  },
  {
    id: "jump", short: "Jump", name: "Jump（跳转）", icon: "redo",
    hint: "无条件跳到 Label",
    note: "回跳受「跳转次数 / 总步数」预算保护，超限会显式报错而不是卡死页面。",
    defaults: { label: "" },
    fields: [{ key: "label", label: "目标标签", type: "label", placeholder: "loop" }],
  },
  {
    id: "return", short: "Return", name: "Return（返回）", icon: "keyboard_return",
    hint: "当前数据立即作为结果返回",
    note: "在 Fork 分支内只结束该分支；在主链上结束整条配方。",
    defaults: {},
    fields: [],
  },
  {
    id: "fork", short: "Fork", name: "Fork（分支）", icon: "account_tree",
    hint: "按行/正则拆分，分支各跑一遍中间步骤",
    note: "必须与同一层后面最近的 Merge 配对；Fork 与 Merge 之间的步骤是分支体，每条分支各跑一次。",
    defaults: { splitMode: "line", splitter: "\\n", removeEmpty: false },
    fields: [
      { key: "splitMode", label: "拆分方式", type: "select", options: [["line", "按行"], ["regex", "正则"], ["literal", "字面文本"]] },
      { key: "splitter", label: "拆分符", type: "text", placeholder: "\\n 或 ,（按行时忽略）" },
      { key: "removeEmpty", label: "忽略空段", type: "bool" },
    ],
  },
  {
    id: "merge", short: "Merge", name: "Merge（合并）", icon: "call_merge",
    hint: "把 Fork 各分支结果按分隔符合并",
    note: "与最近的未配对 Fork 配对；分隔符支持 \\n \\t 转义。",
    defaults: { join: "\\n" },
    fields: [{ key: "join", label: "合并分隔符", type: "text", placeholder: "\\n" }],
  },
  {
    id: "subsection", short: "Subsection", name: "Subsection（分组）", icon: "segment",
    hint: "只做分组/折叠，不改变执行顺序",
    note: "折叠只影响显示，节点照常按顺序执行。",
    defaults: { name: "", collapsed: false },
    fields: [{ key: "name", label: "分组名", type: "text", placeholder: "例如：第一层解码" }],
  },
];
for (const d of CONTROL_DEFS) {
  Object.defineProperty(d, "name", { configurable: true, get: () => tt("ui.recipe.control." + d.id + ".name") });
  Object.defineProperty(d, "hint", { configurable: true, get: () => tt("ui.recipe.control." + d.id + ".hint") });
}
const CONTROL_BY_ID = new Map(CONTROL_DEFS.map((d) => [d.id, d]));
function controlDef(id) { return CONTROL_BY_ID.get(String(id || "")) || null; }
function isControlNode(n) { return !!(n && n.kind === "control"); }
function controlShortName(n) {
  const d = controlDef(n && n.control);
  return d ? d.short : (CONTROL_LABELS[n && n.control] || (n && n.control) || "控制节点");
}
// 当前链上已定义的标签名（给 Jump / Conditional Jump 的 datalist 用）
function chainLabelNames() {
  const out = [];
  for (const n of rState.nodes) {
    if (!isControlNode(n) || n.control !== "label") continue;
    const name = String((n.params || {}).name || "").trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}
// Subsection 的显示范围：组内节点缩进；折叠时隐藏到下一个 Subsection 之前。
function subsectionMarks() {
  const n = rState.nodes.length;
  const indent = new Array(n).fill(false);
  const end = new Array(n).fill(n);
  let cur = -1;
  for (let i = 0; i < n; i++) {
    if (isControlNode(rState.nodes[i]) && rState.nodes[i].control === "subsection") {
      if (cur >= 0) end[cur] = i;
      cur = i;
      indent[i] = false;
    } else if (cur >= 0) {
      indent[i] = true;
    }
  }
  if (cur >= 0) end[cur] = n;
  return { indent, end };
}
// Fork 的配对 Merge（按同层深度）——只用于卡片提示，执行端会再算一次。
function forkMergeStatus(i) {
  let depth = 0;
  for (let p = i + 1; p < rState.nodes.length; p++) {
    const n = rState.nodes[p];
    if (!isControlNode(n)) continue;
    if (n.control === "fork") depth++;
    else if (n.control === "merge") {
      if (!depth) return { pos: p };
      depth--;
    }
  }
  return { pos: -1 };
}

// 把线性 nodes 转成 recipe 图模型（顺序连边）
function toGraph() {
 ensureNodeUids();
 // 最后防线：即使旧数据/预设里混入 exe 类 op（requiresBridge），执行图也剔除——
 // 否则链式即时重跑会反复启动外部程序。选择器过滤 + addNode 兜底 + 此处三重保险。
  const chain = rState.nodes.filter((n) => {
    if (isControlNode(n)) return true;
    const op = getOp(n.opId);
    return !(op && op.requiresBridge);
  });
  const nodes = chain.map((n, i) => {
    const id = n.uid || ("n" + i);
    if (isControlNode(n)) {
      return {
        id, uid: id, kind: "control", control: n.control,
        params: { ...(n.params || {}) },
        disabled: !!n.disabled,
      };
    }
    return {
      id, uid: id,
      opId: n.opId,
      dir: n.dir,
      params: { ...n.params },
      disabled: !!n.disabled,
    };
  });
  const edges = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({ from: nodes[i].id, to: nodes[i + 1].id });
  }
  return { nodes, edges };
}

// ---- 节点操作 ----
// index 省略/越界 → 追加末尾；否则插到该下标前（左侧拖入按落点定位复用）
function appendNodeCore(opId, index) {
  const op = getOp(opId);
  if (!op) return false;
 // 兜底：exe 类 op（requiresBridge）不进配方链——选择器已过滤，此处再堵左侧拖入等其他入口
 // 防止链式即时重跑反复启动外部程序。
  if (op.requiresBridge) return false;
  const dirs = opDirs(op);
  const node = {
    uid: "r" + (++_uidSeq),
    opId,
    dir: dirs.includes("decode") ? "decode" : (dirs[0] || "decode"),
    params: defaultParams(op),
  };
  if (index == null || index < 0 || index >= rState.nodes.length) rState.nodes.push(node);
  else rState.nodes.splice(index, 0, node);
  // 惰载 op：先乐观入链，真实模块到达后补齐方向/参数并重绘（否则方向会停在占位值）。
  if (op.__stub) {
    ensureOp(opId).then(() => {
      const real = getOp(opId);
      if (!real || !rState.nodes.includes(node)) return;
      const realDirs = opDirs(real);
      if (!realDirs.includes(node.dir)) node.dir = realDirs.includes("decode") ? "decode" : (realDirs[0] || node.dir);
      node.params = { ...defaultParams(real), ...node.params };
      if (document.getElementById("recipeChain")) renderRecipe();
    }).catch(() => { /* 加载失败保留占位，执行时会给出明确错误 */ });
  }
  return true;
}
function addNode(opId, index) {
  if (!appendNodeCore(opId, index)) return;
  recordStructure("add:" + (rState.nodes[index == null || index < 0 || index >= rState.nodes.length ? rState.nodes.length - 1 : index] || {}).uid);
  resetStepSession();
  renderRecipe();
  maybeRunChain();
}
// 控制节点入链：不是注册表 op，参数取 UI 定义里的默认值，可编辑/复制/删除/撤销。
function appendControlCore(control, index) {
  const def = controlDef(control);
  if (!def) return false;
  const node = {
    uid: "r" + (++_uidSeq),
    kind: "control",
    control: def.id,
    dir: "",
    params: cloneParamValue(def.defaults || {}),
  };
  if (index == null || index < 0 || index >= rState.nodes.length) rState.nodes.push(node);
  else rState.nodes.splice(index, 0, node);
  return true;
}
function addControlNode(control, index) {
  if (!appendControlCore(control, index)) return;
  const idx = index == null || index < 0 || index >= rState.nodes.length
    ? rState.nodes.length - 1 : index;
  recordStructure("control-add:" + (rState.nodes[idx] || {}).uid);
  resetStepSession();
  renderRecipe();
  maybeRunChain();
  setRunStatus(`已插入 ${controlShortName(rState.nodes[idx])} 节点；参数可在卡片上编辑。`, "normal");
}
export function appendRecipeOpToTail(opId) {
  const op = getOp(opId);
  if (!op) return { ok: false, reason: "unknownOp", opId };
  if (op.requiresBridge) return { ok: false, reason: "requiresBridge", opId };
  const before = rState.nodes.length;
  if (!appendNodeCore(opId, null) || rState.nodes.length !== before + 1) {
    return { ok: false, reason: "notAdded", opId };
  }
  const rendered = (location.hash === "#/recipe" || location.hash.startsWith("#/recipe?"))
    && !!(_recipeHost || document.getElementById("recipeHost"));
  if (rendered) {
    recordStructure("add:" + (rState.nodes[rState.nodes.length - 1] || {}).uid);
    resetStepSession();
    renderRecipe();
    maybeRunChain();
  }
  return { ok: true, opId, index: rState.nodes.length - 1, rendered };
}
function removeNode(i) {
  if (i < 0 || i >= rState.nodes.length) return;
  const uid = (rState.nodes[i] || {}).uid;
  rState.nodes.splice(i, 1);
  recordStructure("remove:" + uid);
  resetStepSession();
  renderRecipe();
  maybeRunChain();
}
function moveNode(i, delta) {
  const j = i + delta;
  if (j < 0 || j >= rState.nodes.length) return;
  const t = rState.nodes[i]; rState.nodes[i] = rState.nodes[j]; rState.nodes[j] = t;
  recordStructure("move:" + t.uid);
  resetStepSession();
  renderRecipe();
  maybeRunChain();
}
// 任意位置移动（拖拽重排复用）：把 from 处节点抽出插到 to
function moveNodeTo(from, to) {
  const n = rState.nodes.length;
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return;
  const [node] = rState.nodes.splice(from, 1);
  rState.nodes.splice(to, 0, node);
  recordStructure("move:" + node.uid);
  resetStepSession();
  renderRecipe();
  maybeRunChain();
}
// 复制节点：参数深拷贝（嵌套对象/数组不共享引用），插到原节点之后。
function duplicateNode(i) {
  const src = rState.nodes[i];
  if (!src) return;
  let copy;
  if (isControlNode(src)) {
    copy = {
      uid: "r" + (++_uidSeq),
      kind: "control",
      control: src.control,
      dir: "",
      params: cloneParamValue(src.params || {}),
      disabled: !!src.disabled,
      breakpoint: false,
    };
  } else {
    const op = getOp(src.opId);
    if (!op || op.requiresBridge) return;
    copy = {
      uid: "r" + (++_uidSeq),
      opId: src.opId,
      dir: src.dir,
      params: cloneParamValue(src.params || {}),
      disabled: !!src.disabled,
      breakpoint: false,
    };
  }
  rState.nodes.splice(i + 1, 0, copy);
  recordStructure("duplicate:" + copy.uid);
  resetStepSession();
  renderRecipe();
  maybeRunChain();
}
function toggleDisabled(i) {
  const n = rState.nodes[i];
  if (!n) return;
  n.disabled = !n.disabled;
  recordStructure("disabled:" + n.uid);
  resetStepSession();
  renderRecipe();
  maybeRunChain();
}
function toggleBreakpoint(i) {
  const n = rState.nodes[i];
  if (!n) return;
  n.breakpoint = !n.breakpoint;
  recordStructure("breakpoint:" + n.uid);
  resetStepSession();
  renderRecipe();
  maybeRunChain();
}
function clearChain() {
  rState.nodes = [];
  rState.file = null;
  rState.fileMeta = null;
  rState.fileMissing = false;
  rState.inputKind = "text";
  recordStructure("clear");
  resetStepSession();
  renderRecipe();
  maybeRunChain();
}

// 配方导出/导入。CyberChef 配方是 [{op:"From Base64",args:[...]}]（英文全名+位置参数）
// 本项目是 {opId,dir,params}（短 id+命名参数），两套 op 命名体系不同、400+ op 名映射维护成本极高
// 无法直接互通 → 走本项目自有 JSON（tool 标记 EBCTFCodeBox，版本化）。
const RECIPE_FORMAT = "EBCTFCodeBox-recipe";
const RECIPE_FORMAT_VER = 3;
// 导出当前链为 JSON 文本。默认只带配方；工具条「包含输入」勾选后才写 input。
// 文件链头只导出 inputKind/fileMeta，不写字节——必须显式提示，绝不静默把占位文案当输入。
function exportRecipe() {
  const data = serializeState({ includeInput: _includeInput });
  const json = JSON.stringify(data, null, 2);
  const notices = [];
  if (data.inputOmitted) notices.push(tt("ui.recipe.exportNoInput"));
  if (data.fileOmitted) notices.push(tt("ui.recipe.exportFileOmitted"));
  if (notices.length) {
    const msg = notices.join(" ");
    try { if (window.__ebctfToast) window.__ebctfToast(msg); } catch { /* 忽略 */ }
    setRunStatus(msg, "warn");
  }
  try {
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "recipe-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19) + ".json";
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch { /* 忽略 */ }
}
// 从 JSON 文本恢复链。校验 format/nodes；只保留 registry 里存在且非 bridge 的 op（安全 + 防脏数据）。
// 返回 {ok, error}。
function applyRecipeData(data, { silentRender = false } = {}) {
  if (!data || data.format !== RECIPE_FORMAT || !Array.isArray(data.nodes)) {
    return { ok: false, error: tt("ui.recipe.importBadFormat") };
  }
  const nodes = [];
  for (const n of data.nodes) {
    if (!n || typeof n !== "object") continue;
    // v3 控制节点：kind+control，不依赖注册表；未知 control 类型跳过（不猜语义）。
    if (n.kind === "control") {
      const def = controlDef(n.control);
      if (!def) continue;
      const params = { ...cloneParamValue(def.defaults || {}) };
      if (n.params && typeof n.params === "object") Object.assign(params, cloneParamValue(n.params));
      nodes.push({
        uid: "r" + (++_uidSeq),
        kind: "control",
        control: def.id,
        dir: "",
        params,
        disabled: !!n.disabled,
        breakpoint: !!n.breakpoint,
      });
      continue;
    }
    if (typeof n.opId !== "string") continue;
    const op = getOp(n.opId);
    if (!op || op.requiresBridge) continue;   // 未知 op / exe 桥 op 跳过（同 addNode 兜底）
    const dirs = opDirs(op);
    const dir = dirs.includes(n.dir) ? n.dir : (dirs.includes("decode") ? "decode" : dirs[0]);
    nodes.push({
      uid: "r" + (++_uidSeq),
      opId: n.opId,
      dir,
      params: (n.params && typeof n.params === "object") ? cloneParamValue(n.params) : defaultParams(op),
      disabled: !!n.disabled,
      breakpoint: !!n.breakpoint,
    });
  }
  if (!nodes.length) return { ok: false, error: tt("ui.recipe.importEmpty") };
  // 结构校验/节点过滤全部通过后才压快照：导入失败不能污染历史，也不能改变当前链。
  pushReplaceSnapshot("load");
  rState.nodes = nodes;
  recordStructure("load");
  rState.file = null;
  rState.inputKind = data.inputKind === "file" ? "file" : "text";
  rState.fileMeta = data.fileMeta && typeof data.fileMeta === "object"
    ? { name: String(data.fileMeta.name || ""), size: Number(data.fileMeta.size) || 0, mime: String(data.fileMeta.mime || "") }
    : null;
  rState.fileMissing = rState.inputKind === "file";
  rState.autoRunMode = data.autoRunMode === "manual" ? "manual" : "auto";
  // 文件链头恢复后没有字节：绝不把 v1 的「📎 已载入…」占位文案当输入跑。
  rState.input = rState.inputKind === "file"
    ? ""
    : (typeof data.input === "string" ? data.input : "");
  resetStepSession();
  if (!silentRender) { renderRecipe(); maybeRunChain(); }
  return { ok: true, count: nodes.length };
}

function importRecipeFromText(text) {
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, error: tt("ui.recipe.importBadJson") }; }
  return applyRecipeData(data);
}

// T698/T699：一次启动恢复（分享链接优先于自动草稿）。异步解码后重绘一次。
let _bootRestored = false;
let _lastShare = "";
function restoreOnce() {
  if (_bootRestored) return;
  _bootRestored = true;
  const share = shareCodeFromHash(location.hash);
  if (share && share !== _lastShare) {
    _lastShare = share;
    decodeShare(share).then((data) => {
      const r = applyRecipeData(data, { silentRender: true });
      if (r.ok) { renderRecipe(); maybeRunChain(); }
    }).catch(() => { /* 坏链接静默回退草稿 */ restoreDraftOnce(); });
    return;
  }
  restoreDraftOnce();
}
function restoreDraftOnce() {
  if (rState.nodes.length || rState.input) return;
  const d = loadDraft();
  if (!d) return;
  const r = applyRecipeData(d, { silentRender: true });
  if (r.ok) setTimeout(() => { renderRecipe(); maybeRunChain(); }, 0);
}
// 触发文件选择导入。
function importRecipe() {
  const inp = document.createElement("input");
  inp.type = "file";
  inp.accept = ".json,application/json";
  inp.addEventListener("change", () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const r = importRecipeFromText(String(reader.result || ""));
      try { if (window.__ebctfToast) window.__ebctfToast(r.ok ? tt("ui.recipe.importOk", r.count) : r.error); } catch { /* 忽略 */ }
    };
    reader.readAsText(f);
  });
  inp.click();
}

// dataTransfer 是否携带左侧 op/族拖拽的自定义 MIME（dragover 阶段 getData 取不到值，只能查 types）
function dtHasOpMime(dt) {
  try {
    const types = Array.prototype.slice.call(dt.types || []);
    return types.indexOf(OP_MIME) !== -1 || types.indexOf(FAM_MIME) !== -1;
  } catch { return false; }
}
// 依据 drop 时鼠标 Y 坐标算插入下标：落在哪张节点卡的上半区就插到它前面，否则追加末尾
function dropIndexFromY(chain, clientY) {
  const cards = chain.querySelectorAll(".recipe-node");
  for (let k = 0; k < cards.length; k++) {
    const r = cards[k].getBoundingClientRect();
    if (clientY < r.top + r.height / 2) return Number(cards[k].dataset.idx);
  }
  return null; // 追加末尾
}

function loadPreset(id) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p || !p.graph) return;
 // 预设 graph 是线性链（本项目预设均线性），按 edges 顺序还原 nodes 序
  const g = p.graph;
  const order = topoOrder(g);
  const nextNodes = order.map((nid) => {
    const gn = g.nodes.find((n) => n.id === nid);
    const { mode, ...rest } = gn.params || {};
    return { uid: "r" + (++_uidSeq), opId: gn.opId, dir: mode || "decode", params: cloneParamValue(rest) };
  });
  pushReplaceSnapshot("preset");
  rState.nodes = nextNodes;
  recordStructure("preset");
  rState.file = null;
  rState.fileMeta = null;
  rState.fileMissing = false;
  rState.inputKind = "text";
  resetStepSession();
  renderRecipe();
  maybeRunChain();
}
// 简易拓扑序（预设为线性链，够用；有环则退回声明序）
function topoOrder(g) {
  const indeg = new Map(g.nodes.map((n) => [n.id, 0]));
  for (const e of g.edges) if (indeg.has(e.to)) indeg.set(e.to, indeg.get(e.to) + 1);
  const q = g.nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const order = [];
  while (q.length) {
    const id = q.shift(); order.push(id);
    for (const e of g.edges) if (e.from === id) {
      indeg.set(e.to, indeg.get(e.to) - 1);
      if (indeg.get(e.to) === 0) q.push(e.to);
    }
  }
  return order.length === g.nodes.length ? order : g.nodes.map((n) => n.id);
}

// ---- op 选择器（可搜索 combobox，替代原分类下拉）----
// 非拖动添加入口：输入即过滤，上下键/Enter/点击直接添加。桌面/触摸通用。
function buildOpSearchPicker(onPick) {
  const wrap = el("div", { class: "recipe-op-search" });
  const input = el("input", { type: "text", class: "recipe-op-search-input", placeholder: tt("ui.recipe.addOp"), autocomplete: "off", spellcheck: "false" });
  const list = el("div", { class: "recipe-op-search-list" });

  // 数据源：chainable op（同旧下拉的过滤：exe 桥 op 不进链）+ 名称排序
  const chainable = [];
  for (const cat of CATEGORIES) {
    if (cat.id === "home") continue;
    for (const op of opsByCat(cat.id)) {
      if (op.requiresBridge) continue;
      chainable.push(op);
    }
  }
  chainable.sort((a, b) => opDisplayName(a).localeCompare(opDisplayName(b), "zh"));

  // 轻量过滤 + 评分（名称开头 > 名称包含 > id 包含），不依赖 main.js（低耦合）
  const filter = (q) => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return chainable.slice(0, 12);
    const out = [];
    for (const op of chainable) {
      const nm = opDisplayName(op).toLowerCase();
      let ok = true, score = 0;
      for (const t of terms) {
        const pos = nm.indexOf(t);
        if (pos < 0 && !op.id.toLowerCase().includes(t)) { ok = false; break; }
        if (pos === 0) score += 100;
        else if (pos > 0) score += 40;
        else score += 10; // 命中 id
      }
      if (ok) out.push({ op, score });
    }
    out.sort((a, b) => b.score - a.score);
    return out.slice(0, 12).map((x) => x.op);
  };

  const renderList = (ops) => {
    list.innerHTML = "";
    if (!ops.length) {
      list.append(el("div", { class: "recipe-op-search-empty" }, tt("ui.recipe.addEmpty")));
      list.classList.add("open");
      return;
    }
    ops.forEach((op, i) => {
      const item = el("div", { class: "recipe-op-search-item", "data-idx": String(i), "data-op-id": op.id },
        el("span", { class: "recipe-op-search-item-name" }, opDisplayName(op)),
      );
      item.addEventListener("mousedown", (e) => { e.preventDefault(); pick(op.id); });
      item.addEventListener("touchstart", (e) => { e.preventDefault(); pick(op.id); }, { passive: false });
      list.append(item);
    });
    list.classList.add("open");
  };
  const closeList = () => { list.classList.remove("open"); list.innerHTML = ""; };
  const pick = (opId) => {
    input.value = "";
    closeList();
    onPick(opId);
    input.focus();
  };

  input.addEventListener("input", () => renderList(filter(input.value)));
  input.addEventListener("focus", () => { if (input.value.trim()) renderList(filter(input.value)); });
  input.addEventListener("keydown", (e) => {
    // 中文 IME 组合输入期间 Enter 是「确认候选」，绝不能拿去添加 op。
    if (e.isComposing || e.keyCode === 229) return;
    const items = Array.from(list.querySelectorAll(".recipe-op-search-item"));
    const active = list.querySelector(".recipe-op-search-item.active");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const i = active ? Number(active.dataset.idx) + 1 : 0;
      items.forEach((n) => n.classList.remove("active"));
      if (items[i % items.length]) items[i % items.length].classList.add("active");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const i = active ? Number(active.dataset.idx) - 1 : items.length - 1;
      items.forEach((n) => n.classList.remove("active"));
      if (items[((i % items.length) + items.length) % items.length]) items[((i % items.length) + items.length) % items.length].classList.add("active");
    } else if (e.key === "Enter") {
      const it = list.querySelector(".recipe-op-search-item.active");
      if (it) pick(it.dataset.opId);
      else if (items.length === 1) pick(items[0].dataset.opId);
      else if (items.length) pick(items[0].dataset.opId);
    } else if (e.key === "Escape") {
      closeList();
    }
  });
  // 焦点离开整个搜索添加器时关闭；不挂 document 全局监听，避免每次 renderRecipe 重建累积监听。
  wrap.addEventListener("focusout", () => {
    setTimeout(() => { if (!wrap.contains(document.activeElement)) closeList(); }, 0);
  });

  wrap.append(input, list);
  return wrap;
}

// ---- 单节点卡 ----
// 卡片底座：焦点记录 + 拖拽重排。op 卡与控制节点卡共用（避免两套事件逻辑走偏）。
function createNodeCardBase(node, i, extraClass) {
  const card = el("div", {
    class: "recipe-node" + (extraClass ? " " + extraClass : "")
      + (node.disabled ? " disabled" : "") + (node.breakpoint ? " breakpoint" : ""),
    draggable: "true", tabindex: "0",
  });
  card.dataset.idx = String(i);
  card.dataset.uid = node.uid || "";
  if (i === _focusedNodeIndex && node.uid && node.uid === _focusedNodeUid) card.classList.add("focused");
  card.addEventListener("focusin", () => {
    _focusedNodeIndex = i;
    _focusedNodeUid = node.uid || "";
    const chain = card.parentElement;
    if (chain) for (const c of chain.querySelectorAll(".recipe-node.focused")) c.classList.remove("focused");
    card.classList.add("focused");
  });

 // 拖拽重排（CyberChef 式手感）：记住被拖下标，drop 时算目标下标 → moveNodeTo。上下箭头保留。
  card.addEventListener("dragstart", (e) => {
 // 交互控件（参数输入框/下拉/按钮/M3 开关/参数区）发起时放弃卡片拖拽。
 // 否则整卡 draggable=true 会在 input/select 内 mousedown+移动时抢先触发 dragstart
 // 吞掉文本选择/光标定位（Chromium draggable 祖先经典坑）→ 用户以为参数填不进=配方链不能用。
    const tgt = e.target;
    if (tgt && tgt.closest && tgt.closest("input, select, textarea, button, label, .recipe-node-params")) {
      e.preventDefault();
      return;
    }
    _dragFrom = i;
    card.classList.add("dragging");
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", String(i)); } catch { /* 某些环境禁用 */ } }
  });
  card.addEventListener("dragend", () => {
    _dragFrom = null;
    card.classList.remove("dragging");
 // 清残留指示线（重绘前的兜底）
    for (const n of card.parentElement ? card.parentElement.querySelectorAll(".recipe-node.drag-over") : []) n.classList.remove("drag-over");
  });
  card.addEventListener("dragover", (e) => {
    if (_dragFrom == null || _dragFrom === i) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    card.classList.add("drag-over");
  });
  card.addEventListener("dragleave", () => { card.classList.remove("drag-over"); });
  card.addEventListener("drop", (e) => {
    e.preventDefault();
    card.classList.remove("drag-over");
    if (_dragFrom == null || _dragFrom === i) return;
    moveNodeTo(_dragFrom, i);
    _dragFrom = null;
  });
  return card;
}

// 节点卡通用按钮组（运行到此 / 从此运行 / 复制 / 断点 / 禁用 / 上下移 / 删除）。
function buildNodeCtrl(node, i) {
  return el("div", { class: "recipe-node-ctrl" },
    el("button", { class: "icon-btn recipe-mini-btn", title: tt("ui.recipe.runToHere"), "aria-label": tt("ui.recipe.runToHere"), onclick: () => runChain({ endAt: i, manual: true }) }, msym("arrow_downward")),
    el("button", { class: "icon-btn recipe-mini-btn", title: tt("ui.recipe.runFromHere"), "aria-label": tt("ui.recipe.runFromHere"), onclick: () => runChain({ startAt: i, manual: true }) }, msym("play_arrow")),
    el("button", { class: "icon-btn recipe-mini-btn", title: tt("ui.recipe.duplicate"), "aria-label": tt("ui.recipe.duplicate"), onclick: () => duplicateNode(i) }, msym("content_copy")),
    el("button", { class: "icon-btn recipe-mini-btn" + (node.breakpoint ? " active" : ""), title: node.breakpoint ? tt("ui.recipe.breakpointOn") : tt("ui.recipe.breakpoint"), "aria-label": tt("ui.recipe.breakpoint"), "aria-pressed": node.breakpoint ? "true" : "false", style: node.breakpoint ? "color:var(--warning)" : "", onclick: () => toggleBreakpoint(i) }, msym("stop")),
    el("button", { class: "icon-btn recipe-mini-btn" + (node.disabled ? " active" : ""), title: node.disabled ? tt("ui.recipe.enabled") : tt("ui.recipe.disabled"), "aria-label": tt("ui.recipe.disabled"), "aria-pressed": node.disabled ? "true" : "false", style: node.disabled ? "color:var(--warning)" : "", onclick: () => toggleDisabled(i) }, msym("visibility_off")),
    el("button", { class: "icon-btn recipe-mini-btn", title: tt("ui.recipe.moveUp"), onclick: () => moveNode(i, -1) }, msym("arrow_upward")),
    el("button", { class: "icon-btn recipe-mini-btn", title: tt("ui.recipe.moveDown"), onclick: () => moveNode(i, 1) }, msym("arrow_downward")),
    el("button", { class: "icon-btn recipe-mini-btn", title: tt("ui.recipe.remove"), style: "color:var(--error)", onclick: () => removeNode(i) }, msym("close")),
  );
}

function renderNodeCard(node, i) {
  if (isControlNode(node)) return renderControlCard(node, i);
  const op = getOp(node.opId);
  if (!op) return el("div", { class: "recipe-node error" }, tt("ui.recipe.unknownOp") + node.opId);
  const dirs = opDirs(op);
  const card = createNodeCardBase(node, i, "");
 // 头：序号 + 名 + 方向 + 上下移/删
  const head = el("div", { class: "recipe-node-head" },
    el("span", { class: "recipe-node-idx" }, String(i + 1)),
    el("span", { class: "recipe-node-name" }, opDisplayName(op)),
  );
 // 方向切换（多向才显示）
  if (dirs.length > 1) {
    const dsel = el("select", { class: "recipe-node-dir" });
    for (const d of dirs) {
      const o = el("option", { value: d }, dirLabel(d));
      if (d === node.dir) o.setAttribute("selected", "");
      dsel.append(o);
    }
    dsel.value = node.dir;
    dsel.addEventListener("change", () => {
      node.dir = dsel.value;
      recordStructure("dir:" + node.uid);
      resetStepSession();
      maybeRunChain();
    });
    head.append(dsel);
  } else {
    head.append(el("span", { class: "recipe-node-dir-fixed" }, dirLabel(dirs[0])));
  }
  // 节点增减控件改 M3 圆形图标按钮（复用 app.css 的 .icon-btn 范式）。
  // recipe-mini-btn 作附加钩子保留（供尺寸微调）；删除键内联 --error 令牌保留危险色，不硬编。
  head.append(buildNodeCtrl(node, i));
  card.append(head);

 // 参数区
  const params = op.params || [];
  if (params.length) {
    const pwrap = el("div", { class: "recipe-node-params" });
    for (const d of params) pwrap.append(renderRecipeParam(node, d, i));
    card.append(pwrap);
  }
  return card;
}

// ---- 控制节点卡 ----
function toggleSubsectionCollapse(i) {
  const n = rState.nodes[i];
  if (!n || !isControlNode(n) || n.control !== "subsection") return;
  n.params.collapsed = !n.params.collapsed;
  if (n.params.collapsed && _focusedNodeUid) {
    // 折叠后若焦点落在被隐藏的节点上，清掉焦点，避免 Delete/Alt+↑ 误伤看不见的节点。
    const fi = rState.nodes.findIndex((x) => x.uid === _focusedNodeUid);
    const marks = subsectionMarks();
    const end = marks.end[i] == null ? rState.nodes.length : marks.end[i];
    if (fi > i && fi < end) { _focusedNodeUid = ""; _focusedNodeIndex = -1; }
  }
  recordStructure("collapse:" + n.uid);
  scheduleDraft();
  renderRecipe();   // 只影响显示，不重跑链
}
function renderControlCard(node, i) {
  const def = controlDef(node.control);
  if (!def) return el("div", { class: "recipe-node error" }, tt("ui.recipe.controlUnknown") + (node.control || ""));
  if (!node.params) node.params = {};
  const card = createNodeCardBase(node, i, "recipe-control recipe-control-" + def.id);
  const head = el("div", { class: "recipe-node-head" },
    el("span", { class: "recipe-node-idx" }, String(i + 1)),
    el("span", { class: "recipe-node-badge" }, msym(def.icon)),
    el("span", { class: "recipe-node-name" }, def.name),
  );
  if (def.id === "subsection") {
    head.append(el("button", {
      class: "icon-btn recipe-mini-btn" + (node.params.collapsed ? " active" : ""),
      title: node.params.collapsed ? tt("ui.recipe.controlExpand") : tt("ui.recipe.controlCollapse"),
      "aria-label": node.params.collapsed ? tt("ui.recipe.controlExpand") : tt("ui.recipe.controlCollapse"),
      "aria-pressed": node.params.collapsed ? "true" : "false",
      onclick: (e) => { e.stopPropagation(); toggleSubsectionCollapse(i); },
    }, msym(node.params.collapsed ? "unfold_more" : "unfold_less")));
  }
  head.append(buildNodeCtrl(node, i));
  card.append(head);
  if (def.note) card.append(el("div", { class: "recipe-control-note" }, def.note));
  if (def.id === "fork") {
    const st = forkMergeStatus(i);
    card.append(el("div", { class: "recipe-control-note" + (st.pos < 0 ? " warn" : "") },
      st.pos >= 0 ? tf("ui.recipe.controlForkPair", st.pos + 1) : tt("ui.recipe.controlForkNoPair")));
  }
  if (def.fields.length) {
    const pwrap = el("div", { class: "recipe-node-params" });
    for (const f of def.fields) pwrap.append(renderControlField(node, f, i));
    card.append(pwrap);
  }
  return card;
}

function renderControlField(node, field, i) {
  const wrap = el("div", { class: "recipe-param" });
  if (!node.params) node.params = {};
  const commit = (value) => {
    node.params[field.key] = value;
    recordStructure("param:" + node.uid + ":" + field.key);
    resetStepSession();
    maybeRunChain();
  };
  if (field.type === "bool") {
    const sid = "rc_" + i + "_" + field.key;
    const cb = el("input", { type: "checkbox", id: sid });
    cb.checked = !!node.params[field.key];
    cb.addEventListener("change", () => commit(cb.checked));
    wrap.append(
      el("label", { class: "switch", for: sid }, cb, el("span", { class: "track" }), el("span", { class: "knob" })),
      el("label", { for: sid }, field.label),
    );
    return wrap;
  }
  if (field.type === "select") {
    const sel = el("select", {});
    for (const opt of field.options || []) {
      const [value, label] = Array.isArray(opt) ? opt : [opt.value, opt.label];
      sel.append(el("option", { value }, label));
    }
    sel.value = node.params[field.key] ?? ((field.options && field.options[0] && field.options[0][0]) || "");
    sel.addEventListener("change", () => commit(sel.value));
    wrap.append(el("label", {}, field.label), sel);
    return wrap;
  }
  const inp = el("input", { type: "text", placeholder: field.placeholder || "", autocomplete: "off", spellcheck: "false" });
  inp.value = node.params[field.key] ?? "";
  if (field.type === "label") {
    const listId = "recipeLabels_" + i + "_" + field.key;
    inp.setAttribute("list", listId);
    const dl = el("datalist", { id: listId });
    for (const name of chainLabelNames()) dl.append(el("option", { value: name }));
    wrap.append(el("label", {}, field.label), inp, dl);
  } else {
    wrap.append(el("label", {}, field.label), inp);
  }
  inp.addEventListener("input", () => commit(inp.value));
  return wrap;
}

// 密钥/IV/码表等长文本参数与主 op 页同口径：单行加宽 + 展开 modal。
const EXPANDABLE_KEYS = new Set([
  "key", "iv", "dict", "table", "cover", "salt", "crib", "pairs",
  "alphabet", "keyword", "plaintext", "keystream", "password", "map",
]);
function commitRecipeParam(node, d, value) {
  if (!node.params) node.params = {};
  node.params[d.key] = value;
  recordStructure("param:" + node.uid + ":" + d.key);
  resetStepSession();
  maybeRunChain();
}
// ---- M3 敏感参数遮罩（口令 / 私钥 / seed / secret 等）：范式同主 op 页 renderParam，但本模块自持 ----
// 遮罩统一用 -webkit-text-security: disc（非 blur）；自实现小眼睛，masked/unmasked 可切，
// aria-pressed / title 同步；不支持 text-security 时 input 回退 type=password（不出现明文回退）。
const RECIPE_MASK_CSS_SUPPORTED = typeof document !== "undefined" && (() => {
  try { const i = document.createElement("input"); return "webkitTextSecurity" in i.style; } catch { return false; }
})();
function isRecipeMasked(input) {
  if (!input) return false;
  if (input.dataset && input.dataset.maskCss === "1") return input.classList.contains("is-masked");
  return input.type === "password";
}
function applyRecipeMask(input, masked) {
  if (!input) return;
  if (input.dataset && input.dataset.maskCss === "1") { input.classList.toggle("is-masked", !!masked); return; }
  input.type = masked ? "password" : "text";
}
function makeRecipeMaskedInput(attrs) {
  const cssMask = RECIPE_MASK_CSS_SUPPORTED;
  const inp = el("input", { ...attrs, type: cssMask ? "text" : "password" });
  if (cssMask) { inp.dataset.maskCss = "1"; inp.classList.add("is-masked"); }
  return inp;
}
// 小眼睛：宿主可为 input（applyRecipeMask）或 textarea（dataset.maskCss + is-masked）。
// 点击按「当前态取反」切换，保证有效；图标 / title / aria-label / aria-pressed 随态同步。
function recipeSecretEyeButton(getInput, opts = {}) {
  const defaultHidden = opts.defaultHidden !== false;
  const btn = el("button", {
    type: "button", class: "exp-btn param-bigta-btn secret-eye-btn",
    title: tt(defaultHidden ? "ui.io.showSecret" : "ui.io.hideSecret"),
    "aria-label": tt(defaultHidden ? "ui.io.showSecret" : "ui.io.hideSecret"),
    "aria-pressed": String(defaultHidden),
  }, msym(defaultHidden ? "visibility" : "visibility_off"));
  btn.addEventListener("click", () => {
    const input = getInput();
    const nextHidden = !isRecipeMasked(input);
    applyRecipeMask(input, nextHidden);
    btn.innerHTML = "";
    btn.append(msym(nextHidden ? "visibility" : "visibility_off"));
    btn.title = tt(nextHidden ? "ui.io.showSecret" : "ui.io.hideSecret");
    btn.setAttribute("aria-label", btn.title);
    btn.setAttribute("aria-pressed", String(nextHidden));
  });
  return btn;
}
// 与主 op 页同口径：key 名回退判定敏感（d.sensitive 未标时仍给眼睛，默认明文，可主动遮）。
const RECIPE_SECRET_KEY_RE = /^(key|keys|dict|seed|salt|keyword|alphabet|pass|pwd|password|secret|token|nonce|iv)$/i;
// 节点参数框（本地渲染，改值即重跑链）
function renderRecipeParam(node, d, i) {
  const wrap = el("div", { class: "recipe-param" });
  const inputId = "rp_" + i + "_" + d.key;
  if (d.type === "bool") {
 // M3 switch，替代原生 checkbox
 // sid 用节点下标 i（节点对象无 id 字段），避免同 op 多节点撞 id → label-for 劫持/switch 串台
    const sid = inputId;
    const cb = el("input", { type: "checkbox", id: sid });
    cb.checked = !!node.params[d.key];
    cb.addEventListener("change", () => commitRecipeParam(node, d, cb.checked));
    wrap.append(
      el("label", { class: "switch", for: sid }, cb, el("span", { class: "track" }), el("span", { class: "knob" })),
      el("label", { for: sid }, d.label),
    );
  } else if (d.type === "select") {
    const sel = el("select", { id: inputId });
    for (const o of d.options || []) sel.append(el("option", { value: o.value ?? o }, o.label ?? o));
    sel.value = node.params[d.key];
    sel.addEventListener("change", () => commitRecipeParam(node, d, sel.value));
    wrap.append(el("label", { for: inputId }, d.label), sel);
  } else if (d.type === "number") {
 // M3 stepper 自实现，替浏览器原生 spinner（与 main.js renderParam 同形）。[−][input][＋]
    const min = d.min ?? null, max = d.max ?? null, step = d.step ?? 1;
    const numericSecret = !!d.sensitive || RECIPE_SECRET_KEY_RE.test(String(d.key || ""));
    const inp = numericSecret
      ? makeRecipeMaskedInput({ inputmode: "numeric", id: inputId, class: "stepper-inp", placeholder: d.placeholder || "", autocomplete: "off" })
      : el("input", { type: "text", inputmode: "numeric", id: inputId, class: "stepper-inp", placeholder: d.placeholder || "" });
    inp.value = node.params[d.key] ?? "";
    const clamp = (n) => {
      if (Number.isNaN(n)) return n;
      if (min !== null && n < min) n = min;
      if (max !== null && n > max) n = max;
      return n;
    };
    const commit = (n) => {
      const v = clamp(n);
      node.params[d.key] = v;
      inp.value = Number.isNaN(v) ? "" : String(v);
      recordStructure("param:" + node.uid + ":" + d.key);
      resetStepSession();
      maybeRunChain();
    };
    const bump = (dir) => {
      const cur = Number(inp.value);
      const base = Number.isNaN(cur) ? (min ?? 0) : cur;
      commit(base + dir * step);
    };
    inp.addEventListener("input", () => {
      node.params[d.key] = Number(inp.value);
      recordStructure("param:" + node.uid + ":" + d.key);
      resetStepSession();
      maybeRunChain();
    });
    inp.addEventListener("blur", () => { if (inp.value !== "") commit(Number(inp.value)); });
    const btn = (iconName, dir, label) => {
      const b = el("button", { type: "button", class: "stepper-btn", "aria-label": label, tabindex: "-1" }, msym(iconName));
      b.addEventListener("click", () => bump(dir));
      return b;
    };
    const box = el("div", { class: "stepper" }, btn("remove", -1, "减"), inp, btn("add", 1, "加"));
    if (numericSecret) wrap.append(el("label", { for: inputId }, d.label), el("div", { class: "param-bigbox secret-field" }, box, recipeSecretEyeButton(() => inp, { defaultHidden: true })));
    else wrap.append(el("label", { for: inputId }, d.label), box);
  } else if (d.ui === "bigText" || d.type === "textarea") {
    // 多行参数：与主 op 页 param-bigta 同形，带展开 modal。
    wrap.classList.add("param-big");
    const secretTa = !!d.sensitive;
    const ta = el("textarea", {
      id: inputId, class: "param-bigta recipe-param-ta",
      rows: String(Math.min(10, Math.max(3, d.rows ?? 5))),
      placeholder: d.placeholder || "", spellcheck: "false", autocomplete: "off",
    });
    if (secretTa) { ta.dataset.maskCss = "1"; ta.classList.add("is-masked"); }
    ta.value = node.params[d.key] ?? "";
    ta.addEventListener("input", () => commitRecipeParam(node, d, ta.value));
    const btn = el("button", {
      type: "button", class: "exp-btn param-bigta-btn",
      title: "展开编辑", "aria-label": "展开编辑",
    }, msym("open_in_full"));
    btn.addEventListener("click", () => {
      openExpandModal(ta.value, (value) => {
        ta.value = value;
        commitRecipeParam(node, d, value);
      }, { modalTitle: d.label, cancelLabel: "取消", saveLabel: "保存" });
    });
    wrap.append(el("label", { for: inputId }, d.label),
      el("div", { class: "param-bigbox" + (secretTa ? " secret-field" : "") },
        ta, secretTa ? recipeSecretEyeButton(() => ta, { defaultHidden: true }) : null, btn));
  } else if (d.type === "image") {
    // 图片参数：值保持字符串（dataURL/base64），可选文件或直接拖入。
    const inp = el("input", { type: "text", id: inputId, placeholder: d.placeholder || "", spellcheck: "false", autocomplete: "off" });
    inp.value = node.params[d.key] ?? "";
    const preview = el("img", { class: "recipe-param-img-preview", alt: "" });
    const syncPreview = () => {
      const v = String(inp.value || "");
      if (/^data:image\//i.test(v)) { preview.src = v; preview.style.display = ""; }
      else { preview.removeAttribute("src"); preview.style.display = "none"; }
    };
    syncPreview();
    const setFrom = (file) => {
      if (!file) return;
      const rd = new FileReader();
      rd.onload = () => {
        inp.value = String(rd.result || "");
        commitRecipeParam(node, d, inp.value);
        syncPreview();
      };
      rd.readAsDataURL(file);
    };
    inp.addEventListener("input", () => { commitRecipeParam(node, d, inp.value); syncPreview(); });
    const fi = el("input", { type: "file", accept: "image/*" });
    fi.style.display = "none";
    fi.addEventListener("change", () => setFrom(fi.files && fi.files[0]));
    const btn = el("button", {
      type: "button", class: "exp-btn param-bigta-btn",
      title: tt("ui.op.pickFile"), "aria-label": tt("ui.op.pickFile"),
    }, msym("upload"));
    btn.addEventListener("click", () => fi.click());
    inp.addEventListener("dragover", (e) => { e.preventDefault(); inp.classList.add("dragover"); });
    inp.addEventListener("dragleave", () => inp.classList.remove("dragover"));
    inp.addEventListener("drop", (e) => {
      e.preventDefault(); inp.classList.remove("dragover");
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) setFrom(f);
    });
    wrap.append(el("label", { for: inputId }, d.label), el("div", { class: "param-bigbox" }, inp, btn), fi, preview);
  } else if (d.type === "password") {
    // 口令类（type:"password"）：M3 遮罩 + 小眼睛，与主 op 页 renderParam 同口径。
    const inp = makeRecipeMaskedInput({ id: inputId, placeholder: d.placeholder || "", autocomplete: "off", spellcheck: "false" });
    inp.value = node.params[d.key] ?? "";
    inp.addEventListener("input", () => commitRecipeParam(node, d, inp.value));
    wrap.append(el("label", { for: inputId }, d.label),
      el("div", { class: "param-bigbox secret-field" }, inp, recipeSecretEyeButton(() => inp, { defaultHidden: true })));
  } else if (d.ui === "expandable" || EXPANDABLE_KEYS.has(d.key)) {
    // 长文本：复用通用可展开输入框（内部自带 editHistory 与 modal 样式）。
    const box = expandableInput({
      id: inputId, type: "text", value: node.params[d.key] ?? "", placeholder: d.placeholder || "",
      title: "展开编辑", modalTitle: d.label, cancelLabel: "取消", saveLabel: "保存",
      onInput: (v) => commitRecipeParam(node, d, v),
    });
    const secretKey = !!d.sensitive || RECIPE_SECRET_KEY_RE.test(String(d.key || ""));
    if (secretKey) {
      const defaultHidden = !!d.sensitive;
      const expInput = box.querySelector(".exp-input");
      if (RECIPE_MASK_CSS_SUPPORTED && expInput) expInput.dataset.maskCss = "1";
      if (defaultHidden && expInput) expInput.classList.add("is-masked");
      wrap.append(el("label", { for: inputId }, d.label),
        el("div", { class: "param-bigbox secret-field" }, box, recipeSecretEyeButton(() => expInput, { defaultHidden })));
    } else {
      wrap.append(el("label", { for: inputId }, d.label), box);
    }
  } else {
    const keySecret = RECIPE_SECRET_KEY_RE.test(String(d.key || ""));
    const maskText = !!d.sensitive;
    const revealText = !d.sensitive && keySecret;
    const inp = maskText
      ? makeRecipeMaskedInput({ id: inputId, placeholder: d.placeholder || "", autocomplete: "off", spellcheck: "false" })
      : el("input", { type: "text", id: inputId, placeholder: d.placeholder || "" });
    inp.value = node.params[d.key] ?? "";
    inp.addEventListener("input", () => commitRecipeParam(node, d, inp.value));
    let dl = null;
    if (Array.isArray(d.datalist) && d.datalist.length) {
      const dlId = inputId + "_dl";
      dl = el("datalist", { id: dlId });
      for (const v of d.datalist) dl.append(el("option", { value: String(v) }));
      inp.setAttribute("list", dlId);
    }
    if (maskText) wrap.append(el("label", { for: inputId }, d.label), el("div", { class: "param-bigbox secret-field" }, inp, recipeSecretEyeButton(() => inp, { defaultHidden: true })));
    else if (revealText) wrap.append(el("label", { for: inputId }, d.label), el("div", { class: "param-bigbox secret-field" }, inp, recipeSecretEyeButton(() => inp, { defaultHidden: false })));
    else wrap.append(el("label", { for: inputId }, d.label), inp);
    if (dl) wrap.append(dl);
  }
  return wrap;
}

// ---- 执行链：顺序跑，防竞态；错误定位到步、保留已完成前缀 ----
let _seq = 0;

function setRunStatus(text, tone) {
  const s = document.getElementById("recipeRunStatus");
  if (!s) return;
  s.textContent = text || "";
  s.style.color = tone === "error" ? "var(--error)" : tone === "warn" ? "var(--warning)" : "";
}
// 配方页 Magic：主入口暴露 __ebctfRecipeMagic，本页负责「输入选择 → 候选映射 → 展示/应用」。
// 文件链绝不拿占位文案跑 Magic：能无损解成 UTF-8 文本才用，否则显式拒绝并提示。
function magicInputText() {
  if (rState.file && rState.file.bytes) {
    try { return { ok: true, text: _decodeUtf8Fatal(rState.file.bytes), fromFile: true }; }
    catch { return { ok: false, error: tt("ui.recipe.magicNeedText") }; }
  }
  if (rState.inputKind === "file" || rState.fileMissing) {
    return { ok: false, error: tt("ui.recipe.magicNeedText") };
  }
  return { ok: true, text: String(rState.input || ""), fromFile: false };
}
let _magicMenu = null;
function closeMagicMenu() {
  if (_magicMenu) { _magicMenu.remove(); _magicMenu = null; }
  document.removeEventListener("pointerdown", _magicOutside, true);
  document.removeEventListener("keydown", _magicKey, true);
}
function _magicOutside(e) {
  if (_magicMenu && !_magicMenu.contains(e.target)) closeMagicMenu();
}
function _magicKey(e) { if (e.key === "Escape") closeMagicMenu(); }
function magicStepLabel(node) {
  const op = getOp(node.opId);
  const name = op ? opDisplayName(op) : node.opId;
  let params = "";
  try {
    const entries = Object.entries(node.params || {}).slice(0, 3);
    if (entries.length) params = "(" + entries.map(([k, v]) => `${k}=${String(v)}`).join(", ") + ")";
  } catch { /* 忽略展示失败 */ }
  return name + "·" + dirLabel(node.dir) + params;
}
function showMagicCandidates(items, ctx, anchor) {
  closeMagicMenu();
  const valid = items.filter((x) => x.mapped.ok);
  const invalid = items.filter((x) => !x.mapped.ok);
  const menu = el("div", {
    class: "fam-pick-menu recipe-magic-menu", role: "menu",
    "aria-label": tf("ui.recipe.magicCandidates", valid.length),
  },
    el("div", { class: "fam-pick-head" }, tf("ui.recipe.magicCandidates", valid.length)),
    ...valid.map((it, idx) => {
      const c = it.raw || {};
      const nodes = it.mapped.nodes;
      const label = (idx === 0 ? tt("ui.recipe.magicBest") + " · " : "") +
        Math.round((Number(c.confidence) || 0) * 100) + "% · " + nodes.length + " 步";
      const steps = nodes.map(magicStepLabel).join(" → ");
      const preview = String(c.result == null ? "" : c.result).replace(/\s+/g, " ").slice(0, 160);
      return el("button", {
        class: "fam-pick-item recipe-magic-item", type: "button", "data-rank": String(idx + 1),
        title: steps,
        onclick: () => { closeMagicMenu(); applyMagicCandidate(nodes, ctx); },
      },
        el("span", { class: "fam-pick-name" }, label),
        el("span", { class: "fam-pick-cat recipe-magic-steps" }, steps),
        el("span", { class: "recipe-magic-preview" }, preview || "（空结果）"),
      );
    }),
    ...invalid.map((it) => el("div", { class: "recipe-magic-item invalid", "aria-disabled": "true" },
      el("span", { class: "fam-pick-name" }, tt("ui.recipe.magicInvalid")),
      el("span", { class: "fam-pick-cat recipe-magic-steps" }, it.mapped.error || ""),
    )),
  );
  document.body.append(menu);
  const vw = window.innerWidth, vh = window.innerHeight;
  const mr = menu.getBoundingClientRect();
  const ar = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
  const left = ar ? ar.left : 20;
  const top = ar ? ar.bottom + 4 : 20;
  menu.style.left = Math.max(8, Math.min(left, vw - mr.width - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(top, vh - mr.height - 8)) + "px";
  _magicMenu = menu;
  document.addEventListener("pointerdown", _magicOutside, true);
  document.addEventListener("keydown", _magicKey, true);
}
function applyMagicCandidate(nodes, ctx) {
  if (!nodes || !nodes.length) return;
  // 候选来自文件文本时，链头必须切成文本；否则 runChain 会因 fileHeadChanged 拒绝执行。
  if (ctx && ctx.fromFile) {
    rState.file = null;
    rState.fileMeta = null;
    rState.fileMissing = false;
    rState.inputKind = "text";
    rState.input = String(ctx.text || "");
  }
  pushReplaceSnapshot("magic");
  rState.nodes = nodes.map((n) => ({
    uid: "r" + (++_uidSeq),
    opId: n.opId,
    dir: n.dir,
    params: cloneParamValue(n.params || {}),
  }));
  // 历史是「状态序列」：压入替换后的新状态，undo 才会回到上一份（替换前）快照。
  recordStructure("magic");
  resetStepSession();
  renderRecipe();
  maybeRunChain();
  setRunStatus(ctx && ctx.fromFile
    ? tt("ui.recipe.magicFileApplied")
    : tf("ui.recipe.magicApplied", nodes.length), "normal");
}
async function runRecipeMagic(anchor) {
  const api = window.__ebctfRecipeMagic;
  if (typeof api !== "function") {
    setRunStatus("Magic 需要主入口钩子（见 T750/A2.md）", "warn");
    return;
  }
  const src = magicInputText();
  if (!src.ok) { setRunStatus(src.error, "warn"); return; }
  if (!src.text.trim()) { setRunStatus("Magic 输入为空", "warn"); return; }
  setRunStatus("Magic 识别中…", "normal");
  let cands = [];
  try {
    cands = await api(src.text, { maxDepth: 2, timeBudget: 5000 });
  } catch (e) {
    setRunStatus("Magic 失败：" + (e && e.message ? e.message : e), "error");
    return;
  }
  if (!Array.isArray(cands) || !cands.length) {
    setRunStatus(tt("ui.recipe.magicNoCandidates"), "warn");
    return;
  }
  const items = cands.map((c) => ({
    raw: c,
    mapped: mapMagicCandidateToRecipe(c && c.steps),
  }));
  const valid = items.filter((x) => x.mapped.ok);
  if (!valid.length) {
    setRunStatus(tt("ui.recipe.magicNoCandidates") + "：" + (items[0] && items[0].mapped.error || ""), "warn");
    return;
  }
  showMagicCandidates(items, src, anchor);
  setRunStatus(tf("ui.recipe.magicCandidates", valid.length) + "：选择一条应用（第一条为最优推荐）", "normal");
}

function opNameOfNode(node) {
  if (isControlNode(node)) return controlShortName(node);
  const op = node ? getOp(node.opId) : null;
  return op ? opDisplayName(op) : (node && node.opId) || "?";
}
function stepControlInfo(step) {
  if (!step || !step.control) return "";
  if (step.control === "fork" && step.branchCount != null) return ` · ${step.branchCount} 条分支`;
  if (step.control === "merge") return step.branchCount != null ? ` · 合并 ${step.branchCount} 条分支` : " · 合并";
  if (step.control === "register") {
    return step.matched ? ` · 捕获 ${step.registerCount} 组` : " · 未匹配（数据照常通过）";
  }
  if ((step.control === "jump" || step.control === "conditionalJump") && step.jumped) {
    return ` · 跳到「${step.label || "?"}」`;
  }
  if (step.control === "return") return " · 提前返回";
  if (step.control === "label") return " · 标签落点";
  return "";
}
function stepRow(step) {
  const name = opNameOfNode(rState.nodes[step.index]);
  const head = tf("ui.recipe.stepResult", step.index + 1, name) + stepControlInfo(step)
    + (step.skipped ? " " + tt("ui.recipe.stepSkipped") : "");
  const row = el("div", { class: "recipe-step" + (step.error ? " error" : ""), "data-step": String(step.index), "data-node": step.nodeId || "" },
    el("span", { class: "recipe-step-idx", style: step.error ? "color:var(--error)" : "" }, head),
    el("code", { class: "recipe-step-out", style: step.error ? "color:var(--error)" : "" }, step.error ? step.error : (step.text || "")),
  );
  return row;
}
function renderStepRows(steps) {
  const box = document.getElementById("recipeSteps");
  if (!box) return;
  box.replaceChildren(...(steps || []).map(stepRow));
}
function clearErrorNodes() {
  for (const c of document.querySelectorAll(".recipe-chain .recipe-node.error")) c.classList.remove("error");
}
function markErrorNode(nodeId) {
  clearErrorNodes();
  if (!nodeId) return;
  let card = document.querySelector('.recipe-node[data-uid="' + String(nodeId).replace(/"/g, '\\"') + '"]');
  if (!card) {
    const idx = rState.nodes.findIndex((n) => n.uid === nodeId);
    if (idx >= 0) card = document.querySelector('.recipe-node[data-idx="' + idx + '"]');
  }
  if (card) card.classList.add("error");
}
function renderOutFiles(result) {
  const filesBox = document.getElementById("recipeOutFiles");
  if (!filesBox) return;
  let files = [];
  try { files = recipeFileEntries(result); } catch { files = []; }
  filesBox.replaceChildren(...files.map((f) => el("button", {
    type: "button", class: "file-section-act",
    onclick: () => cloudWarnGate(() => downloadBytes(f.bytes, f.name, f.mime)),
  }, msym("download"), `${f.name} (${fmtByteSize(f.bytes.length)})`)));
}
function updateRunUi() {
  const bake = document.getElementById("recipeBake");
  if (bake) {
    bake.replaceChildren(msym(_running ? "stop" : "play_arrow"), document.createTextNode(" " + (_running ? tt("ui.recipe.cancel") : tt("ui.recipe.bake"))));
    bake.classList.toggle("pending", !_running && _pending);
    bake.setAttribute("aria-busy", _running ? "true" : "false");
  }
  const resume = document.getElementById("recipeResume");
  if (resume) resume.style.display = (!_running && _lastRun && _lastRun.reason === "breakpoint") ? "" : "none";
  reflectPending();
  updateHistoryButtons();
}
function requestCancel() {
  if (!_running) return;
  _cancelRequested = true;
  setRunStatus(tt("ui.recipe.cancelRequested"), "warn");
}
function resumeRun() {
  if (_running || !_lastRun || _lastRun.reason !== "breakpoint") return;
  const pauseAt = Math.max(0, Math.min(_lastRun.stoppedAt, Math.max(0, rState.nodes.length - 1)));
  // 分支内断点：resumeAt 退回最外层 Fork（整段分支重算）；ignoreBreakIndex 仍是真实断点步，
  // 否则续跑会立刻卡在同一个断点上。
  const at = Number.isInteger(_lastRun.resumeAt)
    ? Math.max(0, Math.min(_lastRun.resumeAt, Math.max(0, rState.nodes.length - 1)))
    : pauseAt;
  runChain({
    manual: true,
    startAt: at,
    seedOutputs: _lastRun.outputs,
    seedRegisters: _lastRun.registers,
    seedFlow: at === pauseAt ? _lastRun.flow : null,
    initialSteps: _lastRun.steps,
    ignoreBreakIndex: pauseAt,
  });
}
function stepRun() {
  if (_running) return;
  const total = rState.nodes.length;
  if (!total) return;
  if (!_stepSession || _stepSession.cursor >= total) {
    _stepSession = { cursor: 0, outputs: new Map(), steps: [], registers: [], flow: null };
  }
  runChain({
    manual: true,
    step: true,
    startAt: _stepSession.cursor,
    endAt: _stepSession.cursor,
    seedOutputs: _stepSession.outputs,
    seedRegisters: _stepSession.registers,
    seedFlow: _stepSession.flow,
    initialSteps: _stepSession.steps,
    respectBreakpoints: false,
  });
}
function updateHistoryButtons() {
  const u = document.getElementById("recipeUndo");
  const r = document.getElementById("recipeRedo");
  if (u) u.disabled = !structureHistory.canUndo();
  if (r) r.disabled = !structureHistory.canRedo();
}

async function runChain(opts = {}) {
  const out = document.getElementById("recipeOut");
  const stepsBox = document.getElementById("recipeSteps");
  if (!out) return false;
  clearTimeout(_runTimer);
  _runTimer = null;
  if (_running || _loadingOps) {
    setStale("running");
    setRunStatus(tt("ui.recipe.staleRunning"), "warn");
    return false;
  }

  if (!rState.nodes.length) {
    out.value = "";
    if (stepsBox) stepsBox.innerHTML = "";
    renderOutFiles(null);
    rState.runState = "idle";
    clearStale();
    resetStepSession();
    setRunStatus("");
    updateRunUi();
    return true;
  }
  if (rState.input === "" && !rState.file && rState.inputKind !== "file") {
    out.value = "";
    if (stepsBox) stepsBox.innerHTML = "";
    renderOutFiles(null);
    clearStale();
    setRunStatus("");
    updateRunUi();
    return true;
  }
  if (rState.fileMissing && !rState.file) {
    out.value = "";
    if (stepsBox) stepsBox.innerHTML = "";
    setRunStatus(tt("ui.recipe.fileMissing"), "error");
    setStale("fileMissing");
    updateRunUi();
    return false;
  }

  // 惰载 op 先补真实模块，再建执行图/校验；失败不吞，执行时会给明确 op 错误。
  _loadingOps = true;
  try { await ensureChainOpsLoaded(); } finally { _loadingOps = false; }
  normalizeNodeDirs();
  const graph = toGraph();
  const v = validateRecipe(graph);
  if (!v.ok) {
    out.value = "";
    out.classList.remove("error");
    if (stepsBox) {
      stepsBox.innerHTML = "";
      stepsBox.append(el("div", { class: "recipe-err", style: "color:var(--error);display:flex;align-items:center;gap:6px;padding:8px" }, msym("cancel"), el("span", {}, tt("ui.recipe.validateFail") + v.errors.join("; "))));
    }
    setRunStatus(tt("ui.recipe.validateFail") + v.errors.join("; "), "error");
    updateRunUi();
    return false;
  }

  const total = graph.nodes.length;
  let startAt = Number.isInteger(opts.startAt) ? Math.max(0, Math.min(opts.startAt, total - 1)) : 0;
  let endAt = Number.isInteger(opts.endAt) ? Math.max(0, Math.min(opts.endAt, total - 1)) : total - 1;
  let seedOutputs = opts.seedOutputs;
  let seedRegisters = Array.isArray(opts.seedRegisters) ? opts.seedRegisters : undefined;
  let seedFlow = opts.seedFlow == null ? null : String(opts.seedFlow);
  let initialSteps = Array.isArray(opts.initialSteps) ? opts.initialSteps.slice() : [];
  let stepMode = !!opts.step;
  if (stepMode) {
    if (!_stepSession || _stepSession.cursor >= total) {
      _stepSession = { cursor: 0, outputs: new Map(), steps: [], registers: [], flow: null };
    }
    startAt = _stepSession.cursor;
    endAt = startAt;
    seedOutputs = _stepSession.outputs;
    seedRegisters = _stepSession.registers;
    seedFlow = _stepSession.flow;
    initialSteps = _stepSession.steps.slice();
  } else {
    resetStepSession();
  }
  if (startAt > endAt) {
    setRunStatus(tt("ui.recipe.stepEnd"), "warn");
    updateRunUi();
    return false;
  }

  // 链头文件通道：拖入文件时 input 是占位提示文案，真字节另走 bytes（见 core/recipe.js）。
  // 从链中段起跑时没有「链头」概念，直接把字节交给 resolveRecipeHead（非 acceptsBytes 会拿到 hex）。
  if (rState.file && startAt === 0 && !chainHeadAcceptsBytes()) {
    out.value = "";
    if (stepsBox) stepsBox.innerHTML = "";
    setRunStatus(tt("ui.recipe.fileHeadChanged"), "error");
    setStale("fileMissing");
    updateRunUi();
    return false;
  }
  const chainInput = rState.file
    ? (startAt === 0 ? { text: rState.input, bytes: rState.file.bytes } : rState.file.bytes)
    : rState.input;

  // 断点：从 startAt 起第一个启用节点；ignoreBreakIndex 用于「继续」时不原地卡住。
  const ignoreBreak = Number.isInteger(opts.ignoreBreakIndex) ? opts.ignoreBreakIndex : -1;
  let breakAt = -1;
  if (opts.respectBreakpoints !== false) {
    for (let i = startAt; i <= endAt; i++) {
      const n = rState.nodes[i];
      if (n && n.breakpoint && !n.disabled && i !== ignoreBreak) { breakAt = i; break; }
    }
  }

  const seq = ++_seq;
  _running = true;
  _cancelRequested = false;
  rState.runState = "running";
  clearStale();
  setRunStatus(tt("ui.recipe.running"), "normal");
  updateRunUi();

  const liveSteps = [];
  const onStep = (step) => {
    if (seq !== _seq) return;
    liveSteps.push(step);
    if (stepMode) {
      renderStepRows(initialSteps.concat(liveSteps));
    } else if (rState.showSteps) {
      const box = document.getElementById("recipeSteps");
      if (box) box.append(stepRow(step));
    }
  };

  let result;
  try {
    result = await executeRecipeSteps(graph, chainInput, {
      startAt,
      endAt,
      seedOutputs,
      registers: seedRegisters,
      seedFlow,
      skipDisabled: true,
      shouldStop: () => _cancelRequested || seq !== _seq,
      shouldBreakBefore: (pos) => pos === breakAt,
      budgetMs: RUN_BUDGET_MS,
      stepTimeoutMs: STEP_TIMEOUT_MS,
      onStep,
    });
  } catch (e) {
    _running = false;
    _cancelRequested = false;
    rState.runState = "idle";
    out.value = "";
    if (stepsBox) {
      stepsBox.innerHTML = "";
      stepsBox.append(el("div", { class: "recipe-err", style: "color:var(--error);display:flex;align-items:center;gap:6px;padding:8px" }, msym("cancel"), el("span", {}, e && e.message ? e.message : tt("ui.recipe.execFail"))));
    }
    setRunStatus((e && e.message) || tt("ui.recipe.execFail"), "error");
    updateRunUi();
    return false;
  }

  _running = false;
  _cancelRequested = false;
  _lastRun = result;
  const doneOrStopped = result.reason === "ok";
  rState.runState = result.reason === "breakpoint" ? "paused" : "idle";

  // 出错 / 取消 / 超时 / 断点：绝不清空已完成前缀；输出区显示前缀终值。
  if (doneOrStopped) {
    out.value = recipeTerminalText(result.terminal);
    renderOutFiles(result.terminal);
    out.classList.remove("error");
    clearErrorNodes();
    if (!rState.showSteps && !stepMode && stepsBox) stepsBox.innerHTML = "";
  } else {
    out.value = recipeTerminalText(result.terminal);
    renderOutFiles(result.terminal);
    out.classList.remove("error");
    if (stepsBox) {
      if (stepMode) renderStepRows(initialSteps.concat(result.steps));
      else if (!rState.showSteps || result.steps.length < liveSteps.length) renderStepRows(result.steps);
      else if (!stepsBox.childElementCount) renderStepRows(result.steps);
    }
  }

  if (result.reason === "exec-error" || result.reason === "timeout" || result.reason === "budget") {
    markErrorNode(result.errorNodeId);
    const idx = result.errorIndex >= 0 ? result.errorIndex : Math.max(0, result.stoppedAt);
    const name = opNameOfNode(rState.nodes[idx]);
    const msg = result.error || tt("ui.recipe.execFail");
    const prefix = result.reason === "budget" ? tt("ui.recipe.controlBudget") + "：" : "";
    setRunStatus(prefix + tf("ui.recipe.errorAt", idx + 1, name, msg) + " " + tt("ui.recipe.errorNode"), "error");
  } else if (result.reason === "breakpoint") {
    clearErrorNodes();
    setRunStatus(tf("ui.recipe.pausedAt", result.stoppedAt + 1), "warn");
  } else if (result.reason === "cancelled") {
    clearErrorNodes();
    setRunStatus(tt("ui.recipe.cancelled"), "warn");
  } else if (stepMode) {
    clearErrorNodes();
    // nextCursor 由执行器给出：Fork 一次吃掉整段分支、Jump 落在目标标签，不能用 startAt+1 硬推。
    const s = _stepSession || { cursor: startAt, outputs: result.outputs, steps: initialSteps, registers: result.registers || [], flow: result.flow };
    s.outputs = result.outputs;
    s.steps = initialSteps.concat(result.steps);
    s.registers = result.registers || [];
    s.flow = result.flow == null ? null : result.flow;
    const next = Number.isInteger(result.nextCursor) ? result.nextCursor : startAt + 1;
    s.cursor = Math.max(0, Math.min(total, next));
    _stepSession = s;
    setRunStatus(s.cursor >= total ? tt("ui.recipe.stepEnd") : tt("ui.recipe.stepDone"), "normal");
  } else if (result.returned) {
    clearErrorNodes();
    setRunStatus(tt("ui.recipe.controlReturned") + " · " + tf("ui.recipe.done", Math.round(result.elapsedMs)), "normal");
  } else {
    clearErrorNodes();
    setRunStatus(tf("ui.recipe.done", Math.round(result.elapsedMs)), "normal");
  }

  updateRunUi();
  // 运行中有改动（_pending）→ 结束后最多补跑一次；条件不满足时 maybeRunChain 只会继续标 stale。
  if (result.reason !== "cancelled" && _pending) {
    setTimeout(() => { if (!_running) maybeRunChain(); }, 30);
  }
  return result.reason === "ok";
}

// ---- 样式 / 帮助 / 键盘 ----
function ensureRecipeStyle() {
  if (document.getElementById("recipeT750Style")) return;
  const st = document.createElement("style");
  st.id = "recipeT750Style";
  st.textContent = `
.recipe-node.disabled { opacity: .58; }
.recipe-node.disabled .recipe-node-name { text-decoration: line-through; }
.recipe-node.breakpoint { border-inline-start-color: var(--warning); }
.recipe-node.focused { outline: 2px solid var(--primary); outline-offset: 2px; }
.recipe-node.error .recipe-node-name { color: var(--error); }
.recipe-step.error { background: color-mix(in srgb, var(--error) 10%, var(--surface-2)); }
.recipe-mini-btn.active { color: var(--warning); }
.recipe-mini-btn:disabled { opacity: .4; cursor: not-allowed; }
.recipe-run-status { font-size: var(--fs-xs); color: var(--on-surface-var); max-width: 34rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 860px) { .recipe-run-status { flex-basis: 100%; white-space: normal; } }
.recipe-help-overlay { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgba(0,0,0,.45); }
.recipe-help-card { max-width: 560px; width: 100%; max-height: 80vh; overflow: auto; padding: 18px 20px; background: var(--surface-1); color: var(--on-surface); border: 1px solid var(--outline-var); border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.35); }
.recipe-help-card h3 { margin: 0 0 10px; font-size: 16px; }
.recipe-help-card pre { margin: 0; white-space: pre-wrap; font-family: var(--mono); font-size: 13px; line-height: 1.7; color: var(--on-surface-var); }
.recipe-node-badge { display: inline-flex; align-items: center; color: var(--primary); }
.recipe-node-badge .msym { width: 18px; height: 18px; }
.recipe-control { border-inline-start: 3px solid var(--primary); }
.recipe-control .recipe-node-name { font-weight: 600; }
.recipe-control-note { margin: 2px 0 6px; font-size: var(--fs-xs); line-height: 1.5; color: var(--on-surface-var); }
.recipe-control-note.warn { color: var(--warning); }
.recipe-node.in-subsection { margin-inline-start: 22px; position: relative; }
.recipe-node.in-subsection::before { content: ""; position: absolute; inset-inline-start: -13px; top: 6px; bottom: 6px; border-inline-start: 2px solid var(--outline-var); }
.recipe-subsection-fold { align-self: flex-start; display: inline-flex; align-items: center; gap: 6px; margin-inline-start: 22px; padding: 6px 10px; border: 1px dashed var(--outline-var); border-radius: 10px; background: transparent; color: var(--on-surface-var); cursor: pointer; font: inherit; font-size: var(--fs-xs); }
.recipe-subsection-fold:hover { background: var(--surface-2); }
.recipe-control-menu { min-width: 280px; max-width: min(92vw, 560px); }
.recipe-control-menu .fam-pick-item { align-items: flex-start; }
.recipe-control-menu .fam-pick-cat { font-family: inherit; max-width: 300px; text-align: end; line-height: 1.45; }
`;
  document.head.append(st);
}

let _helpOverlay = null;
function closeRecipeHelp() {
  if (_helpOverlay) { _helpOverlay.remove(); _helpOverlay = null; }
}
function showRecipeHelp() {
  closeRecipeHelp();
  const overlay = el("div", { class: "recipe-help-overlay", role: "dialog", "aria-modal": "true", "aria-label": tt("ui.recipe.helpTitle") });
  const card = el("div", { class: "recipe-help-card" },
    el("h3", {}, tt("ui.recipe.helpTitle")),
    el("pre", {}, tt("ui.recipe.helpBody")),
    el("button", { class: "recipe-clear-btn", style: "margin-top:12px", onclick: closeRecipeHelp }, tt("ui.recipe.close") || "关闭"),
  );
  overlay.append(card);
  overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) closeRecipeHelp(); });
  document.body.append(overlay);
  _helpOverlay = overlay;
}

const TEXT_EDIT_SELECTOR = ".io-area, input, textarea, select, [contenteditable='true'], .cm-editor, .cm-content";
function isTextEditingTarget(t) {
  return !!(t && t.closest && t.closest(TEXT_EDIT_SELECTOR));
}
function recipeViewActive() {
  return (location.hash === "#/recipe" || location.hash.startsWith("#/recipe?"))
    && !!document.getElementById("recipeChain");
}
function activeNodeIndex() {
  const t = document.activeElement;
  const card = t && t.closest ? t.closest(".recipe-node") : null;
  if (card) return Number(card.dataset.idx);
  if (_focusedNodeUid) {
    const idx = rState.nodes.findIndex((n) => n.uid === _focusedNodeUid);
    if (idx >= 0) return idx;
  }
  return _focusedNodeIndex;
}
let _globalKeyBound = false;
function ensureGlobalKeyHandler() {
  if (_globalKeyBound) return;
  _globalKeyBound = true;
  document.addEventListener("keydown", onGlobalRecipeKey, true);
}
function onGlobalRecipeKey(e) {
  if (!recipeViewActive()) return;
  const mod = e.ctrlKey || e.metaKey;
  const key = String(e.key || "").toLowerCase();

  if (e.key === "F1") { e.preventDefault(); showRecipeHelp(); return; }
  if (e.key === "Escape") { if (_helpOverlay) { e.preventDefault(); closeRecipeHelp(); } return; }
  if (mod && e.key === "Enter") {
    e.preventDefault();
    if (_running) requestCancel(); else runChain({ manual: true });
    return;
  }
  if (mod && e.altKey && (e.key === " " || e.code === "Space")) {
    e.preventDefault();
    if (_running) requestCancel(); else runChain({ manual: true });
    return;
  }

  // 文本/参数输入框内保持原生撤销、删除、方向键语义，绝不抢 editHistory 的 Ctrl+Z。
  if (isTextEditingTarget(e.target)) return;

  // Windows 中文/部分布局下 Ctrl+Alt+D 会生成 AltGr 字符（如 ð），同时看 code 才稳。
  if (mod && e.altKey && (key === "b" || e.code === "KeyB")) {
    e.preventDefault();
    const i = activeNodeIndex();
    if (i >= 0) toggleBreakpoint(i);
    return;
  }
  if (mod && e.altKey && (key === "d" || e.code === "KeyD")) {
    e.preventDefault();
    const i = activeNodeIndex();
    if (i >= 0) toggleDisabled(i);
    return;
  }
  if (mod && !e.altKey && key === "z") {
    e.preventDefault();
    if (e.shiftKey) redoStructure(); else undoStructure();
    return;
  }
  if (mod && !e.altKey && key === "y") { e.preventDefault(); redoStructure(); return; }
  if (e.key === "F9") {
    e.preventDefault();
    const i = activeNodeIndex();
    if (i >= 0) toggleBreakpoint(i);
    return;
  }

  const focusCard = e.target && e.target.closest ? e.target.closest(".recipe-node") : null;
  if (focusCard && e.altKey && !mod && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    e.preventDefault();
    moveNode(Number(focusCard.dataset.idx), e.key === "ArrowUp" ? -1 : 1);
    return;
  }
  if (focusCard && e.key === "Delete") {
    e.preventDefault();
    removeNode(Number(focusCard.dataset.idx));
    return;
  }
}

// ---- 主渲染：挂到传入的容器 ----
// 模块级缓存首屏拿到的 host。index.html 无 #recipeHost
// 内部 mutation 函数均无参调用 renderRecipe，此前 host 为 null 直接 return → DOM 不重建。
let _recipeHost = null;
export function renderRecipe(container) {
  const host = container || _recipeHost || document.getElementById("recipeHost");
  if (!host) return;
  _recipeHost = host;   // 记住首次拿到的 host，供后续无参调用复用
  ensureNodeUids();
  ensureRecipeStyle();
  ensureGlobalKeyHandler();
  _focusedNodeIndex = _focusedNodeUid ? rState.nodes.findIndex((n) => n.uid === _focusedNodeUid) : -1;
  restoreOnce();
  host.innerHTML = "";

  const wrap = el("div", { class: "recipe-view" });
  // IME 守卫：ioArea 的 Enter 处理没有 isComposing 判断（该文件不在本任务改动范围）。
  // 在祖先捕获阶段拦下组合输入中的 Enter，避免中文候选确认被插入换行。
  wrap.addEventListener("keydown", (e) => {
    if ((e.isComposing || e.keyCode === 229) && e.key === "Enter"
      && e.target && e.target.closest && e.target.closest("#recipeIn, #recipeOut")) {
      e.stopImmediatePropagation();
    }
  }, true);

 // 标题
  wrap.append(el("div", { class: "op-head recipe-head" },
    el("div", { class: "recipe-head-main" },
      el("div", { class: "op-title" }, msym("account_tree"), tt("ui.recipe.title")),
      el("div", { class: "op-desc" }, tt("ui.recipe.desc")),
    ),
    el("button", {
      class: "recipe-help-btn", id: "recipeHelpBtn", type: "button",
      title: tt("ui.recipe.help"), "aria-label": tt("ui.recipe.help"),
      onclick: showRecipeHelp,
    }, msym("info"), el("span", {}, tt("ui.recipe.helpShort"))),
  ));

 // 工具条：按「构建 / 执行 / 编辑 / 管理」分行，避免所有按钮挤成一排
  const bar = el("div", { class: "recipe-bar" });
  const buildRow = el("div", { class: "recipe-bar-row recipe-bar-build" });
  const runRow = el("div", { class: "recipe-bar-row recipe-bar-run" });
  const editRow = el("div", { class: "recipe-bar-row recipe-bar-edit" });
  const storeRow = el("div", { class: "recipe-bar-row recipe-bar-store" });
  bar.append(buildRow, runRow, editRow, storeRow);
  buildRow.append(el("span", { class: "recipe-bar-label" }, tt("ui.recipe.groupBuild")));
  runRow.append(el("span", { class: "recipe-bar-label" }, tt("ui.recipe.groupRun")));
  editRow.append(el("span", { class: "recipe-bar-label" }, tt("ui.recipe.groupEdit")));
  storeRow.append(el("span", { class: "recipe-bar-label" }, tt("ui.recipe.groupStore")));
  const presetSel = el("select", { class: "recipe-preset-picker" });
  presetSel.append(el("option", { value: "" }, tt("ui.recipe.loadPreset")));
  for (const p of PRESETS) presetSel.append(el("option", { value: p.id, title: p.desc || "" }, p.name));
  presetSel.addEventListener("change", () => { if (presetSel.value) { loadPreset(presetSel.value); presetSel.value = ""; } });
  buildRow.append(presetSel);
  buildRow.append(buildOpSearchPicker(addNode));
  // CC-A5：控制节点入口。放在操作搜索器旁，和「添加操作」同层级，避免只有内核没有 UI。
  buildRow.append(el("button", {
    class: "recipe-clear-btn", id: "recipeControlBtn",
    title: tt("ui.recipe.controlMenuTitle"),
    onclick: (e) => openControlMenu(e.currentTarget),
  }, msym("account_tree"), " " + tt("ui.recipe.controlMenu")));
  const stepChk = el("input", { type: "checkbox", id: "recipeStepToggle" });
  stepChk.checked = rState.showSteps;
  stepChk.addEventListener("change", () => { rState.showSteps = stepChk.checked; maybeRunChain(); });
 // M3 修正：原 label 嵌套 label（HTML 违规，label 不能嵌套 label，会导致点击穿透/switch 失灵）
 // 改为 div 容器 + label.switch + span 文案，点击行为正确
  runRow.append(el("div", { class: "recipe-step-toggle" },
    el("label", { class: "switch", for: "recipeStepToggle" }, stepChk, el("span", { class: "track" }), el("span", { class: "knob" })),
    el("span", {}, tt("ui.recipe.showSteps")),
  ));
  // T750：Auto Bake 开关。关闭 = 只标 stale，点 Bake / Ctrl+Enter 才跑。
  const autoChk = el("input", { type: "checkbox", id: "recipeAutoToggle" });
  autoChk.checked = rState.autoRunMode !== "manual";
  autoChk.addEventListener("change", () => {
    rState.autoRunMode = autoChk.checked ? "auto" : "manual";
    scheduleDraft();
    if (autoChk.checked) { clearStale(); maybeRunChain(); }
    else setStale("manual");
  });
  runRow.append(el("div", { class: "recipe-step-toggle" },
    el("label", { class: "switch", for: "recipeAutoToggle" }, autoChk, el("span", { class: "track" }), el("span", { class: "knob" })),
    el("span", {}, tt("ui.recipe.autoRun")),
  ));
  editRow.append(el("button", { class: "icon-btn recipe-mini-btn", id: "recipeUndo", title: tt("ui.recipe.undo"), "aria-label": tt("ui.recipe.undo"), onclick: undoStructure }, msym("undo")));
  editRow.append(el("button", { class: "icon-btn recipe-mini-btn", id: "recipeRedo", title: tt("ui.recipe.redo"), "aria-label": tt("ui.recipe.redo"), onclick: redoStructure }, msym("redo")));
  editRow.append(el("button", { class: "recipe-clear-btn", id: "recipeMagicBtn", title: "Magic 自动识别并生成配方", onclick: (e) => runRecipeMagic(e.currentTarget) }, msym("auto_awesome"), " Magic"));
  editRow.append(el("button", { class: "recipe-clear-btn", onclick: clearChain }, msym("delete_sweep"), " " + tt("ui.recipe.clear")));
  runRow.append(el("button", { class: "recipe-clear-btn", id: "recipeStepBtn", title: tt("ui.recipe.step"), onclick: stepRun }, msym("play_arrow"), " " + tt("ui.recipe.step")));
 // 配方导出/导入（自有 JSON 格式，非 CyberChef——op 命名体系不同无法互通）。
  storeRow.append(el("button", { class: "recipe-clear-btn", title: tt("ui.recipe.exportRecipe"), onclick: exportRecipe }, msym("download"), " " + tt("ui.recipe.exportRecipe")));
  storeRow.append(el("button", { class: "recipe-clear-btn", title: tt("ui.recipe.importRecipe"), onclick: importRecipe }, msym("content_paste"), " " + tt("ui.recipe.importRecipe")));
  // 分享/导出默认只带配方；输入可能直接是 flag/密钥，必须显式勾选才附带。
  const includeChk = el("input", { type: "checkbox", id: "recipeIncludeInput" });
  includeChk.checked = _includeInput;
  includeChk.addEventListener("change", () => { _includeInput = includeChk.checked; });
  storeRow.append(el("div", { class: "recipe-step-toggle", title: tt("ui.recipe.includeInputHint") },
    el("label", { class: "switch", for: "recipeIncludeInput" }, includeChk, el("span", { class: "track" }), el("span", { class: "knob" })),
    el("span", {}, tt("ui.recipe.includeInput")),
  ));

 // T698：命名存档 + 自动草稿；T699：分享链接（只进 hash，不发网络）。
  const savedSel = el("select", { class: "recipe-preset-picker recipe-saved-picker", title: tt("ui.recipe.loadSaved") });
  const refreshSaved = () => {
    savedSel.innerHTML = "";
    savedSel.append(el("option", { value: "" }, tt("ui.recipe.loadSaved")));
    for (const r of listSavedRecipes()) savedSel.append(el("option", { value: r.name }, r.name));
  };
  refreshSaved();
  savedSel.addEventListener("change", () => {
    if (!savedSel.value) return;
    const rec = listSavedRecipes().find((r) => r.name === savedSel.value);
    if (!rec) return;
    const r = applyRecipeData(rec.data);
    storeStatus.textContent = r.ok ? tt("ui.recipe.savedLoaded", rec.name) : r.error;
  });
  const saveBtn = el("button", { class: "recipe-clear-btn", title: tt("ui.recipe.saveRecipe"), onclick: () => {
    const name = window.prompt(tt("ui.recipe.savePrompt"), tt("ui.recipe.saveDefault", new Date().toISOString().slice(0, 16).replace("T", " ")));
    if (!name || !name.trim()) return;
    const okSave = saveNamedRecipe(name, serializeState());
    storeStatus.textContent = okSave ? tt("ui.recipe.savedOk", name.trim()) : tt("ui.recipe.saveFail");
    refreshSaved();
  } }, msym("save"), " " + tt("ui.recipe.saveRecipe"));
  const shareBtn = el("button", { class: "recipe-clear-btn", title: tt("ui.recipe.shareRecipe"), onclick: async () => {
    shareBtn.disabled = true;
    try {
      const data = serializeState({ includeInput: _includeInput });
      const r = await encodeShare(data, { includeInput: _includeInput });
      const url = buildShareUrl(r.code);
      let msg;
      if (r.fileOmitted) msg = tf("ui.recipe.shareFileOmitted", url.length);
      else if (r.inputOmitted) msg = tf("ui.recipe.shareRecipeOnly", url.length);
      else if (r.degraded) msg = tf("ui.recipe.shareDegraded", url.length);
      else msg = tf("ui.recipe.shareCopied", url.length);
      try { await navigator.clipboard.writeText(url); storeStatus.textContent = msg; }
      catch { storeStatus.textContent = url; }
    } catch (e) {
      storeStatus.textContent = e && e.message ? e.message : tt("ui.recipe.shareFail");
    } finally { shareBtn.disabled = false; }
  } }, msym("link"), " " + tt("ui.recipe.shareRecipe"));
  const storeStatus = el("span", { class: "recipe-store-status" });
  storeRow.append(saveBtn, savedSel, shareBtn, storeStatus);
 // 手动执行按钮「执行！（Bake！）」——致敬 CyberChef。大输入下自动重跑闸门关闭，靠它强制跑全链。
 // .pending 类由 reflectPending 切换（大输入有挂起改动时高亮提示「该点我了」）。
 // 运行中同一按钮变「取消」；同步 op 无法中途打断，取消在步骤间生效。
  const bakeBtn = el("button", {
    class: "recipe-bake-btn", id: "recipeBake",
    onclick: () => { if (_running) requestCancel(); else runChain({ manual: true }); },
  }, msym("play_arrow"), " " + tt("ui.recipe.bake"));
  const resumeBtn = el("button", { class: "recipe-clear-btn", id: "recipeResume", style: "display:none", onclick: resumeRun },
    msym("play_arrow"), " " + tt("ui.recipe.resume"));
  const runStatus = el("span", { class: "recipe-run-status", id: "recipeRunStatus", role: "status", "aria-live": "polite" });
  runRow.append(bakeBtn, resumeBtn, runStatus);
  wrap.append(bar);

 // 输入
  wrap.append(el("label", { class: "recipe-io-label" }, tt("ui.recipe.inputLabel")));
  const inArea = ioArea({ class: "io-area recipe-io", id: "recipeIn", placeholder: tt("ui.recipe.inputPh") });
 // 链头文件按钮：放在构建行，音频/图像类预设靠它一把梭，无需手抄 hex
  buildRow.append(el("button", {
    type: "button", class: "recipe-clear-btn", title: tt("ui.recipe.pickFile"),
    onclick: () => pickChainFile(inArea),
  }, msym("attach_file"), " " + tt("ui.recipe.pickFile")));
  if (rState.fileMissing) inArea.setAttribute("data-placeholder", tt("ui.recipe.fileMissing"));
  inArea.value = rState.input;
 // 手动编辑输入 → 链头文件字节失效（与单 op 输入框同口径），避免 op 读到过期字节
  const onInputEdited = () => {
    rState.file = null;
    rState.fileMeta = null;
    rState.fileMissing = false;
    rState.inputKind = "text";
    rState.input = inArea.value;
    resetStepSession();
    maybeRunChain();
  };
  inArea.addEventListener("input", onInputEdited);
  attachChainDrop(inArea);
 // 编辑框记事本化——输入框挂工具条（粘贴/清空/字号/全选/导出 + Ctrl+A/S）+ 快捷键。
  wrap.append(attachEditorToolbar(inArea, { onChange: onInputEdited, exportName: "recipe-input.txt" }));
  wrap.append(inArea);

  if (rState.fileMissing || (rState.inputKind === "file" && rState.fileMeta)) {
    const meta = rState.fileMeta;
    const note = el("div", {
      class: "recipe-bake-hint",
      style: rState.fileMissing ? "color:var(--error)" : "",
    },
      msym(rState.fileMissing ? "warning" : "attach_file"),
      el("span", {}, rState.fileMissing
        ? tt("ui.recipe.fileMissing")
        : tf("ui.recipe.fileMeta", meta.name || "?", fmtByteSize(meta.size || 0))),
    );
    note.append(el("button", {
      type: "button", class: "recipe-clear-btn", style: "margin-inline-start:8px",
      onclick: () => { clearChainFile(); renderRecipe(); },
    }, tt("ui.recipe.clearFile")));
    wrap.append(note);
  }

 // 大输入挂起提示——超阈值时改动只标记待执行（不即时重跑），提示用户点工具条的 Bake 按钮。
 // 默认隐藏，reflectPending 控制显隐。Bake 按钮本体在工具条（id=recipeBake）。
  wrap.append(el("div", { class: "recipe-bake-hint", id: "recipeBakeHint", style: "display:none" },
    msym("info"), el("span", { id: "recipeBakeHintText" }, tt("ui.recipe.bakeHint"))));

 // 拖拽提示（常驻画布顶部，指引「左侧拖 op / 拖节点重排」）
  wrap.append(el("div", { class: "recipe-drag-hint" }, msym("drag_indicator"), el("span", {}, tt("ui.recipe.dragHint"))));

 // 链节点区
  const chain = el("div", { class: "recipe-chain", id: "recipeChain" });
  if (!rState.nodes.length) {
    chain.append(el("div", { class: "recipe-empty" }, tt("ui.recipe.empty")));
  } else {
    // Subsection 分组：组内节点缩进；折叠时隐藏到下一个 Subsection 前（只影响显示）。
    const marks = subsectionMarks();
    let rendered = 0;
    for (let i = 0; i < rState.nodes.length; i++) {
      const node = rState.nodes[i];
      if (rendered) chain.append(el("div", { class: "recipe-arrow" }, msym("arrow_downward")));
      const card = renderNodeCard(node, i);
      if (marks.indent[i]) card.classList.add("in-subsection");
      chain.append(card);
      rendered++;
      if (isControlNode(node) && node.control === "subsection" && node.params && node.params.collapsed) {
        const end = marks.end[i] == null ? rState.nodes.length : marks.end[i];
        const hidden = end - i - 1;
        if (hidden > 0) {
          // 必须捕获当前下标：下面会把 i 推到组尾，闭包若直接读 i 会指向组内最后一个节点。
          const subIdx = i;
          chain.append(el("button", {
            type: "button", class: "recipe-subsection-fold",
            onclick: () => toggleSubsectionCollapse(subIdx),
          }, msym("unfold_more"), " " + tf("ui.recipe.controlFold", hidden)));
          rendered++;
          i = end - 1;
        }
      }
    }
  }
 // 左侧菜单拖 op 进画布：dragover 高亮 + drop 追加/插入节点。
 // 仅响应带 OP_MIME 的拖拽（节点内部重排走 _dragFrom，不含该 MIME，此处不干预）。
  chain.addEventListener("dragover", (e) => {
    if (_dragFrom != null) return;                       // 内部重排进行中，交给节点卡处理
    if (!e.dataTransfer || !dtHasOpMime(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    chain.classList.add("recipe-drop-active");
  });
  chain.addEventListener("dragleave", (e) => {
 // 只在真正离开 chain（而非移入子元素）时移除高亮
    if (e.relatedTarget && chain.contains(e.relatedTarget)) return;
    chain.classList.remove("recipe-drop-active");
  });
  chain.addEventListener("drop", (e) => {
    if (_dragFrom != null) return;
    if (!e.dataTransfer || !dtHasOpMime(e.dataTransfer)) return;
    e.preventDefault();
    chain.classList.remove("recipe-drop-active");
    // 族条目（）：先弹选档菜单，选定具体算法再入链
    let famId = "";
    try { famId = e.dataTransfer.getData(FAM_MIME) || ""; } catch { /* ignore */ }
    if (famId) { openFamilyPicker(famId, e.clientX, e.clientY, dropIndexFromY(chain, e.clientY)); return; }
    const opId = e.dataTransfer.getData(OP_MIME);
    if (!opId) return;
    addNode(opId, dropIndexFromY(chain, e.clientY));
  });
  wrap.append(chain);

 // 每步结果（可选）
  wrap.append(el("div", { class: "recipe-steps", id: "recipeSteps" }));

 // 输出
  wrap.append(el("label", { class: "recipe-io-label" }, tt("ui.recipe.outputLabel")));
  const outArea = ioArea({ class: "io-area recipe-io", id: "recipeOut", readonly: true, placeholder: tt("ui.recipe.outputPh") });
 // 输出框接编辑器工具条（只读：复制/全选/导出/字号）
  wrap.append(attachEditorToolbar(outArea, { readonly: true, exportName: "recipe-output.txt" }));
  wrap.append(outArea);
  wrap.append(el("div", { class: "io-out-files", id: "recipeOutFiles" }));

  host.append(wrap);
  if (structureHistory.size() === 0) resetStructureHistory("init");
  updateRunUi();
  reflectPending();   // 重建后同步 Bake 高亮/挂起提示（大输入下切视图回来仍显挂起）
  maybeRunChain();    // 小输入即时跑；大输入只标记挂起等 Bake，避免重建即卡
}

// 供 main.js 触摸拖拽落点：命中配方链画布即添加（按 Y 定位插入，dropIndexFromY 返回 null 则追加末尾）
export function addRecipeOpAt(opId, clientX, clientY) {
  const chain = document.getElementById("recipeChain");
  if (!chain) return false;
  const idx = dropIndexFromY(chain, clientY);
  addNode(opId, idx);
  return true;
}

// 供 main.js 触摸拖拽族条目（）：命中画布即弹选档菜单
export function addRecipeFamilyAt(familyId, clientX, clientY) {
  const chain = document.getElementById("recipeChain");
  if (!chain) return false;
  openFamilyPicker(familyId, clientX, clientY, dropIndexFromY(chain, clientY));
  return true;
}

export function openRecipeFamilyAtTail(familyId, clientX, clientY) {
  if (!document.getElementById("recipeChain")) return false;
  openFamilyPicker(familyId, clientX, clientY, null);
  return true;
}

// ---- 族选档菜单（）：族条目拖入画布时选具体算法 ----
let _famPickMenu = null;
function closeFamilyPicker() {
  if (_famPickMenu) { _famPickMenu.remove(); _famPickMenu = null; }
  document.removeEventListener("pointerdown", _famPickOutside, true);
  document.removeEventListener("keydown", _famPickKey, true);
}
function _famPickOutside(e) {
  if (_famPickMenu && !_famPickMenu.contains(e.target)) closeFamilyPicker();
}
function _famPickKey(e) { if (e.key === "Escape") closeFamilyPicker(); }
function openFamilyPicker(familyId, clientX, clientY, idx) {
  closeFamilyPicker();
  const members = OPS.filter((o) => o.family === familyId);
  if (!members.length) return;
  const menu = el("div", { class: "fam-pick-menu", role: "menu" },
    el("div", { class: "fam-pick-head" }, tt("ui.recipe.chooseFamilyOp")),
    ...members.map((m) => el("button", {
      class: "fam-pick-item",
      type: "button",
      onclick: (ev) => { ev.stopPropagation(); closeFamilyPicker(); addNode(m.id, idx); },
    },
      el("span", { class: "fam-pick-name" }, opDisplayName(m)),
      el("span", { class: "fam-pick-cat" }, m.id),
    )),
  );
  document.body.append(menu);
  // 视口内夹取：防菜单一半在屏幕外
  const r = menu.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  menu.style.left = Math.max(8, Math.min(clientX, vw - r.width - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(clientY, vh - r.height - 8)) + "px";
  _famPickMenu = menu;
  document.addEventListener("pointerdown", _famPickOutside, true);
  document.addEventListener("keydown", _famPickKey, true);
}

// ---- 控制节点插入菜单（CC-A5）----
// 与族选档菜单同形；入口在工具条「控制节点」。插入位置：当前聚焦节点之后，否则链尾。
let _ctlMenu = null;
function closeControlMenu() {
  if (_ctlMenu) { _ctlMenu.remove(); _ctlMenu = null; }
  document.removeEventListener("pointerdown", _ctlMenuOutside, true);
  document.removeEventListener("keydown", _ctlMenuKey, true);
}
function _ctlMenuOutside(e) {
  if (_ctlMenu && !_ctlMenu.contains(e.target)) closeControlMenu();
}
function _ctlMenuKey(e) { if (e.key === "Escape") closeControlMenu(); }
function openControlMenu(anchor) {
  closeControlMenu();
  const focusIdx = activeNodeIndex();
  const idx = focusIdx >= 0 ? focusIdx + 1 : null;
  const menu = el("div", { class: "fam-pick-menu recipe-control-menu", role: "menu", "aria-label": tt("ui.recipe.controlMenuTitle") },
    el("div", { class: "fam-pick-head" }, tt("ui.recipe.controlMenuTitle")),
    ...CONTROL_DEFS.map((d) => el("button", {
      class: "fam-pick-item",
      type: "button",
      "data-control": d.id,
      onclick: (ev) => { ev.stopPropagation(); closeControlMenu(); addControlNode(d.id, idx); },
    },
      el("span", { class: "fam-pick-name" }, d.name),
      el("span", { class: "fam-pick-cat" }, d.hint),
    )),
  );
  document.body.append(menu);
  const vw = window.innerWidth, vh = window.innerHeight;
  const mr = menu.getBoundingClientRect();
  const ar = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
  const left = ar ? ar.left : 20;
  const top = ar ? ar.bottom + 4 : 20;
  menu.style.left = Math.max(8, Math.min(left, vw - mr.width - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(top, vh - mr.height - 8)) + "px";
  _ctlMenu = menu;
  document.addEventListener("pointerdown", _ctlMenuOutside, true);
  document.addEventListener("keydown", _ctlMenuKey, true);
}

export { rState };
