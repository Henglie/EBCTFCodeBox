/*
 * lsbDeep.js — LSB 深度分析（R6，纯算法层，零 UI 依赖）。
 *
 * 与 zstegScan 的区别：zstegScan 默认只看 bit0 / 行优先，本模块把
 *   通道 {R,G,B,A,RGB,BGR,RGBA,BGRA}
 * × 位平面 0..7
 * × 遍历 {行优先, 列优先}
 * × 位序 {MSB-first, LSB-first}
 * × 字节边界/起始位偏移 0..7 bit
 * 全部走一遍，并对每个组合提取文本、可打印率、英文评分、flag/base64/URL 形态。
 *
 * 性能策略：
 * - 每组合先只抽探测前缀（默认 768B；大图 384B），排序后只对靠前候选重抽
 *   detailBytes（默认 8192B），避免全图 × 全组合的平方级开销。
 * - 像素数 > 1MP 时自动缩短探测前缀、限制返回候选数；>16MP 直接返回空数组 +
 *   原因（可在 opts.maxPixels 覆盖），不冒卡死风险。
 * - 单图常规尺寸目标 <800ms；返回数组的 meta.elapsedMs 记录实际耗时。
 *
 * 失败语义：不抛异常，返回空数组，`arr.reason` 给出原因；成功时 `arr.meta`
 * 记录尺寸/组合数/耗时等（二者均为数组附加属性，JSON 序列化时丢失）。
 *
 * 候选字段：
 *   { channel, channelIndices, bit, order, scan, offset, text, preview,
 *     cleanText, cleanLength, printableRatio, visibleRatio, score,
 *     flags, base64, url, encoding, lengthBytes, note, previewPng? }
 *   - channel: "r"|"g"|"b"|"a"|"rgb"|"bgr"|"rgba"|"bgra"
 *   - order: "msb"|"lsb"（8 个比特拼字节时的高低位顺序）
 *   - scan: "row"|"col"
 *   - offset: 起始跳过比特数（字节边界，0..7）
 *   - previewPng: 仅 opts.includePreviews=true 时给出 data:image/png;base64
 *
 * 导出：
 *   lsbDeepScan(bytes, opts) -> Candidate[]（附加 meta/reason）
 *   lsbDeepRenderCandidate(cand, bytes?, opts?) -> {width,height,png,dataURL}
 *   lsbDeepExport(cand, bytes?, opts?) -> Uint8Array
 *     opts.format: "raw"（默认，该组合完整载荷字节）| "text" | "png"
 *
 * `lsbDeepRenderCandidate` / `lsbDeepExport` 的 bytes 可省略：候选若由
 * lsbDeepScan 产生，内部保留只读像素引用（非枚举 _source）；也可先传 bytes。
 */
import { decodePNG, encodePNG, rgbaToDataURL } from "./stegoPixels.js";
import { decodeBmpPixels } from "./lsbExtract.js";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const DEFAULT_LIMIT = 40;
const LARGE_LIMIT = 24;
const DEFAULT_PROBE = 768;
const LARGE_PROBE = 384;
const DEFAULT_DETAIL = 8192;
const DEFAULT_MAX_TEXT = 4096;
const DEFAULT_PREVIEW_LIMIT = 8;
const DEFAULT_PREVIEW_SIDE = 256;
const DEFAULT_MAX_PIXELS = 16_000_000;
const DEFAULT_LARGE_PIXELS = 1_000_000;
const DEFAULT_EXPORT_BYTES = 1024 * 1024;

export const LSB_DEEP_CHANNEL_COMBOS = [
  ["r", [0]],
  ["g", [1]],
  ["b", [2]],
  ["a", [3]],
  ["rgb", [0, 1, 2]],
  ["bgr", [2, 1, 0]],
  ["rgba", [0, 1, 2, 3]],
  ["bgra", [2, 1, 0, 3]],
];

const DEFAULT_FLAG_RE = /[A-Za-z0-9][A-Za-z0-9_]{0,31}\{[ -~]{4,200}?\}/g;
const FLAG_CONTENT_RE = /[A-Za-z0-9_]/g;
const URL_RE = /\b(?:(?:https?|ftp):\/\/|www\.)[^\s"'<>]{4,}/gi;
const UTF8 = new TextDecoder("utf-8", { fatal: false });
const UTF8_FATAL = new TextDecoder("utf-8", { fatal: true });
const LATIN1 = new TextDecoder("latin1");

const now = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

let lastSource = null;

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (Array.isArray(input)) return Uint8Array.from(input);
  return null;
}

function isPng(b) {
  if (!b || b.length < 8) return false;
  for (let i = 0; i < 8; i++) if (b[i] !== PNG_SIG[i]) return false;
  return true;
}

function isBmp(b) {
  return !!b && b.length >= 54 && b[0] === 0x42 && b[1] === 0x4d;
}

function peekDimensions(b) {
  try {
    if (isPng(b)) {
      const w = ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0;
      const h = ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0;
      return w && h ? { width: w, height: h } : null;
    }
    if (isBmp(b)) {
      const w = (b[18] | (b[19] << 8) | (b[20] << 16) | (b[21] * 0x1000000)) | 0;
      const h = (b[22] | (b[23] << 8) | (b[24] << 16) | (b[25] * 0x1000000)) | 0;
      return w && h ? { width: Math.abs(w), height: Math.abs(h) } : null;
    }
  } catch {
    return null;
  }
  return null;
}

function decodeSource(input) {
  const bytes = asBytes(input);
  if (!bytes || bytes.length < 8) return { ok: false, reason: "输入为空或不是图片字节" };
  if (isPng(bytes)) {
    try {
      const img = decodePNG(bytes);
      if (!img || !img.width || !img.height) return { ok: false, reason: "PNG 解码结果为空" };
      return {
        ok: true,
        source: { width: img.width, height: img.height, channels: 4, samples: img.data, format: "png" },
      };
    } catch (e) {
      return { ok: false, reason: "PNG 解码失败：" + (e && e.message ? e.message : String(e)) };
    }
  }
  if (isBmp(bytes)) {
    const dec = decodeBmpPixels(bytes);
    if (!dec) return { ok: false, reason: "BMP 解码失败" };
    if (dec.unsupported) return { ok: false, reason: "BMP 解码失败：" + dec.unsupported };
    return {
      ok: true,
      source: { width: dec.width, height: dec.height, channels: dec.channels, samples: dec.samples, format: "bmp" },
    };
  }
  return { ok: false, reason: "不支持的图片格式（仅 PNG / BMP；JPEG 等有损格式无稳定 LSB 平面）" };
}

function resolveSource(input, cand) {
  if (input && typeof input === "object" && input.width > 0 && input.height > 0 && input.samples) return input;
  if (input != null) {
    const dec = decodeSource(input);
    if (!dec.ok) throw new Error(dec.reason);
    return dec.source;
  }
  if (cand && cand._source) return cand._source;
  if (lastSource) return lastSource;
  throw new Error("缺少图像字节：请传入 bytes，或使用 lsbDeepScan 返回的候选");
}

function clampInt(v, lo, hi, fallback) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function intList(value, lo, hi, fallback) {
  if (!Array.isArray(value) || value.length === 0) return fallback.slice();
  const out = [];
  for (const v of value) {
    const n = Math.floor(Number(v));
    if (Number.isFinite(n) && n >= lo && n <= hi && !out.includes(n)) out.push(n);
  }
  return out.length ? out : fallback.slice();
}

function normalizeScans(value) {
  if (!Array.isArray(value) || value.length === 0) return ["row", "col"];
  const out = [];
  for (const v of value) {
    const s = String(v).toLowerCase();
    const normalized = s === "col" || s === "column" || s === "列" || s === "列优先" ? "col" : s === "row" || s === "行" ? "row" : null;
    if (normalized && !out.includes(normalized)) out.push(normalized);
  }
  return out.length ? out : ["row", "col"];
}

function normalizeOrders(value) {
  if (!Array.isArray(value) || value.length === 0) return ["msb", "lsb"];
  const out = [];
  for (const v of value) {
    const s = String(v).toLowerCase();
    if ((s === "msb" || s === "msbfirst" || s === "msb-first" || s === "高位先") && !out.includes("msb")) out.push("msb");
    if ((s === "lsb" || s === "lsbfirst" || s === "lsb-first" || s === "低位先") && !out.includes("lsb")) out.push("lsb");
  }
  return out.length ? out : ["msb", "lsb"];
}

function resolveCombos(sourceChannels, requested) {
  const list = Array.isArray(requested) && requested.length ? requested : LSB_DEEP_CHANNEL_COMBOS;
  const out = [];
  const seen = new Set();
  for (const item of list) {
    let name = null;
    let idxs = null;
    if (typeof item === "string") {
      const def = LSB_DEEP_CHANNEL_COMBOS.find(([n]) => n === item.toLowerCase());
      if (!def) continue;
      [name, idxs] = def;
    } else if (Array.isArray(item) && item.length === 2 && Array.isArray(item[1])) {
      name = String(item[0]);
      idxs = item[1].map((v) => Math.floor(Number(v))).filter((v) => Number.isFinite(v));
    }
    if (!name || !idxs) continue;
    const eff = idxs.filter((c) => c >= 0 && c < sourceChannels);
    if (!eff.length) continue;
    const key = eff.join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, idxs: eff });
  }
  return out;
}

function comboForCandidate(cand, sourceChannels) {
  if (cand && Array.isArray(cand.channelIndices) && cand.channelIndices.length) {
    const idxs = cand.channelIndices.map((v) => Math.floor(Number(v))).filter((v) => Number.isFinite(v) && v >= 0 && v < sourceChannels);
    if (idxs.length) return { name: cand.channel || idxs.join(""), idxs };
  }
  const name = String(cand?.channel || "").toLowerCase();
  const def = LSB_DEEP_CHANNEL_COMBOS.find(([n]) => n === name);
  if (!def) return null;
  const idxs = def[1].filter((c) => c < sourceChannels);
  return idxs.length ? { name: def[0], idxs } : null;
}

/**
 * 按组合抽比特 → 字节。offset 为起始跳过的比特数（字节边界 0..7）。
 * 返回字节数受 maxBytes 与图像容量双重限制。
 */
function extractBits(source, idxs, bit, scan, order, offset, maxBytes) {
  const { width, height, channels, samples } = source;
  const totalPx = width * height;
  const totalBits = totalPx * idxs.length;
  const available = Math.max(0, totalBits - offset);
  const cap = Math.max(0, Math.min(Number.isFinite(maxBytes) ? Math.floor(maxBytes) : Infinity, Math.floor(available / 8)));
  const out = new Uint8Array(cap);
  if (cap === 0) return out;
  const col = scan === "col";
  const lsb = order === "lsb";
  let skip = offset;
  let acc = 0;
  let nbits = 0;
  let oi = 0;
  for (let i = 0; i < totalPx; i++) {
    const px = col ? ((i % height) * width + ((i / height) | 0)) : i;
    const base = px * channels;
    for (let k = 0; k < idxs.length; k++) {
      if (skip > 0) { skip--; continue; }
      const v = (samples[base + idxs[k]] >> bit) & 1;
      if (lsb) acc |= v << nbits;
      else acc = (acc << 1) | v;
      if (++nbits === 8) {
        out[oi++] = acc & 0xff;
        acc = 0;
        nbits = 0;
        if (oi >= cap) return out;
      }
    }
  }
  return oi === cap ? out : out.subarray(0, oi);
}

function rawCleanLength(bytes) {
  let n = 0;
  while (n < bytes.length) {
    const b = bytes[n];
    if ((b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) || b === 0x7f) break;
    n++;
  }
  return n;
}

function isVisibleUnit(c) {
  if (c >= 0x20 && c <= 0x7e) return true;
  if (c === 0x09 || c === 0x0a || c === 0x0d) return true;
  if (c === 0xfffd) return false;
  if (c >= 0x7f && c <= 0x9f) return false;
  if (c >= 0xd800 && c <= 0xdfff) return true;
  return c >= 0xa0;
}

function textStats(text) {
  const n = text.length;
  if (!n) return {
    printableRatio: 0, visibleRatio: 0, asciiRatio: 0, controlRatio: 0,
    longestRun: 0, cleanRun: 0, letters: 0, unicodeLetters: 0, braces: false,
  };
  let printable = 0;
  let visible = 0;
  let ascii = 0;
  let control = 0;
  let run = 0;
  let longest = 0;
  let cleanRun = 0;
  let cleanStopped = false;
  let letters = 0;
  let unicodeLetters = 0;
  let hasL = false;
  let hasR = false;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    const isAsciiPrintable = c >= 0x20 && c <= 0x7e;
    const isWs = c === 0x09 || c === 0x0a || c === 0x0d;
    const isVisible = isVisibleUnit(c);
    if (isAsciiPrintable || isWs) {
      printable++;
      ascii++;
    }
    if (isVisible) {
      visible++;
      run++;
      if (run > longest) longest = run;
      if (!cleanStopped) cleanRun++;
    } else {
      run = 0;
      if (!cleanStopped) cleanStopped = true;
      if (c < 0x20 || c === 0x7f || (c >= 0x7f && c <= 0x9f) || c === 0xfffd) control++;
    }
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) letters++;
    else if ((c >= 0xc0 && c <= 0x24f) || (c >= 0x370 && c <= 0x52f) || (c >= 0x3040 && c <= 0x30ff)
      || (c >= 0x3400 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xf900 && c <= 0xfaff)) unicodeLetters++;
    if (text[i] === "{") hasL = true;
    if (text[i] === "}") hasR = true;
  }
  return {
    printableRatio: printable / n,
    visibleRatio: visible / n,
    asciiRatio: ascii / n,
    controlRatio: control / n,
    longestRun: longest,
    cleanRun,
    letters,
    unicodeLetters,
    braces: hasL && hasR,
  };
}

function englishScore(text) {
  if (!text) return 0;
  let sum = 0;
  let n = 0;
  for (const ch of text) {
    n++;
    const c = ch.codePointAt(0);
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x20) sum += 1.0;
    else if (c >= 0x30 && c <= 0x39) sum += 0.6;
    else if (ch === "\n" || ch === "\t" || ch === "\r") sum += 0.4;
    else if ((c >= 0x21 && c <= 0x2f) || (c >= 0x3a && c <= 0x40) || (c >= 0x5b && c <= 0x60) || (c >= 0x7b && c <= 0x7e)) sum += 0.3;
    else if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) sum += -3.0;
    else sum += 0.1;
  }
  return sum / n;
}

function decodePayload(raw, maxChars) {
  const nul = raw.indexOf(0);
  const cut = nul >= 0 ? raw.subarray(0, nul) : raw;
  if (!cut.length) return { text: "", rawCut: cut, rawClean: 0, encoding: "utf-8" };
  const rawClean = rawCleanLength(cut);
  let utf8PrefixOk = true;
  if (rawClean > 0) {
    try { UTF8_FATAL.decode(cut.subarray(0, rawClean)); } catch { utf8PrefixOk = false; }
  }
  const useUtf8 = utf8PrefixOk && rawClean > 0;
  const text = useUtf8 ? UTF8.decode(cut) : LATIN1.decode(cut);
  return {
    text: text.length > maxChars ? text.slice(0, maxChars) : text,
    rawCut: cut,
    rawClean,
    encoding: useUtf8 ? "utf-8" : "latin1",
  };
}

function collectFlags(text, extraRe) {
  const out = [];
  const push = (s) => {
    if (!s || out.includes(s) || out.length >= 8) return;
    const body = s.slice(s.indexOf("{") + 1, -1);
    const alnum = (body.match(FLAG_CONTENT_RE) || []).length;
    if (alnum < 3) return;
    out.push(s);
  };
  let m;
  DEFAULT_FLAG_RE.lastIndex = 0;
  while ((m = DEFAULT_FLAG_RE.exec(text))) push(m[0]);
  if (extraRe) {
    extraRe.lastIndex = 0;
    while ((m = extraRe.exec(text))) push(m[0]);
  }
  return out;
}

function collectUrls(text) {
  const out = [];
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) {
    if (!out.includes(m[0])) out.push(m[0]);
    if (out.length >= 4) break;
  }
  return out;
}

function isPeriodicText(text) {
  const n = Math.min(text.length, 160);
  if (n < 24) return false;
  const maxPeriod = Math.min(16, n >> 2);
  for (let p = 1; p <= maxPeriod; p++) {
    let match = 0;
    for (let i = p; i < n; i++) if (text.charCodeAt(i) === text.charCodeAt(i - p)) match++;
    if (match / (n - p) >= 0.92) return true;
  }
  return false;
}

function base64Shape(text) {
  const t = text.trim().replace(/\s+/g, "");
  if (t.length < 16 || t.length > 16384) return false;
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(t)) return false;
  if (t.length % 4 !== 0 && !/={1,2}$/.test(t)) return false;
  const symbol = /[+/=_-]/.test(t);
  const digit = /[0-9]/.test(t);
  const upper = /[A-Z]/.test(t);
  const lower = /[a-z]/.test(t);
  return symbol || (digit && upper && lower);
}

function makeCandidate(source, combo, bit, scan, order, offset, raw, opts) {
  const decoded = decodePayload(raw, opts.maxTextChars);
  const text = decoded.text;
  const stats = textStats(text);
  const cleanLength = Math.min(stats.cleanRun, decoded.rawClean);
  const cleanText = text.slice(0, cleanLength);
  const cleanStats = textStats(cleanText);
  const english = englishScore(cleanText);
  const flags = collectFlags(text, opts._flagRe);
  const urls = collectUrls(cleanText || text);
  const base64 = base64Shape(cleanText || text);
  const hasFlag = flags.length > 0;
  const sampleLen = Math.min(cleanLength, 512);
  const freq = new Map();
  for (let i = 0; i < sampleLen; i++) freq.set(cleanText[i], (freq.get(cleanText[i]) || 0) + 1);
  let maxFreq = 0;
  for (const v of freq.values()) if (v > maxFreq) maxFreq = v;
  // 单字符主导 / 低多样性 / 短周期重复（如恒色图的 "...I$’I$’..."）是填充噪声，不是载荷。
  if (!hasFlag && !base64 && sampleLen > 0) {
    const dominant = maxFreq / sampleLen > 0.95;
    const lowDiversity = cleanLength >= 24 && freq.size <= 4;
    const periodic = cleanLength >= 24 && isPeriodicText(cleanText);
    if (dominant || lowDiversity || periodic) return null;
  }
  const letterRatio = cleanLength
    ? (cleanStats.letters + (decoded.encoding === "utf-8" ? cleanStats.unicodeLetters : 0)) / cleanLength
    : 0;
  let score = 0;
  score += stats.visibleRatio * 60;
  score += stats.asciiRatio * 30;
  score += cleanStats.visibleRatio * 40;
  score += cleanStats.asciiRatio * 20;
  score += Math.min(stats.longestRun, 200) * 0.4;
  score += Math.min(cleanLength, 512) * 0.25;
  score += Math.max(-15, Math.min(15, english * 15));
  score += letterRatio * 50;
  if (stats.braces) score += 6;
  if (hasFlag) score += 1000 + Math.min(flags[0].length, 160) * 0.5;
  if (base64) score += 90 + Math.min(cleanLength, 256) * 0.2;
  if (urls.length) score += 80;
  if (cleanLength < 6 && !hasFlag) score -= 35;
  if (cleanLength >= 16 && letterRatio < 0.15 && !hasFlag) score -= 120;
  if (stats.controlRatio > 0.3) score -= 50;
  if (stats.printableRatio < 0.3 && !hasFlag) score -= 30;
  score = Math.round(score * 100) / 100;
  if (!hasFlag && !base64 && !urls.length && (cleanLength === 0 || score < 0)) return null;

  const note = `${combo.name} bit${bit} ${scan === "col" ? "列优先" : "行优先"} ${order === "msb" ? "MSB-first" : "LSB-first"}${offset ? " 偏移" + offset : ""}`;
  const cand = {
    channel: combo.name,
    channelIndices: combo.idxs.slice(),
    bit,
    order,
    scan,
    offset,
    text,
    preview: cleanText.length ? cleanText.slice(0, 300) : text.slice(0, 300),
    cleanText,
    cleanLength,
    printableRatio: Math.round(stats.printableRatio * 10000) / 10000,
    visibleRatio: Math.round(stats.visibleRatio * 10000) / 10000,
    asciiRatio: Math.round(stats.asciiRatio * 10000) / 10000,
    letterRatio: Math.round(letterRatio * 10000) / 10000,
    englishScore: Math.round(english * 1000) / 1000,
    uniqueChars: freq.size,
    score,
    flags,
    hasFlag,
    base64,
    url: urls.length > 0,
    urls,
    encoding: decoded.encoding,
    lengthBytes: raw.length,
    note,
  };
  if (!text.length && !hasFlag) return null;
  return cand;
}

function candidateCompare(a, b) {
  if (a.hasFlag !== b.hasFlag) return a.hasFlag ? -1 : 1;
  if (a.base64 !== b.base64) return a.base64 ? -1 : 1;
  if (a.url !== b.url) return a.url ? -1 : 1;
  if (b.score !== a.score) return b.score - a.score;
  if (b.cleanLength !== a.cleanLength) return b.cleanLength - a.cleanLength;
  if (a.channel !== b.channel) return a.channel < b.channel ? -1 : 1;
  if (a.bit !== b.bit) return a.bit - b.bit;
  if (a.order !== b.order) return a.order === "msb" ? -1 : 1;
  if (a.scan !== b.scan) return a.scan === "row" ? -1 : 1;
  return a.offset - b.offset;
}

function attachSource(cand, source) {
  try {
    Object.defineProperty(cand, "_source", { value: source, enumerable: false, configurable: true });
  } catch { /* 候选被冻结时忽略；此时调用渲染需显式传 bytes */ }
}

function emptyResult(reason, extra) {
  const out = [];
  out.reason = reason;
  if (extra) {
    try { Object.defineProperty(out, "meta", { value: extra, enumerable: false, configurable: true }); }
    catch { out.meta = extra; }
  }
  return out;
}

/**
 * LSB 深度扫描。
 * @param {Uint8Array|ArrayBuffer|number[]} bytes PNG/BMP 文件字节
 * @param {object} [opts]
 * @param {number[]} [opts.bits] 位平面列表，默认 0..7
 * @param {Array} [opts.channels] 通道组合名或 [name,[idx...]]，默认 r/g/b/a/rgb/bgr/rgba/bgra
 * @param {string[]} [opts.scans] "row"|"col"，默认两者
 * @param {string[]} [opts.orders] "msb"|"lsb"，默认两者
 * @param {number[]} [opts.offsets] 起始位偏移 0..7，默认 0..7
 * @param {number} [opts.probeBytes=768] 探测前缀字节（大图自动 384）
 * @param {number} [opts.detailBytes=8192] 靠前候选重抽上限
 * @param {number} [opts.limit=40] 返回候选数（大图 24）
 * @param {number} [opts.maxTextChars=4096] 单候选文本上限
 * @param {boolean} [opts.includePreviews=false] 靠前候选附带 previewPng(dataURL)
 * @param {number} [opts.previewLimit=8]
 * @param {number} [opts.previewMaxSide=256] 预览图长边上限（0=原尺寸）
 * @param {number} [opts.maxPixels=16000000] 安全上限，超限直接返回空数组+原因
 * @param {number} [opts.largePixels=1000000] 大图阈值（缩短前缀/减少候选）
 * @param {string|RegExp} [opts.flagRegex] 追加 flag 正则
 * @returns {Array} 候选数组（meta/reason 为附加属性）
 */
export function lsbDeepScan(bytes, opts = {}) {
  const started = now();
  const o = opts && typeof opts === "object" ? opts : {};
  const probeInput = asBytes(bytes);
  if (!probeInput || probeInput.length < 8) return emptyResult("输入为空或不是图片字节");

  const dims = peekDimensions(probeInput);
  const maxPixels = clampInt(o.maxPixels, 1, Number.MAX_SAFE_INTEGER, DEFAULT_MAX_PIXELS);
  if (dims && dims.width * dims.height > maxPixels) {
    return emptyResult(`图片过大（${dims.width}×${dims.height}=${dims.width * dims.height} 像素，上限 ${maxPixels}）；为避免卡死已跳过，可用 opts.maxPixels 放宽`);
  }

  const decodedAt = now();
  const dec = decodeSource(probeInput);
  const decodedMs = Math.round((now() - decodedAt) * 10) / 10;
  if (!dec.ok) return emptyResult(dec.reason);
  const source = dec.source;
  lastSource = source;

  const pixelCount = source.width * source.height;
  if (pixelCount < 8) return emptyResult("图片过小（像素数 < 8），无可提取位平面");
  const large = pixelCount > clampInt(o.largePixels, 1, Number.MAX_SAFE_INTEGER, DEFAULT_LARGE_PIXELS);

  const bits = intList(o.bits, 0, 7, [0, 1, 2, 3, 4, 5, 6, 7]);
  const scans = normalizeScans(o.scans);
  const orders = normalizeOrders(o.orders);
  const offsets = intList(o.offsets, 0, 7, [0, 1, 2, 3, 4, 5, 6, 7]);
  const combos = resolveCombos(source.channels, o.channels);
  if (!combos.length) return emptyResult("没有可用通道组合（图像通道数不足）");

  let flagRe = null;
  if (o.flagRegex) {
    try { flagRe = o.flagRegex instanceof RegExp ? new RegExp(o.flagRegex.source, o.flagRegex.flags.includes("g") ? o.flagRegex.flags : o.flagRegex.flags + "g") : new RegExp(String(o.flagRegex), "g"); }
    catch { flagRe = null; }
  }
  const maxTextChars = clampInt(o.maxTextChars, 16, 1 << 20, DEFAULT_MAX_TEXT);
  const probeBytes = clampInt(o.probeBytes, 8, 1 << 20, large ? LARGE_PROBE : DEFAULT_PROBE);
  const detailBytes = Math.max(probeBytes, clampInt(o.detailBytes, 8, 1 << 22, DEFAULT_DETAIL));
  const limit = clampInt(o.limit, 1, 1000, large ? LARGE_LIMIT : DEFAULT_LIMIT);
  const scanOpts = { maxTextChars, _flagRe: flagRe };

  let tried = 0;
  const cands = [];
  for (const combo of combos) {
    for (const bit of bits) {
      for (const scan of scans) {
        for (const order of orders) {
          for (const offset of offsets) {
            tried++;
            const raw = extractBits(source, combo.idxs, bit, scan, order, offset, probeBytes);
            if (!raw.length) continue;
            const cand = makeCandidate(source, combo, bit, scan, order, offset, raw, scanOpts);
            if (cand) cands.push(cand);
          }
        }
      }
    }
  }

  if (!cands.length) {
    const meta = {
      width: source.width, height: source.height, channels: source.channels, format: source.format,
      tried, decodedMs, elapsedMs: Math.round((now() - started) * 10) / 10, large,
      probeBytes, detailBytes, limit, sampled: large,
      strategy: large ? "large-prefix-limit" : "full-prefix",
    };
    return emptyResult("所有组合均未提取到非空文本（可能无 LSB 载荷或载荷为二进制/加密）", meta);
  }

  cands.sort(candidateCompare);
  const refineCount = Math.min(cands.length, Math.max(limit * 2, 24));
  if (detailBytes > probeBytes) {
    for (let i = 0; i < refineCount; i++) {
      const c = cands[i];
      const combo = comboForCandidate(c, source.channels);
      if (!combo) continue;
      const raw = extractBits(source, combo.idxs, c.bit, c.scan, c.order, c.offset, detailBytes);
      if (!raw.length) continue;
      const refined = makeCandidate(source, combo, c.bit, c.scan, c.order, c.offset, raw, scanOpts);
      if (refined) cands[i] = refined;
    }
    cands.sort(candidateCompare);
  }

  const out = cands.slice(0, limit);
  for (const c of out) attachSource(c, source);

  if (o.includePreviews) {
    const n = Math.min(out.length, clampInt(o.previewLimit, 0, out.length, DEFAULT_PREVIEW_LIMIT));
    const maxSide = clampInt(o.previewMaxSide, 0, 4096, DEFAULT_PREVIEW_SIDE);
    for (let i = 0; i < n; i++) {
      try {
        const img = lsbDeepRenderCandidate(out[i], source, { maxSide });
        out[i].previewPng = img.dataURL;
      } catch { /* 预览失败不影响扫描结果 */ }
    }
  }

  const meta = {
    width: source.width,
    height: source.height,
    channels: source.channels,
    format: source.format,
    pixelCount,
    large,
    sampled: large,
    strategy: large ? "large-prefix-limit" : "full-prefix",
    tried,
    candidates: cands.length,
    returned: out.length,
    probeBytes,
    detailBytes,
    limit,
    decodedMs,
    elapsedMs: Math.round((now() - started) * 10) / 10,
    overBudget: now() - started > 800,
  };
  try { Object.defineProperty(out, "meta", { value: meta, enumerable: false, configurable: true }); } catch { out.meta = meta; }
  return out;
}

/**
 * 生成候选对应组合的位平面 PNG。
 * @param {object} cand lsbDeepScan 候选
 * @param {Uint8Array|object} [bytes] 原图字节；省略时用候选自带 _source / 最近一次扫描源
 * @param {object} [opts] {maxSide=0, invert=false, dataURL=true}
 * @returns {{width:number,height:number,png:Uint8Array,dataURL?:string}}
 */
export function lsbDeepRenderCandidate(cand, bytes, opts = {}) {
  if (!cand || typeof cand !== "object") throw new Error("缺少候选对象");
  const source = resolveSource(bytes, cand);
  const combo = comboForCandidate(cand, source.channels);
  if (!combo) throw new Error("候选缺少有效通道信息");
  const bit = clampInt(cand.bit, 0, 7, 0);
  const invert = !!opts.invert;
  const maxSide = clampInt(opts.maxSide, 0, 16384, 0);
  const scale = maxSide > 0 ? Math.min(1, maxSide / Math.max(source.width, source.height)) : 1;
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  const srcW = source.width;
  const srcH = source.height;
  const channels = source.channels;
  const samples = source.samples;
  const multi = combo.idxs.length > 1;
  for (let y = 0; y < h; y++) {
    const sy = scale === 1 ? y : Math.min(srcH - 1, Math.floor(y / scale));
    for (let x = 0; x < w; x++) {
      const sx = scale === 1 ? x : Math.min(srcW - 1, Math.floor(x / scale));
      const base = (sy * srcW + sx) * channels;
      let r = 0, g = 0, b = 0;
      if (!multi) {
        const v = ((samples[base + combo.idxs[0]] >> bit) & 1) ? 255 : 0;
        r = g = b = v;
      } else {
        for (const c of combo.idxs) {
          const v = ((samples[base + c] >> bit) & 1) ? 255 : 0;
          if (c === 0) r = v;
          else if (c === 1) g = v;
          else if (c === 2) b = v;
          else { r = Math.max(r, v); g = Math.max(g, v); b = Math.max(b, v); }
        }
      }
      if (invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
      const o4 = (y * w + x) * 4;
      out[o4] = r; out[o4 + 1] = g; out[o4 + 2] = b; out[o4 + 3] = 255;
    }
  }
  const png = encodePNG(out, w, h);
  const res = { width: w, height: h, png };
  if (opts.dataURL !== false) res.dataURL = rgbaToDataURL(out, w, h);
  return res;
}

/**
 * 导出候选：默认导出该组合的原始载荷字节；也可导出文本或位平面 PNG。
 * @param {object} cand
 * @param {Uint8Array|object} [bytes]
 * @param {object} [opts] {format="raw"|"text"|"png", maxBytes=1048576, maxSide=0, invert=false}
 * @returns {Uint8Array} 文件字节
 */
export function lsbDeepExport(cand, bytes, opts = {}) {
  if (!cand || typeof cand !== "object") throw new Error("缺少候选对象");
  const format = String(opts.format || opts.type || "raw").toLowerCase();
  if (format === "text" || format === "txt") {
    return new TextEncoder().encode(String(cand.text ?? cand.cleanText ?? ""));
  }
  const source = resolveSource(bytes, cand);
  if (format === "png" || format === "image") {
    return lsbDeepRenderCandidate(cand, source, {
      maxSide: clampInt(opts.maxSide, 0, 16384, 0),
      invert: !!opts.invert,
      dataURL: false,
    }).png;
  }
  if (format !== "raw" && format !== "bin" && format !== "bytes") {
    throw new Error("未知导出格式：" + format + "（raw/text/png）");
  }
  const combo = comboForCandidate(cand, source.channels);
  if (!combo) throw new Error("候选缺少有效通道信息");
  const maxBytes = clampInt(opts.maxBytes, 1, 1 << 30, DEFAULT_EXPORT_BYTES);
  return extractBits(
    source,
    combo.idxs,
    clampInt(cand.bit, 0, 7, 0),
    cand.scan === "col" ? "col" : "row",
    cand.order === "lsb" ? "lsb" : "msb",
    clampInt(cand.offset, 0, 7, 0),
    maxBytes,
  );
}

export default {
  lsbDeepScan,
  lsbDeepRenderCandidate,
  lsbDeepExport,
  LSB_DEEP_CHANNEL_COMBOS,
};
