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
import { decodeUtf8Lossless } from "./bytesIo.js";
import { checkLimit, withLimit, isLimitError } from "./limitGuard.js";

// BOM 保真的严格 UTF-8 解码（bytesIo 单一源）：非法序列抛 TypeError（同旧 fatal TextDecoder 语义），
// 唯一行为差异是合法 BOM（U+FEFF 开头）不再被静默吞掉。
function _decodeUtf8Fatal(bytes) {
  const r = decodeUtf8Lossless(bytes);
  if (!r.ok) throw new TypeError(r.reason);
  return r.text;
}

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
 // 输出收集槽：emscripten 在工厂 create 时一次性绑定 print/printErr，
 // 事后改 mod.print 无效（实测 24.09 wasm：二次覆盖零输出）⇒ 必须在 create 时
 // 装一个「读模块级 _stdoutSink」的转发闭包，每次 callMain 前后切换 sink。
let _stdoutSink = null;

/**
 * 从 `7z l -slt` 输出解析声明的条目大小合计（只读头元数据，不解压/不分配条目缓冲）。
 * 解析不到可信数值时返回 null，调用方保留读取阶段的软/硬阈值兜底。
 */
function parseDeclaredUnpackSizes(text) {
  let total = 0;
  let count = 0;
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /^Size = (\d+)\s*$/.exec(line);
    if (!m) continue;
    const n = Number(m[1]);
    if (!Number.isSafeInteger(n) || n < 0) return null;
    total += n;
    if (!Number.isSafeInteger(total)) return null;
    count++;
  }
  return count ? total : null;
}

// `l -slt` 的 Path/Size 对：解压前按声明大小预分配 MEMFS 产物，避免写盘时反复扩容复制。
function parseDeclaredFileSizes(text) {
  const map = new Map();
  let cur = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    let m = /^Path = (.*)$/.exec(line);
    if (m) { cur = m[1]; continue; }
    m = /^Size = (\d+)\s*$/.exec(line);
    if (!m || cur == null) continue;
    const n = Number(m[1]);
    if (!Number.isSafeInteger(n) || n < 0) continue;
    const key = cur.replace(/\\/g, "/").replace(/^\.?\//, "");
    if (key) map.set(key, n);
  }
  return map;
}

function fsNodePath(node) {
  const parts = [];
  let n = node;
  for (let i = 0; n && i < 256; i++) {
    if (n.name && n.name !== "/") parts.push(n.name);
    if (!n.parent || n.parent === n) break;
    n = n.parent;
  }
  return parts.reverse().join("/");
}

// 临时挂 MEMFS 写入钩子：首次写产物且声明大小大于本次写入量时，直接把容量定到声明值。
// 7z 顺序写满则不再触发 1.125x 扩容/整文件复制；声明失真时仍走原扩容逻辑，内容不受影响。
function installPresizeHook(FS, outDir, sizes) {
  const MEMFS = FS && FS.filesystems && FS.filesystems.MEMFS;
  const table = MEMFS && MEMFS.ops_table && MEMFS.ops_table.file && MEMFS.ops_table.file.stream;
  if (!table || typeof table.write !== "function" || typeof MEMFS.resizeFileStorage !== "function") return null;
  const orig = table.write;
  const prefix = outDir + "/";
  const hook = function (stream, buffer, offset, length, position, canOwn) {
    try {
      const node = stream && stream.node;
      if (node && position === 0 && node.usedBytes === 0 && length > 0) {
        const full = fsNodePath(node);
        if (full && full.startsWith(prefix)) {
          const declared = sizes.get(full.slice(prefix.length));
          if (declared != null && declared > length) MEMFS.resizeFileStorage(node, declared);
        }
      }
    } catch { /* 预分配失败不影响正常写入 */ }
    return orig.apply(this, arguments);
  };
  table.write = hook;
  return () => { if (table.write === hook) table.write = orig; };
}

/** 懒加载 7z-wasm，返回 module 或 null（缺失/失败降级，不抛）。 */
async function load7zWasm() {
  if (_modPromise) return _modPromise;
  _modPromise = (async () => {
    try {
      const factory = await import(/* @vite-ignore */ WASM_LOADER_URL);
      const create = factory.default || factory.SevenZip || factory.createSevenZip;
      if (typeof create !== "function") { _available = false; return null; }
 // 7z-wasm 工厂：await SevenZip({...})；输出经 _stdoutSink 转发（见上）
      const mod = await create({
        print: (t) => { if (_stdoutSink) _stdoutSink.push(String(t)); },
        printErr: (t) => { if (_stdoutSink) _stdoutSink.push(String(t)); },
        noInitialRun: true,
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

// 按真实内容 magic 推虚拟文件名（7z CLI 靠扩展名+内容双线索定格式；
// 坏头样本若给了错扩展名，7z 会按错误类型打开并失败，故按 magic 命名优先）。
function sniffArchiveExt(bytes) {
  const b = bytes;
  const eq = (off, sig) => sig.every((v, i) => b[off + i] === v);
  if (eq(0, [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C])) return "7z";
  if (eq(0, [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00])) return "rar"; // RAR5
  if (eq(0, [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00])) return "rar";       // RAR4
  if (eq(0, [0xFD, 0x37, 0x7A, 0x58, 0x5A, 0x00])) return "xz";
  if (eq(0, [0x42, 0x5A, 0x68])) return "bz2";
  if (eq(0, [0x1F, 0x8B])) return "gz";
  if (eq(0, [0x50, 0x4B, 0x03, 0x04]) || eq(0, [0x50, 0x4B, 0x05, 0x06]) || eq(0, [0x50, 0x4B, 0x07, 0x08])) return "zip";
  if (bytes.length >= 262 && eq(257, [0x75, 0x73, 0x74, 0x61, 0x72])) return "tar"; // ustar @257
  return null;
}

// 递归清空虚拟 FS 目录（多卷/重复解压防串包：OUT 残留旧文件会污染本次产物）。
function fsRmRf(FS, dir) {
  let entries;
  try { entries = FS.readdir(dir); } catch { return; }
  for (const name of entries) {
    if (name === "." || name === "..") continue;
    const full = dir + "/" + name;
    let st;
    try { st = FS.stat(full); } catch { continue; }
    if (FS.isDir(st.mode)) fsRmRf(FS, full);
    else { try { FS.unlink(full); } catch { /* ignore */ } }
  }
  try { FS.rmdir(dir); } catch { /* ignore */ }
}

// 读出单个产物后立即 unlink：MEMFS 下的 node.contents 直接给视图（零拷贝），
// unlink 后由 JS 视图继续持有底层 buffer；避免 readFile 再复制一份整文件。
// 非 MEMFS / 结构不符时退回 FS.readFile。
function takeFileBytes(FS, full) {
  let data = null;
  try {
    const node = FS.lookupPath ? FS.lookupPath(full, { follow: true }).node : null;
    const contents = node && node.contents;
    const used = node ? Number(node.usedBytes) : NaN;
    // MEMFS 首写可能直接 slice 出 Int8Array（来自 HEAP8），统一成无符号字节视图。
    const bytesView = contents instanceof Uint8Array
      ? contents
      : (contents && ArrayBuffer.isView(contents) && contents.BYTES_PER_ELEMENT === 1
        ? new Uint8Array(contents.buffer, contents.byteOffset, contents.byteLength) : null);
    if (bytesView && Number.isSafeInteger(used) && used >= 0 && used <= bytesView.length) {
      data = bytesView.subarray(0, used);
    }
  } catch { data = null; }
  if (data === null) {
    try { data = FS.readFile(full); } catch { data = new Uint8Array(0); }
  }
  try { FS.unlink(full); } catch { /* ignore */ }
  return data;
}

// 归档输入尽量零拷贝挂进 MEMFS（canOwn 采纳原 Uint8Array 视图），
// 失败则退回 writeFile 复制。输入文件已存在时先 unlink，避免 EEXIST/截断歧义。
function fsWriteArchive(FS, path, bytes) {
  try { FS.unlink(path); } catch { /* ignore */ }
  if (typeof FS.createDataFile === "function") {
    try {
      FS.createDataFile("/", path, bytes, true, false, true);
      return;
    } catch { /* 退回 writeFile */ }
    try { FS.unlink(path); } catch { /* ignore */ }
  }
  FS.writeFile(path, bytes);
}

/**
 * 用 7z-wasm 执行命令行（列表 'l' / 解压 'x'），捕获 stdout。
 * 7z-wasm 接口：mod.FS.writeFile / mod.callMain(argv) / mod.FS.readdir。
 * name 可指定虚拟文件名（默认按内容 magic 推扩展名，未知则 in.bin 让 7z 纯按内容识别）。
 * 返回 { stdout, files, code, ok }；ok=false 表示 7z 报错（退出码非 0 或输出含 ERROR，
 * 两判据并用的原因：实测坏头档案 l/x 退出码仍为 0、错误只在文本里；无密码解加密包
 * 则退出码非 0 且可能已落垃圾文件 ⇒ 失败时 files 置空，绝不把半解产物当结果）。
 * wasm 不可用仍返回 null（调用方降级）。
 */
async function run7zWasm(archiveBytes, { extract = false, password = "", name = "", params = null } = {}) {
  const mod = await load7zWasm();
  if (!mod) return null;
  const FS = mod.FS;
  const ext = sniffArchiveExt(archiveBytes);
  const IN = name || (ext ? "in." + ext : "in.bin");
  const OUT = "out";
  const lines = [];
  _stdoutSink = lines;
  let code = 0;
  try {
    try { fsRmRf(FS, OUT); } catch { /* ignore */ }
    try { FS.mkdir(OUT); } catch { /* 已存在 */ }
    fsWriteArchive(FS, IN, archiveBytes);
    let limitParams = params;
    let declaredSizes = null;
    // 7z 预检：只跑 `l -slt` 读声明 Size，不分配解压缓冲。可预检且超阈值时在 x 之前拦截；
    // 预检失败（编码头/输出不可解析）则退回 collectFiles 的读取阶段软硬阈值。
    if (extract && ext === "7z") {
      const preLines = [];
      const prevSink = _stdoutSink;
      _stdoutSink = preLines;
      let preCode = 0;
      try {
        mod.callMain(["l", "-slt", IN, ...(password ? ["-p" + password] : [])]);
      } catch (e) {
        preCode = typeof e === "number" ? e : ((e && (e.status ?? e.code)) ?? -1);
      } finally {
        _stdoutSink = prevSink;
      }
      const declaredText = preLines.join("\n");
      const declared = preCode === 0 ? parseDeclaredUnpackSizes(declaredText) : null;
      if (declared != null) {
        const declaredMap = parseDeclaredFileSizes(declaredText);
        if (declared > PRESIZE_MIN_TOTAL) declaredSizes = declaredMap;
        // 条目数 / 单成员 / 总量都在 x 之前按声明值预检，超软阈值可确认，超硬上限直接失败。
        if (declaredMap.size > MAX_FILES) {
          checkLimit({
            scope: "sevenzip.entries.declared",
            actual: declaredMap.size,
            soft: MAX_FILES,
            hard: MAX_FILES_HARD,
            params: limitParams,
            label: "7z 声明条目数",
            unit: " 个",
          });
          limitParams = withLimit(limitParams, { _allowLimitOverride: true });
        }
        let maxEntry = 0;
        for (const n of declaredMap.values()) if (n > maxEntry) maxEntry = n;
        if (maxEntry > MAX_ENTRY_UNPACK) {
          checkLimit({
            scope: "sevenzip.unpack.declaredEntrySize",
            actual: maxEntry,
            soft: MAX_ENTRY_UNPACK,
            hard: MAX_ENTRY_UNPACK_HARD,
            params: limitParams,
            label: "7z 声明单成员大小",
            unit: " 字节",
          });
          limitParams = withLimit(limitParams, { _allowLimitOverride: true });
        }
        if (declared > MAX_TOTAL_UNPACK) {
          checkLimit({
            scope: "sevenzip.unpack.declaredOutput",
            actual: declared,
            soft: MAX_TOTAL_UNPACK,
            hard: MAX_TOTAL_UNPACK_HARD,
            params: limitParams,
            label: "7z 声明解压总大小",
            unit: " 字节",
          });
          limitParams = withLimit(limitParams, { _allowLimitOverride: true });
        }
      }
    }
    const argv = extract
      ? ["x", IN, "-o" + OUT, "-y", ...(password ? ["-p" + password] : [])]
      : ["l", IN, ...(password ? ["-p" + password] : [])];
 // callMain 失败时 emscripten 抛裸数字（退出码）或 ExitStatus；统一取数值
    const restorePresize = extract && declaredSizes && declaredSizes.size
      ? installPresizeHook(FS, OUT, declaredSizes) : null;
    try { mod.callMain(argv); } catch (e) {
      code = typeof e === "number" ? e : ((e && (e.status ?? e.code)) ?? -1);
    } finally {
      if (restorePresize) restorePresize();
    }
    const ok = code === 0 && !/ERROR/i.test(lines.join("\n"));
    // x 完成后先释放归档输入，再逐文件读取；读完立即 unlink，避免整包产物常驻 MEMFS。
    try { FS.unlink(IN); } catch { /* ignore */ }
    const files = [];
    const budget = { n: 0, bytes: 0, params: limitParams };
    if (extract && ok) collectFiles(FS, OUT, "", files, budget);
    return { stdout: lines.join("\n"), files, code, ok, bytesRead: budget.bytes };
  } catch (e) {
    if (isLimitError(e)) throw e;
    return { stdout: "(7z-wasm FS 操作失败: " + (e && e.message ? e.message : String(e)) + ")", files: [], code: -1, ok: false };
  } finally {
    _stdoutSink = null;
    try { FS.unlink(IN); } catch { /* ignore */ }
    fsRmRf(FS, OUT);
  }
}

// 7z 解压前尽量用 `l -slt` 读声明 unpack size 预检（见 run7zWasm）；预检不可用时
// 仍在收集/读取阶段用同一组软硬阈值兜底，避免把解压产物一次性读进 JS 堆
// （虚拟 FS 已写出的部分仍由 7z-wasm 受浏览器内存约束）。
// 统一资源口径（与 ZIP / TAR 一致）：软阈值可确认放宽到硬上限，超过硬上限明确失败。
const MIB = 1024 * 1024;
const MAX_FILES = 1000;                    // 解出文件数软阈值
const MAX_FILES_HARD = 5000;               // 解出文件数硬上限
const MAX_ENTRY_UNPACK = 256 * MIB;        // 单成员解压软阈值
const MAX_ENTRY_UNPACK_HARD = 1024 * MIB;  // 单成员解压硬上限
const MAX_TOTAL_UNPACK = 256 * MIB;        // 解压总输出软阈值
const MAX_TOTAL_UNPACK_HARD = 1024 * MIB;  // 解压总输出硬上限
const PRESIZE_MIN_TOTAL = 8 * MIB;         // 超过此声明总量才启用 MEMFS 预分配（小档案走原生路径）

/** 流式收集虚拟 FS 产物：读一个 unlink 一个；超限立刻抛错，剩余产物由 finally 清理。 */
function collectFiles(FS, dir, prefix, out, budget = { n: 0, bytes: 0, params: null }) {
  let entries;
  try { entries = FS.readdir(dir); } catch { return; }
  for (const name of entries) {
    if (name === "." || name === "..") continue;
    const full = dir + "/" + name;
    const rel = prefix ? prefix + "/" + name : name;
    let stat;
    try { stat = FS.stat(full); } catch { continue; }
    if (FS.isDir(stat.mode)) {
      collectFiles(FS, full, rel, out, budget);
      try { FS.rmdir(full); } catch { /* ignore */ }
      continue;
    }
    const declared = Number(stat.size) || 0;
    // 条目数：软 1000 / 硬 5000。达到硬上限由 checkLimit 抛 LIMIT_HARD，绝不静默截断。
    if (budget.n + 1 > MAX_FILES) {
      checkLimit({
        scope: "sevenzip.entries",
        actual: budget.n + 1,
        soft: MAX_FILES,
        hard: MAX_FILES_HARD,
        params: budget.params,
        label: "7z 文件数",
        unit: " 个",
      });
      budget.params = withLimit(budget.params, { _allowLimitOverride: true });
    }
    // 单成员：软 256 MiB / 硬 1 GiB。
    if (declared > MAX_ENTRY_UNPACK) {
      checkLimit({
        scope: "sevenzip.unpack.entrySize",
        actual: declared,
        soft: MAX_ENTRY_UNPACK,
        hard: MAX_ENTRY_UNPACK_HARD,
        params: budget.params,
        label: "7z 单成员解压大小",
        unit: " 字节",
      });
      budget.params = withLimit(budget.params, { _allowLimitOverride: true });
    }
    if (budget.bytes + declared > MAX_TOTAL_UNPACK) {
      checkLimit({
        scope: "sevenzip.unpack.totalOutput",
        actual: budget.bytes + declared,
        soft: MAX_TOTAL_UNPACK,
        hard: MAX_TOTAL_UNPACK_HARD,
        params: budget.params,
        label: "7z 解压总输出",
        unit: " 字节",
      });
      budget.params = withLimit(budget.params, { _allowLimitOverride: true });
    }
    budget.n++;
    const data = takeFileBytes(FS, full);
    if (data.length > MAX_ENTRY_UNPACK) {
      checkLimit({
        scope: "sevenzip.unpack.entrySize",
        actual: data.length,
        soft: MAX_ENTRY_UNPACK,
        hard: MAX_ENTRY_UNPACK_HARD,
        params: budget.params,
        label: "7z 单成员解压大小",
        unit: " 字节",
      });
      budget.params = withLimit(budget.params, { _allowLimitOverride: true });
    }
    if (budget.bytes + data.length > MAX_TOTAL_UNPACK) {
      checkLimit({
        scope: "sevenzip.unpack.totalOutput",
        actual: budget.bytes + data.length,
        soft: MAX_TOTAL_UNPACK,
        hard: MAX_TOTAL_UNPACK_HARD,
        params: budget.params,
        label: "7z 解压总输出",
        unit: " 字节",
      });
      budget.params = withLimit(budget.params, { _allowLimitOverride: true });
    }
    budget.bytes += data.length;
    out.push({ name: rel, bytes: data });
  }
}

// ============================================================
// 输出渲染工具
// ============================================================
function bytesToOutput(bytes) {
  if (!bytes || bytes.length === 0) return { text: "", mode: "text" };
  try {
    const s = _decodeUtf8Fatal(bytes);
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
  const res = await run7zWasm(bytes, { extract: mode === "extract", password, params: p });
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
  if (!res.ok) {
    lines.push("");
    lines.push("✗ 7z 报告失败（退出码 " + res.code + "）：坏头/截断/密码错误均如实失败，不产出半解文件。");
    return lines.join("\n");
  }
  if (mode === "extract") {
    lines.push("");
    lines.push("解出文件: " + res.files.length + " 个");
    lines.push("资源上限: 条目软 " + MAX_FILES + " / 硬 " + MAX_FILES_HARD +
      "；单成员软 " + (MAX_ENTRY_UNPACK / MIB) + " MiB / 硬 " + (MAX_ENTRY_UNPACK_HARD / MIB) +
      " MiB；总输出软 " + (MAX_TOTAL_UNPACK / MIB) + " MiB / 硬 " + (MAX_TOTAL_UNPACK_HARD / MIB) +
      " MiB。超软阈值会先确认，超硬上限直接失败。");
    const MIME = { txt: "text/plain", log: "text/plain", json: "application/json", png: "image/png", gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg", zip: "application/zip", pdf: "application/pdf" };
    const outFiles = [];
    res.files.forEach((f, i) => {
      outFiles.push({ name: f.name || `file_${i + 1}`, mime: MIME[String(f.name || "").split(".").pop().toLowerCase()] || "application/octet-stream", bytes: f.bytes });
      if (i < 3) {
        const r = bytesToOutput(f.bytes);
        lines.push("");
        lines.push("· " + f.name + "  (" + f.bytes.length + " 字节, " + r.mode + ")");
        const preview = r.text.length > 500 ? r.text.slice(0, 500) + " …(截断)" : r.text;
        lines.push("  " + preview.replace(/\n/g, "\n  "));
      }
    });
    if (res.files.length > 3) lines.push("\n（其余 " + (res.files.length - 3) + " 个省略预览，全部可在下方下载）");
    return { text: lines.join("\n"), files: outFiles };
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
  cat: "archive",
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
    { sensitive: true, key: "password", label: "密码（可空）", type: "password", default: "", placeholder: "加密档案填密码" },
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
  try { res = await run7zWasm(u8a, { extract: false }); } catch (e) {
    if (isLimitError(e)) throw e;
    res = null;
  }
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
