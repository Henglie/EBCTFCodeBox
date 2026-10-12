import { computeSignals, SIGNAL_LIMITS } from "../core/magic/signals.js";
import { ensureExpStyles } from "./expandableInput.js";
import { attachModalLifecycle } from "./modalLifecycle.js";
import { icon as iconSvg } from "./icons.js";
import { getLocale } from "../i18n/index.js";
import { createRegexEngine, DEFAULT_LIMITS } from "./targetRegexEngine.js";

// ============ 真实有界正则引擎接入（/接线）============
// 引擎在专用 Worker 内真执行，父级 budgetMs 到点 terminate 真杀（非同线程伪超时）。
const STORE_KEY = "ebctf.targets.v2";
const PREVIEW_KEY = "mt575.preview.targets.v2";
const LEGACY_KEY = "ebctf.targets.v1";
const MAXT = DEFAULT_LIMITS.maxTargets;       // 64
const MAXLEN = DEFAULT_LIMITS.maxPatternLen;  // 256

let activeTargets = [];        // 当前生效目标（引擎形状），供 highlightResult 消费
let validatorEngine = null;    // 编译校验用（写入即校验，不落盘非法项）
let consumerEngine = null;      // 结果高亮匹配用
const hostToken = new WeakMap();
const jobQueue = [];
let draining = false;

const getValidator = () => (validatorEngine || (validatorEngine = createRegexEngine()));
const getConsumer = () => (consumerEngine || (consumerEngine = createRegexEngine()));

function engineTargetOf(t) {
  return {
    id: String(t.id),
    mode: t.mode === "regex" ? "regex" : "literal",
    expression: String(t.expression == null ? "" : t.expression),
    enabled: t.enabled !== false,
    flags: String(t.flags == null ? "" : t.flags),
  };
}
function setActiveTargets(list) {
  activeTargets = (list || []).map(engineTargetOf);
}
function toTargetSignals(result) {
  const out = [];
  if (result && Array.isArray(result.results)) {
    for (const r of result.results) {
      const sp = r && Array.isArray(r.spans) ? r.spans : [];
      for (const s of sp) {
        if (Array.isArray(s) && s.length === 2 && s[1] > s[0]) {
          out.push({ kind: "target", targetId: r.id, mode: r.mode, span: [s[0], s[1]], weight: 0 });
        }
      }
    }
  }
  return out;
}

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }

// ============ 高亮渲染：基础（search/flag/structure）+ 真实引擎目标命中叠加 ============
function highlightResultBase(host, text, signals = [], search = {}, limit = 500) {
  text = String(text ?? "");
  let extra = [];
  if (search.query) {
    if (search.caseSensitive) {
      const offset = text.slice(0, SIGNAL_LIMITS.maxScanLen).indexOf(search.query);
      if (offset >= 0) extra = [{ kind: "searchTerm", span: [offset, offset + search.query.length], weight: 0 }];
    } else extra = computeSignals(text, { searchTerm: search.query }).signals.filter(s => s.kind === "searchTerm");
  }
  const boundary = (i, end = false) => i > 0 && i < text.length && /[\uDC00-\uDFFF]/.test(text[i]) && /[\uD800-\uDBFF]/.test(text[i - 1]) ? i + (end ? 1 : -1) : i;
  const items = [...extra, ...signals].filter(s => Array.isArray(s.span) && s.span.length === 2);
  // 引擎命中（kind:"target"）已是精确 UTF-16 区间，不再重算代理对边界（避免撕裂）；
  // 其余信号按原逻辑做边界校正。
  const spans = items.map(s => s.kind === "target"
    ? [s.span[0], s.span[1]]
    : [boundary(s.span[0]), boundary(s.span[1], true)]
  ).filter(([a, b]) => Number.isInteger(a) && Number.isInteger(b) && a >= 0 && b > a && b <= text.length);
  const focus = spans[0]?.[0] ?? 0;
  let start = boundary(Math.max(0, focus - Math.floor(limit / 3)));
  const end = boundary(Math.min(text.length, start + limit), true);
  const merged = [];
  for (const [a, b] of spans.slice().sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else merged.push([a, b]);
  }
  host.replaceChildren();
  if (start) host.append(document.createTextNode("… "));
  let pos = start;
  for (let [a, b] of merged) {
    a = Math.max(start, a); b = Math.min(end, b);
    if (b <= a) continue;
    host.append(document.createTextNode(text.slice(pos, a)), node_mark(text.slice(a, b)));
    pos = b;
  }
  host.append(document.createTextNode(text.slice(pos, end)));
  if (end < text.length) host.append(document.createTextNode(" …"));
  return host;
}

// 旧字面折叠目标命中在重绘层被剔除，交由真实引擎重算（见 highlightResult）。
export function highlightResult(host, text, signals = [], search = {}, limit = 500) {
  const base = (signals || []).filter(s => s.kind !== "target");
  highlightResultBase(host, text, base, search, limit);
  queueTargetHighlight(host, text, base, search, limit);
  return host;
}

function queueTargetHighlight(host, text, base, search, limit) {
  const token = {};
  hostToken.set(host, token);
  for (let i = jobQueue.length - 1; i >= 0; i--) {
    if (jobQueue[i].host === host) jobQueue.splice(i, 1); // 同宿主以最新一次为准
  }
  if (!activeTargets.length) { host.dataset.targetMatch = "skip"; return; }
  if (jobQueue.length >= 64) {
    host.dataset.targetMatch = "E_LIMIT_VIEWS";
    host.title = "本轮目标高亮待处理视图超过 64；请缩小结果范围";
    return;
  }
  jobQueue.push({ host, text: String(text == null ? "" : text), base, search, limit, token });
  if (!draining) { draining = true; queueMicrotask(drainTargetJobs); }
}

async function drainTargetJobs() {
  try {
    while (jobQueue.length) {
      const job = jobQueue.shift();
      if (!job.host.isConnected || hostToken.get(job.host) !== job.token) continue;
      try {
        const result = await getConsumer().match(job.text, activeTargets);
        if (!job.host.isConnected || hostToken.get(job.host) !== job.token) continue;
        const tsignals = toTargetSignals(result);
        highlightResultBase(job.host, job.text, [...job.base, ...tsignals], job.search, job.limit);
        const trunc = result.results.some(r => r.truncated);
        job.host.dataset.targetMatch = trunc ? "truncated" : "done";
        if (trunc) job.host.title = "目标命中已按每目标 5000 条上限截断";
        else job.host.title = "";
      } catch (err) {
        if (!job.host.isConnected || hostToken.get(job.host) !== job.token) continue;
        const code = (err && err.code) || "E_CONFIG";
        job.host.dataset.targetMatch = code;  // E_SYNTAX / E_FLAG / E_TIMEOUT / E_LIMIT_* 等，保留原文不伪造成功
        job.host.title = `${code}: ${err && err.message ? err.message : "目标匹配失败"}`;
        try { job.host.dispatchEvent(new CustomEvent("targetmatcherror", { bubbles: true, detail: { code, message: err && err.message ? err.message : "" } })); } catch {}
      }
    }
  } finally { draining = false; }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    if (consumerEngine) consumerEngine.dispose();
    if (validatorEngine) validatorEngine.dispose();
  });
}

function node(tag, text, cls) {
  const n = document.createElement(tag);
  if (text != null) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function node_mark(text) { return node("mark", text); }

function words() {
  return getLocale() === "zh" ? {
    title: "目标标签", add: "添加", remove: "移除", edit: "编辑", save: "保存", cancel: "取消", label: "标签", literal: "目标字面文本",
    saveFailed: "无法持久保存；本页仍可使用", disabled: "旧正则已停用，请改为字面目标", copy: "复制完整结果",
    regexHint: "正则表达式，Enter 确认（真实引擎匹配）",
    boxTitle: "一个标签=一个匹配目标。整标签点击=启用/停用；右键=编辑/删除；右侧按钮展开完整列表",
    inputAria: "目标标签输入", literalHint: "输入目标，Enter 确认",
    modeAria: "匹配模式（默认字面，正则显式切换）", literalBtn: "字面", regexBtn: ".* 正则",
    expandAria: "展开目标列表", configReadFailed: "目标配置读取失败",
    brokenConfig: "目标配置读取失败，原记录已保留：",
    emptyExpr: "目标表达式为空", tooLong: "目标表达式超长（≤", tooLongEnd: "）",
    enable: "启用", disable: "停用", del: "删除", invalidRegex: "正则无效",
    enabledPrefix: "启用中：", disabledPrefix: "已停用：", deleteAria: "删除目标 ",
    regexTarget: "正则目标", editAria: "编辑目标",
    emptyList: "暂无目标。在下方输入框添加。", rowTitle: "点击整行切换启用/停用",
    listAria: "目标标签列表", close: "关闭",
    addPlaceholder: "新增目标，Enter 确认（模式随左侧全局开关）", addAria: "新增目标",
  } : {
    title: "Target labels", add: "Add", remove: "Remove", edit: "Edit", save: "Save", cancel: "Cancel", label: "Label", literal: "Literal target",
    saveFailed: "Storage unavailable; usable in this view", disabled: "Legacy pattern disabled; enter a literal", copy: "Copy full result",
    regexHint: "Regular expression, Enter to confirm (real engine match)",
    boxTitle: "One label = one match target. Click a chip to enable/disable; right-click to edit or delete; the button on the right expands the full list.",
    inputAria: "Target label input", literalHint: "Enter a target, press Enter to confirm",
    modeAria: "Match mode (literal by default; switch to regex explicitly)", literalBtn: "Literal", regexBtn: ".* Regex",
    expandAria: "Expand target list", configReadFailed: "Failed to read target config",
    brokenConfig: "Failed to read target config; the previous record was kept: ",
    emptyExpr: "Target expression is empty", tooLong: "Target expression too long (≤", tooLongEnd: ")",
    enable: "Enable", disable: "Disable", del: "Delete", invalidRegex: "Invalid regular expression",
    enabledPrefix: "Enabled: ", disabledPrefix: "Disabled: ", deleteAria: "Delete target ",
    regexTarget: "Regex target", editAria: "Edit target",
    emptyList: "No targets yet. Add one in the input below.", rowTitle: "Click the row to toggle enable/disable",
    listAria: "Target label list", close: "Close",
    addPlaceholder: "Add a target, press Enter to confirm (mode follows the global switch on the left)", addAria: "Add target",
  };
}

export function renderCandidateRow(c, { search = {}, copied = () => {} } = {}) {
  const full = String(c.result ?? c.plaintext ?? "");
  const row = node("div", null, "exhaust-row smart-branch");
  row.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;align-items:baseline";
  const value = node("span", null, "exhaust-val");
  value.style.cssText = "flex:1 1 240px;min-width:0;overflow-wrap:anywhere;white-space:pre-wrap";
  highlightResult(value, c.ok === false ? String(c.error || "") : full, c.signals, search);
  const param = c.paramLabel || c.paramTag || c.steps?.at(-1)?.paramLabel || "";
  const confidence = Number.isFinite(c.confidence) ? ` · ${(c.confidence * 100).toFixed(0)}%` : "";
  const tail = node("span", param + confidence, "onekey-brute-param");
  tail.style.cssText = "margin-left:auto;overflow-wrap:anywhere;max-width:100%";
  row.append(value, tail);
  if (c.ok !== false) {
    row.tabIndex = 0; row.setAttribute("role", "button"); row.title = words().copy;
    const copy = async () => { try { await navigator.clipboard.writeText(full); copied(); } catch { /* Clipboard denied. */ } };
    row.addEventListener("click", e => { e.stopPropagation(); void copy(); });
    row.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); void copy(); } });
  }
  return row;
}

/* document 级菜单关闭监听改为进程级单例多路复用。此前 createTargetEditor 每次
 * 渲染都往 document 挂 click+keydown 且永不摘除（两个消费方 main.js/exhaustiveView.js 均不
 * 调 dispose，且旧 dispose 本身也漏摘 keydown），首页↔op 往返每轮 +2 监听 + 闭包链保留的
 * 离树节点。现在：常驻恰好一对 document 监听多路转发给存活编辑器；hashchange / 任意
 * document 事件时清理 root 已离树的死编辑器（曾挂上过树的才判死，创建中未挂树不误删）；
 * dispose() 改为注销实例注册。 */
const _liveEditors = new Set();
let _menuChannelWired = false;
function _pruneDeadEditors() {
  for (const ed of _liveEditors) {
    if (ed.root.isConnected) { ed.seen = true; continue; }
    if (ed.seen) { _liveEditors.delete(ed); ed.closeMenu(); }
  }
}
function _wireMenuChannel() {
  if (_menuChannelWired) return;
  _menuChannelWired = true;
  document.addEventListener("click", () => { _pruneDeadEditors(); for (const ed of _liveEditors) ed.closeMenu(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    _pruneDeadEditors(); for (const ed of _liveEditors) ed.closeMenu();
  });
  window.addEventListener("hashchange", _pruneDeadEditors);
}

export function createTargetEditor() {
  /*/：同 token 整体框 + 框内 chips + 8px 圆角 + .* 只读前缀 + 全局「字面 | .* 正则」开关
   * + 展开按钮弹出 exp-dialog/exp-overlay 通用弹层 + 右上角 exp-close + html:not(.reduce-motion) 动画口径。
   * 正则执行=真实有界引擎（内核，专用 Worker，父级真终止）。存储键 ebctf.targets.v2（迁移：preview→v1→种子）。
   */
  ensureExpStyles();

  const seed = () => ({ targets: [
    { id: "t1", mode: "literal", expression: "flag{", enabled: true },
    { id: "t2", mode: "regex", expression: "user[0-9]{4,}", enabled: true },
    { id: "t3", mode: "literal", expression: "TODO 私钥", enabled: false },
  ] });

  function normalizeTarget(t) {
    if (!t || typeof t !== "object") throw new Error("目标格式无效");
    const id = String(t.id != null ? t.id : "").slice(0, 64);
    if (!id) throw new Error("目标 id 缺失");
    const legacyPattern = (t.pattern != null && t.pattern !== "") || t.disabledReason === "patternUnsupported";
    let mode = t.mode === "regex" ? "regex" : "literal";
    let expression = String(t.expression != null ? t.expression
      : (t.literal != null ? t.literal : (t.pattern != null ? t.pattern : "")));
    let enabled = t.enabled !== false;
    const flags = String(t.flags != null ? t.flags : "");
    if (legacyPattern) { mode = "regex"; enabled = false; } // 旧 pattern：迁移为 regex 但默认停用，须用户显式启用
    if (!expression) throw new Error("目标表达式为空");
    if (expression.length > MAXLEN) throw new Error("目标表达式超长（≤" + MAXLEN + "）");
    if (!/^[imsu]*$/.test(flags)) throw new Error("flags 仅支持 i m s u");
    return { id, mode, expression, enabled, flags };
  }
  function normalizeConfig(raw) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.targets)) throw new Error("目标配置格式无效");
    if (raw.targets.length > MAXT) throw new Error("目标超过 " + MAXT + " 条");
    const ids = new Set();
    const targets = raw.targets.map(normalizeTarget);
    for (const t of targets) { if (ids.has(t.id)) throw new Error("目标 id 重复"); ids.add(t.id); }
    return { version: 2, targets };
  }
  function migrateV1(t) {
    const id = String(t.id != null ? t.id : "v1-" + Math.random().toString(36).slice(2, 8));
    if (t.pattern != null && t.pattern !== "") {
      return { id, mode: "regex", expression: String(t.pattern), enabled: false, flags: "" };
    }
    return { id, mode: "literal", expression: String(t.literal != null ? t.literal : (t.expression != null ? t.expression : "")), enabled: t.enabled !== false, flags: "" };
  }
  function loadConfig() {
    // 优先级：v2 → preview → v1 → 种子。迁移后写正式键。解析失败不覆盖原数据。
    const rawV2 = safeGet(STORE_KEY);
    if (rawV2 !== null) return { config: normalizeConfig(JSON.parse(rawV2)), broken: null };
    const rawPrev = safeGet(PREVIEW_KEY);
    if (rawPrev !== null) {
      const cfg = normalizeConfig(JSON.parse(rawPrev));
      try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch {}
      return { config: cfg, broken: null };
    }
    const rawV1 = safeGet(LEGACY_KEY);
    if (rawV1 !== null) {
      let v1; try { v1 = JSON.parse(rawV1); } catch { v1 = { targets: [] }; }
      const cfg = normalizeConfig({ targets: Array.isArray(v1.targets) ? v1.targets.map(migrateV1) : [] });
      try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch {}
      return { config: cfg, broken: null };
    }
    return { config: seed(), broken: null };
  }

  let config, broken = null;
  try {
    const loaded = loadConfig();
    config = loaded.config; broken = loaded.broken;
  } catch (e) {
    broken = e && e.message ? e.message : words().configReadFailed;
    config = seed(); // 内存兜底，绝不覆盖原记录
  }

  // ---- DOM ----
  const root = document.createElement("div");
  const rowEl = document.createElement("div");
  rowEl.className = "mt575-row";
  const label = document.createElement("span");
  label.className = "mt575-label";
  label.textContent = words().title;
  const box = document.createElement("span");
  box.className = "mt575-box";
  box.title = words().boxTitle;
  const input = document.createElement("input");
  input.className = "mt575-in";
  input.spellcheck = false;
  input.setAttribute("aria-label", words().inputAria);
  input.placeholder = words().literalHint;
  const mode = document.createElement("span");
  mode.className = "mt575-mode";
  mode.setAttribute("role", "group");
  mode.setAttribute("aria-label", words().modeAria);
  const mLit = document.createElement("button");
  mLit.type = "button"; mLit.textContent = words().literalBtn;
  const mRe = document.createElement("button");
  mRe.type = "button"; mRe.textContent = words().regexBtn;
  mode.append(mLit, mRe);
  const expBtn = document.createElement("button");
  expBtn.type = "button";
  expBtn.className = "exp-btn";
  expBtn.title = words().expandAria; expBtn.setAttribute("aria-label", words().expandAria);
  try { expBtn.innerHTML = iconSvg("open_in_full"); } catch { expBtn.textContent = "□"; }
  const statusEl = document.createElement("div");
  statusEl.className = "mt582-status";
  statusEl.setAttribute("role", "status");
  box.append(input);
  rowEl.append(label, box, expBtn, mode);
  root.append(rowEl, statusEl);

  if (broken) statusEl.textContent = words().brokenConfig + broken;
  else if (safeGet(STORE_KEY) === null) { try { localStorage.setItem(STORE_KEY, JSON.stringify(config)); } catch {} }
  setActiveTargets(config.targets);

  if (!document.getElementById("mt575-tags-style")) {
    const st = document.createElement("style");
    st.id = "mt575-tags-style";
    st.textContent = `
.mt575-row { display:flex; align-items:center; gap:var(--sp-2); width:100%; min-width:0; }
.mt575-label { font-size:var(--fs-base); color:var(--on-surface-var); flex:none; }
.mt575-box { flex:1; min-width:120px; display:flex; flex-wrap:wrap; align-items:center; gap:6px;
  padding:calc(var(--sp-2) - 2px) var(--sp-3); cursor:text;
  background:var(--field-bg); border:1px solid var(--outline-var); border-radius:var(--r-sm);
  font-size:var(--fs-base); color:var(--on-surface); }
.mt575-box:focus-within { outline:2px solid var(--primary); border-color:transparent; }
.mt575-chip { display:inline-flex; align-items:center; gap:6px; padding:3px 6px 3px 8px;
  border-radius:var(--r-sm); background:var(--surface-hi); border:1px solid var(--outline-var);
  font-size:14px; line-height:20px; max-width:100%; cursor:pointer; user-select:none; }
.mt575-chip:hover { border-color:var(--outline); }
.mt575-chip .txt { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:240px; }
.mt575-chip[aria-pressed="false"] { opacity:.45; border-style:dashed; }
.mt575-chip[aria-pressed="false"] .txt { text-decoration:line-through; }
.mt575-dot { width:8px; height:8px; border-radius:50%; background:var(--outline-var); flex:none;
  pointer-events:none; }
.mt575-chip:not([aria-pressed="false"]) .mt575-dot { background:var(--primary); }
.mt575-re { color:var(--primary); font-size:12px; flex:none; user-select:none; pointer-events:none; }
.mt575-x { border:0; background:none; color:var(--on-surface-var); cursor:pointer; font-size:14px;
  line-height:1; padding:2px 4px; flex:none; border-radius:var(--r-sm); }
.mt575-x:hover { color:var(--on-surface); background:var(--surface-3); }
.mt575-in { flex:1 1 120px; min-width:80px; border:0; background:transparent; color:var(--on-surface);
  font-size:var(--fs-base); outline:none; padding:2px 0; }
.mt575-in::placeholder { color:var(--on-surface-var); }
.mt575-in[aria-invalid="true"] { outline:1px solid var(--primary); }
.mt575-mode { display:inline-flex; border:1px solid var(--outline-var); border-radius:var(--r-sm);
  overflow:hidden; flex:none; }
.mt575-mode button { border:0; background:var(--field-bg); color:var(--on-surface-var); font-size:13px;
  padding:4px 10px; cursor:pointer; }
.mt575-mode button[aria-pressed="true"] { background:var(--surface-hi); color:var(--primary); }
.mt582-status { font-size:12px; color:var(--primary); min-height:18px; margin-top:6px; }
.mt575-list-status { font-size:12px; color:var(--primary); min-height:18px; margin-top:6px; }
/* 右键菜单 */
.mt575-menu { position:fixed; z-index:130; min-width:140px; padding:4px; display:flex; flex-direction:column;
  background:var(--surface-2); border:1px solid var(--outline-var); border-radius:var(--r-sm);
  box-shadow:var(--el-2);
  animation: mt575-menu-in var(--dur-short) var(--ease-out); }
@keyframes mt575-menu-in { from { opacity: 0; transform: scale(.97) translateY(-2px); } to { opacity: 1; transform: none; } }
.mt575-menu button { display:flex; align-items:center; gap:var(--sp-2); border:0; background:none;
  color:var(--on-surface); font-size:14px; text-align:start; padding:8px 12px; cursor:pointer;
  border-radius:var(--r-sm); }
.mt575-menu button:hover { background:var(--surface-hi); }
/* 展开列表：遮罩/卡片/动画复用项目 exp-overlay/exp-dialog（通用过渡），此处只管列表内部。
 * 动画口径对齐应用内开关（html.reduce-motion），不受 OS 级 prefers-reduced-motion 静默。 */
html:not(.reduce-motion) .exp-overlay.mt575-anim { animation: exp-fade var(--dur-medium) var(--ease-out); }
html:not(.reduce-motion) .exp-overlay.exp-closing.mt575-anim { animation: exp-fade-out var(--dur-4) var(--ease-in) forwards; }
html:not(.reduce-motion) .exp-dialog.mt575-anim { animation: exp-pop var(--dur-medium) var(--ease-out); }
html:not(.reduce-motion) .exp-overlay.exp-closing.mt575-anim .exp-dialog { animation: exp-pop-out var(--dur-4) var(--ease-in) forwards; }
.mt575-list-scroll { flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; gap:var(--sp-2); }
.mt575-li { display:flex; align-items:center; gap:var(--sp-2); padding:6px 8px; min-height:44px;
  background:var(--field-bg); border:1px solid var(--outline-var); border-radius:var(--r-sm); cursor:pointer; }
.mt575-li:hover { border-color:var(--outline); }
.mt575-li .mt575-dot { width:10px; height:10px; }
.mt575-li .txt { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--on-surface); }
.mt575-li[aria-pressed="false"] .txt { text-decoration:line-through; color:var(--on-surface-var); }
.mt575-li .act { flex:none; border:1px solid var(--outline); background:var(--surface-3);
  color:var(--on-surface); border-radius:var(--r-full); padding:7px 16px; font-size:13px;
  font-weight:600; cursor:pointer; line-height:1;
  transition: background var(--dur-short) var(--ease), color var(--dur-short) var(--ease), border-color var(--dur-short) var(--ease); }
.mt575-li .act:hover { background:var(--surface-hi); border-color:var(--on-surface-var); }
.mt575-li .act:active { filter: brightness(.94); }
.mt575-list-foot { display:flex; align-items:center; gap:var(--sp-2); margin-top:var(--sp-4); }
.mt575-list-foot input { flex:1; min-width:0; padding:8px 12px; font-size:var(--fs-base); color:var(--on-surface);
  background:var(--field-bg); border:1px solid var(--outline-var); border-radius:var(--r-sm); outline:none; }
.mt575-list-foot input:focus { outline:2px solid var(--primary); border-color:transparent; }
@media (max-width:600px) {
  .mt575-row { flex-wrap:wrap; }
  .mt575-box { width:100%; }
}`;
    document.head.appendChild(st);
  }

  let disposed = false;
  let curMode = "literal";
  let seq = 100;
  let saving = false;
  const notify = () => { draw(); drawList(); };

  const syncMode = () => {
    mLit.setAttribute("aria-pressed", curMode === "literal" ? "true" : "false");
    mRe.setAttribute("aria-pressed", curMode === "regex" ? "true" : "false");
    input.placeholder = curMode === "regex" ? words().regexHint : words().literalHint;
  };
  mLit.addEventListener("click", () => { if (disposed) return; curMode = "literal"; syncMode(); input.focus(); });
  mRe.addEventListener("click", () => { if (disposed) return; curMode = "regex"; syncMode(); input.focus(); });

  // 真实引擎编译校验：regex 经 Worker 编译，语法/flags 非法当场抛错（不静默当字面）。
  const validateTarget = async (t) => {
    if (t.mode !== "regex") return;
    if (!t.expression) throw new Error(words().emptyExpr);
    if (t.expression.length > MAXLEN) throw new Error(words().tooLong + MAXLEN + words().tooLongEnd);
    await getValidator().match("", [engineTargetOf(t)]);
  };

  const save = () => {
    if (broken) { statusEl.textContent = words().brokenConfig + broken; return; }
    try { localStorage.setItem(STORE_KEY, JSON.stringify(config)); statusEl.textContent = ""; }
    catch { statusEl.textContent = words().saveFailed; }
    setActiveTargets(config.targets);
  };

  /* ---- 右键菜单（编辑/删除/启停） ---- */
  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
 // 不再直接挂 document（改经 _wireMenuChannel 单例多路复用，见文件头说明）
  _wireMenuChannel();
  const _reg = { root, closeMenu, seen: false };
  _liveEditors.add(_reg);
  function openMenu(e, t) {
    e.preventDefault(); e.stopPropagation();
    closeMenu();
    menu = document.createElement("div");
    menu.className = "mt575-menu";
    menu.setAttribute("role", "menu");
    const mk = (txt, fn) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = txt; b.setAttribute("role", "menuitem");
      b.addEventListener("click", (ev) => { ev.stopPropagation(); closeMenu(); fn(); });
      menu.appendChild(b);
    };
    mk(t.enabled ? words().disable : words().enable, () => toggleEnable(t));
    mk(words().edit, () => startEdit(t));
    mk(words().del, () => { config.targets = config.targets.filter((o) => o !== t); save(); notify(); });
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.min(e.clientX, innerWidth - r.width - 8) + "px";
    menu.style.top = Math.min(e.clientY, innerHeight - r.height - 8) + "px";
    menu.addEventListener("contextmenu", (ev) => ev.preventDefault());
    menu.addEventListener("click", (ev) => ev.stopPropagation());
  }

  async function toggleEnable(t) {
    if (disposed || saving) return;
    if (!t.enabled && t.mode === "regex") {
      saving = true;
      try { await validateTarget(t); if (disposed) return; }
      catch (e) {
        statusEl.textContent = (e && e.code ? e.code + " " : "") + (e && e.message ? e.message : words().invalidRegex);
        const c = box.querySelectorAll(".mt575-chip");
        const idx = config.targets.indexOf(t);
        if (c[idx]) c[idx].setAttribute("aria-invalid", "true");
        saving = false; return;
      }
      finally { saving = false; }
    }
    t.enabled = !t.enabled; save(); notify();
  }

  /* ---- chip（框内紧凑态）：整 chip 点击=启停；× 删除；右键菜单 ---- */
  function chip(t) {
    const c = document.createElement("span");
    c.className = "mt575-chip";
    c.setAttribute("role", "button");
    c.setAttribute("tabindex", "0");
    c.setAttribute("aria-pressed", t.enabled ? "true" : "false");
    c.setAttribute("aria-label", (t.enabled ? words().enabledPrefix : words().disabledPrefix) + t.expression);
    c.addEventListener("click", () => toggleEnable(t));
    c.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleEnable(t); }
      else if (e.key === "Delete") { config.targets = config.targets.filter((o) => o !== t); save(); notify(); }
    });
    c.addEventListener("contextmenu", (e) => openMenu(e, t));
    const dot = document.createElement("span");
    dot.className = "mt575-dot"; dot.title = t.enabled ? words().enable : words().disable;
    const txt = document.createElement("span");
    txt.className = "txt"; txt.textContent = t.expression;
    const x = document.createElement("button");
    x.type = "button"; x.className = "mt575-x"; x.textContent = "×";
    x.setAttribute("aria-label", words().deleteAria + t.expression);
    x.addEventListener("click", (e) => {
      e.stopPropagation();
      config.targets = config.targets.filter((o) => o !== t);
      save(); notify(); input.focus();
    });
    c.append(dot);
    if (t.mode === "regex") {
      const re = document.createElement("span");
      re.className = "mt575-re"; re.textContent = ".*"; re.title = words().regexTarget;
      c.append(re);
    }
    c.append(txt, x);
    return c;
  }

  function draw() {
    box.querySelectorAll(".mt575-chip").forEach((n) => n.remove());
    for (const t of config.targets) box.insertBefore(chip(t), input);
  }

  /* ---- 框内原位编辑 ---- */
  function startEdit(t) {
    const i = config.targets.indexOf(t);
    const c = box.querySelectorAll(".mt575-chip")[i];
    if (!c) return;
    const edit = document.createElement("input");
    edit.className = "mt575-in"; edit.value = t.expression;
    edit.setAttribute("aria-label", words().editAria);
    c.replaceChildren(edit);
    edit.focus(); edit.select();
    let done = false;
    let composing = false;
    edit.addEventListener("compositionstart", () => { composing = true; });
    edit.addEventListener("compositionend", () => { composing = false; });
    const commit = async (ok) => {
      if (done) return; done = true;
      if (ok && edit.value) {
        const proposed = { ...t, mode: curMode, expression: edit.value };
        if (proposed.mode === "regex") {
          try { await validateTarget(proposed); }
          catch (e) {
            statusEl.textContent = (e && e.code ? e.code + " " : "") + (e && e.message ? e.message : words().invalidRegex);
            edit.setAttribute("aria-invalid", "true"); edit.focus(); edit.select(); done = false; return;
          }
        }
        t.mode = curMode; t.expression = edit.value; save();
      }
      notify(); input.focus();
    };
    edit.addEventListener("keydown", (e) => {
      if (composing || e.isComposing || e.keyCode === 229) return; // 中文 IME 组字中不提交
      if (e.key === "Enter") { e.preventDefault(); commit(true); }
      else if (e.key === "Escape") commit(false);
    });
    edit.addEventListener("blur", () => { if (!composing) commit(true); });
  }

  /* ---- 展开列表弹层 ---- */
  let listDialog = null;
  let listModal = null;
  function drawList() {
    if (!listDialog) return;
    const scroll = listDialog.querySelector(".mt575-list-scroll");
    scroll.replaceChildren();
    if (!config.targets.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "color:var(--on-surface-var);font-size:14px;padding:8px";
      empty.textContent = words().emptyList;
      scroll.appendChild(empty);
    }
    for (const t of config.targets) {
      const li = document.createElement("div");
      li.className = "mt575-li";
      li.setAttribute("role", "button"); li.setAttribute("tabindex", "0");
      li.setAttribute("aria-pressed", t.enabled ? "true" : "false");
      li.title = words().rowTitle;
      li.addEventListener("click", () => toggleEnable(t));
      li.addEventListener("keydown", (e) => {
        if (e.target !== li) return; // 子按钮的 Enter/Space 交原生激活，勿冒泡成整行启停
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleEnable(t); }
      });
      li.addEventListener("contextmenu", (e) => openMenu(e, t));
      const dot = document.createElement("span"); dot.className = "mt575-dot";
      const txt = document.createElement("span"); txt.className = "txt"; txt.textContent = t.expression;
      const bEdit = document.createElement("button");
      bEdit.type = "button"; bEdit.className = "act"; bEdit.textContent = words().edit;
      bEdit.addEventListener("click", (e) => { e.stopPropagation(); closeList(); startEdit(t); });
      const bDel = document.createElement("button");
      bDel.type = "button"; bDel.className = "act"; bDel.textContent = words().del;
      bDel.addEventListener("click", (e) => {
        e.stopPropagation();
        config.targets = config.targets.filter((o) => o !== t); save(); notify();
      });
      li.append(dot);
      if (t.mode === "regex") {
        const re = document.createElement("span"); re.className = "mt575-re"; re.textContent = ".*";
        li.append(re);
      }
      li.append(txt, bEdit, bDel);
      scroll.appendChild(li);
    }
    const cnt = listDialog.querySelector(".mt575-count");
    if (cnt) cnt.textContent = String(config.targets.length);
  }
  function closeList() {
    if (!listDialog) return;
    const ov = listDialog; listDialog = null;
    if (listModal) { listModal.release(); listModal = null; }
    ov.classList.add("exp-closing");
    setTimeout(() => ov.remove(), 250);
  }
  expBtn.addEventListener("click", () => {
    if (listDialog) { closeList(); return; }
    const ov = document.createElement("div");
    ov.className = "exp-overlay mt575-anim";
    const dlg = document.createElement("div");
    dlg.className = "exp-dialog mt575-anim";
    dlg.setAttribute("role", "dialog");
    dlg.setAttribute("aria-modal", "true");
    dlg.setAttribute("aria-label", words().listAria);
    const head = document.createElement("div");
    head.className = "exp-head";
    const title = document.createElement("div");
    title.className = "exp-title";
    title.append(words().title + " ", (() => {
      const s = document.createElement("span");
      s.className = "mt575-count"; s.style.cssText = "color:var(--on-surface-var);font-size:14px";
      return s;
    })());
    const closeBtn = document.createElement("button");
    closeBtn.type = "button"; closeBtn.className = "exp-close";
    closeBtn.title = words().close; closeBtn.setAttribute("aria-label", words().close);
    try { closeBtn.innerHTML = iconSvg("close"); } catch { closeBtn.textContent = "×"; }
    closeBtn.addEventListener("click", closeList);
    head.append(title, closeBtn);
    const scroll = document.createElement("div");
    scroll.className = "mt575-list-scroll";
    const foot = document.createElement("div");
    foot.className = "mt575-list-foot";
    const addIn = document.createElement("input");
    addIn.placeholder = words().addPlaceholder;
    addIn.setAttribute("aria-label", words().addAria);
    const addBtn = document.createElement("button");
    addBtn.type = "button"; addBtn.className = "exp-action exp-save"; addBtn.textContent = words().add;
    const doAdd = async () => {
      const v = addIn.value.trim();
      if (!v || v.length > MAXLEN || config.targets.length >= MAXT || saving) return;
      const t = { id: "p" + (seq++), mode: curMode, expression: v, enabled: true, flags: "" };
      saving = true;
      try {
        await validateTarget(t);
        if (disposed) return;
        config.targets.push(t); addIn.value = ""; statusEl.textContent = ""; listStatus.textContent = ""; addIn.removeAttribute("aria-invalid"); save(); notify();
      } catch (e) {
        statusEl.textContent = (e && e.code ? e.code + " " : "") + (e && e.message ? e.message : words().invalidRegex);
        addIn.setAttribute("aria-invalid", "true");
        listStatus.textContent = statusEl.textContent;
      } finally { saving = false; }
    };
    addBtn.addEventListener("click", doAdd);
    addIn.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter") { e.preventDefault(); doAdd(); }
    });
    addIn.setAttribute("aria-describedby", "mt575-list-status");
    foot.append(addIn, addBtn);
    const listStatus = document.createElement("div");
    listStatus.className = "mt575-list-status";
    listStatus.id = "mt575-list-status";
    listStatus.setAttribute("role", "status");
    listStatus.setAttribute("aria-live", "polite");
    dlg.append(head, scroll, foot, listStatus);
    ov.appendChild(dlg);
    document.body.appendChild(ov);
    listDialog = ov;
    listModal = attachModalLifecycle(ov, { dialog: dlg, onClose: closeList, initialFocus: addIn, restoreFocusTo: expBtn });
    drawList();
    addIn.focus();
  });

  async function commitInput() {
    const v = input.value.trim();
    if (!v || config.targets.length >= MAXT || v.length > MAXLEN || saving) return;
    const t = { id: "p" + (seq++), mode: curMode, expression: v, enabled: true, flags: "" };
    saving = true;
    try {
      await validateTarget(t);
      if (disposed) return;
      config.targets.push(t); input.value = ""; statusEl.textContent = ""; save(); notify();
    } catch (e) {
      statusEl.textContent = (e && e.code ? e.code + " " : "") + (e && e.message ? e.message : words().invalidRegex);
      input.setAttribute("aria-invalid", "true");
    } finally { saving = false; }
  }
  input.addEventListener("keydown", (e) => {
    if (e.isComposing || e.keyCode === 229) return; // 中文 IME 组字中 Enter 不误提交
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); commitInput(); }
    else if (e.key === "Backspace" && !input.value && config.targets.length) {
      e.preventDefault();
      startEdit(config.targets[config.targets.length - 1]);
    }
  });
  box.addEventListener("click", (e) => {
    if (e.target === box || e.target === input) input.focus();
  });
  syncMode(); draw();

  // 兼容现用消费方（main.js forceTrigger → runOneKey）：投影回旧 target 形状
  const legacy = () => config.targets.map((t) => ({
    id: t.id, label: t.expression, enabled: t.enabled,
    literal: t.mode === "literal" ? t.expression : undefined,
    pattern: t.mode === "regex" ? t.expression : undefined,
  }));
  return {
    element: root,
    getTargets: () => structuredClone(legacy()),
    dispose() { disposed = true; closeMenu(); if (listDialog) closeList(); _liveEditors.delete(_reg); },
  };
}
