/*
 * customImpl.js — 自定义算法实现（MT72）：用户用 JS 替换某 op 的 encode/decode。
 *
 * 职责分层（红线：算法层零 UI 依赖）：
 *  本文件                     = 纯逻辑：沙箱编译、执行、白名单工具、预设模板（无 DOM）
 *  customImplStore.js         = 持久化与方案管理（localStorage，纯数据，无 DOM）
 *  customImplClient.js        = 主线程调度（Worker 优先 + 超时硬杀 + 降级主线程）
 *  customImplWorker.js        = Worker 执行端（realm 内删网络 API，跑用户代码）
 *  src/ui/customImplEditor.js = 编辑器 UI（勾选框 / 代码编辑器 / 变量面板 / 预设 / 方案管理）
 *
 * 用户代码约定（写入编辑器模板与预设）：
 *  可用形参：input（字符串）、rawBytes（Uint8Array|null，bytes 类 op 拖入的真字节）、
 *            params（当前 op 全部参数对象，iv/key/table/mode 等原参数照常有效）、
 *            dir（"encode" | "decode"）、H（白名单工具，见 buildHelpers）
 *  返回：字符串（最常用）或 Uint8Array（UTF-8 可解则按 UTF-8，否则 latin1 直通不丢字节）
 *
 * ── 沙箱说明（诚实版，别把它当安全边界宣传）───────────────────────────────
 *  三层防护，强度递减：
 *   1. Worker realm 隔离（真隔离）：Worker 里没有 DOM，且启动即删掉 fetch/XHR/WebSocket/
 *      EventSource/importScripts/eval 等，该 realm 内**根本不存在**这些能力 → 零外发红线在此落地。
 *   2. 超时硬杀（真防护）：主线程 terminate 死循环 Worker，页面不冻。
 *   3. 词法遮蔽（防手滑，不防恶意）：编译时把危险全局名当形参注入 undefined。
 *      ⚠ 同 realm 内 JS 无法真沙箱——`(()=>{}).constructor("return globalThis")()` 可绕过遮蔽。
 *      所以主线程降级路径只当"能跑"，不当"安全"；真正的隔离永远来自第 1 层。
 *
 * ⚠ 编译用 new Function——MT72 在鸿蒙原生版不可用（ArkTS 禁 eval/new Function），
 *   已在 MT79 能力矩阵登记「鸿蒙版该功能不可用」。
 */

// ============ 白名单工具（自包含，零依赖；Worker 与主线程均可用） ============

const te = () => (typeof TextEncoder !== "undefined" ? new TextEncoder() : null);
const td = () => (typeof TextDecoder !== "undefined" ? new TextDecoder("utf-8") : null);

function utf8Encode(text) {
  const e = te();
  if (e) return e.encode(String(text));
  // 兜底（极端环境）：latin1 直通
  const s = String(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < out.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function utf8Decode(bytes) {
  const d = td();
  if (d) return d.decode(toBytes(bytes));
  let s = "";
  for (const b of toBytes(bytes)) s += String.fromCharCode(b & 0xff);
  return s;
}

function hexEncode(bytes) {
  let s = "";
  for (const b of toBytes(bytes)) s += (b & 0xff).toString(16).padStart(2, "0");
  return s;
}

function hexDecode(hexStr) {
  const s = String(hexStr).replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]*$/.test(s) || s.length % 2) throw new Error("hexDecode: 非法 hex（长度须为偶数且仅含 0-9a-f）");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}

const B64_STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function b64Encode(bytes, table) {
  const TABLE = typeof table === "string" && table.length >= 64 ? table : B64_STD;
  if (TABLE === B64_STD && typeof btoa === "function") {
    let bin = "";
    for (const b of toBytes(bytes)) bin += String.fromCharCode(b & 0xff);
    return btoa(bin);
  }
  // 手写 Base64（换表时必走此路；也兼容无 btoa 的环境，如 ArkTS）
  let bits = "", out = "";
  for (const b of toBytes(bytes)) {
    bits += (b & 0xff).toString(2).padStart(8, "0");
    while (bits.length >= 6) { out += TABLE[parseInt(bits.slice(0, 6), 2)]; bits = bits.slice(6); }
  }
  if (bits.length) out += TABLE[parseInt(bits.padEnd(6, "0"), 2)];
  const pad = TABLE[64] != null ? TABLE[64] : "=";
  return out.padEnd(Math.ceil(out.length / 4) * 4, pad);
}

function b64Decode(str, table) {
  const TABLE = typeof table === "string" && table.length >= 64 ? table : B64_STD;
  const pad = TABLE[64] != null ? TABLE[64] : "=";
  const s = String(str).replace(/\s+/g, "").split(pad)[0];
  if (TABLE === B64_STD && typeof atob === "function") {
    const bin = atob(s.replace(/[^A-Za-z0-9+/]/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const rev = new Map();
  for (let i = 0; i < 64; i++) rev.set(TABLE[i], i);
  let bits = "";
  const out = [];
  for (const ch of s) {
    const v = rev.get(ch);
    if (v == null) continue;
    bits += v.toString(2).padStart(6, "0");
    while (bits.length >= 8) { out.push(parseInt(bits.slice(0, 8), 2)); bits = bits.slice(8); }
  }
  return new Uint8Array(out);
}

// RFC 4648 §6 Base32（默认标准字母表；换表用于 CTF 魔改）
const B32_STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function b32Encode(bytes, table) {
  const TABLE = typeof table === "string" && table.length >= 32 ? table : B32_STD;
  let bits = "", out = "";
  for (const b of toBytes(bytes)) {
    bits += (b & 0xff).toString(2).padStart(8, "0");
    while (bits.length >= 5) { out += TABLE[parseInt(bits.slice(0, 5), 2)]; bits = bits.slice(5); }
  }
  if (bits.length) out += TABLE[parseInt(bits.padEnd(5, "0"), 2)];
  return out.padEnd(Math.ceil(out.length / 8) * 8, "=");
}

function b32Decode(str, table) {
  const TABLE = typeof table === "string" && table.length >= 32 ? table : B32_STD;
  const rev = new Map();
  for (let i = 0; i < 32; i++) rev.set(TABLE[i], i);
  let bits = "";
  const out = [];
  for (const ch of String(str).replace(/[=\s]/g, "")) {
    const v = rev.get(ch);
    if (v == null) continue;
    bits += v.toString(2).padStart(5, "0");
    while (bits.length >= 8) { out.push(parseInt(bits.slice(0, 8), 2)); bits = bits.slice(8); }
  }
  return new Uint8Array(out);
}

function xorBytes(a, b) {
  const x = toBytes(a), y = toBytes(b);
  if (!x.length || !y.length) return new Uint8Array(0);
  const out = new Uint8Array(Math.max(x.length, y.length));
  for (let i = 0; i < out.length; i++) out[i] = (x[i % x.length] ^ y[i % y.length]) & 0xff;
  return out;
}

function bytesToStr(bytes) {
  let s = "";
  for (const b of toBytes(bytes)) s += String.fromCharCode(b & 0xff);
  return s;
}

function strToBytes(s) {
  const str = String(s);
  const out = new Uint8Array(str.length);
  for (let i = 0; i < out.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

/** 宽松入参归一：Uint8Array / 普通数组 / 字符串（latin1）都收，返回 Uint8Array。 */
function toBytes(v) {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return new Uint8Array(v);
  if (typeof v === "string") return strToBytes(v);
  if (v && typeof v.length === "number") return new Uint8Array(v);
  return new Uint8Array(0);
}

function concatBytes(...arrs) {
  const list = arrs.map(toBytes);
  const total = list.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of list) { out.set(a, off); off += a.length; }
  return out;
}

function chunk(arr, n) {
  const size = Math.max(1, Number(n) || 1);
  const src = typeof arr === "string" ? arr : toBytes(arr);
  const out = [];
  for (let i = 0; i < src.length; i += size) out.push(src.slice(i, i + size));
  return out;
}

/** 位移工具（8/32 位循环移位；CTF 魔改分组密码常用）。 */
function rol8(b, n) { const x = b & 0xff, k = ((n % 8) + 8) % 8; return ((x << k) | (x >>> (8 - k))) & 0xff; }
function ror8(b, n) { return rol8(b, 8 - (((n % 8) + 8) % 8)); }
function rol32(v, n) { const x = v >>> 0, k = ((n % 32) + 32) % 32; return (((x << k) | (x >>> (32 - k))) >>> 0); }
function ror32(v, n) { return rol32(v, 32 - (((n % 32) + 32) % 32)); }
/** 字节内比特逆序（LSB↔MSB，Base 系列位序魔改用）。 */
function reverseBits(b) {
  let x = b & 0xff, r = 0;
  for (let i = 0; i < 8; i++) { r = (r << 1) | (x & 1); x >>= 1; }
  return r & 0xff;
}

/** 字节流 ↔ 比特串（"0101..."），位宽魔改类题目直接用。 */
function toBits(bytes) {
  let s = "";
  for (const b of toBytes(bytes)) s += (b & 0xff).toString(2).padStart(8, "0");
  return s;
}
function fromBits(bits) {
  const s = String(bits).replace(/[^01]/g, "");
  const out = new Uint8Array(Math.floor(s.length / 8));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 8, 8), 2);
  return out;
}

/** 通用字母表位移（凯撒/ROT 家族的底座，模数由字母表长度决定）。 */
function rotN(text, n, alphabet) {
  const ALPHA = typeof alphabet === "string" && alphabet.length ? alphabet : "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const size = ALPHA.length;
  const idx = new Map();
  for (let i = 0; i < size; i++) idx.set(ALPHA[i], i);
  const shift = ((Number(n) || 0) % size + size) % size;
  let out = "";
  for (const ch of String(text)) {
    const i = idx.get(ch);
    out += i == null ? ch : ALPHA[(i + shift) % size];
  }
  return out;
}

/** CRC-32（IEEE 802.3 反射多项式 0xEDB88320，与 zip/png 同口径），返回无符号 32 位。 */
let _crcTable = null;
function crc32(bytes) {
  if (!_crcTable) {
    _crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      _crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of toBytes(bytes)) crc = (_crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xffffffff) >>> 0;
}

/** 构建用户代码可见的白名单工具对象（纯函数，不给 DOM/网络/存储）。 */
export function buildHelpers() {
  return {
    utf8Encode, utf8Decode, hexEncode, hexDecode,
    b64Encode, b64Decode, b32Encode, b32Decode,
    xorBytes, bytesToStr, strToBytes, toBytes, concatBytes, chunk,
    rol8, ror8, rol32, ror32, reverseBits, toBits, fromBits, rotN, crc32,
  };
}

/** 变量面板用的签名表（UI 只读展示 + 点击插入，见 customImplEditor）。 */
export const CUSTOM_VAR_SIGNATURES = [
  { name: "input", sig: "input: string", note: "左边输入框里的原文，是个字符串。encode 时就是你要编码的内容。" },
  { name: "rawBytes", sig: "rawBytes: Uint8Array | null", note: "只有你往这个 op 拖了文件进来才有值，存的是文件的原始字节；纯文本操作的 op 它是 null。" },
  { name: "params", sig: "params: object", note: "这个 op 的全部参数，跟上方参数栏填的一模一样，key 名也同名。比如参数栏有个 key，就写 params.key。" },
  { name: "dir", sig: 'dir: "encode" | "decode"', note: "当前是在编码还是解码。dir===\"encode\" 是编码，dir===\"decode\" 是解码。" },
  { name: "H", sig: "H: object", note: "内置工具包，下面「工具」列表里全是。直接 H.hexEncode()、H.sha256() 这样用，省得自己手写。" },
];

export const CUSTOM_HELPER_SIGNATURES = [
  { name: "utf8Encode", sig: "utf8Encode(text) -> Uint8Array", note: "把文本转成 UTF-8 字节数组" },
  { name: "utf8Decode", sig: "utf8Decode(bytes) -> string", note: "把 UTF-8 字节数组解回文本" },
  { name: "hexEncode", sig: "hexEncode(bytes) -> string", note: "把字节转成 hex 串，比如 [0x68,0x69] → '6869'" },
  { name: "hexDecode", sig: "hexDecode(hex) -> Uint8Array", note: "把 hex 串还原成字节，比如 '6869' → [0x68,0x69]" },
  { name: "b64Encode", sig: "b64Encode(bytes, table?) -> string", note: "Base64 编码；第二个参数可传自定义 64 字符码表（CTF 换表用）" },
  { name: "b64Decode", sig: "b64Decode(str, table?) -> Uint8Array", note: "Base64 解码；码表跟编码时传同一张即可" },
  { name: "b32Encode", sig: "b32Encode(bytes, table?) -> string", note: "Base32 编码；第二个参数可传自定义 32 字符码表" },
  { name: "b32Decode", sig: "b32Decode(str, table?) -> Uint8Array", note: "Base32 解码；码表跟编码时传同一张即可" },
  { name: "xorBytes", sig: "xorBytes(a, b) -> Uint8Array", note: "两个字节数组按位 XOR，短的那个会自动循环补" },
  { name: "bytesToStr", sig: "bytesToStr(bytes) -> string（latin1）", note: "字节数组按 latin1 逐字节转文本，不丢字节" },
  { name: "strToBytes", sig: "strToBytes(str) -> Uint8Array（latin1）", note: "文本按 latin1 逐字节转字节数组" },
  { name: "toBytes", sig: "toBytes(any) -> Uint8Array", note: "不管给的是字节数组/普通数组/字符串，都归一成 Uint8Array" },
  { name: "concatBytes", sig: "concatBytes(...arrs) -> Uint8Array", note: "把多个字节数组按顺序拼成一个" },
  { name: "chunk", sig: "chunk(arrOrStr, n) -> Array", note: "把数组或字符串按每 n 个一组切成一段段" },
  { name: "rol8", sig: "rol8(byte, n) -> number", note: "一个字节循环左移 n 位，多出去的高位补回低位" },
  { name: "ror8", sig: "ror8(byte, n) -> number", note: "一个字节循环右移 n 位，多出去的低位补回高位" },
  { name: "rol32", sig: "rol32(u32, n) -> number", note: "32 位数循环左移 n 位（分组密码改轮函数常用）" },
  { name: "ror32", sig: "ror32(u32, n) -> number", note: "32 位数循环右移 n 位" },
  { name: "reverseBits", sig: "reverseBits(byte) -> number", note: "把一个字节的比特位顺序整个倒过来，比如 0b0000_0001 → 0b1000_0000" },
  { name: "toBits", sig: "toBits(bytes) -> string", note: "把字节展开成 '01010101' 这样的二进制串（每字节 8 位）" },
  { name: "fromBits", sig: "fromBits(bitStr) -> Uint8Array", note: "把 '01010101' 这样的二进制串每 8 位还原成一个字节" },
  { name: "rotN", sig: "rotN(text, n, alphabet?) -> string", note: "按字母表做位移（凯撒/ROT 的底座）；第三个参数可传自定义字母表，默认大写字母" },
  { name: "crc32", sig: "crc32(bytes) -> number", note: "算 CRC32 校验值，跟 zip、png 用的同一套算法" },
];

// ============ 沙箱：危险全局的词法遮蔽 ============

/*
 * 编译时把这些名字当形参注入 undefined，用户代码里写 fetch(...) 拿到的是 undefined。
 * ⚠ 只防手滑不防恶意（constructor 链可绕过）；真隔离靠 Worker realm 删全局，见 customImplWorker.js。
 * ⚠ 严格模式下 `eval` / `arguments` 不能作形参名（SyntaxError），故不入表——它们由 Worker 端删除处理。
 */
export const SANDBOX_SHADOW = [
  "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "sendBeacon",
  "navigator", "location", "document", "window", "self", "globalThis", "parent", "top", "frames",
  "localStorage", "sessionStorage", "indexedDB", "caches", "cookieStore",
  "Worker", "SharedWorker", "ServiceWorker", "BroadcastChannel", "MessageChannel",
  "postMessage", "close", "open", "alert", "confirm", "prompt",
  "Function", "require", "process", "module", "exports", "Deno", "Bun",
];

const FN_ARGS = ["input", "rawBytes", "params", "dir", "H", ...SANDBOX_SHADOW];

// ============ 行号定位（判据：语法错误给行号，不给白屏） ============

/*
 * new Function 生成的源形如：
 *   function anonymous(input,rawBytes,…\n) {\n"use strict";\n<用户代码第 1 行>…
 * 用户代码第 1 行在整体源里的行号 = 偏移 + 1。偏移各引擎理论一致（2），
 * 但不写死——用一次「已知在第 1 行抛错」的探针自校准，跨引擎稳。
 */
let _lineOffset = null;
function lineOffset() {
  if (_lineOffset !== null) return _lineOffset;
  _lineOffset = 2; // 理论值兜底
  try {
    const probe = new Function(...FN_ARGS, '"use strict";\nthrow new Error("__lineprobe__");');
    try { probe(); } catch (e) {
      const raw = rawErrLine(e);
      if (raw && raw > 0) _lineOffset = raw - 1;
    }
  } catch { /* 探针失败则用理论值 */ }
  return _lineOffset;
}

/** 从 Error 里抠出「整体源」行号（未减偏移）。跨引擎多路取值。 */
function rawErrLine(e) {
  if (!e) return null;
  // Firefox / Safari：直接给 lineNumber / line
  if (typeof e.lineNumber === "number" && e.lineNumber > 0) return e.lineNumber;
  if (typeof e.line === "number" && e.line > 0) return e.line;
  const stack = String(e.stack || "");
  // Chromium：at anonymous (<anonymous>:4:9) / at eval (…, <anonymous>:4:9)
  let m = stack.match(/<anonymous>:(\d+):\d+/);
  if (m) return Number(m[1]);
  // Firefox 备用：anonymous@file://… line 3 > Function:4:7
  m = stack.match(/Function:(\d+):\d+/);
  if (m) return Number(m[1]);
  return null;
}

/** 运行时错误 → 用户代码行号（1 基）；拿不到返回 null。 */
export function runtimeErrLine(e) {
  const raw = rawErrLine(e);
  if (!raw) return null;
  const ln = raw - lineOffset();
  return ln > 0 ? ln : null;
}

/*
 * 语法错误定位器（结构扫描）。
 * 背景：Chromium 对 new Function 的 SyntaxError **不给任何位置信息**（stack 无帧），
 * 而 CTF 用户最常犯的正是括号不配对 / 引号未闭合。这里做一遍单趟扫描，
 * 精确报出「未闭合」与「多余闭合」的行号；扫不出结构问题则回退引擎给的行号。
 * 只判结构，不做完整 JS 解析——报不出来就返回 null，由上层显示原始错误消息（绝不白屏）。
 */
export function locateSyntaxLine(code) {
  const src = String(code);
  const stack = [];
  let line = 1;
  let i = 0;
  const PAIR = { ")": "(", "]": "[", "}": "{" };
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") { line++; i++; continue; }
    // 注释
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") {
      const start = line;
      i += 2;
      let closed = false;
      while (i < src.length) {
        if (src[i] === "\n") line++;
        else if (src[i] === "*" && src[i + 1] === "/") { i += 2; closed = true; break; }
        i++;
      }
      if (!closed) return { line: start, reason: "blockComment" };
      continue;
    }
    // 字符串 / 模板串
    if (c === '"' || c === "'" || c === "`") {
      const quote = c, start = line;
      i++;
      let closed = false;
      while (i < src.length) {
        const d = src[i];
        if (d === "\\") { if (src[i + 1] === "\n") line++; i += 2; continue; }
        if (d === "\n") {
          if (quote === "`") { line++; i++; continue; }
          break; // 普通引号不允许裸换行 → 未闭合
        }
        if (d === quote) { i++; closed = true; break; }
        i++;
      }
      if (!closed) return { line: start, reason: "string" };
      continue;
    }
    if (c === "(" || c === "[" || c === "{") { stack.push({ ch: c, line }); i++; continue; }
    if (c === ")" || c === "]" || c === "}") {
      const top = stack.pop();
      if (!top) return { line, reason: "extraClose" };
      if (top.ch !== PAIR[c]) return { line, reason: "mismatch" };
      i++;
      continue;
    }
    i++;
  }
  if (stack.length) return { line: stack[stack.length - 1].line, reason: "unclosed" };
  return null;
}

// ============ 编译与执行 ============

/**
 * 编译用户代码：new Function 包装 + 危险全局词法遮蔽。
 * @returns {{fn:Function}|{error:string, line:?number, reason:?string}}
 */
export function compileUserFn(code) {
  try {
    const fn = new Function(...FN_ARGS, '"use strict";\n' + String(code));
    return { fn };
  } catch (e) {
    // 语法错误：先用结构扫描给精确行（Chromium 不给位置），扫不出再退引擎行号
    const hit = locateSyntaxLine(code);
    let line = hit ? hit.line : null;
    if (line == null) {
      const raw = rawErrLine(e);
      if (raw) { const n = raw - lineOffset(); if (n > 0) line = n; }
    }
    return { error: e.message || String(e), line, reason: hit ? hit.reason : null };
  }
}

/**
 * 执行用户代码。
 * @param {{code:string, dir:string, input:string, params:object, rawBytes:?Uint8Array, helpers:?object}} req
 * @returns {{ok:true, out:string}|{ok:false, error:string, line:?number, phase:string}}
 */
export function runCustomImpl({ code, dir, input, params, rawBytes, helpers }) {
  const c = compileUserFn(code);
  if (c.error) return { ok: false, error: c.error, line: c.line, phase: "compile", reason: c.reason };
  try {
    const out = c.fn(
      input == null ? "" : String(input),
      rawBytes && rawBytes.length ? rawBytes : null,
      params || {},
      dir === "encode" ? "encode" : "decode",
      helpers || buildHelpers(),
      // 其余形参（SANDBOX_SHADOW）不传 → 全是 undefined，达成词法遮蔽
    );
    return { ok: true, out: normalizeOut(out) };
  } catch (e) {
    return { ok: false, error: e.message || String(e), line: runtimeErrLine(e), phase: "run" };
  }
}

/**
 * 输出归一化。
 * Uint8Array/数字数组 → 先按严格 UTF-8 解，非法则 latin1 直通（CTF 里 XOR 出来的常不是合法 UTF-8，
 * 用宽松解码会把它变成一串 U+FFFD 丢字节，用户没法再接 hex/base64 查看——所以这里不丢字节）。
 */
function normalizeOut(out) {
  if (out == null) return "";
  if (out instanceof Uint8Array) return bytesToText(out);
  if (ArrayBuffer.isView(out)) return bytesToText(new Uint8Array(out.buffer, out.byteOffset, out.byteLength));
  if (out instanceof ArrayBuffer) return bytesToText(new Uint8Array(out));
  if (Array.isArray(out)) {
    if (out.length && out.every((v) => typeof v === "number")) return bytesToText(new Uint8Array(out));
    return out.map((v) => String(v)).join("\n");
  }
  if (typeof out === "object") {
    try { return JSON.stringify(out, null, 2); } catch { return String(out); }
  }
  return String(out);
}

function bytesToText(bytes) {
  if (typeof TextDecoder !== "undefined") {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { /* 落 latin1 */ }
  }
  return bytesToStr(bytes);
}

// ============ CTF 常用预设魔改（模板，用户可在此基础上改） ============

// MT86/T356：EXTRA_PRESETS 扩充 24 个魔改预设（Base58 换表 / 凯撒多档 / TEA·XXTEA 自定义轮数 /
// Hill 加密 / 按位反码 / baseWidthBits 宽基底等）。依赖 zero 循环、自包含，Worker 与主线程均可用。
import { EXTRA_PRESETS } from "./customPresetsExtra.js";

/*
 * 预设选型依据：MT72 需求 §4 点名的六类（Base64 换表 / 码表移位逆序 / 凯撒非 26 /
 * XOR 递增位置相关 / 分组密码 S 盒替换 / 摩斯符号替换）+ CTF 高频的 Base32 换表。
 * 每条都可直接跑，参数从 params 取（用户在 op 参数栏填什么，这里就能拿到什么）。
 */
export const CUSTOM_PRESETS = [
  {
    id: "b64CustomTable", name: "Base64 自定义码表",
    code: `// Base64 换表：改 TABLE 即可（64 字符 + 可选第 65 个作填充符）。
// 取参优先级：op 参数栏的 params.table > 这里的常量。
const TABLE = params.table || "ZYXWVUTSRQPONMLKJIHGFEDCBA9876543210abcdefghijklmnopqrstuvwxyz+/";
if (dir === "decode") return H.utf8Decode(H.b64Decode(input, TABLE));
return H.b64Encode(rawBytes || H.utf8Encode(input), TABLE);`,
  },
  {
    id: "b64ShiftTable", name: "Base64 码表移位 / 逆序",
    code: `// 标准码表整体左移 shift 位；params.reverse 为真时改成逆序表。
const STD = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const shift = Number(params.shift ?? params.n ?? 13);
const TABLE = params.reverse
  ? STD.split("").reverse().join("")
  : STD.slice(shift % 64) + STD.slice(0, shift % 64);
if (dir === "decode") return H.utf8Decode(H.b64Decode(input, TABLE));
return H.b64Encode(rawBytes || H.utf8Encode(input), TABLE);`,
  },
  {
    id: "b32CustomTable", name: "Base32 自定义码表",
    code: `// Base32 换表（RFC 4648 标准表 A-Z2-7；CTF 常见把 2-7 换成 0-5 或整表打乱）。
const TABLE = params.table || "0123456789ABCDEFGHIJKLMNOPQRSTUV";
if (dir === "decode") return H.utf8Decode(H.b32Decode(input, TABLE));
return H.b32Encode(rawBytes || H.utf8Encode(input), TABLE);`,
  },
  {
    id: "caesarModN", name: "凯撒非 26 模数 / 自定义字母表",
    code: `// 凯撒：模数 = 字母表长度（CTF 常见 mod 36 / mod 62 / 自定义乱序表）。
const ALPHA = params.alphabet || params.table || "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const shift = Number(params.shift ?? params.n ?? 3);
return H.rotN(input, dir === "decode" ? -shift : shift, ALPHA);`,
  },
  {
    id: "rotStepSkip", name: "ROT 跳步位移（位置相关）",
    code: `// 每个字符位移量随位置递增：第 i 个可映射字符移 (i * step + base) 位。
const ALPHA = params.alphabet || "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const step = Number(params.step ?? 1);
const base = Number(params.shift ?? 0);
const size = ALPHA.length;
const idx = new Map([...ALPHA].map((c, i) => [c, i]));
let out = "", pos = 0;
for (const ch of input) {
  const i = idx.get(ch);
  if (i == null) { out += ch; continue; }
  const sh = ((pos * step + base) % size + size) % size;
  const k = (dir === "decode" ? i - sh + size : i + sh) % size;
  out += ALPHA[k];
  pos++;
}
return out;`,
  },
  {
    id: "xorIncKey", name: "XOR 递增 / 位置相关 key",
    code: `// 第 i 字节的密钥 = key[i % len] + i * step（step=0 退化为标准重复 key XOR）。
// 约定：产生任意字节的算法，encode 输出 hex、decode 读 hex——避免字符编码歧义导致往返丢字节。
const KEY = H.strToBytes(params.key || params.k || "key");
const step = Number(params.step ?? params.inc ?? 1);
const data = dir === "decode" ? H.hexDecode(input) : (rawBytes || H.utf8Encode(input));
const out = new Uint8Array(data.length);
for (let i = 0; i < data.length; i++) {
  out[i] = (data[i] ^ ((KEY[i % KEY.length] + i * step) & 0xff)) & 0xff;
}
// decode 直接返回字节：能按 UTF-8 解就出文本，不能则 latin1 直通不丢字节。
return dir === "decode" ? out : H.hexEncode(out);`,
  },
  {
    id: "sboxSubst", name: "分组密码 S 盒 / 字节替换表",
    code: `// 字节替换表（S 盒）魔改：encode 查表、decode 查逆表。
// 这里用「仿射生成」造一张可逆 S 盒：S[x] = (a * x + b) mod 256，a 必须是奇数才可逆。
// 约定同上：encode 输出 hex、decode 读 hex。
const a = Number(params.a ?? 5) | 1;   // 强制奇数，保证可逆
const b = Number(params.b ?? 0x1f) & 0xff;
const S = new Uint8Array(256), INV = new Uint8Array(256);
for (let x = 0; x < 256; x++) { S[x] = (a * x + b) & 0xff; INV[S[x]] = x; }
const T = dir === "decode" ? INV : S;
const data = dir === "decode" ? H.hexDecode(input) : (rawBytes || H.utf8Encode(input));
const out = new Uint8Array(data.length);
for (let i = 0; i < data.length; i++) out[i] = T[data[i] & 0xff];
return dir === "decode" ? out : H.hexEncode(out);`,
  },
  {
    id: "morseSwap", name: "摩斯点划符号替换",
    code: `// 点/划换符（CTF 常见用 01、A/B、汉字等替代 . 和 -）。
const DOT = params.dot ?? "0";
const DASH = params.dash ?? "1";
const SEP = params.sep ?? " ";
const MORSE = { A:".-",B:"-...",C:"-.-.",D:"-..",E:".",F:"..-.",G:"--.",H:"....",I:"..",J:".---",K:"-.-",L:".-..",M:"--",N:"-.",O:"---",P:".--.",Q:"--.-",R:".-.",S:"...",T:"-",U:"..-",V:"...-",W:".--",X:"-..-",Y:"-.--",Z:"--..","0":"-----","1":".----","2":"..---","3":"...--","4":"....-","5":".....","6":"-....","7":"--...","8":"---..","9":"----." };
const enc = (m) => m.split("").map((c) => (c === "." ? DOT : DASH)).join("");
if (dir === "decode") {
  const rev = new Map(Object.entries(MORSE).map(([ch, m]) => [enc(m), ch]));
  return input.trim().split(new RegExp("[" + SEP.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&") + "\\\\s]+")).map((tok) => rev.get(tok) ?? "").join("");
}
return input.toUpperCase().split("").filter((ch) => MORSE[ch]).map((ch) => enc(MORSE[ch])).join(SEP);`,
  },
];

/** 通用模板（新建时的起始代码）。一段可直接运行的最小示例，把 input / params / dir / H 各演示一次。 */
export const CUSTOM_TEMPLATE = `// 这是一个可以直接跑的示例：把 input 转成 hex 编码。
// 试试：左边输入 hello，点「编码」→ 得到 68656c6c6f；点「解码」→ 回到 hello。

// dir 告诉你现在是在编码还是解码，各写各的逻辑就行。
if (dir === "decode") {
  // 解码方向：hex 字符串 → 文本
  // H.hexDecode 把 hex 串变成字节数组，H.utf8Decode 再把它变回文本。
  return H.utf8Decode(H.hexDecode(input));
}

// 编码方向：文本 → hex 字符串
// input 就是左边输入框的原文，直接用。
let text = input;

// params 跟上方参数栏一模一样：参数栏加一个 reverse 参数，这里就能读 params.reverse。
// 用途举例：把字符串倒过来再编码。
if (params.reverse === "true") {
  text = text.split("").reverse().join("");
}

// H.utf8Encode 把文本变成字节，H.hexEncode 把字节变成 hex 串。
return H.hexEncode(H.utf8Encode(text));`;

// ============ 预设登记（插件可注入，见 pluginContext.registerCustomImpl） ============

const _extraPresets = [];

/**
 * 追加一个预设（插件能力面 §MT72-5）。
 * @param {{id:string, name:string, code:string, opId?:string}} preset opId 为空表示对所有 op 可见
 * @returns {object} 归一化后的预设对象（供调用方回收）
 */
export function addCustomPreset(preset) {
  if (!preset || typeof preset.code !== "string" || !preset.code.trim()) {
    throw new Error("addCustomPreset 需要 { id, name, code }");
  }
  const p = {
    id: String(preset.id || "preset" + (_extraPresets.length + 1)),
    name: String(preset.name || preset.id || "预设"),
    code: preset.code,
    opId: preset.opId ? String(preset.opId) : null,
    source: preset.source || null,
  };
  _extraPresets.push(p);
  return p;
}

/** 移除已登记的追加预设（插件卸载时回收）。 */
export function removeCustomPreset(preset) {
  const i = _extraPresets.indexOf(preset);
  if (i >= 0) { _extraPresets.splice(i, 1); return true; }
  const j = _extraPresets.findIndex((p) => p.id === (preset && preset.id));
  if (j >= 0) { _extraPresets.splice(j, 1); return true; }
  return false;
}

/** 某 op 可见的全部预设 = 内置 + 扩充(T356) + 插件登记（opId 为空的对所有 op 可见）。 */
export function presetsFor(opId) {
  return CUSTOM_PRESETS.concat(EXTRA_PRESETS, _extraPresets.filter((p) => !p.opId || p.opId === opId));
}

export default { buildHelpers, compileUserFn, runCustomImpl, CUSTOM_PRESETS, presetsFor };
