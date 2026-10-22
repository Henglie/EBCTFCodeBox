/*
 * dataToImage.js — 数值数据 → 图像的通用渲染原语（单一源）
 *
 * ── 为什么需要这一层 ─────────────────────────────────────
 * 我们的图像能力原本是**按用途**长出来的：qrGen / bin2img / mcMap / spectrogram /
 * spiralMatrix 各写一套「准备像素 + 编码 PNG」。于是每遇到一种新的「数字 → 图」题型
 * （RGB 三通道列表、坐标点集、位流、色块网格、热力图…），就要再写一遍渲染与布局猜测。
 * PNG 编码逻辑因此散落在 12 个文件里。
 *
 * 本层把「渲染」与「题型」解耦：
 *   渲染内核 = 「通道数据 + 显式布局」→ PNG 字节
 *   题型     = 渲染内核的一组参数（kind / channels / width / scale / invertY / normalize）
 * 加一种新题型 = 加一组参数，而不是加一个渲染实现。
 *
 * ── 契约 ────────────────────────────────────────────────
 *   - 纯 JS、零第三方依赖、零 DOM；可 Node 直测、可 Worker 调用。
 *   - PNG 编码复用 `mcMap.encodePNG`（自包含、zlib stored 块、自写 CRC32），**不另写一份**。
 *   - 布局**显式声明**，不静默猜：自动推断的结果必须写进报告，让用户能看见并纠正。
 *   - 空/畸形输入返回结构化错误，不抛未捕获异常、不产出垃圾图。
 *
 * ── 权威依据 ────────────────────────────────────────────
 *   PNG 容器与像素格式：ISO/IEC 15948（IHDR 位深/颜色类型、IDAT 的 zlib 流、CRC-32）
 *   采样与几何：像素坐标原点在左上、y 轴向下（PNG/ISO 15948 约定）；需要数学坐标系时显式 invertY
 */

import { encodePNG } from "./mcMap.js";
import { register } from "./registry.js";
import { imageInputBytes, decodeImageToRgba } from "./imageBytes.js";

// ------------------------------------------------------------
// 通用数值解析：把「一堆数字的文本」变成 rows（每行一个数字数组）
// 只做**结构化**处理，不做题型判断 —— 题型判断在 detectKind 里，且必须报告依据。
// ------------------------------------------------------------
export function parseNumberRows(text) {
  const raw = String(text == null ? "" : text);
  const rows = [];
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim();
    if (!line) continue;
    if (/^(#|\/\/)/.test(line)) continue;                 // 注释行
    line = line.replace(/[\[\]{}()]/g, " ");              // 去括号类包裹
    line = line.replace(/[,;|\t]+/g, " ").replace(/\s+/g, " ").trim();
    if (!line) continue;
    const nums = line.split(" ").map((t) => Number(t));
    if (nums.some((n) => !Number.isFinite(n))) continue;   // 非纯数字行跳过（不硬凑）
    rows.push(nums);
  }
  const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return { rows, maxCols };
}

/** 单行紧凑位流/数字串 → rows（例如 "01001101" 或 "1 0 1 1"）。 */
export function parseBitString(text) {
  const s = String(text == null ? "" : text).replace(/[^01]/g, "");
  return s ? s.split("").map((c) => [Number(c)]) : [];
}

// ------------------------------------------------------------
// 题型判定：只输出「结论 + 依据」，不做任何渲染。
// ------------------------------------------------------------
// 大数组求极值：不能用 Math.min(...arr)（15 万元素即爆调用栈），逐元素扫。
function minOf(arr) { let m = Infinity; for (let i = 0; i < arr.length; i++) if (arr[i] < m) m = arr[i]; return m; }
function maxOf(arr) { let m = -Infinity; for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i]; return m; }

export function detectKind(parsed) {
  const { rows, maxCols } = parsed;
  if (!rows.length) return { kind: null, reason: "没有解析到任何数字行" };
  const all = rows.every((r) => r.length === maxCols);
  const flat = rows.flat();
  const inRange = (a, b) => flat.every((v) => v >= a && v <= b);

  if (maxCols === 2 && all) {
    const xs = rows.map((r) => r[0]), ys = rows.map((r) => r[1]);
    const spanX = maxOf(xs) - minOf(xs);
    const spanY = maxOf(ys) - minOf(ys);
    if ((spanX > 1 || spanY > 1) && flat.every(Number.isInteger))
      return { kind: "points", reason: `每行 2 个整数、跨度为 ${spanX}×${spanY} → 坐标点集` };
    if (inRange(0, 1))
      return { kind: "points", reason: "每行 2 个 0/1 → 按坐标点集处理" };
  }
  if ((maxCols === 3 || maxCols === 4) && all) {
    if (inRange(0, 255))
      return { kind: "channels", channels: maxCols, reason: `每行 ${maxCols} 个 0-255 整数 → ${maxCols === 3 ? "RGB" : "RGBA"} 通道` };
    if (inRange(0, 1))
      return { kind: "channels", channels: maxCols, range: [0, 1], reason: `每行 ${maxCols} 个 0-1 浮点 → ${maxCols === 3 ? "RGB" : "RGBA"} 通道（0-1 值域）` };
  }
  if (inRange(0, 1) && flat.every(Number.isInteger) && maxCols === 1)
    return { kind: "bits", reason: "单列 0/1 → 位流（按行铺成图）" };
  if (all) return { kind: "grid", reason: `等宽 ${maxCols} 列数值 → 标量网格（按值域归一化上色）` };
  return { kind: "grid", reason: `行宽不齐（最大 ${maxCols} 列）→ 标量网格（短行右侧补 0）` };
}

// ------------------------------------------------------------
// 渲染内核：通道数据 + 显式布局 → PNG 字节
// layout = { width, height, channels, order, scale, invertY, background, foreground }
// ------------------------------------------------------------
export function renderChannels(data, layout) {
  const L = layout || {};
  const channels = L.channels || 3;
  const scale = Math.max(1, Math.floor(L.scale || 1));
  const invertY = !!L.invertY;
  const order = L.order === "bgr" ? "bgr" : "rgb";
  const scan = L.scan === "column" ? "column" : "row";
  const n = Math.floor(data.length / channels);
  if (!n) return { error: "通道数据为空" };

  let width = Math.floor(L.width || 0);
  let height = Math.floor(L.height || 0);
  if (!width && !height) { width = Math.ceil(Math.sqrt(n)); height = Math.ceil(n / width); }
  else if (!width) width = Math.ceil(n / height);
  else if (!height) height = Math.ceil(n / width);
  if (width <= 0 || height <= 0) return { error: "推导出的宽高非法（width=" + width + ", height=" + height + "）" };

  // 扫描序：width 表示「扫描行长」（一行的元素个数），不是图像的像素宽。
  // row    → 第 i 个像素在 (i mod width, i div width)
  // column → 第 i 个像素在 (i div width, i mod width)，即数据先沿纵向推进（列主序）
  // 二者产出的图像互为转置；同一份数据两种读法都「合理」，所以必须由参数显式声明。
  const pixAt = (i) => scan === "column"
    ? [Math.floor(i / width), i % width]
    : [i % width, Math.floor(i / width)];

  // 列主序时，width 是列高、height 是列数
  const ow0 = scan === "column" ? Math.ceil(n / width) : width;
  const oh0 = scan === "column" ? width : Math.ceil(n / width);
  const gw = ow0, gh = oh0;
  const outW = gw * scale, outH = gh * scale;
  if (outW * outH > 40_000_000) return { error: `输出过大（${outW}×${outH}），请降低 scale 或指定更小的宽高` };

  const rgba = new Uint8Array(outW * outH * 4);
  const bg = L.background || [0, 0, 0];
  for (let i = 0; i < outW * outH; i++) {
    rgba[i * 4] = bg[0]; rgba[i * 4 + 1] = bg[1]; rgba[i * 4 + 2] = bg[2]; rgba[i * 4 + 3] = 255;
  }
  const norm = L.range ? L.range : null;
  const map = (v) => {
    if (norm) return Math.max(0, Math.min(255, Math.round(((v - norm[0]) / (norm[1] - norm[0])) * 255)));
    return Math.max(0, Math.min(255, Math.round(v)));
  };
  for (let i = 0; i < n; i++) {
    const [gx, gyRaw] = pixAt(i);
    if (gx < 0 || gx >= gw) continue;
    const gy = invertY ? (gh - 1 - gyRaw) : gyRaw;
    if (gy < 0 || gy >= gh) continue;
    const base = i * channels;
    let r, g, b, a = 255;
    const v0 = data[base], v1 = data[base + 1], v2 = data[base + 2], v3 = data[base + 3];
    if (channels === 1) { r = g = b = map(v0); }
    else if (channels === 2) { r = g = b = map(v0); a = Math.max(0, Math.min(255, Math.round(v1))); }
    else if (channels === 3) { r = map(v0); g = map(v1); b = map(v2); }
    else { r = map(v0); g = map(v1); b = map(v2); a = Math.max(0, Math.min(255, Math.round(v3))); }
    if (order === "bgr" && channels >= 3) { const t = r; r = b; b = t; }
    for (let dy = 0; dy < scale; dy++) {
      for (let dx = 0; dx < scale; dx++) {
        const o = ((gy * scale + dy) * outW + (gx * scale + dx)) * 4;
        rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
      }
    }
  }
  return { rgba, width: outW, height: outH, srcWidth: gw, srcHeight: gh, scale };
}

/** 点集 → PNG。points = [[x,y],...]；可连线（折线）。 */
export function renderPoints(points, layout) {
  const L = layout || {};
  if (!points || !points.length) return { error: "点集为空" };
  const scale = Math.max(1, Math.floor(L.scale || 4));
  const pad = Math.max(0, Math.floor(L.padding == null ? 1 : L.padding));
  const invertY = !!L.invertY;
  const connect = !!L.connect;
  const dot = Math.max(1, Math.floor(L.dot || 1));
  const fg = L.foreground || [0, 0, 0];
  const bg = L.background || [255, 255, 255];

  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const minX = minOf(xs), maxX = maxOf(xs);
  const minY = minOf(ys), maxY = maxOf(ys);
  const gw = maxX - minX + 1 + pad * 2;
  const gh = maxY - minY + 1 + pad * 2;
  const ow = gw * scale, oh = gh * scale;
  if (ow * oh > 40_000_000) return { error: `输出过大（${ow}×${oh}），请降低 scale` };

  const rgba = new Uint8Array(ow * oh * 4);
  for (let i = 0; i < ow * oh; i++) {
    rgba[i * 4] = bg[0]; rgba[i * 4 + 1] = bg[1]; rgba[i * 4 + 2] = bg[2]; rgba[i * 4 + 3] = 255;
  }
  const plot = (gx, gy) => {
    const yy = invertY ? (gh - 1 - gy) : gy;
    for (let dy = 0; dy < dot; dy++) {
      for (let dx = 0; dx < dot; dx++) {
        const px = (gx + dx) * scale, py = (yy + dy) * scale;
        if (px < 0 || py < 0 || px >= ow || py >= oh) continue;
        const o = (py * ow + px) * 4;
        rgba[o] = fg[0]; rgba[o + 1] = fg[1]; rgba[o + 2] = fg[2]; rgba[o + 3] = 255;
      }
    }
  };
  const toGrid = (p) => [p[0] - minX + pad, p[1] - minY + pad];
  if (connect && points.length > 1) {
    for (let i = 1; i < points.length; i++) {
      let [x0, y0] = toGrid(points[i - 1]);
      const [x1, y1] = toGrid(points[i]);
      const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx - dy;
      for (;;) {
        plot(x0, y0);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x0 += sx; }
        if (e2 < dx) { err += dx; y0 += sy; }
      }
    }
  } else {
    for (const p of points) { const [gx, gy] = toGrid(p); plot(gx, gy); }
  }
  return { rgba, width: ow, height: oh, srcWidth: gw, srcHeight: gh, scale, bbox: { minX, maxX, minY, maxY } };
}

/**
 * 推断像素序列的宽度。
 *
 * 为什么不能只用 √n：那只对**正方形**成立。一行一个像素的 RGB 列表在 CTF 里
 * 常是任意宽高（实测有 150×900 这种竖长图），用 √n 会**静默产出错位图**。
 *
 * 判据（行边界连续性）：若宽度 w 正确，则「第 y 行最后一个像素」与「第 y+1 行第一个像素」
 * 在真实图像里是同一行相邻位置，色差应显著小于错误切分时的跨行跳跃。故对每个候选宽度
 * 计算行边界处的平均色差，取最小者。这是图像重排（unshredding）里的经典判据。
 *
 * 只在候选宽度上搜索，且**必须回报置信度**：最优与次优接近时说明不可判，不装作确定。
 */
export function inferWidth(data, channels) {
  const n = Math.floor(data.length / channels);
  if (n <= 0) return { width: 0, confidence: 0, candidates: [] };
  const cands = [];
  for (let w = 1; w <= n; w++) {
    if (n % w !== 0) continue;
    if (w < 4 || w > 8192) continue;
    cands.push(w);
  }
  if (!cands.length) return { width: Math.ceil(Math.sqrt(n)), confidence: 0, candidates: [] };
  if (cands.length === 1) return { width: cands[0], confidence: 1, candidates: [[cands[0], 0]] };

  // 代价 = 全部「纵向邻居」的平均绝对色差：mean |p(i) - p(i+w)|。
  // 为什么不是只算「行尾→行首」那一对：纯色/大面积均匀的图里那一对恒为 0，判别力归零
  // （实测把 150 宽误判成 900）。取全部纵向邻居后，错误的 w 会把「真实相隔很远」的像素配成邻居，
  // 代价显著升高 —— 这是图像重排（unshredding）里的标准判据。
  const cost = (w) => {
    const pairs = n - w;
    if (pairs < 1) return Infinity;
    let sum = 0, cnt = 0;
    for (let i = 0; i < pairs; i++) {
      const a = i * channels, b = (i + w) * channels;
      for (let c = 0; c < channels; c++) { sum += Math.abs(data[a + c] - data[b + c]); cnt++; }
    }
    return cnt ? sum / cnt : Infinity;
  };

  const scored = cands.map((w) => [w, cost(w)]).sort((x, y) => {
    if (x[1] !== y[1]) return x[1] - y[1];
    // 代价相同时偏向接近正方形（次要先验，不改变主判据）
    return Math.abs(x[0] - Math.sqrt(n)) - Math.abs(y[0] - Math.sqrt(n));
  });
  const best = scored[0];
  const second = scored[1];
  // 置信度：次优代价明显更大才可信（比值 1.25 为界，取自「边界代价至少差四分之一」的经验阈值）
  const conf = second && second[1] > 0 ? Math.max(0, Math.min(1, (second[1] - best[1]) / second[1])) : 1;
  return { width: best[0], confidence: conf, candidates: scored.slice(0, 5) };
}

/** 统一出口：渲染结果 → { text, files }（PNG 走产物协议，用户直接下载）。 */
export function toPngResult(rendered, meta) {
  if (rendered.error) return { text: "渲染失败：" + rendered.error };
  const png = encodePNG(rendered.rgba, rendered.width, rendered.height);
  const lines = [];
  lines.push("已渲染为 PNG 图像。");
  lines.push("");
  if (meta) for (const l of meta) lines.push(l);
  lines.push(`图像尺寸: ${rendered.width} × ${rendered.height} 像素` + (rendered.scale > 1 ? `（源 ${rendered.srcWidth}×${rendered.srcHeight}，放大 ${rendered.scale}×）` : ""));
  lines.push(`PNG 字节数: ${png.length}`);
  lines.push("");
  lines.push("（点下方按钮直接下载图片，不必手拷 base64。）");
  return {
    text: lines.join("\n"),
    files: [{ name: "out.png", mime: "image/png", bytes: png }],
  };
}

export default { parseNumberRows, parseBitString, detectKind, inferWidth, renderChannels, renderPoints, toPngResult };

// ------------------------------------------------------------
// 反向：图片 → 数值行（dataToImage 的逆过程，用于从渲染图还原像素数据）
// 诚实边界：有损格式、放大/归一化/调色板等不可逆步骤无法还原原始数值，
// 只能给出「按当前图像像素采样」的结果；参数需与出图时一致。
// ------------------------------------------------------------
async function imageToDataRun(text, p = {}) {
  const bytes = imageInputBytes(text, p, "图片还原数值");
  const img = await decodeImageToRgba(bytes, "图片还原数值");
  const { width, height, data } = img;
  const scale = Math.max(1, Math.floor(Number(p.scale || 1)));
  const off = Math.floor(scale / 2);
  const scan = p.scan === "column" ? "column" : "row";
  const order = p.order === "bgr" ? "bgr" : "rgb";
  const fmt = p.format === "space" ? " " : p.format === "tab" ? "\t" : ",";
  let channels = Math.floor(Number(p.channels || 0));
  if (channels === 0) {
    channels = 3;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 255) { channels = 4; break; }
    }
  }
  channels = Math.max(1, Math.min(4, channels));
  const total = Math.ceil(width / scale) * Math.ceil(height / scale);
  if (total > 4_000_000) {
    throw new Error(`采样点 ${total} 个，超过 400 万上限；请调大 scale（当前 ${scale}）或先缩小图片`);
  }
  const lines = [];
  const push = (x, y) => {
    const i = (y * width + x) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (channels === 1) {
      lines.push(String(Math.round(0.299 * r + 0.587 * g + 0.114 * b)));
    } else {
      const px = order === "bgr" ? [b, g, r] : [r, g, b];
      const vals = channels === 4 ? [...px, a] : px;
      lines.push(vals.join(fmt));
    }
  };
  if (scan === "column") {
    for (let x = off; x < width; x += scale) for (let y = off; y < height; y += scale) push(x, y);
  } else {
    for (let y = off; y < height; y += scale) for (let x = off; x < width; x += scale) push(x, y);
  }
  return lines.join("\n");
}

register({
  id: "imageToData",
  cat: "image",
  name: "图片还原数值数据",
  desc: "「数值数据渲染成图」的反向：把图片按像素采样还原成一行一个的 RGB/RGBA/灰度数值。scale 与出图时的放大倍数一致（放大 N 倍就填 N），scan/order 与出图参数一致。有损/归一化/调色板渲染无法精确逆推，只还原当前像素值",
  params: [
    { key: "channels", label: "通道数", type: "select", default: "0", options: [
      { value: "0", label: "自动（有 alpha 用 4，否则 3）" },
      { value: "3", label: "RGB" }, { value: "4", label: "RGBA" },
      { value: "1", label: "灰度" },
    ] },
    { key: "order", label: "通道顺序", type: "select", default: "rgb",
      options: [{ value: "rgb", label: "RGB" }, { value: "bgr", label: "BGR" }] },
    { key: "scan", label: "扫描序", type: "select", default: "row",
      options: [{ value: "row", label: "行主序（先横后纵）" }, { value: "column", label: "列主序（先纵后横）" }] },
    { key: "scale", label: "采样步长（与出图放大倍数一致）", type: "number", default: 1 },
    { key: "format", label: "数值分隔符", type: "select", default: "comma",
      options: [{ value: "comma", label: "逗号" }, { value: "space", label: "空格" }, { value: "tab", label: "制表符" }] },
  ],
  acceptsBytes: true,
  run: imageToDataRun,
});

// ------------------------------------------------------------
// op 入口：自动判形态 → 渲染 → 出可下载 PNG
// 形态判定结果**写进报告**（显式声明，不静默猜），用户可据此改参数。
// ------------------------------------------------------------
export function dataToImageRun(text, p) {
  const o = p || {};
  const src = String(text == null ? "" : text);
  if (!src.trim()) return "（空输入）请粘贴「一行一个像素 / 一行一个坐标」的数值文本。";

  let parsed = parseNumberRows(src);
  let kind = String(o.kind || "auto");
  let reason = "";
  let channels = Math.floor(o.channels || 0);

  if (!parsed.rows.length) {
    // 退回紧凑位流（"01001101" 这种一行连写）
    const bits = parseBitString(src);
    if (!bits.length) return "未能从输入里解析出数字。请检查每行是否为「数值」或「数值,数值」。";
    parsed = { rows: bits, maxCols: 1 };
    kind = "bits";
    reason = "输入是紧凑 0/1 串（无分隔符）→ 位流";
  }

  if (kind === "auto") {
    const d = detectKind(parsed);
    if (!d.kind) return "无法判定数据形态：" + d.reason;
    kind = d.kind;
    reason = d.reason;
    if (d.channels) channels = d.channels;
    if (d.range) o._range = d.range;
  }

  const meta = [`数据形态: ${kind}` + (reason ? `（${reason}）` : "")];

  if (kind === "points") {
    const pts = parsed.rows.map((r) => [r[0], r[1]]);
    const rendered = renderPoints(pts, {
      scale: Math.max(1, Math.floor(o.scale || 4)),
      invertY: !!o.invertY,
      connect: !!o.connect,
    });
    meta.push(`点数: ${pts.length}`);
    if (rendered.bbox) meta.push(`包围盒: x ${rendered.bbox.minX}..${rendered.bbox.maxX}  y ${rendered.bbox.minY}..${rendered.bbox.maxY}`);
    return toPngResult(rendered, meta);
  }

  // channels / grid / bits 都归到「通道数据 + 布局」
  let data = [];
  if (kind === "bits") {
    data = parsed.rows.map((r) => (r[0] ? 255 : 0));
    channels = 1;
  } else if (kind === "channels") {
    if (!channels) channels = parsed.maxCols;
    for (const r of parsed.rows) for (let i = 0; i < channels; i++) data.push(r[i] == null ? 0 : r[i]);
  } else {
    // grid：标量归一化上色（灰度）
    const flat = parsed.rows.flat();
    const min = minOf(flat), max = maxOf(flat);
    const norm = o.normalize === false ? null : (max > min ? [min, max] : null);
    data = flat.map((v) => (norm ? ((v - min) / (max - min)) * 255 : v));
    channels = 1;
    if (norm) meta.push(`标量值域归一化: ${min} .. ${max} → 0..255`);
  }

  // 宽度：显式参数优先；未给且是通道数据时按「行边界连续性」推断（不用 √n，那只对正方形成立）
  let useWidth = Math.floor(o.width || 0);
  if (!useWidth && kind === "channels") {
    const inf = inferWidth(data, channels);
    if (inf.width) {
      useWidth = inf.width;
      const pct = Math.round(inf.confidence * 100);
      meta.push(`宽度自动推断: ${useWidth}（置信度 ${pct}%；候选宽度代价排序 ${inf.candidates.map((c) => c[0]).join(" / ")}）`);
      if (inf.confidence < 0.15) {
        meta.push("⚠ 置信度低：多个候选宽度代价接近，推断可能不正确 —— 请用「宽度」参数显式指定。");
      }
    }
  }

  const rendered = renderChannels(data, {
    width: useWidth,
    channels,
    order: o.order,
    scan: o.scan,
    scale: Math.max(1, Math.floor(o.scale || 1)),
    invertY: !!o.invertY,
    range: kind === "channels" && o._range ? o._range : null,
  });
  meta.push(`通道数: ${channels}`);
  return toPngResult(rendered, meta);
}

register({
  id: "dataToImage",
  cat: "image", family: "render", familyLabel: "data",
  name: "数值数据渲染成图",
  desc: "把「一行一个像素 / 一行一个坐标 / 一行一个数」的数值文本渲染成 PNG：自动判形态（RGB(A) 通道、坐标点集、"
      + "标量网格、0/1 位流），自动推导宽高（平方根或按行数），可选放大、通道顺序、y 轴方向、点集连线。"
      + "布局为显式声明，判定依据写进报告，可人工纠正。输出走产物协议直接下载。",
  params: [
    { key: "kind", label: "数据形态", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动判定" },
        { value: "channels", label: "RGB(A) 通道" },
        { value: "points", label: "坐标点集" },
        { value: "grid", label: "标量网格" },
        { value: "bits", label: "0/1 位流" },
      ] },
    { key: "width", label: "宽度（0=自动）", type: "number", default: 0, placeholder: "0=按行边界连续性自动推断" },
    { key: "scan", label: "扫描序", type: "select", default: "row",
      options: [
        { value: "row", label: "行主序（先横后纵）" },
        { value: "column", label: "列主序（先纵后横，产出为转置）" },
      ] },
    { key: "channels", label: "通道数（0=自动）", type: "number", default: 0 },
    { key: "order", label: "通道顺序", type: "select", default: "rgb",
      options: [{ value: "rgb", label: "RGB" }, { value: "bgr", label: "BGR" }] },
    { key: "scale", label: "放大倍数", type: "number", default: 1 },
    { key: "invertY", label: "y 轴向上（数学坐标）", type: "bool", default: false },
    { key: "connect", label: "点集连线（折线）", type: "bool", default: false },
    { key: "normalize", label: "标量按值域归一化", type: "bool", default: true },
  ],
  run: dataToImageRun,
});
