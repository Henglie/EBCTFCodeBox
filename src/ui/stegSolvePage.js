/*
 * stegSolvePage.js — StegSolve 1.4 独立 op 页面。
 *
 * 对齐 jar 的操作模型：
 * - 主视图 42 个变换（原图/反色/各通道 8 位/完整通道/随机颜色/灰度位），左右切换。
 * - Analyse：Data Extract / Stereogram Solver / Frame Browser / Image Combiner / File Format。
 * - 10%–1000% 缩放、拖入图片、保存当前视图。
 *
 * 本模块只做 DOM 与事件；像素运算全部在 core/stegSolve.js。
 */
import { icon as iconSvg } from "./icons.js";
import { downloadBytes } from "./download.js";
import {
  STEGSOLVE_TRANSFORMS,
  applyStegSolveTransform,
  extractStegSolveData,
  formatExtractPreview,
  combineStegSolveImages,
  stereogramXor,
  detectImageFormat,
  mimeForFormat,
  decodeImageFrames,
  imageToPNG,
} from "../core/stegSolve.js";

const STYLE_ID = "stegsolve-page-styles";
let _active = null;
let _pending = null;
let _pageSeq = 0;

export function ensureStegSolvePageStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./stegSolvePage.css", import.meta.url).href;
  document.head.append(link);
}

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
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

function btn(label, icon, attrs = {}) {
  return el("button", { type: "button", class: "act-btn", ...attrs }, msym(icon), el("span", {}, label));
}

function byteInput(source) {
  if (source instanceof Uint8Array) return source;
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (Array.isArray(source)) return Uint8Array.from(source);
  return null;
}

function drawToFrame(drawable, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 canvas 2D");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(drawable, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return { width: canvas.width, height: canvas.height, data, delay: 0, dispose: 0, blend: 0 };
}

async function decodeWithImageDecoder(bytes, format) {
  if (typeof ImageDecoder === "undefined" || typeof document === "undefined") return null;
  const mime = format === "apng" ? "image/png" : mimeForFormat(format);
  if (!mime.startsWith("image/")) return null;
  let dec = null;
  try {
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    dec = new ImageDecoder({ data: buf, type: mime });
    await dec.tracks.ready;
    const track = dec.tracks.selectedTrack;
    const count = Math.min(track && track.frameCount ? track.frameCount : 1, 600);
    const frames = [];
    for (let i = 0; i < count; i++) {
      const res = await dec.decode({ frameIndex: i });
      const image = res.image;
      frames.push(drawToFrame(image, image.displayWidth || image.codedWidth, image.displayHeight || image.codedHeight));
      if (image.close) image.close();
    }
    return frames.length ? frames : null;
  } catch {
    return null;
  } finally {
    if (dec && dec.close) { try { dec.close(); } catch { /* ignore */ } }
  }
}

async function decodeWithCanvas(bytes, format) {
  const mime = mimeForFormat(format);
  if (typeof createImageBitmap === "function" && typeof Blob !== "undefined") {
    let bmp = null;
    try {
      bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
      return drawToFrame(bmp, bmp.width, bmp.height);
    } catch { /* fall through */ } finally {
      if (bmp && bmp.close) bmp.close();
    }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("浏览器无法解码该图像"));
      img.src = url;
    });
    return drawToFrame(img, img.naturalWidth || img.width, img.naturalHeight || img.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeFramesWithFallback(bytes) {
  const format = detectImageFormat(bytes);
  try {
    return Object.assign({ note: "" }, decodeImageFrames(bytes));
  } catch (err) {
    if (!(err.code === "BROWSER_DECODE_REQUIRED" || err.format || /不支持|无法|不完整|非法/.test(err.message) || ["png", "apng", "gif"].includes(format))) throw err;
    const multi = await decodeWithImageDecoder(bytes, format);
    if (multi && multi.length) return { format, width: multi[0].width, height: multi[0].height, total: multi.length, loop: null, frames: multi, note: "canvas/ImageDecoder 解码" };
    const frame = await decodeWithCanvas(bytes, format);
    return { format, width: frame.width, height: frame.height, total: 1, loop: null, frames: [frame], note: "canvas 单帧解码" };
  }
}

function paint(canvas, image) {
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 canvas 2D");
  const data = image.data instanceof Uint8ClampedArray ? image.data : new Uint8ClampedArray(image.data);
  ctx.putImageData(new ImageData(data, image.width, image.height), 0, 0);
}

function downloadPNG(image, name) {
  downloadBytes(imageToPNG(image), name, "image/png");
}

function safeName(name) {
  return String(name || "stegsolve").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "stegsolve";
}

export function setPendingStegSolve(bytes, name) {
  const u8 = byteInput(bytes);
  _pending = u8 ? { bytes: u8, name: String(name || "image") } : null;
}

export function takePendingStegSolve() {
  const p = _pending;
  _pending = null;
  return p;
}

export function disposeStegSolvePage() {
  _pageSeq++;   // 作废尚未执行的 pending 载入
  if (_active && typeof _active.dispose === "function") {
    try { _active.dispose(); } catch { /* ignore */ }
  }
  _active = null;
}

/**
 * 渲染 StegSolve op 页面（挂到 main.js 的 $ws 上）。
 * @param {HTMLElement} host
 * @param {object} op
 */
export function renderStegSolvePage(host, op) {
  disposeStegSolvePage();
  const seq = ++_pageSeq;
  ensureStegSolvePageStyles();

  const state = {
    bytes: null,
    name: "",
    format: "",
    frames: [],
    frameIndex: 0,
    sourceImage: null,
    transformIndex: 0,
    zoom: 100,
    tab: "transform",
    combineImage: null,
    combineMode: 0,
    stereoOffset: 0,
    extract: {
      bits: { a: new Set(), r: new Set(), g: new Set(), b: new Set() },
      order: "msb",
      scan: "row",
      planeOrder: "RGB",
      includeHex: true,
    },
    fileReport: "",
    fileReportDone: false,
    disposed: false,
  };

  const page = el("div", { class: "sspage" });
  const fileInput = el("input", { type: "file", accept: "image/*", class: "sspage-file", "aria-label": "打开图像" });
  const openBtn = btn("打开图像", "image");
  const saveBtn = btn("保存当前视图", "download");
  const nameEl = el("span", { class: "sspage-name", text: "尚未载入图像" });
  const metaEl = el("span", { class: "sspage-meta", text: "" });
  const statusEl = el("div", { class: "sspage-status", role: "status", "aria-live": "polite", text: "打开或拖入 PNG / JPEG / GIF / BMP / WebP 图像" });
  const toolbar = el("div", { class: "sspage-toolbar" }, openBtn, saveBtn, nameEl, metaEl);
  const drop = el("div", { class: "sspage-drop" },
    msym("cloud_upload", "sspage-drop-icon"),
    el("div", { class: "sspage-drop-title", text: "拖入图片，或点「打开图像」" }),
    el("div", { class: "sspage-drop-sub", text: "支持 PNG / APNG / GIF / JPEG / BMP / WebP；全部本地计算" }),
  );

  // ---- 主视图（42 变换） ----
  const transformCanvas = el("canvas", { class: "sspage-canvas", role: "img", "aria-label": "变换预览" });
  const transformViewport = el("div", { class: "sspage-viewport" }, transformCanvas);
  const prevBtn = el("button", { type: "button", class: "sspage-nav", title: "上一个变换（←）", "aria-label": "上一个变换" }, msym("chevron_left"));
  const nextBtn = el("button", { type: "button", class: "sspage-nav", title: "下一个变换（→）", "aria-label": "下一个变换" }, msym("chevron_right"));
  const transformLabel = el("span", { class: "sspage-transform-label", text: "原图" });
  const transformIndexEl = el("span", { class: "sspage-transform-index", text: "1 / 42" });
  const zoomRange = el("input", { type: "range", min: "10", max: "1000", step: "10", value: "100", class: "sspage-range", "aria-label": "缩放百分比" });
  const zoomOut = el("button", { type: "button", class: "sspage-round", title: "缩小", "aria-label": "缩小" }, msym("remove"));
  const zoomIn = el("button", { type: "button", class: "sspage-round", title: "放大", "aria-label": "放大" }, msym("add"));
  const zoomText = el("output", { class: "sspage-zoom", text: "100%" });
  const transformBar = el("div", { class: "sspage-viewbar" },
    prevBtn, transformLabel, transformIndexEl, nextBtn,
    el("span", { class: "sspage-grow" }),
    zoomOut, zoomRange, zoomIn, zoomText,
  );
  const transformPanel = el("section", { class: "sspage-panel", "data-panel": "transform", hidden: "" },
    transformBar,
    transformViewport,
    el("p", { class: "sspage-tip" }, "←/→ 切换变换；按住 Shift + 滚轮可横向滚动；保存按钮导出当前视图 PNG。"),
  );

  // ---- Data Extract ----
  const bitHost = el("div", { class: "sspage-bits" });
  const bitChipMap = { a: [], r: [], g: [], b: [] };
  for (const [key, label] of [["a", "Alpha"], ["r", "Red"], ["g", "Green"], ["b", "Blue"]]) {
    const row = el("div", { class: "sspage-bit-row" },
      el("span", { class: "sspage-bit-name", text: label }));
    const all = el("button", { type: "button", class: "sspage-mini" }, msym("select_all"), el("span", {}, "全选"));
    const none = el("button", { type: "button", class: "sspage-mini" }, msym("delete_sweep"), el("span", {}, "清空"));
    const bitsHost = el("div", { class: "sspage-bit-chips" });
    for (let bit = 7; bit >= 0; bit--) {
      const chip = el("button", { type: "button", class: "sspage-bit", "data-bit": String(bit), "aria-pressed": "false", text: String(bit) });
      chip.addEventListener("click", () => {
        const set = state.extract.bits[key];
        if (set.has(bit)) set.delete(bit); else set.add(bit);
        chip.classList.toggle("on", set.has(bit));
        chip.setAttribute("aria-pressed", String(set.has(bit)));
        syncExtractCount();
      });
      bitsHost.append(chip);
      bitChipMap[key].push({ bit, chip });
    }
    all.addEventListener("click", () => {
      for (let b = 0; b < 8; b++) state.extract.bits[key].add(b);
      syncExtractChecks(); syncExtractCount();
    });
    none.addEventListener("click", () => {
      state.extract.bits[key].clear();
      syncExtractChecks(); syncExtractCount();
    });
    row.append(all, none, bitsHost);
    bitHost.append(row);
  }
  const extractOrder = el("select", { class: "sspage-select", "aria-label": "位序" },
    el("option", { value: "msb" }, "MSB First"), el("option", { value: "lsb" }, "LSB First"));
  const extractScan = el("select", { class: "sspage-select", "aria-label": "提取方向" },
    el("option", { value: "row" }, "按行 Row"), el("option", { value: "column" }, "按列 Column"));
  const extractPlane = el("select", { class: "sspage-select", "aria-label": "位平面顺序" },
    ...["RGB", "RBG", "GRB", "GBR", "BRG", "BGR"].map((v) => el("option", { value: v }, v)));
  const extractHex = el("input", { type: "checkbox", class: "sspage-check" });
  extractHex.checked = true;
  const quickLsb = el("button", { type: "button", class: "sspage-mini" }, msym("bolt"), el("span", {}, "LSB B0"));
  const previewBtn = btn("预览", "visibility");
  const saveTextBtn = btn("保存文本", "save");
  const saveBinBtn = btn("保存 Bin", "download");
  const extractOut = el("pre", { class: "sspage-extract-out", text: "选择位平面后点「预览」。" });
  const extractCount = el("span", { class: "sspage-count", text: "已选 0 位" });
  const extractPanel = el("section", { class: "sspage-panel", "data-panel": "extract", hidden: "" },
    el("div", { class: "sspage-sec-title" }, msym("tune"), "Data Extract"),
    bitHost,
    el("div", { class: "sspage-form" },
      el("label", { class: "sspage-field" }, el("span", {}, "位序"), extractOrder),
      el("label", { class: "sspage-field" }, el("span", {}, "方向"), extractScan),
      el("label", { class: "sspage-field" }, el("span", {}, "位平面顺序"), extractPlane),
      el("label", { class: "sspage-inline" }, extractHex, el("span", {}, "预览包含 Hex Dump")),
      quickLsb, extractCount,
    ),
    el("div", { class: "sspage-actions" }, previewBtn, saveTextBtn, saveBinBtn),
    extractOut,
  );
  const syncExtractChecks = () => {
    for (const [key, set] of Object.entries(state.extract.bits)) {
      for (const { bit, chip } of bitChipMap[key]) {
        chip.classList.toggle("on", set.has(bit));
        chip.setAttribute("aria-pressed", String(set.has(bit)));
      }
    }
  };
  const syncExtractCount = () => {
    const n = Object.values(state.extract.bits).reduce((a, s) => a + s.size, 0);
    extractCount.textContent = "已选 " + n + " 位";
  };
  quickLsb.addEventListener("click", () => {
    state.extract.bits.b.clear();
    state.extract.bits.b.add(0);
    syncExtractChecks(); syncExtractCount();
  });
  let lastExtract = null;
  function runExtract() {
    if (!state.sourceImage) { status("请先打开图像", "warn"); return null; }
    try {
      const bits = {};
      for (const k of ["a", "r", "g", "b"]) bits[k] = [...state.extract.bits[k]];
      const res = extractStegSolveData(state.sourceImage, {
        bits,
        order: extractOrder.value,
        scan: extractScan.value,
        planeOrder: extractPlane.value,
        includeHex: extractHex.checked,
      });
      lastExtract = res;
      const preview = res.selectedBits ? res.preview : "未选择任何位平面。";
      extractOut.textContent = res.selectedBits
        ? `提取 ${res.bytes.length} 字节（${res.selectedBits} bit/px）${res.previewTruncated ? "\n预览仅显示前 64 KB，保存仍为完整内容。" : ""}\n\n${preview}`
        : preview;
      status(`Data Extract：${res.bytes.length} 字节 · ${res.selectedBits} bit/px`, "ok");
      return res;
    } catch (e) {
      status(String(e.message || e), "error");
      return null;
    }
  }
  previewBtn.addEventListener("click", runExtract);
  saveBinBtn.addEventListener("click", () => {
    const res = runExtract();
    if (res) downloadBytes(res.bytes, safeName(state.name) + "_extract.bin", "application/octet-stream");
  });
  saveTextBtn.addEventListener("click", () => {
    const res = runExtract();
    if (!res) return;
    const text = formatExtractPreview(res.bytes, extractHex.checked);
    downloadBytes(new TextEncoder().encode(text), safeName(state.name) + "_extract.txt", "text/plain");
  });

  // ---- Frame Browser ----
  const frameCanvas = el("canvas", { class: "sspage-canvas", role: "img", "aria-label": "帧预览" });
  const frameViewport = el("div", { class: "sspage-viewport" }, frameCanvas);
  const frameLabel = el("span", { class: "sspage-transform-label", text: "- / -" });
  const framePrev = el("button", { type: "button", class: "sspage-nav", title: "上一帧", "aria-label": "上一帧" }, msym("chevron_left"));
  const frameNext = el("button", { type: "button", class: "sspage-nav", title: "下一帧", "aria-label": "下一帧" }, msym("chevron_right"));
  const frameSave = btn("保存当前帧", "download");
  const framePanel = el("section", { class: "sspage-panel", "data-panel": "frame", hidden: "" },
    el("div", { class: "sspage-viewbar" }, framePrev, frameLabel, frameNext, el("span", { class: "sspage-grow" }), frameSave),
    frameViewport,
    el("p", { class: "sspage-tip" }, "帧浏览使用原始图像；←/→ 切换帧。"),
  );
  function renderFrame() {
    const n = state.frames.length;
    if (!n) { frameLabel.textContent = "- / -"; return; }
    state.frameIndex = ((state.frameIndex % n) + n) % n;
    const frame = state.frames[state.frameIndex];
    paint(frameCanvas, frame);
    frameLabel.textContent = `${state.frameIndex + 1} / ${n} · ${frame.width}×${frame.height}`;
  }
  framePrev.addEventListener("click", () => { state.frameIndex--; renderFrame(); });
  frameNext.addEventListener("click", () => { state.frameIndex++; renderFrame(); });
  frameSave.addEventListener("click", () => {
    const frame = state.frames[state.frameIndex];
    if (!frame) return;
    downloadPNG(frame, safeName(state.name) + `_frame${state.frameIndex + 1}.png`);
  });

  // ---- Image Combiner ----
  const combineFile = el("input", { type: "file", accept: "image/*", class: "sspage-file", "aria-label": "选择第二张图像" });
  const combineChoose = btn("选择第二张图", "add");
  const combineMode = el("select", { class: "sspage-select", "aria-label": "合并方式" },
    ...["XOR", "OR", "AND", "ADD", "ADD (R,G,B separate)", "SUB", "SUB (R,G,B separate)", "MUL", "MUL (R,G,B separate)", "Lightest (R, G, B separate)", "Darkest (R, G, B separate)", "Horizontal Interlace", "Vertical Interlace"]
      .map((label, i) => el("option", { value: String(i) }, label)));
  const combineCanvas = el("canvas", { class: "sspage-canvas", role: "img", "aria-label": "合并结果" });
  const combineViewport = el("div", { class: "sspage-viewport" }, combineCanvas);
  const combineSave = btn("保存合并结果", "download");
  combineSave.disabled = true;
  const combineInfo = el("span", { class: "sspage-transform-label", text: "选择第二张同源图" });
  const combinePanel = el("section", { class: "sspage-panel", "data-panel": "combine", hidden: "" },
    el("div", { class: "sspage-viewbar" }, combineChoose, combineFile, combineMode, combineInfo, el("span", { class: "sspage-grow" }), combineSave),
    combineViewport,
    el("p", { class: "sspage-tip" }, "与 StegSolve 一致：尺寸不同按最大宽高补齐 0；Interlace 输出会扩展画布。"),
  );
  let combineResult = null;
  function renderCombine() {
    if (!state.sourceImage || !state.combineImage) { combineSave.disabled = true; return; }
    try {
      combineResult = combineStegSolveImages(state.sourceImage, state.combineImage, Number(combineMode.value));
      paint(combineCanvas, combineResult);
      combineInfo.textContent = `${combineResult.width}×${combineResult.height} · ${combineMode.options[combineMode.selectedIndex].text}`;
      combineSave.disabled = false;
      status("合并完成", "ok");
    } catch (e) {
      combineResult = null;
      combineSave.disabled = true;
      status(String(e.message || e), "error");
    }
  }
  combineChoose.addEventListener("click", () => combineFile.click());
  combineFile.addEventListener("change", () => {
    const f = combineFile.files && combineFile.files[0];
    combineFile.value = "";
    if (f) loadCombineFile(f);
  });
  combineMode.addEventListener("change", renderCombine);
  combineSave.addEventListener("click", () => {
    if (combineResult) downloadPNG(combineResult, safeName(state.name) + `_combine${combineMode.value}.png`);
  });
  async function loadCombineFile(file) {
    try {
      status(`正在读取 ${file.name || "第二张图"}…`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const decoded = await decodeFramesWithFallback(bytes);
      if (!decoded.frames.length) throw new Error("第二张图没有可解码帧");
      state.combineImage = decoded.frames[0];
      renderCombine();
    } catch (e) {
      state.combineImage = null;
      combineResult = null;
      combineSave.disabled = true;
      status(String(e.message || e), "error");
    }
  }

  // ---- Stereogram Solver ----
  const stereoCanvas = el("canvas", { class: "sspage-canvas", role: "img", "aria-label": "立体图预览" });
  const stereoViewport = el("div", { class: "sspage-viewport" }, stereoCanvas);
  const stereoPrev = el("button", { type: "button", class: "sspage-nav", title: "偏移 -1", "aria-label": "偏移减一" }, msym("chevron_left"));
  const stereoNext = el("button", { type: "button", class: "sspage-nav", title: "偏移 +1", "aria-label": "偏移加一" }, msym("chevron_right"));
  const stereoRange = el("input", { type: "range", min: "0", max: "0", value: "0", class: "sspage-range", "aria-label": "偏移量" });
  const stereoLabel = el("span", { class: "sspage-transform-label", text: "Offset: 0" });
  const stereoSave = btn("保存立体图", "download");
  const stereoPanel = el("section", { class: "sspage-panel", "data-panel": "stereo", hidden: "" },
    el("div", { class: "sspage-viewbar" }, stereoPrev, stereoLabel, stereoNext, stereoRange, el("span", { class: "sspage-grow" }), stereoSave),
    stereoViewport,
    el("p", { class: "sspage-tip" }, "Stereogram Solver：out = 原图 XOR 原图横向偏移（与 StegSolve 1.4 同式）。"),
  );
  let stereoResult = null;
  function renderStereo() {
    if (!state.sourceImage) return;
    const max = Math.max(0, state.sourceImage.width - 1);
    state.stereoOffset = Math.max(0, Math.min(max, Number(state.stereoOffset) || 0));
    stereoRange.max = String(max);
    stereoRange.value = String(state.stereoOffset);
    stereoLabel.textContent = "Offset: " + state.stereoOffset;
    stereoResult = stereogramXor(state.sourceImage, state.stereoOffset);
    paint(stereoCanvas, stereoResult);
  }
  function stepStereo(delta) {
    if (!state.sourceImage) return;
    const w = Math.max(1, state.sourceImage.width);
    state.stereoOffset = ((state.stereoOffset + delta) % w + w) % w;
    renderStereo();
  }
  stereoPrev.addEventListener("click", () => stepStereo(-1));
  stereoNext.addEventListener("click", () => stepStereo(1));
  stereoRange.addEventListener("input", () => { state.stereoOffset = Number(stereoRange.value) || 0; renderStereo(); });
  stereoSave.addEventListener("click", () => {
    if (stereoResult) downloadPNG(stereoResult, safeName(state.name) + `_stereo_${state.stereoOffset}.png`);
  });

  // ---- File Format ----
  const formatOut = el("pre", { class: "sspage-extract-out", text: "点「生成报告」分析文件结构。" });
  const formatBtn = btn("生成报告", "description");
  const formatCopy = btn("复制报告", "content_copy");
  const formatPanel = el("section", { class: "sspage-panel", "data-panel": "format", hidden: "" },
    el("div", { class: "sspage-viewbar" }, formatBtn, formatCopy, el("span", { class: "sspage-grow" }), el("span", { class: "sspage-transform-label", text: "PNG / GIF / JPEG / BMP 结构与尾部数据" })),
    formatOut,
  );
  async function runFileReport() {
    if (!state.bytes) { status("请先打开图像", "warn"); return; }
    formatBtn.disabled = true;
    formatOut.textContent = "正在分析文件结构…";
    try {
      const fa = await import("../core/fileAnalysis.js");
      const r = await fa.analyzeFile(state.bytes, state.name || "image");
      const lines = [];
      lines.push(`File: ${state.name}`);
      lines.push(`Size: ${state.bytes.length} bytes · Detected: ${r.detected || r.ext || "unknown"}`);
      for (const sec of (r.sections || [])) {
        lines.push("");
        lines.push(`== ${sec.title || sec.id} ==`);
        if (sec.body) lines.push(String(sec.body));
      }
      formatOut.textContent = lines.join("\n");
      state.fileReport = formatOut.textContent;
      state.fileReportDone = true;
      status("文件格式报告已生成", "ok");
    } catch (e) {
      formatOut.textContent = "报告生成失败：" + (e && e.message ? e.message : e);
      status("报告生成失败", "error");
    } finally {
      formatBtn.disabled = false;
    }
  }
  formatBtn.addEventListener("click", runFileReport);
  formatCopy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(state.fileReport || formatOut.textContent || ""); status("报告已复制", "ok"); }
    catch { status("复制失败：浏览器拒绝剪贴板", "error"); }
  });

  // ---- Tabs ----
  const tabDefs = [
    { id: "transform", label: "图像变换", icon: "sync" },
    { id: "extract", label: "数据提取", icon: "grid_view" },
    { id: "frame", label: "帧浏览", icon: "image" },
    { id: "combine", label: "图像合并", icon: "add" },
    { id: "stereo", label: "立体图", icon: "visibility" },
    { id: "format", label: "文件格式", icon: "description" },
  ];
  const tabBar = el("div", { class: "sspage-tabs", role: "tablist", "aria-label": "StegSolve 功能" });
  const panels = { transform: transformPanel, extract: extractPanel, frame: framePanel, combine: combinePanel, stereo: stereoPanel, format: formatPanel };
  const tabButtons = new Map();
  for (const def of tabDefs) {
    const b = el("button", { type: "button", class: "sspage-tab", role: "tab", "aria-selected": def.id === state.tab ? "true" : "false" }, msym(def.icon), el("span", {}, def.label));
    b.addEventListener("click", () => switchTab(def.id));
    tabButtons.set(def.id, b);
    tabBar.append(b);
  }
  function switchTab(id) {
    state.tab = id;
    for (const [tid, b] of tabButtons) {
      b.classList.toggle("active", tid === id);
      b.setAttribute("aria-selected", String(tid === id));
    }
    for (const [pid, panel] of Object.entries(panels)) panel.hidden = pid !== id;
    if (!state.sourceImage) return;
    if (id === "frame") renderFrame();
    if (id === "combine") renderCombine();
    if (id === "stereo") renderStereo();
    if (id === "format" && !state.fileReportDone) runFileReport();
    if (id === "extract") syncExtractCount();
  }

  function status(text, level) {
    statusEl.textContent = String(text);
    statusEl.dataset.level = level || "info";
  }

  // ---- Load image ----
  function applyLoaded(decoded, name, bytes) {
    state.bytes = bytes;
    state.name = name;
    state.format = decoded.format;
    state.frames = decoded.frames;
    state.frameIndex = 0;
    state.sourceImage = decoded.frames[0];
    state.transformIndex = 0;
    state.zoom = 100;
    zoomRange.value = "100";
    state.tab = "transform";
    state.stereoOffset = 0;
    state.fileReport = "";
    state.fileReportDone = false;
    nameEl.textContent = name;
    metaEl.textContent = `${decoded.format.toUpperCase()} · ${state.sourceImage.width}×${state.sourceImage.height} · ${decoded.frames.length} 帧${decoded.note ? " · " + decoded.note : ""}`;
    drop.hidden = true;
    transformPanel.hidden = false;
    saveBtn.disabled = false;
    renderTransform();
    renderFrame();
    renderCombine();
    renderStereo();
    switchTab(state.tab);
    status("图像已载入", "ok");
  }

  async function loadFile(file) {
    if (!file) return;
    try {
      status(`正在读取 ${file.name || "图像"}…`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const decoded = await decodeFramesWithFallback(bytes);
      if (!decoded.frames || !decoded.frames.length) throw new Error("没有可解码帧");
      applyLoaded(decoded, file.name || "image", bytes);
    } catch (e) {
      status("打开失败：" + (e && e.message ? e.message : e), "error");
    }
  }

  async function loadBytes(bytes, name) {
    try {
      status(`正在解析 ${name || "图像"}…`);
      const decoded = await decodeFramesWithFallback(bytes);
      if (!decoded.frames || !decoded.frames.length) throw new Error("没有可解码帧");
      applyLoaded(decoded, name || "image", bytes);
    } catch (e) {
      status("打开失败：" + (e && e.message ? e.message : e), "error");
    }
  }

  let _lastTransform = null;
  function applyZoomStyle() {
    if (!_lastTransform) return;
    const pct = state.zoom / 100;
    transformCanvas.style.width = Math.max(1, Math.round(_lastTransform.width * pct)) + "px";
    transformCanvas.style.height = Math.max(1, Math.round(_lastTransform.height * pct)) + "px";
    zoomText.textContent = state.zoom + "%";
  }
  function renderTransform() {
    if (!state.sourceImage) return;
    try {
      const img = applyStegSolveTransform(state.sourceImage, state.transformIndex);
      _lastTransform = img;
      paint(transformCanvas, img);
      applyZoomStyle();
      const def = STEGSOLVE_TRANSFORMS[state.transformIndex] || STEGSOLVE_TRANSFORMS[0];
      transformLabel.textContent = def.label;
      transformIndexEl.textContent = `${state.transformIndex + 1} / ${STEGSOLVE_TRANSFORMS.length}`;
    } catch (e) {
      status("变换失败：" + (e && e.message ? e.message : e), "error");
    }
  }

  prevBtn.addEventListener("click", () => { state.transformIndex = (state.transformIndex - 1 + STEGSOLVE_TRANSFORMS.length) % STEGSOLVE_TRANSFORMS.length; renderTransform(); });
  nextBtn.addEventListener("click", () => { state.transformIndex = (state.transformIndex + 1) % STEGSOLVE_TRANSFORMS.length; renderTransform(); });
  zoomRange.addEventListener("input", () => { state.zoom = Math.max(10, Math.min(1000, Number(zoomRange.value) || 100)); applyZoomStyle(); });
  zoomOut.addEventListener("click", () => { state.zoom = Math.max(10, (Number(zoomRange.value) || 100) - 20); zoomRange.value = String(state.zoom); applyZoomStyle(); });
  zoomIn.addEventListener("click", () => { state.zoom = Math.min(1000, (Number(zoomRange.value) || 100) + 20); zoomRange.value = String(state.zoom); applyZoomStyle(); });

  saveBtn.addEventListener("click", () => {
    if (_lastTransform) downloadPNG(_lastTransform, safeName(state.name) + `_${state.transformIndex}.png`);
  });
  openBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const f = fileInput.files && fileInput.files[0];
    if (f) loadFile(f).finally(() => { fileInput.value = ""; });
  });

  function onKey(e) {
    if (!page.isConnected) return;
    const t = e.target;
    if (t && t.closest && t.closest("input, select, textarea, [contenteditable='true']")) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); prevBtn.click(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); nextBtn.click(); }
  }
  window.addEventListener("keydown", onKey);

  // Drag & drop anywhere on the page.
  page.addEventListener("dragover", (e) => { e.preventDefault(); page.classList.add("dragover"); });
  page.addEventListener("dragleave", () => page.classList.remove("dragover"));
  page.addEventListener("drop", (e) => {
    e.preventDefault();
    page.classList.remove("dragover");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) loadFile(f);
  });

  page.append(toolbar, fileInput, drop, tabBar, ...tabDefs.map((d) => panels[d.id]), statusEl);
  host.append(page);

  const pending = takePendingStegSolve();
  if (pending) {
    setTimeout(() => {
      if (seq !== _pageSeq || !page.isConnected) {
        // 页面在载入前被切走：把图片还给下一次打开，避免图丢了。
        if (!_pending) _pending = pending;
        return;
      }
      loadBytes(pending.bytes, pending.name);
    }, 0);
  }

  const api = {
    dispose() {
      state.disposed = true;
      window.removeEventListener("keydown", onKey);
      try { page.remove(); } catch { /* ignore */ }
    },
    element: page,
  };
  _active = api;
  return api;
}

