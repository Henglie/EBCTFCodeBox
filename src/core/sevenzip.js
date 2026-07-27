/*
 * sevenzip.js — 7-Zip（.7z）识别 / 头解析 / 解压（cat:'analysis'）。
 *
 * 7z 用 LZMA/LZMA2/BCJ/PPMd 等重型编码器，纯 JS 完整解压不现实
 * → 走「本地 wasm 懒加载 + 缺失降级」路线。
 *
 * 三层能力（从不依赖 wasm 到依赖 wasm）：
 * 1) 签名识别 6 字节 magic 37 7A BC AF 27 1C（纯 JS，永远可用）
 * 2) 头结构解析 SignatureHeader(32B) + StartHeader(NextHeaderOffset/Size/CRC)
 * + StartHeaderCRC 校验（纯 JS，永远可用）
 * 3) 真解压 / 列表 懒加载 public/wasm/7zz.js（7z-wasm emscripten 产物）→ 虚拟 FS
 * 写入 → callMain(['l'|'x', ...])（需 wasm 随包，缺失则降级）
 *
 * 缺失降级（参照 katexLoader.js）：
 * public/wasm/7zz.js 不存在 / 加载失败时，op 不报错不白屏
 * 而是输出「签名 + 头解析结果」+ 明确提示「7z wasm 未随包，请放置 public/wasm/7zz.js」。
 *
 * 约定：
 * - 零外发：wasm 仅从本地 public/wasm/ 懒加载，绝不 CDN fetch，绝不外发用户数据。
 * - 件内自注册（register(op)）。
 *
 * 契约：register({id, cat:'analysis', name, desc, params, run})。
 * 参考：7z 格式文档（7zFormat.txt，NanaZip/p7zip DOC/7zFormat.txt）；
 * 7z-wasm npm 包（https://www.npmjs.com/package/7z-wasm，命令行式 FS 接口）。
 */
import { register } from "./registry.js";

// ============================================================
// 输入文本 → 字节（CTF 场景：hex / base64 / base64url / 原样 UTF-8）
// 自包含（不 import compress.js，保持低耦合）
// ============================================================
const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
function isHex(s) { return /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 && s.length >= 2; }
function isB64(s) {
  if (!s || s.length % 4 !== 0) return false;
  for (const c of s) if (!B64_CHARS.includes(c)) return false;
  return true;
}
function isB64Url(s) { return /^[A-Za-z0-9_-]+$/.test(s) && s.length >= 4; }
function hexToBytes(s) {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.slice(i, i + 2), 16);
  return out;
}
function b64ToBytes(s) {
  let str = s.replace(/\s/g, "");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlToBytes(s) {
  let str = s.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 把输入文本智能解码为字节。p.inputEnc: 'auto'|'hex'|'base64'|'utf8' */
function inputToBytes(text, p) {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：直接用真字节，跳过 hex/base64 文本解析。
  if (p && p.rawBytes && p.rawBytes.length) {
    return p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes);
  }
  const enc = (p && p.inputEnc) || "auto";
  const s = String(text).trim().replace(/\s+/g, "");
  if (enc === "hex") { if (!isHex(s)) throw new Error("输入不是合法 hex（偶数长度 0-9a-f）"); return hexToBytes(s); }
  if (enc === "base64") { try { return b64ToBytes(s); } catch { throw new Error("输入不是合法 base64"); } }
  if (enc === "utf8") return new TextEncoder().encode(text);
  if (isHex(s)) return hexToBytes(s);
  if (isB64(s)) { try { return b64ToBytes(s); } catch { /* fall through */ } }
  if (isB64Url(s) && /[-_]/.test(s)) { try { return b64urlToBytes(s); } catch { /* fall through */ } }
  return new TextEncoder().encode(text);
}

// ============================================================
// 字节小工具
// ============================================================
function bytesToHex(bytes, max = 64) {
  let s = "";
  const n = Math.min(bytes.length, max);
  for (let i = 0; i < n; i++) s += bytes[i].toString(16).padStart(2, "0");
  if (bytes.length > max) s += "…";
  return s;
}
function u32le(b, i) { return ((b[i]) | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] * 0x1000000)) >>> 0; }
function u64le(b, i) {
  const lo = u32le(b, i), hi = u32le(b, i + 4);
  return BigInt(hi) << 32n | BigInt(lo);
}

// CRC-32/ISO-HDLC（7z StartHeader/NextHeader 校验用，多项式 0xEDB88320）
let _crcTable = null;
function crc32(bytes, start = 0, end = bytes.length) {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      _crcTable[n] = c >>> 0;
    }
  }
  let c = 0xFFFFFFFF;
  for (let i = start; i < end; i++) c = _crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// 7z 签名：'7z' BC AF 27 1C
const SEVENZIP_MAGIC = [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C];
function is7z(bytes) {
  if (bytes.length < SEVENZIP_MAGIC.length) return false;
  for (let i = 0; i < SEVENZIP_MAGIC.length; i++) if (bytes[i] !== SEVENZIP_MAGIC[i]) return false;
  return true;
}

// ============================================================
// SignatureHeader 解析（纯 JS，不依赖 wasm）
// 偏移 0: Signature (6) 37 7A BC AF 27 1C
// 偏移 6: ArchiveVersion (2) Major.Minor（通常 00 04）
// 偏移 8: StartHeaderCRC (4 LE) — 覆盖后续 20 字节 StartHeader
// 偏移 12: StartHeader (20):
// 偏移 12: NextHeaderOffset (8 LE) — 相对 SignatureHeader 末尾(=32)
// 偏移 20: NextHeaderSize (8 LE)
// 偏移 28: NextHeaderCRC (4 LE)
// ============================================================
function parse7zHeader(bytes) {
  const r = { ok: false };
  if (bytes.length < 32) { r.error = "输入 < 32 字节，不足 7z SignatureHeader"; return r; }
  r.versionMajor = bytes[6];
  r.versionMinor = bytes[7];
  r.startHeaderCRC = u32le(bytes, 8);
  r.nextHeaderOffset = u64le(bytes, 12);
  r.nextHeaderSize = u64le(bytes, 20);
  r.nextHeaderCRC = u32le(bytes, 28);
 // StartHeaderCRC 覆盖偏移 12..31（20 字节）
  r.startHeaderCRCCalc = crc32(bytes, 12, 32);
  r.startHeaderCRCOk = r.startHeaderCRCCalc === r.startHeaderCRC;
 // NextHeader 绝对位置 = 32 + NextHeaderOffset
  r.nextHeaderAbs = 32n + r.nextHeaderOffset;
  r.expectedTotal = r.nextHeaderAbs + r.nextHeaderSize; // 完整档案最小字节数
 // NextHeader CRC 校验（若本地字节含完整 NextHeader）
  const absNum = Number(r.nextHeaderAbs);
  const sizeNum = Number(r.nextHeaderSize);
  if (Number.isSafeInteger(absNum) && Number.isSafeInteger(sizeNum) &&
      sizeNum > 0 && absNum + sizeNum <= bytes.length) {
    r.nextHeaderCRCCalc = crc32(bytes, absNum, absNum + sizeNum);
    r.nextHeaderCRCOk = r.nextHeaderCRCCalc === r.nextHeaderCRC;
    r.nextHeaderPresent = true;
  } else {
    r.nextHeaderPresent = false;
  }
  r.ok = true;
  return r;
}

// ============================================================
// wasm 懒加载（7z-wasm emscripten 产物：public/wasm/7zz.js + 7zz.wasm）
// 参照 WhatsInYourClipboard bridge.js 的 MODULARIZE 工厂动态 import 范式
// + katexLoader.js 的「缺失降级」范式（加载失败 → available=false，不抛）。
// 零外发：只从本地相对路径 import，绝不 CDN。
// ============================================================
const WASM_LOADER_URL = "../../public/wasm/7zz.js"; // emscripten MODULARIZE 工厂
let _modPromise = null;   // 单例：并发只加载一次
let _available = null;    // null=未试 / true=就绪 / false=缺失降级

/** 懒加载 7z-wasm，返回 module 或 null（缺失/失败降级，不抛）。 */
async function load7zWasm() {
  if (_modPromise) return _modPromise;
  _modPromise = (async () => {
    try {
      const factory = await import(/* @vite-ignore */ WASM_LOADER_URL);
      const create = factory.default || factory.SevenZip || factory.createSevenZip;
      if (typeof create !== "function") { _available = false; return null; }
 // 7z-wasm 工厂：await SevenZip({...})；抑制默认 stdout 噪音，收集到 buffer
      const mod = await create({
        print: () => {},
        printErr: () => {},
      });
      _available = true;
      return mod;
    } catch {
      _available = false; // 未随包 / 加载失败 → 降级
      return null;
    }
  })();
  return _modPromise;
}

/** 是否已确认 wasm 可用（未试过返回 null）。 */
function sevenZipWasmAvailable() { return _available; }

/**
 * 用 7z-wasm 执行命令行（列表 'l' / 解压 'x'），捕获 stdout。
 * 7z-wasm 接口：mod.FS.writeFile / mod.callMain(argv) / mod.FS.readdir。
 * @returns {{stdout:string, files:Array<{name:string,bytes:Uint8Array}>}|null} null=wasm 不可用
 */
async function run7zWasm(archiveBytes, { extract = false, password = "" } = {}) {
  const mod = await load7zWasm();
  if (!mod) return null;
  const lines = [];
 // 重装 print 以捕获本次输出（工厂可能已固定 print，尽量二次覆盖）
  try { mod.print = (t) => lines.push(t); mod.printErr = (t) => lines.push(t); } catch { /* readonly */ }
  const FS = mod.FS;
  const IN = "in.7z";
  const OUT = "out";
  try {
    FS.writeFile(IN, archiveBytes);
    try { FS.mkdir(OUT); } catch { /* 已存在 */ }
    const argv = extract
      ? ["x", IN, "-o" + OUT, "-y", ...(password ? ["-p" + password] : [])]
      : ["l", IN, ...(password ? ["-p" + password] : [])];
 // callMain 退出码非 0 时 emscripten 可能抛 ExitStatus；捕获但保留已收集输出
    try { mod.callMain(argv); } catch (e) {
      if (e && e.name !== "ExitStatus") lines.push("(7z 运行告警: " + (e.message || String(e)) + ")");
    }
    const files = [];
    if (extract) collectFiles(FS, OUT, "", files);
    return { stdout: lines.join("\n"), files };
  } catch (e) {
    return { stdout: "(7z-wasm FS 操作失败: " + (e && e.message ? e.message : String(e)) + ")", files: [] };
  } finally {
    try { FS.unlink(IN); } catch { /* ignore */ }
  }
}

/** 递归收集虚拟 FS 目录下所有文件字节（防爆：最多 200 项）。 */
function collectFiles(FS, dir, prefix, out, budget = { n: 0 }) {
  let entries;
  try { entries = FS.readdir(dir); } catch { return; }
  for (const name of entries) {
    if (name === "." || name === "..") continue;
    if (budget.n >= 200) return;
    const full = dir + "/" + name;
    const rel = prefix ? prefix + "/" + name : name;
    let stat;
    try { stat = FS.stat(full); } catch { continue; }
    if (FS.isDir(stat.mode)) {
      collectFiles(FS, full, rel, out, budget);
    } else {
      budget.n++;
      let bytes = null;
      try { bytes = FS.readFile(full); } catch { /* ignore */ }
      out.push({ name: rel, bytes: bytes || new Uint8Array(0) });
    }
  }
}

// ============================================================
// 输出渲染工具
// ============================================================
function bytesToOutput(bytes) {
  if (!bytes || bytes.length === 0) return { text: "", mode: "text" };
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let ctrl = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c < 0x20 && c !== 0x0A && c !== 0x0D && c !== 0x09) ctrl++;
    }
    if (s.length > 0 && ctrl / s.length < 0.1) return { text: s, mode: "text" };
  } catch { /* 非文本 */ }
  return { text: bytesToHex(bytes, 4096), mode: "hex" };
}

function headerLines(h) {
  const lines = [];
  lines.push("--- 7z SignatureHeader 解析 ---");
  if (!h.ok) { lines.push("✗ " + h.error); return lines; }
  lines.push("  版本: " + h.versionMajor + "." + h.versionMinor + "（通常 0.4）");
  lines.push("  StartHeaderCRC: 0x" + h.startHeaderCRC.toString(16).padStart(8, "0") +
    "  校验: " + (h.startHeaderCRCOk ? "✓ 通过" : "✗ 不符（算得 0x" + h.startHeaderCRCCalc.toString(16).padStart(8, "0") + "，可能截断/损坏）"));
  lines.push("  NextHeaderOffset: " + h.nextHeaderOffset + "（NextHeader 绝对位置 = 32 + offset = " + h.nextHeaderAbs + "）");
  lines.push("  NextHeaderSize:   " + h.nextHeaderSize);
  lines.push("  NextHeaderCRC:    0x" + h.nextHeaderCRC.toString(16).padStart(8, "0"));
  lines.push("  完整档案期望大小: >= " + h.expectedTotal + " 字节");
  if (h.nextHeaderPresent) {
    lines.push("  NextHeader CRC 校验: " + (h.nextHeaderCRCOk
      ? "✓ 通过（本地含完整头元数据）"
      : "✗ 不符（算得 0x" + h.nextHeaderCRCCalc.toString(16).padStart(8, "0") + "）"));
  } else {
    lines.push("  NextHeader CRC 校验: (输入未含完整 NextHeader，跳过；可能只贴了片段)");
  }
  return lines;
}

// ============================================================
// 主 op：run 单向（识别 + 头解析 +（可用则）wasm 列表/解压）
// ============================================================
async function sevenZipRun(text, p) {
  const bytes = inputToBytes(text, p);
  const lines = [];
  lines.push("=== 7-Zip (.7z) 分析 ===");
  lines.push("输入长度: " + bytes.length + " 字节");
  lines.push("前 32 字节(hex): " + bytesToHex(bytes, 32));
  lines.push("");

  if (!is7z(bytes)) {
    lines.push("✗ 未命中 7z 签名（应为 37 7A BC AF 27 1C）");
    lines.push("提示: 确认输入为 .7z 字节流（hex/base64 编码）。其它归档请用「归档 / 压缩流识别」op。");
    return lines.join("\n");
  }
  lines.push("✓ 命中 7z 签名（37 7A BC AF 27 1C）");
  lines.push("");

  const h = parse7zHeader(bytes);
  lines.push(...headerLines(h));
  lines.push("");

  const mode = (p && p.mode) || "list";
  const password = (p && p.password) || "";

 // 尝试 wasm 真跑
  const res = await run7zWasm(bytes, { extract: mode === "extract", password });
  if (res === null) {
 // ---- wasm 缺失降级（不报错不白屏）----
    lines.push("--- 解压 / 列表能力 ---");
    lines.push("⚠ 7z 解压引擎（wasm）未随包或加载失败，已降级为纯头解析。");
    lines.push("  7z 使用 LZMA/LZMA2/BCJ/PPMd 等重型编码，纯 JS 无法完整解压。");
    lines.push("  要启用真解压 / 文件列表，请放置 wasm：");
    lines.push("    文件: public/wasm/7zz.js + public/wasm/7zz.wasm");
    lines.push("    来源: npm 包 7z-wasm（emscripten 编译的 7-Zip CLI，MODULARIZE 产物）");
    lines.push("    零外发: 资源随包本地分发，绝不 CDN。");
    return lines.join("\n");
  }

 // ---- wasm 可用：输出 7z CLI 结果 ----
  lines.push("--- 7z-wasm " + (mode === "extract" ? "解压 (x)" : "列表 (l)") + " ---");
  if (res.stdout) lines.push(res.stdout);
  if (mode === "extract") {
    lines.push("");
    lines.push("解出文件: " + res.files.length + " 个" + (res.files.length >= 200 ? "（达 200 上限，截断）" : ""));
    for (const f of res.files) {
      const r = bytesToOutput(f.bytes);
      lines.push("");
      lines.push("· " + f.name + "  (" + f.bytes.length + " 字节, " + r.mode + ")");
      const preview = r.text.length > 500 ? r.text.slice(0, 500) + " …(截断)" : r.text;
      lines.push("  " + preview.replace(/\n/g, "\n  "));
    }
  }
  return lines.join("\n");
}

// ============================================================
// detect 指纹（供一键解码）
// ============================================================
function sevenZipDetect(t) {
  const s = String(t).trim().replace(/\s/g, "");
  if (!isHex(s) && !isB64(s) && !isB64Url(s)) return 0;
  let bytes;
  try { bytes = inputToBytes(s); } catch { return 0; }
  return is7z(bytes) ? 0.9 : 0;
}

// ============================================================
// 注册
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

register({
  id: "sevenZipExtract",
  cat: "forensic",
  name: "7z 归档解析 / 解压",
  desc: "识别 7z 签名 + 解析 SignatureHeader/StartHeader（CRC 校验）；放置 public/wasm/7zz.js 后可真列表/解压（LZMA 等，wasm 缺失自动降级）",
  params: [
    INPUT_ENC_PARAM,
    {
      key: "mode", label: "操作", type: "select", default: "list",
      options: [
        { value: "list", label: "列表（l）" },
        { value: "extract", label: "解压（x）" },
      ],
    },
    { key: "password", label: "密码（可空）", type: "text", default: "", placeholder: "加密档案填密码" },
  ],
  run: sevenZipRun,
  detect: sevenZipDetect,
  acceptsBytes: true,
});

// ============================================================
// 文件级分析（拖入 .7z → handleFile 异步补充分析，产 section 数组）
// 与 run 型 op 区别：op 吃 text（hex/b64），本函数直接吃文件 bytes。
// 契约同 fileAnalysis：{ sections:[{id,title,level,icon,body,actions?}] }。
// 零外发；wasm 缺失优雅降级（只出头解析 section）。
// ============================================================
async function analyze7zFile(bytes) {
  const sections = [];
  const u8a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!is7z(u8a)) return { sections };

 // 头解析 section（纯 JS，永远可用）
  const h = parse7zHeader(u8a);
  sections.push({
    id: "sevenzip-header",
    title: "7z 头解析",
    level: h.ok && h.startHeaderCRCOk ? "info" : "warn",
    icon: "folder_zip",
    body: headerLines(h).join("\n"),
  });

 // wasm 真列表（不自动解压，避免大档案卡顿；解压走 op 或双击）
  let res = null;
  try { res = await run7zWasm(u8a, { extract: false }); } catch { res = null; }
  if (res === null) {
    sections.push({
      id: "sevenzip-wasm",
      title: "7z 解压引擎",
      level: "warn",
      icon: "info",
      body: "7z 解压引擎（wasm）未随包或加载失败，仅出头解析。\n"
        + "启用真列表/解压：放置 public/wasm/7zz.js + 7zz.wasm（7z-wasm，本地随包，零外发）。\n"
        + "或用「7z 归档解析 / 解压」op（粘 hex/base64）指定列表/解压。",
    });
  } else {
    sections.push({
      id: "sevenzip-list",
      title: "7z 文件列表",
      level: "info",
      icon: "list",
      body: (res.stdout || "(无输出)") + "\n\n真解压请用「7z 归档解析 / 解压」op 选「解压」，或填密码后重试。",
    });
  }
  return { sections };
}

export {
  is7z, parse7zHeader, crc32, inputToBytes,
  load7zWasm, sevenZipWasmAvailable, run7zWasm,
  sevenZipRun, sevenZipDetect, analyze7zFile,
};
