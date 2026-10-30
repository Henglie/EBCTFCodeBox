/*
 * batchPanel.js — 批处理面板（候选模块，待 M 在 main.js 接线）。
 *
 * 本文件是**候选 UI 模块**：不被任何既有文件 import，主线程 M 决定挂在哪里之后
 * 再 import 并接线。不 import main.js，不读全局 state，不碰 localStorage，
 * 所有能力一律从传入的 ctx 取：
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
 * 返回值：一个 <div class="batch-panel">，同时挂了两个方法便于接线：
 *   panel.setFiles(FileList | File[])  重新装载条目（拖入多文件/文件夹时用）
 *   panel.getState()                   只读快照，便于主线程调试与测试
 *
 * 样式用局部 <style> 内联（全部规则以 .batch-panel 前缀收窄），不新增 css 文件、
 * 不改 app.css。M 若要把样式挪进 app.css，删掉 ensureStyles() 即可。
 *
 * 失败与跳过一律显式展示：预检被拒、类型不支持、读取失败、取消未派发，都写进
 * 行状态与结果表，不做静默丢弃。
 */

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
  "ui.batch.unsupported": "不支持的文件系统条目：{0}",
  "ui.batch.tooMany": "条目过多，只接收前 {0} 条，其余已丢弃（原因：超出面板队列上限）",
  "ui.batch.noOp": "未配置 op，仅原样打包",
  "ui.batch.cancelReason": "用户点击取消",
  "ui.batch.zipName": "batch-{0}.zip",
  "ui.batch.zipFail": "打包失败：{0}",
  "ui.batch.runFail": "批处理未完成：{0}",
  "ui.batch.cancelled": "已取消：{0}",
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
    ".batch-panel{display:flex;flex-direction:column;gap:10px;font-size:13px;color:var(--fg,#e6e6e6)}",
    ".batch-panel .bp-head{display:flex;flex-direction:column;gap:2px}",
    ".batch-panel .bp-title{font-weight:600;font-size:15px}",
    ".batch-panel .bp-sub{opacity:.7;font-size:12px}",
    ".batch-panel .bp-drop{border:1px dashed rgba(255,255,255,.28);border-radius:10px;padding:16px;text-align:center;opacity:.85}",
    ".batch-panel .bp-drop.bp-over{border-color:var(--accent,#7cc4ff);opacity:1}",
    ".batch-panel .bp-row{display:flex;gap:8px;flex-wrap:wrap}",
    ".batch-panel button{font:inherit;padding:5px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.06);color:inherit;cursor:pointer}",
    ".batch-panel button[disabled]{opacity:.4;cursor:not-allowed}",
    ".batch-panel button.bp-primary{border-color:var(--accent,#7cc4ff)}",
    ".batch-panel .bp-notes{font-size:12px;opacity:.75;white-space:pre-wrap}",
    ".batch-panel .bp-table{width:100%;border-collapse:collapse;font-size:12px}",
    ".batch-panel .bp-table th,.batch-panel .bp-table td{text-align:left;padding:4px 6px;border-bottom:1px solid rgba(255,255,255,.08);vertical-align:top}",
    ".batch-panel .bp-table td.bp-num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}",
    ".batch-panel .bp-name{word-break:break-all}",
    ".batch-panel .bp-ok{color:#5fd08a}",
    ".batch-panel .bp-fail{color:#ff8a8a}",
    ".batch-panel .bp-skip{opacity:.6}",
    ".batch-panel .bp-err{font-size:11px;opacity:.8;word-break:break-all}",
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

  const fileInput = el("input", { type: "file", multiple: true, style: "display:none" });
  const dirInput = el("input", { type: "file", multiple: true, webkitdirectory: true, style: "display:none" });

  const drop = el("div", { class: "bp-drop", text: t("ui.batch.drop") });

  root.append(
    el("div", { class: "bp-head" },
      el("div", { class: "bp-title", text: t("ui.batch.title") }),
      el("div", { class: "bp-sub", text: t("ui.batch.sub") }),
    ),
    drop,
    el("div", { class: "bp-row" }, btnPickFiles, btnPickDir, btnRun, btnCancel, btnZip, btnClear),
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
      const rel = (typeof f.name === "string" && f.name) ? f.name
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
        note(t("ui.batch.unsupported", rel));
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
    const items = dt.items;
    const canWalk = items && items.length && typeof items[0].webkitGetAsEntry === "function";
    if (!canWalk) {
      if (dt.files && dt.files.length) addFiles(dt.files);
      return;
    }
    const collected = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it || it.kind !== "file") continue;
      const entry = it.webkitGetAsEntry();
      if (!entry) {
        const f = it.getAsFile ? it.getAsFile() : null;
        if (f) collected.push(f);
        else note(t("ui.batch.unsupported", "(无法读取的拖入项)"));
        continue;
      }
      try {
        await collectEntry(entry, "", collected);
      } catch (e) {
        note(t("ui.batch.walkFail", (e && e.message) ? e.message : String(e)));
      }
    }
    if (collected.length) addFiles(collected);
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

  function applyOp(bytes) {
    const op = c.op;
    if (!op || (typeof op.run !== "function" && typeof op.encode !== "function" && typeof op.decode !== "function")) {
      return { bytes, text: "", note: t("ui.batch.noOp") };
    }
    const params = Object.assign({}, c.params || {});
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
    const res = fn(input, params);
    if (typeof res === "string") {
      const enc = new TextEncoder().encode(res);
      return { bytes: enc, text: res, note: "" };
    }
    if (res && typeof res === "object") {
      const text = (typeof res.text === "string") ? res.text : "";
      let outBytes = null;
      if (Array.isArray(res.files) && res.files.length) {
        const f0 = res.files[0];
        if (f0 && f0.bytes) outBytes = (f0.bytes instanceof Uint8Array) ? f0.bytes : new Uint8Array(f0.bytes);
      }
      if (!outBytes) outBytes = new TextEncoder().encode(text);
      return { bytes: outBytes, text, note: "" };
    }
    if (res instanceof Uint8Array) return { bytes: res, text: "", note: "" };
    return { bytes, text: "", note: t("ui.batch.noOp") };
  }

  async function start() {
    if (busy) return;
    if (!entries.length) {
      note(t("ui.batch.noplan"));
      return;
    }
    // 空文件是用户明确选中的真实条目（不是空目录）：显式给一个长度 0 的 bytes，
    // 让预检区分「0 字节文件」与「没有任何内容的空条目」。
    const plan = c.planBatch(entries.map((e) => ({
      id: e.id, name: e.name, size: e.size, type: e.type,
      bytes: e.size === 0 ? EMPTY : undefined,
    })));
    lastPlan = plan;
    const rejectedById = new Map();
    for (let i = 0; i < plan.rejected.length; i++) rejectedById.set(plan.rejected[i].id, plan.rejected[i]);
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const rej = rejectedById.get(e.id);
      e.status = rej ? "rejected" : "pending";
      e.reason = rej ? rej.reason : "";
      e.out = null;
      e.bytes = null;
      e.ms = 0;
    }
    renderList();

    if (!plan.stats.accepted) {
      note(t("ui.batch.noplan"));
      return;
    }

    token = (typeof c.makeCancelToken === "function") ? c.makeCancelToken() : localToken();
    setBusy(true);
    const byId = new Map();
    for (let i = 0; i < entries.length; i++) byId.set(entries[i].id, entries[i]);

    let run;
    try {
      run = await c.runBatch(plan, async (item) => {
        const owner = byId.get(item.id);
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
        const applied = applyOp(bytes, owner.name);
        owner.out = { name: owner.name, text: applied.text, note: applied.note };
        owner.bytes = applied.bytes;
        if (applied.note) owner.reason = applied.note;
        return { size: applied.bytes.length };
      }, { concurrency: 1, cancelToken: token });
    } catch (e) {
      setBusy(false);
      note(t("ui.batch.runFail", (e && e.message) ? e.message : String(e)));
      return;
    }

    lastRun = run;
    for (let i = 0; i < run.results.length; i++) {
      const r = run.results[i];
      const owner = byId.get(r.id);
      if (!owner) continue;
      owner.ms = r.ms;
      if (r.skipped) owner.status = "skipped";
      else if (r.ok) owner.status = "ok";
      else {
        owner.status = "fail";
        owner.reason = r.error;
      }
    }
    if (run.cancelled) note(t("ui.batch.cancelled", run.reason));
    setBusy(false);
    renderList();
    renderResults(run);
    summary.textContent = t("ui.batch.summary", plan.stats.total, run.stats.ok, run.stats.failed, run.stats.skipped, plan.stats.rejected);
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
    ev.target.value = "";
  });
  btnRun.addEventListener("click", () => { start(); });
  btnCancel.addEventListener("click", () => {
    if (token) token.cancel(t("ui.batch.cancelReason"));
    else note(t("ui.batch.needCore", "makeCancelToken"));
  });
  btnZip.addEventListener("click", makeZip);
  btnClear.addEventListener("click", () => {
    if (busy) return;
    entries = [];
    lastPlan = null;
    lastRun = null;
    notes.length = 0;
    renderNotes();
    renderList();
    renderResults(null);
    summary.textContent = "";
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
  root.getState = () => ({
    entries: entries.map((e) => ({ id: e.id, name: e.name, size: e.size, status: e.status, reason: e.reason, ms: e.ms })),
    plan: lastPlan ? lastPlan.stats : null,
    run: lastRun ? lastRun.stats : null,
    notes: notes.slice(),
  });
  return root;
}
