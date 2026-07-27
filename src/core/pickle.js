/*
 * pickle.js — Python pickle 字节码反汇编 / 解析（T269，cat:'analysis'，run 单向）。
 *
 * 用途：CTF misc 常见「给一段 pickle 二进制，看它反序列化时会做什么」。
 * 本 op 逐 opcode 反汇编（pickletools.dis 风格），并高亮危险操作
 * （GLOBAL / STACK_GLOBAL / REDUCE / INST / OBJ / NEWOBJ / BUILD / EXT*）
 * 命中 os.system / subprocess / eval / exec 等 RCE 常用符号会额外标红提示。
 *
 * 算法来源（真实 pickle 协议，非编造）：
 * - CPython Lib/pickle.py 的 opcode 常量定义（协议 0-5）。
 * - CPython Lib/pickletools.py 的 opcode 参数读取语义（argument descriptors）+ dis 输出风格。
 * 参数读取规则逐字节对照 pickletools：uintN LE / int4 LE / float8 BE /
 * line(readline) / stringnl / bytesN(长度前缀) / longN(小端补码大整数)。
 *
 * 契约：run(text, params) 返回反汇编报告文本（非 hex）。无 encode/decode。
 * 输入按 hex / base64 / 原始字节解析（inputEnc 参数）。
 * 零外发，纯本地静态分析——只解读字节码结构，绝不执行 pickle。
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(s);

// ============================================================
// 输入 → 字节（hex / base64 / auto；参照 compress.js 的 inputToBytes 约定）
// ============================================================
function isHex(s) { return /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 && s.length >= 2; }
const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
function isB64(s) {
  if (!s || s.length % 4 !== 0) return false;
  for (const c of s) if (!B64_CHARS.includes(c)) return false;
  return true;
}
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
function inputToBytes(text, enc) {
  const raw = String(text);
  const s = raw.trim().replace(/\s+/g, "");
  if (enc === "hex") { if (!isHex(s)) throw new Error("输入不是合法 hex（偶数长度 0-9a-f）"); return hexToBytes(s); }
  if (enc === "base64") { try { return b64ToBytes(s); } catch { throw new Error("输入不是合法 base64"); } }
 // auto：优先 hex，其次 base64，否则按原始字节（latin1，逐字符取 charCode）
  if (isHex(s)) return hexToBytes(s);
  if (isB64(s)) { try { return b64ToBytes(s); } catch { /* fall through */ } }
 // 原始字节：若全在 latin1 范围直接取码点，否则退回 UTF-8 编码
  let latin1 = true;
  for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) > 0xFF) { latin1 = false; break; }
  if (latin1) {
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  return te(raw);
}

// ============================================================
// opcode 表（协议 0-5，逐条对照 CPython pickle.py）
// arg: 参数读取类型；proto: 引入该 opcode 的协议版本
// markConsumer: 该 opcode 会消费一个 MARK（pop 到 markobject），用于缩进
// ============================================================
// 参数类型：
// none 无参
// uint1/2/4/8 无符号小端整数（N 字节）
// int4 有符号小端 4 字节
// float8 8 字节大端 IEEE754 double（BINFLOAT）
// line readline（读到 \n），十进制/字符串行参数
// stringnl 带引号的 NL 结束字符串（STRING/UNICODE）
// line2 连续两个 readline（module\nname\n，GLOBAL/INST）
// bytes1/4/8 长度前缀（N 字节小端）+ 该长度的数据
// long1/4 长度前缀（1 或 4 字节）+ 小端补码大整数
const OPCODES = {
 // ---- 协议 0（文本）----
  0x28: { name: "MARK",            arg: "none",     proto: 0, mark: true },   // (
  0x2e: { name: "STOP",            arg: "none",     proto: 0 },               // .
  0x30: { name: "POP",             arg: "none",     proto: 0 },               // 0
  0x31: { name: "POP_MARK",        arg: "none",     proto: 0, markConsumer: true }, // 1
  0x32: { name: "DUP",             arg: "none",     proto: 0 },               // 2
  0x46: { name: "FLOAT",           arg: "line",     proto: 0 },               // F
  0x49: { name: "INT",             arg: "line",     proto: 0 },               // I
  0x4a: { name: "BININT",          arg: "int4",     proto: 1 },               // J
  0x4b: { name: "BININT1",         arg: "uint1",    proto: 1 },               // K
  0x4c: { name: "LONG",            arg: "line",     proto: 0 },               // L
  0x4d: { name: "BININT2",         arg: "uint2",    proto: 1 },               // M
  0x4e: { name: "NONE",            arg: "none",     proto: 0 },               // N
  0x50: { name: "PERSID",          arg: "line",     proto: 0, danger: "persid" }, // P
  0x51: { name: "BINPERSID",       arg: "none",     proto: 1, danger: "persid" }, // Q
  0x52: { name: "REDUCE",          arg: "none",     proto: 0, danger: "reduce" }, // R
  0x53: { name: "STRING",          arg: "stringnl", proto: 0 },               // S
  0x54: { name: "BINSTRING",       arg: "bytes4",   proto: 1 },               // T
  0x55: { name: "SHORT_BINSTRING", arg: "bytes1",   proto: 1 },               // U
  0x56: { name: "UNICODE",         arg: "stringnl", proto: 0 },               // V
  0x58: { name: "BINUNICODE",      arg: "bytes4",   proto: 1, str: true },    // X
  0x61: { name: "APPEND",          arg: "none",     proto: 0 },               // a
  0x62: { name: "BUILD",           arg: "none",     proto: 0, danger: "build" }, // b
  0x63: { name: "GLOBAL",          arg: "line2",    proto: 0, danger: "global" }, // c
  0x64: { name: "DICT",            arg: "none",     proto: 0, markConsumer: true }, // d
  0x65: { name: "APPENDS",         arg: "none",     proto: 1, markConsumer: true }, // e
  0x67: { name: "GET",             arg: "line",     proto: 0 },               // g
  0x68: { name: "BINGET",          arg: "uint1",    proto: 1 },               // h
  0x69: { name: "INST",            arg: "line2",    proto: 0, danger: "inst", markConsumer: true }, // i
  0x6a: { name: "LONG_BINGET",     arg: "uint4",    proto: 1 },               // j
  0x6c: { name: "LIST",            arg: "none",     proto: 0, markConsumer: true }, // l
  0x6d: { name: "OBJ",             arg: "none",     proto: 0, danger: "obj", markConsumer: true }, // o
  0x70: { name: "PUT",             arg: "line",     proto: 0 },               // p
  0x71: { name: "BINPUT",          arg: "uint1",    proto: 1 },               // q
  0x72: { name: "LONG_BINPUT",     arg: "uint4",    proto: 1 },               // r
  0x73: { name: "SETITEM",         arg: "none",     proto: 0 },               // s
  0x74: { name: "TUPLE",           arg: "none",     proto: 0, markConsumer: true }, // t
  0x75: { name: "SETITEMS",        arg: "none",     proto: 1, markConsumer: true }, // u
  0x47: { name: "BINFLOAT",        arg: "float8",   proto: 1 },               // G
  0x5d: { name: "EMPTY_LIST",      arg: "none",     proto: 1 },               // ]
  0x7d: { name: "EMPTY_DICT",      arg: "none",     proto: 1 },               // }
  0x29: { name: "EMPTY_TUPLE",     arg: "none",     proto: 1 },               // )
 // ---- 协议 2 ----
  0x80: { name: "PROTO",           arg: "uint1",    proto: 2 },
  0x81: { name: "NEWOBJ",          arg: "none",     proto: 2, danger: "newobj" },
  0x82: { name: "EXT1",            arg: "uint1",    proto: 2, danger: "ext" },
  0x83: { name: "EXT2",            arg: "uint2",    proto: 2, danger: "ext" },
  0x84: { name: "EXT4",            arg: "int4",     proto: 2, danger: "ext" },
  0x85: { name: "TUPLE1",          arg: "none",     proto: 2 },
  0x86: { name: "TUPLE2",          arg: "none",     proto: 2 },
  0x87: { name: "TUPLE3",          arg: "none",     proto: 2 },
  0x88: { name: "NEWTRUE",         arg: "none",     proto: 2 },
  0x89: { name: "NEWFALSE",        arg: "none",     proto: 2 },
  0x8a: { name: "LONG1",           arg: "long1",    proto: 2 },
  0x8b: { name: "LONG4",           arg: "long4",    proto: 2 },
 // ---- 协议 3 ----
  0x42: { name: "BINBYTES",        arg: "bytes4",   proto: 3 },               // B
  0x43: { name: "SHORT_BINBYTES",  arg: "bytes1",   proto: 3 },               // C
 // ---- 协议 4 ----
  0x8c: { name: "SHORT_BINUNICODE", arg: "bytes1",  proto: 4, str: true },
  0x8d: { name: "BINUNICODE8",     arg: "bytes8",   proto: 4, str: true },
  0x8e: { name: "BINBYTES8",       arg: "bytes8",   proto: 4 },
  0x8f: { name: "EMPTY_SET",       arg: "none",     proto: 4 },
  0x90: { name: "FROZENSET",       arg: "none",     proto: 4, markConsumer: true },
  0x91: { name: "NEWOBJ_EX",       arg: "none",     proto: 4, danger: "newobj" },
  0x93: { name: "STACK_GLOBAL",    arg: "none",     proto: 4, danger: "stackglobal" },
  0x94: { name: "MEMOIZE",         arg: "none",     proto: 4 },
  0x95: { name: "FRAME",           arg: "uint8",    proto: 4 },
 // ---- 协议 5 ----
  0x96: { name: "BYTEARRAY8",      arg: "bytes8",   proto: 5 },
  0x97: { name: "NEXT_BUFFER",     arg: "none",     proto: 5 },
  0x98: { name: "READONLY_BUFFER", arg: "none",     proto: 5 },
};

// 已知高危 module.name（RCE 常用）——命中额外标注 [!! RCE]
const RCE_NAMES = new Set([
  "os.system", "os.popen", "os.execv", "os.execve", "os.execl", "os.execlp",
  "os.spawnl", "os.spawnv", "posix.system", "nt.system",
  "subprocess.Popen", "subprocess.call", "subprocess.check_output",
  "subprocess.check_call", "subprocess.run", "subprocess.getoutput",
  "builtins.eval", "builtins.exec", "builtins.__import__", "builtins.getattr",
  "builtins.compile", "__builtin__.eval", "__builtin__.exec",
  "__builtin__.__import__", "pty.spawn", "commands.getoutput",
  "platform.popen", "webbrowser.open",
]);

function byteRepr(b) {
 // pickletools 风格：可打印 ASCII 显示字符，否则 \xNN
  if (b >= 0x20 && b < 0x7f) return String.fromCharCode(b);
  return "\\x" + b.toString(16).padStart(2, "0");
}

function readLine(bytes, pos) {
 // 读到 \n（0x0A），返回 {text, next}；text 不含换行
  let i = pos;
  while (i < bytes.length && bytes[i] !== 0x0a) i++;
  const slice = bytes.slice(pos, i);
  let text = "";
  for (const b of slice) text += String.fromCharCode(b);
  if (i >= bytes.length) throw new Error(`readline 越界（缺 \\n 结束符，偏移 ${pos}）`);
  return { text, next: i + 1 };
}

function u(bytes, pos, n) {
  if (pos + n > bytes.length) throw new Error(`读 ${n} 字节越界（偏移 ${pos}）`);
  let v = 0;
  for (let k = 0; k < n; k++) v += bytes[pos + k] * Math.pow(2, 8 * k);
  return v;
}
function uBig(bytes, pos, n) {
  if (pos + n > bytes.length) throw new Error(`读 ${n} 字节越界（偏移 ${pos}）`);
  let v = 0n;
  for (let k = 0; k < n; k++) v += BigInt(bytes[pos + k]) << BigInt(8 * k);
  return v;
}

function decodeLong(bytes, pos, n) {
 // 小端补码大整数（LONG1/LONG4）
  if (n === 0) return { val: 0n, next: pos };
  if (pos + n > bytes.length) throw new Error(`LONG 数据越界（偏移 ${pos}，需 ${n} 字节）`);
  let v = 0n;
  for (let k = 0; k < n; k++) v += BigInt(bytes[pos + k]) << BigInt(8 * k);
 // 最高位为符号位
  if (bytes[pos + n - 1] & 0x80) v -= 1n << BigInt(8 * n);
  return { val: v, next: pos + n };
}

function truncRepr(s, max = 60) {
  const shown = s.length > max ? s.slice(0, max) + "…(共" + s.length + "字节)" : s;
  return JSON.stringify(shown);
}

// ============================================================
// 核心：反汇编
// ============================================================
function disassemble(bytes) {
  const lines = [];
  const dangers = [];       // { pos, name, detail, rce }
  let pos = 0;
  let indent = 0;
  const markStack = [];     // 每个 MARK 的缩进层
  let maxProto = 0;
  let stopSeen = false;
  let opCount = 0;
  const recentStrings = []; // 追踪最近压栈的字符串（供 STACK_GLOBAL 解析 module/name）

  while (pos < bytes.length) {
    const startPos = pos;
    const code = bytes[pos];
    const spec = OPCODES[code];
    if (!spec) {
      lines.push(`${String(startPos).padStart(5)}: ${byteRepr(code).padEnd(4)} <未知 opcode 0x${code.toString(16).padStart(2, "0")}> — 停止解析`);
      break;
    }
    pos++; // 吃掉 opcode 字节
    if (spec.proto > maxProto) maxProto = spec.proto;

 // markConsumer：消费一个 MARK，先降缩进
    if (spec.markConsumer && markStack.length) {
      markStack.pop();
      indent = markStack.length;
    }

 // 读参数
    let argStr = "";
    let pushedString = null;
    try {
      switch (spec.arg) {
        case "none": break;
        case "uint1": { const v = u(bytes, pos, 1); pos += 1; argStr = String(v); break; }
        case "uint2": { const v = u(bytes, pos, 2); pos += 2; argStr = String(v); break; }
        case "uint4": { const v = u(bytes, pos, 4); pos += 4; argStr = String(v); break; }
        case "uint8": { const v = uBig(bytes, pos, 8); pos += 8; argStr = v.toString(); break; }
        case "int4": {
          let v = u(bytes, pos, 4); pos += 4;
          if (v >= 0x80000000) v -= 0x100000000;
          argStr = String(v); break;
        }
        case "float8": {
          if (pos + 8 > bytes.length) throw new Error(`BINFLOAT 越界（偏移 ${pos}）`);
          const dv = new DataView(bytes.buffer, bytes.byteOffset + pos, 8);
          argStr = String(dv.getFloat64(0, false)); // 大端
          pos += 8; break;
        }
        case "line": {
          const r = readLine(bytes, pos); pos = r.next;
          let t = r.text;
          if (t === "01") t = "01 (True)";
          else if (t === "00") t = "00 (False)";
          argStr = t; break;
        }
        case "stringnl": {
          const r = readLine(bytes, pos); pos = r.next;
          argStr = r.text; pushedString = r.text.replace(/^['"]|['"]$/g, ""); break;
        }
        case "line2": {
          const r1 = readLine(bytes, pos); const r2 = readLine(bytes, r1.next); pos = r2.next;
          argStr = `${r1.text} ${r2.text}`;
          spec._mod = r1.text; spec._nm = r2.text; break;
        }
        case "bytes1":
        case "bytes4":
        case "bytes8": {
          const nlen = spec.arg === "bytes1" ? 1 : spec.arg === "bytes4" ? 4 : 8;
          const len = spec.arg === "bytes8" ? Number(uBig(bytes, pos, 8)) : u(bytes, pos, nlen);
          pos += nlen;
          if (pos + len > bytes.length) throw new Error(`${spec.name} 数据越界（需 ${len} 字节，偏移 ${pos}）`);
          const data = bytes.slice(pos, pos + len); pos += len;
          let s = "";
          if (spec.str) { s = new TextDecoder("utf-8", { fatal: false }).decode(data); pushedString = s; }
          else { for (const b of data) s += String.fromCharCode(b); pushedString = s; }
          argStr = truncRepr(s); break;
        }
        case "long1":
        case "long4": {
          const nlen = spec.arg === "long1" ? 1 : 4;
          const len = u(bytes, pos, nlen); pos += nlen;
          const d = decodeLong(bytes, pos, len); pos = d.next;
          argStr = d.val.toString() + "L"; break;
        }
        default: throw new Error(`未实现的参数类型 ${spec.arg}`);
      }
    } catch (e) {
      lines.push(`${String(startPos).padStart(5)}: ${byteRepr(code).padEnd(4)} ${" ".repeat(indent * 2)}${spec.name} — 参数解析出错: ${e.message}`);
      break;
    }

 // 输出行
    const indentSp = "  ".repeat(indent);
    lines.push(`${String(startPos).padStart(5)}: ${byteRepr(code).padEnd(4)} ${indentSp}${spec.name.padEnd(16)}${argStr}`);

 // MARK：压栈，缩进 +1
    if (spec.mark) { markStack.push(indent); indent = markStack.length; }

 // 记录压栈字符串（供 STACK_GLOBAL）
    if (pushedString != null) { recentStrings.push(pushedString); if (recentStrings.length > 8) recentStrings.shift(); }

 // 危险 opcode 收集
    if (spec.danger) {
      let name = "", rce = false, detail = "";
      if (spec.danger === "global") {
        name = `${spec._mod}.${spec._nm}`;
        rce = RCE_NAMES.has(name);
        detail = `GLOBAL 引用 ${name}${rce ? "" : "（导入可调用对象）"}`;
      } else if (spec.danger === "stackglobal") {
 // module/name 在栈上，取最近两个压栈字符串
        const n2 = recentStrings.length;
        const mod = n2 >= 2 ? recentStrings[n2 - 2] : "?";
        const nm = n2 >= 1 ? recentStrings[n2 - 1] : "?";
        name = `${mod}.${nm}`;
        rce = RCE_NAMES.has(name);
        detail = `STACK_GLOBAL 引用 ${name}（module/name 取自栈顶两串）`;
      } else if (spec.danger === "reduce") {
        detail = "REDUCE：调用栈上可调用对象(argtuple) — pickle RCE 的核心触发点";
      } else if (spec.danger === "build") {
        detail = "BUILD：调用 __setstate__ 或更新 __dict__";
      } else if (spec.danger === "inst") {
        name = `${spec._mod}.${spec._nm}`;
        rce = RCE_NAMES.has(name);
        detail = `INST：实例化 ${name}（旧式类实例构造 + 调用）`;
      } else if (spec.danger === "obj") {
        detail = "OBJ：由栈上类与参数构造实例";
      } else if (spec.danger === "newobj") {
        detail = `${spec.name}：cls.__new__(cls, *args) 构造对象`;
      } else if (spec.danger === "ext") {
        detail = `${spec.name}：从扩展注册表取对象（copyreg 扩展码）`;
      } else if (spec.danger === "persid") {
        detail = `${spec.name}：持久化 ID 解析（persistent_load）`;
      }
      dangers.push({ pos: startPos, op: spec.name, detail, rce });
    }

    if (spec.name === "STOP") { stopSeen = true; break; }
    opCount++;
    if (opCount > 500000) { lines.push("… opcode 数量超过 50 万，已截断"); break; }
  }

  return { lines, dangers, maxProto, stopSeen, consumed: pos, total: bytes.length };
}

// ============================================================
// run
// ============================================================
function pickleDisasmRun(text, p) {
  const enc = (p && p.inputEnc) || "auto";
  if (!String(text).trim() && !(p && p.rawBytes && p.rawBytes.length)) return "（空输入）请粘贴 pickle 字节的 hex 或 base64。";
  let bytes;
  try {
    bytes = (p && p.rawBytes && p.rawBytes.length)
      ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
      : inputToBytes(text, enc === "auto" ? "auto" : enc);
  }
  catch (e) { return "输入解析失败: " + e.message; }
  if (bytes.length === 0) return "（解析出 0 字节）";

  const r = disassemble(bytes);
  const out = [];

 // 头部概览
  out.push(`# Pickle 反汇编（pickletools.dis 风格）`);
  out.push(`字节数: ${r.total}  已解析: ${r.consumed}  最高协议: ${r.maxProto}  STOP: ${r.stopSeen ? "有(.)" : "缺失"}`);
  out.push("");

 // 危险提示区（置顶醒目）
  if (r.dangers.length) {
    const hasRce = r.dangers.some((d) => d.rce);
    out.push(`⚠ 危险操作 ${r.dangers.length} 处${hasRce ? "  【检出已知 RCE 符号】" : ""}:`);
    for (const d of r.dangers) {
      out.push(`  @${d.pos} ${d.op}${d.rce ? " [!! RCE]" : ""} — ${d.detail}`);
    }
    out.push(`  说明: 反序列化此 pickle 会执行上述操作，切勿用 pickle.load 加载不可信数据。`);
    out.push("");
  } else {
    out.push("✓ 未检出危险 opcode（无 GLOBAL/REDUCE/INST/OBJ/NEWOBJ/BUILD/EXT）。");
    out.push("");
  }

 // 反汇编正文
  out.push("--- 反汇编 ---");
  out.push(...r.lines);
  if (!r.stopSeen) out.push("(注意: 未遇到 STOP '.'，pickle 可能被截断或非标准)");

  return out.join("\n");
}

// ============================================================
// detect（供一键解码）：pickle 常以 \x80<proto> 开头，或以 . STOP 结尾
// ============================================================
function pickleDetect(t) {
  const s = String(t).trim().replace(/\s/g, "");
  let bytes;
  try {
    if (isHex(s)) bytes = hexToBytes(s);
    else if (isB64(s)) bytes = b64ToBytes(s);
    else return 0; // 原始字节形态难以稳妥判定，避免误报
  } catch { return 0; }
  if (bytes.length < 2) return 0;
 // 协议 2+：\x80 后跟合法协议号 0-5
  if (bytes[0] === 0x80 && bytes[1] <= 5) {
 // 末尾 STOP 加分
    return bytes[bytes.length - 1] === 0x2e ? 0.85 : 0.7;
  }
 // 协议 0/1：以 . 结尾，且首字节是常见起始 opcode 之一
  const startOps = new Set([0x28, 0x63, 0x5d, 0x7d, 0x29, 0x49, 0x4e]); // ( c ] } ) I N
  if (bytes[bytes.length - 1] === 0x2e && startOps.has(bytes[0])) return 0.45;
  return 0;
}

// ============================================================
// 注册
// ============================================================
register({
  id: "pickleDisasm", cat: "data", name: "Pickle 反汇编",
  desc: "Python pickle 字节码反汇编（协议 0-5，pickletools.dis 风格），高亮 GLOBAL/REDUCE 等危险 opcode 与 os.system 等 RCE 符号",
  params: [
    { key: "inputEnc", label: "输入编码", type: "select", default: "auto", options: [
      { value: "auto", label: "自动（hex/base64/原始字节）" },
      { value: "hex", label: "Hex" },
      { value: "base64", label: "Base64" },
    ] },
  ],
  run: pickleDisasmRun,
  detect: pickleDetect,
  acceptsBytes: true,
});

export { pickleDisasmRun, pickleDetect, disassemble, inputToBytes, OPCODES };
