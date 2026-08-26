/*
 * hexview.js — 十六进制查看器数据层（T91，cat:'analysis'）。
 *
 * 覆盖（全部 run 单向，返回多行报告文本；核心纯函数 export 供 UI 复用）：
 * - hexView：经典 hexdump（偏移 | hex 字节 | ASCII），支持高亮区间标记
 * - hexRange：指定偏移区间字节的多格式展示（hex/dec/oct/bin/ASCII/UTF-8）
 * - hexStats：字节值分布统计（256 桶密度网格 + 可打印率 + 全局/滑窗香农熵 + top-N 高频）
 *   T349 增强：滑窗熵曲线（分块窗口熵随偏移变化，文本块字符条，定位加密/压缩/内嵌区）
 *   + 字节分布图（16×16 密度网格，对数分档，256 桶全覆盖）
 *
 * 纯函数 export（供 UI hex viewer 数据层复用）：
 * - buildHexRows(bytes, opts) → {offset, hexCols, asciiCol, startIndex, endIndex}[]
 * - computeHighlight(bytes, ranges) → boolean[]（每字节是否高亮）
 * - formatHexDump(bytes, opts) → 多行文本
 * - byteStats(bytes) → 统计对象（含 counts 256 桶原始计数）
 * - entropyCurve(bytes, window) → 分块窗口熵序列
 *
 * 二进制输入复用 compress.js 的 inputToBytes（hex/base64/utf8 auto）。
 * 红线：照 xxd/hexdump -C 经典格式实现，不编造。
 */
import { register } from "./registry.js";
import { inputToBytes } from "./compress.js";

const INPUT_ENC_PARAM = {
  key: "inputEnc", label: "输入编码", type: "select", default: "auto",
  options: [
    { value: "auto", label: "自动（hex/base64/UTF-8）" },
    { value: "hex", label: "Hex" },
    { value: "base64", label: "Base64" },
    { value: "utf8", label: "UTF-8 文本" },
  ],
};

// ============ 通用工具 ============
function isPrintable(b) { return b >= 0x20 && b <= 0x7E; }
function asciiChar(b) { return isPrintable(b) ? String.fromCharCode(b) : "."; }
function padHex(n, len) { return n.toString(16).padStart(len, "0"); }
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/** 解析高亮区间参数字符串 "start-end" 或 "start,end;start,end" 为 [{start,end}] 数组。 */
function parseRanges(param) {
  if (param == null) return [];
  const s = String(param).trim();
  if (!s) return [];
  const out = [];
  const parts = s.split(/[;\n]/);
  for (const part of parts) {
    const t = part.trim();
    if (!t) continue;
    const m = t.match(/^(-?\d+|0x[0-9a-fA-F]+)\s*[-,到]\s*(-?\d+|0x[0-9a-fA-F]+)$/);
    if (m) {
      const a = parseNum(m[1]);
      const b = parseNum(m[2]);
      if (a <= b) out.push({ start: a, end: b });
      else out.push({ start: b, end: a });
    } else {
      const single = parseNum(t);
      if (!Number.isNaN(single)) out.push({ start: single, end: single });
    }
  }
  return out;
}
function parseNum(s) {
  const t = String(s).trim();
  if (/^0x[0-9a-fA-F]+$/.test(t)) return parseInt(t.slice(2), 16);
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  return NaN;
}

// ============ 核心数据层：buildHexRows ============
/**
 * 构造 hex view 行数据（纯函数，供 UI 直接渲染）。
 * @param {Uint8Array} bytes
 * @param {object} opts - {bytesPerLine=16}
 * @returns {Array<{offset:number, hexCols:string[], asciiCol:string, startIndex:number, endIndex:number}>}
 */
export function buildHexRows(bytes, opts = {}) {
  const bpl = opts.bytesPerLine || 16;
  const rows = [];
  const len = bytes.length;
  for (let i = 0; i < len; i += bpl) {
    const end = Math.min(i + bpl, len);
    const hexCols = [];
    const asciiChars = [];
    for (let j = i; j < end; j++) {
      hexCols.push(padHex(bytes[j], 2));
      asciiChars.push(asciiChar(bytes[j]));
    }
    rows.push({
      offset: i,
      hexCols,
      asciiCol: asciiChars.join(""),
      startIndex: i,
      endIndex: end - 1,
    });
  }
  if (len === 0) {
    rows.push({ offset: 0, hexCols: [], asciiCol: "", startIndex: 0, endIndex: -1 });
  }
  return rows;
}

/**
 * 计算每字节是否在高亮区间内（纯函数）。
 * @param {Uint8Array} bytes
 * @param {Array<{start:number,end:number}>} ranges
 * @returns {boolean[]}
 */
export function computeHighlight(bytes, ranges) {
  const marks = new Array(bytes.length).fill(false);
  for (const r of ranges) {
    const s = clamp(r.start, 0, bytes.length - 1);
    const e = clamp(r.end, 0, bytes.length - 1);
    for (let i = s; i <= e; i++) marks[i] = true;
  }
  return marks;
}

/**
 * 格式化 hexdump 文本（hexdump -C 风格）。
 * 高亮字节：hex 列大写；ASCII 列字符不变（对齐保持）。
 * @param {Uint8Array} bytes
 * @param {object} opts - {bytesPerLine=16, highlightRanges=[], showOffset=true, showAscii=true, maxLines=0(无限制)}
 * @returns {string} 多行文本
 */
export function formatHexDump(bytes, opts = {}) {
  const bpl = opts.bytesPerLine || 16;
  const ranges = opts.highlightRanges || [];
  const showOffset = opts.showOffset !== false;
  const showAscii = opts.showAscii !== false;
  const maxLines = opts.maxLines || 0;
  const len = bytes.length;
  if (len === 0) return "(空输入，0 字节)";
  const offsetWidth = Math.max(8, len.toString(16).length);
  const hl = computeHighlight(bytes, ranges);
  const lines = [];
  let lineCount = 0;
  for (let i = 0; i < len; i += bpl) {
    if (maxLines > 0 && lineCount >= maxLines) {
      lines.push(`…(已显示 ${lineCount} 行，剩余 ${Math.ceil((len - i) / bpl)} 行省略)`);
      break;
    }
    const end = Math.min(i + bpl, len);
    const off = showOffset ? padHex(i, offsetWidth) + ": " : "";
    let hexPart = "";
    let ascii = showAscii ? "|" : "";
    for (let j = i; j < i + bpl; j++) {
 // 中间分组分隔（8 字节后多一个空格）
      if (j === i + bpl / 2) hexPart += " ";
      if (j < end) {
        const h = hl[j] ? padHex(bytes[j], 2).toUpperCase() : padHex(bytes[j], 2);
        hexPart += h + " ";
        ascii += asciiChar(bytes[j]);
      } else {
        hexPart += "   ";
        ascii += " ";
      }
    }
    hexPart = hexPart.replace(/\s+$/, "");
    let line = off + hexPart;
    if (showAscii) line += "  " + ascii + "|";
    lines.push(line);
    lineCount++;
  }
  return lines.join("\n");
}

// ============ hexRange：区间多格式展示 ============
/**
 * 提取指定偏移区间的字节，多格式展示。
 * @param {Uint8Array} bytes
 * @param {number} start
 * @param {number} end
 * @returns {string} 多行文本
 */
export function formatRange(bytes, start, end) {
  const len = bytes.length;
  const s = clamp(start, 0, len - 1);
  const e = clamp(end, 0, len - 1);
  if (len === 0 || s > e) return "区间无效或输入为空";
  const slice = bytes.slice(s, e + 1);
  const n = slice.length;
  const hex = Array.from(slice, (b) => padHex(b, 2)).join(" ");
  const dec = Array.from(slice, (b) => String(b).padStart(3, " ")).join(" ");
  const oct = Array.from(slice, (b) => b.toString(8).padStart(3, "0")).join(" ");
  const bin = Array.from(slice, (b) => b.toString(2).padStart(8, "0")).join(" ");
  const ascii = Array.from(slice, asciiChar).join("");
  let utf8 = "";
  try {
    utf8 = new TextDecoder("utf-8", { fatal: false }).decode(slice);
  } catch {
    utf8 = "(无法解码为 UTF-8)";
  }
  const lines = [
    `偏移区间: 0x${padHex(s, 4)} - 0x${padHex(e, 4)} (${n} 字节)`,
    `Hex   : ${hex}`,
    `Dec   : ${dec}`,
    `Oct   : ${oct}`,
    `Bin   : ${bin}`,
    `ASCII : ${ascii}`,
    `UTF-8 : ${utf8}`,
  ];
  return lines.join("\n");
}

// ============ hexStats：字节分布统计 ============
/**
 * 计算字节统计信息（纯函数）。
 * @param {Uint8Array} bytes
 * @returns {object} {total, printable, printableRatio, nullCount, entropy, counts, buckets, top}
 */
export function byteStats(bytes) {
  const total = bytes.length;
  const counts = new Array(256).fill(0);
  let printable = 0;
  let nullCount = 0;
  for (const b of bytes) {
    counts[b]++;
    if (isPrintable(b) || b === 0x09 || b === 0x0A || b === 0x0D) printable++;
    if (b === 0) nullCount++;
  }
  let entropy = 0;
  if (total > 0) {
    for (const c of counts) {
      if (c > 0) {
        const p = c / total;
        entropy -= p * Math.log2(p);
      }
    }
  }
  const buckets = [
    { range: "0x00-0x1F (控制字符)", count: 0 },
    { range: "0x20-0x7E (可打印 ASCII)", count: 0 },
    { range: "0x7F-0xFF (高字节/扩展)", count: 0 },
  ];
  for (let v = 0; v < 256; v++) {
    if (v <= 0x1F) buckets[0].count += counts[v];
    else if (v <= 0x7E) buckets[1].count += counts[v];
    else buckets[2].count += counts[v];
  }
  const top = counts
    .map((c, v) => ({ value: v, count: c }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count || a.value - b.value)
    .slice(0, 16);
  return {
    total,
    printable,
    printableRatio: total > 0 ? printable / total : 0,
    nullCount,
    entropy,
    counts,
    buckets,
    top,
  };
}

// ============ 滑窗熵曲线（T349） ============
/** 一段字节的香农熵（bits/byte，0..8），复用与 byteStats 相同的频数法。 */
function shannonChunk(bytes, start, end) {
  const n = end - start;
  if (n <= 0) return 0;
  const freq = new Array(256).fill(0);
  for (let i = start; i < end; i++) freq[bytes[i]]++;
  let h = 0;
  for (const c of freq) {
    if (c > 0) {
      const p = c / n;
      h -= p * Math.log2(p);
    }
  }
  return h;
}

/**
 * 分块窗口香农熵序列（纯函数）：按窗口大小把字节流切成不重叠的段，
 * 每段独立算熵，熵随偏移的变化即"熵曲线"——用于定位加密/压缩区（高熵）
 * 与文本/填充区（低熵）的边界。尾窗不足 window 字节照常计算。
 * @param {Uint8Array} bytes
 * @param {number} window 段窗口字节数（<1 按 256；参数层另有 16..65536 clamp）
 * @returns {{window:number, chunks:Array<{offset:number, entropy:number}>}}
 */
export function entropyCurve(bytes, window) {
  let w = Math.max(1, Math.floor(Number(window) || 256));
  const chunks = [];
  for (let i = 0; i < bytes.length; i += w) {
    chunks.push({ offset: i, entropy: shannonChunk(bytes, i, Math.min(i + w, bytes.length)) });
  }
  return { window: w, chunks };
}

// 熵 → 8 级竖块字符（0→▁ … 8→█）
const ENTROPY_BARS = "▁▂▃▄▅▆▇█";
function entropyBar(e) {
  const idx = clamp(Math.round((e / 8) * 7), 0, 7);
  return ENTROPY_BARS[idx];
}

const CURVE_COLS = 64;   // 每行 64 段
const CURVE_MAX_ROWS = 32; // 最多 32 行（2048 段），超出截断提示

/** 熵曲线文本渲染：每行 CURVE_COLS 段块字符，行首标该行首段偏移。 */
function renderEntropyCurve(curve) {
  const { window, chunks } = curve;
  if (chunks.length === 0) return "（无数据）";
  const offW = Math.max(4, chunks[chunks.length - 1].offset.toString(16).length);
  const lines = [];
  const shownRows = Math.min(CURVE_MAX_ROWS, Math.ceil(chunks.length / CURVE_COLS));
  for (let r = 0; r < shownRows; r++) {
    const row = chunks.slice(r * CURVE_COLS, (r + 1) * CURVE_COLS);
    lines.push("0x" + padHex(row[0].offset, offW) + " " + row.map((c) => entropyBar(c.entropy)).join(""));
  }
  if (chunks.length > CURVE_COLS * CURVE_MAX_ROWS) {
    lines.push(`…（共 ${chunks.length} 段，已显示前 ${CURVE_COLS * CURVE_MAX_ROWS} 段，可增大窗口看全貌）`);
  }
  return lines.join("\n");
}

// ============ 字节分布图：16×16 密度网格（T349） ============
// 密度 6 级：空格(0 次) · ░ ▒ ▓ █(最高)；对数分档——大文件里桶计数跨数量级，
// 线性映射会全挤在最低档，log 压缩后各数量级各占一档。
const DENSITY_CHARS = "·░▒▓█";
function densityChar(count, maxCount) {
  if (count <= 0) return " ";
  if (maxCount <= 1) return DENSITY_CHARS[0];
  const ratio = Math.log(count) / Math.log(maxCount); // count<=max 恒成立 → 0..1
  const lvl = clamp(1 + Math.floor(ratio * 4), 1, 5);
  return DENSITY_CHARS[lvl - 1];
}

/**
 * 256 桶字节分布密度网格：16 行（0x00-0x0F … 0xF0-0xFF）× 16 列，
 * 行首标签标桶基值，格字符表该桶计数档位。
 * @param {number[]} counts 长度 256 的桶计数
 * @returns {string} 多行文本
 */
function renderHistogramGrid(counts) {
  const maxCount = Math.max(...counts);
  const lines = [];
  for (let row = 0; row < 16; row++) {
    const base = row * 16;
    const cells = [];
    for (let col = 0; col < 16; col++) cells.push(densityChar(counts[base + col], maxCount));
    lines.push("0x" + padHex(base, 2) + " " + cells.join(""));
  }
  lines.push(`图例: 空=0 次 · ░▒▓█ 逐档升高（对数分档，█=最高 ${maxCount} 次）`);
  return lines.join("\n");
}

function formatStats(bytes, opts = {}) {
  const s = byteStats(bytes);
  if (s.total === 0) return "(空输入，0 字节)";
  const pct = (n) => (n / s.total * 100).toFixed(2) + "%";
  const showCurve = opts.showCurve !== false;
  const showHist = opts.showHist !== false;
  const lines = [
    `总字节数: ${s.total}`,
    `可打印率: ${(s.printableRatio * 100).toFixed(2)}% (${s.printable}/${s.total})`,
    `空字节(0x00): ${s.nullCount} (${pct(s.nullCount)})`,
    `香农熵: ${s.entropy.toFixed(4)} bits/byte (随机字节≈8.0，英语≈4.0-4.5)`,
  ];
  if (showCurve) {
    const curve = entropyCurve(bytes, opts.window);
    const n = curve.chunks.length;
    if (n > 0) {
      const avg = curve.chunks.reduce((a, c) => a + c.entropy, 0) / n;
      const max = curve.chunks.reduce((a, c) => Math.max(a, c.entropy), 0);
      lines.push(
        ``,
        `滑窗熵曲线（窗口 ${curve.window} 字节 · ${n} 段 · 平均熵 ${avg.toFixed(2)} · 峰值 ${max.toFixed(2)} bits/byte）:`,
        renderEntropyCurve(curve),
        `（接近 8 = 加密/压缩，低 = 文本/填充；看竖块突变处即结构边界）`,
      );
    }
  }
  if (showHist) {
    lines.push(
      ``,
      `字节分布图（16×16 密度网格，行=高 4 位，列=低 4 位）:`,
      renderHistogramGrid(s.counts),
    );
  }
  lines.push(
    ``,
    `字节值分布桶:`,
    ...s.buckets.map((b) => `  ${b.range}: ${b.count} (${pct(b.count)})`),
    ``,
    `高频字节 (top ${s.top.length}):`,
    ...s.top.map((t) => {
      const ch = asciiChar(t.value);
      const label = isPrintable(t.value) ? `'${ch}'` : "(非可打印)";
      return `  0x${padHex(t.value, 2)} (${String(t.value).padStart(3, " ")} ${label}) × ${t.count} (${pct(t.count)})`;
    }),
  );
  return lines.join("\n");
}

// ============ op run 包装 ============
function runHexView(text, p) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : inputToBytes(text, p);
  const bpl = Number((p && p.bytesPerLine) || 16);
  const ranges = parseRanges(p && p.highlight);
  const maxLines = Number((p && p.maxLines) || 0);
  const header = `十六进制查看（${bytes.length} 字节，每行 ${bpl} 字节）`;
  let rangeInfo = "";
  if (ranges.length > 0) {
    rangeInfo = "\n高亮区间: " + ranges.map((r) => `0x${padHex(r.start, 4)}-0x${padHex(r.end, 4)}`).join("; ") +
      ` (${ranges.reduce((a, r) => a + (r.end - r.start + 1), 0)} 字节，hex 列大写标记)`;
  }
  const dump = formatHexDump(bytes, { bytesPerLine: bpl, highlightRanges: ranges, showOffset: true, showAscii: true, maxLines });
  return header + rangeInfo + "\n" + dump;
}

function runHexRange(text, p) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : inputToBytes(text, p);
  const start = parseNum((p && p.start) ?? 0);
  const endInput = (p && p.end);
  const end = (endInput == null || endInput === "") ? Math.max(0, bytes.length - 1) : parseNum(endInput);
  return formatRange(bytes, start, end);
}

function runHexStats(text, p) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : inputToBytes(text, p);
  // 窗口 clamp：16..65536（窗口太小段数爆炸，太大曲线失焦；非数字回默认 256）
  const w = Number(p && p.window);
  const window = (!Number.isFinite(w) || w <= 0) ? 256 : clamp(Math.floor(w), 16, 65536);
  const showCurve = !(p && p.showCurve === false);
  const showHist = !(p && p.showHist === false);
  return formatStats(bytes, { window, showCurve, showHist });
}

// ============ 注册 ============
register({
  id: "hexView", cat: "data", name: "十六进制查看器",
  desc: "经典 hexdump（偏移 | hex 字节 | ASCII），支持高亮区间标记（hex 列大写）",
  params: [
    INPUT_ENC_PARAM,
    { key: "bytesPerLine", label: "每行字节数", type: "select", default: "16",
      options: [
        { value: "8", label: "8" },
        { value: "16", label: "16" },
        { value: "32", label: "32" },
      ],
    },
    { key: "highlight", label: "高亮区间（如 0x10-0x1f 或 5,10;20-30）", type: "text", default: "", placeholder: "start-end 或 start,end;..." },
    { key: "maxLines", label: "最多显示行数（0=不限）", type: "number", default: 0, placeholder: "0=不限" },
  ],
  run: runHexView,
  acceptsBytes: true,
});

register({
  id: "hexRange", cat: "data", name: "Hex 区间提取",
  desc: "提取指定偏移区间的字节，多格式展示（hex/dec/oct/bin/ASCII/UTF-8）",
  params: [
    INPUT_ENC_PARAM,
    { key: "start", label: "起始偏移（支持 0x 前缀）", type: "text", default: "0", placeholder: "0 或 0x10" },
    { key: "end", label: "结束偏移（含，支持 0x 前缀）", type: "text", default: "", placeholder: "留空=到末尾" },
  ],
  run: runHexRange,
  acceptsBytes: true,
});

register({
  id: "hexStats", cat: "data", name: "字节分布统计",
  desc: "字节值分布（256 桶密度网格/3 桶）+ 可打印率 + 全局/滑窗香农熵（曲线定位加密/压缩区）+ top-N 高频字节",
  params: [
    INPUT_ENC_PARAM,
    { key: "window", label: "熵曲线窗口（字节，16-65536）", type: "number", default: 256, placeholder: "256" },
    { key: "showCurve", label: "显示滑窗熵曲线", type: "bool", default: true },
    { key: "showHist", label: "显示字节分布图（16×16 网格）", type: "bool", default: true },
  ],
  run: runHexStats,
  acceptsBytes: true,
});

export { parseRanges, parseNum };

// ============ 加载期自检（T349 增强，import 即跑，失败即抛） ============
(function selfTest() {
  const assert = (cond, msg) => { if (!cond) throw new Error("hexview 自检失败: " + msg); };
  // 固定种子 LCG：确定性伪随机字节（统计上近似均匀 → 高熵）
  const lcgBytes = (n, seed) => {
    let s = seed >>> 0;
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) { s = (s * 1664525 + 1013904223) >>> 0; out[i] = (s >>> 24) & 0xff; }
    return out;
  };
  // ① 全 0x00 → 每段熵 0
  {
    const c = entropyCurve(new Uint8Array(512).fill(0), 256);
    assert(c.chunks.length === 2 && c.chunks.every((x) => x.entropy === 0), "全零熵应为 0");
  }
  // ② 伪随机 → 每段熵接近满值（>7.0）
  {
    const c = entropyCurve(lcgBytes(1024, 42), 256);
    assert(c.chunks.length === 4 && c.chunks.every((x) => x.entropy > 7.0), "随机段熵应 >7.0，实测 " + c.chunks.map((x) => x.entropy.toFixed(2)).join(","));
  }
  // ③ 半低熵半高熵 → 曲线定位边界（段[0]≈0，段[1] 高，边界在 0x100）
  {
    const b = new Uint8Array(512);
    b.fill(0x41, 0, 256);
    b.set(lcgBytes(256, 7), 256);
    const c = entropyCurve(b, 256);
    assert(c.chunks[0].entropy === 0 && c.chunks[1].entropy > 7.0, "边界定位失败");
  }
  // ④ 级别映射端点：0→▁，8→█
  assert(entropyBar(0) === "▁" && entropyBar(8) === "█", "熵条端点映射错");
  // ⑤ 尾窗不足 window 照常计算（11 字节 / 窗 8 → 2 段）
  {
    const c = entropyCurve(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), 8);
    assert(c.chunks.length === 2 && c.chunks[1].offset === 8, "尾窗切分错");
  }
  // ⑥ 密度网格：全零计数 → 数据格全空格；单桶顶格 → 该桶 █（对数分档顶档）
  {
    const g0 = renderHistogramGrid(new Array(256).fill(0));
    assert(/^0x00 *$/m.test(g0.split("\n")[0]), "零计数应全空格");
    const counts = new Array(256).fill(0);
    counts[0x41] = 10000; counts[0x00] = 1;
    const g1 = renderHistogramGrid(counts);
    const row4 = g1.split("\n")[4]; // 0x40 行：行首"0x40 "(5 字符)后为 0x40..0x4F 桶
    assert(row4[6] === "█" && row4[5] === " ", "最高桶应 █，实测行: " + row4);
  }
  // ⑦ byteStats 既有统计回归（不破坏 T91 行为）+ 新增 counts
  {
    const s = byteStats(new Uint8Array([0, 0, 1]));
    assert(Math.abs(s.entropy - 0.9183) < 0.0001 && s.nullCount === 2 && s.counts.length === 256 && s.counts[1] === 1, "byteStats 回归错");
  }
  // ⑧ formatStats 默认含两视图；关掉即无
  {
    const b = lcgBytes(300, 9);
    const r = formatStats(b);
    assert(r.includes("滑窗熵曲线") && r.includes("字节分布图"), "默认应含两视图");
    const r2 = formatStats(b, { showCurve: false, showHist: false });
    assert(!r2.includes("滑窗熵曲线") && !r2.includes("字节分布图"), "开关应生效");
    assert(formatStats(new Uint8Array(0)) === "(空输入，0 字节)", "空输入提示错");
  }
  // ⑨ 段数超上限截断（200KB / 窗 16 → 12800 段 > 2048）
  {
    const c = entropyCurve(lcgBytes(200 * 1024, 3), 16);
    const r = renderEntropyCurve(c);
    assert(r.includes("已显示前 2048 段") && r.split("\n").length === 33, "截断提示/行数错");
  }
})();
