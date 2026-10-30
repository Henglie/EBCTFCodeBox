import { attachModalLifecycle } from "./modalLifecycle.js";
import { ensureExpStyles } from "./expandableInput.js";
import { icon as iconSvg } from "./icons.js";
import { downloadBytes } from "./download.js";
import {
  CHANNELS,
  COMBINE_MODES,
  detectImageFormat,
  mimeForFormat,
  decodeImageFrames,
  renderBitPlane,
  renderChannel,
  combineImages,
  imageToPNG,
  stegSolveAnalyze,
  dataURLToBytes,
} from "../core/stegSolve.js";

const STYLE_ID = "stegsolve-styles";

function ensureStegSolveStyles() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./stegSolveView.css", import.meta.url).href;
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

function byteInput(source) {
  if (source instanceof Uint8Array) return source;
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (Array.isArray(source)) return Uint8Array.from(source);
  return null;
}

async function sourceToBytes(source, explicit) {
  const direct = byteInput(explicit) || byteInput(source);
  if (direct) return direct;
  if (typeof Blob !== "undefined" && source instanceof Blob) return new Uint8Array(await source.arrayBuffer());
  if (typeof source === "string") {
    const s = source.trim();
    if (/^data:/i.test(s)) return dataURLToBytes(s);
    if (/^(blob:|https?:|file:)/i.test(s)) {
      const res = await fetch(s);
      if (!res.ok) throw new Error(`读取图像失败：HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    }
    if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.length % 4 !== 1) return dataURLToBytes(s);
  }
  throw new Error("无法识别的图像来源（支持 dataURL / Blob URL / 字节）");
}

function drawToFrame(drawable, width, height, delay = 0) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 canvas 2D");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(drawable, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data: img.data, delay, dispose: 0, blend: 0 };
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
      const w = image.displayWidth || image.codedWidth;
      const h = image.displayHeight || image.codedHeight;
      frames.push(drawToFrame(image, w, h, Math.round((image.duration || 0) / 1000)));
      if (image.close) image.close();
    }
    return frames.length ? frames : null;
  } catch {
    return null;
  } finally {
    if (dec && dec.close) { try { dec.close(); } catch { } }
  }
}

async function decodeWithCanvas(bytes, format) {
  if (typeof document === "undefined") throw new Error("浏览器 canvas 不可用");
  const mime = mimeForFormat(format);
  if (typeof createImageBitmap === "function" && typeof Blob !== "undefined") {
    let bmp = null;
    try {
      bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
      return drawToFrame(bmp, bmp.width, bmp.height, 0);
    } catch {
    } finally {
      if (bmp && bmp.close) bmp.close();
    }
  }
  if (typeof Image === "undefined" || typeof URL === "undefined") throw new Error("浏览器图像解码不可用");
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error("浏览器无法解码该图像"));
      img.src = url;
    });
    return drawToFrame(img, img.naturalWidth || img.width, img.naturalHeight || img.height, 0);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeFramesWithFallback(bytes) {
  const format = detectImageFormat(bytes);
  try {
    return Object.assign({ note: "" }, decodeImageFrames(bytes));
  } catch (err) {
    if (!(err.code === "BROWSER_DECODE_REQUIRED" || err.format || /隔行|不完整|非法|不支持/.test(err.message) || ["png", "apng", "gif"].includes(format))) {
      throw err;
    }
    const multi = await decodeWithImageDecoder(bytes, format);
    if (multi && multi.length) {
      const first = multi[0];
      return {
        format, width: first.width, height: first.height, total: multi.length, loop: null,
        frames: multi, note: "canvas/ImageDecoder 解码",
      };
    }
    const frame = await decodeWithCanvas(bytes, format);
    return {
      format, width: frame.width, height: frame.height, total: 1, loop: null,
      frames: [frame], note: "canvas 单帧解码",
    };
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

function channelLabel(id) {
  return CHANNELS.find((c) => c.id === id)?.label || id;
}

function copyText(text) {
  if (!text) return Promise.resolve(false);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { }
  ta.remove();
  return Promise.resolve(ok);
}

export function openStegSolveView(source, opts = {}) {
  if (typeof document === "undefined") throw new Error("openStegSolveView 仅可在浏览器使用");
  ensureExpStyles();
  ensureStegSolveStyles();

  const previousFocus = document.activeElement;
  const title = opts.title || (source && source.name) || "StegSolve 图像分析";
  const state = {
    bytes: null,
    frames: [],
    frameIndex: 0,
    format: "",
    loop: null,
    note: "",
    sourceImage: null,
    viewImage: null,
    combineImage: null,
    combineResult: null,
    analysis: null,
    selectedCandidate: null,
    seed: 1,
    tab: "bit",
    playTimer: null,
    closed: false,
  };

  const overlay = el("div", { class: "exp-overlay stegsolve-overlay" });
  const dialog = el("div", {
    class: "exp-dialog stegsolve-dialog",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": title,
  });
  const titleEl = el("div", { class: "exp-title stegsolve-title", text: title });
  const closeBtn = el("button", { type: "button", class: "exp-close", title: "关闭", "aria-label": "关闭" });
  closeBtn.innerHTML = iconSvg("close");
  const head = el("div", { class: "exp-head stegsolve-head" }, titleEl, closeBtn);

  const tabDefs = [
    { id: "bit", label: "位平面" },
    { id: "frame", label: "帧浏览" },
    { id: "combine", label: "图像合并" },
  ];
  const tabs = el("div", { class: "stegsolve-tabs", role: "tablist", "aria-label": "StegSolve 功能" });
  const tabButtons = new Map();
  for (const t of tabDefs) {
    const btn = el("button", {
      type: "button",
      class: "stegsolve-tab",
      role: "tab",
      id: "stegsolve-tab-" + t.id,
      "aria-selected": t.id === "bit" ? "true" : "false",
      "aria-controls": "stegsolve-panel-" + t.id,
      tabindex: t.id === "bit" ? "0" : "-1",
    }, t.label);
    btn.addEventListener("click", () => switchTab(t.id));
    tabButtons.set(t.id, btn);
    tabs.append(btn);
  }

  const status = el("div", { class: "stegsolve-status", role: "status", "aria-live": "polite", text: "正在读取图像…" });
  const meta = el("div", { class: "stegsolve-meta", text: "" });
  const body = el("div", { class: "stegsolve-body" });

  const channelSel = el("select", { class: "stegsolve-select", "aria-label": "通道" },
    ...CHANNELS.map((c) => el("option", { value: c.id }, c.label)));
  channelSel.value = "b";
  const bitSel = el("select", { class: "stegsolve-select", "aria-label": "位" },
    ...Array.from({ length: 8 }, (_, i) => el("option", { value: String(i) }, `位 ${i}`)));
  bitSel.value = "0";
  const orderSel = el("select", { class: "stegsolve-select", "aria-label": "位序" },
    el("option", { value: "lsb" }, "LSB 优先"), el("option", { value: "msb" }, "MSB 优先"));
  const modeSel = el("select", { class: "stegsolve-select", "aria-label": "预览模式" },
    el("option", { value: "source" }, "通道原图"),
    el("option", { value: "plain" }, "位平面"),
    el("option", { value: "xor" }, "XOR 原图"),
    el("option", { value: "add" }, "ADD 原图"),
    el("option", { value: "sub" }, "SUB 原图"));
  modeSel.value = "plain";
  const mapSel = el("select", { class: "stegsolve-select", "aria-label": "颜色映射" },
    el("option", { value: "gray" }, "灰度"),
    el("option", { value: "channel" }, "通道色"),
    el("option", { value: "palette" }, "调色板"),
    el("option", { value: "random" }, "随机颜色"));
  const invertChk = el("input", { type: "checkbox", class: "stegsolve-check" });
  const seedBtn = el("button", { type: "button", class: "stegsolve-btn" }, "换随机色");

  const planeCanvas = el("canvas", { class: "stegsolve-canvas", role: "img", "aria-label": "位平面预览" });
  const planeCaption = el("div", { class: "stegsolve-caption", text: "等待图像…" });
  const exportViewBtn = el("button", { type: "button", class: "stegsolve-btn primary" }, "导出当前视图 PNG");
  const downloadPlaneBtn = el("button", { type: "button", class: "stegsolve-btn" }, "下载原始位平面");

  const candSummary = el("div", { class: "stegsolve-cand-summary", text: "载入后自动分析 LSB 候选" });
  const candList = el("div", { class: "stegsolve-cand-list" });
  const candText = el("pre", { class: "stegsolve-cand-text", text: "点击候选查看提取文本" });
  const copyCandBtn = el("button", { type: "button", class: "stegsolve-btn" }, "复制候选文本");
  const analysisBox = el("details", { class: "stegsolve-analysis", open: "" },
    el("summary", {}, "LSB 候选（stegSolveAnalyze）"),
    candSummary,
    candList,
    candText,
    el("div", { class: "stegsolve-actions" }, copyCandBtn),
  );

  const bitPanel = el("div", {
    class: "stegsolve-panel", id: "stegsolve-panel-bit", role: "tabpanel", "aria-labelledby": "stegsolve-tab-bit",
  },
    el("div", { class: "stegsolve-toolbar" },
      el("label", { class: "stegsolve-field" }, el("span", {}, "通道"), channelSel),
      el("label", { class: "stegsolve-field" }, el("span", {}, "位"), bitSel),
      el("label", { class: "stegsolve-field" }, el("span", {}, "位序"), orderSel),
      el("label", { class: "stegsolve-field" }, el("span", {}, "预览"), modeSel),
      el("label", { class: "stegsolve-field" }, el("span", {}, "映射"), mapSel),
      el("label", { class: "stegsolve-check-wrap" }, invertChk, el("span", {}, "反色")),
      seedBtn,
    ),
    el("div", { class: "stegsolve-stage" }, planeCanvas),
    planeCaption,
    el("div", { class: "stegsolve-actions" }, exportViewBtn, downloadPlaneBtn),
    analysisBox,
  );

  const frameCanvas = el("canvas", { class: "stegsolve-canvas", role: "img", "aria-label": "帧预览" });
  const frameRange = el("input", { type: "range", class: "stegsolve-range", min: "0", max: "0", value: "0", "aria-label": "帧序号" });
  const frameCount = el("span", { class: "stegsolve-frame-count", text: "- / -" });
  const frameCaption = el("div", { class: "stegsolve-caption", text: "等待图像…" });
  const firstBtn = el("button", { type: "button", class: "stegsolve-btn" }, "首帧");
  const prevBtn = el("button", { type: "button", class: "stegsolve-btn" }, "上一帧");
  const nextBtn = el("button", { type: "button", class: "stegsolve-btn" }, "下一帧");
  const lastBtn = el("button", { type: "button", class: "stegsolve-btn" }, "末帧");
  const playBtn = el("button", { type: "button", class: "stegsolve-btn" }, "播放");
  const exportFrameBtn = el("button", { type: "button", class: "stegsolve-btn primary" }, "导出当前帧 PNG");

  const framePanel = el("div", {
    class: "stegsolve-panel", id: "stegsolve-panel-frame", role: "tabpanel", "aria-labelledby": "stegsolve-tab-frame", hidden: "",
  },
    el("div", { class: "stegsolve-toolbar" },
      firstBtn, prevBtn, nextBtn, lastBtn, playBtn,
      el("label", { class: "stegsolve-field grow" }, el("span", {}, "帧"), frameRange),
      frameCount,
      exportFrameBtn,
    ),
    el("div", { class: "stegsolve-stage" }, frameCanvas),
    frameCaption,
  );

  const combineFile = el("input", { type: "file", accept: "image/*", class: "stegsolve-file", "aria-label": "选择第二张图像" });
  const combineChoose = el("button", { type: "button", class: "stegsolve-btn" }, "选择第二张图");
  const combineMode = el("select", { class: "stegsolve-select", "aria-label": "合并方式" },
    ...COMBINE_MODES.map((m) => el("option", { value: m }, m.toUpperCase())));
  const combineCanvas = el("canvas", { class: "stegsolve-canvas", role: "img", "aria-label": "图像合并预览" });
  const combineCaption = el("div", { class: "stegsolve-caption", text: "选择第二张同尺寸图像后合并" });
  const exportCombineBtn = el("button", { type: "button", class: "stegsolve-btn primary", disabled: "" }, "导出合并结果 PNG");
  const combineStage = el("div", { class: "stegsolve-stage stegsolve-drop" }, combineCanvas);

  const combinePanel = el("div", {
    class: "stegsolve-panel", id: "stegsolve-panel-combine", role: "tabpanel", "aria-labelledby": "stegsolve-tab-combine", hidden: "",
  },
    el("div", { class: "stegsolve-toolbar" },
      combineChoose, combineFile,
      el("label", { class: "stegsolve-field" }, el("span", {}, "合并"), combineMode),
      exportCombineBtn,
    ),
    combineStage,
    combineCaption,
  );

  body.append(bitPanel, framePanel, combinePanel);
  dialog.append(head, tabs, status, meta, body);
  overlay.append(dialog);
  document.body.append(overlay);

  let lifecycle = null;
  function close() {
    if (state.closed) return;
    state.closed = true;
    stopPlay();
    if (lifecycle) { lifecycle.release(); lifecycle = null; }
    overlay.classList.add("exp-closing");
    setTimeout(() => overlay.remove(), 250);
  }
  closeBtn.addEventListener("click", close);

  function setStatus(text, level = "info") {
    status.textContent = text;
    status.dataset.level = level;
  }

  function switchTab(id) {
    state.tab = id;
    if (id !== "frame") stopPlay();
    for (const [tid, btn] of tabButtons) {
      const on = tid === id;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.tabIndex = on ? 0 : -1;
    }
    bitPanel.hidden = id !== "bit";
    framePanel.hidden = id !== "frame";
    combinePanel.hidden = id !== "combine";
    if (id === "frame") renderFrame();
    if (id === "combine") renderCombine();
  }

  tabs.addEventListener("keydown", (e) => {
    const idx = tabDefs.findIndex((t) => t.id === state.tab);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = (idx + (e.key === "ArrowRight" ? 1 : -1) + tabDefs.length) % tabDefs.length;
      switchTab(tabDefs[next].id);
      tabButtons.get(tabDefs[next].id)?.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const target = e.key === "Home" ? tabDefs[0] : tabDefs[tabDefs.length - 1];
      switchTab(target.id);
      tabButtons.get(target.id)?.focus();
    }
  });

  function renderPlane() {
    if (!state.sourceImage) return;
    const channel = channelSel.value;
    const bit = Number(bitSel.value) || 0;
    const order = orderSel.value;
    const mode = modeSel.value;
    const colorMap = mapSel.value;
    const invert = invertChk.checked;
    let image;
    if (mode === "source") {
      image = renderChannel(state.sourceImage, { channel, colorMap, invert, seed: state.seed });
    } else {
      image = renderBitPlane(state.sourceImage, { channel, bit, order, mode, colorMap, invert, seed: state.seed });
    }
    state.viewImage = image;
    paint(planeCanvas, image);
    const ab = order === "msb" ? 7 - bit : bit;
    const modeLabel = { source: "通道原图", plain: "位平面", xor: "XOR 原图", add: "ADD 原图", sub: "SUB 原图" }[mode] || mode;
    const mapLabel = { gray: "灰度", channel: "通道色", palette: "调色板", random: "随机颜色" }[colorMap] || colorMap;
    const xorNote = state.selectedCandidate?.xor ? ` · 候选 ${state.selectedCandidate.xor}` : "";
    planeCaption.textContent = `${image.width}×${image.height} · ${channelLabel(channel)} · 位 ${bit}（实际位 ${ab}） · ${order.toUpperCase()} · ${modeLabel} · ${mapLabel}${invert ? " · 反色" : ""}${xorNote}`;
    bitSel.disabled = mode === "source";
    orderSel.disabled = mode === "source";
  }

  for (const node of [channelSel, bitSel, orderSel, modeSel, mapSel, invertChk]) {
    node.addEventListener("change", () => {
      state.selectedCandidate = null;
      renderPlane();
    });
  }
  seedBtn.addEventListener("click", () => {
    state.seed = (state.seed + 1) >>> 0 || 1;
    if (mapSel.value === "random") renderPlane();
  });
  exportViewBtn.addEventListener("click", () => {
    if (!state.viewImage) return;
    downloadPNG(state.viewImage, `stegsolve_${channelSel.value}_bit${bitSel.value}_${modeSel.value}.png`);
    setStatus("已导出当前视图 PNG", "ok");
  });
  downloadPlaneBtn.addEventListener("click", () => {
    if (!state.sourceImage) return;
    const img = renderBitPlane(state.sourceImage, {
      channel: channelSel.value, bit: Number(bitSel.value) || 0, order: orderSel.value,
      mode: "plain", colorMap: "gray", invert: false,
    });
    downloadPNG(img, `stegsolve_${channelSel.value}_bit${bitSel.value}_plane.png`);
    setStatus("已下载原始位平面 PNG", "ok");
  });

  function setFrame(index) {
    if (!state.frames.length) return;
    const n = state.frames.length;
    state.frameIndex = ((index % n) + n) % n;
    const frame = state.frames[state.frameIndex];
    paint(frameCanvas, frame);
    frameRange.value = String(state.frameIndex);
    frameCount.textContent = `${state.frameIndex + 1} / ${n}`;
    const loopText = state.loop == null ? "未知" : (state.loop === 0 ? "∞" : String(state.loop));
    const truncated = state.note ? ` · ${state.note}` : "";
    frameCaption.textContent = `帧 ${state.frameIndex + 1}/${n} · ${frame.width}×${frame.height} · 延时 ${frame.delay || 0} ms · 循环 ${loopText}${truncated}`;
  }

  function renderFrame() {
    if (state.frames.length) setFrame(state.frameIndex);
  }

  function stopPlay() {
    if (state.playTimer) { clearTimeout(state.playTimer); state.playTimer = null; }
    playBtn.textContent = "播放";
    playBtn.classList.remove("active");
  }

  function playNext() {
    if (state.closed || !state.playTimer) return;
    if (state.frames.length < 2) { stopPlay(); return; }
    setFrame(state.frameIndex + 1);
    const delay = state.frames[state.frameIndex]?.delay || 120;
    state.playTimer = setTimeout(playNext, Math.max(30, Math.min(delay, 5000)));
  }

  playBtn.addEventListener("click", () => {
    if (state.playTimer) { stopPlay(); return; }
    if (state.frames.length < 2) return;
    playBtn.textContent = "暂停";
    playBtn.classList.add("active");
    state.playTimer = setTimeout(playNext, 0);
  });
  firstBtn.addEventListener("click", () => { stopPlay(); setFrame(0); });
  prevBtn.addEventListener("click", () => { stopPlay(); setFrame(state.frameIndex - 1); });
  nextBtn.addEventListener("click", () => { stopPlay(); setFrame(state.frameIndex + 1); });
  lastBtn.addEventListener("click", () => { stopPlay(); setFrame(state.frames.length - 1); });
  frameRange.addEventListener("input", () => { stopPlay(); setFrame(Number(frameRange.value) || 0); });
  exportFrameBtn.addEventListener("click", () => {
    const frame = state.frames[state.frameIndex];
    if (!frame) return;
    downloadPNG(frame, `stegsolve_frame_${state.frameIndex + 1}.png`);
    setStatus(`已导出第 ${state.frameIndex + 1} 帧 PNG`, "ok");
  });

  function setFrameControls() {
    const multi = state.frames.length > 1;
    frameRange.max = String(Math.max(0, state.frames.length - 1));
    for (const btn of [firstBtn, prevBtn, nextBtn, lastBtn, playBtn, exportFrameBtn]) btn.disabled = !multi && btn !== exportFrameBtn;
    frameRange.disabled = !multi;
    if (!multi) { frameRange.value = "0"; stopPlay(); }
  }

  function renderCombine() {
    if (!state.sourceImage || !state.combineImage) return;
    try {
      const result = combineImages(state.sourceImage, state.combineImage, combineMode.value);
      state.combineResult = result;
      paint(combineCanvas, result);
      exportCombineBtn.disabled = false;
      combineCaption.textContent = `${result.width}×${result.height} · ${combineMode.value.toUpperCase()} · 已合并`;
      setStatus(`合并完成：${combineMode.value.toUpperCase()}`, "ok");
    } catch (err) {
      state.combineResult = null;
      exportCombineBtn.disabled = true;
      combineCaption.textContent = err.message;
      setStatus(err.message, "error");
    }
  }

  combineChoose.addEventListener("click", () => combineFile.click());
  combineFile.addEventListener("change", () => {
    const file = combineFile.files && combineFile.files[0];
    if (file) loadCombineFile(file);
    combineFile.value = "";
  });
  combineMode.addEventListener("change", renderCombine);
  exportCombineBtn.addEventListener("click", () => {
    if (!state.combineResult) return;
    downloadPNG(state.combineResult, `stegsolve_combine_${combineMode.value}.png`);
    setStatus("已导出合并结果 PNG", "ok");
  });

  async function loadCombineFile(file) {
    try {
      setStatus(`正在读取 ${file.name || "第二张图"}…`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (state.closed) return;
      const decoded = await decodeFramesWithFallback(bytes);
      if (state.closed) return;
      if (!decoded.frames.length) throw new Error("第二张图没有可解码帧");
      state.combineImage = decoded.frames[0];
      combineCaption.textContent = `${file.name || "第二张图"} · ${state.combineImage.width}×${state.combineImage.height}`;
      renderCombine();
    } catch (err) {
      state.combineImage = null;
      state.combineResult = null;
      exportCombineBtn.disabled = true;
      combineCaption.textContent = err.message;
      setStatus(err.message, "error");
    }
  }

  combineStage.addEventListener("dragover", (e) => { e.preventDefault(); combineStage.classList.add("drag"); });
  combineStage.addEventListener("dragleave", () => combineStage.classList.remove("drag"));
  combineStage.addEventListener("drop", (e) => {
    e.preventDefault();
    combineStage.classList.remove("drag");
    const file = e.dataTransfer?.files?.[0];
    if (file) loadCombineFile(file);
  });

  function candidateLabel(c) {
    return `${c.channelLabel} · bit ${c.bit} · ${c.pack.toUpperCase()}${c.xor ? " · " + c.xor : ""}`;
  }

  function applyCandidate(c) {
    state.selectedCandidate = c;
    channelSel.value = c.channel;
    bitSel.value = String(c.bit);
    orderSel.value = "lsb";
    modeSel.value = "plain";
    mapSel.value = "gray";
    invertChk.checked = false;
    renderPlane();
    candText.textContent = c.text || "（空文本）";
    for (const node of candList.querySelectorAll(".stegsolve-cand")) {
      node.classList.toggle("active", node.dataset.id === candidateId(c));
    }
    setStatus(c.hasFlag ? `命中 flag：${c.flags[0]}` : `已应用候选：${candidateLabel(c)}`, c.hasFlag ? "ok" : "info");
  }

  function candidateId(c) {
    return `${c.channel}|${c.bit}|${c.pack}|${c.xor || ""}`;
  }

  function renderCandidates(res) {
    candList.textContent = "";
    const n = res.candidates.length;
    candSummary.textContent = `${res.scanned} 组候选 · 显示前 ${n} 组${res.truncated ? " · 大图仅扫描前 64KB" : ""}`;
    if (!n) { candList.append(el("div", { class: "stegsolve-empty", text: "无候选" })); return; }
    for (const c of res.candidates) {
      const btn = el("button", { type: "button", class: "stegsolve-cand" + (c.hasFlag ? " has-flag" : ""), "data-id": candidateId(c) },
        el("span", { class: "stegsolve-cand-head" }, candidateLabel(c)),
        el("span", { class: "stegsolve-cand-meta" },
          `可打印 ${(c.printableRatio * 100).toFixed(1)}% · 评分 ${c.score} · ${c.lengthBytes} B`),
      );
      if (c.flags.length) btn.append(el("code", { class: "stegsolve-cand-flag" }, c.flags[0]));
      btn.addEventListener("click", () => applyCandidate(c));
      candList.append(btn);
    }
    const firstFlag = res.candidates.find((c) => c.hasFlag);
    if (firstFlag) {
      applyCandidate(firstFlag);
      candText.textContent = firstFlag.text || "";
    }
  }

  function runAnalysis() {
    if (!state.bytes || state.analysis || state.closed) return;
    candSummary.textContent = "正在扫描位平面候选…";
    setTimeout(() => {
      if (state.closed || state.analysis) return;
      try {
        let res;
        try {
          res = stegSolveAnalyze(state.bytes, { limit: 24 });
        } catch (err) {
          if (!state.sourceImage) throw err;
          res = stegSolveAnalyze(imageToPNG(state.sourceImage), { limit: 24 });
        }
        state.analysis = res;
        renderCandidates(state.analysis);
      } catch (err) {
        candSummary.textContent = "候选分析失败：" + err.message;
      }
    }, 20);
  }

  copyCandBtn.addEventListener("click", async () => {
    const ok = await copyText(state.selectedCandidate?.text || candText.textContent || "");
    setStatus(ok ? "候选文本已复制" : "复制失败（浏览器拒绝剪贴板）", ok ? "ok" : "error");
  });

  dialog.addEventListener("keydown", (e) => {
    if (state.tab !== "frame" || e.target.closest(".stegsolve-tabs") || e.target.matches("input, select, textarea")) return;
    if (e.key === "ArrowLeft") { e.preventDefault(); stopPlay(); setFrame(state.frameIndex - 1); }
    else if (e.key === "ArrowRight") { e.preventDefault(); stopPlay(); setFrame(state.frameIndex + 1); }
  });

  lifecycle = attachModalLifecycle(overlay, {
    dialog,
    onClose: close,
    initialFocus: tabButtons.get("bit"),
    restoreFocusTo: previousFocus,
  });

  (async () => {
    try {
      const bytes = await sourceToBytes(source, opts.bytes);
      if (state.closed) return;
      state.bytes = bytes;
      setStatus("正在解码图像…");
      const decoded = await decodeFramesWithFallback(bytes);
      if (state.closed) return;
      state.frames = decoded.frames;
      state.format = decoded.format;
      state.loop = decoded.loop;
      state.note = decoded.note || "";
      state.sourceImage = decoded.frames[0];
      state.frameIndex = 0;
      titleEl.textContent = opts.title || (source && source.name) || `StegSolve · ${decoded.format.toUpperCase()}`;
      meta.textContent = `${decoded.format.toUpperCase()} · ${state.sourceImage.width}×${state.sourceImage.height} · ${decoded.frames.length} 帧${decoded.total && decoded.total !== decoded.frames.length ? "（共 " + decoded.total + " 帧）" : ""}${state.note ? " · " + state.note : ""}`;
      setStatus("图像已载入，正在生成位平面预览", "ok");
      setFrameControls();
      setFrame(0);
      renderPlane();
      renderCombine();
      runAnalysis();
    } catch (err) {
      if (state.closed) return;
      setStatus(err.message || String(err), "error");
      planeCaption.textContent = err.message || String(err);
      frameCaption.textContent = "无法解码帧";
      combineCaption.textContent = "无法解码图像";
      console.warn("[stegSolve]", err);
    }
  })();

  return close;
}

export default { openStegSolveView, ensureStegSolveStyles };
