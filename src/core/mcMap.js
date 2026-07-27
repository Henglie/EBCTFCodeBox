/*
 * mcMap.js — Minecraft 地图物品 map_#.dat 渲染成 PNG（cat:'analysis'，单向 run）。
 *
 * MC 存档 CTF 系列第 3 项（前两项 mcLevelDat/mcTextExtract）。CTF 里常用地图物品
 * 画二维码 / 像素画 / 隐藏文字，本卡把 128×128 调色板索引解码成真实 RGBA 并出 PNG。
 *
 * 直接复用 mcSave.js 的 NBT 解析器（decompressAndParseNBT），复用 pcapParse.js 的
 * inputToBytes 接 hex/base64/auto 文本输入。本卡不重写解析器。
 *
 * map_#.dat 结构（照 wiki 实现，不编造）：
 * gzip 压缩的 NBT；根 Compound → "data" 子 Compound → "colors" = ByteArray(16384)。
 * 16384 = 128×128，每字节一个调色板索引。旧版本可能字段直接在根，兼容两种。
 * 调色板：baseColorId = colorByte >> 2，shade = colorByte & 3。
 * MC 有 62 个基础色（id 0..61，0=透明），每色 4 个明暗变体，乘数
 * shade 0→180, 1→220, 2→255, 3→135；R,G,B 各 = floor(base * mult / 255)。
 * 越界基础色（62/63 等）画洋红(255,0,255)以醒目标记异常。
 *
 * 输出：手写最小 PNG 编码器（IHDR + IDAT + IEND），IDAT 用 zlib「stored」块封装
 * （未压缩 deflate block + zlib 头 + adler32），CRC32 自写。纯 JS 零 canvas 依赖
 * node 无 document 也能跑。结果给 data:image/png;base64,... + 文字摘要。
 *
 * 无 detect（analysis 类）。纯前端零外发，件内自注册。
 */
import { register } from "./registry.js";
import { inputToBytes } from "./pcapParse.js";
import { decompressAndParseNBT } from "./mcSave.js";

// ============================================================
// Compound 取值助手（Compound 项形如 { __t, v }）
// ============================================================
function entryOf(comp, key) {
  if (!comp || typeof comp !== "object") return undefined;
  const e = comp[key];
  return e && typeof e === "object" && "__t" in e ? e : undefined;
}

// ============================================================
// MC MapColor 基础色表（id 0..61，RGB）。照 Minecraft wiki MapColor 标准值。
// id 0 为透明（NONE），RGB 占位 0,0,0。
// ============================================================
const BASE_COLORS = [
  [0, 0, 0],        // 0  NONE（透明）
  [127, 178, 56],   // 1  GRASS
  [247, 233, 163],  // 2  SAND
  [199, 199, 199],  // 3  WOOL / CLOTH
  [255, 0, 0],      // 4  FIRE / TNT
  [160, 160, 255],  // 5  ICE
  [167, 167, 167],  // 6  METAL / IRON
  [0, 124, 0],      // 7  PLANT / FOLIAGE
  [255, 255, 255],  // 8  SNOW
  [164, 168, 184],  // 9  CLAY
  [151, 109, 77],   // 10 DIRT
  [112, 112, 112],  // 11 STONE
  [64, 64, 255],    // 12 WATER
  [143, 119, 72],   // 13 WOOD
  [255, 252, 245],  // 14 QUARTZ
  [216, 127, 51],   // 15 COLOR_ORANGE
  [178, 76, 216],   // 16 COLOR_MAGENTA
  [102, 153, 216],  // 17 COLOR_LIGHT_BLUE
  [229, 229, 51],   // 18 COLOR_YELLOW
  [127, 204, 25],   // 19 COLOR_LIGHT_GREEN
  [242, 127, 165],  // 20 COLOR_PINK
  [76, 76, 76],     // 21 COLOR_GRAY
  [153, 153, 153],  // 22 COLOR_LIGHT_GRAY
  [76, 127, 153],   // 23 COLOR_CYAN
  [127, 63, 178],   // 24 COLOR_PURPLE
  [51, 76, 178],    // 25 COLOR_BLUE
  [102, 76, 51],    // 26 COLOR_BROWN
  [102, 127, 51],   // 27 COLOR_GREEN
  [153, 51, 51],    // 28 COLOR_RED
  [25, 25, 25],     // 29 COLOR_BLACK
  [250, 238, 77],   // 30 GOLD
  [92, 219, 213],   // 31 DIAMOND
  [74, 128, 255],   // 32 LAPIS
  [0, 217, 58],     // 33 EMERALD
  [129, 86, 49],    // 34 PODZOL
  [112, 2, 0],      // 35 NETHER
  [209, 177, 161],  // 36 TERRACOTTA_WHITE
  [159, 82, 36],    // 37 TERRACOTTA_ORANGE
  [149, 87, 108],   // 38 TERRACOTTA_MAGENTA
  [112, 108, 138],  // 39 TERRACOTTA_LIGHT_BLUE
  [186, 133, 36],   // 40 TERRACOTTA_YELLOW
  [103, 117, 53],   // 41 TERRACOTTA_LIGHT_GREEN
  [160, 77, 78],    // 42 TERRACOTTA_PINK
  [57, 41, 35],     // 43 TERRACOTTA_GRAY
  [135, 107, 98],   // 44 TERRACOTTA_LIGHT_GRAY
  [87, 92, 92],     // 45 TERRACOTTA_CYAN
  [122, 73, 88],    // 46 TERRACOTTA_PURPLE
  [76, 62, 92],     // 47 TERRACOTTA_BLUE
  [76, 50, 35],     // 48 TERRACOTTA_BROWN
  [76, 82, 42],     // 49 TERRACOTTA_GREEN
  [142, 60, 46],    // 50 TERRACOTTA_RED
  [37, 22, 16],     // 51 TERRACOTTA_BLACK
  [189, 48, 49],    // 52 CRIMSON_NYLIUM
  [148, 63, 97],    // 53 CRIMSON_STEM
  [92, 25, 29],     // 54 CRIMSON_HYPHAE
  [22, 126, 134],   // 55 WARPED_NYLIUM
  [58, 142, 140],   // 56 WARPED_STEM
  [86, 44, 62],     // 57 WARPED_HYPHAE
  [20, 180, 133],   // 58 WARPED_WART_BLOCK
  [100, 100, 100],  // 59 DEEPSLATE
  [216, 175, 147],  // 60 RAW_IRON
  [127, 167, 150],  // 61 GLOW_LICHEN
];

// shade（低 2 位）→ 亮度乘数（照 wiki）。
const SHADE_MULT = [180, 220, 255, 135];

const MAP_W = 128;
const MAP_H = 128;
const OOR_MAGENTA = [255, 0, 255]; // 越界基础色标记色

// ============================================================
// colors(ByteArray) → RGBA（128×128）+ 统计
// 返回 { rgba, width, height, nonTransparent, blackish, whitish, oob }
// ============================================================
export function decodeColors(colors) {
  const rgba = new Uint8Array(MAP_W * MAP_H * 4);
  let nonTransparent = 0, blackish = 0, whitish = 0, oob = 0;
  const n = Math.min(colors.length, MAP_W * MAP_H);
  for (let i = 0; i < n; i++) {
    const byte = colors[i] & 0xff;
    const base = byte >> 2;
    const shade = byte & 3;
    const o = i * 4;
    if (base === 0) {
 // 透明
      rgba[o] = rgba[o + 1] = rgba[o + 2] = 0;
      rgba[o + 3] = 0;
      continue;
    }
    let src;
    if (base < BASE_COLORS.length) {
      src = BASE_COLORS[base];
    } else {
      src = OOR_MAGENTA; // 越界索引 → 洋红醒目标记
      oob++;
    }
    const m = SHADE_MULT[shade];
    const r = Math.floor((src[0] * m) / 255);
    const g = Math.floor((src[1] * m) / 255);
    const b = Math.floor((src[2] * m) / 255);
    rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
    nonTransparent++;
    if (r <= 16 && g <= 16 && b <= 16) blackish++;
    if (r >= 240 && g >= 240 && b >= 240) whitish++;
  }
  return { rgba, width: MAP_W, height: MAP_H, nonTransparent, blackish, whitish, oob };
}

// 最近邻放大（便于看二维码/像素画）。
export function scaleRGBA(rgba, w, h, scale) {
  if (scale <= 1) return { rgba, width: w, height: h };
  const nw = w * scale, nh = h * scale;
  const out = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const sy = Math.floor(y / scale);
    for (let x = 0; x < nw; x++) {
      const sx = Math.floor(x / scale);
      const so = (sy * w + sx) * 4;
      const dio = (y * nw + x) * 4;
      out[dio] = rgba[so]; out[dio + 1] = rgba[so + 1];
      out[dio + 2] = rgba[so + 2]; out[dio + 3] = rgba[so + 3];
    }
  }
  return { rgba: out, width: nw, height: nh };
}

// ============================================================
// 最小 PNG 编码器（RGBA/8-bit，无 canvas）
// IDAT 用 zlib「stored」块封装（未压缩），CRC32 / adler32 自写。
// ============================================================
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf, start, end) {
  let c = 0xFFFFFFFF;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function adler32(buf) {
  let a = 1, b = 0;
  const MOD = 65521;
 // 分段取模，避免大图溢出
  let i = 0;
  const len = buf.length;
  while (i < len) {
    const end = Math.min(i + 5552, len);
    for (; i < end; i++) { a += buf[i]; b += a; }
    a %= MOD; b %= MOD;
  }
  return ((b << 16) | a) >>> 0;
}

function u32be(n) {
  return new Uint8Array([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

// zlib 流：78 01 头 + 若干 stored(未压缩) deflate 块 + 4 字节 big-endian adler32。
function zlibStore(raw) {
  const parts = [];
  parts.push(new Uint8Array([0x78, 0x01])); // CMF/FLG（CM=8 CINFO=7，FCHECK 使 %31==0）
  const MAX = 65535;
  let off = 0;
  do {
    const len = Math.min(MAX, raw.length - off);
    const isFinal = (off + len >= raw.length) ? 1 : 0;
    const hdr = new Uint8Array(5);
    hdr[0] = isFinal; // BFINAL + BTYPE=00(stored)
    hdr[1] = len & 0xff; hdr[2] = (len >>> 8) & 0xff;
    const nlen = (~len) & 0xffff;
    hdr[3] = nlen & 0xff; hdr[4] = (nlen >>> 8) & 0xff;
    parts.push(hdr);
    parts.push(raw.subarray(off, off + len));
    off += len;
  } while (off < raw.length);
  const ad = adler32(raw);
  parts.push(new Uint8Array([(ad >>> 24) & 0xff, (ad >>> 16) & 0xff, (ad >>> 8) & 0xff, ad & 0xff]));
  return concat(parts);
}

function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function pngChunk(type, data) {
  const len = data.length;
  const full = new Uint8Array(4 + 4 + len + 4);
  full.set(u32be(len), 0);
  for (let i = 0; i < 4; i++) full[4 + i] = type.charCodeAt(i);
  full.set(data, 8);
  const crc = crc32(full, 4, 8 + len); // 覆盖 type + data
  full.set(u32be(crc), 8 + len);
  return full;
}

/** RGBA 字节 + 宽高 → PNG 文件字节（Uint8Array）。8-bit 真彩带 alpha（colortype 6）。 */
export function encodePNG(rgba, width, height) {
  const sig = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(width), 0);
  ihdr.set(u32be(height), 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
 // 原始扫描线：每行前置 1 字节 filter(0)
  const rowLen = width * 4;
  const raw = new Uint8Array(height * (1 + rowLen));
  for (let y = 0; y < height; y++) {
    const ro = y * (1 + rowLen);
    raw[ro] = 0; // filter type None
    raw.set(rgba.subarray(y * rowLen, (y + 1) * rowLen), ro + 1);
  }
  const idat = zlibStore(raw);
  return concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

// ============================================================
// 字节 → base64（浏览器 btoa / node Buffer 兜底）
// ============================================================
function bytesToB64(bytes) {
  if (typeof globalThis.btoa === "function") {
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + 8192)));
    }
    return globalThis.btoa(s);
  }
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  throw new Error("无 base64 编码器（btoa/Buffer 均不可用）");
}

/** RGBA + 宽高 → data:image/png;base64,... */
export function rgbaToDataURL(rgba, width, height) {
  return "data:image/png;base64," + bytesToB64(encodePNG(rgba, width, height));
}

// ============================================================
// run
// ============================================================
async function mcMapRenderRun(text, p = {}) {
  if ((!text || !String(text).trim()) && !(p && p.rawBytes && p.rawBytes.length)) {
    return "（空输入）请粘贴 map_#.dat 文件的 hex 或 base64。\n" +
      "map_#.dat 是 gzip 压缩的 NBT，位于世界存档 data/ 目录；根下 data.colors 为 16384 字节\n" +
      "（128×128）调色板索引。本工具解码成 128×128 RGBA 并输出 PNG（data URL）。\n" +
      "CTF 常用地图物品画二维码 / 像素画 / 隐藏文字。";
  }
  let bytes;
  try {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：直接用真字节，跳过 hex/base64 文本解析。
    bytes = (p && p.rawBytes && p.rawBytes.length)
      ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
      : inputToBytes(text, p.inputEnc || "auto");
  } catch (e) {
    return "输入解析失败：" + (e && e.message ? e.message : String(e));
  }
  if (bytes.length < 3) return "（输入过短）不足一个 gzip 头。";

  let parsed;
  try {
    parsed = await decompressAndParseNBT(bytes);
  } catch (e) {
    return "解析失败：" + (e && e.message ? e.message : String(e));
  }

  const root = parsed.root;
  if (!root || root.type !== 10) return "根不是 Compound，非标准 map_#.dat 结构。";

 // 兼容：新版 data.colors；旧版可能字段直接在根
  const dataEntry = entryOf(root.value, "data");
  const dataComp = dataEntry && dataEntry.__t === 10 ? dataEntry.v : root.value;
  const colorsEntry = entryOf(dataComp, "colors");
  if (!colorsEntry || colorsEntry.__t !== 7) {
    return "未找到 data.colors（ByteArray）。这可能不是地图物品 map_#.dat；" +
      "确认文件来自存档 data/ 目录（level.dat/region 用 mcLevelDat/mcTextExtract）。";
  }
  const colors = colorsEntry.v; // Uint8Array

  let scale = parseInt(p.scale, 10);
  if (![1, 2, 4].includes(scale)) scale = 2;

  const dec = decodeColors(colors);
  const scaled = scaleRGBA(dec.rgba, dec.width, dec.height, scale);
  const dataURL = rgbaToDataURL(scaled.rgba, scaled.width, scaled.height);

  const lines = [];
  lines.push("=== Minecraft 地图物品渲染（map_#.dat）===");
  lines.push(`解压: ${parsed.note}`);
  lines.push(`colors 长度: ${colors.length} 字节${colors.length !== MAP_W * MAP_H ? `（异常，标准应为 ${MAP_W * MAP_H}）` : "（标准 128×128）"}`);
  lines.push(`原始尺寸: ${MAP_W}×${MAP_H}；输出尺寸: ${scaled.width}×${scaled.height}（放大 ${scale}×，最近邻）`);
  lines.push(`非透明像素: ${dec.nonTransparent} / ${MAP_W * MAP_H}`);
  if (dec.oob) lines.push(`⚠ 越界基础色像素 ${dec.oob} 个（已画洋红标记，可能版本较新或数据异常）`);
  lines.push("");

 // 疑似全黑 / 全白提示
  const opaque = dec.nonTransparent;
  if (opaque === 0) {
    lines.push("⚠ 全透明：无任何着色像素。地图可能未探索（空白地图）或 colors 全 0。");
  } else {
    if (dec.blackish === opaque) lines.push("⚠ 疑似全黑：所有非透明像素都接近黑色，二维码/文字可能是黑底，注意对比或反色查看。");
    else if (dec.whitish === opaque) lines.push("⚠ 疑似全白：所有非透明像素都接近白色。");
    else {
      lines.push(`色彩分布: 近黑像素 ${dec.blackish}，近白像素 ${dec.whitish}，其余 ${opaque - dec.blackish - dec.whitish}。`);
    }
  }
  lines.push("");
  lines.push("--- PNG（data URL，可直接粘贴进浏览器地址栏 / <img src> 查看）---");
  lines.push(dataURL);

  return lines.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "mcMapRender",
  cat: "forensic",
  name: "Minecraft 地图渲染",
  desc: "把 Minecraft Java 版地图物品 map_#.dat（gzip NBT，根下 data.colors 为 128×128 调色板索引）" +
    "渲染成 PNG：内置 62 个 MapColor 基础色 + 4 档明暗，解码 16384 字节为 RGBA，" +
    "手写最小 PNG 编码器（零 canvas 依赖）输出 data URL。CTF 常用地图画二维码/像素画/隐藏文字。" +
    "支持最近邻放大便于看二维码。复用 mcSave 的 NBT 解析器，纯前端零外发",
  params: [
    { key: "inputEnc", label: "输入编码", type: "select", default: "auto", options: [
      { value: "auto", label: "自动识别" }, { value: "hex", label: "Hex 十六进制" }, { value: "base64", label: "Base64" },
    ] },
    { key: "scale", label: "放大倍数", type: "select", default: "2", options: [
      { value: "1", label: "1× (128×128)" }, { value: "2", label: "2× (256×256)" }, { value: "4", label: "4× (512×512)" },
    ] },
  ],
  run: mcMapRenderRun,
  acceptsBytes: true,
});

// 供测试导出（纯函数）
export { BASE_COLORS, SHADE_MULT };
export default { decodeColors, scaleRGBA, encodePNG, rgbaToDataURL, BASE_COLORS, SHADE_MULT };
