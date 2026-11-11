/*
 * batchPanel.js — 批处理面板（已由 main.js 接线：首页按钮 / 多文件拖入 / op 页按钮）。
 *
 * 本文件不 import main.js，不读全局 state；文件队列与产物走共享草稿管理。
 * 算法能力从传入的 ctx 取：
 *
 *   ctx = {
 *     planBatch,   // src/core/batchRun.js 的 planBatch
 *     runBatch,    // src/core/batchRun.js 的 runBatch
 *     buildZip,    // src/core/batchRun.js 的 buildZip
 *     op,          // 可选：要批量跑的 op 对象（有 run / encode / decode 之一即可）
 *     params,      // 可选：op 参数对象（与单次执行的参数同形）
 *     dir,         // 可选：初始条目数组 [{ name, file }]，接线时把已有拖入队列塞进来
 *     t,           // 可选：i18n 取词函数；缺省时用本文件内置中文兜底表
 *     download,    // 可选：(bytes, filename, mime) => void；缺省走 <a download> 兜底
 *   }
 *
 * 返回值：一个 <div class="batch-panel">，同时挂了四个方法便于接线：
 *   panel.setFiles(FileList | File[])  重新装载条目（文件选择框 / 已有文件数组）
 *   panel.acceptDataTransfer(dt)       接管拖入的 DataTransfer（含目录递归）
 *   panel.getState()                   只读快照，便于主线程调试与测试
 *   panel.isBusy()                     是否正在执行（接线层据此阻止运行中关窗）
 *
 * 样式用局部 <style> 内联（全部规则以 .batch-panel 前缀收窄），不新增 css 文件、
 * 不改 app.css。M 若要把样式挪进 app.css，删掉 ensureStyles() 即可。
 *
 * 失败与跳过一律显式展示：预检被拒、类型不支持、读取失败、取消未派发，都写进
 * 行状态与结果表，不做静默丢弃。
 */

import { connectSpecialDraft, newDraftIdentity } from './workspaceDrafts.js';
import { withLimitContext } from '../core/limitGuard.js';

const FALLBACK = {
  "ui.batch.title": "批量处理",
  "ui.batch.sub": "拖入多个文件或整个文件夹，逐条处理后可单条下载或打包成 ZIP",
  "ui.batch.drop": "把文件 / 文件夹拖到这里，或点下面的按钮选择",
  "ui.batch.pickFiles": "选择文件",
  "ui.batch.pickDir": "选择文件夹",
  "ui.batch.run": "开始处理",
  "ui.batch.cancel": "取消",
  "ui.batch.zip": "打包下载 ZIP",
  "ui.batch.clear": "清空列表",
  "ui.batch.empty": "还没有条目",
  "ui.batch.col.name": "名称",
  "ui.batch.col.size": "大小",
  "ui.batch.col.status": "状态",
  "ui.batch.col.ms": "耗时",
  "ui.batch.col.action": "操作",
  "ui.batch.st.pending": "待处理",
  "ui.batch.st.ok": "成功",
  "ui.batch.st.fail": "失败",
  "ui.batch.st.rejected": "预检拒绝",
  "ui.batch.st.skipped": "已取消",
  "ui.batch.st.running": "处理中",
  "ui.batch.st.binary": "二进制，原样打包",
  "ui.batch.download": "下载",
  "ui.batch.summary": "共 {0} 条：成功 {1}，失败 {2}，跳过 {3}，预检拒绝 {4}",
  "ui.batch.noplan": "没有可处理的条目",
  "ui.batch.zipEmpty": "没有成功的结果可以打包",
  "ui.batch.needCore": "batchPanel 缺少核心依赖：{0}",
  "ui.batch.readFail": "读取失败：{0}",
  "ui.batch.walkFail": "目录遍历失败：{0}",
  "ui.batch.emptyDir": "文件夹里没有可处理的文件：{0}",
  "ui.batch.noRelPath": "无法保留目录路径，按文件名打包：{0}",
  "ui.batch.multiOut": "该 op 产出 {0} 个文件，批处理每条只保留第 1 个",
  "ui.batch.unsupported": "不支持的文件系统条目：{0}",
  "ui.batch.tooMany": "条目过多，只接收前 {0} 条，其余已丢弃（原因：超出面板队列上限）",
  "ui.batch.noOp": "未配置 op，仅原样打包",
  "ui.batch.noResult": "op 未返回可识别的结果，原样打包",
  "ui.batch.cancelReason": "用户点击取消",
  "ui.batch.zipName": "batch-{0}.zip",
  "ui.batch.zipFail": "打包失败：{0}",
  "ui.batch.runFail": "批处理未完成：{0}",
  "ui.batch.cancelled": "已取消：{0}",
  "ui.batch.allowAll": "本次全部允许超限读取",
};

const QUEUE_MAX = 500;
const EMPTY = new Uint8Array(0);

function fmtSize(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "?";
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(2) + " MB";
}

function el(tag, attrs) {
  const node = document.createElement(tag);
  const a = attrs || {};
  const keys = Object.keys(a);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = a[k];
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.slice(0, 2) === "on" && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, String(v));
  }
  for (let i = 2; i < arguments.length; i++) {
    const child = arguments[i];
    if (child === null || child === undefined) continue;
    node.append(child);
  }
  return node;
}

function ensureStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("batch-panel-style")) return;
  const css = [
    ".batch-panel{display:flex;flex-direction:column;gap:12px;font-size:var(--fs-sm,14px);color:var(--on-surface)}",
    ".batch-panel .bp-head{display:flex;flex-direction:column;gap:2px}",
    ".batch-panel .bp-title{font-weight:600;font-size:15px}",
    ".batch-panel .bp-sub{color:var(--on-surface-var);font-size:var(--fs-xs,13px);line-height:1.6}",
    ".batch-panel .bp-drop{border:1px dashed var(--outline);border-radius:var(--r-lg,16px);padding:24px;text-align:center;background:var(--surface-1);color:var(--on-surface-var)}",
    ".batch-panel .bp-drop.bp-over{border-color:var(--primary);background:var(--primary-container);color:var(--on-primary-container)}",
    ".batch-panel .bp-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
    ".batch-panel .bp-check{display:inline-flex;align-items:center;gap:6px;font-size:var(--fs-xs,13px);color:var(--on-surface-var);cursor:pointer;user-select:none}",
    ".batch-panel .bp-check input{margin:0;accent-color:var(--primary)}",
    ".batch-panel button{font:inherit;min-height:40px;padding:8px 16px;border-radius:var(--r-full,999px);border:0;background:var(--surface-3);color:var(--on-surface);cursor:pointer;transition:background var(--dur-short) var(--ease),transform var(--dur-short) var(--ease)}",
    ".batch-panel button:hover:not(:disabled){background:var(--surface-hi)}",
    ".batch-panel button:active:not(:disabled){transform:scale(.97)}",
    ".batch-panel button[disabled]{opacity:.4;cursor:not-allowed}",
    ".batch-panel button.bp-primary{background:var(--primary);color:var(--on-primary)}",
    ".batch-panel button.bp-primary:hover:not(:disabled){background:color-mix(in srgb,var(--on-primary) 8%,var(--primary))}",
    ".batch-panel .bp-notes{font-size:var(--fs-xs,13px);color:var(--on-surface-var);white-space:pre-wrap}",
    ".batch-panel .bp-table{width:100%;border-collapse:collapse;font-size:var(--fs-xs,13px)}",
    ".batch-panel .bp-table th,.batch-panel .bp-table td{text-align:start;padding:8px;border-bottom:1px solid var(--outline-var);vertical-align:top}",
    ".batch-panel .bp-table td.bp-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}",
    ".batch-panel .bp-name{word-break:break-all}",
    ".batch-panel .bp-ok{color:var(--success)}",
    ".batch-panel .bp-fail{color:var(--error)}",
    ".batch-panel .bp-skip{color:var(--on-surface-var)}",
    ".batch-panel .bp-err{font-size:var(--fs-xs,13px);color:var(--on-surface-var);word-break:break-all}",
    ".batch-dialog{max-width:min(1040px,96vw)}",
    ".batch-dialog .batch-panel{overflow:auto;min-height:0;max-height:calc(82vh - 92px);padding-right:2px}",
  ].join("\n");
  const style = document.createElement("style");
  style.id = "batch-panel-style";
  style.textContent = css;
  document.head.append(style);
}

/**
 * 构造批处理面板。
 * @param {object} ctx 见文件头
 * @returns {HTMLDivElement} 面板根节点（带 setFiles / getState 方法）
 */
export function batchPanel(ctx) {
  const c = ctx || {};
  const missing = [];
  if (typeof c.planBatch !== "function") missing.push("planBatch");
  if (typeof c.runBatch !== "function") missing.push("runBatch");
  if (typeof c.buildZip !== "function") missing.push("buildZip");
  if (missing.length) throw new TypeError("batchPanel 缺少核心依赖：" + missing.join(" / "));

  ensureStyles();

  const dict = (c.t && typeof c.t === "function") ? c.t : null;
  function t(key) {
    const args = [];
    for (let i = 1; i < arguments.length; i++) args.push(arguments[i]);
    let s;
    if (dict) {
      try {
        s = dict.apply(null, arguments);
      } catch (e) {
        s = key;
      }
      if (typeof s !== "string" || s === key) s = (FALLBACK[key] !== undefined) ? FALLBACK[key] : key;
    } else {
      s = (FALLBACK[key] !== undefined) ? FALLBACK[key] : key;
    }
    return s.replace(/\{(\d+)\}/g, (m, n) => {
      const idx = Number(n);
      return (idx < args.length) ? String(args[idx]) : m;
    });
  }

  function downloadBytes(bytes, name, mime) {
    if (typeof c.download === "function") {
      c.download(bytes, name, mime || "application/octet-stream");
      return;
    }
    const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = el("a", { href: url, download: name || "download.bin" });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- 状态 ----
  let seq = 0;
  let entries = [];       // { id, name, size, type, file, status, reason, out, bytes, ms, ms2 }
  let lastPlan = null;
  let lastRun = null;
  let token = null;
  let busy = false;
  const notes = [];
  let draft = null, generation = 0, disposed = false, binaryKey = newDraftIdentity();
  let allowAllRun = false;

  function note(msg) {
    notes.push(msg);
    if (notes.length > 40) notes.shift();
    renderNotes();
  }

  // ---- 骨架 ----
  const root = el("div", { class: "batch-panel" });
  const notesBox = el("div", { class: "bp-notes" });
  const listBody = el("tbody");
  const resultBody = el("tbody");
  const summary = el("div", { class: "bp-sub" });

  const btnPickFiles = el("button", { type: "button", text: t("ui.batch.pickFiles") });
  const btnPickDir = el("button", { type: "button", text: t("ui.batch.pickDir") });
  const btnRun = el("button", { type: "button", class: "bp-primary", text: t("ui.batch.run") });
  const btnCancel = el("button", { type: "button", text: t("ui.batch.cancel"), disabled: true });
  const btnZip = el("button", { type: "button", text: t("ui.batch.zip") });
  const btnClear = el("button", { type: "button", text: t("ui.batch.clear") });
  const allowAllCb = el("input", { type: "checkbox", id: "batchAllowAll" });
  allowAllCb.checked = false;
  const allowAllLabel = el("label", { class: "bp-check", for: "batchAllowAll" },
    allowAllCb, el("span", {}, t("ui.batch.allowAll")));

  const fileInput = el("input", { type: "file", multiple: true, style: "display:none" });
  const dirInput = el("input", { type: "file", multiple: true, webkitdirectory: true, style: "display:none" });

  const drop = el("div", { class: "bp-drop", text: t("ui.batch.drop") });

  root.append(
    el("div", { class: "bp-head" },
      el("div", { class: "bp-title", text: t("ui.batch.title") }),
      el("div", { class: "bp-sub", text: t("ui.batch.sub") }),
    ),
    drop,
    el("div", { class: "bp-row" }, btnPickFiles, btnPickDir, btnRun, btnCancel, btnZip, btnClear, allowAllLabel),
    notesBox,
    el("table", { class: "bp-table" },
      el("thead", {}, el("tr", {},
        el("th", { text: t("ui.batch.col.name") }),
        el("th", { text: t("ui.batch.col.size") }),
        el("th", { text: t("ui.batch.col.status") }),
        el("th", { text: t("ui.batch.col.action") }),
      )),
      listBody,
    ),
    el("table", { class: "bp-table" },
      el("thead", {}, el("tr", {},
        el("th", { text: t("ui.batch.col.name") }),
        el("th", { text: t("ui.batch.col.status") }),
        el("th", { text: t("ui.batch.col.ms") }),
        el("th", { text: t("ui.batch.col.action") }),
      )),
      resultBody,
    ),
    summary,
    fileInput,
    dirInput,
  );

  function renderNotes() {
    notesBox.textContent = notes.join("\n");
  }

  // ---- 条目装载 ----
  function addFiles(files) {
    const arr = [];
    for (let i = 0; i < files.length; i++) arr.push(files[i]);
    const room = QUEUE_MAX - entries.length;
    if (arr.length > room) {
      note(t("ui.batch.tooMany", QUEUE_MAX));
    }
    const take = arr.slice(0, Math.max(0, room));
    for (let i = 0; i < take.length; i++) {
      const f = take[i];
      const inner = (f && f.file) ? f.file : f;
      // 显式 { name, file } 用自己的 name；裸 File 优先 webkitRelativePath，
      // 否则目录拖入/目录选择会把所有子文件压成同名 basename，ZIP 里目录结构全丢。
      const rel = (f && f.file && typeof f.name === "string" && f.name) ? f.name
        : ((typeof inner.webkitRelativePath === "string" && inner.webkitRelativePath) ? inner.webkitRelativePath : inner.name);
      entries.push({
        id: "b" + (seq++),
        name: rel,
        size: (typeof inner.size === "number") ? inner.size : 0,
        type: inner.type || "",
        file: inner,
        status: "pending",
        reason: "",
        out: null,
        bytes: null,
        ms: 0,
      });
    }
    renderList();
    binaryKey = newDraftIdentity(); draft?.changed();
  }

  // 目录拖入：webkitGetAsEntry 递归收集。不支持的条目显式记进 notes，不静默丢。
  async function collectEntry(entry, prefix, out) {
    if (!entry) return;
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      const rel = (prefix ? prefix + "/" : "") + entry.name;
      try {
        Object.defineProperty(file, "webkitRelativePath", { value: rel, configurable: true });
      } catch (e) {
        // 只读属性环境：退化为文件名，不影响打包，但要把差异说出来。
        note(t("ui.batch.noRelPath", rel));
      }
      out.push(file);
      return;
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch || batch.length === 0) break;
        for (let i = 0; i < batch.length; i++) {
          await collectEntry(batch[i], (prefix ? prefix + "/" : "") + entry.name, out);
        }
      }
      return;
    }
    note(t("ui.batch.unsupported", entry.name || "(未命名)"));
  }

  async function addDataTransfer(dt) {
    if (!dt) return;
    const epoch = generation;
    const items = dt.items;
    const collected = [];
    const jobs = [];
    // webkitGetAsEntry / getAsFile 只在 drop 事件同步阶段可靠；必须在任何 await 之前
    // 把所有条目一次性取下来，否则第二个及之后的 DataTransferItem 会被浏览器失效。
    if (items && items.length) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it || it.kind !== "file") continue;
        const entry = (typeof it.webkitGetAsEntry === "function") ? it.webkitGetAsEntry() : null;
        if (entry) {
          jobs.push({ entry, name: entry.name || "(未命名)" });
          continue;
        }
        const f = (typeof it.getAsFile === "function") ? it.getAsFile() : null;
        if (f) jobs.push({ file: f });
        else note(t("ui.batch.unsupported", "(无法读取的拖入项)"));
      }
    }
    if (!jobs.length) {
      if (dt.files && dt.files.length) addFiles(dt.files);
      else note(t("ui.batch.emptyDir", "(拖入项)"));
      return;
    }
    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      if (job.file) {
        collected.push(job.file);
        continue;
      }
      const before = collected.length;
      try {
        await collectEntry(job.entry, "", collected);
      } catch (e) {
        note(t("ui.batch.walkFail", (e && e.message) ? e.message : String(e)));
      }
      // 空目录不能静默消失：明确告诉用户该文件夹里一个文件都没收到。
      if (job.entry.isDirectory && collected.length === before) {
        note(t("ui.batch.emptyDir", job.name));
      }
    }
    if (collected.length && epoch === generation && !disposed) addFiles(collected);
  }

  // ---- 渲染 ----
  function statusText(e) {
    if (e.status === "ok") return t("ui.batch.st.ok");
    if (e.status === "fail") return t("ui.batch.st.fail");
    if (e.status === "rejected") return t("ui.batch.st.rejected");
    if (e.status === "skipped") return t("ui.batch.st.skipped");
    if (e.status === "running") return t("ui.batch.st.running");
    return t("ui.batch.st.pending");
  }

  function statusClass(e) {
    if (e.status === "ok") return "bp-ok";
    if (e.status === "fail" || e.status === "rejected") return "bp-fail";
    if (e.status === "skipped") return "bp-skip";
    return "";
  }

  function renderList() {
    listBody.textContent = "";
    if (!entries.length) {
      listBody.append(el("tr", {}, el("td", { colspan: 4, class: "bp-sub", text: t("ui.batch.empty") })));
      return;
    }
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const dl = el("button", { type: "button", text: t("ui.batch.download"), disabled: !e.bytes });
      dl.addEventListener("click", () => {
        if (e.bytes) downloadBytes(e.bytes, e.out && e.out.name ? e.out.name : e.name);
      });
      const st = el("td", { class: statusClass(e) }, statusText(e));
      if (e.reason) st.append(el("div", { class: "bp-err", text: e.reason }));
      listBody.append(el("tr", {},
        el("td", { class: "bp-name", text: e.name }),
        el("td", { class: "bp-num", text: fmtSize(e.size) }),
        st,
        el("td", {}, dl),
      ));
    }
  }

  function renderResults(run) {
    resultBody.textContent = "";
    if (!run || !run.results || !run.results.length) return;
    const byId = new Map();
    for (let i = 0; i < entries.length; i++) byId.set(entries[i].id, entries[i]);
    for (let i = 0; i < run.results.length; i++) {
      const r = run.results[i];
      const owner = byId.get(r.id);
      const ok = !!r.ok;
      const cell = el("td", { class: ok ? "bp-ok" : (r.skipped ? "bp-skip" : "bp-fail") },
        ok ? t("ui.batch.st.ok") : (r.skipped ? t("ui.batch.st.skipped") : t("ui.batch.st.fail")));
      if (!ok && r.error) cell.append(el("div", { class: "bp-err", text: r.error }));
      const dl = el("button", { type: "button", text: t("ui.batch.download"), disabled: !(owner && owner.bytes) });
      dl.addEventListener("click", () => {
        if (owner && owner.bytes) downloadBytes(owner.bytes, owner.name);
      });
      resultBody.append(el("tr", {},
        el("td", { class: "bp-name", text: owner ? owner.name : r.id }),
        cell,
        el("td", { class: "bp-num", text: (typeof r.ms === "number" ? r.ms + " ms" : "") }),
        el("td", {}, dl),
      ));
    }
  }

  function setBusy(v) {
    busy = v;
    btnRun.disabled = v;
    btnPickFiles.disabled = v;
    btnPickDir.disabled = v;
    btnClear.disabled = v;
    btnCancel.disabled = !v;
    allowAllCb.disabled = v;
  }

  // ---- 执行 ----
  // 文本解码走严格模式：非 UTF-8 的条目不会被 U+FFFD 悄悄替换，而是标成二进制原样打包。
  function localToken() {
    const tk = {
      cancelled: false,
      reason: "",
      cancel(reason) {
        if (tk.cancelled) return tk.reason;
        tk.cancelled = true;
        const r = (typeof reason === "string") ? reason.trim() : "";
        tk.reason = r || "已取消";
        return tk.reason;
      },
    };
    return tk;
  }

  function decodeStrict(bytes) {
    try {
      return { ok: true, text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) };
    } catch (e) {
      return { ok: false, reason: (e && e.message) ? e.message : "非法 UTF-8 序列" };
    }
  }

  async function applyOp(bytes) {
    const op = c.op;
    if (!op || (typeof op.run !== "function" && typeof op.encode !== "function" && typeof op.decode !== "function")) {
      return { bytes, text: "", note: t("ui.batch.noOp") };
    }
    const params = Object.assign({}, c.params || {});
    if (allowAllRun) params._allowLimitOverride = true;
    const wantDecode = params.__dir === "decode";
    const fn = (typeof op.run === "function") ? op.run : (wantDecode ? op.decode : op.encode);
    if (typeof fn !== "function") return { bytes, text: "", note: t("ui.batch.noOp") };
    let input = "";
    if (op.acceptsBytes) {
      params.rawBytes = bytes;
    } else {
      const dec = decodeStrict(bytes);
      if (!dec.ok) return { bytes, text: "", note: t("ui.batch.st.binary") };
      input = dec.text;
    }
    // 部分 op（bzip2Enc / scrypt / bcrypt 等）是异步实现；withLimitContext
    // 会 await，避免把 Promise 当未知返回静默退化成「原样打包」。
    let res = await withLimitContext(params, () => fn(input, params));
    if (typeof res === "string") {
      const enc = new TextEncoder().encode(res);
      return { bytes: enc, text: res, note: "" };
    }
    if (res && typeof res === "object") {
      const text = (typeof res.text === "string") ? res.text : "";
      let outBytes = null;
      let note = "";
      if (Array.isArray(res.files) && res.files.length) {
        const f0 = res.files[0];
        if (f0 && f0.bytes) outBytes = (f0.bytes instanceof Uint8Array) ? f0.bytes : new Uint8Array(f0.bytes);
        if (res.files.length > 1) note = t("ui.batch.multiOut", res.files.length);
      }
      if (!outBytes) outBytes = new TextEncoder().encode(text);
      return { bytes: outBytes, text, note };
    }
    if (res instanceof Uint8Array) return { bytes: res, text: "", note: "" };
    return { bytes, text: "", note: t("ui.batch.noResult") };
  }

  async function start() {
    if (busy) return;
    if (!entries.length) {
      note(t("ui.batch.noplan"));
      return;
    }
    // 空文件是用户明确选中的真实条目（不是空目录）：显式给一个长度 0 的 bytes，
    // 让预检区分「0 字节文件」与「没有任何内容的空条目」。
    const pending = entries.filter(e => e.status !== 'ok' || !e.bytes);
    if (!pending.length) return;
    const epoch = ++generation;
    const plan = c.planBatch(pending.map((e) => ({
      id: e.id, name: e.name, size: e.size, type: e.type,
      bytes: e.size === 0 ? EMPTY : undefined,
    })));
    lastPlan = plan;
    const rejectedById = new Map();
    for (let i = 0; i < plan.rejected.length; i++) rejectedById.set(plan.rejected[i].id, plan.rejected[i]);
    for (const e of pending) {
      const rej = rejectedById.get(e.id);
      e.status = rej ? "rejected" : "pending";
      e.reason = rej ? rej.reason : "";
      e.out = null;
      e.bytes = null;
      e.ms = 0;
    }
    renderList();
    binaryKey = newDraftIdentity(); draft?.changed();

    if (!plan.stats.accepted) {
      note(t("ui.batch.noplan"));
      return;
    }

    token = (typeof c.makeCancelToken === "function") ? c.makeCancelToken() : localToken();
    setBusy(true);
    const byId = new Map();
    for (let i = 0; i < entries.length; i++) byId.set(entries[i].id, entries[i]);

    let run;
    allowAllRun = !!allowAllCb.checked;
    try {
      run = await c.runBatch(plan, async (item) => {
        const owner = byId.get(item.id);
        if (epoch !== generation || disposed) throw new Error(t('ui.batch.cancelReason'));
        if (!owner) throw new Error("结果找不到对应条目：" + item.id);
        owner.status = "running";
        renderList();
        let buf;
        try {
          buf = await owner.file.arrayBuffer();
        } catch (e) {
          throw new Error(t("ui.batch.readFail", (e && e.message) ? e.message : String(e)));
        }
        const bytes = new Uint8Array(buf);
        if (epoch !== generation || disposed) throw new Error(t('ui.batch.cancelReason'));
        const applied = await applyOp(bytes, owner.name);
        if (epoch !== generation || disposed) throw new Error(t('ui.batch.cancelReason'));
        owner.out = { name: owner.name, text: applied.text, note: applied.note };
        owner.bytes = applied.bytes;
        owner.status = 'ok'; binaryKey = newDraftIdentity(); draft?.changed();
        if (applied.note) owner.reason = applied.note;
        // 让出一次事件循环：纯 JS op 与 File.arrayBuffer 的 Promise 会连成微任务链，
        // 不让出的话定时器/取消点击要等整批跑完才处理，取消按钮形同虚设。
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { size: applied.bytes.length };
      }, { concurrency: 1, cancelToken: token });
    } catch (e) {
      if (epoch !== generation || disposed) return;
      setBusy(false);
      note(t("ui.batch.runFail", (e && e.message) ? e.message : String(e)));
      return;
    } finally {
      allowAllRun = false;
      allowAllCb.checked = false;
    }

    if (epoch !== generation || disposed) return;
    lastRun = run;
    for (let i = 0; i < run.results.length; i++) {
      const r = run.results[i];
      const owner = byId.get(r.id);
      if (!owner) continue;
      owner.ms = r.ms;
      if (r.skipped) {
        owner.status = "skipped";
        owner.reason = r.error || "";
      } else if (r.ok) owner.status = "ok";
      else {
        owner.status = "fail";
        owner.reason = r.error;
      }
    }
    if (run.cancelled) note(t("ui.batch.cancelled", run.reason));
    setBusy(false);
    renderList();
    renderResults(run);
    updateSummary(); draft?.changed();
  }

  function makeZip() {
    const rows = entries.filter((e) => e.status === "ok" && e.bytes);
    if (!rows.length) {
      note(t("ui.batch.zipEmpty"));
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    try {
      const bytes = c.buildZip(rows.map((e) => ({ name: e.name, bytes: e.bytes })));
      downloadBytes(bytes, t("ui.batch.zipName", stamp), "application/zip");
    } catch (e) {
      note(t("ui.batch.zipFail", (e && e.message) ? e.message : String(e)));
    }
  }

  // ---- 事件 ----
  btnPickFiles.addEventListener("click", () => fileInput.click());
  btnPickDir.addEventListener("click", () => dirInput.click());
  fileInput.addEventListener("change", (ev) => {
    const fl = ev.target.files;
    if (fl && fl.length) addFiles(fl);
    ev.target.value = "";
  });
  dirInput.addEventListener("change", (ev) => {
    const fl = ev.target.files;
    if (fl && fl.length) addFiles(fl);
    else note(t("ui.batch.emptyDir", "(文件夹)"));
    ev.target.value = "";
  });
  btnRun.addEventListener("click", () => { start(); });
  btnCancel.addEventListener("click", () => {
    if (token) token.cancel(t("ui.batch.cancelReason"));
    else note(t("ui.batch.needCore", "makeCancelToken"));
  });
  btnZip.addEventListener("click", makeZip);
  function clearQueue() {
    generation++; token?.cancel(t('ui.batch.cancelReason')); token = null; setBusy(false);
    binaryKey = newDraftIdentity();
    entries = []; lastPlan = lastRun = null; notes.length = 0;
    renderNotes(); renderList(); renderResults(null); summary.textContent = '';
  }
  function updateSummary() {
    summary.textContent = t('ui.batch.summary', entries.length, entries.filter(e => e.status === 'ok').length,
      entries.filter(e => e.status === 'fail').length, entries.filter(e => e.status === 'skipped').length, entries.filter(e => e.status === 'rejected').length);
  }
  btnClear.addEventListener("click", () => {
    if (busy) return;
    clearQueue(); draft?.changed();
  });

  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("bp-over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("bp-over"));
  drop.addEventListener("drop", async (e) => {
    e.preventDefault();
    drop.classList.remove("bp-over");
    if (busy) return;
    try {
      await addDataTransfer(e.dataTransfer);
    } catch (err) {
      note(t("ui.batch.walkFail", (err && err.message) ? err.message : String(err)));
    }
  });

  renderList();

  // 接线时可先塞初始条目
  if (Array.isArray(c.dir) && c.dir.length) {
    addFiles(c.dir);
  }

  root.setFiles = (files) => {
    if (busy) return;
    addFiles(files);
  };
  root.acceptDataTransfer = (dt) => {
    if (busy) return Promise.resolve();
    return addDataTransfer(dt);
  };
  root.isBusy = () => busy;
  root.getState = () => ({
    entries: entries.map((e) => ({
      id: e.id, name: e.name, size: e.size, status: e.status, reason: e.reason, ms: e.ms,
      bytes: e.bytes ? e.bytes.length : 0,
      out: e.out ? { name: e.out.name, text: e.out.text, note: e.out.note } : null,
    })),
    plan: lastPlan ? lastPlan.stats : null,
    run: lastRun ? lastRun.stats : null,
    notes: notes.slice(),
  });
  draft = connectSpecialDraft(`batch:${c.op?.id || 'files'}:${c.op?.direction || c.params?.__dir || 'encode'}`, root, {
    capture: () => ({ binaryKey, entries, params: c.params, notes, planStats: lastPlan?.stats, lastRun }),
    restore(saved, current) {
      if (!saved || entries.length || !current() || disposed) return;
      binaryKey = saved.binaryKey || newDraftIdentity();
      c.params = saved.params || c.params;
      entries = (saved.entries || []).map(e => ({ ...e,
        status: e.status === 'running' ? 'pending' : e.status,
        reason: e.status === 'running' ? t('ui.batch.interrupted') : e.reason,
      }));
      for (const entry of entries) {
        if (!(entry.file instanceof Blob) && !(entry.status === 'ok' && entry.bytes)) {
          entry.status = 'fail'; entry.reason = t('ui.workbench.draftStorageError');
        }
      }
      seq = entries.reduce((max, e) => Math.max(max, Number(String(e.id).slice(1)) + 1 || 0), 0);
      notes.splice(0, notes.length, ...(saved.notes || [])); lastPlan = saved.planStats ? { stats: saved.planStats } : null;
      lastRun = saved.lastRun || null; renderList(); renderResults(lastRun); renderNotes(); updateSummary();
    },
    clear: clearQueue,
  });
  root.ready = draft.ready;
  root.dispose = () => { allowAllRun = false; draft.dispose(); disposed = true; generation++; token?.cancel(t('ui.batch.cancelReason')); };
  return root;
}
