// imageOpsViewer.js — 统一图像查看器（缩放/平移/像素网格 + 旋转/翻转/裁剪/缩放/调色/通道/位平面）。
//
// 用法：
//   import { openImageOpsViewer } from "./ui/imageOpsViewer.js";
//   openImageOpsViewer(source, { title, bytes, onUse });
//
// source 支持 dataURL / blob URL / http(s) URL / Blob / Uint8Array / ArrayBuffer / {width,height,data}。
// opts.bytes 优先作为原始文件字节（PNG/JPEG/...）。opts.onUse(dataURL, meta) 在点「用作输入」时回调。
// 所有像素运算来自 ../core/imageOps.js（纯函数，Node 可测）；本文件只做 DOM、canvas 与事件。
// 不写回、不覆盖原始文件；导出与「用作输入」都基于当前编辑结果新建 PNG。

import { icon as iconSvg } from "./icons.js";
import { attachModalLifecycle } from "./modalLifecycle.js";
import {
  isImageLike,
  createHistory,
  rotate90,
  rotate180,
  rotate270,
  rotateArbitrary,
  flipH,
  flipV,
  crop,
  resize,
  adjustImage,
  invert,
  extractChannel,
  mapChannels,
  bitPlane,
} from "../core/imageOps.js";

const STYLE_ID = "imgops-styles";

function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./imageOpsViewer.css", import.meta.url).href;
  document.head.append(link);
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

function iconNode(name) {
  const span = el("span", { class: "imgops-ico", "aria-hidden": "true" });
  span.innerHTML = iconSvg(name);
  return span;
}

function makeButton(label, attrs = {}, iconName = "") {
  const btn = el("button", { type: "button", class: "imgops-btn", ...attrs });
  if (label && !attrs["aria-label"]) btn.setAttribute("aria-label", label);
  if (iconName) btn.append(iconNode(iconName));
  if (label) btn.append(el("span", { text: label }));
  return btn;
}

function toolButton(iconName, title, attrs = {}) {
  const btn = el("button", {
    type: "button",
    class: "imgops-tool",
    title,
    "aria-label": title,
    ...attrs,
  });
  btn.append(iconNode(iconName));
  return btn;
}

function field(label, control, extraClass = "") {
  return el("label", { class: "imgops-field" + (extraClass ? " " + extraClass : "") },
    el("span", { class: "imgops-field-label", text: label }),
    control,
  );
}

function numberInput(attrs = {}) {
  return el("input", {
    type: "number",
    class: "imgops-input",
    inputmode: "numeric",
    ...attrs,
  });
}

function group(title, ...children) {
  return el("section", { class: "imgops-group" },
    el("h3", { class: "imgops-group-title", text: title }),
    ...children,
  );
}

function byteInput(value) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  return null;
}

function drawableToImage(drawable) {
  const width = Math.max(1, Math.round(drawable.width || drawable.naturalWidth || 0));
  const height = Math.max(1, Math.round(drawable.height || drawable.naturalHeight || 0));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器不支持 Canvas 2D");
  ctx.drawImage(drawable, 0, 0);
  let data;
  try {
    data = ctx.getImageData(0, 0, width, height).data;
  } catch (err) {
    if (err && err.name === "SecurityError") {
      throw new Error("跨域图片受浏览器限制，无法读取像素；请改用本地上传、同源地址或带 CORS 的 URL");
    }
    throw err;
  }
  return { width, height, data };
}

function imageElementToImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try { resolve(drawableToImage(img)); }
      catch (err) { reject(err); }
    };
    img.onerror = () => reject(new Error("图片解码失败（格式不受当前浏览器支持或地址不可访问）"));
    img.src = url;
  });
}

async function blobToImage(blob) {
  if (typeof createImageBitmap === "function") {
    let bitmap = null;
    try { bitmap = await createImageBitmap(blob); } catch { bitmap = null; }
    if (bitmap) {
      try { return drawableToImage(bitmap); }
      finally { if (typeof bitmap.close === "function") bitmap.close(); }
    }
  }
  const url = URL.createObjectURL(blob);
  try { return await imageElementToImage(url); }
  finally { URL.revokeObjectURL(url); }
}

async function decodeImageSource(source, explicitBytes) {
  if (isImageLike(source) && !byteInput(explicitBytes)) {
    return {
      width: source.width,
      height: source.height,
      data: new Uint8ClampedArray(source.data),
    };
  }
  const explicit = byteInput(explicitBytes);
  const raw = (explicit && explicit.length ? explicit : null) || byteInput(source);
  let blob = null;
  if (raw && raw.length) {
    blob = new Blob([raw]);
  } else if (typeof Blob !== "undefined" && source instanceof Blob) {
    blob = source;
  } else if (typeof source === "string") {
    const url = source.trim();
    if (!url) throw new Error("图像 source 为空");
    if (/^data:/i.test(url) || /^(blob:|https?:|file:)/i.test(url)) {
      try {
        const res = await fetch(url);
        if (res.ok) blob = await res.blob();
      } catch { /* 落到 Image 兜底 */ }
      if (!blob) return imageElementToImage(url);
    } else {
      return imageElementToImage(url);
    }
  }
  if (!blob) throw new Error("无法识别的图像 source（支持 dataURL / blob URL / URL / Blob / Uint8Array）");
  return blobToImage(blob);
}

function imageToCanvas(img) {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器不支持 Canvas 2D");
  const imageData = ctx.createImageData(img.width, img.height);
  imageData.data.set(img.data);
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function sanitizeFileName(title) {
  const base = String(title || "image")
    .replace(/\.[A-Za-z0-9]{1,8}$/, "")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .trim();
  return (base || "image") + "-edited.png";
}

/**
 * 打开统一图像查看器。
 * @param {string|Blob|Uint8Array|ArrayBuffer|{width:number,height:number,data:ArrayLike<number>}} source
 * @param {object|string} [opts] 传字符串时视为标题（兼容旧 openImageLightbox(url, alt) 调用）
 * @param {string} [opts.title] 标题（也用于导出文件名）
 * @param {Uint8Array|ArrayBuffer} [opts.bytes] 原始文件字节，优先于 source 解码
 * @param {(dataURL:string, meta:{width:number,height:number,title:string}) => void} [opts.onUse]
 * @param {boolean} [opts.closeOnUse=true] 「用作输入」回调成功后是否自动关闭
 * @returns {Function & {ready: Promise, element: HTMLElement, getImage: Function}} close
 */
export function openImageOpsViewer(source, opts = {}) {
  if (typeof document === "undefined") throw new Error("openImageOpsViewer 只能在浏览器中使用");
  if (typeof opts === "string") opts = { title: opts };
  else if (!opts || typeof opts !== "object") opts = {};
  ensureStyles();

  const previousFocus = document.activeElement;
  const title = String(
    opts.title ||
    (source && typeof source === "object" && source.name) ||
    "图像查看器",
  );
  const state = {
    original: null,
    history: null,
    preview: null,
    ready: false,
    closed: false,
    grid: true,
    cropMode: false,
    cropRect: null,
    onUse: typeof opts.onUse === "function" ? opts.onUse : null,
    title,
  };
  const view = { scale: 1, ox: 0, oy: 0, fit: true };
  let closed = false;
  let lifecycle = null;
  let resizeObserver = null;
  let renderRaf = 0;
  let adjustRaf = 0;
  let bufferCanvas = null;
  let bufferCtx = null;
  let bufferImage = null;

  const overlay = el("div", { class: "imgops-overlay" });
  const dialog = el("div", {
    class: "imgops-dialog",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": title,
  });

  const titleEl = el("div", { class: "imgops-title", text: title });
  const metaEl = el("div", { class: "imgops-meta", text: "正在加载…" });
  const headText = el("div", { class: "imgops-head-text" }, titleEl, metaEl);
  const closeBtn = el("button", {
    type: "button",
    class: "imgops-close",
    title: "关闭",
    "aria-label": "关闭",
    "data-imgops": "close",
  });
  closeBtn.append(iconNode("close"));
  const head = el("div", { class: "imgops-head" }, headText, closeBtn);

  const canvas = el("canvas", {
    class: "imgops-canvas",
    role: "img",
    "aria-label": "图像预览",
  });
  const ctx = canvas.getContext("2d");
  const hintEl = el("div", {
    class: "imgops-hint",
    text: "滚轮缩放 · 拖拽平移 · 双击适应窗口 · 方向键平移 · +/- 缩放",
  });
  const errorEl = el("div", { class: "imgops-error", hidden: "" });
  const viewport = el("div", {
    class: "imgops-viewport",
    tabindex: "0",
    "data-imgops": "viewport",
  }, canvas, hintEl, errorEl);

  const statusEl = el("div", { class: "imgops-status", role: "status", "aria-live": "polite", text: "正在加载图像…" });
  const pixelEl = el("div", { class: "imgops-pixel", text: "" });
  const statusBar = el("div", { class: "imgops-statusbar" }, statusEl, pixelEl);

  const zoomLabel = el("span", { class: "imgops-zoom", "data-imgops": "zoom-label", text: "100%" });
  const zoomOutBtn = toolButton("remove", "缩小（-）", { "data-imgops": "zoom-out" });
  const zoomInBtn = toolButton("add", "放大（+）", { "data-imgops": "zoom-in" });
  const fitBtn = toolButton("open_in_full", "适应窗口（0）", { "data-imgops": "fit" });
  const actualBtn = makeButton("1:1", { class: "imgops-btn imgops-tbtn", title: "实际大小（1）", "data-imgops": "actual" }, "open_in_full");
  const gridBtn = toolButton("grid_view", "像素网格（G）", { "data-imgops": "grid", "aria-pressed": "true" });
  gridBtn.classList.add("active");
  const undoBtn = makeButton("撤销", { class: "imgops-btn imgops-tbtn", title: "撤销（Ctrl+Z）", "data-imgops": "undo" }, "history");
  const redoBtn = makeButton("重做", { class: "imgops-btn imgops-tbtn", title: "重做（Ctrl+Shift+Z / Ctrl+Y）", "data-imgops": "redo" }, "refresh");
  const resetBtn = makeButton("复位", { class: "imgops-btn imgops-tbtn", title: "回复到打开时的图像", "data-imgops": "reset" }, "restart_alt");
  const toolbar = el("div", { class: "imgops-toolbar" },
    zoomOutBtn, zoomLabel, zoomInBtn,
    el("span", { class: "imgops-sep", "aria-hidden": "true" }),
    fitBtn, actualBtn, gridBtn,
    el("span", { class: "imgops-sep", "aria-hidden": "true" }),
    undoBtn, redoBtn, resetBtn,
  );

  const tabs = el("div", { class: "imgops-tabs", role: "tablist", "aria-label": "图像操作" });
  const tabDefs = [
    { id: "transform", label: "变换", icon: "sync" },
    { id: "color", label: "调色", icon: "palette" },
    { id: "channel", label: "通道", icon: "grid_view" },
  ];
  const tabButtons = new Map();

  const rotate90Btn = makeButton("90°", { "data-imgops": "rotate90", title: "顺时针旋转 90°" }, "rotate_right");
  const rotate180Btn = makeButton("180°", { "data-imgops": "rotate180", title: "旋转 180°" }, "sync");
  const rotate270Btn = makeButton("270°", { "data-imgops": "rotate270", title: "顺时针旋转 270°" }, "sync");
  const angleInput = numberInput({ min: "-360", max: "360", step: "0.1", value: "0", "data-imgops": "angle-input", "aria-label": "任意旋转角度" });
  const expandChk = el("input", { type: "checkbox", class: "imgops-check", "data-imgops": "angle-expand" });
  expandChk.checked = true;
  const angleBtn = makeButton("旋转", { "data-imgops": "apply-angle", class: "imgops-btn primary" }, "rotate_right");
  const flipHBtn = makeButton("水平翻转", { "data-imgops": "flip-h" }, "swap_horiz");
  const flipVBtn = makeButton("垂直翻转", { "data-imgops": "flip-v" }, "swap_vert");

  const cropX = numberInput({ min: "0", step: "1", value: "0", "data-imgops": "crop-x", "aria-label": "裁剪 x" });
  const cropY = numberInput({ min: "0", step: "1", value: "0", "data-imgops": "crop-y", "aria-label": "裁剪 y" });
  const cropW = numberInput({ min: "1", step: "1", value: "1", "data-imgops": "crop-w", "aria-label": "裁剪宽度" });
  const cropH = numberInput({ min: "1", step: "1", value: "1", "data-imgops": "crop-h", "aria-label": "裁剪高度" });
  const cropModeBtn = makeButton("框选", { "data-imgops": "crop-mode", "aria-pressed": "false", title: "在图上拖拽框选裁剪区域" }, "crop");
  const cropApplyBtn = makeButton("应用裁剪", { "data-imgops": "crop-apply", class: "imgops-btn primary" }, "check");
  const cropClearBtn = makeButton("清除选区", { "data-imgops": "crop-clear" }, "close");

  const resizeW = numberInput({ min: "1", max: "16384", step: "1", "data-imgops": "resize-w", "aria-label": "目标宽度" });
  const resizeH = numberInput({ min: "1", max: "16384", step: "1", "data-imgops": "resize-h", "aria-label": "目标高度" });
  const resizeMethod = el("select", { class: "imgops-select", "data-imgops": "resize-method", "aria-label": "缩放算法" },
    el("option", { value: "nearest" }, "最近邻"),
    el("option", { value: "bilinear" }, "双线性"),
  );
  const resizeLock = el("input", { type: "checkbox", class: "imgops-check", "data-imgops": "resize-lock" });
  resizeLock.checked = true;
  const resizeApplyBtn = makeButton("应用缩放", { "data-imgops": "resize-apply", class: "imgops-btn primary" }, "check");

  const transformPanel = el("div", {
    class: "imgops-panel",
    id: "imgops-panel-transform",
    role: "tabpanel",
    "aria-labelledby": "imgops-tab-transform",
  },
    group("旋转",
      el("div", { class: "imgops-row" }, rotate90Btn, rotate180Btn, rotate270Btn),
      el("div", { class: "imgops-row" },
        field("角度°", angleInput, "imgops-field-sm"),
        angleBtn,
        el("label", { class: "imgops-inline-check" }, expandChk, el("span", { text: "扩展画布" })),
      ),
    ),
    group("翻转",
      el("div", { class: "imgops-row" }, flipHBtn, flipVBtn),
    ),
    group("裁剪",
      el("div", { class: "imgops-grid4" },
        field("x", cropX),
        field("y", cropY),
        field("宽", cropW),
        field("高", cropH),
      ),
      el("div", { class: "imgops-row" }, cropModeBtn, cropApplyBtn, cropClearBtn),
      el("p", { class: "imgops-tip", text: "「框选」后直接在图上拖拽；也可直接填数值。" }),
    ),
    group("缩放",
      el("div", { class: "imgops-row" },
        field("宽", resizeW, "imgops-field-sm"),
        field("高", resizeH, "imgops-field-sm"),
        field("算法", resizeMethod, "imgops-field-sm"),
      ),
      el("div", { class: "imgops-row" },
        el("label", { class: "imgops-inline-check" }, resizeLock, el("span", { text: "锁定比例" })),
        resizeApplyBtn,
      ),
    ),
  );

  function rangeRow(id, label) {
    const input = el("input", {
      type: "range",
      min: "-100",
      max: "100",
      step: "1",
      value: "0",
      class: "imgops-range",
      "data-imgops": id,
      "aria-label": label,
    });
    const out = el("output", { class: "imgops-range-value", text: "0" });
    const syncFill = () => {
      const min = Number(input.min) || -100;
      const max = Number(input.max) || 100;
      const val = Number(input.value) || 0;
      const pct = max > min ? ((val - min) / (max - min)) * 100 : 50;
      input.style.setProperty("--range-fill", pct + "%");
    };
    input.addEventListener("input", syncFill);
    syncFill();
    return {
      input,
      out,
      syncFill,
      row: el("div", { class: "imgops-range-row" },
        el("span", { class: "imgops-range-label", text: label }),
        input,
        out,
      ),
    };
  }
  const brightnessRange = rangeRow("brightness", "亮度");
  const contrastRange = rangeRow("contrast", "对比度");
  const saturationRange = rangeRow("saturation", "饱和度");
  const adjustApplyBtn = makeButton("应用调色", { "data-imgops": "adjust-apply", class: "imgops-btn primary" }, "check");
  const adjustCancelBtn = makeButton("取消预览", { "data-imgops": "adjust-cancel" }, "close");
  const invertBtn = makeButton("反色", { "data-imgops": "invert" }, "colorize");
  const colorPanel = el("div", {
    class: "imgops-panel",
    id: "imgops-panel-color",
    role: "tabpanel",
    "aria-labelledby": "imgops-tab-color",
    hidden: "",
  },
    group("亮度 / 对比度 / 饱和度",
      brightnessRange.row,
      contrastRange.row,
      saturationRange.row,
      el("div", { class: "imgops-row" }, adjustApplyBtn, adjustCancelBtn),
      el("p", { class: "imgops-tip", text: "拖动即时预览；「应用调色」写入历史，可撤销。" }),
    ),
    group("反色",
      el("div", { class: "imgops-row" }, invertBtn),
    ),
  );

  function channelOptions(withKeep = false) {
    const opts = [
      el("option", { value: "r" }, "R"),
      el("option", { value: "g" }, "G"),
      el("option", { value: "b" }, "B"),
      el("option", { value: "a" }, "A"),
      el("option", { value: "gray" }, "灰度"),
    ];
    if (withKeep) opts.unshift(el("option", { value: "keep" }, "保持原图"));
    return opts;
  }
  const splitRBtn = makeButton("R", { "data-imgops": "split-r", title: "只看 R 通道" }, "palette");
  const splitGBtn = makeButton("G", { "data-imgops": "split-g", title: "只看 G 通道" }, "palette");
  const splitBBtn = makeButton("B", { "data-imgops": "split-b", title: "只看 B 通道" }, "palette");
  const splitABtn = makeButton("A", { "data-imgops": "split-a", title: "只看 Alpha 通道" }, "palette");
  const mergeR = el("select", { class: "imgops-select", "data-imgops": "merge-r", "aria-label": "输出 R 来自" }, ...channelOptions());
  const mergeG = el("select", { class: "imgops-select", "data-imgops": "merge-g", "aria-label": "输出 G 来自" }, ...channelOptions());
  const mergeB = el("select", { class: "imgops-select", "data-imgops": "merge-b", "aria-label": "输出 B 来自" }, ...channelOptions());
  const mergeA = el("select", { class: "imgops-select", "data-imgops": "merge-a", "aria-label": "输出 Alpha 来自" }, ...channelOptions(true));
  mergeR.value = "r"; mergeG.value = "g"; mergeB.value = "b"; mergeA.value = "keep";
  const mergeApplyBtn = makeButton("合并通道", { "data-imgops": "merge-apply", class: "imgops-btn primary" }, "check");
  const mergeResetBtn = makeButton("恢复 RGB", { "data-imgops": "merge-reset" }, "restart_alt");
  const bitChannel = el("select", { class: "imgops-select", "data-imgops": "bit-channel", "aria-label": "位平面通道" },
    el("option", { value: "r" }, "R"),
    el("option", { value: "g" }, "G"),
    el("option", { value: "b" }, "B"),
    el("option", { value: "a" }, "A"),
    el("option", { value: "gray" }, "灰度"),
  );
  const bitSelect = el("select", { class: "imgops-select", "data-imgops": "bit-plane", "aria-label": "位平面" },
    ...Array.from({ length: 8 }, (_, i) => el("option", { value: String(i) }, `bit ${i}${i === 0 ? " (LSB)" : i === 7 ? " (MSB)" : ""}`)),
  );
  bitSelect.value = "0";
  const bitApplyBtn = makeButton("查看位平面", { "data-imgops": "bit-apply", class: "imgops-btn primary" }, "grid_on");
  const channelPanel = el("div", {
    class: "imgops-panel",
    id: "imgops-panel-channel",
    role: "tabpanel",
    "aria-labelledby": "imgops-tab-channel",
    hidden: "",
  },
    group("通道分离",
      el("div", { class: "imgops-row" }, splitRBtn, splitGBtn, splitBBtn, splitABtn),
    ),
    group("通道合并",
      el("div", { class: "imgops-grid4" },
        field("R ←", mergeR),
        field("G ←", mergeG),
        field("B ←", mergeB),
        field("A ←", mergeA),
      ),
      el("div", { class: "imgops-row" }, mergeApplyBtn, mergeResetBtn),
      el("p", { class: "imgops-tip", text: "从当前图挑通道重组；A 默认保持原图。" }),
    ),
    group("位平面",
      el("div", { class: "imgops-row" },
        field("通道", bitChannel, "imgops-field-sm"),
        field("位", bitSelect, "imgops-field-sm"),
        bitApplyBtn,
      ),
      el("p", { class: "imgops-tip", text: "0 = LSB，7 = MSB；白点表示该位为 1。" }),
    ),
  );

  for (const def of tabDefs) {
    const btn = el("button", {
      type: "button",
      class: "imgops-tab",
      role: "tab",
      id: "imgops-tab-" + def.id,
      "aria-controls": "imgops-panel-" + def.id,
      "aria-selected": def.id === "transform" ? "true" : "false",
      tabindex: def.id === "transform" ? "0" : "-1",
      "data-imgops-tab": def.id,
    }, iconNode(def.icon), el("span", { text: def.label }));
    btn.addEventListener("click", () => switchTab(def.id));
    tabButtons.set(def.id, btn);
    tabs.append(btn);
  }

  // 轻量看图：默认只留画布 + 底部「图标+文字」工具栏；重编辑面板收进「更多」抽屉。
  const quickRotateBtn = makeButton("旋转", { "data-imgops": "quick-rotate", title: "顺时针旋转 90°（快捷键 R）" }, "rotate_right");
  const quickCropBtn = makeButton("裁剪", { "data-imgops": "quick-crop", "aria-pressed": "false", title: "框选裁剪区域" }, "crop");
  const quickCropApplyBtn = makeButton("应用", { "data-imgops": "quick-crop-apply", title: "应用当前裁剪框" }, "check");
  quickCropApplyBtn.disabled = true;
  const quickCropClearBtn = makeButton("取消", { "data-imgops": "quick-crop-clear", title: "清除裁剪框" }, "close");
  quickCropClearBtn.disabled = true;
  const quickFilter = el("select", { class: "imgops-quick-select", "data-imgops": "quick-filter", "aria-label": "颜色筛选" },
    el("option", { value: "" }, "颜色筛选"),
    el("option", { value: "gray" }, "灰度"),
    el("option", { value: "r" }, "只看 R"),
    el("option", { value: "g" }, "只看 G"),
    el("option", { value: "b" }, "只看 B"),
    el("option", { value: "a" }, "只看 A"),
  );
  const quickGridBtn = makeButton("网格", { "data-imgops": "quick-grid", "aria-pressed": "true", title: "像素网格（G）" }, "grid_on");
  quickGridBtn.classList.add("active");
  const moreBtn = makeButton("更多", { "data-imgops": "more", "aria-expanded": "false", title: "展开更多编辑功能" }, "tune");
  const quickFilterWrap = el("label", { class: "imgops-quick-filter", title: "颜色筛选" },
    iconNode("palette"), quickFilter);
  const quickActions = el("div", { class: "imgops-quick-actions" },
    quickRotateBtn, quickCropBtn, quickCropApplyBtn, quickCropClearBtn,
    quickFilterWrap, quickGridBtn, moreBtn,
  );
  const quickZoom = el("div", { class: "imgops-zoom-cluster" },
    zoomOutBtn, zoomLabel, zoomInBtn,
    fitBtn, actualBtn,
  );
  const quickHistory = el("div", { class: "imgops-quick-history" }, undoBtn, redoBtn, resetBtn);
  toolbar.classList.add("imgops-quickbar");
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "图像查看与快速编辑");
  toolbar.replaceChildren(quickActions, quickZoom, quickHistory);

  const sheet = el("div", { class: "imgops-sheet", hidden: "" },
    el("div", { class: "imgops-sheet-head" },
      el("span", { class: "imgops-sheet-title" }, "更多编辑"),
      el("span", { class: "imgops-sheet-tip" }, "旋转角度 / 缩放 / 调色 / 通道 / 位平面"),
    ),
    tabs, transformPanel, colorPanel, channelPanel,
  );

  const stage = el("section", { class: "imgops-stage" }, viewport, statusBar);
  const body = el("div", { class: "imgops-body" }, stage, toolbar, sheet);

  const historyEl = el("div", { class: "imgops-history", text: "历史 -" });
  const useBtn = state.onUse
    ? makeButton("用作输入", {
      class: "imgops-btn imgops-action primary",
      "data-imgops": "use-input",
      title: "把当前结果作为 PNG dataURL 交给调用方",
    }, "content_paste")
    : null;
  const exportBtn = makeButton("导出 PNG", {
    class: "imgops-btn imgops-action",
    "data-imgops": "export-png",
    title: "导出当前结果的 PNG 副本",
  }, "download");
  exportBtn.disabled = true;
  const foot = el("div", { class: "imgops-foot" },
    historyEl,
    el("div", { class: "imgops-foot-actions" }, useBtn, exportBtn),
  );

  dialog.append(head, body, foot);
  overlay.append(dialog);
  document.body.append(overlay);

  // ---------- 视图 ----------
  function currentImage() {
    return state.preview || (state.history ? state.history.current : null);
  }

  function fitScaleFor(img, vw, vh) {
    const pad = 24;
    let scale = Math.min((vw - pad) / img.width, (vh - pad) / img.height);
    if (!Number.isFinite(scale) || scale <= 0) scale = 1;
    return Math.max(0.01, Math.min(1, scale));
  }

  function ensureView(img) {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    if (!vw || !vh) return false;
    if (view.fit) {
      view.scale = fitScaleFor(img, vw, vh);
      view.ox = (vw - img.width * view.scale) / 2;
      view.oy = (vh - img.height * view.scale) / 2;
    }
    return true;
  }

  function clampPan(img, vw, vh) {
    const iw = img.width * view.scale;
    const ih = img.height * view.scale;
    const margin = 40;
    if (iw <= vw) view.ox = (vw - iw) / 2;
    else view.ox = Math.min(margin, Math.max(vw - iw - margin, view.ox));
    if (ih <= vh) view.oy = (vh - ih) / 2;
    else view.oy = Math.min(margin, Math.max(vh - ih - margin, view.oy));
  }

  function formatZoom(scale) {
    const pct = scale * 100;
    return (pct < 10 ? pct.toFixed(1) : String(Math.round(pct))) + "%";
  }

  function ensureBuffer(img) {
    if (!bufferCanvas) {
      bufferCanvas = document.createElement("canvas");
      bufferCtx = bufferCanvas.getContext("2d");
    }
    if (bufferImage === img && bufferCanvas.width === img.width && bufferCanvas.height === img.height) {
      return bufferCanvas;
    }
    bufferCanvas.width = img.width;
    bufferCanvas.height = img.height;
    const id = bufferCtx.createImageData(img.width, img.height);
    id.data.set(img.data);
    bufferCtx.putImageData(id, 0, 0);
    bufferImage = img;
    return bufferCanvas;
  }

  function drawGrid(img) {
    const scale = view.scale;
    if (!state.grid || scale < 6) return;
    const ox = view.ox, oy = view.oy;
    const vw = viewport.clientWidth, vh = viewport.clientHeight;
    const x0 = Math.max(0, Math.floor(-ox / scale));
    const x1 = Math.min(img.width, Math.ceil((vw - ox) / scale));
    const y0 = Math.max(0, Math.floor(-oy / scale));
    const y1 = Math.min(img.height, Math.ceil((vh - oy) / scale));
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, img.width * scale, img.height * scale);
    ctx.clip();
    ctx.globalCompositeOperation = "difference";
    ctx.lineWidth = 1;
    for (let x = x0; x <= x1; x++) {
      ctx.strokeStyle = x % 10 === 0 ? "rgba(255,255,255,.85)" : "rgba(255,255,255,.35)";
      const px = Math.round(ox + x * scale) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, Math.max(oy, 0));
      ctx.lineTo(px, Math.min(oy + img.height * scale, vh));
      ctx.stroke();
    }
    for (let y = y0; y <= y1; y++) {
      ctx.strokeStyle = y % 10 === 0 ? "rgba(255,255,255,.85)" : "rgba(255,255,255,.35)";
      const py = Math.round(oy + y * scale) + 0.5;
      ctx.beginPath();
      ctx.moveTo(Math.max(ox, 0), py);
      ctx.lineTo(Math.min(ox + img.width * scale, vw), py);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCropOverlay(img) {
    if (!state.cropRect) return;
    const r = state.cropRect;
    const x = view.ox + r.x * view.scale;
    const y = view.oy + r.y * view.scale;
    const w = r.width * view.scale;
    const h = r.height * view.scale;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.45)";
    ctx.beginPath();
    ctx.rect(view.ox, view.oy, img.width * view.scale, img.height * view.scale);
    ctx.rect(x, y, w, h);
    ctx.fill("evenodd");
    const primary = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim() || "#ff8a80";
    ctx.strokeStyle = primary;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
    ctx.restore();
  }

  function render() {
    const img = currentImage();
    if (!img) return;
    if (!ensureView(img)) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.max(1, Math.round(vw * dpr));
    const ph = Math.max(1, Math.round(vh * dpr));
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    canvas.style.width = vw + "px";
    canvas.style.height = vh + "px";
    clampPan(img, vw, vh);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    ctx.imageSmoothingEnabled = view.scale < 1;
    const buffer = ensureBuffer(img);
    ctx.drawImage(buffer, view.ox, view.oy, img.width * view.scale, img.height * view.scale);
    drawGrid(img);
    drawCropOverlay(img);
    zoomLabel.textContent = formatZoom(view.scale);
  }

  function requestRender() {
    if (renderRaf) return;
    renderRaf = requestAnimationFrame(() => {
      renderRaf = 0;
      render();
    });
  }

  function fitToWindow() {
    view.fit = true;
    requestRender();
    setStatus("适应窗口");
  }

  function actualSize() {
    const img = currentImage();
    if (!img) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    view.fit = false;
    view.scale = 1;
    view.ox = (vw - img.width) / 2;
    view.oy = (vh - img.height) / 2;
    clampPan(img, vw, vh);
    requestRender();
    setStatus("实际大小 100%");
  }

  function setScale(nextScale, anchorX, anchorY) {
    const img = currentImage();
    if (!img) return;
    if (!ensureView(img)) return;
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const ax = anchorX == null ? vw / 2 : anchorX;
    const ay = anchorY == null ? vh / 2 : anchorY;
    const scale = Math.max(0.01, Math.min(64, nextScale));
    const ix = (ax - view.ox) / view.scale;
    const iy = (ay - view.oy) / view.scale;
    view.scale = scale;
    view.ox = ax - ix * scale;
    view.oy = ay - iy * scale;
    view.fit = false;
    clampPan(img, vw, vh);
    requestRender();
  }

  function zoomBy(factor) {
    const img = currentImage();
    if (!img) return;
    if (!ensureView(img)) return;
    setScale(view.scale * factor);
  }

  function toggleGrid() {
    state.grid = !state.grid;
    for (const btn of [gridBtn, quickGridBtn]) {
      btn.classList.toggle("active", state.grid);
      btn.setAttribute("aria-pressed", String(state.grid));
    }
    requestRender();
    setStatus(state.grid ? "像素网格已开启（放大到 600% 以上可见）" : "像素网格已关闭");
  }

  // ---------- 状态 ----------
  function setStatus(text, level = "info") {
    statusEl.textContent = String(text);
    statusEl.dataset.level = level;
  }

  function updateMeta() {
    const img = currentImage();
    if (!img) {
      metaEl.textContent = "正在加载…";
      return;
    }
    metaEl.textContent = `${img.width} × ${img.height} px${state.preview ? " · 调色预览" : ""}`;
  }

  function updateUI() {
    const hist = state.history;
    const img = currentImage();
    undoBtn.disabled = !hist || !hist.canUndo;
    redoBtn.disabled = !hist || !hist.canRedo;
    resetBtn.disabled = !hist || hist.index === 0;
    historyEl.textContent = hist ? `历史 ${hist.index}/${hist.length - 1} · ${hist.label}` : "历史 -";
    exportBtn.disabled = !img;
    if (useBtn) useBtn.disabled = !img;
    updateMeta();
  }

  function syncImageFields() {
    const img = state.history ? state.history.current : null;
    if (!img) return;
    resizeW.value = String(img.width);
    resizeH.value = String(img.height);
    if (!state.cropRect) {
      cropX.value = "0";
      cropY.value = "0";
      cropW.value = String(img.width);
      cropH.value = String(img.height);
    }
  }

  function afterHistoryChange(label) {
    state.cropRect = null;
    state.cropMode = false;
    cropModeBtn.classList.remove("active");
    cropModeBtn.setAttribute("aria-pressed", "false");
    viewport.classList.remove("cropping");
    syncQuickCropState();
    syncImageFields();
    updateUI();
    const img = currentImage();
    if (!img) return;
    if (view.fit) fitToWindow();
    else {
      ensureView(img);
      clampPan(img, viewport.clientWidth, viewport.clientHeight);
      requestRender();
    }
    if (label) setStatus(`${label} · ${img.width}×${img.height} px`, "ok");
  }

  function applyOperation(label, fn) {
    if (!state.history) return;
    try {
      if (state.preview) commitAdjustPreview();
      const out = fn(state.history.current);
      if (!out) return;
      state.history.push(out, label);
      afterHistoryChange(label);
    } catch (err) {
      setStatus(err && err.message ? err.message : String(err), "error");
    }
  }

  // ---------- 历史 ----------
  function undo() {
    if (!state.history || !state.history.canUndo) return;
    cancelAdjustPreview();
    state.history.undo();
    afterHistoryChange("撤销");
  }

  function redo() {
    if (!state.history || !state.history.canRedo) return;
    cancelAdjustPreview();
    state.history.redo();
    afterHistoryChange("重做");
  }

  function resetAll() {
    if (!state.history) return;
    cancelAdjustPreview();
    state.history.reset();
    afterHistoryChange("复位");
    setStatus("已复位到打开时的图像", "ok");
  }

  // ---------- 裁剪 ----------
  function syncQuickCropState() {
    const hasRect = !!state.cropRect;
    quickCropApplyBtn.disabled = !hasRect;
    quickCropClearBtn.disabled = !hasRect;
    quickCropBtn.classList.toggle("active", state.cropMode);
    quickCropBtn.setAttribute("aria-pressed", String(state.cropMode));
  }

  function setCropMode(on) {
    state.cropMode = !!on;
    cropModeBtn.classList.toggle("active", state.cropMode);
    cropModeBtn.setAttribute("aria-pressed", String(state.cropMode));
    viewport.classList.toggle("cropping", state.cropMode);
    syncQuickCropState();
    if (state.cropMode) {
      setStatus("在图上拖拽框选裁剪区域");
      viewport.focus({ preventScroll: true });
    } else {
      setStatus("已退出框选");
    }
  }

  function clearCrop() {
    state.cropRect = null;
    syncImageFields();
    syncQuickCropState();
    requestRender();
    setStatus("已清除选区");
  }

  function cropRectFromPoints(a, b, img) {
    let x1 = Math.max(0, Math.min(img.width, Math.floor(Math.min(a.x, b.x))));
    let y1 = Math.max(0, Math.min(img.height, Math.floor(Math.min(a.y, b.y))));
    let x2 = Math.max(0, Math.min(img.width, Math.ceil(Math.max(a.x, b.x))));
    let y2 = Math.max(0, Math.min(img.height, Math.ceil(Math.max(a.y, b.y))));
    if (x2 <= x1) x2 = Math.min(img.width, x1 + 1);
    if (y2 <= y1) y2 = Math.min(img.height, y1 + 1);
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  function updateCropFields() {
    const r = state.cropRect;
    syncQuickCropState();
    if (!r) return;
    cropX.value = String(r.x);
    cropY.value = String(r.y);
    cropW.value = String(r.width);
    cropH.value = String(r.height);
  }

  // ---------- 调色 ----------
  function readAdjust() {
    return {
      brightness: Number(brightnessRange.input.value) || 0,
      contrast: Number(contrastRange.input.value) || 0,
      saturation: Number(saturationRange.input.value) || 0,
    };
  }

  function updateAdjustLabels() {
    brightnessRange.out.textContent = brightnessRange.input.value;
    contrastRange.out.textContent = contrastRange.input.value;
    saturationRange.out.textContent = saturationRange.input.value;
  }

  function resetAdjustSliders() {
    for (const item of [brightnessRange, contrastRange, saturationRange]) {
      item.input.value = "0";
      item.syncFill();
    }
    updateAdjustLabels();
  }

  function cancelAdjustPreview() {
    if (adjustRaf) {
      cancelAnimationFrame(adjustRaf);
      adjustRaf = 0;
    }
    state.preview = null;
    resetAdjustSliders();
    updateUI();
    requestRender();
  }

  function scheduleAdjustPreview() {
    updateAdjustLabels();
    if (!state.history) return;
    const opts = readAdjust();
    if (opts.brightness === 0 && opts.contrast === 0 && opts.saturation === 0) {
      state.preview = null;
      updateUI();
      requestRender();
      setStatus("调色预览已清除");
      return;
    }
    if (adjustRaf) cancelAnimationFrame(adjustRaf);
    adjustRaf = requestAnimationFrame(() => {
      adjustRaf = 0;
      if (!state.history) return;
      try {
        state.preview = adjustImage(state.history.current, opts);
        updateUI();
        if (view.fit) requestRender();
        else requestRender();
        setStatus(`预览：亮度 ${opts.brightness} · 对比度 ${opts.contrast} · 饱和度 ${opts.saturation}`);
      } catch (err) {
        setStatus(err && err.message ? err.message : String(err), "error");
      }
    });
  }

  function applyAdjust() {
    if (!state.history) return;
    if (adjustRaf) {
      cancelAnimationFrame(adjustRaf);
      adjustRaf = 0;
    }
    const opts = readAdjust();
    if (opts.brightness === 0 && opts.contrast === 0 && opts.saturation === 0) {
      state.preview = null;
      updateUI();
      requestRender();
      setStatus("没有调色变化");
      return;
    }
    try {
      const out = adjustImage(state.history.current, opts);
      state.preview = null;
      state.history.push(out, "调色");
      resetAdjustSliders();
      afterHistoryChange("调色");
    } catch (err) {
      setStatus(err && err.message ? err.message : String(err), "error");
    }
  }

  function commitAdjustPreview() {
    if (!state.preview || !state.history) return false;
    if (adjustRaf) {
      cancelAnimationFrame(adjustRaf);
      adjustRaf = 0;
    }
    state.history.push(state.preview, "调色");
    state.preview = null;
    resetAdjustSliders();
    return true;
  }

  // ---------- 卸载 / 导出 ----------
  function exportPng() {
    const img = currentImage();
    if (!img) return;
    try {
      const url = imageToCanvas(img).toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = sanitizeFileName(state.title);
      document.body.append(a);
      a.click();
      a.remove();
      setStatus(`已导出 PNG · ${img.width}×${img.height}`, "ok");
    } catch (err) {
      setStatus("导出失败：" + (err && err.message ? err.message : String(err)), "error");
    }
  }

  function useAsInput() {
    const img = currentImage();
    if (!img || !state.onUse) return;
    let dataUrl;
    try {
      dataUrl = imageToCanvas(img).toDataURL("image/png");
    } catch (err) {
      setStatus("生成 PNG 失败：" + (err && err.message ? err.message : String(err)), "error");
      return;
    }
    try {
      const result = state.onUse(dataUrl, { width: img.width, height: img.height, title: state.title });
      if (result && typeof result.then === "function") {
        result.catch((err) => {
          try {
            if (typeof window.__ebctfToast === "function") window.__ebctfToast("用作输入失败：" + (err && err.message ? err.message : err));
          } catch { /* 忽略 */ }
        });
      }
    } catch (err) {
      setStatus("用作输入失败：" + (err && err.message ? err.message : String(err)), "error");
      return;
    }
    setStatus("已把 PNG dataURL 交给调用方", "ok");
    if (opts.closeOnUse !== false) close();
  }

  function showError(err) {
    const msg = err && err.message ? err.message : String(err);
    errorEl.textContent = "无法打开图像：" + msg;
    errorEl.hidden = false;
    hintEl.hidden = true;
    setStatus(msg, "error");
    state.ready = false;
    updateUI();
  }

  function close() {
    if (closed) return;
    closed = true;
    state.closed = true;
    if (renderRaf) { cancelAnimationFrame(renderRaf); renderRaf = 0; }
    if (adjustRaf) { cancelAnimationFrame(adjustRaf); adjustRaf = 0; }
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    window.removeEventListener("resize", onWindowResize);
    if (lifecycle) { lifecycle.release(); lifecycle = null; }
    overlay.classList.add("imgops-closing");
    setTimeout(() => overlay.remove(), 200);
  }

  function onWindowResize() {
    const img = currentImage();
    if (!img) return;
    if (view.fit) requestRender();
    else {
      ensureView(img);
      clampPan(img, viewport.clientWidth, viewport.clientHeight);
      requestRender();
    }
  }

  // ---------- Tab ----------
  function switchTab(id) {
    for (const def of tabDefs) {
      const active = def.id === id;
      const btn = tabButtons.get(def.id);
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
      btn.tabIndex = active ? 0 : -1;
    }
    transformPanel.hidden = id !== "transform";
    colorPanel.hidden = id !== "color";
    channelPanel.hidden = id !== "channel";
  }
  overlay.addEventListener("keydown", (e) => {
    const target = e.target;
    const onTab = target && target.getAttribute && target.getAttribute("role") === "tab";
    if (!onTab) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const idx = tabDefs.findIndex((t) => tabButtons.get(t.id).classList.contains("active"));
    const next = (idx + (e.key === "ArrowRight" ? 1 : -1) + tabDefs.length) % tabDefs.length;
    const def = tabDefs[next];
    switchTab(def.id);
    tabButtons.get(def.id).focus();
  });

  // ---------- Pointer / wheel ----------
  let drag = null;
  function eventPoint(e) {
    const rect = viewport.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    return {
      mx,
      my,
      ix: (mx - view.ox) / view.scale,
      iy: (my - view.oy) / view.scale,
    };
  }

  function updatePixelReadout(e) {
    const img = currentImage();
    if (!img) { pixelEl.textContent = ""; return; }
    if (!ensureView(img)) return;
    const p = eventPoint(e);
    const x = Math.floor(p.ix);
    const y = Math.floor(p.iy);
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) {
      pixelEl.textContent = "";
      return;
    }
    const i = (y * img.width + x) * 4;
    const d = img.data;
    const hex = "#" + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("");
    pixelEl.textContent = `x${x} y${y} · ${hex} · RGBA(${d[i]},${d[i + 1]},${d[i + 2]},${d[i + 3]})`;
  }

  viewport.addEventListener("pointerdown", (e) => {
    const img = currentImage();
    if (!img) return;
    if (!ensureView(img)) return;
    if (e.button === 0 && state.cropMode) {
      const p = eventPoint(e);
      if (p.ix < 0 || p.iy < 0 || p.ix > img.width || p.iy > img.height) return;
      drag = {
        mode: "crop",
        moved: false,
        pointerId: e.pointerId,
        start: { x: Math.max(0, Math.min(img.width, p.ix)), y: Math.max(0, Math.min(img.height, p.iy)) },
      };
      state.cropRect = cropRectFromPoints(drag.start, drag.start, img);
      updateCropFields();
      viewport.setPointerCapture(e.pointerId);
      viewport.classList.add("dragging");
      requestRender();
      e.preventDefault();
      return;
    }
    if (e.button !== 0 && e.button !== 1) return;
    drag = {
      mode: "pan",
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      ox: view.ox,
      oy: view.oy,
    };
    viewport.setPointerCapture(e.pointerId);
    viewport.classList.add("dragging");
    e.preventDefault();
  });

  viewport.addEventListener("pointermove", (e) => {
    const img = currentImage();
    if (!img) return;
    if (drag && drag.pointerId === e.pointerId && drag.mode === "pan") {
      view.ox = drag.ox + (e.clientX - drag.startX);
      view.oy = drag.oy + (e.clientY - drag.startY);
      view.fit = false;
      clampPan(img, viewport.clientWidth, viewport.clientHeight);
      requestRender();
      return;
    }
    if (drag && drag.pointerId === e.pointerId && drag.mode === "crop") {
      const p = eventPoint(e);
      const point = { x: Math.max(0, Math.min(img.width, p.ix)), y: Math.max(0, Math.min(img.height, p.iy)) };
      drag.moved = true;
      state.cropRect = cropRectFromPoints(drag.start, point, img);
      updateCropFields();
      requestRender();
      return;
    }
    updatePixelReadout(e);
  });

  function endPointer(e) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.mode === "crop" && (!drag.moved || !state.cropRect ||
      state.cropRect.width < 1 || state.cropRect.height < 1)) {
      state.cropRect = null;
      syncImageFields();
    }
    syncQuickCropState();
    drag = null;
    viewport.classList.remove("dragging");
    if (viewport.hasPointerCapture && viewport.hasPointerCapture(e.pointerId)) {
      viewport.releasePointerCapture(e.pointerId);
    }
    requestRender();
  }
  viewport.addEventListener("pointerup", endPointer);
  viewport.addEventListener("pointercancel", endPointer);
  viewport.addEventListener("pointerleave", () => { pixelEl.textContent = ""; });

  viewport.addEventListener("wheel", (e) => {
    const img = currentImage();
    if (!img) return;
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const factor = Math.exp(-e.deltaY * 0.0015);
    setScale((view.scale || 1) * factor, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  viewport.addEventListener("dblclick", () => {
    if (state.cropMode) return;
    if (view.fit) actualSize();
    else fitToWindow();
  });

  // ---------- 键盘 ----------
  function isEditableTarget(target) {
    return !!target && typeof target.closest === "function" &&
      !!target.closest("input,select,textarea,[contenteditable='true']");
  }

  overlay.addEventListener("keydown", onKeyDown);
  function onKeyDown(e) {
    if (isEditableTarget(e.target)) return;
    if (e.target && e.target.getAttribute && e.target.getAttribute("role") === "tab" &&
      (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
    const img = currentImage();
    if (!img) return;
    const key = e.key;
    const lower = key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && lower === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && lower === "y") {
      e.preventDefault();
      redo();
      return;
    }
    const step = e.shiftKey ? 160 : 40;
    switch (key) {
      case "ArrowLeft":
        view.ox -= step; view.fit = false;
        break;
      case "ArrowRight":
        view.ox += step; view.fit = false;
        break;
      case "ArrowUp":
        view.oy -= step; view.fit = false;
        break;
      case "ArrowDown":
        view.oy += step; view.fit = false;
        break;
      case "+":
      case "=":
        e.preventDefault();
        zoomBy(1.25);
        return;
      case "-":
      case "_":
        e.preventDefault();
        zoomBy(0.8);
        return;
      case "0":
        e.preventDefault();
        fitToWindow();
        return;
      case "1":
        e.preventDefault();
        actualSize();
        return;
      case "g":
      case "G":
        e.preventDefault();
        toggleGrid();
        return;
      case "r":
      case "R":
        e.preventDefault();
        applyOperation("旋转 90°", (im) => rotate90(im));
        return;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        if (state.cropRect) clearCrop();
        return;
      default:
        return;
    }
    e.preventDefault();
    ensureView(img);
    clampPan(img, viewport.clientWidth, viewport.clientHeight);
    requestRender();
  }

  // ---------- 控件事件 ----------
  closeBtn.addEventListener("click", close);
  zoomOutBtn.addEventListener("click", () => zoomBy(0.8));
  zoomInBtn.addEventListener("click", () => zoomBy(1.25));
  fitBtn.addEventListener("click", fitToWindow);
  actualBtn.addEventListener("click", actualSize);
  gridBtn.addEventListener("click", toggleGrid);
  undoBtn.addEventListener("click", undo);
  redoBtn.addEventListener("click", redo);
  resetBtn.addEventListener("click", resetAll);

  rotate90Btn.addEventListener("click", () => applyOperation("旋转 90°", (img) => rotate90(img)));
  rotate180Btn.addEventListener("click", () => applyOperation("旋转 180°", (img) => rotate180(img)));
  rotate270Btn.addEventListener("click", () => applyOperation("旋转 270°", (img) => rotate270(img)));
  angleBtn.addEventListener("click", () => {
    const angle = Number(angleInput.value);
    if (!Number.isFinite(angle)) {
      setStatus("旋转角度必须是数字", "error");
      return;
    }
    applyOperation(`旋转 ${angle}°`, (img) => rotateArbitrary(img, angle, { expand: expandChk.checked }));
  });
  flipHBtn.addEventListener("click", () => applyOperation("水平翻转", (img) => flipH(img)));
  flipVBtn.addEventListener("click", () => applyOperation("垂直翻转", (img) => flipV(img)));

  cropModeBtn.addEventListener("click", () => setCropMode(!state.cropMode));
  cropApplyBtn.addEventListener("click", () => {
    applyOperation("裁剪", (img) => crop(img, {
      x: Number(cropX.value),
      y: Number(cropY.value),
      width: Number(cropW.value),
      height: Number(cropH.value),
    }));
  });
  cropClearBtn.addEventListener("click", clearCrop);

  // ---- 底部快速工具栏 ----
  quickRotateBtn.addEventListener("click", () => applyOperation("旋转 90°", (img) => rotate90(img)));
  quickCropBtn.addEventListener("click", () => setCropMode(!state.cropMode));
  quickCropApplyBtn.addEventListener("click", () => cropApplyBtn.click());
  quickCropClearBtn.addEventListener("click", () => { clearCrop(); setCropMode(false); });
  quickGridBtn.addEventListener("click", toggleGrid);
  quickFilter.addEventListener("change", () => {
    const channel = quickFilter.value;
    quickFilter.value = "";
    if (!channel) return;
    const label = { gray: "灰度", r: "只看 R", g: "只看 G", b: "只看 B", a: "只看 A" }[channel] || channel;
    applyOperation(label, (img) => extractChannel(img, channel));
  });
  moreBtn.addEventListener("click", () => {
    const open = sheet.hidden;
    sheet.hidden = !open;
    moreBtn.classList.toggle("active", open);
    moreBtn.setAttribute("aria-expanded", String(open));
    setStatus(open ? "已展开更多编辑功能" : "已收起更多编辑功能");
    if (open) requestAnimationFrame(() => { try { sheet.scrollIntoView({ block: "nearest" }); } catch { /* ignore */ } });
  });

  resizeW.addEventListener("input", () => {
    if (!resizeLock.checked || !state.history) return;
    const w = Number(resizeW.value);
    if (!Number.isFinite(w) || w < 1) return;
    const img = state.history.current;
    resizeH.value = String(Math.max(1, Math.min(16384, Math.round(w * img.height / img.width))));
  });
  resizeH.addEventListener("input", () => {
    if (!resizeLock.checked || !state.history) return;
    const h = Number(resizeH.value);
    if (!Number.isFinite(h) || h < 1) return;
    const img = state.history.current;
    resizeW.value = String(Math.max(1, Math.min(16384, Math.round(h * img.width / img.height))));
  });
  resizeApplyBtn.addEventListener("click", () => {
    applyOperation("缩放", (img) => resize(img, Number(resizeW.value), Number(resizeH.value), resizeMethod.value));
  });

  for (const item of [brightnessRange, contrastRange, saturationRange]) {
    item.input.addEventListener("input", scheduleAdjustPreview);
  }
  adjustApplyBtn.addEventListener("click", applyAdjust);
  adjustCancelBtn.addEventListener("click", cancelAdjustPreview);
  invertBtn.addEventListener("click", () => applyOperation("反色", (img) => invert(img)));

  splitRBtn.addEventListener("click", () => applyOperation("通道分离 R", (img) => extractChannel(img, "r")));
  splitGBtn.addEventListener("click", () => applyOperation("通道分离 G", (img) => extractChannel(img, "g")));
  splitBBtn.addEventListener("click", () => applyOperation("通道分离 B", (img) => extractChannel(img, "b")));
  splitABtn.addEventListener("click", () => applyOperation("通道分离 A", (img) => extractChannel(img, "a")));
  mergeApplyBtn.addEventListener("click", () => {
    const mapping = { r: mergeR.value, g: mergeG.value, b: mergeB.value };
    if (mergeA.value !== "keep") mapping.a = mergeA.value;
    applyOperation("通道合并", (img) => mapChannels(img, mapping));
  });
  mergeResetBtn.addEventListener("click", () => {
    mergeR.value = "r"; mergeG.value = "g"; mergeB.value = "b"; mergeA.value = "keep";
    applyOperation("恢复 RGB", (img) => mapChannels(img, { r: "r", g: "g", b: "b" }));
  });
  bitApplyBtn.addEventListener("click", () => {
    applyOperation(`位平面 ${bitChannel.value.toUpperCase()} bit${bitSelect.value}`, (img) => bitPlane(img, {
      channel: bitChannel.value,
      bit: Number(bitSelect.value),
    }));
  });

  exportBtn.addEventListener("click", exportPng);
  if (useBtn) useBtn.addEventListener("click", useAsInput);

  // ---------- 加载 ----------
  const ready = (async () => {
    try {
      const img = await decodeImageSource(source, opts.bytes);
      if (state.closed) return null;
      state.original = {
        width: img.width,
        height: img.height,
        data: new Uint8ClampedArray(img.data),
      };
      state.history = createHistory(state.original, { label: "打开" });
      state.ready = true;
      errorEl.hidden = true;
      hintEl.hidden = false;
      syncImageFields();
      updateUI();
      requestAnimationFrame(() => {
        if (state.closed) return;
        fitToWindow();
        viewport.focus({ preventScroll: true });
        setStatus(`已加载 ${img.width}×${img.height} px · 滚轮缩放，拖拽平移`, "ok");
      });
      return img;
    } catch (err) {
      if (!state.closed) showError(err);
      return null;
    }
  })();

  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(() => {
      const img = currentImage();
      if (!img) return;
      if (view.fit) requestRender();
      else {
        clampPan(img, viewport.clientWidth, viewport.clientHeight);
        requestRender();
      }
    });
    resizeObserver.observe(viewport);
  }
  window.addEventListener("resize", onWindowResize);

  lifecycle = attachModalLifecycle(overlay, {
    dialog,
    onClose: close,
    initialFocus: viewport,
    restoreFocusTo: previousFocus,
    closeOnBackdrop: "none",
  });

  updateUI();
  close.ready = ready;
  close.element = overlay;
  close.getImage = () => {
    const img = currentImage();
    return img ? { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) } : null;
  };
  return close;
}
