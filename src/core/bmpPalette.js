/*
 * bmpPalette.js — BMP 调色板隐写分析（cat:'stego'，run 型单向分析）。
 *
 * 定位：CTF 图像取证高频。针对 8-bit（及 1/4-bit）索引 BMP 的调色板隐写
 * 专攻信息藏在「调色板」而非像素数据里的场景。对应 ctf-wiki misc 图像隐写节。
 *
 * BMP 结构（Windows BMP，小端）：
 * BITMAPFILEHEADER (14 字节)：
 * "BM"(2) + 文件大小(4) + 保留1(2) + 保留2(2) + 像素数据偏移 bfOffBits(4)
 * BITMAPINFOHEADER (40 字节，biSize=40)：
 * biSize(4) + biWidth(4,有符号) + biHeight(4,有符号,负=自上而下) + biPlanes(2)
 * + biBitCount(2) + biCompression(4) + biSizeImage(4) + biXPPM(4) + biYPPM(4)
 * + biClrUsed(4) + biClrImportant(4)
 * 调色板（仅 1/4/8-bit 有）：每项 4 字节 BGRA/BGR0（B, G, R, 保留/Alpha）。
 * 项数 = biClrUsed（为 0 时取 2^biBitCount）。
 * 像素数据：从 bfOffBits 起，每行按 4 字节对齐（padding）。
 *
 * 隐写候选（CTF 常见手法）：
 * ① 调色板 LSB：每项 B/G/R（可选含 A）最低位拼 bit 流 → ASCII。
 * ② 调色板项索引顺序：正常调色板有序/渐变，flag 藏在排列里 → 输出索引序列摘要。
 * ③ 相邻项差值：相邻调色板项分量差编码 bit（差为 0/1 或奇偶）。
 * ④ 未用索引：像素只用了少数索引，未用到的调色板项常藏数据 → 单独 dump LSB。
 *
 * 红线：
 * - 算法层零 UI 依赖（仅 import registry）。
 * - 零外发：纯本地字节计算。
 * - 件内自注册（register(op)）。
 * - 无 emoji，报告用黑白几何符号（● ✓ ← ▸ × ✗ ⚠）。
 *
 * 契约：register({id:'bmpPalette', cat:'stego', name, desc, params, run})。
 * 输入：BMP 文件的 hex 或 base64 文本（parseInput 自动判别，自备不 import）。
 */
import { register } from "./registry.js";

// ============================================================
// 输入解析（自备，仿 xorAnalyze，不 import）
// ============================================================
function hexToBytes(s) {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("hex 长度需为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function base64ToBytes(s) {
  let str = s.replace(/\s+/g, "");
 // 兼容 dataURL 前缀
  const comma = str.indexOf(",");
  if (comma >= 0 && str.slice(0, 5).toLowerCase() === "data:") str = str.slice(comma + 1);
  let bin;
  if (typeof atob === "function") bin = atob(str);
  else if (typeof Buffer !== "undefined") bin = Buffer.from(str, "base64").toString("binary");
  else throw new Error("无 atob/Buffer，无法解码 base64");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 自动判别 hex / base64 → Uint8Array。inputEnc: 'auto'|'hex'|'base64'。 */
function parseInput(text, inputEnc) {
  const s = String(text || "").trim();
  if (!s) return new Uint8Array(0);
  if (inputEnc === "hex") return hexToBytes(s);
  if (inputEnc === "base64") return base64ToBytes(s);
 // auto：纯 hex（去空白后全 0-9a-fA-F 且偶数长）走 hex，否则 base64
  const stripped = s.replace(/\s/g, "");
  if (/^[0-9a-fA-F]+$/.test(stripped) && stripped.length % 2 === 0 && stripped.length >= 4) {
 // 且以 "424d"（"BM" 的 hex）开头更确定，但不强制
    return hexToBytes(s);
  }
  return base64ToBytes(s);
}

// ============================================================
// 小端读取
// ============================================================
function readU16le(b, o) {
  return (b[o] | (b[o + 1] << 8)) >>> 0;
}
function readU32le(b, o) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}
function readI32le(b, o) {
  return readU32le(b, o) | 0; // 有符号
}

// ============================================================
// bit 流 → ASCII（每 8 bit 组一字节）
// ============================================================
function bitsToAscii(bits) {
  let s = "";
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | (bits[i + j] & 1);
    s += String.fromCharCode(byte);
  }
  return s;
}

// bit 流 → ASCII（LSB-first 每字节内低位优先）
function bitsToAsciiLsbFirst(bits) {
  let s = "";
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte |= (bits[i + j] & 1) << j;
    s += String.fromCharCode(byte);
  }
  return s;
}

// 可打印摘要（非打印用 ·）
function printablePreview(s, max) {
  const n = Math.min(s.length, max == null ? s.length : max);
  let out = "";
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i);
    out += (c >= 0x20 && c <= 0x7e) ? s[i] : "·";
  }
  if (s.length > n) out += "…";
  return out;
}

// flag 正则命中检测（返回命中数组）
const FLAG_RE = /(flag|ctf|key|FLAG|CTF|KEY)[^\s]*\{[^}]*\}/g;
const FLAG_RE_LOOSE = /[A-Za-z0-9_]{2,10}\{[ -~]{1,120}\}/g;
function findFlags(s) {
  const hits = [];
  let m;
  FLAG_RE.lastIndex = 0;
  while ((m = FLAG_RE.exec(s)) !== null) hits.push(m[0]);
  if (hits.length === 0) {
    FLAG_RE_LOOSE.lastIndex = 0;
    while ((m = FLAG_RE_LOOSE.exec(s)) !== null) {
 // 粗筛：花括号内需含可读字符
      if (/[A-Za-z0-9]{3,}/.test(m[0])) hits.push(m[0]);
    }
  }
 // 去重
  return [...new Set(hits)];
}

function hexByte(v) {
  return (v & 0xff).toString(16).padStart(2, "0");
}

// ============================================================
// BMP 解析
// ============================================================
function parseBmp(bytes) {
  if (bytes.length < 14) throw new Error("文件过短（< 14 字节），非 BMP");
  if (bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    throw new Error(`非 BMP 文件（缺 "BM" 签名，首字节=${hexByte(bytes[0])}${hexByte(bytes[1])}）`);
  }
  const fileSize = readU32le(bytes, 2);
  const reserved1 = readU16le(bytes, 6);
  const reserved2 = readU16le(bytes, 8);
  const offBits = readU32le(bytes, 10);

  if (bytes.length < 14 + 40) throw new Error("信息头不完整（< 54 字节）");
  const biSize = readU32le(bytes, 14);
  const width = readI32le(bytes, 18);
  const heightRaw = readI32le(bytes, 22);
  const topDown = heightRaw < 0;
  const height = Math.abs(heightRaw);
  const planes = readU16le(bytes, 26);
  const bitCount = readU16le(bytes, 28);
  const compression = readU32le(bytes, 30);
  const sizeImage = readU32le(bytes, 34);
  const xppm = readI32le(bytes, 38);
  const yppm = readI32le(bytes, 42);
  const clrUsed = readU32le(bytes, 46);
  const clrImportant = readU32le(bytes, 50);

 // 调色板项数：biClrUsed 为 0 时取 2^bitCount（仅 <=8 位有调色板）
  let paletteCount = 0;
  const hasPalette = bitCount === 1 || bitCount === 4 || bitCount === 8;
  if (hasPalette) {
    paletteCount = clrUsed > 0 ? clrUsed : (1 << bitCount);
  }

 // 调色板起点：文件头(14) + 信息头(biSize)
  const paletteStart = 14 + biSize;

  return {
    fileSize, reserved1, reserved2, offBits,
    biSize, width, height, topDown, planes, bitCount,
    compression, sizeImage, xppm, yppm, clrUsed, clrImportant,
    hasPalette, paletteCount, paletteStart,
  };
}

const COMPRESSION_NAMES = {
  0: "BI_RGB（无压缩）",
  1: "BI_RLE8",
  2: "BI_RLE4",
  3: "BI_BITFIELDS",
  4: "BI_JPEG",
  5: "BI_PNG",
};

// 读取调色板（每项 4 字节 B,G,R,A）
function readPalette(bytes, hdr) {
  const entries = [];
  let off = hdr.paletteStart;
  for (let i = 0; i < hdr.paletteCount; i++) {
    if (off + 4 > bytes.length) break; // 越界防护
    entries.push({
      b: bytes[off],
      g: bytes[off + 1],
      r: bytes[off + 2],
      a: bytes[off + 3],
      idx: i,
    });
    off += 4;
  }
  return entries;
}

// 调色板有序性判定：按亮度（或 R+G+B）是否单调不减
function analyzeOrder(pal) {
  let mono = true;
  let dupCount = 0;
  const seen = new Map();
  for (let i = 0; i < pal.length; i++) {
    const key = (pal[i].r << 16) | (pal[i].g << 8) | pal[i].b;
    seen.set(key, (seen.get(key) || 0) + 1);
    if (i > 0) {
      const prev = pal[i - 1].r + pal[i - 1].g + pal[i - 1].b;
      const cur = pal[i].r + pal[i].g + pal[i].b;
      if (cur < prev) mono = false;
    }
  }
  for (const v of seen.values()) if (v > 1) dupCount += v - 1;
  const isGrayscale = pal.every((e) => e.r === e.g && e.g === e.b);
  return { mono, dupCount, uniqueColors: seen.size, isGrayscale };
}

// 候选①：每项 B/G/R（可选 A）最低位拼 bit 流
function extractLsbBits(pal, channels) {
  const bits = [];
  for (const e of pal) {
    if (channels.includes("b")) bits.push(e.b & 1);
    if (channels.includes("g")) bits.push(e.g & 1);
    if (channels.includes("r")) bits.push(e.r & 1);
    if (channels.includes("a")) bits.push(e.a & 1);
  }
  return bits;
}

// 候选③：相邻项差值 → bit（差非零=1，或差的奇偶）
function extractDiffBits(pal, channel) {
  const bits = [];
  const pick = (e) => (channel === "r" ? e.r : channel === "g" ? e.g : channel === "b" ? e.b : e.a);
  for (let i = 1; i < pal.length; i++) {
    const d = (pick(pal[i]) - pick(pal[i - 1])) & 0xff;
    bits.push(d & 1); // 差值最低位
  }
  return bits;
}

// 统计像素数据实际用到的索引（仅 8-bit 无压缩时精确，其他给近似/跳过）
function analyzeUsedIndices(bytes, hdr) {
  const used = new Set();
  if (hdr.bitCount === 8 && hdr.compression === 0) {
    const rowBytes = hdr.width; // 8-bit：每像素 1 字节
    const rowPadded = Math.floor((rowBytes + 3) / 4) * 4;
    let off = hdr.offBits;
    for (let y = 0; y < hdr.height; y++) {
      if (off + rowBytes > bytes.length) break;
      for (let x = 0; x < hdr.width; x++) used.add(bytes[off + x]);
      off += rowPadded;
    }
    return { used, exact: true };
  }
  if ((hdr.bitCount === 1 || hdr.bitCount === 4) && hdr.compression === 0) {
    const bitsPerRow = hdr.width * hdr.bitCount;
    const rowBytes = Math.floor((bitsPerRow + 7) / 8);
    const rowPadded = Math.floor((rowBytes + 3) / 4) * 4;
    let off = hdr.offBits;
    const mask = (1 << hdr.bitCount) - 1;
    const perByte = 8 / hdr.bitCount;
    for (let y = 0; y < hdr.height; y++) {
      if (off + rowBytes > bytes.length) break;
      for (let x = 0; x < hdr.width; x++) {
        const byteIdx = off + Math.floor(x / perByte);
        const within = x % perByte;
        const shift = 8 - hdr.bitCount * (within + 1);
        used.add((bytes[byteIdx] >> shift) & mask);
      }
      off += rowPadded;
    }
    return { used, exact: true };
  }
  return { used, exact: false };
}

// ============================================================
// run 主入口
// ============================================================
function bmpPaletteRun(text, p) {
  const inputEnc = (p && p.inputEnc) || "auto";
  const lsbChannels = (p && p.lsbChannels) || "bgr";
  const maxDump = Math.max(4, Math.min(256, parseInt((p && p.maxDump) || "64", 10) || 64));
  const showAscii = p ? p.showAscii !== false : true;

  const L = [];
  L.push("=== BMP 调色板隐写分析 ===");
  L.push("");

  let bytes;
  try {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：真字节优先，跳过 hex/base64 文本解析。
    bytes = (p && p.rawBytes && p.rawBytes.length)
      ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
      : parseInput(text, inputEnc);
  } catch (e) {
    L.push("✗ 输入解析失败: " + (e.message || String(e)));
    return L.join("\n");
  }
  if (bytes.length === 0) {
    L.push("✗ 输入为空。请粘贴 BMP 文件的 hex 或 base64。");
    return L.join("\n");
  }

  let hdr;
  try {
    hdr = parseBmp(bytes);
  } catch (e) {
    L.push("✗ BMP 解析失败: " + (e.message || String(e)));
    return L.join("\n");
  }

 // ---- 头信息 ----
  L.push("--- BMP 头 ---");
  L.push(`● 文件大小(声明): ${hdr.fileSize} 字节  实际: ${bytes.length} 字节` +
    (hdr.fileSize !== bytes.length ? "  ⚠ 不一致（可能附加数据/截断）" : ""));
  L.push(`● 像素数据偏移 bfOffBits: ${hdr.offBits}`);
  if (hdr.reserved1 !== 0 || hdr.reserved2 !== 0) {
    L.push(`  ⚠ 保留字段非零: reserved1=${hdr.reserved1} reserved2=${hdr.reserved2}（偶有藏数据）`);
  }
  L.push(`● 信息头大小 biSize: ${hdr.biSize}` + (hdr.biSize !== 40 ? "（非标准 40，可能 V4/V5 头或其他变体）" : ""));
  L.push(`● 尺寸: ${hdr.width} × ${hdr.height}` + (hdr.topDown ? "（自上而下 top-down）" : "（自下而上 bottom-up）"));
  L.push(`● 位深 biBitCount: ${hdr.bitCount} 位`);
  L.push(`● 压缩 biCompression: ${hdr.compression}（${COMPRESSION_NAMES[hdr.compression] || "未知"}）`);
  L.push(`● biClrUsed: ${hdr.clrUsed}  biClrImportant: ${hdr.clrImportant}`);
  L.push("");

 // ---- 无调色板位深 ----
  if (!hdr.hasPalette) {
    L.push(`✗ 位深 ${hdr.bitCount} 位无调色板（24/32-bit 为直接色 RGB/RGBA）。`);
    L.push("  本 op 专攻 1/4/8-bit 索引 BMP 的调色板隐写。");
    L.push("  对 24/32-bit BMP 的像素 LSB 隐写，请用像素级 LSB 分析工具。");
    return L.join("\n");
  }

  const pal = readPalette(bytes, hdr);
  L.push(`--- 调色板（声明 ${hdr.paletteCount} 项，实读 ${pal.length} 项）---`);
  if (pal.length < hdr.paletteCount) {
    L.push(`  ⚠ 实读项数 < 声明项数，文件可能截断。`);
  }

  const ord = analyzeOrder(pal);
  L.push(`● 唯一颜色数: ${ord.uniqueColors} / ${pal.length}` +
    (ord.dupCount > 0 ? `  ▸ 重复色 ${ord.dupCount} 项（重复色常用于藏数据/占位）` : ""));
  L.push(`● 亮度单调性: ${ord.mono ? "单调不减（有序，可能正常渐变）" : "非单调（排序被打乱，flag 可能藏在排列顺序里）"}`);
  L.push(`● 灰度调色板: ${ord.isGrayscale ? "是（R=G=B，标准灰度斜坡）" : "否（含彩色项）"}`);
  L.push("");

 // ---- dump 调色板 ----
  L.push(`--- 调色板项 dump（前 ${Math.min(maxDump, pal.length)} 项，格式 idx: R G B A | 与前项差 ΔR ΔG ΔB）---`);
  const dumpN = Math.min(maxDump, pal.length);
  for (let i = 0; i < dumpN; i++) {
    const e = pal[i];
    let diff = "";
    if (i > 0) {
      const dr = e.r - pal[i - 1].r;
      const dg = e.g - pal[i - 1].g;
      const db = e.b - pal[i - 1].b;
      diff = `  | Δ ${dr >= 0 ? "+" : ""}${dr} ${dg >= 0 ? "+" : ""}${dg} ${db >= 0 ? "+" : ""}${db}`;
    }
    L.push(`  ${String(i).padStart(3)}: ${String(e.r).padStart(3)} ${String(e.g).padStart(3)} ${String(e.b).padStart(3)} ${String(e.a).padStart(3)}` +
      `  #${hexByte(e.r)}${hexByte(e.g)}${hexByte(e.b)}` + diff);
  }
  if (pal.length > dumpN) L.push(`  …（还有 ${pal.length - dumpN} 项未显示，调大 maxDump 查看）`);
  L.push("");

  const allFlags = [];

 // ---- 候选①：调色板 LSB ----
  L.push("--- 候选① 调色板 LSB（每项通道最低位拼 bit 流）---");
  const chanList = lsbChannels.split("").filter((c) => "bgra".includes(c));
  L.push(`● 抽取通道: ${chanList.join("/").toUpperCase()}（顺序即拼接顺序，可用 lsbChannels 参数调整）`);
  {
    const bits = extractLsbBits(pal, chanList);
    const msbAscii = bitsToAscii(bits);
    const lsbAscii = bitsToAsciiLsbFirst(bits);
    L.push(`  bit 数: ${bits.length}（≈ ${Math.floor(bits.length / 8)} 字节）`);
    L.push(`  ▸ MSB-first ASCII: ${showAscii ? printablePreview(msbAscii, 200) : "(已关闭)"}`);
    L.push(`  ▸ LSB-first ASCII: ${showAscii ? printablePreview(lsbAscii, 200) : "(已关闭)"}`);
    for (const s of [msbAscii, lsbAscii]) {
      const f = findFlags(s);
      for (const x of f) allFlags.push({ from: "调色板 LSB", flag: x });
    }
  }
  L.push("");

 // ---- 候选②：索引顺序 ----
  L.push("--- 候选② 调色板项索引顺序 ---");
  if (ord.mono) {
    L.push("  ● 调色板有序（单调），排列顺序无异常，flag 藏在顺序的可能性低。");
  } else {
    L.push("  ● 调色板非单调。若原图按亮度排序被打乱，索引置换本身可能编码信息。");
 // 输出「按亮度排序后的原索引序列」摘要 → 若这串是 ASCII 码则可能是 flag
    const withLum = pal.map((e) => ({ idx: e.idx, lum: e.r + e.g + e.b }));
    const sorted = [...withLum].sort((a, b) => a.lum - b.lum);
    const permStr = sorted.map((x) => x.idx).slice(0, 64).join(",");
    L.push(`  ▸ 按亮度升序排列后的原索引序列（前 64）: ${permStr}`);
 // 尝试把「原索引」当 ASCII（有时 flag 每字符 = 某调色板项索引值）
    const asAscii = pal.map((e) => e.idx).filter((v) => v >= 32 && v <= 126);
 // idx 就是 0..n 本身，意义不大；改看「像素首行索引序列」在下面 used 分析处
  }
  L.push("");

 // ---- 候选③：相邻项差值 ----
  L.push("--- 候选③ 相邻项差值 LSB（相邻项分量差的最低位）---");
  for (const ch of ["r", "g", "b"]) {
    const bits = extractDiffBits(pal, ch);
    const s1 = bitsToAscii(bits);
    const s2 = bitsToAsciiLsbFirst(bits);
    L.push(`  [${ch.toUpperCase()} 差] MSB: ${printablePreview(s1, 80)}`);
    L.push(`  [${ch.toUpperCase()} 差] LSB: ${printablePreview(s2, 80)}`);
    for (const s of [s1, s2]) {
      const f = findFlags(s);
      for (const x of f) allFlags.push({ from: `相邻${ch.toUpperCase()}差`, flag: x });
    }
  }
  L.push("");

 // ---- 索引使用统计 ----
  L.push("--- 索引使用统计（像素实际用到 vs 调色板总项）---");
  const usedInfo = analyzeUsedIndices(bytes, hdr);
  if (!usedInfo.exact) {
    L.push(`  ⚠ 压缩方式 ${hdr.compression}（${COMPRESSION_NAMES[hdr.compression] || "未知"}）暂不解析像素索引，跳过统计。`);
  } else {
    const usedN = usedInfo.used.size;
    L.push(`● 像素实际用到 ${usedN} 个索引 / 调色板共 ${pal.length} 项`);
    if (usedN === 1) {
      const only = [...usedInfo.used][0];
      L.push(`  ⚠ 像素全用同一索引 ${only}！真信息几乎必在调色板本身（见候选①③）。`);
    } else if (usedN < pal.length) {
      const unused = [];
      for (let i = 0; i < pal.length; i++) if (!usedInfo.used.has(i)) unused.push(i);
      L.push(`  ▸ 未用到的调色板项 ${unused.length} 个: ${unused.slice(0, 64).join(",")}` +
        (unused.length > 64 ? "…" : ""));
      L.push("  ▸ 未用项常单独藏数据，下方单独抽取其 LSB：");
      const unusedPal = unused.map((i) => pal[i]);
      const ubits = extractLsbBits(unusedPal, chanList);
      const uMsb = bitsToAscii(ubits);
      const uLsb = bitsToAsciiLsbFirst(ubits);
      L.push(`    MSB: ${printablePreview(uMsb, 120)}`);
      L.push(`    LSB: ${printablePreview(uLsb, 120)}`);
      for (const s of [uMsb, uLsb]) {
        const f = findFlags(s);
        for (const x of f) allFlags.push({ from: "未用项 LSB", flag: x });
      }
    } else {
      L.push("  ● 调色板项全部被使用，无未用项藏数据的空间。");
    }
  }
  L.push("");

 // ---- 附加数据（bfOffBits 之外 / 文件尾） ----
  {
 // 计算理论像素数据长度
    if (hdr.compression === 0) {
      const bitsPerRow = hdr.width * hdr.bitCount;
      const rowBytes = Math.floor((bitsPerRow + 7) / 8);
      const rowPadded = Math.floor((rowBytes + 3) / 4) * 4;
      const pixelDataLen = rowPadded * hdr.height;
      const expectedEnd = hdr.offBits + pixelDataLen;
      if (expectedEnd < bytes.length) {
        const trailer = bytes.subarray(expectedEnd);
        L.push(`--- 尾部附加数据 ---`);
        L.push(`  ⚠ 像素数据理论结束于偏移 ${expectedEnd}，文件却有 ${bytes.length} 字节 → 尾部 ${trailer.length} 字节附加数据`);
        let tstr = "";
        for (let i = 0; i < Math.min(trailer.length, 200); i++) tstr += String.fromCharCode(trailer[i]);
        L.push(`  ▸ 尾部预览: ${printablePreview(tstr, 200)}`);
        const f = findFlags(tstr);
        for (const x of f) allFlags.push({ from: "尾部附加", flag: x });
        L.push("");
      }
    }
  }

 // ---- flag 命中汇总 ----
  L.push("--- flag 命中汇总 ---");
  if (allFlags.length > 0) {
    const uniq = new Set();
    for (const it of allFlags) {
      const k = it.from + "|" + it.flag;
      if (uniq.has(k)) continue;
      uniq.add(k);
      L.push(`  ✓ [${it.from}] ${it.flag}`);
    }
  } else {
    L.push("  × 各候选未命中 flag{}/ctf{} 等模式。");
    L.push("  提示：可试① 调整 lsbChannels（如 rgb / bgra / r）② 手工拼接上方 bit 流");
    L.push("        ③ 检查候选② 的索引置换序列 ④ 关注重复色/未用项。");
  }

  L.push("");
  L.push("说明:");
  L.push("  · 本 op 只分析（run 型），不修改文件；纯本地计算，零外发。");
  L.push("  · 候选①LSB 最常见；②顺序隐写需结合原图排序约定；③差值编码较少见。");
  L.push("  · 通道顺序影响 LSB 拼接结果，BMP 调色板存储序为 B,G,R,A。");
  return L.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "bmpPalette",
  cat: "stego",
  name: "BMP 调色板隐写分析",
  desc: "解析 1/4/8-bit 索引 BMP 调色板：dump 全部项 + 抽取 LSB/索引顺序/相邻差值隐写候选 + 未用索引统计，命中 flag 高亮",
  params: [
    {
      key: "inputEnc", label: "输入编码", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（hex/base64）" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
      ],
    },
    {
      key: "lsbChannels", label: "LSB 抽取通道(顺序)", type: "text", default: "bgr",
      placeholder: "b/g/r/a 组合，如 bgr、rgb、bgra、r",
    },
    { key: "maxDump", label: "调色板 dump 最大项数", type: "number", default: 64, placeholder: "4-256" },
    { key: "showAscii", label: "显示 LSB 的 ASCII 预览", type: "bool", default: true },
  ],
  run: bmpPaletteRun,
  acceptsBytes: true,
});

export {
  bmpPaletteRun,
  parseInput,
  parseBmp,
  readPalette,
  extractLsbBits,
  extractDiffBits,
  bitsToAscii,
  bitsToAsciiLsbFirst,
  findFlags,
};
