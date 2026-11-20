/*
 * nodeCard.js — T953 节点卡片候选（算法节点 + @input/@output/@const/@note 特殊节点）。
 *
 * 合同（MT809）：
 *   算法卡片：名称、方向切换（只有一个方向的不显示切换）、端口列表（含已提升的参数端口）、
 *             状态徽标（未运行/运行中/成功/失败/被阻断/已禁用）、耗时、
 *             输出预览前 N 字符 + 「查看完整输出」、错误原文。
 *   特殊节点：@input（文本/hex/base64/文件四种来源）、@output（文本/hex/下载）、@const、@note。
 *
 * DOM 契约（check.mjs 依赖）：
 *   [data-nv="card"][data-op-id] / card-name / card-dir[data-toggle] / card-status[data-status] /
 *   card-elapsed[data-ms] / card-output[data-truncated][data-expanded] / card-view-full /
 *   card-error / card-port[data-port-id][data-port-kind][data-port-type][data-port-dir]
 *   [data-nv="special-card"][data-special] / special-error
 */

import { tNv, directionInfo, portsOf, portTypeLabel, opNameOf, PORT_TYPE } from "../core.js";

export const STATUSES = ["idle", "running", "success", "error", "blocked", "disabled"];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function portRow(p) {
  const li = el("li", "nv-port");
  li.dataset.nv = "card-port";
  li.dataset.portId = p.id;
  li.dataset.portKind = p.kind;
  li.dataset.portDir = p.direction;
  li.dataset.portType = p.type;
  li.dataset.portLabel = p.label;
  if (p.paramKey) li.dataset.paramKey = p.paramKey;
  if (p.fieldKey) li.dataset.fieldKey = p.fieldKey;
  const dot = el("span", "nv-port-dot");
  const name = el("span", "nv-port-name", p.label);
  const code = el("code", "nv-port-id", p.id);
  const type = el("span", "nv-port-type", portTypeLabel(p.type));
  type.dataset.portTypeLabel = p.type;
  li.append(dot, name, code, type);
  return li;
}

/**
 * 算法节点卡片。
 * @param {object} op registry op
 * @param {object} options { direction, promoted, status, elapsedMs, output, error, previewChars, onDirectionChange }
 * @returns {{ el: HTMLElement, update(patch):void, getState():object, setPromoted(keys):void }}
 */
export function createNodeCard(op, options = {}) {
  const dir = directionInfo(op);
  const state = {
    direction: options.direction || dir.value,
    promoted: Array.isArray(options.promoted) ? options.promoted.slice() : [],
    status: STATUSES.includes(options.status) ? options.status : "idle",
    elapsedMs: Number.isFinite(options.elapsedMs) ? options.elapsedMs : null,
    output: options.output != null ? String(options.output) : "",
    error: options.error != null ? String(options.error) : "",
    previewChars: Number.isFinite(options.previewChars) ? options.previewChars : 120,
    expanded: false,
  };

  const root = el("article", "nv-card");
  root.dataset.nv = "card";
  root.dataset.opId = op.id;
  root.tabIndex = 0;

  const head = el("header", "nv-card-head");
  const titleWrap = el("div", "nv-card-title");
  const name = el("h3", "nv-card-name", opNameOf(op) || op.id);
  name.dataset.nv = "card-name";
  const idc = el("code", "nv-card-id", op.id);
  idc.dataset.nv = "card-id";
  titleWrap.append(name, idc);

  // 方向切换：仅双向 op 渲染；单向完全不出现切换控件
  const dirBox = el("div", "nv-card-dir");
  dirBox.dataset.nv = "card-dir";
  dirBox.dataset.toggle = String(dir.toggle);
  if (!dir.toggle) dirBox.hidden = true;
  dirBox.setAttribute("role", "group");
  dirBox.setAttribute("aria-label", tNv("nv.card.direction"));
  const dirBtns = new Map();
  if (dir.toggle) {
    for (const d of dir.options) {
      const b = el("button", "nv-dir-btn", tNv("nv.card." + d));
      b.type = "button";
      b.dataset.dir = d;
      b.setAttribute("aria-pressed", String(d === state.direction));
      b.addEventListener("click", () => {
        api.update({ direction: d });
        if (typeof options.onDirectionChange === "function") options.onDirectionChange(d);
      });
      dirBtns.set(d, b);
      dirBox.append(b);
    }
  }

  const badge = el("span", "nv-badge");
  badge.dataset.nv = "card-status";

  head.append(titleWrap, dirBox, badge);

  const portList = el("ul", "nv-ports");
  portList.dataset.nv = "card-ports";

  const body = el("div", "nv-card-body");
  const meta = el("div", "nv-card-meta");
  const elapsed = el("span", "nv-elapsed");
  elapsed.dataset.nv = "card-elapsed";
  meta.append(el("span", "nv-meta-label", tNv("nv.card.elapsed")), elapsed);

  const outWrap = el("div", "nv-out-wrap");
  const outHead = el("div", "nv-out-head");
  outHead.append(
    el("span", "nv-out-label", tNv("nv.card.output")),
    (() => { const s = el("span", "nv-out-note", tNv("nv.card.previewNote", state.previewChars)); s.dataset.nv = "card-preview-note"; return s; })(),
  );
  const outPre = el("pre", "nv-out");
  outPre.dataset.nv = "card-output";
  const viewFull = el("button", "nv-link-btn", tNv("nv.card.viewFull"));
  viewFull.type = "button";
  viewFull.dataset.nv = "card-view-full";
  viewFull.hidden = true;
  viewFull.addEventListener("click", () => api.update({ expanded: !state.expanded }));
  outWrap.append(outHead, outPre, viewFull);

  const errPre = el("pre", "nv-error");
  errPre.dataset.nv = "card-error";
  errPre.hidden = true;
  errPre.setAttribute("aria-label", tNv("nv.card.error"));

  body.append(meta, outWrap, errPre);
  root.append(head, portList, body);

  function renderPorts() {
    portList.textContent = "";
    const ports = portsOf(op, state.promoted);
    for (const p of ports) portList.append(portRow(p));
  }

  function renderStatus() {
    badge.dataset.status = state.status;
    badge.dataset.nv = "card-status";
    badge.textContent = tNv("nv.status." + state.status);
    badge.className = "nv-badge nv-status-" + state.status;
  }

  function renderElapsed() {
    elapsed.dataset.ms = state.elapsedMs == null ? "" : String(state.elapsedMs);
    elapsed.textContent = state.elapsedMs == null
      ? tNv("nv.card.elapsedNone")
      : tNv("nv.card.elapsedMs", state.elapsedMs);
  }

  function renderOutput() {
    const text = state.output;
    if (!text) {
      outPre.textContent = tNv("nv.card.outputEmpty");
      outPre.dataset.empty = "true";
      outPre.dataset.truncated = "false";
      outPre.dataset.expanded = "false";
      viewFull.hidden = true;
      return;
    }
    outPre.dataset.empty = "false";
    const truncated = !state.expanded && text.length > state.previewChars;
    outPre.textContent = truncated ? text.slice(0, state.previewChars) + "\u2026" : text;
    outPre.dataset.truncated = String(truncated);
    outPre.dataset.expanded = String(state.expanded);
    viewFull.hidden = text.length <= state.previewChars;
    viewFull.textContent = state.expanded ? tNv("nv.card.collapseFull") : tNv("nv.card.viewFull");
  }

  function renderError() {
    const has = !!state.error;
    errPre.hidden = !has;
    errPre.dataset.nv = "card-error";
    if (has) errPre.textContent = state.error;
    else errPre.textContent = "";
  }

  function renderDirection() {
    for (const [d, b] of dirBtns) b.setAttribute("aria-pressed", String(d === state.direction));
    root.dataset.direction = state.direction;
  }

  const api = {
    el: root,
    op,
    update(patch = {}) {
      if (patch.direction && dir.options.includes(patch.direction)) state.direction = patch.direction;
      if (patch.promoted) state.promoted = patch.promoted.slice();
      if (patch.status && STATUSES.includes(patch.status)) state.status = patch.status;
      if ("elapsedMs" in patch) {
        state.elapsedMs = Number.isFinite(patch.elapsedMs) ? patch.elapsedMs : null;
      }
      if ("output" in patch) {
        state.output = patch.output == null ? "" : String(patch.output);
        if (state.expanded && !state.output) state.expanded = false;
      }
      if ("error" in patch) state.error = patch.error == null ? "" : String(patch.error);
      if (Number.isFinite(patch.previewChars)) state.previewChars = patch.previewChars;
      if ("expanded" in patch) state.expanded = !!patch.expanded;
      renderDirection();
      renderPorts();
      renderStatus();
      renderElapsed();
      renderOutput();
      renderError();
      return api;
    },
    getState() {
      return { ...state, promoted: state.promoted.slice(), ports: portsOf(op, state.promoted) };
    },
    ports() { return portsOf(op, state.promoted); },
    setPromoted(keys) { return api.update({ promoted: keys || [] }); },
    setStatus(s) { return api.update({ status: s }); },
    setOutput(text) { return api.update({ output: text }); },
    setError(text) { return api.update({ error: text }); },
    setElapsed(ms) { return api.update({ elapsedMs: ms }); },
    nameEl: name,
    outputEl: outPre,
    viewFullEl: viewFull,
  };

  api.update({});
  return api;
}

/* ============================ 特殊节点 ============================ */

const HEX_RE = /^[0-9a-fA-F\s]*$/;
const B64_RE = /^[A-Za-z0-9+/=\s]*$/;

/**
 * 特殊节点卡片。
 * kind: 'input' | 'output' | 'const' | 'note'
 * options: { value, source, mode, name, constType, filename, onChange(patch) }
 */
export function createSpecialNode(kind, options = {}) {
  const state = {
    source: options.source || "text",      // @input: text|hex|base64|file
    value: options.value != null ? String(options.value) : "",
    mode: options.mode || "text",           // @output: text|hex|download
    name: options.name || "const",          // @const
    constType: options.constType || "text", // @const: text|number
    filename: options.filename || "",
    fileName: "",
    error: "",
  };

  const root = el("article", "nv-card nv-special");
  root.dataset.nv = "card";
  root.dataset.special = kind;
  root.dataset.status = "idle";
  root.tabIndex = 0;

  const head = el("header", "nv-card-head");
  const titleWrap = el("div", "nv-card-title");
  const title = el("h3", "nv-card-name", tNv("nv.special." + kind));
  title.dataset.nv = "card-name";
  const tag = el("code", "nv-card-id", "@" + kind);
  titleWrap.append(title, tag);
  head.append(titleWrap);

  const portList = el("ul", "nv-ports");
  portList.dataset.nv = "card-ports";
  const body = el("div", "nv-card-body");
  const errLine = el("div", "nv-insp-hint");
  errLine.dataset.nv = "special-error";
  errLine.hidden = true;

  function renderPorts() {
    portList.textContent = "";
    let ports = [];
    if (kind === "input") {
      ports = [{
        id: "out", kind: "out", direction: "out",
        type: state.source === "file" ? PORT_TYPE.BYTES : PORT_TYPE.TEXT,
        label: tNv("nv.input.outPort"),
      }];
    } else if (kind === "output") {
      ports = [{ id: "in", kind: "in", direction: "in", type: PORT_TYPE.TEXT, label: tNv("nv.output.inPort") }];
    } else if (kind === "const") {
      ports = [{
        id: "out", kind: "out", direction: "out",
        type: state.constType === "number" ? PORT_TYPE.TEXT : PORT_TYPE.TEXT,
        label: tNv("nv.const.value"),
      }];
    }
    for (const p of ports) portList.append(portRow(p));
    portList.hidden = ports.length === 0;
  }

  function row(labelText, ctl) {
    const wrap = el("div", "nv-field");
    const lab = el("label", "nv-field-label", labelText);
    wrap.append(lab, ctl);
    return wrap;
  }

  function selectControl(values, current, onChange, dataAttr) {
    const sel = document.createElement("select");
    sel.className = "nv-select";
    sel.dataset.nv = dataAttr;
    for (const v of values) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = tNv(`nv.${dataAttr === "input-source" ? "input.src" : "output.mode"}.${v}`);
      sel.append(o);
    }
    sel.value = current;
    sel.addEventListener("change", () => onChange(sel.value));
    return sel;
  }

  function emit() {
    if (typeof options.onChange === "function") {
      options.onChange({ kind, ...state });
    }
  }

  function showError(msg) {
    state.error = msg || "";
    errLine.hidden = !state.error;
    errLine.textContent = state.error;
    root.dataset.invalid = String(!!state.error);
  }

  if (kind === "input") {
    const srcSel = selectControl(["text", "hex", "base64", "file"], state.source, (v) => {
      state.source = v;
      renderPorts();
      body.querySelector('[data-nv="input-file-row"]').hidden = v !== "file";
      body.querySelector('[data-nv="input-value-row"]').hidden = v === "file";
      checkValue();
      emit();
    }, "input-source");

    const ta = document.createElement("textarea");
    ta.className = "nv-textarea";
    ta.dataset.nv = "input-value";
    ta.placeholder = tNv("nv.input.placeholder");
    ta.value = state.value;
    ta.addEventListener("input", () => { state.value = ta.value; checkValue(); emit(); });

    function checkValue() {
      if (state.source === "hex" && !HEX_RE.test(state.value)) showError(tNv("nv.input.errHex"));
      else if (state.source === "base64" && !B64_RE.test(state.value)) showError(tNv("nv.input.errBase64"));
      else showError("");
    }

    const fileRow = el("div", "nv-field");
    fileRow.dataset.nv = "input-file-row";
    fileRow.hidden = state.source !== "file";
    const fileBtn = el("button", "nv-link-btn", tNv("nv.input.chooseFile"));
    fileBtn.type = "button";
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.hidden = true;
    const fileName = el("span", "nv-file-name", state.fileName || tNv("nv.input.noFile"));
    fileName.dataset.nv = "input-file-name";
    fileBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const f = fileInput.files && fileInput.files[0];
      state.fileName = f ? f.name : "";
      fileName.textContent = state.fileName || tNv("nv.input.noFile");
      emit();
    });
    fileRow.append(fileBtn, fileInput, fileName);

    const valueRow = row(tNv("nv.input.value"), ta);
    valueRow.dataset.nv = "input-value-row";
    valueRow.hidden = state.source === "file";
    body.append(row(tNv("nv.input.source"), srcSel), valueRow, fileRow, errLine);
    checkValue();
  } else if (kind === "output") {
    const modeSel = selectControl(["text", "hex", "download"], state.mode, (v) => {
      state.mode = v;
      fnRow.hidden = v !== "download";
      hintLine.hidden = v !== "download";
      emit();
    }, "output-mode");
    const fnInput = document.createElement("input");
    fnInput.type = "text";
    fnInput.className = "nv-input";
    fnInput.dataset.nv = "output-filename";
    fnInput.placeholder = tNv("nv.output.defaultName");
    fnInput.value = state.filename;
    fnInput.addEventListener("input", () => { state.filename = fnInput.value; emit(); });
    const fnRow = row(tNv("nv.output.filename"), fnInput);
    fnRow.hidden = state.mode !== "download";
    const hintLine = el("div", "nv-insp-hint", tNv("nv.output.downloadHint"));
    hintLine.hidden = state.mode !== "download";
    body.append(row(tNv("nv.output.mode"), modeSel), fnRow, hintLine, errLine);
  } else if (kind === "const") {
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "nv-input";
    nameInput.dataset.nv = "const-name";
    nameInput.placeholder = tNv("nv.const.namePlaceholder");
    nameInput.value = state.name;
    nameInput.addEventListener("input", () => { state.name = nameInput.value; emit(); });

    const typeSel = document.createElement("select");
    typeSel.className = "nv-select";
    typeSel.dataset.nv = "const-type";
    for (const v of ["text", "number"]) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = tNv("nv.const.type." + v);
      typeSel.append(o);
    }
    typeSel.value = state.constType;
    typeSel.addEventListener("change", () => { state.constType = typeSel.value; checkConst(); emit(); });

    const valInput = document.createElement("input");
    valInput.type = "text";
    valInput.className = "nv-input";
    valInput.dataset.nv = "const-value";
    valInput.placeholder = tNv("nv.const.valuePlaceholder");
    valInput.value = state.value;
    valInput.addEventListener("input", () => { state.value = valInput.value; checkConst(); emit(); });

    function checkConst() {
      if (state.constType === "number" && state.value !== "" && !Number.isFinite(Number(state.value))) {
        showError(tNv("nv.const.errNumber"));
      } else showError("");
    }

    body.append(
      row(tNv("nv.const.name"), nameInput),
      row(tNv("nv.const.type"), typeSel),
      row(tNv("nv.const.value"), valInput),
      errLine,
    );
    checkConst();
  } else {
    const ta = document.createElement("textarea");
    ta.className = "nv-textarea";
    ta.dataset.nv = "note-value";
    ta.placeholder = tNv("nv.note.placeholder");
    ta.value = state.value;
    ta.addEventListener("input", () => { state.value = ta.value; emit(); });
    const valueRow = row(tNv("nv.note.label"), ta);
    body.append(valueRow);
  }

  const api = {
    el: root,
    kind,
    getState() { return { ...state }; },
    setValue(v) {
      state.value = String(v == null ? "" : v);
      const n = body.querySelector('[data-nv="input-value"],[data-nv="const-value"],[data-nv="note-value"]');
      if (n) { n.value = state.value; n.dispatchEvent(new Event("input")); }
      return api;
    },
    setConstType(v) {
      state.constType = v;
      const s = body.querySelector('[data-nv="const-type"]');
      if (s) { s.value = v; s.dispatchEvent(new Event("change")); }
      return api;
    },
    setSource(v) {
      state.source = v;
      const s = body.querySelector('[data-nv="input-source"]');
      if (s) { s.value = v; s.dispatchEvent(new Event("change")); }
      return api;
    },
    setMode(v) {
      state.mode = v;
      const s = body.querySelector('[data-nv="output-mode"]');
      if (s) { s.value = v; s.dispatchEvent(new Event("change")); }
      return api;
    },
    ports() {
      return Array.from(portList.querySelectorAll('[data-nv="card-port"]')).map((li) => ({
        id: li.dataset.portId, type: li.dataset.portType, direction: li.dataset.portDir,
      }));
    },
    errorText() { return state.error; },
  };

  renderPorts();
  root.append(head, portList, body);
  return api;
}
