/*
 * inspector.js — T953 检查器候选（按算法参数定义渲染全部参数类型 + 提升为端口）。
 *
 * 合同（MT809）：
 *   - 参数类型全覆盖：text / number / bool / select / password / textarea / image；
 *     与算法页（main.js renderParam）同一套取值与校验规则，见 core.validateParam 注释；
 *   - 每个参数旁有「提升为端口 / 收回」按钮；
 *   - 口令类（type=password）与敏感参数（d.sensitive / 敏感 key 名单）默认遮蔽，可点眼睛临时显示。
 *
 * DOM 契约（check.mjs 依赖）：
 *   [data-nv="inspector"] / insp-param[data-key][data-type][data-value] /
 *   insp-input / insp-toggle / insp-select / insp-promote[data-key][aria-pressed] /
 *   insp-hint / insp-eye / insp-empty / insp-param-count
 */

import {
  tNv, opNameOf, paramKind, paramLabel, isSensitive, optionValue, optionLabel,
  initialParams, validateParam, validateParams, defaultParamValue,
} from "../core.js";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * @param {object} op registry op
 * @param {object} options { values, promoted, onChange(values, meta), onPromote(keys, key) }
 */
export function createInspector(op, options = {}) {
  const state = {
    values: { ...initialParams(op), ...(options.values || {}) },
    promoted: new Set(Array.isArray(options.promoted) ? options.promoted : []),
    errors: {},
  };

  const root = el("section", "nv-inspector");
  root.dataset.nv = "inspector";
  root.dataset.opId = op.id;

  const head = el("header", "nv-insp-head");
  const title = el("h3", "nv-insp-title", tNv("nv.insp.title"));
  const sub = el("span", "nv-insp-op", opNameOf(op));
  sub.dataset.nv = "insp-op-name";
  const count = el("span", "nv-count", "");
  count.dataset.nv = "insp-param-count";
  head.append(title, sub, count);

  const list = el("div", "nv-insp-list");
  list.dataset.nv = "insp-list";

  const empty = el("div", "nv-insp-empty", tNv("nv.insp.empty"));
  empty.dataset.nv = "insp-empty";

  root.append(head, list, empty);

  const rows = new Map();

  function emit(key) {
    if (typeof options.onChange === "function") {
      options.onChange({ ...state.values }, { key, errors: { ...state.errors } });
    }
  }

  function setHint(key, hint) {
    const r = rows.get(key);
    if (!r) return;
    r.hint.hidden = !hint;
    r.hint.textContent = hint || "";
  }

  /** 写入一个参数值：clamp/回退规则同算法页；同步 data-value 与提示。 */
  function write(key, raw, { commit = false } = {}) {
    const d = op.params.find((p) => p.key === key);
    if (!d) return null;
    const kind = paramKind(d);
    const res = validateParam(d, raw);
    if (res.ok) {
      state.values[key] = res.value;
      delete state.errors[key];
      setHint(key, res.hint || "");
    } else if (commit) {
      // 算法页 blur 时的提交语义：非法数字清空、非法下拉回退默认
      state.values[key] = res.value;
      state.errors[key] = res.code;
      setHint(key, res.hint || "");
    } else {
      // 输入中途不覆盖用户输入，只标错（避免输入负号/小数点被吞）
      state.values[key] = raw;
      state.errors[key] = res.code;
      setHint(key, res.hint || "");
    }
    const r = rows.get(key);
    if (r) {
      r.row.dataset.value = String(state.values[key]);
      r.row.dataset.invalid = String(!!state.errors[key]);
    }
    emit(key);
    return res;
  }

  function maskedInput(attrs) {
    const inp = document.createElement("input");
    Object.assign(inp, attrs);
    inp.type = "password";
    inp.autocomplete = "off";
    inp.spellcheck = false;
    inp.dataset.masked = "true";
    return inp;
  }

  function eyeButton(input) {
    const b = el("button", "nv-eye-btn");
    b.type = "button";
    b.dataset.nv = "insp-eye";
    b.setAttribute("aria-pressed", "true"); // true = 当前遮蔽
    b.title = tNv("nv.insp.show");
    b.setAttribute("aria-label", tNv("nv.insp.show"));
    b.textContent = "\u25c9";
    b.addEventListener("click", () => {
      const masked = input.type === "password";
      input.type = masked ? "text" : "password";
      b.setAttribute("aria-pressed", String(!masked));
      b.title = masked ? tNv("nv.insp.hide") : tNv("nv.insp.show");
      b.setAttribute("aria-label", b.title);
      b.dataset.masked = String(!masked);
    });
    return b;
  }

  function buildRow(d) {
    const kind = paramKind(d);
    const row = el("div", "nv-insp-param");
    row.dataset.nv = "insp-param";
    row.dataset.key = d.key;
    row.dataset.type = kind;
    row.dataset.sensitive = String(isSensitive(d));
    row.dataset.value = String(state.values[d.key]);
    row.dataset.invalid = "false";

    const headRow = el("div", "nv-insp-row-head");
    const lab = el("label", "nv-insp-label", paramLabel(d));
    lab.htmlFor = "nv_p_" + d.key;
    if (isSensitive(d)) lab.append(el("span", "nv-tag", tNv("nv.insp.sensitive")));
    const promote = el("button", "nv-promote-btn");
    promote.type = "button";
    promote.dataset.nv = "insp-promote";
    promote.dataset.key = d.key;
    promote.setAttribute("aria-pressed", String(state.promoted.has(d.key)));
    promote.textContent = state.promoted.has(d.key) ? tNv("nv.insp.demote") : tNv("nv.insp.promote");
    promote.title = tNv(state.promoted.has(d.key) ? "nv.insp.demote" : "nv.insp.promote");
    promote.addEventListener("click", () => api.togglePromote(d.key));
    headRow.append(lab, promote);

    const ctl = el("div", "nv-insp-ctl");
    let input = null;

    if (kind === "bool") {
      const wrap = el("label", "nv-switch");
      input = document.createElement("input");
      input.type = "checkbox";
      input.id = "nv_p_" + d.key;
      input.checked = !!state.values[d.key];
      input.dataset.nv = "insp-toggle";
      input.addEventListener("change", () => write(d.key, input.checked, { commit: true }));
      wrap.append(input, el("span", "nv-switch-track"), el("span", "nv-switch-knob"));
      ctl.append(wrap);
    } else if (kind === "select") {
      input = document.createElement("select");
      input.className = "nv-select";
      input.id = "nv_p_" + d.key;
      input.dataset.nv = "insp-select";
      for (const o of d.options || []) {
        const opt = document.createElement("option");
        opt.value = String(optionValue(o));
        opt.textContent = optionLabel(o);
        input.append(opt);
      }
      input.value = String(state.values[d.key]);
      input.addEventListener("change", () => write(d.key, input.value, { commit: true }));
      ctl.append(input);
    } else if (kind === "number") {
      input = document.createElement("input");
      input.type = "text";
      input.inputMode = "numeric";
      input.className = "nv-input nv-input-num";
      input.id = "nv_p_" + d.key;
      input.dataset.nv = "insp-input";
      input.placeholder = d.placeholder || "";
      input.value = state.values[d.key] == null ? "" : String(state.values[d.key]);
      const dec = el("button", "nv-step-btn", "\u2212");
      dec.type = "button";
      dec.dataset.nv = "insp-step-dec";
      const inc = el("button", "nv-step-btn", "+");
      inc.type = "button";
      inc.dataset.nv = "insp-step-inc";
      const step = Number.isFinite(d.step) ? d.step : 1;
      const bump = (dir) => {
        const cur = Number(input.value);
        const base = Number.isFinite(cur) ? cur : (Number.isFinite(d.min) ? d.min : 0);
        input.value = String(base + dir * step);
        write(d.key, input.value, { commit: true });
        input.value = String(state.values[d.key]);
      };
      dec.addEventListener("click", () => bump(-1));
      inc.addEventListener("click", () => bump(1));
      input.addEventListener("input", () => write(d.key, input.value));
      input.addEventListener("blur", () => {
        write(d.key, input.value, { commit: true });
        input.value = state.values[d.key] == null ? "" : String(state.values[d.key]);
      });
      ctl.append(dec, input, inc);
    } else if (kind === "textarea") {
      input = document.createElement("textarea");
      input.className = "nv-textarea";
      input.id = "nv_p_" + d.key;
      input.dataset.nv = "insp-input";
      input.placeholder = d.placeholder || "";
      input.rows = Math.min(8, Math.max(2, d.rows || 3));
      input.value = state.values[d.key] == null ? "" : String(state.values[d.key]);
      if (isSensitive(d)) { input.classList.add("is-masked"); input.dataset.masked = "true"; }
      input.addEventListener("input", () => write(d.key, input.value));
      ctl.append(input);
      if (isSensitive(d)) ctl.append(eyeButton(input));
    } else {
      // text / password / image
      const sensitive = kind === "password" || isSensitive(d);
      input = sensitive
        ? maskedInput({ className: "nv-input", id: "nv_p_" + d.key })
        : document.createElement("input");
      input.dataset.nv = "insp-input";
      input.id = "nv_p_" + d.key;
      input.placeholder = d.placeholder || "";
      if (!sensitive) { input.type = "text"; input.autocomplete = "on"; }
      input.value = state.values[d.key] == null ? "" : String(state.values[d.key]);
      input.addEventListener("input", () => write(d.key, input.value));
      ctl.append(input);
      if (sensitive) ctl.append(eyeButton(input));
      if (kind === "image") {
        const hint = el("span", "nv-insp-meta", d.placeholder || "");
        if (hint.textContent) ctl.append(hint);
      }
    }

    const hint = el("div", "nv-insp-hint");
    hint.dataset.nv = "insp-hint";
    hint.hidden = true;

    const meta = el("div", "nv-insp-meta");
    meta.dataset.nv = "insp-meta";
    const bits = [];
    if (kind === "number" && (Number.isFinite(d.min) || Number.isFinite(d.max))) {
      bits.push(tNv("nv.insp.range",
        Number.isFinite(d.min) ? d.min : "-", Number.isFinite(d.max) ? d.max : "-"));
    }
    if (kind === "select") bits.push(tNv("nv.insp.options", (d.options || []).length));
    if (d.default !== undefined && d.default !== "") bits.push(tNv("nv.insp.default") + ": " + String(d.default));
    if (bits.length) meta.textContent = bits.join(" · ");
    else meta.hidden = true;

    const reset = el("button", "nv-link-btn nv-reset-btn", tNv("nv.insp.reset"));
    reset.type = "button";
    reset.dataset.nv = "insp-reset";
    reset.addEventListener("click", () => api.setValue(d.key, defaultParamValue(d)));

    row.append(headRow, ctl, meta, hint, reset);
    rows.set(d.key, { row, input, hint, promote, reset });
    return row;
  }

  function render() {
    list.textContent = "";
    rows.clear();
    const params = op.params || [];
    count.textContent = tNv("nv.insp.paramCount", params.length);
    empty.hidden = params.length > 0;
    for (const d of params) list.append(buildRow(d));
  }

  function syncPromoteButtons() {
    for (const [key, r] of rows) {
      const on = state.promoted.has(key);
      r.promote.setAttribute("aria-pressed", String(on));
      r.promote.textContent = on ? tNv("nv.insp.demote") : tNv("nv.insp.promote");
      r.promote.title = r.promote.textContent;
      r.row.dataset.promoted = String(on);
    }
  }

  const api = {
    el: root,
    op,
    /** 程序化写值（等同用户输入 + 提交）。 */
    setValue(key, raw) {
      const r = write(key, raw, { commit: true });
      const row = rows.get(key);
      if (row && row.input) {
        if (row.input.type === "checkbox") row.input.checked = !!state.values[key];
        else row.input.value = state.values[key] == null ? "" : String(state.values[key]);
      }
      return r;
    },
    getValues() { return { ...state.values }; },
    getErrors() { return { ...state.errors }; },
    /** 整组校验（与算法页同一套规则）。 */
    validate() { return validateParams(op, state.values); },
    togglePromote(key) {
      if (state.promoted.has(key)) state.promoted.delete(key);
      else state.promoted.add(key);
      syncPromoteButtons();
      const keys = api.promotedKeys();
      if (typeof options.onPromote === "function") options.onPromote(keys, key);
      return keys;
    },
    promotedKeys() { return Array.from(state.promoted); },
    setPromoted(keys) {
      state.promoted = new Set(keys || []);
      syncPromoteButtons();
      return api;
    },
    /** 每行渲染事实（类型/键/控件标签），测试与回执用。 */
    rows() {
      return Array.from(list.querySelectorAll('[data-nv="insp-param"]')).map((r) => ({
        key: r.dataset.key,
        type: r.dataset.type,
        value: r.dataset.value,
        invalid: r.dataset.invalid === "true",
        hasPromote: !!r.querySelector('[data-nv="insp-promote"]'),
      }));
    },
    refresh: render,
    countEl: count,
  };

  render();
  syncPromoteButtons();
  return api;
}
