/*
 * zipExtract.js — ZIP 条目列表 / 提取 / 解密导出（cat:'archive'）。
 *
 * 两个 op：
 * - zipEntries：只读中央目录，列出名称、压缩法（Stored/Deflate/其他）、压缩/原始大小、
 *   CRC32、加密标志、DOS 时间、本地头偏移，并标出路径穿越风险。
 * - zipExtract：按条目名（或留空=全部）真解压 Stored / Deflate，返回
 *   { text, files:[{name,mime,bytes}] } 产物协议；纯内存，不写磁盘。
 *
 * 解析路径（纯 JS，自持轻量 ZIP 解析，不依赖 UI）：
 *   EOCD（尾部倒找）→ 中央目录逐条 → LFH 重读名长/扩展长 → 切压缩数据 →
 *   method 0 直取 / method 8 用 pcapDeep.inflateRaw（RFC 1951）→ 长度与 CRC32 双验。
 *   拼接件（前缀字节 + ZIP）按「中央目录紧贴 EOCD 之前」反推偏移，与主流解压器一致。
 *
 * 加密口径（绝不假装解密）：
 * - ZipCrypto（传统 PKWARE，flag bit0=1 且 method≠99）：复用 zipCrack.js 导出的
 *   keysFromPassword / decryptByte / updateKeys 原语，按 12 字节加密头 + 校验字节
 *   解密；用户需在 password 参数填口令。未填口令 → 明确提示先用 zipBrute 取口令。
 * - 伪加密（flag=1 但数据其实是明文）：先按明文试解 + CRC 校验，通过则标记「伪加密」。
 * - WinZip AES（method 99 / 0x9901 extra）：现有 zipBrute 只验证口令、不还原明文，
 *   本工具如实报「AES 暂不支持内容解密」，不输出任何伪造内容。
 * - 强加密（flag bit6）与其他加密：明确报不支持。
 *
 * 安全：
 * - 条目名可能含 ../、绝对路径、盘符、控制字符；本工具从不写文件系统，下载产物
 *   一律压平为安全 basename，并在报告里标「路径穿越风险」。
 * - 解压输出受 inflateRaw 的 64 MiB 单流上限与提取总预算约束；条目数/文件数有上限。
 *
 * 零外发：全部本地字节计算，无网络、无桥、无 DOM。
 */
import { register } from "./registry.js";
import { inputToBytes, bytesToOutput } from "./compress.js";
import { inflateRaw } from "./pcapDeep.js";
import { findEocd, crc32Bytes } from "./zipRepair.js";
import {
  keysFromPassword, decryptByte, updateKeys, parseAesExtra,
} from "./zipCrack.js";

// ============================================================
// 基础工具
// ============================================================

const u16 = (b, o) => (b[o] | (b[o + 1] << 8)) >>> 0;
const u32 = (b, o) => ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0);

const LFH_SIG = [0x50, 0x4b, 0x03, 0x04];
const CDH_SIG = [0x50, 0x4b, 0x01, 0x02];

function isSig(b, o, sig) {
  if (o < 0 || o + sig.length > b.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[o + i] !== sig[i]) return false;
  return true;
}

const MAX_ENTRIES = 10000;          // 列表/提取条目上限
const MAX_FILES = 200;              // 单次下载文件数上限
const MAX_TOTAL_OUT = 64 * 1024 * 1024; // 单次提取总输出上限（与 inflateRaw 单流上限同口径）
const PREVIEW_LIMIT = 800;          // 单条文本预览字符数
const PREVIEW_ENTRIES = 20;         // 报告中最多内联预览的条目数

const METHOD_NAMES = {
  0: "Stored",
  1: "Shrunk",
  6: "Implode",
  8: "Deflate",
  9: "Deflate64",
  12: "BZIP2",
  14: "LZMA",
  93: "Zstandard",
  94: "MP3",
  95: "XZ",
  97: "WavPack",
  98: "PPMd",
  99: "AES",
};

function methodLabel(method) {
  return METHOD_NAMES[method] ? `${METHOD_NAMES[method]}(${method})` : `未知(${method})`;
}

function decodeName(raw, flags) {
  if (!raw || raw.length === 0) return "";
  const utf8 = () => new TextDecoder("utf-8", { fatal: true }).decode(raw);
  if (flags & 0x0800) {
    try { return utf8(); } catch { /* 声明 UTF-8 但字节非法 → 下面按本地码表兜底 */ }
  }
  try { return utf8(); } catch { /* 非 UTF-8 */ }
  // 中文 ZIP 常见：未置 UTF-8 标志但文件名是 GBK。TextDecoder 不支持时静默跳过。
  try { return new TextDecoder("gbk", { fatal: true }).decode(raw); } catch { /* 非 GBK */ }
  try { return new TextDecoder("latin1").decode(raw); } catch { /* 理论不可达 */ }
  let s = "";
  for (let i = 0; i < raw.length; i++) s += String.fromCharCode(raw[i]);
  return s;
}

function displayName(name) {
  return String(name == null ? "" : name).replace(/[\u0000-\u001f\u007f]/g, (ch) => {
    const code = ch.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase();
    return ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : ch === "\t" ? "\\t" : `\\x${code}`;
  });
}

function dosDateTime(dosTime, dosDate) {
  const year = 1980 + ((dosDate >>> 9) & 0x7f);
  const month = (dosDate >>> 5) & 0x0f;
  const day = dosDate & 0x1f;
  const hour = (dosTime >>> 11) & 0x1f;
  const minute = (dosTime >>> 5) & 0x3f;
  const second = (dosTime & 0x1f) * 2;
  if (!year || !month || !day || month > 12 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return "(未设置/非法)";
  }
  const p2 = (n) => String(n).padStart(2, "0");
  return `${year}-${p2(month)}-${p2(day)} ${p2(hour)}:${p2(minute)}:${p2(second)}`;
}

/** 条目名是否含路径穿越/绝对路径/控制字符。 */
function unsafePathReason(name) {
  const s = String(name == null ? "" : name);
  if (!s) return "空名";
  if (/[\u0000-\u001f\u007f]/.test(s)) return "控制字符";
  const n = s.replace(/\\/g, "/");
  if (n.startsWith("//")) return "UNC/绝对路径";
  if (n.startsWith("/")) return "绝对路径";
  if (/^[A-Za-z]:/.test(n)) return "盘符路径";
  if (n.split("/").some((seg) => seg === "..")) return "包含 ..";
  return "";
}

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** 下载产物名：只取 basename、去危险字符、避开 Windows 保留名。 */
function safeDownloadName(name, index) {
  let n = String(name == null ? "" : name).replace(/\\/g, "/");
  const base = n.split("/").filter((seg) => seg && seg !== "." && seg !== "..").pop() || "";
  let s = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").replace(/^\.+/, "").trim();
  if (!s || s === "." || s === "..") s = `entry_${index}.bin`;
  if (WIN_RESERVED.test(s)) s = `_${s}`;
  if (s.length > 120) {
    const dot = s.lastIndexOf(".");
    const ext = dot > 0 && s.length - dot <= 12 ? s.slice(dot) : "";
    s = s.slice(0, 120 - ext.length) + ext;
  }
  return s;
}

function uniqueName(name, used) {
  if (!used.has(name)) { used.add(name); return name; }
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let i = 2;
  while (used.has(`${stem} (${i})${ext}`)) i++;
  const out = `${stem} (${i})${ext}`;
  used.add(out);
  return out;
}

const MIME_BY_EXT = {
  txt: "text/plain", log: "text/plain", md: "text/markdown", csv: "text/csv",
  json: "application/json", xml: "application/xml", html: "text/html", htm: "text/html",
  css: "text/css", js: "text/javascript", svg: "image/svg+xml",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  bmp: "image/bmp", webp: "image/webp", ico: "image/x-icon",
  pdf: "application/pdf", zip: "application/zip", gz: "application/gzip",
  tar: "application/x-tar", "7z": "application/x-7z-compressed",
  wav: "audio/wav", mp3: "audio/mpeg", mp4: "video/mp4",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function mimeOf(name) {
  const m = /\.([A-Za-z0-9]+)$/.exec(name || "");
  return (m && MIME_BY_EXT[m[1].toLowerCase()]) || "application/octet-stream";
}

// ============================================================
// ZIP 中央目录解析（比 ooxmlMeta.zipEntries 多带 flag/crc/时间/AES extra）
// ============================================================

function readExtraFields(bytes, start, len) {
  const end = Math.min(bytes.length, start + len);
  const out = [];
  for (let p = start; p + 4 <= end;) {
    const id = u16(bytes, p);
    const size = u16(bytes, p + 2);
    const body = p + 4;
    if (body + size > end) break;
    out.push({ id, headerStart: p, bodyStart: body, size, bytes: bytes.subarray(body, body + size) });
    p = body + size;
  }
  return out;
}

function findAesExtra(extraList, bytes) {
  for (const f of extraList) {
    if (f.id === 0x9901) {
      // parseAesExtra 需要「extra 头起点 + 头 4 字节 + 数据长度」
      try { return parseAesExtra(bytes, f.headerStart, 4 + f.size); } catch { return null; }
    }
  }
  return null;
}

/**
 * 解析 ZIP 中央目录。
 * @returns {{entries:Array, prefixDelta:number, comment:string}}
 * @throws 不是 ZIP / ZIP64 / 分卷 / 中央目录损坏
 */
function parseZip(bytes) {
  if (!bytes || bytes.length < 22) {
    throw new Error("不是 ZIP：输入不足 22 字节（EOCD 最小长度）。");
  }
  const eocd = findEocd(bytes);
  if (eocd < 0) {
    throw new Error("不是 ZIP：未找到 EOCD（50 4B 05 06）。可能不是 ZIP、被截断或加了非 ZIP 前缀。");
  }
  const diskNo = u16(bytes, eocd + 4);
  const cdDisk = u16(bytes, eocd + 6);
  const entriesDisk = u16(bytes, eocd + 8);
  const count = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOff = u32(bytes, eocd + 16);
  const commentLen = u16(bytes, eocd + 20);

  if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
    throw new Error("ZIP64 暂不支持：EOCD 条目数/中央目录大小/偏移达到 ZIP64 标记。");
  }
  if (diskNo !== 0 || cdDisk !== 0) {
    throw new Error(`分卷 ZIP 暂不支持（disk=${diskNo}, cdDisk=${cdDisk}, entriesDisk=${entriesDisk}, total=${count}）。`);
  }
  // entriesDisk 在个别出题脚本里会留 0；单卷场景以 total（count）为准，不因该字段误拒。
  if (cdSize === 0 && count === 0) {
    return { entries: [], prefixDelta: 0, comment: "" };
  }
  if (cdOff + cdSize > bytes.length) {
    throw new Error(`中央目录越界：声明偏移 ${cdOff} + 大小 ${cdSize} > 输入 ${bytes.length} 字节（文件截断？）。`);
  }

  // 拼接件前缀修正：声明偏移验不出 CDH，而「CD 紧贴 EOCD 前」验出 → 平移
  let base = cdOff;
  if (!isSig(bytes, base, CDH_SIG)) {
    const guess = eocd - cdSize;
    if (guess >= 0 && isSig(bytes, guess, CDH_SIG)) base = guess;
    else throw new Error("中央目录签名不符：EOCD 偏移处与 EOCD 反推处都没有 50 4B 01 02（损坏/加密头/ZIP64？）。");
  }
  const prefixDelta = base - cdOff;
  if (count > MAX_ENTRIES) {
    throw new Error(`条目数 ${count} 超过单次解析上限 ${MAX_ENTRIES}。`);
  }

  const entries = [];
  let p = base;
  for (let i = 0; i < count; i++) {
    if (!isSig(bytes, p, CDH_SIG)) {
      throw new Error(`中央目录第 ${i + 1}/${count} 条签名不符（偏移 0x${p.toString(16)}，文件可能截断/损坏）。`);
    }
    if (p + 46 > bytes.length) throw new Error(`中央目录第 ${i + 1} 条头越界。`);
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const dosTime = u16(bytes, p + 12);
    const dosDate = u16(bytes, p + 14);
    const crc = u32(bytes, p + 16);
    const compSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLength = u16(bytes, p + 32);
    const lfhOffRaw = u32(bytes, p + 42);
    if (compSize === 0xffffffff || size === 0xffffffff || lfhOffRaw === 0xffffffff) {
      throw new Error(`条目 ${i + 1} 使用 ZIP64 扩展值，暂不支持。`);
    }
    if (p + 46 + nameLen + extraLen + commentLength > bytes.length) {
      throw new Error(`中央目录第 ${i + 1} 条名称/扩展区越界。`);
    }
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
    const extraList = readExtraFields(bytes, p + 46 + nameLen, extraLen);
    const name = decodeName(nameBytes, flags);
    const aesExtra = findAesExtra(extraList, bytes);
    entries.push({
      index: i,
      name,
      nameBytes,
      flags,
      method,
      dosTime,
      dosDate,
      crc,
      compSize,
      size,
      lfhOff: lfhOffRaw + prefixDelta,
      extraList,
      aesExtra,
      isDir: name.endsWith("/"),
      unsafe: unsafePathReason(name),
    });
    p += 46 + nameLen + extraLen + commentLength;
  }
  return { entries, prefixDelta, comment: commentLen ? decodeName(bytes.subarray(eocd + 22, eocd + 22 + commentLen), 0x0800) : "" };
}

function readLocalHeader(bytes, entry) {
  const off = entry.lfhOff;
  if (!isSig(bytes, off, LFH_SIG)) {
    throw new Error(`条目「${entry.name}」的本地文件头未命中（偏移 0x${off.toString(16)}）。`);
  }
  if (off + 30 > bytes.length) throw new Error(`条目「${entry.name}」本地头越界。`);
  const flags = u16(bytes, off + 6);
  const method = u16(bytes, off + 8);
  const nameLen = u16(bytes, off + 26);
  const extraLen = u16(bytes, off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  if (dataStart > bytes.length) throw new Error(`条目「${entry.name}」数据起点越界。`);
  const extraList = readExtraFields(bytes, off + 30 + nameLen, extraLen);
  return { flags, method, dataStart, extraList, aesExtra: findAesExtra(extraList, bytes) };
}

function joinFlags(a, b) {
  // 加密/数据描述符/UTF-8/强加密等位只要任一头部声明就按声明处理
  return (a | b) & 0xffff;
}

// ============================================================
// 解压 / 解密
// ============================================================

function decompressPayload(comp, method, entryName) {
  const label = entryName ? `条目「${entryName}」` : "条目";
  if (method === 0) return new Uint8Array(comp);
  if (method === 8) {
    try { return inflateRaw(comp); }
    catch (e) { throw new Error(`${label} Deflate 解压失败：${e && e.message ? e.message : String(e)}`); }
  }
  throw new Error(`${label}不支持的压缩方法 ${method}（${methodLabel(method)}）：本工具只解 Stored(0) / Deflate(8)。`);
}

function zipCryptoCheckByte(entry, flags) {
  return (flags & 0x08)
    ? ((entry.dosTime >>> 8) & 0xff)   // data descriptor：用 DOS 时间高字节
    : ((entry.crc >>> 24) & 0xff);     // 常规：CRC 高字节
}

/** 用 zipCrack 导出的原语做 ZipCrypto 解密（12 字节头 + 数据区）。 */
function decryptZipCrypto(comp, entry, password, flags) {
  if (comp.length < 12) throw new Error("ZipCrypto 加密数据不足 12 字节加密头。");
  const pw = new TextEncoder().encode(String(password));
  const keys = keysFromPassword(pw);
  let check = 0;
  for (let i = 0; i < 12; i++) {
    const plain = (comp[i] ^ decryptByte(keys)) & 0xff;
    updateKeys(keys, plain);
    check = plain;
  }
  const want = zipCryptoCheckByte(entry, flags);
  if (check !== want) throw new Error("ZipCrypto 校验字节不符（密码错误或加密头损坏）");
  const out = new Uint8Array(comp.length - 12);
  for (let i = 12; i < comp.length; i++) {
    const plain = (comp[i] ^ decryptByte(keys)) & 0xff;
    updateKeys(keys, plain);
    out[i - 12] = plain;
  }
  return out;
}

function verifyPayload(payload, entry, opts = {}) {
  if (payload.length !== entry.size) {
    throw new Error(`解出 ${payload.length} 字节 ≠ 中央目录原始大小 ${entry.size} 字节（数据损坏/压缩方法不符）。`);
  }
  if (opts.skipCrc) return null;
  const actual = crc32Bytes(payload);
  if (actual !== (entry.crc >>> 0)) {
    throw new Error(`CRC32 校验失败：算得 0x${actual.toString(16).padStart(8, "0")} / 头部 0x${(entry.crc >>> 0).toString(16).padStart(8, "0")}。`);
  }
  return actual;
}

/**
 * 提取单条。返回 { bytes, pseudo, crypto } 或抛错（带人话原因）。
 */
function extractOne(bytes, entry, password) {
  if (entry.isDir) throw new Error("目录条目，无文件内容");
  const local = readLocalHeader(bytes, entry);
  const flags = joinFlags(entry.flags, local.flags);
  const aesExtra = entry.aesExtra || local.aesExtra;
  const isAes = entry.method === 99 || local.method === 99 || !!aesExtra;
  if (isAes) {
    throw new Error("WinZip AES 加密条目（method 99）暂不支持内容解密：现有 zipBrute 只验证口令、不还原明文。请用 7-Zip/7z 解出后导入；未输出任何伪造明文。");
  }
  if (flags & 0x40) {
    throw new Error("强加密条目（flag bit6）暂不支持内容解密；未输出任何伪造明文。");
  }
  if (entry.size > MAX_TOTAL_OUT) {
    throw new Error(`原始大小 ${entry.size} 字节超过单条 ${MAX_TOTAL_OUT / (1024 * 1024)} MiB 提取上限。`);
  }
  if (entry.compSize === 0 && entry.size !== 0) {
    throw new Error("压缩大小为 0 但原始大小非 0（需要数据描述符或头部未回填），无法定位数据。");
  }
  if (local.dataStart + entry.compSize > bytes.length) {
    throw new Error(`条目数据区越界：起点 0x${local.dataStart.toString(16)} + 压缩大小 ${entry.compSize} > 输入 ${bytes.length} 字节（文件截断？）。`);
  }
  const comp = bytes.subarray(local.dataStart, local.dataStart + entry.compSize);
  const encrypted = (flags & 1) !== 0;

  if (!encrypted) {
    const payload = decompressPayload(comp, entry.method, entry.name);
    verifyPayload(payload, entry);
    return { bytes: payload, pseudo: false, crypto: "" };
  }

  // 加密位=1：先判断伪加密（数据实际是明文），再尝试 ZipCrypto 口令解密。
  let plainError = null;
  try {
    const plain = decompressPayload(comp, entry.method, entry.name);
    verifyPayload(plain, entry);
    return { bytes: plain, pseudo: true, crypto: "" };
  } catch (e) {
    plainError = e;
  }

  if (!password) {
    throw new Error("加密条目需先 zipCrack（zipBrute 弱口令爆破）取得口令并填入 password；若怀疑伪加密，可先用「ZIP 伪加密修复」清位。未输出任何伪造明文。");
  }
  let decrypted;
  try {
    decrypted = decryptZipCrypto(comp, entry, password, flags);
  } catch (e) {
    throw new Error(`密码错误或加密数据损坏：${e && e.message ? e.message : String(e)}；明文试解也失败（${plainError && plainError.message ? plainError.message : "未知"}）。未输出任何伪造明文。`);
  }
  const payload = decompressPayload(decrypted, entry.method, entry.name);
  verifyPayload(payload, entry);
  return { bytes: payload, pseudo: false, crypto: "ZipCrypto" };
}

// ============================================================
// 报告渲染
// ============================================================

function summarize(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max) + `…（已截断，共 ${text.length} 字符）`;
}

/**
 * 列表用伪加密快测：加密位=1 且非 AES 的 Stored/Deflate 条目，按明文试解 + 长度/CRC
 * 校验。通过 = 伪加密；失败/超限 = 无法判定（仍按声明的 ZipCrypto 显示）。
 */
function probePseudo(bytes, entry, flags) {
  if (!(flags & 1) || entry.method === 99 || entry.aesExtra) return null;
  if (entry.method !== 0 && entry.method !== 8) return null;
  const LIMIT = 8 * 1024 * 1024;
  if (entry.compSize > LIMIT || entry.size > LIMIT) return null;
  try {
    const local = readLocalHeader(bytes, entry);
    const comp = bytes.subarray(local.dataStart, local.dataStart + entry.compSize);
    const payload = decompressPayload(comp, entry.method, entry.name);
    verifyPayload(payload, entry);
    return true;
  } catch {
    return false;
  }
}

function previewOf(payload) {
  if (payload.length === 0) return "（空文件）";
  if (payload.length > 1024 * 1024) {
    const head = payload.subarray(0, 64);
    let hex = "";
    for (let i = 0; i < head.length; i++) hex += head[i].toString(16).padStart(2, "0");
    return `hex: ${hex}…（大文件，共 ${payload.length} 字节，完整内容见下载）`;
  }
  const r = bytesToOutput(payload);
  if (r.mode === "text") return "文本: " + summarize(r.text, PREVIEW_LIMIT);
  return `hex: ${summarize(r.text, PREVIEW_LIMIT / 2)}（共 ${payload.length} 字节）`;
}

// ============================================================
// op 1：zipEntries（列表）
// ============================================================

function zipEntriesRun(text, p) {
  const pp = p || {};
  if ((!text || !String(text).trim()) && !(pp.rawBytes && pp.rawBytes.length)) {
    throw new Error("（空输入）请拖入 ZIP 文件，或粘贴其 hex / base64 / UTF-8 字节。");
  }
  let data;
  try { data = inputToBytes(text, pp); }
  catch (e) { throw new Error("输入解析失败：" + (e && e.message ? e.message : String(e))); }
  const z = parseZip(data);

  const lines = [];
  lines.push("=== ZIP 条目列表 ===");
  lines.push(`输入: ${data.length} 字节`);
  if (z.prefixDelta) lines.push(`拼接偏移修正: ${z.prefixDelta > 0 ? "+" : ""}${z.prefixDelta} 字节（EOCD 偏移与中央目录实际位置不一致）`);
  const dirs = z.entries.filter((e) => e.isDir).length;
  lines.push(`条目: ${z.entries.length}（目录 ${dirs} / 文件 ${z.entries.length - dirs}）`);
  if (z.comment) lines.push(`ZIP 注释: ${summarize(displayName(z.comment), 200)}`);
  lines.push("");
  if (z.entries.length === 0) {
    lines.push("（中央目录为空）");
    return lines.join("\n");
  }
  lines.push("#\t名称\t压缩法\t压缩大小\t原始大小\tCRC32\t加密\t时间\t路径");
  // 伪加密快测预算：最多 32 条 / 16 MiB 压缩数据，防止大量加密条目拖垮列表
  let probeEntries = 0, probeBytes = 0;
  const PROBE_MAX_ENTRIES = 32, PROBE_MAX_BYTES = 16 * 1024 * 1024;
  for (const e of z.entries) {
    let localFlag = 0;
    let aes = !!e.aesExtra;
    try {
      const lh = readLocalHeader(data, e);
      localFlag = lh.flags;
      aes = aes || !!lh.aesExtra;
    } catch { /* 本地头坏了也在列表里如实显示中央目录信息 */ }
    const flags = joinFlags(e.flags, localFlag);
    let enc = "否";
    if (flags & 1) {
      if (aes || e.method === 99) enc = "是(AES)";
      else if (flags & 0x40) enc = "是(强加密)";
      else {
        let pseudo = null;
        if (probeEntries < PROBE_MAX_ENTRIES && probeBytes + e.compSize <= PROBE_MAX_BYTES) {
          pseudo = probePseudo(data, e, flags);
          probeEntries++;
          probeBytes += e.compSize;
        }
        enc = pseudo === true ? "是(伪加密·数据明文)" : (pseudo === false ? "是(ZipCrypto)" : "是(加密/未判定)");
      }
    }
    const crc = (e.crc >>> 0).toString(16).padStart(8, "0").toUpperCase();
    const unsafe = e.unsafe ? `穿越风险(${e.unsafe})` : "正常";
    lines.push([
      e.index + 1,
      displayName(e.name) || "(空名)",
      methodLabel(e.method),
      e.compSize,
      e.size,
      "0x" + crc,
      enc,
      dosDateTime(e.dosTime, e.dosDate),
      unsafe,
    ].join("\t"));
  }
  if (z.entries.some((e) => e.unsafe)) {
    lines.push("");
    lines.push("⚠ 路径安全: 上表标「穿越风险」的条目名含 ../ / 绝对路径 / 盘符 / 控制字符。本工具只读内存、不写磁盘；提取时下载名会压平为安全 basename。");
  }
  if (z.entries.some((e) => e.method !== 0 && e.method !== 8)) {
    lines.push("");
    lines.push("提示: 非 Stored(0) / Deflate(8) 的条目（如 BZIP2/LZMA/AES）本工具不能解压，提取时会明确报错。");
  }
  return lines.join("\n");
}

// ============================================================
// op 2：zipExtract（提取 / 解密导出）
// ============================================================

function splitSelection(raw) {
  return String(raw || "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
}

function selectEntries(entries, selection) {
  const tokens = splitSelection(selection);
  if (tokens.length === 0 || tokens.some((t) => t === "*" || /^all$/i.test(t))) {
    return { selected: entries.slice(), missing: [] };
  }
  const selected = [];
  const missing = [];
  const seen = new Set();
  for (const tok of tokens) {
    let found = null;
    const im = /^#(\d+)$/.exec(tok);
    if (im) {
      const idx = Number(im[1]) - 1;
      if (idx >= 0 && idx < entries.length) found = entries[idx];
    } else {
      const hits = entries.filter((e) => e.name === tok);
      if (hits.length > 0) found = hits[0];
    }
    if (!found) { missing.push(tok); continue; }
    // 同一条目可能同时被 #N 与名字命中；去重即可
    if (!seen.has(found.index)) { seen.add(found.index); selected.push(found); }
  }
  return { selected, missing };
}

function zipExtractRun(text, p) {
  const pp = p || {};
  if ((!text || !String(text).trim()) && !(pp.rawBytes && pp.rawBytes.length)) {
    throw new Error("（空输入）请拖入 ZIP 文件，或粘贴其 hex / base64 / UTF-8 字节。");
  }
  let data;
  try { data = inputToBytes(text, pp); }
  catch (e) { throw new Error("输入解析失败：" + (e && e.message ? e.message : String(e))); }
  const z = parseZip(data);
  if (z.entries.length === 0) {
    throw new Error("ZIP 中央目录为空，没有可提取的条目。");
  }
  const { selected, missing } = selectEntries(z.entries, pp.entry);
  if (missing.length) {
    const names = z.entries.slice(0, 20).map((e) => e.name || "(空名)").join(" / ");
    throw new Error(`未找到条目: ${missing.join(", ")}。现有条目（前 20）: ${names}${z.entries.length > 20 ? " …" : ""}`);
  }

  const lines = [];
  lines.push("=== ZIP 提取 ===");
  lines.push(`输入: ${data.length} 字节，条目 ${z.entries.length}，选中 ${selected.length}`);
  if (pp.entry && String(pp.entry).trim() && !/^\s*(all|\*)\s*$/i.test(String(pp.entry))) {
    lines.push(`选择: ${String(pp.entry).trim()}`);
  }
  lines.push(`密码: ${pp.password ? "已提供（ZipCrypto 尝试）" : "未提供"}`);
  if (z.prefixDelta) lines.push(`拼接偏移修正: ${z.prefixDelta > 0 ? "+" : ""}${z.prefixDelta} 字节`);
  lines.push("");

  const files = [];
  const usedNames = new Set();
  let ok = 0, failed = 0, skipped = 0;
  let totalOut = 0;
  let previews = 0;

  for (const e of selected) {
    const tag = `[${e.index + 1}] ${displayName(e.name) || "(空名)"}`;
    if (e.isDir) {
      skipped++;
      lines.push(`${tag} — 目录条目，跳过`);
      continue;
    }
    if (files.length >= MAX_FILES) {
      failed++;
      lines.push(`${tag} — 跳过：本次下载文件数已达上限 ${MAX_FILES}`);
      continue;
    }
    if (totalOut + e.size > MAX_TOTAL_OUT) {
      failed++;
      lines.push(`${tag} — ✗ 跳过：本次提取总输出将超过 ${MAX_TOTAL_OUT / (1024 * 1024)} MiB 预算`);
      continue;
    }
    let r;
    try {
      r = extractOne(data, e, pp.password);
    } catch (err) {
      failed++;
      lines.push(`${tag} — ✗ ${err && err.message ? err.message : String(err)}`);
      continue;
    }
    if (totalOut + r.bytes.length > MAX_TOTAL_OUT) {
      failed++;
      lines.push(`${tag} — ✗ 跳过：本次提取总输出超过 ${MAX_TOTAL_OUT / (1024 * 1024)} MiB 预算`);
      continue;
    }
    totalOut += r.bytes.length;
    ok++;
    const outName = uniqueName(safeDownloadName(e.name, e.index + 1), usedNames);
    files.push({ name: outName, mime: mimeOf(outName), bytes: r.bytes });

    const tags = [];
    if (r.pseudo) tags.push("伪加密（数据实为明文，CRC 已通过）");
    if (r.crypto) tags.push(`${r.crypto} 解密成功`);
    if (e.unsafe) tags.push(`原条目名含路径穿越风险（${e.unsafe}），下载名已压平为 ${outName}`);
    lines.push(`${tag} — ✓ ${methodLabel(e.method)}，原始 ${e.size} 字节，CRC32 0x${(e.crc >>> 0).toString(16).padStart(8, "0").toUpperCase()} 通过${tags.length ? "；" + tags.join("；") : ""}`);
    if (outName !== (e.name || "").replace(/\\/g, "/").split("/").pop()) {
      lines.push(`    下载名: ${outName}`);
    }
    if (previews < PREVIEW_ENTRIES) {
      lines.push("    " + previewOf(r.bytes).replace(/\n/g, "\n    "));
      previews++;
    } else {
      lines.push("    （预览已省略，完整内容见下载文件）");
    }
    lines.push("");
  }

  if (selected.length > 1 && previews >= PREVIEW_ENTRIES) {
    lines.push(`提示: 仅内联前 ${PREVIEW_ENTRIES} 条预览；全部内容在下载文件中。`);
    lines.push("");
  }
  lines.push(`结果: 成功 ${ok}，失败 ${failed}，跳过 ${skipped}；生成下载文件 ${files.length} 个。`);
  if (files.length === 0) {
    if (ok === 0 && failed === 0 && skipped > 0) lines.push("选中项均为目录条目，没有可下载的文件。");
    else lines.push("未生成任何文件。加密条目请先取口令；AES 条目请用 7-Zip 解出后导入。");
  } else {
    lines.push("所有产物仅在内存中生成，点击下载按钮保存；本工具不写磁盘、不联网。");
  }
  if (z.entries.some((e) => e.unsafe)) {
    lines.push("安全提示: ZIP 内存在路径穿越/绝对路径条目；即使在其他解压器里也请勿直接解压到敏感目录。");
  }

  return { text: lines.join("\n"), files };
}

// ============================================================
// 注册
// ============================================================

const INPUT_ENC_PARAM = {
  key: "inputEnc", label: "输入编码（文本输入时）", type: "select", default: "auto",
  options: [
    { value: "auto", label: "自动（hex/base64/UTF-8）" },
    { value: "hex", label: "Hex" },
    { value: "base64", label: "Base64" },
    { value: "utf8", label: "UTF-8 文本" },
  ],
};

register({
  id: "zipEntries",
  family: "zip", familyLabel: "entries",
  cat: "archive",
  name: "ZIP 条目列表",
  desc: "只读 ZIP 中央目录，逐条列出名称、压缩法（Stored/Deflate/其他）、压缩/原始大小、CRC32、加密标志（ZipCrypto/AES/伪加密）、DOS 时间与本地头偏移；同时标出 ../ 绝对路径等路径穿越风险。支持拖入文件或 hex/base64，不依赖 UI",
  params: [INPUT_ENC_PARAM],
  run: zipEntriesRun,
  acceptsBytes: true,
});

register({
  id: "zipExtract",
  family: "zip", familyLabel: "extract",
  cat: "archive",
  name: "ZIP 条目提取 / 解密导出",
  desc: "按条目名（留空=全部）真解压 ZIP 的 Stored/Deflate 条目，逐条校验原始大小与 CRC32，返回文本预览 + 内存下载产物；ZipCrypto 条目可填 password 用 zipCrack 原语解密，伪加密自动识别；WinZip AES 条目如实报暂不支持，绝不伪造明文。路径穿越名只压平为安全下载名，不写磁盘",
  params: [
    INPUT_ENC_PARAM,
    { key: "entry", label: "条目名（留空=全部；多个用逗号/分号分隔；#N 按序号）", type: "text", default: "", placeholder: "flag.txt 或留空" },
    { key: "password", label: "ZipCrypto 密码（可空；AES 条目暂不支持）", type: "text", default: "", placeholder: "先 zipBrute 取口令" },
  ],
  run: zipExtractRun,
  acceptsBytes: true,
});

export {
  parseZip, zipEntriesRun, zipExtractRun,
  extractOne, decryptZipCrypto, safeDownloadName, unsafePathReason,
  decodeName, dosDateTime, methodLabel,
};
