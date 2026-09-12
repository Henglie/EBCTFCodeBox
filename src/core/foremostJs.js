/*
 * foremostJs.js — 纯 JS 文件雕刻（对标 foremost.exe，cat:'forensic'，run 型）。
 *
 * 定位：从混合二进制容器 / 磁盘镜像 / 流量 dump 里按「文件头魔数 + 尾魔数/结构」
 * 雕刻（carve）出内嵌文件。foremost 是 CTF 取证标配，本文件是其核心逻辑的纯 JS
 * 实现，零 wasm、零本地桥，浏览器与 node 均可跑（node 下测试见 工具/rt_foremost_test.mjs）。
 *
 * 与 trailerCarve.js 的分工：trailerCarve 解决「主体文件尾部粘了什么」（需要先认出主体）；
 * 本文件解决「容器里都埋了哪些文件」（不认主体，从左到右扫全部启用格式的头魔数）。
 *
 * 雕刻策略（每格式三要素：头 magic / 尾定位策略 / 长度护栏）：
 *  jpg  FF D8 FF          → 最近 FF D9（EOI）                     完整
 *  png  89 50 4E 47 0D 0A 1A 0A → 最近 IEND chunk（IEND+CRC 共 8 字节）完整
 *  gif  GIF87a / GIF89a   → 最近 0x3B trailer                     完整（0x3B 是常见字节，
 *                            误切由「产物起点仍是合法头」兜底，CTF 场景可接受）
 *  zip  50 4B 03 04       → 最近的 EOCD（50 4B 05 06）+22+注释长  完整
 *  pdf  25 50 44 46 2D    → 最近 %%EOF（吞掉紧随换行）            完整
 *  wav  52 49 46 46 + WAVE → 偏移 4 的 size 字段 ×（+8）           完整
 *  mp3  ID3               → ID3v2 同步安全 size 字段（+10 头 + 可选尾）完整
 *  mp3  FF FB             → 无可靠尾                              截断（护栏）
 *  rar  Rar! 1A 07 00/01 00 → 无可靠尾                             截断（护栏）
 *  7z   37 7A BC AF 27 1C → 无可靠尾                              截断（护栏）
 * 截断规则：找不到合法尾 / 尾字段越界时，从头部起按该格式最大长度护栏切到
 * 「护栏上限与缓冲区末尾的较小者」，产物标 truncated=true，报告里注明「截断」。
 *
 * 嵌套处理：ZIP 走「本地头 + EOCD」结构化解析优先（内嵌文件随整包带走，不重复
 * 单独雕刻）；其余格式头尾简单配对。产物去重：字节级相同只留第一份。
 *
 * 性能：Horspool 简化版（坏字符跳表）找魔数，不做逐字节双层暴力扫；
 * 输入 >50MB 直接拒绝（提示过大）。
 *
 * 输入约定：跟随项目取证类 op 惯例（同 trailerCarve）——text 为 base64（可带
 * dataURL 前缀）；拖入文件走 rawBytes 通道（acceptsBytes）。产物协议
 * { text, files:[{name, mime, bytes}] }（registry.js 产物契约），files 渲染为下载按钮。
 *
 * 红线：core 层零 UI 依赖、自包含（不 import 他人模块）、件内自注册、中文硬编码。
 */
import { register } from "./registry.js";

// ============ 通用小工具（自包含，同 trailerCarve 范式） ============
function b64ToBytes(b64) {
  if (typeof b64 !== "string") throw new Error("需 base64 字符串输入");
  const comma = b64.indexOf(",");
  if (comma >= 0 && b64.slice(0, 5).toLowerCase().startsWith("data:")) b64 = b64.slice(comma + 1);
  b64 = b64.replace(/\s+/g, "");
  let bin;
  if (typeof atob === "function") bin = atob(b64);
  else if (typeof Buffer !== "undefined") bin = Buffer.from(b64, "base64").toString("binary");
  else throw new Error("无 atob/Buffer，无法解码 base64");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function u16le(b, o) { return (b[o] | (b[o + 1] << 8)) >>> 0; }
function u32le(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x1000000)) >>> 0; }

function matchAt(buf, off, magic) {
  if (off < 0 || off + magic.length > buf.length) return false;
  for (let k = 0; k < magic.length; k++) if (buf[off + k] !== magic[k]) return false;
  return true;
}

/** Horspool 简化版子序列查找：返回 needle 在 buf 中 [from, len) 内的首个命中偏移，无则 -1。 */
function findBytes(buf, from, needle) {
  const n = needle.length;
  if (n === 0 || from < 0) from = Math.max(from, 0);
  if (n === 0 || from + n > buf.length) return -1;
  const skip = new Map();
  for (let i = 0; i < n - 1; i++) skip.set(needle[i], n - 1 - i);
  let pos = from + n - 1;
  const last = n - 1;
  while (pos < buf.length) {
    let i = 0;
    while (i < n && buf[pos - i] === needle[last - i]) i++;
    if (i === n) return pos - last;
    const sh = skip.get(buf[pos]);
    pos += (sh === undefined) ? n : sh;
  }
  return -1;
}

/** 产物去重键：长度 + 完整 hex（CTF 尺寸内存可承受；>50MB 已在入口拦掉）。 */
function dedupKey(bytes) {
  let h = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    const end = Math.min(i + CH, bytes.length);
    for (let j = i; j < end; j++) h += bytes[j].toString(16).padStart(2, "0");
  }
  return bytes.length + ":" + h;
}

// ============ 格式表：ext / 头 magic 列表 / 最大长度护栏（防误切，不编造规格） ============
const M = (s) => Array.from(s, (c) => c.charCodeAt(0)); // ascii 串 → 字节数组
const MB = 1 << 20;

const FORMATS = {
  jpg:  { ext: "jpg", name: "JPEG", mime: "image/jpeg", max: 20 * MB,
          headers: [[0xFF, 0xD8, 0xFF]] },
  png:  { ext: "png", name: "PNG", mime: "image/png", max: 20 * MB,
          headers: [[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]] },
  gif:  { ext: "gif", name: "GIF", mime: "image/gif", max: 10 * MB,
          headers: [M("GIF87a"), M("GIF89a")] },
  zip:  { ext: "zip", name: "ZIP", mime: "application/zip", max: 50 * MB,
          headers: [[0x50, 0x4B, 0x03, 0x04]] },
  pdf:  { ext: "pdf", name: "PDF", mime: "application/pdf", max: 50 * MB,
          headers: [M("%PDF-")] },
  wav:  { ext: "wav", name: "WAV (RIFF)", mime: "audio/wav", max: 50 * MB,
          headers: [M("RIFF")] },
  mp3:  { ext: "mp3", name: "MP3", mime: "audio/mpeg", max: 20 * MB,
          headers: [M("ID3"), [0xFF, 0xFB]] },
  rar:  { ext: "rar", name: "RAR", mime: "application/vnd.rar", max: 10 * MB,
          headers: [M("Rar!\x1A\u0007\u0000"), M("Rar!\x1A\u0007\u0001\u0000")] },
  "7z": { ext: "7z", name: "7-Zip", mime: "application/x-7z-compressed", max: 50 * MB,
          headers: [[0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]] },
};

const DEFAULT_FORMATS = ["jpg", "png", "zip", "gif", "pdf"];
const MAX_INPUT = 50 * MB;
const FFD9 = [0xFF, 0xD9];
const IEND = M("IEND");
const EOF_PDF = M("%%EOF");
const EOCD = [0x50, 0x4B, 0x05, 0x06];

/** 解析用户给的格式清单（数组或逗号串）→ 合法 ext 集合；空/非法回退默认。 */
function resolveFormats(formats) {
  let list = formats;
  if (typeof list === "string") list = list.split(/[,，\s]+/);
  if (!Array.isArray(list) || list.length === 0) list = DEFAULT_FORMATS;
  const alias = { jpeg: "jpg", sevenzip: "7z" };
  const out = new Set();
  for (let f of list) {
    f = String(f).trim().toLowerCase().replace(/^\./, "");
    f = alias[f] || f;
    if (FORMATS[f]) out.add(f);
  }
  if (out.size === 0) for (const f of DEFAULT_FORMATS) out.add(f);
  return out;
}

// ============ 各格式「尾定位」：返回 { end, truncated, why } ============

function extractJpg(b, off, fmt) {
  const i = findBytes(b, off + 3, FFD9);
  if (i >= 0) return { end: Math.min(i + 2, b.length), truncated: false };
  return { end: Math.min(b.length, off + fmt.max), truncated: true, why: "未找到 FF D9 (EOI)" };
}

function extractPng(b, off, fmt) {
  // IEND chunk：len(4,=0) + "IEND" + CRC(4)；从 "IEND" 字样定位，尾部再吃 4 字节 CRC
  const i = findBytes(b, off + 8, IEND);
  if (i >= 0) return { end: Math.min(i + 8, b.length), truncated: false };
  return { end: Math.min(b.length, off + fmt.max), truncated: true, why: "未找到 IEND chunk" };
}

function extractGif(b, off, fmt) {
  // 头(6) + 逻辑屏幕描述符(7) 之后才允许出现 trailer 0x3B，降低误切
  const i = findBytes(b, off + 13, [0x3B]);
  if (i >= 0) return { end: i + 1, truncated: false };
  return { end: Math.min(b.length, off + fmt.max), truncated: true, why: "未找到 0x3B trailer" };
}

function extractZip(b, off, fmt) {
  // 最近 EOCD 配对（简化决策：从前往后找第一个 EOCD，end=eocd+22+注释长，
  // 且 end 不得越过护栏窗口；多 EOCD / 套娃 ZIP 按最近者切）
  const winEnd = Math.min(b.length, off + fmt.max);
  for (let i = findBytes(b, off + 4, EOCD); i >= 0 && i + 22 <= winEnd; i = findBytes(b, i + 1, EOCD)) {
    const end = i + 22 + u16le(b, i + 20);
    if (end <= winEnd) return { end, truncated: false };
  }
  return { end: winEnd, truncated: true, why: "未找到合法 EOCD（中心目录尾）" };
}

function extractPdf(b, off, fmt) {
  const i = findBytes(b, off + 5, EOF_PDF);
  if (i >= 0) {
    let end = i + 5;
    while (end < b.length && (b[end] === 0x0D || b[end] === 0x0A)) end++; // %%EOF\r\n
    return { end, truncated: false };
  }
  return { end: Math.min(b.length, off + fmt.max), truncated: true, why: "未找到 %%EOF" };
}

function extractWav(b, off, fmt) {
  // RIFF 必须配 "WAVE" 才当 WAV 雕（RIFF 系还有 AVI/WebP，避免误标）
  if (!matchAt(b, off + 8, M("WAVE"))) return null;
  const size = u32le(b, off + 4);
  const end = off + 8 + size;
  if (size > 0 && end <= Math.min(b.length, off + fmt.max)) return { end, truncated: false };
  return { end: Math.min(b.length, off + fmt.max), truncated: true, why: "RIFF size 字段越界" };
}

function extractMp3(b, off, fmt) {
  if (matchAt(b, off, M("ID3"))) {
    // ID3v2：偏移 6..9 同步安全整数（每字节 7 位），头 10 字节；flag 0x10 = 有 10 字节 footer
    if (off + 10 > b.length) return null;
    const sz = ((b[off + 6] & 0x7F) << 21) | ((b[off + 7] & 0x7F) << 14) |
               ((b[off + 8] & 0x7F) << 7) | (b[off + 9] & 0x7F);
    let end = off + 10 + sz + ((b[off + 5] & 0x10) ? 10 : 0);
    const cap = Math.min(b.length, off + fmt.max);
    if (end <= cap) return { end, truncated: false };
    return { end: cap, truncated: true, why: "ID3v2 size 越界" };
  }
  // 裸帧 FF FB：无可靠尾，按护栏截断
  return { end: Math.min(b.length, off + fmt.max), truncated: true, why: "裸 MPEG 帧无可靠尾" };
}

function extractTruncateOnly(b, off, fmt) {
  // RAR / 7z：无可靠的单一尾魔数，按护栏截断并标注
  return { end: Math.min(b.length, off + fmt.max), truncated: true, why: "该格式无可靠尾魔数" };
}

const EXTRACTORS = {
  jpg: extractJpg, png: extractPng, gif: extractGif, zip: extractZip,
  pdf: extractPdf, wav: extractWav, mp3: extractMp3,
  rar: extractTruncateOnly, "7z": extractTruncateOnly,
};

// ============ 雕刻主引擎（纯函数，测试直接调用） ============

/**
 * 从字节流里按启用格式的魔数雕刻内嵌文件。
 * @param {Uint8Array} bytes 输入
 * @param {{formats?: string|string[], minSize?: number}} opts
 * @returns {{ found: [{ext, offset, size, bytes, truncated}], report: string }}
 */
export function carve(bytes, opts = {}) {
  const enabled = resolveFormats(opts.formats);
  const minSize = Number.isFinite(opts.minSize) && opts.minSize >= 0 ? opts.minSize : 32;
  const found = [];
  const seen = new Set();

  // 头魔数按首字节建索引 + 同位置命中取最长 magic（防 GIF8 与 GIF87a 类前缀误判）
  const byFirst = new Map();
  for (const ext of enabled) {
    for (const magic of FORMATS[ext].headers) {
      const list = byFirst.get(magic[0]) || [];
      list.push({ ext, magic });
      byFirst.set(magic[0], list);
    }
  }

  let pos = 0;
  const truncSpan = new Map();
  let reportedEnd = 0;
  while (pos < bytes.length) {
    let hit = null;
    const cands = byFirst.get(bytes[pos]);
    if (cands) {
      for (const c of cands) {
        if (matchAt(bytes, pos, c.magic) && (!hit || c.magic.length > hit.magic.length)) hit = c;
      }
    }
    if (!hit) { pos++; continue; }

    if (pos < (truncSpan.get(hit.ext) ?? 0)) { pos++; continue; }
    const fmt = FORMATS[hit.ext];
    const res = EXTRACTORS[hit.ext](bytes, pos, fmt);
    if (!res) { pos++; continue; }
    const end = Math.max(res.end, pos + 1); // 防御：end 至少越过头部
    const nested = res.truncated && pos < reportedEnd;
    const size = end - pos;
    if (!nested && size >= minSize && size <= fmt.max) {
      const slice = bytes.subarray(pos, end);
      const key = dedupKey(slice);
      if (!seen.has(key)) {
        seen.add(key);
        found.push({
          ext: hit.ext, offset: pos, size,
          bytes: new Uint8Array(slice), // 拷贝，脱离原缓冲独立存在
          truncated: !!res.truncated,
        });
      }
    }
    if (res.truncated) {
      if (!nested) reportedEnd = Math.max(reportedEnd, end);
      // Size-based WAV/ID3 failures do not imply later same-format headers fail.
      if (hit.ext !== "wav" && hit.ext !== "mp3") truncSpan.set(hit.ext, end);
      pos++;
    } else {
      pos = end;
    }
  }

  return { found, report: buildReport(bytes, enabled, minSize, found) };
}

function buildReport(bytes, enabled, minSize, found) {
  const lines = [];
  lines.push("═══ 文件雕刻（Foremost JS）═══");
  lines.push(`输入大小: ${bytes.length} 字节`);
  lines.push(`启用格式: ${[...enabled].join(", ")}`);
  lines.push(`最小文件大小: ${minSize} 字节`);
  lines.push("");
  if (found.length === 0) {
    lines.push("雕刻结果: 0 个产物（未命中任何启用格式的头魔数）");
    lines.push("提示：确认魔数格式是否启用（支持 jpg/png/zip/gif/pdf/wav/mp3/rar/7z），");
    lines.push("或文件是否为 base64/hex 编码态——编码态需先解码再雕刻。");
    return lines.join("\n");
  }
  lines.push(`雕刻结果: ${found.length} 个产物（字节级去重后）`);
  lines.push("");
  found.forEach((f, i) => {
    const tag = f.truncated ? "  ⚠ 截断（未配对到合法尾 / 无可靠尾，按护栏截断）" : "";
    lines.push(`[${i + 1}] ${f.ext}  偏移 0x${f.offset.toString(16).padStart(8, "0")} (${f.offset})  大小 ${f.size} 字节${tag}`);
  });
  lines.push("");
  lines.push("产物已生成下载按钮（文件名 carve_<偏移hex>.<ext>）。截断产物可能不完整，");
  lines.push("图片类通常仍可打开查看，压缩包类建议尝试修复（另用 zipRepair 等）。");
  return lines.join("\n");
}

// ============ op run（跟随 trailerCarve 的二进制输入惯例） ============

function foremostCarveRun(text, p = {}) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : b64ToBytes(text);
  if (!bytes || bytes.length === 0) return "(空输入，请粘贴 base64 或拖入文件)";
  if (bytes.length > MAX_INPUT) {
    return `(输入 ${bytes.length} 字节，超过 50MB 上限，文件雕刻拒绝处理——请先截取目标区段再雕)`;
  }
  const { found, report } = carve(bytes, {
    formats: p.formats,
    minSize: p.minSize === "" || p.minSize == null ? undefined : Number(p.minSize),
  });
  const files = found.map((f) => ({
    name: `carve_${f.offset.toString(16).padStart(8, "0")}.${f.ext}`,
    mime: FORMATS[f.ext].mime,
    bytes: f.bytes,
  }));
  return { text: report, files };
}

// ============ register ============
register({
  id: "foremostCarve", cat: "forensic", name: "文件雕刻（Foremost JS）",
  desc: "纯 JS 版 foremost：从混合二进制容器/磁盘镜像/流量 dump 里按头尾魔数雕刻内嵌文件。支持 JPEG/PNG/GIF/ZIP/PDF/WAV/MP3/RAR/7z，头尾配对+长度护栏防误切+截断标注+字节级去重，产物可直接下载",
  params: [
    { key: "formats", label: "启用格式（逗号分隔）", type: "text", default: "jpg,png,zip,gif,pdf",
      placeholder: "jpg,png,zip,gif,pdf,wav,mp3,rar,7z" },
    { key: "minSize", label: "最小文件大小（字节，小于忽略）", type: "number", default: 32 },
  ],
  run: foremostCarveRun,
  acceptsBytes: true,
});

export { foremostCarveRun, FORMATS, DEFAULT_FORMATS, findBytes, b64ToBytes };
