/*
 * stegoOpWrappers.js — R18：把已落地但未注册的 4 个隐写/取证能力包装成 op 候选。
 *
 * 本文件自注册 4 个 op（cat=stegoFile，官方分类里没有 "stego"）：
 *   lsbDeep     — LSB 全通道/位平面/位序/偏移深度扫描（复用 lsbDeepScan）
 *   rasterStego — 光栅图按因数/相位拆图（复用 rasterStegoScan）
 *   mp3stego    — MP3Stego -X -P 解码（复用 mp3stegoDecode）
 *   imageThumb  — JPEG APP0/APP1 + PNG eXIf 内嵌缩略图提取（复用 extractExifThumbnails）
 *
 * 契约：acceptsBytes=true，真字节走 params.rawBytes（与 jsteg/watermarkhFft 一致）；
 * 全部纯算法，零 DOM、零网络、零随机。返回值按 registry 产物协议：
 * { text, files?: [{ name, mime, bytes }] }。
 *
 * stegSolve 现已注册为正式 op（页面版）：交互功能由 ui/stegSolvePage.js 承载，
 * 本文件只提供元数据与页面入口；run 返回页面提示，不假装能用纯文本完成查看器操作。
 */
import { register } from "./registry.js";
import { lsbDeepScan } from "./lsbDeep.js";
import { rasterStegoScan } from "./rasterStego.js";
import { mp3stegoDecode } from "./mp3stego.js";
import { extractExifThumbnails } from "./imageThumb.js";

const LS_DEEP_CHANNELS = ["r", "g", "b", "a", "rgb", "bgr", "rgba", "bgra"];
const LS_DEEP_BITS = [0, 1, 2, 3, 4, 5, 6, 7];
const LS_DEEP_ORDERS = ["msb", "lsb"];
const LS_DEEP_SCANS = ["row", "col"];
const DEFAULT_MAX_PIXELS = 16_000_000;
const DEFAULT_MAX_TEXT_CHARS = 4096;
const DEFAULT_MP3_PAYLOAD = 4 * 1024 * 1024;
const DEFAULT_RASTER_IMAGES = 128;
const DEFAULT_RASTER_TOTAL_PIXELS = 64_000_000;
const DEFAULT_THUMB_COUNT = 8;

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  return null;
}

function rawBytesOf(p) {
  if (!p || typeof p !== "object") return null;
  const bytes = toBytes(p.rawBytes || p.bytes);
  return bytes && bytes.length ? bytes : null;
}

function clampInt(value, lo, hi, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function asBool(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (["false", "0", "no", "off"].includes(s)) return false;
    if (["true", "1", "yes", "on"].includes(s)) return true;
  }
  return !!value;
}

function parseIntList(value, lo, hi, fallback) {
  if (value == null || String(value).trim() === "") return fallback.slice();
  const src = String(value).trim().toLowerCase();
  if (src === "all" || src === "*") {
    const out = [];
    for (let i = lo; i <= hi; i++) out.push(i);
    return out;
  }
  const out = [];
  for (const token of src.split(/[\s,;，、]+/)) {
    if (!token) continue;
    const range = /^(\d+)\s*[-~]\s*(\d+)$/.exec(token);
    if (range) {
      let a = Number(range[1]);
      let b = Number(range[2]);
      if (a > b) [a, b] = [b, a];
      for (let i = Math.max(lo, a); i <= Math.min(hi, b); i++) if (!out.includes(i)) out.push(i);
      continue;
    }
    const n = Math.floor(Number(token));
    if (Number.isFinite(n) && n >= lo && n <= hi && !out.includes(n)) out.push(n);
  }
  return out.length ? out : fallback.slice();
}

function parseEnumList(value, allowed, aliases, fallback) {
  if (value == null || String(value).trim() === "") return fallback.slice();
  const src = String(value).trim().toLowerCase();
  if (src === "all" || src === "*") return fallback.slice();
  const out = [];
  for (const token of src.split(/[\s,;，、]+/)) {
    const key = token.trim();
    if (!key) continue;
    const normalized = aliases[key] || key;
    if (allowed.includes(normalized) && !out.includes(normalized)) out.push(normalized);
  }
  return out.length ? out : fallback.slice();
}

function parseChannels(value) {
  if (value == null || String(value).trim() === "") return undefined;
  const src = String(value).trim().toLowerCase();
  if (src === "all" || src === "*") return undefined;
  const aliases = {
    red: "r", green: "g", blue: "b", alpha: "a",
    红: "r", 绿: "g", 蓝: "b", 透明: "a",
  };
  const out = [];
  for (const token of src.split(/[\s,;，、]+/)) {
    const key = token.trim().replace(/[-_]/g, "");
    if (!key) continue;
    const normalized = aliases[key] || key;
    if (LS_DEEP_CHANNELS.includes(normalized) && !out.includes(normalized)) out.push(normalized);
  }
  return out.length ? out : undefined;
}

function parseOrders(value) {
  return parseEnumList(value, LS_DEEP_ORDERS, {
    "msb-first": "msb", msbfirst: "msb", 高位先: "msb",
    "lsb-first": "lsb", lsbfirst: "lsb", 低位先: "lsb",
  }, LS_DEEP_ORDERS);
}

function parseScans(value) {
  return parseEnumList(value, LS_DEEP_SCANS, {
    column: "col", 列: "col", 列优先: "col",
    行: "row", 行优先: "row",
  }, LS_DEEP_SCANS);
}

function parseAxes(value) {
  if (value == null || String(value).trim() === "") return [];
  const src = String(value).trim().toLowerCase();
  if (src === "all" || src === "*") return ["x", "y"];
  return parseEnumList(value, ["x", "y"], {}, []);
}

function humanBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return v + " B";
  if (v < 1024 * 1024) return (v / 1024).toFixed(1) + " KiB";
  return (v / 1024 / 1024).toFixed(2) + " MiB";
}

function hexPreview(bytes, limit = 64) {
  let s = "";
  const n = Math.min(limit, bytes.length);
  for (let i = 0; i < n; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s + (bytes.length > n ? "…" : "");
}

function safeBase(name) {
  return String(name || "image")
    .replace(/\.[^.\\/]+$/, "")
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 48) || "image";
}

function thumbExt(mime) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  return "bin";
}

function lsbDeepReport(hits, opts) {
  const meta = hits.meta || {};
  const lines = [];
  lines.push(
    `LSB 深度扫描：${meta.width ?? "?"}×${meta.height ?? "?"}（${meta.format || "?"}），` +
    `尝试 ${meta.tried ?? "?"} 个组合，返回 ${hits.length} 条候选，用时 ${meta.elapsedMs ?? "?"} ms。`,
  );
  const flags = [];
  for (const hit of hits) for (const flag of hit.flags || []) if (!flags.includes(flag)) flags.push(flag);
  if (flags.length) {
    lines.push("");
    lines.push(`命中 flag（${flags.length}）：`);
    for (const flag of flags) lines.push("  " + flag);
  }
  lines.push("");
  lines.push("Top 候选：");
  const shown = Math.min(hits.length, 12);
  for (let i = 0; i < shown; i++) {
    const hit = hits[i];
    const note =
      `${String(hit.channel).toUpperCase()}/bit${hit.bit} ` +
      `${hit.order === "msb" ? "MSB-first" : "LSB-first"} ` +
      `${hit.scan === "col" ? "列优先" : "行优先"} off${hit.offset}`;
    const text = String(hit.cleanText || hit.text || "").replace(/\s+/g, " ").trim().slice(0, 220);
    const badges = [
      hit.hasFlag ? "FLAG" : "",
      hit.base64 ? "BASE64" : "",
      hit.url ? "URL" : "",
    ].filter(Boolean).join(" ");
    lines.push(`#${i + 1} ${note} score=${hit.score}${badges ? " [" + badges + "]" : ""}`);
    lines.push(`    ${text || "(空)"}`);
  }
  if (hits.length > shown) lines.push(`……其余 ${hits.length - shown} 条未显示（用 limit 调整返回数）。`);
  lines.push("");
  lines.push(
    `限制：仅 PNG/BMP（JPEG 有损无稳定 LSB 平面）；单图像素上限 ${opts.maxPixels}；` +
    `单候选文本上限 ${opts.maxTextChars} 字符；结果按 flag/Base64/URL/评分排序。`,
  );
  return lines.join("\n");
}

export const LSB_DEEP_OP = register({
  id: "lsbDeep",
  cat: "stegoFile",
  name: "LSB 深度扫描（全通道 · 位平面）",
  desc:
    "对 PNG/BMP 枚举 通道组合 × 位平面 0-7 × 行/列优 × MSB/LSB 位序 × 起始偏移 0-7 的 LSB 提取，按 flag、Base64、URL 与可读性评分排前。与 zstegScan 的区别是列优先、位序和位偏移都参与；复用 R6 lsbDeepScan，大图自动缩短探测前缀并限额，不返回假结果。",
  acceptsBytes: true,
  aka: [
    "LSB 深入分析", "LSB 深度扫描", "LSB 全通道扫描", "LSB 位平面分析", "LSB 多偏移扫描",
    "LSB 列优先", "LSB MSB-first", "LSB bit plane scan", "LSB deep scan", "LSB stego analysis",
    "zsteg 替代", "LSB 隐写提取", "最低有效位分析", "逐位平面提取", "LSB 比特序",
  ],
  params: [
    { key: "channels", label: "通道组合（all 或 r,g,b,a,rgb,bgr,rgba,bgra）", type: "text", default: "all" },
    { key: "bits", label: "位平面（all / 0-7 / 0,1,2）", type: "text", default: "0-7" },
    { key: "orders", label: "位序（msb,lsb）", type: "text", default: "msb,lsb" },
    { key: "scans", label: "遍历方向（row,col）", type: "text", default: "row,col" },
    { key: "offsets", label: "起始位偏移（0-7）", type: "text", default: "0-7" },
    { key: "limit", label: "返回候选数", type: "number", default: 20 },
    { key: "maxPixels", label: "单图像素上限", type: "number", default: DEFAULT_MAX_PIXELS },
  ],
  decode(text, p = {}) {
    const bytes = rawBytesOf(p);
    if (!bytes) {
      return { text: "❌ LSB 深度扫描：请先选择或拖入 PNG/BMP 文件（本 op 只接受原始字节，不接受文本粘贴）。" };
    }
    const opts = {
      channels: parseChannels(p.channels),
      bits: parseIntList(p.bits, 0, 7, LS_DEEP_BITS),
      orders: parseOrders(p.orders),
      scans: parseScans(p.scans),
      offsets: parseIntList(p.offsets, 0, 7, [0, 1, 2, 3, 4, 5, 6, 7]),
      limit: clampInt(p.limit, 1, 100, 20),
      maxPixels: clampInt(p.maxPixels, 1, 1_000_000_000, DEFAULT_MAX_PIXELS),
      maxTextChars: DEFAULT_MAX_TEXT_CHARS,
      includePreviews: false,
    };
    const hits = lsbDeepScan(bytes, opts);
    if (!hits.length) {
      return {
        text:
          `LSB 深度扫描未提取到有效候选：${hits.reason || "所有组合均无可读文本"}。\n` +
          `限制：仅 PNG/BMP；单图像素上限 ${opts.maxPixels}；可调整 channels/bits/orders/scans/offsets 后重试。`,
      };
    }
    return { text: lsbDeepReport(hits, opts) };
  },
});

function rasterReport(scan, opts) {
  const lines = (scan.notes || []).slice();
  lines.push("");
  lines.push(
    `可下载：${scan.images.length} 个 PNG；` +
    `上限 maxImages=${opts.maxImages}、maxTotalPixels=${opts.maxTotalPixels}。`,
  );
  if (scan.images.length) {
    const names = scan.images.slice(0, 12).map((im) => im.name).join("、");
    lines.push(`文件：${names}${scan.images.length > 12 ? ` … 等 ${scan.images.length} 个` : ""}`);
  }
  return lines.join("\n");
}

export const RASTER_STEGO_OP = register({
  id: "rasterStego",
  cat: "stegoFile",
  name: "光栅隐写拆图（zbRasterTerminator）",
  desc:
    "复刻 zbRasterTerminator：对 PNG/BMP 的宽/高枚举 2..maxDivisor 的因数，按 x/y 轴和相位把其余行列清零，输出每张相位图 PNG（文件名如 x-5-1.png）。用于把光栅图里的隐藏文字/图案拆出来；产物直接列入可下载文件，张数/单张/总像素均有上限，超限明确报错不静默截断。",
  acceptsBytes: true,
  aka: [
    "光栅隐写", "光栅图拆图", "zbRasterTerminator", "光栅终止器", "相位拆图",
    "x/y 相位图", "光栅扫描隐写", "栅格隐写", "raster stego", "raster terminator",
    "phase decomposition", "divisor phase images", "光栅图分离", "列/行相位拆图", "栅格拆图",
  ],
  params: [
    { key: "maxDivisor", label: "最大因数（2-64，参考实现默认 10）", type: "number", default: 10 },
    { key: "both", label: "同时拆 x/y 两轴", type: "bool", default: true },
    { key: "axes", label: "轴（both=false 时生效：x,y / x / y）", type: "text", default: "x" },
    { key: "fillMode", label: "空白填充", type: "select", default: "auto", options: [
      { value: "auto", label: "自动（含 alpha 用透明）" },
      { value: "black", label: "黑色" },
      { value: "transparent", label: "透明" },
    ] },
    { key: "maxImages", label: "产物张数上限", type: "number", default: DEFAULT_RASTER_IMAGES },
    { key: "maxPixelsPerImage", label: "单张像素上限", type: "number", default: 8_000_000 },
    { key: "maxTotalPixels", label: "总像素上限", type: "number", default: DEFAULT_RASTER_TOTAL_PIXELS },
  ],
  decode(text, p = {}) {
    const bytes = rawBytesOf(p);
    if (!bytes) {
      return { text: "❌ 光栅拆图：请先选择或拖入 PNG/BMP 文件（本 op 只接受原始字节，不接受文本粘贴）。" };
    }
    const both = asBool(p.both, true);
    let axes = parseAxes(p.axes);
    if (both) axes = ["x", "y"];
    else if (!axes.length) axes = ["x"];
    const opts = {
      maxDivisor: clampInt(p.maxDivisor, 2, 64, 10),
      both,
      axes,
      fillMode: ["auto", "black", "transparent"].includes(String(p.fillMode)) ? String(p.fillMode) : "auto",
      maxImages: clampInt(p.maxImages, 1, 1024, DEFAULT_RASTER_IMAGES),
      maxPixelsPerImage: clampInt(p.maxPixelsPerImage, 1, 1_000_000_000, 8_000_000),
      maxTotalPixels: clampInt(p.maxTotalPixels, 1, 2_000_000_000, DEFAULT_RASTER_TOTAL_PIXELS),
    };
    let scan;
    try {
      scan = rasterStegoScan(bytes, opts);
    } catch (e) {
      const code = e && e.code ? `（${e.code}）` : "";
      return { text: `❌ 光栅拆图失败${code}：${e && e.message ? e.message : String(e)}` };
    }
    const files = scan.images.map((im) => ({ name: im.name, mime: im.mime, bytes: im.bytes }));
    return { text: rasterReport(scan, opts), files };
  },
});

function mp3Failure(res) {
  const code = res && res.code ? `（${res.code}）` : "";
  return {
    text:
      `❌ MP3Stego 解码失败${code}：${(res && res.reason) || "未知错误"}\n` +
      "说明：密码错误、文件未嵌入 MP3Stego 数据、或 MPEG-2/2.5 LSF 帧都会如实失败；本 op 不返回假成功。",
  };
}

function mp3Success(res) {
  if (res.meta && res.meta.extract === false) {
    const bytes = res.bytes instanceof Uint8Array ? res.bytes : new Uint8Array(res.bytes || []);
    return {
      text:
        `MP3Stego：按 extract=false 提取到加密负载 ${bytes.length} 字节（未做 3DES/gzip 解密）。\n` +
        `前 64 字节 hex：${hexPreview(bytes, 64)}`,
      files: [{ name: "mp3stego-payload.bin", mime: "application/octet-stream", bytes }],
    };
  }
  const lines = [];
  lines.push(`MP3Stego 解码成功：明文 ${res.bytes.length} 字节（UTF-8 ${res.text.length} 字符）。`);
  if (res.text) {
    lines.push("");
    lines.push(res.text);
  } else {
    lines.push("");
    lines.push(`（明文不是可读 UTF-8；前 64 字节 hex：${hexPreview(res.bytes, 64)}）`);
  }
  const meta = res.meta || {};
  lines.push("");
  lines.push(
    `元数据：MPEG-1 Layer III，帧 ${meta.frames ?? "?"}，候选位 ${meta.candidates ?? "?"}，` +
    `隐藏负载 ${meta.hiddenLength ?? "?"} 字节。`,
  );
  return { text: lines.join("\n") };
}

export const MP3_STEGO_OP = register({
  id: "mp3stego",
  cat: "stegoFile",
  name: "MP3Stego 解码（-X -P）",
  desc:
    "按 MP3Stego 1.1.19 源码复刻：读取 MPEG-1 Layer III 帧 side info 的 part2_3_length 奇偶位，用密码驱动的 SHA-1 比特流选出承载位，3DES-CBC 解密后 gunzip 还原隐藏文本/文件。密码错误、空密码、未嵌入、LSF 帧均明确失败；不调用外部 exe，不伪造成功。",
  acceptsBytes: true,
  aka: [
    "MP3Stego", "MP3 隐写", "MP3 隐写解码", "mp3stego -X -P", "MP3Stego 解码",
    "MP3 音频隐写", "MP3 最低有效位", "part2_3_length 隐写", "MP3 steganography",
    "mp3 stego decode", "MP3Stego extract", "MP3 隐藏数据", "音频隐写 MP3",
    "MP3Stego 密码", "mp3stego.exe",
  ],
  params: [
    { key: "password", label: "密码（-P）", type: "text", default: "", placeholder: "MP3Stego 编码时使用的口令" },
    { key: "extract", label: "解密并解压（false=只取加密负载）", type: "bool", default: true },
    { key: "maxPayloadBytes", label: "负载字节上限", type: "number", default: DEFAULT_MP3_PAYLOAD },
  ],
  decode(text, p = {}) {
    const bytes = rawBytesOf(p);
    if (!bytes) {
      return { text: "❌ MP3Stego 解码失败：请先选择或拖入 MP3 文件（本 op 只接受原始字节，不接受文本粘贴）。" };
    }
    const opts = {
      password: p.password == null ? "" : String(p.password),
      extract: asBool(p.extract, true),
      maxPayloadBytes: clampInt(p.maxPayloadBytes, 1, 64 * 1024 * 1024, DEFAULT_MP3_PAYLOAD),
    };
    let res;
    try {
      res = mp3stegoDecode(bytes, opts);
    } catch (e) {
      return { text: `❌ MP3Stego 解码失败：${e && e.message ? e.message : String(e)}` };
    }
    if (!res || !res.ok) return mp3Failure(res);
    return mp3Success(res);
  },
});

function thumbReport(thumbs, chosen, opts) {
  const lines = [];
  lines.push(
    `EXIF 缩略图：共找到 ${thumbs.length} 张，返回 ${chosen.length} 张` +
    `（maxCount=${opts.maxCount}，minBytes=${opts.minBytes}）。`,
  );
  chosen.forEach((t, i) => {
    lines.push(
      `#${i + 1} ${t.source} | ${t.mime} | ${t.width || "?"}×${t.height || "?"} | ${humanBytes(t.bytes.length)}（${t.bytes.length} B）`,
    );
  });
  if (thumbs.length > chosen.length) lines.push(`……其余 ${thumbs.length - chosen.length} 张因限额未返回。`);
  lines.push("");
  lines.push("限制：仅解析 JPEG APP0(JFIF)/APP1(EXIF IFD1) 与 PNG eXIf；不做任意尾部 carving。");
  return lines.join("\n");
}

export const IMAGE_THUMB_OP = register({
  id: "imageThumb",
  cat: "stegoFile",
  name: "EXIF 缩略图提取",
  desc:
    "从 JPEG 的 APP0(JFIF) / APP1(EXIF IFD1) 与 PNG eXIf chunk 中提取内嵌缩略图，按原始编码输出可下载文件（JPEG 原样、JFIF 裸 RGB 转 PNG）。无缩略图时明确说明「未发现」，不把主图或尾部数据冒充缩略图；纯字节解析，零 DOM。",
  acceptsBytes: true,
  aka: [
    "EXIF 缩略图", "EXIF 缩略图提取", "内嵌缩略图", "JPEG 缩略图", "IFD1 缩略图",
    "JFIF 缩略图", "PNG eXIf 缩略图", "EXIF thumbnail", "embedded thumbnail",
    "thumbnail extract", "EXIF 预览图", "JPEG APP1 缩略图", "缩略图检测",
    "EXIF 缩略图查看", "EXIF thumbnail recovery",
  ],
  params: [
    { key: "maxCount", label: "最多返回张数", type: "number", default: DEFAULT_THUMB_COUNT },
    { key: "minBytes", label: "最小字节数（过滤过小缩略图）", type: "number", default: 0 },
  ],
  decode(text, p = {}) {
    const bytes = rawBytesOf(p);
    if (!bytes) {
      return { text: "❌ EXIF 缩略图提取：请先选择或拖入 JPEG/PNG 文件（本 op 只接受原始字节，不接受文本粘贴）。" };
    }
    const opts = {
      maxCount: clampInt(p.maxCount, 1, 32, DEFAULT_THUMB_COUNT),
      minBytes: clampInt(p.minBytes, 0, 64 * 1024 * 1024, 0),
    };
    let thumbs;
    try {
      thumbs = extractExifThumbnails(bytes);
    } catch (e) {
      return { text: `❌ EXIF 缩略图提取失败：${e && e.message ? e.message : String(e)}` };
    }
    const all = Array.from(thumbs || []);
    if (!all.length) {
      return {
        text:
          `未发现内嵌缩略图：${(thumbs && thumbs.reason) || "未发现 EXIF/JFIF 内嵌缩略图"}。\n` +
          "说明：仅解析 JPEG APP0(JFIF)/APP1(EXIF IFD1) 与 PNG eXIf；没有缩略图时不会伪造输出。",
      };
    }
    const chosen = all.filter((t) => t.bytes.length >= opts.minBytes).slice(0, opts.maxCount);
    if (!chosen.length) {
      return {
        text:
          `找到 ${all.length} 张缩略图，但均小于 minBytes=${opts.minBytes}，已全部过滤。\n` +
          `各张尺寸：${all.map((t) => t.bytes.length + "B").join("、")}`,
      };
    }
    const base = safeBase(p.rawFileName);
    const files = chosen.map((t, i) => ({
      name: `${base}-thumb-${i + 1}.${thumbExt(t.mime)}`,
      mime: t.mime,
      bytes: t.bytes,
    }));
    return { text: thumbReport(all, chosen, opts), files };
  },
});

// StegSolve 1.4 独立 op：真正交互在 ui/stegSolvePage.js 的专用页面里。
// 这里只登记元数据与页面入口；不参与一键解码/隐写自动尝试。
export const STEGSOLVE_OP = register({
  id: "stegSolve",
  cat: "stegoFile",
  name: "StegSolve 图像分析",
  desc: "StegSolve 1.4 独立页面：42 种通道/位平面/颜色变换、Data Extract 任意通道位平面导出、Stereogram Solver、Frame Browser、Image Combiner 13 种模式、文件格式报告。支持 PNG/APNG/GIF/JPEG/BMP/WebP，全部本地计算。",
  acceptsBytes: true,
  noAuto: true,
  io: "none",
  params: [],
  run() {
    return "StegSolve 是交互式图像分析页。请在左侧「文件隐写」中打开 StegSolve 并选择图片；本 op 不参与一键解码。";
  },
});

export default {
  LSB_DEEP_OP,
  RASTER_STEGO_OP,
  MP3_STEGO_OP,
  IMAGE_THUMB_OP,
  STEGSOLVE_OP,
};
