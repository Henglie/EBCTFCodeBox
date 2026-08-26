/*
 * archiveUnified.js — 压缩 / 归档归一入口（T262，cat:'analysis'）。
 *
 * 定位：现有 compress.js（gzip/zlib/deflate/zip/tar 识别）+ sevenzip.js（7z）
 * 分散，本文件做「压缩归档」统一入口 façade：
 * magic 识别格式 → 列结构 → 能解则解（zip/gzip 纯 JS，7z 走 wasm 降级）。
 * zip 伪加密检测 / CRC 复用现有。
 *
 * 归一入口 archiveUnifiedReport(text, p)：
 * 1) inputToBytes 自动识别 hex/base64/UTF-8
 * 2) detectArchiveMagic + is7z 分派
 * 3) 按格式输出：
 * - gzip/zlib/deflate-raw → streamDecompress + 内容预览
 * - zip → parseZipStructure + 伪加密检测
 * - tar → ustar 512 块头解析 + 文件清单
 * - 7z → parse7zHeader + wasm 列表/降级
 * - bzip2/rar → 仅识别提示（纯 JS 无法解压）
 * - 未识别 → raw deflate 启发 + 提示
 *
 * 红线：
 * - 只新建本文件，复用 compress.js / sevenzip.js export，不重写算法。
 * - 零外发：全部本地计算；7z wasm 仅从本地 public/wasm/ 懒加载。
 * - wasm 缺失优雅降级（参照 sevenzip.js 三层范式，不报错不白屏）。
 * - 件内自注册 register(op)。
 *
 * 契约：register({id, cat:'analysis', name, desc, params, run})。
 * 参考：RFC 1950/1951/1952；PKZIP APPNOTE 6.3.x；POSIX tar (ustar)；
 * 7zFormat.txt。
 */
import { register } from "./registry.js";
import {
  detectArchiveMagic, inputToBytes, bytesToOutput,
  parseZipStructure, streamDecompress,
} from "./compress.js";
import {
  is7z, parse7zHeader, run7zWasm, sevenZipWasmAvailable,
} from "./sevenzip.js";

// ============================================================
// 字节小工具（仅 façade 层渲染用，算法复用 compress/sevenzip）
// ============================================================
function bytesToHex(bytes, max = 64) {
  let s = "";
  const n = Math.min(bytes.length, max);
  for (let i = 0; i < n; i++) s += bytes[i].toString(16).padStart(2, "0");
  if (bytes.length > max) s += "…";
  return s;
}

// ZIP 压缩方式表（与 compress.js 同步，照 PKZIP APPNOTE）
const ZIP_COMPRESS_METHODS = {
  0: "Stored(无压缩)", 1: "Shrunk", 6: "Implode", 8: "Deflate", 9: "Deflate64",
  12: "BZIP2", 14: "LZMA", 93: "Zstandard", 94: "MP3", 95: "XZ", 97: "WavPack",
  98: "PPMd", 99: "AES 加密",
};

const TAR_TYPEFLAGS = {
  "0": "普通文件", "\0": "普通文件(旧)",
  "1": "硬链接", "2": "符号链接", "3": "字符设备", "4": "块设备",
  "5": "目录", "6": "FIFO", "7": "保留", "L": "GNU 长名", "x": "PAX 扩展",
};

function parseOctal(bytes, start, len) {
  let s = "";
  for (let i = start; i < start + len; i++) {
    const b = bytes[i];
    if (b === 0 || b === 0x20) break;
    s += String.fromCharCode(b);
  }
  return s ? parseInt(s, 8) : 0;
}

function parseTarString(bytes, start, len) {
  let s = "";
  for (let i = start; i < start + len; i++) {
    if (bytes[i] === 0) break;
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

// ============================================================
// 格式特定渲染
// ============================================================

/** gzip 头解析（RFC 1952）。 */
function renderGzipHeader(bytes) {
  const lines = [];
  if (bytes.length < 10) {
    lines.push("gzip 头过短（< 10 字节）");
    return lines;
  }
  const flg = bytes[3];
  const mtime = (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] * 0x1000000)) >>> 0;
  const xfl = bytes[8];
  const os = bytes[9];
  const osName = { 0: "FAT/MS-DOS", 3: "Unix", 7: "Macintosh", 11: "NTFS", 255: "unknown" }[os] || ("其他(" + os + ")");
  lines.push("  FLG: 0x" + flg.toString(16).padStart(2, "0") +
    " (FTEXT=" + ((flg >> 0) & 1) + ", FHCRC=" + ((flg >> 1) & 1) +
    ", FEXTRA=" + ((flg >> 2) & 1) + ", FNAME=" + ((flg >> 3) & 1) +
    ", FCOMMENT=" + ((flg >> 4) & 1) + ")");
  lines.push("  MTIME: " + (mtime ? new Date(mtime * 1000).toISOString() : "(无)") + " (" + mtime + ")");
  lines.push("  XFL: 0x" + xfl.toString(16).padStart(2, "0"));
  lines.push("  OS: " + osName);
  return lines;
}

/** bzip2 头解析。 */
function renderBzip2Header(bytes) {
  const lines = [];
  if (bytes.length >= 4) {
    const blockSize = bytes[3];
    const realSize = (blockSize - 0x30) * 100 * 1024;
    lines.push("  块大小: " + blockSize + " (0x" + blockSize.toString(16) + ") → " + realSize + " 字节");
  }
  return lines;
}

/** ZIP 伪加密检测 + 文件清单渲染（复用 parseZipStructure）。 */
function renderZipStructure(bytes) {
  const lines = [];
  const { entries, lfhCount, cdhCount, eocdOffset } = parseZipStructure(bytes);
  lines.push("Local File Header: " + lfhCount + " 项");
  lines.push("Central Directory: " + cdhCount + " 项");
  lines.push("EOCD: " + (eocdOffset >= 0 ? "@ 0x" + eocdOffset.toString(16) : "未找到"));
  if (entries.length === 0) {
    lines.push("（未找到 ZIP 结构）");
    return lines;
  }
 // 去重：CDH 优先
  const byName = new Map();
  for (const e of entries) {
    if (!byName.has(e.name) || e.source === "CDH") byName.set(e.name, e);
  }
  const list = [...byName.values()];
  lines.push("");
  lines.push("--- 文件清单（" + list.length + " 项）---");
  lines.push("序号\t文件名\t压缩方式\t压缩大小\t原始大小\t加密\t来源");
  let idx = 1;
  let encCount = 0;
  for (const e of list) {
    const methodDesc = ZIP_COMPRESS_METHODS[e.method] || ("未知(" + e.method + ")");
    const enc = e.encrypted ? "是" : "否";
    if (e.encrypted) encCount++;
    lines.push(
      idx + "\t" +
      (e.name || "(空名)") + "\t" +
      methodDesc + "\t" +
      e.compSize + "\t" +
      e.uncompSize + "\t" +
      enc + "\t" +
      e.source
    );
    idx++;
  }
 // 伪加密检测：CDH 加密位 = 1 但 LFH 加密位 = 0
  const cdhEnc = entries.filter((e) => e.source === "CDH" && e.encrypted);
  const lfhEnc = entries.filter((e) => e.source === "LFH" && e.encrypted);
  if (cdhEnc.length > 0 && lfhEnc.length === 0) {
    lines.push("");
    lines.push("⚠ 疑似伪加密：Central Directory 标记加密 " + cdhEnc.length +
      " 项，但 Local File Header 全部未加密（解 CD 加密位即可正常解压）");
  } else if (lfhEnc.length > 0) {
    lines.push("");
    lines.push("⚠ 真加密：" + lfhEnc.length + " 项 Local File Header 标记加密（需密码，本工具不解压加密项）");
  } else if (encCount > 0) {
    lines.push("");
    lines.push("加密项: " + encCount + "（仅列元信息，不解压）");
  }
  return lines;
}

/** TAR ustar 512 块头解析 + 文件清单。 */
function renderTarStructure(bytes) {
  const lines = [];
  if (bytes.length < 512) {
    lines.push("输入 < 512 字节，不足一个 tar 块");
    return lines;
  }
  const magic = parseTarString(bytes, 257, 6);
  const isUstar = magic === "ustar" || magic === "ustar\0";
  lines.push("ustar magic: " + (isUstar ? "✓ (" + magic + ")" : "✗ (\"" + magic + "\"，非 POSIX ustar)"));
  lines.push("");
  lines.push("--- 文件清单 ---");
  lines.push("序号\t文件名\t类型\t大小\tmtime");
  let idx = 1;
  let offset = 0;
  let count = 0;
  const MAX = 1000;
  while (offset + 512 <= bytes.length && count < MAX) {
    const head = bytes.subarray(offset, offset + 512);
    let allZero = true;
    for (let i = 0; i < 512; i++) if (head[i] !== 0) { allZero = false; break; }
    if (allZero) break;
    const name = parseTarString(head, 0, 100);
    const prefix = parseTarString(head, 345, 155);
    const fullName = prefix ? prefix + "/" + name : name;
    const size = parseOctal(head, 124, 12);
    const mtime = parseOctal(head, 136, 12);
    const typeflag = String.fromCharCode(head[156]);
    const typeDesc = TAR_TYPEFLAGS[typeflag] || ("未知(" + typeflag + ")");
    const mtimeStr = mtime ? new Date(mtime * 1000).toISOString() : "(无)";
    lines.push(
      idx + "\t" +
      (fullName || "(空名)") + "\t" +
      typeDesc + "\t" +
      size + "\t" +
      mtimeStr
    );
    const dataBlocks = Math.ceil(size / 512);
    offset += 512 + dataBlocks * 512;
    idx++;
    count++;
  }
  if (count === MAX) lines.push("…（已达 " + MAX + " 项上限，截断）");
  lines.push("");
  lines.push("共 " + (idx - 1) + " 项");
  return lines;
}

/** 尝试解压 gzip/zlib/deflate-raw（按 magic 选 format），返回 {ok, out, format, error}。
 *  v0.1.5：streamDecompress 内建超时 + 纯 JS inflate 兜底，无环境预检。 */
async function tryStreamDecompress(bytes, magicName) {
  let format;
  if (magicName === "gzip") format = "gzip";
  else if (magicName === "zlib") format = "deflate";
  else if (magicName === "deflate-raw") format = "deflate-raw";
  else return { ok: false, error: "非流式压缩格式" };
  try {
    const out = await streamDecompress(format, bytes);
    if (out.length === 0) return { ok: false, error: "解压结果为空" };
    return { ok: true, out, format };
  } catch (e) {
    return { ok: false, error: (e && e.message ? e.message : String(e)) };
  }
}

// ============================================================
// 归一主入口
// ============================================================
async function archiveUnifiedReport(text, p) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : inputToBytes(text, p);
  const lines = [];
  lines.push("=== 压缩 / 归档归一分析 ===");
  lines.push("输入长度: " + bytes.length + " 字节");
  lines.push("前 32 字节(hex): " + bytesToHex(bytes, 32));

  if (bytes.length === 0) {
    lines.push("");
    lines.push("（空输入）");
    return lines.join("\n");
  }

 // ---- 1. magic 识别 ----
 // 7z 优先（6 字节 magic 比 compress.js 的 ARCHIVE_MAGIC 更精确）
  let magic = null;
  if (is7z(bytes)) {
    magic = { name: "7z", ext: "7z", desc: "7-Zip 归档（7z\\xBC\\xAF\\x27\\x1C）" };
  } else {
    magic = detectArchiveMagic(bytes);
  }

  if (!magic) {
    lines.push("");
    lines.push("结果: 未匹配已知归档 magic（gzip/zlib/bzip2/zip/rar/7z/tar）");
    lines.push("提示: 可能是 raw deflate（无头）、自定义格式或文本");
 // raw deflate 启发
    const b0 = bytes[0];
    if ((b0 & 0x0F) === 0x08 && bytes.length > 1) {
      const bfinal = b0 & 1;
      const btype = (b0 >> 1) & 3;
      lines.push("启发: 首字节 0x" + b0.toString(16).padStart(2, "0") +
        "（BFINAL=" + bfinal + ", BTYPE=" + btype + "）符合 raw DEFLATE 块头特征");
 // 尝试 deflate-raw 解压（v0.1.5：无环境预检，安全流自带纯 JS 兜底）
      lines.push("");
      lines.push("--- 尝试 raw deflate 解压 ---");
      const r = await tryStreamDecompress(bytes, "deflate-raw");
      if (r.ok) {
        lines.push("✓ 解压成功: " + r.out.length + " 字节");
        const rr = bytesToOutput(r.out);
        const preview = rr.text.length > 500 ? rr.text.slice(0, 500) + " …(截断)" : rr.text;
        lines.push("内容(" + rr.mode + "): " + preview.replace(/\n/g, "\n  "));
      } else {
        lines.push("✗ 解压失败: " + r.error);
      }
    }
    return lines.join("\n");
  }

  lines.push("");
  lines.push("命中格式: " + magic.name.toUpperCase());
  lines.push("  类型: " + magic.desc);
  lines.push("  扩展名: ." + magic.ext);

 // ---- 2. 格式特定分派 ----
  const name = magic.name;

  if (name === "gzip" || name === "zlib") {
    if (name === "gzip") {
      lines.push("");
      lines.push("--- gzip 头解析（RFC 1952）---");
      lines.push(...renderGzipHeader(bytes));
    }
 // 解压
    lines.push("");
    lines.push("--- 解压 (" + name + ") ---");
    const r = await tryStreamDecompress(bytes, name);
    if (r.ok) {
      lines.push("✓ 解压成功: " + r.out.length + " 字节");
      const rr = bytesToOutput(r.out);
      const preview = rr.text.length > 500 ? rr.text.slice(0, 500) + " …(截断)" : rr.text;
      lines.push("内容(" + rr.mode + "): " + preview.replace(/\n/g, "\n  "));
    } else {
      lines.push("✗ 解压失败: " + r.error);
    }
    return lines.join("\n");
  }

  if (name === "bzip2") {
    lines.push("");
    lines.push("--- bzip2 头解析 ---");
    lines.push(...renderBzip2Header(bytes));
    lines.push("");
    lines.push("提示: bzip2 纯 JS 解压未实现（需 Bunyan/DEFLATE 算法库）；可在外部工具解压后贴回。");
    return lines.join("\n");
  }

  if (name === "zip") {
    lines.push("");
    lines.push("--- ZIP 结构解析 ---");
    lines.push(...renderZipStructure(bytes));
    return lines.join("\n");
  }

  if (name === "tar") {
    lines.push("");
    lines.push("--- TAR 头解析 ---");
    lines.push(...renderTarStructure(bytes));
    return lines.join("\n");
  }

  if (name === "rar") {
    lines.push("");
    lines.push("提示: RAR 归档已识别，纯 JS 无法解压（RAR 专有算法，需 unrar/wasm）；可在外部工具解压后贴回。");
    return lines.join("\n");
  }

  if (name === "7z") {
    lines.push("");
    lines.push("--- 7z SignatureHeader 解析 ---");
    const h = parse7zHeader(bytes);
    if (!h.ok) {
      lines.push("✗ " + h.error);
    } else {
      lines.push("  版本: " + h.versionMajor + "." + h.versionMinor + "（通常 0.4）");
      lines.push("  StartHeaderCRC: 0x" + h.startHeaderCRC.toString(16).padStart(8, "0") +
        "  校验: " + (h.startHeaderCRCOk ? "✓ 通过" : "✗ 不符（算得 0x" + h.startHeaderCRCCalc.toString(16).padStart(8, "0") + "）"));
      lines.push("  NextHeaderOffset: " + h.nextHeaderOffset + "（绝对位置 = 32 + offset = " + h.nextHeaderAbs + "）");
      lines.push("  NextHeaderSize:   " + h.nextHeaderSize);
      lines.push("  NextHeaderCRC:    0x" + h.nextHeaderCRC.toString(16).padStart(8, "0"));
      lines.push("  完整档案期望大小: >= " + h.expectedTotal + " 字节");
      if (h.nextHeaderPresent) {
        lines.push("  NextHeader CRC 校验: " + (h.nextHeaderCRCOk
          ? "✓ 通过"
          : "✗ 不符（算得 0x" + h.nextHeaderCRCCalc.toString(16).padStart(8, "0") + "）"));
      } else {
        lines.push("  NextHeader CRC 校验: (输入未含完整 NextHeader，跳过)");
      }
    }

 // 尝试 wasm 真跑（列表模式）
    lines.push("");
    lines.push("--- 7z 列表 / 解压能力 ---");
    const mode = (p && p.sevenZipMode) || "list";
    const password = (p && p.password) || "";
    const res = await run7zWasm(bytes, { extract: mode === "extract", password });
    if (res === null) {
 // wasm 缺失降级
      lines.push("⚠ 7z 解压引擎（wasm）未随包或加载失败，已降级为纯头解析。");
      lines.push("  7z 使用 LZMA/LZMA2/BCJ/PPMd 等重型编码，纯 JS 无法完整解压。");
      lines.push("  要启用真解压 / 文件列表，请放置 wasm：");
      lines.push("    文件: public/wasm/7zz.js + public/wasm/7zz.wasm");
      lines.push("    来源: npm 包 7z-wasm（emscripten 编译的 7-Zip CLI）");
      lines.push("    零外发: 资源随包本地分发，绝不 CDN。");
    } else {
      lines.push("✓ 7z-wasm " + (mode === "extract" ? "解压 (x)" : "列表 (l)") + " 结果：");
      if (res.stdout) lines.push(res.stdout);
      if (mode === "extract" && res.files.length > 0) {
        lines.push("");
        lines.push("解出文件: " + res.files.length + " 个");
        for (const f of res.files) {
          const r = bytesToOutput(f.bytes);
          lines.push("· " + f.name + "  (" + f.bytes.length + " 字节, " + r.mode + ")");
        }
      }
    }
    return lines.join("\n");
  }

 // 兜底（理论不可达）
  lines.push("");
  lines.push("（格式 " + name + " 已识别但未实现归一渲染）");
  return lines.join("\n");
}

// ============================================================
// detect 指纹（供一键解码）
// ============================================================
function archiveUnifiedDetect(t) {
  const s = String(t).trim().replace(/\s/g, "");
 // 仅 hex/base64/base64url 有意义
  const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
  const isHexS = /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 && s.length >= 2;
  const isB64S = s.length % 4 === 0 && s.length >= 4 && [...s].every((c) => B64_CHARS.includes(c));
  const isB64UrlS = /^[A-Za-z0-9_-]+$/.test(s) && s.length >= 4;
  if (!isHexS && !isB64S && !isB64UrlS) return 0;
  let bytes;
  try { bytes = inputToBytes(s); } catch { return 0; }
  if (bytes.length < 2) return 0;
 // 7z 6 字节 magic → 0.9
  if (is7z(bytes)) return 0.9;
  const m = detectArchiveMagic(bytes);
  if (m) {
 // gzip/zip 优先（最常 CTF 出现）
    if (m.name === "gzip" || m.name === "zip") return 0.85;
    return 0.8;
  }
  return 0;
}

// ============================================================
// 输入编码参数（通用）
// ============================================================
const INPUT_ENC_PARAM = {
  key: "inputEnc", label: "输入编码", type: "select", default: "auto",
  options: [
    { value: "auto", label: "自动（hex/base64/UTF-8）" },
    { value: "hex", label: "Hex" },
    { value: "base64", label: "Base64" },
    { value: "utf8", label: "UTF-8 文本" },
  ],
};

// ============================================================
// 注册
// ============================================================
register({
  id: "archiveUnified",
  cat: "forensic",
  name: "压缩 / 归档归一分析",
  desc: "自动识别 gzip/zlib/bzip2/zip/rar/7z/tar → 列结构 → 能解则解（gzip/zlib 纯 JS；zip 含伪加密检测；7z 走 wasm 降级）",
  params: [
    INPUT_ENC_PARAM,
    {
      key: "sevenZipMode", label: "7z 操作", type: "select", default: "list",
      options: [
        { value: "list", label: "列表（l）" },
        { value: "extract", label: "解压（x）" },
      ],
    },
    { key: "password", label: "7z 密码（可空）", type: "text", default: "", placeholder: "7z 加密档案填密码" },
  ],
  run: archiveUnifiedReport,
  detect: archiveUnifiedDetect,
  acceptsBytes: true,
});

export {
  archiveUnifiedReport, archiveUnifiedDetect,
};
