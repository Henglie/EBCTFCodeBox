/*
 * ioCodingToolbar.js — T701 全局输入/输出编码工具栏（文本 / 字节双模）。
 *
 * 职责：
 *   1. 在输入框上方提供 charset（auto + CHARSETS）、视图（text/hex/base64/escaped）、
 *      BOM 保留三组控件；op 自身的参数仍可覆盖（见 resolveOptions）。
 *   2. 把「输入表现文本」显式解析成 op 执行层需要的 text / bytes：
 *      · text 视图：文本原样交给 op，不重新编码；只有 op 声明 acceptsBytes 时才按所选
 *        charset 编码成字节（charset=auto 时按 utf-8 并写入 warnings，绝不静默）。
 *      · hex/base64/escaped 视图：先 viewToBytes，再按所选 charset 严格 decodeText；
 *        非法字节、错误 BOM、不可表示字符一律抛错。
 *   3. 把 op 输出显式格式化成当前视图：有真字节就直接用真字节，没有才按所选 charset
 *      编码文本；text 视图下文本原样返回，不二次转义。
 *
 * 设计边界：
 *   · 零新依赖，只 import core/ioCoding.js；零网络、零随机、零存储。
 *   · 不改 ioArea 的 .value 代理、撤销、粘贴、A-/A+；工具条只是插在输入框前的一行 DOM。
 *   · 不自动改写 outArea.value：main.js 需在输出落框前调用 controller.formatOutput()，
 *     否则无法区分「op 返回的文本」与「加载中占位 / 错误文案」。精确接线见
 *     资料/工程留存/T701/main-hook.md。
 *   · 状态为会话态；模块级默认值在多次 renderOp 之间复用，切换 op 不丢选择。
 *     resetIoCodingDefaults() 仅供测试/重置。
 */

import {
  CHARSETS, VIEWS, BIT_ORDERS, detectBom, sniffCharset, decodeText, encodeText,
  bytesToView, viewToBytes, normalizeCharset, normalizeBitOrder,
} from "../core/ioCoding.js";

const BOM_LABELS = new Set(CHARSETS.filter((c) => c.bom).map((c) => c.label));

const FALLBACK = {
  "ui.io.charset": "字符集",
  "ui.io.charsetAuto": "自动识别",
  "ui.io.charsetAutoHint": "按 BOM 与字节结构猜测，结果会标注置信度",
  "ui.io.view": "视图",
  "ui.io.view.text": "文本",
  "ui.io.view.hex": "十六进制",
  "ui.io.view.base64": "Base64",
  "ui.io.view.escaped": "转义字节",
  "ui.io.view.bits": "位串",
  "ui.io.view.base32": "Base32",
  "ui.io.bitOrder": "位序",
  "ui.io.bitOrder.msb": "MSB 优先",
  "ui.io.bitOrder.lsb": "LSB 优先",
  "ui.io.bitOrderHint": "仅位串视图生效：MSB 优先 = 每字节 bit7→bit0；LSB 优先 = bit0→bit7。两种位序与字节严格互逆。",
  "ui.io.keepBom": "保留 BOM",
  "ui.io.keepBomHint": "勾选后起始 U+FEFF 原样保留；不勾选则剥离并在结果里标注",
  "ui.io.noBom": "该字符集没有 BOM 定义",
  "ui.io.sniffed": "按 {0} 猜测解码（置信度 {1}）",
  "ui.io.sniffNote": "这是猜测，请按数据实际来源确认字符集",
  "ui.io.textNoReencode": "文本视图：输入原样交给 op，不重新编码",
  "ui.io.textAutoOff": "文本输入不使用自动识别；自动识别只在字节视图或 op 需要原始字节时生效",
  "ui.io.textCharset": "文本视图：输入原样交给 op（字符集 {0} 仅用于字节型 op）",
  "ui.io.bytesExplicit": "{0} 字节 · 按 {1} 严格解码",
  "ui.io.bomStripped": "已剥离 {0} BOM（{1} 字节）",
  "ui.io.bomDetected": "检测到 {0} BOM（{1} 字节）",
  "ui.io.opOverride": "{0} 由 op 参数覆盖",
  "ui.io.viewHint": "若这是二进制数据，请改用十六进制或转义字节视图",
  "ui.io.textAutoEncoded": "字符集为自动识别，但 op 声明 acceptsBytes：输入文本已按 utf-8 编码为字节（显式记录，未静默猜测）",
  "ui.io.outputAutoEncoded": "字符集为自动识别：输出文本已按 utf-8 编码为字节（显式记录，未静默猜测）",
  "ui.io.outputNoBytes": "输出既没有 text 也没有 bytes，无法生成 {0} 视图",
  "ui.io.fileBytes": "已使用拖入文件的原始字节，输入框中的 {0} 文本未参与解码",
  "ui.io.emptyBytes": "空字节输入（合法）",
  "ui.io.aria.group": "I/O 编码",
  "ui.io.aria.output": "输出编码视图",
  "ui.io.placeholder.hex": "48 65 6c 6c 6f（十六进制，可含空白）",
  "ui.io.err.unknownView": "未知视图 {0}；可选 {1}。",
  "ui.io.err.area": "attachIoCodingToolbar: area 不能为空",
  "ui.io.err.dom": "attachIoCodingToolbar 需要 DOM 环境；纯算法验收请直接使用 core/ioCoding.js。",
  "ui.io.err.utf32": "检测到 UTF-32 BOM {0}（{1} 字节）：本模块不提供 UTF-32 编解码，也不会把它当 UTF-16 处理。请先转码为 UTF-8 或 UTF-16。",
  "ui.io.err.bomMismatch": "BOM 与所选字符集不符：字节以 {0} BOM {1}（{2} 字节）开头，但当前选择的是 {3}。请改为 auto / {0}，或先移除 BOM；本模块不会按错误字符集静默解码。",
};

const VIEW_LABEL_KEY = {
  text: "ui.io.view.text",
  hex: "ui.io.view.hex",
  base64: "ui.io.view.base64",
  escaped: "ui.io.view.escaped",
  bits: "ui.io.view.bits",
  base32: "ui.io.view.base32",
};

const VIEW_PLACEHOLDER = {
  text: "",
  hex: "",
  base64: "SGVsbG8=",
  escaped: "\\x48\\x65\\x6c\\x6c\\x6f",
  bits: "01001000 01100101 01101100 01101100 01101111",
  base32: "JBSWY3DP",
};

const DEFAULT_STATE = { charset: "auto", view: "text", keepBom: false, bitOrder: "msb" };
let globalState = { ...DEFAULT_STATE };
let globalOutputState = { ...DEFAULT_STATE };

export function getIoCodingDefaults() {
  return { ...globalState };
}

export function setIoCodingDefaults(patch) {
  const p = patch || {};
  if (p.charset != null) globalState.charset = normalizeCharsetChoice(p.charset);
  if (p.view != null) globalState.view = normalizeViewChoice(p.view);
  if (p.keepBom != null) globalState.keepBom = !!p.keepBom;
  if (p.bitOrder != null) globalState.bitOrder = normalizeBitOrder(p.bitOrder);
  return { ...globalState };
}

export function resetIoCodingDefaults() {
  globalState = { ...DEFAULT_STATE };
  return { ...globalState };
}

/* ============================== 小工具 ============================== */

function t(key, ...args) {
  try {
    if (typeof window !== "undefined" && typeof window.__ebctfT === "function") {
      const s = window.__ebctfT(key, ...args);
      if (s && s !== key) return s;
    }
  } catch { /* i18n 不可用时回退 */ }
  let s = FALLBACK[key] || key;
  for (let i = 0; i < args.length; i++) {
    s = s.split("{" + i + "}").join(String(args[i]));
  }
  return s;
}

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined) continue;
    n.append(c && c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

function hasValue(v) {
  return v !== null && v !== undefined && v !== "";
}

function isByteLike(v) {
  return v instanceof Uint8Array
    || v instanceof ArrayBuffer
    || (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(v));
}

function toBytesLocal(v) {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(v)) {
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  return null;
}

function bytesOfObject(v) {
  if (!v || typeof v !== "object") return null;
  if (isByteLike(v.bytes)) return toBytesLocal(v.bytes);
  if (isByteLike(v.rawBytes)) return toBytesLocal(v.rawBytes);
  return null;
}

function normalizeViewChoice(v) {
  const s = String(v == null ? "text" : v);
  if (!VIEWS.includes(s)) {
    throw new Error(t("ui.io.err.unknownView", JSON.stringify(s), VIEWS.join(" / ")));
  }
  return s;
}

function normalizeCharsetChoice(v) {
  const raw = String(v == null ? "auto" : v).trim();
  if (raw.toLowerCase() === "auto") return "auto";
  return normalizeCharset(raw);
}

function isUsableCharset(v) {
  if (!hasValue(v)) return false;
  if (String(v).trim().toLowerCase() === "auto") return true;
  try { normalizeCharset(v); return true; } catch { return false; }
}

function bomSupported(charset) {
  return charset === "auto" || BOM_LABELS.has(charset);
}

function effectiveKeepBom(keepBom, charset) {
  return !!keepBom && (charset === "auto" || BOM_LABELS.has(charset));
}

/** 用户层容错：hex 视图允许空白分隔（core 的 hexToBytes 只做 trim，不跳内部空白）。 */
function parseViewBytes(raw, view, bitOrder) {
  const s = raw == null ? "" : String(raw);
  if (view === "hex") return viewToBytes(s.replace(/\s+/g, ""), view);
  return viewToBytes(s, view, { bitOrder });
}

function validateBom(bytes, charset) {
  const hit = detectBom(bytes);
  if (!hit) return null;
  if (hit.charset === "utf-32le" || hit.charset === "utf-32be") {
    throw new Error(t("ui.io.err.utf32", hit.bomHex, hit.bomLen));
  }
  if (charset !== "auto" && hit.charset !== charset) {
    throw new Error(t("ui.io.err.bomMismatch", hit.charset, hit.bomHex, hit.bomLen, charset));
  }
  return hit;
}

/* ============================== 样式（只注入一次） ============================== */

const STYLE_ID = "io-coding-toolbar-styles";

function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.io-coding-bar {
  display: flex; align-items: center; flex-wrap: wrap; gap: var(--sp-1) var(--sp-2);
  padding: var(--sp-1) 2px var(--sp-2); min-width: 0;
  font-size: var(--fs-sm); color: var(--on-surface-var);
}
.io-coding-field { display: inline-flex; align-items: center; gap: var(--sp-1); min-width: 0; }
.io-coding-field[hidden] { display: none; }
.io-coding-label { white-space: nowrap; font-size: var(--fs-xs); color: var(--on-surface-var); }
.io-coding-select {
  height: 30px; max-width: 190px; padding: 0 var(--sp-2);
  background: var(--field-bg); color: var(--on-surface);
  border: 1px solid var(--outline); border-radius: var(--r-sm);
  font: inherit; font-size: var(--fs-sm); min-width: 0;
}
.io-coding-select:focus { outline: 2px solid var(--primary); border-color: transparent; }
.io-coding-seg {
  display: inline-flex; background: var(--surface-2);
  border-radius: var(--r-full); padding: 2px; max-width: 100%; overflow-x: auto;
}
.io-coding-seg button {
  height: 26px; padding: 0 var(--sp-2); border-radius: var(--r-full);
  font-size: var(--fs-xs); color: var(--on-surface-var); white-space: nowrap;
}
.io-coding-seg button.on { background: var(--primary); color: var(--on-primary); font-weight: 600; }
.io-coding-bom {
  display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;
  font-size: var(--fs-xs); cursor: pointer; user-select: none;
}
.io-coding-bom input { margin: 0; accent-color: var(--primary); }
.io-coding-bom.disabled { opacity: .5; cursor: not-allowed; }
.io-coding-status {
  flex: 1 1 220px; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; font-size: var(--fs-xs); color: var(--on-surface-var);
}
.io-coding-status.warn { color: var(--warning, #8a6d00); }
.io-coding-status.error { color: var(--error, #b3261e); }
.io-coding-status:empty { display: none; }
@media (max-width: 600px) {
  .io-coding-bar { align-items: stretch; }
  .io-coding-select { max-width: none; }
  .io-coding-status { flex-basis: 100%; }
}
`;
  document.head.append(style);
}

/* ============================== 主入口 ============================== */

/**
 * 在 area 前挂一行 I/O 编码工具栏。
 *
 * @param {HTMLElement} area 输入编辑框（ioArea 的 div 或 textarea，需支持 .value）
 * @param {object} [opts]
 *   outArea    输出编辑框（仅保存引用，供调用方读取）
 *   mount      工具条挂载容器；缺省插到 area 前
 *   onChange   charset/view/BOM 变更后的回调（通常 triggerConvert）
 *   getOp      () => 当前 op
 *   getParams  () => 当前 state.params
 * @returns {object} controller，含 prepareInput / formatOutput / reportWarnings 等
 */
export function attachIoCodingToolbar(area, opts = {}) {
  if (!area) throw new TypeError(t("ui.io.err.area"));
  if (area.__ioCodingToolbar) return area.__ioCodingToolbar;
  if (typeof document === "undefined") {
    throw new Error(t("ui.io.err.dom"));
  }
  ensureStyles();

  const stateScope = opts.scope === "output" ? "output" : "input";
  const state = { ...(stateScope === "output" ? globalOutputState : globalState) };
  const bar = el("div", { class: "io-coding-bar", role: "group", "aria-label": t(stateScope === "output" ? "ui.io.aria.output" : "ui.io.aria.group") });

  const charsetSel = el("select", { class: "io-coding-select", "aria-label": t("ui.io.charset") });
  charsetSel.append(el("option", { value: "auto", title: t("ui.io.charsetAutoHint") }, t("ui.io.charsetAuto")));
  for (const c of CHARSETS) {
    charsetSel.append(el("option", { value: c.label, title: c.label }, c.name));
  }

  const viewSeg = el("div", { class: "io-coding-seg", role: "group", "aria-label": t("ui.io.view") });
  const viewBtns = new Map();
  for (const v of VIEWS) {
    const b = el("button", {
      type: "button",
      class: "io-coding-view" + (v === state.view ? " on" : ""),
      "data-view": v,
      "aria-pressed": String(v === state.view),
      title: t(VIEW_LABEL_KEY[v]),
      onclick: () => controller.setView(v),
    }, t(VIEW_LABEL_KEY[v]));
    viewBtns.set(v, b);
    viewSeg.append(b);
  }

  const bitOrderSel = el("select", { class: "io-coding-select", "aria-label": t("ui.io.bitOrder"), title: t("ui.io.bitOrderHint") });
  for (const o of BIT_ORDERS) {
    bitOrderSel.append(el("option", { value: o, title: t("ui.io.bitOrder." + o) }, t("ui.io.bitOrder." + o)));
  }
  const bitOrderField = el("span", { class: "io-coding-field io-coding-bitorder" },
    el("span", { class: "io-coding-label" }, t("ui.io.bitOrder")),
    bitOrderSel,
  );
  bitOrderSel.addEventListener("change", () => controller.setBitOrder(bitOrderSel.value));

  const bomInput = el("input", { type: "checkbox", "aria-label": t("ui.io.keepBom") });
  const bomLabel = el("label", { class: "io-coding-bom", title: t("ui.io.keepBomHint") },
    bomInput, el("span", {}, t("ui.io.keepBom")));
  bomInput.addEventListener("change", () => controller.setKeepBom(bomInput.checked));

  const status = el("span", { class: "io-coding-status", role: "status", "aria-live": "polite" });

  bar.append(
    el("span", { class: "io-coding-field" },
      el("span", { class: "io-coding-label" }, t("ui.io.charset")),
      charsetSel,
    ),
    el("span", { class: "io-coding-field" },
      el("span", { class: "io-coding-label" }, t("ui.io.view")),
      viewSeg,
    ),
    bitOrderField,
    bomLabel,
    status,
  );

  const isTextarea = String(area.tagName || "").toUpperCase() === "TEXTAREA";
  const initialPlaceholder = isTextarea
    ? (area.getAttribute("placeholder") || "")
    : (area.getAttribute("data-placeholder") || "");

  let previewTimer = null;
  let observed = null;
  // 状态条去重签名：同一 (kind, text) 连续出现时不再重写 DOM，避免切换视图时同一条 BOM
  // 提示被反复“刷”出来。任何一次真正不同的状态都能穿透。
  let statusSig = null;
  // 本作用域当前的真实字节（输出侧由 formatOutput 记录，输入侧由 updatePreview 按当前视图解析）。
  // 切换 view/charset/keepBom 后据此重算状态，绝不复用上一视图的显示文本。
  let previewBytes = null;

  function setStatus(text, kind) {
    const s = text == null ? "" : String(text);
    const k = kind === "warn" || kind === "error" ? kind : "info";
    const sig = k + "\u0000" + s;
    if (sig === statusSig) return;
    statusSig = sig;
    status.textContent = s;
    status.title = s;
    status.classList.remove("warn", "error");
    if (k === "warn") status.classList.add("warn");
    else if (k === "error") status.classList.add("error");
  }

  function setBomTip(text) {
    bomLabel.title = text;
    bomInput.title = text;
  }

  function setCharsetTip(text) {
    charsetSel.title = text || t("ui.io.charset");
  }

  function updatePlaceholder() {
    const ph = state.view === "text" ? initialPlaceholder : (state.view === "hex" ? t("ui.io.placeholder.hex") : VIEW_PLACEHOLDER[state.view]);
    if (isTextarea) area.setAttribute("placeholder", ph || "");
    else if (ph) area.setAttribute("data-placeholder", ph);
    else area.removeAttribute("data-placeholder");
  }

  function syncControls() {
    charsetSel.value = state.charset;
    if (charsetSel.value !== state.charset) charsetSel.value = "auto";
    for (const [v, b] of viewBtns) {
      const on = v === state.view;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    bitOrderSel.value = state.bitOrder;
    bitOrderField.hidden = state.view !== "bits";
    const supports = bomSupported(state.charset);
    bomInput.checked = state.keepBom && supports;
    bomInput.disabled = !supports;
    bomLabel.classList.toggle("disabled", !supports);
    setBomTip(supports ? t("ui.io.keepBomHint") : t("ui.io.noBom"));
    updatePlaceholder();
  }

  function resolveOptions(execOpts) {
    const exec = execOpts || {};
    const params = (exec.params && typeof exec.params === "object")
      ? exec.params
      : (typeof opts.getParams === "function" ? (opts.getParams() || {}) : {});
    let charsetRaw = state.charset;
    let charsetSource = "toolbar";
    if (hasValue(params.ioCharset)) {
      charsetRaw = params.ioCharset;
      charsetSource = "op";
    } else if (hasValue(params.charset) && isUsableCharset(params.charset)) {
      charsetRaw = params.charset;
      charsetSource = "op";
    }
    let viewRaw = state.view;
    let viewSource = "toolbar";
    if (hasValue(params.ioView)) {
      viewRaw = params.ioView;
      viewSource = "op";
    } else if (hasValue(params.view) && VIEWS.includes(String(params.view))) {
      viewRaw = params.view;
      viewSource = "op";
    }
    let keepBom = state.keepBom;
    let keepBomSource = "toolbar";
    if (typeof params.ioKeepBom === "boolean") {
      keepBom = params.ioKeepBom;
      keepBomSource = "op";
    } else if (typeof params.keepBom === "boolean") {
      keepBom = params.keepBom;
      keepBomSource = "op";
    }
    const op = exec.op || (typeof opts.getOp === "function" ? opts.getOp() : null);
    // 算法自带输入编码参数（inputType/inputEncoding/…）时，工具栏视图会把同一段文本再解一次。
    // 此时让位给算法：视图强制文本，并在 prepareInput 里提示原因。
    const opParams = op && Array.isArray(op.params) ? op.params : [];
    // A 类输入编码键（T771 盘点 169 条）：命中任一个就说明 op 自己解释输入，视图必须让位。
    // outEnc 在 decode 方向才是主输入承载，按方向单独计入；encode 方向不算。
    const dir = String(params.mode || params.dir || params.direction || "").toLowerCase();
    const decodeDir = dir === "decode" || dir === "decrypt" || dir === "dec";
    const inputEncKeys = /^(inputType|inputEncoding|inEncoding|srcEncoding|inputEnc|inputMode|msgMode|msgEnc|dataEnc|inputFormat|contentEnc|enc|input)$/i;
    const selfEncoded = opParams.find((x) => {
      if (!x) return false;
      const k = String(x.key);
      return inputEncKeys.test(k) || (/^outEnc$/i.test(k) && decodeDir);
    });
    if (selfEncoded && viewSource === "toolbar" && normalizeViewChoice(viewRaw) !== "text") {
      viewRaw = "text";
      viewSource = "op-selfenc";
    }
    // 位序只作为 bits 视图的子选项：只认 ioBitOrder，不认通用 bitOrder
    // （stegosaurus / zstegScan 等 op 的 bitOrder 是算法内部参数，不能挪作视图解释）。
    let bitOrder = state.bitOrder;
    let bitOrderSource = "toolbar";
    if (hasValue(params.ioBitOrder)) {
      bitOrder = normalizeBitOrder(params.ioBitOrder);
      bitOrderSource = "op";
    }
    return {
      charset: normalizeCharsetChoice(charsetRaw),
      view: normalizeViewChoice(viewRaw),
      keepBom: !!keepBom,
      bitOrder,
      charsetSource,
      viewSource,
      keepBomSource,
      bitOrderSource,
      selfEncodedKey: selfEncoded ? String(selfEncoded.key) : "",
      params,
      op,
    };
  }

  function reportWarnings(warnings) {
    if (!warnings || !warnings.length) {
      setStatus("", "info");
      return;
    }
    const text = warnings.join(" ");
    setStatus(text, "warn");
    status.title = warnings.join("\n");
  }

  function showError(err) {
    const msg = err && err.message ? err.message : String(err);
    setStatus("✗ " + msg, "error");
    status.title = msg;
    return msg;
  }

  function updatePreview() {
    let eff;
    try {
      eff = resolveOptions();
    } catch (e) {
      showError(e);
      return;
    }
    setBomTip(bomSupported(state.charset) ? t("ui.io.keepBomHint") : t("ui.io.noBom"));
    setCharsetTip(t("ui.io.charset"));
    if (eff.view === "text") {
      let hint;
      if (eff.op && eff.op.acceptsBytes && eff.charset === "auto") {
        hint = t("ui.io.textAutoEncoded");
      } else if (eff.charset === "auto") {
        hint = t("ui.io.textAutoOff");
      } else {
        hint = t("ui.io.textCharset", eff.charset);
      }
      if (eff.charsetSource === "op") hint += "\n" + t("ui.io.opOverride", "charset");
      setStatus("", "info");
      setCharsetTip(hint);
      setBomTip(hint);
      return;
    }
    // 字节视图：必须按「当前视图 + 当前字节」重算。
    //  · 输入侧：字节 = 当前输入文本按所选视图解释（视图切换只改解释方式，不改原文本）。
    //  · 输出侧：字节 = 最近一次 formatOutput 落定的真字节；绝不能拿上一视图的显示文本
    //    （如 text 视图渲染出的 "A"）当本视图（如 hex）的输入，否则会残留上一轮的 BOM/长度错误。
    let bytes;
    if (stateScope === "output") {
      bytes = previewBytes;
      if (!bytes) { setStatus("", "info"); return; }
    } else {
      const raw = area.value;
      if (!raw) { setStatus("", "info"); return; }
      try {
        bytes = parseViewBytes(raw, eff.view, eff.bitOrder);
      } catch (e) {
        showError(e);
        return;
      }
    }
    if (!bytes.length) {
      setStatus(t("ui.io.emptyBytes"), "info");
      return;
    }
    try {
      const bomHit = validateBom(bytes, eff.charset);
      if (eff.charset !== "auto") {
        const base = t("ui.io.bytesExplicit", bytes.length, eff.charset);
        if (bomHit) setStatus(base + " · " + t("ui.io.bomDetected", bomHit.charset, bomHit.bomLen), "info");
        else setStatus(base, "info");
        if (eff.charsetSource === "op") status.title = status.textContent + "\n" + t("ui.io.opOverride", "charset");
        return;
      }
      if (bomHit) {
        setStatus(t("ui.io.bomDetected", bomHit.charset, bomHit.bomLen), "info");
        return;
      }
      const sn = sniffCharset(bytes);
      const top = sn.candidates.find((c) => c.charset === sn.best) || sn.candidates[0];
      const conf = top ? Number(top.confidence).toFixed(3) : "0.000";
      setStatus(t("ui.io.sniffed", sn.best, conf) + " · " + t("ui.io.sniffNote"), "warn");
      status.title = top ? top.reason : status.textContent;
    } catch (e) {
      showError(e);
    }
  }

  function schedulePreview() {
    if (previewTimer !== null) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { previewTimer = null; updatePreview(); }, 120);
  }

  function commit(patch, emit) {
    if (patch.charset != null) {
      state.charset = normalizeCharsetChoice(patch.charset);
      if (!bomSupported(state.charset)) state.keepBom = false;
    }
    if (patch.view != null) state.view = normalizeViewChoice(patch.view);
    if (patch.keepBom != null) state.keepBom = !!patch.keepBom;
    if (patch.bitOrder != null) state.bitOrder = normalizeBitOrder(patch.bitOrder);
    const nextDefaults = { charset: state.charset, view: state.view, keepBom: state.keepBom, bitOrder: state.bitOrder };
    if (stateScope === "output") globalOutputState = nextDefaults;
    else globalState = nextDefaults;
    syncControls();
    updatePreview();
    if (emit && typeof opts.onChange === "function") opts.onChange();
  }

  function prepareInput(text, execOpts) {
    const eff = resolveOptions(execOpts);
    const charset = eff.charset;
    const view = eff.view;
    const keepBom = effectiveKeepBom(eff.keepBom, charset);
    const source = text == null ? "" : String(text);
    const warnings = [];
    const rawInput = execOpts && execOpts.rawBytes;
    // 文件真字节只在 op 声明 acceptsBytes 时接管；否则沿用 main.js 已写入框内的
    // 文本（文本文件）或 hex（二进制文件）表现，避免绕过用户当前视图。
    if (execOpts && execOpts.acceptsBytes && isByteLike(rawInput)) {
      const bytes = toBytesLocal(rawInput);
      if (view !== "text") warnings.push(t("ui.io.fileBytes", view));
      return {
        text: source,
        bytes,
        charset,
        view,
        keepBom,
        bom: detectBom(bytes),
        warnings,
        source: "file",
        options: eff,
      };
    }

    if (eff.selfEncodedKey && eff.viewSource === "op-selfenc") {
      warnings.push(t("ui.io.selfEncodedInput", eff.selfEncodedKey));
    }

    if (view === "text") {
      let bytes = null;
      if (execOpts && execOpts.acceptsBytes) {
        const encCharset = charset === "auto" ? "utf-8" : charset;
        const useBom = effectiveKeepBom(keepBom, encCharset);
        bytes = encodeText(source, { charset: encCharset, bom: useBom });
        if (useBom) warnings.push(t("ui.io.bomDetected", encCharset, detectBom(bytes).bomLen));
      }
      return {
        text: source,
        bytes,
        charset,
        view,
        keepBom,
        bom: bytes ? detectBom(bytes) : null,
        warnings,
        source: "text",
        options: eff,
      };
    }

    const bytes = parseViewBytes(source, view, eff.bitOrder);
    if (!bytes.length) {
      return {
        text: "",
        bytes,
        charset,
        view,
        keepBom,
        bom: { present: false, len: 0 },
        warnings,
        source: "view",
        options: eff,
      };
    }
    const bomHit = validateBom(bytes, charset);
    const decoded = decodeText(bytes, { charset, keepBom });
    if (decoded.warnings && decoded.warnings.length) warnings.push(...decoded.warnings);
    if (bomHit && !keepBom) warnings.push(t("ui.io.bomStripped", bomHit.charset, bomHit.bomLen));
    return {
      text: decoded.text,
      bytes,
      charset: decoded.charset,
      view,
      keepBom,
      bom: decoded.bom,
      warnings,
      source: "view",
      options: eff,
    };
  }

  function encodeBytes(text, execOpts) {
    const eff = resolveOptions(execOpts);
    const charset = eff.charset === "auto" ? "utf-8" : eff.charset;
    const warnings = [];
    const useBom = effectiveKeepBom(eff.keepBom, charset);
    const bytes = encodeText(text == null ? "" : String(text), { charset, bom: useBom });
    return { bytes, charset, keepBom: useBom, warnings, options: eff };
  }

  function formatOutput(value, execOpts) {
    const eff = resolveOptions(execOpts);
    const charset = eff.charset;
    const view = eff.view;
    let outText = null;
    let outBytes = null;
    if (isByteLike(value)) outBytes = toBytesLocal(value);
    else if (value && typeof value === "object") {
      outText = value.text != null ? String(value.text) : null;
      outBytes = bytesOfObject(value);
    } else {
      outText = value == null ? "" : String(value);
    }
    const warnings = [];
    let result;

    if (view === "text") {
      if (outText != null) {
        result = {
          text: outText, bytes: outBytes, charset, view, warnings,
          source: outBytes ? "bytes+text" : "text", options: eff,
        };
      } else if (!outBytes) {
        result = { text: "", bytes: null, charset, view, warnings, source: "empty", options: eff };
      } else {
        const keepBom = effectiveKeepBom(eff.keepBom, charset);
        const bomHit = validateBom(outBytes, charset);
        const decoded = decodeText(outBytes, { charset, keepBom });
        if (decoded.warnings && decoded.warnings.length) warnings.push(...decoded.warnings);
        if (bomHit && !keepBom) warnings.push(t("ui.io.bomStripped", bomHit.charset, bomHit.bomLen));
        result = {
          text: decoded.text, bytes: outBytes, charset: decoded.charset, view,
          warnings, source: "bytes", options: eff,
        };
      }
    } else if (!outBytes) {
      if (outText == null) throw new Error(t("ui.io.outputNoBytes", view));
      // 纯文本结果（hash 的 hex 串、Base64 串等）不再 encodeBytes 后转视图：
      // 那等于把算法结果当输入再编码一次。保持原文，并说明字节视图不适用。
      result = {
        text: outText,
        bytes: null,
        charset: charset === "auto" ? "utf-8" : charset,
        view,
        warnings: [t("ui.io.textOutputNoop", view)],
        source: "text",
        options: eff,
      };
    } else {
      result = {
        text: bytesToView(outBytes, view, { bitOrder: eff.bitOrder }),
        bytes: outBytes,
        charset: charset === "auto" ? "utf-8" : charset,
        view,
        warnings,
        source: "bytes",
        options: eff,
      };
    }

    // 记录本轮真字节，供输出侧 updatePreview 按「当前视图 + 当前字节」重算状态。
    previewBytes = result.bytes || null;
    // 无条件刷新：本轮没有新警告时清掉上一轮的 BOM / 错误提示，绝不粘连。
    // 调用方（main.js applyOpOutput）只在有警告时才调用 reportWarnings，故由此处兜底清空。
    reportWarnings(result.warnings);
    return result;
  }

  const controller = {
    element: bar,
    state,
    outArea: opts.outArea || null,
    ready: false,
    setCharset(label, o) { commit({ charset: label }, !(o && o.emit === false)); },
    setView(view, o) { commit({ view }, !(o && o.emit === false)); },
    setKeepBom(v, o) { commit({ keepBom: !!v }, !(o && o.emit === false)); },
    setBitOrder(v, o) { commit({ bitOrder: v }, !(o && o.emit === false)); },
    getState() { return { ...state }; },
    resolveOptions,
    prepareInput,
    encodeBytes,
    formatOutput,
    getEffectiveOptions(params) { return resolveOptions({ params }); },
    reportWarnings,
    showError,
    refresh() { syncControls(); updatePreview(); },
    destroy,
  };

  // 填初值并挂控件事件
  charsetSel.addEventListener("change", () => controller.setCharset(charsetSel.value));
  area.addEventListener("input", schedulePreview);
  syncControls();
  updatePreview();

  function place() {
    if (bar.isConnected) return true;
    const mount = opts.mount;
    if (mount && typeof mount.append === "function") {
      mount.append(bar);
      return true;
    }
    if (area.parentNode) {
      area.parentNode.insertBefore(bar, area);
      return true;
    }
    return false;
  }

  if (opts.autoMount !== false) {
    place();
    if (!bar.isConnected && typeof MutationObserver === "function" && document.body) {
      observed = new MutationObserver(() => {
        if (place() && observed) {
          observed.disconnect();
          observed = null;
        }
      });
      observed.observe(document.body, { childList: true, subtree: true });
    }
  }

  function destroy() {
    if (previewTimer !== null) { clearTimeout(previewTimer); previewTimer = null; }
    if (observed) { observed.disconnect(); observed = null; }
    area.removeEventListener("input", schedulePreview);
    if (bar.isConnected) bar.remove();
    try { delete area.__ioCodingToolbar; } catch { area.__ioCodingToolbar = null; }
    try { delete area.__ioCoding; } catch { area.__ioCoding = null; }
  }

  area.__ioCodingToolbar = controller;
  area.__ioCoding = controller;
  controller.ready = true;
  return controller;
}

export default { attachIoCodingToolbar, getIoCodingDefaults, setIoCodingDefaults, resetIoCodingDefaults };
