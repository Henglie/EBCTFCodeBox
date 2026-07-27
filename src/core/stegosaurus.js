/*
 * stegosaurus.js — Stegosaurus 式 .pyc 字节码隐写检测（forensic，run 单向分析）。
 *
 * 背景：Stegosaurus（github: AngelKitty/stegosaurus 等）把 payload 藏进已编译的
 * Python 字节码（.pyc）。CPython 的 code object 里存在"语义中立"的空间——最典型的
 * 是 co_lnotab（行号增量表，Python <3.10）：正常情况下它是一串 (字节偏移增量, 行号
 * 增量) 对，用来把字节码地址映射回源码行。工具在保持程序行为不变的前提下，往这些
 * 增量对的低位 bit 里嵌信息，或直接把 flag 塞进常量池字符串。
 *
 * 本 op 做什么（纯静态、尽力而为解析，绝不执行 pyc）：
 * 1. 解析 pyc 头：magic(4) → Python 版本（magic→version 表，覆盖 2.x / 3.0-3.13）。
 * 头格式随版本变化：
 * - 3.7+：magic(4) + bitfield(4) + [timestamp|hash](4) + [size|hash](4) → 16 字节
 * - 3.3-3.6：magic(4) + timestamp(4) + source_size(4) → 12 字节
 * - 3.0-3.2 / 2.x：magic(4) + timestamp(4) → 8 字节
 * 2. 从 marshal blob（头之后）递归解析 code object 树：解出 co_consts 字符串常量
 * co_names、co_code、co_lnotab / co_linetable（尽力而为，marshal 类型繁多
 * 解不全整棵树没关系，report 里标注限制）。
 * 3. 隐写检测：
 * ① 扫描 marshal 里的可打印字符串常量（flag 常直接藏这里）+ 全 blob 的 strings
 * 兜底扫描（4+ 连续可打印），命中 flag{}/ctf{} 等正则高亮。
 * ② 检测 co_lnotab 行号表异常（异常大的增量 / 不合理跳变 = 嵌入痕迹）。
 * ③ 抽取 lnotab 低位 bit 流拼 ASCII（LSB-first / MSB-first 两种字节序）。
 * 4. 报告：Python 版本、code object 数量、字符串常量、lnotab 异常点、bit 提取结果。
 *
 * 红线：
 * - 算法层零 UI 依赖（仅 import registry）。
 * - 零外发：纯本地计算。
 * - 件内自注册（文件末尾 register(op)）。
 * - 报告无 emoji，用黑白几何符号（● ✓ ← ▸ × ✗ ⚠）。
 *
 * 契约：register({id:'stegosaurus', cat:'forensic', name, desc, params, run})。
 * run(text, p) → 报告文本。输入为 .pyc 的 hex / base64（parseInput 自动判别）。
 *
 * 参考（真实来源，非编造）：
 * - CPython Lib/importlib/_bootstrap_external.py 的 MAGIC_NUMBER 历史值。
 * - CPython Python/marshal.c 的 TYPE_* 类型码与序列化格式。
 * - CPython Objects/codeobject.c / Python/marshal.c w_object 的 code object 字段顺序。
 * - Stegosaurus 项目对 .pyc 字节码隐写载体的说明。
 */
import { register } from "./registry.js";

// ============================================================
// 输入解析（hex / base64 自动判别 → Uint8Array）。自备，不 import。
// ============================================================
function hexToBytes(s) {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("hex 长度需为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function base64ToBytes(s) {
  let str = s.replace(/\s/g, "");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parseInput(text, inputEnc) {
  const s = String(text || "").trim();
  if (!s) return new Uint8Array(0);
  if (inputEnc === "hex") return hexToBytes(s);
  if (inputEnc === "base64") return base64ToBytes(s);
 // auto：偶数长度且全 hex 字符 → hex，否则 base64
  const stripped = s.replace(/\s/g, "");
  if (/^[0-9a-fA-F]+$/.test(stripped) && stripped.length % 2 === 0) return hexToBytes(s);
  return base64ToBytes(s);
}

// ============================================================
// magic → Python 版本表
// pyc 头 4 字节 = <低 2 字节 magic 整数(LE)> + 0x0D 0x0A。
// 这里以低 2 字节整数为 key。取"已知 magic 中不大于读到值的最大者"做近似匹配
// 容忍同一大版本内的小 bump（如 3.5.0=3350 / 3.5.3=3351）。
// 数值来源：CPython _bootstrap_external.py MAGIC_NUMBER 历史（最终发布值）。
// ============================================================
const MAGIC_TABLE = [
  { m: 50823, v: "2.0" },
  { m: 60202, v: "2.1" },
  { m: 60717, v: "2.2" },
  { m: 62011, v: "2.3" },
  { m: 62061, v: "2.4" },
  { m: 62131, v: "2.5" },
  { m: 62161, v: "2.6" },
  { m: 62211, v: "2.7" },
  { m: 3111,  v: "3.0" },
  { m: 3151,  v: "3.1" },
  { m: 3180,  v: "3.2" },
  { m: 3230,  v: "3.3" },
  { m: 3310,  v: "3.4" },
  { m: 3350,  v: "3.5" },
  { m: 3379,  v: "3.6" },
  { m: 3394,  v: "3.7" },
  { m: 3413,  v: "3.8" },
  { m: 3425,  v: "3.9" },
  { m: 3439,  v: "3.10" },
  { m: 3495,  v: "3.11" },
  { m: 3531,  v: "3.12" },
  { m: 3571,  v: "3.13" },
];

function lookupVersion(magicInt) {
 // 精确优先，否则取不大于该值的最大已知 magic
  let best = null;
  for (const e of MAGIC_TABLE) {
    if (e.m === magicInt) return { v: e.v, exact: true };
    if (e.m <= magicInt && (!best || e.m > best.m)) best = e;
  }
  if (best) return { v: best.v + "?", exact: false };
  return { v: "未知", exact: false };
}

// 版本号 → 数值（用于层级判断），"3.11" → 3.11，"2.7" → 2.07 之类不便比较
// 故拆成 [major, minor] 返回。
function verNums(v) {
  const m = /(\d+)\.(\d+)/.exec(v);
  if (!m) return { major: 0, minor: 0 };
  return { major: +m[1], minor: +m[2] };
}

// ============================================================
// 字节读取器（小端）
// ============================================================
function u16le(b, i) { return (b[i] | (b[i + 1] << 8)) >>> 0; }
function u32le(b, i) { return ((b[i]) | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] * 0x1000000)) >>> 0; }

// ============================================================
// pyc 头解析 → { version, verInfo, headerLen, bitfield, timestamp, size, magicInt, magicHex, hashBased }
// ============================================================
function parseHeader(bytes) {
  if (bytes.length < 4) throw new Error("数据不足 4 字节，无法读 magic");
  const magicInt = u16le(bytes, 0);
  const b2 = bytes[2], b3 = bytes[3];
  const magicHex = [...bytes.slice(0, 4)].map((x) => x.toString(16).padStart(2, "0")).join(" ");
  const crlfOk = b2 === 0x0d && b3 === 0x0a;
  const found = lookupVersion(magicInt);
  const vn = verNums(found.v);
  const isPy3 = vn.major >= 3;

  let headerLen, bitfield = null, timestamp = null, size = null, hashBased = false;
  if (isPy3 && (vn.major > 3 || vn.minor >= 7)) {
 // 3.7+：16 字节头
    headerLen = 16;
    if (bytes.length >= 8) bitfield = u32le(bytes, 4);
    hashBased = bitfield != null && (bitfield & 0x1) === 1;
    if (bytes.length >= 12) timestamp = u32le(bytes, 8);   // hash 型时这 8 字节是 hash
    if (bytes.length >= 16) size = u32le(bytes, 12);
  } else if (isPy3 && vn.minor >= 3) {
 // 3.3-3.6：12 字节头（magic + timestamp + source_size）
    headerLen = 12;
    if (bytes.length >= 8) timestamp = u32le(bytes, 4);
    if (bytes.length >= 12) size = u32le(bytes, 8);
  } else {
 // 3.0-3.2 / 2.x：8 字节头（magic + timestamp）
    headerLen = 8;
    if (bytes.length >= 8) timestamp = u32le(bytes, 4);
  }
  return {
    version: found.v, exact: found.exact, verInfo: vn, isPy3,
    headerLen, bitfield, timestamp, size, hashBased,
    magicInt, magicHex, crlfOk,
  };
}

// ============================================================
// marshal 解析器（尽力而为，参考 CPython Python/marshal.c）
// 类型码（& 0x7f 后取字符；最高位 0x80 = FLAG_REF，对象入 refs 表供 TYPE_REF 复用）：
// '0' NULL 'N' None 'F' False 'T' True 'S' StopIter '.' Ellipsis
// 'i' int4 'I' int64 'f' float(str) 'g' binary float 'x'/'y' complex
// 'l' long(变长) 's' string(4字节长+数据) 't' interned string
// 'a' ascii 'A' ascii interned 'z' short ascii 'Z' short ascii interned
// 'u' unicode 'r' ref(4字节索引)
// '(' tuple ')' small tuple(1字节n) '[' list '{' dict '<' set '>' frozenset
// 'c' code object
// ============================================================
const FLAG_REF = 0x80;

function makeMarshalReader(data, layout, sink) {
  let pos = 0;
  const refs = [];
  let nodeCount = 0;
  const MAX_NODES = 200000;

  function eof() { return pos >= data.length; }
  function need(n) { if (pos + n > data.length) throw new Error("marshal 数据越界"); }
  function rU8() { need(1); return data[pos++]; }
  function rU32() { need(4); const v = u32le(data, pos); pos += 4; return v; }
  function rI32() { let v = rU32(); if (v >= 0x80000000) v -= 0x100000000; return v; }

  function readBytes(n) {
    need(n);
    const sub = data.subarray(pos, pos + n);
    pos += n;
    return sub;
  }

  function decodeUtf8(sub) {
    try { return new TextDecoder("utf-8", { fatal: false }).decode(sub); }
    catch { let s = ""; for (const b of sub) s += String.fromCharCode(b); return s; }
  }

  function mkStr(kind, sub) {
    const text = decodeUtf8(sub);
    const obj = { __str: true, kind, bytes: sub, text };
    sink.strings.push(obj);
    return obj;
  }

 // 读取一个 marshal 对象。depth 防爆栈。
  function readObject(depth) {
    if (++nodeCount > MAX_NODES) throw new Error("marshal 节点数超限（可能格式异常）");
    if (depth > 200) throw new Error("marshal 嵌套过深");
    if (eof()) throw new Error("marshal 提前结束");
    const raw = rU8();
    const flag = raw & FLAG_REF;
    const t = String.fromCharCode(raw & 0x7f);
    let refSlot = -1;
    if (flag) { refSlot = refs.length; refs.push(undefined); }
    const val = readByType(t, depth);
    if (flag && refSlot >= 0) refs[refSlot] = val;
    return val;
  }

  function readByType(t, depth) {
    switch (t) {
      case "0": case "N": case "F": case "T": case "S": case ".":
        return null;
      case "i": return rI32();
      case "I": { need(8); const lo = rU32(); const hi = rU32(); return hi * 0x100000000 + lo; }
      case "f": { const n = rU8(); return decodeUtf8(readBytes(n)); }   // float 的 ascii 表示
      case "g": { need(8); const dv = new DataView(data.buffer, data.byteOffset + pos, 8); const v = dv.getFloat64(0, true); pos += 8; return v; }
      case "x": { const n1 = rU8(); readBytes(n1); const n2 = rU8(); readBytes(n2); return null; } // complex(str)
      case "y": { need(16); pos += 16; return null; }                    // binary complex
      case "l": {                                                        // 变长 long：i4 个 digit 计数 + |n|*2 字节
        const n = rI32();
        const digits = Math.abs(n);
        readBytes(digits * 2);
        return null;
      }
      case "s": case "t": {                                              // string / interned（4 字节长）
        const n = rU32();
        return mkStr(t === "t" ? "interned" : "string", readBytes(n));
      }
      case "a": case "A": {                                              // ascii / ascii interned（4 字节长）
        const n = rU32();
        return mkStr("ascii", readBytes(n));
      }
      case "z": case "Z": {                                              // short ascii（1 字节长）
        const n = rU8();
        return mkStr("short_ascii", readBytes(n));
      }
      case "u": {                                                        // unicode（4 字节长）
        const n = rU32();
        return mkStr("unicode", readBytes(n));
      }
      case "r": { const idx = rU32(); return refs[idx] !== undefined ? refs[idx] : null; } // ref
      case "(": { const n = rU32(); return readSeq(n, depth); }          // tuple
      case ")": { const n = rU8(); return readSeq(n, depth); }           // small tuple
      case "[": { const n = rU32(); return readSeq(n, depth); }          // list
      case "<": case ">": { const n = rU32(); return readSeq(n, depth); } // set / frozenset
      case "{": {                                                        // dict：读到 NULL 键为止
        const out = [];
        for (;;) {
          if (eof()) break;
          const save = pos;
          const kb = data[pos];
          if ((kb & 0x7f) === 0x30) { pos = save + 1; break; } // '0' == NULL 结束标记
          const k = readObject(depth + 1);
          const v = readObject(depth + 1);
          out.push([k, v]);
        }
        return out;
      }
      case "c": return readCode(depth);                                  // code object
      default:
        throw new Error("未知 marshal 类型码 0x" + (t.charCodeAt(0)).toString(16) + " ('" + t + "') @偏移 " + (pos - 1));
    }
  }

  function readSeq(n, depth) {
    const arr = [];
    for (let i = 0; i < n; i++) arr.push(readObject(depth + 1));
    return arr;
  }

 // code object 字段顺序按版本 layout 变化（见 marshal.c w_object TYPE_CODE 分支）。
 // '27' : Python 2.x
 // '30' : Python 3.0-3.7（有 kwonly，无 posonly）
 // '38' : Python 3.8-3.10（+ posonlyargcount）
 // '311': Python 3.11+（无 nlocals，+ qualname，lnotab→linetable + exceptiontable）
  function readCode(depth) {
    const co = { __code: true, name: "", firstlineno: 0, codeBytes: null, lnotab: null, linetable: null, consts: null, names: null };
    co.argcount = rI32();
    if (layout === "38" || layout === "311") co.posonly = rI32();
    if (layout !== "27") co.kwonly = rI32();
    if (layout !== "311") co.nlocals = rI32();
    co.stacksize = rI32();
    co.flags = rI32();
    const codeObj = readObject(depth + 1);
    co.codeBytes = (codeObj && codeObj.__str) ? codeObj.bytes : null;
    co.consts = readObject(depth + 1);
    co.names = readObject(depth + 1);
    if (layout === "311") {
      readObject(depth + 1); // localsplusnames
      readObject(depth + 1); // localspluskinds
    } else {
      readObject(depth + 1); // varnames
      readObject(depth + 1); // freevars
      readObject(depth + 1); // cellvars
    }
    const fn = readObject(depth + 1);   // filename
    co.filename = fn && fn.__str ? fn.text : "";
    const nm = readObject(depth + 1);   // name
    co.name = nm && nm.__str ? nm.text : "";
    if (layout === "311") readObject(depth + 1); // qualname
    co.firstlineno = rI32();
    if (layout === "311") {
      const lt = readObject(depth + 1); // linetable（PEP 626，非 lnotab）
      co.linetable = lt && lt.__str ? lt.bytes : null;
      readObject(depth + 1);            // exceptiontable
    } else {
      const ln = readObject(depth + 1); // lnotab
      co.lnotab = ln && ln.__str ? ln.bytes : null;
    }
    sink.codes.push(co);
    return co;
  }

  return {
    parse() {
      const root = readObject(0);
      return { root, consumed: pos, refs: refs.length };
    },
    get pos() { return pos; },
  };
}

// version → layout 标签
function layoutFor(verInfo) {
  if (verInfo.major < 3) return "27";
  if (verInfo.major === 3 && verInfo.minor >= 11) return "311";
  if (verInfo.major > 3) return "311";
  if (verInfo.major === 3 && verInfo.minor >= 8) return "38";
  return "30";
}

// ============================================================
// lnotab 分析（Python <3.10 行号增量表）
// 格式：连续 (addr_incr, line_incr) 字节对。addr_incr 无符号；line_incr 在 3.6+
// 视为有符号字节（可负，表示行号回退，用于优化后的字节码）。
// 隐写检测：
// · 异常：addr_incr==0 出现在中段、|line_incr| 异常大、line_incr 跳变离谱。
// · bit 抽取：取每个字节 LSB 拼成 bit 流 → ASCII（LSB-first / MSB-first）。
// ============================================================
function analyzeLnotab(bytes, bitOrder) {
  const pairs = [];
  const anomalies = [];
  const n = bytes.length;
  if (n % 2 !== 0) anomalies.push("● 长度为奇数 (" + n + ")：正常 lnotab 为偶数字节（成对），可能被篡改或非标准");
  for (let i = 0; i + 1 < n; i += 2) {
    const addr = bytes[i];
    let line = bytes[i + 1];
    const lineSigned = line >= 0x80 ? line - 256 : line;
    pairs.push({ idx: i / 2, addr, line, lineSigned });
  }
 // 异常启发式
  for (let k = 0; k < pairs.length; k++) {
    const p = pairs[k];
    if (p.addr === 0 && k !== 0 && k !== pairs.length - 1) {
      anomalies.push("▸ 对#" + p.idx + " addr_incr=0（中段零偏移增量，异常，正常仅用于跨多行时的 line-only 记录）");
    }
    if (Math.abs(p.lineSigned) >= 200) {
      anomalies.push("▸ 对#" + p.idx + " line_incr=" + p.lineSigned + "（行号增量异常大，疑似嵌入痕迹）");
    }
  }
 // bit 抽取
  const bits = [];
  for (let i = 0; i < n; i++) bits.push(bytes[i] & 1);
  const ascii = bitsToAscii(bits, bitOrder);
 // 另取 line_incr 字节（奇数位）的 LSB 单独拼
  const lineBits = [];
  for (let i = 1; i < n; i += 2) lineBits.push(bytes[i] & 1);
  const lineAscii = bitsToAscii(lineBits, bitOrder);
  const addrBits = [];
  for (let i = 0; i < n; i += 2) addrBits.push(bytes[i] & 1);
  const addrAscii = bitsToAscii(addrBits, bitOrder);
  return { pairs, anomalies, asciiAll: ascii, asciiLine: lineAscii, asciiAddr: addrAscii, bitCount: bits.length };
}

function bitsToAscii(bits, bitOrder) {
  let out = "";
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      const bit = bits[i + j];
      if (bitOrder === "msb") byte = (byte << 1) | bit;
      else byte |= bit << j;
    }
    out += (byte >= 0x20 && byte <= 0x7e) ? String.fromCharCode(byte) : "·";
  }
  return out;
}

// ============================================================
// 全 blob strings 兜底扫描（4+ 连续可打印 ASCII），供解析失败时仍能捞出 flag
// ============================================================
function stringsScan(bytes, minLen) {
  const out = [];
  let cur = [];
  for (let i = 0; i <= bytes.length; i++) {
    const b = i < bytes.length ? bytes[i] : -1;
    if (b >= 0x20 && b <= 0x7e) {
      cur.push(b);
    } else {
      if (cur.length >= minLen) {
        let s = ""; for (const c of cur) s += String.fromCharCode(c);
        out.push(s);
      }
      cur = [];
    }
  }
  return out;
}

// flag 正则：flag{}/ctf{}/key{}/pass{} 等常见格式 + 通用 word{...}
const FLAG_RE = /(?:flag|ctf|key|pass|secret)\s*\{[^}\n]{0,200}\}/gi;
const GENERIC_BRACE_RE = /[A-Za-z][A-Za-z0-9_]{1,20}\{[^}\n]{1,200}\}/g;

function findFlags(text) {
  const hits = new Set();
  let m;
  FLAG_RE.lastIndex = 0;
  while ((m = FLAG_RE.exec(text)) !== null) hits.add(m[0]);
  GENERIC_BRACE_RE.lastIndex = 0;
  while ((m = GENERIC_BRACE_RE.exec(text)) !== null) {
    if (/flag|ctf|key|pass|secret/i.test(m[0])) hits.add(m[0]);
  }
  return [...hits];
}

// ============================================================
// run：主入口
// ============================================================
function stegosaurusRun(text, p) {
  const inputEnc = (p && p.inputEnc) || "auto";
  const bitOrder = (p && p.bitOrder) || "lsb";
  const minStr = Math.max(3, Math.min(64, parseInt((p && p.minStrLen) || "4", 10) || 4));

  const L = [];
  L.push("=== Stegosaurus pyc 隐写检测 ===");
  L.push("");

  let bytes;
  try {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：真字节优先，跳过 hex/base64 文本解析。
    bytes = (p && p.rawBytes && p.rawBytes.length)
      ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
      : parseInput(text, inputEnc);
  } catch (e) {
    L.push("✗ 输入解析失败: " + (e.message || String(e)));
    L.push("  提示：请粘贴 .pyc 文件的 hex 或 base64。");
    return L.join("\n");
  }
  if (bytes.length === 0) return L.push("（空输入）请粘贴 .pyc 文件的 hex 或 base64。"), L.join("\n");

 // ---- 1. pyc 头 ----
  let hdr;
  try {
    hdr = parseHeader(bytes);
  } catch (e) {
    L.push("✗ pyc 头解析失败: " + (e.message || String(e)));
    return L.join("\n");
  }

  L.push("--- pyc 头 ---");
  L.push("  magic 字节:  " + hdr.magicHex + (hdr.crlfOk ? "  ✓ (\\r\\n 结尾正常)" : "  ⚠ (第 3-4 字节非 0d 0a，可能非 pyc)"));
  L.push("  magic 整数:  " + hdr.magicInt);
  L.push("  Python 版本: " + hdr.version + (hdr.exact ? "  ✓ 精确匹配" : "  (近似：取不大于该 magic 的最近已知版本)"));
  L.push("  头长度:      " + hdr.headerLen + " 字节");
  if (hdr.bitfield != null) {
    L.push("  bit field:   0x" + hdr.bitfield.toString(16).padStart(8, "0") + (hdr.hashBased ? "  ● hash 型 pyc（bit0=1）" : "  ● timestamp 型 pyc（bit0=0）"));
  }
  if (hdr.timestamp != null && !hdr.hashBased) {
    L.push("  timestamp:   " + hdr.timestamp + "  (" + safeDate(hdr.timestamp) + ")");
  }
  if (hdr.size != null && !hdr.hashBased) L.push("  source size: " + hdr.size + " 字节");
  L.push("");

 // ---- 2. marshal 解析 ----
  const marshalStart = Math.min(hdr.headerLen, bytes.length);
  const blob = bytes.subarray(marshalStart);
  const layout = layoutFor(hdr.verInfo);
  const sink = { strings: [], codes: [] };
  let parseErr = null, consumed = 0;
  try {
    const rd = makeMarshalReader(blob, layout, sink);
    const r = rd.parse();
    consumed = r.consumed;
  } catch (e) {
    parseErr = e.message || String(e);
  }

  L.push("--- marshal 解析（layout=" + layout + "，起始偏移=" + marshalStart + "） ---");
  L.push("  code object 数: " + sink.codes.length);
  L.push("  已解析字节:     " + consumed + " / " + blob.length + (consumed >= blob.length ? "  ✓ 全解析" : ""));
  if (parseErr) {
    L.push("  ⚠ 解析中断: " + parseErr);
    L.push("    (marshal 格式复杂，部分中断属正常；下方结果为已解出的部分 + 全 blob 兜底扫描)");
  }
  L.push("");

 // ---- 2b. code object 概览 ----
  if (sink.codes.length) {
    L.push("--- code objects ---");
    let shown = 0;
    for (const co of sink.codes) {
      if (shown++ >= 30) { L.push("  … 其余 " + (sink.codes.length - 30) + " 个省略"); break; }
      const lnLen = co.lnotab ? co.lnotab.length : (co.linetable ? co.linetable.length : 0);
      const tbl = co.linetable ? "linetable" : "lnotab";
      L.push("  ● <" + (co.name || "?") + ">  firstlineno=" + co.firstlineno +
        "  stacksize=" + co.stacksize + "  " + tbl + "=" + lnLen + "B" +
        "  code=" + (co.codeBytes ? co.codeBytes.length : 0) + "B" +
        (co.filename ? "  file=" + co.filename : ""));
    }
    L.push("");
  }

 // ---- 3① 字符串常量 + flag 检测 ----
 // 结构化解出的字符串
  const printableStrings = [];
  for (const s of sink.strings) {
    const t = s.text || "";
    if (t.length >= minStr && isMostlyPrintable(t)) printableStrings.push({ kind: s.kind, text: t });
  }
 // 全 blob 兜底
  const rawStrings = stringsScan(blob, minStr);

  L.push("--- ① 字符串常量（结构化解出） ---");
  if (printableStrings.length) {
    let shown = 0;
    for (const s of printableStrings) {
      if (shown++ >= 60) { L.push("  … 其余 " + (printableStrings.length - 60) + " 条省略"); break; }
      L.push("  [" + s.kind + "] " + truncate(s.text, 160));
    }
  } else {
    L.push("  (未解出可打印字符串常量)");
  }
  L.push("");

 // flag 命中（合并结构化 + 兜底）
  const flagSources = printableStrings.map((s) => s.text).concat(rawStrings);
  const flagHits = new Set();
  for (const src of flagSources) for (const f of findFlags(src)) flagHits.add(f);
  L.push("--- flag 命中 ---");
  if (flagHits.size) {
    for (const f of flagHits) L.push("  ✓✓ " + f);
  } else {
    L.push("  × 未命中 flag{}/ctf{} 等格式（可尝试下方 lnotab bit 提取，或调低 minStrLen）");
  }
  L.push("");

 // ---- 3② + ③ lnotab 异常 + bit 提取 ----
  L.push("--- ②③ lnotab 行号表分析 + bit 提取（字节序=" + (bitOrder === "msb" ? "MSB-first" : "LSB-first") + "） ---");
  const withLnotab = sink.codes.filter((c) => c.lnotab && c.lnotab.length);
  const withLinetable = sink.codes.filter((c) => c.linetable && c.linetable.length);
  if (!withLnotab.length && withLinetable.length) {
    L.push("  ⚠ 该版本 (Python 3.11+) 使用 co_linetable (PEP 626) 取代 co_lnotab，格式不同。");
    L.push("    Stegosaurus 经典 lnotab 载体不适用；下面对 linetable 做同样的 LSB bit 提取试探（可能无意义）。");
    L.push("");
    for (const co of withLinetable.slice(0, 10)) {
      const res = analyzeLnotab(co.linetable, bitOrder);
      L.push("  ● <" + (co.name || "?") + "> linetable=" + co.linetable.length + "B");
      dumpBitExtract(L, res);
    }
  } else if (withLnotab.length) {
    let shown = 0;
    const allAscii = [];
    for (const co of withLnotab) {
      if (shown++ >= 15) { L.push("  … 其余 " + (withLnotab.length - 15) + " 个 lnotab 省略"); break; }
      const res = analyzeLnotab(co.lnotab, bitOrder);
      L.push("  ● <" + (co.name || "?") + "> lnotab=" + co.lnotab.length + "B，共 " + res.pairs.length + " 对");
      if (res.anomalies.length) {
        L.push("    异常点:");
        for (const a of res.anomalies.slice(0, 20)) L.push("      " + a);
      } else {
        L.push("    ✓ 未见明显异常（增量对分布正常）");
      }
      dumpBitExtract(L, res);
      allAscii.push(res.asciiAll);
    }
 // 拼接所有 lnotab 的全 LSB 流找 flag
    const joined = allAscii.join("").replace(/·+/g, "");
    const bitFlags = findFlags(joined);
    if (bitFlags.length) {
      L.push("");
      L.push("  ✓✓ 从 lnotab LSB 流拼出疑似 flag:");
      for (const f of bitFlags) L.push("      " + f);
    }
  } else {
    L.push("  (无 code object 携带 lnotab / linetable，可能解析未触达或该 pyc 无行号表)");
  }
  L.push("");

 // ---- 4. 兜底 strings（可能含被拆散的 flag 片段） ----
  L.push("--- 全 blob strings 兜底（" + minStr + "+ 连续可打印） ---");
  if (rawStrings.length) {
    const uniq = [...new Set(rawStrings)];
    let shown = 0;
    for (const s of uniq) {
      if (shown++ >= 40) { L.push("  … 其余 " + (uniq.length - 40) + " 条省略"); break; }
      L.push("  " + truncate(s, 160));
    }
  } else {
    L.push("  (无)");
  }
  L.push("");

  L.push("说明:");
  L.push("  · 本工具纯静态解析，绝不执行 pyc。marshal 格式繁多，解析尽力而为，中断不影响已解出部分。");
  L.push("  · ① 常量字符串是藏 flag 最常见处；② lnotab 异常增量 = 嵌入痕迹；③ LSB bit 流是 Stegosaurus 式载体。");
  L.push("  · Python 3.10+ 行号表改为 co_linetable，经典 lnotab 隐写不适用，本工具已标注。");
  L.push("  · 若 flag 未命中：调低 minStrLen、切换 bit 字节序 (LSB/MSB)、或检查 magic 是否被篡改。");
  return L.join("\n");
}

function dumpBitExtract(L, res) {
  const showAll = res.asciiAll.replace(/·/g, "").length > 0;
  L.push("    LSB(全字节): " + truncate(res.asciiAll, 120));
  L.push("    LSB(addr位): " + truncate(res.asciiAddr, 120));
  L.push("    LSB(line位): " + truncate(res.asciiLine, 120));
  if (!showAll) L.push("    (bit 流无可打印内容)");
}

// ============================================================
// 小工具
// ============================================================
function isMostlyPrintable(s) {
  if (!s.length) return false;
  let ok = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 0x20 && c <= 0x7e) || c === 0x09 || c === 0x0a || c > 0x7f) ok++;
  }
  return ok / s.length >= 0.8;
}

function truncate(s, max) {
  return s.length > max ? s.slice(0, max) + " …(" + s.length + "字)" : s;
}

function safeDate(ts) {
  try {
    const d = new Date(ts * 1000);
    if (isNaN(d.getTime())) return "无效时间戳";
    return d.toISOString().replace("T", " ").replace(".000Z", " UTC");
  } catch { return "?"; }
}

// ============================================================
// 注册
// ============================================================
register({
  id: "stegosaurus",
  cat: "forensic",
  name: "Stegosaurus pyc 隐写检测",
  desc: "解析 .pyc 头定 Python 版本 + 递归解 marshal code object，扫描字符串常量藏的 flag、检测 co_lnotab 行号表异常并抽 LSB bit 流：纯前端静态分析，不执行 pyc",
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
      key: "bitOrder", label: "bit 提取字节序", type: "select", default: "lsb",
      options: [
        { value: "lsb", label: "LSB-first（低位在前）" },
        { value: "msb", label: "MSB-first（高位在前）" },
      ],
    },
    { key: "minStrLen", label: "最短字符串长度", type: "number", default: 4, placeholder: "3-64，默认 4" },
  ],
  run: stegosaurusRun,
  acceptsBytes: true,
});

export {
  stegosaurusRun, parseInput, parseHeader, lookupVersion,
  makeMarshalReader, analyzeLnotab, stringsScan, findFlags, MAGIC_TABLE,
};
