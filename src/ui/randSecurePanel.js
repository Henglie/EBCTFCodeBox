/*
 * randSecurePanel.js — 「增强随机安全」共享 UI 组件。
 *
 * 形态（恒烈批准，M676/随机性增强_规划.md §形态）：
 *   1. 独立 op `randomSecure`（core/randomSecure.js）可在工具列表单独使用；
 *   2. 「会消耗随机性」的 op 参数区显示【增强随机性】开关（默认关）：
 *        - 不显示：不消耗随机性的 op（Base64/摩斯/哈希等）——白名单见 core/randOps.js；
 *        - 关 ⇒ 不展开任何额外控件，随机源走 system 档（界面/行为与改动前一致）；
 *        - 开 ⇒ 就地展开档位选择与配置，并实时显示当前档位；
 *   3. 档位常驻可见：只要不是 system 档，开关行常驻显示当前档位标识。
 *
 * 档位（下拉只列「增强档」，不再列系统档——关掉开关即回系统档，2026-10-11 恒烈指令）：
 *   mixed 混合 / custom 完全自定义 / server 自配置服务器。
 * 鼠标熵 = **辅助项**（不是档位，2026-10-11 恒烈修正）：弹窗采集本地熵，可叠加到上述三档
 *   （只增不减）。目的之一：不受信任的系统上不让系统 RNG 成为单点，用着不烧心。
 *
 * 落点（不另造轮子）：
 *   - 全局入口：并入既有顶栏「环境」面板（envPanel.js）新增一节 —— 本模块导出
 *     `renderRandSecureSection()` 供 envPanel 调用；该节与每 op 内嵌同构（开关 + 下拉）。
 *   - 每 op 内嵌：main.js renderOp 在参数栏之后调用 `renderRandSecureToggle()`（仅白名单 op）。
 *
 * 存储（对齐既有 ebctf_* 约定）：单一 JSON 键
 *   localStorage["ebctf_rand_config"] = { mode, seed, endpoint, auth, count, customField, serverOn, mouse, mouseOn }
 *   缺省 = { mode:"system" }；读写全 try/catch（隐私模式容错）。
 *   ⚠ core/randSource.js **不读 localStorage**；持久化只在本 UI 层。
 *   count      —— server 档取数量（1–1024 字节，默认 32，恒烈 2026-10-09 裁决①）；
 *   customField —— server 档响应「自定义字段名」（9 种已知字段之外，恒烈裁决③）；
 *   serverOn   —— 联网启用开关：只有在页面内确认条（弃 window.confirm，恒烈裁决②）
 *                 显式确认「会向该地址发起网络请求」后才置 true；默认 false = 零网络请求。
 *                 endpoint/auth/count/customField 任何一项被修改即自动回到未启用（需重新确认）。
 *   mouse      —— 鼠标熵辅助项的采集结果（hex 种子，本地生成，零外发）；
 *   mouseOn    —— 是否启用鼠标熵辅助（叠加到 mixed/custom/server 三档）。
 *
 * 非 system 档强制走主线程：本模块只负责「切换档位 + 持久化 + 显示标识」；主线程判定在
 * main.js（读 getMode()），复用 core/explicitRun.js 的显式触发机制。
 *
 * 零依赖：自带轻量 el/msym（与 envPanel.js 同形）；i18n 优先 window.__ebctfT，缺键回退本
 * 模块内置中文兜底（zh/en 建议键见交付报告，由 M 落 src/i18n/**）。
 */
import { RAND_MODES, getRandConfig, setRandConfig, onRandConfigChange, isServerReady, isMouseReady, warmupServer, sha256HexOfUtf8 } from "../core/randSource.js";
import { icon as iconSvg } from "./icons.js";

const RAND_KEY = "ebctf_rand_config";
// 下拉只列增强档；系统档由「关掉开关」表达（不再出现在下拉里）。鼠标熵是**辅助项**，不是档位。
const MODE_ORDER = [RAND_MODES.MIXED, RAND_MODES.CUSTOM, RAND_MODES.SERVER];
// 控件唯一 id 计数器（环境面板与每 op 面板可能同屏，避免 id 撞车）。
let _uid = 0;

// ---- 轻量 DOM 工具（与 envPanel.js 同形，本模块自持，零耦合）----
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (v === false) continue;
    else n.setAttribute(k, v === true ? "" : v);
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

// ---- i18n：优先 window 主表（main.js 暴露 __ebctfT），回退内置中文字典 ----
const _ZH = {
  "ui.rand.title": "增强随机安全",
  "ui.rand.toggle": "增强随机安全",
  "ui.rand.note": "本工具用于接管随机数来源，目的有二：① 复现「可预测伪随机」的 CTF 题目（自定义档）；② 在不受信任的机器上，不让系统随机源成为单点——可叠加你自己的熵（手输 / 鼠标 / 自配服务器），用着不烧心。默认走系统随机源，纯本地计算。",
  "ui.rand.off": "已关闭（使用系统随机源 crypto.getRandomValues）。",
  "ui.rand.mode": "档位",
  "ui.rand.modeSystem": "系统（默认）",
  "ui.rand.modeMixed": "混合增强",
  "ui.rand.modeCustom": "完全自定义",
  "ui.rand.modeServer": "自配置服务器",
  "ui.rand.modeSystemDesc": "crypto.getRandomValues 直通，与默认行为逐字节等价。",
  "ui.rand.modeMixedDesc": "用户输入作加料与系统熵经 HKDF 混合——只增不减，结果永不弱于系统档。",
  "ui.rand.modeCustomDesc": "只用你提供的随机流（可复现）；风险自担，可能弱于系统随机。",
  "ui.rand.modeServerDesc": "向你填写的地址取随机字节；未就绪时一律报错，绝不回落。",
  "ui.rand.seed": "用户随机输入",
  "ui.rand.seedPh": "mixed 档的加料 / custom 档的种子（可复现）",
  "ui.rand.endpoint": "服务器地址",
  "ui.rand.endpointPh": "https://…（server 档；真实联网取数由 server 档提供）",
  "ui.rand.auth": "鉴权头",
  "ui.rand.authPh": "可选，如 Bearer …",
  "ui.rand.current": "当前档位",
  "ui.rand.status": "随机源状态",
  "ui.rand.testConn": "测试连接",
  "ui.rand.testOk": "连接成功",
  "ui.rand.warnCustom": "⚠ 本档完全依赖你提供的随机性。若来源可预测，生成的密钥与签名可被他人复现。仅在你明确知道自己在做什么时使用。",
  "ui.rand.warnServer": "启用后本工具将向你填写的地址发起网络请求以获取随机数；这是你主动配置的联网，本项目不中转、不记录、不预置服务器。",
  "ui.rand.workerNote": "非系统档下，相关 op 强制在主线程运行，避免 Worker 拿不到用户熵而静默退回系统档。",
  "ui.rand.statusReady": "已就绪",
  "ui.rand.statusNotReady": "未就绪",
  "ui.rand.statusConfigured": "已配置",
  "ui.rand.statusUnconfigured": "未配置",
  // ---- 联网 server 档新增 ----
  "ui.rand.count": "取数量（字节）",
  "ui.rand.countPh": "1–1024，默认 32",
  "ui.rand.customField": "自定义字段名",
  "ui.rand.customFieldPh": "服务器 JSON 响应中的字段名（可选）",
  "ui.rand.confirmBarWarn": "开启后，每次运行前将向你填写的地址发起网络请求以获取随机数。确认启用吗？",
  "ui.rand.confirmOk": "确认启用联网",
  "ui.rand.confirmCancel": "取消",
  "ui.rand.confirmArmed": "已启用联网取数：每次运行前将向所填地址发起请求。",
  "ui.rand.confirmDisable": "停用联网",
  "ui.rand.confirmNeedEndpoint": "请先填写服务器地址，再确认启用。",
  "ui.rand.errDisabled": "未启用联网：请先在上方确认条确认启用。",
  "ui.rand.statusArmed": "联网已启用",
  "ui.rand.statusDisarmed": "联网未启用",
  "ui.rand.errFetch": "随机数服务器取数失败",
  "ui.rand.testOkBytes": "连接成功，取回 {0} 字节",
  // ---- 鼠标熵辅助项 ----
  "ui.rand.mouseAux": "附加鼠标熵",
  "ui.rand.mouseAuxDesc": "在弹窗里晃动鼠标采集本地熵，叠加到当前档位（只增不减，结果不弱于原档）。用于不受信任的系统：不让系统随机源成为单点。",
  "ui.rand.mouseStatus": "鼠标熵",
  "ui.rand.mouseReady": "已采集",
  "ui.rand.mouseNotReady": "未采集",
  "ui.rand.mouseCollect": "采集鼠标随机性",
  "ui.rand.mouseRecollect": "重新采集",
  "ui.rand.mouseTitle": "采集鼠标随机性",
  "ui.rand.mouseHint": "在下方区域快速晃动鼠标（或手指滑动），采集足够熵后点「完成」。",
  "ui.rand.mousePadHint": "在此区域晃动鼠标…",
  "ui.rand.mouseProg": "采集进度",
  "ui.rand.mouseSec": "安全性",
  "ui.rand.mouseSecWeak": "弱",
  "ui.rand.mouseSecMid": "中",
  "ui.rand.mouseSecStrong": "强",
  "ui.rand.mouseSecNote": "采集到的鼠标熵只作加料；最终输出仍会叠加所选档位的熵，故不低于该档。",
  "ui.rand.mouseDone": "完成",
  "ui.rand.mouseCancel": "取消",
  "ui.rand.mouseNeedMore": "再多晃一会儿…",
  "ui.rand.mouseDoneOk": "鼠标熵已采集（{0} 位熵估计）",
};
function t(key, ...a) {
  try {
    if (typeof window !== "undefined" && window.__ebctfT) {
      const v = window.__ebctfT(key, ...a);
      if (v && v !== key) return v;
    }
  } catch { /* 回退 */ }
  let s = _ZH[key] || key;
  for (let i = 0; i < a.length; i++) s = s.replace("{" + i + "}", String(a[i]));
  return s;
}

// ---- 配置读写（唯一碰 localStorage 的地方）----
const _EMPTY = { mode: RAND_MODES.SYSTEM, seed: "", endpoint: "", auth: "", count: 32, customField: "", serverOn: false, mouse: "", mouseOn: false };

/** 取数量归一：非法/越界一律回退边界内（1–1024，默认 32）。 */
function normalizeCount(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return 32;
  return Math.max(1, Math.min(1024, n));
}

/** 归一化配置对象：非法档位/类型一律回退默认。 */
export function normalizeRandConfig(o) {
  const src = o && typeof o === "object" ? o : {};
  const mode = src.mode === RAND_MODES.SYSTEM || MODE_ORDER.includes(src.mode) ? src.mode : RAND_MODES.SYSTEM;
  return {
    mode,
    seed: src.seed == null ? "" : String(src.seed),
    endpoint: src.endpoint == null ? "" : String(src.endpoint),
    auth: src.auth == null ? "" : String(src.auth),
    count: normalizeCount(src.count),
    customField: src.customField == null ? "" : String(src.customField).trim(),
    serverOn: src.serverOn === true,
    mouse: src.mouse == null ? "" : String(src.mouse),
    mouseOn: src.mouseOn === true,
  };
}

/** 读 localStorage 配置（缺省 = 全 system；隐私模式容错）。 */
export function loadRandConfig() {
  try {
    const raw = localStorage.getItem(RAND_KEY);
    if (!raw) return { ..._EMPTY };
    return normalizeRandConfig(JSON.parse(raw));
  } catch {
    return { ..._EMPTY };
  }
}

/** 写 localStorage（隐私模式忽略）。 */
export function saveRandConfig(cfg) {
  try { localStorage.setItem(RAND_KEY, JSON.stringify(normalizeRandConfig(cfg))); } catch { /* 隐私模式忽略 */ }
}

/** 应用配置到内存单例（core 不读存储；此处注入）+ 持久化。 */
export function applyRandConfig(cfg) {
  const c = normalizeRandConfig(cfg);
  setRandConfig(c);
  saveRandConfig(c);
  return c;
}

/**
 * 启动接线：读存储 → 注入 randSource；并订阅后续变更（含 randomSecure op 切换档位）持久化。
 * 幂等（重复调用只保留一份订阅）。由 main.js 启动时调用一次。
 */
let _installed = false;
export function installRandConfig() {
  const cfg = loadRandConfig();
  setRandConfig(cfg);
  if (!_installed) {
    _installed = true;
    // 回写必须合并——core 事件只携带 mode/seed/endpoint/auth，
    // 直接整体覆盖会把 UI 专有字段（count/customField/serverOn/mouse）抹掉。
    onRandConfigChange((next) => { saveRandConfig({ ...loadRandConfig(), ...next }); });
  }
  return cfg;
}

/** 当前生效档位（内存单例为准；供 main.js 判定是否强制主线程）。 */
export function currentRandMode() {
  return getRandConfig().mode;
}

/**
 * 完整配置：core 内存单例（mode/seed/endpoint/auth/mouse 权威）叠加本地存储中的
 * UI 专有字段（count/customField/serverOn）——core 单例不含这三者，直接读会导致
 * 结构重建时丢失「确认启用」状态、订阅回写时抹掉取数量等配置（浏览器验收发现，此处修复）。
 */
export function currentFullConfig() {
  return normalizeRandConfig({ ...loadRandConfig(), ...getRandConfig() });
}

/**
 * server 档联网是否已启用（门禁）：须同时满足
 *   ① 当前档位 = server；② endpoint 非空；③ 页面内确认条确认（serverOn=true）。
 * main.js 在每次运行前据此决定是否 warmupServer —— 未启用 ⇒ 不发任何网络请求。
 */
export function serverArmed() {
  const c = getRandConfig();
  if (c.mode !== RAND_MODES.SERVER || !String(c.endpoint || "").trim()) return false;
  try { return loadRandConfig().serverOn === true; } catch { return false; }
}

function modeLabel(mode) {
  const key = { system: "ui.rand.modeSystem", mixed: "ui.rand.modeMixed", custom: "ui.rand.modeCustom", server: "ui.rand.modeServer" }[mode];
  return key ? t(key) : mode;
}
function modeDesc(mode) {
  const key = { system: "ui.rand.modeSystemDesc", mixed: "ui.rand.modeMixedDesc", custom: "ui.rand.modeCustomDesc", server: "ui.rand.modeServerDesc" }[mode];
  return key ? t(key) : "";
}

// ---- 统一 M3 stepper（[−][框][＋]，替代浏览器原生 number spinner）----
/**
 * 造一个自实现 stepper。与 main.js 的 `.stepper` 同形（同一套 CSS），
 * 避免出现「原生上下箭头」这种与全项目不一致的控件。
 * @param {{value:number, min:number, max:number, step?:number, ariaLabel?:string, onInput:(v:number)=>void, onCommit?:(v:number)=>void}} o
 */
function buildStepper(o) {
  const min = o.min, max = o.max, step = o.step || 1;
  const inp = el("input", { type: "text", inputmode: "numeric", class: "stepper-inp", "aria-label": o.ariaLabel || "" });
  inp.value = String(o.value);
  const clamp = (n) => {
    if (Number.isNaN(n)) return n;
    if (min != null && n < min) n = min;
    if (max != null && n > max) n = max;
    return n;
  };
  const commit = (n) => {
    const v = clamp(n);
    inp.value = Number.isNaN(v) ? "" : String(v);
    o.onInput(v);
    if (o.onCommit) o.onCommit(v);
  };
  inp.addEventListener("input", () => { const n = Number(inp.value); if (!Number.isNaN(n)) o.onInput(clamp(n)); });
  inp.addEventListener("blur", () => { if (inp.value !== "") commit(Number(inp.value)); });
  const btn = (iconName, dir, label) => {
    const b = el("button", { type: "button", class: "stepper-btn", "aria-label": label, tabindex: "-1" }, msym(iconName));
    b.addEventListener("click", () => { const cur = Number(inp.value); commit((Number.isNaN(cur) ? min : cur) + dir * step); });
    return b;
  };
  return el("div", { class: "stepper" }, btn("remove", -1, "减"), inp, btn("add", 1, "加"));
}

// ---- 鼠标熵采集弹窗（独立弹窗，进度 + 安全性，形如 VC 容器 Random Pool）----
/**
 * 打开鼠标熵采集弹窗。用户在 pad 上晃动鼠标/滑动手指，累积熵样本；
 * 达到门槛后「完成」→ 把样本压成 hex 种子回调给上层（写进 mouse 档）。
 * @param {(hexSeed:string, bits:number)=>void} onDone
 * @param {()=>void} [onCancel]
 */
function openMouseCollector(onDone, onCancel) {
  const TARGET_SAMPLES = 160;   // 进度 100% 所需样本数
  const MIN_SAMPLES = 48;       // 允许「完成」的最低样本数
  const samples = [];
  let lastX = null, lastY = null, lastT = 0;
  let bits = 0;

  const overlay = el("div", { class: "rand-mouse-overlay" });
  const card = el("div", { class: "rand-mouse-card" });
  card.append(el("div", { class: "rand-mouse-title" }, msym("vpn_key"), t("ui.rand.mouseTitle")));
  card.append(el("div", { class: "rand-mouse-hint" }, t("ui.rand.mouseHint")));

  const padHint = el("div", { class: "rand-mouse-padhint" }, t("ui.rand.mousePadHint"));
  const pad = el("div", { class: "rand-mouse-pad" }, padHint);

  const barFill = el("div", { class: "rand-mouse-barfill" });
  const progPct = el("span", { class: "rand-mouse-progpct" }, "0%");
  const progRow = el("div", { class: "rand-mouse-progrow" },
    el("span", { class: "rand-mouse-lbl" }, t("ui.rand.mouseProg")),
    el("div", { class: "rand-mouse-bar" }, barFill), progPct);

  const secFill = el("div", { class: "rand-mouse-secfill" });
  const secWord = el("span", { class: "rand-mouse-secword" }, t("ui.rand.mouseSecWeak"));
  const secRow = el("div", { class: "rand-mouse-secrow" },
    el("span", { class: "rand-mouse-lbl" }, t("ui.rand.mouseSec")),
    el("div", { class: "rand-mouse-secbar" }, secFill), secWord);

  card.append(pad, progRow, secRow, el("div", { class: "rand-mouse-secnote" }, t("ui.rand.mouseSecNote")));

  const out = el("div", { class: "rand-mouse-out" });
  const doneBtn = el("button", { type: "button", class: "rand-confirm-btn primary", disabled: true }, t("ui.rand.mouseDone"));
  const cancelBtn = el("button", { type: "button", class: "rand-confirm-btn" }, t("ui.rand.mouseCancel"));
  const btns = el("div", { class: "rand-confirm-btns" }, doneBtn, cancelBtn);
  card.append(out, btns);
  overlay.append(card);

  const refresh = () => {
    const prog = Math.min(1, samples.length / TARGET_SAMPLES);
    barFill.style.width = (prog * 100).toFixed(1) + "%";
    progPct.textContent = Math.round(prog * 100) + "%";
    const sp = Math.min(1, bits / 200);
    secFill.style.width = (sp * 100).toFixed(1) + "%";
    secWord.textContent = bits < 80 ? t("ui.rand.mouseSecWeak") : (bits < 200 ? t("ui.rand.mouseSecMid") : t("ui.rand.mouseSecStrong"));
    secWord.dataset.level = bits < 80 ? "weak" : (bits < 200 ? "mid" : "strong");
    const enough = samples.length >= MIN_SAMPLES;
    doneBtn.disabled = !enough;
    if (!enough && samples.length > 0) out.textContent = t("ui.rand.mouseNeedMore");
    else out.textContent = "";
  };

  const onMove = (x, y) => {
    const now = (typeof performance !== "undefined" && performance.now) ? performance.now() : Date.now();
    if (lastX != null) {
      const dx = x - lastX, dy = y - lastY, dt = now - lastT;
      // 每样本熵估计：位移方向/幅度的不确定性（上限 8 位/样本），时间抖动只作辅助。
      const moveBits = Math.min(8, Math.log2(1 + Math.abs(dx) + Math.abs(dy)));
      bits += Math.max(0, moveBits);
      if (samples.length < 4096) samples.push(`${dx},${dy},${Math.round(dt)}`);
    }
    lastX = x; lastY = y; lastT = now;
    refresh();
  };
  const mm = (e) => { const r = pad.getBoundingClientRect(); onMove(Math.round(e.clientX - r.left), Math.round(e.clientY - r.top)); };
  const tm = (e) => { const r = pad.getBoundingClientRect(); const tt = e.touches && e.touches[0]; if (tt) onMove(Math.round(tt.clientX - r.left), Math.round(tt.clientY - r.top)); };
  pad.addEventListener("mousemove", mm);
  pad.addEventListener("touchmove", tm, { passive: true });

  const close = () => {
    pad.removeEventListener("mousemove", mm);
    pad.removeEventListener("touchmove", tm);
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  };
  const onKey = (e) => { if (e.key === "Escape") { close(); onCancel && onCancel(); } };
  document.addEventListener("keydown", onKey);

  doneBtn.addEventListener("click", () => {
    if (doneBtn.disabled) return;
    const seed = sha256HexOfUtf8(samples.join("|"));
    close();
    onDone(seed, Math.round(bits));
  });
  cancelBtn.addEventListener("click", () => { close(); onCancel && onCancel(); });
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) { close(); onCancel && onCancel(); } });

  document.body.append(overlay);
  refresh();
}

// ---- 档位配置控件（env 面板与每 op 内嵌共用）----
/**
 * 构造档位配置控件。cfg 变更经 onChange(next, {structural}) 上抛：
 *   structural=true 表示档位本身变了（控件结构需重建）；false 表示仅字段值变（不重建，保住输入焦点）。
 * @param {object} cfg 归一化配置（调用方保证 cfg.mode 非 system）
 * @param {(next:object, meta?:{structural:boolean})=>void} onChange
 * @param {{compact?:boolean, showTest?:boolean}} [opts]
 */
function buildConfigControls(cfg0, onChange, opts = {}) {
  // 控件处理器一律经 emit 读写「最新配置」，禁止闭包捕获构建时的 cfg 快照
  // （否则先填 endpoint 再点确认条会读到旧值——B2 原实现即存在此隐患，此处一并消除）。
  let cfg = cfg0;
  const emit = (patch, meta = {}) => {
    cfg = normalizeRandConfig({ ...cfg, ...patch });
    onChange(cfg, meta);
  };
  const box = el("div", { class: "rand-controls" + (opts.compact ? " rand-compact" : "") });

  // 档位下拉（只列增强档；系统档由「关掉开关」表达）
  const sel = el("select", { class: "rand-mode-select", "aria-label": t("ui.rand.mode") });
  for (const m of MODE_ORDER) sel.append(el("option", { value: m }, modeLabel(m)));
  sel.value = MODE_ORDER.includes(cfg.mode) ? cfg.mode : MODE_ORDER[0];
  sel.addEventListener("change", () => emit({ mode: sel.value }, { structural: true }));
  box.append(el("label", { class: "rand-field" },
    el("span", { class: "rand-field-label" }, t("ui.rand.mode")), sel));

  // 档位说明
  box.append(el("div", { class: "rand-mode-desc" }, modeDesc(cfg.mode)));

  // 条件字段
  if (cfg.mode === RAND_MODES.MIXED || cfg.mode === RAND_MODES.CUSTOM) {
    const seed = el("input", { type: "text", class: "rand-input", spellcheck: "false", autocomplete: "off",
      placeholder: t("ui.rand.seedPh"), value: cfg.seed });
    seed.addEventListener("input", () => emit({ seed: seed.value }));
    box.append(el("label", { class: "rand-field" },
      el("span", { class: "rand-field-label" }, t("ui.rand.seed")), seed));
  }
  if (cfg.mode === RAND_MODES.SERVER) {
    // server 档字段：任一联网相关字段被修改即自动回到「未启用」（须重新在确认条确认，
    // 防止改地址后沿用旧授权——确认条与地址须始终一一对应）。
    const emitField = (patch) => {
      const touched = "endpoint" in patch || "auth" in patch || "count" in patch || "customField" in patch;
      const disarm = touched && cfg.serverOn;
      emit({ ...patch, serverOn: disarm ? false : cfg.serverOn }, { structural: disarm });
    };
    const ep = el("input", { type: "text", class: "rand-input", spellcheck: "false", autocomplete: "off",
      placeholder: t("ui.rand.endpointPh"), value: cfg.endpoint });
    ep.addEventListener("input", () => emitField({ endpoint: ep.value }));
    const auth = el("input", { type: "text", class: "rand-input", spellcheck: "false", autocomplete: "off",
      placeholder: t("ui.rand.authPh"), value: cfg.auth });
    auth.addEventListener("input", () => emitField({ auth: auth.value }));
    // 取数量：自实现 M3 stepper（[−][框][＋]），不再用浏览器原生 number spinner。
    const count = buildStepper({
      value: cfg.count, min: 1, max: 1024, step: 1, ariaLabel: t("ui.rand.count"),
      onInput: (v) => emitField({ count: v }),
    });
    const cf = el("input", { type: "text", class: "rand-input", spellcheck: "false", autocomplete: "off",
      placeholder: t("ui.rand.customFieldPh"), value: cfg.customField });
    cf.addEventListener("input", () => emitField({ customField: cf.value }));
    box.append(el("label", { class: "rand-field" },
      el("span", { class: "rand-field-label" }, t("ui.rand.endpoint")), ep));
    box.append(el("label", { class: "rand-field" },
      el("span", { class: "rand-field-label" }, t("ui.rand.auth")), auth));
    box.append(el("div", { class: "rand-field" },
      el("span", { class: "rand-field-label" }, t("ui.rand.count")), el("div", { class: "rand-count-wrap" }, count)));
    box.append(el("label", { class: "rand-field" },
      el("span", { class: "rand-field-label" }, t("ui.rand.customField")), cf));

    // ---- 联网确认条（页面内确认，弃 window.confirm；恒烈 2026-10-09 裁决②）----
    // 只有在此确认条上点「确认启用联网」后 serverOn 才为 true，才可能发起网络请求；
    // 默认 serverOn=false ⇒ 全项目零网络请求。
    const confirmOut = el("div", { class: "rand-test-out" });
    if (cfg.serverOn) {
      const bar = el("div", { class: "rand-confirm-bar armed" },
        el("div", { class: "rand-confirm-text" }, msym("public"), t("ui.rand.confirmArmed")));
      const off = el("button", { type: "button", class: "rand-confirm-btn" }, t("ui.rand.confirmDisable"));
      off.addEventListener("click", () => emit({ serverOn: false }, { structural: true }));
      bar.append(el("div", { class: "rand-confirm-btns" }, off));
      box.append(bar);
    } else {
      const bar = el("div", { class: "rand-confirm-bar" },
        el("div", { class: "rand-confirm-text" }, msym("warning"), t("ui.rand.confirmBarWarn")));
      const ok = el("button", { type: "button", class: "rand-confirm-btn primary" }, t("ui.rand.confirmOk"));
      const cancel = el("button", { type: "button", class: "rand-confirm-btn" }, t("ui.rand.confirmCancel"));
      ok.addEventListener("click", () => {
        confirmOut.textContent = "";
        confirmOut.classList.remove("error");
        if (!cfg.endpoint.trim()) {
          confirmOut.textContent = t("ui.rand.confirmNeedEndpoint");
          confirmOut.classList.add("error");
          return;
        }
        emit({ serverOn: true }, { structural: true });
      });
      cancel.addEventListener("click", () => {
        confirmOut.textContent = "";
        confirmOut.classList.remove("error");
      });
      bar.append(el("div", { class: "rand-confirm-btns" }, ok, cancel));
      box.append(bar);
      box.append(confirmOut);
    }

    if (opts.showTest) {
      const testBtn = el("button", { type: "button", class: "rand-test-btn" }, msym("sync"), t("ui.rand.testConn"));
      const testOut = el("div", { class: "rand-test-out" });
      testBtn.addEventListener("click", async () => {
        testOut.textContent = "";
        testOut.classList.remove("error");
        if (!cfg.serverOn) {
          // 未在确认条启用联网 → 不发任何请求（默认关闭零请求硬门禁）。
          testOut.textContent = "✗ " + t("ui.rand.errDisabled");
          testOut.classList.add("error");
          return;
        }
        try {
          const got = await warmupServer({ count: cfg.count, customField: cfg.customField }); // 已确认启用后才联网
          testOut.textContent = "✓ " + t("ui.rand.testOkBytes", got);
        } catch (e) {
          testOut.textContent = "✗ " + ((e && e.message) || String(e));
          testOut.classList.add("error");
        }
      });
      box.append(el("div", { class: "rand-test-row" }, testBtn, testOut));
    }
    box.append(el("div", { class: "rand-warn" }, t("ui.rand.warnServer")));
  }

  // ---- 鼠标熵辅助项（对 mixed / custom / server 三档通用；system 档不渲染本面板）----
  {
    const ready = isMouseReady();
    const uid = "randMouseAuxCb" + (++_uid);
    const cb = el("input", { type: "checkbox", id: uid });
    cb.checked = cfg.mouseOn === true && ready;
    const collectBtn = el("button", { type: "button", class: "rand-test-btn" },
      msym("vpn_key"), ready ? t("ui.rand.mouseRecollect") : t("ui.rand.mouseCollect"));
    const status = el("span", { class: "rand-mouse-status" + (ready ? " ok" : "") },
      t("ui.rand.mouseStatus") + "：" + (ready ? t("ui.rand.mouseReady") : t("ui.rand.mouseNotReady")));
    const collect = () => {
      openMouseCollector((hexSeed, bits) => {
        emit({ mouse: hexSeed, mouseOn: true }, { structural: true }); // 采集完自动开启辅助
        if (opts.onMouseDone) opts.onMouseDone(bits);
      });
    };
    collectBtn.addEventListener("click", collect);
    cb.addEventListener("change", () => {
      if (cb.checked) {
        if (isMouseReady()) emit({ mouseOn: true }, { structural: true });
        else { cb.checked = false; collect(); } // 未采集 → 先采集，采完自动开启
      } else {
        emit({ mouseOn: false }, { structural: true });
      }
    });
    box.append(el("div", { class: "rand-field rand-mouse-row" },
      el("span", { class: "rand-field-label" }, t("ui.rand.mouseAux")),
      el("label", { class: "switch", for: uid }, cb, el("span", { class: "track" }), el("span", { class: "knob" })),
      collectBtn, status));
    box.append(el("div", { class: "rand-mouse-auxdesc" }, t("ui.rand.mouseAuxDesc")));
  }

  // 强警示（恒烈点名，规划原文照录）
  if (cfg.mode === RAND_MODES.CUSTOM) {
    box.append(el("div", { class: "rand-warn" }, t("ui.rand.warnCustom")));
  }

  // 状态行
  let statusText;
  if (cfg.mode === RAND_MODES.SERVER) {
    statusText = t("ui.rand.endpoint") + "：" + (cfg.endpoint ? t("ui.rand.statusConfigured") : t("ui.rand.statusUnconfigured")) +
      " · " + t("ui.rand.status") + "：" + (isServerReady() ? t("ui.rand.statusReady") : t("ui.rand.statusNotReady")) +
      " · " + (cfg.serverOn ? t("ui.rand.statusArmed") : t("ui.rand.statusDisarmed")) +
      " · " + t("ui.rand.count") + "=" + cfg.count;
  } else {
    statusText = t("ui.rand.status") + "：" + t("ui.rand.statusReady");
  }
  box.append(el("div", { class: "rand-status" }, statusText));

  // 主线程说明（非 system 档才有意义）
  box.append(el("div", { class: "rand-note-worker" }, msym("warning"), t("ui.rand.workerNote")));
  return box;
}

/** 档位标识徽章（非 system 档常驻显示）。 */
function modeBadge(mode) {
  if (mode === RAND_MODES.SYSTEM) return null;
  return el("span", { class: "rand-mode-badge", title: t("ui.rand.current") + "：" + modeLabel(mode) },
    msym("vpn_key"), t("ui.rand.current") + "：" + modeLabel(mode));
}

/** 开关行（env 面板与每 op 内嵌共用）。返回 { row, checkbox }。 */
function buildToggleRow(checked, id) {
  const cb = el("input", { type: "checkbox", id });
  cb.checked = checked;
  const row = el("div", { class: "rand-sec-row" },
    el("label", { class: "switch", for: id }, cb, el("span", { class: "track" }), el("span", { class: "knob" })),
    el("label", { class: "rand-sec-label", for: id }, msym("vpn_key"), t("ui.rand.toggle")),
  );
  return { row, cb };
}

// ============================================================
// ① 环境面板一节（全局入口）
// ============================================================
export function renderRandSecureSection() {
  const sec = el("div", { class: "env-section env-rand-box" });
  sec.append(el("div", { class: "env-section-title" }, msym("vpn_key"), t("ui.rand.title")));
  sec.append(el("div", { class: "rand-note" }, t("ui.rand.note")));

  const build = () => {
    sec.querySelectorAll(".rand-sec-row, .rand-body, .rand-off-hint, .rand-mode-badge").forEach((n) => n.remove());
    const cfg = currentFullConfig();
    const on = cfg.mode !== RAND_MODES.SYSTEM;
    const { row, cb } = buildToggleRow(on, "randEnvCb");
    sec.append(row);
    const badge = modeBadge(cfg.mode);
    if (badge) sec.append(badge);
    if (on) {
      const body = el("div", { class: "rand-body" });
      body.append(buildConfigControls(cfg, (next, meta) => {
        applyRandConfig(next);
        // 仅档位本身变化才重建本区（控件结构随档位条件变化）；字段值变化不重建，保住输入焦点。
        if (meta && meta.structural) build();
      }, { showTest: true, onMouseDone: () => build() }));
      sec.append(body);
    } else {
      sec.append(el("div", { class: "rand-off-hint" }, t("ui.rand.off")));
    }
    cb.addEventListener("change", () => {
      const cur = currentFullConfig();
      if (cb.checked) {
        const nextMode = cur.mode === RAND_MODES.SYSTEM ? RAND_MODES.MIXED : cur.mode;
        applyRandConfig({ ...cur, mode: nextMode });
      } else {
        applyRandConfig({ ...cur, mode: RAND_MODES.SYSTEM });
      }
      build();
    });
  };
  build();
  return sec;
}

// ============================================================
// ② 每 op 内嵌勾选框（默认关；仅「消耗随机性」的 op 由 main.js 调用）
// ============================================================
/**
 * 渲染每 op 的【增强随机性】开关 + 展开区。
 * @param {HTMLElement} host 容器（main.js renderOp 的挂载点）
 * @param {{onChange?:()=>void}} [opts] onChange：档位变化后的回调（main.js 用于刷新/重跑）
 */
export function renderRandSecureToggle(host, opts = {}) {
  const wrap = el("div", { class: "rand-sec" });
  const render = () => {
    wrap.innerHTML = "";
    const cfg = currentFullConfig();
    const checked = cfg.mode !== RAND_MODES.SYSTEM;

    const { row, cb } = buildToggleRow(checked, "randSecureCb");
    const badge = modeBadge(cfg.mode);
    if (badge) row.append(badge);
    wrap.append(row);

    if (checked) {
      // 开 → 就地展开档位选择与配置
      const expand = el("div", { class: "rand-sec-expand" });
      expand.append(buildConfigControls(cfg, (next, meta) => {
        applyRandConfig(next);
        // 仅档位变化才重建（保住 seed/endpoint 输入焦点）；字段值变化就地生效。
        if (meta && meta.structural) { render(); opts.onChange && opts.onChange(); }
      }, { onMouseDone: () => { render(); opts.onChange && opts.onChange(); } }));
      wrap.append(expand);
    }

    cb.addEventListener("change", () => {
      const cur = currentFullConfig();
      if (cb.checked) {
        // 开：system → 默认切到 mixed（最稳的增强档）；已有非 system 则保持
        const nextMode = cur.mode === RAND_MODES.SYSTEM ? RAND_MODES.MIXED : cur.mode;
        applyRandConfig({ ...cur, mode: nextMode });
      } else {
        // 关：回到 system（保留 seed/endpoint/auth/mouse 便于再开）
        applyRandConfig({ ...cur, mode: RAND_MODES.SYSTEM });
      }
      render();
      opts.onChange && opts.onChange();
    });
  };
  render();
  host.append(wrap);
  return wrap;
}
