/*
 * hexview.js — 十六进制查看器数据层（T91，cat:'analysis'）。
 *
 * 覆盖（全部 run 单向，返回多行报告文本；核心纯函数 export 供 UI 复用）：
 * - hexView：经典 hexdump（偏移 | hex 字节 | ASCII），支持高亮区间标记
 * - hexRange：指定偏移区间字节的多格式展示（hex/dec/oct/bin/ASCII/UTF-8）
 * - hexStats：字节值分布统计（256 桶 + 可打印率 + 香农熵 + top-N 高频）
 *
 * 纯函数 export（供 UI hex viewer 数据层复用）：
 * - buildHexRows(bytes, opts) → {offset, hexCols, asciiCol, startIndex, endIndex}[]
 * - computeHighlight(bytes, ranges) → boolean[]（每字节是否高亮）
 * - formatHexDump(bytes, opts) → 多行文本
 * - byteStats(bytes) → 统计对象
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
 * @returns {object} {total, printable, printableRatio, nullCount, entropy, buckets, top}
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
    buckets,
    top,
  };
}

function formatStats(bytes) {
  const s = byteStats(bytes);
  if (s.total === 0) return "(空输入，0 字节)";
  const pct = (n) => (n / s.total * 100).toFixed(2) + "%";
  const lines = [
    `总字节数: ${s.total}`,
    `可打印率: ${(s.printableRatio * 100).toFixed(2)}% (${s.printable}/${s.total})`,
    `空字节(0x00): ${s.nullCount} (${pct(s.nullCount)})`,
    `香农熵: ${s.entropy.toFixed(4)} bits/byte (随机字节≈8.0，英语≈4.0-4.5)`,
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
  ];
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
  return formatStats(bytes);
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
  desc: "字节值分布（256 桶/3 桶）+ 可打印率 + 香农熵 + top-N 高频字节",
  params: [INPUT_ENC_PARAM],
  run: runHexStats,
  acceptsBytes: true,
});

export { parseRanges, parseNum };
